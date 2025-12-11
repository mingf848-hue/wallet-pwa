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
    // 只接受 POST
    if (req.method !== 'POST') return res.status(200).send('OK'); // TG 建议返回 200

    try {
        const update = req.body;
        
        // 1. 基本检查：是不是文本消息？
        if (!update.message || !update.message.text) {
            return res.status(200).json({ status: 'ignored' });
        }

        const chatId = update.message.chat.id;
        const text = update.message.text;
        const userChatId = process.env.TG_CHAT_ID; // 你的 ID

        // 2. 安全鉴权：防止陌生人乱记账
        // 注意：TG_CHAT_ID 需要在 Vercel 环境变量里配置，类型是字符串
        if (String(chatId) !== String(userChatId)) {
            await sendTelegramMessage(chatId, "🚫 未授权的用户，无法使用此记账服务。");
            return res.status(200).send('Unauthorized');
        }

        // 3. 调用 AI 分析文本
        await sendTelegramMessage(chatId, "🤔 正在分析...");
        const aiResult = await analyzeTextWithGemini(text);

        if (!aiResult || !aiResult.amount) {
            await sendTelegramMessage(chatId, "❓ 没听懂... 请尝试：'打车 20' 或 '买菜 58.5 微信'");
            return res.status(200).send('AI Failed');
        }

        // 4. 写入数据库
        const savedTx = await saveToFirebase(aiResult);

        // 5. 回复成功
        const replyMsg = `✅ <b>已记账</b>\n\n💸 <b>${savedTx.amount} ${savedTx.currency}</b>\n🏷️ ${savedTx.categoryName} · ${savedTx.accountName}\n📝 ${savedTx.note}\n📅 ${savedTx.date}`;
        await sendTelegramMessage(chatId, replyMsg);

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error("Webhook Error:", error);
        // 出错也要返回 200 给 TG，否则它会一直重试
        return res.status(200).json({ error: error.message });
    }
}

// --- 辅助函数：调用 Gemini (文本模式) ---
async function analyzeTextWithGemini(text) {
    const proxyUrl = "https://gemini-proxy.aratakitofood.workers.dev/v1beta/models/gemini-1.5-flash:generateContent";
    const currentYear = new Date().getFullYear();
    
    const prompt = `
      你是一个记账助手。请分析用户的这句话："${text}"。
      提取关键信息并返回 JSON：
      1. amount: 金额 (数字)。
      2. currency: 币种 (CNY, USDT, AED)。默认 CNY。
      3. merchant: 商户或用途 (作为备注)。
      4. account: 支付账户 (根据关键词推测：Alipay/WeChat/Mashreq/Cash/Binance)。默认 WeChat。
      5. category: 分类 (food, shop, transport, home, fun, other)。
      6. date: 交易时间 (YYYY-MM-DD HH:mm:ss)。如果是"昨天"、"刚刚"请自动推算，默认当前时间。

      返回示例：
      {"amount": 25.5, "currency": "CNY", "merchant": "打车", "account": "WeChat", "category": "transport", "date": "2025-12-10 14:00:00"}
      只返回 JSON。
    `;

    try {
        const res = await fetch(proxyUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.PROXY_SECRET}` // 记得在 Vercel 配这个变量
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
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

    // 1. 匹配账户
    let targetAcc = state.accounts.find(a => 
        a.id.toLowerCase().includes(data.account.toLowerCase()) || 
        a.name.toLowerCase().includes(data.account.toLowerCase())
    );
    // 默认账户逻辑
    if (!targetAcc) {
        if (data.account.toLowerCase().includes('微信')) targetAcc = state.accounts.find(a => a.id.includes('wechat'));
        else if (data.account.toLowerCase().includes('支付宝')) targetAcc = state.accounts.find(a => a.id.includes('alipay'));
        else if (data.account.toLowerCase().includes('mashreq')) targetAcc = state.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
    }
    if (!targetAcc) targetAcc = state.accounts[0];

    // 2. 构造账单
    const newTx = {
        id: Date.now(),
        type: 'expense', // 默认为支出，如果是收入可以在 prompt 里加逻辑判断
        amount: parseFloat(data.amount),
        currency: data.currency || targetAcc.currency,
        accountId: targetAcc.id,
        category: data.category || 'other',
        date: data.date || new Date().toISOString(),
        note: data.merchant || 'Bot记账',
        source: 'telegram_bot'
    };

    // 3. 更新余额
    const accIndex = state.accounts.findIndex(a => a.id === targetAcc.id);
    if (accIndex !== -1) {
        state.accounts[accIndex].balance -= newTx.amount;
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
        categoryName: data.category // 这里为了简单直接返回 ID，实际可以用 map 转中文
    };
}

// --- 辅助函数：发消息 ---
async function sendTelegramMessage(chatId, text) {
    const token = process.env.TG_BOT_TOKEN;
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
