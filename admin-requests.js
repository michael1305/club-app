// Back office: deletion requests from members whose card still holds a balance.
// A member with money left cannot delete their own card; they send a request (see user.html)
// and the team approves it here after settling the balance.
let _delRequests = [];
let _delRequestsToasted = false;

function _startDeletionRequests() {
    _db.collection('deletionRequests').onSnapshot(snap => {
        _delRequests = snap.docs.map(d => d.data());
        _renderDeletionRequests();
        if (_delRequests.length && !_delRequestsToasted) {
            _delRequestsToasted = true;
            showToast('יש ' + _delRequests.length + ' בקשות מחיקה ממתינות (בהגדרות)');
        }
    }, () => {});
}

function _renderDeletionRequests() {
    const sect = document.getElementById('deletion-requests-section');
    const box = document.getElementById('deletion-requests-list');
    if (!sect || !box) return;
    sect.style.display = _delRequests.length ? '' : 'none';
    box.innerHTML = _delRequests.map(r => {
        const m = getMembers().find(x => x.id === r.memberId);
        const when = r.createdAt ? new Date(r.createdAt).toLocaleDateString('he-IL') : '';
        const who = m ? escHtml(m.name) + (m.phone ? ' · ' + escHtml(m.phone) : '') : '(החבר כבר לא קיים)';
        const bal = m ? ' · יתרה: ' + num(m.balance) + ' כניסות' : '';
        return '<div style="border:1px solid #fab1a0;background:#fff5f3;border-radius:10px;padding:10px;margin-bottom:8px">' +
            '<div style="font-weight:700">' + who + '</div>' +
            '<div style="font-size:0.8rem;color:var(--text-light);margin:2px 0 8px">בקשה מ-' + escHtml(when) + bal + '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
            '<button class="btn btn-danger" onclick="approveDeletion(\'' + escJsAttr(r.memberId) + '\')">🗑 אשר ומחק</button>' +
            '<button class="btn btn-secondary" onclick="dismissDeletion(\'' + escJsAttr(r.memberId) + '\')">✖ דחה</button>' +
            '</div></div>';
    }).join('');
}

function dismissDeletion(memberId) {
    _db.collection('deletionRequests').doc(memberId).delete();
}

function approveDeletion(memberId) {
    const m = getMembers().find(x => x.id === memberId);
    if (m) {
        const bal = num(m.balance);
        const msg = 'למחוק לצמיתות את ' + m.name + '?' +
            (bal > 0 ? '\n\n⚠️ נשארו לו ' + bal + ' כניסות. ודא שהסדרת איתו את היתרה (ניצול או החזר) לפני המחיקה.' : '');
        if (!confirm(msg)) return;
        _deleteMemberDoc(memberId);   // also clears the phone index and the member's history copy
    }
    _db.collection('deletionRequests').doc(memberId).delete();
    showToast('הבקשה טופלה ✓');
}
