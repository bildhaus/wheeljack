import { Activity, AI, Article, Bell, Book, Briefcase, Building, CheckIcon, Checklist, ChevronRight, CircleDot, Cloud, FileCode2, Files, Flag, Folder, GitBranch, GitHub, Globe, History, Home, Inbox, Inventory, Key, Layers, LayoutDashboard, LibraryBooks, Lightning, Link, Map as MapIcon, Maximize2, Memory, Minus, MonitorCog, Monitor, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pin, Play, Plus, RefreshCw, Search, Server, Spark, Settings, Star, Swatch, Target, Terminal, Trash2, X } from "./SargamIcon";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "./components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "./components/ui/card";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "./components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./components/ui/dropdown-menu";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { ScrollArea } from "./components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "./components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Textarea } from "./components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import { ColorPickerPopover } from "./ColorPickerPopover";
import { ActionCard, type ActionCardAction } from "./ActionCard";
import { AgentAvatar } from "./AgentAvatar";
import { RunStateBadge } from "./RunStateBadge";
import { sessionBelongsToProject } from "./projectSessions";
import { resolveAgentLabel } from "./agentIdentity";
import { resolveRunState } from "./runState";
import { DotMatrixLoader } from "./DotMatrixLoader";
import { opsCardParticipantIds } from "./opsPresence";
import { adapterReadinessLabel, canVerifyAdapter } from "./adapterReadiness";
import { isLiveSessionStatus, isTerminalSessionStatus } from "./agentRuntime";
import { pendingAgentInteraction, type AttentionItem } from "./attention";

const TaskWorktreeList = lazy(() => import("./TaskWorktreeList"));
import type { UpdateController } from "./updater";
import type { ActivityEvent, Adapter, AgentAccessMode, BotProfile, GitDiff, GitStatus, OpsCard, OpsOrchestrationAction, OpsReviewEvidence, OpsState, PaneRuntime, Project, RoutePreview, Session, SessionSearchResult, UiPreferences, UtilityPanelTab } from "./types";

export type ShellSurface = "home" | "bots" | "usage" | "terminal" | "ops" | "settings";
type ProjectSurface = Extract<ShellSurface, "terminal" | "ops">;
export type OpsPage = "floor" | "board" | "spec";
export type SettingsPage = "appearance" | "workspace" | "shortcuts" | "agents" | "application";

export function DevToolsContextItem() {
  if (!import.meta.env.DEV) return null;
  return <><ContextMenuSeparator /><ContextMenuItem onSelect={() => void invoke("open_devtools").catch((cause) => console.error("Could not open DevTools.", cause))}><MonitorCog />Open DevTools</ContextMenuItem></>;
}

export const settingsPageDetails: Record<SettingsPage, { title: string; description: string }> = {
  appearance: { title: "Appearance", description: "Choose themes, typography, and terminal colors." },
  workspace: { title: "Workspace", description: "Control visible workspace elements and layout density." },
  shortcuts: { title: "Shortcuts", description: "Customize app commands without stealing ordinary terminal input." },
  agents: { title: "Agents", description: "Configure installed coding agents and their launch defaults." },
  application: { title: "Application", description: "Inspect this build, local storage, and preference recovery." },
};

export const reviewPolicyLabels = {
  agent: "Automatic reconciliation",
  human: "Require human acceptance",
  either: "Automatic or human",
} as const;

export function ReviewPolicyOptions() {
  return <>{Object.entries(reviewPolicyLabels).map(([value, label]) => <SelectItem value={value} key={value}>{label}</SelectItem>)}</>;
}

export interface PendingOpsAction {
  card: OpsCard;
  action: OpsOrchestrationAction;
  targetColumnId?: string;
  agentId?: string;
  preview?: RoutePreview;
  busy?: boolean;
  error?: string;
}

