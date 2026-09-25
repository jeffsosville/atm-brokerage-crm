import { adminDb as db } from "../../../../lib/serverAuth";
import { preFilter, classifyEmail, mapQuestionToDD, NON_ACTIONABLE } from "../../../../lib/inbox/classify";
import { dueAtFor } from "../../../../lib/inbox/sla";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_CLAUDE_PER_RUN = Number(process.env.INBOX_MAX_CLASSIFY || 20);
const MAX_MAP_PER_RUN = Number(process.env.INBOX_MAX_DDMAP || 15);
const ASK_KINDS = ["buyer_question", "data_room", "offer", "existing_deal", "marketplace_lead"];
const BACKFILL_DAYS = 30;
const OPEN = ["new", "drafted", "awaiting_john"];

function authorized(request) {
  const secret = process.env.INBOX_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return [bearer, request.headers.get("x-cron-secret"), url.searchParams.get("secret")].includes(secret);
}

async function inChunks(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(...(await Promise.all(list.slice(i, i + size).map(fn))));
  return out;
}

// Runs every 15 minutes (pg_cron → this URL). Safe to run repeatedly.
async function run() {
  const now = new Date().toISOString();
  const stats = { dd_asks_logged: 0, questions_mapped: 0, emails_seen: 0, classified: 0, prefiltered: 0, new_items: 0, merged: 0, reopened: 0, escalations_added: 0, marked_replied: 0, errors: [] };

  // Listings, for matching emails to a route
  const { data: routeRows } = await db.from("atm_routes").select("id, slug, title, deal_id, status").in("status", ["active", "pending"]);
  const dealIds = (routeRows || []).map((r) => r.deal_id).filter(Boolean);
  const { data: dealRows } = dealIds.length ? await db.from("atm_deals").select("id, dl_number").in("id", dealIds) : { data: [] };
  const dl = Object.fromEntries((dealRows || []).map((d) => [d.id, d.dl_number]));
  const routes = (routeRows || []).map((r) => ({ ...r, dl_number: dl[r.deal_id] || null }));
  const bySlug = Object.fromEntries(routes.map((r) => [r.slug, r]));
  const byDeal = Object.fromEntries(routes.filter((r) => r.deal_id).map((r) => [r.deal_id, r]));
  const { data: atmV } = await db.from("verticals").select("id").eq("slug", "atm").maybeSingle();
  const { data: ddItems } = atmV ? await db.from("dd_checklist_items").select("item_key, label, seller_question").eq("vertical_id", atmV.id).neq("visibility", "internal").order("sort_order") : { data: [] };
  const noteAsk = async (routeId, keys, at) => {
    if (!routeId || !keys?.length) return;
    const { error } = await db.rpc("dd_note_buyer_ask", { p_route: routeId, p_keys: keys, p_at: at });
    if (error) stats.errors.push("dd ask: " + error.message); else stats.dd_asks_logged += keys.length;
  };

  // ---- 1. New emails -------------------------------------------------------
  const since = new Date(Date.now() - BACKFILL_DAYS * 864e5).toISOString();
  const { data: emails, error: eErr } = await db.from("atm_activity_log")
    .select("id, from_email, to_email, subject, snippet, thread_id, created_at, contact_id")
    .eq("type", "email_received").is("inbox_processed_at", null).gte("created_at", since)
    .order("created_at", { ascending: false }).limit(80);
  if (eErr) throw eErr;
  stats.emails_seen = emails?.length || 0;

  let claudeBudget = MAX_CLAUDE_PER_RUN;
  const todo = (emails || []).map((e) => ({ e, pre: preFilter(e.from_email, e.subject) }))
    .filter(({ pre }) => pre.kind || claudeBudget-- > 0); // leave the rest for the next run

  const senders = [...new Set(todo.map(({ e }) => (e.from_email || "").toLowerCase()).filter(Boolean))];
  const [{ data: ndas }, { data: contacts }] = await Promise.all([
    senders.length ? db.from("deal_buyer_access").select("buyer_email, buyer_name, deal_id").in("buyer_email", senders) : { data: [] },
    senders.length ? db.from("atm_contacts").select("id, email").in("email", senders) : { data: [] },
  ]);
  const ndaBy = {}; (ndas || []).forEach((n) => { ndaBy[(n.buyer_email || "").toLowerCase()] = n; });
  const contactBy = {}; (contacts || []).forEach((c) => { contactBy[(c.email || "").toLowerCase()] = c.id; });

  const decided = await inChunks(todo, 5, async ({ e, pre }) => {
    try {
      if (pre.kind) { stats.prefiltered++; return { e, c: { kind: pre.kind, priority: "low", summary: null }, source: pre.source }; }
      const c = await classifyEmail(e, routes, { isMarketplace: pre.source === "marketplace", isInternal: !!pre.internal, ddItems: ddItems || [] });
      stats.classified++;
      return { e, c, source: pre.source };
    } catch (err) {
      // Don't retry forever: put it in the queue for a human to look at.
      stats.errors.push(`classify ${e.id}: ${err.message}`);
      return { e, c: { kind: pre.source === "marketplace" ? "marketplace_lead" : "other", priority: "normal", summary: null, suggested_action: "Couldn't auto-classify this one; check it manually." }, source: pre.source };
    }
  });

  // oldest first, so a thread's row ends up with its latest message
  for (const d of decided.filter(Boolean).sort((a, b) => new Date(a.e.created_at) - new Date(b.e.created_at))) {
    const { e, c, source } = d;
    const sender = (e.from_email || "").toLowerCase();
    const nda = ndaBy[sender];
    const route = (c.route_slug && bySlug[c.route_slug]) || (nda && byDeal[nda.deal_id]) || null;
    const actionable = !NON_ACTIONABLE.includes(c.kind);
    const priority = nda && actionable ? "high" : c.priority || "normal";

    const { data: existing } = e.thread_id
      ? await db.from("inbound_items").select("id, status, kind, last_message_at").eq("thread_id", e.thread_id).in("source", ["email", "marketplace"]).maybeSingle()
      : { data: null };

    if (existing) {
      const newer = new Date(e.created_at) > new Date(existing.last_message_at);
      const patch = { updated_at: now };
      if (newer) Object.assign(patch, { last_message_at: e.created_at, subject: e.subject, snippet: e.snippet });
      if (newer && actionable && !OPEN.includes(existing.status) && existing.status !== "not_a_lead") {
        Object.assign(patch, { status: "new", due_at: dueAtFor(c.kind, e.created_at), closed_reason: null });
        stats.reopened++;
      }
      if (c.dd_items?.length) patch.dd_item_keys = c.dd_items;
      await db.from("inbound_items").update(patch).eq("id", existing.id);
      if (ASK_KINDS.includes(c.kind)) await noteAsk(route?.id, c.dd_items, e.created_at);
      stats.merged++;
    } else {
      const { error } = await db.from("inbound_items").insert({
        source, activity_id: e.id, thread_id: e.thread_id, from_email: e.from_email,
        from_name: c.from_name || nda?.buyer_name || null, subject: e.subject, snippet: e.snippet,
        contact_id: e.contact_id || contactBy[sender] || null, route_id: route?.id || null,
        deal_id: route?.deal_id || nda?.deal_id || null, is_nda_signer: !!nda,
        kind: c.kind, priority, summary: c.summary || null, suggested_action: c.suggested_action || null,
        classify_confidence: c.confidence ?? null, dd_item_keys: c.dd_items?.length ? c.dd_items : null, received_at: e.created_at, last_message_at: e.created_at,
        due_at: actionable ? dueAtFor(c.kind, e.created_at) : null,
        status: actionable ? "new" : "closed", closed_reason: actionable ? null : "auto: " + c.kind,
      });
      if (error) stats.errors.push(`insert ${e.id}: ${error.message}`);
      else { stats.new_items++; if (ASK_KINDS.includes(c.kind)) await noteAsk(route?.id, c.dd_items, e.created_at); }
    }
    await db.from("atm_activity_log").update({ inbox_processed_at: now }).eq("id", e.id);
  }

  // ---- 2. Deal-room questions the concierge couldn't answer ---------------
  const { data: esc } = await db.from("deal_questions")
    .select("id, deal_id, question, buyer_name, buyer_email, created_at, advisor_answer").eq("escalated", true).is("advisor_answer", null);
  if (esc?.length) {
    const ids = esc.map((q) => q.id);
    const [{ data: have }, { data: answered }] = await Promise.all([
      db.from("inbound_items").select("deal_question_id").in("deal_question_id", ids),
      db.from("deal_answers").select("question_id").in("question_id", ids),
    ]);
    const skip = new Set([...(have || []).map((x) => x.deal_question_id), ...(answered || []).map((x) => x.question_id)]);
    const rows = esc.filter((q) => !skip.has(q.id)).map((q) => ({
      source: "deal_room", deal_question_id: q.id, from_email: q.buyer_email, from_name: q.buyer_name,
      subject: "Deal-room question", snippet: q.question, summary: q.question, kind: "buyer_question",
      priority: "normal", is_nda_signer: true, deal_id: q.deal_id, route_id: byDeal[q.deal_id]?.id || null,
      received_at: q.created_at, last_message_at: q.created_at, due_at: dueAtFor("buyer_question", q.created_at),
      suggested_action: "Answer in the deal room (it will be shared with every NDA buyer) or reply to the buyer directly.",
    }));
    if (rows.length) {
      const { error } = await db.from("inbound_items").insert(rows);
      if (error) stats.errors.push("escalations: " + error.message); else stats.escalations_added = rows.length;
    }
  }

  // ---- 2b. What buyers ask in deal rooms → DD priorities ------------------
  const dealIdsWithRoute = Object.keys(byDeal);
  if (dealIdsWithRoute.length && ddItems?.length) {
    const { data: qs } = await db.from("deal_questions").select("id, deal_id, question, created_at")
      .is("dd_mapped_at", null).in("deal_id", dealIdsWithRoute).order("created_at", { ascending: false }).limit(MAX_MAP_PER_RUN);
    await inChunks(qs || [], 5, async (q) => {
      try {
        const keys = await mapQuestionToDD(q.question, ddItems);
        await db.from("deal_questions").update({ dd_item_keys: keys, dd_mapped_at: now }).eq("id", q.id);
        await db.from("inbound_items").update({ dd_item_keys: keys.length ? keys : null }).eq("deal_question_id", q.id);
        await noteAsk(byDeal[q.deal_id]?.id, keys, q.created_at);
        stats.questions_mapped++;
      } catch (err) { stats.errors.push(`map ${q.id}: ${err.message}`); }
    });
  }

  // ---- 3. Reply detection ----------------------------------------------------
  const { data: open } = await db.from("inbound_items").select("id, source, thread_id, last_message_at, deal_question_id").in("status", OPEN);
  const emailOpen = (open || []).filter((o) => o.thread_id);
  for (let i = 0; i < emailOpen.length; i += 100) {
    const chunk = emailOpen.slice(i, i + 100);
    const { data: sent } = await db.from("atm_activity_log").select("thread_id, created_at")
      .in("type", ["email_sent", "followup_sent"]).in("thread_id", chunk.map((o) => o.thread_id));
    const lastSent = {};
    (sent || []).forEach((s) => { if (!lastSent[s.thread_id] || s.created_at > lastSent[s.thread_id]) lastSent[s.thread_id] = s.created_at; });
    for (const o of chunk) {
      const s = lastSent[o.thread_id];
      if (s && new Date(s) > new Date(o.last_message_at)) {
        await db.from("inbound_items").update({ status: "replied", first_response_at: s, updated_at: now, updated_by: "auto: reply seen" }).eq("id", o.id).is("first_response_at", null);
        await db.from("inbound_items").update({ status: "replied", updated_at: now }).eq("id", o.id).in("status", OPEN);
        stats.marked_replied++;
      }
    }
  }
  const roomOpen = (open || []).filter((o) => o.deal_question_id);
  if (roomOpen.length) {
    const ids = roomOpen.map((o) => o.deal_question_id);
    const [{ data: adv }, { data: ans }] = await Promise.all([
      db.from("deal_questions").select("id").in("id", ids).not("advisor_answer", "is", null),
      db.from("deal_answers").select("question_id, answered_at").in("question_id", ids),
    ]);
    const done = new Set([...(adv || []).map((x) => x.id), ...(ans || []).map((x) => x.question_id)]);
    for (const o of roomOpen.filter((o) => done.has(o.deal_question_id))) {
      await db.from("inbound_items").update({ status: "replied", first_response_at: now, updated_at: now, updated_by: "auto: answered in deal room" }).eq("id", o.id);
      stats.marked_replied++;
    }
  }

  return stats;
}

async function handler(request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try { return Response.json({ ok: true, ...(await run()) }); }
  catch (err) { console.error("[cron/inbox]", err); return Response.json({ ok: false, error: err.message }, { status: 500 }); }
}
export const GET = handler;
export const POST = handler;
