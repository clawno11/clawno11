# ClawNo.11 系统架构文档

> 本文档详细描述 ClawNo.11 的系统架构、模块设计和数据流。

---

## 目录

1. [整体架构](#1-整体架构)
2. [前端架构（React + Zustand）](#2-前端架构react--zustand)
3. [后端架构（Rust + Tauri）](#3-后端架构rust--tauri)
4. [数据存储架构](#4-数据存储架构)
5. [IPC 通信机制](#5-ipc-通信机制)
6. [核心数据流](#6-核心数据流)
7. [安全架构](#7-安全架构)
8. [AI 集成架构](#8-ai-集成架构)
9. [设计决策与取舍](#9-设计决策与取舍)

---

## 1. 整体架构

ClawNo.11 是一个典型的 **Tauri 桌面应用**，采用"Rust 后端 + WebView 前端"的双进程架构：

```
┌──────────────────────────────────────────────────────────────────┐
│                      ClawNo.11 进程                               │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  WebView 进程（前端）                      │    │
│  │                                                         │    │
│  │   React 19  ←→  Zustand Store  ←→  SQLite / localStorage│    │
│  │       ↕                                                 │    │
│  │   ipc.ts（invoke / listen）                              │    │
│  └──────────────────────┬──────────────────────────────────┘    │
│                         │ Tauri IPC（双向消息传递）               │
│  ┌──────────────────────▼──────────────────────────────────┐    │
│  │                  Rust 进程（后端）                         │    │
│  │                                                         │    │
│  │   Tauri 插件层（sql / store / dialog / shell）            │    │
│  │   业务模块（deploy / security / connectors / mcp / rag）  │    │
│  │   系统交互（node / pm2 / gateway / platform）             │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  持久化：clawno.db（SQLite）+ clawno_secure.bin（AES 加密）         │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTP（127.0.0.1:18789）
                    OpenClaw 网关进程（pm2 守护）
                             │ HTTPS
                      AI 提供商 API 端点
```

### 关键设计原则

- **本地优先**：所有数据存储在用户设备，无云端依赖，无遥测
- **最小权限**：Tauri CSP 和 capabilities 严格限制 WebView 权限
- **类型安全**：前后端通过 `ipc.ts` 实现类型化桥接，减少运行时错误
- **渐进式部署**：用户可只使用部分功能（如只用聊天，不启用 RAG）

---

## 2. 前端架构（React + Zustand）

### 2.1 页面路由

基于 **React Router 7** 的客户端路由，单页面应用：

```
/                → InstancesPage    # 首页：实例管理
/deploy          → DeployPage       # 一键部署流水线
/chat            → ChatPage         # AI 对话界面
/security        → SecurityPage     # Claw Guard 安全中心
/tokens          → TokenPage        # Token 消耗监控
/connectors      → ConnectorsPage   # IM 连接器配置
/rag             → RagPage          # 私有知识库管理
/mcp             → McpPage          # MCP 插件管理
/router          → RouterPage       # 智能模型路由
/settings        → SettingsPage     # 应用设置
```

### 2.2 页面功能详解

#### InstancesPage（实例管理）
- 展示所有 ClawInstance 卡片（本地 + 远程）
- 每个实例展示：名称、类型（local/remote/cloud）、健康状态、延迟
- 操作：启动 / 停止 / 重启 / 健康检测 / 打开浏览器控制台
- 配置入口：为每个实例设置 AI 提供商和 API Key

#### DeployPage（一键部署）
- **本地部署**：自动执行 5 步流水线
  1. 检查 Node.js（≥18，支持 nvm/fnm 升级，npmmirror 镜像回退）
  2. 安装 openclaw CLI（npm install -g openclaw）
  3. 安装 pm2（npm install -g pm2）
  4. 初始化配置（openclaw onboard --yes）
  5. 启动服务（openclaw start，pm2 守护）
- **远程部署**：预留接口（当前为 stub）
- 实时进度显示、步骤计时器、错误详情
- 完成后提供 AI API Key 配置入口（写入加密存储）

#### ChatPage（AI 对话）
- 流式 SSE 输出（通过 `@clawno/openclaw-client`）
- **PII 过滤**：发送前自动检测并替换 6 类敏感信息
- **RAG 注入**：从知识库检索相关上下文，附加到 system prompt
- **智能路由**：根据关键词路由规则选择目标实例
- **会话历史**：读取/保存 SQLite 中的对话记录
- **提示词库**：内置 + 自定义提示词模板，一键应用
- 操作：发送消息、停止生成、新建会话、历史搜索

#### SecurityPage（Claw Guard）
- **安全评分仪表盘**（0-100 分）：综合评分算法
  - ok=100% / warn=50% / unknown=25% / danger=0%
- **检查项**：端口暴露状态、Node.js CVE 版本、pm2 运行状态、离线模式检测
- **端口监控**：列出指定端口的活跃 TCP 连接
- **防火墙管理**：一键添加/移除 Windows 防火墙规则（仅允许 127.0.0.1）
- **安全事件日志**：记录所有安全操作到 SQLite
- **Panic Button**：一键销毁所有 API Key 和敏感数据

#### TokenPage（Token 监控）
- 24 小时内 Token 总消耗统计（prompt + completion 分开）
- 逐小时柱状图（0-23 小时）
- 7 天移动平均，异常检测（超过均值 3 倍时红色告警）
- 历史记录列表（按时间、实例、提供商筛选）

#### ConnectorsPage（IM 连接器）
- **飞书/Lark**：4 步配置向导
  1. 创建飞书企业应用获取 App ID / App Secret
  2. 验证凭据（调用飞书 API 验证）
  3. 写入加密存储
  4. 生成 Webhook 配置说明
- **Tailscale**：检测安装状态、获取节点 IP、生成远程访问 URL

#### RagPage（私有知识库）
- 支持格式：TXT / MD / CSV / LOG / JSON / YAML / HTML 等
- **Ingest 流程**：读取文件 → 按 500 字符切块（60 字符 overlap）→ 存入 SQLite
- **检索**：SQL LIKE 关键词召回 → TF-IDF + 余弦相似度重排 → 返回 Top-K
- **管理**：文档列表（名称/大小/切块数）、删除文档（级联删除 chunks）

#### McpPage（MCP 插件管理）
- **注册 MCP 服务器**：支持 HTTP-SSE、Stdio 两种类型
- **安全扫描**（调用 Rust 端）：
  - HTTP/SSE：检测远程端点 / TLS / 可达性
  - Stdio：启发式 Shell 命令检测 / 敏感路径检测
  - 风险等级：safe（绿）/ caution（黄）/ danger（红）
- **审计日志**：记录每次工具调用到 `mcp_audit` 表

#### RouterPage（智能路由）
- 关键词到实例 ID 的映射规则
- 规则字段：名称 / 关键词数组 / 目标实例 ID / 优先级 / 启用状态
- OR 匹配：消息中任一关键词匹配则命中规则
- 内置模板：代码（code/函数）/ 写作（写/作文）/ 分析（分析/数据）/ 翻译（翻译/translate）
- 优先级排序（数字越小越优先）

#### SettingsPage（设置）
- 语言切换（中文 / English），即时生效，localStorage 持久化
- 启动行为配置
- 安全等级预设（strict / balanced / relaxed）
- Token 日志清理（清空 `token_records` 表）
- API Key 管理（查看已配置的提供商 / 清除单个或全部）
- 关于页面（版本号、GitHub 链接）

### 2.3 Store 层架构

```
src/store/
├── instances.ts        # Zustand + localStorage persist
│                       # 状态：ClawInstance[]
│                       # 字段：id / name / kind / gatewayUrl /
│                       #        uiUrl / httpUrl / port / health / latencyMs
│                       # 注：health 和 latencyMs 不持久化，重启重置为 unknown
│
├── aiConfig.ts         # Zustand（无持久化）
│                       # 状态：{ [provider: string]: boolean }（是否已配置）
│                       # 源数据从加密存储加载（secureStore.ts）
│
├── chatHistory.ts      # SQLite（chat_sessions + chat_messages）
│                       # 操作：list / search / load / create / delete / append
│
├── tokenLog.ts         # SQLite（token_records）
│                       # 操作：log / get24h / getHourly / get7dayAvg
│
├── ragStore.ts         # SQLite（rag_documents + rag_chunks）
│                       # 操作：ingest / search / listDocs / deleteDoc
│                       # 检索：TF-IDF cosine similarity（纯 JS 实现）
│
├── mcpStore.ts         # SQLite（mcp_servers + mcp_audit）
│                       # 操作：add / list / scan / audit / delete
│
├── modelRouter.ts      # localStorage
│                       # 状态：RouterRule[]（id/name/keywords/instanceId/priority/enabled）
│
├── piiFilter.ts        # 纯 TS 正则，无持久化
│                       # 过滤：手机号 / 身份证 / 邮箱 / API Key / 信用卡 / 内网 IP
│
├── secureStore.ts      # invoke 桥接（加密存储）
│                       # 操作：set / get / delete / listKeys / wipeAll
│
├── securityEventStore.ts # SQLite（security_events）
│                         # 操作：log / list / clear
│
├── promptLibrary.ts    # localStorage
│                       # 状态：Prompt[]（内置 + 自定义）
│
└── db.ts               # 常量：sqlite:clawno.db
```

### 2.4 国际化（i18n）

- 框架：`i18next` + `react-i18next`
- 语言包：`src/locales/zh.json`（中文）+ `src/locales/en.json`（英文）
- 语言选择存储于 localStorage，应用启动时自动加载
- 覆盖范围：所有 UI 文本（导航、按钮、提示信息、表单标签）

---

## 3. 后端架构（Rust + Tauri）

### 3.1 模块依赖关系

```
lib.rs（入口 / 插件注册）
├── platform.rs          # 基础层：跨平台 shell 执行、路径工具
│   ├── node.rs          # Node.js 检测 + openclaw/pm2 安装
│   │   ├── pm2.rs       # pm2 进程生命周期管理
│   │   │   └── gateway.rs  # openclaw 网关启停 + 健康探测
│   │   │       └── deploy.rs  # 部署流水线协调（调用上述模块）
│   │   └── secure_store.rs    # 独立：加密 KV 存储（tauri-plugin-store）
├── security.rs          # 独立：安全扫描 + 防火墙管理
├── connectors.rs        # 独立：IM 连接器（飞书 / Tailscale）
├── mcp.rs               # 独立：MCP 安全扫描（reqwest HTTP）
├── rag.rs               # 独立：文件读取（带安全校验）
└── token_log.rs         # 独立：SQLite schema 迁移定义
```

### 3.2 各模块详解

#### `platform.rs` — 跨平台基础层

提供所有模块依赖的跨平台辅助函数：

| 函数 | 功能 |
|------|------|
| `shell_cmd()` | 返回平台 shell（Windows: `cmd /C`，Unix: `sh -c`） |
| `augmented_path()` | 扩展 PATH 包含 nvm/fnm/npm 全局路径 |
| `user_home()` | 获取用户主目录 |
| `data_roaming()` | Windows %APPDATA%\Roaming，其他平台返回 home |
| `path_join()` | 跨平台路径拼接 |
| `shell_result()` | 执行命令并返回 stdout/stderr 合并字符串 |
| `first_line()` | 取命令输出的第一行（用于版本检测） |

#### `node.rs` — Node.js 管理

- **`deploy_step_check_node`**：检测 Node.js 版本
  - 优先检测系统 PATH 中的 node
  - 若版本 <18，尝试通过 nvm/fnm 切换到合适版本
  - 若未安装，Windows 通过 winget 安装，其他平台输出安装建议
  - 镜像回退：npm registry 失败时切换到 npmmirror
- **`deploy_step_install_openclaw`**：全局安装 openclaw CLI（`npm install -g openclaw`）

#### `pm2.rs` — 进程守护

- **`deploy_step_install_pm2`**：全局安装 pm2
- **`get_local_service_info`**：调用 `pm2 jlist` 获取 JSON 格式进程列表，提取 openclaw 进程状态
- **`stop_local_service`**：`pm2 stop openclaw`
- **`restart_local_service`**：`pm2 restart openclaw`
- **退出钩子**：应用关闭时自动调用 `pm2 stop openclaw`（可配置）

#### `gateway.rs` — 网关管理

- **`deploy_step_start`**：启动 openclaw 网关
  - 执行 `openclaw start`（pm2 启动）
  - 等待健康检查通过（轮询 `/health` 端点，最多 30 秒）
- **`probe_instance_health`**：HTTP GET 探测实例健康状态，返回 latency（毫秒）
- **`get_browser_url`**：返回 openclaw 控制台 URL（默认 `http://127.0.0.1:18789`）
- **`open_in_browser`**：调用系统默认浏览器打开 URL
- **`start_local_service`**：通过 pm2 重新启动已停止的服务

#### `deploy.rs` — 部署协调

- **`deploy_step_onboard`**：执行 `openclaw onboard --yes`，初始化网关配置文件（`~/.openclaw/config.json`）
- **`deploy_local`**：按顺序调用 5 个 `deploy_step_*` 命令，返回每步 `StepResult`
- **`deploy_remote`**：远程部署占位（stub，返回未实现错误）
- **`configure_api_key`**：安全写入 AI 提供商 API Key
  - provider 名称严格白名单验证（15 个合法值）
  - 通过 stdin 管道写入（`echo <key> | openclaw config set-key <provider>`）
  - 写入成功后调用 `set_secure_value` 记录配置状态

**支持的 provider 白名单**：
```
zai, minimax, anthropic, openai, openrouter,
deepseek, moonshot, qwen, doubao, hunyuan,
xinghuo, baichuan, stepfun, yi, siliconflow
```

#### `secure_store.rs` — 加密存储

使用 `tauri-plugin-store`，存储文件为 `clawno_secure.bin`（JSON 加密）：

| 命令 | 功能 |
|------|------|
| `set_secure_value(key, value)` | 写入加密 KV |
| `get_secure_value(key)` | 读取，返回 `Option<String>` |
| `delete_secure_value(key)` | 删除单个 key |
| `list_secure_keys()` | 列出所有 key（不含值） |
| `wipe_secure_store()` | 清空所有数据（Panic Button） |

Key 命名约定：`ai_key_configured:<provider>`（如 `ai_key_configured:anthropic`）

#### `security.rs` — 安全扫描

- **`scan_security_status`**：运行全套检查，返回 `SecurityReport`
  - `port_check`：netstat 检测 18789 端口暴露范围
  - `node_version`：检测 Node.js 是否存在 已知 CVE 的版本（<16.0）
  - `pm2_running`：pm2 进程状态
  - `offline_mode`：读取 `~/.openclaw/config.json` 检测离线模式配置
  - **评分算法**：各项权重相等，ok=1.0 / warn=0.5 / unknown=0.25 / danger=0.0，归一化为 0-100
- **`get_port_connections`**：`netstat -ano` 过滤指定端口，返回连接列表
- **`apply_local_only_firewall`**：添加 Windows 防火墙入站规则（`netsh advfirewall firewall add rule`）
- **`remove_local_only_firewall`**：移除对应防火墙规则

#### `connectors.rs` — IM 连接器

- **`test_feishu_connection`**：POST 到 `https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`
  - 验证 App ID / App Secret
  - 解析响应错误码（0=成功，其他返回错误描述）
- **`save_feishu_config`**：将飞书凭据写入加密存储（key: `feishu_app_id` / `feishu_app_secret`）
- **`get_tailscale_status`**：
  - 检测 `tailscale version` 判断是否已安装
  - `tailscale ip -4` 获取节点 IPv4 地址
  - 返回 `{ installed, running, ip }`

#### `mcp.rs` — MCP 安全扫描

**`scan_mcp_server(endpoint, server_type)`** 根据类型执行不同扫描策略：

- **HTTP/SSE 类型**：
  - 检测是否为远程地址（非 localhost）→ 风险加权
  - 检测 TLS（https:// → 加分，http:// → 扣分）
  - 实际 HTTP 探测可达性（reqwest，5秒超时）
  - 综合评分 → safe / caution / danger
  
- **Stdio 类型**：
  - 启发式分析命令字符串
  - 检测 Shell 操作符（`&&`、`||`、`;`、`|`）→ 风险加权
  - 检测敏感路径（`/etc/`、`C:\Windows\`、`/root/`）→ 风险加权
  - 检测网络工具（`curl`、`wget`、`nc`、`ncat`）→ 风险加权

#### `rag.rs` — RAG 文件读取

**`read_text_file(path)`**：
- **扩展名白名单**：`txt md markdown csv log json yaml yml xml html htm rst`
- **路径遍历防护**：规范化路径，拒绝含 `..` 的路径
- 读取文件内容（UTF-8），返回字符串

#### `token_log.rs` — Schema 迁移

定义 `get_migrations()` 返回 5 个版本的 SQLite DDL：

```sql
-- v1: Token 记录
CREATE TABLE token_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL  -- Unix timestamp
);

-- v2: 安全事件
CREATE TABLE security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  detail TEXT,
  severity TEXT NOT NULL,  -- info / warning / critical
  created_at INTEGER NOT NULL
);

-- v3: RAG 知识库
CREATE TABLE rag_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  file_path TEXT,
  size INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE rag_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- v4: MCP 管理
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  server_type TEXT NOT NULL,  -- http-sse / stdio
  risk_level TEXT,             -- safe / caution / danger
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE mcp_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input TEXT,
  output TEXT,
  created_at INTEGER NOT NULL
);

-- v5: 聊天历史
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  instance_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,  -- user / assistant / system
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

---

## 4. 数据存储架构

ClawNo.11 使用**三种存储层**，各有不同用途：

```
┌────────────────────────────────────────────────────────────┐
│                     存储层全景                              │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  SQLite（clawno.db）                                  │  │
│  │  ├── token_records     Token 消耗日志                 │  │
│  │  ├── security_events   安全事件日志                   │  │
│  │  ├── rag_documents     RAG 文档元数据                 │  │
│  │  ├── rag_chunks        RAG 文本切块                   │  │
│  │  ├── mcp_servers       MCP 服务器注册表               │  │
│  │  ├── mcp_audit         MCP 工具调用审计               │  │
│  │  ├── chat_sessions     聊天会话                       │  │
│  │  └── chat_messages     聊天消息                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  加密 KV（clawno_secure.bin）—— AES-GCM              │  │
│  │  ├── ai_key_configured:<provider>  AI Key 配置状态   │  │
│  │  ├── feishu_app_id                 飞书 App ID       │  │
│  │  └── feishu_app_secret             飞书 App Secret   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  localStorage（WebView，无加密）                       │  │
│  │  ├── clawno-instances              实例列表           │  │
│  │  ├── clawno-router-rules           路由规则           │  │
│  │  ├── clawno-prompts                提示词库           │  │
│  │  └── i18nextLng                    语言偏好           │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### 存储选择原则

| 数据类型 | 存储方式 | 原因 |
|----------|---------|------|
| API Key / 密钥 | 加密 KV | 安全性最高，AES 加密 |
| 结构化日志数据 | SQLite | 需要 SQL 查询/聚合/关联 |
| 聊天/RAG/MCP | SQLite | 数据量大，需要全文搜索和关联 |
| UI 状态/配置 | localStorage | 简单 KV，无需加密 |
| 实例列表 | localStorage + Zustand | 启动即用，无需数据库 |

---

## 5. IPC 通信机制

### Tauri invoke（前端 → 后端）

前端通过 `ipc.ts` 中封装的类型化函数调用 Rust 命令：

```typescript
// src/ipc.ts 示例
export const ipc = {
  deployLocal: () => invoke<LocalDeployResult>('deploy_local'),
  probeHealth: (url: string) => invoke<HealthResult>('probe_instance_health', { url }),
  setSecureValue: (key: string, value: string) =>
    invoke<void>('set_secure_value', { key, value }),
  scanSecurity: () => invoke<SecurityReport>('scan_security_status'),
  // ...
}
```

所有 Rust 命令通过 `#[tauri::command]` 宏标注，在 `lib.rs` 的 `invoke_handler` 中注册。

### Tauri 事件（后端 → 前端）

长耗时操作通过事件推送进度：

```rust
// 部署步骤完成时发送事件
app_handle.emit("deploy-step-complete", StepResult { ... })?;
```

### 能力（Capabilities）白名单

`src-tauri/capabilities/default.json` 严格限制 WebView 可用的 API：

- `core:default` — 基础 Tauri 核心 API
- `sql:allow-*` — SQLite 读写
- `store:allow-*` — 加密存储
- `dialog:allow-open` — 文件选择（仅打开）
- `shell:allow-open` — 系统浏览器打开（仅 open）

---

## 6. 核心数据流

### 6.1 部署流水线

```
用户点击"开始部署"
       ↓
DeployPage.tsx
  → invoke('deploy_local')
       ↓
deploy.rs::deploy_local()
  → node.rs::deploy_step_check_node()
     ├─ shell: "node --version"
     ├─ 若 <18: shell: "nvm install 18 && nvm use 18"
     └─ 若未安装: shell: "winget install OpenJS.NodeJS"
  → node.rs::deploy_step_install_openclaw()
     └─ shell: "npm install -g openclaw"
  → pm2.rs::deploy_step_install_pm2()
     └─ shell: "npm install -g pm2"
  → deploy.rs::deploy_step_onboard()
     └─ shell: "openclaw onboard --yes"
  → gateway.rs::deploy_step_start()
     └─ shell: "openclaw start"
     └─ 轮询健康检查（最多 30 秒）
       ↓
返回 LocalDeployResult（包含每步 StepResult）
       ↓
DeployPage 展示结果，提示配置 API Key
```

### 6.2 AI 对话流（含 RAG + PII）

```
用户输入消息
       ↓
ChatPage.tsx
  1. piiFilter.ts → 检测并替换 6 类 PII（纯 TS 正则）
  2. ragStore.ts::search(message)
     → SQLite LIKE 查询 rag_chunks
     → TF-IDF cosine 重排
     → 构建 RAG 上下文字符串
  3. modelRouter.ts::route(message)
     → 关键词匹配 → 确定目标实例 gatewayUrl
  4. @clawno/openclaw-client::streamChat(messages, ragContext)
     → HTTP POST 到 OpenClaw 网关（127.0.0.1:18789）
     → SSE 流式接收 token
  5. tokenLog.ts::log(tokens)
     → 写入 token_records（SQLite）
  6. chatHistory.ts::appendMessage(message)
     → 写入 chat_messages（SQLite）
       ↓
流式渲染响应内容
```

### 6.3 安全扫描流

```
用户打开 SecurityPage / 点击扫描
       ↓
invoke('scan_security_status')
       ↓
security.rs::scan_security_status()
  ├─ shell: "netstat -ano" → 分析 18789 端口暴露
  ├─ shell: "node --version" → 检测 CVE 版本
  ├─ shell: "pm2 jlist" → pm2 运行状态
  └─ fs: "~/.openclaw/config.json" → 离线模式配置
       ↓
计算综合评分（0-100）
       ↓
securityEventStore.ts::log("scan", report)
  → 写入 security_events（SQLite）
       ↓
更新 SecurityPage UI（评分 / 各项状态 / 事件列表）
```

---

## 7. 安全架构

### 7.1 威胁模型

ClawNo.11 主要防护以下威胁：

| 威胁 | 防护机制 |
|------|---------|
| API Key 泄露 | AES 加密存储 + stdin 管道传输 + 从不写入 localStorage |
| 命令注入 | provider 白名单验证 + 参数化 shell 命令 + SSH 输入校验 |
| 路径遍历 | RAG 文件读取强制扩展名白名单 + 路径规范化 |
| PII 泄露 | 发送 AI 前客户端正则过滤（6 类敏感信息） |
| 未授权网络访问 | CSP 限制 + 防火墙规则 + 端口暴露检测 |
| 未授权 LAN 调用 | chat_proxy Bearer Token 认证（启动时随机生成，配对时传递） |
| 恶意 MCP 服务器 | 多维静态+动态安全扫描 + 风险等级展示 |
| 本地数据泄露 | Panic Button（一键销毁所有敏感数据） |
| 推广/追踪零依赖 | 无 CPS 推广链接、无分析统计 SDK、无遥测代码 |

### 7.2 安全评分算法

```
score = mean([port_check, node_version, pm2_status, offline_mode])

其中每项评分：
  ok      → 1.0（100%）
  warn    → 0.5（50%）
  unknown → 0.25（25%）
  danger  → 0.0（0%）

最终得分 = score × 100（0-100 整数）
```

### 7.3 Tauri CSP 配置

```json
{
  "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:* https://open.feishu.cn; img-src 'self' data:"
}
```

---

## 8. AI 集成架构

### 8.1 OpenClaw 网关

ClawNo.11 不直接调用 AI 提供商 API，而是通过本地运行的 **OpenClaw 网关**（端口 18789）进行中转：

```
React 前端
  ↓ HTTP POST /v1/chat/completions（OpenAI 兼容格式）
OpenClaw 网关（127.0.0.1:18789）
  ↓ 路由到对应提供商
AI 提供商 API（Anthropic / OpenAI / ZAI 等）
```

### 8.2 流式输出（SSE）

```typescript
// @clawno/openclaw-client 使用 SSE 流式接收
const stream = client.streamChat({
  messages: [...history, { role: 'user', content: filteredMessage }],
  model: targetModel,
});

for await (const chunk of stream) {
  appendToken(chunk.content);
}
```

### 8.3 RAG 检索增强生成

```
用户消息
  → ragStore.search(message, topK=5)
     → SQL: SELECT content FROM rag_chunks WHERE content LIKE '%keyword%'
     → TF-IDF 向量化 + 余弦相似度计算
     → 返回最相关的 K 个 chunks
  → 构建 system prompt：
     "以下是相关背景知识：\n{chunks.join('\n\n')}\n\n请基于以上信息回答。"
  → 附加到 messages[0]（system role）
```

---

## 9. 设计决策与取舍

### 为什么选择 Tauri 而非 Electron？

| 维度 | Tauri | Electron |
|------|-------|---------|
| 包大小 | ~10MB | ~100MB+ |
| 内存占用 | 低（使用系统 WebView） | 高（捆绑 Chromium） |
| 安全性 | Rust 内存安全 + 细粒度 capabilities | JS 运行时，权限宽松 |
| 性能 | 接近原生 | 较高开销 |

### 为什么 RAG 使用 TF-IDF 而非向量嵌入？

- **无需本地 AI 模型**：向量嵌入需要额外的 embedding 模型（本地或在线），增加部署复杂度
- **完全离线**：TF-IDF 纯 JS 实现，无网络依赖
- **对知识库规模够用**：对于个人级别的知识库（<1000 文档），TF-IDF 效果足够好
- **后续演进**：可通过 `@clawno/openclaw-client` 的 embedding API 升级为向量检索

### 为什么聊天历史和 RAG 都用 SQLite 而非 IndexedDB？

- **事务支持**：SQLite 提供 ACID 事务，避免数据损坏
- **SQL 查询能力**：复杂聚合（Token 统计、时间范围查询）用 SQL 更简洁
- **跨进程访问**：Rust 后端和 WebView 前端可共享同一数据库
- **可迁移性**：标准 SQLite 格式，用户可用工具直接查看数据

### 为什么不支持多窗口？

当前版本为单窗口设计：
- 简化状态管理（Zustand store 无需跨窗口同步）
- 避免 SQLite 并发写入冲突
- 减少内存占用

后续版本可通过 Tauri 的 `WebviewWindow` API 扩展为多窗口。
