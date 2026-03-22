# ClawNo.11 User Guide / 用户使用指南

> **The 11th Way to Run Your AI** — Local AI Gateway Management Console
>
> **第 11 种运行 AI 的方式** — 本地 AI 网关管理控制台

---

## Table of Contents / 目录

1. [Quick Start / 快速开始](#1-quick-start--快速开始)
2. [Instances / 实例管理](#2-instances--实例管理)
3. [Deploy / 部署](#3-deploy--部署)
4. [Chat / 聊天](#4-chat--聊天)
5. [Mobile App / 移动端](#5-mobile-app--移动端)
6. [Connectors / 连接方式](#6-connectors--连接方式)
7. [Security / 安全中心](#7-security--安全中心)
8. [Tokens / 用量监控](#8-tokens--用量监控)
9. [Knowledge Base (RAG) / 知识库](#9-knowledge-base-rag--知识库)
10. [Plugins (MCP) / 插件](#10-plugins-mcp--插件)
11. [Router / 智能路由](#11-router--智能路由)
12. [Local Models / 本地模型](#12-local-models--本地模型)
13. [Remote Sessions / 远程会话](#13-remote-sessions--远程会话)
14. [Settings / 设置](#14-settings--设置)
15. [Port Reference / 端口一览](#15-port-reference--端口一览)
16. [FAQ / 常见问题](#16-faq--常见问题)

---

## 1. Quick Start / 快速开始

### English

1. **Download & Install** — Get the installer for your platform:
   - Windows: `.msi` or `.exe`
   - macOS: `.dmg`
   - iOS: TestFlight / App Store
   - Android: `.apk`

2. **First Launch** — Open ClawNo.11. You will see the **Instances** page (empty).

3. **Deploy OpenClaw** — Click the **Deploy** tab in the sidebar. Choose **Local Deploy** for one-click setup on your computer. The app will automatically install Node.js (if needed), OpenClaw, and pm2.

4. **Start Chatting** — Once the instance shows **Online** (green), go to the **Chat** tab and start talking to your AI.

5. **Connect Mobile** — Go to the **Connectors** tab, copy an IP address, and paste it into the ClawNo.11 mobile app's Connect page.

### 中文

1. **下载安装** — 根据你的平台下载对应安装包：
   - Windows：`.msi` 或 `.exe`
   - macOS：`.dmg`
   - iOS：TestFlight / App Store
   - Android：`.apk`

2. **首次启动** — 打开 ClawNo.11，你会看到空白的**实例**页面。

3. **部署 OpenClaw** — 点击侧边栏的**部署**标签，选择**本地部署**一键安装。应用会自动安装 Node.js（如需）、OpenClaw 和 pm2。

4. **开始聊天** — 实例状态变为**在线**（绿色）后，进入**聊天**标签即可对话。

5. **连接手机** — 进入**连接**标签，复制一个 IP 地址，粘贴到手机端 ClawNo.11 App 的连接页面。

---

## 2. Instances / 实例管理

### English

The **Instances** page is your dashboard. It shows all OpenClaw gateway instances (local and remote).

**What you can do:**
- View instance health status: **Online** (green) / **Offline** (red) / **Unknown** (gray)
- **Start / Stop / Restart** a local instance
- **Open in Browser** — opens the OpenClaw dashboard UI (`http://127.0.0.1:18791`)
- **Remove** an instance (with optional uninstall for local)
- Auto health check runs every 30 seconds

**Tip:** If the Instances page is empty, go to **Deploy** first.

### 中文

**实例**页面是你的仪表盘，展示所有 OpenClaw 网关实例（本地和远程）。

**你可以：**
- 查看实例健康状态：**在线**（绿色）/ **离线**（红色）/ **未知**（灰色）
- **启动 / 停止 / 重启**本地实例
- **在浏览器中打开** — 打开 OpenClaw 仪表盘（`http://127.0.0.1:18791`）
- **移除**实例（本地实例可选卸载）
- 每 30 秒自动检查健康状态

**提示：** 如果实例页面为空，请先进入**部署**页面。

---

## 3. Deploy / 部署

### English

Deploy OpenClaw AI gateway to your machine or a remote server.

#### Local Deploy (Recommended for Beginners)

1. Go to **Deploy** tab
2. Click **One-Click Deploy**
3. The app runs 5 steps automatically:
   - Check / install Node.js (v22+)
   - Install OpenClaw via npm
   - Install pm2 process manager
   - Initialize configuration (onboard)
   - Start the gateway
4. Done! Your instance appears on the Instances page.

#### Remote Deploy (via SSH)

For deploying to a Linux server:

1. Go to **Deploy** → **Remote**
2. Fill in SSH connection details:
   | Field | Example | Description |
   |-------|---------|-------------|
   | Host | `192.168.1.100` | Server IP or domain |
   | Port | `22` | SSH port (default: 22) |
   | User | `root` | SSH username |
   | Password/Key | `****` | SSH password or private key |
   | Gateway Port | `18789` | OpenClaw port on remote (default: 18789) |
3. Click **Connect & Deploy**
4. Optionally install **ClawNo Server** (chat proxy on port `18800`) so mobile apps can connect to the remote server directly without the desktop app running.

### 中文

将 OpenClaw AI 网关部署到本机或远程服务器。

#### 本地部署（推荐新手使用）

1. 进入**部署**标签
2. 点击**一键部署**
3. 应用自动执行 5 个步骤：
   - 检查 / 安装 Node.js（v22+）
   - 通过 npm 安装 OpenClaw
   - 安装 pm2 进程管理器
   - 初始化配置（onboard）
   - 启动网关
4. 完成！实例会出现在实例页面。

#### 远程部署（通过 SSH）

部署到 Linux 服务器：

1. 进入**部署** → **远程**
2. 填写 SSH 连接信息：
   | 字段 | 示例 | 说明 |
   |------|------|------|
   | 主机 | `192.168.1.100` | 服务器 IP 或域名 |
   | 端口 | `22` | SSH 端口（默认：22） |
   | 用户名 | `root` | SSH 用户名 |
   | 密码/密钥 | `****` | SSH 密码或私钥 |
   | 网关端口 | `18789` | 远程 OpenClaw 端口（默认：18789） |
3. 点击**连接并部署**
4. 可选安装 **ClawNo Server**（聊天代理，端口 `18800`），这样手机可以直接连接远程服务器，无需桌面端保持运行。

---

## 4. Chat / 聊天

### English

The **Chat** tab opens an embedded AI chat interface powered by your OpenClaw gateway.

**Features:**
- Select which instance to chat with (if you have multiple)
- Full streaming responses
- Model auto-detection
- "Repair Model Config" button if the model is misconfigured

**How it works:**
- Desktop: renders OpenClaw's built-in chat UI in a webview
- Mobile: sends messages through the Chat Proxy (port `18800`), which forwards to the gateway

### 中文

**聊天**标签打开一个嵌入式 AI 聊天界面，由你的 OpenClaw 网关驱动。

**功能：**
- 选择要对话的实例（如果有多个）
- 完整的流式响应
- 模型自动检测
- 模型配置错误时可点击"修复模型配置"

**工作原理：**
- 桌面端：在 webview 中渲染 OpenClaw 内置聊天 UI
- 移动端：通过聊天代理（端口 `18800`）发送消息，代理转发给网关

---

## 5. Mobile App / 移动端

### English

The ClawNo.11 mobile app (iOS / Android) lets you chat with your AI from anywhere.

#### How to Connect Your Phone to Desktop

**Method 1: LAN Connection (Same Wi-Fi — Easiest)**

> Both devices must be on the **same Wi-Fi network**.

1. **Desktop:** Open ClawNo.11 → **Connectors** tab → you'll see all available IP addresses with port `18800`
2. **Copy** one of the addresses (e.g. `http://192.168.1.100:18800`)
3. **Mobile:** Open ClawNo.11 app → **Connect** tab → paste the address into the URL field
4. Tap **Test Connection**
5. If successful, tap **Add** to save the instance

> **Tip:** If the connection fails, check that your Windows network is set to **Private** (not Public), and that port `18800` is not blocked by a firewall.

**Method 2: Remote Access via Tailscale VPN**

> For connecting from outside your home network.

1. Install [Tailscale](https://tailscale.com) on both desktop and mobile
2. Sign in with the same account on both devices
3. Find your desktop's Tailscale IP (usually `100.x.x.x`)
4. On mobile, enter: `http://<tailscale-ip>:18800`
5. Test & Add

#### Mobile Features

| Feature | Requires Connection? |
|---------|---------------------|
| Chat with AI | Yes |
| Instance health monitoring | Yes |
| AI provider configuration (API keys) | Yes |
| Voice input (speech-to-text) | Yes |
| Knowledge Base (RAG) | No (local) |
| MCP server registration | No (local) |
| Router rules | No (local) |
| SSH remote deploy | No (direct to server) |
| Settings | No (local) |

### 中文

ClawNo.11 移动端（iOS / Android）让你随时随地与 AI 对话。

#### 如何将手机连接到桌面端

**方式 1：局域网连接（同一 Wi-Fi — 最简单）**

> 两台设备必须连接**同一个 Wi-Fi 网络**。

1. **桌面端：** 打开 ClawNo.11 → **连接**标签 → 你会看到所有可用的 IP 地址和端口 `18800`
2. **复制**其中一个地址（如 `http://192.168.1.100:18800`）
3. **手机端：** 打开 ClawNo.11 App → **连接**标签 → 将地址粘贴到 URL 输入框
4. 点击**测试连接**
5. 成功后点击**添加**保存实例

> **提示：** 如果连接失败，检查 Windows 网络是否设为**专用网络**（非公用），以及端口 `18800` 是否被防火墙阻止。

**方式 2：通过 Tailscale VPN 远程访问**

> 适用于不在同一局域网的情况。

1. 在桌面端和手机端都安装 [Tailscale](https://tailscale.com)
2. 两台设备用同一个账号登录
3. 查找桌面端的 Tailscale IP（通常是 `100.x.x.x`）
4. 手机端输入：`http://<tailscale-ip>:18800`
5. 测试并添加

#### 移动端功能一览

| 功能 | 需要连接？ |
|------|-----------|
| AI 聊天 | 是 |
| 实例健康监控 | 是 |
| AI 服务商配置（API 密钥） | 是 |
| 语音输入（语音转文字） | 是 |
| 知识库（RAG） | 否（本地） |
| MCP 服务器注册 | 否（本地） |
| 路由规则 | 否（本地） |
| SSH 远程部署 | 否（直连服务器） |
| 设置 | 否（本地） |

---

## 6. Connectors / 连接方式

### English

The **Connectors** page offers multiple ways to access your AI gateway.

#### Mobile Connection Info
- Displays all available LAN IP addresses with port **`18800`**
- One-click copy to clipboard
- Users paste the address into the mobile app to connect

#### Feishu / 飞书 Bot
- Connect your OpenClaw to Feishu (Lark) for team chat
- Configure App ID, App Secret, and Webhook URL

#### Telegram Bot
- Create a bot via [@BotFather](https://t.me/BotFather), paste the token
- Start / Stop the bot from ClawNo.11

#### Discord Bot
- Create a bot in [Discord Developer Portal](https://discord.com/developers), paste the token
- Start / Stop the bot from ClawNo.11

#### xEdge (干将互联)
- Mesh networking via WeChat login
- Assigns virtual IPs (`100.x.x.x`) for remote access

#### Tailscale VPN
- Install Tailscale on both devices
- Connect via Tailscale IP: `http://100.x.x.x:18800`

### 中文

**连接**页面提供多种方式访问你的 AI 网关。

#### 手机连接信息
- 显示所有可用的局域网 IP 地址和端口 **`18800`**
- 一键复制到剪贴板
- 用户将地址粘贴到手机 App 即可连接

#### 飞书机器人
- 将 OpenClaw 连接到飞书，实现团队聊天
- 配置 App ID、App Secret 和 Webhook URL

#### Telegram 机器人
- 通过 [@BotFather](https://t.me/BotFather) 创建机器人，粘贴 Token
- 在 ClawNo.11 中启动 / 停止机器人

#### Discord 机器人
- 在 [Discord 开发者门户](https://discord.com/developers) 创建机器人，粘贴 Token
- 在 ClawNo.11 中启动 / 停止机器人

#### xEdge（干将互联）
- 通过微信登录的组网工具
- 分配虚拟 IP（`100.x.x.x`）用于远程访问

#### Tailscale VPN
- 两台设备都安装 Tailscale
- 通过 Tailscale IP 连接：`http://100.x.x.x:18800`

---

## 7. Security / 安全中心

### English

The **Security** page gives you a security score (0–100) and tools to harden your setup.

**Features:**
- **Security Score** — overall security rating with breakdown
- **Network Access Control** — restrict who can connect:
  - Local Only (`127.0.0.1`)
  - LAN / Subnet (e.g. `192.168.1.0/24`)
  - Tailscale (`100.64.0.0/10`)
- **Kill Switch** — emergency offline: instantly blocks all network access and stops OpenClaw
- **Firewall Rules** — manage Windows Firewall rules for OpenClaw ports
- **Tool Permissions** — control MCP tool execution:
  - `Deny` / `Ask` / `Allow`
  - Allowlist for approved commands
- **Security Events** — log of all security-related actions

### 中文

**安全**页面提供安全评分（0–100）和加固工具。

**功能：**
- **安全评分** — 总体安全等级及分项评估
- **网络访问控制** — 限制谁可以连接：
  - 仅本地（`127.0.0.1`）
  - 局域网 / 子网（如 `192.168.1.0/24`）
  - Tailscale（`100.64.0.0/10`）
- **紧急开关（Kill Switch）** — 紧急离线：立即阻断所有网络访问并停止 OpenClaw
- **防火墙规则** — 管理 OpenClaw 端口的 Windows 防火墙规则
- **工具权限** — 控制 MCP 工具执行：
  - `拒绝` / `询问` / `允许`
  - 已批准命令的白名单
- **安全事件** — 所有安全相关操作的日志

---

## 8. Tokens / 用量监控

### English

The **Tokens** page tracks AI token usage and costs.

**Features:**
- **Usage Overview** — tokens consumed in the last 24 hours, by instance
- **Cost Analysis** — daily, monthly, and projected costs (USD / CNY)
- **Cost by Model** — breakdown by which AI model consumed tokens
- **Per-Instance Quotas** — set spending limits per instance
- **Anomaly Detection** — alerts when 24h usage exceeds 7-day average significantly
- **Kill Switch** — emergency stop if abnormal usage detected

### 中文

**Token** 页面跟踪 AI Token 使用量和费用。

**功能：**
- **用量概览** — 过去 24 小时各实例的 Token 消耗
- **费用分析** — 日、月及预估费用（美元 / 人民币）
- **模型费用** — 按 AI 模型分类的费用明细
- **实例配额** — 为每个实例设置消费上限
- **异常检测** — 24 小时用量显著超过 7 天均值时告警
- **紧急开关** — 检测到异常用量时紧急停止

---

## 9. Knowledge Base (RAG) / 知识库

### English

The **Knowledge Base** page lets you upload documents for AI retrieval-augmented generation.

**Supported formats:** `.txt`, `.md`, `.csv`, `.json`, `.yaml`, `.html`

**How to use:**
1. Click **Upload Document**
2. Select a file from your computer
3. The document is split into chunks and indexed
4. When chatting, the AI can reference your documents for more accurate answers

**Operations:**
- View document list with chunk counts
- Search within document chunks
- Delete documents

### 中文

**知识库**页面让你上传文档，用于 AI 检索增强生成（RAG）。

**支持的格式：** `.txt`、`.md`、`.csv`、`.json`、`.yaml`、`.html`

**使用方法：**
1. 点击**上传文档**
2. 从电脑选择文件
3. 文档被拆分成片段并建立索引
4. 聊天时，AI 可以参考你的文档给出更准确的回答

**操作：**
- 查看文档列表及片段数
- 在文档片段中搜索
- 删除文档

---

## 10. Plugins (MCP) / 插件

### English

The **Plugins** page manages MCP (Model Context Protocol) tools and OpenClaw plugins.

**Features:**
- **OpenClaw Plugins** — built-in plugins, enable/disable with one click
- **External MCP Servers** — add third-party MCP servers:
  1. Enter the server URL or command
  2. Click **Scan** — the app discovers available tools
  3. View permissions (Network / File I/O / Shell)
  4. Enable the server

### 中文

**插件**页面管理 MCP（模型上下文协议）工具和 OpenClaw 插件。

**功能：**
- **OpenClaw 插件** — 内置插件，一键启用/禁用
- **外部 MCP 服务器** — 添加第三方 MCP 服务器：
  1. 输入服务器 URL 或命令
  2. 点击**扫描** — 应用自动发现可用工具
  3. 查看权限（网络 / 文件读写 / Shell）
  4. 启用服务器

---

## 11. Router / 智能路由

### English

The **Router** page lets you define keyword-based routing rules to direct messages to different instances or models.

**How to use:**
1. Click **Add Rule**
2. Enter keywords (e.g. "code", "translate", "image")
3. Select the target instance
4. Adjust priority with up/down arrows
5. Enable/disable rules as needed

When you send a message containing a keyword, it is automatically routed to the matching instance.

### 中文

**路由**页面让你定义基于关键词的路由规则，将消息分发到不同实例或模型。

**使用方法：**
1. 点击**添加规则**
2. 输入关键词（如 "代码"、"翻译"、"图片"）
3. 选择目标实例
4. 用上下箭头调整优先级
5. 按需启用/禁用规则

发送包含关键词的消息时，会自动路由到匹配的实例。

---

## 12. Local Models / 本地模型

### English

The **Local Models** page manages Ollama for running AI models entirely on your machine (no cloud needed).

**Steps:**
1. **Install Ollama** — click to auto-install if not present
2. **Start Ollama** — launch the Ollama server
3. **Download Models** — choose from the catalog:
   | Model | Size | Best For |
   |-------|------|----------|
   | Qwen 2.5 3B | ~2 GB | Fast, lightweight |
   | Qwen 2.5 7B | ~4.5 GB | General purpose |
   | Qwen 2.5 14B | ~9 GB | High quality |
   | DeepSeek-R1 7B | ~4.5 GB | Reasoning |
   | Llama 3.2 3B | ~2 GB | Meta's latest |
   | Mistral 7B | ~4.5 GB | European alternative |
4. **Set Default** — choose which model to use
5. Models are fully local — your data never leaves your machine

### 中文

**本地模型**页面管理 Ollama，在你的电脑上完全本地运行 AI 模型（无需云端）。

**步骤：**
1. **安装 Ollama** — 如果未安装，点击自动安装
2. **启动 Ollama** — 启动 Ollama 服务器
3. **下载模型** — 从目录中选择：
   | 模型 | 大小 | 适用场景 |
   |------|------|----------|
   | Qwen 2.5 3B | ~2 GB | 快速轻量 |
   | Qwen 2.5 7B | ~4.5 GB | 通用 |
   | Qwen 2.5 14B | ~9 GB | 高质量 |
   | DeepSeek-R1 7B | ~4.5 GB | 推理 |
   | Llama 3.2 3B | ~2 GB | Meta 最新 |
   | Mistral 7B | ~4.5 GB | 欧洲替代方案 |
4. **设为默认** — 选择要使用的模型
5. 模型完全本地运行 — 你的数据不会离开你的电脑



## 13. Remote Sessions / 远程会话

### English

The **Remote Sessions** page (desktop only) shows active mobile client sessions connected via the Chat Proxy.

**Features:**
- View connected mobile sessions
- See message counts (user/assistant)
- Monitor streaming status
- Clear all sessions

### 中文

**远程会话**页面（仅桌面端）展示通过聊天代理连接的移动端会话。

**功能：**
- 查看已连接的移动端会话
- 查看消息数量（用户/助手）
- 监控流式传输状态
- 清除所有会话

---

## 14. Settings / 设置

### English

| Section | Options |
|---------|---------|
| **General** | Language (English / 中文), Start on Instances page, Auto health check |
| **Security** | Security preset (Low / Medium / High), PII filter |
| **Storage** | Global token budget, Per-instance quotas, Purge old records, Wipe API keys, Model pricing |
| **Updates** | Auto update / Prompt before update |
| **About** | Version, License (Apache 2.0), Framework info |

### 中文

| 分类 | 选项 |
|------|------|
| **通用** | 语言（English / 中文）、启动时显示实例页、自动健康检查 |
| **安全** | 安全预设（低 / 中 / 高）、PII 过滤 |
| **存储** | 全局 Token 预算、实例配额、清除旧记录、清除 API 密钥、模型定价 |
| **更新** | 自动更新 / 更新前询问 |
| **关于** | 版本号、许可证（Apache 2.0）、框架信息 |

---

## 15. Port Reference / 端口一览

| Port | Service | Bind Address | Description (EN) | 说明（中文） |
|------|---------|-------------|-------------------|-------------|
| **18789** | OpenClaw Gateway | `127.0.0.1` | AI gateway API (local only) | AI 网关 API（仅本地） |
| **18791** | OpenClaw Dashboard | `127.0.0.1` | Web UI for OpenClaw | OpenClaw 网页仪表盘 |
| **18800** | Chat Proxy | `0.0.0.0` | LAN-accessible proxy for mobile | 局域网聊天代理（手机连接用） |
| **22** | SSH | — | Remote server deployment | 远程服务器部署 |

**Important notes / 重要说明:**

- **`18789`** (Gateway) only accepts connections from `127.0.0.1` (localhost). Mobile devices **cannot** connect to this port directly.
  **`18789`**（网关）仅接受来自 `127.0.0.1`（本机）的连接。手机**无法**直接连接此端口。

- **`18800`** (Chat Proxy) listens on `0.0.0.0` (all network interfaces), meaning any device on your LAN can reach it. This is the port your mobile app connects to.
  **`18800`**（聊天代理）监听 `0.0.0.0`（所有网络接口），局域网内任何设备都可以访问。手机 App 连接的就是这个端口。

- If port `18800` is occupied, the proxy automatically tries `18801`–`18810`.
  如果 `18800` 端口被占用，代理会自动尝试 `18801`–`18810`。

---

## 16. FAQ / 常见问题

### Q: Mobile can't connect to the desktop? / 手机连不上桌面端？

**EN:** Check these in order:
1. Both devices must be on the **same Wi-Fi network**
2. Make sure port `18800` is not blocked by your firewall
3. On Windows, set your network profile to **Private** (Settings → Network → Wi-Fi → Private)
4. Try each IP address shown on the desktop Connectors page — pick the one matching your WiFi network (usually `192.168.x.x`)

**中文：** 按以下顺序排查：
1. 两台设备必须在**同一个 Wi-Fi 网络**
2. 确保端口 `18800` 没有被防火墙阻止
3. Windows 上需要将网络设为**专用网络**（设置 → 网络 → Wi-Fi → 专用）
4. 尝试桌面端「连接」页面显示的每个 IP 地址 — 选择与你 WiFi 网络匹配的那个（通常是 `192.168.x.x`）

---

### Q: How to find my computer's IP? / 怎么找到电脑的 IP？

**EN:**
- Windows: Open terminal, run `ipconfig`, look for "IPv4 Address" under your Wi-Fi adapter (usually `192.168.x.x`)
- macOS: System Settings → Wi-Fi → Details → IP Address

**中文：**
- Windows：打开终端，运行 `ipconfig`，找到 Wi-Fi 适配器下的"IPv4 地址"（通常是 `192.168.x.x`）
- macOS：系统设置 → Wi-Fi → 详细信息 → IP 地址

---

### Q: Can I access from outside my home? / 在外面能访问吗？

**EN:** Yes, using a VPN like **Tailscale**:
1. Install Tailscale on desktop + mobile
2. Sign in with the same account
3. Connect via Tailscale IP: `http://100.x.x.x:18800`

**中文：** 可以，通过 **Tailscale** 等 VPN：
1. 桌面端和手机端都安装 Tailscale
2. 用同一账号登录
3. 通过 Tailscale IP 连接：`http://100.x.x.x:18800`

---

### Q: Desktop shows multiple IPs, which one should I use? / 桌面端显示多个 IP，用哪个？

**EN:** Pick the IP that belongs to your WiFi/Ethernet adapter — usually starts with `192.168.x.x` or `10.x.x.x`. If you have a VPN running (Clash, Tailscale, etc.), you may see extra IPs — ignore those for LAN connection.

**中文：** 选择属于你 WiFi/以太网适配器的 IP — 通常以 `192.168.x.x` 或 `10.x.x.x` 开头。如果运行了 VPN（Clash、Tailscale 等），可能会看到额外的 IP — 局域网连接请忽略这些。

---

### Q: What's the difference between Gateway and Chat Proxy? / 网关和聊天代理有什么区别？

**EN:**
| | Gateway (18789) | Chat Proxy (18800) |
|--|--|--|
| **Purpose** | Core AI processing | Mobile access bridge |
| **Access** | Localhost only | LAN / VPN |
| **Protocol** | WebSocket | HTTP (OpenAI-compatible) |
| **Used by** | Desktop app | Mobile app |

**中文：**
| | 网关 (18789) | 聊天代理 (18800) |
|--|--|--|
| **用途** | 核心 AI 处理 | 移动端访问桥梁 |
| **访问范围** | 仅本机 | 局域网 / VPN |
| **协议** | WebSocket | HTTP（OpenAI 兼容） |
| **使用者** | 桌面端 | 移动端 |

---

### Q: "Instance offline" but I already deployed? / 显示"实例离线"但我已经部署了？

**EN:** Try: Instances page → click **Restart** on the instance. If it still fails, go to Deploy and re-deploy.

**中文：** 尝试：实例页面 → 点击实例的**重启**按钮。如果仍然失败，进入部署页面重新部署。

---

*For more technical details, see the [Architecture Docs](./ARCHITECTURE-V2.md).*
*更多技术细节请参阅[架构文档](./ARCHITECTURE-V2.md)。*
