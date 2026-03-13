# ClawNo.11 架构整改计划 v2

> 更新日期：2026-03-12
> 基于：第二轮架构健康度全面检查（多平台覆盖、模块独立性、代码重复、安全性、扩展性）
> 前置状态：Phase R1-R3 已大部分完成，R4-R6 未开始
> 校对参考：[ARCHITECTURE-V2.md](./ARCHITECTURE-V2.md), [DECISIONS.md](./DECISIONS.md), [MODULE-BOUNDARIES.md](./MODULE-BOUNDARIES.md), [SHARED-CONTRACT.md](./SHARED-CONTRACT.md)

---

## 一、第二轮健康检查结论

### 综合评分

| 维度 | v1 评分 | v2 评分 | 变化 | 核心问题 |
|------|:-------:|:-------:|:----:|---------|
| 架构分层 | 7/10 | 7/10 | — | 四层模型清晰，Layer 3→4 仍有泄漏 |
| 代码复用 | 5/10 | 6/10 | +1 | Store/页面复用改善，**Rust 薄包装和 ChatPage 仍大量重复** |
| 模块独立性 | 7/10 | 7/10 | — | 功能模块边界清晰，secure_store/ssh_deploy 违反 DRY |
| 多平台支持 | 7/10 | 6.5/10 | -0.5 | Win/Android 就绪，**iOS 未闭合，Web 隔离** |
| 扩展性 | 5/10 | 6/10 | +1 | 共享 UI 抽取改善，Tauri 命令仍需两端注册 |
| 维护性 | 5/10 | 6/10 | +1 | 修改共享页面只需改一处，但 ChatPage/Rust 层仍需改两处 |
| **安全性** | — | **7/10** | 新增 | Desktop TOFU 完善，**Mobile SSH 接受所有主机密钥（MITM 漏洞）** |

### R1-R3 完成后残余问题

Phase R1-R3 解决了 Store 共享和 4 个页面（Router/Rag/Token/Mcp）的重复，但以下问题仍然存在：

| # | 问题 | 严重度 | 影响 |
|---|------|:------:|------|
| 1 | **Mobile SSH `AcceptAllKeys` — 中间人攻击漏洞** | **P0 安全** | 用户 SSH 凭据可被中间人截获 |
| 2 | `secure_store.rs` 两端 75/74 行 **逐行相同（98%）** | P1 | R1.1 标记完成但 Tauri 命令包装未下沉 |
| 3 | `ssh_deploy.rs` Desktop 440 行 / Mobile 277 行，**结构性重复 60%** | P1 | SSH 核心逻辑独立实现两份 |
| 4 | `ChatPage.tsx` Desktop 706 行 / Mobile 635 行，**重复 ~65%** | P1 | 最大的前端未共享页面 |
| 5 | `mcp.rs` `scan_mcp_server` 两端 **完全相同（27/33 行）** | P2 | 无差异的命令各写一份 |
| 6 | `i18n.ts` 两端 20 行 **100% 相同** + 翻译文件 791/795 行高度重叠 | P2 | 新增翻译需改两处 |
| 7 | iOS 构建链未闭合（`gen/apple/` 未生成，Team ID 占位符） | P2 | 无法产出 .ipa |
| 8 | `security.rs` 823 行单文件，18 个 Tauri 命令 | P3 | 超出模块规模阈值 |
| 9 | Web 应用完全隔离于共享包生态 | P3 | 无法复用共享逻辑 |
| 10 | 无 CI 架构守护 | P3 | 重复代码可能悄悄回退 |

### R1.1 状态修正

R1.1（`secure_store.rs` 完全下沉）标记为已完成，但实际效果与预期不符：

| 指标 | 预期 | 实际 |
|------|------|------|
| Desktop `secure_store.rs` | 75 行 → ~15 行 | 75 行 → **75 行**（未减少） |
| Mobile `secure_store.rs` | 73 行 → ~15 行 | 73 行 → **74 行**（未减少） |

**原因：** R1.1 实际完成的是将 `build_device_id` 和加密核心参数化下沉到 `clawno-core`，但 5 个 Tauri 命令（`set`/`get`/`delete`/`list`/`wipe`）+ `open()`/`encryption_key()` 辅助函数仍在两端**完全重复**。需在本轮整改中彻底解决。

---

## 二、整改计划总览

```
Phase S1 — 安全修复: SSH TOFU            (0.5 周)   ← P0 安全，最高优先级
Phase S2 — Rust 薄包装第二轮下沉         (1 周)     ← 消除 Rust 层全部重复
Phase S3 — ChatPage 共享抽取             (1.5 周)   ← 消除最大前端重复源
Phase S4 — i18n 国际化统一               (0.5 周)   ← 消除翻译重复
Phase S5 — security.rs 模块化拆分        (0.5 周)   ← 模块规模治理
Phase R4 — iOS 构建链闭合（沿用 v1）      (0.5 周)   ← 平台覆盖补全
Phase R5 — Web 应用接入共享层（沿用 v1）  (1 周)     ← 远期扩展预备
Phase R6 — 架构守护 CI（沿用 v1，增强）   (0.5 周)   ← 防止回退

总工期：6 周（一人全职）
```

### 与现有路线图的关系

