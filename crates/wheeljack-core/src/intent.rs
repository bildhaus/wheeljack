use super::*;

const TOOL_PLAN_MARKER: &str = "wheeljack.tool_plan";
const LEGACY_TOOL_PLAN_MARKER: &str = "txtl.tool_plan";

struct AgentIntentAdapter {
    aliases: &'static [&'static str],
    adapter_id: &'static str,
    adapter_name: &'static str,
}

const AGENT_INTENT_ADAPTERS: &[AgentIntentAdapter] = &[
    AgentIntentAdapter {
        aliases: &["claude code", "claude"],
        adapter_id: "claude-code",
        adapter_name: "Claude Code",
    },
    AgentIntentAdapter {
        aliases: &["codex cli", "codex"],
        adapter_id: "codex-cli",
        adapter_name: "Codex CLI",
    },
    AgentIntentAdapter {
        aliases: &["open code", "opencode"],
        adapter_id: "opencode",
        adapter_name: "OpenCode",
    },
    AgentIntentAdapter {
        aliases: &["pi", "pi code", "pi agent", "pi coding agent"],
        adapter_id: "pi-coding-agent",
        adapter_name: "Pi",
    },
];

fn contains_agent_alias(text: &str, alias: &str) -> bool {
    let text_tokens: Vec<&str> = text.split_whitespace().collect();
    let alias_tokens: Vec<&str> = alias.split_whitespace().collect();
    if alias_tokens.is_empty() || text_tokens.len() < alias_tokens.len() {
        return false;
    }
    text_tokens
        .windows(alias_tokens.len())
        .any(|window| window == alias_tokens.as_slice())
}

