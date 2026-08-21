use super::support::*;
use crate::*;

#[test]
fn pty_write_payload_accepts_reference_and_native_shapes() {
    assert_eq!(
        payload_bytes(&json!({ "data": [65, 13, 10] })).unwrap(),
        b"A\r\n"
    );
    assert_eq!(
        payload_bytes(&json!({ "data": "echo native\r" })).unwrap(),
        b"echo native\r"
    );
    assert_eq!(
        payload_bytes(&json!({ "dataBase64": "G1s/OTAwMWg=" })).unwrap(),
        vec![27, 91, 63, 57, 48, 48, 49, 104]
    );
    assert!(payload_bytes(&json!({ "data": [256] }))
        .unwrap_err()
        .to_string()
        .contains("must contain bytes"));
}

#[test]
fn initializes_schema_and_emits_ready() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("schema"), sink.clone()).expect("core");
    let response: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"1","command":"core_status"}"#))
            .expect("response json");

    assert_eq!(response["ok"], true);
    assert!(core.paths.db_path().exists());
    let schema_version: i32 = core
        .lock_db()
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(schema_version, db::LATEST_SCHEMA_VERSION);
    assert_eq!(sink.events.lock().unwrap()[0].0, "core:ready");
}

#[test]
fn protocol_v2_handshake_and_envelope_keep_v1_compatible() {
    let core = Core::new(test_init("protocol-v2"), Arc::new(NullEventSink)).unwrap();
    let v1: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"v1","command":"core_status","payload":{}}"#),
    )
    .unwrap();
    assert!(v1.get("protocolVersion").is_none());
    assert!(v1.get("requestId").is_none());

    let v2: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"v2","command":"core_handshake","protocolVersion":2,"payload":{"supportedVersions":[2,1]}}"#,
    ))
    .unwrap();
    assert_eq!(v2["protocolVersion"], 2);
    assert_eq!(v2["requestId"], "v2");
    assert_eq!(v2["payload"]["protocolVersion"], 2);
    assert!(v2["payload"]["capabilities"]
        .as_array()
        .unwrap()
        .contains(&json!("route-confirmation")));
}

#[test]
fn shutdown_is_idempotent_rejects_calls_and_quiesces_events() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("shutdown"), sink.clone()).unwrap();
    let events = core.events.clone();
    core.shutdown();
    core.shutdown();
    let count = sink.snapshot().len();
    events.emit("test:late", &json!({}));
    assert_eq!(sink.snapshot().len(), count);
    let response: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"late","command":"core_status","payload":{}}"#),
    )
    .unwrap();
    assert_eq!(response["error"]["code"], "unavailable");
}

#[test]
fn session_events_are_durable_queryable_and_readable() {
    let core = Core::new(test_init("session-events"), Arc::new(NullEventSink)).unwrap();
    {
        let db = core.lock_db().unwrap();
        db.execute(
            "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, created_at, updated_at)
             VALUES ('session_activity', 'node_activity', 'codex-cli', '{}', '.', 'running', 'now', 'now')",
            [],
        )
        .unwrap();
    }
    let appended: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"append","command":"session_event_append","protocolVersion":2,"payload":{"sessionId":"session_activity","kind":"agent_protocol","status":"canceled","message":"Turn canceled","payload":{"partialOutput":true}}}"#,
    ))
    .unwrap();
    assert_eq!(appended["payload"]["status"], "canceled");
    let event_id = appended["payload"]["id"].as_i64().unwrap();
    let listed: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"list","command":"activity_list","protocolVersion":2,"payload":{"unreadOnly":true}}"#,
    ))
    .unwrap();
    assert_eq!(listed["payload"].as_array().unwrap().len(), 1);
    let marked: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "read",
                "command": "activity_mark_read",
                "protocolVersion": 2,
                "payload": { "eventId": event_id }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(marked["payload"]["updated"], 1);
    let cleared: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"clear","command":"activity_clear","protocolVersion":2,"payload":{}}"#,
    ))
    .unwrap();
    assert_eq!(cleared["payload"]["deleted"], 1);
    let listed: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"list-after-clear","command":"activity_list","protocolVersion":2,"payload":{}}"#,
    ))
    .unwrap();
    assert!(listed["payload"].as_array().unwrap().is_empty());
}

