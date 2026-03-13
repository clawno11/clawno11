fn main() {
    #[cfg(target_os = "windows")]
    println!("cargo:rustc-link-arg-bins=/STACK:16777216");

    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-arg-bins=-Wl,-stack_size,0x1000000");

    tauri_build::build()
}
