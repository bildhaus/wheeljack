use super::support::*;
use crate::*;

#[test]
fn updater_platform_status_and_debug_check_roundtrip() {
    let mut init = test_init("updater");
    init.version = "0.1.0-dev".to_string();
    init.test_mode = false;
    let core = Core::new(init, Arc::new(NullEventSink)).expect("core");
    let platform: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"platform","command":"updater_platform","payload":{}}"#),
    )
    .unwrap();
    assert_eq!(platform["ok"], true);
    assert!(platform["payload"]["assetName"]
        .as_str()
        .unwrap()
        .starts_with("wheeljack"));

    let status: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"status","command":"updater_status","payload":{}}"#),
    )
    .unwrap();
    assert_eq!(status["payload"]["currentVersion"], "0.1.0-dev");
    assert!(status["payload"]["update"].is_null());

    let check: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"check","command":"updater_check","payload":{}}"#),
    )
    .unwrap();
    dbg!(&check);
    assert_eq!(check["ok"], true);
    assert_eq!(
        check["payload"]["message"],
        "Auto-update is disabled in dev builds."
    );
}

#[test]
#[cfg(windows)]
fn updater_check_and_download_roundtrip_uses_test_feed_override() {
    let asset = fs::read(std::env::current_exe().unwrap()).unwrap();
    let feed_url = start_fake_update_server(
        asset.clone(),
        Some(format!(
            "{}  {}",
            sha256_hex(&asset),
            current_updater_platform().asset_name
        )),
        Some(asset.len() as u64),
    );
    let _feed_guard = EnvVarGuard::set("WHEELJACK_UPDATE_FEED_URL", &feed_url);
    let mut init = test_init("updater-local-feed");
    init.version = "0.1.0".to_string();
    init.test_mode = true;
    let sink = Arc::new(RecordingSink::default());
    let core = Core::new(init, sink.clone()).expect("core");

    let check: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"check","command":"updater_check","payload":{}}"#),
    )
    .unwrap();
    assert_eq!(check["ok"], true);
    assert_eq!(check["payload"]["update"]["version"], "0.1.1");
    assert!(check["payload"]["update"]["downloadUrl"]
        .as_str()
        .unwrap()
        .starts_with("http://127.0.0.1"));

    let download: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"download","command":"updater_download","payload":{}}"#),
    )
    .unwrap();
    assert_eq!(download["ok"], true, "{download}");
    assert_eq!(download["payload"]["signatureStatus"], "unsigned");
    let update_path = PathBuf::from(download["payload"]["updatePath"].as_str().unwrap());
    assert_eq!(fs::read(update_path).unwrap(), asset);
    let phases = sink
        .snapshot()
        .into_iter()
        .filter(|(event, _)| event == "updater:progress")
        .filter_map(|(_, payload)| payload["phase"].as_str().map(ToString::to_string))
        .collect::<Vec<_>>();
    assert!(phases.starts_with(&["downloading".to_string()]));
    assert!(phases.contains(&"verifying".to_string()));
    assert!(phases.contains(&"preparing".to_string()));
    assert_eq!(phases.last().map(String::as_str), Some("ready"));
}

#[test]
fn updater_rejects_bad_or_unsafe_local_feed_assets() {
    let asset = b"wheeljack native update".to_vec();

    let bad_hash_feed = start_fake_update_server(
        asset.clone(),
        Some(format!(
            "{}  {}",
            "0".repeat(64),
            current_updater_platform().asset_name
        )),
        Some(asset.len() as u64),
    );
    let mut init = test_init("updater-bad-hash");
    init.version = "0.1.0".to_string();
    init.test_mode = true;
    init.update_feed_url = Some(bad_hash_feed);
    let core = Core::new(init, Arc::new(NullEventSink)).expect("core");
    let bad_hash: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"download","command":"updater_download","payload":{}}"#),
    )
    .unwrap();
    assert_eq!(bad_hash["ok"], false);
    assert!(bad_hash["error"]["message"]
        .as_str()
        .unwrap()
        .contains("checksum mismatch"));

    let oversize_feed = start_fake_update_server(
        asset.clone(),
        Some(format!(
            "{}  {}",
            sha256_hex(&asset),
            current_updater_platform().asset_name
        )),
        Some((asset.len() + 1) as u64),
    );
    let mut init = test_init("updater-oversize");
    init.version = "0.1.0".to_string();
    init.test_mode = true;
    init.update_feed_url = Some(oversize_feed);
    let core = Core::new(init, Arc::new(NullEventSink)).expect("core");
    let oversize: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"download","command":"updater_download","payload":{}}"#),
    )
    .unwrap();
    assert_eq!(oversize["ok"], false);
    assert!(oversize["error"]["message"]
        .as_str()
        .unwrap()
        .contains("size did not match"));

    let missing_sidecar_feed =
        start_fake_update_server(asset.clone(), None, Some(asset.len() as u64));
    let mut init = test_init("updater-missing-sidecar");
    init.version = "0.1.0".to_string();
    init.test_mode = true;
    init.update_feed_url = Some(missing_sidecar_feed);
    let core = Core::new(init, Arc::new(NullEventSink)).expect("core");
    let missing_sidecar: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"check","command":"updater_check","payload":{}}"#),
    )
    .unwrap();
    assert_eq!(missing_sidecar["ok"], false);
    assert!(missing_sidecar["error"]["message"]
        .as_str()
        .unwrap()
        .contains(".sha256"));

    let http_feed = start_fake_update_server(
        asset.clone(),
        Some(format!(
            "{}  {}",
            sha256_hex(&asset),
            current_updater_platform().asset_name
        )),
        Some(asset.len() as u64),
    );
    let mut init = test_init("updater-http-without-test-mode");
    init.version = "0.1.0".to_string();
    init.test_mode = false;
    init.update_feed_url = Some(http_feed);
    let core = Core::new(init, Arc::new(NullEventSink)).expect("core");
    let http_without_test_mode: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"check","command":"updater_check","payload":{}}"#),
    )
    .unwrap();
    assert_eq!(http_without_test_mode["ok"], false);
    assert!(http_without_test_mode["error"]["message"]
        .as_str()
        .unwrap()
        .contains("HTTPS"));
}