#[test]
fn imports_and_exports_settings_without_legacy_token() {
    let core = Core::new(test_init("settings"), Arc::new(NullEventSink)).expect("core");
    let import_response = core.call_json(
        &json!({
            "id": "set",
            "command": "settings_import",
            "payload": {
                "spotify_token": "secret",
                "defaultTerminalCwd": "OPENAI_API_KEY=sk-settings1234567890 D:/DEV/wheeljack",
                "agentProfiles": [{
                    "adapterId": "pi-coding-agent",
                    "provider": "openai-codex",
                    "model": "gpt-5.4-mini",
                    "thinking": "minimal",
                    "approvalPolicy": ""
                }],
                "adapters": [{
                    "launchCommand": "custom-agent --api-key sk-adapter1234567890",
                    "setupHint": "Set token=ghp_adapter1234567890",
                    "streaming": {
                        "preferred": {
                            "launchCommand": "OPENROUTER_API_KEY=sk-stream1234567890 custom-agent"
                        }
                    }
                }],
                "provider": {
                    "apiKey": "ghp_object1234567890"
                }
            }
        })
        .to_string(),
    );
    assert_eq!(
        serde_json::from_str::<Value>(&import_response).unwrap()["ok"],
        true
    );

    let export_response: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"get","command":"settings_export"}"#))
            .unwrap();
    assert!(export_response["payload"].get("workspace").is_some());
    assert_eq!(
        export_response["payload"]["workspace"]["settings"]["defaultTerminalCwd"],
        "OPENAI_API_KEY=[redacted] D:/DEV/wheeljack"
    );
    assert!(export_response["payload"].get("spotify_token").is_none());
    assert_eq!(
        export_response["payload"]["agentProfiles"][0]["provider"],
        "openai-codex"
    );
    assert_eq!(
        export_response["payload"]["agentProfiles"][0]["model"],
        "gpt-5.4-mini"
    );
    let exported = export_response["payload"].to_string();
    assert!(exported.contains("[redacted]"));
    assert!(!exported.contains("sk-settings"));
    assert!(!exported.contains("sk-adapter"));
    assert!(!exported.contains("ghp_adapter"));
    assert!(!exported.contains("sk-stream"));
    assert!(!exported.contains("ghp_object"));
}

