use super::*;

pub(crate) fn current_platform_id() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else {
        "windows"
    }
}

pub(crate) fn resolve_adapter_launch(
    db: &Connection,
    adapter_id: &str,
) -> Result<(String, Vec<String>)> {
    let adapter = launchable_adapter(db, adapter_id)?;
    let mut parts = split_launch_command(&adapter.launch_command)?;
    let command = parts.remove(0);
    Ok((command, parts))
}

#[derive(Debug, Clone)]
pub(crate) struct StructuredAdapterLaunch {
    pub(crate) launch_command: String,
    pub(crate) prompt_delivery: String,
    pub(crate) protocol: StructuredProtocol,
}

pub(crate) fn resolve_structured_adapter_launch(
    db: &Connection,
    adapter_id: &str,
) -> Result<StructuredAdapterLaunch> {
    let adapter = launchable_adapter(db, adapter_id)?;
    let profile = adapter
        .streaming
        .as_ref()
        .and_then(|streaming| streaming.get("preferred"))
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("adapter has no preferred structured profile: {adapter_id}"))?;
    let required_string = |field: &str| {
        profile
            .get(field)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .ok_or_else(|| anyhow!("adapter structured profile is missing {field}: {adapter_id}"))
    };
    let launch_command = required_string("launchCommand")?;
    let prompt_delivery = required_string("promptDelivery")?.to_ascii_lowercase();
    let protocol_name = required_string("protocol")?;
    let session_mode = required_string("sessionMode")?;
    if !session_mode.starts_with("persistent-")
        || profile.get("supportsFollowUp").and_then(Value::as_bool) != Some(true)
    {
        bail!(
            "adapter preferred structured profile must support persistent follow-up: {adapter_id}"
        );
    }
    let protocol = StructuredProtocol::parse(&protocol_name)?;
    if prompt_delivery != protocol.prompt_delivery() {
        bail!(
            "adapter preferred structured profile is unsupported by the runner: {prompt_delivery}/{protocol_name}"
        );
    }
    Ok(StructuredAdapterLaunch {
        launch_command,
        prompt_delivery,
        protocol,
    })
}

fn launchable_adapter(db: &Connection, adapter_id: &str) -> Result<AdapterDto> {
    let adapter = adapter_registry(db)?
        .into_iter()
        .find(|candidate| candidate.id == adapter_id)
        .ok_or_else(|| anyhow!("unsupported adapter: {adapter_id}"))?;
    if !adapter.enabled {
        bail!("adapter is disabled: {adapter_id}");
    }
    validate_adapter_manifest(&adapter)?;
    let platform = current_platform_id();
    if !adapter
        .supported_platforms
        .iter()
        .any(|candidate| candidate == platform)
    {
        bail!("adapter {} does not support {platform}", adapter.id);
    }
    Ok(adapter)
}

pub(crate) fn resolve_command(command: &str, args: &[String]) -> (String, Vec<String>) {
    if command != "system-default-shell" {
        return resolve_adapter_command(command, args);
    }
    let (command, mut shell_args) = default_shell_command();
    shell_args.extend(args.iter().cloned());
    (command, shell_args)
}

pub(crate) fn resolve_adapter_command(command: &str, args: &[String]) -> (String, Vec<String>) {
    if let Some(command_path) = resolve_executable_path(command) {
        if cfg!(windows) && is_windows_command_script(&command_path) {
            return windows_command_script(command_path.to_string_lossy().as_ref(), args);
        }
        return (command_path.to_string_lossy().to_string(), args.to_vec());
    }
    if cfg!(windows) {
        let command_path = PathBuf::from(command);
        if is_windows_command_script(&command_path) {
            return windows_command_script(command_path.to_string_lossy().as_ref(), args);
        }
    }
    (command.to_string(), args.to_vec())
}

#[cfg(windows)]
fn is_windows_command_script(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
        })
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_windows_command_script(_: &Path) -> bool {
    false
}

fn windows_command_script(command: &str, args: &[String]) -> (String, Vec<String>) {
    let mut script_args = vec!["/d".to_string(), "/c".to_string(), command.to_string()];
    script_args.extend(args.iter().cloned());
    ("cmd".to_string(), script_args)
}

#[cfg(windows)]
pub(crate) fn default_shell_command() -> (String, Vec<String>) {
    (
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()),
        vec!["/d".to_string(), "/k".to_string()],
    )
}

#[cfg(not(windows))]
pub(crate) fn default_shell_command() -> (String, Vec<String>) {
    (
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()),
        Vec::new(),
    )
}

pub(crate) fn resolve_optional_cwd(cwd: Option<&str>) -> Result<PathBuf> {
    let path = match cwd.map(str::trim).filter(|value| !value.is_empty()) {
        Some(cwd) => expand_home_path(cwd),
        None => home_dir().ok_or_else(|| anyhow!("home directory is unavailable"))?,
    };
    if !path.exists() {
        bail!("working directory does not exist: {}", path.display());
    }
    if !path.is_dir() {
        bail!("working directory is not a directory: {}", path.display());
    }
    Ok(normalize_command_cwd(path.canonicalize()?))
}

#[cfg(windows)]
pub(crate) fn normalize_command_cwd(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

#[cfg(not(windows))]
pub(crate) fn normalize_command_cwd(path: PathBuf) -> PathBuf {
    path
}

pub(crate) fn payload_bytes(payload: &Value) -> Result<Vec<u8>> {
    if let Some(value) = payload.get("dataBase64").and_then(Value::as_str) {
        return general_purpose::STANDARD
            .decode(value)
            .map_err(|error| anyhow!(error.to_string()));
    }
    if let Some(value) = payload.get("data").and_then(Value::as_str) {
        return Ok(value.as_bytes().to_vec());
    }
    if let Some(values) = payload.get("data").and_then(Value::as_array) {
        return values
            .iter()
            .map(|value| {
                value
                    .as_u64()
                    .filter(|byte| *byte <= u8::MAX as u64)
                    .map(|byte| byte as u8)
                    .ok_or_else(|| anyhow!("pty_write payload.data must contain bytes"))
            })
            .collect();
    }
    bail!("pty_write payload.data or payload.dataBase64 is required");
}

pub(crate) fn split_launch_command(value: &str) -> Result<Vec<String>> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = value.trim().chars().peekable();
    let mut quote: Option<char> = None;
    while let Some(ch) = chars.next() {
        match (quote, ch) {
            (Some(active), next) if next == active => quote = None,
            (Some(_), '\\') => {
                if let Some(next) = chars.peek().copied() {
                    if matches!(next, '"' | '\'' | '\\') {
                        if let Some(escaped) = chars.next() {
                            current.push(escaped);
                        }
                    } else {
                        current.push('\\');
                    }
                } else {
                    current.push('\\');
                }
            }
            (Some(_), next) => current.push(next),
            (None, '"' | '\'') => quote = Some(ch),
            (None, next) if next.is_whitespace() => {
                if !current.is_empty() {
                    parts.push(std::mem::take(&mut current));
                }
            }
            (None, next) => current.push(next),
        }
    }
    if quote.is_some() {
        bail!("adapter launch command has an unterminated quote");
    }
    if !current.is_empty() {
        parts.push(current);
    }
    if parts.is_empty() {
        bail!("adapter launch command is required");
    }
    Ok(parts)
}

pub(crate) fn adapter_registry(db: &Connection) -> Result<Vec<AdapterDto>> {
    Ok(merge_adapters(
        built_in_adapters(),
        load_custom_adapters(db)?,
    ))
}

const RETIRED_BUILT_IN_ADAPTER_IDS: &[&str] = &["gemini-cli", "cursor-cli", "hermes-agent"];

