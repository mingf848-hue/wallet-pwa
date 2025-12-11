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

        // ★★★ 新增：处理按钮点击事件 (Callback Query) ★★★
        if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
            return res.status(200).json({ success: true, type: 'button_click' });
        }

        // 普通消息处理
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

        // A. 图片处理 (存图)
        if (update.message.photo) {
            const photo = update.message.photo[update.message.photo.length - 1]; 
            const fileId = photo.file_id;
            const caption = update.message.caption || ""; 

            // 快捷回复保存
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
            // 存入数据库并获取文档ID
            const docId = await saveDocument({ title: docTitle }, fileId);
            
            // 发送带删除按钮的消息
            await sendTelegramMessage(chatId, `📂 <b>已归档</b>\n\n📄 标题：${docTitle}`, {
                inline_keyboard: [[{ text: "🗑️ 删除此图", callback_data: `del_doc_${docId}` }]]
            });
            return res.status(200).json({ success: true });
        }

        // B. 文本处理
        if (update.message.text) {
            const text = update.message.text.trim();

            // 1. 优先匹配快捷回复
            const shortcutSent = await handleShortcutReply(chatId, text);
            if (shortcutSent) return res.status(200).json({ success: true });

            // 2. 搜索指令 (带删除按钮)
            if (text.startsWith('搜') || text.startsWith('找')) {
                const keyword = text.replace(/^(搜|找)\s*/, '');
                if(keyword) await handleSearchDocument(chatId, keyword);
                return res.status(200).json({ success: true });
            }

            // 3. 撤销/统计
            if (['撤销', 'undo'].includes(text.toLowerCase())) {
                const msg = await handleUndo();
                await sendTelegramMessage(chatId, msg);
                return res.status(200).json({ success: true });
            }
            if (['统计', '本月'].includes(text)) {
                // (此处可保留统计逻辑)
            }

            // 4. AI 记账/提醒
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

// ★★★ 1. 处理按钮点击 (新增) ★★★
async function handleCallbackQuery(query) {
    const data = query.data; // 例如 "del_doc_12345abc"
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    if (data.startsWith("del_doc_")) {
        const docId = data.replace("del_doc_", "");
        
        // 1. 从 Firebase 删除
        await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('documents').doc(docId).delete();
        
        // 2. 通知 Telegram 弹窗提示
        await answerCallbackQuery(query.id, "🗑️ 文档已删除");
        
        // 3. 更新原消息，去掉按钮，加上删除标记
        // 如果原消息是文字提示：
        if (query.message.text) {
             await editMessageText(chatId, messageId, `${query.message.text}\n\n(❌ 已删除)`);
        } 
        // 如果原消息是图片 (搜图出来的)：
        else if (query.message.caption) {
             await editMessageCaption(chatId, messageId, `${query.message.caption}\n\n(❌ 已删除)`);
        }
    }
}

// 2. 搜索文档 (发送带按钮的图片)
async function handleSearchDocument(chatId, keyword) {
    const docsRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('documents');
    const snapshot = await docsRef.orderBy('created_at', 'desc').get();
    
    if (snapshot.empty) return await sendTelegramMessage(chatId, "📭 暂无归档。");

    const matches = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        if (d.title.includes(keyword)) matches.push({ id: doc.id, ...d });
    });

    if (matches.length === 0) return await sendTelegramMessage(chatId, `🔍 未找到 "${keyword}"。`);

    await sendTelegramMessage(chatId, `🔍 找到 ${matches.length} 个结果：`);

    for (const doc of matches) {
        // ★ 发送图片时带上删除按钮
        await sendTelegramPhoto(chatId, doc.file_id, `📄 ${doc.title}\n📅 ${new Date(doc.created_at).toLocaleDateString()}`, {
            inline_keyboard: [[{ text: "🗑️ 删除此图", callback_data: `del_doc_${doc.id}` }]]
        });
    }
}

