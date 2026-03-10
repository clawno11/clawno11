# Changelog / 更新日志

All notable changes to ClawNo.11 are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- Mobile app (Android / iOS) built on Tauri 2 for remote gateway management
- AI provider recommendations with referral links in mobile Settings page
- Cloud server recommendations with referral links in mobile More page
- Cloudflare Worker (`refer.clawno11.ai`) for secure affiliate ID management
- Privacy Policy (PRIVACY.md) for app store compliance
- CONTRIBUTING.md and CODE_OF_CONDUCT.md

### Fixed
- P0: Removed `deployLocal` IPC call referencing unregistered Rust command
- P1: Fixed command injection vulnerability in `toggle_openclaw_plugin` (now uses arg array)
- P2: Added input validation to `set_exec_mode` (whitelist: deny/ask/allow)
- P2: Fixed mobile `instances.ts` v2 migration overwriting remote URLs with localhost
- P2: Added 5 MiB file size limit to mobile `read_text_file` to prevent OOM
- P3: Removed dead `killError` state and replaced Chinese `window.alert` with i18n toast
- P3: Fixed `budgetOver` translation having unfilled `{{used}}/{{limit}}` placeholders
- P3: Converted hardcoded Chinese strings in MorePage/SettingsPage to i18n keys

### Changed
- GitHub repo URL updated to `github.com/clawno11/clawno11`
- Referral base URL changed from `refer.openclaw.dev` to `refer.clawno11.ai`
- Cloudflare Worker renamed to `clawno11-refer`

---

## [0.1.0] — 2026-03-08 (Initial Release)

### Added
- **One-click local deployment** — Auto-detect Node.js → install openclaw CLI → install pm2 → init config → start gateway (5-step pipeline with progress display)
- **SSH remote deployment** — Deploy to any Linux VPS via password or SSH key
- **Instance manager** — Health probe, latency display, multi-instance support
- **AI chat** — SSE streaming, PII client-side filtering, RAG context injection, prompt library, model routing, injection detection, token logging, shell command audit
- **Claw Guard security** — Port scanner, firewall rules (Windows netsh), Kill Switch, exec approval mode, IP whitelist, LAN device discovery
- **Token monitor** — 24h bar chart, 7-day average anomaly detection, budget limits (daily/monthly), model cost breakdown
- **IM Connectors** — Feishu Bot integration, Tailscale status check
- **RAG (local knowledge base)** — Text file import, TF-IDF chunking, similarity search preview
- **MCP plugin manager** — Plugin list, enable/disable, security scanner (HTTP reachability + risk factors)
- **Model router** — Keyword-based routing rules, priority ordering, rule testing panel
- **Settings** — Language switch (zh/en), PII/RAG/routing defaults, token budget, storage wipe, about page
- **i18n** — Full Chinese/English support across all pages
- Tauri 2 + React 19 + TypeScript 5.7 + Zustand 5 + SQLite (via tauri-plugin-sql)
- Apache 2.0 open-source license

[Unreleased]: https://github.com/clawno11/clawno11/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/clawno11/clawno11/releases/tag/v0.1.0
