use super::*;

#[cfg(unix)]
use std::os::unix::process::CommandExt as UnixCommandExt;
#[cfg(windows)]
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
#[cfg(windows)]
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::HANDLE,
        System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
    },
};

#[cfg(unix)]
unsafe extern "C" {
    fn kill(pid: i32, signal: i32) -> i32;
}

const TERMINAL_FRAME_INTERVAL: Duration = Duration::from_millis(17);
const STRUCTURED_PROTOCOL_UPDATE_INTERVAL: Duration = Duration::from_millis(100);
const STRUCTURED_TRANSCRIPT_BATCH_SIZE: usize = 64;
const STRUCTURED_TRANSCRIPT_FLUSH_INTERVAL: Duration = Duration::from_millis(100);
const SESSION_TRANSCRIPT_PRUNE_INTERVAL: Duration = Duration::from_secs(5);
const DEFAULT_SESSION_TRANSCRIPT_RETENTION_BYTES: i64 = 10 * 1024 * 1024;
const MAX_SESSION_TRANSCRIPT_RETENTION_BYTES: i64 = 100 * 1024 * 1024;
const DEFAULT_GLOBAL_SESSION_TRANSCRIPT_RETENTION_BYTES: i64 = 256 * 1024 * 1024;
const MAX_GLOBAL_SESSION_TRANSCRIPT_RETENTION_BYTES: i64 = 2 * 1024 * 1024 * 1024;
pub(crate) const MAX_STRUCTURED_LINE_BYTES: usize = 1024 * 1024;
const SESSION_EXIT_BUSY_RETRY_DELAYS: [Duration; 3] = [
    Duration::from_millis(25),
    Duration::from_millis(75),
    Duration::from_millis(150),
];

pub(crate) struct PtySessionHandle {
    pub(crate) master: Box<dyn MasterPty + Send>,
    pub(crate) writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub(crate) killer: Box<dyn ChildKiller + Send + Sync>,
    #[cfg(windows)]
    pub(crate) process_id: Option<u32>,
    pub(crate) terminal: Arc<Mutex<TerminalModel>>,
}

