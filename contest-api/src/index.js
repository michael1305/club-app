// Dance-contest API (מצעד הריקודים) — Cloudflare Worker.
//
// Why a server at all: SMS goes through Micropay, whose token must stay secret, and the
// club's Firebase project is on the free plan (no Cloud Functions). So this small API:
//   POST /api/send-otp   {phone}        → 4-digit SMS code via Micropay (allowlisted phones only)
//   POST /api/verify-otp {phone, code}  → {token, name}  (signed session token, 30 days)
//   GET  /api/picks      (Bearer token) → {name, picks, open}
//   POST /api/picks      (Bearer token) {picks:[ids]} → saves contestPicks/{phone}
//   POST /api/fb-login   (Bearer token) → {email, password} of the instructor's own Firebase user
//
// Stage 2 — public voting (vote.html), any phone:
//   POST /api/vote/send-otp {phone, name, email?, city, ios} → SMS code (limits: per phone, per IP, per day)
//   POST /api/vote/verify   {phone, code}            → {token, voted, picks}
//   POST /api/vote/submit   (Bearer vote token) {picks:{circle:[],couple:[],line:[]}} → final, once
// Voters live in contestVoters/{phone}. Open/closed = contestConfig/vote.open (admin page);
// Testers = contestVoteTesters/{phone}: NO SMS is sent (the code comes back on screen), they may
// vote while it's closed and vote again; their votes are marked test:true and left out of results.
//
// After login the page reads/writes contestPicks/{phone} straight in Firestore (Google), so it
// works on networks that block *.workers.dev. The Worker creates one Firebase user per
// instructor (email/password derived from SESSION_SECRET, unguessable) and records
// contestAuth/{uid} = {phone, name}; firestore.rules contestOwner() trusts only that doc.
// It talks to Firestore over REST, signed in as a dedicated Firebase Auth user
// (CONTEST_BOT_EMAIL). firestore.rules contestBot() lets only that user write
// contestOtps / contestPicks and read contestInstructors.
//
// Secrets (wrangler secret put, never in git):
//   MICROPAY_TOKEN, MICROPAY_FROM  — same Micropay account as camp2026 / dance-lock (sender must be pre-approved)
//   CONTEST_BOT_PASSWORD           — password of the bot Firebase user
//   SESSION_SECRET                 — HMAC key for session tokens + OTP hashes

const FB_API_KEY = 'AIzaSyCOBQNSRju9Fgxy3_DZAWapzuyv0DoUUCo';
const FB_PROJECT = 'club-app-8f954';
const CONTEST_BOT_EMAIL = 'contest-bot@club-contest.local';
const SITE_ORIGIN = 'https://club.gadibitton.co.il';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;
const ALLOWED_ORIGINS = [SITE_ORIGIN, 'http://localhost:8080', 'http://127.0.0.1:8080'];
const SESSION_DAYS = 30;
const ID_RE = /^d\d{2,3}$/;
const MAX_PICKS = 200;
const EXTRA_KEYS = ['circle', 'couple', 'line'];

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store',
      Vary: 'Origin'
    };
    if (ALLOWED_ORIGINS.includes(origin)) cors['Access-Control-Allow-Origin'] = origin;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    try {
      const ctx = new Ctx(env);
      if (path === '/api/send-otp' && req.method === 'POST') return json(200, await sendOtp(ctx, await body(req)));
      if (path === '/api/verify-otp' && req.method === 'POST') return json(200, await verifyOtp(ctx, await body(req)));
      if (path === '/api/picks' && req.method === 'GET') return json(200, await getPicks(ctx, req));
      if (path === '/api/vote/send-otp' && req.method === 'POST') return json(200, await voteSendOtp(ctx, req, await body(req)));
      if ((path === '/api/vote/verify' || path === '/api/vote/verify-otp') && req.method === 'POST') return json(200, await voteVerify(ctx, await body(req)));
      if (path === '/api/vote/submit' && req.method === 'POST') return json(200, await voteSubmit(ctx, req, await body(req)));
      if (path === '/api/fb-login' && req.method === 'POST') return json(200, await fbLogin(ctx, req));
      if (path === '/api/picks' && req.method === 'POST') return json(200, await savePicks(ctx, req, await body(req)));
      return json(404, { error: 'not found' });
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      console.error(e && e.stack || e);
      return json(500, { error: 'שגיאת מערכת' });
    }
  }
};

