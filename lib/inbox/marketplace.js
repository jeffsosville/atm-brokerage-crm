import { adminDb as db } from "../serverAuth";

// BizBuySell (and look-alike marketplace) leads for every vertical.
//
// All marketplace listings — ATM, vending, cleaning — send leads to the one synced
// inbox (info@). Each lead email names the marketplace's Listing ID, so a lead is
// routed by that ID (marketplace_listings table), then by matching the headline to
// one of our listings, then by keywords in the headline. The vertical decides which
// brand answers and which NDA link the buyer gets.

const BRANDS = {
  atm: {
    firm: "ATM Brokerage", from: "John Sosville <john@atmbrokerage.com>", replyTo: "info@atmbrokerage.com",
    site: "atmbrokerage.com", ndaUrl: () => "https://atmbrokerage.com/atm-routes-for-sale/",
  },
  vending: {
    firm: "VendingExits", from: "John Sosville <sales@vendingexits.com>", replyTo: "sales@vendingexits.com",
    site: "vendingexits.com", ndaUrl: (slug) => (slug ? `https://vendingexits.com/nda?listing=${slug}` : "https://vendingexits.com/listings"),
  },
  cleaning: {
    firm: "CleaningExits", from: "John Sosville <hello@cleaningexits.com>", replyTo: "hello@cleaningexits.com",
    site: "cleaningexits.com", ndaUrl: (slug) => (slug ? `https://cleaningexits.com/nda?listing=${slug}` : "https://cleaningexits.com/listings"),
  },
};
export const brandFor = (slug) => BRANDS[slug] || BRANDS.atm;

const field = (text, label) => {
  const m = text.match(new RegExp(`${label}\\s*:\\s*(.*?)\\s+(?:Contact \\w+|Able to Invest|Purchase Within|Comments|Headline|Listing ID|Ref ID|A response is expected)\\s*:?`, "i"));
  const v = m?.[1]?.replace(/&nbsp;/g, " ").trim();
  return v && !/^not disclosed$/i.test(v) ? v : null;
};

/** Pull the buyer and listing out of a BizBuySell lead email. */
export function parseMarketplaceLead(body = "", subject = "") {
  const t = (body || "").replace(/\s+/g, " ");
  const email = field(t, "Contact Email")?.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)?.[0]?.toLowerCase() || null;
  return {
    marketplace: /bizquest/i.test(t) ? "bizquest" : "bizbuysell",
    listingId: t.match(/Listing ID\s*:\s*(\d{5,})/i)?.[1] || null,
    headline: field(t, "Headline") || subject.replace(/^(re:\s*)?your business-for-sale listing\s*/i, "").trim() || null,
    name: field(t, "Contact Name"),
    email,
    phone: field(t, "Contact Phone")?.replace(/[^\d()+ .-]/g, "").trim() || null,
    zip: field(t, "Contact Zip"),
    invest: field(t, "Able to Invest"),
    timeline: field(t, "Purchase Within"),
    comments: field(t, "Comments"),
  };
}

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Work out which vertical/deal a marketplace lead belongs to.
 * ctx: { verticals: {slug: id}, routes: [{id, title, deal_id, vertical_id}] }
 */
