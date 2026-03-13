use clawno_core::rag::{validate_and_read_sync, PLATFORM_CONFIG};

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    validate_and_read_sync(&path, &PLATFORM_CONFIG)
}
