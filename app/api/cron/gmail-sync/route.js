import { adminDb as db } from "../../../../lib/serverAuth";
import { gmail, hasToken, headersOf, parseAddress, bodyText, authorizedCron, GmailError } from "../../../../lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Pulls new mail from every active crm_mailboxes inbox into atm_activity_log.
// Port of gmail_sync.py (which ran from cron on Jeff's Mac). pg_cron calls this every 5 minutes.
// Incremental via Gmail history id (crm_mailboxes.gmail_history_id); first run or a lost history id
// falls back to a date query. ?days=N re-pulls the last N days; ?box=info limits to one mailbox.

const MAX_PER_BOX = 250; // messages fetched per mailbox per run; the rest come next run
const WARMUP_TAGS = (process.env.INSTANTLY_WARMUP_TAGS || "EKZGHY5").split(",").map((s) => s.trim()).filter(Boolean);

async function pool(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(...(await Promise.all(list.slice(i, i + size).map(fn))));
  return out;
}

const afterQuery = (days) => {
  const d = new Date(Date.now() - days * 864e5);
  return `after:${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

async function listIds(box, q) {
  const ids = [];
  let pageToken;
  do {
    const r = await gmail(box, "/messages", { query: { q, maxResults: 500, pageToken } });
    for (const m of r.messages || []) ids.push(m.id);
    pageToken = r.nextPageToken;
  } while (pageToken && ids.length < 5000);
  return ids;
}

async function historyIds(box, startHistoryId) {
  const ids = new Set();
  let pageToken;
  do {
    const r = await gmail(box, "/history", { query: { startHistoryId, historyTypes: "messageAdded", maxResults: 500, pageToken } });
    for (const h of r.history || []) for (const a of h.messagesAdded || []) ids.add(a.message.id);
    pageToken = r.nextPageToken;
  } while (pageToken);
  return [...ids];
}

async function syncBox(m, days) {
  const box = m.key;
  const mine = m.address.toLowerCase();
  const out = { box, found: 0, new: 0, inserted: 0, matched: 0, skipped: 0, more: false };

  let ids;
  if (days) ids = await listIds(box, afterQuery(days));
  else if (m.gmail_history_id) {
    try { ids = await historyIds(box, m.gmail_history_id); }
    catch (e) {
      if (!(e instanceof GmailError && e.status === 404)) throw e;
      ids = await listIds(box, afterQuery(2)); // history id too old: Gmail forgets after ~1 week
    }
  } else ids = await listIds(box, afterQuery(1));
  out.found = ids.length;

  // Profile historyId taken BEFORE fetching, so nothing that lands mid-run is skipped next time
  const profile = await gmail(box, "/profile");

  const existing = new Set();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await db.from("atm_activity_log").select("gmail_id").in("gmail_id", ids.slice(i, i + 500));
    for (const r of data || []) existing.add(r.gmail_id);
  }
  let todo = ids.filter((id) => !existing.has(id));
  out.new = todo.length;
  if (todo.length > MAX_PER_BOX) { out.more = true; todo = todo.slice(0, MAX_PER_BOX); }

  const msgs = (await pool(todo, 10, async (id) => {
    try { return await gmail(box, `/messages/${id}`, { query: { format: "full" } }); }
    catch (e) { if (e instanceof GmailError && e.status === 404) return null; throw e; }
  })).filter(Boolean);

  const rows = [];
  for (const msg of msgs) {
    if ((msg.labelIds || []).includes("DRAFT")) { out.skipped++; continue; } // unsent drafts are not emails
    const h = headersOf(msg);
    const subject = h.subject || "(no subject)";
    if (WARMUP_TAGS.some((t) => `${subject} ${msg.snippet || ""}`.includes(t))) { out.skipped++; continue; }
    const from = parseAddress(h.from);
    const to = parseAddress(h.to);
    const sent = from === mine;
    rows.push({
      _cc: (h.cc || "").split(",").map(parseAddress).filter(Boolean),
      _ext: sent ? to : from,
      type: sent ? "email_sent" : "email_received",
      subject: subject.slice(0, 500),
      snippet: (msg.snippet || "").slice(0, 1000),
      body: bodyText(msg.payload) || null,
      from_email: from,
      to_email: to,
      gmail_id: msg.id,
      thread_id: msg.threadId,
      created_at: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString(),
      mailbox: box,
      message_id: (h["message-id"] || "").trim() || null,
    });
  }

  // Same email in two of our mailboxes (cc'd, forwarded): import it once
  const mids = rows.map((r) => r.message_id).filter(Boolean);
  const seenMid = new Set();
  for (let i = 0; i < mids.length; i += 200) {
    const { data } = await db.from("atm_activity_log").select("message_id").in("message_id", mids.slice(i, i + 200));
    for (const r of data || []) seenMid.add(r.message_id);
  }
  const fresh = [];
  for (const r of rows) {
    if (r.message_id && seenMid.has(r.message_id)) { out.skipped++; continue; }
    if (r.message_id) seenMid.add(r.message_id);
    fresh.push(r);
  }

  // Company matching (same rules as gmail_sync.py: exact email, then non-generic domain, then cc)
  const emails = [...new Set(fresh.flatMap((r) => [r._ext, ...r._cc]).filter(Boolean))];
  const match = {};
  for (let i = 0; i < emails.length; i += 100) {
    const { data, error } = await db.rpc("gmail_match_companies", { p_emails: emails.slice(i, i + 100) });
    if (error) throw new Error(`match: ${error.message}`);
    for (const r of data || []) match[r.email] = r.company_id;
  }

  const insert = fresh.map(({ _cc, _ext, ...r }) => {
    const company_id = (_ext && match[_ext]) || _cc.map((c) => match[c]).find(Boolean) || null;
    if (company_id) out.matched++;
    return { ...r, company_id };
  });
  for (let i = 0; i < insert.length; i += 50) {
    const { error, count } = await db.from("atm_activity_log")
      .upsert(insert.slice(i, i + 50), { onConflict: "gmail_id", ignoreDuplicates: true, count: "exact" });
    if (error) throw new Error(`insert: ${error.message}`);
    out.inserted += count ?? insert.slice(i, i + 50).length;
  }

  // Only move the history pointer when this run got everything; otherwise the next run re-lists
  await db.from("crm_mailboxes").update({
    ...(out.more ? {} : { gmail_history_id: profile.historyId }),
    last_sync_at: new Date().toISOString(),
    last_sync_error: null,
    connected_at: m.connected_at || new Date().toISOString(),
  }).eq("key", box);
  return out;
}

export async function GET(request) {
  if (!authorizedCron(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    return Response.json({ error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set" }, { status: 500 });
  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days")) || 0;
  const only = url.searchParams.get("box");

  const { data: boxes } = await db.from("crm_mailboxes").select("key, address, connected_at, gmail_history_id").eq("active", true).order("key");
  const report = [];
  for (const m of boxes || []) {
    if (only && m.key !== only) continue;
    if (!(await hasToken(m.key))) { report.push({ box: m.key, skipped: "no token" }); continue; }
    try {
      report.push(await syncBox(m, days));
    } catch (e) {
      const msg = String(e.message || e).slice(0, 500);
      await db.from("crm_mailboxes").update({ last_sync_error: msg }).eq("key", m.key);
      report.push({ box: m.key, error: msg });
    }
  }
  const failed = report.filter((r) => r.error);
  return Response.json({ ok: failed.length === 0, report }, { status: failed.length && failed.length === report.length ? 500 : 200 });
}

export const POST = GET;
