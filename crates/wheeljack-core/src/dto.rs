use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default = "default_project_icon")]
    pub icon: String,
    #[serde(default = "default_project_icon_color")]
    pub icon_color: String,
    #[serde(default = "default_project_agent_access")]
    pub agent_access: String,
    pub branch: String,
    pub dirty: bool,
    #[serde(default)]
    pub github_remote: bool,
    #[serde(default)]
    pub path_exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotLaunchDto {
    pub adapter_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotProfileDto {
    pub id: String,
    pub scope: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub name: String,
    pub role_description: String,
    pub avatar_seed: String,
    pub launch: BotLaunchDto,
    pub launch_count: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotProfileInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub scope: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub name: String,
    pub role_description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_seed: Option<String>,
    pub launch: BotLaunchDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotUpsertRequest {
    pub bot: BotProfileInput,
    #[serde(default)]
    pub record_launch: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileCatalogDto {
    pub files: Vec<String>,
    #[serde(default)]
    pub wheeljack_documents: Vec<String>,
    pub truncated: bool,
}

fn default_project_icon() -> String {
    "folder".to_string()
}

fn default_project_icon_color() -> String {
    "#7E7E7E".to_string()
}

fn default_project_agent_access() -> String {
    "default".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanColumnDto {
    pub id: String,
    pub title: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanCardDto {
    pub id: String,
    pub column_id: String,
    pub title: String,
    #[serde(default)]
    pub detail: String,
    #[serde(default = "default_unassigned")]
    pub assignee: String,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(default)]
    pub definition_of_done: String,
    #[serde(default)]
    pub constraints: String,
    #[serde(default)]
    pub verification_command: String,
    #[serde(default = "default_review_policy")]
    pub review_policy: String,
}

fn default_unassigned() -> String {
    "Unassigned".to_string()
}

fn default_priority() -> String {
    "normal".to_string()
}

fn default_review_policy() -> String {
    "agent".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanBoardDto {
    pub version: u32,
    pub columns: Vec<KanbanColumnDto>,
    pub cards: Vec<KanbanCardDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDocumentDto {
    pub kind: String,
    pub path: String,
    pub exists: bool,
    pub content: String,
    pub revision: String,
    pub format: String,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board: Option<KanbanBoardDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDocumentsDto {
    pub project_path: String,
    pub documents: BTreeMap<String, ProjectDocumentDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDocumentWriteDto {
    pub kind: String,
    pub content: String,
    pub expected_revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDocumentsWriteRequest {
    pub project_path: String,
    pub writes: Vec<ProjectDocumentWriteDto>,
    #[serde(default)]
    pub confirmation_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDocumentsWritePreviewDto {
    pub preview_id: String,
    pub confirmation_token: String,
    pub diff: String,
    pub writes: Vec<ProjectDocumentWriteDto>,
    pub requires_confirmation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraDto {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CanvasCameraStore {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) scale: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) grid_x: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) grid_y: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) selected_node_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) focused_node_id: Option<String>,
}

impl From<&CameraDto> for CanvasCameraStore {
    fn from(camera: &CameraDto) -> Self {
        Self {
            x: camera.x,
            y: camera.y,
            scale: camera.scale,
            grid_x: None,
            grid_y: None,
            selected_node_ids: Vec::new(),
            focused_node_id: None,
        }
    }
}

impl CanvasCameraStore {
    pub(crate) fn camera(&self) -> CameraDto {
        CameraDto {
            x: self.x,
            y: self.y,
            scale: self.scale,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasNodeDto {
    pub id: String,
    pub canvas_id: String,
    pub kind: String,
    pub title: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub z_index: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col_span: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_span: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub single_pane_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub single_pane_height: Option<f64>,
    pub data: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasEdgeDto {
    pub id: String,
    pub source_node_id: String,
    pub target_node_id: String,
    pub kind: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasDto {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub theme_id: String,
    pub camera: CameraDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grid_x: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grid_y: Option<i64>,
    #[serde(default)]
    pub selected_node_ids: Vec<String>,
    pub focused_node_id: Option<String>,
    pub nodes: Vec<CanvasNodeDto>,
    pub edges: Vec<CanvasEdgeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasPatchDto {
    pub project: Option<ProjectDto>,
    pub theme_id: Option<String>,
    pub camera: Option<CameraDto>,
    pub selected_node_ids: Option<Vec<String>>,
    pub focused_node_id: Option<Value>,
    pub nodes: Option<Vec<CanvasNodeDto>>,
    pub edges: Option<Vec<CanvasEdgeDto>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CanvasSplitAxisDto {
    Columns,
    Rows,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CanvasLayoutModeDto {
    Auto,
    #[default]
    Manual,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub(crate) enum CanvasSplitNodeDto {
    #[serde(rename = "leaf")]
    Leaf {
        #[serde(rename = "paneId")]
        pane_id: String,
    },
    #[serde(rename = "split")]
    Split {
        axis: CanvasSplitAxisDto,
        ratio: f64,
        first: Box<CanvasSplitNodeDto>,
        second: Box<CanvasSplitNodeDto>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CanvasLayoutDocumentDto {
    pub(crate) version: u32,
    #[serde(default)]
    pub(crate) mode: CanvasLayoutModeDto,
    pub(crate) root: Option<CanvasSplitNodeDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CanvasLayoutDto {
    pub(crate) canvas_id: String,
    pub(crate) surface: String,
    pub(crate) version: u32,
    pub(crate) mode: CanvasLayoutModeDto,
    pub(crate) root: Option<CanvasSplitNodeDto>,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinationChecklistPlanRequest {
    pub nodes: Vec<CanvasNodeDto>,
    pub canvas_id: String,
    pub workspace_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinationChecklistPlanResponse {
    pub nodes: Vec<CanvasNodeDto>,
    pub created_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentParseRequest {
    pub transcript: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedIntentDto {
    pub id: String,
    pub source: String,
    pub transcript: String,
    pub confidence: f64,
    pub risk: String,
    pub requires_confirmation: bool,
    pub explanation: String,
    pub actions: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentExecuteRequest {
    pub intent: ParsedIntentDto,
    pub approved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentResultDto {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorAssignmentDto {
    pub target: String,
    pub task: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorRouteRequest {
    pub transcript: String,
    #[serde(default)]
    pub assignments: Vec<OrchestratorAssignmentDto>,
    pub canvas_id: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    pub approved: bool,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorRouteDto {
    pub target: String,
    pub task: String,
    pub task_id: Option<String>,
    pub node_id: Option<String>,
    pub node_title: Option<String>,
    pub session_id: Option<String>,
    pub adapter_id: Option<String>,
    pub status: String,
    pub prompt: String,
    pub recent_context: String,
    pub delivered: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorRouteResultDto {
    pub ok: bool,
    pub requires_confirmation: bool,
    pub message: String,
    pub routes: Vec<OrchestratorRouteDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RouteRequest {
    pub(crate) workspace_id: String,
    #[serde(default)]
    pub(crate) recipient_ids: Vec<String>,
    #[serde(default)]
    pub(crate) message: String,
    #[serde(default)]
    pub(crate) assignments: Vec<OrchestratorAssignmentDto>,
    #[serde(default)]
    pub(crate) task_id: Option<String>,
    #[serde(default)]
    pub(crate) confirmation_token: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RouteTargetPreviewDto {
    pub(crate) task_id: Option<String>,
    pub(crate) task: String,
    pub(crate) node_id: String,
    pub(crate) title: String,
    pub(crate) adapter_id: String,
    pub(crate) session_id: Option<String>,
    pub(crate) ready: bool,
    pub(crate) writes: Vec<String>,
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RouteTargetResultDto {
    pub(crate) task_id: Option<String>,
    pub(crate) task: String,
    pub(crate) node_id: String,
    pub(crate) title: String,
    pub(crate) delivered: bool,
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RoutePreviewDto {
    pub(crate) preview_id: String,
    pub(crate) confirmation_token: String,
    pub(crate) message: String,
    pub(crate) risk: String,
    pub(crate) recipients: Vec<String>,
    pub(crate) writes: Vec<String>,
    pub(crate) targets: Vec<RouteTargetPreviewDto>,
    pub(crate) requires_confirmation: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RouteExecuteDto {
    pub(crate) ok: bool,
    pub(crate) message: String,
    pub(crate) delivered_count: usize,
    pub(crate) targets: Vec<RouteTargetResultDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionEventAppendRequest {
    pub(crate) session_id: String,
    pub(crate) kind: String,
    pub(crate) status: String,
    #[serde(default)]
    pub(crate) message: String,
    #[serde(default)]
    pub(crate) payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterDto {
    pub id: String,
    pub display_name: String,
    pub icon: String,
    pub executables: Vec<String>,
    pub supported_platforms: Vec<String>,
    #[serde(default)]
    pub supported_approval_policies: Vec<String>,
    pub launch_command: String,
    pub prompt_injection: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presentation: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub streaming: Option<Value>,
    pub status: String,
    pub setup_hint: String,
    #[serde(default = "default_adapter_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub supports_structured: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdapterLaunchConfig {
    #[serde(default)]
    pub(crate) model: Option<String>,
    #[serde(default)]
    pub(crate) thinking: Option<String>,
    #[serde(default)]
    pub(crate) approval_policy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdapterProbeDto {
    pub adapter_id: String,
    pub executable_path: Option<String>,
    pub version: Option<String>,
    pub auth_status: String,
    pub protocol: Option<String>,
    pub verification_status: String,
    pub docs_url: Option<String>,
    pub repair_command: Option<String>,
    pub message: String,
    pub checked_at: String,
    #[serde(default)]
    pub verified_args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_fingerprint: Option<String>,
}

fn default_adapter_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHistoryItemDto {
    pub id: String,
    pub node_id: String,
    pub node_title: String,
    pub adapter_id: String,
    pub cwd: String,
    pub status: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub chunk_count: i64,
    pub transcript_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTranscriptDto {
    pub session_id: String,
    pub text: String,
    pub chunk_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTranscriptPageDto {
    pub session_id: String,
    pub text: String,
    pub chunk_count: usize,
    pub total_chunk_count: usize,
    pub start_seq: Option<u64>,
    pub end_seq: Option<u64>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchResultDto {
    pub session_id: String,
    pub node_id: String,
    pub node_title: String,
    pub adapter_id: String,
    pub cwd: String,
    pub status: String,
    pub started_at: Option<String>,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusDto {
    pub is_repo: bool,
    pub path_exists: bool,
    pub branch: String,
    pub dirty: bool,
    pub github_remote: bool,
    pub changed_files: Vec<String>,
    pub worktrees: Vec<GitWorktreeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffDto {
    pub is_repo: bool,
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeDto {
    pub path: String,
    pub branch: String,
    pub head: String,
    pub detached: bool,
    pub bare: bool,
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterPlatformDto {
    pub key: String,
    pub os: String,
    pub arch: String,
    pub asset_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfoDto {
    pub version: String,
    pub notes: Option<String>,
    pub published_at: Option<String>,
    pub platform: String,
    pub asset_name: String,
    pub download_url: String,
    pub sha256: String,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterStatusDto {
    pub current_version: String,
    pub platform: UpdaterPlatformDto,
    pub checked_at: String,
    pub update: Option<UpdateInfoDto>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterDownloadDto {
    pub version: String,
    pub asset_name: String,
    pub update_path: String,
    pub signature_status: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GithubRelease {
    pub(crate) tag_name: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) body: Option<String>,
    pub(crate) published_at: Option<String>,
    pub(crate) assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GithubReleaseAsset {
    pub(crate) name: String,
    pub(crate) browser_download_url: String,
    pub(crate) size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeCreateRequest {
    pub project_path: String,
    #[serde(default)]
    pub branch_name: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    pub worktree_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeCreateResult {
    pub worktree: GitWorktreeDto,
    pub status: GitStatusDto,
    pub cwd: String,
    pub base_commit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeReviewRequest {
    pub project_path: String,
    pub worktree_path: String,
    pub expected_branch: String,
    pub base_commit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeReviewResult {
    pub branch: String,
    pub base_commit: String,
    pub head_commit: String,
    pub snapshot_id: String,
    pub changed_files: Vec<String>,
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeRemoveRequest {
    pub project_path: String,
    pub worktree_path: String,
    #[serde(default)]
    pub expected_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeRemoveResult {
    pub removed_path: String,
    pub status: GitStatusDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinationBoardEnsureRequest {
    pub cwd: String,
    pub board_id: String,
    #[serde(default)]
    pub callsigns: Vec<String>,
    #[serde(default)]
    pub agent_event: Option<CoordinationAgentEventDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinationAgentEventDto {
    pub callsign: String,
    pub task: String,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub expected_files: Vec<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub handoff: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinationBoardFilesDto {
    pub board_id: String,
    pub cwd: String,
    pub board_path: String,
    pub tasks_path: String,
    pub agents_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinationTaskDto {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub detail: String,
    pub status: String,
    #[serde(default)]
    pub assignees: Vec<String>,
    #[serde(default)]
    pub priority: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinationBoardSyncRequest {
    pub cwd: String,
    #[serde(default)]
    pub callsigns: Vec<String>,
    #[serde(default)]
    pub tasks: Vec<CoordinationTaskDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinationBoardEventsRequest {
    pub cwd: String,
    #[serde(default)]
    pub cursors: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoordinationRunStepDto {
    pub id: String,
    pub label: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoordinationRunProgressDto {
    pub run_id: String,
    pub updated_at: String,
    pub current_step_id: Option<String>,
    pub steps: Vec<CoordinationRunStepDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinationBoardEventDto {
    pub id: String,
    pub callsign: String,
    pub task: String,
    pub task_id: Option<String>,
    pub status: String,
    pub expected_files: Vec<String>,
    pub note: Option<String>,
    pub handoff: Option<String>,
    pub run_id: Option<String>,
    pub progress: Option<CoordinationRunProgressDto>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinationBoardEventsResponse {
    pub events: Vec<CoordinationBoardEventDto>,
    pub cursors: BTreeMap<String, usize>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAutonomyPolicyDto {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_allow")]
    pub list_agents: String,
    #[serde(default = "default_allow")]
    pub send_message: String,
    #[serde(default = "default_allow")]
    pub spawn_agent: String,
    #[serde(default = "default_allow")]
    pub handoff_task: String,
    #[serde(default = "default_allow")]
    pub request_review: String,
    #[serde(default = "default_allow")]
    pub resolve_file_conflict: String,
    #[serde(default = "default_autonomy_depth")]
    pub max_depth: u8,
    #[serde(default = "default_autonomy_children")]
    pub max_children_per_agent: u8,
    #[serde(default = "default_autonomy_concurrency")]
    pub max_concurrent_agents: u8,
    #[serde(default = "default_autonomy_rate")]
    pub max_actions_per_minute: u8,
}

impl Default for AgentAutonomyPolicyDto {
    fn default() -> Self {
        Self {
            enabled: true,
            list_agents: default_allow(),
            send_message: default_allow(),
            spawn_agent: default_allow(),
            handoff_task: default_allow(),
            request_review: default_allow(),
            resolve_file_conflict: default_allow(),
            max_depth: default_autonomy_depth(),
            max_children_per_agent: default_autonomy_children(),
            max_concurrent_agents: default_autonomy_concurrency(),
            max_actions_per_minute: default_autonomy_rate(),
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_allow() -> String {
    "allow".to_string()
}

fn default_autonomy_depth() -> u8 {
    2
}

fn default_autonomy_children() -> u8 {
    3
}

fn default_autonomy_concurrency() -> u8 {
    8
}

fn default_autonomy_rate() -> u8 {
    20
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentControlRequestDto {
    pub request_id: String,
    pub source_session_id: String,
    pub source_node_id: String,
    pub canvas_id: String,
    pub action: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub adapter_id: Option<String>,
    #[serde(default)]
    pub files: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentControlAuthorizationDto {
    pub request_id: String,
    pub action: String,
    pub decision: String,
    pub reason: String,
    pub source_depth: u8,
    pub next_depth: u8,
    pub target_node_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentControlResultRequest {
    pub request_id: String,
    pub source_session_id: String,
    pub success: bool,
    pub message: String,
    #[serde(default)]
    pub target_node_id: Option<String>,
    #[serde(default)]
    pub child_node_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentControlAuditDto {
    pub id: i64,
    pub request_id: String,
    pub action: String,
    pub status: String,
    pub message: String,
    pub source_session_id: String,
    pub source_node_id: String,
    pub source_title: String,
    pub target_node_id: Option<String>,
    pub child_node_id: Option<String>,
    pub created_at: String,
}
