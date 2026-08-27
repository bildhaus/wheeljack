use super::support::temp_dir;
use crate::{db::run_migrations, prompt_delivery::*};
use rusqlite::{params, Connection};
use std::path::PathBuf;

fn test_db() -> (PathBuf, Connection) {
    let temp = temp_dir(&format!("prompt-delivery-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&temp).unwrap();
    let db = Connection::open(temp.join("test.sqlite3")).unwrap();
    run_migrations(&db).unwrap();
    db.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at)
         VALUES ('project', 'Prompt delivery', ?1, 'now', 'now')",
        params![temp.to_string_lossy().to_string()],
    )
    .unwrap();
    db.execute(
        "INSERT INTO sessions
         (id, node_id, adapter_id, command_json, cwd, status, created_at, updated_at)
         VALUES ('session', 'node', 'codex', '[]', ?1, 'running', 'now', 'now')",
        params![temp.to_string_lossy().to_string()],
    )
    .unwrap();
    (temp, db)
}

fn request(id: &str) -> SubmitPromptDeliveryRequest {
    SubmitPromptDeliveryRequest {
        client_prompt_id: id.to_string(),
        session_id: "session".to_string(),
        mode: "auto".to_string(),
        payload: PromptDeliveryPayload {
            prompt: "hello".to_string(),
            history_text: "hello".to_string(),
            image_paths: vec![],
            provider: None,
            model: None,
            thinking: None,
            approval_policy: None,
            sandbox: None,
        },
    }
}

#[test]
fn submission_is_idempotent_and_content_bound() {
    let (_temp, db) = test_db();
    let id = uuid::Uuid::now_v7().to_string();
    let first = submit_prompt_delivery(&db, &request(&id)).unwrap();
    let replay = submit_prompt_delivery(&db, &request(&id)).unwrap();
    assert_eq!(first, replay);

    let mut changed = request(&id);
    changed.payload.prompt = "different".to_string();
    assert!(submit_prompt_delivery(&db, &changed)
        .unwrap_err()
        .to_string()
        .contains("different content"));
}

#[test]
fn delivery_lifecycle_preserves_ambiguous_dispatches() {
    let (_temp, db) = test_db();
    let id = uuid::Uuid::now_v7().to_string();
    submit_prompt_delivery(&db, &request(&id)).unwrap();
    let claimed = claim_next_prompt_delivery(&db, "session").unwrap().unwrap();
    assert_eq!(claimed.state, "dispatching");

    recover_prompt_deliveries(&db).unwrap();
    let recovered = load_prompt_delivery(&db, &id).unwrap().unwrap();
    assert_eq!(recovered.state, "indeterminate");
    assert_eq!(
        recovered.error_code.as_deref(),
        Some("interrupted_dispatch")
    );

    retry_prompt_delivery(&db, &id).unwrap();
    let claimed = claim_next_prompt_delivery(&db, "session").unwrap().unwrap();
    complete_prompt_delivery(&db, &claimed.id).unwrap();
    let delivered = load_prompt_delivery(&db, &id).unwrap().unwrap();
    assert_eq!(delivered.state, "delivered");
    assert_eq!(delivered.payload.unwrap().prompt, "hello");
}

#[test]
fn queued_prompts_can_be_edited_and_canceled() {
    let (_temp, db) = test_db();
    let id = uuid::Uuid::now_v7().to_string();
    submit_prompt_delivery(&db, &request(&id)).unwrap();
    let mut edited_payload = request(&id).payload;
    edited_payload.prompt = "edited".to_string();
    let edited = edit_prompt_delivery(&db, &id, &edited_payload).unwrap();
    assert_eq!(edited.revision, 2);
    assert_eq!(edited.payload.unwrap().prompt, "edited");
    let canceled = cancel_prompt_delivery(&db, &id).unwrap();
    assert_eq!(canceled.state, "canceled");
}

#[test]
fn an_unresolved_earlier_prompt_blocks_later_delivery() {
    let (_temp, db) = test_db();
    let first_id = uuid::Uuid::now_v7().to_string();
    let second_id = uuid::Uuid::now_v7().to_string();
    submit_prompt_delivery(&db, &request(&first_id)).unwrap();
    submit_prompt_delivery(&db, &request(&second_id)).unwrap();
    claim_next_prompt_delivery(&db, "session").unwrap().unwrap();
    settle_prompt_delivery_error(&db, &first_id, "failed", "failed", "failed").unwrap();
    assert!(claim_next_prompt_delivery(&db, "session")
        .unwrap()
        .is_none());
    cancel_prompt_delivery(&db, &first_id).unwrap();
    assert_eq!(
        claim_next_prompt_delivery(&db, "session")
            .unwrap()
            .unwrap()
            .id,
        second_id
    );
}
