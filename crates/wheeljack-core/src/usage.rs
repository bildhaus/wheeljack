use super::*;

const USAGE_BILLING_OVERRIDES_KEY: &str = "usageBillingOverrides";
const SUPPORTED_USAGE_ADAPTERS: [&str; 4] =
    ["codex-cli", "claude-code", "opencode", "pi-coding-agent"];

#[derive(Debug, Clone)]
struct UsageObservation {
    source_event_key: String,
    provider_id: Option<String>,
    model_id: Option<String>,
    input_tokens: i64,
    output_tokens: i64,
    reasoning_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    source_total_tokens: Option<i64>,
    cost_nano_usd: Option<i64>,
}

#[derive(Default)]
struct UsageSessionMeta {
    node_id: String,
    node_title: String,
    project_id: Option<String>,
    project_name: Option<String>,
    cwd: String,
    provider_id: Option<String>,
    model_id: Option<String>,
    auth_classification: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageAmounts {
    cost_nano_usd: i64,
    input_tokens: i64,
    output_tokens: i64,
    reasoning_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    priced_records: u64,
    unpriced_records: u64,
}

impl UsageAmounts {
    fn add(&mut self, row: &UsageRow) -> Result<()> {
        self.input_tokens = checked_sum(self.input_tokens, row.input_tokens)?;
        self.output_tokens = checked_sum(self.output_tokens, row.output_tokens)?;
        self.reasoning_tokens = checked_sum(self.reasoning_tokens, row.reasoning_tokens)?;
        self.cache_read_tokens = checked_sum(self.cache_read_tokens, row.cache_read_tokens)?;
        self.cache_write_tokens = checked_sum(self.cache_write_tokens, row.cache_write_tokens)?;
        if let Some(cost) = row.cost_nano_usd {
            self.cost_nano_usd = checked_sum(self.cost_nano_usd, cost)?;
            self.priced_records = self
                .priced_records
                .checked_add(1)
                .ok_or_else(|| anyhow!("usage record count overflow"))?;
        } else {
            self.unpriced_records = self
                .unpriced_records
                .checked_add(1)
                .ok_or_else(|| anyhow!("usage record count overflow"))?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageBreakdown {
    key: String,
    label: String,
    totals: UsageAmounts,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageDailyPoint {
    day: String,
    totals: UsageAmounts,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageSessionRow {
    session_id: String,
    node_id: String,
    node_title: String,
    adapter_id: String,
    provider_id: String,
    model_id: Option<String>,
    project_id: Option<String>,
    project_name: Option<String>,
    cwd: String,
    status: String,
    started_at: String,
    last_occurred_at: String,
    totals: UsageAmounts,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsagePendingProfile {
    adapter_id: String,
    provider_id: String,
    record_count: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageCoverage {
    unpriced_records: u64,
    excluded_subscription_records: u64,
    unknown_records: u64,
    unsupported_sessions: u64,
    supported_sessions_without_usage: u64,
    pending_profiles: Vec<UsagePendingProfile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageFilterOption {
    key: String,
    label: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageFilterOptions {
    adapters: Vec<UsageFilterOption>,
    providers: Vec<UsageFilterOption>,
    models: Vec<UsageFilterOption>,
    projects: Vec<UsageFilterOption>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageDashboard {
    totals: UsageAmounts,
    daily: Vec<UsageDailyPoint>,
    providers: Vec<UsageBreakdown>,
    models: Vec<UsageBreakdown>,
    projects: Vec<UsageBreakdown>,
    sessions: Vec<UsageSessionRow>,
    next_cursor: Option<String>,
    coverage: UsageCoverage,
    options: UsageFilterOptions,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct UsageDashboardRequest {
    from: Option<String>,
    to: Option<String>,
    project_id: Option<String>,
    adapter_id: Option<String>,
    provider_id: Option<String>,
    model_id: Option<String>,
    session_cursor: Option<String>,
    session_limit: Option<usize>,
}

#[derive(Clone)]
struct UsageRow {
    session_id: String,
    adapter_id: String,
    provider_id: String,
    model_id: Option<String>,
    node_id: String,
    node_title: String,
    project_id: Option<String>,
    project_name: Option<String>,
    cwd: String,
    occurred_at: String,
    local_day: String,
    input_tokens: i64,
    output_tokens: i64,
    reasoning_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    cost_nano_usd: Option<i64>,
    billing_classification: String,
    status: String,
    started_at: String,
}

pub(crate) fn ingest_agent_usage_line(
    db: &Connection,
    session_id: &str,
    adapter_id: &str,
    protocol: &str,
    line: &str,
    sequence: u64,
) -> Result<bool> {
    let Ok(raw) = serde_json::from_str::<Value>(line.trim()) else {
        return Ok(false);
    };
    if !raw.is_object() {
        return Ok(false);
    }
    update_usage_session_context(db, session_id, adapter_id, &raw)?;
    let observations = parse_usage_observations(adapter_id, protocol, &raw, line, sequence);
    if observations.is_empty() {
        return Ok(false);
    }
    let pi_snapshot = observations
        .iter()
        .any(|observation| observation.source_event_key == "pi:session-total");
    if (adapter_id == "pi-coding-agent" || protocol == "pi-rpc")
        && !pi_snapshot
        && db.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM usage_records
               WHERE session_id = ?1 AND source_event_key = 'pi:session-total'
             )",
            params![session_id],
            |row| row.get::<_, bool>(0),
        )?
    {
        return Ok(false);
    }
    let meta = load_usage_session_meta(db, session_id)?;
    let overrides = load_usage_billing_overrides(db)?;
    let timestamp = now();
    let mut changed = false;
    for observation in observations {
        let provider_id = observation
            .provider_id
            .clone()
            .or_else(|| meta.provider_id.clone())
            .unwrap_or_else(|| adapter_id.to_string());
        let model_id = observation
            .model_id
            .clone()
            .or_else(|| meta.model_id.clone());
        let billing = classify_billing(
            adapter_id,
            &provider_id,
            &meta.auth_classification,
            observation.cost_nano_usd.is_some(),
            &overrides,
        );
        let cost_source = if observation.cost_nano_usd.is_some() {
            "cli_reported"
        } else {
            "unpriced"
        };
        db.execute(
            "INSERT INTO usage_records (
               session_id, source_event_key, adapter_id, provider_id, model_id,
               node_id, node_title, project_id, project_name, cwd, occurred_at,
               input_tokens, output_tokens, reasoning_tokens, cache_read_tokens,
               cache_write_tokens, source_total_tokens, cost_nano_usd, cost_source,
               billing_classification, created_at, updated_at
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
               ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?11, ?11
             )
             ON CONFLICT(session_id, source_event_key) DO UPDATE SET
               provider_id = excluded.provider_id,
               model_id = excluded.model_id,
               node_title = excluded.node_title,
               project_id = excluded.project_id,
               project_name = excluded.project_name,
               cwd = excluded.cwd,
               occurred_at = excluded.occurred_at,
               input_tokens = excluded.input_tokens,
               output_tokens = excluded.output_tokens,
               reasoning_tokens = excluded.reasoning_tokens,
               cache_read_tokens = excluded.cache_read_tokens,
               cache_write_tokens = excluded.cache_write_tokens,
               source_total_tokens = excluded.source_total_tokens,
               cost_nano_usd = excluded.cost_nano_usd,
               cost_source = excluded.cost_source,
               billing_classification = excluded.billing_classification,
               updated_at = excluded.updated_at",
            params![
                session_id,
                observation.source_event_key,
                adapter_id,
                provider_id,
                model_id,
                meta.node_id,
                meta.node_title,
                meta.project_id,
                meta.project_name,
                meta.cwd,
                timestamp,
                observation.input_tokens,
                observation.output_tokens,
                observation.reasoning_tokens,
                observation.cache_read_tokens,
                observation.cache_write_tokens,
                observation.source_total_tokens,
                observation.cost_nano_usd,
                cost_source,
                billing,
            ],
        )?;
        changed = true;
    }
    if pi_snapshot {
        db.execute(
            "DELETE FROM usage_records
             WHERE session_id = ?1
               AND adapter_id = 'pi-coding-agent'
               AND source_event_key <> 'pi:session-total'",
            params![session_id],
        )?;
    }
    Ok(changed)
}

pub(crate) fn query_usage_dashboard(db: &Connection, payload: Value) -> Result<Value> {
    let request = serde_json::from_value::<UsageDashboardRequest>(payload)?;
    validate_usage_filter(request.from.as_deref(), "from")?;
    validate_usage_filter(request.to.as_deref(), "to")?;
    for (value, name) in [
        (request.project_id.as_deref(), "projectId"),
        (request.adapter_id.as_deref(), "adapterId"),
        (request.provider_id.as_deref(), "providerId"),
        (request.model_id.as_deref(), "modelId"),
    ] {
        validate_usage_filter(value, name)?;
    }

    let overrides = load_usage_billing_overrides(db)?;
    let mut rows = load_usage_rows(db, request.from.as_deref(), request.to.as_deref())?;
    for row in &mut rows {
        if row.billing_classification == "unknown" {
            if let Some(classification) =
                overrides.get(&override_key(&row.adapter_id, &row.provider_id))
            {
                row.billing_classification.clone_from(classification);
            }
        }
    }
    let options = usage_filter_options(&rows);
    let observed_session_ids = rows
        .iter()
        .map(|row| row.session_id.as_str())
        .collect::<HashSet<_>>();
    let (unsupported_sessions, supported_sessions_without_usage) = usage_session_coverage(
        db,
        request.from.as_deref(),
        request.to.as_deref(),
        &observed_session_ids,
    )?;
    let filtered = rows
        .iter()
        .filter(|row| usage_row_matches(row, &request))
        .collect::<Vec<_>>();

    let mut coverage = UsageCoverage {
        unsupported_sessions,
        supported_sessions_without_usage,
        ..Default::default()
    };
    let mut pending = BTreeMap::<(String, String), u64>::new();
    for row in &filtered {
        match row.billing_classification.as_str() {
            "metered" if row.cost_nano_usd.is_none() => coverage.unpriced_records += 1,
            "subscription" => coverage.excluded_subscription_records += 1,
            "unknown" => {
                coverage.unknown_records += 1;
                *pending
                    .entry((row.adapter_id.clone(), row.provider_id.clone()))
                    .or_default() += 1;
            }
            _ => {}
        }
    }
    coverage.pending_profiles = pending
        .into_iter()
        .map(
            |((adapter_id, provider_id), record_count)| UsagePendingProfile {
                adapter_id,
                provider_id,
                record_count,
            },
        )
        .collect();

    let metered = filtered
        .into_iter()
        .filter(|row| row.billing_classification == "metered")
        .collect::<Vec<_>>();
    let mut totals = UsageAmounts::default();
    let mut daily = BTreeMap::<String, UsageAmounts>::new();
    let mut providers = BTreeMap::<String, UsageBreakdown>::new();
    let mut models = BTreeMap::<String, UsageBreakdown>::new();
    let mut projects = BTreeMap::<String, UsageBreakdown>::new();
    let mut sessions = BTreeMap::<String, UsageSessionRow>::new();
    for row in metered {
        totals.add(row)?;
        daily.entry(row.local_day.clone()).or_default().add(row)?;
        add_breakdown(&mut providers, &row.provider_id, &row.provider_id, row)?;
        let model_key = row.model_id.as_deref().unwrap_or("unknown-model");
        let model_label = row.model_id.as_deref().unwrap_or("Unknown model");
        add_breakdown(&mut models, model_key, model_label, row)?;
        let project_key = row.project_id.as_deref().unwrap_or("other-sessions");
        let project_label = row.project_name.as_deref().unwrap_or("Other sessions");
        add_breakdown(&mut projects, project_key, project_label, row)?;

        let session = sessions
            .entry(row.session_id.clone())
            .or_insert_with(|| UsageSessionRow {
                session_id: row.session_id.clone(),
                node_id: row.node_id.clone(),
                node_title: row.node_title.clone(),
                adapter_id: row.adapter_id.clone(),
                provider_id: row.provider_id.clone(),
                model_id: row.model_id.clone(),
                project_id: row.project_id.clone(),
                project_name: row.project_name.clone(),
                cwd: row.cwd.clone(),
                status: row.status.clone(),
                started_at: row.started_at.clone(),
                last_occurred_at: row.occurred_at.clone(),
                totals: UsageAmounts::default(),
            });
        session.totals.add(row)?;
        if row.occurred_at > session.last_occurred_at {
            session.last_occurred_at.clone_from(&row.occurred_at);
        }
    }

    let mut session_rows = sessions.into_values().collect::<Vec<_>>();
    session_rows.sort_by(|left, right| {
        right
            .last_occurred_at
            .cmp(&left.last_occurred_at)
            .then_with(|| right.session_id.cmp(&left.session_id))
    });
    let start = request
        .session_cursor
        .as_deref()
        .and_then(|cursor| {
            session_rows
                .iter()
                .position(|row| usage_session_cursor(row) == cursor)
        })
        .map_or(0, |index| index + 1);
    let limit = request.session_limit.unwrap_or(50).clamp(1, 100);
    let end = start.saturating_add(limit).min(session_rows.len());
    let page = session_rows[start..end].to_vec();
    let next_cursor = (end < session_rows.len())
        .then(|| page.last().map(usage_session_cursor))
        .flatten();

    let dashboard = UsageDashboard {
        totals,
        daily: daily
            .into_iter()
            .map(|(day, totals)| UsageDailyPoint { day, totals })
            .collect(),
        providers: sorted_breakdowns(providers),
        models: sorted_breakdowns(models),
        projects: sorted_breakdowns(projects),
        sessions: page,
        next_cursor,
        coverage,
        options,
    };
    Ok(serde_json::to_value(dashboard)?)
}

pub(crate) fn set_usage_billing_override(db: &Connection, payload: Value) -> Result<Value> {
    let adapter_id = bounded_profile_value(payload.get("adapterId"), "adapterId")?;
    let provider_id = bounded_profile_value(payload.get("providerId"), "providerId")?;
    let billing_kind = match payload.get("billingKind").and_then(Value::as_str) {
        Some("api") => "metered",
        Some("subscription") => "subscription",
        _ => bail!("billingKind must be api or subscription"),
    };
    let mut overrides = load_usage_billing_overrides(db)?;
    overrides.insert(
        override_key(&adapter_id, &provider_id),
        billing_kind.to_string(),
    );
    persist_usage_billing_overrides(db, &overrides)?;
    Ok(json!({
        "adapterId": adapter_id,
        "providerId": provider_id,
        "billingKind": if billing_kind == "metered" { "api" } else { "subscription" },
    }))
}

pub(crate) fn clear_usage_data(db: &mut Connection) -> Result<Value> {
    let tx = db.transaction()?;
    let deleted = tx.execute("DELETE FROM usage_records", [])?;
    tx.commit()?;
    Ok(json!({ "deletedRecords": deleted }))
}

pub(crate) fn sanitize_usage_billing_overrides(value: &Value) -> Option<Value> {
    let entries = value.as_array()?;
    let mut overrides = BTreeMap::<String, (String, String, String)>::new();
    for entry in entries.iter().take(128) {
        let Ok(adapter_id) = bounded_profile_value(entry.get("adapterId"), "adapterId") else {
            continue;
        };
        let Ok(provider_id) = bounded_profile_value(entry.get("providerId"), "providerId") else {
            continue;
        };
        let billing_kind = match entry.get("billingKind").and_then(Value::as_str) {
            Some("api") => "api",
            Some("subscription") => "subscription",
            _ => continue,
        };
        overrides.insert(
            override_key(&adapter_id, &provider_id),
            (adapter_id, provider_id, billing_kind.to_string()),
        );
    }
    Some(json!(overrides
        .into_values()
        .map(|(adapter_id, provider_id, billing_kind)| json!({
            "adapterId": adapter_id,
            "providerId": provider_id,
            "billingKind": billing_kind,
        }))
        .collect::<Vec<_>>()))
}

fn parse_usage_observations(
    adapter_id: &str,
    protocol: &str,
    raw: &Value,
    line: &str,
    sequence: u64,
) -> Vec<UsageObservation> {
    if protocol == "codex-app-server" || adapter_id == "codex-cli" {
        parse_codex_usage(raw, line)
    } else if protocol == "claude-stream-json" || adapter_id == "claude-code" {
        parse_claude_usage(raw, line, sequence)
    } else if protocol == "opencode-sse" || adapter_id == "opencode" {
        parse_opencode_usage(raw, line)
    } else if protocol == "pi-rpc" || adapter_id == "pi-coding-agent" {
        parse_pi_usage(raw, line)
    } else {
        Vec::new()
    }
}

fn parse_codex_usage(raw: &Value, line: &str) -> Vec<UsageObservation> {
    let method = raw
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if normalize_event_name(method) != "thread tokenusage updated" {
        return Vec::new();
    }
    let Some(params) = raw.get("params") else {
        return Vec::new();
    };
    let Some(usage) = params
        .get("tokenUsage")
        .or_else(|| params.get("token_usage"))
        .and_then(|usage| usage.get("last"))
    else {
        return Vec::new();
    };
    let Some(tokens) = usage_tokens(usage) else {
        return Vec::new();
    };
    let event_id = params
        .get("turnId")
        .or_else(|| params.get("turn_id"))
        .and_then(Value::as_str);
    vec![tokens.into_observation(
        stable_source_key("codex", event_id, line),
        Some("openai".to_string()),
        None,
        None,
    )]
}

fn parse_claude_usage(raw: &Value, line: &str, _sequence: u64) -> Vec<UsageObservation> {
    if raw.get("type").and_then(Value::as_str) != Some("result") {
        return Vec::new();
    }
    let event_id = raw
        .get("uuid")
        .or_else(|| raw.get("message_id"))
        .or_else(|| raw.get("session_id"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let source_key = stable_source_key("claude", event_id.as_deref(), line);
    if let Some(models) = raw
        .get("modelUsage")
        .or_else(|| raw.get("model_usage"))
        .and_then(Value::as_object)
        .filter(|models| !models.is_empty())
    {
        return models
            .iter()
            .filter_map(|(model, usage)| {
                let tokens = usage_tokens(usage)?;
                let cost =
                    optional_cost_nano(usage.get("costUSD").or_else(|| usage.get("cost_usd")))?;
                Some(tokens.into_observation(
                    format!("{source_key}:{model}"),
                    Some("anthropic".to_string()),
                    Some(model.clone()),
                    cost,
                ))
            })
            .collect();
    }
    let Some(usage) = raw.get("usage") else {
        return Vec::new();
    };
    let Some(tokens) = usage_tokens(usage) else {
        return Vec::new();
    };
    let Some(cost) = optional_cost_nano(
        raw.get("total_cost_usd")
            .or_else(|| raw.get("totalCostUsd")),
    ) else {
        return Vec::new();
    };
    vec![tokens.into_observation(
        source_key,
        Some("anthropic".to_string()),
        raw.get("model").and_then(Value::as_str).map(str::to_string),
        cost,
    )]
}

fn parse_opencode_usage(raw: &Value, line: &str) -> Vec<UsageObservation> {
    let source = raw.get("payload").unwrap_or(raw);
    let event_type = source
        .get("type")
        .or_else(|| source.get("event"))
        .and_then(Value::as_str)
        .map(normalize_event_name)
        .unwrap_or_default();
    if event_type != "message updated" {
        return Vec::new();
    }
    let source = source.get("properties").unwrap_or(source);
    let info = source.get("info").unwrap_or(source);
    if info.get("role").and_then(Value::as_str) != Some("assistant") {
        return Vec::new();
    }
    let Some(usage) = info.get("tokens") else {
        return Vec::new();
    };
    let Some(tokens) = usage_tokens(usage) else {
        return Vec::new();
    };
    let Some(cost) = optional_cost_nano(info.get("cost")) else {
        return Vec::new();
    };
    let event_id = first_string(info, &["id", "messageID", "messageId", "message_id"]);
    vec![tokens.into_observation(
        stable_source_key("opencode", event_id.as_deref(), line),
        first_string(
            info,
            &["providerID", "providerId", "provider_id", "provider"],
        ),
        first_string(info, &["modelID", "modelId", "model_id", "model"]),
        cost,
    )]
}

fn parse_pi_usage(raw: &Value, line: &str) -> Vec<UsageObservation> {
    let event_type = raw
        .get("type")
        .and_then(Value::as_str)
        .map(normalize_event_name)
        .unwrap_or_default();
    if event_type == "response"
        && raw.get("command").and_then(Value::as_str) == Some("get_session_stats")
        && raw.get("success").and_then(Value::as_bool) != Some(false)
    {
        let Some(stats) = raw.get("data") else {
            return Vec::new();
        };
        let Some(tokens) = stats.get("tokens").and_then(usage_tokens) else {
            return Vec::new();
        };
        let Some(cost) = optional_cost_nano(stats.get("cost")) else {
            return Vec::new();
        };
        return vec![tokens.into_observation("pi:session-total".to_string(), None, None, cost)];
    }

    let (usage, provider, model, event_id) = if event_type == "message end" {
        let message = raw.get("message").unwrap_or(raw);
        if !matches!(
            message.get("role").and_then(Value::as_str),
            Some("assistant" | "toolResult")
        ) {
            return Vec::new();
        }
        let Some(usage) = message.get("usage").or_else(|| raw.get("usage")) else {
            return Vec::new();
        };
        (
            usage,
            first_string(message, &["provider", "providerId", "provider_id"]),
            first_string(message, &["model", "modelId", "model_id"]),
            first_string(
                message,
                &[
                    "id",
                    "messageId",
                    "message_id",
                    "toolCallId",
                    "toolCallID",
                    "tool_call_id",
                ],
            ),
        )
    } else if event_type == "compaction end" {
        let Some(result) = raw.get("result") else {
            return Vec::new();
        };
        let Some(usage) = result.get("usage") else {
            return Vec::new();
        };
        (usage, None, None, None)
    } else {
        return Vec::new();
    };
    let Some(tokens) = usage_tokens(usage) else {
        return Vec::new();
    };
    let cost_value = usage
        .get("cost")
        .and_then(|cost| cost.get("total").or(Some(cost)))
        .or_else(|| {
            raw.get("cost")
                .and_then(|cost| cost.get("total").or(Some(cost)))
        });
    let Some(cost) = optional_cost_nano(cost_value) else {
        return Vec::new();
    };
    vec![tokens.into_observation(
        stable_source_key("pi", event_id.as_deref(), line),
        provider,
        model,
        cost,
    )]
}

#[derive(Default)]
struct ParsedTokens {
    input: i64,
    output: i64,
    reasoning: i64,
    cache_read: i64,
    cache_write: i64,
    source_total: Option<i64>,
}

impl ParsedTokens {
    fn into_observation(
        self,
        source_event_key: String,
        provider_id: Option<String>,
        model_id: Option<String>,
        cost_nano_usd: Option<i64>,
    ) -> UsageObservation {
        UsageObservation {
            source_event_key,
            provider_id,
            model_id,
            input_tokens: self.input,
            output_tokens: self.output,
            reasoning_tokens: self.reasoning,
            cache_read_tokens: self.cache_read,
            cache_write_tokens: self.cache_write,
            source_total_tokens: self.source_total,
            cost_nano_usd,
        }
    }
}

fn usage_tokens(value: &Value) -> Option<ParsedTokens> {
    let cache = value.get("cache");
    Some(ParsedTokens {
        input: token_field(value, &["input", "inputTokens", "input_tokens"])?,
        output: token_field(value, &["output", "outputTokens", "output_tokens"])?,
        reasoning: token_field(
            value,
            &[
                "reasoning",
                "reasoningTokens",
                "reasoning_tokens",
                "reasoningOutputTokens",
            ],
        )?,
        cache_read: token_field(
            value,
            &[
                "cacheRead",
                "cache_read",
                "cacheReadTokens",
                "cacheReadInputTokens",
                "cachedInputTokens",
                "cache_read_input_tokens",
            ],
        )?
        .checked_add(cache.map_or(Some(0), |cache| token_field(cache, &["read"]))?)?,
        cache_write: token_field(
            value,
            &[
                "cacheWrite",
                "cache_write",
                "cacheWriteTokens",
                "cacheWriteInputTokens",
                "cacheCreationInputTokens",
                "cache_creation_input_tokens",
            ],
        )?
        .checked_add(cache.map_or(Some(0), |cache| token_field(cache, &["write"]))?)?,
        source_total: optional_token_field(value, &["total", "totalTokens", "total_tokens"])?,
    })
}

fn token_field(value: &Value, names: &[&str]) -> Option<i64> {
    let Some(raw) = names.iter().find_map(|name| value.get(*name)) else {
        return Some(0);
    };
    nonnegative_i64(raw)
}

fn optional_token_field(value: &Value, names: &[&str]) -> Option<Option<i64>> {
    let Some(raw) = names.iter().find_map(|name| value.get(*name)) else {
        return Some(None);
    };
    nonnegative_i64(raw).map(Some)
}

fn nonnegative_i64(value: &Value) -> Option<i64> {
    if let Some(value) = value.as_u64() {
        return i64::try_from(value).ok();
    }
    value.as_i64().filter(|value| *value >= 0)
}

fn optional_cost_nano(value: Option<&Value>) -> Option<Option<i64>> {
    let Some(value) = value else {
        return Some(None);
    };
    if value.is_null() {
        return Some(None);
    }
    let value = value.as_f64()?;
    if !value.is_finite() || value < 0.0 || value > i64::MAX as f64 / 1_000_000_000.0 {
        return None;
    }
    Some(Some((value * 1_000_000_000.0).round() as i64))
}

fn stable_source_key(prefix: &str, id: Option<&str>, line: &str) -> String {
    if let Some(id) = id.filter(|id| !id.trim().is_empty()) {
        return format!("{prefix}:{}", id.trim());
    }
    let digest = Sha256::digest(line.as_bytes());
    format!("{prefix}:{digest:x}")
}

fn update_usage_session_context(
    db: &Connection,
    session_id: &str,
    adapter_id: &str,
    raw: &Value,
) -> Result<()> {
    let mut auth_classification = None;
    let mut auth_source = None;
    let mut provider_id = None;
    let mut model_id = None;
    if adapter_id == "claude-code"
        && raw.get("type").and_then(Value::as_str) == Some("system")
        && raw.get("subtype").and_then(Value::as_str) == Some("init")
    {
        provider_id = Some("anthropic".to_string());
        model_id = first_string(raw, &["model"]);
        auth_source = first_string(raw, &["apiKeySource", "api_key_source"]);
        auth_classification = auth_source.as_deref().map(classify_auth_source);
    } else if adapter_id == "codex-cli" {
        let method = raw
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let source = raw
            .get("params")
            .or_else(|| raw.get("result"))
            .unwrap_or(raw);
        let auth_mode = first_string(source, &["authMode", "auth_mode"]).or_else(|| {
            source
                .get("account")
                .and_then(|account| first_string(account, &["authMode", "auth_mode"]))
        });
        if normalize_event_name(method).contains("account") || auth_mode.is_some() {
            provider_id = Some("openai".to_string());
            auth_source = auth_mode;
            auth_classification = auth_source.as_deref().map(classify_auth_source);
        }
    }
    if auth_classification.is_none()
        && auth_source.is_none()
        && provider_id.is_none()
        && model_id.is_none()
    {
        return Ok(());
    }
    let timestamp = now();
    db.execute(
        "INSERT INTO usage_session_context (
           session_id, auth_classification, auth_source, provider_id, model_id, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(session_id) DO UPDATE SET
           auth_classification = CASE
             WHEN excluded.auth_classification = 'unknown' THEN usage_session_context.auth_classification
             ELSE excluded.auth_classification
           END,
           auth_source = COALESCE(excluded.auth_source, usage_session_context.auth_source),
           provider_id = COALESCE(excluded.provider_id, usage_session_context.provider_id),
           model_id = COALESCE(excluded.model_id, usage_session_context.model_id),
           updated_at = excluded.updated_at",
        params![
            session_id,
            auth_classification.as_deref().unwrap_or("unknown"),
            auth_source,
            provider_id,
            model_id,
            timestamp,
        ],
    )?;
    Ok(())
}

fn classify_auth_source(source: &str) -> String {
    let source = source.to_ascii_lowercase();
    if source.contains("api") || source.contains("env") || source.contains("key") {
        "metered".to_string()
    } else if source.contains("oauth")
        || source.contains("chatgpt")
        || source.contains("subscription")
        || source.contains("claude.ai")
    {
        "subscription".to_string()
    } else {
        "unknown".to_string()
    }
}

fn load_usage_session_meta(db: &Connection, session_id: &str) -> Result<UsageSessionMeta> {
    let row = db
        .query_row(
            "SELECT s.node_id, COALESCE(n.title, s.node_id), c.project_id, p.name,
                    s.cwd, s.command_json,
                    COALESCE(context.auth_classification, 'unknown'),
                    context.provider_id, context.model_id
             FROM sessions s
             LEFT JOIN nodes n ON n.id = s.node_id
             LEFT JOIN canvases c ON c.id = n.canvas_id
             LEFT JOIN projects p ON p.id = c.project_id
             LEFT JOIN usage_session_context context ON context.session_id = s.id
             WHERE s.id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                ))
            },
        )
        .optional()?;
    let Some((
        node_id,
        node_title,
        project_id,
        project_name,
        cwd,
        command_json,
        auth_classification,
        context_provider,
        context_model,
    )) = row
    else {
        return Ok(UsageSessionMeta {
            node_id: session_id.to_string(),
            node_title: session_id.to_string(),
            auth_classification: "unknown".to_string(),
            ..Default::default()
        });
    };
    let command = serde_json::from_str::<Value>(&command_json).unwrap_or(Value::Null);
    Ok(UsageSessionMeta {
        node_id,
        node_title,
        project_id,
        project_name,
        cwd,
        provider_id: context_provider.or_else(|| first_string(&command, &["provider"])),
        model_id: context_model.or_else(|| first_string(&command, &["model"])),
        auth_classification,
    })
}

fn classify_billing(
    adapter_id: &str,
    provider_id: &str,
    auth_classification: &str,
    has_reported_cost: bool,
    overrides: &BTreeMap<String, String>,
) -> String {
    if matches!(auth_classification, "metered" | "subscription") {
        return auth_classification.to_string();
    }
    let provider = provider_id.to_ascii_lowercase();
    if [
        "openai-codex",
        "github-copilot",
        "copilot",
        "claude-max",
        "claude-pro",
        "gemini-cli",
        "kimi-coding",
    ]
    .iter()
    .any(|value| provider == *value || provider.contains(value))
    {
        return "subscription".to_string();
    }
    if let Some(value) = overrides.get(&override_key(adapter_id, provider_id)) {
        return value.clone();
    }
    if has_reported_cost
        && !matches!(
            provider.as_str(),
            "anthropic" | "openai" | "google" | "google-gemini" | "unknown"
        )
    {
        return "metered".to_string();
    }
    "unknown".to_string()
}

fn load_usage_billing_overrides(db: &Connection) -> Result<BTreeMap<String, String>> {
    let value = db
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            params![USAGE_BILLING_OVERRIDES_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .and_then(|value| serde_json::from_str::<Value>(&value).ok())
        .unwrap_or_else(|| json!([]));
    let mut overrides = BTreeMap::new();
    for entry in value.as_array().into_iter().flatten() {
        let Some(adapter_id) = entry.get("adapterId").and_then(Value::as_str) else {
            continue;
        };
        let Some(provider_id) = entry.get("providerId").and_then(Value::as_str) else {
            continue;
        };
        let classification = match entry.get("billingKind").and_then(Value::as_str) {
            Some("api") => "metered",
            Some("subscription") => "subscription",
            _ => continue,
        };
        overrides.insert(
            override_key(adapter_id, provider_id),
            classification.to_string(),
        );
    }
    Ok(overrides)
}

fn persist_usage_billing_overrides(
    db: &Connection,
    overrides: &BTreeMap<String, String>,
) -> Result<()> {
    let entries = overrides
        .iter()
        .filter_map(|(key, classification)| {
            let (adapter_id, provider_id) = key.split_once('\u{1f}')?;
            Some(json!({
                "adapterId": adapter_id,
                "providerId": provider_id,
                "billingKind": if classification == "metered" { "api" } else { "subscription" },
            }))
        })
        .collect::<Vec<_>>();
    db.execute(
        "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)",
        params![
            USAGE_BILLING_OVERRIDES_KEY,
            json!(entries).to_string(),
            now()
        ],
    )?;
    Ok(())
}

fn load_usage_rows(db: &Connection, from: Option<&str>, to: Option<&str>) -> Result<Vec<UsageRow>> {
    let mut statement = db.prepare(
        "SELECT u.session_id, u.adapter_id, u.provider_id, u.model_id,
                u.node_id, u.node_title, u.project_id, u.project_name, u.cwd,
                u.occurred_at, COALESCE(date(u.occurred_at, 'localtime'), substr(u.occurred_at, 1, 10)),
                u.input_tokens, u.output_tokens, u.reasoning_tokens,
                u.cache_read_tokens, u.cache_write_tokens, u.cost_nano_usd,
                u.billing_classification, COALESCE(s.status, 'unknown'),
                COALESCE(s.started_at, s.created_at, u.occurred_at)
         FROM usage_records u
         LEFT JOIN sessions s ON s.id = u.session_id
         WHERE (?1 IS NULL OR u.occurred_at >= ?1)
           AND (?2 IS NULL OR u.occurred_at <= ?2)
         ORDER BY u.occurred_at ASC, u.id ASC",
    )?;
    let rows = statement.query_map(params![from, to], |row| {
        Ok(UsageRow {
            session_id: row.get(0)?,
            adapter_id: row.get(1)?,
            provider_id: row.get(2)?,
            model_id: row.get(3)?,
            node_id: row.get(4)?,
            node_title: row.get(5)?,
            project_id: row.get(6)?,
            project_name: row.get(7)?,
            cwd: row.get(8)?,
            occurred_at: row.get(9)?,
            local_day: row.get(10)?,
            input_tokens: row.get(11)?,
            output_tokens: row.get(12)?,
            reasoning_tokens: row.get(13)?,
            cache_read_tokens: row.get(14)?,
            cache_write_tokens: row.get(15)?,
            cost_nano_usd: row.get(16)?,
            billing_classification: row.get(17)?,
            status: row.get(18)?,
            started_at: row.get(19)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn usage_session_coverage(
    db: &Connection,
    from: Option<&str>,
    to: Option<&str>,
    observed_session_ids: &HashSet<&str>,
) -> Result<(u64, u64)> {
    let tracking_started_at = db
        .query_row(
            "SELECT value FROM usage_meta WHERE key = 'tracking_started_at'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let effective_from = match (from, tracking_started_at.as_deref()) {
        (Some(from), Some(tracking_started_at)) if from < tracking_started_at => {
            Some(tracking_started_at)
        }
        (Some(from), _) => Some(from),
        (None, Some(tracking_started_at)) => Some(tracking_started_at),
        (None, None) => None,
    };
    let mut statement = db.prepare(
        "SELECT id, adapter_id, command_json
         FROM sessions
         WHERE (?1 IS NULL OR COALESCE(started_at, created_at) >= ?1)
           AND (?2 IS NULL OR COALESCE(started_at, created_at) <= ?2)",
    )?;
    let rows = statement.query_map(params![effective_from, to], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut unsupported = 0_u64;
    let mut missing = 0_u64;
    for row in rows {
        let (session_id, adapter_id, command_json) = row?;
        let structured = serde_json::from_str::<Value>(&command_json)
            .ok()
            .and_then(|command| {
                command
                    .get("source")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .as_deref()
            == Some("structured_agent");
        if !structured {
            continue;
        }
        if SUPPORTED_USAGE_ADAPTERS.contains(&adapter_id.as_str()) {
            if !observed_session_ids.contains(session_id.as_str()) {
                missing += 1;
            }
        } else {
            unsupported += 1;
        }
    }
    Ok((unsupported, missing))
}

fn usage_row_matches(row: &UsageRow, request: &UsageDashboardRequest) -> bool {
    request
        .project_id
        .as_deref()
        .is_none_or(|value| row.project_id.as_deref() == Some(value))
        && request
            .adapter_id
            .as_deref()
            .is_none_or(|value| row.adapter_id == value)
        && request
            .provider_id
            .as_deref()
            .is_none_or(|value| row.provider_id == value)
        && request
            .model_id
            .as_deref()
            .is_none_or(|value| row.model_id.as_deref() == Some(value))
}

fn usage_filter_options(rows: &[UsageRow]) -> UsageFilterOptions {
    let mut adapters = BTreeMap::<String, String>::new();
    let mut providers = BTreeMap::<String, String>::new();
    let mut models = BTreeMap::<String, String>::new();
    let mut projects = BTreeMap::<String, String>::new();
    for row in rows {
        adapters.insert(row.adapter_id.clone(), row.adapter_id.clone());
        providers.insert(row.provider_id.clone(), row.provider_id.clone());
        if let Some(model) = row.model_id.as_ref() {
            models.insert(model.clone(), model.clone());
        }
        if let Some(project_id) = row.project_id.as_ref() {
            projects.insert(
                project_id.clone(),
                row.project_name
                    .clone()
                    .unwrap_or_else(|| project_id.clone()),
            );
        }
    }
    UsageFilterOptions {
        adapters: filter_options(adapters),
        providers: filter_options(providers),
        models: filter_options(models),
        projects: filter_options(projects),
    }
}

fn filter_options(values: BTreeMap<String, String>) -> Vec<UsageFilterOption> {
    values
        .into_iter()
        .map(|(key, label)| UsageFilterOption { key, label })
        .collect()
}

fn add_breakdown(
    values: &mut BTreeMap<String, UsageBreakdown>,
    key: &str,
    label: &str,
    row: &UsageRow,
) -> Result<()> {
    values
        .entry(key.to_string())
        .or_insert_with(|| UsageBreakdown {
            key: key.to_string(),
            label: label.to_string(),
            totals: UsageAmounts::default(),
        })
        .totals
        .add(row)
}

fn sorted_breakdowns(values: BTreeMap<String, UsageBreakdown>) -> Vec<UsageBreakdown> {
    let mut values = values.into_values().collect::<Vec<_>>();
    values.sort_by(|left, right| {
        right
            .totals
            .cost_nano_usd
            .cmp(&left.totals.cost_nano_usd)
            .then_with(|| left.label.cmp(&right.label))
    });
    values
}

fn usage_session_cursor(row: &UsageSessionRow) -> String {
    format!("{}|{}", row.last_occurred_at, row.session_id)
}

fn checked_sum(left: i64, right: i64) -> Result<i64> {
    left.checked_add(right)
        .ok_or_else(|| anyhow!("usage aggregation overflow"))
}

fn validate_usage_filter(value: Option<&str>, name: &str) -> Result<()> {
    if value.is_some_and(|value| value.len() > 256 || value.chars().any(char::is_control)) {
        bail!("{name} is invalid");
    }
    Ok(())
}

fn bounded_profile_value(value: Option<&Value>, name: &str) -> Result<String> {
    let value = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .filter(|value| !value.chars().any(char::is_control))
        .ok_or_else(|| anyhow!("{name} is required"))?;
    Ok(value.to_string())
}

fn override_key(adapter_id: &str, provider_id: &str) -> String {
    format!("{adapter_id}\u{1f}{provider_id}")
}

fn first_string(value: &Value, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

fn normalize_event_name(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
