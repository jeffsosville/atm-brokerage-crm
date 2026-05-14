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
    const buyerPhone = body.phone || "";
    const buyerCompany = body.company || "";
    const buyerBudget = body.budget || "";
    const buyerInterest = body.interest || body.why_interested || "";
    const dlNumber   = body.dl_number || "";      // PREFERRED: exact DL match
    const dealId     = body.deal_id || "";        // PREFERRED: exact UUID match
    const pageUrl    = body.deal_slug || body.page_url || "";  // FALLBACK only

    if (!buyerEmail) {
      return Response.json({ error: "buyer_email required" }, { status: 400 });
    }

    // ===== DEAL MATCHING — strict, in priority order =====
    let deal = null;
    let matchMethod = "none";

    // 1. Match by deal_id (UUID) — most reliable
    if (dealId) {
      const { data } = await supabase
        .from("atm_deals")
        .select("*")
        .eq("id", dealId)
        .limit(1);
      if (data?.length) { deal = data[0]; matchMethod = "deal_id"; }
    }

    // 2. Match by dl_number — also reliable
    if (!deal && dlNumber) {
      const { data } = await supabase
        .from("atm_deals")
        .select("*")
        .eq("dl_number", dlNumber)
        .limit(1);
      if (data?.length) { deal = data[0]; matchMethod = "dl_number"; }
    }

    // 3. Fallback: slug match on deal_name (legacy / robustness)
    if (!deal && pageUrl) {
      // Extract slug, handling trailing slashes
      const segments = pageUrl.split("/").filter(Boolean);
      const slug = segments[segments.length - 1] || "";
      if (slug) {
        const cleaned = slug.replace(/-/g, " ").replace(/[^a-z0-9 ]/gi, "");
        const { data } = await supabase
          .from("atm_deals")
          .select("*")
          .ilike("deal_name", "%" + cleaned + "%")
          .limit(1);
        if (data?.length) { deal = data[0]; matchMethod = "slug_fuzzy"; }
      }
    }

    // 4. NO fallback to "single listed deal" — that masks bugs.
    // If we can't match, log loudly and continue with deal=null so admin sees it.
    if (!deal) {
      console.error("[NDA] No deal matched. Body:", JSON.stringify({ dlNumber, dealId, pageUrl }));
    }

    // ===== Generate token =====
    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();

    // Insert into deal_tokens (what the Deal Hub reads) — include buyer info
    await supabase.from("deal_tokens").insert({
      deal_id:     deal?.id || null,
      listing_id:  deal?.id || null,
      token,
      buyer_name:  buyerName,
      buyer_email: buyerEmail,
      expires_at:  expiresAt,
      created_at:  new Date().toISOString(),
    });

    // Insert into deal_buyer_access (extended buyer contact info)
    await supabase.from("deal_buyer_access").insert({
      deal_id:        deal?.id || null,
      token,
      buyer_name:     buyerName,
      buyer_email:    buyerEmail,
      buyer_phone:    buyerPhone,
      buyer_company:  buyerCompany,
      buyer_budget:   buyerBudget,
      buyer_interest: buyerInterest,
      expires_at:     expiresAt,
      created_at:     new Date().toISOString(),
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
          from: "ATM Brokerage <notifications@atmbrokerage.com>",
          to: buyerEmail,
          subject: `Your access to the ${deal?.deal_name || "ATM Portfolio"} data room`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="padding:32px;">
                <p>Hi ${buyerName || "there"},</p>
                <p>Thanks for submitting your NDA for the <strong>${deal?.deal_name || "ATM Portfolio"}</strong>${deal?.asking_price ? ` — $${Number(deal.asking_price).toLocaleString()}` : ""}.</p>
                <p>You now have access to the data room:</p>
                <p style="margin:32px 0;">
                  <a href="${dealHubUrl}" style="background:#000;color:white;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;">
                    Open the Data Room
                  </a>
                </p>
                <p style="color:#666;font-size:14px;">Or paste this link into your browser:<br><a href="${dealHubUrl}">${dealHubUrl}</a></p>
                <p>Our team will respond promptly, and all Q&amp;A will remain visible for transparency.</p>
                <p>If you need additional documents or want to schedule a call, just let us know in the channel.</p>
                <p>Thanks again,<br>— The ATM Brokerage Team</p>
                <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
                <p style="color:#94a3b8;font-size:12px;">
                  <a href="https://atmbrokerage.com" style="color:#94a3b8;">atmbrokerage.com</a> ·
                  <a href="mailto:info@atmbrokerage.com" style="color:#94a3b8;">info@atmbrokerage.com</a> ·
                  +1 888-430-5535
                </p>
              </div>
            </div>
          `,
        }),
      });
    }

    // Internal NDA notification email to info@ (and john@)
    if (RESEND_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${RESEND_KEY}`,
        },
        body: JSON.stringify({
          from: "ATM Brokerage <notifications@atmbrokerage.com>",
          to: ["info@atmbrokerage.com", "john@atmbrokerage.com"],
          subject: `[NDA] ${buyerName || buyerEmail} - ${deal?.deal_name || "Unmatched listing"}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
              <p style="color:#c2410c;text-transform:uppercase;font-size:11px;letter-spacing:0.1em;margin:0;">New NDA Lead</p>
              <h2 style="margin:8px 0 24px;">${buyerName || buyerEmail} — ${deal?.deal_name || "⚠️ UNMATCHED DEAL"}${deal?.asking_price ? ` ($${Number(deal.asking_price).toLocaleString()})` : ""}</h2>
              ${!deal ? `<div style="background:#fef2f2;border:1px solid #fecaca;padding:12px;border-radius:6px;margin-bottom:16px;"><strong style="color:#991b1b;">⚠️ Could not match this NDA to a listing.</strong> Page: ${pageUrl || "n/a"}, DL: ${dlNumber || "n/a"}, ID: ${dealId || "n/a"}</div>` : ""}
              <table style="width:100%;font-size:14px;">
                <tr><td style="padding:6px 0;color:#666;width:120px;">Name:</td><td>${buyerName}</td></tr>
                <tr><td style="padding:6px 0;color:#666;">Email:</td><td><a href="mailto:${buyerEmail}">${buyerEmail}</a></td></tr>
                <tr><td style="padding:6px 0;color:#666;">Phone:</td><td>${buyerPhone}</td></tr>
                <tr><td style="padding:6px 0;color:#666;">Company:</td><td>${buyerCompany}</td></tr>
                <tr><td style="padding:6px 0;color:#666;">Budget:</td><td>${buyerBudget}</td></tr>
                <tr><td style="padding:6px 0;color:#666;">Listing:</td><td>${deal?.deal_name || "—"}</td></tr>
              </table>
              ${buyerInterest ? `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;margin:16px 0;"><strong style="font-size:11px;text-transform:uppercase;color:#92400e;">Why they are interested</strong><p style="margin:4px 0 0;">${buyerInterest}</p></div>` : ""}
              <p style="margin:24px 0;">
                <a href="${dealHubUrl}" style="background:#000;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;">View Their Deal Hub</a>
              </p>
              <p style="color:#94a3b8;font-size:11px;font-family:monospace;">Token: ${token}<br>Match: ${matchMethod}<br>Source: ${pageUrl || "n/a"}</p>
            </div>
          `,
        }),
      });
    }

    // Log to CRM
    await supabase.from("atm_activity_log").insert({
      type: "nda_signed",
      subject: `NDA signed → Deal Room sent: ${buyerName} (${buyerEmail})`,
      body_preview: `${deal?.deal_name || "UNMATCHED"} | Match: ${matchMethod} | Token: ${token.slice(0, 8)}...`,
      date: new Date().toISOString(),
      metadata: JSON.stringify({
        deal_id:      deal?.id,
        buyer_name:   buyerName,
        buyer_email:  buyerEmail,
        token,
        deal_hub_url: dealHubUrl,
        page_url:     pageUrl,
        match_method: matchMethod,
      }),
    });

    // Notify John
    await supabase.from("atm_notifications").insert({
      type:     "nda_signed",
      title:    `New NDA: ${buyerName || buyerEmail}`,
      message:  `${buyerName || buyerEmail} signed NDA for ${deal?.deal_name || "⚠️ unmatched listing"}. Deal Room sent.`,
      priority: deal ? 1 : 2,  // higher priority if unmatched
      metadata: JSON.stringify({ deal_id: deal?.id, buyer_email: buyerEmail, token, match_method: matchMethod }),
    });

    return Response.json({
      success: true,
      deal_hub_url: dealHubUrl,
      matched: !!deal,
      match_method: matchMethod,
      deal_name: deal?.deal_name || null,
    });

  } catch (err) {
    console.error("NDA webhook error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
