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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    await signInAnonymously(auth);

    // 2. 接收 iOS 发来的 card 字段
    const { amount, merchant, date, card } = req.body;
    
    // 如果没有金额，直接报错
    if (!amount) return res.status(400).json({ error: 'Missing amount' });

    const docRef = doc(db, 'bitledger_storage', 'my_personal_wallet_v2');
    const docSnap = await getDoc(docRef);
    
    // 初始化默认状态
    let currentState = docSnap.exists() ? docSnap.data().state : {
        accounts: [{ id: 'alipay', name: '支付宝', balance: 0, currency: 'CNY' }],
        transactions: [],
        privacyMode: false
    };

    // --- 3. 核心升级：智能账户匹配逻辑 ---
    let targetAcc = null;

    if (card) {
        // 策略 A：精准匹配 (如果不区分大小写，卡片名字里包含账户名字，或者账户名字包含卡片名字)
        // 例如：Apple Pay 传过来 "Mashreq Card 1234"，你账户叫 "Mashreq"，就能匹配上
        targetAcc = currentState.accounts.find(a => 
            card.toLowerCase().includes(a.name.toLowerCase()) || 
            a.name.toLowerCase().includes(card.toLowerCase()) ||
            (a.id && card.toLowerCase().includes(a.id.toLowerCase())) // 也试着匹配 ID
        );
    }

    // 策略 B：如果没匹配上（比如卡名叫 "Visa"，你账户叫 "Mashreq"），就找个默认的银行卡账户
    if (!targetAcc) {
        targetAcc = currentState.accounts.find(a => 
            a.name.includes('Bank') || a.name.includes('银行') || a.type === 'bank'
        );
    }

    // 策略 C：实在找不到，就用列表第一个账户兜底 (防止报错)
    if (!targetAcc) {
        targetAcc = currentState.accounts[0];
    }

    // 4. 构造交易数据
    const txAmount = parseFloat(amount);
    const newTx = {
      id: Date.now(),
      type: 'expense',
      amount: txAmount,
      currency: targetAcc.currency || 'CNY', // 使用该账户的币种
      accountId: targetAcc.id,
      category: 'other', 
      date: date ? new Date(date).toISOString() : new Date().toISOString(),
      // 备注里把卡片名字也带上，方便你核对
      note: merchant ? `${merchant} (via ${card || 'Apple Pay'})` : `Apple Pay: ${card || 'Unknown'}`
    };

    // 5. 扣款并保存
    const accIndex = currentState.accounts.findIndex(a => a.id === targetAcc.id);
    if (accIndex !== -1) {
      currentState.accounts[accIndex].balance -= txAmount;
    }
    currentState.transactions.push(newTx);

    await setDoc(docRef, { state: currentState, updatedAt: new Date() });

    return res.status(200).json({ 
        success: true, 
        matchedAccount: targetAcc.name, // 告诉 iOS 匹配到了哪个账户
        msg: `已在 [${targetAcc.name}] 记账 -${txAmount}`
    });

  } catch (error) {
    console.error("Webhook Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
