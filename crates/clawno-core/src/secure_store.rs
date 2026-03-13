//! Encrypted key-value store primitives.
//!
//! Provides AES-256-GCM encryption/decryption for secure storage.
//! The app layer handles Tauri Store I/O; this module is pure crypto.
//!
//! ## Key derivation
//!
//! `derive_key(device_id)` uses SHA-256 with a fixed app salt to produce
//! a 256-bit AES key.  The `device_id` should be machine-specific
//! (e.g. hostname + app data dir) so encrypted data is non-portable.
//!
//! ## Encrypted value format
//!
//! ```text
//! "enc:v1:" + base64(nonce[12] || ciphertext || tag[16])
//! ```
//!
//! Plaintext values (pre-migration) lack the prefix and are transparently
//! encrypted on first read.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};

pub const STORE_FILE: &str = "clawno_secure.bin";

pub const ENCRYPTED_PREFIX: &str = "enc:v1:";

const APP_SALT: &[u8] = b"clawno11-secure-store-v1";

/// Derive a 256-bit AES key from a device-specific identifier.
///
/// `device_id` should combine machine-specific values (hostname, app path)
/// so the encrypted store is non-portable across machines.
pub fn derive_key(device_id: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(APP_SALT);
    hasher.update(device_id.as_bytes());
    hasher.finalize().into()
}

