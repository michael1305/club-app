// Security regression checks — run before every release:  node tests/security-regression.js
// No dependencies. Static checks on firestore.rules + a unit test of the admin app's id filter.
// (Full rule tests against the Firestore emulator need Java; see CLAUDE.md "Security".)
//
// Each check guards a vulnerability that was found and fixed — do not delete a check to make
// the script pass; fix the code instead.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');   // Windows checkouts may be CRLF
const rules = read('firestore.rules');
const rulesCode = rules.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const appJs = read('app.js');

let failed = 0;
function check(name, ok) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) failed++;
}

// --- 2026-11-23: allowlists by email could be claimed by signing up an unused address ---
check('rules: no access decision uses request.auth.token.email', !/token\.email/.test(rulesCode));
check('rules: hasUid() checks request.auth.uid', /request\.auth\.uid in uids/.test(rulesCode));
check('rules: isAdmin/siteEditor/contestBot/contestAdmin all use hasUid()',
  ['isAdmin', 'siteEditor', 'contestBot', 'contestAdmin'].every(fn => {
    const i = rulesCode.indexOf('function ' + fn + '()');
    return i >= 0 && rulesCode.slice(i, rulesCode.indexOf('\n    }', i)).includes('hasUid(');
  }));

// --- 2026-11-23: temporary store-reviewer admin (kept only for the Google Play production review) ---
// Allowed until REVIEWER_DEADLINE with a warning; after that its presence fails the run.
const REVIEWER_DEADLINE = new Date('2026-12-10');
if (/google-review/.test(rules) && new Date() < REVIEWER_DEADLINE) {
  console.log('WARN rules: temporary google-review admin still present — remove after Play approval (fails from 2026-12-10)');
} else {
  check('rules: no google-review reviewer account', !/google-review/.test(rules));
}

// --- 2026-11-23: stored XSS via member doc id embedded in admin onclick handlers ---
check('rules: members create requires safeId(memberId)', /allow create: if safeId\(memberId\)/.test(rulesCode));
check('rules: deletionRequests require safeId(reqId)', /safeId\(reqId\)/.test(rulesCode));
check('rules: phones key is digits only', /phoneKey\.matches\('\^\[0-9\]\{1,20\}\$'\)/.test(rulesCode));
const rulesRe = (/function safeId[\s\S]*?matches\('([^']+)'\)/.exec(rulesCode) || [])[1];
const appRe = (/const SAFE_ID_RE = \/(.+)\/;/.exec(appJs) || [])[1];
check('rules safeId() and app.js SAFE_ID_RE are identical', !!rulesRe && rulesRe === appRe);

// --- 2026-11-24: contest-admin self sign-up let anyone claim a listed phone first ---
check("contest-admin.html has no self sign-up", !/createUserWithEmailAndPassword/.test(read("contest-admin.html")));

// unit test of _safeDocs from app.js
const start = appJs.indexOf('const SAFE_ID_RE');
const end = appJs.indexOf('\n}\n', appJs.indexOf('function _safeDocs')) + 3;
const ctx = { console: { warn() {} } };
vm.createContext(ctx);
vm.runInContext(appJs.slice(start, end) + '\nthis._safeDocs = _safeDocs;', ctx);
const snap = docs => ({ docs: docs.map(([id, data]) => ({ id, data: () => data })) });
const evil = ["x');alert(1);//", 'a b', 'a"b', 'a<b>', "a'", 'a)', ''];
const good = ['mbt3k9x0a1b2c3d4e5f6g7', 'demoreviewer1', 'abc_DEF-1.2'];
check('_safeDocs drops every malicious doc key',
  ctx._safeDocs(snap(evil.map(id => [id, { id }]))).length === 0);
check('_safeDocs drops a safe key whose id/memberId/refId field is malicious',
  ctx._safeDocs(snap([['ok1', { id: "x');alert(1)//" }], ['ok2', { memberId: "'-alert(1)-'" }], ['ok3', { refId: 'a b' }]])).length === 0);
check('_safeDocs keeps legitimate ids', ctx._safeDocs(snap(good.map(id => [id, { id, memberId: '' }]))).length === good.length);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll security checks passed');
process.exit(failed ? 1 : 0);
