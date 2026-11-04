import { createHash } from "crypto";
import { adminDb as db } from "../../../lib/serverAuth";
import { CHAT_BRANDS, chatTurn, contactFrom, syncInbound, notifyEscalation } from "../../../lib/siteChat";

// Public website chat (the Drift replacement). Called only by our own /chat page, which the
// chat.js widget loads in an iframe on atmbrokerage.com, vendingexits.com and cleaningexits.com.
// The conversation is kept server-side: the browser sends only its new message, never the history.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TURNS_PER_SESSION = Number(process.env.SITE_CHAT_MAX_TURNS || 30);
const MAX_TURNS_PER_IP_HOUR = Number(process.env.SITE_CHAT_IP_TURNS_HOUR || 60);
const MAX_SESSIONS_PER_IP_HOUR = Number(process.env.SITE_CHAT_IP_SESSIONS_HOUR || 10);
const MAX_LEN = 1000;
const OFFICE = "888-430-5535";

const ipHash = (request) => {
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${process.env.CRON_SECRET || process.env.INBOX_CRON_SECRET || "site-chat"}:${ip}`).digest("hex").slice(0, 32);
};
// Only our own sites may be the page the chat runs on (the URL is shown to the model and saved).
const ALLOWED_HOST = /(^|\.)(atmbrokerage|vendingexits|cleaningexits)\.com$|^localhost$|\.vercel\.app$/i;
const cleanPage = (u) => {
  try { const x = new URL(String(u)); return ALLOWED_HOST.test(x.hostname) ? `${x.origin}${x.pathname}` : null; } catch { return null; }
};
const publicMessages = (msgs) => (msgs || []).map((m) => ({ role: m.role, content: m.content }));

// Restore a session's messages when the visitor comes back to the page.
export async function GET(request) {
  const id = new URL(request.url).searchParams.get("session") || "";
  if (!UUID.test(id)) return Response.json({ messages: [] });
  const { data } = await db.from("site_chat_sessions").select("messages, created_at").eq("id", id).maybeSingle();
  if (!data || Date.now() - new Date(data.created_at).getTime() > 7 * 864e5) return Response.json({ messages: [] });
  return Response.json({ messages: publicMessages(data.messages) });
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "bad request" }, { status: 400 }); }
  const { sessionId, visitorId } = body || {};
  const brand = CHAT_BRANDS.includes(body?.brand) ? body.brand : "atm";
  const message = String(body?.message || "").trim().slice(0, MAX_LEN);
  if (!UUID.test(sessionId || "") || !message) return Response.json({ error: "sessionId and message required" }, { status: 400 });

  try {
    const ip = ipHash(request);
    const hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const [{ data: existing }, { data: recent }] = await Promise.all([
      db.from("site_chat_sessions").select("*").eq("id", sessionId).maybeSingle(),
      db.from("site_chat_sessions").select("id, turns").eq("ip_hash", ip).gte("updated_at", hourAgo).limit(200),
    ]);
    const ipTurns = (recent || []).reduce((n, s) => n + (s.turns || 0), 0);
    const limited = (existing?.turns || 0) >= MAX_TURNS_PER_SESSION || ipTurns >= MAX_TURNS_PER_IP_HOUR ||
      (!existing && (recent || []).length >= MAX_SESSIONS_PER_IP_HOUR);
    if (limited) {
      return Response.json({ reply: `Thanks for all the questions! To keep going, email ${brand === "atm" ? "info@atmbrokerage.com" : brand === "vending" ? "info@vendingexits.com" : "hello@cleaningexits.com"} or call ${OFFICE} and the team will help directly.`, limited: true });
    }

    const pageUrl = existing?.page_url || cleanPage(body?.pageUrl);
    const now = new Date().toISOString();
    const history = [...(existing?.messages || []), { role: "user", content: message, at: now }];

    const turn = await chatTurn({ brand: existing?.brand || brand, pageUrl, history });
    history.push({ role: "assistant", content: turn.reply, at: new Date().toISOString() });

    const { email, phone } = contactFrom(history);
    const page = turn.page;
    const session = {
      id: sessionId,
      visitor_id: existing?.visitor_id || (typeof visitorId === "string" ? visitorId.slice(0, 64) : null),
      brand: existing?.brand || brand,
      page_url: pageUrl,
      page_title: existing?.page_title || page?.route?.title || page?.listing?.title || page?.title || null,
      route_id: existing?.route_id || page?.route?.id || null,
      deal_id: existing?.deal_id || page?.route?.deal_id || page?.listing?.crm_deal_id || null,
      ip_hash: ip,
      user_agent: existing?.user_agent || (request.headers.get("user-agent") || "").slice(0, 300),
      messages: history,
      turns: (existing?.turns || 0) + 1,
      intent: turn.intent !== "unknown" ? turn.intent : existing?.intent || "unknown",
      summary: turn.summary || existing?.summary || null,
      lead_name: turn.name || existing?.lead_name || null,
      lead_email: email || existing?.lead_email || null,
      lead_phone: phone || existing?.lead_phone || null,
      escalated: !!(existing?.escalated || turn.escalate),
      escalation_reason: turn.escalate || existing?.escalation_reason || null,
      inbound_item_id: existing?.inbound_item_id || null,
      created_at: existing?.created_at || now,
      updated_at: new Date().toISOString(),
    };

    // A chat with an email or phone becomes a lead in the queue (and gets a drafted follow-up email).
    if (session.lead_email || session.lead_phone) {
      try {
        const hadItem = !!session.inbound_item_id;
        session.inbound_item_id = await syncInbound(session);
        // Alert once: when an escalated chat first gets contact details, or a lead's chat newly escalates.
        const notifyNow = session.escalated && (!hadItem || !existing?.escalated);
        if (notifyNow) await notifyEscalation(session).catch((e) => console.error("[site-chat] notify", e.message));
      } catch (e) {
        console.error("[site-chat] inbound sync", e.message);
      }
    }

    const { error } = await db.from("site_chat_sessions").upsert(session);
    if (error) console.error("[site-chat] save", error.message);

    return Response.json({ reply: turn.reply, haveContact: !!(session.lead_email || session.lead_phone) });
  } catch (err) {
    console.error("[site-chat] error", err);
    return Response.json({ reply: `Sorry, I'm having trouble right now. You can reach the team at ${OFFICE}.`, error: true }, { status: 200 });
  }
}
