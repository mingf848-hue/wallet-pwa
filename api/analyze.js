import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

// 2. Gemini 配置
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

    // --- A. 调用 Gemini 进行识别 (Prompt 已升级) ---
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `
      你是一个专业的会计助手。请分析这张支付截图（可能是拼多多、淘宝、微信、支付宝等界面）。
      请精准提取以下信息并以纯 JSON 格式返回：
      
      1. amount: 实付金额（数字，不要符号，例如 4.89）。
      2. merchant: 店铺名称或收款方（例如 "百姿千魅"、"全家"）。
      3. product_name: 【重要】商品标题或交易描述。
         - 如果是电商购物（如拼多多），请提取具体的商品长标题（例如 "女士内裤透明大码全毛露走光丁字裤火"）。
         - 如果是线下支付，提取商品名（如 "拿铁咖啡"）或直接用商户名。
      4. date: 交易时间（格式 YYYY-MM-DD HH:mm:ss，如果图中没写年份，默认 2025）。
      5. platform: 支付方式（WeChat, Alipay, UnionPay, Unknown）。根据界面特征判断，例如看到绿色钩子或微信支付字样就是 WeChat。
      
      返回格式示例：
      {"amount": 4.89, "merchant": "百姿千魅", "product_name": "女士内裤透明大码...", "date": "2025-12-10 14:30:00", "platform": "WeChat"}
      
      请直接返回 JSON 字符串，不要 Markdown 格式。
    `;

    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType: "image/jpeg",
      },
    };

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        console.error("AI JSON Parse Error:", text);
        // 容错处理
        data = { amount: 0, merchant: "未知", product_name: "识别失败", platform: "Unknown" }; 
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
    
    if (!targetAcc) targetAcc = currentState.accounts[0];

    // 【重要】构造备注：优先使用商品标题
    // 如果提取到了 product_name，就用它做备注；否则用商户名
    const finalNote = data.product_name && data.product_name.length > 1 ? data.product_name : data.merchant;

    const newTx = {
      id: Date.now(),
      type: 'expense',
      amount: parseFloat(data.amount),
      currency: targetAcc.currency || 'CNY',
      accountId: targetAcc.id,
      category: 'shop', // 电商购物默认归类为 shop，你也可以让 AI 识别分类
      date: data.date ? new Date(data.date).toISOString() : new Date().toISOString(),
      note: finalNote // 这里现在是“女士内裤...”了
    };

    // 更新余额
    const accIndex = currentState.accounts.findIndex(a => a.id === targetAcc.id);
    if (accIndex !== -1) currentState.accounts[accIndex].balance -= newTx.amount;
    
    currentState.transactions.push(newTx);
    await setDoc(docRef, { state: currentState, updatedAt: new Date() });

    // --- C. 返回结果给 iOS ---
    return res.status(200).json({ 
        success: true, 
        message: `已记账: -${newTx.amount}\n备注: ${finalNote}`, // 通知里也会显示具体买了什么
        data: data 
    });

  } catch (error) {
    console.error("AI Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
