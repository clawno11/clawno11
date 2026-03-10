# Contributing to ClawNo.11 / 贡献指南

Thank you for your interest in contributing! / 感谢您对本项目的贡献意愿！

---

## English

### Ways to Contribute

- 🐛 **Bug reports** — Open a GitHub Issue with reproduction steps
- 💡 **Feature requests** — Open an Issue, describe the use case
- 🔧 **Code contributions** — Fork → branch → PR
- 📖 **Documentation** — Fix typos, improve clarity, add examples
- 🌐 **Translations** — Improve `src/locales/` files
- ⭐ **Spread the word** — Star the repo, share with others

### Before You Start

1. Search existing [Issues](https://github.com/clawno11/clawno11/issues) to avoid duplicates
2. For large changes, open an Issue first to discuss the approach
3. Read the [Architecture docs](./docs/ARCHITECTURE.md) to understand the codebase

### Development Setup

```bash
git clone https://github.com/clawno11/clawno11.git
cd clawno11
pnpm install
cd apps/desktop
pnpm tauri dev
```

See [DEVELOPMENT.md](./docs/DEVELOPMENT.md) for the full setup guide.

### Pull Request Guidelines

- **One feature/fix per PR** — keep changes focused
- **Branch naming:** `fix/issue-description`, `feat/feature-name`, `docs/what-changed`
- **Commit style:** `fix: correct SSH timeout handling` (use imperative mood)
- **Tests:** Add or update tests if your change affects logic
- **Linting:** Run `pnpm lint` before submitting
- **Rust:** Run `cargo clippy` and `cargo fmt` in `src-tauri/`

### What We Do NOT Accept

To protect the project's integrity and affiliate revenue that funds development:

- ❌ Changes to affiliate/referral link domains or IDs
- ❌ Removal of the [PRIVACY.md](./PRIVACY.md), [DISCLAIMER.md](./DISCLAIMER.md), or [TRADEMARK.md](./TRADEMARK.md)
- ❌ Embedding tracking, analytics, or telemetry of any kind
- ❌ Weakening security features (PII filter, CSP, sandbox)
- ❌ Hardcoded credentials of any kind

### Code Style

| Language | Formatter | Linter |
|----------|-----------|--------|
| TypeScript / TSX | Prettier | ESLint |
| Rust | `rustfmt` | `clippy` |

### Reporting Security Vulnerabilities

**Do NOT open a public Issue for security bugs.**  
See [SECURITY.md](./SECURITY.md) for responsible disclosure instructions.

### License

By submitting a pull request, you agree that your contribution will be licensed under the [Apache 2.0 License](./LICENSE), the same license as the project.

---

## 简体中文

### 贡献方式

- 🐛 **Bug 报告** — 在 GitHub Issue 中描述重现步骤
- 💡 **功能建议** — 开 Issue，说明使用场景
- 🔧 **代码贡献** — Fork → 新建分支 → 提交 PR
- 📖 **文档改进** — 修正错别字、提高可读性、补充示例
- 🌐 **翻译** — 改进 `src/locales/` 文件（目前支持中文/英文）
- ⭐ **传播推广** — Star 仓库，分享给有需要的朋友

### 开始之前

1. 先搜索 [Issues](https://github.com/clawno11/clawno11/issues)，避免重复提交
2. 对于较大的改动，请先开 Issue 讨论方案
3. 阅读 [架构文档](./docs/ARCHITECTURE.md) 了解代码结构

### 开发环境

```bash
git clone https://github.com/clawno11/clawno11.git
cd clawno11
pnpm install
cd apps/desktop
pnpm tauri dev
```

完整环境配置见 [DEVELOPMENT.md](./docs/DEVELOPMENT.md)。

### PR 规范

- **每个 PR 只做一件事** — 保持改动聚焦
- **分支命名：** `fix/问题描述`、`feat/功能名称`、`docs/改动内容`
- **提交信息：** `fix: 修正 SSH 超时处理`（祈使句，动词开头）
- **测试：** 如果改动涉及逻辑，请添加或更新测试
- **代码检查：** 提交前运行 `pnpm lint`
- **Rust：** 运行 `cargo clippy` 和 `cargo fmt`

### 我们不接受的改动

为保护项目完整性及维持项目运营的推广收入：

- ❌ 修改推广链接域名或推广 ID
- ❌ 删除 [PRIVACY.md](./PRIVACY.md)、[DISCLAIMER.md](./DISCLAIMER.md) 或 [TRADEMARK.md](./TRADEMARK.md)
- ❌ 嵌入任何形式的追踪、分析或遥测
- ❌ 削弱安全功能（PII 过滤、CSP、沙箱隔离）
- ❌ 任何形式的硬编码密钥

### 安全漏洞报告

**请勿为安全漏洞开公开 Issue。**  
请参阅 [SECURITY.md](./SECURITY.md) 了解负责任的披露流程。

### 许可证

提交 PR 即表示您同意您的贡献将遵循与本项目相同的 [Apache 2.0 许可证](./LICENSE)。
