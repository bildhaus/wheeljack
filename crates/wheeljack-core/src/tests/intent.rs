use super::support::*;
use crate::*;

struct RecordingWriter(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

impl std::io::Write for RecordingWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0
            .lock()
            .map_err(|_| std::io::Error::other("recording writer lock poisoned"))?
            .extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn intent_parse_classifies_routes_and_dangerous_text() {
    let core = Core::new(test_init("intent"), Arc::new(NullEventSink)).expect("core");
    let parse = |transcript: &str| -> Value {
        let request = json!({
            "id": "intent",
            "command": "intent_parse",
            "payload": {
                "source": "text",
                "transcript": transcript
            }
        });
        serde_json::from_str(&core.call_json(&request.to_string())).unwrap()
    };

    let parsed = parse("tell Skye to optimize backend, and Marshall to work on the frontend");
    assert_eq!(parsed["ok"], true);
    assert_eq!(parsed["payload"]["risk"], "caution");
    assert_eq!(parsed["payload"]["requiresConfirmation"], true);
    assert_eq!(
        parsed["payload"]["actions"],
        json!([{
            "type": "route_terminal_prompts",
            "assignments": [
                {"target": "Skye", "task": "optimize backend"},
                {"target": "Marshall", "task": "work on the frontend"}
            ]
        }])
    );

    let parsed = parse("run git reset --hard");
    assert_eq!(parsed["payload"]["risk"], "dangerous");
    assert_eq!(parsed["payload"]["requiresConfirmation"], true);
    assert_eq!(
        parse("Remove-Item dist -Recurse -Force")["payload"]["risk"],
        "dangerous"
    );
    assert_eq!(
        parse("run rm    -rf ./dist")["payload"]["risk"],
        "dangerous"
    );
    assert_eq!(
        parse("git reset   --hard HEAD")["payload"]["risk"],
        "dangerous"
    );

    let parsed = parse("Open localhost 3000 in a browser node");
    let browser_action = parsed["payload"]["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|action| action["type"] == "create_browser_node")
        .unwrap();
    assert_eq!(browser_action["url"], "http://localhost:3000");
    assert_eq!(
        parse("Open google.com in a browser node")["payload"]["actions"],
        json!([{"type": "create_browser_node", "url": "https://google.com"}])
    );
    assert_eq!(
        parse("Open localhost.example.com in a browser node")["payload"]["actions"],
        json!([{"type": "create_browser_node", "url": "https://localhost.example.com"}])
    );
    assert_eq!(
        normalize_browser_url("127.0.0.10:3000"),
        "https://127.0.0.10:3000"
    );
    assert_eq!(
        parse("Open https://github.com in a browser node")["payload"]["actions"],
        json!([{"type": "create_browser_node", "url": "https://github.com"}])
    );
    assert_eq!(
        parse("open browser at localhost:4568/from-composer")["payload"]["actions"][0]["url"],
        "http://localhost:4568/from-composer"
    );
    assert_eq!(
        detect_local_preview_url(
            "opencode server listening on http://127.0.0.1:4090\nready http://0.0.0.0:5173/"
        ),
        Some("http://127.0.0.1:5173/".to_string())
    );
    assert_eq!(
        detect_local_preview_url("http://localhost:5173/v1/chat/completions"),
        None
    );

    let detect_request = json!({
        "id": "detect",
        "command": "browser_detect_local_preview_urls",
        "payload": {
            "chunks": [
                "Local: http://127.0.0.1:5173/",
                "again http://127.0.0.1:5173/",
                "api http://localhost:5173/v1/chat/completions",
                "docs localhost:3000/docs"
            ]
        }
    });
    let detected: Value =
        serde_json::from_str(&core.call_json(&detect_request.to_string())).unwrap();
    assert_eq!(
        detected["payload"],
        json!(["http://127.0.0.1:5173/", "http://localhost:3000/docs"])
    );
    assert_eq!(
        detect_local_preview_urls("\x1b[32mready localhost:3001\x1b[0m\rother http://[::1]:7000/"),
        vec![
            "http://localhost:3001/".to_string(),
            "http://[::1]:7000/".to_string()
        ]
    );
    assert_eq!(
            detect_local_preview_urls(
                "\x1b]0;http://localhost:9999\x07ready localhost:5174\nopencode server listening on https://127.0.0.1:4096"
            ),
            vec!["http://localhost:5174/".to_string()]
        );

    let parsed = parse("add markdown note and create task checklist");
    let action_types: Vec<_> = parsed["payload"]["actions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|action| action["type"].as_str().unwrap().to_string())
        .collect();
    assert!(action_types.contains(&"create_markdown_note".to_string()));
    assert!(action_types.contains(&"create_task_checklist".to_string()));

    assert_eq!(
        parse("draw a diamond shape")["payload"]["actions"],
        json!([{"type": "create_shape_node", "shape": "diamond"}])
    );
    assert_eq!(
        parse("add circle")["payload"]["actions"],
        json!([{"type": "create_shape_node", "shape": "circle"}])
    );
    assert_eq!(
        parse("new rectangle")["payload"]["actions"],
        json!([{"type": "create_shape_node", "shape": "rectangle"}])
    );

    let parsed = parse("4 terminals in documents/dev");
    let shell_action = &parsed["payload"]["actions"][0];
    assert_eq!(shell_action["type"], "create_shell_node");
    assert_eq!(shell_action["count"], 4);
    assert_eq!(shell_action["cwd"], "~/Documents/dev");

    let parsed = parse("Create three Claude agents for testapp");
    let agent_action = &parsed["payload"]["actions"][0];
    assert_eq!(agent_action["type"], "create_agent_nodes");
    assert_eq!(agent_action["adapterId"], "claude-code");
    assert_eq!(agent_action["count"], 3);
    assert_eq!(agent_action["projectName"], "testapp");

    assert_eq!(
        parse("Launch cursor-agent terminal")["payload"]["actions"],
        json!([{"type": "unknown", "text": "Launch cursor-agent terminal"}])
    );
    assert_eq!(
        parse("Create pipeline worker")["payload"]["actions"],
        json!([{"type": "unknown", "text": "Create pipeline worker"}])
    );

    let parsed = parse("start 2 claude agents in /documents/dev");
    let agent_action = &parsed["payload"]["actions"][0];
    assert_eq!(agent_action["cwd"], "~/Documents/dev");

    let parsed = parse("add two shell terminals");
    let shell_action = parsed["payload"]["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|action| action["type"] == "create_shell_node")
        .unwrap();
    assert_eq!(shell_action["count"], 2);

    assert_eq!(
        parse("Launch wheeljack orchestrator")["payload"]["actions"],
        json!([{"type": "create_orchestrator_node"}])
    );
    assert_eq!(
        parse("Add a music player")["payload"]["actions"],
        json!([{"type": "create_focus_widget"}])
    );
    assert_eq!(
        parse("start Apple Music")["payload"]["actions"],
        json!([{"type": "unknown", "text": "start Apple Music"}])
    );
    assert_eq!(
        parse("switch to light theme")["payload"]["actions"],
        json!([{"type": "switch_theme", "themeId": "mono-light"}])
    );
    assert_eq!(
        parse("zoom to 150%")["payload"]["actions"],
        json!([{"type": "zoom", "scale": 1.5}])
    );
    assert_eq!(
        parse("arrange as grid")["payload"]["actions"],
        json!([{"type": "arrange_grid"}])
    );
    assert_eq!(
        parse("new workspace Backend agents")["payload"]["actions"],
        json!([{"type": "create_workspace", "name": "Backend agents"}])
    );
    assert_eq!(
        parse("new workspace Backend agents and add a browser node")["payload"]["actions"],
        json!([
            {"type": "create_workspace", "name": "Backend agents"},
            {"type": "create_browser_node", "url": "http://localhost:3000"}
        ])
    );
    assert_eq!(
        parse("new workspace Research and Development")["payload"]["actions"],
        json!([{"type": "create_workspace", "name": "Research and Development"}])
    );
    assert_eq!(
        parse("new workspace")["payload"]["actions"],
        json!([{"type": "create_workspace", "name": ""}])
    );
    assert_eq!(
        parse("switch workspace Backend agents")["payload"]["actions"],
        json!([{"type": "switch_workspace", "query": "Backend agents"}])
    );
    assert_eq!(
        parse("move workspace left")["payload"]["actions"],
        json!([{"type": "move_workspace", "direction": "left"}])
    );
    assert_eq!(
        parse("reset workspaces")["payload"]["actions"],
        json!([{"type": "reset_workspaces"}])
    );
    assert_eq!(
        parse("rename workspace to Launch plan")["payload"]["actions"],
        json!([{"type": "rename_workspace", "name": "Launch plan"}])
    );
    assert_eq!(
        parse("delete current workspace")["payload"]["actions"],
        json!([{"type": "delete_workspace"}])
    );
    assert_eq!(
        parse("focus Skye")["payload"]["actions"],
        json!([{"type": "focus_node", "query": "Skye"}])
    );
    assert_eq!(
        parse("ask all: ship status")["payload"]["actions"],
        json!([{"type": "broadcast_prompt", "prompt": "ship status"}])
    );
    assert_eq!(
        normalize_requested_cwd(Some(r"\\documents\share")),
        Some(r"\\documents\share".to_string())
    );
}

#[test]
fn intent_execute_reports_shell_handled_actions() {
    let core = Core::new(test_init("intent-shell"), Arc::new(NullEventSink)).expect("core");
    let parsed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "parse",
                "command": "intent_parse",
                "payload": {
                    "source": "typed",
                    "transcript": "open localhost:3000"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    let executed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "execute",
                "command": "intent_execute",
                "payload": {
                    "intent": parsed["payload"],
                    "approved": true
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(executed["ok"], true);
    assert_eq!(executed["payload"]["ok"], true);
    assert_eq!(
        executed["payload"]["message"],
        "Intent contains only shell-handled actions."
    );
}

#[test]
fn orchestrator_tool_plan_commands_include_native_workspace_tools() {
    let core = Core::new(test_init("orchestrator-tools"), Arc::new(NullEventSink)).expect("core");
    let prompt_request = json!({
        "id": "prompt",
        "command": "orchestrator_harness_prompt",
        "payload": {
            "requestId": "request_1",
            "userRequest": "Create two Codex agents",
            "workspaceName": "Main",
            "workspacePath": "D:/DEV/wheeljack",
            "nodes": []
        }
    });
    let prompt_response: Value =
        serde_json::from_str(&core.call_json(&prompt_request.to_string())).unwrap();
    let prompt = prompt_response["payload"].as_str().unwrap();
    assert!(prompt.contains("wheeljack.tool_plan"));
    assert!(prompt.contains("create_agent_nodes"));
    assert!(prompt.contains("{adapterId:string,count?:number,cwd?:string}"));
    assert!(prompt.contains("create_shell_node"));
    assert!(prompt.contains("{count?:number,cwd?:string}"));
    assert!(prompt.contains("create_shape_node"));
    assert!(prompt.contains("{shape?:'rectangle'|'circle'|'diamond'}"));
    assert!(prompt.contains("reset_pane"));
    assert!(prompt.contains("{query:string}"));
    assert!(prompt.contains("create_workspace"));
    assert!(prompt.contains("rename_workspace"));
    assert!(prompt.contains("switch_workspace"));
    assert!(prompt.contains("move_workspace"));
    assert!(prompt.contains("reset_workspaces"));
    assert!(prompt.contains("delete_workspace"));
    assert!(!prompt.contains("Cursor=cursor-cli"));
    assert!(!prompt.contains("\"tool\":\"create_orchestrator_node\""));
    assert!(prompt.contains("request_1"));

    let parse_plan = |text: &str, request_id: &str| -> Value {
        let request = json!({
            "id": "parse",
            "command": "orchestrator_tool_plan_parse",
            "payload": {
                "text": text,
                "requestId": request_id
            }
        });
        serde_json::from_str(&core.call_json(&request.to_string())).unwrap()
    };

    let parsed = parse_plan(
        r#"Thinking.
wheeljack.tool_plan {"requestId":"request_1","message":"Create agents","calls":[{"tool":"create_agent_nodes","args":{"adapterId":"codex-cli","count":2}}]}"#,
        "request_1",
    );
    assert_eq!(parsed["payload"][0]["requestId"], "request_1");
    assert_eq!(parsed["payload"][0]["message"], "Create agents");
    assert_eq!(
        parsed["payload"][0]["calls"][0],
        json!({"tool": "create_agent_nodes", "args": {"adapterId": "codex-cli", "count": 2}})
    );

    let parsed = parse_plan(
        r#"```json
{"requestId":"request_2","calls":[{"tool":"arrange_grid","args":{}}]}
```"#,
        "request_2",
    );
    assert_eq!(
        parsed["payload"][0]["calls"][0],
        json!({"tool": "arrange_grid", "args": {}})
    );

    let parsed = parse_plan(
        r#"[{"name":"create_shell_node","arguments":{"count":4,"cwd":"~/Documents/dev"}}]"#,
        "request_3",
    );
    assert_eq!(
        parsed["payload"][0]["calls"][0],
        json!({"tool": "create_shell_node", "args": {"count": 4, "cwd": "~/Documents/dev"}})
    );

    let parsed = parse_plan(
        r#"[{"name":"create_agent_nodes","arguments":{"adapterId":"Pi","count":2,"cwd":"~/Documents/dev"}}]"#,
        "request_4",
    );
    assert_eq!(
        parsed["payload"][0]["calls"][0]["args"],
        json!({"adapterId": "pi-coding-agent", "count": 2, "cwd": "~/Documents/dev"})
    );

    let parsed = parse_plan(
        r#"[{"type":"function","function":{"name":"create_browser_node","arguments":"{\"url\":\"localhost:3000\"}"}}]"#,
        "request_5",
    );
    assert_eq!(
        parsed["payload"][0]["calls"][0],
        json!({"tool": "create_browser_node", "args": {"url": "localhost:3000"}})
    );

    let parsed = parse_plan(
        r#"[{"name":"create_shape_node","arguments":{"shape":"diamond"}}]"#,
        "request_shape",
    );
    assert_eq!(
        parsed["payload"][0]["calls"][0],
        json!({"tool": "create_shape_node", "args": {"shape": "diamond"}})
    );

    let parsed = parse_plan(
        r#"[{"name":"reset_pane","arguments":{"query":"shape"}}]"#,
        "request_reset",
    );
    assert_eq!(
        parsed["payload"][0]["calls"][0],
        json!({"tool": "reset_pane", "args": {"query": "shape"}})
    );

    let parsed = parse_plan(
        r#"wheeljack.tool_plan {"requestId":"request_6","calls":[{"tool":"create_workspace","args":{"name":"Backend agents"}}]}"#,
        "request_6",
    );
    assert_eq!(
        parsed["payload"][0]["calls"][0],
        json!({"tool": "create_workspace", "args": {"name": "Backend agents"}})
    );
    let parsed = parse_plan(
        r#"wheeljack.tool_plan {"requestId":"request_7","calls":[{"tool":"switch_workspace","args":{"query":"Backend agents"}}]}"#,
        "request_7",
    );
    assert_eq!(
        parsed["payload"][0]["calls"][0],
        json!({"tool": "switch_workspace", "args": {"query": "Backend agents"}})
    );
    let parsed = parse_plan(
        r#"wheeljack.tool_plan {"requestId":"request_8","calls":[{"tool":"move_workspace","args":{"direction":"left"}}]}"#,
        "request_8",
    );
    assert_eq!(
        parsed["payload"][0]["calls"][0],
        json!({"tool": "move_workspace", "args": {"direction": "left"}})
    );
    let parsed = parse_plan(
        r#"wheeljack.tool_plan {"requestId":"request_9","calls":[{"tool":"reset_workspaces","args":{}}]}"#,
        "request_9",
    );
    assert_eq!(
        parsed["payload"][0]["calls"][0],
        json!({"tool": "reset_workspaces", "args": {}})
    );

    let intent_request = json!({
        "id": "intent",
        "command": "orchestrator_tool_plan_intent",
        "payload": {
            "transcript": "Create agents and send Skye a task",
            "source": "local-planner-test",
            "plan": {
                "message": "Route work",
                "calls": [
                    {"tool": "create_agent_nodes", "args": {"adapterId": "codex-cli", "count": 2, "cwd": "~/Documents/dev"}},
                    {"tool": "create_shell_node", "args": {"count": 2, "path": "~/Downloads/builds"}},
                    {"tool": "create_shape_node", "args": {"shape": "circle"}},
                    {"tool": "reset_pane", "args": {"query": "shape"}},
                    {"tool": "switch_workspace", "args": {"query": "Backend agents"}},
                    {"tool": "move_workspace", "args": {"direction": "right"}},
                    {"tool": "reset_workspaces", "args": {}},
                    {"tool": "route_terminal_prompts", "args": {"assignments": [{"target": "Skye", "task": "run tests"}]}}
                ]
            }
        }
    });
    let intent_response: Value =
        serde_json::from_str(&core.call_json(&intent_request.to_string())).unwrap();
    assert_eq!(intent_response["ok"], true);
    assert_eq!(intent_response["payload"]["source"], "local-planner-test");
    assert_eq!(intent_response["payload"]["risk"], "caution");
    assert_eq!(intent_response["payload"]["requiresConfirmation"], true);
    assert_eq!(intent_response["payload"]["explanation"], "Route work");
    assert_eq!(
        intent_response["payload"]["actions"][0],
        json!({"type": "create_agent_nodes", "adapterId": "codex-cli", "count": 2, "cwd": "~/Documents/dev"})
    );
    assert_eq!(
        intent_response["payload"]["actions"][1],
        json!({"type": "create_shell_node", "count": 2, "cwd": "~/Downloads/builds"})
    );
    assert_eq!(
        intent_response["payload"]["actions"][2],
        json!({"type": "create_shape_node", "shape": "circle"})
    );
    assert_eq!(
        intent_response["payload"]["actions"][3],
        json!({"type": "reset_pane", "query": "shape"})
    );
    assert_eq!(
        intent_response["payload"]["actions"][4],
        json!({"type": "switch_workspace", "query": "Backend agents"})
    );
    assert_eq!(
        intent_response["payload"]["actions"][5],
        json!({"type": "move_workspace", "direction": "right"})
    );
    assert_eq!(
        intent_response["payload"]["actions"][6],
        json!({"type": "reset_workspaces"})
    );
    assert_eq!(
        intent_response["payload"]["actions"][7],
        json!({"type": "route_terminal_prompts", "assignments": [{"target": "Skye", "task": "run tests"}]})
    );

    let default_agent_intent_request = json!({
        "id": "intent-default-agent",
        "command": "orchestrator_tool_plan_intent",
        "payload": {
            "transcript": "Create an agent",
            "source": "local-planner-test",
            "plan": {
                "calls": [
                    {"tool": "create_agent_nodes", "args": {}}
                ]
            }
        }
    });
    let default_agent_intent_response: Value =
        serde_json::from_str(&core.call_json(&default_agent_intent_request.to_string())).unwrap();
    assert_eq!(
        default_agent_intent_response["payload"]["actions"][0],
        json!({"type": "create_agent_nodes", "adapterId": "codex-cli", "count": 1})
    );

    let count_intent_request = json!({
        "id": "intent-counts",
        "command": "orchestrator_tool_plan_intent",
        "payload": {
            "transcript": "Create many terminals",
            "source": "local-planner-test",
            "plan": {
                "calls": [
                    {"tool": "create_agent_nodes", "args": {"count": 7.6}},
                    {"tool": "create_shell_node", "args": {"count": 99}}
                ]
            }
        }
    });
    let count_intent_response: Value =
        serde_json::from_str(&core.call_json(&count_intent_request.to_string())).unwrap();
    assert_eq!(count_intent_response["payload"]["actions"][0]["count"], 6);
    assert_eq!(count_intent_response["payload"]["actions"][1]["count"], 12);

    let invalid_optional_intent_request = json!({
        "id": "intent-invalid-optional",
        "command": "orchestrator_tool_plan_intent",
        "payload": {
            "transcript": "Apply optional UI changes",
            "source": "local-planner-test",
            "plan": {
                "calls": [
                    {"tool": "switch_theme", "args": {"themeId": "solarized"}},
                    {"tool": "zoom", "args": {}},
                    {"tool": "focus_node", "args": {}}
                ]
            }
        }
    });
    let invalid_optional_intent_response: Value =
        serde_json::from_str(&core.call_json(&invalid_optional_intent_request.to_string()))
            .unwrap();
    assert_eq!(invalid_optional_intent_response["payload"], Value::Null);
}

#[test]
fn orchestrator_route_plans_with_recent_terminal_context() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("orchestrator"), sink.clone()).expect("core");
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
                 VALUES ('node_skye', 'canvas_main', 'agent_terminal', 'Skye', 0, 0, 600, 300, 1, ?1, 'now', 'now')",
                params![json!({
                    "adapterId": "claude-code",
                    "status": "running",
                    "transcript": ["Skye is profiling backend endpoints."]
                }).to_string()],
            )
            .unwrap();
        db.execute(
                "INSERT INTO nodes (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
                 VALUES ('node_marshall', 'canvas_main', 'agent_terminal', 'Marshall', 0, 0, 600, 300, 2, ?1, 'now', 'now')",
                params![json!({
                    "adapterId": "claude-code",
                    "status": "awaiting_input",
                    "transcript": ["Marshall has the app open."]
                }).to_string()],
            )
            .unwrap();
        db.execute(
                "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
                 VALUES ('session_skye', 'node_skye', 'claude-code', '{}', '.', 'running', 'now', 'now', 'now')",
                [],
            )
            .unwrap();
        db.execute(
                "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
                 VALUES ('session_marshall', 'node_marshall', 'claude-code', '{}', '.', 'running', 'now', 'now', 'now')",
                [],
            )
            .unwrap();
        persist_session_stream_chunk(
                &db,
                "session_skye",
                1,
                "pty",
                b"user -> txtl workspace coordination:\n- Your callsign is Skye.\n\nUser instruction:\nOptimize backend handlers\n",
            )
            .unwrap();
        persist_session_stream_chunk(
            &db,
            "session_skye",
            2,
            "pty",
            b"backend profiler output: slow handler",
        )
        .unwrap();
        persist_session_stream_chunk(
            &db,
            "session_marshall",
            1,
            "pty",
            b"frontend bundle check: panel state",
        )
        .unwrap();
    }

    let request = json!({
        "id": "route",
        "command": "orchestrator_route",
        "payload": {
            "transcript": "tell Skye to optimize backend, and Marshall to work on the frontend",
            "assignments": [],
            "canvasId": "canvas_main",
            "approved": false,
            "dryRun": true
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["requiresConfirmation"], true);
    assert_eq!(response["payload"]["routes"].as_array().unwrap().len(), 2);
    assert_eq!(response["payload"]["routes"][0]["nodeTitle"], "Skye");
    assert!(response["payload"]["routes"][0]["prompt"]
        .as_str()
        .unwrap()
        .contains("backend profiler output"));
    assert!(response["payload"]["routes"][0]["prompt"]
        .as_str()
        .unwrap()
        .contains("user -> Optimize backend handlers"));
    assert!(!response["payload"]["routes"][0]["prompt"]
        .as_str()
        .unwrap()
        .contains("txtl workspace coordination"));
    assert_eq!(response["payload"]["routes"][1]["nodeTitle"], "Marshall");
    assert!(response["payload"]["routes"][1]["prompt"]
        .as_str()
        .unwrap()
        .contains("frontend bundle check"));
    assert!(sink
        .snapshot()
        .iter()
        .any(|(event, _)| event == "orchestrator:route"));

    let assignment_request = json!({
        "workspaceId": "canvas_main",
        "assignments": [
            {"target": "node_skye", "task": "implement backend", "taskId": "child-backend"},
            {"target": "node_marshall", "task": "implement frontend", "taskId": "child-frontend"}
        ]
    });
    let assignment_preview: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "assignment-preview",
                "command": "route_preview",
                "protocolVersion": 2,
                "payload": assignment_request
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(
        assignment_preview["payload"]["targets"][0]["taskId"],
        "child-backend"
    );
    assert_eq!(
        assignment_preview["payload"]["targets"][0]["task"],
        "implement backend"
    );
    assert_eq!(
        assignment_preview["payload"]["targets"][1]["taskId"],
        "child-frontend"
    );
    assert_eq!(
        assignment_preview["payload"]["targets"][1]["task"],
        "implement frontend"
    );
    let assignment_token = assignment_preview["payload"]["confirmationToken"].clone();
    let assignment_result: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "assignment-execute",
                "command": "route_execute",
                "protocolVersion": 2,
                "payload": {
                    "workspaceId": "canvas_main",
                    "assignments": assignment_request["assignments"],
                    "confirmationToken": assignment_token
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(
        assignment_result["payload"]["targets"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        assignment_result["payload"]["targets"][0]["taskId"],
        "child-backend"
    );

    let preview: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "preview",
                "command": "route_preview",
                "protocolVersion": 2,
                "payload": {
                    "workspaceId": "canvas_main",
                    "recipientIds": ["node_skye"],
                    "message": "run focused tests"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(preview["payload"]["recipients"], json!(["Skye"]));
    assert_eq!(preview["payload"]["requiresConfirmation"], true);
    let token = preview["payload"]["confirmationToken"]
        .as_str()
        .unwrap()
        .to_string();
    let tampered: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "execute",
                "command": "route_execute",
                "protocolVersion": 2,
                "payload": {
                    "workspaceId": "canvas_main",
                    "recipientIds": ["node_skye"],
                    "message": "different task",
                    "confirmationToken": token
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(tampered["error"]["code"], "safety_denied");

    let replayed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "replay",
                "command": "route_execute",
                "protocolVersion": 2,
                "payload": {
                    "workspaceId": "canvas_main",
                    "recipientIds": ["node_skye"],
                    "message": "run focused tests",
                    "confirmationToken": token
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(replayed["error"]["code"], "safety_denied");
    assert!(replayed["error"]["message"]
        .as_str()
        .unwrap()
        .contains("already used"));

    let drift_preview: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "drift-preview",
                "command": "route_preview",
                "protocolVersion": 2,
                "payload": {
                    "workspaceId": "canvas_main",
                    "recipientIds": ["node_skye"],
                    "message": "run focused tests"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    let drift_token = drift_preview["payload"]["confirmationToken"]
        .as_str()
        .unwrap()
        .to_string();
    {
        let db = core.lock_db().unwrap();
        db.execute(
            "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
             VALUES ('session_skye_replaced', 'node_skye', 'claude-code', '{}', '.', 'running', 'zzzz', 'zzzz', 'zzzz')",
            [],
        )
        .unwrap();
    }
    let drifted: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "drift-execute",
                "command": "route_execute",
                "protocolVersion": 2,
                "payload": {
                    "workspaceId": "canvas_main",
                    "recipientIds": ["node_skye"],
                    "message": "run focused tests",
                    "confirmationToken": drift_token
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(drifted["error"]["code"], "safety_denied");
    assert!(drifted["error"]["message"]
        .as_str()
        .unwrap()
        .contains("route targets changed"));
}

#[test]
fn coordination_orchestrator_route_recovers_persisted_task_context_after_restart() {
    let sink = Arc::new(RecordingSink::default());
    let init = test_init("orchestrator-restart");
    let core = Core::new(init.clone(), sink.clone()).expect("core");
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
             VALUES ('node_skye', 'canvas_main', 'agent_terminal', 'Skye', 0, 0, 600, 300, 1, ?1, 'now', 'now')",
            params![json!({
                "adapterId": "claude-code",
                "status": "running",
                "transcript": []
            })
            .to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at)
             VALUES ('session_skye', 'node_skye', 'claude-code', '{}', '.', 'running', 'now', 'now', 'now')",
            [],
        )
        .unwrap();
        persist_session_stream_chunk(
            &db,
            "session_skye",
            1,
            "pty",
            b"user -> wheeljack workspace coordination:\n- Your callsign is Skye.\n\nUser instruction:\nFinish the recovery fix\n",
        )
        .unwrap();
        persist_session_stream_chunk(
            &db,
            "session_skye",
            2,
            "pty",
            b"Skye is still working from the persisted task context",
        )
        .unwrap();
    }

    drop(core);
    let core = Core::new(init, sink).expect("core");

    let request = json!({
        "id": "route",
        "command": "orchestrator_route",
        "payload": {
            "transcript": "tell Skye to continue the recovery fix",
            "assignments": [],
            "canvasId": "canvas_main",
            "approved": false,
            "dryRun": true
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["routes"].as_array().unwrap().len(), 1);
    assert_eq!(response["payload"]["routes"][0]["nodeTitle"], "Skye");
    assert_eq!(response["payload"]["routes"][0]["status"], "disconnected");
    assert!(response["payload"]["routes"][0]["prompt"]
        .as_str()
        .unwrap()
        .contains("Finish the recovery fix"));
    assert!(response["payload"]["routes"][0]["prompt"]
        .as_str()
        .unwrap()
        .contains("Skye is still working from the persisted task context"));
}

#[test]
fn orchestrator_route_continues_after_guarded_recipient() {
    let core =
        Core::new(test_init("orchestrator-delivery"), Arc::new(NullEventSink)).expect("core");
    let (command, args) = test_structured_echo_command();
    let spawn = |id: &str, node_id: &str, adapter_id: &str| {
        let response: Value = serde_json::from_str(
            &core.call_json(
                &json!({
                    "id": id,
                    "command": "pty_spawn",
                    "payload": {
                        "nodeId": node_id,
                        "adapterId": adapter_id,
                        "command": command,
                        "args": args,
                        "cwd": std::env::current_dir().unwrap(),
                        "rows": 5,
                        "cols": 100
                    }
                })
                .to_string(),
            ),
        )
        .unwrap();
        assert_eq!(response["ok"], true);
        response["payload"]["id"].as_str().unwrap().to_string()
    };
    let good_session = spawn("spawn-good", "node_good", "generic-shell");
    let blocked_session = spawn("spawn-blocked", "node_blocked", "claude-code");
    let routed_prompt = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let original_writer = {
        let writer: Box<dyn std::io::Write + Send> =
            Box::new(RecordingWriter(routed_prompt.clone()));
        let mut sessions = core.lock_pty_sessions().unwrap();
        let session = sessions.get_mut(&good_session).unwrap();
        let original_writer = session.writer.clone();
        session.writer = std::sync::Arc::new(std::sync::Mutex::new(writer));
        original_writer
    };

    {
        let db = core.lock_db().unwrap();
        db.execute(
            "INSERT INTO projects (id, name, path, created_at, updated_at)
             VALUES ('project_delivery', 'Delivery', '.', 'now', 'now')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO canvases (id, project_id, name, theme_id, camera_json, created_at, updated_at)
             VALUES ('canvas_delivery', 'project_delivery', 'Main', 'default', '{}', 'now', 'now')",
            [],
        )
        .unwrap();
        for (id, title, adapter_id, z_index) in [
            ("node_good", "Good", "generic-shell", 1),
            ("node_blocked", "Blocked", "claude-code", 2),
        ] {
            db.execute(
                "INSERT INTO nodes (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
                 VALUES (?1, 'canvas_delivery', 'agent_terminal', ?2, 0, 0, 600, 300, ?3, ?4, 'now', 'now')",
                params![
                    id,
                    title,
                    z_index,
                    json!({ "adapterId": adapter_id, "status": "running" }).to_string()
                ],
            )
            .unwrap();
        }
        persist_session_stream_chunk(
            &db,
            &blocked_session,
            1,
            "pty",
            b"Security guide\nYes, I trust this folder\nEnter to confirm",
        )
        .unwrap();
    }

    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "route",
                "command": "orchestrator_route",
                "payload": {
                    "transcript": "",
                    "assignments": [
                        { "target": "Good", "task": "run the focused tests" },
                        { "target": "Blocked", "task": "edit the guarded folder" }
                    ],
                    "canvasId": "canvas_delivery",
                    "approved": true,
                    "dryRun": false
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["ok"], false);
    let routes = response["payload"]["routes"].as_array().unwrap();
    let good = routes
        .iter()
        .find(|route| route["nodeTitle"] == "Good")
        .unwrap();
    assert_eq!(good["delivered"], true);
    assert_eq!(good["reason"], Value::Null);
    let blocked = routes
        .iter()
        .find(|route| route["nodeTitle"] == "Blocked")
        .unwrap();
    assert_eq!(blocked["delivered"], false);
    assert!(blocked["reason"]
        .as_str()
        .unwrap()
        .contains("folder trust confirmation"));

    let routed_prompt = String::from_utf8(routed_prompt.lock().unwrap().clone()).unwrap();
    assert!(routed_prompt.contains("wheeljack orchestrator instruction"));
    let delivered_chunks: i64 = {
        let db = core.lock_db().unwrap();
        db.query_row(
            "SELECT COUNT(*) FROM session_chunks WHERE session_id = ?1 AND stream = 'orchestrator'",
            params![good_session],
            |row| row.get(0),
        )
        .unwrap()
    };
    assert_eq!(delivered_chunks, 1);
    drop(original_writer);
}
