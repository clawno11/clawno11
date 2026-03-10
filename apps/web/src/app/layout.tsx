import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/i18n/context";

export const metadata: Metadata = {
  title: "ClawNo.11 — 私有 AI 网关管理控制台",
  description:
    "一键部署 OpenClaw 私有 AI 网关，手机 PC 随时安全访问，数据永不离开你的设备。完全开源 · MIT 协议。",
  keywords: ["AI", "private", "gateway", "OpenClaw", "ClawNo11", "deploy", "self-hosted"],
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
    description: "Private AI gateway. One-click deploy. Zero telemetry.",
  },
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
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
