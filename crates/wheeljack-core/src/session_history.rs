use super::*;

pub(crate) type SessionChunk = (u64, Vec<u8>);
pub(crate) type SessionChunkPage = (Vec<SessionChunk>, usize);

pub(crate) fn load_session_history(
    db: &Connection,
    limit: i64,
) -> Result<Vec<SessionHistoryItemDto>> {
    let mut stmt = db.prepare(
        "SELECT
           s.id,
           s.node_id,
           COALESCE(n.title, s.node_id) AS node_title,
           s.adapter_id,
           s.cwd,
           s.status,
           s.started_at,
           s.ended_at,
           (
             SELECT COUNT(*)
             FROM session_chunks c
             WHERE c.session_id = s.id
           ) AS chunk_count
         FROM sessions s
         LEFT JOIN nodes n ON n.id = s.node_id
         ORDER BY COALESCE(s.started_at, s.created_at) DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        Ok(SessionHistoryItemDto {
            id: row.get(0)?,
            node_id: row.get(1)?,
            node_title: row.get(2)?,
            adapter_id: row.get(3)?,
            cwd: row.get(4)?,
            status: row.get(5)?,
            started_at: row.get(6)?,
            ended_at: row.get(7)?,
            chunk_count: row.get(8)?,
            transcript_preview: String::new(),
        })
    })?;
    let mut sessions = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    for session in &mut sessions {
        session.transcript_preview = load_session_preview(db, &session.id)?;
    }
    Ok(sessions)
}

pub(crate) fn load_session_chunks(db: &Connection, session_id: &str) -> Result<Vec<Vec<u8>>> {
    let mut stmt = db.prepare_cached(
        "SELECT data FROM session_chunks
         WHERE session_id = ?1
         ORDER BY seq ASC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| row.get::<_, Vec<u8>>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub(crate) fn load_session_chunk_page(
    db: &Connection,
    session_id: &str,
    before_seq: Option<u64>,
    limit: usize,
) -> Result<SessionChunkPage> {
    let total = db.query_row(
        "SELECT COUNT(*) FROM session_chunks WHERE session_id = ?1",
        params![session_id],
        |row| row.get::<_, usize>(0),
    )?;
    let mut statement = db.prepare_cached(
        "SELECT seq, data FROM session_chunks
         WHERE session_id = ?1 AND (?2 IS NULL OR seq < ?2)
         ORDER BY seq DESC, id DESC
         LIMIT ?3",
    )?;
    let rows = statement.query_map(
        params![
            session_id,
            before_seq.map(|value| value as i64),
            limit as i64
        ],
        |row| Ok((row.get::<_, u64>(0)?, row.get::<_, Vec<u8>>(1)?)),
    )?;
    let mut chunks = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    chunks.reverse();
    Ok((chunks, total))
}

pub(crate) fn load_session_preview(db: &Connection, session_id: &str) -> Result<String> {
    let mut stmt = db.prepare_cached(
        "SELECT data FROM session_chunks
         WHERE session_id = ?1
         ORDER BY seq DESC
         LIMIT 3",
    )?;
    let rows = stmt.query_map(params![session_id], |row| row.get::<_, Vec<u8>>(0))?;
    let mut chunks = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    chunks.reverse();
    Ok(trim_preview(&decode_visible_chunks(&chunks), 260))
}

pub(crate) fn decode_chunks(chunks: &[Vec<u8>]) -> String {
    let mut decoded = String::with_capacity(chunks.iter().map(Vec::len).sum());
    for chunk in chunks {
        decoded.push_str(&String::from_utf8_lossy(chunk));
    }
    decoded
}

pub(crate) fn decode_visible_chunks(chunks: &[Vec<u8>]) -> String {
    chunks
        .iter()
        .filter_map(|chunk| {
            let text = String::from_utf8_lossy(chunk);
            visible_terminal_transcript_chunk(&text)
        })
        .collect::<Vec<_>>()
        .join("")
}

pub(crate) fn decode_session_chunk_page(chunks: &[SessionChunk], visible: bool) -> String {
    if visible {
        return chunks
            .iter()
            .filter_map(|(_, chunk)| {
                let text = String::from_utf8_lossy(chunk);
                visible_terminal_transcript_chunk(&text)
            })
            .collect::<Vec<_>>()
            .join("");
    }
    let mut decoded = String::with_capacity(chunks.iter().map(|(_, chunk)| chunk.len()).sum());
    for (_, chunk) in chunks {
        decoded.push_str(&String::from_utf8_lossy(chunk));
    }
    decoded
}

pub(crate) fn contains_coordination_prompt_bytes(bytes: &[u8]) -> bool {
    contains_coordination_prompt_text(&String::from_utf8_lossy(bytes))
}

pub(crate) fn contains_coordination_prompt_text(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    value.contains(COORDINATION_PROMPT_HEADER) || value.contains(LEGACY_COORDINATION_PROMPT_HEADER)
}

pub(crate) fn coordination_visible_line(value: &str) -> Option<String> {
    if !contains_coordination_prompt_text(value) {
        let trimmed = value.trim();
        return (!trimmed.is_empty()).then(|| trimmed.to_string());
    }
    let lower = value.to_ascii_lowercase();
    let marker = "user instruction:";
    let marker_index = lower.rfind(marker)?;
    let visible = value[marker_index + marker.len()..].trim();
    (!visible.is_empty()).then(|| visible.to_string())
}

pub(crate) fn search_session_history(
    db: &Connection,
    query: &str,
) -> Result<Vec<SessionSearchResultDto>> {
    search_session_history_fts(db, query).or_else(|_| search_session_history_like(db, query))
}

fn search_session_history_fts(db: &Connection, query: &str) -> Result<Vec<SessionSearchResultDto>> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let fts_query = format!("\"{}\"", query.trim().replace('"', "\"\""));
    let mut stmt = db.prepare(
        "SELECT
           s.id,
           s.node_id,
           COALESCE(n.title, s.node_id) AS node_title,
           s.adapter_id,
           s.cwd,
           s.status,
           s.started_at,
           session_chunks_fts.data
         FROM session_chunks_fts
         JOIN session_chunks c ON c.id = session_chunks_fts.rowid
         JOIN sessions s ON s.id = c.session_id
         LEFT JOIN nodes n ON n.id = s.node_id
         WHERE session_chunks_fts MATCH ?1
         ORDER BY COALESCE(s.started_at, s.created_at) DESC, c.seq ASC
         LIMIT 200",
    )?;
    let rows = stmt.query_map(params![fts_query], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, String>(7)?,
        ))
    })?;
    let mut seen_sessions = HashSet::new();
    let mut results = Vec::new();
    for row in rows {
        let (session_id, node_id, node_title, adapter_id, cwd, status, started_at, chunk) = row?;
        if !seen_sessions.insert(session_id.clone()) {
            continue;
        }
        let index = chunk.to_lowercase().find(&needle).unwrap_or(0);
        results.push(SessionSearchResultDto {
            session_id,
            node_id,
            node_title,
            adapter_id,
            cwd,
            status,
            started_at,
            snippet: make_snippet(
                &chunk,
                nearest_char_boundary(&chunk, index),
                query.trim().len(),
            ),
        });
        if results.len() >= 50 {
            break;
        }
    }
    Ok(results)
}

