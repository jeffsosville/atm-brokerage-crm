import { adminDb as db } from "./serverAuth";

// The Gmail inboxes the CRM syncs and drafts into (table crm_mailboxes): info@ and john@ for ATM,
// and one inbox per brand (cleaning = hello@cleaningexits.com, vending = info@vendingexits.com, ...).
// The sync and draft push run on Vercel (/api/cron/gmail-sync, /api/cron/gmail-drafts; tokens in gmail_tokens).
let cache = null, cachedAt = 0;
export async function mailboxes() {
  if (!cache || Date.now() - cachedAt > 60_000) {
    const { data } = await db.from("crm_mailboxes").select("key, address, vertical, active, connected_at");
    cache = Object.fromEntries((data || []).map((m) => [m.key, m]));
    cachedAt = Date.now();
  }
  return cache;
}

/** The brand's own inbox key, once it is signed in on the sync machine; null until then (drafts fall back to info@). */
export async function brandMailboxKey(vslug) {
  const all = await mailboxes();
  const m = Object.values(all).find((x) => x.vertical === vslug && x.active && x.connected_at && !["info", "john"].includes(x.key));
  return m?.key || null;
}

/** Brand (vertical slug) of a mailbox, for tagging mail that arrived in a brand inbox. */
export async function mailboxVertical(key) {
  if (!key) return null;
  return (await mailboxes())[key]?.vertical || null;
}

const addr = (all, key) => all[key]?.address || (key === "john" ? "john@atmbrokerage.com" : "info@atmbrokerage.com");
const url = (address, hash) => `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(address)}#${hash}`;

/** Older rows have no mailbox: guess it from the addresses on the email (brand domain, john@), else info@. */
function guessBox(all, row) {
  if (row.mailbox) return row.mailbox;
  const who = `${row.from_email || ""} ${row.to_email || ""} ${row.thread_addrs || ""}`.toLowerCase();
  for (const m of Object.values(all)) {
    if (["info", "john", "jeff"].includes(m.key) || !m.address) continue;
    const domain = m.address.split("@")[1];
    if (domain && who.includes("@" + domain)) return m.key;
  }
  if (/john@atmbrokerage\.com/.test(who)) return "john";
  if (/jeff@atmbrokerage\.com/.test(who)) return "jeff";
  return "info";
}

/** For queue items with no mailbox, pull every from/to address on their thread so guessBox has something to go on. */
export async function withThreadAddrs(items) {
  const ids = [...new Set(items.filter((i) => !i.mailbox && i.thread_id).map((i) => i.thread_id))];
  if (!ids.length) return items;
  const { data } = await db.from("atm_activity_log").select("thread_id, from_email, to_email").in("thread_id", ids);
  const by = {};
  for (const r of data || []) by[r.thread_id] = `${by[r.thread_id] || ""} ${r.from_email || ""} ${r.to_email || ""}`;
  return items.map((i) => (!i.mailbox && by[i.thread_id] ? { ...i, thread_addrs: by[i.thread_id] } : i));
}

/** Gmail link for one synced email (atm_activity_log row). */
export function emailLink(all, row) {
  if (!row?.thread_id) return null;
  return url(addr(all, guessBox(all, row)), "all/" + row.thread_id);
}

/** Where to open a queue item in Gmail: the thread holding its draft if there is one, else the thread it came in on. */
export function itemLinks(all, i) {
  const draftBox = i.draft_mailbox || null;
  const draftAddress = draftBox ? addr(all, draftBox) : null;
  let gmail_url = null;
  if (draftBox && i.draft_pushed_at && i.draft_thread_id) gmail_url = url(draftAddress, "all/" + i.draft_thread_id);
  else if (i.thread_id) gmail_url = url(addr(all, guessBox(all, i)), "all/" + i.thread_id);
  else if (draftBox && i.draft_pushed_at) gmail_url = url(draftAddress, "drafts");
  return { gmail_url, draft_address: draftAddress };
}
