use super::*;

pub(crate) fn unwrap_settings_payload(payload: Value) -> Value {
    if let Some(settings) = payload
        .get("settings")
        .filter(|value| value.is_object())
        .cloned()
    {
        settings
    } else if let Some(settings) = payload
        .get("workspace")
        .and_then(|workspace| workspace.get("settings"))
        .filter(|value| value.is_object())
        .cloned()
    {
        settings
    } else {
        payload
    }
}

pub(crate) fn settings_adapter_payload(payload: &Value) -> Option<&Value> {
    payload.get("adapters").or_else(|| {
        payload
            .get("workspace")
            .and_then(|workspace| workspace.get("adapters"))
    })
}

pub(crate) fn settings_theme_payload(payload: &Value) -> Option<&Value> {
    payload.get("themeId").or_else(|| {
        payload
            .get("workspace")
            .and_then(|workspace| workspace.get("themeId"))
    })
}

pub(crate) fn sanitize_setting_value(key: &str, value: &Value) -> Option<Value> {
    match key {
        "reducedMotion"
        | "telemetry"
        | "destructiveConfirmations"
        | "confirmPaneDeletion"
        | "experimentalStructuredChat"
        | "autoUpdateEnabled"
        | "notificationsEnabled"
        | "backgroundVideoEnabled"
        | "backgroundVideoColorEnabled" => value.as_bool().map(Value::Bool),
        "appFontFamily" => sanitize_font_family_value(
            value,
            "\"Inter\", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
        ),
        "monoFontFamily" => sanitize_font_family_value(
            value,
            "\"JetBrains Mono\", \"Cascadia Code\", \"SFMono-Regular\", ui-monospace, Consolas, monospace",
        ),
        "chatFontScale" => clamp_number_setting(value, 0.9, 1.25),
        "fontScale" => clamp_number_setting(value, 0.85, 1.2),
        "nodeOpacity" => clamp_number_setting(value, 0.6, 0.92),
        "backgroundOverlayOpacity" => clamp_number_setting(value, 0.0, 0.85),
        "chatBubbleWidthCh" => clamp_number_setting(value, 52.0, 88.0),
        "chatBubbleDensity" => value.as_str().map(|density| match density {
            "compact" | "cozy" | "roomy" => json!(density),
            _ => json!("cozy"),
        }),
        "theme" => value.as_str().and_then(|theme| {
            if matches!(theme, "mono-dark" | "mono-light") {
                Some(json!(theme))
            } else {
                None
            }
        }),
        "accentColor" => value
            .as_str()
            .filter(|color| is_hex_color(color))
            .map(|color| json!(color)),
        "browserHomeUrl" => value
            .as_str()
            .map(|url| json!(normalize_browser_url(&truncate_chars(url, 2048)))),
        "defaultTerminalCwd" | "backgroundVideoUrl" => {
            value.as_str().map(|text| json!(truncate_chars(text, 2048)))
        }
        "autoUpdateLastCheckedAt" => value.as_str().map(|text| json!(truncate_chars(text, 128))),
        "sessionTranscriptRetentionBytes" => {
            clamp_number_setting(value, 1_048_576.0, 104_857_600.0)
        }
        "desktopOnboardingVersion" => value
            .as_u64()
            .and_then(|version| u16::try_from(version).ok())
            .map(|version| json!(version)),
        "selectedAgentAdapterId" => value
            .as_str()
            .filter(|adapter_id| {
                !adapter_id.is_empty()
                    && adapter_id.len() <= 80
                    && adapter_id
                        .chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
            })
            .map(|adapter_id| json!(adapter_id)),
        "agentProfiles" => sanitize_agent_profiles(value),
        "agentAutonomyPolicy" => sanitize_agent_autonomy_policy(value),
        "usageBillingOverrides" => sanitize_usage_billing_overrides(value),
        "desktopUiPreferences" => sanitize_desktop_ui_preferences(value),
        "workspaceBackground" => Some(sanitize_workspace_background(value)),
        "shortcuts" => sanitize_shortcut_settings(value),
        "commandHistory" => sanitize_command_history(value),
        _ => None,
    }
}

fn sanitize_agent_autonomy_policy(value: &Value) -> Option<Value> {
    let source = value.as_object()?;
    let mode = |key: &str| match source.get(key).and_then(Value::as_str) {
        Some("allow") | None => "allow",
        Some("ask") => "ask",
        Some("deny") => "deny",
        _ => "deny",
    };
    let bounded = |key: &str, fallback: u64, max: u64| {
        source
            .get(key)
            .and_then(Value::as_u64)
            .unwrap_or(fallback)
            .clamp(1, max)
    };
    Some(json!({
        "enabled": source.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        "listAgents": mode("listAgents"),
        "sendMessage": mode("sendMessage"),
        "spawnAgent": mode("spawnAgent"),
        "handoffTask": mode("handoffTask"),
        "requestReview": mode("requestReview"),
        "resolveFileConflict": mode("resolveFileConflict"),
        "maxDepth": bounded("maxDepth", 2, 4),
        "maxChildrenPerAgent": bounded("maxChildrenPerAgent", 3, 8),
        "maxConcurrentAgents": bounded("maxConcurrentAgents", 8, 16),
        "maxActionsPerMinute": bounded("maxActionsPerMinute", 20, 60),
    }))
}

