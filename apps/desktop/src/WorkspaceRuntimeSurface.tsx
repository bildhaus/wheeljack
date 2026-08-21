import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AgentChat } from "./AgentChat";
import { agentCompositionFromNode, type AgentCompositionState } from "./agentComposition";
import { PaneAgentMenuItems, type TerminalAgentContext } from "./PaneAgentMenuItems";
import { ProviderMark } from "./ProviderMark";
import { RunStateBadge } from "./RunStateBadge";
import { TerminalSurface } from "./TerminalSurface";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "./components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Input } from "./components/ui/input";
import { Columns2, Maximize2, MonitorCog, MoreHorizontal, Plus, X } from "./SargamIcon";
import { isRoutineWorkingState } from "./runState";
import { paneDropPosition } from "./paneDrop";
import { formatShortcut, matchesShortcut, type ShortcutBindings } from "./shortcuts";
import { pasteData } from "./terminalFrame";
import { useEventCallback } from "./useEventCallback";
import type {
  AgentAccessMode,
  AgentImageAttachment,
  AgentProfile,
  CanvasNode,
  JsonObject,
  OpsCard,
  PaneRuntime,
  SplitAxis,
  SplitNode,
} from "./types";

function DevToolsContextItem() {
  if (!import.meta.env.DEV) return null;
  return <><ContextMenuSeparator /><ContextMenuItem onSelect={() => void invoke("open_devtools").catch((cause) => console.error("Could not open DevTools.", cause))}><MonitorCog />Open DevTools</ContextMenuItem></>;
}

function supportsAttachedTerminal(runtime: Pick<PaneRuntime, "structured" | "protocol" | "capabilities">): boolean {
  return runtime.structured && (runtime.capabilities?.attachedTerminal ?? runtime.protocol === "opencode-sse");
}

