import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// 1. 初始化 Firebase
if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.BITLEDGER_KEY);
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();
// 你的文档 ID
const GLOBAL_WALLET_DOC_ID = 'my_personal_wallet_v2';

export default async function handler(req, res) {
    console.log("⏰ [External Cron] 开始检查提醒...");

    try {
        const now = new Date();
        const remindersRef = db.collection('bitledger_storage').doc(GLOBAL_WALLET_DOC_ID).collection('reminders');
        
        // 查询所有“待发送”的提醒
        const snapshot = await remindersRef.where('status', '==', 'pending').get();

        if (snapshot.empty) {
            return res.status(200).json({ message: "无待办提醒" });
        }

        let sentCount = 0;
        const batch = db.batch();

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const targetTime = new Date(data.targetTime);

            // 如果当前时间 >= 设定时间 (说明时间到了)
            if (now >= targetTime) {
                // 发送推送
                const timeStr = targetTime.toLocaleString('zh-CN', {timeZone: 'Asia/Dubai', hour12: false});
                await sendTelegramMessage(data.chatId, `🔔 <b>提醒事项</b>\n\n📌 <b>${data.note}</b>\n\n<i>(设定时间: ${timeStr})</i>`);
                
                // 标记为已完成 (防止重复发)
                batch.update(doc.ref, { status: 'completed', sentAt: now.toISOString() });
                sentCount++;
            }
        }

        if (sentCount > 0) {
            await batch.commit();
            console.log(`✅ 已推送 ${sentCount} 条提醒`);
        }

        return res.status(200).json({ success: true, sent: sentCount });

    } catch (error) {
        console.error("Reminder Error:", error);
        return res.status(500).json({ error: error.message });
    }
}

// TG 发送函数
async function sendTelegramMessage(chatId, text) {
    const token = process.env.TG_BOT_TOKEN;
    if (!token) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML" })
    });
}