fn sanitize_desktop_ui_preferences(value: &Value) -> Option<Value> {
    let source = value.as_object()?;
    let theme = match source.get("theme").and_then(Value::as_str) {
        Some("paper") => "paper",
        _ => "graphite",
    };
    Some(json!({
        "theme": theme,
        "appearanceMode": match source.get("appearanceMode").and_then(Value::as_str) {
            Some("system") => "system",
            _ => "fixed",
        },
        "fixedThemeId": safe_theme_id(source.get("fixedThemeId"), "mono-dark"),
        "systemLightThemeId": safe_theme_id(source.get("systemLightThemeId"), "mono-light"),
        "systemDarkThemeId": safe_theme_id(source.get("systemDarkThemeId"), "mono-dark"),
        "customThemes": source.get("customThemes")
            .and_then(Value::as_array)
            .map(|themes| themes.iter().take(64).filter_map(sanitize_custom_theme).collect::<Vec<_>>())
            .unwrap_or_default(),
        "showStickerLensBackground": source.get("showStickerLensBackground").and_then(Value::as_bool).unwrap_or(true),
        "headingFontFamily": sanitize_font_family_value(
            source.get("headingFontFamily").unwrap_or(&Value::Null),
            "Geist Pixel"
        ).and_then(|value| value.as_str().map(str::to_owned)).unwrap_or_else(|| "Geist Pixel".to_owned()),
        "uiFontFamily": sanitize_font_family_value(
            source.get("uiFontFamily").unwrap_or(&Value::Null),
            "Segoe UI Variable Text"
        ).and_then(|value| value.as_str().map(str::to_owned)).unwrap_or_else(|| "Segoe UI Variable Text".to_owned()),
        "codeFontFamily": sanitize_font_family_value(
            source.get("codeFontFamily").unwrap_or(&Value::Null),
            "Cascadia Mono"
        ).and_then(|value| value.as_str().map(str::to_owned)).unwrap_or_else(|| "Cascadia Mono".to_owned()),
        "uiScale": finite_number(source.get("uiScale"), 1.0).clamp(0.5, 2.0),
        "uiFontSize": finite_number(source.get("uiFontSize"), 13.0).clamp(10.0, 16.0).round() as i64,
        "terminalFontSize": finite_number(source.get("terminalFontSize"), 13.0).clamp(10.0, 22.0).round() as i64,
        "sidebarCollapsed": source.get("sidebarCollapsed").and_then(Value::as_bool).unwrap_or(false),
        "expandedProjectIds": source.get("expandedProjectIds")
            .and_then(Value::as_array)
            .map(|ids| ids.iter()
                .filter_map(Value::as_str)
                .map(|id| truncate_chars(id, 128))
                .filter(|id| !id.is_empty())
                .take(128)
            .collect::<Vec<_>>())
            .unwrap_or_default(),
        "floorRailWidthByProject": sanitize_floor_rail_widths(source.get("floorRailWidthByProject")),
        "sidebarWidth": finite_number(source.get("sidebarWidth"), 240.0).clamp(176.0, 320.0).round() as i64,
        "utilityPanelWidth": finite_number(source.get("utilityPanelWidth"), 400.0).clamp(320.0, 560.0).round() as i64,
        "utilityPanelTab": match source.get("utilityPanelTab").and_then(Value::as_str) {
            Some("git") => "git",
            Some("history") => "history",
            _ => "inbox",
        },
        "paneHeaderHeight": finite_number(source.get("paneHeaderHeight"), 28.0).clamp(24.0, 44.0).round() as i64,
        "showSuggestions": source.get("showSuggestions").and_then(Value::as_bool).unwrap_or(true),
        "showPaneActions": source.get("showPaneActions").and_then(Value::as_bool).unwrap_or(true),
        "showProjectPaths": source.get("showProjectPaths").and_then(Value::as_bool).unwrap_or(true),
        "showRecentActivity": source.get("showRecentActivity").and_then(Value::as_bool).unwrap_or(true),
        "showAgentRail": source.get("showAgentRail").and_then(Value::as_bool).unwrap_or(true),
    }))
}

fn sanitize_floor_rail_widths(value: Option<&Value>) -> Value {
    let mut widths = serde_json::Map::new();
    let Some(source) = value.and_then(Value::as_object) else {
        return Value::Object(widths);
    };
    for (project_id, value) in source.iter().take(128) {
        let Some(width) = value.as_f64().filter(|width| width.is_finite()) else {
            continue;
        };
        if project_id.is_empty() || project_id.len() > 128 {
            continue;
        }
        widths.insert(
            project_id.clone(),
            json!(width.clamp(300.0, 560.0).round() as i64),
        );
    }
    Value::Object(widths)
}

