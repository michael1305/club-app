// GET  (Bearer token) → {name, picks, open}
// POST (Bearer token) {picks:[ids]} → saves contestPicks/{phone}
const { cors, send, readToken, fsGet, fsSet, stage1Open, readJson } = require('../lib/common');

const ID_RE = /^d\d{2,3}$/;
const MAX_PICKS = 200;

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    const phone = readToken(req);
    if (!phone) return send(res, 401, { error: 'יש להתחבר מחדש' });
    const inst = await fsGet('contestInstructors/' + phone);
    if (!inst) return send(res, 401, { error: 'יש להתחבר מחדש' });

    if (req.method === 'GET') {
      const doc = await fsGet('contestPicks/' + phone);
      return send(res, 200, { name: inst.name || '', picks: (doc && doc.picks) || [], open: await stage1Open(), updatedAt: doc && doc.updatedAt || null });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    if (!(await stage1Open())) return send(res, 403, { error: 'הבחירה נסגרה — לא ניתן לשנות' });

    const raw = (await readJson(req)).picks;
    if (!Array.isArray(raw)) return send(res, 400, { error: 'נתונים לא תקינים' });
    const picks = [...new Set(raw.map(String).filter(id => ID_RE.test(id)))].slice(0, MAX_PICKS);
    const updatedAt = new Date().toISOString();
    await fsSet('contestPicks/' + phone, { name: inst.name || '', picks, updatedAt });
    send(res, 200, { ok: true, picks, updatedAt });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'שגיאת מערכת' });
  }
};
