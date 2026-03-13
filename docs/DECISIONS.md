# ClawNo.11 架构决策摘要

> 本文档只包含结论和原则，不包含实现细节。
> 详细技术规格见 [ARCHITECTURE-V2.md](./ARCHITECTURE-V2.md)。
> 生成日期：2026-03-12

---

## 设计原则

1. **共享核心，扩展边缘** — 共同逻辑只写一次，平台差异通过扩展而非复制
2. **编译器保证一致性** — 用 Cargo workspace + TypeScript path 让不同步在编译期暴露
3. **不可变内核** — Rust 编译二进制天然不可被运行时修改，是安全基石
4. **配置驱动行为** — 自愈系统只修改配置/Store，永远不修改编译层代码
5. **MCP 即扩展性** — 通过 MCP 协议实现开放式工具接入，而非内建插件系统
6. **渐进式能力扩展** — 每一层独立可用，上层是下层的增强而非必需

---

## 架构四层模型

| 层级 | 名称 | 内容 | 修改频率 |
|------|------|------|---------|
| Layer 4 | Platform Shell | 各 app 的 UI + Tauri 命令注册 + 平台特有功能 | 高 |
| Layer 3 | Shared Frontend | `@clawno/shared` 所有 store、hooks、helpers | 中 |
| Layer 2 | Rust Core | `clawno-core` 共享 Rust 逻辑 | 低 |
| Layer 1 | Foundation | Cargo workspace、Tauri 2 runtime、SQLite、Tailscale | 极低 |

**依赖方向：只能向下依赖，不能向上依赖。**

---

## 23 条关键决策

