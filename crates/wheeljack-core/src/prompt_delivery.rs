use super::*;

pub(crate) const MAX_PENDING_PROMPTS_PER_SESSION: i64 = 20;
pub(crate) const MAX_PENDING_PROMPTS_GLOBAL: i64 = 100;

pub(crate) fn prompt_delivery_payload_fingerprint(
    payload: &PromptDeliveryPayload,
) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(payload)?)
    ))
}

/// Keep minimal tombstones for idempotency; completed prompt bodies expire after a week.
pub(crate) fn prune_completed_prompt_payloads(db: &Connection, clear_all: bool) -> Result<usize> {
    Ok(db.execute(
        "UPDATE session_prompt_deliveries SET payload_json = NULL
         WHERE state IN ('delivered', 'canceled') AND payload_json IS NOT NULL
           AND (?1 OR julianday(updated_at) <= julianday('now', '-7 days'))",
        params![clear_all],
    )?)
}

pub(crate) fn has_dispatchable_prompt(db: &Connection, session_id: &str) -> Result<bool> {
    Ok(db.query_row(
        "SELECT COALESCE((SELECT state = 'queued' FROM session_prompt_deliveries
         WHERE session_id = ?1 AND state NOT IN ('delivered', 'canceled')
         ORDER BY seq LIMIT 1), 0)",
        params![session_id],
        |row| row.get(0),
    )?)
}

