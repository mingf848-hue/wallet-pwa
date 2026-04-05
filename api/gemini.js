export default async function handler(req, res) {
    // 只允许 POST 请求
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const { prompt, imageBase64, model } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ error: "Vercel 环境变量中缺少 GEMINI_API_KEY" });
        }

        // 使用前端请求指定的模型，默认回退为 gemini-3-flash-preview
        const useModel = model || "gemini-3-flash-preview";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${apiKey}`;

        const parts = [{ text: prompt }];

        // 如果前端传了图片过来（用于网页版相机的识图记账）
        if (imageBase64) {
            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
            parts.push({
                inline_data: { mime_type: "image/jpeg", data: base64Data }
            });
        }

        const payload = {
            contents: [{ parts: parts }]
        };

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Google API Request Failed (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        return res.status(200).json(data);

    } catch (error) {
        console.error("Handler Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
