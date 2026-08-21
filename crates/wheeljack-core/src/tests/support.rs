use crate::*;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Default)]
pub(super) struct RecordingSink {
    pub(super) events: Mutex<Vec<(String, Value)>>,
}

impl EventSink for RecordingSink {
    fn emit(&self, event: &str, payload: &Value) {
        self.events
            .lock()
            .unwrap()
            .push((event.to_string(), payload.clone()));
    }
}

impl RecordingSink {
    pub(super) fn snapshot(&self) -> Vec<(String, Value)> {
        self.events.lock().unwrap().clone()
    }
}

pub(super) fn agent_node_json(id: &str, title: &str, cwd: &str, z_index: i64) -> Value {
    json!({
        "id": id,
        "canvasId": "canvas_test",
        "kind": "agent_terminal",
        "title": title,
        "x": 0.0,
        "y": 0.0,
        "width": 640.0,
        "height": 320.0,
        "zIndex": z_index,
        "data": {
            "adapterId": "claude-code",
            "adapterName": "Claude Code",
            "cwd": cwd,
            "status": "running",
            "prompt": "",
            "transcript": []
        },
        "createdAt": "2026-06-20T00:00:00.000Z",
        "updatedAt": "2026-06-20T00:00:00.000Z"
    })
}

pub(super) fn coordination_board_node_json(
    id: &str,
    cwd: &str,
    board_id: &str,
    label: &str,
    z_index: i64,
) -> Value {
    json!({
        "id": id,
        "canvasId": "canvas_test",
        "kind": "task_checklist",
        "title": "Coordination",
        "x": 0.0,
        "y": 0.0,
        "width": 460.0,
        "height": 360.0,
        "zIndex": z_index,
        "data": {
            "items": [{
                "id": format!("task_{id}"),
                "label": label,
                "done": false,
                "status": "todo"
            }],
            "coordination": {
                "boardId": board_id,
                "cwd": cwd,
                "boardPath": "",
                "tasksPath": "",
                "agentsPath": "",
                "mode": "shared-cwd",
                "peers": [],
                "updatedAt": "2026-06-20T00:00:00.000Z"
            }
        },
        "createdAt": "2026-06-20T00:00:00.000Z",
        "updatedAt": "2026-06-20T00:00:00.000Z"
    })
}

pub(super) fn test_init(name: &str) -> InitOptions {
    let app_data_dir = temp_dir(name);
    InitOptions {
        platform: "test".to_string(),
        version: "0.0.0-test".to_string(),
        cache_dir: Some(app_data_dir.join("cache")),
        update_dir: Some(app_data_dir.join("updates")),
        app_data_dir,
        old_app_data_dirs: Vec::new(),
        current_executable_path: None,
        current_app_bundle_path: None,
        update_feed_url: None,
        test_mode: true,
    }
}

pub(super) fn temp_dir(name: &str) -> PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    std::env::temp_dir().join(format!(
        "wheeljack-core-{name}-{}-{millis}",
        std::process::id()
    ))
}

pub(super) struct TestHttpRequest {
    pub(super) method: String,
    pub(super) path: String,
    pub(super) body: Vec<u8>,
}

pub(super) fn read_test_http_request(stream: &TcpStream) -> Result<TestHttpRequest> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| anyhow!("missing method"))?
        .to_string();
    let target = parts
        .next()
        .ok_or_else(|| anyhow!("missing request target"))?;
    let path = target.split_once('?').map_or(target, |(path, _)| path);
    let mut content_length = 0;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            if key.trim().eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse::<usize>().unwrap_or(0);
            }
        }
    }
    if content_length > 64 * 1024 {
        bail!("test request body is too large");
    }
    let mut body = vec![0; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body)?;
    }
    Ok(TestHttpRequest {
        method,
        path: path.to_string(),
        body,
    })
}

pub(super) struct TestHttpResponse {
    status_code: u16,
    status_text: &'static str,
    body: Vec<u8>,
}

impl TestHttpResponse {
    pub(super) fn json(status_code: u16, status_text: &'static str, value: Value) -> Self {
        Self {
            status_code,
            status_text,
            body: serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec()),
        }
    }

    pub(super) fn to_bytes(&self) -> Vec<u8> {
        let headers = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            self.status_code,
            self.status_text,
            self.body.len(),
        );
        let mut bytes = headers.into_bytes();
        bytes.extend_from_slice(&self.body);
        bytes
    }
}

