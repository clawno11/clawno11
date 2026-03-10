import type { I18nDict } from "./zh";

export const en: I18nDict = {
  nav: {
    features: "Features",
    howItWorks: "How it Works",
    security: "Security",
    download: "Download",
    github: "GitHub",
    langSwitch: "中文",
  },
  hero: {
    badge: "Fully Open Source · MIT License",
    title: "ClawNo.11",
    tagline: "THE PRIVATE AI GATEWAY THAT NEVER LEAKS.",
    subtitle: "Deploy a private AI gateway on your own device. Access securely from phone or PC.\nYour data never leaves your machine.",
    ctaMac: "Download Mac (.dmg)",
    ctaWindows: "Download Windows (.exe)",
    ctaGithub: "GitHub →",
    announcement: "NEW  MiniMax M2 · DeepSeek V3 · GLM-4-Flash now supported →",
    screenshotAlt: "ClawNo.11 App Screenshot",
    screenshotHint: "Place app screenshot here",
  },
  stats: [
    { value: "~10MB", label: "Install size" },
    { value: "15+", label: "AI Providers" },
    { value: "Zero telemetry", label: "No tracking" },
    { value: "Dual platform", label: "Desktop + Mobile" },
  ],
  features: {
    title: "One App. Full Control of Your AI.",
    subtitle:
      "From deployment to conversation, security to collaboration — ClawNo.11 covers every aspect of private AI.",
    items: [
      {
        icon: "Rocket",
        title: "One-Click Deploy",
        desc: "5-step automated pipeline: detect Node.js → install OpenClaw → pm2 daemon → config → launch. No DevOps skills needed.",
        badge: "Desktop + Mobile",
      },
      {
        icon: "Shield",
        title: "Claw Guard Security",
        desc: "Real-time security score, port monitoring, firewall control, Kill Switch, prompt injection detection, and shell permission management.",
        badge: "Enterprise-grade",
      },
      {
        icon: "Smartphone",
        title: "Mobile Remote Access",
        desc: "OTP QR code + 6-digit PIN dual verification, 2-minute expiry. Works with Tailscale or xEdge for secure access from anywhere.",
        badge: "China-friendly",
      },
      {
        icon: "Brain",
        title: "Private RAG Knowledge Base",
        desc: "Import TXT / Markdown / CSV files. Local TF-IDF search injects relevant context before each message. Fully offline.",
        badge: "Fully Offline",
      },
      {
        icon: "GitBranch",
        title: "Smart Model Router",
        desc: "Auto-route by keyword: code questions go to Claude, writing to GPT-4o, translation to DeepSeek. One rule does it all.",
        badge: "Auto Routing",
      },
      {
        icon: "MessageSquare",
        title: "IM Connectors",
        desc: "4-step Feishu / Lark bot setup wizard. Team members use your private AI without individual API key configuration.",
        badge: "Team Collaboration",
      },
    ],
  },
  howItWorks: {
    title: "Four Steps to Your Private AI",
    steps: [
      {
        num: "01",
        title: "Download & Install",
        desc: "Download the ClawNo.11 desktop client for Windows or macOS. The installer is only ~10MB.",
      },
      {
        num: "02",
        title: "Deploy the Gateway",
        desc: "Click Deploy in the app. It automatically installs Node.js, OpenClaw, and a pm2 process guardian.",
      },
      {
        num: "03",
        title: "Scan & Connect on Mobile",
        desc: "Install the ClawNo.11 mobile app, scan the desktop QR code, and confirm with OTP + PIN for secure pairing.",
      },
      {
        num: "04",
        title: "Chat Securely",
        desc: "Enable PII filtering and your RAG knowledge base. Chat with your private AI — data never leaves your device.",
      },
    ],
  },
  security: {
    badge: "Zero-Trust Architecture",
    title: "Your AI. Your Data.",
    title2: "Your Home.",
    subtitle: "Every line of ClawNo.11 code is written to protect your privacy and data security.",
    items: [
      "No telemetry, no tracking, no hidden proxies",
      "API Keys stored locally with AES-GCM encryption — never uploaded",
      "Six categories of PII auto-redacted before sending to AI",
      "Kill Switch cuts all outbound access instantly — fully recoverable",
      "MCP plugin security scanner + 3-tier shell permission control",
      "Token anomaly alerts to prevent API key abuse",
    ],
    screenshotAlt: "Claw Guard Security Center Screenshot",
    screenshotHint: "Place Claw Guard screenshot here",
  },
  download: {
    title: "Start Now, Forever Free",
    subtitle: "Fully open source · MIT License · No subscription · No usage limits",
    mac: "Download Mac (.dmg)",
    windows: "Download Windows (.exe)",
    mobile: "iOS / Android",
    mobileSub: "Coming soon",
    github: "Star on GitHub",
    githubSub: "View source & open issues",
    releasesLink: "https://github.com/clawno11/clawno11/releases",
    githubLink: "https://github.com/clawno11/clawno11",
  },
  footer: {
    desc: "Local-first private AI gateway management console.",
    links: [
      { label: "GitHub", url: "https://github.com/clawno11/clawno11" },
      { label: "Privacy Policy", url: "https://github.com/clawno11/clawno11/blob/main/PRIVACY.md" },
      { label: "Disclaimer", url: "https://github.com/clawno11/clawno11/blob/main/DISCLAIMER.md" },
      { label: "Security Policy", url: "https://github.com/clawno11/clawno11/blob/main/SECURITY.md" },
    ],
    copyright: "© 2025 ClawNo.11 · MIT License",
  },
};
