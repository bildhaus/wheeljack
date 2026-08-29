use super::*;

const UPDATE_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const PROVENANCE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_RESULT_MESSAGE_CHARS: usize = 2_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdapterUpdatePlan {
    pub(crate) adapter_id: String,
    pub(crate) display_name: String,
    pub(crate) executable_path: String,
    pub(crate) manager: String,
    pub(crate) package_name: String,
    pub(crate) command: String,
    #[serde(skip)]
    executable: String,
    #[serde(skip)]
    args: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdapterUpdateSkip {
    pub(crate) adapter_id: String,
    pub(crate) display_name: String,
    pub(crate) reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdapterUpdateCatalog {
    pub(crate) updates: Vec<AdapterUpdatePlan>,
    pub(crate) skipped: Vec<AdapterUpdateSkip>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdapterUpdateResult {
    pub(crate) adapter_id: String,
    pub(crate) display_name: String,
    pub(crate) manager: String,
    pub(crate) command: String,
    pub(crate) success: bool,
    pub(crate) message: String,
}

#[derive(Clone, Copy)]
struct NodeManager {
    id: &'static str,
    display_name: &'static str,
}

struct NodeManagerInstallation {
    manager: NodeManager,
    executable: PathBuf,
    bin_dir: PathBuf,
    package_root: PathBuf,
}

const NODE_MANAGERS: [NodeManager; 4] = [
    NodeManager {
        id: "npm",
        display_name: "npm",
    },
    NodeManager {
        id: "pnpm",
        display_name: "pnpm",
    },
    NodeManager {
        id: "bun",
        display_name: "Bun",
    },
    NodeManager {
        id: "yarn",
        display_name: "Yarn",
    },
];

pub(crate) fn discover_adapter_updates(
    adapters: Vec<AdapterDto>,
    active_adapter_ids: &HashSet<String>,
) -> AdapterUpdateCatalog {
    let node_managers = node_manager_installations();
    let mut updates = Vec::new();
    let mut skipped = Vec::new();
    for adapter in adapters {
        if !adapter.enabled || adapter.id == "generic-shell" {
            continue;
        }
        let Some(executable_path) = adapter
            .executables
            .iter()
            .find_map(|candidate| adapters::resolve_executable_path(candidate))
        else {
            continue;
        };
        if active_adapter_ids.contains(&adapter.id) {
            skipped.push(update_skip(
                &adapter,
                "Stop its active sessions before updating.".to_string(),
            ));
            continue;
        }
        let Some(package_name) = node_package_name(&adapter.id) else {
            skipped.push(update_skip(
                &adapter,
                "Custom adapters do not declare a trusted update source.".to_string(),
            ));
            continue;
        };
        let mut candidates = node_managers
            .iter()
            .filter_map(|manager| {
                node_manager_plan(manager, &adapter, &executable_path, package_name)
            })
            .collect::<Vec<_>>();
        candidates.extend(homebrew_plans(&adapter, &executable_path));
        if let Some(plan) = windows_package_manager_plan(&adapter, &executable_path) {
            candidates.push(plan);
        }
        candidates.sort_by(|left, right| left.manager.cmp(&right.manager));
        candidates.dedup_by(|left, right| {
            left.manager == right.manager && left.package_name == right.package_name
        });
        match candidates.len() {
            1 => updates.push(candidates.remove(0)),
            count if count > 1 => skipped.push(update_skip(
                &adapter,
                format!(
                    "Multiple installers claim the active executable: {}.",
                    candidates
                        .iter()
                        .map(|candidate| candidate.manager.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            )),
            _ => match native_update_plan(&adapter, &executable_path) {
                Some(plan) => updates.push(plan),
                None => skipped.push(update_skip(
                    &adapter,
                    manual_update_reason(&adapter.id, &executable_path),
                )),
            },
        }
    }
    AdapterUpdateCatalog { updates, skipped }
}

pub(crate) fn execute_adapter_update(plan: &AdapterUpdatePlan) -> AdapterUpdateResult {
    let refs = plan.args.iter().map(String::as_str).collect::<Vec<_>>();
    let (success, output) =
        match adapters::run_adapter_command(&plan.executable, &refs, None, UPDATE_TIMEOUT, None) {
            Ok((success, output)) => (success, output),
            Err(error) => (false, format!("{error:#}")),
        };
    let message = if output.trim().is_empty() {
        if success {
            "Update command completed.".to_string()
        } else {
            "Update command failed without output.".to_string()
        }
    } else {
        truncate_message(&output)
    };
    AdapterUpdateResult {
        adapter_id: plan.adapter_id.clone(),
        display_name: plan.display_name.clone(),
        manager: plan.manager.clone(),
        command: plan.command.clone(),
        success,
        message,
    }
}

fn node_manager_plan(
    installation: &NodeManagerInstallation,
    adapter: &AdapterDto,
    executable_path: &Path,
    package_name: &str,
) -> Option<AdapterUpdatePlan> {
    let manager = installation.manager;
    let package_dir = package_path(&installation.package_root, package_name);
    if !package_dir.join("package.json").is_file()
        || !executable_belongs_to(executable_path, &installation.bin_dir, &package_dir)
    {
        return None;
    }
    let args = match manager.id {
        "npm" => ["update", "--global", package_name]
            .map(str::to_string)
            .to_vec(),
        "pnpm" | "bun" => ["update", "--global", package_name, "--latest"]
            .map(str::to_string)
            .to_vec(),
        "yarn" => vec![
            "global".to_string(),
            "add".to_string(),
            format!("{package_name}@latest"),
        ],
        _ => return None,
    };
    Some(update_plan(
        adapter,
        executable_path,
        manager.display_name,
        package_name,
        installation.executable.clone(),
        args,
    ))
}

fn node_manager_installations() -> Vec<NodeManagerInstallation> {
    NODE_MANAGERS
        .iter()
        .filter_map(|manager| {
            let executable = adapters::resolve_executable_path(manager.id)?;
            let (bin_dir, package_root) = node_manager_locations(manager.id, &executable)?;
            Some(NodeManagerInstallation {
                manager: *manager,
                executable,
                bin_dir,
                package_root,
            })
        })
        .collect()
}

fn node_manager_locations(manager: &str, manager_path: &Path) -> Option<(PathBuf, PathBuf)> {
    match manager {
        "npm" => {
            let root = successful_output(manager_path, &["root", "--global"])?;
            let root = PathBuf::from(root.lines().next()?.trim());
            let prefix = successful_output(manager_path, &["prefix", "--global"])?;
            let prefix = PathBuf::from(prefix.lines().next()?.trim());
            let bin = if cfg!(windows) {
                prefix
            } else {
                prefix.join("bin")
            };
            Some((bin, root))
        }
        "pnpm" => Some((
            PathBuf::from(successful_output(manager_path, &["bin", "--global"])?.trim()),
            PathBuf::from(successful_output(manager_path, &["root", "--global"])?.trim()),
        )),
        "bun" => {
            let bin =
                PathBuf::from(successful_output(manager_path, &["pm", "bin", "--global"])?.trim());
            let listing = successful_output(manager_path, &["pm", "ls", "--global"])?;
            let project = listing
                .lines()
                .find_map(|line| line.trim().strip_suffix(" node_modules"))
                .map(PathBuf::from)
                .or_else(|| bin.parent().map(|parent| parent.join("install/global")))?;
            Some((bin, project.join("node_modules")))
        }
        "yarn" => {
            let bin = PathBuf::from(successful_output(manager_path, &["global", "bin"])?.trim());
            let project =
                PathBuf::from(successful_output(manager_path, &["global", "dir"])?.trim());
            Some((bin, project.join("node_modules")))
        }
        _ => None,
    }
}

fn homebrew_plans(adapter: &AdapterDto, executable_path: &Path) -> Vec<AdapterUpdatePlan> {
    let Some(brew) = adapters::resolve_executable_path("brew") else {
        return Vec::new();
    };
    brew_packages(&adapter.id)
        .iter()
        .filter_map(|(kind, package)| {
            let list_args = ["list", *kind, package];
            let output = successful_output(&brew, &list_args)?;
            if !output
                .lines()
                .any(|line| paths_match(Path::new(line.trim()), executable_path))
                && !canonical_path(executable_path)
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .contains(&format!("/{}/", package.to_ascii_lowercase()))
            {
                return None;
            }
            let args = ["upgrade", *kind, package, "--no-ask"]
                .map(str::to_string)
                .to_vec();
            Some(update_plan(
                adapter,
                executable_path,
                "Homebrew",
                package,
                brew.clone(),
                args,
            ))
        })
        .collect()
}

fn windows_package_manager_plan(
    adapter: &AdapterDto,
    executable_path: &Path,
) -> Option<AdapterUpdatePlan> {
    if !cfg!(windows) {
        return None;
    }
    let normalized = normalized_path(executable_path);
    if adapter.id == "codex-cli"
        && (normalized.contains("\\microsoft\\winget\\packages\\openai.codex_")
            || normalized.contains("\\microsoft\\winget\\links\\codex"))
    {
        let manager = adapters::resolve_executable_path("winget")?;
        successful_output(
            &manager,
            &[
                "list",
                "--id",
                "OpenAI.Codex",
                "--exact",
                "--disable-interactivity",
            ],
        )?;
        return Some(update_plan(
            adapter,
            executable_path,
            "WinGet",
            "OpenAI.Codex",
            manager,
            [
                "upgrade",
                "--id",
                "OpenAI.Codex",
                "--exact",
                "--accept-package-agreements",
                "--accept-source-agreements",
                "--disable-interactivity",
            ]
            .map(str::to_string)
            .to_vec(),
        ));
    }
    let scoop_root = env::var_os("SCOOP")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join("scoop")));
    if adapter.id == "opencode"
        && normalized.contains("\\scoop\\shims\\opencode")
        && scoop_root.is_some_and(|root| root.join("apps/opencode/current").is_dir())
    {
        let manager = adapters::resolve_executable_path("scoop")?;
        return Some(update_plan(
            adapter,
            executable_path,
            "Scoop",
            "opencode",
            manager,
            ["update", "opencode"].map(str::to_string).to_vec(),
        ));
    }
    let chocolatey_root = env::var_os("ChocolateyInstall")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData\chocolatey"));
    if adapter.id == "opencode"
        && path_is_within(executable_path, &chocolatey_root.join("bin"))
        && package_directory_exists(&chocolatey_root.join("lib"), "opencode")
    {
        let manager = adapters::resolve_executable_path("choco")?;
        return Some(update_plan(
            adapter,
            executable_path,
            "Chocolatey",
            "opencode",
            manager,
            ["upgrade", "opencode", "--yes"]
                .map(str::to_string)
                .to_vec(),
        ));
    }
    None
}

fn native_update_plan(adapter: &AdapterDto, executable_path: &Path) -> Option<AdapterUpdatePlan> {
    if externally_managed_reason(&adapter.id, executable_path).is_some() {
        return None;
    }
    let portable_path = portable_path(executable_path);
    let (manager, package_name, args) = match adapter.id.as_str() {
        "claude-code" => ("Claude installer", "claude-code", vec!["update"]),
        "opencode" => ("OpenCode installer", "opencode", vec!["upgrade"]),
        "codex-cli" if portable_path.contains("/.codex/packages/standalone/") => {
            ("Codex installer", "codex", vec!["update"])
        }
        _ => return None,
    };
    Some(update_plan(
        adapter,
        executable_path,
        manager,
        package_name,
        executable_path.to_path_buf(),
        args.into_iter().map(str::to_string).collect(),
    ))
}

fn update_plan(
    adapter: &AdapterDto,
    executable_path: &Path,
    manager: &str,
    package_name: &str,
    executable: PathBuf,
    args: Vec<String>,
) -> AdapterUpdatePlan {
    let executable = executable.to_string_lossy().to_string();
    AdapterUpdatePlan {
        adapter_id: adapter.id.clone(),
        display_name: adapter.display_name.clone(),
        executable_path: executable_path.to_string_lossy().to_string(),
        manager: manager.to_string(),
        package_name: package_name.to_string(),
        command: display_command(&executable, &args),
        executable,
        args,
    }
}

fn update_skip(adapter: &AdapterDto, reason: String) -> AdapterUpdateSkip {
    AdapterUpdateSkip {
        adapter_id: adapter.id.clone(),
        display_name: adapter.display_name.clone(),
        reason,
    }
}

fn successful_output(executable: &Path, args: &[&str]) -> Option<String> {
    let executable = executable.to_string_lossy();
    adapters::run_adapter_command(&executable, args, None, PROVENANCE_TIMEOUT, None)
        .ok()
        .and_then(|(success, output)| success.then_some(output))
}

fn executable_belongs_to(executable: &Path, bin_dir: &Path, package_dir: &Path) -> bool {
    path_is_within(&canonical_path(executable), &canonical_path(package_dir))
        || executable
            .parent()
            .is_some_and(|parent| paths_match(parent, bin_dir))
            && package_declares_executable(package_dir, executable)
}

fn package_declares_executable(package_dir: &Path, executable: &Path) -> bool {
    let Ok(manifest) = fs::read_to_string(package_dir.join("package.json")) else {
        return false;
    };
    let Ok(manifest) = serde_json::from_str::<Value>(&manifest) else {
        return false;
    };
    let executable_name = executable
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or_default();
    match manifest.get("bin") {
        Some(Value::Object(entries)) => entries
            .keys()
            .any(|name| name.eq_ignore_ascii_case(executable_name)),
        Some(Value::String(_)) => manifest
            .get("name")
            .and_then(Value::as_str)
            .and_then(|name| name.rsplit('/').next())
            .is_some_and(|name| name.eq_ignore_ascii_case(executable_name)),
        _ => false,
    }
}

fn package_path(root: &Path, package_name: &str) -> PathBuf {
    package_name
        .split('/')
        .filter(|part| !part.is_empty())
        .fold(root.to_path_buf(), |path, part| path.join(part))
}

fn package_directory_exists(root: &Path, prefix: &str) -> bool {
    fs::read_dir(root).ok().is_some_and(|entries| {
        entries.filter_map(std::result::Result::ok).any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .starts_with(prefix)
        })
    })
}

fn node_package_name(adapter_id: &str) -> Option<&'static str> {
    match adapter_id {
        "claude-code" => Some("@anthropic-ai/claude-code"),
        "codex-cli" => Some("@openai/codex"),
        "opencode" => Some("opencode-ai"),
        "pi-coding-agent" => Some("@earendil-works/pi-coding-agent"),
        _ => None,
    }
}

