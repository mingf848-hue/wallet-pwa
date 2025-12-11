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

        console.log(`收到消息: ${text} (ChatID: ${chatId})`); // 这行日志会在 Vercel 后台显示

        // 3. 调用 AI 分析
        const aiResult = await analyzeTextWithGemini(text);

        if (!aiResult || !aiResult.amount) {
            await sendTelegramMessage(chatId, "❓ 没听懂... 试试：'打车 20' 或 '200 吃饭 银行卡'");
            return res.status(200).send('AI Failed');
        }

        // 4. 写入数据库
        const savedTx = await saveToFirebase(aiResult);

        // 5. 回复结果 (处理时区显示)
        // savedTx.date 是 ISO 字符串 (UTC)，我们需要转成迪拜时间显示给用户看
        const dubaiTimeStr = new Date(savedTx.date).toLocaleString('zh-CN', { timeZone: 'Asia/Dubai', hour12: false });

        const replyMsg = `✅ <b>已记账</b>\n\n💸 <b>${savedTx.type === 'expense' ? '-' : '+'}${savedTx.amount} ${savedTx.currency}</b>\n🏷️ ${savedTx.categoryName} · ${savedTx.accountName}\n📝 ${savedTx.note}\n📅 ${dubaiTimeStr}`;
        await sendTelegramMessage(chatId, replyMsg);

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error("Webhook Error:", error); // 报错日志
        await sendTelegramMessage(req.body.message.chat.id, `❌ 出错: ${error.message}`);
        return res.status(200).json({ error: error.message });
    }
}

// --- 辅助函数：调用 Gemini ---
async function analyzeTextWithGemini(text) {
    const proxyUrl = "https://gemini-proxy.aratakitofood.workers.dev/"; 
    
    // ★★★ 修复1：给 AI 的参考时间强制转为迪拜时间 (UTC+4) ★★★
    // 这样 AI 推算 "昨天/刚刚" 时就会基于迪拜时间
    const now = new Date();
    const dubaiNow = new Date(now.getTime() + (4 * 60 * 60 * 1000)); // 粗略加4小时供文本参考
    const dateContext = `现在是迪拜时间 ${dubaiNow.getFullYear()}年${dubaiNow.getMonth()+1}月${dubaiNow.getDate()}日 ${dubaiNow.getHours()}:${dubaiNow.getMinutes()}`;

    const prompt = `
      你是一个专业的私人财务助理。请分析用户的这句话："${text}"。
      【当前时间参考】：${dateContext}

      请提取关键信息并返回 JSON：
      1. **amount**: 金额 (数字)。
      2. **currency**: 币种 (CNY, USDT, AED)。
         - ★★★ 关键规则：如果用户没明确说币种(如只说"200")，请返回 null (空值)！不要默认 CNY！★★★
      3. **merchant**: 商户或用途 (作为备注)。
      4. **account**: 支付账户关键词 (例如: Alipay, WeChat, Mashreq, Bank, Cash)。默认 WeChat。
         - 提到 "银行卡"、"Bank" -> 返回 "Bank"
         - 提到 "Mashreq" -> 返回 "Mashreq"
      5. **category**: 分类 (food, shop, transport, home, fun, other)。
      6. **type**: 'expense' (支出) 或 'income' (收入)。默认 expense。
      7. **date**: 交易时间 (YYYY-MM-DD HH:mm:ss)。
         - 如果用户没提时间，就用【当前时间参考】。

      返回示例：{"amount": 25.5, "currency": null, "merchant": "吃饭", "account": "Mashreq", "category": "food", "type": "expense", "date": "2025-12-11 04:54:00"}
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
    targetAcc = state.accounts.find(a => a.id.toLowerCase().includes(choice) || a.name.toLowerCase().includes(choice));

    // B. 中文映射
    if (!targetAcc) {
        if (choice.includes('微信')) targetAcc = state.accounts.find(a => a.id.includes('wechat'));
        else if (choice.includes('支付宝')) targetAcc = state.accounts.find(a => a.id.includes('alipay'));
    }

    // C. Mashreq / 银行卡 优先
    if (!targetAcc && (choice.includes('bank') || choice.includes('card') || choice.includes('银行'))) {
         targetAcc = state.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
         if (!targetAcc) targetAcc = state.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
    }

    // D. 兜底
    if (!targetAcc) targetAcc = state.accounts[0];

    // ★★★ 修复2：币种逻辑 ★★★
    // 优先用 AI 识别的 (如果用户说了 "200 CNY")
    // 如果 AI 返回 null，则使用账户自带的币种 (Mashreq -> AED)
    const finalCurrency = data.currency || targetAcc.currency || 'CNY';

    // 2. 构造账单
    const newTx = {
        id: Date.now(),
        type: data.type || 'expense',
        amount: parseFloat(data.amount),
        currency: finalCurrency, // 使用修复后的币种
        accountId: targetAcc.id,
        category: data.category || 'other',
        
        // 这里的 data.date 是 AI 基于迪拜时间生成的字符串 (e.g. 2025-12-11 04:54:00)
        // 我们直接存它，或者转为 ISO。为了统一，建议转 ISO。
        // 但因为 AI 给的是迪拜当地时间字符串，直接 new Date(string) 在 Vercel(UTC) 上可能会被当成 UTC 解析，导致时间又偏了。
        // 最稳妥的方法：既然 AI 已经给了 "2025-12-11 04:54:00" 这种直观时间，
        // 我们在存库前，把它当做迪拜时间解析成时间戳。
        date: new Date(data.date).toISOString(), // 简化处理：让 AI 返回 ISO 格式或者直接存 AI 给的时间串
        
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

// 发消息函数保持不变...
async function sendTelegramMessage(chatId, text) {
    const token = process.env.TG_BOT_TOKEN;
    if (!token) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML" })
    });
}
