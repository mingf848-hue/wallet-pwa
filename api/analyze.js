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

    // --- A. 满血版 Prompt：人设拉满 ---
    const systemPrompt = `
      你是一个经验丰富、极其严谨的私人财务助理。你的任务是精准分析支付截图，提取交易数据。

      【第一步：判断图片类型 (核心逻辑)】
      
      类型 A：单笔订单详情页
      - 特征：底部有"实付"、"合计"或"确认交易"按钮，或者虽然列出了很多菜品但显然是一次交易。
      - **处理规则**：
        1. **只生成 1 条交易记录**。
        2. **金额**：提取底部的【实付总额】（严禁使用原价、优惠前价格）。
        3. **商品名**：将列表中的商品名称拼接（如 "生菜, 瓜子, 可乐, 调料..."）。
      
      类型 B：账单列表页
      - 特征：有多行独立交易，每行有单独的金额和商户。
      - **处理规则**：
        1. **生成多条交易记录**。
        2. **【日期继承逻辑 (至关重要)】**：
           - 列表页通常会有"日期头"（如 "12月10日"、"昨天"）。
           - **该标题下方的所有交易，日期必须强制与标题一致！**
           - **严禁**对日期进行递增或递减。如果某一行没写日期，它就属于它头顶上的那个日期。
           - 默认年份 ${currentYear}。如果不显示日期，默认视为【今天】。

      【第二步：数据清洗与提炼 (展现你的专业性)】
      
      1. **product_name (备注)**：
         - **智能精简**：对于电商商品（拼多多/淘宝），标题通常堆砌关键词。请务必**提炼核心商品名**。
         - 例如：将 "夏季爆款冰丝无痕大码女内裤防走光" 精简为 "冰丝无痕内裤"。
         - 去除："包邮"、"网红"、"显瘦"、"2025新款" 等营销词汇。
      
      2. **merchant (商户)**：
         - 提取店铺名或平台名。如果是个人转账，提取对方昵称。

      3. **platform (平台)**：
         - 优先寻找文字。如果没有文字，根据**界面颜色**判断：
         - 绿色 = WeChat (微信)
         - 蓝色 = Alipay (支付宝)
         - 红色/银联标 = UnionPay (云闪付/银行)

      4. **category (分类)**：
         - 根据商品和商户性质，从以下 ID 中选一个最准确的：
         - 'food' (餐饮/超市/零食), 'shop' (购物/日用/服饰), 'transport' (交通/打车), 'home' (居住/水电), 'fun' (娱乐), 'other' (其他)。

      返回 JSON 示例：
      [
        {"amount": 135.03, "type": "expense", "merchant": "蜜雪冰城", "product_name": "生菜, 瓜子, 可乐...", "category": "food", "date": "${currentYear}-12-10 18:00:00", "platform": "WeChat"},
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

    // --- C. 核心逻辑：账户匹配 & 数据入库 ---
    for (const item of items) {
        let targetAcc = null;
        
        // 1. 优先处理【手动选择】
        if (manualPlatform && manualPlatform !== '自动识别') {
            const choice = manualPlatform.toLowerCase();
            targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes(choice) || a.id.toLowerCase().includes(choice));
            
            // 中文映射
            if (!targetAcc) {
                if (manualPlatform.includes('微信')) targetAcc = currentState.accounts.find(a => a.id.includes('wechat'));
                if (manualPlatform.includes('支付宝')) targetAcc = currentState.accounts.find(a => a.id.includes('alipay'));
            }

            // ★ Mashreq 优先匹配逻辑 ★
            // 如果选了"银行卡"，优先找 Mashreq
            if (!targetAcc && (manualPlatform.includes('银行') || choice.includes('bank') || choice.includes('card'))) {
                 targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
                 
                 // 找不到 Mashreq 再找其他银行
                 if (!targetAcc) {
                     targetAcc = currentState.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
                 }
            }
        }
        
        // 2. 其次处理【AI 自动识别】
        if (!targetAcc) {
            // 如果商户名本身就带 Bank/Mashreq
            if (item.merchant && (item.merchant.toLowerCase().includes('mashreq') || item.merchant.toLowerCase().includes('bank'))) {
                targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
            }

            if (!targetAcc) {
                if (item.platform === 'Alipay') targetAcc = currentState.accounts.find(a => a.name.includes('支付宝') || a.id.includes('alipay'));
                else if (item.platform === 'WeChat') targetAcc = currentState.accounts.find(a => a.name.includes('微信') || a.id.includes('wechat'));
                else if (item.platform === 'UnionPay' || item.platform === 'Unknown') {
                     // 银联或未知 -> 优先猜 Mashreq
                     targetAcc = currentState.accounts.find(a => a.name.toLowerCase().includes('mashreq'));
                }
            }
        }
        
        // 3. 兜底
        if (!targetAcc) targetAcc = currentState.accounts[0];

        // --- 数据构造 ---
        // 这里的 product_name 已经是经过 AI 精简过的人话了
        const finalNote = item.product_name && item.product_name.length > 1 ? item.product_name : item.merchant;
        
        // ★★★ 日期强力修复补丁 ★★★
        let txDate = new Date(); // 默认就是【现在】
        
        if (item.date) {
            let parsedDate = new Date(item.date);
            const currentMonth = new Date().getMonth(); // 0-11
            // 判断是否是"可疑的1月1日" (AI把所有没日期的都归零了)
            const isSuspiciousJan1 = parsedDate.getMonth() === 0 && parsedDate.getDate() === 1 && currentMonth > 1;
            
            // 只有当 AI 给出的日期非常靠谱时，才覆盖默认的“现在”
            if (!isNaN(parsedDate.getTime()) && parsedDate.getFullYear() >= 2024 && !isSuspiciousJan1) {
                txDate = parsedDate;
            }
        }
        
        txDate.setMilliseconds(txDate.getMilliseconds() + timeOffset);
        timeOffset += 100;

        const newTx = {
            id: Date.now() + Math.random() + timeOffset,
            type: item.type || 'expense',
            amount: parseFloat(item.amount),
            currency: targetAcc.currency || 'CNY',
            accountId: targetAcc.id,
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