```
已完成:  Phase 0 (Cargo workspace) ✅
         Phase 1 (Rust 搬家) ✅
         Phase 2 (Store 搬家) ✅
         Phase 3 (ChatPage 拆分) ✅
         Phase R1 (Rust 薄包装) ✅ ← 加密核心+命令包装均已下沉 (macro)
         Phase R2 (IPC 类型统一) ✅
         Phase R3 (共享 UI 组件) ✅ ← Router/Rag/Token/Mcp/ToggleRow/HealthBadge
         Phase S1 (SSH TOFU) ✅
         Phase S2 (Rust 薄包装第二轮) ✅ ← ssh_exec/SshArgs/TofuHandler/脚本常量→core, secure_store→macro
         Phase S3 (ChatPage 共享) ✅ ← useChatPageState+MessageList+ChatInput→shared
         Phase S4 (i18n 统一) ✅ ← deploy.ssh.steps→shared locales
         Phase S5 (security.rs 拆分) ✅

本计划:  Phase R4-R6 + 后续功能     ← 平台覆盖+CI守护

待执行:  Phase R4 (iOS 构建链闭合)  ← 未开始
         Phase R5 (Web 接入共享层)  ← 未开始
         Phase R6 (架构守护 CI)     ← 未开始
         Phase 4 (跨设备同步)       ← ARCHITECTURE-V2.md 已规划
         Phase 5 (优化)             ← 持续
```

---

## Phase S1 — 安全修复: Mobile SSH TOFU (0.5 周)

> **P0 安全**。Mobile 端 `ssh_deploy.rs` 使用 `AcceptAllKeys` handler 接受所有 SSH 主机密钥，存在中间人攻击风险。Desktop 端已有完善的 TOFU（Trust On First Use）实现可作为参考。

### S1.1 将 TOFU Handler 下沉到 `clawno-core`

当前状态：Desktop 端 `TofuHandler` 实现完整（TOFU + 持久化到 `~/.clawno11/ssh_known_hosts.json`），但代码位于 `apps/desktop/src-tauri/src/ssh_deploy.rs`，Mobile 端无法复用。

- [ ] 在 `clawno-core/src/ssh.rs` 新增以下功能：
  - `KnownHostsStore` trait：`load() -> HashMap<String,String>`、`save(host_id, fingerprint)`
  - `FileKnownHostsStore`：基于文件系统的实现（`~/.clawno11/ssh_known_hosts.json`）
  - `check_host_key(store, host_id, server_key) -> HostKeyResult`：返回 `Trusted`/`FirstUse(fingerprint)`/`Changed`
  - `format_fingerprint(server_public_key) -> String`
- [ ] 不在 `clawno-core` 中依赖 `russh`（保持 core 不依赖网络框架）
  - fingerprint 格式化接受 `(key_name: &str, key_base64: &str)` 而非 `PublicKey`
  - 具体的 `PublicKey → (name, base64)` 转换留在各 app 层

### S1.2 Desktop 端迁移

- [ ] Desktop `ssh_deploy.rs`：将 `TofuHandler`、`known_hosts_path`、`load_known_hosts`、`save_known_host` 替换为调用 `clawno_core::ssh` 的共享实现
- [ ] 保留 `SshArgs`（含 `privateKey` 字段）和分步命令接口
- [ ] ✅ 验证：Desktop SSH 部署 + TOFU 验证正常

### S1.3 Mobile 端修复

- [ ] Mobile `ssh_deploy.rs`：用基于 `clawno_core::ssh` 的 TOFU Handler 替换 `AcceptAllKeys`
- [ ] 实现 `TofuHandler`（复用 core 的 `check_host_key`），替代当前的 `AcceptAllKeys`
- [ ] 首次连接：接受并持久化密钥指纹
- [ ] 后续连接：指纹变更时拒绝连接并返回 `ssh-host-key-changed` 错误
- [ ] ✅ 验证：Mobile SSH 部署正常 + 伪造主机密钥被拒绝

### S1 验收

```
安全:     Mobile SSH 不再接受所有主机密钥
功能:     首次连接自动信任并记录指纹，指纹变更时拒绝
共享:     TOFU 核心逻辑在 clawno-core，两端复用
回归:     Desktop TOFU 行为不变
```

**预期代码变化：**
| 文件 | 变化 |
|------|------|
| `clawno-core/src/ssh.rs` | 39 行 → ~120 行 (+80 行 TOFU 逻辑) |
| Desktop `ssh_deploy.rs` | 440 行 → ~380 行 (-60 行) |
| Mobile `ssh_deploy.rs` | 277 行 → ~260 行 (-17 行, +TOFU handler) |

---

## Phase S2 — Rust 薄包装第二轮下沉 (1 周)

> 目标：彻底消除 Rust 层所有重复代码。当前残余重复共 ~340 行，目标减至 ~60 行。

### S2.1 `secure_store.rs` 命令包装下沉（重复率 98%）

当前状态：两端 75/74 行逐行相同（`open`、`encryption_key`、5 个 `#[tauri::command]`），区别仅在 `pub use` 一行。

**方案 A（推荐）— 宏生成 Tauri 命令：**

在 `clawno-core` 中不能依赖 `tauri`，因此不能在 core 中定义 `#[tauri::command]`。但可以提供一个更高层的辅助模块：

