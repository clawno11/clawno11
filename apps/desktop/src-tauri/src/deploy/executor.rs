use std::time::Duration;

use tauri::Emitter;

use clawno_core::types::{
    Diagnosis, ErrorCategory, Remedy, RetryPolicy, StepPhase, StepProgress, StepResult,
    STEP_PROGRESS_EVENT,
};

use super::diagnosis;

#[cfg(target_os = "windows")]
use crate::platform::shell_output;
use crate::platform::{shell_ok, PlatformProfile};

/// Result of applying remedies — tracks whether SSL was disabled so caller
/// can restore it after the retry completes.
enum RemedyResult {
    Applied { ssl_disabled: bool },
    NoneApplied,
}

// ── Strategy trait ───────────────────────────────────────────────────────────

/// A single install/download method (e.g. "winget", "choco", "npm-tarball").
#[async_trait::async_trait]
pub trait Strategy: Send + Sync {
    fn name(&self) -> &str;
    async fn execute(&self, ctx: &mut StepContext) -> StrategyOutcome;
}

#[derive(Debug)]
pub enum StrategyOutcome {
    /// Strategy completed and the verifier should confirm.
    Success(String),
    /// Strategy failed with this output for diagnosis.
    Failed {
        stdout: String,
        stderr: String,
        exit_code: Option<i32>,
    },
    /// The process stalled (watchdog fired).
    Stalled { stdout: String, stderr: String },
}

// ── Step context ─────────────────────────────────────────────────────────────

/// Mutable context passed to each strategy, carrying shared state.
pub struct StepContext {
    pub profile: PlatformProfile,
    pub fixes: Vec<String>,
    pub emitter: ProgressEmitter,
    pub stall_timeout: Duration,
    pub strategy_idx: u8,
    pub strategy_total: u8,
}

impl StepContext {
    pub fn emit_progress(&self, progress: &StepProgress) {
        self.emitter.emit(progress);
    }
}

// ── Progress emitter ─────────────────────────────────────────────────────────

/// Wraps a `tauri::AppHandle` to emit progress events.
#[derive(Clone)]
pub struct ProgressEmitter {
    app: Option<tauri::AppHandle>,
}

impl ProgressEmitter {
    pub fn new(app: &tauri::AppHandle) -> Self {
        Self {
            app: Some(app.clone()),
        }
    }

    /// For unit tests or headless usage.
    pub fn noop() -> Self {
        Self { app: None }
    }

    pub fn emit(&self, progress: &StepProgress) {
        if let Some(ref app) = self.app {
            let _ = app.emit(STEP_PROGRESS_EVENT, progress);
        }
    }
}

// ── Strategy chain executor ──────────────────────────────────────────────────

pub struct StrategyChain {
    pub step_id: String,
    pub strategies: Vec<Box<dyn Strategy>>,
    pub stall_timeout: Duration,
    pub verifier: Box<dyn Fn() -> Option<String> + Send + Sync>,
}

