import { adminDb as db } from "../../../../lib/serverAuth";
import { loadDealToken, buyerFilesQuery, buyerQA, DEAL_FIELDS } from "../../../../lib/dealRoom";

// Everything the buyer's deal room page needs, checked against the deal room link on the server.
// Replaces the page's old direct database reads (which needed the database open to everyone).
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function GET(_request, { params }) {
  const ctx = await loadDealToken(params.token);
  if (ctx.error) return Response.json({ error: ctx.error }, { status: ctx.status, headers: noStore });
  const { t, dealId } = ctx;

  const [{ data: deal }, { data: files }, qa] = await Promise.all([
    db.from("atm_deals").select(DEAL_FIELDS).eq("id", dealId).maybeSingle(),
    buyerFilesQuery(dealId),
    buyerQA(dealId),
  ]);

  return Response.json({
    token: { id: t.id, buyer_name: t.buyer_name || "", buyer_email: t.buyer_email || "", buyer_phone: t.buyer_phone || "" },
    deal: deal || null,
    // storage paths never leave the server; downloads go through /api/files with the token
    files: (files || []).map(({ storage_path, ...f }) => f),
    qa,
  }, { headers: noStore });
}
