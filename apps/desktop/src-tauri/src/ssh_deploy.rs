use clawno_core::ssh::{self, SshArgs};
use clawno_core::types::{StepPhase, StepProgress, StepResult, STEP_PROGRESS_EVENT};
use tauri::Emitter;

fn make_emitter(app: &tauri::AppHandle, step_id: &str) -> impl Fn(&str) + Send + 'static {
    let app = app.clone();
    let step_id = step_id.to_string();
    move |line: &str| {
        let mut p = StepProgress::new(&step_id, "ssh", 0, 1);
        p.phase = StepPhase::Installing;
        p.message = line.to_string();
        let _ = app.emit(STEP_PROGRESS_EVENT, &p);
    }
}

#[tauri::command]
pub async fn deploy_remote_connect(args: SshArgs, app: tauri::AppHandle) -> StepResult {
    if let Err(e) = ssh::validate_ssh_args(&args) {
        return StepResult::err(e);
    }
    let on_line = make_emitter(&app, "remote-connect");
    match ssh::ssh_exec_streaming(
        &args,
        "echo connection-ok && uname -srm 2>/dev/null || echo ok",
        on_line,
    )
    .await
    {
        Ok((0, out)) => StepResult::ok(format!("ssh-connected:{}", ssh::last_line(&out))),
        Ok((code, out)) => StepResult::err(format!("ssh-exit-{code}:{out}")),
        Err(e) => StepResult::err(e),
    }
}

#[tauri::command]
pub async fn deploy_remote_check_node(args: SshArgs, app: tauri::AppHandle) -> StepResult {
    let script = ssh::check_node_script(true);
    let on_line = make_emitter(&app, "remote-check-node");
    match ssh::ssh_exec_streaming(&args, &script, on_line).await {
        Ok((0, out)) => StepResult::ok(ssh::last_line(&out)),
        Ok((_, out)) => StepResult::err(format!("node-not-found:{}", ssh::last_line(&out))),
        Err(e) => StepResult::err(e),
    }
}

#[tauri::command]
pub async fn deploy_remote_install_openclaw(args: SshArgs, app: tauri::AppHandle) -> StepResult {
    let on_line = make_emitter(&app, "remote-install-openclaw");
    match ssh::ssh_exec_streaming(&args, ssh::INSTALL_OPENCLAW_SCRIPT, on_line).await {
        Ok((0, out)) => StepResult::ok(ssh::last_line(&out)),
        Ok((_, out)) => {
            StepResult::err(format!("install-openclaw-failed:{}", ssh::last_line(&out)))
        }
        Err(e) => StepResult::err(e),
    }
}

#[tauri::command]
pub async fn deploy_remote_onboard(args: SshArgs, app: tauri::AppHandle) -> StepResult {
    let on_line = make_emitter(&app, "remote-onboard");
    match ssh::ssh_exec_streaming(&args, ssh::ONBOARD_SCRIPT, on_line).await {
        Ok(_) => StepResult::ok("config-initialized".to_string()),
        Err(e) => StepResult::err(e),
    }
}

#[tauri::command]
pub async fn deploy_remote_start_gateway(args: SshArgs, app: tauri::AppHandle) -> StepResult {
    let port = args.gateway_port;
    let script = ssh::start_gateway_script(port);
    let on_line = make_emitter(&app, "remote-start-gateway");
    match ssh::ssh_exec_streaming(&args, &script, on_line).await {
        Ok((0, _)) => StepResult::ok(format!("gateway-ready:{port}")),
        Ok((_, out)) => StepResult::err(format!("gateway-start-failed:{}", ssh::last_line(&out))),
        Err(e) => StepResult::err(e),
    }
}

#[tauri::command]
pub async fn deploy_remote_install_clawno_server(
    args: SshArgs,
    app: tauri::AppHandle,
) -> StepResult {
    let on_line = make_emitter(&app, "remote-install-clawno-server");
    match ssh::ssh_exec_streaming(&args, ssh::INSTALL_CLAWNO_SERVER_SCRIPT, on_line).await {
        Ok((0, out)) => StepResult::ok(ssh::last_line(&out)),
        Ok((_, out)) => StepResult::err(format!(
            "install-clawno-server-failed:{}",
            ssh::last_line(&out)
        )),
        Err(e) => StepResult::err(e),
    }
}

#[tauri::command]
pub async fn deploy_remote_start_clawno_server(
    args: SshArgs,
    server_port: u16,
    app: tauri::AppHandle,
) -> StepResult {
    let gateway_port = args.gateway_port;
    let script = ssh::start_clawno_server_script(server_port, gateway_port);
    let on_line = make_emitter(&app, "remote-start-clawno-server");
    match ssh::ssh_exec_streaming(&args, &script, on_line).await {
        Ok((0, _)) => StepResult::ok(format!("clawno-server-ready:{server_port}")),
        Ok((_, out)) => StepResult::err(format!(
            "clawno-server-start-failed:{}",
            ssh::last_line(&out)
        )),
        Err(e) => StepResult::err(e),
    }
}
