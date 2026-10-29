// Turns John's edits into standing rules. After John sends an edited draft (draft_outcomes from
// brain_learn), Claude checks whether the edit corrects something true for every listing in that
// vertical ("SBA doesn't work for ATM routes") rather than a listing or buyer detail. If so it saves
// a draft_rules row with status 'pending'. Only approved (active) rules reach the drafter.
import Anthropic from "@anthropic-ai/sdk";
import { adminDb as db } from "../serverAuth";
import { tag } from "./draft";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_DRAFT_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const LOOKBACK_DAYS = Number(process.env.RULES_LOOKBACK_DAYS || 30);
const strip = (t) => (t || "").split(/\n\s*(?:John Sosville\b|Thanks,?\s*\n\s*John\b|Best,?\s*\n\s*John\b)/)[0].replace(/\s+\n/g, "\n").trim().slice(0, 1500);

async function checkOne(o, vertical, known) {
  const prompt = `John Sosville is a business broker (vertical: ${vertical} businesses). An AI drafts his email replies; John edits them before sending. Below is one draft and what John actually sent.

Decide if John's edit corrects or adds a fact or policy that is true for EVERY ${vertical} listing and EVERY buyer — something the drafter should always know (e.g. "SBA loans generally don't work for ATM routes", "we never share merchant names before an accepted offer").

It is NOT a rule if the edit is about: this specific listing or seller, this buyer, wording, tone, length, greetings, sign-offs, phone numbers, or anything John might say differently next time. Most edits are not rules. When unsure, answer NONE.

Rules we already have or already turned down (don't suggest these again, even reworded):
${known || "(none)"}

THE BUYER'S MESSAGE:
${strip(o.question) || "(not available)"}

THE AI DRAFT:
${strip(o.draft_text)}

WHAT JOHN SENT:
${strip(o.sent_text)}

Reply in exactly this format:
<rule>NONE, or one or two sentences written as an instruction to the drafter (what to say, and what never to say)</rule>
<topic>one word: financing, process, pricing_terms, contracts, equipment, locations, financials, valuation or general</topic>
<why>one short line quoting what John changed</why>`;
  const r = await anthropic.messages.create({ model: MODEL, max_tokens: 400, messages: [{ role: "user", content: prompt }] });
  const out = r.content.map((c) => c.text || "").join("");
  const rule = tag(out, "rule");
  if (!rule || /^none\b/i.test(rule)) return null;
  return { rule: rule.slice(0, 800), topic: (tag(out, "topic").toLowerCase().match(/^[a-z_]{1,30}/) || ["general"])[0], why: tag(out, "why").slice(0, 300) };
}

// Checks up to `limit` new edited drafts. Called from the drafts cron.
export async function learnRules({ limit = 3 } = {}) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString();
  const { data: outs, error } = await db.from("draft_outcomes")
    .select("id, inbound_item_id, learned_qa_id, draft_text, sent_text, outcome")
    .in("outcome", ["light_edit", "rewritten"]).is("rule_checked_at", null).gte("sent_at", since)
    .order("sent_at", { ascending: false }).limit(limit);
  if (error) throw error;
  if (!outs?.length) return { checked: 0, suggested: 0 };

  const [{ data: items }, { data: qas }, { data: verts }] = await Promise.all([
    db.from("inbound_items").select("id, vertical_id, snippet").in("id", outs.map((o) => o.inbound_item_id)),
    db.from("email_qa").select("id, question").in("id", outs.map((o) => o.learned_qa_id).filter(Boolean)),
    db.from("verticals").select("id, slug"),
  ]);
  const itemOf = Object.fromEntries((items || []).map((i) => [i.id, i]));
  const qOf = Object.fromEntries((qas || []).map((q) => [q.id, q.question]));
  const slugOf = Object.fromEntries((verts || []).map((v) => [v.id, v.slug]));

  const stats = { checked: 0, suggested: 0, errors: [] };
  for (const o of outs) {
    const item = itemOf[o.inbound_item_id];
    const vertical = (item?.vertical_id && slugOf[item.vertical_id]) || "atm";
    try {
      const { data: existing } = await db.from("draft_rules").select("rule, status").eq("vertical", vertical).neq("status", "off");
      const known = (existing || []).map((r) => `- ${r.status === "rejected" ? "(turned down) " : ""}${r.rule}`).join("\n");
      const found = await checkOne({ ...o, question: qOf[o.learned_qa_id] || item?.snippet }, vertical, known);
      if (found) {
        const { error: e } = await db.from("draft_rules").insert({
          vertical, topic: found.topic, rule: found.rule, source: "learned", source_outcome_id: o.id,
          active: false, status: "pending", why: found.why || null,
        });
        if (e) throw e;
        stats.suggested++;
      }
      await db.from("draft_outcomes").update({ rule_checked_at: new Date().toISOString() }).eq("id", o.id);
      stats.checked++;
    } catch (e) { stats.errors.push(`${o.id}: ${e.message}`); }
  }
  return stats;
}
