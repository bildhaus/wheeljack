use super::*;

pub(crate) const AGENT_CONTROL_PREFIX: &str = "wheeljack.control ";
const AGENT_CONTROL_EVENT_KIND: &str = "agent_control";
const AGENT_CONTROL_RESULT_KIND: &str = "agent_control_result";

pub(crate) fn load_agent_autonomy_policy(db: &Connection) -> Result<AgentAutonomyPolicyDto> {
    let value = db
        .query_row(
            "SELECT value_json FROM settings WHERE key = 'agentAutonomyPolicy'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(value
        .and_then(|value| serde_json::from_str::<AgentAutonomyPolicyDto>(&value).ok())
        .unwrap_or_default())
}

pub(crate) fn append_agent_control_instructions(
    prompt: &str,
    policy: &AgentAutonomyPolicyDto,
    task_id: Option<&str>,
) -> String {
    if !policy.enabled || prompt.contains(AGENT_CONTROL_PREFIX) {
        return prompt.to_string();
    }
    let task = task_id
        .filter(|task_id| !task_id.trim().is_empty())
        .map(|task_id| format!(" Current task id: {}.", task_id.trim()))
        .unwrap_or_default();
    format!(
        "{prompt}\n\nwheeljack autonomous controls:{task}\n\
- Use these only when another agent or task transition materially helps.\n\
- Emit exactly one complete line per request: wheeljack.control {{\"id\":\"unique-id\",\"action\":\"ACTION\",...}}\n\
- Actions: list_agents; send_message with target and message; spawn_agent with message and optional adapterId; handoff_task with taskId, message, and optional target; request_review with taskId, message, and optional target; resolve_file_conflict with taskId, files containing your complete remaining claim set, and optional message.\n\
- Omit target on handoff_task or request_review to start a fresh agent.\n\
- Before resolve_file_conflict, coordinate ownership with the peer; the action may release your claims but cannot add new ones.\n\
- Use a new id for every request and wait for wheeljack's result before issuing a dependent request.\n\
- Policies and hard concurrency/depth/rate limits may deny a request. Do not retry a denial with a new id."
    )
}

pub(crate) fn authorize_agent_control(
    db: &Connection,
    req: AgentControlRequestDto,
) -> Result<AgentControlAuthorizationDto> {
    validate_agent_control_request(&req)?;
    let policy = load_agent_autonomy_policy(db)?;
    let (source_node_id, source_title, source_depth) = source_agent(db, &req)?;

    if let Some(prior) = prior_authorization(db, &req)? {
        return Ok(prior);
    }

    let target_node_id = if action_uses_target(&req.action) {
        req.target
            .as_deref()
            .filter(|target| !is_new_agent_target(target))
            .map(|target| resolve_agent_target(db, &req.canvas_id, target, &source_node_id))
            .transpose()?
    } else {
        None
    };
    let mut decision = if policy.enabled {
        match policy_mode(&policy, &req.action) {
            "allow" => "allow",
            "ask" => "ask",
            _ => "deny",
        }
        .to_string()
    } else {
        "deny".to_string()
    };
    let mut reason = if policy.enabled {
        format!("{} policy is {}", req.action, decision)
    } else {
        "Agent autonomy is disabled.".to_string()
    };

    let recent_actions: i64 = db.query_row(
        "SELECT COUNT(*) FROM session_events
         WHERE session_id = ?1 AND kind = ?2
           AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute')",
        params![req.source_session_id, AGENT_CONTROL_EVENT_KIND],
        |row| row.get(0),
    )?;
    if decision != "deny" && recent_actions >= i64::from(policy.max_actions_per_minute) {
        decision = "deny".to_string();
        reason = format!(
            "Agent action rate limit reached ({} per minute).",
            policy.max_actions_per_minute
        );
    }

    if decision != "deny" && action_starts_agent(&req) {
        let active_agents: i64 = db.query_row(
            "SELECT COUNT(*) FROM nodes n
             JOIN sessions s ON s.id = json_extract(n.data_json, '$.sessionId')
             WHERE n.canvas_id = ?1 AND n.kind = 'agent_terminal' AND s.status = 'running'",
            params![req.canvas_id],
            |row| row.get(0),
        )?;
        let pending_workspace_spawns = pending_workspace_spawn_count(db, &req.canvas_id)?;
        if active_agents + i64::from(pending_workspace_spawns)
            >= i64::from(policy.max_concurrent_agents)
        {
            decision = "deny".to_string();
            reason = format!(
                "Workspace agent limit reached ({} concurrent agents).",
                policy.max_concurrent_agents
            );
        } else if source_depth >= policy.max_depth {
            decision = "deny".to_string();
            reason = format!("Agent spawn depth limit reached ({}).", policy.max_depth);
        } else if successful_child_count(db, &req.source_session_id)?
            .saturating_add(pending_child_count(db, &req.source_session_id)?)
            >= policy.max_children_per_agent
        {
            decision = "deny".to_string();
            reason = format!(
                "Per-agent child limit reached ({}).",
                policy.max_children_per_agent
            );
        }
    }

    let next_depth = source_depth.saturating_add(1);
    append_session_event(
        db,
        &req.source_session_id,
        AGENT_CONTROL_EVENT_KIND,
        match decision.as_str() {
            "allow" => "allowed",
            "ask" => "confirmation_required",
            _ => "denied",
        },
        &reason,
        &json!({
            "requestId": req.request_id,
            "action": req.action,
            "canvasId": req.canvas_id,
            "sourceNodeId": source_node_id,
            "sourceTitle": source_title,
            "sourceDepth": source_depth,
            "nextDepth": next_depth,
            "target": req.target,
            "targetNodeId": target_node_id,
            "taskId": req.task_id,
            "adapterId": req.adapter_id,
            "message": req.message,
            "files": req.files,
            "decision": decision,
        }),
    )?;

    Ok(AgentControlAuthorizationDto {
        request_id: req.request_id,
        action: req.action,
        decision,
        reason,
        source_depth,
        next_depth,
        target_node_id,
    })
}

