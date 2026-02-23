import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co", process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function POST(request) {
  try {
    const { dealId } = await request.json();
    if (!dealId) return Response.json({ error: "dealId required" }, { status: 400 });
    const token = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from("deal_tokens").insert({ deal_id: dealId, listing_id: dealId, token, expires_at: expiresAt });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true, token, expires_at: expiresAt });
  } catch (err) { return Response.json({ error: err.message }, { status: 500 }); }
}
