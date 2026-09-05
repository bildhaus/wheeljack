use super::*;

#[derive(Default)]
struct AgentProtocolEventParts {
    text: Option<String>,
    title: Option<String>,
    tool_call_id: Option<String>,
    message_id: Option<String>,
    part_id: Option<String>,
    message_role: Option<String>,
    interaction_id: Option<String>,
    interaction_state: Option<String>,
    choices: Option<Vec<AgentInteractionChoiceDto>>,
    images: Option<Vec<AgentChatImageDto>>,
}

#[derive(Default)]
pub(crate) struct AgentProtocolStreamState {
    pub(crate) messages: Vec<AgentChatMessageDto>,
    message_roles: HashMap<String, String>,
    pub(crate) pending_controls: Vec<String>,
    pub(crate) active: bool,
    pub(crate) last_snapshot_emit: Option<Instant>,
    pub(crate) snapshot_dirty: bool,
    pub(crate) pending_snapshot_events: Vec<AgentProtocolEventDto>,
}

pub(crate) const MAX_AGENT_TOOL_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_AGENT_TOTAL_TOOL_OUTPUT_BYTES: usize = 512 * 1024;
const TOOL_OUTPUT_TRUNCATED: &str = "\n[Output truncated; full transcript retained.]";
const EARLIER_TOOL_OUTPUT_TRUNCATED: &str =
    "[Earlier output truncated; full transcript retained.]\n";

impl AgentProtocolStreamState {
    pub(crate) fn visible_messages(&self) -> Vec<AgentChatMessageDto> {
        self.messages
            .iter()
            .filter_map(|message| {
                let mut visible = message.clone();
                if visible.role != "user"
                    && matches!(
                        visible.kind.as_str(),
                        "message" | "reasoning" | "commentary"
                    )
                {
                    // Reasoning may discuss an internal directive inline; it is
                    // never an action source and should not expose that payload.
                    if visible.kind != "message" {
                        if let Some(offset) = WHEELJACK_CONTROL_PREFIXES
                            .iter()
                            .filter_map(|prefix| visible.text.find(prefix))
                            .min()
                        {
                            visible.text.truncate(offset);
                        }
                    }
                    visible.text =
                        visible_wheeljack_text(&visible.text, visible.streaming == Some(true));
                }
                let hidden_empty_part = matches!(
                    visible.kind.as_str(),
                    "message" | "reasoning" | "commentary"
                ) && visible.text.trim().is_empty()
                    && !visible
                        .images
                        .as_ref()
                        .is_some_and(|images| !images.is_empty());
                (!hidden_empty_part).then_some(visible)
            })
            .collect()
    }
}

pub(crate) fn parse_agent_protocol_request(
    req: &AgentProtocolParseRequest,
) -> Result<Vec<AgentProtocolEventDto>> {
    if let Some(chunks) = req.transcript.as_ref().or(req.chunks.as_ref()) {
        return Ok(parse_agent_protocol_transcript(
            &req.adapter_id,
            &protocol_chunks_from_value(chunks)?,
            req.protocol.as_deref(),
            req.user_prompt.as_deref(),
        ));
    }
    if let Some(line) = req.line.as_deref() {
        return Ok(parse_agent_protocol_line(
            &req.adapter_id,
            req.protocol.as_deref(),
            line,
            0,
        ));
    }

    Ok(req
        .lines
        .iter()
        .enumerate()
        .flat_map(|(index, line)| {
            parse_agent_protocol_line(&req.adapter_id, req.protocol.as_deref(), line, index)
        })
        .collect())
}

pub(crate) fn reduce_agent_stream_events(
    events: &[AgentProtocolEventDto],
    req: &AgentProtocolParseRequest,
) -> (Vec<AgentChatMessageDto>, Vec<String>) {
    let mut state = AgentProtocolStreamState::default();
    apply_agent_stream_events(&mut state, events, req);
    (state.visible_messages(), state.pending_controls)
}

