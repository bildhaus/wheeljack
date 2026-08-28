use crate::*;

fn request(
    adapter_id: &str,
    intent: &str,
    approval: Option<&str>,
    sandbox: Option<&str>,
) -> StructuredAgentSpawnRequest {
    serde_json::from_value(json!({
        "nodeId": "node",
        "adapterId": adapter_id,
        "intent": intent,
        "cwd": ".",
        "args": if adapter_id == "claude-code" && intent == "ask" { json!(["--permission-mode", "plan"]) } else { json!([]) },
        "approvalPolicy": approval,
        "sandbox": sandbox
    }))
    .unwrap()
}

#[test]
fn ask_intent_requires_an_enforced_read_only_profile() {
    assert!(validate_session_intent(&request(
        "codex-cli",
        "ask",
        Some("never"),
        Some("read-only"),
    ))
    .is_ok());
    assert!(validate_session_intent(&request(
        "codex-cli",
        "ask",
        Some("on-request"),
        Some("workspace-write"),
    ))
    .is_err());
    assert!(validate_session_intent(&request("claude-code", "ask", Some("plan"), None,)).is_ok());
    assert!(validate_session_intent(&request("opencode", "ask", Some("deny"), None,)).is_err());
    assert!(validate_session_intent(&request("opencode", "code", None, None)).is_ok());
}
