use anyhow::{Context, Result};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AttachmentStorageStatus {
    pub(crate) file_count: usize,
    pub(crate) total_bytes: u64,
    pub(crate) referenced_count: usize,
    pub(crate) unreferenced_count: usize,
    pub(crate) removed_count: usize,
    pub(crate) removed_bytes: u64,
}

fn normalized_existing_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn collect_json_paths(value: &Value, attachment_dir: &Path, references: &mut HashSet<String>) {
    match value {
        Value::String(value) => {
            let path = PathBuf::from(value);
            if path.is_file() {
                let canonical = normalized_existing_path(&path);
                if canonical.parent() == Some(attachment_dir) {
                    // Backups must preserve the spelling stored in the document,
                    // including aliases such as macOS /var -> /private/var.
                    references.insert(value.clone());
                }
            }
        }
        Value::Array(values) => {
            for value in values {
                collect_json_paths(value, attachment_dir, references);
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                collect_json_paths(value, attachment_dir, references);
            }
        }
        _ => {}
    }
}

fn collect_json_document(document: &[u8], attachment_dir: &Path, references: &mut HashSet<String>) {
    if let Ok(value) = serde_json::from_slice::<Value>(document) {
        collect_json_paths(&value, attachment_dir, references);
        return;
    }

    for line in document.split(|byte| *byte == b'\n') {
        if let Ok(value) = serde_json::from_slice::<Value>(line) {
            collect_json_paths(&value, attachment_dir, references);
        }
    }
}

pub(crate) fn referenced_attachments(
    db: &Connection,
    app_data_dir: &Path,
) -> Result<HashSet<String>> {
    let attachment_dir = normalized_existing_path(&app_data_dir.join("attachments"));
    let mut references = HashSet::new();

    let mut nodes = db.prepare("SELECT data_json FROM nodes")?;
    for document in nodes.query_map([], |row| row.get::<_, String>(0))? {
        collect_json_document(document?.as_bytes(), &attachment_dir, &mut references);
    }

    let mut deliveries = db.prepare(
        "SELECT payload_json FROM session_prompt_deliveries
         WHERE payload_json IS NOT NULL
           AND state IN ('queued', 'dispatching', 'failed', 'indeterminate', 'blocked')",
    )?;
    for document in deliveries.query_map([], |row| row.get::<_, String>(0))? {
        collect_json_document(document?.as_bytes(), &attachment_dir, &mut references);
    }

    let mut chunks = db.prepare("SELECT data FROM session_chunks WHERE stream = 'agent-input'")?;
    for document in chunks.query_map([], |row| row.get::<_, Vec<u8>>(0))? {
        collect_json_document(&document?, &attachment_dir, &mut references);
    }

    Ok(references)
}

pub(crate) fn image_attachment_storage_status(
    db: &Connection,
    app_data_dir: &Path,
) -> Result<AttachmentStorageStatus> {
    attachment_storage_status(db, app_data_dir, false)
}

pub(crate) fn gc_image_attachments(
    db: &Connection,
    app_data_dir: &Path,
) -> Result<AttachmentStorageStatus> {
    attachment_storage_status(db, app_data_dir, true)
}

fn attachment_storage_status(
    db: &Connection,
    app_data_dir: &Path,
    remove_unreferenced: bool,
) -> Result<AttachmentStorageStatus> {
    let attachment_dir = app_data_dir.join("attachments");
    if !attachment_dir.exists() {
        return Ok(AttachmentStorageStatus::default());
    }
    let attachment_dir = normalized_existing_path(&attachment_dir);
    let references = referenced_attachments(db, app_data_dir)?
        .into_iter()
        .map(|path| normalized_existing_path(Path::new(&path)))
        .collect::<HashSet<_>>();
    let mut status = AttachmentStorageStatus::default();

    for entry in fs::read_dir(&attachment_dir).context("read image attachment directory")? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if !file_type.is_file() {
            continue;
        }
        let path = normalized_existing_path(&entry.path());
        let bytes = entry.metadata()?.len();
        status.file_count += 1;
        status.total_bytes += bytes;
        if references.contains(&path) {
            status.referenced_count += 1;
        } else {
            status.unreferenced_count += 1;
            if remove_unreferenced {
                fs::remove_file(&path).with_context(|| {
                    format!("remove unreferenced image attachment {}", path.display())
                })?;
                status.removed_count += 1;
                status.removed_bytes += bytes;
            }
        }
    }

    if remove_unreferenced {
        status.file_count -= status.removed_count;
        status.total_bytes -= status.removed_bytes;
        status.unreferenced_count = 0;
    }
    Ok(status)
}
