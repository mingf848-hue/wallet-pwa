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

    const currentYear = new Date().getFullYear();

    // --- A. 终极 Prompt：新增分类识别 (category) ---
    const systemPrompt = `
      你是一个经验丰富、极其严谨的私人财务助理。请分析这张截图，提取交易数据并返回 JSON 数组。

      【第一步：判断图片类型】
      场景 1：单笔订单详情页 (特征：底部有"实付"、"合计"或"确认交易"按钮)
      - **规则**：只返回 1 条汇总记录。金额取底部实付。商品名拼接。
      
      场景 2：账单列表页 (特征：多行独立交易)
      - **规则**：返回多条记录。
      - **日期**：严格遵循列表中的日期头。如果某行没日期，继承上方最近的日期。默认年份 ${currentYear}。

      【第二步：数据提取与清洗】
      
      1. **product_name (备注)**：
         - 电商长标题请【智能精简】(如 "透明女士内裤")。
      2. **merchant (商户)**：提取店铺名。
      3. **platform (平台)**：绿色=WeChat, 蓝色=Alipay, 红色/银联=UnionPay。
      
      4. **category (分类 - 核心新增)**：
         请根据商品和商户性质，从以下 ID 中选一个最准确的：
         - 'food': 餐饮、外卖、食品、超市买菜 (如蜜雪冰城、麦当劳、生菜、零食)。
         - 'shop': 购物、服饰、电子产品、日用百货 (如淘宝、拼多多、内裤、手机)。
         - 'transport': 交通、打车、加油、地铁。
         - 'home': 居住、水电煤、房租、话费。
         - 'fun': 娱乐、电影、游戏、会员充值。
         - 'other': 其他、转账、红包。

      返回 JSON 示例：
      [
        {"amount": 135.03, "type": "expense", "merchant": "蜜雪冰城", "product_name": "生菜, 瓜子...", "category": "food", "date": "${currentYear}-12-10 18:00:00", "platform": "WeChat"},
        {"amount": 4.89, "type": "expense", "merchant": "拼多多", "product_name": "透明女士内裤", "category": "shop", "date": "${currentYear}-12-10 14:00:00", "platform": "Alipay"}
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
    let timeOffset = 0;

    // --- C. 账户匹配 (保持 Mashreq 优先逻辑) ---
    for (const item of items) {
        let targetAcc = null;
        
        // 1. 手动选择
        if (manualPlatform && manualPlatform !== '自动识别') {
            const choice = manualPlatform.toLowerCase();
            targetAcc = currentState.accounts.find(a => 
                a.name.toLowerCase().includes(choice) || 
                a.id.toLowerCase().includes(choice)
            );
            if (!targetAcc) {
                if (manualPlatform.includes('微信')) targetAcc = currentState.accounts.find(a => a.id.includes('wechat'));
                if (manualPlatform.includes('支付宝')) targetAcc = currentState.accounts.find(a => a.id.includes('alipay'));
            }
            // Mashreq 优先
            if (!targetAcc && (manualPlatform.includes('银行') || choice.includes('bank') || choice.includes('card'))) {
                 targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
                 if (!targetAcc) {
                     targetAcc = currentState.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
                 }
            }
        }
        
        // 2. AI 识别
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

        // --- 构造数据 ---
        const finalNote = item.product_name && item.product_name.length > 1 ? item.product_name : item.merchant;
        
        // 日期处理
        let txDate;
        if (item.date && item.date.length > 5) {
            txDate = new Date(item.date);
            if (isNaN(txDate.getTime())) txDate = new Date();
        } else {
            txDate = new Date();
        }
        txDate.setMilliseconds(txDate.getMilliseconds() + timeOffset);
        timeOffset += 100;

        const newTx = {
            id: Date.now() + Math.random() + timeOffset,
            type: item.type || 'expense',
            amount: parseFloat(item.amount),
            currency: targetAcc.currency || 'CNY',
            accountId: targetAcc.id,
            
            // 【核心修改】使用 AI 返回的 category，如果 AI 没识别出来，默认用 'other'
            category: item.category || 'other', 
            
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
