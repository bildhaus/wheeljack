use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, Manager, RunEvent, State};
use wheeljack_core::{Core, EventSink, InitOptions};

const LEGACY_WINDOWS_DATA_DIR: &str = "wheeljack";
const LEGACY_PRODUCTION_APP_IDENTIFIER: &str = "com.oshtz.wheeljack";
const PREVIEW_APP_IDENTIFIER: &str = "com.oshtz.wheeljack.preview";

#[cfg(any(target_os = "macos", test))]
fn login_shell_path(output: &[u8]) -> Option<String> {
    let output = String::from_utf8_lossy(output);
    let path = output
        .split_once('\u{1e}')?
        .1
        .split_once('\u{1f}')?
        .0
        .trim();
    (!path.is_empty()).then(|| path.to_string())
}

#[cfg(any(target_os = "macos", test))]
fn merge_search_paths(
    primary: &std::ffi::OsStr,
    fallback: Option<&std::ffi::OsStr>,
) -> Option<std::ffi::OsString> {
    let mut paths = Vec::new();
    for path in std::iter::once(primary)
        .chain(fallback)
        .flat_map(std::env::split_paths)
    {
        if !path.as_os_str().is_empty() && !paths.contains(&path) {
            paths.push(path);
        }
    }
    std::env::join_paths(paths).ok()
}

