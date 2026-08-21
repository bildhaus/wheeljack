import { useId, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { RunStateBadge } from "./RunStateBadge";

export interface ActionCardAction {
  id: string;
  label: string;
  intent?: "primary" | "secondary" | "destructive";
  disabled?: boolean;
  pending?: boolean;
  onInvoke: () => void;
}

interface ActionCardCommon {
  title: string;
  summary?: string;
  status?: string;
  compact?: boolean;
  sticky?: boolean;
  className?: string;
  metadata?: ReactNode;
  children?: ReactNode;
  actions?: ActionCardAction[];
  busy?: boolean;
}

export interface DecisionActionCardProps extends ActionCardCommon {
  variant: "decision";
  decisionType: "approval" | "question";
  interactionState?: "pending" | "submitting" | "approved" | "denied" | "answered" | "canceled";
  draft?: string;
  onDraftChange?: (draft: string) => void;
  placeholder?: string;
  choices?: Array<{ id: string; label: string; description?: string }>;
  onChoice?: (id: string) => void;
}

export interface RecommendationActionCardProps extends ActionCardCommon {
  variant: "recommendation";
  recommendation: string;
  rationale?: string;
}

export interface EvidenceActionCardProps extends ActionCardCommon {
  variant: "evidence";
  source: string;
  details?: ReactNode;
  detailLabel?: string;
}

export interface RecoveryActionCardProps extends ActionCardCommon {
  variant: "recovery";
  error: string;
}

export type ActionCardProps =
  | DecisionActionCardProps
  | RecommendationActionCardProps
  | EvidenceActionCardProps
  | RecoveryActionCardProps;

function stateFor(props: ActionCardProps): string {
  if (props.status) return props.status;
  if (props.variant === "decision") return !props.interactionState || props.interactionState === "pending" ? "needs_input" : props.interactionState;
  if (props.variant === "recommendation") return "review";
  if (props.variant === "recovery") return "failed";
  return "completed";
}

function actionRank(action: ActionCardAction): number {
  return action.intent === "primary" ? 1 : 0;
}

export function ActionCard(props: ActionCardProps) {
  const titleId = useId();
  const pending = Boolean(props.busy || props.actions?.some((action) => action.pending));
  const actions = [...(props.actions ?? [])].sort((left, right) => actionRank(left) - actionRank(right));
  const unresolvedQuestion = props.variant === "decision"
    && props.decisionType === "question"
    && [undefined, "pending", "submitting"].includes(props.interactionState);
  const questionChoices = props.variant === "decision" && unresolvedQuestion ? props.choices ?? [] : [];
  const onChoice = props.variant === "decision" ? props.onChoice : undefined;
  const primaryAction = actions.find((action) => action.intent === "primary");
  const submitFromDraft = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key !== "Enter" || event.shiftKey || !primaryAction || pending || primaryAction.disabled) return;
    event.preventDefault();
    primaryAction.onInvoke();
  };

  return <article
    className={`wj-action-card ${props.className ?? ""}`.trim()}
    data-variant={props.variant}
    data-compact={props.compact || undefined}
    data-sticky={props.sticky || undefined}
    aria-labelledby={titleId}
    aria-busy={pending || undefined}
  >
    <header className="wj-action-card-header">
      <span className="wj-action-card-kicker">{props.variant === "decision" ? props.decisionType : props.variant}</span>
      <RunStateBadge status={stateFor(props)} variant="compact" />
    </header>
    <div className="wj-action-card-copy">
      <strong id={titleId}>{props.title}</strong>
      {props.summary && <p>{props.summary}</p>}
      {props.variant === "recommendation" && <><p className="wj-action-card-recommendation">{props.recommendation}</p>{props.rationale && <small>{props.rationale}</small>}</>}
      {props.variant === "recovery" && <p role="alert">{props.error}</p>}
      {props.variant === "evidence" && <small className="wj-action-card-source">Source: {props.source}</small>}
      {props.metadata && <div className="wj-action-card-metadata">{props.metadata}</div>}
    </div>
    {questionChoices.length > 0 && <div className="wj-action-card-choices" role="group" aria-label="Question choices">{questionChoices.map((choice) => <Button
      key={choice.id}
      type="button"
      size={props.compact ? "xs" : "sm"}
      variant="outline"
      disabled={pending}
      title={choice.description}
      onClick={() => onChoice?.(choice.id)}
    >{choice.label}</Button>)}</div>}
    {unresolvedQuestion && <Textarea
      className="wj-action-card-answer"
      autoFocus={questionChoices.length === 0}
      aria-label="Answer the agent question"
      value={props.draft ?? ""}
      placeholder={props.placeholder ?? (questionChoices.length > 0 ? "Or type a custom answer…" : "Type your answer…")}
      rows={2}
      disabled={pending}
      onChange={(event) => props.onDraftChange?.(event.target.value)}
      onKeyDown={submitFromDraft}
    />}
    {props.children && <div className="wj-action-card-body">{props.children}</div>}
    {props.variant === "evidence" && props.details && <details className="wj-action-card-details"><summary>{props.detailLabel ?? "Show evidence"}</summary><div>{props.details}</div></details>}
    {actions.length > 0 && <footer className="wj-action-card-actions">{actions.map((action) => <Button
      key={action.id}
      type="button"
      size={props.compact ? "xs" : "sm"}
      variant={action.intent === "primary" ? "default" : action.intent === "destructive" ? "destructive" : "ghost"}
      disabled={pending || action.disabled}
      onClick={action.onInvoke}
    >{action.pending ? `${action.label}…` : action.label}</Button>)}</footer>}
  </article>;
}