#[test]
fn desktop_onboarding_version_persists_across_core_restart() {
    let init = test_init("desktop-onboarding-version");
    let core = Core::new(init.clone(), Arc::new(NullEventSink)).expect("core");
    let imported: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"set","command":"settings_import","payload":{"desktopOnboardingVersion":1,"selectedAgentAdapterId":"custom.agent-1"}}"#,
    ))
    .unwrap();
    assert_eq!(imported["ok"], true);
    drop(core);

    let reloaded = Core::new(init, Arc::new(NullEventSink)).expect("reload core");
    let exported: Value =
        serde_json::from_str(&reloaded.call_json(r#"{"id":"get","command":"settings_export"}"#))
            .unwrap();
    assert_eq!(exported["payload"]["desktopOnboardingVersion"], 1);
    assert_eq!(
        exported["payload"]["selectedAgentAdapterId"],
        "custom.agent-1"
    );
}

#[test]
fn settings_import_sanitizes_reference_app_settings() {
    let core = Core::new(test_init("settings-sanitized"), Arc::new(NullEventSink)).expect("core");
    let import_response = core.call_json(
        &json!({
            "id": "set",
            "command": "settings_import",
            "payload": {
                "workspace": {
                    "version": 1,
                    "themeId": "mono-light",
                    "settings": {
                        "reducedMotion": true,
                        "telemetry": "yes",
                        "accentColor": "tomato",
                        "fontScale": 4,
                        "nodeOpacity": 0.1,
                        "backgroundOverlayOpacity": 2,
                        "chatBubbleDensity": "giant",
                        "chatBubbleWidthCh": 120,
                        "browserHomeUrl": "localhost:5173",
                        "appFontFamily": "Inter; url(http://bad)",
                        "orchestratorLocalPlannerProvider": "bad-provider",
                        "orchestratorLocalPlannerTimeoutMs": 25,
                        "unknownSetting": "must not persist",
                        "workspaceBackground": {
                            "kind": "studio",
                            "presetId": "lightning",
                            "seed": 10050,
                            "opacity": 0.05,
                            "intensity": 2,
                            "speed": -1,
                            "scale": 3,
                            "colorA": "not-a-color",
                            "colorB": "#112233"
                        },
                        "shortcuts": {
                            "commandPalette": "ctrl + k",
                            "addBrowser": "b",
                            "pane.close": "ctrl + shift + w",
                            "agent.stop": "",
                            "bad": 42,
                            "unknown action!": "Ctrl+Shift+X"
                        },
                        "commandHistory": [
                            {
                                "id": "history_1",
                                "source": "retired-input",
                                "text": "open browser",
                                "result": "Opened.",
                                "risk": "caution",
                                "createdAt": "2026-06-24T00:00:00Z"
                            },
                            {
                                "id": "history_bad",
                                "source": "bad",
                                "text": "",
                                "result": "ignored",
                                "risk": "bad",
                                "createdAt": "later"
                            }
                        ]
                    }
                }
            }
        })
        .to_string(),
    );
    assert_eq!(
        serde_json::from_str::<Value>(&import_response).unwrap()["ok"],
        true
    );

    let export_response: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"get","command":"settings_export"}"#))
            .unwrap();
    let settings = &export_response["payload"];
    assert_eq!(settings["theme"], "mono-light");
    assert_eq!(settings["workspace"]["themeId"], "mono-light");
    assert_eq!(settings["reducedMotion"], true);
    assert!(settings.get("telemetry").is_none());
    assert!(settings.get("accentColor").is_none());
    assert_eq!(settings["fontScale"], 1.2);
    assert_eq!(settings["nodeOpacity"], 0.6);
    assert_eq!(settings["backgroundOverlayOpacity"], 0.85);
    assert_eq!(settings["chatBubbleDensity"], "cozy");
    assert_eq!(settings["chatBubbleWidthCh"], 88);
    assert_eq!(settings["browserHomeUrl"], "http://localhost:5173");
    assert!(settings["appFontFamily"]
        .as_str()
        .unwrap()
        .contains("Inter"));
    assert!(settings.get("orchestratorLocalPlannerProvider").is_none());
    assert!(settings.get("orchestratorLocalPlannerTimeoutMs").is_none());
    assert!(settings.get("unknownSetting").is_none());
    assert_eq!(settings["workspaceBackground"]["kind"], "studio");
    assert_eq!(settings["workspaceBackground"]["presetId"], "light-rays");
    assert_eq!(settings["workspaceBackground"]["seed"], 9999);
    assert_eq!(settings["workspaceBackground"]["opacity"], 0.18);
    assert_eq!(settings["workspaceBackground"]["intensity"], 1.0);
    assert_eq!(settings["workspaceBackground"]["speed"], 0.0);
    assert_eq!(settings["workspaceBackground"]["scale"], 1.6);
    assert_eq!(settings["workspaceBackground"]["colorA"], "#ecd890");
    assert_eq!(settings["workspaceBackground"]["colorB"], "#112233");
    assert_eq!(
        settings["shortcuts"]["commandPalette"],
        "CommandOrControl+K"
    );
    assert_eq!(settings["shortcuts"]["addBrowser"], "B");
    assert_eq!(
        settings["shortcuts"]["pane.close"],
        "CommandOrControl+Shift+W"
    );
    assert_eq!(settings["shortcuts"]["agent.stop"], "");
    assert!(settings["shortcuts"].get("bad").is_none());
    assert!(settings["shortcuts"].get("unknown action!").is_none());
    assert_eq!(settings["commandHistory"].as_array().unwrap().len(), 1);
    assert_eq!(settings["commandHistory"][0]["source"], "typed");
    assert_eq!(settings["commandHistory"][0]["risk"], "caution");
    assert_eq!(settings["commandHistory"][0]["text"], "open browser");
}