pub(crate) fn apply_agent_stream_events(
    state: &mut AgentProtocolStreamState,
    events: &[AgentProtocolEventDto],
    req: &AgentProtocolParseRequest,
) {
    let node_id = req.node_id.as_deref().unwrap_or("node");
    let output_role = match req.output_role.as_deref() {
        Some("terminal") => "terminal",
        _ => "assistant",
    };
    let limit = req.limit.unwrap_or(160);
    let messages = &mut state.messages;
    let message_roles = &mut state.message_roles;

    for event in events {
        if let (Some(message_id), Some(message_role)) = (&event.message_id, &event.message_role) {
            message_roles.insert(message_id.clone(), message_role.clone());
        }
        if matches!(
            event.event_type.as_str(),
            "turn_done" | "turn_canceled" | "session_done" | "error"
        ) {
            for message in messages
                .iter_mut()
                .filter(|message| message.streaming == Some(true))
            {
                message.streaming = Some(false);
                message.raw_index_end = event.sequence;
            }
        }
        if !matches!(
            event.event_type.as_str(),
            "reasoning_delta" | "reasoning_message" | "status" | "turn_started"
        ) {
            if let Some(reasoning) = last_streaming_message(messages, "system", "reasoning") {
                reasoning.streaming = Some(false);
            }
        }
        let known_message_role = event
            .message_id
            .as_ref()
            .and_then(|id| message_roles.get(id).or(event.message_role.as_ref()))
            .map(String::as_str);

        match event.event_type.as_str() {
            "user_message" => messages.push(agent_chat_message(
                node_id,
                event,
                "message",
                "user",
                "message",
                event.text.clone().unwrap_or_default(),
                None,
                None,
            )),
            "interaction_response" => {
                if let Some(interaction_id) = event.interaction_id.as_deref() {
                    if let Some(request) = messages
                        .iter_mut()
                        .rev()
                        .find(|message| message.interaction_id.as_deref() == Some(interaction_id))
                    {
                        request.interaction_state = event.interaction_state.clone();
                        request.raw_index_end = event.sequence;
                    }
                }
                messages.push(agent_chat_message(
                    node_id,
                    event,
                    "interaction-response",
                    "user",
                    "interaction_response",
                    event.text.clone().unwrap_or_default(),
                    None,
                    None,
                ));
            }
            "assistant_delta" => {
                if known_message_role == Some("user") {
                    continue;
                }
                if let Some(previous) = find_part_message(messages, event, output_role, "message") {
                    append_inline_text(&mut previous.text, event.text.as_deref());
                    previous.raw_index_end = event.sequence;
                    previous.streaming = Some(true);
                } else if let Some(previous) =
                    last_unkeyed_streaming_message(messages, event, output_role, "message")
                {
                    append_inline_text(&mut previous.text, event.text.as_deref());
                    previous.raw_index_end = event.sequence;
                } else {
                    messages.push(agent_chat_message(
                        node_id,
                        event,
                        "message",
                        output_role,
                        "message",
                        event.text.clone().unwrap_or_default(),
                        None,
                        Some(true),
                    ));
                }
            }
            "assistant_message" => {
                messages.retain(|message| message.kind != "commentary");
                if known_message_role == Some("user") {
                    continue;
                }
                let text = event.text.clone().unwrap_or_default();
                if let Some(previous) = find_part_message(messages, event, output_role, "message") {
                    previous.text = text;
                    previous.raw_index_end = event.sequence;
                    previous.streaming = Some(false);
                } else if let Some(previous) =
                    last_unkeyed_streaming_message(messages, event, output_role, "message")
                {
                    if let Some(text) = event.text.as_ref() {
                        previous.text.clone_from(text);
                    }
                    previous.raw_index_end = event.sequence;
                    previous.streaming = Some(false);
                } else if let Some(previous) = messages.last_mut().filter(|previous| {
                    previous.role == output_role
                        && previous.kind == "message"
                        && previous.text == text
                }) {
                    previous.raw_index_end = event.sequence;
                    previous.streaming = Some(false);
                } else {
                    messages.push(agent_chat_message(
                        node_id,
                        event,
                        "message",
                        output_role,
                        "message",
                        text,
                        None,
                        None,
                    ));
                }
            }
            "commentary" => {
                if messages.last().is_some_and(|message| {
                    message.role == output_role
                        && message.kind == "message"
                        && message.streaming == Some(true)
                }) {
                    messages.pop();
                }
                messages.retain(|message| message.kind != "commentary");
                messages.push(agent_chat_message(
                    node_id,
                    event,
                    "commentary",
                    "system",
                    "commentary",
                    event.text.clone().unwrap_or_default(),
                    Some("Working".to_string()),
                    None,
                ));
            }
            "reasoning_delta" => {
                if let Some(previous) = find_part_message(messages, event, "system", "reasoning") {
                    append_inline_text(&mut previous.text, event.text.as_deref());
                    previous.raw_index_end = event.sequence;
                    previous.streaming = Some(true);
                } else if let Some(previous) =
                    last_unkeyed_streaming_message(messages, event, "system", "reasoning")
                {
                    append_inline_text(&mut previous.text, event.text.as_deref());
                    previous.raw_index_end = event.sequence;
                } else {
                    messages.push(agent_chat_message(
                        node_id,
                        event,
                        "reasoning",
                        "system",
                        "reasoning",
                        event.text.clone().unwrap_or_default(),
                        Some("Reasoning".to_string()),
                        Some(true),
                    ));
                }
            }
            "reasoning_message" => {
                let text = event.text.clone().unwrap_or_default();
                if let Some(previous) = find_part_message(messages, event, "system", "reasoning") {
                    previous.text = text;
                    previous.raw_index_end = event.sequence;
                } else {
                    messages.push(agent_chat_message(
                        node_id,
                        event,
                        "reasoning",
                        "system",
                        "reasoning",
                        text,
                        Some("Reasoning".to_string()),
                        Some(true),
                    ));
                }
            }
            "tool_start" => {
                if let Some(tool) = find_tool_message(messages, event.tool_call_id.as_deref()) {
                    tool.title = Some(event.title.clone().unwrap_or_else(|| "Tool".to_string()));
                    if let Some(text) = event.text.as_ref().filter(|text| !text.is_empty()) {
                        tool.text.clone_from(text);
                    }
                    tool.raw_index_end = event.sequence;
                    tool.streaming = Some(true);
                } else {
                    messages.push(AgentChatMessageDto {
                        id: format!(
                            "{}-agent-{}-tool-{}",
                            node_id,
                            event.sequence,
                            event.tool_call_id.as_deref().unwrap_or("")
                        )
                        .trim_end_matches('-')
                        .to_string(),
                        role: "system".to_string(),
                        kind: "tool".to_string(),
                        title: Some(event.title.clone().unwrap_or_else(|| "Tool".to_string())),
                        text: event.text.clone().unwrap_or_default(),
                        raw_index_start: event.sequence,
                        raw_index_end: event.sequence,
                        streaming: Some(true),
                        interaction_id: None,
                        interaction_state: None,
                        choices: None,
                        images: None,
                        source_message_id: event.message_id.clone(),
                    });
                }
            }
            "tool_delta" | "tool_end" => {
                if let Some(tool) = find_tool_message(messages, event.tool_call_id.as_deref()) {
                    if event.event_type == "tool_delta" {
                        append_bounded_tool_delta(&mut tool.text, event.text.as_deref());
                    } else {
                        append_bounded_tool_block_once(&mut tool.text, event.text.as_deref());
                    }
                    tool.raw_index_end = event.sequence;
                    if event.event_type == "tool_end" {
                        tool.streaming = Some(false);
                    }
                } else if event.event_type == "tool_delta" || event.tool_call_id.is_some() {
                    messages.push(agent_chat_message(
                        node_id,
                        event,
                        "tool",
                        "system",
                        "tool",
                        bounded_tool_output(event.text.as_deref().unwrap_or_default()),
                        Some(event.title.clone().unwrap_or_else(|| "Tool".to_string())),
                        (event.event_type == "tool_delta").then_some(true),
                    ));
                }
            }
            "plan_update" => messages.push(agent_chat_message(
                node_id,
                event,
                "plan",
                "system",
                "plan",
                event.text.clone().unwrap_or_default(),
                Some("Plan".to_string()),
                None,
            )),
            "approval_request" | "question_request" => {
                let (kind, title) = if event.event_type == "approval_request" {
                    ("approval", "Approval")
                } else {
                    ("question", "Question")
                };
                if let Some(existing) = event.interaction_id.as_deref().and_then(|interaction_id| {
                    messages
                        .iter_mut()
                        .rev()
                        .find(|message| message.interaction_id.as_deref() == Some(interaction_id))
                }) {
                    existing.text = event.text.clone().unwrap_or_default();
                    existing.title = Some(event.title.clone().unwrap_or_else(|| title.to_string()));
                    existing.choices = event.choices.clone();
                    existing.raw_index_end = event.sequence;
                    continue;
                }
                messages.push(agent_chat_message(
                    node_id,
                    event,
                    kind,
                    "system",
                    kind,
                    event.text.clone().unwrap_or_default(),
                    Some(event.title.clone().unwrap_or_else(|| title.to_string())),
                    None,
                ));
            }
            "status" | "error" => {
                let kind = event.event_type.as_str();
                let text = if kind == "error" {
                    event
                        .text
                        .as_ref()
                        .map(|text| format!("Error: {text}"))
                        .unwrap_or_default()
                } else {
                    event.text.clone().unwrap_or_default()
                };
                if let Some(previous) = messages.last_mut() {
                    if previous.role == "system"
                        && previous.kind == "status"
                        && previous.text == text
                    {
                        previous.raw_index_end = event.sequence;
                        continue;
                    }
                }
                messages.push(agent_chat_message(
                    node_id, event, kind, "system", kind, text, None, None,
                ));
            }
            "turn_done" | "session_done" => {
                messages.retain(|message| message.kind != "commentary");
                if let Some(previous) = messages.last_mut() {
                    previous.raw_index_end = event.sequence;
                    previous.streaming = Some(false);
                }
            }
            _ => {}
        }
    }

    capture_completed_controls(messages, &mut state.pending_controls, output_role);
    // Consume only complete assistant directives. Keep the surrounding prose and
    // invalid requests visible, and do not recapture directives on later events.
    for message in messages.iter_mut().filter(|message| {
        message.role == "assistant" && message.kind == "message" && message.streaming != Some(true)
    }) {
        message.text = visible_wheeljack_text(&message.text, false);
    }
    messages.retain(|message| {
        message.role != "assistant"
            || message.kind != "message"
            || message.streaming == Some(true)
            || !message.text.is_empty()
            || message
                .images
                .as_ref()
                .is_some_and(|images| !images.is_empty())
    });
    if req.adapter_id == "opencode" {
        remove_duplicate_opencode_reasoning(messages, output_role);
    }

    if messages.len() > limit {
        messages.drain(..messages.len() - limit);
    }
    bound_total_tool_output(messages);
    state.active = advance_active_agent_turn(state.active, events);
}

fn bound_total_tool_output(messages: &mut [AgentChatMessageDto]) {
    let mut remaining = MAX_AGENT_TOTAL_TOOL_OUTPUT_BYTES;
    for message in messages
        .iter_mut()
        .rev()
        .filter(|message| message.kind == "tool")
    {
        if message.text.len() <= remaining {
            remaining -= message.text.len();
            continue;
        }
        if remaining <= EARLIER_TOOL_OUTPUT_TRUNCATED.len() {
            message.text.clear();
            continue;
        }
        let keep = remaining - EARLIER_TOOL_OUTPUT_TRUNCATED.len();
        let mut start = message.text.len().saturating_sub(keep);
        while !message.text.is_char_boundary(start) {
            start += 1;
        }
        let tail = message.text[start..].to_string();
        message.text = format!("{EARLIER_TOOL_OUTPUT_TRUNCATED}{tail}");
        remaining = 0;
    }
}

pub(crate) fn has_active_agent_turn(events: &[AgentProtocolEventDto]) -> bool {
    advance_active_agent_turn(false, events)
}

fn advance_active_agent_turn(mut active: bool, events: &[AgentProtocolEventDto]) -> bool {
    for event in events {
        match event.event_type.as_str() {
            "user_message"
            | "assistant_message"
            | "assistant_delta"
            | "reasoning_delta"
            | "reasoning_message"
            | "interaction_response"
            | "commentary"
            | "tool_start"
            | "tool_delta"
            | "plan_update"
            | "approval_request"
            | "question_request" => active = true,
            "turn_started" if event.message_role.as_deref() != Some("user") => active = true,
            "status" if active => active = true,
            "turn_done" | "turn_canceled" | "session_done" | "error" => active = false,
            _ => {}
        }
    }
    active
}

fn agent_chat_message(
    node_id: &str,
    event: &AgentProtocolEventDto,
    suffix: &str,
    role: &str,
    kind: &str,
    text: String,
    title: Option<String>,
    streaming: Option<bool>,
) -> AgentChatMessageDto {
    AgentChatMessageDto {
        id: event
            .part_id
            .as_ref()
            .map(|part_id| format!("{node_id}-agent-part-{part_id}-{suffix}"))
            .unwrap_or_else(|| format!("{node_id}-agent-{}-{suffix}", event.sequence)),
        role: role.to_string(),
        kind: kind.to_string(),
        text,
        raw_index_start: event.sequence,
        raw_index_end: event.sequence,
        title,
        streaming,
        interaction_id: event.interaction_id.clone(),
        interaction_state: event.interaction_state.clone(),
        choices: event.choices.clone(),
        images: event.images.clone(),
        source_message_id: event.message_id.clone(),
    }
}

