import Anthropic from "@anthropic-ai/sdk";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const supaFetch = async (path) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  return r.json();
};

const supaPost = async (table, data) => {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(data),
  });
};

export async function POST(request) {
  try {
    const { dealId, question, token, buyerName, buyerEmail, buyerPhone, history } = await request.json();
    if (!dealId || !question) {
      return Response.json({ error: "dealId and question required" }, { status: 400 });
    }

    const deals = await supaFetch(`atm_deals?id=eq.${dealId}&select=*`);
    const deal = deals?.[0];

    const chunks = await supaFetch(
      `deal_embeddings?deal_id=eq.${dealId}&select=content_chunk,source_type,source_name&order=source_type.asc,chunk_index.asc`
    );
    const context = (chunks || []).map((c) => c.content_chunk).join("\n\n");

    const messages = [];
    if (history && history.length > 0) {
      for (const msg of history.slice(-6)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: "user", content: question });

    const buyerLine = buyerName || buyerEmail
      ? `\nBUYER: ${buyerName || "Unknown"}${buyerEmail ? " | " + buyerEmail : ""}${buyerPhone ? " | " + buyerPhone : ""}`
      : "";

    const systemPrompt = `You are the Deal Concierge for ATM Brokerage. You help prospective buyers understand ATM route listings and answer their questions.

DEAL INFORMATION:
${deal ? `Name: ${deal.deal_name || "ATM Route Listing"}
DL#: ${deal.dl_number || "N/A"}
Asking Price: $${deal.asking_price ? Number(deal.asking_price).toLocaleString() : "Contact for pricing"}
ATM Count: ${deal.atm_count || "N/A"}
Location: ${deal.route_cities || ""} ${deal.route_state || ""}` : "Deal information unavailable."}${buyerLine}

DEAL DOCUMENTS AND DATA:
${context}

RULES:
1. Answer based ONLY on the deal documents and data above, plus general ATM industry knowledge.
2. NEVER reveal the seller's identity, personal information, or company name.
3. NEVER share internal notes, broker communications, or confidential strategy.
4. Be helpful and professional without being pushy.
5. If you don't know something, say so and provide contact info: Phone: +1 888-430-5535, Email: info@atmbrokerage.com, Website: https://atmbrokerage.com
6. Use specific numbers from the data when discussing financials.
7. Naturally qualify the buyer by asking about budget, timeline, experience when relevant.
8. If the buyer seems serious, suggest they reach out directly: Phone: +1 888-430-5535 or Email: info@atmbrokerage.com
9. Keep answers concise but thorough.`;

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages,
    });

    const answer = response.content[0]?.text || "I'm having trouble responding. Please try again.";
    const lowerAnswer = answer.toLowerCase();
    const escalated = lowerAnswer.includes("speak with") || lowerAnswer.includes("connect you with") || lowerAnswer.includes("advisor") || lowerAnswer.includes("don't have that information");
    const confidence = escalated ? 0.5 : 0.85;

    // Save question with full buyer identity
    await supaPost("deal_questions", {
      deal_id: dealId,
      dl_number: deal?.dl_number,
      buyer_session: token || null,
      buyer_name: buyerName || null,
      buyer_email: buyerEmail || null,
      buyer_phone: buyerPhone || null,
      question,
      ai_answer: answer,
      ai_confidence: confidence,
      escalated,
    });

    // Notify John on escalation — with full buyer info
    if (escalated) {
      await supaPost("atm_notifications", {
        type: "escalation",
        title: `Buyer needs help: ${buyerName || buyerEmail || "Unknown buyer"} → ${deal?.deal_name}`,
        message: `"${question.substring(0, 200)}"${buyerEmail ? "\n\nReply to: " + buyerEmail : ""}${buyerPhone ? " | " + buyerPhone : ""}`,
        priority: "high",
        metadata: JSON.stringify({
          deal_id: dealId,
          buyer_name: buyerName || null,
          buyer_email: buyerEmail || null,
          buyer_phone: buyerPhone || null,
          token: token || null,
        }),
        suggested_action: buyerEmail ? "Reply to " + buyerEmail : "Answer buyer question in Deal Hub",
      });
    }

    await supaPost("atm_activity_log", {
      type: "concierge",
      subject: `Buyer question: ${question.substring(0, 100)}`,
      body_preview: answer.substring(0, 200),
      date: new Date().toISOString(),
      metadata: JSON.stringify({
        deal_id: dealId,
        dl_number: deal?.dl_number,
        buyer_name: buyerName || null,
        buyer_email: buyerEmail || null,
        buyer_phone: buyerPhone || null,
        token: token || null,
        confidence,
        escalated,
      }),
    });

    return Response.json({ answer, confidence, escalated, dlNumber: deal?.dl_number, sources: (chunks || []).length });
  } catch (err) {
    console.error("Concierge error:", err);
    return Response.json({ error: "Something went wrong", answer: "I'm having trouble right now. Please contact info@atmbrokerage.com." }, { status: 500 });
  }
}
