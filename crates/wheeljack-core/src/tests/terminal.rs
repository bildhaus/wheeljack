use super::support::*;
use crate::*;

struct BlockingWriter {
    entered: Option<std::sync::mpsc::Sender<()>>,
    release: std::sync::mpsc::Receiver<()>,
}

impl std::io::Write for BlockingWriter {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        if let Some(entered) = self.entered.take() {
            let _ = entered.send(());
            let _ = self.release.recv();
        }
        Ok(buffer.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn wait_for_pty_exit(sink: &RecordingSink, session_id: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let events = sink.snapshot();
        if let Some((_, payload)) = events
            .into_iter()
            .find(|(event, payload)| event == "pty:exit" && payload["sessionId"] == session_id)
        {
            return payload;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for PTY exit: {session_id}"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn terminal_model_parses_ansi_frame_and_title() {
    let sink = Arc::new(RecordingSink::default());
    let mut terminal = TerminalModel::new("session_terminal".to_string(), 4, 20, sink.clone());
    let frame = terminal.feed(b"hi \x1b[1mB\x1b[0m\x1b]0;native title\x07");
    let first_line = frame.grid_rows[0]
        .runs
        .iter()
        .map(|run| run.text.as_str())
        .collect::<String>();

    assert!(first_line.starts_with("hi B"));
    assert!(frame.grid_rows[0]
        .runs
        .iter()
        .any(|run| run.text.contains('B') && run.style.bold));
    assert!(sink.snapshot().iter().any(|(event, payload)| {
        event == "terminal:title" && payload["title"] == "native title"
    }));
}

#[test]
fn terminal_frame_reports_reference_scrollback_limit() {
    let mut terminal = TerminalModel::new(
        "session_scrollback".to_string(),
        2,
        12,
        Arc::new(NullEventSink),
    );
    let frame = terminal.feed(b"one\r\ntwo\r\nthree\r\nfour");

    assert_eq!(frame.scrollback_limit, TERMINAL_SCROLLBACK_LINES);
    assert!(frame.scrollback_line_count > 0);
    assert_eq!(frame.grid_rows.len(), 2);
}

#[test]
fn terminal_frame_reports_verbose_metrics_when_enabled() {
    set_terminal_metrics_enabled_for_test(true);
    let mut terminal = TerminalModel::new(
        "session_metrics".to_string(),
        2,
        12,
        Arc::new(NullEventSink),
    );
    let payload = serde_json::to_value(terminal.feed(b"metrics")).unwrap();
    set_terminal_metrics_enabled_for_test(false);

    assert!(payload["metrics"]["frameBuildMs"].as_f64().unwrap() >= 0.0);
}

#[test]
fn terminal_delta_frame_uses_dirty_rows_after_full_snapshot() {
    let mut terminal =
        TerminalModel::new("session_delta".to_string(), 2, 20, Arc::new(NullEventSink));
    let full = terminal.snapshot_and_reset_damage();
    assert_eq!(full.grid_rows.len(), 2);
    assert!(full.dirty_rows.is_empty());

    terminal.feed_bytes(b"delta");
    let delta = terminal.snapshot_delta().unwrap();

    assert!(delta.grid_rows.is_empty());
    assert!(delta.dirty_rows.iter().any(|row| row.index == 0));
    assert!(delta.dirty_rows[0]
        .runs
        .iter()
        .any(|run| run.text.contains("delta")));
}

#[test]
fn terminal_frame_coalescer_emits_latest_snapshot_for_burst() {
    let sink = Arc::new(RecordingSink::default());
    let terminal = Arc::new(Mutex::new(TerminalModel::new(
        "session_coalesce".to_string(),
        2,
        40,
        sink.clone(),
    )));
    let frame_tx = spawn_terminal_frame_coalescer(terminal.clone(), sink.clone());

    for chunk in [b"one".as_slice(), b" two".as_slice(), b" three".as_slice()] {
        lock_terminal_model(&terminal).feed_bytes(chunk);
        frame_tx.send(()).unwrap();
    }

    let deadline = Instant::now() + Duration::from_millis(200);
    while Instant::now() < deadline {
        let frames: Vec<_> = sink
            .snapshot()
            .into_iter()
            .filter(|(event, _)| event == "terminal:frame")
            .collect();
        if frames.len() == 1 && frames[0].1.to_string().contains("one two three") {
            drop(frame_tx);
            return;
        }
        thread::sleep(Duration::from_millis(5));
    }

    let frames: Vec<_> = sink
        .snapshot()
        .into_iter()
        .filter(|(event, _)| event == "terminal:frame")
        .collect();
    drop(frame_tx);
    assert_eq!(frames.len(), 1, "frames: {frames:?}");
    assert!(frames[0].1.to_string().contains("one two three"));
}

#[test]
fn terminal_model_lock_recovers_from_poison() {
    let terminal = Arc::new(Mutex::new(TerminalModel::new(
        "session_poison".to_string(),
        2,
        12,
        Arc::new(NullEventSink),
    )));
    let _ = std::panic::catch_unwind(|| {
        let _guard = terminal.lock().unwrap();
        panic!("poison terminal model");
    });

    let mut terminal = lock_terminal_model(&terminal);
    let frame = terminal.feed(b"alive");
    let first_line = frame.grid_rows[0]
        .runs
        .iter()
        .map(|run| run.text.as_str())
        .collect::<String>();
    assert!(first_line.starts_with("alive"));
}

#[test]
fn terminal_frame_reports_mouse_modes() {
    let mut terminal =
        TerminalModel::new("session_mouse".to_string(), 4, 20, Arc::new(NullEventSink));
    let frame = terminal.feed(b"\x1b[?1000h\x1b[?1006h\x1b[?1007h");

    assert!(frame.mouse_reporting);
    assert!(frame.sgr_mouse);
    assert!(!frame.mouse_drag);
    assert!(!frame.mouse_motion);
    assert!(frame.alternate_scroll);
}

#[test]
fn terminal_frame_reports_alt_cursor_resize_and_color_parity() {
    let mut terminal =
        TerminalModel::new("session_parity".to_string(), 3, 10, Arc::new(NullEventSink));
    terminal.resize(5, 16);
    let frame =
        terminal.feed(b"\x1b[?1049h\x1b[?25l\x1b[2;5H\x1b[38;2;12;34;56mT\x1b[48;5;201mB\x1b[0m");

    assert_eq!(frame.rows, 5);
    assert_eq!(frame.cols, 16);
    assert!(frame.alt_screen);
    assert!(!frame.cursor.visible);
    assert_eq!(frame.cursor.row, 1);
    assert_eq!(frame.cursor.col, 6);
    assert!(frame.grid_rows[1]
        .runs
        .iter()
        .any(|run| run.text.contains('T')
            && run.style.fg.contains("Spec")
            && run.style.fg.contains("r: 12")
            && run.style.fg.contains("g: 34")
            && run.style.fg.contains("b: 56")));
    assert!(frame.grid_rows[1]
        .runs
        .iter()
        .any(|run| run.text.contains('B') && run.style.bg.contains("Indexed(201)")));
}

#[test]
fn terminal_frame_reports_native_cursor_modes_and_unicode_run_geometry() {
    let mut terminal =
        TerminalModel::new("session_native".to_string(), 2, 12, Arc::new(NullEventSink));
    let frame = terminal
        .feed("\x1b[5 q\x1b[?1h\x1b=\x1b[?2004h\x1b[?1004h\x1b[4h\x1b[?6hA好e\u{301}".as_bytes());

    assert_eq!(frame.cursor.shape, "beam");
    assert!(frame.cursor.blinking);
    assert!(frame.application_cursor);
    assert!(frame.application_keypad);
    assert!(frame.bracketed_paste);
    assert!(frame.focus_events);
    assert!(frame.insert_mode);
    assert!(frame.line_wrap);
    assert!(frame.origin_mode);
    assert!(!frame.kitty_keyboard);
    assert_eq!(frame.viewport_offset, 0);

    let wide = frame.grid_rows[0]
        .runs
        .iter()
        .find(|run| run.text.contains('好'))
        .unwrap();
    assert_eq!(wide.column, 1);
    assert_eq!(wide.cell_width, 2);
    assert_eq!(wide.text, "好");

    let combining = frame.grid_rows[0]
        .runs
        .iter()
        .find(|run| run.text.contains('e'))
        .unwrap();
    assert_eq!(combining.column, 3);
    assert!(combining.text.starts_with("e\u{301}"));

    let payload = serde_json::to_value(&frame).unwrap();
    assert_eq!(payload["cursor"]["shape"], "beam");
    assert_eq!(payload["applicationCursor"], true);
    assert_eq!(payload["viewportOffset"], 0);
    let wide = payload["gridRows"][0]["runs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|run| run["text"] == "好")
        .unwrap();
    assert_eq!(wide["column"], 1);
    assert_eq!(wide["cellWidth"], 2);
}

#[test]
fn terminal_viewport_returns_authoritative_styled_scrollback() {
    let mut terminal = TerminalModel::new(
        "session_viewport".to_string(),
        2,
        12,
        Arc::new(NullEventSink),
    );
    terminal.feed_bytes(b"one\r\ntwo\r\nthree\r\nfour");

    let scrolled = terminal.set_viewport(1);
    let text = scrolled
        .grid_rows
        .iter()
        .flat_map(|row| row.runs.iter())
        .map(|run| run.text.as_str())
        .collect::<String>();
    assert_eq!(scrolled.viewport_offset, 1);
    assert!(!scrolled.cursor.visible);
    assert!(text.contains("two"));
    assert!(text.contains("three"));
    assert!(!text.contains("four"));

    let top = terminal.set_viewport(usize::MAX);
    assert_eq!(top.viewport_offset, top.scrollback_line_count);
    let bottom = terminal.set_viewport(0);
    assert_eq!(bottom.viewport_offset, 0);
    assert!(bottom.cursor.visible);
}

#[test]
fn pty_spawn_runs_command_and_emits_terminal_frame() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("pty-spawn"), sink.clone()).expect("core");
    let (command, args) = test_echo_command();
    let request = json!({
        "id": "pty",
        "command": "pty_spawn",
        "payload": {
            "command": command,
            "args": args,
            "cwd": std::env::current_dir().unwrap(),
            "rows": 5,
            "cols": 40
        }
    });
    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let events = sink.snapshot();
        let saw_frame = events.iter().any(|(event, payload)| {
            event == "terminal:frame" && payload.to_string().contains("native-pty")
        });
        let saw_exit = events.iter().any(|(event, _)| event == "pty:exit");
        if saw_frame && saw_exit {
            let (_, exit_payload) = events
                .iter()
                .find(|(event, _)| event == "pty:exit")
                .unwrap();
            assert_eq!(exit_payload["exitCode"], 0);
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for pty frame and exit; events: {events:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn pty_spawn_runs_one_shot_shell_commands_with_cwd_label_and_exit_status() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("pty-shell-command"), sink.clone()).expect("core");
    let cwd = temp_dir("pty-shell-command-cwd");
    fs::create_dir_all(&cwd).unwrap();
    #[cfg(windows)]
    let passing_command = "echo shell-ok & echo cwd-ok>shell-marker.txt";
    #[cfg(not(windows))]
    let passing_command = "printf 'shell-ok\\n'; printf cwd-ok > shell-marker.txt";

    let passing: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "shell-pass",
                "command": "pty_spawn",
                "payload": {
                    "adapterId": "verification",
                    "shellCommand": passing_command,
                    "cwd": cwd
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(passing["ok"], true);
    assert_eq!(passing["payload"]["adapterId"], "verification");
    let passing_id = passing["payload"]["id"].as_str().unwrap();
    assert_eq!(wait_for_pty_exit(&sink, passing_id)["exitCode"], 0);
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let transcript: Value = serde_json::from_str(
            &core.call_json(
                &json!({
                    "id": "shell-transcript",
                    "command": "session_transcript",
                    "payload": { "sessionId": passing_id }
                })
                .to_string(),
            ),
        )
        .unwrap();
        if transcript["payload"]["text"]
            .as_str()
            .unwrap()
            .contains("shell-ok")
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "shell output was not persisted in the session transcript"
        );
        thread::sleep(Duration::from_millis(20));
    }
    #[cfg(windows)]
    let expected_marker = "cwd-ok\r\n";
    #[cfg(not(windows))]
    let expected_marker = "cwd-ok";
    assert_eq!(
        fs::read_to_string(cwd.join("shell-marker.txt")).unwrap(),
        expected_marker
    );

    #[cfg(windows)]
    let failing_command = "exit /b 7";
    #[cfg(not(windows))]
    let failing_command = "exit 7";
    let failing: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "shell-fail",
                "command": "pty_spawn",
                "payload": {
                    "shellCommand": failing_command,
                    "cwd": cwd
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(failing["ok"], true);
    let failing_id = failing["payload"]["id"].as_str().unwrap();
    assert_eq!(wait_for_pty_exit(&sink, failing_id)["exitCode"], 7);
    let (status, exit_code): (String, i32) = core
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT status, exit_code FROM sessions WHERE id = ?1",
            params![failing_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!((status.as_str(), exit_code), ("failed", 7));

    let conflicting: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "shell-conflict",
                "command": "pty_spawn",
                "payload": {
                    "command": "git",
                    "shellCommand": "git status",
                    "cwd": cwd
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(conflicting["ok"], false);
    assert!(conflicting["error"]["message"]
        .as_str()
        .unwrap()
        .contains("not both"));
}

#[cfg(windows)]
#[test]
fn pty_shell_command_preserves_windows_quotes_expansion_and_exact_text() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("pty-shell-command-quotes"), sink.clone()).expect("core");
    let cwd = temp_dir("pty-shell-command-quotes-cwd");
    let tool_dir = cwd.join("tool & quoted path");
    fs::create_dir_all(&tool_dir).unwrap();
    let tool = tool_dir.join("capture argument.cmd");
    fs::write(&tool, "@echo off\r\necho quoted:%~1\r\n").unwrap();
    let shell_command = format!(
        "\"{}\" \"spaced argument\" && echo expanded:%TEMP% & echo substitution:%COMSPEC:\"=% & for %i in (first second) do @echo loop:%i   ",
        tool.to_string_lossy()
    );
    let spawned: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "shell-quotes",
                "command": "pty_spawn",
                "payload": {
                    "shellCommand": shell_command,
                    "cwd": cwd
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(spawned["ok"], true);
    let session_id = spawned["payload"]["id"].as_str().unwrap();
    let exit = wait_for_pty_exit(&sink, session_id);

    let deadline = Instant::now() + Duration::from_secs(5);
    let transcript = loop {
        let response: Value = serde_json::from_str(
            &core.call_json(
                &json!({
                    "id": "shell-quotes-transcript",
                    "command": "session_transcript",
                    "payload": { "sessionId": session_id }
                })
                .to_string(),
            ),
        )
        .unwrap();
        let transcript = response["payload"]["text"].as_str().unwrap();
        if transcript.contains("quoted:spaced argument")
            && transcript.contains("expanded:")
            && !transcript.contains("%TEMP%")
            && transcript.contains(&format!(
                "substitution:{}",
                std::env::var("COMSPEC").unwrap()
            ))
            && transcript.contains("loop:first")
            && transcript.contains("loop:second")
        {
            break transcript.to_string();
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for quoted shell transcript: {transcript}"
        );
        thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(exit["exitCode"], 0, "{transcript}");
    assert!(transcript.contains("quoted:spaced argument"));
    assert!(!transcript.contains("Microsoft Windows [Version"));

    let command_json: String = core
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT command_json FROM sessions WHERE id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .unwrap();
    let command_value = serde_json::from_str::<Value>(&command_json).unwrap();
    assert_eq!(command_value["shellCommand"], shell_command);
    assert_eq!(command_value["source"], "shell_command");
}

#[cfg(windows)]
#[test]
fn pty_shell_command_ignores_worktree_powershell_shadow() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("pty-shell-command-shadow"), sink.clone()).expect("core");
    let cwd = temp_dir("pty-shell-command-shadow-cwd");
    fs::create_dir_all(&cwd).unwrap();
    fs::copy(
        std::env::var("COMSPEC").unwrap(),
        cwd.join("powershell.exe"),
    )
    .unwrap();

    let spawned: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "shell-shadow",
                "command": "pty_spawn",
                "payload": {
                    "shellCommand": "echo trusted-shell",
                    "cwd": cwd
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(spawned["ok"], true);
    let session_id = spawned["payload"]["id"].as_str().unwrap();
    assert_eq!(wait_for_pty_exit(&sink, session_id)["exitCode"], 0);
}

#[cfg(windows)]
#[test]
fn windows_process_cleanup_uses_the_system_taskkill() {
    let taskkill = windows_system32_executable("taskkill.exe");
    assert!(taskkill.is_absolute());
    assert_eq!(
        taskkill.file_name().and_then(|name| name.to_str()),
        Some("taskkill.exe")
    );
    assert_eq!(
        taskkill
            .parent()
            .and_then(|path| path.file_name())
            .and_then(|name| name.to_str()),
        Some("System32")
    );
}

#[cfg(windows)]
#[test]
fn pty_shell_command_forwards_stdin_without_startup_prompt() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("pty-shell-command-stdin"), sink.clone()).expect("core");
    let spawned: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "shell-stdin",
                "command": "pty_spawn",
                "payload": {
                    "shellCommand": "set /p WJ_INPUT= & set WJ_INPUT",
                    "cwd": std::env::current_dir().unwrap()
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(spawned["ok"], true);
    let session_id = spawned["payload"]["id"].as_str().unwrap();
    let wrote: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "shell-stdin-write",
                "command": "pty_write",
                "payload": { "sessionId": session_id, "data": "from-pty\r" }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(wrote["ok"], true);
    assert_eq!(wait_for_pty_exit(&sink, session_id)["exitCode"], 0);

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let transcript: Value = serde_json::from_str(
            &core.call_json(
                &json!({
                    "id": "shell-stdin-transcript",
                    "command": "session_transcript",
                    "payload": { "sessionId": session_id }
                })
                .to_string(),
            ),
        )
        .unwrap();
        let text = transcript["payload"]["text"].as_str().unwrap();
        if text.contains("WJ_INPUT=from-pty") {
            assert!(!text.contains("Microsoft Windows [Version"));
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for stdin output: {text}"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(windows)]
#[test]
fn pty_shell_command_cancellation_stops_the_wrapper_tree() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("pty-shell-command-kill"), sink.clone()).expect("core");
    let spawned: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "shell-kill",
                "command": "pty_spawn",
                "payload": {
                    "shellCommand": "powershell -NoProfile -NonInteractive -Command \"Start-Sleep -Seconds 30\"",
                    "cwd": std::env::current_dir().unwrap()
                }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(spawned["ok"], true);
    let session_id = spawned["payload"]["id"].as_str().unwrap();
    let killed: Value = serde_json::from_str(
        &core.call_json(
            &json!({
                "id": "shell-kill-session",
                "command": "session_kill",
                "payload": { "sessionId": session_id }
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(killed["ok"], true);
    assert!(wait_for_pty_exit(&sink, session_id)["exitCode"].is_number());
}

#[test]
fn pty_exit_persists_terminal_node_state_across_reload() {
    let init = test_init("pty-exit-reload");
    let core = Core::new(init.clone(), Arc::new(RecordingSink::default())).expect("core");
    {
        let db = core.lock_db().unwrap();
        db.execute_batch(
            r#"
            INSERT INTO projects (id, name, path, created_at, updated_at)
            VALUES ('project_exit', 'Exit', '.', 'now', 'now');
            INSERT INTO canvases (id, project_id, name, theme_id, camera_json, created_at, updated_at)
            VALUES ('canvas_exit', 'project_exit', 'Main', 'mono-dark',
                    '{"x":0,"y":0,"scale":1}', 'now', 'now');
            INSERT INTO nodes
              (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
            VALUES
              ('node_exit', 'canvas_exit', 'shell_terminal', 'Shell', 0, 0, 600, 360, 0,
               '{"status":"starting","transcript":[]}', 'now', 'now');
            "#,
        )
        .unwrap();
    }

    let (command, args) = test_delayed_exit_command();
    let spawn = json!({
        "id": "pty",
        "command": "pty_spawn",
        "payload": {
            "nodeId": "node_exit",
            "command": command,
            "args": args,
            "cwd": std::env::current_dir().unwrap()
        }
    });
    let spawned: Value = serde_json::from_str(&core.call_json(&spawn.to_string())).unwrap();
    assert_eq!(spawned["ok"], true);
    let session_id = spawned["payload"]["id"].as_str().unwrap();
    {
        let db = core.lock_db().unwrap();
        db.execute(
            "UPDATE nodes SET data_json = ?1 WHERE id = 'node_exit'",
            params![json!({
                "status": "running",
                "sessionId": session_id,
                "transcript": []
            })
            .to_string()],
        )
        .unwrap();
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let status = core
            .lock_db()
            .unwrap()
            .query_row(
                "SELECT status FROM sessions WHERE id = ?1",
                params![session_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        if status == "completed" {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for persisted exit"
        );
        thread::sleep(Duration::from_millis(20));
    }
    drop(core);

    let reloaded = Core::new(init, Arc::new(NullEventSink)).expect("reload core");
    let canvas: Value = serde_json::from_str(
        &reloaded.call_json(
            &json!({
                "id": "canvas",
                "command": "canvas_get",
                "payload": { "canvasId": "canvas_exit" }
            })
            .to_string(),
        ),
    )
    .unwrap();
    let data = &canvas["payload"]["nodes"][0]["data"];
    assert_eq!(data["status"], "completed");
    assert!(data.get("sessionId").is_none());
    assert_eq!(data["lastSessionId"], session_id);
    let marker_count = data["transcript"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|value| value.as_str() == Some("pty -> process exited (0)"))
        .count();
    assert_eq!(marker_count, 1);
}

#[test]
fn missing_exit_code_persists_disconnected_once() {
    let db = Connection::open_in_memory().unwrap();
    run_migrations(&db).unwrap();
    db.execute_batch(
        r#"
        INSERT INTO projects (id, name, path, created_at, updated_at)
        VALUES ('project_disconnect', 'Disconnect', '.', 'now', 'now');
        INSERT INTO canvases (id, project_id, name, theme_id, camera_json, created_at, updated_at)
        VALUES ('canvas_disconnect', 'project_disconnect', 'Main', 'mono-dark',
                '{"x":0,"y":0,"scale":1}', 'now', 'now');
        INSERT INTO nodes
          (id, canvas_id, kind, title, x, y, width, height, z_index, data_json, created_at, updated_at)
        VALUES
          ('node_disconnect', 'canvas_disconnect', 'agent_terminal', 'Agent', 0, 0, 600, 360, 0,
           '{"status":"running","sessionId":"session_disconnect","transcript":[]}', 'now', 'now');
        INSERT INTO sessions
          (id, node_id, adapter_id, command_json, cwd, status, created_at, updated_at)
        VALUES
          ('session_disconnect', 'node_disconnect', 'codex-cli', '{}', '.', 'running', 'now', 'now');
        "#,
    )
    .unwrap();

    mark_session_exited(&db, "session_disconnect", None).unwrap();
    mark_session_exited(&db, "session_disconnect", None).unwrap();

    let status: String = db
        .query_row(
            "SELECT status FROM sessions WHERE id = 'session_disconnect'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let data_json: String = db
        .query_row(
            "SELECT data_json FROM nodes WHERE id = 'node_disconnect'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let data: Value = serde_json::from_str(&data_json).unwrap();
    let marker_count = data["transcript"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|value| value.as_str() == Some("pty -> process disconnected"))
        .count();
    let event_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM session_events WHERE session_id = 'session_disconnect'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(status, "disconnected");
    assert_eq!(data["status"], "disconnected");
    assert!(data.get("sessionId").is_none());
    assert_eq!(data["lastSessionId"], "session_disconnect");
    assert_eq!(marker_count, 1);
    assert_eq!(event_count, 1);
}

#[test]
fn pty_spawn_rolls_back_child_when_session_persistence_fails() {
    let core = Core::new(
        test_init("pty-spawn-rollback"),
        Arc::new(RecordingSink::default()),
    )
    .expect("core");
    core.lock_db()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER fail_session_insert BEFORE INSERT ON sessions
             BEGIN SELECT RAISE(ABORT, 'forced session insert failure'); END;",
        )
        .unwrap();
    let marker = temp_dir("pty-spawn-orphan-marker").join("marker.txt");
    fs::create_dir_all(marker.parent().unwrap()).unwrap();
    #[cfg(windows)]
    let (_, args) = test_delayed_file_write_command(&marker);
    #[cfg(not(windows))]
    let (command, args) = test_delayed_file_write_command(&marker);
    #[cfg(windows)]
    let request = json!({
        "id": "pty",
        "command": "pty_spawn",
        "payload": {
            "shellCommand": args[3],
            "cwd": std::env::current_dir().unwrap()
        }
    });
    #[cfg(not(windows))]
    let request = json!({
        "id": "pty",
        "command": "pty_spawn",
        "payload": {
            "command": command,
            "args": args,
            "cwd": std::env::current_dir().unwrap()
        }
    });

    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], false);
    thread::sleep(Duration::from_millis(1200));
    assert!(!marker.exists(), "failed spawn left its child running");
    assert!(core.lock_pty_sessions().unwrap().is_empty());
    let session_count: i64 = core
        .lock_db()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .unwrap();
    assert_eq!(session_count, 0);
}

#[test]
fn session_prompt_send_applies_pty_strategy_and_guard() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("session-prompt-pty"), sink.clone()).expect("core");
    let (command, args) = test_structured_echo_command();
    let spawn = json!({
        "id": "pty",
        "command": "pty_spawn",
        "payload": {
            "command": command,
            "args": args,
            "cwd": std::env::current_dir().unwrap(),
            "rows": 5,
            "cols": 80
        }
    });
    let spawned: Value = serde_json::from_str(&core.call_json(&spawn.to_string())).unwrap();
    assert_eq!(spawned["ok"], true);
    let session_id = spawned["payload"]["id"].as_str().unwrap().to_string();

    let blocked = json!({
        "id": "blocked",
        "command": "session_prompt_send",
        "payload": {
            "sessionId": session_id,
            "adapterId": "claude-code",
            "prompt": "should not send",
            "terminalText": "Security guide\nYes, I trust this folder\nEnter to confirm"
        }
    });
    let blocked: Value = serde_json::from_str(&core.call_json(&blocked.to_string())).unwrap();
    assert_eq!(blocked["ok"], false);
    assert!(blocked["error"]["message"]
        .as_str()
        .unwrap()
        .contains("folder trust confirmation"));

    let send = json!({
        "id": "send",
        "command": "session_prompt_send",
        "payload": {
            "sessionId": session_id,
            "adapterId": "generic-shell",
            "prompt": "alpha",
            "terminalText": ""
        }
    });
    let sent: Value = serde_json::from_str(&core.call_json(&send.to_string())).unwrap();
    assert_eq!(sent["ok"], true);
    assert_eq!(sent["payload"]["transport"], "pty");
    assert_eq!(sent["payload"]["strategy"], "stdin");

    let deadline = Instant::now() + Duration::from_secs(5);
    while !sink.snapshot().iter().any(|(event, payload)| {
        event == "terminal:frame" && payload.to_string().contains("first:alpha")
    }) {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for PTY prompt echo"
        );
        thread::sleep(Duration::from_millis(20));
    }

    let kill = json!({
        "id": "kill",
        "command": "session_kill",
        "payload": { "sessionId": session_id }
    });
    let killed: Value = serde_json::from_str(&core.call_json(&kill.to_string())).unwrap();
    assert_eq!(killed["ok"], true);
    let deadline = Instant::now() + Duration::from_secs(5);
    while !sink
        .snapshot()
        .iter()
        .any(|(event, payload)| event == "pty:exit" && payload["sessionId"] == session_id)
    {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for the killed PTY session to exit"
        );
        thread::sleep(Duration::from_millis(20));
    }
    let killed_again: Value = serde_json::from_str(&core.call_json(&kill.to_string())).unwrap();
    assert_eq!(killed_again["ok"], true);
}

#[test]
fn blocked_pty_writer_does_not_block_another_session() {
    let core = Arc::new(
        Core::new(test_init("pty-writer-isolation"), Arc::new(NullEventSink)).expect("core"),
    );
    let (command, args) = test_structured_echo_command();
    let spawn = |id: &str| {
        let response: Value = serde_json::from_str(
            &core.call_json(
                &json!({
                    "id": id,
                    "command": "pty_spawn",
                    "payload": {
                        "command": command,
                        "args": args,
                        "cwd": std::env::current_dir().unwrap()
                    }
                })
                .to_string(),
            ),
        )
        .unwrap();
        assert_eq!(response["ok"], true);
        response["payload"]["id"].as_str().unwrap().to_string()
    };
    let first_id = spawn("first");
    let second_id = spawn("second");
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let retained_pty_writers = {
        let mut sessions = core.lock_pty_sessions().unwrap();
        let retained = [
            sessions.get(&first_id).unwrap().writer.clone(),
            sessions.get(&second_id).unwrap().writer.clone(),
        ];
        sessions.get_mut(&first_id).unwrap().writer =
            Arc::new(Mutex::new(Box::new(BlockingWriter {
                entered: Some(entered_tx),
                release: release_rx,
            })));
        sessions.get_mut(&second_id).unwrap().writer =
            Arc::new(Mutex::new(Box::new(std::io::sink())));
        retained
    };

    let (first_done_tx, first_done_rx) = std::sync::mpsc::channel();
    let first_core = core.clone();
    let first_request_id = first_id.clone();
    let first = thread::spawn(move || {
        let response = first_core.call_json(
            &json!({
                "id": "write-first",
                "command": "pty_write",
                "payload": { "sessionId": first_request_id, "data": "blocked" }
            })
            .to_string(),
        );
        let _ = first_done_tx.send(response);
    });
    entered_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("first writer never blocked");

    let (second_done_tx, second_done_rx) = std::sync::mpsc::channel();
    let second_core = core.clone();
    let second_request_id = second_id.clone();
    let second = thread::spawn(move || {
        let response = second_core.call_json(
            &json!({
                "id": "write-second",
                "command": "pty_write",
                "payload": { "sessionId": second_request_id, "data": "independent" }
            })
            .to_string(),
        );
        let _ = second_done_tx.send(response);
    });
    let independent = second_done_rx.recv_timeout(Duration::from_secs(2)).ok();
    let isolated = independent.is_some();
    let _ = release_tx.send(());
    let first_response = first_done_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("first writer did not resume");
    let second_response = independent.unwrap_or_else(|| {
        second_done_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("second writer did not finish after cleanup")
    });
    first.join().unwrap();
    second.join().unwrap();
    core.shutdown();
    drop(retained_pty_writers);

    assert!(isolated, "first writer held the global PTY map");
    assert_eq!(
        serde_json::from_str::<Value>(&first_response).unwrap()["ok"],
        true
    );
    assert_eq!(
        serde_json::from_str::<Value>(&second_response).unwrap()["ok"],
        true
    );
}

#[test]
fn system_default_shell_resolves_to_interactive_shell() {
    let (_command, args) = resolve_command("system-default-shell", &[]);
    if cfg!(windows) {
        assert_eq!(args, vec!["/d".to_string(), "/k".to_string()]);
    } else {
        assert!(args.is_empty());
    }
}

#[test]
fn pty_resize_ignores_a_stale_session() {
    let core = Core::new(test_init("stale-pty-resize"), Arc::new(NullEventSink)).expect("core");
    let request = json!({
        "id": "resize",
        "command": "pty_resize",
        "payload": { "sessionId": "already-exited", "rows": 24, "cols": 80 }
    });

    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();

    assert_eq!(response["ok"], true);
}

#[test]
fn notifications_emit_for_terminal_exit_and_respect_settings() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("notifications-enabled"), sink.clone()).expect("core");
    core.events.emit(
        "pty:exit",
        &json!({
            "sessionId": "session_notify",
            "exitCode": 0,
            "signal": null
        }),
    );

    assert!(sink.snapshot().iter().any(|(event, payload)| {
        event == "notification:show"
            && payload["kind"] == "finished"
            && payload["sessionId"] == "session_notify"
    }));

    core.events.emit(
        "agent:structured-exit",
        &json!({
            "sessionId": "session_agent_completed",
            "exitCode": 1,
            "terminationReason": "completed"
        }),
    );
    core.events.emit(
        "agent:structured-exit",
        &json!({
            "sessionId": "session_agent_canceled",
            "exitCode": 1,
            "terminationReason": "canceled"
        }),
    );
    assert!(sink.snapshot().iter().any(|(event, payload)| {
        event == "notification:show"
            && payload["kind"] == "finished"
            && payload["sessionId"] == "session_agent_completed"
    }));
    assert!(!sink.snapshot().iter().any(|(event, payload)| {
        event == "notification:show" && payload["sessionId"] == "session_agent_canceled"
    }));

    let disabled_sink = Arc::new(RecordingSink::default());
    let disabled =
        Core::new(test_init("notifications-disabled"), disabled_sink.clone()).expect("core");
    let response: Value = serde_json::from_str(&disabled.call_json(
        r#"{"id":"settings","command":"settings_import","payload":{"notificationsEnabled":false}}"#,
    ))
    .unwrap();
    assert_eq!(response["ok"], true);
    disabled.events.emit(
        "terminal:bell",
        &json!({
            "sessionId": "session_silent"
        }),
    );

    assert!(!disabled_sink
        .snapshot()
        .iter()
        .any(|(event, _)| event == "notification:show"));
}

#[test]
fn notifications_rate_limit_per_session() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("notifications-rate"), sink.clone()).expect("core");
    for _ in 0..2 {
        core.events.emit(
            "terminal:bell",
            &json!({
                "sessionId": "session_rate"
            }),
        );
    }

    let notifications = sink
        .snapshot()
        .into_iter()
        .filter(|(event, _)| event == "notification:show")
        .count();
    assert_eq!(notifications, 1);
}

#[test]
fn pty_spawn_uses_adapter_manifest_when_command_is_empty() {
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(test_init("pty-adapter-launch"), sink.clone()).expect("core");
    let (launch_command, executable) = test_adapter_manifest_command();
    let save = json!({
        "id": "save",
        "command": "adapter_save",
        "payload": {
            "id": "custom-pty",
            "displayName": "Custom PTY",
            "icon": "terminal",
            "executables": [executable],
            "supportedPlatforms": [current_platform_id()],
            "launchCommand": launch_command,
            "promptInjection": "stdin",
            "status": "unknown",
            "setupHint": "test"
        }
    });
    let saved: Value = serde_json::from_str(&core.call_json(&save.to_string())).unwrap();
    assert_eq!(saved["ok"], true);

    let spawn = json!({
        "id": "pty",
        "command": "pty_spawn",
        "payload": {
            "adapterId": "custom-pty",
            "cwd": std::env::current_dir().unwrap(),
            "rows": 5,
            "cols": 80
        }
    });
    let spawned: Value = serde_json::from_str(&core.call_json(&spawn.to_string())).unwrap();
    assert_eq!(spawned["ok"], true);
    let session_id = spawned["payload"]["id"].as_str().unwrap().to_string();

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let events = sink.snapshot();
        let saw_frame = events.iter().any(|(event, payload)| {
            event == "terminal:frame" && payload.to_string().contains("adapter-pty")
        });
        let saw_exit = events
            .iter()
            .any(|(event, payload)| event == "pty:exit" && payload["sessionId"] == session_id);
        if saw_frame && saw_exit {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for adapter PTY launch; events: {events:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }

    let db = core.lock_db().unwrap();
    let command_json: String = db
        .query_row(
            "SELECT command_json FROM sessions WHERE id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .unwrap();
    let command_value = serde_json::from_str::<Value>(&command_json).unwrap();
    assert_eq!(command_value["source"], "adapter_manifest");
}