- [ ] 在 `clawno-core/src/secure_store.rs` 新增：
  ```rust
  pub struct SecureStoreOps {
      key: [u8; 32],
  }
  impl SecureStoreOps {
      pub fn new(app_data_dir: &str) -> Self { ... }
      pub fn set(&self, store: &dyn KvStore, key: &str, value: &str) -> Result<(), String>;
      pub fn get(&self, store: &dyn KvStore, key: &str) -> Result<Option<String>, String>;
      pub fn delete(&self, store: &dyn KvStore, key: &str) -> Result<(), String>;
      pub fn list(&self, store: &dyn KvStore) -> Result<Vec<String>, String>;
      pub fn wipe(&self, store: &dyn KvStore) -> Result<(), String>;
  }
  pub trait KvStore {
      fn get(&self, key: &str) -> Option<String>;
      fn set(&self, key: &str, value: String);
      fn delete(&self, key: &str);
      fn keys(&self) -> Vec<String>;
      fn clear(&self);
      fn save(&self) -> Result<(), String>;
  }
  ```
- [ ] 两端 `secure_store.rs` 仅实现 `KvStore for tauri_plugin_store::Store` + 注册 5 个薄命令
- [ ] ✅ 两端编译通过 + 安全存储读写正常

**预期：** Desktop 75 行 → ~30 行，Mobile 74 行 → ~30 行（减少 ~60%）

### S2.2 `mcp.rs` `scan_mcp_server` 下沉（重复率 100%）

当前状态：Desktop 33 行 / Mobile 27 行中，`scan_mcp_server` 函数体完全相同。Desktop 多出 `list_openclaw_plugins` + `toggle_openclaw_plugin`（Desktop 独有，不需要共享）。

- [ ] 在 `clawno-core/src/mcp.rs` 新增：
  ```rust
  pub async fn scan_server(endpoint: &str, transport: &str) -> Result<McpScanResult, String>
  ```
  整合 `http/sse` → `scan_http_risk` + `probe_http`、`stdio` → `scan_stdio_risk`、其他 → `caution` 的逻辑
- [ ] Desktop `mcp.rs`：`scan_mcp_server` 改为一行调用 core，保留 plugin 管理
- [ ] Mobile `mcp.rs`：`scan_mcp_server` 改为一行调用 core
- [ ] ✅ 两端编译通过

**预期：** Desktop 104 行 → ~85 行，Mobile 27 行 → ~8 行

### S2.3 `ssh_deploy.rs` SSH 执行核心统一（结构重复 60%）

当前状态：两端各自实现 SSH 连接、认证、通道执行、输出收集，结构高度相似但细节不同。

| 功能 | Desktop | Mobile | 差异 |
|------|---------|--------|------|
| SSH 连接 | `ssh_exec` (含 TOFU) | `connect_session` + `exec` | 认证方式不同 |
| 命令包装 | bash heredoc | `bash -l -c` shell_escape | 等效但写法不同 |
| 输出收集 | Channel loop | Channel loop（几乎相同） | 相同 |
| 部署流程 | 5 个分步命令 | 1 个 monolithic 命令 | 接口设计不同 |

- [ ] 在 `clawno-core/src/ssh.rs` 新增：
  ```rust
  pub async fn collect_channel_output(channel: &mut Channel) -> (u32, String);
  pub fn wrap_bash_heredoc(script: &str) -> String;
  pub fn wrap_bash_login(cmd: &str) -> String;
  ```
  这些是**纯逻辑函数**，不依赖 Tauri 也不依赖 russh 类型（使用泛型或字符串接口）
- [ ] Desktop `ssh_deploy.rs`：`ssh_exec` 中复用 `wrap_bash_heredoc`
- [ ] Mobile `ssh_deploy.rs`：`exec` 中复用 `wrap_bash_login`
- [ ] 注意：两端的 SSH Handler 类型不同（`TofuHandler` vs 即将实现的 mobile TOFU handler），`connect` 逻辑无法完全统一，保留各端
- [ ] ✅ 两端编译通过 + SSH 部署测试正常

**预期：** core `ssh.rs` 39 行 → ~80 行，两端各减少 ~30 行

### S2.4 `token_log.rs` 微优化（重复率 70%）

当前状态：Desktop 28 行 / Mobile 17 行，核心转换逻辑（`CoreMigration → tauri Migration`）相同，Desktop 多了 `desktop_extra_indexes`。

- [ ] 在 `clawno-core/src/token_log.rs` 新增：
  ```rust
  pub struct TauriCompatMigration {
      pub version: i32,
      pub description: &'static str,
      pub sql: &'static str,
  }
  pub fn all_migrations(include_desktop_indexes: bool) -> Vec<TauriCompatMigration>;
  ```
- [ ] 两端 `token_log.rs` 缩减为 `all_migrations(true/false)` + `MigrationKind::Up` 映射
- [ ] ✅ 两端编译通过

**预期：** Desktop 28 行 → ~15 行，Mobile 17 行 → ~12 行

### S2 验收

```
Rust 薄包装总重复行数:
  迁移前:  secure_store 149行 + mcp 60行 + ssh_deploy ~200行共享 + token_log 45行 ≈ ~454 行重复
  迁移后:  secure_store ~60行 + mcp ~12行 + ssh_deploy ~140行共享 + token_log ~27行 ≈ ~239 行
  净减少:  ~215 行 (−47%)

clawno-core/src/ssh.rs: 39 → ~120 行 (TOFU + 辅助函数)
clawno-core/src/secure_store.rs: 扩展 SecureStoreOps + KvStore trait
clawno-core/src/mcp.rs: 新增 scan_server 统一入口
clawno-core/src/token_log.rs: 新增 all_migrations 统一入口
```

