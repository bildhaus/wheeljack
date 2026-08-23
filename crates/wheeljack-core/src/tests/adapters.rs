use super::support::*;
use crate::*;

#[cfg(windows)]
fn slow_probe_fixture(dir: &Path) -> (PathBuf, PathBuf) {
    fs::create_dir_all(dir).unwrap();
    let script_path = dir.join("slow-probe.cmd");
    let started_path = dir.join("started.txt");
    fs::write(
        &script_path,
        format!(
            "@echo off\r\n>\"{}\" echo started\r\npowershell -NoProfile -Command \"Start-Sleep -Milliseconds 1200\"\r\necho 1.0.0\r\n",
            started_path.display()
        ),
    )
    .unwrap();
    (script_path, started_path)
}

#[cfg(not(windows))]
fn slow_probe_fixture(dir: &Path) -> (PathBuf, PathBuf) {
    use std::os::unix::fs::PermissionsExt;

    fs::create_dir_all(dir).unwrap();
    let script_path = dir.join("slow-probe.sh");
    let started_path = dir.join("started.txt");
    fs::write(
        &script_path,
        format!(
            "#!/bin/sh\nprintf started > '{}'\nsleep 1.2\nprintf '1.0.0\\n'\n",
            started_path.display()
        ),
    )
    .unwrap();
    let mut permissions = fs::metadata(&script_path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&script_path, permissions).unwrap();
    (script_path, started_path)
}

#[cfg(windows)]
fn custom_claude_verifier_fixture(dir: &Path) -> (String, String, PathBuf, PathBuf) {
    fs::create_dir_all(dir).unwrap();
    let script_path = dir.join("verify.ps1");
    let args_path = dir.join("args.txt");
    let input_path = dir.join("input.json");
    fs::write(
        &script_path,
        r#"$argsPath=$args[0]
$inputPath=$args[1]
$remaining=@($args | Select-Object -Skip 2)
[IO.File]::WriteAllLines($argsPath, [string[]]$remaining)
$line=[Console]::In.ReadLine()
[IO.File]::WriteAllText($inputPath, $line)
Write-Output '{"type":"assistant","message":{"content":[{"type":"text","text":"WHEELJACK_READY"}]}}'
Write-Output '{"type":"result","is_error":false}'
"#,
    )
    .unwrap();
    (
        "powershell".to_string(),
        format!(
            "powershell -NoProfile -File \"{}\" \"{}\" \"{}\"",
            script_path.display(),
            args_path.display(),
            input_path.display()
        ),
        args_path,
        input_path,
    )
}

#[cfg(not(windows))]
fn custom_claude_verifier_fixture(dir: &Path) -> (String, String, PathBuf, PathBuf) {
    fs::create_dir_all(dir).unwrap();
    let script_path = dir.join("verify.sh");
    let args_path = dir.join("args.txt");
    let input_path = dir.join("input.json");
    fs::write(
        &script_path,
        r#"args_path=$1
input_path=$2
shift 2
: > "$args_path"
for arg in "$@"; do
  printf '%s\n' "$arg" >> "$args_path"
done
IFS= read -r line || true
printf '%s' "$line" > "$input_path"
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"WHEELJACK_READY"}]}}'
printf '%s\n' '{"type":"result","is_error":false}'
"#,
    )
    .unwrap();
    (
        "/bin/sh".to_string(),
        format!(
            "/bin/sh \"{}\" \"{}\" \"{}\"",
            script_path.display(),
            args_path.display(),
            input_path.display()
        ),
        args_path,
        input_path,
    )
}

