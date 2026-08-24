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
fn project_ops_state_is_shared_and_revision_fenced() {
    let db = ops_db();
    db.execute(
        "INSERT INTO canvases (id, project_id, name, camera_json, created_at, updated_at)
         VALUES ('canvas-2', 'project-1', 'Second', '{}', 'now', 'now')",
        [],
    )
    .unwrap();
    let first = save_project_ops_state(&db, "project-1", &state(), None).unwrap();
    assert_eq!(first.revision, 1);
    assert_eq!(
        load_project_ops_state(&db, "project-1")
            .unwrap()
            .unwrap()
            .state["cards"][0]["id"],
        "task-1"
    );
    let replacement = json!({ "columns": [], "cards": [] });
    let second =
        save_project_ops_state(&db, "project-1", &replacement, Some(first.revision)).unwrap();
    assert_eq!(second.revision, 2);
    assert!(save_project_ops_state(&db, "project-1", &state(), Some(1)).is_err());
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
fn ops_scheduler_recovers_a_lease_owned_by_a_previous_process() {
    let db = ops_db();
    save_project_ops_state(&db, "project-1", &state(), None).unwrap();
    configure_ops_scheduler(&db, "project-1", "canvas-1", true, false, 1, None).unwrap();
    let lease = claim_ops_lease(&db, "project-1", "old-process")
        .unwrap()
        .unwrap();

    assert!(finish_ops_lease(&db, &lease.id, "new-process", "failed").is_err());
    let recovered = recover_ops_lease(&db, &lease.id, "failed").unwrap();
    assert_eq!(recovered.state, "failed");
    assert!(recover_ops_lease(&db, &lease.id, "failed").is_err());
}

#[test]
fn ops_scheduler_never_leases_objective_cards() {
    let db = ops_db();
    let objective_state = json!({
        "columns": [
            { "id": "queued", "role": "queued" },
            { "id": "done", "role": "done" }
        ],
        "cards": [
            { "id": "objective", "kind": "objective", "columnId": "queued", "assigneeIds": [] },
            { "id": "child", "kind": "task", "parentId": "objective", "columnId": "queued", "assigneeIds": [] }
        ]
    });
    save_project_ops_state(&db, "project-1", &objective_state, None).unwrap();
    configure_ops_scheduler(&db, "project-1", "canvas-1", true, false, 2, None).unwrap();

    let leases = tick_ops_scheduler(&db).unwrap();
    assert_eq!(leases.len(), 1);
    assert_eq!(leases[0].task_id, "child");
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

#[test]
fn ops_scheduler_revalidates_pending_leases_before_claim() {
    let db = ops_db();
    save_ops_state(&db, "canvas-1", "project-1", &state(), None).unwrap();
    configure_ops_scheduler(&db, "project-1", "canvas-1", true, false, 2, None).unwrap();
    let created = tick_ops_scheduler(&db).unwrap();
    let paused_task_id = created[0].task_id.clone();
    let paused_lease_id = created[0].id.clone();
    let mut updated_state = state();
    updated_state["cards"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|card| card["id"] == paused_task_id)
        .unwrap()["paused"] = json!(true);
    save_ops_state(&db, "canvas-1", "project-1", &updated_state, Some(1)).unwrap();

    let claimed = claim_ops_lease(&db, "project-1", "owner-1")
        .unwrap()
        .unwrap();
    assert_ne!(claimed.task_id, paused_task_id);
    let paused_lease_state: String = db
        .query_row(
            "SELECT state FROM ops_task_leases WHERE id = ?1",
            params![paused_lease_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(paused_lease_state, "released");
}

#[test]
fn ops_scheduler_releases_pending_leases_when_the_active_canvas_changes() {
    let db = ops_db();
    db.execute(
        "INSERT INTO canvases (id, project_id, name, camera_json, created_at, updated_at)
         VALUES ('canvas-2', 'project-1', 'Second', '{}', 'now', 'now')",
        [],
    )
    .unwrap();
    save_ops_state(&db, "canvas-1", "project-1", &state(), None).unwrap();
    configure_ops_scheduler(&db, "project-1", "canvas-1", true, false, 2, None).unwrap();
    assert_eq!(tick_ops_scheduler(&db).unwrap().len(), 2);

    configure_ops_scheduler(&db, "project-1", "canvas-2", true, false, 2, None).unwrap();
    let pending_old_canvas: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM ops_task_leases
             WHERE state = 'pending' AND canvas_id = 'canvas-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(pending_old_canvas, 0);
    assert!(tick_ops_scheduler(&db)
        .unwrap()
        .iter()
        .all(|lease| lease.canvas_id == "canvas-2"));
}

#[test]
fn ops_scheduler_blocks_only_hard_dependencies_and_future_retries() {
    let db = ops_db();
    let state = json!({
        "columns": [
            { "id": "queued", "role": "queued" },
            { "id": "done", "role": "done" }
        ],
        "cards": [
            { "id": "upstream", "columnId": "queued", "assigneeIds": [] },
            {
                "id": "soft-dependent",
                "columnId": "queued",
                "assigneeIds": [],
                "dependencyIds": ["upstream"],
                "dependencyKinds": { "upstream": "soft" }
            },
            {
                "id": "hard-dependent",
                "columnId": "queued",
                "assigneeIds": [],
                "dependencyIds": ["upstream"],
                "dependencyKinds": { "upstream": "hard" }
            },
            {
                "id": "backing-off",
                "columnId": "queued",
                "assigneeIds": [],
                "retryAt": "2999-01-01T00:00:00Z"
            },
            {
                "id": "depends-on-archived",
                "columnId": "queued",
                "assigneeIds": [],
                "dependencyIds": ["archived-upstream"],
                "dependencyKinds": { "archived-upstream": "hard" }
            }
        ],
        "archivedCards": [{ "id": "archived-upstream", "columnId": "done" }]
    });
    save_ops_state(&db, "canvas-1", "project-1", &state, None).unwrap();
    configure_ops_scheduler(&db, "project-1", "canvas-1", true, false, 4, None).unwrap();

    let leases = tick_ops_scheduler(&db).unwrap();
    let task_ids = leases
        .into_iter()
        .map(|lease| lease.task_id)
        .collect::<HashSet<_>>();
    assert_eq!(
        task_ids,
        HashSet::from([
            "upstream".to_string(),
            "soft-dependent".to_string(),
            "depends-on-archived".to_string()
        ])
    );
}