fn search_session_history_like(
    db: &Connection,
    query: &str,
) -> Result<Vec<SessionSearchResultDto>> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = db.prepare(
        "SELECT
           s.id,
           s.node_id,
           COALESCE(n.title, s.node_id) AS node_title,
           s.adapter_id,
           s.cwd,
           s.status,
           s.started_at,
           c.data
         FROM session_chunks c
         JOIN sessions s ON s.id = c.session_id
         LEFT JOIN nodes n ON n.id = s.node_id
         WHERE lower(CAST(c.data AS TEXT)) LIKE '%' || ?1 || '%'
         ORDER BY COALESCE(s.started_at, s.created_at) DESC, c.seq ASC
         LIMIT 200",
    )?;
    let rows = stmt.query_map(params![needle], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Vec<u8>>(7)?,
        ))
    })?;
    let mut seen_sessions = HashSet::new();
    let mut results = Vec::new();
    for row in rows {
        let (session_id, node_id, node_title, adapter_id, cwd, status, started_at, data) = row?;
        if !seen_sessions.insert(session_id.clone()) {
            continue;
        }
        let chunk = String::from_utf8_lossy(&data).to_string();
        let index = chunk.to_lowercase().find(&needle).unwrap_or(0);
        results.push(SessionSearchResultDto {
            session_id,
            node_id,
            node_title,
            adapter_id,
            cwd,
            status,
            started_at,
            snippet: make_snippet(
                &chunk,
                nearest_char_boundary(&chunk, index),
                query.trim().len(),
            ),
        });
        if results.len() >= 50 {
            break;
        }
    }
    Ok(results)
}

pub(crate) fn trim_preview(value: &str, max_chars: usize) -> String {
    let cleaned = value.replace('\r', "").trim().to_string();
    if cleaned.chars().count() <= max_chars {
        return cleaned;
    }
    let mut preview = cleaned.chars().take(max_chars).collect::<String>();
    preview.push_str("...");
    preview
}

fn make_snippet(value: &str, byte_index: usize, query_len: usize) -> String {
    let start = value[..byte_index]
        .char_indices()
        .rev()
        .nth(90)
        .map(|(index, _)| index)
        .unwrap_or(0);
    let end_target = byte_index.saturating_add(query_len).saturating_add(180);
    let end = value
        .char_indices()
        .find(|(index, _)| *index >= end_target)
        .map(|(index, _)| index)
        .unwrap_or(value.len());
    trim_preview(&value[start..end], 300)
}

fn nearest_char_boundary(value: &str, mut index: usize) -> usize {
    index = index.min(value.len());
    while index > 0 && !value.is_char_boundary(index) {
        index -= 1;
    }
    index
}
