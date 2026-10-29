// Drafts replies for the non-ATM brands (VendingExits, CleaningExits, and the next vertical).
// Same rules as the ATM drafter: nothing is ever sent, facts come only from what we know,
// confidential details never go out, offers/legal go to John. The difference is the brand:
// sender, site, listing links, NDA link, and what a seller in that industry should send us.
//
// Drafts land in the brand's own Gmail inbox (crm_mailboxes: cleaning = hello@cleaningexits.com,
// vending = info@vendingexits.com) once that inbox is signed in on the sync machine. Until then
// they fall back to info@ with draft_from = the brand address.
import Anthropic from "@anthropic-ai/sdk";
import { adminDb as db } from "../serverAuth";
import { findConfidential, NEVER_DISCLOSE } from "../confidential";
import { BRANDS } from "../brands";
import { tag, clip, ndaStatus, personContext, recentEdits, threadText } from "./draft";
import { brandMailboxKey } from "../mailboxes";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_DRAFT_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const JOHN_DIRECT = "303-517-2568";
const OFFICE = "888-430-5535";

// What changes per industry. Adding a vertical = one entry here plus its row in lib/brands.js.
const PLAYBOOK = {
  vending: {
    sellerAsk: "the number of machines and locations, machine types (snack, drink, combo, micro market), the last 12 months of sales by machine (Nayax, Cantaloupe or other telemetry/cashless reports are ideal), and whether the location agreements are in writing",
    neverShare: "location names or addresses, location agreements, commission splits by location, supplier accounts, and the seller's identity or contact details",
    know: "Vending routes are valued mostly on verified net cash flow, how long locations have been in place, written location agreements, machine age and cashless readiness, and how many hours a week the route takes to run.",
  },
  cleaning: {
    sellerAsk: "the last two to three years of P&Ls or tax returns, current monthly recurring revenue, the number of clients and how concentrated revenue is among the top few, whether clients are on contracts, and staffing (employees vs. 1099, and whether the owner works in the business)",
    neverShare: "client names or addresses, client contracts, employee names or pay, and the seller's identity or contact details",
    know: "Cleaning businesses are valued mostly on recurring revenue under contract, client concentration, staff stability and how much the owner works in the business; commercial accounts usually carry more value than residential.",
  },
};
export const canDraftVertical = (slug) => slug === "atm" || !!PLAYBOOK[slug];

let vertCache = null;
export async function verticalSlug(verticalId) {
  if (!verticalId) return "atm"; // older rows predate vertical tagging; they are ATM
  if (!vertCache) {
    const { data } = await db.from("verticals").select("id, slug");
    vertCache = Object.fromEntries((data || []).map((v) => [v.id, v.slug]));
  }
  return vertCache[verticalId] || null;
}

const money = (n) => (n || n === 0 ? `$${Number(n).toLocaleString()}` : null);

// The listing as the website shows it (inhouse_listings), so the drafter only states public facts.
// Financial detail beyond price/cash flow is NDA-level.
async function brandListing(dealId, vslug) {
  if (!dealId) return null;
  const { data } = await db.from("inhouse_listings")
    .select("slug, status, title, summary, price, cash_flow, monthly_cash_flow, city, state, highlights, equipment, financials, unit_count, unit_label, location_types, hours_per_week")
    .eq("crm_deal_id", dealId).eq("vertical", vslug).maybeSingle();
  return data || null;
}

function listingFacts(l, includeNda) {
  if (!l) return "";
  const list = (x) => (Array.isArray(x) ? x.join("; ") : x && typeof x === "object" ? JSON.stringify(x) : x || "");
  const facts = [
    `Title: ${l.title}`,
    l.city || l.state ? `Location (city/state only): ${[l.city, l.state].filter(Boolean).join(", ")}` : null,
    money(l.price) ? `Asking price: ${money(l.price)}` : null,
    money(l.cash_flow) ? `Annual cash flow: ${money(l.cash_flow)}` : null,
    money(l.monthly_cash_flow) ? `Monthly cash flow: ${money(l.monthly_cash_flow)}` : null,
    l.unit_count ? `${l.unit_label || "Units"}: ${l.unit_count}` : null,
    l.location_types ? `Location types: ${list(l.location_types)}` : null,
    l.hours_per_week ? `Owner hours per week: ${l.hours_per_week}` : null,
    l.summary ? `Summary: ${clip(l.summary, 800)}` : null,
    l.highlights ? `Highlights: ${clip(list(l.highlights), 600)}` : null,
    l.equipment ? `Equipment: ${clip(list(l.equipment), 400)}` : null,
    includeNda && l.financials ? `Financials (NDA): ${clip(list(l.financials), 1200)}` : null,
  ];
  return facts.filter(Boolean).join("\n");
}

