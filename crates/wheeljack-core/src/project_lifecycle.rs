use super::*;

pub(crate) const LIFECYCLE_MANIFEST_PATH: &str = ".wheeljack/lifecycle.json";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LifecycleManifest {
    pub(crate) version: u32,
    pub(crate) setup: Option<LifecycleTask>,
    pub(crate) preview: Option<LifecycleTask>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LifecycleTask {
    #[serde(default)]
    pub(crate) command: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) windows: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) macos: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) linux: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) cwd: Option<String>,
    #[serde(default)]
    pub(crate) env: BTreeMap<String, String>,
    #[serde(default)]
    pub(crate) url: Option<String>,
    #[serde(default)]
    pub(crate) timeout_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LifecycleManifestDto {
    pub(crate) path: String,
    pub(crate) hash: String,
    pub(crate) trusted: bool,
    pub(crate) version: u32,
    pub(crate) setup: Option<LifecycleTask>,
    pub(crate) preview: Option<LifecycleTask>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LifecycleRunDto {
    pub(crate) id: String,
    pub(crate) project_id: String,
    pub(crate) kind: String,
    pub(crate) state: String,
    pub(crate) command: Vec<String>,
    pub(crate) url: Option<String>,
    pub(crate) pid: Option<u32>,
    pub(crate) exit_code: Option<i32>,
    pub(crate) error_message: Option<String>,
    pub(crate) started_at: String,
    pub(crate) updated_at: String,
    pub(crate) ended_at: Option<String>,
}

#[derive(Clone)]
pub(crate) struct LifecycleProcessHandle {
    pub(crate) child: Arc<Mutex<ProcessChild>>,
    pub(crate) process_tree: StructuredProcessTree,
}

pub(crate) fn read_lifecycle_manifest(
    db: &Connection,
    project_id: &str,
    project_path: &str,
) -> Result<(LifecycleManifestDto, LifecycleManifest)> {
    validate_project_path(db, project_id, project_path)?;
    let root = fs::canonicalize(project_path).context("resolve lifecycle project path")?;
    let manifest_path = root.join(LIFECYCLE_MANIFEST_PATH);
    let bytes = fs::read(&manifest_path).context("read .wheeljack/lifecycle.json")?;
    if bytes.len() > 256 * 1024 {
        bail!("lifecycle manifest exceeds the 256 KiB limit");
    }
    let manifest = serde_json::from_slice::<LifecycleManifest>(&bytes)
        .context("parse .wheeljack/lifecycle.json")?;
    if manifest.version != 1 {
        bail!(
            "unsupported lifecycle manifest version: {}",
            manifest.version
        );
    }
    validate_task(manifest.setup.as_ref(), "setup")?;
    validate_task(manifest.preview.as_ref(), "preview")?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let trusted = db
        .query_row(
            "SELECT manifest_hash = ?2 FROM project_lifecycle_trust WHERE project_id = ?1",
            params![project_id, hash],
            |row| row.get::<_, bool>(0),
        )
        .optional()?
        .unwrap_or(false);
    let dto = LifecycleManifestDto {
        path: manifest_path.to_string_lossy().to_string(),
        hash,
        trusted,
        version: manifest.version,
        setup: manifest.setup.clone(),
        preview: manifest.preview.clone(),
    };
    Ok((dto, manifest))
}

pub(crate) fn trust_lifecycle_manifest(
    db: &Connection,
    project_id: &str,
    expected_hash: &str,
    current: &LifecycleManifestDto,
) -> Result<()> {
    if current.hash != expected_hash {
        bail!("lifecycle manifest changed before it could be trusted");
    }
    db.execute(
        "INSERT INTO project_lifecycle_trust (project_id, manifest_hash, trusted_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(project_id) DO UPDATE SET manifest_hash = excluded.manifest_hash,
             trusted_at = excluded.trusted_at",
        params![project_id, expected_hash, now()],
    )?;
    Ok(())
}

pub(crate) fn lifecycle_task_command(task: &LifecycleTask, platform: &str) -> Result<Vec<String>> {
    let command = match platform {
        "windows" => task.windows.as_ref().or(task.command.as_ref()),
        "macos" => task.macos.as_ref().or(task.command.as_ref()),
        "linux" => task.linux.as_ref().or(task.command.as_ref()),
        _ => task.command.as_ref(),
    }
    .ok_or_else(|| anyhow!("lifecycle task has no command for {platform}"))?;
    if command.is_empty() || command[0].trim().is_empty() {
        bail!("lifecycle command must include an executable");
    }
    Ok(command.clone())
}

pub(crate) fn lifecycle_working_dir(root: &Path, task: &LifecycleTask) -> Result<PathBuf> {
    let cwd = task
        .cwd
        .as_deref()
        .map(|relative| root.join(relative))
        .unwrap_or_else(|| root.to_path_buf());
    let resolved = fs::canonicalize(&cwd).context("resolve lifecycle working directory")?;
    if !resolved.starts_with(root) {
        bail!("lifecycle working directory must stay inside the project");
    }
    Ok(resolved)
}

pub(crate) fn validate_lifecycle_preview_url(url: &str) -> Result<()> {
    let parsed = url::Url::parse(url).context("invalid lifecycle preview URL")?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || url.chars().any(char::is_control)
        || url.contains('\\')
    {
        bail!("lifecycle preview URL must use a loopback HTTP address");
    }
    Ok(())
}

pub(crate) fn probe_lifecycle_preview_url(url: &str) -> Result<()> {
    validate_lifecycle_preview_url(url)?;
    // Probe headers only, directly on loopback. Never follow a redirect or route
    // the request through a configured proxy, and bound an unresponsive server.
    let response = ureq::AgentBuilder::new()
        .try_proxy_from_env(false)
        .redirects(0)
        .timeout(Duration::from_millis(500))
        .build()
        .get(url)
        .call()
        .context("preview server is not ready")?;
    if !(200..300).contains(&response.status()) {
        bail!(
            "preview server returned HTTP {} instead of a page",
            response.status()
        );
    }
    Ok(())
}

pub(crate) fn load_lifecycle_runs(
    db: &Connection,
    project_id: &str,
    limit: usize,
) -> Result<Vec<LifecycleRunDto>> {
    let mut statement = db.prepare(
        "SELECT id, project_id, kind, state, command_json, url, pid, exit_code,
                error_message, started_at, updated_at, ended_at
         FROM project_lifecycle_runs WHERE project_id = ?1
         ORDER BY updated_at DESC LIMIT ?2",
    )?;
    let rows = statement.query_map(params![project_id, limit.min(100)], |row| {
        let command_json: String = row.get(4)?;
        let pid = row
            .get::<_, Option<i64>>(6)?
            .and_then(|value| u32::try_from(value).ok());
        Ok(LifecycleRunDto {
            id: row.get(0)?,
            project_id: row.get(1)?,
            kind: row.get(2)?,
            state: row.get(3)?,
            command: serde_json::from_str(&command_json).unwrap_or_default(),
            url: row.get(5)?,
            pid,
            exit_code: row.get(7)?,
            error_message: row.get(8)?,
            started_at: row.get(9)?,
            updated_at: row.get(10)?,
            ended_at: row.get(11)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub(crate) fn load_active_lifecycle_runs(
    db: &Connection,
    project_id: &str,
) -> Result<Vec<LifecycleRunDto>> {
    let mut statement = db.prepare(
        "SELECT id, project_id, kind, state, command_json, url, pid, exit_code,
                error_message, started_at, updated_at, ended_at
         FROM project_lifecycle_runs
         WHERE project_id = ?1 AND state IN ('starting', 'running', 'ready', 'stopping')
         ORDER BY updated_at DESC",
    )?;
    let rows = statement.query_map(params![project_id], |row| {
        let command_json: String = row.get(4)?;
        let pid = row
            .get::<_, Option<i64>>(6)?
            .and_then(|value| u32::try_from(value).ok());
        Ok(LifecycleRunDto {
            id: row.get(0)?,
            project_id: row.get(1)?,
            kind: row.get(2)?,
            state: row.get(3)?,
            command: serde_json::from_str(&command_json).unwrap_or_default(),
            url: row.get(5)?,
            pid,
            exit_code: row.get(7)?,
            error_message: row.get(8)?,
            started_at: row.get(9)?,
            updated_at: row.get(10)?,
            ended_at: row.get(11)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub(crate) fn load_lifecycle_logs(db: &Connection, run_id: &str) -> Result<String> {
    let mut statement = db.prepare(
        "SELECT data FROM (
           SELECT seq, data FROM project_lifecycle_chunks
           WHERE run_id = ?1 ORDER BY seq DESC LIMIT 4000
         ) ORDER BY seq ASC",
    )?;
    let rows = statement.query_map(params![run_id], |row| row.get::<_, Vec<u8>>(0))?;
    let mut output = String::new();
    for row in rows {
        output.push_str(&String::from_utf8_lossy(&row?));
    }
    Ok(output)
}

pub(crate) fn recover_lifecycle_runs(db: &Connection) -> Result<()> {
    let timestamp = now();
    db.execute(
        "UPDATE project_lifecycle_runs
         SET state = 'interrupted',
             error_message = 'wheeljack stopped while this process was running.',
             updated_at = ?1, ended_at = ?1
         WHERE state IN ('starting', 'running', 'ready', 'stopping')",
        params![timestamp],
    )?;
    Ok(())
}

fn validate_project_path(db: &Connection, project_id: &str, project_path: &str) -> Result<()> {
    let saved: String = db.query_row(
        "SELECT path FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get(0),
    )?;
    if fs::canonicalize(saved)? != fs::canonicalize(project_path)? {
        bail!("project path does not match the saved project");
    }
    Ok(())
}

fn validate_task(task: Option<&LifecycleTask>, name: &str) -> Result<()> {
    let Some(task) = task else {
        return Ok(());
    };
    for command in [&task.command, &task.windows, &task.macos, &task.linux]
        .into_iter()
        .flatten()
    {
        if command.len() > 128
            || command
                .iter()
                .any(|arg| arg.len() > 16_384 || arg.contains('\0'))
        {
            bail!("{name} lifecycle command is invalid");
        }
    }
    if task
        .env
        .keys()
        .any(|key| key.is_empty() || key.contains('=') || key.contains('\0'))
    {
        bail!("{name} lifecycle environment contains an invalid key");
    }
    if task
        .timeout_seconds
        .is_some_and(|timeout| timeout == 0 || timeout > 3600)
    {
        bail!("{name} lifecycle timeout must be between 1 and 3600 seconds");
    }
    Ok(())
}

pub(crate) fn spawn_lifecycle_log_reader<R: Read + Send + 'static>(
    db_path: PathBuf,
    run_id: String,
    stream: &'static str,
    mut reader: R,
    seq: Arc<AtomicU64>,
    events: Arc<dyn EventSink>,
    shutdown: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        while !shutdown.load(Ordering::SeqCst) {
            let count = match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => count,
            };
            let chunk = &buffer[..count];
            let next_seq = seq.fetch_add(1, Ordering::SeqCst) + 1;
            if let Ok(db) = open_app_connection(&db_path) {
                let _ = retry_sqlite_write(|| {
                    db.execute(
                        "INSERT INTO project_lifecycle_chunks
                         (run_id, seq, stream, data, created_at)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![run_id, next_seq, stream, chunk, now()],
                    )?;
                    db.execute(
                        "DELETE FROM project_lifecycle_chunks
                         WHERE run_id = ?1 AND seq <= ?2",
                        params![run_id, next_seq.saturating_sub(10_000)],
                    )?;
                    Ok(())
                });
            }
            events.emit(
                "lifecycle:log",
                &json!({
                    "runId": run_id,
                    "seq": next_seq,
                    "stream": stream,
                    "text": String::from_utf8_lossy(chunk),
                }),
            );
        }
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_lifecycle_waiter(
    db_path: PathBuf,
    run_id: String,
    project_id: String,
    kind: String,
    handle: LifecycleProcessHandle,
    log_readers: Vec<JoinHandle<()>>,
    processes: Arc<Mutex<HashMap<String, LifecycleProcessHandle>>>,
    timeout_seconds: Option<u64>,
    events: Arc<dyn EventSink>,
    shutdown: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let deadline = timeout_seconds.map(|seconds| Instant::now() + Duration::from_secs(seconds));
        let preview_url = if kind == "preview" {
            open_app_connection(&db_path).ok().and_then(|db| {
                db.query_row(
                    "SELECT url FROM project_lifecycle_runs WHERE id = ?1",
                    params![run_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .ok()
                .flatten()
            })
        } else {
            None
        };
        let mut next_probe = Instant::now();
        let mut direct_exit = None;
        let (mut state, exit_code, mut error_message) = loop {
            if shutdown.load(Ordering::SeqCst) {
                break (
                    "interrupted",
                    None,
                    Some("wheeljack is shutting down.".to_string()),
                );
            }
            if direct_exit.is_none() {
                direct_exit = handle
                    .child
                    .lock()
                    .ok()
                    .and_then(|mut child| child.try_wait().ok().flatten())
                    .map(|status| (status, Instant::now()));
            }
            if let Some((status, exited_at)) = direct_exit {
                let code = status.code();
                if log_readers.iter().all(JoinHandle::is_finished) {
                    break if status.success() {
                        ("completed", code, None)
                    } else {
                        (
                            "failed",
                            code,
                            Some(format!("Lifecycle process exited with {status}.")),
                        )
                    };
                }
                // Continue enforcing the task timeout while descendants retain
                // the output pipes. Tasks without a timeout still get a bounded
                // drain after their launcher exits.
                if deadline.is_none() && exited_at.elapsed() >= Duration::from_secs(2) {
                    break ("failed", code, Some("Lifecycle launcher exited while child processes still held its output pipes.".to_string()));
                }
            }
            if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                break (
                    "timed_out",
                    None,
                    Some("Lifecycle process exceeded its configured timeout.".to_string()),
                );
            }
            if direct_exit.is_none() && Instant::now() >= next_probe {
                if let Some(url) = preview_url.as_deref() {
                    let result = probe_lifecycle_preview_url(url);
                    let (state, error) = match result {
                        Ok(()) => ("ready", None),
                        Err(error) => ("running", Some(format!("Waiting for preview: {error:#}"))),
                    };
                    if let Ok(db) = open_app_connection(&db_path) {
                        let changed = db.execute(
                            "UPDATE project_lifecycle_runs SET state = ?2, error_message = ?3, updated_at = ?4
                             WHERE id = ?1 AND state IN ('running', 'ready') AND (state != ?2 OR error_message IS NOT ?3)",
                            params![run_id, state, error, now()],
                        ).unwrap_or(0);
                        if changed > 0 {
                            if let Ok(runs) = load_active_lifecycle_runs(&db, &project_id) {
                                if let Some(run) = runs.into_iter().find(|run| run.id == run_id) {
                                    events.emit("lifecycle:state", &json!(run));
                                }
                            }
                        }
                    }
                }
                next_probe = Instant::now() + Duration::from_millis(500);
            }
            thread::sleep(Duration::from_millis(50));
        };
        if let Ok(mut child) = handle.child.lock() {
            if let Err(error) = kill_structured_process(&mut child, &handle.process_tree) {
                state = "failed";
                error_message = Some(format!("Could not stop lifecycle process tree: {error:#}"));
            }
        }
        // A terminal run state is the durable completion boundary. Drain both
        // output pipes first so callers that observe completion can also read
        // every log chunk produced by the process.
        let drain_deadline = Instant::now() + Duration::from_secs(2);
        while log_readers.iter().any(|reader| !reader.is_finished())
            && Instant::now() < drain_deadline
        {
            thread::sleep(Duration::from_millis(10));
        }
        for reader in log_readers {
            if reader.is_finished() {
                let _ = reader.join();
            } else {
                error_message = Some("Lifecycle output did not close after its process tree was stopped; trailing logs may be incomplete.".to_string());
                if state == "completed" {
                    state = "failed";
                }
            }
        }
        if let Ok(mut processes) = processes.lock() {
            processes.remove(&run_id);
        }
        if let Ok(db) = open_app_connection(&db_path) {
            let requested_state = db
                .query_row(
                    "SELECT state FROM project_lifecycle_runs WHERE id = ?1",
                    params![run_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .ok()
                .flatten();
            if requested_state.as_deref() == Some("stopping") {
                state = "canceled";
                error_message = None;
            }
            let timestamp = now();
            let _ = db.execute(
                "UPDATE project_lifecycle_runs
                 SET state = ?2, exit_code = ?3, error_message = ?4,
                     updated_at = ?5, ended_at = ?5 WHERE id = ?1",
                params![run_id, state, exit_code, error_message, timestamp],
            );
            if let Ok(run) = load_lifecycle_runs(&db, &project_id, 20).and_then(|runs| {
                runs.into_iter()
                    .find(|run| run.id == run_id)
                    .ok_or_else(|| anyhow!("lifecycle run is missing"))
            }) {
                events.emit("lifecycle:state", &json!(run));
            }
        } else {
            events.emit(
                "lifecycle:state",
                &json!({ "id": run_id, "projectId": project_id, "kind": kind, "state": state }),
            );
        }
    })
}