pub(crate) fn kill_pty_child(killer: &mut Box<dyn ChildKiller + Send + Sync>) -> Result<()> {
    match killer.kill() {
        Ok(()) => Ok(()),
        Err(error) if error.raw_os_error() == Some(0) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(windows)]
pub(crate) fn kill_windows_process_tree(process_id: u32) -> bool {
    let child = Command::new(windows_system32_executable("taskkill.exe"))
        .args(["/PID", &process_id.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut child) = child else {
        return false;
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

#[cfg(windows)]
pub(crate) fn windows_system32_executable(relative_path: &str) -> PathBuf {
    env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join(relative_path)
}

pub(crate) fn kill_pty_session(session: &mut PtySessionHandle) -> Result<()> {
    #[cfg(windows)]
    if let Some(process_id) = session.process_id {
        if kill_windows_process_tree(process_id) {
            return Ok(());
        }
    }
    kill_pty_child(&mut session.killer)
}

#[derive(Clone)]
pub(crate) struct StructuredProcessTree {
    #[cfg(windows)]
    job: Arc<OwnedHandle>,
    #[cfg(unix)]
    process_group_id: i32,
}

pub(crate) fn configure_structured_process(command: &mut Command) {
    #[cfg(unix)]
    {
        command.process_group(0);
    }
    #[cfg(not(unix))]
    let _ = command;
}

pub(crate) fn kill_structured_process_before_attach(child: &mut ProcessChild) {
    #[cfg(windows)]
    let terminated_tree = kill_windows_process_tree(child.id());
    #[cfg(unix)]
    let terminated_tree = i32::try_from(child.id())
        .ok()
        .map(|process_group_id| StructuredProcessTree { process_group_id })
        .is_some_and(|process_tree| process_tree.terminate().is_ok());
    #[cfg(not(any(windows, unix)))]
    let terminated_tree = false;

    if !terminated_tree {
        let _ = child.kill();
    }
    let _ = child.wait();
}

impl StructuredProcessTree {
    pub(crate) fn attach(child: &ProcessChild) -> Result<Self> {
        #[cfg(windows)]
        {
            let raw_job = unsafe { CreateJobObjectW(None, PCWSTR::null()) }
                .context("Could not create a structured-agent process job")?;
            let job = Arc::new(unsafe { OwnedHandle::from_raw_handle(raw_job.0) });
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            unsafe {
                SetInformationJobObject(
                    HANDLE(job.as_raw_handle()),
                    JobObjectExtendedLimitInformation,
                    std::ptr::addr_of!(limits).cast(),
                    std::mem::size_of_val(&limits) as u32,
                )
            }
            .context("Could not configure the structured-agent process job")?;
            unsafe {
                AssignProcessToJobObject(
                    HANDLE(job.as_raw_handle()),
                    HANDLE(AsRawHandle::as_raw_handle(child)),
                )
            }
            .context("Could not assign the structured-agent process to its job")?;
            Ok(Self { job })
        }
        #[cfg(unix)]
        {
            let process_group_id = i32::try_from(child.id())
                .context("Structured-agent process ID exceeds the Unix process-group range")?;
            Ok(Self { process_group_id })
        }
        #[cfg(not(any(windows, unix)))]
        {
            let _ = child;
            Ok(Self {})
        }
    }

    fn terminate(&self) -> Result<()> {
        #[cfg(windows)]
        {
            unsafe { TerminateJobObject(HANDLE(self.job.as_raw_handle()), 1) }
                .context("Could not terminate the structured-agent process job")?;
        }
        #[cfg(unix)]
        {
            const SIGKILL: i32 = 9;
            let result = unsafe { kill(-self.process_group_id, SIGKILL) };
            if result != 0 {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() != Some(3) {
                    return Err(error)
                        .context("Could not terminate the structured-agent process group");
                }
            }
        }
        Ok(())
    }
}

pub(crate) fn kill_structured_process(
    child: &mut ProcessChild,
    process_tree: &StructuredProcessTree,
) -> Result<()> {
    let direct_exited = child.try_wait()?.is_some();
    if let Err(tree_error) = process_tree.terminate() {
        if !direct_exited {
            let _ = child.kill();
            let _ = child.wait();
        }
        return Err(tree_error);
    }
    if !direct_exited {
        let _ = child.wait();
    }
    Ok(())
}

#[derive(Clone)]
pub(crate) struct StructuredAgentProcessHandle {
    pub(crate) child: Arc<Mutex<ProcessChild>>,
    pub(crate) process_tree: StructuredProcessTree,
    pub(crate) termination_reason: Arc<Mutex<Option<StructuredTerminationReason>>>,
}

#[derive(Clone)]
pub(crate) struct StructuredAgentSessionHandle {
    pub(crate) process: StructuredAgentProcessHandle,
    pub(crate) stdin: Option<Arc<Mutex<ChildStdin>>>,
    pub(crate) protocol: String,
    pub(crate) cwd: String,
    pub(crate) intent: String,
    pub(crate) http_port: Option<u16>,
    pub(crate) rpc_state: Option<Arc<Mutex<StructuredAgentRpcState>>>,
    pub(crate) provider: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) thinking: Option<String>,
    pub(crate) approval_policy: Option<String>,
    pub(crate) sandbox: Option<String>,
    pub(crate) capabilities: StructuredDriverCapabilities,
    pub(crate) seq: Arc<AtomicU64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum StructuredTerminationReason {
    Completed,
    Canceled,
    Shutdown,
}

impl StructuredTerminationReason {
    pub(crate) fn parse(value: &str) -> Result<Self> {
        match value {
            "completed" => Ok(Self::Completed),
            "canceled" => Ok(Self::Canceled),
            "shutdown" => Ok(Self::Shutdown),
            _ => bail!("unsupported structured termination reason: {value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StructuredProtocol {
    ClaudeStreamJson,
    CodexAppServer,
    OpenCodeSse,
    PiRpc,
    HermesGateway,
    HermesAcp,
    PlainArgv,
    PlainStdin,
}

impl StructuredProtocol {
    pub(crate) fn parse(value: &str) -> Result<Self> {
        match value {
            "claude-stream-json" => Ok(Self::ClaudeStreamJson),
            "codex-app-server" => Ok(Self::CodexAppServer),
            "opencode-sse" => Ok(Self::OpenCodeSse),
            "pi-rpc" => Ok(Self::PiRpc),
            "hermes-gateway" => Ok(Self::HermesGateway),
            "hermes-acp" => Ok(Self::HermesAcp),
            "plain-argv" => Ok(Self::PlainArgv),
            "plain-stdin" => Ok(Self::PlainStdin),
            _ => bail!("unsupported structured protocol: {value}"),
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeStreamJson => "claude-stream-json",
            Self::CodexAppServer => "codex-app-server",
            Self::OpenCodeSse => "opencode-sse",
            Self::PiRpc => "pi-rpc",
            Self::HermesGateway => "hermes-gateway",
            Self::HermesAcp => "hermes-acp",
            Self::PlainArgv => "plain-argv",
            Self::PlainStdin => "plain-stdin",
        }
    }

    pub(crate) fn driver_id(self) -> &'static str {
        match self {
            Self::ClaudeStreamJson => "claude",
            Self::CodexAppServer => "codex",
            Self::OpenCodeSse => "opencode",
            Self::PiRpc => "pi",
            Self::HermesGateway => "hermes-gateway",
            Self::HermesAcp => "hermes-acp",
            Self::PlainArgv | Self::PlainStdin => "plain",
        }
    }

    pub(crate) fn prompt_delivery(self) -> &'static str {
        match self {
            Self::ClaudeStreamJson => "stdin",
            Self::OpenCodeSse => "sse",
            Self::PlainArgv => "argv",
            Self::PlainStdin => "json-rpc",
            Self::CodexAppServer | Self::PiRpc | Self::HermesGateway | Self::HermesAcp => {
                "json-rpc"
            }
        }
    }

    pub(crate) fn capabilities(self) -> StructuredDriverCapabilities {
        StructuredDriverCapabilities {
            cancel: matches!(
                self,
                Self::ClaudeStreamJson | Self::CodexAppServer | Self::OpenCodeSse | Self::PiRpc
            ),
            interact: matches!(
                self,
                Self::ClaudeStreamJson | Self::CodexAppServer | Self::OpenCodeSse
            ),
            resume: matches!(
                self,
                Self::ClaudeStreamJson | Self::CodexAppServer | Self::OpenCodeSse | Self::PiRpc
            ),
            attached_terminal: self == Self::OpenCodeSse,
            image_input: matches!(
                self,
                Self::ClaudeStreamJson
                    | Self::CodexAppServer
                    | Self::OpenCodeSse
                    | Self::PiRpc
                    | Self::HermesAcp
            ),
            // None of the current upstream protocols exposes a documented,
            // acknowledgeable in-flight steering primitive yet.
            steer: false,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StructuredDriverCapabilities {
    pub(crate) cancel: bool,
    pub(crate) interact: bool,
    pub(crate) resume: bool,
    pub(crate) attached_terminal: bool,
    pub(crate) image_input: bool,
    pub(crate) steer: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StructuredPromptImage {
    pub(crate) path: String,
    pub(crate) mime_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StructuredPrompt {
    pub(crate) text: String,
    pub(crate) images: Vec<StructuredPromptImage>,
}

impl StructuredPrompt {
    #[cfg(test)]
    pub(crate) fn text(text: &str) -> Self {
        Self {
            text: text.to_string(),
            images: Vec::new(),
        }
    }
}

pub(crate) fn structured_user_history_line(
    prompt: &StructuredPrompt,
    visible_text: &str,
) -> Result<Vec<u8>> {
    let images = prompt
        .images
        .iter()
        .map(|image| {
            json!({
                "path": image.path,
                "fileName": prompt_image_file_name(image),
                "mimeType": image.mime_type,
            })
        })
        .collect::<Vec<_>>();
    let mut line = serde_json::to_vec(&json!({
        "type": "wheeljack_user_message",
        "text": visible_text.trim(),
        "images": images,
    }))?;
    line.push(b'\n');
    Ok(line)
}

pub(crate) fn structured_interaction_history_line(
    interaction_id: Option<&str>,
    interaction_state: &str,
    text: &str,
) -> Result<Vec<u8>> {
    let mut line = serde_json::to_vec(&json!({
        "type": "wheeljack_interaction_response",
        "interactionId": interaction_id,
        "interactionState": interaction_state,
        "text": text,
    }))?;
    line.push(b'\n');
    Ok(line)
}

const MAX_STRUCTURED_PROMPT_IMAGES: usize = 4;
const MAX_STRUCTURED_PROMPT_IMAGE_BYTES: u64 = 12 * 1024 * 1024;

fn structured_image_mime(header: &[u8]) -> Option<&'static str> {
    if header.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if header.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if header.starts_with(b"GIF87a") || header.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if header.len() >= 12 && header.starts_with(b"RIFF") && &header[8..12] == b"WEBP" {
        Some("image/webp")
    } else if header.starts_with(b"BM") {
        Some("image/bmp")
    } else {
        None
    }
}

pub(crate) fn structured_prompt_from_paths(
    text: &str,
    image_paths: &[String],
    cwd: &Path,
    app_data_dir: &Path,
) -> Result<StructuredPrompt> {
    if image_paths.len() > MAX_STRUCTURED_PROMPT_IMAGES {
        bail!("structured prompts support at most {MAX_STRUCTURED_PROMPT_IMAGES} images");
    }
    let text = text.trim().to_string();
    if text.is_empty() && image_paths.is_empty() {
        bail!("structured prompt requires text or an image");
    }
    let cwd = fs::canonicalize(cwd).context("resolve structured prompt workspace")?;
    let app_data_dir =
        fs::canonicalize(app_data_dir).context("resolve wheeljack data directory")?;
    let mut images = Vec::with_capacity(image_paths.len());
    for path in image_paths {
        let source = fs::canonicalize(path).context("resolve structured prompt image")?;
        if !source.starts_with(&cwd) && !source.starts_with(&app_data_dir) {
            bail!(
                "structured prompt images must be inside the workspace or wheeljack data directory"
            );
        }
        let metadata = fs::metadata(&source).context("inspect structured prompt image")?;
        if !metadata.is_file() {
            bail!("structured prompt image must be a file");
        }
        if metadata.len() > MAX_STRUCTURED_PROMPT_IMAGE_BYTES {
            bail!("structured prompt image exceeds 12 MiB");
        }
        let mut file = fs::File::open(&source).context("open structured prompt image")?;
        let mut header = [0u8; 12];
        let read = file
            .read(&mut header)
            .context("read structured prompt image")?;
        let mime_type = structured_image_mime(&header[..read])
            .ok_or_else(|| anyhow!("unsupported structured prompt image type"))?;
        images.push(StructuredPromptImage {
            path: source.to_string_lossy().to_string(),
            mime_type: mime_type.to_string(),
        });
    }
    Ok(StructuredPrompt { text, images })
}

fn encoded_prompt_image(image: &StructuredPromptImage) -> Result<String> {
    Ok(general_purpose::STANDARD
        .encode(fs::read(&image.path).context("read structured prompt image")?))
}

fn prompt_image_file_name(image: &StructuredPromptImage) -> String {
    Path::new(&image.path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("image")
        .to_string()
}

#[derive(Default)]
pub(crate) struct StructuredAgentRpcState {
    pub(crate) turn_active: bool,
    pub(crate) pending_prompt: Option<StructuredPrompt>,
    pub(crate) next_id: u64,
    pub(crate) cancel_requested: bool,
    pub(crate) claude: ClaudeRpcState,
    pub(crate) codex: CodexRpcState,
    pub(crate) opencode: OpenCodeRpcState,
    pub(crate) pi: PiRpcState,
    pub(crate) hermes: HermesRpcState,
    pub(crate) acp: AcpRpcState,
}

#[derive(Default)]
pub(crate) struct ClaudeRpcState {
    pub(crate) session_id: Option<String>,
    pub(crate) pending_interaction: Option<Value>,
}

#[derive(Default)]
pub(crate) struct CodexRpcState {
    pub(crate) thread_id: Option<String>,
    pub(crate) turn_id: Option<String>,
    pub(crate) turn_start_request_id: Option<u64>,
    pub(crate) pending_interaction: Option<Value>,
    pub(crate) resume_thread_id: Option<String>,
}

#[derive(Default)]
pub(crate) struct OpenCodeRpcState {
    pub(crate) session_id: Option<String>,
    pub(crate) pending_interactions: Vec<Value>,
}

#[derive(Default)]
pub(crate) struct PiRpcState {
    pub(crate) session_id: Option<String>,
}

#[derive(Default)]
pub(crate) struct HermesRpcState {
    pub(crate) session_id: Option<String>,
}

#[derive(Default)]
pub(crate) struct AcpRpcState {
    pub(crate) session_id: Option<String>,
    pub(crate) auth_pending: bool,
}

#[derive(Clone)]
pub(crate) struct StructuredProtocolDriver {
    pub(crate) protocol: String,
    pub(crate) cwd: String,
    pub(crate) db_path: PathBuf,
    pub(crate) session_id: String,
    pub(crate) stdin: Arc<Mutex<ChildStdin>>,
    pub(crate) rpc_state: Arc<Mutex<StructuredAgentRpcState>>,
    pub(crate) provider: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) thinking: Option<String>,
    pub(crate) approval_policy: Option<String>,
    pub(crate) sandbox: Option<String>,
}

const AGENT_RESUME_CURSOR_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentResumeCursor {
    pub(crate) version: u32,
    pub(crate) driver: String,
    pub(crate) value: String,
}

impl AgentResumeCursor {
    fn new(protocol: StructuredProtocol, value: String) -> Self {
        Self {
            version: AGENT_RESUME_CURSOR_VERSION,
            driver: protocol.driver_id().to_string(),
            value,
        }
    }
}

#[derive(Clone)]
pub(crate) struct StructuredReaderCancellation {
    pub(crate) shutdown: Arc<AtomicBool>,
    pub(crate) rollback: Arc<AtomicBool>,
}

impl StructuredReaderCancellation {
    fn is_canceled(&self) -> bool {
        self.shutdown.load(Ordering::SeqCst) || self.rollback.load(Ordering::SeqCst)
    }
}

#[derive(Clone)]
pub(crate) struct StructuredSseDriver {
    pub(crate) protocol: String,
    pub(crate) port: u16,
    pub(crate) db_path: PathBuf,
    pub(crate) session_id: String,
    pub(crate) node_id: String,
    pub(crate) adapter_id: String,
    pub(crate) seq: Arc<AtomicU64>,
    pub(crate) rpc_state: Arc<Mutex<StructuredAgentRpcState>>,
    pub(crate) events: Arc<dyn EventSink>,
    pub(crate) cancellation: StructuredReaderCancellation,
    pub(crate) model: Option<String>,
    pub(crate) thinking: Option<String>,
    pub(crate) approval_policy: Option<String>,
    pub(crate) protocol_state: Arc<Mutex<AgentProtocolStreamState>>,
}

#[derive(Clone)]
pub(crate) struct StructuredSsePromptDriver {
    pub(crate) protocol: String,
    pub(crate) port: u16,
    pub(crate) rpc_state: Arc<Mutex<StructuredAgentRpcState>>,
    pub(crate) model: Option<String>,
    pub(crate) thinking: Option<String>,
}

impl StructuredSseDriver {
    pub(crate) fn prompt_driver(&self) -> StructuredSsePromptDriver {
        StructuredSsePromptDriver {
            protocol: self.protocol.clone(),
            port: self.port,
            rpc_state: self.rpc_state.clone(),
            model: self.model.clone(),
            thinking: self.thinking.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpawnSessionRequest {
    pub(crate) node_id: Option<String>,
    pub(crate) node_title: Option<String>,
    pub(crate) adapter_id: Option<String>,
    pub(crate) command: Option<String>,
    pub(crate) shell_command: Option<String>,
    #[serde(default)]
    pub(crate) args: Vec<String>,
    pub(crate) cwd: Option<String>,
    pub(crate) rows: Option<u16>,
    pub(crate) cols: Option<u16>,
}

pub(crate) struct ResolvedPtyCommand {
    pub(crate) command: String,
    pub(crate) args: Vec<String>,
    pub(crate) source: &'static str,
    pub(crate) env: Vec<(String, String)>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionDto {
    pub(crate) id: String,
    pub(crate) node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) node_title: Option<String>,
    pub(crate) adapter_id: String,
    pub(crate) cwd: String,
    pub(crate) status: String,
    pub(crate) intent: String,
    pub(crate) started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) protocol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) driver: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) capabilities: Option<StructuredDriverCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) runtime_instance_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StructuredAgentSpawnRequest {
    pub(crate) node_id: String,
    #[serde(default)]
    pub(crate) node_title: Option<String>,
    pub(crate) adapter_id: String,
    #[serde(default = "default_session_intent")]
    pub(crate) intent: String,
    #[serde(default)]
    pub(crate) canvas_id: Option<String>,
    #[serde(default)]
    pub(crate) task_id: Option<String>,
    #[serde(default)]
    pub(crate) parent_session_id: Option<String>,
    #[serde(default)]
    pub(crate) autonomy_depth: u8,
    #[serde(default, alias = "command")]
    pub(crate) launch_command: Option<String>,
    #[serde(default)]
    pub(crate) args: Vec<String>,
    pub(crate) cwd: String,
    #[serde(default)]
    pub(crate) prompt: String,
    #[serde(default)]
    pub(crate) image_paths: Vec<String>,
    #[serde(default)]
    pub(crate) prompt_delivery: Option<String>,
    #[serde(default)]
    pub(crate) protocol: Option<String>,
    #[serde(default)]
    pub(crate) provider: Option<String>,
    #[serde(default)]
    pub(crate) model: Option<String>,
    #[serde(default)]
    pub(crate) thinking: Option<String>,
    #[serde(default)]
    pub(crate) approval_policy: Option<String>,
    #[serde(default)]
    pub(crate) sandbox: Option<String>,
    #[serde(default)]
    pub(crate) resume_session_id: Option<String>,
}

fn default_session_intent() -> String {
    "code".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StructuredAgentLineEvent {
    pub(crate) session_id: String,
    pub(crate) node_id: String,
    pub(crate) adapter_id: String,
    pub(crate) seq: u64,
    pub(crate) stream: String,
    pub(crate) line_base64: String,
    pub(crate) runtime_instance_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StructuredAgentExitEvent {
    pub(crate) session_id: String,
    pub(crate) node_id: String,
    pub(crate) adapter_id: String,
    pub(crate) exit_code: Option<i32>,
    pub(crate) signal: Option<String>,
    pub(crate) runtime_instance_id: String,
    pub(crate) incomplete_turn: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) termination_reason: Option<StructuredTerminationReason>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StructuredAgentProtocolUpdateEvent {
    pub(crate) session_id: String,
    pub(crate) runtime_instance_id: String,
    pub(crate) node_id: String,
    pub(crate) adapter_id: String,
    pub(crate) seq: u64,
    pub(crate) events: Vec<AgentProtocolEventDto>,
    pub(crate) messages: Vec<AgentChatMessageDto>,
    pub(crate) controls: Vec<String>,
    pub(crate) active: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentProtocolParseRequest {
    pub(crate) adapter_id: String,
    #[serde(default)]
    pub(crate) protocol: Option<String>,
    #[serde(default)]
    pub(crate) node_id: Option<String>,
    #[serde(default)]
    pub(crate) output_role: Option<String>,
    #[serde(default)]
    pub(crate) limit: Option<usize>,
    #[serde(default)]
    pub(crate) line: Option<String>,
    #[serde(default)]
    pub(crate) lines: Vec<String>,
    #[serde(default)]
    pub(crate) transcript: Option<Value>,
    #[serde(default)]
    pub(crate) chunks: Option<Value>,
    #[serde(default)]
    pub(crate) user_prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentProtocolEventDto {
    #[serde(rename = "type")]
    pub(crate) event_type: String,
    pub(crate) adapter_id: String,
    pub(crate) sequence: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) part_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) message_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) interaction_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) interaction_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) choices: Option<Vec<AgentInteractionChoiceDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) images: Option<Vec<AgentChatImageDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) raw: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentChatMessageDto {
    pub(crate) id: String,
    pub(crate) role: String,
    pub(crate) kind: String,
    pub(crate) text: String,
    pub(crate) raw_index_start: usize,
    pub(crate) raw_index_end: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) streaming: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) interaction_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) interaction_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) choices: Option<Vec<AgentInteractionChoiceDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) images: Option<Vec<AgentChatImageDto>>,
    #[serde(skip)]
    pub(crate) source_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentInteractionChoiceDto {
    pub(crate) id: String,
    pub(crate) label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentChatImageDto {
    pub(crate) path: String,
    pub(crate) file_name: String,
    pub(crate) mime_type: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BentoLayoutRequest {
    pub(crate) nodes: Vec<BentoLayoutNode>,
    pub(crate) viewport: BentoViewport,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BentoLayoutNode {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) z_index: i64,
    #[serde(default)]
    pub(crate) col_span: Option<f64>,
    #[serde(default)]
    pub(crate) row_span: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct BentoViewport {
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BentoLayoutResponse {
    pub(crate) nodes: Vec<String>,
    pub(crate) placements: HashMap<String, BentoPlacementDto>,
    pub(crate) columns: usize,
    pub(crate) rows: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BentoPlacementDto {
    pub(crate) column: usize,
    pub(crate) row: usize,
    pub(crate) column_span: usize,
    pub(crate) row_span: usize,
}

pub(crate) struct TerminalModel {
    pub(crate) session_id: String,
    pub(crate) rows: u16,
    pub(crate) cols: u16,
    pub(crate) parser: Processor,
    pub(crate) term: Term<TerminalEventProxy>,
}

impl TerminalModel {
    pub(crate) fn new(
        session_id: String,
        rows: u16,
        cols: u16,
        events: Arc<dyn EventSink>,
    ) -> Self {
        let size = TerminalSize { rows, cols };
        let config = Config {
            scrolling_history: TERMINAL_SCROLLBACK_LINES,
            ..Default::default()
        };
        let term = Term::new(
            config,
            &size,
            TerminalEventProxy {
                session_id: session_id.clone(),
                events,
            },
        );
        Self {
            session_id,
            rows,
            cols,
            parser: Processor::new(),
            term,
        }
    }

    #[cfg(test)]
    pub(crate) fn feed(&mut self, bytes: &[u8]) -> TerminalFrame {
        self.feed_bytes(bytes);
        self.snapshot()
    }

    pub(crate) fn feed_bytes(&mut self, bytes: &[u8]) {
        self.parser.advance(&mut self.term, bytes);
    }

    pub(crate) fn resize(&mut self, rows: u16, cols: u16) {
        self.rows = rows.max(1);
        self.cols = cols.max(1);
        self.term.resize(TerminalSize {
            rows: self.rows,
            cols: self.cols,
        });
    }

    pub(crate) fn set_viewport(&mut self, display_offset: usize) -> TerminalFrame {
        let current = self.term.grid().display_offset();
        let target = display_offset.min(
            self.term
                .grid()
                .total_lines()
                .saturating_sub(self.term.grid().screen_lines()),
        );
        self.term
            .scroll_display(Scroll::Delta(target as i32 - current as i32));
        self.snapshot_and_reset_damage()
    }

    pub(crate) fn snapshot(&self) -> TerminalFrame {
        self.build_frame(None, false)
    }

    pub(crate) fn snapshot_and_reset_damage(&mut self) -> TerminalFrame {
        let frame = self.snapshot();
        self.term.reset_damage();
        frame
    }

    pub(crate) fn snapshot_delta(&mut self) -> Option<TerminalFrame> {
        let screen_lines = self.term.grid().screen_lines();
        let dirty_rows = match self.term.damage() {
            TermDamage::Full => None,
            TermDamage::Partial(rows) => {
                let rows = rows
                    .map(|damage| damage.line)
                    .filter(|line| *line < screen_lines)
                    .collect::<Vec<_>>();
                if rows.is_empty() {
                    self.term.reset_damage();
                    return None;
                }
                Some(rows)
            }
        };
        let frame = self.build_frame(dirty_rows.as_deref(), dirty_rows.is_some());
        self.term.reset_damage();
        Some(frame)
    }

    fn build_frame(&self, row_indexes: Option<&[usize]>, dirty: bool) -> TerminalFrame {
        let metrics_started = terminal_metrics_enabled().then(Instant::now);
        let frame_rows: Vec<TerminalRow> = match row_indexes {
            Some(indexes) => indexes
                .iter()
                .map(|line| self.snapshot_row(*line))
                .collect(),
            None => (0..self.term.grid().screen_lines())
                .map(|line| self.snapshot_row(line))
                .collect(),
        };
        let (grid_rows, dirty_rows) = if dirty {
            (Vec::new(), frame_rows)
        } else {
            (frame_rows, Vec::new())
        };
        let grid = self.term.grid();
        let viewport_offset = grid.display_offset();
        let cursor = self.term.grid().cursor.point;
        let cursor_style = self.term.cursor_style();
        let mode = *self.term.mode();
        let mut frame = TerminalFrame {
            session_id: self.session_id.clone(),
            rows: self.rows,
            cols: self.cols,
            cursor: TerminalCursor {
                row: cursor.line.0 + viewport_offset as i32,
                col: cursor.column.0 as u16,
                visible: viewport_offset == 0
                    && mode.contains(TermMode::SHOW_CURSOR)
                    && cursor_style.shape != CursorShape::Hidden,
                shape: match cursor_style.shape {
                    CursorShape::Block => "block",
                    CursorShape::Underline => "underline",
                    CursorShape::Beam => "beam",
                    CursorShape::HollowBlock => "hollowBlock",
                    CursorShape::Hidden => "hidden",
                }
                .to_string(),
                blinking: cursor_style.blinking,
            },
            alt_screen: mode.contains(TermMode::ALT_SCREEN),
            mouse_reporting: mode.intersects(TermMode::MOUSE_MODE),
            sgr_mouse: mode.contains(TermMode::SGR_MOUSE),
            mouse_drag: mode.contains(TermMode::MOUSE_DRAG),
            mouse_motion: mode.contains(TermMode::MOUSE_MOTION),
            alternate_scroll: mode.contains(TermMode::ALTERNATE_SCROLL),
            application_cursor: mode.contains(TermMode::APP_CURSOR),
            application_keypad: mode.contains(TermMode::APP_KEYPAD),
            bracketed_paste: mode.contains(TermMode::BRACKETED_PASTE),
            focus_events: mode.contains(TermMode::FOCUS_IN_OUT),
            insert_mode: mode.contains(TermMode::INSERT),
            line_wrap: mode.contains(TermMode::LINE_WRAP),
            origin_mode: mode.contains(TermMode::ORIGIN),
            kitty_keyboard: mode.intersects(TermMode::KITTY_KEYBOARD_PROTOCOL),
            viewport_offset,
            scrollback_line_count: grid.total_lines().saturating_sub(grid.screen_lines()),
            scrollback_limit: TERMINAL_SCROLLBACK_LINES,
            grid_rows,
            dirty_rows,
            metrics: None,
        };
        if let Some(started) = metrics_started {
            frame.metrics = Some(TerminalFrameMetrics {
                frame_build_ms: started.elapsed().as_secs_f64() * 1000.0,
            });
        }
        frame
    }

    fn snapshot_row(&self, line: usize) -> TerminalRow {
        let grid = self.term.grid();
        let mut runs = Vec::<TerminalRun>::new();
        let row = &grid[Line(line as i32 - grid.display_offset() as i32)];
        for col in 0..grid.columns() {
            let cell = &row[Column(col)];
            let style = TerminalStyle::from_cell(cell.fg, cell.bg, cell.flags);
            if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
                if let Some(last) = runs
                    .last_mut()
                    .filter(|run| usize::from(run.column) + usize::from(run.cell_width) == col)
                {
                    last.cell_width = last.cell_width.saturating_add(1);
                } else {
                    runs.push(TerminalRun {
                        column: col as u16,
                        cell_width: 1,
                        text: String::new(),
                        style,
                    });
                }
                continue;
            }
            let mut text = if cell.flags.contains(Flags::LEADING_WIDE_CHAR_SPACER) {
                " ".to_string()
            } else {
                cell.c.to_string()
            };
            if !cell.flags.contains(Flags::LEADING_WIDE_CHAR_SPACER) {
                if let Some(zerowidth) = cell.zerowidth() {
                    text.extend(zerowidth.iter());
                }
            }
            if let Some(last) = runs.last_mut() {
                if last.style == style
                    && usize::from(last.column) + usize::from(last.cell_width) == col
                {
                    last.text.push_str(&text);
                    last.cell_width = last.cell_width.saturating_add(1);
                    continue;
                }
            }
            runs.push(TerminalRun {
                column: col as u16,
                cell_width: 1,
                text,
                style,
            });
        }
        TerminalRow {
            index: line as u16,
            runs,
        }
    }
}

pub(crate) fn lock_terminal_model(
    terminal: &Arc<Mutex<TerminalModel>>,
) -> MutexGuard<'_, TerminalModel> {
    terminal
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Clone)]
pub(crate) struct TerminalEventProxy {
    pub(crate) session_id: String,
    pub(crate) events: Arc<dyn EventSink>,
}

impl EventListener for TerminalEventProxy {
    fn send_event(&self, event: Event) {
        match event {
            Event::Title(title) => self.events.emit(
                "terminal:title",
                &json!({
                    "sessionId": self.session_id,
                    "title": title
                }),
            ),
            Event::Bell => self.events.emit(
                "terminal:bell",
                &json!({
                    "sessionId": self.session_id
                }),
            ),
            Event::PtyWrite(data) => self.events.emit(
                "terminal:write-request",
                &json!({
                    "sessionId": self.session_id,
                    "data": data
                }),
            ),
            _ => {}
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct TerminalSize {
    pub(crate) rows: u16,
    pub(crate) cols: u16,
}

impl Dimensions for TerminalSize {
    fn total_lines(&self) -> usize {
        self.rows as usize
    }

    fn screen_lines(&self) -> usize {
        self.rows as usize
    }

    fn columns(&self) -> usize {
        self.cols as usize
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalFrame {
    pub(crate) session_id: String,
    pub(crate) rows: u16,
    pub(crate) cols: u16,
    pub(crate) cursor: TerminalCursor,
    pub(crate) alt_screen: bool,
    pub(crate) mouse_reporting: bool,
    pub(crate) sgr_mouse: bool,
    pub(crate) mouse_drag: bool,
    pub(crate) mouse_motion: bool,
    pub(crate) alternate_scroll: bool,
    pub(crate) application_cursor: bool,
    pub(crate) application_keypad: bool,
    pub(crate) bracketed_paste: bool,
    pub(crate) focus_events: bool,
    pub(crate) insert_mode: bool,
    pub(crate) line_wrap: bool,
    pub(crate) origin_mode: bool,
    pub(crate) kitty_keyboard: bool,
    pub(crate) viewport_offset: usize,
    pub(crate) scrollback_line_count: usize,
    pub(crate) scrollback_limit: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) grid_rows: Vec<TerminalRow>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) dirty_rows: Vec<TerminalRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) metrics: Option<TerminalFrameMetrics>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalFrameMetrics {
    pub(crate) frame_build_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalCursor {
    pub(crate) row: i32,
    pub(crate) col: u16,
    pub(crate) visible: bool,
    pub(crate) shape: String,
    pub(crate) blinking: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalRow {
    pub(crate) index: u16,
    pub(crate) runs: Vec<TerminalRun>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalRun {
    pub(crate) column: u16,
    pub(crate) cell_width: u16,
    pub(crate) text: String,
    #[serde(flatten)]
    pub(crate) style: TerminalStyle,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalStyle {
    pub(crate) fg: String,
    pub(crate) bg: String,
    pub(crate) flags: u16,
    pub(crate) bold: bool,
    pub(crate) italic: bool,
    pub(crate) underline: bool,
    pub(crate) inverse: bool,
    pub(crate) dim: bool,
}

impl TerminalStyle {
    pub(crate) fn from_cell(fg: Color, bg: Color, flags: Flags) -> Self {
        Self {
            fg: format!("{fg:?}"),
            bg: format!("{bg:?}"),
            flags: flags.bits(),
            bold: flags.intersects(Flags::BOLD | Flags::BOLD_ITALIC | Flags::DIM_BOLD),
            italic: flags.intersects(Flags::ITALIC | Flags::BOLD_ITALIC),
            underline: flags.intersects(Flags::ALL_UNDERLINES),
            inverse: flags.contains(Flags::INVERSE),
            dim: flags.intersects(Flags::DIM | Flags::DIM_BOLD),
        }
    }
}

pub(crate) fn spawn_pty_reader(
    session_id: String,
    db_path: PathBuf,
    mut reader: Box<dyn Read + Send>,
    terminal: Arc<Mutex<TerminalModel>>,
    events: Arc<dyn EventSink>,
    cancel: Arc<AtomicBool>,
    persist: bool,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let (frame_tx, frame_worker) =
            spawn_terminal_frame_coalescer_worker(terminal.clone(), events.clone());
        let db = persist
            .then(|| open_app_connection(&db_path).ok())
            .flatten();
        let mut seq = 0_u64;
        let mut buffer = vec![0_u8; 16 * 1024];
        let mut last_retention_prune = Instant::now();
        loop {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buffer[..n].to_vec();
                    if contains_coordination_prompt_bytes(&data) {
                        continue;
                    }
                    seq += 1;
                    if let Some(db) = db.as_ref() {
                        let enforce_retention =
                            last_retention_prune.elapsed() >= SESSION_TRANSCRIPT_PRUNE_INTERVAL;
                        if persist_session_stream_chunk_with_retention(
                            db,
                            &session_id,
                            seq,
                            "pty",
                            &data,
                            enforce_retention,
                        )
                        .is_ok()
                            && enforce_retention
                        {
                            last_retention_prune = Instant::now();
                        }
                    }
                    events.emit(
                        "pty:data",
                        &json!({
                            "sessionId": session_id,
                            "seq": seq,
                            "dataBase64": general_purpose::STANDARD.encode(&data)
                        }),
                    );
                    lock_terminal_model(&terminal).feed_bytes(&data);
                    let _ = frame_tx.send(());
                }
                Err(_) => break,
            }
        }
        if let Some(db) = db.as_ref() {
            let _ = prune_session_chunks_to_retention(db, &session_id);
        }
        drop(frame_tx);
        let _ = frame_worker.join();
    })
}

#[cfg(test)]
pub(crate) fn spawn_terminal_frame_coalescer(
    terminal: Arc<Mutex<TerminalModel>>,
    events: Arc<dyn EventSink>,
) -> std::sync::mpsc::Sender<()> {
    let (tx, _worker) = spawn_terminal_frame_coalescer_worker(terminal, events);
    tx
}

fn spawn_terminal_frame_coalescer_worker(
    terminal: Arc<Mutex<TerminalModel>>,
    events: Arc<dyn EventSink>,
) -> (std::sync::mpsc::Sender<()>, JoinHandle<()>) {
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let worker = thread::spawn(move || {
        let mut last_emit = Instant::now();
        while rx.recv().is_ok() {
            let elapsed = last_emit.elapsed();
            if elapsed < TERMINAL_FRAME_INTERVAL {
                thread::sleep(TERMINAL_FRAME_INTERVAL - elapsed);
            }
            while rx.try_recv().is_ok() {}
            if let Some(frame) = lock_terminal_model(&terminal).snapshot_delta() {
                emit_terminal_frame(&*events, frame);
            }
            last_emit = Instant::now();
        }
    });
    (tx, worker)
}

pub(crate) fn spawn_pty_waiter(
    session_id: String,
    db_path: PathBuf,
    mut child: Box<dyn PtyChild + Send + Sync>,
    events: Arc<dyn EventSink>,
    sessions: Arc<Mutex<HashMap<String, PtySessionHandle>>>,
    persist: bool,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let exit_code = child.wait().ok().map(|status| status.exit_code() as i32);
        if persist {
            persist_session_exit(&db_path, &session_id, exit_code, false, None);
        }
        if let Ok(mut sessions) = sessions.lock() {
            sessions.remove(&session_id);
        }
        events.emit(
            "pty:exit",
            &json!({
                "sessionId": session_id,
                "exitCode": exit_code,
                "signal": null,
                "transient": !persist
            }),
        );
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_structured_line_reader<R>(
    db_path: PathBuf,
    session_id: String,
    node_id: String,
    adapter_id: String,
    stream: String,
    reader: R,
    seq: Arc<AtomicU64>,
    events: Arc<dyn EventSink>,
    protocol: String,
    protocol_state: Arc<Mutex<AgentProtocolStreamState>>,
    protocol_driver: Option<StructuredProtocolDriver>,
    cancellation: StructuredReaderCancellation,
) -> JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let db = open_app_connection(&db_path).ok();
        let mut reader = BufReader::new(reader);
        let mut pending_chunks: Vec<(u64, String, Vec<u8>)> =
            Vec::with_capacity(STRUCTURED_TRANSCRIPT_BATCH_SIZE);
        let mut last_chunk_flush = Instant::now();
        let mut last_retention_prune = Instant::now();
        loop {
            if cancellation.is_canceled() {
                break;
            }
            let line_text = match read_bounded_protocol_line(&mut reader) {
                Ok(BoundedProtocolLine::Line(value)) => value,
                Ok(BoundedProtocolLine::Oversized) => {
                    emit_protocol_line_limit_warning(
                        &session_id,
                        &node_id,
                        &adapter_id,
                        &seq,
                        &protocol_state,
                        &events,
                    );
                    continue;
                }
                Ok(BoundedProtocolLine::Eof) => break,
                Err(_) => break,
            };
            if cancellation.is_canceled() {
                break;
            }
            if line_text.is_empty() {
                continue;
            }
            if contains_coordination_prompt_text(&line_text) {
                continue;
            }
            let next_seq = seq.fetch_add(1, Ordering::SeqCst) + 1;
            if let Some(db) = db.as_ref() {
                pending_chunks.push((
                    next_seq,
                    format!("agent-{stream}"),
                    format!("{line_text}\n").into_bytes(),
                ));
                if (pending_chunks.len() >= STRUCTURED_TRANSCRIPT_BATCH_SIZE
                    || last_chunk_flush.elapsed() >= STRUCTURED_TRANSCRIPT_FLUSH_INTERVAL)
                    && {
                        let enforce_retention =
                            last_retention_prune.elapsed() >= SESSION_TRANSCRIPT_PRUNE_INTERVAL;
                        let flushed = flush_pending_session_chunks(
                            db,
                            &session_id,
                            &mut pending_chunks,
                            enforce_retention,
                        )
                        .is_ok();
                        if flushed && enforce_retention {
                            last_retention_prune = Instant::now();
                        }
                        flushed
                    }
                {
                    last_chunk_flush = Instant::now();
                }
            }
            events.emit(
                "agent:structured-line",
                &json!(StructuredAgentLineEvent {
                    session_id: session_id.clone(),
                    node_id: node_id.clone(),
                    adapter_id: adapter_id.clone(),
                    seq: next_seq,
                    stream: stream.clone(),
                    line_base64: general_purpose::STANDARD.encode(line_text.as_bytes()),
                    runtime_instance_id: session_id.clone(),
                }),
            );
            let mut protocol_events = parse_agent_protocol_line(
                &adapter_id,
                Some(&protocol),
                &line_text,
                usize::try_from(next_seq).unwrap_or(usize::MAX),
            );
            if let Some(db) = db.as_ref() {
                match ingest_agent_usage_line(
                    db,
                    &session_id,
                    &adapter_id,
                    &protocol,
                    &line_text,
                    next_seq,
                ) {
                    Ok(true) => events.emit(
                        "usage:updated",
                        &json!({ "sessionId": session_id, "adapterId": adapter_id }),
                    ),
                    Ok(false) => {}
                    Err(error) => events.emit(
                        "usage:error",
                        &json!({
                            "sessionId": session_id,
                            "adapterId": adapter_id,
                            "message": error.to_string(),
                        }),
                    ),
                }
            }
            if let Some(driver) = protocol_driver.as_ref() {
                if let Err(error) = handle_structured_protocol_line(driver, &line_text) {
                    finish_structured_turn(&driver.rpc_state);
                    protocol_events.push(protocol_error_event(
                        &adapter_id,
                        next_seq,
                        error.to_string(),
                    ));
                }
            }
            emit_structured_protocol_events(
                &session_id,
                &node_id,
                &adapter_id,
                next_seq,
                protocol_events,
                &protocol_state,
                &events,
                false,
            );
        }
        if let Some(db) = db.as_ref() {
            for attempt in 0..3 {
                if flush_pending_session_chunks(db, &session_id, &mut pending_chunks, true).is_ok()
                    || pending_chunks.is_empty()
                {
                    break;
                }
                if attempt < 2 {
                    thread::sleep(Duration::from_millis(25));
                }
            }
        }
        emit_structured_protocol_events(
            &session_id,
            &node_id,
            &adapter_id,
            seq.load(Ordering::SeqCst),
            Vec::new(),
            &protocol_state,
            &events,
            true,
        );
    })
}

fn flush_pending_session_chunks(
    db: &Connection,
    session_id: &str,
    pending: &mut Vec<(u64, String, Vec<u8>)>,
    enforce_retention: bool,
) -> rusqlite::Result<()> {
    if pending.is_empty() {
        if enforce_retention {
            prune_session_chunks_to_retention(db, session_id)?;
        }
        return Ok(());
    }
    let chunks = pending
        .iter()
        .map(|(seq, stream, data)| (*seq, stream.as_str(), data.as_slice()))
        .collect::<Vec<_>>();
    persist_session_stream_chunks_with_retention(db, session_id, &chunks, enforce_retention)?;
    pending.clear();
    Ok(())
}

enum BoundedProtocolLine {
    Eof,
    Line(String),
    Oversized,
}

fn read_bounded_protocol_line<R: BufRead>(reader: &mut R) -> std::io::Result<BoundedProtocolLine> {
    let mut bytes = Vec::new();
    let mut oversized = false;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            if bytes.len() > MAX_STRUCTURED_LINE_BYTES {
                oversized = true;
            }
            return if bytes.is_empty() && !oversized {
                Ok(BoundedProtocolLine::Eof)
            } else if oversized {
                Ok(BoundedProtocolLine::Oversized)
            } else {
                Ok(BoundedProtocolLine::Line(
                    String::from_utf8_lossy(&bytes).into_owned(),
                ))
            };
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(available.len(), |index| index + 1);
        if !oversized {
            let content_len = consumed - usize::from(newline.is_some());
            if bytes.len().saturating_add(content_len) > MAX_STRUCTURED_LINE_BYTES + 1 {
                oversized = true;
                bytes.clear();
            } else {
                bytes.extend_from_slice(&available[..content_len]);
            }
        }
        reader.consume(consumed);
        if newline.is_some() {
            if bytes.last() == Some(&b'\r') {
                bytes.pop();
            }
            if bytes.len() > MAX_STRUCTURED_LINE_BYTES {
                oversized = true;
            }
            return if oversized {
                Ok(BoundedProtocolLine::Oversized)
            } else {
                Ok(BoundedProtocolLine::Line(
                    String::from_utf8_lossy(&bytes).into_owned(),
                ))
            };
        }
    }
}

fn protocol_error_event(adapter_id: &str, sequence: u64, message: String) -> AgentProtocolEventDto {
    AgentProtocolEventDto {
        event_type: "error".to_string(),
        adapter_id: adapter_id.to_string(),
        sequence: usize::try_from(sequence).unwrap_or(usize::MAX),
        text: Some(message),
        title: None,
        tool_call_id: None,
        message_id: None,
        part_id: None,
        message_role: None,
        interaction_id: None,
        interaction_state: None,
        choices: None,
        images: None,
        raw: None,
    }
}

fn protocol_status_event(
    adapter_id: &str,
    sequence: u64,
    message: String,
) -> AgentProtocolEventDto {
    AgentProtocolEventDto {
        event_type: "status".to_string(),
        adapter_id: adapter_id.to_string(),
        sequence: usize::try_from(sequence).unwrap_or(usize::MAX),
        text: Some(message),
        title: None,
        tool_call_id: None,
        message_id: None,
        part_id: None,
        message_role: None,
        interaction_id: None,
        interaction_state: None,
        choices: None,
        images: None,
        raw: None,
    }
}

fn emit_protocol_line_limit_warning(
    session_id: &str,
    node_id: &str,
    adapter_id: &str,
    seq: &Arc<AtomicU64>,
    state: &Arc<Mutex<AgentProtocolStreamState>>,
    events: &Arc<dyn EventSink>,
) {
    let next_seq = seq.fetch_add(1, Ordering::SeqCst) + 1;
    emit_structured_protocol_events(
        session_id,
        node_id,
        adapter_id,
        next_seq,
        vec![protocol_status_event(
            adapter_id,
            next_seq,
            format!(
                "A structured protocol message exceeded the {} byte limit and was omitted; the agent is still running.",
                MAX_STRUCTURED_LINE_BYTES
            ),
        )],
        state,
        events,
        false,
    );
}

#[allow(clippy::too_many_arguments)]
fn emit_structured_protocol_events(
    session_id: &str,
    node_id: &str,
    adapter_id: &str,
    seq: u64,
    protocol_events: Vec<AgentProtocolEventDto>,
    state: &Arc<Mutex<AgentProtocolStreamState>>,
    events: &Arc<dyn EventSink>,
    force: bool,
) {
    if protocol_events.is_empty() && !force {
        return;
    }
    let Ok(mut state) = state.lock() else {
        return;
    };
    let req = AgentProtocolParseRequest {
        adapter_id: adapter_id.to_string(),
        protocol: None,
        node_id: Some(node_id.to_string()),
        output_role: None,
        limit: None,
        line: None,
        lines: Vec::new(),
        transcript: None,
        chunks: None,
        user_prompt: None,
    };
    if !protocol_events.is_empty() {
        apply_agent_stream_events(&mut state, &protocol_events, &req);
        for event in &protocol_events {
            coalesce_snapshot_event(&mut state.pending_snapshot_events, event);
        }
        state.snapshot_dirty = true;
    }
    if !state.snapshot_dirty {
        return;
    }
    let now = Instant::now();
    let coalescible = protocol_events.iter().all(|event| {
        matches!(
            event.event_type.as_str(),
            "assistant_delta" | "reasoning_delta" | "tool_delta" | "plan_update"
        )
    });
    if !force
        && coalescible
        && state
            .last_snapshot_emit
            .is_some_and(|last| now.duration_since(last) < STRUCTURED_PROTOCOL_UPDATE_INTERVAL)
    {
        return;
    }
    state.last_snapshot_emit = Some(now);
    state.snapshot_dirty = false;
    let pending_events = std::mem::take(&mut state.pending_snapshot_events);
    let controls = std::mem::take(&mut state.pending_controls);
    let messages = state.visible_messages();
    let active = state.active;
    drop(state);
    events.emit(
        "agent:protocol-update",
        &json!(StructuredAgentProtocolUpdateEvent {
            session_id: session_id.to_string(),
            runtime_instance_id: session_id.to_string(),
            node_id: node_id.to_string(),
            adapter_id: adapter_id.to_string(),
            seq,
            events: pending_events,
            messages,
            controls,
            active,
        }),
    );
}

fn coalesce_snapshot_event(
    pending: &mut Vec<AgentProtocolEventDto>,
    event: &AgentProtocolEventDto,
) {
    let Some(previous) = pending.last_mut() else {
        pending.push(event.clone());
        return;
    };
    let matching_delta = previous.event_type == event.event_type
        && matches!(
            event.event_type.as_str(),
            "assistant_delta" | "reasoning_delta" | "tool_delta"
        )
        && previous.message_id == event.message_id
        && previous.part_id == event.part_id
        && previous.tool_call_id == event.tool_call_id;
    if matching_delta {
        append_snapshot_event_text(&mut previous.text, event.text.as_deref());
        previous.sequence = event.sequence;
        previous.raw.clone_from(&event.raw);
        return;
    }
    if previous.event_type == "plan_update" && event.event_type == "plan_update" {
        previous.clone_from(event);
        return;
    }
    pending.push(event.clone());
}

fn append_snapshot_event_text(target: &mut Option<String>, addition: Option<&str>) {
    let Some(addition) = addition.filter(|value| !value.is_empty()) else {
        return;
    };
    let target = target.get_or_insert_with(String::new);
    target.push_str(addition);
    if target.len() <= crate::agent_protocol::MAX_AGENT_TOOL_OUTPUT_BYTES {
        return;
    }
    let mut start = target.len() - crate::agent_protocol::MAX_AGENT_TOOL_OUTPUT_BYTES;
    while !target.is_char_boundary(start) {
        start += 1;
    }
    target.drain(..start);
}

pub(crate) fn spawn_structured_waiter(
    db_path: PathBuf,
    session_id: String,
    node_id: String,
    adapter_id: String,
    process: StructuredAgentProcessHandle,
    events: Arc<dyn EventSink>,
    sessions: Arc<Mutex<HashMap<String, StructuredAgentSessionHandle>>>,
    rpc_state: Option<Arc<Mutex<StructuredAgentRpcState>>>,
    reader_cancel: Arc<AtomicBool>,
    readers: &mut Vec<JoinHandle<()>>,
) -> Result<JoinHandle<()>> {
    let reader_slot = Arc::new(Mutex::new(Some(std::mem::take(readers))));
    let waiter_readers = reader_slot.clone();
    let waiter = thread::Builder::new()
        .name(format!("structured-wait-{session_id}"))
        .spawn(move || {
            let readers = waiter_readers
                .lock()
                .ok()
                .and_then(|mut readers| readers.take())
                .unwrap_or_default();
            let exit_code = loop {
                let status = process
                    .child
                    .lock()
                    .ok()
                    .and_then(|mut child| child.try_wait().ok())
                    .flatten();
                if let Some(status) = status {
                    break status.code();
                }
                thread::sleep(Duration::from_millis(25));
            };
            let _ = process.process_tree.terminate();
            reader_cancel.store(true, Ordering::SeqCst);
            for reader in readers {
                let _ = reader.join();
            }
            let incomplete_turn = rpc_state
                .as_ref()
                .and_then(|state| state.lock().ok().map(|state| state.turn_active))
                .unwrap_or(false);
            let termination_reason = process
                .termination_reason
                .lock()
                .ok()
                .and_then(|reason| *reason);
            persist_session_exit(
                &db_path,
                &session_id,
                exit_code,
                incomplete_turn,
                termination_reason,
            );
            if let Ok(mut sessions) = sessions.lock() {
                sessions.remove(&session_id);
            }
            events.emit(
                "agent:structured-exit",
                &json!(StructuredAgentExitEvent {
                    session_id: session_id.clone(),
                    node_id,
                    adapter_id,
                    exit_code,
                    signal: None,
                    runtime_instance_id: session_id.clone(),
                    incomplete_turn,
                    termination_reason,
                }),
            );
        });
    if waiter.is_err() {
        if let Ok(mut owned_readers) = reader_slot.lock() {
            readers.extend(owned_readers.take().unwrap_or_default());
        }
    }
    waiter.context("Could not start the structured-agent waiter")
}

pub(crate) fn is_persistent_stdin_protocol(protocol: &str) -> bool {
    protocol == "claude-stream-json"
}

pub(crate) fn reserve_localhost_port() -> Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

pub(crate) fn json_string_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().map(str::to_string)
}

pub(crate) fn begin_structured_turn(state: &Arc<Mutex<StructuredAgentRpcState>>) -> Result<()> {
    let mut state = state
        .lock()
        .map_err(|error| anyhow!("structured RPC state is poisoned: {error}"))?;
    if state.turn_active {
        bail!("structured session is still streaming a response");
    }
    state.turn_active = true;
    state.codex.turn_id = None;
    state.codex.turn_start_request_id = None;
    state.cancel_requested = false;
    state.claude.pending_interaction = None;
    state.codex.pending_interaction = None;
    state.opencode.pending_interactions.clear();
    Ok(())
}

pub(crate) fn finish_structured_turn(state: &Arc<Mutex<StructuredAgentRpcState>>) {
    if let Ok(mut state) = state.lock() {
        state.turn_active = false;
        state.codex.turn_id = None;
        state.codex.turn_start_request_id = None;
        state.cancel_requested = false;
        state.claude.pending_interaction = None;
        state.codex.pending_interaction = None;
        state.opencode.pending_interactions.clear();
    }
}

pub(crate) fn handle_structured_protocol_line(
    driver: &StructuredProtocolDriver,
    line: &str,
) -> Result<()> {
    let parsed = match serde_json::from_str::<Value>(line) {
        Ok(value) => value,
        Err(_) => return Ok(()),
    };

    match driver.protocol.as_str() {
        "claude-stream-json" => handle_claude_stream_line(driver, &parsed),
        "hermes-gateway" => handle_hermes_gateway_line(driver, &parsed),
        "codex-app-server" => handle_codex_app_server_line(driver, &parsed),
        "pi-rpc" => handle_pi_rpc_line(driver, &parsed),
        "hermes-acp" => handle_acp_line(driver, &parsed),
        _ => Ok(()),
    }?;
    mark_structured_turn_done_if_needed(&driver.rpc_state, &driver.protocol, &parsed);
    Ok(())
}

fn handle_claude_stream_line(driver: &StructuredProtocolDriver, parsed: &Value) -> Result<()> {
    if let Some(session_id) =
        json_string_at(parsed, &["session_id"]).or_else(|| json_string_at(parsed, &["sessionId"]))
    {
        let should_persist = {
            let mut state = driver
                .rpc_state
                .lock()
                .map_err(|error| anyhow!(error.to_string()))?;
            if state.claude.session_id.as_deref() == Some(&session_id) {
                false
            } else {
                state.claude.session_id = Some(session_id.clone());
                true
            }
        };
        if should_persist {
            persist_agent_resume_cursor(
                &driver.db_path,
                &driver.session_id,
                AgentResumeCursor::new(StructuredProtocol::ClaudeStreamJson, session_id),
            )?;
        }
    }
    if json_string_at(parsed, &["type"]).as_deref() == Some("control_request")
        && json_string_at(parsed, &["request", "subtype"]).as_deref() == Some("can_use_tool")
    {
        driver
            .rpc_state
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?
            .claude
            .pending_interaction = Some(parsed.clone());
    }
    Ok(())
}

fn handle_pi_rpc_line(driver: &StructuredProtocolDriver, parsed: &Value) -> Result<()> {
    if json_string_at(parsed, &["type"]).as_deref() == Some("agent_settled") {
        request_pi_usage_snapshot(driver)?;
    }
    let session_id = json_string_at(parsed, &["data", "sessionId"])
        .or_else(|| json_string_at(parsed, &["data", "session_id"]))
        .or_else(|| json_string_at(parsed, &["sessionId"]))
        .or_else(|| json_string_at(parsed, &["session_id"]));
    let Some(session_id) = session_id else {
        return Ok(());
    };
    let should_persist = {
        let mut state = driver
            .rpc_state
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?;
        if state.pi.session_id.as_deref() == Some(&session_id) {
            false
        } else {
            state.pi.session_id = Some(session_id.clone());
            true
        }
    };
    if should_persist {
        persist_agent_resume_cursor(
            &driver.db_path,
            &driver.session_id,
            AgentResumeCursor::new(StructuredProtocol::PiRpc, session_id),
        )?;
    }
    Ok(())
}

pub(crate) fn mark_structured_turn_done_if_needed(
    state: &Arc<Mutex<StructuredAgentRpcState>>,
    protocol: &str,
    parsed: &Value,
) {
    let name = normalized_protocol_event_name(parsed);
    let done = match protocol {
        "claude-stream-json" => {
            name == "result" || json_string_at(parsed, &["type"]).as_deref() == Some("result")
        }
        "codex-app-server" => {
            (name.contains("turn") || name.contains("thread"))
                && (name.contains("complete")
                    || name.contains("completed")
                    || name.contains("failed")
                    || name.contains("error"))
        }
        "hermes-acp" | "hermes-gateway" => {
            (name.contains("message") && name.contains("complete"))
                || (name.contains("turn") && (name.contains("end") || name.contains("done")))
                || name == "end turn"
                || name == "cancelled"
                || name == "refusal"
                || name.contains("agent end")
        }
        "pi-rpc" => name == "agent settled",
        _ => false,
    };
    if done {
        finish_structured_turn(state);
    }
}

pub(crate) fn structured_rpc_send_prompt(
    driver: &StructuredProtocolDriver,
    prompt: &StructuredPrompt,
) -> Result<()> {
    let protocol = StructuredProtocol::parse(&driver.protocol)?;
    if !prompt.images.is_empty() && !protocol.capabilities().image_input {
        bail!("{} does not support image input", driver.protocol);
    }
    if !structured_protocol_uses_turn_gate(&driver.protocol) {
        return structured_write_prompt(&driver.stdin, &prompt.text);
    }
    begin_structured_turn(&driver.rpc_state)?;
    let result = structured_rpc_send_prompt_unchecked(driver, prompt);
    if result.is_err() {
        finish_structured_turn(&driver.rpc_state);
    }
    result
}

pub(crate) fn structured_protocol_uses_turn_gate(protocol: &str) -> bool {
    matches!(
        protocol,
        "claude-stream-json" | "pi-rpc" | "hermes-gateway" | "codex-app-server" | "hermes-acp"
    )
}

pub(crate) fn structured_rpc_send_prompt_unchecked(
    driver: &StructuredProtocolDriver,
    prompt: &StructuredPrompt,
) -> Result<()> {
    match driver.protocol.as_str() {
        "claude-stream-json" => {
            if let Some(model) = driver.model.as_deref() {
                let request_id = next_structured_rpc_id(&driver.rpc_state)?;
                structured_write_json(
                    &driver.stdin,
                    &json!({
                        "type": "control_request",
                        "request_id": format!("wheeljack-{request_id}"),
                        "request": { "subtype": "set_model", "model": model },
                    }),
                )?;
            }
            write_claude_stream_prompt(driver, prompt)
        }
        "pi-rpc" => {
            if let Some(model) = driver.model.as_deref() {
                let provider = driver
                    .provider
                    .as_deref()
                    .ok_or_else(|| anyhow!("Pi model selection requires a provider"))?;
                structured_write_json(
                    &driver.stdin,
                    &json!({ "type": "set_model", "provider": provider, "modelId": model }),
                )?;
            }
            if let Some(thinking) = driver.thinking.as_deref() {
                structured_write_json(
                    &driver.stdin,
                    &json!({ "type": "set_thinking_level", "level": thinking }),
                )?;
            }
            let mut payload = json!({
                "type": "prompt",
                "message": prompt.text,
            });
            if !prompt.images.is_empty() {
                payload["images"] = Value::Array(
                    prompt
                        .images
                        .iter()
                        .map(|image| {
                            Ok(json!({
                                "type": "image",
                                "data": encoded_prompt_image(image)?,
                                "mimeType": image.mime_type,
                            }))
                        })
                        .collect::<Result<Vec<_>>>()?,
                );
            }
            structured_write_json(&driver.stdin, &payload)
        }
        "hermes-gateway" => {
            let session_id = {
                let mut state = driver
                    .rpc_state
                    .lock()
                    .map_err(|error| anyhow!(error.to_string()))?;
                if let Some(session_id) = state.hermes.session_id.clone() {
                    Some(session_id)
                } else {
                    state.pending_prompt = Some(prompt.clone());
                    None
                }
            };
            if let Some(session_id) = session_id {
                send_hermes_prompt_submit(driver, &session_id, &prompt.text)
            } else {
                send_hermes_session_create(driver)
            }
        }
        "codex-app-server" => {
            let thread_id = {
                let mut state = driver
                    .rpc_state
                    .lock()
                    .map_err(|error| anyhow!(error.to_string()))?;
                if let Some(thread_id) = state.codex.thread_id.clone() {
                    Some(thread_id)
                } else {
                    state.pending_prompt = Some(prompt.clone());
                    None
                }
            };
            if let Some(thread_id) = thread_id {
                send_codex_turn_start(driver, &thread_id, prompt)
            } else {
                send_codex_initialize(driver)
            }
        }
        "hermes-acp" => {
            let session_id = {
                let mut state = driver
                    .rpc_state
                    .lock()
                    .map_err(|error| anyhow!(error.to_string()))?;
                if let Some(session_id) = state.acp.session_id.clone() {
                    Some(session_id)
                } else {
                    state.pending_prompt = Some(prompt.clone());
                    None
                }
            };
            if let Some(session_id) = session_id {
                send_acp_session_prompt(driver, &session_id, prompt)
            } else {
                send_acp_initialize(driver)
            }
        }
        _ => structured_write_prompt(&driver.stdin, &prompt.text),
    }
}

pub(crate) fn request_pi_session_state(driver: &StructuredProtocolDriver) -> Result<()> {
    let request_id = next_structured_rpc_id(&driver.rpc_state)?;
    structured_write_json(
        &driver.stdin,
        &json!({ "id": request_id, "type": "get_state" }),
    )
}

pub(crate) fn request_pi_usage_snapshot(driver: &StructuredProtocolDriver) -> Result<()> {
    let request_id = next_structured_rpc_id(&driver.rpc_state)?;
    structured_write_json(
        &driver.stdin,
        &json!({ "id": request_id, "type": "get_session_stats" }),
    )
}

pub(crate) fn write_claude_stream_prompt(
    driver: &StructuredProtocolDriver,
    prompt: &StructuredPrompt,
) -> Result<()> {
    let content = if prompt.images.is_empty() {
        json!(prompt.text)
    } else {
        let mut content = Vec::new();
        if !prompt.text.is_empty() {
            content.push(json!({ "type": "text", "text": prompt.text }));
        }
        for image in &prompt.images {
            content.push(json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image.mime_type,
                    "data": encoded_prompt_image(image)?,
                },
            }));
        }
        Value::Array(content)
    };
    structured_write_json(
        &driver.stdin,
        &json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": content,
            },
            "parent_tool_use_id": null,
        }),
    )
}

