pub mod chat;
pub mod mcp;
pub mod rag;
pub mod secure_store;
pub mod sentinel;
pub mod ssh;
pub mod token_log;
pub mod types;
pub mod version_parse;
#[cfg(feature = "ws-chat")]
pub mod ws_chat;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
