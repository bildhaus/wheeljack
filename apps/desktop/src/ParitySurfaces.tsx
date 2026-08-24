import {
  Activity,
  AI,
  Article,
  Bell,
  Book,
  Briefcase,
  Building,
  CheckIcon,
  Checklist,
  ChevronDownIcon,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleDot,
  Columns2,
  Cloud,
  FileCode2,
  Files,
  Flag,
  Folder,
  GitBranch,
  GitHub,
  Globe,
  History,
  Home,
  Inbox,
  Inventory,
  Key,
  Layers,
  LayoutDashboard,
  LibraryBooks,
  Lightning,
  Link,
  Map as MapIcon,
  Maximize2,
  Memory,
  Minus,
  MonitorCog,
  Monitor,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Spark,
  Settings,
  Star,
  Swatch,
  Target,
  Terminal,
  Trash2,
  X,
} from "./SargamIcon";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import Markdown from "react-markdown";
import { Badge } from "./components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Checkbox } from "./components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { ScrollArea } from "./components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "./components/ui/sheet";
import { Slider } from "./components/ui/slider";
import { Switch } from "./components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Textarea } from "./components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import { ColorPickerPopover } from "./ColorPickerPopover";
import { ActionCard, type ActionCardAction } from "./ActionCard";
import { AgentAvatar } from "./AgentAvatar";
import { RunStateBadge } from "./RunStateBadge";
import { resolveAgentLabel } from "./agentIdentity";
import { resolveRunState, visibleRunStateDetail } from "./runState";
import { OpsRunGraph } from "./RunGraphSurface";
import { ProviderMark } from "./ProviderMark";
import { DotMatrixLoader } from "./DotMatrixLoader";
import {
  opsActiveFileConflicts,
  opsAgentsCoordinating,
  opsAttentionReason,
  opsCardActivitySummary,
  opsCardParticipantIds,
  opsCanCompleteWithOverride,
  opsChildProgress,
  opsDecompositionHasCycle,
  opsCurrentCardForAgent,
  opsDependencyPath,
  opsExecutionLane,
  opsReviewLabel,
  opsReviewVerdict,
  opsVerificationContractIssues,
  opsVerificationProgress,
  opsVerificationApproval,
  opsVerificationStaleReason,
  opsWaitingRelationships,
  opsWouldCreateDependencyCycle,
} from "./opsPresence";
import { deriveOpsFloorModel, floorRuntimeCanRecover, type OpsFloorAttention, type OpsFloorContention, type OpsFloorTask } from "./opsFloor";
import { deriveOpsRunGraphModel, type OpsRunGraphRange, type OpsRunGraphSelection } from "./opsRunGraph";
import { opsTaskTimeline } from "./opsTimeline";
import { adapterReadinessLabel, canVerifyAdapter } from "./adapterReadiness";
import { isLiveSessionStatus, isTerminalSessionStatus } from "./agentRuntime";
import { needsAttention, pendingAgentInteraction, type AttentionItem } from "./attention";
import { builtInThemes, compileTheme, contrastRatio, replaceThemeAssignments, serializeTheme, themeAssignment, type ThemeDefinition } from "./theme";

type OpsTaskEditablePatch = Partial<Pick<OpsCard, "title" | "detail" | "definitionOfDone" | "constraints" | "verificationCommand" | "reviewPolicy">>;
const OpsArchiveDialogs = lazy(() => import("./OpsArchiveDialogs"));
const TaskWorktreeList = lazy(() => import("./TaskWorktreeList"));
import { activeVsCodeThemeName, parseImportedThemeDocument, type ThemeImportResult } from "./themeImport";
import { discoverVsCodeThemes, readThemeDocument, writeThemeDocument, type VsCodeThemeSource } from "./core";
import type { UpdateController } from "./updater";
import {
  formatUpdateDate,
  UpdateProgressView,
  updateAttentionLabel,
  updateStatusLabel,
} from "./UpdaterPresentation";
import {
  bindingFromKeyboardEvent,
  defaultShortcutBindings,
  formatShortcut,
  isBindableShortcut,
  shortcutConflict,
  shortcutDefinitions,
  type ShortcutAction,
  type ShortcutBindings,
} from "./shortcuts";
import { agentEffortOptions } from "./types";
import type {
  ActivityEvent,
  Adapter,
  AgentAccessMode,
  AgentAutonomyPolicy,
  AgentControlAudit,
  AgentProfile,
  CanvasNode,
  BotProfile,
  BotSnapshot,
  GitDiff,
  GitStatus,
  OpsCard,
  OpsDecompositionProposal,
  OpsDecompositionTaskDraft,
  OpsOrchestrationAction,
  OpsReviewEvidence,
  OpsState,
  OpsSteeringDirective,
  OpsTaskContractDraft,
  ProjectDocuments,
  PaneRuntime,
  Project,
  RoutePreview,
  Session,
  SessionSearchResult,
  UiPreferences,
  UtilityPanelTab,
} from "./types";

export type ShellSurface = "home" | "bots" | "usage" | "terminal" | "ops" | "settings";
type ProjectSurface = Extract<ShellSurface, "terminal" | "ops">;
export type OpsPage = "floor" | "board" | "spec";
export type SettingsPage = "appearance" | "workspace" | "shortcuts" | "agents" | "application";

function DevToolsContextItem() {
  if (!import.meta.env.DEV) return null;
  return <><ContextMenuSeparator /><ContextMenuItem onSelect={() => void invoke("open_devtools").catch((cause) => console.error("Could not open DevTools.", cause))}><MonitorCog />Open DevTools</ContextMenuItem></>;
}

const settingsPageDetails: Record<SettingsPage, { title: string; description: string }> = {
  appearance: { title: "Appearance", description: "Choose themes, typography, and terminal colors." },
  workspace: { title: "Workspace", description: "Control visible workspace elements and layout density." },
  shortcuts: { title: "Shortcuts", description: "Customize app commands without stealing ordinary terminal input." },
  agents: { title: "Agents", description: "Configure installed coding agents and their launch defaults." },
  application: { title: "Application", description: "Inspect this build, local storage, and preference recovery." },
};

const reviewPolicyLabels = {
  agent: "Automatic reconciliation",
  human: "Require human acceptance",
  either: "Automatic or human",
} as const;

function ReviewPolicyOptions() {
  return <>{Object.entries(reviewPolicyLabels).map(([value, label]) => <SelectItem value={value} key={value}>{label}</SelectItem>)}</>;
}

const uiFontPresets = ["Geist Variable", "Open Sans Variable", "Inter Variable", "system-ui", "Segoe UI Variable Text", "Segoe UI", "SF Pro Text", "Helvetica Neue", "Arial"];
const headingFontPresets = ["Geist Pixel", ...uiFontPresets];
const codeFontPresets = ["JetBrains Mono Variable", "Cascadia Mono", "monospace", "Cascadia Code", "JetBrains Mono", "Fira Code", "Iosevka", "SFMono-Regular", "Menlo", "Consolas"];

interface PendingOpsAction {
  card: OpsCard;
  action: OpsOrchestrationAction;
  targetColumnId?: string;
  agentId?: string;
  preview?: RoutePreview;
  busy?: boolean;
  error?: string;
}

function formatOpsElapsed(startedAt: string | undefined, stoppedAt: string | undefined, now: number): string | undefined {
  if (!startedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = stoppedAt ? Date.parse(stoppedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function formatOpsRelative(value: string | undefined, now: number): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export function humanizeFloorAttentionDetail(value: string): string {
  const detail = value.trim();
  if (!detail.startsWith("[")) return detail;
  try {
    const paths = JSON.parse(detail);
    if (!Array.isArray(paths) || !paths.length || paths.some((path) => typeof path !== "string")) return detail;
    const compact = paths.slice(0, 2).map((path) => {
      const parts = path.split(/[\\/]/).filter(Boolean);
      const suffix = parts.slice(-2).join("\\");
      return parts.length > 2 ? `…\\${suffix}` : path;
    });
    return `Access to ${paths.length} ${paths.length === 1 ? "path" : "paths"} · ${compact.join(", ")}${paths.length > compact.length ? ` +${paths.length - compact.length}` : ""}`;
  } catch {
    return detail;
  }
}

export function opsCanReturnDirectlyToReady(card: OpsCard, runtimes: PaneRuntime[]): boolean {
  return !opsCardParticipantIds(card, runtimes).some((id) => {
    const runtime = runtimes.find((candidate) => candidate.nodeId === id);
    return Boolean(runtime && !isTerminalSessionStatus(runtime.status));
  });
}

function opsActionTitle(action: OpsOrchestrationAction, _card: OpsCard): string {
  if (action === "assign") return "Start task agent";
  if (action === "transfer") return "Transfer ownership";
  if (action === "resume") return "Resume work";
  if (action === "review") return "Inspect evidence";
  if (action === "pause") return "Request pause";
  if (action === "release") return "Return to Ready";
  if (action === "approve") return "Approve verification";
  return "Complete with override";
}

function taskWorkspaceLabel(card: OpsCard, projectIsRepo?: boolean): string {
  if (card.taskLane?.closedAt) return "Lane removed";
  if (card.taskLane) return "Task worktree";
  if (!card.assigneeIds.length) return "No workspace yet";
  return projectIsRepo === false ? "Shared checkout (non-Git project)" : "Shared checkout";
}

const windowIconButton = "h-9 w-11 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground";

const projectIconOptions = [
  { value: "folder", label: "Folder", Icon: Folder },
  { value: "code", label: "Code", Icon: FileCode2 },
  { value: "terminal", label: "Terminal", Icon: Terminal },
  { value: "book", label: "Book", Icon: Book },
  { value: "briefcase", label: "Briefcase", Icon: Briefcase },
  { value: "cloud", label: "Cloud", Icon: Cloud },
  { value: "server", label: "Server", Icon: Server },
  { value: "grid", label: "Grid", Icon: LayoutDashboard },
  { value: "ai", label: "AI", Icon: AI },
  { value: "building", label: "Building", Icon: Building },
  { value: "globe", label: "Globe", Icon: Globe },
  { value: "layers", label: "Layers", Icon: Layers },
  { value: "library", label: "Library", Icon: LibraryBooks },
  { value: "map", label: "Map", Icon: MapIcon },
  { value: "memory", label: "Memory", Icon: Memory },
  { value: "monitor", label: "Monitor", Icon: Monitor },
  { value: "flag", label: "Flag", Icon: Flag },
  { value: "inventory", label: "Inventory", Icon: Inventory },
  { value: "spark", label: "Spark", Icon: Spark },
  { value: "star", label: "Star", Icon: Star },
  { value: "activity", label: "Activity", Icon: Activity },
  { value: "article", label: "Article", Icon: Article },
  { value: "checklist", label: "Checklist", Icon: Checklist },
  { value: "key", label: "Key", Icon: Key },
  { value: "lightning", label: "Lightning", Icon: Lightning },
  { value: "link", label: "Link", Icon: Link },
  { value: "pin", label: "Pin", Icon: Pin },
  { value: "target", label: "Target", Icon: Target },
] as const;

function ProjectGlyph({ icon, color, className = "" }: { icon: string; color: string; className?: string }) {
  const Glyph = projectIconOptions.find((option) => option.value === icon)?.Icon ?? Folder;
  return <Glyph className={className} style={{ color }} />;
}

function opsCardDisplayStatus(lane: string, runtimeStatuses: string[], verificationStatus?: string, paused?: boolean): string {
  if (paused) return "paused";
  const attention = runtimeStatuses.find((status) => ["needs_input", "review", "blocked", "failed", "disconnected"].includes(status));
  if (attention) return attention;
  const active = runtimeStatuses.find((status) => ["starting", "running", "in_progress", "canceling"].includes(status));
  if (active) return active;
  if (lane === "attention") return "attention";
  if (lane === "verifying" || verificationStatus === "running") return "verifying";
  if (lane === "done") return "completed";
  if (lane === "running") return "in_progress";
  return "ready";
}

const projectEmptyExitEvent = "wheeljack:project-empty-exit";
const projectEmptyExitDuration = 90;

export function projectEmptyTypewriterDelays(title: string): number[] {
  let elapsed = 14;
  return Array.from(title, (character) => {
    const delay = elapsed;
    elapsed += character === " " ? 16 : 9;
    return delay;
  });
}

export function ProjectEmptyState({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children?: React.ReactNode }) {
  const characters = Array.from(title);
  const instantEntry = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.projectEmptyInstant === "true").current;
  const [typedCharacterCount, setTypedCharacterCount] = useState(0);
  const typedCharacterCountRef = useRef(0);
  const typewriterTimersRef = useRef<number[]>([]);
  const typewriterDelays = projectEmptyTypewriterDelays(title);
  const titleFinish = (typewriterDelays.at(-1) ?? 0) + 16;
  const detailDelay = typewriterDelays[Math.max(0, Math.ceil(characters.length * .85) - 1)] ?? 0;
  useLayoutEffect(() => {
    if (instantEntry || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      typedCharacterCountRef.current = characters.length;
      setTypedCharacterCount(characters.length);
      return;
    }
    typedCharacterCountRef.current = 0;
    setTypedCharacterCount(0);
    typewriterTimersRef.current = typewriterDelays.map((delay, index) => window.setTimeout(() => {
      typedCharacterCountRef.current = index + 1;
      setTypedCharacterCount(index + 1);
    }, delay));
    return () => typewriterTimersRef.current.forEach(window.clearTimeout);
  }, [title]);
  useEffect(() => {
    const exit = () => {
      typewriterTimersRef.current.forEach(window.clearTimeout);
      const characterCount = typedCharacterCountRef.current;
      typewriterTimersRef.current = Array.from({ length: characterCount }, (_, index) => window.setTimeout(() => {
        const nextCount = characterCount - index - 1;
        typedCharacterCountRef.current = nextCount;
        setTypedCharacterCount(nextCount);
      }, (index + 1) * 75 / characterCount));
    };
    window.addEventListener(projectEmptyExitEvent, exit);
    return () => {
      window.removeEventListener(projectEmptyExitEvent, exit);
      typewriterTimersRef.current.forEach(window.clearTimeout);
    };
  }, []);
  return (
    <div className="wj-project-empty" data-instant={instantEntry || undefined} style={{ "--wj-empty-title-finish": `${titleFinish}ms`, "--wj-empty-detail-delay": `${detailDelay}ms`, "--wj-empty-actions-delay": `${titleFinish + 30}ms` } as React.CSSProperties}>
      <span className="wj-project-empty-icon">{icon}</span>
      <h2 aria-label={title}><span aria-hidden="true" className="wj-empty-type-reserve">{title}</span><span aria-hidden="true" className="wj-empty-type-text">{characters.slice(0, typedCharacterCount).join("")}<span className="wj-empty-type-caret" /></span></h2>
      <p>{description}</p>
      {children && <div className="wj-empty-actions">{children}</div>}
    </div>
  );
}

export function ProjectModeSwitch({ surface, onSurface, page, onPage }: { surface: ProjectSurface; onSurface: (surface: ProjectSurface) => void; page?: OpsPage; onPage?: (page: OpsPage) => void }) {
  const navigationTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current);
    delete document.documentElement.dataset.projectEmptyExiting;
    delete document.documentElement.dataset.projectEmptyInstant;
  }, []);
  const navigate = (nextSurface: ProjectSurface, animate: boolean) => {
    if (nextSurface === surface || navigationTimerRef.current) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animate && nextSurface === "terminal" && surface === "ops" && !reducedMotion) {
      document.documentElement.dataset.planCollapsing = "true";
      window.setTimeout(() => delete document.documentElement.dataset.planCollapsing, 180);
    }
    if (!animate || reducedMotion) {
      if (!animate) document.documentElement.dataset.projectEmptyInstant = "true";
      onSurface(nextSurface);
      if (!animate) window.requestAnimationFrame(() => delete document.documentElement.dataset.projectEmptyInstant);
      return;
    }
    if (!document.querySelector(".wj-project-empty")) {
      onSurface(nextSurface);
      return;
    }
    document.documentElement.dataset.projectEmptyExiting = "true";
    window.dispatchEvent(new Event(projectEmptyExitEvent));
    navigationTimerRef.current = window.setTimeout(() => {
      navigationTimerRef.current = undefined;
      delete document.documentElement.dataset.projectEmptyExiting;
      onSurface(nextSurface);
    }, projectEmptyExitDuration);
  };
  return (
    <div className="wj-project-mode-dock">
      <div className="wj-project-mode" role="group" aria-label="Project mode">
        <Button className="wj-mode-trigger" variant="ghost" size="sm" data-active={surface === "terminal" || undefined} aria-pressed={surface === "terminal"} onClick={(event) => navigate("terminal", event.detail > 0)}><Terminal /><span className="wj-mode-label">Work</span></Button>
        <div className="wj-project-plan-slot" data-expanded={surface === "ops" || undefined}>
          {surface === "ops" && page && onPage
            ? <Tabs className="wj-project-plan-sections" value={page} onValueChange={(value) => onPage(value as OpsPage)}><TabsList aria-label="Project views" data-page={page}><TabsTrigger value="floor"><span className="wj-mode-label">Run</span></TabsTrigger><TabsTrigger value="board"><span className="wj-mode-label">Plan</span></TabsTrigger><TabsTrigger value="spec"><span className="wj-mode-label">Spec</span></TabsTrigger></TabsList></Tabs>
            : <Button className="wj-mode-trigger wj-plan-mode-trigger" variant="ghost" size="sm" aria-pressed={false} onClick={(event) => navigate("ops", event.detail > 0)}><LayoutDashboard /><span className="wj-mode-label">Plan</span></Button>}
        </div>
      </div>
    </div>
  );
}

