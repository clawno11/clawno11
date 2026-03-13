use super::SecurityCheck;
/// Security scanning helper functions — individual check implementations
/// and score calculation.
///
/// These are non-command helpers used by `scan::scan_security_status` to
/// build the full security report.
use crate::platform::shell_output as run_cmd;

// ── Individual security checks ──────────────────────────────────────────────

/// Detect whether OpenClaw is bound to 0.0.0.0 (public-facing) or 127.0.0.1 (local-only).
pub(super) fn check_port_exposure(port: u16) -> SecurityCheck {
    let output = run_cmd(&format!("netstat -ano | findstr \":{port}\""));

    let listening_lines: Vec<&str> = output.lines().filter(|l| l.contains("LISTENING")).collect();

    if listening_lines.is_empty() {
        let blocked = run_cmd(&format!(
            "netsh advfirewall firewall show rule name=\"ClawNo11_Block_Port_{port}\""
        ))
        .contains(&format!("ClawNo11_Block_Port_{port}"));

        return if blocked {
            SecurityCheck {
                id: "port_exposure".into(),
                label: "端口暴露检测".into(),
                status: "ok".into(),
                detail: format!(
                    "服务当前未运行，且端口 {port} 已被防火墙规则封锁，无任何暴露风险。\
                     即使服务重启，防火墙规则依然生效。"
                ),
            }
        } else {
            SecurityCheck {
                id: "port_exposure".into(),
                label: "端口暴露检测".into(),
                status: "warn".into(),
                detail: format!(
                    "服务当前未运行，端口 {port} 暂无监听。\
                     若服务启动且缺少防火墙规则，端口将完全对外暴露。\
                     建议在「网络访问」面板设置「仅本机」或「仅内网」。"
                ),
            }
        };
    }

    let exposed = listening_lines
        .iter()
        .any(|l| l.contains(&format!("0.0.0.0:{port}")) || l.contains(&format!("[::]:{port}")));

    if exposed {
        SecurityCheck {
            id: "port_exposure".into(),
            label: "端口暴露检测".into(),
            status: "danger".into(),
            detail: format!(
                "端口 {port} 绑定在 0.0.0.0，服务已暴露至公网，建议立即启用防火墙规则。"
            ),
        }
    } else {
        SecurityCheck {
            id: "port_exposure".into(),
            label: "端口暴露检测".into(),
            status: "ok".into(),
            detail: format!("端口 {port} 仅绑定在本地地址，无公网暴露风险。"),
        }
    }
}

/// Check whether Node.js version is in a known-vulnerable range.
pub(super) fn check_node_version() -> SecurityCheck {
    let ver = run_cmd("node --version");
    if ver.is_empty() {
        return SecurityCheck {
            id: "node_version".into(),
            label: "Node.js 版本检查".into(),
            status: "unknown".into(),
            detail: "未检测到 Node.js，部署可能未完成。".into(),
        };
    }

    let major: u32 = ver
        .trim_start_matches('v')
        .split('.')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    if major < 18 {
        SecurityCheck {
            id: "node_version".into(),
            label: "Node.js 版本检查".into(),
            status: "danger".into(),
            detail: format!(
                "当前版本 {ver} 已停止安全维护（EOL），存在已知 CVE 漏洞，建议升级至 v20+。"
            ),
        }
    } else if major < 20 {
        SecurityCheck {
            id: "node_version".into(),
            label: "Node.js 版本检查".into(),
            status: "warn".into(),
            detail: format!("当前版本 {ver} 仍在维护期，但建议升级至长期支持版 v20+。"),
        }
    } else {
        SecurityCheck {
            id: "node_version".into(),
            label: "Node.js 版本检查".into(),
            status: "ok".into(),
            detail: format!("当前版本 {ver}，处于活跃安全维护周期。"),
        }
    }
}

/// Check whether pm2 is managing the openclaw process.
pub(super) fn check_pm2_status() -> SecurityCheck {
    let output = run_cmd("pm2 jlist");

    let running = serde_json::from_str::<serde_json::Value>(&output)
        .ok()
        .and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter().any(|proc| {
                    let name_ok = proc.get("name").and_then(|n| n.as_str()) == Some("openclaw");
                    let status_ok = proc
                        .get("pm2_env")
                        .and_then(|e| e.get("status"))
                        .and_then(|s| s.as_str())
                        == Some("online");
                    name_ok && status_ok
                })
            })
        })
        .unwrap_or(false);

    if running {
        SecurityCheck {
            id: "pm2_status".into(),
            label: "进程守护状态".into(),
            status: "ok".into(),
            detail: "OpenClaw 由 pm2 托管运行，进程异常退出后将自动重启。".into(),
        }
    } else {
        SecurityCheck {
            id: "pm2_status".into(),
            label: "进程守护状态".into(),
            status: "warn".into(),
            detail: "未检测到 pm2 托管的 openclaw 进程，服务可能未启动或未使用进程守护。".into(),
        }
    }
}