fn safe_theme_id(value: Option<&Value>, fallback: &str) -> String {
    value
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
        .unwrap_or(fallback)
        .to_owned()
}

fn sanitize_custom_theme(value: &Value) -> Option<Value> {
    let theme = value.as_object()?;
    let id = safe_theme_id(theme.get("id"), "");
    if id.is_empty() {
        return None;
    }
    let name = theme.get("name")?.as_str()?.trim();
    if name.is_empty() || name.len() > 128 {
        return None;
    }
    let variant = match theme.get("variant")?.as_str()? {
        "dark" => "dark",
        "light" => "light",
        _ => return None,
    };
    let seed = theme.get("seed")?.as_object()?;
    let seed_keys = [
        "canvas", "surface", "text", "muted", "accent", "success", "warning", "danger",
    ];
    let mut clean_seed = serde_json::Map::new();
    for key in seed_keys {
        clean_seed.insert(key.to_owned(), json!(theme_color(seed.get(key)?)?));
    }
    let terminal = theme.get("terminal")?.as_object()?;
    let ansi = terminal.get("ansi")?.as_array()?;
    if ansi.len() != 16 {
        return None;
    }
    let clean_ansi = ansi
        .iter()
        .map(|color| theme_color(color).map(|color| json!(color)))
        .collect::<Option<Vec<_>>>()?;
    let mut clean_overrides = serde_json::Map::new();
    if let Some(overrides) = theme.get("overrides").and_then(Value::as_object) {
        for (key, value) in overrides {
            if theme_token(key) {
                clean_overrides.insert(key.clone(), json!(theme_color(value)?));
            }
        }
    }
    Some(json!({
        "id": id,
        "name": name,
        "description": truncate_chars(theme.get("description").and_then(Value::as_str).unwrap_or("custom"), 512),
        "variant": variant,
        "isBuiltIn": false,
        "basedOnId": theme.get("basedOnId").and_then(Value::as_str).map(|value| truncate_chars(value, 128)),
        "seed": clean_seed,
        "overrides": clean_overrides,
        "terminal": {
            "foreground": theme_color(terminal.get("foreground")?)?,
            "background": theme_color(terminal.get("background")?)?,
            "cursor": theme_color(terminal.get("cursor")?)?,
            "selection": theme_color(terminal.get("selection")?)?,
            "ansi": clean_ansi,
        },
    }))
}

fn theme_color(value: &Value) -> Option<&str> {
    value.as_str().filter(|color| is_hex_color(color))
}

fn theme_token(value: &str) -> bool {
    matches!(
        value,
        "canvas"
            | "chrome"
            | "sidebar"
            | "surface"
            | "raised"
            | "hover"
            | "selected"
            | "divider"
            | "border"
            | "borderStrong"
            | "text"
            | "muted"
            | "subtle"
            | "accent"
            | "accentHover"
            | "accentPressed"
            | "accentSoft"
            | "accentForeground"
            | "success"
            | "warning"
            | "danger"
            | "paneHeader"
            | "composer"
            | "brandInk"
            | "terminalBackground"
            | "terminalForeground"
            | "cursor"
            | "selection"
    )
}

fn sanitize_agent_profiles(value: &Value) -> Option<Value> {
    let profiles = value.as_array()?;
    let mut sanitized = Vec::new();
    let mut adapter_ids = HashSet::new();
    for profile in profiles.iter().take(16) {
        let profile = profile.as_object()?;
        let adapter_id = profile.get("adapterId")?.as_str()?;
        if !matches!(
            adapter_id,
            "codex-cli" | "claude-code" | "opencode" | "pi-coding-agent"
        ) || !adapter_ids.insert(adapter_id)
        {
            continue;
        }
        let provider = profile.get("provider")?.as_str()?;
        let model = profile.get("model")?.as_str()?;
        let thinking = profile.get("thinking")?.as_str()?;
        let approval_policy = profile.get("approvalPolicy")?.as_str()?;
        if !safe_agent_token(provider, 64)
            || !safe_agent_token(model, 128)
            || !matches!(
                thinking,
                "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
            )
            || !(approval_policy.is_empty() || safe_agent_token(approval_policy, 32))
        {
            continue;
        }
        sanitized.push(json!({
            "adapterId": adapter_id,
            "provider": provider,
            "model": model,
            "thinking": thinking,
            "approvalPolicy": approval_policy,
        }));
    }
    Some(Value::Array(sanitized))
}

pub(crate) fn safe_agent_token(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(byte, b'.' | b'_' | b':' | b'/' | b'~' | b'+' | b'-')
        })
}