pub(crate) fn send_hermes_session_create(driver: &StructuredProtocolDriver) -> Result<()> {
    let request_id = next_structured_rpc_id(&driver.rpc_state)?;
    structured_write_json(
        &driver.stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "session.create",
            "params": {
                "cwd": driver.cwd.as_str(),
            },
        }),
    )
}

pub(crate) fn send_hermes_prompt_submit(
    driver: &StructuredProtocolDriver,
    session_id: &str,
    prompt: &str,
) -> Result<()> {
    let request_id = next_structured_rpc_id(&driver.rpc_state)?;
    structured_write_json(
        &driver.stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "prompt.submit",
            "params": {
                "session_id": session_id,
                "text": prompt,
            },
        }),
    )
}

pub(crate) fn handle_hermes_gateway_line(
    driver: &StructuredProtocolDriver,
    parsed: &Value,
) -> Result<()> {
    let session_id = json_string_at(parsed, &["result", "session_id"])
        .or_else(|| json_string_at(parsed, &["result", "sessionId"]))
        .or_else(|| json_string_at(parsed, &["result", "id"]));
    let Some(session_id) = session_id else {
        return Ok(());
    };

    let pending_prompt = {
        let mut state = driver
            .rpc_state
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?;
        if state.hermes.session_id.is_none() {
            state.hermes.session_id = Some(session_id.clone());
        }
        state.pending_prompt.take()
    };

    if let Some(prompt) = pending_prompt {
        send_hermes_prompt_submit(driver, &session_id, &prompt.text)?;
    }
    Ok(())
}