#[cfg(target_os = "macos")]
fn inherit_login_shell_path() {
    let shell = std::env::var_os("SHELL")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "/bin/zsh".into());
    let Ok(output) = Command::new(shell)
        .args([
            "-l",
            "-i",
            "-c",
            "/usr/bin/printf '\\036'; /usr/bin/printenv PATH; /usr/bin/printf '\\037'",
        ])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
    else {
        return;
    };
    if !output.status.success() {
        return;
    }
    let Some(path) = login_shell_path(&output.stdout) else {
        return;
    };
    let inherited = std::env::var_os("PATH");
    if let Some(path) = merge_search_paths(path.as_ref(), inherited.as_deref()) {
        std::env::set_var("PATH", path);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreEventEnvelope {
    event: String,
    payload: Value,
    protocol_version: u8,
    event_id: String,
    sequence: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VsCodeThemeSource {
    label: String,
    extension: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VsCodeThemeCatalog {
    themes: Vec<VsCodeThemeSource>,
    settings_path: Option<String>,
}

fn envelope(sequence: u64, event: &str, payload: &Value) -> CoreEventEnvelope {
    CoreEventEnvelope {
        event: event.to_string(),
        payload: payload.clone(),
        protocol_version: 2,
        event_id: format!("event-{sequence}"),
        sequence,
    }
}

#[derive(Default)]
struct EventForwarder {
    channel: Mutex<Option<Channel<CoreEventEnvelope>>>,
    sequence: AtomicU64,
    dispatch: Mutex<()>,
    terminal_ui_fixtures: Mutex<BTreeSet<String>>,
}

impl EventForwarder {
    fn connect(&self, channel: Channel<CoreEventEnvelope>) {
        let _dispatch = self
            .dispatch
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *self
            .channel
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(channel);
    }

    fn set_terminal_ui_fixture(&self, session_id: &str, enabled: bool) {
        let _dispatch = self
            .dispatch
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut fixtures = self
            .terminal_ui_fixtures
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if enabled {
            fixtures.insert(session_id.to_string());
        } else {
            fixtures.remove(session_id);
        }
        drop(fixtures);
        let sequence = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let channel = self
            .channel
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        if let Some(channel) = channel {
            let _ = channel.send(envelope(
                sequence,
                "terminal:frame",
                &terminal_ui_fixture_payload(session_id, enabled),
            ));
        }
    }
}

impl EventSink for EventForwarder {
    fn emit(&self, event: &str, payload: &Value) {
        // Core workers emit concurrently. Sequence allocation and channel send must
        // share one critical section or a later sequence can reach the WebView first.
        let _dispatch = self
            .dispatch
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if event == "terminal:frame"
            && payload
                .get("sessionId")
                .and_then(Value::as_str)
                .is_some_and(|session_id| {
                    self.terminal_ui_fixtures
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .contains(session_id)
                })
        {
            return;
        }
        let sequence = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let channel = self
            .channel
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        if let Some(channel) = channel {
            let _ = channel.send(envelope(sequence, event, payload));
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreConnection {
    app_data_dir: String,
    version: &'static str,
    reused: bool,
}

#[derive(Default)]
struct CoreHost {
    core: Mutex<Option<Arc<Core>>>,
    events: Arc<EventForwarder>,
    app_data_dir: Mutex<Option<PathBuf>>,
}

impl CoreHost {
    fn connect(&self, init: InitOptions) -> Result<CoreConnection, String> {
        let mut slot = self.core.lock().unwrap_or_else(|error| error.into_inner());
        let reused = slot.is_some();
        if slot.is_none() {
            let app_data_dir = init.app_data_dir.clone();
            let core = Core::new(init, self.events.clone()).map_err(|error| error.to_string())?;
            *slot = Some(Arc::new(core));
            *self
                .app_data_dir
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = Some(app_data_dir);
        }
        let app_data_dir = self
            .app_data_dir
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
            .ok_or_else(|| "wheeljack data directory is unavailable.".to_string())?;
        Ok(CoreConnection {
            app_data_dir: app_data_dir.to_string_lossy().to_string(),
            version: env!("CARGO_PKG_VERSION"),
            reused,
        })
    }

    fn call(&self, request_json: &str) -> Result<String, String> {
        let core = self
            .core
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
            .ok_or_else(|| "wheeljack core is not connected.".to_string())?;
        Ok(core.call_json(request_json))
    }

    fn shutdown(&self) {
        if let Some(core) = self
            .core
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
        {
            core.shutdown();
        }
    }
}

#[tauri::command]
async fn core_connect(
    app: tauri::AppHandle,
    events: Channel<CoreEventEnvelope>,
    host: State<'_, CoreHost>,
) -> Result<CoreConnection, String> {
    host.events.connect(events);
    let smoke_mode = ui_smoke_enabled();
    let (app_data_dir, old_app_data_dirs) = if smoke_mode {
        let path = std::env::var_os("WHEELJACK_DESKTOP_DATA_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| "--ui-smoke requires WHEELJACK_DESKTOP_DATA_DIR.".to_string())?;
        fs::create_dir_all(&path).map_err(|error| error.to_string())?;
        (path, Vec::new())
    } else {
        let app_data_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| error.to_string())?;
        let local_data_dir = app
            .path()
            .local_data_dir()
            .map_err(|error| error.to_string())?;
        (app_data_dir, legacy_app_data_dirs(&local_data_dir))
    };
    let init = InitOptions {
        platform: std::env::consts::OS.to_string(),
        version: if smoke_mode {
            std::env::var("WHEELJACK_DESKTOP_VERSION_OVERRIDE")
                .unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string())
        } else {
            env!("CARGO_PKG_VERSION").to_string()
        },
        app_data_dir,
        cache_dir: None,
        update_dir: None,
        old_app_data_dirs,
        current_executable_path: std::env::current_exe().ok(),
        current_app_bundle_path: None,
        update_feed_url: None,
        test_mode: smoke_mode,
    };
    let connection = host.connect(init)?;
    if ui_smoke_auto_close_requested() {
        let malformed = host.call("{not-json")?;
        let malformed =
            serde_json::from_str::<Value>(&malformed).map_err(|error| error.to_string())?;
        if malformed.get("ok").and_then(Value::as_bool) != Some(false)
            || malformed.pointer("/error/code").and_then(Value::as_str) != Some("invalid_request")
        {
            return Err("Malformed IPC request was not rejected.".to_string());
        }
        let response = host.call(
            r#"{"id":"native-auto-smoke-recovery","command":"smoke_recover_interrupted_session","payload":{},"protocolVersion":2}"#,
        )?;
        let response =
            serde_json::from_str::<Value>(&response).map_err(|error| error.to_string())?;
        if response.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(format!(
                "Could not seed native UI recovery smoke: {}",
                response
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown core error")
            ));
        }
    }
    Ok(connection)
}

fn legacy_app_data_dirs(local_data_dir: &Path) -> Vec<PathBuf> {
    vec![
        local_data_dir.join(LEGACY_PRODUCTION_APP_IDENTIFIER),
        local_data_dir.join(LEGACY_WINDOWS_DATA_DIR),
        local_data_dir.join(PREVIEW_APP_IDENTIFIER).join("preview"),
    ]
}

#[tauri::command]
fn ui_smoke_enabled() -> bool {
    ui_smoke_enabled_for(
        std::env::args(),
        std::env::var("WHEELJACK_UI_SMOKE").ok().as_deref(),
    )
}

fn ui_smoke_enabled_for<I, S>(arguments: I, environment_value: Option<&str>) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    arguments
        .into_iter()
        .any(|argument| argument.as_ref() == "--ui-smoke")
        || environment_value == Some("1")
}

#[tauri::command]
fn ui_smoke_update_mode() -> Option<String> {
    if !ui_smoke_enabled() || std::env::var_os("WHEELJACK_UPDATE_HEALTH_PATH").is_some() {
        return None;
    }
    std::env::var("WHEELJACK_UPDATE_SMOKE_MODE")
        .ok()
        .filter(|value| value == "healthy" || value == "rollback")
}

#[tauri::command]
async fn core_call(request_json: String, host: State<'_, CoreHost>) -> Result<String, String> {
    host.call(&request_json)
}

#[tauri::command]
fn emit_terminal_ui_fixture(
    session_id: String,
    enabled: bool,
    host: State<'_, CoreHost>,
) -> Result<(), String> {
    if !ui_smoke_enabled() {
        return Err("Terminal UI fixtures are only available in UI smoke mode.".to_string());
    }
    if session_id.is_empty() || session_id.len() > 128 {
        return Err("The terminal fixture session id is invalid.".to_string());
    }
    host.events.set_terminal_ui_fixture(&session_id, enabled);
    Ok(())
}

fn terminal_ui_fixture_payload(session_id: &str, enabled: bool) -> Value {
    serde_json::json!({
        "sessionId": session_id,
        "rows": 24,
        "cols": 100,
        "cursor": {
            "row": 0,
            "col": 0,
            "visible": false,
            "shape": "block",
            "blinking": false
        },
        "altScreen": enabled,
        "mouseReporting": enabled,
        "sgrMouse": enabled,
        "mouseDrag": enabled,
        "mouseMotion": enabled,
        "alternateScroll": false,
        "applicationCursor": false,
        "applicationKeypad": false,
        "bracketedPaste": enabled,
        "focusEvents": enabled,
        "insertMode": false,
        "lineWrap": true,
        "originMode": false,
        "kittyKeyboard": false,
        "viewportOffset": 0,
        "scrollbackLineCount": 0,
        "scrollbackLimit": 10_000,
        "gridRows": [],
        "dirtyRows": [],
        "metrics": null
    })
}

#[tauri::command]
fn ui_smoke_auto_close() -> bool {
    ui_smoke_auto_close_for(
        ui_smoke_auto_close_requested(),
        std::env::var_os("WHEELJACK_UPDATE_SMOKE_MODE").is_some(),
        std::env::var_os("WHEELJACK_UPDATE_HEALTH_PATH").is_some(),
    )
}

fn ui_smoke_auto_close_requested() -> bool {
    std::env::args().any(|argument| argument == "--ui-smoke-auto-close")
        || std::env::var("WHEELJACK_UI_SMOKE_AUTO_CLOSE").is_ok_and(|value| value == "1")
}

fn ui_smoke_auto_close_for(requested: bool, update_smoke: bool, update_health: bool) -> bool {
    requested && (!update_smoke || update_health)
}

#[tauri::command]
fn system_font_families() -> Vec<String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    database
        .faces()
        .filter_map(|face| face.families.first().map(|(name, _)| name.trim()))
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

#[tauri::command]
fn legacy_windows_ui_preferences(host: State<'_, CoreHost>) -> Result<Option<Value>, String> {
    let app_data_dir = host
        .app_data_dir
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
        .ok_or_else(|| "wheeljack data directory is unavailable.".to_string())?;
    read_legacy_windows_ui_preferences(&app_data_dir)
}

fn read_legacy_windows_ui_preferences(app_data_dir: &Path) -> Result<Option<Value>, String> {
    for name in ["windows-ui-v1.json", "windows-ui-v1.json.bak"] {
        let path = app_data_dir.join(name);
        if !path.is_file() {
            continue;
        }
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        if metadata.len() > 1024 * 1024 {
            return Err("Legacy Windows UI preferences exceed 1 MiB.".to_string());
        }
        let value = serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
            .map_err(|error| {
                format!("Legacy Windows UI preferences are not valid JSON: {error}")
            })?;
        return Ok(Some(value));
    }
    Ok(None)
}

#[tauri::command]
fn complete_ui_smoke(ok: bool, message: String, host: State<'_, CoreHost>) -> Result<(), String> {
    if !ui_smoke_auto_close() {
        return Err("UI smoke completion is only available in auto-close smoke mode.".to_string());
    }
    let app_data_dir = host
        .app_data_dir
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
        .ok_or_else(|| "wheeljack data directory is unavailable.".to_string())?;
    let result = serde_json::json!({ "ok": ok, "message": message });
    fs::write(
        app_data_dir.join("ui-smoke-result.json"),
        result.to_string(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn complete_update_health(host: State<'_, CoreHost>) -> Result<bool, String> {
    let Some(path) = std::env::var_os("WHEELJACK_UPDATE_HEALTH_PATH").map(PathBuf::from) else {
        return Ok(false);
    };
    let Some(nonce) = std::env::var_os("WHEELJACK_UPDATE_HEALTH_NONCE") else {
        return Err("The update health nonce is unavailable.".to_string());
    };
    if ui_smoke_enabled()
        && std::env::var("WHEELJACK_UPDATE_SMOKE_MODE").ok().as_deref() == Some("rollback")
    {
        return Ok(false);
    }
    let nonce = nonce
        .into_string()
        .map_err(|_| "The update health nonce is invalid.".to_string())?;
    if nonce.is_empty() || nonce.len() > 128 {
        return Err("The update health nonce is invalid.".to_string());
    }
    let app_data_dir = host
        .app_data_dir
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
        .ok_or_else(|| "wheeljack data directory is unavailable.".to_string())?;
    write_update_health(&app_data_dir, &path, &nonce)?;
    Ok(true)
}

fn write_update_health(app_data_dir: &Path, path: &Path, nonce: &str) -> Result<(), String> {
    if nonce.is_empty() || nonce.len() > 128 {
        return Err("The update health nonce is invalid.".to_string());
    }
    let updates =
        fs::canonicalize(app_data_dir.join("updates")).map_err(|error| error.to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "The update health path has no parent.".to_string())?;
    let parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if parent != updates || !file_name.starts_with("update-health-") || !file_name.ends_with(".txt")
    {
        return Err("The update health path is outside wheeljack's update directory.".to_string());
    }
    fs::write(path, nonce).map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageAttachmentData {
    data_url: String,
    file_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredImageAttachment {
    path: String,
    file_name: String,
    mime_type: String,
}

const MAX_IMAGE_ATTACHMENT_BYTES: usize = 12 * 1024 * 1024;
static IMAGE_ATTACHMENT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn image_attachment_type(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("image/png", "png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(("image/gif", "gif"))
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some(("image/webp", "webp"))
    } else if bytes.starts_with(b"BM") {
        Some(("image/bmp", "bmp"))
    } else {
        None
    }
}

fn validated_image_bytes(path: &Path) -> Result<(Vec<u8>, &'static str, &'static str), String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Image attachment must be a file.".to_string());
    }
    if metadata.len() > MAX_IMAGE_ATTACHMENT_BYTES as u64 {
        return Err("Image attachment exceeds 12 MiB.".to_string());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let (mime, extension) = image_attachment_type(&bytes)
        .ok_or_else(|| "Unsupported image attachment type.".to_string())?;
    Ok((bytes, mime, extension))
}

fn store_image_attachment(
    bytes: Vec<u8>,
    original_name: &str,
    app_data: &Path,
) -> Result<StoredImageAttachment, String> {
    if bytes.len() > MAX_IMAGE_ATTACHMENT_BYTES {
        return Err("Image attachment exceeds 12 MiB.".to_string());
    }
    let (mime_type, extension) = image_attachment_type(&bytes)
        .ok_or_else(|| "Unsupported image attachment type.".to_string())?;
    let directory = app_data.join("attachments");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let sequence = IMAGE_ATTACHMENT_SEQUENCE.fetch_add(1, Ordering::SeqCst);
    let path = directory.join(format!("image-{nonce}-{sequence}.{extension}"));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    // ponytail: attachment copies favor durable transcripts; add garbage collection if storage growth becomes material.
    Ok(StoredImageAttachment {
        path: path.to_string_lossy().to_string(),
        file_name: Path::new(original_name)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("image")
            .to_string(),
        mime_type: mime_type.to_string(),
    })
}

fn core_app_data_dir(host: &State<'_, CoreHost>) -> Result<PathBuf, String> {
    host.app_data_dir
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
        .ok_or_else(|| "wheeljack data directory is unavailable.".to_string())
}

#[tauri::command]
async fn read_image_attachment(
    path: String,
    project_root: String,
    host: State<'_, CoreHost>,
) -> Result<ImageAttachmentData, String> {
    let source = fs::canonicalize(&path).map_err(|error| error.to_string())?;
    let project = fs::canonicalize(&project_root).map_err(|error| error.to_string())?;
    let app_data = core_app_data_dir(&host)?;
    if !source.starts_with(project) && !source.starts_with(app_data) {
        return Err(
            "Image attachments must be inside the open project or wheeljack data directory."
                .to_string(),
        );
    }
    let (bytes, mime, _) = validated_image_bytes(&source)?;
    Ok(ImageAttachmentData {
        data_url: format!(
            "data:{mime};base64,{}",
            general_purpose::STANDARD.encode(bytes)
        ),
        file_name: source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("image")
            .to_string(),
    })
}

#[tauri::command]
async fn import_image_attachment(
    path: String,
    host: State<'_, CoreHost>,
) -> Result<StoredImageAttachment, String> {
    let source = fs::canonicalize(&path).map_err(|error| error.to_string())?;
    let (bytes, _, _) = validated_image_bytes(&source)?;
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("image")
        .to_string();
    store_image_attachment(bytes, &file_name, &core_app_data_dir(&host)?)
}

#[tauri::command]
async fn save_image_attachment(
    data: Vec<u8>,
    file_name: String,
    host: State<'_, CoreHost>,
) -> Result<StoredImageAttachment, String> {
    store_image_attachment(data, &file_name, &core_app_data_dir(&host)?)
}

#[tauri::command]
async fn read_theme_document(path: String) -> Result<String, String> {
    let source = Path::new(&path);
    validate_theme_document_path(source)?;
    let metadata = fs::metadata(source).map_err(|error| error.to_string())?;
    if metadata.len() > 256 * 1024 {
        return Err("Theme document exceeds 256 KiB.".to_string());
    }
    fs::read_to_string(source).map_err(|error| error.to_string())
}

#[tauri::command]
async fn discover_vscode_themes() -> VsCodeThemeCatalog {
    discover_vscode_themes_in_roots(vscode_theme_roots(), vscode_settings_path())
}

#[tauri::command]
async fn write_theme_document(path: String, content: String) -> Result<(), String> {
    let target = Path::new(&path);
    validate_theme_document_path(target)?;
    if content.len() > 256 * 1024 {
        return Err("Theme document exceeds 256 KiB.".to_string());
    }
    serde_json::from_str::<Value>(&content)
        .map_err(|error| format!("Theme document is not valid JSON: {error}"))?;
    let parent = target
        .parent()
        .ok_or_else(|| "Theme destination has no parent directory.".to_string())?;
    if !parent.is_dir() {
        return Err("Theme destination directory does not exist.".to_string());
    }
    let temporary = target.with_extension("wheeljack-theme.json.tmp");
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    if let Err(error) = fs::rename(&temporary, target) {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    Ok(())
}

fn validate_theme_document_path(path: &Path) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let name = name.to_ascii_lowercase();
    if !name.ends_with(".json") && !name.ends_with(".jsonc") {
        return Err("Theme documents must use a .json or .jsonc extension.".to_string());
    }
    Ok(())
}

fn discover_vscode_themes_in_roots(
    roots: Vec<PathBuf>,
    settings_path: Option<PathBuf>,
) -> VsCodeThemeCatalog {
    let mut discovered: BTreeMap<String, (u128, VsCodeThemeSource)> = BTreeMap::new();
    for root in roots.into_iter().filter(|root| root.is_dir()) {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten().filter(|entry| entry.path().is_dir()) {
            let extension_root = entry.path();
            let manifest_path = extension_root.join("package.json");
            let Ok(manifest_text) = fs::read_to_string(&manifest_path) else {
                continue;
            };
            let Ok(manifest) = serde_json::from_str::<Value>(&manifest_text) else {
                continue;
            };
            let Some(themes) = manifest
                .pointer("/contributes/themes")
                .and_then(Value::as_array)
            else {
                continue;
            };
            let extension = manifest
                .get("displayName")
                .or_else(|| manifest.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("VS Code")
                .to_string();
            let extension_id = format!(
                "{}.{}",
                manifest
                    .get("publisher")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                manifest
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
            );
            let installed_at = manifest
                .pointer("/__metadata/installedTimestamp")
                .and_then(Value::as_u64)
                .map(u128::from)
                .or_else(|| {
                    fs::metadata(&manifest_path)
                        .ok()?
                        .modified()
                        .ok()?
                        .duration_since(UNIX_EPOCH)
                        .ok()
                        .map(|duration| duration.as_millis())
                })
                .unwrap_or_default();
            let Ok(canonical_root) = extension_root.canonicalize() else {
                continue;
            };
            for theme in themes {
                let Some(label) = theme.get("label").and_then(Value::as_str) else {
                    continue;
                };
                let Some(relative_path) = theme.get("path").and_then(Value::as_str) else {
                    continue;
                };
                let Ok(path) = extension_root.join(relative_path).canonicalize() else {
                    continue;
                };
                if !path.starts_with(&canonical_root)
                    || !path.is_file()
                    || validate_theme_document_path(&path).is_err()
                {
                    continue;
                }
                let key = format!("{extension_id}:{}", label.to_ascii_lowercase());
                let source = VsCodeThemeSource {
                    label: label.to_string(),
                    extension: extension.clone(),
                    path: path.to_string_lossy().into_owned(),
                };
                if discovered
                    .get(&key)
                    .is_none_or(|(existing, _)| installed_at >= *existing)
                {
                    discovered.insert(key, (installed_at, source));
                }
            }
        }
    }
    let mut themes = discovered
        .into_values()
        .map(|(_, source)| source)
        .collect::<Vec<_>>();
    themes.sort_by(|left, right| {
        left.label
            .to_ascii_lowercase()
            .cmp(&right.label.to_ascii_lowercase())
            .then_with(|| left.extension.cmp(&right.extension))
    });
    VsCodeThemeCatalog {
        themes,
        settings_path: settings_path.map(|path| path.to_string_lossy().into_owned()),
    }
}

fn vscode_theme_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
        roots.push(home.join(".vscode").join("extensions"));
        roots.push(home.join(".vscode-insiders").join("extensions"));
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        roots.push(
            local_app_data
                .join("Programs")
                .join("Microsoft VS Code")
                .join("resources")
                .join("app")
                .join("extensions"),
        );
        roots.push(
            local_app_data
                .join("Programs")
                .join("Microsoft VS Code Insiders")
                .join("resources")
                .join("app")
                .join("extensions"),
        );
    }
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(program_files) = std::env::var_os(variable).map(PathBuf::from) {
            roots.push(
                program_files
                    .join("Microsoft VS Code")
                    .join("resources")
                    .join("app")
                    .join("extensions"),
            );
        }
    }
    roots
}

fn vscode_settings_path() -> Option<PathBuf> {
    let app_data = std::env::var_os("APPDATA").map(PathBuf::from)?;
    [
        app_data.join("Code").join("User").join("settings.json"),
        app_data
            .join("Code - Insiders")
            .join("User")
            .join("settings.json"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

#[tauri::command]
async fn apply_downloaded_update(
    update_path: String,
    host: State<'_, CoreHost>,
) -> Result<String, String> {
    let app_data_dir = host
        .app_data_dir
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
        .ok_or_else(|| "wheeljack data directory is unavailable.".to_string())?;
    let source = canonical_update_source(&app_data_dir.join("updates"), Path::new(&update_path))?;
    let target = std::env::current_exe().map_err(|error| error.to_string())?;
    let update_nonce = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos()
    );
    let health_path = app_data_dir
        .join("updates")
        .join(format!("update-health-{update_nonce}.txt"));
    let _ = fs::remove_file(&health_path);

    #[cfg(windows)]
    {
        if !source
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
        {
            return Err("Windows updates must be executable files.".to_string());
        }
        let backup = target.with_extension("exe.previous");
        let update_dir = app_data_dir.join("updates");
        let log = update_dir.join("install.log");
        let recovery_error = update_dir.join("install-error.txt");
        let script_path = update_dir.join("apply-update.ps1");
        let script = r#"
param([switch]$Elevated)
$ErrorActionPreference = 'Stop'
$procId = [int]$env:WHEELJACK_UPDATE_PID
$replacement = $env:WHEELJACK_UPDATE_SOURCE
$target = $env:WHEELJACK_UPDATE_TARGET
$backup = $env:WHEELJACK_UPDATE_BACKUP
$log = $env:WHEELJACK_UPDATE_LOG
$recoveryError = $env:WHEELJACK_UPDATE_RECOVERY_ERROR
$scriptPath = $env:WHEELJACK_UPDATE_SCRIPT
while (Get-Process -Id $procId -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }
for ($attempt = 1; $attempt -le 3; $attempt++) {
  try {
    Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $target -Destination $backup -Force
    Move-Item -LiteralPath $replacement -Destination $target -Force
    $updated = Start-Process -FilePath $target -PassThru
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
      if (Test-Path -LiteralPath $env:WHEELJACK_UPDATE_HEALTH_PATH) {
        $health = Get-Content -LiteralPath $env:WHEELJACK_UPDATE_HEALTH_PATH -Raw -ErrorAction SilentlyContinue
        if ($health -eq $env:WHEELJACK_UPDATE_HEALTH_NONCE) {
          Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
          Remove-Item -LiteralPath $env:WHEELJACK_UPDATE_HEALTH_PATH -Force -ErrorAction SilentlyContinue
          Remove-Item -LiteralPath $recoveryError -Force -ErrorAction SilentlyContinue
          Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue
          exit 0
        }
      }
      if ($updated.HasExited) { break }
      Start-Sleep -Milliseconds 200
    }
    if (-not $updated.HasExited) {
      Stop-Process -Id $updated.Id -Force -ErrorAction SilentlyContinue
      $updated.WaitForExit()
    }
    throw 'The updated wheeljack process did not report a healthy UI.'
  } catch {
    Add-Content -LiteralPath $log -Value "$(Get-Date -Format s) attempt $attempt failed: $($_.Exception.Message)" -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $backup) {
      Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
      Move-Item -LiteralPath $backup -Destination $target -Force
      Set-Content -LiteralPath $recoveryError -Value 'The update failed and the previous version was restored.' -Encoding UTF8 -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $env:WHEELJACK_UPDATE_HEALTH_PATH -Force -ErrorAction SilentlyContinue
      Remove-Item Env:\WHEELJACK_UPDATE_HEALTH_PATH -ErrorAction SilentlyContinue
      Remove-Item Env:\WHEELJACK_UPDATE_HEALTH_NONCE -ErrorAction SilentlyContinue
      Remove-Item Env:\WHEELJACK_UPDATE_SMOKE_MODE -ErrorAction SilentlyContinue
      Start-Process -FilePath $target
      Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue
      exit 1
    }
    if (-not $Elevated) {
      try {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList @(
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy', 'Bypass',
          '-WindowStyle', 'Hidden',
          '-File', "`"$scriptPath`"",
          '-Elevated'
        )
        exit 0
      } catch {
        Add-Content -LiteralPath $log -Value "$(Get-Date -Format s) elevation failed: $($_.Exception.Message)" -ErrorAction SilentlyContinue
      }
    }
    Start-Sleep -Milliseconds 300
  }
}
Set-Content -LiteralPath $recoveryError -Value 'The update could not be installed. The previous version is still in use.' -Encoding UTF8 -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $target) { Start-Process -FilePath $target }
Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue
exit 1
"#;
        fs::write(&script_path, script).map_err(|error| error.to_string())?;
        let mut command = Command::new("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
            ])
            .arg(&script_path)
            .env("WHEELJACK_UPDATE_PID", std::process::id().to_string())
            .env("WHEELJACK_UPDATE_SOURCE", &source)
            .env("WHEELJACK_UPDATE_TARGET", &target)
            .env("WHEELJACK_UPDATE_BACKUP", backup)
            .env("WHEELJACK_UPDATE_LOG", log)
            .env("WHEELJACK_UPDATE_RECOVERY_ERROR", recovery_error)
            .env("WHEELJACK_UPDATE_SCRIPT", &script_path)
            .env("WHEELJACK_UPDATE_HEALTH_PATH", &health_path)
            .env("WHEELJACK_UPDATE_HEALTH_NONCE", &update_nonce);
        command.creation_flags(0x0800_0000);
        command.spawn().map_err(|error| error.to_string())?;
        return Ok("Update staged. wheeljack will restart.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let source_app = source
            .ancestors()
            .find(|path| path.extension().is_some_and(|value| value == "app"))
            .ok_or_else(|| "macOS update did not contain an app bundle.".to_string())?;
        let target_app = target
            .ancestors()
            .find(|path| path.extension().is_some_and(|value| value == "app"))
            .ok_or_else(|| "Current macOS app bundle could not be resolved.".to_string())?;
        let backup = target_app.with_extension("app.previous");
        let recovery_error = app_data_dir.join("updates").join("install-error.txt");
        let install_log = app_data_dir.join("updates").join("install.log");
        let script = r#"while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
rm -rf "$4"
mv "$3" "$4"
if mv "$2" "$3"; then
  "$3/Contents/MacOS/wheeljack-desktop" &
  updated_pid=$!
  attempts=0
  while [ "$attempts" -lt 100 ]; do
    if [ -f "$WHEELJACK_UPDATE_HEALTH_PATH" ] && [ "$(cat "$WHEELJACK_UPDATE_HEALTH_PATH")" = "$WHEELJACK_UPDATE_HEALTH_NONCE" ]; then
      rm -rf "$4"
      rm -f "$WHEELJACK_UPDATE_HEALTH_PATH"
      exit 0
    fi
    if ! kill -0 "$updated_pid" 2>/dev/null; then
      break
    fi
    attempts=$((attempts + 1))
    sleep 0.2
  done
  kill "$updated_pid" 2>/dev/null || true
fi
rm -rf "$3"
mv "$4" "$3"
printf '%s\n' 'The update failed and the previous version was restored.' > "$WHEELJACK_UPDATE_RECOVERY_ERROR"
printf '%s\n' 'The updated process did not report healthy; restored the previous app bundle.' >> "$WHEELJACK_UPDATE_LOG"
rm -f "$WHEELJACK_UPDATE_HEALTH_PATH"
unset WHEELJACK_UPDATE_HEALTH_PATH WHEELJACK_UPDATE_HEALTH_NONCE WHEELJACK_UPDATE_SMOKE_MODE
"$3/Contents/MacOS/wheeljack-desktop" &
exit 1"#;
        Command::new("/bin/sh")
            .args([
                "-c",
                script,
                "wheeljack-update",
                &std::process::id().to_string(),
                &source_app.to_string_lossy(),
                &target_app.to_string_lossy(),
                &backup.to_string_lossy(),
            ])
            .env("WHEELJACK_UPDATE_HEALTH_PATH", &health_path)
            .env("WHEELJACK_UPDATE_HEALTH_NONCE", &update_nonce)
            .env("WHEELJACK_UPDATE_RECOVERY_ERROR", recovery_error)
            .env("WHEELJACK_UPDATE_LOG", install_log)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok("Update staged. wheeljack will restart.".to_string());
    }

    #[allow(unreachable_code)]
    Err("Automatic update apply is unsupported on this platform.".to_string())
}

#[tauri::command]
fn close_after_flush(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "wheeljack window is unavailable.".to_string())?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    window.open_devtools();
    #[cfg(not(debug_assertions))]
    let _ = window;
}

fn canonical_update_source(update_dir: &Path, source: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(update_dir).map_err(|error| error.to_string())?;
    let source = fs::canonicalize(source).map_err(|error| error.to_string())?;
    if !source.starts_with(root) {
        return Err("Update source must be inside wheeljack's update directory.".to_string());
    }
    Ok(source)
}

pub fn run() {
    #[cfg(target_os = "macos")]
    inherit_login_shell_path();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(CoreHost::default())
        .invoke_handler(tauri::generate_handler![
            core_connect,
            core_call,
            emit_terminal_ui_fixture,
            ui_smoke_enabled,
            ui_smoke_update_mode,
            ui_smoke_auto_close,
            system_font_families,
            legacy_windows_ui_preferences,
            complete_ui_smoke,
            complete_update_health,
            read_image_attachment,
            import_image_attachment,
            save_image_attachment,
            read_theme_document,
            discover_vscode_themes,
            write_theme_document,
            apply_downloaded_update,
            close_after_flush,
            open_devtools
        ])
        .build(tauri::generate_context!())
        .expect("failed to build wheeljack desktop application");
    app.run(|app, event| {
        if matches!(event, RunEvent::Exit) {
            app.state::<CoreHost>().shutdown();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        fs,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "wheeljack-tauri-host-{}-{nanos}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ))
    }

    #[test]
    fn event_envelopes_are_monotonic_protocol_v2() {
        let first = envelope(1, "terminal:frame", &json!({"sessionId": "one"}));
        let second = envelope(2, "pty:exit", &json!({"sessionId": "one"}));
        assert_eq!(first.protocol_version, 2);
        assert_eq!(first.event_id, "event-1");
        assert!(second.sequence > first.sequence);
    }

    #[test]
    fn terminal_ui_fixture_exercises_interactive_modes() {
        let enabled = terminal_ui_fixture_payload("session-fixture", true);
        assert_eq!(enabled["sessionId"], "session-fixture");
        assert_eq!(enabled["altScreen"], true);
        assert_eq!(enabled["mouseReporting"], true);
        assert_eq!(enabled["sgrMouse"], true);
        assert_eq!(enabled["bracketedPaste"], true);

        let disabled = terminal_ui_fixture_payload("session-fixture", false);
        assert_eq!(disabled["altScreen"], false);
        assert_eq!(disabled["mouseReporting"], false);
    }

    #[test]
    fn terminal_ui_fixture_holds_live_frames_until_released() {
        let events = EventForwarder::default();
        events.set_terminal_ui_fixture("session-fixture", true);
        assert!(events
            .terminal_ui_fixtures
            .lock()
            .unwrap()
            .contains("session-fixture"));
        events.set_terminal_ui_fixture("session-fixture", false);
        assert!(!events
            .terminal_ui_fixtures
            .lock()
            .unwrap()
            .contains("session-fixture"));
    }

    #[test]
    fn ui_smoke_diagnostics_require_explicit_opt_in() {
        assert!(!ui_smoke_enabled_for(["wheeljack"], None));
        assert!(!ui_smoke_enabled_for(["wheeljack"], Some("true")));
        assert!(ui_smoke_enabled_for(["wheeljack", "--ui-smoke"], None));
        assert!(ui_smoke_enabled_for(["wheeljack"], Some("1")));
    }

    #[test]
    fn login_shell_path_ignores_startup_noise_and_preserves_fallbacks() {
        let primary = std::env::join_paths(["/opt/homebrew/bin", "/Users/test/.bun/bin"]).unwrap();
        let fallback = std::env::join_paths(["/usr/bin", "/opt/homebrew/bin"]).unwrap();
        let output = format!(
            "shell banner\n\u{1e}{}\n\u{1f}logout noise\n",
            primary.to_string_lossy()
        );
        let parsed = login_shell_path(output.as_bytes()).unwrap();
        let merged = merge_search_paths(parsed.as_ref(), Some(fallback.as_ref())).unwrap();

        assert_eq!(
            std::env::split_paths(&merged).collect::<Vec<_>>(),
            [
                PathBuf::from("/opt/homebrew/bin"),
                PathBuf::from("/Users/test/.bun/bin"),
                PathBuf::from("/usr/bin"),
            ]
        );
        assert_eq!(login_shell_path(b"shell banner only"), None);
    }

    #[test]
    fn update_smoke_auto_closes_only_after_relaunch() {
        assert!(!ui_smoke_auto_close_for(true, true, false));
        assert!(ui_smoke_auto_close_for(true, true, true));
        assert!(ui_smoke_auto_close_for(true, false, false));
        assert!(!ui_smoke_auto_close_for(false, false, false));
    }

    #[test]
    fn system_fonts_are_unique_and_sorted() {
        let fonts = system_font_families();
        assert!(fonts.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn image_attachments_use_file_signatures() {
        assert_eq!(
            image_attachment_type(b"\x89PNG\r\n\x1a\n"),
            Some(("image/png", "png"))
        );
        assert_eq!(image_attachment_type(b"not an image.png"), None);
    }

    #[test]
    fn legacy_windows_preferences_are_read_only_from_app_data() {
        let app_data_dir = test_dir();
        fs::create_dir_all(&app_data_dir).unwrap();
        fs::write(
            app_data_dir.join("windows-ui-v1.json"),
            br#"{"version":1,"mode":"fixed"}"#,
        )
        .unwrap();
        let value = read_legacy_windows_ui_preferences(&app_data_dir)
            .unwrap()
            .unwrap();
        assert_eq!(value["version"], 1);
        fs::remove_dir_all(app_data_dir).unwrap();
    }

    #[test]
    fn production_data_migration_prefers_private_production_then_older_profiles() {
        let local_data_dir = test_dir();
        assert_eq!(
            legacy_app_data_dirs(&local_data_dir),
            [
                local_data_dir.join("com.oshtz.wheeljack"),
                local_data_dir.join("wheeljack"),
                local_data_dir
                    .join("com.oshtz.wheeljack.preview")
                    .join("preview"),
            ]
        );
    }

    #[test]
    fn production_cutover_preserves_and_imports_the_private_production_profile() {
        let local_data_dir = test_dir();
        let old_dirs = legacy_app_data_dirs(&local_data_dir);
        let private_production_data = old_dirs[0].clone();
        let windows_data = old_dirs[1].clone();
        let preview_data = old_dirs[2].clone();
        let seed = |app_data_dir: &Path, project_name: &str| {
            let project_dir = local_data_dir.join(project_name);
            fs::create_dir_all(&project_dir).unwrap();
            let host = CoreHost::default();
            host.connect(InitOptions {
                platform: "windows".to_string(),
                version: "0.0.0-test".to_string(),
                app_data_dir: app_data_dir.to_path_buf(),
                cache_dir: None,
                update_dir: None,
                old_app_data_dirs: Vec::new(),
                current_executable_path: None,
                current_app_bundle_path: None,
                update_feed_url: None,
                test_mode: false,
            })
            .unwrap();
            let response = host
                .call(
                    &json!({
                        "id": project_name,
                        "command": "project_open",
                        "payload": { "path": project_dir }
                    })
                    .to_string(),
                )
                .unwrap();
            assert!(response.contains(r#""ok":true"#));
            host.shutdown();
        };
        seed(&private_production_data, "private-production-project");
        seed(&windows_data, "windows-project");
        seed(&preview_data, "preview-project");
        fs::write(
            private_production_data.join("windows-ui-v1.json"),
            br#"{"version":1,"mode":"fixed"}"#,
        )
        .unwrap();

        let production_data = local_data_dir.join("com.omershatz.wheeljack");
        let host = CoreHost::default();
        host.connect(InitOptions {
            platform: "windows".to_string(),
            version: "0.0.0-test".to_string(),
            app_data_dir: production_data.clone(),
            cache_dir: None,
            update_dir: None,
            old_app_data_dirs: old_dirs,
            current_executable_path: None,
            current_app_bundle_path: None,
            update_feed_url: None,
            test_mode: false,
        })
        .unwrap();
        let projects: Value = serde_json::from_str(
            &host
                .call(r#"{"id":"projects","command":"project_list","payload":{}}"#)
                .unwrap(),
        )
        .unwrap();
        host.shutdown();

        assert_eq!(projects["payload"].as_array().unwrap().len(), 1);
        assert_eq!(projects["payload"][0]["name"], "private-production-project");
        assert!(private_production_data.join("wheeljack.sqlite3").is_file());
        assert!(windows_data.join("wheeljack.sqlite3").is_file());
        assert!(preview_data.join("wheeljack.sqlite3").is_file());
        assert!(production_data
            .join("wheeljack.sqlite3.pre-native.bak")
            .is_file());
        assert!(production_data.join("windows-ui-v1.json").is_file());
        fs::remove_dir_all(local_data_dir).unwrap();
    }

    #[test]
    fn host_connects_calls_and_shuts_down() {
        let app_data_dir = test_dir();
        let host = CoreHost::default();
        host.connect(InitOptions {
            platform: "test".to_string(),
            version: "0.0.0-test".to_string(),
            app_data_dir: app_data_dir.clone(),
            cache_dir: None,
            update_dir: None,
            old_app_data_dirs: Vec::new(),
            current_executable_path: None,
            current_app_bundle_path: None,
            update_feed_url: None,
            test_mode: true,
        })
        .unwrap();

        let response = host
            .call(r#"{"id":"status","command":"core_status","payload":{}}"#)
            .unwrap();
        assert!(response.contains(r#""ok":true"#));
        assert!(response.contains(r#""platform":"test""#));

        let malformed = host.call("{not-json").unwrap();
        assert!(malformed.contains(r#""ok":false"#));
        assert!(malformed.contains(r#""code":"invalid_request""#));

        host.shutdown();
        assert!(host.call("{}").is_err());
        fs::remove_dir_all(app_data_dir).unwrap();
    }

    #[test]
    fn update_source_cannot_escape_update_directory() {
        let root = test_dir();
        let updates = root.join("updates");
        fs::create_dir_all(&updates).unwrap();
        let allowed = updates.join("wheeljack.exe");
        let denied = root.join("outside.exe");
        fs::write(&allowed, b"allowed").unwrap();
        fs::write(&denied, b"denied").unwrap();
        assert_eq!(
            canonical_update_source(&updates, &allowed).unwrap(),
            fs::canonicalize(&allowed).unwrap()
        );
        assert!(canonical_update_source(&updates, &denied).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn update_health_is_scoped_to_the_update_directory() {
        let root = test_dir();
        let updates = root.join("updates");
        fs::create_dir_all(&updates).unwrap();
        let health = updates.join("update-health-test.txt");
        write_update_health(&root, &health, "healthy").unwrap();
        assert_eq!(fs::read_to_string(&health).unwrap(), "healthy");

        let outside = root.join("update-health-outside.txt");
        assert!(write_update_health(&root, &outside, "healthy").is_err());
        assert!(write_update_health(&root, &health, "").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn theme_documents_require_json_or_jsonc_paths() {
        assert!(validate_theme_document_path(Path::new("theme.json")).is_ok());
        assert!(validate_theme_document_path(Path::new("theme.wheeljack-theme.json")).is_ok());
        assert!(validate_theme_document_path(Path::new("theme.jsonc")).is_ok());
        assert!(validate_theme_document_path(Path::new("theme.txt")).is_err());
    }

    #[test]
    fn discovers_vscode_theme_contributions_inside_extension_roots() {
        let root = test_dir();
        let extension = root.join("publisher.theme-1.0.0");
        let themes = extension.join("themes");
        fs::create_dir_all(&themes).unwrap();
        fs::write(
            extension.join("package.json"),
            r#"{
                "name": "theme",
                "displayName": "Theme Pack",
                "publisher": "publisher",
                "contributes": {
                    "themes": [{ "label": "Fixture Dark", "path": "./themes/dark.json" }]
                }
            }"#,
        )
        .unwrap();
        fs::write(themes.join("dark.json"), "{}").unwrap();
        let settings = root.join("settings.json");
        fs::write(&settings, "{}").unwrap();

        let catalog = discover_vscode_themes_in_roots(vec![root.clone()], Some(settings.clone()));
        assert_eq!(catalog.themes.len(), 1);
        assert_eq!(catalog.themes[0].label, "Fixture Dark");
        assert_eq!(catalog.themes[0].extension, "Theme Pack");
        assert_eq!(
            catalog.settings_path.as_deref(),
            Some(settings.to_string_lossy().as_ref())
        );
        fs::remove_dir_all(root).unwrap();
    }
}
