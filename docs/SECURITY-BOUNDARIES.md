# ClawNo.11 安全边界

> 本文档定义系统的安全区域划分、自愈权限边界和不可变规则。
> 这是防止系统结构性腐烂的核心文档——任何涉及自愈、自动化、AI 辅助修改的行为都必须遵守本文的约束。
> 校对参考：[ARCHITECTURE-V2.md](./ARCHITECTURE-V2.md) §7-§9

---

## 一、三区安全模型

系统按安全等级划分为三个区域，每个区域有严格的访问规则：

```
╔══════════════════════════════════════════════╗
║ 🔴 不可变区 (Immutable Zone)                 ║
║                                              ║
║ ❌ 任何自动化流程都不能触碰                    ║
║ ❌ 只有开发者通过 git commit 修改              ║
║                                              ║
║ 包含:                                         ║
║   crates/clawno-core/       所有 Rust 源码     ║
║   apps/*/src-tauri/src/     所有 Rust 源码     ║
║   apps/*/src/               所有 TypeScript    ║
║   packages/shared/src/      所有 TypeScript    ║
║   Cargo.toml                所有构建配置        ║
║   package.json              所有依赖配置        ║
║   tauri.conf.json           Tauri 配置         ║
║   security.rs               安全规则本身        ║
╚══════════════════════════════════════════════╝

╔══════════════════════════════════════════════╗
║ 🟡 受控区 (Controlled Zone)                   ║
║                                              ║
║ ⚠️ 自愈系统可以修改，但必须：                   ║
║    - 先备份                                    ║
║    - 修改后验证                                 ║
║    - 失败时自动回滚                             ║
║                                              ║
║ 包含:                                         ║
║   OpenClaw 配置文件         config.json 等      ║
║   Zustand Store 持久化      localStorage        ║
║   pm2 进程配置              ecosystem.config.js ║
║   Ollama 模型配置           modelfile           ║
║   MCP 工具配置              mcp-config.json     ║
║   exec-approvals.json      执行审批记录         ║
╚══════════════════════════════════════════════╝

╔══════════════════════════════════════════════╗
║ 🟢 开放区 (Open Zone)                        ║
║                                              ║
║ ✅ 自愈系统可以自由操作                        ║
║                                              ║
║ 包含:                                         ║
║   SQLite 数据库             token_log.db       ║
║   进化库                    evolution_patches  ║
║   日志文件                  *.log              ║
║   临时文件                  /tmp/clawno-*      ║
║   缓存目录                  .cache/            ║
╚══════════════════════════════════════════════╝
```

---

## 二、自愈操作权限矩阵

### 允许自动执行（无需用户确认）

| 操作 | 条件 | 回滚方式 |
|------|------|---------|
| 重启 pm2 进程 | 进程崩溃且连续失败 <3 次 | pm2 自动恢复 |
| 写入进化库补丁 | 诊断完成 | 删除补丁记录 |
| 修改 OpenClaw 配置 | 补丁来自进化库且之前成功过 | 配置文件快照还原 |
| 记录安全事件 | 任何安全相关操作 | — (只读记录) |
| 归档旧版本补丁 | OpenClaw 版本升级时 | — (仅标记 archived，不删除) |

### 需要用户确认

| 操作 | 提示方式 | 超时行为 |
|------|---------|---------|
| 首次应用新补丁 | 弹窗"检测到修复方案，是否应用？" | 不执行 |
| 修改网络配置 (防火墙规则) | 弹窗"需要修改防火墙规则" | 不执行 |
| 删除 pm2 进程 | 弹窗确认 | 不执行 |
| 清空进化库 | 弹窗确认 | 不执行 |
| 分享补丁到 GitHub Issue | 弹窗"是否匿名分享此修复方案？" | 不执行 |

### 绝对禁止（硬编码禁止）

| 操作 | 原因 |
|------|------|
| 修改任何 `.rs` / `.ts` / `.tsx` 源代码文件 | 编译型架构，运行时不可改 |
| 修改 `Cargo.toml` / `package.json` | 依赖变更影响全局 |
| 修改 `security.rs` 或其编译产物 | 自我保护：安全规则不能自我篡改 |
| 修改 `tauri.conf.json` | 应用配置影响全局 |
| 执行未经审计的 shell 命令 | shell 注入风险 |
| 访问用户个人文件 (非 ClawNo11 目录) | 隐私边界 |
| 向外部发送未脱敏的日志数据 | 隐私保护 |
| 禁用 kill switch | 用户必须始终拥有终极控制权 |

---

## 三、自愈操作流程

