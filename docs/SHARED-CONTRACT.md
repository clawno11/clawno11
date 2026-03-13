# ClawNo.11 共享层契约

> 本文档定义 `clawno-core` (Rust) 和 `@clawno/shared` (TypeScript) 的准入规则、API 契约和质量标准。
> 共享层是架构的承重墙——准入严格，一旦加入就需要长期维护。
> 校对参考：[ARCHITECTURE-V2.md](./ARCHITECTURE-V2.md) §5-§6

---

## 一、clawno-core 准入规则

### 什么代码可以进入 clawno-core？

**必须同时满足以下三个条件：**

```
条件 1: 两个平台 (desktop + mobile) 都需要这段逻辑
条件 2: 逻辑不依赖 tauri::AppHandle、tauri::Emitter、tauri::Manager
条件 3: 逻辑有可测试的输入/输出（不是纯粹的胶水代码）
```

### 准入检查清单

| 检查项 | 通过标准 |
|--------|---------|
| 是否依赖 `tauri` crate？ | 否（`Cargo.toml` 不含 tauri 依赖） |
| 是否需要 `AppHandle` 参数？ | 否（用回调函数代替事件发射） |
| 平台差异是否已用 `#[cfg(feature)]` 隔离？ | 是 |
| 是否有对应的 unit test 或至少可测试的函数签名？ | 是 |
| 文档注释是否说明了函数的输入/输出/错误条件？ | 是 |

### 平台差异处理模式

当同一功能在 desktop 和 mobile 有差异时，按以下优先级选择处理方式：

```
优先级 1: 参数差异 → 函数签名用 Option<T>，核心逻辑不分叉
优先级 2: 行为差异 → #[cfg(feature = "desktop")] 条件编译
优先级 3: 策略差异 → 不进 core，留在各 app 的 src-tauri/ 中用组合模式
```

**示例 — chat.rs 的组合模式：**

```rust
// ✓ 进入 core: 通用的 SSE 解析和 HTTP 流
pub fn parse_sse_line(line: &str) -> Option<SseEvent> { ... }
pub async fn stream_http_sse(url, messages, on_event) -> Result<()> { ... }

// ✗ 不进 core: 桌面特有的 fallback 策略
// 放在 apps/desktop/src-tauri/src/chat.rs
async fn stream_chat(app, ...) {
    if let Err(_) = core::stream_http_sse(...).await {
        if let Err(_) = try_cli_fallback(...).await {
            core::stream_ollama_sse(...).await?;
        }
    }
}
```

---

## 二、@clawno/shared 准入规则

### 什么代码可以进入 @clawno/shared？

**逻辑模块必须同时满足以下两个条件：**

```
条件 1: 两个前端 (desktop + mobile) 都需要这段逻辑
条件 2: 不含平台特有逻辑（通过 props/config 处理差异）
```

**共享 UI 组件（`components/`）必须同时满足以下条件：**

```
条件 1: 在两端使用且相似度 > 70%
条件 2: 不依赖平台特有 API（Sidebar、BottomNav 等布局壳不共享）
条件 3: 通过 props 处理平台差异（如 showTopBar、compact 模式）
条件 4: 必须有完整的 TypeScript 类型定义
```

### 目录结构契约

