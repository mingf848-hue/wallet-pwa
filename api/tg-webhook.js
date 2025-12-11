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
        if (!update.message) return res.status(200).json({ status: 'ignored' });

        const chatId = String(update.message.chat.id);
        const senderName = update.message.from.first_name || "User";
        
        // 2. 鉴权
        const adminId = String(process.env.TG_CHAT_ID); 
        const whitelist = (process.env.TG_WHITELIST || "").split(",").map(id => id.trim());
        const isAllowed = (chatId === adminId) || whitelist.includes(chatId);

        if (!isAllowed) {
            await sendTelegramMessage(chatId, "🚫 未授权用户。");
            return res.status(200).send('Unauthorized');
        }

        // --- 3. 路由分发 ---

        // A. 图片处理 (直接归档，不走AI)
        if (update.message.photo) {
            const photo = update.message.photo[update.message.photo.length - 1]; // 取大图
            const fileId = photo.file_id;
            const caption = update.message.caption || ""; 

            // 快捷回复功能
            if (caption.trim().startsWith("存 ")) {
                const parts = caption.trim().split(" ");
                if (parts.length >= 3) {
                    const keyword = parts[1];
                    const content = parts.slice(2).join(" ");
                    await saveShortcut(keyword, content, fileId);
                    await sendTelegramMessage(chatId, `✅ <b>快捷回复已保存</b>\n\n🔑 触发词：${keyword}`);
                    return res.status(200).json({ success: true, type: 'shortcut_saved' });
                }
            }

            // 直接归档
            const docTitle = caption.trim() || `图片归档 ${new Date().toLocaleDateString()}`;
            await saveDocument({ title: docTitle }, fileId);
            await sendTelegramMessage(chatId, `📂 <b>已归档</b>\n\n📄 标题：${docTitle}\n<i>(发送 "搜 ${docTitle.substring(0, 2)}" 可找回)</i>`);
            return res.status(200).json({ success: true, type: 'photo_saved' });
        }

        // B. 文本处理 (指令 / 快捷回复 / 记账 / 提醒)
        if (update.message.text) {
            const text = update.message.text.trim();

            // 优先匹配快捷回复
            const shortcutSent = await handleShortcutReply(chatId, text);
            if (shortcutSent) return res.status(200).json({ success: true, type: 'shortcut_sent' });

            // 常用指令
            if (['撤销', 'undo', '/undo'].includes(text.toLowerCase())) {
                const msg = await handleUndo();
                await sendTelegramMessage(chatId, msg);
                return res.status(200).json({ success: true });
            }
            if (['统计', '本月', '查账'].includes(text)) {
                // 如果你想加回统计功能，可以在这里加，目前先留空
            }
            if (text.startsWith('搜') || text.startsWith('找')) {
                const keyword = text.replace(/^(搜|找)\s*/, '');
                if(keyword) await handleSearchDocument(chatId, keyword);
                return res.status(200).json({ success: true });
            }

            // ★★★ AI 智能分析 (核心：区分记账和提醒) ★★★
            const aiResult = await analyzeTextWithGemini(text);

            if (!aiResult) {
                await sendTelegramMessage(chatId, "❓ 没听懂。试试 '打车20' 或 '明天9点提醒我开会'");
            } 
            // 分支 1：提醒
            else if (aiResult.type === 'reminder') {
                await saveReminder(aiResult, chatId);
                
                let timeDisplay = "时间未知";
                try { 
                    // 显示给用户看的时候，转成迪拜时间
                    timeDisplay = new Date(aiResult.date).toLocaleString('zh-CN', { timeZone: 'Asia/Dubai', hour12: false }); 
                } catch(e) {}
                
                await sendTelegramMessage(chatId, `⏰ <b>已设置提醒</b>\n\n📝 ${aiResult.note}\n📅 ${timeDisplay}\n\n<i>(到时候我会发消息提醒你)</i>`);
            } 
            // 分支 2：记账
            else {
                const savedTx = await saveTransaction(aiResult, senderName);
                await sendSuccessReply(chatId, savedTx, "✅ 文字记账成功");
            }
            
            return res.status(200).json({ success: true });
        }

        return res.status(200).send('OK');

    } catch (error) {
        console.error("Error:", error);
        return res.status(200).json({ error: error.message });
    }
}

// ================= 核心函数 =================

