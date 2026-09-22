// Admin sign-in gate, shared by index.html and guest.html.
// Uses its own named Firebase app ("admin") so the admin session is kept
// separate from the anonymous session that the public pages (user.html,
// register.html) use on the same browser — opening a member's page must
// not sign the admin out.
const _ADMIN_FIREBASE_CONFIG = {
    apiKey: "AIzaSyCOBQNSRju9Fgxy3_DZAWapzuyv0DoUUCo",
    projectId: "club-app-8f954",
    appId: "1:181296970595:web:6cd7578d10d563f3c73156"
};

function _adminApp() {
    try { return firebase.app('admin'); }
    catch (e) { return firebase.initializeApp(_ADMIN_FIREBASE_CONFIG, 'admin'); }
}

// Admins can sign in with an email OR an Israeli mobile number. A phone number is
// mapped to a fixed internal email (no SMS involved); the same mapping is used
// when creating the user in the Firebase console and in firestore.rules.
function adminLoginEmail(input) {
    const v = String(input || '').trim();
    if (v.includes('@')) return v.toLowerCase();
    let d = v.replace(/\D/g, '');
    if (d.startsWith('972')) d = '0' + d.slice(3);
    return d ? d + '@club-admin.local' : '';
}

// Admins whose login should land on a specific page instead of the main back office.
// (Only applied when they sign in on admin.html; guest.html itself is unaffected.)
const _ADMIN_LANDING = {
    '0528588408@club-admin.local': 'guest.html'   // guest entry
};

function adminSignOut() {
    _adminApp().auth().signOut().then(() => location.reload());
}

// Calls onReady(db) once, after an email/password (non-anonymous) admin is signed in.
function requireAdmin(onReady) {
    const app = _adminApp();
    const auth = app.auth();

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#f8f9fa;display:flex;align-items:center;justify-content:center;padding:20px;direction:rtl;font-family:Arial,sans-serif';
    overlay.innerHTML =
        '<form id="admin-login-form" style="background:#fff;padding:28px 24px;border-radius:14px;box-shadow:0 4px 20px rgba(0,0,0,.1);width:100%;max-width:340px">' +
        '<h2 style="margin:0 0 6px;color:#6c5ce7;text-align:center">כניסת מנהל</h2>' +
        '<p style="margin:0 0 18px;color:#636e72;font-size:14px;text-align:center">יש להתחבר כדי לנהל את המועדון</p>' +
        '<input id="admin-email" type="text" inputmode="email" autocomplete="username" placeholder="אימייל או טלפון" required style="width:100%;box-sizing:border-box;padding:12px;margin-bottom:10px;border:1px solid #dfe6e9;border-radius:8px;font-size:16px;direction:ltr">' +
        '<input id="admin-password" type="password" autocomplete="current-password" placeholder="סיסמה" required style="width:100%;box-sizing:border-box;padding:12px;margin-bottom:10px;border:1px solid #dfe6e9;border-radius:8px;font-size:16px;direction:ltr">' +
        '<div id="admin-login-error" style="color:#d63031;font-size:14px;min-height:20px;margin-bottom:8px"></div>' +
        '<button id="admin-login-btn" type="submit" style="width:100%;padding:12px;border:none;border-radius:8px;background:#6c5ce7;color:#fff;font-size:16px;cursor:pointer">התחבר</button>' +
        '</form>';
    document.body.appendChild(overlay);
    overlay.hidden = true;

    const form = overlay.querySelector('#admin-login-form');
    const errEl = overlay.querySelector('#admin-login-error');
    const btn = overlay.querySelector('#admin-login-btn');

    form.addEventListener('submit', e => {
        e.preventDefault();
        errEl.textContent = '';
        btn.disabled = true;
        auth.signInWithEmailAndPassword(
            adminLoginEmail(overlay.querySelector('#admin-email').value),
            overlay.querySelector('#admin-password').value
        ).catch(err => {
            const bad = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'];
            errEl.textContent = bad.includes(err.code) ? 'אימייל או סיסמה שגויים'
                : err.code === 'auth/too-many-requests' ? 'יותר מדי ניסיונות, נסה שוב מאוחר יותר'
                : 'שגיאת התחברות — נסה שוב';
        }).finally(() => { btn.disabled = false; });
    });

    let started = false;
    auth.onAuthStateChanged(user => {
        if (user && !user.isAnonymous) {
            const landing = _ADMIN_LANDING[(user.email || '').toLowerCase()];
            const skipLanding = /[?&]full=1(&|$)/.test(location.search);
            if (landing && !skipLanding && /admin\.html$/.test(location.pathname)) { location.replace(landing); return; }
            overlay.hidden = true;
            overlay.style.display = 'none';
            if (!started) { started = true; onReady(app.firestore()); }
        } else {
            overlay.hidden = false;
            overlay.style.display = 'flex';
        }
    });
}