/// A resume changes runtime ownership, never the original idempotency identity.
pub(crate) fn rebind_prompt_deliveries(
    db: &Connection,
    prior_session_id: &str,
    session_id: &str,
) -> Result<Vec<PromptDeliveryDto>> {
    let tx = Transaction::new_unchecked(db, TransactionBehavior::Immediate)?;
    let same_conversation: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions prior JOIN sessions resumed
         ON prior.node_id = resumed.node_id AND prior.adapter_id = resumed.adapter_id
            AND prior.intent = resumed.intent
         WHERE prior.id = ?1 AND resumed.id = ?2)",
        params![prior_session_id, session_id],
        |row| row.get(0),
    )?;
    if !same_conversation {
        bail!("resumed prompt queue must belong to the same agent pane and intent");
    }
    let deliveries = list_prompt_deliveries(&tx, prior_session_id)?;
    let next_seq: u64 = tx.query_row(
        "SELECT COALESCE(MAX(seq), 0) FROM session_prompt_deliveries WHERE session_id = ?1",
        params![session_id],
        |row| row.get(0),
    )?;
    for (index, delivery) in deliveries.iter().enumerate() {
        let state = match delivery.state.as_str() {
            "queued" | "blocked" => "queued",
            "dispatching" => "indeterminate",
            state => state,
        };
        tx.execute(
            "UPDATE session_prompt_deliveries SET session_id = ?2, seq = ?3, state = ?4,
             dispatch_token = NULL, updated_at = ?5,
             error_code = CASE WHEN ?4 = 'queued' THEN NULL ELSE error_code END,
             error_message = CASE WHEN ?4 = 'queued' THEN NULL ELSE error_message END
             WHERE id = ?1",
            params![
                delivery.id,
                session_id,
                next_seq + index as u64 + 1,
                state,
                now()
            ],
        )?;
    }
    let rebound = list_prompt_deliveries(&tx, session_id)?;
    tx.commit()?;
    Ok(rebound)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PromptDeliveryPayload {
    pub(crate) prompt: String,
    pub(crate) history_text: String,
    #[serde(default)]
    pub(crate) standing_role_applied: bool,
    #[serde(default)]
    pub(crate) image_paths: Vec<String>,
    #[serde(default)]
    pub(crate) provider: Option<String>,
    #[serde(default)]
    pub(crate) model: Option<String>,
    #[serde(default)]
    pub(crate) thinking: Option<String>,
    #[serde(default)]
    pub(crate) approval_policy: Option<String>,
    #[serde(default)]
    pub(crate) sandbox: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PromptDeliveryDto {
    pub(crate) id: String,
    pub(crate) session_id: String,
    pub(crate) seq: u64,
    pub(crate) mode: String,
    pub(crate) state: String,
    pub(crate) payload: Option<PromptDeliveryPayload>,
    pub(crate) revision: u64,
    pub(crate) attempts: u64,
    pub(crate) error_code: Option<String>,
    pub(crate) error_message: Option<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) delivered_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubmitPromptDeliveryRequest {
    pub(crate) client_prompt_id: String,
    pub(crate) session_id: String,
    #[serde(default = "default_delivery_mode")]
    pub(crate) mode: String,
    pub(crate) payload: PromptDeliveryPayload,
}

fn default_delivery_mode() -> String {
    "auto".to_string()
}

pub(crate) fn submit_prompt_delivery(
    db: &Connection,
    req: &SubmitPromptDeliveryRequest,
) -> Result<PromptDeliveryDto> {
    validate_delivery_request(req)?;
    let payload_json = serde_json::to_string(&req.payload)?;
    if let Some(existing) = load_prompt_delivery(db, &req.client_prompt_id)? {
        let (request_session_id, fingerprint): (String, String) = db.query_row(
            "SELECT request_session_id, payload_fingerprint FROM session_prompt_deliveries WHERE id = ?1",
            params![req.client_prompt_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        if (existing.session_id != req.session_id && request_session_id != req.session_id)
            || existing.mode != req.mode
            || fingerprint != prompt_delivery_payload_fingerprint(&req.payload)?
        {
            bail!("prompt delivery id is already bound to different content");
        }
        return Ok(existing);
    }
    let session_exists = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?1)",
        params![req.session_id],
        |row| row.get::<_, bool>(0),
    )?;
    if !session_exists {
        bail!("unknown session: {}", req.session_id);
    }
    let unresolved_global: i64 = db.query_row(
        "SELECT COUNT(*) FROM session_prompt_deliveries
         WHERE state IN ('queued', 'dispatching', 'failed', 'indeterminate', 'blocked')",
        [],
        |row| row.get(0),
    )?;
    if unresolved_global >= MAX_PENDING_PROMPTS_GLOBAL {
        bail!("prompt delivery queue is full");
    }
    let unresolved_session: i64 = db.query_row(
        "SELECT COUNT(*) FROM session_prompt_deliveries
         WHERE session_id = ?1
           AND state IN ('queued', 'dispatching', 'failed', 'indeterminate', 'blocked')",
        params![req.session_id],
        |row| row.get(0),
    )?;
    if unresolved_session >= MAX_PENDING_PROMPTS_PER_SESSION {
        bail!("session prompt queue is full");
    }
    let next_seq: i64 = db.query_row(
        "SELECT COALESCE(MAX(seq), 0) + 1 FROM session_prompt_deliveries WHERE session_id = ?1",
        params![req.session_id],
        |row| row.get(0),
    )?;
    let timestamp = now();
    db.execute(
        "INSERT INTO session_prompt_deliveries
         (id, session_id, seq, mode, state, payload_json, revision, attempts,
          created_at, updated_at, request_session_id, payload_fingerprint)
         VALUES (?1, ?2, ?3, ?4, 'queued', ?5, 1, 0, ?6, ?6, ?2, ?7)",
        params![
            req.client_prompt_id,
            req.session_id,
            next_seq,
            req.mode,
            payload_json,
            timestamp,
            prompt_delivery_payload_fingerprint(&req.payload)?,
        ],
    )?;
    load_prompt_delivery(db, &req.client_prompt_id)?
        .ok_or_else(|| anyhow!("prompt delivery was not persisted"))
}

pub(crate) fn list_prompt_deliveries(
    db: &Connection,
    session_id: &str,
) -> Result<Vec<PromptDeliveryDto>> {
    let mut statement = db.prepare(
        "SELECT id, session_id, seq, mode, state, payload_json, revision, attempts,
                error_code, error_message, created_at, updated_at, delivered_at
         FROM session_prompt_deliveries
         WHERE session_id = ?1
           AND state NOT IN ('delivered', 'canceled')
         ORDER BY seq ASC",
    )?;
    let rows = statement.query_map(params![session_id], prompt_delivery_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub(crate) fn load_prompt_delivery(
    db: &Connection,
    delivery_id: &str,
) -> Result<Option<PromptDeliveryDto>> {
    db.query_row(
        "SELECT id, session_id, seq, mode, state, payload_json, revision, attempts,
                error_code, error_message, created_at, updated_at, delivered_at
         FROM session_prompt_deliveries WHERE id = ?1",
        params![delivery_id],
        prompt_delivery_from_row,
    )
    .optional()
    .map_err(Into::into)
}

pub(crate) fn claim_next_prompt_delivery(
    db: &Connection,
    session_id: &str,
) -> Result<Option<PromptDeliveryDto>> {
    let tx = db.unchecked_transaction()?;
    let delivery_id = tx
        .query_row(
            "SELECT id FROM session_prompt_deliveries
             WHERE session_id = ?1 AND state = 'queued'
               AND NOT EXISTS (
                 SELECT 1 FROM session_prompt_deliveries earlier
                 WHERE earlier.session_id = session_prompt_deliveries.session_id
                   AND earlier.seq < session_prompt_deliveries.seq
                   AND earlier.state NOT IN ('delivered', 'canceled')
               )
             ORDER BY seq ASC LIMIT 1",
            params![session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(delivery_id) = delivery_id else {
        tx.commit()?;
        return Ok(None);
    };
    let dispatch_token = Uuid::now_v7().to_string();
    let timestamp = now();
    tx.execute(
        "UPDATE session_prompt_deliveries
         SET state = 'dispatching', attempts = attempts + 1,
             dispatch_token = ?2, error_code = NULL, error_message = NULL, updated_at = ?3
         WHERE id = ?1 AND state = 'queued'",
        params![delivery_id, dispatch_token, timestamp],
    )?;
    tx.commit()?;
    load_prompt_delivery(db, &delivery_id)
}

pub(crate) fn complete_prompt_delivery(db: &Connection, delivery_id: &str) -> Result<()> {
    let timestamp = now();
    db.execute(
        "UPDATE session_prompt_deliveries
         SET state = 'delivered', dispatch_token = NULL,
             error_code = NULL, error_message = NULL, delivered_at = ?2, updated_at = ?2
         WHERE id = ?1 AND state = 'dispatching'",
        params![delivery_id, timestamp],
    )?;
    Ok(())
}

pub(crate) fn persist_accepted_prompt_delivery(
    db: &Connection,
    delivery: &PromptDeliveryDto,
    history_seq: u64,
    history_line: &[u8],
) -> Result<()> {
    let tx = Transaction::new_unchecked(db, TransactionBehavior::Immediate)?;
    let dispatching: bool = tx.query_row(
        "SELECT state = 'dispatching' AND session_id = ?2 FROM session_prompt_deliveries WHERE id = ?1",
        params![delivery.id, delivery.session_id], |row| row.get(0),
    ).optional()?.unwrap_or(false);
    if dispatching {
        persist_session_stream_chunks_in_transaction(
            &tx,
            &delivery.session_id,
            &[(history_seq, "agent-input", history_line)],
            true,
        )?;
        complete_prompt_delivery(&tx, &delivery.id)?;
    }
    tx.commit()?;
    Ok(())
}

pub(crate) fn settle_prompt_delivery_error(
    db: &Connection,
    delivery_id: &str,
    state: &str,
    code: &str,
    message: &str,
) -> Result<()> {
    if !matches!(state, "queued" | "failed" | "indeterminate" | "blocked") {
        bail!("unsupported prompt delivery error state: {state}");
    }
    db.execute(
        "UPDATE session_prompt_deliveries
         SET state = ?2, dispatch_token = NULL, error_code = ?3,
             error_message = ?4, updated_at = ?5
         WHERE id = ?1",
        params![delivery_id, state, code, message, now()],
    )?;
    Ok(())
}

pub(crate) fn settle_dispatched_prompt_error(
    db: &Connection,
    delivery: &PromptDeliveryDto,
    state: &str,
    code: &str,
    message: &str,
) -> Result<()> {
    let tx = Transaction::new_unchecked(db, TransactionBehavior::Immediate)?;
    let still_owned: bool = tx.query_row(
        "SELECT session_id = ?2 AND state = 'dispatching' FROM session_prompt_deliveries WHERE id = ?1",
        params![delivery.id, delivery.session_id], |row| row.get(0),
    ).optional()?.unwrap_or(false);
    if still_owned {
        settle_prompt_delivery_error(&tx, &delivery.id, state, code, message)?;
    }
    tx.commit()?;
    Ok(())
}

pub(crate) fn retry_prompt_delivery(
    db: &Connection,
    delivery_id: &str,
) -> Result<PromptDeliveryDto> {
    let changed = db.execute(
        "UPDATE session_prompt_deliveries
         SET state = 'queued', error_code = NULL, error_message = NULL,
             dispatch_token = NULL, updated_at = ?2
         WHERE id = ?1 AND state IN ('failed', 'indeterminate', 'blocked')",
        params![delivery_id, now()],
    )?;
    if changed != 1 {
        bail!("prompt delivery is not retryable");
    }
    load_prompt_delivery(db, delivery_id)?.ok_or_else(|| anyhow!("prompt delivery is missing"))
}

pub(crate) fn edit_prompt_delivery(
    db: &Connection,
    delivery_id: &str,
    payload: &PromptDeliveryPayload,
) -> Result<PromptDeliveryDto> {
    validate_delivery_payload(payload)?;
    let changed = db.execute(
        "UPDATE session_prompt_deliveries
         SET payload_json = ?2, state = 'queued', revision = revision + 1,
             error_code = NULL, error_message = NULL, dispatch_token = NULL, updated_at = ?3,
             payload_fingerprint = ?4
         WHERE id = ?1 AND state IN ('queued', 'failed', 'indeterminate', 'blocked')",
        params![
            delivery_id,
            serde_json::to_string(payload)?,
            now(),
            prompt_delivery_payload_fingerprint(payload)?
        ],
    )?;
    if changed != 1 {
        bail!("prompt delivery cannot be edited in its current state");
    }
    load_prompt_delivery(db, delivery_id)?.ok_or_else(|| anyhow!("prompt delivery is missing"))
}

pub(crate) fn cancel_prompt_delivery(
    db: &Connection,
    delivery_id: &str,
) -> Result<PromptDeliveryDto> {
    let changed = db.execute(
        "UPDATE session_prompt_deliveries
         SET state = 'canceled', dispatch_token = NULL,
             error_code = NULL, error_message = NULL, updated_at = ?2
         WHERE id = ?1 AND state IN ('queued', 'failed', 'indeterminate', 'blocked')",
        params![delivery_id, now()],
    )?;
    if changed != 1 {
        bail!("prompt delivery cannot be canceled in its current state");
    }
    load_prompt_delivery(db, delivery_id)?.ok_or_else(|| anyhow!("prompt delivery is missing"))
}

pub(crate) fn recover_prompt_deliveries(db: &Connection) -> Result<()> {
    let timestamp = now();
    db.execute(
        "UPDATE session_prompt_deliveries
         SET state = 'indeterminate', dispatch_token = NULL,
             error_code = 'interrupted_dispatch',
             error_message = 'wheeljack stopped before prompt delivery could be confirmed.',
             updated_at = ?1
         WHERE state = 'dispatching'",
        params![timestamp],
    )?;
    db.execute(
        "UPDATE session_prompt_deliveries
         SET state = 'blocked',
             error_code = 'session_not_running',
             error_message = 'Resume the agent session before sending this prompt.',
             updated_at = ?1
         WHERE state = 'queued'
           AND session_id IN (SELECT id FROM sessions WHERE status <> 'running')",
        params![timestamp],
    )?;
    Ok(())
}

fn validate_delivery_request(req: &SubmitPromptDeliveryRequest) -> Result<()> {
    if Uuid::parse_str(req.client_prompt_id.trim()).is_err() {
        bail!("clientPromptId must be a UUID");
    }
    if req.session_id.trim().is_empty() || req.session_id.len() > 160 {
        bail!("sessionId is invalid");
    }
    if !matches!(req.mode.as_str(), "auto" | "next" | "steer") {
        bail!("prompt delivery mode must be auto, next, or steer");
    }
    validate_delivery_payload(&req.payload)
}

fn validate_delivery_payload(payload: &PromptDeliveryPayload) -> Result<()> {
    if payload.prompt.trim().is_empty() && payload.image_paths.is_empty() {
        bail!("prompt text or an image is required");
    }
    if payload.prompt.len() > 1_000_000 || payload.history_text.len() > 1_000_000 {
        bail!("prompt is too large");
    }
    if payload.image_paths.len() > 4 {
        bail!("no more than four images may be attached");
    }
    Ok(())
}

fn prompt_delivery_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PromptDeliveryDto> {
    let payload_json = row.get::<_, Option<String>>(5)?;
    let payload = payload_json
        .as_deref()
        .map(serde_json::from_str::<PromptDeliveryPayload>)
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    Ok(PromptDeliveryDto {
        id: row.get(0)?,
        session_id: row.get(1)?,
        seq: row.get(2)?,
        mode: row.get(3)?,
        state: row.get(4)?,
        payload,
        revision: row.get(6)?,
        attempts: row.get(7)?,
        error_code: row.get(8)?,
        error_message: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        delivered_at: row.get(12)?,
    })
}