impl StrategyChain {
    /// Execute the strategy chain with smart retry logic.
    ///
    /// Pass 1: try each strategy in order.
    /// On network/timeout errors: retry the same strategy once after applying remedies.
    /// On stall: skip to next strategy immediately.
    /// On permission/disk errors: return a user-prompt result.
    /// After each attempt (success or failure): run the verifier.
    pub async fn execute(&self, app: &tauri::AppHandle, profile: &PlatformProfile) -> StepResult {
        let total = self.strategies.len() as u8;
        let mut all_fixes: Vec<String> = Vec::new();
        let emitter = ProgressEmitter::new(app);

        // Pass 1: try each strategy
        for (idx, strategy) in self.strategies.iter().enumerate() {
            let mut ctx = StepContext {
                profile: profile.clone(),
                fixes: Vec::new(),
                emitter: emitter.clone(),
                stall_timeout: self.stall_timeout,
                strategy_idx: idx as u8,
                strategy_total: total,
            };

            let mut progress = StepProgress::new(&self.step_id, strategy.name(), idx as u8, total);
            progress.phase = StepPhase::Installing;
            progress.message = format!("trying: {}", strategy.name());
            emitter.emit(&progress);

            let outcome = strategy.execute(&mut ctx).await;
            all_fixes.append(&mut ctx.fixes);

            match outcome {
                StrategyOutcome::Success(detail) => {
                    all_fixes.push(format!("strategy-ok:{}", strategy.name()));
                    if let Some(ver) = (self.verifier)() {
                        progress.phase = StepPhase::Done;
                        progress.pct = 100.0;
                        progress.message = format!("verified: {}", ver);
                        emitter.emit(&progress);
                        return StepResult::ok_fixed(format!("{}:{}", detail, ver), all_fixes);
                    }
                    all_fixes.push(format!("strategy-ok-verify-failed:{}", strategy.name()));
                }

                StrategyOutcome::Stalled { stdout, stderr } => {
                    all_fixes.push(format!("stalled:{}", strategy.name()));
                    progress.phase = StepPhase::StrategySwitch;
                    progress.message = format!(
                        "stalled after {}s, switching strategy",
                        self.stall_timeout.as_secs()
                    );
                    progress.is_retrying = true;
                    progress.error_sig = Some("process-stalled".into());
                    emitter.emit(&progress);

                    // Even after stall, check if the operation partially succeeded
                    if let Some(ver) = (self.verifier)() {
                        progress.phase = StepPhase::Done;
                        progress.pct = 100.0;
                        emitter.emit(&progress);
                        return StepResult::ok_fixed(
                            format!("stall-but-verified:{}", ver),
                            all_fixes,
                        );
                    }

                    let diag = diagnosis::diagnose(&stderr, &stdout, None);
                    all_fixes.push(format!("diag:{}", diag.signature));
                    continue;
                }

                StrategyOutcome::Failed {
                    stdout,
                    stderr,
                    exit_code,
                } => {
                    let diag = diagnosis::diagnose(&stderr, &stdout, exit_code);
                    all_fixes.push(format!("failed:{}:{}", strategy.name(), diag.signature));

                    progress.error_sig = Some(diag.signature.clone());

                    match diag.policy {
                        RetryPolicy::Abort => {
                            progress.phase = StepPhase::Done;
                            progress.message = diag.raw_message.clone();
                            emitter.emit(&progress);
                            return StepResult::err_fixed(diag.raw_message, all_fixes);
                        }
                        RetryPolicy::UserPrompt => {
                            progress.phase = StepPhase::WaitingForUser;
                            progress.message =
                                format!("needs-user-action: {}", diag.category_label());
                            emitter.emit(&progress);
                            if let RemedyResult::Applied { ssl_disabled } = self.try_remedies(
                                &diag,
                                strategy.name(),
                                &mut all_fixes,
                                &emitter,
                                &mut progress,
                                profile,
                            ) {
                                if let Some(ver) = (self.verifier)() {
                                    Self::restore_ssl_if_needed(ssl_disabled);
                                    progress.phase = StepPhase::Done;
                                    progress.pct = 100.0;
                                    emitter.emit(&progress);
                                    return StepResult::ok_fixed(
                                        format!("remedied:{}", ver),
                                        all_fixes,
                                    );
                                }
                                Self::restore_ssl_if_needed(ssl_disabled);
                            }
                        }
                        RetryPolicy::AutoRetry => {
                            progress.phase = StepPhase::Retrying;
                            progress.is_retrying = true;

                            let ssl_disabled = match self.try_remedies(
                                &diag,
                                strategy.name(),
                                &mut all_fixes,
                                &emitter,
                                &mut progress,
                                profile,
                            ) {
                                RemedyResult::Applied { ssl_disabled } => {
                                    if let Some(ver) = (self.verifier)() {
                                        Self::restore_ssl_if_needed(ssl_disabled);
                                        progress.phase = StepPhase::Done;
                                        progress.pct = 100.0;
                                        emitter.emit(&progress);
                                        return StepResult::ok_fixed(
                                            format!("remedied:{}", ver),
                                            all_fixes,
                                        );
                                    }
                                    ssl_disabled
                                }
                                RemedyResult::NoneApplied => false,
                            };

                            // Retry the same strategy once after remedies
                            progress.message = format!("retrying: {}", strategy.name());
                            emitter.emit(&progress);

                            let mut ctx2 = StepContext {
                                profile: profile.clone(),
                                fixes: Vec::new(),
                                emitter: emitter.clone(),
                                stall_timeout: self.stall_timeout,
                                strategy_idx: idx as u8,
                                strategy_total: total,
                            };
                            let outcome2 = strategy.execute(&mut ctx2).await;
                            all_fixes.append(&mut ctx2.fixes);

                            // Restore SSL after retry completes, not before
                            Self::restore_ssl_if_needed(ssl_disabled);

                            if matches!(outcome2, StrategyOutcome::Success(_)) {
                                all_fixes.push(format!("retry-ok:{}", strategy.name()));
                                if let Some(ver) = (self.verifier)() {
                                    progress.phase = StepPhase::Done;
                                    progress.pct = 100.0;
                                    emitter.emit(&progress);
                                    return StepResult::ok_fixed(
                                        format!("retry-verified:{}", ver),
                                        all_fixes,
                                    );
                                }
                            }
                        }
                    }

                    // Switch to next strategy
                    if idx + 1 < self.strategies.len() {
                        progress.phase = StepPhase::StrategySwitch;
                        progress.message =
                            format!("switching to: {}", self.strategies[idx + 1].name());
                        emitter.emit(&progress);
                    }
                }
            }

            // Even if strategy reported failure, always check verifier
            if let Some(ver) = (self.verifier)() {
                let mut p = progress.clone();
                p.phase = StepPhase::Done;
                p.pct = 100.0;
                emitter.emit(&p);
                all_fixes.push(format!("unexpected-verify-ok:{}", strategy.name()));
                return StepResult::ok_fixed(format!("verified-despite-error:{}", ver), all_fixes);
            }
        }

        // Pass 2: for network errors, retry all strategies once with backoff
        let last_diag = all_fixes.iter().any(|f| {
            f.contains("network-timeout")
                || f.contains("network-unreachable")
                || f.contains("ssl-error")
        });

        if last_diag && self.strategies.len() > 1 {
            all_fixes.push("pass2-network-retry".into());
            for (idx, strategy) in self.strategies.iter().enumerate() {
                let delay = Duration::from_secs(3 * (idx as u64 + 1));
                tokio::time::sleep(delay).await;

                let mut progress =
                    StepProgress::new(&self.step_id, strategy.name(), idx as u8, total);
                progress.phase = StepPhase::Retrying;
                progress.is_retrying = true;
                progress.message = format!("pass 2 retry: {}", strategy.name());
                emitter.emit(&progress);

                let mut ctx = StepContext {
                    profile: profile.clone(),
                    fixes: Vec::new(),
                    emitter: emitter.clone(),
                    stall_timeout: self.stall_timeout,
                    strategy_idx: idx as u8,
                    strategy_total: total,
                };

                let outcome = strategy.execute(&mut ctx).await;
                all_fixes.append(&mut ctx.fixes);

                if matches!(outcome, StrategyOutcome::Success(_)) {
                    if let Some(ver) = (self.verifier)() {
                        progress.phase = StepPhase::Done;
                        progress.pct = 100.0;
                        emitter.emit(&progress);
                        return StepResult::ok_fixed(format!("pass2-verified:{}", ver), all_fixes);
                    }
                }

                if let Some(ver) = (self.verifier)() {
                    return StepResult::ok_fixed(
                        format!("pass2-unexpected-verify:{}", ver),
                        all_fixes,
                    );
                }
            }
        }

        // All strategies exhausted
        let last_err = all_fixes
            .iter()
            .rev()
            .find(|f| f.starts_with("failed:") || f.starts_with("stalled:"))
            .cloned()
            .unwrap_or_else(|| "all-strategies-exhausted".into());

        StepResult::err_fixed(format!("{}: {}", self.step_id, last_err), all_fixes)
    }

