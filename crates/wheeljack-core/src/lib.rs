#![cfg_attr(not(test), deny(clippy::expect_used, clippy::unwrap_used))]

use alacritty_terminal::{
    event::{Event, EventListener},
    grid::{Dimensions, Scroll},
    index::{Column, Line},
    term::{cell::Flags, Config, Term, TermDamage, TermMode},
    vte::ansi::{Color, CursorShape, Processor},
};
use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose, Engine as _};
use portable_pty::{
    native_pty_system, Child as PtyChild, ChildKiller, CommandBuilder, MasterPty, PtySize,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    env,
    ffi::OsStr,
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child as ProcessChild, ChildStdin, Command, Output, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
        Arc, Condvar, Mutex, MutexGuard, OnceLock,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use time::OffsetDateTime;
use uuid::Uuid;

mod adapters;
mod agent_control;
mod agent_protocol;
mod attachment_storage;
mod bento_layout;
mod bots;
mod canvas_store;
mod coordination;
mod db;
mod dto;
mod git;
mod intent;
mod ops_runtime;
mod path_helpers;
mod project_documents;
mod project_files;
mod project_lifecycle;
mod prompt_delivery;
mod protocol;
mod session_history;
mod settings;
mod startup_recovery;
mod terminal_nodes;
mod terminal_runtime;
mod updater;
mod usage;
#[cfg(test)]
use adapters::{adapter_auth_succeeded, current_platform_id, PASTE_THEN_ENTER_SUBMIT_DELAY_MS};
use adapters::{
    adapter_registry, default_shell_command, detect_adapter_status, discover_adapter_models,
    effective_prompt_injection_for_adapter, finish_adapter_probe, normalize_adapter_manifest,
    normalize_command_cwd, payload_bytes, persist_adapter_manifest, prepare_adapter_probe,
    prompt_input_writes_payload, pty_input_blocked_reason, resolve_adapter_command,
    resolve_adapter_launch, resolve_command, resolve_optional_cwd,
    resolve_structured_adapter_launch, run_prepared_adapter_probe, split_launch_command,
    verify_adapter,
};
use agent_control::{
    append_agent_control_instructions, authorize_agent_control, list_agent_control_audit,
    load_agent_autonomy_policy, record_agent_control_result,
};
use agent_protocol::{
    apply_agent_stream_events, has_active_agent_turn, parse_agent_protocol_line,
    parse_agent_protocol_request, reduce_agent_stream_events, AgentProtocolStreamState,
};
use attachment_storage::{gc_image_attachments, image_attachment_storage_status};
use bento_layout::build_bento_layout;
use bots::{delete_bot, list_bots, upsert_bot};
#[cfg(test)]
use canvas_store::MAX_PERSISTED_TRANSCRIPT_CHUNKS;
use canvas_store::{
    canvas_camera_json, default_workspace_name_for_project, ensure_canvas_exists, load_canvas,
    load_canvas_camera_store, load_canvas_layout, load_canvas_node_adapter_id, load_nodes,
    load_project_canvas_order, load_project_canvases, next_canvas_sort_index, replace_canvas_edges,
    save_canvas_layout, sync_canvas_nodes, update_canvas_focus_selection, update_canvas_grid,
    upsert_canvas_node,
};
#[cfg(test)]
use coordination::DEFAULT_COORDINATION_TASK_LABEL;
use coordination::{
    ensure_coordination_board, plan_coordination_checklists, prepare_coordination_prompt,
    read_coordination_board_events, sync_coordination_board,
};
use db::{
    append_session_event, export_database_backup, migrate_app_data, open_app_connection,
    recover_interrupted_sessions, retry_sqlite_write, run_migrations, LATEST_SCHEMA_VERSION,
};
use dto::*;
use git::{
    cleanup_git_task_workspaces, ensure_safe_branch_name, git_command, hidden_command,
    integrate_git_worktree, is_git_repo, paths_equivalent, read_git_diff, read_git_head,
    read_git_status, read_worktree_snapshot, read_worktrees, removable_missing_worktree,
    removable_worktree, resolve_git_worktree_context, resolve_new_worktree_path,
    run_git_worktree_add, run_git_worktree_remove, validate_full_commit,
};
use intent::{
    build_orchestrator_harness_prompt, detect_local_preview_urls, json_object_without_nulls,
    normalize_browser_url, parse_intent, parse_local_orchestrator_tool_plans,
    planner_tool_plan_to_intent, strip_terminal_control_sequences,
};
#[cfg(test)]
use intent::{detect_local_preview_url, normalize_requested_cwd};
use ops_runtime::*;
#[cfg(test)]
use path_helpers::known_home_folder_path;
use path_helpers::{expand_home_path, home_dir, id, resolve_workspace_folder_path};
use project_documents::{
    commit_project_document_writes, preview_project_document_writes,
    project_document_write_fingerprint, read_project_documents, DocumentApproval,
};
use project_files::list_project_files;
use project_lifecycle::*;
use prompt_delivery::*;
use protocol::{
    response_error, response_error_versioned, response_ok_versioned, CommandError, CoreRequest,
};
use session_history::{
    contains_coordination_prompt_bytes, contains_coordination_prompt_text,
    coordination_visible_line, decode_chunks, decode_session_chunk_page, decode_visible_chunks,
    load_session_chunk_page, load_session_chunks, load_session_history, load_session_preview,
    search_session_history, trim_preview,
};
use settings::{
    apply_workspace_background_legacy_settings, has_legacy_workspace_background_patch,
    is_hex_color, redact_secrets_in_value, safe_agent_token, sanitize_setting_value,
    sanitize_workspace_background_with_legacy, settings_adapter_payload, settings_theme_payload,
    unwrap_settings_payload,
};
use startup_recovery::{begin_startup_run, StartupRecoveryState, StartupRunGuard};
use terminal_nodes::*;
use terminal_runtime::*;
#[cfg(test)]
use updater::{
    compare_versions, parse_sha256_sidecar, sha256_hex, validate_download_url, verify_sha256,
};
use updater::{
    current_updater_platform, download_update_file, downloaded_update_path, get_json, get_text,
    no_update_status, update_file_name, update_status_for_release, validate_update_archive_name,
    verify_update_signature,
};
use usage::{
    clear_usage_data, ingest_agent_usage_line, query_usage_dashboard,
    sanitize_usage_billing_overrides, set_usage_billing_override,
};

const DB_FILE_NAME: &str = "wheeljack.sqlite3";
const LEGACY_DB_FILE_NAME: &str = "txtl.sqlite3";
const MIGRATION_MARKER_FILE: &str = ".wheeljack-migration.json";
const LEGACY_SPOTIFY_TOKEN_KEY: &str = "spotify_token";
const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/bildhaus/wheeljack/releases/latest";
const UPDATE_USER_AGENT: &str = "wheeljack-updater";
const WINDOWS_NATIVE_UPDATE_ASSET: &str = "wheeljack-windows-x64-portable.exe";
const MACOS_NATIVE_UPDATE_ASSET: &str = "wheeljack.app.zip";
const MAX_UPDATE_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_UPDATE_CHECKSUM_BYTES: u64 = 1024 * 1024;
const MAX_UPDATE_METADATA_BYTES: u64 = 1024 * 1024;
const UPDATE_RECOVERY_ERROR_FILE: &str = "install-error.txt";
const TERMINAL_SCROLLBACK_LINES: usize = 4000;
const COORDINATION_PROMPT_HEADER: &str = "wheeljack workspace coordination:";
const LEGACY_COORDINATION_PROMPT_HEADER: &str = "txtl workspace coordination:";
const ROUTE_CONFIRMATION_TTL: Duration = Duration::from_secs(120);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub trait EventSink: Send + Sync {
    fn emit(&self, event: &str, payload: &Value);
}

#[derive(Default)]
pub struct NullEventSink;

impl EventSink for NullEventSink {
    fn emit(&self, _event: &str, _payload: &Value) {}
}

const CORE_RUNNING: u8 = 0;
const CORE_SHUTTING_DOWN: u8 = 1;
const CORE_STOPPED: u8 = 2;

struct EventGate {
    inner: Arc<dyn EventSink>,
    enabled: AtomicBool,
    in_flight: Mutex<usize>,
    idle: Condvar,
}

impl EventGate {
    fn new(inner: Arc<dyn EventSink>) -> Self {
        Self {
            inner,
            enabled: AtomicBool::new(true),
            in_flight: Mutex::new(0),
            idle: Condvar::new(),
        }
    }

    fn disable_and_wait(&self) {
        self.enabled.store(false, Ordering::SeqCst);
        let mut in_flight = self
            .in_flight
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        while *in_flight != 0 {
            in_flight = self
                .idle
                .wait(in_flight)
                .unwrap_or_else(|error| error.into_inner());
        }
    }
}

impl EventSink for EventGate {
    fn emit(&self, event: &str, payload: &Value) {
        if !self.enabled.load(Ordering::SeqCst) {
            return;
        }
        {
            let mut in_flight = self
                .in_flight
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if !self.enabled.load(Ordering::SeqCst) {
                return;
            }
            *in_flight += 1;
        }
        let _guard = EventEmissionGuard { gate: self };
        self.inner.emit(event, payload);
    }
}

struct EventEmissionGuard<'a> {
    gate: &'a EventGate,
}

impl Drop for EventEmissionGuard<'_> {
    fn drop(&mut self) {
        let mut in_flight = self
            .gate
            .in_flight
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *in_flight = in_flight.saturating_sub(1);
        if *in_flight == 0 {
            self.gate.idle.notify_all();
        }
    }
}

struct CoreLifecycle {
    phase: AtomicU8,
    in_flight: Mutex<usize>,
    changed: Condvar,
}

impl CoreLifecycle {
    fn new() -> Self {
        Self {
            phase: AtomicU8::new(CORE_RUNNING),
            in_flight: Mutex::new(0),
            changed: Condvar::new(),
        }
    }

    fn enter(&self) -> Option<CoreCallGuard<'_>> {
        let mut in_flight = self
            .in_flight
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if self.phase.load(Ordering::SeqCst) != CORE_RUNNING {
            return None;
        }
        *in_flight += 1;
        Some(CoreCallGuard { lifecycle: self })
    }

    fn begin_shutdown(&self) -> bool {
        if self
            .phase
            .compare_exchange(
                CORE_RUNNING,
                CORE_SHUTTING_DOWN,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_err()
        {
            let mut in_flight = self
                .in_flight
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            while self.phase.load(Ordering::SeqCst) != CORE_STOPPED {
                in_flight = self
                    .changed
                    .wait(in_flight)
                    .unwrap_or_else(|error| error.into_inner());
            }
            return false;
        }
        let mut in_flight = self
            .in_flight
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        while *in_flight != 0 {
            in_flight = self
                .changed
                .wait(in_flight)
                .unwrap_or_else(|error| error.into_inner());
        }
        true
    }

    fn finish_shutdown(&self) {
        self.phase.store(CORE_STOPPED, Ordering::SeqCst);
        self.changed.notify_all();
    }
}

struct CoreCallGuard<'a> {
    lifecycle: &'a CoreLifecycle,
}

impl Drop for CoreCallGuard<'_> {
    fn drop(&mut self) {
        let mut in_flight = self
            .lifecycle
            .in_flight
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *in_flight = in_flight.saturating_sub(1);
        if *in_flight == 0 {
            self.lifecycle.changed.notify_all();
        }
    }
}

struct NotificationEventSink {
    inner: Arc<dyn EventSink>,
    db_path: PathBuf,
    last_by_session: Mutex<HashMap<String, Instant>>,
}

impl NotificationEventSink {
    fn new(inner: Arc<dyn EventSink>, db_path: PathBuf) -> Self {
        Self {
            inner,
            db_path,
            last_by_session: Mutex::new(HashMap::new()),
        }
    }

