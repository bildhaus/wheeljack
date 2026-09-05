//! Portable, checksummed profile directories. Restore is staged while running and
//! applied through SQLite's transactional backup API before any runtime starts.
use super::*;
use rusqlite::OpenFlags;

const MANIFEST: &str = "manifest.json";
const PENDING: &str = "restore-pending";
const RECEIPT: &str = "backup_restore_receipt";

fn copy_synced(source: impl AsRef<Path>, destination: impl AsRef<Path>) -> std::io::Result<u64> {
    let bytes = fs::copy(source, destination.as_ref())?;
    fs::OpenOptions::new()
        .write(true)
        .open(destination)?
        .sync_all()?;
    Ok(bytes)
}

fn write_synced(path: impl AsRef<Path>, data: impl AsRef<[u8]>) -> std::io::Result<()> {
    fs::write(path.as_ref(), data)?;
    fs::OpenOptions::new().write(true).open(path)?.sync_all()
}

fn sync_directory(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    fs::File::open(path)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    version: u8,
    created_at: String,
    database_sha256: String,
    attachments: Vec<BackupAttachment>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupAttachment {
    name: String,
    original_path: String,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupPreview {
    fingerprint: String,
    created_at: String,
    project_count: u64,
    session_count: u64,
    attachment_count: usize,
    total_bytes: u64,
}

fn digest_file(path: &Path) -> Result<(String, u64)> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        bail!("backup entries must be regular files: {}", path.display());
    }
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let bytes = std::io::copy(&mut file, &mut digest)?;
    Ok((format!("{:x}", digest.finalize()), bytes))
}

fn backup_database(path: &Path) -> Result<Connection> {
    for suffix in ["-wal", "-journal"] {
        let sidecar = PathBuf::from(format!("{}{suffix}", path.display()));
        if fs::metadata(sidecar).is_ok_and(|metadata| metadata.len() > 0) {
            bail!("backup database must be standalone; it has an active SQLite sidecar");
        }
    }
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let integrity: String = db.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        bail!("backup database failed its integrity check");
    }
    let version: i32 = db.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if !(1..=LATEST_SCHEMA_VERSION).contains(&version) {
        bail!("backup schema {version} is not supported by this wheeljack version");
    }
    Ok(db)
}

fn verified_manifest(path: &Path) -> Result<(BackupManifest, BackupPreview)> {
    if !path.is_absolute() || !fs::symlink_metadata(path)?.file_type().is_dir() {
        bail!("choose a wheeljack backup directory");
    }
    let manifest_path = path.join(MANIFEST);
    if fs::metadata(&manifest_path)?.len() > 16 * 1024 * 1024 {
        bail!("backup manifest is too large");
    }
    let (fingerprint, mut bytes) = digest_file(&manifest_path)?;
    let manifest: BackupManifest = serde_json::from_slice(&fs::read(&manifest_path)?)?;
    if manifest.version != 1 {
        bail!("unsupported backup format");
    }
    let (hash, size) = digest_file(&path.join(DB_FILE_NAME))?;
    if hash != manifest.database_sha256 {
        bail!("backup database checksum does not match");
    }
    bytes += size;
    let mut names = HashSet::new();
    if !manifest.attachments.is_empty()
        && !fs::symlink_metadata(path.join("attachments"))?
            .file_type()
            .is_dir()
    {
        bail!("backup attachment directory cannot be a link");
    }
    for attachment in &manifest.attachments {
        if attachment.name.is_empty()
            || !attachment
                .name
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-')
            || attachment.name.starts_with('.')
            || !names.insert(&attachment.name)
        {
            bail!("invalid or duplicate backup attachment name");
        }
        let (hash, size) = digest_file(&path.join("attachments").join(&attachment.name))?;
        if hash != attachment.sha256 {
            bail!(
                "backup attachment checksum does not match: {}",
                attachment.name
            );
        }
        bytes += size;
    }
    let db = backup_database(&path.join(DB_FILE_NAME))?;
    let preview = BackupPreview {
        fingerprint,
        created_at: manifest.created_at.clone(),
        project_count: db.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))?,
        session_count: db.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))?,
        attachment_count: manifest.attachments.len(),
        total_bytes: bytes,
    };
    Ok((manifest, preview))
}

pub(crate) fn preview_bundle(path: &Path) -> Result<BackupPreview> {
    verified_manifest(path).map(|(_, preview)| preview)
}

