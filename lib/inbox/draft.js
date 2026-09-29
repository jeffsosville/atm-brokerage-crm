// Drafts a reply for an Inbound queue item, in John's voice, from what we actually know:
// approved DD checklist answers for that listing, John's past answers (email_qa), NDA status,
// and the email thread. Nothing is ever sent — the draft is saved on the item, and the Mac
// push script (gmail_draft_push.py) puts it in the right Gmail Drafts folder for review.
import Anthropic from "@anthropic-ai/sdk";
import { adminDb as db } from "../serverAuth";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_DRAFT_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const SITE = "https://atmbrokerage.com";
const ANSWERED = ["verified", "received", "partial", "declined", "na"];
export const DRAFT_KINDS = ["buyer_question", "data_room", "existing_deal", "offer", "seller_lead"];
// Never draft to our own team/partners (Henry, Sanny, Chrislie...) or to system notifications (PandaDoc etc.).
const NO_DRAFT = /@(atmbrokerage|connectatm|vendingexits|cleaningexits|atmexits|platformbrokerage|sosvillegroup)\.com$|^jasosville@gmail\.com$|no-?reply|donotreply|notifications?@|@(email\.)?pandadoc\.(net|com)$|docusign|dotloop|hellosign|@calendly\.com$/i;
export const shouldDraft = (item) => DRAFT_KINDS.includes(item.kind) && !NO_DRAFT.test((item.lead_email || item.from_email || "").trim());

const tag = (text, name) => (text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1]?.trim() ?? "";
const clip = (s, n) => (s || "").replace(/\s+\n/g, "\n").trim().slice(0, n);

async function ndaStatus(email, routeId, dealId) {
  if (!email) return { any: false, thisListing: false };
  const e = email.toLowerCase();
  const [{ data: sigs }, { data: access }] = await Promise.all([
    db.from("nda_signatures").select("route_id").eq("email", e).limit(50),
    db.from("deal_buyer_access").select("deal_id").eq("buyer_email", e).limit(50),
  ]);
  const thisListing = (sigs || []).some((s) => routeId && s.route_id === routeId) || (access || []).some((a) => dealId && a.deal_id === dealId);
  return { any: !!(sigs?.length || access?.length), thisListing };
}

async function listingFacts(routeId, includeNda) {
  if (!routeId) return { known: "", missing: "" };
  const { data: items } = await db.from("v_route_dd_items")
    .select("item_key, label, status, state, visibility, answer_text, declined_reason, sort_order")
    .eq("route_id", routeId).order("sort_order");
  const usable = (items || []).filter((i) => i.visibility !== "internal");
  const known = usable.filter((i) =>
    ANSWERED.includes(i.status) && i.state !== "filled_unsourced" && (includeNda || i.visibility === "public") &&
    ((i.answer_text || "").trim() || ["declined", "na"].includes(i.status)));
  const knownKeys = new Set(known.map((i) => i.item_key));
  const fmt = (i) => {
    const a = i.status === "declined" ? `seller declined (${i.declined_reason || "no reason given"})` : i.status === "na" ? "not applicable" : clip(i.answer_text, 400);
    return `${i.item_key} | ${i.label}: ${a}${i.status === "verified" ? " [verified]" : " [from seller, not yet verified]"}`;
  };
  return {
    known: known.map(fmt).join("\n"),
    missing: usable.filter((i) => !knownKeys.has(i.item_key)).map((i) => `${i.item_key} | ${i.label}${i.visibility === "nda" && !includeNda ? " (NDA only)" : ""}`).join("\n"),
  };
}

async function pastAnswers(routeId) {
  const q = db.from("email_qa").select("route_id, topic, question, answer, generic").eq("active", true);
  const { data } = await (routeId ? q.or(`route_id.eq.${routeId},generic.eq.true`) : q.eq("generic", true)).limit(40);
  return (data || []).map((r) => `${r.route_id ? "[this listing] " : "[general] "}Q: ${r.question}\nA: ${r.answer}`).join("\n\n");
}

async function threadText(item) {
  if (item.source === "deal_room") return `BUYER (deal-room question): ${item.snippet}`;
  if (!item.thread_id) return `THEM: ${item.snippet || ""}`;
  const { data } = await db.from("atm_activity_log").select("type, from_email, to_email, body, snippet, created_at")
    .eq("thread_id", item.thread_id).in("type", ["email_received", "email_sent"]).order("created_at", { ascending: false }).limit(6);
  return (data || []).reverse().map((m) =>
    `${m.type === "email_sent" ? "US" : "THEM"} (${m.from_email}, ${new Date(m.created_at).toISOString().slice(0, 10)}):\n${clip(m.body || m.snippet, 2500)}`
  ).join("\n\n---\n\n");
}

function mailboxFor(latestTo) {
  return /john@atmbrokerage\.com/i.test(latestTo || "") ? "john" : "info";
}

