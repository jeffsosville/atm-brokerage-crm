import { createClient } from "@supabase/supabase-js";
import { isSharedLink } from "../../../lib/team";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { token, buyer_name, buyer_email, buyer_phone } = await request.json();
    if (!token || !buyer_email) {
      return Response.json({ error: "token and buyer_email required" }, { status: 400 });
    }
    const { data: t } = await supabase.from("deal_tokens").select("id, buyer_email, source_url").eq("token", token).maybeSingle();
    if (!t) return Response.json({ error: "Invalid link" }, { status: 404 });
    // Shared link (opened by staff, given to many buyers): keep it as is; the visitor's details travel with their questions.
    if (isSharedLink(t)) return Response.json({ success: true, shared: true });
    const { error } = await supabase
      .from("deal_tokens")
      .update({ buyer_name: buyer_name || null, buyer_email, buyer_phone: buyer_phone || null })
      .eq("token", token);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
