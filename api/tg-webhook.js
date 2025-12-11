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

        // 处理按钮点击 (删除/查看)
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

            // ★★★ 新增：支持多关键词保存 ★★★
            // 格式：存 词1,词2,词3 回复内容
            if (caption.trim().startsWith("存 ")) {
                // 找到第一个空格的位置
                const firstSpaceIndex = caption.indexOf(" ");
                const secondSpaceIndex = caption.indexOf(" ", firstSpaceIndex + 1);
                
                if (secondSpaceIndex !== -1) {
                    const keywordsRaw = caption.substring(firstSpaceIndex + 1, secondSpaceIndex);
                    const content = caption.substring(secondSpaceIndex + 1);
                    
                    // 支持中英文逗号分割
                    const keywords = keywordsRaw.split(/[,，]/).map(k => k.trim()).filter(k => k);

                    await saveShortcut(keywords, content, fileId);
                    await sendTelegramMessage(chatId, `✅ <b>快捷回复已保存</b>\n\n🔑 触发词：${keywords.join(', ')}`);
                    return res.status(200).json({ success: true, type: 'shortcut_saved' });
                } else {
                    await sendTelegramMessage(chatId, "⚠️ 格式错误。请使用：\n<code>存 词1,词2 内容</code>");
                    return res.status(200).json({ success: false });
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

            if (text === '/setmenu') {
                await setBotCommands();
                await sendTelegramMessage(chatId, "✅ 菜单已更新");
                return res.status(200).json({ success: true });
            }

            // ★★★ 1. 优先匹配快捷回复 (支持多词) ★★★
            const shortcutSent = await handleShortcutReply(chatId, text);
            if (shortcutSent) return res.status(200).json({ success: true, type: 'shortcut_sent' });

            // 2. 搜索
            if (text.startsWith('搜') || text.startsWith('找') || text.toLowerCase().startsWith('find')) {
                const keyword = text.replace(/^(搜|找|find)\s*/i, '');
                if(keyword) await handleSearchAny(chatId, keyword);
                return res.status(200).json({ success: true });
            }
            // 3. 常用指令
            if (['清单', '列表', '/list'].includes(text)) {
                await handleListAll(chatId);
                return res.status(200).json({ success: true });
            }
            if (['撤销', 'undo'].includes(text.toLowerCase())) {
                const msg = await handleUndo();
                await sendTelegramMessage(chatId, msg);
                return res.status(200).json({ success: true });
            }

            // 4. AI 智能分析
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

// 1. 处理按钮点击 (删除/查看)
async function handleCallbackQuery(query) {
    const data = query.data; 
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    // 删除逻辑
    if (data.startsWith("del_doc_") || data.startsWith("del_short_")) {
        let collectionName = data.startsWith("del_doc_") ? 'documents' : 'shortcuts';
        let docId = data.replace(data.startsWith("del_doc_") ? "del_doc_" : "del_short_", "");
        let typeName = data.startsWith("del_doc_") ? "文档" : "快捷回复";

        await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection(collectionName).doc(docId).delete();
        await answerCallbackQuery(query.id, `🗑️ ${typeName}已删除`);
        
        const originalCaption = query.message.caption || typeName;
        await editMessageCaption(chatId, messageId, `${originalCaption}\n\n(❌ 已删除)`);
    }
    // 查看快捷回复 (支持 ID 查找)
    else if (data.startsWith("view_short_")) {
        const docId = data.replace("view_short_", "");
        const docSnap = await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('shortcuts').doc(docId).get();
        if (docSnap.exists) {
            const d = docSnap.data();
            // 兼容新旧数据结构
            const keys = d.keywords ? d.keywords.join(', ') : d.keyword; 
            await sendTelegramPhoto(chatId, d.file_id, d.content, {
                inline_keyboard: [[{ text: `🗑️ 删除 [${keys}]`, callback_data: `del_short_${doc.id}` }]]
            });
            await answerCallbackQuery(query.id, "加载成功");
        } else {
            await answerCallbackQuery(query.id, "文件不存在");
        }
    }
    // 查看文档
    else if (data.startsWith("view_doc_")) {
        const docId = data.replace("view_doc_", "");
        const docSnap = await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('documents').doc(docId).get();
        if (docSnap.exists) {
            const d = docSnap.data();
            await sendTelegramPhoto(chatId, d.file_id, `📄 ${d.title}\n📅 ${new Date(d.created_at).toLocaleDateString()}`, {
                inline_keyboard: [[{ text: "🗑️ 删除此图", callback_data: `del_doc_${docId}` }]]
            });
            await answerCallbackQuery(query.id, "加载成功");
        } else {
            await answerCallbackQuery(query.id, "文件不存在");
        }
    }
}

// ★★★ 2. 保存快捷回复 (支持多词) ★★★
async function saveShortcut(keywords, content, fileId) {
    const data = { 
        keywords: keywords, // 存数组 ['鸿蒙', 'Harmony']
        content: content, 
        file_id: fileId, 
        updated_at: new Date().toISOString() 
    };
    // 使用 add() 生成随机 ID，避免关键词冲突
    await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('shortcuts').add(data);
}

// ★★★ 3. 触发快捷回复 (支持多词匹配 + 兼容旧数据) ★★★
async function handleShortcutReply(chatId, text) {
    const shortcutsRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('shortcuts');
    
    // A. 尝试新逻辑：查询 keywords 数组包含 text 的文档
    const snapshot = await shortcutsRef.where('keywords', 'array-contains', text).limit(1).get();
    
    if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        const data = doc.data();
        await sendTelegramPhoto(chatId, data.file_id, data.content, {
             inline_keyboard: [[{ text: "🗑️ 删除此回复", callback_data: `del_short_${doc.id}` }]]
        });
        return true;
    }

    // B. 尝试兼容旧逻辑：直接查 ID (如果你之前存的是单关键词做ID)
    const oldDocSnap = await shortcutsRef.doc(text).get();
    if (oldDocSnap.exists) {
        const data = oldDocSnap.data();
        await sendTelegramPhoto(chatId, data.file_id, data.content, {
             inline_keyboard: [[{ text: "🗑️ 删除此回复", callback_data: `del_short_${text}` }]]
        });
        return true;
    }

    return false; 
}

// 4. 列出所有 (显示关键词)
async function handleListAll(chatId) {
    const rootRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
    const docsSnap = await rootRef.collection('documents').orderBy('created_at', 'desc').get();
    const shortsSnap = await rootRef.collection('shortcuts').get();

    if (docsSnap.empty && shortsSnap.empty) return await sendTelegramMessage(chatId, "📭 暂无归档。");

    const inlineKeyboard = [];
    
    // 快捷回复列表
    let row = [];
    shortsSnap.forEach(doc => {
        const d = doc.data();
        // 兼容显示：如果是数组就 join，如果是旧数据字符串就直接用
        const label = d.keywords ? d.keywords.join('/') : (d.keyword || doc.id);
        row.push({ text: `⚡ ${label}`, callback_data: `view_short_${doc.id}` });
        if (row.length === 2) { inlineKeyboard.push(row); row = []; }
    });
    if (row.length > 0) inlineKeyboard.push(row);

    // 文档列表
    docsSnap.forEach(doc => {
        const d = doc.data();
        inlineKeyboard.push([{ text: `📄 ${d.title}`, callback_data: `view_doc_${doc.id}` }]);
    });

    const totalCount = docsSnap.size + shortsSnap.size;
    await sendTelegramMessage(chatId, `📚 <b>归档清单 (共 ${totalCount} 个)</b>`, { inline_keyboard: inlineKeyboard });
}

// 5. 通用搜索
async function handleSearchAny(chatId, keyword) {
    const rootRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
    const docsSnap = await rootRef.collection('documents').orderBy('created_at', 'desc').get();
    const shortsSnap = await rootRef.collection('shortcuts').get();
    const matches = [];

    docsSnap.forEach(doc => {
        const d = doc.data();
        if (d.title.includes(keyword)) matches.push({ type: 'doc', id: doc.id, ...d });
    });

    shortsSnap.forEach(doc => {
        const d = doc.data();
        // 搜数组里有没有这个词
        const kwMatch = d.keywords && d.keywords.some(k => k.includes(keyword));
        // 兼容旧数据
        const oldKwMatch = d.keyword && d.keyword.includes(keyword);
        
        if (kwMatch || oldKwMatch || doc.id.includes(keyword) || d.content.includes(keyword)) {
            matches.push({ type: 'short', id: doc.id, ...d });
        }
    });

    if (matches.length === 0) return await sendTelegramMessage(chatId, `🔍 未找到 "${keyword}"。`);
    await sendTelegramMessage(chatId, `🔍 找到 ${matches.length} 个结果：`);
    
    for (let i = 0; i < Math.min(matches.length, 10); i++) {
        const item = matches[i];
        let caption = "", callbackData = "";
        
        if (item.type === 'doc') {
            caption = `📂 <b>文档</b>\n📄 ${item.title}\n📅 ${new Date(item.created_at).toLocaleDateString()}`;
            callbackData = `del_doc_${item.id}`;
        } else {
            const keys = item.keywords ? item.keywords.join(', ') : item.keyword;
            caption = `⚡ <b>快捷回复</b>\n🔑 ${keys}\n📝 ${item.content}`;
            callbackData = `del_short_${item.id}`;
        }

        await sendTelegramPhoto(chatId, item.file_id, caption, {
            inline_keyboard: [[{ text: "🗑️ 删除此图", callback_data: callbackData }]]
        });
    }
}

// ... (以下函数保持原样，务必保留！) ...
// saveDocument, saveReminder, saveTransaction, handleUndo, handleMonthlyReport, analyzeTextWithGemini, TG API Utils
async function saveDocument(data, fileId) { const docData = { title: data.title || '无标题', file_id: fileId, created_at: new Date().toISOString(), tags: ['quick_save'] }; const ref = await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('documents').add(docData); return ref.id; }
async function saveReminder(data, chatId) { const reminderData = { note: data.note, targetTime: data.date, chatId: chatId, status: 'pending', createdAt: new Date().toISOString() }; await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('reminders').add(reminderData); }
async function handleUndo() { const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID); const docSnap = await docRef.get(); let state = docSnap.data().state; const transactions = state.transactions || []; let targetIndex = -1; for (let i = transactions.length - 1; i >= 0; i--) { if (transactions[i].source === 'telegram_bot') { targetIndex = i; break; } } if (targetIndex === -1) return "🤷‍♂️ 无可撤销记录。"; const tx = transactions[targetIndex]; const accIndex = state.accounts.findIndex(a => a.id === tx.accountId); if (accIndex !== -1) { if (tx.type === 'expense') state.accounts[accIndex].balance += tx.amount; else state.accounts[accIndex].balance -= tx.amount; } transactions.splice(targetIndex, 1); await docRef.update({ 'state.accounts': state.accounts, 'state.transactions': state.transactions }); return `↩️ 已撤销: ${tx.note} (${tx.amount})`; }
async function handleMonthlyReport() { const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID); const docSnap = await docRef.get(); const txs = docSnap.data().state.transactions || []; const currentMonth = new Date().toISOString().slice(0, 7); let total = 0; txs.forEach(t => { if(t.date.startsWith(currentMonth) && t.type==='expense') total+=t.amount; }); return `📊 本月 (${currentMonth}) 总支出: ${total.toFixed(2)}`; }
async function analyzeTextWithGemini(text) { const proxyUrl = "https://gemini-proxy.aratakitofood.workers.dev/"; const now = new Date(); const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000); const dubaiNow = new Date(utcTime + (4 * 60 * 60 * 1000)); const dateContext = `现在是迪拜时间 ${dubaiNow.getFullYear()}年${dubaiNow.getMonth()+1}月${dubaiNow.getDate()}日 ${dubaiNow.getHours()}:${dubaiNow.getMinutes()}`; const prompt = `你是一个全能私人助理。请分析用户指令："${text}"。 【当前时间参考】：${dateContext} 请判断用户意图： 【A. 提醒 (必须包含 "提醒"、"记得")】 返回 JSON: { "type": "reminder", "note": "内容", "date": "YYYY-MM-DD HH:mm:ss" } 【B. 记账 (关键词：买、花、付、收、打车)】 返回 JSON: { "type": "transaction", "amount": 数字, "currency": "CNY/USDT/AED/null", "merchant": "备注", "account": "WeChat/Alipay/Bank/Cash/Mashreq", "category": "food/shop/transport...", "tx_type": "expense/income", "date": "YYYY-MM-DD HH:mm:ss" } ★ 规则：没说币种currency=null；买/花->expense；收/退->income。默认expense。 只返回纯 JSON。`; try { const res = await fetch(proxyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }); const json = await res.json(); const raw = json.candidates[0].content.parts[0].text; let result = JSON.parse(raw.replace(/```json/g, '').replace(/```/g, '').trim()); if (result.date) { try { const dateStr = result.date.replace(' ', 'T'); if (!dateStr.includes('+') && !dateStr.endsWith('Z')) result.date = new Date(`${dateStr}+04:00`).toISOString(); else result.date = new Date(dateStr).toISOString(); } catch(e) { result.date = new Date().toISOString(); } } return result; } catch(e) { return null; } }
async function saveTransaction(data, senderName) { const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID); const docSnap = await docRef.get(); let state = docSnap.data().state; let targetAcc = null; const choice = (data.account || data.platform || '').toLowerCase(); targetAcc = state.accounts.find(a => a.id.toLowerCase().includes(choice) || a.name.toLowerCase().includes(choice)); if (!targetAcc) { if (choice.includes('微信')) targetAcc = state.accounts.find(a => a.id.includes('wechat')); else if (choice.includes('支付宝')) targetAcc = state.accounts.find(a => a.id.includes('alipay')); } if (!targetAcc) { if (choice.includes('cash') || choice.includes('现金')) targetAcc = state.accounts.find(a => a.name.includes('现金') || a.id === 'cash'); else if (choice.includes('bank') || choice.includes('card') || choice.includes('银行')) { targetAcc = state.accounts.find(a => a.name.toLowerCase().includes('mashreq')); if (!targetAcc) targetAcc = state.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank')); } } if (!targetAcc) targetAcc = state.accounts[0]; const finalCurrency = data.currency ? data.currency : targetAcc.currency; const type = data.tx_type || 'expense'; const newTx = { id: Date.now(), type: type, amount: parseFloat(data.amount), currency: finalCurrency, accountId: targetAcc.id, category: data.category || 'other', date: data.date, note: data.merchant || 'Bot记账', source: 'telegram_bot' }; const accIndex = state.accounts.findIndex(a => a.id === targetAcc.id); if (accIndex !== -1) { if (newTx.type === 'expense') state.accounts[accIndex].balance -= newTx.amount; else state.accounts[accIndex].balance += newTx.amount; } state.transactions.push(newTx); await docRef.update({ 'state.accounts': state.accounts, 'state.transactions': state.transactions, 'updatedAt': new Date() }); return { ...newTx, accountName: targetAcc.name, categoryName: data.category }; }
async function getTelegramFileUrl(fileId) { const token = process.env.TG_BOT_TOKEN; const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`); const json = await res.json(); return json.ok ? `https://api.telegram.org/file/bot${token}/${json.result.file_path}` : null; }
async function downloadImageAsBase64(url) { const res = await fetch(url); const buf = await res.arrayBuffer(); return Buffer.from(buf).toString('base64'); }
async function sendSuccessReply(chatId, tx, title) { const dubaiTimeStr = new Date(tx.date).toLocaleString('zh-CN', { timeZone: 'Asia/Dubai', hour12: false }); const msg = `${title}\n\n💸 <b>${tx.type==='expense'?'-':'+'}${tx.amount} ${tx.currency}</b>\n🏷️ ${tx.categoryName} · ${tx.accountName}\n📝 ${tx.note}\n📅 ${dubaiTimeStr}`; await sendTelegramMessage(chatId, msg); }
async function setBotCommands() { const token = process.env.TG_BOT_TOKEN; const commands = [ { command: "list", description: "📂 归档图库 & 快捷回复" }, { command: "report", description: "📊 本月支出统计" }, { command: "undo", description: "↩️ 撤销上一笔记账" }, { command: "help", description: "🛠 使用帮助" } ]; await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commands: commands }) }); }
async function sendTelegramMessage(chatId, text, replyMarkup = {}) { const token = process.env.TG_BOT_TOKEN; if (!token) return; const body = { chat_id: chatId, text: text, parse_mode: "HTML" }; if (replyMarkup.inline_keyboard) body.reply_markup = replyMarkup; await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
async function sendTelegramPhoto(chatId, fileId, caption, replyMarkup = {}) { const token = process.env.TG_BOT_TOKEN; if (!token) return; const body = { chat_id: chatId, photo: fileId, caption: caption, parse_mode: "HTML" }; if (replyMarkup.inline_keyboard) body.reply_markup = replyMarkup; await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
async function answerCallbackQuery(queryId, text) { const token = process.env.TG_BOT_TOKEN; await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callback_query_id: queryId, text: text }) }); }
async function editMessageCaption(chatId, messageId, caption) { const token = process.env.TG_BOT_TOKEN; await fetch(`https://api.telegram.org/bot${token}/editMessageCaption`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, message_id: messageId, caption: caption, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }) }); }
