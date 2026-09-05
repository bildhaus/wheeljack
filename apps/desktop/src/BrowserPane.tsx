import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { callCore } from "./core";
import { useEventCallback } from "./useEventCallback";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import type { CanvasNode, JsonObject, LifecycleManifest, LifecycleRun } from "./types";

function stringValue(value: JsonObject, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] as string : undefined;
}

function sameUrl(left: string, right?: string): boolean {
  if (!right) return false;
  try { return new URL(left).href === new URL(right).href; } catch { return false; }
}

export default function BrowserPane({ node, projectId, projectRoot, onSave }: { node: CanvasNode; projectId?: string; projectRoot?: string; onSave: (data: JsonObject) => void }) {
  const saveNode = useEventCallback(onSave);
  const initial = stringValue(node.data, "url") ?? "";
  const nodeDataRef = useRef(node.data);
  nodeDataRef.current = node.data;
  const [draft, setDraft] = useState(initial);
  const [url, setUrl] = useState(initial);
  const [reload, setReload] = useState(0);
  const [checkingRun, setCheckingRun] = useState(Boolean(projectId && projectRoot));
  const [error, setError] = useState("");
  const [manifest, setManifest] = useState<LifecycleManifest>();
  const [run, setRun] = useState<LifecycleRun>();
  const [logs, setLogs] = useState("");
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const runId = run?.id;
  const runState = run?.state;
  const activeRun = Boolean(run && ["running", "starting", "ready", "stopping"].includes(run.state));
  useEffect(() => {
    if (!projectId || !projectRoot) return;
    let canceled = false;
    const savedRunId = stringValue(nodeDataRef.current, "lifecycleRunId");
    const savedUrl = stringValue(nodeDataRef.current, "url") ?? "";
    setCheckingRun(true);
    void Promise.all([
      callCore<LifecycleManifest>("project_lifecycle_inspect", { projectId, projectPath: projectRoot }),
      callCore<LifecycleRun | null>("project_lifecycle_current", { projectId, runId: savedRunId }),
    ]).then(([nextManifest, currentRun]) => {
      if (canceled) return;
      setManifest(nextManifest);
      setRun(currentRun ?? undefined);
      if (currentRun) {
        const nextData: JsonObject = { ...nodeDataRef.current, lifecycleRunId: currentRun.id };
        if (currentRun.kind === "preview" && currentRun.url) {
          setDraft(currentRun.url);
          setUrl(currentRun.url);
          nextData.url = currentRun.url;
        }
        if (savedRunId !== currentRun.id || nextData.url !== savedUrl) saveNode(nextData);
      } else if (savedRunId) {
        const { lifecycleRunId: _lifecycleRunId, ...nextData } = nodeDataRef.current;
        saveNode(nextData);
      }
    }).catch((cause) => {
      if (!canceled) {
        setManifest(undefined);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }).finally(() => { if (!canceled) setCheckingRun(false); });
    return () => { canceled = true; };
  }, [projectId, projectRoot, saveNode]);
  useEffect(() => {
    if (!runId || !runState || !["running", "starting", "ready", "stopping"].includes(runState)) return;
    let canceled = false;
    const refresh = () => {
      void callCore<{ text: string }>("project_lifecycle_logs", { runId }).then((value) => { if (!canceled) setLogs(value.text); }).catch(() => undefined);
      if (projectId) void callCore<LifecycleRun[]>("project_lifecycle_runs", { projectId, limit: 20 }).then((runs) => {
        if (canceled) return;
        const latest = runs.find((candidate) => candidate.id === runId);
        if (latest) {
          setRun(latest);
          if (!["running", "starting", "ready", "stopping"].includes(latest.state)
            && stringValue(nodeDataRef.current, "lifecycleRunId") === latest.id) {
            const { lifecycleRunId: _lifecycleRunId, ...nextData } = nodeDataRef.current;
            saveNode(nextData);
          }
        }
      }).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => { canceled = true; window.clearInterval(timer); };
  }, [projectId, runId, runState, saveNode]);
  const trustManifest = async () => {
    if (!manifest || !projectId || !projectRoot) return;
    setLifecycleBusy(true);
    try {
      await callCore("project_lifecycle_trust", { projectId, projectPath: projectRoot, hash: manifest.hash });
      setManifest({ ...manifest, trusted: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLifecycleBusy(false);
    }
  };
  const startLifecycle = async (kind: "setup" | "preview") => {
    if (!projectId || !projectRoot) return;
    setLifecycleBusy(true);
    setError("");
    setLogs("");
    try {
      const next = await callCore<LifecycleRun>("project_lifecycle_start", { projectId, projectPath: projectRoot, kind });
      setRun(next);
      const nextData: JsonObject = { ...nodeDataRef.current, lifecycleRunId: next.id };
      if (kind === "preview" && next.url) {
        setDraft(next.url);
        setUrl(next.url);
        nextData.url = next.url;
      }
      saveNode(nextData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLifecycleBusy(false);
    }
  };
  const stopLifecycle = async () => {
    if (!run || !activeRun) return;
    setLifecycleBusy(true);
    setError("");
    try {
      await callCore("project_lifecycle_stop", { runId: run.id });
      setRun((current) => current?.id === run.id ? { ...current, state: "stopping" } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLifecycleBusy(false);
    }
  };
  const navigate = () => {
    try {
      const candidate = draft.trim();
      const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(candidate)
        ? candidate
        : /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(candidate)
          ? `http://${candidate}`
          : `https://${candidate}`;
      const parsed = new URL(withProtocol);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
      setUrl(parsed.href);
      setDraft(parsed.href);
      setError("");
      saveNode({ ...nodeDataRef.current, url: parsed.href });
      setReload((current) => current + 1);
    } catch {
      setError("Enter an http or https URL.");
    }
  };
  const managedPreview = run?.kind === "preview" && sameUrl(url, run.url);
  const previewPending = checkingRun || (managedPreview && run.state !== "ready");
  const trustedLocalPreview = Boolean(
    manifest?.trusted
    && run?.kind === "preview"
    && sameUrl(url, run.url)
    && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(url),
  );
  return (
    <div className="data-pane-browser">
      {manifest && <section className="browser-lifecycle" aria-label="Project lifecycle">
        <div><strong>Project lifecycle</strong><small>{manifest.trusted ? "Trusted manifest" : "Review required"} · {manifest.hash.slice(0, 10)}</small></div>
        {!manifest.trusted ? <>
          <code>{JSON.stringify({ setup: manifest.setup, preview: manifest.preview }, null, 2)}</code>
          <Button type="button" size="sm" variant="outline" disabled={lifecycleBusy} onClick={() => void trustManifest()}>Trust this manifest</Button>
        </> : <div className="browser-lifecycle-actions">
          {manifest.setup && <Button type="button" size="sm" variant="outline" disabled={lifecycleBusy || activeRun} onClick={() => void startLifecycle("setup")}>Run setup</Button>}
          {manifest.preview && <Button type="button" size="sm" disabled={lifecycleBusy || activeRun} onClick={() => void startLifecycle("preview")}>Start preview</Button>}
          {activeRun && <Button type="button" size="sm" variant="outline" disabled={lifecycleBusy || run?.state === "stopping"} onClick={() => void stopLifecycle()}>{run?.state === "stopping" ? "Stopping…" : "Stop"}</Button>}
          {run && <small>{run.kind} · {run.state}{run.exitCode !== undefined ? ` · exit ${run.exitCode}` : ""}</small>}
        </div>}
        {logs && <pre aria-label="Lifecycle logs">{logs}</pre>}
      </section>}
      <form onSubmit={(event) => { event.preventDefault(); navigate(); }}>
        <Input aria-label="Browser address" value={draft} onChange={(event) => setDraft(event.target.value)} aria-invalid={Boolean(error)} />
        <Button size="sm">Go</Button>
        <Button type="button" size="sm" variant="outline" disabled={!url || previewPending} onClick={() => setReload((current) => current + 1)}>Reload</Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {previewPending ? <div className="data-pane-empty" role="status">{checkingRun ? "Checking preview…" : run?.errorMessage || (activeRun ? "Starting preview. Waiting for the server…" : `Preview ${run?.state ?? "unavailable"}. Start it again to retry.`)}</div> : url ? <div className="browser-preview"><iframe key={reload} title={`Browser preview ${node.title}`} src={url} sandbox={trustedLocalPreview ? "allow-forms allow-scripts allow-same-origin" : "allow-forms allow-scripts"} /><div className="browser-external-fallback"><Button type="button" size="xs" variant="ghost" onClick={() => void invoke("open_external_url", { url }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}>Open externally</Button></div></div> : <div className="data-pane-empty">Enter a URL to preview it.</div>}
    </div>
  );
}
