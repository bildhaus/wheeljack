use super::support::*;
use crate::*;

fn core_request(core: &Core, command: &str, payload: Value) -> Result<Value> {
    let response: Value = serde_json::from_str(
        &core.call_json(
            &json!({ "id": Uuid::now_v7().to_string(), "command": command, "payload": payload })
                .to_string(),
        ),
    )?;
    if response["ok"] != true {
        bail!("{command} failed: {}", response["error"]["message"]);
    }
    Ok(response["payload"].clone())
}

fn assistant_texts(sink: &RecordingSink, session_id: &str) -> Vec<String> {
    let mut texts = Vec::new();
    for (event, payload) in sink.snapshot() {
        if event != "agent:protocol-update" || payload["sessionId"] != session_id {
            continue;
        }
        for message in payload["messages"].as_array().into_iter().flatten() {
            if message["role"] == "assistant" {
                if let Some(text) = message["text"].as_str() {
                    if !texts.iter().any(|seen| seen == text) {
                        texts.push(text.to_string());
                    }
                }
            }
        }
    }
    texts
}

fn wait_for_reply(
    core: &Core,
    sink: &RecordingSink,
    session_id: &str,
    expected: &str,
) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(90);
    while Instant::now() < deadline {
        let has_reply = assistant_texts(sink, session_id)
            .iter()
            .any(|text| text.trim() == expected);
        let idle = core
            .lock_structured_sessions()?
            .get(session_id)
            .and_then(|session| session.rpc_state.as_ref())
            .and_then(|state| state.lock().ok().map(|state| !state.turn_active))
            .unwrap_or(false);
        if has_reply && idle {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(50));
    }
    let texts = assistant_texts(sink, session_id);
    let errors = sink
        .snapshot()
        .into_iter()
        .filter(|(event, payload)| {
            event == "agent:protocol-update" && payload["sessionId"] == session_id
        })
        .flat_map(|(_, payload)| payload["events"].as_array().cloned().unwrap_or_default())
        .filter(|event| event["type"] == "error")
        .filter_map(|event| {
            event["text"]
                .as_str()
                .map(|text| text.chars().take(500).collect::<String>())
        })
        .collect::<Vec<_>>();
    bail!("Timed out awaiting {expected}; assistant replies={texts:?}; protocol errors={errors:?}")
}

