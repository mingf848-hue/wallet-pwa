import { initializeApp } from "firebase/app";
// Vercel 稳定导入
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
    // ★★★ 核心：接收 iPhone 传来的时间 ★★★
    const { imageBase64, manualPlatform, transactionTime } = req.body; 
    
    if (!imageBase64 || !transactionTime) {
      return res.status(400).json({ error: '缺少图片或交易时间(transactionTime)。' });
    }

    // iPhone 传来的时间作为所有交易的唯一基准
    const iphoneBaseTime = new Date(transactionTime); 

    // --- A. Prompt: 完整人设 + 明确禁止提取日期 ---
    const systemPrompt = `
      你是一个经验丰富、极其严谨的私人财务助理。请分析这张截图，提取交易数据并返回 JSON 数组。

      【第一步：判断图片类型】
      场景 1：单笔订单详情页 (特征：底部有"实付"、"合计"或"确认交易"按钮)
      - **规则**：只返回 1 条汇总记录。金额取底部实付。商品名拼接。
      
      场景 2：账单列表页 (特征：多行独立交易)
      - **规则**：返回多条记录。提取每一行的金额和商户。

      【第二步：数据清洗 (核心人设)】
      1. **product_name (备注)**：
         - 电商长标题请务必【智能精简】(例如将 "夏季爆款冰丝无痕大码女内裤防走光" 精简为 "冰丝无痕内裤")。
         - 去除："包邮"、"网红"、"显瘦" 等营销词汇。
      2. **merchant (商户)**：提取店铺名。
      3. **platform (平台)**：根据界面颜色判断 (绿色=WeChat, 蓝色=Alipay, 红色/银联=UnionPay)。
      4. **category (分类)**：从 food (餐饮), shop (购物), transport (交通), home (居住), fun (娱乐), other (其他) 中选一个最准确的。
      
      **【重要】：绝对不要提取日期！不要返回 date 字段！所有交易时间将由外部提供。**

      返回 JSON 示例：
      [
        {"amount": 135.03, "type": "expense", "merchant": "蜜雪冰城", "product_name": "生菜, 瓜子, 可乐...", "category": "food", "platform": "WeChat"},
        {"amount": 4.89, "type": "expense", "merchant": "拼多多", "product_name": "透明女士内裤", "category": "shop", "platform": "Alipay"}
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

    // --- C. 核心逻辑：账户匹配 & 纯 iPhone 时间设置 ---
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
        
        // ★★★ 核心：只使用 iPhone 传来的时间作为基准 ★★★
        let finalTxDate = new Date(iphoneBaseTime); 
        
        // 批量记账时，对时间戳进行倒序微调 (减法) 以保证顺序正确
        finalTxDate.setMilliseconds(finalTxDate.getMilliseconds() - timeOffset);
        timeOffset += 100;

        const newTx = {
            // ID生成依然使用 Date.now() 保证唯一性
            id: Date.now() - timeOffset + Math.random(), 
            type: item.type || 'expense',
            amount: parseFloat(item.amount),
            currency: targetAcc.currency || 'CNY',
            accountId: targetAcc.id,
            category: item.category || 'other', 
            
            date: finalTxDate.toISOString(), // 100% 来源于快捷指令
            
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

    // 数据库更新时间 (不影响账单时间)
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
