import { adminDb as db, getUser, unauthorized } from "../../../../lib/serverAuth";

export const dynamic = "force-dynamic";

// Strategic partners per brand: companies that talk to owners every day and can refer sellers, buyers
// and ExitsIQ clients. Stored in atm_master_contacts with contact_type = 'strategic_partner' and a
// vertical tag (ATM, Vending, Cleaning).
const TAG = { atm: "ATM", vending: "Vending", cleaning: "Cleaning" };

// GET /api/admin/partners?vertical=all|atm|vending|cleaning&q=
export async function GET(request) {
  if (!(await getUser(request))) return unauthorized();
  const params = new URL(request.url).searchParams;
  const slug = (params.get("vertical") || "all").toLowerCase();
  const search = (params.get("q") || "").trim().toLowerCase();

  let q = db.from("atm_master_contacts")
    .select("id, first_name, last_name, email, phone, company, title, source_url, tags, status, last_contacted_at, last_replied_at")
    .eq("contact_type", "strategic_partner")
    .order("company", { ascending: true })
    .limit(1000);
  if (TAG[slug]) q = q.contains("tags", [TAG[slug]]);
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const bySlug = Object.fromEntries(Object.entries(TAG).map(([k, v]) => [v, k]));
  let rows = (data || []).map((r) => ({
    ...r,
    name: [r.first_name, r.last_name].filter(Boolean).join(" ") || null,
    verticals: (r.tags || []).map((t) => bySlug[t]).filter(Boolean),
  }));
  if (search) rows = rows.filter((p) => [p.name, p.email, p.company, p.title, p.phone].some((v) => (v || "").toLowerCase().includes(search)));
  return Response.json({ total: rows.length, partners: rows });
}