#[test]
fn updater_ignores_tauri_release_without_native_asset() {
    let platform = UpdaterPlatformDto {
        key: "windows-x64".to_string(),
        os: "windows".to_string(),
        arch: "x86_64".to_string(),
        asset_name: WINDOWS_NATIVE_UPDATE_ASSET.to_string(),
    };
    let release = GithubRelease {
        tag_name: Some("0.1.36".to_string()),
        name: None,
        body: None,
        published_at: None,
        assets: vec![GithubReleaseAsset {
            name: "Legacy-Portable.exe".to_string(),
            browser_download_url: "https://example.test/Legacy-Portable.exe".to_string(),
            size: Some(42),
        }],
    };

    let status =
        update_status_for_release("0.1.0", platform, &release, false, |_| unreachable!()).unwrap();

    assert!(status.update.is_none());
    assert_eq!(
        status.message,
        "No native update asset is available for 0.1.36."
    );
}

#[test]
fn updater_hash_and_archive_guards() {
    assert_eq!(compare_versions("v0.1.20", "0.1.19"), 1);
    assert_eq!(compare_versions("0.1.19-beta.1", "0.1.19"), 0);
    assert_eq!(compare_versions("0.1.18", "0.1.19"), -1);
    let bytes = b"wheeljack update";
    assert!(verify_sha256(bytes, &sha256_hex(bytes)).is_ok());
    assert!(verify_sha256(bytes, &"0".repeat(64)).is_err());
    let hash = "A".repeat(64);
    assert_eq!(
        parse_sha256_sidecar(&format!("{hash}  wheeljack-windows-x64-portable.exe")).unwrap(),
        "a".repeat(64),
    );
    assert!(parse_sha256_sidecar("").is_err());
    assert!(parse_sha256_sidecar("not-a-hash  wheeljack-windows-x64-portable.exe").is_err());
    assert!(validate_download_url(
        "https://github.com/bildhaus/wheeljack/releases/download/v0.1.0/wheeljack.exe",
        false
    )
    .is_ok());
    assert!(validate_download_url(
        "https://github.com.evil.test/bildhaus/wheeljack/releases/download/v0.1.0/wheeljack.exe",
        false
    )
    .is_err());
    assert!(validate_download_url("https://example.test/wheeljack.exe", false).is_err());
    assert!(validate_download_url("http://127.0.0.1:4000/wheeljack.exe", true).is_ok());
    assert!(validate_download_url("http://127.0.0.1.evil.test/wheeljack.exe", true).is_err());
    assert!(validate_update_archive_name("wheeljack-0.2.0.exe").is_ok());
    assert!(validate_update_archive_name("wheeljack-0.2.0.app.zip").is_ok());
    assert!(validate_update_archive_name("../wheeljack.exe").is_err());
    assert!(validate_update_archive_name("wheeljack.zip").is_err());
    let windows_update = UpdateInfoDto {
        version: "0.2.0".to_string(),
        notes: None,
        published_at: None,
        platform: "windows-x64".to_string(),
        asset_name: WINDOWS_NATIVE_UPDATE_ASSET.to_string(),
        download_url: format!("https://example.test/{WINDOWS_NATIVE_UPDATE_ASSET}"),
        sha256: "a".repeat(64),
        size: None,
    };
    assert_eq!(
        downloaded_update_path(Path::new("updates/wheeljack-0.2.0.exe"), &windows_update).unwrap(),
        PathBuf::from("updates/wheeljack-0.2.0.exe")
    );
    #[cfg(windows)]
    {
        let unsigned_dir = temp_dir("unsigned-update");
        fs::create_dir_all(&unsigned_dir).unwrap();
        let unsigned_update = unsigned_dir.join("unsigned.exe");
        fs::copy(std::env::current_exe().unwrap(), &unsigned_update).unwrap();
        assert_eq!(
            verify_update_signature(&unsigned_update).unwrap(),
            "unsigned"
        );
    }
    #[cfg(not(target_os = "macos"))]
    {
        let mac_update = UpdateInfoDto {
            platform: "darwin-aarch64".to_string(),
            asset_name: "wheeljack.app.zip".to_string(),
            ..windows_update
        };
        assert!(
            downloaded_update_path(Path::new("updates/wheeljack-0.2.0.app.zip"), &mac_update)
                .is_err()
        );
    }
}