```
packages/shared/src/
├── stores/                 # Zustand store 定义
│   ├── ragStore.ts               # RAG 文档管理
│   ├── mcpStore.ts               # MCP 服务器管理
│   ├── secureStore.ts            # 安全存储状态
│   ├── providerStore.ts          # AI 提供商配置 (factory 模式)
│   ├── instanceStore.ts          # 实例管理
│   ├── tokenLogStore.ts          # Token 用量 + 预算 + 成本估算
│   └── tokenPricingStore.ts      # Token 定价配置
├── chat/
│   ├── types.ts                  # ChatMessage, ChatAction
│   ├── helpers.ts                # 纯函数 — vitest 覆盖
│   ├── useChatEngine.ts          # 聊天引擎 (reducer + 事件监听 + IPC)
│   └── useChatPageState.ts       # ChatPage 共享状态 + handlers
├── ipc/
│   └── types.ts                  # 共享 IPC 类型 + invoke 函数
├── hooks/
│   ├── index.ts                  # Hook 导出桶
│   └── useKillSwitch.ts          # SSH kill switch 共享 hook
├── components/
│   ├── chat/
│   │   ├── ChatBanners.tsx       # 聊天横幅 (RAG/routing)
│   │   ├── PromptPicker.tsx      # 提示词选择器
│   │   ├── MessageList.tsx       # 消息列表 (气泡/流式)
│   │   └── ChatInput.tsx         # 输入区域 + 工具栏
│   ├── common/
│   │   ├── ToggleRow.tsx         # 开关行
│   │   ├── HealthBadge.tsx       # 健康徽章
│   │   ├── LangSelector.tsx      # 语言选择器
│   │   └── BudgetEditor.tsx      # 预算编辑器
│   ├── mcp/McpPageContent.tsx
│   ├── rag/RagPageContent.tsx
│   ├── router/RouterPageContent.tsx
│   └── token/TokenPageContent.tsx
├── piiFilter.ts                  # PII 检测/脱敏规则
├── modelRouter.ts                # 模型路由规则
├── promptLibrary.ts              # 提示词库
├── chatHistory.ts                # 聊天历史 (SQLite)
├── tokenAnomalyStore.ts          # Token 异常检测
├── securityEventStore.ts         # 安全事件日志
├── i18n.ts                       # 国际化初始化 (createI18n)
├── locales/                      # 基础翻译 (en.json, zh.json)
├── db.ts                         # 数据库工具
├── utils.ts                      # 通用工具 (maskApiKey)
└── index.ts                      # 统一导出
```

### Store 设计契约

**Store 扩展模式（base + platform extensions）：**

```typescript
// @clawno/shared — base store (两个平台都用的部分)
export const createChatStoreBase = (set, get) => ({
  messages: [],
  addMessage: (msg) => set(s => ({ messages: [...s.messages, msg] })),
  clearMessages: () => set({ messages: [] }),
});

// apps/desktop — desktop extension (桌面特有字段)
export const useChatStore = create((set, get) => ({
  ...createChatStoreBase(set, get),
  isProxyMode: false,  // 桌面特有
}));

// apps/mobile — mobile extension (移动特有字段)
export const useChatStore = create((set, get) => ({
  ...createChatStoreBase(set, get),
  chatProxyToken: null,  // 移动特有
}));
```

**Store 字段提升规则：**

当一个字段从"只有一个平台用"变成"两个平台都用"时，立即从 extension 提升到 base。判定标准：第二个平台的 PR 需要使用这个字段时，该 PR 必须同时完成字段提升。

---

## 三、IPC 类型契约

Rust 和 TypeScript 之间通过 Tauri IPC 通信，类型必须两侧对齐。

### IPC 类型准入规则

```
新增 Tauri 命令时：

1. 判断是否两端共用
   ├── 是 → 先在 @clawno/shared/ipc/types.ts 定义接口签名和返回类型
   │        → 各端 ipc.ts 从 shared 导入类型，并实现 invoke 封装
   └── 否 → 直接在该端 ipc.ts 定义本地类型

2. 已有的共享类型和函数（从 @clawno/shared/ipc/types 导入）：
   - 类型: StepResult, SshArgs, ProbeResult, McpScanResult, TailscaleStatus,
           StreamChatParams, ChatChunkEvent, ChatDoneEvent
   - 函数: setSecureValue, getSecureValue, deleteSecureValue, listSecureKeys, wipeSecureStore,
           scanMcpServer, readTextFile, getTailscaleStatus,
           deployRemoteConnect, deployRemoteCheckNode, deployRemoteInstallOpenclaw,
           deployRemoteOnboard, deployRemoteStartGateway

3. 平台专属类型（留在各端 ipc.ts）：
   - Desktop: SecurityReport, ServiceInfo, DeployStatus, OpenClawPlugin, 各 Bot 类型, Ollama 类型
   - Mobile: probeGatewayUrl, fetchChatProxyToken, SSH 管理命令 (sshStopInstance 等)
```