export function TitleBar({
  onboarding,
  surface,
  project,
  settingsPage,
  inboxCount,
  utilityPanelOpen,
  utilityPanelTab,
  opsPage,
  onSurface,
  onOpsPage,
  onUtilityPanel,
  updater,
  onUpdate,
}: {
  onboarding: boolean;
  surface: ShellSurface;
  project?: Project;
  settingsPage: SettingsPage;
  inboxCount: number;
  utilityPanelOpen: boolean;
  utilityPanelTab: UtilityPanelTab;
  opsPage: OpsPage;
  onSurface: (surface: ProjectSurface) => void;
  onOpsPage: (page: OpsPage) => void;
  onUtilityPanel: (tab: UtilityPanelTab) => void;
  updater: UpdateController;
  onUpdate: () => void;
}) {
  const title =
    surface === "home"
      ? "Home"
      : surface === "bots"
        ? "Bots"
      : surface === "usage"
        ? "API Usage"
      : surface === "settings"
        ? `Settings  /  ${settingsPageDetails[settingsPage].title}`
        : project?.name ?? "wheeljack";
  const updateActionVisible = ["available", "downloading", "ready", "installing"].includes(updater.status);
  const updateLabel = updater.status === "ready"
    ? `Restart to install wheeljack ${updater.update?.version ?? "update"}`
    : updater.status === "available"
      ? `wheeljack ${updater.update?.version ?? "update"} is available`
      : updater.status === "installing"
        ? "Installing wheeljack update"
        : "Downloading wheeljack update";
  const projectSurface = surface === "terminal" || surface === "ops" ? surface : undefined;
  return (
    <header className="wj-titlebar" data-onboarding={onboarding || undefined}>
      <div className="wj-title-brand" data-tauri-drag-region>
        <img className="wj-brand-lockup" src="/wheeljack-lockup.svg" alt="wheeljack" draggable={false} />
        <img className="wj-brand-icon" src="/favicon.svg" alt="" draggable={false} />
      </div>
      <div className="wj-title-workspace">
        <div className="wj-title-context" data-tauri-drag-region>
          {!onboarding && project && projectSurface && <ProjectGlyph className="wj-title-project-icon" icon={project.icon} color={project.iconColor} />}
          {!onboarding && <span className="wj-title-name">{title}</span>}
          {!onboarding && project && projectSurface && project.branch !== "none" && <span className="wj-title-branch" aria-label={`Git branch ${project.branch}`} title={`Git branch: ${project.branch}`}>{project.githubRemote ? <GitHub /> : <GitBranch />}{project.branch}</span>}
        </div>
        {!onboarding && project && projectSurface && <nav className="wj-title-navigation" aria-label="Project navigation"><ProjectModeSwitch surface={projectSurface} onSurface={onSurface} page={opsPage} onPage={onOpsPage} /></nav>}
      </div>
      <div className="wj-title-actions">
        <div className="wj-title-utilities">
          {updateActionVisible && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={updateLabel}
                  data-updater-status={updater.status}
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-none border-0 text-primary"
                  disabled={updater.status === "downloading" || updater.status === "installing"}
                  onClick={onUpdate}
                >
                  {updater.status === "downloading" || updater.status === "installing"
                    ? <DotMatrixLoader size={18} />
                    : updater.status === "available"
                      ? <Cloud />
                      : <RefreshCw />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{updateLabel}</TooltipContent>
            </Tooltip>
          )}
          {!onboarding && <><TitleAction label="Inbox" ariaLabel={`Inbox, ${inboxCount} ${inboxCount === 1 ? "item" : "items"} need attention`} pressed={utilityPanelOpen && utilityPanelTab === "inbox"} onClick={() => onUtilityPanel("inbox")}>
            <span className="relative inline-flex items-center justify-center">
              <Bell />
              {inboxCount > 0 && <Badge className="wj-count-badge">{inboxCount}</Badge>}
            </span>
          </TitleAction>
          <TitleAction label="Git" pressed={utilityPanelOpen && utilityPanelTab === "git"} onClick={() => onUtilityPanel("git")}><GitBranch /></TitleAction>
          <TitleAction label="History" pressed={utilityPanelOpen && utilityPanelTab === "history"} onClick={() => onUtilityPanel("history")}><History /></TitleAction></>}
        </div>
        <div className="wj-window-actions">
          <Button aria-label="Minimize window" variant="ghost" className={windowIconButton} onClick={() => void getCurrentWindow().minimize()}><Minus /></Button>
          <Button aria-label="Maximize or restore window" variant="ghost" className={windowIconButton} onClick={() => void getCurrentWindow().toggleMaximize()}><Maximize2 className="size-3" /></Button>
          <Button aria-label="Close window" variant="ghost" className={`${windowIconButton} hover:bg-destructive hover:text-white`} onClick={() => void getCurrentWindow().close()}><X /></Button>
        </div>
      </div>
    </header>
  );
}

function TitleAction({ label, ariaLabel = label, pressed, onClick, children }: { label: string; ariaLabel?: string; pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={ariaLabel} aria-pressed={pressed} aria-controls="utility-panel" variant="ghost" size="icon" className="h-9 w-9 rounded-none border-0 bg-clip-border text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground" onClick={onClick}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ProjectIdentitySheet({ project, onOpenChange, onSave }: { project: Project; onOpenChange: (open: boolean) => void; onSave: (icon: string, iconColor: string, agentAccess: AgentAccessMode) => Promise<void> }) {
  const [icon, setIcon] = useState(project.icon);
  const [iconColor, setIconColor] = useState(project.iconColor);
  const [agentAccess, setAgentAccess] = useState(project.agentAccess);
  const [saving, setSaving] = useState(false);
  const saveIdentity = async () => {
    setSaving(true);
    try {
      await onSave(icon, iconColor, agentAccess);
      onOpenChange(false);
    } catch {
      // The app-level error banner reports persistence failures.
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet open onOpenChange={(open) => !saving && onOpenChange(open)}>
      <SheetContent className="wj-project-identity-sheet" side="right">
        <SheetHeader>
          <SheetTitle>{project.name} settings</SheetTitle>
          <SheetDescription>Configure this project's appearance and agent access.</SheetDescription>
        </SheetHeader>
        <div className="wj-project-identity-body">
          <div className="wj-project-identity-preview"><ProjectGlyph icon={icon} color={iconColor} /><strong>{project.name}</strong></div>
          <div>
            <Label>Icon</Label>
            <div className="wj-project-icon-picker" role="radiogroup" aria-label="Project icon">
              {projectIconOptions.map(({ value, label, Icon }) => <button key={value} type="button" role="radio" aria-checked={icon === value} aria-label={label} title={label} onClick={() => setIcon(value)}><Icon style={{ color: iconColor }} /></button>)}
            </div>
          </div>
          <ColorPickerPopover label="Project icon" value={iconColor} onChange={setIconColor} />
          <div>
            <Label htmlFor="project-agent-access">Agent access</Label>
            <Select value={agentAccess} onValueChange={(value) => setAgentAccess(value as AgentAccessMode)}>
              <SelectTrigger id="project-agent-access"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Agent default</SelectItem>
                <SelectItem value="full">Full access</SelectItem>
              </SelectContent>
            </Select>
            <small className="wj-project-setting-help">Full access lets new agent sessions use the internet and any local file without approval.</small>
          </div>
        </div>
        <SheetFooter className="flex-row justify-end">
          <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving} onClick={() => void saveIdentity()}>{saving ? "Saving…" : "Save"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ProjectMenuItems({
  context,
  project,
  disabled,
  onProject,
  onCustomize,
  onRelink,
  onRemove,
}: {
  context?: boolean;
  project: Project;
  disabled?: boolean;
  onProject: (project: Project, surface: ShellSurface) => void;
  onCustomize: (project: Project) => void;
  onRelink: (project: Project) => void;
  onRemove: (project: Project) => void;
}) {
  const Item = context ? ContextMenuItem : DropdownMenuItem;
  const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator;
  return (
    <>
      {project.pathExists === false
        ? <Item disabled={disabled} onSelect={() => onRelink(project)}><Folder />Relink folder…</Item>
        : <>
          <Item disabled={disabled} onSelect={() => onProject(project, "terminal")}><Terminal />Open Work</Item>
          <Item disabled={disabled} onSelect={() => onProject(project, "ops")}><LayoutDashboard />Open Plan</Item>
        </>}
      <Item disabled={disabled} onSelect={() => onCustomize(project)}><Swatch />Project settings…</Item>
      <Separator />
      <Item disabled={disabled} variant="destructive" onSelect={() => onRemove(project)}><Trash2 />Hide project…</Item>
      {context && <DevToolsContextItem />}
    </>
  );
}

export function ProjectSidebar({
  collapsed,
  width,
  projects,
  project,
  surface,
  sessions,
  loading,
  loadingProjectId,
  onCollapsed,
  onWidth,
  onSurface,
  onProject,
  onOpen,
  onCustomize,
  onRelink,
  onRemove,
}: {
  collapsed: boolean;
  width: number;
  projects: Project[];
  project?: Project;
  surface: ShellSurface;
  sessions: Session[];
  loading: boolean;
  loadingProjectId?: string;
  onCollapsed?: (collapsed: boolean) => void;
  onWidth: (width: number) => void;
  onSurface: (surface: ShellSurface) => void;
  onProject: (project: Project, surface: ShellSurface) => void;
  onOpen: () => void;
  onCustomize: (project: Project) => void;
  onRelink: (project: Project) => void;
  onRemove: (project: Project) => void;
}) {
  return (
    <aside className="wj-sidebar">
      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="Project navigation" className="wj-sidebar-nav">
          <SidebarButton collapsed={collapsed} active={surface === "home"} label="Home" icon={<Home />} onClick={() => onSurface("home")} />
          <SidebarButton collapsed={collapsed} active={surface === "bots"} label="Bots" icon={<Briefcase />} onClick={() => onSurface("bots")} />
          <SidebarButton collapsed={collapsed} active={surface === "usage"} label="Usage" icon={<Activity />} onClick={() => onSurface("usage")} />
          {collapsed
            ? <SidebarButton collapsed label={loading ? "Loading projects" : "Open folder"} icon={loading ? <DotMatrixLoader variant="boot" size={16} /> : <Plus />} disabled={loading} loading={loading} onClick={onOpen} />
            : (
              <div className="wj-section-label wj-sidebar-label">
                <span>Projects</span>
                {loading && !loadingProjectId
                  ? <DotMatrixLoader variant="boot" size={16} label="Loading projects" />
                  : <Tooltip>
                    <TooltipTrigger asChild><Button aria-label="Open folder" variant="ghost" size="icon-xs" disabled={loading} onClick={onOpen}><Plus /></Button></TooltipTrigger>
                    <TooltipContent>Open folder</TooltipContent>
                  </Tooltip>}
              </div>
            )}
          {projects.map((item) => {
            const live = sessions.filter((session) => session.cwd === item.path && isLiveSessionStatus(session.status)).length;
            const selected = item.id === project?.id;
            const active = selected && (surface === "terminal" || surface === "ops");
            const itemLoading = item.id === loadingProjectId;
            return (
              <ContextMenu key={item.id}>
                <ContextMenuTrigger asChild>
                  <div className={`wj-sidebar-project${active ? " selected" : ""}`} data-disabled={loading || undefined} data-loading={itemLoading || undefined}>
                    <SidebarButton
                      collapsed={collapsed}
                      active={active}
                      label={item.name}
                      icon={itemLoading ? <DotMatrixLoader size={14} /> : <ProjectGlyph icon={item.icon} color={item.iconColor} />}
                      badge={item.pathExists === false ? undefined : live || undefined}
                      detail={itemLoading ? "Loading…" : item.pathExists === false ? "Folder missing" : selected && item.branch !== "none" ? item.branch : undefined}
                      disabled={loading}
                      loading={itemLoading}
                      onClick={() => item.pathExists === false ? onRelink(item) : onProject(item, "terminal")}
                    />
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent><ProjectMenuItems context project={item} disabled={loading} onProject={onProject} onCustomize={onCustomize} onRelink={onRelink} onRemove={onRemove} /></ContextMenuContent>
              </ContextMenu>
            );
          })}
        </nav>
      </ScrollArea>
      <div className="wj-sidebar-footer">
        <div className="wj-sidebar-utilities">
          <SidebarButton collapsed={collapsed} active={surface === "settings"} label="Settings" icon={<Settings />} onClick={() => onSurface("settings")} />
          {onCollapsed && <SidebarButton collapsed={collapsed} label={collapsed ? "Expand" : "Collapse"} icon={collapsed ? <PanelLeftOpen /> : <PanelLeftClose />} onClick={() => onCollapsed(!collapsed)} />}
        </div>
      </div>
      {!collapsed && <div className="wj-sidebar-resizer" role="separator" tabIndex={0} aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={176} aria-valuemax={320} aria-valuenow={width} onPointerDown={(event) => beginHorizontalResize(event, width, 176, 320, 1, onWidth, onCollapsed)} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); if (event.key === "ArrowLeft" && width <= 176 && onCollapsed) onCollapsed(true); else onWidth(Math.min(320, Math.max(176, width + (event.key === "ArrowRight" ? 8 : -8)))); } }} />}
    </aside>
  );
}

function SidebarButton({
  collapsed,
  active,
  compact,
  label,
  detail,
  icon,
  badge,
  disabled,
  loading,
  onClick,
}: {
  collapsed: boolean;
  active?: boolean;
  compact?: boolean;
  label: string;
  detail?: string;
  icon: React.ReactNode;
  badge?: number;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  const button = (
    <button aria-label={label} aria-busy={loading || undefined} className={`wj-nav-item ${active ? "active" : ""} ${compact ? "compact" : ""}`} disabled={disabled} onClick={onClick} aria-current={active ? "page" : undefined}>
      <span className="wj-nav-icon">{icon}</span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 text-left">
            <strong>{label}</strong>
            {detail && <small>{detail}</small>}
          </span>
          {badge !== undefined && <Badge variant="secondary">{badge}</Badge>}
        </>
      )}
    </button>
  );
  if (!collapsed) return button;
  return <Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip>;
}

export function HomeSurface({
  projects,
  sessions,
  activity,
  attention,
  git,
  loading,
  loadingProjectId,
  onOpen,
  onProject,
  onCustomize,
  onRelink,
  onSession,
  onRemove,
  onActivity,
  onAttention,
  onResearch,
  onBootstrapPlan,
  onTerminal,
  onInbox,
  onGit,
  showRecentActivity,
  showAgentRail,
  showProjectPaths,
  agentReady,
  onAgentSettings,
  bots,
  botActiveCount,
  onBots,
}: {
  projects: Project[];
  sessions: Session[];
  activity: ActivityEvent[];
  attention: AttentionItem[];
  git?: GitStatus;
  loading: boolean;
  loadingProjectId?: string;
  onOpen: () => void;
  onProject: (project: Project, surface: ShellSurface) => void;
  onCustomize: (project: Project) => void;
  onRelink: (project: Project) => void;
  onSession: (session: Session) => void;
  onRemove: (project: Project) => void;
  onActivity: (item: ActivityEvent) => void;
  onAttention: (item: AttentionItem) => void;
  onResearch: () => void;
  onBootstrapPlan: () => void;
  onTerminal: () => void;
  onInbox: () => void;
  onGit: () => void;
  showRecentActivity: boolean;
  showAgentRail: boolean;
  showProjectPaths: boolean;
  agentReady: boolean;
  onAgentSettings: () => void;
  bots: BotProfile[];
  botActiveCount: number;
  onBots: () => void;
}) {
  const live = sessions.filter((session) => isLiveSessionStatus(session.status));
  if (!loading && projects.length === 0) {
    return (
      <main className="wj-page wj-home-page" aria-labelledby="home-first-run-heading">
        <h1 className="sr-only" id="home-first-run-heading">Open your first workspace</h1>
        <div className="wj-home-first-run">
          <Empty icon={<Folder />} title="Open your first workspace" detail="Choose a project folder. wheeljack will keep its Work sessions, agents, and Plan board together." action={<Button onClick={onOpen}><Folder />Open folder</Button>} />
        </div>
      </main>
    );
  }
  return (
    <main className="wj-page wj-home-page" aria-busy={loading} aria-labelledby="home-surface-heading">
      <div className="wj-home-overview">
        <section className="wj-page-heading">
          <div><h1 id="home-surface-heading">Workspace</h1><p>Projects, live agents, and the work waiting for your attention.</p></div>
          <Button variant="outline" onClick={onOpen}><Folder />Open folder</Button>
        </section>
        <section className="wj-metrics" aria-label="Workspace metrics">
          <Metric value={projects.length} label="Projects" />
          <Metric value={live.length} label="Live sessions" onClick={onTerminal} />
          <Metric value={attention.length} label="Inbox" accent onClick={onInbox} />
          <Metric value={git?.changedFiles.length ?? projects.filter((item) => item.dirty).length} label="Changed files" onClick={onGit} />
        </section>
        {projects.length > 0 && !agentReady && (
          <Card className="mb-2" size="sm">
            <CardContent className="flex items-center justify-between gap-4 py-3">
              <div><strong className="text-sm">Agent setup needed</strong><p className="text-xs text-muted-foreground">Verify a coding agent before using workspace quick starts.</p></div>
              <Button size="sm" variant="outline" onClick={onAgentSettings}>Open agent settings</Button>
            </CardContent>
          </Card>
        )}
        <button type="button" className="wj-home-bots" onClick={onBots}>
          <span className="wj-home-bots-avatars">
            {bots.slice(0, 5).map((bot) => <AgentAvatar key={bot.id} id={bot.avatarSeed} label={bot.name} status="idle" />)}
            {bots.length === 0 && <span className="wj-home-bots-empty"><Briefcase /></span>}
          </span>
          <span><strong>Bots</strong><small>{bots.length ? `${bots.length} saved · ${botActiveCount} active` : "Create reusable specialist profiles"}</small></span>
          <ChevronRight />
        </button>
        {projects.length > 0 && <section className="wj-command-row" aria-label="Quick starts">
          <button className="wj-quick-launch" disabled={!agentReady} onClick={onResearch}><Search /><span><strong>Research</strong><small>Spawn a research lane and turn findings into scoped tasks.</small></span></button>
          <button className="wj-quick-launch" disabled={!agentReady} onClick={onBootstrapPlan}><LayoutDashboard /><span><strong>Bootstrap plan</strong><small>Analyze this project and propose PRD, TDD, and Kanban files together.</small></span></button>
        </section>}
      </div>
      <div className={`wj-home-grid ${showRecentActivity ? "" : "single"}`}>
        <section className="wj-home-panel">
          <SectionHeading title="Active projects" />
          <ScrollArea className="wj-home-scroll">
            <div className="wj-project-list">
              {projects.map((item) => {
                const projectLive = live.filter((session) => session.cwd === item.path).length;
                const itemLoading = item.id === loadingProjectId;
                return (
                  <ContextMenu key={item.id}>
                    <ContextMenuTrigger asChild>
                      <article className="wj-project-row" aria-busy={itemLoading || undefined} data-disabled={loading || undefined} data-loading={itemLoading || undefined}>
                    <span className="wj-project-row-icon">{itemLoading ? <DotMatrixLoader size={16} label={`Loading ${item.name}`} /> : <ProjectGlyph icon={item.icon} color={item.iconColor} />}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><strong>{item.name}</strong>{item.pathExists === false ? <Badge variant="destructive">Folder missing</Badge> : item.dirty && <Badge variant="outline">Attention</Badge>}</div>
                      {showProjectPaths && <small className="block truncate">{item.path}</small>}
                      <div className="wj-project-meta">{itemLoading ? <span className="wj-project-loading-label">Loading workspace…</span> : <><code>{item.branch}</code><span>{projectLive} running</span></>}</div>
                    </div>
                    {item.pathExists === false
                      ? <Button size="sm" variant="outline" disabled={loading} onClick={() => onRelink(item)}><Folder />Relink</Button>
                      : <>
                        <Button size="sm" variant="ghost" disabled={loading} onClick={() => onProject(item, "terminal")}>Work</Button>
                        <Button size="sm" variant="ghost" disabled={loading} onClick={() => onProject(item, "ops")}>Plan</Button>
                      </>}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button aria-label={`More actions for ${item.name}`} size="icon-sm" variant="ghost" disabled={loading}><MoreHorizontal /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <ProjectMenuItems project={item} disabled={loading} onProject={onProject} onCustomize={onCustomize} onRelink={onRelink} onRemove={onRemove} />
                      </DropdownMenuContent>
                    </DropdownMenu>
                      </article>
                    </ContextMenuTrigger>
                    <ContextMenuContent><ProjectMenuItems context project={item} disabled={loading} onProject={onProject} onCustomize={onCustomize} onRelink={onRelink} onRemove={onRemove} /></ContextMenuContent>
                  </ContextMenu>
                );
              })}
              {loading && projects.length === 0 && <div className="wj-loading-state"><DotMatrixLoader variant="boot" size={42} label="Loading projects" /></div>}
            </div>
            {showAgentRail && <><SectionHeading title="Live sessions" className="mt-6" />
              <div className="wj-session-list">
                {live.map((session) => <ContextMenu key={session.id}><ContextMenuTrigger asChild><button onClick={() => onSession(session)}><CircleDot /><span>{resolveAgentLabel(session.nodeTitle)}</span><small>{session.adapterId}</small><RunStateBadge status={session.status} variant="compact" /></button></ContextMenuTrigger><ContextMenuContent><ContextMenuItem onSelect={() => onSession(session)}><Terminal />Open session</ContextMenuItem><DevToolsContextItem /></ContextMenuContent></ContextMenu>)}
                {!loading && live.length === 0 && <Empty compact icon={<Terminal />} title="No live sessions" detail={projects.length ? "Open Work to start a shell or launch an agent in this workspace." : "Open a project first, then start a shell or agent session."} action={<Button variant="outline" size="sm" onClick={projects.length ? onTerminal : onOpen}>{projects.length ? "Open Work" : "Open folder"}</Button>} />}
              </div></>}
          </ScrollArea>
        </section>
        {showRecentActivity && <section className="wj-home-panel">
          <SectionHeading title="Needs attention" action={attention.length > 0 ? <Button variant="ghost" size="xs" onClick={onInbox}>Open inbox</Button> : undefined} />
          <ScrollArea className="wj-home-scroll">
            <div className="wj-timeline">
              {attention.slice(0, 10).map((item) => <ContextMenu key={item.id}><ContextMenuTrigger asChild><button className="wj-activity-row text-left" onClick={() => onAttention(item)}><RunStateBadge status={item.status} variant="compact" /><div><div className="flex items-center justify-between gap-4"><strong>{item.title}</strong></div><p>{item.detail}</p></div></button></ContextMenuTrigger><ContextMenuContent><ContextMenuItem onSelect={() => onAttention(item)}><Bell />Open inbox item</ContextMenuItem><DevToolsContextItem /></ContextMenuContent></ContextMenu>)}
              {!loading && attention.length === 0 && <Empty compact icon={<Bell />} title="All clear" detail="Approvals, questions, and failures will appear here when they need you." />}
            </div>
            <SectionHeading title="Recent activity" className="mt-6" /><div className="wj-timeline">{activity.slice(0, 8).map((item) => <ContextMenu key={item.id}><ContextMenuTrigger asChild><div className="contents"><ActivityRow item={item} onOpen={() => onActivity(item)} /></div></ContextMenuTrigger><ContextMenuContent><ContextMenuItem onSelect={() => onActivity(item)}><History />Open activity</ContextMenuItem><DevToolsContextItem /></ContextMenuContent></ContextMenu>)}{!loading && activity.length === 0 && <Empty compact icon={<History />} title="No activity yet" detail="Project, terminal, and agent events will collect here as you work." />}</div>
          </ScrollArea>
        </section>}
      </div>
    </main>
  );
}

