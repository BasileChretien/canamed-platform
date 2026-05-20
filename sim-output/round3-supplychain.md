# Supply-Chain Security Audit — CaNaMED PBL Platform
Date: 2026-05-20
Auditor: security-reviewer agent

---

## FINDING 1 — HIGH
**Lazy-loaded first-party scripts injected without SRI**
File: `docs/Third_session/PBL_platform/script-loader.js` lines 71-72

`script-loader.js` dynamically creates `<script>` tags for four on-demand bundles:
`case-content.js`, `qrcode.js`, `tour.js`, `scenario-author.js`. The `loadScript()`
helper sets `tag.src = src` but never sets `tag.integrity` or `tag.crossorigin`.

Because these are same-origin files served over Firebase Hosting HTTPS, a CDN-level
compromise or a Firebase Hosting misconfiguration that serves a tampered file would
execute without any browser-level check. The five eagerly loaded Firebase SDK scripts
in `index.html` do carry `integrity="sha384-..."` — the lazy path is inconsistent.

SRI on same-origin scripts is not enforced by browsers today (the spec allows it but
browsers only block on cross-origin mismatch), so the practical risk is lower than for
a CDN script. However, the CSP `script-src 'self'` would still pass a tampered
same-origin file. The missing `integrity` attributes create a gap in the defense-in-
depth story, especially for the `qrcode.js` bundle (third-party lib shipped as a
vendored file).

Fix: add `tag.integrity` and `tag.crossorigin = "anonymous"` in `loadScript()`. Store
expected hashes in a manifest object at the top of `script-loader.js` keyed by
filename, regenerated at deploy time (e.g. `openssl dgst -sha384 -binary case-content.js | base64`).

---

## FINDING 2 — HIGH
**`/_csp_report` endpoint does not exist — CSP reports are silently dropped**
File: `docs/Third_session/PBL_platform/firebase.json` lines 43-49

Both the `Report-To` and `Reporting-Endpoints` headers point to `/_csp_report`. There
is no Cloud Functions backend, no Firebase Hosting rewrite to a Cloud Run endpoint, and
no `rewrites` rule in `firebase.json` that maps this path to anything. Firebase Hosting
will return a 404 for every report the browser submits.

The CSP itself is strong (no `unsafe-inline`, no `unsafe-eval`, tight host list). But
without a working collector the platform is flying blind: any injection attempt,
accidental CSP regression, or browser extension that triggers a violation will
generate zero observable signal.

The `report-to csp-endpoint` directive at the end of the `Content-Security-Policy`
value (firebase.json line 40) is therefore inert.

Fix (pick one):
- (a) Add a minimal Cloud Function `cspReport` that logs `req.body` to Cloud Logging
  and wire a rewrite: `{ "source": "/_csp_report", "function": "cspReport" }`.
- (b) Use an external CSP reporting SaaS (report-uri.com, sentry.io) — replace the
  `/_csp_report` URL in both headers and the CSP directive.
- (c) At minimum, add a Hosting rewrite to `/index.html` so the 404 is replaced by a
  200 and the platform does not log noisy errors; then implement (a) when budget allows.

---

## FINDING 3 — MEDIUM
**`innerHTML` used with translation values that can include `<a href>` tags — no sanitization layer**
File: `docs/Third_session/PBL_platform/i18n.js` lines 3307, 3327

`applyI18n()` calls `node.innerHTML = t(key)` for all `[data-i18n-html]` elements and
for the combined `data-i18n` + `data-i18n-html` flag form. Several translation strings
in the English table (lines 313-317) contain `<a href="mailto:...">` and
`<a href="privacy.html" ... target="_blank" rel="noopener">` tags as well as
`<strong>`, `<em>`.

The comment at line 3313 states "author-controlled content only — never user input —
so innerHTML is safe." This is correct for the *current* codebase. The risk is supply-
chain: if an attacker compromises the translation-table update path (e.g., a future
PR that adds a translation file loaded from a remote URL, or a CI script that pulls
updated strings from a CMS), the innerHTML sinks become XSS vectors without any
intermediate barrier.

The CSP `script-src 'self'` does mitigate inline event handlers (`onerror=...`),
but `<a href="javascript:...">` bypasses CSP when `script-src` does not include
`javascript:` blocking — and there is no `navigate-to` directive. Some browsers will
execute `javascript:` hrefs regardless of `script-src`.

