# Security Policy / 安全策略

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability / 报告安全漏洞

**Please do NOT open a public GitHub Issue for security vulnerabilities.**

If you discover a security vulnerability in ClawNo.11, please report it privately through one of the following channels:

1. **GitHub Security Advisories** (preferred):  
   Go to the repository → Security tab → "Report a vulnerability"

2. **Email**:  
   Send details to `security@clawno11.com` with the subject line `[SECURITY] ClawNo.11 Vulnerability Report`

### What to include

- A clear description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Any suggested mitigations (optional)

### Our commitment

- We will acknowledge receipt within **48 hours**
- We will provide a status update within **7 days**
- We will credit you in the release notes (unless you prefer to remain anonymous)
- We will NOT take legal action against researchers who report in good faith

---

## Bug Bounty / 漏洞悬赏

ClawNo.11 currently operates a **reputation-based bounty program**:

- Valid security vulnerabilities will be permanently credited in our `CONTRIBUTORS.md` Hall of Fame
- Critical vulnerabilities (RCE, data exfiltration) may receive additional recognition

---

## Security Design Principles

ClawNo.11 is built with the following security commitments:

- **No analytics, no tracking, no hidden proxy** — the tool contains zero telemetry code
- **Local-first storage** — sensitive data (API keys, configuration) is stored encrypted on the user's local device only
- **Minimal permissions** — the application requests only the permissions strictly necessary for its operation
- **Open source** — all code is publicly auditable at any time

---

## 简体中文

如果您发现 ClawNo.11 中存在安全漏洞，请**不要**在 GitHub 上公开提交 Issue，而是通过以下方式私下联系我们：

1. **GitHub Security Advisories**（推荐）：前往仓库 → Security 标签页 → "Report a vulnerability"
2. **邮件**：发送至 `security@clawno11.com`，主题为 `[SECURITY] ClawNo.11 漏洞报告`

我们承诺在 48 小时内确认收到报告，并在发布修复版本时在更新日志中永久记录您的贡献（如您希望保持匿名请注明）。