export function OnboardingSurface({
  step,
  project,
  adapters,
  adapterArgsById,
  selectedAdapterId,
  busy: externalBusy,
  error,
  repairCommand,
  onOpen,
  onSkip,
  onAdapter,
  onRescan,
  onVerify,
  onRepair,
  onAgentSettings,
  onStartAgent,
  onStartShell,
}: {
  step: 1 | 2 | 3;
  project?: Project;
  adapters: Adapter[];
  adapterArgsById: Record<string, string[]>;
  selectedAdapterId: string;
  busy: boolean;
  error?: string;
  repairCommand?: string;
  onOpen: () => void;
  onSkip: () => void;
  onAdapter: (id: string) => void;
  onRescan: () => void;
  onVerify: () => void;
  onRepair: () => void;
  onAgentSettings: () => void;
  onStartAgent: (prompt: string) => Promise<boolean>;
  onStartShell: () => Promise<boolean>;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [prompt, setPrompt] = useState("Review this repository and tell me what it does, how to run it, and one useful next task. Don’t change files.");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionStatus, setActionStatus] = useState("");
  const [actionError, setActionError] = useState("");
  const busy = externalBusy || actionBusy;
  const codingAdapters = adapters.filter((adapter) => adapter.id !== "generic-shell");
  const selectedAdapter = codingAdapters.find((adapter) => adapter.id === selectedAdapterId);
  const selectedArgs = adapterArgsById[selectedAdapterId] ?? [];
  const readiness = selectedAdapter ? adapterReadinessLabel(selectedAdapter, selectedArgs) : "Not selected";
  const adapterMessage = selectedAdapter?.probe?.message ?? selectedAdapter?.setupHint ?? "Choose an installed coding agent.";
  const failed = readiness === "Failed";

  useEffect(() => {
    setActionStatus("");
    setActionError("");
    headingRef.current?.focus();
  }, [step]);

  const startShell = async () => {
    setActionBusy(true);
    setActionError("");
    setActionStatus("Creating a shell...");
    try {
      if (await onStartShell()) setActionStatus("Shell created. Opening Work...");
      else {
        setActionStatus("");
        setActionError("Couldn't create a shell. Try again.");
      }
    } catch (cause) {
      setActionStatus("");
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionBusy(false);
    }
  };

  const startAgent = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt) return;
    setActionBusy(true);
    setActionError("");
    setActionStatus("Creating your first agent...");
    try {
      if (await onStartAgent(nextPrompt)) setActionStatus("Agent started in Work.");
      else {
        setActionStatus("");
        setActionError("Couldn't create the agent. Your prompt is still here so you can retry.");
      }
    } catch (cause) {
      setActionStatus("");
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <main className="wj-page wj-onboarding" data-onboarding-step={step} aria-busy={busy} aria-labelledby="onboarding-heading">
      <div className="wj-onboarding-frame">
        <div className="wj-onboarding-topbar">
          <span>Welcome to wheeljack</span>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onSkip}>Skip guide</Button>
        </div>
        <ol className="wj-onboarding-steps" aria-label="Onboarding progress">
          {(["Project", "Agent", "First run"] as const).map((label, index) => {
            const number = index + 1;
            const state = number < step ? "complete" : number === step ? "current" : "upcoming";
            return (
              <li key={label} data-state={state} aria-current={number === step ? "step" : undefined}>
                <span className="wj-onboarding-step-number" aria-hidden>{number < step ? <CheckIcon /> : number}</span>
                <span>{label}</span>
              </li>
            );
          })}
        </ol>
        <Card className="wj-onboarding-card">
          <CardHeader className="wj-onboarding-card-header">
            <span className="wj-onboarding-kicker">Step {step} of 3</span>
            <h1 id="onboarding-heading" ref={headingRef} tabIndex={-1}>
              {step === 1 ? "Start with a project" : step === 2 ? "Connect a coding agent" : "Run your first agent"}
            </h1>
            <CardDescription>
              {step === 1
                ? "Choose any local folder. Git is optional."
                : step === 2
                  ? "Use a coding-agent CLI that is already installed on this computer."
                  : `Start with a safe repository review${project ? ` in ${project.name}` : ""}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="wj-onboarding-card-content">
            {step === 1 && (
              <>
                <div className="wj-onboarding-trust">
                  <MonitorCog aria-hidden />
                  <div>
                    <strong>wheeljack's workspace state stays local.</strong>
                    <p>Chats, terminals, worktree lanes, reviews, and Plan state stay on this device. Agent credentials and provider connections stay with their respective CLIs.</p>
                  </div>
                </div>
                {project && <div className="wj-onboarding-project"><Folder aria-hidden /><div><strong>{project.name}</strong><code>{project.path}</code></div></div>}
                <div className="wj-onboarding-actions">
                  <Button disabled={busy} onClick={onOpen}><Folder />Open project folder</Button>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <div className="wj-onboarding-field">
                  <Label htmlFor="onboarding-agent">Coding agent</Label>
                  <Select value={selectedAdapter?.id ?? ""} disabled={busy || codingAdapters.length === 0} onValueChange={(id) => {
                    setActionError("");
                    onAdapter(id);
                  }}>
                    <SelectTrigger id="onboarding-agent" className="wj-onboarding-select" aria-label="Coding agent">
                      <SelectValue placeholder="Choose a coding agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {codingAdapters.map((adapter) => <SelectItem key={adapter.id} value={adapter.id}>{adapter.displayName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className={`wj-onboarding-adapter${failed ? " failed" : ""}`}>
                  <div><strong>{selectedAdapter?.displayName ?? "No coding agent detected"}</strong><Badge variant={failed ? "destructive" : readiness === "Ready" ? "secondary" : "outline"}>{readiness}</Badge></div>
                  <p role={failed ? "alert" : undefined}>{adapterMessage}</p>
                </div>
                <p className="wj-onboarding-note">wheeljack runs one real, non-mutating test turn.</p>
                <div className="wj-onboarding-actions">
                  {readiness === "Sign in" && repairCommand
                    ? <Button disabled={busy} title={repairCommand} onClick={onRepair}><Terminal />Sign in</Button>
                    : failed
                      ? <Button disabled={busy || !canVerifyAdapter(selectedAdapter)} onClick={onVerify}><RefreshCw />Retry</Button>
                      : ["Verify", "Reverify"].includes(readiness)
                        ? <Button disabled={busy || !canVerifyAdapter(selectedAdapter)} onClick={onVerify}><CheckIcon />Verify</Button>
                        : <Button disabled={busy} onClick={onRescan}><RefreshCw />Rescan</Button>}
                  <Button variant="outline" disabled={busy} onClick={onAgentSettings}><Settings />Agent Settings</Button>
                </div>
                {readiness === "Sign in" && repairCommand && <p className="wj-onboarding-note">Sign-in opens in Work. Return Home and rescan when it finishes.</p>}
                <OnboardingShellAction working={busy} onStartShell={startShell} />
              </>
            )}
            {step === 3 && (
              <>
                <form className="wj-onboarding-agent-form" onSubmit={startAgent}>
                  <Label htmlFor="onboarding-prompt">First prompt</Label>
                  <Textarea id="onboarding-prompt" rows={5} disabled={busy} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
                  <p>The agent will inspect the project without changing files. Onboarding finishes after wheeljack receives its completed response.</p>
                  <div className="wj-onboarding-actions">
                    <Button type="submit" disabled={busy || !prompt.trim()}><Play />Start first agent</Button>
                  </div>
                </form>
                <OnboardingShellAction working={busy} onStartShell={startShell} />
              </>
            )}
            {(busy || actionStatus || error || actionError) && (
              <div className="wj-onboarding-feedback">
                <p className="wj-inline-status" role="status" aria-live="polite" aria-atomic="true">{busy && <DotMatrixLoader variant="boot" size={14} />}{busy && !actionStatus ? "Working..." : actionStatus}</p>
                {(error || actionError) && <p role="alert">{error || actionError}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function OnboardingShellAction({ working, onStartShell }: { working: boolean; onStartShell: () => void }) {
  return (
    <div className="wj-onboarding-shell">
      <div><strong>Prefer a plain terminal?</strong><p>You can finish setup without connecting an agent.</p></div>
      <Button variant="ghost" disabled={working} onClick={onStartShell}><Terminal />Use wheeljack as a terminal</Button>
    </div>
  );
}

function Metric({ value, label, accent, onClick }: { value: number; label: string; accent?: boolean; onClick?: () => void }) {
  const content = <><strong className={accent ? "text-primary" : ""}>{value}</strong><span>{label}</span></>;
  return onClick ? <button aria-label={`${label}: ${value}. Open ${label.toLowerCase()}`} onClick={onClick}>{content}</button> : <div aria-label={`${label}: ${value}`}>{content}</div>;
}

function SectionHeading({ title, action, className = "" }: { title: string; action?: React.ReactNode; className?: string }) {
  return <div className={`wj-section-heading ${className}`}><h2>{title}</h2>{action}</div>;
}

function ActivityRow({ item, onOpen }: { item: ActivityEvent; onOpen?: () => void }) {
  const content = <>
    <RunStateBadge status={item.status} variant="compact" />
    <div><div className="flex items-center justify-between gap-4"><strong>{item.nodeTitle || item.kind || "Activity"}</strong><time>{formatTime(item.createdAt)}</time></div><p>{item.message}</p></div>
  </>;
  if (onOpen) return <button className="wj-activity-row text-left" onClick={onOpen}>{content}</button>;
  return (
    <article className="wj-activity-row">
      {content}
    </article>
  );
}

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
  const cardRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const kanban = documents?.documents.kanban;
  const selectedDocument = specKind === "prd" ? documents?.documents.prd : documents?.documents.tdd;
  const documentWarnings = page === "board" ? kanban?.warnings ?? [] : page === "spec" ? selectedDocument?.warnings ?? [] : [];
  const missingDocumentCount = documents ? Object.values(documents.documents).filter((document) => !document.exists).length : 3;
  const boardWritable = kanban?.format === "wheeljack-v1";
  const structuredRuntimes = runtimes.filter((runtime) => runtime.structured);
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
  const boardLayoutKey = state.cards.map(({ id, columnId }) => `${id}:${columnId}`).join("|");
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
    const nextRects = new Map(cards.map((element) => [element.dataset.taskId!, element.getBoundingClientRect()]));
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const element of cards) {
        const previous = cardRectsRef.current.get(element.dataset.taskId!);
        const current = nextRects.get(element.dataset.taskId!);
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
                <DropdownMenuItem disabled={!boardWritable} onSelect={() => onGenerateWithAgent("kanban")}>Generate with agent</DropdownMenuItem>
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
          {!kanban?.exists && state.cards.length > 0 && <div className="wj-inline-notice border-border bg-muted/30"><span>Legacy Plan cards are not file-backed yet.</span><Button onClick={onMigrateLegacy}>Migrate legacy Plan</Button></div>}
          {kanban?.format === "importable" && <div className="wj-inline-notice border-border bg-muted/30"><span>KANBAN.md was imported read-only. Review its canonical wheeljack conversion before editing.</span><Button onClick={onNormalizeKanban}>Review conversion</Button></div>}
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
                    title={!kanban?.exists ? "Set up Plan" : boardWritable ? "Plan your first task" : "Plan is read-only"}
                    description={!kanban?.exists ? "Create KANBAN.md to keep project tasks visible, editable, and local to this repository." : boardWritable ? "Turn the next outcome into a task contract, then assign it when the work is ready." : "Review the imported KANBAN.md conversion above before editing tasks."}
                  >
                    {!kanban?.exists
                      ? <Button onClick={() => onCreateDocument("kanban")}><Plus />Create KANBAN.md</Button>
                      : boardWritable && <Button onClick={() => setComposerOpen(true)}><Plus />New task</Button>}
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
                                      ? <Button disabled={!boardWritable} title={!boardWritable ? "Review the KANBAN.md conversion to enable card actions" : undefined} variant="ghost" size="xs" onClick={() => onReview(card)}><Search />Review evidence</Button>
                                      : cardRole !== "done"
                                        ? <Button disabled={!boardWritable || Boolean(card.taskLane?.closedAt)} title={!boardWritable ? "Review the KANBAN.md conversion to enable card actions" : undefined} variant="ghost" size="xs" onClick={() => intervene(card)}><Play />Start fresh task agent</Button>
                                        : <span className="wj-task-complete"><CheckIcon />Complete</span>}
                                  <span className="flex-1" />
                                    {!editing && <DropdownMenu onOpenChange={(open) => { if (!open) setDeleteArmed(undefined); }}>
                                      <DropdownMenuTrigger asChild><Button disabled={!boardWritable} title={!boardWritable ? "Review the KANBAN.md conversion to enable card actions" : undefined} aria-label={`Task actions: ${card.title}`} variant="ghost" size="icon-xs"><MoreHorizontal /></Button></DropdownMenuTrigger>
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
              return <label data-disabled={disabled || undefined} key={card.id}>
                <Checkbox
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
                {checked && <span role="button" tabIndex={0} aria-label={`${dependencyHardDraft.has(card.id) ? "Make soft" : "Make hard"} relationship with ${card.title}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setDependencyHardDraft((current) => { const next = new Set(current); if (next.has(card.id)) next.delete(card.id); else next.add(card.id); return next; }); }} onKeyDown={(event) => { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); event.currentTarget.click(); }}><Badge variant="outline">{dependencyHardDraft.has(card.id) ? "Hard" : "Soft"}</Badge></span>}
              </label>;
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
        <ContextMenuItem disabled={!selectedDocument?.exists || !boardWritable} onSelect={() => onCreateTasks(specKind)}><Plus />Create tasks</ContextMenuItem>
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
  const dockedInspector = dockedCard ? <section className="wj-floor-panel wj-floor-docked-inspector" aria-labelledby="floor-inspector-heading">
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
      <section className="wj-page-heading wj-document-heading"><div><div className="wj-document-state"><span className={`wj-file-state ${exists ? "saved" : ""}`}>{exists ? `${kind.toUpperCase()}.md` : "Not created"}</span>{saveLabel && <span className="wj-document-save-status wj-inline-status" role="status" aria-live="polite">{saveStatus === "saving" && <DotMatrixLoader size={12} />}{saveStatus === "saved" && <DotMatrixLoader variant="verify" size={12} />}{saveLabel}</span>}</div><h1>{prd ? "Product requirements" : "Technical design"}</h1><p>{prd ? "Define the outcome, workflow, constraints, and acceptance criteria." : "Define architecture, contracts, risks, rollout, and required validation."}</p></div><div className="wj-document-actions">{!exists && value && <Button variant="outline" onClick={onMigrate}>Migrate legacy</Button>}<Button variant="ghost" onClick={onGenerateWithAgent}>Generate with agent</Button><Button variant="secondary" onClick={exists ? onGenerate : onCreate}>{exists ? "Use template" : `Create ${kind.toUpperCase()}.md`}</Button><Button disabled={!exists || !boardWritable} onClick={onCreateTasks}>Create tasks</Button></div></section>
      {exists
        ? <Textarea aria-label={`${kind.toUpperCase()} document editor`} className="wj-document-editor min-h-0 flex-1 resize-none font-mono leading-6" value={value} onChange={(event) => onChange(event.target.value)} placeholder={prd ? "# Product requirements" : "# Technical design"} />
        : <Empty title={`No ${kind.toUpperCase()} yet`} detail={`Create ${kind.toUpperCase()}.md in the project root, or ask an agent to draft it from the current workspace.`} action={<Button onClick={onCreate}>Create document</Button>} />}
    </div></div>
  );
}