fn brew_packages(adapter_id: &str) -> &'static [(&'static str, &'static str)] {
    match adapter_id {
        "claude-code" => &[("--cask", "claude-code"), ("--formula", "claude-code")],
        "codex-cli" => &[("--cask", "codex")],
        "opencode" => &[("--formula", "opencode")],
        _ => &[],
    }
}

fn manual_update_reason(adapter_id: &str, executable_path: &Path) -> String {
    if let Some(reason) = externally_managed_reason(adapter_id, executable_path) {
        return reason;
    }
    "No trusted installer ownership could be proven; update this standalone executable manually."
        .to_string()
}

fn externally_managed_reason(adapter_id: &str, executable_path: &Path) -> Option<String> {
    let normalized = portable_path(executable_path);
    if normalized.contains("/.nix-profile/") || normalized.contains("/nix/store/") {
        return Some(
            "Nix owns this executable; update it through the configuration that declares the package."
                .to_string(),
        );
    }
    if normalized.contains("/.local/share/mise/shims/") || normalized.contains("/.asdf/shims/") {
        return Some(
            "A version-manager shim owns this executable; update its declared tool version manually."
                .to_string(),
        );
    }
    if adapter_id == "codex-cli" && normalized.contains("/appdata/local/openai/codex/bin/") {
        return Some(
            "The Codex desktop app owns this bundled CLI and updates it with the app.".to_string(),
        );
    }
    None
}

