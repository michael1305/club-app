// ===== FIREBASE CONFIG & DATA LAYER =====
const _firebaseConfig = {
    apiKey: "AIzaSyCOBQNSRju9Fgxy3_DZAWapzuyv0DoUUCo",
    projectId: "club-app-8f954",
    appId: "1:181296970595:web:6cd7578d10d563f3c73156"
};

let _db = null;
let _members = [];
let _payments = [];
let _checkins = [];
let _guests = [];
let _guestCheckins = [];

// Settings stay in localStorage (device-specific preferences)
const DB = {
    getSetting(key, fallback = '') {
        return localStorage.getItem('club_setting_' + key) || fallback;
    },
    setSetting(key, val) { localStorage.setItem('club_setting_' + key, val); }
};

function _initFirebase() {
    if (typeof firebase === 'undefined') return;
    if (!firebase.apps.length) firebase.initializeApp(_firebaseConfig);
    _db = firebase.firestore();
    _db.enablePersistence().catch(() => {});

    firebase.auth().signInAnonymously().then(() => {
        _db.collection('members').onSnapshot(snap => {
            _members = snap.docs.map(d => d.data());
            _onDataChange();
        }, () => {});

        _db.collection('payments').onSnapshot(snap => {
            _payments = snap.docs.map(d => d.data());
            _onDataChange();
        }, () => {});

        _db.collection('checkins').onSnapshot(snap => {
            _checkins = snap.docs.map(d => d.data());
            _onDataChange();
        }, () => {});

        _db.collection('guests').onSnapshot(snap => {
            _guests = snap.docs.map(d => d.data());
            _onDataChange();
        }, () => {});

        _db.collection('guestcheckins').onSnapshot(snap => {
            _guestCheckins = snap.docs.map(d => d.data());
            _onDataChange();
        }, () => {});

        _migrateFromLocalStorage();
    }).catch(() => {
        showToast('שגיאת חיבור — נסה שוב');
    });
}

function _onDataChange() {
    if (!document.getElementById('members-list')) return;
    const activePage = document.querySelector('.page.active')?.id;
    if (activePage === 'page-members') renderMembers();
    else if (activePage === 'page-payments') renderPayments();
    else if (activePage === 'page-reports') renderReports();
    else if (activePage === 'page-checkin') renderCheckinMembers();
    else if (activePage === 'page-guestlist') renderGuestList();
}

// One-time migration of existing localStorage data to Firestore
function _migrateFromLocalStorage() {
    if (localStorage.getItem('club_firebase_migrated_v1')) return;
    const parse = key => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
    const members  = parse('club_members');
    const payments = parse('club_payments');
    const checkins = parse('club_checkins');
    if (!members.length && !payments.length && !checkins.length) {
        localStorage.setItem('club_firebase_migrated_v1', '1');
        return;
    }
    const batch = _db.batch();
    members.forEach(m  => batch.set(_db.collection('members').doc(m.id),  m));
    payments.forEach(p => batch.set(_db.collection('payments').doc(p.id), p));
    checkins.forEach(c => batch.set(_db.collection('checkins').doc(c.id), c));
    batch.commit().then(() => {
        localStorage.setItem('club_firebase_migrated_v1', '1');
        showToast('נתוני המערכת הועברו לענן ✓');
    }).catch(() => {});
}

// Sync reads (from in-memory cache kept up-to-date by onSnapshot)
function getMembers()       { return _members; }
function getPayments()      { return _payments; }
function getCheckins()      { return _checkins; }
function getGuests()        { return _guests; }
function getGuestCheckins() { return _guestCheckins; }

// Targeted async writes to Firestore
function _saveMember(member)              { if (_db) _db.collection('members').doc(member.id).set(member); }
function _updateMember(id, fields)        { if (_db) _db.collection('members').doc(id).update(fields); }
function _deleteMemberDoc(id)             { if (_db) _db.collection('members').doc(id).delete(); }
function _savePayment(payment)            { if (_db) _db.collection('payments').doc(payment.id).set(payment); }
function _saveCheckin(checkin)            { if (_db) _db.collection('checkins').doc(checkin.id).set(checkin); }
function _saveGuest(g)                    { if (_db) _db.collection('guests').doc(g.id).set(g); }
function _deleteGuest(id)                 { if (_db) _db.collection('guests').doc(id).delete(); }
function _saveGuestCheckin(gc)            { if (_db) _db.collection('guestcheckins').doc(gc.id).set(gc); }
function _deleteGuestCheckin(id)          { if (_db) _db.collection('guestcheckins').doc(id).delete(); }

function getBaseUrl() {
    return location.href.replace(/index\.html.*$/, '').replace(/\?.*$/, '').replace(/\/$/, '') + '/';
}

function getUserUrl(memberId) {
    return getBaseUrl() + 'user.html?id=' + memberId;
}

function extractMemberIdFromText(text) {
    try {
        const url = new URL(text);
        const id = url.searchParams.get('id');
        if (id) return id;
    } catch {}
    try {
        const data = JSON.parse(text);
        if (data && data.id) return data.id;
    } catch {}
    return null;
}

// ===== NAVIGATION =====
function showPage(page) {
    if (page !== 'checkin') {
        stopQrScanner();
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    const navBtn = document.querySelector(`.nav-btn[data-page="${page}"]`);
    if (navBtn) navBtn.classList.add('active');

    if (page === 'members') renderMembers();
    if (page === 'payments') renderPayments();
    if (page === 'reports') renderReports();
    if (page === 'checkin') renderCheckinMembers();
    if (page === 'guestlist') renderGuestList();
    if (page === 'settings') loadSettings();
}

// ===== MEMBERS =====
function renderMembers() {
    const members = getMembers();
    const search = document.getElementById('search-members').value.toLowerCase();
    const filtered = members.filter(m =>
        m.name.toLowerCase().includes(search) || m.phone.includes(search)
    );
    const list = document.getElementById('members-list');

    if (filtered.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:40px;color:#b2bec3;">אין משתתפים עדיין. לחץ "+ הוספה" כדי להתחיל</div>';
        return;
    }

    list.innerHTML = filtered.map(m => {
        const balance = m.balance || 0;
        const vip = m.vipSlots || 0;
        let badge;
        if (vip > 0) badge = `<span class="badge badge-warning">⭐ חופשי${vip > 1 ? ' ×2' : ''}</span>`;
        else if (balance <= 0) badge = `<span class="badge badge-danger">אין יתרה</span>`;
        else if (balance <= 2) badge = `<span class="badge badge-warning">${balance} כניסות</span>`;
        else badge = `<span class="badge badge-success">${balance} כניסות</span>`;
        return `
        <div class="card" onclick="showMemberDetails('${m.id}')">
            ${avatarHtml(m)}
            <div class="card-info">
                <h4>${escHtml(m.name)}</h4>
                <p>${escHtml(m.phone)}</p>
            </div>
            <div class="card-actions">
                ${badge}
                <button class="icon-btn" onclick="event.stopPropagation();showMemberQR('${m.id}')">🔳</button>
            </div>
        </div>`;
    }).join('');
}

function avatarHtml(member, size = 44) {
    if (member.photo) {
        return `<img src="${member.photo}" class="avatar" style="width:${size}px;height:${size}px">`;
    }
    const initial = (member.name || '?').trim().charAt(0);
    return `<div class="avatar avatar-placeholder" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px">${escHtml(initial)}</div>`;
}

function filterMembers() { renderMembers(); }

let pendingPhotoData = null;

function resizeImageToBase64(file, maxSize, callback) {
    const reader = new FileReader();
    reader.onload = e => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            if (width > height && width > maxSize) {
                height = Math.round(height * (maxSize / width));
                width = maxSize;
            } else if (height > maxSize) {
                width = Math.round(width * (maxSize / height));
                height = maxSize;
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            callback(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function handlePhotoSelect(event, previewId) {
    const file = event.target.files[0];
    if (!file) return;
    resizeImageToBase64(file, 300, dataUrl => {
        pendingPhotoData = dataUrl;
        const preview = document.getElementById(previewId);
        if (preview) preview.innerHTML = `<img src="${dataUrl}" class="avatar" style="width:90px;height:90px">`;
    });
}

function photoFieldHtml(existingPhoto) {
    return `
        <div class="form-group">
            <label>תמונה (אופציונלי)</label>
            <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
                <div id="photo-preview">${existingPhoto ? `<img src="${existingPhoto}" class="avatar" style="width:90px;height:90px">` : '<div class="avatar avatar-placeholder" style="width:90px;height:90px;font-size:36px">?</div>'}</div>
                <div style="display:flex;flex-direction:column;gap:8px">
                    <button type="button" class="btn btn-primary" onclick="openCameraCapture('photo-preview')">📷 צלם תמונה</button>
                    <button type="button" class="btn btn-secondary" onclick="document.getElementById('photo-file-input').click()">🖼️ בחר מהגלריה</button>
                </div>
                <input type="file" id="photo-file-input" accept="image/*" hidden onchange="handlePhotoSelect(event,'photo-preview')">
            </div>
        </div>`;
}

// ===== CAMERA PHOTO CAPTURE =====
let cameraStream = null;
let cameraFacingMode = 'environment';
let cameraTargetPreviewId = null;

function openCameraCapture(previewId) {
    cameraFacingMode = 'environment';
    cameraTargetPreviewId = previewId;
    document.getElementById('camera-error').textContent = '';
    document.getElementById('camera-overlay').classList.add('visible');
    startCameraStream();
}

function startCameraStream() {
    stopCameraStream();
    const video = document.getElementById('camera-video');
    const errorEl = document.getElementById('camera-error');
    if (!video) return;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: cameraFacingMode } })
        .then(stream => {
            cameraStream = stream;
            video.srcObject = stream;
        })
        .catch(() => {
            if (errorEl) errorEl.textContent = 'לא ניתן לגשת למצלמה. ודא שניתנה הרשאת מצלמה לאתר.';
        });
}

function stopCameraStream() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
}