pub(crate) fn send_codex_initialize(driver: &StructuredProtocolDriver) -> Result<()> {
    let should_send = {
        let state = driver
            .rpc_state
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?;
        state.next_id == 0
    };
    if !should_send {
        return Ok(());
    }

    let request_id = next_structured_rpc_id(&driver.rpc_state)?;
    structured_write_json(
        &driver.stdin,
        &json!({
            "id": request_id,
            "method": "initialize",
            "params": {
                "clientInfo": {
                    "name": "wheeljack",
                    "title": "wheeljack",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "capabilities": {},
            },
        }),
    )
}

pub(crate) fn send_codex_thread_start(driver: &StructuredProtocolDriver) -> Result<()> {
    let request_id = next_structured_rpc_id(&driver.rpc_state)?;
    let resume_thread_id = driver
        .rpc_state
        .lock()
        .map_err(|error| anyhow!(error.to_string()))?
        .codex
        .resume_thread_id
        .clone();
    let (method, mut params) = match resume_thread_id {
        Some(thread_id) => ("thread/resume", json!({ "threadId": thread_id })),
        None => ("thread/start", json!({ "cwd": driver.cwd.as_str() })),
    };
    if let Some(policy) = driver.approval_policy.as_deref() {
        validate_codex_approval_policy(policy)?;
        params["approvalPolicy"] = json!(policy);
    }
    if let Some(sandbox) = driver.sandbox.as_deref() {
        validate_codex_sandbox(sandbox)?;
        params["sandbox"] = json!(sandbox);
    }
    structured_write_json(
        &driver.stdin,
        &json!({
            "id": request_id,
            "method": method,
            "params": params,
        }),
    )
}

pub(crate) fn send_codex_turn_start(
    driver: &StructuredProtocolDriver,
    thread_id: &str,
    prompt: &StructuredPrompt,
) -> Result<()> {
    let request_id = next_structured_rpc_id(&driver.rpc_state)?;
    let mut input = Vec::new();
    if !prompt.text.is_empty() {
        input.push(json!({ "type": "text", "text": prompt.text }));
    }
    input.extend(
        prompt
            .images
            .iter()
            .map(|image| json!({ "type": "localImage", "path": image.path })),
    );
    let mut params = json!({
        "threadId": thread_id,
        "input": input,
    });
    if let Some(model) = driver.model.as_deref() {
        params["model"] = json!(model);
    }
    if let Some(effort) = driver.thinking.as_deref() {
        params["effort"] = json!(effort);
    }
    if let Some(policy) = driver.approval_policy.as_deref() {
        validate_codex_approval_policy(policy)?;
        params["approvalPolicy"] = json!(policy);
    }
    if let Some(sandbox) = driver.sandbox.as_deref() {
        params["sandboxPolicy"] = codex_sandbox_policy(sandbox, &driver.cwd)?;
    }
    driver
        .rpc_state
        .lock()
        .map_err(|error| anyhow!(error.to_string()))?
        .codex
        .turn_start_request_id = Some(request_id);
    structured_write_json(
        &driver.stdin,
        &json!({
            "id": request_id,
            "method": "turn/start",
            "params": params,
        }),
    )
}

fn validate_codex_approval_policy(policy: &str) -> Result<()> {
    if matches!(policy, "untrusted" | "on-request" | "never") {
        Ok(())
    } else {
        bail!("unsupported Codex approval policy: {policy}")
    }
}

fn validate_codex_sandbox(sandbox: &str) -> Result<()> {
    if matches!(
        sandbox,
        "read-only" | "workspace-write" | "danger-full-access"
    ) {
        Ok(())
    } else {
        bail!("unsupported Codex sandbox: {sandbox}")
    }
}

fn codex_sandbox_policy(sandbox: &str, cwd: &str) -> Result<Value> {
    validate_codex_sandbox(sandbox)?;
    Ok(match sandbox {
        "read-only" => json!({ "type": "readOnly" }),
        "workspace-write" => json!({ "type": "workspaceWrite", "writableRoots": [cwd] }),
        "danger-full-access" => json!({ "type": "dangerFullAccess" }),
        _ => unreachable!(),
    })
}

fn send_codex_turn_interrupt(
    driver: &StructuredProtocolDriver,
    thread_id: &str,
    turn_id: &str,
) -> Result<()> {
    let request_id = next_structured_rpc_id(&driver.rpc_state)?;
    structured_write_json(
        &driver.stdin,
        &json!({
            "id": request_id,
            "method": "turn/interrupt",
            "params": {
                "threadId": thread_id,
                "turnId": turn_id,
            },
        }),
    )
}

pub(crate) fn handle_codex_app_server_line(
    driver: &StructuredProtocolDriver,
    parsed: &Value,
) -> Result<()> {
    if let Some(response_id) = json_id_as_u64(parsed) {
        let is_turn_start_response = {
            let mut state = driver
                .rpc_state
                .lock()
                .map_err(|error| anyhow!(error.to_string()))?;
            if state.codex.turn_start_request_id == Some(response_id) {
                state.codex.turn_start_request_id = None;
                true
            } else {
                false
            }
        };
        if is_turn_start_response {
            if let Some(error) = parsed.get("error") {
                finish_structured_turn(&driver.rpc_state);
                bail!("codex could not start the turn: {error}");
            }
        }
    }
    if matches!(
        json_string_at(parsed, &["method"]).as_deref(),
        Some(
            "item/commandExecution/requestApproval"
                | "item/fileChange/requestApproval"
                | "item/permissions/requestApproval"
                | "item/tool/requestUserInput"
        )
    ) {
        driver
            .rpc_state
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?
            .codex
            .pending_interaction = Some(parsed.clone());
        return Ok(());
    }
    if json_string_at(parsed, &["method"]).as_deref() == Some("turn/started") {
        let turn_id = json_string_at(parsed, &["params", "turn", "id"])
            .or_else(|| json_string_at(parsed, &["params", "turnId"]));
        if let Some(turn_id) = turn_id {
            let pending_interrupt = {
                let mut state = driver
                    .rpc_state
                    .lock()
                    .map_err(|error| anyhow!(error.to_string()))?;
                state.codex.turn_id = Some(turn_id.clone());
                state
                    .cancel_requested
                    .then(|| {
                        state
                            .codex
                            .thread_id
                            .clone()
                            .map(|thread_id| (thread_id, turn_id))
                    })
                    .flatten()
            };
            if let Some((thread_id, turn_id)) = pending_interrupt {
                send_codex_turn_interrupt(driver, &thread_id, &turn_id)?;
            }
        }
    }
    match json_id_as_u64(parsed) {
        Some(1) => {
            structured_write_json(
                &driver.stdin,
                &json!({
                    "method": "initialized",
                    "params": {},
                }),
            )?;
            send_codex_thread_start(driver)?;
        }
        Some(2) => {
            if let Some(error) = parsed.get("error") {
                finish_structured_turn(&driver.rpc_state);
                bail!("codex could not open the requested thread: {error}");
            }
            let thread_id = json_string_at(parsed, &["result", "thread", "id"])
                .or_else(|| json_string_at(parsed, &["result", "threadId"]))
                .or_else(|| json_string_at(parsed, &["result", "id"]));
            let Some(thread_id) = thread_id else {
                return Ok(());
            };
            let pending_prompt = {
                let mut state = driver
                    .rpc_state
                    .lock()
                    .map_err(|error| anyhow!(error.to_string()))?;
                if state.codex.thread_id.is_none() {
                    state.codex.thread_id = Some(thread_id.clone());
                }
                state.pending_prompt.take()
            };
            persist_agent_resume_cursor(
                &driver.db_path,
                &driver.session_id,
                AgentResumeCursor::new(StructuredProtocol::CodexAppServer, thread_id.clone()),
            )?;
            if let Some(prompt) = pending_prompt {
                send_codex_turn_start(driver, &thread_id, &prompt)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub(crate) fn structured_rpc_cancel(driver: &StructuredProtocolDriver) -> Result<()> {
    if !matches!(
        driver.protocol.as_str(),
        "codex-app-server" | "claude-stream-json" | "pi-rpc"
    ) {
        bail!(
            "structured protocol does not support turn cancellation: {}",
            driver.protocol
        );
    }
    let (thread_id, turn_id) = {
        let mut state = driver
            .rpc_state
            .lock()
            .map_err(|error| anyhow!("structured RPC state is poisoned: {error}"))?;
        if !state.turn_active {
            bail!("structured session has no active turn");
        }
        state.cancel_requested = true;
        (state.codex.thread_id.clone(), state.codex.turn_id.clone())
    };
    let result = match driver.protocol.as_str() {
        "codex-app-server" => match (thread_id, turn_id) {
            (Some(thread_id), Some(turn_id)) => {
                send_codex_turn_interrupt(driver, &thread_id, &turn_id)
            }
            _ => Ok(()),
        },
        "claude-stream-json" => {
            let request_id = next_structured_rpc_id(&driver.rpc_state)?;
            structured_write_json(
                &driver.stdin,
                &json!({
                    "type": "control_request",
                    "request_id": format!("wheeljack-{request_id}"),
                    "request": { "subtype": "interrupt" },
                }),
            )
        }
        "pi-rpc" => structured_write_json(&driver.stdin, &json!({ "type": "abort" })),
        _ => unreachable!(),
    };
    if result.is_err() {
        if let Ok(mut state) = driver.rpc_state.lock() {
            state.cancel_requested = false;
        }
    }
    result
}

pub(crate) fn structured_rpc_respond(
    protocol: &str,
    stdin: &Arc<Mutex<ChildStdin>>,
    state: &Arc<Mutex<StructuredAgentRpcState>>,
    response: &str,
    approved: bool,
) -> Result<()> {
    let pending = {
        let mut state = state.lock().map_err(|error| anyhow!(error.to_string()))?;
        match protocol {
            "codex-app-server" => state.codex.pending_interaction.take(),
            "claude-stream-json" => state.claude.pending_interaction.take(),
            _ => bail!("structured interaction responses are not supported for {protocol}"),
        }
        .ok_or_else(|| anyhow!("structured agent has no pending interaction"))?
    };
    let payload = match protocol {
        "codex-app-server" => {
            let id = pending
                .get("id")
                .cloned()
                .ok_or_else(|| anyhow!("Codex interaction is missing an id"))?;
            let method = json_string_at(&pending, &["method"]).unwrap_or_default();
            let result = if method == "item/tool/requestUserInput" {
                let answers = pending
                    .get("params")
                    .and_then(|params| params.get("questions"))
                    .and_then(Value::as_array)
                    .map(|questions| {
                        questions
                            .iter()
                            .filter_map(|question| {
                                json_string_at(question, &["id"])
                                    .map(|id| (id, json!({ "answers": [response] })))
                            })
                            .collect::<serde_json::Map<String, Value>>()
                    })
                    .unwrap_or_default();
                json!({ "answers": answers })
            } else {
                json!({ "decision": if approved { "accept" } else { "decline" } })
            };
            json!({ "id": id, "result": result })
        }
        "claude-stream-json" => {
            let request_id = json_string_at(&pending, &["request_id"])
                .ok_or_else(|| anyhow!("Claude interaction is missing a request id"))?;
            let control_response = if approved {
                let mut updated_input = pending
                    .get("request")
                    .and_then(|request| request.get("input"))
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                if json_string_at(&pending, &["request", "tool_name"]).as_deref()
                    == Some("AskUserQuestion")
                {
                    let answers = updated_input
                        .get("questions")
                        .and_then(Value::as_array)
                        .map(|questions| {
                            questions
                                .iter()
                                .filter_map(|question| {
                                    json_string_at(question, &["question"])
                                        .map(|question| (question, json!(response)))
                                })
                                .collect::<serde_json::Map<String, Value>>()
                        })
                        .unwrap_or_default();
                    if let Some(input) = updated_input.as_object_mut() {
                        input.insert("answers".to_string(), Value::Object(answers));
                    }
                }
                json!({
                    "behavior": "allow",
                    "updatedInput": updated_input
                })
            } else {
                json!({ "behavior": "deny", "message": response })
            };
            json!({
                "type": "control_response",
                "response": { "subtype": "success", "request_id": request_id, "response": control_response }
            })
        }
        _ => bail!("structured interaction responses are not supported for {protocol}"),
    };
    if let Err(error) = structured_write_json(stdin, &payload) {
        if let Ok(mut state) = state.lock() {
            if protocol == "codex-app-server" {
                state.codex.pending_interaction = Some(pending);
            } else {
                state.claude.pending_interaction = Some(pending);
            }
        }
        return Err(error);
    }
    Ok(())
}

pub(crate) fn send_acp_initialize(driver: &StructuredProtocolDriver) -> Result<()> {
    let should_send = {
        let state = driver
            .rpc_state
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?;
        state.next_id == 0
    };
    if !should_send {
        return Ok(());
    }

    let request_id = next_structured_rpc_id(&driver.rpc_state)?;
    structured_write_json(
        &driver.stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "initialize",
            "params": {
                "protocolVersion": 1,
                "clientCapabilities": {},
                "clientInfo": {
                    "name": "wheeljack",
                    "title": "wheeljack",
                    "version": env!("CARGO_PKG_VERSION"),
                },
            },
        }),
    )
}

pub(crate) fn send_acp_authenticate(
    driver: &StructuredProtocolDriver,
    method_id: &str,
) -> Result<()> {
    {
        let mut state = driver
            .rpc_state
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?;
        state.acp.auth_pending = true;
    }
    let request_id = next_structured_rpc_id(&driver.rpc_state)?;
    structured_write_json(
        &driver.stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "authenticate",
            "params": {
                "methodId": method_id,
            },
        }),
    )
}

pub(crate) fn send_acp_session_new(driver: &StructuredProtocolDriver) -> Result<()> {
    let request_id = next_structured_rpc_id(&driver.rpc_state)?;
    structured_write_json(
        &driver.stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "session/new",
            "params": {
                "cwd": acp_cwd(driver),
                "mcpServers": [],
            },
        }),
    )
}