async function body(req) { try { return await req.json(); } catch (e) { return {}; } }

function normalizePhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return /^05\d{8}$/.test(d) ? d : '';
}

// ---------------- handlers ----------------

async function sendOtp(ctx, b) {
  const phone = normalizePhone(b.phone);
  if (!phone) throw new HttpError(400, 'מספר טלפון לא תקין');
  if (!(await ctx.fsGet('contestInstructors/' + phone))) throw new HttpError(403, 'המספר הזה לא מופיע ברשימת המרקידים');
  if (!(await ctx.stage1Open())) throw new HttpError(403, 'הבחירה נסגרה');

  // Rate limit per phone: 60s between codes, 5 codes per hour.
  const now = Date.now();
  const prev = (await ctx.fsGet('contestOtps/' + phone)) || {};
  if (prev.sentAt && now - prev.sentAt < 60e3) throw new HttpError(429, 'קוד נשלח לפני רגע — אפשר לבקש חדש בעוד דקה');
  const inWindow = prev.windowStart && now - prev.windowStart < 3600e3;
  const sendCount = inWindow ? (prev.sendCount || 0) : 0;
  if (sendCount >= 5) throw new HttpError(429, 'יותר מדי בקשות קוד — נסו שוב בעוד שעה');

  const code = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
  const rec = {
    codeHash: await ctx.hmac('o:' + phone + ':' + code),
    expiresAt: now + 10 * 60e3, attempts: 0, sentAt: now,
    sendCount: sendCount + 1, windowStart: inWindow ? prev.windowStart : now
  };
  await ctx.fsSet('contestOtps/' + phone, rec);
  // If the SMS doesn't go out, don't make the person wait 60s before trying again.
  const unblock = () => ctx.fsSet('contestOtps/' + phone, { ...rec, sentAt: 0 }).catch(() => {});

  // Android: last line is the WebOTP format (Chrome fills the code by itself) and must stay last.
  // iPhone: the domain line kept the code from being suggested above the keyboard, so iPhones get the
  // wording that worked in the camp app — English "Your ... code is 1234", no domain line.
  const msg = b.ios
    ? `מצעד הריקודים – קוד הכניסה שלך: ${code}\nYour Dance Contest code is ${code}`
    : `מצעד הריקודים\nקוד הכניסה שלך: ${code}\nתקף ל-10 דקות\n\n@club.gadibitton.co.il #${code}`;
  const url = 'https://www.micropay.co.il/extApi/scheduleSms.php?get=1'
    + '&token=' + encodeURIComponent(ctx.env.MICROPAY_TOKEN || '')
    + '&msg=' + encodeURIComponent(msg)
    + '&list=' + phone
    + '&from=' + encodeURIComponent(ctx.env.MICROPAY_FROM || '');
  let txt;
  try { txt = await (await fetch(url, { signal: AbortSignal.timeout(12000) })).text(); }
  catch (e) { console.error("micropay fetch", phone, e && e.name, e && e.message); await unblock(); throw new HttpError(504, "שירות ה-SMS לא ענה, נסו שוב בעוד רגע"); }
  console.log("sms", phone, txt.slice(0, 80));
  if (!txt.startsWith('OK')) {
    console.error('micropay', txt);
    await unblock();
    throw new HttpError(502, 'שליחת ה-SMS נכשלה, נסו שוב');
  }
  return { ok: true };
}

