// Issues a buyer's deal room link and emails it. Used by the website NDA endpoint
// (/api/public/nda-signed) and the backfill admin route.
import crypto from "crypto";
import { adminDb as db } from "./serverAuth";
import { DEAL_HUB } from "./dealHub";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Reuses a live token for the same buyer + deal so repeat submissions don't mint new links.
async function getOrCreateToken({ dealId, email, name, phone, company, contactId, sourceUrl }) {
  const { data: existing } = await db.from("deal_tokens")
    .select("token, revoked_at, expires_at")
    .eq("deal_id", dealId).ilike("buyer_email", email)
    .is("revoked_at", null)
    .order("created_at", { ascending: false }).limit(1);
  const live = (existing || []).find((t) => !t.expires_at || new Date(t.expires_at) > new Date());
  if (live) return { token: live.token, created: false };

  const token = crypto.randomBytes(24).toString("hex");
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000).toISOString();
  const { error } = await db.from("deal_tokens").insert({
    deal_id: dealId, listing_id: dealId, token, status: "active",
    buyer_name: name || null, buyer_email: email, buyer_phone: phone || null, buyer_company: company || null,
    contact_id: contactId || null, source_url: sourceUrl || null,
    signed_at: now, created_at: now, expires_at: expiresAt,
  });
  if (error) throw new Error(`deal_tokens insert: ${error.message}`);
  await db.from("deal_buyer_access").insert({
    deal_id: dealId, token, buyer_name: name || null, buyer_email: email, buyer_phone: phone || null,
    expires_at: expiresAt, created_at: now,
  });
  return { token, created: true };
}

async function sendResend(payload) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY missing");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// opts.apology adds a line for buyers whose original email never went out.
export async function grantDealRoom({ dealId, email, name, phone, company, contactId, sourceUrl, apology = false, notifyTeam = true }) {
  const { data: deal } = await db.from("atm_deals")
    .select("id, deal_name, dl_number, asking_price").eq("id", dealId).maybeSingle();
  if (!deal) throw new Error(`deal ${dealId} not found`);

  const { token, created } = await getOrCreateToken({ dealId, email, name, phone, company, contactId, sourceUrl });
  const url = `${DEAL_HUB}/deals/${token}`;
  const price = deal.asking_price ? ` — $${Number(deal.asking_price).toLocaleString()}` : "";
  const dealName = esc(deal.deal_name || "ATM Portfolio");

  await sendResend({
    from: "ATM Brokerage <notifications@atmbrokerage.com>",
    to: [email],
    reply_to: "john@atmbrokerage.com",
    subject: `Your access to the ${deal.deal_name || "ATM Portfolio"} data room`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;">
<p>Hi ${esc(name) || "there"},</p>
${apology ? `<p>You signed our NDA on atmbrokerage.com, but a problem on our end kept your access email from going out. Sorry about that — here it is.</p>` : `<p>Thanks for signing the NDA for <strong>${dealName}</strong>${price}.</p>`}
<p>Your data room for <strong>${dealName}</strong> is ready:</p>
<p style="margin:28px 0;"><a href="${url}" style="background:#000;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;">Open the Data Room</a></p>
<p style="color:#666;font-size:14px;">Or paste this link into your browser:<br><a href="${url}">${url}</a></p>
<p>Questions? Reply to this email or call or text John Sosville at 303-517-2568.</p>
<p>— ATM Brokerage</p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
<p style="color:#94a3b8;font-size:12px;">atmbrokerage.com · info@atmbrokerage.com · 888-430-5535</p>
</div>`,
  });

  if (notifyTeam) {
    await sendResend({
      from: "ATM Brokerage <notifications@atmbrokerage.com>",
      to: ["info@atmbrokerage.com", "john@atmbrokerage.com"],
      subject: `[NDA] ${name || email} - ${deal.deal_name}`,
      html: `<div style="font-family:Arial,sans-serif;padding:24px;">
<p><strong>${esc(name) || "—"}</strong> &lt;${esc(email)}&gt; ${phone ? "· " + esc(phone) : ""}</p>
<p>Signed the NDA for <strong>${dealName}</strong>${price} (${esc(deal.dl_number || "")}). Deal room sent.</p>
<p><a href="${url}">View their deal room</a></p></div>`,
    }).catch((e) => console.error("[grantDealRoom] team notify", e.message));
  }

  return { token, url, created, deal_name: deal.deal_name };
}