export function formatOpsElapsed(startedAt: string | undefined, stoppedAt: string | undefined, now: number): string | undefined {
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

export function formatOpsRelative(value: string | undefined, now: number): string | undefined {
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

export function opsActionTitle(action: OpsOrchestrationAction, _card: OpsCard): string {
  if (action === "assign") return "Start task agent";
  if (action === "transfer") return "Transfer ownership";
  if (action === "resume") return "Resume work";
  if (action === "review") return "Inspect evidence";
  if (action === "pause") return "Request pause";
  if (action === "release") return "Return to Ready";
  if (action === "approve") return "Approve verification";
  return "Complete with override";
}

export function taskWorkspaceLabel(card: OpsCard, projectIsRepo?: boolean): string {
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

export function ProjectGlyph({ icon, color, className = "" }: { icon: string; color: string; className?: string }) {
  const Glyph = projectIconOptions.find((option) => option.value === icon)?.Icon ?? Folder;
  return <Glyph className={className} style={{ color }} />;
}

export function opsCardDisplayStatus(lane: string, runtimeStatuses: string[], verificationStatus?: string, paused?: boolean): string {
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
  const characters = useMemo(() => Array.from(title), [title]);
  const instantEntry = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.projectEmptyInstant === "true").current;
  const [typedCharacterCount, setTypedCharacterCount] = useState(0);
  const typedCharacterCountRef = useRef(0);
  const typewriterTimersRef = useRef<number[]>([]);
  const typewriterDelays = useMemo(() => projectEmptyTypewriterDelays(title), [title]);
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
  }, [characters.length, instantEntry, title, typewriterDelays]);
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
      <Item disabled={disabled} variant="destructive" onSelect={() => onRemove(project)}><Trash2 />Remove from wheeljack…</Item>
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
            const live = sessions.filter((session) => sessionBelongsToProject(session, item) && isLiveSessionStatus(session.status)).length;
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
  currentProject,
  sessions,
  activity,
  attention,
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
  currentProject?: Project;
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
          <Metric value={live.length} label="Live sessions" />
          <Metric value={attention.length} label="Inbox" accent onClick={onInbox} />
          <Metric value={projects.filter((item) => item.dirty).length} label="Dirty projects" />
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
        {projects.length > 0 && <section className="wj-command-row" aria-label={currentProject ? `Quick starts for ${currentProject.name}` : "Open a project to use quick starts"}>
          <button className="wj-quick-launch" disabled={!agentReady || !currentProject || loading} onClick={onResearch}><Search /><span><strong>Research{currentProject ? ` ${currentProject.name}` : " a project"}</strong><small>Spawn a research lane and turn findings into scoped tasks.</small></span></button>
          <button className="wj-quick-launch" disabled={!agentReady || !currentProject || loading} onClick={onBootstrapPlan}><LayoutDashboard /><span><strong>Bootstrap plan{currentProject ? ` for ${currentProject.name}` : " for a project"}</strong><small>Analyze this project and propose PRD, TDD, and Kanban files together.</small></span></button>
        </section>}
      </div>
      <div className={`wj-home-grid ${showRecentActivity ? "" : "single"}`}>
        <section className="wj-home-panel">
          <SectionHeading title="Active projects" />
          <ScrollArea className="wj-home-scroll">
            <div className="wj-project-list">
              {projects.map((item) => {
                const projectLive = live.filter((session) => sessionBelongsToProject(session, item)).length;
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
                        : <Button disabled={busy} onClick={onRescan}><RefreshCw />Scan all</Button>}
                  <Button variant="outline" disabled={busy} onClick={onAgentSettings}><Settings />Agent Settings</Button>
                </div>
                {readiness === "Sign in" && repairCommand && <p className="wj-onboarding-note">Sign-in opens in Work. Return Home and scan again when it finishes.</p>}
                <OnboardingShellAction working={busy} onStartShell={startShell} />
              </>
            )}
            {step === 3 && (
              <>
                <div className="wj-onboarding-trust">
                  <MonitorCog aria-hidden />
                  <div>
                    <strong>Agent coordination stays under your control.</strong>
                    <p>wheeljack lets agents discover peers automatically, but asks before messaging, spawning children, handing off work, requesting review, or resolving conflicts. Approved actions can create additional provider usage; limits and policies are available in Settings → Agents.</p>
                  </div>
                </div>
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

export function SectionHeading({ title, action, className = "" }: { title: string; action?: React.ReactNode; className?: string }) {
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
                {!searchingSessions && sessions.length >= 100 && <p className="wj-session-history-boundary">Showing the latest 100 sessions. Transcript search includes older sessions.</p>}
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

export function Empty({ title, detail, action, icon = <Inbox />, compact = false }: { title: string; detail: string; action?: React.ReactNode; icon?: React.ReactNode; compact?: boolean }) {
  return <div className={`wj-empty${compact ? " compact" : ""}`}><span className="wj-empty-icon" aria-hidden>{icon}</span><strong>{title}</strong><p>{detail}</p>{action}</div>;
}

export function formatTime(value?: string): string {
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

import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type OpsTaskEditablePatch = Partial<Pick<OpsCard, "title" | "detail" | "definitionOfDone" | "constraints" | "verificationCommand" | "reviewPolicy">>;
