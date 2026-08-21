use super::support::test_init;
use crate::*;

fn usage_db() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    run_migrations(&db).unwrap();
    db.execute_batch(
        r#"
        INSERT INTO projects (id, name, path, created_at, updated_at)
        VALUES ('project-1', 'wheeljack', 'C:\wheeljack', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z');
        INSERT INTO canvases (id, project_id, name, theme_id, camera_json, created_at, updated_at)
        VALUES ('canvas-1', 'project-1', 'Main', 'mono-dark', '{}', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z');
        INSERT INTO nodes (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
        VALUES ('node-1', 'canvas-1', 'agent_terminal', 'API agent', 0, 0, 640, 320, 0, '{}', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z');
        "#,
    )
    .unwrap();
    db
}

fn insert_session(db: &Connection, id: &str, adapter_id: &str, provider: &str, model: &str) {
    db.execute(
        "INSERT INTO sessions (
           id, node_id, adapter_id, command_json, cwd, status, started_at, created_at, updated_at
         ) VALUES (?1, 'node-1', ?2, ?3, 'C:\\wheeljack', 'completed',
                   '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z')",
        params![
            id,
            adapter_id,
            json!({
                "provider": provider,
                "model": model,
                "source": "structured_agent",
            })
            .to_string(),
        ],
    )
    .unwrap();
}

#[test]
fn codex_usage_is_unpriced_idempotent_and_requires_api_classification() {
    let db = usage_db();
    insert_session(&db, "codex-session", "codex-cli", "openai", "gpt-5.4");
    set_usage_billing_override(
        &db,
        json!({ "adapterId": "codex-cli", "providerId": "openai", "billingKind": "api" }),
    )
    .unwrap();
    let line = json!({
        "method": "thread/tokenUsage/updated",
        "params": {
            "turnId": "turn-1",
            "tokenUsage": {
                "last": {
                    "inputTokens": 120,
                    "cachedInputTokens": 40,
                    "outputTokens": 25,
                    "reasoningOutputTokens": 5,
                    "totalTokens": 145
                }
            }
        }
    })
    .to_string();

    assert!(ingest_agent_usage_line(
        &db,
        "codex-session",
        "codex-cli",
        "codex-app-server",
        &line,
        1,
    )
    .unwrap());
    assert!(ingest_agent_usage_line(
        &db,
        "codex-session",
        "codex-cli",
        "codex-app-server",
        &line,
        2,
    )
    .unwrap());

    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM usage_records", [], |row| row.get(0))
        .unwrap();
    let dashboard = query_usage_dashboard(&db, json!({})).unwrap();
    assert_eq!(count, 1);
    assert_eq!(dashboard["totals"]["inputTokens"], 120);
    assert_eq!(dashboard["totals"]["cacheReadTokens"], 40);
    assert_eq!(dashboard["totals"]["costNanoUsd"], 0);
    assert_eq!(dashboard["coverage"]["unpricedRecords"], 1);
}

#[test]
fn opencode_reported_cost_uses_guardrails_and_override() {
    let db = usage_db();
    insert_session(
        &db,
        "openrouter-session",
        "opencode",
        "openrouter",
        "model-a",
    );
    insert_session(
        &db,
        "anthropic-session",
        "opencode",
        "anthropic",
        "claude-sonnet",
    );
    insert_session(
        &db,
        "subscription-session",
        "opencode",
        "claude-max",
        "model-a",
    );
    let event = |id: &str, provider: &str, cost: f64| {
        json!({
            "type": "message.updated",
            "properties": {
                "info": {
                    "id": id,
                    "role": "assistant",
                    "providerID": provider,
                    "modelID": "model-a",
                    "tokens": { "input": 10, "output": 4, "reasoning": 2, "cache": { "read": 3, "write": 1 }, "total": 20 },
                    "cost": cost
                }
            }
        })
        .to_string()
    };
    ingest_agent_usage_line(
        &db,
        "openrouter-session",
        "opencode",
        "opencode-sse",
        &event("message-1", "openrouter", 0.002),
        1,
    )
    .unwrap();
    ingest_agent_usage_line(
        &db,
        "anthropic-session",
        "opencode",
        "opencode-sse",
        &event("message-2", "anthropic", 0.003),
        2,
    )
    .unwrap();
    ingest_agent_usage_line(
        &db,
        "subscription-session",
        "opencode",
        "opencode-sse",
        &event("message-3", "claude-max", 0.004),
        3,
    )
    .unwrap();

    let before = query_usage_dashboard(&db, json!({})).unwrap();
    assert_eq!(before["totals"]["costNanoUsd"], 2_000_000);
    assert_eq!(before["coverage"]["unknownRecords"], 1);
    assert_eq!(before["coverage"]["excludedSubscriptionRecords"], 1);
    assert_eq!(
        before["coverage"]["pendingProfiles"][0]["providerId"],
        "anthropic"
    );
    set_usage_billing_override(
        &db,
        json!({ "adapterId": "opencode", "providerId": "claude-max", "billingKind": "api" }),
    )
    .unwrap();
    let guarded = query_usage_dashboard(&db, json!({})).unwrap();
    assert_eq!(guarded["totals"]["costNanoUsd"], 2_000_000);
    assert_eq!(guarded["coverage"]["excludedSubscriptionRecords"], 1);

    set_usage_billing_override(
        &db,
        json!({ "adapterId": "opencode", "providerId": "anthropic", "billingKind": "api" }),
    )
    .unwrap();
    let metered = query_usage_dashboard(&db, json!({})).unwrap();
    assert_eq!(metered["totals"]["costNanoUsd"], 5_000_000);
    assert_eq!(metered["coverage"]["unknownRecords"], 0);

    set_usage_billing_override(
        &db,
        json!({ "adapterId": "opencode", "providerId": "anthropic", "billingKind": "subscription" }),
    )
    .unwrap();
    let excluded = query_usage_dashboard(&db, json!({})).unwrap();
    assert_eq!(excluded["totals"]["costNanoUsd"], 2_000_000);
    assert_eq!(excluded["coverage"]["excludedSubscriptionRecords"], 2);
}

#[test]
fn opencode_usage_unwraps_sse_payload_envelope() {
    let db = usage_db();
    insert_session(
        &db,
        "opencode-session",
        "opencode",
        "openrouter",
        "x-ai/grok-4.6",
    );
    let line = json!({
        "directory": "C:\\wheeljack",
        "payload": {
            "type": "message.updated",
            "properties": {
                "info": {
                    "id": "message-1",
                    "role": "assistant",
                    "providerID": "openrouter",
                    "modelID": "x-ai/grok-4.6",
                    "tokens": {
                        "input": 120,
                        "output": 25,
                        "reasoning": 5,
                        "cache": { "read": 40, "write": 2 },
                        "total": 192
                    },
                    "cost": 0.004
                }
            }
        }
    })
    .to_string();

    assert!(ingest_agent_usage_line(
        &db,
        "opencode-session",
        "opencode",
        "opencode-sse",
        &line,
        1,
    )
    .unwrap());

    let dashboard = query_usage_dashboard(&db, json!({})).unwrap();
    assert_eq!(dashboard["totals"]["costNanoUsd"], 4_000_000);
    assert_eq!(dashboard["totals"]["inputTokens"], 120);
    assert_eq!(dashboard["totals"]["cacheReadTokens"], 40);
    assert_eq!(dashboard["providers"][0]["key"], "openrouter");
}

#[test]
fn claude_and_pi_ingestion_respect_auth_and_reported_cost() {
    let db = usage_db();
    insert_session(
        &db,
        "claude-session",
        "claude-code",
        "anthropic",
        "claude-sonnet",
    );
    insert_session(
        &db,
        "pi-session",
        "pi-coding-agent",
        "openrouter",
        "model-pi",
    );
    ingest_agent_usage_line(
        &db,
        "claude-session",
        "claude-code",
        "claude-stream-json",
        &json!({
            "type": "system",
            "subtype": "init",
            "apiKeySource": "ANTHROPIC_API_KEY",
            "model": "claude-sonnet"
        })
        .to_string(),
        1,
    )
    .unwrap();
    ingest_agent_usage_line(
        &db,
        "claude-session",
        "claude-code",
        "claude-stream-json",
        &json!({
            "type": "result",
            "uuid": "result-1",
            "modelUsage": {
                "claude-sonnet": {
                    "inputTokens": 50,
                    "outputTokens": 12,
                    "cacheReadInputTokens": 9,
                    "cacheCreationInputTokens": 3,
                    "costUSD": 0.004
                }
            }
        })
        .to_string(),
        2,
    )
    .unwrap();
    ingest_agent_usage_line(
        &db,
        "pi-session",
        "pi-coding-agent",
        "pi-rpc",
        &json!({
            "type": "message_end",
            "message": {
                "id": "pi-message-1",
                "role": "assistant",
                "provider": "openrouter",
                "model": "model-pi",
                "usage": {
                    "input": 20,
                    "output": 8,
                    "cacheRead": 4,
                    "cacheWrite": 2,
                    "cost": { "total": 0.001 }
                }
            }
        })
        .to_string(),
        3,
    )
    .unwrap();

    let dashboard = query_usage_dashboard(&db, json!({})).unwrap();
    assert_eq!(dashboard["totals"]["costNanoUsd"], 5_000_000);
    assert_eq!(dashboard["totals"]["inputTokens"], 70);
    assert_eq!(dashboard["totals"]["cacheWriteTokens"], 5);
    assert_eq!(dashboard["coverage"]["unknownRecords"], 0);
}

#[test]
fn pi_session_stats_replace_fallback_events_with_authoritative_totals() {
    let db = usage_db();
    insert_session(
        &db,
        "pi-session",
        "pi-coding-agent",
        "openrouter",
        "model-pi",
    );
    for (sequence, event) in [
        json!({
            "type": "message_end",
            "message": {
                "id": "assistant-1",
                "role": "assistant",
                "provider": "openrouter",
                "model": "model-pi",
                "usage": {
                    "input": 20,
                    "output": 8,
                    "cacheRead": 4,
                    "cacheWrite": 2,
                    "cost": { "total": 0.001 }
                }
            }
        }),
        json!({
            "type": "message_end",
            "message": {
                "toolCallId": "extension-usage-1",
                "role": "toolResult",
                "usage": {
                    "input": 1,
                    "output": 2,
                    "cacheRead": 3,
                    "cacheWrite": 4,
                    "cost": { "total": 0.002 }
                }
            }
        }),
        json!({
            "type": "compaction_end",
            "result": {
                "usage": {
                    "input": 5,
                    "output": 6,
                    "cacheRead": 7,
                    "cacheWrite": 8,
                    "cost": { "total": 0.003 }
                }
            }
        }),
    ]
    .into_iter()
    .enumerate()
    {
        assert!(ingest_agent_usage_line(
            &db,
            "pi-session",
            "pi-coding-agent",
            "pi-rpc",
            &event.to_string(),
            sequence as u64,
        )
        .unwrap());
    }

    let fallback = query_usage_dashboard(&db, json!({})).unwrap();
    assert_eq!(fallback["totals"]["costNanoUsd"], 6_000_000);
    assert_eq!(fallback["totals"]["inputTokens"], 26);
    assert_eq!(fallback["totals"]["cacheWriteTokens"], 14);

    let snapshot = |input: i64, output: i64, cache_read: i64, cache_write: i64, cost: f64| {
        json!({
            "id": 2,
            "type": "response",
            "command": "get_session_stats",
            "success": true,
            "data": {
                "sessionId": "pi-native-session",
                "tokens": {
                    "input": input,
                    "output": output,
                    "cacheRead": cache_read,
                    "cacheWrite": cache_write,
                    "total": input + output + cache_read + cache_write
                },
                "cost": cost
            }
        })
        .to_string()
    };
    assert!(ingest_agent_usage_line(
        &db,
        "pi-session",
        "pi-coding-agent",
        "pi-rpc",
        &snapshot(100, 40, 20, 10, 0.012),
        4,
    )
    .unwrap());

    let (record_count, source_key): (i64, String) = db
        .query_row(
            "SELECT COUNT(*), MIN(source_event_key) FROM usage_records WHERE session_id = 'pi-session'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(record_count, 1);
    assert_eq!(source_key, "pi:session-total");
    let authoritative = query_usage_dashboard(&db, json!({})).unwrap();
    assert_eq!(authoritative["totals"]["costNanoUsd"], 12_000_000);
    assert_eq!(authoritative["totals"]["inputTokens"], 100);
    assert_eq!(authoritative["totals"]["cacheReadTokens"], 20);

    let ignored_fallback = json!({
        "type": "message_end",
        "message": {
            "id": "assistant-2",
            "role": "assistant",
            "provider": "openrouter",
            "model": "model-pi",
            "usage": { "input": 9, "output": 3, "cost": { "total": 0.004 } }
        }
    })
    .to_string();
    assert!(!ingest_agent_usage_line(
        &db,
        "pi-session",
        "pi-coding-agent",
        "pi-rpc",
        &ignored_fallback,
        5,
    )
    .unwrap());
    assert!(ingest_agent_usage_line(
        &db,
        "pi-session",
        "pi-coding-agent",
        "pi-rpc",
        &snapshot(120, 50, 25, 11, 0.015),
        6,
    )
    .unwrap());
    let updated = query_usage_dashboard(&db, json!({})).unwrap();
    assert_eq!(updated["totals"]["costNanoUsd"], 15_000_000);
    assert_eq!(updated["totals"]["inputTokens"], 120);
    assert_eq!(updated["totals"]["cacheWriteTokens"], 11);
}

#[test]
fn invalid_usage_is_rejected_and_usage_clear_does_not_touch_transcripts() {
    let mut db = usage_db();
    insert_session(
        &db,
        "pi-session",
        "pi-coding-agent",
        "openrouter",
        "model-pi",
    );
    let invalid = json!({
        "type": "message_end",
        "message": {
            "role": "assistant",
            "provider": "openrouter",
            "usage": { "input": -1, "output": 2, "cost": { "total": 0.001 } }
        }
    })
    .to_string();
    assert!(
        !ingest_agent_usage_line(&db, "pi-session", "pi-coding-agent", "pi-rpc", &invalid, 1,)
            .unwrap()
    );
    db.execute(
        "INSERT INTO session_chunks (session_id, seq, stream, data, created_at)
         VALUES ('pi-session', 1, 'agent-stdout', X'61', '2026-08-20T00:00:00Z')",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO usage_records (
           session_id, source_event_key, adapter_id, provider_id, node_id, node_title,
           cwd, occurred_at, cost_source, billing_classification, created_at, updated_at
         ) VALUES (
           'pi-session', 'manual', 'pi-coding-agent', 'openrouter', 'node-1', 'API agent',
           'C:\\wheeljack', '2026-08-20T00:00:00Z', 'unpriced', 'metered',
           '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z'
         )",
        [],
    )
    .unwrap();

    clear_usage_data(&mut db).unwrap();
    let usage_count: i64 = db
        .query_row("SELECT COUNT(*) FROM usage_records", [], |row| row.get(0))
        .unwrap();
    let chunk_count: i64 = db
        .query_row("SELECT COUNT(*) FROM session_chunks", [], |row| row.get(0))
        .unwrap();
    assert_eq!(usage_count, 0);
    assert_eq!(chunk_count, 1);
}

#[test]
fn usage_commands_roundtrip_through_core_dispatch() {
    let core = Core::new(test_init("usage-dispatch"), Arc::new(NullEventSink)).unwrap();
    {
        let db = core.lock_db().unwrap();
        let timestamp = now();
        db.execute(
            "INSERT INTO usage_records (
               session_id, source_event_key, adapter_id, provider_id, node_id, node_title,
               cwd, occurred_at, input_tokens, cost_source, billing_classification,
               created_at, updated_at
             ) VALUES (
               'session-dispatch', 'event-1', 'opencode', 'anthropic', 'node-1', 'Agent',
               '.', ?1, 10, 'unpriced', 'unknown', ?1, ?1
             )",
            params![timestamp],
        )
        .unwrap();
        db.execute(
            "INSERT INTO session_chunks (session_id, seq, stream, data, created_at)
             VALUES ('session-dispatch', 1, 'agent-stdout', X'61', ?1)",
            params![timestamp],
        )
        .unwrap();
    }

    let override_response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "override",
                "command": "usage_billing_override_set",
                "payload": {
                    "adapterId": "opencode",
                    "providerId": "anthropic",
                    "billingKind": "api"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(override_response["ok"], true);

    let transcript_clear: Value =
        serde_json::from_str(&core.call_json(
            r#"{"id":"transcripts","command":"session_clear_transcripts","payload":{}}"#,
        ))
        .unwrap();
    assert_eq!(transcript_clear["ok"], true);

    let dashboard: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"dashboard","command":"usage_dashboard","payload":{}}"#),
    )
    .unwrap();
    assert_eq!(dashboard["ok"], true);
    assert_eq!(dashboard["payload"]["totals"]["inputTokens"], 10);

    let clear: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"clear","command":"usage_clear","payload":{}}"#),
    )
    .unwrap();
    assert_eq!(clear["ok"], true);
    assert_eq!(clear["payload"]["deletedRecords"], 1);
}
