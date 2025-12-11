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

        // ★★★ 1. 处理按钮点击 (删除 / 查看) ★★★
        if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
            return res.status(200).json({ success: true, type: 'button_click' });
        }

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

        // A. 图片处理
        if (update.message.photo) {
            const photo = update.message.photo[update.message.photo.length - 1]; 
            const fileId = photo.file_id;
            const caption = update.message.caption || ""; 

            // 快捷回复
            if (caption.trim().startsWith("存 ")) {
                const parts = caption.trim().split(" ");
                if (parts.length >= 3) {
                    const keyword = parts[1];
                    const content = parts.slice(2).join(" ");
                    await saveShortcut(keyword, content, fileId);
                    await sendTelegramMessage(chatId, `✅ <b>快捷回复已保存</b>\n\n🔑 触发词：${keyword}`);
                    return res.status(200).json({ success: true });
                }
            }

            // 直接归档
            const docTitle = caption.trim() || `图片 ${new Date().toLocaleDateString()}`;
            const docId = await saveDocument({ title: docTitle }, fileId);
            
            await sendTelegramPhoto(chatId, fileId, `📂 <b>已归档</b>\n📄 ${docTitle}`, {
                inline_keyboard: [[{ text: "🗑️ 删除此图", callback_data: `del_doc_${docId}` }]]
            });
            return res.status(200).json({ success: true, type: 'photo_saved' });
        }

        // B. 文本处理
        if (update.message.text) {
            const text = update.message.text.trim();

            // ★★★ 修复1: 拦截系统指令 (防止 /start 乱记账) ★★★
            if (text === '/start') {
                await sendTelegramMessage(chatId, "👋 你好！我是你的私人财务助理。\n\n你可以：\n1. 发送 '买菜 20' 记账\n2. 发送图片直接存图\n3. 发送 '清单' 查看所有图片");
                return res.status(200).json({ success: true });
            }
            // 拦截其他未知指令
            if (text.startsWith('/') && !['/undo', '/list'].includes(text)) {
                 // 默默忽略，或者提示不支持
                 return res.status(200).json({ status: 'ignored_command' });
            }

            // ★★★ 新增: 清单功能 ★★★
            if (['清单', '列表', '所有图片', '/list'].includes(text)) {
                await handleListAll(chatId);
                return res.status(200).json({ success: true, type: 'list' });
            }

            // 1. 优先匹配快捷回复
            const shortcutSent = await handleShortcutReply(chatId, text);
            if (shortcutSent) return res.status(200).json({ success: true, type: 'shortcut_sent' });

            // 2. 搜索
            if (text.startsWith('搜') || text.startsWith('找')) {
                const keyword = text.replace(/^(搜|找)\s*/, '');
                if(keyword) await handleSearchDocument(chatId, keyword);
                return res.status(200).json({ success: true });
            }

            // 3. 撤销
            if (['撤销', 'undo', '/undo'].includes(text.toLowerCase())) {
                const msg = await handleUndo();
                await sendTelegramMessage(chatId, msg);
                return res.status(200).json({ success: true });
            }

            // 4. AI 智能分析 (记账/提醒)
            const aiResult = await analyzeTextWithGemini(text);

            if (!aiResult) {
                await sendTelegramMessage(chatId, "❓ 没听懂。");
            } 
            else if (aiResult.type === 'reminder') {
                await saveReminder(aiResult, chatId);
                let timeDisplay = "时间未知";
                try { timeDisplay = new Date(aiResult.date).toLocaleString('zh-CN', { timeZone: 'Asia/Dubai', hour12: false }); } catch(e) {}
                await sendTelegramMessage(chatId, `⏰ <b>已设置提醒</b>\n\n📝 ${aiResult.note}\n📅 ${timeDisplay}`);
            } 
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

// ================= 核心业务函数 =================

// ★★★ 1. 处理按钮点击 (删除 + 查看) ★★★
async function handleCallbackQuery(query) {
    const data = query.data; 
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    // A. 删除逻辑
    if (data.startsWith("del_doc_") || data.startsWith("del_short_")) {
        let collectionName = data.startsWith("del_doc_") ? 'documents' : 'shortcuts';
        let docId = data.replace(data.startsWith("del_doc_") ? "del_doc_" : "del_short_", "");
        let typeName = data.startsWith("del_doc_") ? "文档" : "快捷回复";

        await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection(collectionName).doc(docId).delete();
        await answerCallbackQuery(query.id, `🗑️ ${typeName}已删除`);
        
        const originalCaption = query.message.caption || typeName;
        await editMessageCaption(chatId, messageId, `${originalCaption}\n\n(❌ 已删除)`);
    }

    // B. 查看逻辑 (点击清单列表里的按钮)
    else if (data.startsWith("view_doc_")) {
        const docId = data.replace("view_doc_", "");
        const docSnap = await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('documents').doc(docId).get();
        if (docSnap.exists) {
            const d = docSnap.data();
            // 发送图片 + 删除按钮
            await sendTelegramPhoto(chatId, d.file_id, `📄 ${d.title}\n📅 ${new Date(d.created_at).toLocaleDateString()}`, {
                inline_keyboard: [[{ text: "🗑️ 删除此图", callback_data: `del_doc_${docId}` }]]
            });
            await answerCallbackQuery(query.id, "加载成功");
        } else {
            await answerCallbackQuery(query.id, "文件不存在");
        }
    }
    else if (data.startsWith("view_short_")) {
        const keyword = data.replace("view_short_", ""); // shortcut ID 就是 keyword
        const docSnap = await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('shortcuts').doc(keyword).get();
        if (docSnap.exists) {
            const d = docSnap.data();
            await sendTelegramPhoto(chatId, d.file_id, d.content, {
                inline_keyboard: [[{ text: "🗑️ 删除此快捷回复", callback_data: `del_short_${keyword}` }]]
            });
            await answerCallbackQuery(query.id, "加载成功");
        } else {
            await answerCallbackQuery(query.id, "文件不存在");
        }
    }
}

// ★★★ 2. 列出所有图片 (清单功能) ★★★
async function handleListAll(chatId) {
    const rootRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
    
    // 获取文档和快捷回复
    const docsSnap = await rootRef.collection('documents').orderBy('created_at', 'desc').get();
    const shortsSnap = await rootRef.collection('shortcuts').get();

    if (docsSnap.empty && shortsSnap.empty) {
        return await sendTelegramMessage(chatId, "📭 暂无任何归档。");
    }

    const inlineKeyboard = [];

    // 添加快捷回复按钮 (每行2个)
    let row = [];
    shortsSnap.forEach(doc => {
        const d = doc.data();
        row.push({ text: `⚡ ${d.keyword}`, callback_data: `view_short_${doc.id}` });
        if (row.length === 2) { inlineKeyboard.push(row); row = []; }
    });
    if (row.length > 0) inlineKeyboard.push(row);

    // 添加文档按钮 (每行1个，因为标题可能长)
    docsSnap.forEach(doc => {
        const d = doc.data();
        inlineKeyboard.push([{ text: `📄 ${d.title}`, callback_data: `view_doc_${doc.id}` }]);
    });

    const totalCount = docsSnap.size + shortsSnap.size;
    await sendTelegramMessage(chatId, `📚 <b>归档清单 (共 ${totalCount} 个)</b>\n点击下方按钮查看详情：`, {
        inline_keyboard: inlineKeyboard
    });
}

// 3. 搜索 (带按钮)
async function handleSearchDocument(chatId, keyword) {
    const docsRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('documents');
    const snapshot = await docsRef.orderBy('created_at', 'desc').get();
    
    const matches = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        if (d.title.includes(keyword) || (d.tags && d.tags.some(t => t.includes(keyword)))) {
            matches.push({ id: doc.id, ...d });
        }
    });

    if (matches.length === 0) return await sendTelegramMessage(chatId, `🔍 未找到 "${keyword}"。`);

    await sendTelegramMessage(chatId, `🔍 找到 ${matches.length} 个结果：`);

    for (const doc of matches) {
        await sendTelegramPhoto(chatId, doc.file_id, `📄 ${doc.title}\n📅 ${new Date(doc.created_at).toLocaleDateString()}`, {
            inline_keyboard: [[{ text: "🗑️ 删除此图", callback_data: `del_doc_${doc.id}` }]]
        });
    }
}