fn intent_tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_'))
        .filter(|token| !token.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn has_word(text: &str, word: &str) -> bool {
    intent_tokens(text).iter().any(|token| token == word)
}

fn has_any_word(text: &str, words: &[&str]) -> bool {
    let tokens = intent_tokens(text);
    words
        .iter()
        .any(|word| tokens.iter().any(|token| token == word))
}

fn parse_count(text: &str, max: usize) -> usize {
    let tokens = intent_tokens(text);
    for (word, count) in [
        ("six", 6usize),
        ("five", 5usize),
        ("four", 4usize),
        ("three", 3usize),
        ("two", 2usize),
        ("one", 1usize),
        ("a", 1usize),
        ("an", 1usize),
    ] {
        if tokens.iter().any(|token| token == word) {
            return count.min(max);
        }
    }
    tokens
        .iter()
        .filter_map(|token| token.parse::<usize>().ok())
        .find(|count| *count > 0)
        .map(|count| count.min(max))
        .unwrap_or(1)
}

pub(crate) fn normalize_requested_cwd(value: Option<&str>) -> Option<String> {
    let cleaned = clean_cwd_value(value?);
    if cleaned.is_empty() {
        return None;
    }
    if let Some(home_path) = known_home_folder_text_path(&cleaned) {
        return Some(home_path);
    }
    Some(cleaned)
}

fn clean_cwd_value(value: &str) -> String {
    let mut cleaned = value.trim().to_string();
    for connector in [" and then ", " then ", " and "] {
        if let Some(index) = cleaned.to_lowercase().find(connector) {
            cleaned.truncate(index);
        }
    }
    cleaned = cleaned
        .trim_matches(|ch: char| {
            ch.is_whitespace() || matches!(ch, '"' | '\'' | '`' | '.' | ',' | ';')
        })
        .to_string();
    for prefix in [
        "the directory ",
        "the folder ",
        "the path ",
        "the cwd ",
        "directory ",
        "folder ",
        "path ",
        "cwd ",
    ] {
        if cleaned.to_lowercase().starts_with(prefix) {
            cleaned = cleaned[prefix.len()..].trim().to_string();
            break;
        }
    }
    cleaned
}

fn known_home_folder_text_path(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    if normalized.starts_with("//") {
        return None;
    }
    let slash_path = normalized.trim_start_matches('/');
    let mut parts = slash_path.splitn(2, '/');
    let folder = parts.next()?.to_ascii_lowercase();
    let home_folder = match folder.as_str() {
        "documents" | "docs" => "Documents",
        "desktop" => "Desktop",
        "downloads" => "Downloads",
        _ => return None,
    };
    let rest = parts.next().filter(|rest| !rest.is_empty());
    Some(match rest {
        Some(rest) => format!("~/{home_folder}/{rest}"),
        None => format!("~/{home_folder}"),
    })
}

fn parse_requested_cwd(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    for marker in [" in ", " at ", " from ", " under ", " inside "] {
        if let Some(index) = lower.find(marker) {
            return normalize_requested_cwd(Some(&text[index + marker.len()..]));
        }
    }
    for marker in ["in ", "at ", "from ", "under ", "inside "] {
        if lower.starts_with(marker) {
            return normalize_requested_cwd(Some(&text[marker.len()..]));
        }
    }
    None
}

fn parse_project_name(text: &str) -> Option<String> {
    let mut iter = text.split_whitespace();
    while let Some(token) = iter.next() {
        if token
            .trim_matches(|ch: char| !ch.is_ascii_alphanumeric())
            .eq_ignore_ascii_case("for")
        {
            let value = iter.next()?.trim_matches(|ch: char| {
                !(ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-'))
            });
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn parse_theme_action(text: &str) -> Option<Value> {
    let lower = text.to_lowercase();
    if !(has_any_word(&lower, &["switch", "change", "set"])
        && has_any_word(&lower, &["theme", "mode"]))
    {
        return None;
    }
    if has_any_word(&lower, &["light", "white", "bright"]) {
        Some(json!({"type": "switch_theme", "themeId": "mono-light"}))
    } else if has_any_word(&lower, &["dark", "black", "mono", "default"]) {
        Some(json!({"type": "switch_theme", "themeId": "mono-dark"}))
    } else {
        None
    }
}

fn parse_agent_creation_action(text: &str) -> Option<Value> {
    let normalized = text.to_lowercase().replace('-', " ");
    if !has_any_word(&normalized, &["create", "add", "launch", "start"]) {
        return None;
    }
    AGENT_INTENT_ADAPTERS
        .iter()
        .find(|adapter| {
            adapter
                .aliases
                .iter()
                .any(|alias| contains_agent_alias(&normalized, alias))
        })
        .map(|adapter| {
            let mut action = json!({
                "type": "create_agent_nodes",
                "adapterId": adapter.adapter_id,
                "adapterName": adapter.adapter_name,
                "count": parse_count(&normalized, 6),
            });
            if let Some(cwd) = parse_requested_cwd(text) {
                action["cwd"] = json!(cwd);
            }
            if let Some(project_name) = parse_project_name(text) {
                action["projectName"] = json!(project_name);
            }
            action
        })
}

fn parse_shell_creation_action(text: &str) -> Option<Value> {
    let lower = text.to_lowercase();
    if lower.contains("cursor-agent") || lower.contains("cursor agent") {
        return None;
    }
    if !has_any_word(
        text,
        &[
            "shell",
            "shells",
            "terminal",
            "terminals",
            "powershell",
            "zsh",
            "bash",
            "cmd",
            "pwsh",
        ],
    ) {
        return None;
    }
    let has_create_verb = has_any_word(text, &["add", "create", "open", "launch", "start"]);
    let has_count = parse_count(text, 12) > 1
        || intent_tokens(text)
            .iter()
            .any(|token| token.parse::<usize>().ok().is_some_and(|count| count > 0));
    if !has_create_verb && !has_count {
        return None;
    }
    let mut action = json!({"type": "create_shell_node", "count": parse_count(text, 12)});
    if let Some(cwd) = parse_requested_cwd(text) {
        action["cwd"] = json!(cwd);
    }
    Some(action)
}

pub(crate) fn normalize_browser_url(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "http://localhost:3000".to_string();
    }
    let lower = trimmed.to_lowercase();
    if lower.find("://").is_some_and(|index| {
        index > 0
            && trimmed[..index]
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '.' | '-'))
            && trimmed[..index]
                .chars()
                .next()
                .is_some_and(|ch| ch.is_ascii_alphabetic())
    }) {
        return trimmed.to_string();
    }
    if is_loopback_browser_host(&lower) {
        return format!("http://{trimmed}");
    }
    format!("https://{trimmed}")
}

fn is_loopback_browser_host(value: &str) -> bool {
    for host in ["localhost", "127.0.0.1", "[::1]", "::1"] {
        let Some(rest) = value.strip_prefix(host) else {
            continue;
        };
        if rest.is_empty() || matches!(rest.as_bytes()[0], b':' | b'/' | b'?' | b'#') {
            return true;
        }
    }
    false
}

fn trim_url_punctuation(value: &str) -> &str {
    value.trim_end_matches([')', ',', '.', ';'])
}

fn parse_browser_intent_url(text: &str) -> String {
    if let Some(url) = detect_local_preview_url(text) {
        return url;
    }
    let lower = text.to_lowercase();
    if let Some(index) = lower.find("localhost") {
        let after = &text[index + "localhost".len()..];
        let digits: String = after
            .trim_start_matches(|ch: char| ch.is_whitespace() || ch == ':')
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .collect();
        if (2..=5).contains(&digits.len()) {
            return format!("http://localhost:{digits}");
        }
    }
    for token in text.split_whitespace() {
        let candidate = trim_url_punctuation(token.trim_matches(['"', '\'', '`', '<', '>']));
        let lower_candidate = candidate.to_lowercase();
        if lower_candidate.starts_with("http://") || lower_candidate.starts_with("https://") {
            return normalize_browser_url(candidate);
        }
    }
    for token in text.split_whitespace() {
        let candidate = trim_url_punctuation(token.trim_matches(['"', '\'', '`', '<', '>']));
        if is_bare_domain_candidate(candidate) {
            return normalize_browser_url(candidate);
        }
    }
    "http://localhost:3000".to_string()
}

fn is_bare_domain_candidate(candidate: &str) -> bool {
    let host = candidate
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .split(':')
        .next()
        .unwrap_or_default();
    if !host.contains('.') || host.starts_with('.') || host.ends_with('.') {
        return false;
    }
    let mut parts = host.split('.');
    let Some(tld) = parts.next_back() else {
        return false;
    };
    tld.len() >= 2
        && tld.chars().all(|ch| ch.is_ascii_alphabetic())
        && parts.all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
        })
}

fn parse_zoom_action(text: &str) -> Option<Value> {
    let lower = text.to_lowercase();
    let after_zoom = lower.split_once("zoom")?.1.trim_start();
    let after_to = after_zoom.strip_prefix("to ").unwrap_or(after_zoom);
    let digits: String = after_to
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect();
    if !(2..=3).contains(&digits.len()) {
        return None;
    }
    let rest = after_to[digits.len()..].trim_start();
    if !(rest.starts_with("percent") || rest.starts_with('%')) {
        return None;
    }
    let value = digits.parse::<f64>().ok()?.clamp(25.0, 200.0) / 100.0;
    Some(json!({"type": "zoom", "scale": value}))
}