// 3. 保存文档 (返回 ID 用于按钮)
async function saveDocument(data, fileId) {
    const docData = {
        title: data.title || '无标题',
        file_id: fileId,
        created_at: new Date().toISOString()
    };
    const ref = await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('documents').add(docData);
    return ref.id; // 返回文档 ID
}

// 4. AI 文本分析 (★修复记账方向★)
async function analyzeTextWithGemini(text) {
    const proxyUrl = "https://gemini-proxy.aratakitofood.workers.dev/"; 
    const now = new Date();
    // 强制使用迪拜时间
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000); 
    const dubaiNow = new Date(utcTime + (4 * 60 * 60 * 1000));
    const dateContext = `现在是迪拜时间 ${dubaiNow.getFullYear()}年${dubaiNow.getMonth()+1}月${dubaiNow.getDate()}日 ${dubaiNow.getHours()}:${dubaiNow.getMinutes()}`;

    const prompt = `
      你是一个全能私人助理。请分析用户指令："${text}"。
      【当前时间参考】：${dateContext}

      请判断用户意图是【记账】还是【提醒】：

      【A. 提醒 (关键词：提醒、记得)】
      返回 JSON: { "type": "reminder", "note": "内容", "date": "YYYY-MM-DD HH:mm:ss" }

      【B. 记账 (关键词：买、花、付、收、打车)】
      返回 JSON:
      {
        "type": "transaction",
        "amount": 数字 (必须为正数),
        "currency": "CNY/USDT/AED/null",
        "merchant": "备注",
        "account": "WeChat/Alipay/Bank/Cash/Mashreq",
        "category": "food/shop...",
        "tx_type": "expense" 或 "income",
        "date": "YYYY-MM-DD HH:mm:ss"
      }
      
      ★ 重要规则：
      1. 含有 "买"、"花"、"付"、"消费"、"打车" -> tx_type: 'expense' (支出)
      2. 含有 "收"、"入账"、"退款"、"工资" -> tx_type: 'income' (收入)
      3. 默认是 'expense'。

      只返回纯 JSON。
    `;

    try {
        const res = await fetch(proxyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
        const json = await res.json();
        const raw = json.candidates[0].content.parts[0].text;
        let result = JSON.parse(raw.replace(/```json/g, '').replace(/```/g, '').trim());

        // 时间处理
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

// 5. 记账入库 (读取 tx_type)
async function saveTransaction(data, senderName) {
    const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
    const docSnap = await docRef.get();
    let state = docSnap.data().state;

    // ... (账户匹配逻辑保持不变，略去以节省篇幅，请保留之前的匹配代码) ...
    let targetAcc = null;
    const choice = (data.account || '').toLowerCase();
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

    // ★ 使用 AI 返回的 tx_type，默认为 expense
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
        // ★ 根据类型加减余额 ★
        if (newTx.type === 'expense') state.accounts[accIndex].balance -= newTx.amount;
        else state.accounts[accIndex].balance += newTx.amount;
    }
    state.transactions.push(newTx);
    await docRef.update({ 'state.accounts': state.accounts, 'state.transactions': state.transactions, 'updatedAt': new Date() });
    return { ...newTx, accountName: targetAcc.name, categoryName: data.category };
}

// ... (辅助函数：saveReminder, saveShortcut, handleShortcutReply, handleUndo, handleMonthlyReport 等保持不变) ...
// 请务必把这些函数也放进来，或者只替换上面的 handler, saveTransaction, analyzeTextWithGemini 和 新增的 handleCallbackQuery

// 6. TG API 封装 (新增键盘支持)
async function sendTelegramMessage(chatId, text, replyMarkup = {}) {
    const token = process.env.TG_BOT_TOKEN;
    if (!token) return;
    const body = { chat_id: chatId, text: text, parse_mode: "HTML" };
    if (replyMarkup.inline_keyboard) body.reply_markup = replyMarkup;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

async function sendTelegramPhoto(chatId, fileId, caption, replyMarkup = {}) {
    const token = process.env.TG_BOT_TOKEN;
    if (!token) return;
    const body = { chat_id: chatId, photo: fileId, caption: caption, parse_mode: "HTML" };
    if (replyMarkup.inline_keyboard) body.reply_markup = replyMarkup;

    await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

// 回应 Callback (消除按钮 loading 状态)
async function answerCallbackQuery(queryId, text) {
    const token = process.env.TG_BOT_TOKEN;
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: queryId, text: text })
    });
}

