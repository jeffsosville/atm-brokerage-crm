import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const sendEmail = async ({ from, to, reply_to, subject, html, text }) => {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from, to, reply_to, subject, html, text }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  return r.json();
};

export async function POST(request) {
  try {
    const { question_id, deal_id, deal_name, question, buyer_name } = await request.json();

    if (!question_id || !deal_id || !question) {
      return Response.json({ error: "question_id, deal_id, question required" }, { status: 400 });
    }

    const { data: responders } = await supabase
      .from("deal_responder_tokens")
      .select("*")
      .eq("deal_id", deal_id);

    if (!responders?.length) {
      console.warn(`[qa-notify] No responders for deal_id=${deal_id}`);
      return Response.json({ success: true, sent: 0, note: "No responders configured" });
    }

    const baseUrl = process.env.DEAL_HUB_URL || "https://atm-brokerage-crm.vercel.app";
    let sent = 0;

    for (const responder of responders) {
      if (!responder.email) continue;
      const answerUrl = `${baseUrl}/answer/${responder.token}?q=${question_id}`;
      try {
        await sendEmail({
          from: "ATM Brokerage <notifications@atmbrokerage.com>",
          to: [responder.email],
          reply_to: "john@atmbrokerage.com",
          subject: `[Q] ${deal_name || "ATM Route"} — buyer question needs an answer`,
          html: buildEmail({
            name: responder.name,
            role: responder.role,
            deal_name: deal_name || "ATM Route",
            question,
            buyer_name: responder.role === "seller" ? null : buyer_name,
            answer_url: answerUrl,
          }),
          text: `${responder.name} — a buyer asked:\n\n"${question}"\n\nAnswer here: ${answerUrl}`,
        });
        sent++;
        supabase.from("deal_responder_tokens")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", responder.id)
          .then(() => {});
      } catch (err) {
        console.error(`[qa-notify] email failed for ${responder.email}:`, err);
      }
    }

    return Response.json({ success: true, sent });
  } catch (err) {
    console.error("[qa-notify] error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}

function buildEmail({ name, role, deal_name, question, buyer_name, answer_url }) {
  const buyerLine = buyer_name && role !== "seller"
    ? `<p style="font-size:13px;color:#8a8275;">Asked by: ${esc(buyer_name)}</p>`
    : `<p style="font-size:13px;color:#8a8275;">Asked by a qualified buyer</p>`;

  const sellerNote = role === "seller"
    ? `<p style="font-size:13px;color:#8a8275;font-style:italic;margin-top:12px;">Answer based on your knowledge of the route. ATM Brokerage will review before publishing. Do not reference pricing, offers, or specific buyers.</p>`
    : "";

  return `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1a1612;line-height:1.6;max-width:600px;margin:0 auto;padding:24px;">
<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#b8410e;margin-bottom:8px;">Buyer Question — ${esc(deal_name)}</div>
<h2 style="margin:0 0 20px;font-size:20px;">Hi ${esc(name)}, a buyer has a question</h2>
<div style="background:#f4efe3;border-left:3px solid #b8410e;padding:16px 20px;margin-bottom:16px;">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#8a8275;margin-bottom:8px;">Question</div>
  <div style="font-size:15px;font-weight:600;white-space:pre-wrap;">${esc(question)}</div>
</div>
${buyerLine}
${sellerNote}
<p style="margin:24px 0;">
  <a href="${answer_url}" style="background:#1a1612;color:#fbf8f0;padding:14px 22px;text-decoration:none;border-radius:2px;font-weight:600;display:inline-block;font-size:15px;">Answer this question →</a>
</p>
<p style="font-size:12px;color:#8a8275;">Link: <a href="${answer_url}" style="color:#1a1612;">${answer_url}</a></p>
<p style="font-size:12px;color:#8a8275;margin-top:32px;border-top:1px solid #d9d1bc;padding-top:16px;">ATM Brokerage · atmbrokerage.com · +1 888-430-5535</p>
</body></html>`;
}

function esc(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