    fn notification_payload(&self, event: &str, payload: &Value) -> Option<Value> {
        let (kind, title, body) = match event {
            "pty:exit" => {
                let exit_code = payload.get("exitCode").and_then(Value::as_i64);
                if exit_code.unwrap_or(0) == 0 {
                    (
                        "finished",
                        "Terminal finished",
                        "A terminal session finished.",
                    )
                } else {
                    (
                        "failed",
                        "Terminal failed",
                        "A terminal session exited with an error.",
                    )
                }
            }
            "agent:structured-exit" => {
                let termination_reason = payload.get("terminationReason").and_then(Value::as_str);
                if matches!(termination_reason, Some("canceled" | "shutdown")) {
                    return None;
                }
                let exit_code = payload.get("exitCode").and_then(Value::as_i64);
                if termination_reason == Some("completed") || exit_code.unwrap_or(0) == 0 {
                    ("finished", "Agent finished", "An agent session finished.")
                } else {
                    (
                        "failed",
                        "Agent failed",
                        "An agent session exited with an error.",
                    )
                }
            }
            "terminal:bell" => (
                "needs_input",
                "Terminal needs input",
                "A terminal requested attention.",
            ),
            _ => return None,
        };
        let session_id = payload
            .get("sessionId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        Some(json!({
            "id": format!("notification_{}", Uuid::now_v7()),
            "kind": kind,
            "title": title,
            "body": body,
            "sessionId": session_id,
            "callsign": "",
            "timestamp": now()
        }))
    }

    fn notifications_enabled(&self) -> bool {
        let Ok(db) = open_app_connection(&self.db_path) else {
            return true;
        };
        db.query_row(
            "SELECT value_json FROM settings WHERE key = 'notificationsEnabled'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|value| serde_json::from_str::<Value>(&value).ok())
        .and_then(|value| value.as_bool())
        .unwrap_or(true)
    }

    fn rate_limited(&self, payload: &Value) -> bool {
        let session_id = payload
            .get("sessionId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .unwrap_or("global")
            .to_string();
        let now = Instant::now();
        let Ok(mut last_by_session) = self.last_by_session.lock() else {
            return false;
        };
        if last_by_session
            .get(&session_id)
            .is_some_and(|last| now.duration_since(*last) < Duration::from_secs(5))
        {
            return true;
        }
        last_by_session.insert(session_id, now);
        false
    }
}

impl EventSink for NotificationEventSink {
    fn emit(&self, event: &str, payload: &Value) {
        self.inner.emit(event, payload);
        let Some(notification) = self.notification_payload(event, payload) else {
            return;
        };
        if self.notifications_enabled() && !self.rate_limited(&notification) {
            self.inner.emit("notification:show", &notification);
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitOptions {
    pub platform: String,
    pub version: String,
    pub app_data_dir: PathBuf,
    #[serde(default)]
    pub cache_dir: Option<PathBuf>,
    #[serde(default)]
    pub update_dir: Option<PathBuf>,
    #[serde(default)]
    pub old_app_data_dirs: Vec<PathBuf>,
    #[serde(default)]
    pub current_executable_path: Option<PathBuf>,
    #[serde(default)]
    pub current_app_bundle_path: Option<PathBuf>,
    #[serde(default)]
    pub update_feed_url: Option<String>,
    #[serde(default)]
    pub test_mode: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorePaths {
    pub app_data_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub update_dir: PathBuf,
    pub old_app_data_dirs: Vec<PathBuf>,
    pub current_executable_path: Option<PathBuf>,
    pub current_app_bundle_path: Option<PathBuf>,
}

impl CorePaths {
    fn from_init(init: &InitOptions) -> Self {
        let e2e_app_data_dir = init.test_mode.then(|| {
            env_var_os("WHEELJACK_E2E_APP_DIR", "TXTL_E2E_APP_DIR")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        });
        let app_data_dir = e2e_app_data_dir
            .flatten()
            .unwrap_or_else(|| init.app_data_dir.clone());
        let cache_dir = init
            .cache_dir
            .clone()
            .unwrap_or_else(|| app_data_dir.join("cache"));
        let update_dir = init
            .update_dir
            .clone()
            .unwrap_or_else(|| app_data_dir.join("updates"));

        Self {
            app_data_dir,
            cache_dir,
            update_dir,
            old_app_data_dirs: init.old_app_data_dirs.clone(),
            current_executable_path: init.current_executable_path.clone(),
            current_app_bundle_path: init.current_app_bundle_path.clone(),
        }
    }

    pub fn db_path(&self) -> PathBuf {
        self.app_data_dir.join(DB_FILE_NAME)
    }
}

fn env_var_os(current: &str, legacy: &str) -> Option<std::ffi::OsString> {
    std::env::var_os(current).or_else(|| std::env::var_os(legacy))
}

fn update_feed_url_from_init(init: &InitOptions) -> String {
    if let Some(url) = init
        .update_feed_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
    {
        return url.to_string();
    }
    if init.test_mode {
        if let Some(url) = env_var_os("WHEELJACK_UPDATE_FEED_URL", "TXTL_UPDATE_FEED_URL")
            .filter(|value| !value.is_empty())
            .and_then(|value| value.into_string().ok())
        {
            return url;
        }
    }
    GITHUB_LATEST_RELEASE_URL.to_string()
}

struct RouteApproval {
    fingerprint: String,
    target_fingerprint: String,
    expires_at: Instant,
}

struct PtySpawnRollback {
    killer: Option<Box<dyn ChildKiller + Send + Sync>>,
    #[cfg(windows)]
    process_id: Option<u32>,
}

impl PtySpawnRollback {
    fn new(killer: Box<dyn ChildKiller + Send + Sync>, process_id: Option<u32>) -> Self {
        #[cfg(not(windows))]
        let _ = process_id;
        Self {
            killer: Some(killer),
            #[cfg(windows)]
            process_id,
        }
    }

    fn disarm(&mut self) {
        self.killer = None;
        #[cfg(windows)]
        {
            self.process_id = None;
        }
    }
}

impl Drop for PtySpawnRollback {
    fn drop(&mut self) {
        #[cfg(windows)]
        if self.process_id.is_some_and(kill_windows_process_tree) {
            return;
        }
        if let Some(killer) = self.killer.as_mut() {
            let _ = killer.kill();
        }
    }
}

struct StructuredAttachRollback {
    child: Option<ProcessChild>,
}

impl StructuredAttachRollback {
    fn new(child: ProcessChild) -> Self {
        Self { child: Some(child) }
    }

    fn child(&self) -> &ProcessChild {
        match self.child.as_ref() {
            Some(child) => child,
            None => unreachable!("structured attach rollback always owns its child"),
        }
    }

    fn disarm(mut self) -> ProcessChild {
        match self.child.take() {
            Some(child) => child,
            None => unreachable!("structured attach rollback always owns its child"),
        }
    }
}

impl Drop for StructuredAttachRollback {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            kill_structured_process_before_attach(child);
        }
    }
}

struct StructuredSpawnRollback {
    session_id: String,
    db_path: PathBuf,
    child: Arc<Mutex<ProcessChild>>,
    process_tree: StructuredProcessTree,
    sessions: Arc<Mutex<HashMap<String, StructuredAgentSessionHandle>>>,
    readers: Vec<JoinHandle<()>>,
    reader_cancel: Arc<AtomicBool>,
    armed: bool,
}

impl StructuredSpawnRollback {
    fn new(
        session_id: String,
        db_path: PathBuf,
        child: Arc<Mutex<ProcessChild>>,
        process_tree: StructuredProcessTree,
        sessions: Arc<Mutex<HashMap<String, StructuredAgentSessionHandle>>>,
    ) -> Self {
        Self {
            session_id,
            db_path,
            child,
            process_tree,
            sessions,
            readers: Vec::new(),
            reader_cancel: Arc::new(AtomicBool::new(false)),
            armed: true,
        }
    }

    fn reader_cancel(&self) -> Arc<AtomicBool> {
        self.reader_cancel.clone()
    }

    fn own_reader(&mut self, reader: JoinHandle<()>) {
        self.readers.push(reader);
    }

    fn disarm(&mut self) {
        self.armed = false;
    }

    fn cleanup(&mut self) -> Result<()> {
        if !self.armed {
            return Ok(());
        }
        self.armed = false;
        self.reader_cancel.store(true, Ordering::SeqCst);
        let mut failures = Vec::new();

        match self.sessions.lock() {
            Ok(mut sessions) => {
                sessions.remove(&self.session_id);
            }
            Err(error) => failures.push(format!("structured session map is poisoned: {error}")),
        }
        match self.child.lock() {
            Ok(mut child) => {
                if let Err(error) = kill_structured_process(&mut child, &self.process_tree) {
                    failures.push(format!("process-tree cleanup failed: {error:#}"));
                }
            }
            Err(error) => failures.push(format!("structured child lock is poisoned: {error}")),
        }

        let deadline = Instant::now() + Duration::from_secs(6);
        for reader in self.readers.drain(..) {
            while !reader.is_finished() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(10));
            }
            if reader.is_finished() {
                if reader.join().is_err() {
                    failures.push("structured startup reader panicked".to_string());
                }
            } else {
                failures
                    .push("structured startup reader did not stop within 6 seconds".to_string());
            }
        }

        let history_cleanup = (|| -> Result<()> {
            let db = open_app_connection(&self.db_path)?;
            let tx = db.unchecked_transaction()?;
            tx.execute(
                "DELETE FROM session_chunks_fts WHERE session_id = ?1",
                params![self.session_id],
            )?;
            tx.execute(
                "DELETE FROM session_chunks WHERE session_id = ?1",
                params![self.session_id],
            )?;
            tx.execute(
                "DELETE FROM sessions WHERE id = ?1",
                params![self.session_id],
            )?;
            tx.commit()?;
            Ok(())
        })();
        if let Err(error) = history_cleanup {
            failures.push(format!(
                "structured session history cleanup failed: {error:#}"
            ));
        }

        if failures.is_empty() {
            Ok(())
        } else {
            bail!(failures.join("; "))
        }
    }

    fn failed_start(&mut self, error: anyhow::Error) -> anyhow::Error {
        match self.cleanup() {
            Ok(()) => error,
            Err(cleanup_error) => {
                anyhow!("{error:#}; structured spawn rollback also failed: {cleanup_error:#}")
            }
        }
    }
}

impl Drop for StructuredSpawnRollback {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

fn spawn_ops_scheduler_worker(
    db_path: PathBuf,
    events: Arc<dyn EventSink>,
    shutdown: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let Ok(db) = open_app_connection(&db_path) else {
            return;
        };
        while !shutdown.load(Ordering::SeqCst) {
            match tick_ops_scheduler(&db) {
                Ok(leases) => {
                    for lease in leases {
                        if let Ok(payload) = serde_json::to_value(&lease) {
                            events.emit("ops:scheduler-lease", &payload);
                        }
                    }
                }
                Err(error) => {
                    events.emit(
                        "ops:scheduler-error",
                        &json!({ "message": format!("{error:#}") }),
                    );
                }
            }
            for _ in 0..20 {
                if shutdown.load(Ordering::SeqCst) {
                    break;
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
    })
}

fn spawn_history_maintenance_worker(
    db_path: PathBuf,
    events: Arc<dyn EventSink>,
    shutdown: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        for _ in 0..50 {
            if shutdown.load(Ordering::SeqCst) {
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
        if shutdown.load(Ordering::SeqCst) {
            return;
        }
        let result = (|| -> Result<()> {
            let db = open_app_connection(&db_path)?;
            prune_all_session_chunks_to_retention(&db)?;
            prune_global_session_chunks_to_retention(&db)?;
            Ok(())
        })();
        if let Err(error) = result {
            events.emit(
                "history:maintenance-error",
                &json!({ "message": format!("{error:#}") }),
            );
        }
    })
}

pub struct Core {
    db: Mutex<Connection>,
    pty_sessions: Arc<Mutex<HashMap<String, PtySessionHandle>>>,
    structured_agent_sessions: Arc<Mutex<HashMap<String, StructuredAgentSessionHandle>>>,
    prompt_drainers: Arc<Mutex<HashSet<String>>>,
    lifecycle_processes: Arc<Mutex<HashMap<String, LifecycleProcessHandle>>>,
    lifecycle_start_lock: Mutex<()>,
    paths: CorePaths,
    platform: String,
    version: String,
    update_feed_url: String,
    test_mode: bool,
    migrated: bool,
    recovered_sessions: usize,
    startup_recovery: StartupRecoveryState,
    startup_run: StartupRunGuard,
    events: Arc<dyn EventSink>,
    event_gate: Arc<EventGate>,
    lifecycle: CoreLifecycle,
    shutdown_cancel: Arc<AtomicBool>,
    workers: Arc<Mutex<Vec<JoinHandle<()>>>>,
    response_sequence: AtomicU64,
    route_approvals: Mutex<HashMap<String, RouteApproval>>,
    document_approvals: Mutex<HashMap<String, DocumentApproval>>,
    git_mutations: Mutex<()>,
}

impl Core {
    pub fn new(init: InitOptions, events: Arc<dyn EventSink>) -> Result<Self> {
        let paths = CorePaths::from_init(&init);
        fs::create_dir_all(&paths.app_data_dir).context("create app data dir")?;
        fs::create_dir_all(&paths.cache_dir).context("create cache dir")?;
        fs::create_dir_all(&paths.update_dir).context("create update dir")?;

        let migrated = migrate_app_data(&paths).context("migrate old app data")?;
        let db_path = paths.db_path();
        let connection = open_app_connection(&db_path)?;
        run_migrations(&connection)?;
        let recovered_sessions = recover_interrupted_sessions(&connection)?;
        recover_prompt_deliveries(&connection)?;
        recover_lifecycle_runs(&connection)?;
        let _ = gc_image_attachments(&connection, &paths.app_data_dir);
        let (startup_recovery, startup_run) = begin_startup_run(
            &paths.app_data_dir,
            &init.version,
            &init.platform,
            recovered_sessions,
            !init.test_mode,
        )?;
        let update_feed_url = update_feed_url_from_init(&init);

        let notification_events: Arc<dyn EventSink> =
            Arc::new(NotificationEventSink::new(events, db_path.clone()));
        let event_gate = Arc::new(EventGate::new(notification_events));
        event_gate.emit(
            "core:ready",
            &json!({
                "platform": init.platform,
                "version": init.version,
                "appDataDir": paths.app_data_dir,
                "migrated": migrated,
                "recoveredSessions": recovered_sessions,
                "startupRecovery": startup_recovery
            }),
        );
        let events: Arc<dyn EventSink> = event_gate.clone();

        let core = Self {
            db: Mutex::new(connection),
            pty_sessions: Arc::new(Mutex::new(HashMap::new())),
            structured_agent_sessions: Arc::new(Mutex::new(HashMap::new())),
            prompt_drainers: Arc::new(Mutex::new(HashSet::new())),
            lifecycle_processes: Arc::new(Mutex::new(HashMap::new())),
            lifecycle_start_lock: Mutex::new(()),
            paths,
            platform: init.platform,
            version: init.version,
            update_feed_url,
            test_mode: init.test_mode,
            migrated,
            recovered_sessions,
            startup_recovery,
            startup_run,
            events,
            event_gate,
            lifecycle: CoreLifecycle::new(),
            shutdown_cancel: Arc::new(AtomicBool::new(false)),
            workers: Arc::new(Mutex::new(Vec::new())),
            response_sequence: AtomicU64::new(0),
            route_approvals: Mutex::new(HashMap::new()),
            document_approvals: Mutex::new(HashMap::new()),
            git_mutations: Mutex::new(()),
        };
        if !core.test_mode && !core.startup_recovery.safe_mode {
            core.register_worker(spawn_ops_scheduler_worker(
                core.paths.db_path(),
                core.events.clone(),
                core.shutdown_cancel.clone(),
            ));
            core.register_worker(spawn_history_maintenance_worker(
                core.paths.db_path(),
                core.events.clone(),
                core.shutdown_cancel.clone(),
            ));
        }
        Ok(core)
    }

    pub fn call_json(&self, request_json: &str) -> String {
        let Some(_call_guard) = self.lifecycle.enter() else {
            return response_error("", "unavailable", "wheeljack core is shutting down");
        };
        let request = match serde_json::from_str::<CoreRequest>(request_json) {
            Ok(request) => request,
            Err(error) => {
                return response_error("", "invalid_request", error.to_string());
            }
        };

        let protocol_version = request.protocol_version;
        if let Some(version) = protocol_version {
            if version != 1 && version != 2 {
                return response_error_versioned(
                    &request.id,
                    "invalid_request",
                    format!("unsupported protocol version: {version}"),
                    Some(2),
                    Some(self.response_sequence.fetch_add(1, Ordering::SeqCst) + 1),
                );
            }
        }
        let v2 = (protocol_version == Some(2)).then_some(2);
        let sequence = v2.map(|_| self.response_sequence.fetch_add(1, Ordering::SeqCst) + 1);

        match self.dispatch(&request.command, request.payload) {
            Ok(payload) => response_ok_versioned(&request.id, payload, v2, sequence),
            Err(error) => {
                response_error_versioned(&request.id, &error.code, error.message, v2, sequence)
            }
        }
    }

    pub fn shutdown(&self) {
        if !self.lifecycle.begin_shutdown() {
            return;
        }

        self.shutdown_cancel.store(true, Ordering::SeqCst);

        if let Ok(mut sessions) = self.pty_sessions.lock() {
            for (_, mut session) in sessions.drain() {
                let _ = kill_pty_session(&mut session);
            }
        }
        let structured_sessions = self
            .structured_agent_sessions
            .lock()
            .map(|mut sessions| {
                sessions
                    .drain()
                    .map(|(_, session)| session)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for session in structured_sessions {
            if let Ok(mut reason) = session.process.termination_reason.lock() {
                *reason = Some(StructuredTerminationReason::Shutdown);
            }
            if let Ok(mut child) = session.process.child.lock() {
                let _ = kill_structured_process(&mut child, &session.process.process_tree);
            }
        }
        let lifecycle_processes = self
            .lifecycle_processes
            .lock()
            .map(|mut processes| {
                processes
                    .drain()
                    .map(|(_, process)| process)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for process in lifecycle_processes {
            if let Ok(mut child) = process.child.lock() {
                let _ = kill_structured_process(&mut child, &process.process_tree);
            }
        }

        let workers = self
            .workers
            .lock()
            .map(|mut workers| std::mem::take(&mut *workers))
            .unwrap_or_default();
        for worker in workers {
            let _ = worker.join();
        }

        self.event_gate.disable_and_wait();
        let _ = self.startup_run.finish();
        self.lifecycle.finish_shutdown();
    }

    fn register_worker(&self, worker: JoinHandle<()>) {
        if let Ok(mut workers) = self.workers.lock() {
            workers.push(worker);
        }
    }

    fn dispatch(&self, command: &str, payload: Value) -> std::result::Result<Value, CommandError> {
        match command {
            "core_handshake" => self.core_handshake(payload),
            "system_diagnostics_run" => self.system_diagnostics_run().map_err(CommandError::failed),
            "core_status" => Ok(json!({
                "platform": self.platform,
                "version": self.version,
                "appDataDir": self.paths.app_data_dir,
                "cacheDir": self.paths.cache_dir,
                "updateDir": self.paths.update_dir,
                "testMode": self.test_mode,
                "migrated": self.migrated,
                "recoveredSessions": self.recovered_sessions,
                "startupRecovery": self.startup_recovery
            })),
            "adapter_list" => self.adapter_list().map_err(CommandError::failed),
            "adapter_detect" => self.adapter_detect().map_err(CommandError::failed),
            "adapter_probe" => self.adapter_probe(payload).map_err(CommandError::failed),
            "adapter_verify" => self.adapter_verify(payload).map_err(CommandError::failed),
            "adapter_save" => self.adapter_save(payload).map_err(CommandError::failed),
            "adapter_set_enabled" => self
                .adapter_set_enabled(payload)
                .map_err(CommandError::failed),
            "canvas_get" => self.canvas_get(payload).map_err(CommandError::failed),
            "canvas_list_project" => self
                .canvas_list_project(payload)
                .map_err(CommandError::failed),
            "canvas_apply_patch" => self
                .canvas_apply_patch(payload)
                .map_err(CommandError::failed),
            "canvas_upsert_node" => self
                .canvas_upsert_node(payload)
                .map_err(CommandError::failed),
            "canvas_layout_get" => self
                .canvas_layout_get(payload)
                .map_err(CommandError::failed),
            "canvas_layout_save" => self
                .canvas_layout_save(payload)
                .map_err(CommandError::failed),
            "canvas_create_project" => self
                .canvas_create_project(payload)
                .map_err(CommandError::failed),
            "canvas_reset_project" => self
                .canvas_reset_project(payload)
                .map_err(CommandError::failed),
            "canvas_delete" => self.canvas_delete(payload).map_err(CommandError::failed),
            "canvas_rename" => self.canvas_rename(payload).map_err(CommandError::failed),
            "canvas_set_theme" => self.canvas_set_theme(payload).map_err(CommandError::failed),
            "canvas_reorder_project" => self
                .canvas_reorder_project(payload)
                .map_err(CommandError::failed),
            "canvas_arrange_grid" => self
                .canvas_arrange_grid(payload)
                .map_err(CommandError::failed),
            "canvas_delete_node" => self
                .canvas_delete_node(payload)
                .map_err(CommandError::failed),
            "canvas_delete_selected" => self
                .canvas_delete_selected(payload)
                .map_err(CommandError::failed),
            "canvas_select_node" => self
                .canvas_select_node(payload)
                .map_err(CommandError::failed),
            "canvas_swap_nodes" => self
                .canvas_swap_nodes(payload)
                .map_err(CommandError::failed),
            "canvas_duplicate_node" => self
                .canvas_duplicate_node(payload)
                .map_err(CommandError::failed),
            "callsign_panel_input_resolve" => self
                .callsign_panel_input_resolve(payload)
                .map_err(CommandError::failed),
            "callsign_panel_input_route" => self
                .callsign_panel_input_route(payload)
                .map_err(CommandError::failed),
            "project_list" => self.project_list().map_err(CommandError::failed),
            "bot_list" => self.bot_list(payload).map_err(CommandError::failed),
            "bot_upsert" => self.bot_upsert(payload).map_err(CommandError::failed),
            "bot_delete" => self.bot_delete(payload).map_err(CommandError::failed),
            "project_get" => self.project_get(payload).map_err(CommandError::failed),
            "project_open" => self.project_open(payload).map_err(CommandError::failed),
            "project_update" => self.project_update(payload).map_err(CommandError::failed),
            "project_relink" => self.project_relink(payload).map_err(CommandError::failed),
            "project_remove" => self.project_remove(payload).map_err(CommandError::failed),
            "project_files_list" => self
                .project_files_list(payload)
                .map_err(CommandError::failed),
            "project_documents_read" => self
                .project_documents_read(payload)
                .map_err(CommandError::failed),
            "project_documents_preview_write" => self
                .project_documents_preview_write(payload)
                .map_err(|error| CommandError::new("invalid_request", error.to_string())),
            "project_documents_commit_write" => self
                .project_documents_commit_write(payload)
                .map_err(|error| CommandError::new("safety_denied", error.to_string())),
            "ops_state_get" => self.ops_state_get(payload).map_err(CommandError::failed),
            "ops_state_save" => self.ops_state_save(payload).map_err(CommandError::failed),
            "ops_project_state_get" => self
                .ops_project_state_get(payload)
                .map_err(CommandError::failed),
            "ops_project_state_save" => self
                .ops_project_state_save(payload)
                .map_err(CommandError::failed),
            "ops_scheduler_configure" => self
                .ops_scheduler_configure(payload)
                .map_err(CommandError::failed),
            "ops_scheduler_status" => self
                .ops_scheduler_status(payload)
                .map_err(CommandError::failed),
            "ops_scheduler_claim" => self
                .ops_scheduler_claim(payload)
                .map_err(CommandError::failed),
            "ops_scheduler_heartbeat" => self
                .ops_scheduler_heartbeat(payload)
                .map_err(CommandError::failed),
            "ops_scheduler_finish" => self
                .ops_scheduler_finish(payload)
                .map_err(CommandError::failed),
            "ops_scheduler_recover" => self
                .ops_scheduler_recover(payload)
                .map_err(CommandError::failed),
            "git_status" => self.git_status(payload).map_err(CommandError::failed),
            "git_diff" => self.git_diff(payload).map_err(CommandError::failed),
            "git_worktree_create" => self
                .git_worktree_create(payload)
                .map_err(CommandError::failed),
            "git_worktree_review" => self
                .git_worktree_review(payload)
                .map_err(CommandError::failed),
            "git_worktree_integrate" => self
                .git_worktree_integrate(payload)
                .map_err(CommandError::failed),
            "git_worktree_remove" => self
                .git_worktree_remove(payload)
                .map_err(CommandError::failed),
            "git_task_workspaces_cleanup" => self
                .git_task_workspaces_cleanup(payload)
                .map_err(CommandError::failed),
            "coordination_board_ensure" => self
                .coordination_board_ensure(payload)
                .map_err(CommandError::failed),
            "coordination_board_sync" => self
                .coordination_board_sync(payload)
                .map_err(CommandError::failed),
            "coordination_board_events" => self
                .coordination_board_events(payload)
                .map_err(CommandError::failed),
            "coordination_checklist_plan" => self
                .coordination_checklist_plan(payload)
                .map_err(CommandError::failed),
            "coordination_prompt_prepare" => self
                .coordination_prompt_prepare(payload)
                .map_err(CommandError::failed),
            "agent_control_authorize" => self
                .agent_control_authorize(payload)
                .map_err(CommandError::failed),
            "agent_control_result" => self
                .agent_control_result(payload)
                .map_err(CommandError::failed),
            "agent_control_audit" => self
                .agent_control_audit(payload)
                .map_err(CommandError::failed),
            "prompt_input_writes" => self
                .prompt_input_writes(payload)
                .map_err(CommandError::failed),
            "session_prompt_send" => self
                .session_prompt_send(payload)
                .map_err(CommandError::failed),
            "session_prompt_submit" => self
                .session_prompt_submit(payload)
                .map_err(CommandError::failed),
            "session_prompt_list" => self
                .session_prompt_list(payload)
                .map_err(CommandError::failed),
            "session_prompt_retry" => self
                .session_prompt_retry(payload)
                .map_err(CommandError::failed),
            "session_prompt_edit" => self
                .session_prompt_edit(payload)
                .map_err(CommandError::failed),
            "session_prompt_cancel" => self
                .session_prompt_cancel(payload)
                .map_err(CommandError::failed),
            "project_lifecycle_inspect" => self
                .project_lifecycle_inspect(payload)
                .map_err(CommandError::failed),
            "project_lifecycle_trust" => self
                .project_lifecycle_trust(payload)
                .map_err(CommandError::failed),
            "project_lifecycle_start" => self
                .project_lifecycle_start(payload)
                .map_err(CommandError::failed),
            "project_lifecycle_stop" => self
                .project_lifecycle_stop(payload)
                .map_err(CommandError::failed),
            "project_lifecycle_runs" => self
                .project_lifecycle_runs(payload)
                .map_err(CommandError::failed),
            "project_lifecycle_current" => self
                .project_lifecycle_current(payload)
                .map_err(CommandError::failed),
            "project_lifecycle_logs" => self
                .project_lifecycle_logs(payload)
                .map_err(CommandError::failed),
            "pty_input_blocked_reason" => self
                .pty_input_blocked_reason(payload)
                .map_err(CommandError::failed),
            "agent_structured_spawn" => self
                .agent_structured_spawn(payload)
                .map_err(CommandError::failed),
            "agent_models_list" => self
                .agent_models_list(payload)
                .map_err(CommandError::failed),
            "agent_structured_prompt" => self
                .agent_structured_prompt(payload)
                .map_err(CommandError::failed),
            "agent_structured_respond" => self
                .agent_structured_respond(payload)
                .map_err(CommandError::failed),
            "agent_structured_cancel" => self
                .agent_structured_cancel(payload)
                .map_err(CommandError::failed),
            "agent_structured_kill" => self
                .agent_structured_kill(payload)
                .map_err(CommandError::failed),
            "agent_structured_terminal_attach" => self
                .agent_structured_terminal_attach(payload)
                .map_err(CommandError::failed),
            "agent_protocol_parse" => self
                .agent_protocol_parse(payload)
                .map_err(CommandError::failed),
            "bento_layout" => self.bento_layout(payload).map_err(CommandError::failed),
            "browser_detect_local_preview_urls" => self
                .browser_detect_local_preview_urls(payload)
                .map_err(CommandError::failed),
            "intent_parse" => self.intent_parse(payload).map_err(CommandError::failed),
            "intent_execute" => self.intent_execute(payload).map_err(CommandError::failed),
            "orchestrator_route" => self
                .orchestrator_route(payload)
                .map_err(CommandError::failed),
            "route_preview" => self
                .route_preview(payload)
                .map_err(|error| CommandError::new("invalid_request", error.to_string())),
            "route_execute" => self
                .route_execute(payload)
                .map_err(|error| CommandError::new("safety_denied", error.to_string())),
            "orchestrator_harness_prompt" => self
                .orchestrator_harness_prompt(payload)
                .map_err(CommandError::failed),
            "orchestrator_tool_plan_parse" => self
                .orchestrator_tool_plan_parse(payload)
                .map_err(CommandError::failed),
            "orchestrator_tool_plan_intent" => self
                .orchestrator_tool_plan_intent(payload)
                .map_err(CommandError::failed),
            "pty_spawn" => self.pty_spawn(payload).map_err(CommandError::failed),
            "pty_write" => self.pty_write(payload).map_err(CommandError::failed),
            "pty_resize" => self.pty_resize(payload).map_err(CommandError::failed),
            "terminal_viewport" => self
                .terminal_viewport(payload)
                .map_err(CommandError::failed),
            "pty_kill" => self.pty_kill(payload).map_err(CommandError::failed),
            "session_list" => self.session_list(payload).map_err(CommandError::failed),
            "session_statuses" => self.session_statuses(payload).map_err(CommandError::failed),
            "session_kill" => self.session_kill(payload).map_err(CommandError::failed),
            "session_transcript" => self
                .session_transcript(payload)
                .map_err(CommandError::failed),
            "session_transcript_page" => self
                .session_transcript_page(payload)
                .map_err(CommandError::failed),
            "session_search" => self.session_search(payload).map_err(CommandError::failed),
            "session_event_append" => self
                .session_event_append(payload)
                .map_err(CommandError::failed),
            "activity_list" => self.activity_list(payload).map_err(CommandError::failed),
            "activity_mark_read" => self
                .activity_mark_read(payload)
                .map_err(CommandError::failed),
            "activity_clear" => self.activity_clear().map_err(CommandError::failed),
            "terminal_session_index" => self
                .terminal_session_index(payload)
                .map_err(CommandError::failed),
            "terminal_transcripts_clear" => self
                .terminal_transcripts_clear(payload)
                .map_err(CommandError::failed),
            "terminal_session_mark_exited" => self
                .terminal_session_mark_exited(payload)
                .map_err(CommandError::failed),
            "terminal_pending_prompt_clear" => self
                .terminal_pending_prompt_clear(payload)
                .map_err(CommandError::failed),
            "terminal_transcript_append" => self
                .terminal_transcript_append(payload)
                .map_err(CommandError::failed),
            "terminal_worktree_assign" => self
                .terminal_worktree_assign(payload)
                .map_err(CommandError::failed),
            "session_clear_transcripts" => self
                .session_clear_transcripts()
                .map_err(CommandError::failed),
            "attachment_storage_status" => self
                .attachment_storage_status()
                .map_err(CommandError::failed),
            "attachment_gc" => self.attachment_gc().map_err(CommandError::failed),
            "usage_dashboard" => self.usage_dashboard(payload).map_err(CommandError::failed),
            "usage_billing_override_set" => self
                .usage_billing_override_set(payload)
                .map_err(CommandError::failed),
            "usage_clear" => self.usage_clear().map_err(CommandError::failed),
            "state_backup_export" => self
                .state_backup_export(payload)
                .map_err(CommandError::failed),
            "settings_export" => self.settings_export().map_err(CommandError::failed),
            "settings_import" => self.settings_import(payload).map_err(CommandError::failed),
            "updater_platform" => self.updater_platform().map_err(CommandError::failed),
            "updater_status" => self.updater_status().map_err(CommandError::failed),
            "updater_check" => self.updater_check().map_err(CommandError::failed),
            "updater_download" => self.updater_download().map_err(CommandError::failed),
            "updater_recovery_error" => self.updater_recovery_error().map_err(CommandError::failed),
            "smoke_slow" if self.test_mode => {
                self.smoke_slow(payload).map_err(CommandError::failed)
            }
            "smoke_recover_interrupted_session" if self.test_mode => self
                .smoke_recover_interrupted_session()
                .map_err(CommandError::failed),
            other => Err(CommandError::new(
                "unsupported_command",
                format!("{other} is not supported by wheeljack-core"),
            )),
        }
    }

    fn core_handshake(&self, payload: Value) -> std::result::Result<Value, CommandError> {
        let supported = payload
            .get("supportedVersions")
            .and_then(Value::as_array)
            .map(|versions| {
                versions
                    .iter()
                    .filter_map(Value::as_u64)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(|| vec![1]);
        let protocol_version = if supported.contains(&2) {
            2
        } else if supported.contains(&1) {
            1
        } else {
            return Err(CommandError::new(
                "invalid_request",
                "no mutually supported protocol version",
            ));
        };
        Ok(json!({
            "protocolVersion": protocol_version,
            "capabilities": [
                "typed-agent-core",
                "route-confirmation",
                "route-target-details-v1",
                "coordination-board-v1",
                "project-documents-v1",
                "structured-agent-idle-v1",
                "durable-activity",
                "git-diff-v1",
                "git-worktrees",
                "git-task-lanes-v1",
                "session-recovery"
                ,"adapter-readiness-v1",
                "prompt-delivery-v1",
                "session-intent-v1",
                "project-lifecycle-v1",
                "system-diagnostics-v1"
            ]
        }))
    }

    fn system_diagnostics_run(&self) -> Result<Value> {
        let db = self.lock_db()?;
        let sqlite: String = db.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        let running_sessions: i64 = db.query_row(
            "SELECT COUNT(*) FROM sessions WHERE status = 'running'",
            [],
            |row| row.get(0),
        )?;
        let pending_prompts: i64 = db.query_row(
            "SELECT COUNT(*) FROM session_prompt_deliveries
             WHERE state IN ('queued', 'dispatching', 'failed', 'indeterminate', 'blocked')",
            [],
            |row| row.get(0),
        )?;
        let active_lifecycle: i64 = db.query_row(
            "SELECT COUNT(*) FROM project_lifecycle_runs
             WHERE state IN ('starting', 'running', 'ready', 'stopping')",
            [],
            |row| row.get(0),
        )?;
        let directory_checks = [
            ("appData", &self.paths.app_data_dir),
            ("cache", &self.paths.cache_dir),
            ("updates", &self.paths.update_dir),
        ]
        .into_iter()
        .map(|(name, path)| {
            json!({
                "name": name,
                "ok": path.is_dir(),
                "path": path,
            })
        })
        .collect::<Vec<_>>();
        Ok(json!({
            "ok": sqlite == "ok" && directory_checks.iter().all(|check| check.get("ok") == Some(&Value::Bool(true))),
            "checkedAt": now(),
            "core": { "version": self.version, "platform": self.platform },
            "database": { "ok": sqlite == "ok", "quickCheck": sqlite, "schemaVersion": LATEST_SCHEMA_VERSION },
            "directories": directory_checks,
            "runtime": {
                "runningSessions": running_sessions,
                "unresolvedPromptDeliveries": pending_prompts,
                "activeLifecycleRuns": active_lifecycle,
                "structuredProcesses": self.structured_agent_sessions.lock().map(|sessions| sessions.len()).unwrap_or_default(),
                "ptyProcesses": self.pty_sessions.lock().map(|sessions| sessions.len()).unwrap_or_default()
            }
        }))
    }

    fn smoke_slow(&self, payload: Value) -> Result<Value> {
        let delay_ms = payload
            .get("delayMs")
            .and_then(Value::as_u64)
            .unwrap_or(250)
            .min(2_000);
        thread::sleep(Duration::from_millis(delay_ms));
        Ok(json!({ "delayMs": delay_ms }))
    }

    fn smoke_recover_interrupted_session(&self) -> Result<Value> {
        let suffix = id("smoke_recovery");
        let project_id = format!("project_smoke_recovery_{suffix}");
        let canvas_id = format!("canvas_smoke_recovery_{suffix}");
        let node_id = format!("node_smoke_recovery_{suffix}");
        let session_id = format!("session_smoke_recovery_{suffix}");
        let timestamp = now();
        let project_path = self
            .paths
            .app_data_dir
            .join(format!("smoke-restart-recovery-{suffix}"))
            .to_string_lossy()
            .to_string();
        fs::create_dir_all(&project_path)?;
        let db = self.lock_db()?;
        let running_before: i64 = db.query_row(
            "SELECT COUNT(*) FROM sessions WHERE status = 'running'",
            [],
            |row| row.get(0),
        )?;
        if running_before > 0 {
            bail!("smoke recovery command requires no active running sessions.");
        }
        db.execute(
            "INSERT INTO projects (id, name, path, created_at, updated_at)
             VALUES (?1, 'Smoke recovery', ?2, ?3, ?3)",
            params![project_id, project_path, timestamp],
        )?;
        db.execute(
            "INSERT INTO canvases (id, project_id, name, theme_id, camera_json, created_at, updated_at)
             VALUES (?1, ?2, 'Smoke recovery', 'mono-dark', '{\"x\":0,\"y\":0,\"scale\":1}', ?3, ?3)",
            params![canvas_id, project_id, timestamp],
        )?;
        db.execute(
            "INSERT INTO nodes (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
             VALUES (?1, ?2, 'shell_terminal', 'Smoke recovery', 0, 0, 1, 1, 0, ?3, ?4, ?4)",
            params![
                node_id,
                canvas_id,
                json!({
                    "sessionId": session_id,
                    "status": "running",
                    "transcript": ["wheeljack smoke restart recovery"]
                })
                .to_string(),
                timestamp
            ],
        )?;
        db.execute(
            "INSERT INTO sessions (id, node_id, node_title, adapter_id, command_json, cwd, status, created_at, updated_at)
             VALUES (?1, ?2, COALESCE((SELECT title FROM nodes WHERE id = ?2), ''), 'shell', '{}', ?3, 'running', ?4, ?4)",
            params![session_id, node_id, project_path, timestamp],
        )?;

        let recovered_sessions = recover_interrupted_sessions(&db)?;
        let session_status: String = db.query_row(
            "SELECT status FROM sessions WHERE id = ?1",
            params![session_id],
            |row| row.get(0),
        )?;
        let node_data_json: String = db.query_row(
            "SELECT data_json FROM nodes WHERE id = ?1",
            params![node_id],
            |row| row.get(0),
        )?;
        let node_data = serde_json::from_str::<Value>(&node_data_json)?;
        let transcript_text = node_data
            .get("transcript")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();

        Ok(json!({
            "recoveredSessions": recovered_sessions,
            "sessionId": session_id,
            "nodeId": node_id,
            "sessionStatus": session_status,
            "nodeStatus": node_data.get("status").and_then(Value::as_str).unwrap_or_default(),
            "transcriptText": transcript_text
        }))
    }

    fn adapter_list(&self) -> Result<Value> {
        let db = self.lock_db()?;
        Ok(serde_json::to_value(adapter_registry(&db)?)?)
    }

    fn adapter_detect(&self) -> Result<Value> {
        let db = self.lock_db()?;
        Ok(serde_json::to_value(
            adapter_registry(&db)?
                .into_iter()
                .map(detect_adapter_status)
                .collect::<Vec<_>>(),
        )?)
    }

    fn adapter_probe(&self, payload: Value) -> Result<Value> {
        let adapter_id = required_str(&payload, "adapterId")?;
        let launch_args = payload
            .get("args")
            .cloned()
            .map(serde_json::from_value::<Vec<String>>)
            .transpose()?
            .unwrap_or_default();
        let launch_config = serde_json::from_value::<AdapterLaunchConfig>(payload.clone())?;
        let prepared = {
            let db = self.lock_db()?;
            prepare_adapter_probe(&db, adapter_id, &launch_args, &launch_config)?
        };
        let probe = run_prepared_adapter_probe(&prepared);
        let db = self.lock_db()?;
        Ok(serde_json::to_value(finish_adapter_probe(
            &db, probe, &prepared,
        )?)?)
    }

    fn adapter_verify(&self, payload: Value) -> Result<Value> {
        let adapter_id = required_str(&payload, "adapterId")?;
        let cwd = payload.get("cwd").and_then(Value::as_str);
        let launch_args = payload
            .get("args")
            .cloned()
            .map(serde_json::from_value::<Vec<String>>)
            .transpose()?
            .unwrap_or_default();
        let launch_config = serde_json::from_value::<AdapterLaunchConfig>(payload.clone())?;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(verify_adapter(
            &db,
            adapter_id,
            cwd,
            &launch_args,
            &launch_config,
        )?)?)
    }

    fn adapter_save(&self, payload: Value) -> Result<Value> {
        let manifest = normalize_adapter_manifest(serde_json::from_value::<AdapterDto>(
            unwrap_payload(payload, "manifest"),
        )?);
        if manifest.id == "wheeljack-ui-fixture" && !self.test_mode {
            bail!("wheeljack-ui-fixture is available only in an isolated test profile");
        }
        let db = self.lock_db()?;
        Ok(serde_json::to_value(persist_adapter_manifest(
            &db, manifest,
        )?)?)
    }

    fn adapter_set_enabled(&self, payload: Value) -> Result<Value> {
        let adapter_id = required_str(&payload, "adapterId")?;
        let enabled = payload
            .get("enabled")
            .and_then(Value::as_bool)
            .ok_or_else(|| anyhow!("payload.enabled is required"))?;
        if adapter_id == "generic-shell" && !enabled {
            bail!("generic-shell cannot be disabled");
        }
        let db = self.lock_db()?;
        let mut manifest = adapter_registry(&db)?
            .into_iter()
            .find(|adapter| adapter.id == adapter_id)
            .ok_or_else(|| anyhow!("unknown adapter: {adapter_id}"))?;
        manifest.enabled = enabled;
        db.execute(
            "INSERT OR REPLACE INTO adapter_configs (id, manifest_json, enabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, COALESCE((SELECT created_at FROM adapter_configs WHERE id = ?1), ?4), ?4)",
            params![manifest.id, serde_json::to_string(&manifest)?, enabled, now()],
        )?;
        Ok(serde_json::to_value(manifest)?)
    }

    fn project_list(&self) -> Result<Value> {
        let db = self.lock_db()?;
        let mut stmt = db.prepare(
            "SELECT id, name, path, icon, icon_color, agent_access
             FROM projects
             WHERE archived_at IS NULL
             ORDER BY last_opened_at DESC, created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let path: String = row.get(2)?;
            let git = read_git_status(Path::new(&path), false);
            Ok(ProjectDto {
                id: row.get(0)?,
                name: row.get(1)?,
                path,
                icon: row.get(3)?,
                icon_color: row.get(4)?,
                agent_access: row.get(5)?,
                branch: git.branch,
                dirty: git.dirty,
                github_remote: git.github_remote,
                path_exists: git.path_exists,
            })
        })?;
        let projects = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(serde_json::to_value(projects)?)
    }

    fn bot_list(&self, payload: Value) -> Result<Value> {
        let project_id = payload
            .get("projectId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty());
        let db = self.lock_db()?;
        Ok(serde_json::to_value(list_bots(&db, project_id)?)?)
    }

    fn bot_upsert(&self, payload: Value) -> Result<Value> {
        let request = serde_json::from_value::<BotUpsertRequest>(payload)?;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(upsert_bot(&db, request)?)?)
    }

    fn bot_delete(&self, payload: Value) -> Result<Value> {
        let bot_id = required_str(&payload, "botId")?;
        let db = self.lock_db()?;
        Ok(json!({ "deleted": delete_bot(&db, bot_id)? }))
    }

    fn project_get(&self, payload: Value) -> Result<Value> {
        let project_id = required_str(&payload, "projectId")?;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(load_project_dto(&db, project_id)?)?)
    }

    fn project_files_list(&self, payload: Value) -> Result<Value> {
        let project_path = required_str(&payload, "projectPath")?;
        let root = resolve_workspace_folder_path(project_path)?;
        Ok(serde_json::to_value(list_project_files(&root)?)?)
    }

    fn project_documents_read(&self, payload: Value) -> Result<Value> {
        let project_path = required_str(&payload, "projectPath")?;
        Ok(serde_json::to_value(read_project_documents(project_path)?)?)
    }

    fn project_documents_preview_write(&self, payload: Value) -> Result<Value> {
        let request =
            serde_json::from_value::<ProjectDocumentsWriteRequest>(unwrap_payload(payload, "req"))?;
        let (writes, diff) = preview_project_document_writes(&request)?;
        let fingerprint = project_document_write_fingerprint(&request.project_path, &writes)?;
        let confirmation_token = Uuid::now_v7().to_string();
        let mut approvals = self
            .document_approvals
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?;
        let current = Instant::now();
        approvals.retain(|_, approval| approval.expires_at > current);
        approvals.insert(
            confirmation_token.clone(),
            DocumentApproval {
                fingerprint,
                expires_at: current + ROUTE_CONFIRMATION_TTL,
            },
        );
        Ok(serde_json::to_value(ProjectDocumentsWritePreviewDto {
            preview_id: id("document_preview"),
            confirmation_token,
            diff,
            writes,
            requires_confirmation: true,
        })?)
    }

    fn project_documents_commit_write(&self, payload: Value) -> Result<Value> {
        let request =
            serde_json::from_value::<ProjectDocumentsWriteRequest>(unwrap_payload(payload, "req"))?;
        let token = request
            .confirmation_token
            .as_deref()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("project document write requires a confirmation token"))?;
        let approval = self
            .document_approvals
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?
            .remove(token)
            .ok_or_else(|| {
                anyhow!("project document confirmation token is invalid or already used")
            })?;
        if approval.expires_at <= Instant::now() {
            bail!("project document confirmation token has expired");
        }
        let (writes, _) = preview_project_document_writes(&request)?;
        if approval.fingerprint
            != project_document_write_fingerprint(&request.project_path, &writes)?
        {
            bail!("project document confirmation token does not match this write");
        }
        Ok(serde_json::to_value(commit_project_document_writes(
            &request,
        )?)?)
    }

    fn project_open(&self, payload: Value) -> Result<Value> {
        let requested_path = payload
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("project_open payload.path is required"))?;
        let path = resolve_workspace_folder_path(requested_path)?;
        let path_string = path.to_string_lossy().to_string();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("project")
            .to_string();
        let ts = now();
        let project_id = id("project");
        let canvas_id = id("canvas");
        let db = self.lock_db()?;
        db.execute(
            "INSERT OR IGNORE INTO projects (id, name, path, created_at, updated_at, last_opened_at)
             VALUES (?1, ?2, ?3, ?4, ?4, ?4)",
            params![project_id, name, path_string, ts],
        )?;
        let project_id: String = db.query_row(
            "SELECT id FROM projects WHERE path = ?1",
            params![path_string],
            |row| row.get(0),
        )?;
        let canvas_count: i64 = db.query_row(
            "SELECT COUNT(*) FROM canvases WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )?;
        if canvas_count == 0 {
            db.execute(
                "INSERT INTO canvases (id, project_id, name, theme_id, camera_json, sort_index, created_at, updated_at)
                 VALUES (?1, ?2, 'Main canvas', 'mono-dark', ?3, 0, ?4, ?4)",
                params![
                    canvas_id,
                    project_id,
                    canvas_camera_json(
                        &CameraDto {
                            x: 120.0,
                            y: 96.0,
                            scale: 1.0
                        },
                        Some(0),
                        Some(0),
                        Vec::new(),
                        None
                    )?,
                    now()
                ],
            )?;
        }
        db.execute(
            "UPDATE projects
             SET last_opened_at = ?1, updated_at = ?1, archived_at = NULL
             WHERE id = ?2",
            params![now(), project_id],
        )?;
        Ok(serde_json::to_value(load_project_dto(&db, &project_id)?)?)
    }

    fn project_update(&self, payload: Value) -> Result<Value> {
        let project_value = payload.get("project").cloned().unwrap_or(payload);
        let project = serde_json::from_value::<ProjectDto>(project_value)?;
        if !matches!(
            project.icon.as_str(),
            "folder"
                | "code"
                | "terminal"
                | "book"
                | "briefcase"
                | "cloud"
                | "server"
                | "grid"
                | "ai"
                | "building"
                | "globe"
                | "layers"
                | "library"
                | "map"
                | "memory"
                | "monitor"
                | "flag"
                | "inventory"
                | "spark"
                | "star"
                | "activity"
                | "article"
                | "checklist"
                | "key"
                | "lightning"
                | "link"
                | "pin"
                | "target"
        ) {
            bail!("unsupported project icon: {}", project.icon);
        }
        if project.icon_color.len() != 7
            || !project.icon_color.starts_with('#')
            || !project.icon_color[1..]
                .chars()
                .all(|ch| ch.is_ascii_hexdigit())
        {
            bail!("project icon color must use #RRGGBB format");
        }
        if !matches!(project.agent_access.as_str(), "default" | "full") {
            bail!("unsupported project agent access: {}", project.agent_access);
        }
        let db = self.lock_db()?;
        db.execute(
            "UPDATE projects SET name = ?1, path = ?2, icon = ?3, icon_color = ?4, agent_access = ?5, updated_at = ?6 WHERE id = ?7",
            params![project.name, project.path, project.icon, project.icon_color, project.agent_access, now(), project.id],
        )?;
        Ok(serde_json::to_value(load_project_dto(&db, &project.id)?)?)
    }

    fn project_relink(&self, payload: Value) -> Result<Value> {
        let project_id = required_str(&payload, "projectId")?;
        let requested_path = required_str(&payload, "path")?;
        let path = resolve_workspace_folder_path(requested_path)?;
        let path_string = path.to_string_lossy().to_string();
        let db = self.lock_db()?;
        let exists: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
            params![project_id],
            |row| row.get(0),
        )?;
        if !exists {
            bail!("project not found: {project_id}");
        }
        let owner = db
            .query_row(
                "SELECT id FROM projects WHERE path = ?1",
                params![path_string],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if owner.as_deref().is_some_and(|owner| owner != project_id) {
            bail!("project path is already registered");
        }
        let ts = now();
        db.execute(
            "UPDATE projects
             SET path = ?1, updated_at = ?2, last_opened_at = ?2, archived_at = NULL
             WHERE id = ?3",
            params![path_string, ts, project_id],
        )?;
        Ok(serde_json::to_value(load_project_dto(&db, project_id)?)?)
    }

    fn project_remove(&self, payload: Value) -> Result<Value> {
        let project_id = required_str(&payload, "projectId")?;
        let delete_from_disk = payload
            .get("deleteFromDisk")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let db = self.lock_db()?;
        let _project_path: String = db
            .query_row(
                "SELECT path FROM projects WHERE id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| anyhow!("project not found: {project_id}"))?;
        let active_sessions: i64 = db.query_row(
            "SELECT COUNT(*)
             FROM sessions s
             JOIN nodes n ON n.id = s.node_id
             JOIN canvases c ON c.id = n.canvas_id
             WHERE c.project_id = ?1 AND s.status = 'running'",
            params![project_id],
            |row| row.get(0),
        )?;
        if active_sessions > 0 {
            bail!("stop active project sessions before removing this project");
        }

        if delete_from_disk {
            bail!("wheeljack no longer deletes project folders. Remove the project from wheeljack, then delete its folder with your operating system if you still want to.");
        }

        db.execute(
            "UPDATE projects SET archived_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now(), project_id],
        )?;
        Ok(json!({
            "projectId": project_id,
            "archived": true,
            "deletedFromDisk": false
        }))
    }

    fn ops_state_get(&self, payload: Value) -> Result<Value> {
        let canvas_id = required_str(&payload, "canvasId")?;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(load_ops_state(&db, canvas_id)?)?)
    }

    fn ops_state_save(&self, payload: Value) -> Result<Value> {
        let canvas_id = required_str(&payload, "canvasId")?;
        let project_id = required_str(&payload, "projectId")?;
        let state = payload
            .get("state")
            .filter(|state| state.is_object())
            .ok_or_else(|| anyhow!("payload.state must be an object"))?;
        let expected_revision = payload.get("expectedRevision").and_then(Value::as_u64);
        let db = self.lock_db()?;
        Ok(serde_json::to_value(save_ops_state(
            &db,
            canvas_id,
            project_id,
            state,
            expected_revision,
        )?)?)
    }

    fn ops_project_state_get(&self, payload: Value) -> Result<Value> {
        let project_id = required_str(&payload, "projectId")?;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(load_project_ops_state(
            &db, project_id,
        )?)?)
    }

    fn ops_project_state_save(&self, payload: Value) -> Result<Value> {
        let project_id = required_str(&payload, "projectId")?;
        let state = payload
            .get("state")
            .filter(|state| state.is_object())
            .ok_or_else(|| anyhow!("payload.state must be an object"))?;
        let expected_revision = payload.get("expectedRevision").and_then(Value::as_u64);
        let db = self.lock_db()?;
        Ok(serde_json::to_value(save_project_ops_state(
            &db,
            project_id,
            state,
            expected_revision,
        )?)?)
    }

    fn ops_scheduler_configure(&self, payload: Value) -> Result<Value> {
        let project_id = required_str(&payload, "projectId")?;
        let canvas_id = required_str(&payload, "canvasId")?;
        let enabled = payload
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let paused = payload
            .get("paused")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let concurrency_limit = payload
            .get("concurrencyLimit")
            .and_then(Value::as_u64)
            .unwrap_or(1)
            .clamp(1, 8) as u8;
        let adapter_id = payload
            .get("adapterId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty());
        let db = self.lock_db()?;
        let canvas_project: String = db.query_row(
            "SELECT project_id FROM canvases WHERE id = ?1",
            params![canvas_id],
            |row| row.get(0),
        )?;
        if canvas_project != project_id {
            bail!("canvas does not belong to the requested project");
        }
        let config = configure_ops_scheduler(
            &db,
            project_id,
            canvas_id,
            enabled,
            paused,
            concurrency_limit,
            adapter_id,
        )?;
        Ok(serde_json::to_value(config)?)
    }

    fn ops_scheduler_status(&self, payload: Value) -> Result<Value> {
        let project_id = required_str(&payload, "projectId")?;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(load_ops_scheduler_config(
            &db, project_id,
        )?)?)
    }

    fn ops_scheduler_claim(&self, payload: Value) -> Result<Value> {
        let project_id = required_str(&payload, "projectId")?;
        let owner_id = required_str(&payload, "ownerId")?;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(claim_ops_lease(
            &db, project_id, owner_id,
        )?)?)
    }

    fn ops_scheduler_heartbeat(&self, payload: Value) -> Result<Value> {
        let lease_id = required_str(&payload, "leaseId")?;
        let owner_id = required_str(&payload, "ownerId")?;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(heartbeat_ops_lease(
            &db, lease_id, owner_id,
        )?)?)
    }

    fn ops_scheduler_finish(&self, payload: Value) -> Result<Value> {
        let lease_id = required_str(&payload, "leaseId")?;
        let owner_id = required_str(&payload, "ownerId")?;
        let state = required_str(&payload, "state")?;
        let db = self.lock_db()?;
        finish_ops_lease(&db, lease_id, owner_id, state)?;
        Ok(Value::Null)
    }

    fn ops_scheduler_recover(&self, payload: Value) -> Result<Value> {
        let lease_id = required_str(&payload, "leaseId")?;
        let state = required_str(&payload, "state")?;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(recover_ops_lease(
            &db, lease_id, state,
        )?)?)
    }

    fn git_status(&self, payload: Value) -> Result<Value> {
        let path = required_str(&payload, "path")?;
        let include_worktrees = payload
            .get("includeWorktrees")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Ok(serde_json::to_value(read_git_status(
            &expand_home_path(path),
            include_worktrees,
        ))?)
    }

    fn git_diff(&self, payload: Value) -> Result<Value> {
        let path = required_str(&payload, "path")?;
        Ok(serde_json::to_value(read_git_diff(&expand_home_path(
            path,
        ))?)?)
    }

    fn git_worktree_create(&self, payload: Value) -> Result<Value> {
        let _git_guard = self
            .git_mutations
            .lock()
            .map_err(|_| anyhow!("Git operation lock is poisoned"))?;
        let req =
            serde_json::from_value::<GitWorktreeCreateRequest>(unwrap_payload(payload, "req"))?;
        let project_path = normalize_command_cwd(
            expand_home_path(req.project_path.trim())
                .canonicalize()
                .map_err(|_| anyhow!("Project path does not exist."))?,
        );
        if !is_git_repo(&project_path) {
            bail!("Project path is not a git repository.");
        }
        let branch_name = match (req.branch_name.as_deref(), req.task_id.as_deref()) {
            (Some(branch_name), None) => branch_name.trim().to_string(),
            (None, Some(task_id)) => {
                if task_id.trim().is_empty() {
                    bail!("Task ID cannot be empty.");
                }
                let digest = format!("{:x}", Sha256::digest(task_id.as_bytes()));
                format!("wheeljack/task-{}", &digest[..20])
            }
            _ => bail!("Exactly one of branchName or taskId is required."),
        };
        ensure_safe_branch_name(&branch_name)?;
        let (repo_path, project_relative) = resolve_git_worktree_context(&project_path)?;
        let base_commit = read_git_head(&repo_path)?;
        let target_path =
            resolve_new_worktree_path(&repo_path, &branch_name, req.worktree_path.as_deref())?;
        run_git_worktree_add(&repo_path, &branch_name, &target_path, &base_commit)?;
        let status = read_git_status(&repo_path, true);
        let worktree = status
            .worktrees
            .iter()
            .find(|worktree| paths_equivalent(Path::new(&worktree.path), &target_path))
            .cloned()
            .ok_or_else(|| anyhow!("Created worktree was not registered by git."))?;
        let cwd = normalize_command_cwd(Path::new(&worktree.path).join(project_relative))
            .to_string_lossy()
            .to_string();
        Ok(serde_json::to_value(GitWorktreeCreateResult {
            worktree,
            status,
            cwd,
            base_commit,
        })?)
    }

    fn git_worktree_review(&self, payload: Value) -> Result<Value> {
        let req =
            serde_json::from_value::<GitWorktreeReviewRequest>(unwrap_payload(payload, "req"))?;
        let project_path = normalize_command_cwd(
            expand_home_path(req.project_path.trim())
                .canonicalize()
                .map_err(|_| anyhow!("Project path does not exist."))?,
        );
        if !is_git_repo(&project_path) {
            bail!("Project path is not a git repository.");
        }
        let (repo_path, _) = resolve_git_worktree_context(&project_path)?;
        let worktree_path = normalize_command_cwd(
            expand_home_path(req.worktree_path.trim())
                .canonicalize()
                .map_err(|_| anyhow!("Worktree path does not exist."))?,
        );
        let expected_branch = req.expected_branch.trim();
        ensure_safe_branch_name(expected_branch)?;
        let worktrees = read_worktrees(&repo_path);
        let worktree = worktrees
            .iter()
            .find(|worktree| paths_equivalent(Path::new(&worktree.path), &worktree_path))
            .ok_or_else(|| anyhow!("Worktree path is not registered with this repository."))?;
        if worktree.detached || worktree.bare {
            bail!("Task review requires a branch-backed worktree.");
        }
        if worktree.branch != expected_branch {
            bail!(
                "Worktree branch mismatch: expected {expected_branch}, found {}.",
                worktree.branch
            );
        }
        let base_commit = validate_full_commit(&repo_path, &req.base_commit)?;
        let head_commit = read_git_head(&worktree_path)?;
        let (snapshot_id, changed_files, text, truncated) =
            read_worktree_snapshot(&worktree_path, &base_commit)?;
        Ok(serde_json::to_value(GitWorktreeReviewResult {
            branch: worktree.branch.clone(),
            base_commit,
            head_commit,
            snapshot_id,
            changed_files,
            text,
            truncated,
        })?)
    }

    fn git_worktree_remove(&self, payload: Value) -> Result<Value> {
        let _git_guard = self
            .git_mutations
            .lock()
            .map_err(|_| anyhow!("Git operation lock is poisoned"))?;
        let req =
            serde_json::from_value::<GitWorktreeRemoveRequest>(unwrap_payload(payload, "req"))?;
        let project_path = normalize_command_cwd(
            expand_home_path(req.project_path.trim())
                .canonicalize()
                .map_err(|_| anyhow!("Project path does not exist."))?,
        );
        if !is_git_repo(&project_path) {
            bail!("Project path is not a git repository.");
        }
        let (repo_path, _) = resolve_git_worktree_context(&project_path)?;
        let requested_target = expand_home_path(req.worktree_path.trim());
        let target_path = if requested_target.exists() {
            normalize_command_cwd(requested_target.canonicalize()?)
        } else if requested_target.is_absolute() {
            normalize_command_cwd(requested_target)
        } else {
            bail!("Missing worktree paths must be absolute.");
        };
        let expected_branch = req
            .expected_branch
            .as_deref()
            .map(str::trim)
            .filter(|branch| !branch.is_empty());
        if let Some(expected_branch) = expected_branch {
            ensure_safe_branch_name(expected_branch)?;
        }
        let removed_path = if target_path.exists() {
            let worktrees = read_worktrees(&repo_path);
            removable_worktree(&repo_path, &target_path, &worktrees, expected_branch)?
                .path
                .clone()
        } else {
            removable_missing_worktree(&repo_path, &target_path, expected_branch)?
        };
        run_git_worktree_remove(&repo_path, &target_path)?;
        Ok(serde_json::to_value(GitWorktreeRemoveResult {
            removed_path,
            status: read_git_status(&repo_path, true),
        })?)
    }

    fn git_task_workspaces_cleanup(&self, payload: Value) -> Result<Value> {
        let req = serde_json::from_value::<GitTaskWorkspacesCleanupRequest>(unwrap_payload(
            payload, "req",
        ))?;
        let project_path = normalize_command_cwd(
            expand_home_path(req.project_path.trim())
                .canonicalize()
                .map_err(|_| anyhow!("Project path does not exist."))?,
        );
        if !is_git_repo(&project_path) {
            bail!("Project path is not a git repository.");
        }
        let (repo_path, _) = resolve_git_worktree_context(&project_path)?;
        let mut protected_paths = req
            .protected_paths
            .iter()
            .map(|path| normalize_command_cwd(expand_home_path(path.trim())))
            .collect::<Vec<_>>();
        {
            let db = self
                .db
                .lock()
                .map_err(|_| anyhow!("Database lock is poisoned"))?;
            let mut statement = db.prepare(
                "SELECT DISTINCT cwd FROM sessions
                 WHERE status NOT IN ('completed', 'failed', 'disconnected', 'canceled', 'exited')",
            )?;
            let live_paths = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            protected_paths.extend(
                live_paths
                    .into_iter()
                    .map(|path| normalize_command_cwd(expand_home_path(path.trim()))),
            );
        }
        let _git_guard = self
            .git_mutations
            .lock()
            .map_err(|_| anyhow!("Git operation lock is poisoned"))?;
        Ok(serde_json::to_value(cleanup_git_task_workspaces(
            &repo_path,
            &protected_paths,
        )?)?)
    }

    fn git_worktree_integrate(&self, payload: Value) -> Result<Value> {
        let _git_guard = self
            .git_mutations
            .lock()
            .map_err(|_| anyhow!("Git operation lock is poisoned"))?;
        let req =
            serde_json::from_value::<GitWorktreeIntegrateRequest>(unwrap_payload(payload, "req"))?;
        let project_path = normalize_command_cwd(
            expand_home_path(req.project_path.trim())
                .canonicalize()
                .map_err(|_| anyhow!("Project path does not exist."))?,
        );
        if !is_git_repo(&project_path) {
            bail!("Project path is not a git repository.");
        }
        let (target_path, _) = resolve_git_worktree_context(&project_path)?;
        let requested_source = expand_home_path(req.worktree_path.trim());
        let source_path = if requested_source.exists() {
            normalize_command_cwd(requested_source.canonicalize()?)
        } else if requested_source.is_absolute() {
            normalize_command_cwd(requested_source)
        } else {
            bail!("Missing task worktree paths must be absolute.");
        };
        let expected_branch = req.expected_branch.trim();
        ensure_safe_branch_name(expected_branch)?;
        Ok(serde_json::to_value(integrate_git_worktree(
            &target_path,
            &source_path,
            expected_branch,
            &req.base_commit,
        )?)?)
    }

    fn coordination_board_ensure(&self, payload: Value) -> Result<Value> {
        let request = unwrap_payload(payload, "req");
        Ok(serde_json::to_value(ensure_coordination_board(
            serde_json::from_value::<CoordinationBoardEnsureRequest>(request)?,
        )?)?)
    }

    fn coordination_board_sync(&self, payload: Value) -> Result<Value> {
        let request = unwrap_payload(payload, "req");
        Ok(serde_json::to_value(sync_coordination_board(
            serde_json::from_value::<CoordinationBoardSyncRequest>(request)?,
        )?)?)
    }

    fn coordination_board_events(&self, payload: Value) -> Result<Value> {
        let request = unwrap_payload(payload, "req");
        Ok(serde_json::to_value(read_coordination_board_events(
            serde_json::from_value::<CoordinationBoardEventsRequest>(request)?,
        )?)?)
    }

    fn coordination_checklist_plan(&self, payload: Value) -> Result<Value> {
        let request = unwrap_payload(payload, "req");
        Ok(serde_json::to_value(plan_coordination_checklists(
            serde_json::from_value::<CoordinationChecklistPlanRequest>(request)?,
        )?)?)
    }

    fn coordination_prompt_prepare(&self, payload: Value) -> Result<Value> {
        let canvas_id = required_str(&payload, "canvasId")?;
        let node_id = required_str(&payload, "nodeId")?;
        let prompt = required_str(&payload, "prompt")?;
        let workspace_path = payload
            .get("workspacePath")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let handoff = payload
            .get("handoff")
            .and_then(Value::as_str)
            .unwrap_or("Prompt delivered by wheeljack.");
        let task_id = payload.get("taskId").and_then(Value::as_str);
        let db = self.lock_db()?;
        let canvas = load_canvas(&db, canvas_id)?;
        prepare_coordination_prompt(
            &canvas.nodes,
            node_id,
            workspace_path,
            prompt,
            handoff,
            task_id,
        )
    }

    fn agent_control_authorize(&self, payload: Value) -> Result<Value> {
        let req = serde_json::from_value::<AgentControlRequestDto>(unwrap_payload(payload, "req"))?;
        let result = {
            let db = self.lock_db()?;
            authorize_agent_control(&db, req)?
        };
        self.events
            .emit("agent:control", &serde_json::to_value(&result)?);
        Ok(serde_json::to_value(result)?)
    }

    fn agent_control_result(&self, payload: Value) -> Result<Value> {
        let req =
            serde_json::from_value::<AgentControlResultRequest>(unwrap_payload(payload, "req"))?;
        {
            let db = self.lock_db()?;
            record_agent_control_result(&db, req.clone())?;
        }
        let result = json!({
            "requestId": req.request_id,
            "success": req.success,
            "message": req.message,
            "targetNodeId": req.target_node_id,
            "childNodeId": req.child_node_id,
        });
        self.events.emit("agent:control-result", &result);
        Ok(result)
    }

    fn agent_control_audit(&self, payload: Value) -> Result<Value> {
        let canvas_id = required_str(&payload, "canvasId")?;
        let limit = payload.get("limit").and_then(Value::as_u64).unwrap_or(100) as usize;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(list_agent_control_audit(
            &db, canvas_id, limit,
        )?)?)
    }

    fn prompt_input_writes(&self, payload: Value) -> Result<Value> {
        let prompt = required_str(&payload, "prompt")?;
        let adapter_id = if let (Some(canvas_id), Some(node_id)) = (
            payload.get("canvasId").and_then(Value::as_str),
            payload.get("nodeId").and_then(Value::as_str),
        ) {
            let db = self.lock_db()?;
            load_canvas_node_adapter_id(&db, canvas_id, node_id)?
        } else {
            payload
                .get("adapterId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        let strategy = {
            let db = self.lock_db()?;
            effective_prompt_injection_for_adapter(&db, &adapter_id)?
        };
        Ok(prompt_input_writes_payload(prompt, &strategy))
    }

    fn session_prompt_send(&self, payload: Value) -> Result<Value> {
        let session_id = required_str(&payload, "sessionId")?;
        let image_paths = serde_json::from_value::<Vec<String>>(
            payload
                .get("imagePaths")
                .cloned()
                .unwrap_or_else(|| json!([])),
        )
        .context("payload.imagePaths must be an array of paths")?;
        let raw_prompt = payload
            .get("prompt")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let history_text = payload
            .get("historyText")
            .and_then(Value::as_str)
            .unwrap_or(raw_prompt);
        if raw_prompt.trim().is_empty() && image_paths.is_empty() {
            bail!("prompt text or an image is required");
        }
        let coordinated_prompt = self.coordinated_session_prompt(&payload, raw_prompt)?;
        let prompt = if payload.get("canvasId").and_then(Value::as_str).is_some()
            && payload.get("nodeId").and_then(Value::as_str).is_some()
        {
            let db = self.lock_db()?;
            append_agent_control_instructions(
                &coordinated_prompt,
                &load_agent_autonomy_policy(&db)?,
                payload.get("taskId").and_then(Value::as_str),
            )
        } else {
            coordinated_prompt
        };
        let structured_protocol = self
            .lock_structured_sessions()?
            .get(session_id)
            .map(|session| session.protocol.clone());
        if let Some(protocol) = structured_protocol {
            self.agent_structured_prompt(json!({
                "sessionId": session_id,
                "prompt": prompt,
                "historyText": history_text,
                "imagePaths": image_paths,
                "provider": payload.get("provider"),
                "model": payload.get("model"),
                "thinking": payload.get("thinking"),
                "approvalPolicy": payload.get("approvalPolicy"),
                "sandbox": payload.get("sandbox")
            }))?;
            return Ok(json!({
                "transport": "structured",
                "strategy": protocol
            }));
        }

        if !image_paths.is_empty() {
            bail!("PTY sessions do not support image input");
        }

        let adapter_id = if let Some(adapter_id) = payload
            .get("adapterId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
        {
            adapter_id.to_string()
        } else if let Some(node_id) = payload
            .get("nodeId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
        {
            let db = self.lock_db()?;
            let data_json: String = db.query_row(
                "SELECT data_json FROM nodes WHERE id = ?1",
                params![node_id],
                |row| row.get(0),
            )?;
            serde_json::from_str::<Value>(&data_json)?
                .get("adapterId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| anyhow!("node has no adapterId: {node_id}"))?
                .to_string()
        } else {
            bail!("payload.nodeId or payload.adapterId is required for PTY prompt delivery");
        };
        let terminal_text = payload
            .get("terminalText")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if let Some(reason) = pty_input_blocked_reason(&adapter_id, terminal_text) {
            bail!(reason);
        }

        let strategy = {
            let db = self.lock_db()?;
            effective_prompt_injection_for_adapter(&db, &adapter_id)?
        };
        let plan = prompt_input_writes_payload(&prompt, &strategy);
        let writes = plan
            .get("writes")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let writer = self
            .lock_pty_sessions()?
            .get(session_id)
            .map(|session| session.writer.clone())
            .ok_or_else(|| anyhow!("unknown session: {session_id}"))?;
        let mut writer = writer.lock().map_err(|error| anyhow!(error.to_string()))?;
        for write in writes {
            let delay_ms = write
                .get("delayBeforeMs")
                .and_then(Value::as_u64)
                .unwrap_or_default();
            if delay_ms > 0 {
                thread::sleep(Duration::from_millis(delay_ms));
            }
            writer.write_all(&payload_bytes(&write)?)?;
            writer.flush()?;
        }
        Ok(json!({
            "transport": "pty",
            "strategy": strategy
        }))
    }

    fn session_prompt_submit(&self, payload: Value) -> Result<Value> {
        let session_id = required_str(&payload, "sessionId")?.to_string();
        let client_prompt_id = required_str(&payload, "clientPromptId")?.to_string();
        let mode = payload
            .get("mode")
            .and_then(Value::as_str)
            .unwrap_or("auto")
            .to_string();
        let image_paths = serde_json::from_value::<Vec<String>>(
            payload
                .get("imagePaths")
                .cloned()
                .unwrap_or_else(|| json!([])),
        )
        .context("payload.imagePaths must be an array of paths")?;
        let raw_prompt = payload
            .get("prompt")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let history_text = payload
            .get("historyText")
            .and_then(Value::as_str)
            .unwrap_or(raw_prompt);
        if raw_prompt.trim().is_empty() && image_paths.is_empty() {
            bail!("prompt text or an image is required");
        }
        let session = self
            .lock_structured_sessions()?
            .get(&session_id)
            .cloned()
            .ok_or_else(|| anyhow!("unknown structured agent session: {session_id}"))?;
        if mode == "steer" && !session.capabilities.steer {
            bail!("this agent protocol does not support steering an active turn");
        }

        let coordinated_prompt = self.coordinated_session_prompt(&payload, raw_prompt)?;
        let effective_prompt = if payload.get("canvasId").and_then(Value::as_str).is_some()
            && payload.get("nodeId").and_then(Value::as_str).is_some()
        {
            let db = self.lock_db()?;
            append_agent_control_instructions(
                &coordinated_prompt,
                &load_agent_autonomy_policy(&db)?,
                payload.get("taskId").and_then(Value::as_str),
            )
        } else {
            coordinated_prompt
        };
        let req = SubmitPromptDeliveryRequest {
            client_prompt_id,
            session_id: session_id.clone(),
            mode,
            payload: PromptDeliveryPayload {
                prompt: effective_prompt,
                history_text: history_text.to_string(),
                standing_role_applied: payload
                    .get("standingRoleApplied")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                image_paths,
                provider: optional_agent_profile_value(&payload, "provider", 64)?,
                model: optional_agent_profile_value(&payload, "model", 128)?,
                thinking: optional_agent_profile_value(&payload, "thinking", 32)?,
                approval_policy: if session.intent == "ask" {
                    session.approval_policy.clone()
                } else {
                    payload
                        .get("approvalPolicy")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                },
                sandbox: if session.intent == "ask" {
                    session.sandbox.clone()
                } else {
                    payload
                        .get("sandbox")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                },
            },
        };
        let delivery = {
            let db = self.lock_db()?;
            submit_prompt_delivery(&db, &req)?
        };
        self.events.emit("agent:prompt-delivery", &json!(delivery));
        self.ensure_prompt_drainer(&session_id)?;
        Ok(serde_json::to_value(delivery)?)
    }

    fn session_prompt_list(&self, payload: Value) -> Result<Value> {
        let session_id = required_str(&payload, "sessionId")?;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(list_prompt_deliveries(
            &db, session_id,
        )?)?)
    }

    fn session_prompt_retry(&self, payload: Value) -> Result<Value> {
        let delivery_id = required_str(&payload, "deliveryId")?;
        let delivery = {
            let db = self.lock_db()?;
            retry_prompt_delivery(&db, delivery_id)?
        };
        self.events.emit("agent:prompt-delivery", &json!(delivery));
        self.ensure_prompt_drainer(&delivery.session_id)?;
        Ok(serde_json::to_value(delivery)?)
    }

    fn session_prompt_edit(&self, payload: Value) -> Result<Value> {
        let delivery_id = required_str(&payload, "deliveryId")?;
        let prompt_payload = if let Some(value) = payload.get("payload") {
            serde_json::from_value::<PromptDeliveryPayload>(value.clone())?
        } else {
            let session_id = required_str(&payload, "sessionId")?.to_string();
            let existing = {
                let db = self.lock_db()?;
                load_prompt_delivery(&db, delivery_id)?
                    .ok_or_else(|| anyhow!("prompt delivery is missing"))?
            };
            if existing.session_id != session_id {
                bail!("prompt delivery belongs to a different session");
            }
            let image_paths = serde_json::from_value::<Vec<String>>(
                payload
                    .get("imagePaths")
                    .cloned()
                    .unwrap_or_else(|| json!([])),
            )
            .context("payload.imagePaths must be an array of paths")?;
            let raw_prompt = payload
                .get("prompt")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let history_text = payload
                .get("historyText")
                .and_then(Value::as_str)
                .unwrap_or(raw_prompt);
            if raw_prompt.trim().is_empty() && image_paths.is_empty() {
                bail!("prompt text or an image is required");
            }
            let session = self
                .lock_structured_sessions()?
                .get(&session_id)
                .cloned()
                .ok_or_else(|| anyhow!("unknown structured agent session: {session_id}"))?;
            let coordinated_prompt = self.coordinated_session_prompt(&payload, raw_prompt)?;
            let effective_prompt = if payload.get("canvasId").and_then(Value::as_str).is_some()
                && payload.get("nodeId").and_then(Value::as_str).is_some()
            {
                let db = self.lock_db()?;
                append_agent_control_instructions(
                    &coordinated_prompt,
                    &load_agent_autonomy_policy(&db)?,
                    payload.get("taskId").and_then(Value::as_str),
                )
            } else {
                coordinated_prompt
            };
            let prior = existing.payload.unwrap_or(PromptDeliveryPayload {
                prompt: String::new(),
                history_text: String::new(),
                standing_role_applied: false,
                image_paths: vec![],
                provider: None,
                model: None,
                thinking: None,
                approval_policy: None,
                sandbox: None,
            });
            PromptDeliveryPayload {
                prompt: effective_prompt,
                history_text: history_text.to_string(),
                standing_role_applied: payload
                    .get("standingRoleApplied")
                    .and_then(Value::as_bool)
                    .unwrap_or(prior.standing_role_applied),
                image_paths,
                provider: optional_agent_profile_value(&payload, "provider", 64)?
                    .or(prior.provider),
                model: optional_agent_profile_value(&payload, "model", 128)?.or(prior.model),
                thinking: optional_agent_profile_value(&payload, "thinking", 32)?
                    .or(prior.thinking),
                approval_policy: if session.intent == "ask" {
                    session.approval_policy.clone()
                } else {
                    payload
                        .get("approvalPolicy")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or(prior.approval_policy)
                },
                sandbox: if session.intent == "ask" {
                    session.sandbox.clone()
                } else {
                    payload
                        .get("sandbox")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or(prior.sandbox)
                },
            }
        };
        let delivery = {
            let db = self.lock_db()?;
            edit_prompt_delivery(&db, delivery_id, &prompt_payload)?
        };
        self.events.emit("agent:prompt-delivery", &json!(delivery));
        self.ensure_prompt_drainer(&delivery.session_id)?;
        Ok(serde_json::to_value(delivery)?)
    }

    fn session_prompt_cancel(&self, payload: Value) -> Result<Value> {
        let delivery_id = required_str(&payload, "deliveryId")?;
        let delivery = {
            let db = self.lock_db()?;
            cancel_prompt_delivery(&db, delivery_id)?
        };
        self.events.emit("agent:prompt-delivery", &json!(delivery));
        Ok(serde_json::to_value(delivery)?)
    }

    fn project_lifecycle_inspect(&self, payload: Value) -> Result<Value> {
        let project_id = required_str(&payload, "projectId")?;
        let project_path = required_str(&payload, "projectPath")?;
        let db = self.lock_db()?;
        let (manifest, _) = read_lifecycle_manifest(&db, project_id, project_path)?;
        Ok(serde_json::to_value(manifest)?)
    }

    fn project_lifecycle_trust(&self, payload: Value) -> Result<Value> {
        let project_id = required_str(&payload, "projectId")?;
        let project_path = required_str(&payload, "projectPath")?;
        let expected_hash = required_str(&payload, "hash")?;
        let db = self.lock_db()?;
        let (manifest, _) = read_lifecycle_manifest(&db, project_id, project_path)?;
        trust_lifecycle_manifest(&db, project_id, expected_hash, &manifest)?;
        Ok(json!({ "trusted": true, "hash": expected_hash }))
    }

    fn project_lifecycle_start(&self, payload: Value) -> Result<Value> {
        let _start_guard = self
            .lifecycle_start_lock
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?;
        let project_id = required_str(&payload, "projectId")?.to_string();
        let project_path = required_str(&payload, "projectPath")?.to_string();
        let kind = required_str(&payload, "kind")?.to_string();
        if !matches!(kind.as_str(), "setup" | "preview") {
            bail!("lifecycle kind must be setup or preview");
        }
        if let Some(active) = {
            let db = self.lock_db()?;
            load_active_lifecycle_runs(&db, &project_id)?
                .into_iter()
                .find(|run| {
                    run.kind == kind
                        && matches!(
                            run.state.as_str(),
                            "starting" | "running" | "ready" | "stopping"
                        )
                })
        } {
            return Ok(serde_json::to_value(active)?);
        }
        let (manifest_dto, manifest) = {
            let db = self.lock_db()?;
            read_lifecycle_manifest(&db, &project_id, &project_path)?
        };
        if !manifest_dto.trusted {
            bail!("review and trust the current lifecycle manifest before running it");
        }
        let task = match kind.as_str() {
            "setup" => manifest.setup,
            "preview" => manifest.preview,
            _ => None,
        }
        .ok_or_else(|| anyhow!("lifecycle manifest does not define {kind}"))?;
        let mut command = lifecycle_task_command(&task, &self.platform)?;
        let needs_port = command.iter().any(|arg| arg.contains("{port}"))
            || task
                .url
                .as_deref()
                .is_some_and(|url| url.contains("{port}"));
        let port = needs_port.then(reserve_localhost_port).transpose()?;
        if let Some(port) = port {
            for arg in &mut command {
                *arg = arg.replace("{port}", &port.to_string());
            }
        }
        let url = task.url.as_ref().map(|url| {
            port.map_or_else(
                || url.clone(),
                |port| url.replace("{port}", &port.to_string()),
            )
        });
        if let Some(url) = url.as_deref() {
            validate_lifecycle_preview_url(url)?;
        }
        let root = fs::canonicalize(&project_path)?;
        let cwd = lifecycle_working_dir(&root, &task)?;
        let executable = command.remove(0);
        let mut child_command = hidden_command(&executable);
        child_command
            .args(&command)
            .current_dir(&cwd)
            .envs(&task.env)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_structured_process(&mut child_command);
        let mut child = child_command.spawn().context("start lifecycle process")?;
        let process_tree = match StructuredProcessTree::attach(&child) {
            Ok(process_tree) => process_tree,
            Err(error) => {
                kill_structured_process_before_attach(&mut child);
                return Err(error);
            }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let pid = child.id();
        let run_id = id("lifecycle");
        let timestamp = now();
        let full_command = std::iter::once(executable)
            .chain(command)
            .collect::<Vec<_>>();
        let persist_result = (|| -> Result<()> {
            let db = self.lock_db()?;
            db.execute(
                "INSERT INTO project_lifecycle_runs
                 (id, project_id, task_id, worktree_path, kind, state, command_json,
                  manifest_hash, port, url, pid, started_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
                params![
                    run_id,
                    project_id,
                    payload.get("taskId").and_then(Value::as_str),
                    cwd.to_string_lossy().to_string(),
                    kind,
                    serde_json::to_string(&full_command)?,
                    manifest_dto.hash,
                    port,
                    url,
                    pid,
                    timestamp,
                ],
            )?;
            Ok(())
        })();
        if let Err(error) = persist_result {
            let _ = kill_structured_process(&mut child, &process_tree);
            return Err(error);
        }
        let handle = LifecycleProcessHandle {
            child: Arc::new(Mutex::new(child)),
            process_tree,
        };
        self.lifecycle_processes
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?
            .insert(run_id.clone(), handle.clone());
        let seq = Arc::new(AtomicU64::new(0));
        if let Some(stdout) = stdout {
            self.register_worker(spawn_lifecycle_log_reader(
                self.paths.db_path(),
                run_id.clone(),
                "stdout",
                stdout,
                seq.clone(),
                self.events.clone(),
                self.shutdown_cancel.clone(),
            ));
        }
        if let Some(stderr) = stderr {
            self.register_worker(spawn_lifecycle_log_reader(
                self.paths.db_path(),
                run_id.clone(),
                "stderr",
                stderr,
                seq,
                self.events.clone(),
                self.shutdown_cancel.clone(),
            ));
        }
        self.register_worker(spawn_lifecycle_waiter(
            self.paths.db_path(),
            run_id.clone(),
            project_id.clone(),
            kind.clone(),
            handle,
            self.lifecycle_processes.clone(),
            task.timeout_seconds,
            self.events.clone(),
            self.shutdown_cancel.clone(),
        ));
        let run = {
            let db = self.lock_db()?;
            load_lifecycle_runs(&db, &project_id, 1)?
                .into_iter()
                .find(|run| run.id == run_id)
                .ok_or_else(|| anyhow!("lifecycle run was not persisted"))?
        };
        self.events.emit("lifecycle:state", &json!(run));
        Ok(serde_json::to_value(run)?)
    }

    fn project_lifecycle_stop(&self, payload: Value) -> Result<Value> {
        let run_id = required_str(&payload, "runId")?;
        let handle = self
            .lifecycle_processes
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?
            .get(run_id)
            .cloned()
            .ok_or_else(|| anyhow!("lifecycle process is not running"))?;
        {
            let db = self.lock_db()?;
            db.execute(
                "UPDATE project_lifecycle_runs SET state = 'stopping', updated_at = ?2
                 WHERE id = ?1 AND state IN ('starting', 'running', 'ready')",
                params![run_id, now()],
            )?;
        }
        let mut child = handle
            .child
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?;
        kill_structured_process(&mut child, &handle.process_tree)?;
        Ok(json!({ "stopping": true }))
    }

    fn project_lifecycle_runs(&self, payload: Value) -> Result<Value> {
        let project_id = required_str(&payload, "projectId")?;
        let limit = payload.get("limit").and_then(Value::as_u64).unwrap_or(20) as usize;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(load_lifecycle_runs(
            &db, project_id, limit,
        )?)?)
    }

    fn project_lifecycle_current(&self, payload: Value) -> Result<Value> {
        let project_id = required_str(&payload, "projectId")?;
        let requested_id = payload.get("runId").and_then(Value::as_str);
        let requested_kind = payload.get("kind").and_then(Value::as_str);
        let db = self.lock_db()?;
        let runs = load_active_lifecycle_runs(&db, project_id)?;
        let active = |run: &&LifecycleRunDto| {
            matches!(
                run.state.as_str(),
                "starting" | "running" | "ready" | "stopping"
            ) && requested_kind.is_none_or(|kind| run.kind == kind)
        };
        let current = requested_id
            .and_then(|id| runs.iter().find(|run| run.id == id && active(run)))
            .or_else(|| runs.iter().find(active))
            .cloned();
        Ok(serde_json::to_value(current)?)
    }

    fn project_lifecycle_logs(&self, payload: Value) -> Result<Value> {
        let run_id = required_str(&payload, "runId")?;
        let db = self.lock_db()?;
        Ok(json!({ "runId": run_id, "text": load_lifecycle_logs(&db, run_id)? }))
    }

    fn ensure_prompt_drainer(&self, session_id: &str) -> Result<()> {
        let mut drainers = self
            .prompt_drainers
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?;
        if !drainers.insert(session_id.to_string()) {
            return Ok(());
        }
        let worker = spawn_prompt_delivery_worker(
            self.paths.db_path(),
            self.paths.app_data_dir.clone(),
            session_id.to_string(),
            self.structured_agent_sessions.clone(),
            self.prompt_drainers.clone(),
            self.events.clone(),
            self.shutdown_cancel.clone(),
        );
        drop(drainers);
        self.register_worker(worker);
        Ok(())
    }

    fn coordinated_session_prompt(&self, payload: &Value, prompt: &str) -> Result<String> {
        let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) else {
            return Ok(prompt.to_string());
        };
        let Some(node_id) = payload.get("nodeId").and_then(Value::as_str) else {
            return Ok(prompt.to_string());
        };
        let workspace_path = payload
            .get("workspacePath")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let task_id = payload.get("taskId").and_then(Value::as_str);
        let prepared = {
            let db = self.lock_db()?;
            let nodes = load_nodes(&db, canvas_id)?;
            prepare_coordination_prompt(
                &nodes,
                node_id,
                workspace_path,
                prompt,
                "Prompt delivered by wheeljack.",
                task_id,
            )?
        };
        if let Some(request) = prepared
            .get("ensureRequest")
            .filter(|value| !value.is_null())
        {
            ensure_coordination_board(serde_json::from_value::<CoordinationBoardEnsureRequest>(
                request.clone(),
            )?)?;
        }
        Ok(prepared
            .get("prompt")
            .and_then(Value::as_str)
            .unwrap_or(prompt)
            .to_string())
    }

    fn pty_input_blocked_reason(&self, payload: Value) -> Result<Value> {
        let adapter_id = if let (Some(canvas_id), Some(node_id)) = (
            payload.get("canvasId").and_then(Value::as_str),
            payload.get("nodeId").and_then(Value::as_str),
        ) {
            let db = self.lock_db()?;
            load_canvas_node_adapter_id(&db, canvas_id, node_id)?
        } else {
            payload
                .get("adapterId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        let terminal_text = payload
            .get("terminalText")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let reason = pty_input_blocked_reason(&adapter_id, terminal_text);
        Ok(json!({
            "blocked": reason.is_some(),
            "reason": reason
        }))
    }

    fn canvas_get(&self, payload: Value) -> Result<Value> {
        let canvas_id = required_str(&payload, "canvasId")?;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(load_canvas(&db, canvas_id)?)?)
    }

    fn canvas_upsert_node(&self, payload: Value) -> Result<Value> {
        let canvas_id = required_str(&payload, "canvasId")?;
        let node = serde_json::from_value::<CanvasNodeDto>(
            payload
                .get("node")
                .cloned()
                .ok_or_else(|| anyhow!("canvas_upsert_node payload.node is required"))?,
        )?;
        if node.id.trim().is_empty() {
            bail!("canvas_upsert_node payload.node.id is required");
        }
        if node.canvas_id != canvas_id {
            bail!("canvas_upsert_node node.canvasId must match payload.canvasId");
        }

        let db = self.lock_db()?;
        retry_sqlite_write(|| {
            upsert_canvas_node(&db, canvas_id, &node)?;
            load_nodes(&db, canvas_id)?
                .into_iter()
                .find(|stored| stored.id == node.id)
                .map(serde_json::to_value)
                .transpose()?
                .ok_or_else(|| anyhow!("upserted node was not found"))
        })
    }

    fn canvas_layout_get(&self, payload: Value) -> Result<Value> {
        let canvas_id = required_str(&payload, "canvasId")?;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(load_canvas_layout(&db, canvas_id)?)?)
    }

    fn canvas_layout_save(&self, payload: Value) -> Result<Value> {
        let canvas_id = required_str(&payload, "canvasId")?;
        let layout = serde_json::from_value::<CanvasLayoutDocumentDto>(
            payload
                .get("layout")
                .cloned()
                .ok_or_else(|| anyhow!("canvas_layout_save payload.layout is required"))?,
        )?;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(save_canvas_layout(
            &db, canvas_id, layout,
        )?)?)
    }

    fn canvas_list_project(&self, payload: Value) -> Result<Value> {
        let db = self.lock_db()?;
        let project_id = if let Some(project_id) = payload
            .get("projectId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            project_id.to_string()
        } else {
            let canvas_id = required_str(&payload, "canvasId")?;
            load_canvas(&db, canvas_id)?.project_id
        };
        Ok(serde_json::to_value(load_project_canvases(
            &db,
            &project_id,
        )?)?)
    }

    fn canvas_apply_patch(&self, payload: Value) -> Result<Value> {
        let canvas_id = required_str(&payload, "canvasId")?;
        let patch = serde_json::from_value::<CanvasPatchDto>(
            payload
                .get("patch")
                .cloned()
                .ok_or_else(|| anyhow!("canvas_apply_patch payload.patch is required"))?,
        )?;
        let mut db = self.lock_db()?;
        ensure_canvas_exists(
            &db,
            canvas_id,
            patch.project.as_ref(),
            patch.theme_id.as_deref(),
            patch.camera.as_ref(),
        )?;

        let tx = db.transaction()?;
        if let Some(theme_id) = patch.theme_id {
            let updated_at = now();
            tx.execute(
                "UPDATE canvases SET theme_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![theme_id, updated_at, canvas_id],
            )?;
            tx.execute(
                "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)",
                params!["theme", json!(theme_id).to_string(), updated_at],
            )?;
        }
        if let Some(camera) = patch.camera {
            let existing = load_canvas_camera_store(&tx, canvas_id).ok().flatten();
            tx.execute(
                "UPDATE canvases SET camera_json = ?1, updated_at = ?2 WHERE id = ?3",
                params![
                    canvas_camera_json(
                        &camera,
                        existing.as_ref().and_then(|value| value.grid_x),
                        existing.as_ref().and_then(|value| value.grid_y),
                        existing
                            .as_ref()
                            .map(|value| value.selected_node_ids.clone())
                            .unwrap_or_default(),
                        existing
                            .as_ref()
                            .and_then(|value| value.focused_node_id.clone())
                    )?,
                    now(),
                    canvas_id
                ],
            )?;
        }
        if patch.selected_node_ids.is_some() || patch.focused_node_id.is_some() {
            let mut existing = load_canvas_camera_store(&tx, canvas_id)?.unwrap_or_default();
            if let Some(selected_node_ids) = patch.selected_node_ids {
                existing.selected_node_ids = selected_node_ids;
            }
            if let Some(focused_node_id) = patch.focused_node_id {
                existing.focused_node_id = focused_node_id.as_str().map(str::to_string);
            }
            tx.execute(
                "UPDATE canvases SET camera_json = ?1, updated_at = ?2 WHERE id = ?3",
                params![serde_json::to_string(&existing)?, now(), canvas_id],
            )?;
        }
        if let Some(nodes) = patch.nodes {
            sync_canvas_nodes(&tx, canvas_id, nodes)?;
        }
        if let Some(edges) = patch.edges {
            tx.execute("DELETE FROM edges WHERE canvas_id = ?1", params![canvas_id])?;
            for edge in edges {
                tx.execute(
                    "INSERT INTO edges (id, canvas_id, source_node_id, target_node_id, kind, data_json, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                    params![
                        edge.id,
                        canvas_id,
                        edge.source_node_id,
                        edge.target_node_id,
                        edge.kind,
                        json!({"label": edge.label}).to_string(),
                        now()
                    ],
                )?;
            }
        }
        tx.commit()?;
        Ok(serde_json::to_value(load_canvas(&db, canvas_id)?)?)
    }

    fn canvas_create_project(&self, payload: Value) -> Result<Value> {
        let project_id = required_str(&payload, "projectId")?;
        let requested_name = payload
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let theme_id = payload
            .get("themeId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("mono-dark");
        let camera = payload
            .get("camera")
            .cloned()
            .map(serde_json::from_value::<CameraDto>)
            .transpose()?
            .unwrap_or(CameraDto {
                x: 90.0,
                y: 76.0,
                scale: 0.86,
            });
        let db = self.lock_db()?;
        let exists: Option<String> = db
            .query_row(
                "SELECT id FROM projects WHERE id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_none() {
            bail!("project was not found");
        }

        let canvas_id = id("canvas");
        let ts = now();
        let sort_index = next_canvas_sort_index(&db, project_id)?;
        let name = requested_name
            .map(Ok)
            .unwrap_or_else(|| default_workspace_name_for_project(&db, project_id))?;
        let grid_x = payload
            .get("gridX")
            .and_then(Value::as_i64)
            .unwrap_or(sort_index);
        let grid_y = payload.get("gridY").and_then(Value::as_i64).unwrap_or(0);
        db.execute(
            "INSERT INTO canvases (id, project_id, name, theme_id, camera_json, sort_index, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                canvas_id,
                project_id,
                name,
                theme_id,
                canvas_camera_json(&camera, Some(grid_x), Some(grid_y), Vec::new(), None)?,
                sort_index,
                ts
            ],
        )?;
        Ok(serde_json::to_value(load_canvas(&db, &canvas_id)?)?)
    }

    fn canvas_reset_project(&self, payload: Value) -> Result<Value> {
        let project_id = required_str(&payload, "projectId")?;
        let mut db = self.lock_db()?;
        let exists: Option<String> = db
            .query_row(
                "SELECT id FROM projects WHERE id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_none() {
            bail!("project was not found");
        }

        let scheduler_config = load_ops_scheduler_config(&db, project_id)?;
        let canvas_ids = db
            .prepare("SELECT id FROM canvases WHERE project_id = ?1")?
            .query_map(params![project_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let ts = now();
        let canvas_id = id("canvas");
        let tx = db.transaction()?;
        for existing_canvas_id in canvas_ids {
            tx.execute(
                "DELETE FROM edges WHERE canvas_id = ?1",
                params![existing_canvas_id],
            )?;
            tx.execute(
                "DELETE FROM nodes WHERE canvas_id = ?1",
                params![existing_canvas_id],
            )?;
        }
        tx.execute(
            "DELETE FROM canvases WHERE project_id = ?1",
            params![project_id],
        )?;
        tx.execute(
            "INSERT INTO canvases (id, project_id, name, theme_id, camera_json, sort_index, created_at, updated_at)
             VALUES (?1, ?2, 'Main canvas', 'mono-dark', ?3, 0, ?4, ?4)",
            params![
                canvas_id,
                project_id,
                canvas_camera_json(
                    &CameraDto {
                        x: 90.0,
                        y: 76.0,
                        scale: 0.86,
                    },
                    Some(0),
                    Some(0),
                    Vec::new(),
                    None,
                )?,
                ts,
            ],
        )?;
        tx.commit()?;
        if let Some(config) = scheduler_config {
            configure_ops_scheduler(
                &db,
                project_id,
                &canvas_id,
                config.enabled,
                config.paused,
                config.concurrency_limit,
                config.adapter_id.as_deref(),
            )?;
        }
        Ok(serde_json::to_value(load_canvas(&db, &canvas_id)?)?)
    }

    fn canvas_delete(&self, payload: Value) -> Result<Value> {
        let canvas_id = required_str(&payload, "canvasId")?;
        let mut db = self.lock_db()?;
        let project_id: Option<String> = db
            .query_row(
                "SELECT project_id FROM canvases WHERE id = ?1",
                params![canvas_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(project_id) = project_id else {
            return Ok(json!(false));
        };
        let canvas_count: i64 = db.query_row(
            "SELECT COUNT(*) FROM canvases WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )?;
        if canvas_count <= 1 {
            bail!("keep at least one canvas");
        }
        let scheduler_config = load_ops_scheduler_config(&db, &project_id)?;
        let replacement_canvas_id = if scheduler_config
            .as_ref()
            .is_some_and(|config| config.canvas_id == canvas_id)
        {
            db.query_row(
                "SELECT id FROM canvases
                 WHERE project_id = ?1 AND id <> ?2
                 ORDER BY sort_index, created_at LIMIT 1",
                params![project_id, canvas_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        } else {
            None
        };
        let tx = db.transaction()?;
        if let (Some(config), Some(replacement_canvas_id)) =
            (scheduler_config.as_ref(), replacement_canvas_id.as_deref())
        {
            configure_ops_scheduler(
                &tx,
                &project_id,
                replacement_canvas_id,
                config.enabled,
                config.paused,
                config.concurrency_limit,
                config.adapter_id.as_deref(),
            )?;
        }
        tx.execute("DELETE FROM edges WHERE canvas_id = ?1", params![canvas_id])?;
        tx.execute("DELETE FROM nodes WHERE canvas_id = ?1", params![canvas_id])?;
        let deleted = tx.execute("DELETE FROM canvases WHERE id = ?1", params![canvas_id])?;
        tx.commit()?;
        Ok(json!(deleted > 0))
    }

    fn canvas_rename(&self, payload: Value) -> Result<Value> {
        let canvas_id = required_str(&payload, "canvasId")?;
        let name = required_str(&payload, "name")?.trim();
        if name.is_empty() {
            bail!("payload.name is required");
        }
        let db = self.lock_db()?;
        let updated = db.execute(
            "UPDATE canvases SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now(), canvas_id],
        )?;
        if updated == 0 {
            bail!("canvas was not found");
        }
        Ok(serde_json::to_value(load_canvas(&db, canvas_id)?)?)
    }

    fn canvas_set_theme(&self, payload: Value) -> Result<Value> {
        let canvas_id = required_str(&payload, "canvasId")?;
        let theme_id = required_str(&payload, "themeId")?;
        let db = self.lock_db()?;
        let updated_at = now();
        db.execute(
            "UPDATE canvases SET theme_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![theme_id, updated_at, canvas_id],
        )?;
        db.execute(
            "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)",
            params!["theme", json!(theme_id).to_string(), updated_at],
        )?;
        Ok(Value::Null)
    }

    fn canvas_reorder_project(&self, payload: Value) -> Result<Value> {
        let canvas_id = required_str(&payload, "canvasId")?;
        let direction = payload
            .get("direction")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .signum();
        if direction == 0 {
            bail!("payload.direction must be -1 or 1");
        }

        let mut db = self.lock_db()?;
        let active_canvas = load_canvas(&db, canvas_id)?;
        let current = load_project_canvas_order(&db, &active_canvas.project_id)?;
        let Some(index) = current.iter().position(|item| item.id == canvas_id) else {
            bail!("canvas was not found in its project");
        };
        let active_grid_x = current[index].grid_x;
        let target_grid_x = active_grid_x + direction;
        let swapped = current
            .iter()
            .find(|item| item.id != canvas_id && item.grid_x == target_grid_x)
            .cloned();
        let ts = now();
        let tx = db.transaction()?;
        update_canvas_grid(&tx, canvas_id, target_grid_x, 0, &ts)?;
        if let Some(swapped) = &swapped {
            update_canvas_grid(&tx, &swapped.id, active_grid_x, 0, &ts)?;
        }
        let mut order = current;
        for item in &mut order {
            if item.id == canvas_id {
                item.grid_x = target_grid_x;
                item.grid_y = 0;
            } else if swapped
                .as_ref()
                .is_some_and(|swapped| swapped.id == item.id)
            {
                item.grid_x = active_grid_x;
                item.grid_y = 0;
            }
        }
        order.sort_by_key(|item| (item.grid_x, item.grid_y, item.sort_index, item.id.clone()));
        for (sort_index, item) in order.iter().enumerate() {
            tx.execute(
                "UPDATE canvases SET sort_index = ?1, updated_at = ?2 WHERE id = ?3",
                params![sort_index as i64, ts, item.id],
            )?;
        }
        tx.commit()?;

        Ok(json!({
            "moved": true,
            "canvasId": canvas_id,
            "gridX": target_grid_x,
            "gridY": 0,
            "swappedCanvasId": swapped.map(|item| item.id),
            "canvases": load_project_canvases(&db, &active_canvas.project_id)?
        }))
    }

    fn canvas_arrange_grid(&self, payload: Value) -> Result<Value> {
        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let mut db = self.lock_db()?;
            let mut canvas = load_canvas(&db, canvas_id)?;
            arrange_nodes_in_grid(&mut canvas.nodes);
            let tx = db.transaction()?;
            sync_canvas_nodes(&tx, canvas_id, canvas.nodes.clone())?;
            tx.commit()?;
            return Ok(json!({ "nodes": canvas.nodes }));
        }

        let nodes = payload
            .get("nodes")
            .cloned()
            .ok_or_else(|| anyhow!("payload.canvasId or payload.nodes is required"))?;
        let mut nodes = serde_json::from_value::<Vec<CanvasNodeDto>>(nodes)?;
        arrange_nodes_in_grid(&mut nodes);
        Ok(json!({ "nodes": nodes }))
    }

    fn canvas_delete_node(&self, payload: Value) -> Result<Value> {
        let node_id = required_str(&payload, "nodeId")?;
        let selected_node_ids = payload_string_array(&payload, "selectedNodeIds");
        let focused_node_id = payload
            .get("focusedNodeId")
            .and_then(Value::as_str)
            .map(str::to_string);

        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let mut db = self.lock_db()?;
            let canvas = load_canvas(&db, canvas_id)?;
            let mut nodes = canvas.nodes;
            let mut edges = canvas.edges;
            let result = delete_node_by_id(
                &mut nodes,
                &mut edges,
                &selected_node_ids,
                focused_node_id,
                node_id,
            );
            if result.removed_node.is_some() {
                let tx = db.transaction()?;
                sync_canvas_nodes(&tx, canvas_id, nodes.clone())?;
                replace_canvas_edges(&tx, canvas_id, &edges)?;
                update_canvas_focus_selection(
                    &tx,
                    canvas_id,
                    result.selected_node_ids.clone(),
                    result.focused_node_id.clone(),
                    &now(),
                )?;
                tx.commit()?;
            }
            return Ok(json!({
                "removedNode": result.removed_node,
                "nodes": nodes,
                "edges": edges,
                "selectedNodeIds": result.selected_node_ids,
                "focusedNodeId": result.focused_node_id,
            }));
        }

        let nodes = payload
            .get("nodes")
            .cloned()
            .ok_or_else(|| anyhow!("payload.canvasId or payload.nodes is required"))?;
        let edges = payload.get("edges").cloned().unwrap_or_else(|| json!([]));
        let mut nodes = serde_json::from_value::<Vec<CanvasNodeDto>>(nodes)?;
        let mut edges = serde_json::from_value::<Vec<CanvasEdgeDto>>(edges)?;
        let result = delete_node_by_id(
            &mut nodes,
            &mut edges,
            &selected_node_ids,
            focused_node_id,
            node_id,
        );
        Ok(json!({
            "removedNode": result.removed_node,
            "nodes": nodes,
            "edges": edges,
            "selectedNodeIds": result.selected_node_ids,
            "focusedNodeId": result.focused_node_id,
        }))
    }

    fn canvas_delete_selected(&self, payload: Value) -> Result<Value> {
        let mut selected_node_ids = payload_string_array(&payload, "selectedNodeIds");

        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let mut db = self.lock_db()?;
            let canvas = load_canvas(&db, canvas_id)?;
            if selected_node_ids.is_empty() {
                selected_node_ids = canvas.selected_node_ids.clone();
            }
            let result = delete_selected_nodes(
                canvas.nodes,
                canvas.edges,
                &selected_node_ids,
                canvas.focused_node_id,
            );
            if result.deleted_count > 0 {
                let tx = db.transaction()?;
                sync_canvas_nodes(&tx, canvas_id, result.nodes.clone())?;
                replace_canvas_edges(&tx, canvas_id, &result.edges)?;
                update_canvas_focus_selection(&tx, canvas_id, Vec::new(), None, &now())?;
                tx.commit()?;
            }
            return Ok(serde_json::to_value(result)?);
        }

        let nodes = payload
            .get("nodes")
            .cloned()
            .ok_or_else(|| anyhow!("payload.canvasId or payload.nodes is required"))?;
        let edges = payload.get("edges").cloned().unwrap_or_else(|| json!([]));
        let nodes = serde_json::from_value::<Vec<CanvasNodeDto>>(nodes)?;
        let edges = serde_json::from_value::<Vec<CanvasEdgeDto>>(edges)?;
        let focused_node_id = payload
            .get("focusedNodeId")
            .and_then(Value::as_str)
            .map(str::to_string);
        Ok(serde_json::to_value(delete_selected_nodes(
            nodes,
            edges,
            &selected_node_ids,
            focused_node_id,
        ))?)
    }

    fn canvas_select_node(&self, payload: Value) -> Result<Value> {
        let node_id = payload
            .get("nodeId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let additive = payload
            .get("additive")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let mut selected_node_ids = payload_string_array(&payload, "selectedNodeIds");
        let mut focused_node_id = payload
            .get("focusedNodeId")
            .and_then(Value::as_str)
            .map(str::to_string);

        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let db = self.lock_db()?;
            let canvas = load_canvas(&db, canvas_id)?;
            selected_node_ids = canvas.selected_node_ids;
            focused_node_id = canvas.focused_node_id;
        }

        let change = select_node_in_selection(
            &selected_node_ids,
            focused_node_id.as_deref(),
            node_id,
            additive,
        );
        let Some(change) = change else {
            return Ok(json!({
                "changed": false,
                "selectedNodeIds": selected_node_ids,
                "focusedNodeId": focused_node_id,
            }));
        };

        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let mut db = self.lock_db()?;
            let tx = db.transaction()?;
            update_canvas_focus_selection(
                &tx,
                canvas_id,
                change.selected_node_ids.clone(),
                change.focused_node_id.clone(),
                &now(),
            )?;
            tx.commit()?;
        }

        Ok(json!({
            "changed": true,
            "selectedNodeIds": change.selected_node_ids,
            "focusedNodeId": change.focused_node_id,
        }))
    }

    fn canvas_swap_nodes(&self, payload: Value) -> Result<Value> {
        let source_node_id = required_str(&payload, "sourceNodeId")?;
        let target_node_id = required_str(&payload, "targetNodeId")?;
        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let mut db = self.lock_db()?;
            let mut canvas = load_canvas(&db, canvas_id)?;
            let swapped = swap_nodes_by_order(&mut canvas.nodes, source_node_id, target_node_id);
            if swapped {
                let tx = db.transaction()?;
                sync_canvas_nodes(&tx, canvas_id, canvas.nodes.clone())?;
                tx.commit()?;
            }
            return Ok(json!({ "nodes": canvas.nodes, "swapped": swapped }));
        }

        let nodes = payload
            .get("nodes")
            .cloned()
            .ok_or_else(|| anyhow!("payload.canvasId or payload.nodes is required"))?;
        let mut nodes = serde_json::from_value::<Vec<CanvasNodeDto>>(nodes)?;
        let swapped = swap_nodes_by_order(&mut nodes, source_node_id, target_node_id);
        Ok(json!({ "nodes": nodes, "swapped": swapped }))
    }

    fn canvas_duplicate_node(&self, payload: Value) -> Result<Value> {
        let node_id = required_str(&payload, "nodeId")?;
        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let mut db = self.lock_db()?;
            let mut canvas = load_canvas(&db, canvas_id)?;
            let used_agent_titles = load_project_canvases(&db, &canvas.project_id)?
                .iter()
                .flat_map(|project_canvas| agent_callsign_titles_for_nodes(&project_canvas.nodes))
                .collect::<Vec<_>>();
            let duplicate = duplicate_node_in_nodes(&mut canvas.nodes, node_id, &used_agent_titles);
            if duplicate.is_some() {
                let tx = db.transaction()?;
                sync_canvas_nodes(&tx, canvas_id, canvas.nodes.clone())?;
                let focused_node_id = duplicate.as_ref().map(|node| node.id.clone());
                let selected_node_ids = duplicate
                    .as_ref()
                    .map(|node| vec![node.id.clone()])
                    .unwrap_or_default();
                update_canvas_focus_selection(
                    &tx,
                    canvas_id,
                    selected_node_ids,
                    focused_node_id,
                    &now(),
                )?;
                tx.commit()?;
            }
            let focused_node_id = duplicate.as_ref().map(|node| node.id.clone());
            let selected_node_ids = duplicate
                .as_ref()
                .map(|node| vec![node.id.clone()])
                .unwrap_or_default();
            return Ok(json!({
                "nodes": canvas.nodes,
                "duplicate": duplicate,
                "focusedNodeId": focused_node_id,
                "selectedNodeIds": selected_node_ids,
            }));
        }

        let nodes = payload
            .get("nodes")
            .cloned()
            .ok_or_else(|| anyhow!("payload.canvasId or payload.nodes is required"))?;
        let mut nodes = serde_json::from_value::<Vec<CanvasNodeDto>>(nodes)?;
        let used_agent_titles = agent_callsign_titles_for_nodes(&nodes);
        let duplicate = duplicate_node_in_nodes(&mut nodes, node_id, &used_agent_titles);
        let focused_node_id = duplicate.as_ref().map(|node| node.id.clone());
        let selected_node_ids = duplicate
            .as_ref()
            .map(|node| vec![node.id.clone()])
            .unwrap_or_default();
        Ok(json!({
            "nodes": nodes,
            "duplicate": duplicate,
            "focusedNodeId": focused_node_id,
            "selectedNodeIds": selected_node_ids,
        }))
    }

    fn callsign_panel_input_resolve(&self, payload: Value) -> Result<Value> {
        let transcript = required_str(&payload, "transcript")?;
        if payload.get("nodes").is_some() {
            let canvas_id = payload
                .get("canvasId")
                .and_then(Value::as_str)
                .unwrap_or("canvas_main");
            let nodes = payload
                .get("nodes")
                .cloned()
                .ok_or_else(|| anyhow!("payload.nodes is required"))?;
            let nodes = serde_json::from_value::<Vec<CanvasNodeDto>>(nodes)?;
            let workspaces = payload
                .get("workspaces")
                .cloned()
                .unwrap_or_else(|| json!([]));
            let workspaces = serde_json::from_value::<Vec<CanvasDto>>(workspaces)?;
            return Ok(json!(resolve_callsign_panel_input_target(
                transcript,
                canvas_id,
                &nodes,
                &workspaces
            )));
        }

        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let db = self.lock_db()?;
            let active_canvas = load_canvas(&db, canvas_id)?;
            let canvases = load_project_canvases(&db, &active_canvas.project_id)?;
            return Ok(json!(resolve_callsign_panel_input_target(
                transcript,
                canvas_id,
                &active_canvas.nodes,
                &canvases
            )));
        }

        bail!("payload.canvasId or payload.nodes is required")
    }

    fn callsign_panel_input_route(&self, payload: Value) -> Result<Value> {
        let transcript = required_str(&payload, "transcript")?;
        if payload.get("nodes").is_some() {
            let canvas_id = payload
                .get("canvasId")
                .and_then(Value::as_str)
                .unwrap_or("canvas_main");
            let nodes = payload
                .get("nodes")
                .cloned()
                .ok_or_else(|| anyhow!("payload.nodes is required"))?;
            let mut nodes = serde_json::from_value::<Vec<CanvasNodeDto>>(nodes)?;
            let workspaces = payload
                .get("workspaces")
                .cloned()
                .unwrap_or_else(|| json!([]));
            let mut workspaces = serde_json::from_value::<Vec<CanvasDto>>(workspaces)?;
            let Some(target) =
                resolve_callsign_panel_input_target(transcript, canvas_id, &nodes, &workspaces)
            else {
                return Ok(Value::Null);
            };
            let pending_prompt_id = id("pending_prompt");
            let routed_node = if target.is_active_workspace {
                queue_panel_input_on_nodes(
                    &mut nodes,
                    &target.node_id,
                    &target.input,
                    &pending_prompt_id,
                )
            } else {
                workspaces
                    .iter_mut()
                    .find(|workspace| workspace.id == target.workspace_id)
                    .and_then(|workspace| {
                        queue_panel_input_on_nodes(
                            &mut workspace.nodes,
                            &target.node_id,
                            &target.input,
                            &pending_prompt_id,
                        )
                    })
            };
            return Ok(callsign_panel_input_route_payload(
                target,
                pending_prompt_id,
                routed_node,
                Some(nodes),
                Some(workspaces),
            ));
        }

        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let mut db = self.lock_db()?;
            let active_canvas = load_canvas(&db, canvas_id)?;
            let canvases = load_project_canvases(&db, &active_canvas.project_id)?;
            let Some(target) = resolve_callsign_panel_input_target(
                transcript,
                canvas_id,
                &active_canvas.nodes,
                &canvases,
            ) else {
                return Ok(Value::Null);
            };
            let pending_prompt_id = id("pending_prompt");
            let mut target_canvas = if target.workspace_id == active_canvas.id {
                active_canvas
            } else {
                canvases
                    .into_iter()
                    .find(|workspace| workspace.id == target.workspace_id)
                    .ok_or_else(|| anyhow!("target callsign workspace was not found"))?
            };
            let routed_node = queue_panel_input_on_nodes(
                &mut target_canvas.nodes,
                &target.node_id,
                &target.input,
                &pending_prompt_id,
            );
            if routed_node.is_some() {
                let tx = db.transaction()?;
                sync_canvas_nodes(&tx, &target_canvas.id, target_canvas.nodes.clone())?;
                tx.execute(
                    "UPDATE canvases SET updated_at = ?1 WHERE id = ?2",
                    params![now(), target_canvas.id],
                )?;
                tx.commit()?;
            }
            return Ok(callsign_panel_input_route_payload(
                target,
                pending_prompt_id,
                routed_node,
                Some(target_canvas.nodes),
                None,
            ));
        }

        bail!("payload.canvasId or payload.nodes is required")
    }

    fn retire_structured_node_sessions_for_resume(&self, node_id: &str) -> Result<()> {
        let live_session_ids = self
            .lock_structured_sessions()?
            .keys()
            .cloned()
            .collect::<HashSet<_>>();
        if live_session_ids.is_empty() {
            return Ok(());
        }
        let node_session_ids = {
            let db = self.lock_db()?;
            let mut statement = db.prepare("SELECT id FROM sessions WHERE node_id = ?1")?;
            let session_ids = statement
                .query_map(params![node_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            session_ids
        };
        for session_id in node_session_ids
            .into_iter()
            .filter(|session_id| live_session_ids.contains(session_id))
        {
            self.agent_structured_kill(json!({
                "sessionId": session_id,
                "terminationReason": "canceled",
            }))?;
        }
        Ok(())
    }

    fn agent_structured_spawn(&self, payload: Value) -> Result<Value> {
        let req =
            serde_json::from_value::<StructuredAgentSpawnRequest>(unwrap_payload(payload, "req"))?;
        validate_session_intent(&req)?;
        validate_agent_profile_values(
            req.provider.as_deref(),
            req.model.as_deref(),
            req.thinking.as_deref(),
        )?;
        let requested_launch_command = req
            .launch_command
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let requested_prompt_delivery = req
            .prompt_delivery
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let requested_protocol = req
            .protocol
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let profile = if requested_launch_command.is_none()
            || requested_prompt_delivery.is_none()
            || requested_protocol.is_none()
        {
            let db = self.lock_db()?;
            Some(resolve_structured_adapter_launch(&db, &req.adapter_id)?)
        } else {
            None
        };
        let structured_launch_command = requested_launch_command
            .map(str::to_string)
            .or_else(|| profile.as_ref().map(|value| value.launch_command.clone()))
            .ok_or_else(|| anyhow!("structured launch command is required"))?;
        let prompt_delivery = requested_prompt_delivery
            .map(str::to_string)
            .or_else(|| profile.as_ref().map(|value| value.prompt_delivery.clone()))
            .unwrap_or_default()
            .to_ascii_lowercase();
        let protocol = match requested_protocol {
            Some(value) => StructuredProtocol::parse(value)?,
            None => profile
                .as_ref()
                .map(|value| value.protocol)
                .ok_or_else(|| anyhow!("structured protocol is required"))?,
        };
        if prompt_delivery != protocol.prompt_delivery() {
            bail!(
                "structured prompt delivery is not supported by the runner: {prompt_delivery}/{}",
                protocol.as_str()
            );
        }
        let protocol_name = protocol.as_str().to_string();
        if !req.image_paths.is_empty() && !protocol.capabilities().image_input {
            bail!("{} does not support image input", protocol.as_str());
        }
        let resume_session_id = req
            .resume_session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let resume_cursor = if let Some(prior_session_id) = resume_session_id.as_deref() {
            let db = self.lock_db()?;
            Some(load_agent_resume_cursor(&db, prior_session_id, protocol)?)
        } else {
            None
        };

        let session_id = id("session");
        let effective_prompt = if req.canvas_id.is_some() {
            let db = self.lock_db()?;
            append_agent_control_instructions(
                &req.prompt,
                &load_agent_autonomy_policy(&db)?,
                req.task_id.as_deref(),
            )
        } else {
            req.prompt.clone()
        };
        let mut parts = split_launch_command(&structured_launch_command)?;
        let launch_command = parts.remove(0);
        let mut launch_args = parts;
        launch_args.extend(req.args.iter().cloned());
        if let Some(cursor) = resume_cursor.as_ref() {
            let flag = match protocol {
                StructuredProtocol::ClaudeStreamJson => Some("--resume"),
                StructuredProtocol::PiRpc => Some("--session"),
                _ => None,
            };
            if let Some(flag) = flag {
                if launch_args
                    .iter()
                    .any(|arg| arg == flag || arg.starts_with(&format!("{flag}=")))
                {
                    bail!("structured launch args already define {flag}");
                }
                launch_args.extend([flag.to_string(), cursor.value.clone()]);
            }
        }
        let http_port = if prompt_delivery == "sse" {
            Some(reserve_localhost_port()?)
        } else {
            None
        };
        let has_initial_prompt = !req.prompt.trim().is_empty() || !req.image_paths.is_empty();
        if prompt_delivery == "argv" {
            if !has_initial_prompt {
                bail!("argv structured agents require an initial prompt");
            }
            launch_args.push(effective_prompt.clone());
        } else if prompt_delivery == "sse" {
            if protocol != StructuredProtocol::OpenCodeSse {
                bail!("unsupported structured SSE protocol: {}", protocol.as_str());
            }
            if launch_args
                .iter()
                .any(|arg| arg == "--port" || arg.starts_with("--port="))
            {
                bail!("structured SSE launch commands must not define --port; wheeljack assigns an isolated port");
            }
            if launch_args
                .iter()
                .any(|arg| arg == "--hostname" || arg.starts_with("--hostname="))
            {
                bail!("structured SSE launch commands must not define --hostname; wheeljack binds localhost");
            }
            let Some(port) = http_port else {
                bail!("structured SSE port was not reserved");
            };
            launch_args.extend([
                "--hostname".to_string(),
                "127.0.0.1".to_string(),
                "--port".to_string(),
                port.to_string(),
            ]);
        }
        let (command, args) = resolve_adapter_command(&launch_command, &launch_args);
        let cwd = resolve_optional_cwd(Some(&req.cwd))?;
        let cwd_string = cwd.to_string_lossy().to_string();
        let initial_prompt = has_initial_prompt
            .then(|| {
                structured_prompt_from_paths(
                    &effective_prompt,
                    &req.image_paths,
                    &cwd,
                    &self.paths.app_data_dir,
                )
            })
            .transpose()?;
        let mut child_command = hidden_command(command.as_str());
        child_command
            .args(&args)
            .current_dir(cwd.clone())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_structured_process(&mut child_command);
        let attach_rollback = StructuredAttachRollback::new(child_command.spawn()?);
        let process_tree = StructuredProcessTree::attach(attach_rollback.child())?;
        let child_handle = Arc::new(Mutex::new(attach_rollback.disarm()));
        let mut rollback = StructuredSpawnRollback::new(
            session_id.clone(),
            self.paths.db_path(),
            child_handle.clone(),
            process_tree.clone(),
            self.structured_agent_sessions.clone(),
        );
        let start_result = (|| -> Result<Value> {
            if resume_session_id.is_some() {
                self.retire_structured_node_sessions_for_resume(&req.node_id)?;
            }
            let (stdin, stdout, stderr) = {
                let mut child = child_handle
                    .lock()
                    .map_err(|error| anyhow!(error.to_string()))?;
                (child.stdin.take(), child.stdout.take(), child.stderr.take())
            };
            let stdin_handle = match prompt_delivery.as_str() {
                "argv" | "sse" => None,
                "stdin" if is_persistent_stdin_protocol(&protocol_name) => {
                    Some(Arc::new(Mutex::new(stdin.ok_or_else(|| {
                        anyhow!("structured process did not expose stdin")
                    })?)))
                }
                "stdin" => {
                    if !has_initial_prompt {
                        bail!("non-persistent stdin structured agents require an initial prompt");
                    }
                    let mut stdin =
                        stdin.ok_or_else(|| anyhow!("structured process did not expose stdin"))?;
                    stdin.write_all(format!("{}\n", req.prompt).as_bytes())?;
                    stdin.flush()?;
                    None
                }
                "json-rpc" => {
                    Some(Arc::new(Mutex::new(stdin.ok_or_else(|| {
                        anyhow!("structured process did not expose stdin")
                    })?)))
                }
                _ => unreachable!(),
            };

            let rpc_state = if prompt_delivery == "json-rpc"
                || prompt_delivery == "sse"
                || is_persistent_stdin_protocol(&protocol_name)
            {
                let mut state = StructuredAgentRpcState::default();
                if let Some(cursor) = resume_cursor.as_ref() {
                    match protocol {
                        StructuredProtocol::CodexAppServer => {
                            state.codex.resume_thread_id = Some(cursor.value.clone());
                        }
                        StructuredProtocol::OpenCodeSse => {
                            state.opencode.session_id = Some(cursor.value.clone());
                        }
                        _ => {}
                    }
                }
                Some(Arc::new(Mutex::new(state)))
            } else {
                None
            };
            let protocol_state = Arc::new(Mutex::new(AgentProtocolStreamState::default()));
            let seq = Arc::new(AtomicU64::new(0));
            let protocol_driver = match (stdin_handle.as_ref(), rpc_state.as_ref()) {
                (Some(stdin), Some(rpc_state)) => Some(StructuredProtocolDriver {
                    protocol: protocol_name.clone(),
                    cwd: cwd_string.clone(),
                    db_path: self.paths.db_path(),
                    session_id: session_id.clone(),
                    stdin: stdin.clone(),
                    rpc_state: rpc_state.clone(),
                    provider: req.provider.clone(),
                    model: req.model.clone(),
                    thinking: req.thinking.clone(),
                    approval_policy: req.approval_policy.clone(),
                    sandbox: req.sandbox.clone(),
                }),
                _ => None,
            };
            let termination_reason = Arc::new(Mutex::new(None));
            let process = StructuredAgentProcessHandle {
                child: child_handle.clone(),
                process_tree: process_tree.clone(),
                termination_reason,
            };
            {
                let mut sessions = self.lock_structured_sessions()?;
                sessions.insert(
                    session_id.clone(),
                    StructuredAgentSessionHandle {
                        process: process.clone(),
                        stdin: stdin_handle.clone(),
                        protocol: protocol_name.clone(),
                        cwd: cwd_string.clone(),
                        intent: req.intent.clone(),
                        http_port,
                        rpc_state: rpc_state.clone(),
                        provider: req.provider.clone(),
                        model: req.model.clone(),
                        thinking: req.thinking.clone(),
                        approval_policy: req.approval_policy.clone(),
                        sandbox: req.sandbox.clone(),
                        capabilities: protocol.capabilities(),
                        seq: seq.clone(),
                    },
                );
            }

            let ts = now();
            {
                let db = self.lock_db()?;
                let tx = db.unchecked_transaction()?;
                tx.execute(
                "INSERT INTO sessions (id, node_id, node_title, adapter_id, command_json, cwd, status, intent, started_at, created_at, updated_at)
                 VALUES (?1, ?2, COALESCE(NULLIF(?7, ''), (SELECT title FROM nodes WHERE id = ?2), ''), ?3, ?4, ?5, 'running', ?8, ?6, ?6, ?6)",
                params![
                    session_id,
                    req.node_id,
                    req.adapter_id,
                    json!({
                        "command": structured_launch_command,
                        "args": req.args,
                        "resolvedCommand": command,
                        "resolvedArgs": args,
                        "provider": req.provider.clone(),
                        "model": req.model.clone(),
                        "thinking": req.thinking.clone(),
                        "approvalPolicy": req.approval_policy.clone(),
                        "sandbox": req.sandbox.clone(),
                        "promptDelivery": prompt_delivery,
                        "protocol": protocol_name,
                        "driver": protocol.driver_id(),
                        "runtimeInstanceId": session_id,
                        "resumedFromSessionId": req.resume_session_id,
                        "resumeCursor": resume_cursor,
                        "canvasId": req.canvas_id,
                        "taskId": req.task_id,
                        "parentSessionId": req.parent_session_id,
                        "autonomyDepth": req.autonomy_depth,
                        "intent": req.intent,
                        "source": "structured_agent"
                    })
                    .to_string(),
                    cwd_string,
                    ts,
                    req.node_title.as_deref().unwrap_or_default(),
                    req.intent,
                ],
            )?;
                append_session_event(
                    &tx,
                    &session_id,
                    "lifecycle",
                    "running",
                    "Agent session started.",
                    &json!({ "adapterId": req.adapter_id }),
                )?;
                tx.commit()?;
            }

            if let Some(prompt) = initial_prompt.as_ref() {
                let history_line = structured_user_history_line(prompt, &req.prompt)?;
                let history_seq = seq.fetch_add(1, Ordering::SeqCst) + 1;
                let db = self.lock_db()?;
                persist_session_stream_chunk(
                    &db,
                    &session_id,
                    history_seq,
                    "agent-input",
                    &history_line,
                )?;
            }

            let reader_cancellation = StructuredReaderCancellation {
                shutdown: self.shutdown_cancel.clone(),
                rollback: rollback.reader_cancel(),
            };
            if let Some(stdout) = stdout {
                rollback.own_reader(spawn_structured_line_reader(
                    self.paths.db_path(),
                    session_id.clone(),
                    req.node_id.clone(),
                    req.adapter_id.clone(),
                    "stdout".to_string(),
                    stdout,
                    seq.clone(),
                    self.events.clone(),
                    protocol_name.clone(),
                    protocol_state.clone(),
                    protocol_driver.clone(),
                    reader_cancellation.clone(),
                ));
            }
            if let Some(stderr) = stderr {
                rollback.own_reader(spawn_structured_line_reader(
                    self.paths.db_path(),
                    session_id.clone(),
                    req.node_id.clone(),
                    req.adapter_id.clone(),
                    "stderr".to_string(),
                    stderr,
                    seq.clone(),
                    self.events.clone(),
                    protocol_name.clone(),
                    protocol_state.clone(),
                    None,
                    reader_cancellation.clone(),
                ));
            }
            if protocol == StructuredProtocol::PiRpc {
                if let Some(driver) = protocol_driver.as_ref() {
                    request_pi_session_state(driver)?;
                    request_pi_usage_snapshot(driver)?;
                }
            }
            if let (Some(driver), Some(prompt)) =
                (protocol_driver.as_ref(), initial_prompt.as_ref())
            {
                if let Err(error) = structured_rpc_send_prompt(driver, prompt) {
                    bail!(error);
                }
            }
            if let (Some(port), Some(rpc_state)) = (http_port, rpc_state.as_ref()) {
                let driver = StructuredSseDriver {
                    protocol: protocol_name.clone(),
                    port,
                    db_path: self.paths.db_path(),
                    session_id: session_id.clone(),
                    node_id: req.node_id.clone(),
                    adapter_id: req.adapter_id.clone(),
                    seq: seq.clone(),
                    rpc_state: rpc_state.clone(),
                    events: self.events.clone(),
                    cancellation: reader_cancellation.clone(),
                    model: req.model.clone(),
                    thinking: req.thinking.clone(),
                    approval_policy: req.approval_policy.clone(),
                    protocol_state: protocol_state.clone(),
                };
                let reader = structured_sse_start(&driver)?;
                rollback.own_reader(reader);
                if let Some(prompt) = initial_prompt.as_ref() {
                    structured_sse_send_prompt(&driver.prompt_driver(), prompt)?;
                }
            }

            let waiter = spawn_structured_waiter(
                self.paths.db_path(),
                session_id.clone(),
                req.node_id.clone(),
                req.adapter_id.clone(),
                process,
                self.events.clone(),
                self.structured_agent_sessions.clone(),
                rpc_state.clone(),
                rollback.reader_cancel(),
                &mut rollback.readers,
            )?;
            rollback.disarm();
            self.register_worker(waiter);

            Ok(serde_json::to_value(SessionDto {
                id: session_id.clone(),
                node_id: req.node_id,
                node_title: req.node_title,
                adapter_id: req.adapter_id,
                cwd: cwd.to_string_lossy().to_string(),
                status: "running".to_string(),
                intent: req.intent,
                started_at: ts,
                protocol: Some(protocol_name),
                driver: Some(protocol.driver_id().to_string()),
                capabilities: Some(protocol.capabilities()),
                runtime_instance_id: Some(session_id.clone()),
            })?)
        })();
        match start_result {
            Ok(value) => Ok(value),
            Err(error) => Err(rollback.failed_start(error)),
        }
    }

    fn agent_models_list(&self, payload: Value) -> Result<Value> {
        let adapter_id = required_str(&payload, "adapterId")?;
        let cwd = payload.get("cwd").and_then(Value::as_str);
        let launch = {
            let db = self.lock_db()?;
            resolve_structured_adapter_launch(&db, adapter_id)?
        };
        let executable = split_launch_command(&launch.launch_command)?
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("adapter launch command is empty"))?;
        discover_adapter_models(adapter_id, &executable, cwd)
    }

    fn agent_structured_prompt(&self, payload: Value) -> Result<Value> {
        let session_id = required_str(&payload, "sessionId")?;
        let image_paths = serde_json::from_value::<Vec<String>>(
            payload
                .get("imagePaths")
                .cloned()
                .unwrap_or_else(|| json!([])),
        )
        .context("payload.imagePaths must be an array of paths")?;
        let prompt_text = payload
            .get("prompt")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let history_text = payload
            .get("historyText")
            .and_then(Value::as_str)
            .unwrap_or(prompt_text);
        let session = self
            .lock_structured_sessions()?
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow!("unknown structured agent session: {session_id}"))?;
        let provider =
            optional_agent_profile_value(&payload, "provider", 64)?.or(session.provider.clone());
        let model = optional_agent_profile_value(&payload, "model", 128)?.or(session.model.clone());
        let thinking =
            optional_agent_profile_value(&payload, "thinking", 32)?.or(session.thinking.clone());
        let prompt = structured_prompt_from_paths(
            prompt_text,
            &image_paths,
            Path::new(&session.cwd),
            &self.paths.app_data_dir,
        )?;
        let history_line = structured_user_history_line(&prompt, history_text)?;
        let history_seq = session.seq.fetch_add(1, Ordering::SeqCst) + 1;
        if session.protocol == "opencode-sse" {
            let port = session
                .http_port
                .ok_or_else(|| anyhow!("structured SSE session has no HTTP port"))?;
            let rpc_state = session
                .rpc_state
                .as_ref()
                .ok_or_else(|| anyhow!("structured session has no RPC state"))?;
            structured_sse_send_prompt(
                &StructuredSsePromptDriver {
                    protocol: session.protocol.clone(),
                    port,
                    rpc_state: rpc_state.clone(),
                    model,
                    thinking,
                },
                &prompt,
            )?;
            let db = self.lock_db()?;
            let _ = persist_session_stream_chunk(
                &db,
                session_id,
                history_seq,
                "agent-input",
                &history_line,
            );
            return Ok(Value::Null);
        }
        let rpc_state = session
            .rpc_state
            .as_ref()
            .ok_or_else(|| anyhow!("structured session has no RPC state"))?;
        let stdin = session
            .stdin
            .as_ref()
            .ok_or_else(|| anyhow!("structured session does not accept follow-up prompts"))?;
        structured_rpc_send_prompt(
            &StructuredProtocolDriver {
                protocol: session.protocol.clone(),
                cwd: session.cwd.clone(),
                db_path: self.paths.db_path(),
                session_id: session_id.to_string(),
                stdin: stdin.clone(),
                rpc_state: rpc_state.clone(),
                provider,
                model,
                thinking,
                approval_policy: if session.intent == "ask" {
                    session.approval_policy.clone()
                } else {
                    payload
                        .get("approvalPolicy")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or(session.approval_policy.clone())
                },
                sandbox: if session.intent == "ask" {
                    session.sandbox.clone()
                } else {
                    payload
                        .get("sandbox")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or(session.sandbox.clone())
                },
            },
            &prompt,
        )?;
        let db = self.lock_db()?;
        let _ = persist_session_stream_chunk(
            &db,
            session_id,
            history_seq,
            "agent-input",
            &history_line,
        );
        Ok(Value::Null)
    }

    fn agent_structured_respond(&self, payload: Value) -> Result<Value> {
        let session_id = required_str(&payload, "sessionId")?;
        let response = payload
            .get("response")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let approved = payload
            .get("approved")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let interaction_id = payload.get("interactionId").and_then(Value::as_str);
        let session = self
            .lock_structured_sessions()?
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow!("unknown structured agent session: {session_id}"))?;
        if !session.capabilities.interact {
            bail!(
                "{} does not support interaction responses",
                session.protocol
            );
        }
        let state = session
            .rpc_state
            .as_ref()
            .ok_or_else(|| anyhow!("structured session has no RPC state"))?;
        if session.protocol == "opencode-sse" {
            structured_sse_respond(
                session
                    .http_port
                    .ok_or_else(|| anyhow!("structured SSE session has no HTTP port"))?,
                state,
                interaction_id,
                response,
                approved,
            )?;
        } else {
            structured_rpc_respond(
                &session.protocol,
                session
                    .stdin
                    .as_ref()
                    .ok_or_else(|| anyhow!("structured session has no stdin"))?,
                state,
                response,
                approved,
            )?;
        }
        let interaction_state = payload
            .get("interactionState")
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "approved" | "denied" | "answered" | "canceled"))
            .unwrap_or(if approved { "approved" } else { "denied" });
        let history_line =
            structured_interaction_history_line(interaction_id, interaction_state, response)?;
        let history_seq = session.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let db = self.lock_db()?;
        let _ = persist_session_stream_chunk(
            &db,
            session_id,
            history_seq,
            "agent-input",
            &history_line,
        );
        Ok(Value::Null)
    }

    fn agent_structured_cancel(&self, payload: Value) -> Result<Value> {
        let session_id = required_str(&payload, "sessionId")?;
        let session = self
            .lock_structured_sessions()?
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow!("unknown structured agent session: {session_id}"))?;
        if !session.capabilities.cancel {
            bail!("{} does not support turn cancellation", session.protocol);
        }
        let state = session
            .rpc_state
            .as_ref()
            .ok_or_else(|| anyhow!("structured session has no RPC state"))?;
        if session.protocol == "opencode-sse" {
            structured_sse_cancel(
                session
                    .http_port
                    .ok_or_else(|| anyhow!("structured SSE session has no HTTP port"))?,
                state,
            )?;
        } else {
            structured_rpc_cancel(&StructuredProtocolDriver {
                protocol: session.protocol.clone(),
                cwd: session.cwd.clone(),
                db_path: self.paths.db_path(),
                session_id: session_id.to_string(),
                stdin: session
                    .stdin
                    .as_ref()
                    .ok_or_else(|| anyhow!("structured session has no stdin"))?
                    .clone(),
                rpc_state: state.clone(),
                provider: session.provider.clone(),
                model: session.model.clone(),
                thinking: session.thinking.clone(),
                approval_policy: session.approval_policy.clone(),
                sandbox: session.sandbox.clone(),
            })?;
        }
        if let Some(interaction_id) = payload.get("interactionId").and_then(Value::as_str) {
            let history_line =
                structured_interaction_history_line(Some(interaction_id), "canceled", "Canceled")?;
            let history_seq = session.seq.fetch_add(1, Ordering::SeqCst) + 1;
            let db = self.lock_db()?;
            let _ = persist_session_stream_chunk(
                &db,
                session_id,
                history_seq,
                "agent-input",
                &history_line,
            );
        }
        Ok(json!({ "accepted": true }))
    }

    fn agent_structured_kill(&self, payload: Value) -> Result<Value> {
        let session_id = required_str(&payload, "sessionId")?;
        let termination_reason = payload
            .get("terminationReason")
            .and_then(Value::as_str)
            .map(StructuredTerminationReason::parse)
            .transpose()?;
        let session = self.lock_structured_sessions()?.get(session_id).cloned();
        let Some(session) = session else {
            return Ok(Value::Null);
        };
        let incomplete_turn = session
            .rpc_state
            .as_ref()
            .and_then(|state| state.lock().ok().map(|state| state.turn_active))
            .unwrap_or(false);
        if let Some(termination_reason) = termination_reason {
            *session
                .process
                .termination_reason
                .lock()
                .map_err(|error| anyhow!(error.to_string()))? = Some(termination_reason);
        }
        let mut child = session
            .process
            .child
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?;
        kill_structured_process(&mut child, &session.process.process_tree)?;
        drop(child);
        self.lock_structured_sessions()?.remove(session_id);
        if let Some(termination_reason) = termination_reason {
            let db = self.lock_db()?;
            mark_session_exited_with_turn_state_retry(
                &db,
                session_id,
                None,
                incomplete_turn,
                Some(termination_reason),
            )?;
        }
        Ok(Value::Null)
    }

    fn agent_protocol_parse(&self, payload: Value) -> Result<Value> {
        let req =
            serde_json::from_value::<AgentProtocolParseRequest>(unwrap_payload(payload, "req"))?;
        let events = parse_agent_protocol_request(&req)?;
        let (messages, controls) = reduce_agent_stream_events(&events, &req);
        let active = has_active_agent_turn(&events);
        Ok(json!({
            "events": events,
            "messages": messages,
            "controls": controls,
            "active": active
        }))
    }

    fn bento_layout(&self, payload: Value) -> Result<Value> {
        let req = serde_json::from_value::<BentoLayoutRequest>(unwrap_payload(payload, "req"))?;
        Ok(serde_json::to_value(build_bento_layout(req))?)
    }

    fn session_kill(&self, payload: Value) -> Result<Value> {
        let session_id = required_str(&payload, "sessionId")?;
        {
            let mut sessions = self.lock_pty_sessions()?;
            if let Some(session) = sessions.get_mut(session_id) {
                kill_pty_session(session)?;
                sessions.remove(session_id);
                return Ok(Value::Null);
            }
        }
        self.agent_structured_kill(payload)
    }

    fn pty_spawn(&self, payload: Value) -> Result<Value> {
        let request =
            serde_json::from_value::<SpawnSessionRequest>(unwrap_payload(payload, "req"))?;
        self.spawn_pty(request, true)
    }

    fn agent_structured_terminal_attach(&self, payload: Value) -> Result<Value> {
        let session_id = required_str(&payload, "sessionId")?;
        let session = self
            .lock_structured_sessions()?
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow!("unknown structured agent session: {session_id}"))?;
        if !session.capabilities.attached_terminal {
            bail!("{} does not support terminal attachment", session.protocol);
        }
        let port = session
            .http_port
            .ok_or_else(|| anyhow!("OpenCode session has no HTTP port"))?;
        let opencode_session_id = session
            .rpc_state
            .as_ref()
            .ok_or_else(|| anyhow!("OpenCode session has no RPC state"))?
            .lock()
            .map_err(|error| anyhow!("structured RPC state is poisoned: {error}"))?
            .opencode
            .session_id
            .clone()
            .ok_or_else(|| anyhow!("OpenCode session is not initialized"))?;
        self.spawn_pty(
            SpawnSessionRequest {
                node_id: Some(format!("{session_id}:terminal")),
                node_title: None,
                adapter_id: Some("opencode".to_string()),
                command: Some("opencode".to_string()),
                shell_command: None,
                args: vec![
                    "attach".to_string(),
                    format!("http://127.0.0.1:{port}"),
                    "--session".to_string(),
                    opencode_session_id,
                ],
                cwd: Some(session.cwd),
                rows: payload
                    .get("rows")
                    .and_then(Value::as_u64)
                    .map(u16::try_from)
                    .transpose()
                    .context("terminal rows are too large")?,
                cols: payload
                    .get("cols")
                    .and_then(Value::as_u64)
                    .map(u16::try_from)
                    .transpose()
                    .context("terminal columns are too large")?,
            },
            false,
        )
    }

    fn spawn_pty(&self, request: SpawnSessionRequest, persist: bool) -> Result<Value> {
        let rows = request.rows.unwrap_or(24).max(1);
        let cols = request.cols.unwrap_or(80).max(1);
        let ResolvedPtyCommand {
            command,
            args,
            source: command_source,
            env: command_env,
        } = {
            let db = self.lock_db()?;
            resolve_spawn_command(&db, &request)?
        };
        let session_id = id("session");
        let node_id = request.node_id.clone().unwrap_or_else(|| id("node"));
        let adapter_id = request
            .adapter_id
            .clone()
            .unwrap_or_else(|| "shell".to_string());
        let cwd = resolve_optional_cwd(request.cwd.as_deref())?;

        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let mut builder = CommandBuilder::new(&command);
        for arg in &args {
            builder.arg(arg);
        }
        for (key, value) in &command_env {
            builder.env(key, value);
        }
        builder.cwd(cwd.clone());
        let child = pair.slave.spawn_command(builder)?;
        let process_id = child.process_id();
        let mut rollback = PtySpawnRollback::new(child.clone_killer(), process_id);
        let killer = child.clone_killer();
        drop(pair.slave);

        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let terminal = Arc::new(Mutex::new(TerminalModel::new(
            session_id.clone(),
            rows,
            cols,
            self.events.clone(),
        )));

        let ts = now();
        if persist {
            let db = self.lock_db()?;
            let tx = db.unchecked_transaction()?;
            tx.execute(
                "INSERT INTO sessions (id, node_id, node_title, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
                 VALUES (?1, ?2, COALESCE(NULLIF(?7, ''), (SELECT title FROM nodes WHERE id = ?2), ''), ?3, ?4, ?5, 'running', ?6, ?6, ?6)",
                params![
                    session_id,
                    node_id,
                    adapter_id,
                    json!({
                        "command": command,
                        "args": args,
                        "shellCommand": request.shell_command,
                        "source": command_source,
                    })
                    .to_string(),
                    cwd.to_string_lossy().to_string(),
                    ts,
                    request.node_title.as_deref().unwrap_or_default()
                ],
            )?;
            append_session_event(
                &tx,
                &session_id,
                "lifecycle",
                "running",
                "Terminal session started.",
                &json!({ "adapterId": adapter_id }),
            )?;
            tx.commit()?;
        }

        {
            let mut sessions = self.lock_pty_sessions()?;
            sessions.insert(
                session_id.clone(),
                PtySessionHandle {
                    master: pair.master,
                    writer: Arc::new(Mutex::new(writer)),
                    killer,
                    #[cfg(windows)]
                    process_id,
                    terminal: terminal.clone(),
                },
            );
        }
        rollback.disarm();

        {
            let mut terminal = lock_terminal_model(&terminal);
            emit_terminal_frame(&*self.events, terminal.snapshot_and_reset_damage());
        }
        self.register_worker(spawn_pty_reader(
            session_id.clone(),
            self.paths.db_path(),
            reader,
            terminal,
            self.events.clone(),
            self.shutdown_cancel.clone(),
            persist,
        ));
        self.register_worker(spawn_pty_waiter(
            session_id.clone(),
            self.paths.db_path(),
            child,
            self.events.clone(),
            self.pty_sessions.clone(),
            persist,
        ));

        Ok(serde_json::to_value(SessionDto {
            id: session_id,
            node_id,
            node_title: request.node_title,
            adapter_id,
            cwd: cwd.to_string_lossy().to_string(),
            status: "running".to_string(),
            intent: "code".to_string(),
            started_at: ts,
            protocol: None,
            driver: None,
            capabilities: None,
            runtime_instance_id: None,
        })?)
    }

    fn pty_write(&self, payload: Value) -> Result<Value> {
        let session_id = payload
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("pty_write payload.sessionId is required"))?;
        let data = payload_bytes(&payload)?;
        let writer = self
            .lock_pty_sessions()?
            .get(session_id)
            .map(|session| session.writer.clone())
            .ok_or_else(|| anyhow!("unknown session: {session_id}"))?;
        let mut writer = writer.lock().map_err(|error| anyhow!(error.to_string()))?;
        writer.write_all(&data)?;
        writer.flush()?;
        Ok(Value::Null)
    }

    fn pty_resize(&self, payload: Value) -> Result<Value> {
        let session_id = payload
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("pty_resize payload.sessionId is required"))?;
        let cols = payload
            .get("cols")
            .and_then(Value::as_u64)
            .ok_or_else(|| anyhow!("pty_resize payload.cols is required"))?
            as u16;
        let rows = payload
            .get("rows")
            .and_then(Value::as_u64)
            .ok_or_else(|| anyhow!("pty_resize payload.rows is required"))?
            as u16;
        let sessions = self.lock_pty_sessions()?;
        let Some(session) = sessions.get(session_id) else {
            return Ok(Value::Null);
        };
        session.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let mut terminal = lock_terminal_model(&session.terminal);
        terminal.resize(rows, cols);
        emit_terminal_frame(&*self.events, terminal.snapshot_and_reset_damage());
        Ok(Value::Null)
    }

    fn terminal_viewport(&self, payload: Value) -> Result<Value> {
        let session_id = required_str(&payload, "sessionId")?;
        let display_offset = payload
            .get("displayOffset")
            .and_then(Value::as_u64)
            .ok_or_else(|| anyhow!("terminal_viewport payload.displayOffset is required"))?;
        let display_offset =
            usize::try_from(display_offset).context("terminal viewport offset is too large")?;
        let sessions = self.lock_pty_sessions()?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("unknown session: {session_id}"))?;
        let mut terminal = lock_terminal_model(&session.terminal);
        let frame = terminal.set_viewport(display_offset);
        let response = serde_json::to_value(&frame)?;
        emit_terminal_frame(&*self.events, frame);
        Ok(response)
    }

    fn pty_kill(&self, payload: Value) -> Result<Value> {
        let session_id = payload
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("pty_kill payload.sessionId is required"))?;
        let mut sessions = self.lock_pty_sessions()?;
        let Some(session) = sessions.get_mut(session_id) else {
            bail!("unknown session: {session_id}");
        };
        kill_pty_session(session)?;
        sessions.remove(session_id);
        Ok(Value::Null)
    }

    fn session_list(&self, payload: Value) -> Result<Value> {
        let limit = payload
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(30)
            .clamp(1, 100) as i64;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(load_session_history(&db, limit)?)?)
    }

    fn session_statuses(&self, payload: Value) -> Result<Value> {
        let session_ids = serde_json::from_value::<Vec<String>>(
            payload
                .get("sessionIds")
                .cloned()
                .ok_or_else(|| anyhow!("payload.sessionIds is required"))?,
        )?;
        let db = self.lock_db()?;
        let mut statement = db.prepare_cached(
            "SELECT status, exit_code, started_at, ended_at FROM sessions WHERE id = ?1",
        )?;
        let mut statuses = serde_json::Map::new();
        for session_id in session_ids
            .into_iter()
            .filter(|id| !id.is_empty())
            .collect::<HashSet<_>>()
        {
            let status = statement
                .query_row(params![session_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<i32>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                })
                .optional()?;
            if let Some((status, exit_code, started_at, ended_at)) = status {
                statuses.insert(
                    session_id,
                    json!({ "status": status, "exitCode": exit_code, "startedAt": started_at, "endedAt": ended_at }),
                );
            }
        }
        Ok(Value::Object(statuses))
    }

    fn session_transcript(&self, payload: Value) -> Result<Value> {
        let session_id = required_str(&payload, "sessionId")?;
        let db = self.lock_db()?;
        let chunks = load_session_chunks(&db, session_id)?;
        let text = if payload
            .get("visible")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            decode_visible_chunks(&chunks)
        } else {
            decode_chunks(&chunks)
        };
        Ok(serde_json::to_value(SessionTranscriptDto {
            session_id: session_id.to_string(),
            text,
            chunk_count: chunks.len(),
        })?)
    }

    fn session_transcript_page(&self, payload: Value) -> Result<Value> {
        let session_id = required_str(&payload, "sessionId")?;
        let before_seq = payload.get("beforeSeq").and_then(Value::as_u64);
        let limit = payload
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(250)
            .clamp(1, 500) as usize;
        let visible = payload
            .get("visible")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let db = self.lock_db()?;
        let (chunks, total_chunk_count) =
            load_session_chunk_page(&db, session_id, before_seq, limit)?;
        let start_seq = chunks.first().map(|(seq, _)| *seq);
        let end_seq = chunks.last().map(|(seq, _)| *seq);
        let text = decode_session_chunk_page(&chunks, visible);
        let has_more = if let Some(start) = start_seq {
            db.query_row(
                "SELECT EXISTS(SELECT 1 FROM session_chunks WHERE session_id = ?1 AND seq < ?2)",
                params![session_id, start as i64],
                |row| row.get::<_, bool>(0),
            )?
        } else {
            false
        };
        Ok(serde_json::to_value(SessionTranscriptPageDto {
            session_id: session_id.to_string(),
            text,
            chunk_count: chunks.len(),
            total_chunk_count,
            start_seq,
            end_seq,
            has_more,
        })?)
    }

    fn session_search(&self, payload: Value) -> Result<Value> {
        let query = required_str(&payload, "query")?;
        let db = self.lock_db()?;
        Ok(serde_json::to_value(search_session_history(&db, query)?)?)
    }

    fn terminal_session_index(&self, payload: Value) -> Result<Value> {
        let include_transcripts = payload
            .get("includeTranscripts")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let db = self.lock_db()?;
            let nodes = load_canvas(&db, canvas_id)?.nodes;
            return Ok(terminal_session_index_from_nodes(
                &nodes,
                payload.get("query").and_then(Value::as_str),
                Some(&db),
                include_transcripts,
            ));
        }
        let nodes = payload
            .get("nodes")
            .cloned()
            .ok_or_else(|| anyhow!("payload.canvasId or payload.nodes is required"))?;
        let nodes = serde_json::from_value::<Vec<CanvasNodeDto>>(nodes)?;
        Ok(terminal_session_index_from_nodes(
            &nodes,
            payload.get("query").and_then(Value::as_str),
            None,
            include_transcripts,
        ))
    }

    fn terminal_transcripts_clear(&self, payload: Value) -> Result<Value> {
        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let mut db = self.lock_db()?;
            let mut canvas = load_canvas(&db, canvas_id)?;
            let result = clear_persisted_terminal_transcripts_in_nodes(&mut canvas.nodes);
            if result.changed {
                let tx = db.transaction()?;
                sync_canvas_nodes(&tx, canvas_id, canvas.nodes.clone())?;
                tx.commit()?;
            }
            return Ok(json!({
                "nodes": canvas.nodes,
                "terminalIds": result.terminal_ids,
                "clearedChunks": result.cleared_chunks,
            }));
        }

        let nodes = payload
            .get("nodes")
            .cloned()
            .ok_or_else(|| anyhow!("payload.canvasId or payload.nodes is required"))?;
        let mut nodes = serde_json::from_value::<Vec<CanvasNodeDto>>(nodes)?;
        let result = clear_persisted_terminal_transcripts_in_nodes(&mut nodes);
        Ok(json!({
            "nodes": nodes,
            "terminalIds": result.terminal_ids,
            "clearedChunks": result.cleared_chunks,
        }))
    }

    fn terminal_session_mark_exited(&self, payload: Value) -> Result<Value> {
        let session_id = required_str(&payload, "sessionId")?;
        let marker = payload
            .get("marker")
            .and_then(Value::as_str)
            .unwrap_or("pty -> process exited");
        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let mut db = self.lock_db()?;
            let mut canvas = load_canvas(&db, canvas_id)?;
            let matched_node =
                mark_terminal_session_exited_in_nodes(&mut canvas.nodes, session_id, marker);
            if matched_node.is_some() {
                let tx = db.transaction()?;
                sync_canvas_nodes(&tx, canvas_id, canvas.nodes.clone())?;
                tx.commit()?;
            }
            return Ok(json!({
                "nodes": canvas.nodes,
                "matchedNode": matched_node,
            }));
        }

        let nodes = payload
            .get("nodes")
            .cloned()
            .ok_or_else(|| anyhow!("payload.canvasId or payload.nodes is required"))?;
        let mut nodes = serde_json::from_value::<Vec<CanvasNodeDto>>(nodes)?;
        let matched_node = mark_terminal_session_exited_in_nodes(&mut nodes, session_id, marker);
        Ok(json!({
            "nodes": nodes,
            "matchedNode": matched_node,
        }))
    }

    fn terminal_pending_prompt_clear(&self, payload: Value) -> Result<Value> {
        let node_id = required_str(&payload, "nodeId")?;
        let pending_prompt_id = payload.get("pendingPromptId").and_then(Value::as_str);
        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let mut db = self.lock_db()?;
            let mut canvas = load_canvas(&db, canvas_id)?;
            let cleared_node =
                clear_pending_prompt_in_nodes(&mut canvas.nodes, node_id, pending_prompt_id);
            if cleared_node.is_some() {
                let tx = db.transaction()?;
                sync_canvas_nodes(&tx, canvas_id, canvas.nodes.clone())?;
                tx.commit()?;
            }
            return Ok(json!({
                "nodes": canvas.nodes,
                "clearedNode": cleared_node,
            }));
        }

        let nodes = payload
            .get("nodes")
            .cloned()
            .ok_or_else(|| anyhow!("payload.canvasId or payload.nodes is required"))?;
        let mut nodes = serde_json::from_value::<Vec<CanvasNodeDto>>(nodes)?;
        let cleared_node = clear_pending_prompt_in_nodes(&mut nodes, node_id, pending_prompt_id);
        Ok(json!({
            "nodes": nodes,
            "clearedNode": cleared_node,
        }))
    }

    fn terminal_transcript_append(&self, payload: Value) -> Result<Value> {
        let node_id = required_str(&payload, "nodeId")?;
        let marker = required_str(&payload, "marker")?;
        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let mut db = self.lock_db()?;
            let mut canvas = load_canvas(&db, canvas_id)?;
            let updated_node =
                append_terminal_transcript_marker_in_nodes(&mut canvas.nodes, node_id, marker);
            if updated_node.is_some() {
                let tx = db.transaction()?;
                sync_canvas_nodes(&tx, canvas_id, canvas.nodes.clone())?;
                tx.commit()?;
            }
            return Ok(json!({
                "nodes": canvas.nodes,
                "updatedNode": updated_node,
            }));
        }

        let nodes = payload
            .get("nodes")
            .cloned()
            .ok_or_else(|| anyhow!("payload.canvasId or payload.nodes is required"))?;
        let mut nodes = serde_json::from_value::<Vec<CanvasNodeDto>>(nodes)?;
        let updated_node = append_terminal_transcript_marker_in_nodes(&mut nodes, node_id, marker);
        Ok(json!({
            "nodes": nodes,
            "updatedNode": updated_node,
        }))
    }

    fn terminal_worktree_assign(&self, payload: Value) -> Result<Value> {
        let cwd = required_str(&payload, "cwd")?;
        let node_ids = payload
            .get("nodeIds")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        if let Some(canvas_id) = payload.get("canvasId").and_then(Value::as_str) {
            let mut db = self.lock_db()?;
            let mut canvas = load_canvas(&db, canvas_id)?;
            let assigned_ids = assign_terminal_worktree_in_nodes(&mut canvas.nodes, cwd, &node_ids);
            if !assigned_ids.is_empty() {
                let tx = db.transaction()?;
                sync_canvas_nodes(&tx, canvas_id, canvas.nodes.clone())?;
                tx.commit()?;
            }
            return Ok(json!({
                "nodes": canvas.nodes,
                "assignedIds": assigned_ids,
            }));
        }

        let nodes = payload
            .get("nodes")
            .cloned()
            .ok_or_else(|| anyhow!("payload.canvasId or payload.nodes is required"))?;
        let mut nodes = serde_json::from_value::<Vec<CanvasNodeDto>>(nodes)?;
        let assigned_ids = assign_terminal_worktree_in_nodes(&mut nodes, cwd, &node_ids);
        Ok(json!({
            "nodes": nodes,
            "assignedIds": assigned_ids,
        }))
    }

    fn session_clear_transcripts(&self) -> Result<Value> {
        let db = self.lock_db()?;
        let _ = db.execute("DELETE FROM session_chunks_fts", []);
        let deleted = db.execute("DELETE FROM session_chunks", [])?;
        let _ = gc_image_attachments(&db, &self.paths.app_data_dir);
        Ok(json!(deleted))
    }

    fn attachment_storage_status(&self) -> Result<Value> {
        let db = self.lock_db()?;
        Ok(serde_json::to_value(image_attachment_storage_status(
            &db,
            &self.paths.app_data_dir,
        )?)?)
    }

    fn attachment_gc(&self) -> Result<Value> {
        let db = self.lock_db()?;
        Ok(serde_json::to_value(gc_image_attachments(
            &db,
            &self.paths.app_data_dir,
        )?)?)
    }

    fn usage_dashboard(&self, payload: Value) -> Result<Value> {
        let db = self.lock_db()?;
        query_usage_dashboard(&db, payload)
    }

    fn usage_billing_override_set(&self, payload: Value) -> Result<Value> {
        let db = self.lock_db()?;
        let result = set_usage_billing_override(&db, payload)?;
        self.events
            .emit("usage:updated", &json!({ "reason": "billing_override" }));
        Ok(result)
    }

    fn usage_clear(&self) -> Result<Value> {
        let mut db = self.lock_db()?;
        let result = clear_usage_data(&mut db)?;
        self.events
            .emit("usage:updated", &json!({ "reason": "cleared" }));
        Ok(result)
    }

    fn state_backup_export(&self, payload: Value) -> Result<Value> {
        let destination = PathBuf::from(required_str(&payload, "path")?);
        let db = self.lock_db()?;
        export_database_backup(&db, &self.paths.db_path(), &destination)?;
        Ok(json!({ "path": destination }))
    }

    fn settings_export(&self) -> Result<Value> {
        let db = self.lock_db()?;
        let mut stmt = db.prepare("SELECT key, value_json FROM settings ORDER BY key ASC")?;
        let rows = stmt.query_map([], |row| {
            let key: String = row.get(0)?;
            let value_json: String = row.get(1)?;
            Ok((
                key,
                serde_json::from_str::<Value>(&value_json).unwrap_or(Value::Null),
            ))
        })?;
        let mut map = serde_json::Map::new();
        for row in rows {
            let (key, value) = row?;
            if key != LEGACY_SPOTIFY_TOKEN_KEY {
                map.insert(key, redact_secrets_in_value(value));
            }
        }
        let workspace_settings = Value::Object(map.clone());
        let theme_id = map
            .get("theme")
            .cloned()
            .unwrap_or_else(|| json!("mono-dark"));
        let adapters = redact_secrets_in_value(serde_json::to_value(adapter_registry(&db)?)?);
        map.insert(
            "workspace".to_string(),
            json!({
                "version": 1,
                "exportedAt": now(),
                "themeId": theme_id,
                "settings": workspace_settings,
                "adapters": adapters,
            }),
        );
        Ok(Value::Object(map))
    }

    fn settings_import(&self, payload: Value) -> Result<Value> {
        let adapter_payload = settings_adapter_payload(&payload).cloned();
        let theme_payload = settings_theme_payload(&payload).cloned();
        let payload = unwrap_settings_payload(payload);
        let Some(map) = payload.as_object() else {
            bail!("settings_import payload must be a JSON object");
        };
        let db = self.lock_db()?;
        let mut settings = serde_json::Map::new();
        for (key, value) in map {
            if key == LEGACY_SPOTIFY_TOKEN_KEY {
                continue;
            }
            let Some(value) = sanitize_setting_value(key, value) else {
                continue;
            };
            settings.insert(key.clone(), value);
        }
        if let Some(raw_background) = map.get("workspaceBackground") {
            settings.insert(
                "workspaceBackground".to_string(),
                sanitize_workspace_background_with_legacy(raw_background, &settings),
            );
        } else if has_legacy_workspace_background_patch(&settings) {
            settings.insert(
                "workspaceBackground".to_string(),
                sanitize_workspace_background_with_legacy(&Value::Null, &settings),
            );
        }
        if let Some(background) = settings.get("workspaceBackground").cloned() {
            apply_workspace_background_legacy_settings(&mut settings, &background);
        }
        if !settings.contains_key("theme") {
            if let Some(theme_id) = theme_payload.as_ref() {
                if let Some(value) = sanitize_setting_value("theme", theme_id) {
                    settings.insert("theme".to_string(), value);
                }
            }
        }
        let prune_transcripts = settings.contains_key("sessionTranscriptRetentionBytes")
            || settings.contains_key("sessionTranscriptGlobalRetentionBytes");
        for (key, value) in settings {
            db.execute(
                "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)",
                params![key, value.to_string(), now()],
            )?;
        }
        if prune_transcripts {
            prune_all_session_chunks_to_retention(&db)?;
            prune_global_session_chunks_to_retention(&db)?;
        }
        if let Some(Value::Array(adapters)) = adapter_payload {
            for adapter in adapters {
                if let Ok(manifest) = serde_json::from_value::<AdapterDto>(adapter) {
                    let _ = persist_adapter_manifest(&db, normalize_adapter_manifest(manifest));
                }
            }
        }
        Ok(Value::Null)
    }

    fn updater_platform(&self) -> Result<Value> {
        Ok(serde_json::to_value(current_updater_platform())?)
    }

    fn updater_status(&self) -> Result<Value> {
        Ok(serde_json::to_value(UpdaterStatusDto {
            current_version: self.version.clone(),
            platform: current_updater_platform(),
            checked_at: now(),
            update: None,
            message: "Updates have not been checked yet.".to_string(),
        })?)
    }

    fn updater_check(&self) -> Result<Value> {
        Ok(serde_json::to_value(self.check_for_update_status()?)?)
    }

    fn updater_download(&self) -> Result<Value> {
        let status = self.check_for_update_status()?;
        let update = status
            .update
            .ok_or_else(|| anyhow!("No update is available."))?;
        Ok(serde_json::to_value(self.download_update(&update)?)?)
    }

    fn updater_recovery_error(&self) -> Result<Value> {
        let marker = self.paths.update_dir.join(UPDATE_RECOVERY_ERROR_FILE);
        if !marker.is_file() {
            return Ok(Value::Null);
        }
        let message = fs::read_to_string(&marker)?;
        fs::remove_file(marker)?;
        let message = message.trim().trim_start_matches('\u{feff}');
        Ok(if message.is_empty() {
            Value::Null
        } else {
            Value::String(message.to_string())
        })
    }

    fn check_for_update_status(&self) -> Result<UpdaterStatusDto> {
        let platform = current_updater_platform();
        if self.version.ends_with("-dev") && !self.test_mode {
            return Ok(no_update_status(
                &self.version,
                platform,
                "Auto-update is disabled in dev builds.",
            ));
        }

        let release: GithubRelease = get_json(&self.update_feed_url)?;
        update_status_for_release(&self.version, platform, &release, self.test_mode, |url| {
            get_text(url, self.test_mode)
        })
    }

    fn download_update(&self, update: &UpdateInfoDto) -> Result<UpdaterDownloadDto> {
        fs::create_dir_all(&self.paths.update_dir)?;
        let archive_name = update_file_name(update)?;
        validate_update_archive_name(&archive_name)?;
        let archive_path = self.paths.update_dir.join(archive_name);
        let partial_path = archive_path.with_extension(format!(
            "{}.part",
            archive_path
                .extension()
                .and_then(OsStr::to_str)
                .unwrap_or_default()
        ));
        let _ = fs::remove_file(&partial_path);
        self.events.emit(
            "updater:progress",
            &json!({
                "phase": "downloading",
                "downloadedBytes": 0,
                "totalBytes": update.size
            }),
        );
        let download = download_update_file(
            &update.download_url,
            self.test_mode,
            &partial_path,
            |downloaded, total| {
                self.events.emit(
                    "updater:progress",
                    &json!({
                        "phase": "downloading",
                        "downloadedBytes": downloaded,
                        "totalBytes": update.size.or(total)
                    }),
                );
            },
        );
        let (downloaded, actual_sha256) = match download {
            Ok(result) => result,
            Err(error) => {
                let _ = fs::remove_file(&partial_path);
                return Err(error);
            }
        };
        self.events.emit(
            "updater:progress",
            &json!({
                "phase": "verifying",
                "downloadedBytes": downloaded,
                "totalBytes": update.size.or(Some(downloaded))
            }),
        );
        if update.size.is_some_and(|expected| downloaded != expected) {
            let _ = fs::remove_file(&partial_path);
            bail!("Downloaded update size did not match the GitHub release asset.");
        }
        if actual_sha256 != update.sha256.to_ascii_lowercase() {
            let _ = fs::remove_file(&partial_path);
            bail!("Update checksum mismatch.");
        }
        let _ = fs::remove_file(&archive_path);
        fs::rename(&partial_path, &archive_path)?;
        self.events.emit(
            "updater:progress",
            &json!({
                "phase": "preparing",
                "downloadedBytes": downloaded,
                "totalBytes": update.size.or(Some(downloaded))
            }),
        );
        let update_path = downloaded_update_path(&archive_path, update)?;
        let signature_status = if self.skip_update_signature_verify() {
            "skipped".to_string()
        } else {
            match verify_update_signature(&update_path) {
                Ok(status) => status,
                Err(error) => {
                    if update_path.is_dir() {
                        let _ = fs::remove_dir_all(&update_path);
                    } else {
                        let _ = fs::remove_file(&update_path);
                    }
                    return Err(error);
                }
            }
        };
        self.events.emit(
            "updater:progress",
            &json!({
                "phase": "ready",
                "downloadedBytes": downloaded,
                "totalBytes": update.size.or(Some(downloaded))
            }),
        );
        Ok(UpdaterDownloadDto {
            version: update.version.clone(),
            asset_name: update.asset_name.clone(),
            update_path: update_path.to_string_lossy().to_string(),
            signature_status,
            message: format!("Downloaded {}.", update.asset_name),
        })
    }

    fn skip_update_signature_verify(&self) -> bool {
        self.test_mode
            && env_var_os(
                "WHEELJACK_SKIP_SIGNATURE_VERIFY",
                "TXTL_SKIP_SIGNATURE_VERIFY",
            )
            .as_deref()
                == Some(std::ffi::OsStr::new("1"))
    }

    fn browser_detect_local_preview_urls(&self, payload: Value) -> Result<Value> {
        let mut text = payload
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if let Some(chunks) = payload.get("chunks").and_then(Value::as_array) {
            for chunk in chunks.iter().filter_map(Value::as_str) {
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(chunk);
            }
        }
        Ok(json!(detect_local_preview_urls(&text)))
    }

    fn intent_parse(&self, payload: Value) -> Result<Value> {
        Ok(serde_json::to_value(parse_intent(
            serde_json::from_value::<IntentParseRequest>(unwrap_payload(payload, "req"))?,
        ))?)
    }

    fn intent_execute(&self, payload: Value) -> Result<Value> {
        let req = serde_json::from_value::<IntentExecuteRequest>(unwrap_payload(payload, "req"))?;
        if req.intent.requires_confirmation && !req.approved {
            return Ok(serde_json::to_value(IntentResultDto {
                ok: false,
                message: "Intent requires confirmation.".to_string(),
            })?);
        }
        if let Some(assignments) = req
            .intent
            .actions
            .iter()
            .find(|action| action.get("type") == Some(&json!("route_terminal_prompts")))
            .map(orchestrator_assignments_from_action)
        {
            let result = self.execute_orchestrator_route(OrchestratorRouteRequest {
                transcript: req.intent.transcript,
                assignments,
                canvas_id: None,
                task_id: None,
                approved: req.approved,
                dry_run: false,
            })?;
            self.events
                .emit("orchestrator:route", &serde_json::to_value(&result)?);
            return Ok(serde_json::to_value(IntentResultDto {
                ok: result.ok,
                message: result.message,
            })?);
        }
        Ok(serde_json::to_value(IntentResultDto {
            ok: true,
            message: "Intent contains only shell-handled actions.".to_string(),
        })?)
    }

    fn orchestrator_route(&self, payload: Value) -> Result<Value> {
        let req =
            serde_json::from_value::<OrchestratorRouteRequest>(unwrap_payload(payload, "req"))?;
        let result = self.execute_orchestrator_route(req)?;
        self.events
            .emit("orchestrator:route", &serde_json::to_value(&result)?);
        Ok(serde_json::to_value(result)?)
    }

    fn route_preview(&self, payload: Value) -> Result<Value> {
        let req = serde_json::from_value::<RouteRequest>(unwrap_payload(payload, "req"))?;
        validate_route_request(&req)?;
        let route_req = route_orchestrator_request(&req, false);
        let result = self.execute_orchestrator_route(route_req)?;
        let targets = self.route_target_previews(&req, &result.routes)?;
        let preview_id = id("route_preview");
        let confirmation_token = Uuid::now_v7().to_string();
        let fingerprint = route_request_fingerprint(&req);
        let target_fingerprint = route_targets_fingerprint(&targets);
        let mut approvals = self
            .route_approvals
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?;
        let now = Instant::now();
        approvals.retain(|_, approval| approval.expires_at > now);
        approvals.insert(
            confirmation_token.clone(),
            RouteApproval {
                fingerprint,
                target_fingerprint,
                expires_at: now + ROUTE_CONFIRMATION_TTL,
            },
        );
        let recipients = result
            .routes
            .iter()
            .map(|route| {
                route
                    .node_title
                    .clone()
                    .unwrap_or_else(|| route.target.clone())
            })
            .collect::<Vec<_>>();
        let mut writes: Vec<String> = targets
            .iter()
            .flat_map(|target| target.writes.iter().cloned())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        writes.sort();
        Ok(serde_json::to_value(RoutePreviewDto {
            preview_id,
            confirmation_token,
            message: result.message,
            risk: "confirmation".to_string(),
            recipients,
            writes,
            targets,
            requires_confirmation: true,
        })?)
    }

    fn route_execute(&self, payload: Value) -> Result<Value> {
        let req = serde_json::from_value::<RouteRequest>(unwrap_payload(payload, "req"))?;
        validate_route_request(&req)?;
        let token = req
            .confirmation_token
            .as_deref()
            .filter(|token| !token.is_empty())
            .ok_or_else(|| anyhow!("route execution requires a confirmation token"))?;
        let approval = self
            .route_approvals
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?
            .remove(token)
            .ok_or_else(|| anyhow!("route confirmation token is invalid or already used"))?;
        if approval.expires_at <= Instant::now() {
            bail!("route confirmation token has expired");
        }
        if approval.fingerprint != route_request_fingerprint(&req) {
            bail!("route confirmation token does not match this request");
        }

        let current_plan =
            self.execute_orchestrator_route(route_orchestrator_request(&req, false))?;
        let current_targets = self.route_target_previews(&req, &current_plan.routes)?;
        if approval.target_fingerprint != route_targets_fingerprint(&current_targets) {
            bail!("route targets changed; preview the route again");
        }

        let result = self.execute_orchestrator_route(route_orchestrator_request(&req, true))?;
        self.events
            .emit("orchestrator:route", &serde_json::to_value(&result)?);
        let delivered_count = result.routes.iter().filter(|route| route.delivered).count();
        let targets = result
            .routes
            .iter()
            .map(|route| RouteTargetResultDto {
                task_id: route.task_id.clone(),
                task: route.task.clone(),
                node_id: route
                    .node_id
                    .clone()
                    .unwrap_or_else(|| route.target.clone()),
                title: route
                    .node_title
                    .clone()
                    .unwrap_or_else(|| route.target.clone()),
                delivered: route.delivered,
                reason: route.reason.clone(),
            })
            .collect();
        Ok(serde_json::to_value(RouteExecuteDto {
            ok: result.ok,
            message: result.message,
            delivered_count,
            targets,
        })?)
    }

    fn route_target_previews(
        &self,
        req: &RouteRequest,
        routes: &[OrchestratorRouteDto],
    ) -> Result<Vec<RouteTargetPreviewDto>> {
        let context = if req.workspace_id.trim().is_empty() {
            None
        } else {
            let db = self.lock_db()?;
            let nodes = load_nodes(&db, &req.workspace_id)?;
            let project_id: String = db.query_row(
                "SELECT project_id FROM canvases WHERE id = ?1",
                params![req.workspace_id],
                |row| row.get(0),
            )?;
            let workspace_path = db.query_row(
                "SELECT path FROM projects WHERE id = ?1",
                params![project_id],
                |row| row.get::<_, String>(0),
            )?;
            Some((nodes, workspace_path))
        };
        routes
            .iter()
            .map(|route| {
                let title = route
                    .node_title
                    .clone()
                    .unwrap_or_else(|| route.target.clone());
                let node_id = route
                    .node_id
                    .clone()
                    .unwrap_or_else(|| route.target.clone());
                let mut writes = Vec::new();
                if route.reason.is_none() && route.session_id.is_some() {
                    writes.push(format!("terminal:{title}"));
                    if let Some((nodes, workspace_path)) = context.as_ref() {
                        let prepared = prepare_coordination_prompt(
                            nodes,
                            &node_id,
                            workspace_path,
                            &route.prompt,
                            "Prompt delivered by wheeljack.",
                            route.task_id.as_deref().or(req.task_id.as_deref()),
                        )?;
                        if prepared.get("wrapped").and_then(Value::as_bool) == Some(true) {
                            if let Some(board) = prepared.get("board") {
                                if let Some(path) = board.get("tasksPath").and_then(Value::as_str) {
                                    writes.push(format!("file:{path}"));
                                }
                                if let Some(path) = board.get("agentsPath").and_then(Value::as_str)
                                {
                                    writes.push(format!(
                                        "file:{}",
                                        PathBuf::from(path)
                                            .join(format!("{}.ndjson", route_log_file_stem(&title)))
                                            .to_string_lossy()
                                    ));
                                }
                            }
                        }
                    }
                }
                Ok(RouteTargetPreviewDto {
                    task_id: route.task_id.clone(),
                    task: route.task.clone(),
                    node_id,
                    title,
                    adapter_id: route.adapter_id.clone().unwrap_or_default(),
                    session_id: route.session_id.clone(),
                    ready: route.reason.is_none() && route.session_id.is_some(),
                    writes,
                    reason: route.reason.clone().or_else(|| {
                        route
                            .session_id
                            .is_none()
                            .then(|| "target has no recorded session".to_string())
                    }),
                })
            })
            .collect()
    }

    fn session_event_append(&self, payload: Value) -> Result<Value> {
        let req =
            serde_json::from_value::<SessionEventAppendRequest>(unwrap_payload(payload, "req"))?;
        if req.session_id.trim().is_empty() || req.kind.trim().is_empty() {
            bail!("sessionId and kind are required");
        }
        if !matches!(
            req.status.as_str(),
            "running" | "needs_input" | "completed" | "canceled" | "failed" | "disconnected"
        ) {
            bail!("unsupported session event status: {}", req.status);
        }
        let (event_id, seq, created_at, node_id, node_title, adapter_id) = {
            let db = self.lock_db()?;
            let (event_id, seq, created_at) = append_session_event(
                &db,
                &req.session_id,
                &req.kind,
                &req.status,
                &req.message,
                &req.payload,
            )?;
            let (node_id, node_title, adapter_id) = db.query_row(
                "SELECT s.node_id, COALESCE(NULLIF(s.node_title, ''), n.title, ''), s.adapter_id
                 FROM sessions s
                 LEFT JOIN nodes n ON n.id = s.node_id
                 WHERE s.id = ?1",
                params![req.session_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )?;
            (event_id, seq, created_at, node_id, node_title, adapter_id)
        };
        let event = json!({
            "id": event_id,
            "sessionId": req.session_id,
            "seq": seq,
            "kind": req.kind,
            "status": req.status,
            "message": req.message,
            "payload": req.payload,
            "isRead": false,
            "createdAt": created_at,
            "nodeId": node_id,
            "nodeTitle": node_title,
            "adapterId": adapter_id
        });
        self.events.emit("activity:event", &event);
        Ok(event)
    }

    fn activity_list(&self, payload: Value) -> Result<Value> {
        let limit = payload
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(100)
            .clamp(1, 200) as i64;
        let unread_only = payload
            .get("unreadOnly")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let db = self.lock_db()?;
        let mut stmt = db.prepare(
            "SELECT e.id, e.session_id, e.seq, e.kind, e.status, e.message,
                    e.payload_json, e.is_read, e.created_at, s.node_id,
                    COALESCE(NULLIF(s.node_title, ''), n.title, ''), s.adapter_id
             FROM session_events e
             JOIN sessions s ON s.id = e.session_id
             LEFT JOIN nodes n ON n.id = s.node_id
             WHERE (?1 = 0 OR e.is_read = 0)
             ORDER BY e.created_at DESC, e.id DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![i64::from(unread_only), limit], |row| {
            let payload_json = row.get::<_, String>(6)?;
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "sessionId": row.get::<_, String>(1)?,
                "seq": row.get::<_, i64>(2)?,
                "kind": row.get::<_, String>(3)?,
                "status": row.get::<_, String>(4)?,
                "message": row.get::<_, String>(5)?,
                "payload": serde_json::from_str::<Value>(&payload_json).unwrap_or_else(|_| json!({})),
                "isRead": row.get::<_, i64>(7)? != 0,
                "createdAt": row.get::<_, String>(8)?,
                "nodeId": row.get::<_, String>(9)?,
                "nodeTitle": row.get::<_, String>(10)?,
                "adapterId": row.get::<_, String>(11)?
            }))
        })?;
        Ok(Value::Array(rows.collect::<rusqlite::Result<Vec<_>>>()?))
    }

    fn activity_mark_read(&self, payload: Value) -> Result<Value> {
        let db = self.lock_db()?;
        let updated = if payload.get("all").and_then(Value::as_bool).unwrap_or(false) {
            db.execute(
                "UPDATE session_events SET is_read = 1 WHERE is_read = 0",
                [],
            )?
        } else {
            let event_id = payload
                .get("eventId")
                .and_then(Value::as_i64)
                .ok_or_else(|| anyhow!("payload.eventId or payload.all is required"))?;
            db.execute(
                "UPDATE session_events SET is_read = 1 WHERE id = ?1",
                params![event_id],
            )?
        };
        Ok(json!({ "updated": updated }))
    }

    fn activity_clear(&self) -> Result<Value> {
        let deleted = self.lock_db()?.execute("DELETE FROM session_events", [])?;
        Ok(json!({ "deleted": deleted }))
    }

    fn orchestrator_harness_prompt(&self, payload: Value) -> Result<Value> {
        Ok(json!(build_orchestrator_harness_prompt(&payload)))
    }

    fn orchestrator_tool_plan_parse(&self, payload: Value) -> Result<Value> {
        let text = payload
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let request_id = payload
            .get("requestId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        Ok(json!(parse_local_orchestrator_tool_plans(text, request_id)))
    }

    fn orchestrator_tool_plan_intent(&self, payload: Value) -> Result<Value> {
        let plan = payload.get("plan").cloned().unwrap_or_else(|| json!({}));
        let transcript = payload
            .get("transcript")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let source = payload
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or("local-planner");
        let intent = planner_tool_plan_to_intent(&plan, transcript, source);
        if intent.actions.is_empty() {
            Ok(Value::Null)
        } else {
            Ok(serde_json::to_value(intent)?)
        }
    }

    fn execute_orchestrator_route(
        &self,
        req: OrchestratorRouteRequest,
    ) -> Result<OrchestratorRouteResultDto> {
        let mut routes = {
            let db = self.lock_db()?;
            plan_orchestrator_routes(&db, &req)?
        };
        let requires_confirmation = true;
        if !req.approved || req.dry_run {
            return Ok(OrchestratorRouteResultDto {
                ok: routes.iter().all(|route| route.reason.is_none()),
                requires_confirmation,
                message: "Orchestrator route preview requires approval before terminal writes."
                    .to_string(),
                routes,
            });
        }

        let workspace_path = if let Some(canvas_id) = req.canvas_id.as_deref() {
            let db = self.lock_db()?;
            db.query_row(
                "SELECT projects.path FROM canvases JOIN projects ON projects.id = canvases.project_id WHERE canvases.id = ?1",
                params![canvas_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_default()
        } else {
            String::new()
        };

        for route in &mut routes {
            if route.reason.is_some() {
                continue;
            }
            let Some(session_id) = route.session_id.as_deref() else {
                route.reason = Some("target has no recorded session".to_string());
                continue;
            };
            match self.session_prompt_send(json!({
                "sessionId": session_id,
                "nodeId": route.node_id,
                "adapterId": route.adapter_id,
                "prompt": route.prompt,
                "terminalText": route.recent_context,
                "canvasId": req.canvas_id.as_deref(),
                "workspacePath": workspace_path.as_str(),
                "taskId": route.task_id.as_deref().or(req.task_id.as_deref())
            })) {
                Ok(_) => {
                    route.delivered = true;
                    if let Err(error) = self
                        .lock_db()
                        .and_then(|db| persist_orchestrator_chunk(&db, session_id, &route.prompt))
                    {
                        route.reason = Some(format!(
                            "prompt delivered but history persistence failed: {error}"
                        ));
                    }
                }
                Err(error) => route.reason = Some(error.to_string()),
            }
        }

        let delivered = routes.iter().filter(|route| route.delivered).count();
        Ok(OrchestratorRouteResultDto {
            ok: delivered > 0 && routes.iter().all(|route| route.reason.is_none()),
            requires_confirmation,
            message: format!(
                "Delivered {delivered} orchestrator prompt{}.",
                if delivered == 1 { "" } else { "s" }
            ),
            routes,
        })
    }

    fn lock_db(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.db.lock().map_err(|error| anyhow!(error.to_string()))
    }

    fn lock_pty_sessions(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, PtySessionHandle>>> {
        self.pty_sessions
            .lock()
            .map_err(|error| anyhow!(error.to_string()))
    }

    fn lock_structured_sessions(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, StructuredAgentSessionHandle>>> {
        self.structured_agent_sessions
            .lock()
            .map_err(|error| anyhow!(error.to_string()))
    }
}

impl Drop for Core {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_prompt_delivery_worker(
    db_path: PathBuf,
    app_data_dir: PathBuf,
    session_id: String,
    sessions: Arc<Mutex<HashMap<String, StructuredAgentSessionHandle>>>,
    drainers: Arc<Mutex<HashSet<String>>>,
    events: Arc<dyn EventSink>,
    shutdown: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        while !shutdown.load(Ordering::SeqCst) {
            let session = sessions
                .lock()
                .ok()
                .and_then(|sessions| sessions.get(&session_id).cloned());
            let Some(session) = session else {
                if let Ok(db) = open_app_connection(&db_path) {
                    let _ = db.execute(
                        "UPDATE session_prompt_deliveries
                         SET state = 'blocked', error_code = 'session_not_running',
                             error_message = 'Resume the agent session before sending this prompt.',
                             updated_at = ?2
                         WHERE session_id = ?1 AND state = 'queued'",
                        params![session_id, now()],
                    );
                }
                break;
            };
            let turn_active = session
                .rpc_state
                .as_ref()
                .and_then(|state| state.lock().ok().map(|state| state.turn_active))
                .unwrap_or(false);
            if turn_active {
                thread::sleep(Duration::from_millis(50));
                continue;
            }
            let delivery = match open_app_connection(&db_path)
                .and_then(|db| claim_next_prompt_delivery(&db, &session_id))
            {
                Ok(Some(delivery)) => delivery,
                Ok(None) => {
                    thread::sleep(Duration::from_millis(100));
                    continue;
                }
                Err(error) => {
                    events.emit(
                        "agent:prompt-delivery-error",
                        &json!({ "sessionId": session_id, "message": format!("{error:#}") }),
                    );
                    thread::sleep(Duration::from_millis(250));
                    continue;
                }
            };
            events.emit("agent:prompt-delivery", &json!(delivery));
            let result =
                dispatch_queued_prompt(&db_path, &app_data_dir, &session_id, &session, &delivery);
            if let Ok(db) = open_app_connection(&db_path) {
                match result {
                    Ok(()) => {
                        let _ = complete_prompt_delivery(&db, &delivery.id);
                    }
                    Err(error) => {
                        let message = format!("{error:#}");
                        let (state, code) = if message.contains("still streaming") {
                            ("queued", "turn_active")
                        } else {
                            ("failed", "dispatch_failed")
                        };
                        let _ =
                            settle_prompt_delivery_error(&db, &delivery.id, state, code, &message);
                    }
                }
                if let Ok(Some(updated)) = load_prompt_delivery(&db, &delivery.id) {
                    events.emit("agent:prompt-delivery", &json!(updated));
                }
            }
        }
        if let Ok(mut drainers) = drainers.lock() {
            drainers.remove(&session_id);
        }
    })
}

fn dispatch_queued_prompt(
    db_path: &Path,
    app_data_dir: &Path,
    session_id: &str,
    session: &StructuredAgentSessionHandle,
    delivery: &PromptDeliveryDto,
) -> Result<()> {
    let payload = delivery
        .payload
        .as_ref()
        .ok_or_else(|| anyhow!("prompt delivery has no payload"))?;
    let provider = payload.provider.clone().or(session.provider.clone());
    let model = payload.model.clone().or(session.model.clone());
    let thinking = payload.thinking.clone().or(session.thinking.clone());
    let prompt = structured_prompt_from_paths(
        &payload.prompt,
        &payload.image_paths,
        Path::new(&session.cwd),
        app_data_dir,
    )?;
    let history_line = structured_user_history_line(&prompt, &payload.history_text)?;
    let history_seq = session.seq.fetch_add(1, Ordering::SeqCst) + 1;
    if session.protocol == "opencode-sse" {
        structured_sse_send_prompt(
            &StructuredSsePromptDriver {
                protocol: session.protocol.clone(),
                port: session
                    .http_port
                    .ok_or_else(|| anyhow!("structured SSE session has no HTTP port"))?,
                rpc_state: session
                    .rpc_state
                    .clone()
                    .ok_or_else(|| anyhow!("structured session has no RPC state"))?,
                model,
                thinking,
            },
            &prompt,
        )?;
    } else {
        structured_rpc_send_prompt(
            &StructuredProtocolDriver {
                protocol: session.protocol.clone(),
                cwd: session.cwd.clone(),
                db_path: db_path.to_path_buf(),
                session_id: session_id.to_string(),
                stdin: session.stdin.clone().ok_or_else(|| {
                    anyhow!("structured session does not accept follow-up prompts")
                })?,
                rpc_state: session
                    .rpc_state
                    .clone()
                    .ok_or_else(|| anyhow!("structured session has no RPC state"))?,
                provider,
                model,
                thinking,
                approval_policy: if session.intent == "ask" {
                    session.approval_policy.clone()
                } else {
                    payload
                        .approval_policy
                        .clone()
                        .or(session.approval_policy.clone())
                },
                sandbox: if session.intent == "ask" {
                    session.sandbox.clone()
                } else {
                    payload.sandbox.clone().or(session.sandbox.clone())
                },
            },
            &prompt,
        )?;
    }
    let db = open_app_connection(db_path)?;
    persist_session_stream_chunk(&db, session_id, history_seq, "agent-input", &history_line)?;
    Ok(())
}

fn validate_session_intent(req: &StructuredAgentSpawnRequest) -> Result<()> {
    match req.intent.as_str() {
        "code" => Ok(()),
        "ask" if req.adapter_id == "codex-cli" => {
            if req.sandbox.as_deref() != Some("read-only")
                || req.approval_policy.as_deref() != Some("never")
            {
                bail!("Ask sessions require Codex read-only sandboxing with approvals disabled");
            }
            Ok(())
        }
        "ask" if req.adapter_id == "claude-code" => {
            let plan_arg = req
                .args
                .windows(2)
                .any(|args| args[0] == "--permission-mode" && args[1].eq_ignore_ascii_case("plan"));
            if req.approval_policy.as_deref() != Some("plan") || !plan_arg {
                bail!("Ask sessions require Claude plan permission mode");
            }
            Ok(())
        }
        "ask" => bail!(
            "Ask mode is not enforceable for adapter: {}",
            req.adapter_id
        ),
        other => bail!("unsupported session intent: {other}"),
    }
}

fn validate_route_request(req: &RouteRequest) -> Result<()> {
    if req.assignments.is_empty() {
        if req.message.trim().is_empty() {
            bail!("route message is required");
        }
        if req.recipient_ids.is_empty() || req.recipient_ids.iter().any(|id| id.trim().is_empty()) {
            bail!("at least one route recipient is required");
        }
    } else if req.assignments.iter().any(|assignment| {
        assignment.target.trim().is_empty()
            || assignment.task.trim().is_empty()
            || assignment
                .task_id
                .as_deref()
                .is_some_and(|task_id| task_id.trim().is_empty())
    }) {
        bail!("route assignments require a target, task, and valid task id");
    }
    Ok(())
}

fn route_orchestrator_request(req: &RouteRequest, approved: bool) -> OrchestratorRouteRequest {
    let assignments = if req.assignments.is_empty() {
        req.recipient_ids
            .iter()
            .map(|recipient| OrchestratorAssignmentDto {
                target: recipient.clone(),
                task: req.message.clone(),
                task_id: req.task_id.clone(),
            })
            .collect()
    } else {
        req.assignments.clone()
    };
    OrchestratorRouteRequest {
        transcript: req.message.clone(),
        assignments,
        canvas_id: (!req.workspace_id.trim().is_empty()).then(|| req.workspace_id.clone()),
        task_id: req.task_id.clone(),
        approved,
        dry_run: !approved,
    }
}

fn route_request_fingerprint(req: &RouteRequest) -> String {
    let mut hasher = Sha256::new();
    hasher.update(req.workspace_id.as_bytes());
    hasher.update([0]);
    for recipient in &req.recipient_ids {
        hasher.update(recipient.as_bytes());
        hasher.update([0]);
    }
    hasher.update(req.message.as_bytes());
    hasher.update([0]);
    for assignment in &req.assignments {
        for value in [
            assignment.target.as_str(),
            assignment.task.as_str(),
            assignment.task_id.as_deref().unwrap_or_default(),
        ] {
            hasher.update(value.as_bytes());
            hasher.update([0]);
        }
    }
    if let Some(task_id) = req.task_id.as_deref() {
        hasher.update(task_id.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn route_targets_fingerprint(targets: &[RouteTargetPreviewDto]) -> String {
    let mut hasher = Sha256::new();
    for target in targets {
        for value in [
            target.task_id.as_deref().unwrap_or_default(),
            target.task.as_str(),
            target.node_id.as_str(),
            target.title.as_str(),
            target.adapter_id.as_str(),
            target.session_id.as_deref().unwrap_or_default(),
            target.reason.as_deref().unwrap_or_default(),
        ] {
            hasher.update(value.as_bytes());
            hasher.update([0]);
        }
        hasher.update([target.ready as u8]);
        for write in &target.writes {
            hasher.update(write.as_bytes());
            hasher.update([0]);
        }
    }
    format!("{:x}", hasher.finalize())
}

fn route_log_file_stem(value: &str) -> String {
    let safe = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches(|ch| matches!(ch, '-' | '_' | '.'))
        .to_string();
    if safe.is_empty() {
        "agent".to_string()
    } else {
        safe
    }
}

fn load_project_dto(db: &Connection, project_id: &str) -> Result<ProjectDto> {
    let (id, name, path, icon, icon_color, agent_access) = db
        .query_row(
            "SELECT id, name, path, icon, icon_color, agent_access FROM projects WHERE id = ?1",
            params![project_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| anyhow!("project not found: {project_id}"))?;
    let git = read_git_status(Path::new(&path), false);
    Ok(ProjectDto {
        id,
        name,
        path,
        icon,
        icon_color,
        agent_access,
        branch: git.branch,
        dirty: git.dirty,
        github_remote: git.github_remote,
        path_exists: git.path_exists,
    })
}

fn required_str<'a>(payload: &'a Value, key: &str) -> Result<&'a str> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("payload.{key} is required"))
}

fn validate_agent_profile_values(
    provider: Option<&str>,
    model: Option<&str>,
    thinking: Option<&str>,
) -> Result<()> {
    for (field, value, max_len) in [
        ("provider", provider, 64),
        ("model", model, 128),
        ("thinking", thinking, 32),
    ] {
        if value.is_some_and(|value| !safe_agent_token(value, max_len)) {
            bail!("invalid agent {field}");
        }
    }
    Ok(())
}

fn optional_agent_profile_value(
    payload: &Value,
    key: &str,
    max_len: usize,
) -> Result<Option<String>> {
    match payload.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if safe_agent_token(value, max_len) => Ok(Some(value.clone())),
        _ => bail!("invalid agent {key}"),
    }
}

fn payload_string_array(payload: &Value, key: &str) -> Vec<String> {
    payload
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn unwrap_payload(payload: Value, key: &str) -> Value {
    if let Some(value) = payload.get(key).cloned() {
        value
    } else {
        payload
    }
}

fn now() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

#[cfg(test)]
mod tests;
