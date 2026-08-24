use super::*;

const PENDING_LEASE_SECONDS: i64 = 45;
const CLAIMED_LEASE_SECONDS: i64 = 120;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpsStateRecord {
    pub(crate) canvas_id: String,
    pub(crate) project_id: String,
    pub(crate) revision: u64,
    pub(crate) state: Value,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectOpsStateRecord {
    pub(crate) project_id: String,
    pub(crate) revision: u64,
    pub(crate) state: Value,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpsSchedulerConfig {
    pub(crate) project_id: String,
    pub(crate) canvas_id: String,
    pub(crate) enabled: bool,
    pub(crate) paused: bool,
    pub(crate) concurrency_limit: u8,
    pub(crate) adapter_id: Option<String>,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpsTaskLease {
    pub(crate) id: String,
    pub(crate) project_id: String,
    pub(crate) canvas_id: String,
    pub(crate) task_id: String,
    pub(crate) state: String,
    pub(crate) owner_id: Option<String>,
    pub(crate) adapter_id: Option<String>,
    pub(crate) leased_at: String,
    pub(crate) expires_at: String,
}

pub(crate) fn load_ops_state(db: &Connection, canvas_id: &str) -> Result<Option<OpsStateRecord>> {
    db.query_row(
        "SELECT canvas_id, project_id, revision, state_json, updated_at
         FROM ops_states WHERE canvas_id = ?1",
        params![canvas_id],
        |row| {
            let state_json: String = row.get(3)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
                state_json,
                row.get::<_, String>(4)?,
            ))
        },
    )
    .optional()?
    .map(
        |(canvas_id, project_id, revision, state_json, updated_at)| {
            Ok(OpsStateRecord {
                canvas_id,
                project_id,
                revision,
                state: serde_json::from_str(&state_json)?,
                updated_at,
            })
        },
    )
    .transpose()
}

pub(crate) fn save_ops_state(
    db: &Connection,
    canvas_id: &str,
    project_id: &str,
    state: &Value,
    expected_revision: Option<u64>,
) -> Result<OpsStateRecord> {
    retry_sqlite_write(|| save_ops_state_once(db, canvas_id, project_id, state, expected_revision))
}

pub(crate) fn load_project_ops_state(
    db: &Connection,
    project_id: &str,
) -> Result<Option<ProjectOpsStateRecord>> {
    db.query_row(
        "SELECT project_id, revision, state_json, updated_at
         FROM ops_project_states WHERE project_id = ?1",
        params![project_id],
        |row| {
            let state_json: String = row.get(2)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, u64>(1)?,
                state_json,
                row.get::<_, String>(3)?,
            ))
        },
    )
    .optional()?
    .map(|(project_id, revision, state_json, updated_at)| {
        Ok(ProjectOpsStateRecord {
            project_id,
            revision,
            state: serde_json::from_str(&state_json)?,
            updated_at,
        })
    })
    .transpose()
}

pub(crate) fn save_project_ops_state(
    db: &Connection,
    project_id: &str,
    state: &Value,
    expected_revision: Option<u64>,
) -> Result<ProjectOpsStateRecord> {
    retry_sqlite_write(|| {
        let tx = Transaction::new_unchecked(db, TransactionBehavior::Immediate)?;
        let project_exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
            params![project_id],
            |row| row.get(0),
        )?;
        if !project_exists {
            bail!("project was not found");
        }
        let current_revision = tx
            .query_row(
                "SELECT revision FROM ops_project_states WHERE project_id = ?1",
                params![project_id],
                |row| row.get::<_, u64>(0),
            )
            .optional()?
            .unwrap_or(0);
        if expected_revision.is_some_and(|expected| expected != current_revision) {
            bail!(
                "ops state revision conflict: expected {}, current {current_revision}",
                expected_revision.unwrap_or_default()
            );
        }
        let revision = current_revision + 1;
        let updated_at = now();
        tx.execute(
            "INSERT INTO ops_project_states (project_id, revision, state_json, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(project_id) DO UPDATE SET
               revision = excluded.revision,
               state_json = excluded.state_json,
               updated_at = excluded.updated_at",
            params![project_id, revision, state.to_string(), updated_at],
        )?;
        tx.commit()?;
        Ok(ProjectOpsStateRecord {
            project_id: project_id.to_string(),
            revision,
            state: state.clone(),
            updated_at,
        })
    })
}

