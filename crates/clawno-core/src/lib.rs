pub mod chat;
pub mod mcp;
pub mod rag;
pub mod secure_store;
pub mod sentinel;
pub mod ssh;
pub mod token_log;
pub mod types;
#[cfg(feature = "ws-chat")]
pub mod ws_chat;
#[cfg(feature = "ws-chat")]
pub mod ws_chat_auth;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
