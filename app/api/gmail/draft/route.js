import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Step 3: Supabase context feed ───────────────────────────────────────────

async function fetchContext(email) {
  const context = { contact: null, company: null, deals: [], recentEmails: [] };

  // 1. Look up contact by sender email
  const { data: contact } = await supabase
    .from('atm_contacts')
    .select('id, first_name, last_name, name, email, phone, tags, segment, company_id')
    .eq('email', email.from_email)
    .maybeSingle();

  if (contact) {
    context.contact = contact;

    // 2. Look up their company
    if (contact.company_id) {
      const { data: company } = await supabase
        .from('atm_companies')
        .select('id, company_name, dba_name, category, state, city, estimated_atm_count, annual_revenue_estimate, status, priority, notes, last_contacted_at')
        .eq('id', contact.company_id)
        .maybeSingle();
      context.company = company;
    }

    // 3. Look up any active deals involving this contact
    const { data: deals } = await supabase
      .from('atm_deals')
      .select('id, deal_name, deal_type, stage, asking_price, atm_count, route_state, route_cities, monthly_revenue, notes, expected_close_date, priority')
      .or(`buyer_contact_id.eq.${contact.id},seller_contact_id.eq.${contact.id}`)
      .not('stage', 'in', '("closed_won","closed_lost")')
      .order('updated_at', { ascending: false })
      .limit(3);
    context.deals = deals || [];
  }

  // 4. Pull last 5 emails in this thread or from this sender
  const { data: recentEmails } = await supabase
    .from('atm_activity_log')
    .select('subject, snippet, direction, created_at, type')
    .eq('from_email', email.from_email)
    .order('created_at', { ascending: false })
    .limit(5);
  context.recentEmails = recentEmails || [];

  return context;
}

// ─── Step 4: Claude draft generator ──────────────────────────────────────────

async function generateDraft(email, context) {
  const contactName = context.contact?.first_name
    ? `${context.contact.first_name} ${context.contact.last_name || ''}`.trim()
    : 'the sender';

  const companyInfo = context.company
    ? `Company: ${context.company.company_name} | ${context.company.city}, ${context.company.state} | ~${context.company.estimated_atm_count || 'unknown'} ATMs | Status: ${context.company.status}`
    : 'No company record found';

  const dealInfo = context.deals.length
    ? context.deals.map(d => `• ${d.deal_name} — ${d.stage} — $${d.asking_price?.toLocaleString() || 'TBD'} asking — ${d.atm_count} ATMs in ${d.route_state}`).join('\n')
    : 'No active deals found';

  const emailHistory = context.recentEmails.length
    ? context.recentEmails.map(e => `[${e.direction}] ${e.subject} — ${e.snippet?.substring(0, 80)}`).join('\n')
    : 'No prior email history';

  const prompt = `You are drafting a reply on behalf of John Sosville at ATM Brokerage (atmbrokerage.com). John is a senior broker who specializes in buying and selling ATM route businesses across the US. He is professional, direct, and knowledgeable. Replies should be warm but concise — no fluff.

INCOMING EMAIL:
From: ${email.from_email}
Subject: ${email.subject}
Body: ${email.body || email.snippet}

CONTEXT:
Contact: ${contactName}
${companyInfo}

Active Deals:
${dealInfo}

Email History:
${emailHistory}

Classification: ${email.classification} (${email.urgency} urgency)
Suggested action: ${email.suggested_action}

Draft a reply from John that:
1. Addresses the sender by first name if known
2. Directly responds to their inquiry
3. Moves the conversation forward (schedules a call, asks a qualifying question, provides requested info)
4. Ends with a clear next step
5. Signs off as John Sosville, ATM Brokerage, (315) 430-1111

Keep it under 150 words. Do not use bullet points. Write in plain conversational email style.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const { email_id, hours = 24 } = await request.json().catch(() => ({}));

    let emails;

    if (email_id) {
      // Draft for a specific email
      const { data, error } = await supabase
        .from('atm_activity_log')
        .select('*')
        .eq('id', email_id)
        .single();
      if (error) throw error;
      emails = [data];
    } else {
      // Draft for all recent buyer inquiries without a draft yet
      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('atm_activity_log')
        .select('*')
        .eq('classification', 'BUYER_INQUIRY')
        .gte('created_at', since)
        .is('draft_reply', null)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      emails = data || [];
    }

    if (!emails.length) {
      return Response.json({ message: 'No emails need drafts', processed: 0 });
    }

    const results = [];
    for (const email of emails) {
      try {
        const context = await fetchContext(email);
        const draft = await generateDraft(email, context);

        // Save draft back to activity log
        await supabase
          .from('atm_activity_log')
          .update({
            draft_reply: draft,
            draft_generated_at: new Date().toISOString(),
            draft_status: 'pending_review',
          })
          .eq('id', email.id);

        results.push({
          id: email.id,
          from: email.from_email,
          subject: email.subject,
          draft,
          context_found: {
            contact: !!context.contact,
            company: !!context.company,
            deals: context.deals.length,
            email_history: context.recentEmails.length,
          },
        });
      } catch (err) {
        console.error(`Draft failed for email ${email.id}:`, err);
        results.push({ id: email.id, error: err.message });
      }
    }

    return Response.json({ processed: results.length, results });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ message: 'POST with { email_id } or { hours: 24 } to generate drafts.' });
}
