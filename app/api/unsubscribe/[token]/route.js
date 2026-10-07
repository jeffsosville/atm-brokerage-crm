import { adminDb as db } from "../../../../lib/serverAuth";

// Unsubscribe link in NDA follow-up emails. Stops the drip for every token on the
// buyer's email; Deal Hub access is unchanged. Moved here from atmbrokerage-next.

export const dynamic = "force-dynamic";

const BRANDS = {
  atm: { firm: "ATM Brokerage", email: "john@atmbrokerage.com" },
  vending: { firm: "VendingExits", email: "sales@vendingexits.com" },
  cleaning: { firm: "CleaningExits", email: "hello@cleaningexits.com" },
};

export async function GET(_request, { params }) {
  const token = params?.token;
  if (!token) return new Response("Missing token", { status: 400 });

  const { data: row } = await db.from("deal_tokens")
    .select("id, buyer_email, buyer_name, deal_id, vertical_id").eq("token", token).maybeSingle();
  if (!row) return html(page(BRANDS.atm, "Sorry, we could not find your subscription record."), 404);

  let slug = null;
  if (row.deal_id) {
    const { data: d } = await db.from("atm_deals").select("deal_type").eq("id", row.deal_id).maybeSingle();
    slug = d?.deal_type?.toLowerCase() || null;
  }
  if (!slug && row.vertical_id) {
    const { data: v } = await db.from("verticals").select("slug").eq("id", row.vertical_id).maybeSingle();
    slug = v?.slug || null;
  }
  const brand = BRANDS[slug] || BRANDS.atm;

  const now = new Date().toISOString();
  const q = db.from("deal_tokens").update({ unsubscribed_at: now }).is("unsubscribed_at", null);
  await (row.buyer_email ? q.eq("buyer_email", row.buyer_email) : q.eq("id", row.id));

  await db.from("atm_activity_log").insert({
    type: "unsubscribed",
    activity_type: "buyer_engagement",
    subject: `Unsubscribed: ${row.buyer_email || "unknown"}`,
    body: `${row.buyer_name || row.buyer_email || "Buyer"} unsubscribed from follow-up sequence.`,
    source: "unsubscribe",
    source_id: token,
    metadata: { token, buyer_email: row.buyer_email, buyer_name: row.buyer_name, vertical: slug || "atm" },
  });

  return html(page(brand, `You've been unsubscribed from ${brand.firm} follow-up emails. Your Deal Hub access is unchanged.`), 200);
}

function html(body, status) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function page(brand, message) {
  return `<!DOCTYPE html><html><head><title>Unsubscribed</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:80px auto;padding:32px;text-align:center;color:#1a1612;background:#fbf8f0;">
<h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">${brand.firm}</h1>
<p style="color:#4a443b;line-height:1.6;">${message}</p>
<p style="margin-top:32px;font-size:13px;color:#8a8275;">Need to talk to us? <a href="mailto:${brand.email}" style="color:#b8410e;">${brand.email}</a> · 888-430-5535</p>
</body></html>`;
}
