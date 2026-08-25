use super::*;

pub(crate) const LATEST_SCHEMA_VERSION: i32 = 19;
type Migration = (i32, fn(&Connection) -> Result<()>);
const SQLITE_WRITE_RETRY_DELAYS: [Duration; 3] = [
    Duration::from_millis(25),
    Duration::from_millis(75),
    Duration::from_millis(150),
];

pub(crate) fn migrate_app_data(paths: &CorePaths) -> Result<bool> {
    fs::create_dir_all(&paths.app_data_dir).context("create migration destination dir")?;
    let marker_path = paths.app_data_dir.join(MIGRATION_MARKER_FILE);
    let dest_db = paths.db_path();
    if dest_db.exists() {
        write_migration_marker(&marker_path, None, false)?;
        return Ok(false);
    }

    let staging_db = paths
        .app_data_dir
        .join(format!(".{DB_FILE_NAME}.migrating"));
    if staging_db.exists() {
        fs::remove_file(&staging_db)
            .context("remove interrupted database migration staging file")?;
    }

    let mut sources = vec![(
        paths.app_data_dir.clone(),
        paths.app_data_dir.join(LEGACY_DB_FILE_NAME),
    )];
    for source_dir in &paths.old_app_data_dirs {
        sources.push((source_dir.clone(), source_dir.join(DB_FILE_NAME)));
        sources.push((source_dir.clone(), source_dir.join(LEGACY_DB_FILE_NAME)));
    }

    for (source_dir, source_db) in sources {
        if !source_db.exists() || same_path(&source_db, &dest_db) {
            continue;
        }

        copy_sqlite_database(&source_db, &staging_db)?;
        validate_database(&staging_db)?;
        fs::copy(
            &staging_db,
            paths
                .app_data_dir
                .join(format!("{DB_FILE_NAME}.pre-native.bak")),
        )
        .context("write pre-native database backup")?;
        if !same_path(&source_dir, &paths.app_data_dir) {
            copy_known_data_dirs(&source_dir, &paths.app_data_dir)?;
        }
        fs::rename(&staging_db, &dest_db).context("atomically promote migrated database")?;
        write_migration_marker(&marker_path, Some(&source_db), true)?;
        return Ok(true);
    }

    write_migration_marker(&marker_path, None, false)?;
    Ok(false)
}

fn copy_sqlite_database(source_path: &Path, destination_path: &Path) -> Result<()> {
    let source = Connection::open_with_flags(
        source_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .with_context(|| format!("open legacy sqlite database at {}", source_path.display()))?;
    backup_connection(&source, destination_path)
}

fn backup_connection(source: &Connection, destination_path: &Path) -> Result<()> {
    let mut destination = Connection::open(destination_path)
        .with_context(|| format!("create sqlite backup at {}", destination_path.display()))?;
    let backup = rusqlite::backup::Backup::new(source, &mut destination)?;
    backup.run_to_completion(64, Duration::from_millis(10), None)?;
    drop(backup);
    destination.close().map_err(|(_, error)| error)?;
    Ok(())
}

pub(crate) fn export_database_backup(
    source: &Connection,
    source_path: &Path,
    destination_path: &Path,
) -> Result<()> {
    if !destination_path.is_absolute() {
        bail!("backup destination path must be absolute");
    }
    if same_path(source_path, destination_path) {
        bail!("backup destination cannot be the live wheeljack database");
    }
    if destination_path.exists() {
        bail!(
            "backup destination already exists: {}",
            destination_path.display()
        );
    }
    let parent = destination_path
        .parent()
        .filter(|path| path.is_dir())
        .ok_or_else(|| anyhow!("backup destination directory does not exist"))?;
    let file_name = destination_path
        .file_name()
        .ok_or_else(|| anyhow!("backup destination must be a file path"))?;
    let staging_path = parent.join(format!(
        ".{}.{}.tmp",
        file_name.to_string_lossy(),
        Uuid::now_v7()
    ));

    let mut destination_created = false;
    let result = (|| -> Result<()> {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging_path)
            .with_context(|| format!("reserve backup staging path {}", staging_path.display()))?;
        backup_connection(source, &staging_path)?;
        validate_database(&staging_path)?;

        if fs::hard_link(&staging_path, destination_path).is_ok() {
            destination_created = true;
        } else {
            let mut input = fs::File::open(&staging_path)?;
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(destination_path)
                .with_context(|| {
                    format!(
                        "create backup destination without overwriting {}",
                        destination_path.display()
                    )
                })?;
            destination_created = true;
            if let Err(error) =
                std::io::copy(&mut input, &mut output).and_then(|_| output.sync_all())
            {
                drop(output);
                let _ = fs::remove_file(destination_path);
                return Err(error).context("write backup destination");
            }
        }
        validate_database(destination_path)?;
        Ok(())
    })();

    let _ = fs::remove_file(&staging_path);
    if result.is_err() && destination_created {
        let _ = fs::remove_file(destination_path);
    }
    result
}