pub(super) fn start_fake_opencode_sse_server(posted_messages: Arc<Mutex<Vec<Value>>>) -> u16 {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind opencode server");
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for stream in listener.incoming().take(16).flatten() {
            let posted_messages = posted_messages.clone();
            thread::spawn(move || {
                let Ok(req) = read_test_http_request(&stream) else {
                    return;
                };
                let mut stream = stream;
                let response = match (req.method.as_str(), req.path.as_str()) {
                    ("GET", "/global/health") => {
                        TestHttpResponse::json(200, "OK", json!({ "ok": true })).to_bytes()
                    }
                    ("POST", "/session") => {
                        if let Ok(body) = serde_json::from_slice::<Value>(&req.body) {
                            posted_messages.lock().unwrap().push(body);
                        }
                        TestHttpResponse::json(200, "OK", json!({ "id": "session-opencode" }))
                            .to_bytes()
                    }
                    ("POST", "/session/session-opencode/prompt_async") => {
                        if let Ok(body) = serde_json::from_slice::<Value>(&req.body) {
                            posted_messages.lock().unwrap().push(body);
                        }
                        TestHttpResponse::json(200, "OK", json!({ "ok": true })).to_bytes()
                    }
                    ("POST", path)
                        if (path.starts_with("/permission/") || path.starts_with("/question/"))
                            && (path.ends_with("/reply") || path.ends_with("/reject")) =>
                    {
                        if let Ok(mut body) = serde_json::from_slice::<Value>(&req.body) {
                            body["requestPath"] = json!(path);
                            posted_messages.lock().unwrap().push(body);
                        } else {
                            posted_messages
                                .lock()
                                .unwrap()
                                .push(json!({ "requestPath": path }));
                        }
                        TestHttpResponse::json(200, "OK", json!(true)).to_bytes()
                    }
                    ("POST", "/session/session-opencode/abort") => {
                        posted_messages
                            .lock()
                            .unwrap()
                            .push(json!({ "abort": true }));
                        TestHttpResponse::json(200, "OK", json!(true)).to_bytes()
                    }
                    ("GET", "/global/event") => {
                        let body = "event: session.idle\r\ndata: {\"type\":\"session.idle\",\"properties\":{\"sessionID\":\"session-opencode\"}}\r\n\r\n";
                        format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                body.len(),
                                body
                            )
                            .into_bytes()
                    }
                    _ => {
                        TestHttpResponse::json(404, "Not Found", json!({ "ok": false })).to_bytes()
                    }
                };
                let _ = stream.write_all(&response);
                let _ = stream.flush();
            });
        }
    });
    port
}