fn is_retired_built_in_adapter(id: &str) -> bool {
    RETIRED_BUILT_IN_ADAPTER_IDS.contains(&id)
}

fn is_legacy_codex_stdin_adapter(adapter: &AdapterDto) -> bool {
    adapter.id == "codex-cli"
        && adapter.prompt_injection == "stdin"
        && matches!(
            adapter.launch_command.trim(),
            "codex" | "codex --no-alt-screen"
        )
}

fn merge_adapters(
    mut adapters: Vec<AdapterDto>,
    custom_adapters: Vec<AdapterDto>,
) -> Vec<AdapterDto> {
    for mut custom in custom_adapters {
        if is_retired_built_in_adapter(&custom.id) {
            continue;
        }
        if is_legacy_codex_stdin_adapter(&custom) {
            custom.prompt_injection = "paste_then_enter".to_string();
        }
        if let Some(index) = adapters.iter().position(|adapter| adapter.id == custom.id) {
            adapters[index] = custom;
        } else {
            adapters.push(custom);
        }
    }
    adapters
}

pub(crate) fn persist_adapter_manifest(
    db: &Connection,
    mut manifest: AdapterDto,
) -> Result<AdapterDto> {
    if is_retired_built_in_adapter(&manifest.id) {
        bail!("adapter id is retired: {}", manifest.id);
    }
    validate_adapter_manifest(&manifest)?;
    let enabled = manifest.id == "generic-shell" || manifest.enabled;
    manifest.enabled = enabled;
    db.execute(
        "INSERT OR REPLACE INTO adapter_configs (id, manifest_json, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, COALESCE((SELECT created_at FROM adapter_configs WHERE id = ?1), ?4), ?4)",
        params![manifest.id, serde_json::to_string(&manifest)?, enabled, now()],
    )?;
    Ok(manifest)
}

fn built_in_adapters() -> Vec<AdapterDto> {
    vec![
        adapter(
            "claude-code",
            "Claude Code",
            vec!["claude"],
            "claude",
            "Install and authenticate Claude Code, then run adapter detection.",
        ),
        adapter(
            "codex-cli",
            "Codex CLI",
            vec!["codex"],
            "codex --no-alt-screen",
            "Install Codex CLI and sign in with your existing account.",
        ),
        adapter(
            "opencode",
            "OpenCode",
            vec!["opencode"],
            "opencode",
            "Install OpenCode or add a compatible custom adapter.",
        ),
        adapter(
            "pi-coding-agent",
            "Pi",
            vec!["pi"],
            "pi",
            "Install @earendil-works/pi-coding-agent, then run pi /login outside wheeljack.",
        ),
        adapter(
            "generic-shell",
            "Generic Shell",
            shell_candidates(),
            "system-default-shell",
            "Uses the platform default shell when no AI CLI is available.",
        ),
    ]
}

fn adapter(
    id: &str,
    display: &str,
    executables: Vec<&str>,
    launch: &str,
    hint: &str,
) -> AdapterDto {
    let streaming = default_adapter_streaming(id);
    AdapterDto {
        id: id.to_string(),
        display_name: display.to_string(),
        icon: default_adapter_icon(id).to_string(),
        executables: executables.into_iter().map(String::from).collect(),
        supported_platforms: vec!["macos".to_string(), "windows".to_string()],
        supported_approval_policies: default_adapter_approval_policies(id),
        launch_command: launch.to_string(),
        prompt_injection: default_prompt_injection_for_adapter(id).to_string(),
        presentation: Some(default_adapter_presentation(id)),
        supports_structured: structured_profile_available(&streaming),
        streaming,
        status: "unknown".to_string(),
        setup_hint: hint.to_string(),
        enabled: true,
    }
}

fn structured_profile_available(streaming: &Option<Value>) -> bool {
    streaming
        .as_ref()
        .and_then(|value| value.get("preferred"))
        .and_then(|value| value.get("sessionMode"))
        .and_then(Value::as_str)
        .is_some_and(|mode| mode.starts_with("persistent-"))
}

fn default_adapter_icon(id: &str) -> &'static str {
    match id {
        "claude-code" => "agent-claude",
        "codex-cli" => "agent-codex",
        "opencode" => "agent-opencode",
        "pi-coding-agent" => "agent-pi",
        "generic-shell" => "shell",
        _ => "terminal",
    }
}

fn default_prompt_injection_for_adapter(id: &str) -> &'static str {
    match id {
        "claude-code" | "codex-cli" => "paste_then_enter",
        _ => "stdin",
    }
}

fn default_adapter_approval_policies(id: &str) -> Vec<String> {
    let policies: &[&str] = match id {
        "codex-cli" => &["untrusted", "on-request", "never"],
        "claude-code" => &[
            "acceptEdits",
            "auto",
            "plan",
            "dontAsk",
            "manual",
            "bypassPermissions",
        ],
        "opencode" => &["ask", "allow", "deny"],
        _ => &[],
    };
    policies
        .iter()
        .map(|policy| (*policy).to_string())
        .collect()
}

pub(crate) fn pty_input_blocked_reason(adapter_id: &str, terminal_text: &str) -> Option<String> {
    if adapter_id != "claude-code" {
        return None;
    }
    let normalized = terminal_text.to_ascii_lowercase();
    if normalized.contains("security guide")
        && normalized.contains("yes, i trust this folder")
        && normalized.contains("enter to confirm")
    {
        return Some("Claude is waiting for folder trust confirmation. Choose \"Yes, I trust this folder\" in the terminal before sending chat input.".to_string());
    }
    if normalized.contains("paste again to expand")
        || normalized.contains("ctrl+g to edit in notepad")
    {
        return Some("Claude is holding a pasted prompt draft. Submit or clear it in the terminal before sending another message.".to_string());
    }
    None
}

pub(crate) const PASTE_THEN_ENTER_SUBMIT_DELAY_MS: u64 = 180;
const BRACKETED_PASTE_START: &str = "\x1b[200~";
const BRACKETED_PASTE_END: &str = "\x1b[201~";

pub(crate) fn prompt_input_writes_payload(prompt: &str, strategy: &str) -> Value {
    match strategy {
        "manual" => json!({
            "strategy": "manual",
            "writes": []
        }),
        "paste_then_enter" => json!({
            "strategy": "paste_then_enter",
            "writes": [
                {
                    "data": format!("{BRACKETED_PASTE_START}{prompt}{BRACKETED_PASTE_END}"),
                    "delayBeforeMs": 0
                },
                {
                    "data": "\r",
                    "delayBeforeMs": PASTE_THEN_ENTER_SUBMIT_DELAY_MS
                }
            ]
        }),
        _ => json!({
            "strategy": "stdin",
            "writes": [
                {
                    "data": format!("{prompt}\r"),
                    "delayBeforeMs": 0
                }
            ]
        }),
    }
}

pub(crate) fn effective_prompt_injection_for_adapter(
    db: &Connection,
    adapter_id: &str,
) -> Result<String> {
    let adapter_id = adapter_id.trim();
    let configured = adapter_registry(db)?
        .into_iter()
        .find(|adapter| adapter.id == adapter_id)
        .map(|adapter| adapter.prompt_injection);
    let fallback = default_prompt_injection_for_adapter(adapter_id);
    Ok(match (adapter_id, configured.as_deref()) {
        ("claude-code" | "codex-cli", Some("stdin")) => fallback.to_string(),
        (_, Some("manual")) => "manual".to_string(),
        (_, Some("paste_then_enter")) => "paste_then_enter".to_string(),
        (_, Some("stdin")) => "stdin".to_string(),
        _ => fallback.to_string(),
    })
}

