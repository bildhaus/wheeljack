import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "./components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { callCore } from "./core";
import { ProviderMark } from "./ProviderMark";
import { resolveRunState } from "./runState";
import { ChevronRight, RefreshCw, Trash2 } from "./SargamIcon";
import type {
  UsageAmounts,
  UsageBillingOverride,
  UsageBreakdown,
  UsageDashboard,
  UsageFilters,
  UsageRange,
  UsageSessionRow,
} from "./usage";

const rangeLabels: Record<UsageRange, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  all: "All time",
};

const numberFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function rangeBounds(range: UsageRange): Pick<UsageFilters, "from" | "to"> {
  const now = new Date();
  if (range === "all") return { to: now.toISOString() };
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === "7d") start.setDate(start.getDate() - 6);
  if (range === "30d") start.setDate(start.getDate() - 29);
  return { from: start.toISOString(), to: now.toISOString() };
}

export function formatUsageCost(amounts: UsageAmounts): string {
  if (amounts.pricedRecords === 0) return amounts.unpricedRecords > 0 ? "Unpriced" : "$0.00";
  const dollars = amounts.costNanoUsd / 1_000_000_000;
  const digits = dollars >= 1 ? 2 : dollars >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(dollars);
}

function provenance(amounts: UsageAmounts): string {
  if (amounts.pricedRecords > 0 && amounts.unpricedRecords > 0) return "Mixed";
  return amounts.pricedRecords > 0 ? "Reported" : "Unpriced";
}

function filterValue(value: string): string | undefined {
  return value === "all" ? undefined : value;
}

