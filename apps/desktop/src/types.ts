import type { ThemeDefinition } from "./theme";

export type JsonObject = Record<string, unknown>;

export interface CoreEventEnvelope {
  event: string;
  payload: JsonObject;
  protocolVersion: number;
  eventId: string;
  sequence: number;
}

export interface CoreConnection {
  appDataDir: string;
  version: string;
  reused: boolean;
}

export interface CoreStatus {
  platform: string;
  version: string;
  appDataDir: string;
  updateDir: string;
  recoveredSessions: number;
  migrated: boolean;
  startupRecovery: StartupRecoveryState;
}

export interface StartupRecoveryState {
  previousUncleanShutdown: boolean;
  safeMode: boolean;
  consecutiveUncleanStarts: number;
  crashReportPath?: string;
  previousRunStartedAt?: string;
  previousRunVersion?: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  icon: string;
  iconColor: string;
  agentAccess: AgentAccessMode;
  branch: string;
  dirty: boolean;
  githubRemote: boolean;
  pathExists: boolean;
}

export interface CanvasNode {
  id: string;
  canvasId: string;
  kind: "shell_terminal" | "agent_terminal" | string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  colSpan?: number;
  rowSpan?: number;
  singlePaneWidth?: number;
  singlePaneHeight?: number;
  data: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface Canvas {
  id: string;
  projectId: string;
  name: string;
  themeId: string;
  nodes: CanvasNode[];
}

export interface Session {
  id: string;
  nodeId: string;
  adapterId: string;
  cwd: string;
  status: string;
  startedAt: string;
  nodeTitle?: string;
  endedAt?: string;
  chunkCount?: number;
  transcriptPreview?: string;
  protocol?: string;
  driver?: string;
  capabilities?: AgentRuntimeCapabilities;
  runtimeInstanceId?: string;
}

export interface ProjectFileCatalog {
  files: string[];
  wheeljackDocuments: string[];
  truncated: boolean;
}

export type AgentAccessMode = "default" | "full";

export type AgentEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export function agentEffortOptions(adapterId: string): AgentEffort[] {
  if (adapterId === "codex-cli") return ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
  if (adapterId === "claude-code") return ["low", "medium", "high", "xhigh", "max"];
  return ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
}

export interface AgentRuntimeCapabilities {
  cancel: boolean;
  interact: boolean;
  resume: boolean;
  attachedTerminal: boolean;
  imageInput?: boolean;
}

export interface SessionTranscript {
  sessionId: string;
  text: string;
  chunkCount: number;
}

export interface SessionHistoryItem extends Session {
  nodeTitle: string;
  chunkCount: number;
  transcriptPreview: string;
}

export interface SessionSearchResult {
  sessionId: string;
  nodeId: string;
  nodeTitle: string;
  adapterId: string;
  cwd: string;
  status: string;
  startedAt?: string;
  snippet: string;
}

export interface Adapter {
  id: string;
  displayName: string;
  icon?: string;
  status: string;
  setupHint: string;
  enabled: boolean;
  supportsStructured: boolean;
  supportedApprovalPolicies: string[];
  streaming?: {
    preferred?: {
      protocol?: string;
    };
  };
  probe?: AdapterProbe;
}

export interface AdapterProbe {
  adapterId: string;
  executablePath?: string;
  version?: string;
  authStatus: string;
  protocol?: string;
  verificationStatus: string;
  verifiedArgs: string[];
  verificationFingerprint?: string;
  docsUrl?: string;
  repairCommand?: string;
  message: string;
  checkedAt: string;
}

export interface AgentProfile {
  adapterId: string;
  provider: string;
  model: string;
  thinking: AgentEffort;
  approvalPolicy: string;
}

export type BotScope = "global" | "project";

export interface BotLaunch {
  adapterId: string;
  provider?: string;
  model?: string;
  thinking?: AgentEffort;
}

export interface BotProfile {
  id: string;
  scope: BotScope;
  projectId?: string;
  name: string;
  roleDescription: string;
  avatarSeed: string;
  launch: BotLaunch;
  launchCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BotProfileInput {
  id?: string;
  scope: BotScope;
  projectId?: string;
  name: string;
  roleDescription: string;
  avatarSeed?: string;
  launch: BotLaunch;
}

export interface AgentSpecialistSuggestion {
  name: string;
  roleDescription: string;
  rationale: string;
  adapterId?: string;
}

export interface BotSnapshot {
  profileId?: string;
  scope?: BotScope;
  source: "saved" | "one-off";
  name: string;
  roleDescription: string;
  avatarSeed: string;
  launch: BotLaunch;
}

export interface SessionTranscriptPage extends SessionTranscript {
  totalChunkCount: number;
  startSeq?: number;
  endSeq?: number;
  hasMore: boolean;
}

export interface AgentModelOption {
  id: string;
  label: string;
  description?: string;
  provider?: string;
  efforts: AgentEffort[];
  defaultEffort?: AgentEffort;
  isDefault?: boolean;
}

export interface AgentModelCatalog {
  models: AgentModelOption[];
}

export interface ActivityEvent {
  id: number;
  sessionId: string;
  seq: number;
  kind: string;
  status: string;
  message: string;
  payload: JsonObject;
  isRead: boolean;
  createdAt: string;
  nodeId?: string;
  nodeTitle?: string;
  adapterId?: string;
}

export interface GitStatus {
  isRepo: boolean;
  pathExists: boolean;
  branch: string;
  dirty: boolean;
  githubRemote: boolean;
  changedFiles: string[];
  worktrees: GitWorktree[];
}

export interface GitDiff {
  isRepo: boolean;
  text: string;
  truncated: boolean;
}

export interface GitWorktree {
  path: string;
  branch: string;
  head: string;
  detached: boolean;
  bare: boolean;
  dirty: boolean;
}

export interface GitWorktreeCreateResult {
  worktree: GitWorktree;
  status: GitStatus;
  cwd: string;
  baseCommit: string;
}

export interface GitWorktreeReview {
  branch: string;
  baseCommit: string;
  headCommit: string;
  snapshotId: string;
  changedFiles: string[];
  text: string;
  truncated: boolean;
}

export interface GitWorktreeIntegrate {
  status: "integrated" | "empty" | "source_dirty" | "target_dirty" | "conflict";
  branch: string;
  baseCommit: string;
  sourceHead: string;
  targetHead: string;
  previousTargetHead: string;
  commits: string[];
  message: string;
}

export interface OpsReviewEvidence {
  scope: "task" | "shared";
  isRepo: boolean;
  branch: string;
  changedFiles: string[];
  text: string;
  truncated: boolean;
  worktreePath?: string;
  baseCommit?: string;
  snapshotId?: string;
}

export interface RouteTargetPreview {
  taskId?: string;
  task: string;
  nodeId: string;
  title: string;
  adapterId: string;
  sessionId?: string;
  ready: boolean;
  writes: string[];
  reason?: string;
}

export interface RoutePreview {
  previewId: string;
  confirmationToken: string;
  message: string;
  risk: string;
  recipients: string[];
  writes: string[];
  requiresConfirmation: boolean;
  targets?: RouteTargetPreview[];
}

export interface RouteAssignment {
  target: string;
  task: string;
  taskId?: string;
}

export interface RouteExecuteResult {
  ok: boolean;
  message: string;
  deliveredCount: number;
  targets: Array<Pick<RouteTargetPreview, "taskId" | "task" | "nodeId" | "title" | "reason"> & { delivered: boolean }>;
}

export interface OpsCard {
  id: string;
  kind?: "task" | "objective";
  columnId: string;
  title: string;
  detail: string;
  assignee: string;
  priority: string;
  assigneeIds: string[];
  agentStatuses: Record<string, string>;
  expectedFiles: string[];
  lastNote: string;
  agentFiles?: Record<string, string[]>;
  dependencyIds?: string[];
  dependencyKinds?: Record<string, "hard" | "soft">;
  parentId?: string;
  events?: OpsTaskEvent[];
  startedAt?: string;
  completedAt?: string;
  pausedAt?: string;
  paused?: boolean;
  reviewerId?: string;
  definitionOfDone?: string;
  constraints?: string;
  verificationCommand?: string;
  verificationRun?: OpsVerificationRun;
  approvalAttempt?: OpsApprovalAttempt;
  report?: OpsTaskReport;
  reconciliation?: OpsTaskReconciliation;
  attemptCount?: number;
  retryAt?: string;
  reviewPolicy?: "human" | "agent" | "either";
  taskLane?: OpsTaskLane;
  runProgress?: OpsRunProgress;
  steeringDirective?: OpsSteeringDirective;
  workerSpecialist?: AgentSpecialistSuggestion;
  reviewerSpecialist?: AgentSpecialistSuggestion;
}

export interface OpsTaskReport {
  status: "reported";
  summary: string;
  evidence: string;
  checks: string[];
  risks: string[];
  reportedAt: string;
  agentId?: string;
}

export interface OpsTaskReconciliation {
  status: "queued" | "running" | "awaiting_repair" | "retrying" | "integrated" | "needs_human";
  attempts: number;
  message: string;
  updatedAt: string;
  reason?: "source_dirty" | "target_dirty" | "conflict" | "closed_before_integration" | "error";
  sourceHead?: string;
  targetHead?: string;
}

export type OpsRunStepState = "pending" | "running" | "blocked" | "done" | "failed";

export interface OpsRunStep {
  id: string;
  label: string;
  state: OpsRunStepState;
}

export interface OpsRunProgress {
  runId: string;
  updatedAt: string;
  currentStepId?: string;
  steps: OpsRunStep[];
}

export interface OpsSteeringDirective {
  id: string;
  text: string;
  createdAt: string;
  status: "queued" | "delivering" | "delivered" | "canceled" | "failed";
  kind?: "file_conflict";
  conflictFiles?: string[];
  deliveredAt?: string;
  error?: string;
}

export interface OpsApprovalAttempt {
  status: "blocked" | "retrying";
  message: string;
  attemptedAt: string;
}

export interface OpsVerificationRun {
  sessionId: string;
  command: string;
  worktreePath: string;
  cwd: string;
  baseCommit: string;
  status: "running" | "passed" | "failed" | "canceled" | "interrupted";
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  snapshotId?: string;
  message?: string;
}

export interface OpsTaskLane {
  kind: "git-worktree";
  worktreePath: string;
  cwd: string;
  branch: string;
  baseCommit: string;
  closedAt?: string;
  cleanup?: {
    action: "remove" | "delete" | "archive";
    status: "queued" | "resolving" | "blocked";
    requestedAt: string;
    message?: string;
    attempts?: number;
    retryAt?: string;
    requiresIntegration?: boolean;
    agentId?: string;
  };
}

export interface OpsDecompositionTaskDraft {
  key: string;
  title: string;
  detail: string;
  definitionOfDone: string;
  constraints: string;
  verificationCommand: string;
  expectedFiles: string[];
  dependencyKeys: string[];
  agentId?: string;
  workerSpecialist?: AgentSpecialistSuggestion;
  reviewerSpecialist?: AgentSpecialistSuggestion;
}

export interface OpsDecompositionProposal {
  requestId: string;
  parentId: string;
  tasks: OpsDecompositionTaskDraft[];
}

export interface OpsTaskContractDraft {
  definitionOfDone: string;
  constraints: string;
  verificationCommand: string;
  reviewPolicy: "human" | "agent" | "either";
  dependencyIds: string[];
}

export type OpsTaskEventKind =
  | "assignment"
  | "handoff"
  | "blocker"
  | "review"
  | "completion"
  | "pause"
  | "update";

export interface OpsTaskEvent {
  id: string;
  kind: OpsTaskEventKind;
  timestamp: string;
  message: string;
  callsign?: string;
  targetId?: string;
  files?: string[];
  status?: string;
  runId?: string;
  botSnapshot?: BotSnapshot;
}

export type OpsOrchestrationAction = "assign" | "transfer" | "resume" | "review" | "pause" | "release" | "approve" | "complete";

export interface KanbanColumn {
  id: string;
  title: string;
  role: "queued" | "active" | "review" | "done";
}

export interface OpsState {
  version: 2;
  columns: KanbanColumn[];
  cards: OpsCard[];
  archivedCards?: OpsCard[];
  prd: string;
  tdd: string;
  eventCursors: Record<string, number>;
  agentLabels?: Record<string, string>;
}

export type ProjectDocumentKind = "kanban" | "prd" | "tdd";

export interface ProjectDocument {
  kind: ProjectDocumentKind;
  path: string;
  exists: boolean;
  content: string;
  revision: string;
  format: "missing" | "markdown" | "importable" | "wheeljack-v1";
  warnings: string[];
  board?: {
    version: 1;
    columns: KanbanColumn[];
    cards: Array<Pick<OpsCard, "id" | "columnId" | "title" | "detail" | "assignee" | "priority" | "definitionOfDone" | "constraints" | "verificationCommand" | "reviewPolicy">>;
  };
}

export interface ProjectDocuments {
  projectPath: string;
  documents: Record<ProjectDocumentKind, ProjectDocument>;
}

export interface ProjectDocumentWrite {
  kind: ProjectDocumentKind;
  content: string;
  expectedRevision: string;
}

export interface ProjectDocumentWritePreview {
  previewId: string;
  confirmationToken: string;
  diff: string;
  writes: ProjectDocumentWrite[];
  requiresConfirmation: boolean;
}

export interface CoordinationEvent {
  id: string;
  callsign: string;
  task: string;
  taskId?: string;
  status: string;
  expectedFiles: string[];
  note?: string;
  handoff?: string;
  timestamp: string;
  runId?: string;
  progress?: OpsRunProgress;
}

export interface CoordinationEvents {
  events: CoordinationEvent[];
  cursors: Record<string, number>;
  warnings: string[];
}

export type UtilityPanelTab = "inbox" | "git" | "history";

export interface UiPreferences {
  theme: "graphite" | "paper";
  appearanceMode: "fixed" | "system";
  fixedThemeId: string;
  systemLightThemeId: string;
  systemDarkThemeId: string;
  customThemes: ThemeDefinition[];
  showStickerLensBackground: boolean;
  headingFontFamily: string;
  uiFontFamily: string;
  codeFontFamily: string;
  uiScale: number;
  uiFontSize: number;
  terminalFontSize: number;
  sidebarCollapsed: boolean;
  expandedProjectIds: string[];
  lastCanvasByProject: Record<string, string>;
  floorRailWidthByProject: Record<string, number>;
  sidebarWidth: number;
  utilityPanelWidth: number;
  utilityPanelTab: UtilityPanelTab;
  showPaneActions: boolean;
  showProjectPaths: boolean;
  showRecentActivity: boolean;
  showAgentRail: boolean;
}

export interface AgentImageAttachment {
  path: string;
  fileName: string;
  mimeType: string;
}

export type AgentAutonomyMode = "allow" | "ask" | "deny";

export interface AgentAutonomyPolicy {
  enabled: boolean;
  listAgents: AgentAutonomyMode;
  sendMessage: AgentAutonomyMode;
  spawnAgent: AgentAutonomyMode;
  handoffTask: AgentAutonomyMode;
  requestReview: AgentAutonomyMode;
  resolveFileConflict: AgentAutonomyMode;
  maxDepth: number;
  maxChildrenPerAgent: number;
  maxConcurrentAgents: number;
  maxActionsPerMinute: number;
}

export interface AgentControlRequest {
  id: string;
  action: "list_agents" | "send_message" | "spawn_agent" | "handoff_task" | "request_review" | "resolve_file_conflict";
  target?: string;
  message?: string;
  taskId?: string;
  adapterId?: string;
  files?: string[];
}

export interface AgentControlAuthorization {
  requestId: string;
  action: AgentControlRequest["action"];
  decision: AgentAutonomyMode;
  reason: string;
  sourceDepth: number;
  nextDepth: number;
  targetNodeId?: string;
}

export interface AgentControlAudit {
  id: number;
  requestId: string;
  action: AgentControlRequest["action"];
  status: string;
  message: string;
  sourceSessionId: string;
  sourceNodeId: string;
  sourceTitle: string;
  targetNodeId?: string;
  childNodeId?: string;
  createdAt: string;
}

export interface OpsStateRecord {
  canvasId: string;
  projectId: string;
  revision: number;
  state: OpsState;
  updatedAt: string;
}

export interface ProjectOpsStateRecord {
  projectId: string;
  revision: number;
  state: OpsState;
  updatedAt: string;
}

export interface OpsSchedulerConfig {
  projectId: string;
  canvasId: string;
  enabled: boolean;
  paused: boolean;
  concurrencyLimit: number;
  adapterId?: string;
  updatedAt: string;
}

export interface OpsTaskLease {
  id: string;
  projectId: string;
  canvasId: string;
  taskId: string;
  state: "pending" | "claimed" | "completed" | "released" | "failed" | "expired";
  ownerId?: string;
  adapterId?: string;
  leasedAt: string;
  expiresAt: string;
}

export interface AgentInteractionChoice {
  id: string;
  label: string;
  description?: string;
}

export interface AgentMessage {
  id: string;
  role: string;
  kind: string;
  text: string;
  title?: string;
  streaming?: boolean;
  code?: string;
  imagePath?: string;
  label?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageMimeType?: string;
  images?: AgentImageAttachment[];
  tool?: string;
  status?: string;
  interactionId?: string;
  interactionState?: "pending" | "submitting" | "approved" | "denied" | "answered" | "canceled";
  choices?: AgentInteractionChoice[];
}

export interface AgentParseResult {
  events: Array<{ type: string; sequence?: number; text?: string; title?: string; interactionId?: string }>;
  messages: AgentMessage[];
  controls?: string[];
  active: boolean;
}

export interface TerminalCursor {
  row: number;
  col: number;
  visible: boolean;
  shape: string;
  blinking: boolean;
}

export interface TerminalRun {
  column: number;
  cellWidth: number;
  text: string;
  fg: string;
  bg: string;
  flags: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  dim: boolean;
}

export interface TerminalRow {
  index: number;
  runs: TerminalRun[];
}

export interface TerminalFrame {
  sessionId: string;
  rows: number;
  cols: number;
  cursor: TerminalCursor;
  altScreen: boolean;
  mouseReporting: boolean;
  sgrMouse: boolean;
  mouseDrag: boolean;
  mouseMotion: boolean;
  alternateScroll: boolean;
  applicationCursor: boolean;
  applicationKeypad: boolean;
  bracketedPaste: boolean;
  focusEvents: boolean;
  insertMode: boolean;
  lineWrap: boolean;
  originMode: boolean;
  kittyKeyboard: boolean;
  viewportOffset: number;
  scrollbackLineCount: number;
  scrollbackLimit: number;
  gridRows?: TerminalRow[];
  dirtyRows?: TerminalRow[];
  metrics?: { frameBuildMs: number };
}

export interface PaneRuntime {
  nodeId: string;
  botProfileId?: string;
  sessionId: string;
  terminalSessionId?: string;
  historySessionId: string;
  adapterId: string;
  structured: boolean;
  protocol?: string;
  capabilities?: AgentRuntimeCapabilities;
  runtimeInstanceId?: string;
  protocolSequence?: number;
  startedAt?: string;
  endedAt?: string;
  status: string;
  frame?: TerminalFrame;
  frameReceivedAt?: number;
  transcript: string;
  structuredLines: string[];
  messages: AgentMessage[];
  statusSummary?: string;
  turnStartLine?: number;
  historyBeforeSeq?: number;
  historyHasMore?: boolean;
  historyLoading?: boolean;
}

export type SplitAxis = "columns" | "rows";

export type LayoutMode = "auto" | "manual";

export type SplitNode =
  | { type: "leaf"; paneId: string }
  | {
      type: "split";
      axis: SplitAxis;
      ratio: number;
      first: SplitNode;
      second: SplitNode;
    };
