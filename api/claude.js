export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { provider = 'gemini', ...body } = req.body;

  try {
    if (provider === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

      const model = body.model || 'gemini-2.5-flash';

      // Anthropic mesaj formatını Gemini'ye çevir
      const parts = [];
      for (const msg of (body.messages || [])) {
        if (Array.isArray(msg.content)) {
          for (const c of msg.content) {
            if (c.type === 'text') parts.push({ text: c.text });
            else if (c.type === 'image') parts.push({ inlineData: { mimeType: c.source.media_type, data: c.source.data } });
          }
        } else {
          parts.push({ text: msg.content });
        }
      }

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: { maxOutputTokens: body.max_tokens || 2000, temperature: 0.3 }
          })
        }
      );

      const data = await geminiRes.json();
      if (!geminiRes.ok) return res.status(geminiRes.status).json(data);

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return res.status(200).json({ content: [{ type: 'text', text }] });

    } else {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
