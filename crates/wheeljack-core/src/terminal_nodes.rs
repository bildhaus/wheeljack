use super::*;

#[derive(Debug, Clone)]
pub(crate) struct OrchestratorTarget {
    pub(crate) ordinal: usize,
    pub(crate) node_id: String,
    pub(crate) title: String,
    pub(crate) kind: String,
    pub(crate) session_id: Option<String>,
    pub(crate) adapter_id: String,
    pub(crate) status: String,
    pub(crate) recent_context: String,
}

pub(crate) fn parse_orchestrator_assignments(transcript: &str) -> Vec<OrchestratorAssignmentDto> {
    let Some((_, rest)) = split_once_case_insensitive(transcript, "tell ") else {
        return Vec::new();
    };
    parse_assignment_clauses(rest)
}

pub(crate) fn split_once_case_insensitive<'a>(
    value: &'a str,
    needle: &str,
) -> Option<(&'a str, &'a str)> {
    let lower = value.to_lowercase();
    let index = lower.find(&needle.to_lowercase())?;
    Some((&value[..index], &value[index + needle.len()..]))
}

pub(crate) fn parse_assignment_clauses(mut rest: &str) -> Vec<OrchestratorAssignmentDto> {
    let mut assignments = Vec::new();
    loop {
        rest = rest
            .trim()
            .trim_start_matches(',')
            .trim_start_matches(';')
            .trim();
        rest = strip_connector(rest);
        if rest.is_empty() {
            break;
        }

        let Some((target, after_to)) = split_once_case_insensitive(rest, " to ") else {
            break;
        };
        let target = clean_assignment_target(target);
        if target.is_empty() {
            break;
        }

        let (task, next_rest) = split_next_assignment(after_to);
        let task = clean_assignment_task(task);
        if !task.is_empty() {
            assignments.push(OrchestratorAssignmentDto {
                target,
                task,
                task_id: None,
            });
        }
        let Some(next) = next_rest else {
            break;
        };
        rest = next;
    }
    assignments
}

pub(crate) fn strip_connector(value: &str) -> &str {
    let trimmed = value.trim();
    for connector in ["and then ", "then ", "and "] {
        if trimmed.len() >= connector.len()
            && trimmed[..connector.len()].eq_ignore_ascii_case(connector)
        {
            return trimmed[connector.len()..].trim();
        }
    }
    trimmed
}

pub(crate) fn clean_assignment_target(value: &str) -> String {
    strip_connector(value)
        .trim()
        .trim_matches(|ch: char| matches!(ch, '"' | '\'' | ':' | '-' | ' '))
        .to_string()
}

pub(crate) fn clean_assignment_task(value: &str) -> String {
    value
        .trim()
        .trim_matches(|ch: char| matches!(ch, '"' | '\'' | '.' | ';' | ',' | ' '))
        .to_string()
}

pub(crate) fn split_next_assignment(value: &str) -> (&str, Option<&str>) {
    let lower = value.to_lowercase();
    let candidates = [
        ", and ",
        "; and ",
        ", then ",
        "; then ",
        ", ",
        "; ",
        " and then ",
        " then ",
        " and ",
    ];
    let mut split: Option<(usize, usize)> = None;
    for candidate in candidates {
        let mut search_from = 0;
        while let Some(relative_index) = lower[search_from..].find(candidate) {
            let index = search_from + relative_index;
            let after = &value[index + candidate.len()..];
            if split_once_case_insensitive(after, " to ").is_some() {
                split = match split {
                    Some((current, _)) if current <= index => split,
                    _ => Some((index, candidate.len())),
                };
                break;
            }
            search_from = index + candidate.len();
        }
    }
    if let Some((index, separator_len)) = split {
        (&value[..index], Some(&value[index + separator_len..]))
    } else {
        (value, None)
    }
}

