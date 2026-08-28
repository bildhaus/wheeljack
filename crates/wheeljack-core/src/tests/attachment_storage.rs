use super::support::temp_dir;
use crate::*;

#[test]
fn attachment_gc_preserves_durable_node_and_transcript_references() {
    let app_data = temp_dir(&format!("attachment-gc-{}", Uuid::now_v7()));
    let attachment_dir = app_data.join("attachments");
    fs::create_dir_all(&attachment_dir).unwrap();
    let node_image = attachment_dir.join("node.png");
    let history_image = attachment_dir.join("history.png");
    let unused_image = attachment_dir.join("unused.png");
    fs::write(&node_image, b"node").unwrap();
    fs::write(&history_image, b"history").unwrap();
    fs::write(&unused_image, b"unused").unwrap();

    let db = Connection::open_in_memory().unwrap();
    run_migrations(&db).unwrap();
    let timestamp = now();
    db.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('project', 'Project', ?1, ?2, ?2)",
        params![app_data.to_string_lossy().to_string(), timestamp],
    ).unwrap();
    db.execute(
        "INSERT INTO canvases (id, project_id, name, camera_json, created_at, updated_at) VALUES ('canvas', 'project', 'Canvas', '{}', ?1, ?1)",
        params![timestamp],
    ).unwrap();
    db.execute(
        "INSERT INTO nodes (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
         VALUES ('node', 'canvas', 'agent_terminal', 'Agent', 0, 0, 1, 1, 0, ?1, ?2, ?2)",
        params![json!({ "draftImages": [{ "path": node_image }] }).to_string(), timestamp],
    ).unwrap();
    db.execute(
        "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, created_at, updated_at)
         VALUES ('session', 'node', 'test', '[]', ?1, 'completed', ?2, ?2)",
        params![app_data.to_string_lossy().to_string(), timestamp],
    ).unwrap();
    db.execute(
        "INSERT INTO session_chunks (session_id, seq, stream, data, created_at) VALUES ('session', 1, 'agent-input', ?1, ?2)",
        params![json!({ "type": "wheeljack_user_message", "images": [{ "path": history_image }] }).to_string().into_bytes(), timestamp],
    ).unwrap();

    let status = gc_image_attachments(&db, &app_data).unwrap();
    assert_eq!(status.removed_count, 1);
    assert_eq!(status.referenced_count, 2);
    assert!(node_image.exists());
    assert!(history_image.exists());
    assert!(!unused_image.exists());

    fs::remove_dir_all(app_data).unwrap();
}

#[test]
fn attachment_gc_keeps_retryable_prompt_delivery_images() {
    let app_data = temp_dir(&format!("attachment-delivery-gc-{}", Uuid::now_v7()));
    let attachment_dir = app_data.join("attachments");
    fs::create_dir_all(&attachment_dir).unwrap();
    let queued_image = attachment_dir.join("queued.png");
    fs::write(&queued_image, b"queued").unwrap();

    let db = Connection::open_in_memory().unwrap();
    run_migrations(&db).unwrap();
    let timestamp = now();
    db.execute(
        "INSERT INTO sessions (id, node_id, adapter_id, command_json, cwd, status, created_at, updated_at)
         VALUES ('session', 'node', 'test', '[]', ?1, 'running', ?2, ?2)",
        params![app_data.to_string_lossy().to_string(), timestamp],
    ).unwrap();
    db.execute(
        "INSERT INTO session_prompt_deliveries (id, session_id, seq, mode, state, payload_json, created_at, updated_at)
         VALUES ('delivery', 'session', 1, 'follow_up', 'failed', ?1, ?2, ?2)",
        params![json!({ "imagePaths": [queued_image] }).to_string(), timestamp],
    ).unwrap();

    let status = gc_image_attachments(&db, &app_data).unwrap();
    assert_eq!(status.removed_count, 0);
    assert_eq!(status.referenced_count, 1);
    assert!(queued_image.exists());

    fs::remove_dir_all(app_data).unwrap();
}
