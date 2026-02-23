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
