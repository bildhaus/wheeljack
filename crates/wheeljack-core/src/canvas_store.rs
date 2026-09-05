use super::*;

pub(crate) fn ensure_canvas_exists(
    db: &Connection,
    canvas_id: &str,
    project: Option<&ProjectDto>,
    theme_id: Option<&str>,
    camera: Option<&CameraDto>,
) -> Result<()> {
    let exists: Option<String> = db
        .query_row(
            "SELECT id FROM canvases WHERE id = ?1",
            params![canvas_id],
            |row| row.get(0),
        )
        .optional()?;
    if exists.is_some() {
        return Ok(());
    }

    let ts = now();
    let project_id = project
        .map(|value| value.id.clone())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "project_local".to_string());
    let project_name = project
        .map(|value| value.name.clone())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Local project".to_string());
    let project_path = project
        .map(|value| value.path.clone())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| ".".to_string());
    db.execute(
        "INSERT OR IGNORE INTO projects (id, name, path, created_at, updated_at, last_opened_at)
         VALUES (?1, ?2, ?3, ?4, ?4, ?4)",
        params![project_id, project_name, project_path, ts],
    )?;
    let stored_project_id: String = db.query_row(
        "SELECT id FROM projects WHERE id = ?1 OR path = ?2 ORDER BY CASE WHEN id = ?1 THEN 0 ELSE 1 END LIMIT 1",
        params![project_id, project_path],
        |row| row.get(0),
    )?;
    let camera_value = camera.cloned().unwrap_or(CameraDto {
        x: 90.0,
        y: 76.0,
        scale: 0.86,
    });
    let sort_index = next_canvas_sort_index(db, &stored_project_id)?;
    db.execute(
        "INSERT INTO canvases (id, project_id, name, theme_id, camera_json, sort_index, created_at, updated_at)
         VALUES (?1, ?2, 'Main canvas', ?3, ?4, ?5, ?6, ?6)",
        params![
            canvas_id,
            stored_project_id,
            theme_id.unwrap_or("mono-dark"),
            canvas_camera_json(
                &camera_value,
                Some(sort_index),
                Some(0),
                Vec::new(),
                None
            )?,
            sort_index,
            ts
        ],
    )?;
    Ok(())
}

