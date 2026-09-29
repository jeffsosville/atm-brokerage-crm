// Keeps the CRM in line with atmbrokerage.com (WordPress is the master for listings).
// Reads the site's portfolio items and their status category (Available / Under Contract / Recently Sold),
// then updates atm_routes status + price and the linked deal's stage. Anything it can't match is flagged
// in wp_listings for a person to fix — it never creates or deletes deals on its own.
import { adminDb as db } from "./serverAuth";

const WP = process.env.WP_SITE_URL || "https://atmbrokerage.com";
const STATUS_BY_TERM = { available: "active", "under contract": "pending", "recently sold": "sold", sold: "sold" };
const STAGE_BY_STATUS = { active: "listed", pending: "under_contract", sold: "closed" };
const STAGE_ORDER = ["prospect", "listed", "under_contract", "closed"];

async function wpJson(path) {
  const out = [];
  for (let page = 1; page < 20; page++) {
    const res = await fetch(`${WP}/wp-json/wp/v2/${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`, { cache: "no-store" });
    if (res.status === 400 && page > 1) break; // past the last page
    if (!res.ok) throw new Error(`WordPress ${path} → ${res.status}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

const decode = (s = "") =>
  s.replace(/<[^>]+>/g, "").replace(/&#8211;|&#8212;/g, "–").replace(/&#8217;/g, "'").replace(/&amp;/g, "&").replace(/&#0?36;/g, "$").replace(/\s+/g, " ").trim();

// "$1,399,000.00", "C$3,495,000", "$129,000!", "109k", "$190k" → number
export function priceFromTitle(title) {
  const m = title.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(k|m|mil)?\b/i) || title.match(/\b([\d.]+)\s*(k|m)\b/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ""));
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k") n *= 1e3;
  if (unit === "m" || unit === "mil") n *= 1e6;
  return n >= 1000 ? Math.round(n) : null;
}

export async function syncFromWordPress({ dryRun = false } = {}) {
  const [terms, items] = await Promise.all([
    wpJson("portfolio_entries?_fields=id,name"),
    wpJson("portfolio?_fields=id,slug,link,title,portfolio_entries,modified"),
  ]);
  const statusTerm = Object.fromEntries(
    terms.filter((t) => STATUS_BY_TERM[decode(t.name).toLowerCase()]).map((t) => [t.id, STATUS_BY_TERM[decode(t.name).toLowerCase()]])
  );

  const { data: routes } = await db.from("atm_routes").select("id, slug, wp_slug, status, asking_price, deal_id");
  const byWp = {};
  for (const r of routes || []) {
    if (r.wp_slug) byWp[r.wp_slug] = r;
    if (!byWp[r.slug]) byWp[r.slug] = r;
  }
  const dealIds = (routes || []).map((r) => r.deal_id).filter(Boolean);
  const { data: deals } = dealIds.length ? await db.from("atm_deals").select("id, stage, asking_price").in("id", dealIds) : { data: [] };
  const dealById = Object.fromEntries((deals || []).map((d) => [d.id, d]));

  const stats = { site_listings: items.length, status_changes: [], price_changes: [], flagged: [], errors: [] };
  const seen = new Set();
  const snapshot = [];

  for (const it of items) {
    const slug = (it.link.match(/atm-route-for-sale\/([^/]+)/) || [])[1] || it.slug;
    const title = decode(it.title?.rendered);
    const wpStatus = (it.portfolio_entries || []).map((id) => statusTerm[id]).find(Boolean) || null;
    const price = priceFromTitle(title);
    const route = byWp[slug];
    let issue = null;

    if (!wpStatus) issue = "No Available / Under Contract / Sold category on the website";
    else if (!route) issue = wpStatus === "sold" ? null : "On the website but not in the CRM (no route / DD checklist)";
    else if (!route.deal_id && wpStatus !== "sold") issue = "In the CRM but not linked to a deal room";

    if (route) {
      seen.add(route.id);
      const patch = {};
      if (wpStatus && route.status !== wpStatus && route.status !== "hidden") {
        patch.status = wpStatus;
        stats.status_changes.push(`${slug}: ${route.status} → ${wpStatus}`);
      }
      if (!route.wp_slug) patch.wp_slug = slug;
      if (price && wpStatus !== "sold" && Number(route.asking_price) !== price) {
        patch.asking_price = price;
        stats.price_changes.push(`${slug}: ${route.asking_price ?? "none"} → ${price}`);
      }
      if (Object.keys(patch).length && !dryRun) {
        const { error } = await db.from("atm_routes").update({ ...patch, updated_at: new Date().toISOString(), updated_by: "wp-sync" }).eq("id", route.id);
        if (error) stats.errors.push(`${slug}: ${error.message}`);
      }

      const deal = route.deal_id && dealById[route.deal_id];
      if (deal && wpStatus) {
        const want = STAGE_BY_STATUS[wpStatus];
        const dPatch = {};
        // Only move deals forward automatically; a sold deal showing Available again is flagged, not reopened.
        if (deal.stage !== want) {
          if (STAGE_ORDER.indexOf(want) > STAGE_ORDER.indexOf(deal.stage)) dPatch.stage = want;
          else if (!issue) issue = `Website says ${wpStatus} but the deal is ${deal.stage}`;
        }
        if (price && wpStatus !== "sold" && Number(deal.asking_price) !== price) dPatch.asking_price = price;
        if (Object.keys(dPatch).length && !dryRun) {
          if (dPatch.stage) dPatch.stage_changed_at = new Date().toISOString();
          const { error } = await db.from("atm_deals").update(dPatch).eq("id", deal.id);
          if (error) stats.errors.push(`${slug} deal: ${error.message}`);
        }
      }
    }

    if (issue) stats.flagged.push(`${title}: ${issue}`);
    snapshot.push({ wp_slug: slug, wp_id: it.id, title, link: it.link, wp_status: wpStatus, price, route_id: route?.id || null, issue, wp_modified: it.modified, last_seen_at: new Date().toISOString() });
  }

  // CRM listings the website no longer shows as for sale or under contract
  for (const r of routes || []) {
    if (["active", "pending"].includes(r.status) && !seen.has(r.id)) stats.flagged.push(`${r.slug}: ${r.status} in the CRM but not on the website`);
  }

  if (!dryRun) {
    const { error } = await db.from("wp_listings").upsert(snapshot, { onConflict: "wp_slug" });
    if (error) stats.errors.push(`snapshot: ${error.message}`);
  }
  return stats;
}
