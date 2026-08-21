use super::*;

const STARTUP_RUN_FILE: &str = ".wheeljack-startup.json";
const CRASH_REPORT_DIRECTORY: &str = "crash-reports";
const MAX_CRASH_REPORTS: usize = 10;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupRunMarker {
    schema_version: u8,
    version: String,
    platform: String,
    process_id: u32,
    started_at: String,
    ended_at: Option<String>,
    clean_shutdown: bool,
    consecutive_unclean_starts: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartupRecoveryState {
    pub(crate) previous_unclean_shutdown: bool,
    pub(crate) safe_mode: bool,
    pub(crate) consecutive_unclean_starts: u32,
    pub(crate) crash_report_path: Option<PathBuf>,
    pub(crate) previous_run_started_at: Option<String>,
    pub(crate) previous_run_version: Option<String>,
}

pub(crate) struct StartupRunGuard {
    marker_path: PathBuf,
    marker: StartupRunMarker,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CrashRecoveryReport<'a> {
    schema_version: u8,
    detected_at: String,
    current_version: &'a str,
    current_platform: &'a str,
    recovered_sessions: usize,
    marker_was_invalid: bool,
    previous_run: Option<&'a StartupRunMarker>,
}

pub(crate) fn begin_startup_run(
    app_data_dir: &Path,
    version: &str,
    platform: &str,
    recovered_sessions: usize,
    enable_safe_mode: bool,
) -> Result<(StartupRecoveryState, StartupRunGuard)> {
    let marker_path = app_data_dir.join(STARTUP_RUN_FILE);
    let marker_bytes = fs::read(&marker_path).ok();
    let previous = marker_bytes
        .as_deref()
        .and_then(|bytes| serde_json::from_slice::<StartupRunMarker>(bytes).ok());
    let marker_was_invalid = marker_bytes.is_some() && previous.is_none();
    let previous_unclean_shutdown = marker_was_invalid
        || previous
            .as_ref()
            .is_some_and(|marker| !marker.clean_shutdown);
    let consecutive_unclean_starts = if previous_unclean_shutdown {
        previous
            .as_ref()
            .map(|marker| marker.consecutive_unclean_starts.saturating_add(1))
            .unwrap_or(1)
    } else {
        0
    };
    let crash_report_path = if previous_unclean_shutdown {
        Some(write_crash_report(
            app_data_dir,
            version,
            platform,
            recovered_sessions,
            marker_was_invalid,
            previous.as_ref(),
        )?)
    } else {
        None
    };
    let marker = StartupRunMarker {
        schema_version: 1,
        version: version.to_string(),
        platform: platform.to_string(),
        process_id: std::process::id(),
        started_at: now(),
        ended_at: None,
        clean_shutdown: false,
        consecutive_unclean_starts,
    };
    write_marker(&marker_path, &marker)?;
    let state = StartupRecoveryState {
        previous_unclean_shutdown,
        safe_mode: enable_safe_mode && previous_unclean_shutdown,
        consecutive_unclean_starts,
        crash_report_path,
        previous_run_started_at: previous.as_ref().map(|marker| marker.started_at.clone()),
        previous_run_version: previous.as_ref().map(|marker| marker.version.clone()),
    };
    Ok((
        state,
        StartupRunGuard {
            marker_path,
            marker,
        },
    ))
}

impl StartupRunGuard {
    pub(crate) fn finish(&self) -> Result<()> {
        let mut marker = self.marker.clone();
        marker.clean_shutdown = true;
        marker.ended_at = Some(now());
        marker.consecutive_unclean_starts = 0;
        write_marker(&self.marker_path, &marker)
    }
}

fn write_marker(path: &Path, marker: &StartupRunMarker) -> Result<()> {
    let bytes = serde_json::to_vec(marker)?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
        .with_context(|| format!("open startup marker at {}", path.display()))?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    Ok(())
}

fn write_crash_report(
    app_data_dir: &Path,
    version: &str,
    platform: &str,
    recovered_sessions: usize,
    marker_was_invalid: bool,
    previous: Option<&StartupRunMarker>,
) -> Result<PathBuf> {
    let directory = app_data_dir.join(CRASH_REPORT_DIRECTORY);
    fs::create_dir_all(&directory)?;
    let path = directory.join(format!("recovery-{}.json", Uuid::now_v7()));
    let report = CrashRecoveryReport {
        schema_version: 1,
        detected_at: now(),
        current_version: version,
        current_platform: platform,
        recovered_sessions,
        marker_was_invalid,
        previous_run: previous,
    };
    fs::write(&path, serde_json::to_vec_pretty(&report)?)?;
    prune_crash_reports(&directory)?;
    Ok(path)
}

fn prune_crash_reports(directory: &Path) -> Result<()> {
    let mut reports = fs::read_dir(directory)?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(OsStr::to_str) == Some("json"))
        .collect::<Vec<_>>();
    reports.sort();
    let remove_count = reports.len().saturating_sub(MAX_CRASH_REPORTS);
    for path in reports.into_iter().take(remove_count) {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unclean_start_enters_safe_mode_and_writes_a_report() {
        let directory = std::env::temp_dir().join(format!("wheeljack-startup-{}", Uuid::now_v7()));
        fs::create_dir_all(&directory).unwrap();
        let (first, _unfinished) =
            begin_startup_run(&directory, "1.0.0", "windows", 0, true).unwrap();
        assert!(!first.previous_unclean_shutdown);

        let (recovered, guard) =
            begin_startup_run(&directory, "1.0.1", "windows", 3, true).unwrap();
        assert!(recovered.previous_unclean_shutdown);
        assert!(recovered.safe_mode);
        assert_eq!(recovered.consecutive_unclean_starts, 1);
        assert!(recovered.crash_report_path.as_ref().unwrap().is_file());
        guard.finish().unwrap();

        let (clean, guard) = begin_startup_run(&directory, "1.0.1", "windows", 0, true).unwrap();
        assert!(!clean.previous_unclean_shutdown);
        assert!(!clean.safe_mode);
        guard.finish().unwrap();
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn malformed_marker_is_recoverable() {
        let directory = std::env::temp_dir().join(format!("wheeljack-startup-{}", Uuid::now_v7()));
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join(STARTUP_RUN_FILE), b"partial").unwrap();
        let (recovered, guard) = begin_startup_run(&directory, "1.0.0", "macos", 0, true).unwrap();
        assert!(recovered.previous_unclean_shutdown);
        assert!(recovered.safe_mode);
        guard.finish().unwrap();
        fs::remove_dir_all(directory).unwrap();
    }
}