async function verifyOtp(ctx, b) {
  const phone = normalizePhone(b.phone);
  const code = String(b.code || '').replace(/\D/g, '');
  if (!phone || code.length !== 4) throw new HttpError(400, 'קוד לא תקין');

  const otp = await ctx.fsGet('contestOtps/' + phone);
  if (!otp || !otp.codeHash || otp.expiresAt < Date.now() || (otp.attempts || 0) >= 5) {
    throw new HttpError(400, 'הקוד פג תוקף — בקשו קוד חדש');
  }
  if (!safeEqual(otp.codeHash, await ctx.hmac('o:' + phone + ':' + code))) {
    await ctx.fsSet('contestOtps/' + phone, { ...otp, attempts: (otp.attempts || 0) + 1 });
    throw new HttpError(400, 'קוד שגוי');
  }
  await ctx.fsSet('contestOtps/' + phone, { ...otp, codeHash: '', attempts: 5 });   // one use only

  const inst = await ctx.fsGet('contestInstructors/' + phone);
  if (!inst) throw new HttpError(403, 'המספר הזה לא מופיע ברשימת המרקידים');
  const fb = await fbCreds(ctx, phone, inst.name || '').catch(e => { console.error('fbCreds', e && e.message); return null; });
  return { token: await ctx.makeToken(phone), name: inst.name || '', fb };
}

async function auth(ctx, req) {
  const phone = await ctx.readToken(req);
  const inst = phone && await ctx.fsGet('contestInstructors/' + phone);
  if (!inst) throw new HttpError(401, 'יש להתחבר מחדש');
  return { phone, inst };
}

// ---------------- stage 2: public voting ----------------
const VOTE_LIMITS = { circle: 4, couple: 4, line: 1 };
const VOTE_DAILY_SMS_CAP = 3000;       // safety net against SMS abuse (Micropay costs money)
const VOTE_IP_PER_HOUR = 6;

async function isTester(ctx, phone) { return !!(await ctx.fsGet('contestVoteTesters/' + phone)); }
async function voteIsOpen(ctx) {
  const cfg = await ctx.fsGet('contestConfig/vote', { asBot: false });
  return !!(cfg && cfg.open === true);
}

