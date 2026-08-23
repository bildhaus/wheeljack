use super::super::*;
use super::support::temp_dir;

fn ops_db() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    run_migrations(&db).unwrap();
    db.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at)
         VALUES ('project-1', 'Project', 'C:/project', 'now', 'now')",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO canvases (id, project_id, name, camera_json, created_at, updated_at)
         VALUES ('canvas-1', 'project-1', 'Main', '{}', 'now', 'now')",
        [],
    )
    .unwrap();
    db
}

fn state() -> Value {
    json!({
        "columns": [
            { "id": "queued", "role": "queued" },
            { "id": "done", "role": "done" }
        ],
        "cards": [
            {
                "id": "task-1",
                "columnId": "queued",
                "assigneeIds": [],
                "dependencyIds": []
            },
            {
                "id": "task-2",
                "columnId": "queued",
                "assigneeIds": [],
                "dependencyIds": []
            }
        ]
    })
}

#[test]
fn ops_state_revisions_reject_stale_writers() {
    let db = ops_db();
    let first = save_ops_state(&db, "canvas-1", "project-1", &state(), None).unwrap();
    assert_eq!(first.revision, 1);
    let second = save_ops_state(
        &db,
        "canvas-1",
        "project-1",
        &json!({ "columns": [], "cards": [] }),
        Some(first.revision),
    )
    .unwrap();
    assert_eq!(second.revision, 2);
    assert!(save_ops_state(&db, "canvas-1", "project-1", &state(), Some(1)).is_err());
    assert_eq!(
        load_ops_state(&db, "canvas-1").unwrap().unwrap().revision,
        2
    );
}

#[test]
fn ops_state_save_retries_a_transient_write_lock() {
    let dir = temp_dir("ops-state-busy-retry");
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("ops.sqlite3");
    let db = open_app_connection(&path).unwrap();
    run_migrations(&db).unwrap();
    db.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at)
         VALUES ('project-1', 'Project', 'C:/project', 'now', 'now')",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO canvases (id, project_id, name, camera_json, created_at, updated_at)
         VALUES ('canvas-1', 'project-1', 'Main', '{}', 'now', 'now')",
        [],
    )
    .unwrap();
    db.busy_timeout(Duration::from_millis(1)).unwrap();

    let (locked_tx, locked_rx) = std::sync::mpsc::channel();
    let locker = thread::spawn(move || {
        let locker = open_app_connection(&path).unwrap();
        let tx = Transaction::new_unchecked(&locker, TransactionBehavior::Immediate).unwrap();
        locked_tx.send(()).unwrap();
        thread::sleep(Duration::from_millis(120));
        tx.commit().unwrap();
    });
    locked_rx.recv().unwrap();

    let saved = save_ops_state(&db, "canvas-1", "project-1", &state(), None).unwrap();
    locker.join().unwrap();
    assert_eq!(saved.revision, 1);
}

#[test]
fn ops_scheduler_leases_tasks_once_with_pause_and_concurrency() {
    let db = ops_db();
    save_ops_state(&db, "canvas-1", "project-1", &state(), None).unwrap();
    configure_ops_scheduler(
        &db,
        "project-1",
        "canvas-1",
        true,
        false,
        2,
        Some("codex-cli"),
    )
    .unwrap();

    let created = tick_ops_scheduler(&db).unwrap();
    assert_eq!(created.len(), 2);
    assert_ne!(created[0].task_id, created[1].task_id);
    assert!(tick_ops_scheduler(&db).unwrap().is_empty());

    let first = claim_ops_lease(&db, "project-1", "owner-1")
        .unwrap()
        .unwrap();
    let second = claim_ops_lease(&db, "project-1", "owner-1")
        .unwrap()
        .unwrap();
    assert_ne!(first.task_id, second.task_id);
    assert!(claim_ops_lease(&db, "project-1", "owner-1")
        .unwrap()
        .is_none());
    heartbeat_ops_lease(&db, &first.id, "owner-1").unwrap();
    assert!(heartbeat_ops_lease(&db, &first.id, "wrong-owner").is_err());

    configure_ops_scheduler(
        &db,
        "project-1",
        "canvas-1",
        true,
        true,
        2,
        Some("codex-cli"),
    )
    .unwrap();
    finish_ops_lease(&db, &first.id, "owner-1", "completed").unwrap();
    finish_ops_lease(&db, &second.id, "owner-1", "released").unwrap();
    assert!(tick_ops_scheduler(&db).unwrap().is_empty());

    configure_ops_scheduler(
        &db,
        "project-1",
        "canvas-1",
        true,
        false,
        2,
        Some("codex-cli"),
    )
    .unwrap();
    assert_eq!(tick_ops_scheduler(&db).unwrap().len(), 2);
    configure_ops_scheduler(
        &db,
        "project-1",
        "canvas-1",
        true,
        true,
        2,
        Some("codex-cli"),
    )
    .unwrap();
    assert!(claim_ops_lease(&db, "project-1", "owner-1")
        .unwrap()
        .is_none());
    let pending: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM ops_task_leases WHERE state = 'pending'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(pending, 0);
}

#[test]
fn ops_scheduler_releases_pending_leases_for_deleted_tasks() {
    let db = ops_db();
    save_ops_state(&db, "canvas-1", "project-1", &state(), None).unwrap();
    configure_ops_scheduler(
        &db,
        "project-1",
        "canvas-1",
        true,
        false,
        2,
        Some("codex-cli"),
    )
    .unwrap();

    let created = tick_ops_scheduler(&db).unwrap();
    let deleted_task_id = created[0].task_id.clone();
    let deleted_lease_id = created[0].id.clone();
    let mut updated_state = state();
    updated_state["cards"]
        .as_array_mut()
        .unwrap()
        .retain(|card| card["id"] != deleted_task_id);
    save_ops_state(&db, "canvas-1", "project-1", &updated_state, Some(1)).unwrap();

    let claimed = claim_ops_lease(&db, "project-1", "owner-1")
        .unwrap()
        .unwrap();
    assert_ne!(claimed.task_id, deleted_task_id);
    let deleted_lease_state: String = db
        .query_row(
            "SELECT state FROM ops_task_leases WHERE id = ?1",
            params![deleted_lease_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(deleted_lease_state, "released");
}