#[test]
fn updater_rejects_declared_oversized_package_and_consumes_recovery_marker_once() {
    let platform = current_updater_platform();
    let release = GithubRelease {
        tag_name: Some("v9.0.0".to_string()),
        name: None,
        body: None,
        published_at: None,
        assets: vec![
            GithubReleaseAsset {
                name: platform.asset_name.clone(),
                browser_download_url: format!(
                    "https://github.com/bildhaus/wheeljack/releases/download/v9.0.0/{}",
                    platform.asset_name
                ),
                size: Some(MAX_UPDATE_PACKAGE_BYTES + 1),
            },
            GithubReleaseAsset {
                name: format!("{}.sha256", platform.asset_name),
                browser_download_url: format!(
                    "https://github.com/bildhaus/wheeljack/releases/download/v9.0.0/{}.sha256",
                    platform.asset_name
                ),
                size: Some(64),
            },
        ],
    };
    assert!(
        update_status_for_release("0.1.0", platform, &release, false, |_| { unreachable!() })
            .unwrap_err()
            .to_string()
            .contains("512 MiB")
    );

    let init = test_init("updater-recovery-marker");
    let marker = init
        .update_dir
        .as_ref()
        .unwrap()
        .join(UPDATE_RECOVERY_ERROR_FILE);
    let core = Core::new(init, Arc::new(NullEventSink)).expect("core");
    fs::write(
        &marker,
        "\u{feff}The update failed and the previous version was restored.\n",
    )
    .unwrap();
    let first: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"recovery-1","command":"updater_recovery_error","payload":{}}"#),
    )
    .unwrap();
    assert_eq!(
        first["payload"],
        "The update failed and the previous version was restored."
    );
    let second: Value = serde_json::from_str(
        &core.call_json(r#"{"id":"recovery-2","command":"updater_recovery_error","payload":{}}"#),
    )
    .unwrap();
    assert!(second["payload"].is_null());
}

fn start_fake_update_server(
    asset: Vec<u8>,
    sidecar_text: Option<String>,
    size: Option<u64>,
) -> String {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
    let base_url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let platform = current_updater_platform();
    let asset_name = platform.asset_name;
    let asset_url = format!("{base_url}/{asset_name}");
    let sidecar_url = format!("{asset_url}.sha256");
    let mut release_assets = vec![json!({
        "name": asset_name,
        "browserDownloadUrl": asset_url,
        "size": size
    })];
    if sidecar_text.is_some() {
        release_assets.push(json!({
            "name": format!("{asset_name}.sha256"),
            "browserDownloadUrl": sidecar_url
        }));
    }
    let release = json!({
        "tagName": "0.1.1",
        "body": "test release",
        "publishedAt": "2026-07-07T00:00:00Z",
        "assets": release_assets
    });
    let mut routes = HashMap::<String, (Vec<u8>, &'static str)>::new();
    routes.insert(
        "/release".to_string(),
        (release.to_string().into_bytes(), "application/json"),
    );
    routes.insert(
        format!("/{asset_name}"),
        (asset, "application/octet-stream"),
    );
    if let Some(sidecar_text) = sidecar_text {
        routes.insert(
            format!("/{asset_name}.sha256"),
            (sidecar_text.into_bytes(), "text/plain"),
        );
    }
    let request_limit = routes.len() * 2;
    thread::spawn(move || {
        for stream in listener.incoming().take(request_limit).flatten() {
            let mut stream = stream;
            let mut reader = BufReader::new(stream.try_clone().expect("clone"));
            let mut request_line = String::new();
            reader.read_line(&mut request_line).expect("read request");
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).expect("read header");
                if line.trim_end_matches(['\r', '\n']).is_empty() {
                    break;
                }
            }
            let path = request_line.split_whitespace().nth(1).unwrap_or("/");
            let (status, body, content_type) = routes
                .get(path)
                .map(|(body, content_type)| ("200 OK", body.as_slice(), *content_type))
                .unwrap_or(("404 Not Found", b"not found".as_slice(), "text/plain"));
            let headers = format!(
                "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(headers.as_bytes()).expect("write headers");
            stream.write_all(body).expect("write body");
            stream.flush().expect("flush response");
            stream
                .shutdown(std::net::Shutdown::Write)
                .expect("finish response");
        }
    });
    format!("{base_url}/release")
}

#[cfg(windows)]
struct EnvVarGuard {
    key: &'static str,
    previous: Option<String>,
}

#[cfg(windows)]
impl EnvVarGuard {
    fn set(key: &'static str, value: &str) -> Self {
        let previous = std::env::var(key).ok();
        std::env::set_var(key, value);
        Self { key, previous }
    }
}

#[cfg(windows)]
impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        if let Some(previous) = &self.previous {
            std::env::set_var(self.key, previous);
        } else {
            std::env::remove_var(self.key);
        }
    }
}
