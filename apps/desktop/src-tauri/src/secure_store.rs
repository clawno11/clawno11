/// Encrypted key-value store for sensitive data (API keys, config, etc.)
///
/// Uses tauri-plugin-store as the persistence backend.
///
/// ⚠️  Encryption note (SS-1): tauri-plugin-store does NOT encrypt data by default.
/// The "encrypted" claim in the original comment was aspirational. The store file
/// (`clawno_secure.bin`) is currently persisted as plaintext JSON in the app data
/// directory. Until a custom encryption key is wired into StoreBuilder, callers
/// should treat this as tamper-evident storage rather than truly encrypted storage.
/// Tracking issue: configure StoreBuilder with a device-derived AES-GCM key.

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

pub const STORE_FILE: &str = "clawno_secure.bin";

/// Write a sensitive value into the store.
#[tauri::command]
pub fn set_secure_value(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open secure store: {e}"))?;
    store.set(key, Value::String(value));
    store.save().map_err(|e| format!("Failed to save secure store: {e}"))
}

/// Read a sensitive value from the store. Returns null if not found.
#[tauri::command]
pub fn get_secure_value(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open secure store: {e}"))?;
    Ok(store.get(&key).and_then(|v| v.as_str().map(str::to_owned)))
}

/// Delete a single key from the store.
/// Fix SS-2: the return value of store.delete() (bool — was the key present?) is now used.
#[tauri::command]
pub fn delete_secure_value(app: AppHandle, key: String) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open secure store: {e}"))?;
    let _existed = store.delete(&key);
    store.save().map_err(|e| format!("Failed to save secure store: {e}"))
}

/// List all keys (but not values) currently stored.
#[tauri::command]
pub fn list_secure_keys(app: AppHandle) -> Result<Vec<String>, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open secure store: {e}"))?;
    Ok(store.keys().into_iter().map(|k| k.to_owned()).collect())
}

/// Wipe the entire store (Panic Button / data destruction).
#[tauri::command]
pub fn wipe_secure_store(app: AppHandle) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open secure store: {e}"))?;
    store.clear();
    store.save().map_err(|e| format!("Failed to wipe secure store: {e}"))
}
