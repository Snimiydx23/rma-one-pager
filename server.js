const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── PROVIDER CONFIG ─────────────────────────────────────────────────────────
// Keys stored as Render Environment Variables — never in code
const PROVIDERS = {
  anthropic: {
    url:     'https://api.anthropic.com/v1/messages',
    keyEnv:  'ANTHROPIC_API_KEY',
    headers: (key) => ({
      'Content-Type':             'application/json',
      'x-api-key':                key,
      'anthropic-version':        '2023-06-01',
    }),
    // Pass body as-is (already in Anthropic format)
    transform: (body) => body,
    parseResp: (data) => {
      if(data.error) throw new Error(data.error.message);
      return (data.content||[]).map(b=>b.text||'').join('');
    }
  },

  gemini: {
    url:     null, // built dynamically with key
    keyEnv:  'GEMINI_API_KEY',
    headers: () => ({ 'Content-Type': 'application/json' }),
    transform: (body) => ({
      contents: [{ parts: [{ text: body.messages?.[0]?.content || '' }] }],
      generationConfig: { maxOutputTokens: body.max_tokens || 1500 }
    }),
    getUrl: (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
    parseResp: (data) => {
      if(data.error) throw new Error(data.error.message);
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
  },

  openai: {
    url:     'https://api.openai.com/v1/chat/completions',
    keyEnv:  'OPENAI_API_KEY',
    headers: (key) => ({
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${key}`,
    }),
    transform: (body) => ({
      model:      'gpt-4o-mini',
      max_tokens: body.max_tokens || 1500,
      messages:   body.messages || []
    }),
    parseResp: (data) => {
      if(data.error) throw new Error(data.error.message);
      return data.choices?.[0]?.message?.content || '';
    }
  },

  groq: {
    url:     'https://api.groq.com/openai/v1/chat/completions',
    keyEnv:  'GROQ_API_KEY',
    headers: (key) => ({
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${key}`,
    }),
    transform: (body) => ({
      model:      'llama-3.3-70b-versatile',
      max_tokens: body.max_tokens || 1500,
      messages:   body.messages || []
    }),
    parseResp: (data) => {
      if(data.error) throw new Error(data.error.message || data.error);
      return data.choices?.[0]?.message?.content || '';
    }
  },

  mistral: {
    url:     'https://api.mistral.ai/v1/chat/completions',
    keyEnv:  'MISTRAL_API_KEY',
    headers: (key) => ({
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${key}`,
    }),
    transform: (body) => ({
      model:      'mistral-small-latest',
      max_tokens: body.max_tokens || 1500,
      messages:   body.messages || []
    }),
    parseResp: (data) => {
      if(data.error) throw new Error(data.error.message);
      return data.choices?.[0]?.message?.content || '';
    }
  }
};

// ── WHICH PROVIDERS ARE CONFIGURED ──────────────────────────────────────────
app.get('/api/providers', (req, res) => {
  const available = Object.entries(PROVIDERS)
    .filter(([, cfg]) => !!process.env[cfg.keyEnv])
    .map(([name]) => name);
  res.json({ providers: available });
});

// ── UNIFIED AI PROXY ─────────────────────────────────────────────────────────
app.post('/api/ai', async (req, res) => {
  const { provider = 'anthropic', prompt, max_tokens = 1500, pdfBase64, pdfMediaType } = req.body;

  const cfg = PROVIDERS[provider];
  if(!cfg) return res.status(400).json({ error: `Unknown provider: ${provider}` });

  const apiKey = process.env[cfg.keyEnv];
  if(!apiKey) return res.status(503).json({ error: `${provider} API key not configured on server.` });

  try {
    // Build request body based on provider
    let bodyToSend;

    if(provider === 'anthropic'){
      // Anthropic: support PDF document + text
      const content = [];
      if(pdfBase64 && pdfMediaType){
        content.push({ type:'document', source:{ type:'base64', media_type: pdfMediaType, data: pdfBase64 }});
      }
      content.push({ type:'text', text: prompt });
      bodyToSend = {
        model:      'claude-haiku-4-5-20251001',   // free-tier friendly, fast & cheap
        max_tokens,
        messages:   [{ role:'user', content }]
      };
    } else {
      // Other providers: text-only prompt
      const rawBody = {
        max_tokens,
        messages: [{ role:'user', content: prompt }]
      };
      bodyToSend = cfg.transform(rawBody);
    }

    const url = cfg.getUrl ? cfg.getUrl(apiKey) : cfg.url;
    const fetchRes = await fetch(url, {
      method:  'POST',
      headers: cfg.headers(apiKey),
      body:    JSON.stringify(bodyToSend)
    });

    const data = await fetchRes.json();
    const text = cfg.parseResp(data);
    res.json({ text });

  } catch(err) {
    console.error(`[${provider}] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CATCH-ALL → index.html ───────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`RMA One Pager Server running on port ${PORT}`));
