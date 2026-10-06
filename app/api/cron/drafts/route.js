import { adminDb as db } from "../../../../lib/serverAuth";
import { draftAndSave, DRAFT_KINDS, shouldDraft } from "../../../../lib/inbox/draft";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_PER_RUN = Number(process.env.DRAFTS_PER_RUN || 6);
const LOOKBACK_DAYS = Number(process.env.DRAFTS_LOOKBACK_DAYS || 3);
const FORM_LOOKBACK_DAYS = Number(process.env.DRAFTS_FORM_LOOKBACK_DAYS || 14); // website form leads nobody has contacted yet

function authorized(request) {
  const secret = process.env.INBOX_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return [bearer, request.headers.get("x-cron-secret"), url.searchParams.get("secret")].includes(secret);
}

// Every 15 minutes (pg_cron), a few minutes after /api/cron/inbox. Drafts replies for new
// queue items (and redrafts when a new message arrives in the thread). Never sends anything.
async function handler(request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const since = new Date(Date.now() - Math.max(LOOKBACK_DAYS, FORM_LOOKBACK_DAYS) * 864e5).toISOString();
  const emailSince = Date.now() - LOOKBACK_DAYS * 864e5;
  const { data: items, error } = await db.from("inbound_items").select("*")
    .in("status", ["new", "drafted"]).in("kind", DRAFT_KINDS).in("source", ["email", "deal_room", "website_form"])
    .gte("last_message_at", since).order("last_message_at", { ascending: false }).limit(150);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  // The drafter writes as John at ATM Brokerage into info@, so vending/cleaning items stay
  // undrafted (they sit in Jeff's queue) until those brands get their own drafter.
  const { data: atmV } = await db.from("verticals").select("id").eq("slug", "atm").maybeSingle();
  const isAtm = (i) => !i.vertical_id || !atmV || i.vertical_id === atmV.id;
  const todo = (items || []).filter((i) => isAtm(i) && (i.source === "website_form" || new Date(i.last_message_at).getTime() >= emailSince) && shouldDraft(i) && (!i.draft_generated_at || new Date(i.last_message_at) > new Date(i.draft_generated_at))).slice(0, MAX_PER_RUN);
  const stats = { candidates: todo.length, drafted: 0, errors: [] };
  for (let k = 0; k < todo.length; k += 3) {
    await Promise.all(todo.slice(k, k + 3).map(async (i) => {
      try { await draftAndSave(i); stats.drafted++; } catch (e) { stats.errors.push(`${i.id}: ${e.message}`); }
    }));
  }
  return Response.json({ ok: true, ...stats });
}
export const GET = handler;
export const POST = handler;