function switchCameraFacing() {
    cameraFacingMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    startCameraStream();
}

function capturePhoto() {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    if (!video || !video.videoWidth) return;

    const maxSize = 300;
    let width = video.videoWidth;
    let height = video.videoHeight;
    if (width > height && width > maxSize) {
        height = Math.round(height * (maxSize / width));
        width = maxSize;
    } else if (height > maxSize) {
        width = Math.round(width * (maxSize / height));
        height = maxSize;
    }
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.75);

    pendingPhotoData = dataUrl;
    const preview = document.getElementById(cameraTargetPreviewId);
    if (preview) preview.innerHTML = `<img src="${dataUrl}" class="avatar" style="width:90px;height:90px">`;

    closeCameraCapture();
}

function closeCameraCapture() {
    stopCameraStream();
    document.getElementById('camera-overlay').classList.remove('visible');
}

function showAddMember() {
    pendingPhotoData = null;
    openModal('הוספת משתתף', `
        <div class="form-group">
            <label>שם מלא</label>
            <input type="text" id="member-name" placeholder="שם מלא">
        </div>
        <div class="form-group">
            <label>טלפון</label>
            <input type="tel" id="member-phone" placeholder="050-1234567">
        </div>
        <div class="form-group">
            <label>אימייל (אופציונלי)</label>
            <input type="email" id="member-email" placeholder="email@example.com">
        </div>
        ${photoFieldHtml(null)}
        <button class="btn btn-primary btn-block" onclick="addMember()">הוסף משתתף</button>
    `);
    setTimeout(() => document.getElementById('member-name').focus(), 300);
}

function addMember() {
    const name = document.getElementById('member-name').value.trim();
    const phone = document.getElementById('member-phone').value.trim();
    const email = document.getElementById('member-email').value.trim();

    if (!name) { showToast('נא להזין שם'); return; }
    if (!phone) { showToast('נא להזין טלפון'); return; }

    const member = {
        id: generateId(),
        name,
        phone,
        email,
        photo: pendingPhotoData,
        nfcTag: null,
        balance: 0,
        createdAt: new Date().toISOString()
    };
    _saveMember(member);
    pendingPhotoData = null;
    closeModal();
    showToast('משתתף נוסף בהצלחה ✓');
}

function showMemberDetails(id) {
    const member = getMembers().find(m => m.id === id);
    if (!member) return;

    const payments = getPayments().filter(p => p.memberId === id);
    const checkins = getCheckins().filter(c => c.memberId === id);
    const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const balance = member.balance || 0;

    let balanceBadge;
    if (balance <= 0) balanceBadge = `<span class="badge badge-danger">אין יתרה - יש להוסיף כניסות</span>`;
    else if (balance <= 2) balanceBadge = `<span class="badge badge-warning">${balance} כניסות נותרו</span>`;
    else balanceBadge = `<span class="badge badge-success">${balance} כניסות נותרו</span>`;

    openModal(member.name, `
        <div style="text-align:center;margin-bottom:16px">${avatarHtml(member, 90)}</div>
        <div style="margin-bottom:16px">
            <p>📞 ${escHtml(member.phone)}</p>
            ${member.email ? `<p>📧 ${escHtml(member.email)}</p>` : ''}
            <p>📅 הצטרף: ${formatDate(new Date(member.createdAt))}</p>
            <p>יתרת כניסות: ${balanceBadge}</p>
            <p>💰 שילם סה"כ: ₪${totalPaid}</p>
            <p>🚪 כניסות בפועל: ${checkins.length}</p>
            <p>📱 כרטיס NFC: ${member.nfcTag ? '<span class="badge badge-success">משויך ✓</span>' : '<span class="badge badge-info">לא משויך</span>'}</p>
            <p>⭐ כניסה חופשית: ${(member.vipSlots||0) > 0 ? `<span class="badge badge-warning">${member.vipSlots} ${member.vipSlots>1?'אנשים':'אדם'}</span>` : 'לא'}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" onclick="closeModal();showAddEntriesFor('${id}')">➕ הוספת כניסות</button>
            <button class="btn btn-secondary" onclick="showEditBalance('${id}')">✏️ עריכת יתרה</button>
            <button class="btn btn-secondary" onclick="showVipSettings('${id}')">⭐ כניסה חופשית</button>
            <button class="btn btn-secondary" onclick="showMemberQR('${id}')">🔳 QR</button>
            <button class="btn btn-secondary" onclick="assignNfc('${id}')">📱 ${member.nfcTag ? 'שיוך כרטיס חדש' : 'שיוך NFC'}</button>
            ${member.nfcTag ? `<button class="btn btn-secondary" onclick="removeNfc('${id}')">🚫 ביטול שיוך NFC</button>` : ''}
            <button class="btn btn-secondary" onclick="closeModal();showEditMember('${id}')">✏️ עריכה</button>
            <button class="btn btn-danger" onclick="deleteMember('${id}')">🗑️ מחיקה</button>
        </div>
        ${payments.length > 0 ? `
        <h4 style="margin-top:20px;margin-bottom:10px">היסטוריית רכישות</h4>
        ${payments.slice(-5).reverse().map(p => `
            <div class="recent-item">
                <span>${formatDate(new Date(p.date))}</span>
                <span>${p.quantity ? p.quantity + ' כניסות' : ''}</span>
                <span>₪${p.amount}</span>
            </div>
        `).join('')}` : ''}
        ${checkins.length > 0 ? `
        <h4 style="margin-top:20px;margin-bottom:10px">כניסות אחרונות</h4>
        ${checkins.slice(-5).reverse().map(c => `
            <div class="recent-item">
                <span>${formatDateTime(new Date(c.timestamp))}</span>
                <span>${c.entryType === 'couple' ? 'זוגית (-2)' : 'בודדת (-1)'}</span>
            </div>
        `).join('')}` : ''}
    `);
}