// 1. 保存提醒 (关键函数)
async function saveReminder(data, chatId) {
    const reminderData = {
        note: data.note,
        targetTime: data.date, // 这是 ISO 格式的时间
        chatId: chatId,
        status: 'pending', // 待发送
        createdAt: new Date().toISOString()
    };
    // 存入 'reminders' 集合
    await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('reminders').add(reminderData);
}

// 2. AI 文本分析 (含提醒判断)
async function analyzeTextWithGemini(text) {
    const proxyUrl = "https://gemini-proxy.aratakitofood.workers.dev/"; 
    const now = new Date();
    // 强制使用迪拜时间做参考
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000); 
    const dubaiNow = new Date(utcTime + (4 * 60 * 60 * 1000));
    const dateContext = `现在是迪拜时间 ${dubaiNow.getFullYear()}年${dubaiNow.getMonth()+1}月${dubaiNow.getDate()}日 ${dubaiNow.getHours()}:${dubaiNow.getMinutes()}`;

    const prompt = `
      你是一个全能私人助理。请分析用户指令："${text}"。
      【当前时间参考】：${dateContext}

      请判断用户意图是【记账】还是【提醒】：

      【A. 提醒 (关键词：提醒、记得、去干嘛、几点做什么)】
      返回 JSON:
      {
        "type": "reminder",
        "note": "提醒内容 (去除时间词)",
        "date": "YYYY-MM-DD HH:mm:ss" (触发时间)
          - 根据口语推算 (如"明天"、"后天")
          - 如果只说日期没说时间，默认设为当天 09:00:00
      }

      【B. 记账 (关键词：买、花、收款、金额)】
      返回 JSON:
      {
        "type": "transaction",
        "amount": 数字,
        "currency": "CNY/USDT/AED/null",
        "merchant": "备注",
        "account": "WeChat/Alipay/Bank/Cash/Mashreq",
        "category": "food/shop...",
        "date": "YYYY-MM-DD HH:mm:ss"
      }
      只返回纯 JSON。
    `;

    try {
        const res = await fetch(proxyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
        const json = await res.json();
        const raw = json.candidates[0].content.parts[0].text;
        let result = JSON.parse(raw.replace(/```json/g, '').replace(/```/g, '').trim());

        // 时间处理：AI 返回的字符串通常是迪拜字面时间，强转 ISO 存入数据库
        if (result.date) {
            try {
                const dateStr = result.date.replace(' ', 'T');
                // 如果没有时区后缀，手动补上 +04:00 (迪拜)
                if (!dateStr.includes('+') && !dateStr.endsWith('Z')) {
                    result.date = new Date(`${dateStr}+04:00`).toISOString();
                } else {
                    result.date = new Date(dateStr).toISOString();
                }
            } catch(e) { result.date = new Date().toISOString(); }
        }
        return result;

    } catch(e) { return null; }
}

// ... (以下函数保持不变：saveDocument, handleSearchDocument, saveShortcut, handleShortcutReply, saveTransaction, handleUndo, sendTelegramMessage 等) ...
// 请务必把之前代码里的 saveDocument, saveTransaction 等辅助函数都复制过来，保持完整性。
// 这里为了篇幅省略了重复部分，逻辑与上一版完全一致。

// 3. 保存文档
async function saveDocument(data, fileId) {
    const docData = { id: Date.now().toString(), type: 'document', title: data.title || '无标题', tags: ['quick_save'], expiry_date: null, key_info: '', file_id: fileId, created_at: new Date().toISOString() };
    await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('documents').add(docData);
}

// 4. 搜索文档
async function handleSearchDocument(chatId, keyword) {
    const docsRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('documents');
    const snapshot = await docsRef.get();
    if (snapshot.empty) return await sendTelegramMessage(chatId, "📭 暂无归档。");
    const matches = [];
    snapshot.forEach(doc => { const d = doc.data(); if (d.title.includes(keyword)) matches.push(d); });
    if (matches.length === 0) return await sendTelegramMessage(chatId, `🔍 未找到 "${keyword}"。`);
    for (const doc of matches) { await sendTelegramPhoto(chatId, doc.file_id, `📄 ${doc.title}`); }
}

// 5. 快捷回复相关
async function saveShortcut(keyword, content, fileId) {
    const data = { keyword, content, file_id: fileId, updated_at: new Date().toISOString() };
    await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('shortcuts').doc(keyword).set(data);
}
async function handleShortcutReply(chatId, text) {
    const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('shortcuts').doc(text);
    const docSnap = await docRef.get();
    if (docSnap.exists) {
        const data = docSnap.data();
        await sendTelegramPhoto(chatId, data.file_id, data.content);
        return true; 
    }
    return false; 
}

