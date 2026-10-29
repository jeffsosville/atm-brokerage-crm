import { adminDb as db, getUser, unauthorized } from "../../../../lib/serverAuth";
import { verticalFromRequest, verticalMaps } from "../../../../lib/verticalServer";
import { isOwnAddress, personEmailFor } from "../../../../lib/ownAddresses";
import { mailboxes, itemLinks } from "../../../../lib/mailboxes";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const OPEN = ["new", "drafted", "awaiting_john", "awaiting_nda"];
const NEEDS_REPLY = ["new", "drafted", "awaiting_john"];
const SKIP_KINDS = ["internal", "automated", "spam", "vendor"];
const PAGE = 2000;
const INB_COLS = "id, lead_email, from_email, lead_name, from_name, lead_phone, lead_business, kind, status, source, received_at, vertical_id, due_at, priority, summary, subject, snippet, route_id, thread_id, draft_text, draft_error, draft_notes, draft_mailbox, draft_pushed_at, draft_thread_id, mailbox, must_go_to_john, suggested_action, updated_at, first_response_at";

// GET /api/admin/people?vertical=all|atm|vending|cleaning&type=all|buyers|sellers|open|nda|done&list=all|subscribed|not_subscribed|unsubscribed&q=
// Everyone who has dealt with a brand — NDA signers, deal-room buyers, and inbound leads —
// merged into one row per email address.
export async function GET(request) {
  if (!(await getUser(request))) return unauthorized();
  const params = new URL(request.url).searchParams;
  const type = params.get("type") || "all";
  const list = params.get("list") || "all"; // all | subscribed | not_subscribed | unsubscribed
  const search = (params.get("q") || "").trim().toLowerCase();
  const vert = await verticalFromRequest(request);
  const { slugById } = await verticalMaps();

  // Older ATM rows predate vertical tagging, so for ATM an empty vertical also counts
  const scope = (q) => {
    if (!vert) return q;
    return vert.slug === "atm" ? q.or(`vertical_id.eq.${vert.id},vertical_id.is.null`) : q.eq("vertical_id", vert.id);
  };

  const [nda, tok, inb, subs] = await Promise.all([
    scope(db.from("nda_signatures").select("email, name, phone, company, listing_slug, signed_at, vertical_id"))
      .not("email", "is", null).order("signed_at", { ascending: false }).limit(PAGE),
    scope(db.from("deal_tokens").select("buyer_email, buyer_name, buyer_phone, buyer_company, source_listing_slug, signed_at, created_at, first_viewed_at, vertical_id"))
      .not("buyer_email", "is", null).order("created_at", { ascending: false }).limit(PAGE),
    scope(db.from("inbound_items").select(INB_COLS))
      .not("kind", "in", `(${SKIP_KINDS.join(",")})`).neq("status", "not_a_lead").order("received_at", { ascending: false }).limit(PAGE),
    (vert ? db.from("newsletter_subscriptions").select("email, vertical, status, role, source, first_name, subscribed_at, unsubscribed_at, updated_at").eq("vertical", vert.slug)
      : db.from("newsletter_subscriptions").select("email, vertical, status, role, source, first_name, subscribed_at, unsubscribed_at, updated_at"))
      .order("updated_at", { ascending: false }).limit(PAGE),
  ]);
  // Everything still waiting on us, however old, so the reply list is never cut off by the 2,000-row page
  const openQ = await scope(db.from("inbound_items").select(INB_COLS)).not("kind", "in", `(${SKIP_KINDS.join(",")})`).in("status", NEEDS_REPLY).limit(2000);
  if (openQ.error) return Response.json({ error: openQ.error.message }, { status: 500 });
  const seenInb = new Set((inb.data || []).map((i) => i.id));
  inb.data = [...(inb.data || []), ...(openQ.data || []).filter((i) => !seenInb.has(i.id))];
  for (const r of [nda, tok, inb, subs]) if (r.error) return Response.json({ error: r.error.message }, { status: 500 });

  const people = new Map();
  const get = (email) => {
    const e = (email || "").trim().toLowerCase();
    if (!e || !e.includes("@") || isOwnAddress(e)) return null; // forwards from our own mailboxes are not people
    if (!people.has(e)) people.set(e, { email: e, name: null, phone: null, company: null, verticals: new Set(), roles: new Set(), listings: new Set(), ndas: 0, deal_room: false, open_items: 0, sources: new Set(), lists: {}, last_at: null, first_at: null });
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
  const unmatched = []; // waiting on us, but no outside address to hang it on
  for (const i of inb.data || []) {
    const p = get(personEmailFor(i));
    if (!p) { if (NEEDS_REPLY.includes(i.status)) unmatched.push(i); continue; }
    p.name ||= i.lead_name || i.from_name; p.phone ||= i.lead_phone; p.company ||= i.lead_business;
    p.verticals.add(vslug(i.vertical_id)); p.roles.add(i.kind === "seller_lead" ? "seller" : "buyer");
    p.sources.add({ website_form: "Website", marketplace: "BizBuySell", email: "Email", drift_chat: "Chat", cold_call: "Cold call", deal_room: "Deal room" }[i.source] || i.source);
    if (OPEN.includes(i.status)) p.open_items++;
    if (i.status === "awaiting_nda") { p.awaiting_nda = (p.awaiting_nda || 0) + 1; if (!p.nda_what) p.nda_what = i.summary || i.subject || null; }
    if (i.status === "replied") { const t = i.first_response_at || i.updated_at; if (t && (!p.last_done_at || t > p.last_done_at)) { p.last_done_at = t; p.done_what = i.summary || i.subject || null; } }
    if (NEEDS_REPLY.includes(i.status)) {
      p.needs_reply = (p.needs_reply || 0) + 1;
      if (i.priority === "high") p.high = true;
      if (i.due_at && (!p.next_due || i.due_at < p.next_due)) { p.next_due = i.due_at; p.next_what = i.summary || i.subject || null; p.next_kind = i.kind; }
    }
    touch(p, i.received_at);
  }

  for (const n of subs.data || []) {
    const p = get(n.email); if (!p) continue;
    p.name ||= n.first_name;
    p.verticals.add(n.vertical); p.roles.add(n.role === "seller" ? "seller" : "buyer");
    p.lists[n.vertical] = n.status;
    if (n.status === "subscribed") p.sources.add("Weekly email");
    touch(p, n.subscribed_at || n.updated_at);
  }

  let rows = [...people.values()].map((p) => ({
    ...p, verticals: [...p.verticals], roles: [...p.roles], listings: [...p.listings], sources: [...p.sources],
  }));
  if (search) rows = rows.filter((p) => [p.email, p.name, p.company, p.phone].some((v) => (v || "").toLowerCase().includes(search)));
  const onList = (p) => (vert ? p.lists[vert.slug] === "subscribed" : Object.values(p.lists).includes("subscribed"));
  const offList = (p) => (vert ? p.lists[vert.slug] === "unsubscribed" : Object.values(p.lists).includes("unsubscribed") && !onList(p));
  const counts = { subscribed: rows.filter(onList).length, all: rows.length, buyers: rows.filter((p) => p.roles.includes("buyer")).length, sellers: rows.filter((p) => p.roles.includes("seller")).length, open: rows.filter((p) => p.needs_reply > 0).length, nda: rows.filter((p) => p.awaiting_nda > 0 && !p.needs_reply).length, overdue: rows.filter((p) => p.next_due && p.next_due < new Date().toISOString()).length };
  if (list === "subscribed") rows = rows.filter(onList);
  if (list === "not_subscribed") rows = rows.filter((p) => !onList(p) && !offList(p));
  if (list === "unsubscribed") rows = rows.filter(offList);
  if (type === "buyers") rows = rows.filter((p) => p.roles.includes("buyer"));
  if (type === "sellers") rows = rows.filter((p) => p.roles.includes("seller"));
  if (type === "open") {
    // The reply queue: people with something waiting on us, most overdue first
    rows = rows.filter((p) => p.needs_reply > 0);
    rows.sort((a, b) => (b.high ? 1 : 0) - (a.high ? 1 : 0) || (a.next_due || "9").localeCompare(b.next_due || "9"));
  } else if (type === "nda") {
    // BizBuySell and other leads that got the NDA link and haven't signed yet
    rows = rows.filter((p) => p.awaiting_nda > 0 && !p.needs_reply);
    rows.sort((a, b) => (b.last_at || "").localeCompare(a.last_at || ""));
  } else if (type === "done") {
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    rows = rows.filter((p) => p.last_done_at && p.last_done_at > since && !p.needs_reply);
    rows.sort((a, b) => b.last_done_at.localeCompare(a.last_done_at));
  } else rows.sort((a, b) => (b.last_at || "").localeCompare(a.last_at || ""));

  const rIds = [...new Set(unmatched.map((i) => i.route_id).filter(Boolean))];
  const { data: rts } = rIds.length ? await db.from("atm_routes").select("id, slug, title").in("id", rIds) : { data: [] };
  const rmap = Object.fromEntries((rts || []).map((r) => [r.id, r]));
  unmatched.sort((a, b) => (a.due_at || "9").localeCompare(b.due_at || "9"));
  counts.open += unmatched.length;

  return Response.json({
    total: rows.length, counts, people: rows.slice(0, 500),
    unmatched: type === "open" ? await (async () => { const boxes = await mailboxes(); return unmatched.map((i) => ({ ...i, ...itemLinks(boxes, i), route: rmap[i.route_id] || null, vertical: slugById[i.vertical_id] || null })); })() : [],
  });
}