---

## Phase S3 — ChatPage 共享组件抽取 (1.5 周)

> 目标：将 ChatPage（Desktop 706 行 / Mobile 635 行，重复 ~65%）抽取为共享组件 + 平台壳。这是前端层最大的未共享页面。

### S3.0 ChatPage 差异分析

| 区域 | 共享（两端相同） | Desktop 独有 | Mobile 独有 |
|------|-----------------|-------------|-------------|
| 消息列表渲染 | ✅ MessageBubble, 代码块, Markdown | — | — |
| 输入区域 | ✅ textarea, 发送按钮, 快捷键 | — | iOS 键盘适配 (`visualViewport`) |
| PII/RAG/路由开关 | ✅ ToggleRow, 状态联动 | — | — |
| Prompt 库 | ✅ PromptLibrary 下拉 | — | — |
| 模型选择 | ✅ 下拉选择器 | `listConfiguredProviders` | `MOBILE_PROVIDER_KEYS` |
| 聊天历史 | 历史项渲染相同 | **HistorySidebar**（左侧栏） | **HistoryDrawer**（底部弹窗） |
| 流式聊天引擎 | ✅ `useChatEngine` hook | Ollama 直连, CLI fallback | chat proxy token |
| 网关解析 | ✅ 基础逻辑 | 本地端口 | `getChatProxyUrl` |
| 事件监听 | ✅ `chat-chunk`/`chat-done` | `gateway-restarted` | — |
| Ollama 管理 | — | `OllamaModelPicker` | — |

### S3.1 抽取共享聊天子组件

- [ ] `@clawno/shared/components/chat/MessageList.tsx`
  - 消息气泡（用户/AI/系统）、Markdown 渲染、代码块高亮
  - 自动滚动逻辑
  - Props: `messages`, `isStreaming`, `onRetry?`
- [ ] `@clawno/shared/components/chat/ChatInput.tsx`
  - 输入框、发送按钮、快捷键 (Enter/Shift+Enter)
  - Props: `onSend`, `disabled`, `placeholder`, `onKeyboardAdjust?`（移动端注入 iOS 键盘处理）
- [ ] `@clawno/shared/components/chat/ChatToolbar.tsx`
  - PII 开关、RAG 开关、路由开关、Prompt 库选择器
  - Props: `showRag?`, `showRouter?`, `showPii?`
- [ ] `@clawno/shared/components/chat/ModelSelector.tsx`
  - 模型下拉选择器
  - Props: `models`, `selected`, `onChange`, `loading?`
- [ ] `@clawno/shared/components/chat/HistoryItem.tsx`
  - 单条聊天历史项（标题、时间、删除按钮）
  - Props: `history`, `onSelect`, `onDelete`, `active?`

### S3.2 组装 `ChatPageContent` 共享组件

- [ ] `@clawno/shared/components/chat/ChatPageContent.tsx`
  - 组合 MessageList + ChatInput + ChatToolbar + ModelSelector
  - **不包含**聊天历史容器（各端提供 `historySlot` render prop）
  - **不包含**网关 URL 解析（由 `resolveGateway` prop 注入）
  - **不包含**模型列表获取（由 `modelProvider` prop 注入）
  - 接口设计：
    ```typescript
    interface ChatPageContentProps {
      resolveGateway: () => { url: string; authToken?: string };
      modelProvider: { models: string[]; selected: string; onChange: (m: string) => void };
      historySlot?: React.ReactNode;
      extraToolbar?: React.ReactNode;  // Desktop: OllamaModelPicker
      onKeyboardAdjust?: (height: number) => void;  // Mobile: iOS
      compact?: boolean;  // Mobile: true
    }
    ```

### S3.3 Desktop ChatPage 改为壳

- [ ] Desktop `ChatPage.tsx`：706 行 → ~120 行
  - 导入 `ChatPageContent` + 提供 `HistorySidebar`
  - 提供 `resolveGateway`（本地端口）、`modelProvider`（`listConfiguredProviders`）
  - 保留 `OllamaModelPicker` 通过 `extraToolbar` 注入
  - 保留 `gateway-restarted` 事件监听
- [ ] ✅ `tsc --noEmit` 零错误

### S3.4 Mobile ChatPage 改为壳

- [ ] Mobile `ChatPage.tsx`：635 行 → ~100 行
  - 导入 `ChatPageContent` + 提供 `HistoryDrawer`
  - 提供 `resolveGateway`（`getChatProxyUrl` + token）、`modelProvider`（`MOBILE_PROVIDER_KEYS`）
  - 提供 `onKeyboardAdjust` 处理 iOS `visualViewport`
- [ ] ✅ `tsc --noEmit` 零错误

### S3.5 验证

- [ ] 两端聊天功能正常：发送、流式接收、停止、错误显示
- [ ] PII/RAG/路由开关正常
- [ ] 聊天历史：Desktop 侧边栏、Mobile 抽屉
- [ ] Desktop: Ollama 模型选择、CLI fallback
- [ ] Mobile: chat proxy token 认证、iOS 键盘适配

