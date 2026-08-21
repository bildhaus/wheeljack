use crate::{bots::*, *};

fn bot_input(id: &str, scope: &str, project_id: Option<&str>, name: &str) -> BotProfileInput {
    BotProfileInput {
        id: Some(id.to_string()),
        scope: scope.to_string(),
        project_id: project_id.map(str::to_string),
        name: name.to_string(),
        role_description: format!("Standing role for {name}"),
        avatar_seed: Some(format!("avatar_{id}")),
        launch: BotLaunchDto {
            adapter_id: "claude-code".to_string(),
            provider: None,
            model: Some("sonnet".to_string()),
            thinking: Some("medium".to_string()),
        },
    }
}

fn bot_db() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.pragma_update(None, "foreign_keys", "ON").unwrap();
    run_migrations(&db).unwrap();
    db.execute_batch(
        "INSERT INTO projects (id, name, path, created_at, updated_at)
           VALUES ('project_one', 'One', 'one', 'now', 'now'),
                  ('project_two', 'Two', 'two', 'now', 'now');
         INSERT INTO canvases (id, project_id, name, camera_json, created_at, updated_at)
           VALUES ('canvas_one', 'project_one', 'Main', '{}', 'now', 'now');",
    )
    .unwrap();
    db
}

#[test]
fn bots_are_visible_by_scope_and_keep_launch_statistics() {
    let db = bot_db();
    let global = upsert_bot(
        &db,
        BotUpsertRequest {
            bot: bot_input("global", "global", None, "Navigator"),
            record_launch: false,
        },
    )
    .unwrap();
    let project = upsert_bot(
        &db,
        BotUpsertRequest {
            bot: bot_input("project", "project", Some("project_one"), "Verifier"),
            record_launch: false,
        },
    )
    .unwrap();
    upsert_bot(
        &db,
        BotUpsertRequest {
            bot: bot_input("other", "project", Some("project_two"), "Historian"),
            record_launch: false,
        },
    )
    .unwrap();

    let project_one = list_bots(&db, Some("project_one")).unwrap();
    assert_eq!(project_one.len(), 2);
    assert!(project_one.iter().any(|profile| profile.id == global.id));
    assert!(project_one.iter().any(|profile| profile.id == project.id));
    let no_project = list_bots(&db, None).unwrap();
    assert_eq!(no_project.len(), 1);
    assert_eq!(no_project[0].id, global.id);

    let launched = upsert_bot(
        &db,
        BotUpsertRequest {
            bot: bot_input("project", "project", Some("project_one"), "Verifier"),
            record_launch: true,
        },
    )
    .unwrap();
    assert_eq!(launched.launch_count, 1);
    assert!(launched.last_used_at.is_some());
}

#[test]
fn bots_enforce_uniqueness_limits_and_project_cascade() {
    let db = bot_db();
    upsert_bot(
        &db,
        BotUpsertRequest {
            bot: bot_input("first", "project", Some("project_one"), "Verifier"),
            record_launch: false,
        },
    )
    .unwrap();
    let duplicate = upsert_bot(
        &db,
        BotUpsertRequest {
            bot: bot_input("duplicate", "project", Some("project_one"), "verifier"),
            record_launch: false,
        },
    )
    .unwrap_err();
    assert!(duplicate.to_string().contains("already exists"));

    for index in 1..32 {
        upsert_bot(
            &db,
            BotUpsertRequest {
                bot: bot_input(
                    &format!("profile_{index}"),
                    "project",
                    Some("project_one"),
                    &format!("Profile {index}"),
                ),
                record_launch: false,
            },
        )
        .unwrap();
    }
    let limit = upsert_bot(
        &db,
        BotUpsertRequest {
            bot: bot_input("overflow", "project", Some("project_one"), "Overflow"),
            record_launch: false,
        },
    )
    .unwrap_err();
    assert!(limit.to_string().contains("32 bots"));

    db.execute("DELETE FROM projects WHERE id = 'project_one'", [])
        .unwrap();
    let remaining: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM bot_profiles WHERE project_id = 'project_one'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(remaining, 0);
}

#[test]
fn deleting_a_profile_does_not_mutate_a_running_node_snapshot() {
    let db = bot_db();
    upsert_bot(
        &db,
        BotUpsertRequest {
            bot: bot_input("active", "project", Some("project_one"), "Builder"),
            record_launch: false,
        },
    )
    .unwrap();
    let snapshot = json!({
        "botSnapshot": {
            "profileId": "active",
            "source": "saved",
            "name": "Builder",
            "roleDescription": "Standing role for Builder",
            "avatarSeed": "avatar_active",
            "launch": { "adapterId": "claude-code", "model": "sonnet", "thinking": "medium" }
        }
    });
    db.execute(
        "INSERT INTO nodes
           (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
         VALUES ('node_active', 'canvas_one', 'agent_terminal', 'Builder', 0, 0, 640, 320, 1, ?1, 'now', 'now')",
        [snapshot.to_string()],
    )
    .unwrap();

    assert!(delete_bot(&db, "active").unwrap());
    let stored: String = db
        .query_row(
            "SELECT data_json FROM nodes WHERE id = 'node_active'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(serde_json::from_str::<Value>(&stored).unwrap(), snapshot);
}