pub(crate) fn send_acp_session_prompt(
    driver: &StructuredProtocolDriver,
    session_id: &str,
    prompt: &StructuredPrompt,
) -> Result<()> {
    let request_id = next_structured_rpc_id(&driver.rpc_state)?;
    let mut parts = Vec::new();
    if !prompt.text.is_empty() {
        parts.push(json!({ "type": "text", "text": prompt.text }));
    }
    for image in &prompt.images {
        parts.push(json!({
            "type": "image",
            "mimeType": image.mime_type,
            "data": encoded_prompt_image(image)?,
        }));
    }
    structured_write_json(
        &driver.stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "session/prompt",
            "params": {
                "sessionId": session_id,
                "prompt": parts,
            },
        }),
    )
}

pub(crate) fn handle_acp_line(driver: &StructuredProtocolDriver, parsed: &Value) -> Result<()> {
    if json_string_at(parsed, &["method"]).as_deref() == Some("session/request_permission") {
        return send_acp_permission_response(driver, parsed);
    }

    let Some(result) = parsed.get("result") else {
        return Ok(());
    };

    if result.get("protocolVersion").is_some() || result.get("authMethods").is_some() {
        if let Some(method_id) = acp_auth_method_id(result) {
            return send_acp_authenticate(driver, &method_id);
        }
        return send_acp_session_new(driver);
    }

    let was_auth_pending = {
        let mut state = driver
            .rpc_state
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?;
        let pending = state.acp.auth_pending;
        if pending {
            state.acp.auth_pending = false;
        }
        pending
    };
    if was_auth_pending {
        return send_acp_session_new(driver);
    }

    let session_id = json_string_at(parsed, &["result", "sessionId"])
        .or_else(|| json_string_at(parsed, &["result", "session_id"]))
        .or_else(|| json_string_at(parsed, &["result", "id"]))
        .or_else(|| json_string_at(parsed, &["result", "session", "id"]))
        .or_else(|| json_string_at(parsed, &["result", "session", "sessionId"]))
        .or_else(|| json_string_at(parsed, &["result", "session", "session_id"]));
    let Some(session_id) = session_id else {
        return Ok(());
    };

    let pending_prompt = {
        let mut state = driver
            .rpc_state
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?;
        if state.acp.session_id.is_none() {
            state.acp.session_id = Some(session_id.clone());
        }
        state.pending_prompt.take()
    };

    if let Some(prompt) = pending_prompt {
        send_acp_session_prompt(driver, &session_id, &prompt)?;
    }
    Ok(())
}