fn sanitize_font_family_value(value: &Value, fallback: &str) -> Option<Value> {
    let text = value.as_str()?;
    let trimmed = text.trim();
    let safe = trimmed.len() <= 200
        && !trimmed
            .chars()
            .any(|ch| matches!(ch, '@' | ';' | '{' | '}' | '<' | '>' | '\\' | '\r' | '\n'))
        && !trimmed.to_ascii_lowercase().contains("url(");
    Some(json!(if safe && !trimmed.is_empty() {
        trimmed
    } else {
        fallback
    }))
}

fn clamp_number_setting(value: &Value, min: f64, max: f64) -> Option<Value> {
    value
        .as_f64()
        .filter(|value| value.is_finite())
        .map(|value| {
            let clamped = value.clamp(min, max);
            if clamped.fract() == 0.0 {
                json!(clamped as i64)
            } else {
                json!(clamped)
            }
        })
}

pub(crate) fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|ch| ch.is_ascii_hexdigit())
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

#[cfg(test)]
mod desktop_ui_tests {
    use super::sanitize_setting_value;
    use serde_json::json;

    #[test]
    fn desktop_ui_preferences_are_bounded_and_drop_unknown_fields() {
        let value = sanitize_setting_value(
            "desktopUiPreferences",
            &json!({
                "theme": "paper",
                "headingFontFamily": "Geist Pixel",
                "uiFontFamily": "Segoe UI Variable Text",
                "codeFontFamily": "Bad; url(evil)",
                "uiScale": 9,
                "uiFontSize": 99,
                "terminalFontSize": 4,
                "sidebarCollapsed": true,
                "expandedProjectIds": ["project-a", 42, "", "project-b"],
                "floorRailWidthByProject": {
                    "project-a": 420,
                    "project-b": 900,
                    "": 360,
                    "invalid": "wide"
                },
                "sidebarWidth": 999,
                "utilityPanelWidth": 999,
                "utilityPanelTab": "unknown",
                "paneHeaderHeight": 2,
                "showStickerLensBackground": false,
                "showComposer": false,
                "unknown": "discard"
            }),
        )
        .expect("desktop UI settings");

        assert_eq!(value["theme"], "paper");
        assert_eq!(value["uiFontSize"], 16);
        assert_eq!(value["terminalFontSize"], 10);
        assert_eq!(value["sidebarCollapsed"], true);
        assert_eq!(
            value["expandedProjectIds"],
            json!(["project-a", "project-b"])
        );
        assert_eq!(
            value["floorRailWidthByProject"],
            json!({ "project-a": 420, "project-b": 560 })
        );
        assert_eq!(value["sidebarWidth"], 320);
        assert_eq!(value["utilityPanelWidth"], 560);
        assert_eq!(value["utilityPanelTab"], "inbox");
        assert_eq!(value["paneHeaderHeight"], 24);
        assert_eq!(value["showStickerLensBackground"], false);
        assert_eq!(value["headingFontFamily"], "Geist Pixel");
        assert_eq!(value["uiScale"], 2.0);
        assert!(value.get("showComposer").is_none());
        assert_eq!(value["codeFontFamily"], "Cascadia Mono");
        assert!(value.get("unknown").is_none());
    }

    #[test]
    fn desktop_ui_preferences_keep_only_complete_custom_themes() {
        let terminal = json!({
            "foreground": "#F5F5F5", "background": "#0A0A0A",
            "cursor": "#FFFFFF", "selection": "#333333",
            "ansi": (0..16).map(|_| "#111111").collect::<Vec<_>>()
        });
        let value = sanitize_setting_value(
            "desktopUiPreferences",
            &json!({
                "customThemes": [{
                    "id": "custom-one", "name": "Custom", "description": "test",
                    "variant": "dark", "isBuiltIn": true, "basedOnId": "mono-dark",
                    "seed": {
                        "canvas": "#0A0A0A", "surface": "#171717", "text": "#F5F5F5",
                        "muted": "#A3A3A3", "accent": "#FFFFFF", "success": "#8BD5B0",
                        "warning": "#D5B86B", "danger": "#E78284"
                    },
                    "overrides": { "border": "#222222", "unknown": "#333333" },
                    "terminal": terminal
                }, { "id": "broken" }]
            }),
        )
        .expect("desktop UI settings");
        assert_eq!(value["customThemes"].as_array().unwrap().len(), 1);
        assert_eq!(value["customThemes"][0]["isBuiltIn"], false);
        assert_eq!(value["utilityPanelWidth"], 400);
        assert_eq!(value["utilityPanelTab"], "inbox");
        assert!(value["customThemes"][0]["overrides"]
            .get("unknown")
            .is_none());
    }

    #[test]
    fn desktop_ui_preferences_preserve_saved_utility_panel_state() {
        let value = sanitize_setting_value(
            "desktopUiPreferences",
            &json!({
                "utilityPanelWidth": 420,
                "utilityPanelTab": "history"
            }),
        )
        .expect("desktop UI settings");

        assert_eq!(value["utilityPanelWidth"], 420);
        assert_eq!(value["utilityPanelTab"], "history");
    }

