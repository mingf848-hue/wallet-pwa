import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// 1. 初始化 Firebase Admin
if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.BITLEDGER_KEY);
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();
const GLOBAL_WALLET_DOC_ID = 'my_personal_wallet_v2';

export default async function handler(req, res) {
    // 只有 POST 请求才处理
    if (req.method !== 'POST') return res.status(200).send('OK');

    try {
        const update = req.body;
        
        // 1. 基本检查
        if (!update.message || !update.message.text) {
            return res.status(200).json({ status: 'ignored' });
        }

        const chatId = update.message.chat.id;
        const text = update.message.text;
        
        // 2. 安全鉴权 (只允许你的 ID 使用)
        const userChatId = process.env.TG_CHAT_ID; 
        if (String(chatId) !== String(userChatId)) {
            await sendTelegramMessage(chatId, "🚫 未授权用户，无法记账。");
            return res.status(200).send('Unauthorized');
        }

        // 3. 告诉用户正在处理
        // (可选：如果觉得太吵可以注释掉这行)
        // await sendTelegramMessage(chatId, "🤔 正在分析...");

        // 4. 调用 AI 分析文本
        // 传入当前时间，方便 AI 推算 "昨天" 是几号
        const aiResult = await analyzeTextWithGemini(text);

        if (!aiResult || !aiResult.amount) {
            await sendTelegramMessage(chatId, "❓ 没听懂... 试试：'打车 20' 或 '昨天买菜 58 Mashreq'");
            return res.status(200).send('AI Failed');
        }

        // 5. 写入数据库 (含账户匹配逻辑)
        const savedTx = await saveToFirebase(aiResult);

        // 6. 回复结果
        const replyMsg = `✅ <b>已记账</b>\n\n💸 <b>${savedTx.type === 'expense' ? '-' : '+'}${savedTx.amount} ${savedTx.currency}</b>\n🏷️ ${savedTx.categoryName} · ${savedTx.accountName}\n📝 ${savedTx.note}\n📅 ${savedTx.date.substring(0, 16).replace('T', ' ')}`;
        await sendTelegramMessage(chatId, replyMsg);

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error("Webhook Error:", error);
        return res.status(200).json({ error: error.message });
    }
}

// --- 辅助函数：调用 Gemini (文本模式) ---
async function analyzeTextWithGemini(text) {
    // 使用你的 Cloudflare 代理根地址 (无需拼接 v1beta...)
    const proxyUrl = "https://gemini-proxy.aratakitofood.workers.dev/"; 
    
    // 获取当前时间，告诉 AI "今天是几号"，方便它推算"昨天/上周"
    const now = new Date();
    const dateContext = `今天是 ${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日，时间 ${now.getHours()}:${now.getMinutes()}`;

    const prompt = `
      你是一个专业的私人财务助理。请分析用户的这句话："${text}"。
      
      【当前时间参考】：${dateContext}

      请提取关键信息并返回 JSON：
      1. **amount**: 金额 (数字)。
      2. **currency**: 币种 (CNY, USDT, AED)。默认 CNY。
      3. **merchant**: 商户或用途 (作为备注)。
      4. **account**: 支付账户关键词 (例如: Alipay, WeChat, Mashreq, Bank, Cash)。默认 WeChat。
         - 如果提到 "银行卡"、"Bank"，请返回 "Bank"。
         - 如果提到 "Mashreq"、"马士礼格"，请返回 "Mashreq"。
      5. **category**: 分类 (food, shop, transport, home, fun, other)。
      6. **type**: 'expense' (支出) 或 'income' (收入)。默认 expense。
      7. **date**: 交易时间 (YYYY-MM-DD HH:mm:ss)。
         - 如果用户说 "昨天"，请基于【当前时间参考】推算。
         - 如果没提时间，就用当前时间。

      返回示例：
      {"amount": 25.5, "currency": "CNY", "merchant": "打车", "account": "WeChat", "category": "transport", "type": "expense", "date": "2025-12-10 14:00:00"}
      只返回纯 JSON 字符串，不要 Markdown。
    `;

    try {
        const res = await fetch(proxyUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // 记得在 Vercel 环境变量配置 PROXY_SECRET
                "Authorization": `Bearer ${process.env.PROXY_SECRET}` 
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        
        if (!res.ok) throw new Error(`AI API Error: ${res.status}`);
        
        const json = await res.json();
        const rawText = json.candidates[0].content.parts[0].text;
        const cleanText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);
    } catch (e) {
        console.error("AI Error:", e);
        return null;
    }
}

// --- 辅助函数：写入 Firebase (含 Mashreq 优先匹配) ---
async function saveToFirebase(data) {
    const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
    const docSnap = await docRef.get();
    let state = docSnap.data().state;

    // 1. 账户匹配逻辑 (复用 analyze.js 的强大逻辑)
    let targetAcc = null;
    const choice = (data.account || '').toLowerCase();

    // A. 精准匹配
    targetAcc = state.accounts.find(a => 
        a.id.toLowerCase().includes(choice) || 
        a.name.toLowerCase().includes(choice)
    );

    // B. 中文映射
    if (!targetAcc) {
        if (choice.includes('微信')) targetAcc = state.accounts.find(a => a.id.includes('wechat'));
        else if (choice.includes('支付宝')) targetAcc = state.accounts.find(a => a.id.includes('alipay'));
    }

    // C. ★ Mashreq / 银行卡 优先通道 ★
    if (!targetAcc && (choice.includes('bank') || choice.includes('card') || choice.includes('银行'))) {
         // 优先找 Mashreq
         targetAcc = state.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
         // 找不到再找其他银行
         if (!targetAcc) {
             targetAcc = state.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
         }
    }

    // D. 兜底
    if (!targetAcc) targetAcc = state.accounts[0];

    // 2. 构造账单
    const newTx = {
        id: Date.now(),
        type: data.type || 'expense',
        amount: parseFloat(data.amount),
        currency: data.currency || targetAcc.currency || 'CNY',
        accountId: targetAcc.id,
        category: data.category || 'other',
        date: data.date || new Date().toISOString(),
        note: data.merchant || 'Bot记账',
        source: 'telegram_bot' // 标记来源
    };

    // 3. 更新余额
    const accIndex = state.accounts.findIndex(a => a.id === targetAcc.id);
    if (accIndex !== -1) {
        if (newTx.type === 'expense') {
            state.accounts[accIndex].balance -= newTx.amount;
        } else {
            state.accounts[accIndex].balance += newTx.amount;
        }
    }
    state.transactions.push(newTx);

    // 4. 保存
    await docRef.update({
        'state.accounts': state.accounts,
        'state.transactions': state.transactions,
        'updatedAt': new Date()
    });

    return {
        ...newTx,
        accountName: targetAcc.name,
        categoryName: data.category
    };
}

// --- 辅助函数：发消息 ---
async function sendTelegramMessage(chatId, text) {
    const token = process.env.TG_BOT_TOKEN;
    if (!token) return;
    
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: "HTML"
        })
    });
}