export async function draftBrandItem(item, vslug) {
  const b = BRANDS[vslug];
  const play = PLAYBOOK[vslug];
  if (!b || !play) throw new Error(`No brand drafter for ${vslug}`);
  const site = b.site.replace(/\/$/, "");
  const host = site.replace(/^https?:\/\//, "");

  const [listing, { data: deal }] = await Promise.all([
    brandListing(item.deal_id, vslug),
    item.deal_id ? db.from("atm_deals").select("deal_name, stage").eq("id", item.deal_id).maybeSingle() : { data: null },
  ]);
  const buyerEmail = item.lead_email || item.from_email;
  const nda = item.source === "deal_room" ? { any: true, thisListing: true } : await ndaStatus(buyerEmail, null, item.deal_id, item.subject, item.contact_id);
  const includeNda = item.source === "deal_room" || nda.thisListing;
  const [thread, edits, person] = await Promise.all([threadText(item, host), recentEdits(), personContext(item.contact_id, item.id)]);

  const listingUrl = listing ? `${site}/listing/${listing.slug}` : `${site}/listings`;
  const ndaUrl = listing ? `${site}/nda?listing=${listing.slug}` : `${site}/listings`;
  const sold = listing?.status === "sold" || deal?.stage === "closed";
  const pending = listing?.status === "under_loi" || deal?.stage === "under_contract";
  const facts = listingFacts(listing, includeNda);
  const mailbox = item.source === "deal_room" ? null : (await brandMailboxKey(vslug)) || "info";

  const prompt = `You draft email replies for John Sosville, the broker behind ${b.firm} (${host}), which sells ${b.noun} businesses. John reviews and edits every draft before anything is sent.

VOICE: a seasoned, highly intelligent business broker. Precise, thoughtful and plain-spoken; he understands the economics of ${b.industry} businesses and says useful things in few words. No hype, no exclamation points, no filler, no sales clichés. Warm but never gushing.

${item.source === "website_form" ? `This person filled out a form on ${host}; nobody has replied yet. Write John's first email to them (a new email, not a reply). If the message is empty or looks like spam, write a brief note asking what they're looking for and set needs_john to yes with a note saying it may be spam. ` : ""}${item.source === "deal_room" ? `This is a question a buyer asked in the listing's Deal Room that the AI concierge couldn't answer. The buyer has signed the NDA, so never tell them to sign one. Draft the answer that will be posted in the Deal Room for every NDA buyer: write as "we" (${b.firm}), no greeting, no sign-off, nothing specific to this one buyer.` : "Draft John's reply to the latest message from THEM."}

WHAT JOHN KNOWS ABOUT THIS INDUSTRY (for judgment and tone; don't lecture): ${play.know}

EMAIL TYPE: ${item.kind}${item.summary ? ` — ${item.summary}` : ""}
FROM: ${item.from_name || ""} <${buyerEmail}>
LISTING: ${listing ? `${listing.title} (status: ${sold ? "sold" : pending ? "under contract" : "available"}) — ${listingUrl}` : deal ? `${deal.deal_name} (stage: ${deal.stage})` : "not identified"}
NDA: ${nda.thisListing ? "signed for this listing (has Deal Room access)" : nda.any ? "signed an NDA for another listing, not this one" : "no NDA on file"}

WHO THIS IS (everything we know about this person; use it to avoid repeating questions, don't recite it back):
${person || "(first contact)"}

THREAD (oldest first):
${thread}

APPROVED FACTS FOR THIS LISTING (the only listing facts you may state):
${facts || "(none)"}

HOW JOHN EDITED RECENT DRAFTS (copy his style changes only; these are other buyers and listings, so never reuse their facts):
${edits || "(none yet)"}

HOW JOHN HANDLES THINGS:
- Full financials and documents live in the listing's Deal Room. If the buyer hasn't signed this listing's NDA, send them to ${ndaUrl} (about 30 seconds, instant Deal Room access). Never attach or paste documents.
- If NDA says signed, never ask them to sign or say one isn't on file. If they want documents that aren't in the Deal Room, say John will get them from the seller.
- If they say they signed but NDA shows none for this listing, don't contradict them: they may have used another email or signed for a different listing; give ${ndaUrl}.
- Never share ${play.neverShare} before an accepted offer; say those come later in due diligence.
- ${NEVER_DISCLOSE.replace(/\n/g, "\n  ")}
- If they ask something not in APPROVED FACTS, don't guess or estimate: say John will get it from the seller.
- Offers, price or terms negotiation, financing structure, or anything legal: acknowledge briefly, say John will follow up personally, and set needs_john to yes.
- Seller leads (someone thinking about selling): thank them, show you understand their kind of business in one sentence, ask for ${play.sellerAsk}, explain that everything is kept confidential, and offer a short call. Don't quote a value or a multiple.
- If the listing is under contract or sold, say so plainly and offer to send similar listings as they come up (${site}/listings).
- If LISTING is "not identified", never say a listing doesn't exist; ask which one they mean or point them to ${site}/listings.
- When offering a call, give John's direct line ${JOHN_DIRECT} (${OFFICE} is the office line).
- If THEIR last message is more than 2 days old (today is ${new Date().toISOString().slice(0, 10)}), open with a brief apology for the slow reply.
- Plain conversational email, usually under 140 words, no bullet points, no subject line.${item.source === "deal_room" ? "" : ` Start with "Hi <first name>," if known, else "Hi,". End with "Best,\\nJohn Sosville\\n${b.firm}".`}

Reply in exactly this format:
<draft>the reply text</draft>
<needs_john>yes or no</needs_john>
<notes>one line for John: what you couldn't answer or why it needs him (empty if nothing)</notes>`;

  const r = await anthropic.messages.create({ model: MODEL, max_tokens: 1200, messages: [{ role: "user", content: prompt }] });
  const out = r.content.map((c) => c.text || "").join("");
  const draft = tag(out, "draft");
  if (!draft) throw new Error("no draft in model output");
  const leaks = findConfidential(draft);
  const leakNote = leaks.length ? `CHECK BEFORE SENDING: possible ${leaks.map((l) => l.kind).join(", ")} ("${leaks[0].match}").` : "";
  return {
    draft_text: draft,
    must_go_to_john: /^y/i.test(tag(out, "needs_john")) || item.kind === "offer" || leaks.length > 0,
    draft_notes: [leakNote, tag(out, "notes")].filter(Boolean).join(" ") || null,
    dd_items_used: [],
    dd_items_missing: [],
    draft_mailbox: mailbox,
    draft_from: mailbox === "info" ? `John Sosville <${b.email}>` : null, // brand inbox drafts send as that inbox
  };
}