fn validate_database(path: &Path) -> Result<()> {
    let connection = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let result: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if result != "ok" {
        bail!("sqlite quick_check failed for {}: {result}", path.display());
    }
    Ok(())
}

pub(crate) fn open_app_connection(path: &Path) -> Result<Connection> {
    let connection = Connection::open(path)
        .with_context(|| format!("open sqlite database at {}", path.display()))?;
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    Ok(connection)
}

pub(crate) fn retry_sqlite_write<T>(mut write: impl FnMut() -> Result<T>) -> Result<T> {
    let mut attempt = 0;
    loop {
        match write() {
            Err(error)
                if sqlite_lock_error(&error) && attempt < SQLITE_WRITE_RETRY_DELAYS.len() =>
            {
                thread::sleep(SQLITE_WRITE_RETRY_DELAYS[attempt]);
                attempt += 1;
            }
            result => return result,
        }
    }
}

fn sqlite_lock_error(error: &anyhow::Error) -> bool {
    error.chain().any(|source| {
        source
            .downcast_ref::<rusqlite::Error>()
            .and_then(rusqlite::Error::sqlite_error_code)
            .is_some_and(|code| {
                matches!(
                    code,
                    rusqlite::ffi::ErrorCode::DatabaseBusy
                        | rusqlite::ffi::ErrorCode::DatabaseLocked
                )
            })
    })
}

fn write_migration_marker(marker_path: &Path, source: Option<&Path>, migrated: bool) -> Result<()> {
    if marker_path.exists() {
        return Ok(());
    }
    let marker = json!({
        "migrated": migrated,
        "source": source.map(|path| path.to_string_lossy().to_string()),
        "createdAt": now()
    });
    let temp_path = marker_path.with_extension("json.tmp");
    fs::write(&temp_path, serde_json::to_vec_pretty(&marker)?)?;
    fs::rename(temp_path, marker_path)?;
    Ok(())
}

