import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// 全局配置 ID
const GLOBAL_WALLET_DOC_ID = 'my_personal_wallet_v2';

// --- 1. 初始化 Firebase Admin (防止冷启动重复初始化) ---
if (getApps().length === 0) {
    // 从 Vercel 环境变量读取私钥
    const serviceAccount = JSON.parse(process.env.BITLEDGER_KEY);
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();

export default async function handler(req, res) {
    // 简单的安全验证：防止别人通过 URL 恶意触发
    // Vercel Cron 会自动带上这就头，如果你手动测试，可以去掉这行检查
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        // return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log(`\n🚀 [Vercel Cron] 开始执行每日利息计算...`);

    try {
        const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            console.error("❌ 未找到钱包数据");
            return res.status(404).json({ error: "Document not found" });
        }

        let data = docSnap.data();
        let state = data.state;
        let accounts = state.accounts || [];
        let transactions = state.transactions || [];
        let updated = false;
        let totalYieldCount = 0;
        let logs = [];

        // --- 2. 核心计算循环 (你的原始逻辑) ---
        for (let acc of accounts) {
            const currentBal = parseFloat(acc.balance) || 0;
            
            if (currentBal > 0) {
                const limit = parseFloat(acc.tierLimit) || 0; 
                const baseApy = parseFloat(acc.apy || 0) / 100;
                const excessApy = parseFloat(acc.excessApy || 0) / 100; 

                let rawInterest = 0;

                // 阶梯利率逻辑
                if (limit > 0 && currentBal > limit) {
                    rawInterest = ((limit * baseApy) + ((currentBal - limit) * excessApy)) / 365;
                } else {
                    rawInterest = (currentBal * baseApy) / 365;
                }

                // 精度修复逻辑 (向下取整保留6位)
                let interest = Math.floor(rawInterest * 1000000) / 1000000;

                if (interest > 0) {
                    acc.balance += interest; // 更新余额

                    let noteStr = `收益 ${acc.apy}%`;
                    if (limit > 0) { 
                        noteStr = `阶梯收益 (前${limit}享${acc.apy}%, 超出享${acc.excessApy}%)`; 
                    }

                    // 写入流水
                    transactions.push({
                        id: Date.now() + Math.random(),
                        type: 'income',
                        amount: interest,
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
                    const logMsg = `💰 [${acc.name}] 派发: +${interest.toFixed(6)} ${acc.currency}`;
                    console.log(logMsg);
                    logs.push(logMsg);
                }
            }
        }

        // --- 3. 保存回数据库 ---
        if (updated) {
            state.lastInterestDate = new Date().toISOString();
            
            await docRef.update({
                'state.accounts': accounts,
                'state.transactions': transactions,
                'state.lastInterestDate': state.lastInterestDate,
                'updatedAt': new Date()
            });
            
            console.log(`🎉 结算完成！共 ${totalYieldCount} 个账户产生利息。`);
            return res.status(200).json({ success: true, count: totalYieldCount, logs: logs });
        } else {
            console.log("💤 今日无利息产生。");
            return res.status(200).json({ success: true, message: "No interest generated today." });
        }

    } catch (error) {
        console.error("❌ 执行出错:", error);
        return res.status(500).json({ error: error.message });
    }
}
