/**
 * Encrypted key-value store backed by tauri-plugin-store.
 * Identical to desktop implementation — sensitive data (API keys etc.)
 * is stored in an encrypted file, never in plain localStorage.
 */
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "clawno_secure.bin";

fn open(app: &AppHandle) -> Result<std::sync::Arc<tauri_plugin_store::Store<tauri::Wry>>, String> {
    app.store(STORE_FILE).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_secure_value(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let store = open(&app)?;
    store
        .set(key, serde_json::Value::String(value));
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_secure_value(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let store = open(&app)?;
    Ok(store
        .get(&key)
        .and_then(|v| v.as_str().map(|s| s.to_string())))
}

#[tauri::command]
pub fn delete_secure_value(app: AppHandle, key: String) -> Result<(), String> {
    let store = open(&app)?;
    store.delete(&key);
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_secure_keys(app: AppHandle) -> Result<Vec<String>, String> {
    let store = open(&app)?;
    Ok(store.keys().into_iter().map(|k| k.to_string()).collect())
}

#[tauri::command]
pub fn wipe_secure_store(app: AppHandle) -> Result<(), String> {
    let store = open(&app)?;
    store.clear();
    store.save().map_err(|e| e.to_string())
}