fn copy_known_data_dirs(source_dir: &Path, dest_dir: &Path) -> Result<()> {
    for name in ["windows-ui-v1.json", "windows-ui-v1.json.bak"] {
        let source = source_dir.join(name);
        let target = dest_dir.join(name);
        if source.is_file() && !target.exists() {
            fs::copy(source, target)?;
        }
    }

    Ok(())
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

pub(crate) fn run_migrations(connection: &Connection) -> Result<()> {
    let current_version: i32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if current_version > LATEST_SCHEMA_VERSION {
        bail!(
            "database schema version {current_version} is newer than supported version {LATEST_SCHEMA_VERSION}"
        );
    }
    let migrations: &[Migration] = &[
        (1, create_base_schema),
        (2, add_canvas_sort_index),
        (3, add_session_events),
        (4, add_canvas_layouts),
        (5, add_adapter_verifications),
        (6, add_adapter_verification_timestamp),
        (7, add_project_archival),
        (8, add_adapter_verification_profile),
        (9, add_project_identity),
        (10, add_project_agent_access),
        (11, remove_duplicate_agent_chat),
        (12, add_ops_runtime),
        (13, add_canvas_layout_mode),
        (14, add_usage_ledger),
        (15, add_bot_profiles),
        (16, migrate_interim_bot_profiles),
        (17, add_session_node_title),
        (18, add_project_ops_state),
        (LATEST_SCHEMA_VERSION, repair_legacy_recovery_state),
    ];
    for (version, migration) in migrations {
        if current_version >= *version {
            continue;
        }
        let tx = connection.unchecked_transaction()?;
        migration(&tx)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }
    Ok(())
}

fn create_base_schema(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_opened_at TEXT,
          archived_at TEXT,
          icon TEXT NOT NULL DEFAULT 'folder',
          icon_color TEXT NOT NULL DEFAULT '#7E7E7E',
          agent_access TEXT NOT NULL DEFAULT 'default'
        );

        CREATE TABLE IF NOT EXISTS canvases (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          theme_id TEXT NOT NULL DEFAULT 'mono-dark',
          camera_json TEXT NOT NULL,
          sort_index INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY,
          canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          x REAL NOT NULL,
          y REAL NOT NULL,
          width REAL NOT NULL,
          height REAL NOT NULL,
          z_index INTEGER NOT NULL,
          data_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS canvas_layouts (
          canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
          surface TEXT NOT NULL,
          version INTEGER NOT NULL,
          layout_mode TEXT NOT NULL DEFAULT 'manual',
          layout_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (canvas_id, surface)
        );

        CREATE TABLE IF NOT EXISTS edges (
          id TEXT PRIMARY KEY,
          canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
          source_node_id TEXT NOT NULL,
          target_node_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          data_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_nodes_canvas_z
        ON nodes(canvas_id, z_index);

        CREATE INDEX IF NOT EXISTS idx_edges_canvas_created
        ON edges(canvas_id, created_at);

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          node_id TEXT NOT NULL,
          node_title TEXT NOT NULL DEFAULT '',
          adapter_id TEXT NOT NULL,
          command_json TEXT NOT NULL,
          cwd TEXT NOT NULL,
          status TEXT NOT NULL,
          pid INTEGER,
          started_at TEXT,
          ended_at TEXT,
          exit_code INTEGER,
          exit_signal TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_node_started
        ON sessions(node_id, started_at DESC, created_at DESC);

        CREATE TABLE IF NOT EXISTS session_chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          stream TEXT NOT NULL,
          data BLOB NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_session_chunks_session_seq
        ON session_chunks(session_id, seq);

        CREATE VIRTUAL TABLE IF NOT EXISTS session_chunks_fts
        USING fts5(session_id UNINDEXED, data);

        INSERT INTO session_chunks_fts(rowid, session_id, data)
        SELECT c.id, c.session_id, CAST(c.data AS TEXT)
        FROM session_chunks c
        WHERE NOT EXISTS (
          SELECT 1 FROM session_chunks_fts f WHERE f.rowid = c.id
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS adapter_configs (
          id TEXT PRIMARY KEY,
          manifest_json TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS session_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          message TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL DEFAULT '{}',
          is_read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          UNIQUE(session_id, seq)
        );

        CREATE INDEX IF NOT EXISTS idx_session_events_activity
        ON session_events(is_read, created_at DESC, id DESC);
        "#,
    )?;
    Ok(())
}

fn add_canvas_sort_index(connection: &Connection) -> Result<()> {
    ensure_table_column(connection, "canvases", "sort_index", "INTEGER")?;
    backfill_canvas_sort_indexes(connection)?;
    Ok(())
}

fn add_session_events(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS session_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          message TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL DEFAULT '{}',
          is_read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          UNIQUE(session_id, seq)
        );
        CREATE INDEX IF NOT EXISTS idx_session_events_activity
        ON session_events(is_read, created_at DESC, id DESC);
        "#,
    )?;
    connection.execute(
        "UPDATE canvases SET sort_index = 0 WHERE sort_index IS NULL",
        [],
    )?;
    Ok(())
}