```
故障发生
    │
    ▼
[1. 捕获] pm2 事件 / 错误日志
    │
    ▼
[2. 查库] 进化库匹配 (bug_signature + instance_id)
    │
    ├── 命中高置信度补丁 ──► [3a. 自动应用]
    │                           │
    │                           ├── 备份当前配置
    │                           ├── 应用补丁
    │                           ├── 验证结果
    │                           │     ├── 成功 → 更新补丁成功率
    │                           │     └── 失败 → 回滚 + 降权
    │                           └── 记录安全事件
    │
    ├── 命中低置信度补丁 ──► [3b. 用户确认后应用]
    │
    └── 未命中 ──► [4. LLM 诊断]
                      │
                      ▼
                  [5. 生成新补丁]
                      │
                      ▼
                  [6. 用户确认后首次应用]
                      │
                      ├── 成功 → 存入进化库
                      └── 失败 → 丢弃 + 记录
```

### 置信度判定

| 等级 | 条件 | 行为 |
|------|------|------|
| 高 (自动) | 成功次数 ≥3 且 版本精确匹配 且 status=active | 自动应用 |
| 低 (确认) | 成功次数 <3 或 首次 | 弹窗确认 |
| 过期 | 版本不匹配 (已被标记为 archived) | 不参与匹配 |

---

## 四、进化库过期规则

进化库补丁会随版本变化而失效，用最简方式过滤。

### 版本精确过滤（当前实施方案）

```sql
-- 查询时只匹配当前版本的补丁
SELECT * FROM evolution_patches
WHERE bug_signature = ?
  AND openclaw_version = ?    -- 精确匹配当前版本
  AND status = 'active'
ORDER BY success_count DESC;
```

### 自动维护

| 事件 | 动作 |
|------|------|
| OpenClaw 版本升级 | 旧版本补丁标记为 `archived` (不删除，留作参考) |
| `archived` 超过 180 天 | 物理删除 |
| 补丁连续失败 3 次 | 标记为 `disabled`，不再参与匹配 |

> **未来参考：** 如果补丁量增长到需要更精细的排序，可引入 `relevance_score` 评分公式（见 V2 §15.3），但当前阶段版本精确过滤已足够。

---

## 五、多实例隔离

当用户管理多个 OpenClaw 实例时，自愈系统按实例隔离。

### 隔离维度

```
evolution_patches 表:
  ├── instance_id TEXT     ← 实例标识 (如 "openclaw-dev", "openclaw-prod")
  ├── openclaw_version TEXT
  ├── bug_signature TEXT
  └── ...

查询时:
  WHERE instance_id = ? AND bug_signature = ? AND openclaw_version = ?
  ORDER BY success_count DESC
```

### 补丁匹配优先级

```
1. 精确匹配:   instance_id + bug_signature + version     (最优先)
2. 跨实例:     bug_signature + version (忽略 instance)    (次优先)
3. 跨版本:     bug_signature (忽略 instance + version)    (最低优先)
```

---

## 六、安全事件审计

所有涉及安全的操作必须记录到 `security_events` 表（SQLite），不可删除。

### 必须记录的事件类型

| 事件类型 | 触发条件 |
|----------|---------|
| `patch_applied` | 自愈系统应用了补丁 |
| `patch_rollback` | 补丁应用失败，执行回滚 |
| `config_backup` | 创建配置备份 |
| `config_restore` | 从备份恢复配置 |
| `kill_switch_activated` | 用户触发紧急断网 |
| `firewall_changed` | 防火墙规则变更 |
| `pii_detected` | PII 检测拦截了敏感信息 |
| `injection_detected` | 检测到 prompt 注入尝试 |
| `shell_audit` | shell 命令执行审计 |
| `sentinel_diagnosis` | LLM 诊断触发 |
| `user_confirm_accepted` | 用户同意了自愈操作 |
| `user_confirm_rejected` | 用户拒绝了自愈操作 |

### 审计记录格式

```json
{
  "id": "uuid",
  "timestamp": "2026-03-12T10:30:00Z",
  "event_type": "patch_applied",
  "instance_id": "openclaw-dev",
  "details": { "patch_id": "...", "target_file": "config.json" },
  "outcome": "success",
  "user_initiated": false
}
```

---

## 七、安全自检清单

开发过程中，每当修改与自愈相关的代码时，检查以下项：

```
□ 新增的自动化操作是否在"允许自动执行"列表中？
□ 是否有对应的回滚逻辑？
□ 是否写入了安全事件日志？
□ 操作对象是否在受控区或开放区？（不可变区的操作直接拒绝）
□ 是否有超时保护？（避免自愈操作无限重试）
□ 是否泄露了用户的 API Key、聊天内容或文件路径？
□ kill switch 是否仍然可用？（自愈不能阻断 kill switch）
```
