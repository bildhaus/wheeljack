import Markdown from "react-markdown";
import { Button } from "./components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./components/ui/sheet";
import type { InstalledReleaseInfo, UpdateController } from "./updater";

export function formatUpdateBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unit);
  return `${value.toFixed(unit === 0 || value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[unit]}`;
}

export function formatUpdateDate(value: number | string | undefined, emptyLabel = "Never"): string {
  if (value === undefined) return emptyLabel;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

export function updateAttentionLabel(
  updater: Pick<UpdateController, "status" | "error" | "recoveryError">,
): "Update" | "Restart" | "Error" | undefined {
  if (updater.error || updater.recoveryError || updater.status === "error") return "Error";
  if (updater.status === "ready") return "Restart";
  if (updater.status === "available" || updater.status === "downloading") return "Update";
  return undefined;
}

export function updateStatusLabel(
  updater: Pick<UpdateController, "status" | "error" | "recoveryError">,
): string {
  if (updater.recoveryError) return "Recovery error";
  if (updater.error || updater.status === "error") return "Update error";
  return ({
    idle: "Not checked",
    checking: "Checking…",
    "up-to-date": "Up to date",
    available: "Update available",
    downloading: "Downloading",
    ready: "Ready to install",
    installing: "Restarting",
    disabled: "Disabled",
    error: "Update error",
  } satisfies Record<UpdateController["status"], string>)[updater.status];
}

export function UpdateProgressView({ updater }: { updater: UpdateController }) {
  const progress = updater.progress;
  const downloaded = Math.max(0, progress?.downloadedBytes ?? 0);
  const total = progress?.totalBytes && progress.totalBytes > 0 ? progress.totalBytes : undefined;
  const phase = updater.status === "installing" ? "restarting" : progress?.phase ?? "downloading";
  const percent = phase === "downloading" && total
    ? Math.min(100, Math.round((downloaded / total) * 100))
    : undefined;
  const label = phase === "restarting"
    ? "Restarting wheeljack"
    : phase === "verifying"
      ? "Verifying update"
      : phase === "preparing"
        ? "Preparing update"
        : phase === "ready"
          ? "Update ready"
          : "Downloading update";
  const detail = phase === "restarting"
    ? "The app will reopen automatically."
    : phase === "downloading" && total
      ? `${percent}% · ${formatUpdateBytes(downloaded)} of ${formatUpdateBytes(total)}`
      : phase === "downloading" && downloaded > 0
        ? `${formatUpdateBytes(downloaded)} downloaded`
        : phase === "downloading"
          ? "Starting…"
          : phase === "ready"
            ? "Ready to restart."
            : "Please wait…";
  const valueText = percent === undefined ? `${label}. ${detail}` : `${label}, ${percent}%. ${detail}`;
  return (
    <div className="space-y-1.5" aria-live="polite">
      <progress
        className="wj-update-progress"
        value={percent}
        max={100}
        aria-label={label}
        aria-valuetext={valueText}
      />
      <small className="text-muted-foreground">
        <strong className="font-medium text-foreground">{label}</strong> · {detail}
      </small>
    </div>
  );
}

export function UpdateReleaseNotesSheet({
  open,
  release,
  onDismiss,
}: {
  open: boolean;
  release: InstalledReleaseInfo;
  onDismiss: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onDismiss()}>
      <SheetContent className="wj-whats-new-sheet" side="right">
        <SheetHeader>
          <SheetTitle>What’s new in wheeljack {release.version.replace(/^v/i, "")}</SheetTitle>
          <SheetDescription>
            Your update installed successfully{release.publishedAt ? ` · Published ${formatUpdateDate(release.publishedAt)}` : ""}.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <div className="agent-prose">
            <Markdown skipHtml>{release.notes?.trim() || "This version includes the latest wheeljack improvements and fixes."}</Markdown>
          </div>
        </div>
        <SheetFooter>
          <Button onClick={onDismiss}>Got it</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