export async function draftItem(item) {
  const routeCols = "id, title, wp_slug, slug, status, asking_price";
  const [{ data: route }, latest, { data: deal }] = await Promise.all([
    item.route_id ? db.from("atm_routes").select(routeCols).eq("id", item.route_id).maybeSingle()
      : item.deal_id ? db.from("atm_routes").select(routeCols).eq("deal_id", item.deal_id).limit(1).maybeSingle() : { data: null },
    item.thread_id
      ? db.from("atm_activity_log").select("to_email").eq("thread_id", item.thread_id).eq("type", "email_received").order("created_at", { ascending: false }).limit(1).maybeSingle()
      : { data: null },
    item.deal_id ? db.from("atm_deals").select("deal_name, stage, asking_price").eq("id", item.deal_id).maybeSingle() : { data: null },
  ]);
  const buyerEmail = item.lead_email || item.from_email;
  const nda = item.source === "deal_room" ? { any: true, thisListing: true } : await ndaStatus(buyerEmail, route?.id, item.deal_id);
  const includeNda = item.source === "deal_room" || nda.thisListing;
  const [facts, past, thread] = await Promise.all([listingFacts(route?.id, includeNda), pastAnswers(route?.id), threadText(item)]);

  const mailbox = item.source === "deal_room" ? null : mailboxFor(latest.data?.to_email);
  const listingUrl = route?.wp_slug ? `${SITE}/atm-route-for-sale/${route.wp_slug}/` : `${SITE}/atm-routes-for-sale/`;
  const signoff = mailbox === "info" ? "ATM Brokerage" : "John";

  const prompt = `You draft email replies for John Sosville, the broker at ATM Brokerage (atmbrokerage.com), which sells ATM route businesses. John reviews and edits every draft before anything is sent.

${item.source === "deal_room" ? "This is a question a buyer asked in a listing's Deal Room that the AI concierge couldn't answer. The buyer has signed this listing's NDA and is already in the Deal Room, so never tell them to sign an NDA. Draft the answer that will be posted in the Deal Room for every NDA buyer to see: write as \"we\" (ATM Brokerage), no greeting, no sign-off, and nothing specific to this one buyer." : "Draft John's reply to the latest message from THEM."}

EMAIL TYPE: ${item.kind}${item.summary ? ` — ${item.summary}` : ""}
FROM: ${item.from_name || ""} <${buyerEmail}>
LISTING: ${route ? `${route.title} (status: ${route.status}${route.asking_price ? `, asking $${Number(route.asking_price).toLocaleString()}` : ""}) — ${listingUrl}` : deal ? `${deal.deal_name} (deal stage: ${deal.stage}; not on the website checklist)` : "not identified"}
NDA: ${nda.thisListing ? "signed for this listing (has Deal Room access)" : nda.any ? "signed an NDA for another listing, not this one" : "no NDA on file"}

THREAD (oldest first):
${thread}

APPROVED FACTS FOR THIS LISTING (the only listing facts you may state):
${facts.known || "(none yet)"}

NOT YET KNOWN (checklist items with no approved answer):
${facts.missing || "(n/a)"}

JOHN'S PAST ANSWERS (match his tone and his standard answers; never reuse another listing's specifics):
${past || "(none)"}

HOW JOHN HANDLES THINGS:
- Listing details, financials and documents live in each listing's Deal Room. To get in, the buyer picks the route on the website, signs the NDA at the bottom of the listing (about 30 seconds), and gets instant access. If they have not signed this listing's NDA, send them to ${listingUrl} for that — never attach or paste documents.
- Never share location addresses, merchant names, the seller's identity or contact, contracts or the vaulter/loader before an accepted offer. Say they come later in due diligence.
- If they ask something not in APPROVED FACTS, don't guess or estimate: say you'll get it from the seller (or that it's in the Deal Room if it's an NDA item and they haven't signed).
- Offers, price or terms negotiation, seller financing beyond what's in the facts, or anything legal: acknowledge briefly and say John will follow up personally. Set needs_john to yes.
- Seller leads (someone wanting to sell): thank them, ask for 12 months of processor reports (surcharge, interchange, transaction counts per ATM) and the number of ATMs, and offer a quick call.
- If the listing is pending or sold, say so plainly and offer to send similar listings.
- Plain conversational email, short (usually under 120 words), no bullet points, no subject line.${item.source === "deal_room" ? "" : ` Start with "Hi <first name>," if known, else "Hi,". End with "Best,\\n${signoff}".`}

Reply in exactly this format:
<draft>the reply text</draft>
<needs_john>yes or no</needs_john>
<notes>one line for John: what you couldn't answer or why it needs him (empty if nothing)</notes>
<used>comma-separated item keys from APPROVED FACTS you used</used>
<missing>comma-separated item keys from NOT YET KNOWN that the buyer asked about</missing>`;

  const r = await anthropic.messages.create({ model: MODEL, max_tokens: 1200, messages: [{ role: "user", content: prompt }] });
  const out = r.content.map((c) => c.text || "").join("");
  const draft = tag(out, "draft");
  if (!draft) throw new Error("no draft in model output");
  const keys = (s) => s.split(",").map((k) => k.trim()).filter((k) => /^[A-Za-z0-9_]{1,40}$/.test(k));

  return {
    draft_text: draft,
    must_go_to_john: /^y/i.test(tag(out, "needs_john")) || item.kind === "offer",
    draft_notes: tag(out, "notes") || null,
    dd_items_used: keys(tag(out, "used")),
    dd_items_missing: keys(tag(out, "missing")),
    draft_mailbox: mailbox,
  };
}

// Draft (or redraft) one queue item and save it. Returns the saved fields.
export async function draftAndSave(item) {
  const now = new Date().toISOString();
  if (!shouldDraft(item)) throw new Error("No draft for internal senders or system notifications.");
  try {
    const d = await draftItem(item);
    const patch = { ...d, status: "drafted", draft_generated_at: now, draft_error: null, updated_at: now };
    const { error } = await db.from("inbound_items").update(patch).eq("id", item.id);
    if (error) throw error;
    return patch;
  } catch (err) {
    await db.from("inbound_items").update({ draft_error: String(err.message || err).slice(0, 500), draft_generated_at: now }).eq("id", item.id);
    throw err;
  }
}
