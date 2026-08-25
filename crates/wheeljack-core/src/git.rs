use super::*;

const MAX_DIFF_BYTES: usize = 200_000;

pub(crate) fn read_git_status(path: &Path, include_worktrees: bool) -> GitStatusDto {
    let path_exists = path.exists();
    let Some(status_output) = read_git_status_porcelain(path, false) else {
        return GitStatusDto {
            is_repo: false,
            path_exists,
            branch: "none".to_string(),
            dirty: false,
            github_remote: false,
            changed_files: Vec::new(),
            worktrees: Vec::new(),
        };
    };

    let (branch, changed_files) = parse_git_status_porcelain(&status_output);
    GitStatusDto {
        is_repo: true,
        path_exists,
        branch,
        dirty: !changed_files.is_empty(),
        github_remote: has_github_remote(path),
        changed_files,
        worktrees: if include_worktrees {
            read_worktrees(path)
        } else {
            Vec::new()
        },
    }
}

fn has_github_remote(path: &Path) -> bool {
    git_command()
        .arg("-C")
        .arg(path)
        .args(["config", "--get-regexp", r"^remote\..*\.url$"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(|line| line.split_once(char::is_whitespace).map(|(_, url)| url))
                .any(|url| {
                    let url = url.to_ascii_lowercase();
                    url.starts_with("git@github.com:")
                        || url.contains("://github.com/")
                        || url.contains("@github.com/")
                })
        })
        .unwrap_or(false)
}

pub(crate) fn read_git_diff(path: &Path) -> Result<GitDiffDto> {
    if !is_git_repo(path) {
        return Ok(GitDiffDto {
            is_repo: false,
            text: String::new(),
            truncated: false,
        });
    }

    let has_head = git_command()
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--verify")
        .arg("HEAD")
        .output()?
        .status
        .success();
    let mut command = git_command();
    command
        .arg("-C")
        .arg(path)
        .arg("diff")
        .arg("--no-ext-diff")
        .arg("--no-color");
    if has_head {
        command.arg("HEAD");
    } else {
        command.arg("--cached");
    }
    let output = command.arg("--").output()?;
    if !output.status.success() {
        bail!("git diff failed: {}", command_output_detail(&output));
    }

    let truncated = output.stdout.len() > MAX_DIFF_BYTES;
    let bytes = &output.stdout[..output.stdout.len().min(MAX_DIFF_BYTES)];
    Ok(GitDiffDto {
        is_repo: true,
        text: String::from_utf8_lossy(bytes).to_string(),
        truncated,
    })
}

fn read_git_status_porcelain(path: &Path, include_untracked: bool) -> Option<String> {
    // ponytail: keep the normal UI scan cheap; destructive worktree removal opts into untracked files.
    git_command()
        .arg("-C")
        .arg(path)
        .arg("status")
        .arg("--porcelain=v1")
        .arg("--branch")
        .arg(if include_untracked {
            "--untracked-files=normal"
        } else {
            "--untracked-files=no"
        })
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_git_status_porcelain(output: &str) -> (String, Vec<String>) {
    let mut branch = "detached".to_string();
    let mut changed_files = Vec::new();

    for line in output.lines() {
        if let Some(status) = line.strip_prefix("## ") {
            branch = parse_git_status_branch(status);
        } else if !line.trim().is_empty() {
            changed_files.push(line.to_string());
        }
    }

    (branch, changed_files)
}

fn parse_git_status_branch(status: &str) -> String {
    let local = status
        .split("...")
        .next()
        .unwrap_or(status)
        .trim()
        .strip_prefix("No commits yet on ")
        .unwrap_or_else(|| status.split("...").next().unwrap_or(status).trim())
        .trim();

    if local.is_empty() || local.eq_ignore_ascii_case("HEAD (no branch)") {
        "detached".to_string()
    } else {
        local.to_string()
    }
}

pub(crate) fn is_git_repo(path: &Path) -> bool {
    git_command()
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim() == "true")
        .unwrap_or(false)
}

pub(crate) fn read_worktrees(path: &Path) -> Vec<GitWorktreeDto> {
    let output = git_command()
        .arg("-C")
        .arg(path)
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
        .unwrap_or_default();
    let mut worktrees = parse_worktree_list(&output);
    for worktree in &mut worktrees {
        let worktree_path = Path::new(&worktree.path);
        worktree.dirty =
            worktree_path.exists() && worktree_path_is_dirty(worktree_path).unwrap_or(true);
    }
    worktrees
}

