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
        if (key !== '123456') { // ★ 请改为你的密码
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

        // 4. 账户匹配 (移植强力匹配逻辑)
        let targetAcc = null;
        const choice = (account || 'Mashreq').toLowerCase();

        // A. 优先尝试直接匹配
        targetAcc = state.accounts.find(a => 
            a.name.toLowerCase().includes(choice) || 
            a.id.toLowerCase().includes(choice)
        );

        // B. 银行卡/现金特殊映射
        if (!targetAcc) {
            if (choice.includes('cash') || choice.includes('现金')) {
                targetAcc = state.accounts.find(a => a.name.includes('现金') || a.id === 'cash');
            } 
            else if (choice.includes('bank') || choice.includes('card') || choice.includes('银行') || choice.includes('mashreq') || choice.includes('neo')) {
                 targetAcc = state.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
                 if (!targetAcc) targetAcc = state.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
            }
        }
        
        // C. 兜底
        if (!targetAcc) targetAcc = state.accounts[0];

        // 5. 构造交易数据
        const numAmount = parseFloat(amount);
        const newTx = {
            id: Date.now(),
            type: 'expense',
            amount: numAmount,
            currency: targetAcc.currency || 'AED',
            accountId: targetAcc.id,
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

        // 7. 保存到数据库
        await docRef.update({
            'state.accounts': state.accounts,
            'state.transactions': state.transactions,
            'updatedAt': new Date()
        });

        // ★★★ 没有任何消息发送代码 ★★★

        return res.status(200).json({ success: true, id: newTx.id });

    } catch (error) {
        console.error("SMS API Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
