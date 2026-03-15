mod check;
mod install;
/// Node.js and openclaw npm-package management.
///
/// Handles detection, version checking, automatic installation/upgrade of
/// Node.js, and global installation of the `openclaw` CLI package.
mod npm;
mod scan;

// Re-export public items so `crate::node::X` continues to work unchanged.
// Wildcard re-exports are necessary for Tauri command sub-modules because
// `#[tauri::command]` generates hidden `__cmd__` items that must be visible
// at the `node::` level for `generate_handler![]` in lib.rs.

pub use npm::{npm_install_with_fallback, DeployDownloadProgress};

pub use scan::{
    find_node_exe, node_major, scan_node_paths, scan_openclaw_bin_dir, scan_openclaw_mjs,
};
pub(crate) use scan::{inject_dir, openclaw_semver};

/// Expose nvm directory path for gateway pre-flight recovery.
#[cfg(not(target_os = "windows"))]
pub fn nvm_dir_path() -> String {
    scan::nvm_dir()
}

pub use check::*;
pub use install::*;
