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

  // ATM Startup Guide — Overview
  "GUIDE: ATM Business Overview. Owning ATMs means buying machines, finding locations, installing them, filling with cash, and earning every time a customer withdraws. The surcharge fee is re-deposited daily. A portion goes to the merchant as commission. Additional revenue comes from interchange. Industry stats: 425,000 total ATMs in the US, 222,000 independently owned. Average ATM fee: $2.77. Average merchant commission: $0.50-$1.00 per transaction. Average interchange net: $0.10-$0.20 per transaction.",

  // Equipment
  "GUIDE: ATM Equipment Costs. New machine entry level: $2,500-$3,000. Higher end with multiple cassettes: $3,000-$6,000+. Main manufacturers: Hantle, Genmega, Triton, Hyosung. Key upgrades to consider: 1,000-note removable cassette (allows swapping), electronic lock ($50 upgrade over standard dial lock), audit lock for armored truck ($300-$400). Stick with one manufacturer across your portfolio for easier parts and maintenance.",

  // Processing
  "GUIDE: ATM Processing. The processor handles transactions, movement of funds, and gives you real-time online access to all terminals. Installation costs vary $200-$500 depending on complexity. Interchange net income: $0.10-$0.20 per withdrawal transaction depending on volume.",

  // Communication
  "GUIDE: ATM Communication Options. Phone line: works but avoid digital phone signals. Internet/ethernet: most effective and least expensive — run CAT5 directly to machine. Wireless: option when no phone or internet available, costs $15-$20/month extra. Wireless is the last resort option.",

  // Location Types Tier 1
  "GUIDE: Best ATM Location Types (Tier 1). These are high-traffic, obvious targets: convenience stores (independently owned, avoid large chains), concert halls and music venues, strip clubs (captive audience), hotels with 250+ rooms (independently owned preferred), bars and nightclubs. Cash-only businesses of any type are ideal — customers must use the ATM.",

  // Location Types Tier 2
  "GUIDE: Good ATM Location Types (Tier 2). Lesser known but profitable: bars and taverns, smaller hotels under 200 rooms, bowling alleys, amusement parks and fairs, office complexes with 500+ people, carwashes, 24/7 diners, hair salons and barbers (cash only), liquor stores, movie theaters, nail salons, VFW and American Legion halls (often cash only), fast food and mom and pop restaurants, travel stops, tourist attractions, Chinese buffets.",

  // Finding Locations
  "GUIDE: Finding ATM Locations. Best free sources: Google Maps search nearby, yellow pages, liquor license listings (find new businesses before they open — ideal timing), beer and liquor sales reps (they know new openings first), credit card merchant reps (trade leads). Yelp: search your city plus 'cash only' to find cash-only businesses. Cold calling is the most proven method — it is a volume game. Set a goal of 30 minutes of calls per day minimum. Target 2-3 location types at a time.",

  // Cold Calling Scripts
  "GUIDE: ATM Cold Calling Script. Goal: identify locations with no ATM, broken ATM, unhappy merchant, or owner who cannot maintain their machine. Script 1: 'Do you have an ATM there?' If no, move to pitch. If yes: 'Is it always in service?' If no, visit and offer replacement. Pitch to owner: 'We are a local ATM provider. We install an ATM at no cost to you. We handle all service and maintenance including vault cash and split a portion of the proceeds with you monthly.' Key: get to NO COST quickly. Merchant earns roughly 30% of the surcharge fee.",

  // Income and Expenses
  "GUIDE: ATM Income and Expenses Per Machine. Average transactions: 100-150 per month. Average withdrawal amount: $70. Average surcharge fee: $2.50-$3.00. Average merchant commission: $0.50-$1.00 per transaction. Average interchange: $0.10-$0.20 per transaction. Net income target: $200 per month per terminal after merchant commission. Example at 150 transactions, $2.75 fee, $0.75 merchant split, $0.15 interchange: net $2.15 per transaction = $322.50/month. Expenses: receipt paper ($50/case), fuel, wireless ($10-$20/month if needed), vault cash interest if borrowed.",

  // Capital Requirements
  "GUIDE: ATM Capital Requirements. Average withdrawal amount nationwide: $70. At 100-150 monthly transactions per machine, expect to need $7,000-$10,000 in vault cash per machine per month. Plan for $2,000-$3,000 per machine per week for vault cash loading. Third-party vaulting costs: cash loan at prime+3-4 points, $25 insurance per location, $0.03-$0.05 per transaction cash management fee, $65-$85 per armored truck visit.",

  // Deployment Strategies
  "GUIDE: ATM Deployment Strategies. Full Service: you own the ATM, vault the cash, handle maintenance. You set the surcharge and pay merchant a split. Most common model. Processing Only: merchant owns the ATM, you set it up and earn interchange only ($0.00-$0.25 per transaction). Service + Processing: merchant owns machine, you provide service agreement for a fee ($0.05-$0.30 per transaction) plus interchange. Full service gives best margins but requires most capital.",

  // Growth Strategies
  "GUIDE: ATM Growth Strategies. High margin lower volume accounts: independently owned smaller hotels (Comfort Inn, Best Western, Super 8) where you set $3-$4 fee and pay no commission. Even at 50 transactions/month at $4 net = $200/month with low vault cash needs. Mobile events: farmers markets, fairs, sporting events, music events — charge $3-$4 fees, can do 100+ transactions per day at larger events. EMV upgrades: target locations with non-compliant machines as replacement opportunities.",

  // Contracts
  "GUIDE: ATM Contracts. Key terms to include: contract length (prefer 3 years with auto-renew), statement of ATM ownership (protects you if merchant sells or closes), payout schedule (percentage or flat rate to merchant). If merchant resists signing, get the machine installed first and approach contract after first payment. Auto-renew clauses vary by state — consult attorney. Contracts become critical when you go to sell the portfolio — buyers want to see them.",

  // Banking
  "GUIDE: ATM Banking Setup. Use 2 separate bank accounts: one for vault cash, one for surcharge and interchange income. Discuss cash handling needs with your bank manager upfront — some banks are sensitive to large cash movements. Capital requirement calculation: number of machines x $2,000-$3,000 per week vault cash need.",

  // Startup Checklist
  "GUIDE: ATM Business Startup Checklist. Company: form LLC or Corp, set up PO Box, business cards, website optional. Processor: select processor, fill out application, get backend training. Banking: 2 accounts, business checks, discuss cash pickup procedures. Vault cash: arrange self-vault or 3rd party provider. ATM setup: new terminal ID, master keys/comvelopes. Tools for install: Hilti hammer drill, concrete drill bit 1/2 inch, 1/2 inch bolts, screwdrivers, socket set, crescent wrench, dolly, 6-foot ladder, laptop. Optional: CAT5 cable and crimping tools, phone handset, extension cords, SUV or pickup truck for transporting machines.",

  // Parts and Repair
  "GUIDE: ATM Parts and Repair Costs. Most new ATMs have 1-year parts warranty. Shell/exterior: replaceable separately. Electronic lock upgrade: $50. Audit lock: $300-$400. Dispenser: most expensive part, usually repaired not replaced. 1,000-note removable cassette: $50 upgrade new, $400 spare. Screen replacement: $200-$300. Main board with modem: $650-$700. Card reader EMV upgrade: $275-$400. Modem board: $125. Printer assembly: $600-$700. Keypad: $400-$500. Wireless device: $275 purchase plus $5/month, or $15-$20/month lease.",
];

