import { adminDb as db, requireStaff, unauthorized } from "../../../../lib/serverAuth";

export const dynamic = "force-dynamic";
const VERTS = ["atm", "vending", "cleaning", "pest"];
const who = (s) => s?.user?.email || (s?.internal ? "system" : null);

// GET /api/admin/rules?vertical=all|atm|vending|cleaning → { pending: [...], active: [...] }
export async function GET(request) {
  if (!(await requireStaff(request))) return unauthorized();
  const v = new URL(request.url).searchParams.get("vertical") || "all";
  let q = db.from("draft_rules").select("id, vertical, topic, rule, why, source, status, source_outcome_id, created_at")
    .in("status", ["pending", "active"]).order("created_at", { ascending: false }).limit(200);
  if (v !== "all") q = q.eq("vertical", v);
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ pending: data.filter((r) => r.status === "pending"), active: data.filter((r) => r.status === "active") });
}

// POST { vertical, rule, topic? } — add a rule by hand (active right away)
export async function POST(request) {
  const s = await requireStaff(request);
  if (!s) return unauthorized();
  const b = await request.json().catch(() => ({}));
  const rule = String(b.rule || "").trim();
  if (!VERTS.includes(b.vertical) || rule.length < 10) return Response.json({ error: "vertical and rule required" }, { status: 400 });
  const { data, error } = await db.from("draft_rules").insert({
    vertical: b.vertical, topic: b.topic || null, rule: rule.slice(0, 800), source: "manual",
    status: "active", active: true, decided_by: who(s), decided_at: new Date().toISOString(),
  }).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rule: data });
}

// PATCH { id, action: "approve" | "reject" | "off", rule? } — rule text can be edited on approve
export async function PATCH(request) {
  const s = await requireStaff(request);
  if (!s) return unauthorized();
  const b = await request.json().catch(() => ({}));
  const status = { approve: "active", reject: "rejected", off: "off" }[b.action];
  if (!b.id || !status) return Response.json({ error: "id and action required" }, { status: 400 });
  const patch = { status, active: status === "active", decided_by: who(s), decided_at: new Date().toISOString() };
  if (b.action === "approve" && b.rule && String(b.rule).trim().length >= 10) patch.rule = String(b.rule).trim().slice(0, 800);
  const { data, error } = await db.from("draft_rules").update(patch).eq("id", b.id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rule: data });
}
