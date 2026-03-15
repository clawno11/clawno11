use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;

use crate::platform::augmented_path;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Outcome of a watchdog-monitored subprocess execution.
#[derive(Debug)]
pub enum WatchdogResult {
    /// Process completed normally (may have non-zero exit code).
    Completed {
        exit_code: i32,
        stdout: String,
        stderr: String,
    },
    /// No output activity for the stall timeout — process was killed.
    Stalled {
        partial_stdout: String,
        partial_stderr: String,
        elapsed_secs: u64,
    },
    /// Failed to even spawn the process.
    SpawnFailed(String),
}

impl WatchdogResult {
    pub fn success(&self) -> bool {
        matches!(self, WatchdogResult::Completed { exit_code: 0, .. })
    }

    pub fn is_stalled(&self) -> bool {
        matches!(self, WatchdogResult::Stalled { .. })
    }

    pub fn stdout(&self) -> &str {
        match self {
            WatchdogResult::Completed { stdout, .. } => stdout,
            WatchdogResult::Stalled { partial_stdout, .. } => partial_stdout,
            WatchdogResult::SpawnFailed(_) => "",
        }
    }

    pub fn stderr(&self) -> &str {
        match self {
            WatchdogResult::Completed { stderr, .. } => stderr,
            WatchdogResult::Stalled { partial_stderr, .. } => partial_stderr,
            WatchdogResult::SpawnFailed(msg) => msg,
        }
    }
}

/// Run a shell command with a stall-detection watchdog.
///
/// If the subprocess produces no stdout/stderr output for `stall_timeout`,
/// the process is killed and `WatchdogResult::Stalled` is returned.
///
/// `on_output` is called for each line of combined output, enabling
/// real-time progress parsing.
///
/// When `allow_window` is true on Windows, the subprocess is NOT created with
/// CREATE_NO_WINDOW, so UAC and installer GUIs can appear.
pub async fn run_with_watchdog<F>(
    cmd: &str,
    stall_timeout: Duration,
    on_output: F,
    allow_window: bool,
) -> WatchdogResult
where
    F: Fn(&str) + Send + Sync + 'static,
{
    let last_activity = Arc::new(AtomicU64::new(epoch_secs()));
    let killed = Arc::new(AtomicBool::new(false));

    #[cfg(target_os = "windows")]
    let mut child = {
        let mut c = TokioCommand::new("cmd");
        c.args(["/C", cmd]);
        if !allow_window {
            c.creation_flags(CREATE_NO_WINDOW);
        }
        c.env("PATH", augmented_path());
        c.stdout(std::process::Stdio::piped());
        c.stderr(std::process::Stdio::piped());
        match c.spawn() {
            Ok(child) => child,
            Err(e) => return WatchdogResult::SpawnFailed(e.to_string()),
        }
    };

    #[cfg(not(target_os = "windows"))]
    let mut child = {
        let mut c = TokioCommand::new("sh");
        c.args(["-c", cmd]);
        c.env("PATH", augmented_path());
        c.stdout(std::process::Stdio::piped());
        c.stderr(std::process::Stdio::piped());
        match c.spawn() {
            Ok(child) => child,
            Err(e) => return WatchdogResult::SpawnFailed(e.to_string()),
        }
    };

    let child_stdout = child.stdout.take().unwrap();
    let child_stderr = child.stderr.take().unwrap();

    let stdout_buf = Arc::new(tokio::sync::Mutex::new(String::new()));
    let stderr_buf = Arc::new(tokio::sync::Mutex::new(String::new()));

    let on_output = Arc::new(on_output);

    // Spawn stdout reader
    let la1 = last_activity.clone();
    let sb1 = stdout_buf.clone();
    let on1 = on_output.clone();
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(child_stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            la1.store(epoch_secs(), Ordering::Relaxed);
            on1(&line);
            sb1.lock().await.push_str(&line);
            sb1.lock().await.push('\n');
        }
    });

    // Spawn stderr reader
    let la2 = last_activity.clone();
    let sb2 = stderr_buf.clone();
    let on2 = on_output.clone();
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(child_stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            la2.store(epoch_secs(), Ordering::Relaxed);
            on2(&line);
            sb2.lock().await.push_str(&line);
            sb2.lock().await.push('\n');
        }
    });

    // Spawn watchdog timer
    let la_wd = last_activity.clone();
    let killed_wd = killed.clone();
    let child_id = child.id();
    let wd_stall = stall_timeout;
    let watchdog_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let last = la_wd.load(Ordering::Relaxed);
            let now = epoch_secs();
            if now.saturating_sub(last) >= wd_stall.as_secs() {
                // Before declaring "stalled", check if the process has active
                // child processes (e.g. msiexec.exe during silent install).
                // Active children = still working, just no stdout output.
                if let Some(pid) = child_id {
                    if has_active_children(pid) {
                        la_wd.store(epoch_secs(), Ordering::Relaxed);
                        continue;
                    }
                    killed_wd.store(true, Ordering::Relaxed);
                    kill_process(pid);
                }
                return;
            }
        }
    });

    // Wait for the child to finish (or be killed)
    let status = child.wait().await;

    // Cancel the watchdog
    watchdog_task.abort();
    let _ = stdout_task.await;
    let _ = stderr_task.await;

    let out = stdout_buf.lock().await.trim().to_string();
    let err = stderr_buf.lock().await.trim().to_string();

    if killed.load(Ordering::Relaxed) {
        let start = last_activity.load(Ordering::Relaxed);
        return WatchdogResult::Stalled {
            partial_stdout: out,
            partial_stderr: err,
            elapsed_secs: epoch_secs().saturating_sub(start),
        };
    }

    WatchdogResult::Completed {
        exit_code: status.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1),
        stdout: out,
        stderr: err,
    }
}

