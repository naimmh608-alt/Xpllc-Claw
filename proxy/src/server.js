#!/usr/bin/env node
'use strict';

/**
 * Xpllc-Claw Groq Proxy Server
 * ─────────────────────────────
 * Gives each user 400 free Groq API requests.
 * Your GROQ_API_KEY is NEVER exposed to users.
 *
 * Endpoints:
 *   POST /v1/chat/completions  — Proxied Groq API (requires X-User-Token header)
 *   GET  /register             — Get a new user token + quota info
 *   GET  /quota/:token         — Check remaining requests for a token
 *   GET  /models               — List available Groq models
 *   GET  /health               — Server health check
 *   GET  /admin/stats          — Usage stats (requires ADMIN_KEY header)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
  port: parseInt(process.env.PORT || '3000'),
  groqApiKey: process.env.GROQ_API_KEY || '',
  adminKey: process.env.ADMIN_KEY || 'change-this-admin-key',
  maxRequestsPerUser: parseInt(process.env.MAX_REQUESTS_PER_USER || '400'),
  storageFile: process.env.STORAGE_FILE || path.join(__dirname, '../storage/users.json'),
  corsOrigins: process.env.CORS_ORIGINS || '*',
  rateWindowMs: 60 * 1000,          // 1 minute window
  rateMaxPerMinute: parseInt(process.env.RATE_PER_MINUTE || '20'), // max 20 req/min per user
};

if (!CONFIG.groqApiKey) {
  console.error('❌  GROQ_API_KEY environment variable is required');
  process.exit(1);
}

// ─── Storage (file-based, swap for Redis in production) ──────────────────────

class UserStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { users: {}, meta: { created: Date.now(), totalRequests: 0 } };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch {
      console.warn('⚠️  Could not load storage, starting fresh');
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('Storage write error:', err.message);
    }
  }

  register(ip) {
    const token = randomUUID();
    this.data.users[token] = {
      token,
      ip,
      created: new Date().toISOString(),
      requests: 0,
      limit: CONFIG.maxRequestsPerUser,
      lastRequest: null,
      recentWindow: [],   // timestamps for rate limiting
      banned: false,
    };
    this._save();
    return this.data.users[token];
  }

  getUser(token) {
    return this.data.users[token] || null;
  }

  // Returns { allowed, reason, remaining }
  checkAndConsume(token) {
    const user = this.data.users[token];
    if (!user) return { allowed: false, reason: 'Invalid token. Visit /register to get one.' };
    if (user.banned) return { allowed: false, reason: 'This token has been banned for abuse.' };

    // Quota check
    if (user.requests >= user.limit) {
      return {
        allowed: false,
        reason: `Quota exhausted. You have used all ${user.limit} free requests.`,
        remaining: 0,
      };
    }

    // Per-minute rate limit
    const now = Date.now();
    user.recentWindow = (user.recentWindow || []).filter(t => now - t < CONFIG.rateWindowMs);
    if (user.recentWindow.length >= CONFIG.rateMaxPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit: max ${CONFIG.rateMaxPerMinute} requests per minute. Slow down.`,
        remaining: user.limit - user.requests,
        retryAfter: Math.ceil((CONFIG.rateWindowMs - (now - user.recentWindow[0])) / 1000),
      };
    }

    // Consume
    user.requests += 1;
    user.lastRequest = new Date().toISOString();
    user.recentWindow.push(now);
    this.data.meta.totalRequests = (this.data.meta.totalRequests || 0) + 1;
    this._save();

    return {
      allowed: true,
      remaining: user.limit - user.requests,
      used: user.requests,
      limit: user.limit,
    };
  }

  getStats() {
    const users = Object.values(this.data.users);
    return {
      totalUsers: users.length,
      totalRequests: this.data.meta.totalRequests || 0,
      activeUsers: users.filter(u => u.requests > 0).length,
      exhaustedUsers: users.filter(u => u.requests >= u.limit).length,
      bannedUsers: users.filter(u => u.banned).length,
      created: this.data.meta.created,
    };
  }

  banUser(token) {
    if (this.data.users[token]) {
      this.data.users[token].banned = true;
      this._save();
      return true;
    }
    return false;
  }
}

const store = new UserStore(CONFIG.storageFile);

// ─── Groq proxy ───────────────────────────────────────────────────────────────

function proxyToGroq(body, res) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.groqApiKey}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const isStream = !!body.stream;

    const req = https.request(options, (groqRes) => {
      res.writeHead(groqRes.statusCode, {
        'Content-Type': groqRes.headers['content-type'] || 'application/json',
        'Cache-Control': 'no-cache',
        ...(isStream ? { 'Transfer-Encoding': 'chunked' } : {}),
      });

      groqRes.on('data', chunk => res.write(chunk));
      groqRes.on('end', () => { res.end(); resolve(); });
      groqRes.on('error', reject);
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', CONFIG.corsOrigins);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Token, Authorization');
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 2_000_000) reject(new Error('Body too large')); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  setCORSHeaders(res);

  const url = new URL(req.url, `http://localhost`);
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── GET /health
  if (method === 'GET' && url.pathname === '/health') {
    sendJSON(res, 200, {
      status: 'ok',
      service: 'Xpllc-Claw Groq Proxy',
      version: '1.0.0',
      freeRequestsPerUser: CONFIG.maxRequestsPerUser,
      uptime: Math.floor(process.uptime()),
    });
    return;
  }

  // ── GET /register — returns a new user token
  if (method === 'GET' && url.pathname === '/register') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const user = store.register(ip);
    sendJSON(res, 200, {
      message: '🎉 Welcome! You have 400 free Groq API requests.',
      token: user.token,
      limit: user.limit,
      remaining: user.limit,
      instructions: {
        usage: 'Add header: X-User-Token: <your-token> to all requests',
        endpoint: '/v1/chat/completions',
        checkQuota: `/quota/${user.token}`,
      },
    });
    return;
  }

  // ── GET /quota/:token
  if (method === 'GET' && url.pathname.startsWith('/quota/')) {
    const token = url.pathname.split('/quota/')[1];
    const user = store.getUser(token);
    if (!user) {
      sendJSON(res, 404, { error: 'Token not found. Visit /register to get one.' });
      return;
    }
    sendJSON(res, 200, {
      token: user.token,
      used: user.requests,
      limit: user.limit,
      remaining: user.limit - user.requests,
      percentUsed: Math.round((user.requests / user.limit) * 100),
      created: user.created,
      lastRequest: user.lastRequest,
      banned: user.banned,
      status: user.banned ? 'banned' : user.requests >= user.limit ? 'exhausted' : 'active',
    });
    return;
  }

  // ── GET /models
  if (method === 'GET' && url.pathname === '/models') {
    sendJSON(res, 200, {
      models: [
        { id: 'llama-3.3-70b-versatile', tier: 'opus', description: 'Most capable — planning, architecture' },
        { id: 'llama-3.1-70b-versatile', tier: 'sonnet', description: 'Balanced — coding, reviews' },
        { id: 'llama-3.1-8b-instant', tier: 'haiku', description: 'Ultra-fast — lightweight tasks' },
        { id: 'deepseek-r1-distill-llama-70b', tier: 'opus', description: 'Reasoning — math, logic' },
        { id: 'mixtral-8x7b-32768', tier: 'sonnet', description: '32k context — large codebases' },
        { id: 'gemma2-9b-it', tier: 'haiku', description: 'Google Gemma — instruction following' },
        { id: 'llama-3.2-90b-vision-preview', tier: 'opus', description: 'Vision + code', vision: true },
        { id: 'llama-3.2-11b-vision-preview', tier: 'sonnet', description: 'Vision lightweight', vision: true },
      ],
    });
    return;
  }

  // ── GET /admin/stats (requires ADMIN_KEY)
  if (method === 'GET' && url.pathname === '/admin/stats') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== CONFIG.adminKey) {
      sendJSON(res, 401, { error: 'Unauthorized. Provide X-Admin-Key header.' });
      return;
    }
    sendJSON(res, 200, store.getStats());
    return;
  }

  // ── POST /admin/ban/:token
  if (method === 'POST' && url.pathname.startsWith('/admin/ban/')) {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== CONFIG.adminKey) {
      sendJSON(res, 401, { error: 'Unauthorized.' });
      return;
    }
    const token = url.pathname.split('/admin/ban/')[1];
    const success = store.banUser(token);
    sendJSON(res, success ? 200 : 404, { success, token });
    return;
  }

  // ── POST /v1/chat/completions — THE MAIN PROXY ──────────────────────────────
  if (method === 'POST' && url.pathname === '/v1/chat/completions') {
    const token = req.headers['x-user-token'];
    if (!token) {
      sendJSON(res, 401, {
        error: 'Missing X-User-Token header.',
        fix: 'Visit /register to get your free token (400 requests included).',
      });
      return;
    }

    const check = store.checkAndConsume(token);
    if (!check.allowed) {
      const status = check.remaining === 0 ? 429 : 403;
      sendJSON(res, status, {
        error: check.reason,
        remaining: check.remaining || 0,
        ...(check.retryAfter ? { retryAfter: `${check.retryAfter}s` } : {}),
      });
      return;
    }

    // Add quota headers to response
    res.setHeader('X-Quota-Remaining', check.remaining);
    res.setHeader('X-Quota-Used', check.used);
    res.setHeader('X-Quota-Limit', check.limit);

    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      sendJSON(res, 400, { error: err.message });
      return;
    }

    // Validate required fields
    if (!body.messages || !Array.isArray(body.messages)) {
      sendJSON(res, 400, { error: '`messages` array is required.' });
      return;
    }
    if (!body.model) {
      body.model = 'llama-3.1-70b-versatile'; // sensible default
    }

    try {
      await proxyToGroq(body, res);
      console.log(`[${new Date().toISOString()}] token=${token.slice(0, 8)}... model=${body.model} remaining=${check.remaining}`);
    } catch (err) {
      console.error('Proxy error:', err.message);
      if (!res.headersSent) {
        sendJSON(res, 502, { error: 'Groq API error: ' + err.message });
      }
    }
    return;
  }

  // ── Serve landing page for / and unknown routes
  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const htmlPath = path.join(__dirname, '../public/index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(htmlPath));
    } else {
      sendJSON(res, 200, {
        service: 'Xpllc-Claw Groq Proxy',
        endpoints: {
          register: 'GET /register',
          quota: 'GET /quota/:token',
          chat: 'POST /v1/chat/completions',
          models: 'GET /models',
          health: 'GET /health',
        },
      });
    }
    return;
  }

  sendJSON(res, 404, { error: 'Not found' });
}

// ─── Start server ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error('Unhandled error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
});

server.listen(CONFIG.port, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║     Xpllc-Claw Groq Proxy  v1.0.0           ║
╠══════════════════════════════════════════════╣
║  ✅  Server running on port ${String(CONFIG.port).padEnd(17)}║
║  🔑  Groq key: ${CONFIG.groqApiKey.slice(0, 8)}...${' '.repeat(22)}║
║  🎁  Free requests per user: ${String(CONFIG.maxRequestsPerUser).padEnd(14)}║
║  ⚡  Rate limit: ${String(CONFIG.rateMaxPerMinute).padEnd(5)} req/min per user    ║
╠══════════════════════════════════════════════╣
║  Endpoints:                                  ║
║    GET  /register         → Get free token   ║
║    GET  /quota/:token     → Check quota      ║
║    POST /v1/chat/completions → Proxy API     ║
║    GET  /models           → Available models ║
║    GET  /admin/stats      → Admin stats      ║
╚══════════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT',  () => { server.close(); process.exit(0); });
