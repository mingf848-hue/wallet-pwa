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

    // --- A. 升级 Prompt：支持列表提取 & 批量返回 ---
    const systemPrompt = `
      你是一个专业的会计助理。请分析这张截图（可能是单笔详情，也可能是账单列表）。
      请提取【所有可见的】交易记录，并返回一个 JSON 数组。
      
      提取规则：
      1. 即使只有一条记录，也要返回数组格式，例如 [{...}]。
      2. 识别【日期】：
         - 列表截图通常有"今天"、"昨天"或具体日期头（如"12月10日"）。请将每条交易归属到正确的日期。
         - 如果只显示时间（如"14:30"），默认视为今天。
         - 年份如果未显示，默认 2025。
      3. 识别【收支类型】：
         - 观察金额前的符号（"-"或黑色通常为支出，"+"或橙色/绿色通常为收入）。
         - 字段 type: 'expense' (支出) 或 'income' (收入)。
         - amount 字段只填绝对值数字。
      4. 提取 merchant (商户) 和 product_name (商品/备注)。
      5. platform: 支付方式（WeChat, Alipay 等）。如果是列表截图，通常整页都是同一个App，请根据界面推断。

      返回 JSON 格式示例：
      [
        {"amount": 25.00, "type": "expense", "merchant": "肯德基", "product_name": "香辣鸡腿堡套餐", "date": "2025-12-10 12:30:00", "platform": "Alipay"},
        {"amount": 4.89, "type": "expense", "merchant": "拼多多", "product_name": "透明女士内裤", "date": "2025-12-10 14:00:00", "platform": "WeChat"}
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
        // 兼容处理：AI可能返回对象也可能返回数组，统一转为数组
        if (Array.isArray(parsed)) {
            items = parsed;
        } else {
            items = [parsed];
        }
    } catch (e) {
        console.error("JSON Parse Error:", cleanJson);
        // 容错：如果解析失败，返回空数组或报错
        return res.status(500).json({ error: "AI 解析失败，请重试" });
    }

    // --- B. 准备数据库 ---
    await signInAnonymously(auth);
    const docRef = doc(db, 'bitledger_storage', 'my_personal_wallet_v2');
    const docSnap = await getDoc(docRef);
    
    let currentState = docSnap.exists() ? docSnap.data().state : {
        accounts: [{ id: 'alipay', name: '支付宝', balance: 0 }],
        transactions: []
    };

    let successMsg = [];
    let totalAmountChange = 0;

    // --- C. 循环处理每一条记录 ---
    // 为了防止时间戳完全一样导致排序混乱，我们给每条记录加微小的毫秒偏移
    let timeOffset = 0;

    for (const item of items) {
        // 1. 智能匹配账户 (针对每一条记录单独匹配，虽然列表截图通常是同一个账户，但逻辑通用更好)
        let targetAcc = null;

        // 优先手动选择
        if (manualPlatform && manualPlatform !== '自动识别') {
            targetAcc = currentState.accounts.find(a => 
                a.name.toLowerCase().includes(manualPlatform.toLowerCase()) || 
                a.id.toLowerCase().includes(manualPlatform.toLowerCase())
            );
            // ... (原本的手动匹配兜底逻辑) ...
            if (!targetAcc) {
                if (manualPlatform.includes('微信')) targetAcc = currentState.accounts.find(a => a.id.includes('wechat'));
                if (manualPlatform.includes('支付宝')) targetAcc = currentState.accounts.find(a => a.id.includes('alipay'));
            }
            if (!targetAcc && (manualPlatform.includes('银行') || manualPlatform.toLowerCase().includes('card'))) {
                 targetAcc = currentState.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
            }
        }

        // 其次 AI 识别
        if (!targetAcc) {
            if (item.platform === 'Alipay') targetAcc = currentState.accounts.find(a => a.name.includes('支付宝') || a.id.includes('alipay'));
            else if (item.platform === 'WeChat') targetAcc = currentState.accounts.find(a => a.name.includes('微信') || a.id.includes('wechat'));
            else if (item.platform === 'UnionPay') targetAcc = currentState.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
        }

        // 兜底
        if (!targetAcc) targetAcc = currentState.accounts[0];

        // 2. 构造数据
        const finalNote = item.product_name && item.product_name.length > 1 ? item.product_name : item.merchant;
        
        // 处理日期：如果 AI 没返回具体时间，或者我们要强制用当前时间(用户可选)，
        // 但对于“列表截图”，最好信任 AI 识别出的日期（因为列表里包含了昨天的账单）。
        // 这里做一个折中：如果 AI 识别的时间包含“今天”，或者和当前时间相差不大，就用 AI 的；
        // 如果 AI 识别失败，就用 new Date()。
        // 为了简单，我们优先使用 AI 从列表里读到的日期字符串。
        const txDate = item.date ? new Date(item.date) : new Date();
        
        // 微调时间戳，防止多条记录完全重叠
        txDate.setMilliseconds(txDate.getMilliseconds() + timeOffset);
        timeOffset += 100;

        const newTx = {
            id: Date.now() + Math.random() + timeOffset,
            type: item.type || 'expense', // 默认为支出
            amount: parseFloat(item.amount),
            currency: targetAcc.currency || 'CNY',
            accountId: targetAcc.id,
            category: 'shop', 
            date: txDate.toISOString(),
            merchant: item.merchant, 
            note: finalNote
        };

        // 3. 更新余额
        const accIndex = currentState.accounts.findIndex(a => a.id === targetAcc.id);
        if (accIndex !== -1) {
            if (newTx.type === 'expense') {
                currentState.accounts[accIndex].balance -= newTx.amount;
                totalAmountChange -= newTx.amount;
            } else {
                currentState.accounts[accIndex].balance += newTx.amount; // 收入增加余额
                totalAmountChange += newTx.amount;
            }
        }
        
        currentState.transactions.push(newTx);
        successMsg.push(`${item.merchant} ${newTx.type==='income'?'+':'-'}${newTx.amount}`);
    }

    // --- D. 统一写入数据库 ---
    await setDoc(docRef, { state: currentState, updatedAt: new Date() });

    // --- E. 返回汇总通知 ---
    // 如果条数太多，只显示前3条 + "等X笔"
    let displayMsg = successMsg.slice(0, 3).join('\n');
    if (successMsg.length > 3) {
        displayMsg += `\n...还有 ${successMsg.length - 3} 笔`;
    }

    return res.status(200).json({ 
        success: true, 
        message: `✅ 批量记账成功 (${successMsg.length}笔)\n----------------\n${displayMsg}` 
    });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
