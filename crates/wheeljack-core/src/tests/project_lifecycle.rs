use super::support::temp_dir;
use super::support::test_init;
use crate::{db::run_migrations, project_lifecycle::*, Core, NullEventSink};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{sync::Arc, thread, time::Duration};

#[test]
fn lifecycle_urls_reject_non_loopback_authorities_and_credentials() {
    for url in [
        "http://localhost:4173/app",
        "http://127.0.0.1:4173",
        "https://[::1]/app",
    ] {
        assert!(validate_lifecycle_preview_url(url).is_ok(), "{url}");
    }
    for url in [
        "http://localhost:3000@example.com/preview",
        "http://localhost.example.com/",
        "http://127.0.0.1.example.com/",
        "http://user@localhost/",
        "http://localhost:bad/",
        "file:///localhost/app",
        "http://localhost\\@example.com/",
        "http://local\nhost/",
    ] {
        assert!(validate_lifecycle_preview_url(url).is_err(), "{url}");
    }
}

#[test]
fn lifecycle_preview_probe_requires_http_success_and_is_bounded() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    for (response, delay, ready) in [
        ("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", 0, true),
        (
            "HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n",
            0,
            false,
        ),
        (
            "HTTP/1.1 302 Found\r\nLocation: https://example.com/\r\nContent-Length: 0\r\n\r\n",
            0,
            false,
        ),
        ("", 900, false),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let _ = stream.read(&mut [0; 1024]);
            thread::sleep(Duration::from_millis(delay));
            let _ = stream.write_all(response.as_bytes());
        });
        let started = std::time::Instant::now();
        assert_eq!(probe_lifecycle_preview_url(&url).is_ok(), ready);
        assert!(
            started.elapsed() < Duration::from_millis(800),
            "probe exceeded its timeout"
        );
        server.join().unwrap();
    }
}

// Invoked in a child test process so the fixture is portable and requires no
// installed scripting runtime. Normal test runs return immediately.
#[test]
#[allow(clippy::zombie_processes)] // Deliberately outlive the launcher; the parent test owns and kills the job/group.
fn lifecycle_process_fixture() {
    let Ok(mode) = std::env::var("WHEELJACK_LIFECYCLE_FIXTURE") else {
        return;
    };
    if mode == "launcher" {
        thread::sleep(Duration::from_millis(200));
        let _child = crate::hidden_command(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tests::project_lifecycle::lifecycle_process_fixture",
                "--nocapture",
            ])
            .env("WHEELJACK_LIFECYCLE_FIXTURE", "descendant")
            .spawn()
            .unwrap();
        println!("launcher-exited");
    } else {
        println!("descendant-holds-output");
        thread::sleep(Duration::from_secs(15));
    }
}

fn start_fixture_run(mode: &str, timeout: u64, kind: &str, url: Option<&str>) -> (Core, Value) {
    let root = temp_dir(&format!("lifecycle-fixture-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(root.join(".wheeljack")).unwrap();
    let mut task = json!({
        "command": [std::env::current_exe().unwrap(), "--exact", "tests::project_lifecycle::lifecycle_process_fixture", "--nocapture"],
        "env": { "WHEELJACK_LIFECYCLE_FIXTURE": mode },
        "timeoutSeconds": timeout,
    });
    if let Some(url) = url {
        task["url"] = json!(url);
    }
    let mut manifest = json!({ "version": 1 });
    manifest[kind] = task;
    std::fs::write(
        root.join(LIFECYCLE_MANIFEST_PATH),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    let core = Core::new(
        test_init(&format!("lifecycle-fixture-{}", uuid::Uuid::now_v7())),
        Arc::new(NullEventSink),
    )
    .unwrap();
    let opened = call(&core, "project_open", json!({ "path": root }));
    let project = json!({ "projectId": opened["id"], "projectPath": opened["path"] });
    let manifest = call(&core, "project_lifecycle_inspect", project.clone());
    let mut trusted = project.clone();
    trusted["hash"] = manifest["hash"].clone();
    call(&core, "project_lifecycle_trust", trusted);
    let mut request = project;
    request["kind"] = json!(kind);
    let run = call(&core, "project_lifecycle_start", request);
    (core, run)
}

#[test]
fn lifecycle_timeout_covers_descendants_after_the_launcher_exits() {
    let started = std::time::Instant::now();
    let (core, run) = start_fixture_run("launcher", 1, "setup", None);
    let mut current = run.clone();
    while current["state"] == "running" && started.elapsed() < Duration::from_secs(5) {
        thread::sleep(Duration::from_millis(25));
        let runs = call(
            &core,
            "project_lifecycle_runs",
            json!({ "projectId": run["projectId"] }),
        );
        current = runs[0].clone();
    }
    // Stop before asserting so even a regression never leaves a fixture child.
    if current["state"] == "running" {
        call(
            &core,
            "project_lifecycle_stop",
            json!({ "runId": run["id"] }),
        );
    }
    let logs = call(
        &core,
        "project_lifecycle_logs",
        json!({ "runId": run["id"] }),
    );
    core.shutdown();
    assert_eq!(current["state"], "timed_out", "{current}");
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(logs["text"].as_str().unwrap().contains("launcher-exited"));
}

#[test]
fn lifecycle_preview_waits_for_http_readiness_and_reports_server_failure() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let status = Arc::new(AtomicU16::new(503));
    let stop = Arc::new(AtomicBool::new(false));
    let server_status = status.clone();
    let server_stop = stop.clone();
    let server = thread::spawn(move || {
        while !server_stop.load(Ordering::SeqCst) {
            if let Ok((mut stream, _)) = listener.accept() {
                stream
                    .set_read_timeout(Some(Duration::from_millis(500)))
                    .unwrap();
                let _ = stream.read(&mut [0; 1024]);
                let response = format!(
                    "HTTP/1.1 {} Test\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    server_status.load(Ordering::SeqCst)
                );
                let _ = stream.write_all(response.as_bytes());
            }
            thread::sleep(Duration::from_millis(10));
        }
    });
    let (core, run) = start_fixture_run("descendant", 10, "preview", Some(&url));
    let wait_for = |state: &str, has_error: bool| {
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            let runs = call(
                &core,
                "project_lifecycle_runs",
                json!({ "projectId": run["projectId"] }),
            );
            let current = runs[0].clone();
            if (current["state"] == state && current["errorMessage"].is_string() == has_error)
                || std::time::Instant::now() >= deadline
            {
                break current;
            }
            thread::sleep(Duration::from_millis(20));
        }
    };
    let waiting = wait_for("running", true);
    status.store(200, Ordering::SeqCst);
    let ready = wait_for("ready", false);
    status.store(503, Ordering::SeqCst);
    let failed_probe = wait_for("running", true);
    call(
        &core,
        "project_lifecycle_stop",
        json!({ "runId": run["id"] }),
    );
    core.shutdown();
    stop.store(true, Ordering::SeqCst);
    server.join().unwrap();
    assert_eq!(waiting["state"], "running");
    assert!(waiting["errorMessage"]
        .as_str()
        .unwrap_or_default()
        .contains("503"));
    assert_eq!(ready["state"], "ready", "{ready}");
    assert_eq!(failed_probe["state"], "running");
    assert!(failed_probe["errorMessage"]
        .as_str()
        .unwrap_or_default()
        .contains("503"));
}

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
