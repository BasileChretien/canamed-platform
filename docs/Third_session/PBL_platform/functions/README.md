# CANAMED Cloud Functions — operator setup

Two functions live in [index.js](index.js):

1. **`sendQueuedMail`** — consent-gated transactional email. Setup below.
2. **`hfPatient`** — voices Mr. Lefebvre via Hugging Face Inference Providers
   for the Module A LLM-patient pilot (2026-05-28). Setup section near the
   bottom of this file.

> Both functions are **DORMANT by default**: even after deploy they refuse to
> do real work until an operator deliberately flips an approval flag. Code
> alone cannot escalate.

---

## `sendQueuedMail` — transactional email

This sends **consent-gated, transactional** email (e.g. the spaced-reinforcement
"revisit your retention quiz" reminder) when a facilitator enqueues a job at
`sessions/<code>/mail/<id>`.

> ## ⛔ Status: DISABLED pending institutional approval
> Email is intentionally kept **off** until the **university president approves**
> it. The function is dormant by default: even with SMTP configured it will not
> send — it records `delivery.state = "disabled"` — until an operator
> *deliberately* flips the approval flag (step 0 below). Do **not** enable it
> before approval.

The code (`index.js`) is complete; activation is **four** steps that **only you
can do** (they involve approval, billing, a secret, and DNS — which an assistant
must never perform):

## 0. Get institutional approval, then enable the feature
Only after the university president signs off:

```bash
firebase functions:config:set email.enabled="true"
```

(Equivalently set `EMAIL_ENABLED=true`.) Leaving this unset keeps email off.


## 1. Enable the Blaze (pay-as-you-go) plan
Cloud Functions require Blaze. Workshop volumes stay within the free monthly
allowance, but the plan must be enabled in the Firebase console → *Usage and
billing*.

