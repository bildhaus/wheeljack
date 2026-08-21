use super::*;

const MAX_PROJECT_DOCUMENT_BYTES: u64 = 1024 * 1024;
const MISSING_REVISION: &str = "missing";
const DOCUMENTS: [(&str, &str); 3] = [
    ("kanban", "KANBAN.md"),
    ("prd", "PRD.md"),
    ("tdd", "TDD.md"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ColumnMetadata {
    id: String,
    role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskMetadata {
    id: String,
    priority: String,
    assignee: String,
    #[serde(default)]
    definition_of_done: String,
    #[serde(default)]
    constraints: String,
    #[serde(default)]
    verification_command: String,
    #[serde(default = "default_task_review_policy")]
    review_policy: String,
}

fn default_task_review_policy() -> String {
    "agent".to_string()
}

pub(crate) struct DocumentApproval {
    pub(crate) fingerprint: String,
    pub(crate) expires_at: Instant,
}

pub(crate) fn read_project_documents(project_path: &str) -> Result<ProjectDocumentsDto> {
    let root = resolve_workspace_folder_path(project_path)?;
    let tracked = project_documents_git_state(&root, false)?;
    let documents = DOCUMENTS
        .into_iter()
        .map(|(kind, name)| {
            let mut document = read_project_document(&root, kind, name)?;
            if tracked.contains(name) {
                document.warnings.push(format!(
                    "{name} is tracked by Git. Git tracking will be preserved while the file remains editable."
                ));
            }
            Ok((kind.to_string(), document))
        })
        .collect::<Result<BTreeMap<_, _>>>()?;
    Ok(ProjectDocumentsDto {
        project_path: root.to_string_lossy().to_string(),
        documents,
    })
}

pub(crate) fn preview_project_document_writes(
    request: &ProjectDocumentsWriteRequest,
) -> Result<(Vec<ProjectDocumentWriteDto>, String)> {
    let root = resolve_workspace_folder_path(&request.project_path)?;
    if request.writes.is_empty() || request.writes.len() > DOCUMENTS.len() {
        bail!("one to three project document writes are required");
    }
    let mut seen = HashSet::new();
    let mut normalized = Vec::with_capacity(request.writes.len());
    let mut diff = String::new();
    for write in &request.writes {
        let (kind, name) = document_spec(&write.kind)?;
        if !seen.insert(kind) {
            bail!("duplicate project document write: {kind}");
        }
        if write.content.len() as u64 > MAX_PROJECT_DOCUMENT_BYTES {
            bail!("{name} exceeds the 1 MiB limit");
        }
        let current = read_project_document(&root, kind, name)?;
        if current.revision != write.expected_revision {
            bail!("{name} changed on disk; reload it before saving");
        }
        let content = if kind == "kanban" {
            render_kanban(&parse_kanban(&write.content))
        } else {
            write.content.clone()
        };
        if content.len() as u64 > MAX_PROJECT_DOCUMENT_BYTES {
            bail!("{name} exceeds the 1 MiB limit");
        }
        diff.push_str(&replacement_diff(name, &current.content, &content));
        normalized.push(ProjectDocumentWriteDto {
            kind: kind.to_string(),
            content,
            expected_revision: write.expected_revision.clone(),
        });
    }
    Ok((normalized, diff))
}

pub(crate) fn project_document_write_fingerprint(
    project_path: &str,
    writes: &[ProjectDocumentWriteDto],
) -> Result<String> {
    let root = resolve_workspace_folder_path(project_path)?;
    let mut hasher = Sha256::new();
    hasher.update(root.to_string_lossy().as_bytes());
    for write in writes {
        hasher.update([0]);
        hasher.update(write.kind.as_bytes());
        hasher.update([0]);
        hasher.update(write.expected_revision.as_bytes());
        hasher.update([0]);
        hasher.update(write.content.as_bytes());
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub(crate) fn commit_project_document_writes(
    request: &ProjectDocumentsWriteRequest,
) -> Result<ProjectDocumentsDto> {
    let root = resolve_workspace_folder_path(&request.project_path)?;
    project_documents_git_state(&root, true)?;
    let (writes, _) = preview_project_document_writes(request)?;
    let suffix = Uuid::now_v7().to_string();
    let mut staged = Vec::with_capacity(writes.len());
    for write in &writes {
        let (_, name) = document_spec(&write.kind)?;
        refuse_case_variant(&root, name)?;
        let path = root.join(name);
        validate_document_target(&root, &path)?;
        let temp = root.join(format!(".{name}.{suffix}.tmp"));
        fs::write(&temp, write.content.as_bytes())?;
        staged.push((path, temp, root.join(format!(".{name}.{suffix}.bak"))));
    }

    let mut promoted = Vec::new();
    for (path, temp, backup) in &staged {
        if path.exists() {
            if let Err(error) = fs::rename(path, backup) {
                rollback_document_writes(&promoted, &staged);
                return Err(error.into());
            }
        }
        if let Err(error) = fs::rename(temp, path) {
            let _ = fs::rename(backup, path);
            rollback_document_writes(&promoted, &staged);
            return Err(error.into());
        }
        promoted.push((path.clone(), backup.clone()));
    }
    for (_, backup) in promoted {
        let _ = fs::remove_file(backup);
    }
    read_project_documents(&request.project_path)
}

fn project_documents_git_state(root: &Path, protect: bool) -> Result<HashSet<String>> {
    let Ok(prefix_output) = git_command()
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--show-prefix"])
        .output()
    else {
        return Ok(HashSet::new());
    };
    if !prefix_output.status.success() {
        return Ok(HashSet::new());
    }
    let prefix = String::from_utf8_lossy(&prefix_output.stdout)
        .trim_end_matches(['\r', '\n'])
        .to_string();
    let paths = DOCUMENTS.map(|(_, name)| (name, format!("{prefix}{name}")));

    if protect {
        let exclude_output = git_command()
            .arg("-C")
            .arg(root)
            .args(["rev-parse", "--git-path", "info/exclude"])
            .output()?;
        if !exclude_output.status.success() {
            bail!("could not resolve the repository's local Git exclude file");
        }
        let raw_exclude_path = String::from_utf8_lossy(&exclude_output.stdout)
            .trim_end_matches(['\r', '\n'])
            .to_string();
        if raw_exclude_path.is_empty() {
            bail!("Git returned an empty local exclude path");
        }
        let raw_exclude_path = PathBuf::from(raw_exclude_path);
        let exclude_path = if raw_exclude_path.is_absolute() {
            raw_exclude_path
        } else {
            root.join(raw_exclude_path)
        };
        if let Some(parent) = exclude_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut exclude = match fs::read_to_string(&exclude_path) {
            Ok(exclude) => exclude,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(error.into()),
        };
        let mut changed = false;
        for (_, path) in &paths {
            let pattern = format!(
                "/{}",
                path.replace('\\', "\\\\")
                    .replace('[', "\\[")
                    .replace('*', "\\*")
                    .replace('?', "\\?")
            );
            if exclude.lines().any(|line| line == pattern) {
                continue;
            }
            if !exclude.is_empty() && !exclude.ends_with('\n') {
                exclude.push('\n');
            }
            exclude.push_str(&pattern);
            exclude.push('\n');
            changed = true;
        }
        if changed {
            fs::write(exclude_path, exclude)?;
        }
    }

    let tracked_output = git_command()
        .arg("-C")
        .arg(root)
        .arg("ls-files")
        .arg("--full-name")
        .arg("--")
        .args(DOCUMENTS.map(|(_, name)| name))
        .output()?;
    if !tracked_output.status.success() {
        bail!("could not inspect tracked wheeljack project documents");
    }
    let tracked_paths = String::from_utf8_lossy(&tracked_output.stdout)
        .lines()
        .map(str::to_string)
        .collect::<HashSet<_>>();
    Ok(paths
        .into_iter()
        .filter_map(|(name, path)| tracked_paths.contains(&path).then(|| name.to_string()))
        .collect())
}

fn rollback_document_writes(
    promoted: &[(PathBuf, PathBuf)],
    staged: &[(PathBuf, PathBuf, PathBuf)],
) {
    for (path, backup) in promoted.iter().rev() {
        let _ = fs::remove_file(path);
        let _ = fs::rename(backup, path);
    }
    for (_, temp, _) in staged {
        let _ = fs::remove_file(temp);
    }
}

pub(crate) fn parse_kanban(content: &str) -> KanbanBoardDto {
    let lines = content.lines().collect::<Vec<_>>();
    let mut columns = Vec::new();
    let mut cards = Vec::new();
    let mut column_index = 0usize;
    let mut card_index = 0usize;
    let mut index = 0usize;

    while index < lines.len() {
        let Some(title) = lines[index].strip_prefix("## ").map(str::trim) else {
            index += 1;
            continue;
        };
        column_index += 1;
        let metadata = lines
            .get(index + 1)
            .and_then(|line| parse_metadata::<ColumnMetadata>(line, "column"));
        if metadata.is_some() {
            index += 1;
        }
        let column_id = metadata
            .as_ref()
            .map(|value| value.id.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| stable_id("column", title, column_index));
        let role = metadata
            .as_ref()
            .map(|value| value.role.clone())
            .filter(|value| is_column_role(value))
            .unwrap_or_else(|| infer_column_role(title).to_string());
        columns.push(KanbanColumnDto {
            id: column_id.clone(),
            title: title.to_string(),
            role,
        });
        index += 1;

        while index < lines.len() && !lines[index].starts_with("## ") {
            let Some(task) = task_title(lines[index]) else {
                index += 1;
                continue;
            };
            card_index += 1;
            let metadata = lines
                .get(index + 1)
                .and_then(|line| parse_metadata::<TaskMetadata>(line, "task"));
            if metadata.is_some() {
                index += 1;
            }
            let mut detail = Vec::new();
            index += 1;
            while index < lines.len()
                && !lines[index].starts_with("## ")
                && task_title(lines[index]).is_none()
            {
                if !lines[index].trim().is_empty() {
                    detail.push(
                        lines[index]
                            .strip_prefix("  ")
                            .unwrap_or(lines[index])
                            .to_string(),
                    );
                }
                index += 1;
            }
            cards.push(KanbanCardDto {
                id: metadata
                    .as_ref()
                    .map(|value| value.id.clone())
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| {
                        stable_id("task", &format!("{column_id}\0{task}"), card_index)
                    }),
                column_id: column_id.clone(),
                title: task.to_string(),
                detail: detail.join("\n"),
                assignee: metadata
                    .as_ref()
                    .map(|value| value.assignee.clone())
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "Unassigned".to_string()),
                priority: metadata
                    .as_ref()
                    .map(|value| value.priority.clone())
                    .filter(|value| matches!(value.as_str(), "low" | "normal" | "high"))
                    .unwrap_or_else(|| "normal".to_string()),
                definition_of_done: metadata
                    .as_ref()
                    .map(|value| value.definition_of_done.clone())
                    .unwrap_or_default(),
                constraints: metadata
                    .as_ref()
                    .map(|value| value.constraints.clone())
                    .unwrap_or_default(),
                verification_command: metadata
                    .as_ref()
                    .map(|value| value.verification_command.clone())
                    .unwrap_or_default(),
                review_policy: metadata
                    .as_ref()
                    .map(|value| value.review_policy.clone())
                    .filter(|value| matches!(value.as_str(), "human" | "agent" | "either"))
                    .unwrap_or_else(default_task_review_policy),
            });
        }
    }

    if columns.is_empty() {
        columns = default_kanban_columns();
    }
    KanbanBoardDto {
        version: 1,
        columns,
        cards,
    }
}

pub(crate) fn render_kanban(board: &KanbanBoardDto) -> String {
    let mut output = String::from("---\nwheeljack-kanban: 1\n---\n\n# Kanban\n");
    for column in &board.columns {
        let metadata = serde_json::to_string(&ColumnMetadata {
            id: column.id.clone(),
            role: column.role.clone(),
        })
        .unwrap_or_default();
        output.push_str(&format!(
            "\n## {}\n<!-- wheeljack:column {metadata} -->\n",
            column.title.trim()
        ));
        for card in board
            .cards
            .iter()
            .filter(|card| card.column_id == column.id)
        {
            let checked = if column.role == "done" { "x" } else { " " };
            let metadata = serde_json::to_string(&TaskMetadata {
                id: card.id.clone(),
                priority: card.priority.clone(),
                assignee: card.assignee.clone(),
                definition_of_done: card.definition_of_done.clone(),
                constraints: card.constraints.clone(),
                verification_command: card.verification_command.clone(),
                review_policy: card.review_policy.clone(),
            })
            .unwrap_or_default();
            output.push_str(&format!(
                "\n- [{checked}] {}\n  <!-- wheeljack:task {metadata} -->\n",
                card.title.trim()
            ));
            for line in card.detail.lines() {
                output.push_str(&format!("  {}\n", line.trim_end()));
            }
        }
    }
    output
}

fn read_project_document(root: &Path, kind: &str, name: &str) -> Result<ProjectDocumentDto> {
    let variant = case_variant(root, name)?;
    let path = root.join(name);
    let mut warnings = Vec::new();
    if let Some(variant) = variant {
        warnings.push(format!(
            "{} has the wrong filename case; rename it to {name}",
            variant.display()
        ));
    }
    if !path.exists() || !warnings.is_empty() {
        return Ok(ProjectDocumentDto {
            kind: kind.to_string(),
            path: path.to_string_lossy().to_string(),
            exists: false,
            content: String::new(),
            revision: MISSING_REVISION.to_string(),
            format: "missing".to_string(),
            warnings,
            board: (kind == "kanban").then(|| KanbanBoardDto {
                version: 1,
                columns: default_kanban_columns(),
                cards: Vec::new(),
            }),
        });
    }
    validate_document_target(root, &path)?;
    let metadata = fs::metadata(&path)?;
    if metadata.len() > MAX_PROJECT_DOCUMENT_BYTES {
        bail!("{name} exceeds the 1 MiB limit");
    }
    let bytes = fs::read(&path)?;
    let content = String::from_utf8(bytes.clone()).map_err(|_| anyhow!("{name} is not UTF-8"))?;
    let revision = sha256(&bytes);
    let board = (kind == "kanban").then(|| parse_kanban(&content));
    let format = if let Some(board) = &board {
        if content == render_kanban(board) {
            "wheeljack-v1"
        } else {
            "importable"
        }
    } else {
        "markdown"
    };
    Ok(ProjectDocumentDto {
        kind: kind.to_string(),
        path: path.to_string_lossy().to_string(),
        exists: true,
        content,
        revision,
        format: format.to_string(),
        warnings,
        board,
    })
}

fn document_spec(kind: &str) -> Result<(&'static str, &'static str)> {
    DOCUMENTS
        .into_iter()
        .find(|(candidate, _)| *candidate == kind)
        .ok_or_else(|| anyhow!("unsupported project document kind: {kind}"))
}

fn validate_document_target(root: &Path, path: &Path) -> Result<()> {
    if path.exists() {
        let target = normalize_command_cwd(path.canonicalize()?);
        if target.parent() != Some(root) {
            bail!("project document resolves outside the project root");
        }
        if !target.is_file() {
            bail!("project document path is not a file");
        }
    }
    Ok(())
}

fn case_variant(root: &Path, name: &str) -> Result<Option<PathBuf>> {
    Ok(fs::read_dir(root)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .find(|path| {
            path.file_name()
                .and_then(OsStr::to_str)
                .is_some_and(|candidate| candidate != name && candidate.eq_ignore_ascii_case(name))
        }))
}

fn refuse_case_variant(root: &Path, name: &str) -> Result<()> {
    if let Some(path) = case_variant(root, name)? {
        bail!(
            "{} has the wrong filename case; rename it to {name}",
            path.display()
        );
    }
    Ok(())
}

fn parse_metadata<T: for<'de> Deserialize<'de>>(line: &str, kind: &str) -> Option<T> {
    let prefix = format!("<!-- wheeljack:{kind} ");
    let trimmed = line.trim();
    let json = trimmed.strip_prefix(&prefix)?.strip_suffix(" -->")?;
    serde_json::from_str(json).ok()
}

fn task_title(line: &str) -> Option<&str> {
    line.strip_prefix("- [ ] ")
        .or_else(|| line.strip_prefix("- [x] "))
        .or_else(|| line.strip_prefix("- [X] "))
        .or_else(|| line.strip_prefix("- "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn infer_column_role(title: &str) -> &'static str {
    // ponytail: heading keywords cover imports; normalization stores the chosen role afterward.
    let normalized = title.to_ascii_lowercase();
    if [
        "done",
        "complete",
        "completed",
        "finished",
        "shipped",
        "closed",
    ]
    .iter()
    .any(|word| normalized.contains(word))
    {
        "done"
    } else if normalized == "qa"
        || ["review", "blocker", "blocked", "verify", "verification"]
            .iter()
            .any(|word| normalized.contains(word))
    {
        "review"
    } else if [
        "in progress",
        "active",
        "doing",
        "building",
        "working",
        "in flight",
    ]
    .iter()
    .any(|word| normalized.contains(word))
    {
        "active"
    } else {
        "queued"
    }
}

fn is_column_role(value: &str) -> bool {
    matches!(value, "queued" | "active" | "review" | "done")
}

fn default_kanban_columns() -> Vec<KanbanColumnDto> {
    [
        ("queued", "Queued"),
        ("active", "In progress"),
        ("review", "Review"),
        ("done", "Done"),
    ]
    .into_iter()
    .map(|(role, title)| KanbanColumnDto {
        id: role.to_string(),
        title: title.to_string(),
        role: role.to_string(),
    })
    .collect()
}

fn stable_id(prefix: &str, value: &str, ordinal: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hasher.update(ordinal.to_le_bytes());
    format!("{prefix}_{:x}", hasher.finalize())[..31].to_string()
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn replacement_diff(name: &str, before: &str, after: &str) -> String {
    // ponytail: full-file previews avoid a diff dependency; add line hunks if 1 MiB previews become painful.
    let mut output = format!("--- a/{name}\n+++ b/{name}\n@@ full file @@\n");
    for line in before.lines() {
        output.push_str(&format!("-{line}\n"));
    }
    for line in after.lines() {
        output.push_str(&format!("+{line}\n"));
    }
    output
}
