const express  = require('express');
const path     = require('path');
const pdfParse = require('pdf-parse');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── PROVIDER CONFIG ──────────────────────────────────────────────────────────
const PROVIDERS = {
  anthropic: {
    keyEnv: 'ANTHROPIC_API_KEY',
    supportsPdf: true,   // can receive raw PDF bytes
    maxTokens: 2000,
    getUrl:    () => 'https://api.anthropic.com/v1/messages',
    getHeaders:(key) => ({ 'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01' }),
    buildBody: ({ prompt, pdfBase64, pdfMediaType, max_tokens }) => {
      const content = [];
      if (pdfBase64 && pdfMediaType)
        content.push({ type:'document', source:{ type:'base64', media_type:pdfMediaType, data:pdfBase64 } });
      content.push({ type:'text', text:prompt });
      return JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens, messages:[{ role:'user', content }] });
    },
    parseResp: (data) => {
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return (data.content || []).map(b => b.text || '').join('');
    }
  },

  gemini: {
    keyEnv: 'GEMINI_API_KEY',
    supportsPdf: false,
    maxTokens: 2000,
    getUrl:    (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
    getHeaders:() => ({ 'Content-Type':'application/json' }),
    buildBody: ({ prompt, max_tokens }) => JSON.stringify({
      contents: [{ parts:[{ text:prompt }] }],
      generationConfig: { maxOutputTokens: max_tokens }
    }),
    parseResp: (data) => {
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
  },

  groq: {
    keyEnv: 'GROQ_API_KEY',
    supportsPdf: false,
    maxTokens: 2000,
    getUrl:    () => 'https://api.groq.com/openai/v1/chat/completions',
    getHeaders:(key) => ({ 'Content-Type':'application/json','Authorization':`Bearer ${key}` }),
    buildBody: ({ prompt, max_tokens }) => JSON.stringify({
      model:'llama-3.3-70b-versatile',
      max_tokens,
      messages:[{ role:'user', content:prompt }]
    }),
    parseResp: (data) => {
      if (data.error) throw new Error(typeof data.error==='string' ? data.error : (data.error.message || JSON.stringify(data.error)));
      return data.choices?.[0]?.message?.content || '';
    }
  },

  mistral: {
    keyEnv: 'MISTRAL_API_KEY',
    supportsPdf: false,
    maxTokens: 2000,
    getUrl:    () => 'https://api.mistral.ai/v1/chat/completions',
    getHeaders:(key) => ({ 'Content-Type':'application/json','Authorization':`Bearer ${key}` }),
    buildBody: ({ prompt, max_tokens }) => JSON.stringify({
      model:'mistral-small-latest',
      max_tokens,
      messages:[{ role:'user', content:prompt }]
    }),
    parseResp: (data) => {
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.choices?.[0]?.message?.content || '';
    }
  },

  openai: {
    keyEnv: 'OPENAI_API_KEY',
    supportsPdf: false,
    maxTokens: 2000,
    getUrl:    () => 'https://api.openai.com/v1/chat/completions',
    getHeaders:(key) => ({ 'Content-Type':'application/json','Authorization':`Bearer ${key}` }),
    buildBody: ({ prompt, max_tokens }) => JSON.stringify({
      model:'gpt-4o-mini',
      max_tokens,
      messages:[{ role:'user', content:prompt }]
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

// ── Helper: extract text from PDF base64 ────────────────────────────────────
async function extractPdfText(base64) {
  const buf = Buffer.from(base64, 'base64');
  try {
    const data = await pdfParse(buf);
    let text = data.text || '';
    // Fix merged words: split camelCase boundaries common in OCR PDFs
    text = text
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n');
    console.log(`[pdf-parse] extracted ${text.length} chars, ${data.numpages} pages`);
    return text.slice(0, 14000); // send up to 14k chars to AI
  } catch (e) {
    console.error('[pdf-parse] error:', e.message);
    throw new Error('PDF text extract failed: ' + e.message);
  }
}

// ── Build full prompt with extracted text ────────────────────────────────────
function buildExtractionPrompt(pdfText) {
  return `You are a financial data extraction expert. Extract structured fields from this bank loan DPR (Detailed Project Report) text.

STRICT RULES:
1. Return ONLY valid JSON — no markdown backticks, no explanation
2. cName = ONLY the legal company name (e.g. "Hindustan Dhaatu Limited") — NEVER include words like "Project Report", "Set up of", "FOR", "DPR on", "Manufacturing of", "Prepared by"
3. All financial amounts in Indian Rupees CRORES. If Lakhs found, divide by 100
4. incDate = YYYY-MM-DD format or empty string ""
5. const = exactly one of: "Private Limited Company", "Public Limited Company", "LLP", "Partnership Firm", "Proprietorship"
6. Numbers = plain digits only like "9.50" — no Rs, no Cr, no commas
7. Leave field as "" if NOT clearly found

JSON to return (all fields required, use "" if not found):
{"cName":"","const":"","incDate":"","activity":"","capacity":"","regAddr":"","factAddr":"","directors":"","keyPerson":"","err":"","tlAmt":"","arrType":"","cLand":"","cShed":"","cPM":"","cDep":"","cConting":"","cPreOp":"","cWCM":"","mPC":"","mUL":"","mBTL":"","mWCFB":"","mWCNFB":"","coBrief":"","mgBrief":"","collateral":"","associates":""}

DPR TEXT:
${pdfText}`;
}

// ── GET /api/providers ───────────────────────────────────────────────────────
app.get('/api/providers', (req, res) => {
  const available = Object.entries(PROVIDERS)
    .filter(([, cfg]) => { const k = process.env[cfg.keyEnv]; return k && k.trim().length > 0; })
    .map(([name]) => name);
  console.log('[/api/providers] returning:', available);
  res.json({ providers: available });
});

// ── GET /api/health ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const status = {};
  Object.entries(PROVIDERS).forEach(([n, cfg]) => { status[n] = !!process.env[cfg.keyEnv]; });
  res.json({ ok:true, node:process.version, providers:status });
});

// ── POST /api/ai ─────────────────────────────────────────────────────────────
app.post('/api/ai', async (req, res) => {
  const { provider = 'groq', prompt, max_tokens = 2000, pdfBase64, pdfMediaType } = req.body;
  console.log(`[/api/ai] provider=${provider} hasPdf=${!!pdfBase64} promptLen=${prompt?.length}`);

  const cfg = PROVIDERS[provider];
  if (!cfg) return res.status(400).json({ error: `Unknown provider: ${provider}` });

  const apiKey = process.env[cfg.keyEnv];
  if (!apiKey || !apiKey.trim())
    return res.status(503).json({ error: `${provider} key not configured. Render > Environment mein ${cfg.keyEnv} add karo.` });

  try {
    let finalPrompt = prompt;
    let usePdfBase64 = null;

    // If PDF provided:
    if (pdfBase64) {
      if (cfg.supportsPdf) {
        // Anthropic: pass PDF directly
        usePdfBase64 = pdfBase64;
      } else {
        // Others: extract text server-side, inject into prompt
        console.log(`[/api/ai] ${provider} does not support PDF — extracting text server-side`);
        const pdfText = await extractPdfText(pdfBase64);
        finalPrompt = buildExtractionPrompt(pdfText);
      }
    }

    const url     = cfg.getUrl(apiKey);
    const headers = cfg.getHeaders(apiKey);
    const body    = cfg.buildBody({
      prompt:      finalPrompt,
      pdfBase64:   usePdfBase64,
      pdfMediaType: pdfMediaType,
      max_tokens:  cfg.maxTokens
    });

    const fetchRes = await fetch(url, { method:'POST', headers, body });
    const data     = await fetchRes.json();
    const text     = cfg.parseResp(data);

    console.log(`[/api/ai] ${provider} OK len=${text.length}`);
    res.json({ text });

  } catch (err) {
    console.error(`[/api/ai] ${provider} ERROR:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ocr-ai ─────────────────────────────────────────────────────────
// OCR AI Fill: receives already-extracted OCR text, sends to AI
app.post('/api/ocr-ai', async (req, res) => {
  const { provider = 'groq', ocrText, max_tokens = 2000 } = req.body;
  console.log(`[/api/ocr-ai] provider=${provider} textLen=${ocrText?.length}`);

  const cfg = PROVIDERS[provider];
  if (!cfg) return res.status(400).json({ error: `Unknown provider: ${provider}` });

  const apiKey = process.env[cfg.keyEnv];
  if (!apiKey || !apiKey.trim())
    return res.status(503).json({ error: `${provider} key not configured.` });

  try {
    const prompt   = buildExtractionPrompt(ocrText.slice(0, 14000));
    const url      = cfg.getUrl(apiKey);
    const headers  = cfg.getHeaders(apiKey);
    const body     = cfg.buildBody({ prompt, max_tokens: cfg.maxTokens });
    const fetchRes = await fetch(url, { method:'POST', headers, body });
    const data     = await fetchRes.json();
    const text     = cfg.parseResp(data);
    console.log(`[/api/ocr-ai] ${provider} OK len=${text.length}`);
    res.json({ text });
  } catch (err) {
    console.error(`[/api/ocr-ai] ${provider} ERROR:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
