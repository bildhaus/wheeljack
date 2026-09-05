import { AI, Briefcase, CheckIcon, ChevronDownIcon, ChevronRight, ChevronsLeft, ChevronsRight, CircleDot, Columns2, Files, GitBranch, History, LayoutDashboard, Lightning, Minus, MonitorCog, MoreHorizontal, Play, Plus, RefreshCw, Search, Spark, Settings, Terminal, Trash2, X } from "./SargamIcon";

import Markdown from "react-markdown";

import { Badge } from "./components/ui/badge";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./components/ui/alert-dialog";

import { Button } from "./components/ui/button";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";

import { Checkbox } from "./components/ui/checkbox";

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "./components/ui/context-menu";

import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./components/ui/dropdown-menu";

import { Input } from "./components/ui/input";

import { Label } from "./components/ui/label";

import { ScrollArea } from "./components/ui/scroll-area";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./components/ui/sheet";

import { Switch } from "./components/ui/switch";

import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";

import { Textarea } from "./components/ui/textarea";

import { type ActionCardAction } from "./ActionCard";

import { AgentAvatar } from "./AgentAvatar";

import { RunStateBadge } from "./RunStateBadge";

import { resolveAgentLabel } from "./agentIdentity";

import { resolveRunState, visibleRunStateDetail } from "./runState";

import { OpsRunGraph } from "./RunGraphSurface";

import { DotMatrixLoader } from "./DotMatrixLoader";

import { opsActiveFileConflicts, opsAgentsCoordinating, opsAttentionReason, opsCardActivitySummary, opsCardPresence, opsCardParticipantIds, opsCanCompleteWithOverride, opsChildProgress, opsDecompositionHasCycle, opsCurrentCardForAgent, opsDependencyPath, opsExecutionLane, opsReviewLabel, opsVerificationProgress, opsWaitingRelationships, opsWouldCreateDependencyCycle } from "./opsPresence";

import { deriveOpsFloorModel, floorRuntimeCanRecover, type OpsFloorAttention, type OpsFloorContention, type OpsFloorTask } from "./opsFloor";

import { deriveOpsRunGraphModel, type OpsRunGraphRange, type OpsRunGraphSelection } from "./opsRunGraph";

import { opsTaskTimeline } from "./opsTimeline";

import { isTerminalSessionStatus } from "./agentRuntime";

import { needsAttention, pendingAgentInteraction, type AttentionItem } from "./attention";

import type { ActivityEvent, AgentAutonomyPolicy, CanvasNode, BotSnapshot, OpsCard, OpsDecompositionProposal, OpsDecompositionTaskDraft, OpsOrchestrationAction, OpsState, OpsSteeringDirective, OpsTaskContractDraft, ProjectDocuments, PaneRuntime, RoutePreview } from "./types";

import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ProjectEmptyState, reviewPolicyLabels, formatTime, DevToolsContextItem, ReviewPolicyOptions, formatOpsElapsed, formatOpsRelative, humanizeFloorAttentionDetail, opsCanReturnDirectlyToReady, opsActionTitle, taskWorkspaceLabel, opsCardDisplayStatus, Empty, beginHorizontalResize, normalizeFloorRailWidth, FLOOR_RAIL_MIN_WIDTH, FLOOR_RAIL_MAX_WIDTH, FLOOR_RAIL_DEFAULT_WIDTH, type PendingOpsAction, type OpsPage } from "./ParitySurfaces";

type OpsTaskEditablePatch = Partial<Pick<OpsCard, "title" | "detail" | "definitionOfDone" | "constraints" | "verificationCommand" | "reviewPolicy">>;
const OpsArchiveDialogs = lazy(() => import("./OpsArchiveDialogs"));

