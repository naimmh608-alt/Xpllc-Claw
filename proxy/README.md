# ⚡ Xpllc-Claw Groq Proxy

Free Groq API access for everyone — **400 requests per user, no credit card needed.**

Your `GROQ_API_KEY` stays on the server. Users get a token. Everyone wins.

---

## 🚀 Deploy in 2 Minutes

### Option A — Railway (Recommended, FREE tier)

1. Fork this repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Set environment variables (see below)
4. Done! Railway gives you a public URL instantly.

### Option B — Vercel

```bash
npm i -g vercel
vercel --prod
# Set env vars in Vercel dashboard
```

### Option C — Run locally

```bash
git clone https://github.com/naimmh608-alt/Xpllc-Claw.git
cd Xpllc-Claw/proxy

cp .env.example .env
# Edit .env — add your GROQ_API_KEY

node src/server.js
# Server running on http://localhost:3000
```

### Option D — Docker

```bash
docker build -t xpllc-proxy .
docker run -p 3000:3000 \
  -e GROQ_API_KEY=gsk_your_key \
  -e ADMIN_KEY=your-secret \
  -v $(pwd)/storage:/app/storage \
  xpllc-proxy
```

---

## ⚙️ Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GROQ_API_KEY` | ✅ Yes | — | Your Groq key ([get one free](https://console.groq.com/keys)) |
| `ADMIN_KEY` | ✅ Yes | `change-this` | Secret key for admin endpoints |
| `MAX_REQUESTS_PER_USER` | No | `400` | Free quota per user |
| `RATE_PER_MINUTE` | No | `20` | Max req/min per user |
| `PORT` | No | `3000` | Server port |
| `CORS_ORIGINS` | No | `*` | Allowed CORS origins |

---

## 📡 API Endpoints

### `GET /register`
Get a new user token with 400 free requests.
```json
{
  "token": "uuid-here",
  "limit": 400,
  "remaining": 400
}
```

### `GET /quota/:token`
Check remaining requests.
```json
{
  "used": 12,
  "remaining": 388,
  "limit": 400,
  "status": "active"
}
```

### `POST /v1/chat/completions`
Proxied Groq API. Add `X-User-Token` header.
```bash
curl -X POST https://your-proxy.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-User-Token: YOUR_TOKEN" \
  -d '{
    "model": "llama-3.1-70b-versatile",
    "messages": [{"role":"user","content":"Hello!"}]
  }'
```

### `GET /models`
List all available Groq models.

### `GET /admin/stats` *(requires `X-Admin-Key` header)*
View total users, requests, exhausted users.

### `POST /admin/ban/:token` *(requires `X-Admin-Key` header)*
Ban an abusive token.

---

## 🛡️ How Users Are Protected

- Each user gets a **unique UUID token** — no account needed
- Tokens are stored in the **user's browser** (localStorage)
- Rate limited to **20 requests/minute** to prevent abuse
- Your `GROQ_API_KEY` is **never exposed**
- Admin can **ban abusive tokens** instantly

---

## 💰 Cost Estimate

At 400 requests × Groq's free tier:
- **Free tier**: Groq provides generous free limits (no cost for moderate usage)
- **If exceeding free tier**: Groq charges ~$0.05-0.59 per million tokens
- 400 requests × ~500 avg tokens = ~200k tokens = **~$0.01-0.10 per user**

---

## 🤖 Available Models

| Model | Speed | Best For |
|---|---|---|
| `llama-3.3-70b-versatile` | Fast | Planning, architecture |
| `llama-3.1-70b-versatile` | Fast | Code review, dev tasks |
| `llama-3.1-8b-instant` | Ultra-fast | Lightweight, high-volume |
| `deepseek-r1-distill-llama-70b` | Medium | Reasoning, math |
| `mixtral-8x7b-32768` | Fast | 32k context |
| `gemma2-9b-it` | Ultra-fast | Instruction following |
| `llama-3.2-90b-vision-preview` | Medium | Vision + code |

---

Built with ❤️ by [Xpllc-Claw](https://github.com/naimmh608-alt/Xpllc-Claw)
