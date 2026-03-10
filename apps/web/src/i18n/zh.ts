export const zh = {
  nav: {
    features: "功能",
    howItWorks: "工作原理",
    security: "安全",
    download: "下载",
    github: "GitHub",
    langSwitch: "EN",
  },
  hero: {
    badge: "完全开源 · MIT 协议",
    title1: "The 11th Way",
    title2: "to Run Your AI",
    subtitle: "本地部署私有 AI 网关，手机 PC 随时安全访问，数据永不离开你的设备。",
    ctaMac: "下载 Mac",
    ctaWindows: "下载 Windows",
    ctaGithub: "GitHub →",
    screenshotAlt: "ClawNo.11 应用截图",
    screenshotHint: "在此处放置应用截图",
  },
  stats: [
    { value: "~10MB", label: "安装包大小" },
    { value: "15+", label: "AI 提供商" },
    { value: "零遥测", label: "无追踪无埋点" },
    { value: "双端", label: "桌面 + 移动" },
  ],
  features: {
    title: "一个应用，掌控你的 AI 全链路",
    subtitle: "从部署到对话，从安全到协作，ClawNo.11 覆盖私有 AI 的每一个环节。",
    items: [
      {
        icon: "Rocket",
        title: "一键部署",
        desc: "5 步自动化流水线：检测 Node.js → 安装 OpenClaw → pm2 守护 → 配置 → 启动。无需运维经验，新手也能 3 分钟上手。",
        badge: "桌面 + 移动",
      },
      {
        icon: "Shield",
        title: "Claw Guard 安全中心",
        desc: "实时安全评分、端口监控、防火墙管理、Kill Switch 紧急断网、Prompt 注入检测、Shell 权限三档管控。",
        badge: "企业级防护",
      },
      {
        icon: "Smartphone",
        title: "移动端远程连接",
        desc: "OTP 二维码 + 6 位 PIN 双重验证，2 分钟自动过期。搭配 Tailscale 或 xEdge 干将互联，任意网络安全访问家中 AI。",
        badge: "国内友好",
      },
      {
        icon: "Brain",
        title: "私有知识库 RAG",
        desc: "导入 TXT / Markdown / CSV 等文档，本地 TF-IDF 检索，AI 聊天时自动注入相关段落。全程离线，数据不出设备。",
        badge: "完全离线",
      },
      {
        icon: "GitBranch",
        title: "智能模型路由",
        desc: "按关键词自动切换 AI 实例：代码问题路由 Claude，写作任务路由 GPT-4o，翻译路由 DeepSeek。一条规则搞定。",
        badge: "自动路由",
      },
      {
        icon: "MessageSquare",
        title: "IM 连接器",
        desc: "飞书 / Lark 机器人四步接入向导，团队成员无需配置 API Key 即可使用私有 AI。Discord 机器人即将上线。",
        badge: "团队协作",
      },
    ],
  },
  howItWorks: {
    title: "四步拥有你的私有 AI",
    steps: [
      {
        num: "01",
        title: "下载安装",
        desc: "下载 ClawNo.11 桌面客户端，支持 Windows 和 macOS，安装包仅约 10MB。",
      },
      {
        num: "02",
        title: "一键部署网关",
        desc: "在部署页面点击「开始部署」，自动安装 Node.js、OpenClaw 和 pm2 守护进程。",
      },
      {
        num: "03",
        title: "手机扫码连接",
        desc: "手机安装 ClawNo.11 App，扫描桌面二维码，OTP + PIN 双重确认，安全接入。",
      },
      {
        num: "04",
        title: "安全畅聊",
        desc: "开启 PII 过滤和 RAG 知识库，与你的私有 AI 对话，数据全程留在本地。",
      },
    ],
  },
  security: {
    badge: "零信任架构",
    title: "Your AI. Your Data.",
    title2: "Your Home.",
    subtitle: "ClawNo.11 的每一行代码都在保护你的隐私和数据安全。",
    items: [
      "无遥测、无追踪、无隐藏代理",
      "API Key 本地 AES-GCM 加密存储，绝不上传",
      "发送 AI 前自动脱敏六类 PII 敏感信息",
      "Kill Switch 一键断网，随时可恢复",
      "MCP 插件安全扫描 + Shell 权限三档管控",
      "Token 异常自动告警，防 API Key 滥用",
    ],
    screenshotAlt: "Claw Guard 安全中心截图",
    screenshotHint: "在此处放置 Claw Guard 截图",
  },
  download: {
    title: "现在开始，永久免费",
    subtitle: "完全开源 · MIT 协议 · 无订阅费 · 无使用限制",
    mac: "下载 Mac (.dmg)",
    windows: "下载 Windows (.exe)",
    mobile: "iOS / Android",
    mobileSub: "即将上线",
    github: "Star on GitHub",
    githubSub: "查看源码 & 提 Issue",
    releasesLink: "https://github.com/clawno11/clawno11/releases",
    githubLink: "https://github.com/clawno11/clawno11",
  },
  footer: {
    desc: "本地优先的私有 AI 网关管理控制台。",
    links: [
      { label: "GitHub", url: "https://github.com/clawno11/clawno11" },
      { label: "隐私政策", url: "https://github.com/clawno11/clawno11/blob/main/PRIVACY.md" },
      { label: "免责声明", url: "https://github.com/clawno11/clawno11/blob/main/DISCLAIMER.md" },
      { label: "安全策略", url: "https://github.com/clawno11/clawno11/blob/main/SECURITY.md" },
    ],
    copyright: "© 2025 ClawNo.11 · MIT License",
  },
};

export type I18nDict = typeof zh;
