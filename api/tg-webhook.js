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
        
        // 2. 鉴权：主号 + 白名单
        const adminId = String(process.env.TG_CHAT_ID); 
        const whitelist = (process.env.TG_WHITELIST || "").split(",").map(id => id.trim());
        const isAllowed = (chatId === adminId) || whitelist.includes(chatId);

        if (!isAllowed) {
            await sendTelegramMessage(chatId, "🚫 未授权用户。");
            return res.status(200).send('Unauthorized');
        }

        // ★★★ 新增：撤销命令处理 ★★★
        const command = text.trim().toLowerCase();
        if (['撤销', 'undo', '/undo', '后悔', '回滚'].includes(command)) {
            const undoMsg = await handleUndo();
            await sendTelegramMessage(chatId, undoMsg);
            return res.status(200).json({ success: true, type: 'undo' });
        }

        // 3. 正常流程：AI 分析记账
        const aiResult = await analyzeTextWithGemini(text);

        if (!aiResult || !aiResult.amount) {
            await sendTelegramMessage(chatId, "❓ 没听懂... 试试：'打车 20' 或 '撤销'");
            return res.status(200).send('AI Failed');
        }

        // 4. 写入数据库
        const savedTx = await saveToFirebase(aiResult);

        // 5. 回复结果
        const dubaiTimeStr = new Date(savedTx.date).toLocaleString('zh-CN', { 
            timeZone: 'Asia/Dubai', 
            year: 'numeric', month: '2-digit', day: '2-digit', 
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false 
        });

        const replyMsg = `✅ <b>已记账</b>\n\n💸 <b>${savedTx.type === 'expense' ? '-' : '+'}${savedTx.amount} ${savedTx.currency}</b>\n🏷️ ${savedTx.categoryName} · ${savedTx.accountName}\n📝 ${savedTx.note}\n📅 ${dubaiTimeStr}`;
        await sendTelegramMessage(chatId, replyMsg);

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error("Webhook Error:", error);
        await sendTelegramMessage(req.body.message.chat.id, `❌ 出错: ${error.message}`);
        return res.status(200).json({ error: error.message });
    }
}

// --- ★★★ 核心新增：撤销逻辑 ★★★ ---
async function handleUndo() {
    const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) return "❌ 数据库读取失败";
    
    let state = docSnap.data().state;
    const transactions = state.transactions || [];
    
    // 1. 倒序查找最近一条来源是 'telegram_bot' 的记录
    let targetIndex = -1;
    for (let i = transactions.length - 1; i >= 0; i--) {
        if (transactions[i].source === 'telegram_bot') {
            targetIndex = i;
            break;
        }
    }
    
    if (targetIndex === -1) {
        return "🤷‍♂️ 找不到最近的机器人记账记录（只能撤销机器人记的账）。";
    }
    
    const tx = transactions[targetIndex];
    
    // 2. 回滚余额
    const accIndex = state.accounts.findIndex(a => a.id === tx.accountId);
    let accName = "未知账户";
    
    if (accIndex !== -1) {
        accName = state.accounts[accIndex].name;
        // 如果是支出，撤销就是加回来；如果是收入，撤销就是减掉
        if (tx.type === 'expense') {
            state.accounts[accIndex].balance += tx.amount;
        } else {
            state.accounts[accIndex].balance -= tx.amount;
        }
    }
    
    // 3. 从列表中删除该条记录
    transactions.splice(targetIndex, 1);
    
    // 4. 保存回数据库
    await docRef.update({
        'state.accounts': state.accounts,
        'state.transactions': transactions,
        'updatedAt': new Date()
    });
    
    return `↩️ <b>已撤销上一笔</b>\n\n📝 <b>${tx.note}</b>\n💸 ${tx.amount} ${tx.currency}\n💳 ${accName}\n\n余额已回滚。`;
}

// --- 辅助函数：调用 Gemini ---
async function analyzeTextWithGemini(text) {
    const proxyUrl = "https://gemini-proxy.aratakitofood.workers.dev/"; 
    
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000); 
    const dubaiNow = new Date(utcTime + (4 * 60 * 60 * 1000)); 
    
    const dateContext = `现在是迪拜时间 ${dubaiNow.getFullYear()}年${dubaiNow.getMonth()+1}月${dubaiNow.getDate()}日 ${dubaiNow.getHours()}:${dubaiNow.getMinutes()}`;

    const prompt = `
      你是一个专业的私人财务助理。请分析用户的这句话："${text}"。
      【当前时间参考】：${dateContext}

      请提取关键信息并返回 JSON：
      1. amount: 金额 (数字)。
      2. currency: 币种 (CNY, USDT, AED)。
         - 如果用户没说币种，返回 null。
      3. merchant: 商户或用途 (作为备注)。
      4. account: 支付账户关键词。
         - **提到 "现金"、"Cash" -> 返回 "Cash"**
         - 提到 "银行卡"、"Bank" -> 返回 "Bank"
         - 提到 "Mashreq" -> 返回 "Mashreq"
         - 默认: WeChat
      5. category: 分类 (food, shop, transport, home, fun, other)。
      6. type: 'expense' (支出) 或 'income' (收入)。默认 expense。
      7. date: 交易时间 (YYYY-MM-DD HH:mm:ss)。
         - 基于【当前时间参考】推算。

      返回示例：{"amount": 5, "currency": null, "merchant": "买菜", "account": "Cash", "category": "food", "type": "expense", "date": "2025-12-11 05:05:00"}
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

    // 1. 账户匹配
    let targetAcc = null;
    const choice = (data.account || '').toLowerCase();

    targetAcc = state.accounts.find(a => a.id.toLowerCase().includes(choice) || a.name.toLowerCase().includes(choice));
    if (!targetAcc) {
        if (choice.includes('微信') || choice.includes('wechat')) targetAcc = state.accounts.find(a => a.id.includes('wechat'));
        else if (choice.includes('支付宝') || choice.includes('alipay')) targetAcc = state.accounts.find(a => a.id.includes('alipay'));
    }
    if (!targetAcc) {
        if (choice.includes('cash') || choice.includes('现金')) {
            targetAcc = state.accounts.find(a => a.name.includes('现金') || a.id === 'cash');
        }
        else if (choice.includes('bank') || choice.includes('card') || choice.includes('银行')) {
             targetAcc = state.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
             if (!targetAcc) targetAcc = state.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
        }
    }
    if (!targetAcc) targetAcc = state.accounts[0];

    const finalCurrency = data.currency || targetAcc.currency || 'CNY';

    // 2. 构造账
