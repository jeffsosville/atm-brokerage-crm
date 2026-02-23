import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgrmxhxozoyvcmvbfuxv.supabase.co", process.env.SUPABASE_SERVICE_ROLE_KEY);

const FAQ = [
  "FAQ: How do ATM routes work? An ATM route is a collection of ATM machines placed at business locations. The owner earns revenue from surcharge fees. Revenue depends on transaction volume, surcharge amount ($2.50-$4.00), and number of machines.",
  "FAQ: What is vault cash? Vault cash is money loaded into ATMs for withdrawals. It is NOT an expense - it is a revolving asset. You load cash, customers withdraw, bank reimburses within 1-2 business days. Typical: $1,500-$3,000 per ATM.",
  "FAQ: How are ATM routes valued? Typically 2.5x to 4x annual net profit (SDE). Key factors: transaction count, surcharge rates, contract terms, equipment condition especially TR31 compliance, geographic density.",
  "FAQ: What is TR31 compliance? TR31 is an encryption key management standard required by payment processors. Non-compliant machines need firmware upgrades or replacement.",
  "FAQ: What does SDE mean? Sellers Discretionary Earnings starts with net profit and adds back owner salary, benefits, one-time expenses, and depreciation. Represents true cash flow to a new owner.",
  "FAQ: How is financing done? SBA loans (10% down, 10-year term), seller financing (20-30% down, 3-5 year term), or cash. SBA most common for deals over $100K.",
  "FAQ: What to look for in due diligence? Verify transaction counts with processor statements. Check location contracts. Verify TR31 compliance. Review vault cash requirements. Assess equipment. Understand geographic spread.",
  "FAQ: What is interchange income? Beyond surcharges, the card-issuing bank pays $0.50-$1.00 per transaction to the ATM operator. Adds up significantly across a large portfolio.",
  "FAQ: What does hands-free operation mean? Using third-party vaulting and maintenance instead of doing it yourself. Reduces time but also margins.",
  "FAQ: Typical ROI? At 2.5-4x SDE multiples, buyers see 25-40% annual ROI. Depends on price, financing, and maintaining transaction volumes.",
];

export async function POST(request) {
  try {
    const { dealId, dlNumber } = await request.json();
    if (!dealId) return Response.json({ error: "dealId required" }, { status: 400 });
    await supabase.from("deal_embeddings").delete().eq("deal_id", dealId).eq("source_type", "faq");
    const rows = FAQ.map((chunk, i) => ({ deal_id: dealId, dl_number: dlNumber || null, content_chunk: chunk, source_type: "faq", source_name: "atm_industry_faq", chunk_index: i }));
    const { error } = await supabase.from("deal_embeddings").insert(rows);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true, chunks: FAQ.length });
  } catch (err) { return Response.json({ error: err.message }, { status: 500 }); }
}
