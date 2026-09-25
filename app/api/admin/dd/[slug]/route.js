import { adminDb, getUser, unauthorized } from "../../../../../lib/serverAuth";
import { buildPublicDD } from "../../../../../lib/ddPublic";

export const dynamic = "force-dynamic";

const STATUSES = ["open", "requested", "partial", "received", "verified", "declined", "na"];
const METHODS = ["email", "phone", "form", "document", "cim"];
const CHANNELS = ["email", "phone", "form_link", "other"];

async function loadRoute(slug) {
  const { data } = await adminDb
    .from("atm_routes")
    .select("id, slug, title, status, asking_price, terminal_count, location_display, deal_id, nda_count, inquiry_count, seller_contact_name, seller_contact_email, seller_contact_phone, dd_badge_enabled")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

// GET /api/admin/dd/[slug] — one route's checklist, flags, outreach, score
export async function GET(request, { params }) {
  if (!(await getUser(request))) return unauthorized();
  const route = await loadRoute(params.slug);
  if (!route) return Response.json({ error: "Route not found" }, { status: 404 });

  if (new URL(request.url).searchParams.get("badge")) {
    return Response.json(await buildPublicDD(route.id, route.title));
  }
  const [items, flags, touches, score] = await Promise.all([
    adminDb.from("v_route_dd_items").select("*").eq("route_id", route.id).order("sort_order"),
    adminDb.from("route_dd_flags").select("*").eq("route_id", route.id).order("created_at"),
    adminDb.from("dd_touches").select("*").eq("route_id", route.id).order("sent_at", { ascending: false }),
    adminDb.from("v_route_dd_score").select("*").eq("route_id", route.id).maybeSingle(),
  ]);
  const err = items.error || flags.error || touches.error || score.error;
  if (err) return Response.json({ error: err.message }, { status: 500 });
  return Response.json({ route, items: items.data, flags: flags.data, touches: touches.data, score: score.data });
}

// PATCH /api/admin/dd/[slug]
//   { action: "item",  item_key, status?, answer_text?, source_who?, source_method?, source_note?, declined_reason? }
//   { action: "flag",  id, resolved, resolved_note? }
//   { action: "touch", channel, item_keys?, note? }        — log outreach
//   { action: "reply", touch_id }                           — mark a touch as answered
export async function PATCH(request, { params }) {
  const user = await getUser(request);
  if (!user) return unauthorized();
  const route = await loadRoute(params.slug);
  if (!route) return Response.json({ error: "Route not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const who = user.email;
  const now = new Date().toISOString();

  if (body.action === "item") {
    if (!body.item_key) return Response.json({ error: "item_key required" }, { status: 400 });
    if (body.status && !STATUSES.includes(body.status)) return Response.json({ error: "bad status" }, { status: 400 });
    if (body.source_method && !METHODS.includes(body.source_method)) return Response.json({ error: "bad source_method" }, { status: 400 });

    const { data: existing } = await adminDb.from("route_dd_items").select("*")
      .eq("route_id", route.id).eq("item_key", body.item_key).maybeSingle();

    const row = { route_id: route.id, item_key: body.item_key, updated_by: who, updated_at: now };
    for (const k of ["status", "answer_text", "source_who", "source_method", "source_note", "declined_reason"]) {
      if (k in body) row[k] = body[k] === "" ? null : body[k];
    }
    const st = row.status || existing?.status;
    if (row.status === "requested" && !existing?.first_asked_at) row.first_asked_at = now;
    if (["verified", "declined", "na"].includes(row.status)) row.closed_at = now;
    else if (row.status) row.closed_at = null;
    if (row.status === "declined") row.declined_at = now.slice(0, 10);
    // Any new answer text gets a source date (ops manual: every answer is sourced and dated)
    if ("answer_text" in body && !("source_date" in body)) row.source_date = now.slice(0, 10);
    if (!st) row.status = "open";

    const { data, error } = await adminDb.from("route_dd_items")
      .upsert(row, { onConflict: "route_id,item_key" }).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ item: data });
  }

  if (body.action === "flag") {
    const { data, error } = await adminDb.from("route_dd_flags")
      .update({ resolved: !!body.resolved, resolved_note: body.resolved_note || null })
      .eq("id", body.id).eq("route_id", route.id).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ flag: data });
  }

  if (body.action === "touch") {
    if (!CHANNELS.includes(body.channel)) return Response.json({ error: "bad channel" }, { status: 400 });
    const keys = Array.isArray(body.item_keys) ? body.item_keys : [];
    const { data, error } = await adminDb.from("dd_touches")
      .insert({ route_id: route.id, channel: body.channel, item_keys: keys, note: body.note || null, created_by: who })
      .select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    // Items asked about in this touch move to "requested" (only if they were still open)
    if (keys.length) {
      await adminDb.from("route_dd_items").upsert(
        keys.map(k => ({ route_id: route.id, item_key: k, status: "requested", first_asked_at: now, updated_by: who, updated_at: now })),
        { onConflict: "route_id,item_key", ignoreDuplicates: true }
      );
      await adminDb.from("route_dd_items").update({ status: "requested", updated_by: who, updated_at: now })
        .eq("route_id", route.id).in("item_key", keys).eq("status", "open");
      await adminDb.from("route_dd_items").update({ first_asked_at: now })
        .eq("route_id", route.id).in("item_key", keys).is("first_asked_at", null);
    }
    return Response.json({ touch: data });
  }

  if (body.action === "badge") {
    const { error } = await adminDb.from("atm_routes").update({ dd_badge_enabled: !!body.enabled }).eq("id", route.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  if (body.action === "reply") {
    const { data, error } = await adminDb.from("dd_touches").update({ replied_at: now })
      .eq("id", body.touch_id).eq("route_id", route.id).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ touch: data });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
