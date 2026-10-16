import { adminDb as db } from "../../../../../lib/serverAuth";
import { loadSellerRequest, saveSellerAnswer } from "../../../../../lib/sellerPortal";

// Seller file uploads go straight from the browser to storage (Vercel caps request bodies at ~4.5MB,
// P&Ls and processor exports are often bigger), in two steps:
//   POST { step: "start", item_key, file_name, file_size, file_type } -> { path, token } for uploadToSignedUrl
//   POST { step: "finish", item_key, path, file_name, file_size, file_type, answer_text? } -> records the file + answers the item
export const dynamic = "force-dynamic";

const BUCKET = "deal-files";
const MAX = 50 * 1024 * 1024;
const fail = (error, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const clean = (n) => String(n || "file").replace(/[^\w.\- ]+/g, "_").slice(-120);

export async function POST(request, { params }) {
  const ctx = await loadSellerRequest(params.token);
  if (ctx.error) return fail(ctx.error, ctx.status);
  const { req, route } = ctx;
  if (!route.deal_id) return fail("Uploads aren't set up for this listing yet. Email the file to your broker.");
  const body = await request.json().catch(() => ({}));
  const key = String(body.item_key || "");
  if (!key) return fail("item_key required");
  const folder = `deals/${route.deal_id}/seller/${req.id}/`;

  if (body.step === "start") {
    if (Number(body.file_size) > MAX) return fail("That file is over 50MB. Email it to your broker instead.");
    const path = `${folder}${Date.now()}-${key}-${clean(body.file_name)}`;
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) return fail("Upload couldn't start: " + error.message, 500);
    return Response.json({ path: data.path || path, token: data.token });
  }

  if (body.step === "finish") {
    const path = String(body.path || "");
    if (!path.startsWith(folder)) return fail("Bad upload path");
    const name = path.slice(folder.length);
    const { data: found } = await db.storage.from(BUCKET).list(folder.replace(/\/$/, ""), { search: name, limit: 1 });
    if (!found?.length) return fail("The file didn't finish uploading. Try again.");

    const fileName = clean(body.file_name);
    const { error: dbError } = await db.from("listing_files").insert({
      listing_id: route.deal_id, file_name: fileName, file_type: body.file_type || null,
      file_size: Number(body.file_size) || null, storage_path: path, uploaded_by: "seller", is_active: true,
    });
    if (dbError) return fail("Couldn't save the file record: " + dbError.message, 500);

    try {
      const row = await saveSellerAnswer({
        req, route, item_key: key, choice: "answer",
        answer_text: body.answer_text, fileNote: `File uploaded: ${fileName}`,
      });
      const { data: score } = await db.from("v_route_dd_score").select("dd_score").eq("route_id", route.id).maybeSingle();
      return Response.json({ ok: true, state: row.status, score: Number(score?.dd_score || 0), file_name: fileName });
    } catch (e) {
      return fail(e.message);
    }
  }

  return fail("Unknown step");
}
