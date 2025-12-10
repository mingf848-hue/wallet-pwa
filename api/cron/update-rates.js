import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// 1. 初始化 Firebase
if (getApps().length === 0) {
    // 这里的 BITLEDGER_KEY 是你之前配置过的 Firebase 私钥
    const serviceAccount = JSON.parse(process.env.BITLEDGER_KEY);
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();

// 辅助函数：抓取币安 P2P 价格
// tradeType: "SELL" 代表我们要"卖出"USDT换法币 (即查看商家的收购单)
async function fetchBinanceP2P(fiatCurrency, payTypes = []) {
    const p2pUrl = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
    const payload = {
        "fiat": fiatCurrency,
        "page": 1,
        "rows": 5, // 取前5个最优价的平均值
        "tradeType": "SELL", 
        "asset": "USDT",
        "countries": [],
        "proMerchantAds": false,
        "shieldMerchantAds": false,
        "publisherType": null,
        "payTypes": payTypes
    };

    try {
        const res = await fetch(p2pUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0"
            },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        
        if (!json.data || json.data.length === 0) return null;

        // 计算平均价
        let total = 0;
        json.data.forEach(ad => { total += parseFloat(ad.adv.price); });
        return parseFloat((total / json.data.length).toFixed(4));
    } catch (e) {
        console.error(`Fetch ${fiatCurrency} failed:`, e);
        return null;
    }
}

export default async function handler(req, res) {
    console.log(`\n🚀 [Cron] 开始抓取多币种汇率...`);

    try {
        // --- A. 并行抓取汇率 ---
        // 1. USDT -> CNY (参考: 银行卡/支付宝/微信)
        // 2. USDT -> AED (参考: 银行转账，迪拜常用)
        const [usdtToCny, usdtToAed] = await Promise.all([
            fetchBinanceP2P("CNY", ["BANK", "ALIPAY", "WECHAT"]),
            fetchBinanceP2P("AED", ["BANK"]) 
        ]);

        if (!usdtToCny) throw new Error("无法获取 CNY 汇率");
        
        // 兜底逻辑：如果 AED 没抓到 (比如接口波动)，暂时用固定汇率
        const finalUsdtAed = usdtToAed || 3.6725;

        // --- B. 计算交叉汇率 (AED -> CNY) ---
        // 逻辑：1 AED = (1 USDT换成的CNY) / (1 USDT能换的AED)
        const aedToCny = parseFloat((usdtToCny / finalUsdtAed).toFixed(4));

        console.log(`✅ 汇率更新: USDT/CNY=${usdtToCny}, USDT/AED=${finalUsdtAed} => AED/CNY=${aedToCny}`);

        // --- C. 存入 Firebase (供前端 App 使用) ---
        const ratesData = {
            USDT: usdtToCny,      // 前端显示 USDT 估值
            AED: aedToCny,        // 前端显示 AED 估值
            USDT_AED: finalUsdtAed, // 仅做记录
            CNY: 1,
            updateTime: new Date().toISOString(),
            source: 'Binance P2P'
        };

        await db.collection('bitledger_storage').doc('global_config').set({
            rates: ratesData
        }, { merge: true });

        // --- D. 推送 Telegram ---
        // 直接从环境变量读取你刚才设置的 Token 和 ID
        const botToken = process.env.TG_BOT_TOKEN;
        const chatId = process.env.TG_CHAT_ID;

        if (botToken && chatId) {
            const dateStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            
            // 计算溢价 (基于美元汇率 7.25 的参考值)
            const premium = ((usdtToCny - 7.25) / 7.25 * 100).toFixed(2);
            const premiumSign = premium > 0 ? '+' : '';

            const message = `
💰 <b>今日出金汇率 (Binance P2P)</b>
📅 ${dateStr}

🇨🇳 <b>USDT/CNY:</b> <code>${usdtToCny.toFixed(2)}</code> (溢价 ${premiumSign}${premium}%)
🇦🇪 <b>USDT/AED:</b> <code>${finalUsdtAed.toFixed(3)}</code>
💱 <b>AED/CNY:</b> <code>${aedToCny.toFixed(3)}</code>

<i>*数据来源: 币安 C2C 商家收购均价</i>
            `.trim();

            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: message,
                    parse_mode: "HTML"
                })
            });
            console.log("✅ Telegram 推送成功");
        } else {
            console.log("⚠️ 未配置 Telegram 环境变量，跳过推送");
        }

        return res.status(200).json({ success: true, rates: ratesData });

    } catch (error) {
        console.error("❌ 汇率更新失败:", error);
        return res.status(500).json({ error: error.message });
    }
}
