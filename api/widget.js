import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// 1. 初始化 (和 sms.js 一样)
if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.BITLEDGER_KEY);
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();
const GLOBAL_WALLET_DOC_ID = 'my_personal_wallet_v2';

export default async function handler(req, res) {
    // 允许跨域 (让 HTML 能访问)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    try {
        // 1. 密码验证
        const { key } = req.query;
        if (key !== '123456') { // ★ 请改为你的密码 (必须和 HTML 里填的一样)
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // 2. 读取数据库
        const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
        const docSnap = await docRef.get();
        
        if (!docSnap.exists) {
            return res.status(200).json({ total: 0, dailyYield: 0, expense: 0 });
        }

        const data = docSnap.data();
        const state = data.state || { accounts: [], transactions: [] };

        // 3. 计算【总资产】(Total)
        // 把所有账户余额加起来 (假设都是 AED 或 CNY，这里直接加总，粗略计算)
        let totalBalance = 0;
        if (state.accounts) {
            state.accounts.forEach(acc => {
                // 这里简单粗暴直接加。如果你有汇率需求，可以在这里乘汇率
                totalBalance += parseFloat(acc.balance || 0);
            });
        }

        // 4. 计算【今日支出】(Expense)
        let todayExpense = 0;
        let todayIncome = 0;
        
        // 获取迪拜时间 (UTC+4) 的 "YYYY-MM-DD"
        // 这样保证你过了迪拜时间 0 点，数据才清零
        const now = new Date();
        const dubaiOffset = 4 * 60; // 迪拜是 UTC+4
        const localOffset = now.getTimezoneOffset(); // 本地和UTC的分差
        const dubaiTime = new Date(now.getTime() + (dubaiOffset + localOffset) * 60000);
        const todayStr = dubaiTime.toISOString().split('T')[0]; // "2025-12-12"

        if (state.transactions) {
            state.transactions.forEach(tx => {
                // 交易时间也要转成迪拜日期来对比
                // 这里简化处理：如果 tx.date 字符串里包含今天的日期
                if (tx.date && tx.date.startsWith(todayStr)) {
                    if (tx.type === 'expense') {
                        todayExpense += parseFloat(tx.amount || 0);
                    } else if (tx.type === 'income') {
                        todayIncome += parseFloat(tx.amount || 0);
                    }
                }
            });
        }

        // 5. 计算【日收益率】(Daily Yield) - 用于控制数字跳动速度
        // 逻辑：如果今天有收入(利息)，就用今天的收入作为速度。
        // 如果今天还没收入，为了动画好看，给个保底速度 (比如 100 块/天)，或者返回 0
        let dailyYield = todayIncome > 0 ? todayIncome : 0; 
        
        // ★ 强行补丁：如果你的利息是通过青龙脚本算的，并没有写入 transactions
        // 你可以在这里给一个固定的“预估日收益”，让数字跳起来，比如 150/天
        // dailyYield = 150.00; 

        return res.status(200).json({
            total: totalBalance.toFixed(2),
            dailyYield: dailyYield.toFixed(2),
            expense: todayExpense.toFixed(2),
            updated: new Date().toISOString()
        });

    } catch (error) {
        console.error("Widget API Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
