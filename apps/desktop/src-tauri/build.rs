fn main() {
    #[cfg(target_os = "windows")]
    println!("cargo:rustc-link-arg=/STACK:16777216");

    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-arg=-Wl,-stack_size,0x1000000");

    tauri_build::build()
}