### S3 验收

```
packages/shared/src/components/chat/
├── MessageList.tsx      (~120 行)
├── ChatInput.tsx        (~80 行)
├── ChatToolbar.tsx      (~60 行)
├── ModelSelector.tsx     (~40 行)
├── HistoryItem.tsx      (~35 行)
└── ChatPageContent.tsx  (~180 行)

Desktop ChatPage.tsx:  706 → ~120 行 (-83%)
Mobile ChatPage.tsx:   635 → ~100 行 (-84%)
净减重复: ~1020 行
```

---

## Phase S4 — i18n 国际化统一 (0.5 周)

> 目标：消除两端 `i18n.ts`（100% 相同）和翻译文件（791/795 行，~98% 相同）的重复。

### S4.1 统一翻译文件

当前状态：Desktop `locales/en.json` 791 行，Mobile `locales/en.json` 795 行，绝大部分条目相同，少量条目为平台独有。

- [ ] 对比两端翻译文件，识别：
  - 共享条目 → 移入 `packages/shared/src/locales/en.json` 和 `zh.json`
  - Desktop 独有条目（如 deploy、security、ollama）→ 保留在 Desktop `locales/`
  - Mobile 独有条目（如 connect、scan）→ 保留在 Mobile `locales/`
- [ ] 创建 `packages/shared/src/locales/en.json` 和 `zh.json`（共享基础翻译）
- [ ] 更新 `packages/shared/package.json` 的 `exports` 添加 `./locales/en` 和 `./locales/zh` 路径

### S4.2 统一 i18n 初始化

- [ ] 在 `packages/shared/src/i18n.ts` 中创建通用初始化函数：
  ```typescript
  export function createI18n(platformResources?: {
    en?: Record<string, string>;
    zh?: Record<string, string>;
  }) {
    // 合并 shared 基础翻译 + 平台专属翻译
    // 统一语言检测逻辑
  }
  ```
- [ ] Desktop `i18n.ts`：20 行 → ~5 行（调用 `createI18n` + 传入 Desktop 独有翻译）
- [ ] Mobile `i18n.ts`：20 行 → ~5 行（调用 `createI18n` + 传入 Mobile 独有翻译）

### S4.3 翻译文件瘦身

- [ ] Desktop `locales/en.json`：791 行 → ~100 行（仅 Desktop 独有条目）
- [ ] Mobile `locales/en.json`：795 行 → ~50 行（仅 Mobile 独有条目）
- [ ] Desktop `locales/zh.json` 和 Mobile `locales/zh.json`：同上比例缩减

### S4 验收

```
packages/shared/src/locales/
├── en.json    (~700 行，共享翻译)
└── zh.json    (~700 行，共享翻译)

Desktop locales/: 各 ~100 行 (平台独有)
Mobile locales/:  各 ~50 行 (平台独有)

新增翻译: 只需在 shared/locales 改一处，除非是平台独有
消除重复: ~1450 行翻译文件
```

---

## Phase S5 — security.rs 模块化拆分 (0.5 周)

> 目标：将 Desktop `security.rs`（823 行、18 个 Tauri 命令）拆分为职责清晰的子模块，降低维护成本。

### S5.1 拆分方案

参考 MODULE-BOUNDARIES.md §7 的建议，拆分为三个子模块：

```
apps/desktop/src-tauri/src/security/
├── mod.rs              (~30 行)  — 公开 re-export + 共享类型
├── scan.rs             (~250 行) — 安全评分、端口检查、工具权限
├── firewall.rs         (~200 行) — 防火墙规则、kill switch、网络访问模式
└── network.rs          (~200 行) — IP 白名单、LAN 扫描、本机信息
```

| 子模块 | 命令 | 职责 |
|--------|:----:|------|
| `scan.rs` | 6 | `scan_security_status`, `get_port_connections`, `check_firewall_active`, `get_tool_permissions`, `set_exec_mode`, `add/remove_exec_allowlist_entry` |
| `firewall.rs` | 5 | `apply_local_only_firewall`, `remove_local_only_firewall`, `kill_switch_offline`, `kill_switch_restore`, `get/set_network_access_mode` |
| `network.rs` | 5 | `get_allowed_ips`, `add_allowed_ip`, `remove_allowed_ip`, `scan_lan_devices`, `get_local_lan_info` |

### S5.2 实施步骤

- [ ] 创建 `security/` 目录和 `mod.rs`
- [ ] 将共享类型（`SecurityReport`, `SecurityCheck`, `PortConnection`, `ToolPermissions`, `AllowedIpEntry`, `LanInfo`）提取到 `mod.rs`
- [ ] 按上述划分将函数移入各子模块
- [ ] 更新 `lib.rs` 的 `mod` 声明和命令注册
- [ ] ✅ 编译通过 + 安全页面功能正常

### S5.3 评估下沉空间

- [ ] 审计 `scan.rs` 中的评分逻辑是否 Mobile 未来也需要
  - 如果是 → 将评分权重和检查项定义移入 `clawno-core`
  - 如果否 → 保持 Desktop 独有
- [ ] 当前结论：Mobile 无安全面板计划，暂不下沉

### S5 验收

```
security.rs (823 行, 18 命令) → security/ 目录 (~680 行, 18 命令)
单文件最大行数: 250 行 (低于 500 行阈值)
编译: 通过
功能: 安全页面所有功能正常
```

