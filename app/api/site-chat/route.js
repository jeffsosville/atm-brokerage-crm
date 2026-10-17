import Anthropic from "@anthropic-ai/sdk";
import { adminDb as db } from "../../../lib/serverAuth";
import { findConfidential, NEVER_DISCLOSE } from "../../../lib/confidential";
import { PHONE } from "../../../lib/brands";
import {
  contactFrom, listingForPage, listingPageText, catalog, publicDD, dealRoomsFor, emailDealRooms, alertTeam, LABEL,
} from "../../../lib/siteChat";

// Website chat for atmbrokerage.com (replaces Drift). Public endpoint, called by /chat.js on our sites.
//  POST { visitorId, sessionId?, message, page }  -> { sessionId, reply }
//  GET  ?visitorId=&sessionId=                    -> { messages } (to restore the chat on the next page)
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORIGINS = /^https:\/\/(www\.)?(atmbrokerage|vendingexits|cleaningexits|atmexits|sosville)\.(com|co)$|^https:\/\/[a-z0-9-]+\.vercel\.app$|^http:\/\/localhost(:\d+)?$/;
const cors = (req) => {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.test(o) ? o : "https://atmbrokerage.com",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
};
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const MAX_LEN = 1000, MAX_PER_SESSION = 40, MAX_PER_IP_HOUR = 60;

export async function OPTIONS(req) {
  return new Response(null, { status: 204, headers: cors(req) });
}

export async function GET(req) {
  const u = new URL(req.url);
  const visitorId = u.searchParams.get("visitorId") || "", sessionId = u.searchParams.get("sessionId") || "";
  if (!ID_RE.test(visitorId) || !UUID_RE.test(sessionId)) return Response.json({ messages: [] }, { headers: cors(req) });
  const { data: s } = await db.from("chat_sessions").select("id").eq("id", sessionId).eq("visitor_id", visitorId).maybeSingle();
  if (!s) return Response.json({ messages: [] }, { headers: cors(req) });
  const { data } = await db.from("chat_messages").select("role, content, created_at").eq("session_id", s.id)
    .in("role", ["visitor", "assistant", "staff"]).order("id", { ascending: true }).limit(80);
  return Response.json({ messages: data || [] }, { headers: cors(req) });
}

