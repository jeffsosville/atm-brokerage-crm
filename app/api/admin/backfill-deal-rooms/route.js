import crypto from "crypto";
import { adminDb as db } from "../../../../lib/serverAuth";
import { grantDealRoom } from "../../../../lib/grantDealRoom";

// One-off: sends deal room links to buyers whose NDA email never went out (Aug 20 – Oct 21 2026).
// Works the deal_room_backfill queue in small batches. Key = header x-backfill-key, checked
// against the sha256 in ops_secrets ('deal_room_backfill'). POST { limit } — default 20, max 40.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authorized(request) {
  const key = request.headers.get("x-backfill-key") || "";
  if (!key) return false;
  const { data } = await db.from("ops_secrets").select("sha256").eq("name", "deal_room_backfill").maybeSingle();
  if (!data?.sha256) return false;
  const got = crypto.createHash("sha256").update(key).digest("hex");
  return got.length === data.sha256.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(data.sha256));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function POST(request) {
  if (!(await authorized(request))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 40);

  const { data: rows, error } = await db.from("deal_room_backfill")
    .select("*").eq("status", "pending").order("signed_at", { ascending: false }).limit(limit);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results = { sent: 0, skipped: 0, errors: 0 };
  for (const row of rows || []) {
    // Claim the row first so overlapping calls can't send it twice.
    const { data: claimed } = await db.from("deal_room_backfill")
      .update({ status: "sending" }).eq("id", row.id).eq("status", "pending").select("id");
    if (!claimed?.length) continue;

    // Skip anyone who got a link since the queue was built (live NDA path, or John sent one).
    const { data: has } = await db.from("deal_tokens").select("id")
      .eq("deal_id", row.deal_id).ilike("buyer_email", row.email).limit(1);
    if (has?.length) {
      await db.from("deal_room_backfill").update({ status: "skipped", error: "already has a link" }).eq("id", row.id);
      results.skipped++; continue;
    }
    try {
      const r = await grantDealRoom({
        dealId: row.deal_id, email: row.email, name: row.name, phone: row.phone, company: row.company,
        apology: true, notifyTeam: false,
      });
      await db.from("deal_room_backfill").update({ status: "sent", token: r.token, sent_at: new Date().toISOString() }).eq("id", row.id);
      results.sent++;
    } catch (e) {
      await db.from("deal_room_backfill").update({ status: "error", error: String(e.message).slice(0, 500) }).eq("id", row.id);
      results.errors++;
    }
    await sleep(600); // stay under Resend's rate limit
  }
  const { count } = await db.from("deal_room_backfill").select("id", { count: "exact", head: true }).eq("status", "pending");
  return Response.json({ ...results, remaining: count });
}
