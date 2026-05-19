import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/answer-context?token=[responder_token]&q=[question_id]
 *
 * Called by /answer/[token] on load.
 * Returns responder identity, the question, and any existing answers.
 * Seller sees question but NOT buyer identity.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const questionId = searchParams.get('q');

  if (!token || !questionId) {
    return NextResponse.json({ error: 'token and q required' }, { status: 400 });
  }

  // Validate responder token
  const { data: responder } = await supabase
    .from('deal_responder_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (!responder) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 401 });
  }

  // Get the question
  const { data: question } = await supabase
    .from('deal_questions')
    .select('id, question, ai_answer, escalated, buyer_name, buyer_email, dl_number')
    .eq('id', questionId)
    .eq('deal_id', responder.deal_id) // scope check — question must belong to this deal
    .maybeSingle();

  if (!question) {
    return NextResponse.json({ error: 'Question not found' }, { status: 404 });
  }

  // Get existing answers
  const { data: existingAnswers } = await supabase
    .from('deal_answers')
    .select('id, answered_by_name, answered_by_role, answer, answered_at, is_public')
    .eq('question_id', questionId)
    .eq('is_deleted', false)
    .order('answered_at', { ascending: true });

  // Get deal name
  const { data: deal } = await supabase
    .from('atm_deals')
    .select('deal_name, dl_number')
    .eq('id', responder.deal_id)
    .maybeSingle();

  // Strip buyer identity from seller view
  const questionForResponder = {
    ...question,
    deal_name: deal?.deal_name ?? null,
    buyer_name: responder.role === 'seller' ? null : question.buyer_name,
    buyer_email: responder.role === 'seller' ? null : question.buyer_email,
    ai_answer: responder.role === 'seller' ? null : question.ai_answer, // AI answer only for advisors
  };

  return NextResponse.json({
    responder: {
      name: responder.name,
      role: responder.role,
    },
    question: questionForResponder,
    existing_answers: existingAnswers ?? [],
  });
}