#[test]
fn settings_import_normalizes_video_and_invalid_workspace_backgrounds() {
    let core = Core::new(
        test_init("settings-background-sanitized"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let long_url = "x".repeat(2100);
    let import_response = core.call_json(
        &json!({
            "id": "set",
            "command": "settings_import",
            "payload": {
                "settings": {
                    "workspaceBackground": {
                        "kind": "video",
                        "url": long_url,
                        "color": true,
                        "opacity": 3
                    }
                }
            }
        })
        .to_string(),
    );
    assert_eq!(
        serde_json::from_str::<Value>(&import_response).unwrap()["ok"],
        true
    );

    let export_response: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"get","command":"settings_export"}"#))
            .unwrap();
    let background = &export_response["payload"]["workspaceBackground"];
    assert_eq!(background["kind"], "video");
    assert_eq!(background["url"].as_str().unwrap().len(), 2048);
    assert_eq!(background["color"], true);
    assert_eq!(background["opacity"], 1.0);
    assert_eq!(export_response["payload"]["backgroundVideoEnabled"], true);
    assert_eq!(
        export_response["payload"]["backgroundVideoUrl"]
            .as_str()
            .unwrap()
            .len(),
        2048
    );
    assert_eq!(
        export_response["payload"]["backgroundVideoColorEnabled"],
        true
    );

    let import_response = core.call_json(
        &json!({
            "id": "set2",
            "command": "settings_import",
            "payload": {
                "settings": {
                    "backgroundVideoEnabled": true,
                    "backgroundVideoUrl": "C:\\Users\\USER\\Videos\\ambience.mp4",
                    "backgroundVideoColorEnabled": false
                }
            }
        })
        .to_string(),
    );
    assert_eq!(
        serde_json::from_str::<Value>(&import_response).unwrap()["ok"],
        true
    );

    let export_response: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"get2","command":"settings_export"}"#))
            .unwrap();
    let background = &export_response["payload"]["workspaceBackground"];
    assert_eq!(background["kind"], "video");
    assert_eq!(background["url"], "C:\\Users\\USER\\Videos\\ambience.mp4");
    assert_eq!(background["color"], false);
    assert_eq!(background["opacity"], 1.0);
    assert_eq!(export_response["payload"]["backgroundVideoEnabled"], true);

    let import_response = core.call_json(
        &json!({
            "id": "set2b",
            "command": "settings_import",
            "payload": {
                "settings": {
                    "backgroundVideoColorEnabled": true,
                    "workspaceBackground": {
                        "kind": "video",
                        "url": "D:\\media\\fallback-color.mp4"
                    }
                }
            }
        })
        .to_string(),
    );
    assert_eq!(
        serde_json::from_str::<Value>(&import_response).unwrap()["ok"],
        true
    );

    let export_response: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"get2b","command":"settings_export"}"#))
            .unwrap();
    let background = &export_response["payload"]["workspaceBackground"];
    assert_eq!(background["kind"], "video");
    assert_eq!(background["url"], "D:\\media\\fallback-color.mp4");
    assert_eq!(background["color"], true);
    assert_eq!(background["opacity"], 1.0);
    assert_eq!(
        export_response["payload"]["backgroundVideoColorEnabled"],
        true
    );

    let import_response = core.call_json(
        &json!({
            "id": "set3",
            "command": "settings_import",
            "payload": {
                "settings": {
                    "backgroundVideoEnabled": true,
                    "backgroundVideoColorEnabled": true,
                    "backgroundVideoUrl": "D:\\media\\legacy.mp4",
                    "workspaceBackground": {
                        "kind": "unknown",
                        "presetId": "bad"
                    }
                }
            }
        })
        .to_string(),
    );
    assert_eq!(
        serde_json::from_str::<Value>(&import_response).unwrap()["ok"],
        true
    );

    let export_response: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"get3","command":"settings_export"}"#))
            .unwrap();
    let background = &export_response["payload"]["workspaceBackground"];
    assert_eq!(background["kind"], "video");
    assert_eq!(background["url"], "D:\\media\\legacy.mp4");
    assert_eq!(background["color"], true);
    assert_eq!(background["opacity"], 1.0);
    assert_eq!(export_response["payload"]["backgroundVideoEnabled"], true);
    assert_eq!(
        export_response["payload"]["backgroundVideoUrl"],
        "D:\\media\\legacy.mp4"
    );
    assert_eq!(
        export_response["payload"]["backgroundVideoColorEnabled"],
        true
    );

    let import_response = core.call_json(
        &json!({
            "id": "set4",
            "command": "settings_import",
            "payload": {
                "settings": {
                    "backgroundVideoEnabled": false,
                    "backgroundVideoUrl": "",
                    "backgroundVideoColorEnabled": true
                }
            }
        })
        .to_string(),
    );
    assert_eq!(
        serde_json::from_str::<Value>(&import_response).unwrap()["ok"],
        true
    );

    let export_response: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"get4","command":"settings_export"}"#))
            .unwrap();
    let background = &export_response["payload"]["workspaceBackground"];
    assert_eq!(background["kind"], "studio");
    assert_eq!(background["presetId"], "aurora");
    assert_eq!(background["seed"], 642);
    assert_eq!(export_response["payload"]["backgroundVideoEnabled"], false);
    assert_eq!(export_response["payload"]["backgroundVideoUrl"], "");
    assert_eq!(
        export_response["payload"]["backgroundVideoColorEnabled"],
        true
    );
}

