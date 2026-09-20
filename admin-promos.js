// Back office: manage the promotions shown on the public home page (index.html).
let _promos = [];
let _promoEditId = null;

function _startPromotions() {
    _db.collection('promotions').onSnapshot(snap => {
        _promos = snap.docs.map(d => d.data());
        _renderPromos();
    }, () => {});
}

function _renderPromos() {
    const box = document.getElementById('promos-admin-list');
    if (!box) return;
    if (!_promos.length) {
        box.innerHTML = '<p style="color:var(--text-light);font-size:0.85rem">אין מבצעים עדיין.</p>';
        return;
    }
    const now = Date.now();
    box.innerHTML = _promos.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map(p => {
        const expired = p.expiresAt && new Date(p.expiresAt).getTime() < now;
        const state = p.active === false ? '⏸ מוסתר' : expired ? '⌛ פג תוקף' : '✅ מוצג';
        const until = p.expiresAt ? ' · עד ' + new Date(p.expiresAt).toLocaleDateString('he-IL') : '';
        return '<div style="border:1px solid #dfe6e9;border-radius:10px;padding:10px;margin-bottom:8px">' +
            '<div style="font-weight:700">' + escHtml(p.title) + '</div>' +
            '<div style="font-size:0.8rem;color:var(--text-light);margin:2px 0 8px">' + state + until + '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
            '<button class="btn btn-secondary" onclick="editPromo(\'' + escJsAttr(p.id) + '\')">✏️ עריכה</button>' +
            '<button class="btn btn-secondary" onclick="togglePromo(\'' + escJsAttr(p.id) + '\')">' + (p.active === false ? '👁 הצג' : '🙈 הסתר') + '</button>' +
            '<button class="btn btn-danger" onclick="deletePromo(\'' + escJsAttr(p.id) + '\')">🗑 מחק</button>' +
            '</div></div>';
    }).join('');
}

function _promoFormReset() {
    _promoEditId = null;
    document.getElementById('promo-title').value = '';
    document.getElementById('promo-body').value = '';
    document.getElementById('promo-expires').value = '';
    document.getElementById('promo-save-btn').textContent = '➕ הוסף מבצע';
    document.getElementById('promo-cancel-btn').style.display = 'none';
}

function editPromo(id) {
    const p = _promos.find(x => x.id === id);
    if (!p) return;
    _promoEditId = id;
    document.getElementById('promo-title').value = p.title || '';
    document.getElementById('promo-body').value = p.body || '';
    document.getElementById('promo-expires').value = p.expiresAt ? String(p.expiresAt).slice(0, 10) : '';
    document.getElementById('promo-save-btn').textContent = '💾 שמור שינויים';
    document.getElementById('promo-cancel-btn').style.display = '';
    document.getElementById('promo-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelPromoEdit() { _promoFormReset(); }

async function savePromo() {
    const title = document.getElementById('promo-title').value.trim();
    const body = document.getElementById('promo-body').value.trim();
    const exp = document.getElementById('promo-expires').value;
    if (!title) { showToast('יש להזין כותרת'); return; }
    const old = _promoEditId ? _promos.find(x => x.id === _promoEditId) : null;
    const id = old ? old.id : generateId();
    const data = {
        id,
        title,
        body,
        order: old ? (old.order || 0) : -Math.floor(Date.now() / 1000), // newest first
        active: old ? old.active !== false : true,
        expiresAt: exp ? new Date(exp + 'T23:59:59').toISOString() : null,
        createdAt: old ? old.createdAt : new Date().toISOString()
    };
    try {
        await _db.collection('promotions').doc(id).set(data);
        showToast(old ? 'המבצע עודכן ✓' : 'המבצע נוסף ✓');
        _promoFormReset();
    } catch (e) {
        showToast('שגיאה בשמירת המבצע');
    }
}

function togglePromo(id) {
    const p = _promos.find(x => x.id === id);
    if (p) _db.collection('promotions').doc(id).update({ active: p.active === false });
}

function deletePromo(id) {
    const p = _promos.find(x => x.id === id);
    if (!p || !confirm('למחוק את המבצע "' + p.title + '"?')) return;
    _db.collection('promotions').doc(id).delete();
}
