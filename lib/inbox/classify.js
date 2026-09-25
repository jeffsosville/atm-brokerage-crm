import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_CLASSIFY_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

// Senders we never need Claude for.
const INTERNAL = /@(atmbrokerage|connectatm|vendingexits|cleaningexits|atmexits|platformbrokerage)\.com$|^jasosville@gmail\.com$/i;
const AUTOMATED = /(no-?reply|donotreply|do-not-reply|notifications?@|mailer|bounce|newsletter|^news@|digest@|updates?@|@team\.semrush|mailchimp|substack|@x\.com$|@(accounts\.)?google\.com$|supabase|vercel|github|calendar|stripe|intuit|quickbooks|linkedin|facebookmail|wordpress|bizscout|dealstream|listingupdate@bizbuysell|account-insights@)/i;
const MARKETPLACE = /^interest@bizbuysell\.com$|@(bizquest|businessesforsale|loopnet)\.com$/i;

export function preFilter(fromEmail = "") {
  const f = fromEmail.trim().toLowerCase();
  if (INTERNAL.test(f)) return { kind: "internal", source: "email" };
  if (MARKETPLACE.test(f)) return { source: "marketplace" }; // still classified, but always a lead
  if (AUTOMATED.test(f)) return { kind: "automated", source: "email" };
  return { source: "email" };
}

const KINDS = ["offer", "seller_lead", "buyer_question", "data_room", "existing_deal", "marketplace_lead", "vendor", "spam", "other"];

// routes: [{ slug, title, dl_number }]
export async function classifyEmail(email, routes, { isMarketplace = false, ddItems = [] } = {}) {
  const ddList = ddItems.map((d) => `${d.item_key}: ${d.label}`).join("\n");
  const routeList = routes.map((r) => `${r.slug} | ${r.title}${r.dl_number ? " | " + r.dl_number : ""}`).join("\n");
  const prompt = `You triage the info@ inbox for ATM Brokerage, which brokers the sale of ATM route businesses (John Sosville is the broker).

Classify this email. kind is exactly one of:
- offer: a buyer making or discussing an offer, LOI, price proposal
- seller_lead: someone who wants to sell an ATM (or vending/cleaning) business, or asks for a valuation
- buyer_question: a buyer asking about a listing (details, financials, locations, financing, a call)
- data_room: NDA signed, data-room access, link not working, re-send the link
- existing_deal: follow-up on a deal already in progress (due diligence, escrow, closing, APA)
- marketplace_lead: a BizBuySell/BizQuest-type lead notification about a buyer inquiry
- vendor: someone selling us a service (SEO, web design, leads, software, machines)
- spam: junk, phishing, mass marketing
- other: anything else
${isMarketplace ? "This came from a marketplace lead service: use marketplace_lead unless it is clearly something else.\n" : ""}
Match the email to one of our listings if it clearly refers to one (by name, city, ATM count, price or DL number). Listings (slug | title | DL number):
${routeList}

Email
From: ${email.from_email}
Subject: ${email.subject || ""}
Body: ${(email.snippet || email.body || "").slice(0, 1500)}

Due-diligence checklist items (key: label). If the sender asks about or requests any of these, list their keys in dd_items; otherwise [].
${ddList}

Reply with ONLY JSON:
{"kind":"buyer_question","route_slug":null,"dd_items":[],"priority":"high|normal|low","from_name":"sender's name if visible, else null","summary":"one line: who wants what","suggested_action":"one line for John","confidence":0.9}
priority high = offer, seller lead, a known buyer with a deadline, or someone upset; low = vendor/spam/other.`;

  const r = await anthropic.messages.create({ model: MODEL, max_tokens: 300, messages: [{ role: "user", content: prompt }] });
  const text = (r.content?.[0]?.text || "").trim().replace(/^```(json)?|```$/g, "").trim();
  const out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  if (!KINDS.includes(out.kind)) out.kind = "other";
  if (!["high", "normal", "low"].includes(out.priority)) out.priority = "normal";
  if (out.route_slug && !routes.some((x) => x.slug === out.route_slug)) out.route_slug = null;
  out.dd_items = cleanKeys(out.dd_items, ddItems);
  return out;
}

const cleanKeys = (keys, ddItems) =>
  [...new Set((Array.isArray(keys) ? keys : []).filter((k) => ddItems.some((d) => d.item_key === k)))];

// Which DD checklist items does a buyer's question touch? Returns an array of item keys.
export async function mapQuestionToDD(question, ddItems) {
  const ddList = ddItems.map((d) => `${d.item_key}: ${d.label}${d.seller_question ? " (" + d.seller_question + ")" : ""}`).join("\n");
  const r = await anthropic.messages.create({
    model: MODEL, max_tokens: 100,
    messages: [{ role: "user", content: `A buyer asked this about an ATM route for sale:\n"${String(question).slice(0, 1200)}"\n\nWhich of these due-diligence checklist items does it ask about? Most questions touch 0–2 items.\n${ddList}\n\nReply with ONLY a JSON array of keys, e.g. ["F3","L1"] or [].` }],
  });
  const t = (r.content?.[0]?.text || "").trim();
  try { return cleanKeys(JSON.parse(t.slice(t.indexOf("["), t.lastIndexOf("]") + 1)), ddItems); } catch { return []; }
}

export const NON_ACTIONABLE = ["automated", "internal", "spam", "vendor"];
