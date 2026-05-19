import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/admin/qa-answer
 *
 * Called by the /answer/[token] page when someone submits an answer.
 * Validates the responder token, saves to deal_answers, optionally
 * marks is_public which surfaces it on the listing FAQ page.
 *
 * Also ingests the answer into deal_embeddings so the AI concierge
 * stops escalating the same question in future.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { responder_token, question_id, answer, is_public } = await req.json();

    if (!responder_token || !question_id || !answer?.trim()) {
      return NextResponse.json(
        { error: 'responder_token, question_id, and answer required' },
        { status: 400 }
      );
    }

    // Validate responder token
    const { data: responder } = await supabase
      .from('deal_responder_tokens')
      .select('*')
      .eq('token', responder_token)
      .maybeSingle();

    if (!responder) {
      return NextResponse.json({ error: 'Invalid answer link' }, { status: 401 });
    }

    // Get the question for context
    const { data: question } = await supabase
      .from('deal_questions')
      .select('*')
      .eq('id', question_id)
      .maybeSingle();

    if (!question) {
      return NextResponse.json({ error: 'Question not found' }, { status: 404 });
    }

    // Save the answer
    const { data: savedAnswer, error: answerErr } = await supabase
      .from('deal_answers')
      .insert({
        question_id,
        deal_id: responder.deal_id,
        listing_slug: responder.listing_slug,
        answered_by_name: responder.name,
        answered_by_role: responder.role,
        answer: answer.trim(),
        is_public: responder.role === 'seller' ? false : (is_public ?? false),
        // Seller answers are never auto-public — John toggles after review
      })
      .select()
      .single();

    if (answerErr) {
      console.error('[qa-answer] insert error:', answerErr.message);
      return NextResponse.json({ error: 'Failed to save answer' }, { status: 500 });
    }

    // Mark question as no longer escalated
    await supabase
      .from('deal_questions')
      .update({ escalated: false })
      .eq('id', question_id);

    // Ingest answer into deal_embeddings so AI concierge learns it
    // Fire-and-forget — don't block the response
    void ingestAnswerIntoEmbeddings({
      deal_id: responder.deal_id,
      question: question.question,
      answer: answer.trim(),
      answered_by: responder.name,
    });

    // Update responder last_used_at
    void supabase
      .from('deal_responder_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', responder.id);

    return NextResponse.json({
      success: true,
      answer_id: savedAnswer.id,
      is_public: savedAnswer.is_public,
      message: responder.role === 'seller'
        ? 'Answer saved. ATM Brokerage will review before publishing.'
        : is_public
          ? 'Answer saved and published to the listing FAQ.'
          : 'Answer saved to the deal hub.',
    });

  } catch (err) {
    console.error('[qa-answer] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/qa-answer
 * Toggle is_public on an existing answer (John only, from admin panel)
 */
export async function PATCH(req: NextRequest) {
  try {
    const { answer_id, is_public } = await req.json();
    if (!answer_id || typeof is_public !== 'boolean') {
      return NextResponse.json({ error: 'answer_id and is_public required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('deal_answers')
      .update({ is_public })
      .eq('id', answer_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, is_public });
  } catch (err) {
    console.error('[qa-answer PATCH] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

async function ingestAnswerIntoEmbeddings(args: {
  deal_id: string;
  question: string;
  answer: string;
  answered_by: string;
}) {
  try {
    // Format as Q&A chunk — same format as ingest-faq
    const chunk = `Q: ${args.question}\nA (${args.answered_by}): ${args.answer}`;

    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deal_embeddings`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        deal_id: args.deal_id,
        content_chunk: chunk,
        source_type: 'qa_answer',
        source_name: 'Buyer Q&A',
        chunk_index: Date.now(), // unique enough for one-off inserts
      }),
    });
  } catch (err) {
    console.error('[ingestAnswerIntoEmbeddings] failed (non-fatal):', err);
  }
}