fn default_adapter_presentation(id: &str) -> Value {
    let (default_view, parser_id) = default_adapter_presentation_parts(id);
    json!({
        "defaultView": default_view,
        "parserId": parser_id
    })
}

fn default_adapter_presentation_parts(id: &str) -> (&'static str, &'static str) {
    match id {
        "claude-code" => ("chat", "claude-code"),
        "codex-cli" => ("chat", "codex-cli"),
        "opencode" => ("chat", "opencode"),
        "pi-coding-agent" => ("chat", "pi-coding-agent"),
        _ => ("terminal", "generic-lines"),
    }
}

fn normalize_adapter_presentation(id: &str, presentation: Option<Value>) -> Value {
    let (fallback_view, fallback_parser) = default_adapter_presentation_parts(id);
    let default_view = presentation
        .as_ref()
        .and_then(|value| value.get("defaultView"))
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "chat" | "terminal" | "split"))
        .unwrap_or(fallback_view);
    let parser_id = presentation
        .as_ref()
        .and_then(|value| value.get("parserId"))
        .and_then(Value::as_str)
        .filter(|value| {
            matches!(
                *value,
                "generic-lines" | "claude-code" | "codex-cli" | "opencode" | "pi-coding-agent"
            )
        })
        .unwrap_or(fallback_parser);
    json!({
        "defaultView": default_view,
        "parserId": parser_id
    })
}

fn default_adapter_streaming(id: &str) -> Option<Value> {
    match id {
        "claude-code" => Some(json!({
            "preferred": {
                "protocol": "claude-stream-json",
                "launchCommand": "claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose --permission-prompt-tool stdio",
                "promptDelivery": "stdin",
                "docsUrl": "https://code.claude.com/docs/en/cli-reference",
                "sessionMode": "persistent-stdin-jsonl",
                "supportsFollowUp": true
            }
        })),
        "codex-cli" => Some(json!({
            "preferred": {
                "protocol": "codex-app-server",
                "launchCommand": "codex app-server",
                "promptDelivery": "json-rpc",
                "docsUrl": "https://developers.openai.com/codex/app-server",
                "sessionMode": "persistent-json-rpc",
                "supportsFollowUp": true
            }
        })),
        "opencode" => Some(json!({
            "preferred": {
                "protocol": "opencode-sse",
                "launchCommand": "opencode serve",
                "promptDelivery": "sse",
                "docsUrl": "https://opencode.ai/docs/server/",
                "sessionMode": "persistent-sse",
                "supportsFollowUp": true
            }
        })),
        "pi-coding-agent" => Some(json!({
            "preferred": {
                "protocol": "pi-rpc",
                "launchCommand": "pi --mode rpc",
                "promptDelivery": "json-rpc",
                "docsUrl": "https://pi.dev/docs/latest/rpc",
                "sessionMode": "persistent-json-rpc",
                "supportsFollowUp": true
            }
        })),
        _ => None,
    }
}

fn effective_adapter_streaming(id: &str, streaming: Option<Value>) -> Option<Value> {
    let built_in = default_adapter_streaming(id);
    if built_in.is_none() {
        return streaming;
    }
    if streaming
        .as_ref()
        .map(|value| adapter_streaming_needs_refresh(id, value))
        .unwrap_or(true)
    {
        built_in
    } else {
        streaming_with_default_session_metadata(streaming, built_in)
    }
}

fn streaming_with_default_session_metadata(
    streaming: Option<Value>,
    fallback: Option<Value>,
) -> Option<Value> {
    let mut streaming = streaming?;
    let Some(fallback) = fallback else {
        return Some(streaming);
    };
    copy_profile_session_metadata(&mut streaming, &fallback, "preferred");
    Some(streaming)
}

fn copy_profile_session_metadata(streaming: &mut Value, fallback: &Value, key: &str) {
    let Some(profile) = streaming.get_mut(key).and_then(Value::as_object_mut) else {
        return;
    };
    let Some(default_profile) = fallback.get(key).and_then(Value::as_object) else {
        return;
    };
    if profile.get("protocol") != default_profile.get("protocol") {
        return;
    }
    for field in ["sessionMode", "supportsFollowUp"] {
        if !profile.contains_key(field) {
            if let Some(value) = default_profile.get(field) {
                profile.insert(field.to_string(), value.clone());
            }
        }
    }
}

fn adapter_streaming_needs_refresh(id: &str, streaming: &Value) -> bool {
    let preferred = streaming.get("preferred").unwrap_or(&Value::Null);
    let protocol = preferred
        .get("protocol")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match id {
        "claude-code" => {
            let prompt_delivery = preferred
                .get("promptDelivery")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let launch_command = preferred
                .get("launchCommand")
                .and_then(Value::as_str)
                .unwrap_or_default();
            protocol != "claude-stream-json"
                || prompt_delivery != "stdin"
                || !launch_command.contains("--input-format stream-json")
                || !launch_command.contains("--permission-prompt-tool stdio")
                || preferred.get("supportsFollowUp").and_then(Value::as_bool) != Some(true)
        }
        "opencode" => protocol != "opencode-sse",
        _ => false,
    }
}

fn shell_candidates() -> Vec<&'static str> {
    if cfg!(windows) {
        vec!["pwsh", "powershell", "cmd"]
    } else {
        vec!["zsh", "bash", "sh"]
    }
}

fn load_custom_adapters(db: &Connection) -> Result<Vec<AdapterDto>> {
    let mut stmt = db.prepare(
        "SELECT manifest_json, enabled
         FROM adapter_configs
         ORDER BY updated_at ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
    })?;
    let mut adapters = Vec::new();
    for row in rows {
        let (manifest_json, enabled) = row?;
        let mut manifest =
            normalize_adapter_manifest(serde_json::from_str::<AdapterDto>(&manifest_json)?);
        manifest.enabled = enabled;
        if !is_retired_built_in_adapter(&manifest.id)
            && validate_adapter_manifest(&manifest).is_ok()
        {
            adapters.push(manifest);
        }
    }
    Ok(adapters)
}

pub(crate) fn detect_adapter_status(mut adapter: AdapterDto) -> AdapterDto {
    adapter.status = if adapter.executables.iter().any(|exe| executable_exists(exe)) {
        "installed".to_string()
    } else {
        "missing".to_string()
    };
    adapter
}

