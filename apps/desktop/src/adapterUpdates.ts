import { callCore } from "./core";
import type { AdapterUpdateExecution, AdapterUpdatePreview } from "./types";

export interface AdapterUpdateOutcome {
  execution?: AdapterUpdateExecution;
  summary: string;
}

export async function previewAndRunAdapterUpdates(
  confirm: (title: string, message: string, confirmLabel?: string) => Promise<boolean>,
): Promise<AdapterUpdateOutcome> {
  const preview = await callCore<AdapterUpdatePreview>("adapter_update_preview", {});
  if (!preview.updates.length || !preview.confirmationToken) {
    return {
      summary: preview.skipped.length
        ? preview.skipped.map((item) => `${item.displayName}: ${item.reason}`).join(" ")
        : "No installed coding-agent adapters can be updated.",
    };
  }
  const commands = preview.updates
    .map((item) => `${item.displayName} via ${item.manager}\n${item.command}`)
    .join("\n\n");
  const skipped = preview.skipped.length
    ? `\n\nSkipped:\n${preview.skipped.map((item) => `${item.displayName}: ${item.reason}`).join("\n")}`
    : "";
  const confirmed = await confirm(
    `Update ${preview.updates.length} coding ${preview.updates.length === 1 ? "agent" : "agents"}?`,
    `wheeljack will run these commands sequentially:\n\n${commands}${skipped}`,
    "Update all",
  );
  if (!confirmed) return { summary: "Adapter update canceled." };
  const execution = await callCore<AdapterUpdateExecution>("adapter_update_execute", {
    confirmationToken: preview.confirmationToken,
  });
  const succeeded = execution.results.filter((result) => result.success).length;
  const failed = execution.results.length - succeeded;
  return {
    execution,
    summary: failed
      ? `${succeeded} updated; ${failed} failed. Review the failed adapter details and retry.`
      : `${succeeded} ${succeeded === 1 ? "adapter" : "adapters"} updated.`,
  };
}
