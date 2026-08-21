use super::support::*;
use crate::*;

#[test]
fn recovers_running_sessions_as_disconnected() {
    let init = test_init("recover");
    fs::create_dir_all(&init.app_data_dir).unwrap();
    let db = Connection::open(init.app_data_dir.join(DB_FILE_NAME)).unwrap();
    run_migrations(&db).unwrap();
    db.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at)
             VALUES ('project_main', 'wheeljack', '.', 'now', 'now')",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO canvases (id, project_id, name, theme_id, camera_json, created_at, updated_at)
             VALUES ('canvas_main', 'project_main', 'Main', 'default', '{}', 'now', 'now')",
        [],
    )
    .unwrap();
    db.execute(
            "INSERT INTO nodes (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
             VALUES ('node_1', 'canvas_main', 'shell_terminal', 'Shell', 0, 0, 1, 1, 0, '{\"sessionId\":\"session_1\",\"status\":\"running\",\"transcript\":[]}', 'now', 'now')",
            [],
        )
        .unwrap();
    db.execute(
            "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, created_at, updated_at)
             VALUES ('session_1', 'node_1', 'shell', '{}', '.', 'running', 'now', 'now')",
            [],
        )
        .unwrap();
    drop(db);

    let core = Core::new(init, Arc::new(NullEventSink)).unwrap();
    assert_eq!(core.recovered_sessions, 1);
    let db = core.lock_db().unwrap();
    let status: String = db
        .query_row(
            "SELECT status FROM sessions WHERE id = 'session_1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(status, "disconnected");
}

#[test]
fn smoke_recovery_command_marks_interrupted_session_disconnected() {
    let mut init = test_init("smoke-recover");
    init.test_mode = true;
    let core = Core::new(init, Arc::new(NullEventSink)).unwrap();
    let request = json!({
        "id": "recover",
        "command": "smoke_recover_interrupted_session",
        "payload": {}
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();

    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["recoveredSessions"], 1);
    assert_eq!(response["payload"]["sessionStatus"], "disconnected");
    assert_eq!(response["payload"]["nodeStatus"], "disconnected");
    assert!(response["payload"]["transcriptText"]
        .as_str()
        .unwrap()
        .contains("session disconnected after app restart"));

    let projects: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"projects","command":"project_list","payload":{}}"#),
    )
    .unwrap();
    let project_id = projects["payload"][0]["id"].as_str().unwrap();
    assert!(std::path::Path::new(projects["payload"][0]["path"].as_str().unwrap()).is_dir());
    let canvases: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "canvases",
                "command": "canvas_list_project",
                "payload": { "projectId": project_id }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(canvases["ok"], true);
    assert_eq!(canvases["payload"].as_array().unwrap().len(), 1);
    assert_eq!(canvases["payload"][0]["nodes"].as_array().unwrap().len(), 1);
    assert!(canvases["payload"][0]["nodes"][0]["data"]
        .get("sessionId")
        .is_none());
    assert!(canvases["payload"][0]["nodes"][0]["data"]["lastSessionId"]
        .as_str()
        .is_some());
}

#[test]
fn app_db_connections_enable_storage_pragmas() {
    let init = test_init("db-pragmas");
    fs::create_dir_all(&init.app_data_dir).unwrap();
    let db = open_app_connection(&init.app_data_dir.join(DB_FILE_NAME)).unwrap();
    let journal_mode: String = db
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    let foreign_keys: i64 = db
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .unwrap();
    let busy_timeout: i64 = db
        .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
        .unwrap();

    assert_eq!(journal_mode, "wal");
    assert_eq!(foreign_keys, 1);
    assert_eq!(busy_timeout, 5000);
}