    #[test]
    fn agent_autonomy_policy_is_bounded_and_drops_unknown_modes() {
        let value = sanitize_setting_value(
            "agentAutonomyPolicy",
            &json!({
                "enabled": true,
                "listAgents": "ask",
                "sendMessage": "invalid",
                "spawnAgent": "deny",
                "maxDepth": 99,
                "maxChildrenPerAgent": 0,
                "maxConcurrentAgents": 999,
                "maxActionsPerMinute": 999,
                "unknown": true
            }),
        )
        .expect("agent autonomy settings");

        assert_eq!(value["listAgents"], "ask");
        assert_eq!(value["sendMessage"], "deny");
        assert_eq!(value["spawnAgent"], "deny");
        assert_eq!(value["maxDepth"], 4);
        assert_eq!(value["maxChildrenPerAgent"], 1);
        assert_eq!(value["maxConcurrentAgents"], 16);
        assert_eq!(value["maxActionsPerMinute"], 60);
        assert!(value.get("unknown").is_none());
    }

    #[test]
    fn desktop_onboarding_version_accepts_only_bounded_nonnegative_integers() {
        assert_eq!(
            sanitize_setting_value("desktopOnboardingVersion", &json!(0)),
            Some(json!(0))
        );
        assert_eq!(
            sanitize_setting_value("desktopOnboardingVersion", &json!(1)),
            Some(json!(1))
        );
        assert_eq!(
            sanitize_setting_value("desktopOnboardingVersion", &json!(u16::MAX)),
            Some(json!(u16::MAX))
        );
        for invalid in [json!(-1), json!(1.5), json!(65_536), json!("1")] {
            assert_eq!(
                sanitize_setting_value("desktopOnboardingVersion", &invalid),
                None
            );
        }
    }
}

#[derive(Clone, Copy)]
struct WorkspaceBackgroundDefaults {
    preset_id: &'static str,
    seed: i64,
    opacity: f64,
    intensity: f64,
    speed: f64,
    scale: f64,
    color_a: &'static str,
    color_b: &'static str,
}

const WORKSPACE_BACKGROUND_DEFAULTS: &[WorkspaceBackgroundDefaults] = &[
    WorkspaceBackgroundDefaults {
        preset_id: "aurora",
        seed: 642,
        opacity: 0.61,
        intensity: 0.52,
        speed: 0.24,
        scale: 1.28,
        color_a: "#d7b46a",
        color_b: "#3e8f87",
    },
    WorkspaceBackgroundDefaults {
        preset_id: "iridescence",
        seed: 214,
        opacity: 0.5,
        intensity: 0.56,
        speed: 0.12,
        scale: 1.12,
        color_a: "#c4b37b",
        color_b: "#54746f",
    },
    WorkspaceBackgroundDefaults {
        preset_id: "waves",
        seed: 902,
        opacity: 0.38,
        intensity: 0.28,
        speed: 0.14,
        scale: 1.52,
        color_a: "#88a59e",
        color_b: "#8d5f55",
    },
    WorkspaceBackgroundDefaults {
        preset_id: "threads",
        seed: 437,
        opacity: 0.43,
        intensity: 0.34,
        speed: 0.16,
        scale: 1.48,
        color_a: "#aeb7aa",
        color_b: "#455f69",
    },
    WorkspaceBackgroundDefaults {
        preset_id: "particles",
        seed: 618,
        opacity: 0.46,
        intensity: 0.38,
        speed: 0.12,
        scale: 0.78,
        color_a: "#c9a86a",
        color_b: "#7c9a91",
    },
    WorkspaceBackgroundDefaults {
        preset_id: "prism",
        seed: 128,
        opacity: 0.42,
        intensity: 0.44,
        speed: 0.15,
        scale: 1.34,
        color_a: "#9bb5b8",
        color_b: "#c07c58",
    },
    WorkspaceBackgroundDefaults {
        preset_id: "plasma",
        seed: 753,
        opacity: 0.45,
        intensity: 0.48,
        speed: 0.18,
        scale: 0.84,
        color_a: "#b76d54",
        color_b: "#466f6b",
    },
    WorkspaceBackgroundDefaults {
        preset_id: "galaxy",
        seed: 489,
        opacity: 0.44,
        intensity: 0.42,
        speed: 0.1,
        scale: 1.36,
        color_a: "#c8b16b",
        color_b: "#5f7899",
    },
    WorkspaceBackgroundDefaults {
        preset_id: "light-rays",
        seed: 774,
        opacity: 0.52,
        intensity: 0.62,
        speed: 0.2,
        scale: 1.3,
        color_a: "#ecd890",
        color_b: "#3d737b",
    },
];

