# ATM Brokerage CRM — Operational Runbook

> **Purpose:** How this system works in production, how to debug it when things break, and how to verify everything is healthy. This is the doc you read at 11pm when an email didn't send.

**Last updated:** 2026-04-25
**Owner:** Jeff Sosville
**Production URL:** https://atm-brokerage-crm.vercel.app
**Repo:** [fill in GitHub URL]

---

## Quick Reference

| Thing | Where |
|---|---|
| Hosting | Vercel |
| Database | Supabase (project: `wgrmxhxozoyvcmvbfuxv`) |
| Email sending | Resend |
| Email receiving / OAuth | Gmail (john@) |
| Domain | atmbrokerage.com (Name.com) |
| Admin panel PIN | `2026` (shared with Sanny) |
| AI drafting | Anthropic Claude API |

**Key env vars** (set in Vercel → Project → Settings → Environment Variables):
- `RESEND_API_KEY` — for outbound email
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — DB access
- `ANTHROPIC_API_KEY` — for John-voice email drafts
- `GMAIL_OAUTH_*` — for Gmail sync
- `NDA_WEBHOOK_SECRET` — for NDA form webhook verification *(verify exact name)*

---

## System Map

```
atmbrokerage.com (WordPress)
    │
    │  NDA form submission
    ▼
[Webhook] ──► atm-brokerage-crm (Vercel)
                │
                ├──► Supabase: create deal_room_token
                ├──► Resend: send Deal Room access email
                └──► Admin panel notification

Gmail (john@) ──► OAuth sync ──► Supabase (emails table)
                                    │
                                    ├──► Daily digest (Resend)
                                    └──► AI draft generation (Anthropic)
```

---

## NDA → Deal Room Email Flow

This is the flow that broke yesterday (2026-04-24). Capturing it here so it's the first thing anyone checks next time.

### How it works (happy path)

1. Buyer fills out NDA on **atmbrokerage.com** (the seller intake / NDA form embed)
2. Form POSTs to webhook endpoint on the CRM: `POST /api/nda/submit` *(verify path)*
3. CRM validates webhook signature using `NDA_WEBHOOK_SECRET`
4. CRM writes to Supabase:
   - Insert into `ndas` table (or equivalent — verify table name)
   - Generate unique `deal_room_token` and insert into `tokens` table with expiry
5. CRM calls Resend API to send the Deal Room email containing the tokenized link
6. Buyer clicks link → lands on Deal Room with token validated against Supabase
7. Admin panel shows new NDA submission

### How to verify it's working end-to-end

```bash
# 1. Submit a test NDA via the form on atmbrokerage.com (use a test email)
# 2. Check Resend dashboard: https://resend.com/emails
#    → confirm email was sent, check status (delivered / bounced / etc.)
# 3. Check Supabase ndas + tokens tables for the new row
# 4. Click the email link → confirm Deal Room loads
```

### Common failure modes

| Symptom | Likely cause | How to check | Fix |
|---|---|---|---|
| Email never sends | Resend API key invalid/rotated | Vercel env vars + Resend dashboard | Rotate key, update Vercel env, redeploy |
| Email sends but link 404s | Token not written to Supabase | Supabase `tokens` table for recent rows | Check API route logs in Vercel |
| Email lands in spam | SPF/DKIM/DMARC issue on sending domain | Use mail-tester.com on sending email | Verify DNS records at Name.com |
| Webhook 401/403 | `NDA_WEBHOOK_SECRET` mismatch | Vercel function logs | Re-sync secret between WP form and CRM |
| Webhook 500 | DB write failed (schema change, RLS) | Vercel logs + Supabase logs | Check recent migrations / RLS policies |
| Form submits but nothing happens | Webhook not firing from WordPress | Browser network tab on form submit | Check WP form plugin settings, webhook URL |
| Buyer gets email but token expired | Token TTL too short / clock skew | `tokens` table `expires_at` column | Adjust TTL in code |

### Yesterday's incident (2026-04-24)

> **Fill in:** What was the actual root cause of the NDA emails not sending? Add details here so future-you can pattern-match.
>
> - What broke:
> - How it surfaced:
> - Root cause:
> - Fix applied:
> - Prevention (test added? monitoring? env var validation?):

### Where to look first when this breaks

1. **Resend dashboard** — did the email even attempt to send? If not, problem is upstream.
2. **Vercel function logs** — filter to `/api/nda/*` routes for the time window
3. **Supabase logs + `ndas` / `tokens` tables** — was the row written?
4. **WordPress form settings** — is the webhook URL still correct? Did someone update the form?

---

## Gmail Sync + AI Email Drafts

### How it works

- Gmail OAuth connects john@ inbox to the CRM
- Background job pulls new emails into Supabase `emails` table
- AI draft generation uses Anthropic Claude API with John's voice prompt
- Daily digest emails sent via Resend each morning

### Common issues

- **OAuth token expired** → re-auth via admin panel
- **Drafts sound off** → check the John-voice system prompt hasn't been edited
- **Digest not sending** → check Vercel cron job status, Resend logs

---

## Deploy / Rollback

- **Deploy:** push to `main` → Vercel auto-deploys
- **Rollback:** Vercel dashboard → Deployments → click previous deployment → "Promote to Production"
- **Hotfix:** branch from main, push, preview deploy, merge

---

## Access & Credentials

- **GitHub:** jeffsosville
- **Vercel:** [team/personal account]
- **Supabase:** project `wgrmxhxozoyvcmvbfuxv`
- **Resend:** [account email]
- **Admin panel PIN:** `2026` (shared with Sanny)
- **Gmail OAuth:** john@[domain] — re-auth via admin panel if token expires

> All actual credentials live in Vercel env vars and 1Password (or wherever you store them — note the location here, not the values).

---

## Incident Log

Append a one-paragraph entry here every time something non-obvious breaks. Date + symptom + root cause + fix.

- **2026-04-24** — NDA confirmation emails not sending after submission. *(Fill in details from yesterday)*

---

## TODO / Known Issues

- [ ] Add automated end-to-end test for NDA flow (submit test form daily, alert if email doesn't arrive)
- [ ] Add Sentry or similar error monitoring to Vercel functions
- [ ] Document exact Supabase table schemas in `ARCHITECTURE.md`
