use super::support::*;
use crate::agent_protocol::MAX_AGENT_TOOL_OUTPUT_BYTES;
use crate::*;

#[test]
fn detects_legacy_hidden_coordination_transport_prompt() {
    let hidden_prompt = [
        "txtl workspace coordination:",
        "- Your callsign is Atlas.",
        "- Shared task file: D:/DEV/txtl/.txtl/coordination/cwd/tasks.md",
        "",
        "User instruction:",
        "Fix the terminal cwd defaults",
    ]
    .join("\n");

    assert!(contains_coordination_prompt_text(&hidden_prompt));
    assert!(contains_coordination_prompt_bytes(hidden_prompt.as_bytes()));
    assert!(!contains_coordination_prompt_text(
        "Fix the terminal cwd defaults"
    ));
}

#[test]
fn agent_protocol_parse_matches_reference_protocol_cases() {
    let core = Core::new(test_init("agent-protocol-parse"), Arc::new(NullEventSink)).expect("core");

    let cases = [
        (
            "custom-claude",
            Some("claude-stream-json"),
            json!({
                "type": "stream_event",
                "event": {
                    "type": "content_block_delta",
                    "delta": { "type": "text_delta", "text": " stream" }
                }
            }),
            "assistant_delta",
            " stream",
        ),
        (
            "custom-codex",
            Some("codex-app-server"),
            json!({
                "method": "item/commandExecution/outputDelta",
                "params": { "item_id": "cmd-1", "delta": "pass\n" }
            }),
            "tool_delta",
            "pass\n",
        ),
        (
            "custom-opencode",
            Some("opencode-sse"),
            json!({
                "payload": {
                    "type": "message.part.delta",
                    "properties": {
                        "delta": "Test",
                        "field": "text",
                        "messageID": "message-1",
                        "partID": "part-1",
                        "sessionID": "session-1"
                    }
                }
            }),
            "assistant_delta",
            "Test",
        ),
        (
            "hermes-agent",
            Some("hermes-acp"),
            json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": "session-1",
                    "update": {
                        "content": {
                            "text": "Model switched",
                            "type": "text"
                        },
                        "sessionUpdate": "agent_message_chunk"
                    }
                }
            }),
            "assistant_delta",
            "Model switched",
        ),
        (
            "custom-pi",
            Some("pi-rpc"),
            json!({
                "type": "message_update",
                "assistantMessageEvent": {
                    "type": "thinking_delta",
                    "delta": "checking"
                }
            }),
            "reasoning_delta",
            "checking",
        ),
    ];

    for (adapter_id, protocol, line, event_type, text) in cases {
        let request = json!({
            "id": "parse",
            "command": "agent_protocol_parse",
            "payload": {
                "adapterId": adapter_id,
                "protocol": protocol,
                "line": line.to_string()
            }
        });
        let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
        assert_eq!(parsed["ok"], true);
        assert_eq!(parsed["payload"]["events"][0]["type"], event_type);
        assert_eq!(parsed["payload"]["events"][0]["text"], text);
    }

    let noisy = json!({
        "id": "parse-noisy",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "codex-cli",
            "line": "Reading additional input from stdin..."
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&noisy.to_string())).unwrap();
    assert_eq!(parsed["payload"]["events"].as_array().unwrap().len(), 0);
}

#[test]
fn structured_reader_emits_incremental_updates_and_warns_on_oversized_lines() {
    let sink = Arc::new(RecordingSink::default());
    let mut input = vec![b'x'; MAX_STRUCTURED_LINE_BYTES + 1];
    input.push(b'\n');
    input.extend_from_slice(
        json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "delta": { "type": "text_delta", "text": "ok" }
            }
        })
        .to_string()
        .as_bytes(),
    );
    input.push(b'\n');

    spawn_structured_line_reader(
        PathBuf::new(),
        "session-bounded".to_string(),
        "node-bounded".to_string(),
        "custom-claude".to_string(),
        "stdout".to_string(),
        std::io::Cursor::new(input),
        Arc::new(AtomicU64::new(0)),
        sink.clone(),
        "claude-stream-json".to_string(),
        Arc::new(Mutex::new(AgentProtocolStreamState::default())),
        None,
        StructuredReaderCancellation {
            shutdown: Arc::new(AtomicBool::new(false)),
            rollback: Arc::new(AtomicBool::new(false)),
        },
    )
    .join()
    .unwrap();

    let events = sink.snapshot();
    let updates = events
        .iter()
        .filter(|(event, _)| event == "agent:protocol-update")
        .map(|(_, payload)| payload)
        .collect::<Vec<_>>();
    assert_eq!(updates.len(), 2);
    assert_eq!(updates[0]["events"][0]["type"], "status");
    assert!(updates[0]["events"][0]["text"]
        .as_str()
        .unwrap()
        .contains("agent is still running"));
    assert_eq!(updates[1]["seq"], 2);
    assert_eq!(
        updates[1]["messages"].as_array().unwrap().last().unwrap()["text"],
        "ok"
    );
    assert_eq!(
        events
            .iter()
            .filter(|(event, _)| event == "agent:structured-line")
            .count(),
        1
    );
}

#[test]
fn structured_reader_emits_completed_opencode_controls_outside_messages() {
    let sink = Arc::new(RecordingSink::default());
    let control = "wheeljack.project_documents {\"requestId\":\"request-live\",\"documents\":{\"kanban\":\"# Kanban\",\"prd\":\"# Product\",\"tdd\":\"# Design\"}}";
    let mut input = Vec::new();
    for event in [
        json!({
            "type": "message.part.updated",
            "properties": { "part": {
                "id": "text-live",
                "messageID": "message-live",
                "type": "text",
                "text": ""
            }}
        }),
        json!({
            "type": "message.part.delta",
            "properties": {
                "delta": "wheeljack.",
                "field": "text",
                "messageID": "message-live",
                "partID": "text-live"
            }
        }),
        json!({
            "type": "message.part.delta",
            "properties": {
                "delta": control.strip_prefix("wheeljack.").unwrap(),
                "field": "text",
                "messageID": "message-live",
                "partID": "text-live"
            }
        }),
        json!({ "type": "session.idle", "properties": { "sessionID": "session-live" } }),
    ] {
        input.extend_from_slice(event.to_string().as_bytes());
        input.push(b'\n');
    }

    spawn_structured_line_reader(
        PathBuf::new(),
        "session-live".to_string(),
        "node-live".to_string(),
        "opencode".to_string(),
        "stdout".to_string(),
        std::io::Cursor::new(input),
        Arc::new(AtomicU64::new(0)),
        sink.clone(),
        "opencode-sse".to_string(),
        Arc::new(Mutex::new(AgentProtocolStreamState::default())),
        None,
        StructuredReaderCancellation {
            shutdown: Arc::new(AtomicBool::new(false)),
            rollback: Arc::new(AtomicBool::new(false)),
        },
    )
    .join()
    .unwrap();

    let events = sink.snapshot();
    let updates = events
        .iter()
        .filter(|(event, _)| event == "agent:protocol-update")
        .map(|(_, payload)| payload)
        .collect::<Vec<_>>();
    let controls = updates
        .iter()
        .flat_map(|payload| payload["controls"].as_array().into_iter().flatten())
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    assert_eq!(controls, vec![control]);
    assert!(updates.iter().all(|payload| {
        payload["messages"].as_array().is_none_or(|messages| {
            messages.iter().all(|message| {
                !message["text"]
                    .as_str()
                    .unwrap_or_default()
                    .contains("wheeljack.project_documents")
            })
        })
    }));
}

#[test]
fn structured_reader_bounds_codex_output_delta_floods() {
    const DELTAS: usize = 5_000;
    let sink = Arc::new(RecordingSink::default());
    let mut input = Vec::new();
    let mut push_line = |value: Value| {
        input.extend_from_slice(value.to_string().as_bytes());
        input.push(b'\n');
    };
    push_line(json!({
        "method": "item/started",
        "params": { "item": { "id": "cmd-flood", "type": "commandExecution", "command": "noisy command" } }
    }));
    let delta = "x".repeat(512);
    for _ in 0..DELTAS {
        push_line(json!({
            "method": "item/commandExecution/outputDelta",
            "params": { "item_id": "cmd-flood", "delta": delta }
        }));
    }
    let final_output = format!(
        "{}FINAL_ERROR",
        "y".repeat(MAX_AGENT_TOOL_OUTPUT_BYTES + 1_024)
    );
    push_line(json!({
        "method": "item/completed",
        "params": { "item": { "id": "cmd-flood", "type": "commandExecution", "output": final_output } }
    }));

    spawn_structured_line_reader(
        PathBuf::new(),
        "session-flood".to_string(),
        "node-flood".to_string(),
        "codex-cli".to_string(),
        "stdout".to_string(),
        std::io::Cursor::new(input),
        Arc::new(AtomicU64::new(0)),
        sink.clone(),
        "codex-app-server".to_string(),
        Arc::new(Mutex::new(AgentProtocolStreamState::default())),
        None,
        StructuredReaderCancellation {
            shutdown: Arc::new(AtomicBool::new(false)),
            rollback: Arc::new(AtomicBool::new(false)),
        },
    )
    .join()
    .unwrap();

    let events = sink.snapshot();
    let updates = events
        .iter()
        .filter(|(event, _)| event == "agent:protocol-update")
        .map(|(_, payload)| payload)
        .collect::<Vec<_>>();
    assert!(
        updates.len() < 100,
        "output flood emitted {} full snapshots",
        updates.len()
    );
    let emitted_event_types = updates
        .iter()
        .flat_map(|payload| payload["events"].as_array().into_iter().flatten())
        .filter_map(|event| event["type"].as_str())
        .collect::<Vec<_>>();
    assert!(emitted_event_types.contains(&"tool_start"));
    assert!(emitted_event_types.contains(&"tool_delta"));
    assert!(emitted_event_types.contains(&"tool_end"));
    let largest_emitted_tool_delta = updates
        .iter()
        .flat_map(|payload| payload["events"].as_array().into_iter().flatten())
        .filter(|event| event["type"] == "tool_delta")
        .filter_map(|event| event["text"].as_str())
        .map(str::len)
        .max()
        .unwrap_or_default();
    assert!(largest_emitted_tool_delta <= MAX_AGENT_TOOL_OUTPUT_BYTES);
    let final_text = updates
        .last()
        .and_then(|payload| payload["messages"].as_array())
        .and_then(|messages| messages.last())
        .and_then(|message| message["text"].as_str())
        .unwrap();
    assert!(final_text.len() <= MAX_AGENT_TOOL_OUTPUT_BYTES);
    assert!(final_text.starts_with("[Earlier output truncated"));
    assert!(final_text.ends_with("FINAL_ERROR"));
    assert_eq!(
        events
            .iter()
            .filter(|(event, _)| event == "agent:structured-line")
            .count(),
        DELTAS + 2
    );
}

#[test]
fn resume_cursor_is_versioned_and_driver_scoped() {
    let core = Core::new(test_init("resume-cursor"), Arc::new(NullEventSink)).expect("core");
    let db = core.lock_db().unwrap();
    db.execute(
        "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
         VALUES ('session-resume', 'node-resume', 'codex-cli', ?1, '.', 'completed', ?2, ?2, ?2)",
        params![json!({
            "resumeCursor": { "version": 1, "driver": "codex", "value": "thread-1" }
        }).to_string(), now()],
    )
    .unwrap();

    assert_eq!(
        load_agent_resume_cursor(&db, "session-resume", StructuredProtocol::CodexAppServer)
            .unwrap()
            .value,
        "thread-1"
    );
    assert!(
        load_agent_resume_cursor(&db, "session-resume", StructuredProtocol::PiRpc)
            .unwrap_err()
            .to_string()
            .contains("belongs to codex")
    );
    db.execute(
        "UPDATE sessions SET command_json = ?1 WHERE id = 'session-resume'",
        params![json!({
            "resumeCursor": { "version": 2, "driver": "codex", "value": "thread-1" }
        })
        .to_string()],
    )
    .unwrap();
    assert!(
        load_agent_resume_cursor(&db, "session-resume", StructuredProtocol::CodexAppServer)
            .unwrap_err()
            .to_string()
            .contains("version 2 is unsupported")
    );
}

#[test]
fn codex_thread_start_uses_native_resume_request() {
    let (command, args) = test_capture_stdin_line_command();
    let mut child = Command::new(command)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let stdin = Arc::new(Mutex::new(child.stdin.take().unwrap()));
    let driver = StructuredProtocolDriver {
        protocol: "codex-app-server".to_string(),
        cwd: ".".to_string(),
        db_path: PathBuf::new(),
        session_id: "session-resume".to_string(),
        stdin: stdin.clone(),
        rpc_state: Arc::new(Mutex::new(StructuredAgentRpcState {
            codex: CodexRpcState {
                resume_thread_id: Some("thread-1".to_string()),
                ..Default::default()
            },
            ..Default::default()
        })),
        provider: None,
        model: None,
        thinking: None,
        approval_policy: Some("never".to_string()),
        sandbox: Some("danger-full-access".to_string()),
    };
    send_codex_thread_start(&driver).unwrap();
    driver.rpc_state.lock().unwrap().turn_active = true;
    assert!(handle_codex_app_server_line(
        &driver,
        &json!({ "id": 2, "error": { "message": "thread missing" } }),
    )
    .unwrap_err()
    .to_string()
    .contains("thread missing"));
    assert!(!driver.rpc_state.lock().unwrap().turn_active);
    drop(driver);
    drop(stdin);
    let output = child.wait_with_output().unwrap();
    let request: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(request["method"], "thread/resume");
    assert_eq!(request["params"]["threadId"], "thread-1");
    assert_eq!(request["params"]["approvalPolicy"], "never");
    assert_eq!(request["params"]["sandbox"], "danger-full-access");
}

