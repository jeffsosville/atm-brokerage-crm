import { adminDb as db, getUser, unauthorized } from "../../../../lib/serverAuth";
import { verticalMaps } from "../../../../lib/verticalServer";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const OPEN = ["new", "drafted", "awaiting_john", "awaiting_nda"];
const SRC = { website_form: "Website form", marketplace: "BizBuySell", email: "Email", drift_chat: "Website chat", cold_call: "Cold call", deal_room: "Deal room", listing: "Listing page", nda: "NDA", instantly: "Instantly" };

const clip = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
const gmailLink = (threadId, addrs) => threadId
  ? `https://mail.google.com/mail/u/?authuser=${/john@atmbrokerage\.com/i.test(addrs || "") ? "john" : "info"}@atmbrokerage.com#all/${threadId}`
  : null;

// GET /api/admin/person?email=x — one person: who they are, what is waiting on us, and every touch, newest first.
export async function GET(request) {
  if (!(await getUser(request))) return unauthorized();
  const email = (new URL(request.url).searchParams.get("email") || "").trim().toLowerCase();
  if (!email.includes("@")) return Response.json({ error: "email required" }, { status: 400 });
  const { slugById } = await verticalMaps();
  const like = email.replace(/[%_,()]/g, "");

  const { data: ce } = await db.from("contact_emails").select("contact_id").eq("email", email).maybeSingle();
  const contactId = ce?.contact_id || null;

  const actFilter = [`from_email.ilike.${like}`, `to_email.ilike.%${like}%`];
  if (contactId) actFilter.push(`contact_id.eq.${contactId}`);

  const [contact, acts, inb, nda, tok, inst, subs] = await Promise.all([
    contactId ? db.from("atm_contacts").select("id, name, first_name, last_name, phone, company_id, atm_companies(company_name)").eq("id", contactId).maybeSingle() : { data: null },
    db.from("atm_activity_log").select("id, type, direction, from_email, to_email, subject, snippet, thread_id, created_at")
      .or(actFilter.join(",")).in("type", ["email_received", "email_sent"]).order("created_at", { ascending: false }).limit(150),
    db.from("inbound_items").select("*").or(`lead_email.ilike.${like},from_email.ilike.${like},summary.ilike.%${like}%,snippet.ilike.%${like}%`).order("received_at", { ascending: false }).limit(100),
    db.from("nda_signatures").select("id, name, phone, company, listing_slug, signed_at, vertical_id").ilike("email", like).order("signed_at", { ascending: false }).limit(100),
    db.from("deal_tokens").select("id, token, buyer_name, buyer_phone, buyer_company, source_listing_slug, created_at, first_viewed_at, last_viewed_at, view_count, revoked_at, vertical_id").ilike("buyer_email", like).order("created_at", { ascending: false }).limit(100),
    db.from("instantly_events").select("id, event_type, received_at, payload").ilike("lead_email", like).order("received_at", { ascending: false }).limit(100),
    db.from("newsletter_subscriptions").select("vertical, status, subscribed_at, unsubscribed_at, updated_at").ilike("email", like),
  ]);
  for (const r of [acts, inb, nda, tok, inst, subs]) if (r.error) return Response.json({ error: r.error.message }, { status: 500 });

  const items = inb.data || [];
  const routeIds = [...new Set(items.map((i) => i.route_id).filter(Boolean))];
  const { data: routes } = routeIds.length ? await db.from("atm_routes").select("id, slug, title").in("id", routeIds) : { data: [] };
  const rmap = Object.fromEntries((routes || []).map((r) => [r.id, r]));

  const tokens = tok.data || [];
  const { data: views } = tokens.length
    ? await db.from("file_access_logs").select("token, accessed_at").in("token", tokens.map((t) => t.token)).order("accessed_at", { ascending: false }).limit(500)
    : { data: [] };

  const timeline = [];
  const add = (e) => { if (e.at) timeline.push(e); };

  // Emails both ways. Threads that became a queue item still show here; the item itself is pinned above.
  for (const a of acts.data || []) {
    const out = a.type === "email_sent";
    add({ at: a.created_at, type: out ? "email_out" : "email_in", title: a.subject || "(no subject)", detail: clip(a.snippet, 220),
      who: out ? a.to_email : a.from_email, link: gmailLink(a.thread_id, `${a.from_email} ${a.to_email}`) });
  }
  // Leads that didn't arrive as an email we already list (forms, BizBuySell, chat, deal room, cold calls)
  for (const i of items) {
    if (i.source === "email") continue;
    add({ at: i.received_at, type: "lead", title: `${SRC[i.source] || i.source}: ${i.summary || i.subject || "inquiry"}`, detail: clip(i.snippet, 220),
      vertical: slugById[i.vertical_id] || null, route: rmap[i.route_id] || null });
  }
  for (const n of nda.data || []) add({ at: n.signed_at, type: "nda", title: "Signed NDA" + (n.listing_slug ? `: ${n.listing_slug}` : ""), vertical: slugById[n.vertical_id] || null });
  for (const t of tokens) {
    add({ at: t.created_at, type: "deal_room", title: "Deal room link sent" + (t.source_listing_slug ? `: ${t.source_listing_slug}` : ""), detail: t.revoked_at ? "Access revoked" : null, vertical: slugById[t.vertical_id] || null });
    if (t.first_viewed_at) add({ at: t.first_viewed_at, type: "deal_room", title: "Opened the deal room" + (t.source_listing_slug ? `: ${t.source_listing_slug}` : ""), detail: t.view_count ? `${t.view_count} views total` : null });
  }
  // File views, one line per day so a document binge doesn't flood the timeline
  const byDay = {};
  for (const v of views || []) { const d = v.accessed_at.slice(0, 10); byDay[d] = byDay[d] || { at: v.accessed_at, n: 0 }; byDay[d].n++; }
  for (const d of Object.values(byDay)) add({ at: d.at, type: "file_view", title: `Viewed ${d.n} deal-room file${d.n > 1 ? "s" : ""}` });
  for (const e of inst.data || []) add({ at: e.received_at, type: "instantly", title: "Instantly: " + String(e.event_type || "").replace(/_/g, " "), detail: clip(e.payload?.reply_text || e.payload?.reply_subject || e.payload?.campaign_name, 200) });
  for (const s of subs.data || []) add({ at: s.status === "unsubscribed" ? s.unsubscribed_at || s.updated_at : s.subscribed_at || s.updated_at, type: "newsletter", title: `Weekly email (${s.vertical}): ${s.status}`, vertical: s.vertical });

  timeline.sort((a, b) => b.at.localeCompare(a.at));

  const firstOf = (k) => [contact.data && k === "name" ? contact.data.name || [contact.data.first_name, contact.data.last_name].filter(Boolean).join(" ") : null,
    ...items.map((i) => ({ name: i.lead_name || i.from_name, phone: i.lead_phone, company: i.lead_business })[k]),
    ...(nda.data || []).map((n) => n[k]), ...tokens.map((t) => ({ name: t.buyer_name, phone: t.buyer_phone, company: t.buyer_company })[k])].find(Boolean) || null;

  const verticals = new Set();
  [...items, ...(nda.data || []), ...tokens].forEach((x) => x.vertical_id && slugById[x.vertical_id] && verticals.add(slugById[x.vertical_id]));
  (subs.data || []).forEach((s) => verticals.add(s.vertical));

  const listings = [...new Set([...(nda.data || []).map((n) => n.listing_slug), ...tokens.map((t) => t.source_listing_slug), ...items.map((i) => rmap[i.route_id]?.slug)].filter(Boolean))];

  return Response.json({
    person: {
      email, contact_id: contactId,
      name: firstOf("name"), phone: firstOf("phone") || contact.data?.phone || null,
      company: firstOf("company") || contact.data?.atm_companies?.company_name || null,
      verticals: [...verticals], listings,
      seller: items.some((i) => i.kind === "seller_lead"),
      buyer: (nda.data || []).length > 0 || tokens.length > 0 || items.some((i) => ["buyer_question", "data_room", "marketplace_lead", "offer"].includes(i.kind)),
    },
    open: items.filter((i) => OPEN.includes(i.status)).map((i) => ({ ...i, route: rmap[i.route_id] || null, vertical: slugById[i.vertical_id] || null })),
    timeline: timeline.slice(0, 300),
  });
}
