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
    // 只允许 POST
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        // 1. 安全校验 (URL 参数带 key)
        const { key } = req.query;
        // ★ 请把 '123456' 改成你自己设置的密码，防止别人乱调你的接口
        if (key !== '123456') {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // 2. 接收数据
        // 我们约定 iOS 快捷指令发来标准的 JSON: { "merchant": "商户名", "amount": 100.50 }
        const { merchant, amount, account, date } = req.body;

        if (!merchant || !amount) {
            return res.status(400).json({ error: 'Missing merchant or amount' });
        }

        // 3. 读取数据库
        const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
        const docSnap = await docRef.get();
        let state = docSnap.exists ? docSnap.data().state : { accounts: [], transactions: [] };

        // 4. 匹配账户 (默认 Mashreq)
        // 如果快捷指令没传 account，默认就当是 Mashreq 银行卡
        let targetAccName = account || 'Mashreq';
        let targetAcc = state.accounts.find(a => 
            a.name.toLowerCase().includes(targetAccName.toLowerCase()) || 
            a.id.toLowerCase().includes(targetAccName.toLowerCase())
        );
        
        // 兜底：如果找不到，就用第一个账户
        if (!targetAcc) targetAcc = state.accounts[0];

        // 5. 构造交易数据
        const numAmount = parseFloat(amount);
        const newTx = {
            id: Date.now(),
            type: 'expense', // 短信记账默认为支出
            amount: numAmount,
            currency: targetAcc.currency || 'AED', // 默认 AED
            accountId: targetAcc.id,
            category: 'other', // 默认分类，你可以改为 'shop' 或其他
            date: date || new Date().toISOString(),
            merchant: merchant,
            note: 'Apple Pay 自动记账',
            source: 'ios_shortcut'
        };

        // 6. 更新余额
        const accIndex = state.accounts.findIndex(a => a.id === targetAcc.id);
        if (accIndex !== -1) {
            state.accounts[accIndex].balance -= numAmount;
        }
        state.transactions.push(newTx);

        // 7. 保存到数据库
        await docRef.update({
            'state.accounts': state.accounts,
            'state.transactions': state.transactions,
            'updatedAt': new Date()
        });

        // 8. 发送静默通知 (Telegram)
        // disable_notification: true -> 手机不会响，只有红点
        await sendSilentTelegram(
            `💸 <b>自动记账成功</b>\n` +
            `➖ ${numAmount} ${newTx.currency}\n` +
            `📍 ${merchant}\n` +
            `💳 ${targetAcc.name}`
        );

        return res.status(200).json({ success: true, id: newTx.id });

    } catch (error) {
        console.error("SMS API Error:", error);
        return res.status(500).json({ error: error.message });
    }
}

// 辅助函数：发送静默消息
async function sendSilentTelegram(text) {
    const token = process.env.TG_BOT_TOKEN;
    const chatId = process.env.TG_CHAT_ID;
    if (!token || !chatId) return;

    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: "HTML",
                disable_notification: true // ★ 关键：静默发送
            })
        });
    } catch (e) {
        console.error("TG Send Failed", e);
    }
}