export function SettingsSurface({
  page,
  preferences,
  shortcuts,
  adapters,
  agentProfiles,
  agentAutonomyPolicy,
  agentControlAudit,
  adapterArgsById,
  selectedAdapterId,
  busy,
  coreVersion,
  platform,
  appDataDir,
  diagnosticsReport,
  systemUsesLight,
  onBack,
  onPage,
  onPreferences,
  onShortcuts,
  onResetAll,
  resettingPreferences,
  preferencesStatus,
  onAdapter,
  onAgentProfile,
  onAgentAutonomyPolicy,
  onRefreshAgentControlAudit,
  onRescan,
  onVerify,
  onExportBackup,
  repairCommand,
  onRepair,
  updater,
  onInstallUpdate,
}: {
  page: SettingsPage;
  preferences: UiPreferences;
  shortcuts: ShortcutBindings;
  adapters: Adapter[];
  agentProfiles: AgentProfile[];
  agentAutonomyPolicy: AgentAutonomyPolicy;
  agentControlAudit: AgentControlAudit[];
  adapterArgsById: Record<string, string[]>;
  selectedAdapterId: string;
  busy: boolean;
  coreVersion?: string;
  platform?: string;
  appDataDir?: string;
  diagnosticsReport: string;
  systemUsesLight: boolean;
  onBack: () => void;
  onPage: (page: SettingsPage) => void;
  onPreferences: (patch: Partial<UiPreferences>) => void;
  onShortcuts: (shortcuts: ShortcutBindings) => void;
  onResetAll: () => Promise<void>;
  resettingPreferences: boolean;
  preferencesStatus: string;
  onAdapter: (id: string) => void;
  onAgentProfile: (adapterId: string, patch: Partial<AgentProfile>) => void;
  onAgentAutonomyPolicy: (patch: Partial<AgentAutonomyPolicy>) => void;
  onRefreshAgentControlAudit: () => void;
  onRescan: () => void;
  onVerify: () => void;
  onExportBackup: (path: string) => Promise<void>;
  repairCommand?: string;
  onRepair: () => void;
  updater: UpdateController;
  onInstallUpdate: () => void;
}) {
  const codingAdapters = adapters.filter((adapter) => adapter.id !== "generic-shell");
  const selectedAdapter = codingAdapters.find((adapter) => adapter.id === selectedAdapterId);
  const selectedProfile = agentProfiles.find((profile) => profile.adapterId === selectedAdapterId);
  const selectedArgs = adapterArgsById[selectedAdapterId] ?? [];
  const approvalPolicies = selectedAdapter?.supportedApprovalPolicies ?? [];
  const selectedAdapterFailed = selectedAdapter?.probe?.verificationStatus === "failed";
  const [advancedPalette, setAdvancedPalette] = useState(false);
  const [themeStatus, setThemeStatus] = useState("");
  const [deleteThemeOpen, setDeleteThemeOpen] = useState(false);
  const [replacementThemeId, setReplacementThemeId] = useState("");
  const [pendingThemeImport, setPendingThemeImport] = useState<ThemeImportResult>();
  const [pendingThemeIndex, setPendingThemeIndex] = useState("0");
  const [vsCodeThemes, setVsCodeThemes] = useState<VsCodeThemeSource[]>([]);
  const [vsCodeThemePath, setVsCodeThemePath] = useState("");
  const [vsCodeThemeQuery, setVsCodeThemeQuery] = useState("");
  const [fontFamilies, setFontFamilies] = useState<string[]>([]);
  const [storageStatus, setStorageStatus] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  useEffect(() => {
    void invoke<string[]>("system_font_families")
      .then(setFontFamilies)
      .catch(() => setFontFamilies([]));
  }, []);
  const themes = [...builtInThemes, ...preferences.customThemes];
  const activeThemeId = preferences.appearanceMode === "fixed"
    ? preferences.fixedThemeId
    : systemUsesLight ? preferences.systemLightThemeId : preferences.systemDarkThemeId;
  const [selectedThemeId, setSelectedThemeId] = useState(activeThemeId);
  useEffect(() => setSelectedThemeId(activeThemeId), [activeThemeId, preferences.appearanceMode]);
  const selectedTheme = themes.find((theme) => theme.id === selectedThemeId) ?? builtInThemes[0];
  const replacementThemes = themes.filter((theme) => theme.id !== selectedTheme.id && theme.variant === selectedTheme.variant);
  const selectedThemeIsAssigned = [preferences.fixedThemeId, preferences.systemLightThemeId, preferences.systemDarkThemeId].includes(selectedTheme.id);
  const selectTheme = (theme: ThemeDefinition) => {
    setSelectedThemeId(theme.id);
    onPreferences(themeAssignment(preferences.appearanceMode, systemUsesLight, theme));
  };
  const saveCustomTheme = (theme: ThemeDefinition) => onPreferences({
    customThemes: preferences.customThemes.map((item) => item.id === theme.id ? theme : item),
    ...themeAssignment(preferences.appearanceMode, systemUsesLight, theme),
  });
  const duplicateTheme = (theme = selectedTheme) => {
    const copy = { ...theme, id: crypto.randomUUID().replaceAll("-", ""), name: `${theme.name} copy`, isBuiltIn: false, basedOnId: theme.id, seed: { ...theme.seed }, overrides: { ...theme.overrides }, terminal: { ...theme.terminal, ansi: [...theme.terminal.ansi] } };
    setSelectedThemeId(copy.id);
    onPreferences({ customThemes: [...preferences.customThemes, copy], ...themeAssignment(preferences.appearanceMode, systemUsesLight, copy) });
  };
  const openThemeDelete = () => {
    const replacement = replacementThemes.find((theme) => theme.id === selectedTheme.basedOnId)
      ?? replacementThemes.find((theme) => theme.isBuiltIn)
      ?? replacementThemes[0];
    setReplacementThemeId(replacement?.id ?? "");
    setDeleteThemeOpen(true);
  };
  const removeTheme = () => {
    if (selectedTheme.isBuiltIn || !replacementThemeId) return;
    const replacement = themes.find((theme) => theme.id === replacementThemeId && theme.id !== selectedTheme.id);
    if (!replacement) return;
    onPreferences({
      customThemes: preferences.customThemes.filter((theme) => theme.id !== selectedTheme.id),
      ...replaceThemeAssignments(preferences, selectedTheme.id, replacement.id),
    });
    setSelectedThemeId(replacement.id);
    setDeleteThemeOpen(false);
    setReplacementThemeId("");
  };
  const resetTheme = () => {
    if (selectedTheme.isBuiltIn) {
      setThemeStatus("This built-in theme already matches its original palette.");
      return;
    }
    const basis = themes.find((theme) => theme.id === selectedTheme.basedOnId)
      ?? builtInThemes.find((theme) => theme.variant === selectedTheme.variant)
      ?? builtInThemes[0];
    saveCustomTheme({
      ...selectedTheme,
      variant: basis.variant,
      seed: { ...basis.seed },
      overrides: {},
      terminal: { ...basis.terminal, ansi: [...basis.terminal.ansi] },
    });
    setThemeStatus("Theme colors reset.");
  };
  const applyThemeImport = (result: ThemeImportResult, imported: ThemeDefinition) => {
    const collision = themes.some((theme) => theme.id === imported.id);
    const external = result.source !== "wheeljack";
    const id = external || collision ? crypto.randomUUID().replaceAll("-", "") : imported.id;
    const theme = { ...imported, id, name: collision && !external ? `${imported.name} imported` : imported.name };
    const source = result.source === "vscode" ? "VS Code" : result.source === "windows-terminal" ? "Windows Terminal" : "wheeljack";
    setSelectedThemeId(theme.id);
    onPreferences({ customThemes: [...preferences.customThemes, theme], ...themeAssignment(preferences.appearanceMode, systemUsesLight, theme) });
    setThemeStatus(`Imported ${theme.name} from ${source}.${result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : ""}`);
  };
  const handleThemeImport = (result: ThemeImportResult) => {
    if (result.themes.length === 1) {
      applyThemeImport(result, result.themes[0]);
      return;
    }
    setPendingThemeIndex("0");
    setPendingThemeImport(result);
  };
  const importTheme = async () => {
    try {
      const path = await open({ multiple: false, directory: false, title: "Import theme", filters: [{ name: "Theme file", extensions: ["json", "jsonc"] }] });
      if (typeof path !== "string") return;
      const fileName = path.split(/[\\/]/).pop()?.replace(/\.(?:jsonc?|wheeljack-theme\.json)$/i, "") || "Imported theme";
      handleThemeImport(parseImportedThemeDocument(await readThemeDocument(path), fileName));
    } catch (cause) {
      setThemeStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const openVsCodeThemes = async () => {
    try {
      setThemeStatus("Finding installed VS Code themes…");
      const catalog = await discoverVsCodeThemes();
      if (catalog.themes.length === 0) {
        setThemeStatus("No installed VS Code color themes were found.");
        return;
      }
      const active = catalog.settingsPath
        ? activeVsCodeThemeName(await readThemeDocument(catalog.settingsPath).catch(() => ""))
        : undefined;
      const selected = catalog.themes.find((theme) => theme.label === active) ?? catalog.themes[0];
      setVsCodeThemeQuery("");
      setVsCodeThemePath(selected.path);
      setVsCodeThemes(catalog.themes);
      setThemeStatus(active ? `Found ${catalog.themes.length} themes. Selected ${active}.` : `Found ${catalog.themes.length} installed themes.`);
    } catch (cause) {
      setThemeStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const importVsCodeTheme = async () => {
    const source = vsCodeThemes.find((theme) => theme.path === vsCodeThemePath);
    if (!source) return;
    try {
      handleThemeImport(parseImportedThemeDocument(await readThemeDocument(source.path), source.label));
      setVsCodeThemes([]);
    } catch (cause) {
      setThemeStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const exportTheme = async () => {
    try {
      const path = await save({ title: "Export wheeljack theme", defaultPath: `${selectedTheme.id}.wheeljack-theme.json`, filters: [{ name: "wheeljack theme", extensions: ["json"] }] });
      if (!path) return;
      await writeThemeDocument(path, serializeTheme(selectedTheme));
      setThemeStatus(`Exported ${selectedTheme.name}.`);
    } catch (cause) {
      setThemeStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const exportBackup = async () => {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = await save({
        title: "Export wheeljack backup",
        defaultPath: `wheeljack-backup-${stamp}.sqlite3`,
        filters: [{ name: "SQLite backup", extensions: ["sqlite3"] }],
      });
      if (!path) return;
      setBackupBusy(true);
      setStorageStatus("Exporting backup…");
      await onExportBackup(path);
      setStorageStatus(`Backup exported to ${path}.`);
    } catch (cause) {
      setStorageStatus(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBackupBusy(false);
    }
  };
  const pasteTheme = async () => {
    try {
      handleThemeImport(parseImportedThemeDocument(await navigator.clipboard.readText()));
    } catch (cause) {
      setThemeStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const updateAttention = updateAttentionLabel(updater);
  const updateStatus = updateStatusLabel(updater);
  const latestVersion = updater.update?.version
    ?? (updater.status === "up-to-date" ? coreVersion : undefined);
  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="wj-settings-header">
        <div className="wj-settings-title"><Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft />Back</Button><span>Settings</span></div>
        <Tabs className="wj-settings-tabs" value={page} onValueChange={(value) => onPage(value as SettingsPage)}>
          <TabsList aria-label="Settings categories" variant="line">
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
            <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="application">
              Application
              {updateAttention && <Badge className="ml-2" variant={updateAttention === "Error" ? "destructive" : "outline"}>{updateAttention}</Badge>}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <main className="wj-settings-page" aria-labelledby="settings-page-heading">
          <div className="wj-settings-intro">
            <div><h1 id="settings-page-heading">{settingsPageDetails[page].title}</h1><p>{settingsPageDetails[page].description}</p></div>
            {page === "workspace" && <Button variant="ghost" size="sm" onClick={() => onPreferences(defaultInterfacePreferences)}>Reset workspace</Button>}
            {page === "shortcuts" && <Button variant="ghost" size="sm" onClick={() => onShortcuts({ ...defaultShortcutBindings })}>Reset shortcuts</Button>}
          </div>
          {page === "appearance" && (
            <div className="wj-appearance-settings">
              <ThemePreview theme={selectedTheme} preferences={preferences} />
              <div className="wj-appearance-controls">
              <SettingsCard wide title="Theme" description="Use one theme or follow the system light and dark appearance." action={<div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => onPreferences({ appearanceMode: defaultUiPreferences.appearanceMode, fixedThemeId: defaultUiPreferences.fixedThemeId, systemLightThemeId: defaultUiPreferences.systemLightThemeId, systemDarkThemeId: defaultUiPreferences.systemDarkThemeId, showStickerLensBackground: defaultUiPreferences.showStickerLensBackground, headingFontFamily: defaultUiPreferences.headingFontFamily, uiFontFamily: defaultUiPreferences.uiFontFamily, codeFontFamily: defaultUiPreferences.codeFontFamily, uiScale: defaultUiPreferences.uiScale, uiFontSize: defaultUiPreferences.uiFontSize, terminalFontSize: defaultUiPreferences.terminalFontSize, theme: defaultUiPreferences.theme })}>Reset appearance</Button><Button variant="ghost" size="sm" onClick={() => void openVsCodeThemes()}>VS Code themes</Button><Button variant="ghost" size="sm" onClick={() => void importTheme()}>Import file</Button><Button variant="ghost" size="sm" onClick={() => void pasteTheme()}>Paste JSON</Button></div>}>
                <Tabs value={preferences.appearanceMode} onValueChange={(value) => onPreferences({ appearanceMode: value as "fixed" | "system" })}><TabsList><TabsTrigger value="fixed">Fixed</TabsTrigger><TabsTrigger value="system">System</TabsTrigger></TabsList></Tabs>
                {preferences.appearanceMode === "system" && <div className="wj-setting-grid mt-4">
                  <Field label="Light theme"><Select value={preferences.systemLightThemeId} onValueChange={(systemLightThemeId) => onPreferences({ systemLightThemeId })}><SelectTrigger aria-label="Light theme"><SelectValue /></SelectTrigger><SelectContent>{themes.filter((theme) => theme.variant === "light").map((theme) => <SelectItem key={theme.id} value={theme.id}>{theme.name}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="Dark theme"><Select value={preferences.systemDarkThemeId} onValueChange={(systemDarkThemeId) => onPreferences({ systemDarkThemeId })}><SelectTrigger aria-label="Dark theme"><SelectValue /></SelectTrigger><SelectContent>{themes.filter((theme) => theme.variant === "dark").map((theme) => <SelectItem key={theme.id} value={theme.id}>{theme.name}</SelectItem>)}</SelectContent></Select></Field>
                </div>}
                <div className="wj-theme-grid mt-4">
                  {themes.map((theme) => <ThemeChoice key={theme.id} theme={theme} selected={selectedTheme.id === theme.id} onClick={() => selectTheme(theme)} />)}
                </div>
                <div className="wj-theme-editor mt-4">
                  <Input aria-label="Theme name" disabled={selectedTheme.isBuiltIn} value={selectedTheme.name} onChange={(event) => saveCustomTheme({ ...selectedTheme, name: event.target.value })} />
                  <Select disabled={selectedTheme.isBuiltIn} value={selectedTheme.variant} onValueChange={(variant) => saveCustomTheme({ ...selectedTheme, variant: variant as ThemeDefinition["variant"] })}><SelectTrigger aria-label="Theme variant"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dark">Dark</SelectItem><SelectItem value="light">Light</SelectItem></SelectContent></Select>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => duplicateTheme()}>{selectedTheme.isBuiltIn ? "Edit copy" : "Duplicate"}</Button>
                    <Button variant="ghost" size="sm" onClick={() => void exportTheme()}>Export</Button>
                    <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(serializeTheme(selectedTheme))}>Copy JSON</Button>
                    {!selectedTheme.isBuiltIn && <Button variant="destructive" size="sm" onClick={openThemeDelete}>Delete</Button>}
                  </div>
                </div>
                {themeStatus && <p className="wj-inline-status mt-3 text-sm text-muted-foreground" role="status">{themeStatus.startsWith("Finding installed") && <DotMatrixLoader size={16} />}{themeStatus}</p>}
              </SettingsCard>
              <SettingsCard wide title="Typography" description="Fonts and app-wide scale. Use Ctrl/Cmd + or - to zoom." action={<Button variant="ghost" size="sm" onClick={() => onPreferences({ headingFontFamily: defaultUiPreferences.headingFontFamily, uiFontFamily: defaultUiPreferences.uiFontFamily, codeFontFamily: defaultUiPreferences.codeFontFamily, uiScale: defaultUiPreferences.uiScale, uiFontSize: defaultUiPreferences.uiFontSize, terminalFontSize: defaultUiPreferences.terminalFontSize })}>Reset typography</Button>}>
                <div className="wj-typography-grid">
                  <Field label="Heading font"><FontField ariaLabel="Heading font" value={preferences.headingFontFamily} options={headingFontPresets.filter((font) => font === "Geist Pixel" || font === "Geist Variable" || font === "Open Sans Variable" || font === "Inter Variable" || font === "system-ui" || fontFamilies.includes(font))} onValue={(headingFontFamily) => onPreferences({ headingFontFamily })} /></Field>
                  <Field label="UI font"><FontField ariaLabel="UI font" value={preferences.uiFontFamily} options={uiFontPresets.filter((font) => font === "Geist Variable" || font === "Open Sans Variable" || font === "Inter Variable" || font === "system-ui" || fontFamilies.includes(font))} onValue={(uiFontFamily) => onPreferences({ uiFontFamily })} /></Field>
                  <Field label="Code font"><FontField ariaLabel="Code font" value={preferences.codeFontFamily} options={codeFontPresets.filter((font) => font === "JetBrains Mono Variable" || font === "Cascadia Mono" || font === "monospace" || fontFamilies.includes(font))} onValue={(codeFontFamily) => onPreferences({ codeFontFamily })} /></Field>
                  <SliderField label="UI scale" value={Math.round(preferences.uiScale * 100)} min={50} max={200} step={10} suffix="%" onValue={(value) => onPreferences({ uiScale: value / 100 })} />
                  <SliderField label="UI size" value={preferences.uiFontSize} min={10} max={16} onValue={(value) => onPreferences({ uiFontSize: value })} />
                  <SliderField label="Terminal size" value={preferences.terminalFontSize} min={10} max={22} onValue={(value) => onPreferences({ terminalFontSize: value })} />
                </div>
              </SettingsCard>
              <SettingsCard wide title="Effects" description="Control decorative workspace visuals.">
                <ToggleSetting label="Sticker lens background" description="Show the interactive sticker background in empty Work and Plan views." checked={preferences.showStickerLensBackground} onChecked={(showStickerLensBackground) => onPreferences({ showStickerLensBackground })} />
              </SettingsCard>
              <SettingsCard wide title="Theme colors" description="Edit a custom theme’s semantic colors and inspect text contrast." action={<div className="flex gap-2">{selectedTheme.isBuiltIn && <Button variant="ghost" size="sm" onClick={() => duplicateTheme()}>Edit copy</Button>}<Button variant="ghost" size="sm" onClick={() => setAdvancedPalette((value) => !value)}>{advancedPalette ? "Hide advanced" : "Show advanced"}</Button><Button variant="ghost" size="sm" onClick={resetTheme}>Reset theme</Button></div>}>
                {contrastRatio(selectedTheme.seed.text, selectedTheme.seed.canvas) < 4.5 && <p className="mb-3 text-sm text-destructive" role="alert">Text and canvas are below WCAG AA contrast.</p>}
                <div className="wj-palette-grid">
                  {(Object.keys(selectedTheme.seed) as Array<keyof ThemeDefinition["seed"]>).map((key) => <ThemeColorField key={key} label={key} value={selectedTheme.seed[key]} contrastAgainst={seedContrastReference(key, selectedTheme)} disabled={selectedTheme.isBuiltIn} onChange={(value) => saveCustomTheme({ ...selectedTheme, seed: { ...selectedTheme.seed, [key]: value } })} />)}
                </div>
                {advancedPalette && <div className="wj-palette-grid mt-4">
                  {Object.entries(compileTheme(selectedTheme)).map(([key, value]) => <ThemeColorField key={key} label={key} value={value} contrastAgainst={paletteContrastReference(key, selectedTheme)} disabled={selectedTheme.isBuiltIn} onChange={(next) => saveCustomTheme({ ...selectedTheme, overrides: { ...selectedTheme.overrides, [key]: next } })} onReset={selectedTheme.overrides[key] ? () => { const overrides = { ...selectedTheme.overrides }; delete overrides[key]; saveCustomTheme({ ...selectedTheme, overrides }); } : undefined} />)}
                </div>}
              </SettingsCard>
              <SettingsCard wide title="Terminal colors" description="Terminal defaults, cursor, selection, and ANSI colors follow the active theme.">
                <div className="wj-palette-grid">
                  {(["foreground", "background", "cursor", "selection"] as const).map((key) => <ThemeColorField key={key} label={key} value={selectedTheme.terminal[key]} contrastAgainst={key === "foreground" || key === "cursor" ? selectedTheme.terminal.background : undefined} disabled={selectedTheme.isBuiltIn} onChange={(value) => saveCustomTheme({ ...selectedTheme, terminal: { ...selectedTheme.terminal, [key]: value } })} />)}
                </div>
                <div className="wj-ansi-grid mt-4">{selectedTheme.terminal.ansi.map((color, index) => <ThemeColorField key={index} label={`ANSI ${index}`} value={color} disabled={selectedTheme.isBuiltIn} onChange={(value) => { const ansi = [...selectedTheme.terminal.ansi]; ansi[index] = value; saveCustomTheme({ ...selectedTheme, terminal: { ...selectedTheme.terminal, ansi } }); }} />)}</div>
              </SettingsCard>
              </div>
            </div>
          )}
          {page === "workspace" && (
            <SettingsCard wide title="Workspace shell" description="Choose what stays visible, then tune the space around your work.">
              <div className="wj-workspace-settings">
                <div className="wj-workspace-controls">
                  <section>
                    <h3>Canvas</h3>
                    <ToggleSetting label="Pane header actions" description="Keep split and pane controls visible in each header." checked={preferences.showPaneActions} onChecked={(checked) => onPreferences({ showPaneActions: checked })} />
                  </section>
                  <section>
                    <h3>Project overview</h3>
                    <ToggleSetting label="Project paths" description="Show the full folder path below each project name." checked={preferences.showProjectPaths} onChecked={(checked) => onPreferences({ showProjectPaths: checked })} />
                    <ToggleSetting label="Recent activity" description="Keep the activity column on the workspace home." checked={preferences.showRecentActivity} onChecked={(checked) => onPreferences({ showRecentActivity: checked })} />
                  </section>
                  <section>
                    <h3>Agents</h3>
                    <ToggleSetting label="Live agent rail" description="Show active agents beside Work and Plan." checked={preferences.showAgentRail} onChecked={(checked) => onPreferences({ showAgentRail: checked })} />
                  </section>
                </div>
                <aside className="wj-workspace-preview" aria-label="Workspace layout preview">
                  <div className="wj-workspace-preview-label"><span>Preview</span><small>Updates as you change settings</small></div>
                  <div
                    className="wj-workspace-preview-frame"
                    aria-hidden="true"
                  >
                    <div className="wj-workspace-preview-sidebar">
                      <i />
                      <i />
                      <i />
                      {preferences.showProjectPaths && <small>C:\dev\wheeljack</small>}
                    </div>
                    <div className="wj-workspace-preview-pane">
                      <header><span>codex · main</span>{preferences.showPaneActions && <b>− &nbsp; □</b>}</header>
                      <div><span>PS C:\wheeljack&gt;</span><i /><i /></div>
                    </div>
                    {preferences.showAgentRail && <div className="wj-workspace-preview-rail"><i /><i /><i /></div>}
                    {preferences.showRecentActivity && <div className="wj-workspace-preview-activity"><span>Recent</span><i /><i /></div>}
                  </div>
                </aside>
              </div>
            </SettingsCard>
          )}
          {page === "shortcuts" && <ShortcutSettings bindings={shortcuts} onBindings={onShortcuts} />}
          {page === "agents" && (
            <>
              <SettingsCard title="Coding agents" description="wheeljack checks installed CLIs without exposing credentials." action={<div className="flex gap-2">{repairCommand && <Button variant="outline" size="sm" disabled={busy} title={repairCommand} onClick={onRepair}><Terminal />Sign in</Button>}<Button variant="ghost" size="sm" disabled={busy} onClick={onRescan}><RefreshCw />Rescan</Button><Button size="sm" disabled={busy || !canVerifyAdapter(selectedAdapter)} onClick={onVerify}><CheckIcon />Verify</Button></div>}>
                <Select value={selectedAdapterId} onValueChange={onAdapter}><SelectTrigger aria-label="Coding agent"><SelectValue placeholder="Agent adapter" /></SelectTrigger><SelectContent>{codingAdapters.map((adapter) => <SelectItem key={adapter.id} value={adapter.id}><span className="wj-provider-label"><ProviderMark adapterId={adapter.id} /><span>{adapter.displayName} · {adapterReadinessLabel(adapter, adapterArgsById[adapter.id] ?? [])}</span></span></SelectItem>)}</SelectContent></Select>
                {selectedAdapter && <div className={`mt-3 rounded border p-3 text-sm ${selectedAdapterFailed ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/30"}`}>
                  <div className="flex items-center justify-between gap-3"><strong className="wj-provider-label"><ProviderMark adapterId={selectedAdapter.id} /><span>{selectedAdapter.displayName}</span></strong><Badge variant={selectedAdapterFailed ? "destructive" : adapterReadinessLabel(selectedAdapter, selectedArgs) === "Ready" ? "secondary" : "outline"}>{adapterReadinessLabel(selectedAdapter, selectedArgs)}</Badge></div>
                  <p className={`mt-2 ${selectedAdapterFailed ? "text-destructive" : "text-muted-foreground"}`} role={selectedAdapterFailed ? "alert" : undefined}>{selectedAdapter.probe?.message ?? selectedAdapter.setupHint}</p>
                  {selectedAdapter.probe?.version && <code className="mt-2 block text-xs">{selectedAdapter.probe.version}</code>}
                  {selectedAdapter.probe?.executablePath && <code className="mt-1 block truncate text-xs" title={selectedAdapter.probe.executablePath}>{selectedAdapter.probe.executablePath}</code>}
                </div>}
                {selectedProfile && <div className="wj-setting-grid mt-4">
                  {selectedProfile.adapterId === "pi-coding-agent" && <Field label="Provider"><Input aria-label="Provider" value={selectedProfile.provider} onChange={(event) => onAgentProfile(selectedProfile.adapterId, { provider: event.target.value })} /></Field>}
                  <Field label="Model"><Input aria-label="Model" value={selectedProfile.model} onChange={(event) => onAgentProfile(selectedProfile.adapterId, { model: event.target.value })} /></Field>
                  <Field label="Thinking"><Select value={selectedProfile.thinking} onValueChange={(thinking) => onAgentProfile(selectedProfile.adapterId, { thinking: thinking as AgentProfile["thinking"] })}><SelectTrigger aria-label="Thinking"><SelectValue /></SelectTrigger><SelectContent>{agentEffortOptions(selectedProfile.adapterId).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field>
                  {selectedProfile.adapterId !== "pi-coding-agent" && <Field label="Approval policy">{approvalPolicies.length > 0
                    ? <Select value={selectedProfile.approvalPolicy} onValueChange={(approvalPolicy) => onAgentProfile(selectedProfile.adapterId, { approvalPolicy })}><SelectTrigger aria-label="Approval policy"><SelectValue placeholder="Choose a policy" /></SelectTrigger><SelectContent>{approvalPolicies.map((policy) => <SelectItem value={policy} key={policy}>{policy}</SelectItem>)}</SelectContent></Select>
                    : <Input aria-label="Approval policy" value={selectedProfile.approvalPolicy} onChange={(event) => onAgentProfile(selectedProfile.adapterId, { approvalPolicy: event.target.value })} />}</Field>}
                </div>}
                <div className="mt-3 space-y-2">{codingAdapters.map((adapter) => <div className="wj-adapter-row" key={adapter.id}><ProviderMark adapterId={adapter.id} /><div><strong>{adapter.displayName}</strong><small>{adapter.probe?.message ?? adapter.setupHint}</small></div><Badge variant={adapterReadinessLabel(adapter, adapterArgsById[adapter.id] ?? []) === "Ready" ? "secondary" : "outline"}>{adapterReadinessLabel(adapter, adapterArgsById[adapter.id] ?? [])}</Badge></div>)}</div>
              </SettingsCard>
              <SettingsCard wide title="Agent autonomy" description="Let agents coordinate, message peers, start bounded child agents, hand off work, and request review." action={<div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{agentAutonomyPolicy.enabled ? "Enabled" : "Disabled"}</span><Switch aria-label="Agent autonomy" checked={agentAutonomyPolicy.enabled} onCheckedChange={(enabled) => onAgentAutonomyPolicy({ enabled })} /></div>}>
                <div className="wj-setting-grid">
                  {([
                    ["Discover agents", "listAgents"],
                    ["Message agents", "sendMessage"],
                    ["Spawn agents", "spawnAgent"],
                    ["Hand off tasks", "handoffTask"],
                    ["Request review", "requestReview"],
                    ["Resolve file conflicts", "resolveFileConflict"],
                  ] as const).map(([label, key]) => <Field label={label} key={key}><Select value={agentAutonomyPolicy[key]} onValueChange={(value) => onAgentAutonomyPolicy({ [key]: value } as Partial<AgentAutonomyPolicy>)}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="allow">Allow automatically</SelectItem><SelectItem value="ask">Ask every time</SelectItem><SelectItem value="deny">Deny</SelectItem></SelectContent></Select></Field>)}
                </div>
                <div className="wj-setting-grid mt-4">
                  <Field label="Maximum spawn depth"><Input aria-label="Maximum spawn depth" type="number" min={1} max={4} value={agentAutonomyPolicy.maxDepth} onChange={(event) => onAgentAutonomyPolicy({ maxDepth: Number(event.target.value) })} /></Field>
                  <Field label="Children per agent"><Input aria-label="Children per agent" type="number" min={1} max={8} value={agentAutonomyPolicy.maxChildrenPerAgent} onChange={(event) => onAgentAutonomyPolicy({ maxChildrenPerAgent: Number(event.target.value) })} /></Field>
                  <Field label="Concurrent agents"><Input aria-label="Concurrent agents" type="number" min={1} max={16} value={agentAutonomyPolicy.maxConcurrentAgents} onChange={(event) => onAgentAutonomyPolicy({ maxConcurrentAgents: Number(event.target.value) })} /></Field>
                  <Field label="Actions per minute"><Input aria-label="Actions per minute" type="number" min={1} max={60} value={agentAutonomyPolicy.maxActionsPerMinute} onChange={(event) => onAgentAutonomyPolicy({ maxActionsPerMinute: Number(event.target.value) })} /></Field>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">All actions stay inside the current workspace and are written to the durable session audit log. Self-targeting, duplicate requests, and limit bypasses are rejected by the Rust core.</p>
              </SettingsCard>
              <SettingsCard wide title="Autonomy history" description="Recent agent-requested actions and policy decisions." action={<Button variant="ghost" size="sm" onClick={onRefreshAgentControlAudit}><RefreshCw />Refresh</Button>}>
                {agentControlAudit.length ? <div className="space-y-2">{agentControlAudit.slice(0, 20).map((entry) => <div className="wj-adapter-row" key={entry.id}><AI /><div><strong>{entry.sourceTitle} · {entry.action.replaceAll("_", " ")}</strong><small>{entry.message}</small></div><RunStateBadge status={entry.status} variant="compact" /></div>)}</div> : <p className="text-sm text-muted-foreground">No autonomous actions have been recorded for this workspace.</p>}
              </SettingsCard>
            </>
          )}
          {page === "application" && (
            <>
              <SettingsCard title="Build" description="Local wheeljack runtime information for this installed build.">
                <dl className="grid gap-3 text-sm">
                  <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Core version</dt><dd><code>{coreVersion ?? "Connecting…"}</code></dd></div>
                  <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Platform</dt><dd><code>{platform ?? "Connecting…"}</code></dd></div>
                </dl>
              </SettingsCard>
              <SettingsCard
                title="Updates"
                description="wheeljack can check and stage verified updates automatically. Installing an update always requires your confirmation and restarts the app."
                action={<Badge variant={updateAttention === "Error" ? "destructive" : "outline"}>{updateStatus}</Badge>}
              >
                <div className="space-y-3" aria-live="polite">
                  <p className="text-sm" role="status">
                    {updater.recoveryError
                      ? "wheeljack rolled back the previous update because the new build did not start successfully."
                      : updater.error
                        ? "wheeljack could not complete the last update action. You can retry safely."
                        : updater.update
                          ? `wheeljack ${updater.update.version} is ${updater.status === "ready" ? "ready to install" : updater.status === "downloading" ? "downloading" : "available"}.`
                          : updater.status === "up-to-date"
                            ? "wheeljack is up to date."
                            : updater.status === "disabled"
                              ? "Updates are disabled in development builds."
                              : "Check for the latest release when you’re ready."}
                  </p>
                  <dl className="grid gap-2 rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Current version</dt><dd><code>{coreVersion ?? "Connecting…"}</code></dd></div>
                    <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Latest version</dt><dd><code>{latestVersion ?? "Not checked"}</code></dd></div>
                    <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Last checked</dt><dd>{formatUpdateDate(updater.lastCheckedAt)}</dd></div>
                    {updater.update?.publishedAt && <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Published</dt><dd>{formatUpdateDate(updater.update.publishedAt)}</dd></div>}
                  </dl>
                  {(updater.status === "downloading" || updater.status === "installing") && (
                    <UpdateProgressView updater={updater} />
                  )}
                  {updater.update?.notes && (
                    <details className="rounded-md border p-3">
                      <summary className="cursor-pointer text-sm font-medium">Release notes</summary>
                      <div className="agent-prose mt-3"><Markdown skipHtml>{updater.update.notes}</Markdown></div>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={["checking", "downloading", "installing", "disabled"].includes(updater.status)}
                      onClick={() => void updater.checkNow()}
                    >
                      {updater.status === "checking" ? <><DotMatrixLoader size={16} />Checking…</> : "Check now"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!updater.update || ["checking", "downloading", "ready", "installing", "disabled"].includes(updater.status)}
                      onClick={() => void updater.downloadNow()}
                    >
                      {updater.status === "downloading" ? "Downloading…" : updater.error ? "Retry download" : "Download"}
                    </Button>
                    <Button disabled={updater.status !== "ready"} onClick={onInstallUpdate}>
                      Restart to install
                    </Button>
                  </div>
                  <div className="divide-y divide-border rounded-md border [&_.wj-toggle-setting]:px-3">
                    <ToggleSetting
                      label="Automatically check for updates"
                      description="Check at startup and periodically in the background."
                      checked={updater.automaticCheck}
                      onChecked={updater.setAutomaticCheck}
                    />
                    <ToggleSetting
                      label="Automatically download updates"
                      description="Download verified updates after automatic checks without restarting the app."
                      checked={updater.automaticDownload}
                      onChecked={updater.setAutomaticDownload}
                    />
                  </div>
                  {(updater.error || updater.recoveryError) && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">
                      <p>{updater.recoveryError ?? updater.error}</p>
                      <Button className="mt-2" variant="ghost" size="sm" onClick={updater.dismissError}>Dismiss</Button>
                    </div>
                  )}
                  {updater.signatureStatus === "unsigned" && (
                    <p className="text-sm text-destructive" role="alert">
                      This staged Windows update is unsigned. wheeljack will ask again before installing it.
                    </p>
                  )}
                </div>
              </SettingsCard>
              <SettingsCard title="Storage" description="wheeljack preferences and durable workspace state are stored in this local app-data directory.">
                <div className="flex min-w-0 items-start gap-3">
                  <code className="min-w-0 flex-1 break-all text-xs text-muted-foreground">{appDataDir ?? "Connecting…"}</code>
                  <Button variant="outline" size="sm" disabled={!appDataDir} onClick={() => {
                    if (!appDataDir) return;
                    void navigator.clipboard.writeText(appDataDir)
                      .then(() => setStorageStatus("Storage path copied."))
                      .catch(() => setStorageStatus("Could not copy the storage path."));
                  }}>Copy path</Button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" disabled={backupBusy} onClick={() => void exportBackup()}>
                    {backupBusy ? <><DotMatrixLoader size={16} />Exporting…</> : "Export backup"}
                  </Button>
                  <Button variant="outline" onClick={() => {
                    void navigator.clipboard.writeText(diagnosticsReport)
                      .then(() => setStorageStatus("Diagnostics copied."))
                      .catch(() => setStorageStatus("Could not copy diagnostics."));
                  }}>Copy diagnostics</Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Backups stay local. Diagnostics exclude credentials and transcript content.</p>
                {storageStatus && <p className="mt-3 text-sm text-muted-foreground" role="status">{storageStatus}</p>}
              </SettingsCard>
              <SettingsCard danger title="Reset preferences" description="Restore appearance, workspace, shortcuts, and coding-agent profiles to their defaults.">
                <Button variant="destructive" disabled={resettingPreferences} onClick={() => void onResetAll()}>
                  {resettingPreferences ? <><DotMatrixLoader size={16} />Resetting…</> : "Reset all"}
                </Button>
                {preferencesStatus && <p className="mt-3 text-sm text-muted-foreground" role="status">{preferencesStatus}</p>}
              </SettingsCard>
            </>
          )}
        </main>
      </ScrollArea>
      <AlertDialog open={deleteThemeOpen} onOpenChange={(open) => {
        setDeleteThemeOpen(open);
        if (!open) setReplacementThemeId("");
      }}>
        <AlertDialogContent className="wj-dialog wj-dialog-medium">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{selectedTheme.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedThemeIsAssigned
                ? `Choose the ${selectedTheme.variant} theme wheeljack should use anywhere this theme is assigned.`
                : `Choose the ${selectedTheme.variant} theme to show after this custom theme is deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label>Replace with</Label>
            <div className="mt-2 grid max-h-72 grid-cols-1 gap-2 overflow-y-auto p-0.5 sm:grid-cols-2">
              {replacementThemes.map((theme) => <ThemeChoice key={theme.id} theme={theme} selected={theme.id === replacementThemeId} onClick={() => setReplacementThemeId(theme.id)} />)}
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={!replacementThemeId} onClick={removeTheme}>Delete theme</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(pendingThemeImport)} onOpenChange={(open) => !open && setPendingThemeImport(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Choose a terminal scheme</AlertDialogTitle>
            <AlertDialogDescription>This file contains several Windows Terminal schemes. Choose one to import and apply.</AlertDialogDescription>
          </AlertDialogHeader>
          <Select value={pendingThemeIndex} onValueChange={setPendingThemeIndex}>
            <SelectTrigger aria-label="Terminal scheme"><SelectValue /></SelectTrigger>
            <SelectContent>{pendingThemeImport?.themes.map((theme, index) => <SelectItem key={`${theme.name}-${index}`} value={String(index)}>{theme.name}</SelectItem>)}</SelectContent>
          </Select>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const theme = pendingThemeImport?.themes[Number(pendingThemeIndex)];
              if (pendingThemeImport && theme) applyThemeImport(pendingThemeImport, theme);
              setPendingThemeImport(undefined);
            }}>Import scheme</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={vsCodeThemes.length > 0} onOpenChange={(open) => !open && setVsCodeThemes([])}>
        <AlertDialogContent className="wj-dialog wj-dialog-medium">
          <AlertDialogHeader>
            <AlertDialogTitle>Import from VS Code</AlertDialogTitle>
            <AlertDialogDescription>Choose from the color themes installed in your local VS Code extensions.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input aria-label="Search VS Code themes" placeholder="Search themes or extensions…" value={vsCodeThemeQuery} onChange={(event) => setVsCodeThemeQuery(event.target.value)} />
          <ScrollArea className="wj-vscode-theme-list">
            {vsCodeThemes
              .filter((theme) => `${theme.label} ${theme.extension}`.toLowerCase().includes(vsCodeThemeQuery.trim().toLowerCase()))
              .map((theme) => <button type="button" aria-pressed={theme.path === vsCodeThemePath} className="wj-vscode-theme-option" key={theme.path} onClick={() => setVsCodeThemePath(theme.path)}><strong>{theme.label}</strong><small>{theme.extension}</small></button>)}
            {vsCodeThemes.every((theme) => !`${theme.label} ${theme.extension}`.toLowerCase().includes(vsCodeThemeQuery.trim().toLowerCase())) && <p className="p-3 text-sm text-muted-foreground">No matching themes.</p>}
          </ScrollArea>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!vsCodeThemePath} onClick={() => void importVsCodeTheme()}>Import theme</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ThemePreview({ theme, preferences }: { theme: ThemeDefinition; preferences: UiPreferences }) {
  const color = compileTheme(theme);
  const preview = {
    "--wj-preview-canvas": color.canvas,
    "--wj-preview-sidebar": color.sidebar,
    "--wj-preview-chrome": color.chrome,
    "--wj-preview-surface": color.surface,
    "--wj-preview-raised": color.raised,
    "--wj-preview-border": color.border,
    "--wj-preview-text": color.text,
    "--wj-preview-muted": color.muted,
    "--wj-preview-accent": color.accent,
    "--wj-preview-accent-foreground": color.accentForeground,
    "--wj-preview-success": color.success,
    "--wj-preview-warning": color.warning,
    "--wj-preview-terminal": color.terminalBackground,
    "--wj-preview-terminal-text": color.terminalForeground,
    "--wj-preview-heading-font": preferences.headingFontFamily,
    "--wj-preview-ui-font": preferences.uiFontFamily,
    "--wj-preview-code-font": preferences.codeFontFamily,
    "--wj-preview-ui-size": `${Math.max(8, preferences.uiFontSize * .72)}px`,
    "--wj-preview-code-size": `${Math.max(7, preferences.terminalFontSize * .62)}px`,
  } as React.CSSProperties;
  return (
    <aside className="wj-appearance-preview" aria-label="Appearance preview">
      <div className="wj-workspace-preview-label"><span>Preview</span><small>Updates as you edit</small></div>
      <div className="wj-appearance-preview-frame" style={preview} aria-hidden="true">
        <nav>
          <strong>WJ</strong>
          <span className="selected"><i />Home</span>
          <span><i />Work</span>
          <span><i />Plan</span>
          <small>PROJECTS</small>
          <span>wheeljack</span>
        </nav>
        <section>
          <header><span>codex · main</span><b>− &nbsp; □</b></header>
          <div className="wj-appearance-preview-terminal">
            <span>PS C:\wheeljack&gt; codex</span>
            <p>Inspecting workspace and coordinating agents…</p>
            <em>Ready</em>
          </div>
          <footer><span>Route a prompt to active agents…</span><b>↵</b></footer>
        </section>
        <div className="wj-appearance-preview-rail">
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="wj-appearance-preview-meta"><strong>{theme.name}</strong><span>{theme.isBuiltIn ? "Built-in" : "Custom"} · {theme.variant}</span></div>
    </aside>
  );
}

function ThemeChoice({ theme, selected, onClick }: { theme: ThemeDefinition; selected: boolean; onClick: () => void }) {
  const color = compileTheme(theme);
  const preview = {
    "--preview-canvas": color.canvas,
    "--preview-sidebar": color.sidebar,
    "--preview-chrome": color.chrome,
    "--preview-surface": color.surface,
    "--preview-text": color.text,
    "--preview-muted": color.muted,
    "--preview-accent": color.accent,
    "--preview-success": color.success,
    "--preview-warning": color.warning,
    "--preview-danger": color.danger,
    "--preview-terminal": color.terminalBackground,
    "--preview-terminal-text": color.terminalForeground,
  } as React.CSSProperties;
  return <button type="button" aria-pressed={selected} className={`wj-theme-choice ${selected ? "selected" : ""}`} onClick={onClick}><span aria-hidden className="wj-theme-choice-preview" style={preview}><span className="wj-theme-choice-preview-sidebar" /><span className="wj-theme-choice-preview-main"><span className="wj-theme-choice-preview-chrome" /><span className="wj-theme-choice-preview-terminal" /><span className="wj-theme-choice-preview-composer" /></span><span className="wj-theme-choice-preview-rail"><span /><span /><span /><span /></span></span><strong>{theme.name}</strong><small>{theme.isBuiltIn ? theme.variant === "dark" ? "Dark" : "Light" : `Custom · ${theme.variant === "dark" ? "Dark" : "Light"}`}</small></button>;
}

function ThemeColorField({ label, value, disabled, contrastAgainst, onChange, onReset }: { label: string; value: string; disabled: boolean; contrastAgainst?: string; onChange: (value: string) => void; onReset?: () => void }) {
  return <ColorPickerPopover label={label} value={value} disabled={disabled} contrastAgainst={contrastAgainst} onChange={onChange} onReset={onReset} />;
}

function seedContrastReference(key: keyof ThemeDefinition["seed"], theme: ThemeDefinition): string | undefined {
  if (key === "canvas" || key === "surface") return theme.seed.text;
  if (key === "text") return theme.seed.canvas;
  if (key === "muted") return theme.seed.surface;
  return undefined;
}

function paletteContrastReference(key: string, theme: ThemeDefinition): string | undefined {
  const palette = compileTheme(theme);
  if (key === "text") return palette.canvas;
  if (key === "muted" || key === "subtle") return palette.surface;
  if (key === "accentForeground") return palette.accent;
  if (key === "terminalForeground" || key === "cursor") return palette.terminalBackground;
  return undefined;
}

function ShortcutSettings({ bindings, onBindings }: { bindings: ShortcutBindings; onBindings: (bindings: ShortcutBindings) => void }) {
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<ShortcutAction>();
  const [status, setStatus] = useState("Select a shortcut field, then press the new key combination. Backspace clears it.");
  const visible = shortcutDefinitions.filter(({ label, group }) => `${label} ${group}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = [...new Set(visible.map(({ group }) => group))];
  const assign = (action: ShortcutAction, binding: string) => {
    const conflict = shortcutConflict(bindings, action, binding);
    if (conflict) {
      setStatus(`${formatShortcut(binding)} is already assigned to ${conflict.label}.`);
      return;
    }
    onBindings({ ...bindings, [action]: binding });
    setStatus(binding ? `${shortcutDefinitions.find(({ id }) => id === action)?.label} set to ${formatShortcut(binding)}.` : "Shortcut cleared.");
    setRecording(undefined);
  };
  return (
    <SettingsCard wide title="Keyboard shortcuts" description="Bindings are local to wheeljack and persist with your desktop preferences.">
      <div className="mb-4 flex items-center gap-3">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" aria-label="Search shortcuts" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands" /></div>
        <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl/Cmd, Alt, or F-key required</span>
      </div>
      <p className="mb-3 min-h-5 text-xs text-muted-foreground" role="status" aria-live="polite">{status}</p>
      <div className="divide-y divide-border rounded-md border">
        {groups.map((group) => <section key={group} aria-labelledby={`shortcut-group-${group.toLowerCase()}`}>
          <h3 id={`shortcut-group-${group.toLowerCase()}`} className="border-b bg-muted/35 px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group}</h3>
          <div className="divide-y divide-border">{visible.filter((definition) => definition.group === group).map((definition) => {
            const binding = bindings[definition.id];
            return <div className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(180px,1fr)_minmax(180px,240px)_auto]" key={definition.id}>
              <label className="flex min-w-0 items-center gap-2 text-sm" htmlFor={`shortcut-${definition.id}`}><Key className="size-4 shrink-0 text-muted-foreground" /><span>{definition.label}</span></label>
              <Input
                id={`shortcut-${definition.id}`}
                data-shortcut-recorder=""
                readOnly
                aria-label={`Shortcut for ${definition.label}`}
                className="cursor-default font-mono"
                value={recording === definition.id ? "Press shortcut…" : formatShortcut(binding)}
                onFocus={() => { setRecording(definition.id); setStatus(`Recording ${definition.label}. Press Escape to cancel.`); }}
                onBlur={() => setRecording((current) => current === definition.id ? undefined : current)}
                onKeyDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.key === "Escape") { event.currentTarget.blur(); return; }
                  if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.metaKey && !event.altKey) { assign(definition.id, ""); return; }
                  const next = bindingFromKeyboardEvent(event);
                  if (!next) return;
                  if (!isBindableShortcut(next)) { setStatus("Add Ctrl/Cmd or Alt, or use an F-key, so ordinary typing remains available."); return; }
                  assign(definition.id, next);
                  event.currentTarget.blur();
                }}
              />
              <div className="flex justify-end gap-1"><Button variant="ghost" size="xs" disabled={!binding} onClick={() => assign(definition.id, "")}>Clear</Button><Button variant="ghost" size="xs" disabled={binding === definition.defaultBinding} onClick={() => assign(definition.id, definition.defaultBinding)}>Reset</Button></div>
            </div>;
          })}</div>
        </section>)}
        {visible.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No matching shortcuts.</p>}
      </div>
    </SettingsCard>
  );
}

function SettingsCard({ title, description, action, danger = false, wide = false, children }: { title: string; description: string; action?: React.ReactNode; danger?: boolean; wide?: boolean; children: React.ReactNode }) {
  return <section className={`wj-settings-group ${danger ? "wj-settings-danger" : ""} ${wide ? "wj-settings-group-wide" : ""}`}><header><div><h2>{title}</h2><p>{description}</p></div>{action}</header><div className="wj-settings-group-content">{children}</div></section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function SliderField({ label, value, min, max, step = 1, suffix = "px", onValue }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onValue: (value: number) => void }) {
  return <div className="space-y-2"><div className="flex justify-between text-sm text-muted-foreground"><Label>{label}</Label><span className="font-mono">{value}{suffix}</span></div><Slider aria-label={label} value={[value]} min={min} max={max} step={step} onValueChange={([next]) => onValue(next)} /></div>;
}

function FontField({ ariaLabel, value, options, onValue }: { ariaLabel: string; value: string; options: string[]; onValue: (value: string) => void }) {
  return <div className="flex"><Input className="rounded-r-none" aria-label={ariaLabel} value={value} onChange={(event) => onValue(event.target.value)} /><DropdownMenu><DropdownMenuTrigger asChild><Button className="-ml-px rounded-l-none" variant="outline" size="icon" disabled={!options.length} aria-label={`Choose ${ariaLabel.toLowerCase()}`}><ChevronDownIcon /></Button></DropdownMenuTrigger><DropdownMenuContent className="max-h-64 min-w-64" align="end">{options.map((option) => <DropdownMenuCheckboxItem key={option} checked={option === value} onSelect={() => onValue(option)} style={{ fontFamily: option }}>{option}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu></div>;
}

function ToggleSetting({ label, description, checked, onChecked }: { label: string; description?: string; checked: boolean; onChecked: (checked: boolean) => void }) {
  const id = `wj-setting-${label.toLowerCase().replaceAll(" ", "-")}`;
  return <div className="wj-toggle-setting"><div><Label htmlFor={id}>{label}</Label>{description && <p>{description}</p>}</div><Switch id={id} aria-label={label} checked={checked} onCheckedChange={onChecked} /></div>;
}

export function UtilityPanelSurface({
  open,
  compact,
  tab,
  historyPage,
  width,
  runtimes,
  attention,
  activity,
  sessions,
  sessionSearchResults,
  sessionSearchBusy,
  git,
  diff,
  opsState,
  onOpenChange,
  onTab,
  onHistoryPage,
  onWidth,
  onOpenAttention,
  onOpenActivity,
  onOpenSession,
  onSearchSessions,
  onQueryRuntime,
  onResumeRuntime,
  onReviewTranscript,
  onRespondRuntime,
  onAcknowledgeAttention,
  onAcknowledgeAll,
  onRefreshGit,
  onOpenTaskLane,
  onResolveTaskLane,
  onClearActivity,
  onClearTranscripts,
}: {
  open: boolean;
  compact: boolean;
  tab: UtilityPanelTab;
  historyPage: "activity" | "sessions";
  width: number;
  runtimes: PaneRuntime[];
  attention: AttentionItem[];
  activity: ActivityEvent[];
  sessions: Session[];
  sessionSearchResults: SessionSearchResult[];
  sessionSearchBusy: boolean;
  git?: GitStatus;
  diff?: GitDiff;
  opsState: OpsState;
  onOpenChange: (open: boolean) => void;
  onTab: (tab: UtilityPanelTab) => void;
  onHistoryPage: (page: "activity" | "sessions") => void;
  onWidth: (width: number) => void;
  onOpenAttention: (item: AttentionItem) => void;
  onOpenActivity: (event: ActivityEvent) => void;
  onOpenSession: (session: Session | SessionSearchResult) => void;
  onSearchSessions: (query: string) => void;
  onQueryRuntime: (runtime: PaneRuntime) => void;
  onResumeRuntime: (runtime: PaneRuntime) => void;
  onReviewTranscript: (runtime: PaneRuntime) => void;
  onRespondRuntime: (runtime: PaneRuntime, approved: boolean) => void;
  onAcknowledgeAttention: (item: AttentionItem) => void;
  onAcknowledgeAll: () => void;
  onRefreshGit: () => void;
  onOpenTaskLane: (card: OpsCard) => void;
  onResolveTaskLane: (card: OpsCard) => void;
  onClearActivity: () => void;
  onClearTranscripts: () => void;
}) {
  const [sessionQuery, setSessionQuery] = useState("");
  const [submittedSessionQuery, setSubmittedSessionQuery] = useState("");
  const [clearActivityOpen, setClearActivityOpen] = useState(false);
  const [clearTranscriptsOpen, setClearTranscriptsOpen] = useState(false);
  const runtimeById = new Map(runtimes.map((runtime) => [runtime.nodeId, runtime]));
  const inboxCount = attention.length;
  const unreadInboxCount = new Set(attention.flatMap((item) => item.activityIds)).size;
  const hasAdditionalWorktrees = Boolean(git && (git.worktrees.length > 1 || opsState.cards.some((card) => card.taskLane && !card.taskLane.closedAt)));
  const gitEmpty = !git || !git.isRepo || (git.changedFiles.length === 0 && !diff?.text && !hasAdditionalWorktrees);
  const searchingSessions = Boolean(submittedSessionQuery);
  const sessionRows = searchingSessions ? sessionSearchResults : sessions;
  const content = (
    <>
      <Tabs className="wj-utility-tabs" value={tab} onValueChange={(value) => onTab(value as UtilityPanelTab)}>
      <div className="wj-utility-header">
        <TabsList variant="line">
          <TabsTrigger value="inbox"><Bell />Inbox{inboxCount > 0 && <Badge>{inboxCount}</Badge>}</TabsTrigger>
          <TabsTrigger value="git"><GitBranch />Git</TabsTrigger>
          <TabsTrigger value="history"><History />History</TabsTrigger>
        </TabsList>
        <Button aria-label="Close utility panel" variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)}><X /></Button>
      </div>
      <TabsContent value="inbox">
        <ScrollArea className={`wj-drawer-body wj-inbox-body${inboxCount === 0 ? " wj-drawer-body-empty" : ""}`}>
          <div className={`wj-drawer-list wj-inbox-list${inboxCount === 0 ? " wj-drawer-empty" : ""}`}>
            <div className="wj-inbox-toolbar"><div><h3>Needs attention</h3><span aria-live="polite" aria-label={`${inboxCount} ${inboxCount === 1 ? "item" : "items"}`}>{inboxCount}</span></div>{unreadInboxCount > 0 && <Button size="xs" variant="ghost" onClick={onAcknowledgeAll}><CheckIcon />Mark all read</Button>}</div>
            {attention.map((item) => {
              const runtime = item.runtimeNodeId ? runtimeById.get(item.runtimeNodeId) : undefined;
              const interaction = runtime ? pendingAgentInteraction(runtime.messages) : undefined;
              const submitting = interaction?.interactionState === "submitting";
              const actions: ActionCardAction[] = interaction?.kind === "approval" && runtime ? [
                { id: "deny", label: "Deny", intent: "secondary", disabled: submitting, onInvoke: () => onRespondRuntime(runtime, false) },
                { id: "approve", label: "Approve", intent: "primary", disabled: submitting, pending: submitting, onInvoke: () => onRespondRuntime(runtime, true) },
              ] : interaction?.kind === "question" ? [
                { id: "answer", label: "Answer in chat", intent: "primary", onInvoke: () => onOpenAttention(item) },
              ] : runtime && ["failed", "disconnected"].includes(runtime.status) ? [
                { id: "open", label: "Open", intent: "secondary", onInvoke: () => onOpenAttention(item) },
                { id: "resume", label: "Resume", intent: "primary", onInvoke: () => onResumeRuntime(runtime) },
              ] : [{ id: "open", label: "Open", intent: "primary", onInvoke: () => onOpenAttention(item) }];
              const inboxCard = interaction
                ? <ActionCard compact variant="decision" decisionType={interaction.kind === "question" ? "question" : "approval"} interactionState={interaction.interactionState} title={item.title} summary={interaction.text || item.detail} metadata={item.sources.join(" · ")} actions={actions} />
                : runtime && ["failed", "disconnected"].includes(runtime.status)
                  ? <ActionCard compact variant="recovery" status={runtime.status} title={item.title} error={item.detail} metadata={item.sources.join(" · ")} actions={actions} />
                  : <ActionCard compact variant="recommendation" status={item.status} title={item.title} recommendation="Inspect this intervention" rationale={item.detail} metadata={item.sources.join(" · ")} actions={actions} />;
              return <ContextMenu key={item.id}>
                <ContextMenuTrigger asChild><div className="wj-inbox-item">{inboxCard}</div></ContextMenuTrigger>
                <ContextMenuContent className="min-w-48">
                  <ContextMenuItem onSelect={() => onOpenAttention(item)}>{interaction?.kind === "question" ? "Answer in chat" : "Open"}</ContextMenuItem>
                  {interaction?.kind === "approval" && <><ContextMenuItem disabled={submitting} onSelect={() => onRespondRuntime(runtime!, false)}><X />Deny</ContextMenuItem><ContextMenuItem disabled={submitting} onSelect={() => onRespondRuntime(runtime!, true)}><CheckIcon />Approve</ContextMenuItem></>}
                  {runtime && <><ContextMenuSeparator /><ContextMenuItem onSelect={() => onQueryRuntime(runtime)}><RefreshCw />Refresh status</ContextMenuItem><ContextMenuItem onSelect={() => onReviewTranscript(runtime)}><Terminal />Review transcript</ContextMenuItem>{["failed", "disconnected"].includes(runtime.status) && <ContextMenuItem onSelect={() => onResumeRuntime(runtime)}><Play />Resume agent</ContextMenuItem>}</>}
                  {item.activityIds.length > 0 && <ContextMenuItem onSelect={() => onAcknowledgeAttention(item)}><CheckIcon />Acknowledge</ContextMenuItem>}
                  <DevToolsContextItem />
                </ContextMenuContent>
              </ContextMenu>;
            })}
            {inboxCount === 0 && <Empty icon={<CheckIcon />} title="Inbox clear" detail="Nothing needs you right now. Approvals, questions, and failures will appear here." />}
          </div>
        </ScrollArea>
      </TabsContent>
      <TabsContent value="git">
        <ScrollArea className={`wj-drawer-body${gitEmpty ? " wj-drawer-body-empty" : ""}`}>
          <div className={`wj-drawer-sections${gitEmpty ? " wj-drawer-empty" : ""}`}>
            <div className="wj-drawer-toolbar"><span>{git?.changedFiles.length ?? 0} changed files</span><Button size="xs" variant="ghost" onClick={onRefreshGit}><RefreshCw />Refresh</Button></div>
            {!git
              ? <Empty icon={<DotMatrixLoader variant="compile" size={18} />} title="Checking repository" detail="Loading the latest working-tree status." />
              : !git.isRepo
                ? <Empty icon={<GitBranch />} title="Not a Git repository" detail="Git changes will appear here after this project is initialized as a repository." />
                : <>
                    {hasAdditionalWorktrees && <Suspense fallback={<div className="wj-drawer-group"><DotMatrixLoader size={16} />Loading worktrees…</div>}><TaskWorktreeList git={git} cards={opsState.cards} onOpenTask={onOpenTaskLane} onResolveTask={onResolveTaskLane} /></Suspense>}
                    {git.changedFiles.length
                      ? <section className="wj-drawer-group"><div className="wj-drawer-group-heading"><h3>Working tree</h3><span>{git.changedFiles.length}</span></div><div>{git.changedFiles.map((file) => <ContextMenu key={file}><ContextMenuTrigger asChild><div className="wj-file-row"><FileCode2 /><span>{file}</span></div></ContextMenuTrigger><ContextMenuContent><ContextMenuItem onSelect={() => void navigator.clipboard.writeText(file)}><Files />Copy relative path</ContextMenuItem><ContextMenuItem onSelect={onRefreshGit}><RefreshCw />Refresh Git</ContextMenuItem><DevToolsContextItem /></ContextMenuContent></ContextMenu>)}</div></section>
                      : !hasAdditionalWorktrees && <Empty icon={<CheckIcon />} title="Working tree clean" detail={`No uncommitted changes on ${git.branch || "the current branch"}.`} />}
                  </>}
            {diff?.text && <section className="wj-drawer-group"><div className="wj-drawer-group-heading"><h3>Diff</h3></div><pre className="wj-diff">{diff.text}</pre></section>}
          </div>
        </ScrollArea>
      </TabsContent>
      <TabsContent value="history">
        <div className="wj-history-surface">
          <Tabs value={historyPage} onValueChange={(value) => onHistoryPage(value as "activity" | "sessions")}>
            <TabsList variant="line" aria-label="History sections">
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="sessions">Sessions</TabsTrigger>
            </TabsList>
          {historyPage === "activity" ? (
            <TabsContent value="activity" asChild><ScrollArea className={`wj-drawer-body${activity.length === 0 ? " wj-drawer-body-empty" : ""}`}>
              <div className={`wj-drawer-sections${activity.length === 0 ? " wj-drawer-empty" : ""}`}>
                <div className="wj-drawer-toolbar"><span>{activity.length} recent events</span><Button size="xs" variant="ghost" disabled={!activity.length} onClick={() => setClearActivityOpen(true)}><Trash2 />Clear activity</Button></div>
                {activity.length ? <div className="wj-history-list">{activity.map((item) => <ContextMenu key={item.id}><ContextMenuTrigger asChild><div className="contents"><ActivityRow item={item} onOpen={() => onOpenActivity(item)} /></div></ContextMenuTrigger><ContextMenuContent><ContextMenuItem onSelect={() => onOpenActivity(item)}><History />Open activity</ContextMenuItem><DevToolsContextItem /></ContextMenuContent></ContextMenu>)}</div> : <Empty icon={<History />} title="No activity yet" detail="Project, agent, routing, and recovery events will collect here as you work." />}
              </div>
            </ScrollArea></TabsContent>
          ) : (
            <TabsContent value="sessions" asChild><ScrollArea className={`wj-drawer-body${sessionRows.length === 0 ? " wj-drawer-body-empty" : ""}`}>
              <div className={`wj-drawer-sections${sessionRows.length === 0 ? " wj-drawer-empty" : ""}`}>
                <form className="wj-session-search" onSubmit={(event) => {
                  event.preventDefault();
                  const query = sessionQuery.trim();
                  setSubmittedSessionQuery(query);
                  onSearchSessions(query);
                }}>
                  <Input
                    aria-label="Search session transcripts"
                    value={sessionQuery}
                    onChange={(event) => {
                      const query = event.target.value;
                      setSessionQuery(query);
                      if (query.trim() !== submittedSessionQuery) {
                        setSubmittedSessionQuery("");
                        onSearchSessions("");
                      }
                    }}
                    placeholder="Search transcripts"
                  />
                  <Button type="submit" size="sm" variant="secondary" disabled={!sessionQuery.trim() || sessionSearchBusy}><Search />Search</Button>
                </form>
                <div className="wj-drawer-toolbar">
                  <span className="wj-inline-status" aria-live="polite">{sessionSearchBusy && <DotMatrixLoader size={16} />}{sessionSearchBusy ? "Searching sessions…" : `${sessionRows.length} ${searchingSessions ? "matches" : "sessions"}`}</span>
                  <Button size="xs" variant="ghost" disabled={!sessions.some((session) => Boolean(session.chunkCount))} onClick={() => setClearTranscriptsOpen(true)}><Trash2 />Clear transcripts</Button>
                </div>
                {sessionRows.length ? <div className="wj-session-history-list">{sessionRows.map((item) => {
                  const sessionId = "sessionId" in item ? item.sessionId : item.id;
                  const preview = "snippet" in item ? item.snippet : item.transcriptPreview;
                  return <ContextMenu key={sessionId}><ContextMenuTrigger asChild><button className="wj-session-history-row" type="button" data-session-id={sessionId} onClick={() => onOpenSession(item)}>
                    <span><strong>{resolveAgentLabel(item.nodeTitle)}</strong><time>{formatTime(item.startedAt)}</time></span>
                    <small>{item.adapterId} · {resolveRunState(item.status).label}</small>
                    {preview && <p>{preview}</p>}
                  </button></ContextMenuTrigger><ContextMenuContent><ContextMenuItem onSelect={() => onOpenSession(item)}><Terminal />Open session</ContextMenuItem><DevToolsContextItem /></ContextMenuContent></ContextMenu>;
                })}</div> : <Empty icon={<Terminal />} title={searchingSessions ? "No matching sessions" : "No sessions yet"} detail={searchingSessions ? "Try a different transcript search." : "Shell and agent sessions will appear here with their saved transcripts."} />}
              </div>
            </ScrollArea></TabsContent>
          )}
          </Tabs>
        </div>
      </TabsContent>
      </Tabs>
      <AlertDialog open={clearActivityOpen} onOpenChange={setClearActivityOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all activity?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the recorded project, terminal, agent, routing, and recovery events.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onClearActivity}>Clear activity</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={clearTranscriptsOpen} onOpenChange={setClearTranscriptsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all saved transcripts?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes transcript content from session history. Activity events and session metadata remain.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onClearTranscripts}>Clear transcripts</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
  if (compact) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent id="utility-panel" className="wj-drawer wj-utility-sheet" side="right" showCloseButton={false} style={{ "--wj-drawer-width": `${width}px` } as React.CSSProperties}>
          <SheetTitle className="sr-only">Utilities</SheetTitle>
          <SheetDescription className="sr-only">Inbox, Git, and project history.</SheetDescription>
          {content}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <aside id="utility-panel" className="wj-utility-panel" data-open={open} aria-label="Utility panel" aria-hidden={!open} inert={!open} style={{ "--wj-utility-panel-width": `${width}px` } as React.CSSProperties}>
      {open && <div className="wj-drawer-resizer" role="separator" tabIndex={0} aria-label="Resize utility panel" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={560} aria-valuenow={width} onPointerDown={(event) => beginHorizontalResize(event, width, 320, 560, -1, onWidth)} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); onWidth(Math.min(560, Math.max(320, width + (event.key === "ArrowLeft" ? 8 : -8)))); } }} />}
      <div className="wj-utility-panel-inner">{open && content}</div>
    </aside>
  );
}

export function TranscriptDrawerSurface({
  transcript,
  onLoadOlder,
  onClose,
}: {
  transcript?: {
    title: string;
    sessionId: string;
    adapterId: string;
    cwd: string;
    status: string;
    text: string;
    chunkCount: number;
    totalChunkCount: number;
    hasMore: boolean;
    loadingOlder?: boolean;
  };
  onLoadOlder: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={Boolean(transcript)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="wj-drawer wj-transcript-drawer" side="right">
        <SheetHeader>
          <SheetTitle>{transcript?.title ?? "Session transcript"}</SheetTitle>
          <SheetDescription>{transcript ? `${transcript.adapterId} · ${resolveRunState(transcript.status).label} · ${transcript.chunkCount} of ${transcript.totalChunkCount} chunks` : "Saved session transcript"}</SheetDescription>
        </SheetHeader>
        {transcript && <ScrollArea className="wj-drawer-body">
          <div className="wj-transcript-meta"><code>{transcript.cwd}</code><code>{transcript.sessionId}</code></div>
          {transcript.hasMore && <Button type="button" variant="outline" size="sm" disabled={transcript.loadingOlder} onClick={onLoadOlder}>{transcript.loadingOlder ? "Loading earlier output…" : "Load earlier output"}</Button>}
          <pre className="wj-transcript-content" tabIndex={0} aria-label={`${transcript.title} transcript`}>{transcript.text || "No transcript content was saved."}</pre>
        </ScrollArea>}
      </SheetContent>
    </Sheet>
  );
}

// Kept during state migration while persisted verification runs and recovery callbacks remain supported.
// oxlint-disable-next-line eslint(no-unused-vars)
function LegacyReviewDrawerSurface({
  reviewCard,
  reviewEvidenceReady,
  reviewEvidenceMessage,
  evidence,
  hasFileConflict,
  verificationBusy,
  onClose,
  onReviewAction,
  onStartReviewer,
  onRunVerification,
  onCancelVerification,
  onViewVerificationOutput,
  onRequestChanges,
  onUpdateContract,
}: {
  reviewCard?: OpsCard;
  reviewEvidenceReady: boolean;
  reviewEvidenceMessage: string;
  evidence?: OpsReviewEvidence;
  hasFileConflict: boolean;
  verificationBusy: boolean;
  onClose: () => void;
  onReviewAction: (approved: boolean) => Promise<void>;
  onStartReviewer: (card: OpsCard) => Promise<boolean>;
  onRunVerification: (card: OpsCard) => Promise<void>;
  onCancelVerification: (card: OpsCard) => Promise<void>;
  onViewVerificationOutput: (card: OpsCard) => Promise<void>;
  onRequestChanges: (card: OpsCard, feedback: string) => Promise<boolean>;
  onUpdateContract: (card: OpsCard, change: OpsTaskEditablePatch) => void;
}) {
  const [drawerWidth, setDrawerWidth] = useState(480);
  const [feedback, setFeedback] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [changesBusy, setChangesBusy] = useState(false);
  const [changesError, setChangesError] = useState("");
  const [reviewerBusy, setReviewerBusy] = useState(false);
  const [reviewerError, setReviewerError] = useState("");
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [definitionDraft, setDefinitionDraft] = useState("");
  const [constraintsDraft, setConstraintsDraft] = useState("");
  const [verificationDraft, setVerificationDraft] = useState("");
  const [reviewPolicyDraft, setReviewPolicyDraft] = useState<OpsTaskContractDraft["reviewPolicy"]>("agent");
  const verdict = reviewCard ? opsReviewVerdict(reviewCard) : undefined;
  const contractIssues = reviewCard ? opsVerificationContractIssues(reviewCard) : [];
  useEffect(() => {
    setDefinitionDraft(reviewCard?.definitionOfDone ?? "");
    setConstraintsDraft(reviewCard?.constraints ?? "");
    setVerificationDraft(reviewCard?.verificationCommand ?? "");
    setReviewPolicyDraft(reviewCard?.reviewPolicy ?? "agent");
    setFeedback(verdict?.status === "changes_requested"
      ? verdict.message
      : ["failed", "canceled", "interrupted"].includes(reviewCard?.verificationRun?.status ?? "")
        ? reviewCard?.verificationRun?.message ?? "Verification needs to be rerun."
        : "");
    setFeedbackOpen(verdict?.status === "changes_requested");
  }, [reviewCard?.id, reviewCard?.definitionOfDone, reviewCard?.constraints, reviewCard?.verificationCommand, reviewCard?.reviewPolicy, reviewCard?.verificationRun?.status, reviewCard?.verificationRun?.message, verdict?.status, verdict?.message]);
  const contractDirty = Boolean(reviewCard && (
    definitionDraft !== (reviewCard.definitionOfDone ?? "")
    || constraintsDraft !== (reviewCard.constraints ?? "")
    || verificationDraft !== (reviewCard.verificationCommand ?? "")
    || reviewPolicyDraft !== (reviewCard.reviewPolicy ?? "agent")
  ));
  const staleReason = reviewCard && reviewEvidenceReady
    ? opsVerificationStaleReason(reviewCard, evidence?.snapshotId)
    : undefined;
  const approval = reviewCard
    ? opsVerificationApproval(reviewCard, hasFileConflict, reviewEvidenceReady ? evidence?.snapshotId : undefined, "human")
    : { ready: false };
  const verificationStatus = staleReason
    ? "Verification stale"
    : reviewCard?.verificationRun?.status === "running"
      ? "Verification running"
      : reviewCard?.verificationRun?.status === "passed"
        ? "Verification passed"
        : reviewCard?.verificationRun?.status === "failed"
          ? "Verification failed"
          : reviewCard?.verificationRun?.status === "canceled"
            ? "Verification canceled"
            : reviewCard?.verificationRun?.status === "interrupted"
              ? "Verification interrupted"
              : "Verification not run";
  const reviewRecommendation = contractIssues.length > 0 || hasFileConflict
    ? "Resolve blockers"
    : verdict?.status === "changes_requested"
      ? "Request changes"
      : staleReason || reviewCard?.verificationRun?.status !== "passed"
        ? "Run verification"
        : approval.ready
          ? "Approve verification"
          : "Resolve blockers";
  const recommendationReason = reviewRecommendation === "Run verification"
    ? staleReason ?? reviewCard?.verificationRun?.message ?? "A current passing verification run is required."
    : reviewRecommendation === "Approve verification"
      ? "The task contract, review evidence, repository snapshot, and verification run are current."
      : reviewRecommendation === "Request changes"
        ? verdict?.message ?? "The reviewer recorded changes that must be addressed."
        : approval.reason ?? contractIssues[0] ?? (hasFileConflict ? "Resolve the claimed-file conflict before approval." : "Review evidence is incomplete.");
  const submitReviewChanges = () => {
    if (!reviewCard || !feedback.trim() || changesBusy || approvalBusy) return;
    setChangesBusy(true);
    setChangesError("");
    void onRequestChanges(reviewCard, feedback).then((started) => {
      if (started) {
        setFeedback("");
        setFeedbackOpen(false);
      }
    }).catch((cause) => setChangesError(cause instanceof Error ? cause.message : String(cause))).finally(() => setChangesBusy(false));
  };
  const recommendationActions: ActionCardAction[] = reviewCard ? [
    {
      id: "changes",
      label: feedbackOpen ? "Start fresh worker" : "Request changes",
      intent: reviewRecommendation === "Request changes" ? "primary" : "secondary",
      disabled: feedbackOpen && !feedback.trim(),
      pending: changesBusy,
      onInvoke: () => feedbackOpen ? submitReviewChanges() : setFeedbackOpen(true),
    },
    ...(reviewRecommendation === "Run verification" ? [{
      id: "verify",
      label: "Run verification",
      intent: "primary" as const,
      disabled: verificationBusy || reviewCard.verificationRun?.status === "running" || !reviewCard.taskLane || Boolean(reviewCard.taskLane.closedAt) || !reviewCard.verificationCommand?.trim(),
      pending: verificationBusy,
      onInvoke: () => void onRunVerification(reviewCard),
    }] : reviewRecommendation === "Approve verification" ? [{
      id: "approve",
      label: "Approve verification",
      intent: "primary" as const,
      disabled: !reviewEvidenceReady || !approval.ready || changesBusy || approvalBusy || verificationBusy,
      pending: approvalBusy,
      onInvoke: () => {
        setApprovalBusy(true);
        void onReviewAction(true).finally(() => setApprovalBusy(false));
      },
    }] : []),
  ] : [];
  if (reviewCard?.report) {
    const humanAcceptance = reviewCard.reviewPolicy === "human" && reviewCard.reconciliation?.status === "needs_human";
    return <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="wj-drawer" side="right" style={{ "--wj-drawer-width": `${drawerWidth}px` } as React.CSSProperties}>
        <div className="wj-drawer-resizer" role="separator" tabIndex={0} aria-label="Resize task evidence" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={760} aria-valuenow={drawerWidth} onPointerDown={(event) => beginHorizontalResize(event, drawerWidth, 320, 760, -1, setDrawerWidth)} />
        <SheetHeader><SheetTitle>Task evidence</SheetTitle><SheetDescription>Worker evidence and objective-level reconciliation state.</SheetDescription></SheetHeader>
        <ScrollArea className="wj-drawer-body"><div className="wj-drawer-review">
          <ActionCard variant="evidence" title={reviewCard.title} summary={reviewCard.detail} source="worker report" status="completed">
            <div className="wj-section-label">Report</div><p className="mt-2 text-sm">{reviewCard.report.summary}</p>
            {reviewCard.report.evidence && <p className="mt-3 text-sm text-muted-foreground">{reviewCard.report.evidence}</p>}
            {reviewCard.report.checks.length > 0 && <div className="wj-floor-inspector-checks mt-4">{reviewCard.report.checks.map((check) => <span data-passed key={check}><CheckIcon />{check}</span>)}</div>}
            {reviewCard.report.risks.length > 0 && <div className="wj-inspector-warning mt-4"><CircleDot />{reviewCard.report.risks.join(" · ")}</div>}
          </ActionCard>
          <ActionCard variant="evidence" title="Reconciliation" summary={reviewCard.reconciliation?.message || "Waiting for reconciliation."} source="wheeljack core" status={reviewCard.reconciliation?.status === "integrated" ? "completed" : humanAcceptance ? "review" : "verifying"}>
            {reviewCard.taskLane && <div className="wj-transcript-meta"><code>{reviewCard.taskLane.branch}</code><code>{reviewCard.taskLane.baseCommit.slice(0, 10)}</code><code>{reviewCard.taskLane.worktreePath}</code></div>}
          </ActionCard>
          <ActionCard variant="evidence" title="Repository evidence" summary={reviewEvidenceMessage} source={reviewCard.taskLane ? "task worktree" : "shared checkout"} status={reviewEvidenceReady ? "completed" : "pending"} detailLabel={evidence?.changedFiles.length ? `Show ${evidence.changedFiles.length} changed ${evidence.changedFiles.length === 1 ? "file" : "files"}` : "Show repository evidence"} details={<>{evidence?.changedFiles.map((file) => <div className="wj-file-row" key={file}><Files />{file}</div>)}{evidence?.text && <pre className="wj-diff mt-3">{evidence.text}</pre>}</>} />
        </div></ScrollArea>
        {humanAcceptance && <div className="wj-drawer-footer wj-review-recommendation"><ActionCard variant="recommendation" title="Explicit acceptance" status="review" recommendation="Accept or request changes" rationale="This task was configured to require a human decision." actions={[
          { id: "changes", label: feedbackOpen ? "Start fresh worker" : "Request changes", intent: "secondary", disabled: feedbackOpen && !feedback.trim(), pending: changesBusy, onInvoke: () => feedbackOpen ? submitReviewChanges() : setFeedbackOpen(true) },
          { id: "accept", label: "Accept and reconcile", intent: "primary", pending: approvalBusy, disabled: approvalBusy, onInvoke: () => { setApprovalBusy(true); void onReviewAction(true).finally(() => setApprovalBusy(false)); } },
        ]}>{feedbackOpen && <div className="space-y-2"><Textarea autoFocus aria-label="Review feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="What must change?" />{changesError && <p className="text-sm text-destructive" role="alert">{changesError}</p>}</div>}</ActionCard></div>}
      </SheetContent>
    </Sheet>;
  }
  return (
    <Sheet open={Boolean(reviewCard)} onOpenChange={(open) => {
      if (open) return;
      setFeedback("");
      setChangesError("");
      setReviewerError("");
      onClose();
    }}>
      <SheetContent className="wj-drawer" side="right" style={{ "--wj-drawer-width": `${drawerWidth}px` } as React.CSSProperties}>
        <div className="wj-drawer-resizer" role="separator" tabIndex={0} aria-label="Resize task review" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={760} aria-valuenow={drawerWidth} onPointerDown={(event) => beginHorizontalResize(event, drawerWidth, 320, 760, -1, setDrawerWidth)} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setDrawerWidth((current) => Math.min(760, Math.max(320, current + (event.key === "ArrowLeft" ? 8 : -8)))); } }} />
        <SheetHeader><SheetTitle>Task review</SheetTitle><SheetDescription>Inspect agent handoff and repository evidence before approval.</SheetDescription></SheetHeader>
        <ScrollArea className="wj-drawer-body">
          {reviewCard && (
            <div className="wj-drawer-review">
              <ActionCard variant="evidence" title={reviewCard.title} summary={reviewCard.detail} source="task contract" status={contractIssues.length ? "blocked" : "completed"}>
                <div className="wj-section-label">Verification handoff</div>
                <p className="mt-2 text-sm">{reviewCard.lastNote || "No verification handoff was reported."}</p>
                {verdict && <div className={`wj-inspector-warning mt-4 ${verdict.status === "approved" ? "border-success/40" : ""}`}><CircleDot />{verdict.status === "approved" ? "Agent reviewer approved this task." : "Agent reviewer requested changes."}</div>}
                {reviewCard.approvalAttempt && <div className="wj-inspector-warning mt-4"><CircleDot />{reviewCard.approvalAttempt.status === "retrying" ? "Automatic approval will retry" : "Automatic approval is blocked"}: {reviewCard.approvalAttempt.message}</div>}
                <div className="mt-4 space-y-3">
                  <div><Label htmlFor="review-definition">Definition of done</Label><Textarea id="review-definition" value={definitionDraft} onChange={(event) => setDefinitionDraft(event.target.value)} placeholder="Observable acceptance criteria" /></div>
                  <div><Label htmlFor="review-constraints">Constraints</Label><Textarea id="review-constraints" value={constraintsDraft} onChange={(event) => setConstraintsDraft(event.target.value)} placeholder="Boundaries and compatibility requirements" /></div>
                  <div><Label htmlFor="review-verification">Verification command</Label><Input className="font-mono" id="review-verification" value={verificationDraft} onChange={(event) => setVerificationDraft(event.target.value)} placeholder="bun run test" /></div>
                  <div><Label>Review policy</Label><Select value={reviewPolicyDraft} onValueChange={(value) => setReviewPolicyDraft(value as OpsTaskContractDraft["reviewPolicy"])}><SelectTrigger aria-label="Review policy"><SelectValue /></SelectTrigger><SelectContent><ReviewPolicyOptions /></SelectContent></Select></div>
                  {contractIssues.length > 0 && <p className="text-sm text-destructive" role="alert">{contractIssues.join(" · ")}</p>}
                  <Button variant="outline" disabled={!contractDirty || !definitionDraft.trim() || !verificationDraft.trim()} onClick={() => onUpdateContract(reviewCard, {
                    definitionOfDone: definitionDraft.trim(),
                    constraints: constraintsDraft.trim(),
                    verificationCommand: verificationDraft.trim(),
                    reviewPolicy: reviewPolicyDraft,
                  })}>Save contract</Button>
                </div>
              </ActionCard>
              <ActionCard variant="evidence" title="Verification run" summary={verificationStatus} source="verification session" status={staleReason ? "review" : reviewCard.verificationRun?.status ?? "pending"} actions={[
                ...(reviewCard.verificationRun?.status === "running" ? [{ id: "cancel", label: "Cancel verification", intent: "secondary" as const, disabled: verificationBusy, onInvoke: () => void onCancelVerification(reviewCard) }] : []),
                ...(reviewCard.verificationRun?.sessionId ? [{ id: "output", label: "View verification output", intent: "secondary" as const, onInvoke: () => void onViewVerificationOutput(reviewCard) }] : []),
              ]}>
                {reviewCard.verificationRun && <div className="wj-transcript-meta"><code>{reviewCard.verificationRun.sessionId}</code><code>{reviewCard.verificationRun.exitCode ?? "running"}</code><code>{reviewCard.verificationRun.snapshotId?.slice(0, 12) ?? "No snapshot"}</code></div>}
                {reviewCard.verificationRun?.message && <p className="mt-3 text-sm text-muted-foreground">{reviewCard.verificationRun.message}</p>}
                {(!reviewCard.taskLane || reviewCard.taskLane.closedAt) && <p className="mt-3 text-xs text-muted-foreground">Shared-checkout tasks use Complete with override.</p>}
                {reviewCard.taskLane && !reviewCard.taskLane.closedAt && !reviewCard.verificationCommand?.trim() && <p className="mt-3 text-xs text-destructive">Save a verification command above to start this run.</p>}
              </ActionCard>
              <ActionCard
                variant="evidence"
                title="Repository evidence"
                summary={reviewEvidenceMessage}
                source={reviewCard.taskLane ? "task worktree" : "shared checkout"}
                status={reviewEvidenceMessage.startsWith("Loading") || reviewEvidenceMessage.startsWith("Revalidating") ? "verifying" : reviewEvidenceReady ? "completed" : "pending"}
                detailLabel={evidence?.changedFiles.length ? `Show ${evidence.changedFiles.length} changed ${evidence.changedFiles.length === 1 ? "file" : "files"}` : "Show repository evidence"}
                details={<>{evidence?.changedFiles.map((file) => <div className="wj-file-row" key={file}><Files />{file}</div>)}{evidence?.text && <pre className="wj-diff mt-3">{evidence.text}</pre>}</>}
                actions={[{ id: "reviewer", label: reviewCard.reviewerId && !verdict ? "Reviewer running" : verdict ? "Send another reviewer" : "Send fresh reviewer", intent: "secondary", disabled: reviewerBusy || Boolean(reviewCard.taskLane?.closedAt) || Boolean(reviewCard.reviewerId && !verdict), pending: reviewerBusy, onInvoke: () => { setReviewerBusy(true); setReviewerError(""); void onStartReviewer(reviewCard).catch((cause) => setReviewerError(cause instanceof Error ? cause.message : String(cause))).finally(() => setReviewerBusy(false)); } }]}
              >
                {reviewCard.taskLane && <div className="wj-transcript-meta"><code>{evidence?.branch ?? reviewCard.taskLane.branch}</code><code>{(evidence?.baseCommit ?? reviewCard.taskLane.baseCommit).slice(0, 10)}</code><code>{evidence?.worktreePath ?? reviewCard.taskLane.worktreePath}</code></div>}
                {reviewerError && <p className="mt-2 text-sm text-destructive" role="alert">{reviewerError}</p>}
              </ActionCard>
            </div>
          )}
        </ScrollArea>
        {reviewCard && <div className="wj-drawer-footer wj-review-recommendation max-h-[min(440px,58vh)] overflow-y-auto"><ActionCard
          variant="recommendation"
          title="Recommended next step"
          status={reviewRecommendation === "Approve verification" ? "verified" : "review"}
          recommendation={reviewRecommendation}
          rationale={feedbackOpen ? undefined : recommendationReason}
          actions={recommendationActions}
        >
          {feedbackOpen && <div className="space-y-2"><Textarea className="max-h-40 overflow-y-auto" autoFocus aria-label="Review feedback" value={feedback} onChange={(event) => { setFeedback(event.target.value); setChangesError(""); }} placeholder="What must change before approval?" />{changesError && <p className="text-sm text-destructive" role="alert">{changesError}</p>}</div>}
        </ActionCard></div>}
      </SheetContent>
    </Sheet>
  );
}

export function ReviewDrawerSurface({
  reviewCard,
  reviewEvidenceReady,
  reviewEvidenceMessage,
  evidence,
  onClose,
  onReviewAction,
  onRequestChanges,
}: {
  reviewCard?: OpsCard;
  reviewEvidenceReady: boolean;
  reviewEvidenceMessage: string;
  evidence?: OpsReviewEvidence;
  hasFileConflict?: boolean;
  verificationBusy?: boolean;
  onClose: () => void;
  onReviewAction: (approved: boolean) => Promise<void>;
  onStartReviewer?: (card: OpsCard) => Promise<boolean>;
  onRunVerification?: (card: OpsCard) => Promise<void>;
  onCancelVerification?: (card: OpsCard) => Promise<void>;
  onViewVerificationOutput?: (card: OpsCard) => Promise<void>;
  onRequestChanges: (card: OpsCard, feedback: string) => Promise<boolean>;
  onUpdateContract?: (card: OpsCard, change: OpsTaskEditablePatch) => void;
}) {
  const [drawerWidth, setDrawerWidth] = useState(480);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const humanAcceptance = reviewCard?.reviewPolicy === "human";
  const retryableReconciliation = reviewCard?.reconciliation?.status === "needs_human"
    && ["target_dirty", "error"].includes(reviewCard.reconciliation.reason ?? "");
  const requestChanges = () => {
    if (!reviewCard || !feedback.trim()) return;
    setBusy(true);
    setError("");
    void onRequestChanges(reviewCard, feedback).then((started) => {
      if (started) setFeedback("");
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false));
  };
  return <Sheet open={Boolean(reviewCard)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent className="wj-drawer" side="right" style={{ "--wj-drawer-width": `${drawerWidth}px` } as React.CSSProperties}>
      <div className="wj-drawer-resizer" role="separator" tabIndex={0} aria-label="Resize task evidence" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={760} aria-valuenow={drawerWidth} onPointerDown={(event) => beginHorizontalResize(event, drawerWidth, 320, 760, -1, setDrawerWidth)} />
      <SheetHeader><SheetTitle>Task evidence</SheetTitle><SheetDescription>Worker results and automatic reconciliation state.</SheetDescription></SheetHeader>
      {reviewCard && <ScrollArea className="wj-drawer-body"><div className="wj-drawer-review">
        <ActionCard variant="evidence" title={reviewCard.title} summary={reviewCard.report?.summary || reviewCard.lastNote || reviewCard.detail} source={reviewCard.report ? "worker report" : "legacy handoff"} status="completed">
          {reviewCard.report?.evidence && <p className="mt-3 text-sm text-muted-foreground">{reviewCard.report.evidence}</p>}
          {reviewCard.report && reviewCard.report.checks.length > 0 && <div className="wj-floor-inspector-checks mt-4">{reviewCard.report.checks.map((check) => <span data-passed key={check}><CheckIcon />{check}</span>)}</div>}
          {reviewCard.report && reviewCard.report.risks.length > 0 && <div className="wj-inspector-warning mt-4"><CircleDot />{reviewCard.report.risks.join(" · ")}</div>}
        </ActionCard>
        <ActionCard variant="evidence" title="Reconciliation" summary={reviewCard.reconciliation?.message || "Queued for automatic reconciliation."} source="wheeljack core" status={reviewCard.reconciliation?.status === "integrated" ? "completed" : reviewCard.reconciliation?.status === "needs_human" ? "review" : "verifying"}>
          {reviewCard.taskLane && <div className="wj-transcript-meta"><code>{reviewCard.taskLane.branch}</code><code>{reviewCard.taskLane.baseCommit.slice(0, 10)}</code><code>{reviewCard.taskLane.worktreePath}</code></div>}
        </ActionCard>
        <ActionCard variant="evidence" title="Repository evidence" summary={reviewEvidenceMessage} source={reviewCard.taskLane ? "task worktree" : "shared checkout"} status={reviewEvidenceReady ? "completed" : "pending"} detailLabel={evidence?.changedFiles.length ? `Show ${evidence.changedFiles.length} changed ${evidence.changedFiles.length === 1 ? "file" : "files"}` : "Show repository evidence"} details={<>{evidence?.changedFiles.map((file) => <div className="wj-file-row" key={file}><Files />{file}</div>)}{evidence?.text && <pre className="wj-diff mt-3">{evidence.text}</pre>}</>} />
      </div></ScrollArea>}
      {reviewCard && (humanAcceptance || reviewCard.reconciliation?.status === "needs_human") && <div className="wj-drawer-footer space-y-2">
        {!retryableReconciliation && <Textarea aria-label="Task feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Describe what the worker should repair…" />}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">{!retryableReconciliation && <Button variant="outline" disabled={busy || !feedback.trim()} onClick={requestChanges}>Send repair task</Button>}{(humanAcceptance || retryableReconciliation) && <Button disabled={busy} onClick={() => { setBusy(true); void onReviewAction(true).finally(() => setBusy(false)); }}>{humanAcceptance ? "Accept and reconcile" : "Retry reconciliation"}</Button>}</div>
      </div>}
    </SheetContent>
  </Sheet>;
}

function Empty({ title, detail, action, icon = <Inbox />, compact = false }: { title: string; detail: string; action?: React.ReactNode; icon?: React.ReactNode; compact?: boolean }) {
  return <div className={`wj-empty${compact ? " compact" : ""}`}><span className="wj-empty-icon" aria-hidden>{icon}</span><strong>{title}</strong><p>{detail}</p>{action}</div>;
}

function formatTime(value?: string): string {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function beginHorizontalResize(
  event: React.PointerEvent<HTMLElement>,
  value: number,
  min: number,
  max: number,
  direction: 1 | -1,
  onValue: (value: number) => void,
  onCollapsed?: (collapsed: boolean) => void,
) {
  event.preventDefault();
  const pointerId = event.pointerId;
  const startX = event.clientX;
  let next = value;
  let collapsed = false;
  let frame = 0;
  document.documentElement.dataset.resizing = "columns";
  document.documentElement.dataset.resizingWidth = "";
  const move = (pointer: globalThis.PointerEvent) => {
    if (pointer.pointerId !== pointerId) return;
    const result = panelResizeResult(value + (pointer.clientX - startX) * direction, min, max, Boolean(onCollapsed));
    next = result.value;
    if (result.collapse !== collapsed && onCollapsed) {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      collapsed = result.collapse;
      delete document.documentElement.dataset.resizingWidth;
      onCollapsed(collapsed);
      return;
    }
    if (collapsed) return;
    document.documentElement.dataset.resizingWidth = "";
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onValue(Math.round(next));
    });
  };
  const stop = (pointer: globalThis.PointerEvent) => {
    if (pointer.pointerId !== pointerId) return;
    if (frame) cancelAnimationFrame(frame);
    if (!collapsed) onValue(Math.round(next));
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    delete document.documentElement.dataset.resizingWidth;
    delete document.documentElement.dataset.resizing;
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

export function panelResizeResult(raw: number, min: number, max: number, collapsible: boolean) {
  return {
    value: Math.min(max, Math.max(min, raw)),
    collapse: collapsible && raw < min - 12,
  };
}

export const FLOOR_RAIL_MIN_WIDTH = 340;
export const FLOOR_RAIL_MAX_WIDTH = 680;
export const FLOOR_RAIL_DEFAULT_WIDTH = 420;

export function normalizeFloorRailWidth(value: unknown) {
  return Math.min(FLOOR_RAIL_MAX_WIDTH, Math.max(FLOOR_RAIL_MIN_WIDTH, typeof value === "number" && Number.isFinite(value) ? value : FLOOR_RAIL_DEFAULT_WIDTH));
}

export const defaultUiPreferences: UiPreferences = {
  theme: "graphite",
  appearanceMode: "fixed",
  fixedThemeId: "mono-dark",
  systemLightThemeId: "mono-light",
  systemDarkThemeId: "mono-dark",
  customThemes: [],
  showStickerLensBackground: true,
  headingFontFamily: "Geist Pixel",
  uiFontFamily: "Geist Variable",
  codeFontFamily: "JetBrains Mono Variable",
  uiScale: 1,
  uiFontSize: 13,
  terminalFontSize: 13,
  sidebarCollapsed: false,
  expandedProjectIds: [],
  lastCanvasByProject: {},
  floorRailWidthByProject: {},
  sidebarWidth: 240,
  utilityPanelWidth: 400,
  utilityPanelTab: "inbox",
  showPaneActions: true,
  showProjectPaths: true,
  showRecentActivity: true,
  showAgentRail: true,
};

const defaultInterfacePreferences: Partial<UiPreferences> = {
  sidebarCollapsed: false,
  expandedProjectIds: [],
  floorRailWidthByProject: {},
  sidebarWidth: 240,
  utilityPanelWidth: 400,
  utilityPanelTab: "inbox",
  showPaneActions: true,
  showProjectPaths: true,
  showRecentActivity: true,
  showAgentRail: true,
};

import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
