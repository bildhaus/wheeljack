import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import Markdown from "react-markdown";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { activeProjectFileMention, filterProjectFiles, insertProjectFileMention, projectFileParts } from "./agentFileMentions";
import { emptyAgentComposition, type AgentCompositionState } from "./agentComposition";
import { agentModelCacheKey, cachedAgentModels, loadAgentModels, safeAgentToken } from "./agentModels";
import { agentFailureNeedsRepair, supportsAgentImageInput, supportsAgentTurnCancel } from "./agentRuntime";
import { pendingAgentInteraction } from "./attention";
import { ActionCard } from "./ActionCard";
import { moveCommandPaletteSelection } from "./CommandPalette";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Input } from "./components/ui/input";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./components/ui/message-scroller";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Slider } from "./components/ui/slider";
import { Textarea } from "./components/ui/textarea";
import { callCore, importImageAttachment, readImageAttachment, saveImageAttachment } from "./core";
import { DotMatrixLoader } from "./DotMatrixLoader";
import { ProviderMark } from "./ProviderMark";
import { matchesShortcut, type ShortcutBindings } from "./shortcuts";
import { ArrowUpIcon, CheckIcon, ChevronRight, CopyIcon, FileCode2, Key, Plus, StopCircle, Terminal, X } from "./SargamIcon";
import { agentEffortOptions } from "./types";
import type {
  AgentAccessMode,
  AgentImageAttachment,
  AgentMessage,
  AgentModelOption,
  AgentProfile,
  PaneRuntime,
  PromptDelivery,
  ProjectFileCatalog,
} from "./types";

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function ImageAttachment({ message: item, projectRoot }: { message: AgentMessage; projectRoot?: string }) {
  const [source, setSource] = useState("");
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!item.imagePath || !projectRoot) return;
    void readImageAttachment(item.imagePath, projectRoot)
      .then((result) => {
        if (!cancelled) setSource(result.dataUrl);
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [item.imagePath, projectRoot]);
  return (
    <figure className="chat-image">
      {source
        ? <img src={source} alt={item.label ?? "Agent image attachment"} width={item.imageWidth} height={item.imageHeight} />
        : <div className="chat-image-placeholder">{loadError || <span className="wj-inline-status"><DotMatrixLoader size={18} />Loading image attachment…</span>}</div>}
      <figcaption>{item.label ?? item.imagePath}<small>{item.imageMimeType?.toUpperCase()}</small></figcaption>
    </figure>
  );
}

function ChatImage({ attachment, projectRoot, compact = false, onRemove }: {
  attachment: AgentImageAttachment;
  projectRoot?: string;
  compact?: boolean;
  onRemove?: () => void;
}) {
  const [source, setSource] = useState("");
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!projectRoot) return;
    void readImageAttachment(attachment.path, projectRoot)
      .then((result) => {
        if (!cancelled) setSource(result.dataUrl);
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(errorMessage(cause));
      });
    return () => { cancelled = true; };
  }, [attachment.path, projectRoot]);
  return (
    <figure className={`chat-image${compact ? " compact" : ""}`}>
      {source
        ? <img src={source} alt={attachment.fileName} />
        : <div className="chat-image-placeholder">{loadError || <DotMatrixLoader size={18} />}</div>}
      {!compact && <figcaption>{attachment.fileName}<small>{attachment.mimeType.toUpperCase()}</small></figcaption>}
      {onRemove && <Button type="button" size="icon-xs" variant="secondary" aria-label={`Remove ${attachment.fileName}`} onClick={onRemove}><X /></Button>}
    </figure>
  );
}

type AgentMessageBlock =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string; language: string };

export function parseAgentMessageBlocks(text: string): AgentMessageBlock[] {
  const blocks: AgentMessageBlock[] = [];
  const fence = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of text.matchAll(fence)) {
    const index = match.index ?? 0;
    if (index > cursor) blocks.push({ kind: "text", text: text.slice(cursor, index) });
    blocks.push({ kind: "code", text: match[2], language: match[1].trim().split(/\s+/, 1)[0] || "Code" });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) blocks.push({ kind: "text", text: text.slice(cursor) });
  return blocks;
}

function AgentCodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const lines = code.replace(/\r?\n$/, "").split(/\r?\n/);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (cause) {
      console.error("Could not copy agent code.", cause);
    }
  };
  return (
    <div className="agent-code-block">
      <div className="agent-code-header">
        <span className="agent-code-language"><FileCode2 />{language}</span>
        <button type="button" aria-label={copied ? `${language} code copied` : `Copy ${language} code`} onClick={() => void copy()}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <div className="agent-code-body">
        {lines.map((line, index) => (
          <div className="agent-code-line" key={index}>
            <span>{index + 1}</span>
            <code>{line || "\u00a0"}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentTextBlock({ text, streaming = false }: { text: string; streaming?: boolean }) {
  if (!text.trim()) return null;
  return <div className="agent-prose" data-streaming={streaming || undefined}><Markdown skipHtml components={{
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  }}>{text}</Markdown></div>;
}

export function AgentMessageContent({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = parseAgentMessageBlocks(text);
  return <div className="agent-message-content">{blocks.map((block, index) => block.kind === "code"
    ? <AgentCodeBlock key={index} code={block.text} language={block.language} />
    : <AgentTextBlock key={index} text={block.text} streaming={streaming && index === blocks.length - 1} />
  )}{streaming && blocks.at(-1)?.kind !== "text" && <span className="agent-stream-caret" aria-hidden="true" />}</div>;
}

function isProgressUpdate(item: AgentMessage): boolean {
  return item.kind === "commentary" || (item.role === "assistant" && item.kind === "message");
}

function AgentActivityMessage({ items, active }: { items: AgentMessage[]; active: boolean }) {
  const streaming = active ? [...items].reverse().find((item) => item.streaming) : undefined;
  const latestUpdate = active ? [...items].reverse().find(isProgressUpdate) : undefined;
  const toolCount = items.filter((item) => item.kind === "tool").length;
  const updateCount = items.filter(isProgressUpdate).length;
  const counts = [
    toolCount ? `${toolCount} tool${toolCount === 1 ? "" : "s"} used` : "",
    updateCount ? `${updateCount} update${updateCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");
  const label = !active ? "Activity"
    : streaming?.kind === "tool" ? streaming.tool ?? streaming.title ?? "Running tool"
    : streaming?.kind === "reasoning" ? "Thinking…"
    : "Working";
  const [open, setOpen] = useState(false);
  const evidence = (
    <div className="activity-group-list">
      {items.map((item) => (
        <div key={item.id} className="activity-group-row" data-kind={item.kind}>
          <div>
            <strong>{item.kind === "tool" ? item.tool ?? item.title ?? "Tool" : isProgressUpdate(item) ? "Progress" : "Reasoning"}</strong>
            <small>{item.streaming ? "running" : item.status ?? "complete"}</small>
          </div>
          {item.text && (item.kind === "tool"
            ? <pre>{item.text}</pre>
            : <div className="activity-group-copy"><AgentMessageContent text={item.text} streaming={item.streaming} /></div>)}
        </div>
      ))}
    </div>
  );
  return (
    <section className="message tool activity-group" data-live={active || undefined}>
      <button className="tool-summary" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span className="tool-summary-label">
          {active ? <Terminal /> : <CheckIcon />}
          <span className="activity-summary-copy"><strong>{label}</strong>{counts && <small>{counts}</small>}</span>
        </span>
        <span className="tool-summary-status" data-running={active || undefined}>
          {active ? <small>Running</small> : <span className="sr-only">Completed</span>}
          <ChevronRight />
        </span>
      </button>
      {latestUpdate?.text && <div className="activity-current" role="status"><AgentMessageContent text={latestUpdate.text} /></div>}
      <div className="tool-collapsible" data-open={open}><div>{evidence}</div></div>
    </section>
  );
}

function AgentInteractionCard({
  message: item,
  active,
  draft,
  submitting,
  onDraftChange,
  onRespond,
}: {
  message: AgentMessage;
  active: boolean;
  draft: string;
  submitting: boolean;
  onDraftChange: (draft: string) => void;
  onRespond: (approved: boolean, response?: string) => void;
}) {
  const state = item.interactionState ?? "pending";
  const pending = state === "pending" || state === "submitting";
  const question = item.kind === "question";
  return <ActionCard
    variant="decision"
    decisionType={question ? "question" : "approval"}
    title={pending ? question ? "Response needed" : "Permission requested" : question ? "Agent question" : `${item.title ?? item.label ?? "Tool"} permission`}
    summary={item.text || item.title || item.label}
    interactionState={state}
    compact={!pending}
    sticky={active && pending}
    busy={submitting || state === "submitting"}
    draft={draft}
    onDraftChange={onDraftChange}
    choices={question ? item.choices : undefined}
    onChoice={(choice) => onRespond(true, choice)}
    actions={active && pending ? [
      { id: "decline", label: question ? "Cancel" : "Deny", intent: "secondary", onInvoke: () => onRespond(false) },
      { id: "accept", label: question ? "Send answer" : "Approve", intent: "primary", disabled: question && !draft.trim(), pending: submitting, onInvoke: () => onRespond(true) },
    ] : undefined}
  />;
}

function AgentModelPicker({ profile, cwd, onProfile }: { profile: AgentProfile; cwd?: string; onProfile: (patch: Partial<AgentProfile>) => void }) {
  const modelListId = useId();
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState(profile.model);
  const [provider, setProvider] = useState(profile.provider);
  const [effort, setEffort] = useState(profile.thinking);
  const [dialPosition, setDialPosition] = useState(() => Math.max(0, agentEffortOptions(profile.adapterId).indexOf(profile.thinking)));
  const [dialPulse, setDialPulse] = useState<number>();
  const [models, setModels] = useState<AgentModelOption[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [activeModelIndex, setActiveModelIndex] = useState(-1);
  useEffect(() => {
    setModel(profile.model);
    setProvider(profile.provider);
    setEffort(profile.thinking);
    setDialPosition(Math.max(0, agentEffortOptions(profile.adapterId).indexOf(profile.thinking)));
  }, [profile.adapterId, profile.model, profile.provider, profile.thinking]);
  useEffect(() => {
    if (!open) return;
    const cached = cachedAgentModels(agentModelCacheKey(profile.adapterId, cwd));
    if (cached) {
      setModels(cached.models);
      setLoadError("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    void loadAgentModels(profile.adapterId, cwd)
      .then((catalog) => {
        if (cancelled) return;
        setModels(catalog.models);
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [cwd, open, profile.adapterId, refresh]);
  const selected = models.find((candidate) => candidate.id === model && (!candidate.provider || candidate.provider === provider));
  const efforts = useMemo(
    () => selected?.efforts.length ? selected.efforts : agentEffortOptions(profile.adapterId),
    [profile.adapterId, selected],
  );
  const matchingModels = useMemo(() => models.filter((candidate) => `${candidate.label} ${candidate.id} ${candidate.description ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())), [models, search]);
  const visibleModels = useMemo(() => matchingModels.slice(0, 100), [matchingModels]);
  useEffect(() => {
    const next = efforts.includes(effort) ? effort : selected?.defaultEffort ?? efforts[0] ?? effort;
    if (next !== effort) setEffort(next);
    setDialPosition(Math.max(0, efforts.indexOf(next)));
  }, [effort, efforts, selected?.defaultEffort]);
  const apply = () => {
    if (!safeAgentToken(model, 128)) return;
    onProfile({ model, provider, thinking: effort });
    setOpen(false);
  };
  const moveDial = (next: AgentProfile["thinking"]) => {
    if (next === effort) return;
    setEffort(next);
    setDialPulse((value) => (value ?? 0) + 1);
  };
  const snapDial = (position: number) => {
    const index = Math.min(efforts.length - 1, Math.max(0, Math.round(position)));
    setDialPosition(index);
    moveDial(efforts[index] ?? effort);
  };
  const chooseModel = (candidate: AgentModelOption) => {
    const nextEfforts = candidate.efforts.length ? candidate.efforts : agentEffortOptions(profile.adapterId);
    const nextEffort = nextEfforts.includes(effort) ? effort : candidate.defaultEffort ?? nextEfforts[0] ?? effort;
    setModel(candidate.id);
    setProvider(candidate.provider ?? profile.provider);
    setDialPosition(Math.max(0, nextEfforts.indexOf(nextEffort)));
    moveDial(nextEffort);
  };
  useEffect(() => {
    if (!open) return;
    const selectedIndex = visibleModels.findIndex((candidate) => candidate.id === model && (!candidate.provider || candidate.provider === provider));
    setActiveModelIndex(selectedIndex >= 0 ? selectedIndex : visibleModels.length ? 0 : -1);
  }, [model, open, provider, visibleModels]);
  useEffect(() => {
    if (open && activeModelIndex >= 0) document.getElementById(`${modelListId}-option-${activeModelIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeModelIndex, modelListId, open]);
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) { setModel(profile.model); setProvider(profile.provider); setEffort(profile.thinking); setDialPosition(Math.max(0, agentEffortOptions(profile.adapterId).indexOf(profile.thinking))); setSearch(""); } }}>
      <PopoverTrigger asChild>
        <Button type="button" size="xs" variant="ghost" className="chat-model-trigger" data-effort={profile.thinking} aria-label={`Model: ${profile.model}, reasoning effort: ${profile.thinking}`} title={`${profile.model} · ${profile.thinking} reasoning`}>
          <ProviderMark adapterId={profile.adapterId} />
          <span>{profile.model.split("/").at(-1)} · {profile.thinking}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="chat-model-popover" align="start">
        <div className="chat-model-heading">
          <ProviderMark adapterId={profile.adapterId} />
          <div><strong>Model & reasoning</strong><small>Models available through the installed {profile.adapterId} CLI.</small></div>
        </div>
        <Input
          aria-label="Search agent models"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={modelListId}
          aria-expanded={open}
          aria-activedescendant={activeModelIndex >= 0 ? `${modelListId}-option-${activeModelIndex}` : undefined}
          autoFocus
          placeholder="Search models"
          value={search}
          onChange={(event) => { setSearch(event.target.value); setActiveModelIndex(0); }}
          onKeyDown={(event) => {
            if (!visibleModels.length || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
            event.preventDefault();
            if (event.key === "ArrowDown") setActiveModelIndex((index) => (index + 1) % visibleModels.length);
            else if (event.key === "ArrowUp") setActiveModelIndex((index) => index <= 0 ? visibleModels.length - 1 : index - 1);
            else if (activeModelIndex >= 0) chooseModel(visibleModels[activeModelIndex]);
          }}
        />
        <div id={modelListId} className="chat-model-list" role="listbox" aria-label="Available models">
          {loading && <div className="chat-model-status"><DotMatrixLoader size={16} />Discovering models…</div>}
          {loadError && <div className="chat-model-status error"><span>{loadError}</span><Button type="button" size="xs" variant="ghost" onClick={() => setRefresh((value) => value + 1)}>Retry</Button></div>}
          {!loading && !loadError && visibleModels.map((candidate, index) => (
            <button
              id={`${modelListId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={candidate === selected}
              data-active={index === activeModelIndex || undefined}
              tabIndex={-1}
              key={`${candidate.provider ?? ""}/${candidate.id}`}
              onMouseEnter={() => setActiveModelIndex(index)}
              onClick={() => chooseModel(candidate)}
            >
              <ProviderMark adapterId={profile.adapterId} />
              <span className="chat-model-option-copy"><strong>{candidate.label}</strong>{candidate.description && <small>{candidate.description}</small>}</span>
              {candidate.isDefault && <Badge variant="secondary">Default</Badge>}
            </button>
          ))}
          {!loading && !loadError && !matchingModels.length && <div className="chat-model-status">No matching models.</div>}
        </div>
        <div className="chat-effort-dial" data-effort={effort} data-snap={dialPulse === undefined ? undefined : dialPulse % 2}>
          <div className="chat-effort-scale" style={{ "--effort-position": `${dialPosition / Math.max(1, efforts.length - 1) * 100}%` } as CSSProperties}>
            <div className="chat-effort-readout"><strong>{effort}</strong></div>
            <div className="chat-effort-track">
              <Slider aria-label="Reasoning effort"
                aria-valuetext={effort}
                value={[dialPosition]}
                min={0}
                max={Math.max(0, efforts.length - 1)}
                step={0.01}
                disabled={efforts.length < 2}
                onValueChange={([position]) => {
                  setDialPosition(position);
                  moveDial(efforts[Math.round(position)] ?? effort);
                }}
                onValueCommit={([position]) => snapDial(position)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"].includes(event.key)) return;
                  event.preventDefault();
                  snapDial(Math.round(dialPosition) + (["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1));
                }}
              />
              <div className="chat-effort-ticks" aria-hidden="true">{efforts.map((value, index) => <i key={value} style={{ left: `${index / Math.max(1, efforts.length - 1) * 100}%` }} />)}</div>
            </div>
          </div>
        </div>
        <div className="chat-model-actions"><small>{matchingModels.length > 100 ? `Showing 100 of ${matchingModels.length}; refine the search.` : `${models.length} models available`}</small><Button type="button" size="sm" disabled={!safeAgentToken(model, 128)} onClick={apply}>Apply</Button></div>
      </PopoverContent>
    </Popover>
  );
}

function AgentChatComponent({
  autoFocusComposer,
  runtime,
  projectRoot,
  agentAccess = "default",
  agentProfile,
  shortcuts,
  onPrompt,
  onPromptEdit,
  onPromptRetry,
  onPromptCancel,
  onRespond,
  onCancel,
  onLoadOlderHistory,
  onAgentAccess,
  onAgentProfile,
  onRepair,
  onResume,
  composition = emptyAgentComposition(),
  onCompositionChange,
}: {
  autoFocusComposer: boolean;
  runtime: PaneRuntime;
  projectRoot?: string;
  agentAccess?: AgentAccessMode;
  agentProfile?: AgentProfile;
  shortcuts: ShortcutBindings;
  onPrompt: (prompt: string, images?: AgentImageAttachment[]) => Promise<boolean>;
  onPromptEdit: (delivery: PromptDelivery, prompt: string, images: AgentImageAttachment[]) => Promise<boolean>;
  onPromptRetry: (delivery: PromptDelivery) => Promise<boolean>;
  onPromptCancel: (delivery: PromptDelivery) => Promise<boolean>;
  onRespond: (approved: boolean, response?: string) => Promise<boolean>;
  onCancel: () => Promise<boolean>;
  onLoadOlderHistory: () => Promise<void>;
  onAgentAccess: (agentAccess: AgentAccessMode) => Promise<void>;
  onAgentProfile: (adapterId: string, patch: Partial<AgentProfile>) => void;
  onRepair: () => void;
  onResume: () => void;
  composition?: AgentCompositionState;
  onCompositionChange?: (composition: AgentCompositionState) => void;
}) {
  const [prompt, setPrompt] = useState(composition.draft);
  const [attachments, setAttachments] = useState<AgentImageAttachment[]>(composition.attachments);
  const [attachmentError, setAttachmentError] = useState("");
  const [composerCaret, setComposerCaret] = useState(0);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [wheeljackDocuments, setDocumentPaths] = useState<string[]>([]);
  const [projectFilesTruncated, setProjectFilesTruncated] = useState(false);
  const [projectFilesLoading, setProjectFilesLoading] = useState(false);
  const [projectFilesError, setProjectFilesError] = useState("");
  const [fileMentionActiveIndex, setFileMentionActiveIndex] = useState(0);
  const [dismissedFileMention, setDismissedFileMention] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingDeliveryId, setEditingDeliveryId] = useState<string>();
  const [deliveryPendingId, setDeliveryPendingId] = useState<string>();
  const [interactionDraft, setInteractionDraft] = useState("");
  const [visibleMessageLimit, setVisibleMessageLimit] = useState(80);
  const composerRef = useRef<HTMLFormElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const messageViewportRef = useRef<HTMLDivElement>(null);
  const compositionRef = useRef<AgentCompositionState>(composition);
  const compositionTimerRef = useRef<number | undefined>(undefined);
  const compositionCallbackRef = useRef(onCompositionChange);
  compositionCallbackRef.current = onCompositionChange;
  const scheduleComposition = useCallback((next: AgentCompositionState) => {
    compositionRef.current = next;
    window.clearTimeout(compositionTimerRef.current);
    compositionTimerRef.current = window.setTimeout(() => {
      compositionTimerRef.current = undefined;
      compositionCallbackRef.current?.(compositionRef.current);
    }, 180);
  }, []);
  useEffect(() => {
    scheduleComposition({ ...compositionRef.current, draft: prompt, attachments });
  }, [attachments, prompt, scheduleComposition]);
  useEffect(() => {
    if (!editingDeliveryId || runtime.promptDeliveries?.some((delivery) => delivery.id === editingDeliveryId)) return;
    setEditingDeliveryId(undefined);
    setPrompt("");
    setAttachments([]);
  }, [editingDeliveryId, runtime.promptDeliveries]);
  useEffect(() => () => {
    window.clearTimeout(compositionTimerRef.current);
    compositionCallbackRef.current?.(compositionRef.current);
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const viewport = messageViewportRef.current;
      if (!viewport) return;
      viewport.scrollTop = composition.followLatest ? viewport.scrollHeight : composition.scrollTop;
    });
    return () => cancelAnimationFrame(frame);
  }, [composition.followLatest, composition.scrollTop, runtime.messages.length, runtime.nodeId]);
  const fileMentionListId = useId();
  const dragDepthRef = useRef(0);
  const turnActive = ["starting", "running", "needs_input", "canceling"].includes(runtime.status);
  const displayMessages = useMemo(
    () => messagesForAgentStatus(runtime.messages, runtime.status),
    [runtime.messages, runtime.status],
  );
  const allVisibleMessages = useMemo(
    () => groupAgentMessages(displayMessages, turnActive),
    [displayMessages, turnActive],
  );
  const hiddenMessageCount = Math.max(0, allVisibleMessages.length - visibleMessageLimit);
  const visibleMessages = useMemo(
    () => allVisibleMessages.slice(-visibleMessageLimit),
    [allVisibleMessages, visibleMessageLimit],
  );
  const latestVisibleEntry = allVisibleMessages.at(-1);
  const hasCurrentActivity = Array.isArray(latestVisibleEntry)
    || Boolean(latestVisibleEntry?.role === "assistant" && latestVisibleEntry.kind === "message" && latestVisibleEntry.text.trim());
  const showTurnActivity = ["starting", "running"].includes(runtime.status)
    && !displayMessages.at(-1)?.streaming
    && !hasCurrentActivity;
  const interaction = pendingAgentInteraction(runtime.messages);
  const answeringQuestion = interaction?.kind === "question";
  useEffect(() => {
    setInteractionDraft("");
  }, [interaction?.id, interaction?.interactionId]);
  const imageInput = runtime.capabilities?.imageInput ?? supportsAgentImageInput(runtime.protocol);
  const canCancel = (runtime.capabilities?.cancel ?? supportsAgentTurnCancel(runtime.protocol))
    && ["starting", "running", "needs_input", "canceling"].includes(runtime.status);
  const fileMention = useMemo(() => activeProjectFileMention(prompt, composerCaret), [composerCaret, prompt]);
  const fileMentionSignature = fileMention ? `${fileMention.start}:${fileMention.end}:${fileMention.query}` : "";
  const fileMentionOpen = Boolean(projectRoot && fileMention && dismissedFileMention !== fileMentionSignature);
  const fileMentionRequestKey = fileMentionOpen ? `${projectRoot}:${fileMention?.start}` : "";
  const matchingProjectFiles = useMemo(
    () => fileMentionOpen ? filterProjectFiles(projectFiles, fileMention?.query ?? "") : [],
    [fileMention?.query, fileMentionOpen, projectFiles],
  );
  const matchingDocumentPaths = useMemo(
    () => fileMentionOpen ? filterProjectFiles(wheeljackDocuments, fileMention?.query ?? "") : [],
    [fileMention?.query, fileMentionOpen, wheeljackDocuments],
  );
  const matchingMentionPaths = useMemo(
    () => [...matchingDocumentPaths, ...matchingProjectFiles],
    [matchingDocumentPaths, matchingProjectFiles],
  );
  useEffect(() => {
    setProjectFiles([]);
    setDocumentPaths([]);
    setProjectFilesTruncated(false);
    setProjectFilesError("");
  }, [projectRoot]);
  useEffect(() => {
    if (!fileMentionRequestKey || !projectRoot) return;
    let cancelled = false;
    setProjectFilesLoading(true);
    setProjectFilesError("");
    void callCore<ProjectFileCatalog>("project_files_list", { projectPath: projectRoot })
      .then((catalog) => {
        if (cancelled) return;
        setProjectFiles(catalog.files);
        setDocumentPaths(catalog.wheeljackDocuments ?? []);
        setProjectFilesTruncated(catalog.truncated);
      })
      .catch((cause) => {
        if (!cancelled) setProjectFilesError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setProjectFilesLoading(false);
      });
    return () => { cancelled = true; };
  }, [fileMentionRequestKey, projectRoot]);
  useEffect(() => {
    setFileMentionActiveIndex(0);
  }, [fileMention?.query, fileMentionOpen]);
  useEffect(() => {
    const path = matchingMentionPaths[fileMentionActiveIndex];
    if (fileMentionOpen && path) document.getElementById(`${fileMentionListId}-${path}`)?.scrollIntoView({ block: "nearest" });
  }, [fileMentionActiveIndex, fileMentionListId, fileMentionOpen, matchingMentionPaths]);
  const selectProjectFile = (path: string) => {
    if (!fileMention) return;
    const next = insertProjectFileMention(prompt, fileMention, path);
    setPrompt(next.value);
    setComposerCaret(next.caret);
    setDismissedFileMention("");
    requestAnimationFrame(() => {
      composerInputRef.current?.focus();
      composerInputRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const appendAttachments = useCallback(async (requests: Promise<AgentImageAttachment>[]) => {
    setAttachmentError("");
    const results = await Promise.allSettled(requests);
    const accepted = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") setAttachmentError(errorMessage(rejected.reason));
    setAttachments((current) => {
      const paths = new Set(current.map((attachment) => attachment.path));
      return [...current, ...accepted.filter((attachment) => !paths.has(attachment.path))].slice(0, 4);
    });
  }, []);
  const attachPaths = useCallback((paths: string[]) => {
    if (paths.length) void appendAttachments(paths.map(importImageAttachment));
  }, [appendAttachments]);
  const attachFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    void appendAttachments(files.map(async (file) => saveImageAttachment(
      Array.from(new Uint8Array(await file.arrayBuffer())),
      file.name,
    )));
  }, [appendAttachments]);
  useEffect(() => {
    if (!imageInput || answeringQuestion) setDragActive(false);
  }, [answeringQuestion, imageInput]);
  useEffect(() => {
    if (!isTauri() || !imageInput || answeringQuestion) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type === "leave") {
        setDragActive(false);
        return;
      }
      const form = composerRef.current;
      if (!form) return;
      const scale = await getCurrentWindow().scaleFactor();
      if (disposed) return;
      const rect = form.getBoundingClientRect();
      const x = event.payload.position.x / scale;
      const y = event.payload.position.y / scale;
      const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      if (event.payload.type !== "drop") {
        setDragActive(inside);
        return;
      }
      setDragActive(false);
      if (inside) attachPaths(event.payload.paths);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [answeringQuestion, attachPaths, imageInput]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ((!prompt.trim() && !attachments.length) || submitting) return;
    const draft = prompt;
    const draftAttachments = attachments;
    setSubmitting(true);
    try {
      const editingDelivery = runtime.promptDeliveries?.find((delivery) => delivery.id === editingDeliveryId);
      const accepted = editingDelivery
        ? await onPromptEdit(editingDelivery, draft, draftAttachments)
        : await onPrompt(draft, draftAttachments);
      if (accepted) {
        setEditingDeliveryId(undefined);
        setPrompt((current) => current === draft ? "" : current);
        const sentPaths = new Set(draftAttachments.map((attachment) => attachment.path));
        setAttachments((current) => current.filter((attachment) => !sentPaths.has(attachment.path)));
      }
    } finally {
      setSubmitting(false);
    }
  };
  const queuedAttachments = (delivery: PromptDelivery): AgentImageAttachment[] => {
    const messageImages = runtime.messages.find((item) => item.deliveryId === delivery.id)?.images ?? [];
    const byPath = new Map(messageImages.map((attachment) => [attachment.path, attachment]));
    return (delivery.payload?.imagePaths ?? []).map((path) => byPath.get(path) ?? {
      path,
      fileName: path.split(/[\\/]/).at(-1) ?? "image",
      mimeType: /\.png$/i.test(path) ? "image/png"
        : /\.gif$/i.test(path) ? "image/gif"
        : /\.webp$/i.test(path) ? "image/webp"
        : /\.bmp$/i.test(path) ? "image/bmp"
        : "image/jpeg",
    });
  };
  const beginPromptEdit = (delivery: PromptDelivery) => {
    setEditingDeliveryId(delivery.id);
    setPrompt(delivery.payload?.historyText ?? "");
    setAttachments(queuedAttachments(delivery));
    setAttachmentError("");
    requestAnimationFrame(() => composerInputRef.current?.focus());
  };
  const mutateDelivery = async (delivery: PromptDelivery, action: "retry" | "cancel") => {
    if (deliveryPendingId) return;
    setDeliveryPendingId(delivery.id);
    setAttachmentError("");
    try {
      const accepted = action === "retry" ? await onPromptRetry(delivery) : await onPromptCancel(delivery);
      if (accepted && editingDeliveryId === delivery.id) {
        setEditingDeliveryId(undefined);
        setPrompt("");
        setAttachments([]);
      }
    } catch (cause) {
      setAttachmentError(errorMessage(cause));
    } finally {
      setDeliveryPendingId(undefined);
    }
  };
  const respond = async (approved: boolean, response?: string) => {
    if (!interaction || submitting) return;
    const draft = response ?? interactionDraft;
    if (answeringQuestion && approved && !draft.trim()) return;
    setSubmitting(true);
    try {
      const accepted = await onRespond(approved, answeringQuestion ? draft.trim() : undefined);
      if (accepted && answeringQuestion) {
        setInteractionDraft((current) => current === interactionDraft ? "" : current);
      }
    } finally {
      setSubmitting(false);
    }
  };
  const cancel = async () => {
    if (submitting || runtime.status === "canceling") return;
    setSubmitting(true);
    try {
      await onCancel();
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="chat" data-turn-state={runtime.status}>
      <MessageScrollerProvider key={runtime.nodeId} autoScroll defaultScrollPosition={composition.followLatest ? "end" : "start"}>
        <MessageScroller className="chat-transcript">
          <MessageScrollerViewport
            ref={messageViewportRef}
            className="messages"
            aria-label="Agent conversation"
            onScroll={(event) => {
              const viewport = event.currentTarget;
              const followLatest = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24;
              scheduleComposition({
                ...compositionRef.current,
                scrollTop: viewport.scrollTop,
                followLatest,
              });
            }}
          >
            <MessageScrollerContent aria-busy={["starting", "running", "canceling"].includes(runtime.status)}>
        {(hiddenMessageCount > 0 || runtime.historyHasMore) && <div className="chat-history-more"><Button
          type="button"
          size="sm"
          variant="outline"
          disabled={runtime.historyLoading}
          onClick={() => {
            if (hiddenMessageCount > 0) {
              setVisibleMessageLimit((current) => current + 80);
              return;
            }
            void onLoadOlderHistory().then(() => setVisibleMessageLimit((current) => current + 80));
          }}
        >{runtime.historyLoading ? "Loading earlier messages…" : hiddenMessageCount > 0 ? `Show ${Math.min(80, hiddenMessageCount)} earlier messages` : "Load earlier messages"}</Button></div>}
        {visibleMessages.length ? visibleMessages.map((entry) => {
          const item = Array.isArray(entry) ? entry[0] : entry;
          const transcriptPart = Array.isArray(entry) || item.kind === "reasoning"
            ? "activity"
            : item.role === "assistant" ? "answer" : item.role === "user" ? "user" : "event";
          return (
            <MessageScrollerItem key={item.id} messageId={item.id} data-chat-part={transcriptPart}>
              {Array.isArray(entry) ? (
                <AgentActivityMessage items={entry} active={["starting", "running", "canceling"].includes(runtime.status) && entry === latestVisibleEntry} />
              ) : ["approval", "question"].includes(entry.kind) ? (
                <AgentInteractionCard
                  message={entry}
                  active={interaction?.id === entry.id}
                  draft={interaction?.id === entry.id ? interactionDraft : ""}
                  submitting={submitting}
                  onDraftChange={setInteractionDraft}
                  onRespond={(approved, response) => void respond(approved, response)}
                />
              ) : (
                <div className={`message ${entry.role} ${entry.kind}${entry.streaming ? " streaming" : ""}`} data-live={entry.streaming || undefined} data-delivery-state={entry.deliveryState}>
                  {(entry.title || entry.label || !["user", "assistant"].includes(entry.role)) && <span>{entry.title ?? entry.label ?? entry.role}</span>}
                  {entry.code && <AgentCodeBlock code={entry.code} language={entry.label ?? "Code"} />}
                  {entry.text && <AgentMessageContent text={entry.text} streaming={entry.streaming && entry.role === "assistant"} />}
                  {entry.interactionState && entry.interactionState !== "pending" && <small>{entry.interactionState}</small>}
                  {entry.deliveryState && entry.deliveryState !== "delivered" && <small className="chat-delivery-state">{entry.deliveryState === "indeterminate" ? "Delivery unconfirmed" : entry.deliveryState}</small>}
                  {entry.imagePath && <ImageAttachment message={entry} projectRoot={projectRoot} />}
                  {entry.images?.length ? <div className="chat-image-list">{entry.images.map((attachment) => <ChatImage key={attachment.path} attachment={attachment} projectRoot={projectRoot} />)}</div> : null}
                </div>
              )}
            </MessageScrollerItem>
          );
        }) : !turnActive ? (
          <div className="chat-empty">
            <strong>What should this agent work on?</strong>
            <p>Send a prompt below to start the structured session.</p>
          </div>
        ) : null}
        {showTurnActivity && <MessageScrollerItem messageId={`${runtime.nodeId}-activity`} data-chat-part="activity"><div className="chat-turn-activity" role="status"><DotMatrixLoader variant={runtime.status === "starting" ? "loading" : "thinking"} size={18} /><span>{runtime.status === "starting" ? "Connecting to agent…" : "Agent is working…"}</span></div></MessageScrollerItem>}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="chat-jump" direction="end" behavior="smooth">Jump to latest</MessageScrollerButton>
        </MessageScroller>
      </MessageScrollerProvider>
      {runtime.status === "failed" && (
        <ActionCard
          className="chat-recovery-card"
          variant="recovery"
          title="Agent failed"
          error={runtime.statusSummary ?? "Review the failure, then resume the agent."}
          actions={[
            ...(agentFailureNeedsRepair(runtime.statusSummary) ? [{ id: "repair", label: "Repair sign-in", intent: "secondary" as const, onInvoke: onRepair }] : []),
            { id: "resume", label: "Resume", intent: "primary", onInvoke: onResume },
          ]}
        />
      )}
      {runtime.status !== "failed" && !interaction && <form
        ref={composerRef}
        className="chat-composer"
        data-drag-active={dragActive || undefined}
        onSubmit={(event) => void submit(event)}
        onPaste={(event: ClipboardEvent<HTMLFormElement>) => {
          if (!imageInput || answeringQuestion) return;
          const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
          if (files.length) {
            event.preventDefault();
            attachFiles(files);
          }
        }}
        onDragEnter={(event: DragEvent<HTMLFormElement>) => {
          if (!imageInput || answeringQuestion || !Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) return;
          event.preventDefault();
          dragDepthRef.current += 1;
          setDragActive(true);
        }}
        onDragOver={(event: DragEvent<HTMLFormElement>) => {
          if (imageInput && !answeringQuestion && Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) event.preventDefault();
        }}
        onDragLeave={() => {
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (!dragDepthRef.current) setDragActive(false);
        }}
        onDrop={(event: DragEvent<HTMLFormElement>) => {
          dragDepthRef.current = 0;
          setDragActive(false);
          if (!imageInput || answeringQuestion) return;
          const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
          if (files.length) {
            event.preventDefault();
            attachFiles(files);
          }
        }}
      >
        {(runtime.promptDeliveries?.length ?? 0) > 0 && <div className="chat-prompt-queue" aria-label="Prompt queue">
          {runtime.promptDeliveries?.map((delivery) => <div key={delivery.id} data-state={delivery.state}>
            <span><strong>#{delivery.seq}</strong> {delivery.state === "dispatching" ? "Sending…" : delivery.state}</span>
            <small>{delivery.errorMessage ?? delivery.payload?.historyText ?? "Queued prompt"}</small>
            <div>
              {["failed", "indeterminate", "blocked"].includes(delivery.state) && <Button type="button" size="xs" variant="ghost" disabled={Boolean(deliveryPendingId)} onClick={() => void mutateDelivery(delivery, "retry")}>Retry</Button>}
              {["queued", "failed", "blocked"].includes(delivery.state) && <Button type="button" size="xs" variant="ghost" disabled={Boolean(deliveryPendingId || (editingDeliveryId && editingDeliveryId !== delivery.id))} onClick={() => beginPromptEdit(delivery)}>Edit</Button>}
              {["queued", "failed", "indeterminate", "blocked"].includes(delivery.state) && <Button type="button" size="xs" variant="ghost" disabled={Boolean(deliveryPendingId)} onClick={() => void mutateDelivery(delivery, "cancel")}>{deliveryPendingId === delivery.id ? "Working…" : delivery.state === "indeterminate" ? "Don't resend" : "Cancel"}</Button>}
            </div>
          </div>)}
        </div>}
        {attachments.length > 0 && <div className="chat-composer-attachments">{attachments.map((attachment) => (
          <ChatImage key={attachment.path} attachment={attachment} projectRoot={projectRoot} compact onRemove={() => setAttachments((current) => current.filter((item) => item.path !== attachment.path))} />
        ))}</div>}
        {attachmentError && <small className="chat-composer-error" role="alert">{attachmentError}</small>}
        {fileMentionOpen && <div className="chat-file-mentions" aria-busy={projectFilesLoading || undefined}>
          <div className="chat-file-mentions-heading"><strong>Project context</strong><small>{projectFilesTruncated ? "Showing matches from the first 20,000 files" : "Type to filter"}</small></div>
          <div id={fileMentionListId} role="listbox" aria-label="Project context">
            {matchingDocumentPaths.length > 0 && <div className="chat-file-mention-group" role="group" aria-label="wheeljack documents">
              <div className="chat-file-mention-group-label">wheeljack documents</div>
              {matchingDocumentPaths.map((path, index) => <button
                id={`${fileMentionListId}-${path}`}
                key={path}
                type="button"
                role="option"
                aria-selected={index === fileMentionActiveIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setFileMentionActiveIndex(index)}
                onClick={() => selectProjectFile(path)}
              ><FileCode2 /><span><strong>{path}</strong><small>wheeljack document</small></span></button>)}
            </div>}
            {matchingProjectFiles.length > 0 && <div className="chat-file-mention-group" role="group" aria-label="Project files">
              <div className="chat-file-mention-group-label">Project files</div>
              {matchingProjectFiles.map((path, index) => {
                const optionIndex = matchingDocumentPaths.length + index;
                const parts = projectFileParts(path);
                return <button
                  id={`${fileMentionListId}-${path}`}
                  key={path}
                  type="button"
                  role="option"
                  aria-selected={optionIndex === fileMentionActiveIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setFileMentionActiveIndex(optionIndex)}
                  onClick={() => selectProjectFile(path)}
                ><FileCode2 /><span><strong>{parts.name}</strong><small>{parts.directory}</small></span></button>;
              })}
            </div>}
            {projectFilesLoading && !projectFiles.length && !wheeljackDocuments.length && <div className="chat-file-mention-status" role="status"><DotMatrixLoader size={16} />Loading project context…</div>}
            {projectFilesError && <div className="chat-file-mention-status error" role="alert">{projectFilesError}</div>}
            {!projectFilesLoading && !projectFilesError && !matchingMentionPaths.length && <div className="chat-file-mention-status" role="status">No matching project context</div>}
          </div>
          <footer><span>↑↓ navigate</span><span>Enter add</span><span>Esc close</span></footer>
        </div>}
        {editingDeliveryId && <div className="chat-editing-prompt" role="status"><span>Editing queued prompt</span><Button type="button" size="xs" variant="ghost" disabled={submitting} onClick={() => { setEditingDeliveryId(undefined); setPrompt(""); setAttachments([]); }}>Stop editing</Button></div>}
        <Textarea
          ref={composerInputRef}
          autoFocus={autoFocusComposer}
          aria-label="Agent prompt"
          aria-autocomplete={fileMentionOpen ? "list" : undefined}
          aria-controls={fileMentionOpen ? fileMentionListId : undefined}
          aria-expanded={fileMentionOpen || undefined}
          aria-activedescendant={fileMentionOpen && matchingMentionPaths[fileMentionActiveIndex] ? `${fileMentionListId}-${matchingMentionPaths[fileMentionActiveIndex]}` : undefined}
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            setComposerCaret(event.target.selectionStart);
            setDismissedFileMention("");
          }}
          onSelect={(event) => setComposerCaret(event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (fileMentionOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              setFileMentionActiveIndex((current) => moveCommandPaletteSelection(current, matchingMentionPaths.length, event.key === "ArrowDown" ? 1 : -1));
              return;
            }
            if (fileMentionOpen && (event.key === "Enter" || event.key === "Tab")) {
              event.preventDefault();
              const path = matchingMentionPaths[fileMentionActiveIndex];
              if (path) selectProjectFile(path);
              return;
            }
            if (fileMentionOpen && event.key === "Escape") {
              event.preventDefault();
              setDismissedFileMention(fileMentionSignature);
              return;
            }
            if (event.key === "Enter" && event.shiftKey) return;
            if (event.key === "Enter" || matchesShortcut(event, shortcuts["agent.send"])) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Send a follow-up…"
          rows={1}
        />
        <div className="chat-composer-footer">
          <div className="chat-composer-controls">
            {!answeringQuestion && <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={imageInput ? "Attach images" : "Image attachments unsupported"}
              disabled={!imageInput || submitting || attachments.length >= 4}
              title={imageInput ? "Attach images" : "This agent does not support image input"}
              onClick={() => void open({ multiple: true, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }] }).then((selection) => {
                if (typeof selection === "string") attachPaths([selection]);
                else if (selection) attachPaths(selection);
              }).catch((cause) => setAttachmentError(errorMessage(cause)))}
            ><Plus /></Button>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="xs" variant="ghost" className="chat-access-trigger" data-access={agentAccess} aria-label={`Project agent access: ${agentAccess === "full" ? "Full access" : "Agent default"}`}>
                  <Key />{agentAccess === "full" ? "Full access" : "Agent default"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="chat-access-menu" align="start">
                <DropdownMenuLabel>Agent access for this project</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={agentAccess} onValueChange={(value) => void onAgentAccess(value as AgentAccessMode)}>
                  <DropdownMenuRadioItem value="default"><div><strong>Agent default</strong><small>Use the selected agent profile's approval rules.</small></div></DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="full"><div><strong>Full access</strong><small>Allow internet and any local file without approval.</small></div></DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {agentProfile && <>
              <AgentModelPicker profile={agentProfile} cwd={projectRoot} onProfile={(patch) => onAgentProfile(agentProfile.adapterId, patch)} />
            </>}
          </div>
          <div className="chat-composer-actions">
            {canCancel && <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={runtime.status === "canceling" ? "Stopping agent turn" : "Stop agent turn"}
              title="Stop turn"
              disabled={runtime.status === "canceling" || submitting}
              onClick={() => void cancel()}
            ><StopCircle /></Button>}
            <Button
              className="chat-composer-primary"
              type="submit"
              size="icon-sm"
              aria-label={submitting ? "Saving prompt" : editingDeliveryId ? "Save queued prompt" : turnActive ? "Queue prompt" : "Send prompt"}
              title={editingDeliveryId ? "Save queued prompt (Enter)" : turnActive ? "Queue for next turn (Enter)" : "Send (Enter)"}
              disabled={(!prompt.trim() && (!attachments.length || answeringQuestion)) || submitting}
            >
              {submitting ? <DotMatrixLoader variant="loading" size={18} /> : <ArrowUpIcon />}
              <span className="sr-only">{editingDeliveryId ? "Save" : turnActive ? "Queue" : "Send"}</span>
            </Button>
          </div>
        </div>
      </form>}
    </div>
  );
}

export const AgentChat = memo(AgentChatComponent);

function isActivityMessage(item: AgentMessage): boolean {
  return ["commentary", "reasoning", "tool"].includes(item.kind);
}

function isAssistantAnswer(item: AgentMessage): boolean {
  return item.role === "assistant" && item.kind === "message";
}

export function groupAgentMessages(messages: AgentMessage[], currentTurnActive = false): Array<AgentMessage | AgentMessage[]> {
  const grouped: Array<AgentMessage | AgentMessage[]> = [];
  let turn: AgentMessage[] = [];
  const appendTurn = (items: AgentMessage[], completed: boolean) => {
    let activityGroup: AgentMessage[] | undefined;
    let finalAnswer = -1;
    if (completed) {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (!isAssistantAnswer(items[index])) continue;
        if (!items.slice(index + 1).some(isActivityMessage)) finalAnswer = index;
        break;
      }
    }
    items.forEach((item, index) => {
      const collapsible = isActivityMessage(item) || (completed && isAssistantAnswer(item) && index !== finalAnswer);
      if (!collapsible) {
        grouped.push(item);
        activityGroup = undefined;
        return;
      }
      if (!activityGroup) {
        activityGroup = [];
        grouped.push(activityGroup);
      }
      const previousItem = activityGroup.at(-1);
      if (item.kind === "tool" && previousItem?.kind === "tool" && /-agent-\d+-tool$/.test(item.id)) {
        activityGroup[activityGroup.length - 1] = {
          ...previousItem,
          text: `${previousItem.text}${item.text}`,
          streaming: Boolean(previousItem.streaming && item.streaming),
        };
      } else activityGroup.push(item);
    });
  };
  messages.forEach((item) => {
    if (item.role !== "user") {
      turn.push(item);
      return;
    }
    appendTurn(turn, true);
    turn = [];
    grouped.push(item);
  });
  appendTurn(turn, !currentTurnActive);
  return grouped;
}

export function messagesForAgentStatus(messages: AgentMessage[], status: string): AgentMessage[] {
  if (["running", "needs_input", "canceling"].includes(status)) {
    const latest = messages.length - 1;
    if (!messages.some((message, index) => index !== latest && message.streaming && (message.role === "assistant" || message.kind === "reasoning"))) return messages;
    return messages.map((message, index) => index !== latest && message.streaming && (message.role === "assistant" || message.kind === "reasoning")
      ? { ...message, streaming: false }
      : message);
  }
  return messages.map((message) => message.streaming ? { ...message, streaming: false } : message);
}
