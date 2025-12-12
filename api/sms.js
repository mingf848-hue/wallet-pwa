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
        // 1. 安全校验
        const { key } = req.query;
        if (key !== '123456') { // ★ 记得改成你的密码
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // 2. 接收数据
        const { merchant, amount, account, date } = req.body;

        if (!merchant || !amount) {
            return res.status(400).json({ error: 'Missing merchant or amount' });
        }

        // 3. 读取数据库
        const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
        const docSnap = await docRef.get();
        let state = docSnap.exists ? docSnap.data().state : { accounts: [], transactions: [] };

        // ★★★ 核心修改：移植 analyze.js 的强力匹配逻辑 ★★★
        let targetAcc = null;
        // 如果快捷指令没传，默认用 'Mashreq'，转小写方便匹配
        const choice = (account || 'Mashreq').toLowerCase();

        // A. 优先尝试直接匹配 (匹配 ID 或 Name)
        targetAcc = state.accounts.find(a => 
            a.name.toLowerCase().includes(choice) || 
            a.id.toLowerCase().includes(choice)
        );

        // B. 中文/特殊关键词映射
        if (!targetAcc) {
            if (choice.includes('微信')) targetAcc = state.accounts.find(a => a.id.includes('wechat'));
            if (choice.includes('支付宝')) targetAcc = state.accounts.find(a => a.id.includes('alipay'));
        }

        // C. 银行卡/现金特殊映射 (最关键的一步，保证图标正确)
        if (!targetAcc) {
            if (choice.includes('cash') || choice.includes('现金')) {
                targetAcc = state.accounts.find(a => a.name.includes('现金') || a.id === 'cash');
            } 
            // 只要包含 bank, card, mashreq, neo，就死命找 Mashreq 账户
            else if (choice.includes('bank') || choice.includes('card') || choice.includes('银行') || choice.includes('mashreq') || choice.includes('neo')) {
                 // 1. 优先找名字里带 mashreq 的
                 targetAcc = state.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
                 // 2. 找不到再找带 'bank' 的
                 if (!targetAcc) targetAcc = state.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
            }
        }
        
        // D. 实在找不到，兜底用第一个
        if (!targetAcc) targetAcc = state.accounts[0];

        // 5. 构造交易数据
        const numAmount = parseFloat(amount);
        const newTx = {
            id: Date.now(),
            type: 'expense',
            amount: numAmount,
            currency: targetAcc.currency || 'AED', // 跟随账户币种
            accountId: targetAcc.id,               // ★ 这里 ID 对了，前端图标就会对
            category: 'other', 
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

        // 7. 保存
        await docRef.update({
            'state.accounts': state.accounts,
            'state.transactions': state.transactions,
            'updatedAt': new Date()
        });

        // 8. 静默通知
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
                disable_notification: true 
            })
        });
    } catch (e) { console.error(e); }
}