Fix: wrap the `node.innerHTML = t(key)` calls with a minimal allowlist sanitizer.
Since DOMPurify is not already bundled, the cheapest safe option is:

```js
function safeHtml(raw) {
  const tmp = document.createElement("div");
  tmp.textContent = raw;          // parse as text first
  // then re-parse only the known-safe subset
  const allowed = /^(<\/?(strong|em|br|a)(\s[^<>]*)?>)*$/;
  // for production: use DOMPurify.sanitize(raw, { ALLOWED_TAGS: ["strong","em","br","a"], ALLOWED_ATTR: ["href","target","rel"] })
}
```

For a production deployment processing GDPR-sensitive text it is worth adding
`dompurify` (3 KB gzip) as a vendored script and calling
`DOMPurify.sanitize(value, { ALLOWED_TAGS: [...], ALLOWED_ATTR: [...] })` before
every `innerHTML` assignment.

---

## FINDING 4 — MEDIUM
**CSP missing `font-src` directive — falls back to `default-src 'self'`**
File: `docs/Third_session/PBL_platform/firebase.json` line 40

The CSP has no `font-src` directive. The browser therefore applies `default-src 'self'`
to font loads. This is safe (only self-hosted fonts are permitted), but it also means
that if a future developer adds a Google Fonts `<link>` or an `@font-face` referencing
an external CDN, the font silently fails with a CSP violation — and because the
reporting endpoint is broken (Finding 2), nobody sees the error.

The CSP also lacks `worker-src`. The Service Worker at `sw.js` is same-origin so it
currently passes, but any future attempt to add a Web Worker from a CDN would fail
silently. The `manifest.webmanifest` is served with the correct Content-Type header but
there is no `manifest-src` directive (defaults to `default-src 'self'` — currently
fine).

Fix: add explicit directives to make intent clear and reduce surprise:
```
font-src 'self';
worker-src 'self';
manifest-src 'self';
```

---

## FINDING 5 — MEDIUM
**HSTS header missing `preload` flag**
File: `docs/Third_session/PBL_platform/firebase.json` line 53

`Strict-Transport-Security: max-age=31536000; includeSubDomains` is present and
correct. However, it does not include `preload`. Without `preload` (and without
submitting to hstspreload.org), a first-time visitor who types the bare domain into
a browser may receive the initial HTTP response before being upgraded — the classic
HSTS Trust-On-First-Use window.

For a medical-education platform that handles GDPR special-category data this window
is worth closing. Firebase Hosting itself enforces HTTPS at the CDN edge, which
mitigates most of this in practice, but the header-level control is the correct
defense-in-depth layer.

Fix: change to `max-age=31536000; includeSubDomains; preload` and submit
`canamed-69785.web.app` (and the custom domain if one exists) to
https://hstspreload.org/.

---

## FINDING 6 — LOW
**Firebase Performance Monitoring SDK loaded unconditionally, increases attack surface**
File: `docs/Third_session/PBL_platform/index.html` lines 2641-2643

`firebase-performance-compat.js` is loaded eagerly on every page load. The comment
at lines 2635-2640 correctly notes it "only activates when `window.CANAMED_PERF_MONITORING`
is set to truthy". The SDK script is still fetched and parsed even when the flag is
unset, adding ~30 KB (gzip) to the page weight and one additional CDN dependency to
the attack surface.

Fix: move the `<script>` tag inside a conditional in `firebase-config.js`:
```js
if (window.CANAMED_PERF_MONITORING) {
  const s = document.createElement("script");
  s.src = "https://www.gstatic.com/firebasejs/10.12.5/firebase-performance-compat.js";
  s.integrity = "sha384-itOr+DLGg//NmXkxa8it79G3P4Gpi3cqjsw8vx+DDTzJvzR2QTB3WrvbGirWm1Jq";
  s.crossOrigin = "anonymous";
  document.head.appendChild(s);
}
```

---

## FINDING 7 — LOW
**`reCAPTCHA` loaded as wildcard path, not a pinned versioned URL**
File: `docs/Third_session/PBL_platform/index.html` lines 14-16 (CSP) and firebase.json line 40

The CSP permits `https://www.google.com/recaptcha/` and `https://www.recaptcha.net/recaptcha/`
as script sources. reCAPTCHA is not loaded via a `<script>` tag in `index.html` at all
— it is loaded dynamically by the Firebase App Check SDK at runtime. This means it
cannot carry an SRI hash (hash-pinning a dynamically-versioned CDN asset is
impractical).