pub(crate) fn probe_adapter(
    db: &Connection,
    adapter_id: &str,
    launch_args: &[String],
    launch_config: &AdapterLaunchConfig,
) -> Result<AdapterProbeDto> {
    let adapter = adapter_registry(db)?
        .into_iter()
        .find(|candidate| candidate.id == adapter_id)
        .ok_or_else(|| anyhow!("unsupported adapter: {adapter_id}"))?;
    let launch_fingerprint = adapter_launch_fingerprint(&adapter, launch_args, launch_config)?;
    let executable = adapter
        .executables
        .iter()
        .find_map(|candidate| resolve_executable_path(candidate));
    let protocol = adapter
        .streaming
        .as_ref()
        .and_then(|value| value.get("preferred"))
        .and_then(|value| value.get("protocol"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let docs_url = adapter
        .streaming
        .as_ref()
        .and_then(|value| value.get("preferred"))
        .and_then(|value| value.get("docsUrl"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let Some(executable_path) = executable else {
        clear_persisted_adapter_verifications(db, &adapter.id)?;
        return Ok(AdapterProbeDto {
            adapter_id: adapter.id,
            executable_path: None,
            version: None,
            auth_status: "missing".to_string(),
            protocol,
            verification_status: "unavailable".to_string(),
            docs_url,
            repair_command: adapter_repair_command(adapter_id),
            message: adapter.setup_hint,
            checked_at: now(),
            verified_args: Vec::new(),
            verification_fingerprint: None,
        });
    };

    let executable_text = executable_path.to_string_lossy().to_string();
    let version = run_adapter_command(
        &executable_text,
        &["--version"],
        None,
        Duration::from_secs(10),
        None,
    )
    .ok()
    .and_then(|(success, output)| success.then_some(output))
    .and_then(|output| {
        output
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(str::trim)
            .map(str::to_string)
    });
    let auth_args: &[&str] = match adapter_id {
        "codex-cli" => &["login", "status"],
        "claude-code" => &["auth", "status", "--json"],
        "opencode" => &["auth", "list"],
        _ => &[],
    };
    let (auth_status, auth_message) = if auth_args.is_empty() {
        (
            "unknown".to_string(),
            "Authentication cannot be probed for this adapter.".to_string(),
        )
    } else {
        match run_adapter_command(
            &executable_text,
            auth_args,
            None,
            Duration::from_secs(15),
            None,
        ) {
            Ok((success, output)) if adapter_auth_succeeded(adapter_id, success, &output) => (
                "authenticated".to_string(),
                "Installed and authenticated. Run Verify to prove a real turn.".to_string(),
            ),
            Ok(_) => ("unauthenticated".to_string(), adapter.setup_hint.clone()),
            Err(error) => (
                "unknown".to_string(),
                format!("Authentication check failed: {error}"),
            ),
        }
    };
    let mut probe = AdapterProbeDto {
        adapter_id: adapter.id,
        executable_path: Some(executable_text),
        version,
        auth_status,
        protocol,
        verification_status: "untested".to_string(),
        docs_url,
        repair_command: adapter_repair_command(adapter_id),
        message: auth_message,
        checked_at: now(),
        verified_args: Vec::new(),
        verification_fingerprint: None,
    };
    restore_persisted_adapter_verification(db, &mut probe, &launch_fingerprint)?;
    Ok(probe)
}

pub(crate) fn verify_adapter(
    db: &Connection,
    adapter_id: &str,
    cwd: Option<&str>,
    launch_args: &[String],
    launch_config: &AdapterLaunchConfig,
) -> Result<AdapterProbeDto> {
    let mut probe = probe_adapter(db, adapter_id, launch_args, launch_config)?;
    let custom_launch = if matches!(
        adapter_id,
        "codex-cli" | "claude-code" | "opencode" | "pi-coding-agent" | "generic-shell"
    ) {
        None
    } else {
        Some(custom_claude_verification_launch(
            db,
            adapter_id,
            launch_args,
        )?)
    };
    if probe.auth_status != "authenticated"
        && adapter_id != "pi-coding-agent"
        && custom_launch.is_none()
    {
        probe.verification_status = "failed".to_string();
        clear_persisted_adapter_verifications(db, adapter_id)?;
        probe.verified_args.clear();
        probe.verification_fingerprint = None;
        return Ok(probe);
    }
    let launch_fingerprint =
        adapter_verification_fingerprint(db, adapter_id, launch_args, launch_config)?;
    let verification = if let Some((command, args)) = custom_launch {
        let mut input = serde_json::to_vec(&json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": ADAPTER_VERIFICATION_PROMPT,
            },
            "parent_tool_use_id": null,
        }))?;
        input.push(b'\n');
        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        run_adapter_command(
            &command,
            &arg_refs,
            cwd,
            Duration::from_secs(120),
            Some(&input),
        )
    } else {
        let executable = probe
            .executable_path
            .as_deref()
            .ok_or_else(|| anyhow!("adapter executable is missing"))?;
        let args = adapter_verification_command_args(adapter_id, launch_args, launch_config)?;
        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        run_adapter_command(executable, &arg_refs, cwd, Duration::from_secs(120), None)
    };
    match verification {
        Ok((true, output)) if output.contains("WHEELJACK_READY") => {
            probe.auth_status = "authenticated".to_string();
            probe.verification_status = "verified".to_string();
            probe.message = "Real agent turn verified.".to_string();
            probe.verified_args = launch_args.to_vec();
            probe.verification_fingerprint = Some(launch_fingerprint);
            persist_adapter_verification(db, &probe)?;
        }
        Ok((_, output)) => {
            probe.verification_status = "failed".to_string();
            probe.message = adapter_verification_failure_message(&output);
            clear_persisted_adapter_verification(db, adapter_id, &launch_fingerprint)?;
            probe.verified_args.clear();
            probe.verification_fingerprint = None;
        }
        Err(error) => {
            probe.verification_status = "failed".to_string();
            probe.message = format!("Verification failed: {error}");
            clear_persisted_adapter_verification(db, adapter_id, &launch_fingerprint)?;
            probe.verified_args.clear();
            probe.verification_fingerprint = None;
        }
    }
    Ok(probe)
}

const ADAPTER_VERIFICATION_PROMPT: &str =
    "Reply exactly WHEELJACK_READY. Do not use tools or change files.";

fn adapter_verification_fingerprint(
    db: &Connection,
    adapter_id: &str,
    launch_args: &[String],
    launch_config: &AdapterLaunchConfig,
) -> Result<String> {
    let adapter = adapter_registry(db)?
        .into_iter()
        .find(|candidate| candidate.id == adapter_id)
        .ok_or_else(|| anyhow!("unsupported adapter: {adapter_id}"))?;
    adapter_launch_fingerprint(&adapter, launch_args, launch_config)
}

fn adapter_launch_fingerprint(
    adapter: &AdapterDto,
    launch_args: &[String],
    launch_config: &AdapterLaunchConfig,
) -> Result<String> {
    let preferred = adapter
        .streaming
        .as_ref()
        .and_then(|streaming| streaming.get("preferred"));
    let launch_command = preferred
        .and_then(|profile| profile.get("launchCommand"))
        .and_then(Value::as_str)
        .unwrap_or(&adapter.launch_command)
        .trim();
    let prompt_delivery = preferred
        .and_then(|profile| profile.get("promptDelivery"))
        .and_then(Value::as_str)
        .unwrap_or(&adapter.prompt_injection)
        .trim();
    let protocol = preferred
        .and_then(|profile| profile.get("protocol"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let mut value = json!({
        "adapterId": adapter.id,
        "launchCommand": launch_command,
        "promptDelivery": prompt_delivery,
        "protocol": protocol,
        "args": launch_args,
    });
    if protocol == "opencode-sse" {
        value["protocolConfig"] = json!({
            "model": launch_config.model,
            "variant": launch_config.thinking,
            "approvalPolicy": launch_config.approval_policy,
        });
    }
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(&value)?)))
}

fn adapter_verification_command_args(
    adapter_id: &str,
    launch_args: &[String],
    launch_config: &AdapterLaunchConfig,
) -> Result<Vec<String>> {
    let mut args = match adapter_id {
        "codex-cli" => vec![
            "exec".to_string(),
            "--json".to_string(),
            "--skip-git-repo-check".to_string(),
        ],
        "claude-code" => vec![
            "-p".to_string(),
            "--output-format".to_string(),
            "json".to_string(),
        ],
        "opencode" => vec![
            "run".to_string(),
            "--format".to_string(),
            "json".to_string(),
        ],
        "pi-coding-agent" => vec![
            "-p".to_string(),
            "--mode".to_string(),
            "json".to_string(),
            "--no-tools".to_string(),
            "--no-session".to_string(),
        ],
        _ => bail!("adapter verification is not supported: {adapter_id}"),
    };
    if adapter_id == "opencode" {
        if let Some(model) = launch_config
            .model
            .as_deref()
            .filter(|model| !model.is_empty())
        {
            args.extend(["--model".to_string(), model.to_string()]);
        }
        if let Some(variant) = launch_config
            .thinking
            .as_deref()
            .filter(|variant| !variant.is_empty())
        {
            args.extend(["--variant".to_string(), variant.to_string()]);
        }
        if launch_config.approval_policy.as_deref() == Some("allow") {
            args.push("--auto".to_string());
        }
    }
    args.extend(launch_args.iter().cloned());
    args.push(ADAPTER_VERIFICATION_PROMPT.to_string());
    Ok(args)
}