pub(crate) fn acp_auth_method_id(result: &Value) -> Option<String> {
    let methods = result.get("authMethods")?.as_array()?;
    methods
        .iter()
        .find_map(|method| method.get("id")?.as_str().map(str::to_string))
}

pub(crate) fn send_acp_permission_response(
    driver: &StructuredProtocolDriver,
    parsed: &Value,
) -> Result<()> {
    let Some(id) = parsed.get("id").cloned() else {
        return Ok(());
    };
    let option_id = parsed
        .get("params")
        .and_then(|params| params.get("options"))
        .and_then(Value::as_array)
        .and_then(|options| {
            options
                .iter()
                .find(|option| {
                    json_string_at(option, &["kind"]).as_deref() == Some("reject_once")
                        || json_string_at(option, &["optionId"]).as_deref() == Some("reject-once")
                })
                .or_else(|| options.first())
        })
        .and_then(|option| json_string_at(option, &["optionId"]))
        .unwrap_or_else(|| "reject-once".to_string());

    structured_write_json(
        &driver.stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "outcome": {
                    "outcome": "selected",
                    "optionId": option_id,
                },
            },
        }),
    )
}

pub(crate) fn acp_cwd(driver: &StructuredProtocolDriver) -> String {
    let path = PathBuf::from(&driver.cwd);
    path.canonicalize()
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

pub(crate) fn next_structured_rpc_id(state: &Arc<Mutex<StructuredAgentRpcState>>) -> Result<u64> {
    let mut state = state.lock().map_err(|error| anyhow!(error.to_string()))?;
    state.next_id += 1;
    Ok(state.next_id)
}

pub(crate) fn json_id_as_u64(value: &Value) -> Option<u64> {
    value
        .get("id")
        .and_then(|id| id.as_u64().or_else(|| id.as_str()?.parse::<u64>().ok()))
}

pub(crate) fn structured_sse_start(driver: &StructuredSseDriver) -> Result<JoinHandle<()>> {
    match driver.protocol.as_str() {
        "opencode-sse" => {
            wait_for_http_health(driver.port, "/global/health", Duration::from_secs(8))?;
            let existing_session_id = driver
                .rpc_state
                .lock()
                .map_err(|error| anyhow!("structured RPC state is poisoned: {error}"))?
                .opencode
                .session_id
                .clone();
            let session_id = if let Some(session_id) = existing_session_id {
                http_json_request(driver.port, "GET", &format!("/session/{session_id}"), None)?;
                session_id
            } else {
                let mut body = json!({ "title": "wheeljack" });
                if let Some(action) = driver.approval_policy.as_deref() {
                    body["permission"] = json!([{
                        "permission": "*",
                        "pattern": "*",
                        "action": action,
                    }]);
                }
                let response = http_json_request(driver.port, "POST", "/session", Some(&body))?;
                json_string_at(&response, &["id"])
                    .or_else(|| json_string_at(&response, &["data", "id"]))
                    .ok_or_else(|| anyhow!("opencode server did not return a session id"))?
            };
            driver
                .rpc_state
                .lock()
                .map_err(|error| anyhow!("structured RPC state is poisoned: {error}"))?
                .opencode
                .session_id = Some(session_id);
            let session_id = driver
                .rpc_state
                .lock()
                .map_err(|error| anyhow!("structured RPC state is poisoned: {error}"))?
                .opencode
                .session_id
                .clone()
                .ok_or_else(|| anyhow!("opencode session was not initialized"))?;
            persist_agent_resume_cursor(
                &driver.db_path,
                &driver.session_id,
                AgentResumeCursor::new(StructuredProtocol::OpenCodeSse, session_id),
            )?;
            Ok(spawn_structured_sse_reader(driver.clone()))
        }
        other => bail!("unknown structured SSE protocol: {other}"),
    }
}

pub(crate) fn structured_sse_send_prompt(
    driver: &StructuredSsePromptDriver,
    prompt: &StructuredPrompt,
) -> Result<()> {
    if !prompt.images.is_empty()
        && !StructuredProtocol::parse(&driver.protocol)?
            .capabilities()
            .image_input
    {
        bail!("{} does not support image input", driver.protocol);
    }
    begin_structured_turn(&driver.rpc_state)?;
    let result = structured_sse_send_prompt_unchecked(driver, prompt);
    if result.is_err() {
        finish_structured_turn(&driver.rpc_state);
    }
    result
}

pub(crate) fn structured_sse_send_prompt_unchecked(
    driver: &StructuredSsePromptDriver,
    prompt: &StructuredPrompt,
) -> Result<()> {
    match driver.protocol.as_str() {
        "opencode-sse" => {
            let session_id = driver
                .rpc_state
                .lock()
                .map_err(|error| anyhow!("structured RPC state is poisoned: {error}"))?
                .opencode
                .session_id
                .clone()
                .ok_or_else(|| anyhow!("opencode SSE session is not initialized"))?;
            let path = format!("/session/{session_id}/prompt_async");
            let mut parts = Vec::new();
            if !prompt.text.is_empty() {
                parts.push(json!({ "type": "text", "text": prompt.text }));
            }
            for image in &prompt.images {
                parts.push(json!({
                    "type": "file",
                    "mime": image.mime_type,
                    "filename": prompt_image_file_name(image),
                    "url": format!("data:{};base64,{}", image.mime_type, encoded_prompt_image(image)?),
                }));
            }
            let mut body = json!({ "parts": parts });
            if let Some(model) = driver.model.as_deref() {
                let (provider_id, model_id) = model
                    .split_once('/')
                    .ok_or_else(|| anyhow!("opencode model must use provider/model format"))?;
                body["model"] = json!({ "providerID": provider_id, "modelID": model_id });
            }
            if let Some(variant) = driver.thinking.as_deref() {
                body["variant"] = json!(if variant == "off" { "none" } else { variant });
            }
            http_json_request(driver.port, "POST", &path, Some(&body))?;
            Ok(())
        }
        other => bail!("unknown structured SSE protocol: {other}"),
    }
}

pub(crate) fn structured_sse_cancel(
    port: u16,
    state: &Arc<Mutex<StructuredAgentRpcState>>,
) -> Result<()> {
    let session_id = {
        let mut state = state
            .lock()
            .map_err(|error| anyhow!("structured RPC state is poisoned: {error}"))?;
        if !state.turn_active {
            bail!("structured session has no active turn");
        }
        state.cancel_requested = true;
        state
            .opencode
            .session_id
            .clone()
            .ok_or_else(|| anyhow!("opencode SSE session is not initialized"))?
    };
    let path = format!("/session/{session_id}/abort");
    if let Err(error) = http_json_request(port, "POST", &path, None) {
        if let Ok(mut state) = state.lock() {
            state.cancel_requested = false;
        }
        return Err(error);
    }
    Ok(())
}

pub(crate) fn wait_for_http_health(port: u16, path: &str, timeout: Duration) -> Result<()> {
    let started = Instant::now();
    let mut last_error = String::new();
    while started.elapsed() < timeout {
        match http_json_request(port, "GET", path, None) {
            Ok(_) => return Ok(()),
            Err(error) => {
                last_error = error.to_string();
                thread::sleep(Duration::from_millis(80));
            }
        }
    }
    bail!("structured SSE server did not become ready: {last_error}")
}

pub(crate) fn http_json_request(
    port: u16,
    method: &str,
    path: &str,
    body: Option<&Value>,
) -> Result<Value> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))?;
    stream.set_read_timeout(Some(Duration::from_secs(15)))?;
    let body_text = body.map(Value::to_string).unwrap_or_default();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body_text.len(),
        body_text
    );
    stream.write_all(request.as_bytes())?;
    stream.flush()?;

    let mut reader = BufReader::new(stream);
    let (status_line, body_text) = read_http_response(&mut reader)?;
    if !status_line.contains(" 2") {
        bail!(
            "HTTP request {method} {path} failed: {status_line} {}",
            body_text.trim()
        );
    }
    let body_text = body_text.trim();
    if body_text.is_empty() {
        return Ok(Value::Null);
    }
    Ok(serde_json::from_str(body_text)?)
}

pub(crate) fn read_http_response<R: BufRead>(reader: &mut R) -> Result<(String, String)> {
    let mut status_line = String::new();
    if reader.read_line(&mut status_line)? == 0 {
        bail!("missing HTTP status line from structured server");
    }
    let status_line = status_line.trim_end_matches(['\r', '\n']).to_string();

    let mut headers = String::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            bail!("incomplete HTTP headers from structured server");
        }
        let header_line = line.trim_end_matches(['\r', '\n']);
        if header_line.is_empty() {
            break;
        }
        headers.push_str(header_line);
        headers.push('\n');
    }

    let body_text = if headers_are_chunked(&headers) {
        read_chunked_body_from_reader(reader)?
    } else if let Some(length) = http_content_length(&headers) {
        let mut body = vec![0_u8; length];
        if length > 0 {
            reader.read_exact(&mut body)?;
        }
        String::from_utf8(body)?
    } else if http_status_has_no_body(&status_line) {
        String::new()
    } else {
        let mut body = String::new();
        reader.read_to_string(&mut body)?;
        body
    };

    Ok((status_line, body_text))
}

pub(crate) fn headers_are_chunked(headers: &str) -> bool {
    headers.lines().any(|line| {
        let normalized = line.trim().to_ascii_lowercase();
        normalized.starts_with("transfer-encoding:") && normalized.contains("chunked")
    })
}

pub(crate) fn http_content_length(headers: &str) -> Option<usize> {
    headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case("content-length")
            .then(|| value.trim().parse::<usize>().ok())
            .flatten()
    })
}

pub(crate) fn http_status_has_no_body(status_line: &str) -> bool {
    status_line.contains(" 204 ") || status_line.ends_with(" 204")
}

pub(crate) fn read_chunked_body_from_reader<R: BufRead>(reader: &mut R) -> Result<String> {
    let mut output = Vec::new();
    loop {
        let mut size_line = String::new();
        if reader.read_line(&mut size_line)? == 0 {
            break;
        }
        let size_text = size_line
            .trim_end_matches(['\r', '\n'])
            .split(';')
            .next()
            .unwrap_or("")
            .trim();
        let size = usize::from_str_radix(size_text, 16)?;
        if size == 0 {
            loop {
                let mut trailer = String::new();
                if reader.read_line(&mut trailer)? == 0 {
                    break;
                }
                if trailer.trim_end_matches(['\r', '\n']).is_empty() {
                    break;
                }
            }
            break;
        }

        let mut chunk = vec![0_u8; size];
        reader.read_exact(&mut chunk)?;
        output.extend_from_slice(&chunk);

        let mut crlf = [0_u8; 2];
        reader.read_exact(&mut crlf)?;
    }
    Ok(String::from_utf8(output)?)
}

pub(crate) fn read_chunked_line<R: BufRead>(
    reader: &mut R,
    chunk_remaining: &mut usize,
    line: &mut String,
) -> std::io::Result<usize> {
    line.clear();
    loop {
        if *chunk_remaining == 0 {
            let mut size_line = String::new();
            let size_bytes = reader.read_line(&mut size_line)?;
            if size_bytes == 0 {
                return Ok(line.len());
            }
            let size_text = size_line
                .trim_end_matches(['\r', '\n'])
                .split(';')
                .next()
                .unwrap_or("")
                .trim();
            let size = usize::from_str_radix(size_text, 16).unwrap_or(0);
            if size == 0 {
                return Ok(line.len());
            }
            *chunk_remaining = size;
        }

        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return Ok(line.len());
        }
        let take_len = buffer.len().min(*chunk_remaining);
        let newline_offset = buffer[..take_len]
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|index| index + 1)
            .unwrap_or(take_len);
        let chunk = buffer[..newline_offset].to_vec();
        reader.consume(newline_offset);
        *chunk_remaining = chunk_remaining.saturating_sub(newline_offset);
        if line.len().saturating_add(chunk.len()) > MAX_STRUCTURED_LINE_BYTES + 2 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "structured protocol line exceeded the byte limit",
            ));
        }
        line.push_str(&String::from_utf8_lossy(&chunk));

        if *chunk_remaining == 0 {
            let mut trailer = [0_u8; 2];
            reader.read_exact(&mut trailer)?;
        }

        if line.ends_with('\n') {
            if line.trim_end_matches(['\r', '\n']).len() > MAX_STRUCTURED_LINE_BYTES {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "structured protocol line exceeded the byte limit",
                ));
            }
            return Ok(line.len());
        }
    }
}

