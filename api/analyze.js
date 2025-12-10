import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAMq8_hpoVSP5ULfou1w4psq94d5bEjCIY",
  authDomain: "wallet-ff0d5.firebaseapp.com",
  projectId: "wallet-ff0d5",
  storageBucket: "wallet-ff0d5.firebasestorage.app",
  messagingSenderId: "152393317434",
  appId: "1:152393317434:web:13f49e309db57f75f54903"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { imageBase64, manualPlatform } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

    // --- A. Prompt 逻辑升级：强制修正日期归属 ---
    const systemPrompt = `
      你是一个高级会计助理。请分析这张截图（单笔详情 或 交易列表）。
      请提取【所有可见的】交易记录，并返回 JSON 数组。
      
      【关键规则】：
      1. 判断图片类型：
         - 如果是【单笔详情页】（底部有“实付”或“合计”），只返回 1 条汇总记录。将具体商品拼接为 product_name。
         - 如果是【列表页】，返回多条记录。
      
      2. 【日期识别 - 必须严格执行】：
         - 列表页通常会有日期标题（如 "12月10日"、"昨天"、"本月"）。
         - **在此标题下方的所有交易，日期都必须与标题一致！**
         - 严禁对日期进行递减或猜测。如果一行没有日期，它一定属于上方最近的一个日期标题。
         - 年份默认 2025。
         - 如果截图里没有具体日期（只有时间），则默认视为【今天】。

      3. product_name: 提取商品名或商户名，如果是电商长标题请提炼核心词。
      4. platform: 支付方式 (WeChat, Alipay 等)。

      返回 JSON 示例：
      [
        {"amount": 135.03, "type": "expense", "merchant": "蜜雪冰城", "product_name": "圆西生菜, 瓜子仁...", "date": "2025-12-10 18:00:00", "platform": "WeChat"},
        {"amount": 4.89, "type": "expense", "merchant": "拼多多", "product_name": "透明女士内裤", "date": "2025-12-10 14:00:00", "platform": "Alipay"}
      ]
      不要使用 Markdown，直接返回 JSON 字符串。
    `;

    const proxyUrl = "https://gemini-proxy.aratakitofood.workers.dev/v1beta/models/gemini-1.5-flash:generateContent";
    
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
        return res.status(500).json({ error: "AI 解析失败" });
    }

    // --- B. 数据库写入 ---
    await signInAnonymously(auth);
    const docRef = doc(db, 'bitledger_storage', 'my_personal_wallet_v2');
    const docSnap = await getDoc(docRef);
    
    let currentState = docSnap.exists() ? docSnap.data().state : {
        accounts: [{ id: 'alipay', name: '支付宝', balance: 0 }],
        transactions: []
    };

    let successMsg = [];
    // 这里的偏移量只用于毫秒级微调，不改变日期
    let timeOffset = 0;

    for (const item of items) {
        // 1. 账户匹配
        let targetAcc = null;
        if (manualPlatform && manualPlatform !== '自动识别') {
            targetAcc = currentState.accounts.find(a => 
                a.name.toLowerCase().includes(manualPlatform.toLowerCase()) || 
                a.id.toLowerCase().includes(manualPlatform.toLowerCase())
            );
             if (!targetAcc) {
                if (manualPlatform.includes('微信')) targetAcc = currentState.accounts.find(a => a.id.includes('wechat'));
                if (manualPlatform.includes('支付宝')) targetAcc = currentState.accounts.find(a => a.id.includes('alipay'));
            }
             if (!targetAcc && (manualPlatform.includes('银行') || manualPlatform.toLowerCase().includes('card'))) {
                 targetAcc = currentState.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
            }
        }
        
        if (!targetAcc) {
            if (item.platform === 'Alipay') targetAcc = currentState.accounts.find(a => a.name.includes('支付宝') || a.id.includes('alipay'));
            else if (item.platform === 'WeChat') targetAcc = currentState.accounts.find(a => a.name.includes('微信') || a.id.includes('wechat'));
             else if (item.platform === 'UnionPay') targetAcc = currentState.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
        }
        
        if (!targetAcc) targetAcc = currentState.accounts[0];

        // 2. 构造数据
        const finalNote = item.product_name && item.product_name.length > 1 ? item.product_name : item.merchant;
        const txDate = item.date ? new Date(item.date) : new Date();
        txDate.setMilliseconds(txDate.getMilliseconds() + timeOffset);
        timeOffset += 100;

        const newTx = {
            id: Date.now() + Math.random() + timeOffset,
            type: item.type || 'expense',
            amount: parseFloat(item.amount),
            currency: targetAcc.currency || 'CNY',
            accountId: targetAcc.id,
            category: 'shop', 
            date: txDate.toISOString(),
            merchant: item.merchant, 
            note: finalNote
        };

        const accIndex = currentState.accounts.findIndex(a => a.id === targetAcc.id);
        if (accIndex !== -1) {
            if (newTx.type === 'expense') currentState.accounts[accIndex].balance -= newTx.amount;
            else currentState.accounts[accIndex].balance += newTx.amount;
        }
        
        currentState.transactions.push(newTx);
        successMsg.push(`${item.merchant} ${newTx.type==='income'?'+':'-'}${newTx.amount}`);
    }

    await setDoc(docRef, { state: currentState, updatedAt: new Date() });

    let displayMsg = successMsg.slice(0, 3).join('\n');
    if (successMsg.length > 3) displayMsg += `\n...还有 ${successMsg.length - 3} 笔`;

    return res.status(200).json({ 
        success: true, 
        message: `✅ 记账成功 (${successMsg.length}笔)\n----------------\n${displayMsg}` 
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
