use super::support::*;
use crate::*;

#[test]
fn session_statuses_are_authoritative_beyond_the_history_limit() {
    let core = Core::new(
        test_init("session-statuses-authoritative"),
        Arc::new(NullEventSink),
    )
    .unwrap();
    {
        let db = core.lock_db().unwrap();
        db.execute(
            "INSERT INTO sessions
             (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
             VALUES ('verification-old', 'node-old', 'generic-shell', '{}', '.', 'running', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        for index in 0..101 {
            db.execute(
                "INSERT INTO sessions
                 (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
                 VALUES (?1, ?2, 'generic-shell', '{}', '.', 'completed', ?3, ?3, ?3)",
                params![
                    format!("newer-{index}"),
                    format!("node-{index}"),
                    format!("2026-08-03T12:{:02}:00Z", index % 60),
                ],
            )
            .unwrap();
        }
        db.execute(
            "INSERT INTO sessions
             (id, node_id, adapter_id, command_json, cwd, status, started_at, ended_at, exit_code, created_at, updated_at)
             VALUES ('verification-failed', 'node-failed', 'generic-shell', '{}', '.', 'failed', '2026-08-03T13:00:00Z', '2026-08-03T13:01:00Z', 7, '2026-08-03T13:00:00Z', '2026-08-03T13:01:00Z')",
            [],
        )
        .unwrap();
    }

    let history: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "history",
                "command": "session_list",
                "payload": { "limit": 100 }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert!(!history["payload"]
        .as_array()
        .unwrap()
        .iter()
        .any(|session| session["id"] == "verification-old"));

    let statuses: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "statuses",
                "command": "session_statuses",
                "payload": {
                    "sessionIds": ["verification-old", "verification-failed", "missing"]
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(statuses["ok"], true);
    assert_eq!(statuses["payload"]["verification-old"]["status"], "running");
    assert_eq!(
        statuses["payload"]["verification-failed"]["status"],
        "failed"
    );
    assert_eq!(statuses["payload"]["verification-failed"]["exitCode"], 7);
    assert!(statuses["payload"].get("missing").is_none());
}

#[test]
fn session_history_transcript_search_and_clear_roundtrip() {
    let core = Core::new(test_init("sessions"), Arc::new(NullEventSink)).expect("core");
    {
        let db = core.lock_db().unwrap();
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
                 VALUES ('node_1', 'canvas_main', 'shell_terminal', 'Shell', 0, 0, 1, 1, 0, '{}', 'now', 'now')",
                [],
            )
            .unwrap();
        db.execute(
                "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
                 VALUES ('session_1', 'node_1', 'shell', '{}', '.', 'exited', 'now', 'now', 'now')",
                [],
            )
            .unwrap();
        persist_session_stream_chunk(&db, "session_1", 1, "pty", b"hello native transcript")
            .unwrap();
    }

    let list: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"list","command":"session_list","payload":{"limit":10}}"#),
    )
    .unwrap();
    assert_eq!(
        list["payload"][0]["transcriptPreview"],
        "hello native transcript"
    );

    let transcript: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"tx","command":"session_transcript","payload":{"sessionId":"session_1"}}"#,
    ))
    .unwrap();
    assert_eq!(transcript["payload"]["text"], "hello native transcript");

    let search: Value =
        serde_json::from_str(&core.call_json(
            r#"{"id":"search","command":"session_search","payload":{"query":"native"}}"#,
        ))
        .unwrap();
    assert_eq!(search["payload"][0]["sessionId"], "session_1");

    let cleared: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"clear","command":"session_clear_transcripts"}"#),
    )
    .unwrap();
    assert_eq!(cleared["payload"], 1);
}