## 2. Provide the SMTP secret (never commit it)
Use any SMTP provider (SendGrid, Mailgun, Amazon SES, your institution's relay).
Set the credentials as runtime config — they are stored by Firebase, **not** in
the repo:

```bash
firebase functions:config:set \
  smtp.host="smtp.yourprovider.com" \
  smtp.port="587" \
  smtp.user="apikey-or-username" \
  smtp.pass="THE-SECRET" \
  smtp.from="CANAMED <no-reply@your-domain.org>"
```

(Equivalently, set `SMTP_HOST/PORT/USER/PASS/FROM` as environment variables.)

## 3. Verify the sender domain (SPF/DKIM)
In your email provider, verify the `from` domain and add the SPF/DKIM DNS
records they give you, so reminders don't land in spam.

## Deploy
```bash
cd docs/Third_session/PBL_platform/functions
npm install
cd ..
firebase deploy --only functions,database
```

## Notes
- **Not an open relay.** The mail queue is admin-write-only at the database-rules
  layer (`sessions/<code>/mail/<id>` requires the session's `adminPasswordHash`),
  and recipient/subject/body are validated by the rules before the function runs.
- **Consent + minimisation.** Email is collected only with explicit opt-in for a
  single transactional send (the revisit reminder); it is not added to any
  participant profile. Update the privacy notice if you enable this.
- **Orgs tree.** If you run sessions under `/orgs/<slug>/sessions/...`, add a
  parallel export with the trigger path
  `/orgs/{slug}/sessions/{code}/mail/{id}` (same body as `sendQueuedMail`).
- Until these steps are done, enqueued jobs simply record
  `delivery: { state: "error", error: "SMTP not configured" }` — nothing is sent
  and nothing breaks.

---

## `hfPatient` — Module A LLM-patient (pilot, 2026-05-28)

Free-text consultation for Module A: students *type* questions to Mr Lefebvre
instead of clicking buttons. This callable proxies their question to **Hugging
Face Inference Providers** (free tier covers our workshop volumes) and returns
the patient's reply. The HF token NEVER reaches the client.

> ## ⛔ Status: DISABLED pending institutional approval
> Same dormant-by-default pattern as `sendQueuedMail`. Even with the HF token
> configured, the function returns `{ state: "disabled" }` until an operator
> deliberately flips `moda.llm=true`. The client (modA-llm-bridge.js) falls
> back to a local stub patient so the chat UI keeps working.

### Security model (what makes this safe to deploy)

- **App Check is ENFORCED** on the callable (`enforceAppCheck: true`,
  `consumeAppCheckToken: true`). A request without a fresh, single-use
  attestation token is rejected before any HF call.
- **Auth required** — anonymous Firebase Auth is enough (every classroom user
  has it). Verified via `context.auth.uid`.
- **HF token stored server-side only** (`functions.config().hf.token`); never
  in the browser, never in source.
- **Per-uid rate limit** in RTDB (`metrics/hfPatient/usage/<uid>` token-bucket):
  40 turns / user / hour. A leaked App Check token can't burn the bill.
- **Body validated server-side**: at most 16 messages, 4000 chars total,
  role ∈ {system, user, assistant}.
- **Reply sanitised**: "Patient:" prefix stripped, JSON-shaped replies
  rejected, length capped at 600 chars.
- **No PII logged.** Only counters reach the database
  (`metrics/hfPatient/events` — uid, ts, lang, msgCount, replyLen). The actual
  transcript lives at `rooms/<r>/moduleA/chat/<id>` under the existing
  App-Check-enforced RTDB rules, no part of it on the function's side.

### Cost (honest accounting)

- **Cloud Functions free tier**: 2 M invocations + 400 k GB-s + 200 k CPU-s
  per month. A workshop with 30 students × 10 chat turns = 300 invocations.
  You are not going to bill.
- **HF Inference Providers** has a free tier on most open-weights models
  (Mistral-7B-Instruct, Llama-3.1-8B-Instruct, Qwen-2.5-7B-Instruct). Set the
  model via `hf.model` config below.
- Set a **$1 budget alert** on the Firebase Console to catch any surprise.

> **Note (2026):** Firebase has deprecated `functions:config:*` (shuts down
> March 2027). This function uses the modern **params API** instead — secrets
> via Google Secret Manager, non-secrets via `.env` files or the
> `defineString`/`defineBoolean` defaults baked into `index.js`. The commands
> below are the new flow.

### 0. Get institutional approval, then enable the feature
Only after sign-off, set the boolean param. Two equivalent options:

**Option A — `.env` file (recommended, version-controllable per environment):**

Create `functions/.env` (or `.env.<projectId>` for per-project overrides)
with:

```
MODA_LLM_ENABLED=true
HF_MODEL=mistralai/Mistral-7B-Instruct-v0.3
HF_MODEL_JA=Qwen/Qwen2.5-7B-Instruct
```

`.env` is in `.gitignore`. `.env.<projectId>` is **per-project** and only
applies to that Firebase project — useful if you have separate dev / staging
/ prod projects.

**Option B — interactive at deploy time:**

If `MODA_LLM_ENABLED` is not in `.env`, `firebase deploy --only functions`
prompts for it. Until this param is `true` the function returns
`{ state: "disabled" }` regardless of the rest of the configuration.

### 1. Enable the Blaze (pay-as-you-go) plan
Cloud Functions require Blaze. Workshop volumes stay well inside the free
allowance — enabling Blaze does NOT mean spending money. Set a **$1 budget
alert** at the same time (GCP Console → Billing → Budgets & alerts) so any
runaway is caught instantly.

> Secret Manager (used for `HF_TOKEN` below) bills ~$0.06/month per active
> secret version. Negligible, but it's why a Blaze upgrade is required —
> Spark-plan projects can't use Secret Manager.

### 2. Set the HF token (Secret Manager, never .env, never source)
Sign up for a free Hugging Face account at https://huggingface.co/settings/tokens
and create a **Fine-grained** Access Token with **only** "Make calls to
Inference Providers" ticked. Then in a terminal at the repo root:

```bash
firebase functions:secrets:set HF_TOKEN
```

The CLI prompts for the value — paste the `hf_...` string when asked.
The token is stored in **Google Secret Manager**, encrypted at rest, and
mounted into the function's runtime memory only when invoked. It NEVER
lands in source, `.env`, or Runtime Config.

To rotate later: run the same command — it creates a new version and old
ones can be disabled via the GCP Console (Secret Manager → HF_TOKEN).

To verify the secret was created (does NOT print the value):

```bash
firebase functions:secrets:access HF_TOKEN  # prints decoded value to YOUR terminal only — don't paste
firebase functions:secrets:get  HF_TOKEN    # metadata only, safe to share
```

### 3. Add the Firebase Functions SDK to `index.html` (with integrity hash)
The browser needs `firebase-functions-compat` to call the callable. Add this
script tag **just after `firebase-app-check-compat.js`** in
[index.html](../index.html). The integrity hash MUST be the sha384 of the
exact file at this version (mirror the existing pattern for the other
firebase compat scripts):

```html
<script src="https://www.gstatic.com/firebasejs/12.13.0/firebase-functions-compat.js"
        integrity="sha384-0e6ckm3xAVRuudHvqdLzPYsVoBYmqB3xnx4uw9owqugEc3FyhMYiwmB7SjWACApm"
        crossorigin="anonymous"></script>
```

The integrity hash above was computed against the exact file at v12.13.0 on
2026-05-28. If you bump the Firebase SDK version (the other compat scripts
in [index.html](../index.html) ship as a set — keep them in lockstep),
recompute every hash with:

```bash
for f in firebase-app-compat firebase-database-compat firebase-auth-compat firebase-app-check-compat firebase-functions-compat; do
  echo "$f: $(curl -s https://www.gstatic.com/firebasejs/<NEW_VERSION>/$f.js | openssl dgst -sha384 -binary | openssl base64 -A)"
done
```

Without this tag the bridge stays in **stub mode** — chat works locally with
canned answers, but no LLM is called. This is the safe default.

### Deploy

```bash
cd docs/Third_session/PBL_platform/functions
npm install
cd ..
firebase deploy --only functions,database,hosting
```

`database` redeploys [database.rules.json](../database.rules.json) — needed
because the LLM pilot adds new validation rules for the chat transcript and
the once-only awarded map. `hosting` picks up the CSP change in
[firebase.json](../firebase.json) (adds `*.cloudfunctions.net` + `*.run.app`
to `connect-src`).

### Privacy review (operator step, not code)

- Update the PIS / privacy notice to disclose **Hugging Face** as a
  sub-processor for the Module A pilot (EU/US data transfer, transient
  processing, no PII collected).
- Surface the re-consent banner on next session join. The bridge's existing
  on-screen `modA.chat.disclosure` banner already tells users what is sent;
  the formal PIS update is for compliance.

### Verifying it works (without spending real budget)

```bash
# Check the function deployed, App Check enforced
gcloud functions describe hfPatient --region=us-central1 \
  --format="value(state, eventTrigger)"

# Smoke-test from the platform: open the chat with ?llm=1 and a real
# session, type "Any fever?". A real HF reply means everything is wired.

# Check the metrics counter (should increment)
firebase database:get /metrics/hfPatient/events --shallow

# Check the rate-limit counter
firebase database:get /metrics/hfPatient/usage --shallow
```

### Turning it OFF instantly (panic button)

Edit `functions/.env` (or `.env.<projectId>`) and flip:

```
MODA_LLM_ENABLED=false
```

Then redeploy:

```bash
firebase deploy --only functions
```

The function returns `{ state: "disabled" }` within ~30s of the deploy
completing. Clients seamlessly fall back to the local stub patient.

**Even faster panic button** — disable the App Check requirement at the
Firebase Console (App Check → hfPatient → unenforce) to make every call
immediately fail with `unauthenticated`. The bridge falls back to stub on
the very next turn. Re-enforce when you've cleaned up.