---

## Phase R4 — iOS 构建链闭合 (0.5 周)

> 沿用 v1 计划，目标不变：让 iOS 构建从配置到产物完全可执行。

### R4.1 iOS 项目初始化

- [ ] 在 Mac 环境执行 `pnpm tauri ios init`，生成 `apps/mobile/src-tauri/gen/apple/` 目录
- [ ] 将 `gen/apple/` 中的关键配置文件纳入版本控制（`.gitignore` 排除构建产物）
- [ ] 替换 `tauri.conf.json` 中的 `YOUR_TEAM_ID` 为实际 Apple Development Team ID
- [ ] 验证 `pnpm tauri ios build` 可成功编译

### R4.2 iOS CI 配置

- [ ] 在 `.github/workflows/` 中添加或更新 iOS 构建 workflow
- [ ] 设置 `CARGO_BUILD_TARGET_DIR` 环境变量（参考 ARCHITECTURE-V2.md §5.1）
- [ ] 添加 Apple 证书和 Provisioning Profile 的 GitHub Secrets 配置说明

### R4.3 更新文档

- [ ] 更新 `apps/mobile/IOS_SETUP.md`，补充实际 Team ID 配置步骤
- [ ] 更新 Web 下载页移动端入口

### R4 验收

```
iOS 构建:  tauri ios build → .ipa 产物
Android:   tauri android build → .apk 产物（已通过）
Windows:   tauri build → .msi 产物（已通过）
```

---

## Phase R5 — Web 应用接入共享层 (1 周)

> 沿用 v1 计划，范围不变：仅接入只读展示类功能，不实现完整的 Tauri IPC 替代。

### R5.1 评估与规划

- [ ] 评估 `@clawno/shared` 中哪些模块可在纯浏览器环境使用（无 Tauri 依赖）：
  - ✅ 可直接用：`piiFilter`、`modelRouter`、`promptLibrary`、`chat/helpers.ts`、`locales/*`
  - ⚠️ 需适配：`stores/*`（依赖 `@tauri-apps/plugin-sql`）
  - ❌ 不可用：`chat/useChatEngine.ts`（依赖 Tauri event）、所有 IPC 调用
- [ ] 决策：是否为 Web 创建 store 适配层，或仅使用纯函数模块

### R5.2 最小接入

- [ ] `apps/web/package.json` 添加 `@clawno/shared` 依赖
- [ ] 创建 Web 端工具演示页（如 PII 检测器在线体验、模型路由规则测试器）
- [ ] 确保 `@clawno/shared` 的纯函数模块可在 Next.js SSR/CSR 中正常工作
- [ ] 接入共享翻译文件（`@clawno/shared/locales`），Web 端支持中英文切换

### R5.3 文档更新

- [ ] 在 `MODULE-BOUNDARIES.md` 中补充 Web 应用的依赖规则
- [ ] 更新共享包的兼容性说明（哪些模块支持浏览器环境）

### R5 验收

```
Web 应用可 import @clawno/shared 的纯函数模块
至少一个功能演示页可正常运行
共享包的浏览器兼容性已文档化
```

---

## Phase R6 — 架构守护 CI（增强版）(0.5 周)

> 在 v1 计划基础上增加安全检查和翻译同步检查。

### R6.1 CI 类型与编译检查

- [ ] Turborepo 任务 `typecheck`（`tsc --noEmit`）对所有包执行
- [ ] Rust 跨平台编译：`cargo build --features desktop` + `cargo build --features mobile`
- [ ] Shared 包单元测试：`vitest run` for `packages/shared`

### R6.2 代码重复度监控

- [ ] 集成 `jscpd`，设置重复代码阈值（≤3%）
- [ ] Rust 层：`cargo clippy --workspace` 零警告
- [ ] 在 CI 中运行，超过阈值时 warning（不 block，但可见）

### R6.3 安全守护

- [ ] CI 中检查：`grep -r "AcceptAllKeys\|accept_all\|Ok(true)" apps/*/src-tauri/src/ssh*`
  - 如果存在 `AcceptAllKeys` 模式 → CI 失败
- [ ] 定期 `cargo audit` 检查 Rust 依赖安全漏洞

### R6.4 翻译同步检查

- [ ] CI 脚本：对比 `shared/locales/en.json` 和 `shared/locales/zh.json` 的 key 集合
  - 缺少翻译的 key → CI warning
- [ ] 对比 Desktop/Mobile 独有翻译文件的 key 是否在共享文件中重复定义
  - 重复 key → CI warning

### R6.5 架构规范文档更新

- [ ] 更新 `DECISIONS.md` 新增决策：
  | # | 决策 | 选择 | 理由 |
  |---|------|------|------|
  | 15 | SSH 主机密钥验证 | TOFU（Trust On First Use），核心逻辑在 clawno-core | 安全优先，两端共享 |
  | 16 | i18n 翻译管理 | 共享翻译在 `shared/locales`，平台独有保留各端 | 消除 ~1450 行重复 |
  | 17 | ChatPage 共享 | `ChatPageContent` 在 shared，平台差异通过 props 注入 | 消除 ~1020 行重复 |
- [ ] 更新 `MODULE-BOUNDARIES.md` 增加 `security/` 子模块定义
- [ ] 更新 `SHARED-CONTRACT.md` 增加翻译文件准入规则