pub(crate) fn sync_canvas_nodes(
    tx: &rusqlite::Transaction<'_>,
    canvas_id: &str,
    nodes: Vec<CanvasNodeDto>,
) -> Result<()> {
    let incoming_ids = nodes
        .iter()
        .map(|node| node.id.clone())
        .collect::<HashSet<_>>();
    if incoming_ids.is_empty() {
        tx.execute("DELETE FROM nodes WHERE canvas_id = ?1", params![canvas_id])?;
        return Ok(());
    }

    let existing_ids = {
        let mut stmt = tx.prepare("SELECT id FROM nodes WHERE canvas_id = ?1")?;
        let rows = stmt.query_map(params![canvas_id], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for existing_id in existing_ids {
        if !incoming_ids.contains(&existing_id) {
            tx.execute(
                "DELETE FROM nodes WHERE canvas_id = ?1 AND id = ?2",
                params![canvas_id, existing_id],
            )?;
        }
    }
    for node in nodes {
        upsert_canvas_node(tx, canvas_id, &node)?;
    }
    Ok(())
}

pub(crate) fn upsert_canvas_node(
    db: &Connection,
    canvas_id: &str,
    node: &CanvasNodeDto,
) -> Result<()> {
    let changed = db.execute(
        "INSERT INTO nodes (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           title = excluded.title,
           x = excluded.x,
           y = excluded.y,
           width = excluded.width,
           height = excluded.height,
           z_index = excluded.z_index,
           data_json = excluded.data_json,
           updated_at = excluded.updated_at
         WHERE nodes.canvas_id = excluded.canvas_id",
        params![
            node.id,
            canvas_id,
            node.kind,
            node.title,
            node.x,
            node.y,
            node.width,
            node.height,
            node.z_index,
            node_data_with_layout_for_persistence(node).to_string(),
            node.created_at,
            node.updated_at
        ],
    )?;
    if changed == 0 {
        bail!("node {} belongs to another canvas", node.id);
    }
    Ok(())
}

pub(crate) const WINDOWS_MULTIPLEXER_SURFACE: &str = "windows-multiplexer-v1";
pub(crate) const WINDOWS_MULTIPLEXER_LAYOUT_VERSION: u32 = 1;
const MAX_SPLIT_TREE_DEPTH: usize = 64;

pub(crate) fn load_canvas_layout(
    db: &Connection,
    canvas_id: &str,
) -> Result<Option<CanvasLayoutDto>> {
    let stored = db
        .query_row(
            "SELECT version, layout_mode, layout_json, updated_at
             FROM canvas_layouts WHERE canvas_id = ?1 AND surface = ?2",
            params![canvas_id, WINDOWS_MULTIPLEXER_SURFACE],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()?;
    let Some((version, layout_mode, layout_json, updated_at)) = stored else {
        return Ok(None);
    };
    let version = u32::try_from(version).context("invalid canvas layout version")?;
    let mode = serde_json::from_value::<CanvasLayoutModeDto>(Value::String(layout_mode))?;
    let root = serde_json::from_str::<Option<CanvasSplitNodeDto>>(&layout_json)?;
    validate_canvas_layout(version, root.as_ref())?;
    Ok(Some(CanvasLayoutDto {
        canvas_id: canvas_id.to_string(),
        surface: WINDOWS_MULTIPLEXER_SURFACE.to_string(),
        version,
        mode,
        root,
        updated_at,
    }))
}

pub(crate) fn save_canvas_layout(
    db: &Connection,
    canvas_id: &str,
    layout: CanvasLayoutDocumentDto,
) -> Result<CanvasLayoutDto> {
    validate_canvas_layout(layout.version, layout.root.as_ref())?;
    let updated_at = now();
    let layout_mode = match layout.mode {
        CanvasLayoutModeDto::Auto => "auto",
        CanvasLayoutModeDto::Manual => "manual",
    };
    db.execute(
        "INSERT INTO canvas_layouts (canvas_id, surface, version, layout_mode, layout_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(canvas_id, surface) DO UPDATE SET
           version = excluded.version,
           layout_mode = excluded.layout_mode,
           layout_json = excluded.layout_json,
           updated_at = excluded.updated_at",
        params![
            canvas_id,
            WINDOWS_MULTIPLEXER_SURFACE,
            layout.version,
            layout_mode,
            serde_json::to_string(&layout.root)?,
            updated_at
        ],
    )?;
    Ok(CanvasLayoutDto {
        canvas_id: canvas_id.to_string(),
        surface: WINDOWS_MULTIPLEXER_SURFACE.to_string(),
        version: layout.version,
        mode: layout.mode,
        root: layout.root,
        updated_at,
    })
}

fn validate_canvas_layout(version: u32, root: Option<&CanvasSplitNodeDto>) -> Result<()> {
    if version != WINDOWS_MULTIPLEXER_LAYOUT_VERSION {
        bail!("unsupported canvas layout version: {version}");
    }
    fn validate_node(
        node: &CanvasSplitNodeDto,
        depth: usize,
        pane_ids: &mut HashSet<String>,
    ) -> Result<()> {
        if depth > MAX_SPLIT_TREE_DEPTH {
            bail!("canvas layout exceeds {MAX_SPLIT_TREE_DEPTH} levels");
        }
        match node {
            CanvasSplitNodeDto::Leaf { pane_id } => {
                if pane_id.trim().is_empty() {
                    bail!("canvas layout paneId is required");
                }
                if !pane_ids.insert(pane_id.clone()) {
                    bail!("canvas layout contains duplicate paneId: {pane_id}");
                }
            }
            CanvasSplitNodeDto::Split {
                ratio,
                first,
                second,
                ..
            } => {
                if !ratio.is_finite() || *ratio <= 0.0 || *ratio >= 1.0 {
                    bail!("canvas layout ratio must be between 0 and 1");
                }
                validate_node(first, depth + 1, pane_ids)?;
                validate_node(second, depth + 1, pane_ids)?;
            }
        }
        Ok(())
    }

    if let Some(root) = root {
        validate_node(root, 1, &mut HashSet::new())?;
    }
    Ok(())
}

pub(crate) fn replace_canvas_edges(
    tx: &rusqlite::Transaction<'_>,
    canvas_id: &str,
    edges: &[CanvasEdgeDto],
) -> Result<()> {
    tx.execute("DELETE FROM edges WHERE canvas_id = ?1", params![canvas_id])?;
    for edge in edges {
        tx.execute(
            "INSERT INTO edges (id, canvas_id, source_node_id, target_node_id, kind, data_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                edge.id,
                canvas_id,
                edge.source_node_id,
                edge.target_node_id,
                edge.kind,
                json!({"label": edge.label}).to_string(),
                now()
            ],
        )?;
    }
    Ok(())
}

pub(crate) const MAX_PERSISTED_TRANSCRIPT_CHUNKS: usize = 24;
const NODE_LAYOUT_DATA_KEY: &str = "__wheeljackLayout";
const LEGACY_NODE_LAYOUT_DATA_KEY: &str = "__txtlLayout";

#[derive(Default)]
struct PersistedNodeLayout {
    col_span: Option<f64>,
    row_span: Option<f64>,
    single_pane_width: Option<f64>,
    single_pane_height: Option<f64>,
}

fn node_data_with_layout_for_persistence(node: &CanvasNodeDto) -> Value {
    let mut data = sanitize_node_data_for_persistence(&node.kind, node.data.clone());
    let layout = json_object_without_nulls([
        ("colSpan", optional_number_value(node.col_span)),
        ("rowSpan", optional_number_value(node.row_span)),
        (
            "singlePaneWidth",
            optional_number_value(node.single_pane_width),
        ),
        (
            "singlePaneHeight",
            optional_number_value(node.single_pane_height),
        ),
    ]);
    if let Some(object) = data.as_object_mut() {
        object.remove(LEGACY_NODE_LAYOUT_DATA_KEY);
        if !layout
            .as_object()
            .map(|item| item.is_empty())
            .unwrap_or(true)
        {
            object.insert(NODE_LAYOUT_DATA_KEY.to_string(), layout);
        } else {
            object.remove(NODE_LAYOUT_DATA_KEY);
        }
    }
    data
}

fn optional_number_value(value: Option<f64>) -> Value {
    value
        .and_then(serde_json::Number::from_f64)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn take_node_layout_from_data(data: &mut Value) -> PersistedNodeLayout {
    let Some(object) = data.as_object_mut() else {
        return PersistedNodeLayout::default();
    };
    let Some(layout) = object
        .remove(NODE_LAYOUT_DATA_KEY)
        .or_else(|| object.remove(LEGACY_NODE_LAYOUT_DATA_KEY))
    else {
        return PersistedNodeLayout::default();
    };
    PersistedNodeLayout {
        col_span: layout.get("colSpan").and_then(Value::as_f64),
        row_span: layout.get("rowSpan").and_then(Value::as_f64),
        single_pane_width: layout.get("singlePaneWidth").and_then(Value::as_f64),
        single_pane_height: layout.get("singlePaneHeight").and_then(Value::as_f64),
    }
}

fn sanitize_node_data_for_persistence(kind: &str, data: Value) -> Value {
    if kind == "markdown_note" {
        return sanitize_markdown_note_data(data);
    }
    if kind == "browser_preview" {
        return sanitize_browser_preview_data(data);
    }
    if kind == "task_checklist" {
        return sanitize_task_checklist_data(data);
    }
    if kind == "shape" {
        return sanitize_shape_data(data);
    }
    if !matches!(kind, "agent_terminal" | "shell_terminal") {
        return data;
    }
    let mut data = data;
    if kind == "agent_terminal" {
        sanitize_agent_composition(&mut data);
    }
    let Some(chunks) = data.get("transcript").and_then(Value::as_array) else {
        return data;
    };
    let mut persisted = Vec::new();
    for chunk in chunks.iter().rev() {
        let Some(text) = chunk.as_str() else {
            continue;
        };
        if persisted_transcript_chunk(text) {
            persisted.push(Value::String(text.to_string()));
            if persisted.len() >= MAX_PERSISTED_TRANSCRIPT_CHUNKS {
                break;
            }
        }
    }
    persisted.reverse();

    if let Some(object) = data.as_object_mut() {
        object.insert("transcript".to_string(), Value::Array(persisted));
    }
    data
}

fn sanitize_agent_composition(data: &mut Value) {
    let Some(object) = data.as_object_mut() else {
        return;
    };
    let Some(composition) = object.get("chatComposition").and_then(Value::as_object) else {
        object.remove("chatComposition");
        return;
    };
    let attachments = composition
        .get("attachments")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let item = item.as_object()?;
                    let path = item.get("path")?.as_str()?.trim();
                    let file_name = item.get("fileName")?.as_str()?.trim();
                    let mime_type = item.get("mimeType")?.as_str()?.trim();
                    if path.is_empty() || file_name.is_empty() || !mime_type.starts_with("image/") {
                        return None;
                    }
                    Some(json!({
                        "path": path.chars().take(4096).collect::<String>(),
                        "fileName": file_name.chars().take(512).collect::<String>(),
                        "mimeType": mime_type.chars().take(128).collect::<String>(),
                    }))
                })
                .take(4)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let draft = composition
        .get("draft")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .chars()
        .take(20_000)
        .collect::<String>();
    let scroll_top = composition
        .get("scrollTop")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .unwrap_or(0.0)
        .clamp(0.0, 10_000_000.0);
    let follow_latest = composition
        .get("followLatest")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let queued_edit = composition
        .get("queuedEdit")
        .and_then(Value::as_object)
        .and_then(|edit| {
            let delivery_id = edit.get("deliveryId")?.as_str()?.trim();
            if delivery_id.is_empty() || delivery_id.len() > 160 {
                return None;
            }
            let mut normalized = json!({ "chatComposition": {
                "draft": edit.get("draft"), "attachments": edit.get("attachments"),
            }});
            sanitize_agent_composition(&mut normalized);
            Some(json!({
                "deliveryId": delivery_id,
                "draft": normalized["chatComposition"]["draft"],
                "attachments": normalized["chatComposition"]["attachments"],
            }))
        });
    object.insert(
        "chatComposition".to_string(),
        json!({
            "version": 1,
            "draft": draft,
            "attachments": attachments,
            "scrollTop": scroll_top,
            "followLatest": follow_latest,
        }),
    );
    if let Some(edit) = queued_edit {
        object["chatComposition"]["queuedEdit"] = edit;
    }
}

#[cfg(test)]
mod agent_composition_tests {
    use super::*;

    #[test]
    fn bounds_durable_agent_composition() {
        let data = sanitize_node_data_for_persistence(
            "agent_terminal",
            json!({
                "sessionId": "session-1",
                "chatComposition": {
                    "draft": "continue",
                    "attachments": [
                        { "path": "attachments/one.png", "fileName": "one.png", "mimeType": "image/png" },
                        { "path": "attachments/nope.txt", "fileName": "nope.txt", "mimeType": "text/plain" }
                    ],
                    "scrollTop": -10,
                    "queuedEdit": { "deliveryId": "pending", "draft": "x".repeat(20_005), "attachments": [
                        { "path": "attachments/two.png", "fileName": "two.png", "mimeType": "image/png" },
                        { "path": "bad", "fileName": "bad", "mimeType": "text/plain" }
                    ] },
                    "followLatest": false
                }
            }),
        );

        assert_eq!(data["sessionId"], "session-1");
        assert_eq!(data["chatComposition"]["version"], 1);
        assert_eq!(data["chatComposition"]["draft"], "continue");
        assert_eq!(
            data["chatComposition"]["attachments"]
                .as_array()
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(data["chatComposition"]["scrollTop"], 0.0);
        assert_eq!(data["chatComposition"]["followLatest"], false);
        assert_eq!(
            data["chatComposition"]["queuedEdit"]["deliveryId"],
            "pending"
        );
        assert_eq!(
            data["chatComposition"]["queuedEdit"]["draft"]
                .as_str()
                .unwrap()
                .len(),
            20_000
        );
        assert_eq!(
            data["chatComposition"]["queuedEdit"]["attachments"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
}

fn sanitize_markdown_note_data(data: Value) -> Value {
    let markdown = data
        .get("markdown")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mode = match data.get("mode").and_then(Value::as_str) {
        Some("preview") => "preview",
        _ => "edit",
    };
    let mut output = data.as_object().cloned().unwrap_or_default();
    output.insert("markdown".to_string(), json!(markdown));
    output.insert("mode".to_string(), json!(mode));
    Value::Object(output)
}

fn sanitize_browser_preview_data(data: Value) -> Value {
    let url = data
        .get("url")
        .and_then(Value::as_str)
        .map(normalize_browser_url)
        .unwrap_or_else(|| normalize_browser_url(""));
    let load_state = match data.get("loadState").and_then(Value::as_str) {
        Some("loading") => "loading",
        Some("error") => "error",
        _ => "ready",
    };
    let mut output = data.as_object().cloned().unwrap_or_default();
    output.insert("url".to_string(), json!(url));
    output.insert("loadState".to_string(), json!(load_state));
    Value::Object(output)
}

fn sanitize_task_checklist_data(data: Value) -> Value {
    let mut output = data.as_object().cloned().unwrap_or_default();
    output.insert(
        "items".to_string(),
        Value::Array(
            data.get("items")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(sanitize_task_checklist_item)
                        .collect()
                })
                .unwrap_or_default(),
        ),
    );
    if let Some(coordination) = data.get("coordination").filter(|value| value.is_object()) {
        output.insert("coordination".to_string(), coordination.clone());
    }
    Value::Object(output)
}

fn sanitize_shape_data(data: Value) -> Value {
    let shape = match data.get("shape").and_then(Value::as_str) {
        Some("circle") => "circle",
        Some("diamond") => "diamond",
        _ => "rectangle",
    };
    let color = data
        .get("color")
        .and_then(Value::as_str)
        .filter(|value| is_hex_color(value) || value.trim().eq_ignore_ascii_case("var(--accent)"))
        .unwrap_or("var(--accent)");
    let mut output = data.as_object().cloned().unwrap_or_default();
    output.insert("shape".to_string(), json!(shape));
    output.insert("color".to_string(), json!(color));
    if let Some(text) = data.get("text").and_then(Value::as_str) {
        output.insert("text".to_string(), json!(text));
    }
    Value::Object(output)
}

fn sanitize_task_checklist_item(item: &Value) -> Option<Value> {
    let label = item
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let id = item.get("id").and_then(Value::as_str).unwrap_or_default();
    if label.trim().is_empty() && id.trim().is_empty() {
        return None;
    }
    let mut output = serde_json::Map::from_iter([
        ("id".to_string(), json!(id)),
        ("label".to_string(), json!(label)),
        (
            "done".to_string(),
            json!(item.get("done").and_then(Value::as_bool).unwrap_or(false)),
        ),
    ]);
    for key in ["status", "ownerCallsign", "updatedAt"] {
        if let Some(value) = item.get(key).and_then(Value::as_str) {
            output.insert(key.to_string(), json!(value));
        }
    }
    if let Some(files) = item.get("files").and_then(Value::as_array) {
        let files = files
            .iter()
            .filter_map(Value::as_str)
            .map(|file| json!(file))
            .collect::<Vec<_>>();
        if !files.is_empty() {
            output.insert("files".to_string(), Value::Array(files));
        }
    }
    Some(Value::Object(output))
}

fn persisted_transcript_chunk(chunk: &str) -> bool {
    if contains_coordination_prompt_text(chunk) {
        return false;
    }
    let value = chunk.trim();
    value.is_empty()
        || value.starts_with("pty ->")
        || value.starts_with("user ->")
        || value.starts_with("orchestrator ->")
}

pub(crate) fn load_canvas(db: &Connection, canvas_id: &str) -> Result<CanvasDto> {
    let (id, project_id, name, theme_id, camera_json): (String, String, String, String, String) =
        db.query_row(
            "SELECT id, project_id, name, theme_id, camera_json FROM canvases WHERE id = ?1",
            params![canvas_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )?;
    let camera_store = parse_canvas_camera_store(&camera_json)?;
    let nodes = load_nodes(db, &id)?
        .into_iter()
        .filter(|node| !is_legacy_closed_node(node))
        .collect::<Vec<_>>();
    let node_ids = nodes
        .iter()
        .map(|node| node.id.clone())
        .collect::<HashSet<_>>();
    let selected_node_ids = camera_store
        .selected_node_ids
        .iter()
        .filter(|node_id| node_ids.contains(*node_id))
        .cloned()
        .collect::<Vec<_>>();
    let focused_node_id = camera_store
        .focused_node_id
        .clone()
        .filter(|node_id| node_ids.contains(node_id));
    Ok(CanvasDto {
        id: id.clone(),
        project_id,
        name,
        theme_id,
        camera: camera_store.camera(),
        grid_x: camera_store.grid_x,
        grid_y: camera_store.grid_y,
        selected_node_ids,
        focused_node_id,
        nodes,
        edges: load_edges(db, &id)?
            .into_iter()
            .filter(|edge| {
                node_ids.contains(&edge.source_node_id) && node_ids.contains(&edge.target_node_id)
            })
            .collect(),
    })
}

pub(crate) fn load_project_canvases(db: &Connection, project_id: &str) -> Result<Vec<CanvasDto>> {
    let mut stmt = db.prepare(
        "SELECT id FROM canvases
         WHERE project_id = ?1
         ORDER BY sort_index ASC, created_at ASC, id ASC",
    )?;
    let ids = stmt
        .query_map(params![project_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ids.iter().map(|id| load_canvas(db, id)).collect()
}

#[derive(Debug, Clone)]
pub(crate) struct CanvasOrderRow {
    pub(crate) id: String,
    pub(crate) sort_index: i64,
    pub(crate) grid_x: i64,
    pub(crate) grid_y: i64,
}

pub(crate) fn load_project_canvas_order(
    db: &Connection,
    project_id: &str,
) -> Result<Vec<CanvasOrderRow>> {
    let mut stmt = db.prepare(
        "SELECT id, sort_index, camera_json FROM canvases
         WHERE project_id = ?1
         ORDER BY sort_index ASC, created_at ASC, id ASC",
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        let sort_index = row.get(1)?;
        let camera_json: String = row.get(2)?;
        let camera = parse_canvas_camera_store(&camera_json).unwrap_or(CanvasCameraStore {
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            grid_x: None,
            grid_y: None,
            selected_node_ids: Vec::new(),
            focused_node_id: None,
        });
        Ok(CanvasOrderRow {
            id: row.get(0)?,
            sort_index,
            grid_x: camera.grid_x.unwrap_or(sort_index),
            grid_y: camera.grid_y.unwrap_or(0),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn parse_canvas_camera_store(camera_json: &str) -> Result<CanvasCameraStore> {
    let value: Value = serde_json::from_str(camera_json)?;
    let camera = serde_json::from_value::<CameraDto>(value.clone())?;
    let mut store = CanvasCameraStore::from(&camera);
    store.grid_x = value.get("gridX").and_then(Value::as_i64);
    store.grid_y = value.get("gridY").and_then(Value::as_i64);
    store.selected_node_ids = value
        .get("selectedNodeIds")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    store.focused_node_id = value
        .get("focusedNodeId")
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(store)
}

pub(crate) fn canvas_camera_json(
    camera: &CameraDto,
    grid_x: Option<i64>,
    grid_y: Option<i64>,
    selected_node_ids: Vec<String>,
    focused_node_id: Option<String>,
) -> Result<String> {
    let mut store = CanvasCameraStore::from(camera);
    store.grid_x = grid_x;
    store.grid_y = grid_y;
    store.selected_node_ids = selected_node_ids;
    store.focused_node_id = focused_node_id;
    Ok(serde_json::to_string(&store)?)
}

pub(crate) fn load_canvas_camera_store(
    db: &rusqlite::Connection,
    canvas_id: &str,
) -> Result<Option<CanvasCameraStore>> {
    let camera_json: Option<String> = db
        .query_row(
            "SELECT camera_json FROM canvases WHERE id = ?1",
            params![canvas_id],
            |row| row.get(0),
        )
        .optional()?;
    camera_json
        .map(|value| parse_canvas_camera_store(&value))
        .transpose()
}

pub(crate) fn update_canvas_grid(
    tx: &rusqlite::Transaction<'_>,
    canvas_id: &str,
    grid_x: i64,
    grid_y: i64,
    timestamp: &str,
) -> Result<()> {
    let camera_json: String = tx.query_row(
        "SELECT camera_json FROM canvases WHERE id = ?1",
        params![canvas_id],
        |row| row.get(0),
    )?;
    let mut store = parse_canvas_camera_store(&camera_json)?;
    store.grid_x = Some(grid_x);
    store.grid_y = Some(grid_y);
    tx.execute(
        "UPDATE canvases SET camera_json = ?1, updated_at = ?2 WHERE id = ?3",
        params![serde_json::to_string(&store)?, timestamp, canvas_id],
    )?;
    Ok(())
}

pub(crate) fn update_canvas_focus_selection(
    tx: &rusqlite::Transaction<'_>,
    canvas_id: &str,
    selected_node_ids: Vec<String>,
    focused_node_id: Option<String>,
    timestamp: &str,
) -> Result<()> {
    let camera_json: String = tx.query_row(
        "SELECT camera_json FROM canvases WHERE id = ?1",
        params![canvas_id],
        |row| row.get(0),
    )?;
    let mut store = parse_canvas_camera_store(&camera_json)?;
    store.selected_node_ids = selected_node_ids;
    store.focused_node_id = focused_node_id;
    tx.execute(
        "UPDATE canvases SET camera_json = ?1, updated_at = ?2 WHERE id = ?3",
        params![serde_json::to_string(&store)?, timestamp, canvas_id],
    )?;
    Ok(())
}

pub(crate) fn next_canvas_sort_index(db: &Connection, project_id: &str) -> Result<i64> {
    Ok(db.query_row(
        "SELECT COALESCE(MAX(sort_index), -1) + 1 FROM canvases WHERE project_id = ?1",
        params![project_id],
        |row| row.get(0),
    )?)
}

fn workspace_letter_for_index(index: usize) -> String {
    let mut remaining = index;
    let mut label = String::new();
    loop {
        label.insert(0, char::from(b'A' + (remaining % 26) as u8));
        if remaining < 26 {
            break;
        }
        remaining = remaining / 26 - 1;
    }
    label
}

fn default_workspace_name_for_index(index: usize) -> String {
    format!("Canvas {}", workspace_letter_for_index(index))
}

pub(crate) fn default_workspace_name_for_project(
    db: &Connection,
    project_id: &str,
) -> Result<String> {
    let mut stmt = db.prepare("SELECT name FROM canvases WHERE project_id = ?1")?;
    let used = stmt
        .query_map(params![project_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<HashSet<_>>>()?;
    for index in used.len().. {
        let candidate = default_workspace_name_for_index(index);
        if !used.contains(&candidate) {
            return Ok(candidate);
        }
    }
    unreachable!("unbounded canvas name search must return");
}

pub(crate) fn load_canvas_node_adapter_id(
    db: &Connection,
    canvas_id: &str,
    node_id: &str,
) -> Result<String> {
    let data_json: String = db.query_row(
        "SELECT data_json FROM nodes WHERE canvas_id = ?1 AND id = ?2",
        params![canvas_id, node_id],
        |row| row.get(0),
    )?;
    let data = serde_json::from_str::<Value>(&data_json).unwrap_or_else(|_| json!({}));
    Ok(data
        .get("adapterId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string())
}

pub(crate) fn load_nodes(db: &Connection, canvas_id: &str) -> Result<Vec<CanvasNodeDto>> {
    let mut stmt = db.prepare(
        "SELECT id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at
         FROM nodes WHERE canvas_id = ?1 ORDER BY z_index ASC",
    )?;
    let rows = stmt.query_map(params![canvas_id], |row| {
        let data_json: String = row.get(9)?;
        let mut data = serde_json::from_str(&data_json).unwrap_or_else(|_| json!({}));
        let layout = take_node_layout_from_data(&mut data);
        Ok(CanvasNodeDto {
            id: row.get(0)?,
            canvas_id: row.get(1)?,
            kind: row.get(2)?,
            title: row.get(3)?,
            x: row.get(4)?,
            y: row.get(5)?,
            width: row.get(6)?,
            height: row.get(7)?,
            z_index: row.get(8)?,
            col_span: layout.col_span,
            row_span: layout.row_span,
            single_pane_width: layout.single_pane_width,
            single_pane_height: layout.single_pane_height,
            data,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn is_legacy_closed_node(node: &CanvasNodeDto) -> bool {
    node.width <= 0.0 || node.height <= 0.0
}

fn load_edges(db: &Connection, canvas_id: &str) -> Result<Vec<CanvasEdgeDto>> {
    let mut stmt = db.prepare(
        "SELECT id, source_node_id, target_node_id, kind, data_json
         FROM edges WHERE canvas_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![canvas_id], |row| {
        let data_json: String = row.get(4)?;
        let data: Value = serde_json::from_str(&data_json).unwrap_or_else(|_| json!({}));
        Ok(CanvasEdgeDto {
            id: row.get(0)?,
            source_node_id: row.get(1)?,
            target_node_id: row.get(2)?,
            kind: row.get(3)?,
            label: data
                .get("label")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}
