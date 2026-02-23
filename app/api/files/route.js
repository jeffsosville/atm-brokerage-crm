import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path");
  if (!path) return Response.json({ error: "path required" }, { status: 400 });

  const { data, error } = await supabase.storage
    .from("deal-files")
    .createSignedUrl(path, 3600);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ url: data.signedUrl });
}