pub(super) fn run_git<const N: usize>(cwd: &Path, args: [&str; N]) -> std::io::Result<()> {
    let output = Command::new("git").current_dir(cwd).args(args).output()?;
    assert!(
        output.status.success(),
        "git failed: {}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

pub(super) fn decoded_line(payload: &Value) -> String {
    payload["lineBase64"]
        .as_str()
        .and_then(|value| general_purpose::STANDARD.decode(value).ok())
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
        .unwrap_or_default()
}

pub(super) fn structured_event_lines(sink: &RecordingSink) -> Vec<String> {
    sink.snapshot()
        .into_iter()
        .filter_map(|(event, payload)| {
            (event == "agent:structured-line").then(|| decoded_line(&payload))
        })
        .collect()
}

pub(super) fn adapter_json(
    id: &str,
    name: &str,
    executable: &str,
    launch: &str,
    prompt: &str,
) -> Value {
    json!({
        "id": id,
        "displayName": name,
        "icon": "",
        "executables": [executable],
        "supportedPlatforms": ["macos", "windows"],
        "launchCommand": launch,
        "promptInjection": prompt,
        "status": "unknown",
        "setupHint": "test"
    })
}

#[cfg(windows)]
pub(super) fn test_echo_command() -> (String, Vec<String>) {
    (
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()),
        vec!["/C".to_string(), "echo native-pty".to_string()],
    )
}

#[cfg(windows)]
pub(super) fn test_delayed_exit_command() -> (String, Vec<String>) {
    (
        "powershell".to_string(),
        vec![
            "-NoProfile".to_string(),
            "-Command".to_string(),
            "Start-Sleep -Milliseconds 400; Write-Output delayed-pty".to_string(),
        ],
    )
}

#[cfg(windows)]
pub(super) fn test_delayed_file_write_command(path: &Path) -> (String, Vec<String>) {
    let path = path.to_string_lossy().replace('\'', "''");
    let script =
        format!("Start-Sleep -Milliseconds 800; [IO.File]::WriteAllText('{path}', 'orphaned')");
    let encoded = general_purpose::STANDARD.encode(
        script
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    (
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()),
        vec![
            "/d".to_string(),
            "/s".to_string(),
            "/c".to_string(),
            format!("powershell -NoProfile -NonInteractive -EncodedCommand {encoded}"),
        ],
    )
}

#[cfg(windows)]
pub(super) fn test_detached_delayed_file_write_command(
    path: &Path,
    ready_path: &Path,
) -> (String, Vec<String>) {
    let path = path.to_string_lossy().replace('\'', "''");
    let ready_path = ready_path.to_string_lossy().replace('\'', "''");
    let child_script =
        format!("Start-Sleep -Milliseconds 800; [IO.File]::WriteAllText('{path}', 'orphaned')");
    let child_encoded = general_purpose::STANDARD.encode(
        child_script
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    let parent_script = format!(
        "$exe = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'; Start-Process -WindowStyle Hidden -FilePath $exe -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','{child_encoded}'); [IO.File]::WriteAllText('{ready_path}', 'ready')"
    );
    let parent_encoded = general_purpose::STANDARD.encode(
        parent_script
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    (
        std::env::var("SystemRoot")
            .map(|root| format!("{root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"))
            .unwrap_or_else(|_| "powershell.exe".to_string()),
        vec![
            "-NoProfile".to_string(),
            "-NonInteractive".to_string(),
            "-EncodedCommand".to_string(),
            parent_encoded,
        ],
    )
}

#[cfg(windows)]
pub(super) fn test_noisy_sse_server_command() -> (String, Vec<String>) {
    let dir = temp_dir("noisy-sse-child");
    fs::create_dir_all(&dir).unwrap();
    let script_path = dir.join("server.ps1");
    fs::write(
        &script_path,
        r#"$portIndex = [Array]::IndexOf($args, '--port')
$port = [int]$args[$portIndex + 1]
[Console]::Out.WriteLine(('x' * 1048576))
[Console]::Out.Flush()
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
$listener.Start()
while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
        $stream = $client.GetStream()
        $buffer = New-Object byte[] 4096
        $request = ''
        while (-not $request.Contains("`r`n`r`n")) {
            $count = $stream.Read($buffer, 0, $buffer.Length)
            if ($count -eq 0) { break }
            $request += [Text.Encoding]::ASCII.GetString($buffer, 0, $count)
        }
        $path = $request.Split("`r`n")[0].Split(' ')[1]
        $contentType = 'application/json'
        if ($path -eq '/session') {
            if ($args -contains 'invalid-session') {
                $body = '{}'
            } else {
                $body = '{"id":"session-noisy"}'
            }
        } elseif ($path -eq '/global/event') {
            $contentType = 'text/event-stream'
            $body = "event: session.idle`r`ndata: {`"type`":`"session.idle`"}`r`n`r`n"
        } else {
            $body = '{"ok":true}'
        }
        $bodyBytes = [Text.Encoding]::UTF8.GetBytes($body)
        $headers = "HTTP/1.1 200 OK`r`nContent-Type: $contentType`r`nContent-Length: $($bodyBytes.Length)`r`nConnection: close`r`n`r`n"
        $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers)
        $stream.Write($headerBytes, 0, $headerBytes.Length)
        $stream.Write($bodyBytes, 0, $bodyBytes.Length)
        $stream.Flush()
    } finally {
        $client.Dispose()
    }
}
"#,
    )
    .unwrap();
    (
        "powershell".to_string(),
        vec![
            "-NoProfile".to_string(),
            "-NonInteractive".to_string(),
            "-ExecutionPolicy".to_string(),
            "Bypass".to_string(),
            "-File".to_string(),
            script_path.to_string_lossy().to_string(),
        ],
    )
}