function showEditMember(id) {
    const member = getMembers().find(m => m.id === id);
    if (!member) return;

    pendingPhotoData = member.photo || null;
    openModal('עריכת משתתף', `
        <div class="form-group">
            <label>שם מלא</label>
            <input type="text" id="edit-name" value="${escHtml(member.name)}">
        </div>
        <div class="form-group">
            <label>טלפון</label>
            <input type="tel" id="edit-phone" value="${escHtml(member.phone)}">
        </div>
        <div class="form-group">
            <label>אימייל</label>
            <input type="email" id="edit-email" value="${escHtml(member.email || '')}">
        </div>
        ${photoFieldHtml(member.photo)}
        ${member.photo ? `<button class="btn btn-secondary" onclick="document.getElementById('photo-preview').innerHTML='<div class=&quot;avatar avatar-placeholder&quot; style=&quot;width:90px;height:90px;font-size:36px&quot;>?</div>';pendingPhotoData=null">הסר תמונה</button>` : ''}
        <button class="btn btn-primary btn-block" onclick="updateMember('${id}')" style="margin-top:12px">שמור שינויים</button>
    `);
}

function updateMember(id) {
    const member = getMembers().find(m => m.id === id);
    if (!member) return;

    const updated = {
        ...member,
        name: document.getElementById('edit-name').value.trim(),
        phone: document.getElementById('edit-phone').value.trim(),
        email: document.getElementById('edit-email').value.trim(),
        photo: pendingPhotoData
    };
    _saveMember(updated);
    pendingPhotoData = null;
    closeModal();
    showToast('עודכן בהצלחה ✓');
}

function deleteMember(id) {
    if (!confirm('למחוק את המשתתף? הפעולה לא ניתנת לביטול.')) return;
    _deleteMemberDoc(id);
    closeModal();
    showToast('משתתף נמחק');
}

function showEditBalance(id) {
    const member = getMembers().find(m => m.id === id);
    if (!member) return;
    openModal('עריכת יתרת כניסות - ' + member.name, `
        <p style="color:var(--text-light);margin-bottom:16px">יתרה נוכחית: <strong>${member.balance || 0} כניסות</strong></p>
        <div class="form-group">
            <label>יתרה חדשה</label>
            <input type="number" id="edit-balance-val" value="${member.balance || 0}" min="0">
        </div>
        <button class="btn btn-primary btn-block" onclick="saveEditedBalance('${id}')">שמור</button>
    `);
    setTimeout(() => document.getElementById('edit-balance-val')?.select(), 200);
}

function saveEditedBalance(id) {
    const val = parseInt(document.getElementById('edit-balance-val').value, 10);
    if (isNaN(val) || val < 0) { showToast('יתרה לא תקינה'); return; }
    _updateMember(id, { balance: val });
    closeModal();
    showToast('יתרה עודכנה ✓');
}

function showMemberQR(id) {
    const member = getMembers().find(m => m.id === id);
    if (!member) return;

    const url = getUserUrl(member.id);
    openModal('QR - ' + member.name, `
        <div class="qr-display">
            <div id="qr-canvas-display" style="display:flex;justify-content:center"></div>
            <p style="margin-top:10px;color:var(--text-light)">סרוק כדי לבצע צ'ק-אין, או לצפייה ביתרה האישית</p>
        </div>
    `);

    setTimeout(() => {
        generateQRCode('qr-canvas-display', url);
    }, 100);
}

// ===== PAYMENTS =====
function renderPayments() {
    const payments = getPayments();
    const members = getMembers();
    const search = document.getElementById('search-payments').value.toLowerCase();

    let filtered = payments.map(p => {
        const member = members.find(m => m.id === p.memberId);
        return { ...p, memberName: member ? member.name : 'לא ידוע' };
    });

    if (search) {
        filtered = filtered.filter(p => p.memberName.toLowerCase().includes(search));
    }

    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    const list = document.getElementById('payments-list');
    if (filtered.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:40px;color:#b2bec3;">אין רכישות כניסות עדיין</div>';
        return;
    }

    list.innerHTML = filtered.map(p => `
        <div class="card">
            <div class="card-info">
                <h4>${escHtml(p.memberName)}</h4>
                <p>${formatDate(new Date(p.date))} · ${p.quantity} כניסות</p>
            </div>
            <div class="card-actions">
                <span style="font-weight:700;font-size:1.1rem;color:var(--success)">₪${p.amount}</span>
            </div>
        </div>
    `).join('');
}

function filterPayments() { renderPayments(); }

function showAddPayment() {
    const members = getMembers();
    if (members.length === 0) {
        showToast('הוסף משתתפים קודם');
        return;
    }

    const bookletPrice = parseFloat(DB.getSetting('singlePrice', '0')) || 0;
    openModal('הוספת כניסות', `
        <div class="form-group">
            <label>משתתף</label>
            <select id="pay-member">
                <option value="">בחר משתתף</option>
                ${members.map(m => `<option value="${m.id}">${escHtml(m.name)} (${m.balance || 0} כניסות)</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label>כמות כניסות</label>
            <input type="number" id="pay-quantity" value="11" min="1" oninput="updatePayCalc()">
        </div>
        <div class="form-group">
            <label>אמצעי תשלום</label>
            <div style="display:flex;gap:12px;margin-top:6px">
                <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer">
                    <input type="radio" name="pay-method" value="cash" checked onchange="updatePayCalc()"> 💵 מזומן
                </label>
                <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer">
                    <input type="radio" name="pay-method" value="credit" onchange="updatePayCalc()"> 💳 אשראי
                </label>
            </div>
        </div>
        <div id="pay-calc-display" style="background:#f0eeff;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-weight:600;color:var(--primary)">
            ${bookletPrice > 0 ? `סה"כ לתשלום: ₪${bookletPrice}` : 'הגדר מחיר כרטיסיה בהגדרות'}
        </div>
        <div class="form-group">
            <label>הערה (אופציונלי)</label>
            <input type="text" id="pay-note" placeholder="לדוגמה: הועבר בבנק דיסקונט">
        </div>
        <button class="btn btn-success btn-block" onclick="addPayment()">אישור והוספת כניסות</button>
    `);
}

function updatePayCalc() {
    const qty = parseInt(document.getElementById('pay-quantity')?.value || '11', 10);
    const bookletPrice = parseFloat(DB.getSetting('singlePrice', '0')) || 0;
    const amount = bookletPrice > 0 ? Math.round((qty / 11) * bookletPrice * 100) / 100 : 0;
    const display = document.getElementById('pay-calc-display');
    if (display) {
        display.textContent = bookletPrice > 0
            ? `סה"כ לתשלום: ₪${amount}`
            : 'הגדר מחיר כרטיסיה בהגדרות';
    }
}

function showAddPaymentFor(memberId) {
    showAddPayment();
    setTimeout(() => {
        const sel = document.getElementById('pay-member');
        if (sel) sel.value = memberId;
    }, 100);
}

function showAddEntriesFor(memberId) { showAddPaymentFor(memberId); }

