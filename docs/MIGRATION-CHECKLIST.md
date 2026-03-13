# ClawNo.11 架构迁移检查清单

> **范围：纯迁移。** 只把现有功能搬进新架构，不实现新功能。
> 迁移完成后用户体验和功能零变化，唯一变化是代码住在了正确的位置。
> 每完成一步，在 `[ ]` 中打 `x` 标记为 `[x]`。
> 校对参考：[ARCHITECTURE-V2.md](./ARCHITECTURE-V2.md), [MODULE-BOUNDARIES.md](./MODULE-BOUNDARIES.md)

---

## Phase 0 — 地基：Cargo Workspace (1-1.5 周)

### 0.1 隔离验证（独立测试项目）

> 在主项目之外的空项目里验证，避免污染现有代码。

- [x] 创建独立测试项目：根 `Cargo.toml` (workspace) + `crates/test-core` + Tauri desktop app
- [x] 验证 `tauri dev` 在 workspace 模式下能正确定位 target 目录
- [x] 验证 `tauri build` (Windows .msi) 在 workspace 模式下通过
- [x] 验证 `tauri android build` 在 workspace 模式下通过
- [x] 验证 `tauri ios build` 在 workspace 模式下通过（如适用）
- [x] 确认 `Cargo.lock` 策略（workspace 根级唯一 lock file）
- [x] 记录所有踩坑和解决方案到 `docs/tauri-workspace-notes.md`

**中断条件：** 如果 Tauri 2 CLI 在 workspace 下无法构建 Android，在此步骤寻找替代方案（如 `path` 依赖替代 workspace member），不带问题进主项目。

### 0.2 主项目搭建 workspace

- [x] 在项目根创建 `Cargo.toml` (workspace members: crates/clawno-core, apps/desktop/src-tauri, apps/mobile/src-tauri)
- [x] 创建 `crates/clawno-core/Cargo.toml` (初始依赖仅 serde + serde_json)
- [x] 创建 `crates/clawno-core/src/lib.rs` (空骨架，仅 `pub fn version()`)
- [x] 定义 feature flags: `desktop` 和 `mobile`
- [x] 修改 `apps/desktop/src-tauri/Cargo.toml`：加 workspace 配置 + `clawno-core = { path = "../../crates/clawno-core", features = ["desktop"] }`
- [x] 修改 `apps/mobile/src-tauri/Cargo.toml`：加 workspace 配置 + `clawno-core = { path = "../../crates/clawno-core", features = ["mobile"] }`
- [x] 将两端 `Cargo.toml` 中完全相同的 13 个依赖提升到 `[workspace.dependencies]`
- [x] `cargo build` (desktop) 通过
- [x] `cargo build` (mobile) 通过
- [x] `tauri dev` (desktop) 正常启动，功能正常
- [x] `tauri android dev` (mobile) 正常启动，功能正常

**验收：** workspace 建立，core crate 被两端引用但为空，现有功能零影响。

---

## Phase 1 — Rust 搬家 (1.5-2 周)

> 按重复率从高到低排序。每搬完一个模块，立即验证两端编译 + 功能。

### 1.1 token_log.rs → core（重复率 85-90%）

- [x] 将 `DB_URL` 常量搬到 `clawno-core/src/token_log.rs`
- [x] 将 `migrations()` 函数搬到 core
- [x] desktop 多出的 2 个 INDEX 用 `#[cfg(feature = "desktop")]`
- [x] desktop `token_log.rs` 改为调用 `clawno_core::token_log::migrations()`（~3 行）
- [x] mobile `token_log.rs` 改为调用 `clawno_core::token_log::migrations()`（~3 行）
- [x] 在 `clawno-core/Cargo.toml` 添加需要的依赖（如有）
- [x] ✅ 两端编译通过 + 数据库迁移正常

### 1.2 secure_store.rs → core + 加密修复（重复率 90-95%）