fn sanitize_workspace_background(value: &Value) -> Value {
    let Some(object) = value.as_object() else {
        return default_workspace_background();
    };
    match object.get("kind").and_then(Value::as_str) {
        Some("none") => json!({"kind": "none"}),
        Some("video") => json!({
            "kind": "video",
            "url": object
                .get("url")
                .and_then(Value::as_str)
                .map(|url| truncate_chars(url, 2048))
                .unwrap_or_default(),
            "color": object.get("color").and_then(Value::as_bool).unwrap_or(false),
            "opacity": finite_number(object.get("opacity"), 1.0).clamp(0.0, 1.0),
        }),
        Some("studio") => {
            let defaults =
                workspace_background_defaults(object.get("presetId").and_then(Value::as_str));
            json!({
                "kind": "studio",
                "presetId": defaults.preset_id,
                "seed": finite_number(object.get("seed"), defaults.seed as f64).clamp(1.0, 9999.0).round() as i64,
                "opacity": finite_number(object.get("opacity"), defaults.opacity).clamp(0.18, 0.88),
                "intensity": finite_number(object.get("intensity"), defaults.intensity).clamp(0.0, 1.0),
                "speed": finite_number(object.get("speed"), defaults.speed).clamp(0.0, 1.0),
                "scale": finite_number(object.get("scale"), defaults.scale).clamp(0.65, 1.6),
                "colorA": color_setting(object.get("colorA"), defaults.color_a),
                "colorB": color_setting(object.get("colorB"), defaults.color_b),
            })
        }
        _ => default_workspace_background(),
    }
}

pub(crate) fn sanitize_workspace_background_with_legacy(
    value: &Value,
    settings: &serde_json::Map<String, Value>,
) -> Value {
    let mut background = sanitize_workspace_background(value);
    if value
        .get("kind")
        .and_then(Value::as_str)
        .is_some_and(|kind| kind == "video")
        && !value.get("color").is_some_and(Value::is_boolean)
    {
        if let Some(color) = settings
            .get("backgroundVideoColorEnabled")
            .and_then(Value::as_bool)
        {
            if let Some(object) = background.as_object_mut() {
                object.insert("color".to_string(), json!(color));
            }
        }
    }
    if value.as_object().is_some()
        && background
            .get("kind")
            .and_then(Value::as_str)
            .is_some_and(|kind| matches!(kind, "none" | "video" | "studio"))
        && value
            .get("kind")
            .and_then(Value::as_str)
            .is_some_and(|kind| matches!(kind, "none" | "video" | "studio"))
    {
        return background;
    }
    legacy_workspace_background(settings).unwrap_or(background)
}