#[test]
#[ignore = "requires explicit WHEELJACK_LIVE_QUEUE_RESUME=1; consumes three tiny real Codex turns"]
fn live_codex_queue_resume_isolated() {
    assert_eq!(
        std::env::var("WHEELJACK_LIVE_QUEUE_RESUME").as_deref(),
        Ok("1"),
        "Live provider use requires explicit opt-in"
    );
    let root = PathBuf::from(
        std::env::var_os("WHEELJACK_LIVE_FIXTURE_ROOT").expect("disposable fixture root"),
    );
    assert!(
        root.is_absolute() && root.starts_with(std::env::temp_dir()),
        "wheeljack state and repository must remain in a disposable temp fixture"
    );
    assert_eq!(
        std::env::var("WHEELJACK_LIVE_EXISTING_PROVIDER_PROFILE").as_deref(),
        Ok("1"),
        "Using the installed authenticated provider profile requires explicit opt-in"
    );
    let evidence_path =
        PathBuf::from(std::env::var_os("WHEELJACK_LIVE_EVIDENCE").expect("evidence path"));
    let mut evidence = format!("# Real-provider queue and resume validation\n\nStarted: {}\n\nProvider: OpenAI Codex CLI (ChatGPT authentication), using the installed authenticated profile without reading or copying credentials. Ordinary provider CLI history entries are an intentional side effect; wheeljack app state and repo remain disposable.\nFixture: `{}`\n\n", now(), root.display());
    fs::write(&evidence_path, &evidence).unwrap();
    let result = (|| -> Result<()> {
        let repo = root.join("repo");
        fs::create_dir_all(&repo)?;
        let initialized = hidden_command("git")
            .args(["init", "--quiet"])
            .current_dir(&repo)
            .output()?;
        if !initialized.status.success() {
            bail!("Could not initialize disposable repository");
        }
        fs::write(repo.join("AGENTS.md"), "This is a disposable validation repository. Do not use tools, inspect files, edit files, or execute commands. Reply only with the fixed marker requested in each prompt.\n")?;
        let before = fs::read(repo.join("AGENTS.md"))?;
        let mut init = test_init("live-queue-resume");
        init.app_data_dir = root.join("wheeljack");
        init.cache_dir = Some(init.app_data_dir.join("cache"));
        init.update_dir = Some(init.app_data_dir.join("updates"));
        let sink = Arc::new(RecordingSink::default());
        let core = Core::new(init.clone(), sink.clone())?;
        let models = core_request(
            &core,
            "agent_models_list",
            json!({"adapterId":"codex-cli", "cwd":repo}),
        )?;
        let available = models["models"]
            .as_array()
            .ok_or_else(|| anyhow!("model discovery did not return a list"))?;
        let model = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex"]
            .into_iter()
            .find(|id| available.iter().any(|entry| entry["id"] == *id))
            .ok_or_else(|| {
                anyhow!("No bounded validation model was found in the authenticated catalog")
            })?;
        evidence.push_str(&format!("Model: `{model}`, reasoning effort `low`; enforced read-only sandbox and `never` approval policy.\n\n"));
        fs::write(&evidence_path, &evidence)?;
        let spawn = |core: &Core, prompt: &str, resume: Option<&str>| {
            core_request(
                core,
                "agent_structured_spawn",
                json!({
                    "nodeId":"live-proof-node", "adapterId":"codex-cli", "intent":"ask", "cwd":repo,
                    "prompt":prompt, "model":model, "thinking":"low", "sandbox":"read-only", "approvalPolicy":"never",
                    "resumeSessionId":resume,
                }),
            )
        };
        let started = spawn(&core, "Reply exactly WJ_LIVE_FIRST. Remember the token MAPLE_8142 for a later check. Do not use tools or read, inspect, create, or modify any files.", None)?;
        let session_id = started["id"]
            .as_str()
            .ok_or_else(|| anyhow!("missing session id"))?
            .to_string();
        let queued_id = Uuid::now_v7().to_string();
        let queued = core_request(
            &core,
            "session_prompt_submit",
            json!({
                "sessionId":session_id, "clientPromptId":queued_id,
                "prompt":"Reply exactly WJ_LIVE_QUEUED. Do not use tools or read, inspect, create, or modify files.",
            }),
        )?;
        if queued["state"] != "queued" {
            bail!("Follow-up was not accepted into the durable queue");
        }
        wait_for_reply(&core, &sink, &session_id, "WJ_LIVE_QUEUED")?;
        let replies = assistant_texts(&sink, &session_id);
        if !replies.iter().any(|text| text.trim() == "WJ_LIVE_FIRST") {
            bail!("Initial fixed marker was not observed");
        }
        let delivered = load_prompt_delivery(&*core.lock_db()?, &queued_id)?
            .ok_or_else(|| anyhow!("delivery disappeared"))?;
        if delivered.state != "delivered" || delivered.attempts != 1 {
            bail!("Queued prompt was not delivered exactly once");
        }
        let cursor = load_agent_resume_cursor(
            &*core.lock_db()?,
            &session_id,
            StructuredProtocol::CodexAppServer,
        )?;
        evidence.push_str("- PASS: first and queued marker replies completed through native structured sessions.\n- PASS: queued follow-up settled as delivered with one dispatch attempt.\n- PASS: provider-native resume cursor persisted.\n");
        fs::write(&evidence_path, &evidence)?;
        // Deterministically model interruption after the durable submission commits,
        // before its drainer starts. This sends no extra provider turn before restart.
        let recovery_id = Uuid::now_v7().to_string();
        submit_prompt_delivery(&*core.lock_db()?, &SubmitPromptDeliveryRequest {
            client_prompt_id:recovery_id.clone(), session_id:session_id.clone(), mode:"auto".to_string(),
            payload:PromptDeliveryPayload {
                prompt:"Without using tools, reply WJ_LIVE_RESUMED followed by the token I asked you to remember in the first prompt. No other text. Do not inspect or change files.".to_string(),
                history_text:"Bounded resume-context check".to_string(), standing_role_applied:false, image_paths:vec![],
                provider:None, model:Some(model.to_string()), thinking:Some("low".to_string()), approval_policy:Some("never".to_string()), sandbox:Some("read-only".to_string()),
            },
        })?;
        core.shutdown();
        drop(core);
        let resumed_sink = Arc::new(RecordingSink::default());
        let resumed_core = Core::new(init, resumed_sink.clone())?;
        let recovered = load_prompt_delivery(&*resumed_core.lock_db()?, &recovery_id)?
            .ok_or_else(|| anyhow!("saved queue disappeared"))?;
        if recovered.state != "blocked" {
            bail!("Restart did not block the undelivered queue");
        }
        let resumed = spawn(&resumed_core, "", Some(&session_id))?;
        let resumed_id = resumed["id"]
            .as_str()
            .ok_or_else(|| anyhow!("missing resumed session id"))?;
        if resumed_id == session_id {
            bail!("Resume did not create a new runtime instance");
        }
        wait_for_reply(
            &resumed_core,
            &resumed_sink,
            resumed_id,
            "WJ_LIVE_RESUMED MAPLE_8142",
        )?;
        let resumed_cursor = load_agent_resume_cursor(
            &*resumed_core.lock_db()?,
            resumed_id,
            StructuredProtocol::CodexAppServer,
        )?;
        if resumed_cursor != cursor {
            bail!("Provider-native conversation changed on resume");
        }
        let settled = load_prompt_delivery(&*resumed_core.lock_db()?, &recovery_id)?
            .ok_or_else(|| anyhow!("resumed delivery disappeared"))?;
        if settled.state != "delivered" || settled.session_id != resumed_id || settled.attempts != 1
        {
            bail!("Saved prompt was not rebound and delivered exactly once");
        }
        resumed_core.shutdown();
        if fs::read(repo.join("AGENTS.md"))? != before {
            bail!("Provider changed the fixture instructions");
        }
        let entries = fs::read_dir(&repo)?
            .map(|entry| entry.map(|entry| entry.file_name()))
            .collect::<std::io::Result<Vec<_>>>()?;
        if entries.len() != 2 {
            bail!("Unexpected files appeared in the disposable repository");
        }
        evidence.push_str("- PASS: restart blocked the saved queued row; resume rebound it to the new runtime and dispatched once.\n- PASS: resumed provider conversation returned the remembered first-turn token; native resume cursor stayed identical.\n- PASS: disposable repository remained unchanged.\n\nProvider usage: three tiny turns total; model discovery adds no inference turn.\n\nRecovery fixture detail: the third prompt was inserted using the native durable submission helper with its drainer deliberately not started, modeling a crash immediately after submission persistence. The initial follow-up used public core command dispatch.\n\nScope gaps: one provider on Windows; no macOS, other provider, desktop UI, cancellation, or provider-outage coverage in this check.\n");
        Ok(())
    })();
    match &result {
        Ok(()) => evidence.push_str("\nOutcome: PASS.\n"),
        Err(error) => evidence.push_str(&format!("\nOutcome: FAIL. {error:#}\n")),
    }
    fs::write(evidence_path, evidence).unwrap();
    result.unwrap();
}