#[test]
fn session_history_transcript_chunks_stay_in_sequence_after_restart() {
    let init = test_init("sessions-restart");
    let core = Core::new(init.clone(), Arc::new(NullEventSink)).expect("core");
    {
        let db = core.lock_db().unwrap();
        db.execute(
            "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
             VALUES ('session_1', 'node_1', 'shell', '{}', '.', 'exited', 'now', 'now', 'now')",
            [],
        )
        .unwrap();
        persist_session_stream_chunk(&db, "session_1", 1, "pty", b"one\n").unwrap();
        persist_session_stream_chunk(&db, "session_1", 2, "pty", b"two\n").unwrap();
        persist_session_stream_chunk(&db, "session_1", 3, "pty", b"three\n").unwrap();
    }
    drop(core);

    let reloaded = Core::new(init, Arc::new(NullEventSink)).expect("reload core");
    let db = reloaded.lock_db().unwrap();
    assert_eq!(
        load_session_chunks(&db, "session_1")
            .unwrap()
            .into_iter()
            .map(|chunk| String::from_utf8_lossy(&chunk).to_string())
            .collect::<Vec<_>>(),
        vec!["one\n", "two\n", "three\n"]
    );
    assert_eq!(
        load_session_preview(&db, "session_1").unwrap(),
        "one\ntwo\nthree"
    );
    drop(db);
    let transcript: Value = serde_json::from_str(&reloaded.call_json(
        r#"{"id":"transcript","command":"session_transcript","payload":{"sessionId":"session_1"}}"#,
    ))
    .unwrap();
    assert_eq!(transcript["payload"]["text"], "one\ntwo\nthree\n");
}

#[test]
fn session_history_persists_stream_batches_atomically() {
    let core = Core::new(test_init("session-history-batch"), Arc::new(NullEventSink)).unwrap();
    let db = core.lock_db().unwrap();
    db.execute(
        "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
         VALUES ('session_batch', 'node_batch', 'shell', '{}', '.', 'running', 'now', 'now', 'now')",
        [],
    )
    .unwrap();
    persist_session_stream_chunks(
        &db,
        "session_batch",
        &[(1, "agent-stdout", b"one\n"), (2, "agent-stdout", b"two\n")],
    )
    .unwrap();
    assert_eq!(
        decode_chunks(&load_session_chunks(&db, "session_batch").unwrap()),
        "one\ntwo\n"
    );
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM session_chunks_fts WHERE session_id = 'session_batch'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap(),
        2,
    );
}

#[test]
fn session_transcript_pages_walk_sqlite_history_backwards() {
    let core = Core::new(test_init("session-history-pages"), Arc::new(NullEventSink)).unwrap();
    {
        let db = core.lock_db().unwrap();
        db.execute(
            "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
             VALUES ('session_pages', 'node_pages', 'shell', '{}', '.', 'completed', 'now', 'now', 'now')",
            [],
        )
        .unwrap();
        persist_session_stream_chunks(
            &db,
            "session_pages",
            &[
                (1, "agent-stdout", b"one\n"),
                (2, "agent-stdout", b"two\n"),
                (3, "agent-stdout", b"three\n"),
            ],
        )
        .unwrap();
    }

    let latest: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"latest","command":"session_transcript_page","payload":{"sessionId":"session_pages","limit":2}}"#,
    ))
    .unwrap();
    assert_eq!(latest["payload"]["text"], "two\nthree\n");
    assert_eq!(latest["payload"]["totalChunkCount"], 3);
    assert_eq!(latest["payload"]["startSeq"], 2);
    assert_eq!(latest["payload"]["hasMore"], true);

    let older: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"older","command":"session_transcript_page","payload":{"sessionId":"session_pages","beforeSeq":2,"limit":2}}"#,
    ))
    .unwrap();
    assert_eq!(older["payload"]["text"], "one\n");
    assert_eq!(older["payload"]["startSeq"], 1);
    assert_eq!(older["payload"]["hasMore"], false);
}

