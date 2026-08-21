use super::*;

const MAX_BOTS_PER_SCOPE: i64 = 32;
const MAX_BOT_NAME_CHARS: usize = 80;
const MAX_BOT_ROLE_CHARS: usize = 4_000;

pub(crate) fn list_bots(db: &Connection, project_id: Option<&str>) -> Result<Vec<BotProfileDto>> {
    let mut stmt = db.prepare(
        "SELECT id, scope, project_id, name, role_description, avatar_seed, launch_json,
                launch_count, last_used_at, created_at, updated_at
         FROM bot_profiles
         WHERE scope = 'global' OR (scope = 'project' AND project_id = ?1)
         ORDER BY CASE WHEN scope = 'project' THEN 0 ELSE 1 END,
                  COALESCE(last_used_at, updated_at) DESC, name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map(params![project_id], bot_from_row)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

pub(crate) fn upsert_bot(db: &Connection, request: BotUpsertRequest) -> Result<BotProfileDto> {
    let input = request.bot;
    let bot_id = input.id.unwrap_or_else(|| id("bot"));
    validate_identifier(&bot_id, "id")?;
    let scope = input.scope.trim();
    let project_id = match scope {
        "global" => None,
        "project" => Some(
            input
                .project_id
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| anyhow!("project-scoped bot requires projectId"))?,
        ),
        _ => bail!("bot scope must be global or project"),
    };
    if let Some(project_id) = project_id {
        let exists: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1 AND archived_at IS NULL)",
            params![project_id],
            |row| row.get(0),
        )?;
        if !exists {
            bail!("bot project does not exist");
        }
    }
    let name = validate_text(&input.name, "name", MAX_BOT_NAME_CHARS)?;
    let role_description = validate_text(
        &input.role_description,
        "roleDescription",
        MAX_BOT_ROLE_CHARS,
    )?;
    validate_identifier(&input.launch.adapter_id, "launch.adapterId")?;
    validate_agent_profile_values(
        input.launch.provider.as_deref(),
        input.launch.model.as_deref(),
        input.launch.thinking.as_deref(),
    )?;
    let known_adapter = adapter_registry(db)?
        .into_iter()
        .any(|adapter| adapter.id == input.launch.adapter_id && adapter.id != "generic-shell");
    if !known_adapter {
        bail!("bot launch adapter is unavailable");
    }

    let existing_name: Option<String> = db
        .query_row(
            "SELECT id FROM bot_profiles
             WHERE scope = ?1 AND COALESCE(project_id, '') = COALESCE(?2, '')
               AND name = ?3 COLLATE NOCASE AND id <> ?4",
            params![scope, project_id, name, bot_id],
            |row| row.get(0),
        )
        .optional()?;
    if existing_name.is_some() {
        bail!("a bot with this name already exists in the selected scope");
    }

    let existing: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM bot_profiles WHERE id = ?1)",
        params![bot_id],
        |row| row.get(0),
    )?;
    if !existing {
        let count: i64 = db.query_row(
            "SELECT COUNT(*) FROM bot_profiles
             WHERE scope = ?1 AND COALESCE(project_id, '') = COALESCE(?2, '')",
            params![scope, project_id],
            |row| row.get(0),
        )?;
        if count >= MAX_BOTS_PER_SCOPE {
            bail!("the selected scope already has 32 bots");
        }
    }

    let timestamp = now();
    let avatar_seed = input
        .avatar_seed
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&bot_id);
    validate_identifier(avatar_seed, "avatarSeed")?;
    let launch_json = serde_json::to_string(&input.launch)?;
    let launch_increment = i64::from(request.record_launch);
    let last_used_at = request.record_launch.then_some(timestamp.as_str());
    db.execute(
        "INSERT INTO bot_profiles
           (id, scope, project_id, name, role_description, avatar_seed, launch_json,
            launch_count, last_used_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
         ON CONFLICT(id) DO UPDATE SET
           scope = excluded.scope,
           project_id = excluded.project_id,
           name = excluded.name,
           role_description = excluded.role_description,
           avatar_seed = excluded.avatar_seed,
           launch_json = excluded.launch_json,
           launch_count = bot_profiles.launch_count + ?8,
           last_used_at = COALESCE(?9, bot_profiles.last_used_at),
           updated_at = excluded.updated_at",
        params![
            bot_id,
            scope,
            project_id,
            name,
            role_description,
            avatar_seed,
            launch_json,
            launch_increment,
            last_used_at,
            timestamp,
        ],
    )?;
    load_bot(db, &bot_id)
}

pub(crate) fn delete_bot(db: &Connection, bot_id: &str) -> Result<bool> {
    validate_identifier(bot_id, "id")?;
    Ok(db.execute("DELETE FROM bot_profiles WHERE id = ?1", params![bot_id])? > 0)
}

fn load_bot(db: &Connection, bot_id: &str) -> Result<BotProfileDto> {
    db.query_row(
        "SELECT id, scope, project_id, name, role_description, avatar_seed, launch_json,
                launch_count, last_used_at, created_at, updated_at
         FROM bot_profiles WHERE id = ?1",
        params![bot_id],
        bot_from_row,
    )
    .map_err(Into::into)
}

fn bot_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BotProfileDto> {
    let launch_json: String = row.get(6)?;
    let launch = serde_json::from_str::<BotLaunchDto>(&launch_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(BotProfileDto {
        id: row.get(0)?,
        scope: row.get(1)?,
        project_id: row.get(2)?,
        name: row.get(3)?,
        role_description: row.get(4)?,
        avatar_seed: row.get(5)?,
        launch,
        launch_count: row.get(7)?,
        last_used_at: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn validate_identifier(value: &str, field: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        bail!("invalid bot {field}");
    }
    Ok(())
}

fn validate_text(value: &str, field: &str, max_chars: usize) -> Result<String> {
    let value = value.trim();
    let count = value.chars().count();
    if count == 0 || count > max_chars {
        bail!("bot {field} must contain 1 to {max_chars} characters");
    }
    Ok(value.to_string())
}
