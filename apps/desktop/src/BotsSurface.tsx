import { useMemo, useState } from "react";
import { AgentAvatar } from "./AgentAvatar";
import { isActiveSessionStatus } from "./agentRuntime";
import { Briefcase, Globe, Play, Plus, Spark, Trash2 } from "./SargamIcon";
import { botDraftValid, BotProfileFields, BotScopeControl, SpecialistProposalDialog } from "./SpecialistProposalDialog";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./components/ui/sheet";
import { type Adapter, type BotProfile, type BotProfileInput, type BotSnapshot, type PaneRuntime, type Project } from "./types";

export { SpecialistProposalDialog };

type Filter = "all" | "global" | "project";

export function BotsSurface({
  bots,
  oneOffs,
  adapters,
  project,
  runtimes,
  loading,
  onCreate,
  onSave,
  onDelete,
  onStart,
  onSaveOneOff,
}: {
  bots: BotProfile[];
  oneOffs: BotSnapshot[];
  adapters: Adapter[];
  project?: Project;
  runtimes: PaneRuntime[];
  loading: boolean;
  onCreate: () => void;
  onSave: (bot: BotProfileInput) => Promise<BotProfile>;
  onDelete: (bot: BotProfile) => void;
  onStart: (bot: BotProfile) => void;
  onSaveOneOff: (snapshot: BotSnapshot) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<BotProfile>();
  const [editing, setEditing] = useState<BotProfileInput>();
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const visible = bots.filter((bot) => filter === "all" || bot.scope === filter);
  const activeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const runtime of runtimes) {
      if (!isActiveSessionStatus(runtime.status)) continue;
      const profileId = runtime.botProfileId;
      if (profileId) counts.set(profileId, (counts.get(profileId) ?? 0) + 1);
    }
    return counts;
  }, [runtimes]);
  const beginEdit = (bot: BotProfile) => {
    setSelected(bot);
    setEditing({ ...bot, launch: { ...bot.launch } });
    setSaveError("");
  };
  const updateEdit = (patch: Partial<BotProfileInput>) => setEditing((current) => current ? { ...current, ...patch } : current);
  const updateLaunch = (patch: Partial<BotProfileInput["launch"]>) => setEditing((current) => current ? { ...current, launch: { ...current.launch, ...patch } } : current);
  const editValid = botDraftValid(editing, project);
  const saveEdit = async () => {
    if (!editing || !editValid) return;
    setSaveBusy(true);
    setSaveError("");
    try {
      const saved = await onSave({
        ...editing,
        projectId: editing.scope === "project" ? project?.id : undefined,
        name: editing.name.trim(),
        roleDescription: editing.roleDescription.trim(),
      });
      setSelected(saved);
      setEditing(undefined);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaveBusy(false);
    }
  };

  return (
    <main className="wj-page wj-bots-page" aria-busy={loading} aria-labelledby="bots-heading">
      <section className="wj-page-heading">
        <div><h1 id="bots-heading">Bots</h1><p>Reusable specialist profiles.</p></div>
        <Button onClick={onCreate}><Plus />Create bot</Button>
      </section>
      <div className="wj-bot-toolbar" role="group" aria-label="Bot scope">
        {(["all", "global", "project"] as const).map((value) => <Button key={value} size="sm" variant={filter === value ? "secondary" : "ghost"} disabled={value === "project" && !project} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "global" ? "Global" : project?.name ?? "Current project"}</Button>)}
      </div>

      {oneOffs.length > 0 && filter !== "global" && <section className="wj-bot-section">
        <div className="wj-bot-section-heading"><div><span className="wj-specialist-kicker"><Spark />Suggested to save</span><h2>Recent one-offs</h2></div><small>Unsaved automatic specialists.</small></div>
        <div className="wj-bot-grid">
          {oneOffs.map((snapshot) => <article className="wj-bot-card one-off" key={snapshot.avatarSeed}>
            <AgentAvatar id={snapshot.avatarSeed} label={snapshot.name} status="idle" className="wj-agent-avatar-card" />
            <div className="wj-bot-card-copy"><div><h3>{snapshot.name}</h3><Badge variant="outline">One-off</Badge></div><p>{snapshot.roleDescription}</p><span>{snapshot.launch.model || snapshot.launch.adapterId}{snapshot.launch.thinking ? ` · ${snapshot.launch.thinking}` : ""}</span></div>
            <Button size="sm" variant="outline" onClick={() => onSaveOneOff(snapshot)}>Save as bot</Button>
          </article>)}
        </div>
      </section>}

      <section className="wj-bot-section">
        <div className="wj-bot-section-heading"><div><span className="wj-specialist-kicker"><Briefcase />Roster</span><h2>{filter === "global" ? "Global bots" : filter === "project" ? `${project?.name ?? "Project"} bots` : "Your bots"}</h2></div><small>{visible.length} saved</small></div>
        {visible.length > 0 ? <div className="wj-bot-grid">
          {visible.map((bot) => {
            const active = activeCounts.get(bot.id) ?? 0;
            return <article className="wj-bot-card" key={bot.id}>
              <button className="wj-bot-card-main" type="button" onClick={() => setSelected(bot)}>
                <AgentAvatar id={bot.avatarSeed} label={bot.name} status={active ? "running" : "idle"} className="wj-agent-avatar-card" />
                <span className="wj-bot-card-copy"><span><strong className="wj-bot-card-name">{bot.name}</strong><Badge variant={bot.scope === "global" ? "secondary" : "outline"}>{bot.scope === "global" ? <><Globe />Global</> : <><Briefcase />Project</>}</Badge></span><p>{bot.roleDescription}</p><small>{bot.launch.model || bot.launch.adapterId}{bot.launch.thinking ? ` · ${bot.launch.thinking}` : ""}</small></span>
              </button>
              <div className="wj-bot-card-stats"><span><strong>{active}</strong> active</span><span><strong>{bot.launchCount}</strong> launches</span><span>{bot.lastUsedAt ? new Date(bot.lastUsedAt).toLocaleDateString() : "Not used yet"}</span></div>
              <div className="wj-bot-card-actions"><Button size="sm" disabled={!project} onClick={() => onStart(bot)}><Play />Start in Work</Button><Button size="sm" variant="ghost" onClick={() => beginEdit(bot)}>Edit</Button></div>
            </article>;
          })}
        </div> : <div className="wj-bot-empty"><Briefcase /><h3>No bots here yet</h3><p>Create or save a proposed specialist.</p><Button variant="outline" onClick={onCreate}><Plus />Create bot</Button></div>}
      </section>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open && !saveBusy) { setSelected(undefined); setEditing(undefined); setSaveError(""); } }}>
        <SheetContent className="wj-bot-detail" side="right">
          {selected && <>
            <SheetHeader><SheetTitle>{selected.name}</SheetTitle><SheetDescription>{selected.scope === "global" ? "Everywhere" : project?.name ?? "This project"}</SheetDescription></SheetHeader>
            <div className="wj-bot-detail-hero"><AgentAvatar id={selected.avatarSeed} label={selected.name} status={(activeCounts.get(selected.id) ?? 0) ? "running" : "idle"} className="wj-agent-avatar-hero" />{!editing && <p>{selected.roleDescription}</p>}</div>
            {editing ? <div className="wj-bot-detail-editor">
              <BotProfileFields idPrefix="bot-detail" draft={editing} adapters={adapters} onChange={setEditing} onLaunchChange={updateLaunch} />
              <BotScopeControl scope={editing.scope} project={project} disabled={saveBusy} onChange={(scope) => updateEdit({ scope, projectId: scope === "project" ? project?.id : undefined })} />
              {saveError && <p className="wj-specialist-error" role="alert">{saveError}</p>}
            </div> : <dl><div><dt>Launch</dt><dd>{selected.launch.adapterId} · {selected.launch.model || "default model"} · {selected.launch.thinking || "default effort"}</dd></div></dl>}
            <div className="wj-bot-detail-actions">{editing ? <><Button variant="ghost" disabled={saveBusy} onClick={() => { setEditing(undefined); setSaveError(""); }}>Cancel</Button><Button disabled={saveBusy || !editValid} onClick={() => void saveEdit()}>{saveBusy ? "Saving…" : "Save changes"}</Button></> : <><Button disabled={!project} onClick={() => onStart(selected)}><Play />Start in Work</Button><Button variant="outline" onClick={() => beginEdit(selected)}>Edit</Button><Button variant="destructive" onClick={() => { setSelected(undefined); onDelete(selected); }}><Trash2 />Delete</Button></>}</div>
          </>}
        </SheetContent>
      </Sheet>
    </main>
  );
}
