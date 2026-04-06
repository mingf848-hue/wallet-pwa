import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY || "AIzaSyAMq8_hpoVSP5ULfou1w4psq94d5bEjCIY",
    authDomain: "wallet-ff0d5.firebaseapp.com",
    projectId: "wallet-ff0d5",
    storageBucket: "wallet-ff0d5.firebasestorage.app",
    messagingSenderId: "152393317434",
    appId: "1:152393317434:web:13f49e309db57f75f54903"
};

// 修复 1：彻底对标交易所底层算法 (向下截断 8 位，而非四舍五入)
function truncateCrypto(num) {
    // 先放大再 floor，加上极小偏移量防止 JS 内部精度如 0.999999999 导致截断错误
    return Math.floor(num * 1e8 + 1e-6) / 1e8;
}

function roundFiat(num) {
    return Number(Math.round(num + "e2") + "e-2");
}

export default async function handler(req, res) {
    try {
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        
        // 使用匿名登录获取对 Firestore 的读写权限
        await signInAnonymously(auth);

        const GLOBAL_WALLET_DOC_ID = 'my_personal_wallet_v2';
        const docRef = doc(db, 'bitledger_storage', GLOBAL_WALLET_DOC_ID);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            return res.status(404).json({ error: "Data not found" });
        }

        let state = docSnap.data().state;
        if (!state || !state.accounts) {
            return res.status(400).json({ error: "Invalid state format" });
        }

        // 修复 2：强大的幂等性检查，结合东八区时间，防止 Vercel Cron 异常重试导致重复发息
        const now = new Date();
        const beijingTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
        const todayStr = beijingTime.toISOString().split('T')[0]; 
        
        if (state.lastInterestDate) {
            const lastDate = new Date(state.lastInterestDate);
            const lastBeijingTime = new Date(lastDate.getTime() + (8 * 60 * 60 * 1000));
            const lastDateStr = lastBeijingTime.toISOString().split('T')[0];
            
            if (lastDateStr === todayStr) {
                console.log("今日利息已发放，跳过，防止多发");
                return res.status(200).json({ message: "Already processed today" });
            }
        }

        let totalInterestGiven = 0;
        let newTransactions = [];
        let txIdCounter = 0;

        // 修复 3：严格对标交易所 (Binance/OKX) 的阶梯 APR 计息规则
        state.accounts.forEach(acc => {
            if (acc.apy > 0 && acc.balance > 0) {
                const limit = acc.tierLimit || 0;
                const apyRate = acc.apy / 100;
                const excessApyRate = (acc.excessApy || 0) / 100;
                
                let dailyInterest = 0;

                if (limit > 0 && acc.balance > limit) {
                    // 阶梯逻辑：限额内的部分吃基础高息，超出限额的部分吃低息，然后相加
                    const baseInterest = limit * (apyRate / 365);
                    const excessInterest = (acc.balance - limit) * (excessApyRate / 365);
                    dailyInterest = baseInterest + excessInterest;
                } else {
                    // 资金未超过高息额度，全额享受基础高息
                    dailyInterest = acc.balance * (apyRate / 365);
                }

                // 核心修复：根据是否是加密货币，采用不同的精度截断策略
                const isCrypto = ['USDT', 'USDC', 'BTC', 'ETH'].includes(acc.currency) || acc.icon === 'binance' || acc.icon === 'okx' || acc.name.toLowerCase().includes('okx');
                
                if (isCrypto) {
                    // 交易所逻辑：直接砍掉 8 位之后的小数，不进位
                    dailyInterest = truncateCrypto(dailyInterest);
                    if (dailyInterest > 0) {
                        acc.balance = truncateCrypto(acc.balance + dailyInterest);
                        totalInterestGiven += dailyInterest;
                    }
                } else {
                    // 法币逻辑：四舍五入保留 2 位
                    dailyInterest = roundFiat(dailyInterest);
                    if (dailyInterest > 0) {
                        acc.balance = roundFiat(acc.balance + dailyInterest);
                        totalInterestGiven += dailyInterest;
                    }
                }

                if (dailyInterest > 0) {
                    // 写入账单流水
                    newTransactions.push({
                        id: Date.now() + (++txIdCounter), // 确保并行流水 ID 绝对唯一
                        type: 'income',
                        amount: dailyInterest,
                        currency: acc.currency,
                        accountId: acc.id,
                        targetAccountId: null,
                        category: 'interest',
                        date: now.toISOString(), // 存入标准 UTC 时间
                        note: '每日理财收益 (自动结息)'
                    });
                }
            }
        });

        if (newTransactions.length > 0) {
            // 将新流水合并入状态
            state.transactions.push(...newTransactions);
            state.lastInterestDate = now.toISOString();

            // 将更新后的数据原子化存回 Firestore
            await setDoc(docRef, { 
                state: state, 
                updatedAt: now.toISOString() 
            }, { merge: true });

            return res.status(200).json({ 
                message: "Interest distributed successfully", 
                count: newTransactions.length,
                totalGiven: fixPrecision(totalInterestGiven)
            });
        } else {
            state.lastInterestDate = now.toISOString();
            await setDoc(docRef, { state: state, updatedAt: now.toISOString() }, { merge: true });
            return res.status(200).json({ message: "No accounts eligible for interest today" });
        }

    } catch (error) {
        console.error("Cron execution failed:", error);
        return res.status(500).json({ error: error.message });
    }
}
