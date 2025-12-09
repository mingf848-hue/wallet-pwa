import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

// 1. 直接复用你 index.html 里的真实配置
const firebaseConfig = {
  apiKey: "AIzaSyAMq8_hpoVSP5ULfou1w4psq94d5bEjCIY",
  authDomain: "wallet-ff0d5.firebaseapp.com",
  projectId: "wallet-ff0d5",
  storageBucket: "wallet-ff0d5.firebasestorage.app",
  messagingSenderId: "152393317434",
  appId: "1:152393317434:web:13f49e309db57f75f54903"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// 核心处理函数
export default async function handler(req, res) {
  // 只允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 2. 匿名登录 (确保有权限读写数据库)
    await signInAnonymously(auth);

    // 3. 从 iOS 快捷指令接收数据
    // 期望数据格式: { "amount": "12.5", "merchant": "7-11", "date": "2023-..." }
    const { amount, merchant, date } = req.body;

    if (!amount) {
      return res.status(400).json({ error: 'Missing amount' });
    }

    // 4. 读取当前的云端总账本 (my_personal_wallet_v2)
    const docRef = doc(db, 'bitledger_storage', 'my_personal_wallet_v2');
    const docSnap = await getDoc(docRef);

    let currentState;

    if (docSnap.exists()) {
      currentState = docSnap.data().state;
    } else {
      // 如果万一云端为空，初始化一个默认状态 (防止报错)
      currentState = {
        accounts: [{ id: 'alipay', name: '支付宝', balance: 0, currency: 'CNY' }],
        transactions: [],
        privacyMode: false
      };
    }

    // 5. 构造新交易数据
    const txAmount = parseFloat(amount);
    const txDate = date ? new Date(date) : new Date(); // 使用当前时间或传入时间
    const note = merchant || "Apple Pay 自动记账";

    // --- 智能账户匹配逻辑 ---
    // 优先寻找名字里包含 "银行"、"Bank" 或 "Credit" 的账户
    // 如果找不到，就默认使用列表里的第一个账户 (通常是支付宝或微信)
    let targetAcc = currentState.accounts.find(a => 
      a.name.includes('银行') || 
      a.id.includes('bank') || 
      a.name.toLowerCase().includes('card')
    );
    
    // 兜底：如果没找到银行卡账户，就用第一个账户
    if (!targetAcc) {
        targetAcc = currentState.accounts[0];
    }

    const newTx = {
      id: Date.now(),
      type: 'expense', // Apple Pay 默认为支出
      amount: txAmount,
      currency: targetAcc.currency || 'CNY',
      accountId: targetAcc.id,
      category: 'other', // 默认分类为“其他”，你可以稍后在 App 里改
      date: txDate.toISOString(), // 存为字符串，前端会自动转回 Date 对象
      note: note
    };

    // 6. 更新状态 (扣钱 + 加流水)
    
    // 6.1 更新账户余额
    const accIndex = currentState.accounts.findIndex(a => a.id === targetAcc.id);
    if (accIndex !== -1) {
      // 支出是减钱
      currentState.accounts[accIndex].balance -= txAmount;
    }

    // 6.2 添加交易记录
    currentState.transactions.push(newTx);

    // 7. 写回数据库 (这会触发你网页端的实时更新)
    await setDoc(docRef, {
      state: currentState,
      updatedAt: new Date()
    });

    // 8. 返回成功给 iOS
    return res.status(200).json({ 
        success: true, 
        msg: `已记账: -${txAmount} (${targetAcc.name})`,
        balance: currentState.accounts[accIndex].balance
    });

  } catch (error) {
    console.error("Webhook Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
