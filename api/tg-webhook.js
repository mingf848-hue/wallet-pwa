import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// 1. 初始化
if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.BITLEDGER_KEY);
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();
const GLOBAL_WALLET_DOC_ID = 'my_personal_wallet_v2';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send('OK');

    try {
        const update = req.body;
        if (!update.message || !update.message.text) {
            return res.status(200).json({ status: 'ignored' });
        }

        const chatId = String(update.message.chat.id);
        const text = update.message.text;
        
        // 2. 鉴权
        const adminId = String(process.env.TG_CHAT_ID); 
        const whitelist = (process.env.TG_WHITELIST || "").split(",").map(id => id.trim());
        const isAllowed = (chatId === adminId) || whitelist.includes(chatId);

        if (!isAllowed) {
            await sendTelegramMessage(chatId, "🚫 未授权用户。");
            return res.status(200).send('Unauthorized');
        }

        // 3. AI 分析
        const aiResult = await analyzeTextWithGemini(text);

        if (!aiResult || !aiResult.amount) {
            await sendTelegramMessage(chatId, "❓ 没听懂... 试试：'午饭 20' 或 '现金 5 买菜'");
            return res.status(200).send('AI Failed');
        }

        // 4. 写入数据库
        const savedTx = await saveToFirebase(aiResult);

        // 5. 回复结果 (强制转换为迪拜时间显示)
        // 使用 'en-GB' 格式化 (24小时制)，指定 Asia/Dubai 时区
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

// --- 辅助函数：调用 Gemini ---
async function analyzeTextWithGemini(text) {
    const proxyUrl = "https://gemini-proxy.aratakitofood.workers.dev/"; 
    
    // ★★★ 修复1：强制计算迪拜时间 (UTC+4) 作为 AI 参考 ★★★
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000); // 转为 UTC 时间戳
    const dubaiNow = new Date(utcTime + (4 * 60 * 60 * 1000)); // 加 4 小时
    
    const dateContext = `现在是迪拜时间 ${dubaiNow.getFullYear()}年${dubaiNow.getMonth()+1}月${dubaiNow.getDate()}日 ${dubaiNow.getHours()}:${dubaiNow.getMinutes()}`;

    const prompt = `
      你是一个专业的私人财务助理。请分析用户的这句话："${text}"。
      【当前时间参考】：${dateContext}

      请提取关键信息并返回 JSON：
      1. **amount**: 金额 (数字)。
      2. **currency**: 币种 (CNY, USDT, AED)。
         - 如果用户没说币种，返回 null (由系统自动匹配账户币种)。
      3. **merchant**: 商户或用途 (作为备注)。
      4. **account**: 支付账户关键词。
         - **提到 "现金"、"Cash" -> 返回 "Cash"** <-- 关键修复
         - 提到 "银行卡"、"Bank" -> 返回 "Bank"
         - 提到 "Mashreq" -> 返回 "Mashreq"
         - 默认: WeChat
      5. **category**: 分类 (food, shop, transport, home, fun, other)。
      6. **type**: 'expense' (支出) 或 'income' (收入)。默认 expense。
      7. **date**: 交易时间 (YYYY-MM-DD HH:mm:ss)。
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

    // A. 精准匹配
    targetAcc = state.accounts.find(a => 
        a.id.toLowerCase().includes(choice) || 
        a.name.toLowerCase().includes(choice)
    );

    // B. 中文映射
    if (!targetAcc) {
        if (choice.includes('微信') || choice.includes('wechat')) targetAcc = state.accounts.find(a => a.id.includes('wechat'));
        else if (choice.includes('支付宝') || choice.includes('alipay')) targetAcc = state.accounts.find(a => a.id.includes('alipay'));
    }

    // C. 特殊账户匹配 (Mashreq & 现金)
    if (!targetAcc) {
        // ★★★ 修复2：现金匹配逻辑 ★★★
        if (choice.includes('cash') || choice.includes('现金')) {
            // 优先找名字里带“现金”的，或者 ID 是 'cash' 的
            targetAcc = state.accounts.find(a => a.name.includes('现金') || a.id === 'cash');
        }
        // 银行卡/Mashreq
        else if (choice.includes('bank') || choice.includes('card') || choice.includes('银行')) {
             targetAcc = state.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
             if (!targetAcc) targetAcc = state.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
        }
    }

    // D. 兜底
    if (!targetAcc) targetAcc = state.accounts[0];

    // 2. 构造账单
    // 注意：data.date 是 AI 基于迪拜时间推算的字符串，我们把它转为 ISO 存入数据库
    // 这样前端会自动根据手机时区显示正确时间，但数据库里存的是 UTC
    // 技巧：这里直接 new Date(data.date) 可能会被 Vercel 当作 UTC 解析，导致时间偏差 4 小时
    // 所以我们需要把 AI 返回的 "2025-12-11 05:05:00" 显式地告诉 JS 这是 "GMT+0400"
    
    let isoDate;
    try {
        // 简单粗暴法：如果 AI 返回的时间字符串没有时区，手动拼上迪拜时区
        const dateStr = data.date.replace(' ', 'T'); // 2025-12-11T05:05:00
        // 判断是否已经带有时区（AI有时候会带Z）
        if (dateStr.endsWith('Z') || dateStr.includes('+')) {
            isoDate = new Date(dateStr).toISOString();
        } else {
            // 强制指定为迪拜时间 (+04:00)
            isoDate = new Date(`${dateStr}+04:00`).toISOString();
        }
    } catch(e) {
        isoDate = new Date().toISOString(); // 出错就用当前时间
    }

    const newTx = {
        id: Date.now(),
        type: data.type || 'expense',
        amount: parseFloat(data.amount),
        currency: data.currency || targetAcc.currency || 'CNY',
        accountId: targetAcc.id,
        category: data.category || 'other',
        date: isoDate,
        note: data.merchant || 'Bot记账',
        source: 'telegram_bot'
    };

    // 3. 更新余额
    const accIndex = state.accounts.findIndex(a => a.id === targetAcc.id);
    if (accIndex !== -1) {
        if (newTx.type === 'expense') state.accounts[accIndex].balance -= newTx.amount;
        else state.accounts[accIndex].balance += newTx.amount;
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

// 发消息
async function sendTelegramMessage(chatId, text) {
    const token = process.env.TG_BOT_TOKEN;
    if (!token) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML" })
    });
}