#[cfg(windows)]
pub(super) fn test_failing_sse_server_command() -> (String, Vec<String>) {
    let (command, mut args) = test_noisy_sse_server_command();
    args.push("invalid-session".to_string());
    (command, args)
}

#[cfg(windows)]
pub(super) fn test_adapter_manifest_command() -> (String, String) {
    ("cmd /C echo adapter-pty".to_string(), "cmd".to_string())
}

#[cfg(not(windows))]
pub(super) fn test_echo_command() -> (String, Vec<String>) {
    (
        "/bin/sh".to_string(),
        vec!["-lc".to_string(), "printf native-pty".to_string()],
    )
}

#[cfg(not(windows))]
pub(super) fn test_delayed_exit_command() -> (String, Vec<String>) {
    (
        "/bin/sh".to_string(),
        vec![
            "-c".to_string(),
            "sleep 0.4; printf delayed-pty".to_string(),
        ],
    )
}

#[cfg(not(windows))]
pub(super) fn test_delayed_file_write_command(path: &Path) -> (String, Vec<String>) {
    (
        "/bin/sh".to_string(),
        vec![
            "-c".to_string(),
            "sleep 0.8; printf orphaned > \"$1\"".to_string(),
            "sh".to_string(),
            path.to_string_lossy().to_string(),
        ],
    )
}

#[cfg(not(windows))]
pub(super) fn test_detached_delayed_file_write_command(
    path: &Path,
    ready_path: &Path,
) -> (String, Vec<String>) {
    (
        "/bin/sh".to_string(),
        vec![
            "-c".to_string(),
            "(sleep 0.8; printf orphaned > \"$1\") & printf ready > \"$2\"".to_string(),
            "sh".to_string(),
            path.to_string_lossy().to_string(),
            ready_path.to_string_lossy().to_string(),
        ],
    )
}

#[cfg(not(windows))]
pub(super) fn test_adapter_manifest_command() -> (String, String) {
    ("sh -c 'printf adapter-pty'".to_string(), "sh".to_string())
}

#[cfg(windows)]
pub(super) fn test_structured_echo_command() -> (String, Vec<String>) {
    (
            "powershell".to_string(),
            vec![
                "-NoProfile".to_string(),
                "-Command".to_string(),
                r#"$a=[Console]::In.ReadLine(); Write-Output "first:$a"; Write-Output '{"type":"result"}'; $b=[Console]::In.ReadLine(); Write-Output "second:$b"; Write-Output '{"type":"result"}'"#.to_string(),
            ],
        )
}

#[cfg(windows)]
pub(super) fn test_codex_app_server_command() -> (String, Vec<String>) {
    (
            "powershell".to_string(),
            vec![
                "-NoProfile".to_string(),
                "-Command".to_string(),
                r#"$a=[Console]::In.ReadLine(); Write-Output "client:$a"; Write-Output '{"id":1,"result":{}}'; $b=[Console]::In.ReadLine(); Write-Output "client:$b"; $c=[Console]::In.ReadLine(); Write-Output "client:$c"; Write-Output '{"id":2,"result":{"thread":{"id":"thread-native"}}}'; $d=[Console]::In.ReadLine(); Write-Output "client:$d"; Write-Output '{"id":99,"method":"item/commandExecution/requestApproval","params":{}}'; $e=[Console]::In.ReadLine(); Write-Output "client:$e"; Write-Output '{"method":"turn/completed","params":{}}'; $f=[Console]::In.ReadLine(); Write-Output "client:$f"; Write-Output '{"method":"turn/completed","params":{}}'"#.to_string(),
            ],
        )
}

#[cfg(windows)]
pub(super) fn test_capture_stdin_line_command() -> (String, Vec<String>) {
    (
        "powershell".to_string(),
        vec![
            "-NoProfile".to_string(),
            "-Command".to_string(),
            "$line=[Console]::In.ReadLine(); Write-Output $line".to_string(),
        ],
    )
}

#[cfg(windows)]
pub(super) fn test_claude_question_command() -> (String, Vec<String>) {
    (
        "powershell".to_string(),
        vec![
            "-NoProfile".to_string(),
            "-Command".to_string(),
            r#"$a=[Console]::In.ReadLine(); Write-Output '{"type":"control_request","request_id":"question-1","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":{"questions":[{"question":"Which workspace?","header":"Workspace","options":[{"label":"Primary","description":"Use the primary workspace"},{"label":"Secondary","description":"Use the secondary workspace"}],"multiSelect":false}]}}}'; $b=[Console]::In.ReadLine(); Write-Output "client:$b""#.to_string(),
        ],
    )
}

