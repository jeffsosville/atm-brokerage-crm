import { adminDb as db } from "../../../../../lib/serverAuth";
import { buildPublicDD } from "../../../../../lib/ddPublic";

// Public, read-only transparency data for one listing. No seller details,
// sources, notes or contradictions ever leave this endpoint.
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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

  return json(await buildPublicDD(route.id, route.title));
}