fn parse_worktree_list(output: &str) -> Vec<GitWorktreeDto> {
    let mut worktrees = Vec::new();
    let mut current: Option<GitWorktreeDto> = None;
    for line in output.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(worktree) = current.take() {
                worktrees.push(worktree);
            }
            current = Some(GitWorktreeDto {
                path: path.to_string(),
                branch: "detached".to_string(),
                head: String::new(),
                detached: false,
                bare: false,
                dirty: false,
            });
        } else if let Some(worktree) = current.as_mut() {
            if let Some(head) = line.strip_prefix("HEAD ") {
                worktree.head = head.to_string();
            } else if let Some(branch) = line.strip_prefix("branch ") {
                worktree.branch = branch
                    .strip_prefix("refs/heads/")
                    .unwrap_or(branch)
                    .to_string();
            } else if line == "detached" {
                worktree.detached = true;
            } else if line == "bare" {
                worktree.bare = true;
            }
        }
    }
    if let Some(worktree) = current {
        worktrees.push(worktree);
    }
    worktrees
}

fn worktree_path_is_dirty(path: &Path) -> Result<bool> {
    let output = read_git_status_porcelain(path, true)
        .ok_or_else(|| anyhow!("Could not read git status for worktree {}.", path.display()))?;
    Ok(!parse_git_status_porcelain(&output).1.is_empty())
}

pub(crate) fn resolve_git_worktree_context(project_path: &Path) -> Result<(PathBuf, PathBuf)> {
    let root_output = git_command()
        .arg("-C")
        .arg(project_path)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()?;
    if !root_output.status.success() {
        bail!(
            "Project path is not a git repository: {}",
            command_output_detail(&root_output)
        );
    }
    let root = String::from_utf8_lossy(&root_output.stdout)
        .trim()
        .to_string();
    let root = normalize_command_cwd(
        PathBuf::from(root)
            .canonicalize()
            .context("Git repository root does not exist.")?,
    );

    let prefix_output = git_command()
        .arg("-C")
        .arg(project_path)
        .arg("rev-parse")
        .arg("--show-prefix")
        .output()?;
    if !prefix_output.status.success() {
        bail!(
            "Could not resolve the project path inside its git repository: {}",
            command_output_detail(&prefix_output)
        );
    }
    let project_relative = PathBuf::from(String::from_utf8_lossy(&prefix_output.stdout).trim());
    Ok((root, project_relative))
}

