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
    // ★★★ 接收 iPhone 传来的时间 ★★★
    const { imageBase64, manualPlatform, transactionTime } = req.body; 
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

    const currentYear = new Date().getFullYear();
    const iphoneTime = transactionTime ? new Date(transactionTime) : new Date(); // iPhone/服务器时间作为后备

    // --- A. Prompt: 保持人设，并要求 AI 提取日期 ---
    const systemPrompt = `
      你是一个经验丰富、极其严谨的私人财务助理。你的任务是精准分析支付截图，提取交易数据。

      【核心任务与人设】
      
      1. **product_name (备注)**：
         - **智能精简**：对于电商长标题，请务必【提炼核心商品名】。
         - 例如：将 "夏季爆款冰丝无痕大码女内裤防走光" 精简为 "冰丝无痕内裤"。
         - 去除："包邮"、"网红"、"显瘦" 等营销词汇。
      
      2. **category (分类)**：
         - 从 food, shop, transport, home, fun, other 中选一个最准确的。
      
      3. **platform (平台)**：
         - 根据界面颜色判断 (绿色=WeChat, 蓝色=Alipay, 红色/银联=UnionPay)。

      4. **date (日期)**：
         - **请务必从截图里提取日期和时间 (YYYY-MM-DD HH:mm:ss)**。如果截图里没有年份，默认 ${currentYear}。
         - 如果是列表，下方的交易必须继承上方最近的日期头。

      【判断与规则】
      
      类型 A：单笔订单详情页 -> 只返回 1 条汇总记录。
      类型 B：账单列表页 -> 返回多条记录。

      返回 JSON 示例：
      [
        {"amount": 135.03, "type": "expense", "merchant": "蜜雪冰城", "product_name": "生菜, 瓜子, 可乐...", "category": "food", "platform": "WeChat", "date": "2025-12-10 18:00:00"},
        {"amount": 4.89, "type": "expense", "merchant": "拼多多", "product_name": "透明女士内裤", "category": "shop", "platform": "Alipay", "date": "2025-12-10 14:00:00"}
      ]
      不要使用 Markdown，直接返回纯 JSON 字符串。
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

    // --- B. 准备数据库 ---
    await signInAnonymously(auth);
    const docRef = doc(db, 'bitledger_storage', 'my_personal_wallet_v2');
    const docSnap = await getDoc(docRef);
    
    let currentState = docSnap.exists() ? docSnap.data().state : {
        accounts: [{ id: 'alipay', name: '支付宝', balance: 0 }],
        transactions: []
    };

    let successMsg = [];
    
    // 我们仍然使用倒序偏移，确保批量记账时列表顺序正确
    let timeOffset = 0; 
    
    // --- C. 核心逻辑：账户匹配 & 时间优先级 ---
    for (const item of items) {
        // 1. 账户匹配 (略)
        let targetAcc = null;
        if (manualPlatform && manualPlatform !== '自动识别') {
            const choice = manualPlatform.toLowerCase();
            targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes(choice) || a.id.toLowerCase().includes(choice));
            if (!targetAcc) {
                if (manualPlatform.includes('微信')) targetAcc = currentState.accounts.find(a => a.id.includes('wechat'));
                if (manualPlatform.includes('支付宝')) targetAcc = currentState.accounts.find(a => a.id.includes('alipay'));
            }
            if (!targetAcc && (manualPlatform.includes('银行') || choice.includes('bank') || choice.includes('card'))) {
                 targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
                 if (!targetAcc) targetAcc = currentState.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
            }
        }
        if (!targetAcc) {
            if (item.merchant && (item.merchant.toLowerCase().includes('mashreq') || item.merchant.toLowerCase().includes('bank'))) {
                targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
            }
            if (!targetAcc) {
                if (item.platform === 'Alipay') targetAcc = currentState.accounts.find(a => a.name.includes('支付宝') || a.id.includes('alipay'));
                else if (item.platform === 'WeChat') targetAcc = currentState.accounts.find(a => a.name.includes('微信') || a.id.includes('wechat'));
                else if (item.platform === 'UnionPay' || item.platform === 'Unknown') {
                     targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
                }
            }
        }
        if (!targetAcc) targetAcc = currentState.accounts[0];

        const finalNote = item.product_name && item.product_name.length > 1 ? item.product_name : item.merchant;
        
        // ★★★ 核心逻辑：时间优先级判断 ★★★
        let finalTxDate = new Date(iphoneTime); // 默认使用 iPhone 传来的时间
        
        if (item.date) {
            // 尝试解析 AI 提供的日期
            let aiParsedDate = new Date(item.date);
            const currentMonth = new Date().getMonth(); 
            const isSuspiciousJan1 = aiParsedDate.getMonth() === 0 && aiParsedDate.getDate() === 1 && currentMonth > 1;

            // 只有当 AI 提供的日期【有效】且【年份靠谱】且【不是可疑的 1月1日】时，才采用
            if (!isNaN(aiParsedDate.getTime()) && aiParsedDate.getFullYear() >= 2024 && !isSuspiciousJan1) {
                 finalTxDate = aiParsedDate; 
            }
            // 否则，保持使用 iPhone 传来的时间 (finalTxDate = new Date(iphoneTime))
        }

        // 批量记账时，对时间戳进行倒序微调 (减法)
        finalTxDate.setMilliseconds(finalTxDate.getMilliseconds() - timeOffset);
        timeOffset += 100;

        const newTx = {
            id: Date.now() - timeOffset + Math.random(), 
            type: item.type || 'expense',
            amount: parseFloat(item.amount),
            currency: targetAcc.currency || 'CNY',
            accountId: targetAcc.id,
            category: item.category || 'other', 
            
            date: finalTxDate.toISOString(), // 使用优先级最高的时间
            
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
