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

        const chatId = String(update.message.chat.id);
        const text = update.message.text;
        // const senderName = update.message.from.first_name || "User"; // 不需要名字了
        
        // --- 2. 鉴权：主号 + 白名单 (你的小号) ---
        // 你的主号 ID
        const adminId = String(process.env.TG_CHAT_ID); 
        // 你的小号 ID (在 Vercel 环境变量 TG_WHITELIST 里填，逗号分隔)
        const whitelist = (process.env.TG_WHITELIST || "").split(",").map(id => id.trim());

        const isAllowed = (chatId === adminId) || whitelist.includes(chatId);

        if (!isAllowed) {
            await sendTelegramMessage(chatId, "🚫 未授权用户，无法记账。");
            return res.status(200).send('Unauthorized');
        }

        // 3. 调用 AI 分析文本 (带时间推算)
        const aiResult = await analyzeTextWithGemini(text);

        if (!aiResult || !aiResult.amount) {
            await sendTelegramMessage(chatId, "❓ 没听懂... 试试：'打车 20' 或 '昨天买菜 58 Mashreq'");
            return res.status(200).send('AI Failed');
        }

        // --- 4. 写入数据库 ---
        // 【修改点】直接写入，不再追加 "(by 名字)"
        const savedTx = await saveToFirebase(aiResult);

        // 5. 回复结果
        const replyMsg = `✅ <b>已记账</b>\n\n💸 <b>${savedTx.type === 'expense' ? '-' : '+'}${savedTx.amount} ${savedTx.currency}</b>\n🏷️ ${savedTx.categoryName} · ${savedTx.accountName}\n📝 ${savedTx.note}\n📅 ${savedTx.date.substring(0, 16).replace('T', ' ')}`;
        await sendTelegramMessage(chatId, replyMsg);

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error("Webhook Error:", error);
        return res.status(200).json({ error: error.message });
    }
}

// --- 辅助函数：调用 Gemini ---
async function analyzeTextWithGemini(text) {
    const proxyUrl = "https://gemini-proxy.aratakitofood.workers.dev/"; 
    
    const now = new Date();
    const dateContext = `今天是 ${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日，时间 ${now.getHours()}:${now.getMinutes()}`;

    const prompt = `
      你是一个专业的私人财务助理。请分析用户的这句话："${text}"。
      【当前时间参考】：${dateContext}
      请提取关键信息并返回 JSON：
      1. amount: 金额 (数字)。
      2. currency: 币种 (CNY, USDT, AED)。默认 CNY。
      3. merchant: 商户或用途 (作为备注)。
      4. account: 支付账户关键词 (例如: Alipay, WeChat, Mashreq, Bank, Cash)。默认 WeChat。
         - 如果提到 "银行卡"、"Bank"，请返回 "Bank"。
         - 如果提到 "Mashreq"、"马士礼格"，请返回 "Mashreq"。
      5. category: 分类 (food, shop, transport, home, fun, other)。
      6. type: 'expense' (支出) 或 'income' (收入)。默认 expense。
      7. date: 交易时间 (YYYY-MM-DD HH:mm:ss)。
         - 如果用户说 "昨天"，请基于【当前时间参考】推算。
         - 如果没提时间，就用当前时间。

      返回示例：{"amount": 25.5, "currency": "CNY", "merchant": "打车", "account": "WeChat", "category": "transport", "type": "expense", "date": "2025-12-10 14:00:00"}
      只返回纯 JSON。
    `;

    try {
        const res = await fetch(proxyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
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

// --- 辅助函数：写入 Firebase ---
async function saveToFirebase(data) {
    const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
    const docSnap = await docRef.get();
    let state = docSnap.data().state;

    // 账户匹配逻辑 (含 Mashreq 优先)
    let targetAcc = null;
    const choice = (data.account || '').toLowerCase();

    targetAcc = state.accounts.find(a => a.id.toLowerCase().includes(choice) || a.name.toLowerCase().includes(choice));
    if (!targetAcc) {
        if (choice.includes('微信')) targetAcc = state.accounts.find(a => a.id.includes('wechat'));
        else if (choice.includes('支付宝')) targetAcc = state.accounts.find(a => a.id.includes('alipay'));
    }
    if (!targetAcc && (choice.includes('bank') || choice.includes('card') || choice.includes('银行'))) {
         targetAcc = state.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
         if (!targetAcc) targetAcc = state.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
    }
    if (!targetAcc) targetAcc = state.accounts[0];

    const newTx = {
        id: Date.now(),
        type: data.type || 'expense',
        amount: parseFloat(data.amount),
        currency: data.currency || targetAcc.currency || 'CNY',
        accountId: targetAcc.id,
        category: data.category || 'other',
        date: data.date || new Date().toISOString(),
        note: data.merchant || 'Bot记账',
        source: 'telegram_bot'
    };

    const accIndex = state.accounts.findIndex(a => a.id === targetAcc.id);
    if (accIndex !== -1) {
        if (newTx.type === 'expense') state.accounts[accIndex].balance -= newTx.amount;
        else state.accounts[accIndex].balance += newTx.amount;
    }
    state.transactions.push(newTx);

    await docRef.update({
        'state.accounts': state.accounts,
        'state.transactions': state.transactions,
        'updatedAt': new Date()
    });

    return { ...newTx, accountName: targetAcc.name, categoryName: data.category };
}

// --- 辅助函数：发消息 ---
async function sendTelegramMessage(chatId, text) {
    const token = process.env.TG_BOT_TOKEN;
    if (!token) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML" })
    });
}