pub(crate) fn read_git_head(path: &Path) -> Result<String> {
    let output = git_command()
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--verify")
        .arg("HEAD^{commit}")
        .output()?;
    if !output.status.success() {
        bail!(
            "Git repository needs a committed HEAD: {}",
            command_output_detail(&output)
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn read_git_branch_head(path: &Path, branch: &str) -> Result<String> {
    let output = git_command()
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--verify")
        .arg(format!("refs/heads/{branch}^{{commit}}"))
        .output()?;
    if !output.status.success() {
        bail!(
            "Task branch is not available in this repository: {}",
            command_output_detail(&output)
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub(crate) fn validate_full_commit(path: &Path, value: &str) -> Result<String> {
    let commit = value.trim();
    if !matches!(commit.len(), 40 | 64) || !commit.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("Base commit must be a full 40- or 64-character git object ID.");
    }
    let output = git_command()
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--verify")
        .arg(format!("{commit}^{{commit}}"))
        .output()?;
    if !output.status.success() {
        bail!(
            "Base commit is not available in this repository: {}",
            command_output_detail(&output)
        );
    }
    let resolved = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !resolved.eq_ignore_ascii_case(commit) {
        bail!("Base commit did not resolve to the expected object.");
    }
    Ok(resolved)
}

pub(crate) fn read_worktree_snapshot(
    worktree_path: &Path,
    base_commit: &str,
) -> Result<(String, Vec<String>, String, bool)> {
    let index_path =
        env::temp_dir().join(format!("wheeljack-{}.index", Uuid::now_v7().as_simple()));
    let mut lock_name = index_path.as_os_str().to_os_string();
    lock_name.push(".lock");
    let lock_path = PathBuf::from(lock_name);

    let result = (|| {
        let read_tree = git_with_index(worktree_path, &index_path)
            .arg("read-tree")
            .arg(base_commit)
            .output()?;
        if !read_tree.status.success() {
            bail!(
                "git read-tree failed: {}",
                command_output_detail(&read_tree)
            );
        }

        let add = git_with_index(worktree_path, &index_path)
            .arg("add")
            .arg("-A")
            .arg("--")
            .output()?;
        if !add.status.success() {
            bail!("git snapshot failed: {}", command_output_detail(&add));
        }

        let write_tree = git_with_index(worktree_path, &index_path)
            .arg("write-tree")
            .output()?;
        if !write_tree.status.success() {
            bail!(
                "git snapshot tree failed: {}",
                command_output_detail(&write_tree)
            );
        }
        let snapshot_id = String::from_utf8_lossy(&write_tree.stdout)
            .trim()
            .to_string();

        let names = git_with_index(worktree_path, &index_path)
            .arg("diff")
            .arg("--cached")
            .arg("--name-only")
            .arg("-z")
            .arg("--no-ext-diff")
            .arg("--no-color")
            .arg(base_commit)
            .arg("--")
            .output()?;
        if !names.status.success() {
            bail!(
                "git snapshot file list failed: {}",
                command_output_detail(&names)
            );
        }
        let changed_files = names
            .stdout
            .split(|byte| *byte == 0)
            .filter(|path| !path.is_empty())
            .map(|path| String::from_utf8_lossy(path).to_string())
            .collect();

        let diff = git_with_index(worktree_path, &index_path)
            .arg("diff")
            .arg("--cached")
            .arg("--no-ext-diff")
            .arg("--no-color")
            .arg(base_commit)
            .arg("--")
            .output()?;
        if !diff.status.success() {
            bail!("git snapshot diff failed: {}", command_output_detail(&diff));
        }
        let truncated = diff.stdout.len() > MAX_DIFF_BYTES;
        let bytes = &diff.stdout[..diff.stdout.len().min(MAX_DIFF_BYTES)];
        Ok((
            snapshot_id,
            changed_files,
            String::from_utf8_lossy(bytes).to_string(),
            truncated,
        ))
    })();

    let lock_cleanup = remove_file_if_exists(&lock_path);
    let index_cleanup = remove_file_if_exists(&index_path);
    let cleanup = lock_cleanup.and(index_cleanup);
    match (result, cleanup) {
        (Ok(value), Ok(())) => Ok(value),
        (Ok(_), Err(error)) => Err(error),
        (Err(error), _) => Err(error),
    }
}

fn git_with_index<'a>(worktree_path: &'a Path, index_path: &'a Path) -> Command {
    let mut command = git_command();
    command
        .arg("-C")
        .arg(worktree_path)
        .env("GIT_INDEX_FILE", index_path);
    command
}

fn remove_file_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("remove temporary {}", path.display())),
    }
}

pub(crate) fn ensure_safe_branch_name(branch_name: &str) -> Result<()> {
    let name = branch_name.trim();
    if name.is_empty()
        || name.len() > 128
        || name.eq_ignore_ascii_case("head")
        || name.starts_with('-')
        || name.starts_with('/')
        || name.ends_with('/')
        || name.contains("..")
        || name.contains("//")
        || name.ends_with(".lock")
        || !name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '/'))
    {
        bail!("Branch names may use letters, numbers, '.', '_', '-', and '/', but cannot contain traversal, lock suffixes, spaces, or shell-sensitive characters.");
    }
    let output = git_command()
        .arg("check-ref-format")
        .arg("--branch")
        .arg(name)
        .output()?;
    if output.status.success() {
        Ok(())
    } else {
        bail!("Git rejected that branch name.")
    }
}