export async function POST(request) {
  try {
    const { dealId, dlNumber, global: isGlobal } = await request.json();

    // Global mode: ingest into all active listed deals
    if (isGlobal) {
      const { data: deals } = await supabase.from("atm_deals").select("id, dl_number").eq("stage", "listed");
      if (!deals?.length) return Response.json({ error: "No listed deals found" }, { status: 404 });
      let totalInserted = 0;
      for (const deal of deals) {
        await supabase.from("deal_embeddings").delete().eq("deal_id", deal.id).eq("source_type", "faq");
        const rows = FAQ.map((chunk, i) => ({ deal_id: deal.id, dl_number: deal.dl_number || null, content_chunk: chunk, source_type: "faq", source_name: "atm_industry_faq", chunk_index: i }));
        await supabase.from("deal_embeddings").insert(rows);
        totalInserted += rows.length;
      }
      return Response.json({ success: true, deals: deals.length, chunks_per_deal: FAQ.length, total_inserted: totalInserted });
    }

    // Single deal mode (existing behavior)
    if (!dealId) return Response.json({ error: "dealId or global:true required" }, { status: 400 });
    await supabase.from("deal_embeddings").delete().eq("deal_id", dealId).eq("source_type", "faq");
    const rows = FAQ.map((chunk, i) => ({ deal_id: dealId, dl_number: dlNumber || null, content_chunk: chunk, source_type: "faq", source_name: "atm_industry_faq", chunk_index: i }));
    const { error } = await supabase.from("deal_embeddings").insert(rows);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true, chunks: FAQ.length });
  } catch (err) { return Response.json({ error: err.message }, { status: 500 }); }
}