fn parse_focus_node_action(text: &str) -> Option<Value> {
    let lower = text.to_lowercase();
    let index = lower.find("focus ")?;
    let rest = text[index + "focus ".len()..].trim();
    let first = rest
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches(|ch: char| !ch.is_ascii_alphanumeric())
        .to_lowercase();
    if matches!(
        first.as_str(),
        "widget" | "music" | "mode" | "mini" | "mini-app" | "app" | "timer"
    ) {
        return None;
    }
    let query: String = rest
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | ' ' | '-'))
        .take(32)
        .collect::<String>()
        .trim()
        .trim_matches(['.', ',', ';'])
        .to_string();
    if query.len() >= 2 {
        Some(json!({"type": "focus_node", "query": query}))
    } else {
        None
    }
}

fn parse_broadcast_action(text: &str) -> Option<Value> {
    let lower = text.to_lowercase();
    for marker in ["broadcast", "tell all", "ask all"] {
        if let Some(index) = lower.find(marker) {
            let prompt = text[index + marker.len()..]
                .trim_start_matches(|ch: char| ch.is_whitespace() || matches!(ch, ':' | '-' | ','))
                .trim();
            if !prompt.is_empty() {
                return Some(json!({"type": "broadcast_prompt", "prompt": prompt}));
            }
        }
    }
    None
}

fn parse_workspace_action(text: &str) -> Option<Value> {
    let trimmed = text.trim();
    let lower = trimmed.to_lowercase();
    for prefix in ["new workspace", "create workspace", "add workspace"] {
        if lower.starts_with(prefix) {
            let name = workspace_action_name(&trimmed[prefix.len()..]);
            return Some(json!({
                "type": "create_workspace",
                "name": name,
            }));
        }
    }
    for prefix in ["rename current workspace", "rename workspace"] {
        if lower.starts_with(prefix) {
            let rest = trimmed[prefix.len()..]
                .trim_start_matches(|ch: char| ch.is_whitespace() || matches!(ch, ':' | '-' | ','))
                .trim_start();
            let rest = rest.strip_prefix("to ").unwrap_or(rest);
            let name = workspace_action_name(rest);
            if !name.is_empty() {
                return Some(json!({"type": "rename_workspace", "name": name}));
            }
        }
    }
    for prefix in ["switch workspace", "open workspace", "go to workspace"] {
        if lower.starts_with(prefix) {
            let query = workspace_action_name(&trimmed[prefix.len()..]);
            if !query.is_empty() {
                return Some(json!({"type": "switch_workspace", "query": query}));
            }
        }
    }
    if matches!(
        lower.as_str(),
        "move workspace left" | "relocate workspace left"
    ) {
        return Some(json!({"type": "move_workspace", "direction": "left"}));
    }
    if matches!(
        lower.as_str(),
        "move workspace right" | "relocate workspace right"
    ) {
        return Some(json!({"type": "move_workspace", "direction": "right"}));
    }
    if matches!(
        lower.as_str(),
        "reset workspace"
            | "reset workspaces"
            | "reset workspace cache"
            | "reset project workspaces"
    ) {
        return Some(json!({"type": "reset_workspaces"}));
    }
    if matches!(
        lower.as_str(),
        "delete workspace" | "delete current workspace" | "remove workspace" | "close workspace"
    ) {
        return Some(json!({"type": "delete_workspace"}));
    }
    None
}

fn parse_shape_creation_action(text: &str) -> Option<Value> {
    if !has_any_word(text, &["add", "create", "new", "open", "draw"]) {
        return None;
    }
    let lower = text.to_lowercase();
    let shape = if has_word(&lower, "circle") {
        "circle"
    } else if has_word(&lower, "diamond") {
        "diamond"
    } else if has_word(&lower, "rectangle") || has_word(&lower, "shape") {
        "rectangle"
    } else {
        return None;
    };
    Some(json!({"type": "create_shape_node", "shape": shape}))
}

fn workspace_action_name(value: &str) -> String {
    let mut name = value;
    for separator in [" and then ", " then ", " and "] {
        if let Some(index) = name.to_lowercase().find(separator) {
            let next = name[index + separator.len()..].trim_start().to_lowercase();
            if [
                "add",
                "arrange",
                "ask",
                "broadcast",
                "create",
                "delete",
                "draw",
                "focus",
                "launch",
                "move",
                "open",
                "rename",
                "reset",
                "start",
                "switch",
                "tell",
                "zoom",
            ]
            .iter()
            .any(|verb| next == *verb || next.starts_with(&format!("{verb} ")))
            {
                name = &name[..index];
                break;
            }
        }
    }
    name.trim_start_matches(|ch: char| ch.is_whitespace() || matches!(ch, ':' | '-' | ','))
        .trim()
        .trim_matches('"')
        .trim()
        .to_string()
}