fn remove_duplicate_opencode_reasoning(messages: &mut Vec<AgentChatMessageDto>, output_role: &str) {
    let visible_messages = messages
        .iter()
        .filter(|message| {
            message.role == output_role
                && message.kind == "message"
                && !message.text.trim().is_empty()
        })
        .filter_map(|message| {
            Some((
                message.source_message_id.clone()?,
                message.text.trim().to_string(),
            ))
        })
        .collect::<HashSet<_>>();
    messages.retain(|message| {
        message.kind != "reasoning"
            || message.source_message_id.as_ref().is_none_or(|message_id| {
                !visible_messages.contains(&(message_id.clone(), message.text.trim().to_string()))
            })
    });
}

fn find_part_message<'a>(
    messages: &'a mut [AgentChatMessageDto],
    event: &AgentProtocolEventDto,
    role: &str,
    kind: &str,
) -> Option<&'a mut AgentChatMessageDto> {
    let part_id = event.part_id.as_deref()?;
    let suffix = format!("-agent-part-{part_id}-");
    messages.iter_mut().find(|message| {
        message.role == role && message.kind == kind && message.id.contains(&suffix)
    })
}

fn last_streaming_message<'a>(
    messages: &'a mut [AgentChatMessageDto],
    role: &str,
    kind: &str,
) -> Option<&'a mut AgentChatMessageDto> {
    let last = messages.last_mut()?;
    (last.role == role && last.kind == kind && last.streaming == Some(true)).then_some(last)
}

fn last_unkeyed_streaming_message<'a>(
    messages: &'a mut [AgentChatMessageDto],
    event: &AgentProtocolEventDto,
    role: &str,
    kind: &str,
) -> Option<&'a mut AgentChatMessageDto> {
    event
        .part_id
        .is_none()
        .then(|| last_streaming_message(messages, role, kind))
        .flatten()
}

fn find_tool_message<'a>(
    messages: &'a mut [AgentChatMessageDto],
    tool_call_id: Option<&str>,
) -> Option<&'a mut AgentChatMessageDto> {
    messages.iter_mut().rev().find(|message| {
        message.kind == "tool"
            && tool_call_id
                .map(|id| message.id.ends_with(id))
                .unwrap_or(message.streaming == Some(true))
    })
}

fn append_inline_text(previous: &mut String, next: Option<&str>) {
    if let Some(next) = next.filter(|next| !next.is_empty()) {
        previous.push_str(next);
    }
}

fn append_bounded_tool_delta(previous: &mut String, next: Option<&str>) {
    let Some(next) = next.filter(|next| !next.is_empty()) else {
        return;
    };
    if previous.ends_with(TOOL_OUTPUT_TRUNCATED) {
        return;
    }
    if previous.len().saturating_add(next.len()) <= MAX_AGENT_TOOL_OUTPUT_BYTES {
        previous.push_str(next);
        return;
    }

    let content_limit = MAX_AGENT_TOOL_OUTPUT_BYTES - TOOL_OUTPUT_TRUNCATED.len();
    if previous.len() > content_limit {
        let mut end = content_limit;
        while !previous.is_char_boundary(end) {
            end -= 1;
        }
        previous.truncate(end);
    }
    let mut take = content_limit.saturating_sub(previous.len()).min(next.len());
    while !next.is_char_boundary(take) {
        take -= 1;
    }
    previous.push_str(&next[..take]);
    previous.push_str(TOOL_OUTPUT_TRUNCATED);
}

fn append_bounded_tool_block(previous: &mut String, next: Option<&str>) {
    let Some(next) = next.filter(|next| !next.is_empty()) else {
        return;
    };
    let separator =
        if previous.is_empty() || next.starts_with(char::is_whitespace) || previous.ends_with('\n')
        {
            ""
        } else {
            "\n"
        };
    if previous
        .len()
        .saturating_add(separator.len())
        .saturating_add(next.len())
        <= MAX_AGENT_TOOL_OUTPUT_BYTES
    {
        previous.push_str(separator);
        previous.push_str(next);
        return;
    }

    let keep = MAX_AGENT_TOOL_OUTPUT_BYTES - EARLIER_TOOL_OUTPUT_TRUNCATED.len();
    if next.len().saturating_add(separator.len()) >= keep {
        *previous = bounded_tool_output(next);
        return;
    }

    let previous_keep = keep - separator.len() - next.len();
    let mut start = previous.len().saturating_sub(previous_keep);
    while !previous.is_char_boundary(start) {
        start += 1;
    }
    let mut bounded = String::with_capacity(MAX_AGENT_TOOL_OUTPUT_BYTES);
    bounded.push_str(EARLIER_TOOL_OUTPUT_TRUNCATED);
    bounded.push_str(&previous[start..]);
    bounded.push_str(separator);
    bounded.push_str(next);
    *previous = bounded;
}

fn append_bounded_tool_block_once(previous: &mut String, next: Option<&str>) {
    let Some(next) = next.filter(|next| !next.is_empty()) else {
        return;
    };
    if previous == next || previous.ends_with(&format!("\n{next}")) {
        return;
    }
    append_bounded_tool_block(previous, Some(next));
}

fn bounded_tool_output(text: &str) -> String {
    if text.len() <= MAX_AGENT_TOOL_OUTPUT_BYTES {
        return text.to_string();
    }

    let keep = MAX_AGENT_TOOL_OUTPUT_BYTES - EARLIER_TOOL_OUTPUT_TRUNCATED.len();
    let mut start = text.len() - keep;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    format!("{EARLIER_TOOL_OUTPUT_TRUNCATED}{}", &text[start..])
}

fn protocol_chunks_from_value(value: &Value) -> Result<Vec<String>> {
    match value {
        Value::String(text) => Ok(vec![text.clone()]),
        Value::Array(items) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::to_string)
                    .ok_or_else(|| anyhow!("transcript chunks must be strings"))
            })
            .collect(),
        _ => bail!("transcript must be a string or array of strings"),
    }
}

