import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: escalated } = await supabase
    .from("deal_questions")
    .select("question, ai_answer, deal_id, buyer_session, created_at")
    .eq("escalated", true)
    .gte("created_at", yesterday)
    .order("created_at", { ascending: false });

  const { data: allQuestions } = await supabase
    .from("deal_questions")
    .select("deal_id, escalated, created_at")
    .gte("created_at", yesterday);

  const dealIds = [...new Set([...(escalated || []), ...(allQuestions || [])].map(q => q.deal_id))];
  const { data: deals } = await supabase
    .from("atm_deals")
    .select("id, deal_name, dl_number")
    .in("id", dealIds.length ? dealIds : ["none"]);

  const dealMap = {};
  (deals || []).forEach(d => { dealMap[d.id] = d; });

  const { data: sessions } = await supabase
    .from("buyer_engagement")
    .select("session_id, deal_id, created_at")
    .gte("created_at", yesterday);

  const uniqueSessions = new Set((sessions || []).map(s => s.session_id)).size;

  const totalQ = (allQuestions || []).length;
  const escalatedQ = (escalated || []).length;
  const handledQ = totalQ - escalatedQ;

  if (totalQ === 0 && uniqueSessions === 0) {
    return Response.json({ sent: false, reason: "no activity" });
  }

  let html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1e40af; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">ATM Brokerage - Daily Deal Hub Report</h1>
        <p style="margin: 4px 0 0; opacity: 0.8; font-size: 14px;">${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      </div>
      <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0;">
        <h2 style="margin: 0 0 12px; font-size: 16px; color: #334155;">Summary</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 12px; background: #dbeafe; border-radius: 4px; text-align: center;">
              <div style="font-size: 24px; font-weight: bold; color: #1e40af;">${uniqueSessions}</div>
              <div style="font-size: 11px; color: #64748b;">Buyer Sessions</div>
            </td>
            <td style="padding: 8px 12px; background: #d1fae5; border-radius: 4px; text-align: center;">
              <div style="font-size: 24px; font-weight: bold; color: #059669;">${handledQ}</div>
              <div style="font-size: 11px; color: #64748b;">AI Handled</div>
            </td>
            <td style="padding: 8px 12px; background: #fef3c7; border-radius: 4px; text-align: center;">
              <div style="font-size: 24px; font-weight: bold; color: #92400e;">${escalatedQ}</div>
              <div style="font-size: 11px; color: #64748b;">Needs Response</div>
            </td>
          </tr>
        </table>
      </div>`;

  if (escalatedQ > 0) {
    html += `
      <div style="background: #fffbeb; padding: 20px; border: 1px solid #fde68a; border-top: none;">
        <h2 style="margin: 0 0 12px; font-size: 16px; color: #92400e;">Escalated Questions (Need Your Response)</h2>`;
    (escalated || []).forEach(q => {
      const deal = dealMap[q.deal_id] || {};
      html += `
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin-bottom: 8px;">
          <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">${deal.deal_name || "Unknown Deal"} (${deal.dl_number || ""})</div>
          <div style="font-size: 14px; font-weight: bold; color: #1e293b; margin-bottom: 6px;">Buyer asked: "${q.question}"</div>
          <div style="font-size: 12px; color: #475569;">AI answered: "${(q.ai_answer || "").substring(0, 150)}..."</div>
          <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">${new Date(q.created_at).toLocaleString()}</div>
        </div>`;
    });
    html += `</div>`;
  }

  html += `
      <div style="background: #f1f5f9; padding: 16px; text-align: center; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0; border-top: none;">
        <a href="https://atm-brokerage-crm.vercel.app" style="color: #2563eb; font-size: 13px;">Open CRM Dashboard</a>
        <span style="color: #cbd5e1; margin: 0 8px;">|</span>
        <a href="https://atm-brokerage-crm.vercel.app/admin" style="color: #2563eb; font-size: 13px;">Admin Panel</a>
      </div>
    </div>`;

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    return Response.json({ sent: false, reason: "no RESEND_API_KEY", html });
  }

  const emailResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "ATM Brokerage <deals@atmbrokerage.com>",
      to: ["info@atmbrokerage.com", "john@atmbrokerage.com"],
      subject: "Deal Hub Daily Report - " + escalatedQ + " escalated, " + totalQ + " total questions",
      html,
    }),
  });

  const emailResult = await emailResp.json();
  return Response.json({ sent: true, stats: { totalQ, escalatedQ, handledQ, uniqueSessions }, email: emailResult });
}
