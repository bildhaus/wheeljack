use super::support::*;
use crate::*;

fn control_fixture(name: &str, depth: u8) -> Core {
    let core = Core::new(test_init(name), Arc::new(NullEventSink)).expect("core");
    let db = core.lock_db().unwrap();
    db.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('project_control', 'Control', ?1, ?2, ?2)",
        params![temp_dir(name).to_string_lossy().to_string(), now()],
    )
    .unwrap();
    db.execute(
        "INSERT INTO canvases (id, project_id, name, theme_id, camera_json, created_at, updated_at)
         VALUES ('canvas_control', 'project_control', 'Canvas', 'mono-dark', '{}', ?1, ?1)",
        params![now()],
    )
    .unwrap();
    for (node_id, title, session_id, node_depth) in [
        ("node_source", "Source", "session_source", depth),
        ("node_peer", "Peer", "session_peer", 0),
    ] {
        db.execute(
            "INSERT INTO nodes
             (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
             VALUES (?1, 'canvas_control', 'agent_terminal', ?2, 0, 0, 600, 360, 0, ?3, ?4, ?4)",
            params![
                node_id,
                title,
                json!({
                    "adapterId": "codex-cli",
                    "sessionId": session_id,
                    "status": "running",
                    "autonomyDepth": node_depth,
                })
                .to_string(),
                now()
            ],
        )
        .unwrap();
        db.execute(
            "INSERT INTO sessions
             (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
             VALUES (?1, ?2, 'codex-cli', '{}', '.', 'running', ?3, ?3, ?3)",
            params![session_id, node_id, now()],
        )
        .unwrap();
    }
    drop(db);
    core
}

fn request(id: &str, action: &str) -> AgentControlRequestDto {
    AgentControlRequestDto {
        request_id: id.to_string(),
        source_session_id: "session_source".to_string(),
        source_node_id: "node_source".to_string(),
        canvas_id: "canvas_control".to_string(),
        action: action.to_string(),
        target: None,
        message: None,
        task_id: None,
        adapter_id: None,
        files: None,
    }
}

#[test]
fn ask_sessions_can_inspect_agents_but_cannot_delegate() {
    let core = control_fixture("agent-control-ask", 0);
    {
        let db = core.lock_db().unwrap();
        db.execute(
            "UPDATE sessions SET intent = 'ask' WHERE id = 'session_source'",
            [],
        )
        .unwrap();
    }

    let listed = {
        let db = core.lock_db().unwrap();
        authorize_agent_control(&db, request("ask-list", "list_agents")).unwrap()
    };
    assert_eq!(listed.decision, "allow");

    let mut delegated = request("ask-message", "send_message");
    delegated.target = Some("Peer".to_string());
    delegated.message = Some("Make this change for me.".to_string());
    let denied = {
        let db = core.lock_db().unwrap();
        authorize_agent_control(&db, delegated).unwrap()
    };
    assert_eq!(denied.decision, "deny");
    assert_eq!(
        denied.reason,
        "Ask sessions cannot delegate or mutate workspace state."
    );
}

#[test]
fn agent_control_authorizes_workspace_messages_and_deduplicates_requests() {
    let core = control_fixture("agent-control-message", 0);
    let mut req = request("message-1", "send_message");
    req.target = Some("Peer".to_string());
    req.message = Some("Please inspect the parser.".to_string());
    let first = {
        let db = core.lock_db().unwrap();
        authorize_agent_control(&db, req.clone()).unwrap()
    };
    assert_eq!(first.decision, "allow");
    assert_eq!(first.target_node_id.as_deref(), Some("node_peer"));

    let second = {
        let db = core.lock_db().unwrap();
        authorize_agent_control(&db, req).unwrap()
    };
    assert_eq!(second.decision, "allow");
    let altered = {
        let db = core.lock_db().unwrap();
        let mut altered = request("message-1", "send_message");
        altered.target = Some("Different peer".to_string());
        altered.message = Some("Changed payload".to_string());
        authorize_agent_control(&db, altered).unwrap()
    };
    assert_eq!(altered.decision, "deny");
    assert!(altered.reason.contains("different payload"));
    let count: i64 = core
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM session_events WHERE session_id = 'session_source' AND kind = 'agent_control'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);

    {
        let db = core.lock_db().unwrap();
        record_agent_control_result(
            &db,
            AgentControlResultRequest {
                request_id: "message-1".to_string(),
                source_session_id: "session_source".to_string(),
                success: true,
                message: "Delivered".to_string(),
                target_node_id: Some("node_peer".to_string()),
                child_node_id: None,
            },
        )
        .unwrap();
    }
    let replay = {
        let db = core.lock_db().unwrap();
        let mut replay = request("message-1", "send_message");
        replay.target = Some("Peer".to_string());
        replay.message = Some("Please inspect the parser.".to_string());
        authorize_agent_control(&db, replay).unwrap()
    };
    assert_eq!(replay.decision, "deny");
    assert!(replay.reason.contains("replay"));

    let mut invalid_new_target = request("message-new", "send_message");
    invalid_new_target.target = Some("new".to_string());
    invalid_new_target.message = Some("This requires an existing peer.".to_string());
    let error = {
        let db = core.lock_db().unwrap();
        authorize_agent_control(&db, invalid_new_target).unwrap_err()
    };
    assert!(error.to_string().contains("existing agent target"));
}