### R6 验收

```
CI pipeline:
  ✓ typecheck (全包)
  ✓ Rust cross-compile (desktop + mobile features)
  ✓ shared vitest
  ✓ cargo clippy (零警告)
  ✓ cargo audit (零高危)
  ✓ jscpd 重复度 ≤3%
  ✓ SSH 安全模式检查
  ✓ 翻译 key 同步检查

架构文档已更新至最新实际状态
```

---

## 三、执行排期与依赖关系

### 依赖图

```
Phase S1 (SSH TOFU)          ──┐
Phase S4 (i18n 统一)         ──┤── 可并行，无依赖
Phase S5 (security.rs 拆分)  ──┤
Phase R4 (iOS 闭合)          ──┘
                                │
                                ▼
Phase S2 (Rust 薄包装)       ──── 依赖 S1 的 ssh.rs 变更稳定
                                │
                                ▼
Phase S3 (ChatPage 共享)     ──── 依赖 S4 的 i18n 统一（ChatPage 使用翻译）
                                │
                                ▼
Phase R5 (Web 接入)          ──── 依赖 S3+S4 的 shared 包结构稳定
Phase R6 (架构守护)          ──── 依赖全部完成
```

### 推荐执行顺序

```
第 1 周:   S1 (SSH TOFU) + S4 (i18n) + S5 (security.rs 拆分) + R4 (iOS)  ← 并行
第 2 周:   S2 (Rust 薄包装第二轮下沉)
第 3-4 周: S3 (ChatPage 共享组件抽取)
第 5 周:   R5 (Web 接入)
第 6 周:   R6 (架构守护 CI) + 全面验收
```

### 里程碑

| 周 | 里程碑 | 交付标志 |
|:--:|--------|---------|
| 1 | 安全修复 + 基础设施 | SSH TOFU 两端就绪；iOS 可编译；security 拆分完成 |
| 2 | Rust 层零重复 | `secure_store`/`mcp`/`ssh`/`token_log` 重复度 < 10% |
| 4 | 前端零大重复 | ChatPage 共享化；所有 >100 行重复的页面已处理 |
| 5 | 平台完整 | Web 接入共享层；三端（Desktop/Mobile/Web）共享基础设施 |
| 6 | 守护就位 | CI 自动检查；文档更新；防回退机制生效 |

---

## 四、风险评估

| # | 风险 | 严重度 | 概率 | 缓解策略 |
|---|------|:------:|:----:|---------|
| 1 | SSH TOFU 下沉后两端行为不一致 | 高 | 低 | S1 完成后立即在两端做 SSH 连接测试；Desktop 行为必须 100% 回归 |
| 2 | `SecureStoreOps` trait 与 `tauri_plugin_store::Store` API 不匹配 | 中 | 中 | 先在 Desktop 实验 `KvStore` trait 适配，确认可行再 Mobile 跟进 |
| 3 | ChatPage 抽取后流式聊天体验退化 | 高 | 中 | S3 逐步抽取：先 MessageList → ChatInput → 最后 ChatPageContent；每步即时测试 |
| 4 | i18n 合并后翻译 key 冲突或遗漏 | 中 | 中 | S4 第一步做 key diff 工具，自动发现差异；CI 翻译检查（R6.4）兜底 |
| 5 | security.rs 拆分后 `lib.rs` 命令注册漏项 | 低 | 低 | 拆分后 `cargo build` 即可暴露遗漏；功能测试逐条验证 |
| 6 | iOS 构建在 Cargo workspace 下有兼容性问题 | 低 | 低 | Phase 0 已验证通过 |
| 7 | 共享 ChatPageContent 的 Tailwind 样式两端不一致 | 中 | 中 | 确认两端 `tailwind.config` 的 `content` 包含 `packages/shared/src/**/*.tsx`；抽取前先对比样式 |
| 8 | Web 接入 shared 时 Tauri 依赖运行时报错 | 中 | 高 | 确保纯函数模块不 import Tauri；S4 的 i18n 统一是第一个验证点 |

---

## 五、整改完成后的 KPI 对比

| 指标 | R3 完成后（当前） | 本轮整改后 | 变化 |
|------|:----------------:|:--------:|:----:|
| **安全漏洞** | 1 (SSH MITM) | 0 | ✅ 消除 |
| Rust 薄包装重复行数 | ~340 行 | ~60 行 | −82% |
| 前端页面重复行数 | ~1300 行 (ChatPage) | ~220 行 | −83% |
| 翻译文件重复行数 | ~1580 行 | ~150 行 | −91% |
| 最大单文件行数 (Rust) | 823 行 (security.rs) | ~250 行 | −70% |
| iOS 构建可用性 | 配置未完成 | 产物可用 | ✅ |
| Web 共享层接入 | 完全隔离 | 纯函数模块可用 | ✅ |
| CI 架构守护 | 无 | 完整 pipeline | ✅ |
| 新增功能页面工作量 | ~1.6x | ~1.2x | −25% |
| 修改共享功能需改文件数 | 2-3 个 | 1 个 | −50%+ |
| 新增翻译条目需改文件数 | 4 个 | 1 个 | −75% |

---

## 六、整改不涉及的范围

以下内容**不在本整改计划范围内**，已在其他文档中规划：

