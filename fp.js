// Fingerprint / screen-lock unlock for the member card (WebAuthn, platform authenticator).
// This is a LOCAL lock: it stops someone who picks up the phone from opening the card,
// it does not identify a member on a new device (the QR / NFC card does that).
window.ClubFp = (function () {
    const key = id => 'club_fp_' + id;
    const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const rand = n => crypto.getRandomValues(new Uint8Array(n));

    async function available() {
        try {
            return !!(window.PublicKeyCredential && navigator.credentials &&
                await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
        } catch (e) { return false; }
    }
    function enabled(id) { try { return !!localStorage.getItem(key(id)); } catch (e) { return false; } }
    function disable(id) { try { localStorage.removeItem(key(id)); } catch (e) { /* ignore */ } }

    async function enable(id) {
        const cred = await navigator.credentials.create({
            publicKey: {
                challenge: rand(32),
                rp: { name: 'מועדון מחול ישראלי', id: location.hostname },
                user: { id: new TextEncoder().encode(id).slice(0, 64), name: 'member-' + id.slice(0, 8), displayName: 'חבר מועדון' },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
                timeout: 60000
            }
        });
        localStorage.setItem(key(id), b64(cred.rawId));
        return true;
    }

    async function verify(id) {
        const stored = localStorage.getItem(key(id));
        if (!stored) return true;
        try {
            await navigator.credentials.get({
                publicKey: {
                    challenge: rand(32),
                    allowCredentials: [{ type: 'public-key', id: unb64(stored), transports: ['internal'] }],
                    userVerification: 'required',
                    timeout: 60000
                }
            });
            return true;
        } catch (e) { return false; }
    }

    return { available, enabled, enable, disable, verify };
})();
