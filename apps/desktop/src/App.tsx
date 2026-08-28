import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Markdown from "react-markdown";
import { Toast } from "radix-ui";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "./components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "./components/ui/dropdown-menu";
import { Input } from "./components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Textarea } from "./components/ui/textarea";
import { applyDownloadedUpdate, callCore, closeAfterFlush, completeUiSmoke, completeUpdateHealth, connectCore, legacyWindowsUiPreferences, uiSmokeAutoClose, uiSmokeEnabled, uiSmokeUpdateMode } from "./core";
import { adapterReadinessLabel, isAdapterReady, shouldAutoVerifyAdapter } from "./adapterReadiness";
import { reserveAgentCallsign, resolveAgentLabel } from "./agentIdentity";
import { safeAgentToken } from "./agentModels";
import {
  nodeDataWithAgentComposition,
  type AgentCompositionState,
} from "./agentComposition";
export { cachedAgentModels } from "./agentModels";
import {
  appendPendingAgentUserMessage,
  agentExitStatus,
  agentParseStatus,
  agentRuntimeCapabilities,
  agentStatusAfterInteraction,
  hydratedRuntimeStatus,
  isActiveSessionStatus,
  isLiveSessionStatus,
  isSuccessfulOnboardingTurn,
  isTerminalSessionStatus,
  mergeAgentMessages,
  reconcileParsedAgentMessages,
  setAgentInteractionState,
  shouldAutoCloseTaskAgent,
} from "./agentRuntime";
export {
  appendPendingAgentUserMessage,
  agentExitStatus,
  agentFailureNeedsRepair,
  agentParseStatus,
  agentRuntimeCapabilities,
  agentStatusAfterInteraction,
  hydratedRuntimeStatus,
  isLiveSessionStatus,
  isSuccessfulOnboardingTurn,
  isTerminalSessionStatus,
  mergeAgentMessages,
  reconcileParsedAgentMessages,
  setAgentInteractionState,
  shouldAutoCloseTaskAgent,
  supportsAgentImageInput,
  supportsAgentTurnCancel,
} from "./agentRuntime";
import { currentRuntimes, setRuntimes, useRuntimes } from "./state/runtimesStore";
import {
  canvasRef,
  canvasesRef,
  focusedPaneIdRef,
  layoutModeRef,
  layoutRef,
  nodesRef,
  projectRef,
  setCanvas,
  setCanvases,
  setFocusedPaneId,
  setLayout,
  setLayoutMode,
  setNodes,
  setProject,
  setProjects,
  useWorkspace,
} from "./state/workspaceStore";
import {
  opsStateRef,
  setOpsState,
  useOpsState,
} from "./state/opsStore";
export { defaultOpsState } from "./state/opsStore";
import {
  canonicalTaskLaneCwd,
  columnIdForRole,
  focusedPaneElement,
  hasMeaningfulPlanState,
  hasProjectPlanDocuments,
  kanbanVerificationContractIssues,
  mergeProjectDocuments,
  mergeConcurrentOpsState,
  mergeProjectSpecificationDocuments,
  parseOpsState,
  recoverOpsVerificationRuns,
  renderKanban,
  resolveAgentCwd,
  workspacePathsEqual,
} from "./opsOrchestration";
import { PaneAgentMenuItems, type TerminalAgentContext } from "./PaneAgentMenuItems";
export { paneDropPosition } from "./paneDrop";
export {
  canonicalTaskLaneCwd,
  columnIdForRole,
  hasMeaningfulPlanState,
  hasProjectPlanDocuments,
  kanbanVerificationContractIssues,
  mergeProjectDocuments,
  mergeConcurrentOpsState,
  mergeProjectSpecificationDocuments,
  parseOpsRunProgress,
  parseOpsState,
  parseOpsSteeringDirective,
  recoverOpsVerificationRuns,
  renderKanban,
  resolveAgentCwd,
  workspacePathsEqual,
} from "./opsOrchestration";
import { deriveAttention, pendingAgentInteraction, type AttentionItem } from "./attention";
import { AgentAvatar } from "./AgentAvatar";
import {
  botInput,
  botProfileForLaunch,
  botSnapshot,
  botSnapshotFromDraft,
  botSnapshotFromNode,
  botStandingPrompt,
  matchingSavedBot,
  specialistSnapshot,
  specialistSuggestion,
} from "./bots";
import type { SpecialistDialogAction, SpecialistDialogRequest, SpecialistReadiness } from "./SpecialistProposalDialog";
import { RunStateBadge } from "./RunStateBadge";
import { resolveRunState, visibleRunStateDetail } from "./runState";
import { CommandPalette, type CommandPaletteItem } from "./CommandPalette";
import { ProviderMark } from "./ProviderMark";
import { DotMatrixLoader } from "./DotMatrixLoader";
import { createDiagnosticsReport } from "./diagnostics";
import type { UsageSessionRow } from "./usage";
import { opsActiveFileConflicts, opsAutomaticFileConflictInstructions, opsCanCompleteWithOverride, opsCardParticipantIds, opsCurrentCardForAgent, opsDecompositionHasCycle, opsDispatchableDecompositionKeys, opsFileConflictDirectiveIsCurrent, opsResolveFileConflict, opsStatusAttentionReason, opsVerificationApproval, opsVerificationContractIssues } from "./opsPresence";
import { taskWorktreeCleanupPrompt } from "./taskWorktrees";
import { createStickerLensScene, StickerLensBackground, type StickerLensScene } from "./StickerLensBackground";
import {
  defaultUiPreferences,
  beginHorizontalResize,
  FLOOR_RAIL_DEFAULT_WIDTH,
  HomeSurface,
  normalizeFloorRailWidth,
  OnboardingSurface,
  OpsSurface,
  ProjectEmptyState,
  ProjectIdentitySheet,
  ProjectSidebar,
  ReviewDrawerSurface,
  SettingsSurface,
  TitleBar,
  TranscriptDrawerSurface,
  UtilityPanelSurface,
  type OpsPage,
  type SettingsPage,
  type ShellSurface,
} from "./ParitySurfaces";
import {
  buildSmartLayout,
  insertPane,
  leaves,
  movePane,
  reconcileLayout,
  removePane,
  resizePane,
  sameLayout,
  setSplitRatio,
  smartLayoutColumns,
  type LayoutViewport,
  type PanePlacement,
} from "./splitTree";
import { Activity, Bell, Briefcase, CheckIcon, ChevronRight, ChevronsLeft, ChevronsRight, Columns2, FileCode2, Folder, GitBranch, History, Home, LayoutDashboard, MonitorCog, MoreHorizontal, Plus, RefreshCw, Square, Terminal, Trash2, X } from "./SargamIcon";
import { builtInThemes, themeCss, validateTheme } from "./theme";
import { agentEffortOptions } from "./types";
import { useUpdater, type UpdateDownload, type UpdateProgress } from "./updater";
import { UpdateReleaseNotesSheet } from "./UpdaterPresentation";
import {
  defaultShortcutBindings,
  defaultShortcutBindingsForPlatform,
  formatShortcut,
  shortcutActionForEvent,
  shortcutBindingsFromSettings,
  type ShortcutAction,
  type ShortcutBindings,
} from "./shortcuts";
import type {
  Adapter,
  AdapterProbe,
  ActivityEvent,
  AgentAccessMode,
  AgentSessionIntent,
  AgentAutonomyPolicy,
  AgentControlAudit,
  AgentControlAuthorization,
  AgentControlRequest,
  AgentImageAttachment,
  AgentMessage,
  AgentParseResult,
  AgentProfile,
  AgentSpecialistSuggestion,
  Canvas,
  CanvasNode,
  BotProfile,
  BotProfileInput,
  BotSnapshot,
  CoreConnection,
  CoreEventEnvelope,
  CoreStatus,
  CoordinationEvents,
  GitDiff,
  GitStatus,
  GitTaskWorkspacesCleanupResult,
  GitWorktreeCreateResult,
  GitWorktreeIntegrate,
  GitWorktreeReview,
  JsonObject,
  LayoutMode,
  OpsCard,
  OpsDecompositionProposal,
  OpsDecompositionTaskDraft,
  OpsOrchestrationAction,
  OpsReviewEvidence,
  OpsState,
  OpsSteeringDirective,
  ProjectOpsStateRecord,
  OpsSchedulerConfig,
  OpsTaskLease,
  OpsTaskEvent,
  PaneRuntime,
  PromptDelivery,
  Project,
  ProjectDocumentKind,
  ProjectDocuments,
  ProjectDocumentWrite,
  ProjectDocumentWritePreview,
  RouteAssignment,
  RouteExecuteResult,
  RoutePreview,
  Session,
  SessionSearchResult,
  SessionTranscriptPage,
  SplitNode,
  TerminalFrame,
  UiPreferences,
  UtilityPanelTab,
} from "./types";

interface GateMetrics {
  events: number;
  protocolUpdates: number;
  sequenceGaps: number;
  framePaints: number[];
  inputPaints: number[];
  resizePaints: number[];
  coreFrameBuilds: number[];
  startedAt: number;
}

function DevToolsContextItem() {
  if (!import.meta.env.DEV) return null;
  return <><ContextMenuSeparator /><ContextMenuItem onSelect={() => void invoke("open_devtools").catch((cause) => console.error("Could not open DevTools.", cause))}><MonitorCog />Open DevTools</ContextMenuItem></>;
}

interface ConfirmationRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  resolve: (confirmed: boolean) => void;
}

interface PendingDocumentWrite {
  title: string;
  projectPath: string;
  writes: ProjectDocumentWrite[];
  preview: ProjectDocumentWritePreview;
}

interface AgentDocumentRequest {
  requestId: string;
  kind: ProjectDocumentKind | "bundle";
  kinds: ProjectDocumentKind[];
  contents: Partial<Record<ProjectDocumentKind, string>>;
  timeout: number;
}

export interface AgentTaskCardDraft {
  key: string;
  title: string;
  detail: string;
  priority: "low" | "normal" | "high";
  definitionOfDone: string;
  constraints: string;
  verificationCommand: string;
  reviewPolicy: "human" | "agent" | "either";
  dependencyKeys: string[];
  existingDependencyIds: string[];
  workerSpecialist?: AgentSpecialistSuggestion;
  reviewerSpecialist?: AgentSpecialistSuggestion;
}

export interface AgentTaskCardProposal {
  requestId: string;
  cards: AgentTaskCardDraft[];
}

interface AgentTaskCardRequest {
  requestId: string;
  timeout: number;
  resolve: (count: number) => void;
  reject: (cause: Error) => void;
}

type AgentProjectDocumentProposal =
  | { requestId: string; kind: ProjectDocumentKind; content: string }
  | { requestId: string; documents: Record<ProjectDocumentKind, string> };

export function mergeAgentProjectDocumentProposal(
  requestId: string,
  kinds: ProjectDocumentKind[],
  current: Partial<Record<ProjectDocumentKind, string>>,
  proposal: AgentProjectDocumentProposal,
): Partial<Record<ProjectDocumentKind, string>> | undefined {
  if (proposal.requestId !== requestId) return undefined;
  const next = { ...current };
  if ("documents" in proposal) {
    for (const kind of kinds) next[kind] = proposal.documents[kind];
    return next;
  }
  if (!kinds.includes(proposal.kind)) return undefined;
  next[proposal.kind] = proposal.content;
  return next;
}

interface AgentDecompositionRequest {
  requestId: string;
  parentId: string;
  timeout: number;
  resolve: (proposal: OpsDecompositionProposal) => void;
  reject: (cause: Error) => void;
}

interface HistoryTranscript {
  title: string;
  sessionId: string;
  adapterId: string;
  cwd: string;
  status: string;
  text: string;
  chunkCount: number;
  totalChunkCount: number;
  beforeSeq?: number;
  hasMore: boolean;
  loadingOlder?: boolean;
  visible: boolean;
}

interface AgentSpawnOrigin {
  parentNodeId?: string;
  parentSessionId?: string;
  autonomyDepth: number;
  onSpawned?: (node: CanvasNode, session: Session) => void;
}

interface BotSpawnContext {
  snapshot: BotSnapshot;
  profile?: BotProfile;
}

type OpsAgentRole = "worker" | "reviewer";

interface SpecialistDialogState extends SpecialistDialogRequest {
  launch?: {
    initialPrompt: string;
    displayPrompt: string;
    opsTask?: OpsCard;
    opsRole: OpsAgentRole;
    placement: PanePlacement;
  };
  resolve?: (started: boolean) => void;
}

interface CoordinationBoardFiles {
  boardId: string;
  tasksPath: string;
  agentsPath: string;
}

interface ErrorToast {
  id: number;
  message: string;
  open: boolean;
}

const freshMetrics = (): GateMetrics => ({
  events: 0,
  protocolUpdates: 0,
  sequenceGaps: 0,
  framePaints: [],
  inputPaints: [],
  resizePaints: [],
  coreFrameBuilds: [],
  startedAt: performance.now(),
});

export const DESKTOP_ONBOARDING_VERSION = 1;
const AGENT_ADAPTER_STORAGE_KEY = "wheeljack.agentAdapter";
const SplitView = lazy(async () => ({
  default: (await import("./WorkspaceRuntimeSurface")).SplitView,
}));
const UsageSurface = lazy(async () => ({
  default: (await import("./UsageSurface")).UsageSurface,
}));
const BotsSurface = lazy(async () => ({
  default: (await import("./BotsSurface")).BotsSurface,
}));
const SpecialistProposalDialog = lazy(async () => ({
  default: (await import("./BotsSurface")).SpecialistProposalDialog,
}));

function readLayoutViewport(
  stage: HTMLElement | null,
  previous: LayoutViewport,
): LayoutViewport {
  const rect = stage?.getBoundingClientRect();
  const width = rect?.width && rect.width > 0 ? rect.width : previous.width || window.innerWidth;
  const height = rect?.height && rect.height > 0 ? rect.height : previous.height || window.innerHeight;
  return { width, height };
}

export function App() {
  const [connection, setConnection] = useState<CoreConnection>();
  const [coreStatus, setCoreStatus] = useState<CoreStatus>();
  const {
    projects,
    project,
    canvases,
    canvas,
    nodes,
    layout,
    layoutMode,
    focusedPaneId,
  } = useWorkspace();
  const runtimes = useRuntimes();
  const [zoomedPaneId, setZoomedPaneId] = useState<string | null>(null);
  useEffect(() => {
    if (!canvas) return;
    setCanvases((current) => current.map((candidate) =>
      candidate.id === canvas.id ? { ...candidate, nodes } : candidate));
  }, [canvas, nodes]);
  const [agentPlacement, setAgentPlacement] = useState<PanePlacement>("auto");
  const [adapters, setAdapters] = useState<Adapter[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>(defaultAgentProfiles);
  const [selectedAdapterId, setSelectedAdapterId] = useState("");
  const selectedAdapterIdRef = useRef("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentIntent, setAgentIntent] = useState<AgentSessionIntent>("code");
  const [agentTask, setAgentTask] = useState<OpsCard>();
  const [agentTaskRole, setAgentTaskRole] = useState<OpsAgentRole>("worker");
  const [agentCreatorOpen, setAgentCreatorOpen] = useState(false);
  const [bots, setBots] = useState<BotProfile[]>([]);
  const [botsLoading, setBotsLoading] = useState(false);
  const [specialistDialog, setSpecialistDialog] = useState<SpecialistDialogState>();
  const agentPromptRef = useRef<HTMLTextAreaElement>(null);
  const focusCreatedAgentRef = useRef(false);
  const [teamRailCollapsed, setTeamRailCollapsed] = useState(true);
  const [teamRailWidth, setTeamRailWidth] = useState(238);
  const [chatViews, setChatViews] = useState<Set<string>>(new Set());
  const [surface, setSurface] = useState<ShellSurface>("home");
  const [usageRefreshVersion, setUsageRefreshVersion] = useState(0);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [planActive, setPlanActive] = useState(false);
  const [autonomousPickup, setAutonomousPickup] = useState(false);
  const [autonomousConcurrency, setAutonomousConcurrency] = useState(4);
  const [agentAutonomyPolicy, setAgentAutonomyPolicy] = useState<AgentAutonomyPolicy>(defaultAgentAutonomyPolicy());
  const [agentControlAudit, setAgentControlAudit] = useState<AgentControlAudit[]>([]);
  const stickerLensSceneRef = useRef<StickerLensScene>(createStickerLensScene());
  const stickerLensReloadPendingRef = useRef(true);
  const [terminalStickerLensHost, setTerminalStickerLensHost] = useState<HTMLElement | null>(null);
  const [opsStickerLensHost, setOpsStickerLensHost] = useState<HTMLElement | null>(null);
  const [utilityPanelOpen, setUtilityPanelOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState<"activity" | "sessions">("activity");
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("appearance");
  const [systemUsesLight, setSystemUsesLight] = useState(false);
  const [opsPage, setOpsPage] = useState<OpsPage>("floor");
  const [inspectedOpsCardId, setInspectedOpsCardId] = useState<string>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionSearchResults, setSessionSearchResults] = useState<SessionSearchResult[]>([]);
  const [sessionSearchBusy, setSessionSearchBusy] = useState(false);
  const [historyTranscript, setHistoryTranscript] = useState<HistoryTranscript>();
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [git, setGit] = useState<GitStatus>();
  const [gitDiff, setGitDiff] = useState<GitDiff>();
  const opsState = useOpsState();
  const [projectDocuments, setProjectDocuments] = useState<ProjectDocuments>();
  const [pendingDocumentWrite, setPendingDocumentWrite] = useState<PendingDocumentWrite>();
  const [documentConflict, setDocumentConflict] = useState<ProjectDocuments>();
  const [documentSaveStatus, setDocumentSaveStatus] = useState<"idle" | "saving" | "saved" | "conflict" | "error">("idle");
  const [preferences, setPreferences] = useState<UiPreferences>(defaultUiPreferences);
  const [shortcuts, setShortcuts] = useState<ShortcutBindings>({ ...defaultShortcutBindings });
  const [compactWindow, setCompactWindow] = useState(false);
  const [smokeDiagnostics, setSmokeDiagnostics] = useState(false);
  const [updateSmokeMode, setUpdateSmokeMode] = useState<"healthy" | "rollback" | null>(null);
  const [reviewCard, setReviewCard] = useState<OpsCard>();
  const [reviewEvidenceReady, setReviewEvidenceReady] = useState(false);
  const [reviewEvidenceMessage, setReviewEvidenceMessage] = useState("");
  const [reviewEvidence, setReviewEvidence] = useState<OpsReviewEvidence>();
  const [cleanupRetryVersion, setCleanupRetryVersion] = useState(0);
  const [taskWorkspaceSweepVersion, setTaskWorkspaceSweepVersion] = useState(0);
  const [reconciliationRetryVersion, setReconciliationRetryVersion] = useState(0);
  const [removeProject, setRemoveProject] = useState<Project>();
  const [customizeProject, setCustomizeProject] = useState<Project>();
  const [confirmation, setConfirmation] = useState<ConfirmationRequest>();
  const [canvasMenuId, setCanvasMenuId] = useState<string>();
  const [canvasNameDraft, setCanvasNameDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [activatingProjectId, setActivatingProjectId] = useState<string>();
  const [startupReady, setStartupReady] = useState(false);
  const [safeStartupActive, setSafeStartupActive] = useState(false);
  const [recoveryNoticeOpen, setRecoveryNoticeOpen] = useState(false);
  const [onboardingVersion, setOnboardingVersion] = useState<number>();
  const [resettingPreferences, setResettingPreferences] = useState(false);
  const [preferencesStatus, setPreferencesStatus] = useState("");
  const [error, setCurrentError] = useState("");
  const [errorToasts, setErrorToasts] = useState<ErrorToast[]>([]);
  const nextErrorToastId = useRef(0);
  const setError = useCallback((nextError: string) => {
    setCurrentError(nextError);
    setErrorToasts((current) => nextError
      ? [{ id: nextErrorToastId.current++, message: nextError, open: true }, ...current.filter((toast) => toast.open && toast.message !== nextError)].slice(0, 3)
      : current.map((toast) => ({ ...toast, open: false })));
  }, []);
  const closeErrorToast = useCallback((toast: ErrorToast) => {
    setErrorToasts((current) => current.map((item) => item.id === toast.id ? { ...item, open: false } : item));
    setCurrentError((current) => current === toast.message ? "" : current);
  }, []);
  const [metricVersion, setMetricVersion] = useState(0);
  const sequenceRef = useRef<number | undefined>(undefined);
  const parseTimersRef = useRef<Record<string, number>>({});
  const pendingParsesRef = useRef<Record<string, { runtime: PaneRuntime; lines: string[] }>>({});
  const parseVersionsRef = useRef<Record<string, number>>({});
  const layoutTimerRef = useRef<number | undefined>(undefined);
  const opsTimerRef = useRef<number | undefined>(undefined);
  const settingsTimerRef = useRef<number | undefined>(undefined);
  const opsNodeRef = useRef<CanvasNode | undefined>(undefined);
  const opsRevisionByProjectRef = useRef(new Map<string, number>());
  const opsBaseByProjectRef = useRef(new Map<string, OpsState>());
  const projectDocumentsRef = useRef<ProjectDocuments | undefined>(undefined);
  const documentWritePendingRef = useRef(false);
  const documentWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const agentDocumentRequestRef = useRef<AgentDocumentRequest | undefined>(undefined);
  const documentProposalHandlerRef = useRef<((proposal: AgentProjectDocumentProposal) => void) | undefined>(undefined);
  const agentTaskCardRequestRef = useRef<AgentTaskCardRequest | undefined>(undefined);
  const taskCardProposalHandlerRef = useRef<((proposal: AgentTaskCardProposal) => Promise<void>) | undefined>(undefined);
  const agentDecompositionRequestRef = useRef<AgentDecompositionRequest | undefined>(undefined);
  const agentControlHandlerRef = useRef<((runtime: PaneRuntime, request: AgentControlRequest) => Promise<void>) | undefined>(undefined);
  const handledAgentControlIdsRef = useRef(new Set<string>());
  const taskLaneCleanupIdsRef = useRef(new Set<string>());
  const taskWorkspaceSweepPendingRef = useRef(new Set<string>());
  const taskWorkspaceSweepCompletedRef = useRef(new Set<string>());
  const taskWorkspaceSweepAttemptsRef = useRef(new Map<string, number>());
  const layoutViewportRef = useRef<LayoutViewport>({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const preferencesRef = useRef<UiPreferences>(defaultUiPreferences);
  const agentAutonomyPolicyRef = useRef<AgentAutonomyPolicy>(defaultAgentAutonomyPolicy());
  const shortcutsRef = useRef<ShortcutBindings>({ ...defaultShortcutBindings });
  const agentProfilesRef = useRef<AgentProfile[]>(defaultAgentProfiles());
  const closingRef = useRef(false);
  const confirmationRef = useRef<ConfirmationRequest | undefined>(undefined);
  const coordinationPendingRef = useRef(false);
  const schedulerOwnerIdRef = useRef(crypto.randomUUID());
  const schedulerLeaseHandlerRef = useRef<(() => void) | undefined>(undefined);
  const schedulerClaimPendingRef = useRef(false);
  const schedulerFinalizedLeaseIdsRef = useRef(new Set<string>());
  const autoCloseTaskAgentIdsRef = useRef(new Set<string>());
  const autoCloseTaskAgentQueueRef = useRef<Promise<void>>(Promise.resolve());
  const steeringDeliveryIdsRef = useRef(new Set<string>());
  const pendingAgentCallsignsRef = useRef(new Set<string>());
  const metricsRef = useRef(freshMetrics());
  const inputSentAtRef = useRef<Record<string, number>>({});
  const writeQueuesRef = useRef<Record<string, Promise<void>>>({});
  const agentCompositionTimersRef = useRef<Record<string, number>>({});
  const pendingAgentCompositionsRef = useRef<Record<string, {
    canvasId: string;
    node: CanvasNode;
    composition: AgentCompositionState;
  }>>({});
  const agentCompositionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const terminalAttachPendingRef = useRef(new Set<string>());
  const persistedAgentStatesRef = useRef<Record<string, string>>({});
  const navigationVersionRef = useRef(0);
  const activatingProjectIdRef = useRef<string | undefined>(undefined);
  const desktopOnboardingVersionRef = useRef<number | undefined>(undefined);
  const sessionSearchVersionRef = useRef(0);
  const historyTranscriptRef = useRef<HistoryTranscript | undefined>(undefined);
  const reviewCardRef = useRef<OpsCard | undefined>(undefined);
  const reconciliationCardIdsRef = useRef(new Set<string>());
  const reconciliationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const legacyRecoverySpawnPendingRef = useRef(new Set<string>());
  const legacyRecoveryCompletionPendingRef = useRef(new Set<string>());
  const legacyRecoveryRuntimeRef = useRef(new Map<string, string>());
  const automaticAdapterVerificationRef = useRef(new Map<string, { key: string; attempts: number; pending: boolean }>());
  const verificationOutputTimerRef = useRef<number | undefined>(undefined);
  const opsPersistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const opsProjectionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const planActiveCanvasIdsRef = useRef(new Set<string>());
  const previousSurfaceRef = useRef<ShellSurface>("home");
  const updateSmokeBusyRef = useRef(false);
  const flushPendingSavesRef = useRef<() => Promise<void>>(async () => undefined);
  const applyUpdate = useCallback(async (updatePath: string) => {
    await flushPendingSavesRef.current();
    await applyDownloadedUpdate(updatePath);
    await closeAfterFlush();
  }, []);
  const updater = useUpdater(connection?.version, applyUpdate);

  useEffect(() => {
    setReviewCard((current) => current
      ? opsState.cards.find((card) => card.id === current.id)
      : current);
  }, [opsState]);

  const activatePlan = useCallback((canvasId = canvasRef.current?.id) => {
    if (!canvasId) return;
    planActiveCanvasIdsRef.current.add(canvasId);
    if (canvasRef.current?.id === canvasId) setPlanActive(true);
  }, []);
  useEffect(() => {
    projectDocumentsRef.current = projectDocuments;
  }, [projectDocuments]);
  preferencesRef.current = preferences;
  shortcutsRef.current = shortcuts;
  agentProfilesRef.current = agentProfiles;
  selectedAdapterIdRef.current = selectedAdapterId;
  historyTranscriptRef.current = historyTranscript;
  reviewCardRef.current = reviewCard;
  desktopOnboardingVersionRef.current = onboardingVersion;
  useEffect(() => {
    if (project?.id) setOpsPage("floor");
  }, [project?.id]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => setSystemUsesLight(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 980px)");
    const sync = () => setCompactWindow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    const closeForSmoke = () => {
      void getCurrentWindow().close();
    };
    window.addEventListener("wheeljack:smoke-close", closeForSmoke);
    return () => window.removeEventListener("wheeljack:smoke-close", closeForSmoke);
  }, []);
  useEffect(() => {
    if (!connection) return;
    void uiSmokeUpdateMode().then(setUpdateSmokeMode).catch(() => setUpdateSmokeMode(null));
    void uiSmokeEnabled().then(setSmokeDiagnostics).catch(() => setSmokeDiagnostics(false));
    void uiSmokeAutoClose().then(async (autoClose) => {
      if (!autoClose) return;
      const waitForUi = async (predicate: () => boolean, timeoutMilliseconds = 15_000) => {
        const deadline = performance.now() + timeoutMilliseconds;
        while (performance.now() < deadline) {
          if (predicate()) return true;
          await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
        }
        return false;
      };
      const shellReady = await waitForUi(() => Boolean(
        document.querySelector(".wj-titlebar") &&
        document.querySelector('img[alt="wheeljack"]') &&
        document.querySelector("div.wj-app-shell") &&
        document.body.textContent?.includes("Smoke recovery"),
      ));
      setSurface("terminal");
      const recoveryReady = await waitForUi(() => Boolean(
        document.querySelector("[data-pane-id]") &&
        document.body.textContent?.includes("Smoke recovery"),
      ));
      const projectReady = await waitForUi(() => Boolean(
        document.querySelector('button.wj-nav-item[aria-label="Smoke recovery"]:not(:disabled)'),
      ));
      const smokeProjects = await callCore<Project[]>("project_list", {}).catch(() => []);
      const smokeCanvases = (await Promise.all(smokeProjects.map((item) =>
        callCore<Canvas[]>("canvas_list_project", { projectId: item.id }).catch(() => []),
      ))).flat();
      const recoveryStored = smokeCanvases.some((item) =>
        item.nodes.some((node) => nodeTranscript(node.data).includes("wheeljack smoke restart recovery")),
      );
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "d",
        code: "KeyD",
        altKey: true,
        shiftKey: true,
        bubbles: true,
      }));
      const terminalReady = await waitForUi(() => Boolean(
        [...document.querySelectorAll("[data-pane-id]")].some((node) =>
          node.getAttribute("data-runtime-status") === "running" &&
          node.querySelector('textarea[aria-label="Terminal input"]')),
      ));
      const terminalInput = [...document.querySelectorAll("[data-pane-id]")]
        .find((node) => node.getAttribute("data-runtime-status") === "running")
        ?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Terminal input"]');
      if (terminalInput) {
        terminalInput.focus();
        terminalInput.value = "echo WHEELJACK_NATIVE_UI_SMOKE";
        terminalInput.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: terminalInput.value,
        }));
        terminalInput.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
        }));
      }
      const terminalEcho = await waitForUi(() =>
        [...document.querySelectorAll('[aria-label="Terminal output"]')].some((node) =>
          node.textContent?.includes("WHEELJACK_NATIVE_UI_SMOKE")),
      );
      const recoveredSessions = await callCore<Session[]>("session_list", { limit: 10 }).catch(() => []);
      const recoveredCount = recoveredSessions.filter((session) => session.status === "disconnected").length;
      setSurface("settings");
      const settingsReady = await waitForUi(() =>
        [...document.querySelectorAll("h1")].some((node) => node.textContent?.trim() === "Appearance"),
      );
      setSettingsPage("agents");
      const autonomyReady = await waitForUi(() => Boolean(
        document.querySelector('[aria-label="Agent autonomy"]')
        && document.querySelector('[aria-label="Spawn agents"]')
        && document.querySelector('[aria-label="Maximum spawn depth"]')
        && document.body.textContent?.includes("Autonomy history"),
      ));
      const ready = shellReady && recoveryReady && projectReady && recoveryStored && terminalReady && terminalEcho && settingsReady && autonomyReady && recoveredCount > 0;
      const smokeMessage = ready
        ? `Native Tauri shell, recovery pane, live terminal, agent autonomy settings, and wheeljack-core passed (${recoveredCount} recovered session).`
        : `Native UI smoke failed: shell=${shellReady}, recovery=${recoveryReady}/${projectReady}, stored=${recoveryStored}, terminal=${terminalReady}/${terminalEcho}, settings=${settingsReady}/${autonomyReady}, recovered=${recoveredCount}, projects=${smokeProjects.length}, canvases=${smokeCanvases.length}, nodes=${smokeCanvases.reduce((sum, item) => sum + item.nodes.length, 0)}.`;
      await completeUiSmoke(ready, smokeMessage);
      await getCurrentWindow().close();
    }).catch(async (cause) => {
      const detail = `UI smoke failed: ${message(cause)}`;
      setError(detail);
      await completeUiSmoke(false, detail).catch(() => undefined);
      await getCurrentWindow().close();
    });
  }, [connection, setError]);
  useEffect(() => {
    if (!updateSmokeMode || updateSmokeBusyRef.current) return;
    updateSmokeBusyRef.current = true;
    void updater.checkNow()
      .then(async () => {
        if (await updater.installNow()) return true;
        const downloaded = await updater.downloadNow();
        if (!downloaded) return false;
        return updater.installNow(downloaded.updatePath);
      })
      .then((installed) => {
        if (!installed) setError(`The ${updateSmokeMode} updater smoke could not install its staged update.`);
      });
  }, [setError, updateSmokeMode, updater]);
  useEffect(() => {
    const root = document.documentElement;
    const theme = resolvedTheme(preferences, systemUsesLight);
    root.dataset.theme = theme.variant === "light" ? "paper" : "graphite";
    root.style.colorScheme = theme.variant;
    for (const [key, value] of Object.entries(themeCss(theme))) root.style.setProperty(key, value);
    root.style.setProperty("--wj-heading-font", preferences.headingFontFamily);
    root.style.setProperty("--wj-ui-font", preferences.uiFontFamily);
    root.style.setProperty("--wj-code-font", preferences.codeFontFamily);
    root.style.setProperty("--wj-ui-size", `${preferences.uiFontSize}px`);
    root.style.setProperty("--wj-terminal-size", `${preferences.terminalFontSize}px`);
  }, [preferences, systemUsesLight]);
  useEffect(() => {
    if (isTauri()) void getCurrentWebview().setZoom(preferences.uiScale).catch((cause) => setError(`Could not apply UI scale: ${message(cause)}`));
  }, [preferences.uiScale, setError]);
  const saveDesktopOnboardingVersion = useCallback(async (version: number) => {
    await callCore("settings_import", { settings: { desktopOnboardingVersion: version } });
    desktopOnboardingVersionRef.current = version;
    setOnboardingVersion(version);
  }, []);
  const flushAgentComposition = useCallback((nodeId: string): Promise<void> => {
    window.clearTimeout(agentCompositionTimersRef.current[nodeId]);
    delete agentCompositionTimersRef.current[nodeId];
    const pending = pendingAgentCompositionsRef.current[nodeId];
    if (!pending) return Promise.resolve();
    delete pendingAgentCompositionsRef.current[nodeId];
    const currentNode = canvasRef.current?.id === pending.canvasId
      ? nodesRef.current.find((item) => item.id === nodeId)
      : undefined;
    const source = currentNode ?? pending.node;
    const updated = {
      ...source,
      data: nodeDataWithAgentComposition(source.data, pending.composition),
      updatedAt: new Date().toISOString(),
    };
    const write = agentCompositionQueueRef.current
      .catch(() => undefined)
      .then(() => callCore("canvas_upsert_node", { canvasId: pending.canvasId, node: updated }))
      .then(() => undefined);
    agentCompositionQueueRef.current = write.catch((cause) => {
      setError(`Could not persist ${source.title} draft: ${message(cause)}`);
    });
    return agentCompositionQueueRef.current;
  }, [setError]);
  const flushAgentCompositions = useCallback(async () => {
    await Promise.all(Object.keys(pendingAgentCompositionsRef.current).map(flushAgentComposition));
    await agentCompositionQueueRef.current;
  }, [flushAgentComposition]);
  const saveAgentComposition = useCallback((node: CanvasNode, composition: AgentCompositionState) => {
    const activeCanvas = canvasRef.current;
    const currentNode = nodesRef.current.find((item) => item.id === node.id);
    if (!activeCanvas || activeCanvas.id !== node.canvasId || !currentNode) return;
    const updated = {
      ...currentNode,
      data: nodeDataWithAgentComposition(currentNode.data, composition),
      updatedAt: new Date().toISOString(),
    };
    setNodes((current) => current.map((item) => item.id === node.id ? updated : item));
    pendingAgentCompositionsRef.current[node.id] = {
      canvasId: activeCanvas.id,
      node: updated,
      composition,
    };
    window.clearTimeout(agentCompositionTimersRef.current[node.id]);
    agentCompositionTimersRef.current[node.id] = window.setTimeout(() => {
      void flushAgentComposition(node.id);
    }, 320);
  }, [flushAgentComposition]);
  const persistAgentNodeState = useCallback(
    (nodeId: string, messages: AgentMessage[], status?: string, dataPatch: JsonObject = {}) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      const activeCanvas = canvasRef.current;
      if (!node || !activeCanvas) return;
      const preview = [...messages].reverse().find((message) =>
        message.text.trim() && ["user", "assistant"].includes(message.role),
      )?.text.trim().slice(0, 320);
      const { chatMessages: _legacyChatMessages, ...nodeData } = node.data;
      const nextStatus = status || nodeData.status;
      const nextPreview = preview || nodeData.chatPreview;
      if (
        Object.keys(dataPatch).length === 0
        &&
        !("chatMessages" in node.data)
        && nextStatus === nodeData.status
        && nextPreview === nodeData.chatPreview
      ) return;
      const updated = {
        ...node,
        data: {
          ...nodeData,
          ...dataPatch,
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(nextPreview ? { chatPreview: nextPreview } : {}),
        },
        updatedAt: new Date().toISOString(),
      };
      setNodes((current) => current.map((item) => item.id === updated.id ? updated : item));
      void callCore("canvas_upsert_node", { canvasId: activeCanvas.id, node: updated })
        .catch((cause) => setError(`Could not persist ${node.title}: ${message(cause)}`));
    },
    [setError],
  );
  const applyStructuredParse = useCallback(async (runtime: PaneRuntime, parsed: AgentParseResult) => {
    const controlSessionId = runtime.sessionId || runtime.historySessionId || runtime.nodeId;
    for (const text of parsed.controls ?? []) {
      for (const proposal of parseProjectDocumentProposals(text)) {
        documentProposalHandlerRef.current?.(proposal);
      }
      for (const proposal of parseAgentTaskCardProposals(text)) {
        void taskCardProposalHandlerRef.current?.(proposal);
      }
      const decomposition = parseOpsDecompositionProposal(text);
      const request = agentDecompositionRequestRef.current;
      if (decomposition && request?.requestId === decomposition.requestId && request.parentId === decomposition.parentId) {
        window.clearTimeout(request.timeout);
        agentDecompositionRequestRef.current = undefined;
        request.resolve(decomposition);
      }
      for (const control of parseAgentControlRequests(text)) {
        const key = `${controlSessionId}:${control.id}`;
        if (handledAgentControlIdsRef.current.has(key)) continue;
        handledAgentControlIdsRef.current.add(key);
        void agentControlHandlerRef.current?.(runtime, control).catch((cause) => {
          setError(`Agent control failed: ${message(cause)}`);
        });
      }
    }
    const failure = [...parsed.events].reverse().find((event) => event.type === "error");
    const messages = parsed.messages.map((item) => ({
      ...item,
      tool: item.kind === "tool" ? item.title ?? "Tool" : undefined,
      status: ["status", "approval", "question", "error"].includes(item.kind) ? item.kind : undefined,
    }));
    const latestVisibleAgentText = [...messages].reverse().find((item) =>
      item.role === "assistant" && item.text.trim())?.text.trim().slice(0, 500);
    const liveRuntime = currentRuntimes()[runtime.nodeId] ?? runtime;
    const runtimeMessages = reconcileParsedAgentMessages(liveRuntime.messages, messages, runtime.nodeId);
    const status = agentParseStatus(parsed, runtimeMessages, liveRuntime.status, liveRuntime.turnStartLine);
    setRuntimes((current) => ({
      ...current,
      [runtime.nodeId]: {
        ...current[runtime.nodeId],
        messages: reconcileParsedAgentMessages(current[runtime.nodeId]?.messages ?? [], messages, runtime.nodeId),
        protocolSequence: Math.max(current[runtime.nodeId]?.protocolSequence ?? 0, runtime.protocolSequence ?? 0),
        status,
        endedAt: isTerminalSessionStatus(status) ? current[runtime.nodeId]?.endedAt ?? new Date().toISOString() : undefined,
        statusSummary: status === "failed"
          ? failure?.text ?? "Agent turn failed."
          : status === "canceled" ? "Turn canceled."
          : status === "completed" ? "Turn completed."
          : status === "running" ? undefined
          : current[runtime.nodeId]?.statusSummary,
      },
    }));
    persistAgentNodeState(runtime.nodeId, runtimeMessages, status);
    const eventSessionId = runtime.sessionId || runtime.historySessionId;
    if (eventSessionId && status !== "canceling" && persistedAgentStatesRef.current[runtime.nodeId] !== status) {
      persistedAgentStatesRef.current[runtime.nodeId] = status;
      await callCore("session_event_append", {
        sessionId: eventSessionId,
        kind: "agent_protocol",
        status,
        message: failure?.text ?? latestVisibleAgentText
          ?? (status === "completed"
            ? "Agent turn completed."
            : status === "canceled" ? "Agent turn canceled." : `Agent is ${status}.`),
        payload: { nodeId: runtime.nodeId, adapterId: runtime.adapterId },
      });
    }
    if (desktopOnboardingVersionRef.current === 0 && isSuccessfulOnboardingTurn(parsed, status)) {
      try {
        await saveDesktopOnboardingVersion(DESKTOP_ONBOARDING_VERSION);
      } catch (cause) {
        setError(`The first agent finished, but onboarding could not be saved: ${message(cause)}`);
      }
    }
  }, [persistAgentNodeState, saveDesktopOnboardingVersion, setError]);
  const scheduleStructuredParse = useCallback(
    (runtime: PaneRuntime, lines: string[]) => {
      const sessionId = runtime.sessionId;
      pendingParsesRef.current[sessionId] = { runtime, lines };
      if (parseTimersRef.current[sessionId] !== undefined) return;
      parseTimersRef.current[sessionId] = window.setTimeout(async () => {
        delete parseTimersRef.current[sessionId];
        const pending = pendingParsesRef.current[sessionId];
        delete pendingParsesRef.current[sessionId];
        if (!pending) return;
        const { runtime, lines } = pending;
        const version = (parseVersionsRef.current[sessionId] ?? 0) + 1;
        parseVersionsRef.current[sessionId] = version;
        try {
          const parsed = await callCore<AgentParseResult>("agent_protocol_parse", {
            adapterId: runtime.adapterId,
            protocol: runtime.protocol,
            nodeId: runtime.nodeId,
            lines,
          });
          if (parseVersionsRef.current[sessionId] !== version) return;
          if ((currentRuntimes()[runtime.nodeId]?.protocolSequence ?? 0) > (runtime.protocolSequence ?? 0)) return;
          await applyStructuredParse(runtime, parsed);
        } catch (cause) {
          if (parseVersionsRef.current[sessionId] === version) setError(message(cause));
        }
      }, 50);
    },
    [applyStructuredParse, setError],
  );

  const handleCoreEvent = useCallback(
    (envelope: CoreEventEnvelope) => {
      const metrics = metricsRef.current;
      metrics.events++;
      if (
        sequenceRef.current !== undefined &&
        envelope.sequence !== sequenceRef.current + 1
      ) {
        metrics.sequenceGaps++;
      }
      sequenceRef.current = envelope.sequence;
      if (envelope.event === "updater:progress") {
        updater.onProgress(envelope.payload as unknown as UpdateProgress);
      } else if (envelope.event === "usage:updated") {
        setUsageRefreshVersion((version) => version + 1);
      } else if (envelope.event === "usage:error") {
        setError(`Usage accounting failed: ${stringValue(envelope.payload, "message") ?? "unknown error"}`);
      } else if (envelope.event === "agent:prompt-delivery") {
        const delivery = envelope.payload as unknown as PromptDelivery;
        if (!delivery.sessionId || !delivery.id) return;
        setRuntimes((current) => {
          const runtime = Object.values(current).find((candidate) => candidate.sessionId === delivery.sessionId);
          if (!runtime) return current;
          const deliveries = (runtime.promptDeliveries ?? []).filter((item) => item.id !== delivery.id);
          if (!["delivered", "canceled"].includes(delivery.state)) deliveries.push(delivery);
          deliveries.sort((left, right) => left.seq - right.seq);
          const messages = runtime.messages.map((item) => item.deliveryId === delivery.id
            ? {
                ...item,
                text: delivery.payload?.historyText ?? item.text,
                deliveryState: delivery.state,
              }
            : item);
          return {
            ...current,
            [runtime.nodeId]: { ...runtime, promptDeliveries: deliveries, messages },
          };
        });
      } else if (envelope.event === "terminal:frame") {
        const frame = envelope.payload as unknown as TerminalFrame;
        if (frame.metrics) metrics.coreFrameBuilds.push(frame.metrics.frameBuildMs);
        setRuntimes((current) => {
          const runtime = Object.values(current).find(
            (candidate) => (candidate.terminalSessionId ?? candidate.sessionId) === frame.sessionId,
          );
          if (!runtime) return current;
          return {
            ...current,
            [runtime.nodeId]: {
              ...runtime,
              frame,
              frameReceivedAt: performance.now(),
              status: runtime.structured ? runtime.status : terminalFrameRuntimeStatus(runtime),
            },
          };
        });
      } else if (envelope.event === "agent:protocol-update") {
        metrics.protocolUpdates++;
        const sessionId = stringValue(envelope.payload, "sessionId");
        const runtimeInstanceId = stringValue(envelope.payload, "runtimeInstanceId");
        const seq = numberValue(envelope.payload, "seq");
        if (!sessionId || !runtimeInstanceId || seq === undefined) return;
        if (parseTimersRef.current[sessionId] !== undefined) {
          window.clearTimeout(parseTimersRef.current[sessionId]);
          delete parseTimersRef.current[sessionId];
        }
        delete pendingParsesRef.current[sessionId];
        parseVersionsRef.current[sessionId] = (parseVersionsRef.current[sessionId] ?? 0) + 1;
        const runtime = Object.values(currentRuntimes()).find((candidate) =>
          candidate.sessionId === sessionId &&
          (candidate.runtimeInstanceId ?? candidate.sessionId) === runtimeInstanceId);
        if (!runtime || seq <= (runtime.protocolSequence ?? 0)) return;
        const parsed: AgentParseResult = {
          events: Array.isArray(envelope.payload.events) ? envelope.payload.events as AgentParseResult["events"] : [],
          messages: Array.isArray(envelope.payload.messages) ? envelope.payload.messages as AgentMessage[] : [],
          controls: Array.isArray(envelope.payload.controls) ? envelope.payload.controls.filter((value): value is string => typeof value === "string") : [],
          active: envelope.payload.active === true,
        };
        void applyStructuredParse({ ...runtime, protocolSequence: seq }, parsed)
          .catch((cause) => setError(message(cause)));
      } else if (envelope.event === "terminal:title") {
        const sessionId = stringValue(envelope.payload, "sessionId");
        const title = stringValue(envelope.payload, "title");
        if (sessionId && title) {
          setNodes((current) => current.map((node) =>
            stringValue(node.data, "sessionId") === sessionId ? { ...node, title } : node,
          ));
        }
      } else if (envelope.event === "pty:data") {
        const sessionId = stringValue(envelope.payload, "sessionId");
        if (sessionId && historyTranscriptRef.current?.sessionId === sessionId) {
          window.clearTimeout(verificationOutputTimerRef.current);
          verificationOutputTimerRef.current = window.setTimeout(() => {
            void callCore<SessionTranscriptPage>("session_transcript_page", { sessionId, visible: true, limit: 500 }).then((transcript) => {
              setHistoryTranscript((current) => current?.sessionId === sessionId
                ? {
                    ...current,
                    text: transcript.text,
                    chunkCount: transcript.chunkCount,
                    totalChunkCount: transcript.totalChunkCount,
                    beforeSeq: transcript.startSeq,
                    hasMore: transcript.hasMore,
                  }
                : current);
            }).catch(() => undefined);
          }, 60);
        }
      } else if (envelope.event === "ops:scheduler-lease") {
        const projectId = stringValue(envelope.payload, "projectId");
        if (projectId && projectRef.current?.id === projectId) schedulerLeaseHandlerRef.current?.();
      } else if (envelope.event === "ops:scheduler-error") {
        setError(`Autonomous scheduler paused for recovery: ${stringValue(envelope.payload, "message") ?? "unknown native error"}`);
      } else if (envelope.event === "activity:event") {
        const live = envelope.payload as unknown as ActivityEvent;
        setActivity((current) => dedupeActivity([live, ...current]));
        setRuntimes((current) => {
          const runtime = Object.values(current).find((candidate) => candidate.sessionId === live.sessionId);
          if (!runtime) return current;
          if (runtime.structured && live.status === "running" && ["needs_input", "canceling", "failed", "completed", "canceled"].includes(runtime.status)) {
            return current;
          }
          return {
            ...current,
            [runtime.nodeId]: {
              ...runtime,
              status: live.status,
              endedAt: isTerminalSessionStatus(live.status) ? runtime.endedAt ?? new Date().toISOString() : undefined,
              statusSummary: visibleRunStateDetail(live.status, live.message),
            },
          };
        });
      } else if (
        envelope.event === "pty:exit" ||
        envelope.event === "agent:structured-exit"
      ) {
        const sessionId = stringValue(envelope.payload, "sessionId");
        const exitCode = numberValue(envelope.payload, "exitCode");
        const incompleteTurn = envelope.payload.incompleteTurn === true;
        const terminationReason = stringValue(envelope.payload, "terminationReason");
        const attachedTerminalExit = envelope.event === "pty:exit" && envelope.payload.transient === true;
        const attachedRuntime = envelope.event === "pty:exit"
          ? Object.values(currentRuntimes()).find((candidate) => candidate.terminalSessionId === sessionId)
          : undefined;
        if (attachedTerminalExit) {
          if (attachedRuntime) {
            setChatViews((current) => new Set(current).add(attachedRuntime.nodeId));
            setRuntimes((current) => ({
              ...current,
              [attachedRuntime.nodeId]: {
                ...current[attachedRuntime.nodeId],
                terminalSessionId: undefined,
                frame: undefined,
                frameReceivedAt: undefined,
              },
            }));
          }
        } else {
          const endedAt = new Date().toISOString();
          setSessions((current) =>
            current.map((session) =>
              session.id === sessionId
                ? { ...session, status: agentExitStatus(undefined, exitCode, incompleteTurn, terminationReason), endedAt }
                : session,
            ),
          );
          setHistoryTranscript((current) => {
            if (!current || current.sessionId !== sessionId) return current;
            return { ...current, status: agentExitStatus(undefined, exitCode, incompleteTurn, terminationReason) };
          });
          setRuntimes((current) => {
            const runtime = Object.values(current).find(
              (candidate) => candidate.sessionId === sessionId,
            );
            if (!runtime) return current;
            const exitStatus = agentExitStatus(runtime.status, exitCode, incompleteTurn, terminationReason);
            const exitMessage = terminationReason === "completed"
              ? "Agent closed after completing its task."
              : terminationReason === "canceled"
              ? "Agent session canceled."
              : terminationReason === "shutdown"
              ? "Agent disconnected when wheeljack closed."
              : incompleteTurn
              ? "Agent process exited before the turn completed."
              : exitCode === undefined
              ? "Connection ended without an exit code."
              : `Exit code ${exitCode}`;
            return {
              ...current,
              [runtime.nodeId]: {
                ...runtime,
                status: exitStatus,
                endedAt,
                statusSummary: exitMessage,
                messages: exitStatus === "failed" && runtime.messages.at(-1)?.kind !== "error"
                  ? [...runtime.messages, {
                      id: crypto.randomUUID(),
                      role: "system",
                      kind: "error",
                      text: `Agent process failed: ${exitMessage}`,
                    }]
                  : runtime.messages,
              },
            };
          });
        }
      }
      if (metrics.events === 1 || metrics.events % 30 === 0) {
        setMetricVersion((value) => value + 1);
      }
    },
    [applyStructuredParse, setError, updater],
  );

  useEffect(() => {
    let cancelled = false;
    const parseTimers = parseTimersRef.current;
    const startupNavigation = navigationVersionRef.current;
    void connectCore(handleCoreEvent)
      .then(async (connected) => {
        if (cancelled) return;
        const updateHealthy = await completeUpdateHealth();
        if (cancelled) return;
        if (updateHealthy) updater.acknowledgeInstalledUpdate(connected.version);
        setConnection(connected);
        const [status, existingProjects, detectedAdapters, existingSessions, existingActivity, savedSettings, legacyWindowsPreferences] = await Promise.all([
          callCore<CoreStatus>("core_status", {}),
          callCore<Project[]>("project_list", {}),
          callCore<Adapter[]>("adapter_detect", {}),
          callCore<Session[]>("session_list", { limit: 100 }),
          callCore<ActivityEvent[]>("activity_list", { limit: 100 }),
          callCore<JsonObject>("settings_export", {}),
          legacyWindowsUiPreferences(),
        ]);
        if (cancelled) return;
        let effectiveSettings = savedSettings;
        const legacyDesktopPreferences = !savedSettings.desktopUiPreferences && legacyWindowsPreferences
          ? normalizeLegacyWindowsPreferences(legacyWindowsPreferences)
          : undefined;
        if (legacyDesktopPreferences) {
          await callCore("settings_import", { settings: { desktopUiPreferences: legacyDesktopPreferences } });
          effectiveSettings = await callCore<JsonObject>("settings_export", {});
        }
        const onboardingVersion = resolveDesktopOnboardingVersion(effectiveSettings, {
          migrated: status.migrated,
          projects: existingProjects,
          sessions: existingSessions,
          activity: existingActivity,
        });
        if (!Object.prototype.hasOwnProperty.call(effectiveSettings, "desktopOnboardingVersion")) {
          await callCore("settings_import", { settings: { desktopOnboardingVersion: onboardingVersion } });
        }
        desktopOnboardingVersionRef.current = onboardingVersion;
        setOnboardingVersion(onboardingVersion);
        const savedProfiles = agentProfilesFromSettings(effectiveSettings);
        const savedAgentAutonomyPolicy = agentAutonomyPolicyFromSettings(effectiveSettings);
        const savedPreferences = preferencesFromSettings(effectiveSettings);
        const savedShortcuts = shortcutBindingsFromSettings(effectiveSettings, status.platform);
        setCoreStatus(status);
        setProjects(existingProjects);
        setSessions(existingSessions);
        setActivity(dedupeActivity(existingActivity));
        setPreferences(savedPreferences);
        preferencesRef.current = savedPreferences;
        setShortcuts(savedShortcuts);
        shortcutsRef.current = savedShortcuts;
        setAgentProfiles(savedProfiles);
        agentProfilesRef.current = savedProfiles;
        setAgentAutonomyPolicy(savedAgentAutonomyPolicy);
        agentAutonomyPolicyRef.current = savedAgentAutonomyPolicy;
        const safeStartup = Boolean(status.startupRecovery?.safeMode);
        setSafeStartupActive(safeStartup);
        setRecoveryNoticeOpen(status.startupRecovery?.previousUncleanShutdown === true);
        setAdapters(detectedAdapters.map((adapter) =>
          !safeStartup && adapter.supportsStructured ? { ...adapter, status: "" } : adapter));
        const savedAdapterId = selectedAgentAdapterIdFromSettings(effectiveSettings)
          || localStorage.getItem(AGENT_ADAPTER_STORAGE_KEY)
          || "";
        const preferredAdapterId = preferredCodingAdapterId(detectedAdapters, savedProfiles, savedAdapterId);
        selectedAdapterIdRef.current = preferredAdapterId;
        setSelectedAdapterId(preferredAdapterId);
        if (!selectedAgentAdapterIdFromSettings(effectiveSettings) && preferredAdapterId) {
          await callCore("settings_import", { settings: { selectedAgentAdapterId: preferredAdapterId } });
        }
        const startupProject = existingProjects.find((candidate) => candidate.pathExists !== false);
        if (cancelled) return;
        setStartupReady(true);
        if (startupProject && !safeStartup && navigationVersionRef.current === startupNavigation) {
          if (onboardingVersion) setSurface("terminal");
          activateProject(startupProject);
        }
        if (!safeStartup) {
          probeAdapters(detectedAdapters, savedProfiles, startupProject?.agentAccess).then(setAdapters);
        }
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(message(cause));
        setStartupReady(true);
      });
    return () => {
      cancelled = true;
      for (const timer of Object.values(parseTimers)) window.clearTimeout(timer);
      window.clearTimeout(layoutTimerRef.current);
      window.clearTimeout(opsTimerRef.current);
      window.clearTimeout(settingsTimerRef.current);
      window.clearTimeout(verificationOutputTimerRef.current);
    };
    // The core channel is connected exactly once for this webview lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshBots = useCallback(async () => {
    if (!connection) return;
    setBotsLoading(true);
    try {
      setBots(await callCore<BotProfile[]>("bot_list", project?.id ? { projectId: project.id } : {}));
    } catch (cause) {
      setError(`Could not load bots: ${message(cause)}`);
    } finally {
      setBotsLoading(false);
    }
  }, [connection, project?.id, setError]);

  useEffect(() => {
    void refreshBots();
  }, [refreshBots]);

  const activateProject = async (nextProject: Project, targetNodeId?: string) => {
    if (nextProject.pathExists === false) {
      setError(`${nextProject.name} is no longer available at ${nextProject.path}. Relink the project folder to continue.`);
      return false;
    }
    if (activatingProjectIdRef.current) return false;
    const previousProject = projectRef.current;
    const previousCanvases = canvasesRef.current;
    activatingProjectIdRef.current = nextProject.id;
    setActivatingProjectId(nextProject.id);
    setBusy(true);
    setError("");
    taskWorkspaceSweepCompletedRef.current.delete(nextProject.id);
    taskWorkspaceSweepAttemptsRef.current.delete(nextProject.id);
    try {
      if (projectRef.current && projectRef.current.id !== nextProject.id) {
        await flushPendingSavesRef.current();
      }
      let projectCanvases = await callCore<Canvas[]>("canvas_list_project", {
        projectId: nextProject.id,
      });
      if (!projectCanvases.length) {
        const created = await callCore<Canvas>("canvas_create_project", {
          projectId: nextProject.id,
          name: "Canvas 1",
        });
        projectCanvases = [created];
      }
      const targetCanvasSummary = projectCanvases.find((candidate) => candidate.nodes.some((node) => node.id === targetNodeId))
        ?? projectCanvases.find((candidate) => candidate.id === preferencesRef.current.lastCanvasByProject[nextProject.id])
        ?? projectCanvases[0];
      if (!targetCanvasSummary) throw new Error("The project has no canvas to open.");
      const targetCanvas = await callCore<Canvas>("canvas_get", { canvasId: targetCanvasSummary.id });
      setProject(nextProject);
      setCanvases(projectCanvases);
      await activateCanvas(targetCanvas, true);
      projectDocumentsRef.current = undefined;
      setProjectDocuments(undefined);
      setDocumentConflict(undefined);
      setDocumentSaveStatus("idle");
      await Promise.all([refreshProjectData(nextProject), refreshProjectDocuments(nextProject, true)]);
      setTaskWorkspaceSweepVersion((current) => current + 1);
      return true;
    } catch (cause) {
      if (canvasRef.current?.projectId !== nextProject.id) {
        setProject(previousProject);
        setCanvases(previousCanvases);
      }
      setError(message(cause));
      return false;
    } finally {
      activatingProjectIdRef.current = undefined;
      setActivatingProjectId(undefined);
      setBusy(false);
    }
  };

  const activateCanvas = async (canvasSummary: Canvas, authoritative = false) => {
    const nextCanvas = authoritative
      ? canvasSummary
      : await callCore<Canvas>("canvas_get", { canvasId: canvasSummary.id });
    if (canvasRef.current && canvasRef.current.id !== canvasSummary.id) {
      await flushPendingSavesRef.current();
    }
    await flushAgentCompositions();
    const degraded: string[] = [];
    const visibleNodes = nextCanvas.nodes.filter((node) => node.kind !== "ops_state");
    const projectAgentNodes = canvasesRef.current
      .flatMap((candidate) => candidate.id === nextCanvas.id ? nextCanvas.nodes : candidate.nodes)
      .filter((node) => node.kind === "agent_terminal");
    const opsNode = nextCanvas.nodes.find((node) => node.kind === "ops_state");
    const [canonicalOps, schedulerConfig] = await Promise.all([
      callCore<ProjectOpsStateRecord | null>("ops_project_state_get", { projectId: nextCanvas.projectId }),
      callCore<OpsSchedulerConfig | null>("ops_scheduler_status", { projectId: nextCanvas.projectId }),
    ]);
    const storedOps = parseOpsState(canonicalOps ? canonicalOps.state as unknown as JsonObject : opsNode?.data);
    const documents = projectDocumentsRef.current;
    const mergedOps = !canonicalOps && documents && documents.projectPath === projectRef.current?.path
      ? mergeProjectDocuments(storedOps, documents)
      : storedOps;
    const nextPlanActive = planActiveCanvasIdsRef.current.has(nextCanvas.id)
      || hasMeaningfulPlanState(mergedOps)
      || (documents?.projectPath === projectRef.current?.path && hasProjectPlanDocuments(documents));
    const normalizedOps = normalizeOpsAgentIdentities(
      mergedOps,
      opsAgentAliases(projectAgentNodes),
    );
    const [savedLayout, sessions] = await Promise.all([
      callCore<{ mode?: LayoutMode; root?: unknown } | null>("canvas_layout_get", {
        canvasId: nextCanvas.id,
      }).catch((cause) => {
        degraded.push(`layout: ${message(cause)}`);
        return null;
      }),
      callCore<Session[]>("session_list", { limit: 100 }).catch((cause) => {
        degraded.push(`recent sessions: ${message(cause)}`);
        return [];
      }),
    ]);
    const runtimeNodes = [...new Map(
      [...visibleNodes, ...projectAgentNodes].map((node) => [node.id, node]),
    ).values()];
    const hydrated = await hydrateRuntimes(runtimeNodes, sessions);
    const reconciledRoot = reconcileLayout(savedLayout?.root, visibleNodes.map((node) => node.id));
    const nextLayoutMode: LayoutMode = savedLayout ? savedLayout.mode === "auto" ? "auto" : "manual" : "auto";
    const nextViewport = readLayoutViewport(stageRef.current, layoutViewportRef.current);
    const root = nextLayoutMode === "auto"
      ? buildSmartLayout(leaves(reconciledRoot), nextViewport)
      : reconciledRoot;
    const nextOps = recoverOpsVerificationRuns(
      normalizedOps,
      new Set(),
      new Set(),
    );
    const recoveredVerification = nextOps.cards.some((card, index) => card !== normalizedOps.cards[index]);
    const importedInitialPlan = !canonicalOps && hasMeaningfulPlanState(nextOps);
    if (recoveredVerification || importedInitialPlan) {
      const activeProject = projectRef.current;
      if (!activeProject || activeProject.id !== nextCanvas.projectId) {
        throw new Error("Could not persist interrupted verification for an inactive project.");
      }
      await persistOpsQueued(nextOps, nextCanvas, activeProject, hydrated, visibleNodes, opsNode);
    }
    const activeSchedulerConfig = schedulerConfig?.enabled && schedulerConfig.canvasId !== nextCanvas.id
      ? await callCore<OpsSchedulerConfig>("ops_scheduler_configure", {
          projectId: nextCanvas.projectId,
          canvasId: nextCanvas.id,
          enabled: true,
          paused: schedulerConfig.paused,
          concurrencyLimit: schedulerConfig.concurrencyLimit,
          adapterId: schedulerConfig.adapterId,
        }).catch((cause) => {
          degraded.push(`scheduler: ${message(cause)}`);
          return schedulerConfig;
        })
      : schedulerConfig;
    await Promise.all(Object.values(currentRuntimes()).flatMap((runtime) =>
      runtime.terminalSessionId
        ? [callCore("pty_kill", { sessionId: runtime.terminalSessionId }).catch(() => undefined)]
        : [],
    ));
    setCanvases((current) => current.map((item) => item.id === nextCanvas.id ? nextCanvas : item));
    opsRevisionByProjectRef.current.set(nextCanvas.projectId, canonicalOps?.revision ?? 0);
    opsBaseByProjectRef.current.set(nextCanvas.projectId, normalizedOps);
    if (nextPlanActive) planActiveCanvasIdsRef.current.add(nextCanvas.id);
    setPlanActive(nextPlanActive);
    setAutonomousPickup(Boolean(activeSchedulerConfig?.enabled && !activeSchedulerConfig.paused));
    setAutonomousConcurrency(activeSchedulerConfig?.concurrencyLimit ?? 4);
    setCanvas(nextCanvas);
    if (preferencesRef.current.lastCanvasByProject[nextCanvas.projectId] !== nextCanvas.id) {
      updatePreferences({
        lastCanvasByProject: {
          ...preferencesRef.current.lastCanvasByProject,
          [nextCanvas.projectId]: nextCanvas.id,
        },
      });
    }
    opsNodeRef.current = canonicalOps ? undefined : opsNode;
    setOpsState(nextOps);
    setSessions(sessions);
    setNodes(visibleNodes);
    setRuntimes(hydrated);
    layoutViewportRef.current = nextViewport;
    const initialFocus = leaves(root)[0] ?? null;
    setLayout(root);
    setLayoutMode(nextLayoutMode);
    setFocusedPaneId(initialFocus);
    setChatViews(
      new Set(
        visibleNodes
          .filter((node) => node.kind === "agent_terminal")
          .map((node) => node.id),
      ),
    );
    if (canonicalOps && nextPlanActive && projectRef.current?.id === nextCanvas.projectId) {
      void queueOpsProjection(nextOps, projectRef.current, hydrated, visibleNodes)
        .catch((cause) => setError(`Could not refresh task projections: ${message(cause)}`));
    }
    if (degraded.length > 0) {
      setError(`Canvas opened with degraded state (${degraded.join("; ")}). Retry the canvas to restore it.`);
    }
    queueMicrotask(() => {
      if (activeSchedulerConfig?.enabled && !activeSchedulerConfig.paused) schedulerLeaseHandlerRef.current?.();
    });
  };

  const refreshProjectData = async (nextProject = project) => {
    const [nextActivity, nextSessions] = await Promise.all([
      callCore<ActivityEvent[]>("activity_list", { limit: 100 }),
      callCore<Session[]>("session_list", { limit: 100 }),
    ]);
    setActivity(nextActivity);
    setSessions(nextSessions);
    if (!nextProject) return;
    const [nextGit, nextDiff] = await Promise.all([
      callCore<GitStatus>("git_status", { path: nextProject.path, includeWorktrees: false }),
      callCore<GitDiff>("git_diff", { path: nextProject.path }),
    ]);
    setGit(nextGit);
    setGitDiff(nextDiff);
  };

  const refreshProjectWorktrees = async (nextProject = projectRef.current) => {
    if (!nextProject) return;
    const [nextGit, nextDiff] = await Promise.all([
      callCore<GitStatus>("git_status", { path: nextProject.path, includeWorktrees: true }),
      callCore<GitDiff>("git_diff", { path: nextProject.path }),
    ]);
    if (projectRef.current?.id !== nextProject.id) return;
    setGit(nextGit);
    setGitDiff(nextDiff);
  };

  const refreshProjectDocuments = async (nextProject = project, force = false) => {
    if (!nextProject?.path || (documentWritePendingRef.current && !force)) return;
    const next = await callCore<ProjectDocuments>("project_documents_read", {
      projectPath: nextProject.path,
    });
    if (projectRef.current?.id !== nextProject.id) return;
    if (hasProjectPlanDocuments(next) && canvasRef.current?.projectId === nextProject.id) {
      activatePlan(canvasRef.current.id);
    }
    const current = projectDocumentsRef.current;
    if (
      !force &&
      current?.projectPath === next.projectPath &&
      projectDocumentRevisions(current) === projectDocumentRevisions(next)
    ) return;
    if (
      !force &&
      current?.projectPath === next.projectPath &&
      projectSpecificationDocumentWrites(opsStateRef.current, current).length > 0
    ) {
      setDocumentConflict(next);
      setDocumentSaveStatus("conflict");
      return;
    }
    projectDocumentsRef.current = next;
    setProjectDocuments(next);
    setDocumentConflict(undefined);
    setDocumentSaveStatus("saved");
    const merged = mergeProjectSpecificationDocuments(opsStateRef.current, next);
    setOpsState(merged);
  };

  const hydrateRuntimes = async (
    visibleNodes: CanvasNode[],
    sessions: Session[],
  ): Promise<Record<string, PaneRuntime>> => {
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    const referencedSessionIds = [...new Set(visibleNodes.flatMap((node) => {
      const sessionId = stringValue(node.data, "sessionId");
      const historySessionId = nodeHistorySessionId(node.data);
      return [sessionId, historySessionId].filter((id): id is string => Boolean(id));
    }))];
    const sessionStatuses = referencedSessionIds.length
      ? await callCore<Record<string, { status: string; exitCode?: number; startedAt?: string; endedAt?: string }>>("session_statuses", { sessionIds: referencedSessionIds })
      : {};
    const pairs = await Promise.all(
      visibleNodes
        .filter((node) => node.kind === "shell_terminal" || node.kind === "agent_terminal")
        .map(async (node): Promise<[string, PaneRuntime]> => {
          const sessionId = stringValue(node.data, "sessionId") ?? "";
          const historySessionId = nodeHistorySessionId(node.data);
          const structured =
            node.kind === "agent_terminal" &&
            stringValue(node.data, "transport") === "structured";
          let transcript = "";
          let frame: TerminalFrame | undefined;
          const protocol = stringValue(node.data, "protocol");
          const session = sessionsById.get(sessionId) ?? sessionsById.get(historySessionId);
          const authoritativeSession = sessionStatuses[sessionId] ?? sessionStatuses[historySessionId];
          const savedIntent = stringValue(node.data, "intent") ?? session?.intent;
          const intent: AgentSessionIntent = savedIntent === "ask" ? "ask" : "code";
          const promptDeliveries = structured && sessionId
            ? await callCore<PromptDelivery[]>("session_prompt_list", { sessionId })
            : [];
          let messages = agentMessages(node.data);
          for (const delivery of promptDeliveries) {
            if (messages.some((item) => item.deliveryId === delivery.id)) continue;
            messages.push({
              id: `delivery:${delivery.id}`,
              role: "user",
              kind: "message",
              text: delivery.payload?.historyText ?? "",
              images: delivery.payload?.imagePaths.map(deliveryImageAttachment),
              deliveryId: delivery.id,
              deliveryState: delivery.state,
            });
          }
          let parsedStatus: string | undefined;
          let structuredLines: string[] = [];
          let historyBeforeSeq: number | undefined;
          let historyEndSeq: number | undefined;
          let historyHasMore = false;
          const persistedTranscript = nodeTranscript(node.data);
          if (historySessionId) {
            const loaded = await callCore<SessionTranscriptPage>("session_transcript_page", {
              sessionId: historySessionId,
              visible: !structured,
              limit: 500,
            }).catch(() => undefined);
            transcript = loaded?.text || persistedTranscript;
            historyBeforeSeq = loaded?.startSeq;
            historyEndSeq = loaded?.endSeq;
            historyHasMore = loaded?.hasMore ?? false;
            if (!structured) {
              frame = await callCore<TerminalFrame>("terminal_viewport", {
                sessionId: historySessionId,
                displayOffset: 0,
              }).catch(() => undefined);
            } else if (transcript) {
              structuredLines = transcript.split(/\r?\n/).filter(Boolean);
              const parsed = await callCore<AgentParseResult>("agent_protocol_parse", {
                adapterId:
                  stringValue(node.data, "adapterId") ?? "unknown",
                protocol,
                nodeId: node.id,
                lines: structuredLines,
              }).catch(() => undefined);
              if (parsed) {
                messages = reconcileParsedAgentMessages(messages, parsed.messages, node.id);
                parsedStatus = agentParseStatus(parsed, messages, stringValue(node.data, "status"));
              }
            }
          } else transcript = persistedTranscript;
          return [
            node.id,
            {
              nodeId: node.id,
              sessionId,
              historySessionId,
              adapterId:
                stringValue(node.data, "adapterId") ??
                (structured ? "unknown" : "generic-shell"),
              structured,
              protocol,
              capabilities: agentRuntimeCapabilities(node.data.runtimeCapabilities),
              runtimeInstanceId: stringValue(node.data, "runtimeInstanceId") ?? sessionId,
              startedAt: authoritativeSession?.startedAt ?? session?.startedAt,
              endedAt: authoritativeSession?.endedAt ?? session?.endedAt,
              protocolSequence: historyEndSeq ?? structuredLines.length,
              status: hydratedRuntimeStatus(
                structured,
                messages.length > 0,
                authoritativeSession?.status ?? sessionsById.get(historySessionId)?.status,
                parsedStatus ?? stringValue(node.data, "status"),
              ),
              intent,
              promptDeliveries,
              frame,
              transcript,
              structuredLines,
              messages,
              historyBeforeSeq,
              historyHasMore,
            },
          ];
        }),
    );
    return Object.fromEntries(pairs);
  };

  const pickProject = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Open wheeljack project" });
    if (typeof selected === "string") await openProjectPath(selected);
  };

  const relinkProject = async (missingProject: Project) => {
    const selected = await open({ directory: true, multiple: false, title: `Relink ${missingProject.name}` });
    if (typeof selected !== "string") return;
    setBusy(true);
    setError("");
    try {
      navigationVersionRef.current++;
      const relinked = await callCore<Project>("project_relink", {
        projectId: missingProject.id,
        path: selected,
      });
      setProjects((current) => current.map((candidate) => candidate.id === relinked.id ? relinked : candidate));
      await activateProject(relinked);
      setSurface((desktopOnboardingVersionRef.current ?? 0) > 0 ? "terminal" : "home");
    } catch (cause) {
      setError(`Could not relink ${missingProject.name}: ${message(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const openProjectPath = async (value: string) => {
    const path = value.trim();
    if (!path) return;
    setBusy(true);
    setError("");
    try {
      navigationVersionRef.current++;
      const opened = await callCore<Project>("project_open", { path });
      setProjects((current) => [
        opened,
        ...current.filter((candidate) => candidate.id !== opened.id),
      ]);
      await activateProject(opened);
      setSurface((desktopOnboardingVersionRef.current ?? 0) > 0 ? "terminal" : "home");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const persistLayout = useCallback((root: SplitNode | null, activeCanvas: Canvas, mode: LayoutMode) =>
    callCore("canvas_layout_save", {
      canvasId: activeCanvas.id,
      layout: { version: 1, mode, root },
    }), []);

  const saveLayout = useCallback((root: SplitNode | null, mode: LayoutMode) => {
    const activeCanvas = canvasRef.current;
    if (!activeCanvas) return;
    window.clearTimeout(layoutTimerRef.current);
    layoutTimerRef.current = window.setTimeout(() => {
      void persistLayout(root, activeCanvas, mode).catch((cause) => setError(message(cause)));
    }, 120);
  }, [persistLayout, setError]);

  const applyLayout = (
    root: SplitNode | null,
    focus: string | null,
    mode: LayoutMode = layoutModeRef.current,
  ) => {
    setLayout(root);
    setLayoutMode(mode);
    setFocusedPaneId(focus);
    saveLayout(root, mode);
  };

  const rollbackOptimisticPane = (nodeId: string, previousZoomedPaneId: string | null) => {
    setNodes((current) => current.filter((candidate) => candidate.id !== nodeId));
    const nextRuntimes = { ...currentRuntimes() };
    delete nextRuntimes[nodeId];
    setRuntimes(nextRuntimes);
    setChatViews((current) => {
      const next = new Set(current);
      next.delete(nodeId);
      return next;
    });
    const nextRoot = removePane(layoutRef.current, nodeId);
    const remainingPaneIds = leaves(nextRoot);
    const nextFocus = focusedPaneIdRef.current === nodeId
      ? remainingPaneIds.at(-1) ?? null
      : focusedPaneIdRef.current;
    applyLayout(nextRoot, nextFocus, layoutModeRef.current);
    setZoomedPaneId((current) => current === nodeId ? previousZoomedPaneId : current);
  };

  const enableSmartLayout = () => {
    const viewport = readLayoutViewport(stageRef.current, layoutViewportRef.current);
    layoutViewportRef.current = viewport;
    applyLayout(buildSmartLayout(leaves(layoutRef.current), viewport), focusedPaneIdRef.current, "auto");
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (surface !== "terminal" || !stage) return;
    let frame = 0;
    const sync = () => {
      frame = 0;
      const previousViewport = layoutViewportRef.current;
      const nextViewport = readLayoutViewport(stage, previousViewport);
      layoutViewportRef.current = nextViewport;
      if (layoutModeRef.current !== "auto") return;
      const paneIds = leaves(layoutRef.current);
      if (!paneIds.length) return;
      const previousColumns = smartLayoutColumns(paneIds.length, previousViewport);
      const nextColumns = smartLayoutColumns(paneIds.length, nextViewport);
      const nextRoot = buildSmartLayout(paneIds, nextViewport);
      if (previousColumns === nextColumns && sameLayout(layoutRef.current, nextRoot)) return;
      setLayout(nextRoot);
      saveLayout(nextRoot, "auto");
    };
    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    });
    observer.observe(stage);
    sync();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [canvas?.id, saveLayout, surface]);

  const spawnShell = async (
    placement: PanePlacement = "auto",
    targetPaneId = focusedPaneIdRef.current,
    initialCommand?: string,
  ): Promise<boolean> => {
    const activeCanvas = canvasRef.current;
    const activeProject = projectRef.current;
    if (!activeCanvas || !activeProject) return false;
    setBusy(true);
    setError("");
    const nodeId = `node_${crypto.randomUUID().replaceAll("-", "")}`;
    const timestamp = new Date().toISOString();
    const nodeCount = nodesRef.current.length;
    const title = `Shell ${nodeCount + 1}`;
    const previousZoomedPaneId = zoomedPaneId;
    const optimisticNode: CanvasNode = {
      id: nodeId,
      canvasId: activeCanvas.id,
      kind: "shell_terminal",
      title,
      x: 0,
      y: 0,
      width: 600,
      height: 360,
      zIndex: nodeCount + 1,
      data: {
        adapterId: "generic-shell",
        adapterName: "Shell",
        sessionId: `pending:${nodeId}`,
        status: "starting",
        cwd: activeProject.path,
        transport: "pty",
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const optimisticRuntime: PaneRuntime = {
      nodeId,
      sessionId: `pending:${nodeId}`,
      historySessionId: `pending:${nodeId}`,
      adapterId: "generic-shell",
      structured: false,
      startedAt: timestamp,
      status: "starting",
      transcript: "Starting shell…",
      structuredLines: [],
      messages: [],
    };
    const optimisticLayout = insertPane(
      layoutRef.current,
      targetPaneId,
      nodeId,
      layoutModeRef.current,
      placement,
      readLayoutViewport(stageRef.current, layoutViewportRef.current),
    );
    setNodes((current) => [...current, optimisticNode]);
    setRuntimes((current) => ({ ...current, [nodeId]: optimisticRuntime }));
    applyLayout(optimisticLayout.root, nodeId, optimisticLayout.mode);
    if (zoomedPaneId) setZoomedPaneId(nodeId);
    try {
      const created = await createShell(activeCanvas, activeProject, nodeCount + 1, nodeId);
      setNodes((current) => current.map((candidate) => candidate.id === nodeId ? created.node : candidate));
      setRuntimes((current) => ({ ...current, [nodeId]: created.runtime }));
      setSessions((current) => [created.session, ...current]);
      if (initialCommand) terminalWrite(created.runtime, `${initialCommand}\r`);
      return true;
    } catch (cause) {
      rollbackOptimisticPane(nodeId, previousZoomedPaneId);
      setError(message(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const spawnDataPane = async (
    kind: "markdown_note" | "task_checklist" | "browser_preview",
    placement: PanePlacement = "auto",
    targetPaneId = focusedPaneIdRef.current,
  ) => {
    if (!canvas) return;
    const details = {
      markdown_note: { label: "Note", data: { markdown: "" } },
      task_checklist: { label: "Checklist", data: { items: [] } },
      browser_preview: { label: "Browser Preview", data: { url: "" } },
    }[kind];
    setBusy(true);
    setError("");
    const timestamp = new Date().toISOString();
    const nodeId = `node_${crypto.randomUUID().replaceAll("-", "")}`;
    const optimisticNode: CanvasNode = {
      id: nodeId,
      canvasId: canvas.id,
      kind,
      title: `${details.label} ${nodes.filter((item) => item.kind === kind).length + 1}`,
      x: 0,
      y: 0,
      width: 600,
      height: 360,
      zIndex: nextZIndex(nodes),
      data: details.data,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const optimisticLayout = insertPane(
      layoutRef.current,
      targetPaneId,
      nodeId,
      layoutModeRef.current,
      placement,
      readLayoutViewport(stageRef.current, layoutViewportRef.current),
    );
    setNodes((current) => [...current, optimisticNode]);
    applyLayout(optimisticLayout.root, nodeId, optimisticLayout.mode);
    try {
      const saved = await callCore<CanvasNode>("canvas_upsert_node", {
        canvasId: canvas.id,
        node: optimisticNode as unknown as JsonObject,
      });
      setNodes((current) => current.map((candidate) => candidate.id === nodeId ? saved : candidate));
    } catch (cause) {
      rollbackOptimisticPane(nodeId, zoomedPaneId);
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const createCanvas = async () => {
    if (!project) return;
    setBusy(true);
    setError("");
    try {
      const created = await callCore<Canvas>("canvas_create_project", {
        projectId: project.id,
        name: nextCanvasName(canvases),
      });
      setCanvases((current) => [...current, created]);
      setCanvasMenuId(undefined);
      await activateCanvas(created);
    } catch (cause) {
      setError(`Could not create a canvas: ${message(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const persistProject = async (nextProject: Project) => {
    const updated = await callCore<Project>("project_update", { project: nextProject });
    setProjects((current) => current.map((item) => item.id === updated.id ? updated : item));
    setProject((current) => current?.id === updated.id ? updated : current);
  };

  const saveProjectIdentity = async (icon: string, iconColor: string, agentAccess: AgentAccessMode) => {
    if (!customizeProject) return;
    setError("");
    try {
      await persistProject({ ...customizeProject, icon, iconColor, agentAccess });
    } catch (cause) {
      setError(message(cause));
      throw cause;
    }
  };

  const saveProjectAgentAccess = async (agentAccess: AgentAccessMode) => {
    if (!project || project.agentAccess === agentAccess) return;
    setError("");
    try {
      await persistProject({ ...project, agentAccess });
    } catch (cause) {
      setError(`Could not update project agent access: ${message(cause)}`);
    }
  };

  const openCanvasMenu = async (item: Canvas) => {
    if (item.id !== canvasRef.current?.id) await activateCanvas(item);
    setCanvasNameDraft(item.name);
    setCanvasMenuId(item.id);
  };

  const renameCanvas = async () => {
    const name = canvasNameDraft.trim();
    if (!canvas || !name || name === canvas.name) {
      setCanvasMenuId(undefined);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const renamed = await callCore<Canvas>("canvas_rename", { canvasId: canvas.id, name });
      setCanvases((current) => current.map((item) => item.id === renamed.id ? renamed : item));
      setCanvas(renamed);
      setCanvasMenuId(undefined);
    } catch (cause) {
      setError(`Could not rename ${canvas.name}: ${message(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteCanvas = async () => {
    const activeCanvas = canvasRef.current;
    if (!activeCanvas || canvases.length <= 1) return;
    const canvasHasRuntimes = nodesRef.current.some((node) => Boolean(currentRuntimes()[node.id]));
    if (canvasHasRuntimes) {
      setError(`Close every runtime pane on ${activeCanvas.name} before deleting the canvas.`);
      return;
    }
    if (!await requestConfirmation(
      `Delete ${activeCanvas.name}?`,
      "All panes and layout on this canvas will be removed. Project Plan tasks and session transcripts are preserved.",
    )) return;
    setBusy(true);
    setError("");
    try {
      window.clearTimeout(layoutTimerRef.current);
      window.clearTimeout(opsTimerRef.current);
      await callCore("canvas_delete", { canvasId: activeCanvas.id });
      const remaining = canvases.filter((item) => item.id !== activeCanvas.id);
      setCanvases(remaining);
      setCanvasMenuId(undefined);
      // Never leave the workspace store pointing at a deleted canvas while the
      // surviving canvas hydrates. Otherwise a failed/late save or pane launch
      // can target the removed foreign key.
      setCanvas(remaining[0]);
      await activateCanvas(remaining[0]);
    } catch (cause) {
      setError(`Could not delete ${activeCanvas.name}: ${message(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const spawnAgent = async (initialPrompt = agentPrompt, opsTask?: OpsCard, displayPrompt = initialPrompt, opsRole: OpsAgentRole = "worker", schedulerLeaseId?: string, adapterIdOverride?: string, origin?: AgentSpawnOrigin, placement: PanePlacement = "auto", bot?: BotSpawnContext, preserveTaskState = false, intent: AgentSessionIntent = "code"): Promise<boolean> => {
    const launchAdapterId = bot?.snapshot.launch.adapterId ?? adapterIdOverride ?? selectedAdapterId;
    if (!canvas || !project || !launchAdapterId) return false;
    let adapter = adapters.find((candidate) => candidate.id === launchAdapterId);
    const baseProfile = agentProfiles.find((candidate) => candidate.adapterId === launchAdapterId)
      ?? defaultAgentProfiles().find((candidate) => candidate.adapterId === launchAdapterId);
    const profile = botProfileForLaunch(baseProfile, bot?.snapshot);
    const launchConfig = agentLaunchConfig(profile, project.agentAccess, intent);
    const readinessArgs = agentReadinessArgs(profile, project.agentAccess, intent);
    if (adapter && bot) {
      try {
        const probe = await callCore<AdapterProbe>("adapter_probe", {
          adapterId: launchAdapterId,
          ...launchConfig,
        });
        adapter = { ...adapter, probe };
      } catch (cause) {
        setError(`Could not check ${bot.snapshot.name}: ${message(cause)}`);
        return false;
      }
    }
    if (!adapter || !isAdapterReady(adapter, readinessArgs)) {
      setError(`${adapter?.displayName ?? launchAdapterId} is not ready. Open Settings, rescan, and complete any sign-in or verification step.`);
      return false;
    }
    setBusy(true);
    setError("");
    const nodeId = `node_${crypto.randomUUID().replaceAll("-", "")}`;
    const callsignCanvases = canvases.map((candidate) => candidate.id === canvas.id
      ? { ...candidate, nodes: nodesRef.current }
      : candidate);
    const nodeTitle = reserveAgentCallsign(callsignCanvases, pendingAgentCallsignsRef.current);
    const initialMessages: AgentMessage[] = initialPrompt.trim()
      ? [{ id: crypto.randomUUID(), role: "user", kind: "message", text: displayPrompt.trim() }]
      : [];
    const timestamp = new Date().toISOString();
    const optimisticOpsCard = opsTask
      ? opsStateRef.current.cards.find((card) => card.id === opsTask.id)
      : undefined;
    const optimisticOpsAction = preserveTaskState ? "maintenance" : opsRole === "reviewer" ? "review" : "assign";
    const optimisticOpsEventId = opsTask
      ? `manual:${optimisticOpsAction}:${timestamp}:${nodeId}`
      : undefined;
    const pendingSessionId = `pending:${nodeId}`;
    const previousZoomedPaneId = zoomedPaneId;
    const optimisticNode: CanvasNode = {
      id: nodeId,
      canvasId: canvas.id,
      kind: "agent_terminal",
      title: nodeTitle,
      x: 0,
      y: 0,
      width: 600,
      height: 360,
      zIndex: nextZIndex(nodes),
      data: {
        adapterId: launchAdapterId,
        adapterName: adapter.displayName,
        sessionId: pendingSessionId,
        status: "starting",
        transport: "structured",
        protocol: adapter.streaming?.preferred?.protocol,
        taskId: opsTask?.id,
        taskRole: opsTask ? opsRole : undefined,
        autoCloseTaskAgent: Boolean(opsTask),
        preserveTaskState,
        schedulerLeaseId,
        parentAgentId: origin?.parentNodeId,
        parentSessionId: origin?.parentSessionId,
        autonomyDepth: origin?.autonomyDepth ?? 0,
        botSnapshot: bot?.snapshot as unknown as JsonObject | undefined,
        specialistRolePending: Boolean(bot && !initialPrompt.trim()),
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const optimisticRuntime: PaneRuntime = {
      nodeId,
      sessionId: pendingSessionId,
      historySessionId: pendingSessionId,
      adapterId: launchAdapterId,
      structured: true,
      startedAt: timestamp,
      protocol: adapter.streaming?.preferred?.protocol,
      status: "starting",
      statusSummary: opsTask ? "Preparing task workspace…" : "Connecting to agent…",
      transcript: "",
      structuredLines: [],
      messages: initialMessages,
      turnStartLine: initialPrompt.trim() ? 0 : undefined,
      botProfileId: bot?.snapshot.profileId,
    };
    const optimisticLayout = insertPane(
      layoutRef.current,
      focusedPaneIdRef.current,
      nodeId,
      layoutModeRef.current,
      placement,
      readLayoutViewport(stageRef.current, layoutViewportRef.current),
    );
    setNodes((current) => [...current, optimisticNode]);
    setRuntimes((current) => ({ ...current, [nodeId]: optimisticRuntime }));
    setChatViews((current) => new Set(current).add(nodeId));
    setAgentPrompt("");
    applyLayout(optimisticLayout.root, nodeId, optimisticLayout.mode);
    if (zoomedPaneId) setZoomedPaneId(nodeId);
    if (optimisticOpsCard) {
      changeOps((current) => preserveTaskState ? {
        ...current,
        cards: current.cards.map((card) => card.id === optimisticOpsCard.id
          ? appendOpsTaskEvent({
              ...card,
              taskLane: card.taskLane?.cleanup ? {
                ...card.taskLane,
                cleanup: { ...card.taskLane.cleanup, agentId: nodeId },
              } : card.taskLane,
            }, {
              id: optimisticOpsEventId!,
              kind: "assignment",
              timestamp,
              message: `Assigned ${nodeTitle} to resolve task worktree cleanup`,
              targetId: nodeId,
            })
          : card),
      } : applyOpsOrchestration(
        current,
        optimisticOpsCard.id,
        optimisticOpsAction as OpsOrchestrationAction,
        nodeId,
        nodeTitle,
        timestamp,
      ));
    }
    let session: Session | undefined;
    let persisted = false;
    try {
      const workspace = opsTask
        ? await ensureOpsTaskLane(opsTask)
        : { cwd: project.path, sharedNonGit: false };
      const coordination = opsTask
        ? await callCore<CoordinationBoardFiles>("coordination_board_sync", coordinationBoardSyncRequest(
            opsStateRef.current,
            project.path,
            currentRuntimes(),
            nodesRef.current,
            [nodeTitle],
          ))
        : undefined;
      const taskPrompt = opsTask && coordination
        ? opsTaskAgentPrompt(initialPrompt, opsTask, opsRole, project.path, coordination, nodeTitle)
        : initialPrompt;
      const launchPrompt = taskPrompt.trim()
        ? botStandingPrompt(taskPrompt, bot?.snapshot)
        : taskPrompt;
      session = await callCore<Session>("agent_structured_spawn", {
        req: {
          nodeId,
          nodeTitle,
          adapterId: launchAdapterId,
          intent,
          canvasId: canvas.id,
          taskId: opsTask?.id,
          parentSessionId: origin?.parentSessionId,
          autonomyDepth: origin?.autonomyDepth ?? 0,
          cwd: workspace.cwd,
          prompt: launchPrompt.trim(),
          ...launchConfig,
        },
      });
      const node = await persistNode(canvas, {
        nodeId,
        title: nodeTitle,
        kind: "agent_terminal",
        adapterId: launchAdapterId,
        adapterName: adapter?.displayName ?? launchAdapterId,
        session,
        transport: "structured",
        protocol: session.protocol ?? adapter?.streaming?.preferred?.protocol,
        messages: initialMessages,
        taskId: opsTask?.id,
        taskRole: opsTask ? opsRole : undefined,
        autoCloseTaskAgent: Boolean(opsTask),
        preserveTaskState,
        schedulerLeaseId,
        parentAgentId: origin?.parentNodeId,
        parentSessionId: origin?.parentSessionId,
        autonomyDepth: origin?.autonomyDepth ?? 0,
        botSnapshot: bot?.snapshot,
        specialistRolePending: Boolean(bot && !initialPrompt.trim()),
        zIndex: nextZIndex(nodes),
      });
      persisted = true;
      const runtime: PaneRuntime = {
        nodeId,
        sessionId: session.id,
        historySessionId: session.id,
        adapterId: launchAdapterId,
        structured: true,
        protocol: session.protocol ?? adapter?.streaming?.preferred?.protocol,
        capabilities: session.capabilities,
        runtimeInstanceId: session.runtimeInstanceId ?? session.id,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        protocolSequence: 0,
        status: initialPrompt.trim() ? "running" : "ready",
        intent: session.intent ?? intent,
        promptDeliveries: [],
        transcript: "",
        structuredLines: [],
        messages: initialMessages,
        turnStartLine: initialPrompt.trim() ? 0 : undefined,
        historyHasMore: false,
        botProfileId: bot?.snapshot.profileId,
      };
      setNodes((current) => current.map((candidate) => candidate.id === nodeId ? node : candidate));
      setRuntimes((current) => ({ ...current, [nodeId]: runtime }));
      setSessions((current) => session ? [session, ...current] : current);
      origin?.onSpawned?.(node, session);
      if (bot?.profile) {
        void callCore<BotProfile>("bot_upsert", {
          bot: botInput(bot.profile) as unknown as JsonObject,
          recordLaunch: true,
        }).then((updated) => setBots((current) => current.map((item) => item.id === updated.id ? updated : item)))
          .catch((cause) => setError(`Agent started, but bot activity could not be recorded: ${message(cause)}`));
      }
      if (opsTask && workspace.sharedNonGit) {
        changeOps((current) => {
          const timestamp = new Date().toISOString();
          return {
            ...current,
            cards: current.cards.map((card) => card.id === opsTask.id
              ? appendOpsTaskEvent({
                  ...card,
                  lastNote: "Started in the shared checkout because this project is not a Git repository.",
                }, {
                  id: `manual:shared-non-git:${timestamp}`,
                  kind: "update",
                  timestamp,
                  message: "Started in shared checkout (non-Git project)",
                })
              : card),
          };
        });
      }
      void (async () => {
        for (let attempt = 0; attempt < 20; attempt++) {
          if (attempt) await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
          const recovered = await callCore<SessionTranscriptPage>("session_transcript_page", {
            sessionId: runtime.sessionId,
            limit: 500,
          }).catch(() => undefined);
          const lines = recovered?.text.split(/\r?\n/).filter(Boolean) ?? [];
          if (!lines.some((line) => line.trimStart().startsWith("{"))) continue;
          const hydratedRuntime = {
            ...runtime,
            transcript: recovered!.text,
            structuredLines: lines,
            protocolSequence: recovered?.endSeq ?? lines.length,
            historyBeforeSeq: recovered?.startSeq,
            historyHasMore: recovered?.hasMore ?? false,
          };
          setRuntimes((current) => current[nodeId]?.sessionId === runtime.sessionId ? ({
            ...current,
            [nodeId]: {
              ...current[nodeId],
              transcript: recovered!.text,
              structuredLines: lines,
              protocolSequence: recovered?.endSeq ?? lines.length,
              historyBeforeSeq: recovered?.startSeq,
              historyHasMore: recovered?.hasMore ?? false,
            },
          }) : current);
          scheduleStructuredParse(hydratedRuntime, lines);
          return;
        }
      })();
      return true;
    } catch (cause) {
      if (session) {
        void callCore("session_kill", { sessionId: session.id, terminationReason: "canceled" }).catch(() => undefined);
      }
      if (persisted) void callCore("canvas_delete_node", { canvasId: canvas.id, nodeId }).catch(() => undefined);
      rollbackOptimisticPane(nodeId, previousZoomedPaneId);
      if (optimisticOpsCard && optimisticOpsEventId) {
        changeOps((current) => rollbackOptimisticOpsAgentStart(
          current,
          optimisticOpsCard,
          nodeId,
          optimisticOpsEventId,
          opsRole,
          preserveTaskState,
        ));
      }
      setError(message(cause));
      return false;
    } finally {
      pendingAgentCallsignsRef.current.delete(nodeTitle);
      setBusy(false);
    }
  };

  const saveBot = async (input: BotProfileInput): Promise<BotProfile> => {
    const saved = await callCore<BotProfile>("bot_upsert", {
      bot: input as unknown as JsonObject,
      recordLaunch: false,
    });
    setBots((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    return saved;
  };

  const specialistReadiness = useCallback(async (draft: BotProfileInput): Promise<SpecialistReadiness> => {
    const activeProject = projectRef.current;
    const adapter = adapters.find((candidate) => candidate.id === draft.launch.adapterId);
    if (!adapter || !activeProject) return { label: "Unavailable", message: "Open a project and choose an installed coding agent." };
    const baseProfile = agentProfilesRef.current.find((candidate) => candidate.adapterId === draft.launch.adapterId)
      ?? defaultAgentProfiles().find((candidate) => candidate.adapterId === draft.launch.adapterId);
    const profile = botProfileForLaunch(baseProfile, botSnapshotFromDraft(draft, draft.id ? "saved" : "one-off"));
    const launchConfig = agentLaunchConfig(profile, activeProject.agentAccess);
    const probe = await callCore<AdapterProbe>("adapter_probe", {
      adapterId: draft.launch.adapterId,
      ...launchConfig,
    });
    const label = adapterReadinessLabel({ ...adapter, probe }, launchConfig.args);
    return {
      label: label === "Ready" ? "Ready" : ["Verify", "Reverify"].includes(label) ? "Verify" : "Unavailable",
      message: probe.message,
    };
  }, [adapters]);

  const verifySpecialist = useCallback(async (draft: BotProfileInput): Promise<SpecialistReadiness> => {
    const activeProject = projectRef.current;
    const adapter = adapters.find((candidate) => candidate.id === draft.launch.adapterId);
    if (!adapter || !activeProject) return { label: "Unavailable", message: "Open a project and choose an installed coding agent." };
    const baseProfile = agentProfilesRef.current.find((candidate) => candidate.adapterId === draft.launch.adapterId)
      ?? defaultAgentProfiles().find((candidate) => candidate.adapterId === draft.launch.adapterId);
    const profile = botProfileForLaunch(baseProfile, botSnapshotFromDraft(draft, draft.id ? "saved" : "one-off"));
    const launchConfig = agentLaunchConfig(profile, activeProject.agentAccess);
    const probe = await callCore<AdapterProbe>("adapter_verify", {
      adapterId: draft.launch.adapterId,
      cwd: activeProject.path,
      ...launchConfig,
    });
    const label = adapterReadinessLabel({ ...adapter, probe }, launchConfig.args);
    return {
      label: label === "Ready" ? "Ready" : ["Verify", "Reverify"].includes(label) ? "Verify" : "Unavailable",
      message: probe.message,
    };
  }, [adapters]);

  const defaultBotDraft = (scope: BotProfileInput["scope"] = project ? "project" : "global"): BotProfileInput => {
    const profile = agentProfiles.find((candidate) => candidate.adapterId === selectedAdapterId)
      ?? defaultAgentProfiles().find((candidate) => candidate.adapterId === selectedAdapterId)
      ?? defaultAgentProfiles()[0];
    return {
      scope,
      projectId: scope === "project" ? project?.id : undefined,
      name: "",
      roleDescription: "",
      avatarSeed: `bot_${crypto.randomUUID().replaceAll("-", "")}`,
      launch: {
        adapterId: profile.adapterId,
        provider: profile.provider || undefined,
        model: profile.model || undefined,
        thinking: profile.thinking,
      },
    };
  };

  const dismissSpecialistDialog = () => {
    specialistDialog?.resolve?.(false);
    setSpecialistDialog(undefined);
  };

  const handleSpecialistAction = async (action: SpecialistDialogAction, draft: BotProfileInput) => {
    const request = specialistDialog;
    if (!request) return;
    let saved: BotProfile | undefined;
    if (action === "save" || action === "save-and-launch") {
      saved = await saveBot(draft);
      if (action === "save-and-launch") {
        setSpecialistDialog((current) => current === request ? {
          ...current,
          key: crypto.randomUUID(),
          initial: botInput(saved!),
        } : current);
      }
    }
    if (action === "launch-once" || action === "save-and-launch") {
      if (!request.launch) throw new Error("This specialist has no launch target.");
      const snapshot = saved ? botSnapshot(saved) : botSnapshotFromDraft(draft, "one-off");
      const started = await spawnAgent(
        request.launch.initialPrompt,
        request.launch.opsTask,
        request.launch.displayPrompt,
        request.launch.opsRole,
        undefined,
        snapshot.launch.adapterId,
        undefined,
        request.launch.placement,
        { snapshot, profile: saved },
      );
      if (!started) throw new Error(saved ? `${saved.name} was saved, but the agent could not start. Fix the launch profile and retry.` : "The specialist could not start. Fix the launch profile and retry.");
    }
    request.resolve?.(true);
    setSpecialistDialog(undefined);
  };

  const openCreateBot = (launch?: SpecialistDialogState["launch"]) => {
    setSpecialistDialog({
      key: crypto.randomUUID(),
      intent: "create",
      initial: defaultBotDraft(),
      allowLaunch: Boolean(launch),
      launch,
    });
  };

  const openSaveOneOff = (snapshot: BotSnapshot) => {
    setSpecialistDialog({
      key: crypto.randomUUID(),
      intent: "save-one-off",
      initial: {
        scope: project ? "project" : "global",
        projectId: project?.id,
        name: snapshot.name,
        roleDescription: snapshot.roleDescription,
        avatarSeed: snapshot.avatarSeed,
        launch: { ...snapshot.launch },
      },
      allowLaunch: false,
    });
  };

  const startSavedBot = async (profile: BotProfile) => {
    if (!project || !canvas) {
      setError("Open a project before starting a bot.");
      return;
    }
    setSurface("terminal");
    await spawnAgent("", undefined, "", "worker", undefined, profile.launch.adapterId, undefined, "auto", {
      snapshot: botSnapshot(profile),
      profile,
    });
  };

  const deleteSavedBot = async (profile: BotProfile) => {
    if (!await requestConfirmation(`Delete ${profile.name}?`, "Running and historical sessions keep their saved bot snapshot. This removes the reusable profile from your roster.")) return;
    const result = await callCore<{ deleted: boolean }>("bot_delete", { botId: profile.id });
    if (result.deleted) setBots((current) => current.filter((item) => item.id !== profile.id));
  };

  const closePane = async (
    nodeId: string,
    { completedTaskCleanup = false }: { completedTaskCleanup?: boolean } = {},
  ) => {
    if (!canvas) return;
    const runtime = runtimes[nodeId];
    const schedulerLeaseId = stringValue(nodeById[nodeId]?.data, "schedulerLeaseId");
    const assignedTask = runtime?.structured
      ? opsStateRef.current.cards.find((card) => card.assigneeIds.includes(nodeId) || card.reviewerId === nodeId)
      : undefined;
    const assignedColumnRole = opsStateRef.current.columns.find((column) => column.id === assignedTask?.columnId)?.role;
    const taskIsComplete = completedTaskCleanup || assignedColumnRole === "done";
    if (
      runtime &&
      ["running", "starting", "needs_input"].includes(runtime.status) &&
      !taskIsComplete &&
      !await requestConfirmation(
        assignedTask ? `Close ${nodeById[nodeId]?.title ?? "this agent"} without a handoff?` : `Stop ${nodeById[nodeId]?.title ?? "this session"}?`,
        assignedTask
          ? `This agent still owns “${assignedTask.title}”. Use Prepare handoff from the pane menu first if current progress is not recorded. Closing now preserves task history${assignedTask.taskLane && !assignedTask.taskLane.closedAt ? ", its task worktree, and all lane changes" : ""} and moves it to Needs you.`
          : "This session is still running. Stop the native session and close its workspace pane? Transcript history will be kept.",
      )
    ) return;
    setBusy(true);
    try {
      await flushAgentComposition(nodeId);
      if (runtime?.terminalSessionId) {
        await writeQueuesRef.current[runtime.terminalSessionId]?.catch(() => undefined);
        await callCore("pty_kill", { sessionId: runtime.terminalSessionId }).catch(() => undefined);
        delete writeQueuesRef.current[runtime.terminalSessionId];
      }
      if (runtime?.sessionId) {
        await writeQueuesRef.current[runtime.sessionId]?.catch(() => undefined);
        await callCore("session_kill", {
          sessionId: runtime.sessionId,
          terminationReason: taskIsComplete || runtime.status === "completed" ? "completed" : "canceled",
        });
        delete writeQueuesRef.current[runtime.sessionId];
      }
      if (assignedTask && runtime && !taskIsComplete && ["running", "starting", "needs_input"].includes(runtime.status)) {
        const timestamp = new Date().toISOString();
        changeOps((current) => ({
          ...current,
          cards: current.cards.map((card) => card.id === assignedTask.id
            ? appendOpsTaskEvent({
                ...card,
                agentStatuses: { ...card.agentStatuses, [nodeId]: "disconnected" },
                lastNote: "Agent terminal closed before task completion.",
              }, {
                id: `manual:close:${timestamp}:${nodeId}`,
                kind: "blocker",
                timestamp,
                callsign: nodeId,
                message: "Agent terminal closed before task completion",
              })
            : card),
        }));
      }
      if (schedulerLeaseId && !schedulerFinalizedLeaseIdsRef.current.has(schedulerLeaseId)) {
        const schedulerState = taskIsComplete || runtime?.status === "completed" ? "completed" : "released";
        await callCore("ops_scheduler_finish", {
          leaseId: schedulerLeaseId,
          ownerId: schedulerOwnerIdRef.current,
          state: schedulerState,
        }).catch(() => callCore("ops_scheduler_recover", { leaseId: schedulerLeaseId, state: schedulerState }));
        schedulerFinalizedLeaseIdsRef.current.add(schedulerLeaseId);
      }
      await callCore("canvas_delete_node", {
        canvasId: canvas.id,
        nodeId,
        selectedNodeIds: [],
        focusedNodeId: null,
      });
      void callCore("attachment_gc", {}).catch(() => undefined);
      const prunedRoot = removePane(layoutRef.current, nodeId);
      const nextRoot = layoutModeRef.current === "auto"
        ? buildSmartLayout(
            leaves(prunedRoot),
            readLayoutViewport(stageRef.current, layoutViewportRef.current),
          )
        : prunedRoot;
      const remainingPaneIds = leaves(nextRoot);
      const nextFocus = focusedPaneIdRef.current && remainingPaneIds.includes(focusedPaneIdRef.current)
        ? focusedPaneIdRef.current
        : remainingPaneIds[0] ?? null;
      if (zoomedPaneId === nodeId) setZoomedPaneId(null);
      setNodes((current) => current.filter((node) => node.id !== nodeId));
      setRuntimes((current) => {
        const next = { ...current };
        delete next[nodeId];
        return next;
      });
      if (runtime?.sessionId) {
        const nextSessions = await callCore<Session[]>("session_list", { limit: 100 }).catch(() => undefined);
        if (nextSessions) setSessions(nextSessions);
      }
      applyLayout(nextRoot, nextFocus);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const terminalWrite = (runtime: PaneRuntime, data: string | Uint8Array) => {
    const sessionId = runtime.terminalSessionId ?? (!runtime.structured ? runtime.sessionId : undefined);
    if (!sessionId) return;
    inputSentAtRef.current[sessionId] = performance.now();
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const previous = writeQueuesRef.current[sessionId] ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(() => callCore<void>("pty_write", {
      sessionId,
      dataBase64: encodeBase64(bytes),
    }));
    writeQueuesRef.current[sessionId] = pending;
    void pending.catch((cause) => setError(message(cause))).finally(() => {
      if (writeQueuesRef.current[sessionId] === pending) delete writeQueuesRef.current[sessionId];
    });
  };

  const terminalResize = (runtime: PaneRuntime, rows: number, cols: number) => {
    const sessionId = runtime.terminalSessionId ?? (!runtime.structured ? runtime.sessionId : undefined);
    if (!sessionId) return;
    void callCore("pty_resize", { sessionId, rows, cols }).catch(
      (cause) => setError(message(cause)),
    );
  };

  const terminalViewport = async (runtime: PaneRuntime, displayOffset: number) => {
    const sessionId = runtime.terminalSessionId ?? (!runtime.structured ? runtime.sessionId : undefined);
    if (!sessionId) return;
    try {
      const frame = await callCore<TerminalFrame>("terminal_viewport", {
        sessionId,
        displayOffset,
      });
      setRuntimes((current) => ({
        ...current,
        [runtime.nodeId]: {
          ...current[runtime.nodeId],
          frame,
          frameReceivedAt: performance.now(),
        },
      }));
    } catch (cause) {
      setError(message(cause));
    }
  };

  const toggleAgentView = async (runtime: PaneRuntime) => {
    if (!supportsAttachedTerminal(runtime) || terminalAttachPendingRef.current.has(runtime.nodeId)) return;
    terminalAttachPendingRef.current.add(runtime.nodeId);
    try {
      if (runtime.terminalSessionId) {
        setChatViews((current) => new Set(current).add(runtime.nodeId));
        setRuntimes((current) => ({
          ...current,
          [runtime.nodeId]: {
            ...current[runtime.nodeId],
            terminalSessionId: undefined,
            frame: undefined,
            frameReceivedAt: undefined,
          },
        }));
        await callCore("pty_kill", { sessionId: runtime.terminalSessionId }).catch(() => undefined);
        return;
      }
      const attached = await callCore<Session>("agent_structured_terminal_attach", {
        sessionId: runtime.sessionId,
      });
      setRuntimes((current) => ({
        ...current,
        [runtime.nodeId]: {
          ...current[runtime.nodeId],
          terminalSessionId: attached.id,
          frame: undefined,
          frameReceivedAt: undefined,
        },
      }));
      setChatViews((current) => {
        const next = new Set(current);
        next.delete(runtime.nodeId);
        return next;
      });
    } catch (cause) {
      setError(`Could not open the attached terminal: ${message(cause)}`);
    } finally {
      terminalAttachPendingRef.current.delete(runtime.nodeId);
    }
  };

  const sendAgentPrompt = async (runtime: PaneRuntime, prompt: string, displayPrompt = prompt, images: AgentImageAttachment[] = []) => {
    if (!project || !canvas || (!prompt.trim() && !images.length)) return false;
    if (runtime.structured && runtime.status === "disconnected") {
      return resumeAgent(runtime, prompt, displayPrompt, images);
    }
    const previousStatus = runtime.status;
    const agentNode = nodesRef.current.find((node) => node.id === runtime.nodeId);
    const snapshot = agentNode ? botSnapshotFromNode(agentNode.data) : undefined;
    const rolePending = Boolean(agentNode?.data.specialistRolePending && snapshot);
    const submittedPrompt = rolePending ? botStandingPrompt(prompt, snapshot) : prompt;
    const clientPromptId = runtime.structured ? crypto.randomUUID() : undefined;
    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      kind: "message",
      text: displayPrompt.trim(),
      images,
      deliveryId: clientPromptId,
      deliveryState: clientPromptId ? "queued" : undefined,
    };
    const nextMessages = [...runtime.messages, userMessage];
    const previousStartedAt = runtime.startedAt;
    const previousEndedAt = runtime.endedAt;
    const turnStartedAt = new Date().toISOString();
    const turnWasActive = ["starting", "running", "needs_input", "canceling"].includes(runtime.status);
    setRuntimes((current) => {
      const latest = current[runtime.nodeId];
      if (!latest) return current;
      return {
        ...current,
        [runtime.nodeId]: {
          ...latest,
          startedAt: turnStartedAt,
          endedAt: undefined,
          status: turnWasActive ? latest.status : "starting",
          statusSummary: turnWasActive ? latest.statusSummary : "Starting turn…",
          turnStartLine: latest.protocolSequence ?? latest.structuredLines.length,
          messages: mergeAgentMessages(latest.messages, [userMessage]),
        },
      };
    });
    try {
      const baseProfile = agentProfiles.find((candidate) => candidate.adapterId === runtime.adapterId);
      const profile = botProfileForLaunch(baseProfile, snapshot);
      const promptPayload = {
        sessionId: runtime.sessionId,
        nodeId: runtime.nodeId,
        adapterId: runtime.adapterId,
        prompt: submittedPrompt.trim(),
        historyText: displayPrompt.trim(),
        standingRoleApplied: rolePending,
        imagePaths: images.map((image) => image.path),
        terminalText: runtime.transcript,
        canvasId: canvas.id,
        workspacePath: project.path,
        taskId: stringValue(agentNode?.data ?? {}, "taskId") || undefined,
        ...(profile ? { provider: profile.provider, model: profile.model, thinking: profile.thinking } : {}),
        ...agentProjectAccessConfig(profile, project.agentAccess, runtime.intent ?? "code"),
      };
      const delivery = runtime.structured
        ? await callCore<PromptDelivery>("session_prompt_submit", {
            ...promptPayload,
            clientPromptId,
            mode: turnWasActive ? "next" : "auto",
          })
        : undefined;
      if (!runtime.structured) await callCore("session_prompt_send", promptPayload);
      setRuntimes((current) => {
        const latest = current[runtime.nodeId];
        if (!latest) return current;
        return {
          ...current,
          [runtime.nodeId]: {
            ...latest,
            endedAt: undefined,
            status: turnWasActive ? latest.status
              : ["needs_input", "canceling", "failed", "completed", "canceled"].includes(latest.status)
              ? latest.status
              : "running",
            messages: mergeAgentMessages(latest.messages, nextMessages),
            statusSummary: turnWasActive && delivery
              ? `Prompt #${delivery.seq} queued for the next turn.`
              : latest.status === "needs_input"
              ? latest.statusSummary
              : undefined,
          },
        };
      });
      const liveRuntime = currentRuntimes()[runtime.nodeId];
      persistAgentNodeState(
        runtime.nodeId,
        liveRuntime?.messages ?? nextMessages,
        liveRuntime?.status ?? "running",
        rolePending ? { specialistRolePending: false } : {},
      );
      return true;
    } catch (cause) {
      const detail = message(cause);
      setRuntimes((current) => {
        const latest = current[runtime.nodeId];
        if (!latest) return current;
        return {
          ...current,
          [runtime.nodeId]: {
            ...latest,
            startedAt: previousStartedAt,
            endedAt: previousEndedAt,
            status: previousStatus,
            statusSummary: detail,
            turnStartLine: runtime.turnStartLine,
            messages: latest.messages.filter((item) => item.id !== userMessage.id),
          },
        };
      });
      setError(`Prompt blocked: ${detail}`);
      return false;
    }
  };

  const prepareAgentHandoff = (runtime: PaneRuntime) => {
    const task = opsStateRef.current.cards.find((card) => card.assigneeIds.includes(runtime.nodeId) || card.reviewerId === runtime.nodeId);
    void sendAgentPrompt(runtime, task
      ? `Prepare a concise handoff for wheeljack task ${task.id}: ${task.title}. Record completed work, files changed, verification performed, blockers, and the exact next action. Do not begin new work.`
      : "Prepare a concise handoff of the current work. Record completed work, files changed, verification performed, blockers, and the exact next action. Do not begin new work.");
  };

  const respondToAgent = async (runtime: PaneRuntime, approved: boolean, response?: string) => {
    const interaction = pendingAgentInteraction(runtime.messages);
    if (!interaction) return false;
    setRuntimes((current) => ({
      ...current,
      [runtime.nodeId]: {
        ...current[runtime.nodeId],
        messages: setAgentInteractionState(current[runtime.nodeId].messages, interaction.id, "submitting"),
      },
    }));
    try {
      const answer = response?.trim() || (approved ? "Approved" : "Denied");
      await callCore("agent_structured_respond", {
        sessionId: runtime.sessionId,
        interactionId: interaction.interactionId,
        approved,
        response: answer,
        interactionState: interaction.kind === "question"
          ? approved ? "answered" : "canceled"
          : approved ? "approved" : "denied",
      });
      const interactionState = interaction.kind === "question"
        ? approved ? "answered" : "canceled"
        : approved ? "approved" : "denied";
      const liveRuntime = currentRuntimes()[runtime.nodeId] ?? runtime;
      const liveMessages = liveRuntime.messages;
      const nextMessages: AgentMessage[] = [
        ...setAgentInteractionState(liveMessages, interaction.id, interactionState),
        {
          id: crypto.randomUUID(),
          role: "user",
          kind: "interaction_response",
          text: interaction.kind === "question" ? approved ? answer : "Canceled" : approved ? "Approved" : "Denied",
        },
      ];
      const nextStatus = agentStatusAfterInteraction(liveRuntime.status, nextMessages);
      setRuntimes((current) => {
        const messages = mergeAgentMessages(current[runtime.nodeId].messages, nextMessages);
        const status = agentStatusAfterInteraction(current[runtime.nodeId].status, messages);
        return {
          ...current,
          [runtime.nodeId]: {
            ...current[runtime.nodeId],
            status,
            messages,
            statusSummary: status === current[runtime.nodeId].status ? current[runtime.nodeId].statusSummary : undefined,
          },
        };
      });
      persistAgentNodeState(runtime.nodeId, nextMessages, nextStatus);
      return true;
    } catch (cause) {
      const detail = message(cause);
      setRuntimes((current) => ({
        ...current,
        [runtime.nodeId]: {
          ...current[runtime.nodeId],
          status: "needs_input",
          statusSummary: detail,
          messages: setAgentInteractionState(current[runtime.nodeId].messages, interaction.id, "pending"),
        },
      }));
      setError(detail);
      return false;
    }
  };

  const cancelAgentTurn = async (runtime: PaneRuntime) => {
    const previousStatus = runtime.status;
    const interaction = pendingAgentInteraction(runtime.messages);
    setRuntimes((current) => ({
      ...current,
      [runtime.nodeId]: {
        ...current[runtime.nodeId],
        status: "canceling",
        statusSummary: "Stopping the current turn…",
      },
    }));
    try {
      await callCore("agent_structured_cancel", {
        sessionId: runtime.sessionId,
        interactionId: interaction?.interactionId,
      });
      if (interaction) {
        const liveMessages = currentRuntimes()[runtime.nodeId]?.messages ?? runtime.messages;
        const canceledMessages = setAgentInteractionState(liveMessages, interaction.id, "canceled");
        setRuntimes((current) => ({
          ...current,
          [runtime.nodeId]: {
            ...current[runtime.nodeId],
            messages: setAgentInteractionState(current[runtime.nodeId].messages, interaction.id, "canceled"),
          },
        }));
        persistAgentNodeState(runtime.nodeId, canceledMessages);
      }
      return true;
    } catch (cause) {
      const detail = message(cause);
      setRuntimes((current) => ({
        ...current,
        [runtime.nodeId]: {
          ...current[runtime.nodeId],
          status: previousStatus,
          statusSummary: detail,
        },
      }));
      setError(detail);
      return false;
    }
  };

  const reviewTranscript = async (runtime: PaneRuntime) => {
    const sessionId = runtime.sessionId || runtime.historySessionId;
    if (!sessionId) return;
    try {
      const transcript = await callCore<SessionTranscriptPage>("session_transcript_page", { sessionId, limit: 500 });
      const text = `Recovered transcript\n\n${transcript.text}`;
      setRuntimes((current) => ({
        ...current,
        [runtime.nodeId]: {
          ...current[runtime.nodeId],
          transcript: [current[runtime.nodeId].transcript, text].filter(Boolean).join("\n"),
          messages: current[runtime.nodeId].structured
            ? [...current[runtime.nodeId].messages, { id: crypto.randomUUID(), role: "system", kind: "status", text }]
            : current[runtime.nodeId].messages,
        },
      }));
    } catch (cause) {
      setError(`Transcript unavailable: ${message(cause)}`);
    }
  };

  const loadOlderAgentHistory = async (runtime: PaneRuntime) => {
    if (!runtime.historyHasMore || runtime.historyLoading || runtime.historyBeforeSeq === undefined) return;
    setRuntimes((current) => ({
      ...current,
      [runtime.nodeId]: { ...current[runtime.nodeId], historyLoading: true },
    }));
    try {
      const page = await callCore<SessionTranscriptPage>("session_transcript_page", {
        sessionId: runtime.historySessionId,
        beforeSeq: runtime.historyBeforeSeq,
        limit: 500,
      });
      const live = currentRuntimes()[runtime.nodeId] ?? runtime;
      const transcript = `${page.text}${live.transcript}`;
      const lines = transcript.split(/\r?\n/).filter(Boolean);
      const parsed = await callCore<AgentParseResult>("agent_protocol_parse", {
        adapterId: runtime.adapterId,
        protocol: runtime.protocol,
        nodeId: runtime.nodeId,
        lines,
        limit: Math.min(5_000, Math.max(160, lines.length)),
      });
      const messages = parsed.messages.map((item) => ({
        ...item,
        tool: item.kind === "tool" ? item.title ?? "Tool" : undefined,
        status: ["status", "approval", "question", "error"].includes(item.kind) ? item.kind : undefined,
      }));
      setRuntimes((current) => ({
        ...current,
        [runtime.nodeId]: {
          ...current[runtime.nodeId],
          transcript,
          structuredLines: lines,
          messages,
          historyBeforeSeq: page.startSeq,
          historyHasMore: page.hasMore,
          historyLoading: false,
        },
      }));
    } catch (cause) {
      setRuntimes((current) => ({
        ...current,
        [runtime.nodeId]: { ...current[runtime.nodeId], historyLoading: false },
      }));
      setError(`Earlier agent history unavailable: ${message(cause)}`);
    }
  };

  const queryAgentStatus = async (runtime: PaneRuntime) => {
    const sessionId = runtime.sessionId || runtime.historySessionId;
    if (!sessionId) return;
    try {
      const transcript = await callCore<SessionTranscriptPage>("session_transcript_page", { sessionId, limit: 50 });
      const summary = transcript.text.trim().split(/\r?\n/).filter(Boolean).slice(-3).join("\n") || "No transcript output yet.";
      setRuntimes((current) => ({
        ...current,
        [runtime.nodeId]: { ...current[runtime.nodeId], statusSummary: summary },
      }));
    } catch (cause) {
      setRuntimes((current) => ({
        ...current,
        [runtime.nodeId]: { ...current[runtime.nodeId], statusSummary: `Status unavailable: ${message(cause)}` },
      }));
    }
  };

  const resumeAgent = async (runtime: PaneRuntime, prompt = "", displayPrompt = prompt, images: AgentImageAttachment[] = []): Promise<boolean> => {
    if (!project || !canvas || !["failed", "disconnected"].includes(runtime.status)) return false;
    if (runtime.structured && runtime.capabilities?.resume === false) {
      setError(`${runtime.adapterId} does not support resumable structured sessions.`);
      return false;
    }
    const node = nodes.find((candidate) => candidate.id === runtime.nodeId);
    const snapshot = node ? botSnapshotFromNode(node.data) : undefined;
    const baseProfile = agentProfiles.find((candidate) => candidate.adapterId === runtime.adapterId);
    const profile = botProfileForLaunch(baseProfile, snapshot);
    const intent = runtime.intent ?? "code";
    const launchConfig = agentLaunchConfig(profile, project.agentAccess, intent);
    let adapter = adapters.find((candidate) => candidate.id === runtime.adapterId);
    if (adapter && snapshot) {
      const probe = await callCore<AdapterProbe>("adapter_probe", {
        adapterId: runtime.adapterId,
        ...launchConfig,
      }).catch(() => undefined);
      if (probe) adapter = { ...adapter, probe };
    }
    if (adapter && !isAdapterReady(adapter, agentReadinessArgs(profile, project.agentAccess, intent))) adapter = undefined;
    if (!node || !adapter) {
      setError(`${runtime.adapterId} is not ready. Open Settings and rescan adapters.`);
      return false;
    }
    setRuntimes((current) => ({
      ...current,
      [runtime.nodeId]: {
        ...current[runtime.nodeId],
        status: "starting",
        statusSummary: "Reconnecting agent…",
      },
    }));
    setBusy(true);
    let spawned: Session | undefined;
    try {
      const priorSessionId = runtime.sessionId || runtime.historySessionId;
      const task = opsStateRef.current.cards.find((card) =>
        card.assigneeIds.includes(runtime.nodeId) || card.reviewerId === runtime.nodeId);
      const submittedPrompt = prompt.trim() || (task
        ? `Resume wheeljack task ${task.id}: ${task.title}\n\nContinue from the saved task state and coordination history. Report new evidence or blockers before finishing.`
        : "");
      const submittedDisplayPrompt = displayPrompt.trim() || submittedPrompt;
      const rolePending = Boolean(node.data.specialistRolePending && snapshot && submittedPrompt);
      const effectivePrompt = rolePending ? botStandingPrompt(submittedPrompt, snapshot) : submittedPrompt;
      const nextMessages = submittedPrompt || images.length
        ? appendPendingAgentUserMessage(runtime.messages, {
            id: crypto.randomUUID(),
            role: "user",
            kind: "message",
            text: submittedDisplayPrompt,
            images,
          })
        : runtime.messages;
      const persistedCwd = typeof node.data.cwd === "string" ? node.data.cwd : undefined;
      const cwd = task?.taskLane
        ? (await ensureOpsTaskLane(task)).cwd
        : resolveAgentCwd(project.path, undefined, persistedCwd);
      spawned = runtime.structured
        ? await callCore<Session>("agent_structured_spawn", {
            req: {
              nodeId: runtime.nodeId,
              nodeTitle: node.title,
              adapterId: runtime.adapterId,
              intent,
              canvasId: canvas.id,
              taskId: task?.id,
              parentSessionId: stringValue(node.data, "parentSessionId") || undefined,
              autonomyDepth: numberValue(node.data, "autonomyDepth") ?? 0,
              cwd,
              prompt: effectivePrompt,
              imagePaths: images.map((image) => image.path),
              resumeSessionId: priorSessionId,
              ...launchConfig,
            },
          })
        : await callCore<Session>("pty_spawn", {
            req: { nodeId: runtime.nodeId, nodeTitle: node.title, adapterId: runtime.adapterId, args: [], cwd, rows: 24, cols: 100 },
          });
      const updated = await callCore<CanvasNode>("canvas_upsert_node", {
        canvasId: canvas.id,
        node: {
          ...node,
          data: {
            ...node.data,
            sessionId: spawned.id,
            cwd: spawned.cwd,
            status: submittedPrompt || images.length ? "running" : "ready",
            protocol: spawned.protocol ?? runtime.protocol,
            runtimeCapabilities: spawned.capabilities,
            runtimeInstanceId: spawned.runtimeInstanceId ?? spawned.id,
            intent: spawned.intent ?? intent,
            specialistRolePending: rolePending ? false : node.data.specialistRolePending,
            chatPreview: [...nextMessages].reverse().find((message) => message.text.trim())?.text.trim().slice(0, 320),
          },
          updatedAt: new Date().toISOString(),
        },
      });
      setNodes((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate));
      setSessions((current) => [spawned!, ...current]);
      setRuntimes((current) => ({
        ...current,
        [runtime.nodeId]: {
          ...current[runtime.nodeId],
          sessionId: spawned!.id,
          historySessionId: spawned!.id,
          startedAt: spawned!.startedAt,
          endedAt: spawned!.endedAt,
          protocol: spawned!.protocol ?? runtime.protocol,
          capabilities: spawned!.capabilities,
          runtimeInstanceId: spawned!.runtimeInstanceId ?? spawned!.id,
          intent: spawned!.intent ?? intent,
          protocolSequence: 0,
          status: submittedPrompt || images.length ? "running" : "ready",
          statusSummary: submittedPrompt || images.length
            ? "Session resumed and message sent."
            : "Session resumed.",
          structuredLines: [],
          messages: nextMessages,
          turnStartLine: submittedPrompt || images.length ? 0 : undefined,
        },
      }));
      return true;
    } catch (cause) {
      if (spawned) void callCore("session_kill", { sessionId: spawned.id, terminationReason: "canceled" }).catch(() => undefined);
      setRuntimes((current) => ({
        ...current,
        [runtime.nodeId]: {
          ...current[runtime.nodeId],
          status: runtime.status,
          statusSummary: message(cause),
        },
      }));
      setError(`Could not resume ${node.title}: ${message(cause)}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const savePaneData = async (node: CanvasNode, data: JsonObject) => {
    if (!canvas) return;
    try {
      const updated = await callCore<CanvasNode>("canvas_upsert_node", {
        canvasId: canvas.id,
        node: { ...node, data, updatedAt: new Date().toISOString() },
      });
      setNodes((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(`Could not save ${node.title}: ${message(cause)}`);
    }
  };

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      const inOverlay = event.composedPath().some((target) =>
        target instanceof HTMLElement &&
        ["alert-dialog-content", "command-palette-content", "popover-content", "select-content", "dropdown-menu-content", "dropdown-menu-sub-content", "context-menu-content", "sheet-content"]
          .includes(target.dataset.slot ?? ""));
      if (event.key === "Escape" && inOverlay) return;
      if (event.key === "Escape" && utilityPanelOpen) {
        setUtilityPanelOpen(false);
        event.preventDefault();
        return;
      }
      if (event.key === "Escape" && surface === "settings") {
        setSurface(previousSurfaceRef.current);
        event.preventDefault();
        return;
      }
      if ((event.target as Element | null)?.closest?.("[data-shortcut-recorder]")) return;

      const action = shortcutActionForEvent(shortcutsRef.current, event);
      if (!action) return;
      if (action === "app.commandPalette") {
        if (!commandPaletteOpen && document.querySelector('[role="alertdialog"]')) return;
        setCommandPaletteOpen((current) => !current);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (inOverlay) return;

      let handled = true;
      const direction = (value: ShortcutAction) => value.match(/(Left|Right|Up|Down)$/)![1].toLowerCase() as "left" | "right" | "up" | "down";
      switch (action) {
        case "app.home": showSurface("home"); break;
        case "app.work": showSurface("terminal"); break;
        case "app.plan": showSurface("ops"); break;
        case "app.settings": showSurface("settings"); break;
        case "app.sidebar": updatePreferences({ sidebarCollapsed: !preferencesRef.current.sidebarCollapsed }); break;
        case "app.inbox": selectUtilityPanel("inbox", true); break;
        case "app.git": selectUtilityPanel("git", true); break;
        case "app.history": selectUtilityPanel("history", true); break;
        case "project.open": void pickProject(); break;
        case "canvas.new":
          if (!project || busy) handled = false;
          else { showSurface("terminal"); void createCanvas(); }
          break;
        case "canvas.previous":
        case "canvas.next": {
          if (canvases.length < 2 || !canvas) { handled = false; break; }
          const index = canvases.findIndex((item) => item.id === canvas.id);
          const offset = action === "canvas.next" ? 1 : -1;
          void activateCanvas(canvases[(index + offset + canvases.length) % canvases.length]);
          break;
        }
        case "pane.shell":
          if (!canvas || busy) handled = false;
          else { showSurface("terminal"); void spawnShell(); }
          break;
        case "pane.agent":
          if (!canvas || busy) handled = false;
          else {
            showSurface("terminal");
            if (isAdapterReady(adapters.find((adapter) => adapter.id === selectedAdapterId), agentLaunchArgs(agentProfiles.find((profile) => profile.adapterId === selectedAdapterId)))) void spawnAgent("");
            else setAgentCreatorOpen(true);
          }
          break;
        case "pane.note":
        case "pane.checklist":
        case "pane.browser":
          if (!canvas || busy) handled = false;
          else {
            showSurface("terminal");
            void spawnDataPane(action === "pane.note" ? "markdown_note" : action === "pane.checklist" ? "task_checklist" : "browser_preview");
          }
          break;
        case "pane.splitRight":
        case "pane.splitDown":
          if (!canvas || busy) handled = false;
          else void spawnShell(action === "pane.splitRight" ? "columns" : "rows");
          break;
        case "pane.focusLeft":
        case "pane.focusRight":
        case "pane.focusUp":
        case "pane.focusDown":
          if (!focusedPaneId) handled = false;
          else setFocusedPaneId(neighborPane(focusedPaneId, direction(action)));
          break;
        case "pane.resizeLeft":
        case "pane.resizeRight":
        case "pane.resizeUp":
        case "pane.resizeDown":
          if (!layout || !focusedPaneId) handled = false;
          else applyLayout(resizePane(layout, focusedPaneId, direction(action)), focusedPaneId, "manual");
          break;
        case "pane.zoom":
          if (!focusedPaneId) handled = false;
          else setZoomedPaneId((current) => current ? null : focusedPaneId);
          break;
        case "pane.equalize":
          if (!layout) handled = false;
          else enableSmartLayout();
          break;
        case "pane.close":
          if (!focusedPaneId) handled = false;
          else void closePane(focusedPaneId);
          break;
        case "agent.focusComposer": {
          const runtime = focusedPaneId ? currentRuntimes()[focusedPaneId] : undefined;
          if (!focusedPaneId || !runtime?.structured) { handled = false; break; }
          setChatViews((current) => new Set(current).add(focusedPaneId));
          window.setTimeout(() => focusedPaneElement(focusedPaneId)?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Agent prompt"], textarea[aria-label="Answer the agent question"]')?.focus());
          break;
        }
        case "agent.stop": {
          const runtime = focusedPaneId ? currentRuntimes()[focusedPaneId] : undefined;
          if (!runtime?.structured || !["running", "starting", "needs_input"].includes(runtime.status)) handled = false;
          else void cancelAgentTurn(runtime);
          break;
        }
        case "view.zoomIn": updatePreferences({ uiScale: normalizeUiScale(preferencesRef.current.uiScale + .1) }); break;
        case "view.zoomOut": updatePreferences({ uiScale: normalizeUiScale(preferencesRef.current.uiScale - .1) }); break;
        case "view.zoomReset": updatePreferences({ uiScale: 1 }); break;
        default: handled = false;
      }
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", handleShortcut, true);
    return () => window.removeEventListener("keydown", handleShortcut, true);
  });

  const resetMetrics = () => {
    metricsRef.current = freshMetrics();
    inputSentAtRef.current = {};
    sequenceRef.current = undefined;
    setMetricVersion((value) => value + 1);
  };

  const runSixSessionGate = async () => {
    if (!canvas || !project) return;
    setBusy(true);
    setError("");
    resetMetrics();
    let nextRoot = layoutRef.current;
    let nextMode = layoutModeRef.current;
    let nextFocus = focusedPaneIdRef.current;
    const createdNodes: CanvasNode[] = [];
    const createdRuntimes: Record<string, PaneRuntime> = {};
    try {
      for (let index = 1; index <= 6; index++) {
        const created = await createShell(canvas, project, nodes.length + index);
        createdNodes.push(created.node);
        createdRuntimes[created.node.id] = created.runtime;
        const nextLayout = insertPane(
          nextRoot,
          nextFocus,
          created.node.id,
          nextMode,
          "auto",
          readLayoutViewport(stageRef.current, layoutViewportRef.current),
        );
        nextRoot = nextLayout.root;
        nextMode = nextLayout.mode;
        nextFocus = created.node.id;
      }
      setNodes((current) => [...current, ...createdNodes]);
      setRuntimes((current) => ({ ...current, ...createdRuntimes }));
      applyLayout(nextRoot, nextFocus, nextMode);
      for (const runtime of Object.values(createdRuntimes)) {
        terminalWrite(runtime, stressCommand(coreStatus?.platform ?? "windows"));
      }
      setMetricVersion((value) => value + 1);
    } catch (cause) {
      setError(`Six-session gate stopped after ${createdNodes.length} sessions: ${message(cause)}`);
      if (createdNodes.length) {
        setNodes((current) => [...current, ...createdNodes]);
        setRuntimes((current) => ({ ...current, ...createdRuntimes }));
        applyLayout(nextRoot, nextFocus, nextMode);
      }
    } finally {
      setBusy(false);
    }
  };

  const recordPaint = useCallback((runtime: PaneRuntime, milliseconds: number) => {
    const metrics = metricsRef.current;
    const now = performance.now();
    let measuredRoundTrip = false;
    metrics.framePaints.push(milliseconds);
    const inputSentAt = inputSentAtRef.current[runtime.sessionId];
    if (inputSentAt !== undefined) {
      metrics.inputPaints.push(now - inputSentAt);
      delete inputSentAtRef.current[runtime.sessionId];
      measuredRoundTrip = true;
    }
    if (
      measuredRoundTrip ||
      metrics.framePaints.length === 1 ||
      metrics.framePaints.length % 30 === 0
    ) {
      setMetricVersion((value) => value + 1);
    }
  }, []);

  const recordResizePaint = useCallback((milliseconds: number) => {
    const samples = metricsRef.current.resizePaints;
    samples.push(milliseconds);
    if (samples.length === 1 || samples.length % 30 === 0) setMetricVersion((value) => value + 1);
  }, []);

  const metricSummary = useMemo(() => {
    void metricVersion;
    const metrics = metricsRef.current;
    return {
      events: metrics.events,
      protocolUpdates: metrics.protocolUpdates,
      gaps: metrics.sequenceGaps,
      inputPaintP95: percentile(metrics.inputPaints, 0.95),
      resizePaintP95: percentile(metrics.resizePaints, 0.95),
      framePaintP95: percentile(metrics.framePaints, 0.95),
      coreP95: percentile(metrics.coreFrameBuilds, 0.95),
      inputSamples: metrics.inputPaints.length,
      resizeSamples: metrics.resizePaints.length,
      frameSamples: metrics.framePaints.length,
      elapsed: (performance.now() - metrics.startedAt) / 1000,
    };
  }, [metricVersion]);

  const navigateProject = async (nextProject: Project, nextSurface: ShellSurface, targetNodeId?: string) => {
    if (!startupReady || activatingProjectIdRef.current) return;
    if (nextProject.pathExists === false) {
      await relinkProject(nextProject);
      return;
    }
    const previousSurface = surface;
    navigationVersionRef.current++;
    const navigationVersion = navigationVersionRef.current;
    setSurface(nextSurface);
    let activated = true;
    if (project?.id !== nextProject.id) {
      activated = await activateProject(nextProject, targetNodeId);
    } else if (targetNodeId) {
      let targetCanvas = canvases.find((candidate) => candidate.nodes.some((node) => node.id === targetNodeId));
      if (!targetCanvas) {
        const refreshed = await callCore<Canvas[]>("canvas_list_project", { projectId: nextProject.id });
        setCanvases(refreshed);
        targetCanvas = refreshed.find((candidate) => candidate.nodes.some((node) => node.id === targetNodeId));
      }
      if (targetCanvas && targetCanvas.id !== canvas?.id) await activateCanvas(targetCanvas);
    }
    if (!activated) {
      if (navigationVersionRef.current === navigationVersion) setSurface(previousSurface);
      return;
    }
    if (safeStartupActive) {
      const probedAdapters = await probeAdapters(adapters, agentProfiles, nextProject.agentAccess);
      setAdapters(probedAdapters);
      selectAgentAdapter(preferredCodingAdapterId(probedAdapters, agentProfiles, selectedAdapterId));
      setSafeStartupActive(false);
      setRecoveryNoticeOpen(false);
    }
    if (nextSurface === "ops") activatePlan();
  };

  const resumeSafeStartup = async () => {
    const startupProject = projects.find((candidate) => candidate.pathExists !== false);
    if (startupProject) {
      await navigateProject(startupProject, "terminal");
      return;
    }
    const probedAdapters = await probeAdapters(adapters, agentProfiles);
    setAdapters(probedAdapters);
    selectAgentAdapter(preferredCodingAdapterId(probedAdapters, agentProfiles, selectedAdapterId));
    setSafeStartupActive(false);
    setRecoveryNoticeOpen(false);
  };

  const showSurface = (nextSurface: ShellSurface) => {
    if ((nextSurface === "terminal" || nextSurface === "ops") && !project) return;
    navigationVersionRef.current++;
    if (nextSurface === "settings") previousSurfaceRef.current = surface;
    if (nextSurface === "ops") activatePlan();
    setSurface(nextSurface);
  };

  const projectForSession = (item: Pick<Session, "nodeId" | "cwd">) => {
    const direct = projects.find((candidate) => workspacePathsEqual(candidate.path, item.cwd));
    if (direct) return direct;
    const owningCanvas = canvases.find((candidate) =>
      (candidate.id === canvas?.id ? nodes : candidate.nodes).some((node) => node.id === item.nodeId));
    if (owningCanvas) return projects.find((candidate) => candidate.id === owningCanvas.projectId);
    return project && opsStateRef.current.cards.some((card) =>
      card.taskLane && workspacePathsEqual(card.taskLane.cwd, item.cwd))
      ? project
      : undefined;
  };

  const openSession = async (session: Session) => {
    const owner = projectForSession(session);
    if (owner) await navigateProject(owner, "terminal", session.nodeId);
    setFocusedPaneId(session.nodeId);
  };

  const searchSessionHistory = async (query: string) => {
    const version = ++sessionSearchVersionRef.current;
    if (!query.trim()) {
      setSessionSearchResults([]);
      setSessionSearchBusy(false);
      return;
    }
    setSessionSearchBusy(true);
    try {
      const results = await callCore<SessionSearchResult[]>("session_search", { query: query.trim() });
      if (sessionSearchVersionRef.current === version) setSessionSearchResults(results);
    } catch (cause) {
      if (sessionSearchVersionRef.current === version) setError(`Could not search sessions: ${message(cause)}`);
    } finally {
      if (sessionSearchVersionRef.current === version) setSessionSearchBusy(false);
    }
  };

  const openHistorySession = async (item: Session | SessionSearchResult) => {
    const sessionId = "sessionId" in item ? item.sessionId : item.id;
    if (isLiveSessionStatus(item.status)) {
      const owner = projectForSession(item);
      if (owner) await navigateProject(owner, "terminal", item.nodeId);
      else setSurface("terminal");
      setFocusedPaneId(item.nodeId);
      if (compactWindow) setUtilityPanelOpen(false);
      return;
    }
    try {
      const transcript = await callCore<SessionTranscriptPage>("session_transcript_page", {
        sessionId,
        visible: item.adapterId === "generic-shell",
        limit: 500,
      });
      setUtilityPanelOpen(false);
      setHistoryTranscript({
        title: resolveAgentLabel(item.nodeTitle),
        sessionId,
        adapterId: item.adapterId,
        cwd: item.cwd,
        status: item.status,
        text: transcript.text,
        chunkCount: transcript.chunkCount,
        totalChunkCount: transcript.totalChunkCount,
        beforeSeq: transcript.startSeq,
        hasMore: transcript.hasMore,
        visible: item.adapterId === "generic-shell",
      });
    } catch (cause) {
      setError(`Transcript unavailable: ${message(cause)}`);
    }
  };

  const loadOlderHistoryTranscript = async () => {
    const current = historyTranscriptRef.current;
    if (!current?.hasMore || current.loadingOlder || current.beforeSeq === undefined) return;
    setHistoryTranscript((value) => value?.sessionId === current.sessionId
      ? { ...value, loadingOlder: true }
      : value);
    try {
      const page = await callCore<SessionTranscriptPage>("session_transcript_page", {
        sessionId: current.sessionId,
        beforeSeq: current.beforeSeq,
        visible: current.visible,
        limit: 500,
      });
      setHistoryTranscript((value) => value?.sessionId === current.sessionId
        ? {
            ...value,
            text: `${page.text}${value.text}`,
            chunkCount: value.chunkCount + page.chunkCount,
            totalChunkCount: page.totalChunkCount,
            beforeSeq: page.startSeq,
            hasMore: page.hasMore,
            loadingOlder: false,
          }
        : value);
    } catch (cause) {
      setHistoryTranscript((value) => value?.sessionId === current.sessionId
        ? { ...value, loadingOlder: false }
        : value);
      setError(`Earlier transcript unavailable: ${message(cause)}`);
    }
  };

  const openActivity = async (item: ActivityEvent) => {
    const session = sessions.find((candidate) => candidate.id === item.sessionId);
    const owner = session ? projectForSession(session) : undefined;
    if (owner) await navigateProject(owner, "terminal", item.nodeId);
    else setSurface("terminal");
    if (item.nodeId) setFocusedPaneId(item.nodeId);
    if (compactWindow) setUtilityPanelOpen(false);
  };

  const openRuntime = async (runtime: PaneRuntime) => {
    const ownerCanvas = canvasesRef.current.find((candidate) =>
      candidate.nodes.some((node) => node.id === runtime.nodeId));
    if (ownerCanvas && ownerCanvas.id !== canvasRef.current?.id) {
      await activateCanvas(ownerCanvas);
    }
    setSurface("terminal");
    setFocusedPaneId(runtime.nodeId);
    if (compactWindow) setUtilityPanelOpen(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>(`[data-pane-id="${runtime.nodeId}"] textarea[aria-label="Agent prompt"]`)?.focus();
    });
  };

  const openAttention = async (item: AttentionItem) => {
    const target = item.target;
    if (target.kind === "pane") {
      const session = sessions.find((candidate) =>
        candidate.id === target.sessionId || (!target.sessionId && candidate.nodeId === target.nodeId));
      const owner = session ? projectForSession(session) : undefined;
      if (owner) await navigateProject(owner, "terminal", target.nodeId);
      else setSurface("terminal");
      setFocusedPaneId(target.nodeId);
    } else {
      const card = opsStateRef.current.cards.find((candidate) => candidate.id === target.cardId);
      if (!card) return;
      setOpsPage("floor");
      showSurface("ops");
      if (target.kind === "review") inspectOpsTask(card);
      else setInspectedOpsCardId(card.id);
    }
    if (compactWindow) setUtilityPanelOpen(false);
  };

  const selectUtilityPanel = (nextTab: UtilityPanelTab, toggle = false) => {
    const next = toggle
      ? utilityPanelSelection(utilityPanelOpen, preferences.utilityPanelTab, nextTab)
      : { open: true, tab: nextTab };
    if (next.tab !== preferences.utilityPanelTab) updatePreferences({ utilityPanelTab: next.tab });
    setUtilityPanelOpen(next.open);
    if (next.open && (!utilityPanelOpen || preferences.utilityPanelTab !== nextTab) && (nextTab === "git" || nextTab === "history")) {
      const refresh = nextTab === "git" ? refreshProjectWorktrees() : refreshProjectData();
      void refresh.catch((cause) => setError(message(cause)));
    }
  };

  const acknowledgeActivity = async (item: ActivityEvent) => {
    const previous = activity;
    setActivity((current) => current.map((event) => event.id === item.id ? { ...event, isRead: true } : event));
    try {
      await callCore("activity_mark_read", { eventId: item.id });
    } catch (cause) {
      setActivity(previous);
      setError(`Could not mark activity as read: ${message(cause)}`);
    }
  };

  const acknowledgeAllActivity = async () => {
    const previous = activity;
    setActivity((current) => current.map((event) => event.isRead ? event : { ...event, isRead: true }));
    try {
      await callCore("activity_mark_read", { all: true });
    } catch (cause) {
      setActivity(previous);
      setError(`Could not mark activity as read: ${message(cause)}`);
    }
  };

  const clearActivityHistory = async () => {
    const previous = activity;
    setActivity([]);
    try {
      await callCore("activity_clear", {});
    } catch (cause) {
      setActivity(previous);
      setError(`Could not clear activity: ${message(cause)}`);
    }
  };

  const clearSessionTranscripts = async () => {
    await callCore("session_clear_transcripts", {});
    const nextSessions = await callCore<Session[]>("session_list", { limit: 100 });
    setSessions(nextSessions);
    setSessionSearchResults([]);
    setHistoryTranscript(undefined);
  };

  const rescanAdapters = async () => {
    setBusy(true);
    setError("");
    try {
      const detected = await callCore<Adapter[]>("adapter_detect", {});
      const probed = await probeAdapters(detected, agentProfiles, project?.agentAccess);
      setAdapters(probed);
      selectAgentAdapter(preferredCodingAdapterId(probed, agentProfiles, selectedAdapterId));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const verifyAdapter = async () => {
    if (!selectedAdapterId) return;
    setBusy(true);
    setError("");
    const profile = agentProfiles.find((candidate) => candidate.adapterId === selectedAdapterId);
    setAdapters((current) => current.map((adapter) => adapter.id === selectedAdapterId && adapter.probe
      ? { ...adapter, probe: { ...adapter.probe, verificationStatus: "verifying", message: "Verifying…" } }
      : adapter));
    try {
      const result = await callCore<AdapterProbe>("adapter_verify", {
        adapterId: selectedAdapterId,
        cwd: project?.path,
        ...agentLaunchConfig(profile, project?.agentAccess),
      });
      setAdapters((current) => current.map((adapter) =>
        adapter.id === selectedAdapterId ? { ...adapter, probe: result } : adapter));
    } catch (cause) {
      setError(`Could not verify adapter: ${message(cause)}`);
      setAdapters((current) => current.map((adapter) => adapter.id === selectedAdapterId && adapter.probe
        ? { ...adapter, probe: { ...adapter.probe, verificationStatus: "failed", message: `Verification failed: ${message(cause)}` } }
        : adapter));
    } finally {
      setBusy(false);
    }
  };

  const repairAdapter = async (adapterId = selectedAdapterId): Promise<boolean> => {
    const adapter = adapters.find((candidate) => candidate.id === adapterId);
    const profile = agentProfiles.find((candidate) => candidate.adapterId === adapterId);
    const command = adapterRepairCommand(adapter, profile);
    if (!command) {
      setError(`${adapter?.displayName ?? adapterId} has no interactive repair command.`);
      return false;
    }
    selectAgentAdapter(adapterId);
    const started = await spawnShell("auto", focusedPaneIdRef.current, command);
    if (started) setSurface("terminal");
    return started;
  };

  const persistSettings = useCallback((nextPreferences: UiPreferences, nextProfiles: AgentProfile[], nextShortcuts: ShortcutBindings) =>
    callCore("settings_import", {
      settings: {
        desktopUiPreferences: nextPreferences,
        agentProfiles: nextProfiles,
        selectedAgentAdapterId: selectedAdapterIdRef.current,
        agentAutonomyPolicy: agentAutonomyPolicyRef.current,
        shortcuts: nextShortcuts,
        theme: nextPreferences.theme === "paper" ? "mono-light" : "mono-dark",
        appFontFamily: nextPreferences.uiFontFamily,
        monoFontFamily: nextPreferences.codeFontFamily,
        fontScale: nextPreferences.uiFontSize / 13,
      },
    }), []);

  const queueSettingsSave = (nextPreferences: UiPreferences, nextProfiles: AgentProfile[], nextShortcuts: ShortcutBindings) => {
    window.clearTimeout(settingsTimerRef.current);
    settingsTimerRef.current = window.setTimeout(() => {
      void persistSettings(nextPreferences, nextProfiles, nextShortcuts).catch((cause) => setError(message(cause)));
    }, 180);
  };

  const selectAgentAdapter = (adapterId: string) => {
    selectedAdapterIdRef.current = adapterId;
    setSelectedAdapterId(adapterId);
    queueSettingsSave(preferencesRef.current, agentProfilesRef.current, shortcutsRef.current);
  };

  const updatePreferences = (patch: Partial<UiPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      preferencesRef.current = next;
      queueSettingsSave(next, agentProfilesRef.current, shortcutsRef.current);
      return next;
    });
  };

  const updateAgentProfile = (adapterId: string, patch: Partial<AgentProfile>) => {
    setAgentProfiles((current) => {
      const before = current.find((profile) => profile.adapterId === adapterId);
      const next = current.map((profile) => profile.adapterId === adapterId ? validAgentProfilePatch(profile, patch) : profile);
      const after = next.find((profile) => profile.adapterId === adapterId);
      agentProfilesRef.current = next;
      selectedAdapterIdRef.current = adapterId;
      setSelectedAdapterId(adapterId);
      setAdapters((currentAdapters) => currentAdapters.map((adapter) =>
        staleAdapterAfterProfileChange(adapter, before, after)));
      queueSettingsSave(preferencesRef.current, next, shortcutsRef.current);
      return next;
    });
  };

  const updateShortcuts = (next: ShortcutBindings) => {
    shortcutsRef.current = next;
    setShortcuts(next);
    queueSettingsSave(preferencesRef.current, agentProfilesRef.current, next);
  };

  const resetAllPreferences = async () => {
    if (!await requestConfirmation(
      "Reset all preferences?",
      "This restores appearance, workspace, keyboard shortcuts, coding-agent profiles, and autonomy policies to their defaults and removes every custom theme.",
    )) return;
    const nextPreferences: UiPreferences = {
      ...defaultUiPreferences,
      customThemes: [],
    };
    const nextProfiles = defaultAgentProfiles();
    const nextAgentAutonomyPolicy = defaultAgentAutonomyPolicy();
    const previousAgentAutonomyPolicy = agentAutonomyPolicyRef.current;
    const nextShortcuts = defaultShortcutBindingsForPlatform(coreStatus?.platform);
    window.clearTimeout(settingsTimerRef.current);
    settingsTimerRef.current = undefined;
    setResettingPreferences(true);
    setPreferencesStatus("Resetting preferences…");
    setError("");
    try {
      const nextSelectedAdapterId = preferredCodingAdapterId(adapters, nextProfiles);
      agentAutonomyPolicyRef.current = nextAgentAutonomyPolicy;
      selectedAdapterIdRef.current = nextSelectedAdapterId;
      await persistSettings(nextPreferences, nextProfiles, nextShortcuts);
      const nextAdapters = adapters.map((adapter) =>
        staleAdapterAfterProfileChange(
          adapter,
          agentProfiles.find((profile) => profile.adapterId === adapter.id),
          nextProfiles.find((profile) => profile.adapterId === adapter.id),
        ));
      setPreferences(nextPreferences);
      preferencesRef.current = nextPreferences;
      setAgentProfiles(nextProfiles);
      agentProfilesRef.current = nextProfiles;
      setAgentAutonomyPolicy(nextAgentAutonomyPolicy);
      setShortcuts(nextShortcuts);
      shortcutsRef.current = nextShortcuts;
      setAdapters(nextAdapters);
      setSelectedAdapterId(nextSelectedAdapterId);
      setPreferencesStatus("Preferences reset.");
    } catch (cause) {
      agentAutonomyPolicyRef.current = previousAgentAutonomyPolicy;
      setPreferencesStatus("Reset failed.");
      setError(`Could not reset preferences: ${message(cause)}`);
    } finally {
      setResettingPreferences(false);
    }
  };

  const saveProjectDocuments = useCallback(async (next: OpsState, activeProject: Project) => {
    const pending = documentWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const documents = projectDocumentsRef.current;
        if (!documents || documents.projectPath !== activeProject.path || documentConflict) return;
        const writes = projectSpecificationDocumentWrites(next, documents);
        if (!writes.length) {
          setDocumentSaveStatus("saved");
          return;
        }
        documentWritePendingRef.current = true;
        setDocumentSaveStatus("saving");
        try {
          const preview = await callCore<ProjectDocumentWritePreview>("project_documents_preview_write", {
            req: { projectPath: activeProject.path, writes },
          });
          const saved = await callCore<ProjectDocuments>("project_documents_commit_write", {
            req: {
              projectPath: activeProject.path,
              writes,
              confirmationToken: preview.confirmationToken,
            },
          });
          projectDocumentsRef.current = saved;
          setProjectDocuments(saved);
          setDocumentSaveStatus("saved");
        } catch (cause) {
          const disk = await callCore<ProjectDocuments>("project_documents_read", {
            projectPath: activeProject.path,
          }).catch(() => undefined);
          if (disk && projectDocumentRevisions(disk) !== projectDocumentRevisions(documents)) {
            setDocumentConflict(disk);
            setDocumentSaveStatus("conflict");
          } else {
            setDocumentSaveStatus("error");
          }
          throw cause;
        } finally {
          documentWritePendingRef.current = false;
        }
      });
    documentWriteQueueRef.current = pending;
    await pending;
  }, [documentConflict]);

  const syncOpsProjections = useCallback(async (
    next: OpsState,
    activeProject: Project,
    activeRuntimes: Record<string, PaneRuntime>,
    activeNodes: CanvasNode[],
  ) => {
    // SQLite is the live task authority. Only PRD/TDD text is mirrored to files;
    // KANBAN.md is imported/exported explicitly so task execution cannot dirty
    // the integration target checkout.
    await saveProjectDocuments(next, activeProject);
    await callCore("coordination_board_sync", coordinationBoardSyncRequest(
      next,
      activeProject.path,
      activeRuntimes,
      activeNodes,
    ));
  }, [saveProjectDocuments]);

  const queueOpsProjection = useCallback((
    next: OpsState,
    activeProject: Project,
    activeRuntimes: Record<string, PaneRuntime>,
    activeNodes: CanvasNode[],
  ) => {
    const projection = opsProjectionQueueRef.current
      .catch(() => undefined)
      .then(() => syncOpsProjections(next, activeProject, activeRuntimes, activeNodes));
    opsProjectionQueueRef.current = projection;
    return projection;
  }, [syncOpsProjections]);

  const persistOps = useCallback(async (
    next: OpsState,
    activeCanvas: Canvas,
    activeProject: Project,
    _activeRuntimes: Record<string, PaneRuntime>,
    _activeNodes: CanvasNode[],
    _activeOpsNode?: CanvasNode,
  ): Promise<OpsState> => {
    try {
      const saved = await callCore<ProjectOpsStateRecord>("ops_project_state_save", {
        projectId: activeProject.id,
        state: next,
        expectedRevision: opsRevisionByProjectRef.current.get(activeProject.id) ?? 0,
      });
      opsRevisionByProjectRef.current.set(activeProject.id, saved.revision);
      opsBaseByProjectRef.current.set(activeProject.id, next);
      return next;
    } catch (cause) {
      if (message(cause).toLowerCase().includes("revision conflict")) {
        const canonical = await callCore<ProjectOpsStateRecord | null>("ops_project_state_get", {
          projectId: activeProject.id,
        });
        if (canonical) {
          const remote = parseOpsState(canonical.state as unknown as JsonObject);
          const baseline = opsBaseByProjectRef.current.get(activeProject.id) ?? remote;
          const merged = mergeConcurrentOpsState(baseline, next, remote);
          const saved = await callCore<ProjectOpsStateRecord>("ops_project_state_save", {
            projectId: activeProject.id,
            state: merged,
            expectedRevision: canonical.revision,
          });
          opsRevisionByProjectRef.current.set(activeProject.id, saved.revision);
          opsBaseByProjectRef.current.set(activeProject.id, merged);
          if (projectRef.current?.id === activeProject.id) setOpsState(merged);
          return merged;
        }
      }
      throw new Error(`Could not save task state: ${message(cause)}`);
    }
  }, []);

  const persistOpsQueued = useCallback((
    next: OpsState,
    activeCanvas: Canvas,
    activeProject: Project,
    activeRuntimes: Record<string, PaneRuntime>,
    activeNodes: CanvasNode[],
    activeOpsNode?: CanvasNode,
    waitForProjection = true,
  ) => {
    if (!planActiveCanvasIdsRef.current.has(activeCanvas.id)) return Promise.resolve();
    const pending = opsPersistQueueRef.current
      .catch(() => undefined)
      .then(() => persistOps(next, activeCanvas, activeProject, activeRuntimes, activeNodes, activeOpsNode));
    opsPersistQueueRef.current = pending.then(() => undefined);
    const projected = pending.then(
      (saved) => queueOpsProjection(saved, activeProject, activeRuntimes, activeNodes),
      () => undefined,
    );
    if (!waitForProjection) {
      void projected.catch((cause) => setError(`Could not refresh task projections: ${message(cause)}`));
    }
    return waitForProjection ? pending.then(() => projected) : pending;
  }, [persistOps, queueOpsProjection, setError]);

  const queueOpsSave = (next: OpsState) => {
    const activeCanvas = canvasRef.current;
    const activeProject = project;
    if (!activeCanvas || !activeProject) return;
    const activeNodes = nodesRef.current;
    const activeOpsNode = opsNodeRef.current;
    window.clearTimeout(opsTimerRef.current);
    opsTimerRef.current = window.setTimeout(() => {
      void persistOpsQueued(next, activeCanvas, activeProject, runtimes, activeNodes, activeOpsNode)
        .catch((cause) => {
          setDocumentSaveStatus((current) => current === "saving" ? "error" : current);
          setError(message(cause));
        });
    }, 160);
  };

  const flushPendingSaves = useCallback(async () => {
    window.clearTimeout(layoutTimerRef.current);
    window.clearTimeout(settingsTimerRef.current);
    window.clearTimeout(opsTimerRef.current);
    const activeCanvas = canvasRef.current;
    const activeProject = projectRef.current;
    await Promise.all([
      flushAgentCompositions(),
      activeCanvas ? persistLayout(layoutRef.current, activeCanvas, layoutModeRef.current) : Promise.resolve(),
      persistSettings(preferencesRef.current, agentProfilesRef.current, shortcutsRef.current),
      activeCanvas && activeProject && planActiveCanvasIdsRef.current.has(activeCanvas.id)
        ? persistOpsQueued(opsStateRef.current, activeCanvas, activeProject, currentRuntimes(), nodesRef.current, opsNodeRef.current)
        : Promise.resolve(),
    ]);
    await opsProjectionQueueRef.current;
  }, [flushAgentCompositions, persistLayout, persistOpsQueued, persistSettings]);
  flushPendingSavesRef.current = flushPendingSaves;

  useEffect(() => {
    const listener = getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (closingRef.current) return;
      closingRef.current = true;
      try {
        await flushPendingSaves();
        await closeAfterFlush();
      } catch (cause) {
        closingRef.current = false;
        setError(`Could not close because local state was not saved: ${message(cause)}`);
      }
    });
    return () => {
      void listener.then((unlisten) => unlisten());
    };
  }, [flushPendingSaves, setError]);

  const changeOps = (change: (current: OpsState) => OpsState) => {
    activatePlan();
    setOpsState((current) => {
      const next = change(current);
      queueOpsSave(next);
      return next;
    });
  };

  async function persistOpsImmediately(change: (current: OpsState) => OpsState, waitForProjection = false): Promise<OpsState> {
    const activeCanvas = canvasRef.current;
    const activeProject = projectRef.current;
    if (!activeCanvas || !activeProject) throw new Error("Open a project before starting a task agent.");
    if (activeCanvas.projectId !== activeProject.id) throw new Error("The active task workspace no longer belongs to the opened project.");
    activatePlan(activeCanvas.id);
    window.clearTimeout(opsTimerRef.current);
    const next = change(opsStateRef.current);
    setOpsState(next);
    await persistOpsQueued(
      next,
      activeCanvas,
      activeProject,
      currentRuntimes(),
      nodesRef.current,
      opsNodeRef.current,
      waitForProjection,
    );
    return projectRef.current?.id === activeProject.id ? opsStateRef.current : next;
  }

  async function ensureOpsTaskLane(card: OpsCard): Promise<{ cwd: string; worktreePath?: string; sharedNonGit: boolean }> {
    if (!project) throw new Error("Open a project before starting a task agent.");
    const task = opsStateRef.current.cards.find((candidate) => candidate.id === card.id);
    if (!task) throw new Error("This Ops task no longer exists.");
    if (task.taskLane?.closedAt) {
      throw new Error(`The task worktree was removed on ${task.taskLane.closedAt}. Create a new task or recover branch ${task.taskLane.branch} manually.`);
    }
    if (task.taskLane) {
      const status = await callCore<GitStatus>("git_status", {
        path: project.path,
        includeWorktrees: true,
      });
      const registered = status.worktrees.find((worktree) =>
        workspacePathsEqual(worktree.path, task.taskLane!.worktreePath));
      if (!registered || registered.branch !== task.taskLane.branch) {
        throw new Error(`Task lane ${task.taskLane.branch} is missing or points at a different worktree. Restore ${task.taskLane.worktreePath} before resuming.`);
      }
      const canonicalCwd = canonicalTaskLaneCwd(project.path, status.worktrees, registered.path);
      if (!canonicalCwd || !workspacePathsEqual(task.taskLane.cwd, canonicalCwd)) {
        throw new Error(`Task lane working directory does not match its registered project-relative path: ${task.taskLane.cwd}`);
      }
      const cwdStatus = await callCore<GitStatus>("git_status", {
        path: canonicalCwd,
        includeWorktrees: false,
      });
      if (!cwdStatus.pathExists || !cwdStatus.isRepo || cwdStatus.branch !== task.taskLane.branch) {
        throw new Error(`Task lane working directory is missing or branch-mismatched: ${canonicalCwd}`);
      }
      return { cwd: canonicalCwd, worktreePath: registered.path, sharedNonGit: false };
    }
    const status = await callCore<GitStatus>("git_status", {
      path: project.path,
      includeWorktrees: false,
    });
    if (!status.isRepo) return { cwd: project.path, sharedNonGit: true };
    const created = await callCore<GitWorktreeCreateResult>("git_worktree_create", {
      req: { projectPath: project.path, taskId: task.id },
    });
    const timestamp = new Date().toISOString();
    const taskLane = {
      kind: "git-worktree" as const,
      worktreePath: created.worktree.path,
      cwd: created.cwd,
      branch: created.worktree.branch,
      baseCommit: created.baseCommit,
    };
    try {
      await persistOpsImmediately((current) => ({
        ...current,
        cards: current.cards.map((candidate) => candidate.id === task.id
          ? appendOpsTaskEvent({ ...candidate, taskLane }, {
              id: `manual:task-lane:${timestamp}`,
              kind: "update",
              timestamp,
              message: `Created task worktree ${taskLane.branch}`,
            })
          : candidate),
      }));
    } catch (cause) {
      throw new Error(`Task worktree ${taskLane.branch} was created at ${taskLane.worktreePath}, but its Ops binding could not be saved. No agent was started. ${message(cause)}`);
    }
    return { cwd: taskLane.cwd, worktreePath: taskLane.worktreePath, sharedNonGit: false };
  }

  const refreshCoordination = async () => {
    const activeCanvas = canvasRef.current;
    if (
      !project?.path
      || !activeCanvas
      || activeCanvas.projectId !== project.id
      || !planActiveCanvasIdsRef.current.has(activeCanvas.id)
      || coordinationPendingRef.current
    ) return;
    coordinationPendingRef.current = true;
    try {
      const response = await callCore<CoordinationEvents>("coordination_board_events", {
        cwd: project.path,
        cursors: opsStateRef.current.eventCursors,
      });
      if (response.warnings.length) setError(response.warnings.join("\n"));
      if (!response.events.length && JSON.stringify(response.cursors) === JSON.stringify(opsStateRef.current.eventCursors)) return;
      changeOps((current) => applyCoordinationEvents(
        current,
        response,
        opsAgentAliases(canvasesRef.current.flatMap((candidate) => candidate.nodes)
          .filter((node) => node.kind === "agent_terminal")),
      ));
    } catch (cause) {
      setError(`Could not refresh agent board events: ${message(cause)}`);
    } finally {
      coordinationPendingRef.current = false;
    }
  };

  useEffect(() => {
    if (!project?.path || !planActive) return;
    void refreshCoordination();
    void refreshProjectDocuments();
    const timer = window.setInterval(() => {
      void refreshCoordination();
      void refreshProjectDocuments();
    }, 1500);
    return () => window.clearInterval(timer);
    // Coordination state is read through refs; restart polling when the active Plan changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.path, planActive]);

  useEffect(() => {
    const card = opsState.cards.find((candidate) => {
      const directive = candidate.steeringDirective;
      if (!directive || !["queued", "delivering"].includes(directive.status)) return false;
      if (steeringDeliveryIdsRef.current.has(directive.id)) return false;
      const runtime = candidate.assigneeIds
        .map((id) => runtimes[id])
        .find((item) => item?.structured && item.status === "completed");
      return Boolean(runtime);
    });
    const directive = card?.steeringDirective;
    if (!card || !directive) return;
    const runtime = card.assigneeIds
      .map((id) => runtimes[id])
      .find((item) => item?.structured && item.status === "completed");
    if (!runtime) return;
    steeringDeliveryIdsRef.current.add(directive.id);
    void (async () => {
      const deliveryStartedAt = new Date().toISOString();
      await persistOpsImmediately((current) => ({
        ...current,
        cards: current.cards.map((candidate) => candidate.id === card.id && candidate.steeringDirective?.id === directive.id
          ? appendOpsTaskEvent({
              ...candidate,
              steeringDirective: { ...directive, status: "delivering", error: undefined },
            }, {
              id: `steering:delivering:${directive.id}`,
              kind: "update",
              timestamp: deliveryStartedAt,
              message: "Delivering queued direction for the next turn",
              targetId: runtime.nodeId,
            })
          : candidate),
      }));
      const delivered = await sendAgentPrompt(runtime, directive.text, directive.text);
      const completedAt = new Date().toISOString();
      await persistOpsImmediately((current) => ({
        ...current,
        cards: current.cards.map((candidate) => candidate.id === card.id && candidate.steeringDirective?.id === directive.id
          ? appendOpsTaskEvent({
              ...candidate,
              steeringDirective: delivered
                ? { ...directive, status: "delivered", deliveredAt: completedAt, error: undefined }
                : { ...directive, status: "failed", error: "The agent did not accept the queued direction." },
            }, {
              id: `steering:${delivered ? "delivered" : "failed"}:${directive.id}`,
              kind: delivered ? "handoff" : "blocker",
              timestamp: completedAt,
              message: delivered ? "Delivered queued direction for the next turn" : "Queued direction delivery failed",
              targetId: runtime.nodeId,
            })
          : candidate),
      }));
    })().catch((cause) => {
      const detail = message(cause);
      void persistOpsImmediately((current) => ({
        ...current,
        cards: current.cards.map((candidate) => candidate.id === card.id && candidate.steeringDirective?.id === directive.id
          ? { ...candidate, steeringDirective: { ...directive, status: "failed", error: detail } }
          : candidate),
      })).catch(() => undefined);
      setError(`Could not deliver queued direction: ${detail}`);
    }).finally(() => steeringDeliveryIdsRef.current.delete(directive.id));
    // Delivery is gated on persisted directives and a completed structured turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsState, runtimes]);

  useEffect(() => {
    const node = nodes.find((candidate) => {
      const taskId = stringValue(candidate.data, "taskId");
      const card = opsState.cards.find((item) => item.id === taskId);
      const columnRole = opsState.columns.find((column) => column.id === card?.columnId)?.role;
      const reconciliationPending = Boolean(
        card?.report
        && card.reviewPolicy !== "human"
        && !["integrated", "needs_human"].includes(card.reconciliation?.status ?? "queued"),
      );
      const steeringBlocksClose = card?.steeringDirective
        && ["queued", "delivering", "failed"].includes(card.steeringDirective.status);
      return Boolean(
        taskId
        && !steeringBlocksClose
        && !autoCloseTaskAgentIdsRef.current.has(candidate.id)
        && !reconciliationPending
        && shouldAutoCloseTaskAgent(
          candidate.data.autoCloseTaskAgent === true,
          runtimes[candidate.id]?.status,
          columnRole,
        )
      );
    });
    if (!node) return;
    const taskId = stringValue(node.data, "taskId");
    if (!taskId) return;
    autoCloseTaskAgentIdsRef.current.add(node.id);
    const cleanup = autoCloseTaskAgentQueueRef.current.catch(() => undefined).then(async () => {
      const initialCard = opsStateRef.current.cards.find((candidate) => candidate.id === taskId);
      const initialColumnRole = opsStateRef.current.columns.find((column) => column.id === initialCard?.columnId)?.role;
      if (initialColumnRole !== "done") await refreshCoordination();
      const persisted = await persistOpsImmediately((current) => {
        const role = stringValue(node.data, "taskRole");
        const card = current.cards.find((candidate) => candidate.id === taskId);
        const columnRole = current.columns.find((column) => column.id === card?.columnId)?.role;
        const moved = node.data.preserveTaskState !== true && role === "worker" && columnRole !== "review" && columnRole !== "done"
          ? applyOpsOrchestration(current, taskId, "review")
          : current;
        return {
          ...moved,
          agentLabels: { ...moved.agentLabels, [node.id]: node.title },
          cards: moved.cards.map((card) => card.id === taskId
            ? { ...card, agentStatuses: { ...card.agentStatuses, [node.id]: "completed" } }
            : card),
        };
      });
      const completedCard = persisted.cards.find((candidate) => candidate.id === taskId);
      const completedColumnRole = persisted.columns.find((column) => column.id === completedCard?.columnId)?.role;
      const schedulerLeaseId = stringValue(node.data, "schedulerLeaseId");
      if (schedulerLeaseId && !schedulerFinalizedLeaseIdsRef.current.has(schedulerLeaseId)) {
        await callCore("ops_scheduler_finish", {
          leaseId: schedulerLeaseId,
          ownerId: schedulerOwnerIdRef.current,
          state: "completed",
        }).catch(() => callCore("ops_scheduler_recover", { leaseId: schedulerLeaseId, state: "completed" }));
        schedulerFinalizedLeaseIdsRef.current.add(schedulerLeaseId);
      }
      await opsProjectionQueueRef.current.catch(() => undefined);
      await closePane(node.id, { completedTaskCleanup: completedColumnRole === "done" });
    });
    autoCloseTaskAgentQueueRef.current = cleanup;
    void cleanup.catch((cause) => setError(`Could not finish task agent cleanup: ${message(cause)}`)).finally(() => {
      autoCloseTaskAgentIdsRef.current.delete(node.id);
    });
    // Lifecycle metadata and runtime state are the only triggers; coordination uses refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, opsState, runtimes]);

  const queueOpsSteering = (
    card: OpsCard,
    text: string,
    metadata?: Pick<OpsSteeringDirective, "kind" | "conflictFiles">,
  ) => {
    const value = text.trim();
    if (!value) return;
    const currentDirective = opsStateRef.current.cards.find((candidate) => candidate.id === card.id)?.steeringDirective;
    if (currentDirective?.status === "delivering") return;
    const timestamp = new Date().toISOString();
    const directive: OpsSteeringDirective = currentDirective && ["queued", "failed"].includes(currentDirective.status) ? {
      ...currentDirective,
      text: value.slice(0, 4_000),
      status: "queued",
      kind: metadata?.kind ?? currentDirective.kind,
      conflictFiles: metadata?.conflictFiles ?? currentDirective.conflictFiles,
      error: undefined,
      deliveredAt: undefined,
    } : {
      id: crypto.randomUUID(),
      text: value.slice(0, 4_000),
      createdAt: timestamp,
      status: "queued",
      kind: metadata?.kind,
      conflictFiles: metadata?.conflictFiles,
    };
    const action = currentDirective?.status === "failed" ? "Retried" : currentDirective?.status === "queued" ? "Updated" : "Queued";
    changeOps((current) => ({
      ...current,
      cards: current.cards.map((candidate) => candidate.id === card.id
        ? appendOpsTaskEvent({ ...candidate, steeringDirective: directive }, {
            id: `steering:${action.toLowerCase()}:${directive.id}:${timestamp}`,
            kind: "update",
            timestamp,
            message: `${action} direction for the next agent turn`,
          })
        : candidate),
    }));
  };

  useEffect(() => {
    const instructions = opsAutomaticFileConflictInstructions(opsState);
    const instructionByCardId = new Map(instructions.map((instruction) => [instruction.cardId, instruction]));
    for (const card of opsState.cards) {
      const directive = card.steeringDirective;
      if (
        directive?.kind === "file_conflict"
        && ["queued", "failed"].includes(directive.status)
        && !instructionByCardId.has(card.id)
      ) cancelOpsSteering(card);
    }
    for (const instruction of instructions) {
      const card = opsState.cards.find((candidate) => candidate.id === instruction.cardId);
      if (!card) continue;
      const conflictFiles = instruction.claims.map((claim) => claim.file).sort();
      const directive = card.steeringDirective;
      const sameAutomaticDirective = opsFileConflictDirectiveIsCurrent(directive, conflictFiles);
      if (sameAutomaticDirective) continue;
      if (directive?.status === "delivering") continue;
      if (directive?.kind !== "file_conflict" && directive && ["queued", "failed"].includes(directive.status)) continue;
      const ownership = instruction.claims.map((claim) => {
        const owner = opsState.cards.find((candidate) => candidate.id === claim.ownerCardId);
        return `- ${claim.file}: ${owner?.title ?? claim.ownerCardId} (${claim.ownerCardId})`;
      }).join("\n");
      queueOpsSteering(card, [
        "wheeljack automatically resolved overlapping file ownership. Yield the claims below:",
        ownership,
        "Stop editing those files and coordinate with their elected owner tasks. Keep every other existing file claim.",
        `Then emit wheeljack.control with action resolve_file_conflict, taskId ${card.id}, and your complete remaining files list. The conflict is resolved only after wheeljack accepts that control request.`,
      ].join("\n"), { kind: "file_conflict", conflictFiles });
    }
    // Conflict claims and persisted directives fully determine the automatic arbitration queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsState]);

  const cancelOpsSteering = (card: OpsCard) => {
    const directive = card.steeringDirective;
    if (!directive || !["queued", "failed"].includes(directive.status)) return;
    const timestamp = new Date().toISOString();
    changeOps((current) => ({
      ...current,
      cards: current.cards.map((candidate) => candidate.id === card.id && candidate.steeringDirective?.id === directive.id
        ? appendOpsTaskEvent({
            ...candidate,
            steeringDirective: { ...directive, status: "canceled", error: undefined },
          }, {
            id: `steering:canceled:${directive.id}`,
            kind: "update",
            timestamp,
            message: "Canceled queued direction",
          })
        : candidate),
    }));
  };

  const generateAgentTaskCards = async (brief: string): Promise<number> => {
    if (!project) throw new Error("Open a project before creating tasks.");
    const reusableRuntime = Object.values(currentRuntimes()).find((runtime) =>
      runtime.structured
      && runtime.adapterId === selectedAdapterId
      && Boolean(runtime.sessionId)
      && ["ready", "completed"].includes(runtime.status));
    if (!reusableRuntime && !selectedAdapterReady) {
      throw new Error("Verify the default coding agent in Settings before creating tasks.");
    }

    const previous = agentTaskCardRequestRef.current;
    if (previous) {
      window.clearTimeout(previous.timeout);
      previous.reject(new Error("A newer task brief replaced this request."));
    }
    const requestId = crypto.randomUUID();
    let resolveRequest!: (count: number) => void;
    let rejectRequest!: (cause: Error) => void;
    const completion = new Promise<number>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    void completion.catch(() => undefined);
    const timeout = window.setTimeout(() => {
      const request = agentTaskCardRequestRef.current;
      if (request?.requestId !== requestId) return;
      agentTaskCardRequestRef.current = undefined;
      request.reject(new Error("The agent did not return task cards within ten minutes. Your brief is still available to retry."));
    }, 600_000);
    agentTaskCardRequestRef.current = { requestId, timeout, resolve: resolveRequest, reject: rejectRequest };

    const existingCards = opsStateRef.current.cards.map((card) => ({
      id: card.id,
      title: card.title,
      detail: card.detail,
      lane: opsStateRef.current.columns.find((column) => column.id === card.columnId)?.role ?? card.columnId,
    }));
    const prompt = [
      `Turn the following general task brief into one or more implementation-ready wheeljack backlog cards for ${project.name}.`,
      `Task brief:\n${brief.trim()}`,
      "Inspect the repository README, documentation, source, tests, and build configuration enough to ground scope and verification in real project evidence. Do not edit files or implement the task.",
      "Return the smallest coherent set of cards. Use one card when the work should stay together; split only when separate outcomes, ordering, or verification justify it. Return at most 8 cards and avoid duplicating existing work.",
      "Each card needs a unique lowercase key, a concise action title, a complete outcome-focused detail, priority (`low`, `normal`, or `high`), observable definitionOfDone, optional constraints, a repository-valid verificationCommand, and reviewPolicy (`human`, `agent`, or `either`). Default reviewPolicy to `agent`.",
      `For work that needs a distinct specialist, optionally add workerSpecialist or reviewerSpecialist with name, standing roleDescription, rationale, and an adapterId from ${JSON.stringify(readyCodingAdapters.map((adapter) => adapter.id))}. Otherwise omit it.`,
      "Use dependencyKeys for dependencies among the new cards and existingDependencyIds only for dependencies on the existing cards listed below. Dependencies must be acyclic and every referenced key or ID must exist.",
      `Existing board cards:\n${JSON.stringify(existingCards, null, 2)}`,
      "Return exactly one final control line with no prose or code fence:",
      `wheeljack.task_cards ${JSON.stringify({ requestId, cards: [{ key: "task-key", title: "Concise action title", detail: "Complete outcome and context", priority: "normal", definitionOfDone: "Observable acceptance criteria", constraints: "", verificationCommand: "repository-valid command", reviewPolicy: "agent", dependencyKeys: [], existingDependencyIds: [], workerSpecialist: { name: "Focused specialist", roleDescription: "Standing role for this task", rationale: "Why this specialization helps", adapterId: selectedAdapterId } }] })}`,
      "Replace the example card with the complete card array.",
    ].join("\n\n");
    const displayPrompt = `Create wheeljack backlog cards from this brief:\n\n${brief.trim()}`;

    let started = false;
    try {
      started = reusableRuntime
        ? await sendAgentPrompt(reusableRuntime, prompt, displayPrompt)
        : await spawnAgent(prompt, undefined, displayPrompt);
    } catch (cause) {
      const request = agentTaskCardRequestRef.current;
      if (request?.requestId === requestId) {
        window.clearTimeout(request.timeout);
        agentTaskCardRequestRef.current = undefined;
        request.reject(new Error(message(cause)));
      }
    }
    if (!started) {
      const request = agentTaskCardRequestRef.current;
      if (request?.requestId === requestId) {
        window.clearTimeout(request.timeout);
        agentTaskCardRequestRef.current = undefined;
        request.reject(new Error("The default agent could not start this task-card request."));
      }
    }
    return completion;
  };

  taskCardProposalHandlerRef.current = async (proposal) => {
    const request = agentTaskCardRequestRef.current;
    if (!request || request.requestId !== proposal.requestId) return;
    window.clearTimeout(request.timeout);
    agentTaskCardRequestRef.current = undefined;
    try {
      const additions = agentTaskCardsFromProposal(proposal, opsStateRef.current);
      await persistOpsImmediately((current) => ({ ...current, cards: [...current.cards, ...additions] }));
      request.resolve(additions.length);
    } catch (cause) {
      request.reject(new Error(`The agent returned task cards wheeljack could not add: ${message(cause)}`));
    }
  };

  const updateOpsTask = (
    card: OpsCard,
    change: Partial<Pick<OpsCard, "title" | "detail" | "definitionOfDone" | "constraints" | "verificationCommand" | "reviewPolicy">>,
  ) => {
    const invalidatesVerification = (
      ("definitionOfDone" in change && change.definitionOfDone !== card.definitionOfDone)
      || ("constraints" in change && change.constraints !== card.constraints)
      || ("verificationCommand" in change && change.verificationCommand !== card.verificationCommand)
    );
    const invalidatesApproval = invalidatesVerification
      || ("reviewPolicy" in change && change.reviewPolicy !== card.reviewPolicy);
    const update = (item: OpsCard) => item.id === card.id
      ? {
          ...item,
          ...change,
          verificationRun: invalidatesVerification ? undefined : item.verificationRun,
          approvalAttempt: invalidatesApproval ? undefined : item.approvalAttempt,
        }
      : item;
    changeOps((current) => ({ ...current, cards: current.cards.map(update) }));
    setReviewCard((current) => current?.id === card.id ? update(current) : current);
  };

  const updateAgentAutonomyPolicy = (patch: Partial<AgentAutonomyPolicy>) => {
    setAgentAutonomyPolicy((current) => {
      const next = normalizeAgentAutonomyPolicy({ ...current, ...patch });
      agentAutonomyPolicyRef.current = next;
      queueSettingsSave(preferencesRef.current, agentProfilesRef.current, shortcutsRef.current);
      return next;
    });
  };

  const queueOpsTaskLaneCleanup = async (
    card: OpsCard,
    requestedAction: NonNullable<NonNullable<OpsCard["taskLane"]>["cleanup"]>["action"],
  ) => {
    const currentCard = opsStateRef.current.cards.find((candidate) => candidate.id === card.id);
    if (!currentCard?.taskLane || currentCard.taskLane.closedAt) return;
    const timestamp = new Date().toISOString();
    const action = requestedAction;
    await persistOpsImmediately((current) => ({
      ...current,
      cards: current.cards.map((candidate) => candidate.id === card.id && candidate.taskLane
        ? appendOpsTaskEvent({
            ...candidate,
            taskLane: {
              ...candidate.taskLane,
              cleanup: { action, status: "queued", requestedAt: timestamp },
            },
            lastNote: `Queued task worktree cleanup before ${action}.`,
          }, {
            id: `manual:task-lane-cleanup:${timestamp}`,
            kind: "update",
            timestamp,
            message: `Queued task worktree cleanup before ${action}`,
          })
        : candidate),
    }));
  };

  const deleteOpsTask = async (card: OpsCard) => {
    try {
      const currentCard = opsStateRef.current.cards.find((candidate) => candidate.id === card.id);
      if (!currentCard) return;
      if (currentCard.taskLane && !currentCard.taskLane.closedAt) {
        await queueOpsTaskLaneCleanup(currentCard, "delete");
        return;
      }
      await persistOpsImmediately((current) => ({
        ...current,
        cards: current.cards.filter((item) => item.id !== card.id),
      }), true);
    } catch (cause) {
      setError(`Could not delete ${card.title}: ${message(cause)}`);
    }
  };

  const archiveDoneOpsTasks = async (cardIds: string[]) => {
    const activeRuntimes = Object.values(currentRuntimes());
    const { archiveDoneOpsCardsSafely } = await import("./opsArchive");
    const requestedIds = new Set(cardIds);
    const selected = opsStateRef.current.cards.filter((card) => requestedIds.has(card.id));
    const hasLiveAgent = (card: OpsCard) => opsCardParticipantIds(card, activeRuntimes).some((id) =>
      activeRuntimes.some((runtime) => runtime.nodeId === id && !isTerminalSessionStatus(runtime.status)));
    const laneCards = selected.filter((card) => card.taskLane && !card.taskLane.closedAt);
    const blockedCards = selected.filter((card) => !card.taskLane && hasLiveAgent(card));
    const immediateIds = selected.filter((card) => !card.taskLane && !hasLiveAgent(card)).map((card) => card.id);
    const timestamp = new Date().toISOString();
    await persistOpsImmediately((state) => {
      const queued = {
        ...state,
        cards: state.cards.map((card) => laneCards.some((candidate) => candidate.id === card.id) && card.taskLane
          ? appendOpsTaskEvent({
              ...card,
              taskLane: {
                ...card.taskLane,
                cleanup: { action: "archive", status: "queued", requestedAt: timestamp },
              },
              lastNote: "Queued task worktree cleanup before archive.",
            }, {
              id: `manual:task-lane-cleanup:${timestamp}:${card.id}`,
              kind: "update",
              timestamp,
              message: "Queued task worktree cleanup before archive",
            })
          : card),
      };
      return immediateIds.length ? archiveDoneOpsCardsSafely(queued, immediateIds, activeRuntimes) : queued;
    }, true);
    if (blockedCards.length) {
      setError(`${blockedCards.length} completed ${blockedCards.length === 1 ? "task still has" : "tasks still have"} an active agent without a task worktree.`);
    }
  };

  const restoreArchivedOpsTasks = async (cardIds: string[]) => {
    const { restoreArchivedOpsCards } = await import("./opsArchive");
    await persistOpsImmediately((state) => restoreArchivedOpsCards(state, cardIds), true);
  };

  const removeOpsTaskLane = async (card: OpsCard) => {
    if (!card.taskLane || card.taskLane.closedAt) return;
    const cleanup = card.taskLane.cleanup;
    if (!cleanup && !await requestConfirmation(
      `Resolve and remove ${card.taskLane.branch}?`,
      "wheeljack will remove the worktree as soon as it is clean. If it has local changes, the owning agent will preserve and commit valuable work first. The Git branch and task history remain available.",
    )) return;
    try {
      await queueOpsTaskLaneCleanup(card, cleanup?.action ?? "remove");
    } catch (cause) {
      setError(`Could not queue cleanup for ${card.taskLane.branch}: ${message(cause)}`);
    }
  };

  const updateOpsDocument = (kind: "prd" | "tdd", value: string) => {
    setDocumentSaveStatus("saving");
    changeOps((current) => ({ ...current, [kind]: value }));
  };

  const reviewProjectDocumentWrites = async (title: string, writes: ProjectDocumentWrite[], requireCompleteTaskContracts = false) => {
    if (!project || !writes.length) return;
    const baseline = projectDocumentsRef.current;
    try {
      const preview = await callCore<ProjectDocumentWritePreview>("project_documents_preview_write", {
        req: { projectPath: project.path, writes },
      });
      const kanbanWrite = preview.writes.find((write) => write.kind === "kanban");
      const contractIssues = requireCompleteTaskContracts && kanbanWrite
        ? kanbanVerificationContractIssues(kanbanWrite.content)
        : [];
      if (contractIssues.length) {
        throw new Error(`The agent returned incomplete task contracts for: ${contractIssues.join(", ")}. Re-run project analysis.`);
      }
      setPendingDocumentWrite({
        title,
        projectPath: project.path,
        writes: preview.writes,
        preview,
      });
    } catch (cause) {
      setError(message(cause));
      const disk = await callCore<ProjectDocuments>("project_documents_read", {
        projectPath: project.path,
      }).catch(() => undefined);
      if (disk && baseline && projectDocumentRevisions(disk) !== projectDocumentRevisions(baseline)) {
        setDocumentConflict(disk);
        setDocumentSaveStatus("conflict");
      } else {
        setDocumentSaveStatus("error");
      }
    }
  };

  const commitPendingDocumentWrite = async () => {
    if (!pendingDocumentWrite) return;
    activatePlan();
    const baseline = projectDocumentsRef.current;
    setDocumentSaveStatus("saving");
    try {
      window.clearTimeout(opsTimerRef.current);
      if (canvasRef.current && projectRef.current) {
        await persistOpsQueued(opsStateRef.current, canvasRef.current, projectRef.current, currentRuntimes(), nodesRef.current, opsNodeRef.current);
      }
      const saved = await callCore<ProjectDocuments>("project_documents_commit_write", {
        req: {
          projectPath: pendingDocumentWrite.projectPath,
          writes: pendingDocumentWrite.writes,
          confirmationToken: pendingDocumentWrite.preview.confirmationToken,
        },
      });
      projectDocumentsRef.current = saved;
      setProjectDocuments(saved);
      setDocumentConflict(undefined);
      setDocumentSaveStatus("saved");
      const merged = mergeProjectDocuments(opsStateRef.current, saved);
      setOpsState(merged);
      const activeCanvas = canvasRef.current;
      const activeProject = projectRef.current;
      if (activeCanvas && activeProject && activeProject.path === pendingDocumentWrite.projectPath) {
        await persistOpsQueued(merged, activeCanvas, activeProject, currentRuntimes(), nodesRef.current, opsNodeRef.current);
      }
      setPendingDocumentWrite(undefined);
    } catch (cause) {
      setError(message(cause));
      setPendingDocumentWrite(undefined);
      if (project) {
        const disk = await callCore<ProjectDocuments>("project_documents_read", {
          projectPath: project.path,
        }).catch(() => undefined);
        if (disk && baseline && projectDocumentRevisions(disk) !== projectDocumentRevisions(baseline)) {
          setDocumentConflict(disk);
          setDocumentSaveStatus("conflict");
        } else {
          setDocumentSaveStatus("error");
        }
      }
    }
  };

  const createProjectDocument = (kind: ProjectDocumentKind) => {
    const documents = projectDocumentsRef.current;
    const document = documents?.documents[kind];
    if (!documents || !document || document.exists) return;
    const content = kind === "kanban"
      ? renderKanban(opsStateRef.current)
      : opsStateRef.current[kind] || projectDocumentTemplate(kind, project?.name ?? "Project");
    void reviewProjectDocumentWrites(`Create ${projectDocumentName(kind)}`, [{
      kind,
      content,
      expectedRevision: document.revision,
    }]);
  };

  const normalizeKanban = () => {
    const document = projectDocumentsRef.current?.documents.kanban;
    if (!document) return;
    const importing = document.exists && document.format === "importable";
    void reviewProjectDocumentWrites(importing ? "Import KANBAN.md into Plan" : "Export Plan snapshot to KANBAN.md", [{
      kind: "kanban",
      content: importing ? document.content : renderKanban(opsStateRef.current),
      expectedRevision: document.revision,
    }]);
  };

  const migrateLegacyOps = () => {
    const documents = projectDocumentsRef.current;
    if (!documents) return;
    const writes: ProjectDocumentWrite[] = [];
    if (!documents.documents.kanban.exists && opsStateRef.current.cards.length) {
      writes.push({
        kind: "kanban",
        content: renderKanban(opsStateRef.current),
        expectedRevision: documents.documents.kanban.revision,
      });
    }
    for (const kind of ["prd", "tdd"] as const) {
      if (!documents.documents[kind].exists && opsStateRef.current[kind]) {
        writes.push({
          kind,
          content: opsStateRef.current[kind],
          expectedRevision: documents.documents[kind].revision,
        });
      }
    }
    if (!writes.length) {
      setError("There is no legacy Ops content to migrate.");
      return;
    }
    void reviewProjectDocumentWrites("Migrate legacy Ops files", writes);
  };

  const reloadProjectDocuments = () => {
    if (!documentConflict) return;
    window.clearTimeout(opsTimerRef.current);
    projectDocumentsRef.current = documentConflict;
    setProjectDocuments(documentConflict);
    const merged = mergeProjectSpecificationDocuments(opsStateRef.current, documentConflict);
    setOpsState(merged);
    setDocumentConflict(undefined);
    setDocumentSaveStatus("saved");
  };

  const overwriteProjectDocuments = () => {
    if (!documentConflict) return;
    window.clearTimeout(opsTimerRef.current);
    const writes = projectSpecificationDocumentWrites(opsStateRef.current, documentConflict, true);
    if (!writes.length) return;
    void reviewProjectDocumentWrites("Overwrite changed project files", writes);
  };

  const generateOpsDocument = (kind: "prd" | "tdd") => {
    const document = projectDocumentsRef.current?.documents[kind];
    if (!document?.exists) return;
    void reviewProjectDocumentWrites(`Replace ${projectDocumentName(kind)} with a template`, [{
      kind,
      content: projectDocumentTemplate(kind, project?.name ?? "Project"),
      expectedRevision: document.revision,
    }]);
  };

  const generateProjectDocumentWithAgent = async (kind: ProjectDocumentKind | "bundle") => {
    const documents = projectDocumentsRef.current;
    const runtime = Object.values(runtimes).find((candidate) => candidate.structured && candidate.sessionId);
    if (!project || !documents) return;
    if (!runtime && kind !== "bundle") {
      setError("Start a structured agent before generating a project document.");
      return;
    }
    if (!runtime && !selectedAdapterReady) {
      setError("Verify a coding agent in Settings before bootstrapping this project.");
      return;
    }
    const prior = agentDocumentRequestRef.current;
    if (prior) window.clearTimeout(prior.timeout);
    const requestId = crypto.randomUUID();
    const allKinds: ProjectDocumentKind[] = ["kanban", "prd", "tdd"];
    const missingKinds = allKinds.filter((candidate) => !documents.documents[candidate].exists);
    const doneColumnIds = new Set(opsStateRef.current.columns.filter((column) => column.role === "done").map((column) => column.id));
    const incompleteContractCards = opsStateRef.current.cards.filter((card) =>
      !doneColumnIds.has(card.columnId) && opsVerificationContractIssues(card).length > 0);
    const bundleKinds = missingKinds.length
      ? allKinds.filter((candidate) => missingKinds.includes(candidate) || (candidate === "kanban" && incompleteContractCards.length > 0))
      : allKinds;
    const kinds = kind === "bundle" ? bundleKinds : [kind];
    const timeout = window.setTimeout(() => {
      const request = agentDocumentRequestRef.current;
      if (request?.requestId !== requestId) return;
      agentDocumentRequestRef.current = undefined;
      const documents = projectDocumentsRef.current;
      const completedKinds = request.kinds.filter((documentKind) => typeof request.contents[documentKind] === "string");
      if (documents && completedKinds.length) {
        void reviewProjectDocumentWrites(
          request.kind === "bundle" ? "Review partial agent project plan" : `Review agent ${projectDocumentName(request.kind)}`,
          completedKinds.map((documentKind) => ({
            kind: documentKind,
            content: request.contents[documentKind]!,
            expectedRevision: documents.documents[documentKind].revision,
          })),
          request.kind === "kanban" || completedKinds.includes("kanban"),
        );
        setError(`The agent returned ${completedKinds.length} of ${request.kinds.length} requested project documents within ten minutes. The completed proposals are ready for review.`);
        return;
      }
      setError(`The agent did not return ${kind === "bundle" ? "the project plan" : projectDocumentName(kind)} within ten minutes.`);
    }, 600_000);
    agentDocumentRequestRef.current = { requestId, kind, kinds, contents: {}, timeout };
    const prompt = kind === "bundle"
      ? [
          `Analyze the current repository state for ${project.name}, then draft one coherent project plan.`,
          "Inspect the README, documentation, source, tests, build files, and Git status. Ground claims in repository evidence and mark unknowns explicitly.",
          "PRD.md must describe the current product reality, intended outcome, workflows, constraints, and acceptance criteria. TDD.md must describe the current architecture, contracts, risks, and validation.",
          "KANBAN.md must contain only remaining work and identified gaps, not reconstructed completed work. Use wheeljack v1 markdown with `wheeljack-kanban: 1` frontmatter and `<!-- wheeljack:column {\"id\":\"...\",\"role\":\"queued|active|review|done\"} -->` beneath every column heading. Keep the Done column empty.",
          "For each Kanban card, use a concise action title on the `- [ ]` line (roughly 3-7 words) and put the full objective and context in indented description lines below it. Never put the description in the title.",
          "Every non-Done Kanban card must have one `wheeljack:task` metadata comment with a stable id, priority, assignee, non-empty observable definitionOfDone, optional constraints, repository-valid non-empty verificationCommand, and reviewPolicy (`human`, `agent`, or `either`). Default to agent review. Example: `<!-- wheeljack:task {\"id\":\"stable-task-id\",\"priority\":\"normal\",\"assignee\":\"Unassigned\",\"definitionOfDone\":\"Observable acceptance criteria\",\"constraints\":\"\",\"verificationCommand\":\"bun run test\",\"reviewPolicy\":\"agent\"} -->`.",
          "Preserve the IDs and existing non-empty contract fields of current cards. Fill every missing definitionOfDone or verificationCommand using repository evidence; never use placeholder text or a command that is not valid for this repository.",
          "Keep each document under 12,000 characters and the combined markdown under 36,000 characters. Prefer concise verified decisions, contracts, and remaining work over repository narration.",
          incompleteContractCards.length ? `Cards requiring contract backfill:\n${JSON.stringify(incompleteContractCards.map((card) => ({ id: card.id, title: card.title, detail: card.detail, definitionOfDone: card.definitionOfDone ?? "", verificationCommand: card.verificationCommand ?? "" })), null, 2)}` : "No existing cards require contract backfill.",
          `Do not edit files. Return exactly ${kinds.length} final control ${kinds.length === 1 ? "line" : "lines"}, one for each requested document, with no prose or code fences. Emit each line as soon as that document is complete:`,
          ...kinds.map((documentKind) => `wheeljack.project_document ${JSON.stringify({ requestId, kind: documentKind, content: `<complete ${projectDocumentName(documentKind)} markdown>` })}`),
          "Replace every placeholder with that complete document as a JSON string. Preserve useful facts from existing project-plan documents.",
        ].join("\n\n")
      : [
          `Draft the complete ${projectDocumentName(kind)} for ${project.name}.`,
          kind === "kanban" ? "Every non-Done card must include non-empty definitionOfDone and verificationCommand fields in its wheeljack:task metadata. Derive both from repository evidence; never use placeholders or an invalid command." : "",
          "Do not edit files. Return exactly one final line and no prose before or after it:",
          `wheeljack.project_document ${JSON.stringify({ requestId, kind, content: "<complete markdown>" })}`,
          "Replace <complete markdown> with the full document as a JSON string.",
          (kind === "kanban" ? renderKanban(opsStateRef.current) : opsStateRef.current[kind])
            ? `Current document:\n${kind === "kanban" ? renderKanban(opsStateRef.current) : opsStateRef.current[kind]}`
            : "There is no current document.",
        ].filter(Boolean).join("\n\n");
    const displayPrompt = kind === "bundle"
      ? missingKinds.length
        ? `Bootstrap this project's missing plan documents${incompleteContractCards.length ? ` and backfill ${incompleteContractCards.length} task ${incompleteContractCards.length === 1 ? "contract" : "contracts"}` : ""} from its current repository state.`
        : `Re-analyze this project and propose reviewed updates to its PRD, TDD, and Kanban documents${incompleteContractCards.length ? `, including ${incompleteContractCards.length} missing task ${incompleteContractCards.length === 1 ? "contract" : "contracts"}` : ""}.`
      : `Draft ${projectDocumentName(kind)} from the current project state.`;
    const started = runtime
      ? await sendAgentPrompt(runtime, prompt, displayPrompt)
      : await spawnAgent(prompt, undefined, displayPrompt);
    if (!started && agentDocumentRequestRef.current?.requestId === requestId) {
      window.clearTimeout(timeout);
      agentDocumentRequestRef.current = undefined;
    }
  };

  documentProposalHandlerRef.current = (proposal) => {
    const request = agentDocumentRequestRef.current;
    if (!request) return;
    const contents = mergeAgentProjectDocumentProposal(
      request.requestId,
      request.kinds,
      request.contents,
      proposal,
    );
    if (!contents) return;
    request.contents = contents;
    if (!request.kinds.every((kind) => typeof contents[kind] === "string")) return;
    window.clearTimeout(request.timeout);
    agentDocumentRequestRef.current = undefined;
    const documents = projectDocumentsRef.current;
    if (!documents) return;
    const writes = request.kinds.map((kind) => ({
      kind,
      content: contents[kind]!,
      expectedRevision: documents.documents[kind].revision,
    }));
    void reviewProjectDocumentWrites(
      request.kind === "bundle" ? "Review agent project plan" : `Review agent ${projectDocumentName(request.kind)}`,
      writes,
      request.kind === "bundle" || request.kind === "kanban",
    );
  };

  const createDocumentTasks = (kind: "prd" | "tdd") => {
    const additions: OpsCard[] = (kind === "prd"
      ? [
          ["Validate primary workflow", "Exercise the end-to-end user journey against acceptance criteria."],
          ["Review edge states", "Verify empty, loading, denied, failed, and recovery behavior."],
        ]
      : [
          ["Implement architecture slice", "Build the smallest cross-boundary implementation described by the TDD."],
          ["Run acceptance validation", "Verify runtime behavior, data safety, and packaged execution."],
        ]).map(([title, detail]) => ({
          id: crypto.randomUUID().replaceAll("-", ""),
          columnId: columnIdForRole(opsStateRef.current, "queued"),
          title,
          detail,
          assignee: "Unassigned",
          priority: "normal",
          assigneeIds: [],
          agentStatuses: {},
          expectedFiles: [],
          lastNote: "",
          reviewPolicy: "agent",
        }));
    changeOps((current) => ({ ...current, cards: [...current.cards, ...additions] }));
    setOpsPage("board");
  };

  const addOpsCardOnce = (input: Omit<OpsCard, "id" | "assigneeIds" | "agentStatuses" | "expectedFiles" | "lastNote">) => {
    changeOps((current) => current.cards.some((card) => card.title.toLowerCase() === input.title.toLowerCase())
      ? current
      : {
          ...current,
          cards: [...current.cards, {
            ...input,
            id: crypto.randomUUID().replaceAll("-", ""),
            assigneeIds: [],
            agentStatuses: {},
            expectedFiles: [],
            lastNote: "",
            reviewPolicy: input.reviewPolicy ?? "agent",
          }],
        });
  };

  const launchResearch = async () => {
    if (!project) return;
    if (!selectedAdapterReady) {
      setError("Verify a coding agent in Settings before using workspace quick starts.");
      return;
    }
    addOpsCardOnce({
      columnId: columnIdForRole(opsStateRef.current, "queued"),
      title: `Research ${project.name} next steps`,
      detail: "Inspect the project, identify unknowns, and return a scoped set of board tasks.",
      assignee: "Unassigned",
      priority: "high",
    });
    addOpsCardOnce({
      columnId: columnIdForRole(opsStateRef.current, "queued"),
      title: "Synthesize research findings",
      detail: "Convert evidence into decisions, risks, and implementation-ready tasks.",
      assignee: "Unassigned",
      priority: "normal",
    });
    showSurface("ops");
    await spawnAgent(`Research ${project.name}: inspect the project, identify unknowns, and return scoped implementation-ready tasks.`);
  };

  const bootstrapProjectPlan = () => {
    showSurface("ops");
    void generateProjectDocumentWithAgent("bundle");
  };

  const opsActionPrompt = (card: OpsCard, action: OpsOrchestrationAction) => {
    const dependencies = (card.dependencyIds ?? [])
      .map((id) => opsStateRef.current.cards.find((candidate) => candidate.id === id)?.title)
      .filter(Boolean);
    const contract = [
      card.definitionOfDone ? `Definition of done:\n${card.definitionOfDone}` : "",
      card.constraints ? `Constraints:\n${card.constraints}` : "",
      card.verificationCommand ? `Verification:\n${card.verificationCommand}` : "",
    ].filter(Boolean).join("\n\n");
    if (action === "pause") return `Request a pause for Ops task: ${card.title}\n\nPreserve current progress, record a concise handoff, report status as paused, and wait for reassignment or resume.`;
    if (action === "resume") return `Resume Ops task: ${card.title}\n\n${card.detail}\n\nContinue from the recorded handoff and report verification evidence when finished.`;
    if (action === "review") return `Review Ops task: ${card.title}\n\n${card.detail}\n\nInspect the implementation and evidence without modifying project files. Start the final handoff with exactly REVIEW VERDICT: APPROVE or REVIEW VERDICT: REQUEST CHANGES, then explain the evidence and blockers.`;
    return `${action === "transfer" ? "Take ownership of" : "Work on"} Ops task: ${card.title}\n\n${card.detail}${contract ? `\n\n${contract}` : ""}${dependencies.length ? `\n\nDependencies:\n${dependencies.map((title) => `- ${title}`).join("\n")}` : ""}`.trim();
  };

  const previewAssignments = async (assignments: RouteAssignment[]) => {
    if (!canvas) throw new Error("Open a workspace before routing work.");
    return callCore<RoutePreview>("route_preview", {
      workspaceId: canvas.id,
      assignments,
    });
  };

  const assertTaskLaneTarget = (card: OpsCard, target: string) => {
    if (!card.taskLane || card.taskLane.closedAt) return;
    const node = nodesRef.current.find((candidate) => candidate.id === target);
    const cwd = typeof node?.data.cwd === "string" ? node.data.cwd : "";
    if (!workspacePathsEqual(cwd, card.taskLane.cwd)) {
      throw new Error(`Choose an agent already running in task worktree ${card.taskLane.branch}. Shared-checkout agents cannot own this task.`);
    }
  };

  const previewOpsAction = async (card: OpsCard, action: OpsOrchestrationAction, agentId?: string) => {
    if (action === "complete" || (action === "pause" && !card.assigneeIds.length) || (action === "review" && !agentId)) return undefined;
    const target = agentId ?? card.assigneeIds[0];
    if (!target) throw new Error(`Choose an agent before you ${action} this task.`);
    assertTaskLaneTarget(card, target);
    return previewAssignments([{ target, task: opsActionPrompt(card, action), taskId: card.id }]);
  };

  const executeOpsAction = async (card: OpsCard, action: OpsOrchestrationAction, agentId: string | undefined, preview?: RoutePreview) => {
    if (action === "complete") {
      const currentCard = opsStateRef.current.cards.find((candidate) => candidate.id === card.id);
      if (!currentCard || !opsCanCompleteWithOverride(currentCard)) {
        throw new Error("Isolated task worktrees must pass verification and be approved from review.");
      }
      changeOps((current) => applyOpsOrchestration(current, currentCard.id, action));
      return;
    }
    if (action === "pause" && !card.assigneeIds.length) {
      changeOps((current) => applyOpsPauseRequest(current, card.id));
      return;
    }
    if (action === "review" && !agentId) {
      changeOps((current) => applyOpsOrchestration(current, card.id, action));
      return;
    }
    const target = agentId ?? card.assigneeIds[0];
    if (!target || !preview) throw new Error("Review this route before confirming it.");
    assertTaskLaneTarget(card, target);
    const assignment = { target, task: opsActionPrompt(card, action), taskId: card.id };
    const result = await callCore<RouteExecuteResult>("route_execute", {
      workspaceId: canvas?.id ?? "",
      assignments: [assignment],
      confirmationToken: preview.confirmationToken,
    });
    if (!result.targets.some((item) => item.taskId === card.id && item.delivered)) {
      throw new Error(result.targets[0]?.reason ?? result.message);
    }
    changeOps((current) => action === "pause"
      ? applyOpsPauseRequest(current, card.id, target)
      : applyOpsOrchestration(current, card.id, action, target, agentName(target)));
    await refreshCoordination();
  };

  const requestOpsDecomposition = (card: OpsCard, plannerId: string) => new Promise<OpsDecompositionProposal>((resolve, reject) => {
    const runtime = currentRuntimes()[plannerId];
    if (!runtime?.structured || !runtime.sessionId) {
      reject(new Error("Choose a connected structured agent."));
      return;
    }
    const prior = agentDecompositionRequestRef.current;
    if (prior) {
      window.clearTimeout(prior.timeout);
      prior.reject(new Error("A newer decomposition request replaced this one."));
    }
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      const request = agentDecompositionRequestRef.current;
      if (request?.requestId !== requestId) return;
      agentDecompositionRequestRef.current = undefined;
      request.reject(new Error("The planning agent did not return a decomposition within two minutes."));
    }, 120_000);
    agentDecompositionRequestRef.current = { requestId, parentId: card.id, timeout, resolve, reject };
    const agents = Object.values(currentRuntimes())
      .filter((candidate) => candidate.structured && candidate.sessionId)
      .map((candidate) => ({ id: candidate.nodeId, name: agentName(candidate.nodeId), status: candidate.status }));
    const example = {
      requestId,
      parentId: card.id,
      tasks: [{
        key: "short-stable-key",
        title: "Concrete outcome",
        detail: "Scoped implementation work",
        definitionOfDone: "Observable completion condition",
        constraints: "Important boundary",
        verificationCommand: "Focused runnable check",
        expectedFiles: ["path/to/file"],
        dependencyKeys: [],
        agentId: agents[0]?.id,
        workerSpecialist: {
          name: "Focused specialist",
          roleDescription: "Standing role for this child task",
          rationale: "Why specialization improves this task",
          adapterId: runtime.adapterId,
        },
      }],
    };
    void sendAgentPrompt(runtime, [
      `Decompose wheeljack Ops task ${card.id}: ${card.title}`,
      card.detail,
      card.definitionOfDone ? `Definition of done:\n${card.definitionOfDone}` : "",
      card.constraints ? `Constraints:\n${card.constraints}` : "",
      `Available agents:\n${JSON.stringify(agents, null, 2)}`,
      "Plan 2-6 implementation-ready child tasks. Dependencies must reference task keys. Keep file scopes non-overlapping where possible. Do not edit files or start work.",
      "Every child task must include a non-empty, observable definitionOfDone and a repository-valid verificationCommand. Do not use placeholders.",
      `When useful, add workerSpecialist or reviewerSpecialist with name, roleDescription, rationale, and an adapterId from ${JSON.stringify(readyCodingAdapters.map((adapter) => adapter.id))}; otherwise omit it.`,
      "Return exactly one final line and no prose before or after it:",
      `wheeljack.ops_decomposition ${JSON.stringify(example)}`,
    ].filter(Boolean).join("\n\n"));
  });

  const previewOpsDecomposition = async (parent: OpsCard, tasks: OpsDecompositionTaskDraft[]) => {
    if (tasks.some((task) => !task.definitionOfDone.trim() || !task.verificationCommand.trim())) {
      throw new Error("Every decomposed task needs a definition of done and verification command.");
    }
    const readyAgentIds = new Set(Object.values(currentRuntimes())
      .filter((runtime) => runtime.structured && runtime.sessionId && !["running", "in_progress", "starting", "blocked", "needs_input"].includes(runtime.status))
      .map((runtime) => runtime.nodeId));
    const dispatchKeys = opsDispatchableDecompositionKeys(tasks, readyAgentIds);
    const assignments = tasks
      .filter((task) => dispatchKeys.includes(task.key))
      .map((task) => ({
        target: task.agentId!,
        task: opsDecompositionTaskPrompt(parent, task),
        taskId: opsDecompositionTaskId(parent.id, task.key),
      }));
    return {
      dispatchKeys,
      preview: assignments.length ? await previewAssignments(assignments) : undefined,
    };
  };

  const commitOpsDecomposition = async (
    parent: OpsCard,
    tasks: OpsDecompositionTaskDraft[],
    dispatchKeys: string[],
    preview?: RoutePreview,
  ) => {
    if (tasks.some((task) => !task.definitionOfDone.trim() || !task.verificationCommand.trim())) {
      throw new Error("Every decomposed task needs a definition of done and verification command.");
    }
    const assignments = tasks.filter((task) => dispatchKeys.includes(task.key)).map((task) => ({
      target: task.agentId!,
      task: opsDecompositionTaskPrompt(parent, task),
      taskId: opsDecompositionTaskId(parent.id, task.key),
    }));
    const timestamp = new Date().toISOString();
    const ids = new Map(tasks.map((task) => [task.key, opsDecompositionTaskId(parent.id, task.key)]));
    changeOps((current) => ({
      ...current,
      cards: [
        ...current.cards.map((card) => card.id === parent.id
          ? appendOpsTaskEvent({ ...card, kind: "objective", columnId: columnIdForRole(current, "active") }, {
              id: `manual:decompose:${timestamp}`,
              kind: "update",
              timestamp,
              message: `Decomposed into ${tasks.length} child tasks`,
            })
          : card),
        ...tasks.filter((task) => !current.cards.some((card) => card.id === ids.get(task.key))).map((task): OpsCard => {
          const id = ids.get(task.key)!;
          return {
            id,
            kind: "task",
            parentId: parent.id,
            columnId: columnIdForRole(current, "queued"),
            title: task.title,
            detail: task.detail,
            assignee: "Unassigned",
            priority: parent.priority,
            assigneeIds: [],
            agentStatuses: {},
            expectedFiles: task.expectedFiles,
            lastNote: "Ready after decomposition",
            dependencyIds: task.dependencyKeys.flatMap((key) => ids.get(key) ?? []),
            dependencyKinds: Object.fromEntries(task.dependencyKeys.flatMap((key) => ids.get(key) ? [[ids.get(key)!, "soft"]] : [])),
            definitionOfDone: task.definitionOfDone,
            constraints: task.constraints,
            verificationCommand: task.verificationCommand,
            reviewPolicy: parent.reviewPolicy ?? "agent",
            workerSpecialist: task.workerSpecialist,
            reviewerSpecialist: task.reviewerSpecialist,
            events: [{
              id: `manual:decompose:${timestamp}:${task.key}`,
              kind: "update",
              timestamp,
              message: `Created from ${parent.title}; waiting in Ready`,
            }],
          };
        }),
      ],
    }));
    let result: RouteExecuteResult | undefined;
    let dispatchError = "";
    if (assignments.length) {
      try {
        result = await callCore<RouteExecuteResult>("route_execute", {
          workspaceId: canvas?.id ?? "",
          assignments,
          confirmationToken: preview?.confirmationToken,
        });
      } catch (cause) {
        dispatchError = message(cause);
      }
    }
    const deliveredIds = new Set(result?.targets.filter((target) => target.delivered).map((target) => target.taskId));
    changeOps((current) => ({
      ...current,
      cards: current.cards.map((card) => {
        const task = tasks.find((candidate) => ids.get(candidate.key) === card.id);
        if (!task || !dispatchKeys.includes(task.key)) return card;
        const delivered = deliveredIds.has(card.id);
        const reason = result?.targets.find((target) => target.taskId === card.id)?.reason ?? dispatchError;
        return appendOpsTaskEvent(delivered ? {
          ...card,
          columnId: columnIdForRole(current, "active"),
          assignee: task.agentId ? agentName(task.agentId) : "Unassigned",
          assigneeIds: task.agentId ? [task.agentId] : [],
          agentStatuses: task.agentId ? { [task.agentId]: "running" } : {},
          lastNote: "Dispatched from decomposition",
          startedAt: timestamp,
        } : {
          ...card,
          lastNote: reason ? `Dispatch deferred: ${reason}` : card.lastNote,
        }, {
          id: `manual:dispatch:${timestamp}:${task.key}`,
          kind: delivered ? "assignment" : "update",
          timestamp,
          targetId: delivered ? task.agentId : undefined,
          message: delivered ? `Started from ${parent.title}` : reason ? `Dispatch deferred: ${reason}` : "Dispatch deferred",
        });
      }),
    }));
    await refreshCoordination();
  };

  const startAgentForOpsTask = async (
    card: OpsCard,
    prompt = opsActionPrompt(card, "assign"),
    role: OpsAgentRole = "worker",
    schedulerLeaseId?: string,
    adapterIdOverride?: string,
    preserveTaskState = false,
  ): Promise<boolean> => {
    const suggestion = role === "reviewer" ? card.reviewerSpecialist : card.workerSpecialist;
    const launchAdapterId = suggestion?.adapterId ?? adapterIdOverride ?? selectedAdapterId;
    const suggestedProfile = agentProfiles.find((candidate) => candidate.adapterId === launchAdapterId)
      ?? defaultAgentProfiles().find((candidate) => candidate.adapterId === launchAdapterId);
    const suggestedSnapshot = suggestion && suggestedProfile
      ? specialistSnapshot(suggestion, suggestedProfile, `${project?.id ?? "project"}:${card.id}:${role}`)
      : undefined;
    const savedSpecialist = suggestedSnapshot ? matchingSavedBot(bots, suggestedSnapshot) : undefined;

    if (!preserveTaskState && savedSpecialist && !schedulerLeaseId) {
      return spawnAgent(prompt, card, prompt, role, undefined, savedSpecialist.launch.adapterId, undefined, "auto", {
        snapshot: botSnapshot(savedSpecialist),
        profile: savedSpecialist,
      });
    }

    if (!preserveTaskState && suggestion && suggestedSnapshot && !schedulerLeaseId) {
      return new Promise<boolean>((resolve) => {
        setSpecialistDialog({
          key: `${card.id}:${role}:${suggestedSnapshot.avatarSeed}`,
          intent: "proposal",
          initial: {
            scope: "project",
            projectId: project?.id,
            name: suggestedSnapshot.name,
            roleDescription: suggestedSnapshot.roleDescription,
            avatarSeed: suggestedSnapshot.avatarSeed,
            launch: { ...suggestedSnapshot.launch },
          },
          rationale: suggestion.rationale,
          targetTask: card.title,
          allowLaunch: true,
          launch: { initialPrompt: prompt, displayPrompt: prompt, opsTask: card, opsRole: role, placement: "auto" },
          resolve,
        });
      });
    }

    if (schedulerLeaseId && suggestedSnapshot && suggestion) {
      const readiness = await specialistReadiness({
        scope: "project",
        projectId: project?.id,
        name: suggestedSnapshot.name,
        roleDescription: suggestedSnapshot.roleDescription,
        avatarSeed: suggestedSnapshot.avatarSeed,
        launch: suggestedSnapshot.launch,
      }).catch(() => ({ label: "Unavailable" as const, message: "Suggested adapter unavailable." }));
      let snapshot = suggestedSnapshot;
      let fallbackReason = "";
      if (readiness.label !== "Ready") {
        const fallbackId = adapterIdOverride ?? selectedAdapterId;
        const fallbackProfile = agentProfiles.find((candidate) => candidate.adapterId === fallbackId)
          ?? defaultAgentProfiles().find((candidate) => candidate.adapterId === fallbackId);
        if (!fallbackProfile) return false;
        snapshot = specialistSnapshot({ ...suggestion, adapterId: fallbackId }, fallbackProfile, `${project?.id ?? "project"}:${card.id}:${role}`);
        fallbackReason = ` Suggested ${launchAdapterId} was unavailable; used ${fallbackId}.`;
      }
      const started = await spawnAgent(prompt, card, prompt, role, schedulerLeaseId, snapshot.launch.adapterId, undefined, "auto", { snapshot });
      if (started) {
        const timestamp = new Date().toISOString();
        changeOps((current) => ({
          ...current,
          cards: current.cards.map((item) => item.id === card.id
            ? appendOpsTaskEvent(item, {
                id: `automatic:bot:${timestamp}:${snapshot.avatarSeed}`,
                kind: "update",
                timestamp,
                message: `Auto-selected ${snapshot.name} for ${role}.${fallbackReason}`,
                botSnapshot: snapshot,
              })
            : item),
        }));
      }
      return started;
    }

    const launchAdapter = adapters.find((adapter) => adapter.id === launchAdapterId);
    const launchAdapterReady = isAdapterReady(
      launchAdapter,
      agentLaunchArgs(agentProfiles.find((profile) => profile.adapterId === launchAdapterId)),
    );
    if (launchAdapterReady) {
      if (preserveTaskState) return spawnAgent(prompt, card, prompt, role, schedulerLeaseId, launchAdapterId, undefined, "auto", undefined, true);
      return spawnAgent(prompt, card, prompt, role, schedulerLeaseId, launchAdapterId);
    }
    if (schedulerLeaseId) return false;
    setError(`${launchAdapter?.displayName ?? launchAdapterId} is not ready. Open Settings, rescan, and complete any sign-in or verification step.`);
    return false;
  };

  const setTaskLaneCleanupStatus = async (
    cardId: string,
    status: "queued" | "resolving" | "blocked",
    detail?: string,
    retryAt?: string,
    attempts?: number,
    requiresIntegration?: boolean,
  ) => {
    await persistOpsImmediately((current) => ({
      ...current,
      cards: current.cards.map((card) => card.id === cardId && card.taskLane?.cleanup
        ? {
            ...card,
            report: requiresIntegration === true ? undefined : card.report,
            reconciliation: requiresIntegration === true ? undefined : card.reconciliation,
            taskLane: {
              ...card.taskLane,
              cleanup: {
                ...card.taskLane.cleanup,
                status,
                message: detail,
                retryAt,
                attempts: attempts ?? card.taskLane.cleanup.attempts,
                requiresIntegration: requiresIntegration ?? card.taskLane.cleanup.requiresIntegration,
              },
            },
            lastNote: detail ?? card.lastNote,
          }
        : card),
    }));
  };

  const retryTaskLaneCleanup = async (cardId: string, detail: string) => {
    const cleanup = opsStateRef.current.cards.find((card) => card.id === cardId)?.taskLane?.cleanup;
    if (!cleanup) return;
    const attempts = (cleanup.attempts ?? 0) + 1;
    const retryDelay = attempts < 6
      ? Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1))
      : 5 * 60_000;
    const retryAt = new Date(Date.now() + retryDelay).toISOString();
    await setTaskLaneCleanupStatus(cardId, "queued", detail, retryAt, attempts);
  };

  const finalizeTaskLaneCleanup = async (
    card: OpsCard,
    registered: boolean,
    projectId: string,
    removedByProjectSweep = false,
  ) => {
    const currentCard = opsStateRef.current.cards.find((candidate) => candidate.id === card.id);
    const lane = currentCard?.taskLane;
    const cleanup = lane?.cleanup;
    const activeProject = projectRef.current;
    if (!currentCard || !lane || lane.closedAt || !cleanup || activeProject?.id !== projectId) return;
    let nextGit: GitStatus | undefined;
    if (registered) {
      const removed = await callCore<{ status: GitStatus }>("git_worktree_remove", {
        req: {
          projectPath: activeProject.path,
          worktreePath: lane.worktreePath,
          expectedBranch: lane.branch,
        },
      });
      nextGit = removed.status;
    }
    if (projectRef.current?.id !== projectId) return;
    const timestamp = new Date().toISOString();
    const note = registered
      ? `Removed task worktree; branch ${lane.branch} was preserved.`
      : removedByProjectSweep
        ? `Removed residual task workspace; branch ${lane.branch} was preserved.`
        : `Detached stale task lane ${lane.branch}; its unregistered path was left untouched.`;
    const { archiveDoneOpsCards } = cleanup.action === "archive" ? await import("./opsArchive") : { archiveDoneOpsCards: undefined };
    await persistOpsImmediately((current) => {
      const closed = {
        ...current,
        cards: current.cards.map((candidate) => candidate.id === card.id && candidate.taskLane
          ? appendOpsTaskEvent({
              ...candidate,
              taskLane: { ...candidate.taskLane, closedAt: timestamp, cleanup: undefined },
              lastNote: note,
            }, {
              id: `automatic:task-lane-closed:${timestamp}`,
              kind: "update",
              timestamp,
              message: note,
            })
          : candidate),
      };
      if (cleanup.action === "delete") {
        return { ...closed, cards: closed.cards.filter((candidate) => candidate.id !== card.id) };
      }
      if (cleanup.action === "archive") return archiveDoneOpsCards!(closed, [card.id]);
      return closed;
    }, true);
    if (nextGit) setGit(nextGit);
  };

  const editAgentPromptDelivery = async (runtime: PaneRuntime, delivery: PromptDelivery, prompt: string, images: AgentImageAttachment[]) => {
    if (!project || !canvas || (!prompt.trim() && !images.length)) return false;
    const agentNode = nodesRef.current.find((node) => node.id === runtime.nodeId);
    const snapshot = agentNode ? botSnapshotFromNode(agentNode.data) : undefined;
    const submittedPrompt = snapshot && delivery.payload?.standingRoleApplied
      ? botStandingPrompt(prompt, snapshot)
      : prompt;
    try {
      const updated = await callCore<PromptDelivery>("session_prompt_edit", {
        deliveryId: delivery.id,
        sessionId: runtime.sessionId,
        nodeId: runtime.nodeId,
        adapterId: runtime.adapterId,
        prompt: submittedPrompt.trim(),
        historyText: prompt.trim(),
        standingRoleApplied: Boolean(snapshot && delivery.payload?.standingRoleApplied),
        imagePaths: images.map((image) => image.path),
        terminalText: runtime.transcript,
        canvasId: canvas.id,
        workspacePath: project.path,
        taskId: stringValue(agentNode?.data ?? {}, "taskId") || undefined,
      });
      void callCore("attachment_gc", {}).catch(() => undefined);
      setRuntimes((current) => {
        const latest = current[runtime.nodeId];
        if (!latest) return current;
        return {
          ...current,
          [runtime.nodeId]: {
            ...latest,
            messages: latest.messages.map((item) => item.deliveryId === delivery.id
              ? { ...item, text: prompt.trim(), images, deliveryState: updated.state }
              : item),
          },
        };
      });
      return true;
    } catch (cause) {
      setError(`Could not edit queued prompt: ${message(cause)}`);
      return false;
    }
  };

  const retryAgentPromptDelivery = async (runtime: PaneRuntime, delivery: PromptDelivery) => {
    try {
      const updated = await callCore<PromptDelivery>("session_prompt_retry", { deliveryId: delivery.id });
      setRuntimes((current) => {
        const latest = current[runtime.nodeId];
        return latest ? {
          ...current,
          [runtime.nodeId]: {
            ...latest,
            messages: latest.messages.map((item) => item.deliveryId === delivery.id ? { ...item, deliveryState: updated.state } : item),
          },
        } : current;
      });
      return true;
    } catch (cause) {
      setError(`Could not retry queued prompt: ${message(cause)}`);
      return false;
    }
  };

  const cancelAgentPromptDelivery = async (runtime: PaneRuntime, delivery: PromptDelivery) => {
    try {
      const updated = await callCore<PromptDelivery>("session_prompt_cancel", { deliveryId: delivery.id });
      void callCore("attachment_gc", {}).catch(() => undefined);
      setRuntimes((current) => {
        const latest = current[runtime.nodeId];
        return latest ? {
          ...current,
          [runtime.nodeId]: {
            ...latest,
            messages: latest.messages.map((item) => item.deliveryId === delivery.id ? { ...item, deliveryState: updated.state } : item),
          },
        } : current;
      });
      return true;
    } catch (cause) {
      setError(`Could not cancel queued prompt: ${message(cause)}`);
      return false;
    }
  };

  useEffect(() => {
    const activeProject = projectRef.current;
    if (!startupReady || safeStartupActive || !activeProject || canvas?.projectId !== activeProject.id) return;
    if (!opsRevisionByProjectRef.current.has(activeProject.id)
      || taskWorkspaceSweepPendingRef.current.has(activeProject.id)
      || taskWorkspaceSweepCompletedRef.current.has(activeProject.id)) return;
    const projectId = activeProject.id;
    const projectPath = activeProject.path;
    const attempts = (taskWorkspaceSweepAttemptsRef.current.get(projectId) ?? 0) + 1;
    taskWorkspaceSweepAttemptsRef.current.set(projectId, attempts);
    taskWorkspaceSweepPendingRef.current.add(projectId);
    const protectedPaths = [...opsState.cards, ...(opsState.archivedCards ?? [])]
      .flatMap((card) => card.taskLane && !card.taskLane.closedAt && !card.taskLane.cleanup
        ? [card.taskLane.worktreePath]
        : []);
    void callCore<GitTaskWorkspacesCleanupResult>("git_task_workspaces_cleanup", {
      req: { projectPath, protectedPaths },
    }).then(async (result) => {
      if (projectRef.current?.id !== projectId) return;
      setGit(result.status);
      const removedPaths = [...result.removedWorktrees, ...result.removedResidualDirectories];
      for (const card of opsStateRef.current.cards) {
        if (!card.taskLane?.cleanup) continue;
        const removed = removedPaths.some((path) =>
          workspacePathsEqual(path, card.taskLane!.worktreePath));
        const registered = result.status.worktrees.some((worktree) =>
          workspacePathsEqual(worktree.path, card.taskLane!.worktreePath));
        const pathExists = removed || registered
          ? true
          : (await callCore<GitStatus>("git_status", {
              path: card.taskLane.worktreePath,
              includeWorktrees: false,
            })).pathExists;
        if (removed || (!registered && !pathExists)) {
          await finalizeTaskLaneCleanup(card, false, projectId, true);
        }
      }
      const retryable = result.preserved.some((item) => item.retryable);
      if (!retryable || attempts >= 6) {
        taskWorkspaceSweepCompletedRef.current.add(projectId);
        return;
      }
      window.setTimeout(() => {
        if (projectRef.current?.id === projectId) {
          setCleanupRetryVersion((current) => current + 1);
        }
      }, Math.min(60_000, 1_000 * 2 ** (attempts - 1)));
    }).catch((cause) => {
      if (projectRef.current?.id !== projectId || attempts >= 6) {
        taskWorkspaceSweepCompletedRef.current.add(projectId);
        if (projectRef.current?.id === projectId) {
          setError(`Could not reconcile task workspaces: ${message(cause)}`);
        }
        return;
      }
      window.setTimeout(() => {
        if (projectRef.current?.id === projectId) {
          setCleanupRetryVersion((current) => current + 1);
        }
      }, Math.min(60_000, 1_000 * 2 ** (attempts - 1)));
    }).finally(() => taskWorkspaceSweepPendingRef.current.delete(projectId));
    // Project task workspaces reconcile once after durable Ops state loads, with bounded retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas?.projectId, cleanupRetryVersion, safeStartupActive, startupReady, taskWorkspaceSweepVersion]);

  useEffect(() => {
    const doneColumnIds = new Set(opsState.columns.filter((column) => column.role === "done").map((column) => column.id));
    const candidate = opsState.cards.find((card) =>
      doneColumnIds.has(card.columnId)
      && card.reconciliation?.status === "integrated"
      && Boolean(card.taskLane && !card.taskLane.closedAt && !card.taskLane.cleanup));
    if (!candidate) return;
    void queueOpsTaskLaneCleanup(candidate, "remove").catch((cause) => setError(`Could not queue automatic workspace cleanup: ${message(cause)}`));
    // Reconciled tasks own no long-lived worker workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsState.cards, opsState.columns]);

  useEffect(() => {
    const retryAt = opsState.cards.flatMap((card) => card.taskLane?.cleanup?.status === "queued" && card.taskLane.cleanup.retryAt
      ? [Date.parse(card.taskLane.cleanup.retryAt)]
      : []).filter(Number.isFinite).sort((left, right) => left - right)[0];
    if (retryAt === undefined) return;
    const timer = window.setTimeout(() => setCleanupRetryVersion((current) => current + 1), Math.max(0, retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [cleanupRetryVersion, opsState.cards]);

  useEffect(() => {
    const activeProject = projectRef.current;
    const now = new Date().toISOString();
    const candidates = opsState.cards.filter((card) => card.taskLane?.cleanup
      && !card.taskLane.closedAt
      && card.taskLane.cleanup.status !== "blocked"
      && (!card.taskLane.cleanup.retryAt || card.taskLane.cleanup.retryAt <= now));
    if (!activeProject || !candidates.length) return;
    const runtimeValues = Object.values(runtimes);
    const participantRuntimes = (card: OpsCard) => opsCardParticipantIds(card, runtimeValues)
      .flatMap((id) => runtimeValues.filter((runtime) => runtime.nodeId === id && !isTerminalSessionStatus(runtime.status)));
    const cleanupRuntimeCount = candidates.filter((card) => opsCardParticipantIds(card, runtimeValues).some((id) =>
      runtimeValues.some((runtime) => runtime.nodeId === id && !isTerminalSessionStatus(runtime.status)))).length;
    const candidate = candidates.find((card) =>
      !taskLaneCleanupIdsRef.current.has(card.id)
      && (card.taskLane?.cleanup?.status === "queued" || participantRuntimes(card).length === 0));
    if (!candidate?.taskLane?.cleanup) return;
    taskLaneCleanupIdsRef.current.add(candidate.id);
    void (async () => {
      const status = await callCore<GitStatus>("git_status", { path: activeProject.path, includeWorktrees: true });
      if (projectRef.current?.id !== activeProject.id) return;
      setGit(status);
      const latest = opsStateRef.current.cards.find((card) => card.id === candidate.id);
      if (!latest?.taskLane?.cleanup || latest.taskLane.closedAt) return;
      const currentRuntimeValues = Object.values(currentRuntimes());
      const participants = opsCardParticipantIds(latest, currentRuntimeValues)
        .flatMap((id) => currentRuntimeValues.filter((runtime) => runtime.nodeId === id && !isTerminalSessionStatus(runtime.status)));
      const registered = status.worktrees.find((worktree) => workspacePathsEqual(worktree.path, latest.taskLane!.worktreePath));
      if (registered && registered.branch !== latest.taskLane.branch) {
        await setTaskLaneCleanupStatus(latest.id, "blocked", `Task lane expected ${latest.taskLane.branch}, but ${registered.branch} is registered at its path.`);
        return;
      }
      if ((!registered || !registered.dirty) && participants.length === 0) {
        const requiresIntegration = latest.taskLane.cleanup.action === "remove" && latest.taskLane.cleanup.requiresIntegration;
        if (requiresIntegration && registered) {
          if (latest.reconciliation?.status === "needs_human") return;
          if (!latest.report) {
            const timestamp = new Date().toISOString();
            await persistOpsImmediately((current) => ({
              ...current,
              cards: current.cards.map((candidate) => candidate.id === latest.id
                ? appendOpsTaskEvent({
                    ...candidate,
                    columnId: columnIdForRole(current, "review"),
                    report: {
                      status: "reported",
                      summary: "Task workspace cleanup finished.",
                      evidence: "The cleanup agent exited and the task worktree is clean; repository reconciliation is pending.",
                      checks: [],
                      risks: [],
                      reportedAt: timestamp,
                    },
                    reconciliation: { status: "queued", attempts: candidate.reconciliation?.attempts ?? 0, message: "Clean task commits are ready for automatic reconciliation.", updatedAt: timestamp },
                  }, {
                    id: `automatic:cleanup-report:${latest.id}:${timestamp}`,
                    kind: "handoff",
                    timestamp,
                    message: "Recovered cleanup completion from the clean task worktree.",
                  })
                : candidate),
            }));
            return;
          }
          if (latest.reconciliation?.status !== "integrated") return;
        }
        await finalizeTaskLaneCleanup(latest, Boolean(registered), activeProject.id);
        return;
      }
      if (latest.taskLane.cleanup.status === "queued" && participants.length > 0) {
        queueOpsSteering(latest, taskWorktreeCleanupPrompt(latest));
        const retryAt = new Date(Date.now() + 5_000).toISOString();
        await setTaskLaneCleanupStatus(latest.id, "resolving", undefined, retryAt, undefined, latest.taskLane.cleanup.action === "remove");
        return;
      }
      if (latest.taskLane.cleanup.status === "queued" && registered?.dirty && cleanupRuntimeCount < Math.max(1, autonomousConcurrency)) {
        const retryAt = new Date(Date.now() + 5_000).toISOString();
        await setTaskLaneCleanupStatus(latest.id, "resolving", undefined, retryAt, undefined, latest.taskLane.cleanup.action === "remove");
        const resolvingCard = opsStateRef.current.cards.find((card) => card.id === latest.id) ?? latest;
        const started = await startAgentForOpsTask(resolvingCard, taskWorktreeCleanupPrompt(resolvingCard), "worker", undefined, undefined, true);
        if (!started) await retryTaskLaneCleanup(latest.id, "No task agent was available to resolve this dirty worktree.");
        return;
      }
      if (latest.taskLane.cleanup.status === "resolving" && participants.length === 0 && registered?.dirty) {
        await retryTaskLaneCleanup(latest.id, "The cleanup agent finished, but the task worktree still has local changes.");
      }
    })().catch((cause) => {
      void retryTaskLaneCleanup(candidate.id, `Could not resolve task worktree: ${message(cause)}`).catch(() => undefined);
    }).finally(() => taskLaneCleanupIdsRef.current.delete(candidate.id));
    // Cleanup is driven entirely by durable lane intent plus runtime transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autonomousConcurrency, cleanupRetryVersion, opsState, runtimes]);

  const updateOpsDependencies = (card: OpsCard, dependencyIds: string[], hardDependencyIds: string[]) => {
    const timestamp = new Date().toISOString();
    changeOps((current) => ({
      ...current,
      cards: current.cards.map((item) => item.id === card.id
        ? appendOpsTaskEvent({
            ...item,
            dependencyIds,
            dependencyKinds: Object.fromEntries(dependencyIds.map((dependencyId) => [dependencyId, hardDependencyIds.includes(dependencyId) ? "hard" : "soft"])),
          }, {
            id: `manual:dependencies:${timestamp}`,
            kind: "update",
            timestamp,
            message: dependencyIds.length
              ? `Task relationships updated: ${dependencyIds.length} upstream ${dependencyIds.length === 1 ? "task" : "tasks"}`
              : "Task relationships cleared",
          })
        : item),
    }));
  };

  const adapterArgsById = useMemo(() => Object.fromEntries(
    agentProfiles.map((profile) => [
      profile.adapterId,
      agentReadinessArgs(profile, project?.agentAccess),
    ]),
  ), [agentProfiles, project?.agentAccess]);
  const selectedAdapter = adapters.find((adapter) => adapter.id === selectedAdapterId);
  const selectedAdapterReady = isAdapterReady(
    selectedAdapter,
    adapterArgsById[selectedAdapterId] ?? [],
  );
  const selectedIntentReady = isAdapterReady(
    selectedAdapter,
    agentReadinessArgs(
      agentProfiles.find((profile) => profile.adapterId === selectedAdapterId),
      project?.agentAccess,
      agentIntent,
    ),
  );

  const reconcileReportedTask = async (reportedCard: OpsCard) => {
    const activeProject = projectRef.current;
    const card = opsStateRef.current.cards.find((candidate) => candidate.id === reportedCard.id);
    if (!activeProject || !card?.report || card.reviewPolicy === "human") return;
    const projectId = activeProject.id;
    const assertActiveProject = () => {
      if (projectRef.current?.id !== projectId) throw new Error("Reconciliation changed projects before it finished; the durable task will recover on its next activation.");
    };
    const attempts = (card.reconciliation?.attempts ?? 0) + 1;
    const runningAt = new Date().toISOString();
    await persistOpsImmediately((current) => ({
      ...current,
      cards: current.cards.map((candidate) => candidate.id === card.id
        ? { ...candidate, reconciliation: { status: "running", attempts, message: "Integrating worker evidence…", updatedAt: runningAt } }
        : candidate),
    }));
    const complete = async (messageText: string, sourceHead?: string, targetHead?: string) => {
      assertActiveProject();
      await persistOpsImmediately((current) => {
        const approved = applyOpsOrchestration(current, card.id, "approve");
        const timestamp = new Date().toISOString();
        return {
          ...approved,
          cards: approved.cards.map((candidate) => candidate.id === card.id
            ? appendOpsTaskEvent({
                ...candidate,
                reconciliation: { status: "integrated", attempts, message: messageText, updatedAt: timestamp, sourceHead, targetHead },
                attemptCount: 0,
                retryAt: undefined,
              }, {
                id: `reconcile:integrated:${card.id}:${Date.now()}`,
                kind: "completion",
                timestamp,
                message: messageText,
              })
            : candidate),
        };
      });
    };
    if (!card.taskLane) {
      await complete("Shared-checkout worker evidence was accepted without an additional verification agent.");
      return;
    }
    if (card.taskLane.closedAt) {
      const timestamp = new Date().toISOString();
      await persistOpsImmediately((current) => ({
        ...current,
        cards: current.cards.map((candidate) => candidate.id === card.id
          ? { ...candidate, reconciliation: { status: "needs_human", attempts, reason: "closed_before_integration", message: `Task branch ${card.taskLane!.branch} was closed before its latest report could be integrated. The branch was preserved.`, updatedAt: timestamp } }
          : candidate),
      }));
      return;
    }
    const result = await callCore<GitWorktreeIntegrate>("git_worktree_integrate", {
      req: {
        projectPath: activeProject.path,
        worktreePath: card.taskLane.worktreePath,
        expectedBranch: card.taskLane.branch,
        baseCommit: card.taskLane.baseCommit,
      },
    });
    if (result.status === "integrated" || result.status === "empty") {
      await complete(result.message, result.sourceHead, result.targetHead);
      return;
    }
    const recordReconciliation = async (
      status: "awaiting_repair" | "retrying" | "needs_human",
      detail: string,
      reason: NonNullable<OpsCard["reconciliation"]>["reason"],
    ) => {
      assertActiveProject();
      const timestamp = new Date().toISOString();
      await persistOpsImmediately((current) => ({
        ...current,
        cards: current.cards.map((candidate) => candidate.id === card.id
          ? appendOpsTaskEvent({
              ...candidate,
              reconciliation: { status, attempts, reason, message: detail, updatedAt: timestamp },
              lastNote: detail,
            }, {
              id: `reconcile:${status}:${card.id}:${Date.now()}`,
              kind: status === "needs_human" ? "blocker" : "update",
              timestamp,
              message: detail,
            })
          : candidate),
      }));
    };
    if (result.status === "orphaned_source") {
      const projectRecoveryCompleted = (card.events ?? []).some((event) =>
        event.id.startsWith("automatic:legacy-recovery-complete:"));
      if (projectRecoveryCompleted) {
        await complete(
          "Project recovery confirmed the task branch was integrated and preserved the divergent orphan directory as a separate audit artifact.",
          result.sourceHead,
          result.targetHead,
        );
        return;
      }
      await recordReconciliation("awaiting_repair", result.message, "legacy_recovery");
      return;
    }
    const reason = result.status === "source_dirty" ? "source_dirty" : result.status === "target_dirty" ? "target_dirty" : "conflict";
    if (result.status === "target_dirty") {
      await recordReconciliation("retrying", result.message, reason);
      return;
    }
    await recordReconciliation("awaiting_repair", result.message, reason);
    const repairPrompt = result.status === "source_dirty"
      ? `Reconciliation found uncommitted task changes. Inspect every staged, unstaged, and untracked file, preserve valuable work in commits on ${card.taskLane.branch}, rerun the relevant checks, and report completed again. Do not discard changes merely to clean the tree.`
      : `Reconciliation rolled back a Git conflict while integrating ${card.taskLane.branch}. Rebase the task branch onto the current opened project branch, resolve the conflict autonomously, rerun the relevant checks, commit the resolution, and report completed again.`;
    const runtime = card.assigneeIds.map((id) => currentRuntimes()[id]).find((candidate) => candidate?.structured && candidate.status === "completed");
    const resumed = runtime ? await sendAgentPrompt(runtime, repairPrompt, repairPrompt) : false;
    if (!resumed && !await startAgentForOpsTask(card, repairPrompt, "worker")) {
      throw new Error("The reconciliation repair agent could not be resumed or restarted.");
    }
  };

  useEffect(() => {
    const activeProject = projectRef.current;
    if (!activeProject || !canvas || safeStartupActive) return;
    const recoveryCards = opsState.cards.filter((card) =>
      (card.reconciliation?.status === "awaiting_repair"
        && card.reconciliation.reason === "legacy_recovery")
      || (card.reconciliation?.status === "retrying"
        && card.reconciliation.message?.includes("project recovery must resolve it without discarding files.")));
    if (!recoveryCards.length) return;
    const recoveryCardIds = new Set(recoveryCards.map((card) => card.id));
    const recoveryEvent = recoveryCards
      .flatMap((card) => card.events ?? [])
      .filter((event) => event.id.startsWith("automatic:legacy-recovery:"))
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      .at(-1);
    const recoveryCompleted = recoveryEvent && recoveryCards
      .flatMap((card) => card.events ?? [])
      .some((event) => event.id.startsWith("automatic:legacy-recovery-complete:")
        && event.targetId === recoveryEvent.targetId
        && event.timestamp >= recoveryEvent.timestamp);
    const recoveryRuntimeId = legacyRecoveryRuntimeRef.current.get(activeProject.id)
      ?? (!recoveryCompleted ? recoveryEvent?.targetId : undefined);
    const recoveryRuntime = recoveryRuntimeId
      ? currentRuntimes()[recoveryRuntimeId]
      : undefined;
    if (recoveryRuntime && ["starting", "running", "in_progress", "needs_input"].includes(recoveryRuntime.status)) return;
    if (recoveryRuntime?.status === "completed") {
      if (legacyRecoveryCompletionPendingRef.current.has(activeProject.id)) return;
      legacyRecoveryCompletionPendingRef.current.add(activeProject.id);
      const timestamp = new Date().toISOString();
      void persistOpsImmediately((current) => ({
        ...current,
        cards: current.cards.map((card) => recoveryCardIds.has(card.id)
          ? appendOpsTaskEvent({
              ...card,
              reconciliation: {
                status: "queued",
                attempts: 0,
                message: "Project recovery completed; task evidence is ready for reconciliation.",
                updatedAt: timestamp,
              },
            }, {
              id: `automatic:legacy-recovery-complete:${timestamp}:${card.id}`,
              kind: "update",
              timestamp,
              message: "Project recovery completed",
              targetId: recoveryRuntime.nodeId,
            })
          : card),
      })).finally(() => {
        legacyRecoveryCompletionPendingRef.current.delete(activeProject.id);
        legacyRecoveryRuntimeRef.current.delete(activeProject.id);
      });
      return;
    }
    if (recoveryRuntimeId) legacyRecoveryRuntimeRef.current.delete(activeProject.id);
    if (!selectedAdapterReady || legacyRecoverySpawnPendingRef.current.has(activeProject.id)) return;
    legacyRecoverySpawnPendingRef.current.add(activeProject.id);
    const inventory = recoveryCards.map((card) => ({
      id: card.id,
      title: card.title,
      branch: card.taskLane?.branch,
      baseCommit: card.taskLane?.baseCommit,
      worktreePath: card.taskLane?.worktreePath,
    }));
    const prompt = [
      `Recover legacy wheeljack task state for ${activeProject.path}.`,
      "Act as the single project reconciler. Inspect the main checkout, every listed branch, every registered worktree, and every orphan task directory. Preserve all valuable staged, unstaged, untracked, and committed work. Commit uncommitted work on the correct task branch, integrate completed branches into the opened branch in a coherent order, resolve overlaps, and run repository-relevant checks.",
      "Never reset, discard, or overwrite work. Do not delete a task directory unless every file is committed and integrated; archive uncertain copies instead. Treat opened-checkout changes that are not clearly attributable to a listed legacy task as active work, even when they predate your inventory. Also treat files that appear or change after inventory as active concurrent work. Leave active work untouched, do not wait on or commit it, and do not let it block legacy recovery. Finish with a concise recovery report after every legacy artifact is integrated, preserved, or safely archived.",
      `Recovery inventory:\n${JSON.stringify(inventory, null, 2)}`,
    ].join("\n\n");
    void spawnAgent(prompt, undefined, prompt, "worker", undefined, selectedAdapterId, {
      autonomyDepth: 0,
      onSpawned: (node) => {
        legacyRecoveryRuntimeRef.current.set(activeProject.id, node.id);
        const timestamp = new Date().toISOString();
        void persistOpsImmediately((current) => ({
          ...current,
          cards: current.cards.map((card) => recoveryCardIds.has(card.id)
            ? appendOpsTaskEvent({
                ...card,
                reconciliation: {
                  ...card.reconciliation,
                  status: "awaiting_repair",
                  attempts: card.reconciliation?.attempts ?? 0,
                  reason: "legacy_recovery",
                  message: `Project recovery is running with ${node.title}.`,
                  updatedAt: timestamp,
                },
              }, card.id === recoveryCards[0].id ? {
                id: `automatic:legacy-recovery:${timestamp}`,
                kind: "assignment",
                timestamp,
                message: `Started one project recovery agent for ${recoveryCards.length} legacy tasks`,
                targetId: node.id,
              } : {
                id: `automatic:legacy-recovery-linked:${timestamp}:${card.id}`,
                kind: "update",
                timestamp,
                message: "Included in project recovery",
                targetId: node.id,
              })
            : card),
        })).catch(() => undefined);
      },
    }).then((started) => {
      if (!started) legacyRecoveryRuntimeRef.current.delete(activeProject.id);
    }).catch((cause) => {
      legacyRecoveryRuntimeRef.current.delete(activeProject.id);
      setError(`Project recovery could not start: ${message(cause)}`);
    }).finally(() => {
      legacyRecoverySpawnPendingRef.current.delete(activeProject.id);
    });
    // Recovery is one project-scoped agent; card events provide durable restart linkage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, opsState.cards, runtimes, safeStartupActive, selectedAdapterId, selectedAdapterReady]);

  useEffect(() => {
    const reviewColumnIds = new Set(opsState.columns.filter((column) => column.role === "review").map((column) => column.id));
    const now = Date.now();
    const candidate = opsState.cards.find((card) =>
      reviewColumnIds.has(card.columnId)
      && card.reviewPolicy !== "human"
      && Boolean(card.report)
      && (card.reconciliation?.status === "queued"
        || (card.reconciliation?.status === "retrying"
          && Date.parse(card.reconciliation.updatedAt) + ((card.reconciliation.attempts ?? 0) < 5
            ? Math.min(30_000, 1_000 * 2 ** Math.max(0, (card.reconciliation.attempts ?? 1) - 1))
            : 5 * 60_000) <= now))
      && !reconciliationCardIdsRef.current.has(card.id));
    if (!candidate) return;
    const projectId = projectRef.current?.id;
    if (!projectId) return;
    reconciliationCardIdsRef.current.add(candidate.id);
    const queued = reconciliationQueueRef.current.catch(() => undefined).then(() => reconcileReportedTask(candidate));
    reconciliationQueueRef.current = queued;
    void queued.catch((cause) => {
      if (projectRef.current?.id !== projectId) return;
      const detail = message(cause);
      const attempts = (candidate.reconciliation?.attempts ?? 0) + 1;
      void persistOpsImmediately((current) => ({
        ...current,
        cards: current.cards.map((card) => card.id === candidate.id
          ? { ...card, reconciliation: { status: "retrying", attempts, reason: "error", message: detail, updatedAt: new Date().toISOString() } }
          : card),
      })).catch(() => undefined);
      setError(`Reconciliation for “${candidate.title}” will retry automatically: ${detail}`);
    }).finally(() => reconciliationCardIdsRef.current.delete(candidate.id));
    // Durable card state selects reconciliation work; refs serialize native Git mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsState.cards, opsState.columns, reconciliationRetryVersion]);

  useEffect(() => {
    const retryAt = opsState.cards
      .filter((card) => card.reconciliation?.status === "retrying")
      .map((card) => Date.parse(card.reconciliation!.updatedAt) + ((card.reconciliation!.attempts ?? 0) < 5
        ? Math.min(30_000, 1_000 * 2 ** Math.max(0, (card.reconciliation!.attempts ?? 1) - 1))
        : 5 * 60_000))
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    if (retryAt === undefined) return;
    const timer = window.setTimeout(() => setReconciliationRetryVersion((current) => current + 1), Math.max(0, retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [opsState.cards, reconciliationRetryVersion]);

  useEffect(() => {
    const doneColumnIds = new Set(opsState.columns.filter((column) => column.role === "done").map((column) => column.id));
    const reviewColumnId = opsState.columns.find((column) => column.role === "review")?.id;
    if (!reviewColumnId) return;
    const parent = opsState.cards.find((candidate) => {
      if (candidate.report || doneColumnIds.has(candidate.columnId)) return false;
      const children = opsState.cards.filter((card) => card.parentId === candidate.id);
      return children.length > 0 && children.every((child) => doneColumnIds.has(child.columnId));
    });
    if (!parent) return;
    const timestamp = new Date().toISOString();
    void persistOpsImmediately((current) => ({
      ...current,
      cards: current.cards.map((card) => card.id === parent.id
        ? appendOpsTaskEvent({
            ...card,
            columnId: reviewColumnId,
            report: { status: "reported", summary: "All child tasks were reconciled.", evidence: "The objective's decomposed work completed and is ready for final reconciliation.", checks: [], risks: [], reportedAt: timestamp },
            reconciliation: { status: card.reviewPolicy === "human" ? "needs_human" : "queued", attempts: 0, message: "Child results are ready for objective reconciliation.", updatedAt: timestamp },
          }, {
            id: `reconcile:children:${parent.id}:${timestamp}`,
            kind: "completion",
            timestamp,
            message: "All child tasks reconciled",
          })
        : card),
    }));
    // Parent objectives advance from durable child outcomes without a manual card move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsState.cards, opsState.columns]);

  const fetchOpsTaskReview = (card: OpsCard) => {
    const activeProject = projectRef.current;
    if (!activeProject || !card.taskLane || card.taskLane.closedAt) {
      throw new Error("Verification requires a registered, open task worktree.");
    }
    return callCore<GitWorktreeReview>("git_worktree_review", {
      req: {
        projectPath: activeProject.path,
        worktreePath: card.taskLane.worktreePath,
        expectedBranch: card.taskLane.branch,
        baseCommit: card.taskLane.baseCommit,
      },
    });
  };

  const showTaskReviewEvidence = (card: OpsCard, result: GitWorktreeReview) => {
    setReviewEvidence({
      scope: "task",
      isRepo: true,
      branch: result.branch,
      changedFiles: result.changedFiles,
      text: result.text,
      truncated: result.truncated,
      worktreePath: card.taskLane!.worktreePath,
      baseCommit: result.baseCommit,
      snapshotId: result.snapshotId,
    });
    setReviewEvidenceMessage(
      result.truncated
        ? "Task diff capped at 200 KB. Inspect the worktree directly for the remainder."
        : result.changedFiles.length
          ? `${result.changedFiles.length} task file(s) changed from ${result.baseCommit.slice(0, 10)}.`
          : "Task worktree has no changes from its captured base.",
    );
    setReviewEvidenceReady(true);
  };

  const opsCardHasFileConflict = (card: OpsCard, state = opsStateRef.current) => {
    return opsActiveFileConflicts(state).some((conflict) => conflict.cardIds.includes(card.id));
  };

  // Agents verify their own work; reconciliation consumes their persisted report.
  const inspectOpsTask = (card: OpsCard) => {
    const currentCard = opsStateRef.current.cards.find((candidate) => candidate.id === card.id) ?? card;
    reviewCardRef.current = currentCard;
    setReviewCard(currentCard);
    setReviewEvidenceReady(false);
    setReviewEvidence(undefined);
    setReviewEvidenceMessage("Loading repository evidence...");
    if (!project) {
      setReviewEvidenceMessage("No project is open.");
      return;
    }
    if (currentCard.taskLane?.closedAt) {
      setReviewEvidenceMessage(`Task worktree was removed on ${currentCard.taskLane.closedAt}. Branch ${currentCard.taskLane.branch} was preserved.`);
      return;
    }
    void (currentCard.taskLane
      ? fetchOpsTaskReview(currentCard).then((result) => showTaskReviewEvidence(currentCard, result))
      : Promise.all([
          callCore<GitStatus>("git_status", { path: project.path, includeWorktrees: false }),
          callCore<GitDiff>("git_diff", { path: project.path }),
        ]).then(([status, diff]) => {
          setReviewEvidence({
            scope: "shared",
            isRepo: diff.isRepo,
            branch: status.branch,
            changedFiles: status.changedFiles,
            text: diff.text,
            truncated: diff.truncated,
          });
          setReviewEvidenceMessage(
            !diff.isRepo
              ? "Shared checkout (non-Git project). Review the agent handoff before approving."
              : diff.truncated
                ? "Shared-checkout diff capped at 200 KB and may include unrelated work."
                : status.changedFiles.length === 0
                  ? "Shared checkout has no tracked changes; unrelated work may still exist."
                  : `${status.changedFiles.length} shared-checkout file(s) on ${status.branch}; evidence may include unrelated work.`,
          );
          setReviewEvidenceReady(true);
        }))
      .catch((cause) => {
        setReviewEvidenceMessage(`Could not load review evidence: ${message(cause)}`);
        setReviewEvidenceReady(false);
      });
  };

  const reviewOpsTask = async (approved: boolean) => {
    if (!reviewCard) return;
    if (!approved) return;
    const currentCard = opsStateRef.current.cards.find((candidate) => candidate.id === reviewCard.id);
    if (currentCard?.report) {
      const timestamp = new Date().toISOString();
      const acceptedHumanPolicy = currentCard.reviewPolicy === "human";
      await persistOpsImmediately((current) => ({
        ...current,
        cards: current.cards.map((card) => card.id === currentCard.id
          ? appendOpsTaskEvent({
              ...card,
              reviewPolicy: acceptedHumanPolicy ? "either" : card.reviewPolicy,
              reconciliation: {
                status: "queued",
                attempts: card.reconciliation?.attempts ?? 0,
                message: acceptedHumanPolicy ? "Human acceptance recorded; automatic reconciliation resumed." : "Reconciliation retry requested after the intervention was resolved.",
                updatedAt: timestamp,
              },
            }, {
              id: `manual:accept:${timestamp}`,
              kind: "review",
              timestamp,
              message: acceptedHumanPolicy ? "Human acceptance recorded" : "Reconciliation retry requested",
            })
          : card),
      }));
      setReviewCard(undefined);
      return;
    }
    if (!currentCard?.taskLane || currentCard.taskLane.closedAt) return;
    setReviewEvidenceReady(false);
    setReviewEvidenceMessage("Revalidating task snapshot before approval...");
    try {
      const workspace = await ensureOpsTaskLane(currentCard);
      if (workspace.sharedNonGit || !workspace.worktreePath) {
        throw new Error("Approval requires the registered task worktree.");
      }
      const validatedCard = {
        ...currentCard,
        taskLane: {
          ...currentCard.taskLane,
          worktreePath: workspace.worktreePath,
          cwd: workspace.cwd,
        },
      };
      const result = await fetchOpsTaskReview(validatedCard);
      showTaskReviewEvidence(validatedCard, result);
      const latest = opsStateRef.current.cards.find((candidate) => candidate.id === currentCard.id) ?? currentCard;
      const laneUnchanged = Boolean(
        latest.taskLane &&
        currentCard.taskLane &&
        latest.taskLane.branch === currentCard.taskLane.branch &&
        latest.taskLane.baseCommit === currentCard.taskLane.baseCommit &&
        workspacePathsEqual(latest.taskLane.worktreePath, currentCard.taskLane.worktreePath) &&
        workspacePathsEqual(latest.taskLane.cwd, currentCard.taskLane.cwd),
      );
      const approvalCard = laneUnchanged && latest.taskLane
        ? {
            ...latest,
            taskLane: {
              ...latest.taskLane,
              worktreePath: workspace.worktreePath,
              cwd: workspace.cwd,
            },
          }
        : latest;
      const approval = opsVerificationApproval(approvalCard, opsCardHasFileConflict(approvalCard), result.snapshotId);
      if (!approval.ready) {
        setReviewCard(approvalCard);
        setReviewEvidenceMessage(approvalCard.verificationRun?.status === "passed"
          ? `Verification stale: ${approval.reason}. Run verification again.`
          : `Approval blocked: ${approval.reason}.`);
        return;
      }
      changeOps((current) => applyOpsOrchestration(current, approvalCard.id, "approve"));
      setReviewCard(undefined);
    } catch (cause) {
      setReviewEvidenceMessage(`Could not revalidate verification: ${message(cause)}`);
      setReviewEvidenceReady(false);
    }
  };

  const requestReviewChanges = async (card: OpsCard, feedback: string) => {
    const started = await startAgentForOpsTask(
      card,
      `Address requested changes for Ops task: ${card.title}\n\n${card.detail}\n\nReview feedback:\n${feedback.trim()}`,
    );
    if (started) setReviewCard(undefined);
    return started;
  };

  const removeSelectedProject = async () => {
    if (!removeProject) return;
    try {
      await callCore("project_remove", { projectId: removeProject.id, deleteFromDisk: false });
      const remaining = projects.filter((candidate) => candidate.id !== removeProject.id);
      setProjects(remaining);
      if (project?.id === removeProject.id) {
        setProject(undefined);
        setCanvas(undefined);
        setNodes([]);
        setRuntimes({});
        setLayout(null);
        setLayoutMode("auto");
        setSurface("home");
      }
      setRemoveProject(undefined);
    } catch (cause) {
      setError(message(cause));
    }
  };

  const nodeById = useMemo(
    () => Object.fromEntries([
      ...canvases.flatMap((candidate) => candidate.nodes),
      ...nodes,
    ].map((node) => [node.id, node])),
    [canvases, nodes],
  );
  const agentName = (id: string) => resolveAgentLabel(nodeById[id]?.title, opsState.agentLabels?.[id]);
  const botRuntimes = useMemo(() => Object.values(runtimes).map((runtime) => ({
    ...runtime,
    botProfileId: botSnapshotFromNode(nodeById[runtime.nodeId]?.data ?? {})?.profileId,
  })), [nodeById, runtimes]);
  const recentOneOffs = useMemo(() => {
    const savedSeeds = new Set(bots.map((bot) => bot.avatarSeed));
    const unique = new Map<string, BotSnapshot>();
    for (const node of nodes) {
      const snapshot = botSnapshotFromNode(node.data);
      if (snapshot?.source === "one-off" && !savedSeeds.has(snapshot.avatarSeed)) unique.set(snapshot.avatarSeed, snapshot);
    }
    return [...unique.values()].slice(0, 8);
  }, [bots, nodes]);
  const botActiveCount = botRuntimes.filter((runtime) => runtime.botProfileId && isActiveSessionStatus(runtime.status)).length;
  const attentionItems = useMemo(() => deriveAttention({
    runtimes: Object.values(runtimes),
    activity,
    opsState,
    nodes: nodeById,
  }), [activity, nodeById, opsState, runtimes]);
  const readyCodingAdapters = adapters.filter((adapter) =>
    adapter.id !== "generic-shell" && isAdapterReady(adapter, adapterArgsById[adapter.id] ?? []));
  useEffect(() => {
    if (!startupReady || safeStartupActive) return;
    const targets = adapters.flatMap((adapter) => {
      const profile = agentProfiles.find((candidate) => candidate.adapterId === adapter.id);
      const launchConfig = agentLaunchConfig(profile, project?.agentAccess);
      if (!shouldAutoVerifyAdapter(adapter, launchConfig.args)) return [];
      const key = JSON.stringify(agentVerificationConfig(profile, project?.agentAccess));
      const attempt = automaticAdapterVerificationRef.current.get(adapter.id);
      if (attempt?.pending || (attempt?.key === key && attempt.attempts >= 2)) return [];
      return [{ adapter, profile, key, launchConfig }];
    });
    if (!targets.length) return;
    const timer = window.setTimeout(() => {
      for (const target of targets) {
        const prior = automaticAdapterVerificationRef.current.get(target.adapter.id);
        automaticAdapterVerificationRef.current.set(target.adapter.id, {
          key: target.key,
          attempts: prior?.key === target.key ? prior.attempts + 1 : 1,
          pending: true,
        });
      }
      const targetIds = new Set(targets.map((target) => target.adapter.id));
      setAdapters((current) => current.map((adapter) => targetIds.has(adapter.id) && adapter.probe
        ? { ...adapter, probe: { ...adapter.probe, verificationStatus: "verifying", message: "Verifying automatically…" } }
        : adapter));
      for (const target of targets) {
        void (async () => {
          let probe: AdapterProbe;
          try {
            probe = await callCore<AdapterProbe>("adapter_verify", {
              adapterId: target.adapter.id,
              cwd: project?.path,
              ...target.launchConfig,
            });
          } catch (cause) {
            probe = {
              ...target.adapter.probe!,
              verificationStatus: "failed",
              message: `Automatic verification failed: ${message(cause)}`,
              checkedAt: new Date().toISOString(),
            };
          }
          const currentProfile = agentProfilesRef.current.find((candidate) => candidate.adapterId === target.adapter.id);
          if (JSON.stringify(agentVerificationConfig(currentProfile, projectRef.current?.agentAccess)) !== target.key) {
            probe = {
              ...probe,
              verificationStatus: "stale",
              message: "Launch configuration changed during verification. Retrying automatically…",
            };
          }
          const attempt = automaticAdapterVerificationRef.current.get(target.adapter.id);
          if (attempt?.key === target.key) automaticAdapterVerificationRef.current.set(target.adapter.id, { ...attempt, pending: false });
          setAdapters((current) => current.map((adapter) => adapter.id === target.adapter.id ? { ...adapter, probe } : adapter));
        })();
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [adapters, agentProfiles, project?.agentAccess, project?.path, safeStartupActive, startupReady]);
  const saveSchedulerConfig = async (enabled: boolean, paused: boolean, concurrencyLimit: number) => {
    const activeProject = projectRef.current;
    const activeCanvas = canvasRef.current;
    if (!activeProject || !activeCanvas) return;
    const config = await callCore<OpsSchedulerConfig>("ops_scheduler_configure", {
      projectId: activeProject.id,
      canvasId: activeCanvas.id,
      enabled,
      paused,
      concurrencyLimit,
      adapterId: selectedAdapterId,
    });
    setAutonomousPickup(config.enabled && !config.paused);
    setAutonomousConcurrency(config.concurrencyLimit);
    if (config.enabled && !config.paused) schedulerLeaseHandlerRef.current?.();
  };
  const updateAutonomousPickup = (enabled: boolean) => {
    const previous = autonomousPickup;
    setAutonomousPickup(enabled);
    void saveSchedulerConfig(true, !enabled, autonomousConcurrency)
      .catch((cause) => {
        setAutonomousPickup(previous);
        setError(`Could not ${enabled ? "resume" : "pause"} autonomous pickup: ${message(cause)}`);
      });
  };
  const updateAutonomousConcurrency = (concurrencyLimit: number) => {
    const previous = autonomousConcurrency;
    setAutonomousConcurrency(concurrencyLimit);
    void saveSchedulerConfig(true, !autonomousPickup, concurrencyLimit)
      .catch((cause) => {
        setAutonomousConcurrency(previous);
        setError(`Could not update autonomous concurrency: ${message(cause)}`);
      });
  };
  const scheduleAutonomousTaskRetry = async (cardId: string | undefined, detail: string) => {
    if (!cardId) return;
    await persistOpsImmediately((current) => {
      const card = current.cards.find((candidate) => candidate.id === cardId);
      if (!card) return current;
      const attempts = (card.attemptCount ?? 0) + 1;
      const retryDelay = attempts < 5
        ? Math.min(30_000, 1_000 * 2 ** Math.max(0, attempts - 1))
        : 5 * 60_000;
      const retryAt = new Date(Date.now() + retryDelay).toISOString();
      const released = applyOpsOrchestration(current, cardId, "release");
      return {
        ...released,
        cards: released.cards.map((candidate) => candidate.id === cardId
          ? appendOpsTaskEvent({
              ...candidate,
              attemptCount: attempts,
              retryAt,
              paused: false,
              reconciliation: {
                status: "retrying",
                attempts,
                message: detail,
                updatedAt: new Date().toISOString(),
              },
              lastNote: attempts < 5
                ? `Retrying autonomously after attempt ${attempts}.`
                : `Recovery will keep retrying in the background (attempt ${attempts}).`,
            }, {
              id: `scheduler:retry:${cardId}:${attempts}:${Date.now()}`,
              kind: "update",
              timestamp: new Date().toISOString(),
              message: `Autonomous retry ${attempts} scheduled`,
            })
          : candidate),
      };
    });
  };
  const claimScheduledTask = async () => {
    const activeProject = projectRef.current;
    if (!activeProject || !autonomousPickup || schedulerClaimPendingRef.current) return;
    schedulerClaimPendingRef.current = true;
    let lease: OpsTaskLease | null = null;
    let started = false;
    try {
      lease = await callCore<OpsTaskLease | null>("ops_scheduler_claim", {
        projectId: activeProject.id,
        ownerId: schedulerOwnerIdRef.current,
      });
      if (!lease) return;
      if (projectRef.current?.id !== activeProject.id) {
        await callCore("ops_scheduler_finish", {
          leaseId: lease.id,
          ownerId: schedulerOwnerIdRef.current,
          state: "released",
        }).catch(() => undefined);
        schedulerFinalizedLeaseIdsRef.current.add(lease.id);
        lease = null;
        return;
      }
      if (lease.canvasId !== canvasRef.current?.id) {
        throw new Error("The scheduler lease belongs to a different canvas.");
      }
      const card = opsStateRef.current.cards.find((candidate) => candidate.id === lease?.taskId);
      if (!card) {
        await callCore("ops_scheduler_finish", {
          leaseId: lease.id,
          ownerId: schedulerOwnerIdRef.current,
          state: "released",
        });
        schedulerFinalizedLeaseIdsRef.current.add(lease.id);
        lease = null;
        return;
      }
      started = await startAgentForOpsTask(card, opsActionPrompt(card, "assign"), "worker", lease.id, lease.adapterId);
      if (!started) throw new Error("The scheduled task could not start with the configured adapter.");
      await callCore("ops_scheduler_heartbeat", {
        leaseId: lease.id,
        ownerId: schedulerOwnerIdRef.current,
      });
    } catch (cause) {
      const detail = message(cause);
      if (lease) {
        await callCore("ops_scheduler_finish", {
          leaseId: lease.id,
          ownerId: schedulerOwnerIdRef.current,
          state: "released",
        }).catch(() => undefined);
        schedulerFinalizedLeaseIdsRef.current.add(lease.id);
        await scheduleAutonomousTaskRetry(lease.taskId, detail).catch(() => undefined);
      }
      setError(`A task could not start and will recover independently: ${detail}`);
    } finally {
      schedulerClaimPendingRef.current = false;
      if (autonomousPickup && started) queueMicrotask(() => schedulerLeaseHandlerRef.current?.());
    }
  };
  schedulerLeaseHandlerRef.current = () => void claimScheduledTask();
  useEffect(() => {
    if (!autonomousPickup) return;
    schedulerLeaseHandlerRef.current?.();
  }, [autonomousPickup, opsState]);
  useEffect(() => {
    const heartbeat = () => {
      for (const node of nodesRef.current) {
        const leaseId = stringValue(node.data, "schedulerLeaseId");
        const status = currentRuntimes()[node.id]?.status;
        if (!leaseId || !isActiveSessionStatus(status ?? "")) continue;
        void callCore("ops_scheduler_heartbeat", {
          leaseId,
          ownerId: schedulerOwnerIdRef.current,
        }).catch(() => undefined);
      }
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 30_000);
    return () => window.clearInterval(timer);
  }, [nodes, runtimes]);
  useEffect(() => {
    for (const node of nodes) {
      const leaseId = stringValue(node.data, "schedulerLeaseId");
      const runtime = runtimes[node.id];
      if (!leaseId || !runtime || !["failed", "canceled", "disconnected"].includes(runtime.status)) continue;
      if (schedulerFinalizedLeaseIdsRef.current.has(leaseId)) continue;
      schedulerFinalizedLeaseIdsRef.current.add(leaseId);
      void (async () => {
        try {
          await callCore("ops_scheduler_recover", { leaseId, state: "failed" });
          await scheduleAutonomousTaskRetry(stringValue(node.data, "taskId"), `${node.title} ${runtime.status}.`);
          setError(`${node.title} ${runtime.status}; its task will recover independently.`);
        } catch (cause) {
          schedulerFinalizedLeaseIdsRef.current.delete(leaseId);
          setError(`Could not finalize the failed autonomous task: ${message(cause)}`);
        }
      })();
    }
  // scheduleAutonomousTaskRetry is intentionally recreated with the latest durable state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, runtimes, setError]);
  const onboardingActive = onboardingVersion === 0;
  const onboardingVisible = surface === "home" && startupReady && onboardingActive;
  const onboardingStep = desktopOnboardingStep(project, selectedAdapterReady);
  const skipDesktopOnboarding = async () => {
    setBusy(true);
    setError("");
    try {
      await saveDesktopOnboardingVersion(DESKTOP_ONBOARDING_VERSION);
    } catch (cause) {
      setError(`Could not save onboarding: ${message(cause)}`);
    } finally {
      setBusy(false);
    }
  };
  const startOnboardingAgent = async (prompt: string) => {
    setSurface("terminal");
    const started = await spawnAgent(prompt);
    if (!started) setSurface("home");
    return started;
  };
  const startOnboardingShell = async () => {
    setSurface("terminal");
    const started = await spawnShell();
    if (!started) {
      setSurface("home");
      return false;
    }
    try {
      await saveDesktopOnboardingVersion(DESKTOP_ONBOARDING_VERSION);
      return true;
    } catch (cause) {
      setError(`The shell was created, but onboarding could not be saved: ${message(cause)}`);
      return false;
    }
  };
  const activatingProject = projects.find((candidate) => candidate.id === activatingProjectId);
  const terminalAgents = Object.values(runtimes).filter((runtime) => runtime.structured);
  const terminalAgentContexts: Record<string, TerminalAgentContext> = Object.fromEntries(terminalAgents.map((runtime) => [
    runtime.nodeId,
    (() => {
      const snapshot = botSnapshotFromNode(nodeById[runtime.nodeId]?.data ?? {});
      return {
        label: snapshot?.name ?? agentName(runtime.nodeId),
        avatarSeed: snapshot?.avatarSeed,
        botSnapshot: snapshot?.source === "one-off" && !bots.some((bot) => bot.avatarSeed === snapshot.avatarSeed) ? snapshot : undefined,
        card: opsCurrentCardForAgent(opsState, runtime.nodeId),
        attentionReason: opsStatusAttentionReason(runtime.status),
      };
    })(),
  ]));
  const terminalAttentionAgents = terminalAgents.filter((runtime) => terminalAgentContexts[runtime.nodeId]?.attentionReason);
  const terminalRailAgents = [
    ...terminalAttentionAgents,
    ...terminalAgents.filter((runtime) => !terminalAgentContexts[runtime.nodeId]?.attentionReason),
  ];
  const focusAgentPane = (paneId: string) => {
    setFocusedPaneId(paneId);
    if (zoomedPaneId) setZoomedPaneId(paneId);
  };
  const openOpsCard = (card: OpsCard) => {
    setInspectedOpsCardId(card.id);
    setOpsPage("floor");
    showSurface("ops");
  };
  const renderTerminalAgentMenu = (runtime: PaneRuntime) => {
    const context = terminalAgentContexts[runtime.nodeId];
    return <>
      <ContextMenuItem onSelect={() => focusAgentPane(runtime.nodeId)}><MonitorCog />Focus agent</ContextMenuItem>
      <PaneAgentMenuItems
        context
        runtime={runtime}
        agentContext={context}
        chatView={chatViews.has(runtime.nodeId)}
        onToggleView={() => void toggleAgentView(runtime)}
        onOpenOpsCard={openOpsCard}
        onResume={() => void resumeAgent(runtime)}
        onPrepareHandoff={() => prepareAgentHandoff(runtime)}
        onSaveBot={openSaveOneOff}
        onReviewTranscript={() => void reviewTranscript(runtime)}
        onQueryStatus={() => void queryAgentStatus(runtime)}
      />
      <DevToolsContextItem />
    </>;
  };
  const removeProjectHasActiveSessions = Boolean(
    removeProject &&
    sessions.some((session) =>
      session.status === "running" &&
      projectForSession(session)?.id === removeProject.id),
  );

  const requestConfirmation = useCallback((title: string, message: string, confirmLabel?: string) => {
    if (confirmationRef.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const request = { title, message, confirmLabel, resolve };
      confirmationRef.current = request;
      setConfirmation(request);
    });
  }, []);

  const completeConfirmation = useCallback((confirmed: boolean) => {
    const request = confirmationRef.current;
    if (!request) return;
    confirmationRef.current = undefined;
    setConfirmation(undefined);
    request.resolve(confirmed);
  }, []);

  const refreshAgentControlAudit = async () => {
    const activeCanvas = canvasRef.current;
    if (!activeCanvas) {
      setAgentControlAudit([]);
      return;
    }
    const audit = await callCore<AgentControlAudit[]>("agent_control_audit", {
      canvasId: activeCanvas.id,
      limit: 100,
    });
    setAgentControlAudit(audit);
  };

  useEffect(() => {
    if (surface !== "settings" || settingsPage !== "agents") return;
    void refreshAgentControlAudit().catch((cause) => setError(`Could not load agent autonomy history: ${message(cause)}`));
  }, [canvas?.id, settingsPage, surface, setError]);

  agentControlHandlerRef.current = async (sourceRuntime, control) => {
    const activeCanvas = canvasRef.current;
    const sourceNode = nodesRef.current.find((node) => node.id === sourceRuntime.nodeId);
    if (!activeCanvas || !sourceNode) throw new Error("The requesting agent is no longer attached to this workspace.");
    const waitForPromptableAgent = async (nodeId: string, timeoutMilliseconds = 120_000) => {
      const deadline = performance.now() + timeoutMilliseconds;
      while (performance.now() < deadline) {
        const runtime = currentRuntimes()[nodeId];
        if (!runtime || runtime.status === "disconnected") return undefined;
        if (!runtime.structured && runtime.status === "running") return runtime;
        if (["ready", "completed", "failed", "canceled"].includes(runtime.status)) return runtime;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
      }
      return undefined;
    };
    const authorization = await callCore<AgentControlAuthorization>("agent_control_authorize", {
      requestId: control.id,
      sourceSessionId: sourceRuntime.sessionId,
      sourceNodeId: sourceRuntime.nodeId,
      canvasId: activeCanvas.id,
      action: control.action,
      target: control.target,
      message: control.message,
      taskId: control.taskId,
      adapterId: control.adapterId,
      files: control.files,
    });
    const recordResult = async (success: boolean, resultMessage: string, targetNodeId?: string, childNodeId?: string) => {
      await callCore("agent_control_result", {
        requestId: control.id,
        sourceSessionId: sourceRuntime.sessionId,
        success,
        message: resultMessage,
        targetNodeId,
        childNodeId,
      });
      await refreshAgentControlAudit().catch(() => undefined);
      const feedback = `wheeljack control result ${control.id}: ${success ? "succeeded" : "failed"}. ${resultMessage}`;
      void waitForPromptableAgent(sourceRuntime.nodeId).then(async (liveSource) => {
        if (!liveSource || liveSource.sessionId !== sourceRuntime.sessionId) return;
        await sendAgentPrompt(liveSource, feedback).catch(() => false);
      });
    };
    if (authorization.decision === "deny") {
      await recordResult(false, authorization.reason, authorization.targetNodeId);
      return;
    }
    if (authorization.decision === "ask") {
      const confirmed = await requestConfirmation(
        `${sourceNode.title} requests ${control.action.replaceAll("_", " ")}`,
        [
          control.message,
          control.target ? `Target: ${control.target}` : "",
          control.taskId ? `Task: ${control.taskId}` : "",
          control.files ? `Remaining file claims:\n${control.files.length ? control.files.join("\n") : "None"}` : "",
        ].filter(Boolean).join("\n\n"),
      );
      if (!confirmed) {
        await recordResult(false, "User denied the requested autonomous action.", authorization.targetNodeId);
        return;
      }
    }

    try {
      let resultMessage = "Action completed.";
      let targetNodeId = authorization.targetNodeId;
      let childNodeId: string | undefined;
      if (control.action === "list_agents") {
        const roster = nodesRef.current
          .filter((node) => node.kind === "agent_terminal")
          .map((node) => ({
            id: node.id,
            name: node.title,
            adapterId: stringValue(node.data, "adapterId"),
            status: currentRuntimes()[node.id]?.status ?? (stringValue(node.data, "status") || "unknown"),
            taskId: stringValue(node.data, "taskId") || undefined,
            autonomyDepth: numberValue(node.data, "autonomyDepth") ?? 0,
          }));
        resultMessage = `Agents in this workspace:\n${JSON.stringify(roster, null, 2)}`;
      } else if (control.action === "send_message") {
        const targetRuntime = targetNodeId ? await waitForPromptableAgent(targetNodeId) : undefined;
        if (!targetRuntime) throw new Error("The target agent did not become available for the message.");
        const delivered = await sendAgentPrompt(
          targetRuntime,
          `Message from ${sourceNode.title}:\n\n${control.message?.trim() ?? ""}`,
        );
        if (!delivered) throw new Error("The target agent rejected the message.");
        resultMessage = "Message delivered.";
      } else if (control.action === "spawn_agent") {
        const started = await spawnAgent(
          control.message?.trim() ?? "",
          undefined,
          control.message?.trim() ?? "",
          "worker",
          undefined,
          control.adapterId || sourceRuntime.adapterId,
          {
            parentNodeId: sourceRuntime.nodeId,
            parentSessionId: sourceRuntime.sessionId,
            autonomyDepth: authorization.nextDepth,
            onSpawned: (node) => { childNodeId = node.id; },
          },
        );
        if (!started || !childNodeId) throw new Error("The child agent could not be started.");
        resultMessage = "Started child agent.";
      } else if (control.action === "resolve_file_conflict") {
        if (!project?.path || activeCanvas.projectId !== project.id) {
          throw new Error("The active project is no longer available.");
        }
        const card = opsStateRef.current.cards.find((candidate) => candidate.id === control.taskId);
        if (!card) throw new Error(`Task ${control.taskId ?? ""} was not found.`);
        const resolved = opsResolveFileConflict(
          opsStateRef.current,
          card.id,
          sourceRuntime.nodeId,
          control.files ?? [],
        );
        const updatedCard = resolved.cards.find((candidate) => candidate.id === card.id);
        const remainingFiles = updatedCard?.agentFiles?.[sourceRuntime.nodeId] ?? [];
        const priorFiles = card.agentFiles?.[sourceRuntime.nodeId]
          ?? (card.assigneeIds.length === 1 ? card.expectedFiles : []);
        const remainingSet = new Set(remainingFiles);
        const releasedFiles = priorFiles.filter((file) => !remainingSet.has(file));
        const board = await callCore<CoordinationBoardFiles>("coordination_board_sync", coordinationBoardSyncRequest(
          opsStateRef.current,
          project.path,
          currentRuntimes(),
          nodesRef.current,
        ));
        const currentStatus = card.agentStatuses[sourceRuntime.nodeId] ?? "";
        const status = ["queued", "running", "in_progress", "blocked", "needs_input", "review", "completed", "done", "paused"]
          .includes(currentStatus)
          ? currentStatus
          : "running";
        await callCore("coordination_board_ensure", {
          cwd: project.path,
          boardId: board.boardId,
          callsigns: [sourceNode.title],
          agentEvent: {
            callsign: sourceNode.title,
            task: card.title,
            taskId: card.id,
            status,
            expectedFiles: remainingFiles,
            note: control.message?.trim() || `Released overlapping file claims: ${releasedFiles.join(", ")}`,
          },
        });
        await refreshCoordination();
        resultMessage = releasedFiles.length
          ? `Released overlapping file claims: ${releasedFiles.join(", ")}.`
          : "Updated the task's file claims to remove the overlap.";
      } else {
        const card = opsStateRef.current.cards.find((candidate) => candidate.id === control.taskId);
        if (!card) throw new Error(`Task ${control.taskId ?? ""} was not found.`);
        const sourceOwnsTask = card.assigneeIds.includes(sourceRuntime.nodeId) || card.reviewerId === sourceRuntime.nodeId;
        if (!sourceOwnsTask) throw new Error("The requesting agent does not own this task.");
        const note = control.message?.trim();
        if (targetNodeId) {
          assertTaskLaneTarget(card, targetNodeId);
          if (!await waitForPromptableAgent(targetNodeId)) {
            throw new Error("The target agent did not become available for the task transition.");
          }
          const action = control.action === "handoff_task" ? "transfer" : "review";
          const assignment = {
            target: targetNodeId,
            task: `${opsActionPrompt(card, action)}${note ? `\n\nAgent note:\n${note}` : ""}`,
            taskId: card.id,
          };
          const preview = await previewAssignments([assignment]);
          const routed = await callCore<RouteExecuteResult>("route_execute", {
            workspaceId: activeCanvas.id,
            assignments: [assignment],
            confirmationToken: preview.confirmationToken,
          });
          if (!routed.targets.some((target) => target.delivered)) {
            throw new Error(routed.targets[0]?.reason ?? routed.message);
          }
          changeOps((current) => applyOpsOrchestration(
            current,
            card.id,
            action,
            targetNodeId,
            agentName(targetNodeId),
          ));
          resultMessage = control.action === "handoff_task" ? "Task handed off." : "Review requested.";
        } else {
          const role: OpsAgentRole = control.action === "request_review" ? "reviewer" : "worker";
          const prompt = `${opsActionPrompt(card, control.action === "request_review" ? "review" : "resume")}${note ? `\n\nAgent note:\n${note}` : ""}`;
          const started = await spawnAgent(
            prompt,
            card,
            prompt,
            role,
            undefined,
            control.adapterId || sourceRuntime.adapterId,
            {
              parentNodeId: sourceRuntime.nodeId,
              parentSessionId: sourceRuntime.sessionId,
              autonomyDepth: authorization.nextDepth,
              onSpawned: (node) => { childNodeId = node.id; },
            },
          );
          if (!started || !childNodeId) throw new Error("The fresh task agent could not be started.");
          if (control.action === "handoff_task") {
            changeOps((current) => applyOpsOrchestration(
              current,
              card.id,
              "transfer",
              childNodeId,
              agentName(childNodeId!),
            ));
          }
          resultMessage = control.action === "handoff_task"
            ? "Task handed off."
            : "Fresh reviewer started.";
        }
        await refreshCoordination();
      }
      await recordResult(true, resultMessage, targetNodeId, childNodeId);
    } catch (cause) {
      const detail = message(cause);
      await recordResult(false, detail, authorization.targetNodeId);
      throw cause;
    }
  };

  const installReadyUpdate = async (downloaded?: UpdateDownload) => {
    if (
      (downloaded?.signatureStatus ?? updater.signatureStatus) === "unsigned"
      && !await requestConfirmation(
        "Install unsigned wheeljack update?",
        "This update passed its SHA-256 check but is not signed by a trusted Windows publisher. Continue only if you trust this release.",
      )
    ) {
      return;
    }
    await updater.installNow(downloaded?.updatePath);
  };

  const startTitleBarUpdate = async () => {
    if (updater.status === "ready") {
      await installReadyUpdate();
      return;
    }
    if (
      updater.status !== "available"
      || !await requestConfirmation(
        `Update wheeljack to ${updater.update?.version ?? "the latest version"}?`,
        "wheeljack will download and verify the update, close, replace itself, and reopen.",
        "Update now",
      )
    ) {
      return;
    }
    const downloaded = await updater.downloadNow();
    if (downloaded) await installReadyUpdate(downloaded);
  };

  const commandPaletteItems: CommandPaletteItem[] = [
    ...(surface !== "home" ? [{
      id: "home",
      group: "Navigate",
      label: "Go to Home",
      keywords: ["workspace"],
      icon: <Home />,
      onSelect: () => showSurface("home"),
    }] : []),
    ...(project && surface !== "terminal" ? [{
      id: "work",
      group: "Navigate",
      label: "Open Work",
      keywords: ["terminal", "shell", project.name],
      icon: <Terminal />,
      onSelect: () => showSurface("terminal"),
    }] : []),
    ...(project && surface !== "ops" ? [{
      id: "plan",
      group: "Navigate",
      label: "Open Plan",
      keywords: ["board", "tasks", "prd", "tdd", project.name],
      icon: <LayoutDashboard />,
      onSelect: () => showSurface("ops"),
    }] : []),
    ...(surface !== "settings" ? [{
      id: "settings",
      group: "Navigate",
      label: "Open Settings",
      keywords: ["appearance", "workspace", "agents", "application"],
      icon: <MonitorCog />,
      onSelect: () => showSurface("settings"),
    }] : []),
    ...(!busy ? [{
      id: "open-folder",
      group: "Navigate",
      label: "Open folder…",
      keywords: ["project", "workspace"],
      icon: <Folder />,
      onSelect: () => void pickProject(),
    }] : []),
    ...(!busy ? projects
      .filter((item) => item.id !== project?.id && item.pathExists !== false)
      .map((item): CommandPaletteItem => ({
        id: `project-${item.id}`,
        group: "Projects",
        label: `Switch to ${item.name}`,
        keywords: [item.path, item.branch, "work"],
        icon: <Folder />,
        onSelect: () => void navigateProject(item, "terminal"),
      })) : []),
    ...(!busy && canvas && project ? [
      {
        id: "new-agent",
        group: "Create",
        label: "New agent…",
        keywords: ["ai", "assistant", "pane"],
        icon: <MonitorCog />,
        onSelect: () => {
          showSurface("terminal");
          setAgentCreatorOpen(true);
        },
      },
      {
        id: "shell-smart",
        group: "Create",
        label: "New shell",
        keywords: ["terminal", "pane", "smart", "auto", "bento"],
        icon: <Terminal />,
        onSelect: () => {
          showSurface("terminal");
          void spawnShell();
        },
      },
      {
        id: "shell-right",
        group: "Create",
        label: "Shell split right",
        keywords: ["terminal", "pane", "columns"],
        icon: <Terminal />,
        onSelect: () => {
          showSurface("terminal");
          void spawnShell("columns");
        },
      },
      {
        id: "shell-down",
        group: "Create",
        label: "Shell split down",
        keywords: ["terminal", "pane", "rows"],
        icon: <Terminal />,
        onSelect: () => {
          showSurface("terminal");
          void spawnShell("rows");
        },
      },
      {
        id: "note",
        group: "Create",
        label: "New Note",
        keywords: ["markdown", "pane"],
        icon: <FileCode2 />,
        onSelect: () => {
          showSurface("terminal");
          void spawnDataPane("markdown_note");
        },
      },
      {
        id: "checklist",
        group: "Create",
        label: "New Checklist",
        keywords: ["tasks", "pane"],
        icon: <CheckIcon />,
        onSelect: () => {
          showSurface("terminal");
          void spawnDataPane("task_checklist");
        },
      },
      {
        id: "browser-preview",
        group: "Create",
        label: "New Browser Preview",
        keywords: ["web", "url", "pane"],
        icon: <Square />,
        onSelect: () => {
          showSurface("terminal");
          void spawnDataPane("browser_preview");
        },
      },
    ] : []),
    ...(!busy && project ? [{
      id: "new-canvas",
      group: "Create",
      label: "New canvas",
      keywords: ["workspace", "tabs"],
      icon: <Plus />,
      onSelect: () => {
        showSurface("terminal");
        void createCanvas();
      },
    }] : []),
    {
      id: "bots",
      group: "Utilities",
      label: "Open Bots",
      keywords: ["specialists", "agents", "profiles", "roster"],
      icon: <Briefcase />,
      onSelect: () => showSurface("bots"),
    },
    {
      id: "usage",
      group: "Utilities",
      label: "Open API Usage",
      keywords: ["cost", "tokens", "spend", "metering"],
      icon: <Activity />,
      onSelect: () => showSurface("usage"),
    },
    {
      id: "inbox",
      group: "Utilities",
      label: "Open Inbox",
      keywords: ["attention", "approvals", "questions"],
      icon: <Bell />,
      onSelect: () => selectUtilityPanel("inbox"),
    },
    {
      id: "git",
      group: "Utilities",
      label: "Open Git",
      keywords: ["changes", "diff", "branch"],
      icon: <GitBranch />,
      onSelect: () => selectUtilityPanel("git"),
    },
    {
      id: "history",
      group: "Utilities",
      label: "Open History",
      keywords: ["sessions", "transcripts", "activity"],
      icon: <History />,
      onSelect: () => selectUtilityPanel("history"),
    },
  ];

  const sidebarIsCollapsed = preferences.sidebarCollapsed || compactWindow;
  if (surface === "home") stickerLensReloadPendingRef.current = true;
  else if (shouldReloadStickerLens(surface, Boolean(project), stickerLensReloadPendingRef.current)) {
    stickerLensSceneRef.current = createStickerLensScene();
    stickerLensReloadPendingRef.current = false;
  }
  const stickerLensHost = surface === "terminal" ? terminalStickerLensHost : surface === "ops" ? opsStickerLensHost : null;
  return (
    <>
    <Toast.Provider duration={8000} swipeDirection="up">
    <div
      className="wj-app-shell"
      data-core-connected={startupReady}
      data-sidebar-collapsed={sidebarIsCollapsed}
      style={{ "--wj-sidebar-width": `${sidebarIsCollapsed ? 48 : preferences.sidebarWidth}px` } as CSSProperties}
    >
      <TitleBar
        onboarding={onboardingVisible}
        surface={surface}
        project={project}
        settingsPage={settingsPage}
        inboxCount={attentionItems.length}
        utilityPanelOpen={utilityPanelOpen}
        utilityPanelTab={preferences.utilityPanelTab}
        opsPage={opsPage}
        onSurface={showSurface}
        onOpsPage={setOpsPage}
        onUtilityPanel={(tab) => selectUtilityPanel(tab, true)}
        updater={updater}
        onUpdate={() => void startTitleBarUpdate()}
      />
      <ContextMenu>
      <ContextMenuTrigger asChild>
      <div className="wj-shell-body" onContextMenuCapture={(event) => {
        if ((event.target as Element).closest("input, textarea, [contenteditable=true]")) event.stopPropagation();
      }}>
        {!onboardingVisible && (
          <ProjectSidebar
            collapsed={sidebarIsCollapsed}
            width={preferences.sidebarWidth}
            projects={projects}
            project={project}
            surface={surface}
            sessions={sessions}
            loading={!startupReady || Boolean(activatingProjectId)}
            loadingProjectId={activatingProjectId}
            onCollapsed={compactWindow ? undefined : (sidebarCollapsed) => updatePreferences({ sidebarCollapsed })}
            onWidth={(sidebarWidth) => updatePreferences({ sidebarWidth })}
            onSurface={showSurface}
            onProject={(item, nextSurface) => void navigateProject(item, nextSurface)}
            onOpen={() => void pickProject()}
            onCustomize={setCustomizeProject}
            onRelink={(item) => void relinkProject(item)}
            onRemove={setRemoveProject}
          />
        )}
        <section className="wj-workspace">
          {preferences.showStickerLensBackground && <StickerLensBackground host={stickerLensHost} scene={stickerLensSceneRef.current} />}
          {!onboardingVisible && recoveryNoticeOpen && coreStatus?.startupRecovery?.previousUncleanShutdown && (
            <aside className="wj-startup-recovery" role="status" aria-label="Unexpected shutdown recovery">
              <span className="wj-startup-recovery-icon"><RefreshCw /></span>
              <div>
                <strong>wheeljack recovered from an unexpected shutdown</strong>
                <p>{safeStartupActive
                  ? "Automatic workspace restore and autonomous pickup are paused for this launch. Your saved tasks and transcripts are intact."
                  : "Your saved tasks and transcripts were recovered."}</p>
                {coreStatus.recoveredSessions > 0 && <small>{coreStatus.recoveredSessions} interrupted {coreStatus.recoveredSessions === 1 ? "session was" : "sessions were"} preserved in History.</small>}
              </div>
              <div className="wj-startup-recovery-actions">
                {coreStatus.startupRecovery.crashReportPath && <Button variant="ghost" size="xs" onClick={() => void navigator.clipboard.writeText(coreStatus.startupRecovery.crashReportPath ?? "")}>Copy report path</Button>}
                <Button variant="ghost" size="xs" onClick={() => setRecoveryNoticeOpen(false)}>Stay on Home</Button>
                {safeStartupActive && <Button size="xs" disabled={busy} onClick={() => void resumeSafeStartup().catch((cause) => setError(`Could not resume normal startup: ${message(cause)}`))}>Resume workspace</Button>}
              </div>
            </aside>
          )}
          {!onboardingVisible && errorToasts.map((toast) => (
            <Toast.Root
              className="wj-error-toast"
              key={toast.id}
              open={toast.open}
              onOpenChange={(open) => !open && closeErrorToast(toast)}
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget && event.currentTarget.dataset.state === "closed") {
                  setErrorToasts((current) => current.filter((item) => item.id !== toast.id));
                }
              }}
            >
              <span className="wj-error-toast-icon"><Bell /></span>
              <Toast.Description className="wj-error-toast-message">{toast.message}</Toast.Description>
              <Toast.Close asChild><Button variant="ghost" size="icon-xs" aria-label="Dismiss error"><X /></Button></Toast.Close>
            </Toast.Root>
          ))}
          <Toast.Viewport className="wj-toast-viewport" label="Notifications ({hotkey})" />
          {onboardingVisible && (
            <OnboardingSurface
              step={onboardingStep}
              project={project}
              adapters={adapters}
              adapterArgsById={adapterArgsById}
              selectedAdapterId={selectedAdapterId}
              busy={busy}
              error={error}
              repairCommand={adapterRepairCommand(
                adapters.find((adapter) => adapter.id === selectedAdapterId),
                agentProfiles.find((profile) => profile.adapterId === selectedAdapterId),
              )}
              onOpen={() => void pickProject()}
              onSkip={() => void skipDesktopOnboarding()}
              onAdapter={(id) => {
                setError("");
                selectAgentAdapter(id);
              }}
              onRescan={() => void rescanAdapters()}
              onVerify={() => void verifyAdapter()}
              onRepair={() => void repairAdapter()}
              onAgentSettings={() => {
                setSettingsPage("agents");
                setSurface("settings");
              }}
              onStartAgent={startOnboardingAgent}
              onStartShell={startOnboardingShell}
            />
          )}
          {surface === "home" && !onboardingVisible && (
            <HomeSurface
              projects={projects}
              sessions={sessions}
              activity={activity}
              attention={attentionItems}
              git={git}
              loading={busy || !connection || !startupReady}
              loadingProjectId={activatingProjectId}
              onOpen={() => void pickProject()}
              onProject={(item, nextSurface) => void navigateProject(item, nextSurface)}
              onCustomize={setCustomizeProject}
              onRelink={(item) => void relinkProject(item)}
              onSession={(session) => void openSession(session)}
              onRemove={setRemoveProject}
              onActivity={(item) => void openActivity(item)}
              onAttention={(item) => void openAttention(item)}
              onResearch={() => void launchResearch()}
              onBootstrapPlan={bootstrapProjectPlan}
              onTerminal={() => setSurface("terminal")}
              onInbox={() => selectUtilityPanel("inbox")}
              onGit={() => selectUtilityPanel("git")}
              showRecentActivity={preferences.showRecentActivity}
              showAgentRail={preferences.showAgentRail}
              showProjectPaths={preferences.showProjectPaths}
              agentReady={selectedAdapterReady}
              bots={bots}
              botActiveCount={botActiveCount}
              onBots={() => setSurface("bots")}
              onAgentSettings={() => {
                setSettingsPage("agents");
                setSurface("settings");
              }}
            />
          )}
          {surface === "bots" && (
            <Suspense fallback={<div className="wj-usage-loading" role="status">Loading bots…</div>}>
              <BotsSurface
                bots={bots}
                oneOffs={recentOneOffs}
                adapters={adapters}
                project={project}
                runtimes={botRuntimes}
                loading={botsLoading}
                onCreate={() => openCreateBot()}
                onSave={saveBot}
                onDelete={(profile) => void deleteSavedBot(profile).catch((cause) => setError(message(cause)))}
                onStart={(profile) => void startSavedBot(profile)}
                onSaveOneOff={openSaveOneOff}
              />
            </Suspense>
          )}
          {surface === "usage" && (
            <Suspense fallback={<div className="wj-usage-loading" role="status">Loading usage…</div>}>
              <UsageSurface
                refreshKey={usageRefreshVersion}
                onOpenSession={(item: UsageSessionRow) => void openHistorySession({
                  id: item.sessionId,
                  nodeId: item.nodeId,
                  nodeTitle: item.nodeTitle,
                  adapterId: item.adapterId,
                  cwd: item.cwd,
                  status: item.status,
                  startedAt: item.startedAt,
                })}
              />
            </Suspense>
          )}
          {surface === "terminal" && (
            <main className="wj-terminal-page" aria-labelledby="terminal-surface-heading">
              <h1 className="sr-only" id="terminal-surface-heading">Work</h1>
              <div className="wj-surface-toolbar wj-work-toolbar">
                <div className="wj-project-actions">
                <div className="wj-toolbar-group">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="wj-toolbar-action" aria-label="New pane" title={`New pane (${formatShortcut(shortcuts["pane.shell"])} opens a shell)`} variant="secondary" size="sm" disabled={busy || !canvas}><Plus /><span>New pane</span></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="min-w-56" align="end">
                      <DropdownMenuItem onSelect={() => void spawnShell()}><Terminal />New shell<DropdownMenuShortcut>{formatShortcut(shortcuts["pane.shell"])}</DropdownMenuShortcut></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void spawnShell("columns")}><Terminal />Shell split right<DropdownMenuShortcut>{formatShortcut(shortcuts["pane.splitRight"])}</DropdownMenuShortcut></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void spawnShell("rows")}><Terminal />Shell split down<DropdownMenuShortcut>{formatShortcut(shortcuts["pane.splitDown"])}</DropdownMenuShortcut></DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => void spawnDataPane("markdown_note")}>Note</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void spawnDataPane("task_checklist")}>Checklist</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void spawnDataPane("browser_preview")}>Browser Preview</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={enableSmartLayout}>{layoutMode === "auto" ? <CheckIcon /> : <LayoutDashboard />}Smart arrange<DropdownMenuShortcut>{formatShortcut(shortcuts["pane.equalize"])}</DropdownMenuShortcut></DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="wj-toolbar-actions">
                  <div className="wj-agent-launcher">
                    <Button
                      className="wj-toolbar-action wj-agent-launch-primary"
                      aria-label={`Quick start ${selectedAdapter?.displayName ?? "agent"}`}
                      title={selectedAdapterReady ? `Quick start ${selectedAdapter?.displayName ?? "agent"} · smart placement` : "Verify an agent before quick start"}
                      size="sm"
                      disabled={busy || !canvas || !selectedAdapterReady}
                      onClick={() => void spawnAgent("")}
                    ><ProviderMark adapterId={selectedAdapterId} /><span>Agent</span></Button>
                    <Popover open={agentCreatorOpen} onOpenChange={(open) => {
                      setAgentCreatorOpen(open);
                      if (open) setAgentPlacement("auto");
                      if (!open) {
                        setAgentTask(undefined);
                        setAgentTaskRole("worker");
                      }
                    }}>
                      <PopoverTrigger asChild><Button className="wj-agent-launch-options" aria-label="Configure new agent" title="Agent options" size="icon-sm" disabled={busy || !canvas}><ChevronRight className="rotate-90" /></Button></PopoverTrigger>
                      <PopoverContent className="wj-agent-creator" align="end" onOpenAutoFocus={(event) => { event.preventDefault(); agentPromptRef.current?.focus(); }} onCloseAutoFocus={(event) => {
                        if (!focusCreatedAgentRef.current) return;
                        focusCreatedAgentRef.current = false;
                        event.preventDefault();
                        document.querySelector<HTMLTextAreaElement>('.pane.focused textarea[aria-label="Agent prompt"]')?.focus();
                      }}>
                      <form className="wj-agent-creator-form" aria-busy={busy} onSubmit={(event) => {
                        event.preventDefault();
                        if (!selectedIntentReady) return;
                        const task = agentTask;
                        const taskRole = agentTaskRole;
                        const draftPrompt = agentPrompt;
                        const draftIntent = agentIntent;
                        const focusComposer = !agentPrompt.trim();
                        focusCreatedAgentRef.current = focusComposer;
                        setAgentCreatorOpen(false);
                        setAgentTask(undefined);
                        setAgentTaskRole("worker");
                        void spawnAgent(draftPrompt, task, draftPrompt, taskRole, undefined, undefined, undefined, agentPlacement, undefined, false, draftIntent).then((started) => {
                          if (started) return;
                          focusCreatedAgentRef.current = false;
                          setAgentPrompt(draftPrompt);
                          setAgentTask(task);
                          setAgentTaskRole(taskRole);
                          setAgentIntent(draftIntent);
                          setAgentCreatorOpen(true);
                        });
                      }}>
                        <div><strong>{agentTask ? `New task ${agentTaskRole}` : "Agent options"}</strong><p>{agentTask ? "Choose a ready adapter. wheeljack will open a fresh dedicated agent in this task’s workspace." : "Leave the prompt blank to open a focused composer, or add one to start immediately."}</p></div>
                        <div className="wj-agent-creator-options">
                          <Select value="ad-hoc" onValueChange={(value) => {
                            if (value === "ad-hoc") return;
                            const bot = bots.find((candidate) => candidate.id === value);
                            if (!bot) return;
                            setAgentCreatorOpen(false);
                            void startSavedBot(bot);
                          }}>
                            <SelectTrigger aria-label="Agent or bot"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ad-hoc">Ad hoc agent</SelectItem>
                              {bots.map((bot) => <SelectItem key={bot.id} value={bot.id}>{bot.name} · {bot.scope === "global" ? "Global" : "Project"}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Select value={selectedAdapterId} onValueChange={selectAgentAdapter}>
                            <SelectTrigger aria-label="Structured agent adapter"><SelectValue placeholder="Choose an adapter" /></SelectTrigger>
                            <SelectContent>{adapters.filter((adapter) => adapter.id !== "generic-shell").map((adapter) => <SelectItem disabled={!isAdapterReady(adapter, adapterArgsById[adapter.id] ?? [])} key={adapter.id} value={adapter.id}><span className="wj-provider-label"><ProviderMark adapterId={adapter.id} /><span>{adapter.displayName} · {adapterReadinessLabel(adapter, adapterArgsById[adapter.id] ?? [])}</span></span></SelectItem>)}</SelectContent>
                          </Select>
                          <Select value={agentIntent} onValueChange={(value) => setAgentIntent(value as AgentSessionIntent)}>
                            <SelectTrigger aria-label="Agent session intent"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="code">Code · may change the project</SelectItem>
                              <SelectItem value="ask" disabled={!supportsAskIntent(selectedAdapterId)}>Ask · enforced read-only</SelectItem>
                            </SelectContent>
                          </Select>
                          {agentIntent === "ask" && !supportsAskIntent(selectedAdapterId) && <p className="text-sm text-muted-foreground" role="status">Ask mode requires a verified Codex or Claude adapter.</p>}
                          <div className="wj-agent-placement" role="group" aria-label="Agent placement">
                            <Button type="button" variant={agentPlacement === "auto" ? "secondary" : "ghost"} size="icon-xs" aria-label="Arrange agent automatically" title="Smart layout" aria-pressed={agentPlacement === "auto"} onClick={() => setAgentPlacement("auto")}><LayoutDashboard /></Button>
                            <Button type="button" variant={agentPlacement === "columns" ? "secondary" : "ghost"} size="icon-xs" aria-label="Split agent right" title="Split right" aria-pressed={agentPlacement === "columns"} onClick={() => setAgentPlacement("columns")}><Columns2 /></Button>
                            <Button type="button" variant={agentPlacement === "rows" ? "secondary" : "ghost"} size="icon-xs" aria-label="Split agent down" title="Split down" aria-pressed={agentPlacement === "rows"} onClick={() => setAgentPlacement("rows")}><Columns2 className="rotate-90" /></Button>
                          </div>
                        </div>
                        {readyCodingAdapters.length === 0 && <p className="text-sm text-muted-foreground" role="status">No verified coding agent is available. Rescan adapters, then verify the launch profile in Settings.</p>}
                        <Textarea ref={agentPromptRef} className="min-h-24 resize-none" aria-label="Initial agent prompt" value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} onKeyDown={(event) => {
                          if (event.nativeEvent.isComposing || event.key !== "Enter" || event.shiftKey) return;
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }} placeholder="What should this agent work on?" />
                        <div className="flex items-center justify-between">
                          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => {
                            const launch = { initialPrompt: agentPrompt, displayPrompt: agentPrompt, opsTask: agentTask, opsRole: agentTaskRole, placement: agentPlacement };
                            setAgentCreatorOpen(false);
                            openCreateBot(launch);
                          }}>Create bot</Button>
                          <Button type="submit" aria-label="Create agent" size="sm" disabled={!selectedIntentReady || (agentIntent === "ask" && !supportsAskIntent(selectedAdapterId))}>{agentPrompt.trim() ? "Create & start" : "Create & focus"}</Button>
                        </div>
                      </form>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                </div>
              <div className="wj-canvas-bar">
                <Tabs className="wj-canvas-tabs" value={canvas?.id ?? ""} onValueChange={(id) => {
                  const nextCanvas = canvases.find((candidate) => candidate.id === id);
                  if (nextCanvas && nextCanvas.id !== canvas?.id) void activateCanvas(nextCanvas);
                }}>
                  <TabsList aria-label="Canvases">
                    {canvases.map((item) => (
                      <ContextMenu key={item.id}>
                      <ContextMenuTrigger asChild>
                      <span className={`wj-canvas-tab${item.id === canvas?.id ? " active" : ""}`}>
                        <TabsTrigger aria-label={`Open canvas ${item.name}`} value={item.id}><span>{item.name}</span></TabsTrigger>
                        <Popover open={canvasMenuId === item.id} onOpenChange={(open) => {
                          if (!open) {
                            setCanvasMenuId((current) => current === item.id ? undefined : current);
                            return;
                          }
                          void openCanvasMenu(item);
                        }}>
                          <PopoverTrigger asChild><Button className="wj-canvas-tab-actions" variant="ghost" size="icon-xs" aria-label={`Canvas actions for ${item.name}`} disabled={busy}><MoreHorizontal /></Button></PopoverTrigger>
                          <PopoverContent className="wj-canvas-manager" align="start">
                            <div><strong>{canvas?.name ?? "Canvas"}</strong><p>Rename or remove the current canvas.</p></div>
                            <form onSubmit={(event) => { event.preventDefault(); void renameCanvas(); }}>
                              <Input aria-label="Canvas name" value={canvasNameDraft} onChange={(event) => setCanvasNameDraft(event.target.value)} />
                              <Button type="submit" size="sm" variant="outline" disabled={!canvasNameDraft.trim() || canvasNameDraft.trim() === canvas?.name}>Rename</Button>
                            </form>
                            <Button variant="destructive" size="sm" disabled={canvases.length <= 1 || nodes.some((node) => Boolean(runtimes[node.id]))} onClick={() => void deleteCanvas()}><Trash2 />Delete canvas</Button>
                            {canvases.length <= 1 && <small role="status">Keep at least one canvas.</small>}
                            {canvases.length > 1 && nodes.some((node) => Boolean(runtimes[node.id])) && <small role="status">Close runtime panes before deleting this canvas.</small>}
                          </PopoverContent>
                        </Popover>
                      </span>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="min-w-48">
                        <ContextMenuItem disabled={busy || item.id === canvas?.id} onSelect={() => void activateCanvas(item)}>Switch to canvas</ContextMenuItem>
                        <ContextMenuItem disabled={busy} onSelect={() => void openCanvasMenu(item)}>Rename…</ContextMenuItem>
                        <ContextMenuItem disabled={busy || !project} onSelect={() => void createCanvas()}><Plus />New canvas</ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem variant="destructive" disabled={busy || canvases.length <= 1} onSelect={() => void (async () => {
                          if (item.id !== canvasRef.current?.id) await activateCanvas(item);
                          await deleteCanvas();
                        })()}><Trash2 />Delete canvas…</ContextMenuItem>
                        <DevToolsContextItem />
                      </ContextMenuContent>
                      </ContextMenu>
                    ))}
                  </TabsList>
                </Tabs>
                <Button className="wj-canvas-add" variant="ghost" size="icon-xs" aria-label="New canvas" title="New canvas" disabled={busy || !project} onClick={() => void createCanvas()}><Plus /></Button>
              </div>
              </div>
              <div className="wj-terminal-content">
                <div className="wj-stage" ref={stageRef} aria-busy={busy}>
                  {activatingProjectId ? (
                    <div className="wj-empty-stage">
                      <ProjectEmptyState
                        icon={<DotMatrixLoader variant="boot" size={30} />}
                        title={`Opening ${activatingProject?.name ?? "project"}`}
                        description="Loading canvases, sessions, and project state…"
                      />
                    </div>
                  ) : layout ? (
                    <Suspense fallback={<div className="wj-empty-stage" role="status"><DotMatrixLoader size={22} />Loading workspace…</div>}>
                      <SplitView
                      node={zoomedPaneId ? { type: "leaf", paneId: zoomedPaneId } : layout}
                      path=""
                      nodes={nodeById}
                      runtimes={runtimes}
                      agentContexts={terminalAgentContexts}
                      agentProfiles={agentProfiles}
                      projectId={project?.id}
                      projectRoot={project?.path}
                      agentAccess={project?.agentAccess}
                      focusedPaneId={focusedPaneId}
                      zoomedPaneId={zoomedPaneId}
                      chatViews={chatViews}
                      showPaneActions={preferences.showPaneActions}
                      shortcuts={shortcuts}
                      onFocus={setFocusedPaneId}
                      onOpenOpsCard={openOpsCard}
                      onClose={(id) => void closePane(id)}
                      onSplit={(id, axis) => {
                        setFocusedPaneId(id);
                        void spawnShell(axis, id);
                      }}
                      onZoom={(id) => setZoomedPaneId((current) => current ? null : id)}
                      onMove={(source, target, axis, before) => {
                        if (!layout) return;
                        const next = movePane(layout, source, target, axis, before);
                        applyLayout(next, source, "manual");
                      }}
                      onSaveData={(node, data) => void savePaneData(node, data)}
                      onAgentComposition={saveAgentComposition}
                      onToggleView={(runtime) => void toggleAgentView(runtime)}
                      onRatio={(path, ratio) => {
                        const next = setSplitRatio(layout, path, ratio);
                        applyLayout(next, focusedPaneIdRef.current, "manual");
                      }}
                      onWrite={terminalWrite}
                      onResize={terminalResize}
                      onViewport={(runtime, offset) => void terminalViewport(runtime, offset)}
                      onPaint={recordPaint}
                      onResizePaint={recordResizePaint}
                      onPrompt={(runtime, prompt, images) => sendAgentPrompt(runtime, prompt, prompt, images)}
                      onPromptEdit={editAgentPromptDelivery}
                      onPromptRetry={retryAgentPromptDelivery}
                      onPromptCancel={cancelAgentPromptDelivery}
                      onRespond={respondToAgent}
                      onCancel={cancelAgentTurn}
                      onAgentAccess={saveProjectAgentAccess}
                      onAgentProfile={updateAgentProfile}
                      onRepair={(runtime) => repairAdapter(runtime.adapterId)}
                      onResume={(runtime) => void resumeAgent(runtime)}
                      onPrepareHandoff={prepareAgentHandoff}
                      onSaveBot={openSaveOneOff}
                      onReviewTranscript={(runtime) => void reviewTranscript(runtime)}
                      onQueryStatus={(runtime) => void queryAgentStatus(runtime)}
                      onLoadOlderHistory={loadOlderAgentHistory}
                      />
                    </Suspense>
                  ) : (
                    <div className="wj-empty-stage" ref={setTerminalStickerLensHost}>
                      <ProjectEmptyState
                        icon={<Terminal />}
                        title={project ? "Start with an agent" : "Open a project folder"}
                        description={project ? "Give an agent a focused task, or open a shell for direct work." : "Open a folder to create your first wheeljack workspace."}
                      >
                        {project
                          ? <><Button onClick={() => setAgentCreatorOpen(true)}><Plus />Start agent</Button><Button variant="secondary" onClick={() => void spawnShell()}><Terminal />Create shell</Button></>
                          : <Button onClick={() => void pickProject()}><Folder />Open folder</Button>}
                      </ProjectEmptyState>
                    </div>
                  )}
                </div>
                {preferences.showAgentRail && <aside className={`wj-agent-rail wj-terminal-agent-rail ${teamRailCollapsed ? "collapsed" : ""}`} aria-label="Terminal agent team" style={{ "--wj-agent-rail-width": `${teamRailWidth}px` } as CSSProperties}>
                  {!teamRailCollapsed && <div className="wj-agent-rail-resizer" role="separator" tabIndex={0} aria-label="Resize terminal agent rail" aria-orientation="vertical" aria-valuemin={190} aria-valuemax={380} aria-valuenow={teamRailWidth} onPointerDown={(event) => beginHorizontalResize(event, teamRailWidth, 190, 380, -1, setTeamRailWidth, setTeamRailCollapsed)} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); if (event.key === "ArrowRight" && teamRailWidth <= 190) setTeamRailCollapsed(true); else setTeamRailWidth((current) => Math.min(380, Math.max(190, current + (event.key === "ArrowLeft" ? 8 : -8)))); } }} />}
                  <div className="wj-agent-rail-header"><div><div className="wj-section-label">Team</div>{!teamRailCollapsed && <span>{terminalAgents.length} sessions</span>}</div>{terminalAttentionAgents.length > 0 && <strong className="wj-agent-attention-count" aria-hidden="true">{terminalAttentionAgents.length}</strong>}<Button aria-label={`${teamRailCollapsed ? "Expand" : "Collapse"} terminal agent rail${terminalAttentionAgents.length ? `, ${terminalAttentionAgents.length} need attention` : ""}`} variant="ghost" size="icon-xs" onClick={() => setTeamRailCollapsed((value) => !value)}>{teamRailCollapsed ? <ChevronsLeft /> : <ChevronsRight />}</Button></div>
                  {teamRailCollapsed
                    ? <div className="wj-agent-rail-stack">{terminalRailAgents.slice(0, 6).map((runtime) => {
                      const context = terminalAgentContexts[runtime.nodeId];
                      return <ContextMenu key={runtime.nodeId}><ContextMenuTrigger asChild><button type="button" className="wj-terminal-agent-target" aria-label={`Focus ${context.label}`} onClick={() => focusAgentPane(runtime.nodeId)}><AgentAvatar id={context.avatarSeed ?? runtime.nodeId} label={context.label} status={runtime.status} /></button></ContextMenuTrigger><ContextMenuContent className="min-w-52">{renderTerminalAgentMenu(runtime)}</ContextMenuContent></ContextMenu>;
                    })}</div>
                    : <div className="wj-agent-list">{terminalRailAgents.map((runtime) => {
                      const context = terminalAgentContexts[runtime.nodeId];
                      const runtimeDetail = visibleRunStateDetail(runtime.status, runtime.statusSummary);
                      return <ContextMenu key={runtime.nodeId}><ContextMenuTrigger asChild><article className="wj-agent-status" data-status={runtime.status} data-attention={context.attentionReason ? "true" : undefined}>
                        <button type="button" className="wj-terminal-agent-target" aria-label={`Focus ${context.label}`} onClick={() => focusAgentPane(runtime.nodeId)}><AgentAvatar id={context.avatarSeed ?? runtime.nodeId} label={context.label} status={runtime.status} /></button>
                        <div className="min-w-0"><div><button type="button" className="wj-terminal-agent-name" onClick={() => focusAgentPane(runtime.nodeId)}>{context.label}</button><RunStateBadge status={runtime.status} variant="compact" /></div>
                          {context.card ? <button type="button" className="wj-terminal-agent-task" onClick={() => context.card && openOpsCard(context.card)}>{context.card.title}</button> : <small>Available</small>}
                          {(runtimeDetail ?? context.attentionReason) && <p className={context.attentionReason ? "waiting" : ""}>{runtimeDetail ?? context.attentionReason}</p>}
                        </div>
                      </article></ContextMenuTrigger><ContextMenuContent className="min-w-52">{renderTerminalAgentMenu(runtime)}</ContextMenuContent></ContextMenu>;
                    })}</div>}
                </aside>}
              </div>
              {(import.meta.env.DEV || smokeDiagnostics) && <footer className="wj-metrics-footer" aria-label="Terminal utilities" data-metrics-started-at={metricsRef.current.startedAt} data-protocol-updates={metricSummary.protocolUpdates} data-input-samples={metricSummary.inputSamples} data-resize-samples={metricSummary.resizeSamples} data-frame-samples={metricSummary.frameSamples} data-input-p95={metricSummary.inputPaintP95} data-resize-p95={metricSummary.resizePaintP95} data-frame-p95={metricSummary.framePaintP95}>
                <details className="wj-diagnostics">
                  <summary>Diagnostics</summary>
                  <div>
                    <span>events <strong>{metricSummary.events}</strong></span>
                    <span>agent snapshots <strong>{metricSummary.protocolUpdates}</strong></span>
                    <span className={metricSummary.gaps ? "metric-fail" : ""}>gaps <strong>{metricSummary.gaps}</strong></span>
                    <span>input p95 <strong>{formatMs(metricSummary.inputPaintP95)}</strong></span>
                    <span>resize p95 <strong>{formatMs(metricSummary.resizePaintP95)}</strong></span>
                    <span>paint p95 <strong>{formatMs(metricSummary.framePaintP95)}</strong></span>
                    <Button variant="ghost" size="xs" onClick={() => void runSixSessionGate()} disabled={busy}>Stress six sessions</Button>
                    <Button variant="ghost" size="xs" onClick={resetMetrics}>Reset metrics</Button>
                    <Button variant="ghost" size="xs" onClick={() => void navigator.clipboard.writeText(JSON.stringify({ platform: coreStatus?.platform, sessions: Object.keys(runtimes).length, ...metricSummary }, null, 2))}>Copy metrics</Button>
                  </div>
                </details>
              </footer>}
            </main>
          )}
          {surface === "ops" && (activatingProjectId ? (
            <main className="wj-page" aria-busy="true" aria-label={`Opening ${activatingProject?.name ?? "project"}`}>
              <div className="wj-empty-stage">
                <ProjectEmptyState
                  icon={<DotMatrixLoader variant="boot" size={30} />}
                  title={`Opening ${activatingProject?.name ?? "project"}`}
                  description="Loading the project plan and verification state…"
                />
              </div>
            </main>
          ) : (
            <OpsSurface
              page={opsPage}
              state={opsState}
              activity={activity}
              attentionItems={attentionItems}
              agentAutonomyPolicy={agentAutonomyPolicy}
              inspectedCardId={inspectedOpsCardId}
              onInspectedCardIdChange={setInspectedOpsCardId}
              runtimes={Object.values(runtimes)}
              nodes={nodeById}
              onPage={setOpsPage}
              onGenerateTasks={generateAgentTaskCards}
              taskAgentAvailable={selectedAdapterReady || Object.values(runtimes).some((runtime) => runtime.structured && runtime.adapterId === selectedAdapterId && Boolean(runtime.sessionId) && ["ready", "completed"].includes(runtime.status))}
              taskAgentName={selectedAdapter?.displayName ?? "default agent"}
              onUpdate={updateOpsTask}
              onDelete={deleteOpsTask}
              onArchiveDone={archiveDoneOpsTasks}
              onRestoreArchived={restoreArchivedOpsTasks}
              onStartAgent={startAgentForOpsTask}
              onSaveBot={openSaveOneOff}
              savedBotAvatarSeeds={bots.map((bot) => bot.avatarSeed)}
              autonomousPickup={autonomousPickup}
              autonomousConcurrency={autonomousConcurrency}
              onAutonomousPickupChange={updateAutonomousPickup}
              onAutonomousConcurrencyChange={updateAutonomousConcurrency}
              onRemoveTaskLane={(card) => void removeOpsTaskLane(card)}
              projectIsRepo={git?.isRepo}
              onReturnToReady={(card) => changeOps((current) => applyOpsOrchestration(current, card.id, "release"))}
              onBulkReturnToReady={(cards) => changeOps((current) => cards.reduce((next, card) => applyOpsOrchestration(next, card.id, "release"), current))}
              onPreviewAction={previewOpsAction}
              onExecuteAction={executeOpsAction}
              onRequestDecomposition={requestOpsDecomposition}
              onPreviewDecomposition={previewOpsDecomposition}
              onCommitDecomposition={commitOpsDecomposition}
              onDependencies={updateOpsDependencies}
              onReview={inspectOpsTask}
              onDocument={updateOpsDocument}
              onGenerate={generateOpsDocument}
              onCreateTasks={createDocumentTasks}
              onCreateDocument={createProjectDocument}
              onNormalizeKanban={normalizeKanban}
              onMigrateLegacy={migrateLegacyOps}
              onGenerateWithAgent={(kind) => void generateProjectDocumentWithAgent(kind)}
              onBootstrapPlan={bootstrapProjectPlan}
              onReloadDocuments={reloadProjectDocuments}
              onOverwriteDocuments={overwriteProjectDocuments}
              documents={projectDocuments}
              documentConflict={Boolean(documentConflict)}
              documentSaveStatus={documentSaveStatus}
              onOpenRuntime={openRuntime}
              onQueryRuntime={(runtime) => void queryAgentStatus(runtime)}
              onResumeRuntime={(runtime) => void resumeAgent(runtime)}
              onRespondRuntime={respondToAgent}
              onCancelRuntime={cancelAgentTurn}
              onQueueSteering={queueOpsSteering}
              onCancelSteering={cancelOpsSteering}
              onOpenActivity={(event) => void openActivity(event)}
              onOpenHistory={() => { setHistoryPage("activity"); selectUtilityPanel("history"); }}
              onAcknowledgeActivity={(event) => void acknowledgeActivity(event)}
              onOpenAgentSettings={() => { setSettingsPage("agents"); setSurface("settings"); }}
              showAgentRail={preferences.showAgentRail}
              agentRailCollapsed={teamRailCollapsed}
              onAgentRailCollapsed={setTeamRailCollapsed}
              agentRailWidth={teamRailWidth}
              onAgentRailWidth={setTeamRailWidth}
              floorRailWidth={project ? preferences.floorRailWidthByProject[project.id] ?? FLOOR_RAIL_DEFAULT_WIDTH : FLOOR_RAIL_DEFAULT_WIDTH}
              onFloorRailWidth={(floorRailWidth) => {
                if (!project) return;
                updatePreferences({
                  floorRailWidthByProject: {
                    ...preferencesRef.current.floorRailWidthByProject,
                    [project.id]: normalizeFloorRailWidth(floorRailWidth),
                  },
                });
              }}
              onStickerLensHost={setOpsStickerLensHost}
            />
          ))}
          {surface === "settings" && (
            <SettingsSurface
              page={settingsPage}
              preferences={preferences}
              shortcuts={shortcuts}
              adapters={adapters}
              agentProfiles={agentProfiles}
              agentAutonomyPolicy={agentAutonomyPolicy}
              agentControlAudit={agentControlAudit}
              adapterArgsById={adapterArgsById}
              selectedAdapterId={selectedAdapterId}
              busy={busy}
              coreVersion={coreStatus?.version ?? connection?.version}
              platform={coreStatus?.platform}
              appDataDir={connection?.appDataDir}
              diagnosticsReport={createDiagnosticsReport({
                version: coreStatus?.version ?? connection?.version,
                platform: coreStatus?.platform,
                appDataDir: connection?.appDataDir,
                adapters,
                runtimes: Object.values(runtimes),
                startupRecovery: coreStatus?.startupRecovery,
              })}
              systemUsesLight={systemUsesLight}
              onBack={() => setSurface(previousSurfaceRef.current)}
              onPage={setSettingsPage}
              onPreferences={updatePreferences}
              onShortcuts={updateShortcuts}
              onResetAll={resetAllPreferences}
              resettingPreferences={resettingPreferences}
              preferencesStatus={preferencesStatus}
              onAdapter={selectAgentAdapter}
              onAgentProfile={updateAgentProfile}
              onAgentAutonomyPolicy={updateAgentAutonomyPolicy}
              onRefreshAgentControlAudit={() => void refreshAgentControlAudit()}
              onRescan={() => void rescanAdapters()}
              onVerify={() => void verifyAdapter()}
              onExportBackup={(path) => callCore("state_backup_export", { path }).then(() => undefined)}
              repairCommand={adapterRepairCommand(
                adapters.find((adapter) => adapter.id === selectedAdapterId),
                agentProfiles.find((profile) => profile.adapterId === selectedAdapterId),
              )}
              onRepair={() => repairAdapter()}
              updater={updater}
              onInstallUpdate={() => void installReadyUpdate()}
            />
          )}
        </section>
        <UtilityPanelSurface
          open={utilityPanelOpen}
          compact={compactWindow}
          tab={preferences.utilityPanelTab}
          historyPage={historyPage}
          width={preferences.utilityPanelWidth}
          runtimes={Object.values(runtimes)}
          attention={attentionItems}
          activity={activity}
          sessions={sessions}
          sessionSearchResults={sessionSearchResults}
          sessionSearchBusy={sessionSearchBusy}
          git={git}
          diff={gitDiff}
          opsState={opsState}
          onOpenChange={setUtilityPanelOpen}
          onTab={(tab) => selectUtilityPanel(tab)}
          onHistoryPage={setHistoryPage}
          onWidth={(utilityPanelWidth) => updatePreferences({ utilityPanelWidth })}
          onOpenAttention={(item) => void openAttention(item)}
          onOpenActivity={(item) => void openActivity(item)}
          onOpenSession={(item) => void openHistorySession(item)}
          onSearchSessions={(query) => void searchSessionHistory(query)}
          onQueryRuntime={(runtime) => void queryAgentStatus(runtime)}
          onResumeRuntime={(runtime) => void resumeAgent(runtime)}
          onReviewTranscript={(runtime) => void reviewTranscript(runtime)}
          onRespondRuntime={(runtime, approved) => void respondToAgent(runtime, approved)}
          onAcknowledgeAttention={(item) => {
            void Promise.all(item.activityIds.flatMap((eventId) => {
              const event = activity.find((candidate) => candidate.id === eventId);
              return event ? [acknowledgeActivity(event)] : [];
            }));
          }}
          onAcknowledgeAll={() => void acknowledgeAllActivity().catch((cause) => setError(message(cause)))}
          onRefreshGit={() => void refreshProjectWorktrees().catch((cause) => setError(message(cause)))}
          onOpenTaskLane={openOpsCard}
          onResolveTaskLane={(card) => void queueOpsTaskLaneCleanup(card, card.taskLane?.cleanup?.action ?? "remove").catch((cause) => setError(`Could not queue cleanup: ${message(cause)}`))}
          onClearActivity={() => void clearActivityHistory().catch((cause) => setError(message(cause)))}
          onClearTranscripts={() => void clearSessionTranscripts().catch((cause) => setError(message(cause)))}
        />
      </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">
        {surface === "home" && <>
          <ContextMenuItem onSelect={() => void pickProject()}><Folder />Open folder…</ContextMenuItem>
          <ContextMenuItem onSelect={() => showSurface("settings")}><MonitorCog />Settings</ContextMenuItem>
        </>}
        {surface === "terminal" && <>
          <ContextMenuItem disabled={busy || !canvas} onSelect={() => setAgentCreatorOpen(true)}><MonitorCog />New agent…</ContextMenuItem>
          <ContextMenuItem disabled={busy || !canvas} onSelect={() => void spawnShell()}><Terminal />New shell<ContextMenuShortcut>{formatShortcut(shortcuts["pane.shell"])}</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem disabled={busy || !canvas} onSelect={() => void spawnShell("columns")}><Terminal />Shell split right<ContextMenuShortcut>{formatShortcut(shortcuts["pane.splitRight"])}</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem disabled={busy || !canvas} onSelect={() => void spawnShell("rows")}><Terminal />Shell split down<ContextMenuShortcut>{formatShortcut(shortcuts["pane.splitDown"])}</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={busy || !canvas} onSelect={() => void spawnDataPane("markdown_note")}>Note</ContextMenuItem>
          <ContextMenuItem disabled={busy || !canvas} onSelect={() => void spawnDataPane("task_checklist")}>Checklist</ContextMenuItem>
          <ContextMenuItem disabled={busy || !canvas} onSelect={() => void spawnDataPane("browser_preview")}>Browser Preview</ContextMenuItem>
          <ContextMenuItem disabled={busy || !layout} onSelect={enableSmartLayout}>{layoutMode === "auto" ? <CheckIcon /> : <LayoutDashboard />}Smart arrange<ContextMenuShortcut>{formatShortcut(shortcuts["pane.equalize"])}</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={busy || !project} onSelect={() => void createCanvas()}><Plus />New canvas</ContextMenuItem>
        </>}
        {surface === "ops" && <>
          <ContextMenuItem onSelect={() => showSurface("terminal")}><Terminal />Open Work</ContextMenuItem>
          <ContextMenuItem onSelect={() => showSurface("home")}><LayoutDashboard />Home</ContextMenuItem>
          <ContextMenuItem onSelect={() => showSurface("settings")}><MonitorCog />Settings</ContextMenuItem>
        </>}
        {surface === "settings" && <>
          <ContextMenuItem onSelect={() => showSurface(previousSurfaceRef.current)}><ChevronRight className="rotate-180" />Back to workspace</ContextMenuItem>
          <ContextMenuItem onSelect={() => showSurface("home")}><LayoutDashboard />Home</ContextMenuItem>
        </>}
        <DevToolsContextItem />
      </ContextMenuContent>
      </ContextMenu>
      <CommandPalette
        open={commandPaletteOpen}
        items={commandPaletteItems}
        shortcut={formatShortcut(shortcuts["app.commandPalette"], coreStatus?.platform === "macos" ? "MacIntel" : "Win32")}
        onOpenChange={setCommandPaletteOpen}
      />
      <TranscriptDrawerSurface
        transcript={historyTranscript}
        onLoadOlder={() => void loadOlderHistoryTranscript()}
        onClose={() => setHistoryTranscript(undefined)}
      />
      <ReviewDrawerSurface
        reviewCard={reviewCard}
        reviewEvidenceReady={reviewEvidenceReady}
        reviewEvidenceMessage={reviewEvidenceMessage}
        evidence={reviewEvidence}
        onClose={() => {
          setReviewCard(undefined);
          setReviewEvidence(undefined);
        }}
        onReviewAction={reviewOpsTask}
        onRequestChanges={requestReviewChanges}
      />
      {specialistDialog && <Suspense fallback={null}>
        <SpecialistProposalDialog
          request={specialistDialog}
          project={project}
          adapters={adapters}
          onDismiss={dismissSpecialistDialog}
          onReadiness={specialistReadiness}
          onVerify={verifySpecialist}
          onAction={handleSpecialistAction}
        />
      </Suspense>}
      <AlertDialog open={Boolean(pendingDocumentWrite)} onOpenChange={(open) => !open && setPendingDocumentWrite(undefined)}>
        {pendingDocumentWrite && <ProjectDocumentReviewDialog
          key={pendingDocumentWrite.preview.previewId}
          pending={pendingDocumentWrite}
          onApprove={() => void commitPendingDocumentWrite()}
        />}
      </AlertDialog>
      <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => !open && completeConfirmation(false)}>
        <AlertDialogContent className="wj-dialog">
          <AlertDialogHeader><AlertDialogTitle>{confirmation?.title}</AlertDialogTitle><AlertDialogDescription>{confirmation?.message}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel onClick={() => completeConfirmation(false)}>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => completeConfirmation(true)}>{confirmation?.confirmLabel ?? "Confirm"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {customizeProject && <ProjectIdentitySheet project={customizeProject} onOpenChange={(open) => !open && setCustomizeProject(undefined)} onSave={saveProjectIdentity} />}
      <AlertDialog open={Boolean(removeProject)} onOpenChange={(open) => !open && setRemoveProject(undefined)}>
        <AlertDialogContent className="wj-dialog wj-dialog-medium">
          <AlertDialogHeader><AlertDialogTitle>Remove {removeProject?.name} from wheeljack?</AlertDialogTitle><AlertDialogDescription>{removeProjectHasActiveSessions
            ? `${removeProject?.path ?? "This project"} has active sessions. Stop them before removing this project from wheeljack.`
            : "Remove it from wheeljack while keeping the project folder and its saved state on disk."}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={removeProjectHasActiveSessions} onClick={() => void removeSelectedProject()}>Remove from wheeljack</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    {updater.pendingRelease && (
      <UpdateReleaseNotesSheet
        open={startupReady && !onboardingVisible}
        release={updater.pendingRelease}
        onDismiss={updater.dismissInstalledRelease}
      />
    )}
    </Toast.Provider>
    </>
  );
}

type ProjectDocumentDiffLine = {
  kind: "added" | "removed" | "context" | "hunk";
  content: string;
  oldLine?: number;
  newLine?: number;
};

type ProjectDocumentDiffFile = {
  name: string;
  additions: number;
  deletions: number;
  lines: ProjectDocumentDiffLine[];
};

export function parseProjectDocumentDiff(diff: string): ProjectDocumentDiffFile[] {
  const files: ProjectDocumentDiffFile[] = [];
  let current: ProjectDocumentDiffFile | undefined;
  let oldLine = 0;
  let newLine = 0;
  const finish = () => {
    if (current) files.push(current);
  };
  for (const line of diff.replaceAll("\r\n", "\n").split("\n")) {
    if (line.startsWith("--- a/")) {
      finish();
      current = { name: line.slice(6), additions: 0, deletions: 0, lines: [] };
      oldLine = 0;
      newLine = 0;
      continue;
    }
    if (!current || line.startsWith("+++ b/")) continue;
    if (line.startsWith("@@")) {
      const range = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
      oldLine = Number(range?.[1] ?? 1) - 1;
      newLine = Number(range?.[2] ?? 1) - 1;
      if (line !== "@@ full file @@") current.lines.push({ kind: "hunk", content: line });
      continue;
    }
    if (line.startsWith("+")) {
      newLine += 1;
      current.additions += 1;
      current.lines.push({ kind: "added", content: line.slice(1), newLine });
    } else if (line.startsWith("-")) {
      oldLine += 1;
      current.deletions += 1;
      current.lines.push({ kind: "removed", content: line.slice(1), oldLine });
    } else if (line.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
      current.lines.push({ kind: "context", content: line.slice(1), oldLine, newLine });
    }
  }
  finish();
  return files;
}

function ProjectDocumentReviewDialog({ pending, onApprove }: { pending: PendingDocumentWrite; onApprove: () => void }) {
  const files = useMemo(() => parseProjectDocumentDiff(pending.preview.diff), [pending.preview.diff]);
  const [selectedName, setSelectedName] = useState(files[0]?.name ?? "");
  const [view, setView] = useState<"changes" | "preview">("changes");
  const selected = files.find((file) => file.name === selectedName) ?? files[0];
  const selectedWrite = pending.writes.find((write) => projectDocumentName(write.kind) === selected?.name);
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const fileCount = files.length || pending.writes.length;

  return <AlertDialogContent className="wj-dialog wj-document-review">
    <AlertDialogHeader className="wj-document-review-header">
      <AlertDialogTitle>{pending.title}</AlertDialogTitle>
      <AlertDialogDescription>Inspect the proposed project documents. Nothing is written until you accept these changes.</AlertDialogDescription>
    </AlertDialogHeader>
    <div className="wj-document-review-summary">
      <span>{fileCount} {fileCount === 1 ? "file" : "files"}</span>
      <span className="wj-diff-additions">+{additions}</span>
      <span className="wj-diff-deletions">-{deletions}</span>
      <code title={pending.projectPath}>{pending.projectPath}</code>
    </div>
    <div className="wj-document-review-body">
      <nav className="wj-document-review-files" aria-label="Changed files">
        {files.map((file) => {
          const write = pending.writes.find((candidate) => projectDocumentName(candidate.kind) === file.name);
          return <button
            key={file.name}
            type="button"
            data-active={file === selected || undefined}
            aria-pressed={file === selected}
            onClick={() => setSelectedName(file.name)}
          >
            <FileCode2 />
            <span><strong>{file.name}</strong><small>{write?.expectedRevision === "missing" ? "New file" : "Modified"}</small></span>
            <span className="wj-document-file-stats"><b>+{file.additions}</b>{file.deletions > 0 && <i>-{file.deletions}</i>}</span>
          </button>;
        })}
      </nav>
      <section className="wj-document-review-content" aria-label={selected ? `Review ${selected.name}` : "Document changes"}>
        <header className="wj-document-review-toolbar">
          <div><strong>{selected?.name ?? "Changes"}</strong><span>{selectedWrite?.expectedRevision === "missing" ? "New project document" : "Existing document"}</span></div>
          <div className="wj-document-view-toggle" role="group" aria-label="Review view">
            <button type="button" aria-pressed={view === "changes"} onClick={() => setView("changes")}>Changes</button>
            <button type="button" aria-pressed={view === "preview"} disabled={!selectedWrite} onClick={() => setView("preview")}>Rendered</button>
          </div>
        </header>
        {view === "changes" ? <div className="wj-document-diff" tabIndex={0}>
          {selected?.lines.map((line, index) => <div className="wj-document-diff-line" data-kind={line.kind} key={index}>
            <span aria-hidden="true">{line.oldLine}</span>
            <span aria-hidden="true">{line.newLine}</span>
            <code><b aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}</b>{line.content || " "}</code>
          </div>)}
          {!selected?.lines.length && <div className="wj-document-diff-empty">No textual changes.</div>}
        </div> : <div className="wj-document-rendered agent-prose" tabIndex={0}>
          <Markdown>{selectedWrite?.content ?? ""}</Markdown>
        </div>}
      </section>
    </div>
    <AlertDialogFooter className="wj-document-review-footer">
      <span>Writes only the reviewed project-root documents.</span>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={onApprove}>Accept &amp; write {fileCount === 1 ? "file" : `${fileCount} files`}</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>;
}

export function resolveDesktopOnboardingVersion(
  settings: JsonObject,
  footprint: {
    migrated: boolean;
    projects: readonly unknown[];
    sessions: readonly unknown[];
    activity: readonly unknown[];
  },
): number {
  const marker = settings.desktopOnboardingVersion;
  if (typeof marker === "number" && Number.isInteger(marker) && marker >= 0) return marker;
  return footprint.migrated ||
    footprint.projects.length > 0 ||
    footprint.sessions.length > 0 ||
    footprint.activity.length > 0 ||
    Object.keys(settings).some((key) => key !== "workspace")
    ? DESKTOP_ONBOARDING_VERSION
    : 0;
}

export function desktopOnboardingStep(
  project: Pick<Project, "pathExists"> | undefined,
  adapterReady: boolean,
): 1 | 2 | 3 {
  if (!project || project.pathExists === false) return 1;
  return adapterReady ? 3 : 2;
}

export function preferredCodingAdapterId(
  adapters: Adapter[],
  profiles: AgentProfile[],
  currentId = "",
): string {
  const coding = adapters.filter((adapter) =>
    adapter.id !== "generic-shell" && adapter.supportsStructured);
  const ready = (adapter: Adapter) => isAdapterReady(
    adapter,
    agentLaunchArgs(profiles.find((profile) => profile.adapterId === adapter.id)),
  );
  const installed = (adapter: Adapter) =>
    adapter.enabled && adapter.status.toLowerCase() === "installed";
  return coding.find((adapter) => adapter.id === currentId)?.id
    ?? coding.find(ready)?.id
    ?? coding.find((adapter) => installed(adapter) && adapter.probe?.authStatus === "authenticated")?.id
    ?? coding.find(installed)?.id
    ?? coding[0]?.id
    ?? "";
}

export function selectedAgentAdapterIdFromSettings(settings: JsonObject): string {
  return typeof settings.selectedAgentAdapterId === "string"
    ? settings.selectedAgentAdapterId
    : "";
}

export function adapterRepairCommand(
  adapter?: Pick<Adapter, "id" | "probe">,
  profile?: Pick<AgentProfile, "provider">,
): string | undefined {
  return adapter?.probe?.repairCommand
    ?? (adapter?.id === "pi-coding-agent" && profile?.provider === "openai-codex"
      ? "pi"
      : undefined);
}

async function createShell(
  canvas: Canvas,
  project: Project,
  index: number,
  nodeId = `node_${crypto.randomUUID().replaceAll("-", "")}`,
): Promise<{ node: CanvasNode; runtime: PaneRuntime; session: Session }> {
  let session: Session | undefined;
  try {
    session = await callCore<Session>("pty_spawn", {
      req: {
        nodeId,
        nodeTitle: `Shell ${index}`,
        adapterId: "generic-shell",
        args: [],
        cwd: project.path,
        rows: 24,
        cols: 100,
      },
    });
    const node = await persistNode(canvas, {
      nodeId,
      title: `Shell ${index}`,
      kind: "shell_terminal",
      adapterId: "generic-shell",
      adapterName: "Shell",
      session,
      transport: "pty",
      zIndex: index,
    });
    return {
      node,
      session,
      runtime: {
        nodeId,
        sessionId: session.id,
        historySessionId: session.id,
        adapterId: "generic-shell",
        structured: false,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        status: "running",
        transcript: "",
        structuredLines: [],
        messages: [],
      },
    };
  } catch (cause) {
    if (session) {
      void callCore("session_kill", { sessionId: session.id }).catch(() => undefined);
    }
    throw cause;
  }
}

async function persistNode(
  canvas: Canvas,
  input: {
    nodeId: string;
    title: string;
    kind: "shell_terminal" | "agent_terminal";
    adapterId: string;
    adapterName: string;
    session: Session;
    transport: "pty" | "structured";
    protocol?: string;
    messages?: AgentMessage[];
    taskId?: string;
    taskRole?: OpsAgentRole;
    autoCloseTaskAgent?: boolean;
    preserveTaskState?: boolean;
    schedulerLeaseId?: string;
    parentAgentId?: string;
    parentSessionId?: string;
    autonomyDepth?: number;
    botSnapshot?: BotSnapshot;
    specialistRolePending?: boolean;
    zIndex: number;
  },
): Promise<CanvasNode> {
  const timestamp = new Date().toISOString();
  const node: CanvasNode = {
    id: input.nodeId,
    canvasId: canvas.id,
    kind: input.kind,
    title: input.title,
    x: 0,
    y: 0,
    width: 600,
    height: 360,
    zIndex: input.zIndex,
    data: {
      adapterId: input.adapterId,
      adapterName: input.adapterName,
      sessionId: input.session.id,
      status: input.transport === "structured" && !input.messages?.length ? "ready" : "running",
      cwd: input.session.cwd,
      transport: input.transport,
      protocol: input.protocol,
      runtimeCapabilities: input.session.capabilities,
      runtimeInstanceId: input.session.runtimeInstanceId ?? input.session.id,
      intent: input.session.intent ?? "code",
      taskId: input.taskId,
      taskRole: input.taskRole,
      autoCloseTaskAgent: input.autoCloseTaskAgent,
      preserveTaskState: input.preserveTaskState,
      schedulerLeaseId: input.schedulerLeaseId,
      parentAgentId: input.parentAgentId,
      parentSessionId: input.parentSessionId,
      autonomyDepth: input.autonomyDepth ?? 0,
      botSnapshot: input.botSnapshot as unknown as JsonObject | undefined,
      specialistRolePending: input.specialistRolePending,
      transcript: [],
      chatPreview: [...(input.messages ?? [])].reverse().find((message) => message.text.trim())?.text.trim().slice(0, 320),
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return callCore<CanvasNode>("canvas_upsert_node", {
    canvasId: canvas.id,
    node: node as unknown as JsonObject,
  });
}

function coordinationBoardSyncRequest(
  state: OpsState,
  cwd: string,
  runtimes: Record<string, PaneRuntime>,
  nodes: CanvasNode[],
  extraCallsigns: string[] = [],
) {
  const objectiveIds = new Set(state.cards.filter((card) => card.kind === "objective" || state.cards.some((candidate) => candidate.parentId === card.id)).map((card) => card.id));
  return {
    cwd,
    callsigns: [...new Set([
      ...nodes.flatMap((node) => runtimes[node.id]?.structured ? [node.title] : []),
      ...extraCallsigns,
    ])],
    tasks: state.cards.filter((card) => !objectiveIds.has(card.id)).map((card) => ({
      id: card.id,
      title: card.title,
      detail: card.detail,
      status: card.columnId,
      assignees: card.assignee.toLowerCase() === "unassigned"
        ? []
        : card.assignee.split(" / ").map((item) => item.trim()).filter(Boolean),
      priority: card.priority,
    })),
  };
}

function opsTaskAgentPrompt(
  prompt: string,
  card: OpsCard,
  role: OpsAgentRole,
  projectPath: string,
  board: CoordinationBoardFiles,
  callsign: string,
): string {
  const separator = board.agentsPath.includes("\\") ? "\\" : "/";
  const logName = callsign.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[-_.]+|[-_.]+$/g, "") || "agent";
  const missingContract = role === "worker" && opsVerificationContractIssues(card).length > 0;
  const contractProposal = `wheeljack.ops_contract ${JSON.stringify({
    taskId: card.id,
    definitionOfDone: card.definitionOfDone?.trim() || "<observable completion criteria derived from the finished implementation>",
    constraints: card.constraints?.trim() || "",
    verificationCommand: card.verificationCommand?.trim() || "<repository-valid command that verifies this implementation>",
  })}`;
  return [
    `You are a fresh, dedicated ${role} for wheeljack task ${card.id}: ${card.title}.`,
    `Do not claim unrelated tasks or reuse this session for other work.`,
    role === "reviewer" ? "Review only: inspect the implementation and evidence without modifying project files." : missingContract ? "Implement only this task's objective, then derive its missing verification contract from the finished implementation and repository." : "Implement only this task's contract and verify the result.",
    "",
    "Read before acting:",
    `- ${board.tasksPath} (authoritative live task contract)`,
    `- ${projectPath}${projectPath.endsWith("\\") || projectPath.endsWith("/") ? "" : separator}KANBAN.md only as optional planning context; it may be a snapshot and is never live task status`,
    `- Relevant peer logs under ${board.agentsPath}`,
    "",
    "Coordination lifecycle:",
    `- Your callsign is ${callsign}. Append status events only to ${board.agentsPath}${separator}${logName}.ndjson.`,
    `- Each line is one JSON object with taskId ${card.id}, callsign, task, status, expectedFiles, note, and handoff. You may also include runId and an explicit progress snapshot: { runId, updatedAt, currentStepId?, steps: [{ id, label, state }] }, where state is pending, running, blocked, done, or failed.`,
    "- Report only steps you actually know. Omit progress entirely when you cannot report it truthfully.",
    "- Append running before work; append blocked or needs_input when stuck.",
    role === "worker"
      ? `- If expectedFiles overlaps another active task, use list_agents and send_message to agree on one owner. The yielding agent must emit resolve_file_conflict with taskId ${card.id} and its complete remaining files list; do not edit an overlapping file until one owner remains.`
      : "- If you find overlapping file claims, notify the owning workers; do not edit claimed files during review.",
    role === "reviewer"
      ? "- Before your final response, append completed with a handoff whose first line is exactly REVIEW VERDICT: APPROVE or REVIEW VERDICT: REQUEST CHANGES, followed by concise evidence."
      : missingContract
        ? `- Before your final response, derive the missing contract, run its verification command, commit valuable task changes when working in Git, then append completed with a handoff whose first two lines are exactly the directives below (replace placeholders); put concise evidence on following lines:\n${contractProposal}\nwheeljack.report {"summary":"<outcome>","checks":["<command> — passed"],"risks":[]}`
        : "- Before your final response, run the relevant checks, commit valuable task changes when working in Git, then append completed with a handoff containing one exact `wheeljack.report` JSON line with summary, only checks actually run (including outcome), and known risks; for example: `wheeljack.report {\"summary\":\"Implemented the task\",\"checks\":[\"bun test — passed\"],\"risks\":[]}`. Put concise supporting evidence on following lines. wheeljack will reconcile and integrate the report automatically; do not request a separate reviewer unless risk requires one.",
    "",
    "Task instruction:",
    prompt.trim(),
  ].join("\n");
}

function nextZIndex(nodes: CanvasNode[]): number {
  return nodes.length ? Math.max(...nodes.map((node) => node.zIndex)) + 1 : 0;
}

export function nextCanvasName(canvases: Array<Pick<Canvas, "name">>): string {
  const names = new Set(canvases.map((item) => item.name));
  let index = 1;
  while (names.has(`Canvas ${index}`)) index++;
  return `Canvas ${index}`;
}

export function defaultAgentProfiles(): AgentProfile[] {
  return [
    { adapterId: "codex-cli", provider: "openai", model: "gpt-5.4-mini", thinking: "low", approvalPolicy: "on-request" },
    { adapterId: "claude-code", provider: "anthropic", model: "haiku", thinking: "low", approvalPolicy: "manual" },
    { adapterId: "opencode", provider: "openai", model: "openai/gpt-5.6-luna", thinking: "minimal", approvalPolicy: "ask" },
    { adapterId: "pi-coding-agent", provider: "openai-codex", model: "gpt-5.4-mini", thinking: "minimal", approvalPolicy: "" },
  ];
}

function agentProfilesFromSettings(settings: JsonObject): AgentProfile[] {
  const saved = Array.isArray(settings.agentProfiles) ? settings.agentProfiles : [];
  const byId = new Map(saved.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const profile = value as Record<string, unknown>;
    return typeof profile.adapterId === "string" ? [[profile.adapterId, profile] as const] : [];
  }));
  return defaultAgentProfiles().map((fallback) => {
    const savedProfile = byId.get(fallback.adapterId);
    if (!savedProfile) return fallback;
    return validAgentProfilePatch(fallback, {
      provider: typeof savedProfile.provider === "string" ? savedProfile.provider : fallback.provider,
      model: typeof savedProfile.model === "string" ? savedProfile.model : fallback.model,
      thinking: typeof savedProfile.thinking === "string" ? savedProfile.thinking as AgentProfile["thinking"] : fallback.thinking,
      approvalPolicy: typeof savedProfile.approvalPolicy === "string" ? savedProfile.approvalPolicy : fallback.approvalPolicy,
    });
  });
}

function validAgentProfilePatch(profile: AgentProfile, patch: Partial<AgentProfile>): AgentProfile {
  const thinking = patch.thinking && agentEffortOptions(profile.adapterId).includes(patch.thinking)
    ? patch.thinking
    : profile.thinking;
  return {
    ...profile,
    provider: patch.provider && safeAgentToken(patch.provider, 64) ? patch.provider.trim() : profile.provider,
    model: patch.model && safeAgentToken(patch.model, 128) ? patch.model.trim() : profile.model,
    thinking,
    approvalPolicy: patch.approvalPolicy === "" || (patch.approvalPolicy && safeAgentToken(patch.approvalPolicy, 32))
      ? patch.approvalPolicy.trim()
      : profile.approvalPolicy,
  };
}

export function agentLaunchArgs(profile?: AgentProfile): string[] {
  if (!profile) return [];
  switch (profile.adapterId) {
    case "codex-cli":
      return ["-c", `model="${profile.model}"`, "-c", `model_reasoning_effort="${profile.thinking}"`, "-c", `approval_policy="${profile.approvalPolicy}"`];
    case "claude-code": {
      const args = ["--model", profile.model];
      if (["low", "medium", "high", "xhigh", "max"].includes(profile.thinking)) args.push("--effort", profile.thinking);
      if (profile.approvalPolicy) args.push("--permission-mode", profile.approvalPolicy);
      return args;
    }
    case "opencode":
      return [];
    case "pi-coding-agent":
      return ["--provider", profile.provider, "--model", profile.model, "--thinking", profile.thinking];
    default:
      return [];
  }
}

export function agentProjectAccessConfig(profile: AgentProfile | undefined, agentAccess: AgentAccessMode, intent: AgentSessionIntent = "code"): { approvalPolicy?: string; sandbox?: string } {
  if (!profile) return {};
  if (intent === "ask") {
    if (profile.adapterId === "codex-cli") return { approvalPolicy: "never", sandbox: "read-only" };
    if (profile.adapterId === "claude-code") return { approvalPolicy: "plan" };
    return {};
  }
  const approvalPolicy = agentAccess === "full"
    ? profile.adapterId === "codex-cli" ? "never"
      : profile.adapterId === "claude-code" ? "bypassPermissions"
        : profile.adapterId === "opencode" ? "allow"
          : profile.approvalPolicy
    : profile.approvalPolicy;
  return {
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...(profile.adapterId === "codex-cli"
      ? { sandbox: agentAccess === "full" ? "danger-full-access" : "workspace-write" }
      : {}),
  };
}

export function supportsAskIntent(adapterId: string): boolean {
  return adapterId === "codex-cli" || adapterId === "claude-code";
}

export function defaultAgentAutonomyPolicy(): AgentAutonomyPolicy {
  return {
    enabled: true,
    listAgents: "allow",
    sendMessage: "ask",
    spawnAgent: "ask",
    handoffTask: "ask",
    requestReview: "ask",
    resolveFileConflict: "ask",
    maxDepth: 2,
    maxChildrenPerAgent: 3,
    maxConcurrentAgents: 8,
    maxActionsPerMinute: 20,
  };
}

export function normalizeAgentAutonomyPolicy(policy: AgentAutonomyPolicy): AgentAutonomyPolicy {
  const mode = (value: unknown) => ["allow", "ask", "deny"].includes(String(value))
    ? value as AgentAutonomyPolicy["listAgents"]
    : "deny";
  const bounded = (value: unknown, fallback: number, max: number) => Math.min(max, Math.max(1,
    typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback));
  return {
    enabled: policy.enabled !== false,
    listAgents: mode(policy.listAgents),
    sendMessage: mode(policy.sendMessage),
    spawnAgent: mode(policy.spawnAgent),
    handoffTask: mode(policy.handoffTask),
    requestReview: mode(policy.requestReview),
    resolveFileConflict: mode(policy.resolveFileConflict),
    maxDepth: bounded(policy.maxDepth, 2, 4),
    maxChildrenPerAgent: bounded(policy.maxChildrenPerAgent, 3, 8),
    maxConcurrentAgents: bounded(policy.maxConcurrentAgents, 8, 16),
    maxActionsPerMinute: bounded(policy.maxActionsPerMinute, 20, 60),
  };
}

export function agentAutonomyPolicyFromSettings(settings: JsonObject): AgentAutonomyPolicy {
  const source = settings.agentAutonomyPolicy;
  if (!source || typeof source !== "object" || Array.isArray(source)) return defaultAgentAutonomyPolicy();
  return normalizeAgentAutonomyPolicy({
    ...defaultAgentAutonomyPolicy(),
    ...source as Partial<AgentAutonomyPolicy>,
  });
}

export function agentLaunchConfig(profile?: AgentProfile, agentAccess?: AgentAccessMode, intent: AgentSessionIntent = "code") {
  const access = agentAccess ? agentProjectAccessConfig(profile, agentAccess, intent) : {};
  const launchProfile = profile && typeof access.approvalPolicy === "string"
    ? { ...profile, approvalPolicy: access.approvalPolicy }
    : profile;
  const args = agentLaunchArgs(launchProfile);
  if (profile?.adapterId === "pi-coding-agent" && agentAccess) {
    args.push(agentAccess === "full" ? "--approve" : "--no-approve");
  }
  return {
    args,
    ...(profile ? { provider: profile.provider, model: profile.model, thinking: profile.thinking } : {}),
    ...(profile?.approvalPolicy ? { approvalPolicy: profile.approvalPolicy } : {}),
    ...access,
  };
}

export function agentReadinessArgs(profile?: AgentProfile, agentAccess?: AgentAccessMode, intent: AgentSessionIntent = "code"): string[] {
  return intent === "ask"
    ? agentLaunchArgs(profile)
    : agentLaunchConfig(profile, agentAccess, intent).args;
}

function agentVerificationConfig(profile?: AgentProfile, agentAccess?: AgentAccessMode) {
  return profile?.adapterId === "opencode"
    ? agentLaunchConfig(profile, agentAccess)
    : { args: agentReadinessArgs(profile, agentAccess) };
}

export function staleAdapterAfterProfileChange(
  adapter: Adapter,
  previousProfile?: AgentProfile,
  nextProfile?: AgentProfile,
): Adapter {
  if (
    adapter.id !== previousProfile?.adapterId ||
    adapter.id !== nextProfile?.adapterId ||
    adapter.probe?.verificationStatus !== "verified" ||
    JSON.stringify(agentVerificationConfig(previousProfile)) ===
      JSON.stringify(agentVerificationConfig(nextProfile))
  ) {
    return adapter;
  }
  return {
    ...adapter,
    probe: {
      ...adapter.probe,
      verificationStatus: "stale",
      message: "Agent launch configuration changed since verification. Verify again.",
    },
  };
}

function stressCommand(platform: string): string {
  return platform === "windows"
    ? `powershell -NoProfile -Command "$e=[char]27; 1..240 | ForEach-Object { Write-Output \\"$e[3$($_%8)mwheeljack frame $_ ✓$e[0m\\" }"\r`
    : `i=1; while [ $i -le 240 ]; do printf '\\033[3%smwheeljack frame %s ✓\\033[0m\\n' $((i%8)) "$i"; i=$((i+1)); done\r`;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function agentMessages(data: JsonObject): AgentMessage[] {
  if (!Array.isArray(data.chatMessages)) return [];
  return data.chatMessages.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    return [{
      id: typeof item.id === "string" ? item.id : `persisted-${index}`,
      role: typeof item.role === "string" ? item.role : "assistant",
      kind: typeof item.kind === "string"
        ? item.kind
        : typeof item.tool === "string" ? "tool" : typeof item.status === "string" ? item.status : "message",
      text: typeof item.content === "string" ? item.content : "",
      title: typeof item.label === "string" ? item.label : undefined,
      code: typeof item.code === "string" ? item.code : undefined,
      imagePath: typeof item.imagePath === "string" ? item.imagePath : undefined,
      label: typeof item.label === "string" ? item.label : undefined,
      imageWidth: typeof item.imageWidth === "number" ? item.imageWidth : undefined,
      imageHeight: typeof item.imageHeight === "number" ? item.imageHeight : undefined,
      imageMimeType: typeof item.imageMimeType === "string" ? item.imageMimeType : undefined,
      images: Array.isArray(item.images) ? item.images.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const image = value as Record<string, unknown>;
        return typeof image.path === "string" && typeof image.fileName === "string" && typeof image.mimeType === "string"
          ? [{ path: image.path, fileName: image.fileName, mimeType: image.mimeType }]
          : [];
      }) : undefined,
      deliveryId: typeof item.deliveryId === "string" ? item.deliveryId : undefined,
      deliveryState: typeof item.deliveryState === "string"
        && ["queued", "dispatching", "delivered", "failed", "indeterminate", "blocked", "canceled"].includes(item.deliveryState)
        ? item.deliveryState as AgentMessage["deliveryState"]
        : undefined,
      tool: typeof item.tool === "string" ? item.tool : undefined,
      status: typeof item.status === "string" ? item.status : undefined,
      interactionId: typeof item.interactionId === "string" ? item.interactionId : undefined,
      interactionState: typeof item.interactionState === "string"
        && ["pending", "submitting", "approved", "denied", "answered", "canceled"].includes(item.interactionState)
        ? item.interactionState as AgentMessage["interactionState"]
        : undefined,
    }];
  });
}

function deliveryImageAttachment(path: string): AgentImageAttachment {
  return {
    path,
    fileName: path.split(/[\\/]/).at(-1) ?? "image",
    mimeType: /\.png$/i.test(path) ? "image/png"
      : /\.gif$/i.test(path) ? "image/gif"
      : /\.webp$/i.test(path) ? "image/webp"
      : /\.bmp$/i.test(path) ? "image/bmp"
      : "image/jpeg",
  };
}

export function nodeTranscript(data: JsonObject): string {
  if (typeof data.transcript === "string") return data.transcript;
  if (!Array.isArray(data.transcript)) return "";
  return data.transcript
    .filter((item): item is string => typeof item === "string")
    .join("\n");
}

export function nodeHistorySessionId(data: JsonObject): string {
  return stringValue(data, "sessionId") || stringValue(data, "lastSessionId") || "";
}

export function dedupeActivity(items: ActivityEvent[]): ActivityEvent[] {
  const seen = new Set<number>();
  return items
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id - left.id)
    .slice(0, 50);
}

export function applyCoordinationEvents(
  current: OpsState,
  response: CoordinationEvents,
  agentAliases: Record<string, string> = {},
): OpsState {
  let cards = normalizeOpsAgentIdentities(current, agentAliases).cards;
  for (const event of response.events) {
    cards = cards.map((card) => {
      if (card.id !== event.taskId) return card;
      const callsign = canonicalOpsAgentId(event.callsign, agentAliases);
      const contractProposal = ["completed", "done"].includes(event.status)
        ? parseOpsTaskContractProposal(event.handoff ?? "")
        : undefined;
      const contractApplies = contractProposal?.taskId === card.id;
      const contractHandoff = contractApplies ? withoutOpsTaskContractProposal(event.handoff ?? "") : event.handoff ?? "";
      const parsedReport = parseOpsTaskReportHandoff(contractHandoff);
      const visibleHandoff = parsedReport.evidence;
      const maintenanceAgent = Boolean(card.taskLane?.cleanup?.requiresIntegration && (card.events ?? []).some((entry) =>
        entry.id.startsWith("manual:maintenance:") && entry.targetId === callsign));
      const agentStatuses = { ...card.agentStatuses, [callsign]: event.status };
      const agentFiles = { ...card.agentFiles, [callsign]: event.expectedFiles };
      let columnId = card.columnId;
      const statuses = Object.values(agentStatuses);
      if (["blocked", "needs_input", "failed", "disconnected", "review"].includes(event.status)) columnId = columnIdForRole(current, "review");
      else if (event.status === "paused") columnId = columnIdForRole(current, "queued");
      else if (event.status === "completed" && statuses.every((status) => status === "completed" || status === "done")) columnId = columnIdForRole(current, "review");
      else if (event.status === "done" && statuses.every((status) => status === "done")) columnId = columnIdForRole(current, "review");
      else if ((event.status === "running" || event.status === "in_progress") && !maintenanceAgent) columnId = columnIdForRole(current, "active");
      const kind = coordinationEventKind({ ...event, callsign }, card);
      const reported = ["completed", "done"].includes(event.status);
      const report = reported ? {
        status: "reported" as const,
        summary: parsedReport.summary || (visibleHandoff || event.note || "Worker completed the task.").split(/\r?\n/)[0].slice(0, 500),
        evidence: visibleHandoff || event.note || "Worker reported completion.",
        checks: parsedReport.checks,
        risks: parsedReport.risks,
        reportedAt: event.timestamp,
        agentId: callsign,
      } : card.report;
      const reconciliation = reported ? {
        status: card.reviewPolicy === "human" ? "needs_human" as const : "queued" as const,
        attempts: card.reconciliation?.attempts ?? 0,
        message: card.reviewPolicy === "human" ? "This task explicitly requires human acceptance." : "Worker evidence is ready for automatic reconciliation.",
        updatedAt: event.timestamp,
      } : card.reconciliation;
      return appendOpsTaskEvent({
        ...card,
        columnId,
        agentStatuses,
        agentFiles,
        expectedFiles: [...new Set(Object.values(agentFiles).flat())],
        lastNote: visibleHandoff || event.note || card.lastNote,
        definitionOfDone: card.definitionOfDone?.trim() || (contractApplies ? contractProposal.definitionOfDone : ""),
        constraints: card.constraints?.trim() || (contractApplies ? contractProposal.constraints : ""),
        verificationCommand: card.verificationCommand?.trim() || (contractApplies ? contractProposal.verificationCommand : ""),
        verificationRun: contractApplies ? undefined : card.verificationRun,
        runProgress: event.progress ?? card.runProgress,
        approvalAttempt: undefined,
        report,
        reconciliation,
        taskLane: reported && card.taskLane?.cleanup?.requiresIntegration
          ? { ...card.taskLane, cleanup: { ...card.taskLane.cleanup, retryAt: undefined } }
          : card.taskLane,
        startedAt: card.startedAt || (["running", "in_progress"].includes(event.status) ? event.timestamp : undefined),
        completedAt: columnId === columnIdForRole(current, "done")
          ? event.timestamp
          : ["running", "in_progress"].includes(event.status) ? undefined : card.completedAt,
        pausedAt: event.status === "paused" ? event.timestamp : ["running", "in_progress"].includes(event.status) ? undefined : card.pausedAt,
        paused: event.status === "paused" ? true : ["running", "in_progress"].includes(event.status) ? false : card.paused,
      }, {
        id: event.id,
        kind,
        timestamp: event.timestamp,
        message: visibleHandoff || event.note || coordinationStatusLabel(event.status),
        callsign,
        files: event.expectedFiles,
        status: event.status,
        runId: event.runId ?? event.progress?.runId,
      });
    });
  }
  return { ...current, cards, eventCursors: response.cursors };
}

function opsAgentIdentityKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function canonicalOpsAgentId(value: string, aliases: Record<string, string>): string {
  return aliases[opsAgentIdentityKey(value)] ?? value;
}

export function opsAgentAliases(nodes: Array<Pick<CanvasNode, "id" | "title">>): Record<string, string> {
  const titles = new Map<string, string[]>();
  const aliases: Record<string, string> = {};
  for (const node of nodes) {
    aliases[opsAgentIdentityKey(node.id)] = node.id;
    const key = opsAgentIdentityKey(node.title);
    titles.set(key, [...(titles.get(key) ?? []), node.id]);
  }
  for (const [title, ids] of titles) {
    if (ids.length === 1) aliases[title] = ids[0];
  }
  return aliases;
}

export function normalizeOpsAgentIdentities(current: OpsState, aliases: Record<string, string>): OpsState {
  if (!Object.keys(aliases).length) return current;
  return {
    ...current,
    cards: current.cards.map((card) => {
      const agentStatuses: Record<string, string> = {};
      for (const [id, status] of Object.entries(card.agentStatuses)) {
        agentStatuses[canonicalOpsAgentId(id, aliases)] = status;
      }
      const agentFiles: Record<string, string[]> = {};
      for (const [id, files] of Object.entries(card.agentFiles ?? {})) {
        const canonicalId = canonicalOpsAgentId(id, aliases);
        agentFiles[canonicalId] = [...new Set([...(agentFiles[canonicalId] ?? []), ...files])];
      }
      return {
        ...card,
        assigneeIds: [...new Set(card.assigneeIds.map((id) => canonicalOpsAgentId(id, aliases)))],
        reviewerId: card.reviewerId ? canonicalOpsAgentId(card.reviewerId, aliases) : undefined,
        agentStatuses,
        agentFiles,
        expectedFiles: [...new Set([...card.expectedFiles, ...Object.values(agentFiles).flat()])],
        events: card.events?.map((event) => ({
          ...event,
          callsign: event.callsign ? canonicalOpsAgentId(event.callsign, aliases) : undefined,
          targetId: event.targetId ? canonicalOpsAgentId(event.targetId, aliases) : undefined,
        })),
      };
    }),
  };
}

export function terminalFrameRuntimeStatus(runtime: Pick<PaneRuntime, "structured" | "status">): string {
  return runtime.structured ? runtime.status : "running";
}

export function supportsAttachedTerminal(runtime: Pick<PaneRuntime, "structured" | "protocol" | "capabilities">): boolean {
  return runtime.structured && (runtime.capabilities?.attachedTerminal ?? runtime.protocol === "opencode-sse");
}

export function shouldReloadStickerLens(surface: ShellSurface, hasProject: boolean, reloadPending: boolean): boolean {
  return reloadPending && hasProject && (surface === "terminal" || surface === "ops");
}

function coordinationEventKind(event: CoordinationEvents["events"][number], card: OpsCard): OpsTaskEvent["kind"] {
  if (event.handoff) return "handoff";
  if (["blocked", "needs_input", "failed", "disconnected"].includes(event.status)) return "blocker";
  if (event.status === "review") return "review";
  if (event.status === "completed" || event.status === "done") return "completion";
  if (event.status === "paused") return "pause";
  if (["running", "in_progress"].includes(event.status) && !card.agentStatuses[event.callsign]) return "assignment";
  return "update";
}

function coordinationStatusLabel(status: string): string {
  return resolveRunState(status).label;
}

function appendOpsTaskEvent(card: OpsCard, event: OpsTaskEvent): OpsCard {
  const events = card.events ?? [];
  if (events.some((candidate) => candidate.id === event.id)) return card;
  return { ...card, events: [...events, event].slice(-80) };
}

export function applyOpsPauseRequest(
  current: OpsState,
  cardId: string,
  agentId?: string,
  timestamp = new Date().toISOString(),
): OpsState {
  return {
    ...current,
    cards: current.cards.map((card) => card.id === cardId
      ? appendOpsTaskEvent({
          ...card,
          columnId: card.assigneeIds.length ? card.columnId : columnIdForRole(current, "queued"),
          lastNote: card.assigneeIds.length
            ? "Pause requested; waiting for the agent to report paused."
            : "Returned to Ready because no agent was assigned.",
        }, {
          id: `manual:pause-request:${timestamp}:${agentId ?? ""}`,
          kind: "update",
          timestamp,
          targetId: agentId,
          message: card.assigneeIds.length ? "Pause requested" : "Returned to Ready; no agent was assigned",
        })
      : card),
  };
}

export function applyOpsOrchestration(
  current: OpsState,
  cardId: string,
  action: OpsOrchestrationAction,
  agentId?: string,
  agentLabel?: string,
  timestamp = new Date().toISOString(),
): OpsState {
  return {
    ...current,
    cards: current.cards.map((card) => {
      if (card.id !== cardId) return card;
      if (action === "complete" && !opsCanCompleteWithOverride(card)) return card;
      const target = agentLabel || agentId;
      const baseEvent = {
        id: `manual:${action}:${timestamp}:${agentId ?? ""}`,
        timestamp,
        targetId: agentId,
      };
      if (action === "assign" || action === "transfer" || action === "resume") {
        const sourceId = card.assigneeIds[0];
        const source = sourceId ? card.assignee || sourceId : undefined;
        const message = action === "resume"
          ? "Work resumed"
          : action === "transfer"
          ? `${source || "Previous owner"} handed off to ${target || "a new owner"}`
          : target ? `Task assigned to ${target}` : "Task assigned";
        return appendOpsTaskEvent({
          ...card,
          columnId: columnIdForRole(current, "active"),
          assigneeIds: agentId ? [agentId] : card.assigneeIds,
          assignee: target || card.assignee,
          agentStatuses: agentId ? { [agentId]: "assigned" } : card.agentStatuses,
          startedAt: card.startedAt || timestamp,
          completedAt: undefined,
          pausedAt: undefined,
          paused: false,
          reviewerId: undefined,
          verificationRun: undefined,
          approvalAttempt: undefined,
          report: undefined,
          reconciliation: undefined,
          retryAt: undefined,
          steeringDirective: card.steeringDirective?.kind === "file_conflict" ? undefined : card.steeringDirective,
        }, { ...baseEvent, kind: action === "transfer" ? "handoff" : action === "resume" ? "update" : "assignment", message, callsign: action === "transfer" ? sourceId : undefined });
      }
      if (action === "review") {
        return appendOpsTaskEvent({
          ...card,
          columnId: columnIdForRole(current, "review"),
          reviewerId: agentId,
          pausedAt: undefined,
          paused: false,
          approvalAttempt: undefined,
        }, { ...baseEvent, kind: "update", message: target ? `Review requested from ${target}` : "Review requested", callsign: card.assigneeIds[0] });
      }
      if (action === "pause") {
        return appendOpsTaskEvent({
          ...card,
          columnId: columnIdForRole(current, "queued"),
          agentStatuses: Object.fromEntries(Object.keys(card.agentStatuses).map((id) => [id, "paused"])),
          pausedAt: timestamp,
          paused: true,
          approvalAttempt: undefined,
        }, { ...baseEvent, kind: "pause", message: "Work paused" });
      }
      if (action === "release") {
        return appendOpsTaskEvent({
          ...card,
          columnId: columnIdForRole(current, "queued"),
          assignee: "Unassigned",
          assigneeIds: [],
          reviewerId: undefined,
          agentStatuses: {},
          agentFiles: undefined,
          startedAt: undefined,
          completedAt: undefined,
          pausedAt: undefined,
          paused: false,
          verificationRun: undefined,
          approvalAttempt: undefined,
          runProgress: undefined,
          steeringDirective: undefined,
        }, { ...baseEvent, kind: "update", message: "Returned to Ready; previous ownership released" });
      }
      return appendOpsTaskEvent({
        ...card,
        columnId: columnIdForRole(current, "done"),
        agentStatuses: Object.fromEntries(Object.keys(card.agentStatuses).map((id) => [id, "done"])),
        completedAt: timestamp,
        pausedAt: undefined,
        paused: false,
        approvalAttempt: undefined,
      }, { ...baseEvent, kind: "completion", message: action === "approve" ? "Reconciled and integrated" : "Completed with human override" });
    }),
  };
}

export function rollbackOptimisticOpsAgentStart(
  current: OpsState,
  snapshot: OpsCard,
  nodeId: string,
  eventId: string,
  role: OpsAgentRole,
  preserveTaskState = false,
): OpsState {
  return {
    ...current,
    cards: current.cards.map((card) => {
      if (card.id !== snapshot.id) return card;
      const events = card.events ?? [];
      const optimisticEventIndex = events.findIndex((event) => event.id === eventId);
      if (optimisticEventIndex < 0) return card;
      const superseded = events
        .slice(optimisticEventIndex + 1)
        .some((event) => !event.id.startsWith("manual:task-lane:"));
      if (superseded) return card;
      const stillOwnedByOptimisticAgent = preserveTaskState
        ? card.taskLane?.cleanup?.agentId === nodeId
        : role === "reviewer"
        ? card.reviewerId === nodeId
        : card.assigneeIds.length === 1 && card.assigneeIds[0] === nodeId;
      if (!stillOwnedByOptimisticAgent) return card;
      return {
        ...card,
        columnId: snapshot.columnId,
        assignee: snapshot.assignee,
        assigneeIds: snapshot.assigneeIds,
        agentStatuses: snapshot.agentStatuses,
        startedAt: snapshot.startedAt,
        completedAt: snapshot.completedAt,
        pausedAt: snapshot.pausedAt,
        paused: snapshot.paused,
        reviewerId: snapshot.reviewerId,
        verificationRun: snapshot.verificationRun,
        approvalAttempt: snapshot.approvalAttempt,
        events: events.filter((event) => event.id !== eventId),
      };
    }),
  };
}

function neighborPane(
  currentId: string,
  direction: "left" | "right" | "up" | "down",
): string {
  const panes = [...document.querySelectorAll<HTMLElement>("[data-pane-id]")];
  const current = panes.find((pane) => pane.dataset.paneId === currentId);
  if (!current) return currentId;
  const source = current.getBoundingClientRect();
  const sourceX = source.left + source.width / 2;
  const sourceY = source.top + source.height / 2;
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const candidates = panes.flatMap((pane) => {
    if (pane === current) return [];
    const rect = pane.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const primary = (horizontal ? x - sourceX : y - sourceY) * sign;
    if (primary <= 0) return [];
    const secondary = Math.abs(horizontal ? y - sourceY : x - sourceX);
    return [{ id: pane.dataset.paneId!, score: primary * 1000 + secondary }];
  });
  return candidates.sort((left, right) => left.score - right.score)[0]?.id ?? currentId;
}

function stringValue(value: JsonObject, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function numberValue(value: JsonObject, key: string): number | undefined {
  return typeof value[key] === "number" ? value[key] : undefined;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function probeAdapters(adapters: Adapter[], profiles: AgentProfile[], agentAccess?: AgentAccessMode): Promise<Adapter[]> {
  return Promise.all(adapters.map(async (adapter) => {
    if (!adapter.enabled || adapter.id === "generic-shell" || !adapter.supportsStructured) {
      return adapter;
    }
    try {
      const profile = profiles.find((candidate) => candidate.adapterId === adapter.id);
      const probe = await callCore<AdapterProbe>("adapter_probe", {
        adapterId: adapter.id,
        ...agentLaunchConfig(profile, agentAccess),
      });
      return { ...adapter, probe };
    } catch {
      return adapter;
    }
  }));
}

export function parseOpsTaskReportHandoff(value: string): { summary: string; checks: string[]; risks: string[]; evidence: string } {
  const marker = "wheeljack.report ";
  let summary = "";
  let checks: string[] = [];
  let risks: string[] = [];
  const evidenceLines: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    if (!line.trimStart().startsWith(marker)) {
      evidenceLines.push(line);
      continue;
    }
    try {
      const payload = JSON.parse(line.trimStart().slice(marker.length)) as Record<string, unknown>;
      summary = typeof payload.summary === "string" ? payload.summary.trim().slice(0, 500) : "";
      checks = Array.isArray(payload.checks)
        ? payload.checks.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 500)).slice(0, 20)
        : [];
      risks = Array.isArray(payload.risks)
        ? payload.risks.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 500)).slice(0, 20)
        : [];
    } catch {
      evidenceLines.push(line);
    }
  }
  return { summary, checks, risks, evidence: evidenceLines.join("\n").trim() };
}

function percentile(values: number[], amount: number): number | undefined {
  if (!values.length) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * amount))];
}

function formatMs(value: number | undefined): ReactNode {
  return value === undefined ? "—" : `${value.toFixed(1)}ms`;
}

function projectDocumentRevisions(documents: ProjectDocuments): string {
  return (["kanban", "prd", "tdd"] as const)
    .map((kind) => documents.documents[kind].revision)
    .join(":");
}

function projectDocumentWrites(
  state: OpsState,
  documents: ProjectDocuments,
  force = false,
): ProjectDocumentWrite[] {
  const contents = {
    kanban: renderKanban(state),
    prd: state.prd,
    tdd: state.tdd,
  };
  return (["kanban", "prd", "tdd"] as const).flatMap((kind) => {
    const document = documents.documents[kind];
    if (!document.exists || (kind === "kanban" && !force && document.format !== "wheeljack-v1")) return [];
    const content = contents[kind];
    if (!force && document.content === content) return [];
    return [{ kind, content, expectedRevision: document.revision }];
  });
}

function projectSpecificationDocumentWrites(
  state: OpsState,
  documents: ProjectDocuments,
  force = false,
): ProjectDocumentWrite[] {
  return projectDocumentWrites(state, documents, force).filter((write) => write.kind !== "kanban");
}

function projectDocumentName(kind: ProjectDocumentKind): string {
  return `${kind.toUpperCase()}.md`;
}

function projectDocumentTemplate(kind: "prd" | "tdd", name: string): string {
  return kind === "prd"
    ? `# ${name} product requirements\n\n## Outcome\n\nDescribe the user-visible outcome.\n\n## Workflow\n\n1. Define the primary workflow.\n2. Identify approval and recovery points.\n\n## Constraints\n\n- Local-first by default.\n- Preserve existing project and session data.\n\n## Acceptance criteria\n\n- The workflow is usable with keyboard and screen reader.\n- Packaged Windows and macOS builds behave consistently.\n`
    : `# ${name} technical design\n\n## Architecture\n\nReact owns presentation; wheeljack-core owns durable state and native sessions.\n\n## Data contracts\n\nDocument protocol-v2 requests, events, and recovery behavior.\n\n## Risks\n\n- Terminal fidelity under concurrent output.\n- Platform differences between WebView2 and WKWebView.\n\n## Validation\n\n- Focused reducer and host tests.\n- Actual Tauri runtime interaction.\n- Packaged smoke test on Windows and macOS.\n`;
}

export function parseAgentTaskCardProposals(text: string): AgentTaskCardProposal[] {
  const marker = "wheeljack.task_cards ";
  const values: string[] = [text];
  try {
    const visit = (value: unknown) => {
      if (typeof value === "string") values.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(JSON.parse(text));
  } catch {
    // Raw line protocols are valid too.
  }
  const proposals = new Map<string, AgentTaskCardProposal>();
  for (const value of values) {
    for (const line of value.split(/\r?\n/)) {
      const index = line.indexOf(marker);
      if (index < 0) continue;
      try {
        const raw = JSON.parse(line.slice(index + marker.length)) as Record<string, unknown>;
        if (typeof raw.requestId !== "string" || !raw.requestId.trim() || !Array.isArray(raw.cards) || raw.cards.length < 1 || raw.cards.length > 8) continue;
        const cards = raw.cards.flatMap((candidate): AgentTaskCardDraft[] => {
          if (!candidate || typeof candidate !== "object") return [];
          const card = candidate as Record<string, unknown>;
          const priority = typeof card.priority === "string" ? card.priority : "normal";
          const reviewPolicy = typeof card.reviewPolicy === "string" ? card.reviewPolicy : "agent";
          const dependencyKeys = card.dependencyKeys ?? [];
          const existingDependencyIds = card.existingDependencyIds ?? [];
          const workerSpecialist = specialistSuggestion(card.workerSpecialist);
          const reviewerSpecialist = specialistSuggestion(card.reviewerSpecialist);
          if (
            typeof card.key !== "string"
            || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(card.key)
            || typeof card.title !== "string"
            || !card.title.trim()
            || typeof card.detail !== "string"
            || !card.detail.trim()
            || !["low", "normal", "high"].includes(priority)
            || typeof card.definitionOfDone !== "string"
            || !card.definitionOfDone.trim()
            || typeof card.verificationCommand !== "string"
            || !card.verificationCommand.trim()
            || !["human", "agent", "either"].includes(reviewPolicy)
            || !Array.isArray(dependencyKeys)
            || dependencyKeys.some((key) => typeof key !== "string")
            || !Array.isArray(existingDependencyIds)
            || existingDependencyIds.some((id) => typeof id !== "string")
            || (card.workerSpecialist !== undefined && !workerSpecialist)
            || (card.reviewerSpecialist !== undefined && !reviewerSpecialist)
          ) return [];
          return [{
            key: card.key,
            title: card.title.trim(),
            detail: card.detail.trim(),
            priority: priority as AgentTaskCardDraft["priority"],
            definitionOfDone: card.definitionOfDone.trim(),
            constraints: typeof card.constraints === "string" ? card.constraints.trim() : "",
            verificationCommand: card.verificationCommand.trim(),
            reviewPolicy: reviewPolicy as AgentTaskCardDraft["reviewPolicy"],
            dependencyKeys: dependencyKeys.map((key) => key.trim()),
            existingDependencyIds: existingDependencyIds.map((id) => id.trim()),
            workerSpecialist,
            reviewerSpecialist,
          }];
        });
        if (cards.length !== raw.cards.length || new Set(cards.map((card) => card.key)).size !== cards.length) continue;
        const proposal = { requestId: raw.requestId, cards };
        proposals.set(JSON.stringify(proposal), proposal);
      } catch {
        // Ignore partial streaming lines until the complete proposal arrives.
      }
    }
  }
  return [...proposals.values()];
}

export function agentTaskCardsFromProposal(
  proposal: AgentTaskCardProposal,
  state: OpsState,
  createId: () => string = () => crypto.randomUUID().replaceAll("-", ""),
): OpsCard[] {
  const existingIds = new Set(state.cards.map((card) => card.id));
  const knownTitles = new Set(state.cards.map((card) => card.title.trim().toLocaleLowerCase()));
  const idsByKey = new Map(proposal.cards.map((card) => [card.key, createId()]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string) => {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error("New task dependencies contain a cycle.");
    const card = proposal.cards.find((candidate) => candidate.key === key);
    if (!card) throw new Error(`New task dependency ${key} does not exist.`);
    visiting.add(key);
    for (const dependencyKey of card.dependencyKeys) visit(dependencyKey);
    visiting.delete(key);
    visited.add(key);
  };
  for (const card of proposal.cards) {
    const normalizedTitle = card.title.trim().toLocaleLowerCase();
    if (knownTitles.has(normalizedTitle)) throw new Error(`Task title already exists: ${card.title}`);
    knownTitles.add(normalizedTitle);
    if (card.dependencyKeys.includes(card.key)) throw new Error(`Task ${card.title} cannot depend on itself.`);
    if (card.existingDependencyIds.some((id) => !existingIds.has(id))) throw new Error(`Task ${card.title} references an unknown existing dependency.`);
    visit(card.key);
  }
  const queuedColumnId = columnIdForRole(state, "queued");
  return proposal.cards.map((card) => ({
    id: idsByKey.get(card.key)!,
    columnId: queuedColumnId,
    title: card.title,
    detail: card.detail,
    assignee: "Unassigned",
    priority: card.priority,
    assigneeIds: [],
    agentStatuses: {},
    expectedFiles: [],
    lastNote: "",
    definitionOfDone: card.definitionOfDone,
    constraints: card.constraints,
    verificationCommand: card.verificationCommand,
    reviewPolicy: card.reviewPolicy,
    workerSpecialist: card.workerSpecialist,
    reviewerSpecialist: card.reviewerSpecialist,
    dependencyIds: [...new Set([
      ...card.dependencyKeys.map((key) => idsByKey.get(key)!),
      ...card.existingDependencyIds,
    ])],
  }));
}

export function parseProjectDocumentProposals(line: string): AgentProjectDocumentProposal[] {
  const values: string[] = [line];
  try {
    const visit = (value: unknown) => {
      if (typeof value === "string") values.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(JSON.parse(line));
  } catch {
    // Raw line protocols are valid too.
  }
  const proposals = new Map<string, AgentProjectDocumentProposal>();
  for (const value of values) {
    for (const candidate of value.split(/\r?\n/)) {
      for (const marker of ["wheeljack.project_document ", "wheeljack.project_documents "]) {
        const index = candidate.indexOf(marker);
        if (index < 0) continue;
        try {
          const proposal = JSON.parse(candidate.slice(index + marker.length)) as Record<string, unknown>;
          if (marker.endsWith("documents ")) {
            const documents = proposal.documents as Record<string, unknown> | undefined;
            if (
              typeof proposal.requestId === "string" &&
              documents &&
              ["kanban", "prd", "tdd"].every((kind) => typeof documents[kind] === "string")
            ) {
              const parsed = {
                requestId: proposal.requestId,
                documents: {
                  kanban: documents.kanban as string,
                  prd: documents.prd as string,
                  tdd: documents.tdd as string,
                },
              };
              proposals.set(JSON.stringify(parsed), parsed);
            }
          } else if (
            typeof proposal.requestId === "string" &&
            ["kanban", "prd", "tdd"].includes(String(proposal.kind)) &&
            typeof proposal.content === "string"
          ) {
            const parsed = proposal as { requestId: string; kind: ProjectDocumentKind; content: string };
            proposals.set(JSON.stringify(parsed), parsed);
          }
        } catch {
          // Ignore partial streaming lines until the complete proposal arrives.
        }
      }
    }
  }
  return [...proposals.values()];
}

export function parseProjectDocumentProposal(line: string): AgentProjectDocumentProposal | undefined {
  return parseProjectDocumentProposals(line)[0];
}

export function parseAgentControlRequests(text: string): AgentControlRequest[] {
  const marker = "wheeljack.control ";
  const values: string[] = [text];
  try {
    const visit = (value: unknown) => {
      if (typeof value === "string") values.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(JSON.parse(text));
  } catch {
    // Raw line protocols are valid too.
  }
  const requests = new Map<string, AgentControlRequest>();
  for (const value of values) {
    for (const line of value.split(/\r?\n/)) {
      const index = line.indexOf(marker);
      if (index < 0) continue;
      try {
        const raw = JSON.parse(line.slice(index + marker.length).trim()) as Record<string, unknown>;
        const action = raw.action;
        if (
          typeof raw.id !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(raw.id) ||
          !["list_agents", "send_message", "spawn_agent", "handoff_task", "request_review", "resolve_file_conflict"].includes(String(action))
        ) continue;
        const request: AgentControlRequest = {
          id: raw.id,
          action: action as AgentControlRequest["action"],
          target: typeof raw.target === "string" ? raw.target : undefined,
          message: typeof raw.message === "string" ? raw.message : undefined,
          taskId: typeof raw.taskId === "string" ? raw.taskId : undefined,
          adapterId: typeof raw.adapterId === "string" ? raw.adapterId : undefined,
          files: Array.isArray(raw.files) ? raw.files.filter((file): file is string => typeof file === "string") : undefined,
        };
        if (
          (["send_message", "spawn_agent"].includes(request.action) && !request.message?.trim()) ||
          (request.action === "send_message" && !request.target?.trim()) ||
          (["handoff_task", "request_review", "resolve_file_conflict"].includes(request.action) && !request.taskId?.trim()) ||
          (request.action === "resolve_file_conflict" && (
            !Array.isArray(raw.files) || raw.files.some((file) => typeof file !== "string")
          ))
        ) continue;
        requests.set(request.id, request);
      } catch {
        // Ignore partial streaming lines until the complete directive arrives.
      }
    }
  }
  return [...requests.values()];
}

export function parseOpsTaskContractProposal(text: string): {
  taskId: string;
  definitionOfDone: string;
  constraints: string;
  verificationCommand: string;
} | undefined {
  const marker = "wheeljack.ops_contract ";
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(marker);
    if (index < 0) continue;
    try {
      const raw = JSON.parse(line.slice(index + marker.length).trim()) as Record<string, unknown>;
      if (
        typeof raw.taskId !== "string" || !raw.taskId.trim() ||
        typeof raw.definitionOfDone !== "string" || !raw.definitionOfDone.trim() ||
        typeof raw.verificationCommand !== "string" || !raw.verificationCommand.trim()
      ) continue;
      return {
        taskId: raw.taskId,
        definitionOfDone: raw.definitionOfDone.trim(),
        constraints: typeof raw.constraints === "string" ? raw.constraints.trim() : "",
        verificationCommand: raw.verificationCommand.trim(),
      };
    } catch {
      // Ignore malformed contract directives and leave the card visibly incomplete.
    }
  }
  return undefined;
}

function withoutOpsTaskContractProposal(text: string): string {
  return text.split(/\r?\n/)
    .filter((line) => !line.includes("wheeljack.ops_contract "))
    .join("\n")
    .trim();
}

export function parseOpsDecompositionProposal(line: string): OpsDecompositionProposal | undefined {
  const marker = "wheeljack.ops_decomposition ";
  const values: string[] = [line];
  try {
    const visit = (value: unknown) => {
      if (typeof value === "string") values.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(JSON.parse(line));
  } catch {
    // Raw line protocols are valid too.
  }
  for (const value of values) {
    const index = value.indexOf(marker);
    if (index < 0) continue;
    try {
      const raw = JSON.parse(value.slice(index + marker.length)) as Record<string, unknown>;
      if (typeof raw.requestId !== "string" || typeof raw.parentId !== "string" || !Array.isArray(raw.tasks) || raw.tasks.length < 2 || raw.tasks.length > 6) continue;
      const tasks = raw.tasks.flatMap((candidate): OpsDecompositionTaskDraft[] => {
        if (!candidate || typeof candidate !== "object") return [];
        const task = candidate as Record<string, unknown>;
        if (
          typeof task.key !== "string" ||
          !/^[a-z0-9][a-z0-9-]{0,39}$/.test(task.key) ||
          typeof task.title !== "string" ||
          typeof task.detail !== "string" ||
          typeof task.definitionOfDone !== "string" ||
          !task.definitionOfDone.trim() ||
          typeof task.verificationCommand !== "string" ||
          !task.verificationCommand.trim()
        ) return [];
        return [{
          key: task.key,
          title: task.title,
          detail: task.detail,
          definitionOfDone: typeof task.definitionOfDone === "string" ? task.definitionOfDone : "",
          constraints: typeof task.constraints === "string" ? task.constraints : "",
          verificationCommand: typeof task.verificationCommand === "string" ? task.verificationCommand : "",
          expectedFiles: Array.isArray(task.expectedFiles) ? task.expectedFiles.filter((file): file is string => typeof file === "string") : [],
          dependencyKeys: Array.isArray(task.dependencyKeys) ? task.dependencyKeys.filter((key): key is string => typeof key === "string") : [],
          agentId: typeof task.agentId === "string" ? task.agentId : undefined,
          workerSpecialist: specialistSuggestion(task.workerSpecialist),
          reviewerSpecialist: specialistSuggestion(task.reviewerSpecialist),
        }];
      });
      const keys = new Set(tasks.map((task) => task.key));
      if (
        tasks.length !== raw.tasks.length ||
        raw.tasks.some((candidate) => {
          if (!candidate || typeof candidate !== "object") return true;
          const task = candidate as Record<string, unknown>;
          return (task.workerSpecialist !== undefined && !specialistSuggestion(task.workerSpecialist))
            || (task.reviewerSpecialist !== undefined && !specialistSuggestion(task.reviewerSpecialist));
        }) ||
        keys.size !== tasks.length ||
        tasks.some((task) => task.dependencyKeys.some((key) => !keys.has(key) || key === task.key)) ||
        opsDecompositionHasCycle(tasks)
      ) continue;
      return { requestId: raw.requestId, parentId: raw.parentId, tasks };
    } catch {
      // Ignore partial streaming lines until the complete proposal arrives.
    }
  }
  return undefined;
}

function opsDecompositionTaskId(parentId: string, key: string) {
  return `${parentId}:${key}`;
}

function opsDecompositionTaskPrompt(parent: OpsCard, task: OpsDecompositionTaskDraft) {
  return [
    `Work on Ops child task: ${task.title}`,
    `Parent task: ${parent.title}`,
    task.detail,
    task.definitionOfDone ? `Definition of done:\n${task.definitionOfDone}` : "",
    task.constraints ? `Constraints:\n${task.constraints}` : "",
    task.verificationCommand ? `Verification:\n${task.verificationCommand}` : "",
    task.expectedFiles.length ? `Expected files:\n${task.expectedFiles.map((file) => `- ${file}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

export function preferencesFromSettings(settings: JsonObject): UiPreferences {
  const stored = settings.desktopUiPreferences;
  const source = stored && typeof stored === "object" ? stored as Partial<UiPreferences> : {};
  const supportedSource = Object.fromEntries(
    Object.entries(source).filter(([key]) => key !== "paneHeaderHeight" && key !== "showSuggestions"),
  ) as Partial<UiPreferences>;
  const expandedProjectIds = Array.isArray(source.expandedProjectIds)
    ? [...new Set(source.expandedProjectIds.filter((id): id is string => typeof id === "string").slice(0, 128))]
    : [];
  const lastCanvasByProject = source.lastCanvasByProject && typeof source.lastCanvasByProject === "object" && !Array.isArray(source.lastCanvasByProject)
    ? Object.fromEntries(Object.entries(source.lastCanvasByProject).filter((entry): entry is [string, string] => typeof entry[1] === "string").slice(0, 128))
    : {};
  const floorRailWidthByProject = source.floorRailWidthByProject && typeof source.floorRailWidthByProject === "object" && !Array.isArray(source.floorRailWidthByProject)
    ? Object.fromEntries(Object.entries(source.floorRailWidthByProject)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
      .slice(0, 128)
      .map(([projectId, width]) => [projectId, normalizeFloorRailWidth(width)]))
    : {};
  const customThemes = Array.isArray(source.customThemes) ? source.customThemes.flatMap((theme) => {
    try {
      return [validateTheme(theme)];
    } catch {
      return [];
    }
  }) : [];
  return {
    ...defaultUiPreferences,
    ...supportedSource,
    appearanceMode: source.appearanceMode === "system" ? "system" : "fixed",
    fixedThemeId: typeof source.fixedThemeId === "string"
      ? source.fixedThemeId
      : source.theme === "paper" || settings.theme === "mono-light" ? "mono-light" : "mono-dark",
    systemLightThemeId: typeof source.systemLightThemeId === "string" ? source.systemLightThemeId : "mono-light",
    systemDarkThemeId: typeof source.systemDarkThemeId === "string" ? source.systemDarkThemeId : "mono-dark",
    customThemes,
    showStickerLensBackground: source.showStickerLensBackground !== false,
    headingFontFamily: typeof source.headingFontFamily === "string" ? source.headingFontFamily : defaultUiPreferences.headingFontFamily,
    sidebarCollapsed: source.sidebarCollapsed === true,
    expandedProjectIds,
    lastCanvasByProject,
    floorRailWidthByProject,
    utilityPanelWidth: Math.min(560, Math.max(320, typeof source.utilityPanelWidth === "number" ? source.utilityPanelWidth : 400)),
    utilityPanelTab: source.utilityPanelTab === "git" || source.utilityPanelTab === "history" ? source.utilityPanelTab : "inbox",
    theme: source.theme === "paper" || settings.theme === "mono-light" ? "paper" : "graphite",
    uiFontFamily: typeof source.uiFontFamily === "string"
      ? source.uiFontFamily === "Inter" ? "Inter Variable" : source.uiFontFamily
      : normalizeUiFont(typeof settings.appFontFamily === "string" ? settings.appFontFamily : defaultUiPreferences.uiFontFamily),
    codeFontFamily: typeof source.codeFontFamily === "string"
      ? source.codeFontFamily
      : typeof settings.monoFontFamily === "string" ? settings.monoFontFamily : defaultUiPreferences.codeFontFamily,
    uiScale: normalizeUiScale(source.uiScale),
  };
}

export function utilityPanelSelection(open: boolean, tab: UtilityPanelTab, requested: UtilityPanelTab) {
  return { open: tab === requested ? !open : true, tab: requested };
}

export function normalizeUiFont(value: string): string {
  return ["Segoe UI Variable Text", "Inter"].includes(value) ? defaultUiPreferences.uiFontFamily : value;
}

export function normalizeUiScale(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(2, Math.max(.5, Math.round(value * 10) / 10))
    : 1;
}

export function normalizeLegacyWindowsPreferences(settings: JsonObject): JsonObject | undefined {
  if (settings.version !== 1) return undefined;
  const fixedThemeId = typeof settings.fixedThemeId === "string" ? settings.fixedThemeId : "mono-dark";
  const customThemes = Array.isArray(settings.customThemes) ? settings.customThemes : [];
  const activeTheme = [...builtInThemes, ...customThemes]
    .find((theme) => theme && typeof theme === "object" && "id" in theme && theme.id === fixedThemeId);
  return {
    theme: activeTheme && "variant" in activeTheme && activeTheme.variant === "light" ? "paper" : "graphite",
    appearanceMode: settings.mode === "system" ? "system" : "fixed",
    fixedThemeId,
    systemLightThemeId: settings.systemLightThemeId,
    systemDarkThemeId: settings.systemDarkThemeId,
    customThemes,
    uiFontFamily: settings.uiFontFamily,
    codeFontFamily: settings.codeFontFamily,
    uiFontSize: settings.uiFontSize,
    terminalFontSize: settings.terminalFontSize,
    sidebarWidth: settings.sidebarExpandedWidth,
    showPaneActions: settings.showPaneActions,
    showProjectPaths: settings.showProjectPaths,
    showRecentActivity: settings.showRecentActivity,
    showAgentRail: settings.showAgentRail,
  };
}

function resolvedTheme(preferences: UiPreferences, systemUsesLight: boolean) {
  const themes = [...builtInThemes, ...preferences.customThemes];
  const id = preferences.appearanceMode === "system"
    ? systemUsesLight ? preferences.systemLightThemeId : preferences.systemDarkThemeId
    : preferences.fixedThemeId;
  const requiredVariant = preferences.appearanceMode === "system" ? systemUsesLight ? "light" : "dark" : undefined;
  return themes.find((theme) => theme.id === id && (!requiredVariant || theme.variant === requiredVariant))
    ?? builtInThemes.find((theme) => theme.id === (requiredVariant === "light" ? "mono-light" : "mono-dark"))!;
}
