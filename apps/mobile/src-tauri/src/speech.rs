use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

/// Minimal Tauri plugin that bridges to Android's SpeechRecognizer.
/// Actual recognition logic lives in Kotlin (SpeechPlugin.kt).
/// Commands are defined on the Kotlin side via @Command annotations
/// and invoked from the frontend as `plugin:speech|startRecognition`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R, ()>::new("speech").build()
}