/// Encrypt a plaintext string.  Returns `"enc:v1:" + base64(nonce || ciphertext)`.
pub fn encrypt_value(key: &[u8; 32], plaintext: &str) -> Result<String, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

    let mut nonce_bytes = [0u8; 12];
    getrandom::getrandom(&mut nonce_bytes).map_err(|e| format!("rng failed: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("encrypt failed: {e}"))?;

    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(format!(
        "{}{}",
        ENCRYPTED_PREFIX,
        STANDARD.encode(&combined)
    ))
}

/// Decrypt an encrypted value string (must start with `ENCRYPTED_PREFIX`).
pub fn decrypt_value(key: &[u8; 32], encrypted: &str) -> Result<String, String> {
    let b64 = encrypted
        .strip_prefix(ENCRYPTED_PREFIX)
        .ok_or("missing enc:v1: prefix")?;

    let combined = STANDARD
        .decode(b64)
        .map_err(|e| format!("base64 decode failed: {e}"))?;

    if combined.len() < 12 + 16 {
        return Err("ciphertext too short (need nonce + tag)".into());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "decrypt failed: wrong key or corrupted data".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("utf8 decode failed: {e}"))
}

/// Check whether a value is already encrypted (has the `enc:v1:` prefix).
pub fn is_encrypted(value: &str) -> bool {
    value.starts_with(ENCRYPTED_PREFIX)
}

/// Encrypt a value for storage. Use when setting a secure value.
#[inline]
pub fn encrypt_and_set(key: &[u8; 32], _store_key: &str, value: &str) -> Result<String, String> {
    encrypt_value(key, value)
}

/// Decrypt an encrypted value. Use when reading a secure value.
#[inline]
pub fn get_and_decrypt(key: &[u8; 32], encrypted: &str) -> Result<String, String> {
    decrypt_value(key, encrypted)
}

/// Process a raw stored value: decrypt if encrypted, otherwise return plaintext.
/// Returns `(plaintext, was_encrypted)`. When `was_encrypted` is false, the caller
/// should migrate by encrypting and re-saving.
pub fn process_stored_value(key: &[u8; 32], raw: &str) -> Result<(String, bool), String> {
    if is_encrypted(raw) {
        let plain = decrypt_value(key, raw)?;
        Ok((plain, true))
    } else {
        Ok((raw.to_string(), false))
    }
}

/// Platform-specific configuration for device identifier construction.
pub struct SecureStoreConfig {
    pub primary_env: &'static str,
    pub fallback_env: &'static str,
    pub default_name: &'static str,
}

#[cfg(all(feature = "desktop", not(feature = "mobile")))]
pub const PLATFORM_CONFIG: SecureStoreConfig = SecureStoreConfig {
    primary_env: "COMPUTERNAME",
    fallback_env: "HOSTNAME",
    default_name: "clawno-device",
};

#[cfg(feature = "mobile")]
pub const PLATFORM_CONFIG: SecureStoreConfig = SecureStoreConfig {
    primary_env: "HOSTNAME",
    fallback_env: "COMPUTERNAME",
    default_name: "clawno-mobile",
};

#[cfg(not(any(feature = "desktop", feature = "mobile")))]
pub const PLATFORM_CONFIG: SecureStoreConfig = SecureStoreConfig {
    primary_env: "COMPUTERNAME",
    fallback_env: "HOSTNAME",
    default_name: "clawno-device",
};

/// Build a device-specific identifier from environment variables.
///
/// Tries `primary_env` first, then `fallback_env`, falling back to
/// `default_name`.  Combines hostname with `app_data_dir` to produce
/// a string suitable for `derive_key`.
pub fn build_device_id(config: &SecureStoreConfig, app_data_dir: &str) -> String {
    let hostname = std::env::var(config.primary_env)
        .or_else(|_| std::env::var(config.fallback_env))
        .unwrap_or_else(|_| config.default_name.into());
    format!("{hostname}:{app_data_dir}")
}

// ── Tauri command macro ──────────────────────────────────────────────────────

/// Generate the 5 Tauri commands for the encrypted secure store.
///
/// Both desktop and mobile have identical implementations; this macro
/// eliminates the duplication. Invoke in each app's `secure_store.rs`:
///
/// ```ignore
/// clawno_core::define_secure_store_commands!();
/// ```
#[macro_export]
macro_rules! define_secure_store_commands {
    () => {
        use clawno_core::secure_store::{
            build_device_id, derive_key, encrypt_and_set, process_stored_value, PLATFORM_CONFIG,
        };
        use serde_json::Value;
        use tauri::{AppHandle, Manager};
        use tauri_plugin_store::StoreExt;

        fn _ss_open(
            app: &AppHandle,
        ) -> Result<std::sync::Arc<tauri_plugin_store::Store<tauri::Wry>>, String> {
            app.store(clawno_core::secure_store::STORE_FILE)
                .map_err(|e| format!("Failed to open secure store: {e}"))
        }

        fn _ss_enc_key(app: &AppHandle) -> [u8; 32] {
            let app_dir = app
                .path()
                .app_data_dir()
                .map(|p: std::path::PathBuf| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let device_id = build_device_id(&PLATFORM_CONFIG, &app_dir);
            derive_key(&device_id)
        }

        #[tauri::command]
        pub fn set_secure_value(app: AppHandle, key: String, value: String) -> Result<(), String> {
            let store = _ss_open(&app)?;
            let enc_key = _ss_enc_key(&app);
            let encrypted = encrypt_and_set(&enc_key, &key, &value)?;
            store.set(&key, Value::String(encrypted));
            store
                .save()
                .map_err(|e| format!("Failed to save secure store: {e}"))
        }

        #[tauri::command]
        pub fn get_secure_value(app: AppHandle, key: String) -> Result<Option<String>, String> {
            let store = _ss_open(&app)?;
            let raw = match store.get(&key).and_then(|v| v.as_str().map(str::to_owned)) {
                Some(v) => v,
                None => return Ok(None),
            };
            let enc_key = _ss_enc_key(&app);
            let (plaintext, was_encrypted) = process_stored_value(&enc_key, &raw)?;
            if !was_encrypted {
                if let Ok(encrypted) = encrypt_and_set(&enc_key, &key, &plaintext) {
                    store.set(&key, Value::String(encrypted));
                    let _ = store.save();
                }
            }
            Ok(Some(plaintext))
        }

        #[tauri::command]
        pub fn delete_secure_value(app: AppHandle, key: String) -> Result<(), String> {
            let store = _ss_open(&app)?;
            let _existed = store.delete(&key);
            store
                .save()
                .map_err(|e| format!("Failed to save secure store: {e}"))
        }

        #[tauri::command]
        pub fn list_secure_keys(app: AppHandle) -> Result<Vec<String>, String> {
            let store = _ss_open(&app)?;
            Ok(store.keys().into_iter().map(|k| k.to_owned()).collect())
        }

        #[tauri::command]
        pub fn wipe_secure_store(app: AppHandle) -> Result<(), String> {
            let store = _ss_open(&app)?;
            store.clear();
            store
                .save()
                .map_err(|e| format!("Failed to wipe secure store: {e}"))
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let key = derive_key("test-device-id");
        let plaintext = "my-secret-api-key-12345";

        let encrypted = encrypt_value(&key, plaintext).unwrap();
        assert!(is_encrypted(&encrypted));
        assert!(encrypted.starts_with(ENCRYPTED_PREFIX));

        let decrypted = decrypt_value(&key, &encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn wrong_key_fails() {
        let key1 = derive_key("device-a");
        let key2 = derive_key("device-b");

        let encrypted = encrypt_value(&key1, "secret").unwrap();
        assert!(decrypt_value(&key2, &encrypted).is_err());
    }

    #[test]
    fn plaintext_not_encrypted() {
        assert!(!is_encrypted("my-api-key"));
        assert!(!is_encrypted(""));
        assert!(is_encrypted("enc:v1:AAAA"));
    }

    #[test]
    fn empty_plaintext() {
        let key = derive_key("dev");
        let encrypted = encrypt_value(&key, "").unwrap();
        let decrypted = decrypt_value(&key, &encrypted).unwrap();
        assert_eq!(decrypted, "");
    }

    #[test]
    fn unicode_roundtrip() {
        let key = derive_key("dev");
        let text = "密钥🔑こんにちは";
        let encrypted = encrypt_value(&key, text).unwrap();
        let decrypted = decrypt_value(&key, &encrypted).unwrap();
        assert_eq!(decrypted, text);
    }

    #[test]
    fn different_keys_from_different_ids() {
        let k1 = derive_key("host-a:/path/a");
        let k2 = derive_key("host-b:/path/b");
        assert_ne!(k1, k2);
    }
}
