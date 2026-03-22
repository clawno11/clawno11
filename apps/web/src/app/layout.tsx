import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/i18n/context";

export const metadata: Metadata = {
  title: "ClawNo.11 — OpenClaw Control Center",
  description:
    "Deploy your OpenClaw AI gateway in 3 minutes. Manage securely from desktop and mobile. Your keys, your data — always under your control. Open-source · Apache 2.0.",
  keywords: ["AI", "private", "gateway", "OpenClaw", "ClawNo11", "deploy", "self-hosted", "control center", "iOS", "Android", "desktop"],
  authors: [{ name: "ClawNo.11 Team" }],
  openGraph: {
    title: "ClawNo.11 — OpenClaw, Made Simple",
    description:
      "Deploy your OpenClaw AI gateway in 3 minutes. Connect securely from any device. Your keys, your data — always under your control.",
    url: "https://clawno11.ai",
    siteName: "ClawNo.11",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClawNo.11 — OpenClaw, Made Simple",
    description: "Deploy OpenClaw in 3 minutes. Manage from desktop & mobile. Zero telemetry. Open source.",
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
