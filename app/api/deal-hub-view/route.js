// app/api/deal-hub-view/route.js
//
// View tracker endpoint for the Deal Hub.
// Called from app/deals/[token]/page.js on every render.
//
// Two modes:
//   - First view: sets first_viewed_at (if still null) AND bumps view_count
//   - Subsequent views: just bumps view_count + last_viewed_at
//
// All operations are race-safe via `.is('first_viewed_at', null)` guard.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req) {
  try {
    const { token, token_id, bump_only } = await req.json();

    if (!token || !token_id) {
      return new Response(JSON.stringify({ error: "Missing token or token_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch current row so we can decide what to do + log properly
    const { data: tokenRow, error: fetchErr } = await supabase
      .from("deal_tokens")
      .select("id, buyer_email, buyer_name, deal_id, token, first_viewed_at, view_count")
      .eq("token", token)
      .maybeSingle();

    if (fetchErr || !tokenRow) {
      return new Response(JSON.stringify({ error: "Token not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const isFirstView = !tokenRow.first_viewed_at && !bump_only;

    // Build the update — always bumps view_count + last_viewed_at
    const updatePayload = {
      view_count: (tokenRow.view_count || 0) + 1,
      last_viewed_at: now,
    };

    // First view ever — set the trigger column AND log it
    if (isFirstView) {
      updatePayload.first_viewed_at = now;
    }

    // Race-safe update
    const updateQuery = supabase
      .from("deal_tokens")
      .update(updatePayload)
      .eq("id", token_id);

    // Only set first_viewed_at if it's STILL null (handles concurrent requests)
    if (isFirstView) {
      updateQuery.is("first_viewed_at", null);
    }

    const { error: updateErr } = await updateQuery;
    if (updateErr) {
      console.error("View tracker update failed:", updateErr);
      // Don't fail the response — view tracking is best-effort
    }

    // Log the first view to activity feed + notifications
    if (isFirstView) {
      // Activity log — append-only audit trail
      await supabase
        .from("atm_activity_log")
        .insert({
          type: "deal_hub_first_view",
          subject: `Deal Hub opened: ${tokenRow.buyer_email || "unknown"}`,
          body_preview: `Token ${tokenRow.token.slice(0, 8)}... First view. Follow-up sequence starts in 24h.`,
          date: now,
          metadata: JSON.stringify({
            token: tokenRow.token,
            buyer_email: tokenRow.buyer_email,
            buyer_name: tokenRow.buyer_name,
            deal_id: tokenRow.deal_id,
          }),
        })
        .then((r) => r)
        .catch((e) => console.error("activity log failed:", e));

      // Notification — surfaces in John's admin panel
      await supabase
        .from("atm_notifications")
        .insert({
          type: "deal_hub_view",
          title: `${tokenRow.buyer_name || tokenRow.buyer_email || "A buyer"} opened the Deal Hub`,
          message: `First view of the data room. Follow-up sequence will start in 24 hours.`,
          priority: 2,
          metadata: JSON.stringify({
            token: tokenRow.token,
            buyer_email: tokenRow.buyer_email,
            deal_id: tokenRow.deal_id,
          }),
        })
        .then((r) => r)
        .catch((e) => console.error("notification failed:", e));
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
