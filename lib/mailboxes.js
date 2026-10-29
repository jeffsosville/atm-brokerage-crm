import { adminDb as db } from "./serverAuth";

// The Gmail inboxes the CRM syncs and drafts into (table crm_mailboxes): info@ and john@ for ATM,
// and one inbox per brand (cleaning = hello@cleaningexits.com, vending = info@vendingexits.com, ...).
// The sync and draft push run on the sync machine (gmail_sync.py / gmail_draft_push.py) and read the same table.
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

/** Gmail link for one synced email (atm_activity_log row). Older rows have no mailbox: guess info@/john@ as before. */
export function emailLink(all, row) {
  if (!row?.thread_id) return null;
  const key = row.mailbox || (/john@atmbrokerage\.com/i.test(`${row.from_email} ${row.to_email}`) ? "john" : "info");
  return url(addr(all, key), "all/" + row.thread_id);
}

/** Where to open a queue item in Gmail: the thread holding its draft if there is one, else the thread it came in on. */
export function itemLinks(all, i) {
  const draftBox = i.draft_mailbox || null;
  const draftAddress = draftBox ? addr(all, draftBox) : null;
  let gmail_url = null;
  if (draftBox && i.draft_pushed_at && i.draft_thread_id) gmail_url = url(draftAddress, "all/" + i.draft_thread_id);
  else if (i.thread_id && (!draftBox || !i.mailbox || i.mailbox === draftBox)) gmail_url = url(addr(all, i.mailbox || (draftBox === "john" ? "john" : "info")), "all/" + i.thread_id);
  else if (draftBox && i.draft_pushed_at) gmail_url = url(draftAddress, "drafts");
  else if (i.thread_id) gmail_url = url(addr(all, i.mailbox || "info"), "all/" + i.thread_id);
  return { gmail_url, draft_address: draftAddress };
}