function addPayment() {
    const memberId = document.getElementById('pay-member').value;
    const quantity = parseInt(document.getElementById('pay-quantity').value, 10);
    const note = document.getElementById('pay-note').value.trim();
    const paymentMethod = document.querySelector('input[name="pay-method"]:checked')?.value || 'cash';

    if (!memberId) { showToast('בחר משתתף'); return; }
    if (!quantity || quantity <= 0) { showToast('הזן כמות כניסות תקינה'); return; }

    const bookletPrice = parseFloat(DB.getSetting('singlePrice', '0')) || 0;
    const amount = bookletPrice > 0 ? Math.round((quantity / 11) * bookletPrice * 100) / 100 : 0;

    const payment = {
        id: generateId(),
        memberId,
        quantity,
        amount,
        paymentMethod,
        note,
        terminal: DB.getSetting('terminalName', 'ראשי'),
        date: new Date().toISOString()
    };
    _savePayment(payment);

    const member = getMembers().find(m => m.id === memberId);
    if (member) {
        _updateMember(memberId, { balance: (member.balance || 0) + quantity });
    }

    closeModal();
    showToast(`נוספו ${quantity} כניסות ✓`);
}

// ===== CHECK-IN =====
function switchCheckinTab(tab) {
    document.querySelectorAll('.checkin-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.checkin-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.checkin-tabs .tab-btn:nth-child(${tab === 'qr' ? 1 : tab === 'nfc' ? 2 : 3})`).classList.add('active');
    document.getElementById('checkin-' + tab).classList.add('active');
    hideCheckinResult();

    if (tab !== 'qr') stopQrScanner();
    if (tab !== 'nfc') stopNfc();
    if (tab === 'manual') renderCheckinMembers();
}

function renderCheckinMembers() {
    const members = getMembers();
    const search = (document.getElementById('manual-checkin-search')?.value || '').toLowerCase();
    const filtered = members.filter(m =>
        m.name.toLowerCase().includes(search) || m.phone.includes(search)
    );
    const list = document.getElementById('checkin-members-list');

    list.innerHTML = filtered.map(m => `
        <div class="card">
            <div style="display:flex;align-items:center;gap:12px;flex:1;cursor:pointer" onclick="showMemberDetails('${m.id}')">
                ${avatarHtml(m)}
                <div class="card-info">
                    <h4>${escHtml(m.name)}</h4>
                    <p>${escHtml(m.phone)}</p>
                </div>
            </div>
            <div class="card-actions">
                <button class="btn btn-success" onclick="doCheckin('${m.id}')">✓ כניסה</button>
            </div>
        </div>
    `).join('');
}

function filterCheckinMembers() { renderCheckinMembers(); }

function doCheckin(memberId) {
    const member = getMembers().find(m => m.id === memberId);
    if (!member) {
        showCheckinResult('משתתף לא נמצא', false);
        return;
    }

    if ((member.vipSlots || 0) > 0) {
        doVipCheckin(member);
        return;
    }

    const balance = member.balance || 0;
    if (balance <= 0) {
        showCheckinResult(`✕ ל${member.name} אין יתרת כניסות. יש להוסיף כניסות לפני הכניסה.`, false);
        return;
    }

    openModal('בחירת סוג כניסה', `
        <div style="text-align:center;margin-bottom:16px">
            ${avatarHtml(member, 140)}
            <p style="margin-top:10px;font-size:1.2rem;font-weight:700">${escHtml(member.name)}</p>
            <p style="color:var(--text-light)">יתרה נוכחית: ${balance} כניסות</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
            <button class="btn btn-primary btn-block" onclick="performCheckin('${memberId}','single')">כניסה בודדת (-1)</button>
            <button class="btn btn-secondary btn-block" onclick="performCheckin('${memberId}','couple')" ${balance < 2 ? 'disabled' : ''}>כניסה זוגית (-2)</button>
        </div>
        ${balance < 2 ? '<p style="margin-top:10px;color:var(--text-light);font-size:0.85rem">אין מספיק יתרה לכניסה זוגית</p>' : ''}
    `);
}

function performCheckin(memberId, entryType) {
    const member = getMembers().find(m => m.id === memberId);
    if (!member) {
        closeModal();
        showCheckinResult('משתתף לא נמצא', false);
        return;
    }

    const cost = entryType === 'couple' ? 2 : 1;
    const balance = member.balance || 0;

    if (balance < cost) {
        closeModal();
        showCheckinResult(`✕ אין מספיק יתרה (נדרש ${cost}, יש ${balance})`, false);
        return;
    }

    const newBalance = balance - cost;
    _updateMember(memberId, { balance: newBalance });

    const checkin = {
        id: generateId(),
        memberId,
        entryType,
        terminal: DB.getSetting('terminalName', 'ראשי'),
        timestamp: new Date().toISOString()
    };
    _saveCheckin(checkin);

    closeModal();

    let msg = `✓ ${member.name} נכנס/ה בהצלחה! (${entryType === 'couple' ? 'זוגית' : 'בודדת'})\nנותרו ${newBalance} כניסות`;
    if (newBalance <= 0) msg += '\n⚠ זו הכניסה האחרונה - יש להוסיף כניסות';
    else if (newBalance <= 2) msg += '\n⚠ יתרה נמוכה';

    showCheckinResult(msg, true);
    showToast('צ\'ק-אין בוצע ✓');

    if (document.getElementById('page-checkin').classList.contains('active')) {
        renderCheckinMembers();
    }

    // Restart NFC automatically for the next person
    if ('NDEFReader' in window) setTimeout(startNfc, 1500);
}

function showCheckinResult(msg, success) {
    const el = document.getElementById('checkin-result');
    el.hidden = false;
    el.className = 'checkin-result ' + (success ? 'success' : 'error');
    el.textContent = msg;
    setTimeout(() => hideCheckinResult(), 4000);
}

function hideCheckinResult() {
    document.getElementById('checkin-result').hidden = true;
}

// ===== QR SCANNER =====
let qrStream = null;

function startQrScanner() {
    const video = document.getElementById('qr-video');
    const readerBox = document.getElementById('qr-reader');

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
            qrStream = stream;
            video.srcObject = stream;
            video.style.display = 'block';
            readerBox.style.display = 'none';
            video.play();
            scanQrFrame();
        })
        .catch(() => {
            showToast('לא ניתן לגשת למצלמה');
        });
}

function scanQrFrame() {
    if (!qrStream) return;
    const video = document.getElementById('qr-video');
    const canvas = document.getElementById('qr-canvas');
    const ctx = canvas.getContext('2d');

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        if (typeof jsQR !== 'undefined') {
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code) {
                const memberId = extractMemberIdFromText(code.data);
                if (memberId) {
                    stopQrScanner();
                    doCheckin(memberId);
                    return;
                }
            }
        }
    }
    requestAnimationFrame(scanQrFrame);
}

function stopQrScanner() {
    if (qrStream) {
        qrStream.getTracks().forEach(t => t.stop());
        qrStream = null;
    }
    const video = document.getElementById('qr-video');
    video.style.display = 'none';
    document.getElementById('qr-reader').style.display = 'block';
}

// ===== NFC =====
let nfcAbortController = null;

function parseNfcMessage(message) {
    for (const record of message.records) {
        if (record.recordType === 'url' || record.recordType === 'text') {
            try {
                const decoder = new TextDecoder(record.encoding || 'utf-8');
                const text = decoder.decode(record.data);
                const id = extractMemberIdFromText(text);
                if (id) return id;
            } catch {}
        }
    }
    return null;
}

function toggleNfc() {
    if (nfcAbortController) {
        stopNfc();
    } else {
        startNfc();
    }
}