pub(crate) fn normalize_lookup(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

pub(crate) fn target_ordinal(value: &str) -> Option<usize> {
    let lower = value.to_lowercase();
    for (word, number) in [
        ("one", 1),
        ("two", 2),
        ("three", 3),
        ("four", 4),
        ("five", 5),
        ("six", 6),
        ("seven", 7),
        ("eight", 8),
        ("nine", 9),
        ("ten", 10),
    ] {
        if lower.split_whitespace().any(|part| part == word) {
            return Some(number);
        }
    }
    lower
        .split(|ch: char| !ch.is_ascii_digit())
        .find(|part| !part.is_empty())
        .and_then(|part| part.parse::<usize>().ok())
}

pub(crate) fn load_orchestrator_targets(
    db: &Connection,
    canvas_id: Option<&str>,
) -> Result<Vec<OrchestratorTarget>> {
    let mut stmt = db.prepare(
        "SELECT n.id,
                n.title,
                n.kind,
                n.data_json,
                s.id,
                s.adapter_id,
                s.status
         FROM nodes n
         LEFT JOIN sessions s ON s.id = (
           SELECT id FROM sessions
           WHERE node_id = n.id
           ORDER BY COALESCE(started_at, created_at) DESC
           LIMIT 1
         )
         WHERE n.kind IN ('agent_terminal', 'shell_terminal')
           AND (?1 IS NULL OR n.canvas_id = ?1)
         ORDER BY n.z_index ASC, n.created_at ASC",
    )?;
    let rows = stmt.query_map(params![canvas_id], |row| {
        let data_json: String = row.get(3)?;
        let data = serde_json::from_str::<Value>(&data_json).unwrap_or_else(|_| json!({}));
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            data,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
        ))
    })?;

    let mut targets = Vec::new();
    for row in rows {
        let (node_id, title, kind, data, session_id, adapter_id, session_status) = row?;
        let data_status = data
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let recent_context = match session_id.as_deref() {
            Some(id) => load_session_preview(db, id).unwrap_or_default(),
            None => transcript_preview_from_node_data(&data),
        };
        targets.push(OrchestratorTarget {
            ordinal: targets.len() + 1,
            node_id,
            title,
            kind,
            session_id,
            adapter_id: adapter_id
                .or_else(|| {
                    data.get("adapterId")
                        .and_then(Value::as_str)
                        .map(String::from)
                })
                .unwrap_or_else(|| "unknown".to_string()),
            status: session_status.unwrap_or(data_status),
            recent_context,
        });
    }
    Ok(targets)
}

pub(crate) fn transcript_preview_from_node_data(data: &Value) -> String {
    let Some(transcript) = data.get("transcript").and_then(Value::as_array) else {
        return String::new();
    };
    let lines = transcript
        .iter()
        .filter_map(Value::as_str)
        .filter_map(visible_terminal_transcript_chunk)
        .rev()
        .take(6)
        .collect::<Vec<_>>();
    let preview = lines.into_iter().rev().collect::<Vec<_>>().join("\n");
    trim_preview(&preview, 260)
}

pub(crate) struct PersistedTerminalIndexSession {
    pub(crate) id: String,
    pub(crate) adapter_id: Option<String>,
    pub(crate) cwd: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) started_at: Option<String>,
    pub(crate) ended_at: Option<String>,
    pub(crate) chunk_count: i64,
    pub(crate) transcript_preview: String,
    pub(crate) transcript: Option<Vec<String>>,
}

pub(crate) fn load_terminal_index_session_for_node(
    db: &Connection,
    node_id: &str,
    include_transcript: bool,
) -> Result<Option<PersistedTerminalIndexSession>> {
    let mut stmt = db.prepare_cached(
        "SELECT id, adapter_id, cwd, status, started_at, ended_at,
                (SELECT COUNT(*) FROM session_chunks c WHERE c.session_id = sessions.id)
         FROM sessions
         WHERE node_id = ?1
         ORDER BY COALESCE(started_at, created_at) DESC
         LIMIT 1",
    )?;
    let mut rows = stmt.query(params![node_id])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    let id: String = row.get(0)?;
    let stored_chunk_count = row.get(6)?;
    let transcript = if include_transcript {
        let transcript_text = decode_visible_chunks(&load_session_chunks(db, &id)?);
        Some(
            transcript_text
                .lines()
                .map(str::to_string)
                .filter(|line| !line.trim().is_empty())
                .collect::<Vec<_>>(),
        )
    } else {
        None
    };
    let transcript_preview = if let Some(transcript) = transcript.as_deref() {
        terminal_transcript_preview(transcript)
    } else {
        load_session_preview(db, &id)?
    };
    let chunk_count = transcript
        .as_ref()
        .map(|transcript| transcript.len() as i64)
        .unwrap_or(stored_chunk_count);
    Ok(Some(PersistedTerminalIndexSession {
        id,
        adapter_id: row.get(1)?,
        cwd: row.get(2)?,
        status: row.get(3)?,
        started_at: row.get(4)?,
        ended_at: row.get(5)?,
        chunk_count,
        transcript_preview,
        transcript,
    }))
}