function UsageFilter({
  label,
  value,
  options,
  onValue,
}: {
  label: string;
  value?: string;
  options: Array<{ key: string; label: string }>;
  onValue: (value?: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <label className="wj-usage-filter">
      <span>{label}</span>
      <Select value={value ?? "all"} onValueChange={(next) => onValue(filterValue(next))}>
        <SelectTrigger size="sm" aria-label={`Filter by ${label.toLowerCase()}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All {label.toLowerCase()}</SelectItem>
          {options.map((option) => <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="wj-usage-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function SpendChart({ dashboard }: { dashboard: UsageDashboard }) {
  const points = dashboard.daily;
  const maximum = Math.max(1, ...points.map((point) => point.totals.costNanoUsd));
  const width = Math.max(640, points.length * 18);
  if (points.length === 0) {
    return <div className="wj-usage-chart-empty">Spend appears after a metered API session reports usage.</div>;
  }
  return (
    <div className="wj-usage-chart-scroll">
      <svg className="wj-usage-chart" viewBox={`0 0 ${width} 150`} role="img" aria-label="Reported API spend by day">
        <title>Reported API spend by day</title>
        <line x1="0" y1="124" x2={width} y2="124" />
        {points.map((point, index) => {
          const x = index * (width / points.length) + 4;
          const barWidth = Math.max(3, width / points.length - 8);
          const height = point.totals.costNanoUsd === 0 ? 1 : Math.max(3, (point.totals.costNanoUsd / maximum) * 104);
          return (
            <g key={point.day}>
              <rect x={x} y={124 - height} width={barWidth} height={height} rx="2">
                <title>{point.day}: {formatUsageCost(point.totals)}</title>
              </rect>
              {(points.length <= 14 || index === 0 || index === points.length - 1) && (
                <text x={x + barWidth / 2} y="143" textAnchor="middle">{point.day.slice(5)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: UsageBreakdown[] }) {
  return (
    <section className="wj-usage-panel">
      <header><h2>{title}</h2><span>{rows.length}</span></header>
      {rows.length === 0 ? <p className="wj-usage-panel-empty">No metered API usage in this range.</p> : (
        <div className="wj-usage-table-scroll">
          <table className="wj-usage-table">
            <thead><tr><th>{title.slice(0, -1)}</th><th>Spend</th><th>Input</th><th>Output</th><th>Coverage</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td title={row.label}>{row.label}</td>
                  <td>{formatUsageCost(row.totals)}</td>
                  <td>{numberFormat.format(row.totals.inputTokens)}</td>
                  <td>{numberFormat.format(row.totals.outputTokens)}</td>
                  <td><span className="wj-usage-provenance" data-kind={provenance(row.totals).toLowerCase()}>{provenance(row.totals)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function UsageSurface({
  refreshKey,
  onOpenSession,
}: {
  refreshKey: number;
  onOpenSession: (session: UsageSessionRow) => void;
}) {
  const [range, setRange] = useState<UsageRange>("30d");
  const [filters, setFilters] = useState<Omit<UsageFilters, "from" | "to" | "sessionCursor" | "sessionLimit">>({});
  const [dashboard, setDashboard] = useState<UsageDashboard>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clearOpen, setClearOpen] = useState(false);

  const query = useMemo<UsageFilters>(() => ({
    ...rangeBounds(range),
    ...filters,
    sessionLimit: 25,
  }), [filters, range]);

  const load = useCallback(async (cursor?: string) => {
    setBusy(true);
    setError("");
    try {
      const next = await callCore<UsageDashboard>("usage_dashboard", {
        ...query,
        ...(cursor ? { sessionCursor: cursor } : {}),
      });
      setDashboard((current) => cursor && current
        ? { ...next, sessions: [...current.sessions, ...next.sessions] }
        : next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [query]);

  useEffect(() => { void refreshKey; void load(); }, [load, refreshKey]);

  const classify = async (override: UsageBillingOverride) => {
    setBusy(true);
    try {
      await callCore("usage_billing_override_set", { ...override });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const clearUsage = async () => {
    setBusy(true);
    try {
      await callCore("usage_clear", {});
      setClearOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const hasMeteredUsage = Boolean(dashboard && (dashboard.totals.pricedRecords + dashboard.totals.unpricedRecords > 0));
  return (
    <main className="wj-usage-page" aria-labelledby="usage-surface-heading" aria-busy={busy || undefined}>
      <header className="wj-usage-heading">
        <div>
          <h1 id="usage-surface-heading">API usage</h1>
          <p>Local accounting for metered API sessions launched by wheeljack. Subscription usage is excluded.</p>
        </div>
        <div>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void load()}><RefreshCw />Refresh</Button>
          <Button variant="ghost" size="sm" disabled={busy || !dashboard} onClick={() => setClearOpen(true)}><Trash2 />Clear data</Button>
        </div>
      </header>

      <section className="wj-usage-controls" aria-label="Usage range and filters">
        <div className="wj-usage-ranges">
          {(Object.keys(rangeLabels) as UsageRange[]).map((value) => (
            <Button key={value} size="sm" variant={range === value ? "secondary" : "ghost"} aria-pressed={range === value} onClick={() => setRange(value)}>{rangeLabels[value]}</Button>
          ))}
        </div>
        {dashboard && <div className="wj-usage-filters">
          <UsageFilter label="Projects" value={filters.projectId} options={dashboard.options.projects} onValue={(projectId) => setFilters((current) => ({ ...current, projectId }))} />
          <UsageFilter label="Adapters" value={filters.adapterId} options={dashboard.options.adapters} onValue={(adapterId) => setFilters((current) => ({ ...current, adapterId }))} />
          <UsageFilter label="Providers" value={filters.providerId} options={dashboard.options.providers} onValue={(providerId) => setFilters((current) => ({ ...current, providerId }))} />
          <UsageFilter label="Models" value={filters.modelId} options={dashboard.options.models} onValue={(modelId) => setFilters((current) => ({ ...current, modelId }))} />
        </div>}
      </section>

      {error && <div className="wj-usage-error" role="alert">Could not load usage: {error}</div>}
      {!dashboard && !error && <div className="wj-usage-loading">Loading local usage…</div>}
      {dashboard && <>
        {dashboard.coverage.pendingProfiles.map((profile) => (
          <aside className="wj-usage-classification" key={`${profile.adapterId}:${profile.providerId}`}>
            <div>
              <strong>Classify {profile.providerId} for {profile.adapterId}</strong>
              <p>{profile.recordCount} {profile.recordCount === 1 ? "record is" : "records are"} excluded until this profile is identified as API-backed or subscription-backed.</p>
            </div>
            <div>
              <Button size="sm" disabled={busy} onClick={() => void classify({ adapterId: profile.adapterId, providerId: profile.providerId, billingKind: "api" })}>API usage</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void classify({ adapterId: profile.adapterId, providerId: profile.providerId, billingKind: "subscription" })}>Subscription / ignore</Button>
            </div>
          </aside>
        ))}

        <section className="wj-usage-metrics" aria-label="API usage totals">
          <MetricCard label="Reported spend" value={formatUsageCost(dashboard.totals)} detail={dashboard.totals.unpricedRecords > 0 ? `${dashboard.totals.unpricedRecords} unpriced` : "CLI-reported USD"} />
          <MetricCard label="Input" value={numberFormat.format(dashboard.totals.inputTokens)} detail="provider-reported tokens" />
          <MetricCard label="Output" value={numberFormat.format(dashboard.totals.outputTokens)} detail="provider-reported tokens" />
          <MetricCard label="Reasoning" value={numberFormat.format(dashboard.totals.reasoningTokens)} detail="kept separate from output" />
          <MetricCard label="Cache" value={numberFormat.format(dashboard.totals.cacheReadTokens + dashboard.totals.cacheWriteTokens)} detail={`${numberFormat.format(dashboard.totals.cacheReadTokens)} read · ${numberFormat.format(dashboard.totals.cacheWriteTokens)} write`} />
        </section>

        {!hasMeteredUsage ? (
          <section className="wj-usage-empty">
            <strong>No metered API usage yet</strong>
            <p>Tracking starts with this wheeljack upgrade. Run an API-backed Codex, Claude, OpenCode, or Pi session to populate the dashboard.</p>
          </section>
        ) : <>
          <section className="wj-usage-panel wj-usage-spend-panel">
            <header><h2>Reported spend by day</h2><span>USD · local time</span></header>
            <SpendChart dashboard={dashboard} />
          </section>
          <div className="wj-usage-breakdowns">
            <BreakdownTable title="Providers" rows={dashboard.providers} />
            <BreakdownTable title="Models" rows={dashboard.models} />
            <BreakdownTable title="Projects" rows={dashboard.projects} />
          </div>
          <section className="wj-usage-panel wj-usage-sessions-panel">
            <header>
              <div><h2>Recent sessions</h2><p>Jump back into a session and its transcript.</p></div>
              <span>{dashboard.sessions.length} shown</span>
            </header>
            <div className="wj-usage-session-list">
              {dashboard.sessions.map((session) => {
                const state = resolveRunState(session.status);
                return (
                  <button
                    type="button"
                    className="wj-usage-session-row"
                    key={session.sessionId}
                    aria-label={`Open ${session.nodeTitle} session`}
                    onClick={() => onOpenSession(session)}
                  >
                    <span className="wj-usage-session-identity">
                      <strong>{session.nodeTitle}</strong>
                      <small>{session.projectName ?? "Other sessions"}</small>
                    </span>
                    <span className="wj-usage-session-runtime">
                      <span><ProviderMark adapterId={session.adapterId} />{session.providerId}</span>
                      <small>{session.modelId ?? session.adapterId}</small>
                    </span>
                    <span className="wj-usage-session-totals">
                      <strong>{formatUsageCost(session.totals)}</strong>
                      <small>{numberFormat.format(session.totals.inputTokens)} in · {numberFormat.format(session.totals.outputTokens)} out</small>
                    </span>
                    <span className="wj-usage-session-meta">
                      <span className="wj-usage-session-status" data-tone={state.tone}>{state.label}</span>
                      <time dateTime={session.lastOccurredAt}>{dateFormat.format(new Date(session.lastOccurredAt))}</time>
                    </span>
                    <ChevronRight />
                  </button>
                );
              })}
            </div>
            {dashboard.nextCursor && <footer className="wj-usage-load-more"><Button variant="outline" size="sm" disabled={busy} onClick={() => void load(dashboard.nextCursor)}>Load more</Button></footer>}
          </section>
        </>}

        {(dashboard.coverage.unpricedRecords > 0
          || dashboard.coverage.excludedSubscriptionRecords > 0
          || dashboard.coverage.unsupportedSessions > 0
          || dashboard.coverage.supportedSessionsWithoutUsage > 0) && (
          <aside className="wj-usage-coverage" aria-label="Usage coverage">
            <strong>Coverage</strong>
            <div>
              {dashboard.coverage.unpricedRecords > 0 && <span>{dashboard.coverage.unpricedRecords} unpriced</span>}
              {dashboard.coverage.excludedSubscriptionRecords > 0 && <span>{dashboard.coverage.excludedSubscriptionRecords} subscription-excluded</span>}
              {dashboard.coverage.supportedSessionsWithoutUsage > 0 && <span>{dashboard.coverage.supportedSessionsWithoutUsage} supported sessions without usage</span>}
              {dashboard.coverage.unsupportedSessions > 0 && <span>{dashboard.coverage.unsupportedSessions} unsupported sessions</span>}
            </div>
          </aside>
        )}
      </>}

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all API usage data?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the local usage ledger. Transcripts, sessions, and billing classifications are not removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={(event) => { event.preventDefault(); void clearUsage(); }}>Clear usage data</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
