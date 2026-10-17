// Our own team's email addresses. Used to spot deal room links that were opened (and signed) by staff
// and then handed to every buyer, so the CRM doesn't credit buyers' questions to a team member.
export const TEAM_EMAIL = /@(atmbrokerage|connectatm|vendingexits|cleaningexits|atmexits|platformbrokerage)\.com$|^jasosville@gmail\.com$/i;
export const isTeamEmail = (email) => TEAM_EMAIL.test(String(email || "").trim());

// A link recorded to a team address that wasn't issued to that person from the NDA form: a shared staff link.
export const isSharedLink = (t) => isTeamEmail(t?.buyer_email) && !String(t?.source_url || "").startsWith("wpforms:");
