use super::support::*;
use crate::*;

fn session(db: &Connection, id: &str) {
    db.execute(
        "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, created_at, updated_at)
         VALUES (?1, 'node', 'claude-code', '{}', '.', 'running', ?2, ?2)", params![id, now()],
    ).unwrap();
}

fn request(session_id: &str, text: &str) -> SubmitPromptDeliveryRequest {
    SubmitPromptDeliveryRequest {
        client_prompt_id: Uuid::now_v7().to_string(),
        session_id: session_id.to_string(),
        mode: "auto".to_string(),
        payload: PromptDeliveryPayload {
            prompt: text.to_string(),
            history_text: text.to_string(),
            standing_role_applied: false,
            image_paths: vec![],
            provider: None,
            model: None,
            thinking: None,
            approval_policy: None,
            sandbox: None,
        },
    }
}

fn wait_until(mut predicate: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if predicate() {
            return true;
        }
        thread::sleep(Duration::from_millis(10));
    }
    false
}

#[test]
fn resume_rebinds_pending_queue_but_preserves_ambiguous_delivery_and_idempotency() {
    let core = Core::new(test_init("delivery-rebind"), Arc::new(NullEventSink)).unwrap();
    let db = core.lock_db().unwrap();
    session(&db, "prior");
    let first = request("prior", "first");
    let second = request("prior", "second");
    submit_prompt_delivery(&db, &first).unwrap();
    submit_prompt_delivery(&db, &second).unwrap();
    let old_claim = claim_next_prompt_delivery(&db, "prior").unwrap().unwrap();
    recover_interrupted_sessions(&db).unwrap();
    recover_prompt_deliveries(&db).unwrap();
    session(&db, "resumed");
    let moved = rebind_prompt_deliveries(&db, "prior", "resumed").unwrap();
    assert_eq!(moved.len(), 2);
    assert_eq!(moved[0].state, "indeterminate");
    assert_eq!(moved[1].state, "queued");
    assert!(list_prompt_deliveries(&db, "prior").unwrap().is_empty());
    assert!(!has_dispatchable_prompt(&db, "resumed").unwrap());
    // A late response from the retired runtime cannot overwrite the moved queue.
    settle_dispatched_prompt_error(&db, &old_claim, "failed", "old", "old runtime").unwrap();
    assert_eq!(
        load_prompt_delivery(&db, &first.client_prompt_id)
            .unwrap()
            .unwrap()
            .state,
        "indeterminate"
    );
    assert_eq!(
        submit_prompt_delivery(&db, &first).unwrap().session_id,
        "resumed"
    );
    retry_prompt_delivery(&db, &first.client_prompt_id).unwrap();
    let claimed = claim_next_prompt_delivery(&db, "resumed").unwrap().unwrap();
    complete_prompt_delivery(&db, &claimed.id).unwrap();
    assert_eq!(
        claim_next_prompt_delivery(&db, "resumed")
            .unwrap()
            .unwrap()
            .id,
        second.client_prompt_id
    );
}

#[test]
fn completed_payload_expiry_and_clear_preserve_idempotency_and_unresolved_prompts() {
    let core = Core::new(test_init("delivery-expiry"), Arc::new(NullEventSink)).unwrap();
    let first;
    let pending;
    let recent;
    {
        let db = core.lock_db().unwrap();
        session(&db, "session");
        first = request("session", "private old prompt");
        recent = request("session", "recent canceled prompt");
        pending = request("session", "unsent prompt");
        submit_prompt_delivery(&db, &first).unwrap();
        let claimed = claim_next_prompt_delivery(&db, "session").unwrap().unwrap();
        complete_prompt_delivery(&db, &claimed.id).unwrap();
        submit_prompt_delivery(&db, &recent).unwrap();
        cancel_prompt_delivery(&db, &recent.client_prompt_id).unwrap();
        submit_prompt_delivery(&db, &pending).unwrap();
        db.execute("UPDATE session_prompt_deliveries SET updated_at = '2000-01-01T00:00:00Z' WHERE id = ?1", params![first.client_prompt_id]).unwrap();
        assert_eq!(prune_completed_prompt_payloads(&db, false).unwrap(), 1);
        assert!(submit_prompt_delivery(&db, &first)
            .unwrap()
            .payload
            .is_none());
        assert!(load_prompt_delivery(&db, &recent.client_prompt_id)
            .unwrap()
            .unwrap()
            .payload
            .is_some());
        let mut changed = first.clone();
        changed.payload.prompt = "different".to_string();
        assert!(submit_prompt_delivery(&db, &changed).is_err());
    }
    core.session_clear_transcripts().unwrap();
    let db = core.lock_db().unwrap();
    assert!(submit_prompt_delivery(&db, &recent)
        .unwrap()
        .payload
        .is_none());
    assert_eq!(
        load_prompt_delivery(&db, &pending.client_prompt_id)
            .unwrap()
            .unwrap()
            .payload
            .unwrap()
            .prompt,
        "unsent prompt"
    );
}

