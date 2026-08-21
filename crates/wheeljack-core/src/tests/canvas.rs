use super::support::*;
use crate::*;

#[test]
fn project_open_persists_project_and_canvas() {
    let workspace = temp_dir("project-open-parent").join("workspace");
    fs::create_dir_all(&workspace).unwrap();
    let core = Core::new(test_init("project-open"), Arc::new(NullEventSink)).expect("core");
    let request = json!({
        "id": "open",
        "command": "project_open",
        "payload": { "path": workspace }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["name"], "workspace");
    assert_eq!(response["payload"]["pathExists"], true);
    assert!(!response["payload"]["path"]
        .as_str()
        .unwrap()
        .starts_with(r"\\?\"));

    let list: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"list","command":"project_list"}"#)).unwrap();
    assert_eq!(list["payload"].as_array().unwrap().len(), 1);
    assert_eq!(list["payload"][0]["pathExists"], true);
    let fetched: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "get",
                "command": "project_get",
                "payload": { "projectId": response["payload"]["id"] }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(fetched["payload"], response["payload"]);

    let second_response: Value =
        serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(second_response["ok"], true);
    let db = core.lock_db().unwrap();
    let canvas_count: i64 = db
        .query_row("SELECT COUNT(*) FROM canvases", [], |row| row.get(0))
        .unwrap();
    assert_eq!(canvas_count, 1);
    let theme_id: String = db
        .query_row("SELECT theme_id FROM canvases LIMIT 1", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(theme_id, "mono-dark");
}

#[test]
fn project_open_reports_git_status_and_project_update_persists() {
    let workspace = temp_dir("project-git-parent").join("workspace");
    fs::create_dir_all(&workspace).unwrap();
    run_git(&workspace, ["init"]).unwrap();
    run_git(
        &workspace,
        ["config", "user.email", "wheeljack@example.test"],
    )
    .unwrap();
    run_git(&workspace, ["config", "user.name", "wheeljack test"]).unwrap();
    fs::write(workspace.join("README.md"), "native git").unwrap();
    run_git(&workspace, ["add", "."]).unwrap();
    run_git(&workspace, ["commit", "-m", "init"]).unwrap();
    run_git(
        &workspace,
        [
            "remote",
            "add",
            "origin",
            "https://github.com/bildhaus/wheeljack.git",
        ],
    )
    .unwrap();
    fs::write(workspace.join("README.md"), "native git changed").unwrap();

    let core = Core::new(test_init("project-update"), Arc::new(NullEventSink)).expect("core");
    let open = json!({
        "id": "open",
        "command": "project_open",
        "payload": { "path": workspace }
    });
    let opened: Value = serde_json::from_str(&core.call_json(&open.to_string())).unwrap();
    assert_eq!(opened["ok"], true);
    assert_ne!(opened["payload"]["branch"], "none");
    assert_eq!(opened["payload"]["dirty"], true);
    assert_eq!(opened["payload"]["githubRemote"], true);

    let project = json!({
        "id": opened["payload"]["id"],
        "name": "Renamed",
        "path": opened["payload"]["path"],
        "icon": "code",
        "iconColor": "#4F8BC9",
        "agentAccess": "full",
        "branch": opened["payload"]["branch"],
        "dirty": opened["payload"]["dirty"]
    });
    let update = json!({
        "id": "update",
        "command": "project_update",
        "payload": { "project": project }
    });
    let updated: Value = serde_json::from_str(&core.call_json(&update.to_string())).unwrap();
    assert_eq!(updated["ok"], true);
    assert_eq!(updated["payload"]["name"], "Renamed");
    assert_eq!(updated["payload"]["icon"], "code");
    assert_eq!(updated["payload"]["iconColor"], "#4F8BC9");
    assert_eq!(updated["payload"]["agentAccess"], "full");

    let list: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"list","command":"project_list"}"#)).unwrap();
    assert_eq!(list["payload"][0]["name"], "Renamed");
    assert_eq!(list["payload"][0]["branch"], opened["payload"]["branch"]);
    assert_eq!(list["payload"][0]["dirty"], true);
    assert_eq!(list["payload"][0]["githubRemote"], true);
    assert_eq!(list["payload"][0]["icon"], "code");
    assert_eq!(list["payload"][0]["iconColor"], "#4F8BC9");
    assert_eq!(list["payload"][0]["agentAccess"], "full");
}

#[test]
fn terminal_pending_prompt_survives_core_restart() {
    let init = test_init("terminal-pending-prompt-restart");
    let core = Core::new(init.clone(), Arc::new(NullEventSink)).expect("core");
    let request = json!({
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
                        "id": "node_atlas",
                        "canvasId": "canvas_test",
                        "kind": "agent_terminal",
                        "title": "Atlas",
                        "x": 0.0,
                        "y": 0.0,
                        "width": 640.0,
                        "height": 320.0,
                        "zIndex": 1,
                        "data": {
                            "adapterId": "codex-cli",
                            "cwd": "D:/DEV/wheeljack",
                            "status": "running",
                            "sessionId": "session_atlas",
                            "pendingPrompt": "Fix terminal cwd defaults",
                            "pendingPromptId": "prompt_1",
                            "pendingPromptLabel": "Fix terminal cwd defaults",
                            "transcript": ["agent -> structured session attached session_atlas"]
                        },
                        "createdAt": "2026-07-29T00:00:00.000Z",
                        "updatedAt": "2026-07-29T00:00:00.000Z"
                    }
                ],
                "edges": []
            }
        }
    });
    let patched: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(patched["ok"], true);

    drop(core);

    let restarted = Core::new(init, Arc::new(NullEventSink)).expect("core");
    let canvas: Value = serde_json::from_str(
        &restarted.call_json(
            &json!({
                "id": "get",
                "command": "canvas_get",
                "payload": { "canvasId": "canvas_test" }
            })
            .to_string(),
        ),
    )
    .unwrap();
    let nodes = canvas["payload"]["nodes"].as_array().unwrap();
    assert_eq!(
        nodes[0]["data"]["pendingPrompt"],
        "Fix terminal cwd defaults"
    );

    let cleared: Value = serde_json::from_str(
        &restarted.call_json(
            &json!({
                "id": "clear-pending",
                "command": "terminal_pending_prompt_clear",
                "payload": {
                    "nodes": canvas["payload"]["nodes"].clone(),
                    "nodeId": "node_atlas",
                    "pendingPromptId": "prompt_1"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(cleared["ok"], true);
    assert_eq!(
        cleared["payload"]["clearedNode"]["data"]["prompt"],
        "Fix terminal cwd defaults"
    );
}

#[test]
fn project_archive_reopens_in_place_and_hard_delete_removes_only_the_registered_root() {
    let parent = temp_dir("project-remove-parent");
    let preserved = parent.join("preserved");
    let deleted = parent.join("deleted");
    fs::create_dir_all(&preserved).unwrap();
    fs::create_dir_all(&deleted).unwrap();
    fs::write(deleted.join("work.txt"), "delete me").unwrap();
    let core = Core::new(test_init("project-remove"), Arc::new(NullEventSink)).expect("core");

    let open = |path: &Path| -> Value {
        let response = core.call_json(
            &json!({ "id": "open", "command": "project_open", "payload": { "path": path } })
                .to_string(),
        );
        serde_json::from_str(&response).unwrap()
    };
    let preserved_project = open(&preserved);
    let deleted_project = open(&deleted);

    {
        let db = core.lock_db().unwrap();
        let canvas_id: String = db
            .query_row(
                "SELECT id FROM canvases WHERE project_id = ?1",
                params![preserved_project["payload"]["id"].as_str().unwrap()],
                |row| row.get(0),
            )
            .unwrap();
        db.execute(
            "INSERT INTO nodes (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
             VALUES ('node-active', ?1, 'shell_terminal', 'Shell', 0, 0, 1, 1, 0, '{}', 'now', 'now')",
            params![canvas_id],
        ).unwrap();
        db.execute(
            "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, created_at, updated_at)
             VALUES ('session-active', 'node-active', 'shell', '{}', ?1, 'running', 'now', 'now')",
            params![preserved.to_string_lossy().to_string()],
        ).unwrap();
        db.execute(
            "INSERT INTO session_chunks (session_id, seq, stream, data, created_at)
             VALUES ('session-active', 1, 'stdout', 'preserved transcript', 'now')",
            [],
        )
        .unwrap();
    }
    let blocked: Value = serde_json::from_str(&core.call_json(&json!({
        "id": "remove-active",
        "command": "project_remove",
        "payload": { "projectId": preserved_project["payload"]["id"], "deleteFromDisk": false }
    }).to_string())).unwrap();
    assert_eq!(blocked["ok"], false);
    assert!(preserved.exists());
    core.lock_db()
        .unwrap()
        .execute(
            "UPDATE sessions SET status = 'exited' WHERE id = 'session-active'",
            [],
        )
        .unwrap();

    let remove_preserved: Value = serde_json::from_str(&core.call_json(&json!({
        "id": "remove-preserved",
        "command": "project_remove",
        "payload": { "projectId": preserved_project["payload"]["id"], "deleteFromDisk": false }
    }).to_string())).unwrap();
    assert_eq!(remove_preserved["ok"], true);
    assert_eq!(remove_preserved["payload"]["archived"], true);
    assert!(preserved.exists());
    let archived_id = preserved_project["payload"]["id"].as_str().unwrap();
    {
        let db = core.lock_db().unwrap();
        let archived_at: Option<String> = db
            .query_row(
                "SELECT archived_at FROM projects WHERE id = ?1",
                params![archived_id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(archived_at.is_some());
        let counts: (i64, i64, i64) = db
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM nodes WHERE id = 'node-active'),
                   (SELECT COUNT(*) FROM sessions WHERE id = 'session-active'),
                   (SELECT COUNT(*) FROM session_chunks WHERE session_id = 'session-active')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(counts, (1, 1, 1));
    }
    let archived_get: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "get-archived",
                "command": "project_get",
                "payload": { "projectId": archived_id }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(archived_get["payload"]["pathExists"], true);

    let reopened = open(&preserved);
    assert_eq!(
        reopened["payload"]["id"],
        preserved_project["payload"]["id"]
    );
    assert_eq!(reopened["payload"]["pathExists"], true);
    {
        let db = core.lock_db().unwrap();
        let archived_at: Option<String> = db
            .query_row(
                "SELECT archived_at FROM projects WHERE id = ?1",
                params![archived_id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(archived_at.is_none());
        let canvas_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM canvases WHERE project_id = ?1",
                params![archived_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(canvas_count, 1);
    }
    let rearchive: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "rearchive",
                "command": "project_remove",
                "payload": { "projectId": archived_id, "deleteFromDisk": false }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(rearchive["payload"]["archived"], true);

    let remove_deleted: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "remove-deleted",
                "command": "project_remove",
                "payload": { "projectId": deleted_project["payload"]["id"], "deleteFromDisk": true }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(remove_deleted["ok"], true);
    assert_eq!(remove_deleted["payload"]["archived"], false);
    assert!(!deleted.exists());
    assert!(parent.exists());
    let deleted_count: i64 = core
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE id = ?1",
            params![deleted_project["payload"]["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(deleted_count, 0);

    let list: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"list","command":"project_list"}"#)).unwrap();
    assert_eq!(list["payload"].as_array().unwrap().len(), 0);
}

#[test]
fn project_relink_recovers_a_missing_folder_without_losing_state() {
    let parent = temp_dir("project-relink-parent");
    let old_path = parent.join("old-workspace");
    let new_path = parent.join("moved-workspace");
    fs::create_dir_all(&old_path).unwrap();
    let core = Core::new(test_init("project-relink"), Arc::new(NullEventSink)).expect("core");
    let opened: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "open",
                "command": "project_open",
                "payload": { "path": old_path }
            })
            .to_string(),
        ),
    )
    .unwrap();
    let project_id = opened["payload"]["id"].as_str().unwrap();
    let canvas_id: String = {
        let db = core.lock_db().unwrap();
        let canvas_id = db
            .query_row(
                "SELECT id FROM canvases WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .unwrap();
        db.execute(
            "INSERT INTO nodes
             (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
             VALUES ('node-relink', ?1, 'markdown_note', 'Keep me', 0, 0, 1, 1, 0, '{}', 'now', 'now')",
            params![canvas_id],
        )
        .unwrap();
        canvas_id
    };

    fs::rename(&old_path, &new_path).unwrap();
    let missing: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"list","command":"project_list"}"#)).unwrap();
    assert_eq!(missing["payload"][0]["pathExists"], false);

    let relinked: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "relink",
                "command": "project_relink",
                "payload": { "projectId": project_id, "path": new_path }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(relinked["ok"], true);
    assert_eq!(relinked["payload"]["id"], project_id);
    assert_eq!(relinked["payload"]["name"], "old-workspace");
    assert_eq!(relinked["payload"]["pathExists"], true);
    assert!(paths_equivalent(
        &PathBuf::from(relinked["payload"]["path"].as_str().unwrap()),
        &new_path
    ));
    let db = core.lock_db().unwrap();
    let persisted: (String, i64) = db
        .query_row(
            "SELECT c.id, COUNT(n.id)
             FROM canvases c
             LEFT JOIN nodes n ON n.canvas_id = c.id
             WHERE c.project_id = ?1
             GROUP BY c.id",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(persisted, (canvas_id, 1));
}

#[test]
fn canvas_apply_patch_and_get_roundtrip() {
    let core = Core::new(test_init("canvas"), Arc::new(NullEventSink)).expect("core");
    let request = json!({
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
                "camera": { "x": 12.0, "y": 34.0, "scale": 1.5 },
                "selectedNodeIds": ["node_a", "node_closed", "missing_node"],
                "focusedNodeId": "node_closed",
                "nodes": [
                    {
                        "id": "node_a",
                        "canvasId": "canvas_test",
                        "kind": "markdown_note",
                        "title": "Note",
                        "x": 1.0,
                        "y": 2.0,
                        "width": 300.0,
                        "height": 180.0,
                        "zIndex": 7,
                        "colSpan": 2,
                        "rowSpan": 3,
                        "singlePaneWidth": 720.0,
                        "singlePaneHeight": 480.0,
                        "data": { "text": "hello canvas" },
                        "createdAt": "now",
                        "updatedAt": "now"
                    },
                    {
                        "id": "node_closed",
                        "canvasId": "canvas_test",
                        "kind": "markdown_note",
                        "title": "Closed",
                        "x": 4.0,
                        "y": 5.0,
                        "width": 0.0,
                        "height": 180.0,
                        "zIndex": 8,
                        "data": { "text": "closed" },
                        "createdAt": "now",
                        "updatedAt": "now"
                    }
                ],
                "edges": [{
                    "id": "edge_closed",
                    "sourceNodeId": "node_a",
                    "targetNodeId": "node_closed",
                    "kind": "dependency"
                }]
            }
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["themeId"], "mono-dark");
    assert_eq!(
        response["payload"]["nodes"][0]["data"]["text"],
        "hello canvas"
    );

    {
        let db = core.lock_db().unwrap();
        let persisted: String = db
            .query_row(
                "SELECT data_json FROM nodes WHERE id = 'node_a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let mut data: Value = serde_json::from_str(&persisted).unwrap();
        let layout = data
            .as_object_mut()
            .unwrap()
            .remove("__wheeljackLayout")
            .expect("current layout key");
        data.as_object_mut()
            .unwrap()
            .insert("__txtlLayout".to_string(), layout);
        db.execute(
            "UPDATE nodes SET data_json = ?1 WHERE id = 'node_a'",
            params![data.to_string()],
        )
        .unwrap();
    }

    let get_request = json!({
        "id": "get",
        "command": "canvas_get",
        "payload": { "canvasId": "canvas_test" }
    });
    let response: Value = serde_json::from_str(&core.call_json(&get_request.to_string())).unwrap();
    assert_eq!(response["payload"]["camera"]["scale"], 1.5);
    assert_eq!(response["payload"]["selectedNodeIds"], json!(["node_a"]));
    assert_eq!(response["payload"]["focusedNodeId"], Value::Null);
    assert_eq!(response["payload"]["nodes"].as_array().unwrap().len(), 1);
    assert_eq!(response["payload"]["edges"], json!([]));
    assert_eq!(response["payload"]["nodes"][0]["colSpan"], 2.0);
    assert_eq!(response["payload"]["nodes"][0]["rowSpan"], 3.0);
    assert_eq!(response["payload"]["nodes"][0]["singlePaneWidth"], 720.0);
    assert_eq!(response["payload"]["nodes"][0]["singlePaneHeight"], 480.0);
    assert!(response["payload"]["nodes"][0]["data"]
        .get("__txtlLayout")
        .is_none());

    let patch_theme = json!({
        "id": "patch-theme",
        "command": "canvas_apply_patch",
        "payload": {
            "canvasId": "canvas_test",
            "patch": { "themeId": "mono-light" }
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&patch_theme.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    let settings: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"patch-settings","command":"settings_export"}"#),
    )
    .unwrap();
    assert_eq!(settings["payload"]["theme"], "mono-light");
    assert_eq!(settings["payload"]["workspace"]["themeId"], "mono-light");

    let set_theme = json!({
        "id": "theme",
        "command": "canvas_set_theme",
        "payload": { "canvasId": "canvas_test", "themeId": "mono-dark" }
    });
    let response: Value = serde_json::from_str(&core.call_json(&set_theme.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    let settings: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"settings","command":"settings_export"}"#))
            .unwrap();
    assert_eq!(settings["payload"]["theme"], "mono-dark");
    assert_eq!(settings["payload"]["workspace"]["themeId"], "mono-dark");

    let duplicate_request = json!({
        "id": "duplicate",
        "command": "canvas_duplicate_node",
        "payload": {
            "canvasId": "canvas_test",
            "nodeId": "node_a"
        }
    });
    let duplicated: Value =
        serde_json::from_str(&core.call_json(&duplicate_request.to_string())).unwrap();
    let duplicated_id = duplicated["payload"]["duplicate"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let response: Value = serde_json::from_str(&core.call_json(&get_request.to_string())).unwrap();
    assert_eq!(
        response["payload"]["selectedNodeIds"],
        json!([duplicated_id.clone()])
    );
    assert_eq!(response["payload"]["focusedNodeId"], duplicated_id);

    let delete_request = json!({
        "id": "delete-duplicate",
        "command": "canvas_delete_node",
        "payload": {
            "canvasId": "canvas_test",
            "nodeId": duplicated_id.clone(),
            "selectedNodeIds": [duplicated_id.clone()],
            "focusedNodeId": duplicated_id
        }
    });
    let deleted: Value =
        serde_json::from_str(&core.call_json(&delete_request.to_string())).unwrap();
    assert_eq!(deleted["payload"]["focusedNodeId"], Value::Null);
    let response: Value = serde_json::from_str(&core.call_json(&get_request.to_string())).unwrap();
    assert_eq!(response["payload"]["selectedNodeIds"], json!([]));
    assert_eq!(response["payload"]["focusedNodeId"], Value::Null);

    let request = json!({
        "id": "patch-empty",
        "command": "canvas_apply_patch",
        "payload": {
            "canvasId": "canvas_test",
            "patch": {
                "nodes": [],
                "edges": []
            }
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["payload"]["selectedNodeIds"], json!([]));
    assert_eq!(response["payload"]["focusedNodeId"], Value::Null);
}

#[test]
fn canvas_upsert_node_preserves_omitted_and_unknown_nodes() {
    let core = Core::new(test_init("canvas-upsert-node"), Arc::new(NullEventSink)).expect("core");
    let seed = json!({
        "id": "seed",
        "command": "canvas_apply_patch",
        "payload": {
            "canvasId": "canvas_upsert",
            "patch": {
                "project": {
                    "id": "project_upsert",
                    "name": "Upsert",
                    "path": ".",
                    "branch": "main",
                    "dirty": false
                },
                "nodes": [
                    {
                        "id": "node_terminal",
                        "canvasId": "canvas_upsert",
                        "kind": "shell_terminal",
                        "title": "Shell",
                        "x": 10.0,
                        "y": 20.0,
                        "width": 640.0,
                        "height": 360.0,
                        "zIndex": 1,
                        "data": { "status": "idle", "transcript": [] },
                        "createdAt": "created-original",
                        "updatedAt": "updated-original"
                    },
                    {
                        "id": "node_future",
                        "canvasId": "canvas_upsert",
                        "kind": "future_pane_kind",
                        "title": "Future pane",
                        "x": 700.0,
                        "y": 20.0,
                        "width": 320.0,
                        "height": 360.0,
                        "zIndex": 2,
                        "data": { "unknownContract": { "keep": true } },
                        "createdAt": "future-created",
                        "updatedAt": "future-updated"
                    }
                ],
                "edges": [{
                    "id": "edge_keep",
                    "sourceNodeId": "node_terminal",
                    "targetNodeId": "node_future",
                    "kind": "dependency"
                }]
            }
        }
    });
    let seeded: Value = serde_json::from_str(&core.call_json(&seed.to_string())).unwrap();
    assert_eq!(seeded["ok"], true);

    let upsert = json!({
        "id": "upsert",
        "command": "canvas_upsert_node",
        "payload": {
            "canvasId": "canvas_upsert",
            "node": {
                "id": "node_terminal",
                "canvasId": "canvas_upsert",
                "kind": "shell_terminal",
                "title": "Shell renamed",
                "x": 30.0,
                "y": 40.0,
                "width": 800.0,
                "height": 420.0,
                "zIndex": 3,
                "data": { "status": "running", "transcript": [] },
                "createdAt": "must-not-replace-created-at",
                "updatedAt": "updated-upsert"
            }
        }
    });
    let updated: Value = serde_json::from_str(&core.call_json(&upsert.to_string())).unwrap();
    assert_eq!(updated["ok"], true);
    assert_eq!(updated["payload"]["title"], "Shell renamed");
    assert_eq!(updated["payload"]["createdAt"], "created-original");

    let stored: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"get","command":"canvas_get","payload":{"canvasId":"canvas_upsert"}}"#,
    ))
    .unwrap();
    assert_eq!(stored["payload"]["nodes"].as_array().unwrap().len(), 2);
    let future = stored["payload"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == "node_future")
        .unwrap();
    assert_eq!(future["kind"], "future_pane_kind");
    assert_eq!(future["x"], 700.0);
    assert_eq!(future["data"]["unknownContract"]["keep"], true);
    assert_eq!(stored["payload"]["edges"][0]["id"], "edge_keep");

    let create_other = json!({
        "id": "create-other",
        "command": "canvas_apply_patch",
        "payload": {
            "canvasId": "canvas_other",
            "patch": {
                "project": {
                    "id": "project_upsert",
                    "name": "Upsert",
                    "path": ".",
                    "branch": "main",
                    "dirty": false
                },
                "nodes": []
            }
        }
    });
    assert_eq!(
        serde_json::from_str::<Value>(&core.call_json(&create_other.to_string())).unwrap()["ok"],
        true
    );
    let mut hijack = upsert;
    hijack["id"] = json!("hijack");
    hijack["payload"]["canvasId"] = json!("canvas_other");
    hijack["payload"]["node"]["canvasId"] = json!("canvas_other");
    let rejected: Value = serde_json::from_str(&core.call_json(&hijack.to_string())).unwrap();
    assert_eq!(rejected["ok"], false);

    let original: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"original","command":"canvas_get","payload":{"canvasId":"canvas_upsert"}}"#,
    ))
    .unwrap();
    assert!(original["payload"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|node| node["id"] == "node_terminal"));
}

#[test]
fn canvas_upsert_node_retries_a_transient_write_lock() {
    let core = Core::new(
        test_init("canvas-upsert-busy-retry"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let seed = json!({
        "id": "seed",
        "command": "canvas_apply_patch",
        "payload": {
            "canvasId": "canvas_retry",
            "patch": {
                "project": {
                    "id": "project_retry",
                    "name": "Retry",
                    "path": ".",
                    "branch": "main",
                    "dirty": false
                },
                "nodes": [{
                    "id": "node_retry",
                    "canvasId": "canvas_retry",
                    "kind": "agent_terminal",
                    "title": "Atlas",
                    "x": 0.0,
                    "y": 0.0,
                    "width": 640.0,
                    "height": 360.0,
                    "zIndex": 1,
                    "data": { "status": "running" },
                    "createdAt": "created",
                    "updatedAt": "updated"
                }]
            }
        }
    });
    assert_eq!(
        serde_json::from_str::<Value>(&core.call_json(&seed.to_string())).unwrap()["ok"],
        true
    );
    core.lock_db()
        .unwrap()
        .busy_timeout(Duration::from_millis(1))
        .unwrap();

    let db_path = core.paths.db_path();
    let (locked_tx, locked_rx) = std::sync::mpsc::channel();
    let locker = thread::spawn(move || {
        let locker = open_app_connection(&db_path).unwrap();
        let tx = Transaction::new_unchecked(&locker, TransactionBehavior::Immediate).unwrap();
        locked_tx.send(()).unwrap();
        thread::sleep(Duration::from_millis(120));
        tx.commit().unwrap();
    });
    locked_rx.recv().unwrap();

    let upsert = json!({
        "id": "upsert",
        "command": "canvas_upsert_node",
        "payload": {
            "canvasId": "canvas_retry",
            "node": {
                "id": "node_retry",
                "canvasId": "canvas_retry",
                "kind": "agent_terminal",
                "title": "Atlas",
                "x": 0.0,
                "y": 0.0,
                "width": 640.0,
                "height": 360.0,
                "zIndex": 1,
                "data": { "status": "completed", "chatPreview": "Done" },
                "createdAt": "created",
                "updatedAt": "updated-again"
            }
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&upsert.to_string())).unwrap();
    locker.join().unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["data"]["status"], "completed");
}

#[test]
fn canvas_layout_roundtrips_separately_from_legacy_geometry() {
    let core = Core::new(test_init("canvas-layout"), Arc::new(NullEventSink)).expect("core");
    let seed = json!({
        "id": "seed",
        "command": "canvas_apply_patch",
        "payload": {
            "canvasId": "canvas_layout",
            "patch": {
                "project": {
                    "id": "project_layout",
                    "name": "Layout",
                    "path": ".",
                    "branch": "main",
                    "dirty": false
                },
                "nodes": [{
                    "id": "pane_one",
                    "canvasId": "canvas_layout",
                    "kind": "shell_terminal",
                    "title": "One",
                    "x": 123.0,
                    "y": 456.0,
                    "width": 789.0,
                    "height": 321.0,
                    "zIndex": 1,
                    "data": { "transcript": [] },
                    "createdAt": "now",
                    "updatedAt": "now"
                }]
            }
        }
    });
    assert_eq!(
        serde_json::from_str::<Value>(&core.call_json(&seed.to_string())).unwrap()["ok"],
        true
    );

    let missing: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"missing","command":"canvas_layout_get","payload":{"canvasId":"canvas_layout"}}"#,
    ))
    .unwrap();
    assert_eq!(missing["payload"], Value::Null);

    let save = json!({
        "id": "save",
        "command": "canvas_layout_save",
        "payload": {
            "canvasId": "canvas_layout",
            "layout": {
                "version": 1,
                "mode": "auto",
                "root": {
                    "type": "split",
                    "axis": "columns",
                    "ratio": 0.6,
                    "first": { "type": "leaf", "paneId": "pane_one" },
                    "second": { "type": "leaf", "paneId": "future_unknown_pane" }
                }
            }
        }
    });
    let saved: Value = serde_json::from_str(&core.call_json(&save.to_string())).unwrap();
    assert_eq!(saved["ok"], true);
    assert_eq!(saved["payload"]["surface"], "windows-multiplexer-v1");
    assert_eq!(saved["payload"]["mode"], "auto");
    assert_eq!(saved["payload"]["root"]["axis"], "columns");
    assert_eq!(
        saved["payload"]["root"]["second"]["paneId"],
        "future_unknown_pane"
    );

    let invalid = json!({
        "id": "invalid",
        "command": "canvas_layout_save",
        "payload": {
            "canvasId": "canvas_layout",
            "layout": {
                "version": 1,
                "root": {
                    "type": "split",
                    "axis": "rows",
                    "ratio": 1.0,
                    "first": { "type": "leaf", "paneId": "pane_one" },
                    "second": { "type": "leaf", "paneId": "pane_two" }
                }
            }
        }
    });
    let rejected: Value = serde_json::from_str(&core.call_json(&invalid.to_string())).unwrap();
    assert_eq!(rejected["ok"], false);

    let loaded: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"loaded","command":"canvas_layout_get","payload":{"canvasId":"canvas_layout"}}"#,
    ))
    .unwrap();
    assert_eq!(loaded["payload"]["root"]["axis"], "columns");
    assert_eq!(loaded["payload"]["mode"], "auto");

    let canvas: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"canvas","command":"canvas_get","payload":{"canvasId":"canvas_layout"}}"#,
    ))
    .unwrap();
    assert_eq!(canvas["payload"]["nodes"][0]["x"], 123.0);
    assert_eq!(canvas["payload"]["nodes"][0]["y"], 456.0);
    assert_eq!(canvas["payload"]["nodes"][0]["width"], 789.0);
    assert_eq!(canvas["payload"]["nodes"][0]["height"], 321.0);
}