### 对齐规则

```
Rust 端 (types.rs):
  #[derive(Serialize, Deserialize)]
  pub struct SseEvent { ... }

TypeScript 端 (ipc/types.ts):
  export interface SseEvent { ... }

保证方式:
  1. 手动对齐 + PR review checklist 检查
  2. 远期: 引入 ts-rs crate 自动生成 TS 类型
```

### 核心 IPC 接口列表

| 命令名 | 方向 | 参数 | 返回值 | 所属模块 |
|--------|------|------|--------|---------|
| `stream_chat` | FE → Rust | `{messages, model?, system_prompt?}` | void (通过 event 返回) | chat |
| `stop_chat_stream` | FE → Rust | `{}` | void | chat |
| `secure_store_get` | FE → Rust | `{key}` | `string \| null` | secure_store |
| `secure_store_set` | FE → Rust | `{key, value}` | void | secure_store |
| `scan_security` | FE → Rust | `{}` | `SecurityReport` | security |
| `list_mcp_tools` | FE → Rust | `{}` | `McpTool[]` | mcp |

SSE 事件通道（Rust → FE）:

| 事件名 | 载荷 | 说明 |
|--------|------|------|
| `chat-token` | `{ content: string }` | 流式 token |
| `chat-end` | `{}` | 流结束 |
| `chat-error` | `{ error: string }` | 错误 |
| `chat-tool-call` | `{ id, name, arguments }` | 未来参考：Agent 工具调用，不纳入当前实施 |
| `chat-tool-result` | `{ id, result }` | 未来参考：工具返回，不纳入当前实施 |
| `chat-step` | `{ step, description }` | 未来参考：Agent 推理步骤，不纳入当前实施 |

---

## 四、质量门禁

### clawno-core 代码质量标准

| 指标 | 标准 |
|------|------|
| 编译 | `cargo build --features desktop` + `cargo build --features mobile` 均通过 |
| 警告 | `cargo clippy` 零警告 |
| 测试 | 每个公开函数至少一个单元测试 |
| 文档 | 每个 `pub fn` 有 `///` 文档注释 |

### @clawno/shared 代码质量标准

| 指标 | 标准 |
|------|------|
| 类型 | `tsc --noEmit` 零错误 |
| Lint | `eslint` 零错误 |
| 测试 | `helpers.ts` 100% 函数覆盖，`useChatEngine.ts` 内部 reducer 函数有独立测试 |
| 导出 | 所有公开 API 从 `index.ts` 统一导出 |

---

## 五、变更审查清单

当 PR 修改共享层代码时，reviewer 应检查：

```
□ 新增到 core 的代码是否满足三个准入条件？
□ 新增到 shared 的代码是否满足两个准入条件？
□ Rust struct 变更是否同步更新了 ipc/types.ts？
□ 新增 Store 字段放在 base 还是 extension？理由是否合理？
□ 新增公开函数是否有文档注释和测试？
□ feature flag 使用是否正确？（desktop 代码不会编译进 mobile）
□ 是否引入了对 tauri 的直接依赖？（core 禁止）
□ 新增翻译 key 是否放在正确位置？（共享 → shared/locales，平台独有 → apps/*/locales）
□ 新增翻译 key 是否与已有 key 重复？（shared 和 platform 不应有同名 key）
```

### 翻译文件准入规则

| 条件 | 放入 `packages/shared/src/locales/` | 放入 `apps/*/src/locales/` |
|------|:---:|:---:|
| 两端均使用且值相同 | ✅ | ❌ |
| 仅一端使用 | ❌ | ✅ |
| 两端均使用但值不同 | ❌ | ✅ 各端独立 |

**i18n 初始化**：各端调用 `createI18n(platformExtras)` 合并翻译（`{ ...shared, ...platform }` 语义，平台可覆盖）。
