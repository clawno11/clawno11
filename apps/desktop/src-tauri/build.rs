fn main() {
    #[cfg(target_os = "windows")]
    println!("cargo:rustc-link-arg-bins=/STACK:16777216");

    tauri_build::build()
}