The path-prefix allowlisting (`/recaptcha/`) is the correct CSP approach for this case.
There is no additional hardening available at the HTML level, but the finding is noted
for completeness: any compromise of `google.com/recaptcha/` would pass the current CSP
without restriction.

No fix required — this is the intended pattern for App Check + reCAPTCHA. Consider
switching to `reCAPTCHA Enterprise` which supports domain-key pinning at the App Check
console level.

---

## FINDING 8 — LOW / INFORMATIONAL
**Firebase SDK version 10.12.5 — not the latest (11.x series released)**
File: `docs/Third_session/PBL_platform/index.html` lines 2617-2643

The five Firebase compat-SDK scripts are pinned to `10.12.5` with correct SRI hashes.
As of the audit date, Firebase JS SDK 11.x is available. The 10.x compat layer is still
maintained and no CVEs are recorded against `10.12.5` in the GitHub advisory database.

The pinning approach is exactly right (versioned URL + SRI). The action item is a
periodic review (suggested: before each academic year, as noted in the HTML comment at
line 2613) to bump to the latest patch in the maintained series and recompute hashes.

No immediate action required. Track Firebase release notes:
https://firebase.google.com/support/release-notes/js

---

## FINDING 9 — INFORMATIONAL (FALSE POSITIVE DISMISSED)
**`data-i18n-html` present in `style.css` and `privacy-lang.js` per grep count**
The grep count of 56 occurrences across 5 files includes the CSS file and the privacy
redirect script. Inspection of `style.css` shows these are CSS rules targeting the
`[data-i18n-html]` attribute selector (styling only). `privacy-lang.js` applies the
same `applyI18n()` function. No new `innerHTML` sink is introduced beyond what is
documented in Finding 3.

---

## FINDING 10 — INFORMATIONAL
**`package.json` devDependencies — no direct vulnerabilities identified**
File: `C:/cnm-pp/package.json`

Direct devDependencies: `@axe-core/playwright@4.11.3`, `@playwright/test@1.49.0`,
`c8@10.1.3`. These are test-time tools only; none are bundled into the deployed
platform. The lockfile (`package-lock.json` lockfileVersion 3) pins all transitive
deps with integrity hashes. No known CVEs against these specific versions were
identified at audit time. The platform itself has zero runtime npm dependencies —
it is a pure static site.

---

## Summary Table

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | HIGH     | script-loader.js:71-72 | Lazy-injected scripts lack SRI |
| 2 | HIGH     | firebase.json:43-49 | CSP report endpoint `/_csp_report` returns 404 |
| 3 | MEDIUM   | i18n.js:3307,3327 | `innerHTML` sinks unsanitized — supply-chain XSS risk |
| 4 | MEDIUM   | firebase.json:40 | Missing `font-src`, `worker-src`, `manifest-src` CSP directives |
| 5 | MEDIUM   | firebase.json:53 | HSTS missing `preload` flag |
| 6 | LOW      | index.html:2641 | Performance SDK loaded unconditionally (attack surface) |
| 7 | LOW      | index.html:14-16 | reCAPTCHA path-wildcard in CSP (no better option available) |
| 8 | LOW      | index.html:2617 | Firebase SDK 10.12.5 — not latest (no active CVE) |

---

## What is STRONG (no finding)

- All five Firebase SDK `<script>` tags carry correct `sha384-...` SRI hashes + `crossorigin="anonymous"` (index.html:2617-2643).
- No external font CDN, no external stylesheet CDN, no unpkg/jsDelivr/cdnjs imports anywhere.
- CSP has no `unsafe-inline`, no `unsafe-eval`, no wildcard hosts in `script-src` or `style-src`.
- All security headers are present: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `HSTS`.
- `report-to` and `Reporting-Endpoints` headers are wired (endpoint is broken per Finding 2, but the infrastructure intent is correct).
- Service Worker correctly excludes all Firebase / gstatic / Google hostnames from caching (`NETWORK_ONLY_HOSTS` list).
- Zero npm runtime dependencies bundled into the deployed static site.
- `package-lock.json` uses lockfileVersion 3 with integrity hashes on all transitive dev deps.
- No hardcoded API keys, passwords, or tokens found in any audited file.
