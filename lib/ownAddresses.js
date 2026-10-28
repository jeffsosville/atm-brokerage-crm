// Our own mailboxes and test addresses. They show up as senders on forwards and notifications,
// but they are never a buyer or seller, so People and the person profile skip them.
export const OWN_DOMAINS = [
  "atmbrokerage.com", "vendingexits.com", "cleaningexits.com", "connectatm.com",
  "atmexits.com", "exitsiq.com", "sosville.co",
];
export const OWN_EMAILS = ["jasosville@gmail.com"];

export function isOwnAddress(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e.includes("@")) return false;
  if (OWN_EMAILS.includes(e)) return true;
  const domain = e.split("@")[1];
  return OWN_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

// Who a queue item is really about. Forwards and notifications come from our own mailboxes,
// so fall back to the first outside address mentioned in the item. Null when there is none.
export function personEmailFor(item) {
  for (const e of [item?.lead_email, item?.from_email]) if (e && e.includes("@") && !isOwnAddress(e)) return e.trim().toLowerCase();
  const found = String(`${item?.summary || ""} ${item?.snippet || ""}`).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  const hit = found.find((e) => !isOwnAddress(e));
  return hit ? hit.toLowerCase() : null;
}
