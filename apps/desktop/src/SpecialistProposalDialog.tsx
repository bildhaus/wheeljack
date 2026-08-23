import { useEffect, useState } from "react";
import { AgentAvatar } from "./AgentAvatar";
import { ProviderMark } from "./ProviderMark";
import { Briefcase, CheckIcon, Globe, Spark } from "./SargamIcon";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { agentEffortOptions, type Adapter, type BotProfileInput, type Project } from "./types";

export type SpecialistDialogIntent = "proposal" | "create" | "save-one-off";
export type SpecialistDialogAction = "launch-once" | "save" | "save-and-launch";

export interface SpecialistDialogRequest {
  key: string;
  intent: SpecialistDialogIntent;
  initial: BotProfileInput;
  rationale?: string;
  targetTask?: string;
  allowLaunch: boolean;
}

export interface SpecialistReadiness {
  label: "Checking" | "Ready" | "Verify" | "Unavailable";
  message: string;
}

export function botDraftValid(draft: BotProfileInput | undefined, project?: Project): boolean {
  return Boolean(draft?.name.trim() && draft.name.trim().length <= 80
    && draft.roleDescription.trim() && draft.roleDescription.trim().length <= 4_000
    && draft.launch.adapterId && (draft.scope === "global" || project));
}

export function BotProfileFields({
  idPrefix,
  draft,
  adapters,
  onChange,
  onLaunchChange,
}: {
  idPrefix: string;
  draft: BotProfileInput;
  adapters: Adapter[];
  onChange: (next: BotProfileInput) => void;
  onLaunchChange: (patch: Partial<BotProfileInput["launch"]>) => void;
}) {
  return <>
    <div>
      <Label htmlFor={`${idPrefix}-name`}>Name</Label>
      <Input id={`${idPrefix}-name`} maxLength={80} value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
    </div>
    <div>
      <Label htmlFor={`${idPrefix}-description`}>Standing role</Label>
      <Textarea id={`${idPrefix}-description`} maxLength={4_000} rows={4} value={draft.roleDescription} onChange={(event) => onChange({ ...draft, roleDescription: event.target.value })} />
    </div>
    <div className="wj-specialist-editor-grid">
      <div>
        <Label>Adapter</Label>
        <Select value={draft.launch.adapterId} onValueChange={(adapterId) => onLaunchChange({ adapterId })}>
          <SelectTrigger aria-label="Bot adapter"><SelectValue /></SelectTrigger>
          <SelectContent>{adapters.filter((adapter) => adapter.id !== "generic-shell").map((adapter) => <SelectItem key={adapter.id} value={adapter.id}>{adapter.displayName}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-model`}>Model</Label>
        <Input id={`${idPrefix}-model`} value={draft.launch.model ?? ""} onChange={(event) => onLaunchChange({ model: event.target.value || undefined })} />
      </div>
      <div>
        <Label>Effort</Label>
        <Select value={draft.launch.thinking ?? "medium"} onValueChange={(thinking) => onLaunchChange({ thinking: thinking as BotProfileInput["launch"]["thinking"] })}>
          <SelectTrigger aria-label="Bot effort"><SelectValue /></SelectTrigger>
          <SelectContent>{agentEffortOptions(draft.launch.adapterId).map((effort) => <SelectItem key={effort} value={effort}>{effort}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  </>;
}

export function BotScopeControl({
  scope,
  project,
  disabled,
  onChange,
}: {
  scope: BotProfileInput["scope"];
  project?: Project;
  disabled?: boolean;
  onChange: (scope: BotProfileInput["scope"]) => void;
}) {
  return <>
    <div className="wj-specialist-scope" role="radiogroup" aria-label="Save bot scope">
      <button type="button" role="radio" aria-checked={scope === "project"} disabled={!project || disabled} onClick={() => onChange("project")}><Briefcase /><span><strong>This project</strong><small>{project?.name ?? "Open a project first"}</small></span></button>
      <button type="button" role="radio" aria-checked={scope === "global"} disabled={disabled} onClick={() => onChange("global")}><Globe /><span><strong>Everywhere</strong><small>All local projects</small></span></button>
    </div>
    <p className="wj-specialist-authority">Uses this project’s current agent permissions. Saving this profile grants no additional access.</p>
  </>;
}

export function SpecialistProposalDialog({
  request,
  project,
  adapters,
  onDismiss,
  onReadiness,
  onVerify,
  onAction,
}: {
  request?: SpecialistDialogRequest;
  project?: Project;
  adapters: Adapter[];
  onDismiss: () => void;
  onReadiness: (draft: BotProfileInput) => Promise<SpecialistReadiness>;
  onVerify: (draft: BotProfileInput) => Promise<SpecialistReadiness>;
  onAction: (action: SpecialistDialogAction, draft: BotProfileInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<BotProfileInput | undefined>(request?.initial);
  const [readiness, setReadiness] = useState<SpecialistReadiness>({ label: "Checking", message: "Checking launch profile…" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(request?.initial);
    setBusy(false);
    setError("");
    setReadiness({ label: "Checking", message: "Checking launch profile…" });
  }, [request?.initial, request?.key]);

  const readinessKey = draft
    ? JSON.stringify([draft.launch.adapterId, draft.launch.provider, draft.launch.model, draft.launch.thinking])
    : "";
  useEffect(() => {
    if (!draft || !request) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void onReadiness(draft)
        .then((next) => active && setReadiness(next))
        .catch((cause) => active && setReadiness({ label: "Unavailable", message: cause instanceof Error ? cause.message : String(cause) }));
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draft, onReadiness, readinessKey, request]);

  const selectedAdapter = adapters.find((adapter) => adapter.id === draft?.launch.adapterId);
  const valid = botDraftValid(draft, project);
  const title = request?.intent === "proposal"
    ? `Meet ${draft?.name || "your specialist"}`
    : draft?.name || (request?.intent === "save-one-off" ? "Save specialist" : "Create bot");
  const showArrival = request?.intent === "proposal";
  const statusVariant = readiness.label === "Ready" ? "secondary" : readiness.label === "Unavailable" ? "destructive" : "outline";

  const updateLaunch = (patch: Partial<BotProfileInput["launch"]>) => {
    setDraft((current) => current ? { ...current, launch: { ...current.launch, ...patch } } : current);
    setReadiness({ label: "Checking", message: "Checking launch profile…" });
    setError("");
  };

  const perform = async (action: SpecialistDialogAction) => {
    if (!draft || !valid) return;
    setBusy(true);
    setError("");
    try {
      await onAction(action, {
        ...draft,
        projectId: draft.scope === "project" ? project?.id : undefined,
        name: draft.name.trim(),
        roleDescription: draft.roleDescription.trim(),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      setReadiness({ label: "Checking", message: "Verifying without changing files…" });
      setReadiness(await onVerify(draft));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={Boolean(request)} onOpenChange={(open) => !open && !busy && onDismiss()}>
      {request && draft && <AlertDialogContent className="wj-specialist-dialog">
        <div className="wj-specialist-hero" data-arrival={showArrival || undefined}>
          <span className="wj-specialist-kicker"><Spark />{showArrival ? "Specialist proposed" : "Bot profile"}</span>
          <div className="wj-specialist-avatar-stage">
            <AgentAvatar id={draft.avatarSeed || request.key} label={draft.name || "Specialist"} status={readiness.label === "Ready" ? "ready" : "idle"} className="wj-agent-avatar-hero" />
          </div>
          <AlertDialogHeader className="items-center text-center">
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription className="wj-specialist-role-line">{draft.roleDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          {request.targetTask && <span className="wj-specialist-task"><CheckIcon />Suggested for {request.targetTask}</span>}
        </div>

        <div className="wj-specialist-body">
          <div className="wj-specialist-summary">
            <div><ProviderMark adapterId={draft.launch.adapterId} /><span><strong>{selectedAdapter?.displayName ?? draft.launch.adapterId}</strong><small>{[draft.launch.model, draft.launch.thinking].filter(Boolean).join(" · ") || "Default model profile"}</small></span></div>
            <Badge variant={statusVariant}>{readiness.label}</Badge>
            {(readiness.label === "Verify" || readiness.label === "Unavailable") && <div className="wj-specialist-readiness">
              <span>{readiness.message}</span>
              {readiness.label === "Verify" && <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => void verify()}>Verify</Button>}
            </div>}
          </div>

          <details key={request.key} className="wj-specialist-editor">
            <summary>Edit details</summary>
            <div className="wj-specialist-editor-content">
              {request.rationale && <p className="wj-specialist-rationale"><strong>Why suggested</strong>{request.rationale}</p>}
              <BotProfileFields idPrefix="specialist" draft={draft} adapters={adapters} onChange={setDraft} onLaunchChange={updateLaunch} />
            </div>
          </details>

          <BotScopeControl scope={draft.scope} project={project} disabled={busy} onChange={(scope) => setDraft({ ...draft, scope, projectId: scope === "project" ? project?.id : undefined })} />
          {error && <p className="wj-specialist-error" role="alert">{error}</p>}
        </div>

        <AlertDialogFooter className="wj-specialist-actions">
          <AlertDialogCancel disabled={busy} onClick={onDismiss}>Not now</AlertDialogCancel>
          {request.allowLaunch && <Button type="button" variant={request.intent === "proposal" ? "default" : "outline"} autoFocus={request.intent === "proposal"} disabled={busy || !valid || readiness.label !== "Ready"} onClick={() => void perform("launch-once")}>Launch once</Button>}
          <Button type="button" variant={request.intent === "proposal" ? "outline" : "default"} disabled={busy || !valid || (request.allowLaunch && readiness.label !== "Ready")} onClick={() => void perform(request.allowLaunch ? "save-and-launch" : "save")}>{busy ? "Working…" : request.allowLaunch ? draft.id ? "Retry launch" : "Save & launch" : "Save bot"}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>}
    </AlertDialog>
  );
}
