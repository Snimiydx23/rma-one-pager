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
    supportsPdf: true,
    maxTokens: 3000,
    getUrl:    () => 'https://api.anthropic.com/v1/messages',
    getHeaders:(k) => ({ 'Content-Type':'application/json','x-api-key':k,'anthropic-version':'2023-06-01' }),
    buildBody: ({ prompt, pdfBase64, pdfMediaType, max_tokens }) => {
      const content = [];
      if (pdfBase64 && pdfMediaType)
        content.push({ type:'document', source:{ type:'base64', media_type:pdfMediaType, data:pdfBase64 } });
      content.push({ type:'text', text:prompt });
      return JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens, messages:[{ role:'user', content }] });
    },
    parseResp: (d) => {
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
      return (d.content || []).map(b => b.text || '').join('');
    }
  },
  gemini: {
    keyEnv: 'GEMINI_API_KEY',
    supportsPdf: false,
    maxTokens: 3000,
    getUrl:    (k) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${k}`,
    getHeaders:() => ({ 'Content-Type':'application/json' }),
    buildBody: ({ prompt, max_tokens }) => JSON.stringify({
      contents:[{ parts:[{ text:prompt }] }],
      generationConfig:{ maxOutputTokens:max_tokens, temperature:0.1 }
    }),
    parseResp: (d) => {
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
      return d.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
  },
  groq: {
    keyEnv: 'GROQ_API_KEY',
    supportsPdf: false,
    maxTokens: 4000,
    getUrl:    () => 'https://api.groq.com/openai/v1/chat/completions',
    getHeaders:(k) => ({ 'Content-Type':'application/json','Authorization':`Bearer ${k}` }),
    buildBody: ({ prompt, max_tokens }) => JSON.stringify({
      model:'llama-3.3-70b-versatile',
      max_tokens,
      temperature: 0.1,
      messages:[{ role:'user', content:prompt }]
    }),
    parseResp: (d) => {
      if (d.error) throw new Error(typeof d.error==='string' ? d.error : (d.error.message || JSON.stringify(d.error)));
      return d.choices?.[0]?.message?.content || '';
    }
  },
  mistral: {
    keyEnv: 'MISTRAL_API_KEY',
    supportsPdf: false,
    maxTokens: 3000,
    getUrl:    () => 'https://api.mistral.ai/v1/chat/completions',
    getHeaders:(k) => ({ 'Content-Type':'application/json','Authorization':`Bearer ${k}` }),
    buildBody: ({ prompt, max_tokens }) => JSON.stringify({
      model:'mistral-small-latest', max_tokens, temperature:0.1,
      messages:[{ role:'user', content:prompt }]
    }),
    parseResp: (d) => {
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
      return d.choices?.[0]?.message?.content || '';
    }
  },
  openai: {
    keyEnv: 'OPENAI_API_KEY',
    supportsPdf: false,
    maxTokens: 3000,
    getUrl:    () => 'https://api.openai.com/v1/chat/completions',
    getHeaders:(k) => ({ 'Content-Type':'application/json','Authorization':`Bearer ${k}` }),
    buildBody: ({ prompt, max_tokens }) => JSON.stringify({
      model:'gpt-4o-mini', max_tokens, temperature:0.1,
      messages:[{ role:'user', content:prompt }]
    }),
    parseResp: (d) => {
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
      return d.choices?.[0]?.message?.content || '';
    }
  }
};

// Startup log
console.log('\n=== RMA One Pager — Provider Status ===');
Object.entries(PROVIDERS).forEach(([name, cfg]) => {
  const k = process.env[cfg.keyEnv];
  console.log(`  ${name.padEnd(10)}: ${k ? 'OK (' + k.slice(0,12) + '...)' : 'not set'}`);
});
console.log('=======================================\n');

// ── PDF text extractor ───────────────────────────────────────────────────────
async function extractPdfText(base64) {
  const buf = Buffer.from(base64, 'base64');
  const data = await pdfParse(buf);
  let text = data.text || '';
  // Fix merged camelCase words common in pdf-parse output
  text = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  console.log(`[pdf] ${data.numpages} pages, ${text.length} chars`);
  return text;
}

// ── Smart number parser: detects Lakhs vs Crores ────────────────────────────
function detectUnit(text) {
  // Count occurrences to decide dominant unit
  const crMatch = (text.match(/\b(crore|cr\.)/gi) || []).length;
  const lkMatch = (text.match(/\b(lakh|lac|lakhs)\b/gi) || []).length;
  return lkMatch > crMatch ? 'lakhs' : 'crores';
}

// ── Build extraction prompt ──────────────────────────────────────────────────
function buildExtractionPrompt(pdfText) {
  // Detect unit in this document
  const unit = detectUnit(pdfText);
  const unitNote = unit === 'lakhs'
    ? 'IMPORTANT: This document uses LAKHS. Convert ALL amounts to CRORES by dividing by 100. Example: 5721.03 Lakhs = 57.21 Crores.'
    : 'Amounts are already in CRORES. Use as-is.';

  // Trim to fit context (send up to 16k chars)
  const trimmed = pdfText.slice(0, 16000);

  return `You are extracting financial data from an Indian bank loan DPR (Detailed Project Report) for a One Pager template.

${unitNote}

STRICT RULES — follow exactly:
1. Output ONLY a raw JSON object. No markdown, no backticks, no explanation before or after.
2. cName: Legal company name ONLY. Examples: "Hindustan Dhaatu Limited", "Awadh Cold Storage Pvt. Ltd."
   - NEVER include: "Project Report", "Set up of", "FOR", "DPR", "Prepared by", "Manufacturing of"
3. const: EXACTLY one of these strings: "Private Limited Company" / "Public Limited Company" / "LLP" / "Partnership Firm" / "Proprietorship"
4. incDate: YYYY-MM-DD format only. Example: "2021-03-15". Empty string if not found.
5. All numeric fields (cLand, cShed, cPM, etc.): plain decimal number in CRORES. Example: "57.21"
   - No commas, no "Rs", no "Cr", no "Lakhs" — just the number
   - If amount is in Lakhs, divide by 100 before returning
   - Empty string "" if the field is zero or not found
6. tlAmt: Total Term Loan amount in Crores
7. arrType: "Sole" / "Consortium" / "Multiple"
8. err: credit rating string or "Unrated"
9. All text fields: clean, concise. No extra formatting.

FIELD MAPPING (search these exact labels in the text):
- cLand  ← "Land & Site Development" or "Land Development"
- cShed  ← "Factory Shed" or "Civil Work" or "Building"  
- cPM    ← "Plant & Machinery" or "Plant and Machinery"
- cDep   ← "Deposits" or "Security Deposit"
- cConting ← "Contingencies"
- cPreOp ← "Pre-Operative" or "Preliminary" or "Pre-Op"
- cWCM   ← "Working Capital Margin" or "WC Margin"
- mPC    ← "Promoter Contribution" or "Promoter's Contribution" or "By Promoter"
- mUL    ← "Unsecured Loan" or "Quasi Equity"
- mBTL   ← "Bank Term Loan" or "Term Loan" (from bank)
- mWCFB  ← "Working Capital (Fund Based)" or "Cash Credit" or "CC Limit"
- mWCNFB ← "Working Capital (Non-Fund)" or "LC" or "BG"

Return this exact JSON structure:
{
  "cName": "",
  "const": "",
  "incDate": "",
  "activity": "",
  "capacity": "",
  "regAddr": "",
  "factAddr": "",
  "directors": "",
  "keyPerson": "",
  "err": "",
  "tlAmt": "",
  "arrType": "",
  "cLand": "",
  "cShed": "",
  "cPM": "",
  "cDep": "",
  "cConting": "",
  "cPreOp": "",
  "cWCM": "",
  "mPC": "",
  "mUL": "",
  "mBTL": "",
  "mWCFB": "",
  "mWCNFB": "",
  "coBrief": "",
  "mgBrief": "",
  "collateral": "",
  "associates": ""
}

DPR TEXT BELOW:
---
${trimmed}
---`;
}

// ── Safe JSON extractor from AI response ────────────────────────────────────
function extractJSON(raw) {
  if (!raw) throw new Error('Empty AI response');
  // Try direct parse first
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch(e) {}
  }
  // Strip markdown fences
  const stripped = trimmed.replace(/^```json\s*/i,'').replace(/```\s*$/,'').trim();
  try { return JSON.parse(stripped); } catch(e) {}
  // Find JSON object in response
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch(e) {}
    // Try fixing common AI JSON mistakes: trailing commas
    try {
      const fixed = match[0].replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(fixed);
    } catch(e) {}
  }
  throw new Error('Could not parse JSON from AI response: ' + raw.slice(0, 200));
}

// ── GET /api/providers ───────────────────────────────────────────────────────
app.get('/api/providers', (req, res) => {
  const available = Object.entries(PROVIDERS)
    .filter(([, cfg]) => { const k = process.env[cfg.keyEnv]; return k && k.trim().length > 0; })
    .map(([name]) => name);
  console.log('[providers]', available);
  res.json({ providers: available });
});

// ── GET /api/health ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const st = {};
  Object.entries(PROVIDERS).forEach(([n, c]) => { st[n] = !!process.env[c.keyEnv]; });
  res.json({ ok: true, node: process.version, providers: st });
});

// ── POST /api/ai  (AI Auto-Extract — receives PDF base64) ────────────────────
app.post('/api/ai', async (req, res) => {
  const { provider = 'groq', prompt, max_tokens, pdfBase64, pdfMediaType } = req.body;
  console.log(`[/api/ai] provider=${provider} hasPdf=${!!pdfBase64}`);

  const cfg = PROVIDERS[provider];
  if (!cfg) return res.status(400).json({ error: `Unknown provider: ${provider}` });
  const apiKey = process.env[cfg.keyEnv];
  if (!apiKey?.trim()) return res.status(503).json({ error: `${provider} key not set in environment.` });

  try {
    let finalPrompt = prompt;
    let usePdfB64   = null;

    if (pdfBase64) {
      if (cfg.supportsPdf) {
        // Anthropic: pass PDF directly — its own prompt handles extraction
        usePdfB64 = pdfBase64;
        finalPrompt = prompt; // use the simple prompt from frontend
      } else {
        // All others: extract text, build rich prompt
        const pdfText   = await extractPdfText(pdfBase64);
        finalPrompt     = buildExtractionPrompt(pdfText);
      }
    }

    const url  = cfg.getUrl(apiKey);
    const hdrs = cfg.getHeaders(apiKey);
    const body = cfg.buildBody({ prompt: finalPrompt, pdfBase64: usePdfB64, pdfMediaType, max_tokens: cfg.maxTokens });

    const r    = await fetch(url, { method:'POST', headers:hdrs, body });
    const data = await r.json();
    const text = cfg.parseResp(data);
    console.log(`[/api/ai] ${provider} ok, ${text.length} chars`);
    res.json({ text });

  } catch(err) {
    console.error(`[/api/ai] ${provider}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ocr-ai  (OCR text → AI fill) ──────────────────────────────────
app.post('/api/ocr-ai', async (req, res) => {
  const { provider = 'groq', ocrText } = req.body;
  console.log(`[/api/ocr-ai] provider=${provider} len=${ocrText?.length}`);

  const cfg = PROVIDERS[provider];
  if (!cfg) return res.status(400).json({ error: `Unknown provider: ${provider}` });
  const apiKey = process.env[cfg.keyEnv];
  if (!apiKey?.trim()) return res.status(503).json({ error: `${provider} key not set.` });

  try {
    const prompt = buildExtractionPrompt((ocrText||'').slice(0, 16000));
    const url    = cfg.getUrl(apiKey);
    const hdrs   = cfg.getHeaders(apiKey);
    const body   = cfg.buildBody({ prompt, max_tokens: cfg.maxTokens });
    const r      = await fetch(url, { method:'POST', headers:hdrs, body });
    const data   = await r.json();
    const text   = cfg.parseResp(data);
    console.log(`[/api/ocr-ai] ${provider} ok, ${text.length} chars`);
    res.json({ text });
  } catch(err) {
    console.error(`[/api/ocr-ai] ${provider}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/parse-json  (frontend sends raw AI text, server parses safely) ─
app.post('/api/parse-json', (req, res) => {
  try {
    const obj = extractJSON(req.body.raw || '');
    res.json({ ok: true, data: obj });
  } catch(err) {
    res.status(422).json({ ok: false, error: err.message });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
