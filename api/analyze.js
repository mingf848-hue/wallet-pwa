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

    // --- A. 调用 AI (Prompt 已深度优化) ---
    const systemPrompt = `
      你是一个专业的私人财务助理。请分析这张支付截图。
      请精准提取以下信息，并对商品名称进行【智能精简】。
      
      请返回纯 JSON 格式：
      1. amount: 实付金额（数字）。
      2. merchant: 商户名称。
      3. product_name: 【核心任务】商品名称备注。
         - 规则：如果识别到电商平台（拼多多/淘宝）那种堆砌关键词的长标题（例如"女士内裤透明大码全毛露走光丁字裤火"），请务必【提炼】为简洁的人类语言（例如"透明女士内裤"）。
         - 去除："爆款"、"包邮"、"大码"、"显瘦"、"网红"、"ins风"等营销词汇，除非是商品核心属性。
         - 保持在 4-8 个字左右最佳。
      4. platform: 支付方式（WeChat, Alipay, UnionPay, Unknown）。
      
      返回格式示例：
      {"amount": 4.89, "merchant": "拼多多", "product_name": "透明女士内裤", "platform": "WeChat"}
      不要使用 Markdown，直接返回 JSON。
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
    
    let data;
    try { data = JSON.parse(cleanJson); } 
    catch (e) { data = { amount: 0, merchant: "未知", product_name: "识别失败", platform: "Unknown" }; }

    // --- B. 数据库逻辑 ---
    await signInAnonymously(auth);
    const docRef = doc(db, 'bitledger_storage', 'my_personal_wallet_v2');
    const docSnap = await getDoc(docRef);
    
    let currentState = docSnap.exists() ? docSnap.data().state : {
        accounts: [{ id: 'alipay', name: '支付宝', balance: 0 }],
        transactions: []
    };

    // --- C. 智能账户匹配 ---
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
        if (!targetAcc && (manualPlatform.includes('银行') || manualPlatform.toLowerCase().includes('card') || manualPlatform.toLowerCase().includes('bank'))) {
             targetAcc = currentState.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
        }
    }

    if (!targetAcc) {
        if (data.platform === 'Alipay') targetAcc = currentState.accounts.find(a => a.name.includes('支付宝') || a.id.includes('alipay'));
        else if (data.platform === 'WeChat') targetAcc = currentState.accounts.find(a => a.name.includes('微信') || a.id.includes('wechat'));
        else if (data.platform === 'UnionPay') targetAcc = currentState.accounts.find(a => a.name.includes('银行') || a.name.toLowerCase().includes('bank'));
    }

    if (!targetAcc) targetAcc = currentState.accounts[0];

    // --- D. 写入数据 ---
    // 这里的 data.product_name 现在已经是 AI 提炼过的简洁版了
    const finalNote = data.product_name && data.product_name.length > 1 ? data.product_name : data.merchant;

    const newTx = {
      id: Date.now(),
      type: 'expense',
      amount: parseFloat(data.amount),
      currency: targetAcc.currency || 'CNY',
      accountId: targetAcc.id,
      category: 'shop', 
      date: new Date().toISOString(),
      merchant: data.merchant, 
      note: finalNote
    };

    const accIndex = currentState.accounts.findIndex(a => a.id === targetAcc.id);
    if (accIndex !== -1) currentState.accounts[accIndex].balance -= newTx.amount;
    
    currentState.transactions.push(newTx);
    await setDoc(docRef, { state: currentState, updatedAt: new Date() });

    return res.status(200).json({ 
        success: true, 
        // 【修改点】去掉了 .substring() 截断，现在显示完整备注
        message: `✅ 已记账: -${newTx.amount}\n💳 账户: ${targetAcc.name}\n📝 ${finalNote}` 
    });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
