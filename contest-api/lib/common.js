// Shared helpers for the dance-contest API (Vercel serverless, plain Node).
//
// Why a server at all: SMS goes through Micropay, whose token must stay secret, and the
// club's Firebase project is on the free plan (no Cloud Functions). So this tiny API:
//   - sends a one-time SMS code via Micropay (send-otp)
//   - checks the code and returns a signed session token (verify-otp)
//   - reads / saves an instructor's picks (picks)
// It talks to Firestore over REST, signed in as a dedicated Firebase Auth user
// (CONTEST_BOT_EMAIL). firestore.rules contestBot() allows only that user to touch
// contestInstructors / contestOtps / contestPicks writes.
//
// Env vars (set in Vercel, never in git):
//   MICROPAY_TOKEN, MICROPAY_FROM    — same account as camp2026 / dance-lock (sender must be pre-approved)
//   CONTEST_BOT_PASSWORD             — password of the bot Firebase user
//   SESSION_SECRET                   — HMAC key for session tokens + OTP hashes
const crypto = require('crypto');

const FB_API_KEY = 'AIzaSyCOBQNSRju9Fgxy3_DZAWapzuyv0DoUUCo';
const FB_PROJECT = 'club-app-8f954';
const CONTEST_BOT_EMAIL = 'contest-bot@club-contest.local';
const SITE_ORIGIN = 'https://club.gadibitton.co.il';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;

const ALLOWED_ORIGINS = [SITE_ORIGIN, 'http://localhost:8080', 'http://127.0.0.1:8080'];

function cors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

function send(res, status, body) { res.status(status).json(body); }

function normalizePhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return /^05\d{8}$/.test(d) ? d : '';
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET missing');
  return s;
}
function hmac(data) { return crypto.createHmac('sha256', secret()).update(data).digest('base64url'); }
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Session token: base64url(JSON{p,e}).sig — 30 days.
const SESSION_DAYS = 30;
function makeToken(phone) {
  const body = Buffer.from(JSON.stringify({ p: phone, e: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return body + '.' + hmac('s:' + body);
}
function readToken(req) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');
  if (!m) return '';
  const [body, sig] = m[1].split('.');
  if (!body || !sig || !safeEqual(sig, hmac('s:' + body))) return '';
  try {
    const { p, e } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return e > Date.now() ? normalizePhone(p) : '';
  } catch (e) { return ''; }
}

// ---- Firestore REST, as the bot user ----
let _bot = { token: '', exp: 0 };
async function botToken() {
  if (_bot.token && _bot.exp > Date.now() + 60e3) return _bot.token;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: SITE_ORIGIN + '/' },
    body: JSON.stringify({ email: CONTEST_BOT_EMAIL, password: process.env.CONTEST_BOT_PASSWORD, returnSecureToken: true })
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('bot sign-in failed: ' + JSON.stringify(j.error || j));
  _bot = { token: j.idToken, exp: Date.now() + Number(j.expiresIn || 3600) * 1000 };
  return _bot.token;
}

function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } };
  return { stringValue: String(v) };
}
function fromFs(f) {
  if (!f) return undefined;
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('booleanValue' in f) return f.booleanValue;
  if ('nullValue' in f) return null;
  if ('timestampValue' in f) return f.timestampValue;
  if ('arrayValue' in f) return (f.arrayValue.values || []).map(fromFs);
  if ('mapValue' in f) return docData(f.mapValue);
  return undefined;
}
function docData(doc) {
  return Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, fromFs(v)]));
}

async function fsGet(path, { asBot = true } = {}) {
  const headers = asBot ? { Authorization: 'Bearer ' + await botToken() } : {};
  const r = await fetch(`${FS_BASE}/${path}`, { headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fsGet ${path}: ${r.status} ${await r.text()}`);
  return docData(await r.json());
}
async function fsSet(path, data) {
  const r = await fetch(`${FS_BASE}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + await botToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toFs(v)])) })
  });
  if (!r.ok) throw new Error(`fsSet ${path}: ${r.status} ${await r.text()}`);
}

// Stage 1 is open unless the admin closed it in contest-admin.html (contestConfig/main.stage1Open).
async function stage1Open() {
  const cfg = await fsGet('contestConfig/main', { asBot: false });
  return !cfg || cfg.stage1Open !== false;
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

module.exports = { cors, send, normalizePhone, hmac, safeEqual, makeToken, readToken, fsGet, fsSet, stage1Open, readJson, SITE_ORIGIN };
