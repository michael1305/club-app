// POST {phone, code} → {token, name}. 5 wrong attempts burn the code.
const { cors, send, normalizePhone, hmac, safeEqual, makeToken, fsGet, fsSet, readJson } = require('../lib/common');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  try {
    const body = await readJson(req);
    const phone = normalizePhone(body.phone);
    const code = String(body.code || '').replace(/\D/g, '');
    if (!phone || code.length !== 4) return send(res, 400, { error: 'קוד לא תקין' });

    const otp = await fsGet('contestOtps/' + phone);
    if (!otp || !otp.codeHash || otp.expiresAt < Date.now() || (otp.attempts || 0) >= 5) {
      return send(res, 400, { error: 'הקוד פג תוקף — בקשו קוד חדש' });
    }
    if (!safeEqual(otp.codeHash, hmac('o:' + phone + ':' + code))) {
      await fsSet('contestOtps/' + phone, { ...otp, attempts: (otp.attempts || 0) + 1 });
      return send(res, 400, { error: 'קוד שגוי' });
    }
    await fsSet('contestOtps/' + phone, { ...otp, codeHash: '', attempts: 5 });   // one use only

    const inst = await fsGet('contestInstructors/' + phone);
    if (!inst) return send(res, 403, { error: 'המספר הזה לא מופיע ברשימת המרקידים' });
    send(res, 200, { token: makeToken(phone), name: inst.name || '' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'שגיאת מערכת' });
  }
};
