import { adminDb as db } from "../../../../lib/serverAuth";
import { buildFollowupDay1, buildFollowupDay2, buildFollowupDay3 } from "../../../../lib/followupEmails";
import { DEAL_HUB } from "../../../../lib/dealHub";

// Hourly NDA follow-up drip for every vertical (ATM, VendingExits, CleaningExits).
// Moved here from atmbrokerage-next so it survives that site being shut down.
// Each step is guarded by its followup_N_sent_at column, so overlapping runs with the
// old atmbrokerage-next cron can't double-send as long as they fire at different minutes.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const APP_URL = DEAL_HUB; // unsubscribe links are buyer-facing too
const RESEND_KEY = process.env.RESEND_API_KEY;

const SENDERS = {
  atm: "John Sosville <john@atmbrokerage.com>",
  vending: "John Sosville <sales@vendingexits.com>",
  cleaning: "John Sosville <hello@cleaningexits.com>",
};

const STEPS = [
  { key: "day1_sent", col: "followup_1_sent_at", from: "first_viewed_at", minH: 24, label: "Day 1 (24h after first view)", build: buildFollowupDay1 },
  { key: "day2_sent", col: "followup_2_sent_at", from: "followup_1_sent_at", minH: 72, label: "Day 2 (3 days after Day 1)", build: buildFollowupDay2 },
  { key: "day3_sent", col: "followup_3_sent_at", from: "followup_2_sent_at", minH: 96, label: "Day 3 (4 days after Day 2)", build: buildFollowupDay3 },
];
const WINDOW_H = 72; // ignore anything older than threshold + 72h so a backlog never blasts

function authorized(request) {
  const secret = process.env.INBOX_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return [bearer, request.headers.get("x-cron-secret"), url.searchParams.get("secret")].includes(secret);
}

let verticalSlugs = null;
async function slugFor(verticalId) {
  if (!verticalSlugs) {
    const { data } = await db.from("verticals").select("id, slug");
    verticalSlugs = Object.fromEntries((data || []).map((v) => [v.id, v.slug]));
  }
  return verticalSlugs[verticalId] || null;
}

async function listingContext(t) {
  let title = null, price = null, vertical = null;
  if (t.source_listing_slug) {
    const { data: r } = await db.from("atm_routes").select("title, asking_price_display, asking_price, vertical_id")
      .eq("slug", t.source_listing_slug).maybeSingle();
    if (r) {
      title = r.title || null;
      price = r.asking_price_display || (r.asking_price ? `$${Number(r.asking_price).toLocaleString()}` : null);
      vertical = await slugFor(r.vertical_id);
    }
  }
  if (t.deal_id) {
    const { data: d } = await db.from("atm_deals").select("deal_name, asking_price, deal_type, vertical_id").eq("id", t.deal_id).maybeSingle();
    if (d) {
      // deal_type is the explicit marker; vertical_id can carry the ATM default on older rows
      vertical = (d.deal_type && d.deal_type.toLowerCase()) || (await slugFor(d.vertical_id)) || vertical;
      if (!title) {
        title = d.deal_name || null;
        price = d.asking_price ? `$${Number(d.asking_price).toLocaleString()}` : null;
      }
    }
  }
  if (!vertical && t.vertical_id) vertical = await slugFor(t.vertical_id);
  vertical = vertical || "atm";
  const fallback = { atm: "ATM Route", vending: "Vending Route", cleaning: "Cleaning Business" }[vertical] || "Listing";
  return { title: title || fallback, price, vertical };
}

async function sendEmail(payload) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function runStep(step, now, summary, dryRun) {
  const newest = new Date(now - step.minH * 36e5).toISOString();
  const oldest = new Date(now - (step.minH + WINDOW_H) * 36e5).toISOString();
  const { data: rows, error } = await db.from("deal_tokens")
    .select("id, token, buyer_name, buyer_email, source_listing_slug, deal_id, vertical_id")
    .is(step.col, null).is("unsubscribed_at", null).eq("status", "active")
    .not("buyer_email", "is", null).not("first_viewed_at", "is", null)
    .not(step.from, "is", null).lte(step.from, newest).gte(step.from, oldest);
  if (error) { summary.errors.push(`${step.label} query: ${error.message}`); return; }

  for (const t of rows || []) {
    try {
      const ctx = await listingContext(t);
      const email = step.build({
        buyer_name: t.buyer_name,
        buyer_email: t.buyer_email,
        listing_title: ctx.title,
        listing_asking_price_display: ctx.price,
        deal_hub_url: `${DEAL_HUB}/deals/${t.token}`,
        unsubscribe_url: `${APP_URL}/api/unsubscribe/${t.token}`,
        vertical: ctx.vertical,
      });
      if (dryRun) { summary.preview.push({ step: step.key, to: t.buyer_email, vertical: ctx.vertical, subject: email.subject }); continue; }

      // Claim the row first so a concurrent run (old cron) can't send the same step.
      const stamp = new Date().toISOString();
      const { data: claimed } = await db.from("deal_tokens").update({ [step.col]: stamp })
        .eq("id", t.id).is(step.col, null).select("id");
      if (!claimed?.length) continue;

      try {
        await sendEmail({
          from: SENDERS[ctx.vertical] || SENDERS.atm,
          to: [t.buyer_email],
          reply_to: "john@atmbrokerage.com",
          subject: email.subject,
          html: email.html,
          text: email.text,
        });
      } catch (e) {
        await db.from("deal_tokens").update({ [step.col]: null }).eq("id", t.id); // release so next run retries
        throw e;
      }

      await db.from("atm_activity_log").insert({
        type: "followup_sent",
        activity_type: "email_outbound",
        subject: `${step.label}: ${email.subject}`,
        body: `Sent to ${t.buyer_email} for listing "${ctx.title}". Token ${t.token.slice(0, 8)}...`,
        source: "nda_followup_cron",
        source_id: t.token,
        metadata: { token: t.token, buyer_email: t.buyer_email, listing_title: ctx.title, vertical: ctx.vertical, email_subject: email.subject, sequence_step: step.key },
      });
      summary[step.key]++;
    } catch (e) {
      summary.errors.push(`${step.label} ${t.token?.slice(0, 8)}: ${e.message}`);
    }
  }
}

async function handler(request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const dryRun = new URL(request.url).searchParams.get("dry") === "1";
  if (!RESEND_KEY && !dryRun) return Response.json({ ok: false, error: "RESEND_API_KEY missing" }, { status: 500 });
  verticalSlugs = null;
  const now = Date.now();
  const summary = { day1_sent: 0, day2_sent: 0, day3_sent: 0, errors: [], preview: [] };
  for (const step of STEPS) await runStep(step, now, summary, dryRun);
  return Response.json({ ok: true, dryRun, ...summary });
}

export const GET = handler;
export const POST = handler;
