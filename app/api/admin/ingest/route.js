import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co", process.env.SUPABASE_SERVICE_ROLE_KEY);

function chunkText(text, size = 300) {
  const words = text.split(/\s+/);
  if (words.length <= size) return [text];
  const chunks = [];
  let start = 0;
  while (start < words.length) { chunks.push(words.slice(start, start + size).join(" ")); start += size - 30; }
  return chunks;
}

export async function POST(request) {
  try {
    const { dealId, dlNumber, text, sourceType, sourceName } = await request.json();
    if (!dealId || !text) return Response.json({ error: "dealId and text required" }, { status: 400 });
    await supabase.from("deal_embeddings").delete().eq("deal_id", dealId).eq("source_type", sourceType || "cim");
    const chunks = chunkText(text);
    const rows = chunks.map((chunk, i) => ({ deal_id: dealId, dl_number: dlNumber || null, content_chunk: chunk, source_type: sourceType || "cim", source_name: sourceName || "CIM", chunk_index: i }));
    const { error } = await supabase.from("deal_embeddings").insert(rows);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true, chunks: chunks.length });
  } catch (err) { return Response.json({ error: err.message }, { status: 500 }); }
}
