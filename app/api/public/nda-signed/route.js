import crypto from "crypto";
import { adminDb as db } from "../../../../lib/serverAuth";

export const dynamic = "force-dynamic";

// Called by the WordPress snippet "NDA to CRM" each time someone submits the NDA form
// (WPForms form 6387). Records the signature in nda_signatures. Sends no email.
// Header: x-nda-secret: <NDA_SIGNED_SECRET>
function authorized(request) {
  const secret = process.env.NDA_SIGNED_SECRET || "";
  const got = request.headers.get("x-nda-secret") || "";
  if (!secret || got.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}

const clean = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : null) || null;

export async function POST(request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  const email = clean(body.email, 320)?.toLowerCase();
  if (!email || !email.includes("@")) return Response.json({ error: "email required" }, { status: 400 });

  const listingUrl = clean(body.listing_url, 1000);
  const slug = listingUrl?.match(/atm-route-for-sale\/([a-z0-9-]+)/i)?.[1]?.toLowerCase() || clean(body.listing_slug, 200)?.toLowerCase().replace(/[^a-z0-9-]/g, "");
  let routeId = null;
  if (slug) {
    // Website URLs use the WordPress slug (wp_slug), which often differs from the CRM slug.
    const { data: routes } = await db.from("atm_routes").select("id, wp_slug").or(`wp_slug.eq.${slug},slug.eq.${slug}`).limit(2);
    routeId = (routes || []).find((r) => r.wp_slug === slug)?.id || routes?.[0]?.id || null;
  }

  const row = {
    source: "wpforms",
    entry_id: body.entry_id ? String(body.entry_id) : null,
    email,
    name: clean(body.name, 200),
    phone: clean(body.phone, 50),
    company: clean(body.company, 200),
    listing_url: listingUrl,
    listing_slug: slug,
    route_id: routeId,
    signed_at: new Date().toISOString(),
    raw: { ...body, ip: request.headers.get("x-forwarded-for") || null },
  };

  const q = row.entry_id
    ? db.from("nda_signatures").upsert(row, { onConflict: "source,entry_id", ignoreDuplicates: true })
    : db.from("nda_signatures").insert(row);
  const { error } = await q;
  if (error) {
    console.error("[nda-signed]", error);
    return Response.json({ error: "save failed" }, { status: 500 });
  }
  return Response.json({ ok: true, matched_listing: !!routeId });
}