export async function resolveMarketplaceLead(lead, ctx) {
  const idToSlug = Object.fromEntries(Object.entries(ctx.verticals).map(([s, id]) => [id, s]));

  // 1. Explicit mapping by marketplace listing ID (table may not exist yet — ignore errors)
  if (lead.listingId) {
    const { data, error } = await db.from("marketplace_listings")
      .select("deal_id, vertical_id, inhouse_slug, route_id").eq("marketplace", lead.marketplace).eq("external_id", lead.listingId).maybeSingle();
    if (!error && data) {
      return { vertical: idToSlug[data.vertical_id] || "atm", vertical_id: data.vertical_id, deal_id: data.deal_id, route_id: data.route_id, inhouse_slug: data.inhouse_slug, via: "listing_id" };
    }
  }

  // 2. Headline matches one of our listings (ATM routes or vending/cleaning in-house listings)
  const h = norm(lead.headline);
  if (h) {
    const route = (ctx.routes || []).find((r) => r.title && (norm(r.title) === h || h.includes(norm(r.title)) || norm(r.title).includes(h)));
    if (route) {
      return { vertical: idToSlug[route.vertical_id] || "atm", vertical_id: route.vertical_id, deal_id: route.deal_id, route_id: route.id, inhouse_slug: null, via: "route_title" };
    }
    const { data: inhouse } = await db.from("inhouse_listings").select("slug, vertical, title, crm_deal_id").eq("is_active", true);
    const hit = (inhouse || []).find((l) => l.title && (norm(l.title) === h || h.includes(norm(l.title)) || norm(l.title).includes(h)));
    if (hit) {
      return { vertical: hit.vertical, vertical_id: ctx.verticals[hit.vertical] || null, deal_id: hit.crm_deal_id, route_id: null, inhouse_slug: hit.slug, via: "inhouse_title" };
    }
  }

  // 3. Keywords in the headline
  const kw = /\bvending|snack|micro ?market|soda machine/i.test(lead.headline || "") ? "vending"
    : /\bcleaning|janitorial|maid|custodial|carpet clean/i.test(lead.headline || "") ? "cleaning"
    : "atm";
  return { vertical: kw, vertical_id: ctx.verticals[kw] || null, deal_id: null, route_id: null, inhouse_slug: null, via: "keyword" };
}

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The first reply to a marketplace lead: thanks + the right brand's NDA link. */
export function marketplaceReply(lead, resolved) {
  const b = brandFor(resolved.vertical);
  const url = b.ndaUrl(resolved.inhouse_slug);
  const first = (lead.name || "").split(" ")[0] || "there";
  const what = lead.headline ? `the ${lead.headline.replace(/\s+-\s+\$[\d,]+$/, "")}` : "our listing";
  const subject = `NDA & Deal Room Access – ${lead.headline || b.firm}`.slice(0, 150);
  const text = `Hi ${first},

Thanks for your interest in ${what} on BizBuySell.

To see the full financials and the data room, please sign our short NDA here:
${url}

Once you sign, you'll get a Deal Room link right away with the P&L, details, and a Q&A where you can ask anything.

Thanks,
John Sosville
${b.firm} · ${b.site} · 888-430-5535
`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1612;line-height:1.6;max-width:600px;">
<p>Hi ${esc(first)},</p>
<p>Thanks for your interest in ${esc(what)} on BizBuySell.</p>
<p>To see the full financials and the data room, please sign our short NDA:</p>
<p style="margin:24px 0;"><a href="${url}" style="background:#1a1612;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-weight:600;display:inline-block;">Sign the NDA</a></p>
<p>Once you sign, you'll get a Deal Room link right away with the P&amp;L, details, and a Q&amp;A where you can ask anything.</p>
<p>Thanks,<br>John Sosville<br><span style="color:#6b6458;">${b.firm} · ${b.site} · 888-430-5535</span></p></div>`;
  return { from: b.from, reply_to: b.replyTo, subject, text, html, ndaUrl: url };
}

/**
 * MARKETPLACE_AUTOREPLY controls who answers BizBuySell leads:
 *   off    – CRM never sends (the info@ Apps Script answers everything, ATM-branded). Default.
 *   nonatm – CRM answers vending/cleaning leads; the Apps Script must skip non-ATM headlines.
 *   all    – CRM answers every lead; turn the Apps Script off first.
 */
export function shouldAutoReply(vertical) {
  const mode = (process.env.MARKETPLACE_AUTOREPLY || "off").toLowerCase();
  if (mode === "all") return true;
  if (mode === "nonatm") return vertical !== "atm";
  return false;
}

export async function sendMarketplaceReply(to, reply) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY missing");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: reply.from, to: [to], reply_to: reply.reply_to, subject: reply.subject, text: reply.text, html: reply.html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