fn add_canvas_layouts(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS canvas_layouts (
          canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
          surface TEXT NOT NULL,
          version INTEGER NOT NULL,
          layout_mode TEXT NOT NULL DEFAULT 'manual',
          layout_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (canvas_id, surface)
        );
        "#,
    )?;
    Ok(())
}

fn add_canvas_layout_mode(connection: &Connection) -> Result<()> {
    let layouts_exist: bool = connection.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'canvas_layouts'
         )",
        [],
        |row| row.get(0),
    )?;
    if !layouts_exist {
        return Ok(());
    }
    ensure_table_column(
        connection,
        "canvas_layouts",
        "layout_mode",
        "TEXT NOT NULL DEFAULT 'manual'",
    )
}

fn add_usage_ledger(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS usage_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          source_event_key TEXT NOT NULL,
          adapter_id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model_id TEXT,
          node_id TEXT NOT NULL,
          node_title TEXT NOT NULL,
          project_id TEXT,
          project_name TEXT,
          cwd TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0 CHECK(input_tokens >= 0),
          output_tokens INTEGER NOT NULL DEFAULT 0 CHECK(output_tokens >= 0),
          reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK(reasoning_tokens >= 0),
          cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK(cache_read_tokens >= 0),
          cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK(cache_write_tokens >= 0),
          source_total_tokens INTEGER CHECK(source_total_tokens >= 0),
          cost_nano_usd INTEGER CHECK(cost_nano_usd >= 0),
          cost_source TEXT NOT NULL CHECK(cost_source IN ('cli_reported', 'unpriced')),
          billing_classification TEXT NOT NULL CHECK(billing_classification IN ('metered', 'subscription', 'unknown')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(session_id, source_event_key)
        );

        CREATE INDEX IF NOT EXISTS idx_usage_records_occurred
        ON usage_records(occurred_at DESC, id DESC);

        CREATE INDEX IF NOT EXISTS idx_usage_records_dimensions
        ON usage_records(adapter_id, provider_id, model_id, project_id);

        CREATE TABLE IF NOT EXISTS usage_session_context (
          session_id TEXT PRIMARY KEY,
          auth_classification TEXT NOT NULL DEFAULT 'unknown'
            CHECK(auth_classification IN ('metered', 'subscription', 'unknown')),
          auth_source TEXT,
          provider_id TEXT,
          model_id TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS usage_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        "#,
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO usage_meta (key, value) VALUES ('tracking_started_at', ?1)",
        params![now()],
    )?;
    Ok(())
}

fn add_adapter_verifications(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS adapter_verifications (
          adapter_id TEXT PRIMARY KEY,
          executable_path TEXT NOT NULL,
          version TEXT,
          verified_at TEXT NOT NULL
        );
        "#,
    )?;
    Ok(())
}

fn add_adapter_verification_timestamp(connection: &Connection) -> Result<()> {
    ensure_table_column(
        connection,
        "adapter_verifications",
        "verified_at",
        "TEXT NOT NULL DEFAULT ''",
    )
}

fn add_project_archival(connection: &Connection) -> Result<()> {
    let projects_exist: bool = connection.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects'
         )",
        [],
        |row| row.get(0),
    )?;
    if !projects_exist {
        return Ok(());
    }
    ensure_table_column(connection, "projects", "archived_at", "TEXT")
}

fn remove_duplicate_agent_chat(connection: &Connection) -> Result<()> {
    let nodes_exist: bool = connection.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'nodes'
         )",
        [],
        |row| row.get(0),
    )?;
    if !nodes_exist {
        return Ok(());
    }
    let rows = {
        let mut statement =
            connection.prepare("SELECT id, data_json FROM nodes WHERE kind = 'agent_terminal'")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (node_id, data_json) in rows {
        let mut data = serde_json::from_str::<Value>(&data_json)?;
        let Some(object) = data.as_object_mut() else {
            continue;
        };
        if object.remove("chatMessages").is_some() {
            connection.execute(
                "UPDATE nodes SET data_json = ?1 WHERE id = ?2",
                params![data.to_string(), node_id],
            )?;
        }
    }
    Ok(())
}