#[test]
fn pi_agent_settled_requests_authoritative_usage_snapshot() {
    let (command, args) = test_capture_stdin_line_command();
    let mut child = Command::new(command)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let stdin = Arc::new(Mutex::new(child.stdin.take().unwrap()));
    let driver = StructuredProtocolDriver {
        protocol: "pi-rpc".to_string(),
        cwd: ".".to_string(),
        db_path: PathBuf::new(),
        session_id: "pi-session".to_string(),
        stdin: stdin.clone(),
        rpc_state: Arc::new(Mutex::new(StructuredAgentRpcState {
            turn_active: true,
            ..Default::default()
        })),
        provider: Some("openrouter".to_string()),
        model: Some("model-pi".to_string()),
        thinking: None,
        approval_policy: None,
        sandbox: None,
    };

    for event in [
        json!({ "type": "message_end", "message": { "role": "user" } }),
        json!({ "type": "message_end", "message": { "role": "assistant" } }),
        json!({ "type": "turn_end" }),
        json!({ "type": "agent_end" }),
    ] {
        handle_structured_protocol_line(&driver, &event.to_string()).unwrap();
        assert!(driver.rpc_state.lock().unwrap().turn_active);
    }

    handle_structured_protocol_line(&driver, &json!({ "type": "agent_settled" }).to_string())
        .unwrap();
    assert!(!driver.rpc_state.lock().unwrap().turn_active);
    drop(driver);
    drop(stdin);
    let output = child.wait_with_output().unwrap();
    let request: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(request["id"], 1);
    assert_eq!(request["type"], "get_session_stats");
}

#[test]
fn codex_turn_start_json_rpc_error_finishes_the_turn() {
    let (command, args) = test_capture_stdin_line_command();
    let mut child = Command::new(command)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let stdin = Arc::new(Mutex::new(child.stdin.take().unwrap()));
    let driver = StructuredProtocolDriver {
        protocol: "codex-app-server".to_string(),
        cwd: ".".to_string(),
        db_path: PathBuf::new(),
        session_id: "codex-turn-error".to_string(),
        stdin: stdin.clone(),
        rpc_state: Arc::new(Mutex::new(StructuredAgentRpcState {
            turn_active: true,
            next_id: 2,
            codex: CodexRpcState {
                thread_id: Some("thread-1".to_string()),
                ..Default::default()
            },
            ..Default::default()
        })),
        provider: None,
        model: None,
        thinking: None,
        approval_policy: None,
        sandbox: None,
    };

    send_codex_turn_start(&driver, "thread-1", &StructuredPrompt::text("test")).unwrap();
    handle_structured_protocol_line(
        &driver,
        &json!({ "id": 99, "error": { "message": "unrelated request failed" } }).to_string(),
    )
    .unwrap();
    assert!(driver.rpc_state.lock().unwrap().turn_active);

    let error = handle_structured_protocol_line(
        &driver,
        &json!({ "id": 3, "error": { "message": "turn rejected" } }).to_string(),
    )
    .unwrap_err();

    assert!(error.to_string().contains("turn rejected"));
    assert!(!driver.rpc_state.lock().unwrap().turn_active);
    drop(driver);
    drop(stdin);
    let output = child.wait_with_output().unwrap();
    let request: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(request["id"], 3);
    assert_eq!(request["method"], "turn/start");
}

#[test]
fn reasoning_stops_streaming_when_the_answer_starts() {
    let core = Core::new(
        test_init("agent-protocol-reasoning-complete"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "parse",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "claude-code",
            "protocol": "claude-stream-json",
            "nodeId": "node-1",
            "lines": [
                json!({
                    "type": "stream_event",
                    "event": {
                        "type": "content_block_delta",
                        "delta": { "type": "thinking_delta", "text": "Checking the request" }
                    }
                }).to_string(),
                json!({
                    "type": "stream_event",
                    "event": {
                        "type": "content_block_delta",
                        "delta": { "type": "text_delta", "text": "Done" }
                    }
                }).to_string(),
                json!({ "type": "result", "is_error": false }).to_string()
            ]
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();

    assert_eq!(messages[0]["kind"], "reasoning");
    assert_eq!(messages[0]["streaming"], false);
    assert_eq!(messages[1]["kind"], "message");
    assert_eq!(messages[1]["streaming"], false);
}

#[test]
fn turn_completion_stops_all_streaming_messages() {
    let core = Core::new(
        test_init("agent-protocol-all-streams-complete"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "parse",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "generic",
            "nodeId": "node-1",
            "lines": [
                json!({ "type": "assistant.delta", "delta": "Finished answer" }).to_string(),
                json!({ "type": "status", "text": "Wrapping up" }).to_string(),
                json!({ "type": "turn.done" }).to_string()
            ]
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();

    assert_eq!(messages[0]["kind"], "message");
    assert_eq!(messages[0]["streaming"], false);
    assert_eq!(parsed["payload"]["active"], false);
}

#[test]
fn claude_tool_input_chunks_ignore_untyped_block_stop() {
    let core = Core::new(
        test_init("claude-tool-input-chunks"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let lines = [
        json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "content_block": { "type": "tool_use", "id": "tool-1", "name": "Write", "input": {} }
            }
        }),
        json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "delta": { "type": "input_json_delta", "partial_json": "{\"file_path\":\"KAN" }
            }
        }),
        json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "delta": { "type": "input_json_delta", "partial_json": "BAN.md\"}" }
            }
        }),
        json!({
            "type": "stream_event",
            "event": { "type": "content_block_stop" }
        }),
    ]
    .map(|line| line.to_string());
    let parsed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "parse",
                "command": "agent_protocol_parse",
                "payload": {
                    "adapterId": "claude-code",
                    "protocol": "claude-stream-json",
                    "nodeId": "node-1",
                    "lines": lines
                }
            })
            .to_string(),
        ),
    )
    .unwrap();

    assert_eq!(parsed["payload"]["messages"].as_array().unwrap().len(), 1);
    assert_eq!(parsed["payload"]["messages"][0]["title"], "Write");
    assert_eq!(
        parsed["payload"]["messages"][0]["text"],
        "{\"file_path\":\"KANBAN.md\"}"
    );
    assert_eq!(parsed["payload"]["messages"][0]["streaming"], true);
    assert!(parsed["payload"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .all(|event| event["type"] != "tool_end"));
}

#[test]
fn claude_tool_result_keeps_output_and_call_id() {
    let core = Core::new(test_init("claude-tool-result"), Arc::new(NullEventSink)).expect("core");
    let parsed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "parse",
                "command": "agent_protocol_parse",
                "payload": {
                    "adapterId": "claude-code",
                    "protocol": "claude-stream-json",
                    "line": json!({
                        "type": "user",
                        "message": {
                            "role": "user",
                            "content": [{
                                "type": "tool_result",
                                "tool_use_id": "toolu_01SqftfWx8GxJzJLECmJgity",
                                "content": "WHEELJACK_APPROVAL_PROBE",
                                "is_error": false
                            }]
                        }
                    }).to_string()
                }
            })
            .to_string(),
        ),
    )
    .unwrap();

    assert_eq!(parsed["payload"]["events"][0]["type"], "tool_end");
    assert_eq!(
        parsed["payload"]["events"][0]["toolCallId"],
        "toolu_01SqftfWx8GxJzJLECmJgity"
    );
    assert_eq!(
        parsed["payload"]["events"][0]["text"],
        "WHEELJACK_APPROVAL_PROBE"
    );
}

#[test]
fn native_permission_events_become_actionable_approvals() {
    let core = Core::new(
        test_init("agent-protocol-approvals"),
        Arc::new(NullEventSink),
    )
    .unwrap();
    let cases = [
        (
            "codex-cli",
            None,
            json!({
                "id": 41,
                "method": "item/commandExecution/requestApproval",
                "params": { "command": "cargo test", "itemId": "item-1" }
            }),
            "Command",
            "cargo test",
        ),
        (
            "claude-code",
            Some("claude-stream-json"),
            json!({
                "type": "control_request",
                "request_id": "request-1",
                "request": { "subtype": "can_use_tool", "tool_name": "Bash", "input": { "command": "cargo test" } }
            }),
            "Bash",
            "cargo test",
        ),
        (
            "opencode",
            Some("opencode-sse"),
            json!({
                "type": "permission.asked",
                "properties": { "id": "per-1", "sessionID": "ses-1", "permission": "bash", "patterns": ["cargo test"], "metadata": {}, "always": [] }
            }),
            "bash",
            "cargo test",
        ),
    ];
    for (adapter_id, protocol, line, title, scope) in cases {
        let parsed: Value = serde_json::from_str(&core.call_json(&json!({
            "id": adapter_id,
            "command": "agent_protocol_parse",
            "payload": { "adapterId": adapter_id, "protocol": protocol, "line": line.to_string() }
        }).to_string())).unwrap();
        assert_eq!(
            parsed["payload"]["events"][0]["type"], "approval_request",
            "{adapter_id}: {parsed}"
        );
        if adapter_id == "opencode" {
            assert_eq!(parsed["payload"]["events"][0]["interactionId"], "per-1");
            assert_eq!(parsed["payload"]["messages"][0]["interactionId"], "per-1");
        }
        if adapter_id == "claude-code" {
            assert_eq!(parsed["payload"]["events"][0]["interactionId"], "request-1");
            assert_eq!(
                parsed["payload"]["messages"][0]["interactionId"],
                "request-1"
            );
            assert_eq!(parsed["payload"]["events"][0]["text"], "cargo test");
        }
        assert_eq!(parsed["payload"]["events"][0]["title"], title);
        assert!(parsed["payload"]["events"][0]["text"]
            .as_str()
            .unwrap()
            .contains(scope));
        assert_eq!(parsed["payload"]["active"], true);
    }
}

#[test]
fn claude_interrupted_result_is_canceled_not_failed() {
    let core = Core::new(
        test_init("agent-protocol-claude-canceled"),
        Arc::new(NullEventSink),
    )
    .unwrap();
    let parsed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "parse",
                "command": "agent_protocol_parse",
                "payload": {
                    "adapterId": "claude-code",
                    "protocol": "claude-stream-json",
                    "line": json!({
                        "type": "result",
                        "subtype": "error_during_execution",
                        "is_error": true,
                        "result": "Request interrupted by user"
                    }).to_string()
                }
            })
            .to_string(),
        ),
    )
    .unwrap();

    assert_eq!(parsed["payload"]["events"][0]["type"], "turn_canceled");
    assert_eq!(parsed["payload"]["active"], false);
}