#[test]
fn schema_21_prompt_payloads_are_backfilled_before_expiry() {
    let core = Core::new(test_init("delivery-migration"), Arc::new(NullEventSink)).unwrap();
    let db = core.lock_db().unwrap();
    session(&db, "session");
    let req = request("session", "legacy prompt");
    submit_prompt_delivery(&db, &req).unwrap();
    db.execute_batch("ALTER TABLE session_prompt_deliveries DROP COLUMN request_session_id;
        ALTER TABLE session_prompt_deliveries DROP COLUMN payload_fingerprint; PRAGMA user_version = 21;").unwrap();
    run_migrations(&db).unwrap();
    assert_eq!(
        submit_prompt_delivery(&db, &req)
            .unwrap()
            .payload
            .unwrap()
            .prompt,
        "legacy prompt"
    );
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
            .unwrap(),
        LATEST_SCHEMA_VERSION
    );
}

#[test]
fn schema_21_metadata_reconciles_old_build_inserts_and_edits_without_rewriting_tombstones() {
    let core = Core::new(
        test_init("delivery-old-build-roundtrip"),
        Arc::new(NullEventSink),
    )
    .unwrap();
    let db = core.lock_db().unwrap();
    session(&db, "prior");
    session(&db, "resumed");
    let inserted = request("prior", "inserted by old build");
    // The released build omits both extension columns from its explicit INSERT.
    db.execute(
        "INSERT INTO session_prompt_deliveries (id,session_id,seq,mode,state,payload_json,created_at,updated_at)
         VALUES (?1,?2,1,?3,'queued',?4,?5,?5)",
        params![inserted.client_prompt_id, inserted.session_id, inserted.mode,
            serde_json::to_string(&inserted.payload).unwrap(), now()],
    ).unwrap();
    run_migrations(&db).unwrap();
    assert_eq!(submit_prompt_delivery(&db, &inserted).unwrap().seq, 1);
    rebind_prompt_deliveries(&db, "prior", "resumed").unwrap();
    let mut edited = inserted.clone();
    edited.payload.prompt = "edited by old build".to_string();
    edited.payload.history_text = edited.payload.prompt.clone();
    // Old code edits the body without knowing about its cached fingerprint.
    db.execute(
        "UPDATE session_prompt_deliveries SET payload_json=?2, revision=revision+1 WHERE id=?1",
        params![
            edited.client_prompt_id,
            serde_json::to_string(&edited.payload).unwrap()
        ],
    )
    .unwrap();
    run_migrations(&db).unwrap();
    assert_eq!(
        submit_prompt_delivery(&db, &edited).unwrap().session_id,
        "resumed"
    );
    assert!(submit_prompt_delivery(&db, &inserted).is_err());
    let claimed = claim_next_prompt_delivery(&db, "resumed").unwrap().unwrap();
    complete_prompt_delivery(&db, &claimed.id).unwrap();
    prune_completed_prompt_payloads(&db, true).unwrap();
    // Nothing changed: reopening must not rewrite metadata, including tombstones.
    db.execute_batch(
        "CREATE TRIGGER no_metadata_rewrite BEFORE UPDATE ON session_prompt_deliveries
        BEGIN SELECT RAISE(FAIL, 'unexpected metadata rewrite'); END;",
    )
    .unwrap();
    run_migrations(&db).unwrap();
    let replay = submit_prompt_delivery(&db, &edited).unwrap();
    assert_eq!(replay.state, "delivered");
    assert!(replay.payload.is_none());
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
            .unwrap(),
        21
    );
}