pub(crate) fn restore_status(app_dir: &Path) -> Value {
    json!({ "pending": app_dir.join(PENDING).exists(), "error": fs::read_to_string(app_dir.join("restore-error.txt")).ok() })
}

pub(crate) fn restore_on_startup(app_dir: &Path) {
    if let Err(error) = apply_pending_restore(app_dir) {
        // SQLite backup is atomic. Preserve the staged input for inspection and
        // let the existing profile open instead of trapping the app in a loop.
        let failed = app_dir.join(format!("restore-failed-{}", Uuid::now_v7()));
        let _ = fs::rename(app_dir.join(PENDING), &failed);
        let _ = write_synced(
            app_dir.join("restore-error.txt"),
            format!(
                "Backup restore could not finish: {error:#}. Recovery files: {}",
                failed.display()
            ),
        );
    }
}

pub(crate) fn export_bundle(
    db: &Connection,
    app_dir: &Path,
    destination: &Path,
) -> Result<BackupPreview> {
    if !destination.is_absolute() || destination.exists() {
        bail!("backup destination must be a new absolute directory");
    }
    let parent = destination
        .parent()
        .filter(|path| path.is_dir())
        .ok_or_else(|| anyhow!("backup destination parent does not exist"))?;
    let staging = parent.join(format!(".wheeljack-backup-{}", Uuid::now_v7()));
    fs::create_dir(&staging)?;
    let result = (|| {
        export_database_backup(db, &app_dir.join(DB_FILE_NAME), &staging.join(DB_FILE_NAME))?;
        let snapshot = backup_database(&staging.join(DB_FILE_NAME))?;
        let references = attachment_storage::referenced_attachments(&snapshot, app_dir)?;
        fs::create_dir(staging.join("attachments"))?;
        let mut attachments = Vec::new();
        for original in references {
            let (hash, _) = digest_file(Path::new(&original))?;
            let extension = Path::new(&original)
                .extension()
                .and_then(OsStr::to_str)
                .filter(|value| value.bytes().all(|c| c.is_ascii_alphanumeric()))
                .unwrap_or("bin");
            let name = format!("{hash}.{extension}");
            // Preserve each original path even when two images have equal bytes.
            let name = format!("{}-{name}", attachments.len());
            copy_synced(&original, staging.join("attachments").join(&name))?;
            attachments.push(BackupAttachment {
                name,
                original_path: original,
                sha256: hash,
            });
        }
        attachments.sort_by(|a, b| a.original_path.cmp(&b.original_path));
        let manifest = BackupManifest {
            version: 1,
            created_at: now(),
            database_sha256: digest_file(&staging.join(DB_FILE_NAME))?.0,
            attachments,
        };
        write_synced(
            staging.join(MANIFEST),
            serde_json::to_vec_pretty(&manifest)?,
        )?;
        let preview = preview_bundle(&staging)?;
        drop(snapshot);
        sync_directory(&staging.join("attachments"))?;
        sync_directory(&staging)?;
        if destination.exists() {
            bail!("backup destination already exists");
        }
        fs::rename(&staging, destination)?;
        sync_directory(parent)?;
        Ok(preview)
    })();
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

pub(crate) fn stage_restore(
    path: &Path,
    fingerprint: &str,
    app_dir: &Path,
) -> Result<BackupPreview> {
    let (manifest, preview) = verified_manifest(path)?;
    if preview.fingerprint != fingerprint {
        bail!("backup changed; preview it again before restoring");
    }
    let pending = app_dir.join(PENDING);
    if pending.exists() {
        bail!("a restore is already pending; reopen wheeljack to finish it");
    }
    let staging = app_dir.join(format!(".restore-{}", Uuid::now_v7()));
    fs::create_dir(&staging)?;
    let result = (|| {
        copy_synced(path.join(DB_FILE_NAME), staging.join(DB_FILE_NAME))?;
        copy_synced(path.join(MANIFEST), staging.join(MANIFEST))?;
        fs::create_dir(staging.join("attachments"))?;
        for attachment in manifest.attachments {
            copy_synced(
                path.join("attachments").join(&attachment.name),
                staging.join("attachments").join(&attachment.name),
            )?;
        }
        let copied = preview_bundle(&staging)?;
        if copied.fingerprint != fingerprint {
            bail!("backup changed while staging restore");
        }
        write_synced(staging.join("restore-id"), Uuid::now_v7().to_string())?;
        sync_directory(&staging.join("attachments"))?;
        sync_directory(&staging)?;
        fs::rename(&staging, pending)?;
        sync_directory(app_dir)?;
        let _ = fs::remove_file(app_dir.join("restore-error.txt"));
        Ok(preview)
    })();
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn path_key(value: &str) -> String {
    let value = value.replace('\\', "/");
    let value = value.strip_prefix("//?/").unwrap_or(&value);
    if value.as_bytes().get(1) == Some(&b':') || value.starts_with("//") {
        value.to_ascii_lowercase()
    } else {
        value.to_string()
    }
}

fn remap_value(value: &mut Value, paths: &HashMap<String, String>) {
    match value {
        Value::String(text) => {
            if let Some(replacement) = paths.get(&path_key(text)) {
                *text = replacement.clone();
            }
        }
        Value::Array(values) => {
            for value in values {
                remap_value(value, paths);
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                remap_value(value, paths);
            }
        }
        _ => {}
    }
}

fn remap_document(bytes: &[u8], paths: &HashMap<String, String>) -> Result<Vec<u8>> {
    if let Ok(mut value) = serde_json::from_slice::<Value>(bytes) {
        remap_value(&mut value, paths);
        return Ok(serde_json::to_vec(&value)?);
    }
    let mut result = Vec::new();
    for line in bytes.split_inclusive(|byte| *byte == b'\n') {
        if let Ok(mut value) = serde_json::from_slice::<Value>(line) {
            remap_value(&mut value, paths);
            result.extend(serde_json::to_vec(&value)?);
            if line.ends_with(b"\n") {
                result.push(b'\n');
            }
        } else {
            result.extend(line);
        }
    }
    Ok(result)
}

pub(crate) fn apply_pending_restore(app_dir: &Path) -> Result<()> {
    let pending = app_dir.join(PENDING);
    if !pending.exists() {
        return Ok(());
    }
    let restore_id = fs::read_to_string(pending.join("restore-id"))?;
    Uuid::parse_str(&restore_id)?;
    let live_path = app_dir.join(DB_FILE_NAME);
    if live_path.exists() {
        let live = Connection::open_with_flags(&live_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let receipt: Option<String> = live
            .query_row(
                "SELECT value_json FROM settings WHERE key = ?1",
                [RECEIPT],
                |r| r.get(0),
            )
            .optional()?;
        if receipt.as_deref() == Some(&serde_json::to_string(&restore_id)?) {
            let _ = fs::remove_dir_all(&pending);
            return Ok(());
        }
    }
    let (manifest, _) = verified_manifest(&pending)?;
    // Work on a separate database: the staged, verified source stays reusable if
    // power is lost before SQLite commits the replacement.
    let working = pending.join(format!("restore-{}.sqlite3", Uuid::now_v7()));
    copy_synced(pending.join(DB_FILE_NAME), &working)?;
    let snapshot = Connection::open(&working)?;
    run_migrations(&snapshot)?;
    let attachment_dir = app_dir.join("attachments");
    fs::create_dir_all(&attachment_dir)?;
    let mut paths = HashMap::new();
    for attachment in manifest.attachments {
        let destination =
            attachment_dir.join(format!("restored-{}-{}", restore_id, attachment.name));
        if destination.exists() {
            if digest_file(&destination)?.0 != attachment.sha256 {
                bail!("restored attachment collision");
            }
        } else {
            copy_synced(
                pending.join("attachments").join(&attachment.name),
                &destination,
            )?;
        }
        paths.insert(
            path_key(&attachment.original_path),
            destination.to_string_lossy().into_owned(),
        );
    }
    sync_directory(&attachment_dir)?;
    let tx = snapshot.unchecked_transaction()?;
    for (table, column) in [
        ("nodes", "data_json"),
        ("session_prompt_deliveries", "payload_json"),
    ] {
        let mut stmt = tx.prepare(&format!(
            "SELECT id, {column} FROM {table} WHERE {column} IS NOT NULL"
        ))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        for (id, json) in rows {
            let remapped = String::from_utf8(remap_document(json.as_bytes(), &paths)?)?;
            tx.execute(
                &format!("UPDATE {table} SET {column} = ?2 WHERE id = ?1"),
                params![id, remapped],
            )?;
            if table == "session_prompt_deliveries" {
                let payload: PromptDeliveryPayload = serde_json::from_str(&remapped)?;
                tx.execute(
                    "UPDATE session_prompt_deliveries SET payload_fingerprint = ?2 WHERE id = ?1",
                    params![id, prompt_delivery_payload_fingerprint(&payload)?],
                )?;
            }
        }
    }
    let mut stmt =
        tx.prepare("SELECT id, data FROM session_chunks WHERE stream = 'agent-input'")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);
    for (id, bytes) in rows {
        let data = remap_document(&bytes, &paths)?;
        tx.execute(
            "UPDATE session_chunks SET data = ?2 WHERE id = ?1",
            params![id, data],
        )?;
        tx.execute(
            "UPDATE session_chunks_fts SET data = ?2 WHERE rowid = ?1",
            params![id, String::from_utf8_lossy(&data)],
        )?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)",
        params![RECEIPT, serde_json::to_string(&restore_id)?, now()],
    )?;
    tx.commit()?;
    if live_path.exists() {
        let recovery = app_dir.join(format!("wheeljack-pre-restore-{restore_id}"));
        if !recovery.exists() {
            let live = Connection::open(&live_path)?;
            export_bundle(&live, app_dir, &recovery)?;
        }
    }
    let mut live = Connection::open(&live_path)?;
    live.busy_timeout(Duration::from_secs(5))?;
    let backup = rusqlite::backup::Backup::new(&snapshot, &mut live)?;
    backup.run_to_completion(64, Duration::from_millis(10), None)?;
    drop(backup);
    drop(snapshot);
    drop(live);
    // The replacement has committed. Cleanup failure must never be described
    // as a failed restore or cause the snapshot to be replayed over later work.
    let _ = fs::remove_dir_all(&pending);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (PathBuf, Connection, PathBuf) {
        let root = env::temp_dir().join(format!("wheeljack-backup-test-{}", Uuid::now_v7()));
        let source = root.join("source");
        fs::create_dir_all(source.join("attachments")).unwrap();
        let image = source.join("attachments/draft.png");
        write_synced(&image, b"image fixture").unwrap();
        let db = open_app_connection(&source.join(DB_FILE_NAME)).unwrap();
        run_migrations(&db).unwrap();
        db.execute_batch("INSERT INTO projects (id,path,name,created_at,updated_at) VALUES ('p','/project','Original','now','now');
            INSERT INTO canvases (id,project_id,name,camera_json,created_at,updated_at) VALUES ('c','p','Work','{}','now','now');
            INSERT INTO sessions (id,node_id,adapter_id,command_json,cwd,status,created_at,updated_at) VALUES ('s','n','test','[]','/project/worktree','completed','now','now');").unwrap();
        let draft = json!({"chatComposition":{"draft":"keep my draft", "attachments":[{"path":image,"mimeType":"image/png"}]}});
        db.execute("INSERT INTO nodes (id,canvas_id,kind,title,x,y,width,height,z_index,data_json,created_at,updated_at) VALUES ('n','c','agent_terminal','Agent',0,0,1,1,0,?1,'now','now')", [draft.to_string()]).unwrap();
        db.execute("INSERT INTO session_chunks (session_id,seq,stream,data,created_at) VALUES ('s',1,'agent-input',?1,'now')", [json!({"images":[{"path":image}], "text":"hello"}).to_string().into_bytes()]).unwrap();
        (root, db, image)
    }

    #[test]
    fn portable_backup_preserves_reference_spelling_without_original_files() {
        let (root, db, image) = fixture();
        let alias = root.join("source/attachments/../attachments/draft.png");
        let dot_alias = format!("{}/./draft.png", image.parent().unwrap().display());
        let document = json!({"chatComposition":{"draft":"alias draft", "attachments":[{"path":alias,"mimeType":"image/png"},{"path":dot_alias},{"path":image}]}});
        db.execute(
            "UPDATE nodes SET data_json=?1 WHERE id='n'",
            [document.to_string()],
        )
        .unwrap();
        db.execute(
            "UPDATE session_chunks SET data=?1 WHERE session_id='s'",
            [json!({"images":[{"path":alias}],"text":"alias history"})
                .to_string()
                .into_bytes()],
        )
        .unwrap();
        let storage = gc_image_attachments(&db, &root.join("source")).unwrap();
        assert_eq!(storage.removed_count, 0);
        assert_eq!(storage.referenced_count, 1);
        let bundle = root.join("backup");
        let preview = export_bundle(&db, &root.join("source"), &bundle).unwrap();
        let manifest: BackupManifest =
            serde_json::from_slice(&fs::read(bundle.join(MANIFEST)).unwrap()).unwrap();
        let spellings: HashSet<_> = manifest
            .attachments
            .iter()
            .map(|item| item.original_path.as_str())
            .collect();
        assert_eq!(spellings.len(), 3);
        assert!(spellings.contains(alias.to_str().unwrap()));
        assert!(spellings.contains(dot_alias.as_str()));
        assert!(spellings.contains(image.to_str().unwrap()));
        fs::remove_file(&image).unwrap();
        let target = root.join("target");
        fs::create_dir(&target).unwrap();
        stage_restore(&bundle, &preview.fingerprint, &target).unwrap();
        apply_pending_restore(&target).unwrap();
        let restored = Connection::open(target.join(DB_FILE_NAME)).unwrap();
        let document: String = restored
            .query_row("SELECT data_json FROM nodes WHERE id='n'", [], |row| {
                row.get(0)
            })
            .unwrap();
        let value: Value = serde_json::from_str(&document).unwrap();
        let path = Path::new(
            value["chatComposition"]["attachments"][0]["path"]
                .as_str()
                .unwrap(),
        );
        assert!(path.starts_with(target.join("attachments")));
        assert_eq!(fs::read(path).unwrap(), b"image fixture");
        for attachment in value["chatComposition"]["attachments"].as_array().unwrap() {
            let restored_path = Path::new(attachment["path"].as_str().unwrap());
            assert!(restored_path.starts_with(target.join("attachments")));
            assert_eq!(fs::read(restored_path).unwrap(), b"image fixture");
        }
        let chunks = load_session_chunks(&restored, "s").unwrap();
        let history: Value = serde_json::from_slice(&chunks[0]).unwrap();
        assert_eq!(
            history["images"][0]["path"],
            value["chatComposition"]["attachments"][0]["path"]
        );
        drop(restored);
        drop(db);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn portable_backup_restores_draft_image_and_preserves_previous_database() {
        let (root, db, image) = fixture();
        let bundle = root.join("backup");
        let preview = export_bundle(&db, &root.join("source"), &bundle).unwrap();
        assert_eq!(preview.project_count, 1);
        assert_eq!(preview.attachment_count, 1);
        assert_eq!(
            load_session_history(&db, 10).unwrap()[0]
                .project_id
                .as_deref(),
            Some("p")
        );
        let target = root.join("target");
        fs::create_dir(&target).unwrap();
        let previous = open_app_connection(&target.join(DB_FILE_NAME)).unwrap();
        run_migrations(&previous).unwrap();
        previous
            .execute(
                "INSERT INTO settings (key,value_json,updated_at) VALUES ('previous','true','now')",
                [],
            )
            .unwrap();
        drop(previous);
        stage_restore(&bundle, &preview.fingerprint, &target).unwrap();
        let restore_id = fs::read_to_string(target.join(PENDING).join("restore-id")).unwrap();
        apply_pending_restore(&target).unwrap();
        let restored = open_app_connection(&target.join(DB_FILE_NAME)).unwrap();
        let text: String = restored
            .query_row("SELECT data_json FROM nodes WHERE id='n'", [], |r| r.get(0))
            .unwrap();
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["chatComposition"]["draft"], "keep my draft");
        let restored_path = PathBuf::from(
            value["chatComposition"]["attachments"][0]["path"]
                .as_str()
                .unwrap(),
        );
        assert!(restored_path.starts_with(target.join("attachments")));
        assert_eq!(fs::read(&restored_path).unwrap(), fs::read(&image).unwrap());
        assert!(
            String::from_utf8(load_session_chunks(&restored, "s").unwrap().remove(0))
                .unwrap()
                .contains(&restored_path.to_string_lossy().replace('\\', "\\\\"))
        );
        let old = Connection::open(
            target
                .join(format!("wheeljack-pre-restore-{restore_id}"))
                .join(DB_FILE_NAME),
        )
        .unwrap();
        assert_eq!(
            old.query_row(
                "SELECT value_json FROM settings WHERE key='previous'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "true"
        );
        // A crash after SQLite commit but before cleanup must not replay restore.
        restored
            .execute("UPDATE projects SET name='After restore'", [])
            .unwrap();
        fs::create_dir(target.join(PENDING)).unwrap();
        write_synced(target.join(PENDING).join("restore-id"), restore_id).unwrap();
        drop(restored);
        apply_pending_restore(&target).unwrap();
        let restored = Connection::open(target.join(DB_FILE_NAME)).unwrap();
        assert_eq!(
            restored
                .query_row("SELECT name FROM projects", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "After restore"
        );
        drop(restored);
        drop(old);
        drop(db);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn portable_backup_rejects_corruption_and_stale_preview_without_touching_live_data() {
        let (root, db, _) = fixture();
        let bundle = root.join("backup");
        let preview = export_bundle(&db, &root.join("source"), &bundle).unwrap();
        assert!(export_bundle(&db, &root.join("source"), &bundle).is_err());
        assert!(stage_restore(&bundle, "stale", &root.join("source")).is_err());
        let mut manifest: BackupManifest =
            serde_json::from_slice(&fs::read(bundle.join(MANIFEST)).unwrap()).unwrap();
        write_synced(
            bundle
                .join("attachments")
                .join(&manifest.attachments[0].name),
            b"corrupt",
        )
        .unwrap();
        assert!(preview_bundle(&bundle).is_err());
        assert!(stage_restore(&bundle, &preview.fingerprint, &root.join("source")).is_err());
        manifest.attachments[0].name = "../outside.png".into();
        write_synced(
            bundle.join(MANIFEST),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        assert!(preview_bundle(&bundle)
            .unwrap_err()
            .to_string()
            .contains("invalid or duplicate"));
        assert!(!root.join("source").join(PENDING).exists());
        assert_eq!(
            db.query_row("SELECT name FROM projects", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "Original"
        );
        fs::create_dir(root.join("source").join(PENDING)).unwrap();
        restore_on_startup(&root.join("source"));
        assert_eq!(restore_status(&root.join("source"))["pending"], false);
        assert!(restore_status(&root.join("source"))["error"]
            .as_str()
            .unwrap()
            .contains("could not finish"));
        assert_eq!(
            db.query_row("SELECT name FROM projects", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "Original"
        );
        drop(db);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn portable_backup_rejects_unhashed_wal_and_relocates_queued_attachment_fingerprints() {
        let (root, db, image) = fixture();
        let payload: PromptDeliveryPayload = serde_json::from_value(json!({
            "prompt": "inspect", "historyText": "inspect", "imagePaths": [image],
        }))
        .unwrap();
        let request = SubmitPromptDeliveryRequest {
            client_prompt_id: Uuid::now_v7().to_string(),
            session_id: "s".into(),
            mode: "auto".into(),
            payload,
        };
        submit_prompt_delivery(&db, &request).unwrap();
        let bundle = root.join("backup");
        let preview = export_bundle(&db, &root.join("source"), &bundle).unwrap();
        let bundle_db = open_app_connection(&bundle.join(DB_FILE_NAME)).unwrap();
        bundle_db.execute_batch("PRAGMA wal_autocheckpoint=0; INSERT INTO projects (id,path,name,created_at,updated_at) VALUES ('extra','/extra','Only in WAL','now','now');").unwrap();
        assert!(preview_bundle(&bundle)
            .unwrap_err()
            .to_string()
            .contains("standalone"));
        drop(bundle_db);
        // Export a clean snapshot again; the altered bundle is deliberately kept.
        let clean = root.join("clean");
        let clean_preview = export_bundle(&db, &root.join("source"), &clean).unwrap();
        assert_ne!(preview.fingerprint, "");
        let target = root.join("restored");
        fs::create_dir(&target).unwrap();
        stage_restore(&clean, &clean_preview.fingerprint, &target).unwrap();
        apply_pending_restore(&target).unwrap();
        let restored = open_app_connection(&target.join(DB_FILE_NAME)).unwrap();
        let delivery = load_prompt_delivery(&restored, &request.client_prompt_id)
            .unwrap()
            .unwrap();
        let relocated = delivery.payload.unwrap();
        assert!(Path::new(&relocated.image_paths[0]).starts_with(target.join("attachments")));
        let replay = SubmitPromptDeliveryRequest {
            payload: relocated,
            ..request
        };
        assert_eq!(
            submit_prompt_delivery(&restored, &replay).unwrap().id,
            replay.client_prompt_id
        );
        drop(restored);
        drop(db);
        fs::remove_dir_all(root).unwrap();
    }
}