pub(crate) fn parse_intent(req: IntentParseRequest) -> ParsedIntentDto {
    let text = req.transcript.trim().to_string();
    let mut risk = classify_risk(&req.transcript);
    let mut actions = Vec::new();
    let assignments = parse_orchestrator_assignments(&text);
    if !assignments.is_empty() {
        actions.push(json!({
            "type": "route_terminal_prompts",
            "assignments": assignments,
        }));
        if risk == "safe" {
            risk = "caution".to_string();
        }
        let assignment_count = actions[0]["assignments"].as_array().map_or(0, Vec::len);
        return ParsedIntentDto {
            id: id("intent"),
            source: req.source,
            transcript: req.transcript,
            confidence: 0.9,
            requires_confirmation: risk != "safe",
            risk,
            explanation: format!(
                "Planned {assignment_count} terminal route{}.",
                if assignment_count == 1 { "" } else { "s" }
            ),
            actions,
        };
    }
    if let Some(action) = parse_theme_action(&text) {
        actions.push(action);
    }
    if let Some(action) = parse_workspace_action(&text) {
        actions.push(action);
    }
    if has_any_word(&text, &["create", "add", "launch", "start"])
        && text.to_lowercase().contains("orchestrator")
    {
        actions.push(json!({"type": "create_orchestrator_node"}));
    }
    if let Some(action) = parse_agent_creation_action(&text) {
        actions.push(action);
    }
    if let Some(action) = parse_shell_creation_action(&text) {
        actions.push(action);
    }
    if has_any_word(&text, &["add", "create", "open"])
        && (has_any_word(&text, &["browser", "web", "localhost", "preview"])
            || text.to_lowercase().contains("127.0.0.1"))
    {
        actions
            .push(json!({"type": "create_browser_node", "url": parse_browser_intent_url(&text)}));
    }
    if !text.to_lowercase().contains("spotify")
        && !text.to_lowercase().contains("apple music")
        && has_any_word(&text, &["add", "create", "open", "start"])
        && has_any_word(&text, &["focus", "pomodoro", "timer", "music", "player"])
    {
        actions.push(json!({"type": "create_focus_widget"}));
    }
    if has_any_word(&text, &["add", "create"]) && has_any_word(&text, &["note", "markdown"]) {
        actions.push(json!({"type": "create_markdown_note"}));
    }
    if let Some(action) = parse_shape_creation_action(&text) {
        actions.push(action);
    }
    if has_any_word(&text, &["add", "create"])
        && has_any_word(&text, &["checklist", "task", "tasks"])
    {
        actions.push(json!({"type": "create_task_checklist"}));
    }
    if let Some(action) = parse_zoom_action(&text) {
        actions.push(action);
    }
    if has_any_word(&text, &["arrange", "layout"]) && has_word(&text, "grid") {
        actions.push(json!({"type": "arrange_grid"}));
    }
    if let Some(action) = parse_focus_node_action(&text) {
        actions.push(action);
    }
    if let Some(action) = parse_broadcast_action(&text) {
        actions.push(action);
    }
    if actions.is_empty() {
        actions.push(json!({"type": "unknown", "text": text}));
    }
    ParsedIntentDto {
        id: id("intent"),
        source: req.source,
        transcript: req.transcript,
        confidence: if actions
            .iter()
            .any(|action| action.get("type") != Some(&json!("unknown")))
        {
            0.92
        } else {
            0.46
        },
        requires_confirmation: risk != "safe",
        risk,
        explanation: if actions.len() == 1 && actions[0].get("type") == Some(&json!("unknown")) {
            "No deterministic command matched. Route this to the focused terminal or revise it."
                .to_string()
        } else {
            format!(
                "Parsed {} action{}.",
                actions.len(),
                if actions.len() == 1 { "" } else { "s" }
            )
        },
        actions,
    }
}

pub(crate) fn build_orchestrator_harness_prompt(payload: &Value) -> String {
    let request_id = payload
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let user_request = payload
        .get("userRequest")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let workspace_name = payload
        .get("workspaceName")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let workspace_path = payload
        .get("workspacePath")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let nodes = payload
        .get("nodes")
        .filter(|nodes| nodes.is_array())
        .cloned()
        .unwrap_or_else(|| json!([]));
    let context = json!({
        "requestId": request_id,
        "workspace": { "name": workspace_name, "path": workspace_path },
        "nodes": nodes,
        "tools": orchestrator_tool_contract(),
    });

    [
        "wheeljack orchestrator harness.".to_string(),
        "Choose app tools for the user request. Do not run shell commands for app orchestration. Do not invent tools.".to_string(),
        "Use create_shell_node for plain shells, terminals, PowerShell, zsh, or bash. Use create_agent_nodes only when the request names an AI adapter.".to_string(),
        "Adapter ids: Claude Code=claude-code, Codex=codex-cli, OpenCode=opencode, Pi=pi-coding-agent.".to_string(),
        "Reply with exactly one line:".to_string(),
        r#"wheeljack.tool_plan {"requestId":"...","calls":[{"tool":"arrange_grid","args":{}}],"message":"short status"}"#.to_string(),
        "Path hint: documents/dev, desktop/foo, and downloads/foo should be cwd ~/Documents/dev, ~/Desktop/foo, and ~/Downloads/foo.".to_string(),
        "Use route_terminal_prompts for named running agent panes. Use create_agent_nodes first if requested agent panes do not exist.".to_string(),
        "wheeljack validates and confirms tool calls before execution.".to_string(),
        format!("Context {}", serde_json::to_string(&context).unwrap_or_default()),
        format!("User {}", serde_json::to_string(user_request).unwrap_or_default()),
        String::new(),
        "Local planner rules: prefer the smallest valid tool plan, output no prose, and keep args minimal.".to_string(),
    ]
    .join("\n")
}