pub(crate) fn record_agent_control_result(
    db: &Connection,
    req: AgentControlResultRequest,
) -> Result<()> {
    if req.request_id.is_empty()
        || req.request_id.len() > 80
        || !req
            .request_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        bail!("agent control result request id is invalid");
    }
    if req.source_session_id.trim().is_empty()
        || req.source_session_id.len() > 160
        || req.message.len() > 8_000
        || req
            .target_node_id
            .as_deref()
            .is_some_and(|value| value.len() > 160)
        || req
            .child_node_id
            .as_deref()
            .is_some_and(|value| value.len() > 160)
    {
        bail!("agent control result field exceeds its size limit");
    }
    let authorization = find_authorization_payload(db, &req.source_session_id, &req.request_id)?
        .ok_or_else(|| anyhow!("agent control request was not authorized"))?;
    if prior_result_exists(db, &req.source_session_id, &req.request_id)? {
        return Ok(());
    }
    let action = authorization
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if req.success && authorization.get("decision").and_then(Value::as_str) == Some("deny") {
        bail!("a denied agent control request cannot be recorded as successful");
    }
    let canvas_id = authorization
        .get("canvasId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let source_node_id = authorization
        .get("sourceNodeId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let source_title = authorization
        .get("sourceTitle")
        .and_then(Value::as_str)
        .unwrap_or_default();
    append_session_event(
        db,
        &req.source_session_id,
        AGENT_CONTROL_RESULT_KIND,
        if req.success { "succeeded" } else { "failed" },
        &req.message.chars().take(500).collect::<String>(),
        &json!({
            "requestId": req.request_id,
            "action": action,
            "canvasId": canvas_id,
            "sourceNodeId": source_node_id,
            "sourceTitle": source_title,
            "targetNodeId": req.target_node_id,
            "childNodeId": req.child_node_id,
        }),
    )?;
    Ok(())
}

pub(crate) fn list_agent_control_audit(
    db: &Connection,
    canvas_id: &str,
    limit: usize,
) -> Result<Vec<AgentControlAuditDto>> {
    let mut statement = db.prepare(
        "SELECT id, session_id, status, message, payload_json, created_at
         FROM session_events
         WHERE kind IN (?1, ?2)
           AND json_extract(payload_json, '$.canvasId') = ?3
         ORDER BY id DESC LIMIT ?4",
    )?;
    let rows = statement.query_map(
        params![
            AGENT_CONTROL_EVENT_KIND,
            AGENT_CONTROL_RESULT_KIND,
            canvas_id,
            limit.clamp(1, 500) as i64
        ],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        },
    )?;
    let mut audit = Vec::new();
    for row in rows {
        let (id, source_session_id, status, message, payload_json, created_at) = row?;
        let payload: Value = serde_json::from_str(&payload_json).unwrap_or_default();
        audit.push(AgentControlAuditDto {
            id,
            request_id: payload
                .get("requestId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            action: payload
                .get("action")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            status,
            message,
            source_session_id,
            source_node_id: payload
                .get("sourceNodeId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            source_title: payload
                .get("sourceTitle")
                .and_then(Value::as_str)
                .unwrap_or("Agent")
                .to_string(),
            target_node_id: payload
                .get("targetNodeId")
                .and_then(Value::as_str)
                .map(str::to_string),
            child_node_id: payload
                .get("childNodeId")
                .and_then(Value::as_str)
                .map(str::to_string),
            created_at,
        });
        if audit.len() >= limit.clamp(1, 500) {
            break;
        }
    }
    Ok(audit)
}

fn validate_agent_control_request(req: &AgentControlRequestDto) -> Result<()> {
    if req.request_id.is_empty()
        || req.request_id.len() > 80
        || !req
            .request_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        bail!("agent control request id is invalid");
    }
    if !matches!(
        req.action.as_str(),
        "list_agents"
            | "send_message"
            | "spawn_agent"
            | "handoff_task"
            | "request_review"
            | "resolve_file_conflict"
    ) {
        bail!("unsupported agent control action");
    }
    if req.source_session_id.trim().is_empty()
        || req.source_node_id.trim().is_empty()
        || req.canvas_id.trim().is_empty()
    {
        bail!("agent control source is incomplete");
    }
    if req.source_session_id.len() > 160
        || req.source_node_id.len() > 160
        || req.canvas_id.len() > 160
    {
        bail!("agent control source field exceeds its size limit");
    }
    if matches!(req.action.as_str(), "send_message" | "spawn_agent")
        && req
            .message
            .as_deref()
            .is_none_or(|message| message.trim().is_empty())
    {
        bail!("agent control action requires a message");
    }
    if req.action == "send_message"
        && req
            .target
            .as_deref()
            .is_none_or(|target| target.trim().is_empty())
    {
        bail!("send_message requires a target");
    }
    if req.action == "send_message" && req.target.as_deref().is_some_and(is_new_agent_target) {
        bail!("send_message requires an existing agent target");
    }
    if matches!(
        req.action.as_str(),
        "handoff_task" | "request_review" | "resolve_file_conflict"
    ) && req
        .task_id
        .as_deref()
        .is_none_or(|task_id| task_id.trim().is_empty())
    {
        bail!("task action requires a task id");
    }
    if req.action == "resolve_file_conflict" && req.files.is_none() {
        bail!("resolve_file_conflict requires the complete remaining file set");
    }
    if req.files.as_ref().is_some_and(|files| {
        files.len() > 64
            || files.iter().any(|file| {
                let file = file.trim();
                file.is_empty() || file.len() > 1_024
            })
    }) {
        bail!("agent control file claim set is invalid");
    }
    if req
        .message
        .as_deref()
        .is_some_and(|message| message.len() > 8_000)
        || req
            .target
            .as_deref()
            .is_some_and(|target| target.len() > 160)
        || req
            .task_id
            .as_deref()
            .is_some_and(|task_id| task_id.len() > 120)
        || req
            .adapter_id
            .as_deref()
            .is_some_and(|adapter| adapter.len() > 128)
    {
        bail!("agent control field exceeds its size limit");
    }
    Ok(())
}

fn source_agent(db: &Connection, req: &AgentControlRequestDto) -> Result<(String, String, u8)> {
    let (node_id, title, canvas_id, kind, data_json, session_status): (
        String,
        String,
        String,
        String,
        String,
        String,
    ) = db.query_row(
        "SELECT s.node_id, n.title, n.canvas_id, n.kind, n.data_json, s.status
             FROM sessions s JOIN nodes n ON n.id = s.node_id WHERE s.id = ?1",
        params![req.source_session_id],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        },
    )?;
    if node_id != req.source_node_id
        || canvas_id != req.canvas_id
        || kind != "agent_terminal"
        || session_status != "running"
    {
        bail!("agent control source does not match its session");
    }
    let data = serde_json::from_str::<Value>(&data_json)?;
    if data.get("sessionId").and_then(Value::as_str) != Some(req.source_session_id.as_str()) {
        bail!("agent control source session is stale");
    }
    let depth = data
        .get("autonomyDepth")
        .and_then(Value::as_u64)
        .and_then(|depth| u8::try_from(depth).ok())
        .unwrap_or(0);
    Ok((node_id, title, depth))
}