#[test]
fn session_chunk_persistence_rolls_back_partial_writes() {
    let core = Core::new(test_init("session-chunk-atomic"), Arc::new(NullEventSink)).expect("core");
    let db = core.lock_db().unwrap();
    db.execute(
        "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
         VALUES ('session_1', 'node_1', 'shell', '{}', '.', 'running', ?1, ?1, ?1)",
        params![now()],
    )
    .unwrap();
    db.execute("DROP TABLE session_chunks_fts", []).unwrap();

    assert!(persist_session_stream_chunk(&db, "session_1", 1, "pty", b"partial").is_err());
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM session_chunks", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn session_chunk_persistence_rejects_a_deleted_session() {
    let core =
        Core::new(test_init("session-chunk-deleted"), Arc::new(NullEventSink)).expect("core");
    let db = core.lock_db().unwrap();
    db.execute(
        "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
         VALUES ('session_gone', 'node_1', 'shell', '{}', '.', 'running', ?1, ?1, ?1)",
        params![now()],
    )
    .unwrap();
    db.execute("DELETE FROM sessions WHERE id = 'session_gone'", [])
        .unwrap();

    assert!(persist_session_stream_chunk(&db, "session_gone", 1, "agent-sse", b"late").is_err());
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM session_chunks", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM session_chunks_fts", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn session_chunk_retention_prunes_oldest_chunks_and_fts() {
    let core = Core::new(
        test_init("session-chunk-retention"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    {
        let db = core.lock_db().unwrap();
        db.execute(
            "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
             VALUES ('session_1', 'node_1', 'shell', '{}', '.', 'running', ?1, ?1, ?1)",
            params![now()],
        )
        .unwrap();
        persist_session_stream_chunk(&db, "session_1", 1, "pty", &vec![b'a'; 600 * 1024]).unwrap();
        persist_session_stream_chunk(&db, "session_1", 2, "pty", &vec![b'b'; 600 * 1024]).unwrap();
        persist_session_stream_chunk(&db, "session_1", 3, "pty", &vec![b'c'; 600 * 1024]).unwrap();
        assert_eq!(load_session_chunks(&db, "session_1").unwrap().len(), 3);
    }

    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "retention",
                "command": "settings_import",
                "payload": { "sessionTranscriptRetentionBytes": 1_048_576 }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], true);

    {
        let db = core.lock_db().unwrap();
        let chunks = load_session_chunks(&db, "session_1").unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0][0], b'c');
        let orphan_fts_rows: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM session_chunks_fts
                 WHERE rowid NOT IN (SELECT id FROM session_chunks)",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(orphan_fts_rows, 0);
    }
}

#[test]
fn batched_session_chunks_defer_retention_until_the_requested_checkpoint() {
    let core = Core::new(
        test_init("session-chunk-deferred-retention"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let db = core.lock_db().unwrap();
    db.execute(
        "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
         VALUES ('session_deferred', 'node_1', 'opencode', '{}', '.', 'running', ?1, ?1, ?1)",
        params![now()],
    )
    .unwrap();
    db.execute(
        "INSERT INTO settings (key, value_json, updated_at)
         VALUES ('sessionTranscriptRetentionBytes', '1048576', ?1)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        params![now()],
    )
    .unwrap();
    let first = vec![b'a'; 600 * 1024];
    let second = vec![b'b'; 600 * 1024];
    let third = vec![b'c'; 600 * 1024];
    persist_session_stream_chunks_with_retention(
        &db,
        "session_deferred",
        &[
            (1, "agent-sse", first.as_slice()),
            (2, "agent-sse", second.as_slice()),
            (3, "agent-sse", third.as_slice()),
        ],
        false,
    )
    .unwrap();
    assert_eq!(
        load_session_chunks(&db, "session_deferred").unwrap().len(),
        3
    );

    prune_session_chunks_to_retention(&db, "session_deferred").unwrap();
    let chunks = load_session_chunks(&db, "session_deferred").unwrap();
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0][0], b'c');
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM session_chunks_fts WHERE session_id = 'session_deferred'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap(),
        1
    );
}

#[test]
fn terminal_session_index_can_skip_persisted_transcripts() {
    let core = Core::new(test_init("session-index-light"), Arc::new(NullEventSink)).expect("core");
    {
        let db = core.lock_db().unwrap();
        db.execute(
            "INSERT INTO projects (id, name, path, created_at, updated_at)
                 VALUES ('project_main', 'wheeljack', '.', 'now', 'now')",
            [],
        )
        .unwrap();
        db.execute(
                "INSERT INTO canvases (id, project_id, name, theme_id, camera_json, created_at, updated_at)
                 VALUES ('canvas_main', 'project_main', 'Main', 'default', '{\"x\":0,\"y\":0,\"scale\":1}', 'now', 'now')",
                [],
            )
            .unwrap();
        db.execute(
                "INSERT INTO nodes (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
                 VALUES ('node_1', 'canvas_main', 'shell_terminal', 'Shell', 0, 0, 1, 1, 0, '{}', 'now', 'now')",
                [],
            )
            .unwrap();
        db.execute(
                "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
                 VALUES ('session_1', 'node_1', 'shell', '{}', '.', 'exited', 'now', 'now', 'now')",
                [],
            )
            .unwrap();
        persist_session_stream_chunk(&db, "session_1", 1, "pty", b"one\n").unwrap();
        persist_session_stream_chunk(&db, "session_1", 2, "pty", b"two\n").unwrap();
        persist_session_stream_chunk(&db, "session_1", 3, "pty", b"three\n").unwrap();
    }

    let response: Value = serde_json::from_str(&core.call_json(
            r#"{"id":"index","command":"terminal_session_index","payload":{"canvasId":"canvas_main","includeTranscripts":false}}"#,
        ))
        .unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(
        response["payload"]["sessions"][0]["transcriptPreview"],
        "one\ntwo\nthree"
    );
    assert_eq!(response["payload"]["sessions"][0]["chunkCount"], 3);
    assert_eq!(response["payload"]["transcriptById"], json!({}));
}