fn orchestrator_tool_contract() -> Vec<Value> {
    [
        (
            "create_agent_nodes",
            "{adapterId:string,count?:number,cwd?:string}",
            "local",
            "risk",
            "Create one or more agent terminal panes.",
        ),
        (
            "create_shell_node",
            "{count?:number,cwd?:string}",
            "local",
            "risk",
            "Create one or more shell terminal panes, optionally with a cwd.",
        ),
        (
            "create_markdown_note",
            "{markdown?:string}",
            "local",
            "risk",
            "Create a markdown note pane.",
        ),
        (
            "create_task_checklist",
            "{}",
            "local",
            "risk",
            "Create a task checklist pane.",
        ),
        (
            "create_shape_node",
            "{shape?:'rectangle'|'circle'|'diamond'}",
            "local",
            "risk",
            "Create a shape pane.",
        ),
        (
            "create_browser_node",
            "{url:string}",
            "local",
            "risk",
            "Create a browser preview pane.",
        ),
        (
            "create_focus_widget",
            "{}",
            "local",
            "risk",
            "Create a focus mini-app pane.",
        ),
        (
            "switch_theme",
            "{themeId:'mono-dark'|'mono-light'}",
            "local",
            "risk",
            "Switch the workspace theme.",
        ),
        (
            "zoom",
            "{scale:number}",
            "local",
            "risk",
            "Adjust the workspace zoom level.",
        ),
        (
            "arrange_grid",
            "{}",
            "local",
            "risk",
            "Arrange panes into the workspace grid.",
        ),
        (
            "reset_pane",
            "{query:string}",
            "local",
            "risk",
            "Reset a matching pane to its default size.",
        ),
        (
            "create_workspace",
            "{name?:string}",
            "local",
            "risk",
            "Create a project workspace.",
        ),
        (
            "rename_workspace",
            "{name:string}",
            "local",
            "risk",
            "Rename the current workspace.",
        ),
        (
            "switch_workspace",
            "{query:string}",
            "local",
            "risk",
            "Switch to a matching workspace.",
        ),
        (
            "move_workspace",
            "{direction:'left'|'right'}",
            "local",
            "risk",
            "Move the current workspace left or right.",
        ),
        (
            "reset_workspaces",
            "{}",
            "local",
            "always",
            "Reset all workspaces in the current project after desktop confirmation.",
        ),
        (
            "delete_workspace",
            "{}",
            "local",
            "always",
            "Delete the current workspace after desktop confirmation.",
        ),
        (
            "focus_node",
            "{query:string}",
            "local",
            "risk",
            "Focus a matching pane.",
        ),
        (
            "broadcast_prompt",
            "{prompt:string}",
            "backend",
            "always",
            "Broadcast a prompt to agent panes.",
        ),
        (
            "route_terminal_prompts",
            "{assignments:[{target:string,task:string}]}",
            "backend",
            "always",
            "Route targeted prompts to named running agent terminals.",
        ),
    ]
    .into_iter()
    .map(|(tool, args, execution, confirmation, description)| {
        json!({
            "tool": tool,
            "args": args,
            "execution": execution,
            "confirmation": confirmation,
            "description": description,
        })
    })
    .collect()
}

