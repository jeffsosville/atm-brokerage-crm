// Buyer-facing brand for a deal. atm_deals.deal_type is null/'atm' for ATM, otherwise the vertical slug.
export const BRANDS = {
  atm: {
    firm: "ATM Brokerage", noun: "ATM route", industry: "ATM", email: "info@atmbrokerage.com",
    site: "https://atmbrokerage.com", tagline: "200+ deals since 2012", accent: "#3b82f6",
  },
  vending: {
    firm: "VendingExits", noun: "vending route", industry: "vending", email: "sales@vendingexits.com",
    site: "https://vendingexits.com", tagline: "Vending routes and machine businesses", accent: "#d97706",
  },
  cleaning: {
    firm: "CleaningExits", noun: "cleaning business", industry: "cleaning and residential/commercial service",
    email: "hello@cleaningexits.com", site: "https://cleaningexits.com", tagline: "Cleaning and service businesses", accent: "#059669",
  },
};
export const PHONE = "+1 888-430-5535";
export const brandSlug = (deal) => String(deal?.deal_type || "atm").toLowerCase();
export const brandFor = (deal) => BRANDS[brandSlug(deal)] || BRANDS.atm;
