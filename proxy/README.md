# hfPatient proxy — Module A's simulated patient, without a Blaze plan

Firebase Cloud Functions v2 run on Cloud Run, which requires a **Blaze (billing)
plan**. This project's billing trial closed on **2026-08-27** and was
deliberately not renewed, so the `hfPatient` callable cannot start: a request
gets Google's generic HTML *500 Server Error* with **no application logs at
all**, and Module A's chat degrades to the stub patient on every turn.

Silently, which is the dangerous part. The chat bridge treats any backend
failure as "unavailable" and falls back, so students get a patient who answers a
*different question than the one they asked*. It reads as an incoherent patient,
not as an outage.

This directory is the same handler, hosted somewhere free.

---

## Host: Scaleway `fr-par` (Paris)

`functions/index.js` and `modA-llm-init.js` both record a deliberate decision to
keep participants' free-text chat **inside the EEA**, taken partly because
Japan's APPI Art. 28 equivalent-protection list covers only the EEA and the UK.
The `HF_PROVIDER=ovhcloud` pin (Gravelines, France) is the same decision applied
to the inference leg.

**Scaleway is a French provider and `fr-par` is Paris**, so the proxy ends up in
the same country as the pinned inference provider. Free tier: **1,000,000
requests and 400,000 GB-s per account per month** — orders of magnitude above
workshop traffic.

A free **Cloudflare** Worker cannot honour that commitment: Workers run at
whichever edge PoP is nearest the visitor, and restricting execution to the EU
needs Regional Services / the Data Localization Suite, an **Enterprise** add-on.
The `cloudflare/` adapter is kept for local development and ships **disabled**.

⚠️ Scaleway requires a payment method and identity verification to open an
account, even for free-tier use. Free-tier usage is not billed, but the card is
not optional.

---

## What is preserved from the callable, and what is not

| control | callable | proxy |
| --- | --- | --- |
| Caller identity | `request.auth.uid` via the Functions SDK | `verifyFirebaseIdToken()` — RS256 via WebCrypto, `aud`/`iss` bound to the project |
| Room membership | `roomOf/<uid>` via admin SDK | same claim over RTDB REST, read with the **caller's own** token |
| Per-uid + per-session limits | RTDB counters via admin SDK | RTDB counters, **increment-only** by database rule |
| **Global daily cap** | RTDB counter via admin SDK | **moved to the Hugging Face spend limit** — see below |
| HF token | Secret Manager | Scaleway secret; never in source, never in the browser |
| Server-authoritative prompt guard | `hf-helpers.js` | **the same file**, imported, not copied |
| EU provider pin | `applyProviderPin` | same, and fails closed on a bad provider |
| **App Check** | available | **absent** — see below |

**No service-account key is used, on purpose.** Reproducing the admin-SDK read
would mean putting a Google service-account key on a third-party host — a
full-database credential, far more dangerous than the HF token it would be
protecting. The membership value still comes from the *database*, never from the
request body, so a client cannot assert its way into another room.

**The rate-limit counters are written with the caller's own token, and the
database rules are what make that safe.** `rateLimits` is increment-only: a
write is allowed only when it is exactly `data + 1`. A participant can make
their own counter larger (self-harm) but cannot reset it. That rule also makes
the increment *atomic* — a concurrent writer's stale `N+1` is rejected and
retried, where an eventually-consistent KV would silently lose it.

**App Check is genuinely gone on this path.** A raw `fetch` cannot mint the
token, and a proxy off Google's platform could not verify one. That is why the
client requires an explicit `acknowledgeUnsafe: true`. It costs nothing *today*
— App Check is in *Monitor*, and reCAPTCHA has been consent-gated off since
shell v148, so no client mints a token at all — but it must stay a conscious
choice, not a silent downgrade.

### ⚠️ REQUIRED: set a spend limit on the Hugging Face account

The callable enforced a global 4000-turn/day ceiling on the inference bill. The
proxy **cannot**, and this is a relocation rather than an omission:

- Its counters are written with the caller's own token. A cross-user counter
  would be forgeable *upward* by any participant, who could push it past the cap
  and switch the chat off for the whole platform for the rest of the day —
  turning a cost control into a one-caller denial of service.
- A counter only the proxy could write means a proxy-held secret with database
  write access, i.e. the service-account key this design refuses to deploy.

