use super::support::*;
use crate::*;

#[test]
fn project_documents_import_normalize_and_reject_stale_writes() {
    let root = temp_dir("project-documents");
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("KANBAN.md"),
        "---\nkanban-plugin: board\n---\n\n## In Progress\n- [ ] Ship import\n  Keep the files authoritative.\n\n## Pre-Deploy Blockers\n- [ ] Prove conflicts\n\n## Done\n- [x] Pick filenames\n",
    )
    .unwrap();
    fs::write(root.join("PRD.md"), "# Existing PRD\n").unwrap();

    let core = Core::new(test_init("project-documents"), Arc::new(NullEventSink)).unwrap();
    let read: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "read",
                "command": "project_documents_read",
                "payload": {"projectPath": root}
            })
            .to_string(),
        ),
    )
    .unwrap();
    let kanban = &read["payload"]["documents"]["kanban"];
    assert_eq!(kanban["format"], "importable");
    assert_eq!(kanban["board"]["columns"][0]["role"], "active");
    assert_eq!(kanban["board"]["columns"][1]["role"], "review");
    assert_eq!(kanban["board"]["columns"][2]["role"], "done");
    assert_eq!(
        kanban["board"]["cards"][0]["detail"],
        "Keep the files authoritative."
    );
    assert_eq!(kanban["board"]["cards"][0]["reviewPolicy"], "agent");
    assert_eq!(read["payload"]["documents"]["tdd"]["revision"], "missing");

    let request = json!({
        "projectPath": root,
        "writes": [{
            "kind": "kanban",
            "content": kanban["content"],
            "expectedRevision": kanban["revision"]
        }]
    });
    let preview: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "preview",
                "command": "project_documents_preview_write",
                "payload": request
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert!(preview["payload"]["diff"]
        .as_str()
        .unwrap()
        .contains("wheeljack-kanban: 1"));

    let mut commit = request.clone();
    commit["confirmationToken"] = preview["payload"]["confirmationToken"].clone();
    let committed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "commit",
                "command": "project_documents_commit_write",
                "payload": commit
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(
        committed["payload"]["documents"]["kanban"]["format"],
        "wheeljack-v1"
    );

    let stale: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "stale",
                "command": "project_documents_preview_write",
                "payload": request
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(stale["ok"], false);
    assert!(stale["error"]["message"]
        .as_str()
        .unwrap()
        .contains("changed on disk"));
}

#[test]
fn project_document_confirmation_is_single_use() {
    let root = temp_dir("project-document-token");
    fs::create_dir_all(&root).unwrap();
    let core = Core::new(test_init("project-document-token"), Arc::new(NullEventSink)).unwrap();
    let request = json!({
        "projectPath": root,
        "writes": [{
            "kind": "prd",
            "content": "# Product\n",
            "expectedRevision": "missing"
        }]
    });
    let preview: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "preview",
                "command": "project_documents_preview_write",
                "payload": request
            })
            .to_string(),
        ),
    )
    .unwrap();
    let mut commit = request.clone();
    commit["confirmationToken"] = preview["payload"]["confirmationToken"].clone();
    let first: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "first",
                "command": "project_documents_commit_write",
                "payload": commit
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(first["ok"], true);
    let second: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "second",
                "command": "project_documents_commit_write",
                "payload": commit
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(second["ok"], false);
    assert!(second["error"]["message"]
        .as_str()
        .unwrap()
        .contains("invalid or already used"));
}

#[test]
fn project_documents_require_exact_root_filenames() {
    let root = temp_dir("project-document-case");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("prd.md"), "# Wrong case\n").unwrap();
    let core = Core::new(test_init("project-document-case"), Arc::new(NullEventSink)).unwrap();
    let read: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "read",
                "command": "project_documents_read",
                "payload": {"projectPath": root}
            })
            .to_string(),
        ),
    )
    .unwrap();

    assert_eq!(read["payload"]["documents"]["prd"]["exists"], false);
    assert!(read["payload"]["documents"]["prd"]["warnings"][0]
        .as_str()
        .unwrap()
        .contains("rename it to PRD.md"));
}