| # | 决策 | 选择 | 否决选项 | 一句话理由 |
|---|------|------|---------|-----------|
| 1 | Rust 共享方式 | Cargo workspace + 共享 crate | 代码复制 / git submodule | 编译器保证一致性 |
| 2 | Rust 平台差异 | Feature flags + 组合模式 | 宽泛 trait 抽象 | 避免 trait 抽象泄漏 |
| 3 | 前端平台差异 | Zustand 扩展 + 依赖注入 | 继承 / 单一大 Hook / 三文件分层 | 两文件足够：helpers + hook |
| 4 | 设备间通信 | Tailscale + chat_proxy HTTP | Matrix / 自建 P2P | 已有基础设施，零额外依赖 |
| 5 | 自愈范围 | 仅配置/Store/进程管理 | 包含源代码修改 | Rust 编译型不可热改 |
| 6 | 自愈触发 | pm2 事件 + 手动触发 | 独立监控进程 | pm2 已是进程管理器 |
| 7 | 进化库存储 | SQLite (复用现有) | 独立数据库 | 统一技术栈 |
| 8 | 补丁格式 | config-patch / command-sequence / store-patch | Git Diff | 不改源码，只改配置 |
| 9 | 联邦进化 | 远期规划 | 立即实现 | 用户量不足 |
| 10 | 扩展机制 | MCP 协议 (已有) | 自建插件系统 | MCP 是事实标准 |
| 11 | 自愈工具调用 | 通过 MCP 调用外部工具 | 内置所有诊断能力 | 能力随生态增长 |
| 12 | UI 组件共享 | **布局壳不共享，功能子组件可共享**（相似度 >70% 的子组件抽到 shared/components/） | 统一组件库 | 布局壳差异大，但 RouterPage 95%、RagPage 90% 功能代码完全一致 |
| 13 | 共享 UI 位置 | `@clawno/shared/components/` | 新建 `packages/ui` 独立包 | 复用现有 shared 包基础设施 |
| 14 | IPC 类型管理 | 共享类型在 `shared/ipc/types.ts`，平台专属留各端 | 全部集中到 shared | 平台专属命令不该污染共享层 |
| 15 | SSH 主机密钥验证 | **TOFU（Trust On First Use），核心逻辑在 clawno-core** | 各端独立实现 / 接受所有密钥 | 安全关键功能必须共享，避免一端遗漏造成 MITM 漏洞 |
| 16 | i18n 翻译管理 | **共享翻译在 `shared/locales`，`createI18n` 工厂函数合并** | 各端完全独立翻译 | 消除翻译文件重复，新增条目只改一处 |
| 17 | ChatPage 共享策略 | **useChatPageState hook + MessageList + ChatInput + ChatBanners + PromptPicker** | 完全共享 ChatPageContent | 页面从 ~620行→~300行，平台壳只保留 HistorySidebar/HistoryDrawer 差异 |
| 18 | Rust 命令包装共享 | **core 提供逻辑+macro，各端只调用** — `define_secure_store_commands!` macro + `ssh_exec` feature-gated 函数 | 宏自动注册 | core 不能依赖 tauri，但通过 macro + feature flags 可 100% 共享 |
| 19 | security.rs 拆分粒度 | **3 个子模块（scan/firewall/network）** | 保持单文件 / 拆 6+ 个文件 | 平衡可维护性与文件数量，每个子模块 200-250 行 |
| 20 | SSH 连接共享方式 | **feature-gated `ssh-exec`** — russh/async-trait/tokio 作为 core 可选依赖 | 各端独立实现 / 新建 crate | 两端 ssh_exec 逐字相同 (~113行)，feature gate 保持 core 默认构建轻量 |
| 21 | IPC invoke 函数共享 | **共享 invoke 函数在 `@clawno/shared/ipc/types.ts`，各端 re-export** | 各端独立定义 | 消除 13 个完全重复的 invoke 函数定义 |
| 22 | Kill Switch 共享 | **`useKillSwitch(platform)` hook 在 shared/hooks/** | 各端内联 | 消除 3 处 SSH 凭据查找 + kill switch 调用的重复 |
| 23 | Settings 组件共享 | **LangSelector + BudgetEditor 在 shared/components/common/** | 各端内联 | 语言切换和预算编辑器逻辑在两端 70%+ 相同 |

---

## 6 条实施风险

| # | 风险 | 严重度 | 缓解策略 |
|---|------|--------|---------|
| 1 | Tauri + Cargo workspace 兼容性 | 高 | Phase 0 先在测试仓库验证原型 |
| 2 | chat.rs 抽象泄漏 | 高 | 用组合模式替代 trait |
| 3 | useChatEngine 不可测试 | 中 | 拆为 helpers.ts (纯函数，vitest 覆盖) + useChatEngine.ts (hook，内含 reducer) |
| 4 | secure_store 明文存储 (SS-1) | 高 | Phase 0 优先升级为 AES-GCM |
| 5 | 进化库补丁质量衰减 | 中 | 版本精确过滤 (`WHERE openclaw_ver = current_ver`)，不做复杂评分 |
| 6 | 多实例 sentinel 混淆 | 中 | instance_id WHERE 子句过滤 |

---

## 迁移路线图概览

| Phase | 内容 | 工期 | 核心交付 |
|-------|------|------|---------|
| 0 | Cargo workspace + secure_store 加密 | 1-2 周 | 两端编译通过，共享 crate 可用 |
| 1 | Rust 核心抽取 + Store 统一 | 2-3 周 | chat/gateway/mcp/ssh 共享逻辑，6 个 store 迁移 (≤7 目标) |
| 2 | ChatPage 拆分 + sentinel 骨架 | 2-3 周 | helpers.ts + useChatEngine.ts，进化库 CRUD (最简版) |
| 3 | 自愈闭环 | 1-2 周 | 崩溃 → 诊断 → 修复 → 回滚 |
| 4 | 跨设备同步 | 1 周 | 进化库 Tailscale 同步 |
| 5 | 优化 | 持续 | 脱敏 Issue、统计、CI |

**总工期：8-12 周（一人全职）**

---

## 文档索引

| 文档 | 用途 | 阅读时间 |
|------|------|---------|
| **本文 (DECISIONS.md)** | 架构决策速查 | 5 分钟 |
| [MODULE-BOUNDARIES.md](./MODULE-BOUNDARIES.md) | 模块职责边界、依赖规则 | 10 分钟 |
| [SHARED-CONTRACT.md](./SHARED-CONTRACT.md) | 共享层准入规则、API 契约 | 10 分钟 |
| [SECURITY-BOUNDARIES.md](./SECURITY-BOUNDARIES.md) | 安全边界、自愈权限、不可变区 | 8 分钟 |
| [MIGRATION-CHECKLIST.md](./MIGRATION-CHECKLIST.md) | 可勾选的迁移步骤 | 按需查阅 |
| [ARCHITECTURE-V2.md](./ARCHITECTURE-V2.md) | 完整技术规格 (详细参考) | 40 分钟 |
| ~~ARCHITECTURE-REVIEW.md~~ | 已删除 — 初始诊断内容已合并入 RECTIFICATION-PLAN.md | — |
