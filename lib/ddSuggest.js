// Proposes DD checklist answers from new information (deal room answers, uploaded files, later email).
// Suggestions go to dd_suggestions for Chrislie to accept or dismiss — nothing is written to the
// checklist or shown to buyers automatically.
import Anthropic from "@anthropic-ai/sdk";
import { adminDb as db } from "./serverAuth";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const CLOSED = ["verified", "declined", "na"];

function parseJson(text) {
  const m = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// text: the new information. Returns the number of suggestions created.
export async function suggestFromText({ dealId, text, sourceKind, sourceRef, sourceLabel, sourceWho = null, hintKeys = [] }) {
  if (!dealId || !text || text.trim().length < 20) return 0;

  const { data: routes } = await db.from("atm_routes").select("id, vertical_id").eq("deal_id", dealId);
  if (!routes?.length) return 0;

  let created = 0;
  for (const route of routes) {
    const { data: items } = await db
      .from("v_route_dd_items")
      .select("item_key, section, label, seller_question, status, answer_text")
      .eq("route_id", route.id)
      .order("sort_order");
    // Only items still worth filling: not closed. Items with an answer are included so a better one can be proposed.
    const open = (items || []).filter((i) => !CLOSED.includes(i.status));
    if (!open.length) continue;

    const list = open.map((i) =>
      `${i.item_key} | ${i.label} | asks: ${i.seller_question || "-"} | current: ${(i.answer_text || "none").slice(0, 160)}`
    ).join("\n");

    const prompt = `You help fill an ATM route due-diligence checklist from new information.

CHECKLIST ITEMS (key | item | what it asks | current answer):
${list}

NEW INFORMATION (${sourceLabel}):
${text.slice(0, 30000)}
${hintKeys.length ? `\nLikely relevant items: ${hintKeys.join(", ")}` : ""}

For each checklist item this information actually answers, write a short factual answer using ONLY facts stated in the information (numbers, names, counts, dates). Skip items it doesn't answer. Skip items where the current answer already says the same thing. Never guess or calculate new figures.

Return ONLY a JSON array (empty if nothing applies):
[{"item_key":"...","answer":"...","excerpt":"the exact sentence or cells it came from, under 200 characters"}]`;

    let out;
    try {
      const r = await anthropic.messages.create({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: prompt }] });
      out = parseJson(r.content.map((c) => c.text || "").join(""));
    } catch (err) {
      console.error("[dd-suggest]", sourceLabel, err.message);
      continue;
    }
    const validKeys = new Set(open.map((i) => i.item_key));
    const rows = (Array.isArray(out) ? out : [])
      .filter((s) => s && validKeys.has(s.item_key) && typeof s.answer === "string" && s.answer.trim())
      .map((s) => ({
        route_id: route.id,
        item_key: s.item_key,
        answer_text: s.answer.trim().slice(0, 1000),
        excerpt: typeof s.excerpt === "string" ? s.excerpt.slice(0, 300) : null,
        source_kind: sourceKind,
        source_ref: String(sourceRef),
        source_label: sourceLabel,
        source_who: sourceWho,
      }));
    if (!rows.length) continue;
    const { error } = await db.from("dd_suggestions").upsert(rows, { onConflict: "route_id,item_key,source_kind,source_ref", ignoreDuplicates: true });
    if (error) console.error("[dd-suggest] insert", error.message);
    else created += rows.length;
  }
  return created;
}
