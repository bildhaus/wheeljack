import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AgentImageAttachment,
  CoreConnection,
  CoreEventEnvelope,
  JsonObject,
} from "./types";

interface CoreResponse<T> {
  ok: boolean;
  payload?: T;
  error?: { code: string; message: string };
}

export class CoreCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let requestSequence = 0;

export async function connectCore(
  onEvent: (event: CoreEventEnvelope) => void,
): Promise<CoreConnection> {
  const events = new Channel<CoreEventEnvelope>();
  events.onmessage = onEvent;
  const connection = await invoke<CoreConnection>("core_connect", { events });
  await callCore("core_handshake", { supportedVersions: [2, 1] });
  return connection;
}

export async function callCore<T>(
  command: string,
  payload: JsonObject,
): Promise<T> {
  const requestJson = JSON.stringify({
    id: `web-${Date.now()}-${++requestSequence}`,
    command,
    payload,
    protocolVersion: 2,
  });
  const responseJson = await invoke<string>("core_call", { requestJson });
  const response = JSON.parse(responseJson) as CoreResponse<T>;
  if (!response.ok) {
    throw new CoreCommandError(
      response.error?.code ?? "core_error",
      response.error?.message ?? "wheeljack core returned an error.",
    );
  }
  return response.payload as T;
}

export function readImageAttachment(path: string, projectRoot: string): Promise<{ dataUrl: string; fileName: string }> {
  return invoke("read_image_attachment", { path, projectRoot });
}

export function importImageAttachment(path: string): Promise<AgentImageAttachment> {
  return invoke("import_image_attachment", { path });
}

export function saveImageAttachment(data: number[], fileName: string): Promise<AgentImageAttachment> {
  return invoke("save_image_attachment", { data, fileName });
}

export function readThemeDocument(path: string): Promise<string> {
  return invoke("read_theme_document", { path });
}

export interface VsCodeThemeSource {
  label: string;
  extension: string;
  path: string;
}

export interface VsCodeThemeCatalog {
  themes: VsCodeThemeSource[];
  settingsPath?: string;
}

export function discoverVsCodeThemes(): Promise<VsCodeThemeCatalog> {
  return invoke("discover_vscode_themes");
}

export function writeThemeDocument(path: string, content: string): Promise<void> {
  return invoke("write_theme_document", { path, content });
}

export function uiSmokeAutoClose(): Promise<boolean> {
  return invoke("ui_smoke_auto_close");
}

export function uiSmokeEnabled(): Promise<boolean> {
  return invoke("ui_smoke_enabled");
}

export function uiSmokeUpdateMode(): Promise<"healthy" | "rollback" | null> {
  return invoke("ui_smoke_update_mode");
}

export function completeUiSmoke(ok: boolean, message: string): Promise<void> {
  return invoke("complete_ui_smoke", { ok, message });
}

export function completeUpdateHealth(): Promise<boolean> {
  return invoke("complete_update_health");
}

export function closeAfterFlush(): Promise<void> {
  return invoke("close_after_flush");
}

export function applyDownloadedUpdate(updatePath: string): Promise<string> {
  return invoke("apply_downloaded_update", { updatePath });
}

export function legacyWindowsUiPreferences(): Promise<JsonObject | null> {
  return invoke("legacy_windows_ui_preferences");
}
