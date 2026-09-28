import { adminDb as db } from "./serverAuth";

// Due-diligence checklist answers for a deal, formatted for the concierge (and later the email drafts).
// - Uses answered items only: verified, received, partial, declined, n/a.
// - Skips answers with no source (an unsourced number is worse than a blank) and internal items.
// - NDA-level items only when the caller has a valid Deal Room token for this deal.
const LABEL = {
  verified: "VERIFIED",
  received: "from seller/files, not yet verified",
  partial: "partial answer",
  declined: "seller declined to provide",
  na: "not applicable",
};

export async function hasDealAccess(token, dealId) {
  if (!token || !dealId) return false;
  const { data } = await db
    .from("deal_tokens")
    .select("deal_id, expires_at, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (!data || data.revoked_at) return false;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return false;
  return String(data.deal_id) === String(dealId);
}

export async function ddContextForDeal(dealId, { includeNda = false } = {}) {
  const { data: routes } = await db.from("atm_routes").select("id").eq("deal_id", dealId);
  const routeIds = (routes || []).map((r) => r.id);
  if (!routeIds.length) return { text: "", count: 0 };

  const { data: items } = await db
    .from("v_route_dd_items")
    .select("section, label, status, state, visibility, answer_text, source_who, source_method, source_date, declined_reason, sort_order")
    .in("route_id", routeIds)
    .in("status", Object.keys(LABEL))
    .order("sort_order");

  const rows = (items || []).filter((i) =>
    i.visibility !== "internal" &&
    (includeNda || i.visibility === "public") &&
    i.state !== "filled_unsourced" &&
    ((i.answer_text || "").trim() || i.status === "declined" || i.status === "na")
  );

  const lines = rows.map((i) => {
    const answer = i.status === "declined" ? (i.declined_reason || "declined") : (i.answer_text || "").trim();
    const source = [i.source_who, i.source_method, i.source_date].filter(Boolean).join(", ");
    return `- ${i.label}: ${answer} [${LABEL[i.status]}${source ? `; source: ${source}` : ""}]`;
  });
  return { text: lines.join("\n"), count: lines.length };
}
