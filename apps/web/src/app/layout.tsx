import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/i18n/context";

export const metadata: Metadata = {
  title: "ClawNo.11 — Private AI Gateway Console",
  description:
    "Deploy a private AI gateway on your own device. Access securely from phone or PC. Your data never leaves your machine. Fully open-source · Apache 2.0.",
  keywords: ["AI", "private", "gateway", "OpenClaw", "ClawNo11", "deploy", "self-hosted", "iOS", "Android", "desktop"],
  authors: [{ name: "ClawNo.11 Team" }],
  openGraph: {
    title: "ClawNo.11 — The 11th Way to Run Your AI",
    description:
      "Deploy a private AI gateway on your own device. Access securely from phone or PC. Data never leaves your machine.",
    url: "https://clawno11.ai",
    siteName: "ClawNo.11",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClawNo.11 — The 11th Way to Run Your AI",
    description: "Private AI gateway. One-click deploy. Zero telemetry. iOS + Android + Desktop.",
  },
  icons: { icon: "/favicon.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-bg-base text-slate-200 antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
