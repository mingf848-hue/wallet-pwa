import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

// 1. Firebase 配置 (保持不变)
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
  // 只允许 POST 请求
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

    // --- A. 构造 Prompt (提取商品名做备注) ---
    const systemPrompt = `
      你是一个专业的会计助手。请分析这张支付截图（拼多多、淘宝、微信、支付宝等）。
      请精准提取以下信息并以纯 JSON 格式返回：
      
      1. amount: 实付金额（数字，不要符号）。
      2. merchant: 店铺名称或收款方。
      3. product_name: 【重要】商品标题或交易描述。
         - 如果是电商（拼多多/淘宝），提取具体的商品长标题（如"女士内裤透明大码..."）。
         - 如果是线下支付，提取商品名或商户名。
      4. date: 交易时间（格式 YYYY-MM-DD HH:mm:ss，无年份默认2025）。
      5. platform: 支付方式（WeChat, Alipay, UnionPay, Unknown）。
      
      返回格式示例：
      {"amount": 4.89, "merchant": "百姿千魅", "product_name": "女士内裤透明...", "date": "2025-12-10 14:30:00", "platform": "WeChat"}
      不要使用 Markdown，直接返回 JSON。
    `;

    // --- B. 调用你的 Cloudflare 代理 ---
    // 你的代理地址 + Google 标准路径
    // 既然你的 Key 已经在 Worker 里了，这里就不需要传 key 参数
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

    if (!aiRes.ok) {
        const errText = await aiRes.text();
        throw new Error(`AI Request Failed: ${aiRes.status} - ${errText}`);
    }

    const aiData = await aiRes.json();
    
    // 解析 Gemini 返回的数据结构
    const rawText = aiData.candidates[0].content.parts[0].text;
    const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let data;
    try {
        data = JSON.parse(cleanJson);
    } catch (e) {
        console.error("JSON Parse Error:", cleanJson);
        data = { amount: 0, merchant: "未知", product_name: "识别失败", platform: "Unknown" };
    }

    // --- C. 保存到 Firebase (智能匹配账户 + 扣款) ---
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
    if (!targetAcc) targetAcc = currentState.accounts[0];

    // 构造备注：优先用商品名
    const finalNote = data.product_name && data.product_name.length > 1 ? data.product_name : data.merchant;

    const newTx = {
      id: Date.now(),
      type: 'expense',
      amount: parseFloat(data.amount),
      currency: targetAcc.currency || 'CNY',
      accountId: targetAcc.id,
      category: 'shop', 
      date: data.date ? new Date(data.date).toISOString() : new Date().toISOString(),
      note: finalNote 
    };

    // 扣减余额
    const accIndex = currentState.accounts.findIndex(a => a.id === targetAcc.id);
    if (accIndex !== -1) currentState.accounts[accIndex].balance -= newTx.amount;
    
    currentState.transactions.push(newTx);
    await setDoc(docRef, { state: currentState, updatedAt: new Date() });

    // --- D. 返回给 iOS ---
    return res.status(200).json({ 
        success: true, 
        message: `✅ 已记账: -${newTx.amount}\n📝 ${finalNote.substring(0, 20)}...` 
    });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
