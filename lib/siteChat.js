// Website chat (replaces Drift): what the chat may know, and the hand-offs it can make.
// The chat runs before any NDA, so it only ever sees public information: the listing page itself,
// the listing's price/size/state, and checklist answers that are public and verified.
// Anything deeper lives in the deal room, which the chat reaches by emailing the visitor their own link.
import { adminDb as db } from "./serverAuth";
import { DEAL_HUB } from "./dealHub";
import { BRANDS } from "./brands";
import { buildPublicDD } from "./ddPublic";

const WP = process.env.WP_SITE_URL || "https://atmbrokerage.com";
export const ALERT_TO = (process.env.ESCALATION_NOTIFY || "info@atmbrokerage.com").split(",").map((x) => x.trim()).filter(Boolean);

export const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})\b/;
export function contactFrom(text) {
  const t = String(text || "");
  const email = (t.match(EMAIL_RE) || [])[0]?.toLowerCase() || null;
  const phone = (t.replace(EMAIL_RE, "").match(PHONE_RE) || [])[0]?.trim() || null;
  return { email, phone };
}

const strip = (h = "") => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&#8211;|&#8212;/g, "–").replace(/&#8217;|&#039;/g, "'").replace(/&#0?36;/g, "$").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"')
  .replace(/\[[^\]]{1,80}\]/g, " ").replace(/\s+/g, " ").trim();

const listingUrl = (r) => `${WP}/atm-route-for-sale/${r.wp_slug || r.slug}/`;

// Listing for the page the visitor is on, matched by the website (WordPress) slug.
export async function listingForPage(pageUrl) {
  const slug = String(pageUrl || "").match(/atm-route-for-sale\/([a-z0-9-]+)/i)?.[1]?.toLowerCase();
  if (!slug) return null;
  const cols = "id, slug, wp_slug, title, status, asking_price, terminal_count, location_state, location_display, deal_id, vertical_id";
  let { data } = await db.from("atm_routes").select(cols).eq("wp_slug", slug).maybeSingle();
  if (!data) ({ data } = await db.from("atm_routes").select(cols).eq("slug", slug).maybeSingle());
  return data ? { ...data, url: listingUrl(data) } : null;
}

// The listing page's own text from the website (public by definition), trimmed.
const pageCache = new Map();
export async function listingPageText(route) {
  const slug = route?.wp_slug || route?.slug;
  if (!slug) return "";
  const hit = pageCache.get(slug);
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.text;
  try {
    const r = await fetch(`${WP}/wp-json/wp/v2/portfolio?slug=${encodeURIComponent(slug)}&_fields=content`, { signal: AbortSignal.timeout(5000) });
    const rows = r.ok ? await r.json() : [];
    const text = strip(rows?.[0]?.content?.rendered || "").slice(0, 5000);
    pageCache.set(slug, { at: Date.now(), text });
    return text;
  } catch {
    return "";
  }
}

// Every listing for sale or under contract, so the chat can point buyers at ones that fit.
export async function catalog() {
  const { data } = await db.from("atm_routes")
    .select("slug, wp_slug, title, status, asking_price, terminal_count, location_state")
    .in("status", ["active", "pending"]).order("display_order", { ascending: true, nullsFirst: false });
  return (data || []).map((r) =>
    `- ${r.title}${r.status === "pending" ? " (UNDER CONTRACT)" : ""}${r.terminal_count ? ` · ${r.terminal_count} ATMs` : ""} · ${listingUrl(r)}`
  ).join("\n");
}

// Public, verified checklist answers and the transparency score for one listing.
export async function publicDD(route) {
  if (!route?.id) return "";
  const dd = await buildPublicDD(route.id, route.title).catch(() => null);
  if (!dd || !dd.total) return "";
  const lines = dd.sections.flatMap((s) => s.items.filter((i) => i.value).map((i) => `- ${i.label}: ${i.value} (verified)`));
  return `Transparency score: ${Math.round(dd.score)}% of the due diligence checklist answered by the seller (${Math.round(dd.verified)}% verified by the broker).\n${lines.join("\n")}`;
}

