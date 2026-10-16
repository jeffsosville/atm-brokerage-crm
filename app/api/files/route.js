import { adminDb as db, getUser } from "../../../lib/serverAuth";
import { loadDealToken } from "../../../lib/dealRoom";

// Short-lived download link for one deal file.
//   Buyers:    GET /api/files?id=<file id>&token=<deal room link>   — only files shared with buyers on that deal
//   CRM users: GET /api/files?id=<file id>  (Authorization: Bearer <session>) — any file
// Never signs an arbitrary storage path.
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const token = searchParams.get("token");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const { data: file } = await db.from("listing_files")
    .select("id, listing_id, storage_path, is_active, buyer_visible").eq("id", id).maybeSingle();
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });

  const user = await getUser(request);
  if (!user) {
    const ctx = await loadDealToken(token);
    if (ctx.error) return Response.json({ error: ctx.error }, { status: 403 });
    if (String(file.listing_id) !== ctx.dealId || !file.is_active || file.buyer_visible !== true) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
  }

  const { data, error } = await db.storage.from("deal-files").createSignedUrl(file.storage_path, 300);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!user) {
    db.from("file_access_logs").insert({ file_id: file.id, token, accessed_at: new Date().toISOString() }).then(() => {}, () => {});
  }
  return Response.json({ url: data.signedUrl });
}