#[test]
fn schema_21_metadata_initialization_is_atomic_when_a_payload_is_malformed() {
    let core = Core::new(
        test_init("delivery-metadata-atomic"),
        Arc::new(NullEventSink),
    )
    .unwrap();
    let db = core.lock_db().unwrap();
    session(&db, "session");
    let req = request("session", "repairable legacy prompt");
    submit_prompt_delivery(&db, &req).unwrap();
    db.execute_batch(
        "ALTER TABLE session_prompt_deliveries DROP COLUMN request_session_id;
        ALTER TABLE session_prompt_deliveries DROP COLUMN payload_fingerprint;
        UPDATE session_prompt_deliveries SET payload_json = 'malformed';",
    )
    .unwrap();
    assert!(run_migrations(&db).is_err());
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('session_prompt_deliveries')
        WHERE name IN ('request_session_id', 'payload_fingerprint')",
            [],
            |row| row.get::<_, i32>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
            .unwrap(),
        21
    );
    assert_eq!(
        db.query_row(
            "SELECT payload_json FROM session_prompt_deliveries WHERE id=?1",
            params![req.client_prompt_id],
            |row| row.get::<_, String>(0)
        )
        .unwrap(),
        "malformed"
    );
    db.execute(
        "UPDATE session_prompt_deliveries SET payload_json=?2 WHERE id=?1",
        params![
            req.client_prompt_id,
            serde_json::to_string(&req.payload).unwrap()
        ],
    )
    .unwrap();
    run_migrations(&db).unwrap();
    assert_eq!(
        submit_prompt_delivery(&db, &req)
            .unwrap()
            .payload
            .unwrap()
            .prompt,
        "repairable legacy prompt"
    );
}

#[test]
fn structured_pipe_persists_an_idle_tail_before_eof() {
    let core = Core::new(test_init("delivery-idle-pipe"), Arc::new(NullEventSink)).unwrap();
    session(&core.lock_db().unwrap(), "session");
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (mut output, _) = listener.accept().unwrap();
    let reader = spawn_structured_line_reader(
        core.paths.db_path(),
        "session".to_string(),
        "node".to_string(),
        "claude-code".to_string(),
        "stdout".to_string(),
        client,
        Arc::new(AtomicU64::new(0)),
        Arc::new(NullEventSink),
        "claude-stream-json".to_string(),
        Arc::new(Mutex::new(AgentProtocolStreamState::default())),
        None,
        StructuredReaderCancellation {
            shutdown: Arc::new(AtomicBool::new(false)),
            rollback: Arc::new(AtomicBool::new(false)),
        },
    );
    output
        .write_all(b"{\"type\":\"result\",\"result\":\"idle-tail\"}\n")
        .unwrap();
    output.flush().unwrap();
    let persisted = wait_until(|| {
        !load_session_chunks(&core.lock_db().unwrap(), "session")
            .unwrap()
            .is_empty()
    });
    drop(output);
    reader.join().unwrap();
    assert!(
        persisted,
        "tail must be persisted while the pipe remains open and silent"
    );
}

#[test]
fn structured_sse_persists_idle_tail_for_chunked_and_plain_streams() {
    for chunked in [false, true] {
        let core = Core::new(
            test_init(&format!("delivery-idle-sse-{chunked}")),
            Arc::new(NullEventSink),
        )
        .unwrap();
        session(&core.lock_db().unwrap(), "session");
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (release, released) = std::sync::mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = BufReader::new(&stream);
            loop {
                let mut line = String::new();
                request.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
            }
            let body = "data: {\"type\":\"session.idle\",\"properties\":{\"sessionID\":\"provider-session\"}}\r\n\r\n";
            if chunked {
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{body}\r\n", body.len()).unwrap();
            } else {
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n{body}"
                )
                .unwrap();
            }
            stream.flush().unwrap();
            let _ = released.recv();
        });
        let cancellation = StructuredReaderCancellation {
            shutdown: Arc::new(AtomicBool::new(false)),
            rollback: Arc::new(AtomicBool::new(false)),
        };
        let reader = spawn_structured_sse_reader(StructuredSseDriver {
            protocol: "opencode-sse".to_string(),
            port,
            db_path: core.paths.db_path(),
            session_id: "session".to_string(),
            node_id: "node".to_string(),
            adapter_id: "opencode".to_string(),
            seq: Arc::new(AtomicU64::new(0)),
            rpc_state: Arc::new(Mutex::new(StructuredAgentRpcState {
                opencode: OpenCodeRpcState {
                    session_id: Some("provider-session".to_string()),
                    ..Default::default()
                },
                ..Default::default()
            })),
            events: Arc::new(NullEventSink),
            cancellation: cancellation.clone(),
            model: None,
            thinking: None,
            approval_policy: None,
            protocol_state: Arc::new(Mutex::new(AgentProtocolStreamState::default())),
        });
        let persisted = wait_until(|| {
            !load_session_chunks(&core.lock_db().unwrap(), "session")
                .unwrap()
                .is_empty()
        });
        cancellation.shutdown.store(true, Ordering::SeqCst);
        release.send(()).unwrap();
        reader.join().unwrap();
        server.join().unwrap();
        assert!(
            persisted,
            "SSE tail must flush while the server remains silent (chunked={chunked})"
        );
    }
}

