import { adminDb as db } from "../serverAuth";

// Two alerts so a buyer never sits unanswered without someone knowing:
//  1. Mail sync stopped: gmail_sync.py runs on the sync machine every 30 min. If any active
//     mailbox hasn't synced for SYNC_STALE_MIN, nothing new reaches the queue, so email Jeff.
//  2. New buyer/seller items past their reply target (lib/inbox/sla.js), and BizBuySell leads
//     that got no NDA invite within an hour. One email per run lists only items not alerted before.
// Called from /api/cron/inbox (every 15 min). Never throws; problems go into stats.errors.

const SYNC_STALE_MIN = Number(process.env.SYNC_STALE_MIN || 75);
const SYNC_REALERT_HOURS = 6;
const LOOKBACK_DAYS = 3; // only items received recently; the old backlog is not re-alerted
const ALERT_KINDS = ["offer", "seller_lead", "marketplace_lead", "data_room", "buyer_question", "existing_deal"];
const OPEN = ["new", "drafted", "awaiting_john"];
const SYNC_TO = (process.env.SYNC_ALERT_TO || "jeff@atmbrokerage.com").split(",").map((s) => s.trim()).filter(Boolean);
const OVERDUE_TO = (process.env.OVERDUE_ALERT_TO || "john@atmbrokerage.com,jeff@atmbrokerage.com").split(",").map((s) => s.trim()).filter(Boolean);
const CRM = process.env.NEXT_PUBLIC_APP_URL || "https://atm-brokerage-crm.vercel.app";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hoursAgo = (iso) => Math.round((Date.now() - new Date(iso).getTime()) / 36e5);

async function sendEmail(to, subject, html, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY missing");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from: "CRM Alerts <notifications@atmbrokerage.com>", to, subject, html, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function alreadyAlerted(type, keys, sinceIso) {
  if (!keys.length) return new Set();
  const { data } = await db.from("atm_notifications").select("metadata").eq("type", type).gte("created_at", sinceIso).in("metadata", keys);
  return new Set((data || []).map((n) => n.metadata));
}

async function syncIsStale() {
  const { data: boxes } = await db.from("crm_mailboxes").select("last_sync_at").eq("active", true);
  const cutoff = Date.now() - SYNC_STALE_MIN * 60e3;
  return (boxes || []).some((b) => !b.last_sync_at || new Date(b.last_sync_at).getTime() < cutoff);
}

async function syncAlert(stats) {
  const { data: boxes } = await db.from("crm_mailboxes").select("key, address, last_sync_at").eq("active", true);
  const cutoff = Date.now() - SYNC_STALE_MIN * 60e3;
  const stale = (boxes || []).filter((b) => !b.last_sync_at || new Date(b.last_sync_at).getTime() < cutoff);
  if (!stale.length) return;
  const seen = await alreadyAlerted("sync_stale", ["sync"], new Date(Date.now() - SYNC_REALERT_HOURS * 36e5).toISOString());
  if (seen.has("sync")) return;
  const lines = stale.map((b) => `${b.address}: last synced ${b.last_sync_at ? `${hoursAgo(b.last_sync_at)}h ago` : "never"}`);
  const text = `The CRM has stopped pulling email, so new buyer inquiries are not reaching the queue.\n\n${lines.join("\n")}\n\nCheck sync.log in the atm-crm folder on the sync machine. If it says "Resource deadlock avoided", the folder was offloaded to iCloud: right-click the folder in Finder and choose Keep Downloaded. If it says "No valid token", run python3 gmail_auth.py <key>.`;
  const html = `<p>The CRM has stopped pulling email, so new buyer inquiries are not reaching the queue.</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p>Check <code>sync.log</code> in the atm-crm folder on the sync machine. If it says "Resource deadlock avoided", the folder was offloaded to iCloud: right-click the folder in Finder and choose <b>Keep Downloaded</b>. If it says "No valid token", run <code>python3 gmail_auth.py &lt;key&gt;</code>.</p>`;
  await sendEmail(SYNC_TO, `CRM email sync stopped (${stale.length} inbox${stale.length > 1 ? "es" : ""})`, html, text);
  await db.from("atm_notifications").insert({ type: "sync_stale", priority: "high", title: "CRM email sync stopped", message: text, metadata: "sync" });
  stats.alerts_sync = stale.length;
}