// 编辑消息文本
async function editMessageText(chatId, messageId, text) {
    const token = process.env.TG_BOT_TOKEN;
    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: text, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }) // 清空按钮
    });
}

// 编辑图片说明
async function editMessageCaption(chatId, messageId, caption) {
    const token = process.env.TG_BOT_TOKEN;
    await fetch(`https://api.telegram.org/bot${token}/editMessageCaption`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, caption: caption, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }) // 清空按钮
    });
}

// (其余 getTelegramFileUrl, downloadImageAsBase64, handleUndo, handleMonthlyReport, saveReminder, saveShortcut, handleShortcutReply 请务必保留)
// 为了代码完整性，请确保这些 helper function 在文件底部
async function getTelegramFileUrl(fileId) { /* ...同前... */ const token = process.env.TG_BOT_TOKEN; const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`); const json = await res.json(); return json.ok ? `https://api.telegram.org/file/bot${token}/${json.result.file_path}` : null; }
async function downloadImageAsBase64(url) { /* ...同前... */ const res = await fetch(url); const buf = await res.arrayBuffer(); return Buffer.from(buf).toString('base64'); }
async function saveShortcut(keyword, content, fileId) { /* ...同前... */ const data = { keyword, content, file_id: fileId, updated_at: new Date().toISOString() }; await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('shortcuts').doc(keyword).set(data); }
async function handleShortcutReply(chatId, text) { /* ...同前... */ const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('shortcuts').doc(text); const docSnap = await docRef.get(); if (docSnap.exists) { const data = docSnap.data(); await sendTelegramPhoto(chatId, data.file_id, data.content); return true; } return false; }
async function saveReminder(data, chatId) { /* ...同前... */ const reminderData = { note: data.note, targetTime: data.date, chatId: chatId, status: 'pending', createdAt: new Date().toISOString() }; await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('reminders').add(reminderData); }
async function handleUndo() { /* ...同前... */ const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID); const docSnap = await docRef.get(); let state = docSnap.data().state; const transactions = state.transactions || []; let targetIndex = -1; for (let i = transactions.length - 1; i >= 0; i--) { if (transactions[i].source === 'telegram_bot') { targetIndex = i; break; } } if (targetIndex === -1) return "🤷‍♂️ 无可撤销记录。"; const tx = transactions[targetIndex]; const accIndex = state.accounts.findIndex(a => a.id === tx.accountId); if (accIndex !== -1) { if (tx.type === 'expense') state.accounts[accIndex].balance += tx.amount; else state.accounts[accIndex].balance -= tx.amount; } transactions.splice(targetIndex, 1); await docRef.update({ 'state.accounts': state.accounts, 'state.transactions': state.transactions }); return `↩️ 已撤销: ${tx.note} (${tx.amount})`; }
async function handleMonthlyReport() { /* ...同前... */ const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID); const docSnap = await docRef.get(); const txs = docSnap.data().state.transactions || []; const currentMonth = new Date().toISOString().slice(0, 7); let total = 0; txs.forEach(t => { if(t.date.startsWith(currentMonth) && t.type==='expense') total+=t.amount; }); return `📊 本月 (${currentMonth}) 总支出: ${total.toFixed(2)}`; }
async function sendSuccessReply(chatId, tx, title) { /* ...同前... */ const dubaiTimeStr = new Date(tx.date).toLocaleString('zh-CN', { timeZone: 'Asia/Dubai', hour12: false }); const msg = `${title}\n\n💸 <b>${tx.type==='expense'?'-':'+'}${tx.amount} ${tx.currency}</b>\n🏷️ ${tx.categoryName} · ${tx.accountName}\n📝 ${tx.note}\n📅 ${dubaiTimeStr}`; await sendTelegramMessage(chatId, msg); }