#[test]
fn state_backup_export_captures_live_wal_and_passes_integrity_check() {
    let init = test_init("state-backup");
    let backup_path = init.app_data_dir.join("wheeljack-backup.sqlite3");
    let core = Core::new(init, Arc::new(NullEventSink)).unwrap();
    {
        let db = core.lock_db().unwrap();
        db.execute_batch("PRAGMA wal_autocheckpoint = 0;").unwrap();
        db.execute(
            "INSERT INTO settings (key, value_json, updated_at)
             VALUES ('backup_probe', '\"from live wal\"', 'now')",
            [],
        )
        .unwrap();
    }

    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "backup",
                "command": "state_backup_export",
                "payload": { "path": backup_path }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], true);

    let backup = Connection::open(backup_path).unwrap();
    let integrity: String = backup
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    let probe: String = backup
        .query_row(
            "SELECT value_json FROM settings WHERE key = 'backup_probe'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let schema_version: i32 = backup
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();

    assert_eq!(integrity, "ok");
    assert_eq!(probe, "\"from live wal\"");
    assert_eq!(schema_version, db::LATEST_SCHEMA_VERSION);
}

#[test]
fn state_backup_export_refuses_live_or_existing_destinations() {
    let init = test_init("state-backup-destination");
    let live_path = init.app_data_dir.join(DB_FILE_NAME);
    let existing_path = init.app_data_dir.join("existing.sqlite3");
    let core = Core::new(init, Arc::new(NullEventSink)).unwrap();
    fs::write(&existing_path, b"keep me").unwrap();

    for path in [&live_path, &existing_path] {
        let response: Value = serde_json::from_str(
            &core.call_json(
                &json!({
                    "id": "backup",
                    "command": "state_backup_export",
                    "payload": { "path": path }
                })
                .to_string(),
            ),
        )
        .unwrap();
        assert_eq!(response["ok"], false);
    }
    assert_eq!(fs::read(existing_path).unwrap(), b"keep me");
}

#[test]
fn state_backup_export_rejects_relative_destinations() {
    let init = test_init("state-backup-relative");
    let core = Core::new(init, Arc::new(NullEventSink)).unwrap();
    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "backup",
                "command": "state_backup_export",
                "payload": { "path": "wheeljack-backup.sqlite3" }
            })
            .to_string(),
        ),
    )
    .unwrap();

    assert_eq!(response["ok"], false);
}

