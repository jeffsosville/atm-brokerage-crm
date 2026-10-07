import { adminDb as db, getUser, unauthorized } from "../../../../lib/serverAuth";
import { draftAndSave } from "../../../../lib/inbox/draft";
import { verticalFromRequest, verticalMaps } from "../../../../lib/verticalServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const OPEN = ["new", "drafted", "awaiting_john"];
const STATUSES = ["new", "drafted", "awaiting_john", "awaiting_nda", "replied", "closed", "not_a_lead"];
const CHASE = [...OPEN, "awaiting_nda"]; // things someone may need to act on

// GET /api/admin/inbound?view=open|overdue|nda|done|filtered&vertical=all|atm|vending|cleaning&owner=all|jeff|john
export async function GET(request) {
  if (!(await getUser(request))) return unauthorized();
  const params = new URL(request.url).searchParams;
  const view = params.get("view") || "open";
  const owner = (params.get("owner") || "all").toLowerCase();
  const vert = await verticalFromRequest(request);
  const { slugById } = await verticalMaps();
  const nowIso = new Date().toISOString();
  // Same brand/owner scope for the list and every count
  const scope = (x) => { if (vert) x = x.eq("vertical_id", vert.id); if (owner !== "all") x = x.eq("owner", owner); return x; };

  let q = scope(db.from("inbound_items").select("*").limit(300));
  if (view === "open") q = q.in("status", OPEN).order("due_at", { ascending: true, nullsFirst: false });
  else if (view === "overdue") q = q.in("status", CHASE).lt("due_at", nowIso).order("due_at", { ascending: true });
  else if (view === "nda") q = q.eq("status", "awaiting_nda").order("auto_replied_at", { ascending: false });
  else if (view === "done") q = q.in("status", ["replied", "not_a_lead"]).order("updated_at", { ascending: false });
  else q = q.eq("status", "closed").order("received_at", { ascending: false });
  const { data: items, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const routeIds = [...new Set(items.map((i) => i.route_id).filter(Boolean))];
  const { data: routes } = routeIds.length ? await db.from("atm_routes").select("id, slug, title").in("id", routeIds) : { data: [] };
  const rmap = Object.fromEntries((routes || []).map((r) => [r.id, r]));

  const [{ count: openN }, { count: overdueN }, { count: highN }, { count: ndaN }] = await Promise.all([
    scope(db.from("inbound_items").select("id", { count: "exact", head: true }).in("status", OPEN)),
    scope(db.from("inbound_items").select("id", { count: "exact", head: true }).in("status", CHASE).lt("due_at", nowIso)),
    scope(db.from("inbound_items").select("id", { count: "exact", head: true }).in("status", OPEN).eq("priority", "high")),
    scope(db.from("inbound_items").select("id", { count: "exact", head: true }).eq("status", "awaiting_nda")),
  ]);

  return Response.json({
    items: items.map((i) => ({ ...i, route: rmap[i.route_id] || null, vertical: slugById[i.vertical_id] || null })),
    counts: { open: openN || 0, overdue: overdueN || 0, high: highN || 0, nda: ndaN || 0 },
  });
}

// PATCH { id, status?, owner?, notes?, closed_reason? }  or  { id, action: "redraft" }
export async function PATCH(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();
  const b = await request.json().catch(() => ({}));
  if (!b.id) return Response.json({ error: "id required" }, { status: 400 });
  if (b.action === "redraft") {
    const { data: item } = await db.from("inbound_items").select("*").eq("id", b.id).single();
    if (!item) return Response.json({ error: "not found" }, { status: 404 });
    try { return Response.json({ item: { ...item, ...(await draftAndSave(item)) } }); }
    catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
  }
  if (b.status && !STATUSES.includes(b.status)) return Response.json({ error: "bad status" }, { status: 400 });
  const now = new Date().toISOString();
  const patch = { updated_at: now, updated_by: user.email };
  for (const k of ["status", "owner", "notes", "closed_reason"]) if (k in b) patch[k] = b[k] === "" ? null : b[k];
  if (b.status === "replied") {
    await db.from("inbound_items").update({ first_response_at: now }).eq("id", b.id).is("first_response_at", null);
  }
  const { data, error } = await db.from("inbound_items").update(patch).eq("id", b.id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ item: data });
}
