use super::support::*;
use crate::*;

#[test]
fn split_launch_command_matches_reference_quotes_and_escapes() {
    let parts = split_launch_command(
            r#""C:\Program Files\Agent\agent.exe" --model "fast mode" --name "a \"quoted\" value" --path "C:\\tools""#,
        )
        .unwrap();

    assert_eq!(
        parts,
        vec![
            r#"C:\Program Files\Agent\agent.exe"#,
            "--model",
            "fast mode",
            "--name",
            r#"a "quoted" value"#,
            "--path",
            r#"C:\tools"#,
        ]
    );
    assert!(split_launch_command(r#""unterminated"#).is_err());
    assert_eq!(
        split_launch_command(r#"agent --prompt 'review this code'"#).unwrap(),
        vec!["agent", "--prompt", "review this code"]
    );
}

#[test]
fn resolve_optional_cwd_matches_reference_home_behavior() {
    let home = normalize_command_cwd(home_dir().unwrap().canonicalize().unwrap());

    assert_eq!(resolve_optional_cwd(None).unwrap(), home);
    assert_eq!(resolve_optional_cwd(Some("")).unwrap(), home);
    assert_eq!(resolve_optional_cwd(Some("~")).unwrap(), home);
    assert!(resolve_optional_cwd(Some("~/definitely/missing/wheeljack/path")).is_err());
}

#[test]
fn expand_home_path_matches_reference_known_folder_aliases() {
    let home = home_dir().unwrap();

    assert_eq!(
        expand_home_path("docs/dev"),
        home.join("Documents").join("dev")
    );
    assert_eq!(
        expand_home_path("downloads/logs"),
        home.join("Downloads").join("logs")
    );
    assert!(known_home_folder_path(r"\\documents\share").is_none());
}

#[test]
#[cfg(windows)]
fn expand_home_path_matches_reference_leading_slash_aliases_on_windows() {
    let home = home_dir().unwrap();

    assert_eq!(
        expand_home_path("/documents/dev"),
        home.join("Documents").join("dev")
    );
}

#[test]
fn resolve_workspace_folder_path_trims_and_expands_home_aliases() {
    let home = normalize_command_cwd(home_dir().unwrap().canonicalize().unwrap());
    let resolved = resolve_workspace_folder_path(" ~ ").unwrap();

    assert_eq!(resolved, home);
    assert!(resolve_workspace_folder_path(" ").is_err());
    assert!(resolve_workspace_folder_path("~/definitely/missing/wheeljack/path").is_err());
}

#[cfg(unix)]
#[test]
fn paths_equivalent_resolves_symlinked_parent_of_a_missing_path() {
    use std::os::unix::fs::symlink;

    let root = temp_dir("missing-path-alias");
    let real = root.join("real");
    let alias = root.join("alias");
    fs::create_dir_all(&real).unwrap();
    symlink(&real, &alias).unwrap();

    assert!(paths_equivalent(
        &real.join("missing-worktree"),
        &alias.join("missing-worktree")
    ));
}

#[test]
fn git_status_and_worktree_roundtrip() {
    let repo = temp_dir("git-repo");
    fs::create_dir_all(&repo).unwrap();
    run_git(&repo, ["init"]).unwrap();
    run_git(&repo, ["config", "user.email", "wheeljack@example.test"]).unwrap();
    run_git(&repo, ["config", "user.name", "wheeljack test"]).unwrap();
    fs::write(repo.join("README.md"), "native git").unwrap();
    run_git(&repo, ["add", "."]).unwrap();
    run_git(&repo, ["commit", "-m", "init"]).unwrap();

    let core = Core::new(test_init("git"), Arc::new(NullEventSink)).expect("core");
    let status_request = json!({
        "id": "status",
        "command": "git_status",
        "payload": { "path": repo }
    });
    let status: Value = serde_json::from_str(&core.call_json(&status_request.to_string())).unwrap();
    assert_eq!(status["payload"]["isRepo"], true);
    assert_eq!(status["payload"]["dirty"], false);

    fs::write(repo.join("README.md"), "native git changed").unwrap();
    let dirty: Value = serde_json::from_str(&core.call_json(&status_request.to_string())).unwrap();
    assert_eq!(dirty["payload"]["dirty"], true);
    let diff: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "diff",
                "command": "git_diff",
                "payload": { "path": repo }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(diff["payload"]["isRepo"], true);
    assert_eq!(diff["payload"]["truncated"], false);
    assert!(diff["payload"]["text"]
        .as_str()
        .unwrap()
        .contains("native git changed"));
    run_git(&repo, ["checkout", "--", "README.md"]).unwrap();

    let worktree = repo.with_file_name(format!(
        "{}-native-parity",
        repo.file_name().unwrap().to_string_lossy()
    ));
    let create = json!({
        "id": "create",
        "command": "git_worktree_create",
        "payload": {
            "projectPath": repo,
            "branchName": "wheeljack/native-parity",
            "worktreePath": worktree
        }
    });
    let created: Value = serde_json::from_str(&core.call_json(&create.to_string())).unwrap();
    assert_eq!(created["ok"], true);
    assert_eq!(
        created["payload"]["worktree"]["branch"],
        "wheeljack/native-parity"
    );

    let remove = json!({
        "id": "remove",
        "command": "git_worktree_remove",
        "payload": {
            "projectPath": repo,
            "worktreePath": created["payload"]["worktree"]["path"].as_str().unwrap()
        }
    });
    let removed: Value = serde_json::from_str(&core.call_json(&remove.to_string())).unwrap();
    assert_eq!(removed["ok"], true);
}

#[test]
fn git_worktree_remove_refuses_current_primary_and_dirty_worktrees() {
    let repo = temp_dir("git-safety");
    fs::create_dir_all(&repo).unwrap();
    run_git(&repo, ["init"]).unwrap();
    run_git(&repo, ["config", "user.email", "wheeljack@example.test"]).unwrap();
    run_git(&repo, ["config", "user.name", "wheeljack test"]).unwrap();
    fs::write(repo.join("README.md"), "native git").unwrap();
    run_git(&repo, ["add", "."]).unwrap();
    run_git(&repo, ["commit", "-m", "init"]).unwrap();

    let worktree = repo.with_file_name(format!(
        "{}-linked",
        repo.file_name().unwrap().to_string_lossy()
    ));
    run_git(
        &repo,
        [
            "worktree",
            "add",
            "-b",
            "wheeljack-native-safety",
            worktree.to_str().unwrap(),
        ],
    )
    .unwrap();

    let core = Core::new(test_init("git-safety-core"), Arc::new(NullEventSink)).unwrap();
    let current = json!({
        "id": "current",
        "command": "git_worktree_remove",
        "payload": {
            "projectPath": repo,
            "worktreePath": repo
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&current.to_string())).unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("currently opened project worktree"));

    let primary = json!({
        "id": "primary",
        "command": "git_worktree_remove",
        "payload": {
            "projectPath": worktree,
            "worktreePath": repo
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&primary.to_string())).unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("primary git worktree"));

    let wrong_branch = json!({
        "id": "wrong-branch",
        "command": "git_worktree_remove",
        "payload": {
            "projectPath": repo,
            "worktreePath": worktree,
            "expectedBranch": "wheeljack/wrong-branch"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&wrong_branch.to_string())).unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("branch mismatch"));

    fs::write(worktree.join("untracked.txt"), "untracked").unwrap();
    let untracked = json!({
        "id": "untracked",
        "command": "git_worktree_remove",
        "payload": {
            "projectPath": repo,
            "worktreePath": worktree,
            "expectedBranch": "wheeljack-native-safety"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&untracked.to_string())).unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("local changes"));
    fs::remove_file(worktree.join("untracked.txt")).unwrap();

    fs::write(worktree.join("README.md"), "native git dirty").unwrap();
    let dirty = json!({
        "id": "dirty",
        "command": "git_worktree_remove",
        "payload": {
            "projectPath": repo,
            "worktreePath": worktree
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&dirty.to_string())).unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("local changes"));

    run_git(&worktree, ["checkout", "--", "README.md"]).unwrap();
    let clean = json!({
        "id": "clean",
        "command": "git_worktree_remove",
        "payload": {
            "projectPath": repo,
            "worktreePath": worktree,
            "expectedBranch": "wheeljack-native-safety"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&clean.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert!(git_succeeds(
        &repo,
        [
            "rev-parse",
            "--verify",
            "refs/heads/wheeljack-native-safety"
        ]
    ));
}

#[test]
fn git_worktree_remove_prunes_a_registered_missing_worktree() {
    let repo = committed_repo("git-stale-worktree");
    let worktree = repo.with_file_name(format!(
        "{}-linked",
        repo.file_name().unwrap().to_string_lossy()
    ));
    run_git(
        &repo,
        [
            "worktree",
            "add",
            "-b",
            "wheeljack-stale-worktree",
            worktree.to_str().unwrap(),
        ],
    )
    .unwrap();
    fs::remove_dir_all(&worktree).unwrap();

    let core = Core::new(
        test_init("git-stale-worktree-core"),
        Arc::new(NullEventSink),
    )
    .unwrap();
    let wrong_branch = json!({
        "id": "remove-stale-wrong-branch",
        "command": "git_worktree_remove",
        "payload": {
            "projectPath": repo,
            "worktreePath": worktree,
            "expectedBranch": "wheeljack-wrong-stale-worktree"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&wrong_branch.to_string())).unwrap();
    assert_eq!(response["ok"], false, "{response:#}");
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("branch mismatch"));

    let remove = json!({
        "id": "remove-stale",
        "command": "git_worktree_remove",
        "payload": {
            "projectPath": repo,
            "worktreePath": worktree,
            "expectedBranch": "wheeljack-stale-worktree"
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&remove.to_string())).unwrap();
    assert_eq!(response["ok"], true, "{response:#}");
    assert!(git_succeeds(
        &repo,
        [
            "rev-parse",
            "--verify",
            "refs/heads/wheeljack-stale-worktree"
        ]
    ));
    assert!(!read_worktrees(&repo)
        .iter()
        .any(|candidate| paths_equivalent(Path::new(&candidate.path), &worktree)));
}

#[test]
fn git_worktree_remove_only_drops_the_requested_stale_registration() {
    let repo = committed_repo("git-two-stale-worktrees");
    let first = repo.with_file_name(format!(
        "{}-first",
        repo.file_name().unwrap().to_string_lossy()
    ));
    let second = repo.with_file_name(format!(
        "{}-second",
        repo.file_name().unwrap().to_string_lossy()
    ));
    run_git(
        &repo,
        [
            "worktree",
            "add",
            "-b",
            "wheeljack-stale-first",
            first.to_str().unwrap(),
        ],
    )
    .unwrap();
    run_git(
        &repo,
        [
            "worktree",
            "add",
            "-b",
            "wheeljack-stale-second",
            second.to_str().unwrap(),
        ],
    )
    .unwrap();
    fs::remove_dir_all(&first).unwrap();
    fs::remove_dir_all(&second).unwrap();

    run_git_worktree_remove(&repo, &first).unwrap();
    let remaining = read_worktrees(&repo);
    assert!(!remaining
        .iter()
        .any(|candidate| paths_equivalent(Path::new(&candidate.path), &first)));
    assert!(remaining
        .iter()
        .any(|candidate| paths_equivalent(Path::new(&candidate.path), &second)));

    run_git_worktree_remove(&repo, &second).unwrap();
}

#[test]
fn git_task_worktree_uses_repo_root_nested_cwd_and_source_head() {
    let repo = committed_repo("git-task-nested");
    let nested = repo.join("apps").join("desktop");
    fs::create_dir_all(&nested).unwrap();
    fs::write(nested.join("app.txt"), "nested project").unwrap();
    run_git(&repo, ["add", "."]).unwrap();
    run_git(&repo, ["commit", "-m", "nested project"]).unwrap();
    let base_commit = git_text(&repo, ["rev-parse", "HEAD"]);
    let task_id = "parent:child/über";
    let digest = format!("{:x}", Sha256::digest(task_id.as_bytes()));
    let expected_branch = format!("wheeljack/task-{}", &digest[..20]);

    let core = Core::new(test_init("git-task-nested-core"), Arc::new(NullEventSink)).unwrap();
    let created: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "create-task",
                "command": "git_worktree_create",
                "payload": {
                    "projectPath": nested,
                    "taskId": task_id
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(created["ok"], true);
    assert_eq!(created["payload"]["worktree"]["branch"], expected_branch);
    assert_eq!(created["payload"]["baseCommit"], base_commit);
    assert_eq!(created["payload"]["worktree"]["head"], base_commit);
    let worktree = PathBuf::from(created["payload"]["worktree"]["path"].as_str().unwrap());
    let cwd = PathBuf::from(created["payload"]["cwd"].as_str().unwrap());
    assert!(paths_equivalent(
        &cwd,
        &worktree.join("apps").join("desktop")
    ));
    assert_eq!(
        fs::read_to_string(cwd.join("app.txt")).unwrap(),
        "nested project"
    );

    let removed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "remove-task",
                "command": "git_worktree_remove",
                "payload": {
                    "projectPath": repo,
                    "worktreePath": worktree,
                    "expectedBranch": expected_branch
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(removed["ok"], true);
}

#[test]
fn git_worktree_review_captures_full_lane_without_touching_real_index() {
    let repo = committed_repo("git-task-review");
    for name in ["committed.txt", "staged.txt", "unstaged.txt"] {
        fs::write(repo.join(name), format!("base {name}\n")).unwrap();
    }
    fs::write(repo.join(".gitignore"), "*.tmp\n").unwrap();
    run_git(&repo, ["add", "."]).unwrap();
    run_git(&repo, ["commit", "-m", "review base"]).unwrap();

    let core = Core::new(test_init("git-task-review-core"), Arc::new(NullEventSink)).unwrap();
    let created: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "create-review",
                "command": "git_worktree_create",
                "payload": {
                    "projectPath": repo,
                    "taskId": "review:complete"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(created["ok"], true);
    let worktree = PathBuf::from(created["payload"]["worktree"]["path"].as_str().unwrap());
    let branch = created["payload"]["worktree"]["branch"]
        .as_str()
        .unwrap()
        .to_string();
    let base_commit = created["payload"]["baseCommit"]
        .as_str()
        .unwrap()
        .to_string();

    fs::write(repo.join("main-only.txt"), "primary checkout only\n").unwrap();
    fs::write(worktree.join("committed.txt"), "committed lane change\n").unwrap();
    run_git(&worktree, ["add", "committed.txt"]).unwrap();
    run_git(&worktree, ["commit", "-m", "task commit"]).unwrap();
    fs::write(worktree.join("staged.txt"), "staged lane change\n").unwrap();
    run_git(&worktree, ["add", "staged.txt"]).unwrap();
    fs::write(worktree.join("unstaged.txt"), "unstaged lane change\n").unwrap();
    fs::write(worktree.join("untracked.txt"), "untracked lane change\n").unwrap();
    fs::write(worktree.join("ignored.tmp"), "ignored lane change\n").unwrap();
    let status_before = git_text(
        &worktree,
        ["status", "--porcelain=v1", "--untracked-files=all"],
    );
    let staged_before = git_text(&worktree, ["diff", "--cached", "--name-only"]);

    let review: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "review",
                "command": "git_worktree_review",
                "payload": {
                    "projectPath": repo,
                    "worktreePath": worktree,
                    "expectedBranch": branch,
                    "baseCommit": base_commit
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(review["ok"], true);
    assert_eq!(review["payload"]["branch"], branch);
    assert_eq!(review["payload"]["baseCommit"], base_commit);
    assert!(matches!(
        review["payload"]["snapshotId"].as_str().unwrap().len(),
        40 | 64
    ));
    assert_eq!(
        review["payload"]["headCommit"],
        git_text(&worktree, ["rev-parse", "HEAD"])
    );
    let changed_files = review["payload"]["changedFiles"].as_array().unwrap();
    for name in [
        "committed.txt",
        "staged.txt",
        "unstaged.txt",
        "untracked.txt",
    ] {
        assert!(changed_files.iter().any(|value| value == name), "{name}");
    }
    assert!(!changed_files.iter().any(|value| value == "ignored.tmp"));
    let text = review["payload"]["text"].as_str().unwrap();
    for marker in [
        "committed lane change",
        "staged lane change",
        "unstaged lane change",
        "untracked lane change",
    ] {
        assert!(text.contains(marker), "{marker}");
    }
    assert!(!text.contains("primary checkout only"));
    assert_eq!(
        git_text(
            &worktree,
            ["status", "--porcelain=v1", "--untracked-files=all"]
        ),
        status_before
    );
    assert_eq!(
        git_text(&worktree, ["diff", "--cached", "--name-only"]),
        staged_before
    );

    run_git(&worktree, ["reset", "--hard", "HEAD"]).unwrap();
    run_git(&worktree, ["clean", "-fdx"]).unwrap();
    let removed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "remove-review",
                "command": "git_worktree_remove",
                "payload": {
                    "projectPath": repo,
                    "worktreePath": worktree,
                    "expectedBranch": branch
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(removed["ok"], true);
    fs::remove_file(repo.join("main-only.txt")).unwrap();
}

#[test]
fn git_worktree_snapshot_changes_beyond_the_truncated_diff() {
    let repo = committed_repo("git-task-snapshot-truncation");
    let base_commit = git_text(&repo, ["rev-parse", "HEAD"]);
    let branch = git_text(&repo, ["branch", "--show-current"]);
    fs::write(repo.join("a-large.txt"), "unchanged\n".repeat(30_000)).unwrap();
    fs::write(repo.join("z-hidden.txt"), "first\n").unwrap();
    let core = Core::new(
        test_init("git-task-snapshot-truncation-core"),
        Arc::new(NullEventSink),
    )
    .unwrap();
    let review = || {
        serde_json::from_str::<Value>(
            &core.call_json(
                &json!({
                    "id": "review-truncated",
                    "command": "git_worktree_review",
                    "payload": {
                        "projectPath": repo,
                        "worktreePath": repo,
                        "expectedBranch": branch,
                        "baseCommit": base_commit
                    }
                })
                .to_string(),
            ),
        )
        .unwrap()
    };

    let first = review();
    assert_eq!(first["ok"], true);
    assert_eq!(first["payload"]["truncated"], true);
    fs::write(repo.join("z-hidden.txt"), "second\n").unwrap();
    let second = review();
    assert_eq!(second["ok"], true);
    assert_eq!(second["payload"]["truncated"], true);

    assert_eq!(first["payload"]["text"], second["payload"]["text"]);
    assert_ne!(
        first["payload"]["snapshotId"],
        second["payload"]["snapshotId"]
    );
}

#[test]
fn git_task_worktree_rejects_unborn_and_creation_collisions() {
    let unborn = temp_dir("git-task-unborn");
    fs::create_dir_all(&unborn).unwrap();
    run_git(&unborn, ["init"]).unwrap();
    let core = Core::new(test_init("git-task-errors-core"), Arc::new(NullEventSink)).unwrap();
    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "unborn",
                "command": "git_worktree_create",
                "payload": {
                    "projectPath": unborn,
                    "taskId": "unborn"
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("committed HEAD"));

    let repo = committed_repo("git-task-collisions");
    for payload in [
        json!({ "projectPath": repo }),
        json!({
            "projectPath": repo,
            "branchName": "wheeljack/manual",
            "taskId": "also-task"
        }),
    ] {
        let response: Value = serde_json::from_str(
            &core.call_json(
                &json!({
                    "id": "exclusive",
                    "command": "git_worktree_create",
                    "payload": payload
                })
                .to_string(),
            ),
        )
        .unwrap();
        assert_eq!(response["ok"], false);
        assert!(response["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Exactly one"));
    }

    let first_path = repo.with_file_name(format!(
        "{}-first",
        repo.file_name().unwrap().to_string_lossy()
    ));
    let created: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "first",
                "command": "git_worktree_create",
                "payload": {
                    "projectPath": repo,
                    "taskId": "collision",
                    "worktreePath": first_path
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(created["ok"], true);
    let branch = created["payload"]["worktree"]["branch"]
        .as_str()
        .unwrap()
        .to_string();
    let second_path = repo.with_file_name(format!(
        "{}-second",
        repo.file_name().unwrap().to_string_lossy()
    ));
    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "branch-collision",
                "command": "git_worktree_create",
                "payload": {
                    "projectPath": repo,
                    "taskId": "collision",
                    "worktreePath": second_path
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("already exists"));
    assert!(!second_path.exists());

    let occupied_path = repo.with_file_name(format!(
        "{}-occupied",
        repo.file_name().unwrap().to_string_lossy()
    ));
    fs::create_dir_all(&occupied_path).unwrap();
    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "path-collision",
                "command": "git_worktree_create",
                "payload": {
                    "projectPath": repo,
                    "branchName": "wheeljack/occupied",
                    "worktreePath": occupied_path
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("will not overwrite"));

    let removed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "remove-first",
                "command": "git_worktree_remove",
                "payload": {
                    "projectPath": repo,
                    "worktreePath": first_path,
                    "expectedBranch": branch
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(removed["ok"], true);
}

#[test]
fn git_worktree_integrate_is_idempotent_and_preserves_dirty_targets() {
    let repo = committed_repo("git-task-integrate");
    let core = Core::new(
        test_init("git-task-integrate-core"),
        Arc::new(NullEventSink),
    )
    .unwrap();
    let created: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "create-task",
                "command": "git_worktree_create",
                "payload": { "projectPath": repo, "taskId": "integrate-task" }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(created["ok"], true);
    let worktree = PathBuf::from(created["payload"]["worktree"]["path"].as_str().unwrap());
    let branch = created["payload"]["worktree"]["branch"].as_str().unwrap();
    let base_commit = created["payload"]["baseCommit"].as_str().unwrap();
    fs::write(worktree.join("feature.txt"), "integrated task\n").unwrap();
    run_git(&worktree, ["add", "."]).unwrap();
    run_git(&worktree, ["commit", "-m", "task feature"]).unwrap();

    let request = || {
        json!({
            "id": "integrate-task",
            "command": "git_worktree_integrate",
            "payload": { "req": {
                "projectPath": repo,
                "worktreePath": worktree,
                "expectedBranch": branch,
                "baseCommit": base_commit
            }}
        })
    };
    let integrated: Value = serde_json::from_str(&core.call_json(&request().to_string())).unwrap();
    assert_eq!(integrated["ok"], true);
    assert_eq!(integrated["payload"]["status"], "integrated");
    assert_eq!(
        fs::read_to_string(repo.join("feature.txt")).unwrap().trim(),
        "integrated task"
    );
    let integrated_head = git_text(&repo, ["rev-parse", "HEAD"]);

    let repeated: Value = serde_json::from_str(&core.call_json(&request().to_string())).unwrap();
    assert_eq!(repeated["ok"], true);
    assert_eq!(repeated["payload"]["status"], "integrated");
    assert_eq!(git_text(&repo, ["rev-parse", "HEAD"]), integrated_head);

    fs::write(worktree.join("second.txt"), "second task change\n").unwrap();
    run_git(&worktree, ["add", "."]).unwrap();
    run_git(&worktree, ["commit", "-m", "second task change"]).unwrap();
    fs::write(repo.join("local.txt"), "local target change\n").unwrap();
    let dirty: Value = serde_json::from_str(&core.call_json(&request().to_string())).unwrap();
    assert_eq!(dirty["ok"], true);
    assert_eq!(dirty["payload"]["status"], "target_dirty");
    assert!(!repo.join("second.txt").exists());
}

#[test]
fn git_worktree_integrate_rolls_back_conflicts() {
    let repo = committed_repo("git-task-integrate-conflict");
    let core = Core::new(
        test_init("git-task-integrate-conflict-core"),
        Arc::new(NullEventSink),
    )
    .unwrap();
    let created: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "create-task",
                "command": "git_worktree_create",
                "payload": { "projectPath": repo, "taskId": "conflict-task" }
            })
            .to_string(),
        ),
    )
    .unwrap();
    let worktree = PathBuf::from(created["payload"]["worktree"]["path"].as_str().unwrap());
    let branch = created["payload"]["worktree"]["branch"].as_str().unwrap();
    let base_commit = created["payload"]["baseCommit"].as_str().unwrap();
    fs::write(worktree.join("README.md"), "task version\n").unwrap();
    run_git(&worktree, ["add", "."]).unwrap();
    run_git(&worktree, ["commit", "-m", "task readme"]).unwrap();
    fs::write(repo.join("README.md"), "target version\n").unwrap();
    run_git(&repo, ["add", "."]).unwrap();
    run_git(&repo, ["commit", "-m", "target readme"]).unwrap();
    let target_head = git_text(&repo, ["rev-parse", "HEAD"]);

    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "integrate-conflict",
                "command": "git_worktree_integrate",
                "payload": { "req": {
                    "projectPath": repo,
                    "worktreePath": worktree,
                    "expectedBranch": branch,
                    "baseCommit": base_commit
                }}
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["status"], "conflict");
    assert_eq!(git_text(&repo, ["rev-parse", "HEAD"]), target_head);
    assert_eq!(
        fs::read_to_string(repo.join("README.md")).unwrap().trim(),
        "target version"
    );
    assert!(!repo.join(".git").join("CHERRY_PICK_HEAD").exists());
}

fn committed_repo(name: &str) -> PathBuf {
    let repo = temp_dir(name);
    fs::create_dir_all(&repo).unwrap();
    run_git(&repo, ["init"]).unwrap();
    run_git(&repo, ["config", "user.email", "wheeljack@example.test"]).unwrap();
    run_git(&repo, ["config", "user.name", "wheeljack test"]).unwrap();
    fs::write(repo.join("README.md"), "native git\n").unwrap();
    run_git(&repo, ["add", "."]).unwrap();
    run_git(&repo, ["commit", "-m", "init"]).unwrap();
    repo
}

fn git_text<const N: usize>(cwd: &Path, args: [&str; N]) -> String {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn git_succeeds<const N: usize>(cwd: &Path, args: [&str; N]) -> bool {
    Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}
