import { adminDb as db } from "../../../../../lib/serverAuth";

// Public, read-only transparency data for one listing. No seller details,
// sources, notes or contradictions ever leave this endpoint.
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const PUBLIC_STATE = {
  verified: "verified", received: "provided", partial: "partial", filled_unsourced: "partial",
  requested: "requested", missing: "pending", open: "pending", declined: "not_provided",
};
const json = (body, status = 200, cache = true) => Response.json(body, {
  status, headers: { ...CORS, ...(cache ? { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } : {}) },
});

export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function GET(_request, { params }) {
  const key = decodeURIComponent(params.key || "").trim();
  let route = null;
  if (/^DL-/i.test(key)) {
    const { data: deal } = await db.from("atm_deals").select("id").ilike("dl_number", key).maybeSingle();
    if (deal) ({ data: route } = await db.from("atm_routes").select("id, title, status, dd_badge_enabled").eq("deal_id", deal.id).maybeSingle());
  } else {
    ({ data: route } = await db.from("atm_routes").select("id, title, status, dd_badge_enabled").eq("slug", key).maybeSingle());
  }
  if (!route || route.status !== "active" || route.dd_badge_enabled === false) return json({ error: "not found" }, 404, false);

  const [{ data: score }, { data: items }] = await Promise.all([
    db.from("v_route_dd_score").select("dd_score, n_verified, n_applicable").eq("route_id", route.id).maybeSingle(),
    db.from("v_route_dd_items").select("item_key, section, label, sort_order, state, visibility, answer_text, updated_at").eq("route_id", route.id).order("sort_order"),
  ]);

  const counts = { verified: 0, provided: 0, partial: 0, requested: 0, pending: 0, not_provided: 0 };
  const sections = [];
  let updated = null;
  for (const it of items || []) {
    if (it.visibility === "internal" || it.state === "na") continue;
    const status = PUBLIC_STATE[it.state] || "pending";
    counts[status]++;
    if (it.updated_at && (!updated || it.updated_at > updated)) updated = it.updated_at;
    let sec = sections.find((s) => s.name === it.section);
    if (!sec) sections.push((sec = { name: it.section || "Other", items: [] }));
    sec.items.push({
      label: it.label, status,
      // Only facts meant for the listing page, and only once verified
      value: it.visibility === "public" && status === "verified" ? it.answer_text : undefined,
    });
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return json({
    listing: route.title,
    score: Number(score?.dd_score ?? 0),
    total, counts, sections, updated_at: updated,
  });
}
