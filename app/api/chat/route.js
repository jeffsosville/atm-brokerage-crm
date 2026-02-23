import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(request) {
  try {
    const body = await request.json();
    const response = await anthropic.messages.create({
      model: body.model || "claude-sonnet-4-20250514",
      max_tokens: body.max_tokens || 1000,
      system: body.system || "",
      messages: body.messages || [],
    });
    return Response.json(response);
  } catch (err) {
    console.error("Chat API error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