function cleanText(s, max) { return String(s || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }

async function voteSendOtp(ctx, req, b) {
  const phone = normalizePhone(b.phone);
  if (!phone) throw new HttpError(400, 'מספר טלפון לא תקין');
  const name = cleanText(b.name, 80), city = cleanText(b.city, 60), email = cleanText(b.email, 120).toLowerCase();
  if (name.length < 2) throw new HttpError(400, 'נא למלא שם מלא');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'כתובת האימייל לא תקינה');
  if (city.length < 2) throw new HttpError(400, 'נא למלא יישוב מגורים');
  const tester = await isTester(ctx, phone);
  if (!tester && !(await voteIsOpen(ctx))) throw new HttpError(403, 'ההצבעה עדיין לא נפתחה');
  const voter = await ctx.fsGet('contestVoters/' + phone);
  if (!tester && voter && voter.votedAt) throw new HttpError(409, 'כבר הצבעת מהמספר הזה — תודה! נתראה במצעד');

  const now = Date.now();
  if (tester) {   // test phone: no SMS, no limits — the code is shown on screen
    const code = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
    await ctx.fsSet('contestVoteOtps/' + phone, { codeHash: await ctx.hmac('v:' + phone + ':' + code), name, city, email, expiresAt: now + 10 * 60e3, attempts: 0, sentAt: 0, sendCount: 0, windowStart: now });
    return { ok: true, testCode: code };
  }
  // Per-IP limit (hashed, never stored raw) and a daily cap for the whole vote.
  const ip = req.headers.get('CF-Connecting-IP') || 'none';
  const ipKey = 'contestVoteLimits/ip-' + (await ctx.hmac('ip:' + ip)).replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  const ipRec = (await ctx.fsGet(ipKey)) || {};
  const ipFresh = ipRec.windowStart && now - ipRec.windowStart < 3600e3;
  const ipCount = ipFresh ? (ipRec.count || 0) : 0;
  if (ipCount >= VOTE_IP_PER_HOUR) throw new HttpError(429, 'יותר מדי בקשות מהרשת הזו — נסו שוב בעוד שעה');
  const day = new Date(now + 2 * 3600e3).toISOString().slice(0, 10);
  const dayKey = 'contestVoteLimits/day-' + day;
  const dayRec = (await ctx.fsGet(dayKey)) || {};
  if ((dayRec.count || 0) >= VOTE_DAILY_SMS_CAP) throw new HttpError(429, 'המערכת עמוסה כרגע — נסו שוב מחר');

  const prev = (await ctx.fsGet('contestVoteOtps/' + phone)) || {};
  if (prev.sentAt && now - prev.sentAt < 60e3) throw new HttpError(429, 'קוד נשלח לפני רגע — אפשר לבקש חדש בעוד דקה');
  const inWindow = prev.windowStart && now - prev.windowStart < 3600e3;
  const sendCount = inWindow ? (prev.sendCount || 0) : 0;
  if (sendCount >= 5) throw new HttpError(429, 'יותר מדי בקשות קוד — נסו שוב בעוד שעה');

  const code = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
  const rec = {
    codeHash: await ctx.hmac('v:' + phone + ':' + code), name, city, email,
    expiresAt: now + 10 * 60e3, attempts: 0, sentAt: now,
    sendCount: sendCount + 1, windowStart: inWindow ? prev.windowStart : now
  };
  await ctx.fsSet('contestVoteOtps/' + phone, rec);
  await ctx.fsSet(ipKey, { count: ipCount + 1, windowStart: ipFresh ? ipRec.windowStart : now });
  await ctx.fsSet(dayKey, { count: (dayRec.count || 0) + 1 });
  const unblock = () => ctx.fsSet('contestVoteOtps/' + phone, { ...rec, sentAt: 0 }).catch(() => {});

  const msg = b.ios
    ? `מצעד ריקודי העם – קוד ההצבעה שלך: ${code}\nYour Dance Vote code is ${code}`
    : `מצעד ריקודי העם הארצי\nקוד ההצבעה שלך: ${code}\nתקף ל-10 דקות\n\n@club.gadibitton.co.il #${code}`;
  await sendSms(ctx, phone, msg, unblock);
  return { ok: true };
}

async function voteVerify(ctx, b) {
  const phone = normalizePhone(b.phone);
  const code = String(b.code || '').replace(/\D/g, '');
  if (!phone || code.length !== 4) throw new HttpError(400, 'קוד לא תקין');
  const otp = await ctx.fsGet('contestVoteOtps/' + phone);
  if (!otp || !otp.codeHash || otp.expiresAt < Date.now() || (otp.attempts || 0) >= 5) throw new HttpError(400, 'הקוד פג תוקף — בקשו קוד חדש');
  if (!safeEqual(otp.codeHash, await ctx.hmac('v:' + phone + ':' + code))) {
    await ctx.fsSet('contestVoteOtps/' + phone, { ...otp, attempts: (otp.attempts || 0) + 1 });
    throw new HttpError(400, 'קוד שגוי');
  }
  await ctx.fsSet('contestVoteOtps/' + phone, { ...otp, codeHash: '', attempts: 5 });
  const tester = await isTester(ctx, phone);
  const voter = (await ctx.fsGet('contestVoters/' + phone)) || {};
  if (tester || !voter.votedAt) {
    await ctx.fsSet('contestVoters/' + phone, { name: otp.name || '', city: otp.city || '', email: otp.email || '', verifiedAt: new Date().toISOString(), ...(tester ? { test: true } : {}) });
    return { token: await ctx.makeToken(phone, 'v'), voted: false, picks: null, name: otp.name || '', test: tester };
  }
  return { token: await ctx.makeToken(phone, 'v'), voted: true, picks: voter.picks || null, name: voter.name || '' };
}

