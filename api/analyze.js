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
    // 【修改点1】接收 manualPlatform 参数
    const { imageBase64, manualPlatform } = req.body;
    
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

    // --- A. 调用代理 ---
    const systemPrompt = `
      你是一个专业的会计助手。请分析这张支付截图。
      请精准提取以下信息并以纯 JSON 格式返回：
      1. amount: 实付金额（数字，不要符号）。
      2. merchant: 交易平台或商户名称。
      3. product_name: 商品标题或交易描述。
      4. platform: 支付方式（WeChat, Alipay, UnionPay, Unknown）。
      
      返回格式示例：
      {"amount": 4.89, "merchant": "拼多多", "product_name": "女士内裤...", "platform": "WeChat"}
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

    // 【修改点2】如果有手动选择，强制覆盖 AI 的判断
    if (manualPlatform) {
        console.log("用户手动选择了:", manualPlatform);
        if (manualPlatform.includes('微信')) data.platform = 'WeChat';
        else if (manualPlatform.includes('支付宝')) data.platform = 'Alipay';
        // 如果选的是“自动”，则不覆盖，继续用 data.platform
    }

    // --- B. 保存到 Firebase ---
    await signInAnonymously(auth);
    const docRef = doc(db, 'bitledger_storage', 'my_personal_wallet_v2');
    const docSnap = await getDoc(docRef);
    
    let currentState = docSnap.exists() ? docSnap.data().state : {
        accounts: [{ id: 'alipay', name: '支付宝', balance: 0 }],
        transactions: []
    };

    // 智能匹配账户
    let targetAcc = null;
    if (data.platform === 'Alipay') targetAcc = currentState.accounts.find(a => a.name.includes('支付宝') || a.id.includes('alipay'));
    else if (data.platform === 'WeChat') targetAcc = currentState.accounts.find(a => a.name.includes('微信') || a.id.includes('wechat'));
    
    // 如果还没匹配到，再次尝试兜底
    if (!targetAcc) {
        if (manualPlatform && manualPlatform.includes('微信')) targetAcc = currentState.accounts.find(a => a.id === 'wechat');
        if (manualPlatform && manualPlatform.includes('支付宝')) targetAcc = currentState.accounts.find(a => a.id === 'alipay');
    }
    
    if (!targetAcc) targetAcc = currentState.accounts[0];

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
        message: `✅ 已记账: -${newTx.amount}\n💳 账户: ${targetAcc.name}\n📝 ${finalNote.substring(0, 8)}...` 
    });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
