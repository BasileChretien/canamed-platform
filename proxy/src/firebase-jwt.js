/* firebase-jwt.js — verify a Firebase Auth ID token with Web Crypto only.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 * As a Firebase *callable*, hfPatient got `request.auth.uid` for free: the
 * Functions SDK verified the caller's ID token before the handler ran. Off
 * Google's platform nothing does that, so the proxy must verify the token
 * itself — and getting this wrong is not a degraded feature, it is an open
 * relay for the HF token. Anyone could then spend the project's inference
 * budget by POSTing a made-up uid.
 *
 * Deliberately dependency-free and Web-standard (fetch + crypto.subtle), so
 * the same file runs unmodified on Cloudflare Workers, Scaleway Functions,
 * Deno Deploy, Vercel and Node ≥18. `firebase-admin` is NOT an option here:
 * it is a Node-only, heavyweight dependency that would also want a service
 * account — see the note about service-account keys in README.md.
 *
 * ── WHAT MUST BE CHECKED, AND WHY EACH ONE ───────────────────────────────
 * A signature check alone is NOT enough. Google signs the ID tokens of EVERY
 * Firebase project with the same key set, so a validly-signed token from an
 * unrelated project would pass a signature-only check. `aud` and `iss` are
 * what bind a token to THIS project; skipping them is the classic confused-
 * deputy hole. Per Firebase's documented verification rules:
 *
 *   alg  must be RS256          — never trust the token's own alg blindly
 *                                 ("alg":"none" / HS256-with-public-key are
 *                                 the textbook JWT forgeries)
 *   kid  must match a current Google signing key
 *   aud  === <projectId>
 *   iss  === https://securetoken.google.com/<projectId>
 *   sub  non-empty, and it IS the uid
 *   exp  in the future, iat/auth_time not in the future (clock skew allowed)
 *
 * Anonymous sign-in produces a normal ID token, so anonymous participants —
 * which is what this platform uses — verify exactly like any other user.
 */

const CERT_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

/* Google rotates these keys, so they cannot be pinned — but re-fetching them
 * on every chat turn would add a round trip to Google to a request whose whole
 * point is to avoid depending on Google. Cached honouring the response's own
 * Cache-Control max-age, which is what tells us when rotation is due. */
const _certCache = { keys: null, expiresAt: 0 };

function _b64urlToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function _decodeJson(segment) {
  return JSON.parse(new TextDecoder().decode(_b64urlToBytes(segment)));
}

/* Google publishes X.509 CERTIFICATES; crypto.subtle.importKey wants a
 * SubjectPublicKeyInfo (spki). Rather than write an ASN.1 parser, we pull the
 * SPKI out of the certificate by locating the RSA SubjectPublicKeyInfo
 * structure — see _spkiFromCertDer. */
function _pemBodyToDer(pem) {
  const body = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  return _b64urlToBytes(body.replace(/\+/g, "-").replace(/\//g, "_"));
}

/* Minimal DER walk to lift the SubjectPublicKeyInfo out of an X.509 cert.
 *
 * A full ASN.1 parser is not needed and would be more to get wrong: the SPKI
 * is the only structure in the certificate that begins with the RSA
 * AlgorithmIdentifier OID (1.2.840.113549.1.1.1), whose DER encoding is the
 * fixed 15-byte prefix below. We find that prefix, then read the enclosing
 * SEQUENCE's length header backwards from it. Verified against Google's live
 * certificate set by tests/llm-proxy.test.js.
 */
const _RSA_OID = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];

function _spkiFromCertDer(der) {
  outer: for (let i = 0; i + _RSA_OID.length <= der.length; i++) {
    for (let j = 0; j < _RSA_OID.length; j++) {
      if (der[i + j] !== _RSA_OID[j]) continue outer;
    }
    // `i` is the start of the AlgorithmIdentifier, which is the first element
    // of the SubjectPublicKeyInfo SEQUENCE. Step back over that SEQUENCE's
    // own tag+length header (0x30 then a short or long-form length).
    for (let back = 2; back <= 5 && i - back >= 0; back++) {
      if (der[i - back] !== 0x30) continue;
      const lenByte = der[i - back + 1];
      let headerLen;
      if (lenByte < 0x80) headerLen = 2;
      else headerLen = 2 + (lenByte & 0x7f);
      if (i - back + headerLen !== i) continue;   // header must end where the OID starts
      return der.slice(i - back);
    }
  }
  throw new Error("could not locate SubjectPublicKeyInfo in certificate");
}

async function _fetchCerts(deps) {
  const now = deps.now ? deps.now() : Date.now();
  if (_certCache.keys && now < _certCache.expiresAt) return _certCache.keys;

  const res = await (deps.fetch || fetch)(CERT_URL);
  if (!res.ok) throw new Error("could not fetch Google signing certificates: HTTP " + res.status);
  const certs = await res.json();

  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "");
  // 1 hour if Google stops sending Cache-Control. Never cache forever: a
  // revoked key must stop being accepted.
  const ttlMs = (maxAge ? Number(maxAge[1]) : 3600) * 1000;

  _certCache.keys = certs;
  _certCache.expiresAt = now + ttlMs;
  return certs;
}

/* Exposed for tests — a module-level cache is otherwise invisible state that
 * makes one test's fetch stub leak into the next. */
export function _resetCertCache() {
  _certCache.keys = null;
  _certCache.expiresAt = 0;
}

/* Returns { uid, claims } or throws. NEVER returns a falsy-but-successful
 * value: every caller treats a throw as "reject the request", so a bug that
 * returned undefined must not read as success. */
export async function verifyFirebaseIdToken(idToken, projectId, deps) {
  const d = deps || {};
  const now = d.now ? d.now() : Date.now();
  // Firebase tokens are valid for an hour; allow a little skew in both
  // directions so a slightly-fast client clock is not an outage.
  const SKEW_S = 300;

  if (typeof idToken !== "string" || !idToken) throw new Error("missing ID token");
  if (typeof projectId !== "string" || !projectId) throw new Error("proxy misconfigured: no project id");

  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("malformed ID token");

  let header, payload;
  try {
    header = _decodeJson(parts[0]);
    payload = _decodeJson(parts[1]);
  } catch (_e) {
    throw new Error("malformed ID token");
  }

  // Reject the algorithm confusion attacks before touching any key material.
  if (!header || header.alg !== "RS256") throw new Error("unexpected token alg");
  if (!header.kid) throw new Error("token has no kid");

  const certs = await _fetchCerts(d);
  const pem = certs[header.kid];
  // An unknown kid means the token was signed by something that is not a
  // current Google key — including a key the attacker made up.
  if (!pem) throw new Error("unknown token signing key");

  const spki = _spkiFromCertDer(_pemBodyToDer(pem));
  const key = await crypto.subtle.importKey(
    "spki", spki,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    _b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1])
  );
  if (!ok) throw new Error("bad token signature");

  // ── binding to THIS project: the half a signature check cannot give ──
  if (payload.aud !== projectId) throw new Error("token audience mismatch");
  if (payload.iss !== "https://securetoken.google.com/" + projectId) {
    throw new Error("token issuer mismatch");
  }
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("token has no subject");

  const nowS = Math.floor(now / 1000);
  if (typeof payload.exp !== "number" || payload.exp + SKEW_S < nowS) throw new Error("token expired");
  if (typeof payload.iat === "number" && payload.iat - SKEW_S > nowS) throw new Error("token issued in the future");

  return { uid: payload.sub, claims: payload };
}