async function voteSubmit(ctx, req, b) {
  const phone = await ctx.readToken(req, 'v');
  if (!phone) throw new HttpError(401, 'יש להתחבר מחדש');
  const tester = await isTester(ctx, phone);
  if (!tester && !(await voteIsOpen(ctx))) throw new HttpError(403, 'ההצבעה נסגרה');
  const voter = await ctx.fsGet('contestVoters/' + phone);
  if (!voter) throw new HttpError(401, 'יש להתחבר מחדש');
  if (!tester && voter.votedAt) throw new HttpError(409, 'כבר הצבעת מהמספר הזה — תודה!');
  const main = (await ctx.fsGet('contestConfig/main', { asBot: false })) || {};
  const allowed = Array.isArray(main.finalists) && main.finalists.length ? new Set(main.finalists) : null;
  const picks = {};
  let total = 0;
  for (const [k, max] of Object.entries(VOTE_LIMITS)) {
    const ids = [...new Set(((b.picks && b.picks[k]) || []).map(String))].filter(id => ID_RE.test(id) && (!allowed || allowed.has(id)));
    if (ids.length > max) throw new HttpError(400, 'נבחרו יותר ריקודים מהמותר');
    picks[k] = ids; total += ids.length;
  }
  if (!total) throw new HttpError(400, 'לא נבחר אף ריקוד');
  const votedAt = new Date().toISOString();
  await ctx.fsSet('contestVoters/' + phone, { name: voter.name || '', city: voter.city || '', email: voter.email || '', verifiedAt: voter.verifiedAt || votedAt, picks, votedAt, ...(tester ? { test: true } : {}) });
  return { ok: true, picks, votedAt };
}

async function sendSms(ctx, phone, msg, unblock) {
  const url = 'https://www.micropay.co.il/extApi/scheduleSms.php?get=1'
    + '&token=' + encodeURIComponent(ctx.env.MICROPAY_TOKEN || '')
    + '&msg=' + encodeURIComponent(msg)
    + '&list=' + phone
    + '&from=' + encodeURIComponent(ctx.env.MICROPAY_FROM || '');
  let txt;
  try { txt = await (await fetch(url, { signal: AbortSignal.timeout(12000) })).text(); }
  catch (e) { console.error('micropay fetch', phone, e && e.name, e && e.message); await unblock(); throw new HttpError(504, 'שירות ה-SMS לא ענה, נסו שוב בעוד רגע'); }
  console.log('sms', phone, txt.slice(0, 80));
  if (!txt.startsWith('OK')) { console.error('micropay', txt); await unblock(); throw new HttpError(502, 'שליחת ה-SMS נכשלה, נסו שוב'); }
}

// The instructor's own Firebase user (created on first use) + the contestAuth mapping doc.
async function fbCreds(ctx, phone, name) {
  const tag = (await ctx.hmac('fe:' + phone)).replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toLowerCase();
  const email = `i${phone}-${tag}@club-contest.local`;
  const password = (await ctx.hmac('fp:' + phone)).slice(0, 32);
  const idt = (op, extra = {}) => fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${op}?key=${FB_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: SITE_ORIGIN + '/' },
    body: JSON.stringify({ email, password, returnSecureToken: true, ...extra })
  }).then(r => r.json());
  let j = await idt('signInWithPassword');
  if (!j.localId) j = await idt('signUp');
  if (!j.localId) throw new Error('firebase user: ' + JSON.stringify(j.error || j));
  await ctx.fsSet('contestAuth/' + j.localId, { phone, name: String(name).slice(0, 119) });
  return { email, password };
}

async function fbLogin(ctx, req) {
  const { phone, inst } = await auth(ctx, req);
  return await fbCreds(ctx, phone, inst.name || '');
}

async function getPicks(ctx, req) {
  const { phone, inst } = await auth(ctx, req);
  const doc = await ctx.fsGet('contestPicks/' + phone);
  return { name: inst.name || '', picks: (doc && doc.picks) || [], extra: (doc && doc.extra) || {}, open: await ctx.stage1Open(), updatedAt: (doc && doc.updatedAt) || null };
}