// 4. 保存文档
async function saveDocument(data, fileId) {
    const docData = { title: data.title || '无标题', file_id: fileId, created_at: new Date().toISOString(), tags: ['quick_save'] };
    const ref = await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('documents').add(docData);
    return ref.id;
}

// 5. 保存快捷回复
async function saveShortcut(keyword, content, fileId) {
    const data = { keyword, content, file_id: fileId, updated_at: new Date().toISOString() };
    await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('shortcuts').doc(keyword).set(data);
}

// 6. 触发快捷回复
async function handleShortcutReply(chatId, text) {
    const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('shortcuts').doc(text);
    const docSnap = await docRef.get();
    if (docSnap.exists) {
        const data = docSnap.data();
        // 发送带删除按钮
        await sendTelegramPhoto(chatId, data.file_id, data.content, {
             inline_keyboard: [[{ text: "🗑️ 删除此快捷回复", callback_data: `del_short_${text}` }]]
        });
        return true; 
    }
    return false; 
}

// 7. AI 文本分析
async function analyzeTextWithGemini(text) {
    const proxyUrl = "https://gemini-proxy.aratakitofood.workers.dev/"; 
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000); 
    const dubaiNow = new Date(utcTime + (4 * 60 * 60 * 1000));
    const dateContext = `现在是迪拜时间 ${dubaiNow.getFullYear()}年${dubaiNow.getMonth()+1}月${dubaiNow.getDate()}日 ${dubaiNow.getHours()}:${dubaiNow.getMinutes()}`;

    const prompt = `
      你是一个全能私人助理。请分析用户指令："${text}"。
      【当前时间参考】：${dateContext}

      请判断用户意图：

      【A. 提醒 (必须包含 "提醒"、"记得")】
      返回 JSON: { "type": "reminder", "note": "内容", "date": "YYYY-MM-DD HH:mm:ss" }

      【B. 记账 (关键词：买、花、付、收、打车)】
      返回 JSON:
      {
        "type": "transaction",
        "amount": 数字 (必须为正数),
        "currency": "CNY/USDT/AED/null",
        "merchant": "备注",
        "account": "WeChat/Alipay/Bank/Cash/Mashreq",
        "category": "food/shop/transport...",
        "tx_type": "expense" 或 "income",
        "date": "YYYY-MM-DD HH:mm:ss"
      }
      
      ★ 关键规则：
      1. 如果用户没说币种，currency 返回 null。
      2. 含有 "买/花/付/消费" -> tx_type: 'expense'
      3. 含有 "收/入账/退款" -> tx_type: 'income'
      4. 默认 tx_type: 'expense'

      只返回纯 JSON。
    `;
    try {
        const res = await fetch(proxyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
        const json = await res.json();
        const raw = json.candidates[0].content.parts[0].text;
        let result = JSON.parse(raw.replace(/```json/g, '').replace(/```/g, '').trim());
        if (result.date) {
            try {
                const dateStr = result.date.replace(' ', 'T');
                if (!dateStr.includes('+') && !dateStr.endsWith('Z')) result.date = new Date(`${dateStr}+04:00`).toISOString();
                else result.date = new Date(dateStr).toISOString();
            } catch(e) { result.date = new Date().toISOString(); }
        }
        return result;
    } catch(e) { return null; }
}

