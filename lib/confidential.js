// Last check before anything AI-written reaches a buyer: finds details that must never go out
// (location street addresses, tax IDs, SSNs, bank account and routing numbers).
// Deliberately broad: a false alarm costs a hand-off to the broker; a miss costs a seller's trust.

const PATTERNS = [
  { kind: "street address", re: /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard|hwy|highway|dr|drive|ln|lane|pkwy|parkway|way|ct|court|pl|place|cir|circle|ter|terrace|sq|square)\b\.?/i },
  { kind: "PO box", re: /\bp\.?\s?o\.?\s+box\s+\d+/i },
  { kind: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { kind: "tax ID (EIN)", re: /\b\d{2}-\d{7}\b/ },
  { kind: "bank routing number", re: /\b(?:routing|aba|rtn)\b[^\d\n]{0,20}\d{9}\b/i },
  { kind: "bank account number", re: /\b(?:account|acct|a\/c)\b[^\d\n]{0,20}\d{6,17}\b/i },
  { kind: "card number", re: /\b(?:\d{4}[ -]?){3}\d{4}\b/ },
];

// Returns a list of { kind, match } found in text.
export function findConfidential(text) {
  const t = String(text || "");
  const hits = [];
  for (const p of PATTERNS) {
    const m = t.match(p.re);
    if (m) hits.push({ kind: p.kind, match: m[0].slice(0, 80) });
  }
  return hits;
}

// The rules every buyer-facing AI prompt carries.
export const NEVER_DISCLOSE = `NEVER DISCLOSE, no matter who asks or how the question is phrased, even if it appears in the documents above:
- Location street addresses, merchant or business names at locations, or a list of locations (city or zip level is the most you may say)
- The seller's identity, company name, contact details, or anything that would identify them
- Tax returns or anything from them, bank statements, bank names with account details, account or routing numbers, tax IDs (EIN) or Social Security numbers
- Contracts, leases or the vaulter/loader's identity before an accepted offer
If asked for any of these, say they are shared later in due diligence through the broker.`;