#[test]
fn canvas_apply_patch_defaults_new_canvas_to_mono_dark() {
    let core = Core::new(test_init("canvas-default-theme"), Arc::new(NullEventSink)).expect("core");
    let request = json!({
        "id": "patch",
        "command": "canvas_apply_patch",
        "payload": {
            "canvasId": "canvas_default_theme",
            "patch": {
                "project": {
                    "id": "project_default_theme",
                    "name": "Default theme",
                    "path": ".",
                    "branch": "main",
                    "dirty": false
                },
                "camera": { "x": 90.0, "y": 76.0, "scale": 0.86 },
                "nodes": [],
                "edges": []
            }
        }
    });

    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true, "{response}");
    assert_eq!(response["payload"]["themeId"], "mono-dark");
}

#[test]
fn canvas_list_project_returns_all_project_canvases() {
    let core = Core::new(test_init("canvas-list-project"), Arc::new(NullEventSink)).expect("core");
    let project = json!({
        "id": "project_multi",
        "name": "Multi",
        "path": ".",
        "branch": "main",
        "dirty": false
    });

    for canvas_id in ["canvas_beta", "canvas_alpha"] {
        let request = json!({
            "id": format!("patch-{canvas_id}"),
            "command": "canvas_apply_patch",
            "payload": {
                "canvasId": canvas_id,
                "patch": {
                    "project": project,
                    "themeId": "mono-dark",
                    "camera": { "x": 0.0, "y": 0.0, "scale": 1.0 },
                    "nodes": [],
                    "edges": []
                }
            }
        });
        let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
        assert_eq!(response["ok"], true);
    }

    let by_canvas = json!({
        "id": "list-by-canvas",
        "command": "canvas_list_project",
        "payload": { "canvasId": "canvas_alpha" }
    });
    let response: Value = serde_json::from_str(&core.call_json(&by_canvas.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    let mut ids = response["payload"]
        .as_array()
        .unwrap()
        .iter()
        .map(|canvas| canvas["id"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    ids.sort();
    assert_eq!(ids, vec!["canvas_alpha", "canvas_beta"]);
    assert_eq!(response["payload"][0]["gridX"], 0);
    assert_eq!(response["payload"][0]["gridY"], 0);

    let by_project = json!({
        "id": "list-by-project",
        "command": "canvas_list_project",
        "payload": { "projectId": "project_multi" }
    });
    let response: Value = serde_json::from_str(&core.call_json(&by_project.to_string())).unwrap();
    assert_eq!(response["payload"].as_array().unwrap().len(), 2);
}

#[test]
fn canvas_reset_project_recreates_blank_main_workspace() {
    let core = Core::new(test_init("canvas-reset-project"), Arc::new(NullEventSink)).expect("core");
    let project = json!({
        "id": "project_reset",
        "name": "Reset",
        "path": ".",
        "branch": "main",
        "dirty": false
    });
    for canvas_id in ["canvas_one", "canvas_two"] {
        let request = json!({
            "id": format!("patch-{canvas_id}"),
            "command": "canvas_apply_patch",
            "payload": {
                "canvasId": canvas_id,
                "patch": {
                    "project": project,
                    "themeId": "mono-light",
                    "camera": { "x": 12.0, "y": 34.0, "scale": 1.5 },
                    "nodes": [{
                        "id": format!("node-{canvas_id}"),
                        "canvasId": canvas_id,
                        "kind": "markdown_note",
                        "title": "Note",
                        "x": 0.0,
                        "y": 0.0,
                        "width": 300.0,
                        "height": 180.0,
                        "zIndex": 1,
                        "colSpan": 1,
                        "rowSpan": 1,
                        "data": { "markdown": "saved" },
                        "createdAt": "now",
                        "updatedAt": "now"
                    }],
                    "edges": []
                }
            }
        });
        let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
        assert_eq!(response["ok"], true);
    }

    let reset = json!({
        "id": "reset",
        "command": "canvas_reset_project",
        "payload": { "projectId": "project_reset" }
    });
    let response: Value = serde_json::from_str(&core.call_json(&reset.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["name"], "Main canvas");
    assert_eq!(response["payload"]["themeId"], "mono-dark");
    assert_eq!(response["payload"]["nodes"], json!([]));
    assert_eq!(response["payload"]["camera"]["scale"], 0.86);

    let list = json!({
        "id": "list",
        "command": "canvas_list_project",
        "payload": { "projectId": "project_reset" }
    });
    let response: Value = serde_json::from_str(&core.call_json(&list.to_string())).unwrap();
    assert_eq!(response["payload"].as_array().unwrap().len(), 1);
}

#[test]
fn canvas_reorder_project_moves_active_canvas_in_project_order() {
    let core =
        Core::new(test_init("canvas-reorder-project"), Arc::new(NullEventSink)).expect("core");
    let project = json!({
        "id": "project_reorder",
        "name": "Reorder",
        "path": ".",
        "branch": "main",
        "dirty": false
    });

    for canvas_id in ["canvas_alpha", "canvas_beta", "canvas_gamma"] {
        let request = json!({
            "id": format!("patch-{canvas_id}"),
            "command": "canvas_apply_patch",
            "payload": {
                "canvasId": canvas_id,
                "patch": {
                    "project": project,
                    "themeId": "mono-dark",
                    "camera": { "x": 0.0, "y": 0.0, "scale": 1.0 },
                    "nodes": [],
                    "edges": []
                }
            }
        });
        let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
        assert_eq!(response["ok"], true);
    }

    let reorder = json!({
        "id": "move",
        "command": "canvas_reorder_project",
        "payload": { "canvasId": "canvas_beta", "direction": -1 }
    });
    let response: Value = serde_json::from_str(&core.call_json(&reorder.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["moved"], true);
    let ids = response["payload"]["canvases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|canvas| canvas["id"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(ids, vec!["canvas_beta", "canvas_alpha", "canvas_gamma"]);
    assert_eq!(response["payload"]["gridX"], 0);
    assert_eq!(response["payload"]["gridY"], 0);
    assert_eq!(response["payload"]["swappedCanvasId"], "canvas_alpha");

    let blocked = json!({
        "id": "move-again",
        "command": "canvas_reorder_project",
        "payload": { "canvasId": "canvas_beta", "direction": -1 }
    });
    let response: Value = serde_json::from_str(&core.call_json(&blocked.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["moved"], true);
    assert_eq!(response["payload"]["gridX"], -1);
    assert_eq!(response["payload"]["swappedCanvasId"], Value::Null);
}

#[test]
fn canvas_create_rename_delete_roundtrip() {
    let workspace = temp_dir("canvas-workspaces").join("workspace");
    fs::create_dir_all(&workspace).unwrap();
    let core = Core::new(
        test_init("canvas-workspace-commands"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let open = json!({
        "id": "open",
        "command": "project_open",
        "payload": { "path": workspace }
    });
    let opened: Value = serde_json::from_str(&core.call_json(&open.to_string())).unwrap();
    assert_eq!(opened["ok"], true);
    let project_id = opened["payload"]["id"].as_str().unwrap();

    let create_default = json!({
        "id": "create-default",
        "command": "canvas_create_project",
        "payload": { "projectId": project_id, "name": "" }
    });
    let default_created: Value =
        serde_json::from_str(&core.call_json(&create_default.to_string())).unwrap();
    assert_eq!(default_created["ok"], true);
    assert_eq!(default_created["payload"]["name"], "Canvas B");
    let default_canvas_id = default_created["payload"]["id"].as_str().unwrap();

    let create = json!({
        "id": "create",
        "command": "canvas_create_project",
        "payload": { "projectId": project_id, "name": "Agents" }
    });
    let created: Value = serde_json::from_str(&core.call_json(&create.to_string())).unwrap();
    assert_eq!(created["ok"], true);
    assert_eq!(created["payload"]["name"], "Agents");
    assert_eq!(created["payload"]["gridY"], 0);
    let canvas_id = created["payload"]["id"].as_str().unwrap();

    let rename = json!({
        "id": "rename",
        "command": "canvas_rename",
        "payload": { "canvasId": canvas_id, "name": "Backend agents" }
    });
    let renamed: Value = serde_json::from_str(&core.call_json(&rename.to_string())).unwrap();
    assert_eq!(renamed["ok"], true);
    assert_eq!(renamed["payload"]["name"], "Backend agents");

    let delete = json!({
        "id": "delete",
        "command": "canvas_delete",
        "payload": { "canvasId": canvas_id }
    });
    let deleted: Value = serde_json::from_str(&core.call_json(&delete.to_string())).unwrap();
    assert_eq!(deleted["ok"], true);
    assert_eq!(deleted["payload"], true);

    let list = json!({
        "id": "list",
        "command": "canvas_list_project",
        "payload": { "projectId": project_id }
    });
    let listed: Value = serde_json::from_str(&core.call_json(&list.to_string())).unwrap();
    let ids = listed["payload"]
        .as_array()
        .unwrap()
        .iter()
        .map(|canvas| canvas["id"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert!(!ids.contains(&canvas_id));
    assert!(ids.contains(&default_canvas_id));

    let delete_default = json!({
        "id": "delete-default",
        "command": "canvas_delete",
        "payload": { "canvasId": default_canvas_id }
    });
    let deleted_default: Value =
        serde_json::from_str(&core.call_json(&delete_default.to_string())).unwrap();
    assert_eq!(deleted_default["ok"], true);
    assert_eq!(deleted_default["payload"], true);

    let list_remaining = json!({
        "id": "list-remaining",
        "command": "canvas_list_project",
        "payload": { "projectId": project_id }
    });
    let remaining: Value =
        serde_json::from_str(&core.call_json(&list_remaining.to_string())).unwrap();
    let remaining_ids = remaining["payload"].as_array().unwrap();
    assert_eq!(remaining_ids.len(), 1);
    let last_canvas_id = remaining_ids[0]["id"].as_str().unwrap();
    let delete_last = json!({
        "id": "delete-last",
        "command": "canvas_delete",
        "payload": { "canvasId": last_canvas_id }
    });
    let blocked: Value = serde_json::from_str(&core.call_json(&delete_last.to_string())).unwrap();
    assert_eq!(blocked["ok"], false);
    assert!(blocked["error"]["message"]
        .as_str()
        .unwrap()
        .contains("keep at least one canvas"));
}

#[test]
fn canvas_apply_patch_sanitizes_terminal_transcripts_for_persistence() {
    let core = Core::new(
        test_init("canvas-terminal-sanitize"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let mut transcript = vec![
        "pty -> old".to_string(),
        "raw terminal output".to_string(),
        "user -> keep early".to_string(),
        [
            "txtl workspace coordination:",
            "- Your callsign is Atlas.",
            "",
            "User instruction:",
            "hidden coordination prompt",
        ]
        .join("\n"),
    ];
    for index in 0..25 {
        transcript.push(format!("pty -> keep {index}"));
    }
    transcript.push("orchestrator -> final".to_string());

    let request = json!({
        "id": "patch",
        "command": "canvas_apply_patch",
        "payload": {
            "canvasId": "canvas_terminal",
            "patch": {
                "project": {
                    "id": "project_terminal",
                    "name": "Manual",
                    "path": ".",
                    "branch": "main",
                    "dirty": false
                },
                "nodes": [{
                    "id": "node_terminal",
                    "canvasId": "canvas_terminal",
                    "kind": "shell_terminal",
                    "title": "Shell",
                    "x": 1.0,
                    "y": 2.0,
                    "width": 300.0,
                    "height": 180.0,
                    "zIndex": 7,
                    "data": { "transcript": transcript },
                    "createdAt": "now",
                    "updatedAt": "now"
                }, {
                    "id": "node_note",
                    "canvasId": "canvas_terminal",
                    "kind": "markdown_note",
                    "title": "Note",
                    "x": 2.0,
                    "y": 3.0,
                    "width": 300.0,
                    "height": 180.0,
                    "zIndex": 8,
                    "data": { "transcript": ["raw terminal output"] },
                    "createdAt": "now",
                    "updatedAt": "now"
                }],
                "edges": []
            }
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);

    let get_request = json!({
        "id": "get",
        "command": "canvas_get",
        "payload": { "canvasId": "canvas_terminal" }
    });
    let response: Value = serde_json::from_str(&core.call_json(&get_request.to_string())).unwrap();
    let nodes = response["payload"]["nodes"].as_array().unwrap();
    let terminal_transcript = nodes[0]["data"]["transcript"].as_array().unwrap();
    assert_eq!(terminal_transcript.len(), MAX_PERSISTED_TRANSCRIPT_CHUNKS);
    assert_eq!(terminal_transcript[0], "pty -> keep 2");
    assert_eq!(terminal_transcript[23], "orchestrator -> final");
    assert!(!terminal_transcript
        .iter()
        .any(|chunk| chunk.as_str() == Some("raw terminal output")));
    assert!(!terminal_transcript.iter().any(|chunk| chunk
        .as_str()
        .is_some_and(contains_coordination_prompt_text)));
    assert_eq!(nodes[1]["data"]["transcript"][0], "raw terminal output");
}

#[test]
fn canvas_apply_patch_normalizes_known_non_terminal_node_data() {
    let core = Core::new(
        test_init("canvas-node-data-sanitize"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let request = json!({
        "id": "patch",
        "command": "canvas_apply_patch",
        "payload": {
            "canvasId": "canvas_node_data",
            "patch": {
                "project": {
                    "id": "project_node_data",
                    "name": "Manual",
                    "path": ".",
                    "branch": "main",
                    "dirty": false
                },
                "nodes": [{
                    "id": "note",
                    "canvasId": "wrong_canvas",
                    "kind": "markdown_note",
                    "title": "Note",
                    "x": 1.0,
                    "y": 2.0,
                    "width": 300.0,
                    "height": 180.0,
                    "zIndex": 1,
                    "data": { "markdown": "# Hi", "mode": "side-by-side", "extra": true },
                    "createdAt": "now",
                    "updatedAt": "now"
                }, {
                    "id": "browser",
                    "canvasId": "canvas_node_data",
                    "kind": "browser_preview",
                    "title": "Browser",
                    "x": 1.0,
                    "y": 2.0,
                    "width": 300.0,
                    "height": 180.0,
                    "zIndex": 2,
                    "data": { "url": "localhost:5173", "loadState": "stalled" },
                    "createdAt": "now",
                    "updatedAt": "now"
                }, {
                    "id": "tasks",
                    "canvasId": "canvas_node_data",
                    "kind": "task_checklist",
                    "title": "Tasks",
                    "x": 1.0,
                    "y": 2.0,
                    "width": 300.0,
                    "height": 180.0,
                    "zIndex": 3,
                    "data": {
                        "items": [
                            {
                                "id": "task_1",
                                "label": "Review",
                                "done": "yes",
                                "status": "active",
                                "ownerCallsign": "Atlas",
                                "updatedAt": "later",
                                "files": ["src/main.rs", 12]
                            },
                            { "id": "", "label": "" }
                        ],
                        "coordination": { "cwd": "D:/DEV/wheeljack" }
                    },
                    "createdAt": "now",
                    "updatedAt": "now"
                }, {
                    "id": "shape",
                    "canvasId": "canvas_node_data",
                    "kind": "shape",
                    "title": "Shape",
                    "x": 1.0,
                    "y": 2.0,
                    "width": 300.0,
                    "height": 180.0,
                    "zIndex": 4,
                    "data": { "shape": "triangle", "color": "url(bad)", "text": "Label" },
                    "createdAt": "now",
                    "updatedAt": "now"
                }],
                "edges": []
            }
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);

    let get_request = json!({
        "id": "get",
        "command": "canvas_get",
        "payload": { "canvasId": "canvas_node_data" }
    });
    let response: Value = serde_json::from_str(&core.call_json(&get_request.to_string())).unwrap();
    let nodes = response["payload"]["nodes"].as_array().unwrap();
    assert_eq!(nodes[0]["canvasId"], "canvas_node_data");
    assert_eq!(
        nodes[0]["data"],
        json!({ "markdown": "# Hi", "mode": "edit", "extra": true })
    );
    assert_eq!(
        nodes[1]["data"],
        json!({ "url": "http://localhost:5173", "loadState": "ready" })
    );
    assert_eq!(nodes[2]["data"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(nodes[2]["data"]["items"][0]["done"], false);
    assert_eq!(
        nodes[2]["data"]["items"][0]["files"],
        json!(["src/main.rs"])
    );
    assert_eq!(nodes[2]["data"]["coordination"]["cwd"], "D:/DEV/wheeljack");
    assert_eq!(
        nodes[3]["data"],
        json!({ "shape": "rectangle", "color": "var(--accent)", "text": "Label" })
    );
}

#[test]
fn canvas_node_mutation_commands_match_reference_store_helpers() {
    let core =
        Core::new(test_init("canvas-node-mutations"), Arc::new(NullEventSink)).expect("core");
    let nodes = json!([
        {
            "id": "note_0",
            "canvasId": "canvas_test",
            "kind": "markdown_note",
            "title": "Note 0",
            "x": 0.0,
            "y": 0.0,
            "width": 320.0,
            "height": 180.0,
            "zIndex": 30,
            "data": { "text": "one" },
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
            "width": 320.0,
            "height": 120.0,
            "zIndex": 31,
            "data": {
                "adapterId": "generic-shell",
                "cwd": "D:/DEV/wheeljack",
                "status": "running",
                "transcript": []
            },
            "createdAt": "2026-06-16T00:00:00.000Z",
            "updatedAt": "2026-06-16T00:00:00.000Z"
        },
        {
            "id": "note_2",
            "canvasId": "canvas_test",
            "kind": "markdown_note",
            "title": "Note 2",
            "x": 0.0,
            "y": 0.0,
            "width": 320.0,
            "height": 180.0,
            "zIndex": 32,
            "data": { "text": "two" },
            "createdAt": "2026-06-16T00:00:00.000Z",
            "updatedAt": "2026-06-16T00:00:00.000Z"
        },
        {
            "id": "node_3",
            "canvasId": "canvas_test",
            "kind": "shell_terminal",
            "title": "Shell",
            "x": 0.0,
            "y": 0.0,
            "width": 640.0,
            "height": 320.0,
            "zIndex": 33,
            "data": {
                "adapterId": "shell",
                "cwd": "D:/DEV/wheeljack",
                "status": "running",
                "transcript": []
            },
            "createdAt": "2026-06-16T00:00:00.000Z",
            "updatedAt": "2026-06-16T00:00:00.000Z"
        }
    ]);
    let arranged: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "arrange",
                "command": "canvas_arrange_grid",
                "payload": { "nodes": nodes.clone() }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(
        arranged["payload"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|node| node["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["node_1", "node_3", "note_0", "note_2"]
    );
    assert_eq!(arranged["payload"]["nodes"][0]["width"], 600.0);
    assert_eq!(arranged["payload"]["nodes"][0]["height"], 300.0);
    assert_eq!(arranged["payload"]["nodes"][1]["x"], 360.0);
    assert_eq!(
        arranged["payload"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|node| node["updatedAt"].as_str().unwrap())
            .collect::<HashSet<_>>()
            .len(),
        1
    );

    let edges = json!([
        { "id": "edge_0", "sourceNodeId": "node_1", "targetNodeId": "note_2", "kind": "dependency", "label": null },
        { "id": "edge_1", "sourceNodeId": "note_0", "targetNodeId": "node_3", "kind": "handoff", "label": null }
    ]);
    let deleted: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "delete",
                "command": "canvas_delete_node",
                "payload": {
                    "nodes": nodes.clone(),
                    "edges": edges,
                    "nodeId": "note_2",
                    "selectedNodeIds": ["node_1", "note_2"],
                    "focusedNodeId": "note_2"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(deleted["payload"]["removedNode"]["id"], "note_2");
    assert_eq!(deleted["payload"]["nodes"].as_array().unwrap().len(), 3);
    assert_eq!(deleted["payload"]["edges"].as_array().unwrap().len(), 1);
    assert_eq!(deleted["payload"]["selectedNodeIds"], json!(["node_1"]));
    assert_eq!(deleted["payload"]["focusedNodeId"], Value::Null);

    let swapped: Value = serde_json::from_str(
            &core.call_json(
                &json!({
                    "id": "swap",
                    "command": "canvas_swap_nodes",
                    "payload": {
                        "nodes": [
                            { "id": "node_0", "canvasId": "canvas_test", "kind": "agent_terminal", "title": "A", "x": 0.0, "y": 0.0, "width": 600.0, "height": 300.0, "zIndex": 33, "data": {}, "createdAt": "now", "updatedAt": "old" },
                            { "id": "node_1", "canvasId": "canvas_test", "kind": "agent_terminal", "title": "B", "x": 0.0, "y": 0.0, "width": 600.0, "height": 300.0, "zIndex": 30, "data": {}, "createdAt": "now", "updatedAt": "old" },
                            { "id": "node_2", "canvasId": "canvas_test", "kind": "shell_terminal", "title": "C", "x": 0.0, "y": 0.0, "width": 600.0, "height": 300.0, "zIndex": 31, "data": {}, "createdAt": "now", "updatedAt": "old" }
                        ],
                        "sourceNodeId": "node_1",
                        "targetNodeId": "node_0"
                    }
                })
                .to_string(),
            ),
        )
        .unwrap();
    assert_eq!(swapped["payload"]["swapped"], true);
    assert_eq!(
        swapped["payload"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|node| node["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["node_0", "node_2", "node_1"]
    );
    assert_eq!(
        swapped["payload"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|node| node["zIndex"].as_i64().unwrap())
            .collect::<Vec<_>>(),
        vec![30, 31, 32]
    );

    let duplicated_agent: Value = serde_json::from_str(
            &core.call_json(
                &json!({
                    "id": "duplicate-agent",
                    "command": "canvas_duplicate_node",
                    "payload": {
                        "nodes": [
                            { "id": "node_atlas", "canvasId": "canvas_test", "kind": "agent_terminal", "title": "Atlas", "x": 0.0, "y": 0.0, "width": 600.0, "height": 300.0, "zIndex": 30, "data": { "adapterId": "claude-code", "adapterName": "Claude Code" }, "createdAt": "now", "updatedAt": "old" },
                            { "id": "node_beacon", "canvasId": "canvas_test", "kind": "agent_terminal", "title": "Beacon", "x": 0.0, "y": 0.0, "width": 600.0, "height": 300.0, "zIndex": 31, "data": { "adapterId": "codex-cli", "adapterName": "Codex CLI" }, "createdAt": "now", "updatedAt": "old" }
                        ],
                        "nodeId": "node_atlas"
                    }
                })
                .to_string(),
            ),
        )
        .unwrap();
    assert_eq!(duplicated_agent["payload"]["duplicate"]["title"], "Cipher");
    assert_eq!(duplicated_agent["payload"]["duplicate"]["x"], 36.0);
    assert_eq!(duplicated_agent["payload"]["duplicate"]["zIndex"], 31);
    assert_eq!(
        duplicated_agent["payload"]["selectedNodeIds"][0],
        duplicated_agent["payload"]["duplicate"]["id"]
    );
    assert_eq!(
        next_agent_callsign(&["Atlas".to_string(), "cipher".to_string()]),
        "Beacon"
    );
    let exhausted = AGENT_CALLSIGNS
        .iter()
        .map(|callsign| callsign.to_string())
        .collect::<Vec<_>>();
    assert_eq!(next_agent_callsign(&exhausted), "Atlas-2");
    assert_eq!(
        parse_callsign_panel_input("Atlas-2: report status"),
        Some(("Atlas-2".to_string(), "report status".to_string()))
    );

    let duplicated_shell: Value = serde_json::from_str(
            &core.call_json(
                &json!({
                    "id": "duplicate-shell",
                    "command": "canvas_duplicate_node",
                    "payload": {
                        "nodes": [
                            { "id": "node_shell", "canvasId": "canvas_test", "kind": "shell_terminal", "title": "Shell", "x": 10.0, "y": 20.0, "width": 600.0, "height": 300.0, "zIndex": 30, "data": { "adapterId": "shell" }, "createdAt": "now", "updatedAt": "old" }
                        ],
                        "nodeId": "node_shell"
                    }
                })
                .to_string(),
            ),
        )
        .unwrap();
    assert_eq!(duplicated_shell["payload"]["duplicate"]["title"], "Shell");
    assert_eq!(duplicated_shell["payload"]["duplicate"]["x"], 46.0);
}

#[test]
fn canvas_duplicate_agent_allocates_a_project_wide_callsign() {
    let core = Core::new(
        test_init("project-wide-duplicate-callsign"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    {
        let db = core.lock_db().unwrap();
        db.execute(
            "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('project_callsigns', 'Callsigns', '.', 'now', 'now')",
            [],
        )
        .unwrap();
        for (canvas_id, name, sort_index) in [("canvas_a", "A", 0), ("canvas_b", "B", 1)] {
            db.execute(
                "INSERT INTO canvases (id, project_id, name, camera_json, sort_index, created_at, updated_at) VALUES (?1, 'project_callsigns', ?2, '{\"x\":0,\"y\":0,\"scale\":1}', ?3, 'now', 'now')",
                params![canvas_id, name, sort_index],
            )
            .unwrap();
        }
        for (node_id, canvas_id, title) in [
            ("node_atlas", "canvas_a", "Atlas"),
            ("node_beacon", "canvas_b", "Beacon"),
        ] {
            let mut node = agent_node_json(node_id, title, ".", 30);
            node["canvasId"] = json!(canvas_id);
            upsert_canvas_node(
                &db,
                canvas_id,
                &serde_json::from_value::<CanvasNodeDto>(node).unwrap(),
            )
            .unwrap();
        }
    }

    let duplicated: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "duplicate-project-agent",
                "command": "canvas_duplicate_node",
                "payload": {
                    "canvasId": "canvas_b",
                    "nodeId": "node_beacon"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();

    assert_eq!(duplicated["ok"], true, "{duplicated}");
    assert_eq!(duplicated["payload"]["duplicate"]["title"], "Cipher");
}

#[test]
fn canvas_selection_and_delete_selected_match_reference_store_helpers() {
    assert_eq!(
        select_node_in_selection(&[], None, "node_1", false)
            .unwrap()
            .selected_node_ids,
        vec!["node_1"]
    );
    assert!(
        select_node_in_selection(&["node_1".to_string()], Some("node_1"), "node_1", false)
            .is_none()
    );
    assert_eq!(
        select_node_in_selection(
            &["node_1".to_string(), "node_2".to_string()],
            Some("node_1"),
            "node_2",
            true
        )
        .unwrap()
        .selected_node_ids,
        vec!["node_1", "node_2"]
    );
    assert_eq!(
        select_node_in_selection(&["node_1".to_string()], Some("node_1"), "node_2", true)
            .unwrap()
            .selected_node_ids,
        vec!["node_1", "node_2"]
    );

    let core =
        Core::new(test_init("canvas-delete-selected"), Arc::new(NullEventSink)).expect("core");
    let patch = json!({
        "id": "patch",
        "command": "canvas_apply_patch",
        "payload": {
            "canvasId": "canvas_delete_selected",
            "patch": {
                "project": {
                    "id": "project_delete_selected",
                    "name": "Delete selected",
                    "path": ".",
                    "branch": "main",
                    "dirty": false
                },
                "nodes": [
                    { "id": "node_1", "canvasId": "canvas_delete_selected", "kind": "markdown_note", "title": "One", "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "zIndex": 1, "data": {}, "createdAt": "now", "updatedAt": "now" },
                    { "id": "node_2", "canvasId": "canvas_delete_selected", "kind": "markdown_note", "title": "Two", "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "zIndex": 2, "data": {}, "createdAt": "now", "updatedAt": "now" },
                    { "id": "node_3", "canvasId": "canvas_delete_selected", "kind": "markdown_note", "title": "Three", "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "zIndex": 3, "data": {}, "createdAt": "now", "updatedAt": "now" }
                ],
                "edges": [
                    { "id": "edge_1", "sourceNodeId": "node_1", "targetNodeId": "node_3", "kind": "dependency", "label": null },
                    { "id": "edge_2", "sourceNodeId": "node_2", "targetNodeId": "node_3", "kind": "dependency", "label": null }
                ],
                "selectedNodeIds": ["node_1", "node_2"],
                "focusedNodeId": "node_2"
            }
        }
    });
    let patched: Value = serde_json::from_str(&core.call_json(&patch.to_string())).unwrap();
    assert_eq!(patched["ok"], true);

    let deleted: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "delete",
                "command": "canvas_delete_selected",
                "payload": { "canvasId": "canvas_delete_selected" }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(deleted["payload"]["deletedCount"], 2);
    assert_eq!(deleted["payload"]["nodes"][0]["id"], "node_3");
    assert_eq!(deleted["payload"]["edges"].as_array().unwrap().len(), 0);

    let loaded: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"get","command":"canvas_get","payload":{"canvasId":"canvas_delete_selected"}}"#,
    ))
    .unwrap();
    assert_eq!(loaded["payload"]["selectedNodeIds"], json!([]));
    assert_eq!(loaded["payload"]["focusedNodeId"], Value::Null);
}

#[test]
fn callsign_panel_input_resolve_matches_reference_routing() {
    let core = Core::new(test_init("callsign-panel-input"), Arc::new(NullEventSink)).expect("core");
    let agent = |id: &str, title: &str, canvas_id: &str| {
        json!({
            "id": id,
            "canvasId": canvas_id,
            "kind": "agent_terminal",
            "title": title,
            "x": 0.0,
            "y": 0.0,
            "width": 640.0,
            "height": 320.0,
            "zIndex": 30,
            "data": {
                "adapterId": "claude-code",
                "adapterName": "Claude Code",
                "status": "running",
                "transcript": []
            },
            "createdAt": "2026-06-16T00:00:00.000Z",
            "updatedAt": "2026-06-16T00:00:00.000Z"
        })
    };
    let hidden_workspace = json!({
        "id": "canvas_hidden",
        "projectId": "project_test",
        "name": "Hidden",
        "themeId": "mono-dark",
        "camera": { "x": 0.0, "y": 0.0, "scale": 1.0 },
        "nodes": [agent("node_beacon", "Beacon", "canvas_hidden")],
        "edges": []
    });

    let parse_forms = [
        ("Atlas test", "test"),
        ("Atlas: run checks", "run checks"),
        ("Atlas - run checks", "run checks"),
    ];
    for (transcript, expected_input) in parse_forms {
        let response: Value = serde_json::from_str(
            &core.call_json(
                &json!({
                    "id": "resolve",
                    "command": "callsign_panel_input_resolve",
                    "payload": {
                        "transcript": transcript,
                        "canvasId": "canvas_test",
                        "nodes": [agent("node_atlas", "Atlas", "canvas_test")],
                        "workspaces": [hidden_workspace.clone()]
                    }
                })
                .to_string(),
            ),
        )
        .unwrap();
        assert_eq!(response["payload"]["nodeId"], "node_atlas");
        assert_eq!(response["payload"]["input"], expected_input);
        assert_eq!(response["payload"]["isActiveWorkspace"], true);
    }

    let hidden: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "hidden",
                "command": "callsign_panel_input_resolve",
                "payload": {
                    "transcript": "Beacon test",
                    "canvasId": "canvas_test",
                    "nodes": [agent("node_atlas", "Atlas", "canvas_test")],
                    "workspaces": [hidden_workspace]
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(hidden["payload"]["nodeId"], "node_beacon");
    assert_eq!(hidden["payload"]["input"], "test");
    assert_eq!(hidden["payload"]["isActiveWorkspace"], false);

    let shell: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "shell",
                "command": "callsign_panel_input_resolve",
                "payload": {
                    "transcript": "Shell pwd",
                    "canvasId": "canvas_test",
                    "nodes": [{
                        "id": "node_shell",
                        "canvasId": "canvas_test",
                        "kind": "shell_terminal",
                        "title": "Shell",
                        "x": 0.0,
                        "y": 0.0,
                        "width": 640.0,
                        "height": 320.0,
                        "zIndex": 30,
                        "data": { "adapterId": "shell", "transcript": [] },
                        "createdAt": "2026-06-16T00:00:00.000Z",
                        "updatedAt": "2026-06-16T00:00:00.000Z"
                    }],
                    "workspaces": []
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(shell["payload"], Value::Null);

    let incomplete: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "incomplete",
                "command": "callsign_panel_input_resolve",
                "payload": {
                    "transcript": "Atlas",
                    "canvasId": "canvas_test",
                    "nodes": [agent("node_atlas", "Atlas", "canvas_test")]
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(incomplete["payload"], Value::Null);

    let routed_active: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "route-active",
                "command": "callsign_panel_input_route",
                "payload": {
                    "transcript": "Atlas test",
                    "canvasId": "canvas_test",
                    "nodes": [
                        agent("node_orchestrator", "txtl orchestrator", "canvas_test"),
                        agent("node_atlas", "Atlas", "canvas_test")
                    ],
                    "workspaces": []
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(routed_active["payload"]["target"]["nodeId"], "node_atlas");
    assert_eq!(routed_active["payload"]["status"], "Sent input to Atlas.");
    assert_eq!(
        routed_active["payload"]["routedNode"]["data"]["pendingPrompt"],
        "test"
    );
    assert_eq!(
        routed_active["payload"]["routedNode"]["data"]["pendingPromptLabel"],
        "test"
    );
    assert_eq!(routed_active["payload"]["focusedNodeId"], "node_atlas");
    assert_eq!(
        routed_active["payload"]["selectedNodeIds"],
        json!(["node_atlas"])
    );
    assert_eq!(
        routed_active["payload"]["callsignPanelInputHandoff"]["fromNodeId"],
        "node_orchestrator"
    );

    let pending_prompt_id = routed_active["payload"]["pendingPromptId"]
        .as_str()
        .unwrap()
        .to_string();
    let cleared: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "clear-pending",
                "command": "terminal_pending_prompt_clear",
                "payload": {
                    "nodes": routed_active["payload"]["nodes"].clone(),
                    "nodeId": "node_atlas",
                    "pendingPromptId": pending_prompt_id
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(cleared["payload"]["clearedNode"]["id"], "node_atlas");
    assert_eq!(
        cleared["payload"]["clearedNode"]["data"]["pendingPrompt"],
        Value::Null
    );
    assert_eq!(cleared["payload"]["clearedNode"]["data"]["prompt"], "test");

    let routed_hidden: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "route-hidden",
                "command": "callsign_panel_input_route",
                "payload": {
                    "transcript": "Beacon test",
                    "canvasId": "canvas_test",
                    "nodes": [agent("node_atlas", "Atlas", "canvas_test")],
                    "workspaces": [{
                        "id": "canvas_hidden",
                        "projectId": "project_test",
                        "name": "Hidden",
                        "themeId": "mono-dark",
                        "camera": { "x": 0.0, "y": 0.0, "scale": 1.0 },
                        "nodes": [agent("node_beacon", "Beacon", "canvas_hidden")],
                        "edges": []
                    }]
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(
        routed_hidden["payload"]["target"]["isActiveWorkspace"],
        false
    );
    assert_eq!(
        routed_hidden["payload"]["status"],
        "Queued input for Beacon."
    );
    assert_eq!(
        routed_hidden["payload"]["workspaces"][0]["nodes"][0]["data"]["pendingPrompt"],
        "test"
    );
    assert_eq!(
        routed_hidden["payload"]["callsignPanelInputHandoff"],
        Value::Null
    );
}