#[test]
fn adapter_list_save_and_detect_roundtrip() {
    let core = Core::new(test_init("adapters"), Arc::new(NullEventSink)).expect("core");
    let list: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"list","command":"adapter_list","payload":{}}"#),
    )
    .unwrap();
    assert!(list["payload"]
        .as_array()
        .unwrap()
        .iter()
        .any(|adapter| adapter["id"] == "generic-shell"));

    let save = json!({
        "id": "save",
        "command": "adapter_save",
        "payload": {
            "id": "custom-test",
            "displayName": "Custom Test",
            "icon": "",
            "executables": ["cmd", "cmd"],
            "supportedPlatforms": ["windows"],
            "launchCommand": "cmd",
            "promptInjection": "manual",
            "status": "unknown",
            "setupHint": "test"
        }
    });
    let saved: Value = serde_json::from_str(&core.call_json(&save.to_string())).unwrap();
    assert_eq!(saved["ok"], true);
    assert_eq!(saved["payload"]["icon"], "terminal");
    assert_eq!(saved["payload"]["executables"].as_array().unwrap().len(), 1);
    assert_eq!(saved["payload"]["supportedApprovalPolicies"], json!([]));

    let detected: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"detect","command":"adapter_detect","payload":{}}"#),
    )
    .unwrap();
    assert!(detected["payload"]
        .as_array()
        .unwrap()
        .iter()
        .any(|adapter| adapter["id"] == "custom-test"));

    let disabled: Value = serde_json::from_str(
            &core.call_json(
                r#"{"id":"disable","command":"adapter_set_enabled","payload":{"adapterId":"custom-test","enabled":false}}"#,
            ),
        )
        .unwrap();
    assert_eq!(disabled["payload"]["enabled"], false);
    let list_after_disable: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"list","command":"adapter_list","payload":{}}"#),
    )
    .unwrap();
    assert_eq!(
        list_after_disable["payload"]
            .as_array()
            .unwrap()
            .iter()
            .find(|adapter| adapter["id"] == "custom-test")
            .unwrap()["enabled"],
        false
    );
    let generic_disable: Value = serde_json::from_str(
            &core.call_json(
                r#"{"id":"disable-generic","command":"adapter_set_enabled","payload":{"adapterId":"generic-shell","enabled":false}}"#,
            ),
        )
        .unwrap();
    assert_eq!(generic_disable["ok"], false);

    let generic_save = json!({
        "id": "save-generic",
        "command": "adapter_save",
        "payload": {
            "id": "generic-shell",
            "displayName": "Generic Shell",
            "icon": "terminal",
            "executables": ["cmd"],
            "supportedPlatforms": ["windows"],
            "launchCommand": "cmd",
            "promptInjection": "manual",
            "status": "unknown",
            "setupHint": "test",
            "enabled": false
        }
    });
    let saved_generic: Value =
        serde_json::from_str(&core.call_json(&generic_save.to_string())).unwrap();
    assert_eq!(saved_generic["payload"]["enabled"], true);
}

#[test]
fn adapter_probe_reports_missing_without_launching() {
    let core = Core::new(test_init("adapter-probe-missing"), Arc::new(NullEventSink)).unwrap();
    let manifest = adapter_json(
        "missing-probe",
        "Missing Probe",
        "wheeljack-definitely-missing-agent",
        "wheeljack-definitely-missing-agent",
        "manual",
    );
    let save = json!({ "id": "save", "command": "adapter_save", "payload": manifest });
    assert_eq!(
        serde_json::from_str::<Value>(&core.call_json(&save.to_string())).unwrap()["ok"],
        true
    );

    let probe: Value = serde_json::from_str(&core.call_json(
        r#"{"id":"probe","command":"adapter_probe","payload":{"adapterId":"missing-probe","args":["--model","test"]}}"#,
    ))
    .unwrap();
    assert_eq!(probe["payload"]["authStatus"], "missing");
    assert_eq!(probe["payload"]["verificationStatus"], "unavailable");
    assert!(probe["payload"]["executablePath"].is_null());
    assert_eq!(probe["payload"]["verifiedArgs"], json!([]));
    assert!(probe["payload"].get("verificationFingerprint").is_none());
}