pub(crate) fn terminal_session_index_from_nodes(
    nodes: &[CanvasNodeDto],
    query: Option<&str>,
    db: Option<&Connection>,
    include_transcripts: bool,
) -> Value {
    let include_transcripts = include_transcripts || query.is_some();
    let mut sessions = Vec::new();
    let mut transcript_by_id = serde_json::Map::new();
    let mut search_text_by_id = serde_json::Map::new();
    let mut search_text = Vec::new();
    let mut search_results = Vec::new();

    for node in nodes {
        if !matches!(node.kind.as_str(), "agent_terminal" | "shell_terminal") {
            continue;
        }

        let persisted = db.and_then(|db| {
            load_terminal_index_session_for_node(db, &node.id, include_transcripts)
                .ok()
                .flatten()
        });
        let session_id = persisted
            .as_ref()
            .map(|session| session.id.clone())
            .or_else(|| {
                node.data
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| node.id.clone());
        let node_transcript = terminal_node_visible_transcript(&node.data);
        let transcript = persisted
            .as_ref()
            .and_then(|session| session.transcript.as_ref())
            .filter(|transcript| !transcript.is_empty())
            .cloned()
            .unwrap_or_else(|| {
                if persisted.is_some() && !include_transcripts {
                    Vec::new()
                } else {
                    node_transcript
                }
            });
        let adapter_id = persisted
            .as_ref()
            .and_then(|session| session.adapter_id.as_ref())
            .map(|value| Value::String(value.clone()))
            .unwrap_or_else(|| terminal_node_string_value(&node.data, "adapterId"));
        let cwd = persisted
            .as_ref()
            .and_then(|session| session.cwd.as_ref())
            .map(|value| Value::String(value.clone()))
            .unwrap_or_else(|| terminal_node_string_value(&node.data, "cwd"));
        let status = persisted
            .as_ref()
            .and_then(|session| session.status.as_ref())
            .map(|value| Value::String(value.clone()))
            .unwrap_or_else(|| terminal_node_string_value(&node.data, "status"));
        let started_at = persisted
            .as_ref()
            .and_then(|session| session.started_at.as_ref())
            .cloned()
            .unwrap_or_else(|| node.created_at.clone());
        let ended_at = persisted
            .as_ref()
            .and_then(|session| session.ended_at.as_ref())
            .map(|value| Value::String(value.clone()))
            .unwrap_or_else(|| {
                if status.as_str() == Some("exited") {
                    Value::String(node.updated_at.clone())
                } else {
                    Value::Null
                }
            });
        let transcript_text = transcript.join("\n");
        let transcript_preview = persisted
            .as_ref()
            .filter(|_| transcript.is_empty())
            .map(|session| session.transcript_preview.clone())
            .unwrap_or_else(|| terminal_transcript_preview(&transcript));
        let chunk_count = persisted
            .as_ref()
            .filter(|_| transcript.is_empty())
            .map(|session| session.chunk_count)
            .unwrap_or(transcript.len() as i64);

        let session = json!({
            "id": session_id,
            "nodeId": node.id,
            "nodeTitle": node.title,
            "adapterId": adapter_id,
            "cwd": cwd,
            "status": status,
            "startedAt": started_at,
            "endedAt": ended_at,
            "chunkCount": chunk_count,
            "transcriptPreview": transcript_preview,
        });
        let searchable_cwd = node
            .data
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let searchable =
            format!("{}\n{}\n{}", node.title, searchable_cwd, transcript_text).to_lowercase();
        let search_result = json!({
            "sessionId": session_id,
            "nodeId": node.id,
            "nodeTitle": node.title,
            "adapterId": session["adapterId"].clone(),
            "cwd": session["cwd"].clone(),
            "status": session["status"].clone(),
            "startedAt": node.created_at,
            "snippet": session["transcriptPreview"].clone(),
        });

        if include_transcripts {
            transcript_by_id.insert(session_id.clone(), Value::String(transcript_text));
            search_text_by_id.insert(session_id.clone(), Value::String(searchable.clone()));
            search_text.push(Value::String(searchable));
        }
        sessions.push(session);
        if include_transcripts {
            search_results.push(search_result);
        }
    }

    let matches = terminal_session_index_matches(query, &search_text, &search_results);
    json!({
        "sessions": sessions,
        "transcriptById": Value::Object(transcript_by_id),
        "searchTextById": Value::Object(search_text_by_id),
        "searchText": search_text,
        "searchResults": search_results,
        "matches": matches,
    })
}

pub(crate) fn terminal_node_string_value(data: &Value, key: &str) -> Value {
    data.get(key)
        .and_then(Value::as_str)
        .map(|value| Value::String(value.to_string()))
        .unwrap_or(Value::Null)
}

pub(crate) fn terminal_node_visible_transcript(data: &Value) -> Vec<String> {
    let Some(transcript) = data.get("transcript").and_then(Value::as_array) else {
        return Vec::new();
    };
    transcript
        .iter()
        .filter_map(Value::as_str)
        .filter_map(visible_terminal_transcript_chunk)
        .collect()
}

pub(crate) fn visible_terminal_transcript_chunk(chunk: &str) -> Option<String> {
    if !contains_coordination_prompt_text(chunk) {
        return Some(chunk.to_string());
    }
    let trimmed = chunk.trim();
    let visible = trimmed
        .strip_prefix("user ->")
        .and_then(|rest| coordination_visible_line(rest.trim()))?;
    Some(format!("user -> {visible}"))
}

pub(crate) fn terminal_transcript_preview(chunks: &[String]) -> String {
    chunks
        .iter()
        .rev()
        .take(4)
        .rev()
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

pub(crate) fn terminal_session_index_matches(
    query: Option<&str>,
    search_text: &[Value],
    search_results: &[Value],
) -> Vec<Value> {
    let normalized = query.unwrap_or_default().trim().to_lowercase();
    if normalized.is_empty() {
        return Vec::new();
    }
    search_text
        .iter()
        .zip(search_results.iter())
        .filter(|(text, _)| {
            text.as_str()
                .is_some_and(|value| value.contains(&normalized))
        })
        .map(|(_, result)| result.clone())
        .collect()
}

pub(crate) fn is_terminal_kind(kind: &str) -> bool {
    matches!(kind, "agent_terminal" | "shell_terminal")
}

pub(crate) fn arrange_nodes_in_grid(nodes: &mut Vec<CanvasNodeDto>) {
    let mut ordered = Vec::with_capacity(nodes.len());
    ordered.extend(
        nodes
            .iter()
            .filter(|node| is_terminal_kind(&node.kind))
            .cloned(),
    );
    ordered.extend(
        nodes
            .iter()
            .filter(|node| !is_terminal_kind(&node.kind))
            .cloned(),
    );

    let updated_at = now();
    for (index, node) in ordered.iter_mut().enumerate() {
        let terminal = is_terminal_kind(&node.kind);
        node.x = (index % 4) as f64 * 360.0;
        node.y = (index / 4) as f64 * 260.0;
        node.z_index = 30 + index as i64;
        if terminal {
            node.width = node.width.max(600.0);
            node.height = node.height.max(300.0);
        }
        node.updated_at = updated_at.clone();
    }
    *nodes = ordered;
}

pub(crate) struct DeleteNodeResult {
    pub(crate) removed_node: Option<CanvasNodeDto>,
    pub(crate) selected_node_ids: Vec<String>,
    pub(crate) focused_node_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodeSelectionChange {
    pub(crate) selected_node_ids: Vec<String>,
    pub(crate) focused_node_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteSelectedNodesResult {
    pub(crate) deleted_count: usize,
    pub(crate) deleted_node_ids: Vec<String>,
    pub(crate) nodes: Vec<CanvasNodeDto>,
    pub(crate) edges: Vec<CanvasEdgeDto>,
    pub(crate) selected_node_ids: Vec<String>,
    pub(crate) focused_node_id: Option<String>,
}

pub(crate) fn delete_node_by_id(
    nodes: &mut Vec<CanvasNodeDto>,
    edges: &mut Vec<CanvasEdgeDto>,
    selected_node_ids: &[String],
    focused_node_id: Option<String>,
    node_id: &str,
) -> DeleteNodeResult {
    let Some(index) = nodes.iter().position(|node| node.id == node_id) else {
        return DeleteNodeResult {
            removed_node: None,
            selected_node_ids: selected_node_ids.to_vec(),
            focused_node_id,
        };
    };

    let removed_node = nodes.remove(index);
    edges.retain(|edge| edge.source_node_id != node_id && edge.target_node_id != node_id);
    let selected_node_ids = selected_node_ids
        .iter()
        .filter(|selected| selected.as_str() != node_id)
        .cloned()
        .collect();
    let focused_node_id = focused_node_id.filter(|focused| focused != node_id);

    DeleteNodeResult {
        removed_node: Some(removed_node),
        selected_node_ids,
        focused_node_id,
    }
}

pub(crate) fn delete_selected_nodes(
    nodes: Vec<CanvasNodeDto>,
    edges: Vec<CanvasEdgeDto>,
    selected_node_ids: &[String],
    focused_node_id: Option<String>,
) -> DeleteSelectedNodesResult {
    let selected = selected_node_ids.iter().collect::<HashSet<_>>();
    if selected.is_empty() {
        return DeleteSelectedNodesResult {
            deleted_count: 0,
            deleted_node_ids: Vec::new(),
            nodes,
            edges,
            selected_node_ids: selected_node_ids.to_vec(),
            focused_node_id,
        };
    }
    let deleted_node_ids = nodes
        .iter()
        .filter(|node| selected.contains(&node.id))
        .map(|node| node.id.clone())
        .collect::<Vec<_>>();
    let original_len = nodes.len();
    let nodes = nodes
        .into_iter()
        .filter(|node| !selected.contains(&node.id))
        .collect::<Vec<_>>();
    let edges = edges
        .into_iter()
        .filter(|edge| {
            !selected.contains(&edge.source_node_id) && !selected.contains(&edge.target_node_id)
        })
        .collect();
    DeleteSelectedNodesResult {
        deleted_count: original_len.saturating_sub(nodes.len()),
        deleted_node_ids,
        nodes,
        edges,
        selected_node_ids: Vec::new(),
        focused_node_id: None,
    }
}

pub(crate) fn select_node_in_selection(
    selected_node_ids: &[String],
    focused_node_id: Option<&str>,
    node_id: &str,
    additive: bool,
) -> Option<NodeSelectionChange> {
    if node_id.is_empty() {
        return (!selected_node_ids.is_empty() || focused_node_id.is_some()).then(|| {
            NodeSelectionChange {
                selected_node_ids: Vec::new(),
                focused_node_id: None,
            }
        });
    }

    if !additive {
        return (selected_node_ids.len() != 1
            || selected_node_ids[0] != node_id
            || focused_node_id != Some(node_id))
        .then(|| NodeSelectionChange {
            selected_node_ids: vec![node_id.to_string()],
            focused_node_id: Some(node_id.to_string()),
        });
    }

    if selected_node_ids.iter().any(|selected| selected == node_id) {
        return (focused_node_id != Some(node_id)).then(|| NodeSelectionChange {
            selected_node_ids: selected_node_ids.to_vec(),
            focused_node_id: Some(node_id.to_string()),
        });
    }

    let mut selected_node_ids = selected_node_ids.to_vec();
    selected_node_ids.push(node_id.to_string());
    Some(NodeSelectionChange {
        selected_node_ids,
        focused_node_id: Some(node_id.to_string()),
    })
}

pub(crate) fn swap_nodes_by_order(
    nodes: &mut Vec<CanvasNodeDto>,
    source_node_id: &str,
    target_node_id: &str,
) -> bool {
    if source_node_id == target_node_id {
        return false;
    }

    let mut ordered = nodes.clone();
    if ordered
        .windows(2)
        .any(|pair| pair[0].z_index > pair[1].z_index)
    {
        ordered.sort_by_key(|node| node.z_index);
    }

    let source_index = ordered.iter().position(|node| node.id == source_node_id);
    let target_index = ordered.iter().position(|node| node.id == target_node_id);
    let (Some(source_index), Some(target_index)) = (source_index, target_index) else {
        return false;
    };

    ordered.swap(source_index, target_index);
    let updated_at = now();
    for (index, node) in ordered.iter_mut().enumerate() {
        let z_index = 30 + index as i64;
        if node.z_index != z_index {
            node.z_index = z_index;
            node.updated_at = updated_at.clone();
        }
    }
    *nodes = ordered;
    true
}

pub(crate) const AGENT_CALLSIGNS: &[&str] = &[
    "Atlas", "Beacon", "Cipher", "Delta", "Echo", "Forge", "Ion", "Kepler", "Nova", "Orbit",
    "Pulse", "Relay", "Slate", "Vector", "Vega", "Rook",
];

pub(crate) fn duplicate_node_in_nodes(
    nodes: &mut Vec<CanvasNodeDto>,
    node_id: &str,
    used_agent_titles: &[String],
) -> Option<CanvasNodeDto> {
    let original = nodes.iter().find(|node| node.id == node_id)?.clone();
    let timestamp = now();
    let duplicate_title = duplicate_node_title(&original, used_agent_titles);
    let mut duplicate = original.clone();
    duplicate.id = id("node");
    duplicate.title = duplicate_title;
    duplicate.x = original.x + 36.0;
    duplicate.y = original.y + 36.0;
    duplicate.z_index = original.z_index + 1;
    duplicate.created_at = timestamp.clone();
    duplicate.updated_at = timestamp;
    nodes.push(duplicate.clone());
    Some(duplicate)
}

pub(crate) fn duplicate_node_title(
    original: &CanvasNodeDto,
    used_agent_titles: &[String],
) -> String {
    if is_callsign_routable_terminal(original) {
        return next_agent_callsign(used_agent_titles);
    }
    if original.kind == "shell_terminal"
        || (is_terminal_kind(&original.kind)
            && original
                .data
                .get("adapterId")
                .and_then(Value::as_str)
                .is_some_and(|adapter_id| adapter_id == "generic-shell"))
    {
        return "Shell".to_string();
    }
    format!("{} copy", original.title)
}

pub(crate) fn is_callsign_routable_terminal(node: &CanvasNodeDto) -> bool {
    node.kind == "agent_terminal"
        && node
            .data
            .get("adapterId")
            .and_then(Value::as_str)
            .is_some_and(|adapter_id| adapter_id != "generic-shell")
}

pub(crate) fn agent_callsign_titles_for_nodes(nodes: &[CanvasNodeDto]) -> Vec<String> {
    nodes
        .iter()
        .filter(|node| is_callsign_routable_terminal(node))
        .map(|node| node.title.clone())
        .collect()
}

pub(crate) fn next_agent_callsign(used_titles: &[String]) -> String {
    let used = used_titles
        .iter()
        .map(|title| normalize_callsign_lookup(title))
        .collect::<HashSet<_>>();
    for cycle in 0usize.. {
        for root in AGENT_CALLSIGNS {
            let candidate = if cycle == 0 {
                root.to_string()
            } else {
                format!("{root}-{}", cycle + 1)
            };
            if !used.contains(&normalize_callsign_lookup(&candidate)) {
                return candidate;
            }
        }
    }
    unreachable!()
}

pub(crate) fn parse_callsign_panel_input(transcript: &str) -> Option<(String, String)> {
    let trimmed = transcript.trim_start();
    let first = trimmed.chars().next()?;
    if !first.is_ascii_alphabetic() {
        return None;
    }

    let mut callsign_end = 0;
    for (index, ch) in trimmed.char_indices() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            callsign_end = index + ch.len_utf8();
            continue;
        }
        break;
    }
    let callsign = trimmed.get(..callsign_end)?.to_string();
    let rest = trimmed.get(callsign_end..)?;
    if rest.is_empty() {
        return None;
    }

    let input = if rest.starts_with(':') || rest.starts_with(',') {
        rest[1..].trim()
    } else {
        let rest = rest.trim_start();
        if rest.starts_with(':') || rest.starts_with(',') || rest.starts_with('-') {
            rest[1..].trim()
        } else {
            rest.trim()
        }
    };
    (!input.is_empty()).then(|| (callsign, input.to_string()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CallsignPanelInputTarget {
    pub(crate) callsign: String,
    pub(crate) input: String,
    pub(crate) workspace_id: String,
    pub(crate) node_id: String,
    pub(crate) node_title: String,
    pub(crate) is_active_workspace: bool,
}

pub(crate) fn resolve_callsign_panel_input_target(
    transcript: &str,
    canvas_id: &str,
    active_nodes: &[CanvasNodeDto],
    workspaces: &[CanvasDto],
) -> Option<CallsignPanelInputTarget> {
    let (callsign, input) = parse_callsign_panel_input(transcript)?;
    let normalized = normalize_callsign_lookup(&callsign);

    for node in active_nodes {
        if callsign_node_matches(node, &normalized) {
            return Some(CallsignPanelInputTarget {
                callsign,
                input,
                workspace_id: canvas_id.to_string(),
                node_id: node.id.clone(),
                node_title: node.title.clone(),
                is_active_workspace: true,
            });
        }
    }

    for workspace in workspaces {
        if workspace.id == canvas_id {
            continue;
        }
        for node in &workspace.nodes {
            if callsign_node_matches(node, &normalized) {
                return Some(CallsignPanelInputTarget {
                    callsign,
                    input,
                    workspace_id: workspace.id.clone(),
                    node_id: node.id.clone(),
                    node_title: node.title.clone(),
                    is_active_workspace: false,
                });
            }
        }
    }

    None
}

pub(crate) fn normalize_callsign_lookup(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

pub(crate) fn callsign_node_matches(node: &CanvasNodeDto, callsign: &str) -> bool {
    is_callsign_routable_terminal(node) && normalize_callsign_lookup(&node.title) == callsign
}

pub(crate) fn callsign_panel_input_route_payload(
    target: CallsignPanelInputTarget,
    pending_prompt_id: String,
    routed_node: Option<CanvasNodeDto>,
    nodes: Option<Vec<CanvasNodeDto>>,
    workspaces: Option<Vec<CanvasDto>>,
) -> Value {
    let status = if target.is_active_workspace {
        format!("Sent input to {}.", target.node_title)
    } else {
        format!("Queued input for {}.", target.node_title)
    };
    let handoff = target
        .is_active_workspace
        .then(|| callsign_panel_input_handoff_for_target(nodes.as_deref().unwrap_or(&[]), &target));
    json!({
        "target": target,
        "pendingPromptId": pending_prompt_id,
        "routedNode": routed_node,
        "nodes": nodes,
        "workspaces": workspaces,
        "focusedNodeId": target.is_active_workspace.then(|| target.node_id.clone()),
        "selectedNodeIds": if target.is_active_workspace { vec![target.node_id.clone()] } else { Vec::<String>::new() },
        "callsignPanelInputHandoff": handoff,
        "status": status,
    })
}

pub(crate) fn queue_panel_input_on_nodes(
    nodes: &mut [CanvasNodeDto],
    node_id: &str,
    input: &str,
    pending_prompt_id: &str,
) -> Option<CanvasNodeDto> {
    let node = nodes.iter_mut().find(|node| node.id == node_id)?;
    if !is_terminal_kind(&node.kind) {
        return None;
    }
    node.updated_at = now();
    if !node.data.is_object() {
        node.data = json!({});
    }
    if let Some(data) = node.data.as_object_mut() {
        data.insert("pendingPrompt".to_string(), json!(input));
        data.insert("pendingPromptId".to_string(), json!(pending_prompt_id));
        data.insert("pendingPromptLabel".to_string(), json!(input));
    }
    Some(node.clone())
}

pub(crate) fn clear_pending_prompt_in_nodes(
    nodes: &mut [CanvasNodeDto],
    node_id: &str,
    pending_prompt_id: Option<&str>,
) -> Option<CanvasNodeDto> {
    let node = nodes.iter_mut().find(|node| node.id == node_id)?;
    let data = node.data.as_object_mut()?;
    let label = data
        .get("pendingPromptLabel")
        .or_else(|| data.get("pendingPrompt"))
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(expected) = pending_prompt_id {
        let actual = data
            .get("pendingPromptId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if actual != expected {
            return None;
        }
    }
    let had_pending = data.remove("pendingPrompt").is_some()
        || data.remove("pendingPromptId").is_some()
        || data.remove("pendingPromptLabel").is_some();
    if !had_pending {
        return None;
    }
    if let Some(label) = label.filter(|value| !value.trim().is_empty()) {
        data.insert("prompt".to_string(), json!(label));
    }
    node.updated_at = now();
    Some(node.clone())
}

pub(crate) fn callsign_panel_input_handoff_for_target(
    nodes: &[CanvasNodeDto],
    target: &CallsignPanelInputTarget,
) -> Value {
    let from_node_id = nodes
        .iter()
        .find(|node| {
            is_terminal_kind(&node.kind)
                && (node.title.eq_ignore_ascii_case("wheeljack orchestrator")
                    || node.title.eq_ignore_ascii_case("txtl orchestrator"))
        })
        .map(|node| node.id.clone());
    json!({
        "id": id("handoff"),
        "fromNodeId": from_node_id,
        "toNodeId": target.node_id,
        "toNodeTitle": target.node_title,
        "input": target.input,
        "createdAt": now(),
    })
}

pub(crate) struct ClearTerminalTranscriptsResult {
    pub(crate) terminal_ids: Vec<String>,
    pub(crate) cleared_chunks: usize,
    pub(crate) changed: bool,
}

pub(crate) fn clear_persisted_terminal_transcripts_in_nodes(
    nodes: &mut [CanvasNodeDto],
) -> ClearTerminalTranscriptsResult {
    let mut terminal_ids = Vec::new();
    let mut cleared_chunks = 0;
    let mut updated_at = None::<String>;

    for node in nodes {
        if !matches!(node.kind.as_str(), "agent_terminal" | "shell_terminal") {
            continue;
        }
        terminal_ids.push(node.id.clone());
        let chunk_count = node
            .data
            .get("transcript")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        if chunk_count == 0 {
            continue;
        }

        cleared_chunks += chunk_count;
        let timestamp = updated_at.get_or_insert_with(now).clone();
        node.updated_at = timestamp;
        if let Some(data) = node.data.as_object_mut() {
            data.insert("transcript".to_string(), json!([]));
        }
    }

    ClearTerminalTranscriptsResult {
        terminal_ids,
        cleared_chunks,
        changed: cleared_chunks > 0,
    }
}

pub(crate) const MAX_RUNTIME_TRANSCRIPT_CHUNKS: usize = 400;

pub(crate) fn mark_terminal_session_exited_in_nodes(
    nodes: &mut [CanvasNodeDto],
    session_id: &str,
    marker: &str,
) -> Option<CanvasNodeDto> {
    let node = nodes.iter_mut().find(|node| {
        matches!(node.kind.as_str(), "agent_terminal" | "shell_terminal")
            && node
                .data
                .get("sessionId")
                .and_then(Value::as_str)
                .is_some_and(|value| value == session_id)
    })?;
    let timestamp = now();
    node.updated_at = timestamp;
    if let Some(data) = node.data.as_object_mut() {
        data.insert("status".to_string(), json!("exited"));
        data.insert("lastSessionId".to_string(), json!(session_id));
        data.remove("sessionId");
    }
    append_terminal_transcript_marker(&mut node.data, marker.to_string());
    Some(node.clone())
}

pub(crate) fn assign_terminal_worktree_in_nodes(
    nodes: &mut [CanvasNodeDto],
    cwd: &str,
    node_ids: &[String],
) -> Vec<String> {
    let requested_ids =
        (!node_ids.is_empty()).then(|| node_ids.iter().map(String::as_str).collect::<HashSet<_>>());
    let mut assignable_indexes = Vec::new();
    let mut matched_requested_terminal = false;

    for (index, node) in nodes.iter().enumerate() {
        if !matches!(node.kind.as_str(), "agent_terminal" | "shell_terminal") {
            continue;
        }
        if let Some(requested) = requested_ids.as_ref() {
            if !requested.contains(node.id.as_str()) {
                continue;
            }
        }
        matched_requested_terminal = true;
        if terminal_node_is_idle(node) {
            assignable_indexes.push(index);
        }
    }

    if requested_ids.is_some() && !matched_requested_terminal {
        assignable_indexes.clear();
        for (index, node) in nodes.iter().enumerate() {
            if matches!(node.kind.as_str(), "agent_terminal" | "shell_terminal")
                && terminal_node_is_idle(node)
            {
                assignable_indexes.push(index);
            }
        }
    }

    let timestamp = now();
    let mut assigned_ids = Vec::new();
    for index in assignable_indexes {
        let node = &mut nodes[index];
        assigned_ids.push(node.id.clone());
        node.updated_at = timestamp.clone();
        if let Some(data) = node.data.as_object_mut() {
            data.insert("cwd".to_string(), json!(cwd));
        }
        append_terminal_transcript_marker(&mut node.data, format!("worktree -> assigned {cwd}"));
    }
    assigned_ids
}

pub(crate) fn terminal_node_is_idle(node: &CanvasNodeDto) -> bool {
    node.data
        .get("sessionId")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
}

pub(crate) fn append_terminal_transcript_marker(data: &mut Value, marker: String) {
    let mut transcript = data
        .get("transcript")
        .and_then(Value::as_array)
        .map(|chunks| {
            chunks
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    transcript.push(String::new());
    transcript.push(marker);
    if transcript.len() > MAX_RUNTIME_TRANSCRIPT_CHUNKS {
        transcript.drain(0..(transcript.len() - MAX_RUNTIME_TRANSCRIPT_CHUNKS));
    }
    if let Some(object) = data.as_object_mut() {
        object.insert("transcript".to_string(), json!(transcript));
    }
}

pub(crate) fn append_terminal_transcript_marker_in_nodes(
    nodes: &mut [CanvasNodeDto],
    node_id: &str,
    marker: &str,
) -> Option<CanvasNodeDto> {
    let node = nodes
        .iter_mut()
        .find(|node| node.id == node_id && is_terminal_kind(&node.kind))?;
    node.updated_at = now();
    append_terminal_transcript_marker(&mut node.data, marker.to_string());
    Some(node.clone())
}

pub(crate) fn resolve_orchestrator_target<'a>(
    target: &str,
    targets: &'a [OrchestratorTarget],
) -> Option<&'a OrchestratorTarget> {
    if let Some(ordinal) = target_ordinal(target) {
        if let Some(match_by_ordinal) = targets
            .iter()
            .find(|candidate| candidate.ordinal == ordinal)
        {
            return Some(match_by_ordinal);
        }
    }
    let normalized = normalize_lookup(target);
    if normalized.is_empty() {
        return None;
    }
    targets
        .iter()
        .find(|candidate| normalize_lookup(&candidate.title) == normalized)
        .or_else(|| {
            targets.iter().find(|candidate| {
                let title = normalize_lookup(&candidate.title);
                title.contains(&normalized) || normalized.contains(&title)
            })
        })
        .or_else(|| {
            targets
                .iter()
                .find(|candidate| normalize_lookup(&candidate.node_id) == normalized)
        })
}

pub(crate) fn build_orchestrated_prompt(task: &str, target: &OrchestratorTarget) -> String {
    let context = if target.recent_context.trim().is_empty() {
        "No recent transcript was available.".to_string()
    } else {
        target.recent_context.clone()
    };
    format!(
        "wheeljack orchestrator instruction for {title}: {task}\n\nCurrent observed terminal state ({status}):\n{context}\n\nContinue from this terminal's current context. Keep changes focused on this assignment, report blockers clearly, and do not disturb unrelated work.",
        title = target.title,
        task = task.trim(),
        status = target.status,
        context = context,
    )
}

pub(crate) fn plan_orchestrator_routes(
    db: &Connection,
    req: &OrchestratorRouteRequest,
) -> Result<Vec<OrchestratorRouteDto>> {
    let assignments = if req.assignments.is_empty() {
        parse_orchestrator_assignments(&req.transcript)
    } else {
        req.assignments.clone()
    };
    if assignments.is_empty() {
        bail!("orchestrator command did not include target assignments");
    }
    let targets = load_orchestrator_targets(db, req.canvas_id.as_deref())?;
    Ok(assignments
        .into_iter()
        .map(|assignment| {
            let target = assignment.target.trim().to_string();
            let task = assignment.task.trim().to_string();
            let task_id = assignment.task_id;
            match resolve_orchestrator_target(&target, &targets) {
                Some(candidate) => {
                    let prompt = build_orchestrated_prompt(&task, candidate);
                    OrchestratorRouteDto {
                        target,
                        task,
                        task_id,
                        node_id: Some(candidate.node_id.clone()),
                        node_title: Some(candidate.title.clone()),
                        session_id: candidate.session_id.clone(),
                        adapter_id: Some(candidate.adapter_id.clone()),
                        status: candidate.status.clone(),
                        prompt,
                        recent_context: candidate.recent_context.clone(),
                        delivered: false,
                        reason: if candidate.kind != "agent_terminal" {
                            Some("target is not an agent terminal".to_string())
                        } else if candidate.session_id.is_none() {
                            Some("target has no recorded PTY session".to_string())
                        } else {
                            None
                        },
                    }
                }
                None => OrchestratorRouteDto {
                    target,
                    task,
                    task_id,
                    node_id: None,
                    node_title: None,
                    session_id: None,
                    adapter_id: None,
                    status: "missing".to_string(),
                    prompt: String::new(),
                    recent_context: String::new(),
                    delivered: false,
                    reason: Some("no terminal matched that target".to_string()),
                },
            }
        })
        .collect())
}

pub(crate) fn persist_orchestrator_chunk(
    db: &Connection,
    session_id: &str,
    prompt: &str,
) -> Result<()> {
    let next_seq = db
        .query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM session_chunks WHERE session_id = ?1",
            params![session_id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(1) as u64;
    let chunk = format!("\r\norchestrator -> {prompt}\r\n");
    persist_session_stream_chunk(db, session_id, next_seq, "orchestrator", chunk.as_bytes())?;
    Ok(())
}

pub(crate) fn orchestrator_assignments_from_action(
    action: &Value,
) -> Vec<OrchestratorAssignmentDto> {
    action
        .get("assignments")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(OrchestratorAssignmentDto {
                        target: item.get("target")?.as_str()?.to_string(),
                        task: item.get("task")?.as_str()?.to_string(),
                        task_id: item
                            .get("taskId")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}