#[test]
fn claude_ask_user_question_is_actionable_and_returns_the_answer() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("claude-question-response"), sink.clone()).expect("core");
    let (command, args) = test_claude_question_command();
    let spawned: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "spawn",
                "command": "agent_structured_spawn",
                "payload": {
                    "nodeId": "node_question",
                    "adapterId": "claude-code",
                    "command": command,
                    "args": args,
                    "cwd": std::env::current_dir().unwrap(),
                    "prompt": "choose",
                    "promptDelivery": "stdin",
                    "protocol": "claude-stream-json"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(spawned["ok"], true);
    let session_id = spawned["payload"]["id"].as_str().unwrap();

    let deadline = Instant::now() + Duration::from_secs(5);
    while !structured_event_lines(&sink)
        .iter()
        .any(|line| line.contains("AskUserQuestion"))
    {
        assert!(Instant::now() < deadline, "timed out waiting for question");
        thread::sleep(Duration::from_millis(20));
    }

    let parsed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "parse",
                "command": "agent_protocol_parse",
                "payload": {
                    "adapterId": "claude-code",
                    "protocol": "claude-stream-json",
                    "lines": structured_event_lines(&sink)
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(parsed["payload"]["events"][0]["type"], "question_request");
    assert_eq!(parsed["payload"]["events"][0]["text"], "Which workspace?");

    let answered: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "answer",
                "command": "agent_structured_respond",
                "payload": {
                    "sessionId": session_id,
                    "approved": true,
                    "response": "Primary"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(answered["ok"], true);

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let lines = structured_event_lines(&sink);
        if lines.iter().any(|line| {
            line.contains("\"answers\":{\"Which workspace?\":\"Primary\"}")
                && line.contains("\"behavior\":\"allow\"")
        }) {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for question answer; lines: {lines:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn agent_protocol_parse_reduces_codex_permission_request_to_approval_message() {
    let core = Core::new(
        test_init("agent-protocol-codex-permission"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "parse",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "codex-cli",
            "protocol": "codex-app-server",
            "line": json!({
                "method": "item/permissions/requestApproval",
                "id": 61,
                "params": {
                    "threadId": "thr-1",
                    "turnId": "turn-1",
                    "itemId": "call-1",
                    "reason": "Select a workspace root",
                    "permissions": { "fileSystem": { "write": ["C:/workspace"] } }
                }
            }).to_string()
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();

    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["role"], "system");
    assert_eq!(messages[0]["kind"], "approval");
    assert_eq!(messages[0]["title"], "Permissions");
    assert!(messages[0]["text"]
        .as_str()
        .unwrap()
        .contains("Select a workspace root"));
    assert!(messages[0]["text"]
        .as_str()
        .unwrap()
        .contains("C:/workspace"));
    assert_eq!(parsed["payload"]["active"], true);

    let command: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "parse-command",
                "command": "agent_protocol_parse",
                "payload": {
                    "adapterId": "codex-cli",
                    "protocol": "codex-app-server",
                    "line": json!({
                        "method": "item/commandExecution/requestApproval",
                        "id": 62,
                        "params": {
                            "threadId": "thr-2",
                            "turnId": "turn-2",
                            "itemId": "call-2",
                            "reason": "Needs permission to write files",
                            "permissions": { "fileSystem": { "write": ["C:/workspace"] } }
                        }
                    }).to_string()
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    let command_message = &command["payload"]["messages"][0];
    assert_eq!(command_message["kind"], "approval");
    assert_eq!(command_message["title"], "Command");
    assert!(command_message["text"]
        .as_str()
        .unwrap()
        .contains("Needs permission to write files"));
    assert!(command_message["text"]
        .as_str()
        .unwrap()
        .contains("C:/workspace"));
    assert_eq!(command["payload"]["active"], true);
}

#[test]
fn agent_protocol_parse_preserves_codex_questions_and_canceled_turns() {
    let core = Core::new(
        test_init("agent-protocol-codex-question"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let parse = |line: Value| {
        serde_json::from_str::<Value>(
            &core.call_json(
                &json!({
                    "id": "parse",
                    "command": "agent_protocol_parse",
                    "payload": {
                        "adapterId": "codex-cli",
                        "protocol": "codex-app-server",
                        "line": line.to_string()
                    }
                })
                .to_string(),
            ),
        )
        .unwrap()
    };

    let question = parse(json!({
        "method": "item/tool/requestUserInput",
        "id": 62,
        "params": {
            "questions": [{
                "id": "workspace",
                "header": "Workspace",
                "question": "Which workspace?"
            }]
        }
    }));
    assert_eq!(question["payload"]["messages"][0]["kind"], "question");
    assert_eq!(question["payload"]["messages"][0]["title"], "Workspace");
    assert_eq!(
        question["payload"]["messages"][0]["text"],
        "Which workspace?"
    );

    let canceled = parse(json!({
        "method": "turn/completed",
        "params": { "turn": { "id": "turn-1", "status": "interrupted" } }
    }));
    assert_eq!(canceled["payload"]["events"][0]["type"], "turn_canceled");
    assert_eq!(canceled["payload"]["active"], false);
}

#[test]
fn agent_protocol_parse_keeps_codex_activity_transient_and_hides_control_messages() {
    let core = Core::new(
        test_init("agent-protocol-codex-chat-format"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let user = json!({
        "method": "item/completed",
        "params": { "item": {
            "type": "userMessage",
            "content": [{ "type": "text", "text": "internal bootstrap prompt" }]
        }}
    });
    let commentary = json!({
        "method": "item/completed",
        "params": { "item": {
            "type": "agentMessage",
            "phase": "commentary",
            "text": "Inspecting repository evidence."
        }}
    });
    let parse = |lines: Vec<String>| {
        serde_json::from_str::<Value>(
            &core.call_json(
                &json!({
                    "id": "parse",
                    "command": "agent_protocol_parse",
                    "payload": {
                        "adapterId": "codex-cli",
                        "protocol": "codex-app-server",
                        "nodeId": "node-codex",
                        "lines": lines
                    }
                })
                .to_string(),
            ),
        )
        .unwrap()
    };

    let live = parse(vec![user.to_string(), commentary.to_string()]);
    assert_eq!(live["payload"]["messages"].as_array().unwrap().len(), 1);
    assert_eq!(live["payload"]["messages"][0]["kind"], "commentary");
    assert_eq!(live["payload"]["messages"][0]["title"], "Working");
    assert_eq!(
        live["payload"]["messages"][0]["text"],
        "Inspecting repository evidence."
    );

    let streamed_live = parse(vec![
        user.to_string(),
        json!({ "method": "item/agentMessage/delta", "params": { "delta": "Inspecting repository " } }).to_string(),
        json!({ "method": "item/agentMessage/delta", "params": { "delta": "evidence." } }).to_string(),
        commentary.to_string(),
    ]);
    assert_eq!(
        streamed_live["payload"]["messages"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        streamed_live["payload"]["messages"][0]["kind"],
        "commentary"
    );

    let control = json!({
        "method": "item/completed",
        "params": { "item": {
            "type": "agentMessage",
            "phase": "final_answer",
            "text": "wheeljack.project_documents {\"requestId\":\"request-1\",\"documents\":{}}"
        }}
    });
    let completed = parse(vec![
        user.to_string(),
        commentary.to_string(),
        json!({ "method": "item/agentMessage/delta", "params": { "delta": "wheel" } }).to_string(),
        json!({ "method": "item/agentMessage/delta", "params": { "delta": "jack.project_documents {\"requestId\":\"request-1\",\"documents\":{}}" } }).to_string(),
        control.to_string(),
        json!({ "method": "turn/completed", "params": { "turn": { "status": "completed" } } })
            .to_string(),
    ]);
    assert!(completed["payload"]["messages"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(completed["payload"]["active"], false);

    let echoed_autonomy_prompt = parse(vec![
        user.to_string(),
        json!({
            "method": "item/completed",
            "params": { "item": {
                "type": "agentMessage",
                "phase": "final_answer",
                "text": "Useful result.\n\nwheeljack autonomous controls:\n- internal instructions\n- wheeljack.control {\"id\":\"hidden\"}"
            }}
        })
        .to_string(),
        json!({ "method": "turn/completed", "params": { "turn": { "status": "completed" } } })
            .to_string(),
    ]);
    assert_eq!(
        echoed_autonomy_prompt["payload"]["messages"][0]["text"],
        "Useful result."
    );
}

#[test]
fn agent_protocol_hides_control_messages_split_across_live_codex_deltas() {
    let request = AgentProtocolParseRequest {
        adapter_id: "codex-cli".to_string(),
        protocol: Some("codex-app-server".to_string()),
        node_id: Some("node-codex".to_string()),
        output_role: None,
        limit: None,
        line: None,
        lines: Vec::new(),
        transcript: None,
        chunks: None,
        user_prompt: None,
    };
    let parse_delta = |sequence: usize, delta: &str| {
        parse_agent_protocol_line(
            "codex-cli",
            Some("codex-app-server"),
            &json!({ "method": "item/agentMessage/delta", "params": { "delta": delta } })
                .to_string(),
            sequence,
        )
    };

    for chunks in [
        [
            "wheel",
            "jack.project_documents {",
            "\"requestId\":\"request-1\"}",
        ],
        [
            "wheeljack.project_documents {",
            "\"requestId\":\"request-1\"}",
            "",
        ],
    ] {
        let mut state = AgentProtocolStreamState::default();
        for (index, chunk) in chunks
            .into_iter()
            .filter(|chunk| !chunk.is_empty())
            .enumerate()
        {
            let events = parse_delta(index + 1, chunk);
            assert!(!events.is_empty());
            apply_agent_stream_events(&mut state, &events, &request);
            assert!(state.visible_messages().is_empty());
        }
        assert!(state.messages[0].text.contains("requestId"));

        let finalized = parse_agent_protocol_line(
            "codex-cli",
            Some("codex-app-server"),
            &json!({ "method": "item/completed", "params": { "item": {
                "type": "agentMessage",
                "phase": "final_answer",
                "text": "wheeljack.project_documents {\"requestId\":\"request-1\",\"documents\":{}}"
            } } })
            .to_string(),
            3,
        );
        assert_eq!(finalized.len(), 1);
        apply_agent_stream_events(&mut state, &finalized, &request);
        assert!(state.visible_messages().is_empty());

        let completed = parse_agent_protocol_line(
            "codex-cli",
            Some("codex-app-server"),
            &json!({ "method": "turn/completed", "params": { "turn": { "status": "completed" } } })
                .to_string(),
            4,
        );
        apply_agent_stream_events(&mut state, &completed, &request);
        assert!(state.messages.is_empty());
    }
}

#[test]
fn agent_protocol_orders_late_opencode_parts_and_dedupes_tool_lifecycle() {
    let core = Core::new(
        test_init("agent-protocol-opencode-part-order"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "parse-opencode-part-order",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "opencode",
            "protocol": "opencode-sse",
            "nodeId": "node-opencode",
            "lines": [
                json!({
                    "type": "message.part.updated",
                    "properties": {
                        "part": {
                            "id": "reasoning-1",
                            "messageID": "message-1",
                            "type": "reasoning",
                            "text": ""
                        }
                    }
                }).to_string(),
                json!({
                    "type": "message.part.updated",
                    "properties": {
                        "part": {
                            "id": "tool-1",
                            "messageID": "message-1",
                            "type": "tool",
                            "tool": "read",
                            "state": { "status": "pending", "input": { "filePath": "README.md" } }
                        }
                    }
                }).to_string(),
                json!({
                    "type": "message.part.updated",
                    "properties": {
                        "part": {
                            "id": "tool-1",
                            "messageID": "message-1",
                            "type": "tool",
                            "tool": "read",
                            "state": { "status": "running", "input": { "filePath": "README.md" } }
                        }
                    }
                }).to_string(),
                json!({
                    "type": "message.part.updated",
                    "properties": {
                        "part": {
                            "id": "tool-1",
                            "messageID": "message-1",
                            "type": "tool",
                            "tool": "read",
                            "state": { "status": "completed", "output": "# wheeljack" }
                        }
                    }
                }).to_string(),
                json!({
                    "type": "message.part.updated",
                    "properties": {
                        "part": {
                            "id": "reasoning-1",
                            "messageID": "message-1",
                            "type": "reasoning",
                            "text": "Let me read the project overview first."
                        }
                    }
                }).to_string(),
                json!({ "type": "session.idle", "properties": { "sessionID": "session-1" } }).to_string()
            ]
        }
    });

    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["kind"], "reasoning");
    assert_eq!(
        messages[0]["text"],
        "Let me read the project overview first."
    );
    assert_eq!(messages[1]["kind"], "tool");
    assert_eq!(messages[1]["title"], "read");
    assert_eq!(messages[1]["streaming"], false);
    assert!(messages[1]["text"].as_str().unwrap().contains("README.md"));
    assert!(messages[1]["text"]
        .as_str()
        .unwrap()
        .contains("# wheeljack"));
}

#[test]
fn agent_protocol_keeps_opencode_text_and_hides_duplicate_reasoning() {
    let core = Core::new(
        test_init("agent-protocol-opencode-duplicate-reasoning"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let repeated = "Let me inspect the current KANBAN and dirty tree first.";
    let request = json!({
        "id": "parse-opencode-duplicate-reasoning",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "opencode",
            "protocol": "opencode-sse",
            "nodeId": "node-opencode",
            "lines": [
                json!({
                    "type": "message.updated",
                    "properties": {
                        "info": { "id": "message-1", "role": "assistant" }
                    }
                }).to_string(),
                json!({
                    "type": "message.part.updated",
                    "properties": {
                        "part": {
                            "id": "text-1",
                            "messageID": "message-1",
                            "type": "text",
                            "text": repeated
                        }
                    }
                }).to_string(),
                json!({
                    "type": "message.part.updated",
                    "properties": {
                        "part": {
                            "id": "reasoning-1",
                            "messageID": "message-1",
                            "type": "reasoning",
                            "text": repeated
                        }
                    }
                }).to_string(),
                json!({ "type": "session.idle", "properties": { "sessionID": "session-1" } }).to_string()
            ]
        }
    });

    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["role"], "assistant");
    assert_eq!(messages[0]["kind"], "message");
    assert_eq!(messages[0]["text"], repeated);
}

#[test]
fn agent_protocol_separates_completed_opencode_controls_from_reasoning() {
    let core = Core::new(
        test_init("agent-protocol-opencode-controls"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let control =
        "wheeljack.task_cards {\"requestId\":\"request-1\",\"cards\":[{\"key\":\"ship-search\"}]}";
    let request = json!({
        "id": "parse-opencode-controls",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "opencode",
            "protocol": "opencode-sse",
            "nodeId": "node-opencode",
            "lines": [
                json!({
                    "type": "message.part.updated",
                    "properties": {
                        "part": {
                            "id": "reasoning-1",
                            "messageID": "message-1",
                            "type": "reasoning",
                            "text": format!("I have enough evidence. {control}")
                        }
                    }
                }).to_string(),
                json!({
                    "type": "message.part.updated",
                    "properties": {
                        "part": {
                            "id": "text-1",
                            "messageID": "message-1",
                            "type": "text",
                            "text": ""
                        }
                    }
                }).to_string(),
                json!({
                    "type": "message.part.delta",
                    "properties": {
                        "delta": "wheeljack.",
                        "field": "text",
                        "messageID": "message-1",
                        "partID": "text-1"
                    }
                }).to_string(),
                json!({
                    "type": "message.part.delta",
                    "properties": {
                        "delta": control.strip_prefix("wheeljack.").unwrap(),
                        "field": "text",
                        "messageID": "message-1",
                        "partID": "text-1"
                    }
                }).to_string(),
                json!({ "type": "session.idle", "properties": { "sessionID": "session-1" } }).to_string()
            ]
        }
    });

    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(parsed["payload"]["controls"], json!([control]));
    let messages = parsed["payload"]["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["kind"], "reasoning");
    assert_eq!(messages[0]["text"], "I have enough evidence.");
}

#[test]
fn agent_protocol_parse_replaces_codex_activity_with_the_final_answer() {
    let core = Core::new(
        test_init("agent-protocol-codex-final-format"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "parse",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "codex-cli",
            "protocol": "codex-app-server",
            "nodeId": "node-codex",
            "lines": [
                json!({ "method": "item/completed", "params": { "item": { "type": "agentMessage", "phase": "commentary", "text": "Inspecting." } } }).to_string(),
                json!({ "method": "item/completed", "params": { "item": { "type": "agentMessage", "phase": "final_answer", "text": "Repository is ready." } } }).to_string(),
                json!({ "method": "turn/completed", "params": { "turn": { "status": "completed" } } }).to_string()
            ]
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();

    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["role"], "assistant");
    assert_eq!(messages[0]["text"], "Repository is ready.");
}

#[test]
fn agent_protocol_parse_recovers_transcripts_and_hides_coordination_prompts() {
    let core = Core::new(
        test_init("agent-protocol-transcript"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "parse",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "opencode",
            "transcript": [
                "user -> recover this",
                "agent -> structured session attached session_1",
                json!({
                    "event": "tool.start",
                    "id": "tool-1",
                    "tool": "bash",
                    "input": { "command": "npm test" }
                }).to_string(),
                json!({
                    "event": "tool.complete",
                    "id": "tool-1",
                    "output": "pass"
                }).to_string(),
                json!({ "event": "message.delta", "text": "Recovered" }).to_string(),
                json!({ "event": "message.delta", "text": " reply" }).to_string(),
                "agent -> structured process exited (0)"
            ],
            "userPrompt": "recover this"
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let events = parsed["payload"]["events"].as_array().unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();
    assert_eq!(
        events
            .iter()
            .map(|event| event["type"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec![
            "user_message",
            "tool_start",
            "tool_end",
            "assistant_delta",
            "assistant_delta",
            "turn_done"
        ]
    );
    assert_eq!(events[0]["text"], "recover this");
    assert_eq!(events[1]["text"], r#"{"command":"npm test"}"#);
    assert_eq!(events[2]["text"], "pass");
    assert_eq!(
        messages
            .iter()
            .map(|message| message["kind"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["message", "tool", "message"]
    );
    assert_eq!(messages[0]["role"], "user");
    assert_eq!(messages[0]["text"], "recover this");
    assert_eq!(messages[1]["title"], "bash");
    assert_eq!(messages[1]["text"], "{\"command\":\"npm test\"}\npass");
    assert_eq!(messages[1]["streaming"], false);
    assert_eq!(messages[2]["role"], "assistant");
    assert_eq!(messages[2]["text"], "Recovered reply");
    assert_eq!(messages[2]["streaming"], false);
    assert_eq!(parsed["payload"]["active"], false);

    let hidden_prompt = [
        "txtl workspace coordination:",
        "- Your callsign is Atlas.",
        "",
        "User instruction:",
        "Fix terminal cwd defaults",
    ]
    .join("\n");
    let hidden = json!({
        "id": "parse-hidden",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "opencode",
            "transcript": [
                format!("user -> {hidden_prompt}"),
                hidden_prompt,
                json!({ "event": "message.delta", "text": "Done" }).to_string()
            ],
            "userPrompt": hidden_prompt
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&hidden.to_string())).unwrap();
    let texts = parsed["payload"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|event| event["text"].as_str())
        .collect::<Vec<_>>();
    assert_eq!(texts, vec!["Fix terminal cwd defaults", "Done"]);
}

#[test]
fn agent_protocol_recovers_wheeljack_user_images_and_interaction_outcomes() {
    let core = Core::new(
        test_init("agent-protocol-wheeljack-history"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "parse-history",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "opencode",
            "protocol": "opencode-sse",
            "nodeId": "node-history",
            "lines": [
                json!({
                    "type": "wheeljack_user_message",
                    "text": "Inspect this",
                    "images": [{
                        "path": "C:/workspace/shot.png",
                        "fileName": "shot.png",
                        "mimeType": "image/png"
                    }]
                }).to_string(),
                json!({
                    "type": "permission.asked",
                    "properties": {
                        "id": "permission-1",
                        "sessionID": "session-1",
                        "permission": "edit",
                        "patterns": ["src/**"]
                    }
                }).to_string(),
                json!({
                    "type": "wheeljack_interaction_response",
                    "interactionId": "permission-1",
                    "interactionState": "approved",
                    "text": "Approved"
                }).to_string()
            ]
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();

    assert_eq!(messages.len(), 3);
    assert_eq!(messages[0]["role"], "user");
    assert_eq!(messages[0]["images"][0]["fileName"], "shot.png");
    assert_eq!(messages[1]["kind"], "approval");
    assert_eq!(messages[1]["interactionState"], "approved");
    assert_eq!(messages[2]["kind"], "interaction_response");
    assert_eq!(messages[2]["text"], "Approved");
}

#[test]
fn agent_protocol_parse_recovers_claude_turn_after_process_restart() {
    let core = Core::new(
        test_init("agent-protocol-claude-restart"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let parsed: Value = serde_json::from_str(&core.call_json(&json!({
        "id": "parse-restarted-claude",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "claude-code",
            "protocol": "claude-stream-json",
            "transcript": [
                "agent -> structured session attached session_old",
                json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "Located lifecycle boundary." }] } }).to_string(),
                "agent -> structured process exited (1)",
                "user -> Resume from the shared task projection.",
                json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "Recovery test complete." }] } }).to_string(),
                json!({ "type": "result", "is_error": false }).to_string()
            ]
        }
    }).to_string())).unwrap();

    let messages = parsed["payload"]["messages"].as_array().unwrap();
    assert_eq!(messages[0]["text"], "Located lifecycle boundary.");
    assert_eq!(
        messages[1]["text"],
        "Resume from the shared task projection."
    );
    assert_eq!(messages[2]["text"], "Recovery test complete.");
    assert_eq!(parsed["payload"]["active"], false);
}

#[test]
fn agent_protocol_parse_surfaces_hermes_acp_progress_logs() {
    let core = Core::new(
        test_init("agent-protocol-hermes-progress"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "parse",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "hermes-agent",
            "protocol": "hermes-acp",
            "userPrompt": "test",
            "transcript": [
                "2026-07-08 22:59:02 [INFO] acp_adapter.server: Prompt on session abc: test",
                "2026-07-08 22:59:02 [INFO] agent.turn_context: conversation turn: session=abc model=gpt-5.5 provider=openai-codex platform=acp history=0 msg='test'"
            ]
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();

    assert_eq!(messages[0]["role"], "user");
    assert_eq!(messages[0]["text"], "test");
    assert_eq!(messages[1]["kind"], "status");
    assert_eq!(messages[1]["text"], "Hermes accepted the prompt.");
    assert_eq!(messages[2]["kind"], "status");
    assert_eq!(messages[2]["text"], "Hermes started the model turn.");
    assert_eq!(parsed["payload"]["active"], true);
}

#[test]
fn agent_protocol_parse_reduces_hermes_oneshot_output() {
    let core = Core::new(
        test_init("agent-protocol-hermes-oneshot"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "parse",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "hermes-agent",
            "protocol": "hermes-oneshot",
            "userPrompt": "test",
            "transcript": [
                "Test received.",
                "agent -> structured process exited"
            ]
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();

    assert_eq!(messages[0]["role"], "user");
    assert_eq!(messages[1]["role"], "assistant");
    assert_eq!(messages[1]["text"], "Test received.");
    assert_eq!(messages[1]["streaming"], false);
    assert_eq!(parsed["payload"]["active"], false);
}

#[test]
fn agent_protocol_parse_reduces_chat_messages_like_reference() {
    let core =
        Core::new(test_init("agent-protocol-reducer"), Arc::new(NullEventSink)).expect("core");
    let request = json!({
        "id": "parse",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "opencode",
            "nodeId": "node-1",
            "lines": [
                json!({
                    "type": "message.updated",
                    "properties": {
                        "info": {
                            "id": "msg-user",
                            "role": "user",
                            "sessionID": "session-1"
                        }
                    }
                }).to_string(),
                json!({
                    "type": "message.part.updated",
                    "properties": {
                        "part": {
                            "id": "part-user",
                            "messageID": "msg-user",
                            "sessionID": "session-1",
                            "text": "echoed prompt",
                            "type": "text"
                        }
                    }
                }).to_string(),
                json!({
                    "type": "message.updated",
                    "properties": {
                        "info": {
                            "id": "msg-assistant",
                            "role": "assistant",
                            "sessionID": "session-1"
                        }
                    }
                }).to_string(),
                json!({
                    "type": "message.part.updated",
                    "properties": {
                        "part": {
                            "id": "part-empty",
                            "messageID": "msg-assistant",
                            "sessionID": "session-1",
                            "text": "",
                            "type": "text"
                        }
                    }
                }).to_string(),
                json!({
                    "type": "message.part.delta",
                    "properties": {
                        "delta": "test",
                        "field": "text",
                        "messageID": "msg-assistant",
                        "sessionID": "session-1"
                    }
                }).to_string(),
                json!({
                    "type": "message.part.delta",
                    "properties": {
                        "delta": " received",
                        "field": "text",
                        "messageID": "msg-assistant",
                        "sessionID": "session-1"
                    }
                }).to_string(),
                json!({ "type": "session.idle", "properties": { "sessionID": "session-1" } }).to_string()
            ]
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["id"], "node-1-agent-4-message");
    assert_eq!(messages[0]["role"], "assistant");
    assert_eq!(messages[0]["kind"], "message");
    assert_eq!(messages[0]["text"], "test received");
    assert_eq!(messages[0]["streaming"], false);
    assert_eq!(messages[0]["rawIndexStart"], 4);
    assert_eq!(messages[0]["rawIndexEnd"], 6);
    assert_eq!(parsed["payload"]["active"], false);

    let active = json!({
        "id": "active",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "codex-cli",
            "lines": [
                json!({ "method": "item/agentMessage/delta", "params": { "delta": "Working" } }).to_string(),
                json!({
                    "method": "item/commandExecution/outputDelta",
                    "params": { "item_id": "cmd-1", "delta": "pass" }
                }).to_string()
            ]
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&active.to_string())).unwrap();
    assert_eq!(parsed["payload"]["active"], true);
    let messages = parsed["payload"]["messages"].as_array().unwrap();
    assert_eq!(messages[0]["text"], "Working");
    assert_eq!(messages[1]["kind"], "tool");
    assert_eq!(messages[1]["title"], "Command");
    assert_eq!(messages[1]["text"], "pass");
}

#[test]
fn agent_protocol_parse_reduces_opencode_permission_to_approval_message() {
    let core = Core::new(
        test_init("agent-protocol-opencode-permission"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "parse-permission",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "opencode",
            "lines": [
                json!({
                    "type": "permission.asked",
                    "properties": {
                        "id": "permission-1",
                        "sessionID": "session-1",
                        "permission": "edit"
                    }
                }).to_string(),
                json!({
                    "type": "permission.updated",
                    "properties": {
                        "permission": {
                            "id": "permission-1",
                            "sessionID": "session-1",
                            "permission": "edit",
                            "patterns": ["src/**"]
                        }
                    }
                }).to_string()
            ]
        }
    });

    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["role"], "system");
    assert_eq!(messages[0]["kind"], "approval");
    assert_eq!(messages[0]["title"], "edit");
    assert_eq!(messages[0]["text"], "[\"src/**\"]");
    assert_eq!(messages[0]["interactionId"], "permission-1");
    assert_eq!(messages[0]["rawIndexEnd"], 1);
    assert_eq!(messages[0]["streaming"], Value::Null);
    assert_eq!(parsed["payload"]["active"], true);
}

#[test]
fn agent_protocol_parse_reduces_opencode_question_to_question_message() {
    let core = Core::new(
        test_init("agent-protocol-opencode-question"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "parse-question",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "opencode",
            "protocol": "opencode-sse",
            "lines": [
                json!({
                    "type": "question.asked",
                    "properties": {
                        "id": "question-1",
                        "sessionID": "session-1",
                        "questions": [{
                            "header": "Mac access",
                            "question": "psil-mbp-362 is online but this Windows worker cannot SSH in. How should I finish the real-machine QA?",
                            "options": [
                                {
                                    "label": "Authorize this SSH key",
                                    "description": "Add this host pubkey, then I continue."
                                },
                                {
                                    "label": "Enable Tailscale SSH",
                                    "description": "Turn on Tailscale SSH, then I continue."
                                }
                            ]
                        }]
                    }
                }).to_string()
            ]
        }
    });

    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["role"], "system");
    assert_eq!(messages[0]["kind"], "question");
    assert_eq!(messages[0]["title"], "Mac access");
    assert_eq!(
        messages[0]["text"],
        "psil-mbp-362 is online but this Windows worker cannot SSH in. How should I finish the real-machine QA?"
    );
    assert_eq!(messages[0]["interactionId"], "question-1");
    assert_eq!(messages[0]["choices"][0]["id"], "Authorize this SSH key");
    assert_eq!(messages[0]["choices"][0]["label"], "Authorize this SSH key");
    assert_eq!(
        messages[0]["choices"][0]["description"],
        "Add this host pubkey, then I continue."
    );
    assert_eq!(parsed["payload"]["active"], true);
}

#[test]
fn agent_protocol_parse_keeps_turn_active_until_explicit_completion() {
    let core = Core::new(
        test_init("agent-protocol-explicit-completion"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let started = json!({
        "type": "message.updated",
        "properties": {
            "info": { "id": "message-1", "role": "assistant" }
        }
    })
    .to_string();
    let message = json!({
        "type": "message.part.updated",
        "properties": {
            "part": { "type": "text", "text": "Still working" }
        }
    })
    .to_string();
    let parse = |lines: Vec<String>| {
        serde_json::from_str::<Value>(
            &core.call_json(
                &json!({
                    "id": "parse",
                    "command": "agent_protocol_parse",
                    "payload": {
                        "adapterId": "opencode",
                        "protocol": "opencode-sse",
                        "lines": lines
                    }
                })
                .to_string(),
            ),
        )
        .unwrap()
    };

    assert_eq!(
        parse(vec![started.clone(), message.clone()])["payload"]["active"],
        true
    );
    assert_eq!(
        parse(vec![
            started,
            message,
            json!({ "type": "session.idle" }).to_string()
        ])["payload"]["active"],
        false
    );
}

#[test]
fn agent_protocol_parse_dedupes_pi_chat_messages() {
    let core = Core::new(test_init("agent-protocol-pi"), Arc::new(NullEventSink)).expect("core");
    let answer = "Hi! I'm here and ready to help. What would you like to work on?\n\nI can see we're in `D:/DEV/wheeljack`. Want me to take a look around the project, or do you have a specific task in mind?";
    let request = json!({
        "id": "parse-pi",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "pi-coding-agent",
            "lines": [
                json!({ "type": "message_start", "message": { "role": "user", "content": [{ "type": "text", "text": "test" }] } }).to_string(),
                json!({ "type": "message_end", "message": { "role": "user", "content": [{ "type": "text", "text": "test" }] } }).to_string(),
                json!({
                    "type": "message_update",
                    "assistantMessageEvent": {
                        "type": "text_start",
                        "partial": { "role": "assistant", "content": [{ "type": "text", "text": "Hi" }] }
                    }
                }).to_string(),
                json!({
                    "type": "message_update",
                    "assistantMessageEvent": {
                        "type": "text_delta",
                        "delta": "Hi! I'm here and ready to help. What would you like to work on?\n\n"
                    }
                }).to_string(),
                json!({
                    "type": "message_update",
                    "assistantMessageEvent": {
                        "type": "text_delta",
                        "delta": "I can see we're in `D:/DEV/wheeljack`. Want me to take a look around the project, or do you have a specific task in mind?"
                    }
                }).to_string(),
                json!({
                    "type": "message_update",
                    "assistantMessageEvent": {
                        "type": "text_end",
                        "content": answer,
                        "partial": { "role": "assistant", "content": [{ "type": "text", "text": answer }] }
                    }
                }).to_string(),
                json!({ "type": "message_end", "message": { "role": "assistant", "content": [{ "type": "text", "text": answer }] } }).to_string(),
                json!({ "type": "turn_end", "message": { "role": "assistant", "content": [{ "type": "text", "text": answer }] } }).to_string(),
                json!({ "type": "agent_end", "messages": [{ "role": "user", "content": [{ "type": "text", "text": "test" }] }, { "role": "assistant", "content": [{ "type": "text", "text": answer }] }] }).to_string()
            ]
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["role"], "assistant");
    assert_eq!(messages[0]["text"], answer);
    assert_eq!(messages[0]["streaming"], false);
}

#[test]
fn agent_protocol_parse_keeps_pi_active_until_agent_settled() {
    let core = Core::new(
        test_init("agent-protocol-pi-settled"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let parse = |lines: Vec<String>| {
        serde_json::from_str::<Value>(
            &core.call_json(
                &json!({
                    "id": "parse-pi-settled",
                    "command": "agent_protocol_parse",
                    "payload": {
                        "adapterId": "pi-coding-agent",
                        "protocol": "pi-rpc",
                        "lines": lines
                    }
                })
                .to_string(),
            ),
        )
        .unwrap()
    };
    let intermediate = vec![
        json!({
            "type": "message_update",
            "assistantMessageEvent": { "type": "text_delta", "delta": "Working" }
        })
        .to_string(),
        json!({
            "type": "message_end",
            "message": { "role": "assistant", "content": [{ "type": "text", "text": "Working" }] }
        })
        .to_string(),
        json!({ "type": "turn_end" }).to_string(),
        json!({ "type": "agent_end" }).to_string(),
    ];

    assert_eq!(parse(intermediate.clone())["payload"]["active"], true);
    assert_eq!(
        parse(
            intermediate
                .into_iter()
                .chain([json!({ "type": "agent_settled" }).to_string()])
                .collect()
        )["payload"]["active"],
        false
    );
}

#[test]
fn agent_protocol_parse_surfaces_failed_pi_turns() {
    let core = Core::new(
        test_init("agent-protocol-pi-error"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "parse-pi-error",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "pi-coding-agent",
            "protocol": "pi-rpc",
            "lines": [
                json!({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "content": [],
                        "stopReason": "error",
                        "errorMessage": "Your authentication token has been invalidated. Please try signing in again."
                    }
                }).to_string(),
                json!({ "type": "agent_settled" }).to_string()
            ]
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();

    assert_eq!(parsed["payload"]["active"], false);
    assert_eq!(parsed["payload"]["events"][0]["type"], "error");
    assert_eq!(parsed["payload"]["messages"][0]["kind"], "error");
    assert!(parsed["payload"]["messages"][0]["text"]
        .as_str()
        .unwrap()
        .contains("authentication token has been invalidated"));
}

#[test]
fn agent_protocol_parse_reduces_pi_tool_execution_events_to_single_message() {
    let core =
        Core::new(test_init("agent-protocol-pi-tool"), Arc::new(NullEventSink)).expect("core");
    let request = json!({
        "id": "parse-pi-tool",
        "command": "agent_protocol_parse",
        "payload": {
            "nodeId": "node-pi-tool",
            "adapterId": "pi-coding-agent",
            "protocol": "pi-rpc",
            "lines": [
                json!({
                    "type": "tool_execution_start",
                    "toolCallId": "tool-123",
                    "toolName": "Example Tool",
                    "input": { "command": "echo start" }
                }).to_string(),
                json!({
                    "type": "tool_execution_update",
                    "toolCallId": "tool-123",
                    "delta": "progress 50%"
                }).to_string(),
                json!({
                    "type": "tool_execution_end",
                    "toolCallId": "tool-123",
                    "output": "done"
                }).to_string()
            ]
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    let messages = parsed["payload"]["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["kind"], "tool");
    assert_eq!(
        messages[0]["text"],
        "{\"command\":\"echo start\"}\nprogress 50%\ndone"
    );
    assert_eq!(messages[0]["streaming"], false);
}

#[test]
fn structured_spawn_rolls_back_child_map_and_history_when_persistence_fails() {
    let core = Core::new(
        test_init("structured-spawn-rollback"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    core.lock_db()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER fail_structured_session_insert BEFORE INSERT ON sessions
             BEGIN SELECT RAISE(ABORT, 'forced structured session insert failure'); END;",
        )
        .unwrap();
    let marker = temp_dir("structured-spawn-orphan-marker").join("marker.txt");
    fs::create_dir_all(marker.parent().unwrap()).unwrap();
    let (command, args) = test_delayed_file_write_command(&marker);
    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "spawn",
                "command": "agent_structured_spawn",
                "payload": {
                    "nodeId": "node_structured_rollback",
                    "adapterId": "generic-shell",
                    "command": command,
                    "args": args,
                    "cwd": std::env::current_dir().unwrap(),
                    "prompt": "start",
                    "promptDelivery": "argv",
                    "protocol": "plain-argv"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();

    assert_eq!(response["ok"], false);
    assert!(core.lock_structured_sessions().unwrap().is_empty());
    let db = core.lock_db().unwrap();
    let session_count: i64 = db
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .unwrap();
    let event_count: i64 = db
        .query_row("SELECT COUNT(*) FROM session_events", [], |row| row.get(0))
        .unwrap();
    assert_eq!((session_count, event_count), (0, 0));
    drop(db);
    thread::sleep(Duration::from_millis(1_200));
    assert!(
        !marker.exists(),
        "failed structured spawn left its child running"
    );
}

#[test]
fn structured_process_tree_kills_descendant_after_direct_child_exits() {
    let dir = temp_dir("structured-process-tree");
    fs::create_dir_all(&dir).unwrap();
    let marker = dir.join("orphan-marker.txt");
    let ready = dir.join("parent-ready.txt");
    let (command, args) = test_detached_delayed_file_write_command(&marker, &ready);
    let mut command = Command::new(command);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    configure_structured_process(&mut command);
    let child = command.spawn().unwrap();
    let process_tree = StructuredProcessTree::attach(&child).unwrap();

    let ready_deadline = Instant::now() + Duration::from_secs(5);
    while !ready.exists() {
        assert!(
            Instant::now() < ready_deadline,
            "direct child did not launch its descendant"
        );
        thread::sleep(Duration::from_millis(20));
    }
    let child = Arc::new(Mutex::new(child));
    let sessions = Arc::new(Mutex::new(HashMap::new()));
    let rpc_state = Arc::new(Mutex::new(StructuredAgentRpcState {
        turn_active: true,
        ..Default::default()
    }));
    let termination_reason = Arc::new(Mutex::new(None));
    let process = StructuredAgentProcessHandle {
        child,
        process_tree,
        termination_reason,
    };
    sessions.lock().unwrap().insert(
        "session_tree".to_string(),
        StructuredAgentSessionHandle {
            process: process.clone(),
            stdin: None,
            protocol: "plain-argv".to_string(),
            cwd: ".".to_string(),
            intent: "code".to_string(),
            http_port: None,
            rpc_state: Some(rpc_state.clone()),
            provider: None,
            model: None,
            thinking: None,
            approval_policy: None,
            sandbox: None,
            capabilities: StructuredDriverCapabilities {
                cancel: false,
                interact: false,
                resume: false,
                attached_terminal: false,
                image_input: false,
                steer: false,
            },
            seq: Arc::new(AtomicU64::new(0)),
        },
    );
    let sink = Arc::new(RecordingSink::default());
    let mut readers = Vec::new();
    spawn_structured_waiter(
        dir.join("missing.db"),
        "session_tree".to_string(),
        "node_tree".to_string(),
        "generic-shell".to_string(),
        process,
        sink.clone(),
        sessions.clone(),
        Some(rpc_state),
        Arc::new(AtomicBool::new(false)),
        &mut readers,
    )
    .unwrap()
    .join()
    .unwrap();
    assert!(sessions.lock().unwrap().is_empty());
    assert!(sink.snapshot().iter().any(|(event, payload)| {
        event == "agent:structured-exit"
            && payload["exitCode"] == 0
            && payload["incompleteTurn"] == true
    }));
    thread::sleep(Duration::from_millis(1_200));
    assert!(
        !marker.exists(),
        "structured process-tree cleanup left a descendant running"
    );
}

#[cfg(windows)]
#[test]
fn structured_sse_spawn_drains_output_before_waiting_for_health() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("structured-sse-noisy-start"), sink.clone()).expect("core");
    let (command, args) = test_noisy_sse_server_command();
    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "spawn-noisy-sse",
                "command": "agent_structured_spawn",
                "payload": {
                    "nodeId": "node_noisy_sse",
                    "adapterId": "opencode",
                    "command": command,
                    "args": args,
                    "cwd": std::env::current_dir().unwrap(),
                    "prompt": "",
                    "promptDelivery": "sse",
                    "protocol": "opencode-sse"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], true, "{response}");
    let session_id = response["payload"]["id"].as_str().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !sink.snapshot().iter().any(|(event, payload)| {
        event == "agent:structured-line"
            && payload["sessionId"] == session_id
            && payload["stream"] == "stdout"
            && payload["lineBase64"]
                .as_str()
                .is_some_and(|line| line.len() > 1_000_000)
    }) {
        assert!(
            Instant::now() < deadline,
            "noisy child output was not drained"
        );
        thread::sleep(Duration::from_millis(20));
    }

    let killed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "kill-noisy-sse",
                "command": "session_kill",
                "payload": { "sessionId": session_id }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(killed["ok"], true);
}

#[cfg(windows)]
#[test]
fn structured_sse_start_failure_removes_post_commit_history() {
    let core = Core::new(
        test_init("structured-sse-start-rollback"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let (command, args) = test_failing_sse_server_command();
    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "spawn-failing-sse",
                "command": "agent_structured_spawn",
                "payload": {
                    "nodeId": "node_failing_sse",
                    "adapterId": "opencode",
                    "command": command,
                    "args": args,
                    "cwd": std::env::current_dir().unwrap(),
                    "prompt": "",
                    "promptDelivery": "sse",
                    "protocol": "opencode-sse"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("session id"));
    assert!(core.lock_structured_sessions().unwrap().is_empty());

    let db = core.lock_db().unwrap();
    let counts = [
        "sessions",
        "session_events",
        "session_chunks",
        "session_chunks_fts",
    ]
    .map(|table| {
        db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap()
    });
    assert_eq!(counts, [0, 0, 0, 0]);
}

#[cfg(windows)]
#[test]
fn structured_sse_prompt_failure_rolls_back_owned_reader_and_history() {
    let core = Core::new(
        test_init("structured-sse-prompt-rollback"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let worker_count_before_spawn = core.workers.lock().unwrap().len();
    let (command, args) = test_noisy_sse_server_command();
    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "spawn-failing-sse-prompt",
                "command": "agent_structured_spawn",
                "payload": {
                    "nodeId": "node_failing_sse_prompt",
                    "adapterId": "opencode",
                    "command": command,
                    "args": args,
                    "cwd": std::env::current_dir().unwrap(),
                    "prompt": "fail after reader start",
                    "promptDelivery": "sse",
                    "protocol": "opencode-sse",
                    "model": "invalid-model"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("provider/model"));
    assert!(core.lock_structured_sessions().unwrap().is_empty());
    assert_eq!(
        core.workers.lock().unwrap().len(),
        worker_count_before_spawn
    );

    let db = core.lock_db().unwrap();
    let counts = [
        "sessions",
        "session_events",
        "session_chunks",
        "session_chunks_fts",
    ]
    .map(|table| {
        db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap()
    });
    assert_eq!(counts, [0, 0, 0, 0]);
}

#[test]
fn structured_spawn_prompt_events_and_transcript_roundtrip() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("structured"), sink.clone()).expect("core");
    let (command, args) = test_structured_echo_command();
    let request = json!({
        "id": "spawn",
        "command": "agent_structured_spawn",
        "payload": {
            "nodeId": "node_structured",
            "adapterId": "generic-shell",
            "command": command,
            "args": args,
            "cwd": std::env::current_dir().unwrap(),
            "prompt": "alpha",
            "model": "gpt-5.4-mini",
            "thinking": "high",
            "approvalPolicy": "on-request",
            "promptDelivery": "json-rpc",
            "protocol": "plain-stdin"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    let session_id = response["payload"]["id"].as_str().unwrap().to_string();

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if sink.snapshot().iter().any(|(event, payload)| {
            event == "agent:structured-line" && decoded_line(payload).contains("first:alpha")
        }) {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for first structured line"
        );
        thread::sleep(Duration::from_millis(20));
    }

    let prompt = json!({
        "id": "prompt",
        "command": "session_prompt_send",
        "payload": {
            "sessionId": session_id,
            "prompt": "beta"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&prompt.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["transport"], "structured");
    assert_eq!(response["payload"]["strategy"], "plain-stdin");

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let events = sink.snapshot();
        let saw_second = events.iter().any(|(event, payload)| {
            event == "agent:structured-line" && decoded_line(payload).contains("second:beta")
        });
        let saw_exit = events
            .iter()
            .any(|(event, payload)| event == "agent:structured-exit" && payload["exitCode"] == 0);
        if saw_second && saw_exit {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for structured second line and exit; events: {events:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }

    let transcript_request = json!({
        "id": "transcript",
        "command": "session_transcript",
        "payload": { "sessionId": session_id }
    });
    let transcript: Value =
        serde_json::from_str(&core.call_json(&transcript_request.to_string())).unwrap();
    assert!(transcript["payload"]["text"]
        .as_str()
        .unwrap()
        .contains("second:beta"));

    let db = core.lock_db().unwrap();
    let command_json: String = db
        .query_row(
            "SELECT command_json FROM sessions WHERE id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .unwrap();
    let command_value = serde_json::from_str::<Value>(&command_json).unwrap();
    assert_eq!(command_value["model"], "gpt-5.4-mini");
    assert_eq!(command_value["thinking"], "high");
    assert_eq!(command_value["approvalPolicy"], "on-request");
}

#[test]
fn structured_persistent_agent_can_start_idle_then_receive_first_prompt() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("structured-idle"), sink.clone()).expect("core");
    let (command, args) = test_structured_echo_command();
    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "spawn-idle",
                "command": "agent_structured_spawn",
                "payload": {
                    "nodeId": "node_idle",
                    "adapterId": "claude-code",
                    "command": command,
                    "args": args,
                    "cwd": std::env::current_dir().unwrap(),
                    "prompt": "",
                    "promptDelivery": "stdin",
                    "protocol": "claude-stream-json"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], true);
    let session_id = response["payload"]["id"].as_str().unwrap().to_string();
    thread::sleep(Duration::from_millis(100));
    assert!(!sink
        .snapshot()
        .iter()
        .any(|(event, _)| event == "agent:structured-line"));

    let prompted: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "prompt-idle",
                "command": "session_prompt_send",
                "payload": { "sessionId": session_id, "prompt": "alpha" }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(prompted["ok"], true);
    assert_eq!(prompted["payload"]["transport"], "structured");

    let deadline = Instant::now() + Duration::from_secs(5);
    while !sink.snapshot().iter().any(|(event, payload)| {
        event == "agent:structured-line"
            && decoded_line(payload).contains("first:")
            && decoded_line(payload).contains("alpha")
    }) {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for idle prompt"
        );
        thread::sleep(Duration::from_millis(20));
    }

    let killed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "kill-idle",
                "command": "session_kill",
                "payload": { "sessionId": session_id }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(killed["ok"], true);
}

#[test]
fn structured_spawn_resolves_the_adapter_preferred_profile() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("structured-adapter-profile"), sink.clone()).expect("core");
    let (command, args) = test_structured_echo_command();
    let launch_command = quoted_launch_command(&command, &args);
    let mut manifest = adapter_json(
        "structured-test",
        "Structured test",
        &command,
        &launch_command,
        "stdin",
    );
    manifest["streaming"] = json!({
        "preferred": {
            "transport": "ndjson",
            "protocol": "claude-stream-json",
            "launchCommand": launch_command,
            "promptDelivery": "stdin",
            "sessionMode": "persistent-stdin-jsonl",
            "supportsFollowUp": true,
            "responseHistoryMode": "append"
        }
    });
    let saved: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "save-structured-test",
                "command": "adapter_save",
                "payload": { "manifest": manifest }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(saved["ok"], true);

    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "spawn",
                "command": "agent_structured_spawn",
                "payload": {
                    "nodeId": "node_structured",
                    "adapterId": "structured-test",
                    "cwd": std::env::current_dir().unwrap(),
                    "prompt": "alpha"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], true, "{response:?}");
    let session_id = response["payload"]["id"].as_str().unwrap().to_string();

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let events = sink.snapshot();
        if events.iter().any(|(event, payload)| {
            let line = decoded_line(payload);
            event == "agent:structured-line" && line.contains("first:") && line.contains("alpha")
        }) {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for metadata-derived structured launch: {events:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }

    let killed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "kill",
                "command": "session_kill",
                "payload": { "sessionId": session_id }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(killed["ok"], true);
}

fn quoted_launch_command(command: &str, args: &[String]) -> String {
    std::iter::once(command)
        .chain(args.iter().map(String::as_str))
        .map(|value| {
            format!(
                r#""{}""#,
                value.replace('\\', r#"\\"#).replace('"', r#"\""#)
            )
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn session_kill_removes_structured_session_handle() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("structured-kill"), sink.clone()).expect("core");
    let (command, args) = test_structured_echo_command();
    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "spawn",
                "command": "agent_structured_spawn",
                "payload": {
                    "nodeId": "node_structured",
                    "adapterId": "generic-shell",
                    "command": command,
                    "args": args,
                    "cwd": std::env::current_dir().unwrap(),
                    "prompt": "alpha",
                    "promptDelivery": "json-rpc",
                    "protocol": "plain-stdin"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], true);
    let session_id = response["payload"]["id"].as_str().unwrap();

    let deadline = Instant::now() + Duration::from_secs(5);
    while !sink.snapshot().iter().any(|(event, payload)| {
        event == "agent:structured-line" && decoded_line(payload).contains("first:alpha")
    }) {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for structured session"
        );
        thread::sleep(Duration::from_millis(20));
    }

    let recorded_termination_reason = core
        .lock_structured_sessions()
        .unwrap()
        .get(session_id)
        .expect("structured session should still be running")
        .process
        .termination_reason
        .clone();

    let kill = json!({
        "id": "kill",
        "command": "session_kill",
        "payload": { "sessionId": session_id, "terminationReason": "completed" }
    });
    let killed: Value = serde_json::from_str(&core.call_json(&kill.to_string())).unwrap();
    assert_eq!(killed["ok"], true);
    assert_eq!(
        *recorded_termination_reason.lock().unwrap(),
        Some(StructuredTerminationReason::Completed),
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    while !sink.snapshot().iter().any(|(event, payload)| {
        event == "agent:structured-exit" && payload["sessionId"] == session_id
    }) {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for the killed structured session to exit"
        );
        thread::sleep(Duration::from_millis(20));
    }
    let exit = sink
        .snapshot()
        .into_iter()
        .find(|(event, payload)| {
            event == "agent:structured-exit" && payload["sessionId"] == session_id
        })
        .unwrap()
        .1;
    assert_eq!(exit["terminationReason"], "completed");
    assert_eq!(
        core.lock_db()
            .unwrap()
            .query_row(
                "SELECT status FROM sessions WHERE id = ?1",
                params![session_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "completed",
    );
    let (event_status, event_reason): (String, String) = core
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT status, json_extract(payload_json, '$.terminationReason')
             FROM session_events
             WHERE session_id = ?1
             ORDER BY seq DESC
             LIMIT 1",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        (event_status.as_str(), event_reason.as_str()),
        ("completed", "completed")
    );
    let killed_again: Value = serde_json::from_str(&core.call_json(&kill.to_string())).unwrap();
    assert_eq!(killed_again["ok"], true);
}

#[test]
fn structured_claude_stream_json_keeps_stdin_for_followups() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("structured-claude-json"), sink.clone()).expect("core");
    let (command, args) = test_structured_echo_command();
    let request = json!({
        "id": "spawn",
        "command": "agent_structured_spawn",
        "payload": {
            "nodeId": "node_structured",
            "adapterId": "claude-code",
            "command": command,
            "args": args,
            "cwd": std::env::current_dir().unwrap(),
            "prompt": "alpha",
            "promptDelivery": "stdin",
            "protocol": "claude-stream-json"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    let session_id = response["payload"]["id"].as_str().unwrap().to_string();

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let events = sink.snapshot();
        let saw_prompt = events.iter().any(|(event, payload)| {
            let line = decoded_line(payload);
            event == "agent:structured-line"
                && line.contains("first:")
                && line.contains("\"type\":\"user\"")
                && line.contains("\"content\":\"alpha\"")
        });
        let saw_result = events.iter().any(|(event, payload)| {
            event == "agent:structured-line" && decoded_line(payload).contains("\"result\"")
        });
        if saw_prompt && saw_result {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for claude stream json first prompt"
        );
        thread::sleep(Duration::from_millis(20));
    }

    let prompt = json!({
        "id": "prompt",
        "command": "agent_structured_prompt",
        "payload": {
            "sessionId": session_id,
            "prompt": "beta"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&prompt.to_string())).unwrap();
    assert_eq!(response["ok"], true);

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let events = sink.snapshot();
        let saw_second = events.iter().any(|(event, payload)| {
            let line = decoded_line(payload);
            event == "agent:structured-line"
                && line.contains("second:")
                && line.contains("\"content\":\"beta\"")
        });
        let saw_exit = events
            .iter()
            .any(|(event, payload)| event == "agent:structured-exit" && payload["exitCode"] == 0);
        if saw_second && saw_exit {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for claude stream json followup; events: {events:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn structured_codex_app_server_handshakes_and_reuses_thread() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("structured-codex-app-server"), sink.clone()).expect("core");
    let (command, args) = test_codex_app_server_command();
    let request = json!({
        "id": "spawn",
        "command": "agent_structured_spawn",
        "payload": {
            "nodeId": "node_codex",
            "adapterId": "codex-cli",
            "command": command,
            "args": args,
            "cwd": std::env::current_dir().unwrap(),
            "prompt": "build parity",
            "model": "gpt-5.4-mini",
            "thinking": "low",
            "approvalPolicy": "never",
            "sandbox": "danger-full-access",
            "promptDelivery": "json-rpc",
            "protocol": "codex-app-server"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    let session_id = response["payload"]["id"].as_str().unwrap().to_string();

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let lines = structured_event_lines(&sink);
        let saw_initialize = lines
            .iter()
            .any(|line| line.contains("\"method\":\"initialize\""));
        let saw_thread_start = lines.iter().any(|line| {
            line.contains("\"method\":\"thread/start\"")
                && line.contains("\"approvalPolicy\":\"never\"")
                && line.contains("\"sandbox\":\"danger-full-access\"")
        });
        let saw_turn_start = lines.iter().any(|line| {
            line.contains("\"method\":\"turn/start\"")
                && line.contains("\"threadId\":\"thread-native\"")
                && line.contains("\"text\":\"build parity\"")
                && line.contains("\"model\":\"gpt-5.4-mini\"")
                && line.contains("\"effort\":\"low\"")
        });
        let saw_approval = lines
            .iter()
            .any(|line| line.contains("item/commandExecution/requestApproval"));
        if saw_initialize && saw_thread_start && saw_turn_start && saw_approval {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for codex app-server handshake; lines: {lines:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }

    let approval = json!({
        "id": "approve",
        "command": "agent_structured_respond",
        "payload": {
            "sessionId": session_id,
            "approved": true,
            "response": "approved"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&approval.to_string())).unwrap();
    assert_eq!(response["ok"], true);

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let lines = structured_event_lines(&sink);
        let saw_response = lines
            .iter()
            .any(|line| line.contains("\"id\":99") && line.contains("\"decision\":\"accept\""));
        let saw_complete = lines.iter().any(|line| line.contains("turn/completed"));
        let rpc_state = {
            core.lock_structured_sessions()
                .unwrap()
                .get(&session_id)
                .and_then(|session| session.rpc_state.clone())
        };
        let turn_finished = rpc_state
            .as_ref()
            .is_some_and(|state| !state.lock().unwrap().turn_active);
        if saw_response && saw_complete && turn_finished {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for codex approval response; lines: {lines:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }

    let prompt = json!({
        "id": "prompt",
        "command": "agent_structured_prompt",
        "payload": {
            "sessionId": session_id,
            "prompt": "continue parity",
            "model": "gpt-5.4",
            "thinking": "high",
            "approvalPolicy": "on-request",
            "sandbox": "workspace-write"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&prompt.to_string())).unwrap();
    assert_eq!(response["ok"], true);

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let lines = structured_event_lines(&sink);
        let followup = lines.iter().filter(|line| {
            line.contains("\"method\":\"turn/start\"")
                && line.contains("\"threadId\":\"thread-native\"")
                && line.contains("\"text\":\"continue parity\"")
                && line.contains("\"model\":\"gpt-5.4\"")
                && line.contains("\"effort\":\"high\"")
                && line.contains("\"approvalPolicy\":\"on-request\"")
                && line.contains("\"sandboxPolicy\":{\"type\":\"workspaceWrite\"")
        });
        let saw_exit = sink
            .snapshot()
            .iter()
            .any(|(event, payload)| event == "agent:structured-exit" && payload["exitCode"] == 0);
        if followup.count() == 1 && saw_exit {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for codex followup; lines: {lines:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn structured_resume_retires_the_live_writer_for_its_node() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("structured-resume-live-writer"), sink).expect("core");
    let (command, args) = test_codex_app_server_command();
    let spawn = |id: &str, prompt: &str, resume_session_id: Option<&str>| {
        let mut payload = json!({
            "nodeId": "node_codex_resume",
            "adapterId": "codex-cli",
            "command": command,
            "args": args,
            "cwd": std::env::current_dir().unwrap(),
            "prompt": prompt,
            "promptDelivery": "json-rpc",
            "protocol": "codex-app-server"
        });
        if let Some(resume_session_id) = resume_session_id {
            payload["resumeSessionId"] = json!(resume_session_id);
        }
        serde_json::from_str::<Value>(
            &core.call_json(
                &json!({
                    "id": id,
                    "command": "agent_structured_spawn",
                    "payload": payload,
                })
                .to_string(),
            ),
        )
        .unwrap()
    };

    let original = spawn("spawn-original", "start", None);
    assert_eq!(original["ok"], true, "{original}");
    let original_id = original["payload"]["id"].as_str().unwrap().to_string();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let ready = {
            let db = core.lock_db().unwrap();
            load_agent_resume_cursor(&db, &original_id, StructuredProtocol::CodexAppServer).is_ok()
        };
        if ready {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for the original Codex resume cursor"
        );
        thread::sleep(Duration::from_millis(20));
    }

    let resumed = spawn("spawn-resumed", "continue", Some(&original_id));
    assert_eq!(resumed["ok"], true, "{resumed}");
    let resumed_id = resumed["payload"]["id"].as_str().unwrap().to_string();
    assert!(!core
        .lock_structured_sessions()
        .unwrap()
        .contains_key(&original_id));
    let original_status: String = core
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT status FROM sessions WHERE id = ?1",
            params![original_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(original_status, "canceled");

    let killed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "kill-resumed",
                "command": "session_kill",
                "payload": { "sessionId": resumed_id, "terminationReason": "canceled" }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(killed["ok"], true);
}

#[test]
fn structured_hermes_acp_sends_prompt_after_nested_session_result() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("structured-hermes-acp"), sink.clone()).expect("core");
    let (command, args) = test_hermes_acp_command();
    let request = json!({
        "id": "spawn",
        "command": "agent_structured_spawn",
        "payload": {
            "nodeId": "node_hermes",
            "adapterId": "hermes-agent",
            "command": command,
            "args": args,
            "cwd": std::env::current_dir().unwrap(),
            "prompt": "hello hermes",
            "promptDelivery": "json-rpc",
            "protocol": "hermes-acp"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let lines = structured_event_lines(&sink);
        let saw_session_prompt = lines.iter().any(|line| {
            line.contains("\"method\":\"session/prompt\"")
                && line.contains("\"sessionId\":\"session-hermes\"")
                && line.contains("\"text\":\"hello hermes\"")
        });
        let saw_answer = lines.iter().any(|line| line.contains("Hermes heard you"));
        if saw_session_prompt && saw_answer {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for Hermes ACP prompt; lines: {lines:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn structured_opencode_sse_driver_posts_prompt_and_emits_events() {
    let sink = Arc::new(RecordingSink::default());
    let db_dir = temp_dir("structured-sse");
    fs::create_dir_all(&db_dir).unwrap();
    let db_path = db_dir.join(DB_FILE_NAME);
    let db = Connection::open(&db_path).unwrap();
    run_migrations(&db).unwrap();
    db.execute(
            "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
             VALUES ('session_sse', 'node_sse', 'opencode', '{}', '.', 'running', ?1, ?1, ?1)",
            params![now()],
        )
        .unwrap();
    drop(db);

    let workspace = db_dir.join("workspace");
    let app_data = db_dir.join("app-data");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&app_data).unwrap();
    let image_path = workspace.join("reference.png");
    fs::write(&image_path, b"\x89PNG\r\n\x1a\nfixture").unwrap();
    let outside_image = db_dir.join("outside.png");
    fs::write(&outside_image, b"\x89PNG\r\n\x1a\nfixture").unwrap();
    assert!(structured_prompt_from_paths(
        "",
        &[outside_image.to_string_lossy().to_string()],
        &workspace,
        &app_data,
    )
    .is_err());
    let posted_messages = Arc::new(Mutex::new(Vec::<Value>::new()));
    let port = start_fake_opencode_sse_server(posted_messages.clone());
    let driver = StructuredSseDriver {
        protocol: "opencode-sse".to_string(),
        port,
        db_path,
        session_id: "session_sse".to_string(),
        node_id: "node_sse".to_string(),
        adapter_id: "opencode".to_string(),
        seq: Arc::new(AtomicU64::new(0)),
        rpc_state: Arc::new(Mutex::new(StructuredAgentRpcState::default())),
        events: sink.clone(),
        cancellation: StructuredReaderCancellation {
            shutdown: Arc::new(AtomicBool::new(false)),
            rollback: Arc::new(AtomicBool::new(false)),
        },
        model: Some("openai/gpt-5.6-luna".to_string()),
        thinking: Some("minimal".to_string()),
        approval_policy: Some("allow".to_string()),
        protocol_state: Arc::new(Mutex::new(AgentProtocolStreamState::default())),
    };

    let sse_reader = structured_sse_start(&driver).unwrap();
    let prompt = structured_prompt_from_paths(
        "build parity",
        &[image_path.to_string_lossy().to_string()],
        &workspace,
        &app_data,
    )
    .unwrap();
    structured_sse_send_prompt(&driver.prompt_driver(), &prompt).unwrap();

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if sink.snapshot().iter().any(|(event, payload)| {
            event == "agent:structured-line"
                && payload["stream"] == "sse"
                && decoded_line(payload).contains("session.idle")
        }) {
            break;
        }
        assert!(Instant::now() < deadline, "timed out waiting for SSE event");
        thread::sleep(Duration::from_millis(20));
    }
    while driver.rpc_state.lock().unwrap().turn_active {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for SSE turn completion"
        );
        thread::sleep(Duration::from_millis(5));
    }

    let messages = posted_messages.lock().unwrap().clone();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["permission"][0]["permission"], "*");
    assert_eq!(messages[0]["permission"][0]["pattern"], "*");
    assert_eq!(messages[0]["permission"][0]["action"], "allow");
    assert_eq!(messages[1]["parts"][0]["text"], "build parity");
    assert_eq!(messages[1]["parts"][1]["type"], "file");
    assert_eq!(messages[1]["parts"][1]["mime"], "image/png");
    assert!(messages[1]["parts"][1]["url"]
        .as_str()
        .unwrap()
        .starts_with("data:image/png;base64,"));
    assert_eq!(messages[1]["model"]["providerID"], "openai");
    assert_eq!(messages[1]["model"]["modelID"], "gpt-5.6-luna");
    assert_eq!(messages[1]["variant"], "minimal");
    for request_id in ["permission-opencode-1", "permission-opencode-2"] {
        dispatch_sse_event(
            &driver,
            None,
            None,
            &[json!({
                "type": "permission.asked",
                "properties": {
                    "id": request_id,
                    "sessionID": "session-opencode"
                }
            })
            .to_string()],
        );
    }
    dispatch_sse_event(
        &driver,
        None,
        None,
        &[json!({
            "type": "permission.updated",
            "properties": {
                "id": "permission-opencode-2",
                "sessionID": "session-opencode"
            }
        })
        .to_string()],
    );
    assert_eq!(
        driver
            .rpc_state
            .lock()
            .unwrap()
            .opencode
            .pending_interactions
            .len(),
        2
    );
    assert!(
        structured_sse_respond(driver.port, &driver.rpc_state, None, "", true)
            .unwrap_err()
            .to_string()
            .contains("require an interaction id")
    );
    assert!(structured_sse_respond(
        driver.port,
        &driver.rpc_state,
        Some("permission-opencode-missing"),
        "",
        true,
    )
    .unwrap_err()
    .to_string()
    .contains("unknown OpenCode interaction"));
    assert_eq!(
        driver
            .rpc_state
            .lock()
            .unwrap()
            .opencode
            .pending_interactions
            .len(),
        2
    );
    structured_sse_respond(
        driver.port,
        &driver.rpc_state,
        Some("permission-opencode-1"),
        "",
        true,
    )
    .unwrap();
    structured_sse_respond(
        driver.port,
        &driver.rpc_state,
        Some("permission-opencode-2"),
        "",
        true,
    )
    .unwrap();
    let responses = posted_messages.lock().unwrap().clone();
    assert_eq!(responses[2]["reply"], "once");
    assert_eq!(
        responses[2]["requestPath"],
        "/permission/permission-opencode-1/reply"
    );
    assert_eq!(responses[3]["reply"], "once");
    assert_eq!(
        responses[3]["requestPath"],
        "/permission/permission-opencode-2/reply"
    );
    dispatch_sse_event(
        &driver,
        None,
        None,
        &[json!({
            "type": "permission.asked",
            "properties": {
                "id": "permission-opencode-3",
                "sessionID": "session-opencode"
            }
        })
        .to_string()],
    );
    dispatch_sse_event(
        &driver,
        None,
        None,
        &[json!({
            "type": "permission.replied",
            "properties": {
                "requestID": "permission-opencode-3",
                "sessionID": "session-opencode"
            }
        })
        .to_string()],
    );
    assert!(driver
        .rpc_state
        .lock()
        .unwrap()
        .opencode
        .pending_interactions
        .is_empty());
    assert_eq!(
        driver
            .rpc_state
            .lock()
            .unwrap()
            .opencode
            .session_id
            .as_deref(),
        Some("session-opencode")
    );
    structured_sse_send_prompt(
        &driver.prompt_driver(),
        &StructuredPrompt::text("cancel this"),
    )
    .unwrap();
    driver
        .rpc_state
        .lock()
        .unwrap()
        .opencode
        .pending_interactions
        .push(json!({ "id": "pending" }));
    structured_sse_cancel(driver.port, &driver.rpc_state).unwrap();
    let responses = posted_messages.lock().unwrap().clone();
    assert_eq!(responses[4]["parts"][0]["text"], "cancel this");
    assert_eq!(responses[5]["abort"], true);
    assert!(!driver
        .rpc_state
        .lock()
        .unwrap()
        .opencode
        .pending_interactions
        .is_empty());
    finish_structured_turn(&driver.rpc_state);
    assert!(driver
        .rpc_state
        .lock()
        .unwrap()
        .opencode
        .pending_interactions
        .is_empty());
    driver.cancellation.shutdown.store(true, Ordering::SeqCst);
    sse_reader.join().unwrap();
}

#[test]
fn structured_opencode_sse_reader_reconnects_after_the_stream_closes() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = thread::spawn(move || {
        for (index, stream) in listener.incoming().take(2).enumerate() {
            let mut stream = stream.unwrap();
            let request = read_test_http_request(&stream).unwrap();
            assert_eq!(request.path, "/global/event");
            let event = if index == 0 {
                json!({
                    "type": "session.status",
                    "properties": {
                        "sessionID": "session-opencode",
                        "status": { "type": "busy" }
                    }
                })
            } else {
                json!({
                    "type": "session.idle",
                    "properties": { "sessionID": "session-opencode" }
                })
            };
            let body = format!("data: {event}\r\n\r\n");
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
            stream.flush().unwrap();
        }
    });
    let sink = Arc::new(RecordingSink::default());
    let db_dir = temp_dir("structured-sse-reconnect");
    fs::create_dir_all(&db_dir).unwrap();
    let db_path = db_dir.join(DB_FILE_NAME);
    let db = Connection::open(&db_path).unwrap();
    run_migrations(&db).unwrap();
    db.execute(
        "INSERT INTO sessions
         (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
         VALUES ('session_reconnect', 'node_reconnect', 'opencode', '{}', '.', 'running', ?1, ?1, ?1)",
        params![now()],
    )
    .unwrap();
    drop(db);
    let cancellation = StructuredReaderCancellation {
        shutdown: Arc::new(AtomicBool::new(false)),
        rollback: Arc::new(AtomicBool::new(false)),
    };
    let driver = StructuredSseDriver {
        protocol: "opencode-sse".to_string(),
        port,
        db_path: db_path.clone(),
        session_id: "session_reconnect".to_string(),
        node_id: "node_reconnect".to_string(),
        adapter_id: "opencode".to_string(),
        seq: Arc::new(AtomicU64::new(0)),
        rpc_state: Arc::new(Mutex::new(StructuredAgentRpcState {
            turn_active: true,
            opencode: OpenCodeRpcState {
                session_id: Some("session-opencode".to_string()),
                ..Default::default()
            },
            ..Default::default()
        })),
        events: sink.clone(),
        cancellation: cancellation.clone(),
        model: None,
        thinking: None,
        approval_policy: None,
        protocol_state: Arc::new(Mutex::new(AgentProtocolStreamState::default())),
    };

    let reader = spawn_structured_sse_reader(driver);
    let deadline = Instant::now() + Duration::from_secs(5);
    while !sink.snapshot().iter().any(|(event, payload)| {
        event == "agent:structured-line" && decoded_line(payload).contains("session.idle")
    }) {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for the reconnected stream"
        );
        thread::sleep(Duration::from_millis(20));
    }
    cancellation.shutdown.store(true, Ordering::SeqCst);
    reader.join().unwrap();
    server.join().unwrap();

    let db = Connection::open(db_path).unwrap();
    let chunk_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM session_chunks WHERE session_id = 'session_reconnect'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(chunk_count, 2);
}

#[test]
fn opencode_wrapped_step_finish_keeps_the_turn_active_until_session_idle() {
    let driver = StructuredSseDriver {
        protocol: "opencode-sse".to_string(),
        port: 0,
        db_path: temp_dir("structured-sse-step-finish").join(DB_FILE_NAME),
        session_id: "session_sse".to_string(),
        node_id: "node_sse".to_string(),
        adapter_id: "opencode".to_string(),
        seq: Arc::new(AtomicU64::new(0)),
        rpc_state: Arc::new(Mutex::new(StructuredAgentRpcState {
            turn_active: true,
            opencode: OpenCodeRpcState {
                session_id: Some("session-opencode".to_string()),
                ..Default::default()
            },
            ..Default::default()
        })),
        events: Arc::new(RecordingSink::default()),
        cancellation: StructuredReaderCancellation {
            shutdown: Arc::new(AtomicBool::new(false)),
            rollback: Arc::new(AtomicBool::new(false)),
        },
        model: None,
        thinking: None,
        approval_policy: None,
        protocol_state: Arc::new(Mutex::new(AgentProtocolStreamState::default())),
    };

    dispatch_sse_event(
        &driver,
        None,
        None,
        &[json!({
            "payload": {
                "type": "message.part.updated",
                "properties": {
                    "part": {
                        "sessionID": "session-opencode",
                        "type": "step-finish"
                    }
                }
            }
        })
        .to_string()],
    );
    assert!(driver.rpc_state.lock().unwrap().turn_active);

    dispatch_sse_event(
        &driver,
        None,
        None,
        &[json!({
            "type": "session.idle",
            "properties": { "sessionID": "session-opencode" }
        })
        .to_string()],
    );
    assert!(!driver.rpc_state.lock().unwrap().turn_active);
}

#[test]
fn structured_opencode_sse_driver_replies_to_questions() {
    let posted_messages = Arc::new(Mutex::new(Vec::<Value>::new()));
    let port = start_fake_opencode_sse_server(posted_messages.clone());
    let driver = StructuredSseDriver {
        protocol: "opencode-sse".to_string(),
        port,
        db_path: temp_dir("structured-sse-question").join(DB_FILE_NAME),
        session_id: "session_sse".to_string(),
        node_id: "node_sse".to_string(),
        adapter_id: "opencode".to_string(),
        seq: Arc::new(AtomicU64::new(0)),
        rpc_state: Arc::new(Mutex::new(StructuredAgentRpcState {
            opencode: OpenCodeRpcState {
                session_id: Some("session-opencode".to_string()),
                ..Default::default()
            },
            ..Default::default()
        })),
        events: Arc::new(RecordingSink::default()),
        cancellation: StructuredReaderCancellation {
            shutdown: Arc::new(AtomicBool::new(false)),
            rollback: Arc::new(AtomicBool::new(false)),
        },
        model: None,
        thinking: None,
        approval_policy: None,
        protocol_state: Arc::new(Mutex::new(AgentProtocolStreamState::default())),
    };
    dispatch_sse_event(
        &driver,
        None,
        None,
        &[json!({
            "type": "question.asked",
            "properties": {
                "id": "question-opencode-1",
                "sessionID": "session-opencode",
                "questions": [{
                    "header": "Mac access",
                    "question": "How should I finish the real-machine QA?",
                    "options": [{ "label": "Authorize this SSH key" }]
                }]
            }
        })
        .to_string()],
    );
    assert_eq!(
        driver
            .rpc_state
            .lock()
            .unwrap()
            .opencode
            .pending_interactions
            .len(),
        1
    );
    structured_sse_respond(
        driver.port,
        &driver.rpc_state,
        Some("question-opencode-1"),
        "Authorize this SSH key",
        true,
    )
    .unwrap();
    let responses = posted_messages.lock().unwrap().clone();
    assert_eq!(
        responses[0]["requestPath"],
        "/question/question-opencode-1/reply"
    );
    assert_eq!(responses[0]["answers"], json!([["Authorize this SSH key"]]));
    dispatch_sse_event(
        &driver,
        None,
        None,
        &[json!({
            "type": "question.asked",
            "properties": {
                "id": "question-opencode-2",
                "sessionID": "session-opencode",
                "questions": [{ "question": "Continue?" }]
            }
        })
        .to_string()],
    );
    structured_sse_respond(
        driver.port,
        &driver.rpc_state,
        Some("question-opencode-2"),
        "",
        false,
    )
    .unwrap();
    let responses = posted_messages.lock().unwrap().clone();
    assert_eq!(
        responses[1]["requestPath"],
        "/question/question-opencode-2/reject"
    );
}

#[test]
fn blocked_structured_http_session_does_not_block_another_session() {
    fn prompt_server(
        entered: std::sync::mpsc::Sender<()>,
        release: Option<std::sync::mpsc::Receiver<()>>,
    ) -> (u16, JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            read_test_http_request(&stream).unwrap();
            let _ = entered.send(());
            if let Some(release) = release {
                let _ = release.recv();
            }
            let body = r#"{"ok":true}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        });
        (port, worker)
    }

    fn idle_child() -> ProcessChild {
        #[cfg(windows)]
        let (command, args) = (
            "powershell",
            vec!["-NoProfile", "-Command", "Start-Sleep -Seconds 30"],
        );
        #[cfg(not(windows))]
        let (command, args) = ("/bin/sh", vec!["-c", "sleep 30"]);
        let mut command = Command::new(command);
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        configure_structured_process(&mut command);
        command.spawn().unwrap()
    }

    fn session(port: u16) -> StructuredAgentSessionHandle {
        let child = idle_child();
        let process_tree = StructuredProcessTree::attach(&child).unwrap();
        StructuredAgentSessionHandle {
            process: StructuredAgentProcessHandle {
                child: Arc::new(Mutex::new(child)),
                process_tree,
                termination_reason: Arc::new(Mutex::new(None)),
            },
            stdin: None,
            protocol: "opencode-sse".to_string(),
            cwd: ".".to_string(),
            intent: "code".to_string(),
            http_port: Some(port),
            rpc_state: Some(Arc::new(Mutex::new(StructuredAgentRpcState {
                opencode: OpenCodeRpcState {
                    session_id: Some("session-opencode".to_string()),
                    ..Default::default()
                },
                ..Default::default()
            }))),
            provider: None,
            model: None,
            thinking: None,
            approval_policy: None,
            sandbox: None,
            capabilities: StructuredProtocol::OpenCodeSse.capabilities(),
            seq: Arc::new(AtomicU64::new(0)),
        }
    }

    let (slow_entered_tx, slow_entered_rx) = std::sync::mpsc::channel();
    let (slow_release_tx, slow_release_rx) = std::sync::mpsc::channel();
    let (slow_port, slow_server) = prompt_server(slow_entered_tx, Some(slow_release_rx));
    let (fast_entered_tx, _fast_entered_rx) = std::sync::mpsc::channel();
    let (fast_port, fast_server) = prompt_server(fast_entered_tx, None);
    let core = Arc::new(
        Core::new(
            test_init("structured-map-isolation"),
            Arc::new(NullEventSink),
        )
        .unwrap(),
    );
    {
        let mut sessions = core.lock_structured_sessions().unwrap();
        sessions.insert("slow".to_string(), session(slow_port));
        sessions.insert("fast".to_string(), session(fast_port));
    }

    let (slow_done_tx, slow_done_rx) = std::sync::mpsc::channel();
    let slow_core = core.clone();
    let slow = thread::spawn(move || {
        let response = slow_core.call_json(
            &json!({
                "id": "slow-prompt",
                "command": "agent_structured_prompt",
                "payload": { "sessionId": "slow", "prompt": "wait" }
            })
            .to_string(),
        );
        let _ = slow_done_tx.send(response);
    });
    slow_entered_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("slow HTTP request never arrived");

    let (fast_done_tx, fast_done_rx) = std::sync::mpsc::channel();
    let fast_core = core.clone();
    let fast = thread::spawn(move || {
        let response = fast_core.call_json(
            &json!({
                "id": "fast-prompt",
                "command": "agent_structured_prompt",
                "payload": { "sessionId": "fast", "prompt": "continue" }
            })
            .to_string(),
        );
        let _ = fast_done_tx.send(response);
    });
    let independent = fast_done_rx.recv_timeout(Duration::from_secs(2)).ok();
    let isolated = independent.is_some();
    let _ = slow_release_tx.send(());
    let slow_response = slow_done_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("slow request did not resume");
    let fast_response = independent.unwrap_or_else(|| {
        fast_done_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("fast request did not finish after cleanup")
    });
    slow.join().unwrap();
    fast.join().unwrap();
    slow_server.join().unwrap();
    fast_server.join().unwrap();
    core.shutdown();

    assert!(isolated, "slow structured HTTP held the global session map");
    assert_eq!(
        serde_json::from_str::<Value>(&slow_response).unwrap()["ok"],
        true
    );
    assert_eq!(
        serde_json::from_str::<Value>(&fast_response).unwrap()["ok"],
        true
    );
}

#[test]
fn structured_rpc_cancel_uses_native_protocol_messages_and_keeps_turn_state() {
    fn capture_cancel(
        protocol: &str,
        codex_started: bool,
    ) -> (Value, Arc<Mutex<StructuredAgentRpcState>>) {
        let (command, args) = test_capture_stdin_line_command();
        let mut child = Command::new(command)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = Arc::new(Mutex::new(child.stdin.take().unwrap()));
        let state = Arc::new(Mutex::new(StructuredAgentRpcState {
            turn_active: true,
            claude: ClaudeRpcState {
                pending_interaction: Some(json!({ "id": "pending" })),
                ..Default::default()
            },
            codex: CodexRpcState {
                thread_id: (protocol == "codex-app-server").then(|| "thread-1".to_string()),
                pending_interaction: Some(json!({ "id": "pending" })),
                ..Default::default()
            },
            ..Default::default()
        }));
        let driver = StructuredProtocolDriver {
            protocol: protocol.to_string(),
            cwd: ".".to_string(),
            db_path: PathBuf::new(),
            session_id: "session-cancel".to_string(),
            stdin: stdin.clone(),
            rpc_state: state.clone(),
            provider: None,
            model: None,
            thinking: None,
            approval_policy: None,
            sandbox: None,
        };
        structured_rpc_cancel(&driver).unwrap();
        if codex_started {
            handle_codex_app_server_line(
                &driver,
                &json!({
                    "method": "turn/started",
                    "params": { "turn": { "id": "turn-1" } }
                }),
            )
            .unwrap();
        }
        let state_guard = state.lock().unwrap();
        assert!(if protocol == "codex-app-server" {
            state_guard.codex.pending_interaction.is_some()
        } else {
            state_guard.claude.pending_interaction.is_some()
        });
        drop(state_guard);
        drop(driver);
        drop(stdin);
        let output = child.wait_with_output().unwrap();
        let stdout = String::from_utf8(output.stdout).unwrap();
        (serde_json::from_str(stdout.trim()).unwrap(), state)
    }

    let (claude, _) = capture_cancel("claude-stream-json", false);
    assert_eq!(claude["type"], "control_request");
    assert_eq!(claude["request"]["subtype"], "interrupt");

    let (pi, _) = capture_cancel("pi-rpc", false);
    assert_eq!(pi["type"], "abort");

    let (codex, state) = capture_cancel("codex-app-server", true);
    assert_eq!(codex["method"], "turn/interrupt");
    assert_eq!(codex["params"]["threadId"], "thread-1");
    assert_eq!(codex["params"]["turnId"], "turn-1");
    finish_structured_turn(&state);
    let state = state.lock().unwrap();
    assert!(!state.turn_active);
    assert!(state.codex.pending_interaction.is_none());
}

#[test]
fn claude_question_request_remains_actionable() {
    let core = Core::new(test_init("claude-question"), Arc::new(NullEventSink)).expect("core");
    let request = json!({
        "id": "parse-question",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "claude-code",
            "protocol": "claude-stream-json",
            "lines": [
                json!({
                    "type": "question_request",
                    "text": "Which approach should I use?"
                }).to_string()
            ]
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(parsed["payload"]["events"][0]["type"], "question_request");
    assert_eq!(parsed["payload"]["messages"][0]["kind"], "question");
    assert_eq!(parsed["payload"]["active"], true);
}

#[test]
fn claude_tool_question_remains_actionable() {
    let core = Core::new(test_init("claude-tool-question"), Arc::new(NullEventSink)).expect("core");
    let request = json!({
        "id": "parse-tool-question",
        "command": "agent_protocol_parse",
        "payload": {
            "adapterId": "claude-code",
            "protocol": "claude-stream-json",
            "lines": [
                json!({
                    "type": "control_request",
                    "request_id": "req-ask",
                    "request": {
                        "subtype": "can_use_tool",
                        "tool_name": "AskUserQuestion",
                        "input": {
                            "questions": [
                                { "question": "Which deployment environment?" }
                            ]
                        }
                    }
                }).to_string()
            ]
        }
    });
    let parsed: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(parsed["payload"]["events"][0]["type"], "question_request");
    assert_eq!(parsed["payload"]["messages"][0]["kind"], "question");
    assert_eq!(parsed["payload"]["active"], true);
}