// Deal rooms this email address already has (one per signed NDA).
export async function dealRoomsFor(email) {
  if (!email) return [];
  const { data: toks } = await db.from("deal_tokens").select("token, deal_id, expires_at, revoked_at")
    .ilike("buyer_email", email).is("revoked_at", null).order("created_at", { ascending: false }).limit(10);
  const live = (toks || []).filter((t) => t.deal_id && (!t.expires_at || new Date(t.expires_at) > new Date()));
  if (!live.length) return [];
  const { data: deals } = await db.from("atm_deals").select("id, deal_name, dl_number").in("id", [...new Set(live.map((t) => t.deal_id))]);
  const name = Object.fromEntries((deals || []).map((d) => [d.id, d.deal_name || d.dl_number || "Deal room"]));
  const seen = new Set();
  return live.filter((t) => !seen.has(t.deal_id) && seen.add(t.deal_id)).map((t) => ({ deal_id: t.deal_id, name: name[t.deal_id] || "Deal room", url: `${DEAL_HUB}/deals/${t.token}` }));
}

export async function sendEmail({ from, to, reply_to, subject, html, text }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({ from, to, reply_to, subject, html, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  return r.json();
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// The buyer's own deal room links, sent only to the address they signed the NDA with.
// The chat never shows a link on screen: typing someone else's email must not open their deal room.
export async function emailDealRooms(email, rooms) {
  const b = BRANDS.atm;
  const list = rooms.map((r) => `<li style="margin:6px 0"><a href="${esc(r.url)}">${esc(r.name)}</a></li>`).join("");
  await sendEmail({
    from: "John Sosville <john@atmbrokerage.com>",
    to: [email],
    reply_to: "john@atmbrokerage.com",
    subject: rooms.length > 1 ? "Your deal room links" : `Your deal room: ${rooms[0].name}`,
    html: `<div style="font:15px/1.5 system-ui,sans-serif;color:#1e293b;max-width:560px">
<p>Here ${rooms.length > 1 ? "are your deal room links" : "is your deal room link"}, as requested in chat on ${esc(b.site.replace("https://", ""))}:</p>
<ul>${list}</ul>
<p>The files, the seller's due diligence answers and the deal room assistant are all inside. Reply here with any questions.</p>
<p>John Sosville<br>ATM Brokerage · ${esc("+1 888-430-5535")}</p></div>`,
    text: `Your deal room ${rooms.length > 1 ? "links" : "link"}:\n${rooms.map((r) => `${r.name}: ${r.url}`).join("\n")}\n\nJohn Sosville, ATM Brokerage, +1 888-430-5535`,
  });
}

// Instant alert to the team when the chat hands a visitor off (wants a person, an offer, a seller, a question it can't answer).
export async function alertTeam({ session, reason, transcript, listing }) {
  const who = [session.name, session.email, session.phone].filter(Boolean).join(" · ") || "Visitor (no contact details yet)";
  const queueUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://atm-brokerage-crm.vercel.app"}/queue`;
  await sendEmail({
    from: "ATM Brokerage <notifications@atmbrokerage.com>",
    to: ALERT_TO,
    ...(session.email ? { reply_to: session.email } : {}),
    subject: `Website chat needs you: ${reason}`.slice(0, 120),
    html: `<div style="font:14px/1.5 system-ui,sans-serif;color:#1e293b;max-width:640px">
<p><b>${esc(who)}</b>${listing ? ` on <a href="${esc(listing.url)}">${esc(listing.title)}</a>` : ""}</p>
<p>Why it came to you: ${esc(reason)}</p>
<pre style="white-space:pre-wrap;background:#f1f5f9;padding:12px;border-radius:6px;font:13px/1.45 ui-monospace,monospace">${esc(transcript)}</pre>
<p>${session.email ? "Reply to this email to answer them directly. " : ""}<a href="${queueUrl}">Open the queue</a></p></div>`,
    text: `${who}${listing ? " on " + listing.title : ""}\nWhy: ${reason}\n\n${transcript}\n\nQueue: ${queueUrl}`,
  });
}

export const LABEL = { route_buyer: "Route buyer", route_seller: "Route seller", machine_buyer: "Machine buyer", machine_seller: "Machine seller", other: "Chat lead" };
