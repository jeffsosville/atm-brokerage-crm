import { adminDb, getUser, unauthorized } from "../../../../lib/serverAuth";

export const dynamic = "force-dynamic";

// GET /api/admin/dd?status=active|pending|all — the DD queue
export async function GET(request) {
  if (!(await getUser(request))) return unauthorized();
  const status = new URL(request.url).searchParams.get("status") || "active";
  let q = adminDb.from("v_route_dd_score").select("*").order("priority_score", { ascending: false });
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ routes: data });
}
