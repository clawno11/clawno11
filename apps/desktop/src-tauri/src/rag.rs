use clawno_core::rag::{validate_and_read_async, PLATFORM_CONFIG};

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    validate_and_read_async(&path, &PLATFORM_CONFIG).await
}
