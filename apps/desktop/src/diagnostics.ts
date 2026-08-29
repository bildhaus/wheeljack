import type { Adapter, AdapterEnvironment, PaneRuntime, StartupRecoveryState } from "./types";

export function createDiagnosticsReport({
  version,
  platform,
  appDataDir,
  adapters,
  runtimes,
  startupRecovery,
  adapterEnvironment,
}: {
  version?: string;
  platform?: string;
  appDataDir?: string;
  adapters: Adapter[];
  runtimes: PaneRuntime[];
  startupRecovery?: StartupRecoveryState;
  adapterEnvironment?: AdapterEnvironment;
}): string {
  const byStatus = Object.fromEntries(
    [...new Set(runtimes.map((runtime) => runtime.status))]
      .sort()
      .map((status) => [status, runtimes.filter((runtime) => runtime.status === status).length]),
  );
  return JSON.stringify({
    version,
    platform,
    appDataDir,
    adapterEnvironment: adapterEnvironment ? {
      source: adapterEnvironment.source,
      shell: adapterEnvironment.shell,
      pathEntryCount: adapterEnvironment.pathEntryCount,
      warning: adapterEnvironment.warning,
    } : undefined,
    startupRecovery: startupRecovery ? {
      previousUncleanShutdown: startupRecovery.previousUncleanShutdown,
      safeMode: startupRecovery.safeMode,
      consecutiveUncleanStarts: startupRecovery.consecutiveUncleanStarts,
      previousRunStartedAt: startupRecovery.previousRunStartedAt,
      previousRunVersion: startupRecovery.previousRunVersion,
      crashReportAvailable: Boolean(startupRecovery.crashReportPath),
    } : undefined,
    adapters: adapters.map((adapter) => ({
      id: adapter.id,
      displayName: adapter.displayName,
      status: adapter.status,
      enabled: adapter.enabled,
      supportsStructured: adapter.supportsStructured,
      probe: adapter.probe ? {
        version: adapter.probe.version,
        authStatus: adapter.probe.authStatus,
        protocol: adapter.probe.protocol,
        verificationStatus: adapter.probe.verificationStatus,
        checkedAt: adapter.probe.checkedAt,
      } : undefined,
    })),
    sessions: { total: runtimes.length, byStatus },
  }, null, 2);
}
