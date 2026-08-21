export interface UsageAmounts {
  costNanoUsd: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  pricedRecords: number;
  unpricedRecords: number;
}

export interface UsageBreakdown {
  key: string;
  label: string;
  totals: UsageAmounts;
}

export interface UsageDailyPoint {
  day: string;
  totals: UsageAmounts;
}

export interface UsageSessionRow {
  sessionId: string;
  nodeId: string;
  nodeTitle: string;
  adapterId: string;
  providerId: string;
  modelId?: string;
  projectId?: string;
  projectName?: string;
  cwd: string;
  status: string;
  startedAt: string;
  lastOccurredAt: string;
  totals: UsageAmounts;
}

export interface UsagePendingProfile {
  adapterId: string;
  providerId: string;
  recordCount: number;
}

export interface UsageCoverage {
  unpricedRecords: number;
  excludedSubscriptionRecords: number;
  unknownRecords: number;
  unsupportedSessions: number;
  supportedSessionsWithoutUsage: number;
  pendingProfiles: UsagePendingProfile[];
}

export interface UsageFilterOption {
  key: string;
  label: string;
}

export interface UsageFilterOptions {
  adapters: UsageFilterOption[];
  providers: UsageFilterOption[];
  models: UsageFilterOption[];
  projects: UsageFilterOption[];
}

export interface UsageDashboard {
  totals: UsageAmounts;
  daily: UsageDailyPoint[];
  providers: UsageBreakdown[];
  models: UsageBreakdown[];
  projects: UsageBreakdown[];
  sessions: UsageSessionRow[];
  nextCursor?: string;
  coverage: UsageCoverage;
  options: UsageFilterOptions;
}

export interface UsageFilters {
  from?: string;
  to?: string;
  projectId?: string;
  adapterId?: string;
  providerId?: string;
  modelId?: string;
  sessionCursor?: string;
  sessionLimit?: number;
}

export interface UsageBillingOverride {
  adapterId: string;
  providerId: string;
  billingKind: "api" | "subscription";
}

export type UsageRange = "today" | "7d" | "30d" | "all";
