import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Buffalo is hand-curated — never overwrite
const BUFFALO_DEAL_ID = "77d15b7b-ce3c-4c9e-92c3-136e940fe843";

// Skip these — they're generic templates not deal-specific intel
const SKIP_FILENAME_PATTERNS = [
  /example.*agreement/i,
  /example.*loi/i,
  /loi.*example/i,
  /example.*non.compete/i,
  /non.compete.*example/i,
  /example.*escrow/i,
  /escrow.*example/i,
  /example.*bill of sale/i,
  /bill of sale.*example/i,
  /asset purchase agreement.*example/i,
  /example.*asset purchase/i,
  /\.zip$/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
];

// Detect file role from filename
function classifyFile(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.includes("q&a") || lower.includes("q & a") || lower.includes("qa")) return "deal_qa";
  if (lower.includes("data") || lower.includes("summary") || lower.includes("financial")) return "financial";
  if (lower.includes("cim") || lower.includes("description") || lower.includes("operating cost") || lower.includes("portfolio")) return "cim";
  return "cim"; // default
}

// Should we skip this file?
function shouldSkip(fileName) {
  return SKIP_FILENAME_PATTERNS.some((re) => re.test(fileName));
}

// Extract text from a file based on type
async function extractText(buffer, fileName) {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheets = [];
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      sheets.push(`--- Sheet: ${name} ---\n${csv}`);
    }
    return sheets.join("\n\n");
  }

  if (lower.endsWith(".pdf")) {
    // Lazy-load pdf-parse only when needed (it has init quirks)
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buffer);
    return data.text;
  }

  return null; // unsupported type
}