fn add_ops_runtime(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS ops_states (
          canvas_id TEXT PRIMARY KEY REFERENCES canvases(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL,
          state_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ops_states_project
        ON ops_states(project_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS ops_scheduler_configs (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
          enabled INTEGER NOT NULL DEFAULT 0,
          paused INTEGER NOT NULL DEFAULT 1,
          concurrency_limit INTEGER NOT NULL DEFAULT 4,
          adapter_id TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ops_task_leases (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL,
          state TEXT NOT NULL,
          owner_id TEXT,
          adapter_id TEXT,
          leased_at TEXT NOT NULL,
          claimed_at TEXT,
          expires_at TEXT NOT NULL,
          finished_at TEXT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_task_active_lease
        ON ops_task_leases(project_id, task_id)
        WHERE state IN ('pending', 'claimed');

        CREATE INDEX IF NOT EXISTS idx_ops_task_lease_expiry
        ON ops_task_leases(state, expires_at);
        "#,
    )?;
    let legacy_tables_exist: bool = connection.query_row(
        "SELECT
           EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'nodes')
           AND EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'canvases')",
        [],
        |row| row.get(0),
    )?;
    if legacy_tables_exist {
        connection.execute_batch(
            r#"
            INSERT OR IGNORE INTO ops_states (canvas_id, project_id, revision, state_json, updated_at)
            SELECT n.canvas_id, c.project_id, 1, n.data_json, n.updated_at
            FROM nodes n
            JOIN canvases c ON c.id = n.canvas_id
            WHERE n.kind = 'ops_state';

            DELETE FROM nodes WHERE kind = 'ops_state';
            "#,
        )?;
    }
    Ok(())
}

fn add_project_ops_state(connection: &Connection) -> Result<()> {
    let source_tables_exist: bool = connection.query_row(
        "SELECT
           EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects')
           AND EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ops_states')",
        [],
        |row| row.get(0),
    )?;
    if !source_tables_exist {
        return Ok(());
    }
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS ops_project_states (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL,
          state_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT OR IGNORE INTO ops_project_states (project_id, revision, state_json, updated_at)
        SELECT current.project_id, current.revision, current.state_json, current.updated_at
        FROM ops_states current
        WHERE current.rowid = (
          SELECT candidate.rowid FROM ops_states candidate
          WHERE candidate.project_id = current.project_id
          ORDER BY candidate.updated_at DESC, candidate.revision DESC, candidate.rowid DESC
          LIMIT 1
        );
        "#,
    )?;
    Ok(())
}

fn repair_legacy_recovery_state(connection: &Connection) -> Result<()> {
    let repaired_at = now();
    let fixture_updated_at = if table_exists(connection, "adapter_configs")? {
        connection
            .query_row(
                "SELECT updated_at FROM adapter_configs WHERE id = 'wheeljack-ui-fixture'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
    } else {
        None
    };

    if let Some(fixture_updated_at) = fixture_updated_at {
        let adapters = {
            let mut statement = connection.prepare(
                "SELECT id, manifest_json
                 FROM adapter_configs
                 WHERE id IN ('claude-code', 'codex-cli', 'opencode', 'pi-coding-agent')
                   AND enabled = 0
                   AND ABS((julianday(updated_at) - julianday(?1)) * 86400) <= 30",
            )?;
            let rows = statement.query_map([&fixture_updated_at], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for (adapter_id, manifest_json) in adapters {
            let mut manifest = serde_json::from_str::<Value>(&manifest_json)?;
            if let Some(object) = manifest.as_object_mut() {
                object.insert("enabled".to_string(), Value::Bool(true));
            }
            connection.execute(
                "UPDATE adapter_configs
                 SET manifest_json = ?1, enabled = 1, updated_at = ?2
                 WHERE id = ?3",
                params![manifest.to_string(), repaired_at, adapter_id],
            )?;
        }

        if table_exists(connection, "projects")? {
            let smoke_projects = {
                let mut statement = connection.prepare("SELECT id, path FROM projects")?;
                let rows = statement.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            };
            for (project_id, project_path) in smoke_projects {
                if is_ui_smoke_project_path(&project_path) {
                    connection.execute("DELETE FROM projects WHERE id = ?1", [project_id])?;
                }
            }
        }

        if table_exists(connection, "adapter_verifications")? {
            connection.execute(
                "DELETE FROM adapter_verifications WHERE adapter_id = 'wheeljack-ui-fixture'",
                [],
            )?;
        }
        connection.execute(
            "DELETE FROM adapter_configs WHERE id = 'wheeljack-ui-fixture'",
            [],
        )?;
    }

    if !table_exists(connection, "ops_project_states")? {
        return Ok(());
    }
    let states = {
        let mut statement =
            connection.prepare("SELECT project_id, state_json FROM ops_project_states")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (project_id, state_json) in states {
        let mut state = serde_json::from_str::<Value>(&state_json)?;
        let Some(cards) = state.get_mut("cards").and_then(Value::as_array_mut) else {
            continue;
        };
        let mut changed = false;
        for card in cards {
            if !is_legacy_recovery_card(card) {
                continue;
            }
            let Some(card) = card.as_object_mut() else {
                continue;
            };
            card.insert(
                "assignee".to_string(),
                Value::String("Unassigned".to_string()),
            );
            card.insert("assigneeIds".to_string(), json!([]));
            card.insert("agentStatuses".to_string(), json!({}));
            card.remove("reviewerId");
            card.remove("retryAt");
            card.insert(
                "reconciliation".to_string(),
                json!({
                    "status": "awaiting_repair",
                    "attempts": 0,
                    "message": "Legacy evidence awaits project recovery.",
                    "updatedAt": repaired_at,
                    "reason": "legacy_recovery"
                }),
            );
            if let Some(task_lane) = card.get_mut("taskLane").and_then(Value::as_object_mut) {
                task_lane.remove("cleanup");
            }
            changed = true;
        }
        if changed {
            connection.execute(
                "UPDATE ops_project_states
                 SET revision = revision + 1, state_json = ?1, updated_at = ?2
                 WHERE project_id = ?3",
                params![state.to_string(), repaired_at, project_id],
            )?;
        }
    }
    Ok(())
}

fn is_ui_smoke_project_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/").to_ascii_lowercase();
    normalized.ends_with("/project")
        && (normalized.contains("/appdata/local/temp/wheeljack-runtime-")
            || normalized.contains("/appdata/local/temp/wheeljack-tauri-runtime-smoke-"))
}

fn is_legacy_recovery_card(card: &Value) -> bool {
    let reconciliation = &card["reconciliation"];
    let message = reconciliation["message"].as_str();
    reconciliation["status"] == "retrying"
        && reconciliation["reason"] == "error"
        && card["report"]["status"] == "reported"
        && card["taskLane"].is_object()
        && matches!(
            message,
            Some("Task worktree is not registered with this repository.")
                | Some("The reconciliation repair agent could not be resumed or restarted.")
        )
}

fn add_project_identity(connection: &Connection) -> Result<()> {
    let projects_exist: bool = connection.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects'
         )",
        [],
        |row| row.get(0),
    )?;
    if !projects_exist {
        return Ok(());
    }
    ensure_table_column(
        connection,
        "projects",
        "icon",
        "TEXT NOT NULL DEFAULT 'folder'",
    )?;
    ensure_table_column(
        connection,
        "projects",
        "icon_color",
        "TEXT NOT NULL DEFAULT '#7E7E7E'",
    )
}

fn add_project_agent_access(connection: &Connection) -> Result<()> {
    let projects_exist: bool = connection.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects'
         )",
        [],
        |row| row.get(0),
    )?;
    if !projects_exist {
        return Ok(());
    }
    ensure_table_column(
        connection,
        "projects",
        "agent_access",
        "TEXT NOT NULL DEFAULT 'default'",
    )
}

fn add_adapter_verification_profile(connection: &Connection) -> Result<()> {
    ensure_table_column(
        connection,
        "adapter_verifications",
        "verified_args_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_table_column(
        connection,
        "adapter_verifications",
        "launch_fingerprint",
        "TEXT NOT NULL DEFAULT ''",
    )
}

fn add_bot_profiles(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS bot_profiles (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          role_description TEXT NOT NULL,
          avatar_seed TEXT NOT NULL,
          launch_json TEXT NOT NULL,
          launch_count INTEGER NOT NULL DEFAULT 0 CHECK (launch_count >= 0),
          last_used_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            (scope = 'global' AND project_id IS NULL) OR
            (scope = 'project' AND project_id IS NOT NULL)
          )
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_profiles_scope_name
        ON bot_profiles(scope, COALESCE(project_id, ''), name COLLATE NOCASE);

        CREATE INDEX IF NOT EXISTS idx_bot_profiles_project_updated
        ON bot_profiles(project_id, updated_at DESC);

        ALTER TABLE adapter_verifications RENAME TO adapter_verifications_v14;

        CREATE TABLE adapter_verifications (
          adapter_id TEXT NOT NULL,
          executable_path TEXT NOT NULL,
          version TEXT,
          verified_at TEXT NOT NULL,
          verified_args_json TEXT NOT NULL DEFAULT '[]',
          launch_fingerprint TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (adapter_id, launch_fingerprint)
        );

        INSERT OR REPLACE INTO adapter_verifications
          (adapter_id, executable_path, version, verified_at, verified_args_json, launch_fingerprint)
        SELECT adapter_id, executable_path, version, verified_at, verified_args_json, launch_fingerprint
        FROM adapter_verifications_v14;

        DROP TABLE adapter_verifications_v14;
        "#,
    )?;
    Ok(())
}

