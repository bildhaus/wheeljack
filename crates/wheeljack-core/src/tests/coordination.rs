use super::support::*;
use crate::*;

#[test]
fn coordination_board_ensure_creates_files_and_appends_agent_event() {
    let cwd = temp_dir("coordination-board");
    fs::create_dir_all(&cwd).unwrap();
    let core = Core::new(test_init("coordination-core"), Arc::new(NullEventSink)).expect("core");
    let request = json!({
        "id": "coordination",
        "command": "coordination_board_ensure",
        "payload": {
            "req": {
                "cwd": cwd,
                "boardId": "cwd_test",
                "callsigns": ["Atlas", "bad/name"],
                "agentEvent": {
                    "callsign": "Atlas",
                    "runId": "run-42",
                    "task": "Fix terminal routing",
                    "expectedFiles": ["src/terminal/TerminalNode.tsx", " "],
                    "note": " queued by app "
                }
            }
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();

    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["boardId"], "cwd_test");
    let board_path = PathBuf::from(response["payload"]["boardPath"].as_str().unwrap());
    let tasks_path = PathBuf::from(response["payload"]["tasksPath"].as_str().unwrap());
    let agents_path = PathBuf::from(response["payload"]["agentsPath"].as_str().unwrap());
    assert!(board_path.join("README.md").exists());
    assert!(tasks_path.exists());
    assert!(agents_path.join("bad-name.ndjson").exists());

    let log = fs::read_to_string(agents_path.join("Atlas.ndjson")).unwrap();
    let line = log.lines().last().unwrap();
    let event = serde_json::from_str::<Value>(line).unwrap();
    assert_eq!(event["source"], "wheeljack");
    assert_eq!(event["callsign"], "Atlas");
    assert_eq!(event["runId"], "run-42");
    assert_eq!(event["status"], "queued");
    assert_eq!(event["task"], "Fix terminal routing");
    assert_eq!(event["expectedFiles"][0], "src/terminal/TerminalNode.tsx");
    assert_eq!(event["note"], "queued by app");
    assert!(event["timestamp"].as_str().unwrap().contains('T'));
}

#[test]
fn coordination_board_bounds_agent_event_tasks_to_its_reader_contract() {
    let cwd = temp_dir("coordination-bounded-event");
    fs::create_dir_all(&cwd).unwrap();
    let core = Core::new(
        test_init("coordination-bounded-event-core"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let long_task = "x".repeat(5_000);
    let synced: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "sync",
                "command": "coordination_board_sync",
                "payload": {
                    "cwd": cwd,
                    "callsigns": ["Claude Code 1"],
                    "tasks": []
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(synced["ok"], true);
    let ensured: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "ensure",
                "command": "coordination_board_ensure",
                "payload": {
                    "cwd": cwd,
                    "boardId": synced["payload"]["boardId"],
                    "callsigns": ["Claude Code 1"],
                    "agentEvent": {
                        "callsign": "Claude Code 1",
                        "task": long_task
                    }
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(ensured["ok"], true);

    let events: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "events",
                "command": "coordination_board_events",
                "payload": { "cwd": cwd, "cursors": {} }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(events["ok"], true);
    assert_eq!(events["payload"]["warnings"].as_array().unwrap().len(), 0);
    assert_eq!(
        events["payload"]["events"][0]["task"]
            .as_str()
            .unwrap()
            .len(),
        4_096
    );
}

#[test]
fn coordination_board_rejects_invalid_ids_and_excludes_git_path() {
    let cwd = temp_dir("coordination-git");
    fs::create_dir_all(&cwd).unwrap();
    run_git(&cwd, ["init"]).unwrap();
    let cwd_string = cwd.to_string_lossy().to_string();
    let core =
        Core::new(test_init("coordination-git-core"), Arc::new(NullEventSink)).expect("core");

    let invalid = json!({
        "id": "bad",
        "command": "coordination_board_ensure",
        "payload": {
            "cwd": cwd_string.clone(),
            "boardId": "../escape"
        }
    });
    let rejected: Value = serde_json::from_str(&core.call_json(&invalid.to_string())).unwrap();
    assert_eq!(rejected["ok"], false);

    let valid = json!({
        "id": "valid",
        "command": "coordination_board_ensure",
        "payload": {
            "cwd": cwd_string,
            "boardId": "cwd_git"
        }
    });
    let created: Value = serde_json::from_str(&core.call_json(&valid.to_string())).unwrap();
    assert_eq!(created["ok"], true);

    let exclude = fs::read_to_string(cwd.join(".git").join("info").join("exclude")).unwrap();
    assert!(exclude
        .lines()
        .any(|line| line.trim() == ".wheeljack/coordination/"));
}

#[test]
fn coordination_board_sync_projects_tasks_and_pages_events_without_skipping() {
    let cwd = temp_dir("coordination-board-sync");
    fs::create_dir_all(&cwd).unwrap();
    let core = Core::new(
        test_init("coordination-board-sync-core"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let synced: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "sync",
                "command": "coordination_board_sync",
                "payload": {
                    "cwd": cwd,
                    "callsigns": ["Atlas"],
                    "tasks": [{
                        "id": "task-1",
                        "title": "Prove coordination",
                        "detail": "Read agent events without losing a page.",
                        "status": "active",
                        "assignees": ["Atlas"],
                        "priority": "high"
                    }]
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(synced["ok"], true);
    let tasks_path = PathBuf::from(synced["payload"]["tasksPath"].as_str().unwrap());
    let tasks = fs::read_to_string(tasks_path).unwrap();
    assert!(tasks.contains("Generated by wheeljack"));
    assert!(tasks.contains("## In progress"));
    assert!(tasks.contains("`task-1` [high] Prove coordination"));
    assert!(tasks.contains("Atlas"));

    let agents_path = PathBuf::from(synced["payload"]["agentsPath"].as_str().unwrap());
    let log_path = agents_path.join("Atlas.ndjson");
    let lines = (0..502)
        .map(|index| {
            json!({
                "callsign": "Atlas",
                "taskId": "task-1",
                "task": format!("event {index}"),
                "status": "running",
                "expectedFiles": ["src/lib.rs"]
            })
            .to_string()
        })
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&log_path, format!("{lines}\n")).unwrap();

    let first: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "events-1",
                "command": "coordination_board_events",
                "payload": { "cwd": cwd, "cursors": {} }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(first["payload"]["events"].as_array().unwrap().len(), 500);
    assert_eq!(first["payload"]["cursors"]["Atlas.ndjson"], 500);
    assert_eq!(first["payload"]["events"][0]["taskId"], "task-1");

    let second: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "events-2",
                "command": "coordination_board_events",
                "payload": {
                    "cwd": cwd,
                    "cursors": first["payload"]["cursors"].clone()
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(second["payload"]["events"].as_array().unwrap().len(), 2);
    assert_eq!(second["payload"]["cursors"]["Atlas.ndjson"], 502);
}

#[test]
fn coordination_board_events_skip_malformed_lines_without_hiding_later_events() {
    let cwd = temp_dir("coordination-board-malformed-event");
    fs::create_dir_all(&cwd).unwrap();
    let core = Core::new(
        test_init("coordination-board-malformed-event-core"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let ensured: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "ensure",
                "command": "coordination_board_sync",
                "payload": {
                    "cwd": cwd,
                    "callsigns": ["Atlas"],
                    "tasks": []
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(ensured["ok"], true);
    let agents_path = PathBuf::from(ensured["payload"]["agentsPath"].as_str().unwrap());
    fs::write(
        agents_path.join("Atlas.ndjson"),
        concat!(
            "{not valid ndjson}\n",
            "{\"callsign\":\"Atlas\",\"task\":\"visible task one\",\"status\":\"running\"}\n",
            "{\"callsign\":\"Atlas\",\"task\":\"visible task two\",\"status\":\"done\"}\n"
        ),
    )
    .unwrap();

    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "events",
                "command": "coordination_board_events",
                "payload": { "cwd": cwd, "cursors": {} }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["events"].as_array().unwrap().len(), 2);
    assert_eq!(response["payload"]["events"][0]["task"], "visible task one");
    assert_eq!(response["payload"]["events"][1]["task"], "visible task two");
    assert_eq!(response["payload"]["warnings"].as_array().unwrap().len(), 1);
    assert_eq!(response["payload"]["cursors"]["Atlas.ndjson"], 3);
}

#[test]
fn coordination_board_events_replace_invalid_utf8_without_repeating_warning() {
    let cwd = temp_dir("coordination-board-invalid-utf8");
    fs::create_dir_all(&cwd).unwrap();
    let core = Core::new(
        test_init("coordination-board-invalid-utf8-core"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let ensured: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "ensure",
                "command": "coordination_board_sync",
                "payload": {
                    "cwd": cwd,
                    "callsigns": ["Atlas", "Beacon"],
                    "tasks": []
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    let agents_path = PathBuf::from(ensured["payload"]["agentsPath"].as_str().unwrap());
    let mut invalid_log = br#"{"callsign":"Atlas","task":"status 101"#.to_vec();
    invalid_log.push(0x96);
    invalid_log.extend_from_slice(
        br#"103%","status":"done"}
"#,
    );
    fs::write(agents_path.join("Atlas.ndjson"), invalid_log).unwrap();
    fs::write(
        agents_path.join("Beacon.ndjson"),
        "{\"callsign\":\"Beacon\",\"task\":\"still visible\",\"status\":\"running\"}\n",
    )
    .unwrap();

    let first: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "events-1",
                "command": "coordination_board_events",
                "payload": { "cwd": cwd, "cursors": {} }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(first["ok"], true);
    assert_eq!(first["payload"]["events"].as_array().unwrap().len(), 2);
    assert_eq!(
        first["payload"]["events"][0]["task"],
        "status 101\u{fffd}103%"
    );
    assert_eq!(first["payload"]["events"][1]["task"], "still visible");
    assert_eq!(first["payload"]["warnings"].as_array().unwrap().len(), 1);
    assert_eq!(first["payload"]["cursors"]["Atlas.ndjson"], 1);
    assert_eq!(first["payload"]["cursors"]["Beacon.ndjson"], 1);

    let second: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "events-2",
                "command": "coordination_board_events",
                "payload": {
                    "cwd": cwd,
                    "cursors": first["payload"]["cursors"].clone()
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(second["ok"], true);
    assert!(second["payload"]["events"].as_array().unwrap().is_empty());
    assert!(second["payload"]["warnings"].as_array().unwrap().is_empty());
}

#[test]
fn coordination_board_events_keep_valid_progress_and_drop_only_malformed_snapshots() {
    let cwd = temp_dir("coordination-board-progress");
    fs::create_dir_all(&cwd).unwrap();
    let core = Core::new(
        test_init("coordination-board-progress-core"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let ensured: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "ensure",
                "command": "coordination_board_sync",
                "payload": { "cwd": cwd, "callsigns": ["Atlas"], "tasks": [] }
            })
            .to_string(),
        ),
    )
    .unwrap();
    let agents_path = PathBuf::from(ensured["payload"]["agentsPath"].as_str().unwrap());
    fs::write(
        agents_path.join("Atlas.ndjson"),
        concat!(
            "{\"callsign\":\"Atlas\",\"task\":\"valid progress\",\"status\":\"running\",\"runId\":\"run-1\",\"progress\":{\"runId\":\"run-1\",\"updatedAt\":\"2026-08-11T10:00:00Z\",\"currentStepId\":\"verify\",\"steps\":[{\"id\":\"edit\",\"label\":\"Edit files\",\"state\":\"done\"},{\"id\":\"verify\",\"label\":\"Run tests\",\"state\":\"running\"}]}}\n",
            "{\"callsign\":\"Atlas\",\"task\":\"bad progress\",\"status\":\"running\",\"progress\":{\"runId\":\"run-2\",\"updatedAt\":\"2026-08-11T10:01:00Z\",\"steps\":[{\"id\":\"x\",\"label\":\"Unknown\",\"state\":\"invented\"}]}}\n"
        ),
    )
    .unwrap();

    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "events",
                "command": "coordination_board_events",
                "payload": { "cwd": cwd, "cursors": {} }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["payload"]["events"][0]["runId"], "run-1");
    assert_eq!(
        response["payload"]["events"][0]["progress"]["currentStepId"],
        "verify"
    );
    assert_eq!(
        response["payload"]["events"][0]["progress"]["steps"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert!(response["payload"]["events"][1]["progress"].is_null());
    assert_eq!(response["payload"]["events"][1]["task"], "bad progress");
}

#[test]
fn coordination_board_malformed_line_cannot_hide_later_valid_events_across_pages() {
    let cwd = temp_dir("coordination-board-malformed-paged");
    fs::create_dir_all(&cwd).unwrap();
    let core = Core::new(
        test_init("coordination-board-malformed-paged-core"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let ensured: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "ensure",
                "command": "coordination_board_sync",
                "payload": {
                    "cwd": cwd,
                    "callsigns": ["Atlas"],
                    "tasks": []
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(ensured["ok"], true);
    let agents_path = PathBuf::from(ensured["payload"]["agentsPath"].as_str().unwrap());
    let mut lines = vec![
        "{not valid ndjson}".to_string(),
        json!({
            "callsign": "Atlas",
            "task": "event one",
            "status": "running"
        })
        .to_string(),
    ];
    lines.extend((2..502).map(|index| {
        json!({
            "callsign": "Atlas",
            "task": format!("event {index}"),
            "status": "running"
        })
        .to_string()
    }));
    fs::write(
        agents_path.join("Atlas.ndjson"),
        format!("{}\n", lines.join("\n")),
    )
    .unwrap();

    let first: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "events-1",
                "command": "coordination_board_events",
                "payload": { "cwd": cwd, "cursors": {} }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(first["ok"], true);
    assert_eq!(first["payload"]["events"].as_array().unwrap().len(), 499);
    assert_eq!(first["payload"]["warnings"].as_array().unwrap().len(), 1);
    assert_eq!(first["payload"]["cursors"]["Atlas.ndjson"], 500);
    assert_eq!(first["payload"]["events"][0]["task"], "event one");
    assert_eq!(first["payload"]["events"][498]["task"], "event 499");

    let second: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "events-2",
                "command": "coordination_board_events",
                "payload": {
                    "cwd": cwd,
                    "cursors": first["payload"]["cursors"].clone()
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(second["ok"], true);
    assert_eq!(second["payload"]["events"].as_array().unwrap().len(), 2);
    assert_eq!(second["payload"]["warnings"].as_array().unwrap().len(), 0);
    assert_eq!(second["payload"]["cursors"]["Atlas.ndjson"], 502);
    assert_eq!(second["payload"]["events"][0]["task"], "event 500");
    assert_eq!(second["payload"]["events"][1]["task"], "event 501");
}

#[test]
fn coordination_checklist_plan_adds_visible_board_for_same_cwd_agents() {
    let core = Core::new(
        test_init("coordination-checklist-plan"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "coordination-plan",
        "command": "coordination_checklist_plan",
        "payload": {
            "canvasId": "canvas_test",
            "workspacePath": "D:/DEV/wheeljack",
            "nodes": [
                agent_node_json("node_atlas", "Atlas", "D:/DEV/wheeljack", 0),
                agent_node_json("node_beacon", "Beacon", "D:\\DEV\\wheeljack", 1)
            ]
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["createdCount"], 1);
    let nodes = response["payload"]["nodes"].as_array().unwrap();
    let board = nodes
        .iter()
        .find(|node| node["kind"] == "task_checklist")
        .unwrap();
    assert_eq!(board["title"], "Coordination - wheeljack");
    assert_eq!(board["data"]["coordination"]["mode"], "shared-cwd");
    assert_eq!(
        board["data"]["coordination"]["peers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|peer| peer["callsign"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["Atlas", "Beacon"]
    );
    assert_eq!(
        board["data"]["items"][0]["label"],
        DEFAULT_COORDINATION_TASK_LABEL
    );
}

#[test]
fn coordination_checklist_plan_collapses_home_alias_duplicate_boards() {
    let core = Core::new(
        test_init("coordination-checklist-collapse"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "coordination-plan",
        "command": "coordination_checklist_plan",
        "payload": {
            "canvasId": "canvas_test",
            "workspacePath": "C:/Users/USER/Documents/dev",
            "nodes": [
                agent_node_json("node_atlas", "Atlas", "C:/Users/USER/Documents/dev", 0),
                agent_node_json("node_beacon", "Beacon", "C:\\Users\\USER\\Documents\\dev", 1),
                coordination_board_node_json(
                    "node_board_tilde",
                    "~/Documents/dev",
                    "cwd_legacy_tilde",
                    "Review shared board",
                    2
                ),
                coordination_board_node_json(
                    "node_board_full",
                    "C:/Users/USER/Documents/dev",
                    "cwd_legacy_full",
                    "Beacon follow-up",
                    3
                )
            ]
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["createdCount"], 0);
    let boards = response["payload"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|node| node["kind"] == "task_checklist")
        .collect::<Vec<_>>();
    assert_eq!(boards.len(), 1);
    assert_eq!(
        boards[0]["data"]["coordination"]["cwd"],
        "C:/Users/USER/Documents/dev"
    );
    assert_eq!(boards[0]["data"]["coordination"]["mode"], "shared-cwd");
    assert_eq!(
        boards[0]["data"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["label"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["Review shared board", "Beacon follow-up"]
    );
}

#[test]
fn coordination_prompt_prepare_wraps_same_cwd_agent_prompt() {
    let core = Core::new(
        test_init("coordination-prompt-prepare"),
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
                    agent_node_json("node_atlas", "Atlas", "D:/DEV/wheeljack", 0),
                    agent_node_json("node_beacon", "Beacon", "D:/DEV/wheeljack", 1)
                ],
                "edges": []
            }
        }
    });
    let patched: Value = serde_json::from_str(&core.call_json(&patch.to_string())).unwrap();
    assert_eq!(patched["ok"], true);

    let request = json!({
        "id": "prepare",
        "command": "coordination_prompt_prepare",
        "payload": {
            "canvasId": "canvas_test",
            "nodeId": "node_atlas",
            "workspacePath": "D:/DEV/wheeljack",
            "prompt": "Fix terminal cwd defaults",
            "taskId": "task-42"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["wrapped"], true);
    let prompt = response["payload"]["prompt"].as_str().unwrap();
    assert!(prompt.contains(COORDINATION_PROMPT_HEADER));
    assert!(prompt.contains("Your callsign is Atlas."));
    assert!(prompt.contains("wheeljack task id: task-42."));
    assert!(prompt.contains("Beacon: same cwd"));
    assert!(prompt.contains("Your agent event log:"));
    assert!(prompt.contains("Do not create, remove, switch, or reassign git worktrees"));
    assert!(prompt.contains("Fix terminal cwd defaults"));
    assert_eq!(
        response["payload"]["ensureRequest"]["cwd"],
        "D:/DEV/wheeljack"
    );
    assert_eq!(
        response["payload"]["ensureRequest"]["agentEvent"]["taskId"],
        "task-42"
    );
    assert_eq!(
        response["payload"]["ensureRequest"]["agentEvent"]["task"],
        "Fix terminal cwd defaults"
    );
    assert_eq!(
        response["payload"]["ensureRequest"]["callsigns"][0],
        "Atlas"
    );
    assert_eq!(
        response["payload"]["ensureRequest"]["agentEvent"]["handoff"],
        "Prompt delivered by wheeljack."
    );
}

#[test]
fn prompt_input_writes_match_reference_paste_then_enter() {
    let core = Core::new(test_init("prompt-input-writes"), Arc::new(NullEventSink)).expect("core");
    let direct = json!({
        "id": "writes",
        "command": "prompt_input_writes",
        "payload": {
            "adapterId": "codex-cli",
            "prompt": "line one\nline two"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&direct.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["strategy"], "paste_then_enter");
    assert_eq!(
        response["payload"]["writes"][0]["data"],
        "\x1b[200~line one\nline two\x1b[201~"
    );
    assert_eq!(response["payload"]["writes"][1]["data"], "\r");
    assert_eq!(
        response["payload"]["writes"][1]["delayBeforeMs"],
        PASTE_THEN_ENTER_SUBMIT_DELAY_MS
    );

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
                "nodes": [agent_node_json("node_atlas", "Atlas", "D:/DEV/wheeljack", 0)],
                "edges": []
            }
        }
    });
    let patched: Value = serde_json::from_str(&core.call_json(&patch.to_string())).unwrap();
    assert_eq!(patched["ok"], true);

    let from_node = json!({
        "id": "writes-node",
        "command": "prompt_input_writes",
        "payload": {
            "canvasId": "canvas_test",
            "nodeId": "node_atlas",
            "prompt": "hello claude"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&from_node.to_string())).unwrap();
    assert_eq!(
        response["payload"]["writes"][0]["data"],
        "\x1b[200~hello claude\x1b[201~"
    );
}

#[test]
fn pty_input_blocked_reason_matches_reference_claude_guards() {
    let core = Core::new(
        test_init("pty-input-blocked-reason"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let trust_prompt = json!({
        "id": "trust",
        "command": "pty_input_blocked_reason",
        "payload": {
            "adapterId": "claude-code",
            "terminalText": "Security guide\n> 1. Yes, I trust this folder\nEnter to confirm - Esc to cancel"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&trust_prompt.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["blocked"], true);
    assert!(response["payload"]["reason"]
        .as_str()
        .unwrap()
        .contains("folder trust confirmation"));

    let paste_draft = json!({
        "id": "paste",
        "command": "pty_input_blocked_reason",
        "payload": {
            "adapterId": "claude-code",
            "terminalText": "paste again to expand     ctrl+g to edit in Notepad"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&paste_draft.to_string())).unwrap();
    assert_eq!(response["payload"]["blocked"], true);
    assert!(response["payload"]["reason"]
        .as_str()
        .unwrap()
        .contains("pasted prompt draft"));

    let codex = json!({
        "id": "codex",
        "command": "pty_input_blocked_reason",
        "payload": {
            "adapterId": "codex-cli",
            "terminalText": "Security guide\n> 1. Yes, I trust this folder\nEnter to confirm"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&codex.to_string())).unwrap();
    assert_eq!(response["payload"]["blocked"], false);
    assert_eq!(response["payload"]["reason"], Value::Null);
}