fn resolve_agent_target(
    db: &Connection,
    canvas_id: &str,
    target: &str,
    source_node_id: &str,
) -> Result<String> {
    let target = target.trim();
    let mut statement =
        db.prepare("SELECT id, title FROM nodes WHERE canvas_id = ?1 AND kind = 'agent_terminal'")?;
    let candidates = statement
        .query_map(params![canvas_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let matches = candidates
        .iter()
        .filter(|(id, title)| id == target || title.eq_ignore_ascii_case(target))
        .collect::<Vec<_>>();
    let Some((node_id, _)) = matches.first() else {
        bail!("agent control target was not found in this workspace");
    };
    if matches.len() > 1 {
        bail!("agent control target is ambiguous; use its node id");
    }
    if node_id == source_node_id {
        bail!("an agent cannot target itself");
    }
    Ok(node_id.to_string())
}

fn policy_mode<'a>(policy: &'a AgentAutonomyPolicyDto, action: &str) -> &'a str {
    match action {
        "list_agents" => &policy.list_agents,
        "send_message" => &policy.send_message,
        "spawn_agent" => &policy.spawn_agent,
        "handoff_task" => &policy.handoff_task,
        "request_review" => &policy.request_review,
        "resolve_file_conflict" => &policy.resolve_file_conflict,
        _ => "deny",
    }
}