function _setNfcUi(active) {
    const topBtn = document.getElementById('top-nfc-btn');
    const btn = document.getElementById('nfc-btn');
    const statusEl = document.getElementById('nfc-status');
    if (topBtn) {
        topBtn.textContent = active ? '📡' : '📵';
        topBtn.classList.toggle('nfc-active', active);
    }
    if (btn) btn.textContent = active ? 'עצור NFC' : 'הפעל NFC';
    if (statusEl) { statusEl.textContent = active ? 'NFC פעיל - קרב כרטיס' : ''; statusEl.style.color = 'var(--success)'; }
}

function startNfc() {
    const statusEl = document.getElementById('nfc-status');

    if (!('NDEFReader' in window)) {
        showToast('NFC לא נתמך — נדרש Chrome באנדרואיד');
        return;
    }

    stopNfc();

    nfcAbortController = new AbortController();
    const ndef = new NDEFReader();
    ndef.scan({ signal: nfcAbortController.signal }).then(() => {
        _setNfcUi(true);

        ndef.onreading = event => {
            const memberId = parseNfcMessage(event.message) ||
                getMembers().find(m => m.nfcTag === event.serialNumber)?.id;
            if (memberId) {
                doCheckin(memberId);
            } else {
                showCheckinResult('כרטיס NFC לא מזוהה. יש לשייך אותו למשתתף תחילה.', false);
                // Restart after unrecognized card
                setTimeout(startNfc, 1500);
            }
        };

        ndef.onreadingerror = () => {
            showCheckinResult('שגיאה בקריאת הכרטיס. נסה שוב.', false);
        };
    }).catch(err => {
        showToast('שגיאת NFC: ' + (err.message || 'נסה שוב'));
        nfcAbortController = null;
        _setNfcUi(false);
    });
}

function stopNfc() {
    if (nfcAbortController) {
        nfcAbortController.abort();
        nfcAbortController = null;
    }
    _setNfcUi(false);
    const statusEl = document.getElementById('nfc-status');
    if (statusEl) statusEl.textContent = '';
}

function assignNfc(memberId) {
    if (!('NDEFReader' in window)) {
        showToast('NFC לא נתמך בדפדפן זה (נדרש Chrome באנדרואיד)');
        return;
    }

    const member = getMembers().find(m => m.id === memberId);
    if (!member) return;

    closeModal();
    showToast('קרב כרטיס NFC ריק וניתן לכתיבה למכשיר...');

    const ndef = new NDEFReader();
    const url = getUserUrl(memberId);

    ndef.write({ records: [{ recordType: 'url', data: url }] }).then(() => {
        _updateMember(memberId, { nfcTag: url });
        showToast('כרטיס NFC נכתב ושויך בהצלחה ✓');
    }).catch(err => {
        showToast('שגיאה בכתיבה לכרטיס: ' + (err.message || 'ודא שהכרטיס ניתן לכתיבה'));
    });
}

function removeNfc(memberId) {
    if (!confirm('לבטל את שיוך כרטיס ה-NFC למשתתף זה?')) return;
    _updateMember(memberId, { nfcTag: null });
    closeModal();
    showToast('שיוך הכרטיס בוטל');
}

// ===== VIP =====
function showVipSettings(id) {
    const member = getMembers().find(m => m.id === id);
    if (!member) return;
    const current = member.vipSlots || 0;
    openModal('כניסה חופשית - ' + member.name, `
        <p style="color:var(--text-light);margin-bottom:16px">הגדר כמה מקומות חופשיים לחבר זה</p>
        <div style="display:flex;flex-direction:column;gap:10px">
            <button class="btn ${current===0?'btn-primary':'btn-secondary'} btn-block" onclick="setMemberVip('${id}',0)">ביטול כניסה חופשית</button>
            <button class="btn ${current===1?'btn-primary':'btn-secondary'} btn-block" onclick="setMemberVip('${id}',1)">⭐ כניסה חופשית — 1 אדם</button>
            <button class="btn ${current===2?'btn-primary':'btn-secondary'} btn-block" onclick="setMemberVip('${id}',2)">⭐⭐ כניסה חופשית — 2 אנשים</button>
        </div>
    `);
}

function setMemberVip(id, slots) {
    _updateMember(id, { vipSlots: slots });
    closeModal();
    showToast(slots > 0 ? `כניסה חופשית הוגדרה ל-${slots} ${slots>1?'אנשים':'אדם'} ✓` : 'כניסה חופשית בוטלה');
}