fn parse_agent_protocol_transcript(
    adapter_id: &str,
    chunks: &[String],
    protocol: Option<&str>,
    user_prompt: Option<&str>,
) -> Vec<AgentProtocolEventDto> {
    let mut events = Vec::new();
    let mut sequence = 0usize;
    let prompt = user_prompt
        .and_then(coordination_visible_line)
        .filter(|value| !value.is_empty());
    if let Some(prompt) = prompt.as_ref() {
        events.push(agent_protocol_event(
            adapter_id,
            sequence,
            &Value::String(prompt.clone()),
            "user_message",
            AgentProtocolEventParts {
                text: Some(prompt.clone()),
                ..Default::default()
            },
        ));
        sequence += 1;
    }

    let visible_chunks = chunks
        .iter()
        .map(|chunk| {
            if contains_coordination_prompt_text(chunk) {
                coordination_visible_line(chunk)
                    .map(|visible| format!("user -> {visible}"))
                    .unwrap_or_default()
            } else {
                chunk.clone()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    for line in visible_chunks
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if structured_process_exited_line(line) {
            events.push(agent_protocol_event(
                adapter_id,
                sequence,
                &Value::String(line.to_string()),
                "turn_done",
                AgentProtocolEventParts::default(),
            ));
            sequence += 1;
            continue;
        }
        if structured_routine_line(line) || contains_coordination_prompt_text(line) {
            continue;
        }
        if let Some(user_text) = user_transcript_line(line) {
            let Some(visible_user_text) = coordination_visible_line(&user_text) else {
                continue;
            };
            if prompt.as_deref() != Some(visible_user_text.as_str()) {
                events.push(agent_protocol_event(
                    adapter_id,
                    sequence,
                    &Value::String(line.to_string()),
                    "user_message",
                    AgentProtocolEventParts {
                        text: Some(visible_user_text),
                        ..Default::default()
                    },
                ));
                sequence += 1;
            }
            continue;
        }

        let parsed_events = parse_agent_protocol_line(adapter_id, protocol, line, sequence);
        if parsed_events.is_empty() {
            continue;
        }
        events.extend(parsed_events);
        sequence += 1;
    }

    events
}

fn structured_routine_line(line: &str) -> bool {
    let lower = line.trim().to_ascii_lowercase();
    [
        "agent -> structured launching",
        "agent -> structured session attached",
        "agent -> structured process exited",
        "agent -> structured kill requested",
        "agent -> structured run already active",
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix))
}

fn structured_process_exited_line(line: &str) -> bool {
    line.trim()
        .to_ascii_lowercase()
        .starts_with("agent -> structured process exited")
}

fn user_transcript_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !lower.starts_with("user") {
        return None;
    }
    let rest = trimmed[4..].trim_start();
    rest.strip_prefix("->")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn parse_agent_protocol_line(
    adapter_id: &str,
    protocol: Option<&str>,
    line: &str,
    sequence: usize,
) -> Vec<AgentProtocolEventDto> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let parsed = match serde_json::from_str::<Value>(trimmed) {
        Ok(parsed) if parsed.is_object() => parsed,
        _ => {
            if adapter_id == "hermes-agent" {
                if let Some(event) = parse_hermes_structured_log(adapter_id, sequence, trimmed) {
                    return vec![event];
                }
                if protocol == Some("hermes-oneshot") {
                    return vec![agent_protocol_event(
                        adapter_id,
                        sequence,
                        &Value::String(trimmed.to_string()),
                        "assistant_delta",
                        AgentProtocolEventParts {
                            text: Some(trimmed.to_string()),
                            ..Default::default()
                        },
                    )];
                }
            }
            if (adapter_id == "codex-cli" && is_noisy_codex_structured_log(trimmed))
                || (adapter_id == "hermes-agent" && is_noisy_hermes_structured_log(trimmed))
                || (adapter_id == "opencode" && is_routine_opencode_server_log(trimmed))
                || (adapter_id == "pi-coding-agent"
                    && strip_terminal_control_sequences(trimmed)
                        .trim()
                        .eq_ignore_ascii_case("ready."))
            {
                return Vec::new();
            }
            return Vec::new();
        }
    };

    if parsed.get("type").and_then(Value::as_str) == Some("wheeljack_user_message") {
        let images = parsed
            .get("images")
            .and_then(Value::as_array)
            .map(|images| {
                images
                    .iter()
                    .filter_map(|image| {
                        Some(AgentChatImageDto {
                            path: image.get("path")?.as_str()?.to_string(),
                            file_name: image.get("fileName")?.as_str()?.to_string(),
                            mime_type: image.get("mimeType")?.as_str()?.to_string(),
                        })
                    })
                    .collect()
            });
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            &parsed,
            "user_message",
            AgentProtocolEventParts {
                text: parsed
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                images,
                ..Default::default()
            },
        )];
    }
    if parsed.get("type").and_then(Value::as_str) == Some("wheeljack_interaction_response") {
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            &parsed,
            "interaction_response",
            AgentProtocolEventParts {
                text: parsed
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                interaction_id: parsed
                    .get("interactionId")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                interaction_state: parsed
                    .get("interactionState")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                ..Default::default()
            },
        )];
    }
    if contains_coordination_prompt_text(trimmed) {
        return Vec::new();
    }

    let record = json_rpc_event_payload(&parsed).unwrap_or_else(|| parsed.clone());
    if let Some(text) = protocol_error_message(&record) {
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            &record,
            "error",
            AgentProtocolEventParts {
                text: Some(text),
                ..Default::default()
            },
        )];
    }
    let events = if protocol == Some("claude-stream-json") || adapter_id == "claude-code" {
        parse_claude_event(adapter_id, sequence, &record)
    } else if protocol == Some("codex-app-server") || adapter_id == "codex-cli" {
        parse_codex_event(adapter_id, sequence, &record)
    } else if protocol == Some("opencode-sse") || adapter_id == "opencode" {
        parse_opencode_event(adapter_id, sequence, &record)
    } else if protocol == Some("pi-rpc") || adapter_id == "pi-coding-agent" {
        parse_pi_event(adapter_id, sequence, &record)
    } else {
        parse_generic_structured_event(adapter_id, sequence, &record)
    };
    visible_protocol_events(events)
}

fn protocol_error_message(record: &Value) -> Option<String> {
    let message = object_field(record, "message");
    let stop_reason = first_string_field(record, &["stopReason", "stop_reason"]).or_else(|| {
        message.and_then(|message| first_string_field(message, &["stopReason", "stop_reason"]))
    });
    let error = record.get("error").filter(|error| !error.is_null());
    let text = first_string_field(record, &["errorMessage", "error_message"])
        .or_else(|| first_string_field(record, &["message", "detail", "reason"]))
        .or_else(|| {
            message
                .and_then(|message| first_string_field(message, &["errorMessage", "error_message"]))
        })
        .or_else(|| {
            error.and_then(|error| {
                first_string_field(error, &["message", "detail", "reason"])
                    .or_else(|| object_field(error, "data").and_then(text_from_unknown))
                    .or_else(|| text_from_unknown(error))
            })
        });
    let explicit_error = normalize_protocol_event_name(&event_name_for(record)) == "error"
        || stop_reason
            .as_deref()
            .is_some_and(|reason| reason.eq_ignore_ascii_case("error"))
        || error.is_some();
    (explicit_error || text.is_some())
        .then(|| text.unwrap_or_else(|| "Agent turn failed.".to_string()))
}

fn visible_protocol_events(events: Vec<AgentProtocolEventDto>) -> Vec<AgentProtocolEventDto> {
    events
        .into_iter()
        .filter(|event| {
            event
                .text
                .as_deref()
                .map(|text| !contains_coordination_prompt_text(text))
                .unwrap_or(true)
        })
        .collect()
}

const WHEELJACK_CONTROL_PREFIXES: [&str; 5] = [
    "wheeljack.project_document ",
    "wheeljack.project_documents ",
    "wheeljack.task_cards ",
    "wheeljack.ops_decomposition ",
    "wheeljack.control ",
];
const WHEELJACK_AUTONOMY_PROMPT_MARKER: &str = "wheeljack autonomous controls:";

fn is_wheeljack_control_message_or_prefix(text: &str) -> bool {
    let text = text.trim_start();
    !text.is_empty()
        && WHEELJACK_CONTROL_PREFIXES
            .iter()
            .any(|prefix| text.starts_with(prefix) || prefix.starts_with(text))
}

fn completed_wheeljack_control(text: &str) -> Option<&str> {
    let text = text.trim();
    let prefix = WHEELJACK_CONTROL_PREFIXES
        .iter()
        .find(|prefix| text.starts_with(**prefix))?;
    let mut value = serde_json::from_str::<Value>(&text[prefix.len()..]).ok()?;
    let object = value.as_object_mut()?;
    if *prefix == agent_control::AGENT_CONTROL_PREFIX {
        // Reuse the core request validation before hiding anything the frontend
        // cannot dispatch. Source identity is supplied by the session at dispatch.
        let request_id = object.remove("id")?;
        object.insert("requestId".to_string(), request_id);
        for key in ["sourceSessionId", "sourceNodeId", "canvasId"] {
            object.insert(key.to_string(), json!("protocol-validation"));
        }
        let request = serde_json::from_value::<AgentControlRequestDto>(value).ok()?;
        if !request.request_id.chars().next()?.is_ascii_alphanumeric() {
            return None;
        }
        agent_control::validate_agent_control_request(&request).ok()?;
    }
    Some(text)
}

fn wheeljack_text_lines(text: &str) -> impl Iterator<Item = (&str, bool)> {
    // An echoed instruction block and fenced examples are not agent requests.
    let text = text
        .split(WHEELJACK_AUTONOMY_PROMPT_MARKER)
        .next()
        .unwrap_or(text);
    let mut fence = None;
    text.lines().map(move |line| {
        let marker = if line.trim_start().starts_with("```") {
            Some('`')
        } else if line.trim_start().starts_with("~~~") {
            Some('~')
        } else {
            None
        };
        let eligible = fence.is_none() && marker.is_none();
        if let Some(marker) = marker {
            if fence == Some(marker) {
                fence = None;
            } else if fence.is_none() {
                fence = Some(marker);
            }
        }
        (line, eligible)
    })
}

fn capture_completed_controls(
    messages: &[AgentChatMessageDto],
    pending_controls: &mut Vec<String>,
    output_role: &str,
) {
    if output_role != "assistant" {
        return;
    }
    for control in messages
        .iter()
        .filter(|message| {
            message.role == "assistant"
                && message.kind == "message"
                && message.streaming != Some(true)
        })
        .flat_map(|message| {
            // Preserve the existing whole-message JSON format, including pretty
            // printed document proposals, alongside one-line control requests.
            if let Some(control) = completed_wheeljack_control(&message.text) {
                vec![control]
            } else {
                wheeljack_text_lines(&message.text)
                    .filter(|(_, eligible)| *eligible)
                    .filter_map(|(line, _)| completed_wheeljack_control(line))
                    .collect()
            }
        })
    {
        if pending_controls.iter().any(|known| known == control) {
            continue;
        }
        pending_controls.push(control.to_string());
    }
}

