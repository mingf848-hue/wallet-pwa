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

    // --- A. 逻辑大升级：教 AI 区分“清单”和“列表” ---
    const systemPrompt = `
      你是一个高级会计助理。请先【判断图片类型】，然后提取交易数据并返回 JSON 数组。
      
      【判断逻辑】：
      
      场景 A：单笔订单详情页 (例如外卖小票、超市购物单)
      特征：虽然列出了很多具体商品(如生菜、可乐)，但底部有一个【实付/合计】总金额。
      处理规则：
      1. **只返回 1 条交易记录**。
      2. **amount**: 提取底部的【实付金额】(例如 135.03)。严禁使用左边的“优惠后”或“原价”。
      3. **product_name**: 将列表中的商品名称拼接起来作为备注 (例如 "生菜, 瓜子, 可乐, 调料...")。精简掉无用修饰词。
      4. **merchant**: 提取顶部的店铺名。
      
      场景 B：历史账单列表页 (例如微信/支付宝/拼多多订单列表)
      特征：每一行代表不同时间、不同商家的独立交易。
      处理规则：
      1. **返回多条交易记录**。
      2. 提取每一行的金额、商户、状态。
      3. 如果有"退款"字样，标记 type: 'income' (收入)，否则为 'expense'。

      ----------------
      
      通用字段要求：
      1. date: 交易时间 (YYYY-MM-DD HH:mm:ss)。列表页如果没年份默认 2025。
      2. platform: 支付方式 (WeChat, Alipay, UnionPay, Unknown)。
      3. type: 'expense' 或 'income'。

      返回 JSON 示例 (单笔订单场景)：
      [
        {"amount": 135.03, "type": "expense", "merchant": "蜜雪冰城", "product_name": "圆西生菜, 瓜子仁, 百事可乐...", "date": "2025-12-10 18:00:00", "platform": "WeChat"}
      ]

      返回 JSON 示例 (列表场景)：
      [
        {"amount": 12.00, "type": "expense", "merchant": "闲鱼", "product_name": "学生认证", "date": "2025-11-25 18:09:00", "platform": "Alipay"},
        {"amount": 36.00, "type": "income", "merchant": "拼多多", "product_name": "退款", "date": "2025-12-10 04:08:00", "platform": "WeChat"}
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

    // --- B. 数据库写入逻辑 (保持不变，支持批量) ---
    await signInAnonymously(auth);
    const docRef = doc(db, 'bitledger_storage', 'my_personal_wallet_v2');
    const docSnap = await getDoc(docRef);
    
    let currentState = docSnap.exists() ? docSnap.data().state : {
        accounts: [{ id: 'alipay', name: '支付宝', balance: 0 }],
        transactions: []
    };

    let successMsg = [];
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
    console.error("Server Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
