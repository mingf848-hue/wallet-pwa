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

// 防止重复初始化
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export default async function handler(req, res) {
  // 只允许 POST 请求
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // 1. 接收前端参数
    const { imageBase64, manualPlatform, transactionTime } = req.body; 
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

    const currentYear = new Date().getFullYear();
    // 优先使用 iPhone 传来的时间，如果没有则用当前服务器时间
    const iphoneTime = transactionTime ? new Date(transactionTime) : new Date(); 

    // 2. 定义 System Prompt (去除了平台判断，强调所见即所得)
    const systemPrompt = `
      你是一个经验丰富、极其严谨的私人财务助理。你的任务是精准分析支付截图，提取交易数据。

      【核心原则：所见即所得】
      **严禁臆造数据。如果图片上写的是“一件也是批发价”，商户名就必须填“一件也是批发价”，绝对不要根据意思去联想或编造（如“有范生活”等）。**

      【字段提取规则】

      1. **merchant (商户/交易对象)**：
         - **OCR优先**：严格提取截图顶部或头像旁边的**可视文字**。
         - **禁止脑补**：即使商户名看起来像一句口号（例如“一件起批”、“外贸原单”），只要它是作为标题出现的，就直接提取原话。

      2. **product_name (备注)**：
         - **智能精简**：对于电商长标题，请务必【提炼核心商品名】。
         - 例如：将 "夏季爆款冰丝无痕大码女内裤防走光" 精简为 "冰丝无痕内裤"。
         - 去除："包邮"、"网红"、"显瘦" 等营销词汇。
      
      3. **category (分类)**：
         - 从 food, shop, transport, home, fun, other 中选一个最准确的。
      
      4. **date (日期)**：
         - **请务必从截图里提取日期和时间 (YYYY-MM-DD HH:mm:ss)**。如果截图里没有年份，默认 ${currentYear}。
         - 如果是列表，下方的交易必须继承上方最近的日期头。

      【判断与规则】
      
      类型 A：单笔订单详情页 -> 只返回 1 条汇总记录。
      类型 B：账单列表页 -> 返回多条记录。

      返回 JSON 示例：
      [
        {"amount": 135.03, "type": "expense", "merchant": "蜜雪冰城", "product_name": "生菜, 瓜子, 可乐...", "category": "food", "date": "2025-12-10 18:00:00"},
        {"amount": 4.89, "type": "expense", "merchant": "一件也是批发价", "product_name": "透明女士内裤", "category": "shop", "date": "2025-12-10 14:00:00"}
      ]
      不要使用 Markdown，直接返回纯 JSON 字符串。
    `;

    // 3. 调用 AI 接口
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

    if (!aiRes.ok) throw new Error("AI Request Failed: " + aiRes.statusText);
    
    const aiData = await aiRes.json();
    
    // 安全检查：确保 AI 返回了有效数据
    if (!aiData.candidates || !aiData.candidates[0].content) {
        throw new Error("AI response format error");
    }

    const rawText = aiData.candidates[0].content.parts[0].text;
    const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let items = [];
    try {
        const parsed = JSON.parse(cleanJson);
        items = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
        console.error("JSON Parse Error:", rawText);
        return res.status(500).json({ error: "AI 返回的数据格式无法解析" });
    }

    // 4. 读取 Firebase 数据库
    await signInAnonymously(auth);
    const docRef = doc(db, 'bitledger_storage', 'my_personal_wallet_v2');
    const docSnap = await getDoc(docRef);
    
    let currentState = docSnap.exists() ? docSnap.data().state : {
        accounts: [{ id: 'alipay', name: '支付宝', balance: 0 }],
        transactions: []
    };

    let successMsg = [];
    let timeOffset = 0; 
    
    // 5. 遍历处理每一笔交易 (新的账户匹配逻辑)
    for (const item of items) {
        let targetAcc = null;

        // --- 逻辑 A: 优先使用前端手动选择 (manualPlatform) ---
        if (manualPlatform && manualPlatform !== '自动识别') {
            const choice = manualPlatform.toLowerCase();
            targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes(choice) || a.id.toLowerCase().includes(choice));
            
            // 模糊匹配补充
            if (!targetAcc) {
                if (manualPlatform.includes('微信')) targetAcc = currentState.accounts.find(a => a.id.includes('wechat'));
                if (manualPlatform.includes('支付宝')) targetAcc = currentState.accounts.find(a => a.id.includes('alipay'));
            }
            // 银行卡兜底
            if (!targetAcc && (manualPlatform.includes('银行') || choice.includes('bank') || choice.includes('card'))) {
                 targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
                 if (!targetAcc) targetAcc = currentState.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
            }
        }

        // --- 逻辑 B: 如果没有手动指定，尝试根据商户名匹配 ---
        if (!targetAcc) {
            if (item.merchant && (item.merchant.toLowerCase().includes('mashreq') || item.merchant.toLowerCase().includes('bank'))) {
                targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
            }
        }

        // --- 逻辑 C: 兜底使用第一个账户 ---
        if (!targetAcc) targetAcc = currentState.accounts[0];

        const finalNote = item.product_name && item.product_name.length > 1 ? item.product_name : item.merchant;
        
        // --- 时间处理 ---
        let finalTxDate = new Date(iphoneTime); 
        
        if (item.date) {
            let aiParsedDate = new Date(item.date);
            const currentMonth = new Date().getMonth(); 
            const isSuspiciousJan1 = aiParsedDate.getMonth() === 0 && aiParsedDate.getDate() === 1 && currentMonth > 1;

            if (!isNaN(aiParsedDate.getTime()) && aiParsedDate.getFullYear() >= 2024 && !isSuspiciousJan1) {
                 finalTxDate = aiParsedDate; 
            }
        }

        // 批量记账时，对时间戳进行倒序微调
        finalTxDate.setMilliseconds(finalTxDate.getMilliseconds() - timeOffset);
        timeOffset += 100;

        // 构建交易对象
        const newTx = {
            id: Date.now() - timeOffset + Math.random(), 
            type: item.type || 'expense',
            amount: parseFloat(item.amount),
            currency: targetAcc.currency || 'CNY',
            accountId: targetAcc.id,
            category: item.category || 'other', 
            date: finalTxDate.toISOString(),
            merchant: item.merchant, 
            note: finalNote
        };

        // 更新余额
        const accIndex = currentState.accounts.findIndex(a => a.id === targetAcc.id);
        if (accIndex !== -1) {
            if (newTx.type === 'expense') currentState.accounts[accIndex].balance -= newTx.amount;
            else currentState.accounts[accIndex].balance += newTx.amount;
        }
        
        currentState.transactions.push(newTx);
        successMsg.push(`${item.merchant} ${newTx.type==='income'?'+':'-'}${newTx.amount}`);
    }

    // 6. 保存回 Firebase
    await setDoc(docRef, { state: currentState, updatedAt: new Date() });

    let displayMsg = successMsg.slice(0, 3).join('\n');
    if (successMsg.length > 3) displayMsg += `\n...还有 ${successMsg.length - 3} 笔`;

    return res.status(200).json({ 
        success: true, 
        message: `✅ 记账成功 (${successMsg.length}笔)\n----------------\n${displayMsg}` 
    });

  } catch (error) {
    console.error("Handler Error:", error);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
}