#[test]
fn project_documents_are_locally_excluded_and_warn_when_tracked() {
    let repo = temp_dir("project-document-exclude");
    let root = repo.join("nested [local]");
    fs::create_dir_all(&root).unwrap();
    run_git(&repo, ["init"]).unwrap();
    fs::write(root.join("PRD.md"), "# Tracked by mistake\n").unwrap();
    run_git(&repo, ["add", "--", ":(literal)nested [local]/PRD.md"]).unwrap();

    let core = Core::new(
        test_init("project-document-exclude-core"),
        Arc::new(NullEventSink),
    )
    .unwrap();
    let read: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "read",
                "command": "project_documents_read",
                "payload": {"projectPath": root}
            })
            .to_string(),
        ),
    )
    .unwrap();

    let exclude_path = repo.join(".git").join("info").join("exclude");
    let exclude = fs::read_to_string(&exclude_path).unwrap_or_default();
    for name in ["KANBAN.md", "PRD.md", "TDD.md"] {
        assert!(!exclude
            .lines()
            .any(|line| line == format!("/nested \\[local]/{}", name)));
    }
    assert!(read["payload"]["documents"]["prd"]["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|warning| warning.as_str().unwrap().contains("tracked by Git")));

    let request = json!({
        "projectPath": root,
        "writes": [{
            "kind": "prd",
            "content": "# Updated PRD\n",
            "expectedRevision": read["payload"]["documents"]["prd"]["revision"]
        }]
    });
    let preview: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "preview",
                "command": "project_documents_preview_write",
                "payload": request
            })
            .to_string(),
        ),
    )
    .unwrap();
    let mut commit = request;
    commit["confirmationToken"] = preview["payload"]["confirmationToken"].clone();
    let committed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "commit",
                "command": "project_documents_commit_write",
                "payload": commit
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(committed["ok"], true);

    let exclude = fs::read_to_string(exclude_path).unwrap();
    for name in ["KANBAN.md", "PRD.md", "TDD.md"] {
        assert!(exclude
            .lines()
            .any(|line| line == format!("/nested \\[local]/{}", name)));
        run_git(
            &repo,
            [
                "check-ignore",
                "--quiet",
                "--no-index",
                &format!("nested [local]/{name}"),
            ],
        )
        .unwrap();
    }
}

#[test]
fn project_document_column_roles_cover_common_headings() {
    let board = crate::project_documents::parse_kanban(
        "## Backlog\n\n- Starter task\n\n## Building\n\n## QA\n\n## Shipped\n",
    );
    assert_eq!(
        board
            .columns
            .iter()
            .map(|column| column.role.as_str())
            .collect::<Vec<_>>(),
        ["queued", "active", "review", "done"]
    );
    assert_eq!(board.cards[0].title, "Starter task");
}

#[test]
fn project_document_task_contracts_round_trip_in_kanban_metadata() {
    let board = crate::project_documents::parse_kanban(
        "## Ready\n<!-- wheeljack:column {\"id\":\"ready\",\"role\":\"queued\"} -->\n\n- [ ] Ship contracts\n  <!-- wheeljack:task {\"id\":\"task-contract\",\"priority\":\"high\",\"assignee\":\"Unassigned\",\"definitionOfDone\":\"Contract persists\",\"constraints\":\"Keep v1 compatible\",\"verificationCommand\":\"cargo test\",\"reviewPolicy\":\"agent\"} -->\n",
    );
    let card = &board.cards[0];
    assert_eq!(card.definition_of_done, "Contract persists");
    assert_eq!(card.constraints, "Keep v1 compatible");
    assert_eq!(card.verification_command, "cargo test");
    assert_eq!(card.review_policy, "agent");

    let rendered = crate::project_documents::render_kanban(&board);
    let reparsed = crate::project_documents::parse_kanban(&rendered);
    assert_eq!(reparsed.cards[0].definition_of_done, "Contract persists");
    assert_eq!(reparsed.cards[0].verification_command, "cargo test");
}
