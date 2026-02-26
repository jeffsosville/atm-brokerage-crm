import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RESEND_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://atm-brokerage-crm.vercel.app";
const WEBHOOK_SECRET = process.env.NDA_WEBHOOK_SECRET || "";

export async function POST(request) {
  try {
    const body = await request.json();

    const authHeader = request.headers.get("authorization");
    if (WEBHOOK_SECRET && authHeader !== "Bearer " + WEBHOOK_SECRET) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const buyerName  = body.buyer_name  || body.name  || body.full_name || "";
    const buyerEmail = body.buyer_email || body.email || "";
    const pageUrl    = body.deal_slug   || body.page_url || "";
    const buyerPhone = body.phone || "";

    if (!buyerEmail) {
      return Response.json({ error: "buyer_email required" }, { status: 400 });
    }

    // Match deal by page URL in metadata, or fallback to single listed deal
    let deal = null;
    if (pageUrl) {
      const { data } = await supabase
        .from("atm_deals")
        .select("*")
        .ilike("deal_name", "%" + pageUrl.split("/").pop().replace(/-/g, " ") + "%")
        .limit(1);
      if (data?.length) deal = data[0];
    }
    if (!deal) {
      const { data } = await supabase
        .from("atm_deals")
        .select("*")
        .eq("stage", "listed")
        .limit(5);
      if (data?.length === 1) deal = data[0];
    }

    // Generate token
    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    // Insert into deal_tokens (what the Deal Hub reads)
    await supabase.from("deal_tokens").insert({
      deal_id:    deal?.id || null,
      listing_id: deal?.id || null,
      token,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });

    // Insert into deal_buyer_access (buyer contact info)
    await supabase.from("deal_buyer_access").insert({
      deal_id:     deal?.id || null,
      token,
      buyer_name:  buyerName,
      buyer_email: buyerEmail,
      buyer_phone: buyerPhone,
      expires_at:  expiresAt,
      created_at:  new Date().toISOString(),
    });

    const dealHubUrl = `${APP_URL}/deals/${token}`;

    // Send Deal Hub email via Resend
    if (RESEND_KEY && buyerEmail) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${RESEND_KEY}`,
        },
        body: JSON.stringify({
          from: "ATM Brokerage <info@atmbrokerage.com>",
          to: buyerEmail,
          subject: `Your Interactive Deal Room – ${deal?.deal_name || "ATM Portfolio"}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#1F3864;padding:24px 32px;border-radius:12px 12px 0 0;">
                <h2 style="color:white;margin:0;">ATM Brokerage</h2>
              </div>
              <div style="padding:32px;border:1px solid #e2e8f0;border-top:none;">
                <p>Hi ${buyerName || "there"},</p>
                <p>In addition to the data room documents you just received, we've also set up an <strong>interactive Deal Room</strong> for you with an AI Deal Concierge that can answer your questions instantly.</p>
                <p style="margin:32px 0;">
                  <a href="${dealHubUrl}" style="background:#1F3864;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">
                    Open Your Deal Room →
                  </a>
                </p>
                <p style="color:#666;font-size:14px;">This link is private and unique to you. All access is logged and confidential.</p>
                <p>If you have questions or want to schedule a call, just reply to this email.<br><br>
                — The ATM Brokerage Team<br>
                <a href="https://atmbrokerage.com">atmbrokerage.com</a></p>
              </div>
            </div>
          `,
        }),
      });
    }

    // Log to CRM
    await supabase.from("atm_activity_log").insert({
      type: "nda_signed",
      subject: `NDA signed → Deal Room sent: ${buyerName} (${buyerEmail})`,
      body_preview: `${deal?.deal_name || "Unknown deal"} | Token expires: ${expiresAt.slice(0, 10)}`,
      date: new Date().toISOString(),
      metadata: JSON.stringify({
        deal_id:      deal?.id,
        buyer_name:   buyerName,
        buyer_email:  buyerEmail,
        token,
        deal_hub_url: dealHubUrl,
        page_url:     pageUrl,
      }),
    });

    // Notify John
    await supabase.from("atm_notifications").insert({
      type:     "nda_signed",
      title:    `New NDA: ${buyerName || buyerEmail}`,
      message:  `${buyerName || buyerEmail} signed NDA for ${deal?.deal_name || "a listing"}. Deal Room sent automatically.`,
      priority: 1,
      metadata: JSON.stringify({ deal_id: deal?.id, buyer_email: buyerEmail, token }),
    });

    return Response.json({ success: true, deal_hub_url: dealHubUrl });

  } catch (err) {
    console.error("NDA webhook error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
