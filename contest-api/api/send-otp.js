// POST {phone} → sends a 4-digit SMS code via Micropay, only to phones listed in
// contestInstructors/{phone}. Rate-limited per phone (60s between codes, 5 per hour).
const { cors, send, normalizePhone, hmac, fsGet, fsSet, stage1Open, readJson } = require('../lib/common');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  try {
    const phone = normalizePhone((await readJson(req)).phone);
    if (!phone) return send(res, 400, { error: 'מספר טלפון לא תקין' });

    const inst = await fsGet('contestInstructors/' + phone);
    if (!inst) return send(res, 403, { error: 'המספר הזה לא מופיע ברשימת המרקידים' });
    if (!(await stage1Open())) return send(res, 403, { error: 'הבחירה נסגרה' });

    const now = Date.now();
    const prev = (await fsGet('contestOtps/' + phone)) || {};
    if (prev.sentAt && now - prev.sentAt < 60e3) return send(res, 429, { error: 'קוד נשלח לפני רגע — אפשר לבקש חדש בעוד דקה' });
    const inWindow = prev.windowStart && now - prev.windowStart < 3600e3;
    const sendCount = inWindow ? (prev.sendCount || 0) : 0;
    if (sendCount >= 5) return send(res, 429, { error: 'יותר מדי בקשות קוד — נסו שוב בעוד שעה' });

    const code = String(1000 + require('crypto').randomInt(9000));
    await fsSet('contestOtps/' + phone, {
      codeHash: hmac('o:' + phone + ':' + code),
      expiresAt: now + 10 * 60e3,
      attempts: 0,
      sentAt: now,
      sendCount: sendCount + 1,
      windowStart: inWindow ? prev.windowStart : now
    });

    // Last line is the WebOTP format, so Chrome on Android can fill the code automatically.
    const msg = `מצעד הריקודים\nקוד הכניסה שלך: ${code}\nתקף ל-10 דקות\n\n@club.gadibitton.co.il #${code}`;
    const url = 'https://www.micropay.co.il/extApi/scheduleSms.php?get=1'
      + '&token=' + encodeURIComponent(process.env.MICROPAY_TOKEN || '')
      + '&msg=' + encodeURIComponent(msg)
      + '&list=' + phone
      + '&from=' + encodeURIComponent(process.env.MICROPAY_FROM || '');
    const txt = await (await fetch(url)).text();
    if (!txt.startsWith('OK')) {
      console.error('micropay', txt);
      return send(res, 502, { error: 'שליחת ה-SMS נכשלה, נסו שוב' });
    }
    send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'שגיאת מערכת' });
  }
};
