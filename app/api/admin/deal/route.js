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
