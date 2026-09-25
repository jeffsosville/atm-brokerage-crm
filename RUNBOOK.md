# ATM Brokerage CRM — Operational Runbook

> **Purpose:** How this system works in production, how to debug it when things break, and how to verify everything is healthy. This is the doc you read at 11pm when an email didn't send.

**Last updated:** 2026-04-25 (verified webhook handler against `app/api/nda-webhook/route.js`)
**Owner:** Jeff Sosville
**Production URL:** https://atm-brokerage-crm.vercel.app
**Repo:** https://github.com/jeffsosville/atm-brokerage-crm

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
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — DB access
- `NEXT_PUBLIC_APP_URL` — base URL used in Deal Room links (defaults to `https://atm-brokerage-crm.vercel.app`)
- `ANTHROPIC_API_KEY` — for John-voice email drafts
- `GMAIL_OAUTH_*` — for Gmail sync
- `NDA_WEBHOOK_SECRET` — for NDA form webhook verification (sent as `Authorization: Bearer <secret>`)

---

## System Map

```
atmbrokerage.com (WordPress)
    │
    │  NDA form submission (POST + Bearer token)
    ▼
/api/nda-webhook ──► atm-brokerage-crm (Vercel)
                │
                ├──► Supabase atm_deals: match deal by slug or single 'listed'
                ├──► Supabase deal_tokens + deal_buyer_access: insert token (10yr TTL)
                ├──► Resend: send Deal Room access email
                ├──► Supabase atm_activity_log: log 'nda_signed' event
                └──► Supabase atm_notifications: notify John in admin panel

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
2. Form POSTs JSON to webhook endpoint on the CRM: `POST /api/nda-webhook`
   - Handler: `app/api/nda-webhook/route.js`
   - Expected body fields: `buyer_name` (or `name` / `full_name`), `buyer_email` (or `email`), `phone`, `deal_slug` (or `page_url`)
3. CRM validates `Authorization: Bearer <NDA_WEBHOOK_SECRET>` header (NOT an HMAC signature — it's a shared bearer token)
4. CRM matches the deal against the `atm_deals` table by slug/name, falling back to the single deal in `stage = 'listed'` if there's only one
5. CRM writes to Supabase:
   - Generates a 48-char hex token (`crypto.randomBytes(24)`)
   - Inserts into `deal_tokens` (this is what the Deal Hub reads to validate access)
   - Inserts into `deal_buyer_access` (buyer name / email / phone tied to the token)
   - Token `expires_at` is set to **10 years** from creation — effectively non-expiring
6. CRM calls Resend API directly via `fetch` (no SDK) to send the Deal Room email containing the tokenized link `${APP_URL}/deals/${token}`
7. CRM logs the event to `atm_activity_log` (`type = 'nda_signed'`) and creates a row in `atm_notifications` for John
8. Buyer clicks link → lands on `/deals/[token]` with token validated against Supabase
9. Admin panel shows new NDA submission via the notification

### How to verify it's working end-to-end

```bash
# 1. Submit a test NDA via the form on atmbrokerage.com (use a test email)
# 2. Check Resend dashboard: https://resend.com/emails
#    → confirm email was sent, check status (delivered / bounced / etc.)
# 3. Check Supabase deal_tokens + deal_buyer_access tables for the new row
#    (and atm_activity_log for a 'nda_signed' entry)
# 4. Click the email link → confirm Deal Room loads at /deals/<token>
```

### Common failure modes

| Symptom | Likely cause | How to check | Fix |
|---|---|---|---|
| Email never sends | Resend API key invalid/rotated, or `RESEND_KEY` falsy | Vercel env vars + Resend dashboard | Rotate key, update Vercel env, redeploy |
| Email sends but link 404s | Token not written to `deal_tokens` | Supabase `deal_tokens` table for recent rows | Check `/api/nda-webhook` logs in Vercel |
| Deal Room loads but shows wrong/no deal | Deal-matching fallback didn't find a unique listed deal | `atm_deals` rows with `stage = 'listed'` — must be exactly 1 if `deal_slug` doesn't match | Pass `deal_slug` from WP form, or adjust matching logic |
| Email lands in spam | SPF/DKIM/DMARC issue on `atmbrokerage.com` (sender is `info@atmbrokerage.com`) | Use mail-tester.com on sending email | Verify DNS records at Name.com |
| Webhook 401 | Bearer token mismatch — WP sending wrong/missing `Authorization: Bearer <secret>` header | Vercel function logs for `/api/nda-webhook` | Re-sync `NDA_WEBHOOK_SECRET` between WP form and Vercel env |
| Webhook 400 (`buyer_email required`) | WP form not sending email field, or sending under unexpected key | Vercel logs + inspect WP form payload | Form should send `buyer_email`, `email`, or `full_name` |
| Webhook 500 | DB write failed (schema change, RLS, missing table) | Vercel logs + Supabase logs | Check recent migrations / RLS policies on `deal_tokens`, `deal_buyer_access`, `atm_activity_log`, `atm_notifications` |
| Form submits but nothing happens | Webhook not firing from WordPress | Browser network tab on form submit | Check WP form plugin settings, webhook URL is `/api/nda-webhook` |

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
2. **Vercel function logs** — filter to `/api/nda-webhook` for the time window
3. **Supabase logs + `deal_tokens` / `deal_buyer_access` / `atm_activity_log` tables** — was the row written?
4. **WordPress form settings** — is the webhook URL still `/api/nda-webhook`? Is the `Authorization: Bearer <secret>` header still set? Did someone update the form?

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

---

## Inbound queue (added Sept 2026)

Every inquiry gets a row in `inbound_items`, an owner and a reply deadline.

- **Trigger:** Supabase `pg_cron` job `inbox-every-15-min` POSTs to `/api/cron/inbox` with header `x-cron-secret` (= `CRON_SECRET`). Responses land in `net._http_response`.
- **Input:** emails already synced into `atm_activity_log` by `gmail_sync.py` (cron on Jeff's Mac, every 30 min; info@ only). Plus unanswered deal-room escalations from `deal_questions`.
- **Classifier:** `lib/inbox/classify.js`. Obvious automated senders are closed without an AI call. Mail from our own domains is still read (forwarded leads, Drift contacts) unless it's a system report.
- **Deadlines:** `lib/inbox/sla.js`, in business hours (Mon–Fri 9–5 ET).
- **Reply detection:** an `email_sent` in the same Gmail thread marks the item replied. Deal-room items clear when answered in the deal room.
- **UI:** `/queue` ("📥 Inbound" tab). John's 9am digest lists waiting and overdue items.

### BizBuySell auto-reply (Google Apps Script, not in this repo)

- **Where:** script.google.com, signed in as info@atmbrokerage.com, project "BizBuySell Auto Reply", function `autoReplyBizBuySellLeads`, time trigger every 15 min.
- **What:** searches `subject:"Your Business-for-sale listing" newer_than:1d`, pulls the buyer's email from the lead body, and sends a NEW email "NDA & Deal Room Access – ATM Listings" linking to https://atmbrokerage.com/atm-routes-for-sale/ (sign NDA → deal room). It de-dupes with message IDs in Script Properties.
- **How the queue uses it:** the cron pairs each BizBuySell lead with the auto-reply sent within 45 min of it. It stores the buyer's address in `lead_email` and moves the lead to `awaiting_nda` (3 business days). When that email shows up in `deal_buyer_access`, the lead is marked converted. If it doesn't, the lead goes overdue and John follows up personally.
- **Buyer replies** to the auto-reply ("Re: NDA & Deal Room Access") come into info@ as normal buyer questions.
- **If it breaks:** check the trigger and the Executions tab in Apps Script. The queue will show BizBuySell leads stuck in "Needs reply" instead of "Awaiting NDA".

## Due Diligence (added Sept 2026)

- **Tables:** `dd_checklist_items` (per vertical, with a `visibility` of public / nda / internal), `route_dd_items`, `dd_touches`, `route_dd_flags`, `dd_seller_requests`. **Views:** `v_route_dd_items`, `v_route_dd_score`.
- **UI:** `/dd` (queue) and `/dd/[slug]` (checklist, contradictions, seller email, badge preview).
- **Buyer questions → DD:** the classifier tags DD item keys, and `dd_note_buyer_ask()` counts them. Routes with open items buyers ask about rank higher.
- **Public badge:** `/api/public/dd/[DL-number or slug]` + `public/dd-badge.js`. It's off per listing (`atm_routes.dd_badge_enabled`) until switched on.
