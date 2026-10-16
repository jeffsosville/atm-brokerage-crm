import { adminDb, getUser, unauthorized } from "../../../../../lib/serverAuth";
import { buildPublicDD } from "../../../../../lib/ddPublic";
import { sellerUrl, verticalSlug, brandForSlug, PHONE } from "../../../../../lib/sellerPortal";

export const dynamic = "force-dynamic";

const SELLER_SENDERS = {
  atm: "John Sosville <john@atmbrokerage.com>",
  vending: "John Sosville <sales@vendingexits.com>",
  cleaning: "John Sosville <hello@cleaningexits.com>",
};

function sellerInviteEmail({ route, brand, url, count }) {
  const first = (route.seller_contact_name || "").trim().split(/\s+/)[0];
  return {
    subject: `Your listing file: ${route.title}`,
    text: `Hi${first ? " " + first : ""},

Buyers looking at your ${brand.noun} all ask the same questions before they make an offer. Instead of answering them one email at a time, I've put them on one page for you:

${url}

For each item you can:
- answer it, or attach a file (P&L, processor statements, contracts)
- tell us it's coming soon, and when
- mark it "won't provide"

${count ? `There are ${count} items open right now. ` : ""}Most owners get through it in 20 minutes, and you can stop and come back to the same link any time. The more complete your file, the faster serious buyers move and the fewer calls you'll get from tire-kickers. Your financials, locations and contracts are only shown to buyers who sign an NDA.

Call me if anything's unclear.

John Sosville
${brand.firm}
${PHONE}`,
  };
}

const STATUSES = ["open", "requested", "partial", "received", "verified", "declined", "na", "coming_soon"];
const METHODS = ["email", "phone", "form", "document", "cim"];
const CHANNELS = ["email", "phone", "form_link", "other"];

async function loadRoute(slug) {
  const { data } = await adminDb
    .from("atm_routes")
    .select("id, slug, title, status, asking_price, terminal_count, location_display, deal_id, vertical_id, nda_count, inquiry_count, seller_contact_name, seller_contact_email, seller_contact_phone, dd_badge_enabled")
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
  const [items, flags, touches, score, suggestions, links] = await Promise.all([
    adminDb.from("v_route_dd_items").select("*").eq("route_id", route.id).order("sort_order"),
    adminDb.from("route_dd_flags").select("*").eq("route_id", route.id).order("created_at"),
    adminDb.from("dd_touches").select("*").eq("route_id", route.id).order("sent_at", { ascending: false }),
    adminDb.from("v_route_dd_score").select("*").eq("route_id", route.id).maybeSingle(),
    adminDb.from("dd_suggestions").select("*").eq("route_id", route.id).eq("status", "pending").order("created_at"),
    adminDb.from("dd_seller_requests").select("id, token, created_at, created_by, opened_at, last_seen_at, submitted_at, expires_at, revoked_at, answers_count, seller_email")
      .eq("route_id", route.id).order("created_at", { ascending: false }).limit(5),
  ]);
  const err = items.error || flags.error || touches.error || score.error || suggestions.error || links.error;
  if (err) return Response.json({ error: err.message }, { status: 500 });
  const sellerLinks = (links.data || []).map((l) => ({ ...l, url: sellerUrl(l.token) }));
  return Response.json({ route, items: items.data, flags: flags.data, touches: touches.data, score: score.data, suggestions: suggestions.data, sellerLinks });
}