#[test]
fn agent_control_enforces_depth_and_records_durable_results() {
    let core = control_fixture("agent-control-depth", 2);
    let mut req = request("spawn-1", "spawn_agent");
    req.message = Some("Implement the focused test.".to_string());
    let authorization = {
        let db = core.lock_db().unwrap();
        authorize_agent_control(&db, req).unwrap()
    };
    assert_eq!(authorization.decision, "deny");
    assert!(authorization.reason.contains("depth limit"));

    {
        let db = core.lock_db().unwrap();
        record_agent_control_result(
            &db,
            AgentControlResultRequest {
                request_id: "spawn-1".to_string(),
                source_session_id: "session_source".to_string(),
                success: false,
                message: authorization.reason,
                target_node_id: None,
                child_node_id: None,
            },
        )
        .unwrap();
        let audit = list_agent_control_audit(&db, "canvas_control", 10).unwrap();
        assert_eq!(audit.len(), 2);
        assert_eq!(audit[0].status, "failed");
        assert_eq!(audit[1].status, "denied");
    }
}

#[test]
fn agent_control_child_limit_reserves_authorized_launches() {
    let core = control_fixture("agent-control-children", 0);
    {
        let db = core.lock_db().unwrap();
        db.execute(
            "INSERT INTO settings (key, value_json, updated_at) VALUES ('agentAutonomyPolicy', ?1, ?2)",
            params![
                json!({
                    "enabled": true,
                    "listAgents": "allow",
                    "sendMessage": "allow",
                    "spawnAgent": "allow",
                    "handoffTask": "allow",
                    "requestReview": "allow",
                    "maxDepth": 2,
                    "maxChildrenPerAgent": 1,
                    "maxConcurrentAgents": 8,
                    "maxActionsPerMinute": 20,
                })
                .to_string(),
                now()
            ],
        )
        .unwrap();
    }
    let mut first = request("spawn-first", "spawn_agent");
    first.message = Some("First child".to_string());
    {
        let db = core.lock_db().unwrap();
        assert_eq!(
            authorize_agent_control(&db, first).unwrap().decision,
            "allow"
        );
    }
    let mut second = request("spawn-second", "spawn_agent");
    second.message = Some("Second child".to_string());
    let denied = {
        let db = core.lock_db().unwrap();
        authorize_agent_control(&db, second).unwrap()
    };
    assert_eq!(denied.decision, "deny");
    assert!(denied.reason.contains("child limit"));

    {
        let db = core.lock_db().unwrap();
        record_agent_control_result(
            &db,
            AgentControlResultRequest {
                request_id: "spawn-first".to_string(),
                source_session_id: "session_source".to_string(),
                success: false,
                message: "Launch failed".to_string(),
                target_node_id: None,
                child_node_id: None,
            },
        )
        .unwrap();
    }
    let mut third = request("spawn-third", "spawn_agent");
    third.message = Some("Third child".to_string());
    let allowed_after_failure = {
        let db = core.lock_db().unwrap();
        authorize_agent_control(&db, third).unwrap()
    };
    assert_eq!(allowed_after_failure.decision, "allow");
}

#[test]
fn agent_control_prompt_advertises_all_tools_only_when_enabled() {
    let enabled = append_agent_control_instructions(
        "Do the task.",
        &AgentAutonomyPolicyDto::default(),
        Some("TASK-1"),
    );
    for action in [
        "list_agents",
        "send_message",
        "spawn_agent",
        "handoff_task",
        "request_review",
        "resolve_file_conflict",
    ] {
        assert!(enabled.contains(action));
    }
    assert!(enabled.contains("TASK-1"));

    let disabled = append_agent_control_instructions(
        "Do the task.",
        &AgentAutonomyPolicyDto {
            enabled: false,
            ..AgentAutonomyPolicyDto::default()
        },
        None,
    );
    assert_eq!(disabled, "Do the task.");
}

#[test]
fn agent_control_authorizes_claim_releases_with_an_explicit_remaining_file_set() {
    let core = control_fixture("agent-control-resolve-file-conflict", 0);
    let mut req = request("resolve-1", "resolve_file_conflict");
    req.task_id = Some("task-1".to_string());
    req.files = Some(vec!["src/owned.rs".to_string()]);
    let authorization = {
        let db = core.lock_db().unwrap();
        authorize_agent_control(&db, req).unwrap()
    };
    assert_eq!(authorization.decision, "allow");

    let mut missing_files = request("resolve-2", "resolve_file_conflict");
    missing_files.task_id = Some("task-1".to_string());
    let error = {
        let db = core.lock_db().unwrap();
        authorize_agent_control(&db, missing_files).unwrap_err()
    };
    assert!(error.to_string().contains("remaining file set"));
}
