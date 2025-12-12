import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// 1. 初始化 Admin SDK (和 tg-webhook 一样)
if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.BITLEDGER_KEY);
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();
const GLOBAL_WALLET_DOC_ID = 'my_personal_wallet_v2';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const { imageBase64, manualPlatform, transactionTime } = req.body; 
        if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

        // 锁定时间
        const lockedTime = transactionTime ? new Date(transactionTime) : new Date(); 

        // System Prompt
        const systemPrompt = `
          你是一个经验丰富、极其严谨的私人财务助理。你的任务是精准分析支付截图，提取交易数据。
          【核心原则：所见即所得】
          严禁臆造数据。如果图片上写的是“一件也是批发价”，商户名就必须填“一件也是批发价”。

          【字段提取规则】
          1. merchant: 优先提取截图顶部或头像旁边的可视文字。
          2. product_name: 智能精简电商长标题。
          3. category: 从 food, shop, transport, home, fun, other 中选一个。

          返回 JSON 示例 (不要日期):
          [
            {"amount": 135.03, "type": "expense", "merchant": "蜜雪冰城", "product_name": "零食", "category": "food"}
          ]
          只返回纯 JSON。
        `;

        // 调用 Gemini
        const proxyUrl = "https://gemini-proxy.aratakitofood.workers.dev/";
        const payload = {
            contents: [{
                parts: [
                    { text: systemPrompt },
                    { inline_data: { mime_type: "image/jpeg", data: imageBase64 } }
                ]
            }]
        };

        const aiRes = await fetch(proxyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!aiRes.ok) throw new Error("AI Request Failed");
        const aiData = await aiRes.json();
        const rawText = aiData.candidates[0].content.parts[0].text;
        const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        let items = [];
        try {
            const parsed = JSON.parse(cleanJson);
            items = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
            return res.status(500).json({ error: "AI JSON Parse Error" });
        }

        // 读取数据库 (Admin SDK 方式，无需登录)
        const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
        const docSnap = await docRef.get();
        
        let state = docSnap.exists ? docSnap.data().state : { accounts: [], transactions: [] };
        if (!state.accounts) state.accounts = [{ id: 'cash', name: '现金', balance: 0, currency: 'CNY' }];

        let successMsg = [];
        let timeOffset = 0; 

        for (const item of items) {
            let targetAcc = null;
            // 账户匹配逻辑
            if (manualPlatform && manualPlatform !== '自动识别') {
                const choice = manualPlatform.toLowerCase();
                targetAcc = state.accounts.find(a => a.name.toLowerCase().includes(choice) || a.id.toLowerCase().includes(choice));
            }
            if (!targetAcc && item.merchant) {
                if (item.merchant.toLowerCase().includes('mashreq')) targetAcc = state.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
                // ... 其他自动匹配逻辑
            }
            if (!targetAcc) targetAcc = state.accounts[0];

            let finalTxDate = new Date(lockedTime);
            finalTxDate.setMilliseconds(finalTxDate.getMilliseconds() - timeOffset);
            timeOffset += 100;

            const newTx = {
                id: Date.now() - timeOffset + Math.random(), 
                type: item.type || 'expense',
                amount: parseFloat(item.amount),
                currency: targetAcc.currency || 'CNY',
                accountId: targetAcc.id,
                category: item.category || 'other', 
                date: finalTxDate.toISOString(), 
                merchant: item.merchant, 
                note: item.product_name || item.merchant
            };

            const accIndex = state.accounts.findIndex(a => a.id === targetAcc.id);
            if (accIndex !== -1) {
                if (newTx.type === 'expense') state.accounts[accIndex].balance -= newTx.amount;
                else state.accounts[accIndex].balance += newTx.amount;
            }
            
            state.transactions.push(newTx);
            successMsg.push(`${item.merchant} ${newTx.amount}`);
        }

        await docRef.update({ 
            'state.accounts': state.accounts, 
            'state.transactions': state.transactions, 
            'updatedAt': new Date() 
        });

        return res.status(200).json({ success: true, message: `✅ 识别成功: ${successMsg.join(', ')}` });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}
