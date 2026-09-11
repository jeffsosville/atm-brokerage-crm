import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// CRM assistant chat. Server picks the model and caps output; only signed-in CRM users may call it.
// (Previously this was an open proxy: anyone could call it with any model/max_tokens on our API key.)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export async function POST(request) {
  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: userData } = token ? await supabase.auth.getUser(token) : { data: null };
    if (!userData?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: Math.min(Number(body.max_tokens) || 1000, 1500),
      system: typeof body.system === "string" ? body.system : "",
      messages,
    });
    return Response.json(response);
  } catch (err) {
    console.error("Chat API error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