pub(crate) fn resolve_new_worktree_path(
    repo_path: &Path,
    branch_name: &str,
    requested_path: Option<&str>,
) -> Result<PathBuf> {
    let path = match requested_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        Some(path) => {
            let expanded = expand_home_path(path);
            if expanded.is_absolute() {
                expanded
            } else {
                repo_path
                    .parent()
                    .unwrap_or_else(|| Path::new("."))
                    .join(expanded)
            }
        }
        None => {
            let repo_name = repo_path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| anyhow!("Project path needs a folder name before a default worktree can be created."))?;
            let parent = repo_path.parent().ok_or_else(|| {
                anyhow!(
                    "Project path needs a parent folder before a default worktree can be created."
                )
            })?;
            parent.join(format!("{repo_name}-{}", safe_worktree_leaf(branch_name)))
        }
    };
    if path.exists() {
        bail!("Worktree path already exists; wheeljack will not overwrite it.");
    }
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("Worktree path needs a folder name."))?;
    if file_name == "." || file_name == ".." || file_name.trim().is_empty() {
        bail!("Worktree path needs a safe folder name.");
    }
    Ok(normalize_command_cwd(path))
}

fn safe_worktree_leaf(branch_name: &str) -> String {
    branch_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(80)
        .collect::<String>()
}

pub(crate) fn run_git_worktree_add(
    repo_path: &Path,
    branch_name: &str,
    target_path: &Path,
    base_commit: &str,
) -> Result<()> {
    if git_branch_exists(repo_path, branch_name) {
        bail!("Branch {branch_name} already exists.");
    }
    let create_branch = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("branch")
        .arg(branch_name)
        .arg(base_commit)
        .output()?;
    if !create_branch.status.success() {
        bail!(
            "git branch create failed: {}",
            command_output_detail(&create_branch)
        );
    }
    let output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("add")
        .arg(target_path)
        .arg(branch_name)
        .output()?;
    if output.status.success() {
        return Ok(());
    }
    let _ = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("branch")
        .arg("-D")
        .arg(branch_name)
        .output();
    bail!(
        "git worktree add failed: {}",
        command_output_detail(&output)
    );
}

fn git_branch_exists(repo_path: &Path, branch_name: &str) -> bool {
    git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("rev-parse")
        .arg("--verify")
        .arg(format!("refs/heads/{branch_name}"))
        .output()
        .ok()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub(crate) fn removable_worktree<'a>(
    repo_path: &Path,
    target_path: &Path,
    worktrees: &'a [GitWorktreeDto],
    expected_branch: Option<&str>,
) -> Result<&'a GitWorktreeDto> {
    if paths_equivalent(repo_path, target_path) {
        bail!("wheeljack will not remove the currently opened project worktree.");
    }
    if let Some(primary) = worktrees.first() {
        if paths_equivalent(Path::new(&primary.path), target_path) {
            bail!("wheeljack will not remove the primary git worktree.");
        }
    }
    let worktree = worktrees
        .iter()
        .find(|worktree| paths_equivalent(Path::new(&worktree.path), target_path))
        .ok_or_else(|| anyhow!("Worktree path is not registered with this repository."))?;
    if worktree.bare {
        bail!("wheeljack will not remove bare worktrees.");
    }
    if let Some(expected_branch) = expected_branch {
        if worktree.branch != expected_branch {
            bail!(
                "Worktree branch mismatch: expected {expected_branch}, found {}.",
                worktree.branch
            );
        }
    }
    if target_path.exists() && worktree.dirty {
        bail!("Worktree has local changes; commit, stash, or clean it before removal.");
    }
    Ok(worktree)
}

struct MissingWorktreeRegistration {
    admin_dir: PathBuf,
    path: PathBuf,
    branch: String,
}

fn find_missing_worktree_registration(
    repo_path: &Path,
    target_path: &Path,
) -> Result<Option<MissingWorktreeRegistration>> {
    let output = git_command()
        .arg("-C")
        .arg(repo_path)
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .output()?;
    if !output.status.success() {
        bail!(
            "could not locate Git worktree metadata: {}",
            command_output_detail(&output)
        );
    }
    let common_dir = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    let registrations = common_dir.join("worktrees");
    if !registrations.is_dir() {
        return Ok(None);
    }
    for entry in fs::read_dir(&registrations)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let admin_dir = entry.path();
        let gitdir = fs::read_to_string(admin_dir.join("gitdir")).unwrap_or_default();
        let registered_git_file = PathBuf::from(gitdir.trim());
        let registered_path = registered_git_file
            .parent()
            .unwrap_or(&registered_git_file)
            .to_path_buf();
        if !paths_equivalent(&registered_path, target_path) {
            continue;
        }
        if admin_dir.parent() != Some(registrations.as_path()) {
            bail!("refusing to remove worktree metadata outside the Git common directory");
        }
        let head = fs::read_to_string(admin_dir.join("HEAD")).unwrap_or_default();
        let branch = head
            .trim()
            .strip_prefix("ref: refs/heads/")
            .unwrap_or("detached")
            .to_string();
        return Ok(Some(MissingWorktreeRegistration {
            admin_dir,
            path: registered_path,
            branch,
        }));
    }
    Ok(None)
}