pub(crate) fn parse_local_orchestrator_tool_plans(text: &str, request_id: &str) -> Vec<Value> {
    let marked = parse_orchestrator_tool_plan_markers(text);
    if !marked.is_empty() {
        return marked;
    }

    let trimmed = strip_json_fence(text.trim());
    if !trimmed.starts_with('{') && !trimmed.starts_with('[') {
        return Vec::new();
    }

    if trimmed.starts_with('{') {
        let mut direct =
            parse_orchestrator_tool_plan_markers(&format!("{TOOL_PLAN_MARKER} {trimmed}"));
        for plan in &mut direct {
            if plan
                .get("requestId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .is_empty()
            {
                plan["requestId"] = json!(request_id);
            }
        }
        direct.retain(|plan| {
            plan.get("calls")
                .and_then(Value::as_array)
                .is_some_and(|calls| !calls.is_empty())
        });
        if !direct.is_empty() {
            return direct;
        }
    }

    serde_json::from_str::<Value>(trimmed)
        .ok()
        .and_then(|payload| normalize_native_planner_payload(&payload, request_id))
        .into_iter()
        .collect()
}

pub(crate) fn planner_tool_plan_to_intent(
    plan: &Value,
    transcript: &str,
    source: &str,
) -> ParsedIntentDto {
    let actions: Vec<Value> = plan
        .get("calls")
        .and_then(Value::as_array)
        .map(|calls| {
            calls
                .iter()
                .filter_map(planner_call_to_action)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let risk = if actions.iter().any(planner_action_requires_confirmation) {
        "caution".to_string()
    } else if actions.is_empty() {
        "safe".to_string()
    } else {
        classify_risk(transcript)
    };
    ParsedIntentDto {
        id: id("intent"),
        source: source.to_string(),
        transcript: transcript.to_string(),
        confidence: if actions.is_empty() { 0.46 } else { 0.9 },
        requires_confirmation: risk != "safe",
        risk,
        explanation: if actions.is_empty() {
            "Local planner returned no executable wheeljack tool calls.".to_string()
        } else if let Some(message) = plan.get("message").and_then(Value::as_str) {
            message.to_string()
        } else {
            format!(
                "Accepted {} tool call{} from wheeljack orchestrator.",
                actions.len(),
                if actions.len() == 1 { "" } else { "s" }
            )
        },
        actions,
    }
}

fn planner_call_to_action(call: &Value) -> Option<Value> {
    let tool = call.get("tool")?.as_str()?.trim();
    let args = call
        .get("args")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    match tool {
        "create_agent_nodes" => Some(json_object_without_nulls([
            ("type", json!("create_agent_nodes")),
            (
                "adapterId",
                json!(string_arg(&args, "adapterId").unwrap_or_else(|| "codex-cli".to_string())),
            ),
            ("count", json!(count_arg(&args, "count", 1, 6))),
            (
                "cwd",
                optional_json_string(
                    string_arg(&args, "cwd").or_else(|| string_arg(&args, "path")),
                ),
            ),
        ])),
        "create_shell_node" => Some(json_object_without_nulls([
            ("type", json!("create_shell_node")),
            ("count", json!(count_arg(&args, "count", 1, 12))),
            (
                "cwd",
                optional_json_string(
                    string_arg(&args, "cwd").or_else(|| string_arg(&args, "path")),
                ),
            ),
        ])),
        "create_markdown_note" => Some(json_object_without_nulls([
            ("type", json!("create_markdown_note")),
            (
                "markdown",
                optional_json_string(string_arg(&args, "markdown")),
            ),
        ])),
        "create_task_checklist"
        | "create_focus_widget"
        | "arrange_grid"
        | "reset_workspaces"
        | "delete_workspace" => Some(json!({ "type": tool })),
        "reset_pane" => Some(json!( {
            "type": "reset_pane",
            "query": string_arg(&args, "query").unwrap_or_default(),
        })),
        "create_shape_node" => Some(json_object_without_nulls([
            ("type", json!("create_shape_node")),
            (
                "shape",
                optional_json_string(
                    string_arg(&args, "shape")
                        .or_else(|| string_arg(&args, "kind"))
                        .or_else(|| string_arg(&args, "variant")),
                ),
            ),
        ])),
        "create_workspace" | "rename_workspace" => Some(json_object_without_nulls([
            ("type", json!(tool)),
            ("name", optional_json_string(string_arg(&args, "name"))),
        ])),
        "switch_workspace" => Some(json_object_without_nulls([
            ("type", json!("switch_workspace")),
            ("query", optional_json_string(string_arg(&args, "query"))),
        ])),
        "move_workspace" => Some(json_object_without_nulls([
            ("type", json!("move_workspace")),
            (
                "direction",
                optional_json_string(string_arg(&args, "direction")),
            ),
        ])),
        "create_browser_node" => Some(json!({
            "type": "create_browser_node",
            "url": string_arg(&args, "url").unwrap_or_default(),
        })),
        "switch_theme" => {
            let theme_id = string_arg(&args, "themeId")?;
            if theme_id == "mono-light" || theme_id == "mono-dark" {
                Some(json!({
                    "type": "switch_theme",
                    "themeId": theme_id,
                }))
            } else {
                None
            }
        }
        "zoom" => Some(json!({
            "type": "zoom",
            "scale": number_arg(&args, "scale")?,
        })),
        "focus_node" => Some(json!({
            "type": "focus_node",
            "query": string_arg(&args, "query")?,
        })),
        "broadcast_prompt" => Some(json!({
            "type": "broadcast_prompt",
            "prompt": string_arg(&args, "prompt").unwrap_or_default(),
        })),
        "route_terminal_prompts" => {
            let assignments: Vec<Value> = args
                .get("assignments")
                .and_then(Value::as_array)?
                .iter()
                .filter_map(|item| {
                    let target = item.get("target")?.as_str()?.trim();
                    let task = item.get("task")?.as_str()?.trim();
                    if target.is_empty() || task.is_empty() {
                        return None;
                    }
                    Some(json!({ "target": target, "task": task }))
                })
                .collect();
            if assignments.is_empty() {
                None
            } else {
                Some(json!({ "type": "route_terminal_prompts", "assignments": assignments }))
            }
        }
        _ => None,
    }
}

fn planner_action_requires_confirmation(action: &Value) -> bool {
    matches!(
        action
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "delete_workspace" | "broadcast_prompt" | "route_terminal_prompts"
    )
}

fn optional_json_string(value: Option<String>) -> Value {
    value
        .filter(|value| !value.trim().is_empty())
        .map(Value::String)
        .unwrap_or(Value::Null)
}

pub(crate) fn json_object_without_nulls<const N: usize>(items: [(&str, Value); N]) -> Value {
    let mut object = serde_json::Map::new();
    for (key, value) in items {
        if !value.is_null() {
            object.insert(key.to_string(), value);
        }
    }
    Value::Object(object)
}

fn count_arg(
    args: &serde_json::Map<String, Value>,
    key: &str,
    fallback: usize,
    max: usize,
) -> usize {
    args.get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .map(|value| value.round().clamp(1.0, max as f64) as usize)
        .unwrap_or(fallback)
}

fn number_arg(args: &serde_json::Map<String, Value>, key: &str) -> Option<f64> {
    args.get(key).and_then(Value::as_f64)
}

fn parse_orchestrator_tool_plan_markers(text: &str) -> Vec<Value> {
    let mut plans = Vec::new();
    for line in text.lines() {
        let Some((index, marker)) = [TOOL_PLAN_MARKER, LEGACY_TOOL_PLAN_MARKER]
            .into_iter()
            .find_map(|marker| line.find(marker).map(|index| (index, marker)))
        else {
            continue;
        };
        let raw = line[index + marker.len()..].trim();
        if !raw.starts_with('{') {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<Value>(raw) else {
            continue;
        };
        let request_id = parsed
            .get("requestId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let calls = parsed
            .get("calls")
            .and_then(Value::as_array)
            .map(|calls| {
                calls
                    .iter()
                    .filter_map(normalize_marker_tool_call)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if calls.is_empty() {
            continue;
        }
        let mut plan = serde_json::Map::new();
        plan.insert(
            "id".to_string(),
            json!(format!(
                "{}:{raw}",
                if request_id.is_empty() {
                    "request"
                } else {
                    request_id
                }
            )),
        );
        plan.insert("requestId".to_string(), json!(request_id));
        if let Some(message) = parsed.get("message").and_then(Value::as_str) {
            plan.insert("message".to_string(), json!(message));
        }
        plan.insert("calls".to_string(), json!(calls));
        plans.push(Value::Object(plan));
    }
    plans
}

fn strip_json_fence(text: &str) -> &str {
    let text = text.trim();
    let text = text
        .strip_prefix("```json")
        .or_else(|| text.strip_prefix("```JSON"))
        .or_else(|| text.strip_prefix("```"))
        .unwrap_or(text)
        .trim();
    text.strip_suffix("```").unwrap_or(text).trim()
}

fn normalize_marker_tool_call(call: &Value) -> Option<Value> {
    let object = call.as_object()?;
    let tool = object.get("tool")?.as_str()?.trim();
    if tool.is_empty() {
        return None;
    }
    let args = object
        .get("args")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    Some(json!({ "tool": tool, "args": Value::Object(args) }))
}

fn normalize_native_planner_payload(payload: &Value, request_id: &str) -> Option<Value> {
    let raw_calls = if let Some(array) = payload.as_array() {
        array.clone()
    } else if let Some(calls) = payload.get("calls").and_then(Value::as_array) {
        calls.clone()
    } else if payload.is_object() {
        vec![payload.clone()]
    } else {
        Vec::new()
    };
    let calls: Vec<Value> = raw_calls
        .iter()
        .filter_map(normalize_native_tool_call)
        .collect();
    if calls.is_empty() {
        return None;
    }

    let plan_request_id = payload
        .get("requestId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(request_id);
    let mut plan = serde_json::Map::new();
    plan.insert(
        "id".to_string(),
        json!(format!(
            "{}:native:{}",
            plan_request_id,
            serde_json::to_string(&calls).unwrap_or_default()
        )),
    );
    plan.insert("requestId".to_string(), json!(plan_request_id));
    if let Some(message) = payload.get("message").and_then(Value::as_str) {
        plan.insert("message".to_string(), json!(message));
    }
    plan.insert("calls".to_string(), json!(calls));
    Some(Value::Object(plan))
}

fn normalize_native_tool_call(call: &Value) -> Option<Value> {
    let object = call.as_object()?;
    let function = object.get("function").and_then(Value::as_object);
    let tool = object
        .get("tool")
        .and_then(Value::as_str)
        .or_else(|| object.get("name").and_then(Value::as_str))
        .or_else(|| function.and_then(|function| function.get("name").and_then(Value::as_str)))?
        .trim();
    if !is_local_planner_tool_name(tool) {
        return None;
    }
    let args = parse_tool_args(
        object
            .get("args")
            .or_else(|| object.get("arguments"))
            .or_else(|| function.and_then(|function| function.get("arguments"))),
    )
    .unwrap_or_default();
    Some(json!({
        "tool": tool,
        "args": normalize_planner_args(tool, args),
    }))
}

fn parse_tool_args(value: Option<&Value>) -> Option<serde_json::Map<String, Value>> {
    match value? {
        Value::Object(map) => Some(map.clone()),
        Value::String(text) => serde_json::from_str::<Value>(text)
            .ok()
            .and_then(|value| value.as_object().cloned()),
        _ => None,
    }
}

fn normalize_planner_args(tool: &str, mut args: serde_json::Map<String, Value>) -> Value {
    if tool == "create_agent_nodes" {
        let adapter_hint = string_arg(&args, "adapterId")
            .filter(|value| !is_agent_adapter_id(value))
            .or_else(|| string_arg(&args, "adapter"))
            .or_else(|| string_arg(&args, "adapterName"))
            .or_else(|| string_arg(&args, "agent"))
            .or_else(|| string_arg(&args, "agentName"));
        if let Some(adapter_id) = adapter_hint.and_then(|hint| agent_adapter_id_for_alias(&hint)) {
            args.insert("adapterId".to_string(), json!(adapter_id));
        }
    }
    Value::Object(args)
}

fn string_arg(args: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn is_local_planner_tool_name(tool: &str) -> bool {
    matches!(
        tool,
        "create_agent_nodes"
            | "create_shell_node"
            | "create_markdown_note"
            | "create_task_checklist"
            | "create_shape_node"
            | "create_browser_node"
            | "create_focus_widget"
            | "switch_theme"
            | "zoom"
            | "arrange_grid"
            | "reset_pane"
            | "create_workspace"
            | "rename_workspace"
            | "switch_workspace"
            | "move_workspace"
            | "reset_workspaces"
            | "delete_workspace"
            | "focus_node"
            | "broadcast_prompt"
            | "route_terminal_prompts"
    )
}

fn is_agent_adapter_id(value: &str) -> bool {
    AGENT_INTENT_ADAPTERS
        .iter()
        .any(|adapter| adapter.adapter_id == value)
}

fn agent_adapter_id_for_alias(value: &str) -> Option<&'static str> {
    let normalized = value.to_lowercase().replace('-', " ");
    AGENT_INTENT_ADAPTERS
        .iter()
        .find(|adapter| {
            adapter
                .aliases
                .iter()
                .any(|alias| contains_agent_alias(&normalized, alias))
        })
        .map(|adapter| adapter.adapter_id)
}

pub(crate) fn detect_local_preview_url(text: &str) -> Option<String> {
    detect_local_preview_urls(text).into_iter().next()
}

pub(crate) fn detect_local_preview_urls(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut urls = Vec::new();
    let text = strip_terminal_control_sequences(text);
    for line in text.split(['\r', '\n']) {
        let lower = line.to_lowercase();
        let trimmed = lower.trim_start();
        if trimmed.starts_with("user ->")
            || trimmed.starts_with("mobile ->")
            || lower.contains("opencode_server_password")
            || lower.contains("chat/completions")
            || lower.contains("opencode server listening on http://127.0.0.1:")
            || lower.contains("opencode server listening on https://127.0.0.1:")
        {
            continue;
        }

        for marker in [
            "http://localhost",
            "https://localhost",
            "localhost",
            "http://127.0.0.1",
            "https://127.0.0.1",
            "127.0.0.1",
            "http://0.0.0.0",
            "https://0.0.0.0",
            "0.0.0.0",
            "http://[::1]",
            "https://[::1]",
            "[::1]",
        ] {
            let mut search_from = 0;
            while let Some(relative) = lower[search_from..].find(marker) {
                let start = search_from + relative;
                let end = line[start..]
                    .find(|ch: char| {
                        ch.is_whitespace() || matches!(ch, '<' | '>' | '"' | '\'' | '`')
                    })
                    .map(|offset| start + offset)
                    .unwrap_or(line.len());
                let candidate = line[start..end].trim_end_matches([')', ',', '.', ';']);
                if let Some(url) = normalize_local_preview_url(candidate) {
                    if seen.insert(url.clone()) {
                        urls.push(url);
                    }
                }
                search_from = start + marker.len();
            }
        }
    }
    urls
}

pub(crate) fn strip_terminal_control_sequences(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\x1b' {
            output.push(ch);
            continue;
        }
        match chars.next() {
            Some('[') => {
                for next in chars.by_ref() {
                    if ('@'..='~').contains(&next) {
                        break;
                    }
                }
            }
            Some(']') => {
                let mut saw_escape = false;
                for next in chars.by_ref() {
                    if next == '\x07' || (saw_escape && next == '\\') {
                        break;
                    }
                    saw_escape = next == '\x1b';
                }
            }
            Some(other) => output.push(other),
            None => {}
        }
    }
    output
}

fn normalize_local_preview_url(candidate: &str) -> Option<String> {
    let candidate_lower = candidate.to_lowercase();
    let mut url =
        if candidate_lower.starts_with("http://") || candidate_lower.starts_with("https://") {
            candidate.to_string()
        } else {
            format!("http://{candidate}")
        };
    url = url.replacen("://0.0.0.0", "://127.0.0.1", 1);
    let url_lower = url.to_lowercase();
    let after_scheme = if url_lower.starts_with("http://") {
        &url[7..]
    } else if url_lower.starts_with("https://") {
        &url[8..]
    } else {
        return None;
    };
    let authority_end = after_scheme
        .find(['/', '?', '#'])
        .unwrap_or(after_scheme.len());
    let authority = &after_scheme[..authority_end];
    let authority_lower = authority.to_lowercase();
    let path = &after_scheme[authority_end..];
    let port = authority_lower
        .strip_prefix("[::1]:")
        .or_else(|| authority_lower.strip_prefix("localhost:"))
        .or_else(|| authority_lower.strip_prefix("127.0.0.1:"))?;
    if !(2..=5).contains(&port.len()) || !port.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    let path_lower = path.to_lowercase();
    if ["/mcp", "/jsonrpc", "/rpc", "/sse", "/events", "/v1"]
        .iter()
        .any(|prefix| path_lower == *prefix || path_lower.starts_with(&format!("{prefix}/")))
    {
        return None;
    }
    if authority_end == after_scheme.len() {
        url.push('/');
    }
    Some(url)
}

fn classify_risk(text: &str) -> String {
    let lower = text.to_lowercase();
    let dangerous = ["diskpart", "worktree remove"];
    if dangerous.iter().any(|pattern| lower.contains(pattern))
        || has_token_sequence(&lower, &["rm", "-rf"])
        || has_token_sequence(&lower, &["del", "/s"])
        || has_token_sequence(&lower, &["rmdir", "/s"])
        || has_token_sequence(&lower, &["git", "reset", "--hard"])
        || has_token_sequence(&lower, &["git", "clean", "-fd"])
        || has_word(&lower, "format")
        || (lower.contains("remove-item") && lower.contains("-recurse") && lower.contains("-force"))
        || ((has_word(&lower, "curl") || has_word(&lower, "wget"))
            && [".env", ".pem", ".key"]
                .iter()
                .any(|extension| lower.contains(extension)))
    {
        "dangerous".to_string()
    } else if has_any_word(&lower, &["kill", "recipe", "launch", "run", "send", "ask"])
        || lower.contains("stop-process")
    {
        "caution".to_string()
    } else {
        "safe".to_string()
    }
}

fn has_token_sequence(text: &str, sequence: &[&str]) -> bool {
    if sequence.is_empty() {
        return false;
    }
    text.split_whitespace()
        .collect::<Vec<_>>()
        .windows(sequence.len())
        .any(|window| window == sequence)
}