fn save_ops_state_once(
    db: &Connection,
    canvas_id: &str,
    project_id: &str,
    state: &Value,
    expected_revision: Option<u64>,
) -> Result<OpsStateRecord> {
    let tx = Transaction::new_unchecked(db, TransactionBehavior::Immediate)?;
    let canvas_project: String = tx.query_row(
        "SELECT project_id FROM canvases WHERE id = ?1",
        params![canvas_id],
        |row| row.get(0),
    )?;
    if canvas_project != project_id {
        bail!("canvas does not belong to the requested project");
    }
    let current_revision = tx
        .query_row(
            "SELECT revision FROM ops_states WHERE canvas_id = ?1",
            params![canvas_id],
            |row| row.get::<_, u64>(0),
        )
        .optional()?
        .unwrap_or(0);
    if expected_revision.is_some_and(|expected| expected != current_revision) {
        bail!(
            "ops state revision conflict: expected {}, current {current_revision}",
            expected_revision.unwrap_or_default()
        );
    }
    let revision = current_revision + 1;
    let updated_at = now();
    tx.execute(
        "INSERT INTO ops_states (canvas_id, project_id, revision, state_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(canvas_id) DO UPDATE SET
           project_id = excluded.project_id,
           revision = excluded.revision,
           state_json = excluded.state_json,
           updated_at = excluded.updated_at",
        params![
            canvas_id,
            project_id,
            revision,
            state.to_string(),
            updated_at
        ],
    )?;
    tx.execute(
        "INSERT INTO ops_project_states (project_id, revision, state_json, updated_at)
         VALUES (?1, 1, ?2, ?3)
         ON CONFLICT(project_id) DO UPDATE SET
           revision = ops_project_states.revision + 1,
           state_json = excluded.state_json,
           updated_at = excluded.updated_at",
        params![project_id, state.to_string(), updated_at],
    )?;
    tx.commit()?;
    Ok(OpsStateRecord {
        canvas_id: canvas_id.to_string(),
        project_id: project_id.to_string(),
        revision,
        state: state.clone(),
        updated_at,
    })
}