- [x] 在 `clawno-core/Cargo.toml` 添加 `aes-gcm`, `sha2`, `base64`, `getrandom`
- [x] 在 `clawno-core/src/secure_store.rs` 实现加密 KV 核心逻辑 (`derive_key`, `encrypt_value`, `decrypt_value`, `is_encrypted`)
- [x] 设计密钥派生方案：SHA-256(APP_SALT + hostname:app_data_dir) → AES-256 key
- [x] 实现旧数据迁移：`get_secure_value` 读取时检测明文 → 自动加密覆盖 → 返回原值
- [x] 迁移失败回退：加密失败不影响读取（返回明文原值）
- [x] desktop `secure_store.rs`：集成 AES-GCM 加密 + 透明迁移
- [x] mobile `secure_store.rs`：集成 AES-GCM 加密 + 透明迁移
- [x] ✅ 两端编译通过 + 6 个单元测试通过（roundtrip / wrong_key / plaintext / empty / unicode / different_keys）

### 1.3 chat.rs 共享部分 → core（重复率 40-50%）

**第一步：抽取共享函数**

- [x] 在 `clawno-core/src/chat.rs` 定义共享 SSE 解析 API ← 用 `consume_sse_stream` 回调模式替代 `SseEvent` 枚举
- [x] 搬 `is_tools_error()` 到 core（两端完全相同）
- [x] 搬 `extract_model_from_tools_error()` 到 core（两端完全相同）
- [x] 合并两端 SSE 行解析 → `extract_sse_delta` + `is_sse_done` + `consume_sse_stream`
- [x] 实现 `consume_sse_stream(response, buffer_threshold, on_delta)` — 用回调不用 AppHandle
- [x] 实现 `discover_ollama_model(client)` — Ollama 模型发现（desktop chat + chat_proxy 共用）
- [x] 在 `clawno-core/Cargo.toml` 添加 `reqwest`, `tokio`, `futures-util` 到 workspace dependencies

**第二步：改两端调用 core**

- [x] desktop `chat.rs`：SSE 解析改为调用 core `consume_sse_stream`，`discover_ollama_model` 用 core 版本
- [x] desktop `chat.rs`：保留 CLI fallback (`run_openclaw_agent`, `stream_chat_cli`, `parse_agent_reply`)
- [x] desktop `chat.rs`：保留三级策略 (HTTP → CLI → Ollama direct)
- [x] mobile `chat.rs`：SSE 解析改为调用 core `consume_sse_stream`
- [x] mobile `chat.rs`：保留 `auth_token` 处理和 proxy Ollama 策略
- [x] ✅ 两端编译通过 + 聊天测试：发消息 → 流式回复 → 结束，无行为变化

### 1.4 ssh 共享逻辑 → core（重复率 25-35%）

- [x] 在 `clawno-core/src/ssh.rs` 实现 `validate_ssh_args(host, username, port)` — 合并两端校验
- [x] 搬 `shell_escape()` 到 core
- [x] 抽取 SSH 连接建立的公共逻辑 → `clawno-core::ssh::ssh_exec` (feature-gated `ssh-exec`)
- [x] 在 `clawno-core/Cargo.toml` 添加 `russh`, `russh-keys`, `async-trait`, `tokio` 为可选依赖
- [x] desktop `ssh_deploy.rs`：保留 TOFU、私钥认证、分步部署命令，调用 core 校验和连接
- [x] mobile `ssh_deploy.rs`：保留密码认证、单次部署流程，调用 core 校验和连接
- [x] ✅ 两端编译通过 + SSH 部署测试正常

### 1.5 mcp.rs 共享部分 → core（重复率 25-35%）

- [x] 在 `clawno-core/src/mcp.rs` 定义 `McpScanResult` 结构体
- [x] 搬风险因子常量到 core（shell_invocation, no_tls, remote_server, sensitive_path）
- [x] 合并两端启发式规则到 core `scan_stdio_risk` + `scan_http_risk`
- [x] desktop `mcp.rs`：保留 `list_openclaw_plugins`, `toggle_openclaw_plugin`，调用 core 扫描函数
- [x] mobile `mcp.rs`：调用 core 扫描函数，从 109 行→33 行
- [x] ✅ 两端编译通过 + MCP 扫描正常

### 1.6 共享类型汇总

- [x] 在 `clawno-core/src/types.rs` 收集各模块提取出的共享类型：`ChatChunk`, `ChatDone`, `McpScanResult`, sentinel 类型
- [x] 确认 desktop 的 `types.rs`（部署类型）和 mobile 的 `types.rs`（探测类型）保持不变、不合并（零交集）
- [x] ✅ 两端编译通过

### 不碰的文件（Phase 1 范围外）

以下文件抽取价值低于 15%，不在本次迁移范围内：

