// Sub-modules — each has a single, focused responsibility.
pub mod bots; // Telegram + Discord background bots
              // Desktop embeds OpenClaw Web UI via Tauri multiwebview (see gateway.rs).
              // Mobile has its own stream_chat in apps/mobile/src-tauri/src/chat.rs.
pub mod chat_proxy; // LAN-facing REST proxy for mobile chat
pub mod connectors; // IM connectors (Feishu, Tailscale)
pub mod deploy; // deployment coordinator + API-key config
pub mod gateway; // openclaw gateway start / health / URL
pub mod mcp; // MCP server security scanner
pub mod node; // Node.js & openclaw CLI management
pub mod ollama;
pub mod pairing; // Secure QR-code pairing (OTP + PIN confirmation)
pub mod platform; // cross-platform shell + path helpers
pub mod pm2; // pm2 daemon lifecycle
pub mod rag; // local RAG: text ingestion helper
pub mod secure_store; // encrypted KV store (API keys, secrets)
pub mod security; // port scanning, firewall rules, security report
pub mod ssh_deploy; // SSH remote deployment (step-by-step)
pub mod token_log; // SQLite schema migrations
pub mod types; // shared serializable types (StepResult, ServiceInfo, …)

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .on_window_event(|window, event| {
            // 点 × 时隐藏到系统托盘而不是退出，让应用保持后台运行
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    window.hide().ok();
                }
            }
        })
        .manage(bots::BotManager::new())
        .manage(pairing::PairingState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(token_log::DB_URL, token_log::migrations())
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            // ── Deploy environment scan ────────────────────────────────────
            deploy::environment::scan_environment,
            deploy::environment::install_single_dep,
            // ── Deploy pre-check & update ────────────────────────────────────
            node::check_deploy_status,
            node::update_openclaw,
            node::uninstall_local_instance,
            node::list_configured_providers,
            // ── Deploy pipeline ──────────────────────────────────────────────
            node::deploy_step_check_node,
            node::deploy_step_install_openclaw,
            pm2::deploy_step_install_pm2,
            deploy::deploy_step_onboard,
            gateway::deploy_step_start,
            deploy::deploy_remote,
            deploy::configure_api_key,
            deploy::diagnose_auth,
            deploy::fix_model_config,
            deploy::models::restore_default_model,
            deploy::models::repair_model_config,
            // ── SSH remote deploy pipeline ────────────────────────────────────
            ssh_deploy::deploy_remote_connect,
            ssh_deploy::deploy_remote_check_node,
            ssh_deploy::deploy_remote_install_openclaw,
            ssh_deploy::deploy_remote_onboard,
            ssh_deploy::deploy_remote_start_gateway,
            // ── Service management ───────────────────────────────────────────
            pm2::get_local_service_info,
            pm2::stop_local_service,
            pm2::restart_local_service,
            gateway::start_local_service,
            gateway::get_browser_url,
            gateway::open_in_browser,
            gateway::mount_chat_webview,
            gateway::unmount_chat_webview,
            gateway::hide_chat_webview,
            gateway::resize_chat_webview,
            gateway::probe_instance_health,
            gateway::get_main_agent_model,
            // ── Remote (stub) ────────────────────────────────────────────────
            deploy::get_remote_service_info,
            // ── Secure store ─────────────────────────────────────────────────
            secure_store::set_secure_value,
            secure_store::get_secure_value,
            secure_store::delete_secure_value,
            secure_store::list_secure_keys,
            secure_store::wipe_secure_store,
            // ── Security: scanning & tool permissions ───────────────────────
            security::scan::scan_security_status,
            security::scan::get_port_connections,
            security::scan::check_firewall_active,
            security::scan::get_tool_permissions,
            security::scan::set_exec_mode,
            security::scan::add_exec_allowlist_entry,
            security::scan::remove_exec_allowlist_entry,
            // ── Security: firewall & kill switch ────────────────────────────
            security::firewall::apply_local_only_firewall,
            security::firewall::remove_local_only_firewall,
            security::firewall::kill_switch_offline,
            security::firewall::kill_switch_restore,
            security::firewall::get_network_access_mode,
            security::firewall::set_network_access_mode,
            // ── Security: IP allowlist & LAN ────────────────────────────────
            security::network::get_allowed_ips,
            security::network::add_allowed_ip,
            security::network::remove_allowed_ip,
            security::network::scan_lan_devices,
            security::network::get_local_lan_info,
            // ── Connectors ───────────────────────────────────────────────────
            connectors::test_feishu_connection,
            connectors::save_feishu_config,
            connectors::get_feishu_config,
            connectors::get_tailscale_status,
            // ── Secure Pairing ────────────────────────────────────────────────
            pairing::generate_pair_qr,
            pairing::generate_pair_qr_with_host,
            pairing::verify_pair_token,
            pairing::get_current_pair_pin,
            // ── Bots (Telegram + Discord) ─────────────────────────────────────
            bots::test_telegram_config,
            bots::save_telegram_config,
            bots::get_telegram_config,
            bots::start_telegram_bot,
            bots::stop_telegram_bot,
            bots::get_telegram_bot_status,
            bots::test_discord_config,
            bots::save_discord_config,
            bots::get_discord_config,
            bots::start_discord_bot,
            bots::stop_discord_bot,
            bots::get_discord_bot_status,
            // ── MCP ──────────────────────────────────────────────────────────
            mcp::scan_mcp_server,
            mcp::list_openclaw_plugins,
            mcp::toggle_openclaw_plugin,
            // ── RAG ──────────────────────────────────────────────────────────
            rag::read_text_file,
            // ── Chat (desktop no longer calls stream_chat — OpenClaw Web UI
            //    handles chat directly; mobile has its own stream_chat) ────
            // ── Ollama local model engine ─────────────────────────────────────
            ollama::ollama_check_status,
            ollama::ollama_ensure_installed,
            ollama::ollama_start_server,
            ollama::ollama_list_local_models,
            ollama::ollama_delete_model,
            ollama::ollama_pull_model,
            ollama::set_ollama_model,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_icon(tauri::include_image!("icons/icon.png"));
            }

            // Start LAN-accessible REST chat proxy for mobile clients.
            let proxy_port = chat_proxy::start_proxy(app.handle(), 18789);
            eprintln!("[setup] chat REST proxy started on port {proxy_port}");

            // ── 系统托盘：最小化到托盘，双击恢复，右键退出 ──────────────────
            let tray_menu = tauri::menu::MenuBuilder::new(app)
                .item(&tauri::menu::MenuItem::with_id(
                    app,
                    "show",
                    "显示 ClawNo.11",
                    true,
                    None::<&str>,
                )?)
                .item(&tauri::menu::MenuItem::with_id(
                    app,
                    "quit",
                    "退出",
                    true,
                    None::<&str>,
                )?)
                .build()?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(tauri::include_image!("icons/icon.png"))
                .tooltip("ClawNo.11 — You × AI = ∞")
                .menu(&tray_menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            w.show().ok();
                            w.set_focus().ok();
                        }
                    }
                    "quit" => {
                        pm2::stop_openclaw_on_exit();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            w.show().ok();
                            w.set_focus().ok();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // 只在真正退出时停止网关（通过托盘菜单退出触发 Destroyed）
            if window.label() == "main" {
                if let tauri::WindowEvent::Destroyed = event {
                    pm2::stop_openclaw_on_exit();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
