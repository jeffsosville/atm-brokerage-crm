// Buyer-side deal room access. A deal room link (deal_tokens.token) is the buyer's only credential:
// it is checked on the server for every read, and it only ever opens its own deal.
import { adminDb as db } from "./serverAuth";

const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;

// Returns { t, dealId } for a live token, or { error, status }.
export async function loadDealToken(token) {
  if (!token || !TOKEN_RE.test(String(token))) return { error: "Invalid or expired link.", status: 404 };
  const { data: t } = await db.from("deal_tokens").select("*").eq("token", token).maybeSingle();
  if (!t || t.revoked_at) return { error: "Invalid or expired link.", status: 404 };
  if (t.expires_at && new Date(t.expires_at) < new Date()) return { error: "This link has expired.", status: 410 };
  const dealId = t.deal_id || t.listing_id;
  if (!dealId) return { error: "Invalid or expired link.", status: 404 };
  return { t, dealId: String(dealId) };
}

// Files a buyer may see: active, and not marked private (seller uploads stay private until the broker shares them).
export const buyerFilesQuery = (dealId) =>
  db.from("listing_files")
    .select("id, file_name, file_type, file_size, uploaded_at, storage_path")
    .eq("listing_id", dealId).eq("is_active", true).eq("buyer_visible", true)
    .order("uploaded_at", { ascending: false });

// Deal fields the deal room page shows. Nothing about the seller.
export const DEAL_FIELDS = "id, deal_name, dl_number, asking_price, atm_count, route_cities, route_state, deal_type";

// Answered questions buyers may read: broker/advisor answers, plus seller answers the broker has published.
export async function buyerQA(dealId) {
  const { data: answers } = await db.from("deal_answers")
    .select("id, answered_by_name, answered_by_role, answer, answered_at, question_id, is_public")
    .eq("deal_id", dealId).eq("is_deleted", false).order("answered_at", { ascending: true });
  const ok = (answers || []).filter((a) => a.answered_by_role !== "seller" || a.is_public === true);
  if (!ok.length) return [];
  const qIds = [...new Set(ok.map((a) => a.question_id))];
  const { data: questions } = await db.from("deal_questions").select("id, question").in("id", qIds);
  const map = {};
  (questions || []).forEach((q) => { map[q.id] = { id: q.id, question: q.question, answers: [] }; });
  ok.forEach((a) => {
    if (map[a.question_id]) {
      const { is_public, question_id, ...rest } = a;
      map[a.question_id].answers.push(rest);
    }
  });
  return Object.values(map).filter((q) => q.answers.length);
}
