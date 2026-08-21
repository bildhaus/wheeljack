use super::*;

pub(crate) fn expand_home_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed == "~" {
        return home_dir().unwrap_or_else(|| PathBuf::from(trimmed));
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        return home_dir()
            .map(|home| home.join(rest))
            .unwrap_or_else(|| PathBuf::from(trimmed));
    }
    if let Some(path) = known_home_folder_path(trimmed) {
        return path;
    }
    PathBuf::from(trimmed)
}

pub(crate) fn known_home_folder_path(path: &str) -> Option<PathBuf> {
    let slash_path = path.replace('\\', "/");
    if slash_path.starts_with("//") {
        return None;
    }
    let candidate = if cfg!(windows) {
        slash_path.trim_start_matches('/')
    } else if slash_path.starts_with('/') {
        return None;
    } else {
        slash_path.as_str()
    };
    let mut parts = candidate.splitn(2, '/');
    let folder = parts.next()?.to_ascii_lowercase();
    let home_folder = match folder.as_str() {
        "documents" | "docs" => "Documents",
        "desktop" => "Desktop",
        "downloads" => "Downloads",
        _ => return None,
    };
    let mut path = home_dir()?.join(home_folder);
    if let Some(rest) = parts.next().filter(|rest| !rest.is_empty()) {
        for part in rest.split('/').filter(|part| !part.is_empty()) {
            path.push(part);
        }
    }
    Some(path)
}

pub(crate) fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

pub(crate) fn resolve_workspace_folder_path(path: &str) -> Result<PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        bail!("workspace folder path is empty");
    }
    let path = expand_home_path(trimmed);
    if !path.exists() {
        bail!("workspace path does not exist: {}", path.display());
    }
    if !path.is_dir() {
        bail!("workspace path is not a directory: {}", path.display());
    }
    Ok(normalize_command_cwd(path.canonicalize()?))
}

pub(crate) fn id(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::now_v7())
}
