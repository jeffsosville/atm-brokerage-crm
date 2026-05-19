import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getResend } from '@/lib/resend';

/**
 * POST /api/admin/qa-notify
 *
 * Called by /api/concierge when a question escalates (escalated === true).
 * 
 * 1. Looks up all responder tokens for this deal (John, Sanny, seller)
 * 2. Fires a Resend email to each with a direct answer link
 * 3. Each person gets the same page — no login, just click and answer
 *
 * Add this call to /api/concierge/route.js after the existing
 * atm_notifications insert, replacing the supaPost("atm_notifications"...) block:
 *
 *   if (escalated) {
 *     // existing atm_notifications write stays as-is
 *     await supaPost("atm_notifications", { ... });
 *     
 *     // NEW: fire answer emails
 *     fetch("/api/admin/qa-notify", {
 *       method: "POST",
 *       headers: { "Content-Type": "application/json" },
 *       body: JSON.stringify({
 *         question_id: savedQuestion.id,  // need to capture this from the insert
 *         deal_id: dealId,
 *         deal_name: deal?.deal_name,
 *         listing_slug: deal?.slug,       // add slug to atm_deals select
 *         question,
 *         buyer_name: buyerName,
 *       }),
 *     }).catch(err => console.error("qa-notify failed:", err));
 *   }
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { question_id, deal_id, deal_name, listing_slug, question, buyer_name } = await req.json();

    if (!question_id || !deal_id || !question) {
      return NextResponse.json({ error: 'question_id, deal_id, question required' }, { status: 400 });
    }

    // Get all responder tokens for this deal
    const { data: responders } = await supabase
      .from('deal_responder_tokens')
      .select('*')
      .eq('deal_id', deal_id);

    if (!responders?.length) {
      console.warn(`[qa-notify] No responders for deal_id=${deal_id}. Add them in admin.`);
      return NextResponse.json({ success: true, sent: 0 });
    }

    const resend = getResend();
    const baseUrl = process.env.DEAL_HUB_URL ?? 'https://atm-brokerage-crm.vercel.app';
    let sent = 0;

    for (const responder of responders) {
      if (!responder.email) continue;

      const answerUrl = `${baseUrl}/answer/${responder.token}?q=${question_id}`;

      try {
        await resend.emails.send({
          from: 'ATM Brokerage <notifications@atmbrokerage.com>',
          to: [responder.email],
          replyTo: 'john@atmbrokerage.com',
          subject: `[Q] ${deal_name ?? 'ATM Route'} — buyer question needs an answer`,
          html: buildNotifyEmail({
            responder_name: responder.name,
            responder_role: responder.role,
            deal_name: deal_name ?? 'ATM Route',
            question,
            buyer_name: responder.role === 'seller' ? null : buyer_name, // hide buyer from seller
            answer_url: answerUrl,
          }),
          text: `${responder.name}, a buyer asked:\n\n"${question}"\n\nAnswer here: ${answerUrl}`,
        });
        sent++;

        // Update last_used_at
        await supabase
          .from('deal_responder_tokens')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', responder.id);

      } catch (err) {
        console.error(`[qa-notify] Email failed for ${responder.email}:`, err);
      }
    }

    return NextResponse.json({ success: true, sent });
  } catch (err) {
    console.error('[qa-notify] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

function buildNotifyEmail(args: {
  responder_name: string;
  responder_role: string;
  deal_name: string;
  question: string;
  buyer_name: string | null;
  answer_url: string;
}): string {
  const buyerLine = args.buyer_name
    ? `<p style="font-size:13px;color:#8a8275;">Asked by: ${escapeHtml(args.buyer_name)}</p>`
    : `<p style="font-size:13px;color:#8a8275;">Asked by a qualified buyer</p>`;

  const roleNote = args.responder_role === 'seller'
    ? `<p style="font-size:13px;color:#8a8275;font-style:italic;">Answer based on your knowledge of the route. ATM Brokerage will review before publishing publicly.</p>`
    : '';

  return `
<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1a1612;line-height:1.6;max-width:600px;margin:0 auto;padding:24px;">
<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#b8410e;margin-bottom:8px;">Buyer Question — ${escapeHtml(args.deal_name)}</div>
<h2 style="margin:0 0 20px;font-size:20px;">Hi ${escapeHtml(args.responder_name)}, a buyer has a question</h2>

<div style="background:#f4efe3;border-left:3px solid #b8410e;padding:16px 20px;margin-bottom:16px;">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#8a8275;margin-bottom:8px;">Question</div>
  <div style="font-size:15px;font-weight:600;white-space:pre-wrap;">${escapeHtml(args.question)}</div>
</div>

${buyerLine}
${roleNote}

<p style="margin:24px 0;">
  <a href="${args.answer_url}" style="background:#1a1612;color:#fbf8f0;padding:14px 22px;text-decoration:none;border-radius:2px;font-weight:600;display:inline-block;font-size:15px;">
    Answer this question →
  </a>
</p>

<p style="font-size:12px;color:#8a8275;">Or paste this link: <a href="${args.answer_url}" style="color:#1a1612;">${args.answer_url}</a></p>

<p style="font-size:12px;color:#8a8275;margin-top:32px;border-top:1px solid #d9d1bc;padding-top:16px;">
  ATM Brokerage · <a href="https://atmbrokerage.com" style="color:#8a8275;">atmbrokerage.com</a> · +1 888-430-5535
</p>
</body></html>`.trim();
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
