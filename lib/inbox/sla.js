// Reply-time targets, in business hours (Mon–Fri, 9am–5pm Eastern).
export const SLA_HOURS = {
  offer: 2,
  seller_lead: 2,
  data_room: 4,
  existing_deal: 8,
  buyer_question: 8,
  marketplace_lead: 8,
  other: 16,
  nda_followup: 24, // 3 business days for a BizBuySell lead to sign the NDA
};

const etParts = (d) => {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "numeric", hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { dow: get("weekday"), hour: Number(get("hour")) % 24 };
};
const isBusinessMinute = (d) => {
  const { dow, hour } = etParts(d);
  return !["Sat", "Sun"].includes(dow) && hour >= 9 && hour < 17;
};

// Adds business hours to a date, stepping in 15-minute increments.
export function addBusinessHours(start, hours) {
  let t = new Date(start);
  let left = hours * 4; // 15-minute steps
  let guard = 0;
  while (left > 0 && guard++ < 5000) {
    const counts = isBusinessMinute(t); // the 15 minutes starting at t
    t = new Date(t.getTime() + 15 * 60 * 1000);
    if (counts) left--;
  }
  return t;
}

export function dueAtFor(kind, receivedAt) {
  const h = SLA_HOURS[kind];
  return h ? addBusinessHours(receivedAt, h).toISOString() : null;
}