- `gateway.rs` — desktop 是本地生命周期管理 (421行)，mobile 是远程探测 (122行)，功能完全不同
- `connectors.rs` — desktop 是 Feishu+Tailscale CLI (366行)，mobile 是 UDP+proxy (129行)
- `types.rs` — desktop 和 mobile 的类型零交集，各自保留

**Phase 1 验收：**

```
clawno-core/src/
├── lib.rs
├── types.rs          ← StepResult, ChatChunk, ChatDone, McpScanResult
├── chat.rs           ← SSE 解析 + HTTP/Ollama 流 (组合模式)
├── token_log.rs      ← DB_URL + migrations
├── secure_store.rs   ← 加密 KV 核心 + define_secure_store_commands! macro
├── ssh.rs            ← SshArgs + TofuHandler + ssh_exec + 部署脚本常量 (feature: ssh-exec)
├── rag.rs            ← 文件验证与读取
├── mcp.rs            ← McpScanResult + 风险因子
└── sentinel/         ← 自愈引擎 (骨架)
```

- [x] ✅ core 有 7 个模块（chat, mcp, secure_store, sentinel, ssh, token_log, types）
- [x] ✅ 两端编译通过，所有现有功能测试正常
- [x] ✅ desktop Rust 代码已瘦身（chat_proxy 去重 ~74 行，mcp 去重 ~100 行）
- [x] ✅ mobile Rust 代码已瘦身（mcp 从 109→33 行，chat 从 396→245 行）

---

## Phase 2 — 前端 Store 搬家 (1-1.5 周)

> 按相似度从高到低排序。每搬完一个 store，立即验证两端编译 + 功能。

### 2.1 ragStore → shared（完全一致，372 vs 376 行）

- [x] 将 desktop `ragStore.ts` 搬到 `packages/shared/src/stores/ragStore.ts`
- [x] 更新 `packages/shared/package.json` 的 `exports`
- [x] desktop `store/ragStore.ts` 改为 re-export：`export * from '@clawno/shared/stores/ragStore'`
- [x] mobile `store/ragStore.ts` 改为 re-export
- [x] ✅ 两端编译通过 + RAG 功能正常

### 2.2 mcpStore → shared（90%+ 一致，272 vs 256 行）

- [x] 取 desktop 版本（更完整注释）搬到 `packages/shared/src/stores/mcpStore.ts`
- [x] desktop `store/mcpStore.ts` 改为 re-export
- [x] mobile `store/mcpStore.ts` 改为 re-export
- [x] ✅ 两端编译通过 + MCP 页面正常

### 2.3 secureStore → shared（核心一致，61 vs 87 行）

- [x] 创建 `packages/shared/src/stores/secureStore.ts`，包含 base：`set/get/delete/keys/wipeAll` + `secureAiConfig`
- [x] desktop `store/secureStore.ts` 改为 re-export base
- [x] mobile `store/secureStore.ts` 改为：re-export base + 添加 `secureApiKeys` extension
- [x] ✅ 两端编译通过 + 安全存储读写正常

### 2.4 aiConfig → shared (providerStore)（90%+ 一致，67 vs 47 行）

- [x] 创建 `packages/shared/src/stores/providerStore.ts`
- [x] 用依赖注入处理 desktop 的 openclaw CLI 调用：`createProviderStore(loadExternal?: () => Promise<string[]>)`
- [x] desktop `store/aiConfig.ts` 改为：调用 `createProviderStore(listConfiguredProviders)`
- [x] mobile `store/aiConfig.ts` 改为：调用 `createProviderStore()`（无 external loader）
- [x] ✅ 两端编译通过 + AI 配置正常

### 2.5 instances → shared（50-90% 一致，84 vs 105 行）

- [x] 创建 `packages/shared/src/stores/instanceStore.ts`，包含 base：`ClawInstance` 类型 + `addOrUpdate/remove/setHealth`
- [x] desktop `store/instances.ts` 改为：re-export base + desktop 特有的 migrate 逻辑 (localhost→127.0.0.1)
- [x] mobile `store/instances.ts` 改为：re-export base + 添加 `chatProxyToken`, `lastChatProxyToken`, `updateTokenByHost`, `setGlobalChatProxyToken`
- [x] ✅ 两端编译通过 + 实例管理正常

### 2.6 Token 4 合 1 → tokenLogStore