async function savePicks(ctx, req, b) {
  const { phone, inst } = await auth(ctx, req);
  if (!(await ctx.stage1Open())) throw new HttpError(403, 'הבחירה נסגרה — לא ניתן לשנות');
  if (!Array.isArray(b.picks)) throw new HttpError(400, 'נתונים לא תקינים');
  const picks = [...new Set(b.picks.map(String).filter(id => ID_RE.test(id)))].slice(0, MAX_PICKS);
  // Dances the instructor typed in by hand (not on the list), one free-text field per style.
  const extra = {};
  for (const k of EXTRA_KEYS) extra[k] = String((b.extra && b.extra[k]) || '').slice(0, 2000);
  const updatedAt = new Date().toISOString();
  await ctx.fsSet('contestPicks/' + phone, { name: inst.name || '', picks, extra, updatedAt });
  return { ok: true, picks, extra, updatedAt };
}

// ---------------- crypto + Firestore ----------------

function b64url(bytes) {
  let s = ''; for (const x of new Uint8Array(bytes)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlText(str) { return b64url(new TextEncoder().encode(str)); }
function fromB64urlText(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
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
function docData(doc) { return Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, fromFs(v)])); }

// Bot ID token is cached per isolate (valid ~1h).
let _bot = { token: '', exp: 0 };

class Ctx {
  constructor(env) {
    this.env = env;
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET missing');
  }
  async key() {
    if (!this._key) this._key = await crypto.subtle.importKey('raw', new TextEncoder().encode(this.env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return this._key;
  }
  async hmac(data) { return b64url(await crypto.subtle.sign('HMAC', await this.key(), new TextEncoder().encode(data))); }

  // Session token: base64url(JSON{p,e}).sig
  async makeToken(phone, kind = '') {
    const b = b64urlText(JSON.stringify(kind ? { p: phone, k: kind, e: Date.now() + 2 * 864e5 } : { p: phone, e: Date.now() + SESSION_DAYS * 864e5 }));
    return b + '.' + await this.hmac('s:' + b);
  }
  async readToken(req, kind = '') {
    const m = /^Bearer\s+(.+)$/.exec(req.headers.get('Authorization') || '');
    if (!m) return '';
    const [b, sig] = m[1].split('.');
    if (!b || !sig || !safeEqual(sig, await this.hmac('s:' + b))) return '';
    try { const { p, k, e } = JSON.parse(fromB64urlText(b)); return e > Date.now() && (k || '') === kind ? normalizePhone(p) : ''; }
    catch (e) { return ''; }
  }

  async botToken() {
    if (_bot.token && _bot.exp > Date.now() + 60e3) return _bot.token;
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: SITE_ORIGIN + '/' },
      body: JSON.stringify({ email: CONTEST_BOT_EMAIL, password: this.env.CONTEST_BOT_PASSWORD, returnSecureToken: true })
    });
    const j = await r.json();
    if (!j.idToken) throw new Error('bot sign-in failed: ' + JSON.stringify(j.error || j));
    _bot = { token: j.idToken, exp: Date.now() + Number(j.expiresIn || 3600) * 1000 };
    return _bot.token;
  }
  async fsGet(path, { asBot = true } = {}) {
    const headers = asBot ? { Authorization: 'Bearer ' + await this.botToken() } : {};
    const r = await fetch(`${FS_BASE}/${path}`, { headers });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`fsGet ${path}: ${r.status} ${await r.text()}`);
    return docData(await r.json());
  }
  async fsSet(path, data) {
    const r = await fetch(`${FS_BASE}/${path}`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + await this.botToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toFs(v)])) })
    });
    if (!r.ok) throw new Error(`fsSet ${path}: ${r.status} ${await r.text()}`);
  }
  // Stage 1 is open unless the admin closed it in contest-admin.html (contestConfig/main.stage1Open).
  async stage1Open() {
    const cfg = await this.fsGet('contestConfig/main', { asBot: false });
    return !cfg || cfg.stage1Open !== false;
  }
}
