import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { responder_token, question_id, answer, is_public } = await request.json();

    if (!responder_token || !question_id || !answer?.trim()) {
      return Response.json({ error: "responder_token, question_id, and answer required" }, { status: 400 });
    }

    const { data: responder } = await supabase
      .from("deal_responder_tokens")
      .select("*")
      .eq("token", responder_token)
      .maybeSingle();

    if (!responder) {
      return Response.json({ error: "Invalid answer link" }, { status: 401 });
    }

    const { data: question } = await supabase
      .from("deal_questions")
      .select("*")
      .eq("id", question_id)
      .maybeSingle();

    if (!question) {
      return Response.json({ error: "Question not found" }, { status: 404 });
    }

    const { data: savedAnswer, error: answerErr } = await supabase
      .from("deal_answers")
      .insert({
        question_id,
        deal_id: responder.deal_id,
        listing_slug: responder.listing_slug,
        answered_by_name: responder.name,
        answered_by_role: responder.role,
        answer: answer.trim(),
        // Seller answers never auto-public — John toggles after review
        is_public: responder.role === "seller" ? false : (is_public ?? false),
      })
      .select()
      .single();

    if (answerErr) {
      console.error("[qa-answer] insert error:", answerErr.message);
      return Response.json({ error: "Failed to save answer" }, { status: 500 });
    }

    // Clear escalation flag on the question
    await supabase
      .from("deal_questions")
      .update({ escalated: false })
      .eq("id", question_id);

    // Ingest into deal_embeddings so concierge learns this answer (fire and forget)
    ingestAnswer({
      deal_id: responder.deal_id,
      question: question.question,
      answer: answer.trim(),
      answered_by: responder.name,
    }).catch(err => console.error("[ingest] non-fatal:", err));

    // Update last_used_at
    supabase.from("deal_responder_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", responder.id)
      .then(() => {});

    return Response.json({
      success: true,
      answer_id: savedAnswer.id,
      is_public: savedAnswer.is_public,
      message: responder.role === "seller"
        ? "Answer saved. ATM Brokerage will review before publishing."
        : is_public
          ? "Answer saved and published to the listing FAQ."
          : "Answer saved to the deal hub.",
    });

  } catch (err) {
    console.error("[qa-answer] error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}

// Toggle is_public on an existing answer — called from admin panel
export async function PATCH(request) {
  try {
    const { answer_id, is_public } = await request.json();
    if (!answer_id || typeof is_public !== "boolean") {
      return Response.json({ error: "answer_id and is_public required" }, { status: 400 });
    }
    const { error } = await supabase
      .from("deal_answers")
      .update({ is_public })
      .eq("id", answer_id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true, is_public });
  } catch (err) {
    console.error("[qa-answer PATCH] error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}

async function ingestAnswer({ deal_id, question, answer, answered_by }) {
  const chunk = `Q: ${question}\nA (${answered_by}): ${answer}`;
  await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deal_embeddings`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      deal_id,
      content_chunk: chunk,
      source_type: "qa_answer",
      source_name: "Buyer Q&A",
      chunk_index: Date.now(),
    }),
  });
}