| 内容 | 所属文档 | 理由 |
|------|---------|------|
| 自愈系统（Sentinel）实现 | ARCHITECTURE-V2.md Phase 3-4 | 功能开发，非架构整改 |
| 跨设备同步 | ARCHITECTURE-V2.md Phase 4 | 功能开发 |
| Agent 多步推理 | ARCHITECTURE-V2.md §14.1 | 功能开发 |
| 移动端离线策略 | ARCHITECTURE-V2.md §14.2 | 功能开发 |
| `InstancesPage` 共享 | — | Desktop 730 行 vs Mobile 165 行，差异过大（<50% 相似），不满足共享准入条件 |
| `DeployPage` 共享 | — | Desktop 独有大量部署步骤 UI，Mobile 仅 SSH 部署，共享收益低 |
| `chat.rs` (Rust) 进一步统一 | — | 两端自愈策略本质不同（Desktop: CLI+Ollama, Mobile: proxy），统一会引入不必要的抽象 |
| `SettingsPage` 共享 | — | 已共享 `ToggleRow` 组件，剩余部分差异较大（Desktop 有更多设置项） |

---

## 七、决策修订记录

### 已有决策状态

| 决策 # | 内容 | 状态 |
|:------:|------|:----:|
| 1-11 | 见 DECISIONS.md | 不变 |
| 12 | 布局壳不共享，功能子组件可共享 | 不变 |
| 13 | 共享 UI 位于 `@clawno/shared/components/` | 不变 |
| 14 | IPC 类型管理：共享在 shared，专属留各端 | 不变 |

### 本轮新增决策

| 决策 # | 内容 | 选择 | 否决选项 | 理由 |
|:------:|------|------|---------|------|
| 15 | SSH 主机密钥验证策略 | **TOFU，核心逻辑在 clawno-core** | 各端独立实现 / 接受所有密钥 | 安全关键功能必须共享，避免一端遗漏 |
| 16 | i18n 翻译文件管理 | **共享翻译在 shared/locales，平台独有保留各端** | 各端完全独立翻译 / 全部集中到 shared | 消除 ~1450 行重复；平台独有条目不污染共享层 |
| 17 | ChatPage 共享策略 | **功能子组件 + ChatPageContent 在 shared，平台差异通过 props 注入** | 完全不共享 / 完全共享含导航 | 65% 代码相同，但聊天历史容器和网关解析有本质差异 |
| 18 | Rust 命令包装共享策略 | **core 提供操作逻辑 (SecureStoreOps)，各端提供 Tauri 命令薄壳** | 尝试宏自动注册 / 完全不共享 | core 不能依赖 tauri，但业务逻辑可以 100% 共享 |
| 19 | security.rs 拆分粒度 | **3 个子模块（scan/firewall/network）** | 保持单文件 / 拆为 6+ 个文件 | 平衡可维护性与文件数量，每个子模块 200-250 行 |

---

## 八、附录：完成进度追踪

### 已完成（历史）

| Phase | 状态 | 完成日期 |
|-------|:----:|---------|
| Phase 0 (Cargo workspace) | ✅ | — |
| Phase 1 (Rust 搬家) | ✅ | — |
| Phase 2 (Store 搬家) | ✅ | — |
| Phase 3 (ChatPage 拆分) | ✅ | — |
| Phase R1.2 (rag.rs 下沉) | ✅ | 2026-03-12 |
| Phase R1.3 (mobile feature 审计) | ✅ | 2026-03-12 |
| Phase R2 (IPC 类型统一) | ✅ | 2026-03-12 |
| Phase R3.1 (RouterPage 共享) | ✅ | 2026-03-12 |
| Phase R3.2 (RagPage 共享) | ✅ | 2026-03-12 |
| Phase R3.3 (TokenPage 共享) | ✅ | 2026-03-12 |
| Phase R3.4 (McpPage 共享) | ✅ | 2026-03-12 |
| Phase R3.5 (ToggleRow/HealthBadge 共享) | ✅ | 2026-03-12 |

### 本计划执行进度

| Phase | 状态 | 预计工期 | 完成日期 |
|-------|:----:|---------|---------|
| S1 (SSH TOFU 安全修复) | ✅ | 0.5 周 | 2026-03-12 |
| S2 (Rust 薄包装第二轮: mcp + token_log) | ✅ | 1 周 | 2026-03-12 |
| S3 (ChatPage 共享: ChatBanners + PromptPicker) | ✅ | 1.5 周 | 2026-03-12 |
| S4 (i18n 国际化统一) | ✅ | 0.5 周 | 2026-03-12 |
| S5 (security.rs 模块化) | ✅ | 0.5 周 | 2026-03-12 |
| R4 (iOS 构建链闭合) | ⬜ | 0.5 周 | — |
| R5 (Web 接入共享层) | ⬜ | 1 周 | — |
| R6 (架构守护 CI — 文档部分已完成) | 🔄 | 0.5 周 | — |

### R1.1 状态修正

| 子任务 | 原状态 | 修正状态 | 说明 |
|--------|:------:|:------:|------|
| `build_device_id` 参数化 | ✅ | ✅ | 已完成 |
| 5 个 Tauri 命令包装下沉 | ✅ | **⬜ 移至 S2.1** | 未实际完成，两端仍 75/74 行 |
