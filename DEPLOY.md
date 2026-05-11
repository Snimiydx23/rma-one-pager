# RMA One Pager Generator — Render Deploy Guide

## Folder Structure
```
rma-one-pager/
├── server.js          ← Express proxy server
├── package.json       ← Dependencies
└── public/
    └── index.html     ← Frontend (all-in-one)
```

---

## Step 1 — GitHub pe upload karo

1. github.com → New Repository → `rma-one-pager`
2. Teeno files upload karo (structure same rakho)
3. Commit karo

---

## Step 2 — Render pe deploy karo

1. **render.com** → Sign up (free)
2. **New** → **Web Service**
3. GitHub repo connect karo → `rma-one-pager` select karo
4. Settings:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** `Free`
5. **Create Web Service** dabao

---

## Step 3 — API Keys set karo (Environment Variables)

Render Dashboard → Your Service → **Environment** tab → Add:

| Key Name           | Value              | Free Tier                          |
|--------------------|--------------------|------------------------------------|
| ANTHROPIC_API_KEY  | sk-ant-api03-...   | $5 free credit (console.anthropic.com) |
| GEMINI_API_KEY     | AIza...            | Free (aistudio.google.com)         |
| GROQ_API_KEY       | gsk_...            | Free (console.groq.com)            |
| MISTRAL_API_KEY    | ...                | Free tier (console.mistral.ai)     |
| OPENAI_API_KEY     | sk-...             | $5 free (platform.openai.com)      |

**Sirf jinke keys ho unhe add karo — baaki optional hain.**

After adding keys → **Save Changes** → Service auto-redeploy hoga.

---

## Free API Keys Kaise Milegi

### 1. Anthropic (Claude) — $5 free credit
- console.anthropic.com → Sign up → API Keys → Create Key
- Best for PDF extraction (supports document upload)

### 2. Google Gemini — FREE (no credit card)
- aistudio.google.com → Sign in → Get API Key
- Gemini 1.5 Flash — fast & generous free tier

### 3. Groq — FREE (no credit card)
- console.groq.com → Sign up → API Keys → Create
- LLaMA 3.3 70B — very fast, generous free limits

### 4. Mistral — Free tier
- console.mistral.ai → Sign up → API Keys
- Mistral Small — lightweight

### 5. OpenAI — $5 free credit
- platform.openai.com → Sign up → API Keys
- GPT-4o Mini

---

## After Deploy

Your app will be live at: `https://rma-one-pager.onrender.com`

- Provider selector toolbar mein dikhega (sirf configured providers)
- AI Auto-Extract + AI Fill dono kaam karenge
- Smart Fill (Offline) bhi same rahega — koi API nahi chahiye

---

## Notes

- Render free tier pe service 15 min inactivity ke baad sleep ho jaati hai
  → Pehli request mein 30-60 sec lag sakta hai (cold start)
- Keys server pe hain — browser mein expose nahi hoti
- PDF extraction sirf Anthropic ke saath hota hai (PDF document support)
  → Baaki providers ke liye OCR Scan → AI Fill use karo
