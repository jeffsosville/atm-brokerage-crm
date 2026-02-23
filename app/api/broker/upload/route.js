import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const dealId = formData.get("dealId");
    if (!file || !dealId) return Response.json({ error: "File and dealId required" }, { status: 400 });

    const fileName = file.name;
    const fileType = file.type;
    const fileSize = file.size;
    const buffer = Buffer.from(await file.arrayBuffer());
    const storagePath = `deals/${dealId}/${Date.now()}-${fileName}`;

    const { error: uploadError } = await supabase.storage.from("deal-files").upload(storagePath, buffer, { contentType: fileType, upsert: false });
    if (uploadError) { console.error("Upload error:", uploadError); return Response.json({ error: "Failed to upload" }, { status: 500 }); }

    const { data: fileRecord, error: dbError } = await supabase.from("listing_files").insert({
      listing_id: dealId, file_name: fileName, file_type: fileType, file_size: fileSize,
      storage_path: storagePath, uploaded_by: "broker", is_active: true,
    }).select().single();

    if (dbError) {
      await supabase.storage.from("deal-files").remove([storagePath]);
      return Response.json({ error: "Failed to save record" }, { status: 500 });
    }

    return Response.json({ id: fileRecord.id, file_name: fileName, file_size: fileSize, message: "Uploaded" });
  } catch (err) {
    console.error("Upload error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const dealId = searchParams.get("dealId");
  if (!dealId) return Response.json({ error: "dealId required" }, { status: 400 });
  const { data, error } = await supabase.from("listing_files").select("*").eq("listing_id", dealId).eq("is_active", true).order("uploaded_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data || []);
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("fileId");
  if (!fileId) return Response.json({ error: "fileId required" }, { status: 400 });
  const { error } = await supabase.from("listing_files").update({ is_active: false }).eq("id", fileId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ deleted: true });
}
