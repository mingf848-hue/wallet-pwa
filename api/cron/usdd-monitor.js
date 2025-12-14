import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import Parser from 'rss-parser';

// ================= 初始化配置 =================
// 复用你原有的 Firebase 鉴权逻辑，防止 Vercel 报错
if (getApps().length === 0) {
    if (process.env.BITLEDGER_KEY) {
        const serviceAccount = JSON.parse(process.env.BITLEDGER_KEY);
        initializeApp({
            credential: cert(serviceAccount)
        });
    } else {
        console.warn("⚠️ 未检测到 BITLEDGER_KEY，Firebase 未初始化 (仅运行新闻监控)");
    }
}

// 即使不存库，保留 db 引用以防后续扩展
const db = getApps().length > 0 ? getFirestore() : null;
const parser = new Parser();

// AI 代理地址
const AI_PROXY_URL = "https://gemini-proxy.aratakitofood.workers.dev/";

// ================= 主处理函数 =================
export default async function handler(req, res) {
    console.log(`\n🚀 [Cron] USDD 风险监控任务启动...`);
    const logs = [];

    try {
        // 1. 定义高危关键词 (USDD, 孙宇晨, 脱钩, 储备金)
// ✅ 修改后：增加了黑客、漏洞、被盗等关键词
const query = encodeURIComponent(
    '"USDD" AND (' +
    '"hack" OR "hacker" OR "exploit" OR "attack" OR "drain" OR ' + // 黑客相关
    '"depeg" OR "unpeg" OR ' +                                    // 脱钩相关
    '"reserve" OR "insolvent" OR ' +                              // 储备金/破产
    '"Justin Sun"' +                                              // 孙宇晨风险
    ') when:7d'
);
        const feedUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

        logs.push(`🔍 正在抓取 RSS: ${decodeURIComponent(query)}`);
        
        const feed = await parser.parseURL(feedUrl);
// 修改测试代码段
feed.items = [{
    title: "BREAKING: USDD Stablecoin Hacked, Treasury Drained",
    // 👇 把 URL 改得像真的，AI 就不敢轻易判定为假新闻了
    link: "https://www.coindesk.com/business/2025/12/15/usdd-hacked-critical", 
    pubDate: new Date().toUTCString(),
    content: "Reports confirm USDD smart contract has been exploited. 500M assets stolen."
}];

        if (!feed.items || feed.items.length === 0) {
            logs.push("📭 今日无相关新闻");
            return res.status(200).json({ success: true, logs });
        }

        // 2. 截取前 6 条新闻喂给 AI
        const newsList = feed.items.slice(0, 6).map((item, index) => {
            return `${index + 1}. [标题] ${item.title} \n   [链接] ${item.link} \n   [时间] ${item.pubDate}`;
        }).join("\n\n");

        logs.push(`📡 获取到 ${feed.items.length} 条新闻，正在请求 AI 分析...`);

        // 3. 构建 Prompt (强制 JSON 格式)
        const systemPrompt = `
        你是一个加密货币风控专家。请分析以下关于 **USDD (Tron/波场)** 的新闻。

        【新闻列表】：
        ${newsList}

        【分析目标】：
        判断是否存在 **高危风险**：脱钩 (Depeg)、储备金不足 (Reserve Drained)、孙宇晨 (Justin Sun) 被捕/起诉、无法赎回、黑客攻击。

        【必须返回 JSON 格式】：
        请严格直接返回 JSON 字符串，不要包含 markdown 代码块 (如 \`\`\`json)。格式如下：
        {
            "risk_level": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
            "should_alert": boolean,
            "title": "简短中文标题 (如: USDD 出现严重脱钩)",
            "summary": "中文简报 (100字以内)，概括核心风险点。支持 Markdown 链接格式 [文字](URL)。",
            "is_irrelevant": boolean
        }

        【判断标准】：
        - CRITICAL/HIGH (should_alert=true): 发生脱钩、官方承认问题、监管重拳、合约被黑。
        - MEDIUM/LOW (should_alert=false): 正常的市场波动、无关新闻、或正面新闻。
        - is_irrelevant: 如果新闻完全与 USDD 无关，设为 true。
        `;

        // 4. 调用 AI
        const aiRes = await fetch(AI_PROXY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }] })
        });

        if (aiRes.ok) {
            const aiData = await aiRes.json();
            const rawText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (rawText) {
                // 清理 Markdown 标记，确保 JSON.parse 成功
                const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                
                try {
                    const analysis = JSON.parse(cleanJson);
                    logs.push(`🤖 AI 分析结果: [${analysis.risk_level}] ${analysis.title}`);

                    // 5. 决策：只有高风险才通知 (避免骚扰)
                    if (analysis.should_alert === true) {
                        const alertMsg = `
🚨🚨🚨 **USDD 紧急风险警报**

**等级**：${analysis.risk_level}
**事件**：${analysis.title}

**分析**：
${analysis.summary}

⚠️ _系统监测到异常负面指标，建议立即关注或赎回。_
                        `.trim();
                        
                        await sendTelegramMessage(alertMsg);
                        logs.push("📨 紧急警报已发送 Telegram");

                    } else if (analysis.risk_level === "MEDIUM") {
                        // 中等风险也可以选择性通知，或者只记录日志
                        logs.push("⚠️ 中等风险，暂不打扰"); 
                    } else {
                        logs.push("✅ 低风险/无风险，运行平稳");
                    }

                } catch (jsonErr) {
                    console.error("JSON Parse Error:", jsonErr, rawText);
                    logs.push("❌ JSON 解析失败，AI 返回格式异常");
                }
            }
        } else {
            logs.push("❌ AI 接口请求失败");
        }

    } catch (error) {
        console.error("Cron Error:", error);
        return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true, logs });
}

// ================= 辅助函数 =================

async function sendTelegramMessage(text) {
    const token = process.env.TG_BOT_TOKEN;
    const chatId = process.env.TG_CHAT_ID;
    
    if (!token || !chatId) {
        console.warn("❌ 缺少 TG_BOT_TOKEN 或 TG_CHAT_ID，无法发送消息");
        return;
    }
    
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                chat_id: chatId, 
                text: text, 
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            }) 
        });
    } catch (e) {
        console.error("Telegram Send Error:", e);
    }
}