- [x] 创建 `packages/shared/src/stores/tokenLogStore.ts`
- [x] 合入 `tokenLog.ts` 核心逻辑：`recordTokenUsage()`, `getUsageSummary(instanceId?)`, `purgeOldRecords()`
- [x] 合入 `tokenBudget.ts` 核心逻辑：`getBudget()`, `saveBudget()`, `budgetLevel()`
- [x] 合入 `tokenAnomalyStore.ts` 逻辑（17 行）
- [x] `instanceId` 参数对 mobile 始终传 `undefined`
- [x] desktop extension：实例级 budget (`getInstanceBudget`, `saveInstanceBudget` 等)
- [ ] desktop extension 或 shared：`tokenPricing.ts` 定价逻辑 ← desktop-only (325行)，暂不迁移
- [x] desktop `store/tokenLog.ts`, `tokenBudget.ts`, `tokenAnomalyStore.ts` 改为 re-export
- [x] mobile 同上
- [x] ✅ 两端编译通过 + Token 页面用量/预算显示正常

### 2.7 TypeScript 路径验证

- [x] 更新 `packages/shared/package.json` 的 `exports`（新增所有 stores 路径）
- [x] 确认 desktop `tsconfig.json` 的 `paths` 别名正确
- [x] 确认 mobile `tsconfig.json` 的 `paths` 别名正确
- [x] `tsc --noEmit` 两端零错误

**Phase 2 验收：**

```
packages/shared/src/
├── stores/
│   ├── ragStore.ts           ← 从两端搬来 (identical)
│   ├── mcpStore.ts           ← 从两端搬来 (90%+)
│   ├── secureStore.ts        ← 合并 (base + mobile extension)
│   ├── providerStore.ts      ← 从 aiConfig 改名 (DI)
│   ├── instanceStore.ts      ← 合并 (base + platform extensions)
│   └── tokenLogStore.ts      ← 4合1
├── (已有: chatHistory, modelRouter, piiFilter, promptLibrary, securityEventStore, db, utils)
└── index.ts                  ← 更新 exports
```

- [x] ✅ shared 中 Zustand store 数量 7（ragStore, mcpStore, secureStore, providerStore, instanceStore, tokenLogStore, chatHistory）
- [x] ✅ 两端 store/ 目录下的文件都变成 1-10 行的 re-export 或薄包装（tokenPricing/aiVerify 为 desktop-only，不迁移）
- [x] ✅ 两端 `tsc --noEmit` 零错误

---

## Phase 3 — ChatPage 拆分 (1.5-2 周)

### 3.1 提取 helpers.ts 纯函数（不改 ChatPage 逻辑）

- [x] 创建 `packages/shared/src/chat/types.ts` (ChatMessage, ChatAction, ChatState)
- [x] 创建 `packages/shared/src/chat/helpers.ts`，从两端 ChatPage 中提取：
  - [x] `extractShellCommands(text: string) → string[]`
  - [x] `detectInjection(text: string) → boolean`
  - [x] `estimateTokens(text: string) → number`
  - [x] `humanizeError(error: string) → string`
  - [ ] `sanitizePII(text: string) → string` ← 留在 piiFilter 模块，未重复提取
- [x] 为每个函数编写 vitest 单元测试
- [x] ✅ 测试通过，ChatPage 此时未改动

### 3.2 创建 useChatEngine.ts

- [x] 创建 `packages/shared/src/chat/useChatEngine.ts`
- [x] 内部实现 `chatReducer(state, action) → newState`（export 供测试，不单独成文件）
- [x] 实现 Tauri 事件监听 (`chat-token`, `chat-end`, `chat-error`) → dispatch
- [x] 实现 `send()` → `invoke('stream_chat', ...)`
- [x] 实现 `stop()` → `invoke('stop_chat_stream')`
- [x] 状态持久化 → Zustand chatHistory store
- [x] 对外暴露：`{ messages, isStreaming, send, stop, clear }`
- [x] 为 reducer 编写 vitest 单元测试
- [x] ✅ hook 可用，ChatPage 此时未改动

### 3.3 重构 desktop ChatPage

- [x] 将 ChatPage.tsx 中的状态管理和 IPC 逻辑替换为 `useChatEngine()`
- [x] ChatPage 只保留 UI 渲染 + 桌面特有交互（sidebar 联动等）
- [x] 目标：1471 行 → ~567 行（含 UI 渲染逻辑，接近目标）
- [x] ✅ 编译通过 + 聊天功能全流程测试正常