function stringValue(value: JsonObject, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function joinPath(base: string, segment: string): string {
  return base ? `${base}.${segment}` : segment;
}

interface SplitViewProps {
  node: SplitNode;
  path: string;
  nodes: Record<string, CanvasNode>;
  runtimes: Record<string, PaneRuntime>;
  agentContexts: Record<string, TerminalAgentContext>;
  agentProfiles: AgentProfile[];
  projectRoot?: string;
  agentAccess?: AgentAccessMode;
  focusedPaneId: string | null;
  zoomedPaneId?: string | null;
  chatViews: Set<string>;
  showPaneActions: boolean;
  shortcuts: ShortcutBindings;
  onFocus: (id: string) => void;
  onOpenOpsCard: (card: OpsCard) => void;
  onClose: (id: string) => void;
  onSplit?: (id: string, axis: SplitAxis) => void;
  onZoom?: (id: string) => void;
  onMove?: (source: string, target: string, axis?: SplitAxis, before?: boolean) => void;
  onSaveData?: (node: CanvasNode, data: JsonObject) => void;
  onAgentComposition?: (node: CanvasNode, composition: AgentCompositionState) => void;
  onToggleView: (runtime: PaneRuntime) => void;
  onRatio: (path: string, ratio: number) => void;
  onWrite: (runtime: PaneRuntime, data: string | Uint8Array) => void;
  onResize: (runtime: PaneRuntime, rows: number, cols: number) => void;
  onViewport: (runtime: PaneRuntime, offset: number) => void;
  onPaint: (runtime: PaneRuntime, milliseconds: number) => void;
  onResizePaint: (milliseconds: number) => void;
  onPrompt: (runtime: PaneRuntime, prompt: string, images?: AgentImageAttachment[]) => Promise<boolean>;
  onRespond: (runtime: PaneRuntime, approved: boolean, response?: string) => Promise<boolean>;
  onCancel: (runtime: PaneRuntime) => Promise<boolean>;
  onAgentAccess: (agentAccess: AgentAccessMode) => Promise<void>;
  onAgentProfile: (adapterId: string, patch: Partial<AgentProfile>) => void;
  onRepair?: (runtime: PaneRuntime) => void;
  onResume?: (runtime: PaneRuntime) => void;
  onPrepareHandoff?: (runtime: PaneRuntime) => void;
  onReviewTranscript?: (runtime: PaneRuntime) => void;
  onQueryStatus?: (runtime: PaneRuntime) => void;
  onLoadOlderHistory?: (runtime: PaneRuntime) => Promise<void>;
}

export function SplitView(props: SplitViewProps) {
  const { node } = props;
  if (node.type === "leaf") {
    const pane = props.nodes[node.paneId];
    const runtime = props.runtimes[node.paneId];
    if (!pane) return null;
    return (
      <Pane
        key={pane.id}
        node={pane}
        runtime={runtime}
        agentContext={props.agentContexts[pane.id]}
        agentProfile={props.agentProfiles.find((profile) => profile.adapterId === runtime?.adapterId)}
        projectRoot={props.projectRoot}
        agentAccess={props.agentAccess}
        focused={props.focusedPaneId === pane.id}
        zoomed={props.zoomedPaneId === pane.id}
        chatView={props.chatViews.has(pane.id)}
        showPaneActions={props.showPaneActions}
        shortcuts={props.shortcuts}
        onFocus={() => props.onFocus(pane.id)}
        onOpenOpsCard={props.onOpenOpsCard}
        onClose={() => props.onClose(pane.id)}
        onSplit={(axis) => props.onSplit?.(pane.id, axis)}
        onZoom={() => props.onZoom?.(pane.id)}
        onMove={(target, axis, before) => props.onMove?.(pane.id, target, axis, before)}
        onSaveData={(data) => props.onSaveData?.(pane, data)}
        onAgentComposition={(composition) => props.onAgentComposition?.(pane, composition)}
        onToggleView={() => runtime && props.onToggleView(runtime)}
        onWrite={(data) => runtime && props.onWrite(runtime, data)}
        onResize={(rows, cols) => runtime && props.onResize(runtime, rows, cols)}
        onViewport={(offset) => runtime && props.onViewport(runtime, offset)}
        onPaint={(milliseconds) => runtime && props.onPaint(runtime, milliseconds)}
        onResizePaint={props.onResizePaint}
        onPrompt={(prompt, images) => runtime ? props.onPrompt(runtime, prompt, images) : Promise.resolve(false)}
        onRespond={(approved, response) => runtime ? props.onRespond(runtime, approved, response) : Promise.resolve(false)}
        onCancel={() => runtime ? props.onCancel(runtime) : Promise.resolve(false)}
        onAgentAccess={props.onAgentAccess}
        onAgentProfile={props.onAgentProfile}
        onRepair={() => runtime && props.onRepair?.(runtime)}
        onResume={() => runtime && props.onResume?.(runtime)}
        onPrepareHandoff={() => runtime && props.onPrepareHandoff?.(runtime)}
        onReviewTranscript={() => runtime && props.onReviewTranscript?.(runtime)}
        onQueryStatus={() => runtime && props.onQueryStatus?.(runtime)}
        onLoadOlderHistory={() => runtime ? props.onLoadOlderHistory?.(runtime) ?? Promise.resolve() : Promise.resolve()}
      />
    );
  }
  const direction = node.axis === "columns" ? "row" : "column";
  return (
    <div className="split" style={{ flexDirection: direction }}>
      <div className="split-child" style={{ flexGrow: node.ratio }}>
        <SplitView {...props} node={node.first} path={joinPath(props.path, "first")} />
      </div>
      <Divider
        axis={node.axis}
        ratio={node.ratio}
        onRatio={(ratio) => props.onRatio(props.path, ratio)}
      />
      <div className="split-child" style={{ flexGrow: 1 - node.ratio }}>
        <SplitView {...props} node={node.second} path={joinPath(props.path, "second")} />
      </div>
    </div>
  );
}

function Divider({
  axis,
  ratio,
  onRatio,
}: {
  axis: SplitAxis;
  ratio: number;
  onRatio: (ratio: number) => void;
}) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const split = event.currentTarget.parentElement;
    if (!split) return;
    const rect = split.getBoundingClientRect();
    const pointerId = event.pointerId;
    let pendingRatio = ratio;
    let frame = 0;
    document.documentElement.dataset.resizing = axis;
    const move = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      pendingRatio = axis === "columns"
        ? (pointer.clientX - rect.left) / rect.width
        : (pointer.clientY - rect.top) / rect.height;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        onRatio(pendingRatio);
      });
    };
    const up = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      if (frame) cancelAnimationFrame(frame);
      onRatio(pendingRatio);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      delete document.documentElement.dataset.resizing;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", up, { once: true });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decrease = axis === "columns" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const increase = axis === "columns" ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!decrease && !increase) return;
    event.preventDefault();
    onRatio(ratio + (increase ? 0.04 : -0.04));
  };
  return (
    <div
      className={`divider ${axis}`}
      role="separator"
      tabIndex={0}
      aria-label={`Resize ${axis}`}
      aria-orientation={axis === "columns" ? "vertical" : "horizontal"}
      aria-valuemin={15}
      aria-valuemax={85}
      aria-valuenow={Math.round(ratio * 100)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

function Pane({
  node,
  runtime,
  agentContext,
  agentProfile,
  projectRoot,
  agentAccess,
  focused,
  zoomed,
  chatView,
  showPaneActions,
  shortcuts,
  onFocus,
  onOpenOpsCard,
  onClose,
  onSplit,
  onZoom,
  onMove,
  onSaveData,
  onAgentComposition,
  onToggleView,
  onWrite,
  onResize,
  onViewport,
  onPaint,
  onResizePaint,
  onPrompt,
  onRespond,
  onCancel,
  onLoadOlderHistory,
  onAgentAccess,
  onAgentProfile,
  onRepair,
  onResume,
  onPrepareHandoff,
  onReviewTranscript,
  onQueryStatus,
}: {
  node: CanvasNode;
  runtime?: PaneRuntime;
  agentContext?: TerminalAgentContext;
  agentProfile?: AgentProfile;
  projectRoot?: string;
  agentAccess?: AgentAccessMode;
  focused: boolean;
  zoomed: boolean;
  chatView: boolean;
  showPaneActions: boolean;
  shortcuts: ShortcutBindings;
  onFocus: () => void;
  onOpenOpsCard: (card: OpsCard) => void;
  onClose: () => void;
  onSplit: (axis: SplitAxis) => void;
  onZoom: () => void;
  onMove: (source: string, axis?: SplitAxis, before?: boolean) => void;
  onSaveData: (data: JsonObject) => void;
  onAgentComposition: (composition: AgentCompositionState) => void;
  onToggleView: () => void;
  onWrite: (data: string | Uint8Array) => void;
  onResize: (rows: number, cols: number) => void;
  onViewport: (offset: number) => void;
  onPaint: (milliseconds: number) => void;
  onResizePaint: (milliseconds: number) => void;
  onPrompt: (prompt: string, images?: AgentImageAttachment[]) => Promise<boolean>;
  onRespond: (approved: boolean, response?: string) => Promise<boolean>;
  onCancel: () => Promise<boolean>;
  onLoadOlderHistory: () => Promise<void>;
  onAgentAccess: (agentAccess: AgentAccessMode) => Promise<void>;
  onAgentProfile: (adapterId: string, patch: Partial<AgentProfile>) => void;
  onRepair: () => void;
  onResume: () => void;
  onPrepareHandoff: () => void;
  onReviewTranscript: () => void;
  onQueryStatus: () => void;
}) {
  const [contextOnTerminal, setContextOnTerminal] = useState(false);
  const [contextSelection, setContextSelection] = useState("");
  const promptAgent = useEventCallback(onPrompt);
  const respondToAgent = useEventCallback(onRespond);
  const cancelAgent = useEventCallback(onCancel);
  const loadOlderAgentHistory = useEventCallback(onLoadOlderHistory);
  const changeAgentAccess = useEventCallback(onAgentAccess);
  const changeAgentProfile = useEventCallback(onAgentProfile);
  const repairAgent = useEventCallback(onRepair);
  const resumeAgent = useEventCallback(onResume);
  const dragRef = useRef<{
    preview: HTMLElement;
    source: HTMLElement;
    pointerId: number;
    offsetX: number;
    offsetY: number;
    originX: number;
    originY: number;
    x: number;
    y: number;
    target?: HTMLElement;
    targetId?: string;
    axis?: SplitAxis;
    before?: boolean;
  }>(undefined);
  const finishDrag = (returnToOrigin = false) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.target?.removeAttribute("data-pane-drop");
    const cleanup = () => {
      drag.source.removeAttribute("data-pane-dragging");
      delete document.documentElement.dataset.draggingPane;
      drag.preview.remove();
      if (dragRef.current === drag) dragRef.current = undefined;
    };
    if (
      returnToOrigin
      && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      && (Math.abs(drag.x - drag.originX) > 1 || Math.abs(drag.y - drag.originY) > 1)
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
  };
  const showPaneRunState = runtime ? !isRoutineWorkingState(runtime.status) : false;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <article
          className={`pane ${focused ? "focused" : ""}`}
          data-pane-id={node.id}
          data-runtime-status={runtime?.status}
          data-agent-present={runtime?.structured || undefined}
          data-agent-status={runtime?.structured ? runtime.status : undefined}
          data-agent-attention={agentContext?.attentionReason ? "true" : undefined}
          onPointerDown={onFocus}
          onContextMenuCapture={(event) => {
            const target = event.target as Element;
            const terminal = Boolean(target.closest(".terminal"));
            if (!terminal && target.closest("input, textarea, [contenteditable=true]")) {
              event.stopPropagation();
              return;
            }
            setContextOnTerminal(terminal);
            if (!terminal) setContextSelection("");
          }}
        >
      <header
        className="pane-header"
        onPointerDown={(event) => {
          if (event.button !== 0 || dragRef.current || (event.target as Element).closest("button, input, textarea")) return;
          const source = event.currentTarget.closest<HTMLElement>("[data-pane-id]");
          if (!source) return;
          const bounds = source.getBoundingClientRect();
          const preview = source.cloneNode(true) as HTMLElement;
          const sourceCanvases = source.querySelectorAll("canvas");
          preview.querySelectorAll("canvas").forEach((canvas, index) => {
            const sourceCanvas = sourceCanvases[index];
            if (sourceCanvas?.width && sourceCanvas.height) canvas.getContext("2d")?.drawImage(sourceCanvas, 0, 0);
          });
          preview.querySelectorAll("iframe").forEach((frame) => frame.removeAttribute("src"));
          preview.classList.add("pane-drag-image");
          preview.removeAttribute("data-pane-id");
          preview.setAttribute("aria-hidden", "true");
          preview.style.width = `${bounds.width}px`;
          preview.style.height = `${bounds.height}px`;
          preview.style.transform = `translate3d(${bounds.left}px, ${bounds.top}px, 0)`;
          document.body.append(preview);
          dragRef.current = {
            preview,
            source,
            pointerId: event.pointerId,
            offsetX: event.clientX - bounds.left,
            offsetY: event.clientY - bounds.top,
            originX: bounds.left,
            originY: bounds.top,
            x: bounds.left,
            y: bounds.top,
          };
          source.dataset.paneDragging = "true";
          document.documentElement.dataset.draggingPane = "true";
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          drag.x = event.clientX - drag.offsetX;
          drag.y = event.clientY - drag.offsetY;
          drag.preview.style.transform = `translate3d(${drag.x}px, ${drag.y}px, 0)`;
          const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-pane-id]");
          drag.target?.removeAttribute("data-pane-drop");
          drag.target = target && target !== drag.source ? target : undefined;
          drag.targetId = drag.target?.dataset.paneId;
          if (!drag.target) {
            drag.axis = undefined;
            drag.before = undefined;
            return;
          }
          const position = paneDropPosition(drag.target.getBoundingClientRect(), event.clientX, event.clientY);
          drag.axis = position.axis;
          drag.before = position.before;
          drag.target.dataset.paneDrop = position.edge;
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          const { targetId, axis, before } = drag;
          finishDrag(!targetId);
          if (targetId) onMove(targetId, axis, before);
        }}
        onPointerCancel={() => finishDrag(true)}
      >
        <div className="pane-identity">
          {runtime?.structured
            ? <ProviderMark adapterId={runtime.adapterId} className="wj-pane-provider" />
            : <RunStateBadge status={runtime?.status ?? "recovered"} variant="indicator" className={`pane-status ${runtime?.status ?? "recovered"}`} />}
          <strong>{node.title}</strong>
          {runtime?.structured
            ? (showPaneRunState || agentContext?.card) && <small className="pane-agent-summary">{showPaneRunState && <RunStateBadge status={runtime.status} variant="compact" />}{agentContext?.card && <button type="button" title={`Open Plan task: ${agentContext.card.title}`} onClick={() => agentContext.card && onOpenOpsCard(agentContext.card)}>{agentContext.card.title}</button>}</small>
            : <small>{runtime?.status ?? node.kind.replaceAll("_", " ")}</small>}
        </div>
        {showPaneActions && <div className="pane-actions">
          {runtime?.structured && supportsAttachedTerminal(runtime) && (
            <button onClick={onToggleView}>{chatView ? "Terminal" : "Chat"}</button>
          )}
          {runtime && ["failed", "disconnected"].includes(runtime.status) && <button title="Resume session" onClick={onResume}>Resume</button>}
          {runtime?.structured && <DropdownMenu>
            <DropdownMenuTrigger asChild><button aria-label={`More actions for ${node.title}`} title="More pane actions"><MoreHorizontal /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <PaneAgentMenuItems runtime={runtime} agentContext={agentContext} chatView={chatView} onToggleView={onToggleView} onOpenOpsCard={onOpenOpsCard} onResume={onResume} onPrepareHandoff={onPrepareHandoff} onReviewTranscript={onReviewTranscript} onQueryStatus={onQueryStatus} />
            </DropdownMenuContent>
          </DropdownMenu>}
          <button aria-label={`Split ${node.title} right`} title={`Split right (${formatShortcut(shortcuts["pane.splitRight"])})`} onClick={() => onSplit("columns")}><Columns2 /></button>
          <button aria-label={`Split ${node.title} down`} title={`Split down (${formatShortcut(shortcuts["pane.splitDown"])})`} onClick={() => onSplit("rows")}><Columns2 className="rotate-90" /></button>
          <button aria-label={`${zoomed ? "Restore" : "Zoom"} ${node.title}`} aria-pressed={zoomed} title={`${zoomed ? "Restore" : "Zoom"} pane (${formatShortcut(shortcuts["pane.zoom"])})`} onClick={onZoom}><Maximize2 /></button>
          <button aria-label={`Close pane ${node.title}`} title={`Close pane (${formatShortcut(shortcuts["pane.close"])})`} onClick={onClose}><X /></button>
        </div>}
      </header>
      <div className="pane-content">
        {runtime?.structured ? (chatView || !runtime.terminalSessionId ? (
          <AgentChat autoFocusComposer={focused && runtime.status === "ready"} runtime={runtime} projectRoot={projectRoot} agentAccess={agentAccess} agentProfile={agentProfile} shortcuts={shortcuts} composition={agentCompositionFromNode(node.data)} onCompositionChange={onAgentComposition} onPrompt={promptAgent} onRespond={respondToAgent} onCancel={cancelAgent} onLoadOlderHistory={loadOlderAgentHistory} onAgentAccess={changeAgentAccess} onAgentProfile={changeAgentProfile} onRepair={repairAgent} onResume={resumeAgent} />
        ) : (
          <TerminalSurface
            active={focused}
            frame={runtime.frame}
            frameReceivedAt={runtime.frameReceivedAt}
            fallbackText="Connecting to OpenCode terminal…"
            onWrite={onWrite}
            onResize={onResize}
            onViewport={onViewport}
            onPaint={onPaint}
            onResizePaint={onResizePaint}
            onContextMenuSelection={setContextSelection}
          />
        )) : runtime ? (
          <TerminalSurface
            active={focused}
            frame={runtime.frame}
            frameReceivedAt={runtime.frameReceivedAt}
            fallbackText={runtime.transcript || "Session ready."}
            onWrite={onWrite}
            onResize={onResize}
            onViewport={onViewport}
            onPaint={onPaint}
            onResizePaint={onResizePaint}
            onContextMenuSelection={setContextSelection}
          />
        ) : <DataPane node={node} shortcuts={shortcuts} onSave={onSaveData} />}
      </div>
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        {contextOnTerminal && <>
          {contextSelection && <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(contextSelection)}>Copy<ContextMenuShortcut>{formatShortcut("CommandOrControl+C")}</ContextMenuShortcut></ContextMenuItem>}
          <ContextMenuItem onSelect={() => void navigator.clipboard.readText().then((text) => text && onWrite(pasteData(text, runtime?.frame?.bracketedPaste ?? false))).catch(() => undefined)}>Paste<ContextMenuShortcut>{formatShortcut("CommandOrControl+V")}</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuSeparator />
        </>}
        {runtime?.structured && <>
          <PaneAgentMenuItems context runtime={runtime} agentContext={agentContext} chatView={chatView} onToggleView={onToggleView} onOpenOpsCard={onOpenOpsCard} onResume={onResume} onPrepareHandoff={onPrepareHandoff} onReviewTranscript={onReviewTranscript} onQueryStatus={onQueryStatus} />
          <ContextMenuSeparator />
        </>}
        <ContextMenuItem onSelect={() => onSplit("columns")}><Columns2 />Split right<ContextMenuShortcut>{formatShortcut(shortcuts["pane.splitRight"])}</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onSelect={() => onSplit("rows")}><Columns2 className="rotate-90" />Split down<ContextMenuShortcut>{formatShortcut(shortcuts["pane.splitDown"])}</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onSelect={onZoom}><Maximize2 />{zoomed ? "Restore pane" : "Zoom pane"}<ContextMenuShortcut>{formatShortcut(shortcuts["pane.zoom"])}</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onClose}><X />Close pane<ContextMenuShortcut>{formatShortcut(shortcuts["pane.close"])}</ContextMenuShortcut></ContextMenuItem>
        <DevToolsContextItem />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function DataPane({ node, shortcuts, onSave }: { node: CanvasNode; shortcuts: ShortcutBindings; onSave: (data: JsonObject) => void }) {
  if (node.kind === "markdown_note") return <MarkdownPane node={node} saveShortcut={shortcuts["pane.save"]} onSave={onSave} />;
  if (node.kind === "task_checklist" || node.kind === "checklist") return <ChecklistPane node={node} onSave={onSave} />;
  if (node.kind === "browser_preview") return <BrowserPane node={node} onSave={onSave} />;
  return <pre className="fallback-pane">{stringValue(node.data, "content") ?? "No content."}</pre>;
}