fn legacy_workspace_background(settings: &serde_json::Map<String, Value>) -> Option<Value> {
    let enabled = settings
        .get("backgroundVideoEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let url = settings
        .get("backgroundVideoUrl")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !enabled || url.trim().is_empty() {
        return None;
    }
    Some(json!({
        "kind": "video",
        "url": truncate_chars(url, 2048),
        "color": settings
            .get("backgroundVideoColorEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        "opacity": 1.0,
    }))
}

pub(crate) fn has_legacy_workspace_background_patch(
    settings: &serde_json::Map<String, Value>,
) -> bool {
    settings.contains_key("backgroundVideoEnabled")
        || settings.contains_key("backgroundVideoUrl")
        || settings.contains_key("backgroundVideoColorEnabled")
}

fn default_workspace_background() -> Value {
    let defaults = WORKSPACE_BACKGROUND_DEFAULTS[0];
    json!({
        "kind": "studio",
        "presetId": defaults.preset_id,
        "seed": defaults.seed,
        "opacity": defaults.opacity,
        "intensity": defaults.intensity,
        "speed": defaults.speed,
        "scale": defaults.scale,
        "colorA": defaults.color_a,
        "colorB": defaults.color_b,
    })
}

fn workspace_background_defaults(preset_id: Option<&str>) -> WorkspaceBackgroundDefaults {
    let preset_id = match preset_id.unwrap_or_default() {
        "mono-grid" | "beams" => "iridescence",
        "aurora-field" => "aurora",
        "signal-flow" | "hyperspeed" => "galaxy",
        "dither-mist" => "particles",
        "depth-mesh" => "prism",
        "plasma-wave" => "plasma",
        "thread-lines" => "threads",
        "lightning" => "light-rays",
        other => other,
    };
    WORKSPACE_BACKGROUND_DEFAULTS
        .iter()
        .copied()
        .find(|defaults| defaults.preset_id == preset_id)
        .unwrap_or(WORKSPACE_BACKGROUND_DEFAULTS[0])
}

pub(crate) fn finite_number(value: Option<&Value>, fallback: f64) -> f64 {
    value
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite())
        .unwrap_or(fallback)
}

fn color_setting(value: Option<&Value>, fallback: &str) -> String {
    value
        .and_then(Value::as_str)
        .filter(|color| is_hex_color(color))
        .unwrap_or(fallback)
        .to_string()
}

pub(crate) fn apply_workspace_background_legacy_settings(
    settings: &mut serde_json::Map<String, Value>,
    background: &Value,
) {
    let is_video = background
        .get("kind")
        .and_then(Value::as_str)
        .is_some_and(|kind| kind == "video");
    let url = if is_video {
        background
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or_default()
    } else {
        ""
    };
    let color = if is_video {
        background
            .get("color")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    } else {
        settings
            .get("backgroundVideoColorEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    };
    settings.insert(
        "backgroundVideoEnabled".to_string(),
        json!(is_video && !url.trim().is_empty()),
    );
    settings.insert("backgroundVideoUrl".to_string(), json!(url));
    settings.insert("backgroundVideoColorEnabled".to_string(), json!(color));
}

fn sanitize_shortcut_settings(value: &Value) -> Option<Value> {
    let object = value.as_object()?;
    let mut shortcuts = serde_json::Map::new();
    for (key, binding) in object {
        let Some(binding) = binding.as_str() else {
            continue;
        };
        let key = key.trim();
        let binding = binding.trim();
        if !is_safe_shortcut_action(key) || binding.len() > 120 {
            continue;
        }
        if binding.is_empty() {
            shortcuts.insert(key.to_string(), json!(""));
            continue;
        }
        let Some(binding) = normalize_shortcut_binding(binding) else {
            continue;
        };
        shortcuts.insert(key.to_string(), json!(binding));
    }
    Some(Value::Object(shortcuts))
}

fn is_safe_shortcut_action(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn normalize_shortcut_binding(value: &str) -> Option<String> {
    let mut modifiers = Vec::new();
    let mut key = None;
    for token in value
        .split('+')
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        match compact_shortcut_token(token).as_str() {
            "cmd" | "command" | "commandorcontrol" | "control" | "ctrl" | "meta" | "mod" => {
                if !modifiers.contains(&"CommandOrControl") {
                    modifiers.push("CommandOrControl");
                }
            }
            "option" | "alt" => {
                if !modifiers.contains(&"Alt") {
                    modifiers.push("Alt");
                }
            }
            "shift" => {
                if !modifiers.contains(&"Shift") {
                    modifiers.push("Shift");
                }
            }
            _ => {
                if key.is_some() {
                    return None;
                }
                key = normalize_shortcut_key_token(token);
            }
        }
    }
    let key = key?;
    let mut parts = Vec::new();
    for modifier in ["CommandOrControl", "Alt", "Shift"] {
        if modifiers.contains(&modifier) {
            parts.push(modifier.to_string());
        }
    }
    parts.push(key);
    Some(parts.join("+"))
}

fn normalize_shortcut_key_token(token: &str) -> Option<String> {
    let compact = compact_shortcut_token(token);
    let alias = match compact.as_str() {
        "esc" | "escape" => Some("Escape"),
        "enter" | "return" => Some("Enter"),
        "del" | "delete" => Some("Delete"),
        "backspace" => Some("Backspace"),
        "backquote" | "grave" | "graveaccent" | "`" => Some("Backquote"),
        "arrowleft" | "left" => Some("ArrowLeft"),
        "arrowright" | "right" => Some("ArrowRight"),
        "arrowup" | "up" => Some("ArrowUp"),
        "arrowdown" | "down" => Some("ArrowDown"),
        "space" => Some("Space"),
        "tab" => Some("Tab"),
        "home" => Some("Home"),
        "end" => Some("End"),
        "pageup" => Some("PageUp"),
        "pagedown" => Some("PageDown"),
        "equal" | "plus" => Some("Equal"),
        "minus" => Some("Minus"),
        "comma" => Some("Comma"),
        "period" => Some("Period"),
        "slash" => Some("Slash"),
        _ => None,
    };
    if let Some(alias) = alias {
        return Some(alias.to_string());
    }
    if compact.len() == 1 && compact.as_bytes()[0].is_ascii_alphabetic() {
        return Some(compact.to_ascii_uppercase());
    }
    if compact.len() == 1 && compact.as_bytes()[0].is_ascii_digit() {
        return Some(compact);
    }
    if let Some(number) = compact
        .strip_prefix('f')
        .and_then(|suffix| suffix.parse::<u8>().ok())
        .filter(|number| (1..=24).contains(number))
    {
        return Some(format!("F{number}"));
    }
    (token.chars().count() == 1).then(|| token.to_string())
}

fn compact_shortcut_token(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase()
}

fn sanitize_command_history(value: &Value) -> Option<Value> {
    let items = value.as_array()?;
    let history = items
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let text = object.get("text").and_then(Value::as_str)?.trim();
            if text.is_empty() {
                return None;
            }
            Some(json!({
                "id": truncate_chars(
                    object.get("id").and_then(Value::as_str).unwrap_or(""),
                    128,
                ),
                "source": sanitize_command_history_source(
                    object.get("source").and_then(Value::as_str).unwrap_or("typed"),
                ),
                "text": truncate_chars(text, 2048),
                "result": truncate_chars(
                    object.get("result").and_then(Value::as_str).unwrap_or(""),
                    2048,
                ),
                "risk": sanitize_command_history_risk(
                    object.get("risk").and_then(Value::as_str).unwrap_or("safe"),
                ),
                "createdAt": truncate_chars(
                    object.get("createdAt").and_then(Value::as_str).unwrap_or(""),
                    128,
                ),
            }))
        })
        .take(80)
        .collect::<Vec<_>>();
    Some(Value::Array(history))
}

fn sanitize_command_history_source(value: &str) -> &str {
    match value {
        "palette" => value,
        _ => "typed",
    }
}

fn sanitize_command_history_risk(value: &str) -> &str {
    match value {
        "caution" | "dangerous" => value,
        _ => "safe",
    }
}

pub(crate) fn redact_secrets_in_value(value: Value) -> Value {
    match value {
        Value::String(text) => Value::String(redact_secret_string(&text)),
        Value::Array(items) => {
            Value::Array(items.into_iter().map(redact_secrets_in_value).collect())
        }
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| {
                    let value = match value {
                        Value::String(text)
                            if is_secret_key_name(&key) && looks_like_secret_value(&text) =>
                        {
                            Value::String("[redacted]".to_string())
                        }
                        other => redact_secrets_in_value(other),
                    };
                    (key, value)
                })
                .collect(),
        ),
        other => other,
    }
}

