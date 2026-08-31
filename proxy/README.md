# hfPatient proxy — Module A's simulated patient, without a Blaze plan

Firebase Cloud Functions v2 run on Cloud Run, which requires a **Blaze (billing)
plan**. This project's billing trial closed on **2026-08-27** and was
deliberately not renewed, so the `hfPatient` callable cannot start: a request
gets Google's generic HTML *500 Server Error* with **no application logs at
all**, and Module A's chat degrades — silently — to the stub patient on every
turn.

Silently is the dangerous part. The chat bridge treats any backend failure as
"unavailable" and falls back, so students get a patient who answers a *different
question than the one they asked*. It reads as an incoherent patient, not as an
outage.

This directory is the same handler, hosted somewhere free.

---

## ⚠️ Read this before you pick a host: data residency

`functions/index.js` and `modA-llm-init.js` both record a deliberate decision to
keep participants' free-text chat **inside the EEA**, taken partly because
Japan's APPI Art. 28 equivalent-protection list covers only the EEA and the UK.
The `HF_PROVIDER=ovhcloud` pin (Gravelines, France) is the same decision applied
to the inference leg.

**A free Cloudflare Worker cannot honour that.** Workers run at whichever edge
PoP is nearest the visitor, anywhere in the world; restricting execution to the
EU needs Regional Services / the Data Localization Suite, which is an
**Enterprise** add-on.

| host | free tier | EEA-pinnable? |
| --- | --- | --- |
| **Scaleway Serverless Functions** (`fr-par`, Paris) | 1M requests + 400k GB-s/month | **Yes** — French company, Paris region |
| Vercel Functions (Hobby) | generous | `fra1` selectable; Hobby forbids commercial use |
| Cloudflare Workers | 100k req/day | **No** on the free plan |

**If the EEA commitment still stands — and the CER Unicaen dossier assumes it
does — deploy to Scaleway `fr-par`, not Cloudflare.** The handler is
host-agnostic (Web-standard `fetch` + WebCrypto, no Node APIs), so the same
`src/` runs on any of them; only the thin adapter differs. `cloudflare/` is
provided because it is the fastest thing to stand up for a demo.

Whichever you choose, **the host becomes a new sub-processor** and must be added
to the privacy notice and the DPA. See "Legal follow-ups" at the bottom — that
work is not optional and is not done by this directory.

---

## What is preserved from the callable, and what is not

| control | callable | proxy |
| --- | --- | --- |
| Caller identity | `request.auth.uid`, verified by the Functions SDK | `verifyFirebaseIdToken()` — RS256 via WebCrypto, with `aud`/`iss` bound to the project |
| Room membership | `roomOf/<uid>` via admin SDK | same claim, read over RTDB REST with the **caller's own token** |
| Rate limits + global daily cap | RTDB counters via admin SDK | KV store; **required** — no store means the proxy refuses to serve |
| HF token | Secret Manager | host secret store; never in source, never in the browser |
| Server-authoritative prompt guard | `hf-helpers.js` | **the same file**, imported, not copied |
| EU provider pin | `applyProviderPin` | same, and fails closed on a bad provider |
| **App Check** | available | **absent** — see below |

**App Check is genuinely gone on this path.** A raw `fetch` cannot mint the
token, and a proxy off Google's platform could not verify one. That is why the
client requires an explicit `acknowledgeUnsafe: true` before it will use the
endpoint. It costs nothing *today* — App Check is in *Monitor*, and reCAPTCHA
has been consent-gated off since shell v148, so no client mints a token at all —
but it must stay a conscious choice, not a silent downgrade.

**No service-account key is used, on purpose.** Reproducing the admin-SDK read
would mean putting a Google service-account key on a third-party host — a
full-database credential, far more dangerous than the HF token it would be
protecting. The membership value still comes from the *database*, never from the
request body, so a client cannot assert its way into another room.

---

## Deploy — Cloudflare Workers

Prerequisites: a Cloudflare account and `npx wrangler login`. **You** create the
account and hold the credentials; nothing here does that for you.

```bash
cd proxy/cloudflare
npx wrangler kv namespace create RATE_LIMIT
```

Paste the printed `id` into `wrangler.toml` (replacing the placeholder), then:

```bash
npx wrangler secret put HF_TOKEN
```

Paste your Hugging Face token when prompted — it is stored encrypted and never
enters this repo. Then deploy:

```bash
npx wrangler deploy
```

Wrangler prints the worker URL, e.g. `https://canamed-hf-patient.<sub>.workers.dev`.

## Deploy — Scaleway (`fr-par`)

Write a small adapter that calls `handleRequest(request, env, { store })` with a
KV-shaped store, set the same variables from `wrangler.toml`'s `[vars]` as
function environment variables, and put `HF_TOKEN` in the function's secret
store. The core needs no changes.

---

## Point the platform at it — TWO edits, both required

1. `docs/Third_session/PBL_platform/firebase-config.js`:

   ```js
   window.CANAMED_LLM_PROXY = {
     url: "https://canamed-hf-patient.<sub>.workers.dev",
     acknowledgeUnsafe: true
   };
   ```

2. The `connect-src` directive of the CSP in `index.html` — add that **exact
   origin**.

Miss the second and the browser blocks every request, and because the bridge
falls back on any failure, the room silently gets the stub patient with nothing
in the UI to explain why. `tests/llm-proxy-config.test.js` fails the build when
these two disagree, precisely because that failure is otherwise invisible.

Then bump the PWA shell (`sw.js`, `script-loader.js`, `index.html` `?v=`) or
returning browsers keep serving the cached bundle without the change.

---

## Verify it actually works

A green deploy is not evidence. Check all three:

```bash
# 1. Unauthenticated POST must be REFUSED by the handler itself.
#    "auth required" is the handler's own message, so seeing it proves the
#    request reached the code (and is the same string the uptime probe uses).
curl -s -X POST -H 'Content-Type: application/json' -d '{"data":{}}' \
  https://<your-proxy-url>
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

## Panic button

Set `MODA_LLM_ENABLED = "false"` in `wrangler.toml` (or the host's env) and
redeploy. Every client falls back to the local stub patient within seconds.
Unlike the Cloud Function's equivalent flag, this one is actually usable on the
free plan — flipping the function's version needs a functions deploy, which
needs billing.

## Legal follow-ups — NOT done by this directory

- The chosen host is a **new sub-processor**. The privacy notice exists in 12
  surfaces across 8 languages and currently names Firebase and Hugging Face
  only.
- If the host is not EEA-pinned, the EEA-residency statement in the privacy
  notice and in the CER Unicaen dossier is **no longer accurate** and needs
  either correcting or an SCC-backed transfer basis.
- The DPA needs the new recipient named, with its processing location.
