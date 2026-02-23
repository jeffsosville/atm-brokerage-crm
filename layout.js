export const metadata = {
  title: "ATM Brokerage CRM",
  description: "Lead management for ATM Brokerage",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, padding: 0, background: "#0a0e17" }}>
        {children}
      </body>
    </html>
  );
}
