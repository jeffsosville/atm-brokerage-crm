import { adminDb as db, getUser, unauthorized } from "../../../../lib/serverAuth";
import { verticalFromRequest, verticalMaps } from "../../../../lib/verticalServer";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const OPEN = ["new", "drafted", "awaiting_john", "awaiting_nda"];
const SKIP_KINDS = ["internal", "automated", "spam", "vendor"];
const PAGE = 2000;

// GET /api/admin/people?vertical=all|atm|vending|cleaning&type=all|buyers|sellers&q=
// Everyone who has dealt with a brand — NDA signers, deal-room buyers, and inbound leads —
// merged into one row per email address.
export async function GET(request) {
  if (!(await getUser(request))) return unauthorized();
  const params = new URL(request.url).searchParams;
  const type = params.get("type") || "all";
  const search = (params.get("q") || "").trim().toLowerCase();
  const vert = await verticalFromRequest(request);
  const { slugById } = await verticalMaps();

  // Older ATM rows predate vertical tagging, so for ATM an empty vertical also counts
  const scope = (q) => {
    if (!vert) return q;
    return vert.slug === "atm" ? q.or(`vertical_id.eq.${vert.id},vertical_id.is.null`) : q.eq("vertical_id", vert.id);
  };

  const [nda, tok, inb] = await Promise.all([
    scope(db.from("nda_signatures").select("email, name, phone, company, listing_slug, signed_at, vertical_id"))
      .not("email", "is", null).order("signed_at", { ascending: false }).limit(PAGE),
    scope(db.from("deal_tokens").select("buyer_email, buyer_name, buyer_phone, buyer_company, source_listing_slug, signed_at, created_at, first_viewed_at, vertical_id"))
      .not("buyer_email", "is", null).order("created_at", { ascending: false }).limit(PAGE),
    scope(db.from("inbound_items").select("id, lead_email, from_email, lead_name, from_name, lead_phone, lead_business, kind, status, source, received_at, vertical_id"))
      .not("kind", "in", `(${SKIP_KINDS.join(",")})`).neq("status", "not_a_lead").order("received_at", { ascending: false }).limit(PAGE),
  ]);
  for (const r of [nda, tok, inb]) if (r.error) return Response.json({ error: r.error.message }, { status: 500 });

  const people = new Map();
  const get = (email) => {
    const e = (email || "").trim().toLowerCase();
    if (!e || !e.includes("@")) return null;
    if (!people.has(e)) people.set(e, { email: e, name: null, phone: null, company: null, verticals: new Set(), roles: new Set(), listings: new Set(), ndas: 0, deal_room: false, open_items: 0, sources: new Set(), last_at: null, first_at: null });
    return people.get(e);
  };
  const touch = (p, at) => {
    if (!at) return;
    if (!p.last_at || at > p.last_at) p.last_at = at;
    if (!p.first_at || at < p.first_at) p.first_at = at;
  };
  const vslug = (id) => slugById[id] || "atm";

  for (const n of nda.data || []) {
    const p = get(n.email); if (!p) continue;
    p.name ||= n.name; p.phone ||= n.phone; p.company ||= n.company;
    p.verticals.add(vslug(n.vertical_id)); p.roles.add("buyer"); p.sources.add("NDA");
    p.ndas++; if (n.listing_slug) p.listings.add(n.listing_slug);
    touch(p, n.signed_at);
  }
  for (const t of tok.data || []) {
    const p = get(t.buyer_email); if (!p) continue;
    p.name ||= t.buyer_name; p.phone ||= t.buyer_phone; p.company ||= t.buyer_company;
    p.verticals.add(vslug(t.vertical_id)); p.roles.add("buyer"); p.sources.add("Deal room");
    if (t.first_viewed_at) p.deal_room = true;
    if (t.source_listing_slug) p.listings.add(t.source_listing_slug);
    touch(p, t.first_viewed_at || t.signed_at || t.created_at);
  }
  for (const i of inb.data || []) {
    const p = get(i.lead_email || i.from_email); if (!p) continue;
    p.name ||= i.lead_name || i.from_name; p.phone ||= i.lead_phone; p.company ||= i.lead_business;
    p.verticals.add(vslug(i.vertical_id)); p.roles.add(i.kind === "seller_lead" ? "seller" : "buyer");
    p.sources.add({ website_form: "Website", marketplace: "BizBuySell", email: "Email", drift_chat: "Chat", cold_call: "Cold call", deal_room: "Deal room" }[i.source] || i.source);
    if (OPEN.includes(i.status)) p.open_items++;
    touch(p, i.received_at);
  }

  let rows = [...people.values()].map((p) => ({
    ...p, verticals: [...p.verticals], roles: [...p.roles], listings: [...p.listings], sources: [...p.sources],
  }));
  if (search) rows = rows.filter((p) => [p.email, p.name, p.company, p.phone].some((v) => (v || "").toLowerCase().includes(search)));
  const counts = { all: rows.length, buyers: rows.filter((p) => p.roles.includes("buyer")).length, sellers: rows.filter((p) => p.roles.includes("seller")).length, open: rows.filter((p) => p.open_items).length };
  if (type === "buyers") rows = rows.filter((p) => p.roles.includes("buyer"));
  if (type === "sellers") rows = rows.filter((p) => p.roles.includes("seller"));
  rows.sort((a, b) => (b.last_at || "").localeCompare(a.last_at || ""));

  return Response.json({ total: rows.length, counts, people: rows.slice(0, 500) });
}