So the ceiling moves to the layer that can actually enforce it: **the spend
limit on your Hugging Face account**. It is a hard cap set by the party doing
the billing, cannot be forged by a participant, and bounds the real quantity
(money) rather than a proxy for it (turns).

**Set it before you enable the chat.** The per-uid limits still bound one
participant to 200 turns/day, but nothing else bounds 30 participants across
several sessions.

---

## Deploy

Prerequisites: a Scaleway account and the `scw` CLI (`scw init`). **You** create
the account and hold the credentials.

Deploy from the `proxy/` directory so `scaleway/handler.js` can reach `../src`:

```bash
cd proxy && zip -r ../hf-patient-proxy.zip . -x 'cloudflare/*'
```

Create the function (namespace first, once) in `fr-par`, runtime `node22`,
handler `scaleway/handler.handle`, and set these variables:

| variable | value |
| --- | --- |
| `FIREBASE_PROJECT_ID` | `canamed-69785` |
| `RTDB_URL` | `https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app` |
| `MODA_LLM_ENABLED` | `true` (the panic button — `false` + redeploy falls every client back to the stub) |
| `HF_URL` | `https://router.huggingface.co/v1/chat/completions` |
| `HF_MODEL`, `HF_MODEL_JA` | `Qwen/Qwen3.5-9B` |
| `HF_PROVIDER` | `ovhcloud` — a **residency control**, not a tuning knob |
| `ALLOWED_ORIGINS` | `https://canamed-69785.web.app,https://canamed-69785.firebaseapp.com` |

and `HF_TOKEN` as a **secret**, not a plain variable.

Then deploy the database rules, which the counters depend on:

```bash
cd docs/Third_session/PBL_platform && firebase deploy --only database
```

Without that step every rate-limit write is refused and the proxy fails closed —
the chat will not work at all. That is deliberate: failing closed beats serving
unmetered.

## Point the platform at it — TWO edits, both required

1. `docs/Third_session/PBL_platform/firebase-config.js`:

   ```js
   window.CANAMED_LLM_PROXY = {
     url: "https://<your-function>.functions.fnc.fr-par.scw.cloud",
     acknowledgeUnsafe: true
   };
   ```

2. The `connect-src` directive of the CSP in `index.html` — add that **exact
   origin**.

Miss the second and the browser blocks every request; because the bridge falls
back on any failure, the room silently gets the stub patient with nothing in the
UI to explain why. `tests/llm-proxy-config.test.js` fails the build when these
two disagree, precisely because that failure is otherwise invisible.

Then bump the PWA shell (`sw.js`, `script-loader.js`, `index.html` `?v=`) or
returning browsers keep serving the cached bundle without the change.

---

## Verify it actually works

A green deploy is not evidence. Check all three:

```bash
# 1. Unauthenticated POST must be REFUSED by the handler itself.
#    "auth required" is the handler's own message, so seeing it proves the
#    request reached the code rather than being stopped in front of it.
curl -s -X POST -H 'Content-Type: application/json' -d '{"data":{}}' \
  https://<your-function>.functions.fnc.fr-par.scw.cloud
# {"error":{"message":"auth required","status":"UNAUTHENTICATED"}}
```

2. From a real room in the browser, send one **EN** and one **JA** turn. A
   coherent, in-character reply that answers the question you asked means the
   whole chain worked. An answer to a *different* question is the stub — the
   backend is not being reached.

3. Confirm the EU pin took effect: the response carries `provider`, taken from
   the router's `x-inference-provider` header. It must read `ovhcloud`. This is
   the only end-to-end proof the pin works; a stub reply instead usually means
   the model is not served by the pinned provider — check with:

   ```bash
   curl -s 'https://huggingface.co/api/models/Qwen/Qwen3.5-9B?expand[]=inferenceProviderMapping'
   ```

## Legal follow-ups

Drafts for these are in `docs/Third_session/PBL_platform/legal/`:

- **Scaleway becomes a new sub-processor.** The privacy notice exists in 12
  surfaces across 8 languages and currently names Firebase and Hugging Face
  only.
- The DPA needs Scaleway named, with its processing location (`fr-par`, Paris).
- The EEA-residency statement stays **accurate** on this host — which is the
  main reason to prefer it over Cloudflare.
