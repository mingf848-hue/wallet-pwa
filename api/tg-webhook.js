import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// 1. 初始化 Firebase (防止冷启动报错)
if (getApps().length === 0) {
    // 从环境变量读取你的 Firebase 私钥
    const serviceAccount = JSON.parse(process.env.BITLEDGER_KEY);
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();
// 你的记账本主文档 ID
const GLOBAL_WALLET_DOC_ID = 'my_personal_wallet_v2';

export default async function handler(req, res) {
    // 只有 POST 请求才处理，其他忽略
    if (req.method !== 'POST') return res.status(200).send('OK');

    try {
        const update = req.body;

        // ★★★ 1. 处理按钮点击事件 (点击删除/查看按钮时触发) ★★★
        if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
            // 处理完按钮点击，直接返回
            return res.status(200).json({ success: true, type: 'button_click' });
        }

        // 如果不是消息也不是按钮点击，忽略
        if (!update.message) return res.status(200).json({ status: 'ignored' });

        const chatId = String(update.message.chat.id);
        const senderName = update.message.from.first_name || "User";
        
        // 2. 身份鉴权 (只允许你和你设置的白名单用户)
        const adminId = String(process.env.TG_CHAT_ID); 
        const whitelist = (process.env.TG_WHITELIST || "").split(",").map(id => id.trim());
        const isAllowed = (chatId === adminId) || whitelist.includes(chatId);

        if (!isAllowed) {
            await sendTelegramMessage(chatId, "🚫 未授权用户，无法使用。");
            return res.status(200).send('Unauthorized');
        }

        // --- 3. 消息路由分发 ---

        // A. 图片消息处理 (存图 / 存快捷回复)
        if (update.message.photo) {
            // 获取最大尺寸的图片
            const photo = update.message.photo[update.message.photo.length - 1]; 
            const fileId = photo.file_id;
            const caption = update.message.caption || ""; // 图片的附言

            // A1. 设置快捷回复 (格式: 存 词1,词2 回复内容)
            if (caption.trim().startsWith("存 ")) {
                const parts = caption.trim().split(" ");
                if (parts.length >= 2) {
                    // 解析关键词和内容
                    // 逻辑：找到第一个空格后的部分作为关键词，再找到下一个空格后的作为内容
                    // 但为了简单，我们假设格式是：存 关键字... 内容...
                    // 更好的分割方式：
                    const firstSpace = caption.indexOf(" ");
                    const secondSpace = caption.indexOf(" ", firstSpace + 1);
                    
                    let keywordsRaw = "";
                    let content = "";

                    if (secondSpace !== -1) {
                        keywordsRaw = caption.substring(firstSpace + 1, secondSpace);
                        content = caption.substring(secondSpace + 1);
                    } else {
                        // 只有关键字，没有内容的情况
                        keywordsRaw = caption.substring(firstSpace + 1);
                        content = " "; // 空内容
                    }
                    
                    // 支持中文逗号和英文逗号
                    const keywords = keywordsRaw.split(/[,，]/).map(k => k.trim()).filter(k => k);

                    await saveShortcut(keywords, content, fileId);
                    await sendTelegramMessage(chatId, `✅ <b>快捷回复已保存</b>\n\n🔑 触发词：${keywords.join(', ')}`);
                    return res.status(200).json({ success: true, type: 'shortcut_saved' });
                }
            }

            // A2. 直接归档 (存入文档库，并附带删除按钮)
            const docTitle = caption.trim() || `图片 ${new Date().toLocaleDateString()}`;
            // 保存并获取文档 ID
            const docId = await saveDocument({ title: docTitle }, fileId);
            
            // 发送带按钮的消息
            await sendTelegramPhoto(chatId, fileId, `📂 <b>已归档</b>\n📄 ${docTitle}`, {
                inline_keyboard: [[{ text: "🗑️ 删除此图", callback_data: `del_doc_${docId}` }]]
            });
            return res.status(200).json({ success: true, type: 'photo_saved' });
        }

        // B. 文本消息处理 (指令 / 快捷回复 / 记账 / 提醒)
        if (update.message.text) {
            const text = update.message.text.trim();

            // B0. 设置菜单指令
            if (text === '/setmenu') {
                await setBotCommands();
                await sendTelegramMessage(chatId, "✅ 菜单已更新，请重启 Telegram 查看。");
                return res.status(200).json({ success: true });
            }

            // B1. 优先检查是否是快捷回复 (完全匹配)
            const shortcutSent = await handleShortcutReply(chatId, text);
            if (shortcutSent) return res.status(200).json({ success: true, type: 'shortcut_sent' });

            // B2. 搜索指令 (格式: 搜/找 关键字)
            if (text.startsWith('搜') || text.startsWith('找') || text.toLowerCase().startsWith('find')) {
                const keyword = text.replace(/^(搜|找|find)\s*/i, '');
                if(keyword) await handleSearchAny(chatId, keyword);
                return res.status(200).json({ success: true, type: 'search' });
            }
            
            // B3. 删除指令 (格式: 删 关键字) - 可选，文字版删除
            if (text.startsWith('删') || text.toLowerCase().startsWith('del')) {
                const keyword = text.replace(/^(删|删除|del)\s*/i, '');
                if(keyword) {
                    await sendTelegramMessage(chatId, `💡 建议使用 "搜 ${keyword}" 找到图片后，点击下方的 [🗑️ 删除] 按钮进行删除，防止误删。`);
                }
                return res.status(200).json({ success: true });
            }

            // B4. 常用功能指令
            // 清单
            if (['清单', '列表', '/list'].includes(text)) {
                await handleListAll(chatId);
                return res.status(200).json({ success: true, type: 'list' });
            }
            // 撤销
            if (['撤销', 'undo', '/undo', '后悔'].includes(text.toLowerCase())) {
                const msg = await handleUndo();
                await sendTelegramMessage(chatId, msg);
                return res.status(200).json({ success: true, type: 'undo' });
            }
            // 统计
            if (['统计', '本月', '查账'].includes(text)) {
                const msg = await handleMonthlyReport();
                await sendTelegramMessage(chatId, msg);
                return res.status(200).json({ success: true, type: 'report' });
            }

            // B5. AI 智能分析 (记账 或 提醒)
            const aiResult = await analyzeTextWithGemini(text);

            if (!aiResult) {
                // 如果 AI 返回 null，说明既不是记账也不是提醒
                await sendTelegramMessage(chatId, "❓ 没听懂。请使用标准指令：\n• 记账: '午饭 20'\n• 提醒: '明天提醒我开会'\n• 存图: 发送图片并附言 '存 关键字'");
            } 
            // 分支 1: 提醒事项
            else if (aiResult.type === 'reminder') {
                await saveReminder(aiResult, chatId);
                let timeDisplay = "时间未知";
                try { 
                    timeDisplay = new Date(aiResult.date).toLocaleString('zh-CN', { timeZone: 'Asia/Dubai', hour12: false }); 
                } catch(e) {}
                await sendTelegramMessage(chatId, `⏰ <b>已设置提醒</b>\n\n📝 ${aiResult.note}\n📅 ${timeDisplay}`);
            } 
            // 分支 2: 记账
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

// 1. 处理按钮点击 (删除文档或快捷回复 / 查看内容)
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
        
        // 更新消息，去掉按钮，加上(已删除)
        const originalCaption = query.message.caption || typeName;
        await editMessageCaption(chatId, messageId, `${originalCaption}\n\n(❌ 已删除)`);
    }
    // B. 查看文档详情 (点击清单按钮)
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
    // C. 查看快捷回复 (点击清单按钮)
    else if (data.startsWith("view_short_")) {
        const docId = data.replace("view_short_", "");
        const docSnap = await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('shortcuts').doc(docId).get();
        if (docSnap.exists) {
            const d = docSnap.data();
            const keys = d.keywords ? d.keywords.join(', ') : d.keyword;
            await sendTelegramPhoto(chatId, d.file_id, d.content, {
                inline_keyboard: [[{ text: `🗑️ 删除 [${keys}]`, callback_data: `del_short_${docId}` }]]
            });
            await answerCallbackQuery(query.id, "加载成功");
        } else {
            await answerCallbackQuery(query.id, "文件不存在");
        }
    }
}

// 2. 通用搜索 (同时搜文档和快捷回复)
async function handleSearchAny(chatId, keyword) {
    const rootRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
    const docsSnap = await rootRef.collection('documents').orderBy('created_at', 'desc').get();
    const shortsSnap = await rootRef.collection('shortcuts').get();

    const matches = [];

    // 过滤文档
    docsSnap.forEach(doc => {
        const d = doc.data();
        if (d.title.includes(keyword) || (d.tags && d.tags.some(t => t.includes(keyword)))) {
            matches.push({ type: 'doc', id: doc.id, ...d });
        }
    });

    // 过滤快捷回复
    shortsSnap.forEach(doc => {
        const d = doc.data();
        // 检查关键字数组或内容
        const kwMatch = d.keywords && d.keywords.some(k => k.includes(keyword));
        const oldKwMatch = d.keyword && d.keyword.includes(keyword); // 兼容旧数据
        
        if (kwMatch || oldKwMatch || d.content.includes(keyword)) {
            matches.push({ type: 'short', id: doc.id, ...d });
        }
    });

    if (matches.length === 0) return await sendTelegramMessage(chatId, `🔍 未找到 "${keyword}"。`);

    await sendTelegramMessage(chatId, `🔍 找到 ${matches.length} 个结果：`);

    // 限制一次发10张
    const limit = 10;
    for (let i = 0; i < Math.min(matches.length, limit); i++) {
        const item = matches[i];
        let caption = "", callbackData = "";
        
        if (item.type === 'doc') {
            caption = `📂 <b>文档</b>\n📄 ${item.title}\n📅 ${new Date(item.created_at).toLocaleDateString()}`;
            callbackData = `del_doc_${item.id}`;
        } else {
            const keys = item.keywords ? item.keywords.join(', ') : item.keyword;
            caption = `⚡ <b>快捷回复</b>\n🔑 触发词：${keys}\n📝 ${item.content}`;
            callbackData = `del_short_${item.id}`;
        }

        await sendTelegramPhoto(chatId, item.file_id, caption, {
            inline_keyboard: [[{ text: "🗑️ 删除此图", callback_data: callbackData }]]
        });
    }
}

// 3. 保存文档 (返回 ID)
async function saveDocument(data, fileId) {
    const docData = {
        title: data.title || '无标题',
        file_id: fileId,
        created_at: new Date().toISOString(),
        tags: ['quick_save']
    };
    const ref = await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('documents').add(docData);
    return ref.id;
}

// 4. 保存快捷回复 (支持多关键词)
async function saveShortcut(keywords, content, fileId) {
    const data = { 
        keywords: Array.isArray(keywords) ? keywords : [keywords], 
        content: content, 
        file_id: fileId, 
        updated_at: new Date().toISOString() 
    };
    // 使用 add() 自动生成 ID，不覆盖旧的
    await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('shortcuts').add(data);
}

// 5. 触发快捷回复 (精确匹配)
async function handleShortcutReply(chatId, text) {
    const shortcutsRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('shortcuts');
    
    // A. 查新数据结构 (keywords 数组)
    const snapshot = await shortcutsRef.where('keywords', 'array-contains', text).limit(1).get();
    
    if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        const data = doc.data();
        await sendTelegramPhoto(chatId, data.file_id, data.content, {
             inline_keyboard: [[{ text: "🗑️ 删除此回复", callback_data: `del_short_${doc.id}` }]]
        });
        return true; 
    }

    // B. 查旧数据结构 (doc ID 即关键词) - 兼容性代码
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

// 6. 列出清单 (所有图片)
async function handleListAll(chatId) {
    const rootRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
    const docsSnap = await rootRef.collection('documents').orderBy('created_at', 'desc').get();
    const shortsSnap = await rootRef.collection('shortcuts').get();

    if (docsSnap.empty && shortsSnap.empty) return await sendTelegramMessage(chatId, "📭 暂无归档。");

    const inlineKeyboard = [];

    // 快捷回复按钮 (带⚡)
    let row = [];
    shortsSnap.forEach(doc => {
        const d = doc.data();
        const label = d.keywords ? d.keywords.join('/') : (d.keyword || doc.id);
        row.push({ text: `⚡ ${label}`, callback_data: `view_short_${doc.id}` });
        if (row.length === 2) { inlineKeyboard.push(row); row = []; }
    });
    if (row.length > 0) inlineKeyboard.push(row);

    // 文档按钮 (带📄)
    docsSnap.forEach(doc => {
        const d = doc.data();
        inlineKeyboard.push([{ text: `📄 ${d.title}`, callback_data: `view_doc_${doc.id}` }]);
    });

    const totalCount = docsSnap.size + shortsSnap.size;
    await sendTelegramMessage(chatId, `📚 <b>归档清单 (共 ${totalCount} 个)</b>`, { inline_keyboard: inlineKeyboard });
}

// ★★★ 7. AI 文本分析 (严防幻觉版) ★★★
async function analyzeTextWithGemini(text) {
    const proxyUrl = "https://gemini-proxy.aratakitofood.workers.dev/"; 
    const now = new Date();
    // 强制使用迪拜时间做参考
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000); 
    const dubaiNow = new Date(utcTime + (4 * 60 * 60 * 1000));
    const dateContext = `现在是迪拜时间 ${dubaiNow.getFullYear()}年${dubaiNow.getMonth()+1}月${dubaiNow.getDate()}日 ${dubaiNow.getHours()}:${dubaiNow.getMinutes()}`;

    const prompt = `
      你是一个严谨的私人助理。请分析用户指令："${text}"。
      【当前时间参考】：${dateContext}

      请判断用户意图，必须严格符合以下 A 或 B 之一，**否则直接返回 null**：

      【A. 提醒】
      ★ 严格规则：指令必须包含 "提醒"、"remember"、"remind"、"叫我" 其中的至少一个词。
      ★ 只有时间（如"明天"）不算提醒。
      返回 JSON: { "type": "reminder", "note": "内容", "date": "YYYY-MM-DD HH:mm:ss" }

      【B. 记账】
      ★ 严格规则：指令必须包含【数字金额】！没有金额绝对不是记账。
      返回 JSON:
      {
        "type": "transaction",
        "amount": 数字,
        "currency": "CNY/USDT/AED/null",
        "merchant": "备注",
        "account": "WeChat/Alipay/Bank/Cash/Mashreq",
        "category": "food/shop/transport...",
        "tx_type": "expense" 或 "income",
        "date": "YYYY-MM-DD HH:mm:ss"
      }
      
      ★ 重要：如果既没有"提醒"关键词，也没有"数字金额"，请直接返回 null (空值)！不要强行解释。比如用户发 "鸿蒙6.0"，没有提醒词也没有交易含义，应返回 null。

      只返回纯 JSON。
    `;

    try {
        const res = await fetch(proxyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
        const json = await res.json();
        const raw = json.candidates[0].content.parts[0].text;
        
        // 检查 null
        if (raw.trim() === 'null' || raw.includes('null')) return null;

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

    // 账户匹配
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

// 9. 保存提醒
async function saveReminder(data, chatId) {
    const reminderData = { note: data.note, targetTime: data.date, chatId: chatId, status: 'pending', createdAt: new Date().toISOString() };
    await db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('reminders').add(reminderData);
}

// 10. 撤销逻辑
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

// 11. 统计报告
async function handleMonthlyReport() {
    const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
    const docSnap = await docRef.get();
    const txs = docSnap.data().state.transactions || [];
    const currentMonth = new Date().toISOString().slice(0, 7); 
    let total = 0;
    txs.forEach(t => { if(t.date.startsWith(currentMonth) && t.type==='expense') total+=t.amount; });
    return `📊 本月 (${currentMonth}) 总支出: ${total.toFixed(2)}`;
}

// 12. 设置机器人菜单
async function setBotCommands() {
    const token = process.env.TG_BOT_TOKEN;
    const commands = [
        { command: "list", description: "📂 归档图库 & 快捷回复" },
        { command: "report", description: "📊 本月支出统计" },
        { command: "undo", description: "↩️ 撤销上一笔记账" },
        { command: "help", description: "🛠 使用帮助" }
    ];
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands: commands })
    });
}

// --- TG API 工具 ---
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
async function sendTelegramMessage(chatId, text, replyMarkup = {}) {
    const token = process.env.TG_BOT_TOKEN;
    if (!token) return;
    const body = { chat_id: chatId, text: text, parse_mode: "HTML" };
    if (replyMarkup.inline_keyboard) body.reply_markup = replyMarkup;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
}
async function sendTelegramPhoto(chatId, fileId, caption, replyMarkup = {}) {
    const token = process.env.TG_BOT_TOKEN;
    if (!token) return;
    const body = { chat_id: chatId, photo: fileId, caption: caption, parse_mode: "HTML" };
    if (replyMarkup.inline_keyboard) body.reply_markup = replyMarkup;
    await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
}
async function answerCallbackQuery(queryId, text) {
    const token = process.env.TG_BOT_TOKEN;
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: queryId, text: text })
    });
}
async function editMessageCaption(chatId, messageId, caption) {
    const token = process.env.TG_BOT_TOKEN;
    await fetch(`https://api.telegram.org/bot${token}/editMessageCaption`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, caption: caption, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } })
    });
}