function MarkdownPane({ node, saveShortcut, onSave }: { node: CanvasNode; saveShortcut: string; onSave: (data: JsonObject) => void }) {
  const [value, setValue] = useState(stringValue(node.data, "markdown") ?? stringValue(node.data, "content") ?? "");
  const save = () => onSave({ ...node.data, markdown: value });
  return (
    <textarea
      className="data-pane-editor"
      aria-label={`Edit ${node.title}`}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (matchesShortcut(event, saveShortcut)) {
          event.preventDefault();
          save();
        }
      }}
    />
  );
}

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

function checklistItems(node: CanvasNode): ChecklistItem[] {
  if (Array.isArray(node.data.items)) {
    return node.data.items.flatMap((value, index) => {
      if (!value || typeof value !== "object") return [];
      const item = value as Record<string, unknown>;
      return [{
        id: typeof item.id === "string" ? item.id : `item-${index}`,
        label: typeof item.label === "string" ? item.label : `Task ${index + 1}`,
        done: item.done === true,
      }];
    });
  }
  return (stringValue(node.data, "content") ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: `item-${index}`,
      label: line.replace(/^[✓✔☐]\s*/, ""),
      done: /^[✓✔]/.test(line),
    }));
}

function ChecklistPane({ node, onSave }: { node: CanvasNode; onSave: (data: JsonObject) => void }) {
  const [items, setItems] = useState(() => checklistItems(node));
  const [draft, setDraft] = useState("");
  const save = (next: ChecklistItem[]) => {
    setItems(next);
    onSave({ ...node.data, items: next });
  };
  const toggle = (index: number, done: boolean) => {
    const next = items.map((item, itemIndex) => itemIndex === index ? { ...item, done } : item);
    save(next);
  };
  return (
    <div className="data-pane-checklist" role="list" aria-label={node.title}>
      {items.map((item, index) => (
        <div role="listitem" key={item.id}>
          <Checkbox aria-label={`Mark ${item.label || `checklist item ${index + 1}`} complete`} checked={item.done} onCheckedChange={(checked) => toggle(index, checked === true)} />
          <Input
            aria-label={`Checklist item ${index + 1}`}
            value={item.label}
            onChange={(event) => setItems((current) => current.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, label: event.target.value } : candidate))}
            onBlur={() => onSave({ ...node.data, items })}
          />
          <Button variant="ghost" size="icon-xs" aria-label={`Delete ${item.label || `checklist item ${index + 1}`}`} onClick={() => save(items.filter((_, itemIndex) => itemIndex !== index))}><X /></Button>
        </div>
      ))}
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!draft.trim()) return;
        save([...items, { id: crypto.randomUUID(), label: draft.trim(), done: false }]);
        setDraft("");
      }}>
        <Input aria-label="New checklist item" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add an item" />
        <Button type="submit" size="sm" disabled={!draft.trim()}><Plus />Add</Button>
      </form>
    </div>
  );
}

function BrowserPane({ node, onSave }: { node: CanvasNode; onSave: (data: JsonObject) => void }) {
  const initial = stringValue(node.data, "url") ?? "";
  const [draft, setDraft] = useState(initial);
  const [url, setUrl] = useState(initial);
  const [error, setError] = useState("");
  const navigate = () => {
    try {
      const parsed = new URL(draft.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
      setUrl(parsed.href);
      setDraft(parsed.href);
      setError("");
      onSave({ ...node.data, url: parsed.href });
    } catch {
      setError("Enter an http or https URL.");
    }
  };
  return (
    <div className="data-pane-browser">
      <form onSubmit={(event) => { event.preventDefault(); navigate(); }}>
        <Input aria-label="Browser address" value={draft} onChange={(event) => setDraft(event.target.value)} aria-invalid={Boolean(error)} />
        <Button size="sm">Go</Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {url ? <iframe title={`Browser preview ${node.title}`} src={url} sandbox="allow-forms allow-scripts" /> : <div className="data-pane-empty">Enter a URL to preview it.</div>}
    </div>
  );
}
