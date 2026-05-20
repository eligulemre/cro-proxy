export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = req.body;
  } catch(e) {
    return res.status(400).json({ error: 'Body parse error: ' + e.message });
  }

  const { action, provider, ...rest } = body || {};
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  // ── SUPABASE ACTIONS ──────────────────────────────────────────
  if (action) {
    const sbFetch = async (path, method = 'GET', data) => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': method === 'POST' ? 'return=representation' : '',
        },
        body: data ? JSON.stringify(data) : undefined,
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`Supabase ${method} ${path} → ${r.status}: ${text.substring(0,200)}`);
      try { return JSON.parse(text); } catch(e) { return text; }
    };

    try {
      if (action === 'getBrands') {
        const brands = await sbFetch('brands?order=created_at.asc');
        return res.status(200).json(brands);
      }

      if (action === 'saveBrand') {
        const { id, name, url } = rest;
        let result;
        if (id) {
          result = await sbFetch(`brands?id=eq.${id}`, 'PATCH', { name, url, updated_at: new Date().toISOString() });
        } else {
          result = await sbFetch('brands', 'POST', { name, url });
        }
        return res.status(200).json(Array.isArray(result) ? result[0] : result);
      }

      if (action === 'deleteBrand') {
        await sbFetch(`brands?id=eq.${rest.id}`, 'DELETE');
        return res.status(200).json({ ok: true });
      }

      if (action === 'saveFunnel') {
        const { brand_id, meta, rows } = rest;
        await sbFetch(`funnel_data?brand_id=eq.${brand_id}`, 'DELETE');
        const result = await sbFetch('funnel_data', 'POST', { brand_id, meta, rows });
        return res.status(200).json(Array.isArray(result) ? result[0] : result);
      }

      if (action === 'getFunnel') {
        const result = await sbFetch(`funnel_data?brand_id=eq.${rest.brand_id}&order=created_at.desc&limit=1`);
        const row = Array.isArray(result) ? result[0] : result;
        return res.status(200).json(row || null);
      }

      if (action === 'uploadImage') {
        const { brand_id, step_index, step_name, image_type, base64, mime_type } = rest;
        const path = `${brand_id}/${step_index}_${image_type}_${Date.now()}.png`;
        const binary = Buffer.from(base64, 'base64');

        const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/cro-images/${path}`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': mime_type || 'image/png',
          },
          body: binary,
        });

        if (!uploadRes.ok) {
          const err = await uploadRes.text();
          return res.status(500).json({ error: 'Upload failed: ' + err });
        }

        const public_url = `${SUPABASE_URL}/storage/v1/object/public/cro-images/${path}`;
        await sbFetch(`page_images?brand_id=eq.${brand_id}&step_index=eq.${step_index}&image_type=eq.${image_type}`, 'DELETE');
        await sbFetch('page_images', 'POST', { brand_id, step_index, step_name, image_type, storage_path: public_url });
        return res.status(200).json({ url: public_url });
      }

      if (action === 'getImages') {
        const result = await sbFetch(`page_images?brand_id=eq.${rest.brand_id}&order=step_index.asc`);
        return res.status(200).json(Array.isArray(result) ? result : []);
      }

      if (action === 'deleteImage') {
        const { brand_id, step_index, image_type } = rest;
        await sbFetch(`page_images?brand_id=eq.${brand_id}&step_index=eq.${step_index}&image_type=eq.${image_type}`, 'DELETE');
        return res.status(200).json({ ok: true });
      }

      if (action === 'saveHypotheses') {
        const { brand_id, hypotheses } = rest;
        // Önce eskiyi sil
        await sbFetch(`hypotheses?brand_id=eq.${brand_id}`, 'DELETE');
        // Tüm hipotezleri kaydet
        const result = await sbFetch('hypotheses', 'POST', { brand_id, hypotheses });
        return res.status(200).json(Array.isArray(result) ? result[0] : result);
      }

      if (action === 'getHypotheses') {
        const result = await sbFetch(`hypotheses?brand_id=eq.${rest.brand_id}&order=created_at.desc&limit=1`);
        const row = Array.isArray(result) ? result[0] : result;
        return res.status(200).json(row || null);
      }

      if (action === 'deleteHypothesis') {
        // Tek bir hipotezi sil (index bazlı)
        const { brand_id, step, idx } = rest;
        const result = await sbFetch(`hypotheses?brand_id=eq.${brand_id}&order=created_at.desc&limit=1`);
        const row = Array.isArray(result) ? result[0] : result;
        if(row && row.hypotheses) {
          row.hypotheses.splice(idx, 1);
          await sbFetch(`hypotheses?brand_id=eq.${brand_id}`, 'DELETE');
          await sbFetch('hypotheses', 'POST', { brand_id, hypotheses: row.hypotheses });
        }
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action: ' + action });
    } catch (err) {
      console.error('Supabase error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── AI PROXY ──────────────────────────────────────────────────
  try {
    if (provider === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });
      const model = rest.model || 'gemini-2.5-flash-lite';
      const parts = [];
      for (const msg of (rest.messages || [])) {
        if (Array.isArray(msg.content)) {
          for (const c of msg.content) {
            if (c.type === 'text') {
              parts.push({ text: c.text });
            } else if (c.type === 'image') {
              if (c.source.type === 'base64') {
                parts.push({ inlineData: { mimeType: c.source.media_type, data: c.source.data } });
              } else if (c.source.type === 'url') {
                // URL'yi fetch edip base64'e çevir
                const imgRes = await fetch(c.source.url);
                const imgBuf = await imgRes.arrayBuffer();
                const imgBase64 = Buffer.from(imgBuf).toString('base64');
                const mimeType = imgRes.headers.get('content-type') || 'image/png';
                parts.push({ inlineData: { mimeType, data: imgBase64 } });
              }
            }
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
            generationConfig: { maxOutputTokens: rest.max_tokens || 4000, temperature: 0.3 }
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
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(rest)
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    }
  } catch (err) {
    console.error('AI proxy error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