#[test]
fn history_maintenance_enforces_global_limit_repeatedly() {
    let core = Core::new(
        test_init("delivery-periodic-retention"),
        Arc::new(NullEventSink),
    )
    .unwrap();
    {
        let db = core.lock_db().unwrap();
        session(&db, "one");
        session(&db, "two");
        db.execute("INSERT INTO settings (key, value_json, updated_at) VALUES ('sessionTranscriptGlobalRetentionBytes', '1048576', ?1)", params![now()]).unwrap();
    }
    let shutdown = Arc::new(AtomicBool::new(false));
    let worker = spawn_history_maintenance_worker(
        core.paths.db_path(),
        Arc::new(NullEventSink),
        shutdown.clone(),
        Duration::from_millis(30),
    );
    for seq in 1..=2 {
        {
            let db = core.lock_db().unwrap();
            persist_session_stream_chunk(&db, "one", seq, "pty", &vec![b'a'; 600 * 1024]).unwrap();
            persist_session_stream_chunk(&db, "two", seq, "pty", &vec![b'b'; 600 * 1024]).unwrap();
        }
        assert!(wait_until(|| core
            .lock_db()
            .unwrap()
            .query_row(
                "SELECT COALESCE(SUM(length(data)),0) <= 1048576 FROM session_chunks",
                [],
                |row| row.get::<_, bool>(0)
            )
            .unwrap()));
    }
    shutdown.store(true, Ordering::SeqCst);
    worker.join().unwrap();
}

fn spawn_echo(core: &Core) -> String {
    let (command, args) = test_structured_echo_command();
    let result = core.agent_structured_spawn(json!({ "nodeId":"node", "adapterId":"claude-code", "command":command, "args":args,
        "cwd":core.paths.app_data_dir, "prompt":"", "promptDelivery":"stdin", "protocol":"claude-stream-json" })).unwrap();
    result["id"].as_str().unwrap().to_string()
}

