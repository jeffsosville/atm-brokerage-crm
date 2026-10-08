import { createClient } from "@supabase/supabase-js";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const body = await request.json();
    const { data, error } = await supabase.from("atm_deals").insert({
      deal_name: body.deal_name,
      atm_count: body.atm_count || null,
      asking_price: body.asking_price || null,
      route_state: body.route_state || null,
      route_cities: body.route_cities || null,
      stage: body.stage || "prospect",
    }).select();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json(data);
  } catch (err) { return Response.json({ error: err.message }, { status: 500 }); }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const { dealId, ...fields } = body;
    if (!dealId) return Response.json({ error: "dealId required" }, { status: 400 });

    // Only allow these fields to be updated
    const allowed = ["deal_name", "atm_count", "asking_price", "route_state", "route_cities", "stage"];
    const updates = {};
    for (const key of allowed) {
      if (key in fields) updates[key] = fields[key] === "" ? null : fields[key];
    }
    if (Object.keys(updates).length === 0) {
      return Response.json({ error: "No editable fields provided" }, { status: 400 });
    }

    // Archiving = closing: stamp the close date and take the route off the active lists
    // (DD queue, inbox matching, website sync) without deleting anything.
    if (updates.stage === "closed") {
      const { data: cur } = await supabase.from("atm_deals").select("closed_at").eq("id", dealId).maybeSingle();
      if (cur && !cur.closed_at) updates.closed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from("atm_deals")
      .update(updates)
      .eq("id", dealId)
      .select();
    if (error) return Response.json({ error: error.message }, { status: 500 });

    if (updates.stage === "closed" || updates.stage === "dead_deal") {
      await supabase.from("atm_routes").update({ status: updates.stage === "closed" ? "sold" : "hidden" })
        .eq("deal_id", dealId).in("status", ["active", "pending"]);
    }
    return Response.json(data);
  } catch (err) { return Response.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const dealId = searchParams.get("dealId");
    if (!dealId) return Response.json({ error: "dealId required" }, { status: 400 });

    // Delete all related records first
    await supabase.from("deal_embeddings").delete().eq("deal_id", dealId);
    await supabase.from("deal_tokens").delete().eq("deal_id", dealId);
    await supabase.from("deal_buyer_access").delete().eq("deal_id", dealId);
    await supabase.from("listing_files").delete().eq("listing_id", dealId);
    await supabase.from("atm_activity_log").delete().eq("metadata->>deal_id", dealId);

    // Delete the deal itself
    const { error } = await supabase.from("atm_deals").delete().eq("id", dealId);
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ success: true });
  } catch (err) { return Response.json({ error: err.message }, { status: 500 }); }
}