fn migrate_interim_bot_profiles(connection: &Connection) -> Result<()> {
    let has_legacy_table = table_exists(connection, "coworker_profiles")?;
    let has_bot_table = table_exists(connection, "bot_profiles")?;

    if has_legacy_table && has_bot_table {
        bail!(
            "database contains both coworker_profiles and bot_profiles; refusing to merge profile data automatically"
        );
    }

    if has_legacy_table {
        connection.execute_batch(
            r#"
            ALTER TABLE coworker_profiles RENAME TO bot_profiles;
            DROP INDEX IF EXISTS idx_coworker_profiles_scope_name;
            DROP INDEX IF EXISTS idx_coworker_profiles_project_updated;
            "#,
        )?;
    }

    connection.execute_batch(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_profiles_scope_name
        ON bot_profiles(scope, COALESCE(project_id, ''), name COLLATE NOCASE);

        CREATE INDEX IF NOT EXISTS idx_bot_profiles_project_updated
        ON bot_profiles(project_id, updated_at DESC);
        "#,
    )?;
    Ok(())
}

fn add_session_node_title(connection: &Connection) -> Result<()> {
    if !table_exists(connection, "sessions")? {
        return Ok(());
    }
    ensure_table_column(
        connection,
        "sessions",
        "node_title",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    connection.execute(
        "UPDATE sessions
         SET node_title = COALESCE(
           (SELECT title FROM nodes WHERE nodes.id = sessions.node_id),
           node_title
         )
         WHERE node_title = ''",
        [],
    )?;
    Ok(())
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool> {
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn ensure_table_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<()> {
    let mut stmt = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if columns.iter().any(|name| name == column) {
        return Ok(());
    }
    connection.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )?;
    Ok(())
}

fn backfill_canvas_sort_indexes(connection: &Connection) -> Result<()> {
    let project_ids = {
        let mut stmt =
            connection.prepare("SELECT id FROM projects ORDER BY created_at ASC, id ASC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for project_id in project_ids {
        let canvas_ids = {
            let mut stmt = connection.prepare(
                "SELECT id FROM canvases
                 WHERE project_id = ?1
                 ORDER BY sort_index ASC, created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map(params![project_id], |row| row.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for (sort_index, canvas_id) in canvas_ids.iter().enumerate() {
            connection.execute(
                "UPDATE canvases SET sort_index = ?1 WHERE id = ?2",
                params![sort_index as i64, canvas_id],
            )?;
        }
    }
    Ok(())
}

pub(crate) fn recover_interrupted_sessions(connection: &Connection) -> Result<usize> {
    let interrupted = load_running_session_node_pairs(connection)?;
    if interrupted.is_empty() {
        return Ok(0);
    }

    let timestamp = now();
    connection.execute(
        "UPDATE sessions
         SET status = 'disconnected', ended_at = ?1, updated_at = ?1
         WHERE status = 'running'",
        params![timestamp],
    )?;

    for (session_id, _) in &interrupted {
        append_session_event(
            connection,
            session_id,
            "lifecycle",
            "disconnected",
            "Session disconnected after app restart.",
            &json!({}),
        )?;
    }

    let session_ids = interrupted
        .iter()
        .map(|(session_id, _)| session_id.as_str())
        .collect::<Vec<_>>();
    let node_ids = interrupted
        .iter()
        .map(|(_, node_id)| node_id.as_str())
        .collect::<Vec<_>>();
    mark_nodes_disconnected(connection, &session_ids, &node_ids)?;
    Ok(interrupted.len())
}

pub(crate) fn append_session_event(
    connection: &Connection,
    session_id: &str,
    kind: &str,
    status: &str,
    message: &str,
    payload: &Value,
) -> rusqlite::Result<(i64, i64, String)> {
    let seq = connection.query_row(
        "SELECT COALESCE(MAX(seq), 0) + 1 FROM session_events WHERE session_id = ?1",
        params![session_id],
        |row| row.get::<_, i64>(0),
    )?;
    let created_at = now();
    connection.execute(
        "INSERT INTO session_events
         (session_id, seq, kind, status, message, payload_json, is_read, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
        params![
            session_id,
            seq,
            kind,
            status,
            message,
            payload.to_string(),
            created_at
        ],
    )?;
    Ok((connection.last_insert_rowid(), seq, created_at))
}

fn load_running_session_node_pairs(connection: &Connection) -> Result<Vec<(String, String)>> {
    let mut stmt =
        connection.prepare("SELECT id, node_id FROM sessions WHERE status = 'running'")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn mark_nodes_disconnected(
    connection: &Connection,
    session_ids: &[&str],
    node_ids: &[&str],
) -> Result<()> {
    let mut stmt = connection.prepare(
        "SELECT id, data_json FROM nodes WHERE kind IN ('agent_terminal', 'shell_terminal')",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let marker = "pty -> session disconnected after app restart";

    for row in rows {
        let (node_id, data_json) = row?;
        let mut data = serde_json::from_str::<Value>(&data_json).unwrap_or_else(|_| json!({}));
        let session_id = data
            .get("sessionId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if !session_ids.contains(&session_id.as_str()) && !node_ids.contains(&node_id.as_str()) {
            continue;
        }
        data["status"] = json!("disconnected");
        if !session_id.is_empty() {
            data["lastSessionId"] = json!(session_id);
        }
        if let Some(object) = data.as_object_mut() {
            object.remove("sessionId");
        }
        if let Some(transcript) = data.get_mut("transcript").and_then(Value::as_array_mut) {
            let has_marker = transcript
                .iter()
                .any(|item| item.as_str().map(|value| value == marker).unwrap_or(false));
            if !has_marker {
                transcript.push(json!(""));
                transcript.push(json!(marker));
            }
        } else {
            data["transcript"] = json!(["", marker]);
        }
        connection.execute(
            "UPDATE nodes SET data_json = ?1, updated_at = ?2 WHERE id = ?3",
            params![data.to_string(), now(), node_id],
        )?;
    }
    Ok(())
}