fn custom_claude_verification_launch(
    db: &Connection,
    adapter_id: &str,
    launch_args: &[String],
) -> Result<(String, Vec<String>)> {
    let launch = resolve_structured_adapter_launch(db, adapter_id)?;
    if launch.prompt_delivery != "stdin" || launch.protocol != StructuredProtocol::ClaudeStreamJson
    {
        bail!(
            "custom adapter verification supports only persistent claude-stream-json over stdin: {adapter_id}"
        );
    }
    let mut parts = split_launch_command(&launch.launch_command)?;
    let command = parts.remove(0);
    parts.extend(launch_args.iter().cloned());
    Ok((command, parts))
}

fn restore_persisted_adapter_verification(
    db: &Connection,
    probe: &mut AdapterProbeDto,
    launch_fingerprint: &str,
) -> Result<()> {
    let load_cached = |sql: &str, query_params: &[&dyn rusqlite::ToSql]| {
        db.query_row(sql, query_params, |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .optional()
    };
    let cached = load_cached(
        "SELECT executable_path, version, verified_args_json, launch_fingerprint
             FROM adapter_verifications
             WHERE adapter_id = ?1 AND launch_fingerprint = ?2",
        &[&probe.adapter_id, &launch_fingerprint],
    )?
    .or(load_cached(
        "SELECT executable_path, version, verified_args_json, launch_fingerprint
             FROM adapter_verifications
             WHERE adapter_id = ?1
             ORDER BY verified_at DESC, launch_fingerprint ASC
             LIMIT 1",
        &[&probe.adapter_id],
    )?);
    let Some((executable_path, version, verified_args_json, verified_fingerprint)) = cached else {
        return Ok(());
    };
    let Ok(verified_args) = serde_json::from_str::<Vec<String>>(&verified_args_json) else {
        clear_persisted_adapter_verification(db, &probe.adapter_id, &verified_fingerprint)?;
        return Ok(());
    };
    if matches!(probe.auth_status.as_str(), "missing" | "unauthenticated") {
        clear_persisted_adapter_verifications(db, &probe.adapter_id)?;
        return Ok(());
    }
    probe.verified_args = verified_args;
    probe.verification_fingerprint =
        (!verified_fingerprint.is_empty()).then_some(verified_fingerprint.clone());
    if probe.executable_path.as_deref() == Some(&executable_path)
        && probe.version == version
        && !verified_fingerprint.is_empty()
        && verified_fingerprint == launch_fingerprint
    {
        probe.auth_status = "authenticated".to_string();
        probe.verification_status = "verified".to_string();
        probe.message = "Real agent turn previously verified.".to_string();
    } else {
        probe.verification_status = "stale".to_string();
        probe.message =
            "Adapter executable, version, or launch configuration changed since verification. Verify again."
                .to_string();
    }
    Ok(())
}

fn persist_adapter_verification(db: &Connection, probe: &AdapterProbeDto) -> Result<()> {
    let executable_path = probe
        .executable_path
        .as_deref()
        .ok_or_else(|| anyhow!("verified adapter executable is missing"))?;
    let launch_fingerprint = probe
        .verification_fingerprint
        .as_deref()
        .filter(|fingerprint| !fingerprint.is_empty())
        .ok_or_else(|| anyhow!("verified adapter launch fingerprint is missing"))?;
    db.execute(
        "INSERT OR REPLACE INTO adapter_verifications
         (adapter_id, executable_path, version, verified_at, verified_args_json, launch_fingerprint)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            probe.adapter_id,
            executable_path,
            probe.version,
            now(),
            serde_json::to_string(&probe.verified_args)?,
            launch_fingerprint
        ],
    )?;
    Ok(())
}

fn clear_persisted_adapter_verification(
    db: &Connection,
    adapter_id: &str,
    launch_fingerprint: &str,
) -> Result<()> {
    db.execute(
        "DELETE FROM adapter_verifications
         WHERE adapter_id = ?1 AND launch_fingerprint = ?2",
        params![adapter_id, launch_fingerprint],
    )?;
    Ok(())
}

fn clear_persisted_adapter_verifications(db: &Connection, adapter_id: &str) -> Result<()> {
    db.execute(
        "DELETE FROM adapter_verifications WHERE adapter_id = ?1",
        params![adapter_id],
    )?;
    Ok(())
}

fn adapter_verification_failure_message(output: &str) -> String {
    for line in output
        .lines()
        .rev()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let message = value
            .pointer("/error/data/message")
            .or_else(|| value.pointer("/error/message"))
            .or_else(|| value.get("message"))
            .or_else(|| value.get("result"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|message| !message.is_empty());
        if let Some(message) = message {
            let lowercase = message.to_ascii_lowercase();
            if lowercase.contains("more credits") || lowercase.contains("insufficient credits") {
                return "Verification failed: The configured provider does not have enough credits for this request. Add credits or lower the model token limit, then try again.".to_string();
            }
            return format!("Verification failed: {message}");
        }
    }

    let fallback = output
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Verification failed.");
    let shortened = fallback.chars().take(500).collect::<String>();
    if shortened.starts_with("Verification failed") {
        shortened
    } else {
        format!("Verification failed: {shortened}")
    }
}

pub(crate) fn adapter_auth_succeeded(adapter_id: &str, success: bool, output: &str) -> bool {
    if !success {
        return false;
    }
    if adapter_id == "claude-code"
        && serde_json::from_str::<Value>(output)
            .ok()
            .and_then(|value| value.get("loggedIn").and_then(Value::as_bool))
            == Some(false)
    {
        return false;
    }
    let output = output.to_ascii_lowercase();
    if output.contains("not logged")
        || output.contains("not authenticated")
        || output.contains("no credentials")
    {
        return false;
    }
    adapter_id != "opencode" || !(output.contains("0 credentials") || output.trim().is_empty())
}

fn adapter_repair_command(adapter_id: &str) -> Option<String> {
    match adapter_id {
        "codex-cli" => Some("codex login".to_string()),
        "claude-code" => Some("claude auth login".to_string()),
        "opencode" => Some("opencode auth login".to_string()),
        _ => None,
    }
}

fn run_adapter_command(
    executable: &str,
    args: &[&str],
    cwd: Option<&str>,
    timeout: Duration,
    stdin_payload: Option<&[u8]>,
) -> Result<(bool, String)> {
    let owned_args = args
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let (command, resolved_args) = resolve_adapter_command(executable, &owned_args);
    let mut command = hidden_command(command);
    command
        .args(resolved_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if stdin_payload.is_some() {
        command.stdin(Stdio::piped());
    }
    if let Some(cwd) = cwd.map(str::trim).filter(|value| !value.is_empty()) {
        command.current_dir(resolve_optional_cwd(Some(cwd))?);
    }
    let mut child = command.spawn()?;
    if let Some(payload) = stdin_payload {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("adapter command did not expose stdin"))?;
        stdin.write_all(payload)?;
        stdin.flush()?;
    }
    let stdout = child.stdout.take().map(|mut reader| {
        thread::spawn(move || {
            let mut output = String::new();
            reader.read_to_string(&mut output).map(|_| output)
        })
    });
    let stderr = child.stderr.take().map(|mut reader| {
        thread::spawn(move || {
            let mut output = String::new();
            reader.read_to_string(&mut output).map(|_| output)
        })
    });
    let started = Instant::now();
    let success = loop {
        if let Some(status) = child.try_wait()? {
            break status.success();
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            bail!(
                "adapter command timed out after {} seconds",
                timeout.as_secs()
            );
        }
        thread::sleep(Duration::from_millis(50));
    };
    let stdout = match stdout {
        Some(reader) => reader
            .join()
            .map_err(|_| anyhow!("adapter stdout reader panicked"))??,
        None => String::new(),
    };
    let stderr = match stderr {
        Some(reader) => reader
            .join()
            .map_err(|_| anyhow!("adapter stderr reader panicked"))??,
        None => String::new(),
    };
    let output = if stderr.trim().is_empty() {
        stdout
    } else {
        format!("{stdout}\n{stderr}")
    };
    Ok((success, output.trim().to_string()))
}

