// app/api/deal-hub-view/route.js
//
// View tracker for the Deal Hub.
// Called from app/deals/[token]/page.js on every render.
//
// What it does:
//   - Bumps view_count + last_viewed_at on every view
//   - Sets first_viewed_at ONLY on the first ever view (race-safe via .is() guard)
//   - On first view, logs to atm_activity_log + atm_notifications

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const { token, token_id } = await req.json();

    if (!token || !token_id) {
      return new Response(JSON.stringify({ error: "Missing token or token_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch current row so we can decide first-view vs. repeat-view
    const { data: tokenRow, error: fetchErr } = await supabase
      .from("deal_tokens")
      .select("id, buyer_email, buyer_name, deal_id, token, first_viewed_at, view_count")
      .eq("token", token)
      .maybeSingle();

    if (fetchErr || !tokenRow) {
      console.error("View tracker: token fetch failed", fetchErr?.message);
      return new Response(JSON.stringify({ error: "Token not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const isFirstView = !tokenRow.first_viewed_at;

    // Build the update — always bumps view_count + last_viewed_at
    const updatePayload = {
      view_count: (tokenRow.view_count || 0) + 1,
      last_viewed_at: now,
    };

    // First view ever — set the trigger column for the follow-up sequence
    if (isFirstView) {
      updatePayload.first_viewed_at = now;
    }

    // Race-safe update — if isFirstView, only set first_viewed_at when it's still null
    let updateQuery = supabase
      .from("deal_tokens")
      .update(updatePayload)
      .eq("id", token_id);

    if (isFirstView) {
      updateQuery = updateQuery.is("first_viewed_at", null);
    }

    const { error: updateErr } = await updateQuery;
    if (updateErr) {
      console.error("View tracker update failed:", updateErr.message);
      // Don't fail the response — view tracking is best-effort
    }

    // ─────────────────────────────────────────────────────────────
    // First view side effects: activity log + notification
    // ─────────────────────────────────────────────────────────────
    if (isFirstView) {
      // atm_notifications.deal_id is uuid type — pass null if deal_id isn't a UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const dealIdAsUuid = uuidRegex.test(tokenRow.deal_id || "") ? tokenRow.deal_id : null;

      // Activity log — append-only audit trail
      // Schema columns used: type, activity_type, subject, body, source, source_id, metadata (jsonb)
      try {
        const { error: actErr } = await supabase
          .from("atm_activity_log")
          .insert({
            type: "deal_hub_first_view",
            activity_type: "buyer_engagement",
            subject: `Deal Hub opened: ${tokenRow.buyer_email || "unknown"}`,
            body: `Buyer ${tokenRow.buyer_name || tokenRow.buyer_email || "(no name)"} opened the Deal Hub for the first time. Token ${tokenRow.token.slice(0, 8)}... Follow-up sequence starts in 24h.`,
            source: "deal_hub",
            source_id: tokenRow.token,
            metadata: {
              token: tokenRow.token,
              buyer_email: tokenRow.buyer_email,
              buyer_name: tokenRow.buyer_name,
              deal_id: tokenRow.deal_id,
            },
          });
        if (actErr) console.error("activity_log insert error:", actErr.message);
      } catch (e) {
        console.error("activity_log insert exception:", e);
      }

      // Notification — shows in John's admin panel
      // Schema columns used: type, priority (text), title, message, deal_id (uuid), metadata (text)
      try {
        const { error: notErr } = await supabase
          .from("atm_notifications")
          .insert({
            type: "deal_hub_view",
            priority: "medium",
            title: `${tokenRow.buyer_name || tokenRow.buyer_email || "A buyer"} opened the Deal Hub`,
            message: `First view of the data room. Follow-up sequence will start in 24 hours.`,
            deal_id: dealIdAsUuid,
            metadata: JSON.stringify({
              token: tokenRow.token,
              buyer_email: tokenRow.buyer_email,
              deal_id: tokenRow.deal_id,
            }),
          });
        if (notErr) console.error("notification insert error:", notErr.message);
      } catch (e) {
        console.error("notification insert exception:", e);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        first_view: isFirstView,
        view_count: updatePayload.view_count,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Deal Hub view tracker error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