/// Detect whether a local API baseURL is configured (offline/local-model mode).
pub(super) fn check_offline_mode() -> SecurityCheck {
    let candidate_paths = [
        crate::platform::path_join(
            &crate::platform::path_join(&crate::platform::user_home(), ".openclaw"),
            "config.json",
        ),
        crate::platform::path_join(
            &crate::platform::path_join(&crate::platform::data_roaming(), "openclaw"),
            "config.json",
        ),
    ];

    let local_keywords = ["127.0.0.1", "localhost", "ollama"];
    let url_fields = ["baseUrl", "apiUrl", "endpoint", "api_base", "base_url"];

    for config_path in &candidate_paths {
        let content = match std::fs::read_to_string(config_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            let is_local = url_fields.iter().any(|field| {
                json.get(field)
                    .and_then(|v| v.as_str())
                    .map(|url| local_keywords.iter().any(|kw| url.contains(kw)))
                    .unwrap_or(false)
            });

            if is_local {
                return SecurityCheck {
                    id: "offline_mode".into(),
                    label: "离线模式检测".into(),
                    status: "ok".into(),
                    detail: "检测到本地 API 配置，当前为 100% 离线模式，数据不出本机。".into(),
                };
            }

            return SecurityCheck {
                id: "offline_mode".into(),
                label: "离线模式检测".into(),
                status: "warn".into(),
                detail:
                    "当前使用远端 AI 服务（非本地模型），对话内容将发送至第三方 API 提供商处理。\
                         如需最高隐私保护，建议使用本地 Ollama 模型。"
                        .into(),
            };
        }
    }

    SecurityCheck {
        id: "offline_mode".into(),
        label: "离线模式检测".into(),
        status: "warn".into(),
        detail: "未找到 OpenClaw 配置文件，无法判断数据流向。\
                 服务可能尚未初始化，或使用内置默认配置。"
            .into(),
    }
}

// ── Score calculation ────────────────────────────────────────────────────────

/// Calculate overall security score using a **weighted** model.
///
/// ## Weight distribution (total = 100 points)
///
/// | Check ID        | Weight | Rationale                                     |
/// |-----------------|--------|-----------------------------------------------|
/// | network_access  |   40   | Biggest attack-surface factor                 |
/// | im_connector    |   20   | External IM = cloud relay = exposure risk     |
/// | port_exposure   |   15   | Direct port reachability                      |
/// | node_version    |   10   | Dependency hygiene                            |
/// | pm2_status      |   10   | Process manager health                        |
/// | offline_mode    |    5   | Air-gap bonus                                 |
///
/// ## Points awarded per status
///
/// - `ok`:      full weight
/// - `notice`:  85 % (home LAN subnet — local devices only, mid-high trust)
/// - `warn`:    75 % for `network_access` (VPN); 60 % for all other checks
/// - `unknown`: 50 % of weight
/// - `danger`:  0 points
pub(super) fn calculate_score(checks: &[SecurityCheck]) -> u8 {
    let weight_of = |id: &str| -> u32 {
        match id {
            "network_access" => 40,
            "im_connector" => 20,
            "port_exposure" => 15,
            "node_version" => 10,
            "pm2_status" => 10,
            "offline_mode" => 5,
            _ => 0,
        }
    };

    let score: u32 = checks
        .iter()
        .map(|c| {
            let w = weight_of(&c.id);
            match c.status.as_str() {
                "ok" => w,
                "notice" => w * 85 / 100,
                "warn" => {
                    if c.id == "network_access" {
                        w * 75 / 100
                    } else {
                        w * 60 / 100
                    }
                }
                "unknown" => w * 50 / 100,
                _ => 0, // "danger"
            }
        })
        .sum();

    score.min(100) as u8
}

// ── Network access check helpers ─────────────────────────────────────────────

