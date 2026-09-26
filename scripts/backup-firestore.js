// Exports every Firestore collection of the club to one JSON file (no Blaze plan needed).
//
//   node scripts/backup-firestore.js [adminEmailOrPhone] [outputDir]
//
// Signs in as a club admin (password is typed at the prompt, never stored) and reads the
// collections through the Firestore REST API, so it is subject to the normal
// firestore.rules. Output defaults to D:\CLAUDE\_firestore-backups (outside this PUBLIC
// git repo, inside the Google-Drive-synced folder). NEVER commit the output: it holds
// members' personal data.
const fs = require('fs');
const path = require('path');

const API_KEY = 'AIzaSyCOBQNSRju9Fgxy3_DZAWapzuyv0DoUUCo'; // public web key, same as the apps
const PROJECT = 'club-app-8f954';
const COLLECTIONS = ['members', 'payments', 'checkins', 'guests', 'guestcheckins',
    'memberLog', 'deletionRequests', 'phones', 'promotions', 'settings'];
// members/{id}/checkins is a mirror of the top-level `checkins` collection, so it is not exported.

function loginEmail(input) {
    const v = String(input || '').trim();
    if (v.includes('@')) return v.toLowerCase();
    let d = v.replace(/\D/g, '');
    if (d.startsWith('972')) d = '0' + d.slice(3);
    return d + '@club-admin.local';
}

// Firestore REST typed value -> plain JS value
function fromValue(v) {
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
    if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
    if ('referenceValue' in v) return v.referenceValue;
    if ('geoPointValue' in v) return v.geoPointValue;
    if ('bytesValue' in v) return v.bytesValue;
    return v;
}
function fromFields(fields) {
    const o = {};
    for (const k of Object.keys(fields)) o[k] = fromValue(fields[k]);
    return o;
}

function askPassword(prompt) {
    if (process.env.CLUB_ADMIN_PASSWORD) return Promise.resolve(process.env.CLUB_ADMIN_PASSWORD);
    return new Promise(resolve => {
        process.stdout.write(prompt);
        if (!process.stdin.isTTY) {
            process.stdin.once('data', d => resolve(String(d).trim()));
            return;
        }
        let pw = '';
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        const onData = ch => {
            for (const c of ch) {
                if (c === '\r' || c === '\n') {
                    process.stdin.setRawMode(false);
                    process.stdin.pause();
                    process.stdin.removeListener('data', onData);
                    process.stdout.write('\n');
                    return resolve(pw);
                }
                if (c === '\u0003') process.exit(130);
                if (c === '\u007f' || c === '\b') pw = pw.slice(0, -1);
                else pw += c;
            }
        };
        process.stdin.on('data', onData);
    });
}

async function signIn(email, password) {
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const j = await r.json();
    if (!r.ok) throw new Error('Sign-in failed: ' + ((j.error && j.error.message) || r.status));
    return j.idToken;
}

async function readCollection(name, token) {
    const docs = [];
    let pageToken = '';
    do {
        const url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT +
            '/databases/(default)/documents/' + name + '?pageSize=300' +
            (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
        const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
        const j = await r.json();
        if (!r.ok) throw new Error(((j.error && j.error.message) || r.status) + '');
        for (const d of j.documents || []) {
            docs.push({ id: d.name.split('/').pop(), data: fromFields(d.fields || {}) });
        }
        pageToken = j.nextPageToken || '';
    } while (pageToken);
    return docs;
}

(async () => {
    const email = loginEmail(process.argv[2] || 'info@av.co.il');
    const outDir = process.argv[3] || 'D:\\CLAUDE\\_firestore-backups';

    const password = await askPassword('Password for ' + email + ': ');
    const token = await signIn(email, password);

    const result = { exportedAt: new Date().toISOString(), project: PROJECT, collections: {}, errors: {} };
    for (const name of COLLECTIONS) {
        try {
            result.collections[name] = await readCollection(name, token);
            console.log(name.padEnd(18), result.collections[name].length);
        } catch (e) {
            result.errors[name] = e.message;
            console.log(name.padEnd(18), 'FAILED -', e.message);
        }
    }

    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const file = path.join(outDir, 'club-backup-' + stamp + '.json');
    fs.writeFileSync(file, JSON.stringify(result, null, 1), 'utf8');
    const failed = Object.keys(result.errors).length;
    console.log('\nSaved: ' + file + ' (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
    if (failed) { console.log('WARNING: ' + failed + ' collection(s) failed - backup is INCOMPLETE.'); process.exitCode = 2; }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
