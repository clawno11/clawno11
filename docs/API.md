# ClawNo.11 Tauri IPC 命令参考文档

> 本文档列出 ClawNo.11 所有 Tauri IPC 命令（`invoke` 调用），包括参数类型、返回值和使用示例。

---

## 目录

1. [部署命令](#1-部署命令)
2. [服务管理命令](#2-服务管理命令)
3. [加密存储命令](#3-加密存储命令)
4. [安全命令](#4-安全命令)
5. [连接器命令](#5-连接器命令)
6. [MCP 命令](#6-mcp-命令)
7. [RAG 命令](#7-rag-命令)
8. [共享类型定义](#8-共享类型定义)

---

## 1. 部署命令

### `deploy_step_check_node`

检查 Node.js 是否已安装及版本是否满足要求（≥ 18）。

**参数**：无

**返回值**：`StepResult`

**行为**：
1. 执行 `node --version` 检测当前版本
2. 若版本 < 18：尝试 `nvm install 18 && nvm use 18` 或 `fnm install 18`
3. 若未安装：Windows 使用 `winget install OpenJS.NodeJS`，其他平台输出安装建议
4. npm registry 不可达时自动切换到 npmmirror 镜像

```typescript
const result = await invoke<StepResult>('deploy_step_check_node');
// result.ok: boolean
// result.message: string（版本号或错误描述）
// result.duration_ms: number
```

---

### `deploy_step_install_openclaw`

全局安装 openclaw CLI。

**参数**：无

**返回值**：`StepResult`

**执行命令**：`npm install -g openclaw`

```typescript
const result = await invoke<StepResult>('deploy_step_install_openclaw');
```

---

### `deploy_step_install_pm2`

全局安装 pm2 进程守护管理器。

**参数**：无

**返回值**：`StepResult`

**执行命令**：`npm install -g pm2`

```typescript
const result = await invoke<StepResult>('deploy_step_install_pm2');
```

---

### `deploy_step_onboard`

执行 openclaw 初始化配置向导。

**参数**：无

**返回值**：`StepResult`

**执行命令**：`openclaw onboard --yes`（写入 `~/.openclaw/config.json`）

```typescript
const result = await invoke<StepResult>('deploy_step_onboard');
```

---

### `deploy_step_start`

启动 openclaw 网关服务，并等待健康检查通过（最多 30 秒轮询）。

**参数**：无

**返回值**：`StepResult`

**执行命令**：`openclaw start`（通过 pm2 守护）

```typescript
const result = await invoke<StepResult>('deploy_step_start');
```

---

### `deploy_local`

执行完整的本地部署流水线（上述 5 步的顺序组合）。

**参数**：无

**返回值**：`LocalDeployResult`

```typescript
const result = await invoke<LocalDeployResult>('deploy_local');
// result.steps: StepResult[]  // 每步的结果
// result.success: boolean      // 整体是否成功
// result.gateway_url: string   // 成功时的网关地址
```

---

### `deploy_remote`

远程部署（当前为 stub，尚未实现）。

**参数**：无

**返回值**：`RemoteDeployResult`

> ⚠️ 当前版本该命令返回"未实现"错误。

---

### `configure_api_key`

为指定 AI 提供商安全写入 API Key。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `provider` | `string` | 是 | 提供商名称（见白名单） |
| `api_key` | `string` | 是 | API Key 值 |

**provider 白名单**（必须为以下之一，否则返回错误）：
```
zai, minimax, anthropic, openai, openrouter,
deepseek, moonshot, qwen, doubao, hunyuan,
xinghuo, baichuan, stepfun, yi, siliconflow
```

**返回值**：`void`（成功）或抛出错误

**安全机制**：
- provider 名称严格白名单验证，防止命令注入
- API Key 通过 stdin 管道传输（`echo <key> | openclaw config set-key <provider>`），不出现在命令行参数
- 成功后调用 `set_secure_value("ai_key_configured:<provider>", "true")` 记录状态

```typescript
await invoke('configure_api_key', {
  provider: 'anthropic',
  apiKey: 'sk-ant-...'
});
```

---

## 2. 服务管理命令

### `get_local_service_info`

获取本地 openclaw 服务（pm2 进程）的运行状态信息。

**参数**：无

**返回值**：`ServiceInfo`

**执行命令**：`pm2 jlist`（JSON 格式进程列表）

```typescript
const info = await invoke<ServiceInfo>('get_local_service_info');
// info.status: 'online' | 'stopped' | 'errored' | 'unknown'
// info.pid: number | null
// info.uptime: number | null  // 运行时间（秒）
// info.cpu: number | null     // CPU 使用率（%）
// info.memory: number | null  // 内存使用（字节）
```

---

### `stop_local_service`

停止本地 openclaw 服务。

**参数**：无

**返回值**：`void`

**执行命令**：`pm2 stop openclaw`

```typescript
await invoke('stop_local_service');
```

---

### `restart_local_service`

重启本地 openclaw 服务。

**参数**：无

**返回值**：`void`

**执行命令**：`pm2 restart openclaw`

```typescript
await invoke('restart_local_service');
```

---

### `start_local_service`

启动已停止的本地 openclaw 服务。

**参数**：无

**返回值**：`void`

**执行命令**：通过 `gateway.rs` 启动，包含健康检查等待

```typescript
await invoke('start_local_service');
```

---

### `get_browser_url`

获取 openclaw 网关控制台的 URL。

**参数**：无

**返回值**：`string`

**示例返回**：`"http://127.0.0.1:18789"`

```typescript
const url = await invoke<string>('get_browser_url');
```

---

### `open_in_browser`

在系统默认浏览器中打开指定 URL。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | `string` | 是 | 要打开的 URL |

**返回值**：`void`

```typescript
await invoke('open_in_browser', { url: 'http://127.0.0.1:18789' });
```

---

### `probe_instance_health`

探测实例的 HTTP 健康状态，返回延迟（毫秒）。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | `string` | 是 | 实例的健康检查 URL |

**返回值**：`HealthResult`

```typescript
const health = await invoke<HealthResult>('probe_instance_health', {
  url: 'http://127.0.0.1:18789/health'
});
// health.ok: boolean
// health.latency_ms: number
// health.status_code: number | null
```

---

### `get_remote_service_info`

获取远程服务信息（当前为 stub）。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `instance_id` | `string` | 是 | 远程实例 ID |

**返回值**：`ServiceInfo`

> ⚠️ 当前版本返回占位数据。

---

## 3. 加密存储命令

所有加密存储命令操作 `clawno_secure.bin` 文件（AES-GCM 加密）。

### `set_secure_value`

写入加密 KV 存储。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | `string` | 是 | 存储 key |
| `value` | `string` | 是 | 存储值 |

**返回值**：`void`

```typescript
await invoke('set_secure_value', {
  key: 'ai_key_configured:anthropic',
  value: 'true'
});
```

---

### `get_secure_value`

读取加密 KV 存储中的值。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | `string` | 是 | 存储 key |

**返回值**：`string | null`（key 不存在时返回 `null`）

```typescript
const value = await invoke<string | null>('get_secure_value', {
  key: 'ai_key_configured:anthropic'
});
```

---

### `delete_secure_value`

删除加密存储中的单个 key。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | `string` | 是 | 要删除的 key |

**返回值**：`void`

```typescript
await invoke('delete_secure_value', { key: 'ai_key_configured:anthropic' });
```

---

### `list_secure_keys`

列出加密存储中所有 key（不含对应值）。

**参数**：无

**返回值**：`string[]`

```typescript
const keys = await invoke<string[]>('list_secure_keys');
// 示例：['ai_key_configured:anthropic', 'feishu_app_id']
```

---

### `wipe_secure_store`

清空加密存储中的所有数据（Panic Button 功能）。

**参数**：无

**返回值**：`void`

> ⚠️ 此操作不可逆！会清除所有 API Key 配置。

```typescript
await invoke('wipe_secure_store');
```

---

## 4. 安全命令

### `scan_security_status`

运行全套安全检查，返回综合安全报告和评分。

**参数**：无

**返回值**：`SecurityReport`

```typescript
const report = await invoke<SecurityReport>('scan_security_status');
// report.score: number          // 综合评分 0-100
// report.port_check: CheckItem
// report.node_version: CheckItem
// report.pm2_status: CheckItem
// report.offline_mode: CheckItem

// CheckItem:
// {
//   status: 'ok' | 'warn' | 'danger' | 'unknown',
//   message: string
// }
```

**评分算法**：
- `ok` → 1.0，`warn` → 0.5，`unknown` → 0.25，`danger` → 0.0
- 各项等权，最终乘以 100 取整

---

### `get_port_connections`

列出指定端口的所有活跃 TCP 连接。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `port` | `number` | 是 | 要监控的端口号 |

**返回值**：`PortConnection[]`

```typescript
const conns = await invoke<PortConnection[]>('get_port_connections', {
  port: 18789
});
// conns[0].local_addr: string   // 本地地址（IP:端口）
// conns[0].remote_addr: string  // 远端地址（IP:端口）
// conns[0].state: string        // 连接状态（ESTABLISHED 等）
// conns[0].pid: number | null   // 进程 PID
```

**执行命令**：`netstat -ano`（过滤指定端口）

---

### `apply_local_only_firewall`

添加 Windows 防火墙规则，限制 openclaw 端口仅允许 127.0.0.1 访问。

**参数**：无

**返回值**：`void`

**执行命令**：
```
netsh advfirewall firewall add rule
  name="ClawNo11-LocalOnly"
  protocol=TCP
  dir=in
  localport=18789
  remoteip=127.0.0.1
  action=allow
```

> ⚠️ 需要管理员权限（Tauri 会请求 UAC 提权）。

```typescript
await invoke('apply_local_only_firewall');
```

---

### `remove_local_only_firewall`

移除 ClawNo.11 添加的 Windows 防火墙规则。

**参数**：无

**返回值**：`void`

**执行命令**：
```
netsh advfirewall firewall delete rule name="ClawNo11-LocalOnly"
```

```typescript
await invoke('remove_local_only_firewall');
```

---

## 5. 连接器命令

### `test_feishu_connection`

通过飞书 Open API 验证 App ID 和 App Secret 是否有效。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `app_id` | `string` | 是 | 飞书应用 App ID |
| `app_secret` | `string` | 是 | 飞书应用 App Secret |

**返回值**：`ConnectionTestResult`

**请求**：POST `https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`

```typescript
const result = await invoke<ConnectionTestResult>('test_feishu_connection', {
  appId: 'cli_xxx',
  appSecret: 'xxxxx'
});
// result.ok: boolean
// result.message: string  // 成功/失败描述
// result.error_code: number | null  // 飞书错误码（0 = 成功）
```

---

### `save_feishu_config`

将飞书凭据写入加密存储（验证通过后调用）。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `app_id` | `string` | 是 | 飞书应用 App ID |
| `app_secret` | `string` | 是 | 飞书应用 App Secret |

**返回值**：`void`

**存储 key**：
- `feishu_app_id` → App ID
- `feishu_app_secret` → App Secret

```typescript
await invoke('save_feishu_config', {
  appId: 'cli_xxx',
  appSecret: 'xxxxx'
});
```

---

### `get_tailscale_status`

检测 Tailscale 的安装状态、运行状态和节点 IP。

**参数**：无

**返回值**：`TailscaleStatus`

```typescript
const status = await invoke<TailscaleStatus>('get_tailscale_status');
// status.installed: boolean    // 是否已安装
// status.running: boolean      // 是否正在运行
// status.ip: string | null     // Tailscale IPv4 地址
// status.version: string | null // Tailscale 版本号
```

**执行命令**：
- `tailscale version`（检测安装）
- `tailscale ip -4`（获取 IP）

---

## 6. MCP 命令

### `scan_mcp_server`

对 MCP 服务器端点进行多维安全分析，返回风险评估结果。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `endpoint` | `string` | 是 | MCP 服务器端点（URL 或命令字符串） |
| `server_type` | `string` | 是 | 服务器类型：`"http-sse"` 或 `"stdio"` |

**返回值**：`McpScanResult`

```typescript
const result = await invoke<McpScanResult>('scan_mcp_server', {
  endpoint: 'http://localhost:8080/mcp',
  serverType: 'http-sse'
});
// result.risk_level: 'safe' | 'caution' | 'danger'
// result.score: number          // 风险评分（0=安全，100=高危）
// result.findings: Finding[]   // 发现的问题列表

// Finding:
// {
//   severity: 'info' | 'warning' | 'critical',
//   message: string
// }
```

**HTTP/SSE 扫描逻辑**：
- 远程地址（非 localhost）→ +20 风险分
- HTTP（无 TLS）→ +15 风险分
- 不可达（reqwest 5秒超时）→ +30 风险分
- `score < 20` → safe，`20-50` → caution，`> 50` → danger

**Stdio 扫描逻辑**：
- Shell 操作符（`&&` / `||` / `;` / `|`）→ +25 风险分
- 敏感路径（`/etc/` / `C:\Windows\` / `/root/`）→ +30 风险分
- 网络工具（`curl` / `wget` / `nc`）→ +20 风险分

---

## 7. RAG 命令

### `read_text_file`

安全地读取本地文本文件内容（用于 RAG 知识库导入）。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `string` | 是 | 文件绝对路径 |

**返回值**：`string`（文件内容，UTF-8）

**安全校验**：
1. **扩展名白名单**：仅允许 `txt / md / markdown / csv / log / json / yaml / yml / xml / html / htm / rst`
2. **路径遍历防护**：规范化路径后拒绝包含 `..` 的路径
3. 两项校验任一失败则返回错误，不读取文件

```typescript
const content = await invoke<string>('read_text_file', {
  path: 'C:\\Users\\user\\Documents\\knowledge.md'
});
```

---

## 8. 共享类型定义

以下为 Rust 端定义（`types.rs`）并通过 Serde 序列化的共享类型，在 TypeScript 侧通过 `ipc.ts` 中的接口定义对应：

### `StepResult`

```typescript
interface StepResult {
  ok: boolean;         // 步骤是否成功
  message: string;     // 描述信息（版本号、错误详情等）
  duration_ms: number; // 步骤耗时（毫秒）
}
```

### `LocalDeployResult`

```typescript
interface LocalDeployResult {
  success: boolean;     // 整体是否成功（所有步骤均成功）
  steps: StepResult[];  // 5 个步骤的结果数组
  gateway_url: string;  // 成功时的网关 URL
  error: string | null; // 失败时的错误描述
}
```

### `RemoteDeployResult`

```typescript
interface RemoteDeployResult {
  success: boolean;
  message: string;
  instance_id: string | null;
}
```

### `ServiceInfo`

```typescript
interface ServiceInfo {
  status: 'online' | 'stopped' | 'errored' | 'unknown';
  pid: number | null;
  uptime: number | null;    // 秒
  cpu: number | null;       // 百分比
  memory: number | null;    // 字节
  name: string;             // pm2 进程名
}
```

### `SecurityReport`

```typescript
interface CheckItem {
  status: 'ok' | 'warn' | 'danger' | 'unknown';
  message: string;
}

interface SecurityReport {
  score: number;           // 0-100 综合安全评分
  port_check: CheckItem;   // 端口暴露检查
  node_version: CheckItem; // Node.js CVE 版本检查
  pm2_status: CheckItem;   // pm2 运行状态检查
  offline_mode: CheckItem; // 离线模式配置检查
  checked_at: number;      // 检查时间戳（Unix）
}
```

### `McpScanResult`

```typescript
interface Finding {
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

interface McpScanResult {
  risk_level: 'safe' | 'caution' | 'danger';
  score: number;         // 风险评分 0-100
  findings: Finding[];   // 发现的问题列表
  scanned_at: number;    // 扫描时间戳（Unix）
}
```

### `HealthResult`

```typescript
interface HealthResult {
  ok: boolean;
  latency_ms: number;
  status_code: number | null;
  error: string | null;
}
```

### `TailscaleStatus`

```typescript
interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  ip: string | null;
  version: string | null;
}
```

### `PortConnection`

```typescript
interface PortConnection {
  local_addr: string;   // "127.0.0.1:18789"
  remote_addr: string;  // "127.0.0.1:53421"
  state: string;        // "ESTABLISHED"
  pid: number | null;
}
```

### `ConnectionTestResult`

```typescript
interface ConnectionTestResult {
  ok: boolean;
  message: string;
  error_code: number | null;
}
```

---

## 错误处理

所有命令失败时会通过 Tauri 的错误机制抛出，在 TypeScript 侧表现为 `invoke` 的 Promise reject：

```typescript
try {
  await invoke('deploy_local');
} catch (error) {
  // error 是字符串（Rust 端 return Err(e.to_string())）
  console.error('部署失败:', error);
}
```

常见错误类型：
- `"Node.js not found"` — Node.js 未安装
- `"Invalid provider: ..."` — provider 不在白名单（`configure_api_key`）
- `"Path traversal detected"` — 路径包含 `..`（`read_text_file`）
- `"Unsupported file extension"` — 文件类型不在白名单（`read_text_file`）
- `"pm2 process not found"` — openclaw 进程不在 pm2 列表中