#[test]
fn accepted_send_retries_only_local_persistence_and_retires_empty_drainer() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("delivery-local-settlement"), sink.clone()).unwrap();
    let session_id = spawn_echo(&core);
    core.lock_db().unwrap().execute_batch("CREATE TRIGGER fail_input BEFORE INSERT ON session_chunks
        WHEN NEW.stream = 'agent-input' BEGIN SELECT RAISE(FAIL, 'injected persistence failure'); END;").unwrap();
    let prompt_id = Uuid::now_v7().to_string();
    core.session_prompt_submit(
        json!({ "sessionId":session_id, "clientPromptId":prompt_id, "prompt":"exactly once" }),
    )
    .unwrap();
    assert!(wait_until(|| sink
        .snapshot()
        .iter()
        .any(|(event, _)| event == "agent:prompt-delivery-error")));
    assert_eq!(
        load_prompt_delivery(&core.lock_db().unwrap(), &prompt_id)
            .unwrap()
            .unwrap()
            .state,
        "dispatching"
    );
    assert!(core
        .session_prompt_retry(json!({"deliveryId":prompt_id}))
        .is_err());
    core.lock_db()
        .unwrap()
        .execute_batch("DROP TRIGGER fail_input;")
        .unwrap();
    assert!(wait_until(|| load_prompt_delivery(
        &core.lock_db().unwrap(),
        &prompt_id
    )
    .unwrap()
    .unwrap()
    .state
        == "delivered"));
    assert!(wait_until(|| !core
        .prompt_drainers
        .lock()
        .unwrap()
        .contains(&session_id)));
    assert_eq!(
        core.lock_db()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM session_chunks WHERE stream = 'agent-input'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    let second_id = Uuid::now_v7().to_string();
    core.session_prompt_submit(
        json!({ "sessionId":session_id, "clientPromptId":second_id, "prompt":"next" }),
    )
    .unwrap();
    assert!(wait_until(|| load_prompt_delivery(
        &core.lock_db().unwrap(),
        &second_id
    )
    .unwrap()
    .unwrap()
    .state
        == "delivered"));
}

#[test]
fn restarting_and_spawning_a_resumed_agent_delivers_its_saved_queue() {
    let init = test_init("delivery-restart-resume");
    let req = request("prior", "saved across restart");
    {
        let core = Core::new(init.clone(), Arc::new(NullEventSink)).unwrap();
        let db = core.lock_db().unwrap();
        session(&db, "prior");
        db.execute("UPDATE sessions SET adapter_id = 'codex-cli', command_json = ?1 WHERE id = 'prior'", params![json!({
            "resumeCursor": { "version":1, "driver":StructuredProtocol::CodexAppServer.driver_id(), "value":"thread-native" }
        }).to_string()]).unwrap();
        submit_prompt_delivery(&db, &req).unwrap();
    }
    let core = Core::new(init, Arc::new(NullEventSink)).unwrap();
    assert_eq!(
        load_prompt_delivery(&core.lock_db().unwrap(), &req.client_prompt_id)
            .unwrap()
            .unwrap()
            .state,
        "blocked"
    );
    let (command, args) = test_codex_app_server_command();
    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id":"resume", "command":"agent_structured_spawn", "payload": {
                    "nodeId":"node", "adapterId":"codex-cli", "command":command, "args":args,
                    "cwd":core.paths.app_data_dir, "prompt":"", "promptDelivery":"json-rpc",
                    "protocol":"codex-app-server", "resumeSessionId":"prior"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], true, "{response}");
    let session_id = response["payload"]["id"].as_str().unwrap();
    assert_ne!(session_id, "prior");
    assert!(wait_until(|| load_prompt_delivery(
        &core.lock_db().unwrap(),
        &req.client_prompt_id
    )
    .unwrap()
    .unwrap()
    .state
        == "delivered"));
    let db = core.lock_db().unwrap();
    assert_eq!(
        load_prompt_delivery(&db, &req.client_prompt_id)
            .unwrap()
            .unwrap()
            .session_id,
        session_id
    );
    assert!(list_prompt_deliveries(&db, "prior").unwrap().is_empty());
    assert!(
        String::from_utf8_lossy(&load_session_chunks(&db, session_id).unwrap().concat())
            .contains("saved across restart")
    );
}

#[test]
fn a_submit_racing_empty_drainer_exit_is_not_stranded() {
    let core = Core::new(test_init("delivery-drainer-race"), Arc::new(NullEventSink)).unwrap();
    for index in 0..24 {
        let session_id = format!("session-{index}");
        session(&core.lock_db().unwrap(), &session_id);
        let req = request(&session_id, "queued concurrently");
        let barrier = std::sync::Barrier::new(2);
        thread::scope(|scope| {
            scope.spawn(|| {
                barrier.wait();
                core.ensure_prompt_drainer(&session_id).unwrap();
            });
            scope.spawn(|| {
                barrier.wait();
                submit_prompt_delivery(&core.lock_db().unwrap(), &req).unwrap();
                core.ensure_prompt_drainer(&session_id).unwrap();
            });
        });
        // No live runtime exists in this fixture: observing 'blocked' proves
        // some worker saw the newly inserted row, rather than losing the wakeup.
        assert!(wait_until(|| load_prompt_delivery(
            &core.lock_db().unwrap(),
            &req.client_prompt_id
        )
        .unwrap()
        .unwrap()
        .state
            == "blocked"));
    }
}
