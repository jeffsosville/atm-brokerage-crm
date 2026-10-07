import { adminDb } from "./serverAuth";

// slug ⇄ id for the verticals table, cached per server instance.
let cache = null;
export async function verticalMaps() {
  if (!cache) {
    const { data } = await adminDb.from("verticals").select("id, slug");
    cache = { idBySlug: Object.fromEntries((data || []).map((v) => [v.slug, v.id])), slugById: Object.fromEntries((data || []).map((v) => [v.id, v.slug])) };
  }
  return cache;
}

/** Reads ?vertical=atm|vending|cleaning from a request. Returns { slug, id } or null for "all". */
export async function verticalFromRequest(request) {
  const slug = (new URL(request.url).searchParams.get("vertical") || "all").toLowerCase();
  if (slug === "all") return null;
  const { idBySlug } = await verticalMaps();
  return { slug, id: idBySlug[slug] || "00000000-0000-0000-0000-000000000000" };
}
