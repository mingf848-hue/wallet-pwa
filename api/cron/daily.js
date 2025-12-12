import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import Parser from 'rss-parser';

// 1. 初始化 Firebase
if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.BITLEDGER_KEY);
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();
const parser = new Parser();
const GLOBAL_WALLET_DOC_ID = 'my_personal_wallet_v2';

export default async function handler(req, res) {
    console.log(`\n🚀 [Cron] 开始执行每日合并任务...`);
    const logs = [];

    try {
        // ==========================================
        // 任务 A: 抓取币安汇率 (★ 已修正显示逻辑 ★)
        // ==========================================
        console.log("👉 [Task 1] 正在更新汇率...");
        
        const [usdtToCny, usdtToAed] = await Promise.all([
            fetchBinanceP2P("CNY", ["BANK", "ALIPAY", "WECHAT"]),
            fetchBinanceP2P("AED", ["BANK"]) 
        ]);

        if (usdtToCny) {
            const finalUsdtAed = usdtToAed || 3.6725;
            const aedToCny = parseFloat((usdtToCny / finalUsdtAed).toFixed(4));
            
            await db.collection('bitledger_storage').doc('global_config').set({
                rates: {
                    USDT: usdtToCny,
                    AED: aedToCny,
                    USDT_AED: finalUsdtAed,
                    CNY: 1,
                    updateTime: new Date().toISOString(),
                    source: 'Binance P2P'
                }
            }, { merge: true });

            logs.push(`✅ 汇率更新: USDT/CNY=${usdtToCny}, USDT/AED=${finalUsdtAed}`);
            
            // ★ 修改点：改为显示 USDT/AED
            await sendTelegramMessage(
                `💹 <b>每日汇率</b>\n🇨🇳 USDT/CNY: <code>${usdtToCny}</code>\n🇦🇪 USDT/AED: <code>${finalUsdtAed}</code>`,
                'HTML' // 明确指定 HTML 模式，防止标签失效
            );
        } else {
            console.error("❌ 汇率获取失败");
        }

        // ==========================================
        // 任务 B: 计算利息 (保持原样，一个字没动)
        // ==========================================
        console.log("👉 [Task 2] 正在计算利息...");

        const docRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            let data = docSnap.data();
            let state = data.state;
            let accounts = state.accounts || [];
            let transactions = state.transactions || [];
            let updated = false;
            let yieldCount = 0;

            const now = new Date();
            const dubaiOffset = 4 * 60 * 60 * 1000;
            const dubaiNow = new Date(now.getTime() + dubaiOffset);
            dubaiNow.setUTCHours(0, 0, 0, 0);
            const interestDateISO = new Date(dubaiNow.getTime() - dubaiOffset).toISOString();

            for (let acc of accounts) {
                const currentBal = parseFloat(acc.balance) || 0;
                if (currentBal > 0) {
                    const limit = parseFloat(acc.tierLimit) || 0; 
                    const baseApy = parseFloat(acc.apy || 0) / 100;      
                    const excessApy = parseFloat(acc.excessApy || 0) / 100; 

                    let rawInterest = 0;
                    if (limit > 0 && currentBal > limit) {
                        rawInterest = ((limit * baseApy) + ((currentBal - limit) * excessApy)) / 365;
                    } else {
                        rawInterest = (currentBal * baseApy) / 365;
                    }

                    let interest = 0;
                    if (acc.name.toLowerCase().includes('okx') || acc.id.toLowerCase().includes('okx')) {
                        interest = Math.floor(rawInterest * 100) / 100;
                    } else {
                        interest = Math.floor(rawInterest * 1000000) / 1000000;
                    }

                    if (interest > 0) {
                        acc.balance += interest;
                        transactions.push({
                            id: Date.now() + Math.random(),
                            type: 'income',
                            amount: interest,
                            currency: acc.currency,
                            accountId: acc.id,
                            category: 'interest',
                            date: interestDateISO,
                            note: `收益 ${acc.apy}%`,
                            isAuto: true,
                            source: 'vercel_cron'
                        });
                        updated = true;
                        yieldCount++;
                        logs.push(`💰 [${acc.name}] +${interest} ${acc.currency}`);
                    }
                }
            }

            if (updated) {
                await docRef.update({
                    'state.accounts': accounts,
                    'state.transactions': transactions,
                    'state.lastInterestDate': interestDateISO,
                    'updatedAt': new Date()
                });
                logs.push(`✅ ${yieldCount} 个账户已派息`);
            }
        }

        // ==========================================
        // 任务 C: USDG 新闻监控 (★ 已优化链接显示 ★)
        // ==========================================
        console.log("👉 [Task 3] 正在监控 USDG 新闻...");
        
        try {
            const query = encodeURIComponent('"Global Dollar" OR ("USDG" AND "Paxos") when:1d');
            const feedUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
            
            const feed = await parser.parseURL(feedUrl);

            if (feed.items && feed.items.length > 0) {
                const newsList = feed.items.slice(0, 10).map((item, index) => {
                    return `${index + 1}. [标题] ${item.title} \n   [链接] ${item.link} \n   [时间] ${item.pubDate}`;
                }).join("\n\n");

                const proxyUrl = "https://gemini-proxy.aratakitofood.workers.dev/";
                
                const systemPrompt = `
                你是一个加密货币风险控制专家。你的任务是阅读新闻并撰写 "USDG (Global Dollar)" 的风险简报。

                【新闻列表】：
                ${newsList}

                【严格过滤规则】：
                1. **只关注** 由 Paxos 发行的 "USDG" (Global Dollar)。
                2. **绝对忽略** Klarna、PayPal (PYUSD) 等无关稳定币。

                【输出要求】：
                1. 语言：中文。
                2. 格式：适合 Telegram 阅读 (Markdown)。
                3. **风险检测**：重点检测脱钩、监管调查、储备金不足、黑客攻击、盗取、合约漏洞等。
                4. **链接格式 (重要)**：在提到具体新闻时，不要直接贴 URL，请务必将其封装为 Markdown 链接，格式为：[阅读原文](URL)。
                5. **无论是否有风险，都必须生成简报**：
                   - 如果有风险：开头用 ⚠️⚠️⚠️ 高亮警告。
                   - 如果无风险：开头写 “✅ 今日 USDG 运行平稳”，然后**紧接着总结新闻里提到的正面进展或合作消息**。
                `;

                const aiRes = await fetch(proxyUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }] })
                });

                if (aiRes.ok) {
                    const aiData = await aiRes.json();
                    if (aiData.candidates && aiData.candidates[0].content) {
                        const report = aiData.candidates[0].content.parts[0].text;
                        if (!report.includes("无 USDG 相关新闻")) {
                             logs.push("✅ 新闻简报生成成功");
                             // ★ 这里使用 Markdown 模式，确保 [阅读原文](URL) 能变成可点击的链接
                             await sendTelegramMessage(report, 'Markdown');
                        } else {
                             logs.push("📭 今日新闻与 USDG 无关");
                        }
                    }
                }
            } else {
                logs.push("📭 今日无相关新闻");
            }
        } catch (newsErr) {
            console.error("News Task Failed:", newsErr);
            logs.push("❌ 新闻监控失败");
        }

        return res.status(200).json({ success: true, logs });

    } catch (error) {
        console.error("Cron Error:", error);
        return res.status(500).json({ error: error.message });
    }
}

// --- 辅助函数 ---
async function fetchBinanceP2P(fiat, payTypes) {
    try {
        const res = await fetch("https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fiat, page: 1, rows: 5, tradeType: "SELL", asset: "USDT", payTypes })
        });
        const json = await res.json();
        if (!json.data || json.data.length === 0) return null;
        let total = 0; json.data.forEach(ad => { total += parseFloat(ad.adv.price); });
        return parseFloat((total / json.data.length).toFixed(4));
    } catch (e) { return null; }
}

async function sendTelegramMessage(text, parseMode = 'HTML') {
    const token = process.env.TG_BOT_TOKEN;
    const chatId = process.env.TG_CHAT_ID;
    if (!token || !chatId) return;
    
    // 简单的 Markdown 链接转义处理 (防止 URL 中的特殊字符破坏 Markdown 解析)
    // 注意：如果是 Markdown 模式，尽量保证 AI 输出的 URL 是干净的
    
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            chat_id: chatId, 
            text: text, 
            parse_mode: parseMode,
            disable_web_page_preview: true // 加上这个，防止链接自动展开占用屏幕
        }) 
    });
}