// PATCH /api/admin/dd/[slug]
//   { action: "item",  item_key, status?, answer_text?, source_who?, source_method?, source_note?, declined_reason?, expected_date? }
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
    for (const k of ["status", "answer_text", "source_who", "source_method", "source_note", "declined_reason", "expected_date"]) {
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

  // Suggested answers (from deal room answers / uploaded files). Accept writes the checklist item with its source.
  //   { action: "suggestion", id, decision: "accept" | "verify" | "dismiss", answer_text? }
  if (body.action === "suggestion") {
    const { data: sug } = await adminDb.from("dd_suggestions").select("*").eq("id", body.id).eq("route_id", route.id).maybeSingle();
    if (!sug) return Response.json({ error: "Suggestion not found" }, { status: 404 });
    if (sug.status !== "pending") return Response.json({ error: "Already decided" }, { status: 409 });
    if (!["accept", "verify", "dismiss"].includes(body.decision)) return Response.json({ error: "bad decision" }, { status: 400 });

    if (body.decision !== "dismiss") {
      const status = body.decision === "verify" ? "verified" : "received";
      const answer = (typeof body.answer_text === "string" && body.answer_text.trim()) || sug.answer_text;
      const row = {
        route_id: route.id, item_key: sug.item_key, status, answer_text: answer,
        source_who: sug.source_label || sug.source_who,
        source_method: sug.source_kind === "document" ? "document" : sug.source_kind === "email" ? "email" : "form",
        source_date: now.slice(0, 10),
        source_note: sug.excerpt ? "From: \"" + sug.excerpt + "\"" : null,
        updated_by: who, updated_at: now,
        closed_at: status === "verified" ? now : null,
      };
      const { error } = await adminDb.from("route_dd_items").upsert(row, { onConflict: "route_id,item_key" });
      if (error) return Response.json({ error: error.message }, { status: 500 });
      // Other pending suggestions for the same item are superseded
      await adminDb.from("dd_suggestions").update({ status: "dismissed", decided_by: who + " (superseded)", decided_at: now })
        .eq("route_id", route.id).eq("item_key", sug.item_key).eq("status", "pending").neq("id", sug.id);
    }
    await adminDb.from("dd_suggestions").update({
      status: body.decision === "dismiss" ? "dismissed" : "accepted", decided_by: who, decided_at: now,
    }).eq("id", sug.id);
    return Response.json({ ok: true });
  }

  if (body.action === "badge") {
    const { error } = await adminDb.from("atm_routes").update({ dd_badge_enabled: !!body.enabled }).eq("id", route.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  // Seller contact on the route (needed before a seller link can be emailed)
  //   { action: "seller_contact", name?, email?, phone? }
  if (body.action === "seller_contact") {
    const email = String(body.email || "").trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "That email doesn't look right" }, { status: 400 });
    const patch = {
      seller_contact_name: String(body.name || "").trim() || null,
      seller_contact_email: email || null,
      seller_contact_phone: String(body.phone || "").trim() || null,
    };
    const { error } = await adminDb.from("atm_routes").update(patch).eq("id", route.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  // Seller portal link
  //   { action: "seller_link", send?: boolean }  — new link; send=true emails it to the seller from John
  //   { action: "seller_link_revoke", id }
  if (body.action === "seller_link") {
    const { data: items } = await adminDb.from("v_route_dd_items").select("item_key, state").eq("route_id", route.id);
    const openKeys = (items || []).filter((i) => ["missing", "requested", "partial", "filled_unsourced", "coming_soon"].includes(i.state)).map((i) => i.item_key);
    if (body.send && !route.seller_contact_email) return Response.json({ error: "Add the seller's email first" }, { status: 400 });

    const { data: req, error } = await adminDb.from("dd_seller_requests").insert({
      route_id: route.id, item_keys: openKeys, created_by: who,
      seller_name: route.seller_contact_name || null, seller_email: route.seller_contact_email || null,
    }).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const url = sellerUrl(req.token);

    if (!body.send) return Response.json({ ok: true, url, request: req, sent: false });

    const vertical = await verticalSlug(route.vertical_id);
    const brand = brandForSlug(vertical);
    const mail = sellerInviteEmail({ route, brand, url, count: openKeys.length });
    const key = process.env.RESEND_API_KEY;
    if (!key) return Response.json({ ok: true, url, request: req, sent: false, warning: "Email isn't configured (RESEND_API_KEY). Copy the link and send it yourself." });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: SELLER_SENDERS[vertical] || SELLER_SENDERS.atm, to: [route.seller_contact_email],
        cc: [process.env.SELLER_PORTAL_NOTIFY || "john@atmbrokerage.com"], reply_to: "john@atmbrokerage.com",
        subject: mail.subject, text: mail.text,
      }),
    });
    if (!res.ok) return Response.json({ ok: true, url, request: req, sent: false, warning: `The email didn't send (${res.status}). Copy the link and send it yourself.` });

    await adminDb.from("dd_touches").insert({ route_id: route.id, channel: "form_link", item_keys: openKeys, note: "Seller portal link emailed to " + route.seller_contact_email, created_by: who });
    if (openKeys.length) {
      await adminDb.from("route_dd_items").upsert(
        openKeys.map((k) => ({ route_id: route.id, item_key: k, status: "requested", first_asked_at: now, updated_by: who, updated_at: now })),
        { onConflict: "route_id,item_key", ignoreDuplicates: true }
      );
      await adminDb.from("route_dd_items").update({ status: "requested", updated_by: who, updated_at: now })
        .eq("route_id", route.id).in("item_key", openKeys).eq("status", "open");
      await adminDb.from("route_dd_items").update({ first_asked_at: now })
        .eq("route_id", route.id).in("item_key", openKeys).is("first_asked_at", null);
    }
    return Response.json({ ok: true, url, request: req, sent: true });
  }

  if (body.action === "seller_link_revoke") {
    const { error } = await adminDb.from("dd_seller_requests").update({ revoked_at: now }).eq("id", body.id).eq("route_id", route.id);
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
