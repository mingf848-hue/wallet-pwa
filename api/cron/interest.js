import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const GLOBAL_WALLET_DOC_ID = 'my_personal_wallet_v2';

// 初始化 Firebase Admin
if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.BITLEDGER_KEY);
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();

export default async function handler(req, res) {
    // 鉴权 (可选)
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        // return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log(`\n🚀 [Cron] 开始执行精准利息计算...`);

    try {
        const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return res.status(404).json({ error: "Document not found" });
        }

        let data = docSnap.data();
        let state = data.state;
        let accounts = state.accounts || [];
        let transactions = state.transactions || [];
        let updated = false;
        let totalYieldCount = 0;
        let logs = [];

        // --- 核心循环 ---
        for (let acc of accounts) {
            const currentBal = parseFloat(acc.balance) || 0;
            
            // 只有余额大于 0 才计算
            if (currentBal > 0) {
                // 1. 获取基础参数
                const limit = parseFloat(acc.tierLimit) || 0; 
                const baseApy = parseFloat(acc.apy || 0) / 100;      
                const excessApy = parseFloat(acc.excessApy || 0) / 100; 

                let rawInterest = 0;

                // 2. 计算原始利息 (高精度)
                if (limit > 0 && currentBal > limit) {
                    // 阶梯模式: (限额 * 基础) + (超出部分 * 进阶)
                    const tier1Income = (limit * baseApy) / 365;
                    const tier2Income = ((currentBal - limit) * excessApy) / 365;
                    rawInterest = tier1Income + tier2Income;
                } else {
                    // 普通模式
                    rawInterest = (currentBal * baseApy) / 365;
                }

                // 3. ★★★ 核心修复：针对交易所的特殊精度处理 ★★★
                let finalInterest = 0;
                
                // 判断是否是 OKX (不区分大小写)
                const isOKX = acc.name.toLowerCase().includes('okx') || acc.id.toLowerCase().includes('okx');

                if (isOKX) {
                    // === OKX 逻辑 ===
                    // 规则：保留 2 位小数，向下取整 (Floor)
                    // 例子：2.7451 -> 2.74
                    finalInterest = Math.floor(rawInterest * 100) / 100;
                } else {
                    // === Bitget / 默认逻辑 ===
                    // 规则：保留 6 位小数，向下取整 (Floor)
                    // 例子：1.2794819 -> 1.279481
                    finalInterest = Math.floor(rawInterest * 1000000) / 1000000;
                }

                // 只有最终利息 > 0 才入账
                if (finalInterest > 0) {
                    // 更新余额 (注意 JS 浮点数相加，这里为了安全可以再次做一次精度修正，但通常直接加即可)
                    acc.balance += finalInterest; 

                    // 构造备注
                    let noteStr = `收益 ${acc.apy}%`;
                    if (limit > 0) { 
                        noteStr = `阶梯收益 (前${limit}享${acc.apy}%, 超出享${acc.excessApy}%)`; 
                    }

                    // 写入流水
                    transactions.push({
                        id: Date.now() + Math.random(),
                        type: 'income',
                        amount: finalInterest, // 这里存入的就是处理好的 2位 或 6位 小数
                        currency: acc.currency,
                        accountId: acc.id,
                        category: 'interest',
                        date: new Date().toISOString(),
                        note: noteStr,
                        isAuto: true,
                        source: 'vercel_cron'
                    });
                    
                    updated = true;
                    totalYieldCount++;
                    const logMsg = `💰 [${acc.name}] 派发: +${finalInterest} ${acc.currency}`;
                    console.log(logMsg);
                    logs.push(logMsg);
                }
            }
        }

        // --- 保存 ---
        if (updated) {
            state.lastInterestDate = new Date().toISOString();
            
            await docRef.update({
                'state.accounts': accounts,
                'state.transactions': transactions,
                'state.lastInterestDate': state.lastInterestDate,
                'updatedAt': new Date()
            });
            
            return res.status(200).json({ success: true, count: totalYieldCount, logs: logs });
        } else {
            return res.status(200).json({ success: true, message: "No interest generated." });
        }

    } catch (error) {
        console.error("❌ Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
