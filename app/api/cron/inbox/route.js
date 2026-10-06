import { adminDb as db } from "../../../../lib/serverAuth";
import { preFilter, classifyEmail, mapQuestionToDD, NON_ACTIONABLE } from "../../../../lib/inbox/classify";
import { dueAtFor } from "../../../../lib/inbox/sla";
import { parseMarketplaceLead, resolveMarketplaceLead, marketplaceReply, shouldAutoReply, sendMarketplaceReply } from "../../../../lib/inbox/marketplace";

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
  const stats = { marketplace_routed: 0, marketplace_autoreplied: 0, autoreplies_linked: 0, nda_conversions: 0, dd_asks_logged: 0, questions_mapped: 0, emails_seen: 0, classified: 0, prefiltered: 0, new_items: 0, merged: 0, reopened: 0, escalations_added: 0, marked_replied: 0, nda_from_email: 0, website_forms: 0, errors: [] };

  // Listings, for matching emails to a route
  const { data: routeRows } = await db.from("atm_routes").select("id, slug, wp_slug, title, deal_id, status, vertical_id").in("status", ["active", "pending"]);
  const dealIds = (routeRows || []).map((r) => r.deal_id).filter(Boolean);
  const { data: dealRows } = dealIds.length ? await db.from("atm_deals").select("id, dl_number, deal_type, vertical_id").in("id", dealIds) : { data: [] };
  const dl = Object.fromEntries((dealRows || []).map((d) => [d.id, d.dl_number]));
  const routes = (routeRows || []).map((r) => ({ ...r, dl_number: dl[r.deal_id] || null }));
  const bySlug = Object.fromEntries(routes.map((r) => [r.slug, r]));
  const byDeal = Object.fromEntries(routes.filter((r) => r.deal_id).map((r) => [r.deal_id, r]));
  // Verticals: every queue row is tagged ATM / vending / cleaning, and DD keys come from that vertical's checklist
  const { data: vRows } = await db.from("verticals").select("id, slug");
  const vIdBySlug = Object.fromEntries((vRows || []).map((v) => [v.slug, v.id]));
  const { data: allDd } = await db.from("dd_checklist_items").select("item_key, label, seller_question, vertical_id").neq("visibility", "internal").order("sort_order");
  const ddByVertical = {};
  (allDd || []).forEach((d) => { (ddByVertical[d.vertical_id] ||= []).push(d); });
  const ddItems = ddByVertical[vIdBySlug.atm] || []; // default when the listing isn't known yet
  const ddFor = (vid) => ddByVertical[vid] || ddItems;
  // deal → vertical; deal_type is the explicit marker (vertical_id can carry the ATM default)
  const dealVertical = {};
  const setDealVertical = (d) => { dealVertical[d.id] = (d.deal_type && vIdBySlug[d.deal_type.toLowerCase()]) || d.vertical_id || null; };
  (dealRows || []).forEach(setDealVertical);
  const loadDealVerticals = async (ids) => {
    const need = [...new Set(ids.filter((id) => id && !(id in dealVertical)))];
    if (!need.length) return;
    const { data } = await db.from("atm_deals").select("id, deal_type, vertical_id").in("id", need);
    (data || []).forEach(setDealVertical);
  };
  const verticalOf = (route, dealId) => (dealId && dealVertical[dealId]) || route?.vertical_id || null;
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
    // A deal number in the email (DL-2026-ATM-00054) is the surest match
    const dlNum = ((e.subject || "") + " " + (e.snippet || "")).match(/DL-\d{4}-ATM-\d{5}/i)?.[0]?.toUpperCase();
    const dlRoute = dlNum ? routes.find((r) => r.dl_number === dlNum) : null;
    const route = dlRoute || (c.route_slug && bySlug[c.route_slug]) || (nda && byDeal[nda.deal_id]) || null;
    const actionable = !NON_ACTIONABLE.includes(c.kind);
    const priority = nda && actionable ? "high" : c.priority || "normal";

    // BizBuySell groups different buyers' leads for the same listing into one Gmail
    // thread, so marketplace leads are one row per email, never merged by thread.
    const { data: existing } = e.thread_id && source === "email"
      ? await db.from("inbound_items").select("id, status, kind, last_message_at").eq("thread_id", e.thread_id).eq("source", "email").maybeSingle()
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
      // Marketplace (BizBuySell) leads: route by the marketplace Listing ID → vertical/deal, and keep the buyer's details
      let mk = null;
      if (source === "marketplace") {
        try {
          const { data: full } = await db.from("atm_activity_log").select("body").eq("id", e.id).maybeSingle();
          const lead = parseMarketplaceLead(full?.body || e.snippet || "", e.subject || "");
          mk = { lead, res: await resolveMarketplaceLead(lead, { verticals: vIdBySlug, routes }) };
          stats.marketplace_routed++;
        } catch (err) { stats.errors.push(`marketplace parse ${e.id}: ${err.message}`); }
      }
      const dealId = mk?.res.deal_id || route?.deal_id || nda?.deal_id || null;
      await loadDealVerticals([dealId]);
      const { data: inserted, error } = await db.from("inbound_items").insert({
        vertical_id: mk?.res.vertical_id || verticalOf(route, dealId),
        lead_email: mk?.lead.email || null, lead_name: mk?.lead.name || null, lead_phone: mk?.lead.phone || null,
        lead_location: mk?.lead.zip || null, lead_channel: mk ? mk.lead.marketplace : null,
        notes: mk ? [mk.lead.listingId && `${mk.lead.marketplace} listing ${mk.lead.listingId}`, mk.lead.headline, mk.lead.invest && `Able to invest: ${mk.lead.invest}`, mk.lead.timeline && `Purchase within: ${mk.lead.timeline}`, `Routed by ${mk.res.via}`].filter(Boolean).join(" · ") : null,
        source, activity_id: e.id, thread_id: e.thread_id, from_email: e.from_email,
        from_name: c.from_name || mk?.lead.name || nda?.buyer_name || null, subject: e.subject, snippet: e.snippet,
        contact_id: e.contact_id || contactBy[sender] || null, route_id: mk?.res.route_id || route?.id || null,
        deal_id: dealId, is_nda_signer: !!nda,
        kind: c.kind, priority, summary: c.summary || null, suggested_action: c.suggested_action || null,
        classify_confidence: c.confidence ?? null, dd_item_keys: c.dd_items?.length ? c.dd_items : null, received_at: e.created_at, last_message_at: e.created_at,
        due_at: actionable ? dueAtFor(c.kind, e.created_at) : null,
        status: actionable ? "new" : "closed", closed_reason: actionable ? null : "auto: " + c.kind,
      }).select("id").maybeSingle();
      if (error) stats.errors.push(`insert ${e.id}: ${error.message}`);
      else {
        stats.new_items++;
        if (ASK_KINDS.includes(c.kind)) await noteAsk(route?.id, c.dd_items, e.created_at);
        // Brand-correct NDA reply to the marketplace buyer (see MARKETPLACE_AUTOREPLY in lib/inbox/marketplace.js)
        if (mk && inserted?.id && actionable && mk.lead.email && shouldAutoReply(mk.res.vertical)) {
          try {
            const reply = marketplaceReply(mk.lead, mk.res);
            await sendMarketplaceReply(mk.lead.email, reply);
            const at = new Date().toISOString();
            await db.from("inbound_items").update({
              status: "awaiting_nda", auto_replied_at: at, first_response_at: at,
              due_at: dueAtFor("nda_followup", at), updated_at: at, updated_by: `auto: marketplace reply (${mk.res.vertical})`,
              suggested_action: `NDA link sent automatically (${reply.ndaUrl}). If they haven't signed by the due time, follow up personally.`,
            }).eq("id", inserted.id);
            await db.from("atm_activity_log").insert({
              type: "marketplace_autoreply", activity_type: "email_outbound", subject: reply.subject,
              body: reply.text, to_email: mk.lead.email, source: "inbox_cron", source_id: inserted.id,
              metadata: { vertical: mk.res.vertical, via: mk.res.via, listing_id: mk.lead.listingId, nda_url: reply.ndaUrl },
            });
            stats.marketplace_autoreplied++;
          } catch (err) { stats.errors.push(`marketplace reply ${e.id}: ${err.message}`); }
        }
      }
    }
    await db.from("atm_activity_log").update({ inbox_processed_at: now }).eq("id", e.id);
  }

  // ---- 1b. Website form submissions ------------------------------------------
  // The site emails these from info@ to info@, so they're stored as "sent" and step 1
  // never sees them. Parse the submitter out and queue them as leads (draft = new email).
  const FORM_SUBJECTS = ["Contact Us page", "New Route Inquiry Submission", "Seller intake form"];
  const { data: forms } = await db.from("atm_activity_log").select("id, subject, snippet, body, created_at")
    .in("subject", FORM_SUBJECTS).is("inbox_processed_at", null).gte("created_at", since).order("created_at").limit(40);
  for (const f of forms || []) {
    const t = (f.body || f.snippet || "").replace(/\r/g, "");
    const one = t.replace(/\s+/g, " ");
    const pick = (re) => one.match(re)?.[1]?.trim() || null;
    const email = pick(/Email:?\s+([^\s]+@[^\s]+)/i)?.toLowerCase();
    const name = pick(/Name:?\s+(.*?)\s+(?:Email|Phone)/i);
    const phone = pick(/Phone:?\s+([()+\d][\d() .+-]{6,})/i) || (one.match(/Inquiry:?\s+([+\d][\d() .-]{7,})\s*(?:Have a|Sent|$)/i)?.[1] || null);
    const END = "\\s+(?:Hidden Field|Have a great day|Sent from|$)";
    const message = pick(new RegExp("Paragraph Text\\s+(.*?)" + END, "i")) || pick(new RegExp("\\b(?:Inquiry|Message|Comments?):\\s+(.*?)" + END, "i"));
    const location = pick(/Route Location:?\s+(.*?)\s+Inquiry/i);
    const slug = one.match(/atm-route-for-sale\/([a-z0-9-]+)/i)?.[1]?.toLowerCase();
    const route = slug ? routes.find((r) => r.wp_slug === slug || r.slug === slug) : null;
    await db.from("atm_activity_log").update({ inbox_processed_at: now }).eq("id", f.id);
    if (!email) continue;
    // Same person submitting again (e.g. twice for the same listing): update the open item instead
    const { data: prior } = await db.from("inbound_items").select("id").eq("source", "website_form").eq("lead_email", email)
      .in("status", OPEN).gte("received_at", new Date(new Date(f.created_at).getTime() - 7 * 864e5).toISOString()).limit(1);
    if (prior?.length) {
      await db.from("inbound_items").update({ last_message_at: f.created_at, updated_at: now }).eq("id", prior[0].id);
      stats.merged++;
      continue;
    }
    const seller = /seller intake/i.test(f.subject) || /\b(sell|selling)\b/i.test(message || "");
    const text = [message && `Message: ${message}`, location && `Route location: ${location}`, phone && `Phone: ${phone}`].filter(Boolean).join("\n") || "(no message)";
    let c = { kind: seller ? "seller_lead" : "buyer_question", priority: "normal", summary: null, suggested_action: null };
    try {
      c = await classifyEmail({ from_email: email, subject: f.subject + (route ? ` — ${route.title}` : ""), snippet: text }, routes, { ddItems: ddItems || [] });
      stats.classified++;
    } catch (err) { stats.errors.push(`form classify ${f.id}: ${err.message}`); }
    const r = route || (c.route_slug && bySlug[c.route_slug]) || null;
    const actionable = !NON_ACTIONABLE.includes(c.kind);
    const { error } = await db.from("inbound_items").insert({
      source: "website_form", activity_id: f.id, thread_id: null, from_email: email, lead_email: email, lead_phone: phone,
      from_name: name || c.from_name || null,
      subject: r ? `Your inquiry about the ${r.title}` : seller ? "Selling your ATM route" : "Your ATM Brokerage inquiry",
      snippet: `${f.subject}: ${text}`.slice(0, 1000), route_id: r?.id || null, deal_id: r?.deal_id || null, vertical_id: verticalOf(r, r?.deal_id),
      kind: c.kind, priority: c.priority || "normal", summary: c.summary || `${f.subject} from ${name || email}`,
      suggested_action: c.suggested_action || null, classify_confidence: c.confidence ?? null,
      received_at: f.created_at, last_message_at: f.created_at,
      due_at: actionable ? dueAtFor(c.kind, f.created_at) : null,
      status: actionable ? "new" : "closed", closed_reason: actionable ? null : "auto: " + c.kind,
    });
    if (error) stats.errors.push(`form insert ${f.id}: ${error.message}`); else stats.website_forms++;
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
    await loadDealVerticals(esc.map((q) => q.deal_id));
    const rows = esc.filter((q) => !skip.has(q.id)).map((q) => ({
      source: "deal_room", deal_question_id: q.id, from_email: q.buyer_email, from_name: q.buyer_name,
      subject: "Deal-room question", snippet: q.question, summary: q.question, kind: "buyer_question",
      priority: "normal", is_nda_signer: true, deal_id: q.deal_id, route_id: byDeal[q.deal_id]?.id || null, vertical_id: verticalOf(byDeal[q.deal_id], q.deal_id),
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
        const keys = await mapQuestionToDD(q.question, ddFor(verticalOf(byDeal[q.deal_id], q.deal_id)));
        await db.from("deal_questions").update({ dd_item_keys: keys, dd_mapped_at: now }).eq("id", q.id);
        await db.from("inbound_items").update({ dd_item_keys: keys.length ? keys : null }).eq("deal_question_id", q.id);
        await noteAsk(byDeal[q.deal_id]?.id, keys, q.created_at);
        stats.questions_mapped++;
      } catch (err) { stats.errors.push(`map ${q.id}: ${err.message}`); }
    });
  }

  // ---- 2c. BizBuySell leads: the Apps Script autoresponder --------------------
  // A Google Apps Script on info@ ("BizBuySell Auto Reply", every 15 min) emails each
  // BizBuySell lead "NDA & Deal Room Access – ATM Listings" with the listings/NDA link.
  // It sends a NEW thread to the buyer, so we pair it to the lead by time, record the
  // buyer's real email, and wait for their NDA instead of asking John to reply.
  const { data: mkt } = await db.from("inbound_items").select("id, received_at")
    .eq("source", "marketplace").eq("status", "new").is("auto_replied_at", null).order("received_at");
  if (mkt?.length) {
    const from = new Date(new Date(mkt[0].received_at).getTime() - 60e3).toISOString();
    const { data: sentAuto } = await db.from("atm_activity_log").select("id, to_email, created_at")
      .eq("type", "email_sent").ilike("subject", "NDA & Deal Room Access%").gte("created_at", from).order("created_at");
    const { data: taken } = await db.from("inbound_items").select("lead_email, auto_replied_at").not("auto_replied_at", "is", null).gte("auto_replied_at", from);
    const used = new Set((taken || []).map((t) => t.auto_replied_at && new Date(t.auto_replied_at).toISOString()));
    for (const m of mkt) {
      const t0 = new Date(m.received_at).getTime();
      const hit = (sentAuto || []).find((x) => {
        const t = new Date(x.created_at).getTime();
        return !used.has(new Date(x.created_at).toISOString()) && t >= t0 - 60e3 && t <= t0 + 45 * 60e3;
      });
      if (!hit) continue;
      used.add(new Date(hit.created_at).toISOString());
      const lead = (hit.to_email || "").split(",")[0].trim().toLowerCase() || null;
      await db.from("inbound_items").update({
        status: "awaiting_nda", lead_email: lead, auto_replied_at: hit.created_at, first_response_at: hit.created_at,
        due_at: dueAtFor("nda_followup", hit.created_at), updated_at: now, updated_by: "auto: bizbuysell autoresponder",
        suggested_action: "NDA link sent automatically. If they haven't signed by the due time, follow up personally.",
      }).eq("id", m.id);
      stats.autoreplies_linked++;
    }
  }
  // Leads who signed an NDA → converted
  const { data: waitingNda } = await db.from("inbound_items").select("id, lead_email").eq("status", "awaiting_nda").not("lead_email", "is", null);
  if (waitingNda?.length) {
    const emails = [...new Set(waitingNda.map((w) => w.lead_email))];
    // Website NDAs land in nda_signatures (WordPress snippet + email backfill); Deal Hub NDAs in deal_buyer_access.
    const [{ data: signed }, { data: wpSigned }] = await Promise.all([
      db.from("deal_buyer_access").select("buyer_email, created_at, deal_id").in("buyer_email", emails),
      db.from("nda_signatures").select("email, signed_at, route_id").in("email", emails).order("signed_at"),
    ]);
    const signedBy = {};
    const routeIds = [...new Set((wpSigned || []).map((w) => w.route_id).filter(Boolean))];
    const { data: routeDeals } = routeIds.length ? await db.from("atm_routes").select("id, deal_id").in("id", routeIds) : { data: [] };
    const dealOfRoute = Object.fromEntries((routeDeals || []).map((r) => [r.id, r.deal_id]));
    (wpSigned || []).forEach((w) => { signedBy[(w.email || "").toLowerCase()] ||= { created_at: w.signed_at, deal_id: dealOfRoute[w.route_id] || null }; });
    (signed || []).forEach((sg) => { signedBy[(sg.buyer_email || "").toLowerCase()] = sg; });
    for (const w of waitingNda) {
      const sg = signedBy[w.lead_email];
      if (!sg) continue;
      await db.from("inbound_items").update({
        status: "replied", nda_signed_at: sg.created_at, is_nda_signer: true, closed_reason: "converted: signed NDA",
        deal_id: sg.deal_id, updated_at: now, updated_by: "auto: NDA signed",
      }).eq("id", w.id);
      stats.nda_conversions++;
    }
  }

  // ---- 2d. Website NDA confirmations → nda_signatures -------------------------
  // Backup for the WordPress snippet: every "Signed NDA confirmation" email in info@
  // becomes an NDA record, so a signature can never go missing.
  const { data: confs } = await db.from("atm_activity_log").select("gmail_id, snippet, body, created_at")
    .eq("subject", "Signed NDA confirmation").gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString()).limit(200);
  for (const c of confs || []) {
    const t = (c.body || c.snippet || "").replace(/\s+/g, " ");
    const email = t.match(/Email\s+([^\s]+@[^\s]+)/i)?.[1]?.toLowerCase();
    const slug = t.match(/atm-route-for-sale\/([a-z0-9-]+)/i)?.[1]?.toLowerCase();
    if (!email || !c.gmail_id) continue;
    // Skip if the snippet already recorded this signature (same email within 10 minutes)
    const t0 = new Date(c.created_at).getTime();
    const { data: dup } = await db.from("nda_signatures").select("id")
      .eq("email", email).gte("signed_at", new Date(t0 - 6e5).toISOString()).lte("signed_at", new Date(t0 + 6e5).toISOString()).limit(1);
    if (dup?.length) continue;
    const r = slug ? routes.find((x) => x.wp_slug === slug || x.slug === slug) : null;
    const { data: rr } = !r && slug ? await db.from("atm_routes").select("id").or(`wp_slug.eq.${slug},slug.eq.${slug}`).limit(1) : { data: null };
    const { error } = await db.from("nda_signatures").upsert({
      source: "email_confirm", entry_id: "gmail:" + c.gmail_id, email,
      name: t.match(/Full Name\s+(.*?)\s+Phone/i)?.[1] || null,
      phone: t.match(/Phone\s+([+\d]+)/i)?.[1] || null,
      listing_url: slug ? `https://atmbrokerage.com/atm-route-for-sale/${slug}/` : null, listing_slug: slug || null,
      route_id: r?.id || rr?.[0]?.id || null, signed_at: c.created_at, raw: { from: "Signed NDA confirmation email" },
    }, { onConflict: "source,entry_id", ignoreDuplicates: true });
    if (error) stats.errors.push("nda email: " + error.message); else stats.nda_from_email++;
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
