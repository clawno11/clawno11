//! OpenClaw WebSocket authentication payload signing.
//!
//! This module is separated to reduce the argument count of `build_and_sign_payload`.

use base64::Engine;
use ed25519_dalek::Signer;

/// OpenClaw verifies: `v2|{deviceId}|{clientId}|{clientMode}|{role}|{scopes}|{signedAtMs}|{token}|{nonce}`
#[derive(Debug)]
pub struct AuthPayload<'a> {
    pub key: &'a ed25519_dalek::SigningKey,
    pub device_id: &'a str,
    pub client_id: &'a str,
    pub client_mode: &'a str,
    pub role: &'a str,
    pub scopes: &'a [&'a str],
    pub signed_at_ms: u64,
    pub token: Option<&'a str>,
    pub nonce: &'a str,
}

/// Build and sign the V2 authentication payload.
pub fn build_and_sign_payload(auth: &AuthPayload<'_>) -> String {
    let scopes_str = auth.scopes.join(",");
    let token_str = auth.token.unwrap_or("");
    let payload = format!(
        "v2|{}|{}|{}|{}|{}|{}|{}|{}",
        auth.device_id,
        auth.client_id,
        auth.client_mode,
        auth.role,
        scopes_str,
        auth.signed_at_ms,
        token_str,
        auth.nonce
    );

    let signature = auth.key.sign(payload.as_bytes());
    let sig_bytes = signature.to_bytes();

    // Base64-encode the signature (no wrapping newlines)
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig_bytes);

    format!("{}|sig:{}", payload, sig_b64)
}
