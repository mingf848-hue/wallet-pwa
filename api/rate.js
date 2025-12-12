export default async function handler(req, res) {
    // 允许跨域
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    try {
        // 1. 定义币安 P2P 接口 (CNY)
        const binanceUrl = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
        
        // 2. 构造请求体 (模拟筛选：购买 USDT, 法币 CNY)
        const payload = {
            "fiat": "CNY",
            "page": 1,
            "rows": 1, // 只拿第1条最便宜的
            "tradeType": "BUY", // 这里 BUY 指的是商家卖单(我们可以买入的价格)，通常代表市场挂单价
            "asset": "USDT",
            "countries": [],
            "proMerchantAds": false,
            "shieldMerchantAds": false,
            "payTypes": [] // 不限支付方式
        };

        // 3. 发起请求
        const response = await fetch(binanceUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0' // 伪装浏览器
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        // 4. 提取价格
        // data.data[0].adv.price 就是当前市场最低卖单价
        if (data && data.data && data.data.length > 0) {
            const cnyPrice = parseFloat(data.data[0].adv.price);
            
            // 顺便可以获取一下 USD 和 AED 的汇率 (可选，这里简单模拟或调其他免费接口)
            // 为了速度，我们直接返回抓到的 C2C 价格
            return res.status(200).json({
                success: true,
                usdt_cny: cnyPrice.toFixed(2), // 真实 C2C 价格
                usdt_aed: "3.67", // AED 是固定汇率，通常锁死 3.67
                update_at: new Date().toISOString()
            });
        } else {
            throw new Error("Binance API No Data");
        }

    } catch (error) {
        console.error("Rate API Error:", error);
        // 如果币安挂了，返回一个保底价格防止前端白屏
        return res.status(200).json({ 
            success: false, 
            usdt_cny: "7.02", // 保底值
            usdt_aed: "3.65" 
        });
    }
}
