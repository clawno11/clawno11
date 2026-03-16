mod chat;
mod connectors;
mod gateway;
mod mcp;
mod rag;
mod secure_store;
mod speech;
mod ssh_deploy;
mod token_log;
mod types;

use tauri_plugin_sql::Builder as SqlBuilder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin({
            #[cfg(mobile)]
            let p = tauri_plugin_barcode_scanner::init();
            #[cfg(not(mobile))]
            let p = tauri::plugin::Builder::<tauri::Wry, ()>::new("barcode-scanner").build();
            p
        })
        .plugin(speech::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations(token_log::DB_URL, token_log::migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            chat::stream_chat,
            chat::stop_chat_stream,
            gateway::probe_instance_health,
            gateway::get_main_agent_model,
            gateway::discover_chat_proxy,
            gateway::proxy_fetch_providers,
            gateway::proxy_configure_api_key,
            gateway::proxy_repair_model,
            rag::read_text_file,
            connectors::get_tailscale_status,
            connectors::probe_gateway_url,
            connectors::fetch_chat_proxy_token,
            secure_store::set_secure_value,
            secure_store::get_secure_value,
            secure_store::delete_secure_value,
            secure_store::list_secure_keys,
            secure_store::wipe_secure_store,
            mcp::scan_mcp_server,
            ssh_deploy::deploy_remote_connect,
            ssh_deploy::deploy_remote_check_node,
            ssh_deploy::deploy_remote_install_openclaw,
            ssh_deploy::deploy_remote_onboard,
            ssh_deploy::deploy_remote_start_gateway,
            ssh_deploy::deploy_remote_install_clawno_server,
            ssh_deploy::deploy_remote_start_clawno_server,
            ssh_deploy::ssh_stop_instance,
            ssh_deploy::ssh_start_instance,
            ssh_deploy::ssh_restart_instance,
            ssh_deploy::ssh_configure_api_key,
            ssh_deploy::ssh_kill_switch,
        ])
        .run(tauri::generate_context!())
        .expect("ClawNo.11 Mobile failed to start");
}
