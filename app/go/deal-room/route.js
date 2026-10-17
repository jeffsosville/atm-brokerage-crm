import crypto from "crypto";
import { adminDb as db } from "../../../lib/serverAuth";
import { DEAL_HUB } from "../../../lib/dealHub";
import { isTeamEmail } from "../../../lib/team";

// The deal room link in the website's NDA email, so every signer gets their own deal room link.
// WPForms (form 6387) notification for each listing links to:
//   https://dealroom.sosville.co/go/deal-room?entry={entry_id}&email={field_id="3"}
// The "NDA to CRM" snippet records the signature (nda_signatures) with that entry id, so we only hand
// out a link when the entry and email match a real signature. The buyer can click it any time later.
export const dynamic = "force-dynamic";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function page(title, text, refreshUrl) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${refreshUrl ? `<meta http-equiv="refresh" content="3;url=${refreshUrl}">` : ""}<title>${title}</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 16px;color:#1e293b">
<h1 style="font-size:22px">${title}</h1><p>${text}</p></body>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function findSignature(entry, email) {
  const { data } = await db.from("nda_signatures").select("id, email, name, phone, route_id, signed_at, created_at")
    .eq("source", "wpforms").eq("entry_id", entry).ilike("email", email).limit(1);
  return data?.[0] || null;
}

export async function GET(request) {
  const url = new URL(request.url);
  const entry = String(url.searchParams.get("entry") || "").trim();
  // an unencoded "+" in an address arrives as a space
  const email = String(url.searchParams.get("email") || "").trim().toLowerCase().replace(/ /g, "+");
  const tries = Number(url.searchParams.get("n") || 0);
  const contact = "Email info@atmbrokerage.com and we'll send your link.";
  if (!/^\d{1,12}$/.test(entry) || !email.includes("@")) return page("We couldn't open your deal room", contact);

  // Normally saved long before the click; give it a few seconds if the buyer is very quick.
  let sig = await findSignature(entry, email);
  for (let i = 0; !sig && i < 3; i++) { await sleep(1000); sig = await findSignature(entry, email); }
  if (!sig) {
    if (tries < 3) {
      const next = new URL(url); next.searchParams.set("n", String(tries + 1));
      return page("Setting up your deal room…", "This takes a few seconds.", next.pathname + next.search);
    }
    return page("We couldn't open your deal room", contact);
  }

  const { data: route } = sig.route_id
    ? await db.from("atm_routes").select("id, deal_id").eq("id", sig.route_id).maybeSingle()
    : { data: null };
  if (!route?.deal_id) return page("Thanks, your NDA is signed", "Your broker will email you the deal room link shortly.");

  // One link per buyer per deal: reuse theirs, and respect it if the broker turned it off.
  const { data: mine } = await db.from("deal_tokens").select("token, revoked_at, expires_at")
    .eq("deal_id", route.deal_id).ilike("buyer_email", email).order("created_at", { ascending: false }).limit(1);
  const prior = mine?.[0];
  if (prior?.revoked_at) return page("Your access to this deal room is paused", "Please contact your broker at info@atmbrokerage.com.");
  if (prior && !isTeamEmail(email) && (!prior.expires_at || new Date(prior.expires_at) > new Date())) {
    return Response.redirect(`${DEAL_HUB}/deals/${prior.token}`, 302);
  }

  const token = crypto.randomBytes(24).toString("hex");
  const { error } = await db.from("deal_tokens").insert({
    deal_id: route.deal_id, listing_id: route.deal_id, token, status: "active",
    buyer_name: sig.name || null, buyer_email: email, buyer_phone: sig.phone || null,
    signed_at: sig.signed_at || sig.created_at, source_url: "wpforms:" + entry,
    expires_at: new Date(Date.now() + 10 * 365 * 864e5).toISOString(),
  });
  if (error) { console.error("[go/deal-room]", error); return page("We couldn't open your deal room", contact); }
  return Response.redirect(`${DEAL_HUB}/deals/${token}`, 302);
}
