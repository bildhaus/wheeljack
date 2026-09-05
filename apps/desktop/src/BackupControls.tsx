import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { callCore } from "./core";
import { Button } from "./components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "./components/ui/alert-dialog";

interface BackupPreview {
  fingerprint: string;
  createdAt: string;
  projectCount: number;
  sessionCount: number;
  attachmentCount: number;
  totalBytes: number;
}

export function BackupControls() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [staged, setStaged] = useState(false);
  const [selection, setSelection] = useState<{ path: string; preview: BackupPreview }>();
  const reportError = (cause: unknown) => setStatus(cause instanceof Error ? cause.message : String(cause));
  useEffect(() => {
    let active = true;
    void callCore<{ pending: boolean; error?: string }>("state_bundle_status", {}).then((result) => {
      if (!active) return;
      setStaged(result.pending);
      if (result.error) setStatus(result.error);
      else if (result.pending) setStatus("Restore is ready. Quit and reopen wheeljack to apply it.");
    }).catch((cause) => { if (active) setStatus(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, []);

  const chooseBackup = async (restore: boolean) => {
    setBusy(true);
    setStatus("");
    try {
      const parent = await open({ directory: true, multiple: false, title: restore ? "Choose a wheeljack backup folder" : "Choose where to save the backup folder" });
      if (typeof parent !== "string") return;
      if (restore) {
        const preview = await callCore<BackupPreview>("state_bundle_preview", { path: parent });
        setSelection({ path: parent, preview });
      } else {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const path = `${parent.replace(/[\\/]$/, "")}/wheeljack-backup-${stamp}`;
        setStatus("Exporting workspace state and attachments…");
        const preview = await callCore<BackupPreview>("state_bundle_export", { path });
        setStatus(`Backup saved to ${path} (${preview.attachmentCount} attachments). Keep the whole folder together.`);
      }
    } catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };

  const restore = async () => {
    if (!selection || busy) return;
    setBusy(true);
    try {
      await callCore("state_bundle_restore", { path: selection.path, fingerprint: selection.preview.fingerprint });
      setSelection(undefined);
      setStaged(true);
      setStatus("Restore is ready. Quit and reopen wheeljack to apply it. A complete recovery backup of the current state will be saved in the app-data folder before replacement.");
    } catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };

  return <div className="mt-4 space-y-2">
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy || staged} onClick={() => void chooseBackup(false)}>Export complete backup</Button>
      <Button variant="outline" disabled={busy || staged} onClick={() => void chooseBackup(true)}>Restore backup</Button>
    </div>
    <p className="text-xs text-muted-foreground">Complete backups include workspace state and referenced image attachments. Project folders and agent credentials stay separate.</p>
    {status && <p className="break-all text-sm" role="status">{status}</p>}
    <AlertDialog open={Boolean(selection)} onOpenChange={(open) => { if (!open && !busy) setSelection(undefined); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore this backup on next launch?</AlertDialogTitle>
          <AlertDialogDescription>
            {selection && <>Created {new Date(selection.preview.createdAt).toLocaleString()}: {selection.preview.projectCount} projects, {selection.preview.sessionCount} sessions, and {selection.preview.attachmentCount} attachments. </>}
            This replaces wheeljack’s workspace state and settings when you quit and reopen the app. Your project files are unaffected. A complete recovery backup of the current state will be saved first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void restore(); }}>{busy ? "Preparing restore…" : "Restore on next launch"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
