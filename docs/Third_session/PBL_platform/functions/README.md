# CANAMED email Cloud Function — operator setup

This sends **consent-gated, transactional** email (e.g. the spaced-reinforcement
"revisit your retention quiz" reminder) when a facilitator enqueues a job at
`sessions/<code>/mail/<id>`. The code (`index.js`) is complete; activation is
three steps that **only you can do** (they involve billing, a secret, and DNS —
which an assistant must never perform):

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
