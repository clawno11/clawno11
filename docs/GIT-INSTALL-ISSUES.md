# Git 下载安装问题检查清单

## 一、当前流程概览

1. **winget 优先** → 失败则 fallback
2. **direct-download** → 从 GitHub 下载 exe，运行安装
3. **verify** → 检查 git --version

---

## 二、已发现的问题

### 1. 错误信息过于笼统
- **现象**：失败时只显示「please install Git manually from https://git-scm.com/download/win」
- **原因**：下载失败、winget 失败、安装失败都返回同一句文案
- **影响**：用户无法判断是网络、权限还是其他原因

### 2. 下载失败无具体原因
- **现象**：HTTP 4xx/5xx、`resp.bytes()` 失败、`fs::write` 失败时，只设置 `try_direct = false`
- **原因**：未记录 stdout/stderr 或 HTTP 状态码
- **影响**：无法排查是 404、403、网络超时还是磁盘问题

### 3. 无下载超时
- **现象**：`resp.bytes().await` 无超时
- **原因**：未使用 `download_to_file_with_watchdog` 或 reqwest `timeout`
- **影响**：网络卡死时可能无限等待

### 4. 32 位架构处理错误
- **现象**：`profile.arch == "x86"` 时仍用 `64-bit` exe
- **原因**：`arch_suffix` 只区分 `aarch64` 和 `64-bit`，未处理 `x86`
- **影响**：32 位 Windows 会下载错误安装包

### 5. GitHub 可能限流
- **现象**：未登录请求可能返回 403
- **原因**：未设置 User-Agent 或 GitHub 限流
- **影响**：下载可能失败（reqwest 默认有 User-Agent，一般可接受）

### 6. winget 成功后未验证
- **现象**：winget 返回 0 即视为成功
- **原因**：未在 winget 后立即验证 git
- **影响**：部分情况下 winget 返回 0 但未真正安装，会直接进入 verify 失败

### 7. 安装失败信息未展示
- **现象**：`git-direct-install-failed: {} {}` 被 push 进 fixes
- **原因**：fixes 在 error 时显示为「自动修复」列表，但 error 时主要展示的是 detail
- **影响**：安装器 stdout/stderr 可能未出现在用户可见的错误信息中

---

## 三、建议修复

| 优先级 | 问题 | 修复建议 |
|--------|------|----------|
| 高 | 错误信息笼统 | 在 `StepResult::err_fixed` 中根据 fixes 拼出更具体的错误说明 |
| 高 | 下载失败无原因 | 记录 HTTP 状态码、io 错误，写入 fixes 或 detail |
| 中 | 无下载超时 | 为 reqwest 添加 `timeout(15min)` 或改用 `download_to_file_with_watchdog` |
| 中 | 32 位架构 | 增加 `arch == "x86"` 时使用 `32-bit` exe |
| 低 | winget 后验证 | 在 winget 返回 0 后立即 `verify_git()`，成功则跳过 direct-download |

---

## 四、URL 与版本

- 当前：`v2.53.0.windows.2` / `Git-2.53.0.2-64-bit.exe`
- GitHub releases 页面确认该版本存在
- 下载链接格式正确