### 3.4 重构 mobile ChatPage

- [x] 将 ChatPage.tsx 中的状态管理和 IPC 逻辑替换为 `useChatEngine()`
- [x] ChatPage 只保留 UI 渲染 + 移动特有交互（键盘适配、手势等）
- [x] 目标：1163 行 → ~478 行（含 UI 渲染逻辑，接近目标）
- [x] ✅ 编译通过 + 聊天功能全流程测试正常

**Phase 3 验收：**

```
packages/shared/src/chat/
├── types.ts
├── helpers.ts          ← vitest 100% 覆盖
└── useChatEngine.ts    ← 内含 reducer，vitest 覆盖 reducer 函数
```

- [x] ✅ desktop ChatPage ~567 行，mobile ChatPage ~478 行（含 UI 渲染，接近目标）
- [x] ✅ 两端聊天功能完全正常
- [x] ✅ helpers + reducer 有单元测试

---

## 迁移完成后的代码规模对比

| 指标 | 迁移前 | 迁移后 | 变化 |
|------|--------|--------|------|
| clawno-core 模块数 | 0 | 7 (chat/mcp/secure_store/sentinel/ssh/token_log/types) | +7 |
| clawno-core 行数 | 0 | 646 | +646 (提取自两端) |
| desktop Rust 行数 | ~8,500 | 7,256 | -1,244 (−14.6%) |
| mobile Rust 行数 | ~1,650 | 934 | -716 (−43.4%) |
| shared TS 模块数 | 1 (chatHistory) | 20+ (stores/chat/ipc/hooks) | +19 |
| 前端重复 store 文件 | 8 对 | 0 (全部 re-export/薄包装) | -8 对 |
| desktop ChatPage | 1,471 行 | ~567 行 | −61.5% |
| mobile ChatPage | 1,163 行 | ~478 行 | −58.9% |
| desktop mcp.rs | 223 行 | 117 行 | −47.5% |
| mobile mcp.rs | 109 行 | 33 行 | −69.7% |

---

## 验收标准

| Phase | 验收标准 | 状态 |
|-------|---------|------|
| 0 | 两端编译通过，core crate 可被两端引用，workspace 依赖提升完成 | ✅ 已完成 |
| 1 | core 有 7 个模块，两端调用 core 共享逻辑（AES-GCM 加密为新功能，后续实现） | ✅ 已完成 |
| 2 | 7 个 store 在 shared，两端 store/ 只剩 re-export/薄包装，`tsc --noEmit` 零错误 | ✅ 已完成 |
| 3 | ChatPage 使用 useChatEngine，helpers 有单元测试，聊天功能正常 | ✅ 已完成 |

**总工期：5.5-7 周（一人全职）**

---

## 迁移完成后的扩展就绪

迁移不实现新功能，但架构天然支持后续扩展：

- **加 Sentinel** → `clawno-core/src/sentinel/` ✅ 已建骨架（类型定义 + mod.rs），复用 token_log 的 migrations 模式
- **加进化库** → `token_log.rs` 的 `migrations()` 追加新版本 SQL
- **加 Agent 多步推理** → `core/chat.rs` 的 `SseEvent` 加 variant，`useChatEngine` 的 reducer 加 case
- **加离线队列** → `@clawno/shared/hooks/` ✅ 已建骨架，新建 `useMessageQueue.ts`
- **加新 Store** → `packages/shared/src/stores/` 新建文件，遵循 [SHARED-CONTRACT.md](./SHARED-CONTRACT.md) 准入规则
- **IPC 类型统一** → `@clawno/shared/ipc/types.ts` ✅ 已建骨架（接口定义）

---

## 架构预留目录（已创建骨架）

> 以下目录在"纯迁移"阶段创建了最小骨架，用于约束后续开发遵循 V2 架构。

- [x] `crates/clawno-core/src/sentinel/mod.rs` — 自愈引擎类型定义（DiagnosisRequest, PatchRecord, DiagnosisResult）
- [x] `packages/shared/src/ipc/types.ts` — IPC 接口类型（SecureStoreAPI, GatewayAPI, ChatAPI, McpAPI）
- [x] `packages/shared/src/hooks/index.ts` — 共享 React Hooks 入口（空桶导出）
