# 我开发了一个让普通人可以用上 OpenClaw 的工具 ClawNo.11

## 先说一个扎心的事实

你有没有发现，现在用 AI 有两种人。

一种人，每个月花几百块订阅各种 AI 服务，数据全部交给别人，API Key 存在云端，聊天记录不知道被谁看了。

另一种人，自己搭了私有 AI 网关，数据全在自己手里，想接什么模型接什么模型——但这种人，通常是程序员。

**我想做的事情是：让第二种方案，不再只属于程序员。**

---

## OpenClaw：一个很好的东西，但有门槛

先介绍一下背景。

[OpenClaw](https://github.com/nicepkg/openclaw) 是一个开源的 AI 网关项目，它可以让你在自己的电脑上跑一个 AI 服务，接入十几家云模型提供商（智谱、MiniMax、OpenAI、Claude、DeepSeek、通义千问、豆包、Moonshot……），也可以接本地模型 Ollama。

你的 API Key 存在自己电脑上，聊天数据不经过任何第三方。它支持 Agent、工具调用、模型路由、fallback，功能很强。

**但问题是——要用起来，你得：**

1. 先装 Node.js（还得是 v22+）
2. `npm install -g openclaw`
3. `openclaw configure`（交互式命令行配置）
4. 手动管理 pm2 进程
5. 自己编辑 `auth-profiles.json` 写 API Key
6. 手机上想用？自己搞内网穿透或者 Tailscale
7. 想接飞书、微信？自己装插件、写配置

**每一步都不难，但全加起来，就把 99% 的普通用户挡在门外了。**

我当时就想：这么好的东西，为什么只能程序员用？

---

## 所以我做了 ClawNo.11

ClawNo.11 的定位很简单：**OpenClaw 的控制台。**

它是一个桌面+移动端的应用（Windows / macOS / iOS / Android），把 OpenClaw 从命令行搬进了图形界面。

核心理念就一句话：**Your AI, Your Data, Your Home.**

你的 AI、你的数据、你自己的地盘。

---

## 三分钟，从零开始

装好 ClawNo.11，点击「一键部署」。

它会自动帮你做这些事：

- 检测环境（Node.js 有没有装？版本够不够？）
- 没装的自动帮你装
- 安装 OpenClaw CLI
- 安装 pm2 进程管理
- 初始化 OpenClaw 配置
- 启动网关服务

**整个过程大概 3 分钟，你不需要打开终端，不需要输入任何命令。**

部署完成后，弹出一个配置界面，选一个 AI 提供商，粘贴你的 API Key，就可以开始聊天了。

如果你手头有 Ollama，ClawNo.11 也会自动发现并注册为本地模型——断网的时候也能用。

---

## 不只是能用，还要好用

做完"能用"之后，我又花了很多时间在"好用"上。

### 多实例管理

你可以同时管理多个 OpenClaw 实例——本机的、远程服务器的、SSH 部署的——在同一个界面里切换，看健康状态，一键重启。

### 智能路由

设置关键词规则，比如「翻译」走 DeepSeek，「代码」走 GPT-4o，「日常闲聊」走本地 Ollama。自动匹配，不需要每次手动切模型。

### 手机也能用

部署在电脑上，手机扫个码就能连上。支持局域网直连，也支持 Tailscale 和 xEdge 做远程穿透——出门在外也能用自己部署的 AI。

### 团队连接器

一键接入微信、飞书、Telegram、Discord。你的 AI 不只是你自己用，还可以变成团队的共享助手。微信那个，扫码就能接，不用搞企业号。

### 知识库（RAG）

上传文档，ClawNo.11 会自动切片、索引。聊天时相关内容会被注入到上下文中，让 AI 基于你的私有知识库回答问题。

### Token 用量监控

每次对话花了多少 Token、多少钱、哪个模型最费、趋势怎么样——全部可视化。还能设预算，超了自动拉闸。

### MCP 插件

支持 MCP（Model Context Protocol）插件，给 AI 接工具。ClawNo.11 会自动扫描插件安全性，标记风险等级，你可以逐个审批工具权限。

---

## 安全这件事，我是认真的

做私有 AI 网关，安全不是附加功能，是基础。

ClawNo.11 有一个「安全中心」（我叫它 Claw Guard），做了这些事：

- **零遥测**：不收集任何数据，不上报任何信息
- **API Key 加密存储**：AES-GCM，不明文存盘
- **PII 过滤**：身份证、手机号、银行卡、邮箱、地址、姓名——6 种隐私信息自动识别和过滤
- **Kill Switch**：一键切断所有 AI 连接，紧急情况下立刻断网
- **MCP 工具审计**：插件想调什么工具、有什么风险，全部记录在案
- **Token 异常检测**：用量突然飙升会告警，防止 Key 泄露被盗刷

安全评分一目了然，哪里没配好会告诉你怎么修。

---

## 技术选型，给感兴趣的同学

- **框架**：Tauri 2（Rust 后端 + React 19 前端）
- **安装包**：~10MB（不是 Electron 那种 200MB 的）
- **架构**：共享层 `@clawno/shared` + 各平台薄壳，一套代码覆盖 4 个平台
- **后端逻辑**：Rust crate `clawno-core`，不依赖 Tauri，可以独立复用
- **开源协议**：Apache 2.0，随便用

整个项目的架构设计原则是「共享优先」——能共享的代码绝不在两个平台各写一份。

---

## 目前支持的 AI 提供商

直接支持：
- 智谱（GLM-4-Flash）
- MiniMax（M2）
- OpenAI（GPT-4o Mini）
- Anthropic（Claude Haiku 3）
- Moonshot（Kimi K2.5）
- 通义千问（Qwen 3.5 Plus）
- 豆包（Seed 1.8）
- DeepSeek（V3）

通过 OpenRouter 还能用：
- Llama 3.2
- 混元 Lite
- 讯飞星火 Lite
- 以及 OpenRouter 上的几百个模型

本地模型：
- Ollama（Gemma、Llama、Qwen、DeepSeek 等）

**一个入口，所有模型。**

---

## 写在最后

我做 ClawNo.11 的初衷很简单：**AI 应该像水电一样，是基础设施，而不是围墙花园。**

你不应该为了用 AI 就把数据交出去，也不应该为了保护数据就得学会用命令行。

OpenClaw 解决了「私有 AI 网关」的问题，ClawNo.11 解决了「普通人用不上 OpenClaw」的问题。

**现在，三分钟就够了。**

---

**下载地址**：[https://clawno11.ai](https://clawno11.ai)

**GitHub**：[https://github.com/clawno11/clawno11](https://github.com/clawno11/clawno11)

永久免费，开源，无订阅，无使用限制。

如果你觉得这个项目有用，帮我点个 Star 吧。