function doVipCheckin(member) {
    const today = new Date().toISOString().split('T')[0];
    const existing = getGuestCheckins().find(gc => gc.refId === member.id && gc.date === today);
    openModal('כניסה חופשית — ' + member.name, `
        <div style="text-align:center;margin-bottom:16px">
            ${avatarHtml(member, 80)}
            <p style="margin-top:8px;font-size:1.1rem;font-weight:700">${escHtml(member.name)}</p>
            <p style="color:var(--success);font-weight:600">⭐ כניסה חופשית (עד ${member.vipSlots} ${member.vipSlots>1?'אנשים':'אדם'})</p>
            ${existing ? `<p style="color:var(--warning);font-size:0.9rem">כבר בוצעה כניסה היום (${existing.count} ${existing.count>1?'אנשים':'אדם'})</p>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
            <button class="btn btn-success btn-block" onclick="performVipCheckin('${member.id}',1)">✓ כניסה בודדת (1)</button>
            ${member.vipSlots >= 2 ? `<button class="btn btn-primary btn-block" onclick="performVipCheckin('${member.id}',2)">✓ כניסה זוגית (2)</button>` : ''}
        </div>
    `);
}

function performVipCheckin(memberId, count) {
    const member = getMembers().find(m => m.id === memberId);
    if (!member) return;
    const today = new Date().toISOString().split('T')[0];
    const existing = getGuestCheckins().find(gc => gc.refId === memberId && gc.date === today);
    _saveGuestCheckin({
        id: existing?.id || generateId(),
        refId: memberId,
        name: member.name,
        type: 'vip',
        date: today,
        count,
        terminal: DB.getSetting('terminalName', 'ראשי'),
        timestamp: new Date().toISOString()
    });
    _saveCheckin({
        id: generateId(),
        memberId,
        entryType: count === 2 ? 'vip-couple' : 'vip-single',
        terminal: DB.getSetting('terminalName', 'ראשי'),
        timestamp: new Date().toISOString()
    });
    closeModal();
    showCheckinResult(`✓ ${member.name} — כניסה חופשית (${count} ${count>1?'אנשים':'אדם'})`, true);
    if ('NDEFReader' in window) setTimeout(startNfc, 1500);
}

// ===== GUEST LIST =====
function renderGuestList() {
    const today = new Date().toISOString().split('T')[0];
    const todayCheckins = getGuestCheckins().filter(gc => gc.date === today);
    const now = new Date();

    const vipMembers = getMembers().filter(m => (m.vipSlots || 0) > 0).sort((a, b) => a.name.localeCompare(b.name, 'he'));
    const activeGuests = getGuests().filter(g => new Date(g.expiresAt) > now);

    const vipHtml = vipMembers.length === 0
        ? '<p style="color:#b2bec3;text-align:center;padding:12px">אין חברים עם כניסה חופשית קבועה</p>'
        : vipMembers.map(m => {
            const checkin = todayCheckins.find(gc => gc.refId === m.id);
            return `<div class="recent-item" style="align-items:center;gap:8px">
                <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;cursor:pointer" onclick="showMemberDetails('${m.id}')">
                    ${avatarHtml(m, 36)}
                    <div>
                        <div style="font-weight:600">${escHtml(m.name)}</div>
                        <div style="font-size:0.78rem;color:var(--text-light)">⭐ עד ${m.vipSlots} ${m.vipSlots>1?'אנשים':'אדם'}</div>
                    </div>
                </div>
                <div style="display:flex;gap:5px;align-items:center;flex-shrink:0">
                    ${checkin ? `<span class="badge badge-success">הגיע (${checkin.count})</span>` : ''}
                    <button class="btn btn-success" style="padding:5px 9px;font-size:0.82rem" onclick="markVipArrival('${m.id}',1)">✓1</button>
                    ${m.vipSlots >= 2 ? `<button class="btn btn-primary" style="padding:5px 9px;font-size:0.82rem" onclick="markVipArrival('${m.id}',2)">✓2</button>` : ''}
                </div>
            </div>`;
        }).join('');

    const tempHtml = activeGuests.length === 0
        ? '<p style="color:#b2bec3;text-align:center;padding:12px">אין אורחים זמניים פעילים</p>'
        : activeGuests.map(g => {
            const checkin = todayCheckins.find(gc => gc.refId === g.id);
            const hoursLeft = Math.round((new Date(g.expiresAt) - now) / 3600000);
            return `<div class="recent-item" style="align-items:center;gap:8px">
                <div style="flex:1;min-width:0">
                    <div style="font-weight:600">${escHtml(g.name)}</div>
                    <div style="font-size:0.78rem;color:var(--text-light)">פג תוקף בעוד ${hoursLeft}ש׳ · עד ${g.slots} ${g.slots>1?'אנשים':'אדם'}</div>
                </div>
                <div style="display:flex;gap:5px;align-items:center;flex-shrink:0">
                    ${checkin ? `<span class="badge badge-success">הגיע (${checkin.count})</span>` : ''}
                    <button class="btn btn-success" style="padding:5px 9px;font-size:0.82rem" onclick="markTempArrival('${g.id}',1)">✓1</button>
                    ${g.slots >= 2 ? `<button class="btn btn-primary" style="padding:5px 9px;font-size:0.82rem" onclick="markTempArrival('${g.id}',2)">✓2</button>` : ''}
                    <button class="btn btn-danger" style="padding:5px 9px;font-size:0.82rem" onclick="deleteTempGuest('${g.id}')">✕</button>
                </div>
            </div>`;
        }).join('');

    document.getElementById('guestlist-vip').innerHTML = vipHtml;
    document.getElementById('guestlist-temp').innerHTML = tempHtml;
}

function markVipArrival(memberId, count) {
    const member = getMembers().find(m => m.id === memberId);
    if (!member) return;
    const today = new Date().toISOString().split('T')[0];
    const existing = getGuestCheckins().find(gc => gc.refId === memberId && gc.date === today);
    if (existing && existing.count === count) {
        _deleteGuestCheckin(existing.id);
        showToast(`${member.name} — סימון בוטל`);
        return;
    }
    _saveGuestCheckin({
        id: existing?.id || generateId(),
        refId: memberId,
        name: member.name,
        type: 'vip',
        date: today,
        count,
        terminal: DB.getSetting('terminalName', 'ראשי'),
        timestamp: new Date().toISOString()
    });
    showToast(`${member.name} סומן כהגיע (${count}) ✓`);
}

function markTempArrival(guestId, count) {
    const guest = getGuests().find(g => g.id === guestId);
    if (!guest) return;
    const today = new Date().toISOString().split('T')[0];
    const existing = getGuestCheckins().find(gc => gc.refId === guestId && gc.date === today);
    if (existing && existing.count === count) {
        _deleteGuestCheckin(existing.id);
        showToast(`${guest.name} — סימון בוטל`);
        return;
    }
    _saveGuestCheckin({
        id: existing?.id || generateId(),
        refId: guestId,
        name: guest.name,
        type: 'temp',
        date: today,
        count,
        terminal: DB.getSetting('terminalName', 'ראשי'),
        timestamp: new Date().toISOString()
    });
    showToast(`${guest.name} סומן כהגיע (${count}) ✓`);
}

function showAddTempGuest() {
    openModal('הוספת אורח זמני (48 שעות)', `
        <div class="form-group">
            <label>שם האורח</label>
            <input type="text" id="temp-guest-name" placeholder="שם מלא">
        </div>
        <div class="form-group">
            <label>כמות מקומות</label>
            <div style="display:flex;gap:16px;margin-top:6px">
                <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer">
                    <input type="radio" name="temp-slots" value="1" checked> 1 אדם
                </label>
                <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer">
                    <input type="radio" name="temp-slots" value="2"> 2 אנשים
                </label>
            </div>
        </div>
        <button class="btn btn-primary btn-block" onclick="addTempGuest()">הוסף לרשימה</button>
    `);
    setTimeout(() => document.getElementById('temp-guest-name')?.focus(), 200);
}

function addTempGuest() {
    const name = document.getElementById('temp-guest-name').value.trim();
    const slots = parseInt(document.querySelector('input[name="temp-slots"]:checked')?.value || '1');
    if (!name) { showToast('נא להזין שם'); return; }
    const now = new Date();
    _saveGuest({
        id: generateId(),
        name,
        slots,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 48 * 3600000).toISOString()
    });
    closeModal();
    showToast(`${name} נוסף לרשימה ל-48 שעות ✓`);
}

function deleteTempGuest(id) {
    if (!confirm('להסיר אורח זה מהרשימה?')) return;
    _deleteGuest(id);
    showToast('הוסר מהרשימה');
}

// ===== REPORTS =====
function _getReportRange() {
    if (event?.target?.dataset?.period) {
        document.querySelectorAll('.period-selector .filter-btn').forEach(b => b.classList.remove('active'));
        event.target.classList.add('active');
    }
    const period = document.querySelector('.period-selector .filter-btn.active')?.dataset.period || 'week';
    const now = new Date();
    let startDate;
    if (period === 'day')        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    else if (period === 'week')  { startDate = new Date(now); startDate.setDate(startDate.getDate() - 7); }
    else if (period === 'month') startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    else                         startDate = new Date(now.getFullYear(), 0, 1);
    return startDate;
}

function renderReports() {
    showReport();
}

function showReport() {
    const startDate = _getReportRange();

    const allTerminals = [...new Set(getCheckins().map(c => c.terminal).filter(Boolean))];
    const sel = document.getElementById('report-terminal');
    if (sel) {
        const current = sel.value;
        sel.innerHTML = '<option value="">כל המסופים</option>' +
            allTerminals.map(t => `<option value="${escHtml(t)}" ${t === current ? 'selected' : ''}>${escHtml(t)}</option>`).join('');
    }
    const terminalFilter = sel?.value || '';

    const members  = getMembers();
    const payments = getPayments().filter(p => new Date(p.date) >= startDate);
    let checkins   = getCheckins().filter(c => new Date(c.timestamp) >= startDate);
    if (terminalFilter) checkins = checkins.filter(c => c.terminal === terminalFilter);

    const revenue       = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const cashRevenue   = payments.filter(p => p.paymentMethod !== 'credit').reduce((s, p) => s + (p.amount || 0), 0);
    const creditRevenue = payments.filter(p => p.paymentMethod === 'credit').reduce((s, p) => s + (p.amount || 0), 0);
    const entriesUsed   = checkins.filter(c => c.entryType !== 'vip-single' && c.entryType !== 'vip-couple').reduce((s, c) => s + (c.entryType === 'couple' ? 2 : 1), 0);
    const zeroBalance   = members.filter(m => (m.balance || 0) <= 0 && !(m.vipSlots > 0)).length;

    const periodGuests = getGuestCheckins().filter(gc => new Date(gc.timestamp || gc.date) >= startDate);
    const todayGuestsCount = periodGuests.reduce((s, gc) => s + (gc.count || 1), 0);

    document.getElementById('stat-members').textContent      = members.length;
    document.getElementById('stat-revenue').textContent      = '₪' + revenue;
    const detail = document.getElementById('stat-revenue-detail');
    if (detail) detail.textContent = revenue > 0 ? `\u{1F4B5} ₪${cashRevenue} | \u{1F4B3} ₪${creditRevenue}` : '';
    document.getElementById('stat-active-subs').textContent  = zeroBalance;
    document.getElementById('stat-tickets-sold').textContent = payments.length;
    document.getElementById('stat-entries-used').textContent = entriesUsed;
    document.getElementById('stat-guests-today').textContent = todayGuestsCount;

    // Unified activity list
    const allActivity = [];
    getCheckins()
        .filter(c => new Date(c.timestamp) >= startDate)
        .forEach(c => {
            const member = members.find(m => m.id === c.memberId);
            const name = member ? member.name : 'לא ידוע';
            let type;
            if (c.entryType === 'vip-single') type = '⭐ כניסה חופשית (1)';
            else if (c.entryType === 'vip-couple') type = '⭐ כניסה חופשית (2)';
            else if (c.entryType === 'couple') type = '🚪 כניסה זוגית';
            else type = '🚪 כניסה בודדת';
            allActivity.push({ ts: c.timestamp, name, label: type, color: 'var(--primary)' });
        });
    getGuestCheckins()
        .filter(gc => new Date(gc.timestamp || gc.date) >= startDate)
        .forEach(gc => {
            allActivity.push({ ts: gc.timestamp || gc.date, name: gc.name, label: `👤 אורח (${gc.count})`, color: 'var(--warning)' });
        });
    getPayments()
        .filter(p => new Date(p.date) >= startDate)
        .forEach(p => {
            const member = members.find(m => m.id === p.memberId);
            const name = member ? member.name : 'לא ידוע';
            const method = p.paymentMethod === 'credit' ? '💳' : '💵';
            allActivity.push({ ts: p.date, name, label: `${method} רכישה ${p.quantity} כניסות · ₪${p.amount}`, color: 'var(--success)' });
        });
    allActivity.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const el = document.getElementById('recent-checkins');
    if (el) el.innerHTML = allActivity.length
        ? allActivity.map(a => `<div class="recent-item">
            <span style="font-weight:600">${escHtml(a.name)}</span>
            <div style="text-align:left;font-size:0.82rem">
                <div style="color:${a.color};font-weight:600">${a.label}</div>
                <div style="color:var(--text-light)">${formatDateTime(new Date(a.ts))}</div>
            </div>
        </div>`).join('')
        : '<p style="color:#b2bec3;text-align:center;padding:20px">אין פעילות בתקופה זו</p>';
}

function exportExcel(share = false) {
    if (typeof XLSX === 'undefined') { showToast('טוען ספריית Excel...'); return; }
    const startDate = _getReportRange();
    const terminalFilter = document.getElementById('report-terminal')?.value || '';
    const members = getMembers();

    let checkins = getCheckins().filter(c => new Date(c.timestamp) >= startDate);
    if (terminalFilter) checkins = checkins.filter(c => c.terminal === terminalFilter);
    const payments = getPayments().filter(p => new Date(p.date) >= startDate);

    const wb = XLSX.utils.book_new();
    const rtl = ws => { ws['!views'] = [{ rightToLeft: true }]; return ws; };

    // Checkins sheet: regular/VIP rows, then guests section, then summary
    const guestCheckins = getGuestCheckins().filter(gc => {
        const ts = gc.timestamp ? new Date(gc.timestamp) : new Date(gc.date + 'T23:59:59');
        return ts >= startDate;
    });

    const sep = { 'תאריך ושעה': '', 'שם משתתף': '', 'סוג כניסה': '', 'מסוף': '', 'כמות': '' };

    const regularRows = checkins
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .map(c => ({
            'תאריך ושעה': formatDateTime(new Date(c.timestamp)),
            'שם משתתף':  members.find(m => m.id === c.memberId)?.name || 'לא ידוע',
            'סוג כניסה': c.entryType === 'vip-couple' ? 'חופשית (2)' : c.entryType === 'vip-single' ? 'חופשית (1)' : c.entryType === 'couple' ? 'זוגית' : 'בודדת',
            'מסוף':      c.terminal || 'ראשי',
            'כמות':      c.entryType === 'couple' || c.entryType === 'vip-couple' ? 2 : 1
        }));

    const guestRows = guestCheckins
        .sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date))
        .map(gc => ({
            'תאריך ושעה': formatDateTime(new Date(gc.timestamp || gc.date)),
            'שם משתתף':  gc.name,
            'סוג כניסה': `אורח (${gc.count})`,
            'מסוף':      gc.terminal || 'ראשי',
            'כמות':      gc.count || 1
        }));

    // Summary per terminal (regular + guests combined)
    const allRows = [...regularRows, ...guestRows];
    const terminals = [...new Set(allRows.map(r => r['מסוף']))];
    const totalGuests = guestRows.reduce((s, r) => s + (r['כמות'] || 0), 0);
    const totalRegular = regularRows.reduce((s, r) => s + (r['כמות'] || 0), 0);
    const summaryRows = [
        { 'תאריך ושעה': '--- סיכום ---', 'שם משתתף': '', 'סוג כניסה': '', 'מסוף': '', 'כמות': '' },
        ...terminals.map(t => {
            const tRows = allRows.filter(r => r['מסוף'] === t);
            return { 'תאריך ושעה': `סה"כ — ${t}`, 'שם משתתף': '', 'סוג כניסה': '', 'מסוף': t, 'כמות': tRows.reduce((s, r) => s + (r['כמות'] || 0), 0) };
        }),
        sep,
        { 'תאריך ושעה': 'סה"כ כניסות', 'שם משתתף': '', 'סוג כניסה': '', 'מסוף': '', 'כמות': totalRegular },
        { 'תאריך ושעה': 'סה"כ אורחים', 'שם משתתף': '', 'סוג כניסה': '', 'מסוף': '', 'כמות': totalGuests },
        { 'תאריך ושעה': 'סה"כ כולל', 'שם משתתף': '', 'סוג כניסה': '', 'מסוף': '', 'כמות': totalRegular + totalGuests }
    ];

    const guestHeader = guestRows.length > 0
        ? [sep, { 'תאריך ושעה': '--- אורחים ---', 'שם משתתף': '', 'סוג כניסה': '', 'מסוף': '', 'כמות': '' }, ...guestRows]
        : [];

    XLSX.utils.book_append_sheet(wb, rtl(XLSX.utils.json_to_sheet([...regularRows, ...guestHeader, sep, ...summaryRows])), 'כניסות');

    const paymentRows = payments.map(p => ({
        'תאריך ושעה':   formatDateTime(new Date(p.date)),
        'שם משתתף':    members.find(m => m.id === p.memberId)?.name || 'לא ידוע',
        'כמות כניסות': p.quantity,
        'סכום':        p.amount,
        'אמצעי תשלום': p.paymentMethod === 'credit' ? 'אשראי' : 'מזומן',
        'מסוף':        p.terminal || 'ראשי',
        'הערה':        p.note || ''
    }));
    const totalAmount = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const totalQty = payments.reduce((s, p) => s + (p.quantity || 0), 0);
    const sepPayment = { 'תאריך ושעה': '', 'שם משתתף': '', 'כמות כניסות': '', 'סכום': '', 'אמצעי תשלום': '', 'מסוף': '', 'הערה': '' };
    paymentRows.push(sepPayment);
    paymentRows.push({ 'תאריך ושעה': 'סה"כ', 'שם משתתף': '', 'כמות כניסות': totalQty, 'סכום': totalAmount, 'אמצעי תשלום': '', 'מסוף': '', 'הערה': '' });
    XLSX.utils.book_append_sheet(wb, rtl(XLSX.utils.json_to_sheet(paymentRows)), 'רכישות');

    const vipCount = members.filter(m => m.vipSlots > 0).length;
    const regularCount = members.length - vipCount;
    const memberRows = [
        ...members.map(m => ({
            'שם':              m.name,
            'טלפון':           m.phone,
            'אימייל':          m.email || '',
            'יתרת כניסות':    m.balance || 0,
            'סוג':             m.vipSlots > 0 ? `VIP (${m.vipSlots})` : 'רגיל',
            'תאריך הצטרפות': formatDate(new Date(m.createdAt))
        })),
        { 'שם': '', 'טלפון': '', 'אימייל': '', 'יתרת כניסות': '', 'סוג': '', 'תאריך הצטרפות': '' },
        { 'שם': `סה"כ: ${members.length} משתתפים`, 'טלפון': `VIP: ${vipCount}`, 'אימייל': `רגילים: ${regularCount}`, 'יתרת כניסות': '', 'סוג': '', 'תאריך הצטרפות': '' }
    ];
    XLSX.utils.book_append_sheet(wb, rtl(XLSX.utils.json_to_sheet(memberRows)), 'משתתפים');

    if (share && navigator.share) {
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const file = new File([buf], `club-report-v51-${formatDateFile(new Date())}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        navigator.share({ files: [file], title: 'דוח מועדון' })
            .catch(() => {
                XLSX.writeFile(wb, `club-report-v51-${formatDateFile(new Date())}.xlsx`);
                showToast('קובץ Excel הורד ✓');
            });
        return;
    }
    XLSX.writeFile(wb, `club-report-v51-${formatDateFile(new Date())}.xlsx`);
    showToast('קובץ Excel הורד ✓');
}

function shareReport() {
    const period = document.querySelector('.period-selector .filter-btn.active')?.textContent || 'שבוע';
    const members  = document.getElementById('stat-members')?.textContent || '0';
    const revenue  = document.getElementById('stat-revenue')?.textContent || '₪0';
    const entries  = document.getElementById('stat-entries-used')?.textContent || '0';
    const tickets  = document.getElementById('stat-tickets-sold')?.textContent || '0';
    const guests   = document.getElementById('stat-guests-today')?.textContent || '0';
    const zero     = document.getElementById('stat-active-subs')?.textContent || '0';
    const eventName = DB.getSetting('eventName', 'מועדון');

    const text = `📊 דוח ${eventName} — ${period}
👥 משתתפים: ${members}
💰 הכנסות: ${revenue}
🎫 כרטיסיות שנמכרו: ${tickets}
🚪 ניקובים: ${entries}
👤 אורחים: ${guests}
⚠️ ללא יתרה: ${zero}`;

    if (navigator.share) {
        navigator.share({ title: `דוח ${eventName}`, text })
            .catch(err => {
                if (err.name !== 'AbortError') {
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(text).then(() => showToast('הדוח הועתק ✓'));
                    } else {
                        showToast('שיתוף נכשל');
                    }
                }
            });
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => showToast('הדוח הועתק ✓'));
    } else {
        showToast('שיתוף אינו נתמך במכשיר זה');
    }
}

// ===== SETTINGS =====
function loadSettings() {
    document.getElementById('setting-event-name').value = DB.getSetting('eventName', '');
    document.getElementById('setting-terminal').value = DB.getSetting('terminalName', '');
    document.getElementById('setting-price').value = DB.getSetting('singlePrice', '');
    document.getElementById('setting-sub-price').value = DB.getSetting('couplePrice', '');

    const days = DB.getSetting('activeDays', '');
    if (days) {
        const dayArr = days.split(',');
        document.querySelectorAll('.days-selector input').forEach(cb => {
            cb.checked = dayArr.includes(cb.value);
        });
    }
}

function saveAllSettings() {
    DB.setSetting('eventName',    document.getElementById('setting-event-name').value.trim());
    DB.setSetting('terminalName', document.getElementById('setting-terminal').value.trim());
    DB.setSetting('singlePrice',  document.getElementById('setting-price').value);
    DB.setSetting('couplePrice',  document.getElementById('setting-sub-price').value);
    const eventName = DB.getSetting('eventName');
    if (eventName) document.querySelector('.top-bar h1').textContent = '🎫 ' + eventName;
    showToast('הגדרות נשמרו ✓');
}

function saveSetting(key, value) {
    DB.setSetting(key, value);
    if (key === 'eventName' && value) {
        document.querySelector('.top-bar h1').textContent = '🎫 ' + value;
    }
    showToast('נשמר ✓');
}

function saveDays() {
    const days = Array.from(document.querySelectorAll('.days-selector input:checked'))
        .map(cb => cb.value).join(',');
    DB.setSetting('activeDays', days);
    showToast('נשמר ✓');
}

function exportData() {
    const data = {
        members: getMembers(),
        payments: getPayments(),
        checkins: getCheckins(),
        settings: {
            eventName: DB.getSetting('eventName'),
            singlePrice: DB.getSetting('singlePrice'),
            couplePrice: DB.getSetting('couplePrice'),
            activeDays: DB.getSetting('activeDays')
        },
        exportDate: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `club-backup-${formatDateFile(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('נתונים יוצאו בהצלחה');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            if (_db) {
                const batch = _db.batch();
                (data.members  || []).forEach(m => batch.set(_db.collection('members').doc(m.id),  m));
                (data.payments || []).forEach(p => batch.set(_db.collection('payments').doc(p.id), p));
                (data.checkins || []).forEach(c => batch.set(_db.collection('checkins').doc(c.id), c));
                batch.commit().then(() => showToast('נתונים יובאו בהצלחה!')).catch(() => showToast('שגיאה בייבוא'));
            }
            if (data.settings) {
                Object.entries(data.settings).forEach(([k, v]) => {
                    if (v) DB.setSetting(k, v);
                });
            }
            loadSettings();
        } catch {
            showToast('שגיאה בקריאת הקובץ');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ===== QR CODE GENERATOR =====
function generateQRCode(containerId, data) {
    const container = document.getElementById(containerId);
    if (!container || typeof QRCode === 'undefined') return;
    container.innerHTML = '';
    new QRCode(container, {
        text: data,
        width: 200,
        height: 200,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
    });
}

// ===== UTILITIES =====
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(date) {
    return date.toLocaleDateString('he-IL');
}

function formatDateTime(date) {
    const day = date.toLocaleDateString('he-IL', { weekday: 'long' });
    const d = date.toLocaleDateString('he-IL');
    const t = date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    return `${day} ${d} ${t}`;
}

function formatDateFile(date) {
    return date.toISOString().split('T')[0];
}

function openModal(title, body) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-overlay').classList.add('visible');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('visible');
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2500);
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('members-list')) return;

    const eventName = DB.getSetting('eventName');
    if (eventName) {
        document.querySelector('.top-bar h1').textContent = '🎫 ' + eventName;
    }

    // Set sticky top offset based on actual top-bar height
    const topBarH = document.querySelector('.top-bar')?.offsetHeight || 56;
    document.documentElement.style.setProperty('--topbar-h', topBarH + 'px');

    document.getElementById('members-list').innerHTML =
        '<div style="text-align:center;padding:40px;color:#b2bec3;">מתחבר לענן...</div>';

    _initFirebase();
});

// PWA Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then(reg => reg.update())
        .catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
}