export async function POST(req) {
  const headers = cors(req);
  const fail = (status, error, reply) => Response.json({ error, reply }, { status, headers });
  let body;
  try { body = await req.json(); } catch { return fail(400, "bad json"); }
  const visitorId = String(body.visitorId || "");
  const message = String(body.message || "").trim().slice(0, MAX_LEN);
  const page = String(body.page || "").slice(0, 500);
  if (!ID_RE.test(visitorId) || !message) return fail(400, "visitorId and message required");
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;

  try {
    // Per-address limit across sessions, so the endpoint can't be used as a free AI.
    if (ip) {
      const { data: recent } = await db.from("chat_sessions").select("message_count").eq("ip", ip).gte("last_message_at", new Date(Date.now() - 36e5).toISOString());
      if ((recent || []).reduce((a, r) => a + (r.message_count || 0), 0) >= MAX_PER_IP_HOUR)
        return fail(429, "rate limited", `We've had a lot of messages from you. Please email info@atmbrokerage.com or call ${PHONE}.`);
    }

    // Session: reuse the visitor's own, or start one.
    let session = null;
    if (UUID_RE.test(String(body.sessionId || ""))) {
      ({ data: session } = await db.from("chat_sessions").select("*").eq("id", body.sessionId).eq("visitor_id", visitorId).maybeSingle());
    }
    if (!session) {
      const { data, error } = await db.from("chat_sessions").insert({
        visitor_id: visitorId, site: "atm", first_page: page, last_page: page, ip, user_agent: (req.headers.get("user-agent") || "").slice(0, 300),
      }).select("*").single();
      if (error) throw error;
      session = data;
    }
    if (session.message_count >= MAX_PER_SESSION)
      return fail(429, "session full", `Thanks for all the questions. The fastest way from here is info@atmbrokerage.com or ${PHONE}.`);

    // What we know about the visitor and the page.
    const found = contactFrom(message);
    const patch = { last_page: page, last_message_at: new Date().toISOString(), message_count: session.message_count + 1 };
    if (found.email && found.email !== session.email) patch.email = found.email;
    if (found.phone && !session.phone) patch.phone = found.phone;
    const email = patch.email || session.email;

    let listing = await listingForPage(page);
    if (listing) { patch.route_id = listing.id; patch.deal_id = listing.deal_id || null; patch.vertical_id = listing.vertical_id || null; }
    else if (session.route_id) {
      const { data: r } = await db.from("atm_routes").select("id, slug, wp_slug, title, status, asking_price, terminal_count, location_state, deal_id, vertical_id").eq("id", session.route_id).maybeSingle();
      if (r) listing = { ...r, url: `https://atmbrokerage.com/atm-route-for-sale/${r.wp_slug || r.slug}/` };
    }

    // Visitor who already signed an NDA: send their own deal room links to their own inbox (once per session).
    let roomsNote = "";
    if (email) {
      const rooms = await dealRoomsFor(email).catch(() => []);
      if (rooms.length && !session.deal_links_sent_at) {
        await emailDealRooms(email, rooms).then(() => { patch.deal_links_sent_at = new Date().toISOString(); }).catch((e) => console.error("[site-chat] deal room email", e));
      }
      if (rooms.length) {
        const here = listing?.deal_id && rooms.some((r) => String(r.deal_id) === String(listing.deal_id));
        roomsNote = `This visitor has already signed NDAs and has deal rooms for: ${rooms.map((r) => r.name).join("; ")}. ${patch.deal_links_sent_at || session.deal_links_sent_at ? "Their deal room links have been emailed to " + email + "; tell them to check that inbox (and spam)." : ""}${here ? " That includes the listing on this page, so for detailed questions about it, point them to the deal room assistant." : ""} Never show a link in chat.`;
      }
    }

    await db.from("chat_messages").insert({ session_id: session.id, role: "visitor", content: message, page });
    const { data: hist } = await db.from("chat_messages").select("role, content").eq("session_id", session.id).in("role", ["visitor", "assistant", "staff"]).order("id", { ascending: false }).limit(16);
    const history = (hist || []).reverse();
    const messages = [];
    for (const m of history) {
      const role = m.role === "visitor" ? "user" : "assistant";
      if (messages.length && messages[messages.length - 1].role === role) messages[messages.length - 1].content += "\n\n" + m.content;
      else messages.push({ role, content: m.content });
    }
    while (messages.length && messages[0].role !== "user") messages.shift();

    const [cat, pageText, dd] = await Promise.all([
      catalog().catch(() => ""),
      listing ? listingPageText(listing) : "",
      listing ? publicDD(listing).catch(() => "") : "",
    ]);

    const system = `You are the website assistant for ATM Brokerage (atmbrokerage.com), the largest ATM route brokerage in the U.S. (200+ deals closed since 2012). John Sosville is the broker. You chat with visitors before they have signed any NDA.

WHAT YOU DO
- Buyers: answer questions about ATM routes and our listings, help them find listings that fit (budget, state, size), and get them to sign the NDA on the listing page. Signing takes about 30 seconds and opens that listing's deal room right away, with the files, the seller's due diligence answers and a deal room assistant that can answer detailed questions.
- Sellers (someone who owns ATMs or a route and may sell): this is the most valuable visitor. Ask, one at a time, how many ATMs, which state(s), and roughly what the route nets per month, then get their name, email and best phone so John can call. Don't quote a valuation; John does that.
- Machine buyers or sellers (equipment only, not a route): take what they need and their contact; the team follows up.
- Everyone: early on, and naturally, ask for an email so we can send listings or follow up. Never make answers wait on it.

LISTINGS FOR SALE NOW (title · size · page). Only these exist; never invent listings, prices or numbers:
${cat || "(listing list unavailable)"}

${listing ? `THE VISITOR IS LOOKING AT THIS LISTING: ${listing.title}${listing.status === "pending" ? " (UNDER CONTRACT)" : listing.status === "sold" ? " (SOLD)" : ""}
Page: ${listing.url}
Listing page text:
${pageText || "(not available)"}
${dd ? "\nPublic due diligence summary:\n" + dd : ""}
For anything not on the page (P&Ls, location details, contracts, processor, vault cash), tell them it's in the deal room after the NDA.` : "The visitor is not on a specific listing page."}

${roomsNote}

RULES
1. Use only the information above plus general ATM industry knowledge. If you don't know, say so and offer to have John follow up.
2. ${NEVER_DISCLOSE}
3. Short replies: 1 to 4 sentences, friendly and plain. Plain text only, no markdown. You may include a listing page URL from the list above when recommending a listing. Never include any other link.
4. Never promise a price, a valuation, financing, or a response time.
5. Phone: ${PHONE}. Email: info@atmbrokerage.com.
6. If a visitor gives an email address, never tell them whether it has an NDA or a deal room unless the note above says their links were emailed.

END EVERY REPLY with one line exactly like:
META: {"intent":"route_buyer|route_seller|machine_buyer|machine_seller|other","name":"<visitor's name if they gave it, else empty>"}
If the visitor wants to talk to a person or schedule a call, wants to make an offer, is a seller who has given contact details, or asked something you could not answer, add one more final line:
ESCALATE: <short reason>
Never mention META or ESCALATE otherwise.`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await anthropic.messages.create({
      model: process.env.CHAT_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
      max_tokens: 600,
      system,
      messages,
    });
    let raw = (res.content || []).map((c) => c.text || "").join("").trim();

    const escM = raw.match(/\n?\s*ESCALATE:\s*(.+)\s*$/i);
    const escalation = escM ? escM[1].trim().slice(0, 160) : null;
    if (escM) raw = raw.slice(0, escM.index).trim();
    const metaM = raw.match(/\n?\s*META:\s*(\{.*\})\s*$/i);
    let meta = {};
    if (metaM) { try { meta = JSON.parse(metaM[1]); } catch { /* ignore */ } raw = raw.slice(0, metaM.index).trim(); }
    let reply = raw.replace(/\*\*|__|^#+\s*/gm, "").trim() || `Sorry, I didn't catch that. You can also reach us at ${PHONE}.`;

    const leaks = findConfidential(reply);
    let reason = escalation;
    if (leaks.length) {
      console.warn("[site-chat] blocked reply:", leaks.map((l) => l.kind).join(", "));
      reply = "That detail is shared later in due diligence, through the broker. I've passed your question along so John can follow up.";
      reason = "reply held back: possible " + leaks.map((l) => l.kind).join(", ");
    }

    if (LABEL[meta.intent]) patch.intent = meta.intent;
    if (typeof meta.name === "string" && meta.name.trim() && !session.name) patch.name = meta.name.trim().slice(0, 80);
    if (reason) patch.escalated_at = new Date().toISOString();

    await db.from("chat_messages").insert({ session_id: session.id, role: "assistant", content: reply, page, meta: { intent: meta.intent || null, escalation: reason } });
    const s = { ...session, ...patch };
    await db.from("chat_sessions").update(patch).eq("id", session.id);

    // Into the Inbound queue once there's someone to follow up with (or the chat handed off).
    if (s.email || s.phone || reason) {
      const { data: all } = await db.from("chat_messages").select("role, content, created_at").eq("session_id", session.id).in("role", ["visitor", "assistant", "staff"]).order("id");
      const transcript = (all || []).map((m) => `${new Date(m.created_at).toISOString().slice(0, 16).replace("T", " ")} ${m.role === "visitor" ? "Visitor" : m.role === "staff" ? "Staff" : "Bot"}: ${m.content}`).join("\n");
      const visitorText = (all || []).filter((m) => m.role === "visitor").map((m) => m.content).join(" | ");
      const intent = s.intent || "other";
      const seller = intent.endsWith("seller");
      const row = {
        source: "site_chat", external_id: session.id, thread_id: `chat:${session.id}`,
        from_email: s.email, lead_email: s.email, lead_phone: s.phone, from_name: s.name, lead_name: s.name,
        route_id: s.route_id || null, deal_id: s.deal_id || null,
        subject: `Website chat: ${LABEL[intent]}${listing ? " – " + listing.title : ""}`,
        summary: `Website chat · ${LABEL[intent]}${listing ? " · on: " + listing.title : ""}${reason ? " · needs you: " + reason : ""}`.slice(0, 1000),
        snippet: visitorText.slice(0, 500), transcript, source_url: s.last_page, intent,
        kind: seller ? "seller_lead" : "buyer_question",
        priority: seller || reason ? "high" : "normal",
        must_go_to_john: seller,
        last_message_at: new Date().toISOString(), updated_by: "site-chat",
        suggested_action: reason ? `Follow up: ${reason}` : null,
      };
      if (s.inbound_item_id) {
        await db.from("inbound_items").update(row).eq("id", s.inbound_item_id);
        if (reason) await db.from("inbound_items").update({ status: "new" }).eq("id", s.inbound_item_id).in("status", ["replied", "closed"]);
      } else {
        const { data: item, error } = await db.from("inbound_items").insert({ ...row, status: "new", received_at: session.created_at }).select("id").single();
        if (error) console.error("[site-chat] inbound insert", error);
        else await db.from("chat_sessions").update({ inbound_item_id: item.id }).eq("id", session.id);
      }
      // One alert per hand-off, not one per message while the conversation continues.
      const recentlyAlerted = session.escalated_at && Date.now() - new Date(session.escalated_at).getTime() < 30 * 60e3;
      if (reason && !recentlyAlerted) await alertTeam({ session: s, reason, transcript, listing }).catch((e) => console.error("[site-chat] alert", e));
    }

    return Response.json({ sessionId: session.id, reply }, { headers });
  } catch (err) {
    console.error("[site-chat]", err);
    return fail(500, "error", `Sorry, something went wrong on our end. Please email info@atmbrokerage.com or call ${PHONE}.`);
  }
}