fn action_uses_target(action: &str) -> bool {
    matches!(action, "send_message" | "handoff_task" | "request_review")
}

fn is_new_agent_target(target: &str) -> bool {
    matches!(
        target.trim().to_ascii_lowercase().as_str(),
        "" | "new" | "fresh"
    )
}

fn action_starts_agent(req: &AgentControlRequestDto) -> bool {
    req.action == "spawn_agent"
        || matches!(req.action.as_str(), "handoff_task" | "request_review")
            && req.target.as_deref().is_none_or(is_new_agent_target)
}

fn successful_child_count(db: &Connection, session_id: &str) -> Result<u8> {
    let mut statement = db.prepare(
        "SELECT payload_json FROM session_events
         WHERE session_id = ?1 AND kind = ?2 AND status = 'succeeded'",
    )?;
    let rows = statement.query_map(params![session_id, AGENT_CONTROL_RESULT_KIND], |row| {
        row.get::<_, String>(0)
    })?;
    let count = rows
        .filter_map(Result::ok)
        .filter_map(|payload| serde_json::from_str::<Value>(&payload).ok())
        .filter(|payload| payload.get("childNodeId").and_then(Value::as_str).is_some())
        .count();
    Ok(u8::try_from(count).unwrap_or(u8::MAX))
}

fn pending_child_count(db: &Connection, session_id: &str) -> Result<u8> {
    let completed = result_request_ids(db, Some(session_id))?;
    let mut statement = db.prepare(
        "SELECT payload_json FROM session_events
         WHERE session_id = ?1 AND kind = ?2 AND status IN ('allowed', 'confirmation_required')
           AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')",
    )?;
    let rows = statement.query_map(params![session_id, AGENT_CONTROL_EVENT_KIND], |row| {
        row.get::<_, String>(0)
    })?;
    let count = rows
        .filter_map(Result::ok)
        .filter_map(|payload| serde_json::from_str::<Value>(&payload).ok())
        .filter(payload_starts_agent)
        .filter(|payload| {
            payload
                .get("requestId")
                .and_then(Value::as_str)
                .is_some_and(|request_id| {
                    !completed.contains(&(session_id.to_string(), request_id.to_string()))
                })
        })
        .count();
    Ok(u8::try_from(count).unwrap_or(u8::MAX))
}

