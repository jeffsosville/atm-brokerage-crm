import { adminDb as db } from "./serverAuth";

const PUBLIC_STATE = {
  verified: "verified", received: "provided", partial: "partial", filled_unsourced: "partial",
  requested: "requested", missing: "pending", open: "pending", declined: "not_provided",
};

// What a buyer would see on the listing page. Never includes seller details,
// sources, notes or contradictions; values only for listing-level items once verified.
export async function buildPublicDD(routeId, title) {
  const [{ data: score }, { data: items }] = await Promise.all([
    db.from("v_route_dd_score").select("dd_score").eq("route_id", routeId).maybeSingle(),
    db.from("v_route_dd_items").select("item_key, section, label, sort_order, state, visibility, answer_text, updated_at").eq("route_id", routeId).order("sort_order"),
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
    sec.items.push({ label: it.label, status, value: it.visibility === "public" && status === "verified" ? it.answer_text : undefined });
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { listing: title, score: Number(score?.dd_score ?? 0), total, counts, sections, updated_at: updated };
}