#[test]
fn numbered_migrations_upgrade_existing_schema() {
    let init = test_init("numbered-migrations");
    fs::create_dir_all(&init.app_data_dir).unwrap();
    let db = open_app_connection(&init.app_data_dir.join(DB_FILE_NAME)).unwrap();
    db.execute_batch(
        r#"
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_opened_at TEXT
        );

        CREATE TABLE canvases (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          theme_id TEXT NOT NULL DEFAULT 'mono-dark',
          camera_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .unwrap();

    run_migrations(&db).unwrap();

    let schema_version: i32 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    let sort_index_count = db
        .prepare("PRAGMA table_info(canvases)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap()
        .into_iter()
        .filter(|column| column == "sort_index")
        .count();
    let layout_table_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'canvas_layouts'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let layout_columns = db
        .prepare("PRAGMA table_info(canvas_layouts)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    let project_columns = db
        .prepare("PRAGMA table_info(projects)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();

    assert_eq!(schema_version, db::LATEST_SCHEMA_VERSION);
    assert_eq!(sort_index_count, 1);
    assert_eq!(layout_table_count, 1);
    assert!(layout_columns.iter().any(|column| column == "layout_mode"));
    assert!(project_columns.iter().any(|column| column == "archived_at"));
    assert!(project_columns.iter().any(|column| column == "icon"));
    assert!(project_columns.iter().any(|column| column == "icon_color"));
    assert!(project_columns
        .iter()
        .any(|column| column == "agent_access"));
}

#[test]
fn adapter_verification_migration_repairs_early_v5_schema() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(
        "CREATE TABLE adapter_verifications (
           adapter_id TEXT PRIMARY KEY,
           executable_path TEXT NOT NULL,
           version TEXT
         );
         PRAGMA user_version = 5;",
    )
    .unwrap();

    run_migrations(&db).unwrap();

    let columns = db
        .prepare("PRAGMA table_info(adapter_verifications)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(columns.iter().any(|column| column == "verified_at"));
    assert!(columns.iter().any(|column| column == "verified_args_json"));
    assert!(columns.iter().any(|column| column == "launch_fingerprint"));
}

#[test]
fn copies_old_tauri_data_once() {
    let old_dir = temp_dir("old-app-data");
    let new_dir = temp_dir("new-app-data");
    fs::create_dir_all(&old_dir).unwrap();
    let old_db = Connection::open(old_dir.join(DB_FILE_NAME)).unwrap();
    old_db
        .execute_batch(
            "CREATE TABLE migration_probe (value TEXT NOT NULL);
             INSERT INTO migration_probe VALUES ('sqlite data');",
        )
        .unwrap();
    drop(old_db);
    fs::write(
        old_dir.join("windows-ui-v1.json"),
        br#"{"version":1,"mode":"fixed"}"#,
    )
    .unwrap();

    let mut init = test_init("migration");
    init.app_data_dir = new_dir.clone();
    init.old_app_data_dirs = vec![old_dir.clone()];
    let paths = CorePaths::from_init(&init);
    let migrated = migrate_app_data(&paths).unwrap();

    assert!(migrated);
    let migrated_db = Connection::open(new_dir.join(DB_FILE_NAME)).unwrap();
    let migrated_value: String = migrated_db
        .query_row("SELECT value FROM migration_probe", [], |row| row.get(0))
        .unwrap();
    assert_eq!(migrated_value, "sqlite data");
    assert!(new_dir
        .join(format!("{DB_FILE_NAME}.pre-native.bak"))
        .exists());
    assert_eq!(
        fs::read_to_string(new_dir.join("windows-ui-v1.json")).unwrap(),
        r#"{"version":1,"mode":"fixed"}"#
    );
}

#[test]
fn migration_does_not_import_over_an_existing_destination_database() {
    let old_dir = temp_dir("old-app-data-existing-destination");
    let new_dir = temp_dir("new-app-data-existing-destination");
    fs::create_dir_all(&old_dir).unwrap();
    fs::create_dir_all(&new_dir).unwrap();
    let seed = |path: &Path, value: &str| {
        let db = Connection::open(path).unwrap();
        db.execute("CREATE TABLE migration_probe (value TEXT NOT NULL)", [])
            .unwrap();
        db.execute("INSERT INTO migration_probe VALUES (?1)", [value])
            .unwrap();
    };
    seed(&old_dir.join(DB_FILE_NAME), "legacy source");
    seed(&new_dir.join(DB_FILE_NAME), "existing destination");

    let mut init = test_init("migration-existing-destination");
    init.app_data_dir = new_dir.clone();
    init.old_app_data_dirs = vec![old_dir.clone()];
    assert!(!migrate_app_data(&CorePaths::from_init(&init)).unwrap());

    let destination = Connection::open(new_dir.join(DB_FILE_NAME)).unwrap();
    let value: String = destination
        .query_row("SELECT value FROM migration_probe", [], |row| row.get(0))
        .unwrap();
    assert_eq!(value, "existing destination");
    assert!(old_dir.join(DB_FILE_NAME).is_file());
    assert!(!new_dir
        .join(format!("{DB_FILE_NAME}.pre-native.bak"))
        .exists());
}

#[test]
fn migrates_legacy_database_name_in_current_app_data_dir() {
    let app_data_dir = temp_dir("legacy-database-name");
    fs::create_dir_all(&app_data_dir).unwrap();
    let legacy_db = Connection::open(app_data_dir.join(LEGACY_DB_FILE_NAME)).unwrap();
    legacy_db
        .execute_batch(
            "CREATE TABLE migration_probe (value TEXT NOT NULL);
             INSERT INTO migration_probe VALUES ('legacy database');",
        )
        .unwrap();
    drop(legacy_db);

    let mut init = test_init("legacy-database-name");
    init.app_data_dir = app_data_dir.clone();
    let paths = CorePaths::from_init(&init);
    assert!(migrate_app_data(&paths).unwrap());

    let migrated_db = Connection::open(app_data_dir.join(DB_FILE_NAME)).unwrap();
    let value: String = migrated_db
        .query_row("SELECT value FROM migration_probe", [], |row| row.get(0))
        .unwrap();
    assert_eq!(value, "legacy database");
    assert!(app_data_dir.join(LEGACY_DB_FILE_NAME).exists());
}

#[test]
fn migration_uses_sqlite_backup_for_uncheckpointed_wal_and_retries_staging() {
    let old_dir = temp_dir("old-app-data-wal");
    let new_dir = temp_dir("new-app-data-wal");
    fs::create_dir_all(&old_dir).unwrap();
    fs::create_dir_all(&new_dir).unwrap();
    fs::write(
        new_dir.join(format!(".{DB_FILE_NAME}.migrating")),
        b"interrupted",
    )
    .unwrap();
    let source = open_app_connection(&old_dir.join(DB_FILE_NAME)).unwrap();
    source
        .execute_batch("PRAGMA wal_autocheckpoint = 0; CREATE TABLE wal_probe(value TEXT);")
        .unwrap();
    source
        .execute("INSERT INTO wal_probe VALUES ('from wal')", [])
        .unwrap();

    let mut init = test_init("migration-wal");
    init.app_data_dir = new_dir.clone();
    init.old_app_data_dirs = vec![old_dir];
    assert!(migrate_app_data(&CorePaths::from_init(&init)).unwrap());

    let destination = Connection::open(new_dir.join(DB_FILE_NAME)).unwrap();
    let value: String = destination
        .query_row("SELECT value FROM wal_probe", [], |row| row.get(0))
        .unwrap();
    assert_eq!(value, "from wal");
}

#[test]
fn migrations_reject_future_schema_versions() {
    let init = test_init("future-schema");
    fs::create_dir_all(&init.app_data_dir).unwrap();
    let db = Connection::open(init.app_data_dir.join(DB_FILE_NAME)).unwrap();
    db.pragma_update(None, "user_version", db::LATEST_SCHEMA_VERSION + 1)
        .unwrap();
    let error = run_migrations(&db).unwrap_err().to_string();
    assert!(error.contains("newer than supported"));
}

#[test]
fn migration_removes_duplicate_agent_chat_from_canvas_nodes() {
    let db = Connection::open_in_memory().unwrap();
    run_migrations(&db).unwrap();
    db.execute_batch(
        r#"
        INSERT INTO projects (id, name, path, created_at, updated_at)
        VALUES ('project_chat', 'Chat', '.', 'now', 'now');
        INSERT INTO canvases (id, project_id, name, theme_id, camera_json, created_at, updated_at)
        VALUES ('canvas_chat', 'project_chat', 'Main', 'mono-dark', '{}', 'now', 'now');
        INSERT INTO nodes (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
        VALUES ('node_chat', 'canvas_chat', 'agent_terminal', 'Agent', 0, 0, 1, 1, 0,
                '{"sessionId":"session_chat","chatMessages":[{"content":"duplicate"}]}', 'now', 'now');
        PRAGMA user_version = 10;
        "#,
    )
    .unwrap();

    run_migrations(&db).unwrap();

    let data_json: String = db
        .query_row(
            "SELECT data_json FROM nodes WHERE id = 'node_chat'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let data: Value = serde_json::from_str(&data_json).unwrap();
    assert_eq!(data["sessionId"], "session_chat");
    assert!(data.get("chatMessages").is_none());
}

#[test]
fn migration_promotes_legacy_ops_nodes_to_canonical_state() {
    let db = Connection::open_in_memory().unwrap();
    run_migrations(&db).unwrap();
    db.execute_batch(
        r#"
        INSERT INTO projects (id, name, path, created_at, updated_at)
        VALUES ('project_ops', 'Ops', '.', 'now', 'now');
        INSERT INTO canvases (id, project_id, name, theme_id, camera_json, created_at, updated_at)
        VALUES ('canvas_ops', 'project_ops', 'Main', 'mono-dark', '{}', 'now', 'now');
        INSERT INTO nodes (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
        VALUES ('node_ops', 'canvas_ops', 'ops_state', 'Ops', 0, 0, 1, 1, 0,
                '{"version":2,"columns":[],"cards":[],"prd":"","tdd":"","eventCursors":{}}', 'now', 'now');
        DROP TABLE ops_task_leases;
        DROP TABLE ops_scheduler_configs;
        DROP TABLE ops_states;
        PRAGMA user_version = 11;
        "#,
    )
    .unwrap();

    run_migrations(&db).unwrap();

    let record = load_ops_state(&db, "canvas_ops").unwrap().unwrap();
    assert_eq!(record.project_id, "project_ops");
    assert_eq!(record.revision, 1);
    assert_eq!(record.state["version"], 2);
    let legacy_nodes: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM nodes WHERE kind = 'ops_state'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(legacy_nodes, 0);
}
