use super::*;

const MAX_PROJECT_FILES: usize = 20_000;
const WHEELJACK_DOCUMENTS: [&str; 3] = ["KANBAN.md", "PRD.md", "TDD.md"];

pub(crate) fn list_project_files(root: &Path) -> Result<ProjectFileCatalogDto> {
    list_project_files_with_limit(root, MAX_PROJECT_FILES)
}

fn list_project_files_with_limit(root: &Path, limit: usize) -> Result<ProjectFileCatalogDto> {
    let wheeljack_documents = existing_wheeljack_documents(root);
    if let Some(files) = git_project_files(root) {
        return Ok(finish_catalog(files, wheeljack_documents, limit));
    }

    let mut files = Vec::new();
    let mut directories = vec![root.to_path_buf()];
    while let Some(directory) = directories.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if directory == root => return Err(error.into()),
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                if !ignored_project_directory(&entry.file_name()) {
                    directories.push(path);
                }
            } else if file_type.is_file() {
                if let Ok(relative) = path.strip_prefix(root) {
                    files.push(relative.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    Ok(finish_catalog(files, wheeljack_documents, limit))
}

fn existing_wheeljack_documents(root: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let names = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|file_type| file_type.is_file()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect::<Vec<_>>();
    WHEELJACK_DOCUMENTS
        .into_iter()
        .filter(|document| names.iter().any(|name| name == document))
        .map(str::to_string)
        .collect()
}

fn git_project_files(root: &Path) -> Option<Vec<String>> {
    let output = git_command()
        .arg("-C")
        .arg(root)
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ])
        .output()
        .ok()
        .filter(|output| output.status.success())?;
    Some(
        output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|path| !path.is_empty())
            .map(|path| String::from_utf8_lossy(path).replace('\\', "/"))
            .collect(),
    )
}

fn finish_catalog(
    mut files: Vec<String>,
    wheeljack_documents: Vec<String>,
    limit: usize,
) -> ProjectFileCatalogDto {
    files.retain(|path| !WHEELJACK_DOCUMENTS.contains(&path.as_str()));
    files.sort_by_cached_key(|path| path.to_ascii_lowercase());
    files.dedup();
    let truncated = files.len() > limit;
    files.truncate(limit);
    ProjectFileCatalogDto {
        files,
        wheeljack_documents,
        truncated,
    }
}

fn ignored_project_directory(name: &OsStr) -> bool {
    matches!(
        name.to_string_lossy().to_ascii_lowercase().as_str(),
        ".git"
            | ".hg"
            | ".svn"
            | ".cache"
            | ".next"
            | ".nuxt"
            | "build"
            | "coverage"
            | "dist"
            | "node_modules"
            | "target"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project_dir() -> PathBuf {
        std::env::temp_dir().join(format!("wheeljack-project-files-{}", Uuid::now_v7()))
    }

    #[test]
    fn fallback_catalog_lists_relative_files_and_skips_generated_directories() {
        let root = project_dir();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(root.join("target/debug")).unwrap();
        fs::write(root.join("README.md"), "readme").unwrap();
        fs::write(root.join("KANBAN.md"), "kanban").unwrap();
        fs::write(root.join("PRD.md"), "prd").unwrap();
        fs::write(root.join("TDD.md"), "tdd").unwrap();
        fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "ignored").unwrap();
        fs::write(root.join("target/debug/app"), "ignored").unwrap();

        let catalog = list_project_files_with_limit(&root, 20).unwrap();

        assert_eq!(catalog.files, ["README.md", "src/main.rs"]);
        assert_eq!(
            catalog.wheeljack_documents,
            ["KANBAN.md", "PRD.md", "TDD.md"]
        );
        assert!(!catalog.truncated);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn catalog_reports_when_its_safe_result_cap_is_reached() {
        let root = project_dir();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.txt"), "a").unwrap();
        fs::write(root.join("b.txt"), "b").unwrap();

        let catalog = list_project_files_with_limit(&root, 1).unwrap();

        assert_eq!(catalog.files, ["a.txt"]);
        assert!(catalog.truncated);
        fs::remove_dir_all(root).unwrap();
    }
}