#[cfg(windows)]
pub(super) fn test_hermes_acp_command() -> (String, Vec<String>) {
    (
            "powershell".to_string(),
            vec![
                "-NoProfile".to_string(),
                "-Command".to_string(),
                r#"$a=[Console]::In.ReadLine(); Write-Output "client:$a"; Write-Output '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1}}'; $b=[Console]::In.ReadLine(); Write-Output "client:$b"; Write-Output '{"jsonrpc":"2.0","id":2,"result":{"session":{"id":"session-hermes"}}}'; $c=[Console]::In.ReadLine(); Write-Output "client:$c"; Write-Output '{"method":"session/update","params":{"sessionId":"session-hermes","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hermes heard you"}}}}'; Write-Output '{"method":"end_turn","params":{"sessionId":"session-hermes"}}'"#.to_string(),
            ],
        )
}

#[cfg(not(windows))]
pub(super) fn test_structured_echo_command() -> (String, Vec<String>) {
    (
            "/bin/sh".to_string(),
            vec![
                "-c".to_string(),
                "read a; printf 'first:%s\n{\"type\":\"result\"}\n' \"$a\"; read b; printf 'second:%s\n{\"type\":\"result\"}\n' \"$b\""
                    .to_string(),
            ],
        )
}

#[cfg(not(windows))]
pub(super) fn test_codex_app_server_command() -> (String, Vec<String>) {
    (
            "/bin/sh".to_string(),
            vec![
                "-c".to_string(),
                "read a; printf 'client:%s\n{\"id\":1,\"result\":{}}\n' \"$a\"; read b; printf 'client:%s\n' \"$b\"; read c; printf 'client:%s\n{\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-native\"}}}\n' \"$c\"; read d; printf 'client:%s\n{\"id\":99,\"method\":\"item/commandExecution/requestApproval\",\"params\":{}}\n' \"$d\"; read e; printf 'client:%s\n{\"method\":\"turn/completed\",\"params\":{}}\n' \"$e\"; read f; printf 'client:%s\n{\"method\":\"turn/completed\",\"params\":{}}\n' \"$f\""
                    .to_string(),
            ],
        )
}

#[cfg(not(windows))]
pub(super) fn test_capture_stdin_line_command() -> (String, Vec<String>) {
    (
        "/bin/sh".to_string(),
        vec![
            "-c".to_string(),
            "read line; printf '%s\n' \"$line\"".to_string(),
        ],
    )
}

#[cfg(not(windows))]
pub(super) fn test_claude_question_command() -> (String, Vec<String>) {
    (
        "/bin/sh".to_string(),
        vec![
            "-c".to_string(),
            "read a; printf '%s\n' '{\"type\":\"control_request\",\"request_id\":\"question-1\",\"request\":{\"subtype\":\"can_use_tool\",\"tool_name\":\"AskUserQuestion\",\"input\":{\"questions\":[{\"question\":\"Which workspace?\",\"header\":\"Workspace\",\"options\":[{\"label\":\"Primary\",\"description\":\"Use the primary workspace\"},{\"label\":\"Secondary\",\"description\":\"Use the secondary workspace\"}],\"multiSelect\":false}]}}}'; read b; printf 'client:%s\n' \"$b\""
                .to_string(),
        ],
    )
}

#[cfg(not(windows))]
pub(super) fn test_hermes_acp_command() -> (String, Vec<String>) {
    (
            "/bin/sh".to_string(),
            vec![
                "-c".to_string(),
                "read a; printf 'client:%s\n{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":1}}\n' \"$a\"; read b; printf 'client:%s\n{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"session\":{\"id\":\"session-hermes\"}}}\n' \"$b\"; read c; printf 'client:%s\n{\"method\":\"session/update\",\"params\":{\"sessionId\":\"session-hermes\",\"update\":{\"sessionUpdate\":\"agent_message_chunk\",\"content\":{\"type\":\"text\",\"text\":\"Hermes heard you\"}}}}\n{\"method\":\"end_turn\",\"params\":{\"sessionId\":\"session-hermes\"}}\n' \"$c\""
                    .to_string(),
            ],
        )
}