pub(crate) fn spawn_structured_sse_reader(driver: StructuredSseDriver) -> JoinHandle<()> {
    thread::spawn(move || {
        let db = open_app_connection(&driver.db_path).ok();
        loop {
            if driver.cancellation.is_canceled() {
                break;
            }
            let Some((mut reader, headers)) = connect_sse_event_stream(driver.port) else {
                thread::sleep(Duration::from_millis(250));
                continue;
            };
            let mut line = String::new();
            let mut event_name: Option<String> = None;
            let mut data_lines: Vec<String> = Vec::new();
            let chunked = headers_are_chunked(&headers);
            let mut chunk_remaining = 0_usize;
            let mut pending_chunks: Vec<(u64, String, Vec<u8>)> =
                Vec::with_capacity(STRUCTURED_TRANSCRIPT_BATCH_SIZE);
            let mut last_chunk_flush = Instant::now();
            let mut last_retention_prune = Instant::now();
            loop {
                if driver.cancellation.is_canceled() {
                    break;
                }
                let line_text = if chunked {
                    line.clear();
                    match read_chunked_line(&mut reader, &mut chunk_remaining, &mut line) {
                        Ok(0) => break,
                        Ok(_) => line.trim_end_matches(['\r', '\n']).to_string(),
                        Err(error) if error.kind() == std::io::ErrorKind::InvalidData => {
                            emit_protocol_line_limit_warning(
                                &driver.session_id,
                                &driver.node_id,
                                &driver.adapter_id,
                                &driver.seq,
                                &driver.protocol_state,
                                &driver.events,
                            );
                            break;
                        }
                        Err(_) => break,
                    }
                } else {
                    match read_bounded_protocol_line(&mut reader) {
                        Ok(BoundedProtocolLine::Line(value)) => value,
                        Ok(BoundedProtocolLine::Oversized) => {
                            emit_protocol_line_limit_warning(
                                &driver.session_id,
                                &driver.node_id,
                                &driver.adapter_id,
                                &driver.seq,
                                &driver.protocol_state,
                                &driver.events,
                            );
                            event_name = None;
                            data_lines.clear();
                            continue;
                        }
                        Ok(BoundedProtocolLine::Eof) => break,
                        Err(_) => break,
                    }
                };
                if driver.cancellation.is_canceled() {
                    break;
                }
                if line_text.is_empty() {
                    if let Some(chunk) =
                        process_sse_event(&driver, db.as_ref(), event_name.take(), &data_lines)
                    {
                        if let Some(db) = db.as_ref() {
                            pending_chunks.push(chunk);
                            if pending_chunks.len() >= STRUCTURED_TRANSCRIPT_BATCH_SIZE
                                || last_chunk_flush.elapsed()
                                    >= STRUCTURED_TRANSCRIPT_FLUSH_INTERVAL
                            {
                                let enforce_retention = last_retention_prune.elapsed()
                                    >= SESSION_TRANSCRIPT_PRUNE_INTERVAL;
                                if flush_pending_session_chunks(
                                    db,
                                    &driver.session_id,
                                    &mut pending_chunks,
                                    enforce_retention,
                                )
                                .is_ok()
                                {
                                    last_chunk_flush = Instant::now();
                                    if enforce_retention {
                                        last_retention_prune = Instant::now();
                                    }
                                }
                            }
                        }
                    }
                    data_lines.clear();
                    continue;
                }
                if let Some(rest) = line_text.strip_prefix("event:") {
                    event_name = Some(rest.trim().to_string());
                } else if let Some(rest) = line_text.strip_prefix("data:") {
                    data_lines.push(rest.trim_start().to_string());
                }
            }
            if !driver.cancellation.is_canceled() {
                if let Some(chunk) =
                    process_sse_event(&driver, db.as_ref(), event_name, &data_lines)
                {
                    pending_chunks.push(chunk);
                }
            }
            if let Some(db) = db.as_ref() {
                for attempt in 0..3 {
                    if flush_pending_session_chunks(
                        db,
                        &driver.session_id,
                        &mut pending_chunks,
                        true,
                    )
                    .is_ok()
                        || pending_chunks.is_empty()
                    {
                        break;
                    }
                    if attempt < 2 {
                        thread::sleep(Duration::from_millis(25));
                    }
                }
            }
            emit_structured_protocol_events(
                &driver.session_id,
                &driver.node_id,
                &driver.adapter_id,
                driver.seq.load(Ordering::SeqCst),
                Vec::new(),
                &driver.protocol_state,
                &driver.events,
                true,
            );
            if !driver.cancellation.is_canceled() {
                thread::sleep(Duration::from_millis(100));
            }
        }
    })
}

pub(crate) fn connect_sse_event_stream(port: u16) -> Option<(BufReader<TcpStream>, String)> {
    ["/global/event", "/event"]
        .iter()
        .find_map(|path| connect_sse_event_stream_at(port, path).ok())
}

pub(crate) fn connect_sse_event_stream_at(
    port: u16,
    path: &str,
) -> Result<(BufReader<TcpStream>, String)> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))?;
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: text/event-stream\r\nConnection: close\r\n\r\n",
    );
    stream.write_all(request.as_bytes())?;
    stream.flush()?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    if reader.read_line(&mut line)? == 0 {
        bail!("missing SSE status line from structured server");
    }
    if !line.contains(" 2") {
        bail!("SSE request {path} failed: {}", line.trim());
    }

    let mut headers = line;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 {
            bail!("incomplete SSE headers from structured server");
        }
        let header_line = header.trim_end_matches(['\r', '\n']);
        if header_line.is_empty() {
            break;
        }
        headers.push_str(&header);
    }

    Ok((reader, headers))
}

#[cfg(test)]
pub(crate) fn dispatch_sse_event(
    driver: &StructuredSseDriver,
    db: Option<&Connection>,
    event_name: Option<String>,
    data_lines: &[String],
) {
    let Some((seq, stream, data)) = process_sse_event(driver, db, event_name, data_lines) else {
        return;
    };
    if let Some(connection) = db {
        let _ = persist_session_stream_chunk(connection, &driver.session_id, seq, &stream, &data);
    }
}

fn process_sse_event(
    driver: &StructuredSseDriver,
    db: Option<&Connection>,
    event_name: Option<String>,
    data_lines: &[String],
) -> Option<(u64, String, Vec<u8>)> {
    if data_lines.is_empty() || driver.cancellation.is_canceled() {
        return None;
    }
    let data = data_lines.join("\n");
    let mut value = serde_json::from_str::<Value>(&data).unwrap_or_else(|_| {
        json!({
            "event": event_name.as_deref().unwrap_or("message"),
            "text": data,
        })
    });

    if let Value::Object(ref mut object) = value {
        if !object.contains_key("event")
            && !object.contains_key("type")
            && !object.contains_key("method")
        {
            if let Some(name) = event_name.as_ref() {
                object.insert("event".to_string(), json!(name));
            }
        }
    }

    if json_string_at(&value, &["type"]).as_deref() == Some("server.connected") {
        return None;
    }
    let current_session_id = driver
        .rpc_state
        .lock()
        .ok()
        .and_then(|state| state.opencode.session_id.clone());
    if let (Some(current), Some(event_session)) = (
        current_session_id.as_ref(),
        opencode_event_session_id(&value),
    ) {
        if event_session != *current {
            return None;
        }
    }

    let line_text = match serde_json::to_string(&value) {
        Ok(value) => value,
        Err(_) => return None,
    };
    if contains_coordination_prompt_text(&line_text) {
        return None;
    }
    let event_name = normalized_protocol_event_name(&value);
    if event_name == "session idle" || event_name == "step finish" {
        finish_structured_turn(&driver.rpc_state);
    }
    if opencode_interaction_is_pending(&event_name) {
        if let (Some(request_id), Ok(mut state)) =
            (opencode_interaction_id(&value), driver.rpc_state.lock())
        {
            if let Some(index) = state
                .opencode
                .pending_interactions
                .iter()
                .position(|pending| {
                    opencode_interaction_id(pending).as_deref() == Some(&request_id)
                })
            {
                state.opencode.pending_interactions[index] = value.clone();
            } else {
                state.opencode.pending_interactions.push(value.clone());
            }
        }
    } else if opencode_interaction_is_resolved(&event_name) {
        if let (Some(request_id), Ok(mut state)) =
            (opencode_interaction_id(&value), driver.rpc_state.lock())
        {
            state
                .opencode
                .pending_interactions
                .retain(|pending| opencode_interaction_id(pending).as_deref() != Some(&request_id));
        }
    }
    let next_seq = driver.seq.fetch_add(1, Ordering::SeqCst) + 1;

    driver.events.emit(
        "agent:structured-line",
        &json!(StructuredAgentLineEvent {
            session_id: driver.session_id.clone(),
            node_id: driver.node_id.clone(),
            adapter_id: driver.adapter_id.clone(),
            seq: next_seq,
            stream: "sse".to_string(),
            line_base64: general_purpose::STANDARD.encode(line_text.as_bytes()),
            runtime_instance_id: driver.session_id.clone(),
        }),
    );
    let protocol_events = parse_agent_protocol_line(
        &driver.adapter_id,
        Some(&driver.protocol),
        &line_text,
        usize::try_from(next_seq).unwrap_or(usize::MAX),
    );
    if let Some(db) = db {
        match ingest_agent_usage_line(
            db,
            &driver.session_id,
            &driver.adapter_id,
            &driver.protocol,
            &line_text,
            next_seq,
        ) {
            Ok(true) => driver.events.emit(
                "usage:updated",
                &json!({
                    "sessionId": driver.session_id,
                    "adapterId": driver.adapter_id,
                }),
            ),
            Ok(false) => {}
            Err(error) => driver.events.emit(
                "usage:error",
                &json!({
                    "sessionId": driver.session_id,
                    "adapterId": driver.adapter_id,
                    "message": error.to_string(),
                }),
            ),
        }
    }
    emit_structured_protocol_events(
        &driver.session_id,
        &driver.node_id,
        &driver.adapter_id,
        next_seq,
        protocol_events,
        &driver.protocol_state,
        &driver.events,
        false,
    );
    Some((
        next_seq,
        "agent-sse".to_string(),
        format!("{line_text}\n").into_bytes(),
    ))
}

pub(crate) fn structured_sse_respond(
    port: u16,
    state: &Arc<Mutex<StructuredAgentRpcState>>,
    interaction_id: Option<&str>,
    response: &str,
    approved: bool,
) -> Result<()> {
    let interaction_id =
        interaction_id.ok_or_else(|| anyhow!("OpenCode responses require an interaction id"))?;
    let (pending_index, pending, request_id) = {
        let mut state = state.lock().map_err(|error| anyhow!(error.to_string()))?;
        let index = state
            .opencode
            .pending_interactions
            .iter()
            .rposition(|pending| {
                opencode_interaction_id(pending).as_deref() == Some(interaction_id)
            })
            .ok_or_else(|| anyhow!("unknown OpenCode interaction: {interaction_id}"))?;
        let request_id = opencode_interaction_id(&state.opencode.pending_interactions[index])
            .ok_or_else(|| anyhow!("OpenCode interaction is missing a request id"))?;
        (
            index,
            state.opencode.pending_interactions.remove(index),
            request_id,
        )
    };
    let event_name = normalized_protocol_event_name(&pending);
    let (path, body) = if opencode_event_is_question(&event_name) {
        if approved {
            (
                format!("/question/{request_id}/reply"),
                json!({ "answers": opencode_question_answers(&pending, response) }),
            )
        } else {
            (format!("/question/{request_id}/reject"), json!({}))
        }
    } else {
        (
            format!("/permission/{request_id}/reply"),
            json!({ "reply": if approved { "once" } else { "reject" } }),
        )
    };
    if let Err(error) = http_json_request(port, "POST", &path, Some(&body)) {
        if let Ok(mut state) = state.lock() {
            let index = pending_index.min(state.opencode.pending_interactions.len());
            state.opencode.pending_interactions.insert(index, pending);
        }
        return Err(error);
    }
    Ok(())
}

pub(crate) fn opencode_event_session_id(value: &Value) -> Option<String> {
    json_string_at(value, &["properties", "sessionID"])
        .or_else(|| json_string_at(value, &["properties", "part", "sessionID"]))
        .or_else(|| json_string_at(value, &["properties", "info", "sessionID"]))
        .or_else(|| json_string_at(value, &["payload", "properties", "sessionID"]))
        .or_else(|| json_string_at(value, &["payload", "properties", "part", "sessionID"]))
        .or_else(|| json_string_at(value, &["payload", "properties", "info", "sessionID"]))
}

fn opencode_interaction_id(value: &Value) -> Option<String> {
    json_string_at(value, &["properties", "id"])
        .or_else(|| json_string_at(value, &["properties", "requestID"]))
        .or_else(|| json_string_at(value, &["properties", "permission", "id"]))
        .or_else(|| json_string_at(value, &["payload", "properties", "id"]))
        .or_else(|| json_string_at(value, &["payload", "properties", "requestID"]))
        .or_else(|| json_string_at(value, &["payload", "properties", "permission", "id"]))
}

fn opencode_event_is_question(event_name: &str) -> bool {
    event_name == "question asked"
        || event_name == "question v2 asked"
        || event_name == "question replied"
        || event_name == "question rejected"
        || event_name == "question v2 replied"
        || event_name == "question v2 rejected"
}

fn opencode_interaction_is_pending(event_name: &str) -> bool {
    event_name == "permission asked"
        || event_name == "permission updated"
        || event_name == "question asked"
        || event_name == "question v2 asked"
}

fn opencode_interaction_is_resolved(event_name: &str) -> bool {
    event_name == "permission replied"
        || event_name == "question replied"
        || event_name == "question rejected"
        || event_name == "question v2 replied"
        || event_name == "question v2 rejected"
}

fn opencode_question_answers(pending: &Value, response: &str) -> Vec<Vec<String>> {
    let questions = json_value_at(pending, &["properties", "questions"])
        .or_else(|| json_value_at(pending, &["payload", "properties", "questions"]))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let answer = vec![response.trim().to_string()];
    if questions.is_empty() {
        vec![answer]
    } else {
        questions.iter().map(|_| answer.clone()).collect()
    }
}

fn json_value_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

pub(crate) fn normalized_protocol_event_name(value: &Value) -> String {
    [
        json_string_at(value, &["type"]),
        json_string_at(value, &["event"]),
        json_string_at(value, &["name"]),
        json_string_at(value, &["params", "type"]),
        json_string_at(value, &["params", "event"]),
        json_string_at(value, &["params", "method"]),
        json_string_at(value, &["params", "update", "sessionUpdate"]),
        json_string_at(value, &["params", "update", "session_update"]),
        json_string_at(value, &["params", "update", "type"]),
        json_string_at(value, &["params", "update", "event"]),
        json_string_at(value, &["result", "stopReason"]),
        json_string_at(value, &["result", "stop_reason"]),
        json_string_at(value, &["payload", "event"]),
        json_string_at(value, &["payload", "type"]),
        json_string_at(value, &["payload", "properties", "part", "type"]),
        json_string_at(value, &["method"]),
    ]
    .into_iter()
    .flatten()
    .next()
    .unwrap_or_default()
    .chars()
    .map(|character| {
        if matches!(character, '/' | '_' | '.' | ':' | '-') {
            ' '
        } else {
            character
        }
    })
    .collect::<String>()
    .to_ascii_lowercase()
}

pub(crate) fn structured_write_json(stdin: &Arc<Mutex<ChildStdin>>, value: &Value) -> Result<()> {
    let mut stdin = stdin.lock().map_err(|error| anyhow!(error.to_string()))?;
    stdin.write_all(value.to_string().as_bytes())?;
    stdin.write_all(b"\n")?;
    stdin.flush()?;
    Ok(())
}

pub(crate) fn structured_write_prompt(stdin: &Arc<Mutex<ChildStdin>>, prompt: &str) -> Result<()> {
    let mut stdin = stdin.lock().map_err(|error| anyhow!(error.to_string()))?;
    stdin.write_all(format!("{prompt}\n").as_bytes())?;
    stdin.flush()?;
    Ok(())
}

pub(crate) fn emit_terminal_frame(events: &dyn EventSink, frame: TerminalFrame) {
    if let Ok(payload) = serde_json::to_value(frame) {
        events.emit("terminal:frame", &payload);
    }
}

