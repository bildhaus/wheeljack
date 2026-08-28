use super::support::temp_dir;
use super::support::test_init;
use crate::{db::run_migrations, project_lifecycle::*, Core, NullEventSink};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{sync::Arc, thread, time::Duration};

fn fixture() -> (std::path::PathBuf, Connection) {
    let root = temp_dir(&format!("lifecycle-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(root.join(".wheeljack")).unwrap();
    std::fs::write(
        root.join(LIFECYCLE_MANIFEST_PATH),
        r#"{
          "version": 1,
          "setup": { "command": ["tool", "install"], "timeoutSeconds": 60 },
          "preview": {
            "windows": ["tool.cmd", "dev", "--port", "{port}"],
            "command": ["tool", "dev", "--port", "{port}"],
            "url": "http://127.0.0.1:{port}"
          }
        }"#,
    )
    .unwrap();
    let db = Connection::open(root.join("test.sqlite3")).unwrap();
    run_migrations(&db).unwrap();
    db.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at)
         VALUES ('project', 'Lifecycle', ?1, 'now', 'now')",
        params![root.to_string_lossy().to_string()],
    )
    .unwrap();
    (root, db)
}

#[test]
fn manifest_requires_exact_hash_trust() {
    let (root, db) = fixture();
    let (manifest, parsed) =
        read_lifecycle_manifest(&db, "project", &root.to_string_lossy()).unwrap();
    assert!(!manifest.trusted);
    assert_eq!(
        lifecycle_task_command(parsed.setup.as_ref().unwrap(), "linux").unwrap(),
        ["tool", "install"]
    );
    assert!(trust_lifecycle_manifest(&db, "project", "wrong", &manifest).is_err());
    trust_lifecycle_manifest(&db, "project", &manifest.hash, &manifest).unwrap();
    let (trusted, _) = read_lifecycle_manifest(&db, "project", &root.to_string_lossy()).unwrap();
    assert!(trusted.trusted);

    std::fs::write(root.join(LIFECYCLE_MANIFEST_PATH), r#"{"version":1}"#).unwrap();
    let (changed, _) = read_lifecycle_manifest(&db, "project", &root.to_string_lossy()).unwrap();
    assert!(!changed.trusted);
}

#[test]
fn lifecycle_working_directory_cannot_escape_project() {
    let (root, _db) = fixture();
    let task = LifecycleTask {
        command: Some(vec!["tool".to_string()]),
        windows: None,
        macos: None,
        linux: None,
        cwd: Some("..".to_string()),
        env: Default::default(),
        url: None,
        timeout_seconds: None,
    };
    assert!(lifecycle_working_dir(&std::fs::canonicalize(root).unwrap(), &task).is_err());
    assert!(validate_lifecycle_preview_url("http://localhost:4173/app").is_ok());
    assert!(validate_lifecycle_preview_url("http://localhost.example.com").is_err());
}

#[test]
fn trusted_lifecycle_process_runs_and_persists_logs() {
    let root = temp_dir(&format!("lifecycle-run-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(root.join(".wheeljack")).unwrap();
    #[cfg(windows)]
    let command = vec!["cmd.exe", "/D", "/S", "/C", "echo lifecycle-ok"];
    #[cfg(not(windows))]
    let command = vec!["sh", "-c", "printf lifecycle-ok"];
    std::fs::write(
        root.join(LIFECYCLE_MANIFEST_PATH),
        serde_json::to_vec(&json!({
            "version": 1,
            "setup": { "command": command, "timeoutSeconds": 10 }
        }))
        .unwrap(),
    )
    .unwrap();
    let core = Core::new(test_init("lifecycle-process"), Arc::new(NullEventSink)).unwrap();
    let opened = call(&core, "project_open", json!({ "path": root }));
    let project_id = opened["id"].as_str().unwrap();
    let project_path = opened["path"].as_str().unwrap();
    let manifest = call(
        &core,
        "project_lifecycle_inspect",
        json!({
            "projectId": project_id,
            "projectPath": project_path,
        }),
    );
    call(
        &core,
        "project_lifecycle_trust",
        json!({
            "projectId": project_id,
            "projectPath": project_path,
            "hash": manifest["hash"],
        }),
    );
    let run = call(
        &core,
        "project_lifecycle_start",
        json!({
            "projectId": project_id,
            "projectPath": project_path,
            "kind": "setup",
        }),
    );
    let run_id = run["id"].as_str().unwrap();
    let mut completed = Value::Null;
    for _ in 0..100 {
        let runs = call(
            &core,
            "project_lifecycle_runs",
            json!({ "projectId": project_id }),
        );
        completed = runs
            .as_array()
            .unwrap()
            .iter()
            .find(|candidate| candidate["id"] == run_id)
            .cloned()
            .unwrap_or(Value::Null);
        if completed["state"] == "completed" {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(completed["state"], "completed");
    let logs = call(&core, "project_lifecycle_logs", json!({ "runId": run_id }));
    assert!(logs["text"].as_str().unwrap().contains("lifecycle-ok"));
    core.shutdown();
}

#[test]
fn lifecycle_start_reuses_the_active_project_kind_run() {
    let root = temp_dir(&format!("lifecycle-singleton-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(root.join(".wheeljack")).unwrap();
    #[cfg(windows)]
    let command = vec!["cmd.exe", "/D", "/S", "/C", "ping 127.0.0.1 -n 4 >nul"];
    #[cfg(not(windows))]
    let command = vec!["sh", "-c", "sleep 3"];
    std::fs::write(
        root.join(LIFECYCLE_MANIFEST_PATH),
        serde_json::to_vec(&json!({
            "version": 1,
            "preview": { "command": command, "url": "http://127.0.0.1:4173" }
        }))
        .unwrap(),
    )
    .unwrap();
    let core = Core::new(test_init("lifecycle-singleton"), Arc::new(NullEventSink)).unwrap();
    let opened = call(&core, "project_open", json!({ "path": root }));
    let project_id = opened["id"].as_str().unwrap();
    let project_path = opened["path"].as_str().unwrap();
    let manifest = call(
        &core,
        "project_lifecycle_inspect",
        json!({
            "projectId": project_id,
            "projectPath": project_path,
        }),
    );
    call(
        &core,
        "project_lifecycle_trust",
        json!({
            "projectId": project_id,
            "projectPath": project_path,
            "hash": manifest["hash"],
        }),
    );
    let first = call(
        &core,
        "project_lifecycle_start",
        json!({
            "projectId": project_id,
            "projectPath": project_path,
            "kind": "preview",
        }),
    );
    let second = call(
        &core,
        "project_lifecycle_start",
        json!({
            "projectId": project_id,
            "projectPath": project_path,
            "kind": "preview",
        }),
    );
    assert_eq!(first["id"], second["id"]);
    let current = call(
        &core,
        "project_lifecycle_current",
        json!({
            "projectId": project_id,
            "kind": "preview",
        }),
    );
    assert_eq!(first["id"], current["id"]);
    call(
        &core,
        "project_lifecycle_stop",
        json!({ "runId": first["id"] }),
    );
    core.shutdown();
}

fn call(core: &Core, command: &str, payload: Value) -> Value {
    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": command,
                "command": command,
                "payload": payload,
                "protocolVersion": 2,
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], true, "{response}");
    response["payload"].clone()
}