fn display_command(executable: &str, args: &[String]) -> String {
    std::iter::once(executable)
        .chain(args.iter().map(String::as_str))
        .map(quote_argument)
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote_argument(value: &str) -> String {
    if value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "-._/@:\\".contains(character))
    {
        value.to_string()
    } else {
        format!("\"{}\"", value.replace('"', "\\\""))
    }
}

fn canonical_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn paths_match(left: &Path, right: &Path) -> bool {
    normalized_path(&canonical_path(left)) == normalized_path(&canonical_path(right))
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    let path = normalized_path(path);
    let mut root = normalized_path(root);
    if !root.ends_with(['/', '\\']) {
        root.push(std::path::MAIN_SEPARATOR);
    }
    path.starts_with(&root)
}

fn normalized_path(path: &Path) -> String {
    let value = path
        .to_string_lossy()
        .replace('/', std::path::MAIN_SEPARATOR_STR);
    if cfg!(windows) {
        value.to_ascii_lowercase()
    } else {
        value
    }
}

fn portable_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase()
}

fn truncate_message(message: &str) -> String {
    if message.chars().count() <= MAX_RESULT_MESSAGE_CHARS {
        return message.to_string();
    }
    let mut truncated = message
        .chars()
        .take(MAX_RESULT_MESSAGE_CHARS)
        .collect::<String>();
    truncated.push('…');
    truncated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn built_in_adapter_packages_are_explicit() {
        assert_eq!(
            node_package_name("claude-code"),
            Some("@anthropic-ai/claude-code")
        );
        assert_eq!(node_package_name("codex-cli"), Some("@openai/codex"));
        assert_eq!(node_package_name("opencode"), Some("opencode-ai"));
        assert_eq!(
            node_package_name("pi-coding-agent"),
            Some("@earendil-works/pi-coding-agent")
        );
        assert_eq!(node_package_name("custom"), None);
    }

    #[test]
    fn update_commands_are_rendered_without_a_shell() {
        assert_eq!(
            display_command(
                r"C:\Program Files\nodejs\npm.cmd",
                &["update".into(), "--global".into(), "@openai/codex".into()]
            ),
            r#""C:\Program Files\nodejs\npm.cmd" update --global @openai/codex"#
        );
    }

    #[test]
    fn declarative_and_app_owned_installs_explain_manual_updates() {
        assert!(
            manual_update_reason("opencode", Path::new("/nix/store/hash/bin/opencode"))
                .contains("Nix")
        );
        assert!(manual_update_reason(
            "codex-cli",
            Path::new(r"C:\Users\test\AppData\Local\OpenAI\Codex\bin\hash\codex.exe")
        )
        .contains("desktop app"));
    }
}