// 8. 记账入库
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
    const finalCurrency = data.currency ? data.currency : targetAcc.currency;
    const type = data.tx_type || 'expense';

    const newTx = {
        id: Date.now(),
        type: type,
        amount: parseFloat(data.amount),
        currency: finalCurrency,
        accountId: targetAcc.id,
        category: data.category || 'other',
        date: data.date, 
        note: data.merchant || 'Bot记账',
        source: 'telegram_bot'
    };

    const accIndex = state.accounts.findIndex(a => a.id === targetAcc.id);
    if (accIndex !== -1) {
        if (newTx.type === 'expense') state.accounts[accIndex].balance -= newTx.amount;
        else state.accounts[accIndex].balance += newTx.amount;
    }
    state.transactions.push(newTx);
    await docRef.update({ 'state.accounts': state.accounts, 'state.transactions': state.transactions, 'updatedAt': new Date() });
    return { ...newTx, accountName: targetAcc.name, categoryName: data.category };
}

// 辅助函数
async function saveReminder(data, chatId) { const reminderData = { note: data.note, targetTime: data.date, chatId: chatId, status: 'pending', createdAt: new Date().toISOString() }; await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('reminders').add(reminderData); }
async function handleUndo() { const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID); const docSnap = await docRef.get(); let state = docSnap.data().state; const transactions = state.transactions || []; let targetIndex = -1; for (let i = transactions.length - 1; i >= 0; i--) { if (transactions[i].source === 'telegram_bot') { targetIndex = i; break; } } if (targetIndex === -1) return "🤷‍♂️ 无可撤销记录。"; const tx = transactions[targetIndex]; const accIndex = state.accounts.findIndex(a => a.id === tx.accountId); if (accIndex !== -1) { if (tx.type === 'expense') state.accounts[accIndex].balance += tx.amount; else state.accounts[accIndex].balance -= tx.amount; } transactions.splice(targetIndex, 1); await docRef.update({ 'state.accounts': state.accounts, 'state.transactions': state.transactions }); return `↩️ 已撤销: ${tx.note} (${tx.amount})`; }
async function handleMonthlyReport() { const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID); const docSnap = await docRef.get(); const txs = docSnap.data().state.transactions || []; const currentMonth = new Date().toISOString().slice(0, 7); let total = 0; txs.forEach(t => { if(t.date.startsWith(currentMonth) && t.type==='expense') total+=t.amount; }); return `📊 本月 (${currentMonth}) 总支出: ${total.toFixed(2)}`; }
async function getTelegramFileUrl(fileId) { const token = process.env.TG_BOT_TOKEN; const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`); const json = await res.json(); return json.ok ? `https://api.telegram.org/file/bot${token}/${json.result.file_path}` : null; }
async function downloadImageAsBase64(url) { const res = await fetch(url); const buf = await res.arrayBuffer(); return Buffer.from(buf).toString('base64'); }
async function sendSuccessReply(chatId, tx, title) { const dubaiTimeStr = new Date(tx.date).toLocaleString('zh-CN', { timeZone: 'Asia/Dubai', hour12: false }); const msg = `${title}\n\n💸 <b>${tx.type==='expense'?'-':'+'}${tx.amount} ${tx.currency}</b>\n🏷️ ${tx.categoryName} · ${tx.accountName}\n📝 ${tx.note}\n📅 ${dubaiTimeStr}`; await sendTelegramMessage(chatId, msg); }
async function sendTelegramMessage(chatId, text, replyMarkup = {}) { const token = process.env.TG_BOT_TOKEN; if (!token) return; const body = { chat_id: chatId, text: text, parse_mode: "HTML" }; if (replyMarkup.inline_keyboard) body.reply_markup = replyMarkup; await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
async function sendTelegramPhoto(chatId, fileId, caption, replyMarkup = {}) { const token = process.env.TG_BOT_TOKEN; if (!token) return; const body = { chat_id: chatId, photo: fileId, caption: caption, parse_mode: "HTML" }; if (replyMarkup.inline_keyboard) body.reply_markup = replyMarkup; await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
async function answerCallbackQuery(queryId, text) { const token = process.env.TG_BOT_TOKEN; await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callback_query_id: queryId, text: text }) }); }
async function editMessageCaption(chatId, messageId, caption) { const token = process.env.TG_BOT_TOKEN; await fetch(`https://api.telegram.org/bot${token}/editMessageCaption`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, message_id: messageId, caption: caption, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }) }); }
