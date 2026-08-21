import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "./components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./components/ui/dropdown-menu";
import { LayoutDashboard, MonitorCog, RefreshCw, Terminal } from "./SargamIcon";
import type { OpsCard, PaneRuntime } from "./types";

export interface TerminalAgentContext {
  label: string;
  card?: OpsCard;
  attentionReason?: string;
}

function supportsAttachedTerminal(runtime: Pick<PaneRuntime, "structured" | "protocol" | "capabilities">): boolean {
  return runtime.structured && (runtime.capabilities?.attachedTerminal ?? runtime.protocol === "opencode-sse");
}

export function PaneAgentMenuItems({
  context,
  runtime,
  agentContext,
  chatView,
  onToggleView,
  onOpenOpsCard,
  onResume,
  onPrepareHandoff,
  onReviewTranscript,
  onQueryStatus,
}: {
  context?: boolean;
  runtime: PaneRuntime;
  agentContext?: TerminalAgentContext;
  chatView: boolean;
  onToggleView: () => void;
  onOpenOpsCard: (card: OpsCard) => void;
  onResume: () => void;
  onPrepareHandoff: () => void;
  onReviewTranscript: () => void;
  onQueryStatus: () => void;
}) {
  const Item = context ? ContextMenuItem : DropdownMenuItem;
  const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator;
  return (
    <>
      {context && <>
        {supportsAttachedTerminal(runtime) && <Item onSelect={onToggleView}>{chatView ? <Terminal /> : <MonitorCog />}{chatView ? "Show terminal" : "Show chat"}</Item>}
        {agentContext?.card && <Item onSelect={() => onOpenOpsCard(agentContext.card!)}><LayoutDashboard />Open Plan task</Item>}
        {["failed", "disconnected"].includes(runtime.status) && <Item onSelect={onResume}><RefreshCw />Resume session</Item>}
        <Separator />
      </>}
      {["running", "starting", "needs_input"].includes(runtime.status) && <Item onSelect={onPrepareHandoff}>Prepare handoff</Item>}
      <Item onSelect={onReviewTranscript}>Review transcript</Item>
      <Item onSelect={onQueryStatus}><RefreshCw />Refresh status</Item>
    </>
  );
}