#[test]
fn terminal_session_index_matches_reference_local_index() {
    let core =
        Core::new(test_init("terminal-session-index"), Arc::new(NullEventSink)).expect("core");
    let hidden_prompt = [
        "txtl workspace coordination:",
        "User instruction:",
        "hidden transport prompt",
    ]
    .join("\n");
    let nodes = json!([
        {
            "id": "node_1",
            "canvasId": "canvas_test",
            "kind": "agent_terminal",
            "title": "Agent 1",
            "x": 0.0,
            "y": 24.0,
            "width": 640.0,
            "height": 320.0,
            "zIndex": 1,
            "createdAt": "2026-06-16T00:00:00.000Z",
            "updatedAt": "2026-06-16T00:10:00.000Z",
            "data": {
                "adapterId": "generic-shell",
                "cwd": "D:/DEV/wheeljack",
                "status": "running",
                "sessionId": "session_1",
                "transcript": [
                    format!("orchestrator -> {hidden_prompt}"),
                    "pty -> one",
                    "pty -> two",
                    "pty -> three",
                    "pty -> four",
                    "pty -> five"
                ]
            }
        },
        {
            "id": "note_0",
            "canvasId": "canvas_test",
            "kind": "markdown_note",
            "title": "Note 0",
            "x": 0.0,
            "y": 0.0,
            "width": 480.0,
            "height": 240.0,
            "zIndex": 0,
            "createdAt": "2026-06-16T00:00:00.000Z",
            "updatedAt": "2026-06-16T00:00:00.000Z",
            "data": { "markdown": "", "mode": "edit" }
        },
        {
            "id": "node_2",
            "canvasId": "canvas_test",
            "kind": "agent_terminal",
            "title": "Agent 2",
            "x": 0.0,
            "y": 48.0,
            "width": 640.0,
            "height": 320.0,
            "zIndex": 2,
            "createdAt": "2026-06-16T00:00:00.000Z",
            "updatedAt": "2026-06-16T00:10:00.000Z",
            "data": {
                "adapterId": "generic-shell",
                "cwd": "D:/DEV/wheeljack",
                "status": "exited",
                "transcript": ["pty -> done"]
            }
        }
    ]);
    let request = json!({
        "id": "index",
        "command": "terminal_session_index",
        "payload": {
            "nodes": nodes,
            "query": "DONE"
        }
    });

    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    let payload = &response["payload"];
    assert_eq!(payload["sessions"].as_array().unwrap().len(), 2);
    assert_eq!(payload["sessions"][0]["id"], "session_1");
    assert_eq!(payload["sessions"][0]["nodeId"], "node_1");
    assert_eq!(payload["sessions"][0]["nodeTitle"], "Agent 1");
    assert_eq!(payload["sessions"][0]["chunkCount"], 5);
    assert_eq!(
        payload["sessions"][0]["transcriptPreview"],
        "pty -> two\npty -> three\npty -> four\npty -> five"
    );
    assert_eq!(payload["sessions"][1]["id"], "node_2");
    assert_eq!(
        payload["sessions"][1]["endedAt"],
        "2026-06-16T00:10:00.000Z"
    );
    assert_eq!(payload["sessions"][1]["chunkCount"], 1);
    assert_eq!(
        payload["transcriptById"]["session_1"],
        "pty -> one\npty -> two\npty -> three\npty -> four\npty -> five"
    );
    assert!(!payload["transcriptById"]["session_1"]
        .as_str()
        .unwrap()
        .contains("txtl workspace coordination"));
    assert_eq!(payload["transcriptById"]["node_2"], "pty -> done");
    assert!(payload["searchTextById"]["session_1"]
        .as_str()
        .unwrap()
        .contains("agent 1"));
    assert!(payload["searchTextById"]["session_1"]
        .as_str()
        .unwrap()
        .contains("pty -> five"));
    assert!(payload["searchText"][0]
        .as_str()
        .unwrap()
        .contains("agent 1"));
    assert_eq!(
        payload["searchResults"][0],
        json!({
            "sessionId": "session_1",
            "nodeId": "node_1",
            "nodeTitle": "Agent 1",
            "adapterId": "generic-shell",
            "cwd": "D:/DEV/wheeljack",
            "status": "running",
            "startedAt": "2026-06-16T00:00:00.000Z",
            "snippet": "pty -> two\npty -> three\npty -> four\npty -> five"
        })
    );
    assert_eq!(payload["matches"].as_array().unwrap().len(), 1);
    assert_eq!(payload["matches"][0]["sessionId"], "node_2");
}