pub(crate) fn removable_missing_worktree(
    repo_path: &Path,
    target_path: &Path,
    expected_branch: Option<&str>,
) -> Result<String> {
    if paths_equivalent(repo_path, target_path) {
        bail!("wheeljack will not remove the currently opened project worktree.");
    }
    let registration = find_missing_worktree_registration(repo_path, target_path)?
        .ok_or_else(|| anyhow!("Worktree path is not registered with this repository."))?;
    if let Some(expected_branch) = expected_branch {
        if registration.branch != expected_branch {
            bail!(
                "Worktree branch mismatch: expected {expected_branch}, found {}.",
                registration.branch
            );
        }
    }
    Ok(registration.path.to_string_lossy().to_string())
}

pub(crate) fn run_git_worktree_remove(repo_path: &Path, target_path: &Path) -> Result<()> {
    if !target_path.exists() {
        let registration = find_missing_worktree_registration(repo_path, target_path)?
            .ok_or_else(|| anyhow!("Missing worktree registration was not found."))?;
        fs::remove_dir_all(&registration.admin_dir).with_context(|| {
            format!(
                "remove stale worktree registration {}",
                registration.admin_dir.display()
            )
        })?;
        if registration.admin_dir.exists() {
            bail!("Git kept the missing worktree registered after its metadata was removed.");
        }
        return Ok(());
    }
    let mut last_detail = String::new();
    for attempt in 0..5 {
        let output = git_command()
            .arg("-C")
            .arg(repo_path)
            .arg("worktree")
            .arg("remove")
            .arg(target_path)
            .output()?;
        if output.status.success() {
            return Ok(());
        }
        last_detail = command_output_detail(&output);
        if attempt < 4 {
            thread::sleep(Duration::from_millis(150 * (attempt + 1)));
        }
    }
    bail!("git worktree remove failed after retries: {last_detail}");
}