fn redact_secret_string(input: &str) -> String {
    redact_sk_tokens(&redact_secret_assignments(&redact_secret_flags(input)))
}

fn redact_secret_flags(input: &str) -> String {
    let mut redacted = Vec::new();
    let mut tokens = input.split_whitespace().peekable();
    while let Some(token) = tokens.next() {
        let lower = token.to_ascii_lowercase();
        if let Some(index) = lower.find('=') {
            let flag = &lower[..index];
            if matches!(
                flag,
                "--api-key" | "--token" | "--secret" | "--auth-token" | "--access-token"
            ) {
                redacted.push(format!("{}=[redacted]", &token[..index]));
                continue;
            }
        }
        if matches!(
            lower.as_str(),
            "--api-key" | "--token" | "--secret" | "--auth-token" | "--access-token"
        ) {
            redacted.push(token.to_string());
            if tokens.next().is_some() {
                redacted.push("[redacted]".to_string());
            }
            continue;
        }
        redacted.push(token.to_string());
    }
    redacted.join(" ")
}

fn redact_secret_assignments(input: &str) -> String {
    input
        .split_whitespace()
        .map(redact_secret_assignment_token)
        .collect::<Vec<_>>()
        .join(" ")
}

fn redact_secret_assignment_token(token: &str) -> String {
    for separator in ['=', ':'] {
        if let Some(index) = token.find(separator) {
            let raw_key = token[..index].trim_matches(|ch: char| {
                ch.is_whitespace() || matches!(ch, '"' | '\'' | '`' | '{' | '[')
            });
            if is_provider_secret_env(raw_key) || is_secret_key_name(raw_key) {
                return format!("{}{}[redacted]", &token[..index], separator);
            }
        }
    }
    token.to_string()
}

fn is_provider_secret_env(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    let providers = [
        "OPENAI",
        "ANTHROPIC",
        "GITHUB",
        "GOOGLE",
        "GEMINI",
        "CURSOR",
        "OPENROUTER",
        "REPLICATE",
        "FAL",
    ];
    providers
        .iter()
        .any(|provider| upper.starts_with(&format!("{provider}_")))
        && (upper.ends_with("KEY") || upper.ends_with("TOKEN"))
}

fn is_secret_key_name(key: &str) -> bool {
    let compact: String = key
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect();
    matches!(
        compact.as_str(),
        "apikey" | "token" | "secret" | "authtoken" | "accesstoken"
    ) || compact.ends_with("apikey")
        || compact.ends_with("token")
        || compact.ends_with("secret")
}

fn looks_like_secret_value(value: &str) -> bool {
    let trimmed = value.trim_matches(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\''));
    trimmed.len() >= 12
        || trimmed.starts_with("sk-")
        || trimmed.starts_with("ghp_")
        || trimmed.starts_with("github_pat_")
}

fn redact_sk_tokens(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = String::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index..].starts_with(b"sk-") {
            let start = index;
            index += 3;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric()
                    || bytes[index] == b'_'
                    || bytes[index] == b'-')
            {
                index += 1;
            }
            if index - start >= 15 {
                output.push_str("[redacted-secret]");
            } else {
                output.push_str(&input[start..index]);
            }
        } else {
            output.push(bytes[index] as char);
            index += 1;
        }
    }
    output
}