#[test]
fn terminal_transcript_append_persists_prompt_markers_for_session_index() {
    let core = Core::new(
        test_init("terminal-transcript-append"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let patch = json!({
        "id": "patch",
        "command": "canvas_apply_patch",
        "payload": {
            "canvasId": "canvas_test",
            "patch": {
                "project": {
                    "id": "project_test",
                    "name": "Manual",
                    "path": ".",
                    "branch": "main",
                    "dirty": false
                },
                "nodes": [
                    {
                        "id": "node_terminal",
                        "canvasId": "canvas_test",
                        "kind": "agent_terminal",
                        "title": "Skye",
                        "x": 0,
                        "y": 0,
                        "width": 600,
                        "height": 300,
                        "zIndex": 1,
                        "data": {
                            "adapterId": "claude-code",
                            "sessionId": "session_terminal",
                            "status": "running",
                            "transcript": []
                        },
                        "createdAt": "now",
                        "updatedAt": "now"
                    }
                ],
                "edges": []
            }
        }
    });
    let patched: Value = serde_json::from_str(&core.call_json(&patch.to_string())).unwrap();
    assert_eq!(patched["ok"], true);

    let append = json!({
        "id": "append",
        "command": "terminal_transcript_append",
        "payload": {
            "canvasId": "canvas_test",
            "nodeId": "node_terminal",
            "marker": "user -> run checks"
        }
    });
    let appended: Value = serde_json::from_str(&core.call_json(&append.to_string())).unwrap();
    assert_eq!(appended["ok"], true);
    assert_eq!(
        appended["payload"]["updatedNode"]["data"]["transcript"],
        json!(["", "user -> run checks"])
    );

    let index: Value = serde_json::from_str(
            &core.call_json(
                r#"{"id":"index","command":"terminal_session_index","payload":{"canvasId":"canvas_test","query":"checks"}}"#,
            ),
        )
        .unwrap();
    assert_eq!(index["ok"], true);
    assert_eq!(
        index["payload"]["matches"][0]["sessionId"],
        "session_terminal"
    );
    assert_eq!(
        index["payload"]["transcriptById"]["session_terminal"],
        "\nuser -> run checks"
    );
}

#[test]
fn terminal_transcripts_clear_matches_reference_node_clear() {
    let core = Core::new(
        test_init("terminal-transcripts-clear"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let patch = json!({
        "id": "patch",
        "command": "canvas_apply_patch",
        "payload": {
            "canvasId": "canvas_test",
            "patch": {
                "project": {
                    "id": "project_test",
                    "name": "Manual",
                    "path": ".",
                    "branch": "main",
                    "dirty": false
                },
                "themeId": "mono-dark",
                "camera": { "x": 0.0, "y": 0.0, "scale": 1.0 },
                "nodes": [
                    {
                        "id": "note_0",
                        "canvasId": "canvas_test",
                        "kind": "markdown_note",
                        "title": "Note",
                        "x": 0.0,
                        "y": 0.0,
                        "width": 300.0,
                        "height": 180.0,
                        "zIndex": 0,
                        "data": { "text": "keep" },
                        "createdAt": "2026-06-16T00:00:00.000Z",
                        "updatedAt": "2026-06-16T00:00:00.000Z"
                    },
                    {
                        "id": "node_1",
                        "canvasId": "canvas_test",
                        "kind": "agent_terminal",
                        "title": "Agent 1",
                        "x": 0.0,
                        "y": 0.0,
                        "width": 640.0,
                        "height": 320.0,
                        "zIndex": 1,
                        "data": {
                            "adapterId": "generic-shell",
                            "cwd": "D:/DEV/wheeljack",
                            "status": "running",
                            "sessionId": "session_1",
                            "transcript": ["pty -> one", "pty -> two"]
                        },
                        "createdAt": "2026-06-16T00:00:00.000Z",
                        "updatedAt": "2026-06-16T00:00:00.000Z"
                    },
                    {
                        "id": "node_2",
                        "canvasId": "canvas_test",
                        "kind": "shell_terminal",
                        "title": "Shell",
                        "x": 0.0,
                        "y": 0.0,
                        "width": 640.0,
                        "height": 320.0,
                        "zIndex": 2,
                        "data": {
                            "adapterId": "shell",
                            "cwd": "D:/DEV/wheeljack",
                            "status": "running",
                            "sessionId": "session_2",
                            "transcript": []
                        },
                        "createdAt": "2026-06-16T00:00:00.000Z",
                        "updatedAt": "2026-06-16T00:00:00.000Z"
                    }
                ],
                "edges": []
            }
        }
    });
    let patched: Value = serde_json::from_str(&core.call_json(&patch.to_string())).unwrap();
    assert_eq!(patched["ok"], true);

    let clear = json!({
        "id": "clear",
        "command": "terminal_transcripts_clear",
        "payload": { "canvasId": "canvas_test" }
    });
    let response: Value = serde_json::from_str(&core.call_json(&clear.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    let payload = &response["payload"];
    assert_eq!(payload["terminalIds"], json!(["node_1", "node_2"]));
    assert_eq!(payload["clearedChunks"], 2);
    assert_eq!(payload["nodes"][0]["data"]["text"], "keep");
    assert_eq!(payload["nodes"][1]["data"]["transcript"], json!([]));
    assert_ne!(payload["nodes"][1]["updatedAt"], "2026-06-16T00:00:00.000Z");
    assert_eq!(payload["nodes"][2]["updatedAt"], "2026-06-16T00:00:00.000Z");

    let get = json!({
        "id": "get",
        "command": "canvas_get",
        "payload": { "canvasId": "canvas_test" }
    });
    let stored: Value = serde_json::from_str(&core.call_json(&get.to_string())).unwrap();
    assert_eq!(
        stored["payload"]["nodes"][1]["data"]["transcript"],
        json!([])
    );
}

#[test]
fn terminal_session_state_commands_match_reference_node_updates() {
    let core =
        Core::new(test_init("terminal-session-state"), Arc::new(NullEventSink)).expect("core");
    let nodes = json!([
        {
            "id": "node_0",
            "canvasId": "canvas_test",
            "kind": "agent_terminal",
            "title": "Idle A",
            "x": 0.0,
            "y": 0.0,
            "width": 640.0,
            "height": 320.0,
            "zIndex": 0,
            "createdAt": "2026-06-16T00:00:00.000Z",
            "updatedAt": "2026-06-16T00:00:00.000Z",
            "data": {
                "adapterId": "generic-shell",
                "cwd": "D:/DEV/wheeljack",
                "status": "running",
                "transcript": ["pty -> idle"]
            }
        },
        {
            "id": "node_1",
            "canvasId": "canvas_test",
            "kind": "agent_terminal",
            "title": "Busy",
            "x": 0.0,
            "y": 0.0,
            "width": 640.0,
            "height": 320.0,
            "zIndex": 1,
            "createdAt": "2026-06-16T00:00:00.000Z",
            "updatedAt": "2026-06-16T00:00:00.000Z",
            "data": {
                "adapterId": "generic-shell",
                "cwd": "D:/DEV/wheeljack",
                "status": "running",
                "sessionId": "session_busy",
                "transcript": ["pty -> busy"]
            }
        },
        {
            "id": "node_2",
            "canvasId": "canvas_test",
            "kind": "shell_terminal",
            "title": "Idle B",
            "x": 0.0,
            "y": 0.0,
            "width": 640.0,
            "height": 320.0,
            "zIndex": 2,
            "createdAt": "2026-06-16T00:00:00.000Z",
            "updatedAt": "2026-06-16T00:00:00.000Z",
            "data": {
                "adapterId": "shell",
                "cwd": "D:/DEV/wheeljack",
                "status": "running",
                "transcript": []
            }
        },
        {
            "id": "note_0",
            "canvasId": "canvas_test",
            "kind": "markdown_note",
            "title": "Note",
            "x": 0.0,
            "y": 0.0,
            "width": 300.0,
            "height": 180.0,
            "zIndex": 3,
            "createdAt": "2026-06-16T00:00:00.000Z",
            "updatedAt": "2026-06-16T00:00:00.000Z",
            "data": { "text": "note" }
        }
    ]);

    let exited = json!({
        "id": "exit",
        "command": "terminal_session_mark_exited",
        "payload": {
            "nodes": nodes.clone(),
            "sessionId": "session_busy"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&exited.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["matchedNode"]["id"], "node_1");
    assert_eq!(
        response["payload"]["matchedNode"]["data"]["status"],
        "exited"
    );
    assert_eq!(
        response["payload"]["matchedNode"]["data"]["sessionId"],
        Value::Null
    );
    assert_eq!(
        response["payload"]["matchedNode"]["data"]["lastSessionId"],
        "session_busy"
    );
    assert_eq!(
        response["payload"]["matchedNode"]["data"]["transcript"],
        json!(["pty -> busy", "", "pty -> process exited"])
    );

    let structured_exited = json!({
        "id": "structured-exit",
        "command": "terminal_session_mark_exited",
        "payload": {
            "nodes": nodes.clone(),
            "sessionId": "session_busy",
            "marker": "agent -> structured process exited"
        }
    });
    let structured_response: Value =
        serde_json::from_str(&core.call_json(&structured_exited.to_string())).unwrap();
    assert_eq!(
        structured_response["payload"]["matchedNode"]["data"]["transcript"],
        json!(["pty -> busy", "", "agent -> structured process exited"])
    );

    let assign_selected = json!({
        "id": "assign",
        "command": "terminal_worktree_assign",
        "payload": {
            "nodes": nodes.clone(),
            "cwd": "D:/DEV/worktree",
            "nodeIds": ["node_0", "node_1"]
        }
    });
    let selected: Value =
        serde_json::from_str(&core.call_json(&assign_selected.to_string())).unwrap();
    assert_eq!(selected["ok"], true);
    assert_eq!(selected["payload"]["assignedIds"], json!(["node_0"]));
    assert_eq!(
        selected["payload"]["nodes"][0]["data"]["cwd"],
        "D:/DEV/worktree"
    );
    assert_eq!(
        selected["payload"]["nodes"][0]["data"]["transcript"],
        json!(["pty -> idle", "", "worktree -> assigned D:/DEV/worktree"])
    );
    assert_eq!(
        selected["payload"]["nodes"][1]["data"]["cwd"],
        "D:/DEV/wheeljack"
    );

    let assign_busy = json!({
        "id": "assign-busy",
        "command": "terminal_worktree_assign",
        "payload": {
            "nodes": nodes.clone(),
            "cwd": "D:/DEV/worktree",
            "nodeIds": ["node_1"]
        }
    });
    let busy: Value = serde_json::from_str(&core.call_json(&assign_busy.to_string())).unwrap();
    assert_eq!(busy["ok"], true);
    assert_eq!(busy["payload"]["assignedIds"], json!([]));
    assert_eq!(busy["payload"]["nodes"], nodes);

    let assign_fallback = json!({
        "id": "assign-fallback",
        "command": "terminal_worktree_assign",
        "payload": {
            "nodes": nodes,
            "cwd": "D:/DEV/worktree",
            "nodeIds": ["note_0"]
        }
    });
    let fallback: Value =
        serde_json::from_str(&core.call_json(&assign_fallback.to_string())).unwrap();
    assert_eq!(
        fallback["payload"]["assignedIds"],
        json!(["node_0", "node_2"])
    );
}