#[test]
fn adapter_probe_does_not_hold_sqlite_while_waiting_for_the_cli() {
    let fixture_dir = temp_dir("adapter-probe-db-release");
    let (script_path, started_path) = slow_probe_fixture(&fixture_dir);
    let core = Arc::new(
        Core::new(
            test_init("adapter-probe-db-release"),
            Arc::new(NullEventSink),
        )
        .unwrap(),
    );
    let manifest = adapter_json(
        "slow-probe",
        "Slow Probe",
        script_path.to_string_lossy().as_ref(),
        script_path.to_string_lossy().as_ref(),
        "manual",
    );
    let saved: Value = serde_json::from_str(&core.call_json(
        &json!({ "id": "save", "command": "adapter_save", "payload": manifest }).to_string(),
    ))
    .unwrap();
    assert_eq!(saved["ok"], true);

    let probing_core = core.clone();
    let probe = thread::spawn(move || {
        probing_core.call_json(
            r#"{"id":"probe","command":"adapter_probe","payload":{"adapterId":"slow-probe"}}"#,
        )
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    while !started_path.exists() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    assert!(started_path.exists(), "slow adapter probe did not start");

    let started = Instant::now();
    let settings: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"settings","command":"settings_export","payload":{}}"#),
    )
    .unwrap();
    assert_eq!(settings["ok"], true);
    assert!(
        started.elapsed() < Duration::from_millis(500),
        "adapter probe held SQLite for {:?}",
        started.elapsed()
    );

    let probe: Value = serde_json::from_str(&probe.join().unwrap()).unwrap();
    assert_eq!(probe["ok"], true);
    assert_eq!(probe["payload"]["version"], "1.0.0");
}