pub(crate) fn discover_adapter_models(
    adapter_id: &str,
    executable: &str,
    cwd: Option<&str>,
) -> Result<Value> {
    let models = match adapter_id {
        "codex-cli" => discover_codex_models(executable, cwd)?,
        "claude-code" => ["default", "sonnet", "opus", "haiku"]
            .into_iter()
            .map(|model| json!({ "id": model, "label": model, "efforts": ["low", "medium", "high", "xhigh", "max"] }))
            .collect(),
        "opencode" => {
            let (success, output) = run_adapter_command(
                executable,
                &["models", "--verbose"],
                cwd,
                Duration::from_secs(30),
                None,
            )?;
            if !success {
                bail!("OpenCode model discovery failed: {output}");
            }
            opencode_models_from_output(&output)
        }
        "pi-coding-agent" => {
            let (success, output) = run_adapter_command(
                executable,
                &["--offline", "--list-models"],
                cwd,
                Duration::from_secs(30),
                None,
            )?;
            if !success {
                bail!("Pi model discovery failed: {output}");
            }
            output
                .lines()
                .skip(1)
                .filter_map(|line| {
                    let columns = line.split_whitespace().collect::<Vec<_>>();
                    let (provider, model) = (*columns.first()?, *columns.get(1)?);
                    if !safe_agent_token(provider, 64) || !safe_agent_token(model, 128) {
                        return None;
                    }
                    let efforts = if columns.get(4).copied() == Some("yes") {
                        json!(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
                    } else {
                        json!(["off"])
                    };
                    Some(json!({
                        "id": model,
                        "label": format!("{provider}/{model}"),
                        "provider": provider,
                        "efforts": efforts,
                    }))
                })
                .collect()
        }
        _ => bail!("model discovery is not supported for adapter: {adapter_id}"),
    };
    Ok(json!({ "models": models }))
}

fn opencode_models_from_output(output: &str) -> Vec<Value> {
    let mut rest = output;
    let mut models = Vec::new();
    while let Some(start) = rest.find('{') {
        let candidate = &rest[start..];
        let mut values = serde_json::Deserializer::from_str(candidate).into_iter::<Value>();
        let Some(Ok(model)) = values.next() else {
            rest = &candidate[1..];
            continue;
        };
        rest = &candidate[values.byte_offset()..];
        let (Some(provider), Some(id)) = (model["providerID"].as_str(), model["id"].as_str())
        else {
            continue;
        };
        let full_id = format!("{provider}/{id}");
        if !safe_agent_token(provider, 64) || !safe_agent_token(&full_id, 128) {
            continue;
        }
        let variants = model["variants"].as_object();
        let efforts = [
            ("none", "off"),
            ("off", "off"),
            ("minimal", "minimal"),
            ("low", "low"),
            ("medium", "medium"),
            ("high", "high"),
            ("xhigh", "xhigh"),
            ("max", "max"),
            ("ultra", "ultra"),
        ]
        .into_iter()
        .filter_map(|(variant, effort)| variants?.contains_key(variant).then_some(effort))
        .collect::<Vec<_>>();
        let efforts = if efforts.is_empty() {
            vec!["off"]
        } else {
            efforts
        };
        let default_effort = if efforts.contains(&"medium") {
            "medium"
        } else {
            efforts[0]
        };
        models.push(json!({
            "id": full_id,
            "label": model["name"].as_str().unwrap_or(id),
            "provider": provider,
            "efforts": efforts,
            "defaultEffort": default_effort,
        }));
    }
    models
}

fn discover_codex_models(executable: &str, cwd: Option<&str>) -> Result<Vec<Value>> {
    let (command, args) = resolve_adapter_command(executable, &["app-server".to_string()]);
    let mut command = hidden_command(command);
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(cwd) = cwd.map(str::trim).filter(|value| !value.is_empty()) {
        command.current_dir(resolve_optional_cwd(Some(cwd))?);
    }
    configure_structured_process(&mut command);
    let mut child = command.spawn()?;
    let Some(mut stdin) = child.stdin.take() else {
        kill_structured_process_before_attach(&mut child);
        bail!("Codex app-server did not expose stdin");
    };
    let Some(stdout) = child.stdout.take() else {
        kill_structured_process_before_attach(&mut child);
        bail!("Codex app-server did not expose stdout");
    };
    let (sender, receiver) = std::sync::mpsc::channel();
    let reader = thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    let response = (|| -> Result<Value> {
        writeln!(
            stdin,
            "{}",
            json!({ "id": 1, "method": "initialize", "params": { "clientInfo": { "name": "wheeljack", "title": "wheeljack", "version": env!("CARGO_PKG_VERSION") }, "capabilities": {} } })
        )?;
        stdin.flush()?;
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                bail!("Codex model discovery timed out");
            }
            let line = match receiver.recv_timeout(remaining.min(Duration::from_millis(250))) {
                Ok(Ok(line)) => line,
                Ok(Err(error)) => return Err(error.into()),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    bail!("Codex app-server closed before model discovery completed")
                }
            };
            let Ok(parsed) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match parsed.get("id").and_then(Value::as_u64) {
                Some(1) => {
                    if let Some(error) = parsed.get("error") {
                        bail!("Codex initialization failed: {error}");
                    }
                    for request in [
                        json!({ "method": "initialized", "params": {} }),
                        json!({ "id": 2, "method": "model/list", "params": { "limit": 200, "includeHidden": false } }),
                    ] {
                        writeln!(stdin, "{request}")?;
                    }
                    stdin.flush()?;
                }
                Some(2) => {
                    if let Some(error) = parsed.get("error") {
                        bail!("Codex model discovery failed: {error}");
                    }
                    break Ok(parsed);
                }
                _ => {}
            }
        }
    })();
    kill_structured_process_before_attach(&mut child);
    drop(receiver);
    let _ = reader.join();
    let response = response?;
    Ok(codex_models_from_response(&response))
}

