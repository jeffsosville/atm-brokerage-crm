import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function classifyEmail(email) {
  const prompt = `You are a classifier for ATM Brokerage, a business that buys and sells ATM route businesses.

Classify the following email as one of:
- BUYER_INQUIRY    : Someone interested in buying an ATM business (asking about listings, pricing, availability, financing, wanting to schedule a call)
- SELLER_INQUIRY   : Someone wanting to sell their ATM business
- EXISTING_DEAL    : Follow-up from a known deal in progress (references a specific business, LOI, due diligence, closing)
- VENDOR           : Supplier, service provider, or partner outreach
- SPAM             : Unsolicited marketing, irrelevant cold outreach
- OTHER            : Anything else (internal, admin, personal)

Email:
From: ${email.from_email}
Subject: ${email.subject}
Body: ${email.snippet}

Respond with ONLY a JSON object, no markdown:
{
  "classification": "BUYER_INQUIRY",
  "confidence": 0.95,
  "reason": "one sentence explanation",
  "urgency": "high|medium|low",
  "suggested_action": "one sentence on what John should do"
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  return JSON.parse(response.content[0].text.trim());
}

export async function POST(request) {
  try {
    const { hours = 24, dry_run = false } = await request.json().catch(() => ({}));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const { data: emails, error } = await supabase
      .from('atm_activity_log')
      .select('id, from_email, subject, snippet, gmail_id, created_at')
      .eq('type', 'email_received')
      .gte('created_at', since)
      .is('classification', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    if (!emails?.length) {
      return Response.json({ message: 'No unclassified emails found', processed: 0 });
    }

    const results = [];
    for (const email of emails) {
      try {
        const classification = await classifyEmail(email);

        if (!dry_run) {
          await supabase
            .from('atm_activity_log')
            .update({
              classification: classification.classification,
              classification_confidence: classification.confidence,
              classification_reason: classification.reason,
              urgency: classification.urgency,
              suggested_action: classification.suggested_action,
              classified_at: new Date().toISOString(),
            })
            .eq('id', email.id);
        }

        results.push({ id: email.id, from: email.from_email, subject: email.subject, ...classification });
      } catch (err) {
        results.push({ id: email.id, error: err.message });
      }
    }

    return Response.json({
      processed: results.length,
      buyer_inquiries: results.filter(r => r.classification === 'BUYER_INQUIRY').length,
      dry_run,
      results,
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ message: 'POST with { hours: 24, dry_run: true } to test.' });
}
