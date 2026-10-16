// Seller due-diligence portal: shared server helpers.
// A seller gets one tokenized link per listing (dd_seller_requests.token) and answers every
// checklist item with one of three choices, like a mortgage application:
//   answer  -> status 'received' (the seller's answer or file, verified later by us)
//   soon    -> status 'coming_soon' with an expected date
//   decline -> status 'declined' ("will not be provided now or ever"); scores 1/3 credit
// Items we have already verified are shown as done and can't be changed by the seller.
import { adminDb as db } from "./serverAuth";
import { BRANDS, PHONE } from "./brands";
import { DEAL_HUB } from "./dealHub";

export const SELLER_LOCKED = ["verified", "na"];
export const SELLER_CHOICES = ["answer", "soon", "decline"];

export const sellerUrl = (token) => `${DEAL_HUB.replace(/\/$/, "")}/seller/${token}`;

let verticalSlugs = null;
export async function verticalSlug(verticalId) {
  if (!verticalSlugs) {
    const { data } = await db.from("verticals").select("id, slug");
    verticalSlugs = Object.fromEntries((data || []).map((v) => [v.id, v.slug]));
  }
  return verticalSlugs[verticalId] || "atm";
}

export const brandForSlug = (slug) => BRANDS[slug] || BRANDS.atm;
export { PHONE };

// Returns { req, route, brand } for a live token, or { error, status }.
export async function loadSellerRequest(token) {
  if (!token || !/^[a-f0-9]{24,64}$/i.test(token)) return { error: "This link isn't valid.", status: 404 };
  const { data: req } = await db.from("dd_seller_requests").select("*").eq("token", token).maybeSingle();
  if (!req || req.revoked_at) return { error: "This link isn't valid anymore. Ask your broker for a new one.", status: 404 };
  if (req.expires_at && new Date(req.expires_at) < new Date()) {
    return { error: "This link has expired. Ask your broker for a new one.", status: 410 };
  }
  const { data: route } = await db.from("atm_routes")
    .select("id, slug, title, status, deal_id, vertical_id, seller_contact_name, seller_contact_email")
    .eq("id", req.route_id).maybeSingle();
  if (!route) return { error: "This listing is no longer available.", status: 404 };
  const slug = await verticalSlug(route.vertical_id);
  return { req, route, vertical: slug, brand: brandForSlug(slug) };
}

// Writes one seller answer to the checklist. Returns the saved row or throws.
export async function saveSellerAnswer({ req, route, item_key, choice, answer_text, expected_date, reason, fileNote }) {
  if (!SELLER_CHOICES.includes(choice)) throw new Error("Pick one of the three options.");
  const { data: item } = await db.from("v_route_dd_items").select("item_key, status, state, answer_text")
    .eq("route_id", route.id).eq("item_key", item_key).maybeSingle();
  if (!item) throw new Error("That item isn't on this checklist.");
  if (SELLER_LOCKED.includes(item.state)) throw new Error("This item is already complete.");

  const now = new Date().toISOString();
  const who = req.seller_name || req.seller_email || "Seller";
  const row = {
    route_id: route.id, item_key, updated_by: "seller portal", updated_at: now,
    seller_answered_at: now, source_who: who, source_method: "form", source_date: now.slice(0, 10),
    closed_at: null, expected_date: null, declined_reason: null, declined_at: null,
  };

  if (choice === "answer") {
    const text = String(answer_text || "").trim();
    const merged = [text, fileNote].filter(Boolean).join("\n");
    if (!merged) throw new Error("Type an answer or attach a file.");
    row.status = "received";
    row.answer_text = merged.slice(0, 4000);
  } else if (choice === "soon") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expected_date || ""))) throw new Error("Pick the date you expect to have it.");
    if (expected_date < now.slice(0, 10)) throw new Error("Pick a date from today on.");
    row.status = "coming_soon";
    row.expected_date = expected_date;
    if (answer_text && String(answer_text).trim()) row.source_note = "Seller: " + String(answer_text).trim().slice(0, 500);
  } else {
    row.status = "declined";
    row.declined_at = now.slice(0, 10);
    row.closed_at = now;
    row.declined_reason = String(reason || "").trim().slice(0, 500) || "Seller will not provide this";
  }

  const { data, error } = await db.from("route_dd_items").upsert(row, { onConflict: "route_id,item_key" }).select().single();
  if (error) throw new Error(error.message);

  const { count } = await db.from("route_dd_items").select("id", { count: "exact", head: true })
    .eq("route_id", route.id).not("seller_answered_at", "is", null).gte("seller_answered_at", req.created_at);
  await db.from("dd_seller_requests").update({ answers_count: count || 0, last_seen_at: now }).eq("id", req.id);
  return data;
}