pub(crate) fn configure_ops_scheduler(
    db: &Connection,
    project_id: &str,
    canvas_id: &str,
    enabled: bool,
    paused: bool,
    concurrency_limit: u8,
    adapter_id: Option<&str>,
) -> Result<OpsSchedulerConfig> {
    let concurrency_limit = concurrency_limit.clamp(1, 8);
    let updated_at = now();
    db.execute(
        "INSERT INTO ops_scheduler_configs
           (project_id, canvas_id, enabled, paused, concurrency_limit, adapter_id, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(project_id) DO UPDATE SET
           canvas_id = excluded.canvas_id,
           enabled = excluded.enabled,
           paused = excluded.paused,
           concurrency_limit = excluded.concurrency_limit,
           adapter_id = excluded.adapter_id,
           updated_at = excluded.updated_at",
        params![
            project_id,
            canvas_id,
            enabled,
            paused,
            concurrency_limit,
            adapter_id,
            updated_at
        ],
    )?;
    if !enabled || paused {
        db.execute(
            "UPDATE ops_task_leases
             SET state = 'released', finished_at = ?1
             WHERE project_id = ?2 AND state = 'pending'",
            params![updated_at, project_id],
        )?;
    } else {
        db.execute(
            "UPDATE ops_task_leases
             SET state = 'released', finished_at = ?1
             WHERE project_id = ?2 AND state = 'pending' AND canvas_id <> ?3",
            params![updated_at, project_id, canvas_id],
        )?;
    }
    Ok(OpsSchedulerConfig {
        project_id: project_id.to_string(),
        canvas_id: canvas_id.to_string(),
        enabled,
        paused,
        concurrency_limit,
        adapter_id: adapter_id.map(str::to_string),
        updated_at,
    })
}

pub(crate) fn load_ops_scheduler_config(
    db: &Connection,
    project_id: &str,
) -> Result<Option<OpsSchedulerConfig>> {
    db.query_row(
        "SELECT project_id, canvas_id, enabled, paused, concurrency_limit, adapter_id, updated_at
         FROM ops_scheduler_configs WHERE project_id = ?1",
        params![project_id],
        |row| {
            Ok(OpsSchedulerConfig {
                project_id: row.get(0)?,
                canvas_id: row.get(1)?,
                enabled: row.get(2)?,
                paused: row.get(3)?,
                concurrency_limit: row.get(4)?,
                adapter_id: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

pub(crate) fn tick_ops_scheduler(db: &Connection) -> Result<Vec<OpsTaskLease>> {
    expire_ops_leases(db)?;
    let mut statement = db.prepare(
        "SELECT project_id FROM ops_scheduler_configs
         WHERE enabled = 1 AND paused = 0",
    )?;
    let project_ids = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut leases = Vec::new();
    for project_id in project_ids {
        leases.extend(fill_project_leases(db, &project_id)?);
    }
    Ok(leases)
}

pub(crate) fn claim_ops_lease(
    db: &Connection,
    project_id: &str,
    owner_id: &str,
) -> Result<Option<OpsTaskLease>> {
    expire_ops_leases(db)?;
    let Some(config) = load_ops_scheduler_config(db, project_id)? else {
        return Ok(None);
    };
    if !config.enabled || config.paused {
        return Ok(None);
    }
    let _ = fill_project_leases(db, project_id)?;
    let tx = db.unchecked_transaction()?;
    let Some(record) = load_project_ops_state(&tx, project_id)? else {
        tx.commit()?;
        return Ok(None);
    };
    release_ineligible_pending_leases(&tx, project_id, &record.state)?;
    let candidate = tx
        .query_row(
            "SELECT id FROM ops_task_leases
             WHERE project_id = ?1 AND state = 'pending' AND expires_at > ?2
             ORDER BY leased_at ASC LIMIT 1",
            params![project_id, now()],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(lease_id) = candidate else {
        tx.commit()?;
        return Ok(None);
    };
    let expires_at = timestamp_after(CLAIMED_LEASE_SECONDS);
    let changed = tx.execute(
        "UPDATE ops_task_leases
         SET state = 'claimed', owner_id = ?1, claimed_at = ?2, expires_at = ?3
         WHERE id = ?4 AND state = 'pending'",
        params![owner_id, now(), expires_at, lease_id],
    )?;
    if changed != 1 {
        tx.commit()?;
        return Ok(None);
    }
    let lease = load_ops_lease(&tx, &lease_id)?;
    tx.commit()?;
    Ok(Some(lease))
}

pub(crate) fn heartbeat_ops_lease(
    db: &Connection,
    lease_id: &str,
    owner_id: &str,
) -> Result<OpsTaskLease> {
    let expires_at = timestamp_after(CLAIMED_LEASE_SECONDS);
    let changed = db.execute(
        "UPDATE ops_task_leases SET expires_at = ?1
         WHERE id = ?2 AND owner_id = ?3 AND state = 'claimed'",
        params![expires_at, lease_id, owner_id],
    )?;
    if changed != 1 {
        bail!("active scheduler lease was not found");
    }
    load_ops_lease(db, lease_id)
}

pub(crate) fn finish_ops_lease(
    db: &Connection,
    lease_id: &str,
    owner_id: &str,
    state: &str,
) -> Result<()> {
    if !matches!(state, "completed" | "released" | "failed") {
        bail!("unsupported scheduler lease completion state");
    }
    let changed = db.execute(
        "UPDATE ops_task_leases SET state = ?1, finished_at = ?2
         WHERE id = ?3 AND owner_id = ?4 AND state = 'claimed'",
        params![state, now(), lease_id, owner_id],
    )?;
    if changed != 1 {
        bail!("active scheduler lease was not found");
    }
    Ok(())
}

/// Releases a lease left behind by a previous application process. This is
/// deliberately owner-independent: the caller cannot possess the random owner
/// id from the process that crashed. The UI only invokes this after confirming
/// that the lease's agent session is no longer live.
pub(crate) fn recover_ops_lease(
    db: &Connection,
    lease_id: &str,
    state: &str,
) -> Result<OpsTaskLease> {
    if !matches!(state, "completed" | "released" | "failed") {
        bail!("unsupported scheduler lease recovery state");
    }
    let recovered_at = now();
    let changed = db.execute(
        "UPDATE ops_task_leases
         SET state = ?1, finished_at = ?2
         WHERE id = ?3
           AND state IN ('claimed', 'expired')",
        params![state, recovered_at, lease_id],
    )?;
    if changed != 1 {
        bail!("expired scheduler lease was not found");
    }
    load_ops_lease(db, lease_id)
}

fn fill_project_leases(db: &Connection, project_id: &str) -> Result<Vec<OpsTaskLease>> {
    let Some(config) = load_ops_scheduler_config(db, project_id)? else {
        return Ok(Vec::new());
    };
    if !config.enabled || config.paused {
        return Ok(Vec::new());
    }
    let Some(record) = load_project_ops_state(db, project_id)? else {
        return Ok(Vec::new());
    };
    release_ineligible_pending_leases(db, project_id, &record.state)?;
    let active_count = db.query_row(
        "SELECT COUNT(*) FROM ops_task_leases
         WHERE project_id = ?1 AND state IN ('pending', 'claimed') AND expires_at > ?2",
        params![project_id, now()],
        |row| row.get::<_, u8>(0),
    )?;
    let mut created = Vec::new();
    for _ in active_count..config.concurrency_limit {
        let Some(task_id) = next_task_id(db, project_id, &record.state)? else {
            break;
        };
        let lease = OpsTaskLease {
            id: Uuid::now_v7().to_string(),
            project_id: project_id.to_string(),
            canvas_id: config.canvas_id.clone(),
            task_id,
            state: "pending".to_string(),
            owner_id: None,
            adapter_id: config.adapter_id.clone(),
            leased_at: now(),
            expires_at: timestamp_after(PENDING_LEASE_SECONDS),
        };
        let inserted = db.execute(
            "INSERT OR IGNORE INTO ops_task_leases
               (id, project_id, canvas_id, task_id, state, owner_id, adapter_id, leased_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, 'pending', NULL, ?5, ?6, ?7)",
            params![
                lease.id,
                lease.project_id,
                lease.canvas_id,
                lease.task_id,
                lease.adapter_id,
                lease.leased_at,
                lease.expires_at
            ],
        )?;
        if inserted == 1 {
            created.push(lease);
        } else {
            break;
        }
    }
    Ok(created)
}

fn release_ineligible_pending_leases(
    db: &Connection,
    project_id: &str,
    state: &Value,
) -> Result<()> {
    let eligible = eligible_task_ids(state);
    let stale_lease_ids = {
        let mut statement = db.prepare(
            "SELECT id, task_id FROM ops_task_leases
             WHERE project_id = ?1 AND state = 'pending'",
        )?;
        let leases = statement
            .query_map(params![project_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        leases
            .into_iter()
            .filter_map(|(lease_id, task_id)| (!eligible.contains(&task_id)).then_some(lease_id))
            .collect::<Vec<_>>()
    };
    if stale_lease_ids.is_empty() {
        return Ok(());
    }
    let finished_at = now();
    for lease_id in stale_lease_ids {
        db.execute(
            "UPDATE ops_task_leases SET state = 'released', finished_at = ?1
             WHERE id = ?2 AND state = 'pending'",
            params![finished_at, lease_id],
        )?;
    }
    Ok(())
}

fn eligible_task_ids(state: &Value) -> HashSet<String> {
    let current_time = now();
    let columns = state
        .get("columns")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let queued = columns
        .iter()
        .filter(|column| column.get("role").and_then(Value::as_str) == Some("queued"))
        .filter_map(|column| column.get("id").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    let done = columns
        .iter()
        .filter(|column| column.get("role").and_then(Value::as_str) == Some("done"))
        .filter_map(|column| column.get("id").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    let cards = state
        .get("cards")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut done_ids = cards
        .iter()
        .filter(|card| {
            card.get("columnId")
                .and_then(Value::as_str)
                .is_some_and(|column| done.contains(column))
        })
        .filter_map(|card| card.get("id").and_then(Value::as_str).map(str::to_string))
        .collect::<HashSet<_>>();
    done_ids.extend(
        state
            .get("archivedCards")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|card| card.get("id").and_then(Value::as_str).map(str::to_string)),
    );
    let objective_ids = cards
        .iter()
        .filter_map(|candidate| {
            candidate
                .get("parentId")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect::<HashSet<_>>();
    cards
        .into_iter()
        .filter_map(|card| {
            let task_id = card.get("id").and_then(Value::as_str)?;
            let is_objective = card.get("kind").and_then(Value::as_str) == Some("objective")
                || objective_ids.contains(task_id);
            if !card
                .get("columnId")
                .and_then(Value::as_str)
                .is_some_and(|column| queued.contains(column))
                || card.get("paused").and_then(Value::as_bool) == Some(true)
                || is_objective
                || card
                    .get("assigneeIds")
                    .and_then(Value::as_array)
                    .is_some_and(|assignees| !assignees.is_empty())
                || card
                    .pointer("/taskLane/closedAt")
                    .and_then(Value::as_str)
                    .is_some()
                || card
                    .get("retryAt")
                    .and_then(Value::as_str)
                    .is_some_and(|retry_at| retry_at > current_time.as_str())
            {
                return None;
            }
            let dependency_kinds = card.get("dependencyKinds").and_then(Value::as_object);
            let dependencies_ready = card
                .get("dependencyIds")
                .and_then(Value::as_array)
                .map(|dependencies| {
                    dependencies
                        .iter()
                        .filter_map(Value::as_str)
                        .all(|dependency| {
                            dependency_kinds
                                .and_then(|kinds| kinds.get(dependency))
                                .and_then(Value::as_str)
                                == Some("soft")
                                || done_ids.contains(dependency)
                        })
                })
                .unwrap_or(true);
            if !dependencies_ready {
                return None;
            }
            Some(task_id.to_string())
        })
        .collect()
}

fn next_task_id(db: &Connection, project_id: &str, state: &Value) -> Result<Option<String>> {
    let eligible = eligible_task_ids(state);
    let cards = state
        .get("cards")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for card in cards {
        let Some(task_id) = card.get("id").and_then(Value::as_str) else {
            continue;
        };
        if !eligible.contains(task_id) {
            continue;
        }
        let leased: bool = db.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM ops_task_leases
               WHERE project_id = ?1 AND task_id = ?2
                 AND state IN ('pending', 'claimed') AND expires_at > ?3
             )",
            params![project_id, task_id, now()],
            |row| row.get(0),
        )?;
        if !leased {
            return Ok(Some(task_id.to_string()));
        }
    }
    Ok(None)
}

fn expire_ops_leases(db: &Connection) -> Result<()> {
    db.execute(
        "UPDATE ops_task_leases SET state = 'expired', finished_at = ?1
         WHERE state IN ('pending', 'claimed') AND expires_at <= ?1",
        params![now()],
    )?;
    Ok(())
}

fn load_ops_lease(db: &Connection, lease_id: &str) -> Result<OpsTaskLease> {
    db.query_row(
        "SELECT id, project_id, canvas_id, task_id, state, owner_id, adapter_id, leased_at, expires_at
         FROM ops_task_leases WHERE id = ?1",
        params![lease_id],
        |row| {
            Ok(OpsTaskLease {
                id: row.get(0)?,
                project_id: row.get(1)?,
                canvas_id: row.get(2)?,
                task_id: row.get(3)?,
                state: row.get(4)?,
                owner_id: row.get(5)?,
                adapter_id: row.get(6)?,
                leased_at: row.get(7)?,
                expires_at: row.get(8)?,
            })
        },
    )
    .map_err(Into::into)
}

fn timestamp_after(seconds: i64) -> String {
    (OffsetDateTime::now_utc() + time::Duration::seconds(seconds))
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}