fn pending_workspace_spawn_count(db: &Connection, canvas_id: &str) -> Result<u8> {
    let completed = result_request_ids(db, None)?;
    let mut statement = db.prepare(
        "SELECT session_id, payload_json FROM session_events
         WHERE kind = ?1 AND status IN ('allowed', 'confirmation_required')
           AND json_extract(payload_json, '$.canvasId') = ?2
           AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')",
    )?;
    let rows = statement.query_map(params![AGENT_CONTROL_EVENT_KIND, canvas_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let count = rows
        .filter_map(Result::ok)
        .filter_map(|(session_id, payload)| {
            serde_json::from_str::<Value>(&payload)
                .ok()
                .map(|payload| (session_id, payload))
        })
        .filter(|(_, payload)| payload_starts_agent(payload))
        .filter(|(session_id, payload)| {
            payload
                .get("requestId")
                .and_then(Value::as_str)
                .is_some_and(|request_id| {
                    !completed.contains(&(session_id.clone(), request_id.to_string()))
                })
        })
        .count();
    Ok(u8::try_from(count).unwrap_or(u8::MAX))
}

fn result_request_ids(
    db: &Connection,
    session_id: Option<&str>,
) -> Result<HashSet<(String, String)>> {
    let mut statement = db.prepare(
        "SELECT session_id, payload_json FROM session_events
         WHERE kind = ?1 AND (?2 IS NULL OR session_id = ?2)
           AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')",
    )?;
    let rows = statement.query_map(params![AGENT_CONTROL_RESULT_KIND, session_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    Ok(rows
        .filter_map(Result::ok)
        .filter_map(|(session_id, payload)| {
            serde_json::from_str::<Value>(&payload)
                .ok()?
                .get("requestId")
                .and_then(Value::as_str)
                .map(|request_id| (session_id, request_id.to_string()))
        })
        .collect())
}

fn payload_starts_agent(payload: &Value) -> bool {
    match payload.get("action").and_then(Value::as_str) {
        Some("spawn_agent") => true,
        Some("handoff_task" | "request_review") => payload
            .get("target")
            .and_then(Value::as_str)
            .is_none_or(is_new_agent_target),
        _ => false,
    }
}

fn find_authorization_payload(
    db: &Connection,
    session_id: &str,
    request_id: &str,
) -> Result<Option<Value>> {
    let mut statement = db.prepare(
        "SELECT payload_json FROM session_events
         WHERE session_id = ?1 AND kind = ?2 ORDER BY id DESC LIMIT 500",
    )?;
    let rows = statement.query_map(params![session_id, AGENT_CONTROL_EVENT_KIND], |row| {
        row.get::<_, String>(0)
    })?;
    for row in rows {
        let payload: Value = serde_json::from_str(&row?)?;
        if payload.get("requestId").and_then(Value::as_str) == Some(request_id) {
            return Ok(Some(payload));
        }
    }
    Ok(None)
}

fn prior_authorization(
    db: &Connection,
    req: &AgentControlRequestDto,
) -> Result<Option<AgentControlAuthorizationDto>> {
    let Some(payload) = find_authorization_payload(db, &req.source_session_id, &req.request_id)?
    else {
        return Ok(None);
    };
    let request_files = serde_json::to_value(&req.files)?;
    let same_request = payload.get("action").and_then(Value::as_str) == Some(&req.action)
        && payload.get("canvasId").and_then(Value::as_str) == Some(&req.canvas_id)
        && payload.get("sourceNodeId").and_then(Value::as_str) == Some(&req.source_node_id)
        && optional_payload_str(&payload, "target") == req.target.as_deref()
        && optional_payload_str(&payload, "message") == req.message.as_deref()
        && optional_payload_str(&payload, "taskId") == req.task_id.as_deref()
        && optional_payload_str(&payload, "adapterId") == req.adapter_id.as_deref()
        && payload.get("files").cloned().unwrap_or(Value::Null) == request_files;
    let already_completed = prior_result_exists(db, &req.source_session_id, &req.request_id)?;
    Ok(Some(AgentControlAuthorizationDto {
        request_id: req.request_id.clone(),
        action: payload
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        decision: if already_completed || !same_request {
            "deny".to_string()
        } else {
            payload
                .get("decision")
                .and_then(Value::as_str)
                .unwrap_or("deny")
                .to_string()
        },
        reason: if !same_request {
            "Request id was reused with a different payload; execution was rejected.".to_string()
        } else if already_completed {
            "Request already completed; replay was rejected.".to_string()
        } else {
            "Duplicate request returned its original decision.".to_string()
        },
        source_depth: payload
            .get("sourceDepth")
            .and_then(Value::as_u64)
            .and_then(|depth| u8::try_from(depth).ok())
            .unwrap_or(0),
        next_depth: payload
            .get("nextDepth")
            .and_then(Value::as_u64)
            .and_then(|depth| u8::try_from(depth).ok())
            .unwrap_or(1),
        target_node_id: payload
            .get("targetNodeId")
            .and_then(Value::as_str)
            .map(str::to_string),
    }))
}

fn optional_payload_str<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload.get(key).and_then(Value::as_str)
}

fn prior_result_exists(db: &Connection, session_id: &str, request_id: &str) -> Result<bool> {
    let mut statement = db.prepare(
        "SELECT payload_json FROM session_events
         WHERE session_id = ?1 AND kind = ?2 ORDER BY id DESC LIMIT 500",
    )?;
    let rows = statement.query_map(params![session_id, AGENT_CONTROL_RESULT_KIND], |row| {
        row.get::<_, String>(0)
    })?;
    for row in rows {
        let payload: Value = serde_json::from_str(&row?)?;
        if payload.get("requestId").and_then(Value::as_str) == Some(request_id) {
            return Ok(true);
        }
    }
    Ok(false)
}
