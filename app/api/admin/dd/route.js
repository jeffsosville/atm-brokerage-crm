import { adminDb, getUser, unauthorized } from "../../../../lib/serverAuth";
import { verticalFromRequest } from "../../../../lib/verticalServer";

export const dynamic = "force-dynamic";

// GET /api/admin/dd?status=active|pending|all&vertical=all|atm|vending|cleaning — the DD queue
export async function GET(request) {
  if (!(await getUser(request))) return unauthorized();
  const status = new URL(request.url).searchParams.get("status") || "active";
  const vert = await verticalFromRequest(request);
  let q = adminDb.from("v_route_dd_score").select("*").order("priority_score", { ascending: false });
  if (status !== "all") q = q.eq("status", status);
  if (vert) {
    const { data: ids } = await adminDb.from("atm_routes").select("id").eq("vertical_id", vert.id);
    if (!ids?.length) return Response.json({ routes: [] });
    q = q.in("route_id", ids.map((r) => r.id));
  }
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ routes: data });
}