fn visible_wheeljack_text(text: &str, streaming: bool) -> String {
    if completed_wheeljack_control(text).is_some() {
        return String::new();
    }
    wheeljack_text_lines(text)
        .filter_map(|(line, eligible)| {
            if !eligible || !is_wheeljack_control_message_or_prefix(line) {
                return Some(line.to_string());
            }
            if streaming || completed_wheeljack_control(line).is_some() {
                return None;
            }
            if !WHEELJACK_CONTROL_PREFIXES
                .iter()
                .any(|prefix| line.trim_start().starts_with(prefix))
            {
                return Some(line.to_string());
            }
            Some(format!(
                "Invalid wheeljack control request (not executed): {}",
                line.trim()
            ))
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim_end()
        .to_string()
}

fn agent_protocol_event(
    adapter_id: &str,
    sequence: usize,
    raw: &Value,
    event_type: &str,
    parts: AgentProtocolEventParts,
) -> AgentProtocolEventDto {
    AgentProtocolEventDto {
        event_type: event_type.to_string(),
        adapter_id: adapter_id.to_string(),
        sequence,
        text: parts.text,
        title: parts.title,
        tool_call_id: parts.tool_call_id,
        message_id: parts.message_id,
        part_id: parts.part_id,
        message_role: parts.message_role,
        interaction_id: parts.interaction_id,
        interaction_state: parts.interaction_state,
        choices: parts.choices,
        images: parts.images,
        raw: Some(raw.clone()),
    }
}

fn value_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

fn string_field(record: &Value, key: &str) -> Option<String> {
    record.get(key).and_then(Value::as_str).map(str::to_string)
}

fn first_string_field(record: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| string_field(record, key))
}

fn object_field<'a>(record: &'a Value, key: &str) -> Option<&'a Value> {
    record.get(key).filter(|value| value.is_object())
}

fn first_object_field<'a>(record: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|key| object_field(record, key))
}

fn text_from_unknown(value: &Value) -> Option<String> {
    match value {
        Value::String(_) | Value::Number(_) | Value::Bool(_) => value_string(value),
        Value::Array(items) => {
            let text = items
                .iter()
                .filter_map(text_from_unknown)
                .collect::<Vec<_>>()
                .join("");
            (!text.is_empty()).then_some(text)
        }
        Value::Object(_) => {
            if let Some(text) = first_string_field(
                value,
                &[
                    "text", "content", "delta", "chunk", "output", "summary", "answer", "result",
                    "message", "partial", "value",
                ],
            ) {
                return Some(text);
            }
            [
                "delta", "content", "message", "data", "item", "params", "update", "payload",
                "result",
            ]
            .iter()
            .find_map(|key| value.get(key).and_then(text_from_unknown))
        }
        _ => None,
    }
}

fn event_name_for(record: &Value) -> String {
    let params = object_field(record, "params");
    let update = params.and_then(|params| object_field(params, "update"));
    let result = object_field(record, "result");
    first_string_field(record, &["type", "event", "name"])
        .or_else(|| {
            params.and_then(|params| first_string_field(params, &["type", "event", "name", "kind"]))
        })
        .or_else(|| {
            update.and_then(|update| {
                first_string_field(
                    update,
                    &["sessionUpdate", "session_update", "type", "event", "kind"],
                )
            })
        })
        .or_else(|| {
            result.and_then(|result| {
                first_string_field(result, &["stopReason", "stop_reason", "type", "event"])
            })
        })
        .or_else(|| {
            first_string_field(
                record,
                &["method", "kind", "sessionUpdate", "session_update"],
            )
        })
        .unwrap_or_default()
}

fn normalize_protocol_event_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if matches!(ch, '/' | '_' | '.' | ':' | '-') {
                ' '
            } else {
                ch.to_ascii_lowercase()
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn payload_for(record: &Value) -> &Value {
    first_object_field(record, &["params", "data", "payload", "update", "item"]).unwrap_or(record)
}

fn json_rpc_event_payload(raw: &Value) -> Option<Value> {
    let method = normalize_protocol_event_name(raw.get("method")?.as_str()?);
    if method != "event" {
        return None;
    }
    let params = object_field(raw, "params")?;
    let event_type = first_string_field(params, &["type", "event", "method", "name", "kind"])?;
    let payload = params.get("payload");
    let mut map = serde_json::Map::new();
    if let Some(params_map) = params.as_object() {
        for (key, value) in params_map {
            map.insert(key.clone(), value.clone());
        }
    }
    if let Some(payload_map) = payload.and_then(Value::as_object) {
        for (key, value) in payload_map {
            map.insert(key.clone(), value.clone());
        }
    }
    map.insert("type".to_string(), Value::String(event_type));
    if let Some(payload) = payload {
        map.insert("payload".to_string(), payload.clone());
    }
    Some(Value::Object(map))
}

fn compact_json(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::Null) | None => None,
        Some(Value::String(text)) => Some(text.clone()),
        Some(value) => serde_json::to_string(value).ok(),
    }
}

fn tool_call_id_from(record: &Value) -> Option<String> {
    first_string_field(
        record,
        &[
            "toolCallId",
            "tool_call_id",
            "callId",
            "callID",
            "call_id",
            "itemId",
            "item_id",
            "id",
        ],
    )
}

fn message_id_from(record: &Value) -> Option<String> {
    first_string_field(record, &["messageID", "messageId", "message_id"])
}

fn info_message_id_from(record: &Value) -> Option<String> {
    first_string_field(record, &["id", "messageID", "messageId", "message_id"])
}

fn message_role_from(record: Option<&Value>) -> Option<String> {
    let role = record.and_then(|record| string_field(record, "role"))?;
    matches!(role.as_str(), "user" | "assistant").then_some(role)
}

fn tool_title_from(record: &Value) -> Option<String> {
    first_string_field(
        record,
        &["toolName", "tool_name", "tool", "name", "command", "title"],
    )
}