#[test]
fn reference_wrapped_command_payloads_are_accepted() {
    let core = Core::new(test_init("wrapped-payloads"), Arc::new(NullEventSink)).expect("core");

    let adapter: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "adapter",
                "command": "adapter_save",
                "payload": {
                    "manifest": adapter_json(
                        "wrapped-agent",
                        "Wrapped Agent",
                        "wrapped-agent",
                        "wrapped-agent --workspace",
                        "stdin"
                    )
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(adapter["ok"], true);
    assert_eq!(adapter["payload"]["id"], "wrapped-agent");

    let imported: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "settings",
                "command": "settings_import",
                "payload": {
                    "settings": {
                        "theme": "mono-light",
                        "destructiveConfirmations": true
                    },
                    "adapters": [
                        adapter_json(
                            "imported-agent",
                            "Imported Agent",
                            "imported-agent",
                            "imported-agent --workspace",
                            "stdin"
                        )
                    ]
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(imported["ok"], true);

    let settings: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"get","command":"settings_export"}"#))
            .unwrap();
    assert_eq!(settings["payload"]["theme"], "mono-light");
    assert!(settings["payload"]["workspace"]["exportedAt"]
        .as_str()
        .is_some());
    assert_eq!(settings["payload"]["workspace"]["themeId"], "mono-light");
    assert!(settings["payload"]["workspace"]["adapters"]
        .as_array()
        .unwrap()
        .iter()
        .any(|adapter| adapter["id"] == "imported-agent"));
    let adapters: Value =
        serde_json::from_str(&core.call_json(r#"{"id":"adapters","command":"adapter_list"}"#))
            .unwrap();
    assert!(adapters["payload"]
        .as_array()
        .unwrap()
        .iter()
        .any(|adapter| adapter["id"] == "imported-agent"));

    let parsed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "intent",
                "command": "intent_parse",
                "payload": {
                    "req": {
                        "transcript": "open localhost:3000",
                        "source": "typed"
                    }
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(parsed["ok"], true);
    assert_eq!(
        parsed["payload"]["actions"][0]["type"],
        "create_browser_node"
    );
}