fn codex_models_from_response(response: &Value) -> Vec<Value> {
    response["result"]["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|model| model["hidden"] != true)
        .filter_map(|model| {
            let id = model["model"].as_str()?;
            if !safe_agent_token(id, 128) {
                return None;
            }
            let efforts = model["supportedReasoningEfforts"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|effort| effort["reasoningEffort"].as_str())
                .filter(|effort| safe_agent_token(effort, 32))
                .collect::<Vec<_>>();
            Some(json!({
                "id": id,
                "label": model["displayName"].as_str().unwrap_or(id),
                "description": model["description"].as_str(),
                "efforts": efforts,
                "defaultEffort": model["defaultReasoningEffort"].as_str(),
                "isDefault": model["isDefault"].as_bool().unwrap_or(false),
            }))
        })
        .collect()
}

pub(crate) fn normalize_adapter_manifest(mut manifest: AdapterDto) -> AdapterDto {
    manifest.id = manifest.id.trim().to_string();
    manifest.display_name = manifest.display_name.trim().to_string();
    manifest.icon = manifest.icon.trim().to_string();
    manifest.launch_command = manifest.launch_command.trim().to_string();
    manifest.prompt_injection = manifest.prompt_injection.trim().to_ascii_lowercase();
    manifest.status = manifest.status.trim().to_ascii_lowercase();
    manifest.setup_hint = manifest.setup_hint.trim().to_string();
    manifest.executables = dedupe_trimmed_strings(manifest.executables);
    manifest.supported_platforms = dedupe_trimmed_strings(
        manifest
            .supported_platforms
            .into_iter()
            .map(|platform| platform.to_ascii_lowercase())
            .collect(),
    );
    manifest.supported_approval_policies =
        dedupe_trimmed_strings(manifest.supported_approval_policies);
    if manifest.supported_approval_policies.is_empty() {
        manifest.supported_approval_policies = default_adapter_approval_policies(&manifest.id);
    }
    if manifest.icon.is_empty() {
        manifest.icon = "terminal".to_string();
    }
    if matches!(manifest.id.as_str(), "claude-code" | "codex-cli")
        && manifest.prompt_injection == "stdin"
    {
        manifest.prompt_injection = default_prompt_injection_for_adapter(&manifest.id).to_string();
    }
    manifest.presentation = Some(normalize_adapter_presentation(
        &manifest.id,
        manifest.presentation.take(),
    ));
    manifest.streaming = effective_adapter_streaming(&manifest.id, manifest.streaming.take());
    manifest.supports_structured = structured_profile_available(&manifest.streaming);
    manifest
}

fn dedupe_trimmed_strings(values: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::<String>::new();
    for value in values {
        let trimmed = value.trim();
        if !trimmed.is_empty() && !deduped.iter().any(|existing| existing == trimmed) {
            deduped.push(trimmed.to_string());
        }
    }
    deduped
}

fn validate_adapter_manifest(manifest: &AdapterDto) -> Result<()> {
    if manifest.id.is_empty()
        || manifest.id.len() > 80
        || !manifest
            .id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        bail!("adapter id must use only letters, numbers, '.', '-' or '_'");
    }
    if manifest.display_name.is_empty() {
        bail!("adapter display name is required");
    }
    if manifest.executables.is_empty() {
        bail!("adapter must define at least one executable candidate");
    }
    if manifest.supported_platforms.is_empty()
        || manifest
            .supported_platforms
            .iter()
            .any(|platform| platform != "macos" && platform != "windows")
    {
        bail!("adapter supported platforms must be macos and/or windows");
    }
    if manifest.launch_command.is_empty() {
        bail!("adapter launch command is required");
    }
    if !matches!(
        manifest.prompt_injection.as_str(),
        "stdin" | "paste_then_enter" | "manual"
    ) {
        bail!("adapter prompt injection must be stdin, paste_then_enter, or manual");
    }
    if !matches!(
        manifest.status.as_str(),
        "installed" | "missing" | "unknown"
    ) {
        bail!("adapter status must be installed, missing, or unknown");
    }
    Ok(())
}

fn executable_exists(executable: &str) -> bool {
    resolve_executable_path(executable).is_some()
}

pub(crate) fn resolve_executable_path(executable: &str) -> Option<PathBuf> {
    let candidate = Path::new(executable);
    if candidate.components().count() > 1 {
        return executable_path_candidates(candidate)
            .into_iter()
            .find(|candidate| candidate.is_file());
    }
    env::var_os("PATH").and_then(|raw| {
        env::split_paths(&raw).find_map(|dir| {
            executable_path_candidates(&dir.join(executable))
                .into_iter()
                .find(|candidate| candidate.is_file())
        })
    })
}

fn executable_path_candidates(path: &Path) -> Vec<PathBuf> {
    let pathext = env::var_os("PATHEXT").map(|value| value.to_string_lossy().to_string());
    executable_path_candidates_impl(path, pathext.as_deref())
}