pub(crate) fn terminal_metrics_enabled() -> bool {
    #[cfg(test)]
    if TERMINAL_METRICS_TEST_OVERRIDE.load(Ordering::SeqCst) {
        return true;
    }

    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| {
        env::var("WHEELJACK_TERMINAL_METRICS")
            .or_else(|_| env::var("TXTL_TERMINAL_METRICS"))
            .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false)
    })
}

#[cfg(test)]
static TERMINAL_METRICS_TEST_OVERRIDE: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
pub(crate) fn set_terminal_metrics_enabled_for_test(enabled: bool) {
    TERMINAL_METRICS_TEST_OVERRIDE.store(enabled, Ordering::SeqCst);
}

pub(crate) fn persist_session_stream_chunk(
    db: &Connection,
    session_id: &str,
    seq: u64,
    stream: &str,
    data: &[u8],
) -> rusqlite::Result<()> {
    persist_session_stream_chunk_with_retention(db, session_id, seq, stream, data, true)
}

fn persist_session_stream_chunk_with_retention(
    db: &Connection,
    session_id: &str,
    seq: u64,
    stream: &str,
    data: &[u8],
    enforce_retention: bool,
) -> rusqlite::Result<()> {
    persist_session_stream_chunks_with_retention(
        db,
        session_id,
        &[(seq, stream, data)],
        enforce_retention,
    )
}

#[cfg(test)]
pub(crate) fn persist_session_stream_chunks(
    db: &Connection,
    session_id: &str,
    chunks: &[(u64, &str, &[u8])],
) -> rusqlite::Result<()> {
    persist_session_stream_chunks_with_retention(db, session_id, chunks, true)
}

pub(crate) fn persist_session_stream_chunks_with_retention(
    db: &Connection,
    session_id: &str,
    chunks: &[(u64, &str, &[u8])],
    enforce_retention: bool,
) -> rusqlite::Result<()> {
    if chunks.is_empty() {
        if enforce_retention {
            prune_session_chunks_to_retention(db, session_id)?;
        }
        return Ok(());
    }
    let tx = Transaction::new_unchecked(db, TransactionBehavior::Immediate)?;
    let session_exists = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?1)",
        params![session_id],
        |row| row.get::<_, bool>(0),
    )?;
    if !session_exists {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    {
        let mut insert_chunk = tx.prepare_cached(
            "INSERT INTO session_chunks (session_id, seq, stream, data, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        let mut insert_search = tx.prepare_cached(
            "INSERT OR REPLACE INTO session_chunks_fts(rowid, session_id, data)
             VALUES (?1, ?2, ?3)",
        )?;
        for (seq, stream, data) in chunks {
            insert_chunk.execute(params![session_id, *seq as i64, stream, data, now()])?;
            insert_search.execute(params![
                tx.last_insert_rowid(),
                session_id,
                String::from_utf8_lossy(data).as_ref()
            ])?;
        }
    }
    if enforce_retention {
        prune_session_chunks_to_retention(&tx, session_id)?;
    }
    tx.commit()
}

pub(crate) fn load_agent_resume_cursor(
    db: &Connection,
    session_id: &str,
    protocol: StructuredProtocol,
) -> Result<AgentResumeCursor> {
    let command_json = db
        .query_row(
            "SELECT command_json FROM sessions WHERE id = ?1",
            params![session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| anyhow!("resume session does not exist: {session_id}"))?;
    let command = serde_json::from_str::<Value>(&command_json)
        .context("resume session launch metadata is invalid")?;
    let cursor = command
        .get("resumeCursor")
        .filter(|value| !value.is_null())
        .cloned()
        .ok_or_else(|| anyhow!("session has no provider-native resume cursor: {session_id}"))?;
    let cursor =
        serde_json::from_value::<AgentResumeCursor>(cursor).context("resume cursor is invalid")?;
    if cursor.version != AGENT_RESUME_CURSOR_VERSION {
        bail!("resume cursor version {} is unsupported", cursor.version);
    }
    if cursor.driver != protocol.driver_id() {
        bail!(
            "resume cursor belongs to {}, not {}",
            cursor.driver,
            protocol.driver_id()
        );
    }
    Ok(cursor)
}

fn persist_agent_resume_cursor(
    db_path: &Path,
    session_id: &str,
    cursor: AgentResumeCursor,
) -> Result<()> {
    let db = open_app_connection(db_path)?;
    let command_json = db
        .query_row(
            "SELECT command_json FROM sessions WHERE id = ?1",
            params![session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| anyhow!("structured session disappeared: {session_id}"))?;
    let mut command = serde_json::from_str::<Value>(&command_json)
        .context("structured session launch metadata is invalid")?;
    command["resumeCursor"] = serde_json::to_value(cursor)?;
    db.execute(
        "UPDATE sessions SET command_json = ?1, updated_at = ?2 WHERE id = ?3",
        params![command.to_string(), now(), session_id],
    )?;
    Ok(())
}

pub(crate) fn prune_session_chunks_to_retention(
    db: &Connection,
    session_id: &str,
) -> rusqlite::Result<usize> {
    let max_bytes = session_transcript_retention_bytes(db)?;
    db.execute(
        "DELETE FROM session_chunks_fts
         WHERE rowid IN (
           SELECT id FROM (
             SELECT
               id,
               SUM(length(data)) OVER (
                 ORDER BY seq DESC, id DESC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS retained_bytes
             FROM session_chunks
             WHERE session_id = ?1
           )
           WHERE retained_bytes > ?2
         )",
        params![session_id, max_bytes],
    )?;
    db.execute(
        "DELETE FROM session_chunks
         WHERE id IN (
           SELECT id FROM (
             SELECT
               id,
               SUM(length(data)) OVER (
                 ORDER BY seq DESC, id DESC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS retained_bytes
             FROM session_chunks
             WHERE session_id = ?1
           )
           WHERE retained_bytes > ?2
         )",
        params![session_id, max_bytes],
    )
}

pub(crate) fn prune_all_session_chunks_to_retention(db: &Connection) -> rusqlite::Result<usize> {
    let mut stmt = db.prepare("SELECT DISTINCT session_id FROM session_chunks")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let session_ids = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);
    let mut pruned = 0;
    for session_id in session_ids {
        pruned += prune_session_chunks_to_retention(db, &session_id)?;
    }
    Ok(pruned)
}

pub(crate) fn prune_global_session_chunks_to_retention(db: &Connection) -> rusqlite::Result<usize> {
    let max_bytes = global_session_transcript_retention_bytes(db)?;
    db.execute(
        "DELETE FROM session_chunks_fts
         WHERE rowid IN (
           SELECT id FROM (
             SELECT
               id,
               SUM(length(data)) OVER (
                 ORDER BY created_at DESC, id DESC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS retained_bytes
             FROM session_chunks
           )
           WHERE retained_bytes > ?1
         )",
        params![max_bytes],
    )?;
    db.execute(
        "DELETE FROM session_chunks
         WHERE id IN (
           SELECT id FROM (
             SELECT
               id,
               SUM(length(data)) OVER (
                 ORDER BY created_at DESC, id DESC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS retained_bytes
             FROM session_chunks
           )
           WHERE retained_bytes > ?1
         )",
        params![max_bytes],
    )
}

fn session_transcript_retention_bytes(db: &Connection) -> rusqlite::Result<i64> {
    let value_json = db
        .query_row(
            "SELECT value_json FROM settings WHERE key = 'sessionTranscriptRetentionBytes'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let value = value_json
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
                .or_else(|| value.as_f64().map(|number| number as i64))
        })
        .unwrap_or(DEFAULT_SESSION_TRANSCRIPT_RETENTION_BYTES);
    Ok(value.clamp(1_048_576, MAX_SESSION_TRANSCRIPT_RETENTION_BYTES))
}

fn global_session_transcript_retention_bytes(db: &Connection) -> rusqlite::Result<i64> {
    let value_json = db
        .query_row(
            "SELECT value_json FROM settings WHERE key = 'sessionTranscriptGlobalRetentionBytes'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let value = value_json
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
                .or_else(|| value.as_f64().map(|number| number as i64))
        })
        .unwrap_or(DEFAULT_GLOBAL_SESSION_TRANSCRIPT_RETENTION_BYTES);
    Ok(value.clamp(1_048_576, MAX_GLOBAL_SESSION_TRANSCRIPT_RETENTION_BYTES))
}

fn persist_session_exit(
    db_path: &Path,
    session_id: &str,
    exit_code: Option<i32>,
    incomplete_turn: bool,
    termination_reason: Option<StructuredTerminationReason>,
) {
    for attempt in 0..3 {
        let result: Result<()> = (|| {
            let db = open_app_connection(db_path)?;
            mark_session_exited_with_turn_state_retry(
                &db,
                session_id,
                exit_code,
                incomplete_turn,
                termination_reason,
            )?;
            Ok(())
        })();
        if result.is_ok() {
            return;
        }
        if attempt < 2 {
            thread::sleep(Duration::from_millis(50));
        }
    }
}

#[cfg(test)]
pub(crate) fn mark_session_exited(
    db: &Connection,
    session_id: &str,
    exit_code: Option<i32>,
) -> rusqlite::Result<()> {
    mark_session_exited_with_turn_state_retry(db, session_id, exit_code, false, None)
}

pub(crate) fn mark_session_exited_with_turn_state_retry(
    db: &Connection,
    session_id: &str,
    exit_code: Option<i32>,
    incomplete_turn: bool,
    termination_reason: Option<StructuredTerminationReason>,
) -> rusqlite::Result<()> {
    let mut attempt = 0;
    loop {
        match mark_session_exited_with_turn_state(
            db,
            session_id,
            exit_code,
            incomplete_turn,
            termination_reason,
        ) {
            Err(error)
                if error.sqlite_error_code().is_some_and(|code| {
                    matches!(
                        code,
                        rusqlite::ffi::ErrorCode::DatabaseBusy
                            | rusqlite::ffi::ErrorCode::DatabaseLocked
                    )
                }) && attempt < SESSION_EXIT_BUSY_RETRY_DELAYS.len() =>
            {
                thread::sleep(SESSION_EXIT_BUSY_RETRY_DELAYS[attempt]);
                attempt += 1;
            }
            result => return result,
        }
    }
}

fn mark_session_exited_with_turn_state(
    db: &Connection,
    session_id: &str,
    exit_code: Option<i32>,
    incomplete_turn: bool,
    termination_reason: Option<StructuredTerminationReason>,
) -> rusqlite::Result<()> {
    let raw_exit = exit_code
        .map(|code| code.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let (status, message, marker) = match termination_reason {
        Some(StructuredTerminationReason::Completed) => (
            "completed",
            "Agent session completed and closed.",
            format!("agent -> completed session closed ({raw_exit})"),
        ),
        Some(StructuredTerminationReason::Canceled) => (
            "canceled",
            "Agent session canceled and closed.",
            format!("agent -> canceled session closed ({raw_exit})"),
        ),
        Some(StructuredTerminationReason::Shutdown) => (
            "disconnected",
            "Agent session disconnected when wheeljack closed.",
            format!("agent -> session closed with wheeljack ({raw_exit})"),
        ),
        None if incomplete_turn => (
            "failed",
            "Agent process exited before a terminal turn result.",
            "agent -> process exited before terminal result".to_string(),
        ),
        None => match exit_code {
            Some(0) => (
                "completed",
                "Session completed.",
                "pty -> process exited (0)".to_string(),
            ),
            Some(code) => (
                "failed",
                "Session failed.",
                format!("pty -> process exited ({code})"),
            ),
            None => (
                "disconnected",
                "Session disconnected.",
                "pty -> process disconnected".to_string(),
            ),
        },
    };
    let tx = db.unchecked_transaction()?;
    let session = tx
        .query_row(
            "SELECT node_id, status FROM sessions WHERE id = ?1",
            params![session_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((node_id, current_status)) = session else {
        return Ok(());
    };
    if current_status != "running" {
        return Ok(());
    }

    let timestamp = now();
    tx.execute(
        "UPDATE sessions
         SET status = ?1, ended_at = ?2, exit_code = ?3, updated_at = ?2
         WHERE id = ?4",
        params![status, timestamp, exit_code, session_id],
    )?;

    let node = tx
        .query_row(
            "SELECT data_json FROM nodes
             WHERE id = ?1 AND kind IN ('agent_terminal', 'shell_terminal')",
            params![node_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(data_json) = node {
        let mut data = serde_json::from_str::<Value>(&data_json)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        if data.get("sessionId").and_then(Value::as_str) == Some(session_id) {
            if let Some(object) = data.as_object_mut() {
                object.insert("status".to_string(), json!(status));
                object.insert("lastSessionId".to_string(), json!(session_id));
                object.remove("sessionId");
            }
            append_terminal_transcript_marker(&mut data, marker);
            tx.execute(
                "UPDATE nodes SET data_json = ?1, updated_at = ?2 WHERE id = ?3",
                params![data.to_string(), timestamp, node_id],
            )?;
        }
    }

    append_session_event(
        &tx,
        session_id,
        "lifecycle",
        status,
        message,
        &json!({
            "exitCode": exit_code,
            "incompleteTurn": incomplete_turn,
            "terminationReason": termination_reason,
        }),
    )?;
    tx.commit()
}

pub(crate) fn resolve_spawn_command(
    db: &Connection,
    request: &SpawnSessionRequest,
) -> Result<ResolvedPtyCommand> {
    let command = request
        .command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let shell_command = request
        .shell_command
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    if command.is_some() && shell_command.is_some() {
        bail!("pty_spawn accepts either command or shellCommand, not both");
    }
    if request.shell_command.is_some() && shell_command.is_none() {
        bail!("pty_spawn shellCommand cannot be empty");
    }
    if let Some(shell_command) = shell_command {
        #[cfg(windows)]
        let command = env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        #[cfg(windows)]
        let (args, command_env) = {
            let command_variable = format!("WJ_SHELL_{}", Uuid::now_v7().as_simple());
            let powershell_variable = format!("WJ_POWERSHELL_{}", Uuid::now_v7().as_simple());
            let powershell = windows_system32_executable(r"WindowsPowerShell\v1.0\powershell.exe");
            let wrapper = format!(
                r#"$ProgressPreference = 'SilentlyContinue'
$command = [Environment]::GetEnvironmentVariable('{command_variable}')
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $env:COMSPEC
$start.UseShellExecute = $false
$start.Arguments = '/d /s /c "' + $command + '"'
[void]$start.EnvironmentVariables.Remove('{command_variable}')
[void]$start.EnvironmentVariables.Remove('{powershell_variable}')
$process = [Diagnostics.Process]::Start($start)
$process.WaitForExit()
exit $process.ExitCode
"#
            );
            let encoded_wrapper = general_purpose::STANDARD.encode(
                wrapper
                    .encode_utf16()
                    .flat_map(u16::to_le_bytes)
                    .collect::<Vec<_>>(),
            );
            (
                vec![
                    "/d".to_string(),
                    "/s".to_string(),
                    "/c".to_string(),
                    format!(
                        "%{powershell_variable}% -NoLogo -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand {encoded_wrapper}"
                    ),
                ],
                vec![
                    (command_variable, shell_command.to_string()),
                    (powershell_variable, format!("\"{}\"", powershell.display())),
                ],
            )
        };
        #[cfg(not(windows))]
        let command = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        #[cfg(not(windows))]
        let args = vec!["-lc".to_string(), shell_command.to_string()];
        #[cfg(not(windows))]
        let command_env = Vec::new();
        return Ok(ResolvedPtyCommand {
            command,
            args,
            source: "shell_command",
            env: command_env,
        });
    }
    if let Some(command) = command {
        let mut parts = split_launch_command(command)?;
        let command = parts.remove(0);
        parts.extend(request.args.iter().cloned());
        let (command, args) = resolve_command(&command, &parts);
        return Ok(ResolvedPtyCommand {
            command,
            args,
            source: "spawn_request",
            env: Vec::new(),
        });
    }
    if let Some(adapter_id) = request
        .adapter_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let (command, args) = resolve_adapter_launch(db, adapter_id)?;
        let (command, args) = resolve_command(&command, &args);
        return Ok(ResolvedPtyCommand {
            command,
            args,
            source: "adapter_manifest",
            env: Vec::new(),
        });
    }
    let (command, args) = default_shell_command();
    Ok(ResolvedPtyCommand {
        command,
        args,
        source: "default_shell",
        env: Vec::new(),
    })
}
