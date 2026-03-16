import i18n from "../../i18n";

// ---------------------------------------------------------------------------
// Translate backend English keys to Chinese
// ---------------------------------------------------------------------------

/** Prettify raw backend key for English display when no mapping exists */
function prettifyKey(raw: string): string {
  return raw
    .replace(/[-_:]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function translateDetail(raw: string): string {
  if (!raw) return raw;
  const isEn = i18n.language === "en";

  const exactMap: Record<string, string> = {
    "config-initialized": "配置初始化完成",
    "config-initialized-alt-dir": "配置已初始化（备用目录）",
    "config-reset-and-initialized": "配置已重置并重新初始化",
    "config-skipped-using-defaults": "跳过配置，使用默认值",
    "installed-user-prefix": "已安装到用户目录",
    "node-installed-restart-required": "Node.js 已安装，请重启应用后重试",
    "remote-deploy-not-implemented": "服务器部署功能开发中，请先使用本机部署",
  };
  if (isEn) {
    if (exactMap[raw]) return prettifyKey(raw);
  } else {
    if (exactMap[raw]) return exactMap[raw];
  }

  const prefixMap: [string, (v: string) => string][] = [
    ["already-installed:", (v) => `已安装 ${v}`],
    ["installed:", (v) => `已安装 ${v}`],
    ["installed via npmmirror", () => "通过 npmmirror 安装成功"],
    ["installed after cache clean", () => "清理缓存后安装成功"],
    ["installed after ssl fix", () => "修复 SSL 后安装成功"],
    ["installed to user prefix", () => "已安装到用户目录"],
    ["found-node-at:", (v) => `在 ${v} 找到 Node.js`],
    ["nvm-upgrade:", (v) => `已通过 nvm 升级（旧版本 ${v}）`],
    ["fnm-upgrade:", (v) => `已通过 fnm 升级（旧版本 ${v}）`],
    ["winget-install-node-lts", () => "已通过 winget 安装 Node.js LTS"],
    ["gateway-ready:", (v) => {
      const parts = v.split(":");
      return parts[1]
        ? `Gateway :${parts[0]} 就绪，控制台 http://localhost:${parts[1]}`
        : `Gateway 端口 ${parts[0]} 已启动`;
    }],
    ["gateway-crash:", (v) => `Gateway 崩溃：${v}`],
    ["gateway-timeout:", (v) => `Gateway 超时：${v}`],
    ["npm-root-not-found:", () => "找不到 npm 全局路径，请重启应用后重试"],
    ["openclaw-mjs-not-found:", (v) => `找不到 openclaw 主文件：${v}`],
    ["wrapper-write-failed:", () => "无法写入启动脚本（磁盘权限问题）"],
    ["pm2-start-failed:", () => "pm2 启动失败，请尝试以管理员身份运行"],
    ["network-failed:", (v) => `网络错误：${v}`],
    ["cache-clean-failed:", (v) => `清缓存后仍失败：${v}`],
    ["ssl-fix-failed:", (v) => `SSL 修复失败：${v}`],
    ["disk-full:", (v) => `磁盘空间不足：${v}`],
    ["disk-low:", (v) => `磁盘空间不足：${v}`],
    ["install-failed:", (v) => `安装失败：${v}`],
    ["user-prefix-failed:", (v) => `用户目录安装失败：${v}`],
    ["config-reset-failed:", (v) => `配置重置失败：${v}`],
    ["winget-failed:", (v) => `winget 安装失败：${v}`],
    ["node-not-found:", (v) => `未找到 Node.js${v ? "：" + v : "，请从 https://nodejs.org 手动安装 v18+"}`],
    ["installed-but-not-found:", () => "已安装但未找到命令，请重启应用后重试"],
    ["alt-config-dir:", (v) => `使用备用配置目录：${v}`],
    ["api-key-configured", () => "AI 模型 API Key 已配置"],
    ["api-key-configured-and-verified", () => "AI 模型 API Key 已配置并验证通过"],
    ["key-written-but-not-recognized:", (v) => `Key 已写入但 OpenClaw 未识别：${v}`],
    ["provider-or-key-empty", () => "提供商或 API Key 不能为空"],
    ["paste-token-failed:", (v) => `API Key 写入失败：${v}`],
    ["configured-provider:", (v) => `已配置 ${v}`],
    ["ssh-connected:", (v) => `SSH 连接成功：${v}`],
    ["ssh-connect-failed:", (v) => `SSH 连接失败：${v}`],
    ["ssh-auth-failed", () => "SSH 认证失败，请检查用户名和密码/私钥"],
    ["ssh-key-parse-failed:", (v) => `私钥解析失败：${v}`],
    ["ssh-exit-", (v) => { const [code, ...rest] = v.split(":"); return `命令退出码 ${code}：${rest.join(":")}`; }],
    ["gateway-start-failed", (v) => `Gateway 启动失败：${v}`],
    ["openclaw-not-found-after-install", () => "OpenClaw 安装后未找到命令，请检查 PATH 配置"],
    ["install-openclaw-failed:", (v) => `OpenClaw 安装失败：${v}`],
    ["npm-not-available:", () => "npm 不可用，无法安装依赖。请重装 Node.js（https://nodejs.org）"],
    ["node-installed-but-npm-missing:", () => "Node.js 已安装但 npm 缺失，自动修复失败。请重装 Node.js"],
    ["git-not-installed:", () => "未安装 Git，OpenClaw 依赖 Git。请从 https://git-scm.com 安装"],
    ["git-install-failed:", (v) => v ? `Git 安装失败：${v}。请手动安装：https://git-scm.com/download/win` : "Git 自动安装失败，请手动安装 Git"],
  ];

  for (const [prefix, fn] of prefixMap) {
    if (raw.startsWith(prefix)) return fn(raw.slice(prefix.length));
    if (raw.includes(prefix)) return fn(raw.split(prefix)[1] ?? "");
  }

  if (/^v?\d+\.\d+/.test(raw)) return raw;

  return raw;
}

export function translateFix(fix: string): string {
  const isEn = i18n.language === "en";
  if (isEn) return prettifyKey(fix);

  const exactMap: Record<string, string> = {
    "switch-npmmirror": "切换 npmmirror 镜像",
    "clean-npm-cache": "清理 npm 缓存",
    "disable-ssl-temporarily": "临时关闭 SSL 验证",
    "rebuild-pm2-home": "重建 pm2 主目录",
    "delete-stale-pm2-process": "清除旧 pm2 进程",
    "restart-pm2-daemon-and-retry": "重启 pm2 守护进程",
    "restart-pm2-daemon": "重启 pm2 守护进程",
    "wrapper-fallback-to-temp": "启动脚本写入 TEMP 目录",
    "onboard-skipped-non-fatal": "跳过初始化（使用默认配置）",
    "reset-corrupt-config": "重置损坏的配置文件",
    "winget-install-node-lts": "通过 winget 安装 Node.js LTS",
    "npm-missing-attempting-repair": "npm 缺失，正在尝试自动修复",
    "corepack-enable-ok": "通过 corepack 启用 npm",
    "npm-found-after-path-refresh": "刷新 PATH 后找到 npm",
    "winget-reinstall-node": "通过 winget 重装 Node.js（含 npm）",
    "choco-reinstall-node": "通过 choco 重装 Node.js（含 npm）",
    "brew-reinstall-node": "通过 brew 重装 Node.js（含 npm）",
    "apt-install-npm": "通过 apt 安装 npm",
    "dnf-install-npm": "通过 dnf 安装 npm",
    "pacman-install-npm": "通过 pacman 安装 npm",
    "npm-repair-exhausted": "npm 自动修复方案已用尽",
    "winget-install-git": "通过 winget 安装 Git",
    "attempted-winget-git": "尝试通过 winget 安装 Git",
    "git-missing-preflight": "缺少 Git，请先安装",
  };
  if (exactMap[fix]) return exactMap[fix];

  if (fix.startsWith("found-node-at:")) return `发现 Node.js：${fix.slice(14)}`;
  if (fix.startsWith("nvm-upgrade:")) return `nvm 升级 Node.js（原 ${fix.slice(12)}）`;
  if (fix.startsWith("fnm-upgrade:")) return `fnm 升级 Node.js（原 ${fix.slice(12)}）`;
  if (fix.startsWith("user-prefix-install:")) return `安装到用户目录：${fix.slice(20)}`;
  if (fix.startsWith("kill-port-occupant:")) return `释放端口 ${fix.slice(19)}`;
  if (fix.startsWith("backup-corrupt-config:")) return `备份损坏配置：${fix.slice(22)}`;
  if (fix.startsWith("alt-config-dir:")) return `使用备用配置目录：${fix.slice(15)}`;
  if (fix.startsWith("auth-written:")) return `已写入 ${fix.slice(13)} API Key`;
  if (fix.startsWith("provider-mapped:")) return `Provider 映射：${fix.slice(16)}`;
  if (fix.startsWith("model-set:")) {
    const m = fix.slice(10);
    if (m.startsWith("openrouter/")) return `已设置默认模型：${m}（通过 OpenRouter 路由）`;
    return `已设置默认模型：${m}`;
  }
  if (fix.startsWith("model-set-skipped:")) return `模型设置跳过（${fix.slice(18).slice(0, 40)}）`;

  return fix;
}