fn executable_path_candidates_impl(path: &Path, pathext: Option<&str>) -> Vec<PathBuf> {
    let raw = path.to_string_lossy();
    if !cfg!(windows) || path.extension().is_some() {
        return vec![path.to_path_buf()];
    }
    let extensions = pathext
        .map(|value| {
            value
                .split(';')
                .map(str::trim)
                .filter(|extension| !extension.is_empty())
                .collect::<Vec<_>>()
        })
        .filter(|extensions| !extensions.is_empty())
        .unwrap_or_else(|| vec![".EXE", ".CMD", ".BAT"]);
    extensions
        .into_iter()
        .map(|extension| PathBuf::from(format!("{raw}{extension}")))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn windows_executable_path_candidates_respects_custom_pathext() {
        assert_eq!(
            executable_path_candidates_impl(Path::new("agent"), Some(".COM;.EXE;.PS1")),
            ["agent.COM", "agent.EXE", "agent.PS1"]
                .map(PathBuf::from)
                .to_vec()
        );
        assert_eq!(
            executable_path_candidates_impl(Path::new("agent"), Some(".EXE ; ; .CMD")),
            ["agent.EXE", "agent.CMD"].map(PathBuf::from).to_vec()
        );
        assert_eq!(
            executable_path_candidates_impl(Path::new("agent"), Some(";;;")),
            ["agent.EXE", "agent.CMD", "agent.BAT"]
                .map(PathBuf::from)
                .to_vec()
        );
        assert_eq!(
            executable_path_candidates_impl(Path::new("agent"), None),
            ["agent.EXE", "agent.CMD", "agent.BAT"]
                .map(PathBuf::from)
                .to_vec()
        );
        assert_eq!(
            executable_path_candidates_impl(Path::new("agent.exe"), Some(".COM;.EXE;.PS1")),
            vec![PathBuf::from("agent.exe")]
        );
    }

    #[test]
    fn verification_failure_message_extracts_nested_provider_error() {
        let output = r#"{"type":"error","error":{"name":"APIError","data":{"message":"This request requires more credits, or fewer max_tokens.","statusCode":402}}}"#;

        assert_eq!(
            adapter_verification_failure_message(output),
            "Verification failed: The configured provider does not have enough credits for this request. Add credits or lower the model token limit, then try again."
        );
    }

    #[test]
    fn codex_model_catalog_keeps_advertised_efforts_and_hides_hidden_models() {
        let models = codex_models_from_response(&json!({
            "result": { "data": [
                {
                    "model": "gpt-visible",
                    "displayName": "GPT Visible",
                    "description": "Visible model",
                    "hidden": false,
                    "isDefault": true,
                    "defaultReasoningEffort": "medium",
                    "supportedReasoningEfforts": [
                        { "reasoningEffort": "low" },
                        { "reasoningEffort": "medium" },
                        { "reasoningEffort": "high" }
                    ]
                },
                {
                    "model": "gpt-hidden",
                    "hidden": true,
                    "supportedReasoningEfforts": []
                }
            ] }
        }));

        assert_eq!(models.len(), 1);
        assert_eq!(models[0]["id"], "gpt-visible");
        assert_eq!(models[0]["defaultEffort"], "medium");
        assert_eq!(models[0]["efforts"], json!(["low", "medium", "high"]));
    }

    #[test]
    fn opencode_model_catalog_uses_each_models_variants() {
        let models = opencode_models_from_output(
            r#"openai/reasoner
{"id":"reasoner","providerID":"openai","name":"Reasoner","variants":{"none":{},"medium":{},"high":{}}}
local/plain
{"id":"plain","providerID":"local","name":"Plain","variants":{}}"#,
        );

        assert_eq!(models.len(), 2);
        assert_eq!(models[0]["id"], "openai/reasoner");
        assert_eq!(models[0]["efforts"], json!(["off", "medium", "high"]));
        assert_eq!(models[0]["defaultEffort"], "medium");
        assert_eq!(models[1]["efforts"], json!(["off"]));
    }

    #[test]
    fn persisted_verification_tracks_exact_launch_args_and_becomes_stale() {
        let db = Connection::open_in_memory().unwrap();
        run_migrations(&db).unwrap();
        let verified_args = vec![
            "-c".to_string(),
            "model=\"gpt-test\"".to_string(),
            "-c".to_string(),
            "approval_policy=\"on-request\"".to_string(),
        ];
        let verified = AdapterProbeDto {
            adapter_id: "pi-coding-agent".to_string(),
            executable_path: Some("C:\\agents\\pi.exe".to_string()),
            version: Some("1.0.0".to_string()),
            auth_status: "authenticated".to_string(),
            protocol: None,
            verification_status: "verified".to_string(),
            docs_url: None,
            repair_command: None,
            message: String::new(),
            checked_at: now(),
            verified_args: verified_args.clone(),
            verification_fingerprint: Some("fingerprint-a".to_string()),
        };
        persist_adapter_verification(&db, &verified).unwrap();

        let mut restarted = AdapterProbeDto {
            auth_status: "unknown".to_string(),
            verification_status: "untested".to_string(),
            ..verified.clone()
        };
        restarted.verified_args.clear();
        restarted.verification_fingerprint = None;
        restore_persisted_adapter_verification(&db, &mut restarted, "fingerprint-a").unwrap();
        assert_eq!(restarted.auth_status, "authenticated");
        assert_eq!(restarted.verification_status, "verified");
        assert_eq!(restarted.verified_args, verified_args);
        assert_eq!(
            restarted.verification_fingerprint.as_deref(),
            Some("fingerprint-a")
        );

        restarted.verification_status = "untested".to_string();
        restore_persisted_adapter_verification(&db, &mut restarted, "fingerprint-b").unwrap();
        assert_eq!(restarted.verification_status, "stale");

        let verified_b = AdapterProbeDto {
            verified_args: vec!["--model".to_string(), "second".to_string()],
            verification_fingerprint: Some("fingerprint-b".to_string()),
            ..verified.clone()
        };
        persist_adapter_verification(&db, &verified_b).unwrap();
        let mut restored_b = AdapterProbeDto {
            verification_status: "untested".to_string(),
            verified_args: Vec::new(),
            verification_fingerprint: None,
            ..verified_b.clone()
        };
        restore_persisted_adapter_verification(&db, &mut restored_b, "fingerprint-b").unwrap();
        assert_eq!(restored_b.verification_status, "verified");
        assert_eq!(restored_b.verified_args, verified_b.verified_args);

        clear_persisted_adapter_verification(&db, "pi-coding-agent", "fingerprint-b").unwrap();
        let mut restored_a = AdapterProbeDto {
            verification_status: "untested".to_string(),
            verified_args: Vec::new(),
            verification_fingerprint: None,
            ..verified.clone()
        };
        restore_persisted_adapter_verification(&db, &mut restored_a, "fingerprint-a").unwrap();
        assert_eq!(restored_a.verification_status, "verified");
        let persisted_count: i64 = db
            .query_row("SELECT COUNT(*) FROM adapter_verifications", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(persisted_count, 1);
    }

    #[test]
    fn verification_command_and_fingerprint_include_ordered_session_args() {
        let launch_args = vec![
            "-c".to_string(),
            "model=\"gpt-test\"".to_string(),
            "-c".to_string(),
            "approval_policy=\"on-request\"".to_string(),
        ];
        let launch_config = AdapterLaunchConfig::default();
        let command =
            adapter_verification_command_args("codex-cli", &launch_args, &launch_config).unwrap();
        assert_eq!(
            &command[3..7],
            launch_args.as_slice(),
            "profile args must be forwarded without reordering"
        );
        assert_eq!(command.last().unwrap(), ADAPTER_VERIFICATION_PROMPT);

        let adapter = built_in_adapters()
            .into_iter()
            .find(|adapter| adapter.id == "codex-cli")
            .unwrap();
        let original = adapter_launch_fingerprint(&adapter, &launch_args, &launch_config).unwrap();
        let legacy_value = json!({
            "adapterId": "codex-cli",
            "launchCommand": "codex app-server",
            "promptDelivery": "json-rpc",
            "protocol": "codex-app-server",
            "args": launch_args,
        });
        let legacy_fingerprint = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&legacy_value).unwrap())
        );
        assert_eq!(original, legacy_fingerprint);
        let changed_args =
            adapter_launch_fingerprint(&adapter, &["--different".to_string()], &launch_config)
                .unwrap();
        assert_ne!(original, changed_args);

        let mut changed_manifest = adapter;
        changed_manifest.streaming.as_mut().unwrap()["preferred"]["launchCommand"] =
            json!("codex app-server --changed");
        let changed_launch =
            adapter_launch_fingerprint(&changed_manifest, &launch_args, &launch_config).unwrap();
        assert_ne!(original, changed_launch);
    }

    #[test]
    fn opencode_protocol_profile_changes_make_persisted_verification_stale() {
        let db = Connection::open_in_memory().unwrap();
        run_migrations(&db).unwrap();
        let adapter = built_in_adapters()
            .into_iter()
            .find(|adapter| adapter.id == "opencode")
            .unwrap();
        let launch_args = Vec::new();
        let verified_config = AdapterLaunchConfig {
            model: Some("openai/gpt-5.6-luna".to_string()),
            thinking: Some("minimal".to_string()),
            approval_policy: Some("ask".to_string()),
        };
        let command =
            adapter_verification_command_args("opencode", &launch_args, &verified_config).unwrap();
        assert_eq!(
            &command[3..7],
            ["--model", "openai/gpt-5.6-luna", "--variant", "minimal"]
        );
        assert_eq!(command.last().unwrap(), ADAPTER_VERIFICATION_PROMPT);
        let verified_fingerprint =
            adapter_launch_fingerprint(&adapter, &launch_args, &verified_config).unwrap();
        let verified = AdapterProbeDto {
            adapter_id: "opencode".to_string(),
            executable_path: Some("C:\\agents\\opencode.exe".to_string()),
            version: Some("1.0.0".to_string()),
            auth_status: "authenticated".to_string(),
            protocol: Some("opencode-sse".to_string()),
            verification_status: "verified".to_string(),
            docs_url: None,
            repair_command: None,
            message: String::new(),
            checked_at: now(),
            verified_args: launch_args.clone(),
            verification_fingerprint: Some(verified_fingerprint.clone()),
        };
        persist_adapter_verification(&db, &verified).unwrap();

        for changed_config in [
            AdapterLaunchConfig {
                model: Some("openai/gpt-5.6".to_string()),
                ..verified_config.clone()
            },
            AdapterLaunchConfig {
                thinking: Some("high".to_string()),
                ..verified_config.clone()
            },
            AdapterLaunchConfig {
                approval_policy: Some("deny".to_string()),
                ..verified_config.clone()
            },
        ] {
            let changed_fingerprint =
                adapter_launch_fingerprint(&adapter, &launch_args, &changed_config).unwrap();
            assert_ne!(verified_fingerprint, changed_fingerprint);

            let mut restarted = AdapterProbeDto {
                auth_status: "unknown".to_string(),
                verification_status: "untested".to_string(),
                ..verified.clone()
            };
            restarted.verification_fingerprint = None;
            restore_persisted_adapter_verification(&db, &mut restarted, &changed_fingerprint)
                .unwrap();
            assert_eq!(restarted.verification_status, "stale");
        }
    }
}
