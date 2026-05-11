const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PROVIDERS = {
  anthropic: {
    keyEnv: 'ANTHROPIC_API_KEY',
    getUrl: () => 'https://api.anthropic.com/v1/messages',
    getHeaders: (key) => ({
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    buildBody: ({ prompt, pdfBase64, pdfMediaType, max_tokens }) => {
      const content = [];
      if (pdfBase64 && pdfMediaType)
        content.push({ type: 'document', source: { type: 'base64', media_type: pdfMediaType, data: pdfBase64 } });
      content.push({ type: 'text', text: prompt });
      return JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens, messages: [{ role: 'user', content }] });
    },
    parseResp: (data) => {
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return (data.content || []).map(b => b.text || '').join('');
    }
  },

  gemini: {
    keyEnv: 'GEMINI_API_KEY',
    getUrl: (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
    getHeaders: () => ({ 'Content-Type': 'application/json' }),
    buildBody: ({ prompt, max_tokens }) => JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: max_tokens }
    }),
    parseResp: (data) => {
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
  },

  groq: {
    keyEnv: 'GROQ_API_KEY',
    getUrl: () => 'https://api.groq.com/openai/v1/chat/completions',
    getHeaders: (key) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }),
    buildBody: ({ prompt, max_tokens }) => JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens,
      messages: [{ role: 'user', content: prompt }]
    }),
    parseResp: (data) => {
      if (data.error) throw new Error(typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error)));
      return data.choices?.[0]?.message?.content || '';
    }
  },

  mistral: {
    keyEnv: 'MISTRAL_API_KEY',
    getUrl: () => 'https://api.mistral.ai/v1/chat/completions',
    getHeaders: (key) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }),
    buildBody: ({ prompt, max_tokens }) => JSON.stringify({
      model: 'mistral-small-latest',
      max_tokens,
      messages: [{ role: 'user', content: prompt }]
    }),
    parseResp: (data) => {
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.choices?.[0]?.message?.content || '';
    }
  },

  openai: {
    keyEnv: 'OPENAI_API_KEY',
    getUrl: () => 'https://api.openai.com/v1/chat/completions',
    getHeaders: (key) => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }),
    buildBody: ({ prompt, max_tokens }) => JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens,
      messages: [{ role: 'user', content: prompt }]
    }),
    parseResp: (data) => {
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.choices?.[0]?.message?.content || '';
    }
  }
};

// Startup log
console.log('\n=== RMA One Pager — Provider Status ===');
Object.entries(PROVIDERS).forEach(([name, cfg]) => {
  const k = process.env[cfg.keyEnv];
  console.log(`  ${name.padEnd(10)}: ${k ? 'CONFIGURED (' + k.slice(0,10) + '...)' : 'not set'}`);
});
console.log('=======================================\n');

// GET /api/providers
app.get('/api/providers', (req, res) => {
  const available = Object.entries(PROVIDERS)
    .filter(([, cfg]) => { const k = process.env[cfg.keyEnv]; return k && k.trim().length > 0; })
    .map(([name]) => name);
  console.log('[/api/providers]', available);
  res.json({ providers: available });
});

// GET /api/health  — debug endpoint
app.get('/api/health', (req, res) => {
  const status = {};
  Object.entries(PROVIDERS).forEach(([n, cfg]) => { status[n] = !!process.env[cfg.keyEnv]; });
  res.json({ ok: true, node: process.version, providers: status });
});

// POST /api/ai
app.post('/api/ai', async (req, res) => {
  const { provider = 'groq', prompt, max_tokens = 1500, pdfBase64, pdfMediaType } = req.body;
  console.log(`[/api/ai] provider=${provider}`);

  const cfg = PROVIDERS[provider];
  if (!cfg) return res.status(400).json({ error: `Unknown provider: ${provider}` });

  const apiKey = process.env[cfg.keyEnv];
  if (!apiKey || !apiKey.trim())
    return res.status(503).json({ error: `${provider} key not configured. Render > Environment mein ${cfg.keyEnv} add karo.` });

  try {
    const url  = cfg.getUrl(apiKey);
    const hdrs = cfg.getHeaders(apiKey);
    const body = cfg.buildBody({ prompt, pdfBase64, pdfMediaType, max_tokens });
    const r    = await fetch(url, { method: 'POST', headers: hdrs, body });
    const data = await r.json();
    const text = cfg.parseResp(data);
    console.log(`[/api/ai] ${provider} ok len=${text.length}`);
    res.json({ text });
  } catch (err) {
    console.error(`[/api/ai] ${provider} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