#[test]
fn adapter_launch_parser_roundtrips_quoted_executable_and_arguments() {
    let core = Core::new(test_init("adapter-launch-parser"), Arc::new(NullEventSink)).unwrap();
    let launch_command =
        r#""C:\Program Files\wheeljack\agent.exe" --model "fast mode" --name "a \"quoted\" value""#;
    let manifest = adapter_json(
        "quoted-launch",
        "Quoted Launch",
        r#"C:\Program Files\wheeljack\agent.exe"#,
        launch_command,
        "manual",
    );
    let saved: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "save",
                "command": "adapter_save",
                "payload": manifest
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(saved["ok"], true);

    let db = core.lock_db().unwrap();
    let (command, args) = resolve_adapter_launch(&db, "quoted-launch").unwrap();
    assert_eq!(command, r#"C:\Program Files\wheeljack\agent.exe"#);
    assert_eq!(
        args,
        vec!["--model", "fast mode", "--name", r#"a "quoted" value"#]
    );
}

#[test]
fn custom_persistent_claude_adapter_verifies_its_declared_launch_profile() {
    let fixture_dir = temp_dir("adapter-custom-claude-verifier");
    let (executable, launch_command, args_path, input_path) =
        custom_claude_verifier_fixture(&fixture_dir);
    let core = Core::new(
        test_init("adapter-custom-claude-verify"),
        Arc::new(NullEventSink),
    )
    .unwrap();
    let launch_args = json!(["--model", "fixture-model", "--permission-mode", "ask"]);
    let mut manifest = adapter_json(
        "custom-claude-stream",
        "Custom Claude stream",
        &executable,
        &launch_command,
        "stdin",
    );
    manifest["streaming"] = json!({
        "preferred": {
            "transport": "ndjson",
            "protocol": "claude-stream-json",
            "launchCommand": launch_command,
            "promptDelivery": "stdin",
            "sessionMode": "persistent-stdin-jsonl",
            "supportsFollowUp": true,
            "responseHistoryMode": "append"
        }
    });
    let saved: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "save",
                "command": "adapter_save",
                "payload": { "manifest": manifest }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(saved["ok"], true);

    let verified: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "verify",
                "command": "adapter_verify",
                "payload": {
                    "adapterId": "custom-claude-stream",
                    "cwd": fixture_dir,
                    "args": launch_args
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(verified["ok"], true, "{verified}");
    assert_eq!(verified["payload"]["verificationStatus"], "verified");
    #[cfg(windows)]
    assert!(verified["payload"]["version"].is_null());
    assert_eq!(verified["payload"]["verifiedArgs"], launch_args);
    let fingerprint = verified["payload"]["verificationFingerprint"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(fingerprint.len(), 64);

    let received_args = fs::read_to_string(&args_path)
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect::<Vec<_>>();
    assert_eq!(
        received_args,
        vec!["--model", "fixture-model", "--permission-mode", "ask"]
    );
    let input: Value = serde_json::from_str(&fs::read_to_string(&input_path).unwrap()).unwrap();
    assert_eq!(input["type"], "user");
    assert_eq!(input["message"]["role"], "user");
    assert_eq!(
        input["message"]["content"],
        "Reply exactly WHEELJACK_READY. Do not use tools or change files."
    );
    assert_eq!(input["parent_tool_use_id"], Value::Null);

    let (stored_args, stored_fingerprint): (String, String) = core
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT verified_args_json, launch_fingerprint
             FROM adapter_verifications WHERE adapter_id = 'custom-claude-stream'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&stored_args).unwrap(),
        launch_args
    );
    assert_eq!(stored_fingerprint, fingerprint);

    let restored: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "probe",
                "command": "adapter_probe",
                "payload": {
                    "adapterId": "custom-claude-stream",
                    "args": launch_args
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(restored["payload"]["verificationStatus"], "verified");
    assert_eq!(restored["payload"]["verificationFingerprint"], fingerprint);

    let stale: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "probe-stale",
                "command": "adapter_probe",
                "payload": {
                    "adapterId": "custom-claude-stream",
                    "args": ["--model", "changed"]
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(stale["payload"]["verificationStatus"], "stale");
    assert_eq!(stale["payload"]["verifiedArgs"], launch_args);
    assert_eq!(stale["payload"]["verificationFingerprint"], fingerprint);
}

#[test]
fn custom_adapter_verification_rejects_non_claude_protocols_without_launching() {
    let fixture_dir = temp_dir("adapter-custom-unsupported-verifier");
    let (executable, launch_command, args_path, input_path) =
        custom_claude_verifier_fixture(&fixture_dir);
    let core = Core::new(
        test_init("adapter-custom-unsupported-verify"),
        Arc::new(NullEventSink),
    )
    .unwrap();
    let mut manifest = adapter_json(
        "custom-pi-stream",
        "Custom Pi stream",
        &executable,
        &launch_command,
        "stdin",
    );
    manifest["streaming"] = json!({
        "preferred": {
            "transport": "json-rpc-stdio",
            "protocol": "pi-rpc",
            "launchCommand": launch_command,
            "promptDelivery": "json-rpc",
            "sessionMode": "persistent-json-rpc",
            "supportsFollowUp": true,
            "responseHistoryMode": "append"
        }
    });
    let saved: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "save",
                "command": "adapter_save",
                "payload": { "manifest": manifest }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(saved["ok"], true);

    let rejected: Value = serde_json::from_str(
        &core.call_json(
            r#"{"id":"verify","command":"adapter_verify","payload":{"adapterId":"custom-pi-stream","args":[]}}"#,
        ),
    )
    .unwrap();
    assert_eq!(rejected["ok"], false);
    assert!(rejected
        .to_string()
        .contains("custom adapter verification supports only persistent claude-stream-json"));
    assert!(!args_path.exists());
    assert!(!input_path.exists());
}

#[test]
fn claude_auth_json_does_not_report_logged_out_as_ready() {
    assert!(!adapter_auth_succeeded(
        "claude-code",
        true,
        r#"{"loggedIn":false}"#
    ));
    assert!(adapter_auth_succeeded(
        "claude-code",
        true,
        r#"{"loggedIn":true}"#
    ));
}

#[test]
#[ignore = "uses installed agent accounts and consumes one minimal turn per adapter"]
fn live_builtin_adapters_probe_and_verify() {
    let core = Core::new(test_init("adapter-live-verify"), Arc::new(NullEventSink)).unwrap();
    for adapter_id in ["codex-cli", "claude-code", "opencode", "pi-coding-agent"] {
        let probe: Value = serde_json::from_str(
            &core.call_json(
                &json!({
                    "id": format!("probe-{adapter_id}"),
                    "command": "adapter_probe",
                    "payload": { "adapterId": adapter_id }
                })
                .to_string(),
            ),
        )
        .unwrap();
        assert_eq!(
            probe["payload"]["authStatus"], "authenticated",
            "{adapter_id}: {probe}"
        );
        let verified: Value = serde_json::from_str(
            &core.call_json(
                &json!({
                    "id": format!("verify-{adapter_id}"),
                    "command": "adapter_verify",
                    "payload": { "adapterId": adapter_id, "cwd": env!("CARGO_MANIFEST_DIR") }
                })
                .to_string(),
            ),
        )
        .unwrap();
        assert_eq!(
            verified["payload"]["verificationStatus"], "verified",
            "{adapter_id}: {verified}"
        );
    }
}

#[test]
fn adapter_registry_exposes_reference_streaming_profiles() {
    let core = Core::new(test_init("adapter-streaming"), Arc::new(NullEventSink)).expect("core");
    let list: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"list","command":"adapter_list","payload":{}}"#),
    )
    .unwrap();
    let adapters = list["payload"].as_array().unwrap();
    let by_id = |id: &str| {
        adapters
            .iter()
            .find(|adapter| adapter["id"] == id)
            .unwrap_or_else(|| panic!("missing adapter {id}"))
    };

    let claude = by_id("claude-code");
    assert_eq!(claude["promptInjection"], "paste_then_enter");
    assert_eq!(claude["presentation"]["defaultView"], "chat");
    assert_eq!(claude["presentation"]["parserId"], "claude-code");
    assert_eq!(
        claude["streaming"]["preferred"]["protocol"],
        "claude-stream-json"
    );
    assert_eq!(
        claude["streaming"]["preferred"]["sessionMode"],
        "persistent-stdin-jsonl"
    );
    assert_eq!(claude["streaming"]["preferred"]["supportsFollowUp"], true);
    assert!(claude["streaming"]["preferred"]["launchCommand"]
        .as_str()
        .unwrap()
        .contains("--permission-prompt-tool stdio"));
    assert_eq!(
        claude["supportedApprovalPolicies"],
        json!([
            "acceptEdits",
            "auto",
            "plan",
            "dontAsk",
            "manual",
            "bypassPermissions"
        ])
    );

    let codex = by_id("codex-cli");
    assert_eq!(
        codex["streaming"]["preferred"]["protocol"],
        "codex-app-server"
    );
    assert!(codex["streaming"].get("fallback").is_none());
    assert_eq!(
        codex["supportedApprovalPolicies"],
        json!(["untrusted", "on-request", "never"])
    );

    let opencode = by_id("opencode");
    assert_eq!(
        opencode["streaming"]["preferred"]["protocol"],
        "opencode-sse"
    );
    assert!(opencode["streaming"].get("fallback").is_none());
    assert_eq!(
        opencode["supportedApprovalPolicies"],
        json!(["ask", "allow", "deny"])
    );

    assert!(!adapters
        .iter()
        .any(|adapter| adapter["id"] == "hermes-agent"));

    let pi = by_id("pi-coding-agent");
    assert_eq!(pi["streaming"]["preferred"]["protocol"], "pi-rpc");
    assert!(pi["streaming"].get("fallback").is_none());
    assert_eq!(pi["supportedApprovalPolicies"], json!([]));

    let generic = by_id("generic-shell");
    assert_eq!(generic["icon"], "shell");
    assert_eq!(generic["presentation"]["defaultView"], "terminal");
    assert_eq!(generic["presentation"]["parserId"], "generic-lines");
    assert!(generic.get("streaming").is_none());
    assert_eq!(generic["enabled"], true);
}

#[test]
fn structured_adapter_resolver_requires_a_persistent_follow_up_profile() {
    let core = Core::new(
        test_init("adapter-structured-profile"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    {
        let db = core.lock_db().unwrap();
        let launch = resolve_structured_adapter_launch(&db, "codex-cli").unwrap();
        assert_eq!(launch.launch_command, "codex app-server");
        assert_eq!(launch.prompt_delivery, "json-rpc");
        assert_eq!(launch.protocol, StructuredProtocol::CodexAppServer);
        assert!(resolve_structured_adapter_launch(&db, "generic-shell")
            .unwrap_err()
            .to_string()
            .contains("no preferred structured profile"));
    }

    let mut manifest = adapter_json(
        "oneshot-agent",
        "One-shot agent",
        "oneshot-agent",
        "oneshot-agent",
        "stdin",
    );
    manifest["streaming"] = json!({
        "preferred": {
            "launchCommand": "oneshot-agent --json",
            "promptDelivery": "argv",
            "protocol": "oneshot-json",
            "sessionMode": "oneshot",
            "supportsFollowUp": false
        }
    });
    let saved: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "save-oneshot",
                "command": "adapter_save",
                "payload": { "manifest": manifest }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(saved["ok"], true);
    let db = core.lock_db().unwrap();
    assert!(resolve_structured_adapter_launch(&db, "oneshot-agent")
        .unwrap_err()
        .to_string()
        .contains("persistent follow-up"));
}

#[test]
fn adapter_registry_applies_reference_legacy_rules() {
    let core = Core::new(test_init("adapter-legacy"), Arc::new(NullEventSink)).expect("core");
    for (id, name) in [
        ("cursor-cli", "Cursor CLI"),
        ("hermes-agent", "Hermes Agent"),
    ] {
        let retired_save = json!({
            "id": format!("retired-save-{id}"),
            "command": "adapter_save",
            "payload": adapter_json(id, name, id, id, "stdin")
        });
        let rejected: Value =
            serde_json::from_str(&core.call_json(&retired_save.to_string())).unwrap();
        assert_eq!(rejected["ok"], false);
    }

    {
        let db = core.lock_db().unwrap();
        for manifest in [
            adapter_json("cursor-cli", "Cursor CLI", "cursor", "cursor", "stdin"),
            adapter_json("hermes-agent", "Hermes Agent", "hermes", "hermes", "stdin"),
            adapter_json(
                "codex-cli",
                "Codex CLI",
                "codex",
                "codex --no-alt-screen",
                "stdin",
            ),
        ] {
            db.execute(
                    "INSERT OR REPLACE INTO adapter_configs (id, manifest_json, enabled, created_at, updated_at)
                     VALUES (?1, ?2, 1, ?3, ?3)",
                    params![manifest["id"].as_str().unwrap(), manifest.to_string(), now()],
                )
                .unwrap();
        }
    }

    let list: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"list","command":"adapter_list","payload":{}}"#),
    )
    .unwrap();
    let adapters = list["payload"].as_array().unwrap();
    assert!(!adapters.iter().any(|adapter| adapter["id"] == "cursor-cli"));
    assert!(!adapters
        .iter()
        .any(|adapter| adapter["id"] == "hermes-agent"));
    let codex = adapters
        .iter()
        .find(|adapter| adapter["id"] == "codex-cli")
        .unwrap();
    assert_eq!(codex["promptInjection"], "paste_then_enter");
}

#[test]
fn adapter_registry_refreshes_legacy_streaming_metadata() {
    let core = Core::new(
        test_init("adapter-legacy-streaming"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    {
        let db = core.lock_db().unwrap();
        let mut manifest = adapter_json("opencode", "OpenCode", "opencode", "opencode", "stdin");
        manifest["streaming"] = json!({
            "preferred": {
                "transport": "ndjson",
                "protocol": "opencode-json",
                "launchCommand": "opencode run --format json",
                "promptDelivery": "argv",
                "docsUrl": "https://opencode.ai/docs/cli/"
            },
            "ptyFallback": true
        });
        manifest["presentation"] = json!({
            "defaultView": "grid",
            "parserId": "unknown"
        });
        db.execute(
                "INSERT OR REPLACE INTO adapter_configs (id, manifest_json, enabled, created_at, updated_at)
                 VALUES (?1, ?2, 1, ?3, ?3)",
                params!["opencode", manifest.to_string(), now()],
            )
            .unwrap();
        let mut codex = adapter_json(
            "codex-cli",
            "Codex CLI",
            "codex",
            "codex --no-alt-screen",
            "paste_then_enter",
        );
        codex["streaming"] = json!({
            "preferred": {
                "transport": "json-rpc-stdio",
                "protocol": "codex-app-server",
                "launchCommand": "codex app-server",
                "promptDelivery": "json-rpc"
            },
            "fallback": {
                "transport": "ndjson",
                "protocol": "codex-jsonl",
                "launchCommand": "codex exec --json",
                "promptDelivery": "argv"
            },
            "ptyFallback": true
        });
        db.execute(
                "INSERT OR REPLACE INTO adapter_configs (id, manifest_json, enabled, created_at, updated_at)
                 VALUES (?1, ?2, 1, ?3, ?3)",
                params!["codex-cli", codex.to_string(), now()],
            )
            .unwrap();
    }

    let list: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"list","command":"adapter_list","payload":{}}"#),
    )
    .unwrap();
    let opencode = list["payload"]
        .as_array()
        .unwrap()
        .iter()
        .find(|adapter| adapter["id"] == "opencode")
        .unwrap();
    assert_eq!(opencode["presentation"]["defaultView"], "chat");
    assert_eq!(opencode["presentation"]["parserId"], "opencode");
    assert_eq!(
        opencode["streaming"]["preferred"]["protocol"],
        "opencode-sse"
    );
    assert_eq!(opencode["streaming"]["preferred"]["supportsFollowUp"], true);
    let codex = list["payload"]
        .as_array()
        .unwrap()
        .iter()
        .find(|adapter| adapter["id"] == "codex-cli")
        .unwrap();
    assert_eq!(
        codex["streaming"]["preferred"]["sessionMode"],
        "persistent-json-rpc"
    );
    assert_eq!(codex["streaming"]["preferred"]["supportsFollowUp"], true);
    assert!(codex["streaming"]["fallback"]
        .get("responseHistoryMode")
        .is_none());
}

#[test]
fn adapter_registry_falls_back_for_malformed_built_in_presentation() {
    let core = Core::new(
        test_init("adapter-malformed-presentation"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let mut manifest = adapter_json("opencode", "OpenCode", "opencode", "opencode", "stdin");
    manifest["presentation"] = json!("malformed");
    {
        let db = core.lock_db().unwrap();
        db.execute(
            "INSERT OR REPLACE INTO adapter_configs (id, manifest_json, enabled, created_at, updated_at)
             VALUES (?1, ?2, 1, ?3, ?3)",
            params!["opencode", manifest.to_string(), now()],
        )
        .unwrap();
    }

    let list: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"list","command":"adapter_list","payload":{}}"#),
    )
    .unwrap();
    let opencode = list["payload"]
        .as_array()
        .unwrap()
        .iter()
        .find(|adapter| adapter["id"] == "opencode")
        .unwrap();
    assert_eq!(opencode["presentation"]["defaultView"], "chat");
    assert_eq!(opencode["presentation"]["parserId"], "opencode");
}

#[test]
fn adapter_registry_falls_back_for_malformed_custom_presentation() {
    let core = Core::new(
        test_init("adapter-malformed-custom-presentation"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let mut manifest = adapter_json("custom-test", "Custom Test", "cmd", "cmd", "manual");
    manifest["presentation"] = json!({
        "defaultView": "invalid",
        "parserId": "invalid"
    });
    let saved: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "save",
                "command": "adapter_save",
                "payload": manifest
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(saved["ok"], true);
    assert_eq!(saved["payload"]["presentation"]["defaultView"], "terminal");
    assert_eq!(
        saved["payload"]["presentation"]["parserId"],
        "generic-lines"
    );
}

#[test]
fn adapter_save_preserves_valid_custom_presentation() {
    let core = Core::new(
        test_init("adapter-custom-presentation"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let save = json!({
        "id": "save",
        "command": "adapter_save",
        "payload": {
            "id": "custom-test",
            "displayName": "Custom Test",
            "icon": "terminal",
            "executables": ["cmd"],
            "supportedPlatforms": ["windows"],
            "launchCommand": "cmd",
            "promptInjection": "stdin",
            "presentation": {
                "defaultView": "split",
                "parserId": "generic-lines"
            },
            "status": "unknown",
            "setupHint": "test"
        }
    });
    let saved: Value = serde_json::from_str(&core.call_json(&save.to_string())).unwrap();
    assert_eq!(saved["ok"], true);
    assert_eq!(saved["payload"]["presentation"]["defaultView"], "split");
    assert_eq!(
        saved["payload"]["presentation"]["parserId"],
        "generic-lines"
    );
}
