import { adminDb as db } from "../../../../lib/serverAuth";
import { loadSellerRequest, saveSellerAnswer, SELLER_LOCKED, PHONE } from "../../../../lib/sellerPortal";

// Public seller portal API. The token in the URL is the only credential: it is scoped to one
// listing and only reads/writes that listing's checklist. No buyer data, sources, internal notes
// or scores beyond the seller's own progress ever leave this endpoint.
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
// Items written in the broker's voice that read oddly to the seller
const SELLER_WORDING = {
  X1: { label: "Your direct contact", question: "Best email and mobile number to reach you directly." },
  seller_contact: { label: "Your direct contact", question: "Best email and mobile number to reach you directly." },
};
const fail = (error, status = 400) => Response.json({ error }, { status, headers: noStore });

// GET /api/seller/<token> — the checklist as the seller sees it
export async function GET(_request, { params }) {
  const ctx = await loadSellerRequest(params.token);
  if (ctx.error) return fail(ctx.error, ctx.status);
  const { req, route, brand } = ctx;

  const now = new Date().toISOString();
  await db.from("dd_seller_requests")
    .update({ last_seen_at: now, ...(req.opened_at ? {} : { opened_at: now }) })
    .eq("id", req.id);

  const [{ data: items }, { data: score }] = await Promise.all([
    db.from("v_route_dd_items")
      .select("item_key, section, label, seller_question, sort_order, state, answer_text, expected_date, declined_reason, buyer_asks, required, weight")
      .eq("route_id", route.id).order("sort_order"),
    db.from("v_route_dd_score").select("dd_score").eq("route_id", route.id).maybeSingle(),
  ]);

  const list = (items || []).filter((i) => i.state !== "na").map((i) => ({
    key: i.item_key,
    section: i.section || "Details",
    label: SELLER_WORDING[i.item_key]?.label || i.label,
    question: SELLER_WORDING[i.item_key]?.question || i.seller_question || i.label,
    state: i.state,
    locked: SELLER_LOCKED.includes(i.state),
    // Show the seller what we already have so they can confirm or correct it
    answer: ["received", "partial", "filled_unsourced"].includes(i.state) ? i.answer_text || "" : "",
    expected_date: i.expected_date,
    reason: i.state === "declined" ? i.declined_reason || "" : "",
    buyers_asked: i.buyer_asks || 0,
    weight: i.weight,
  }));

  return Response.json({
    listing: { title: route.title, status: route.status },
    seller: { name: req.seller_name || route.seller_contact_name || "" },
    brand: { firm: brand.firm, site: brand.site, accent: brand.accent, email: brand.email, phone: PHONE },
    score: Number(score?.dd_score || 0),
    submitted_at: req.submitted_at,
    expires_at: req.expires_at,
    items: list,
  }, { headers: noStore });
}

// POST /api/seller/<token>
//   { item_key, choice: "answer" | "soon" | "decline", answer_text?, expected_date?, reason? }
//   { action: "done" }  — seller says they're finished for now; John gets an email
export async function POST(request, { params }) {
  const ctx = await loadSellerRequest(params.token);
  if (ctx.error) return fail(ctx.error, ctx.status);
  const { req, route, brand } = ctx;
  const body = await request.json().catch(() => ({}));

  if (body.action === "done") {
    const now = new Date().toISOString();
    await db.from("dd_seller_requests").update({ submitted_at: now, last_seen_at: now }).eq("id", req.id);
    const { data: score } = await db.from("v_route_dd_score")
      .select("dd_score, n_gaps, n_coming_soon, n_declined").eq("route_id", route.id).maybeSingle();
    await db.from("atm_activity_log").insert({
      type: "seller_dd_submitted", activity_type: "note",
      subject: `Seller finished DD checklist: ${route.title}`,
      body: `${req.seller_name || req.seller_email || "Seller"} marked the checklist done. Transparency ${score?.dd_score ?? "?"}% · ${score?.n_coming_soon ?? 0} coming soon · ${score?.n_declined ?? 0} won't provide · ${score?.n_gaps ?? 0} gaps.`,
      source: "seller_portal", source_id: req.id,
      metadata: { route_id: route.id, deal_id: route.deal_id, score: score?.dd_score ?? null },
    }).then(() => {}, () => {});
    await notifyJohn({ req, route, brand, score }).catch((e) => console.error("[seller-portal] notify", e.message));
    return Response.json({ ok: true, score: Number(score?.dd_score || 0) }, { headers: noStore });
  }

  if (!body.item_key) return fail("item_key required");
  try {
    const row = await saveSellerAnswer({
      req, route, item_key: String(body.item_key), choice: body.choice,
      answer_text: body.answer_text, expected_date: body.expected_date, reason: body.reason,
    });
    const { data: score } = await db.from("v_route_dd_score").select("dd_score").eq("route_id", route.id).maybeSingle();
    return Response.json({ ok: true, state: row.status, score: Number(score?.dd_score || 0) }, { headers: noStore });
  } catch (e) {
    return fail(e.message);
  }
}

async function notifyJohn({ req, route, brand, score }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const to = process.env.SELLER_PORTAL_NOTIFY || "info@atmbrokerage.com";
  const crm = (process.env.CRM_URL || "https://atm-brokerage-crm.vercel.app").replace(/\/$/, "");
  const text = `${req.seller_name || req.seller_email || "The seller"} finished the due diligence checklist for "${route.title}".

Transparency score: ${score?.dd_score ?? "?"}%
Coming soon: ${score?.n_coming_soon ?? 0} item(s)
Won't provide: ${score?.n_declined ?? 0} item(s)
Still open: ${score?.n_gaps ?? 0} item(s)

Review and verify: ${crm}/dd/${route.slug}`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `${brand.firm} CRM <info@atmbrokerage.com>`, to: [to], subject: `Seller DD done: ${route.title} (${score?.dd_score ?? "?"}%)`, text }),
  });
}