    /// Apply remedies and return whether SSL was disabled (caller must restore).
    fn try_remedies(
        &self,
        diag: &Diagnosis,
        _strategy_name: &str,
        fixes: &mut Vec<String>,
        emitter: &ProgressEmitter,
        progress: &mut StepProgress,
        _profile: &PlatformProfile,
    ) -> RemedyResult {
        let mut applied_any = false;
        let mut ssl_disabled = false;

        for remedy in &diag.remedies {
            match remedy {
                Remedy::SwitchRegistry => {
                    fixes.push("remedy:switch-registry".into());
                    applied_any = true;
                }
                Remedy::CleanNpmCache => {
                    progress.remedy = Some("cleaning npm cache".into());
                    emitter.emit(progress);
                    shell_ok("npm cache clean --force");
                    fixes.push("remedy:clean-npm-cache".into());
                    applied_any = true;
                }
                Remedy::DisableSsl => {
                    progress.remedy = Some("disabling strict SSL temporarily".into());
                    emitter.emit(progress);
                    shell_ok("npm config set strict-ssl false");
                    fixes.push("remedy:disable-ssl".into());
                    applied_any = true;
                    ssl_disabled = true;
                }
                Remedy::RefreshPath => {
                    #[cfg(target_os = "windows")]
                    {
                        let new_path = shell_output(
                            "powershell -NoProfile -Command \"\
                             $m=[System.Environment]::GetEnvironmentVariable('PATH','Machine'); \
                             $u=[System.Environment]::GetEnvironmentVariable('PATH','User'); \
                             \"$m;$u\"\"",
                        );
                        if !new_path.is_empty() {
                            let current = std::env::var("PATH").unwrap_or_default();
                            std::env::set_var("PATH", format!("{};{}", new_path, current));
                            fixes.push("remedy:refresh-path".into());
                            applied_any = true;
                        }
                    }
                }
                Remedy::UseUserPrefix => {
                    fixes.push("remedy:will-use-user-prefix".into());
                    applied_any = true;
                }
                Remedy::KillPortOccupant
                | Remedy::ResetConfig
                | Remedy::RestartDaemon
                | Remedy::TryNextStrategy
                | Remedy::DirectDownload
                | Remedy::RescanNodeVersion
                | Remedy::InstallGit => {
                    fixes.push(format!("remedy:deferred:{:?}", remedy));
                    applied_any = true;
                }
            }
        }

        if applied_any {
            RemedyResult::Applied { ssl_disabled }
        } else {
            RemedyResult::NoneApplied
        }
    }