pub(crate) fn integrate_git_worktree(
    target_path: &Path,
    source_path: &Path,
    expected_branch: &str,
    base_commit: &str,
) -> Result<GitWorktreeIntegrateResult> {
    let worktrees = read_worktrees(target_path);
    let source = worktrees
        .iter()
        .find(|worktree| paths_equivalent(Path::new(&worktree.path), source_path));
    let base_commit = validate_full_commit(target_path, base_commit)?;
    let previous_target_head = read_git_head(target_path)?;
    let Some(source) = source else {
        let source_head = read_git_branch_head(target_path, expected_branch)?;
        let source_contains_base = git_command()
            .arg("-C")
            .arg(target_path)
            .args(["merge-base", "--is-ancestor", &base_commit, &source_head])
            .status()?;
        if !source_contains_base.success() {
            bail!("Task branch no longer descends from its recorded base commit.");
        }
        let already_integrated = git_command()
            .arg("-C")
            .arg(target_path)
            .args([
                "merge-base",
                "--is-ancestor",
                &source_head,
                &previous_target_head,
            ])
            .status()?;
        if !already_integrated.success() {
            let cherry_output = git_command()
                .arg("-C")
                .arg(target_path)
                .args(["cherry", &previous_target_head, &source_head, &base_commit])
                .output()?;
            if !cherry_output.status.success() {
                bail!(
                    "Could not compare the preserved task branch with the opened project branch: {}",
                    command_output_detail(&cherry_output)
                );
            }
            let has_pending_patches = String::from_utf8_lossy(&cherry_output.stdout)
                .lines()
                .any(|line| line.starts_with("+ "));
            if has_pending_patches {
                bail!("Task worktree is missing and its preserved branch has not been integrated by project recovery.");
            }
        }
        let verified_orphan = source_path.exists()
            && (orphan_directory_matches_branch(target_path, source_path, &source_head)?
                || orphan_directory_matches_branch(target_path, source_path, &base_commit)?);
        if source_path.exists() && !verified_orphan {
            return Ok(GitWorktreeIntegrateResult {
                status: "orphaned_source".to_string(),
                branch: expected_branch.to_string(),
                base_commit,
                source_head,
                target_head: previous_target_head.clone(),
                previous_target_head,
                commits: Vec::new(),
                message: "Task directory exists without a Git worktree registration and differs from both its preserved branch and recorded base. One project recovery pass must preserve or archive it before reconciliation continues.".to_string(),
            });
        }
        return Ok(GitWorktreeIntegrateResult {
            status: "integrated".to_string(),
            branch: expected_branch.to_string(),
            base_commit,
            source_head,
            target_head: previous_target_head.clone(),
            previous_target_head,
            commits: Vec::new(),
            message: if verified_orphan {
                "Project recovery integrated the preserved task branch and verified that its orphan directory contains no additional repository work beyond the task branch or its recorded base."
            } else {
                "Project recovery already integrated the preserved task branch."
            }
            .to_string(),
        });
    };
    if source.detached || source.bare || source.branch != expected_branch {
        bail!("Task worktree branch does not match the expected integration source.");
    }
    let source_head = read_git_head(source_path)?;
    let result = |status: &str, target_head: String, commits: Vec<String>, message: &str| {
        GitWorktreeIntegrateResult {
            status: status.to_string(),
            branch: source.branch.clone(),
            base_commit: base_commit.clone(),
            source_head: source_head.clone(),
            target_head,
            previous_target_head: previous_target_head.clone(),
            commits,
            message: message.to_string(),
        }
    };
    if worktree_path_is_dirty(source_path)? {
        return Ok(result(
            "source_dirty",
            previous_target_head.clone(),
            Vec::new(),
            "The worker must commit or otherwise resolve its remaining task changes.",
        ));
    }
    if worktree_path_is_dirty(target_path)? {
        return Ok(result(
            "target_dirty",
            previous_target_head.clone(),
            Vec::new(),
            "The opened project checkout has local changes, so wheeljack preserved the task branch without modifying it.",
        ));
    }
    let source_contains_base = git_command()
        .arg("-C")
        .arg(source_path)
        .args(["merge-base", "--is-ancestor", &base_commit, &source_head])
        .status()?;
    if !source_contains_base.success() {
        bail!("Task branch no longer descends from its recorded base commit.");
    }
    let already_integrated = git_command()
        .arg("-C")
        .arg(target_path)
        .args([
            "merge-base",
            "--is-ancestor",
            &source_head,
            &previous_target_head,
        ])
        .status()?;
    if already_integrated.success() {
        return Ok(result(
            "integrated",
            previous_target_head.clone(),
            Vec::new(),
            "Task commits were already present in the opened project branch.",
        ));
    }
    let commits_output = git_command()
        .arg("-C")
        .arg(source_path)
        .args([
            "rev-list",
            "--reverse",
            &format!("{base_commit}..{source_head}"),
        ])
        .output()?;
    if !commits_output.status.success() {
        bail!(
            "Could not enumerate task commits: {}",
            command_output_detail(&commits_output)
        );
    }
    let source_commits = String::from_utf8_lossy(&commits_output.stdout)
        .lines()
        .map(str::trim)
        .filter(|commit| !commit.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if source_commits.is_empty() {
        return Ok(result(
            "empty",
            previous_target_head.clone(),
            source_commits,
            "The task completed without repository changes.",
        ));
    }
    let cherry_output = git_command()
        .arg("-C")
        .arg(source_path)
        .args(["cherry", &previous_target_head, &source_head, &base_commit])
        .output()?;
    if !cherry_output.status.success() {
        bail!(
            "Could not compare task patches with the opened project branch: {}",
            command_output_detail(&cherry_output)
        );
    }
    let pending = String::from_utf8_lossy(&cherry_output.stdout)
        .lines()
        .filter_map(|line| line.strip_prefix("+ "))
        .map(str::trim)
        .map(str::to_string)
        .collect::<HashSet<_>>();
    let commits = source_commits
        .into_iter()
        .filter(|commit| pending.contains(commit.as_str()))
        .collect::<Vec<_>>();
    if commits.is_empty() {
        return Ok(result(
            "integrated",
            previous_target_head.clone(),
            commits,
            "Equivalent task commits were already present in the opened project branch.",
        ));
    }
    let current_target_head = read_git_head(target_path)?;
    if current_target_head != previous_target_head {
        return Ok(result(
            "target_dirty",
            current_target_head,
            commits,
            "The opened project branch changed while reconciliation was preparing. wheeljack preserved the task branch and will retry against the new target.",
        ));
    }
    let mut command = git_command();
    command.arg("-C").arg(target_path).arg("cherry-pick");
    for commit in &commits {
        command.arg(commit);
    }
    let output = command.output()?;
    if !output.status.success() {
        let detail = command_output_detail(&output);
        let _ = git_command()
            .arg("-C")
            .arg(target_path)
            .args(["cherry-pick", "--abort"])
            .output();
        return Ok(result(
            "conflict",
            read_git_head(target_path).unwrap_or_else(|_| previous_target_head.clone()),
            commits,
            &format!("Task integration conflicted and was rolled back: {detail}"),
        ));
    }
    Ok(result(
        "integrated",
        read_git_head(target_path)?,
        commits,
        "Task commits were integrated into the opened project branch.",
    ))
}

fn orphan_directory_matches_branch(
    repo_path: &Path,
    orphan_path: &Path,
    branch_head: &str,
) -> Result<bool> {
    if !orphan_path.is_dir() || orphan_path.join(".git").exists() {
        return Ok(false);
    }
    let index_path = env::temp_dir().join(format!("wheeljack-orphan-index-{}", Uuid::now_v7()));
    let result = (|| -> Result<bool> {
        let read_tree = git_command()
            .env("GIT_INDEX_FILE", &index_path)
            .arg("-C")
            .arg(repo_path)
            .args(["read-tree", branch_head])
            .output()?;
        if !read_tree.status.success() {
            bail!(
                "Could not inspect the orphan task directory: {}",
                command_output_detail(&read_tree)
            );
        }
        let _ = git_command()
            .env("GIT_INDEX_FILE", &index_path)
            .arg("-C")
            .arg(repo_path)
            .arg("--work-tree")
            .arg(orphan_path)
            .args(["update-index", "--refresh"])
            .output()?;
        let tracked = git_command()
            .env("GIT_INDEX_FILE", &index_path)
            .arg("-C")
            .arg(repo_path)
            .arg("--work-tree")
            .arg(orphan_path)
            .args(["diff-files", "--quiet", "--ignore-submodules"])
            .status()?;
        if !tracked.success() {
            return Ok(false);
        }
        let untracked = git_command()
            .env("GIT_INDEX_FILE", &index_path)
            .arg("-C")
            .arg(repo_path)
            .arg("--work-tree")
            .arg(orphan_path)
            .args(["ls-files", "--others", "--exclude-standard"])
            .output()?;
        if !untracked.status.success() {
            bail!(
                "Could not inspect untracked orphan task files: {}",
                command_output_detail(&untracked)
            );
        }
        Ok(String::from_utf8_lossy(&untracked.stdout).trim().is_empty())
    })();
    let _ = fs::remove_file(index_path);
    result
}

fn resolve_path_with_existing_ancestor(path: &Path) -> PathBuf {
    let mut ancestor = path.to_path_buf();
    let mut missing = Vec::new();
    loop {
        if let Ok(mut resolved) = ancestor.canonicalize() {
            for component in missing.iter().rev() {
                resolved.push(component);
            }
            return resolved;
        }
        let Some(component) = ancestor.file_name().map(ToOwned::to_owned) else {
            return path.to_path_buf();
        };
        missing.push(component);
        if !ancestor.pop() {
            return path.to_path_buf();
        }
    }
}

pub(crate) fn paths_equivalent(left: &Path, right: &Path) -> bool {
    normalize_command_cwd(resolve_path_with_existing_ancestor(left))
        == normalize_command_cwd(resolve_path_with_existing_ancestor(right))
}

pub(crate) fn git_command() -> Command {
    hidden_command("git")
}

pub(crate) fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    #[cfg(windows)]
    {
        let mut command = Command::new(program);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(windows))]
    {
        Command::new(program)
    }
}

fn command_output_detail(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    } else {
        stderr
    }
}