/// Download HTTP body with per-chunk stall detection.
///
/// Returns `Ok(bytes)` on success, `Err(reason)` on stall or network error.
/// Calls `on_progress(bytes_done, bytes_total, speed_bps)` periodically.
pub async fn download_with_watchdog<F>(
    response: reqwest::Response,
    stall_timeout: Duration,
    on_progress: F,
) -> Result<Vec<u8>, String>
where
    F: Fn(u64, u64, f64),
{
    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let start = std::time::Instant::now();
    let mut body = Vec::with_capacity(total as usize);
    let mut stream = response;

    loop {
        match tokio::time::timeout(stall_timeout, stream.chunk()).await {
            Ok(Ok(Some(chunk))) => {
                body.extend_from_slice(&chunk);
                downloaded += chunk.len() as u64;
                let elapsed = start.elapsed().as_secs_f64();
                let speed = if elapsed > 0.1 {
                    downloaded as f64 / elapsed
                } else {
                    0.0
                };
                on_progress(downloaded, total, speed);
            }
            Ok(Ok(None)) => break,
            Ok(Err(e)) => return Err(format!("download-error: {}", e)),
            Err(_) => return Err("download-stalled: no data received for 30s".into()),
        }
    }

    Ok(body)
}

/// Write downloaded bytes to a file with progress callbacks.
pub async fn download_to_file_with_watchdog<F>(
    response: reqwest::Response,
    dest: &std::path::Path,
    stall_timeout: Duration,
    on_progress: F,
) -> Result<u64, String>
where
    F: Fn(u64, u64, f64),
{
    use tokio::io::AsyncWriteExt;

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let start = std::time::Instant::now();
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("file-create-failed: {}", e))?;
    let mut stream = response;

    loop {
        match tokio::time::timeout(stall_timeout, stream.chunk()).await {
            Ok(Ok(Some(chunk))) => {
                file.write_all(&chunk)
                    .await
                    .map_err(|e| format!("write-failed: {}", e))?;
                downloaded += chunk.len() as u64;
                let elapsed = start.elapsed().as_secs_f64();
                let speed = if elapsed > 0.1 {
                    downloaded as f64 / elapsed
                } else {
                    0.0
                };
                on_progress(downloaded, total, speed);
            }
            Ok(Ok(None)) => break,
            Ok(Err(e)) => {
                let _ = tokio::fs::remove_file(dest).await;
                return Err(format!("download-error: {}", e));
            }
            Err(_) => {
                let _ = tokio::fs::remove_file(dest).await;
                return Err("download-stalled: no data received for 30s".into());
            }
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("flush-failed: {}", e))?;

    Ok(downloaded)
}

fn epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(target_os = "windows")]
fn kill_process(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F", "/T"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

#[cfg(not(target_os = "windows"))]
fn kill_process(pid: u32) {
    let _ = std::process::Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output();
}

/// Check if a process has active child processes.
/// Used to distinguish "stalled" from "working silently" (e.g. msiexec.exe).
#[cfg(target_os = "windows")]
fn has_active_children(pid: u32) -> bool {
    let out = std::process::Command::new("wmic")
        .args([
            "process",
            "where",
            &format!("ParentProcessId={}", pid),
            "get",
            "ProcessId",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match out {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout);
            // WMIC outputs a header line "ProcessId" then one line per child.
            // More than 1 non-empty line = has children.
            text.lines()
                .filter(|l| l.trim().chars().all(|c| c.is_ascii_digit()) && !l.trim().is_empty())
                .count()
                > 0
        }
        Err(_) => false,
    }
}

#[cfg(not(target_os = "windows"))]
fn has_active_children(pid: u32) -> bool {
    let out = std::process::Command::new("pgrep")
        .args(["-P", &pid.to_string()])
        .output();
    match out {
        Ok(o) => o.status.success() && !o.stdout.is_empty(),
        Err(_) => false,
    }
}