    /// Restore SSL strict mode after a remedy+retry cycle.
    fn restore_ssl_if_needed(ssl_disabled: bool) {
        if ssl_disabled {
            shell_ok("npm config set strict-ssl true");
        }
    }
}

// ── Helper: Diagnosis category label ─────────────────────────────────────────

trait DiagnosisCategoryLabel {
    fn category_label(&self) -> &str;
}

impl DiagnosisCategoryLabel for Diagnosis {
    fn category_label(&self) -> &str {
        match self.category {
            ErrorCategory::PermissionDenied => "permission-denied",
            ErrorCategory::NetworkTimeout => "network-timeout",
            ErrorCategory::NetworkUnreachable => "network-unreachable",
            ErrorCategory::DiskFull => "disk-full",
            ErrorCategory::CacheCorrupt => "cache-corrupt",
            ErrorCategory::SslError => "ssl-error",
            ErrorCategory::PortInUse => "port-in-use",
            ErrorCategory::ConfigCorrupt => "config-corrupt",
            ErrorCategory::BinaryNotFound => "binary-not-found",
            ErrorCategory::GitNotInstalled => "git-not-installed",
            ErrorCategory::VersionTooOld => "version-too-old",
            ErrorCategory::NodeVersionMismatch => "node-version-mismatch",
            ErrorCategory::ProcessStalled => "process-stalled",
            ErrorCategory::ProcessCrash => "process-crash",
            ErrorCategory::Unknown => "unknown",
        }
    }
}