async function overdueAlert(stats) {
  // With the sync down, replies aren't seen either, so every item would look unanswered. The sync alert covers it.
  if (await syncIsStale()) return;
  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 864e5).toISOString();
  const hourAgo = new Date(now.getTime() - 36e5).toISOString();
  const cols = "id, kind, status, from_email, from_name, lead_name, lead_email, lead_phone, subject, received_at, due_at, auto_replied_at, mailbox";
  const [{ data: overdue }, { data: noInvite }] = await Promise.all([
    db.from("inbound_items").select(cols).in("status", OPEN).in("kind", ALERT_KINDS).lt("due_at", now.toISOString()).gte("received_at", since).limit(100),
    db.from("inbound_items").select(cols).eq("kind", "marketplace_lead").eq("status", "new").is("auto_replied_at", null).lt("received_at", hourAgo).gte("received_at", since).limit(100),
  ]);
  const isSystem = (i) => /^notifications?@/i.test(i.from_email || "") && !i.lead_email;
  const byId = new Map();
  (noInvite || []).filter((i) => !isSystem(i)).forEach((i) => byId.set(i.id, { ...i, why: "no NDA invite sent" }));
  (overdue || []).filter((i) => !isSystem(i)).forEach((i) => { if (!byId.has(i.id)) byId.set(i.id, { ...i, why: "past reply target" }); });
  if (!byId.size) return;
  const seen = await alreadyAlerted("overdue_alert", [...byId.keys()], new Date(now.getTime() - 30 * 864e5).toISOString());
  const fresh = [...byId.values()].filter((i) => !seen.has(i.id));
  if (!fresh.length) return;
  fresh.sort((a, b) => (a.received_at < b.received_at ? -1 : 1));
  const who = (i) => [i.lead_name || i.from_name, i.lead_email || i.from_email, i.lead_phone].filter(Boolean).join(" · ");
  const rows = fresh.map((i) => ({ kind: (i.kind || "").replace("_", " "), who: who(i), subject: i.subject || "", age: `${hoursAgo(i.received_at)}h`, why: i.why }));
  const text = `${fresh.length} inquir${fresh.length > 1 ? "ies have" : "y has"} not been answered:\n\n` +
    rows.map((r) => `- [${r.kind}] ${r.who} — ${r.subject} (${r.age} old, ${r.why})`).join("\n") + `\n\nOpen the queue: ${CRM}/queue`;
  const html = `<p>${fresh.length} inquir${fresh.length > 1 ? "ies have" : "y has"} not been answered:</p><table cellpadding="6" style="border-collapse:collapse;font-size:14px">` +
    `<tr><th align="left">Type</th><th align="left">Who</th><th align="left">Subject</th><th align="left">Age</th><th align="left">Why</th></tr>` +
    rows.map((r) => `<tr style="border-top:1px solid #ddd"><td>${esc(r.kind)}</td><td>${esc(r.who)}</td><td>${esc(r.subject)}</td><td>${esc(r.age)}</td><td>${esc(r.why)}</td></tr>`).join("") +
    `</table><p><a href="${CRM}/queue">Open the queue</a></p>`;
  await sendEmail(OVERDUE_TO, `${fresh.length} unanswered inquir${fresh.length > 1 ? "ies" : "y"}`, html, text);
  await db.from("atm_notifications").insert(fresh.map((i) => ({
    type: "overdue_alert", priority: "high", title: `Unanswered: ${who(i) || i.subject}`, message: `${i.subject || ""} (${i.why})`,
    metadata: i.id, dismissed_at: now.toISOString(),
  })));
  stats.alerts_overdue = fresh.length;
}

export async function runAlerts(stats) {
  for (const [name, fn] of [["sync", syncAlert], ["overdue", overdueAlert]]) {
    try { await fn(stats); } catch (e) { stats.errors.push(`alert ${name}: ${e.message}`); }
  }
}
