const BRANDS = {
  atm: {
    firm: "ATM Brokerage",
    site: "atmbrokerage.com",
    email: "john@atmbrokerage.com",
    tagline: "200+ deals since 2012"
  },
  vending: {
    firm: "VendingExits",
    site: "vendingexits.com",
    email: "sales@vendingexits.com",
    tagline: "Vending routes and machine businesses"
  },
  cleaning: {
    firm: "CleaningExits",
    site: "cleaningexits.com",
    email: "hello@cleaningexits.com",
    tagline: "Cleaning and service businesses"
  }
};
function brandFor(vertical) {
  return BRANDS[(vertical || "atm").toLowerCase()] ?? BRANDS.atm;
}
function buildFollowupDay1(args) {
  const firstName = (args.buyer_name || "").split(" ")[0] || "there";
  return {
    subject: `Following up on the ${args.listing_title}`,
    html: emailShell(`
      <p>Hi ${escape(firstName)},</p>

      <p>Saw you opened the data room for the <strong>${escape(args.listing_title)}</strong> yesterday \u2014 wanted to check in and ensure our process is working for you! Here are the next steps.</p>

      <ol style="margin: 0 0 16px 0; padding-left: 22px;">
        <li style="margin-bottom: 10px;"><strong>Ask questions anytime.</strong> Each Deal Room has an AI agent trained by the seller on that specific route. If the Agent can't answer your questions, it will alert our team and the seller. (We will update the Q&amp;A with your answers.)</li>

        <li style="margin-bottom: 10px;"><strong>Make an offer.</strong> An example LOI is inside the Deal Room. Send your offer when ready and we'll bring it to the seller.</li>

        <li style="margin-bottom: 10px;"><strong>Speak with a live person.</strong> If you need to talk to us directly, just let us know and we'll coordinate a call.</li>
      </ol>

      <p style="margin: 24px 0;">
        <a href="${args.deal_hub_url}" style="background: #1a1612; color: #fbf8f0; padding: 12px 20px; text-decoration: none; border-radius: 2px; font-weight: 500; display: inline-block;">Open the Data Room</a>
      </p>

      <p>Talk soon,<br>
      \u2014 John</p>

      ${signatureBlock(args.unsubscribe_url, args.vertical)}
    `),
    text: `Hi ${firstName},

Saw you opened the data room for the ${args.listing_title} yesterday \u2014 wanted to check in and ensure our process is working for you! Here are the next steps.

1. Ask questions anytime. Each Deal Room has an AI agent trained by the seller on that specific route. If the Agent can't answer your questions, it will alert our team and the seller. (We will update the Q&A with your answers.)

2. Make an offer. An example LOI is inside the Deal Room. Send your offer when ready and we'll bring it to the seller.

3. Speak with a live person. If you need to talk to us directly, just let us know and we'll coordinate a call.

Open the data room: ${args.deal_hub_url}

Talk soon,
\u2014 John

John Sosville | ${brandFor(args.vertical).firm} | 888-430-5535 | ${brandFor(args.vertical).email}

Unsubscribe: ${args.unsubscribe_url}
`
  };
}
const DILIGENCE_POINTS = {
  atm: [
    { title: "Acquisition Partnership", body: "Do you align well with the seller? That is a critical point that people underestimate." },
    { title: "Contract terms", body: "Most ATMs are placed on 3-5 year agreements. The question is what happens with risk of not having them? An earn-out can be a great way to limit your risk in an ATM transaction." },
    { title: "Surcharge history vs. surcharge ceiling", body: "If a location is at $3.00 and the market is $3.50, is that a margin opportunity? It all depends on the local competition so make sure you know before you assume!" },
    { title: "Vault cash structure", body: "Are you bringing the cash or is a 3rd party? Big swing on capital required. Many of our routes have 3rd party vaulters available." },
    { title: "The seller's reason for selling", body: "The most important question. Retirement, health, relocation - all fine. Get to know your seller." }
  ],
  vending: [
    { title: "Acquisition Partnership", body: "Do you align well with the seller? That is a critical point that people underestimate." },
    { title: "Location agreements", body: "Are the placements on paper or on a handshake? A handshake route can still be a good route, but you are buying the relationship, not the contract. Know which one you are getting." },
    { title: "Product margin and mix", body: "Cost of goods is the whole game in vending. Ask what the machines actually sell and what the seller pays for it. A route with card readers can prove this from processor data." },
    { title: "Machine age and condition", body: "Newer equipment means no deferred maintenance to inherit. Older machines can still be fine, but budget for the replacements you will be making in year one." },
    { title: "The seller's reason for selling", body: "The most important question. Retirement, health, relocation - all fine. Get to know your seller." }
  ],
  cleaning: [
    { title: "Acquisition Partnership", body: "Do you align well with the seller? That is a critical point that people underestimate." },
    { title: "Contract terms and client concentration", body: "How much of revenue sits with the largest account? Recurring contracts are the asset here, so understand what is under contract and what renews on goodwill." },
    { title: "The crew", body: "Will the staff stay through a change of ownership? In a service business the team is most of what you are buying." },
    { title: "Margin per account", body: "Revenue is easy to grow in cleaning and margin is not. Look at what each account nets after labor before you value the top line." },
    { title: "The seller's reason for selling", body: "The most important question. Retirement, health, relocation - all fine. Get to know your seller." }
  ]
};
const DAY2_SUBJECT = {
  atm: "What separates a great ATM route from a bad one",
  vending: "What separates a great vending route from a bad one",
  cleaning: "What separates a great cleaning business from a bad one"
};
const DAY2_INTRO = {
  atm: "After 200+ closed ATM deals since 2012, here's what I tell every buyer to look at first:",
  vending: "Here's what I tell every buyer to look at first on a route deal:",
  cleaning: "Here's what I tell every buyer to look at first on a service business:"
};
function buildFollowupDay2(args) {
  const firstName = (args.buyer_name || "").split(" ")[0] || "there";
  const key = (args.vertical || "atm").toLowerCase();
  const points = DILIGENCE_POINTS[key] ?? DILIGENCE_POINTS.atm;
  const subject = DAY2_SUBJECT[key] ?? DAY2_SUBJECT.atm;
  const intro = DAY2_INTRO[key] ?? DAY2_INTRO.atm;
  const b = brandFor(args.vertical);
  const htmlPoints = points.map(
    (pt) => `        <li style="margin-bottom: 10px;"><strong>${escape(pt.title)}.</strong> ${escape(pt.body)}</li>`
  ).join("\n");
  const textPoints = points.map((pt, i) => `${i + 1}. ${pt.title}. ${pt.body}`).join("\n\n");
  return {
    subject,
    html: emailShell(`
      <p>Hi ${escape(firstName)},</p>

      <p>Quick follow up on the <strong>${escape(args.listing_title)}</strong>.</p>

      <p>${escape(intro)}</p>

      <ol style="margin: 0 0 16px 0; padding-left: 22px;">
${htmlPoints}
      </ol>

      <p>If you're not getting the answers you need regarding the ${escape(args.listing_title)} just reply and we'll coordinate a call.</p>

      <p style="margin: 24px 0;">
        <a href="${args.deal_hub_url}" style="background: #1a1612; color: #fbf8f0; padding: 12px 20px; text-decoration: none; border-radius: 2px; font-weight: 500; display: inline-block;">Back to the Data Room</a>
      </p>

      <p>&mdash; John</p>

      ${signatureBlock(args.unsubscribe_url, args.vertical)}
    `),
    text: `Hi ${firstName},

Quick follow up on the ${args.listing_title}.

${intro}

${textPoints}

If you're not getting the answers you need regarding the ${args.listing_title} just reply and we'll coordinate a call.

Back to the data room: ${args.deal_hub_url}

- John

John Sosville | ${b.firm} | 888-430-5535 | ${b.email}

Unsubscribe: ${args.unsubscribe_url}
`
  };
}
function buildFollowupDay3(args) {
  const firstName = (args.buyer_name || "").split(" ")[0] || "there";
  return {
    subject: `Worth a 15-minute call on the ${args.listing_title}?`,
    html: emailShell(`
      <p>Hi ${escape(firstName)},</p>

      <p>Last note from me on the <strong>${escape(args.listing_title)}</strong>.</p>

      <p>If this route fits what you're looking for we are happy to coordinate a 15-minute call. We can walk you through:</p>

      <ul style="margin: 0 0 16px 0; padding-left: 20px;">
        <li style="margin-bottom: 8px;">Specifics about the seller and how they can support the transition and early operations</li>
        <li style="margin-bottom: 8px;">How the financials would play out when you were operating the business</li>
        <li style="margin-bottom: 8px;">Feedback on your potential LOI: realistic price and terms based on the seller</li>
      </ul>

      <p>If you want to talk, just reply with a couple times that work and I'll send a calendar invite. If you've moved on, no worries at all \u2014 I'll keep you on the list for new listings.</p>

      <p style="margin: 24px 0;">
        <a href="${args.deal_hub_url}" style="background: #1a1612; color: #fbf8f0; padding: 12px 20px; text-decoration: none; border-radius: 2px; font-weight: 500; display: inline-block;">Open the Data Room</a>
      </p>

      <p>\u2014 John<br>
      <span style="color: #4a443b;">${brandFor(args.vertical).email} \xB7 888-430-5535</span></p>

      ${signatureBlock(args.unsubscribe_url, args.vertical)}
    `),
    text: `Hi ${firstName},

Last note from me on the ${args.listing_title}.

If this route fits what you're looking for we are happy to coordinate a 15-minute call. We can walk you through:

- Specifics about the seller and how they can support the transition and early operations
- How the financials would play out when you were operating the business
- Feedback on your potential LOI: realistic price and terms based on the seller

If you want to talk, just reply with a couple times that work and I'll send a calendar invite. If you've moved on, no worries at all \u2014 I'll keep you on the list for new listings.

Data room: ${args.deal_hub_url}

\u2014 John
${brandFor(args.vertical).email} \xB7 888-430-5535

Unsubscribe: ${args.unsubscribe_url}
`
  };
}
function emailShell(innerHtml) {
  return `<!DOCTYPE html>
<html>
<body style="font-family: Arial, Helvetica, sans-serif; color: #1a1612; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 24px;">
${innerHtml}
</body>
</html>`;
}
function signatureBlock(unsubscribeUrl, vertical) {
  const b = brandFor(vertical);
  return `<p style="font-size: 12px; color: #8a8275; margin-top: 32px; border-top: 1px solid #d9d1bc; padding-top: 16px;">
    John Sosville \xB7 ${b.firm} \xB7 ${b.tagline}<br>
    <a href="https://${b.site}" style="color: #8a8275;">${b.site}</a> \xB7 <a href="mailto:${b.email}" style="color: #8a8275;">${b.email}</a> \xB7 888-430-5535
  </p>
  <p style="font-size: 11px; color: #b5ad9a; margin-top: 12px;">
    Don't want these updates? <a href="${unsubscribeUrl}" style="color: #b5ad9a;">Unsubscribe</a>
  </p>`;
}
function escape(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export {
  buildFollowupDay1,
  buildFollowupDay2,
  buildFollowupDay3
};