// 6. 记账入库
async function saveTransaction(data, senderName) {
    const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
    const docSnap = await docRef.get();
    let state = docSnap.data().state;
    let targetAcc = null;
    const choice = (data.account || data.platform || '').toLowerCase();
    targetAcc = state.accounts.find(a => a.id.toLowerCase().includes(choice) || a.name.toLowerCase().includes(choice));
    if (!targetAcc) {
        if (choice.includes('微信')) targetAcc = state.accounts.find(a => a.id.includes('wechat'));
        else if (choice.includes('支付宝')) targetAcc = state.accounts.find(a => a.id.includes('alipay'));
    }
    if (!targetAcc) {
        if (choice.includes('cash') || choice.includes('现金')) targetAcc = state.accounts.find(a => a.name.includes('现金') || a.id === 'cash');
        else if (choice.includes('bank') || choice.includes('card') || choice.includes('银行')) {
             targetAcc = state.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
             if (!targetAcc) targetAcc = state.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
        }
    }
    if (!targetAcc) targetAcc = state.accounts[0];
    const finalCurrency = data.currency || targetAcc.currency || 'CNY';
    const newTx = { id: Date.now(), type: data.type || 'expense', amount: parseFloat(data.amount), currency: finalCurrency, accountId: targetAcc.id, category: data.category || 'other', date: data.date, note: data.product_name || data.merchant || 'Bot记账', source: 'telegram_bot' };
    const accIndex = state.accounts.findIndex(a => a.id === targetAcc.id);
    if (accIndex !== -1) { if (newTx.type === 'expense') state.accounts[accIndex].balance -= newTx.amount; else state.accounts[accIndex].balance += newTx.amount; }
    state.transactions.push(newTx);
    await docRef.update({ 'state.accounts': state.accounts, 'state.transactions': state.transactions, 'updatedAt': new Date() });
    return { ...newTx, accountName: targetAcc.name, categoryName: data.category };
}

// 7. 撤销
async function handleUndo() {
    const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
    const docSnap = await docRef.get();
    let state = docSnap.data().state;
    const transactions = state.transactions || [];
    let targetIndex = -1;
    for (let i = transactions.length - 1; i >= 0; i--) { if (transactions[i].source === 'telegram_bot') { targetIndex = i; break; } }
    if (targetIndex === -1) return "🤷‍♂️ 无可撤销记录。";
    const tx = transactions[targetIndex];
    const accIndex = state.accounts.findIndex(a => a.id === tx.accountId);
    if (accIndex !== -1) { if (tx.type === 'expense') state.accounts[accIndex].balance += tx.amount; else state.accounts[accIndex].balance -= tx.amount; }
    transactions.splice(targetIndex, 1);
    await docRef.update({ 'state.accounts': state.accounts, 'state.transactions': state.transactions });
    return `↩️ 已撤销: ${tx.note} (${tx.amount})`;
}

// TG 工具
async function getTelegramFileUrl(fileId) {
    const token = process.env.TG_BOT_TOKEN;
    const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const json = await res.json();
    return json.ok ? `https://api.telegram.org/file/bot${token}/${json.result.file_path}` : null;
}
async function downloadImageAsBase64(url) {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    return Buffer.from(buf).toString('base64');
}
async function sendSuccessReply(chatId, tx, title) {
    const dubaiTimeStr = new Date(tx.date).toLocaleString('zh-CN', { timeZone: 'Asia/Dubai', hour12: false });
    const msg = `${title}\n\n💸 <b>${tx.type==='expense'?'-':'+'}${tx.amount} ${tx.currency}</b>\n🏷️ ${tx.categoryName} · ${tx.accountName}\n📝 ${tx.note}\n📅 ${dubaiTimeStr}`;
    await sendTelegramMessage(chatId, msg);
}
async function sendTelegramMessage(chatId, text) {
    const token = process.env.TG_BOT_TOKEN;
    if (!token) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML" })
    });
}
async function sendTelegramPhoto(chatId, fileId, caption) {
    const token = process.env.TG_BOT_TOKEN;
    if (!token) return;
    await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, photo: fileId, caption: caption, parse_mode: "HTML" })
    });
}