/// Check network access restriction level for the given port.
///
/// Accepts a pre-queried `block_active` flag
/// to avoid a duplicate netsh call when called from `scan_security_status`.
pub(super) fn check_network_access_mode_cached(port: u16, block_active: bool) -> SecurityCheck {
    if !block_active {
        return SecurityCheck {
            id: "network_access".into(),
            label: "网络访问限制".into(),
            status: "danger".into(),
            detail: format!(
                "端口 {port} 未设置防火墙封锁规则，任何设备均可直接访问。\
                 建议在「网络访问」面板选择「仅本机」或「仅内网」。"
            ),
        };
    }

    let has_subnet = run_cmd(&format!(
        "netsh advfirewall firewall show rule name=\"ClawNo11_Allow_Subnet_{port}\""
    ))
    .contains(&format!("ClawNo11_Allow_Subnet_{port}"));

    let has_tailscale = run_cmd(&format!(
        "netsh advfirewall firewall show rule name=\"ClawNo11_Allow_Tailscale_{port}\""
    ))
    .contains(&format!("ClawNo11_Allow_Tailscale_{port}"));

    if has_subnet || has_tailscale {
        if has_tailscale && !has_subnet {
            SecurityCheck {
                id: "network_access".into(),
                label: "网络访问限制".into(),
                status: "warn".into(),
                detail: format!(
                    "已限制为 Tailscale VPN 网段访问端口 {port}。\
                     如需更高安全等级，可切换为「仅本机」或「家庭网络」模式。"
                ),
            }
        } else {
            SecurityCheck {
                id: "network_access".into(),
                label: "网络访问限制".into(),
                status: "notice".into(),
                detail: format!(
                    "已限制为家庭局域网网段访问端口 {port}（仅本地设备可连接）。\
                     如需最高安全等级，可切换为「仅本机」模式。"
                ),
            }
        }
    } else {
        SecurityCheck {
            id: "network_access".into(),
            label: "网络访问限制".into(),
            status: "ok".into(),
            detail: format!("端口 {port} 已限制为仅本机（127.0.0.1）访问，外部连接已全部封锁。"),
        }
    }
}

/// Check whether any IM connector (Feishu / Telegram / Discord) is configured
/// and whether that creates an external exposure risk given the current network mode.
/// Accepts a pre-queried `block_active` flag.
pub(super) fn check_im_connector_exposure_cached(_port: u16, block_active: bool) -> SecurityCheck {
    let store_path = {
        let data = crate::platform::data_roaming();
        crate::platform::path_join(
            &crate::platform::path_join(&data, "com.clawno11.desktop"),
            "clawno_secure.bin",
        )
    };

    let store_contents = std::fs::read_to_string(&store_path).unwrap_or_default();
    let feishu_configured = store_contents.contains("\"feishu_app_id\"");
    let telegram_configured = store_contents.contains("\"telegram_token\"");
    let discord_configured = store_contents.contains("\"discord_token\"");

    if !feishu_configured && !telegram_configured && !discord_configured {
        return SecurityCheck {
            id: "im_connector".into(),
            label: "IM 连接器曝露".into(),
            status: "ok".into(),
            detail: "未配置 IM 连接器，AI 网关仅接受直连（移动 App 或 API），无外部云端中转。"
                .into(),
        };
    }

    let mut bots: Vec<&str> = Vec::new();
    if feishu_configured {
        bots.push("飞书");
    }
    if telegram_configured {
        bots.push("Telegram");
    }
    if discord_configured {
        bots.push("Discord");
    }
    let bot_list = bots.join("、");

    if !block_active {
        return SecurityCheck {
            id: "im_connector".into(),
            label: "IM 连接器曝露".into(),
            status: "danger".into(),
            detail: format!(
                "已配置 {bot_list} 机器人，且网络未设置访问限制。\
                 IM 云服务器可从公网中转请求到您的 AI 网关，\
                 外部用户理论上均可与您的 AI 交互。\
                 建议启用「仅本机」或「仅内网」访问限制。"
            ),
        };
    }

    SecurityCheck {
        id:     "im_connector".into(),
        label:  "IM 连接器曝露".into(),
        status: "warn".into(),
        detail: format!(
            "已配置 {bot_list} 机器人，但当前防火墙规则会阻止云端服务器的连接请求（IM 机器人将无法工作）。\
             如需使用 IM 连接，需开放网络访问，这会降低安全评分。\
             推荐使用「手机 App + Tailscale VPN」替代 IM 机器人，安全评分更高。"
        ),
    }
}