fn parse_generic_structured_event(
    adapter_id: &str,
    sequence: usize,
    raw: &Value,
) -> Vec<AgentProtocolEventDto> {
    let name = normalize_protocol_event_name(&event_name_for(raw));
    let payload = payload_for(raw);
    let nested_payload = payload_for(payload);
    let text = text_from_unknown(raw).or_else(|| text_from_unknown(payload));
    let tool_call_id = tool_call_id_from(payload).or_else(|| tool_call_id_from(nested_payload));
    let title = tool_title_from(payload).or_else(|| tool_title_from(nested_payload));

    if ((name.contains("agentmessage")
        || name.contains("agent message")
        || name.contains("assistant")
        || name.contains("message")
        || name.contains("content block"))
        && (name.contains("delta") || name.contains("chunk") || name.contains("update")))
        || name.contains("agent message chunk")
    {
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "assistant_delta",
                    AgentProtocolEventParts {
                        text: Some(text),
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    if (name.contains("reasoning") || name.contains("thinking") || name.contains("summary text"))
        && (name.contains("delta") || name.contains("chunk") || name.contains("update"))
    {
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "reasoning_delta",
                    AgentProtocolEventParts {
                        text: Some(text),
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    if (name.contains("assistant") || name.contains("message"))
        && (name.contains("complete")
            || name.contains("completed")
            || name.contains("end")
            || name.contains("final"))
    {
        let mut events = Vec::new();
        if let Some(text) = text {
            events.push(agent_protocol_event(
                adapter_id,
                sequence,
                raw,
                "assistant_message",
                AgentProtocolEventParts {
                    text: Some(text),
                    ..Default::default()
                },
            ));
        }
        events.push(agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "turn_done",
            AgentProtocolEventParts::default(),
        ));
        return events;
    }

    if (name.contains("tool") && (name.contains("start") || name.contains("started")))
        || name.contains("tool execution start")
    {
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "tool_start",
            AgentProtocolEventParts {
                tool_call_id,
                title,
                text: compact_json(
                    payload
                        .get("input")
                        .or_else(|| payload.get("args"))
                        .or_else(|| payload.get("command")),
                ),
                ..Default::default()
            },
        )];
    }

    if (name.contains("tool")
        && (name.contains("delta")
            || name.contains("progress")
            || name.contains("output")
            || name.contains("update")))
        || name.contains("tool execution update")
    {
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "tool_delta",
                    AgentProtocolEventParts {
                        tool_call_id,
                        title,
                        text: Some(if name.contains("tool execution update") {
                            format!("\n{text}")
                        } else {
                            text
                        }),
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    if (name.contains("tool")
        && (name.contains("complete")
            || name.contains("completed")
            || name.contains("end")
            || name.contains("failed")))
        || name.contains("tool execution end")
    {
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "tool_end",
            AgentProtocolEventParts {
                tool_call_id,
                title,
                text: text.or_else(|| {
                    compact_json(
                        payload
                            .get("output")
                            .or_else(|| payload.get("result"))
                            .or_else(|| payload.get("error")),
                    )
                }),
                ..Default::default()
            },
        )];
    }

    if (name.contains("approval") || name.contains("permission"))
        && (name.contains("request") || name.contains("required"))
    {
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "approval_request",
            AgentProtocolEventParts {
                title: tool_title_from(payload).or_else(|| tool_title_from(raw)),
                text: Some(text.unwrap_or(name)),
                ..Default::default()
            },
        )];
    }

    if ((name.contains("question") || name.contains("clarify"))
        && (name.contains("request") || name.contains("required") || name.contains("ask")))
        || name.contains("ask question")
    {
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "question_request",
            AgentProtocolEventParts {
                text: Some(text.unwrap_or(name)),
                ..Default::default()
            },
        )];
    }

    if (name.contains("plan") || name.contains("todo"))
        && (name.contains("delta") || name.contains("update") || name.contains("created"))
    {
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "plan_update",
                    AgentProtocolEventParts {
                        text: Some(text),
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    if ((name.contains("turn") || name.contains("agent") || name.contains("session"))
        && (name.contains("complete")
            || name.contains("completed")
            || name.contains("end")
            || name.contains("done")))
        || (name.contains("end") && name.contains("turn"))
        || name.contains("result")
    {
        let mut events = Vec::new();
        if let Some(text) = text {
            events.push(agent_protocol_event(
                adapter_id,
                sequence,
                raw,
                "assistant_message",
                AgentProtocolEventParts {
                    text: Some(text),
                    ..Default::default()
                },
            ));
        }
        events.push(agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "turn_done",
            AgentProtocolEventParts::default(),
        ));
        return events;
    }

    if name.contains("error") || name.contains("failed") {
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "error",
            AgentProtocolEventParts {
                text: Some(text.unwrap_or(name)),
                ..Default::default()
            },
        )];
    }

    if name.contains("status")
        || name.contains("system")
        || name.contains("init")
        || name.contains("started")
    {
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "status",
                    AgentProtocolEventParts {
                        text: Some(text),
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    Vec::new()
}

fn parse_codex_event(adapter_id: &str, sequence: usize, raw: &Value) -> Vec<AgentProtocolEventDto> {
    let name = normalize_protocol_event_name(&event_name_for(raw));
    let params = object_field(raw, "params");
    let item = object_field(raw, "item")
        .or_else(|| params.and_then(|params| object_field(params, "item")));
    let item_type = item
        .and_then(|item| string_field(item, "type"))
        .map(|value| normalize_protocol_event_name(&value))
        .unwrap_or_default();
    let text = raw
        .get("delta")
        .and_then(text_from_unknown)
        .or_else(|| params.and_then(|params| params.get("delta").and_then(text_from_unknown)))
        .or_else(|| item.and_then(text_from_unknown))
        .or_else(|| text_from_unknown(raw));

    if item_type.contains("user message") || item_type.contains("usermessage") {
        return Vec::new();
    }

    if name.contains("item") && name.contains("started") && item_type.contains("agent") {
        return Vec::new();
    }

    if name == "turn completed"
        && params
            .and_then(|params| object_field(params, "turn"))
            .and_then(|turn| string_field(turn, "status"))
            .is_some_and(|status| status.eq_ignore_ascii_case("interrupted"))
    {
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "turn_canceled",
            AgentProtocolEventParts {
                text: Some("Turn canceled.".to_string()),
                ..Default::default()
            },
        )];
    }

    if name == "turn started" {
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "turn_started",
            AgentProtocolEventParts::default(),
        )];
    }

    if name == "item tool requestuserinput" {
        let questions = params
            .and_then(|params| params.get("questions"))
            .and_then(Value::as_array);
        let title = questions
            .and_then(|questions| questions.first())
            .and_then(|question| string_field(question, "header"))
            .or_else(|| Some("Question".to_string()));
        let detail = questions
            .map(|questions| {
                questions
                    .iter()
                    .filter_map(|question| string_field(question, "question"))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .filter(|detail| !detail.is_empty())
            .unwrap_or_else(|| "The agent needs an answer.".to_string());
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "question_request",
            AgentProtocolEventParts {
                title,
                text: Some(detail),
                ..Default::default()
            },
        )];
    }

    if name.contains("requestapproval") || name.contains("request approval") {
        let title = if name.contains("commandexecution") || name.contains("command execution") {
            "Command"
        } else if name.contains("filechange") || name.contains("file change") {
            "File change"
        } else if name.contains("permissions") {
            "Permissions"
        } else {
            "Approval"
        };
        let mut detail = Vec::new();
        if let Some(command) = params
            .and_then(|params| params.get("command"))
            .and_then(text_from_unknown)
        {
            detail.push(command);
        }
        if let Some(reason) = params.and_then(|params| string_field(params, "reason")) {
            detail.push(reason);
        }
        if let Some(permissions) = compact_json(params.and_then(|params| params.get("permissions")))
        {
            detail.push(permissions);
        }
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "approval_request",
            AgentProtocolEventParts {
                title: Some(title.to_string()),
                text: Some(if detail.is_empty() {
                    "Approval requested.".to_string()
                } else {
                    detail.join("\n")
                }),
                ..Default::default()
            },
        )];
    }

    if (name.contains("agentmessage") || name.contains("agent message")) && name.contains("delta") {
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "assistant_delta",
                    AgentProtocolEventParts {
                        text: Some(text),
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    if name.contains("reasoning") && name.contains("delta") {
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "reasoning_delta",
                    AgentProtocolEventParts {
                        text: Some(text),
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    if name.contains("plan") && name.contains("delta") {
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "plan_update",
                    AgentProtocolEventParts {
                        text: Some(text),
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    if name.contains("commandexecution") && name.contains("outputdelta")
        || name.contains("command execution") && name.contains("output delta")
    {
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "tool_delta",
                    AgentProtocolEventParts {
                        tool_call_id: params
                            .and_then(tool_call_id_from)
                            .or_else(|| tool_call_id_from(raw)),
                        title: Some("Command".to_string()),
                        text: Some(text),
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    if name.contains("item")
        && name.contains("started")
        && (item_type.contains("command")
            || item_type.contains("tool")
            || item_type.contains("mcp"))
    {
        let item_or_raw = item.unwrap_or(raw);
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "tool_start",
            AgentProtocolEventParts {
                tool_call_id: tool_call_id_from(item_or_raw),
                title: tool_title_from(item_or_raw).or_else(|| Some("Tool".to_string())),
                text: compact_json(
                    item_or_raw
                        .get("command")
                        .or_else(|| item_or_raw.get("input")),
                ),
                ..Default::default()
            },
        )];
    }

    if name.contains("item") && name.contains("completed") {
        let item_or_raw = item.unwrap_or(raw);
        if item_type.contains("agent message") || item_type.contains("agentmessage") {
            return text
                .map(|text| {
                    vec![agent_protocol_event(
                        adapter_id,
                        sequence,
                        raw,
                        if string_field(item_or_raw, "phase").as_deref() == Some("commentary") {
                            "commentary"
                        } else {
                            "assistant_message"
                        },
                        AgentProtocolEventParts {
                            text: Some(text),
                            ..Default::default()
                        },
                    )]
                })
                .unwrap_or_default();
        }
        if item_type.contains("command") || item_type.contains("tool") || item_type.contains("mcp")
        {
            return vec![agent_protocol_event(
                adapter_id,
                sequence,
                raw,
                "tool_end",
                AgentProtocolEventParts {
                    tool_call_id: tool_call_id_from(item_or_raw),
                    title: tool_title_from(item_or_raw).or_else(|| Some("Tool".to_string())),
                    text,
                    ..Default::default()
                },
            )];
        }
    }

    parse_generic_structured_event(adapter_id, sequence, raw)
}

fn text_from_claude_content(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let text = items
                .iter()
                .filter_map(|item| text_from_claude_content(Some(item)))
                .collect::<Vec<_>>()
                .join("");
            (!text.is_empty()).then_some(text)
        }
        Value::Object(_) => string_field(value?, "text").or_else(|| {
            value?
                .get("content")
                .and_then(|content| text_from_claude_content(Some(content)))
        }),
        _ => None,
    }
}

fn parse_claude_event(
    adapter_id: &str,
    sequence: usize,
    raw: &Value,
) -> Vec<AgentProtocolEventDto> {
    let raw_type = string_field(raw, "type");
    let stream_event = if raw_type.as_deref() == Some("stream_event") {
        object_field(raw, "event").unwrap_or(raw)
    } else {
        raw
    };
    let name = normalize_protocol_event_name(&event_name_for(stream_event));

    if raw_type.as_deref() == Some("user") {
        return object_field(raw, "message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|item| string_field(item, "type").as_deref() == Some("tool_result"))
            .map(|item| {
                agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "tool_end",
                    AgentProtocolEventParts {
                        text: text_from_claude_content(item.get("content")),
                        tool_call_id: string_field(item, "tool_use_id"),
                        ..Default::default()
                    },
                )
            })
            .collect();
    }

    if matches!(raw_type.as_deref(), Some("system" | "rate_limit_event")) {
        return Vec::new();
    }

    if raw_type.as_deref() == Some("assistant") {
        let message = object_field(raw, "message");
        return text_from_claude_content(message.and_then(|message| message.get("content")))
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "assistant_message",
                    AgentProtocolEventParts {
                        text: Some(text),
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    if raw_type.as_deref() == Some("control_request")
        && string_field(object_field(raw, "request").unwrap_or(raw), "subtype").as_deref()
            == Some("can_use_tool")
    {
        let request = object_field(raw, "request").unwrap_or(raw);
        let tool_name = string_field(request, "tool_name");
        let input = request.get("input");
        let approval_detail = input
            .and_then(|input| string_field(input, "command"))
            .or_else(|| compact_json(input));
        let question = request
            .get("input")
            .and_then(|input| input.get("questions"))
            .and_then(Value::as_array)
            .map(|questions| {
                questions
                    .iter()
                    .filter_map(|question| string_field(question, "question"))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .filter(|text| !text.is_empty());
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            if tool_name.as_deref() == Some("AskUserQuestion") {
                "question_request"
            } else {
                "approval_request"
            },
            AgentProtocolEventParts {
                title: tool_name,
                text: Some(
                    question
                        .or(approval_detail)
                        .unwrap_or_else(|| "Tool approval requested.".to_string()),
                ),
                interaction_id: string_field(raw, "request_id"),
                ..Default::default()
            },
        )];
    }

    if raw_type.as_deref() == Some("result") {
        let result_text = text_from_unknown(raw).unwrap_or_default();
        if result_text.to_ascii_lowercase().contains("interrupt")
            || result_text.to_ascii_lowercase().contains("cancel")
        {
            return vec![agent_protocol_event(
                adapter_id,
                sequence,
                raw,
                "turn_canceled",
                AgentProtocolEventParts {
                    text: Some("Turn canceled.".to_string()),
                    ..Default::default()
                },
            )];
        }
        if raw.get("is_error").and_then(Value::as_bool) == Some(true) {
            return vec![agent_protocol_event(
                adapter_id,
                sequence,
                raw,
                "error",
                AgentProtocolEventParts {
                    text: Some(
                        text_from_unknown(raw)
                            .unwrap_or_else(|| "Claude stream failed.".to_string()),
                    ),
                    ..Default::default()
                },
            )];
        }
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "turn_done",
            AgentProtocolEventParts::default(),
        )];
    }

    if name == "content block start" {
        let Some(block) = object_field(stream_event, "content_block") else {
            return Vec::new();
        };
        if string_field(block, "type").as_deref() != Some("tool_use") {
            return Vec::new();
        }
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "tool_start",
            AgentProtocolEventParts {
                tool_call_id: string_field(block, "id"),
                title: string_field(block, "name").or_else(|| Some("Tool".to_string())),
                text: compact_json(
                    block
                        .get("input")
                        .filter(|input| !input.as_object().is_some_and(serde_json::Map::is_empty)),
                ),
                ..Default::default()
            },
        )];
    }

    if name == "content block delta" {
        let delta = object_field(stream_event, "delta");
        let delta_type = delta.and_then(|delta| string_field(delta, "type"));
        let text = if delta_type.as_deref() == Some("input_json_delta") {
            delta
                .and_then(|delta| string_field(delta, "partial_json"))
                .or_else(|| delta.and_then(text_from_unknown))
        } else {
            delta.and_then(text_from_unknown)
        };
        let event_type = match delta_type.as_deref() {
            Some("text_delta") => "assistant_delta",
            Some("thinking_delta" | "summary_delta") => "reasoning_delta",
            Some("input_json_delta") => "tool_delta",
            _ => return Vec::new(),
        };
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    event_type,
                    AgentProtocolEventParts {
                        text: Some(text),
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    parse_generic_structured_event(adapter_id, sequence, stream_event)
}

fn parse_opencode_event(
    adapter_id: &str,
    sequence: usize,
    raw: &Value,
) -> Vec<AgentProtocolEventDto> {
    let source = object_field(raw, "payload").unwrap_or(raw);
    let name = normalize_protocol_event_name(&event_name_for(source));
    if name == "sync" {
        return Vec::new();
    }

    let properties = object_field(source, "properties");
    let info = properties
        .and_then(|properties| object_field(properties, "info"))
        .or_else(|| object_field(source, "info"));
    let part = properties
        .and_then(|properties| object_field(properties, "part"))
        .or_else(|| object_field(source, "part"));
    let part_type = part
        .and_then(|part| string_field(part, "type"))
        .map(|value| normalize_protocol_event_name(&value))
        .unwrap_or_default();
    let state = part.and_then(|part| object_field(part, "state"));
    let state_status = state
        .and_then(|state| string_field(state, "status"))
        .map(|value| normalize_protocol_event_name(&value))
        .unwrap_or_default();
    let delta = properties
        .and_then(|properties| properties.get("delta").and_then(text_from_unknown))
        .or_else(|| source.get("delta").and_then(text_from_unknown));
    let text = delta
        .clone()
        .or_else(|| part.and_then(text_from_unknown))
        .or_else(|| properties.and_then(text_from_unknown))
        .or_else(|| text_from_unknown(source));
    let message_id = part
        .and_then(message_id_from)
        .or_else(|| properties.and_then(message_id_from))
        .or_else(|| info.and_then(info_message_id_from));
    let part_id = part
        .and_then(|part| string_field(part, "id"))
        .or_else(|| {
            properties.and_then(|properties| {
                first_string_field(properties, &["partID", "partId", "part_id"])
            })
        })
        .or_else(|| first_string_field(source, &["partID", "partId", "part_id"]));
    let message_role = message_role_from(info);

    if name == "message updated" {
        if message_id.is_some() || message_role.is_some() {
            return vec![agent_protocol_event(
                adapter_id,
                sequence,
                raw,
                "turn_started",
                AgentProtocolEventParts {
                    message_id,
                    message_role,
                    ..Default::default()
                },
            )];
        }
        return Vec::new();
    }

    if name == "text" {
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "assistant_message",
                    AgentProtocolEventParts {
                        text: Some(text),
                        message_id,
                        part_id,
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    if name == "reasoning" {
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "reasoning_delta",
                    AgentProtocolEventParts {
                        text: Some(text),
                        part_id,
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    if name == "message part delta" {
        let event_type = if part_type == "reasoning" {
            "reasoning_delta"
        } else {
            "assistant_delta"
        };
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    event_type,
                    AgentProtocolEventParts {
                        text: Some(text),
                        message_id,
                        part_id,
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    if name == "message part updated" {
        if part_type == "text" {
            let event_type = if delta.is_some() {
                "assistant_delta"
            } else {
                "assistant_message"
            };
            return vec![agent_protocol_event(
                adapter_id,
                sequence,
                raw,
                event_type,
                AgentProtocolEventParts {
                    text: Some(text.unwrap_or_default()),
                    message_id,
                    part_id,
                    ..Default::default()
                },
            )];
        }
        if part_type == "reasoning" {
            return vec![agent_protocol_event(
                adapter_id,
                sequence,
                raw,
                "reasoning_message",
                AgentProtocolEventParts {
                    text: Some(text.unwrap_or_default()),
                    message_id,
                    part_id,
                    ..Default::default()
                },
            )];
        }
        if part_type == "tool" {
            let part_or_raw = part.unwrap_or(raw);
            let tool_call_id = tool_call_id_from(part_or_raw);
            let title = state
                .and_then(tool_title_from)
                .or_else(|| tool_title_from(part_or_raw))
                .or_else(|| Some("Tool".to_string()));
            if state_status.contains("pending") || state_status.contains("running") {
                return vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "tool_start",
                    AgentProtocolEventParts {
                        tool_call_id,
                        title,
                        text: compact_json(state.and_then(|state| state.get("input"))),
                        part_id,
                        ..Default::default()
                    },
                )];
            }
            if state_status.contains("completed") || state_status.contains("error") {
                return vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "tool_end",
                    AgentProtocolEventParts {
                        tool_call_id,
                        title,
                        text: text.or_else(|| {
                            compact_json(state.and_then(|state| {
                                state.get("output").or_else(|| state.get("error"))
                            }))
                        }),
                        part_id,
                        ..Default::default()
                    },
                )];
            }
        }
    }

    if name == "permission asked" || name == "permission updated" {
        let permission = properties
            .and_then(|properties| properties.get("permission"))
            .unwrap_or(source);
        let interaction_id = properties
            .and_then(|properties| string_field(properties, "id"))
            .or_else(|| string_field(permission, "id"));
        let title = string_field(permission, "permission")
            .or_else(|| properties.and_then(|properties| string_field(properties, "permission")))
            .or_else(|| Some("Permission".to_string()));
        let detail = compact_json(permission.get("patterns"))
            .or_else(|| compact_json(properties.and_then(|properties| properties.get("patterns"))))
            .or(text)
            .unwrap_or_else(|| "Permission requested.".to_string());
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "approval_request",
            AgentProtocolEventParts {
                title,
                text: Some(detail),
                interaction_id,
                ..Default::default()
            },
        )];
    }
    if name == "question asked" || name == "question v2 asked" {
        let questions = properties
            .and_then(|properties| properties.get("questions"))
            .or_else(|| source.get("questions"))
            .and_then(Value::as_array);
        let first = questions.and_then(|questions| questions.first());
        let title = first
            .and_then(|question| string_field(question, "header"))
            .or_else(|| Some("Question".to_string()));
        let detail = questions
            .map(|questions| {
                questions
                    .iter()
                    .filter_map(|question| string_field(question, "question"))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .filter(|detail| !detail.is_empty())
            .or(text)
            .unwrap_or_else(|| "The agent needs an answer.".to_string());
        let choices = first
            .and_then(|question| question.get("options"))
            .and_then(Value::as_array)
            .map(|options| {
                options
                    .iter()
                    .enumerate()
                    .filter_map(|(index, option)| {
                        let label = string_field(option, "label")?;
                        Some(AgentInteractionChoiceDto {
                            id: label.clone(),
                            label,
                            description: string_field(option, "description")
                                .or_else(|| Some(format!("Option {}", index + 1))),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .filter(|choices| !choices.is_empty());
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "question_request",
            AgentProtocolEventParts {
                title,
                text: Some(detail),
                interaction_id: properties
                    .and_then(|properties| string_field(properties, "id"))
                    .or_else(|| string_field(source, "id")),
                choices,
                ..Default::default()
            },
        )];
    }
    if name == "todo updated" {
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    "plan_update",
                    AgentProtocolEventParts {
                        text: Some(text),
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }
    if name == "session error" {
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "error",
            AgentProtocolEventParts {
                text: Some(text.unwrap_or_else(|| "OpenCode session error.".to_string())),
                ..Default::default()
            },
        )];
    }
    if name == "session idle" || name == "step finish" {
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "turn_done",
            AgentProtocolEventParts::default(),
        )];
    }

    parse_generic_structured_event(adapter_id, sequence, source)
}

fn parse_pi_event(adapter_id: &str, sequence: usize, raw: &Value) -> Vec<AgentProtocolEventDto> {
    let name = normalize_protocol_event_name(&event_name_for(raw));
    let assistant_message_event = object_field(raw, "assistantMessageEvent");
    let assistant_event_type = assistant_message_event
        .and_then(|event| string_field(event, "type"))
        .map(|value| normalize_protocol_event_name(&value))
        .unwrap_or_default();
    let message = object_field(raw, "message");
    let message_role = message_role_from(message);
    let text = raw
        .get("textDelta")
        .and_then(text_from_unknown)
        .or_else(|| {
            assistant_message_event.and_then(|event| event.get("delta").and_then(text_from_unknown))
        })
        .or_else(|| raw.get("delta").and_then(text_from_unknown))
        .or_else(|| raw.get("message").and_then(text_from_unknown))
        .or_else(|| text_from_unknown(raw));

    if name.contains("message update") {
        if assistant_message_event.is_none() {
            return Vec::new();
        }
        let event_type = if assistant_event_type.contains("thinking delta") {
            "reasoning_delta"
        } else if assistant_event_type.contains("text delta") {
            "assistant_delta"
        } else {
            return Vec::new();
        };
        return text
            .map(|text| {
                vec![agent_protocol_event(
                    adapter_id,
                    sequence,
                    raw,
                    event_type,
                    AgentProtocolEventParts {
                        text: Some(text),
                        ..Default::default()
                    },
                )]
            })
            .unwrap_or_default();
    }

    if name.contains("message end") {
        if message_role.as_deref() != Some("assistant") {
            return Vec::new();
        }
        let mut events = Vec::new();
        if let Some(text) = text {
            events.push(agent_protocol_event(
                adapter_id,
                sequence,
                raw,
                "assistant_message",
                AgentProtocolEventParts {
                    text: Some(text),
                    ..Default::default()
                },
            ));
        }
        return events;
    }

    if name.contains("turn end") || name.contains("agent end") {
        return Vec::new();
    }

    if name == "agent settled" {
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "turn_done",
            AgentProtocolEventParts::default(),
        )];
    }

    if name.contains("tool execution start") {
        return vec![agent_protocol_event(
            adapter_id,
            sequence,
            raw,
            "tool_start",
            AgentProtocolEventParts {
                tool_call_id: tool_call_id_from(raw),
                title: tool_title_from(raw).or_else(|| Some("Tool".to_string())),
                text: compact_json(raw.get("input").or_else(|| raw.get("args"))),
                ..Default::default()
            },
        )];
    }

    parse_generic_structured_event(adapter_id, sequence, raw)
}

fn is_noisy_codex_structured_log(value: &str) -> bool {
    let normalized = strip_terminal_control_sequences(value).to_ascii_lowercase();
    normalized
        .trim()
        .starts_with("reading additional input from stdin")
        || normalized.contains("rmcp::transport::worker")
        || normalized.contains("worker quit with fatal")
        || normalized.contains("mcp startup incomplete")
        || normalized.contains("mcp server is not logged in")
        || normalized.contains("http://127.0.0.1:") && normalized.contains("/mcp")
        || normalized.contains("codex_features")
        || normalized.contains("codex_core_plugins::manifest")
        || normalized.contains("codex_core_skills::loader")
        || normalized.contains("codex_exec_server::client::http_client::reqwest_http_client")
        || normalized.contains("codex_rmcp_client")
        || normalized.contains("codex::mcp::rmcp_client")
        || normalized.contains("unknown feature key")
        || normalized.contains("ignoring interface.")
        || normalized.contains("failed to create shell snapshot")
        || normalized.contains("streamable http post_message failed")
        || normalized.contains("streamable http mcp initialize failed")
        || normalized.contains("failed to initialize mcp client during shutdown")
}

fn is_noisy_hermes_structured_log(value: &str) -> bool {
    let normalized = strip_terminal_control_sequences(value).to_ascii_lowercase();
    normalized.contains("acp_adapter.entry:")
        || normalized.contains("acp_adapter.server:")
        || normalized.contains("acp_adapter.session:")
        || normalized.contains("run_agent: loaded environment variables")
        || normalized.contains("run_agent: openai client created")
        || normalized.contains("agent.auxiliary_client:")
        || normalized.contains("agent.turn_context:")
}

fn parse_hermes_structured_log(
    adapter_id: &str,
    sequence: usize,
    value: &str,
) -> Option<AgentProtocolEventDto> {
    let normalized = strip_terminal_control_sequences(value).to_ascii_lowercase();
    let text = if normalized.contains("acp_adapter.server: prompt on session") {
        Some("Hermes accepted the prompt.")
    } else if normalized.contains("agent.turn_context: conversation turn:") {
        Some("Hermes started the model turn.")
    } else {
        None
    }?;

    Some(agent_protocol_event(
        adapter_id,
        sequence,
        &Value::String(value.to_string()),
        "status",
        AgentProtocolEventParts {
            text: Some(text.to_string()),
            ..Default::default()
        },
    ))
}

fn is_routine_opencode_server_log(value: &str) -> bool {
    let normalized = strip_terminal_control_sequences(value).to_ascii_lowercase();
    normalized
        .trim()
        .starts_with("warning: opencode_server_password is not set")
        || normalized
            .trim()
            .starts_with("opencode server listening on http://127.0.0.1:")
}
