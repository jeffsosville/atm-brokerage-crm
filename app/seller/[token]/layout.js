export const metadata = {
  title: "Your listing file",
  description: "Answer the questions buyers ask before they make an offer.",
  robots: { index: false, follow: false },
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function SellerLayout({ children }) {
  return children;
}
