# Privacy Policy / 隐私政策

> **Hosted URL (required for app stores):** https://clawno11.ai/privacy  
> **Effective date / 生效日期:** 2026-03-08  
> **App / 应用:** ClawNo.11 (Desktop & Mobile)  
> **Developer / 开发者:** Clawno Team — hello@clawno11.com

---

## English Version

### 1. Summary (TL;DR)

ClawNo.11 **collects no personal data**. Everything stays on your device.  
We have no servers that receive your data. We have no analytics, no tracking, no ads.

### 2. What Data We Collect

| Category | Collected? | Details |
|----------|-----------|---------|
| Personal identity (name, email, phone) | ❌ No | Never requested or stored |
| Location data | ❌ No | Not accessed |
| Usage analytics / telemetry | ❌ No | No SDKs embedded |
| Crash reports | ❌ No | No automatic reporting |
| AI conversation content | ❌ No | Stored only locally on your device, in SQLite |
| API Keys / Secrets | ❌ No | Stored only locally in app sandbox (not uploaded) |
| Device identifiers | ❌ No | Not collected |
| Camera / Microphone | ⚠️ Optional | Microphone used only on mobile for voice input (if you tap the mic button). Never recorded in background. |
| Contacts / Calendar | ❌ No | Not accessed |

### 3. Permissions We Request

| Permission | Platform | Why |
|-----------|----------|-----|
| Internet access | Android / iOS / Desktop | Connect to your own AI gateway server |
| Storage read/write | Android / iOS / Desktop | Import RAG documents, store local SQLite database |
| Foreground network | Android | Maintain connection to AI gateway |
| Microphone | Android / iOS (mobile only) | Voice input — only when you tap the mic button |

We request **only the minimum permissions** necessary. No permission is used for advertising or analytics.

### 4. Data Stored Locally

The following data is stored **only on your device**, never uploaded:

- Chat message history (SQLite, app data directory)
- AI provider configuration and API keys (app secure storage sandbox)
- RAG document chunks (SQLite)
- Token usage logs (SQLite)
- MCP server configurations (SQLite)
- Security event logs (SQLite)

You can delete all local data at any time via **Settings → Storage → Wipe All Data**.

### 5. Third-Party Services

ClawNo.11 itself does not communicate with any third-party servers.  
However, when you use the app, you may connect to:

| Service | When | Their Privacy Policy |
|---------|------|---------------------|
| Your own AI gateway (OpenClaw) | During chat | Self-hosted, your control |
| AI model providers (Zhipu AI, OpenRouter, etc.) | Via your gateway | Each provider's own policy |

The app contains **no referral links, no affiliate redirects, and no external tracking services**.

### 6. Children's Privacy

ClawNo.11 is not directed at children under 13 (or under 16 in the EU).  
We do not knowingly collect any information from children.

### 7. GDPR / CCPA

Since we collect no personal data, the majority of GDPR and CCPA obligations do not apply.  
EU and California residents have no data to request, correct, or delete — because we have none.

If you believe we inadvertently hold your personal data, contact us at **privacy@clawno11.com**.

### 8. Security

All local data is stored in the app's sandboxed directory.  
API keys use the device's secure storage mechanisms where available.  
We use no cloud sync. Your data never leaves your device unless you explicitly initiate a connection.

### 9. Changes to This Policy

We will update this policy if our data practices change.  
The "Effective date" at the top will be updated accordingly.  
For significant changes, we will post a notice in the app's release notes.

### 10. Contact

Privacy concerns: **privacy@clawno11.com**  
General: **hello@clawno11.com**  
Security vulnerabilities: See [SECURITY.md](./SECURITY.md)

---

## 简体中文版

### 1. 简要说明

ClawNo.11 **不收集任何个人数据**。所有数据仅存储在您的本地设备上。  
我们没有接收您数据的服务器，没有分析统计，没有追踪，没有广告。

### 2. 我们收集的数据

| 数据类别 | 是否收集 | 说明 |
|----------|---------|------|
| 个人身份信息（姓名、邮箱、电话） | ❌ 否 | 从不请求或存储 |
| 位置数据 | ❌ 否 | 不访问 |
| 使用分析/遥测数据 | ❌ 否 | 未嵌入任何统计 SDK |
| 崩溃报告 | ❌ 否 | 无自动上报 |
| AI 对话内容 | ❌ 否 | 仅本地存储于您的设备（SQLite） |
| API 密钥/Secret | ❌ 否 | 仅本地存储于应用沙箱（不上传） |
| 设备标识符 | ❌ 否 | 不收集 |
| 摄像头/麦克风 | ⚠️ 可选 | 麦克风仅在移动端用于语音输入（点击麦克风按钮时）。不会后台录音。 |
| 通讯录/日历 | ❌ 否 | 不访问 |

### 3. 我们申请的权限

| 权限 | 平台 | 用途 |
|------|------|------|
| 网络访问 | Android / iOS / 桌面端 | 连接您自己的 AI 网关服务器 |
| 存储读写 | Android / iOS / 桌面端 | 导入 RAG 文档，存储本地 SQLite 数据库 |
| 前台网络保持 | Android | 维持与 AI 网关的连接 |
| 麦克风 | Android / iOS（仅移动端） | 语音输入 — 仅在您点击麦克风按钮时使用 |

我们仅申请**最小必要权限**，所有权限均不用于广告或用户分析。

### 4. 本地存储的数据

以下数据**仅存储于您的本地设备**，不会上传至任何服务器：

- 聊天消息历史（SQLite，应用数据目录）
- AI 提供商配置及 API 密钥（应用安全存储沙箱）
- RAG 文档分块（SQLite）
- Token 用量日志（SQLite）
- MCP 服务器配置（SQLite）
- 安全事件日志（SQLite）

您可以随时通过 **设置 → 存储管理 → 清除所有数据** 删除全部本地数据。

### 5. 第三方服务

ClawNo.11 本身不与任何第三方服务器通信。  
但当您使用本应用时，您可能会连接到：

| 服务 | 触发时机 | 其隐私政策 |
|------|----------|-----------|
| 您自己的 AI 网关（OpenClaw） | 聊天时 | 自托管，由您控制 |
| AI 模型提供商（智谱 AI、OpenRouter 等） | 通过您的网关 | 各提供商自身政策 |

本应用**不含任何推广链接、推广跳转或外部追踪服务**。

### 6. 儿童隐私

ClawNo.11 不面向 13 岁以下（欧盟地区为 16 岁以下）的儿童。  
我们不会故意收集儿童的任何信息。

### 7. 数据保护法规（GDPR / 个人信息保护法）

由于我们不收集任何个人数据，GDPR 及中国《个人信息保护法》的大部分义务不适用。  
欧盟用户、中国用户无需担心数据请求、更正或删除——因为我们没有您的数据。

如果您认为我们意外持有了您的个人数据，请联系 **privacy@clawno11.com**。

### 8. 数据安全

所有本地数据存储于应用沙箱目录，受操作系统隔离保护。  
API 密钥在条件允许时使用设备的安全存储机制。  
我们不使用云同步。除非您主动发起连接，否则您的数据不会离开您的设备。

### 9. 隐私政策的变更

如果我们的数据处理方式发生变化，我们将更新本政策。  
顶部的"生效日期"将相应更新。  
对于重大变更，我们将在应用的版本更新说明中发布通知。

### 10. 联系我们

隐私问题：**privacy@clawno11.com**  
一般咨询：**hello@clawno11.com**  
安全漏洞：请参阅 [SECURITY.md](./SECURITY.md)