export function OpsSurface({
  page,
  state,
  activity,
  attentionItems,
  agentAutonomyPolicy,
  inspectedCardId,
  onInspectedCardIdChange,
  runtimes,
  nodes,
  onPage,
  onGenerateTasks,
  taskAgentAvailable,
  taskAgentName,
  onUpdate,
  onDelete,
  onArchiveDone,
  onRestoreArchived,
  onStartAgent,
  onSaveBot,
  savedBotAvatarSeeds,
  autonomousPickup,
  autonomousConcurrency,
  onAutonomousPickupChange,
  onAutonomousConcurrencyChange,
  onRemoveTaskLane,
  projectIsRepo,
  onReturnToReady,
  onBulkReturnToReady,
  onPreviewAction,
  onExecuteAction,
  onRequestDecomposition,
  onPreviewDecomposition,
  onCommitDecomposition,
  onDependencies,
  onReview,
  onDocument,
  onGenerate,
  onCreateTasks,
  onCreateDocument,
  onNormalizeKanban,
  onMigrateLegacy,
  onGenerateWithAgent,
  onBootstrapPlan,
  onReloadDocuments,
  onOverwriteDocuments,
  documents,
  documentConflict,
  documentSaveStatus,
  onOpenRuntime,
  onQueryRuntime,
  onResumeRuntime,
  onRespondRuntime,
  onCancelRuntime,
  onQueueSteering,
  onCancelSteering,
  onOpenActivity,
  onOpenHistory,
  onAcknowledgeActivity,
  onOpenAgentSettings,
  showAgentRail,
  agentRailCollapsed,
  onAgentRailCollapsed,
  agentRailWidth,
  onAgentRailWidth,
  floorRailWidth,
  onFloorRailWidth,
  onStickerLensHost,
}: {
  page: OpsPage;
  state: OpsState;
  activity: ActivityEvent[];
  attentionItems: AttentionItem[];
  agentAutonomyPolicy: AgentAutonomyPolicy;
  inspectedCardId?: string;
  onInspectedCardIdChange: (cardId?: string) => void;
  runtimes: PaneRuntime[];
  nodes: Record<string, CanvasNode>;
  onPage: (page: OpsPage) => void;
  onGenerateTasks: (brief: string) => Promise<number>;
  taskAgentAvailable: boolean;
  taskAgentName: string;
  onUpdate: (card: OpsCard, change: OpsTaskEditablePatch) => void;
  onDelete: (card: OpsCard) => Promise<void>;
  onArchiveDone: (cardIds: string[]) => Promise<void>;
  onRestoreArchived: (cardIds: string[]) => Promise<void>;
  onStartAgent: (card: OpsCard) => Promise<boolean>;
  onSaveBot: (snapshot: BotSnapshot) => void;
  savedBotAvatarSeeds: string[];
  autonomousPickup: boolean;
  autonomousConcurrency: number;
  onAutonomousPickupChange: (enabled: boolean) => void;
  onAutonomousConcurrencyChange: (limit: number) => void;
  onRemoveTaskLane: (card: OpsCard) => void;
  projectIsRepo?: boolean;
  onReturnToReady: (card: OpsCard) => void;
  onBulkReturnToReady: (cards: OpsCard[]) => void;
  onPreviewAction: (card: OpsCard, action: OpsOrchestrationAction, agentId?: string) => Promise<RoutePreview | undefined>;
  onExecuteAction: (card: OpsCard, action: OpsOrchestrationAction, agentId?: string, preview?: RoutePreview) => Promise<void>;
  onRequestDecomposition: (card: OpsCard, plannerId: string) => Promise<OpsDecompositionProposal>;
  onPreviewDecomposition: (card: OpsCard, tasks: OpsDecompositionTaskDraft[]) => Promise<{ dispatchKeys: string[]; preview?: RoutePreview }>;
  onCommitDecomposition: (card: OpsCard, tasks: OpsDecompositionTaskDraft[], dispatchKeys: string[], preview?: RoutePreview) => Promise<void>;
  onDependencies: (card: OpsCard, dependencyIds: string[], hardDependencyIds: string[]) => void;
  onReview: (card: OpsCard) => void;
  onDocument: (kind: "prd" | "tdd", value: string) => void;
  onGenerate: (kind: "prd" | "tdd") => void;
  onCreateTasks: (kind: "prd" | "tdd") => void;
  onCreateDocument: (kind: "kanban" | "prd" | "tdd") => void;
  onNormalizeKanban: () => void;
  onMigrateLegacy: () => void;
  onGenerateWithAgent: (kind: "kanban" | "prd" | "tdd") => void;
  onBootstrapPlan: () => void;
  onReloadDocuments: () => void;
  onOverwriteDocuments: () => void;
  documents?: ProjectDocuments;
  documentConflict: boolean;
  documentSaveStatus: "idle" | "saving" | "saved" | "conflict" | "error";
  onOpenRuntime: (runtime: PaneRuntime) => void;
  onQueryRuntime: (runtime: PaneRuntime) => void;
  onResumeRuntime: (runtime: PaneRuntime) => void;
  onRespondRuntime: (runtime: PaneRuntime, approved: boolean) => Promise<boolean>;
  onCancelRuntime: (runtime: PaneRuntime) => Promise<boolean>;
  onQueueSteering: (card: OpsCard, text: string, metadata?: Pick<OpsSteeringDirective, "kind" | "conflictFiles">) => void;
  onCancelSteering: (card: OpsCard) => void;
  onOpenActivity: (event: ActivityEvent) => void;
  onOpenHistory: () => void;
  onAcknowledgeActivity: (event: ActivityEvent) => void;
  onOpenAgentSettings: () => void;
  showAgentRail: boolean;
  agentRailCollapsed: boolean;
  onAgentRailCollapsed: (collapsed: boolean) => void;
  agentRailWidth: number;
  onAgentRailWidth: (width: number) => void;
  floorRailWidth: number;
  onFloorRailWidth: (width: number) => void;
  onStickerLensHost: (host: HTMLElement | null) => void;
}) {
  const [deleteArmed, setDeleteArmed] = useState<string>();
  const [archiveDoneOpen, setArchiveDoneOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string>();
  const [draggedCardId, setDraggedCardId] = useState<string>();
  const [dropColumnId, setDropColumnId] = useState<string>();
  const cardDragRef = useRef<{ card: OpsCard; preview: HTMLElement; pointerId: number; offsetX: number; offsetY: number; originX: number; originY: number; x: number; y: number; targetColumnId?: string }>(undefined);
  const [pendingAction, setPendingAction] = useState<PendingOpsAction>();
  const [decompositionCard, setDecompositionCard] = useState<OpsCard>();
  const [decompositionPlannerId, setDecompositionPlannerId] = useState("");
  const [decompositionProposal, setDecompositionProposal] = useState<OpsDecompositionProposal>();
  const [decompositionPreview, setDecompositionPreview] = useState<{ dispatchKeys: string[]; preview?: RoutePreview }>();
  const [decompositionBusy, setDecompositionBusy] = useState(false);
  const [decompositionError, setDecompositionError] = useState("");
  const [recoveryCard, setRecoveryCard] = useState<OpsCard>();
  const [overrideCard, setOverrideCard] = useState<OpsCard>();
  const [bulkRecoveryOpen, setBulkRecoveryOpen] = useState(false);
  const [dependencyCard, setDependencyCard] = useState<OpsCard>();
  const [dependencyDraft, setDependencyDraft] = useState<Set<string>>(new Set());
  const [dependencyHardDraft, setDependencyHardDraft] = useState<Set<string>>(new Set());
  const [contractCard, setContractCard] = useState<OpsCard>();
  const [contractEditDefinition, setContractEditDefinition] = useState("");
  const [contractEditConstraints, setContractEditConstraints] = useState("");
  const [contractEditVerification, setContractEditVerification] = useState("");
  const [contractEditReviewPolicy, setContractEditReviewPolicy] = useState<OpsTaskContractDraft["reviewPolicy"]>("agent");
  const [dependencyFocusCardId, setDependencyFocusCardId] = useState<string>();
  const [eventFlashes, setEventFlashes] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const latestEventsRef = useRef<Record<string, string> | undefined>(undefined);
  const [composerOpen, setComposerOpen] = useState(false);
  const [taskBrief, setTaskBrief] = useState("");
  const [taskCreationBusy, setTaskCreationBusy] = useState(false);
  const [taskCreationError, setTaskCreationError] = useState("");
  const [boardView, setBoardView] = useState<"board" | "list">("list");
  const [specKind, setSpecKind] = useState<"prd" | "tdd">("prd");
  const [steeringCardId, setSteeringCardId] = useState<string>();
  const [steeringDraft, setSteeringDraft] = useState("");
  const [runGraphRange, setRunGraphRange] = useState<OpsRunGraphRange>("40m");
  const [runGraphSelection, setRunGraphSelection] = useState<OpsRunGraphSelection>();
  const setInspectedCardId = onInspectedCardIdChange;
  const opsContentRef = useRef<HTMLDivElement>(null);
  const cardRectsRef = useRef<Map<string, DOMRect | undefined>>(new Map());
  const kanban = documents?.documents.kanban;
  const selectedDocument = specKind === "prd" ? documents?.documents.prd : documents?.documents.tdd;
  const documentWarnings = page === "board" ? kanban?.warnings ?? [] : page === "spec" ? selectedDocument?.warnings ?? [] : [];
  const missingDocumentCount = documents ? Object.values(documents.documents).filter((document) => !document.exists).length : 3;
  // Plan is backed by canonical SQLite state. KANBAN.md is an optional,
  // explicit import/export snapshot and never gates task operations.
  const boardWritable = true;
  const structuredRuntimes = runtimes.filter((runtime) =>
    runtime.structured && nodes[runtime.nodeId]?.data.preserveTaskState !== true);
  const idleStructuredRuntimes = structuredRuntimes.filter((runtime) =>
    runtime.sessionId && !["running", "in_progress", "starting", "blocked", "needs_input"].includes(runtime.status));
  const activeRuntimes = structuredRuntimes.filter((runtime) => ["running", "in_progress"].includes(runtime.status));
  const attentionRuntimes = structuredRuntimes.filter((runtime) => needsAttention(runtime.status));
  const connectedAgentIds = new Set(structuredRuntimes.map((runtime) => runtime.nodeId));
  const doneColumnIds = new Set(state.columns.filter((column) => column.role === "done").map((column) => column.id));
  const liveCards = state.cards.filter((card) => opsCardParticipantIds(card, structuredRuntimes).some((id) => connectedAgentIds.has(id)));
  const fileConflicts = opsActiveFileConflicts({ cards: liveCards, columns: state.columns });
  const conflictCardIds = new Set(fileConflicts.flatMap((conflict) => conflict.cardIds));
  const waitingRelationships = opsWaitingRelationships(state.cards, doneColumnIds);
  const waitingByCard = new Map(waitingRelationships.map((relationship) => [relationship.cardId, relationship]));
  const dependencyPath = dependencyFocusCardId ? opsDependencyPath(state.cards, dependencyFocusCardId) : new Set<string>();
  const roleByColumnId = new Map(state.columns.map((column) => [column.id, column.role]));
  const agentName = (id: string) => resolveAgentLabel(nodes[id]?.title, state.agentLabels?.[id]);
  const reviewerName = (id?: string) => id ? agentName(id) : undefined;
  const cardRuntimeStatuses = (card: OpsCard) => opsCardParticipantIds(card, structuredRuntimes).flatMap((id) => {
    const runtime = structuredRuntimes.find((candidate) => candidate.nodeId === id);
    return runtime ? [runtime.status] : [];
  });
  const cardHasLiveParticipant = (card: OpsCard) => !opsCanReturnDirectlyToReady(card, structuredRuntimes);
  const cardLane = (card: OpsCard) => opsExecutionLane(
    card,
    roleByColumnId.get(card.columnId) ?? "queued",
    cardRuntimeStatuses(card),
    conflictCardIds.has(card.id),
  );
  const executionLanes = [
    { id: "ready", title: "Planned", role: "queued" as const, targetColumnId: state.columns.find((column) => column.role === "queued")?.id },
    { id: "running", title: "Running", role: "active" as const, targetColumnId: state.columns.find((column) => column.role === "active")?.id },
    { id: "attention", title: "Intervention", role: undefined, targetColumnId: undefined },
    { id: "verifying", title: "Reconciling", role: "review" as const, targetColumnId: state.columns.find((column) => column.role === "review")?.id },
    { id: "done", title: "Done", role: "done" as const, targetColumnId: state.columns.find((column) => column.role === "done")?.id },
  ];
  const attentionCards = state.cards.filter((card) => cardLane(card) === "attention");
  const orphanedCards = attentionCards.filter((card) => {
    const role = roleByColumnId.get(card.columnId);
    return (role === "active" || role === "review")
      && Boolean(card.assigneeIds.length || card.reviewerId)
      && cardRuntimeStatuses(card).length === 0;
  });
  const inspectedCard = state.cards.find((card) => card.id === inspectedCardId);
  const inspectedRole = inspectedCard ? roleByColumnId.get(inspectedCard.columnId) ?? "queued" : "queued";
  const inspectedConflictFiles = inspectedCard
    ? fileConflicts.filter((conflict) => conflict.cardIds.includes(inspectedCard.id)).map((conflict) => conflict.file)
    : [];
  const inspectedVerification = inspectedCard ? opsVerificationProgress(inspectedCard, inspectedConflictFiles.length > 0) : undefined;
  const inspectedReview = inspectedCard ? opsReviewLabel(
    inspectedCard,
    reviewerName(inspectedCard.reviewerId),
  ) : undefined;
  const inspectedChildProgress = inspectedCard ? opsChildProgress(state.cards, inspectedCard.id, doneColumnIds) : { done: 0, total: 0 };
  const inspectedTaskLaneLive = inspectedCard?.assigneeIds.some((id) => runtimes.some((runtime) =>
    runtime.nodeId === id && !isTerminalSessionStatus(runtime.status))) ?? false;
  const inspectedTimeline = inspectedCard ? opsTaskTimeline(inspectedCard, Object.values(nodes)) : [];
  const inspectedOneOff = [...(inspectedCard?.events ?? [])].reverse().find((event) =>
    event.botSnapshot?.source === "one-off"
    && !savedBotAvatarSeeds.includes(event.botSnapshot.avatarSeed))?.botSnapshot;
  const recoveryRole = recoveryCard ? roleByColumnId.get(recoveryCard.columnId) ?? "queued" : "queued";
  const recoveryConflictFiles = recoveryCard
    ? fileConflicts.filter((conflict) => conflict.cardIds.includes(recoveryCard.id)).map((conflict) => conflict.file)
    : [];
  const recoveryRuntime = recoveryCard
    ? opsCardParticipantIds(recoveryCard, structuredRuntimes).flatMap((id) => structuredRuntimes.filter((runtime) => runtime.nodeId === id))[0]
    : undefined;
  const recoveryReason = recoveryCard
    ? opsAttentionReason(recoveryCard, recoveryRole, cardRuntimeStatuses(recoveryCard), recoveryConflictFiles.length > 0)
    : undefined;
  const boardLayoutKey = state.cards.map(({ id, columnId }) => `${id}:${columnId}:${waitingByCard.has(id)}`).join("|");
  const floorModel = useMemo(() => deriveOpsFloorModel({ state, runtimes, attentionItems, activity }), [activity, attentionItems, runtimes, state]);
  const runGraphModel = useMemo(() => deriveOpsRunGraphModel({
    state,
    runtimes: structuredRuntimes,
    attentionItems,
    conflicts: floorModel.contentions,
    now,
    range: runGraphRange,
  }), [attentionItems, floorModel.contentions, now, runGraphRange, state, structuredRuntimes]);
  const latestEventKey = state.cards.map((card) => `${card.id}:${card.events?.at(-1)?.id ?? ""}`).join("|");
  const intervene = (card: OpsCard) => {
    if (cardLane(card) === "attention") setRecoveryCard(card);
    else {
      const runtime = opsCardParticipantIds(card, structuredRuntimes)
        .flatMap((id) => structuredRuntimes.filter((candidate) => candidate.nodeId === id))[0];
      if (runtime) onOpenRuntime(runtime);
      else void onStartAgent(card);
    }
  };
  const clearDecompositionPreview = () => setDecompositionPreview(undefined);
  const updateDecompositionTask = (key: string, change: Partial<OpsDecompositionTaskDraft>) => {
    setDecompositionProposal((current) => current ? {
      ...current,
      tasks: current.tasks.map((task) => task.key === key ? { ...task, ...change } : task),
    } : current);
    clearDecompositionPreview();
  };
  const requestCardMove = (card: OpsCard, targetColumnId: string) => {
    if (card.columnId === targetColumnId) return;
    const role = state.columns.find((column) => column.id === targetColumnId)?.role;
    if (!role) return;
    if (role === "active") {
      void onStartAgent(card);
      return;
    }
    if (role === "review") {
      void onExecuteAction(card, "review");
      return;
    }
    if (role === "queued" && !cardHasLiveParticipant(card)) {
      onReturnToReady(card);
      return;
    }
    const action: OpsOrchestrationAction = role === "queued" ? "pause" : "complete";
    setPendingAction({
      card,
      action,
      targetColumnId,
      agentId: card.assigneeIds[0],
    });
  };
  const cancelCardDrag = (returnToOrigin = false) => {
    const drag = cardDragRef.current;
    setDropColumnId(undefined);
    const cleanup = () => {
      if (cardDragRef.current === drag) cardDragRef.current = undefined;
      drag?.preview.remove();
      setDraggedCardId(undefined);
    };
    if (
      drag &&
      returnToOrigin &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      (Math.abs(drag.x - drag.originX) > 1 || Math.abs(drag.y - drag.originY) > 1)
    ) {
      drag.pointerId = -1;
      const animation = drag.preview.animate([
        { transform: `translate3d(${drag.x}px, ${drag.y}px, 0)` },
        { transform: `translate3d(${drag.originX - (drag.x - drag.originX) * .04}px, ${drag.originY - (drag.y - drag.originY) * .04}px, 0)`, offset: .78 },
        { transform: `translate3d(${drag.originX}px, ${drag.originY}px, 0)` },
      ], { duration: 240, easing: "cubic-bezier(.23, 1, .32, 1)" });
      animation.onfinish = cleanup;
      animation.oncancel = cleanup;
    } else {
      cleanup();
    }
    return drag;
  };
  const openDependencies = (card: OpsCard) => {
    setDependencyCard(card);
    setDependencyDraft(new Set(card.dependencyIds ?? []));
    setDependencyHardDraft(new Set((card.dependencyIds ?? []).filter((id) => card.dependencyKinds?.[id] === "hard")));
  };
  const openContract = (card: OpsCard) => {
    setContractCard(card);
    setContractEditDefinition(card.definitionOfDone ?? "");
    setContractEditConstraints(card.constraints ?? "");
    setContractEditVerification(card.verificationCommand ?? "");
    setContractEditReviewPolicy(card.reviewPolicy ?? "agent");
  };
  const closeTaskComposer = () => {
    if (taskCreationBusy) return;
    setComposerOpen(false);
    setTaskBrief("");
    setTaskCreationError("");
  };
  useEffect(() => {
    if (!activeRuntimes.length || !state.cards.some((card) => card.startedAt && !card.completedAt && !card.paused)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeRuntimes.length, state.cards]);
  useEffect(() => {
    const latest = Object.fromEntries(state.cards.flatMap((card) => {
      const id = card.events?.at(-1)?.id;
      return id ? [[card.id, id]] : [];
    }));
    const previous = latestEventsRef.current;
    latestEventsRef.current = latest;
    if (!previous) return;
    const changed = Object.fromEntries(Object.entries(latest).filter(([cardId, id]) => previous[cardId] !== id));
    if (Object.keys(changed).length) setEventFlashes((current) => ({ ...current, ...changed }));
  }, [latestEventKey, state.cards]);
  useLayoutEffect(() => {
    const root = opsContentRef.current;
    if (page !== "board" || !root) {
      cardRectsRef.current.clear();
      return;
    }
    const cards = [...root.querySelectorAll<HTMLElement>("[data-task-id]")];
    const nextRects = new Map(cards.map((element) => [element.dataset.taskId!, element.dataset.waiting ? undefined : element.getBoundingClientRect()]));
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const element of cards) {
        const cardId = element.dataset.taskId!;
        if (cardRectsRef.current.has(cardId) && !cardRectsRef.current.get(cardId) && !element.dataset.waiting) {
          element.animate({ boxShadow: ["0 0 0 1px var(--success)", "none"] }, { duration: 1_150 });
        }
        const previous = cardRectsRef.current.get(cardId);
        const current = nextRects.get(cardId);
        if (!previous || !current) continue;
        const x = previous.left - current.left;
        const y = previous.top - current.top;
        if (Math.abs(x) < 1 && Math.abs(y) < 1) continue;
        element.animate([
          { transform: `translate3d(${x}px, ${y}px, 0)` },
          { transform: `translate3d(${-x * .04}px, ${-y * .04}px, 0)`, offset: .78 },
          { transform: "translate3d(0, 0, 0)" },
        ], { duration: 260, easing: "cubic-bezier(.23, 1, .32, 1)" });
      }
    }
    cardRectsRef.current = nextRects;
  }, [boardLayoutKey, page]);
  const renderTaskMenuItems = (
    card: OpsCard,
    cardRole: string | undefined,
    childProgress: ReturnType<typeof opsChildProgress>,
    context = false,
  ) => {
    const Item = context ? ContextMenuItem : DropdownMenuItem;
    const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator;
    const taskRuntime = opsCardParticipantIds(card, structuredRuntimes)
      .flatMap((id) => structuredRuntimes.filter((runtime) => runtime.nodeId === id))[0];
    const taskLaneLive = Boolean(taskRuntime && !isTerminalSessionStatus(taskRuntime.status));
    const cleanup = card.taskLane?.cleanup;
    const cleanupPending = cleanup && ["queued", "resolving"].includes(cleanup.status);
    return (
      <>
        <Item onSelect={() => setEditingCardId(card.id)}>Edit task</Item>
        <Item onSelect={() => openContract(card)}>Edit contract…</Item>
        <Item onSelect={() => openDependencies(card)}><GitBranch />Dependencies…</Item>
        {cardRole === "queued" && card.assigneeIds.length === 0 && !state.cards.some((candidate) => candidate.parentId === card.id) && <Item onSelect={() => {
          const planner = idleStructuredRuntimes[0];
          setDecompositionCard(card);
          setDecompositionPlannerId(planner?.nodeId ?? "");
          setDecompositionProposal(undefined);
          setDecompositionPreview(undefined);
          setDecompositionError("");
        }}><Columns2 />Decompose task…</Item>}
        {cardRole !== "done" && childProgress.total === 0 && <><Separator />
          <Item disabled={Boolean(card.taskLane?.closedAt)} onSelect={() => taskRuntime ? onOpenRuntime(taskRuntime) : void onStartAgent(card)}>{taskRuntime ? <Terminal /> : <Play />}{taskRuntime ? "Open task agent" : "Start fresh task agent"}</Item>
          {cardRole === "active" && <Item onSelect={() => requestCardMove(card, state.columns.find((item) => item.role === "queued")?.id ?? card.columnId)}>{cardHasLiveParticipant(card) ? "Request pause…" : "Move to Ready"}</Item>}
          {opsCanCompleteWithOverride(card) && <Item onSelect={() => requestCardMove(card, state.columns.find((item) => item.role === "done")?.id ?? card.columnId)}><CheckIcon />Complete with override…</Item>}
        </>}
        {card.taskLane && !card.taskLane.closedAt && <><Separator />
          <Item disabled={Boolean(cleanupPending)} onSelect={() => onRemoveTaskLane(card)}><Trash2 />{cleanupPending
            ? cleanup?.action === "delete" ? "Resolving worktree before deletion…" : cleanup?.action === "archive" ? "Resolving worktree before archive…" : "Resolving worktree…"
            : cleanup?.status === "blocked" ? "Retry worktree cleanup" : taskLaneLive ? "Resolve worktree with agent…" : "Remove worktree…"}</Item>
        </>}
        <Separator />
        <Item disabled={Boolean(cleanupPending && cleanup?.action === "delete")} variant="destructive" onSelect={(event: Event) => {
          if (deleteArmed === card.id) {
            void onDelete(card);
            setDeleteArmed(undefined);
          } else {
            event.preventDefault();
            setDeleteArmed(card.id);
          }
        }}><Trash2 />{cleanupPending && cleanup?.action === "delete" ? "Deletion queued" : deleteArmed === card.id ? "Confirm delete" : "Delete task"}</Item>
        {context && <DevToolsContextItem />}
      </>
    );
  };
  const renderAgentRailMenuItems = (runtime: PaneRuntime) => {
    const currentCard = opsCurrentCardForAgent(state, runtime.nodeId);
    return <>
      <ContextMenuItem onSelect={() => onOpenRuntime(runtime)}><Terminal />Open agent</ContextMenuItem>
      {currentCard && <ContextMenuItem onSelect={() => setInspectedCardId(currentCard.id)}><LayoutDashboard />Open Plan task</ContextMenuItem>}
      <ContextMenuSeparator />
      {["failed", "disconnected"].includes(runtime.status) && <ContextMenuItem onSelect={() => onResumeRuntime(runtime)}><RefreshCw />Recover agent</ContextMenuItem>}
      <ContextMenuItem onSelect={() => onQueryRuntime(runtime)}><Search />Query status</ContextMenuItem>
      <DevToolsContextItem />
    </>;
  };
  return (
    <ContextMenu>
    <ContextMenuTrigger asChild>
    <main className="flex h-full min-h-0 flex-col bg-background" aria-labelledby="ops-surface-heading" onContextMenuCapture={(event) => {
      if ((event.target as Element).closest("input, textarea, [contenteditable=true]")) event.stopPropagation();
    }}>
      <h1 className="sr-only" id="ops-surface-heading">Plan</h1>
      <div className="wj-surface-toolbar wj-plan-toolbar">
        <div className="wj-breadcrumb"><LayoutDashboard /><strong>Plan</strong><span className="wj-board-summary">{state.cards.length} tasks</span></div>
        <div className="wj-ops-actions">
          {missingDocumentCount > 0 && <Button variant="outline" size="sm" onClick={onBootstrapPlan}><MonitorCog /><span>Bootstrap plan</span></Button>}
          {page === "board" && <div className="wj-view-control"><span>View</span><Tabs className="wj-board-view" value={boardView} onValueChange={(value) => setBoardView(value as "board" | "list")}><TabsList aria-label="Plan task view"><TabsTrigger aria-label="Plan list view" value="list">Plan</TabsTrigger><TabsTrigger aria-label="Execution status columns" value="board">Status</TabsTrigger></TabsList></Tabs></div>}
          {page === "board" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="wj-agent-control" aria-label={`${structuredRuntimes.length} connected agents; open agent controls`} variant={attentionRuntimes.length ? "secondary" : "ghost"} size="sm">
                  {structuredRuntimes.length
                    ? <span className="wj-avatar-stack">{structuredRuntimes.slice(0, 5).map((runtime) => <AgentAvatar id={runtime.nodeId} label={agentName(runtime.nodeId)} status={runtime.status} key={runtime.nodeId} />)}</span>
                    : <CircleDot />}
                  <span className="wj-agent-status-label">{structuredRuntimes.length ? `${activeRuntimes.length} active${attentionRuntimes.length ? ` · ${attentionRuntimes.length} need attention` : ""}` : "0 agents"}</span>
                  <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuCheckboxItem checked={autonomousPickup} onCheckedChange={(enabled) => onAutonomousPickupChange(enabled === true)}><Lightning />Autonomous pickup</DropdownMenuCheckboxItem>
                <DropdownMenuLabel>Concurrent autonomous agents</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={String(autonomousConcurrency)} onValueChange={(value) => onAutonomousConcurrencyChange(Number(value))}>
                  {[1, 2, 3, 4].map((limit) => <DropdownMenuRadioItem key={limit} value={String(limit)}>{limit}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onNormalizeKanban}>{kanban?.exists ? "Export KANBAN.md snapshot" : "Create KANBAN.md snapshot"}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onGenerateWithAgent("kanban")}>Regenerate task plan with agent</DropdownMenuItem>
                {missingDocumentCount === 0 && <DropdownMenuItem onSelect={onBootstrapPlan}>Re-analyze project</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {boardWritable && <Button className="wj-new-task-action" size="sm" aria-expanded={composerOpen} disabled={taskCreationBusy} onClick={() => {
            if (page !== "board") {
              onPage("board");
              setComposerOpen(true);
            } else {
              setComposerOpen((open) => !open);
            }
          }}><Plus /><span>New task</span></Button>}
        </div>
      </div>
      {documentConflict && <div className="wj-inline-notice border-destructive/40 bg-destructive/10"><span>Project documents changed on disk while wheeljack had local edits.</span><Button variant="ghost" size="sm" onClick={onReloadDocuments}>Reload files</Button><Button variant="destructive" size="sm" onClick={onOverwriteDocuments}>Review overwrite</Button></div>}
      {documentWarnings.length > 0 && <div className="wj-inline-notice border-border bg-muted/30" role="status"><span>{documentWarnings.join(" ")}</span></div>}
      {page === "floor" ? (
        <FloorSurface
          model={floorModel}
          state={state}
          runtimes={structuredRuntimes}
          nodes={nodes}
          now={now}
          runGraphModel={runGraphModel}
          runGraphSelection={runGraphSelection}
          onRunGraphRange={setRunGraphRange}
          onRunGraphSelection={setRunGraphSelection}
          autonomousPickup={autonomousPickup}
          autonomousConcurrency={autonomousConcurrency}
          maxAutonomousConcurrency={agentAutonomyPolicy.maxConcurrentAgents}
          onAutonomousPickupChange={onAutonomousPickupChange}
          onAutonomousConcurrencyChange={onAutonomousConcurrencyChange}
          onOpenAgentSettings={onOpenAgentSettings}
          onInspect={(cardId) => setInspectedCardId(cardId)}
          onReview={onReview}
          onOpenRuntime={onOpenRuntime}
          onResumeRuntime={onResumeRuntime}
          onRespondRuntime={onRespondRuntime}
          onCancelRuntime={onCancelRuntime}
          onStartAgent={onStartAgent}
          steeringCardId={steeringCardId}
          steeringDraft={steeringDraft}
          onSteeringCardId={setSteeringCardId}
          onSteeringDraft={setSteeringDraft}
          onQueueSteering={onQueueSteering}
          onCancelSteering={onCancelSteering}
          onOpenActivity={onOpenActivity}
          onOpenHistory={onOpenHistory}
          onAcknowledgeActivity={onAcknowledgeActivity}
          projectIsRepo={projectIsRepo}
          railWidth={floorRailWidth}
          onRailWidth={onFloorRailWidth}
        />
      ) : page === "board" ? (
        <>
          {kanban?.format === "importable" && state.cards.length === 0 && <div className="wj-inline-notice border-border bg-muted/30"><span>A KANBAN.md snapshot is available to import. Plan remains editable either way.</span><Button onClick={onNormalizeKanban}>Import snapshot</Button></div>}
          {composerOpen && <form className="wj-task-composer" aria-busy={taskCreationBusy} onSubmit={async (event) => {
            event.preventDefault();
            if (!boardWritable || !taskAgentAvailable || taskCreationBusy || !taskBrief.trim()) return;
            setTaskCreationBusy(true);
            setTaskCreationError("");
            try {
              const count = await onGenerateTasks(taskBrief.trim());
              if (count < 1) throw new Error("No task cards were created.");
              setTaskBrief("");
              setComposerOpen(false);
            } catch (cause) {
              setTaskCreationError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              setTaskCreationBusy(false);
            }
          }}>
            <div className="wj-task-composer-mark" aria-hidden="true"><Spark /></div>
            <div className="wj-task-composer-body">
              <header><div><strong>Describe the work</strong><span>wheeljack turns your brief into backlog cards with scoped contracts and valid verification.</span></div></header>
              <Label className="sr-only" htmlFor="task-brief">General task brief</Label>
              <Textarea
                autoFocus
                id="task-brief"
                value={taskBrief}
                onChange={(event) => setTaskBrief(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
                placeholder="For example: make project search fast and useful across large repositories, including good empty and error states."
                readOnly={taskCreationBusy}
              />
              {taskCreationError && <p className="wj-task-composer-error" role="alert">{taskCreationError}</p>}
              <footer>
                <div className="wj-task-composer-status" role="status" aria-live="polite">
                  {taskCreationBusy
                    ? <><DotMatrixLoader size={12} />{taskAgentName} is shaping the brief into cards…</>
                    : taskAgentAvailable
                      ? <><AI />Uses {taskAgentName} · Ctrl/⌘ + Enter to create</>
                      : <><CircleDot />The default agent needs setup. <Button type="button" variant="link" size="xs" onClick={onOpenAgentSettings}>Open settings</Button></>}
                </div>
                <div><Button type="button" variant="ghost" disabled={taskCreationBusy} onClick={closeTaskComposer}>Cancel</Button><Button type="submit" disabled={!boardWritable || !taskAgentAvailable || taskCreationBusy || !taskBrief.trim()}>{taskCreationBusy ? <DotMatrixLoader size={14} /> : <Spark />}{taskCreationBusy ? "Creating…" : "Create tasks"}</Button></div>
              </footer>
            </div>
          </form>}
          {attentionCards.length > 0 && <div className="wj-board-floor-link" role="status">
            <span><CircleDot />{attentionCards.length} {attentionCards.length === 1 ? "exception needs" : "exceptions need"} attention</span>
            <Button variant="ghost" size="sm" onClick={() => onPage("floor")}>Open Run<ChevronRight /></Button>
          </div>}
          <div className="wj-ops-content" ref={opsContentRef}>
            <ScrollArea className="min-h-0 min-w-0 flex-1">
              <div className={`wj-board ${boardView === "list" ? "wj-board-list" : ""} ${state.cards.length === 0 ? "wj-board-empty" : ""}`} data-view={boardView} ref={state.cards.length === 0 ? onStickerLensHost : undefined}>
                {state.cards.length === 0 && (
                  <ProjectEmptyState
                    icon={<LayoutDashboard />}
                    title="Plan your first task"
                    description="Turn the next outcome into a task contract. wheeljack stores live task state locally and can export a KANBAN.md snapshot whenever you need one."
                  >
                    <Button onClick={() => setComposerOpen(true)}><Plus />New task</Button>
                  </ProjectEmptyState>
                )}
                {state.cards.length > 0 && executionLanes.map((lane) => {
                  const cards = state.cards.filter((card) => cardLane(card) === lane.id);
                  return (
                    <section
                      className={`wj-board-column ${lane.id === "attention" ? "attention" : ""} ${lane.targetColumnId && dropColumnId === lane.targetColumnId ? "drop-target" : ""}`}
                      data-kanban-column-id={lane.targetColumnId}
                      key={lane.id}
                    >
                      <header><h2>{lane.title}</h2><div className="wj-column-actions"><span className="wj-column-count">{cards.length}</span>{lane.id === "done" && <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button aria-label="Completed task actions" variant="ghost" size="icon-sm"><MoreHorizontal /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled={!boardWritable || cards.length === 0} onSelect={() => setArchiveDoneOpen(true)}><Files />Archive completed…</DropdownMenuItem>
                          <DropdownMenuItem disabled={!state.archivedCards?.length} onSelect={() => setArchiveOpen(true)}><History />View archived ({state.archivedCards?.length ?? 0})</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>}</div></header>
                      <div className="wj-board-stack">
                        {cards.length === 0 && <div className="wj-column-empty">No tasks</div>}
                        {cards.map((card) => {
                          const editing = boardWritable && editingCardId === card.id;
                          const agentIds = opsCardParticipantIds(card, structuredRuntimes);
                          const cardRuntimes = agentIds.map((id) => structuredRuntimes.find((runtime) => runtime.nodeId === id)).filter((runtime): runtime is PaneRuntime => Boolean(runtime));
                          const cardConflictFiles = fileConflicts.filter((conflict) => conflict.cardIds.includes(card.id)).map((conflict) => conflict.file);
                          const cardRole = roleByColumnId.get(card.columnId) ?? "queued";
                          const runtimeStatuses = cardRuntimeStatuses(card);
                          const agentsCoordinating = opsAgentsCoordinating(runtimeStatuses, cardConflictFiles.length > 0);
                          const attentionReason = opsAttentionReason(card, cardRole, runtimeStatuses, cardConflictFiles.length > 0);
                          const verification = opsVerificationProgress(card, cardConflictFiles.length > 0);
                          const review = opsReviewLabel(
                            card,
                            reviewerName(card.reviewerId),
                          );
                          const liveSummary = opsCardActivitySummary(card, cardRuntimes, cardConflictFiles.length);
                          const presence = opsCardPresence(card, cardRuntimes);
                          const runtimeOwners = cardRuntimes.map((runtime) => agentName(runtime.nodeId)).join(", ");
                          const recordedOwner = card.assignee?.trim() && card.assignee !== "Unassigned" ? card.assignee.trim() : "";
                          const ownerLabel = runtimeOwners || recordedOwner || agentIds.map(agentName).join(", ") || "Unassigned";
                          const waiting = waitingByCard.get(card.id);
                          const events = card.events ?? [];
                          const latestEvent = events.at(-1);
                          const lastActivity = formatOpsRelative(latestEvent?.timestamp ?? card.pausedAt ?? card.startedAt, now);
                          const workspaceLabel = taskWorkspaceLabel(card, projectIsRepo);
                          const showWorkspace = workspaceLabel === "Lane removed" || workspaceLabel.startsWith("Shared checkout");
                          const showCardMeta = showWorkspace || card.priority !== "normal";
                          const dependencyCards = (card.dependencyIds ?? []).flatMap((id) => {
                            const dependency = state.cards.find((candidate) => candidate.id === id);
                            return dependency ? [dependency] : [];
                          });
                          const dependencyClass = dependencyPath.size
                            ? dependencyPath.has(card.id) ? card.id === dependencyFocusCardId ? "dependency-focus" : "dependency-path" : "dependency-muted"
                            : "";
                          const childProgress = opsChildProgress(state.cards, card.id, doneColumnIds);
                          const showExecution = !["ready", "done"].includes(lane.id) && Boolean(cardRuntimes.length || agentIds.length || recordedOwner || card.lastNote);
                          const showCoordination = Boolean((cardConflictFiles.length && !agentsCoordinating) || waiting);
                          return (
                            <ContextMenu key={card.id} onOpenChange={(open) => { if (!open) setDeleteArmed(undefined); }}>
                              <ContextMenuTrigger asChild disabled={editing || !boardWritable}>
                                <Card
                               size="sm"
                               className={`wj-task-card ring-0 ${draggedCardId === card.id ? "dragging" : ""} ${dependencyClass}`}
                               data-lane={lane.id}
                               data-priority={card.priority}
                               data-task-id={card.id}
                               data-paused={card.paused || undefined}
                               data-live={cardRuntimes.length > 0 || undefined}
                               data-waiting={waiting || undefined}
                               data-presence-phase={presence}
                               >
                              {latestEvent && eventFlashes[card.id] === latestEvent.id && <span className="wj-task-event-flash" data-kind={latestEvent.kind} key={latestEvent.id} />}
                              <div
                                className="wj-task-card-bar"
                                data-draggable={boardWritable && !editing || undefined}
                                title={boardWritable && !editing ? `Drag ${card.title} to another workflow stage` : undefined}
                                onClick={(event) => event.stopPropagation()}
                                onPointerDown={(event) => {
                                  if (!boardWritable || editing || event.button !== 0 || cardDragRef.current) return;
                                  const element = event.currentTarget.closest<HTMLElement>(".wj-task-card");
                                  if (!element) return;
                                  const bounds = element.getBoundingClientRect();
                                  const preview = element.cloneNode(true) as HTMLElement;
                                  preview.classList.remove("dragging");
                                  preview.classList.add("wj-task-drag-image");
                                  preview.removeAttribute("data-task-id");
                                  preview.setAttribute("aria-hidden", "true");
                                  preview.style.width = `${bounds.width}px`;
                                  preview.style.transform = `translate3d(${bounds.left}px, ${bounds.top}px, 0)`;
                                  document.body.append(preview);
                                  cardDragRef.current = {
                                    card,
                                    preview,
                                    pointerId: event.pointerId,
                                    offsetX: event.clientX - bounds.left,
                                    offsetY: event.clientY - bounds.top,
                                    originX: bounds.left,
                                    originY: bounds.top,
                                    x: bounds.left,
                                    y: bounds.top,
                                  };
                                  event.currentTarget.setPointerCapture(event.pointerId);
                                  setDraggedCardId(card.id);
                                  event.preventDefault();
                                }}
                                onPointerMove={(event) => {
                                  const drag = cardDragRef.current;
                                  if (!drag || drag.pointerId !== event.pointerId) return;
                                  drag.x = event.clientX - drag.offsetX;
                                  drag.y = event.clientY - drag.offsetY;
                                  drag.preview.style.transform = `translate3d(${drag.x}px, ${drag.y}px, 0)`;
                                  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-kanban-column-id]");
                                  drag.targetColumnId = target?.dataset.kanbanColumnId !== card.columnId ? target?.dataset.kanbanColumnId : undefined;
                                  setDropColumnId(drag.targetColumnId);
                                }}
                                onPointerUp={(event) => {
                                  const drag = cardDragRef.current;
                                  if (!drag || drag.pointerId !== event.pointerId) return;
                                  event.currentTarget.releasePointerCapture(event.pointerId);
                                  const { targetColumnId } = drag;
                                  cancelCardDrag(!targetColumnId);
                                  if (targetColumnId) requestCardMove(card, targetColumnId);
                                }}
                                onPointerCancel={() => cancelCardDrag(true)}
                              >
                                <span className="wj-task-card-meta">
                                  {showWorkspace && <Badge variant="outline" title={card.taskLane?.branch}>{workspaceLabel}</Badge>}
                                  {card.priority !== "normal" && <span className="wj-task-priority">{card.priority}</span>}
                                  {!showCardMeta && <span className="sr-only">Drag task</span>}
                                </span>
                                {boardWritable && !editing && <span aria-hidden="true" className="wj-task-drag-rail"><span>Move</span></span>}
                              </div>
                              <CardHeader
                                className={!editing ? "wj-task-summary" : undefined}
                                role={!editing ? "button" : undefined}
                                tabIndex={!editing ? 0 : undefined}
                                onClick={!editing ? () => setInspectedCardId(card.id) : undefined}
                                onKeyDown={!editing ? (event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    setInspectedCardId(card.id);
                                  }
                                } : undefined}
                              >
                                <div className="wj-task-heading">
                                  {editing
                                    ? <Input autoFocus aria-label={`Task title: ${card.title}`} value={card.title} onChange={(event) => onUpdate(card, { title: event.target.value, detail: card.detail })} />
                                    : <CardTitle title={card.title}>{card.title || "Untitled task"}</CardTitle>}
                                </div>
                                {editing
                                  ? <Textarea aria-label={`Task detail: ${card.title}`} value={card.detail} onChange={(event) => onUpdate(card, { title: card.title, detail: event.target.value })} placeholder="Add an outcome or constraint" />
                                  : lane.id === "ready" && card.detail && <CardDescription>{card.detail}</CardDescription>}
                              </CardHeader>
                              <CardContent>
                                {childProgress.total > 0 && <div className="wj-verification-progress" aria-label={`${childProgress.done} of ${childProgress.total} child tasks complete`}>
                                  <div><span>Child tasks</span><strong>{childProgress.done}/{childProgress.total}</strong></div>
                                  <span style={{ "--wj-progress": `${childProgress.done / childProgress.total * 100}%` } as React.CSSProperties} />
                                </div>}
                                {showExecution && <div className="wj-task-execution">
                                {cardRuntimes.length > 0
                                  ? <button type="button" className="wj-task-team" aria-label={`Open ${ownerLabel}: ${liveSummary}`} onClick={() => onOpenRuntime(cardRuntimes[0])}>
                                      <div className="wj-avatar-stack">{cardRuntimes.slice(0, 4).map((runtime) => <AgentAvatar id={runtime.nodeId} label={agentName(runtime.nodeId)} status={runtime.status} key={runtime.nodeId} />)}</div>
                                      <div aria-atomic="true" aria-live="polite"><strong>{ownerLabel}</strong><span className="wj-task-activity" title={liveSummary} key={latestEvent?.id ?? liveSummary}>{liveSummary}</span></div>
                                    </button>
                                  : <div className="wj-task-team wj-task-team-static"><div className="wj-task-unassigned"><span /><div><strong>{ownerLabel}</strong><small>{liveSummary}{lastActivity ? ` · last active ${lastActivity}` : ""}</small></div></div></div>}
                                </div>}
                                {attentionReason && <button type="button" className="wj-task-intervention" disabled={!boardWritable} onClick={() => cardRole === "review" ? onReview(card) : intervene(card)}><CircleDot /><span><strong>{cardRole === "review" ? "Review evidence" : "Intervene"}</strong><small>{attentionReason}</small></span><ChevronRight /></button>}
                                {showCoordination && <div className="wj-task-coordination">
                                {cardConflictFiles.length > 0 && !agentsCoordinating && <button type="button" className="wj-task-conflict" onClick={() => setInspectedCardId(card.id)}><CircleDot />{cardConflictFiles.length} {cardConflictFiles.length === 1 ? "conflict" : "conflicts"}</button>}
                                {waiting && <button
                                  type="button"
                                  className="wj-task-dependencies waiting"
                                  onClick={() => setInspectedCardId(card.id)}
                                  onMouseEnter={() => setDependencyFocusCardId(card.id)}
                                  onMouseLeave={() => setDependencyFocusCardId(undefined)}
                                  onFocus={() => setDependencyFocusCardId(card.id)}
                                  onBlur={() => setDependencyFocusCardId(undefined)}
                                >
                                  Waiting on {dependencyCards.length}
                                </button>}
                                </div>}
                                {cardRole === "review" && <div className="wj-task-review-state"><span>Review</span><strong>{review}</strong></div>}
                                {cardRole === "review" && <div className="wj-verification-progress" aria-label={`${verification.passed} of ${verification.total} verification signals`}>
                                  <div><span>Evidence</span><strong>{verification.passed}/{verification.total}</strong></div>
                                  <span style={{ "--wj-progress": `${verification.passed / verification.total * 100}%` } as React.CSSProperties} />
                                </div>}
                                <div className="wj-task-actions" data-quiet={["running", "attention"].includes(lane.id) || undefined}>
                                  {editing
                                    ? <Button variant="ghost" size="xs" onClick={() => setEditingCardId(undefined)}>Done</Button>
                                    : childProgress.total > 0
                                      ? childProgress.done === childProgress.total
                                        ? <span className="wj-task-complete"><RefreshCw />Reconciling child results</span>
                                        : <span className="wj-task-complete">{childProgress.done}/{childProgress.total} complete</span>
                                    : ["running", "attention"].includes(lane.id)
                                      ? null
                                    : cardRole === "review"
                                      ? <Button disabled={!boardWritable} variant="ghost" size="xs" onClick={() => onReview(card)}><Search />Review evidence</Button>
                                      : cardRole !== "done"
                                        ? <Button disabled={!boardWritable || Boolean(card.taskLane?.closedAt)} variant="ghost" size="xs" onClick={() => intervene(card)}><Play />Start fresh task agent</Button>
                                        : <span className="wj-task-complete"><CheckIcon />Complete</span>}
                                  <span className="flex-1" />
                                    {!editing && <DropdownMenu onOpenChange={(open) => { if (!open) setDeleteArmed(undefined); }}>
                                      <DropdownMenuTrigger asChild><Button disabled={!boardWritable} aria-label={`Task actions: ${card.title}`} variant="ghost" size="icon-xs"><MoreHorizontal /></Button></DropdownMenuTrigger>
                                      <DropdownMenuContent className="wj-task-action-menu" align="end" sideOffset={6}>
                                        {renderTaskMenuItems(card, cardRole, childProgress)}
                                      </DropdownMenuContent>
                                    </DropdownMenu>}
                                </div>
                              </CardContent>
                                </Card>
                              </ContextMenuTrigger>
                              <ContextMenuContent className="wj-task-action-menu">
                                {renderTaskMenuItems(card, cardRole, childProgress, true)}
                              </ContextMenuContent>
                            </ContextMenu>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </ScrollArea>
            {showAgentRail && <aside className={`wj-agent-rail ${agentRailCollapsed ? "collapsed" : ""}`} style={{ "--wj-agent-rail-width": `${agentRailWidth}px` } as React.CSSProperties}>
              {!agentRailCollapsed && <div className="wj-agent-rail-resizer" role="separator" tabIndex={0} aria-label="Resize agent rail" aria-orientation="vertical" aria-valuemin={190} aria-valuemax={380} aria-valuenow={agentRailWidth} onPointerDown={(event) => beginHorizontalResize(event, agentRailWidth, 190, 380, -1, onAgentRailWidth, onAgentRailCollapsed)} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); if (event.key === "ArrowRight" && agentRailWidth <= 190) onAgentRailCollapsed(true); else onAgentRailWidth(Math.min(380, Math.max(190, agentRailWidth + (event.key === "ArrowLeft" ? 8 : -8)))); } }} />}
              <div className="wj-agent-rail-header"><div><div className="wj-section-label">Team</div>{!agentRailCollapsed && <span>{structuredRuntimes.length} connected</span>}</div><Button aria-label={agentRailCollapsed ? "Expand agent rail" : "Collapse agent rail"} variant="ghost" size="icon-xs" onClick={() => onAgentRailCollapsed(!agentRailCollapsed)}>{agentRailCollapsed ? <ChevronsLeft /> : <ChevronsRight />}</Button></div>
              {agentRailCollapsed && <div className="wj-agent-rail-stack">{structuredRuntimes.slice(0, 6).map((runtime) => <ContextMenu key={runtime.nodeId}><ContextMenuTrigger asChild><div
                className="wj-agent-drop-target"
              ><AgentAvatar id={runtime.nodeId} label={agentName(runtime.nodeId)} status={runtime.status} /></div></ContextMenuTrigger><ContextMenuContent className="min-w-48">{renderAgentRailMenuItems(runtime)}</ContextMenuContent></ContextMenu>)}</div>}
              {!agentRailCollapsed && <>
                <div className="wj-team-signals">
                  <div><strong>{activeRuntimes.length}</strong><span>working</span></div>
                  <div className={attentionRuntimes.length ? "attention" : ""}><strong>{attentionRuntimes.length}</strong><span>attention</span></div>
                  <div className={fileConflicts.length ? "attention" : ""}><strong>{fileConflicts.length}</strong><span>conflicts</span></div>
                  <div className={waitingRelationships.length ? "attention" : ""}><strong>{waitingRelationships.length}</strong><span>waiting</span></div>
                </div>
                {fileConflicts.length > 0 && <details className="wj-team-conflicts"><summary>Overlapping files</summary>{fileConflicts.map((conflict) => <div title={conflict.file} key={conflict.file}><span>{conflict.file}</span><small>{conflict.cardIds.length} tasks</small></div>)}</details>}
                {waitingRelationships.length > 0 && <details className="wj-team-dependencies">
                  <summary>Waiting chains</summary>
                  {waitingRelationships.map((relationship) => {
                    const waitingCard = state.cards.find((card) => card.id === relationship.cardId);
                    const blockers = relationship.waitingOnCardIds.flatMap((id) => {
                      const blocker = state.cards.find((card) => card.id === id);
                      return blocker ? [blocker.title] : [];
                    });
                    return <button type="button" key={relationship.cardId} onMouseEnter={() => setDependencyFocusCardId(relationship.cardId)} onMouseLeave={() => setDependencyFocusCardId(undefined)} onFocus={() => setDependencyFocusCardId(relationship.cardId)} onBlur={() => setDependencyFocusCardId(undefined)}>
                      <span>{waitingCard?.title}</span><small>waiting on {blockers.join(", ")}</small>
                    </button>;
                  })}
                </details>}
                <div className="wj-agent-list">{structuredRuntimes.map((runtime) => {
                  const assignedCards = state.cards.filter((card) => card.assigneeIds.includes(runtime.nodeId) || card.reviewerId === runtime.nodeId);
                  const currentCard = opsCurrentCardForAgent(state, runtime.nodeId);
                  const currentWait = currentCard ? waitingByCard.get(currentCard.id) : undefined;
                  const waitingOn = currentWait?.waitingOnCardIds.flatMap((id) => {
                    const dependency = state.cards.find((card) => card.id === id);
                    return dependency ? [dependency.title] : [];
                  });
                  const waitingOnAgents = currentWait?.waitingOnAgentIds
                    .filter((id) => id !== runtime.nodeId)
                    .map(agentName);
                  const runtimeDetail = visibleRunStateDetail(runtime.status, runtime.statusSummary);
                  return <ContextMenu key={runtime.nodeId}><ContextMenuTrigger asChild><article
                    className="wj-agent-status"
                    data-status={runtime.status}
                  >
                    <AgentAvatar id={runtime.nodeId} label={agentName(runtime.nodeId)} status={runtime.status} />
                    <div className="min-w-0"><div><strong>{agentName(runtime.nodeId)}</strong><RunStateBadge status={runtime.status} variant="compact" /></div><small>{currentCard?.title ?? "Available"}</small>{waitingOn?.length ? <p className="waiting">Waiting on {waitingOnAgents?.length ? waitingOnAgents.join(", ") : waitingOn.join(", ")}</p> : runtimeDetail && <p>{runtimeDetail}</p>}<footer><span>{assignedCards.length} {assignedCards.length === 1 ? "task" : "tasks"}</span>{["failed", "disconnected"].includes(runtime.status) && <Button size="xs" onClick={() => onResumeRuntime(runtime)}>Recover</Button>}<Button variant="ghost" size="xs" onClick={() => onQueryRuntime(runtime)}>Query</Button></footer></div>
                  </article></ContextMenuTrigger><ContextMenuContent className="min-w-48">{renderAgentRailMenuItems(runtime)}</ContextMenuContent></ContextMenu>;
                })}</div>
              </>}
            </aside>}
          </div>
        </>
      ) : (
        <div className="wj-spec-surface min-h-0 flex flex-1 flex-col">
          <div className="wj-spec-tabs">
            <Tabs value={specKind} onValueChange={(value) => setSpecKind(value as "prd" | "tdd")}>
              <TabsList aria-label="Specification documents">
                <TabsTrigger value="prd">Requirements</TabsTrigger>
                <TabsTrigger value="tdd">Technical design</TabsTrigger>
              </TabsList>
            </Tabs>
            <span>Stored separately as PRD.md and TDD.md</span>
          </div>
          <DocumentSurface
            kind={specKind}
            value={specKind === "prd" ? state.prd : state.tdd}
            onChange={(value) => onDocument(specKind, value)}
            onGenerate={() => onGenerate(specKind)}
            onGenerateWithAgent={() => onGenerateWithAgent(specKind)}
            onCreateTasks={() => onCreateTasks(specKind)}
            exists={Boolean(selectedDocument?.exists)}
            onCreate={() => onCreateDocument(specKind)}
            onMigrate={onMigrateLegacy}
            boardWritable={boardWritable}
            saveStatus={documentSaveStatus}
          />
        </div>
      )}
      <AlertDialog open={Boolean(recoveryCard)} onOpenChange={(open) => !open && setRecoveryCard(undefined)}>
        <AlertDialogContent className="wj-dialog wj-dialog-medium">
          <AlertDialogHeader>
            <AlertDialogTitle>{recoveryReason ?? "Task needs intervention"}</AlertDialogTitle>
            <AlertDialogDescription>
              “{recoveryCard?.title}” keeps its ownership, contract, and coordination history while you choose the safest recovery.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {recoveryRuntime?.statusSummary && <p className="wj-recovery-summary">{recoveryRuntime.statusSummary}</p>}
          {recoveryConflictFiles.length > 0 && <div className="wj-recovery-files"><span>Conflicting files</span>{recoveryConflictFiles.map((file) => <code key={file}>{file}</code>)}</div>}
          <AlertDialogFooter className="wj-recovery-footer">
            <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
            <div className="wj-recovery-footer-actions">
              <Button variant="outline" onClick={() => {
                if (!recoveryCard) return;
                onReturnToReady(recoveryCard);
                setRecoveryCard(undefined);
              }}><Minus />Move to Ready</Button>
              {recoveryConflictFiles.length > 0 && <Button variant="outline" onClick={() => {
                if (!recoveryCard) return;
                setInspectedCardId(recoveryCard.id);
                setRecoveryCard(undefined);
              }}><Search />Inspect conflict</Button>}
              {recoveryRuntime && <Button variant="outline" onClick={() => onQueryRuntime(recoveryRuntime)}><RefreshCw />Refresh status</Button>}
              {!recoveryRuntime && recoveryCard && opsCanCompleteWithOverride(recoveryCard) && <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="More recovery actions"><MoreHorizontal /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onSelect={() => {
                    setOverrideCard(recoveryCard);
                    setRecoveryCard(undefined);
                  }}><CheckIcon />Complete override…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>}
              {recoveryRuntime && ["failed", "disconnected"].includes(recoveryRuntime.status) && <AlertDialogAction onClick={() => {
                onResumeRuntime(recoveryRuntime);
                setRecoveryCard(undefined);
              }}><Play />Resume agent</AlertDialogAction>}
              {recoveryRuntime && !["failed", "disconnected"].includes(recoveryRuntime.status) && <AlertDialogAction onClick={() => {
                onOpenRuntime(recoveryRuntime);
                setRecoveryCard(undefined);
              }}><Terminal />Open agent</AlertDialogAction>}
              {!recoveryRuntime && recoveryCard && !recoveryCard.taskLane?.closedAt && <AlertDialogAction onClick={() => {
                if (!recoveryCard) return;
                void onStartAgent(recoveryCard);
                setRecoveryCard(undefined);
              }}><Plus />Start fresh task agent</AlertDialogAction>}
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(overrideCard)} onOpenChange={(open) => !open && setOverrideCard(undefined)}>
        <AlertDialogContent className="wj-dialog wj-dialog-medium">
          <AlertDialogHeader>
            <AlertDialogTitle>Complete without verification?</AlertDialogTitle>
            <AlertDialogDescription>
              “{overrideCard?.title}” will be marked done with a human override and no agent verification evidence.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              if (!overrideCard) return;
              void onExecuteAction(overrideCard, "complete");
              setOverrideCard(undefined);
            }}><CheckIcon />Complete override</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={bulkRecoveryOpen} onOpenChange={setBulkRecoveryOpen}>
        <AlertDialogContent className="wj-dialog wj-dialog-medium">
          <AlertDialogHeader>
            <AlertDialogTitle>Recover {orphanedCards.length} orphaned tasks</AlertDialogTitle>
            <AlertDialogDescription>
              These tasks reference agents or reviewers that are no longer connected. Returning them to Ready releases stale ownership without deleting task history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="wj-recovery-list">{orphanedCards.map((card) => <div key={card.id}><strong>{card.title}</strong><small>{opsAttentionReason(card, roleByColumnId.get(card.columnId) ?? "queued", cardRuntimeStatuses(card), false)}</small></div>)}</div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              onBulkReturnToReady(orphanedCards);
              setBulkRecoveryOpen(false);
            }}><Minus />Return all to Ready</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(decompositionCard && !decompositionProposal)} onOpenChange={(open) => {
        if (!open && !decompositionBusy) setDecompositionCard(undefined);
      }}>
        <AlertDialogContent className="wj-dialog wj-dialog-medium">
          <AlertDialogHeader>
            <AlertDialogTitle>Decompose “{decompositionCard?.title}”</AlertDialogTitle>
            <AlertDialogDescription>An idle structured agent will propose 2–6 editable child tasks without changing files or starting work.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="wj-orchestration-field">
            <Label htmlFor="ops-planning-agent">Planning agent</Label>
            <Select value={decompositionPlannerId} onValueChange={setDecompositionPlannerId}>
              <SelectTrigger id="ops-planning-agent"><SelectValue placeholder="Choose an idle agent" /></SelectTrigger>
              <SelectContent>{idleStructuredRuntimes.map((runtime) => <SelectItem value={runtime.nodeId} key={runtime.nodeId}>{agentName(runtime.nodeId)}</SelectItem>)}</SelectContent>
            </Select>
            {!idleStructuredRuntimes.length && <p className="text-sm text-muted-foreground">No idle structured agent is connected.</p>}
            {decompositionError && <p className="text-sm text-destructive" role="alert">{decompositionError}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={decompositionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!decompositionPlannerId || decompositionBusy} onClick={(event) => {
              event.preventDefault();
              if (!decompositionCard) return;
              setDecompositionBusy(true);
              setDecompositionError("");
              void onRequestDecomposition(decompositionCard, decompositionPlannerId)
                .then(setDecompositionProposal)
                .catch((cause) => setDecompositionError(cause instanceof Error ? cause.message : String(cause)))
                .finally(() => setDecompositionBusy(false));
            }}>{decompositionBusy ? <><DotMatrixLoader variant="thinking" size={16} />Planning…</> : "Generate plan"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Sheet open={Boolean(decompositionProposal)} onOpenChange={(open) => {
        if (open || decompositionBusy) return;
        setDecompositionProposal(undefined);
        setDecompositionCard(undefined);
        setDecompositionPreview(undefined);
        setDecompositionError("");
      }}>
        <SheetContent className="wj-execution-inspector" side="right">
          {decompositionProposal && decompositionCard && <>
            <SheetHeader>
              <SheetTitle>Review decomposition</SheetTitle>
              <SheetDescription>Edit the work contracts, ownership, dependencies, and file scopes before creating anything.</SheetDescription>
            </SheetHeader>
            <ScrollArea className="wj-execution-inspector-body">
              <div className="space-y-4 p-1">
                {decompositionProposal.tasks.map((task, index) => <Card size="sm" key={task.key}>
                  <CardHeader><CardTitle>{index + 1}. {task.title || "Untitled child task"}</CardTitle><CardDescription>{task.key}</CardDescription></CardHeader>
                  <CardContent className="space-y-3">
                    <div><Label htmlFor={`decompose-title-${task.key}`}>Title</Label><Input id={`decompose-title-${task.key}`} value={task.title} onChange={(event) => updateDecompositionTask(task.key, { title: event.target.value })} /></div>
                    <div><Label htmlFor={`decompose-detail-${task.key}`}>Objective</Label><Textarea id={`decompose-detail-${task.key}`} value={task.detail} onChange={(event) => updateDecompositionTask(task.key, { detail: event.target.value })} /></div>
                    <div><Label htmlFor={`decompose-owner-${task.key}`}>Owner (shared checkout)</Label><Select value={task.agentId ?? "unassigned"} onValueChange={(agentId) => updateDecompositionTask(task.key, { agentId: agentId === "unassigned" ? undefined : agentId })}><SelectTrigger id={`decompose-owner-${task.key}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Leave in Ready for isolation</SelectItem>{structuredRuntimes.map((runtime) => <SelectItem value={runtime.nodeId} key={runtime.nodeId}>{agentName(runtime.nodeId)}</SelectItem>)}</SelectContent></Select></div>
                    <details className="wj-contract-composer">
                      <summary>Delegation contract</summary>
                      <div className="space-y-3 pt-3">
                        <div><Label htmlFor={`decompose-definition-${task.key}`}>Definition of done</Label><Textarea id={`decompose-definition-${task.key}`} value={task.definitionOfDone} onChange={(event) => updateDecompositionTask(task.key, { definitionOfDone: event.target.value })} /></div>
                        <div><Label htmlFor={`decompose-constraints-${task.key}`}>Constraints</Label><Textarea id={`decompose-constraints-${task.key}`} value={task.constraints} onChange={(event) => updateDecompositionTask(task.key, { constraints: event.target.value })} /></div>
                        <div><Label htmlFor={`decompose-verification-${task.key}`}>Verification command</Label><Input id={`decompose-verification-${task.key}`} className="font-mono" value={task.verificationCommand} onChange={(event) => updateDecompositionTask(task.key, { verificationCommand: event.target.value })} /></div>
                        <div><Label htmlFor={`decompose-files-${task.key}`}>Expected files</Label><Textarea id={`decompose-files-${task.key}`} className="font-mono" value={task.expectedFiles.join("\n")} onChange={(event) => updateDecompositionTask(task.key, { expectedFiles: event.target.value.split(/\r?\n/).map((file) => file.trim()).filter(Boolean) })} placeholder="One path per line" /></div>
                        <fieldset><legend>Dependencies</legend>{decompositionProposal.tasks.filter((candidate) => candidate.key !== task.key).map((candidate) => <label key={candidate.key}><Checkbox checked={task.dependencyKeys.includes(candidate.key)} onCheckedChange={(checked) => updateDecompositionTask(task.key, { dependencyKeys: checked ? [...task.dependencyKeys, candidate.key] : task.dependencyKeys.filter((key) => key !== candidate.key) })} /><span>{candidate.title}</span></label>)}</fieldset>
                      </div>
                    </details>
                  </CardContent>
                </Card>)}
                {opsDecompositionHasCycle(decompositionProposal.tasks) && <p className="text-sm text-destructive" role="alert">Dependencies contain a cycle.</p>}
                {decompositionPreview && <Card size="sm"><CardHeader><CardTitle>Dispatch preview</CardTitle><CardDescription>{decompositionPreview.dispatchKeys.length} task{decompositionPreview.dispatchKeys.length === 1 ? "" : "s"} will start in shared checkouts; the rest stay in Ready for isolated start.</CardDescription></CardHeader><CardContent className="space-y-2">{decompositionPreview.preview?.targets?.map((target) => <div className="flex items-center justify-between gap-3 text-sm" key={`${target.nodeId}:${target.taskId}`}><span>{target.title}</span><Badge variant={target.ready ? "secondary" : "destructive"}>{target.ready ? "Ready" : target.reason ?? "Unavailable"}</Badge></div>)}</CardContent></Card>}
                {decompositionError && <p className="text-sm text-destructive" role="alert">{decompositionError}</p>}
              </div>
            </ScrollArea>
            <footer className="wj-execution-inspector-actions">
              <Button variant="outline" disabled={decompositionBusy} onClick={() => {
                setDecompositionProposal(undefined);
                setDecompositionCard(undefined);
                setDecompositionPreview(undefined);
              }}>Cancel</Button>
              <Button disabled={decompositionBusy || opsDecompositionHasCycle(decompositionProposal.tasks) || decompositionProposal.tasks.some((task) => !task.title.trim() || !task.detail.trim() || !task.definitionOfDone.trim() || !task.verificationCommand.trim())} onClick={() => {
                setDecompositionBusy(true);
                setDecompositionError("");
                const operation = decompositionPreview
                  ? onCommitDecomposition(decompositionCard, decompositionProposal.tasks, decompositionPreview.dispatchKeys, decompositionPreview.preview).then(() => {
                      setDecompositionProposal(undefined);
                      setDecompositionCard(undefined);
                      setDecompositionPreview(undefined);
                    })
                  : onPreviewDecomposition(decompositionCard, decompositionProposal.tasks).then(setDecompositionPreview);
                void operation.catch((cause) => setDecompositionError(cause instanceof Error ? cause.message : String(cause))).finally(() => setDecompositionBusy(false));
              }}>{decompositionBusy ? <><DotMatrixLoader variant="thinking" size={16} />Working…</> : decompositionPreview ? `Create tasks${decompositionPreview.dispatchKeys.length ? ` & start ${decompositionPreview.dispatchKeys.length}` : ""}` : "Review dispatch"}</Button>
            </footer>
          </>}
        </SheetContent>
      </Sheet>
      <AlertDialog open={Boolean(pendingAction)} onOpenChange={(open) => !open && setPendingAction(undefined)}>
        <AlertDialogContent className="wj-dialog wj-dialog-medium">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction ? opsActionTitle(pendingAction.action, pendingAction.card) : "Update task"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.action === "pause" && `wheeljack will ask the assigned agent to preserve progress on “${pendingAction.card.title}” and report when pausing is complete. The task stays active until that status arrives.`}
              {pendingAction?.action === "complete" && `“${pendingAction.card.title}” is marked complete without the normal evidence gate. This is recorded as a human override.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingAction?.preview && <div className="wj-recovery-list">
            {pendingAction.preview.targets?.map((target) => <div key={`${target.nodeId}:${target.taskId ?? ""}`}><strong>{target.title}</strong><small>{target.ready ? "Ready to receive this task" : target.reason ?? "Unavailable"}</small></div>)}
          </div>}
          {pendingAction?.error && <p className="text-sm text-destructive" role="alert">{pendingAction.error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(pendingAction?.busy || pendingAction?.preview?.targets?.some((target) => !target.ready))}
              onClick={() => {
                if (!pendingAction) return;
                const current = pendingAction;
                setPendingAction({ ...current, busy: true, error: undefined });
                const operation = current.preview
                  ? onExecuteAction(current.card, current.action, current.agentId, current.preview)
                  : onPreviewAction(current.card, current.action, current.agentId).then((preview) => {
                      if (preview) {
                        setPendingAction({ ...current, preview });
                        return;
                      }
                      return onExecuteAction(current.card, current.action, current.agentId).then(() => setPendingAction(undefined));
                    });
                void operation.then(() => {
                  if (current.preview || ["complete"].includes(current.action)) setPendingAction(undefined);
                }).catch((cause) => {
                  setPendingAction({ ...current, error: cause instanceof Error ? cause.message : String(cause) });
                });
              }}
            >{pendingAction?.busy ? <><DotMatrixLoader variant="thinking" size={16} />Working…</> : pendingAction?.preview ? "Confirm route" : "Review route"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {(archiveDoneOpen || archiveOpen) && <Suspense fallback={null}><OpsArchiveDialogs
        archiveDoneOpen={archiveDoneOpen}
        archiveOpen={archiveOpen}
        writable={boardWritable}
        state={state}
        runtimes={structuredRuntimes}
        onArchiveDoneOpen={setArchiveDoneOpen}
        onArchiveOpen={setArchiveOpen}
        onArchiveDone={onArchiveDone}
        onRestoreArchived={onRestoreArchived}
      /></Suspense>}
      <AlertDialog open={Boolean(contractCard)} onOpenChange={(open) => !open && setContractCard(undefined)}>
        <AlertDialogContent className="wj-dialog wj-dialog-medium">
          <AlertDialogHeader>
            <AlertDialogTitle>Verification contract</AlertDialogTitle>
            <AlertDialogDescription>Define the checks the worker must run before reporting “{contractCard?.title}” complete.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="edit-task-definition">Definition of done</Label><Textarea id="edit-task-definition" value={contractEditDefinition} onChange={(event) => setContractEditDefinition(event.target.value)} placeholder="Observable acceptance criteria" /></div>
            <div><Label htmlFor="edit-task-constraints">Constraints</Label><Textarea id="edit-task-constraints" value={contractEditConstraints} onChange={(event) => setContractEditConstraints(event.target.value)} placeholder="Boundaries and compatibility requirements" /></div>
            <div><Label htmlFor="edit-task-verification">Verification command</Label><Input className="font-mono" id="edit-task-verification" value={contractEditVerification} onChange={(event) => setContractEditVerification(event.target.value)} placeholder="bun run test" /></div>
            <div><Label>Review policy</Label><Select value={contractEditReviewPolicy} onValueChange={(value) => setContractEditReviewPolicy(value as OpsTaskContractDraft["reviewPolicy"])}><SelectTrigger aria-label="Edit review policy"><SelectValue /></SelectTrigger><SelectContent><ReviewPolicyOptions /></SelectContent></Select></div>
            {contractCard?.taskLane && (!contractEditDefinition.trim() || !contractEditVerification.trim()) && <p className="text-sm text-destructive" role="alert">An isolated task needs both a definition of done and a verification command.</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={Boolean(contractCard?.taskLane && (!contractEditDefinition.trim() || !contractEditVerification.trim()))} onClick={() => {
              if (!contractCard) return;
              onUpdate(contractCard, {
                definitionOfDone: contractEditDefinition.trim(),
                constraints: contractEditConstraints.trim(),
                verificationCommand: contractEditVerification.trim(),
                reviewPolicy: contractEditReviewPolicy,
              });
              setContractCard(undefined);
            }}>Save contract</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(dependencyCard)} onOpenChange={(open) => !open && setDependencyCard(undefined)}>
        <AlertDialogContent className="wj-dialog wj-dialog-medium">
          <AlertDialogHeader>
            <AlertDialogTitle>Dependencies for “{dependencyCard?.title}”</AlertDialogTitle>
            <AlertDialogDescription>Relationships are soft by default and do not block agents. Mark one hard only when its artifact is required first.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="wj-dependency-picker">
            {dependencyCard && state.cards.filter((card) => card.id !== dependencyCard.id).map((card) => {
              const disabled = opsWouldCreateDependencyCycle(state.cards, dependencyCard.id, card.id);
              const checked = dependencyDraft.has(card.id);
              return <div className="wj-dependency-option" data-disabled={disabled || undefined} key={card.id}>
                <Checkbox
                  aria-label={`Dependency on ${card.title}`}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(value) => setDependencyDraft((current) => {
                    const next = new Set(current);
                    if (value) next.add(card.id);
                    else {
                      next.delete(card.id);
                      setDependencyHardDraft((hard) => { const updated = new Set(hard); updated.delete(card.id); return updated; });
                    }
                    return next;
                  })}
                />
                <span><strong>{card.title}</strong><small>{state.columns.find((column) => column.id === card.columnId)?.title}</small></span>
                {checked && <Button type="button" variant="ghost" size="xs" aria-label={`${dependencyHardDraft.has(card.id) ? "Make soft" : "Make hard"} relationship with ${card.title}`} onClick={() => setDependencyHardDraft((current) => { const next = new Set(current); if (next.has(card.id)) next.delete(card.id); else next.add(card.id); return next; })}>{dependencyHardDraft.has(card.id) ? "Hard" : "Soft"}</Button>}
              </div>;
            })}
            {dependencyCard && state.cards.length === 1 && <p>No other tasks can be linked yet.</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (!dependencyCard) return;
              onDependencies(dependencyCard, [...dependencyDraft], [...dependencyHardDraft]);
              setDependencyCard(undefined);
            }}>Save dependencies</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Sheet open={Boolean(inspectedCard)} onOpenChange={(open) => !open && setInspectedCardId(undefined)}>
        <SheetContent className="wj-execution-inspector" side="right">
          {inspectedCard && <>
            <SheetHeader>
              <div className="wj-inspector-state"><span>{executionLanes.find((lane) => lane.id === cardLane(inspectedCard))?.title}</span><small>{inspectedCard.priority} priority</small></div>
              <SheetTitle>{inspectedCard.title}</SheetTitle>
              <SheetDescription asChild>
                <div className="wj-inspector-description agent-prose"><Markdown skipHtml components={{
                  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
                }}>{inspectedCard.detail || "No objective was recorded."}</Markdown></div>
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="wj-execution-inspector-body">
              <section>
                <div className="wj-inspector-section-title"><span>Execution</span>{formatOpsElapsed(inspectedCard.startedAt, inspectedCard.completedAt ?? inspectedCard.pausedAt, now) && <time>{formatOpsElapsed(inspectedCard.startedAt, inspectedCard.completedAt ?? inspectedCard.pausedAt, now)}</time>}</div>
                <div className="wj-inspector-team">
                  <div><span>Owner</span><strong>{inspectedCard.assigneeIds.length ? inspectedCard.assigneeIds.map(agentName).join(", ") : "Unassigned"}</strong></div>
                  <div><span>Review</span><strong>{inspectedReview}</strong></div>
                </div>
                <div className="wj-inspector-current"><span>Workspace</span><p>{taskWorkspaceLabel(inspectedCard, projectIsRepo)}{inspectedCard.taskLane && <><br /><code>{inspectedCard.taskLane.branch}</code><br /><code>{inspectedCard.taskLane.cwd}</code></>}</p></div>
                {inspectedCard.lastNote && <div className="wj-inspector-current"><span>Current action</span><p>{inspectedCard.lastNote}</p></div>}
                {inspectedChildProgress.total > 0 && <div className="wj-inspector-current"><span>Child progress</span><p>{inspectedChildProgress.done} of {inspectedChildProgress.total} complete</p></div>}
              </section>
              <section>
                <div className="wj-inspector-section-title"><span>Delegation contract</span></div>
                <dl className="wj-contract-summary">
                  <div><dt>Definition of done</dt><dd>{inspectedCard.definitionOfDone || "Not defined"}</dd></div>
                  <div><dt>Constraints</dt><dd>{inspectedCard.constraints || "No explicit constraints"}</dd></div>
                  <div><dt>Verification</dt><dd><code>{inspectedCard.verificationCommand || "Not defined"}</code></dd></div>
                  <div><dt>Review policy</dt><dd>{reviewPolicyLabels[inspectedCard.reviewPolicy ?? "agent"]}</dd></div>
                </dl>
              </section>
              <section>
                <div className="wj-inspector-section-title"><span>Verification evidence</span><strong>{inspectedVerification?.passed}/{inspectedVerification?.total}</strong></div>
                <div className="wj-inspector-checks">{inspectedVerification?.checks.map((check) => <div data-passed={check.passed || undefined} key={check.label}><CheckIcon /><span>{check.label}</span></div>)}</div>
                {inspectedConflictFiles.length > 0 && <div className="wj-inspector-warning"><CircleDot />Resolve {inspectedConflictFiles.length} overlapping file {inspectedConflictFiles.length === 1 ? "claim" : "claims"} before approval.</div>}
              </section>
              {(inspectedCard.dependencyIds?.length || inspectedCard.expectedFiles.length) ? <section>
                <div className="wj-inspector-section-title"><span>Working set</span></div>
                {Boolean(inspectedCard.dependencyIds?.length) && <div className="wj-inspector-list"><strong>Relationships</strong>{inspectedCard.dependencyIds?.map((id) => <span key={id}>{state.cards.find((card) => card.id === id)?.title ?? id} · {inspectedCard.dependencyKinds?.[id] === "hard" ? "Hard" : "Soft"}</span>)}</div>}
                {inspectedCard.expectedFiles.length > 0 && <div className="wj-inspector-list"><strong>Claimed files</strong>{inspectedCard.expectedFiles.map((file) => <code key={file}>{file}</code>)}</div>}
              </section> : null}
              <section>
                <div className="wj-inspector-section-title"><span>Task timeline</span><strong>{inspectedTimeline.length}</strong></div>
                <ol className="wj-inspector-events">{inspectedTimeline.map((item) => <li data-kind={item.kind} key={item.id}><span /><div><strong>{item.message}</strong><small>{item.actor ? `${agentName(item.actor)} · ` : ""}{item.source} · {formatTime(item.timestamp)}</small></div></li>)}</ol>
                {!inspectedTimeline.length && <p className="wj-inspector-empty">No task activity yet.</p>}
              </section>
            </ScrollArea>
            <footer className="wj-execution-inspector-actions">
              {inspectedOneOff && <Button variant="outline" onClick={() => { setInspectedCardId(undefined); onSaveBot(inspectedOneOff); }}><Briefcase />Save bot</Button>}
              {inspectedCard.taskLane && !inspectedCard.taskLane.closedAt && <Button variant="outline" disabled={Boolean(inspectedCard.taskLane.cleanup && ["queued", "resolving"].includes(inspectedCard.taskLane.cleanup.status))} onClick={() => onRemoveTaskLane(inspectedCard)}><Trash2 />{inspectedCard.taskLane.cleanup?.status === "blocked" ? "Retry cleanup" : inspectedCard.taskLane.cleanup ? "Resolving worktree…" : inspectedTaskLaneLive ? "Resolve worktree" : "Remove worktree"}</Button>}
              {inspectedRole === "done"
                ? <span className="wj-task-complete"><CheckIcon />Complete</span>
                : inspectedRole === "review"
                ? <Button onClick={() => { setInspectedCardId(undefined); onReview(inspectedCard); }}><Search />Review evidence</Button>
                : inspectedChildProgress.total > 0
                  ? inspectedChildProgress.done === inspectedChildProgress.total && <span className="wj-task-complete"><RefreshCw />Reconciling child results</span>
                  : <Button disabled={!boardWritable || Boolean(inspectedCard.taskLane?.closedAt)} onClick={() => { setInspectedCardId(undefined); intervene(inspectedCard); }}><Play />{cardLane(inspectedCard) === "attention" ? "Intervene" : inspectedTaskLaneLive ? "Open task agent" : "Start fresh task agent"}</Button>}
              <Button variant="outline" onClick={() => openDependencies(inspectedCard)}><GitBranch />Dependencies</Button>
            </footer>
          </>}
        </SheetContent>
      </Sheet>
    </main>
    </ContextMenuTrigger>
    <ContextMenuContent className="min-w-56">
      {page === "board" ? <>
        {!kanban?.exists
          ? <ContextMenuItem onSelect={() => onCreateDocument("kanban")}><Plus />Create KANBAN.md</ContextMenuItem>
          : <ContextMenuItem disabled={!boardWritable} onSelect={() => setComposerOpen(true)}><Plus />New task</ContextMenuItem>}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={boardView === "board"} onSelect={() => setBoardView("board")}><Columns2 />Columns view</ContextMenuItem>
        <ContextMenuItem disabled={boardView === "list"} onSelect={() => setBoardView("list")}><Files />List view</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!boardWritable} onSelect={() => onGenerateWithAgent("kanban")}><MonitorCog />Generate with agent</ContextMenuItem>
        <ContextMenuItem onSelect={onBootstrapPlan}><LayoutDashboard />{missingDocumentCount ? "Bootstrap plan" : "Re-analyze project"}</ContextMenuItem>
      </> : page === "spec" ? <>
        {!selectedDocument?.exists && (specKind === "prd" ? state.prd : state.tdd) && <ContextMenuItem onSelect={onMigrateLegacy}>Migrate legacy</ContextMenuItem>}
        <ContextMenuItem onSelect={() => onGenerateWithAgent(specKind)}><MonitorCog />Generate with agent</ContextMenuItem>
        <ContextMenuItem onSelect={() => selectedDocument?.exists ? onGenerate(specKind) : onCreateDocument(specKind)}>{selectedDocument?.exists ? "Use template" : `Create ${specKind.toUpperCase()}.md`}</ContextMenuItem>
        <ContextMenuItem disabled={!selectedDocument?.exists || !boardWritable} onSelect={() => onCreateTasks(specKind)}><Plus />Add starter tasks</ContextMenuItem>
      </> : <>
        <ContextMenuItem onSelect={() => onPage("board")}><LayoutDashboard />Open Plan</ContextMenuItem>
        <ContextMenuItem onSelect={onOpenAgentSettings}><Settings />Agent policy settings</ContextMenuItem>
      </>}
      <DevToolsContextItem />
    </ContextMenuContent>
    </ContextMenu>
  );
}

export function FloorSurface({
  model,
  state,
  runtimes,
  nodes,
  now,
  runGraphModel,
  runGraphSelection,
  onRunGraphRange,
  onRunGraphSelection,
  autonomousPickup,
  autonomousConcurrency,
  maxAutonomousConcurrency,
  onAutonomousPickupChange,
  onAutonomousConcurrencyChange,
  onOpenAgentSettings,
  onInspect,
  onReview,
  onOpenRuntime,
  onResumeRuntime,
  onRespondRuntime,
  onCancelRuntime,
  onStartAgent,
  steeringCardId,
  steeringDraft,
  onSteeringCardId,
  onSteeringDraft,
  onQueueSteering,
  onCancelSteering,
  onOpenActivity,
  onOpenHistory,
  onAcknowledgeActivity,
  projectIsRepo,
  railWidth,
  onRailWidth,
}: {
  model: ReturnType<typeof deriveOpsFloorModel>;
  state: OpsState;
  runtimes: PaneRuntime[];
  nodes: Record<string, CanvasNode>;
  now: number;
  runGraphModel: ReturnType<typeof deriveOpsRunGraphModel>;
  runGraphSelection?: OpsRunGraphSelection;
  onRunGraphRange: (range: OpsRunGraphRange) => void;
  onRunGraphSelection: (selection?: OpsRunGraphSelection) => void;
  autonomousPickup: boolean;
  autonomousConcurrency: number;
  maxAutonomousConcurrency: number;
  onAutonomousPickupChange: (enabled: boolean) => void;
  onAutonomousConcurrencyChange: (limit: number) => void;
  onOpenAgentSettings: () => void;
  onInspect: (cardId: string) => void;
  onReview: (card: OpsCard) => void;
  onOpenRuntime: (runtime: PaneRuntime) => void;
  onResumeRuntime: (runtime: PaneRuntime) => void;
  onRespondRuntime: (runtime: PaneRuntime, approved: boolean) => Promise<boolean>;
  onCancelRuntime: (runtime: PaneRuntime) => Promise<boolean>;
  onStartAgent: (card: OpsCard) => Promise<boolean>;
  steeringCardId?: string;
  steeringDraft: string;
  onSteeringCardId: (cardId?: string) => void;
  onSteeringDraft: (value: string) => void;
  onQueueSteering: (card: OpsCard, text: string, metadata?: Pick<OpsSteeringDirective, "kind" | "conflictFiles">) => void;
  onCancelSteering: (card: OpsCard) => void;
  onOpenActivity: (event: ActivityEvent) => void;
  onOpenHistory: () => void;
  onAcknowledgeActivity: (event: ActivityEvent) => void;
  projectIsRepo?: boolean;
  railWidth: number;
  onRailWidth: (width: number) => void;
}) {
  const floorRef = useRef<HTMLDivElement>(null);
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  const unreadCount = model.sinceLeft.actionable.length + model.sinceLeft.updates.length;
  const [dockedCardId, setDockedCardId] = useState<string>();
  const [runGraphExpanded, setRunGraphExpanded] = useState(!runGraphModel.emptyWindow);
  const [stopRuntime, setStopRuntime] = useState<PaneRuntime>();
  const runtimeById = new Map(runtimes.map((runtime) => [runtime.nodeId, runtime]));
  const cardById = new Map(state.cards.map((card) => [card.id, card]));
  const agentName = (id: string) => resolveAgentLabel(nodes[id]?.title, state.agentLabels?.[id]);
  const selectedTaskIds = new Set(runGraphSelection?.taskIds ?? []);
  const recentEvents = model.recentActivity.slice(0, 5);
  const agentNowItems = model.agents.flatMap((agent) => {
    if (!agent.task || !["working", "attention"].includes(agent.state)) return [];
    return [[agent.task.card, agent.id] as const];
  });
  const liveNowItems = [...agentNowItems, ...state.cards.flatMap((card) =>
    !card.reconciliation || !["queued", "running", "awaiting_repair", "retrying"].includes(card.reconciliation.status)
      ? [] : [[card] as const])];
  const schedulerActiveAgents = runtimes.filter((runtime) => {
    const leaseId = nodes[runtime.nodeId]?.data.schedulerLeaseId;
    return typeof leaseId === "string" && leaseId.length > 0 && !isTerminalSessionStatus(runtime.status);
  }).length;
  const schedulerIntent = !autonomousPickup
    ? { label: "Manual starts", detail: model.nextAutonomousTask ? `Next planned: ${model.nextAutonomousTask.card.title}` : "No unassigned eligible task is available." }
    : schedulerActiveAgents >= autonomousConcurrency
      ? { label: "Auto-start limit reached", detail: `${schedulerActiveAgents}/${autonomousConcurrency} scheduler slots are in use.` }
      : model.nextAutonomousTask
        ? { label: "Next pickup", detail: model.nextAutonomousTask.card.title }
        : { label: "No eligible pickup", detail: "No unassigned eligible task is available." };
  useEffect(() => {
    if (!runGraphModel.emptyWindow) setRunGraphExpanded(true);
  }, [runGraphModel.emptyWindow]);
  const dockedCard = dockedCardId ? cardById.get(dockedCardId) : undefined;
  const dockedAttention = dockedCard ? model.attention.find((item) => item.cardId === dockedCard.id) : undefined;
  const dockedParticipants = dockedCard ? opsCardParticipantIds(dockedCard, runtimes) : [];
  const dockedRuntime = dockedParticipants.flatMap((id) => runtimeById.get(id) ?? [])[0];
  const dockedConflictFiles = dockedCard ? model.contentions.filter((conflict) => conflict.cardIds.includes(dockedCard.id)).map((conflict) => conflict.file) : [];
  const dockedVerification = dockedCard ? opsVerificationProgress(dockedCard, dockedConflictFiles.length > 0) : undefined;
  const dockedTimeline = dockedCard ? opsTaskTimeline(dockedCard, Object.values(nodes)) : [];
  const dockedRole = dockedCard ? state.columns.find((column) => column.id === dockedCard.columnId)?.role ?? "queued" : "queued";
  const dockedLane = dockedCard
    ? opsExecutionLane(dockedCard, dockedRole, dockedParticipants.flatMap((id) => runtimeById.get(id)?.status ?? []), dockedConflictFiles.length > 0)
    : undefined;
  const dockedCurrentStep = dockedCard?.runProgress?.steps.find((step) => step.id === dockedCard.runProgress?.currentStepId);
  const dockInspect = (cardId: string) => {
    if (document.activeElement instanceof HTMLElement) inspectorTriggerRef.current = document.activeElement;
    setDockedCardId(cardId);
    window.requestAnimationFrame(() => floorRef.current?.querySelector<HTMLElement>("#floor-inspector-heading")?.focus());
  };
  const closeInspector = () => {
    setDockedCardId(undefined);
    window.requestAnimationFrame(() => inspectorTriggerRef.current?.focus());
  };
  const selectRunGraphEvidence = (selection?: OpsRunGraphSelection) => {
    onRunGraphSelection(selection);
    if (!selection) return;
    if (selection.kind !== "conflict") {
      const cardId = selection.taskId ?? selection.taskIds[0];
      if (cardId && cardById.has(cardId)) dockInspect(cardId);
      return;
    }
    setDockedCardId(undefined);
    window.requestAnimationFrame(() => {
      const target = floorRef.current?.querySelector<HTMLElement>(`[data-conflict-file="${CSS.escape(selection.conflictFile ?? "")}"]`);
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
      target?.focus();
    });
  };
  const queueDirective = (card: OpsCard) => {
    if (!steeringDraft.trim()) return;
    onQueueSteering(card, steeringDraft);
    onSteeringDraft("");
    onSteeringCardId(undefined);
  };
  const arbitrate = (conflict: OpsFloorContention, ownerCardId: string) => {
    const owner = cardById.get(ownerCardId);
    if (
      owner?.steeringDirective?.kind === "file_conflict"
      && ["queued", "failed"].includes(owner.steeringDirective.status)
      && owner.steeringDirective.conflictFiles?.includes(conflict.file)
    ) onCancelSteering(owner);
    for (const cardId of conflict.cardIds) {
      if (cardId === ownerCardId) continue;
      const card = cardById.get(cardId);
      const directive = card?.steeringDirective;
      if (!card || directive?.status === "delivering") continue;
      onQueueSteering(card, `Yield ownership of ${conflict.file}. Stop editing it, coordinate with task ${ownerCardId}, then emit resolve_file_conflict with your complete remaining files list. The conflict remains open until that acknowledgement is emitted.`, {
        kind: "file_conflict",
        conflictFiles: [conflict.file],
      });
    }
  };
  const renderAgentRow = (agent: (typeof model.agents)[number]) => {
    const runtime = runtimeById.get(agent.id);
    const task = agent.task;
    const elapsed = formatOpsElapsed(runtime?.startedAt, runtime?.endedAt, now);
    const directive = task?.card.steeringDirective;
    const activeDirective = directive && ["queued", "delivering", "failed"].includes(directive.status) ? directive : undefined;
    const currentStep = task?.card.runProgress?.steps.find((step) => step.id === task.card.runProgress?.currentStepId);
    const lastActive = formatOpsRelative(agent.lastActivityAt, now);
    const agentLabel = agentName(agent.id);
    const meaningfulAction = visibleRunStateDetail(agent.status, agent.currentAction);
    const actionLabel = currentStep?.label
      ?? meaningfulAction
      ?? (agent.state === "idle" ? "Waiting for work" : agent.state === "unavailable" ? "Disconnected" : resolveRunState(agent.status).label);
    const actionDetail = currentStep && meaningfulAction && meaningfulAction !== currentStep.label
      ? meaningfulAction
      : lastActive
        ? `Last active ${lastActive}`
        : "No recorded action";
    return <article className="wj-floor-agent-row" data-agent-state={agent.state} data-card-id={task?.card.id} data-run-graph-selected={Boolean(task && selectedTaskIds.has(task.card.id)) || undefined} key={agent.id}>
      <button type="button" className="wj-floor-task-agent wj-floor-agent-open" disabled={!runtime} aria-label={runtime ? `Open ${agentLabel}` : `${agentLabel} disconnected`} onClick={() => runtime && onOpenRuntime(runtime)}>
        <AgentAvatar id={agent.id} label={agentLabel} status={agent.status} />
        <span><strong>{agentLabel}</strong><RunStateBadge status={agent.status} variant="compact" /></span>
      </button>
      <div className="wj-floor-task-work">
        {task ? <button type="button" className="wj-floor-task-title" onClick={() => dockInspect(task.card.id)}><strong>{task.card.title}</strong><ChevronRight /></button> : <strong className="wj-floor-agent-available">Available</strong>}
        <small>{task ? task.card.detail || "No task objective recorded" : agent.state === "unavailable" ? "Agent unavailable" : "No active project task"}</small>
      </div>
      <div className="wj-floor-agent-action">
        <strong>{actionLabel}</strong>
        <small>{actionDetail}</small>
      </div>
      <div className="wj-floor-agent-metrics">
        {task ? <><strong>{task.verification.passed}/{task.verification.total} checks</strong><small>{elapsed ?? lastActive ?? "Not timed"}</small></> : <><strong>{resolveRunState(agent.status).label}</strong><small>{lastActive ?? "No activity"}</small></>}
      </div>
      <footer>
        {runtime && task && ["starting", "running", "in_progress"].includes(runtime.status) && <>
          <Button variant="outline" size="sm" onClick={() => { onSteeringCardId(task.card.id); onSteeringDraft(activeDirective?.text ?? ""); }}>Steer</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More actions for ${agentLabel}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onOpenRuntime(runtime)}><Terminal />Open agent</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setStopRuntime(runtime)}><X />Stop now</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>}
      </footer>
      {task && activeDirective && <div className="wj-floor-directive" data-status={activeDirective.status} role="status">
        <div><strong>{activeDirective.status === "failed" ? "Direction not delivered" : activeDirective.status === "delivering" ? "Delivering after turn" : "Queued for next turn"}</strong><p>{activeDirective.text}</p>{activeDirective.error && <small>{activeDirective.error}</small>}</div>
        {activeDirective.status === "failed" && <Button variant="outline" size="xs" onClick={() => onQueueSteering(task.card, activeDirective.text)}>Retry</Button>}
        {["queued", "failed"].includes(activeDirective.status) && <Button variant="outline" size="xs" onClick={() => { onSteeringCardId(task.card.id); onSteeringDraft(activeDirective.text); }}>Edit</Button>}
        {["queued", "failed"].includes(activeDirective.status) && <Button variant="ghost" size="xs" onClick={() => onCancelSteering(task.card)}>Cancel</Button>}
      </div>}
      {task && steeringCardId === task.card.id && activeDirective?.status !== "delivering" && <form className="wj-floor-steering" onSubmit={(event) => { event.preventDefault(); queueDirective(task.card); }}>
        <Label htmlFor={`steer-${task.card.id}`}>Direction for the next turn</Label>
        <Textarea id={`steer-${task.card.id}`} autoFocus value={steeringDraft} onChange={(event) => onSteeringDraft(event.target.value)} placeholder="Applied only after the current turn completes" />
        <div><Button type="button" variant="ghost" size="sm" onClick={() => { onSteeringCardId(undefined); onSteeringDraft(""); }}>Cancel</Button><Button type="submit" size="sm" disabled={!steeringDraft.trim()}>Queue direction</Button></div>
      </form>}
    </article>;
  };
  const renderReadyTask = (task: OpsFloorTask, index: number) => <article className="wj-floor-queue-row" data-card-id={task.card.id} key={task.card.id}>
    <span className="wj-floor-queue-position" aria-label={`Queue position ${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>
    <button className="wj-floor-queue-task" type="button" onClick={() => dockInspect(task.card.id)}><strong>{task.card.title}</strong><small>{task.card.dependencyIds?.length ? `${task.card.dependencyIds.length} relationships · eligible` : "Eligible"} · {task.verification.passed}/{task.verification.total} checks</small></button>
    <Button variant="outline" size="sm" onClick={() => void onStartAgent(task.card)}><Play />Start</Button>
  </article>;
  const floorAttentionActions = (item: OpsFloorAttention): ActionCardAction[] => {
    const runtime = item.runtimeId ? runtimeById.get(item.runtimeId) : undefined;
    const card = item.cardId ? cardById.get(item.cardId) : undefined;
    const submitting = runtime ? pendingAgentInteraction(runtime.messages)?.interactionState === "submitting" : false;
    if (item.interactionKind === "approval" && runtime) return [
      { id: "deny", label: "Deny", intent: "secondary", disabled: submitting, onInvoke: () => void onRespondRuntime(runtime, false) },
      { id: "approve", label: "Approve", intent: "primary", disabled: submitting, pending: submitting, onInvoke: () => void onRespondRuntime(runtime, true) },
    ];
    if (item.interactionKind === "question" && runtime) return [{ id: "answer", label: "Answer in chat", intent: "primary", onInvoke: () => onOpenRuntime(runtime) }];
    if (runtime && floorRuntimeCanRecover(runtime.status)) return [{ id: "recover", label: "Recover", intent: "primary", onInvoke: () => onResumeRuntime(runtime) }];
    if (item.kind === "review" && card) return [{ id: "review", label: "Review evidence", intent: "primary", onInvoke: () => onReview(card) }];
    if (card) return [{ id: "inspect", label: "Inspect", intent: "primary", onInvoke: () => dockInspect(card.id) }];
    if (runtime) return [{ id: "open", label: "Open agent", intent: "primary", onInvoke: () => onOpenRuntime(runtime) }];
    return [];
  };
  const attentionHeading = (item: OpsFloorAttention, runtime?: PaneRuntime) => item.interactionKind === "approval"
    ? "Permission requested"
    : item.interactionKind === "question"
      ? "Response needed"
      : runtime && floorRuntimeCanRecover(runtime.status)
        ? "Agent stopped"
         : item.kind === "review"
           ? "Review ready"
           : "Intervention required";
  const renderFloorAction = (action: (typeof model.actionQueue)[number]) => {
    if (action.type === "attention") {
      const item = action.item;
      const runtime = item.runtimeId ? runtimeById.get(item.runtimeId) : undefined;
      const interaction = runtime ? pendingAgentInteraction(runtime.messages) : undefined;
      const agentLabel = item.runtimeId ? agentName(item.runtimeId) : undefined;
      const age = formatOpsRelative(item.waitingSince, now);
      const actions = floorAttentionActions(item);
      return <article className="wj-floor-intervention" data-kind={item.kind} data-card-id={item.cardId} data-run-graph-selected={Boolean(item.cardId && selectedTaskIds.has(item.cardId)) || undefined} key={action.id}>
        <div className="wj-floor-intervention-copy">
          <small>{attentionHeading(item, runtime)}</small>
          <strong>{item.title}</strong>
          <p title={interaction?.text || item.reason}>{humanizeFloorAttentionDetail(interaction?.text || item.reason)}</p>
          <div>{agentLabel && <span>{agentLabel}</span>}{item.downstreamBlocked > 0 && <span>{item.downstreamBlocked} downstream blocked</span>}{age && <span>{age}</span>}</div>
        </div>
        <div className="wj-floor-intervention-actions">{actions.map((action) => <Button
          key={action.id}
          size="xs"
          variant={action.intent === "primary" ? "default" : action.intent === "destructive" ? "destructive" : "outline"}
          disabled={action.disabled}
          onClick={action.onInvoke}
        >{action.pending ? `${action.label}…` : action.label}</Button>)}</div>
      </article>;
    }
    const conflict = action.contention;
    return <article className="wj-floor-action-row wj-floor-action-contention" tabIndex={-1} key={action.id} data-conflict-file={conflict.file} data-kind="contention" data-run-graph-selected={runGraphSelection?.kind === "conflict" && runGraphSelection.conflictFile === conflict.file || undefined}>
      <div className="wj-floor-action-copy"><small>Automatic ownership resolution stalled</small><strong>{conflict.cardIds.length} tasks still claim this file</strong><code>{conflict.file}</code></div>
      <div className="wj-floor-action-tasks">{conflict.cardIds.map((cardId) => { const card = cardById.get(cardId); const participants = card ? [...card.assigneeIds, ...(card.reviewerId ? [card.reviewerId] : [])].map(agentName).join(" / ") : ""; return card ? <button type="button" key={cardId} onClick={() => dockInspect(cardId)}><span>{card.title}</span>{participants && <small>{participants}</small>}</button> : null; })}</div>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="xs">Choose owner<ChevronDownIcon /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{conflict.cardIds.map((cardId) => <DropdownMenuItem key={cardId} onSelect={() => arbitrate(conflict, cardId)}>Keep {cardById.get(cardId)?.title ?? cardId}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    </article>;
  };
  const dockedInspector = dockedCard ? <section className="wj-floor-panel wj-floor-docked-inspector" data-card-id={dockedCard.id} aria-labelledby="floor-inspector-heading">
    <header><div><span className="wj-section-label">Task evidence</span><h2 id="floor-inspector-heading" tabIndex={-1}>Inspector</h2></div><Button aria-label="Close task inspector" variant="ghost" size="icon-xs" onClick={closeInspector}><X /></Button></header>
    <div className="wj-floor-inspector-scroll">
      <section className="wj-floor-inspector-summary"><div><RunStateBadge status={opsCardDisplayStatus(dockedLane ?? "ready", dockedRuntime ? [dockedRuntime.status] : [], dockedCard.verificationRun?.status, dockedCard.paused)} variant="compact" /><small>{dockedCard.priority} priority</small></div><h3>{dockedCard.title}</h3><p>{dockedCard.detail || "No objective was recorded."}</p></section>
      <section>
        <div className="wj-floor-inspector-label"><span>Execution</span>{formatOpsElapsed(dockedCard.startedAt, dockedCard.completedAt ?? dockedCard.pausedAt, now) && <time>{formatOpsElapsed(dockedCard.startedAt, dockedCard.completedAt ?? dockedCard.pausedAt, now)}</time>}</div>
        <dl className="wj-floor-inspector-facts"><div><dt>Owner</dt><dd>{dockedParticipants.map(agentName).join(", ") || "Unassigned"}</dd></div><div><dt>Current action</dt><dd>{visibleRunStateDetail(dockedRuntime?.status, dockedRuntime?.statusSummary) || dockedCard.lastNote || "No recorded action"}</dd></div><div><dt>Progress</dt><dd>{dockedCurrentStep?.label ?? (dockedCard.runProgress ? "No active step" : "Not reported")}</dd></div></dl>
      </section>
      <section><div className="wj-floor-inspector-label"><span>Workspace</span></div><p className="wj-floor-inspector-code">{taskWorkspaceLabel(dockedCard, projectIsRepo)}</p>{dockedCard.taskLane && <><code>{dockedCard.taskLane.branch}</code><code>{dockedCard.taskLane.cwd}</code></>}</section>
      {dockedAttention && <section><div className="wj-floor-inspector-label"><span>Intervention evidence</span><RunStateBadge status={dockedAttention.kind} variant="compact" /></div><p>{dockedAttention.reason}</p></section>}
      <section><div className="wj-floor-inspector-label"><span>Evidence and reconciliation</span><strong>{dockedVerification?.passed}/{dockedVerification?.total}</strong></div><div className="wj-floor-inspector-checks">{dockedVerification?.checks.map((check) => <span data-passed={check.passed || undefined} key={check.label}><CheckIcon />{check.label}</span>)}</div>{dockedCard.report?.evidence && <p>{dockedCard.report.evidence}</p>}{dockedCard.reconciliation?.message && <small>{dockedCard.reconciliation.message}</small>}{dockedConflictFiles.length > 0 && <p className="wj-floor-inspector-warning"><CircleDot />{dockedConflictFiles.length} file {dockedConflictFiles.length === 1 ? "contention" : "contentions"}</p>}</section>
      {(dockedCard.dependencyIds?.length || dockedCard.expectedFiles.length) ? <section><div className="wj-floor-inspector-label"><span>Working set</span></div>{Boolean(dockedCard.dependencyIds?.length) && <div className="wj-floor-inspector-list"><strong>Relationships</strong>{dockedCard.dependencyIds?.map((id) => <span key={id}>{cardById.get(id)?.title ?? id} · {dockedCard.dependencyKinds?.[id] === "hard" ? "Hard" : "Soft"}</span>)}</div>}{dockedCard.expectedFiles.length > 0 && <div className="wj-floor-inspector-list"><strong>Claimed files</strong>{dockedCard.expectedFiles.map((file) => <code key={file}>{file}</code>)}</div>}</section> : null}
      {dockedCard.steeringDirective && <section><div className="wj-floor-inspector-label"><span>Latest directive</span><RunStateBadge status={dockedCard.steeringDirective.status} variant="compact" /></div><p>{dockedCard.steeringDirective.text}</p>{dockedCard.steeringDirective.error && <small>{dockedCard.steeringDirective.error}</small>}</section>}
      <section><div className="wj-floor-inspector-label"><span>Task timeline</span><strong>{dockedTimeline.length}</strong></div><ol className="wj-floor-inspector-events">{dockedTimeline.map((item) => <li data-kind={item.kind} key={item.id}><span /><div><strong>{item.message}</strong><small>{item.actor ? `${agentName(item.actor)} · ` : ""}{formatTime(item.timestamp)}</small></div></li>)}</ol>{!dockedTimeline.length && <p className="wj-floor-empty">No task activity yet.</p>}</section>
    </div>
    <footer className="wj-floor-inspector-actions">{dockedRuntime && <Button size="xs" onClick={() => onOpenRuntime(dockedRuntime)}><Terminal />Open agent</Button>}{dockedRole === "review" && dockedCard.reviewPolicy === "human" && <Button size="xs" onClick={() => onReview(dockedCard)}><Search />Review evidence</Button>}{dockedRole === "queued" && !dockedCard.assigneeIds.length && <Button size="xs" onClick={() => void onStartAgent(dockedCard)}><Play />Start now</Button>}<Button variant="outline" size="xs" onClick={() => onInspect(dockedCard.id)}>Full details</Button></footer>
  </section> : undefined;
  const concurrencyOptions = Array.from({ length: Math.max(1, Math.min(8, maxAutonomousConcurrency)) }, (_, index) => index + 1);
  const runGraphSummary = runGraphModel.emptyWindow
    ? `No recorded events in the ${runGraphModel.range} window`
    : `${runGraphModel.nodes.length} recorded events · ${runGraphModel.currentSignals.length} current signals · ${runGraphModel.range}`;
  return <div className="wj-floor min-h-0 flex-1" ref={floorRef}>
    <span className="sr-only" role="status" aria-live="polite">{model.workingAgents} agents working. {model.actionQueue.length} interventions need attention. {unreadCount} unread project events.</span>
    <section className="wj-floor-operator" aria-label="Operator status and autonomy controls">
      <div className="wj-floor-operator-state" data-attention={model.actionQueue.length > 0 || undefined}><span className="wj-section-label">Operator status</span><strong>{model.actionQueue.length ? "Attention required" : "Monitoring normally"}</strong><small className="wj-floor-scheduler-intent" title={`${schedulerIntent.label}: ${schedulerIntent.detail}`}><b>{schedulerIntent.label}</b><span>{schedulerIntent.detail}</span></small></div>
      <dl className="wj-floor-metrics">
        <div><dt>Connected</dt><dd>{model.connectedAgents}</dd></div>
        <div><dt>Working</dt><dd>{model.workingAgents}</dd></div>
        <div data-attention={model.actionQueue.length > 0 || undefined}><dt>Interventions</dt><dd>{model.actionQueue.length}</dd></div>
        <div><dt>Planned</dt><dd>{model.ready.length}</dd></div>
      </dl>
      <div className="wj-floor-scheduler-controls"><label><span>Autonomy</span><Switch aria-label="Autonomous pickup" checked={autonomousPickup} onCheckedChange={onAutonomousPickupChange} /></label><label><span>New starts</span><Select value={String(autonomousConcurrency)} onValueChange={(value) => onAutonomousConcurrencyChange(Number(value))}><SelectTrigger aria-label="Automatic new-start limit"><SelectValue /></SelectTrigger><SelectContent>{concurrencyOptions.map((limit) => <SelectItem value={String(limit)} key={limit}>{limit} at a time</SelectItem>)}</SelectContent></Select></label><Button variant="ghost" size="sm" onClick={onOpenAgentSettings}><Settings />Policy</Button></div>
    </section>
    {liveNowItems.length > 0 && <section className="wj-floor-now">
      <header><h2>Now</h2></header>
      <div className="wj-floor-now-list">{liveNowItems.map(([card, agentId]) => {
        const runtime = agentId ? runtimeById.get(agentId) : undefined;
        const presence = opsCardPresence(card, runtime ? [runtime] : []);
        const detail = card.reconciliation?.message || opsCardActivitySummary(card, runtime ? [runtime] : [], 0);
        return <button data-presence-phase={presence} key={agentId || card.id} onClick={() => dockInspect(card.id)}>
          {agentId
            ? <AgentAvatar id={agentId} label={agentName(agentId)} status={runtime?.status} />
            : <GitBranch className="wj-floor-now-reconciler" aria-hidden="true" />}
          <span><strong>{card.title}</strong><small>{detail}</small></span>
        </button>})}</div>
    </section>}
    <div className="wj-floor-run-graph" data-collapsed={!runGraphExpanded || undefined}>
      {runGraphExpanded
        ? <OpsRunGraph embedded summary={runGraphSummary} model={runGraphModel} cards={state.cards} agentNodes={nodes} agentLabels={state.agentLabels} selection={runGraphSelection} onRangeChange={onRunGraphRange} onSelectionChange={selectRunGraphEvidence} onCollapse={() => setRunGraphExpanded(false)} />
        : <button type="button" className="wj-floor-run-graph-summary" aria-expanded="false" onClick={() => setRunGraphExpanded(true)}><span className="wj-section-label">Recorded execution</span><strong>Run Graph</strong><small>{runGraphSummary}</small><span>Show graph</span></button>}
    </div>
    <div className="wj-floor-layout" data-inspecting={Boolean(dockedInspector) || undefined} style={{ "--wj-floor-rail-width": `${railWidth}px` } as React.CSSProperties}>
      <div className="wj-floor-main">
        <section className="wj-floor-panel wj-floor-live" aria-labelledby="floor-agents-heading"><header><div><span className="wj-section-label">Live work</span><h2 id="floor-agents-heading">Agents</h2></div></header>
          {model.agents.length ? <div className="wj-floor-agent-matrix" role="region" aria-label="Agent work matrix" tabIndex={0}>{model.agents.map(renderAgentRow)}</div> : <div className="wj-floor-agent-empty"><AI /><strong>No agents connected</strong><span>{model.nextAutonomousTask ? `${model.nextAutonomousTask.card.title} is ready when an agent becomes available.` : "The roster will populate when an agent joins this workspace."}</span><Button variant="outline" size="xs" onClick={onOpenAgentSettings}><Settings />Agent policy</Button></div>}
        </section>
        <section className="wj-floor-panel wj-floor-activity" aria-labelledby="floor-activity-heading">
          <header><div><span className="wj-section-label">Project record</span><h2 id="floor-activity-heading">Recent activity</h2></div><div className="wj-floor-activity-header">{unreadCount > 0 && <Badge variant="outline">{unreadCount} unread</Badge>}<Button variant="ghost" size="sm" onClick={onOpenHistory}>View history</Button></div></header>
          <div className="wj-floor-activity-scroll" role="region" aria-label="Recent project activity" tabIndex={0}>
            {recentEvents.length ? recentEvents.map((event) => <article data-unread={!event.isRead || undefined} key={event.id}>
              <button type="button" onClick={() => onOpenActivity(event)}><span className="wj-floor-activity-status"><RunStateBadge status={event.status} variant="indicator" /></span><span><strong>{event.nodeTitle || event.kind}</strong><small>{event.message}</small></span><time>{formatOpsRelative(event.createdAt, now) ?? formatTime(event.createdAt)}</time></button>
              {!event.isRead && <Button aria-label="Mark event read" variant="ghost" size="icon-sm" onClick={() => onAcknowledgeActivity(event)}><CheckIcon /></Button>}
            </article>) : <p className="wj-floor-empty">No project activity yet.</p>}
          </div>
        </section>
      </div>
      <div
        className="wj-floor-resizer"
        role="separator"
        tabIndex={0}
        aria-label="Resize Run side rail"
        aria-orientation="vertical"
        aria-valuemin={FLOOR_RAIL_MIN_WIDTH}
        aria-valuemax={FLOOR_RAIL_MAX_WIDTH}
        aria-valuenow={railWidth}
        title="Drag to resize. Double-click to reset."
        onDoubleClick={() => onRailWidth(FLOOR_RAIL_DEFAULT_WIDTH)}
        onPointerDown={(event) => beginHorizontalResize(event, railWidth, FLOOR_RAIL_MIN_WIDTH, FLOOR_RAIL_MAX_WIDTH, -1, onRailWidth)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          onRailWidth(event.key === "Home"
            ? FLOOR_RAIL_MIN_WIDTH
            : event.key === "End"
              ? FLOOR_RAIL_MAX_WIDTH
              : normalizeFloorRailWidth(railWidth + (event.key === "ArrowLeft" ? 8 : -8)));
        }}
      />
      <aside className="wj-floor-rail" aria-label="Interventions and scheduler queue" data-inspecting={Boolean(dockedInspector) || undefined} data-needs-empty={model.actionQueue.length === 0 || undefined}>
        {dockedInspector ?? <>
          {model.actionQueue.length
            ? <section className="wj-floor-panel wj-floor-needs" aria-labelledby="floor-needs-heading"><header><div><span className="wj-section-label">Intervention queue</span><h2 id="floor-needs-heading">Exceptions</h2></div><Badge variant="destructive">{model.actionQueue.length}</Badge></header><div className="wj-floor-action-list" role="region" aria-label="Intervention queue" tabIndex={0}>{model.actionQueue.map(renderFloorAction)}</div></section>
            : <section className="wj-floor-panel wj-floor-needs wj-floor-clear-strip" aria-labelledby="floor-needs-heading"><CheckIcon /><div><span className="wj-section-label">Interventions</span><h2 id="floor-needs-heading">No intervention required</h2></div><Badge variant="outline">0</Badge></section>}
          <section className="wj-floor-panel wj-floor-ready" aria-labelledby="floor-ready-heading"><header><div><span className="wj-section-label">Scheduler order</span><h2 id="floor-ready-heading">Ready next</h2></div><Badge variant="outline">{model.ready.length}</Badge></header>
            {model.ready.length ? <div className="wj-floor-queue-list" role="region" aria-label="Ready tasks" tabIndex={0}>{model.ready.map(renderReadyTask)}</div> : <p className="wj-floor-empty">No eligible tasks are queued.</p>}
          </section>
        </>}
      </aside>
    </div>
    <AlertDialog open={Boolean(stopRuntime)} onOpenChange={(open) => { if (!open) setStopRuntime(undefined); }}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader><AlertDialogTitle>Stop {stopRuntime ? agentName(stopRuntime.nodeId) : "agent"}?</AlertDialogTitle><AlertDialogDescription>The current turn will be canceled. Task history and recorded progress remain available.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Keep running</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (stopRuntime) void onCancelRuntime(stopRuntime); setStopRuntime(undefined); }}>Stop agent</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function DocumentSurface({ kind, value, onChange, onGenerate, onGenerateWithAgent, onCreateTasks, exists, onCreate, onMigrate, boardWritable, saveStatus }: { kind: "prd" | "tdd"; value: string; onChange: (value: string) => void; onGenerate: () => void; onGenerateWithAgent: () => void; onCreateTasks: () => void; exists: boolean; onCreate: () => void; onMigrate: () => void; boardWritable: boolean; saveStatus: "idle" | "saving" | "saved" | "conflict" | "error" }) {
  const prd = kind === "prd";
  const saveLabel = !exists || saveStatus === "idle" ? "" : saveStatus[0].toUpperCase() + saveStatus.slice(1);
  return (
    <div className="wj-document-surface min-h-0 flex-1"><div className="wj-document-page" data-save-state={saveStatus}>
      <section className="wj-page-heading wj-document-heading"><div><div className="wj-document-state"><span className={`wj-file-state ${exists ? "saved" : ""}`}>{exists ? `${kind.toUpperCase()}.md` : "Not created"}</span>{saveLabel && <span className="wj-document-save-status wj-inline-status" role="status" aria-live="polite">{saveStatus === "saving" && <DotMatrixLoader size={12} />}{saveStatus === "saved" && <DotMatrixLoader variant="verify" size={12} />}{saveLabel}</span>}</div><h1>{prd ? "Product requirements" : "Technical design"}</h1><p>{prd ? "Define the outcome, workflow, constraints, and acceptance criteria." : "Define architecture, contracts, risks, rollout, and required validation."}</p></div><div className="wj-document-actions">{!exists && value && <Button variant="outline" onClick={onMigrate}>Migrate legacy</Button>}<Button variant="ghost" onClick={onGenerateWithAgent}>Generate with agent</Button><Button variant="secondary" onClick={exists ? onGenerate : onCreate}>{exists ? "Use template" : `Create ${kind.toUpperCase()}.md`}</Button><Button disabled={!exists || !boardWritable} onClick={onCreateTasks}>Add starter tasks</Button></div></section>
      {exists
        ? <Textarea aria-label={`${kind.toUpperCase()} document editor`} className="wj-document-editor min-h-0 flex-1 resize-none font-mono leading-6" value={value} onChange={(event) => onChange(event.target.value)} placeholder={prd ? "# Product requirements" : "# Technical design"} />
        : <Empty title={`No ${kind.toUpperCase()} yet`} detail={`Create ${kind.toUpperCase()}.md in the project root, or ask an agent to draft it from the current workspace.`} action={<Button onClick={onCreate}>Create document</Button>} />}
    </div></div>
  );
}
