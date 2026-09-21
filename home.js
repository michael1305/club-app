// Front office (member-facing home): welcome -> menu -> promotions / my card.
(function () {
    const cfg = {
        apiKey: "AIzaSyCOBQNSRju9Fgxy3_DZAWapzuyv0DoUUCo",
        projectId: "club-app-8f954",
        appId: "1:181296970595:web:6cd7578d10d563f3c73156"
    };
    const STORE_KEY = 'club_member_id';
    const $ = id => document.getElementById(id);

    function getStored() { try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; } }
    function setStored(v) { try { localStorage.setItem(STORE_KEY, v); } catch (e) { /* private mode */ } }
    function clearStored() { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ } }

    // ---------- navigation ----------
    function show(name) {
        document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
        window.scrollTo(0, 0);
    }
    document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => show(b.dataset.go)));
    $('btn-enter').addEventListener('click', () => show('menu'));
    $('btn-dances').addEventListener('click', () => show('dances'));
    $('btn-contact').addEventListener('click', () => $('contact').classList.add('open'));
    $('btn-close-contact').addEventListener('click', () => $('contact').classList.remove('open'));
    $('contact').addEventListener('click', e => { if (e.target === $('contact')) $('contact').classList.remove('open'); });
    $('btn-promos').addEventListener('click', () => { show('promos'); loadPromos(); });
    $('btn-card').addEventListener('click', openCard);

    function goCard(id) { location.href = 'user.html?id=' + encodeURIComponent(id); }

    function openCard() {
        const id = getStored();
        if (id) goCard(id);
        else openIdentify();
    }

    // ---------- Firebase (anonymous, read-only usage) ----------
    let dbPromise = null;
    function getDb() {
        if (!dbPromise) {
            dbPromise = (async () => {
                if (!firebase.apps.length) firebase.initializeApp(cfg);
                await firebase.auth().signInAnonymously();
                return firebase.firestore();
            })();
            dbPromise.catch(() => { dbPromise = null; });
        }
        return dbPromise;
    }

    // ---------- promotions ----------
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    async function loadPromos() {
        const box = $('promos-list');
        box.innerHTML = '<div class="empty">טוען...</div>';
        try {
            const db = await getDb();
            const snap = await db.collection('promotions').get();
            const now = Date.now();
            const items = snap.docs.map(d => d.data())
                .filter(p => p.active !== false && (!p.expiresAt || new Date(p.expiresAt).getTime() >= now))
                .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
            if (!items.length) { box.innerHTML = '<div class="empty">אין מבצעים כרגע.<br>בקרו שוב בקרוב 🙂</div>'; return; }
            box.innerHTML = items.map(p =>
                '<div class="promo"><h3>' + esc(p.title) + '</h3>' +
                (p.body ? '<p>' + esc(p.body) + '</p>' : '') +
                (p.expiresAt ? '<div class="until">בתוקף עד ' + esc(new Date(p.expiresAt).toLocaleDateString('he-IL')) + '</div>' : '') +
                '</div>').join('');
        } catch (e) {
            box.innerHTML = '<div class="empty">לא ניתן לטעון מבצעים כרגע.<br>נסו שוב מאוחר יותר.</div>';
        }
    }

    // ---------- identify (NFC card / personal QR) ----------
    let nfcAbort = null, camStream = null, scanning = false;

    function status(msg, isErr) {
        const el = $('identify-status');
        el.textContent = msg || '';
        el.classList.toggle('err', !!isErr);
    }
    function openIdentify() { status(''); $('identify').classList.add('open'); }
    function closeIdentify() { stopNfc(); stopCamera(); $('identify').classList.remove('open'); }
    $('btn-close-identify').addEventListener('click', closeIdentify);

    // The personal QR and the NFC card both hold the member's card link (…user.html?id=<id>).
    function idFromText(text) {
        const m = /[?&]id=([A-Za-z0-9]{6,80})(?:[&#]|$)/.exec(String(text || ''));
        return m ? m[1] : null;
    }

    // Only trust an id once the member document really exists.
    async function acceptId(id) {
        try {
            const db = await getDb();
            const doc = await db.collection('members').doc(id).get();
            if (!doc.exists) { status('הכרטיס לא זוהה. ודאו שזה הכרטיס האישי שלכם.', true); return false; }
        } catch (e) {
            status('שגיאת חיבור — נסו שוב.', true);
            return false;
        }
        setStored(id);
        closeIdentify();
        goCard(id);
        return true;
    }

    function stopNfc() { if (nfcAbort) { nfcAbort.abort(); nfcAbort = null; } }
    $('btn-nfc').addEventListener('click', async () => {
        if (!('NDEFReader' in window)) {
            status('NFC לא נתמך במכשיר זה. אפשר לסרוק QR אישי.', true);
            return;
        }
        stopCamera(); stopNfc();
        try {
            nfcAbort = new AbortController();
            const ndef = new NDEFReader();
            await ndef.scan({ signal: nfcAbort.signal });
            status('הצמידו את הכרטיס לגב הטלפון...');
            ndef.onreading = ev => {
                let id = null;
                for (const r of ev.message.records) {
                    if (r.recordType === 'url' || r.recordType === 'text') {
                        id = idFromText(new TextDecoder(r.encoding || 'utf-8').decode(r.data));
                        if (id) break;
                    }
                }
                if (id) acceptId(id);
                else status('הכרטיס לא משויך לכרטיסיה. פנו אלינו לשיוך.', true);
            };
            ndef.onreadingerror = () => status('שגיאה בקריאת הכרטיס — נסו שוב.', true);
        } catch (e) {
            status('לא ניתן להפעיל NFC. ודאו שהוא פעיל בהגדרות הטלפון ושנתתם הרשאה.', true);
        }
    });

    function stopCamera() {
        scanning = false;
        if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
        $('qr-wrap').style.display = 'none';
    }
    $('btn-scan').addEventListener('click', async () => {
        stopNfc();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            status('המצלמה לא זמינה במכשיר זה.', true);
            return;
        }
        try {
            camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        } catch (e) {
            status('אין הרשאה למצלמה. אשרו גישה ונסו שוב.', true);
            return;
        }
        const video = $('qr-video');
        video.srcObject = camStream;
        await video.play().catch(() => {});
        $('qr-wrap').style.display = 'block';
        status('כוונו את המצלמה ל-QR האישי שלכם');
        scanning = true;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const tick = async () => {
            if (!scanning) return;
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                canvas.width = video.videoWidth; canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = window.jsQR && jsQR(img.data, img.width, img.height);
                const id = code && idFromText(code.data);
                if (id) { scanning = false; if (await acceptId(id)) return; scanning = true; }
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });

    // A saved member id that no longer exists (deleted member) must not trap the user.
    // user.html shows "not found"; forget the id so the next tap re-identifies.
    if (getStored() && !/^[A-Za-z0-9]{6,80}$/.test(getStored())) clearStored();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
    }
})();