// Send to Claude with a prompt tailored to file role
async function chunkWithClaude(text, role, fileName, dealName) {
  const truncated = text.length > 80000 ? text.substring(0, 80000) + "\n\n[... truncated ...]" : text;

  const prompts = {
    cim: `You are processing a Confidential Information Memorandum (CIM) for an ATM route business listing called "${dealName}". Extract structured knowledge chunks that an AI concierge will use to answer prospective buyer questions.

Produce 12-20 chunks. Each chunk should be 80-200 words, self-contained, and labeled with a category prefix like "OVERVIEW:", "FINANCIALS:", "EQUIPMENT:", "LOCATIONS:", "CONTRACTS:", "OPERATIONS:", "OPPORTUNITY:", "TRANSITION:".

Cover (only what's in the source): asking price, ATM count, transaction volume, gross/net profit, surcharge rates, equipment makes/models, TR31/EMV compliance, location types, contracts, vault cash, why selling, ideal buyer, transition support.

NEVER include the seller's name, company name, or other identifying info.

Output ONLY a JSON array of strings. No markdown, no preamble.

SOURCE DOCUMENT (${fileName}):
${truncated}`,

    financial: `You are processing financial data for an ATM route business listing called "${dealName}". This data will be used by an AI concierge to answer buyer questions about financials.

Produce 10-20 chunks. Each chunk should be 80-200 words, self-contained, factual, and labeled with a prefix like "PORTFOLIO TOTALS:", "REVENUE BREAKDOWN:", "EXPENSES:", "TOP PERFORMERS:", "LOWEST PERFORMERS:", "EQUIPMENT MIX:", "TRANSACTION VOLUME:", "SURCHARGE RATES:", "MERCHANT SPLITS:", "TRENDS:", "VALUATION:".

Use specific numbers from the source. Aggregate where helpful (e.g., "Top 10 ATMs generate $X/month"). Don't list individual rows unless they're notably high or low.

Output ONLY a JSON array of strings. No markdown, no preamble.

SOURCE DATA (${fileName}):
${truncated}`,

    deal_qa: `You are processing a deal-specific Q&A document for an ATM route business listing called "${dealName}". Convert each question/answer pair into a self-contained chunk.

Format each chunk as: "Q: [the question] A: [the answer, paraphrased and concise, 50-150 words]"

Preserve all factual content from the answers. NEVER include the seller's name or identifying info.

Output ONLY a JSON array of strings. No markdown, no preamble.

SOURCE Q&A (${fileName}):
${truncated}`,
  };

  const prompt = prompts[role] || prompts.cim;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content[0]?.text?.trim() || "[]";
  // Strip markdown fences if Claude added them despite instructions
  const cleaned = raw.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/\s*```$/, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed.filter((c) => typeof c === "string" && c.trim().length > 20);
  } catch (err) {
    console.error(`Failed to parse Claude response for ${fileName}:`, err.message);
    console.error("Raw response:", raw.substring(0, 500));
    return [];
  }
}

export async function POST(request) {
  try {
    const { dealId } = await request.json();
    if (!dealId) return Response.json({ error: "dealId required" }, { status: 400 });

    if (dealId === BUFFALO_DEAL_ID) {
      return Response.json({
        success: true,
        message: "Buffalo is hand-curated — skipped to preserve quality chunks",
        filesProcessed: 0,
        chunksCreated: 0,
      });
    }

    // Get deal info
    const { data: dealRows } = await supabase
      .from("atm_deals")
      .select("id, deal_name, dl_number")
      .eq("id", dealId)
      .limit(1);
    const deal = dealRows?.[0];
    if (!deal) return Response.json({ error: "Deal not found" }, { status: 404 });

    // Get all active files for this deal
    const { data: files } = await supabase
      .from("listing_files")
      .select("id, file_name, file_type, storage_path")
      .eq("listing_id", dealId)
      .eq("is_active", true);

    if (!files || files.length === 0) {
      return Response.json({ success: true, message: "No files to ingest", filesProcessed: 0, chunksCreated: 0 });
    }

    // Filter out templates and unsupported types
    const processable = files.filter((f) => !shouldSkip(f.file_name));
    const skippedTemplates = files.length - processable.length;

    // Extract text from each file
    const fileResults = [];
    for (const file of processable) {
      try {
        const { data: blob, error: dlErr } = await supabase.storage
          .from("deal-files")
          .download(file.storage_path);
        if (dlErr || !blob) {
          fileResults.push({ file: file.file_name, status: "download_failed", error: dlErr?.message });
          continue;
        }
        const buffer = Buffer.from(await blob.arrayBuffer());
        const text = await extractText(buffer, file.file_name);

        if (!text || text.trim().length < 200) {
          fileResults.push({ file: file.file_name, status: "too_short_or_unsupported" });
          continue;
        }

        const role = classifyFile(file.file_name);
        const chunks = await chunkWithClaude(text, role, file.file_name, deal.deal_name);

        if (chunks.length === 0) {
          fileResults.push({ file: file.file_name, status: "no_chunks_generated" });
          continue;
        }

        fileResults.push({
          file: file.file_name,
          status: "success",
          role,
          chunks: chunks.length,
          textLength: text.length,
          _chunks: chunks, // internal use
          _role: role,
        });
      } catch (err) {
        console.error(`Error processing ${file.file_name}:`, err);
        fileResults.push({ file: file.file_name, status: "error", error: err.message });
      }
    }

    // Map our internal roles to source_type values stored in DB
    const roleToSourceType = {
      cim: "cim",
      financial: "financial",
      deal_qa: "deal_qa",
    };
    const sourceTypesUsed = [...new Set(fileResults.filter((r) => r._chunks).map((r) => roleToSourceType[r._role]))];

    if (sourceTypesUsed.length === 0) {
      return Response.json({
        success: false,
        message: "No files successfully processed",
        filesProcessed: 0,
        skippedTemplates,
        results: fileResults.map(({ _chunks, _role, ...rest }) => rest),
      });
    }

    // Delete old chunks ONLY for source types we're replacing
    // (preserves FAQ and seller_notes chunks)
    for (const st of sourceTypesUsed) {
      await supabase.from("deal_embeddings").delete().eq("deal_id", dealId).eq("source_type", st);
    }

    // Insert new chunks
    let chunkIndex = 0;
    const rowsToInsert = [];
    for (const result of fileResults) {
      if (!result._chunks) continue;
      const sourceType = roleToSourceType[result._role];
      for (const chunk of result._chunks) {
        rowsToInsert.push({
          deal_id: dealId,
          dl_number: deal.dl_number || null,
          content_chunk: chunk,
          source_type: sourceType,
          source_name: result.file,
          chunk_index: chunkIndex++,
        });
      }
    }

    // Insert in batches of 50
    for (let i = 0; i < rowsToInsert.length; i += 50) {
      const batch = rowsToInsert.slice(i, i + 50);
      const { error } = await supabase.from("deal_embeddings").insert(batch);
      if (error) {
        console.error("Insert error:", error);
        return Response.json({ error: "Insert failed: " + error.message }, { status: 500 });
      }
    }

    return Response.json({
      success: true,
      dealName: deal.deal_name,
      filesProcessed: fileResults.filter((r) => r.status === "success").length,
      filesSkippedTemplates: skippedTemplates,
      filesFailed: fileResults.filter((r) => r.status !== "success").length,
      chunksCreated: rowsToInsert.length,
      sourceTypesReplaced: sourceTypesUsed,
      results: fileResults.map(({ _chunks, _role, ...rest }) => rest),
    });
  } catch (err) {
    console.error("Auto-ingest error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({
    message: "POST { dealId } to auto-ingest all uploaded files for a deal",
    note: "Buffalo deal is protected and will be skipped",
  });
}
