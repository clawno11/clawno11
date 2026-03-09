mod chat;
mod connectors;
mod gateway;
mod mcp;
mod secure_store;
mod token_log;
mod types;

use tauri_plugin_sql::Builder as SqlBuilder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Plugins
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:clawno.db", token_log::migrations())
                .build(),
        )
        // Commands
        .invoke_handler(tauri::generate_handler![
            // Chat streaming (HTTP SSE — no subprocess)
            chat::stream_chat,
            // Gateway health & model info
            gateway::probe_instance_health,
            gateway::get_main_agent_model,
            gateway::read_text_file,
            // Tailscale & gateway connectivity
            connectors::get_tailscale_status,
            connectors::probe_gateway_url,
            // Encrypted secure storage
            secure_store::set_secure_value,
            secure_store::get_secure_value,
            secure_store::delete_secure_value,
            secure_store::list_secure_keys,
            secure_store::wipe_secure_store,
            // MCP security scanner
            mcp::scan_mcp_server,
        ])
        .run(tauri::generate_context!())
        .expect("ClawNo.11 Mobile failed to start");
}
