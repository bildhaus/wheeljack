import { AI, CheckIcon, ChevronDownIcon, ChevronLeft, Key, RefreshCw, Search, Terminal } from "./SargamIcon";

import { invoke } from "@tauri-apps/api/core";

import { open, save } from "@tauri-apps/plugin-dialog";

import Markdown from "react-markdown";

import { BackupControls } from "./BackupControls";
import { Badge } from "./components/ui/badge";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./components/ui/alert-dialog";

import { Button } from "./components/ui/button";

import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "./components/ui/dropdown-menu";

import { Input } from "./components/ui/input";

import { Label } from "./components/ui/label";

import { ScrollArea } from "./components/ui/scroll-area";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";

import { Slider } from "./components/ui/slider";

import { Switch } from "./components/ui/switch";

import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";

import { ColorPickerPopover } from "./ColorPickerPopover";

import { RunStateBadge } from "./RunStateBadge";

import { ProviderMark } from "./ProviderMark";

import { DotMatrixLoader } from "./DotMatrixLoader";

import { adapterReadinessLabel, canVerifyAdapter } from "./adapterReadiness";

import { builtInThemes, compileTheme, contrastRatio, replaceThemeAssignments, serializeTheme, themeAssignment, type ThemeDefinition } from "./theme";

import { activeVsCodeThemeName, parseImportedThemeDocument, type ThemeImportResult } from "./themeImport";

import { callCore, discoverVsCodeThemes, readThemeDocument, writeThemeDocument, type VsCodeThemeSource } from "./core";

import type { UpdateController } from "./updater";

import { formatUpdateDate, UpdateProgressView, updateAttentionLabel, updateStatusLabel } from "./UpdaterPresentation";

import { bindingFromKeyboardEvent, defaultShortcutBindings, formatShortcut, isBindableShortcut, shortcutConflict, shortcutDefinitions, type ShortcutAction, type ShortcutBindings } from "./shortcuts";

import { agentEffortOptions } from "./types";

import type { Adapter, AdapterEnvironment, AgentAutonomyPolicy, AgentControlAudit, AgentProfile, UiPreferences } from "./types";

import { useEffect, useState } from "react";

import { defaultUiPreferences, settingsPageDetails, type SettingsPage } from "./ParitySurfaces";

const uiFontPresets = ["Geist Variable", "Open Sans Variable", "Inter Variable", "system-ui", "Segoe UI Variable Text", "Segoe UI", "SF Pro Text", "Helvetica Neue", "Arial"];
const headingFontPresets = ["Geist Pixel", ...uiFontPresets];
const codeFontPresets = ["JetBrains Mono Variable", "Cascadia Mono", "monospace", "Cascadia Code", "JetBrains Mono", "Fira Code", "Iosevka", "SFMono-Regular", "Menlo", "Consolas"];

interface AttachmentStorageStatus {
  fileCount: number;
  totalBytes: number;
  referencedCount: number;
  unreferencedCount: number;
  removedCount: number;
  removedBytes: number;
}

function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

export function SettingsSurface({
  page,
  preferences,
  shortcuts,
  adapters,
  agentProfiles,
  agentAutonomyPolicy,
  agentControlAudit,
  adapterArgsById,
  selectedAdapterId,
  busy,
  coreVersion,
  platform,
  appDataDir,
  adapterEnvironment,
  adapterUpdateStatus,
  diagnosticsReport,
  systemUsesLight,
  onBack,
  onPage,
  onPreferences,
  onShortcuts,
  onResetAll,
  resettingPreferences,
  preferencesStatus,
  onAdapter,
  onAgentProfile,
  onAgentAutonomyPolicy,
  onRefreshAgentControlAudit,
  onRescan,
  onVerify,
  onVerifyAll,
  onUpdateAll,
  onExportBackup,
  repairCommand,
  onRepair,
  updater,
  onInstallUpdate,
}: {
  page: SettingsPage;
  preferences: UiPreferences;
  shortcuts: ShortcutBindings;
  adapters: Adapter[];
  agentProfiles: AgentProfile[];
  agentAutonomyPolicy: AgentAutonomyPolicy;
  agentControlAudit: AgentControlAudit[];
  adapterArgsById: Record<string, string[]>;
  selectedAdapterId: string;
  busy: boolean;
  coreVersion?: string;
  platform?: string;
  appDataDir?: string;
  adapterEnvironment?: AdapterEnvironment;
  adapterUpdateStatus: string;
  diagnosticsReport: string;
  systemUsesLight: boolean;
  onBack: () => void;
  onPage: (page: SettingsPage) => void;
  onPreferences: (patch: Partial<UiPreferences>) => void;
  onShortcuts: (shortcuts: ShortcutBindings) => void;
  onResetAll: () => Promise<void>;
  resettingPreferences: boolean;
  preferencesStatus: string;
  onAdapter: (id: string) => void;
  onAgentProfile: (adapterId: string, patch: Partial<AgentProfile>) => void;
  onAgentAutonomyPolicy: (patch: Partial<AgentAutonomyPolicy>) => void;
  onRefreshAgentControlAudit: () => void;
  onRescan: () => void;
  onVerify: () => void;
  onVerifyAll: () => void;
  onUpdateAll: () => void;
  onExportBackup: (path: string) => Promise<void>;
  repairCommand?: string;
  onRepair: () => void;
  updater: UpdateController;
  onInstallUpdate: () => void;
}) {
  const codingAdapters = adapters.filter((adapter) => adapter.id !== "generic-shell");
  const selectedAdapter = codingAdapters.find((adapter) => adapter.id === selectedAdapterId);
  const selectedProfile = agentProfiles.find((profile) => profile.adapterId === selectedAdapterId);
  const selectedArgs = adapterArgsById[selectedAdapterId] ?? [];
  const approvalPolicies = selectedAdapter?.supportedApprovalPolicies ?? [];
  const selectedAdapterFailed = selectedAdapter?.probe?.verificationStatus === "failed";
  const [advancedPalette, setAdvancedPalette] = useState(false);
  const [themeStatus, setThemeStatus] = useState("");
  const [deleteThemeOpen, setDeleteThemeOpen] = useState(false);
  const [replacementThemeId, setReplacementThemeId] = useState("");
  const [pendingThemeImport, setPendingThemeImport] = useState<ThemeImportResult>();
  const [pendingThemeIndex, setPendingThemeIndex] = useState("0");
  const [vsCodeThemes, setVsCodeThemes] = useState<VsCodeThemeSource[]>([]);
  const [vsCodeThemePath, setVsCodeThemePath] = useState("");
  const [vsCodeThemeQuery, setVsCodeThemeQuery] = useState("");
  const [fontFamilies, setFontFamilies] = useState<string[]>([]);
  const [storageStatus, setStorageStatus] = useState("");
  const [attachmentStorage, setAttachmentStorage] = useState<AttachmentStorageStatus>();
  const [attachmentCleanupBusy, setAttachmentCleanupBusy] = useState(false);
  const [systemCheck, setSystemCheck] = useState("");
  const [systemCheckBusy, setSystemCheckBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  useEffect(() => {
    void invoke<string[]>("system_font_families")
      .then(setFontFamilies)
      .catch(() => setFontFamilies([]));
  }, []);
  useEffect(() => {
    if (page !== "application") return;
    void callCore<AttachmentStorageStatus>("attachment_storage_status", {})
      .then(setAttachmentStorage)
      .catch((cause) => setStorageStatus(cause instanceof Error ? cause.message : String(cause)));
  }, [page]);
  const themes = [...builtInThemes, ...preferences.customThemes];
  const activeThemeId = preferences.appearanceMode === "fixed"
    ? preferences.fixedThemeId
    : systemUsesLight ? preferences.systemLightThemeId : preferences.systemDarkThemeId;
  const [selectedThemeId, setSelectedThemeId] = useState(activeThemeId);
  useEffect(() => setSelectedThemeId(activeThemeId), [activeThemeId, preferences.appearanceMode]);
  const selectedTheme = themes.find((theme) => theme.id === selectedThemeId) ?? builtInThemes[0];
  const replacementThemes = themes.filter((theme) => theme.id !== selectedTheme.id && theme.variant === selectedTheme.variant);
  const selectedThemeIsAssigned = [preferences.fixedThemeId, preferences.systemLightThemeId, preferences.systemDarkThemeId].includes(selectedTheme.id);
  const selectTheme = (theme: ThemeDefinition) => {
    setSelectedThemeId(theme.id);
    onPreferences(themeAssignment(preferences.appearanceMode, systemUsesLight, theme));
  };
  const saveCustomTheme = (theme: ThemeDefinition) => onPreferences({
    customThemes: preferences.customThemes.map((item) => item.id === theme.id ? theme : item),
    ...themeAssignment(preferences.appearanceMode, systemUsesLight, theme),
  });
  const duplicateTheme = (theme = selectedTheme) => {
    const copy = { ...theme, id: crypto.randomUUID().replaceAll("-", ""), name: `${theme.name} copy`, isBuiltIn: false, basedOnId: theme.id, seed: { ...theme.seed }, overrides: { ...theme.overrides }, terminal: { ...theme.terminal, ansi: [...theme.terminal.ansi] } };
    setSelectedThemeId(copy.id);
    onPreferences({ customThemes: [...preferences.customThemes, copy], ...themeAssignment(preferences.appearanceMode, systemUsesLight, copy) });
  };
  const openThemeDelete = () => {
    const replacement = replacementThemes.find((theme) => theme.id === selectedTheme.basedOnId)
      ?? replacementThemes.find((theme) => theme.isBuiltIn)
      ?? replacementThemes[0];
    setReplacementThemeId(replacement?.id ?? "");
    setDeleteThemeOpen(true);
  };
  const removeTheme = () => {
    if (selectedTheme.isBuiltIn || !replacementThemeId) return;
    const replacement = themes.find((theme) => theme.id === replacementThemeId && theme.id !== selectedTheme.id);
    if (!replacement) return;
    onPreferences({
      customThemes: preferences.customThemes.filter((theme) => theme.id !== selectedTheme.id),
      ...replaceThemeAssignments(preferences, selectedTheme.id, replacement.id),
    });
    setSelectedThemeId(replacement.id);
    setDeleteThemeOpen(false);
    setReplacementThemeId("");
  };
  const resetTheme = () => {
    if (selectedTheme.isBuiltIn) {
      setThemeStatus("This built-in theme already matches its original palette.");
      return;
    }
    const basis = themes.find((theme) => theme.id === selectedTheme.basedOnId)
      ?? builtInThemes.find((theme) => theme.variant === selectedTheme.variant)
      ?? builtInThemes[0];
    saveCustomTheme({
      ...selectedTheme,
      variant: basis.variant,
      seed: { ...basis.seed },
      overrides: {},
      terminal: { ...basis.terminal, ansi: [...basis.terminal.ansi] },
    });
    setThemeStatus("Theme colors reset.");
  };
  const applyThemeImport = (result: ThemeImportResult, imported: ThemeDefinition) => {
    const collision = themes.some((theme) => theme.id === imported.id);
    const external = result.source !== "wheeljack";
    const id = external || collision ? crypto.randomUUID().replaceAll("-", "") : imported.id;
    const theme = { ...imported, id, name: collision && !external ? `${imported.name} imported` : imported.name };
    const source = result.source === "vscode" ? "VS Code" : result.source === "windows-terminal" ? "Windows Terminal" : "wheeljack";
    setSelectedThemeId(theme.id);
    onPreferences({ customThemes: [...preferences.customThemes, theme], ...themeAssignment(preferences.appearanceMode, systemUsesLight, theme) });
    setThemeStatus(`Imported ${theme.name} from ${source}.${result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : ""}`);
  };
  const handleThemeImport = (result: ThemeImportResult) => {
    if (result.themes.length === 1) {
      applyThemeImport(result, result.themes[0]);
      return;
    }
    setPendingThemeIndex("0");
    setPendingThemeImport(result);
  };
  const importTheme = async () => {
    try {
      const path = await open({ multiple: false, directory: false, title: "Import theme", filters: [{ name: "Theme file", extensions: ["json", "jsonc"] }] });
      if (typeof path !== "string") return;
      const fileName = path.split(/[\\/]/).pop()?.replace(/\.(?:jsonc?|wheeljack-theme\.json)$/i, "") || "Imported theme";
      handleThemeImport(parseImportedThemeDocument(await readThemeDocument(path), fileName));
    } catch (cause) {
      setThemeStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const openVsCodeThemes = async () => {
    try {
      setThemeStatus("Finding installed VS Code themes…");
      const catalog = await discoverVsCodeThemes();
      if (catalog.themes.length === 0) {
        setThemeStatus("No installed VS Code color themes were found.");
        return;
      }
      const active = catalog.settingsPath
        ? activeVsCodeThemeName(await readThemeDocument(catalog.settingsPath).catch(() => ""))
        : undefined;
      const selected = catalog.themes.find((theme) => theme.label === active) ?? catalog.themes[0];
      setVsCodeThemeQuery("");
      setVsCodeThemePath(selected.path);
      setVsCodeThemes(catalog.themes);
      setThemeStatus(active ? `Found ${catalog.themes.length} themes. Selected ${active}.` : `Found ${catalog.themes.length} installed themes.`);
    } catch (cause) {
      setThemeStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const importVsCodeTheme = async () => {
    const source = vsCodeThemes.find((theme) => theme.path === vsCodeThemePath);
    if (!source) return;
    try {
      handleThemeImport(parseImportedThemeDocument(await readThemeDocument(source.path), source.label));
      setVsCodeThemes([]);
    } catch (cause) {
      setThemeStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const exportTheme = async () => {
    try {
      const path = await save({ title: "Export wheeljack theme", defaultPath: `${selectedTheme.id}.wheeljack-theme.json`, filters: [{ name: "wheeljack theme", extensions: ["json"] }] });
      if (!path) return;
      await writeThemeDocument(path, serializeTheme(selectedTheme));
      setThemeStatus(`Exported ${selectedTheme.name}.`);
    } catch (cause) {
      setThemeStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const exportBackup = async () => {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = await save({
        title: "Export database only",
        defaultPath: `wheeljack-backup-${stamp}.sqlite3`,
        filters: [{ name: "Database backup", extensions: ["sqlite3"] }],
      });
      if (!path) return;
      setBackupBusy(true);
      setStorageStatus("Exporting database backup…");
      await onExportBackup(path);
      setStorageStatus(`Database backup exported to ${path}. Image files are not included.`);
    } catch (cause) {
      setStorageStatus(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBackupBusy(false);
    }
  };
  const pasteTheme = async () => {
    try {
      handleThemeImport(parseImportedThemeDocument(await navigator.clipboard.readText()));
    } catch (cause) {
      setThemeStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const updateAttention = updateAttentionLabel(updater);
  const updateStatus = updateStatusLabel(updater);
  const latestVersion = updater.update?.version
    ?? (updater.status === "up-to-date" ? coreVersion : undefined);
  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="wj-settings-header">
        <div className="wj-settings-title"><Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft />Back</Button><span>Settings</span></div>
        <Tabs className="wj-settings-tabs" value={page} onValueChange={(value) => onPage(value as SettingsPage)}>
          <TabsList aria-label="Settings categories" variant="line">
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
            <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="application">
              Application
              {updateAttention && <Badge className="ml-2" variant={updateAttention === "Error" ? "destructive" : "outline"}>{updateAttention}</Badge>}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <main className="wj-settings-page" aria-labelledby="settings-page-heading">
          <div className="wj-settings-intro">
            <div><h1 id="settings-page-heading">{settingsPageDetails[page].title}</h1><p>{settingsPageDetails[page].description}</p></div>
            {page === "workspace" && <Button variant="ghost" size="sm" onClick={() => onPreferences(defaultInterfacePreferences)}>Reset workspace</Button>}
            {page === "shortcuts" && <Button variant="ghost" size="sm" onClick={() => onShortcuts({ ...defaultShortcutBindings })}>Reset shortcuts</Button>}
          </div>
          {page === "appearance" && (
            <div className="wj-appearance-settings">
              <ThemePreview theme={selectedTheme} preferences={preferences} />
              <div className="wj-appearance-controls">
              <SettingsCard wide title="Theme" description="Use one theme or follow the system light and dark appearance." action={<div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => onPreferences({ appearanceMode: defaultUiPreferences.appearanceMode, fixedThemeId: defaultUiPreferences.fixedThemeId, systemLightThemeId: defaultUiPreferences.systemLightThemeId, systemDarkThemeId: defaultUiPreferences.systemDarkThemeId, showStickerLensBackground: defaultUiPreferences.showStickerLensBackground, headingFontFamily: defaultUiPreferences.headingFontFamily, uiFontFamily: defaultUiPreferences.uiFontFamily, codeFontFamily: defaultUiPreferences.codeFontFamily, uiScale: defaultUiPreferences.uiScale, uiFontSize: defaultUiPreferences.uiFontSize, terminalFontSize: defaultUiPreferences.terminalFontSize, theme: defaultUiPreferences.theme })}>Reset appearance</Button><Button variant="ghost" size="sm" onClick={() => void openVsCodeThemes()}>VS Code themes</Button><Button variant="ghost" size="sm" onClick={() => void importTheme()}>Import file</Button><Button variant="ghost" size="sm" onClick={() => void pasteTheme()}>Paste JSON</Button></div>}>
                <Tabs value={preferences.appearanceMode} onValueChange={(value) => onPreferences({ appearanceMode: value as "fixed" | "system" })}><TabsList><TabsTrigger value="fixed">Fixed</TabsTrigger><TabsTrigger value="system">System</TabsTrigger></TabsList></Tabs>
                {preferences.appearanceMode === "system" && <div className="wj-setting-grid mt-4">
                  <Field label="Light theme"><Select value={preferences.systemLightThemeId} onValueChange={(systemLightThemeId) => onPreferences({ systemLightThemeId })}><SelectTrigger aria-label="Light theme"><SelectValue /></SelectTrigger><SelectContent>{themes.filter((theme) => theme.variant === "light").map((theme) => <SelectItem key={theme.id} value={theme.id}>{theme.name}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="Dark theme"><Select value={preferences.systemDarkThemeId} onValueChange={(systemDarkThemeId) => onPreferences({ systemDarkThemeId })}><SelectTrigger aria-label="Dark theme"><SelectValue /></SelectTrigger><SelectContent>{themes.filter((theme) => theme.variant === "dark").map((theme) => <SelectItem key={theme.id} value={theme.id}>{theme.name}</SelectItem>)}</SelectContent></Select></Field>
                </div>}
                <div className="wj-theme-grid mt-4">
                  {themes.map((theme) => <ThemeChoice key={theme.id} theme={theme} selected={selectedTheme.id === theme.id} onClick={() => selectTheme(theme)} />)}
                </div>
                <div className="wj-theme-editor mt-4">
                  <Input aria-label="Theme name" disabled={selectedTheme.isBuiltIn} value={selectedTheme.name} onChange={(event) => saveCustomTheme({ ...selectedTheme, name: event.target.value })} />
                  <Select disabled={selectedTheme.isBuiltIn} value={selectedTheme.variant} onValueChange={(variant) => saveCustomTheme({ ...selectedTheme, variant: variant as ThemeDefinition["variant"] })}><SelectTrigger aria-label="Theme variant"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dark">Dark</SelectItem><SelectItem value="light">Light</SelectItem></SelectContent></Select>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => duplicateTheme()}>{selectedTheme.isBuiltIn ? "Edit copy" : "Duplicate"}</Button>
                    <Button variant="ghost" size="sm" onClick={() => void exportTheme()}>Export</Button>
                    <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(serializeTheme(selectedTheme))}>Copy JSON</Button>
                    {!selectedTheme.isBuiltIn && <Button variant="destructive" size="sm" onClick={openThemeDelete}>Delete</Button>}
                  </div>
                </div>
                {themeStatus && <p className="wj-inline-status mt-3 text-sm text-muted-foreground" role="status">{themeStatus.startsWith("Finding installed") && <DotMatrixLoader size={16} />}{themeStatus}</p>}
              </SettingsCard>
              <SettingsCard wide title="Typography" description="Fonts and app-wide scale. Use Ctrl/Cmd + or - to zoom." action={<Button variant="ghost" size="sm" onClick={() => onPreferences({ headingFontFamily: defaultUiPreferences.headingFontFamily, uiFontFamily: defaultUiPreferences.uiFontFamily, codeFontFamily: defaultUiPreferences.codeFontFamily, uiScale: defaultUiPreferences.uiScale, uiFontSize: defaultUiPreferences.uiFontSize, terminalFontSize: defaultUiPreferences.terminalFontSize })}>Reset typography</Button>}>
                <div className="wj-typography-grid">
                  <Field label="Heading font"><FontField ariaLabel="Heading font" value={preferences.headingFontFamily} options={headingFontPresets.filter((font) => font === "Geist Pixel" || font === "Geist Variable" || font === "Open Sans Variable" || font === "Inter Variable" || font === "system-ui" || fontFamilies.includes(font))} onValue={(headingFontFamily) => onPreferences({ headingFontFamily })} /></Field>
                  <Field label="UI font"><FontField ariaLabel="UI font" value={preferences.uiFontFamily} options={uiFontPresets.filter((font) => font === "Geist Variable" || font === "Open Sans Variable" || font === "Inter Variable" || font === "system-ui" || fontFamilies.includes(font))} onValue={(uiFontFamily) => onPreferences({ uiFontFamily })} /></Field>
                  <Field label="Code font"><FontField ariaLabel="Code font" value={preferences.codeFontFamily} options={codeFontPresets.filter((font) => font === "JetBrains Mono Variable" || font === "Cascadia Mono" || font === "monospace" || fontFamilies.includes(font))} onValue={(codeFontFamily) => onPreferences({ codeFontFamily })} /></Field>
                  <SliderField label="UI scale" value={Math.round(preferences.uiScale * 100)} min={50} max={200} step={10} suffix="%" onValue={(value) => onPreferences({ uiScale: value / 100 })} />
                  <SliderField label="UI size" value={preferences.uiFontSize} min={10} max={16} onValue={(value) => onPreferences({ uiFontSize: value })} />
                  <SliderField label="Terminal size" value={preferences.terminalFontSize} min={10} max={22} onValue={(value) => onPreferences({ terminalFontSize: value })} />
                </div>
              </SettingsCard>
              <SettingsCard wide title="Effects" description="Control decorative workspace visuals.">
                <ToggleSetting label="Sticker lens background" description="Show the interactive sticker background in empty Work and Plan views." checked={preferences.showStickerLensBackground} onChecked={(showStickerLensBackground) => onPreferences({ showStickerLensBackground })} />
              </SettingsCard>
              <SettingsCard wide title="Theme colors" description="Edit a custom theme’s semantic colors and inspect text contrast." action={<div className="flex gap-2">{selectedTheme.isBuiltIn && <Button variant="ghost" size="sm" onClick={() => duplicateTheme()}>Edit copy</Button>}<Button variant="ghost" size="sm" onClick={() => setAdvancedPalette((value) => !value)}>{advancedPalette ? "Hide advanced" : "Show advanced"}</Button><Button variant="ghost" size="sm" onClick={resetTheme}>Reset theme</Button></div>}>
                {contrastRatio(selectedTheme.seed.text, selectedTheme.seed.canvas) < 4.5 && <p className="mb-3 text-sm text-destructive" role="alert">Text and canvas are below WCAG AA contrast.</p>}
                <div className="wj-palette-grid">
                  {(Object.keys(selectedTheme.seed) as Array<keyof ThemeDefinition["seed"]>).map((key) => <ThemeColorField key={key} label={key} value={selectedTheme.seed[key]} contrastAgainst={seedContrastReference(key, selectedTheme)} disabled={selectedTheme.isBuiltIn} onChange={(value) => saveCustomTheme({ ...selectedTheme, seed: { ...selectedTheme.seed, [key]: value } })} />)}
                </div>
                {advancedPalette && <div className="wj-palette-grid mt-4">
                  {Object.entries(compileTheme(selectedTheme)).map(([key, value]) => <ThemeColorField key={key} label={key} value={value} contrastAgainst={paletteContrastReference(key, selectedTheme)} disabled={selectedTheme.isBuiltIn} onChange={(next) => saveCustomTheme({ ...selectedTheme, overrides: { ...selectedTheme.overrides, [key]: next } })} onReset={selectedTheme.overrides[key] ? () => { const overrides = { ...selectedTheme.overrides }; delete overrides[key]; saveCustomTheme({ ...selectedTheme, overrides }); } : undefined} />)}
                </div>}
              </SettingsCard>
              <SettingsCard wide title="Terminal colors" description="Terminal defaults, cursor, selection, and ANSI colors follow the active theme.">
                <div className="wj-palette-grid">
                  {(["foreground", "background", "cursor", "selection"] as const).map((key) => <ThemeColorField key={key} label={key} value={selectedTheme.terminal[key]} contrastAgainst={key === "foreground" || key === "cursor" ? selectedTheme.terminal.background : undefined} disabled={selectedTheme.isBuiltIn} onChange={(value) => saveCustomTheme({ ...selectedTheme, terminal: { ...selectedTheme.terminal, [key]: value } })} />)}
                </div>
                <div className="wj-ansi-grid mt-4">{selectedTheme.terminal.ansi.map((color, index) => <ThemeColorField key={index} label={`ANSI ${index}`} value={color} disabled={selectedTheme.isBuiltIn} onChange={(value) => { const ansi = [...selectedTheme.terminal.ansi]; ansi[index] = value; saveCustomTheme({ ...selectedTheme, terminal: { ...selectedTheme.terminal, ansi } }); }} />)}</div>
              </SettingsCard>
              </div>
            </div>
          )}
          {page === "workspace" && (
            <SettingsCard wide title="Workspace shell" description="Choose what stays visible, then tune the space around your work.">
              <div className="wj-workspace-settings">
                <div className="wj-workspace-controls">
                  <section>
                    <h3>Canvas</h3>
                    <ToggleSetting label="Pane header actions" description="Keep split and pane controls visible in each header." checked={preferences.showPaneActions} onChecked={(checked) => onPreferences({ showPaneActions: checked })} />
                  </section>
                  <section>
                    <h3>Project overview</h3>
                    <ToggleSetting label="Project paths" description="Show the full folder path below each project name." checked={preferences.showProjectPaths} onChecked={(checked) => onPreferences({ showProjectPaths: checked })} />
                    <ToggleSetting label="Recent activity" description="Keep the activity column on the workspace home." checked={preferences.showRecentActivity} onChecked={(checked) => onPreferences({ showRecentActivity: checked })} />
                  </section>
                  <section>
                    <h3>Agents</h3>
                    <ToggleSetting label="Live agent rail" description="Show active agents beside Work and Plan." checked={preferences.showAgentRail} onChecked={(checked) => onPreferences({ showAgentRail: checked })} />
                  </section>
                </div>
                <aside className="wj-workspace-preview" aria-label="Workspace layout preview">
                  <div className="wj-workspace-preview-label"><span>Preview</span><small>Updates as you change settings</small></div>
                  <div
                    className="wj-workspace-preview-frame"
                    aria-hidden="true"
                  >
                    <div className="wj-workspace-preview-sidebar">
                      <i />
                      <i />
                      <i />
                      {preferences.showProjectPaths && <small>C:\dev\wheeljack</small>}
                    </div>
                    <div className="wj-workspace-preview-pane">
                      <header><span>codex · main</span>{preferences.showPaneActions && <b>− &nbsp; □</b>}</header>
                      <div><span>PS C:\wheeljack&gt;</span><i /><i /></div>
                    </div>
                    {preferences.showAgentRail && <div className="wj-workspace-preview-rail"><i /><i /><i /></div>}
                    {preferences.showRecentActivity && <div className="wj-workspace-preview-activity"><span>Recent</span><i /><i /></div>}
                  </div>
                </aside>
              </div>
            </SettingsCard>
          )}
          {page === "shortcuts" && <ShortcutSettings bindings={shortcuts} onBindings={onShortcuts} />}
          {page === "agents" && (
            <>
              <SettingsCard title="Coding agents" description="Scan every installed CLI, preview provenance-aware updates, then verify real agent turns explicitly." action={<div className="flex flex-wrap gap-2">{repairCommand && <Button variant="outline" size="sm" disabled={busy} title={repairCommand} onClick={onRepair}><Terminal />Sign in</Button>}<Button variant="ghost" size="sm" disabled={busy} onClick={onRescan}><RefreshCw />Scan all</Button><Button variant="outline" size="sm" disabled={busy || !codingAdapters.some((adapter) => adapter.enabled)} onClick={onUpdateAll}><RefreshCw />Update all</Button><Button variant="outline" size="sm" disabled={busy || !codingAdapters.some((adapter) => canVerifyAdapter(adapter))} onClick={onVerifyAll}><CheckIcon />Verify all</Button><Button size="sm" disabled={busy || !canVerifyAdapter(selectedAdapter)} onClick={onVerify}><CheckIcon />Verify selected</Button></div>}>
                {platform === "macos" && adapterEnvironment && <div className={`mb-3 rounded border p-2 text-xs ${adapterEnvironment.warning ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-border bg-muted/30 text-muted-foreground"}`}>
                  <span>CLI search path: {adapterEnvironment.pathEntryCount} locations via {adapterEnvironment.source === "login-shell" ? "your login shell" : "safe fallback paths"}.</span>
                  {adapterEnvironment.warning && <p className="mt-1" role="alert">{adapterEnvironment.warning}</p>}
                </div>}
                {adapterUpdateStatus && <p className="mb-3 text-xs text-muted-foreground" role="status">{adapterUpdateStatus}</p>}
                <Select value={selectedAdapterId} onValueChange={onAdapter}><SelectTrigger aria-label="Coding agent"><SelectValue placeholder="Agent adapter" /></SelectTrigger><SelectContent>{codingAdapters.map((adapter) => <SelectItem key={adapter.id} value={adapter.id}><span className="wj-provider-label"><ProviderMark adapterId={adapter.id} /><span>{adapter.displayName} · {adapterReadinessLabel(adapter, adapterArgsById[adapter.id] ?? [])}</span></span></SelectItem>)}</SelectContent></Select>
                {selectedAdapter && <div className={`mt-3 rounded border p-3 text-sm ${selectedAdapterFailed ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/30"}`}>
                  <div className="flex items-center justify-between gap-3"><strong className="wj-provider-label"><ProviderMark adapterId={selectedAdapter.id} /><span>{selectedAdapter.displayName}</span></strong><Badge variant={selectedAdapterFailed ? "destructive" : adapterReadinessLabel(selectedAdapter, selectedArgs) === "Ready" ? "secondary" : "outline"}>{adapterReadinessLabel(selectedAdapter, selectedArgs)}</Badge></div>
                  <p className={`mt-2 ${selectedAdapterFailed ? "text-destructive" : "text-muted-foreground"}`} role={selectedAdapterFailed ? "alert" : undefined}>{selectedAdapter.probe?.message ?? selectedAdapter.setupHint}</p>
                  {selectedAdapter.probe?.version && <code className="mt-2 block text-xs">{selectedAdapter.probe.version}</code>}
                  {selectedAdapter.probe?.executablePath && <code className="mt-1 block truncate text-xs" title={selectedAdapter.probe.executablePath}>{selectedAdapter.probe.executablePath}</code>}
                </div>}
                {selectedProfile && <div className="wj-setting-grid mt-4">
                  {selectedProfile.adapterId === "pi-coding-agent" && <Field label="Provider"><Input aria-label="Provider" value={selectedProfile.provider} onChange={(event) => onAgentProfile(selectedProfile.adapterId, { provider: event.target.value })} /></Field>}
                  <Field label="Model"><Input aria-label="Model" value={selectedProfile.model} onChange={(event) => onAgentProfile(selectedProfile.adapterId, { model: event.target.value })} /></Field>
                  <Field label="Thinking"><Select value={selectedProfile.thinking} onValueChange={(thinking) => onAgentProfile(selectedProfile.adapterId, { thinking: thinking as AgentProfile["thinking"] })}><SelectTrigger aria-label="Thinking"><SelectValue /></SelectTrigger><SelectContent>{agentEffortOptions(selectedProfile.adapterId).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field>
                  {selectedProfile.adapterId !== "pi-coding-agent" && <Field label="Approval policy">{approvalPolicies.length > 0
                    ? <Select value={selectedProfile.approvalPolicy} onValueChange={(approvalPolicy) => onAgentProfile(selectedProfile.adapterId, { approvalPolicy })}><SelectTrigger aria-label="Approval policy"><SelectValue placeholder="Choose a policy" /></SelectTrigger><SelectContent>{approvalPolicies.map((policy) => <SelectItem value={policy} key={policy}>{policy}</SelectItem>)}</SelectContent></Select>
                    : <Input aria-label="Approval policy" value={selectedProfile.approvalPolicy} onChange={(event) => onAgentProfile(selectedProfile.adapterId, { approvalPolicy: event.target.value })} />}</Field>}
                </div>}
                <div className="mt-3 space-y-2">{codingAdapters.map((adapter) => <div className="wj-adapter-row" key={adapter.id}><ProviderMark adapterId={adapter.id} /><div><strong>{adapter.displayName}</strong><small>{adapter.probe?.message ?? adapter.setupHint}</small></div><Badge variant={adapterReadinessLabel(adapter, adapterArgsById[adapter.id] ?? []) === "Ready" ? "secondary" : "outline"}>{adapterReadinessLabel(adapter, adapterArgsById[adapter.id] ?? [])}</Badge></div>)}</div>
              </SettingsCard>
              <SettingsCard wide title="Agent autonomy" description="Let agents coordinate, message peers, start bounded child agents, hand off work, and request review." action={<div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{agentAutonomyPolicy.enabled ? "Enabled" : "Disabled"}</span><Switch aria-label="Agent autonomy" checked={agentAutonomyPolicy.enabled} onCheckedChange={(enabled) => onAgentAutonomyPolicy({ enabled })} /></div>}>
                <div className="wj-setting-grid">
                  {([
                    ["Discover agents", "listAgents"],
                    ["Message agents", "sendMessage"],
                    ["Spawn agents", "spawnAgent"],
                    ["Hand off tasks", "handoffTask"],
                    ["Request review", "requestReview"],
                    ["Resolve file conflicts", "resolveFileConflict"],
                  ] as const).map(([label, key]) => <Field label={label} key={key}><Select value={agentAutonomyPolicy[key]} onValueChange={(value) => onAgentAutonomyPolicy({ [key]: value } as Partial<AgentAutonomyPolicy>)}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="allow">Allow automatically</SelectItem><SelectItem value="ask">Ask every time</SelectItem><SelectItem value="deny">Deny</SelectItem></SelectContent></Select></Field>)}
                </div>
                <div className="wj-setting-grid mt-4">
                  <Field label="Maximum spawn depth"><Input aria-label="Maximum spawn depth" type="number" min={1} max={4} value={agentAutonomyPolicy.maxDepth} onChange={(event) => onAgentAutonomyPolicy({ maxDepth: Number(event.target.value) })} /></Field>
                  <Field label="Children per agent"><Input aria-label="Children per agent" type="number" min={1} max={8} value={agentAutonomyPolicy.maxChildrenPerAgent} onChange={(event) => onAgentAutonomyPolicy({ maxChildrenPerAgent: Number(event.target.value) })} /></Field>
                  <Field label="Concurrent agents"><Input aria-label="Concurrent agents" type="number" min={1} max={16} value={agentAutonomyPolicy.maxConcurrentAgents} onChange={(event) => onAgentAutonomyPolicy({ maxConcurrentAgents: Number(event.target.value) })} /></Field>
                  <Field label="Actions per minute"><Input aria-label="Actions per minute" type="number" min={1} max={60} value={agentAutonomyPolicy.maxActionsPerMinute} onChange={(event) => onAgentAutonomyPolicy({ maxActionsPerMinute: Number(event.target.value) })} /></Field>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">All actions stay inside the current workspace and are written to the durable session audit log. Self-targeting, duplicate requests, and limit bypasses are rejected by the Rust core.</p>
              </SettingsCard>
              <SettingsCard wide title="Autonomy history" description="Recent agent-requested actions and policy decisions." action={<Button variant="ghost" size="sm" onClick={onRefreshAgentControlAudit}><RefreshCw />Refresh</Button>}>
                {agentControlAudit.length ? <div className="space-y-2">{agentControlAudit.slice(0, 20).map((entry) => <div className="wj-adapter-row" key={entry.id}><AI /><div><strong>{entry.sourceTitle} · {entry.action.replaceAll("_", " ")}</strong><small>{entry.message}</small></div><RunStateBadge status={entry.status} variant="compact" /></div>)}</div> : <p className="text-sm text-muted-foreground">No autonomous actions have been recorded for this workspace.</p>}
              </SettingsCard>
            </>
          )}
          {page === "application" && (
            <>
              <SettingsCard title="Build" description="Local wheeljack runtime information for this installed build.">
                <dl className="grid gap-3 text-sm">
                  <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Core version</dt><dd><code>{coreVersion ?? "Connecting…"}</code></dd></div>
                  <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Platform</dt><dd><code>{platform ?? "Connecting…"}</code></dd></div>
                </dl>
              </SettingsCard>
              <SettingsCard
                title="Updates"
                description="wheeljack can check and stage verified updates automatically. Installing an update always requires your confirmation and restarts the app."
                action={<Badge variant={updateAttention === "Error" ? "destructive" : "outline"}>{updateStatus}</Badge>}
              >
                <div className="space-y-3" aria-live="polite">
                  <p className="text-sm" role="status">
                    {updater.recoveryError
                      ? "wheeljack rolled back the previous update because the new build did not start successfully."
                      : updater.error
                        ? "wheeljack could not complete the last update action. You can retry safely."
                        : updater.update
                          ? `wheeljack ${updater.update.version} is ${updater.status === "ready" ? "ready to install" : updater.status === "downloading" ? "downloading" : "available"}.`
                          : updater.status === "up-to-date"
                            ? "wheeljack is up to date."
                            : updater.status === "disabled"
                              ? "Updates are disabled in development builds."
                              : "Check for the latest release when you’re ready."}
                  </p>
                  <dl className="grid gap-2 rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Current version</dt><dd><code>{coreVersion ?? "Connecting…"}</code></dd></div>
                    <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Latest version</dt><dd><code>{latestVersion ?? "Not checked"}</code></dd></div>
                    <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Last checked</dt><dd>{formatUpdateDate(updater.lastCheckedAt)}</dd></div>
                    {updater.update?.publishedAt && <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Published</dt><dd>{formatUpdateDate(updater.update.publishedAt)}</dd></div>}
                  </dl>
                  {(updater.status === "downloading" || updater.status === "installing") && (
                    <UpdateProgressView updater={updater} />
                  )}
                  {updater.update?.notes && (
                    <details className="rounded-md border p-3">
                      <summary className="cursor-pointer text-sm font-medium">Release notes</summary>
                      <div className="agent-prose mt-3"><Markdown skipHtml>{updater.update.notes}</Markdown></div>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={["checking", "downloading", "installing", "disabled"].includes(updater.status)}
                      onClick={() => void updater.checkNow()}
                    >
                      {updater.status === "checking" ? <><DotMatrixLoader size={16} />Checking…</> : "Check now"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!updater.update || ["checking", "downloading", "ready", "installing", "disabled"].includes(updater.status)}
                      onClick={() => void updater.downloadNow()}
                    >
                      {updater.status === "downloading" ? "Downloading…" : updater.error ? "Retry download" : "Download"}
                    </Button>
                    <Button disabled={updater.status !== "ready"} onClick={onInstallUpdate}>
                      Restart to install
                    </Button>
                  </div>
                  <div className="divide-y divide-border rounded-md border [&_.wj-toggle-setting]:px-3">
                    <ToggleSetting
                      label="Automatically check for updates"
                      description="Check at startup and periodically in the background."
                      checked={updater.automaticCheck}
                      onChecked={updater.setAutomaticCheck}
                    />
                    <ToggleSetting
                      label="Automatically download updates"
                      description="Download verified updates after automatic checks without restarting the app."
                      checked={updater.automaticDownload}
                      onChecked={updater.setAutomaticDownload}
                    />
                  </div>
                  {(updater.error || updater.recoveryError) && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">
                      <p>{updater.recoveryError ?? updater.error}</p>
                      <Button className="mt-2" variant="ghost" size="sm" onClick={updater.dismissError}>Dismiss</Button>
                    </div>
                  )}
                  {updater.signatureStatus === "unsigned" && (
                    <p className="text-sm text-destructive" role="alert">
                      This staged Windows update is unsigned. wheeljack will ask again before installing it.
                    </p>
                  )}
                </div>
              </SettingsCard>
              <SettingsCard title="Storage" description="wheeljack preferences and durable workspace state are stored in this local app-data directory.">
                <div className="flex min-w-0 items-start gap-3">
                  <code className="min-w-0 flex-1 break-all text-xs text-muted-foreground">{appDataDir ?? "Connecting…"}</code>
                  <Button variant="outline" size="sm" disabled={!appDataDir} onClick={() => {
                    if (!appDataDir) return;
                    void navigator.clipboard.writeText(appDataDir)
                      .then(() => setStorageStatus("Storage path copied."))
                      .catch(() => setStorageStatus("Could not copy the storage path."));
                  }}>Copy path</Button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" disabled={backupBusy} onClick={() => void exportBackup()}>
                    {backupBusy ? <><DotMatrixLoader size={16} />Exporting…</> : "Export database only"}
                  </Button>
                  <Button variant="outline" onClick={() => {
                    void navigator.clipboard.writeText(diagnosticsReport)
                      .then(() => setStorageStatus("Diagnostics copied."))
                      .catch(() => setStorageStatus("Could not copy diagnostics."));
                  }}>Copy diagnostics</Button>
                  <Button variant="outline" disabled={systemCheckBusy} onClick={() => {
                    setSystemCheckBusy(true);
                    void callCore<Record<string, unknown>>("system_diagnostics_run", {})
                      .then((report) => {
                        setSystemCheck(JSON.stringify(report, null, 2));
                        setStorageStatus(report.ok === true ? "System check passed." : "System check found an issue.");
                      })
                      .catch((cause) => setStorageStatus(cause instanceof Error ? cause.message : String(cause)))
                      .finally(() => setSystemCheckBusy(false));
                  }}>{systemCheckBusy ? <><DotMatrixLoader size={16} />Checking…</> : "Run system check"}</Button>
                  <Button variant="outline" disabled={attachmentCleanupBusy} onClick={() => {
                    setAttachmentCleanupBusy(true);
                    void callCore<AttachmentStorageStatus>("attachment_gc", {})
                      .then((status) => {
                        setAttachmentStorage(status);
                        setStorageStatus(status.removedCount > 0
                          ? `Removed ${status.removedCount} unused image${status.removedCount === 1 ? "" : "s"} (${formatStorageBytes(status.removedBytes)}).`
                          : "No unused image attachments found.");
                      })
                      .catch((cause) => setStorageStatus(cause instanceof Error ? cause.message : String(cause)))
                      .finally(() => setAttachmentCleanupBusy(false));
                  }}>{attachmentCleanupBusy ? <><DotMatrixLoader size={16} />Cleaning…</> : "Clean attachments"}</Button>
                </div>
                <BackupControls />
                {attachmentStorage && <p className="mt-2 text-xs text-muted-foreground">
                  Image attachments: {attachmentStorage.fileCount} · {formatStorageBytes(attachmentStorage.totalBytes)}
                  {attachmentStorage.unreferencedCount > 0 ? ` · ${attachmentStorage.unreferencedCount} unused` : ""}
                </p>}
                <p className="mt-2 text-xs text-muted-foreground">Backups stay local. Diagnostics exclude credentials and transcript content.</p>
                {systemCheck && <pre className="mt-3 max-h-64 overflow-auto rounded-md border p-3 text-xs" aria-label="System check results">{systemCheck}</pre>}
                {storageStatus && <p className="mt-3 text-sm text-muted-foreground" role="status">{storageStatus}</p>}
              </SettingsCard>
              <SettingsCard danger title="Reset preferences" description="Restore appearance, workspace, shortcuts, and coding-agent profiles to their defaults.">
                <Button variant="destructive" disabled={resettingPreferences} onClick={() => void onResetAll()}>
                  {resettingPreferences ? <><DotMatrixLoader size={16} />Resetting…</> : "Reset all"}
                </Button>
                {preferencesStatus && <p className="mt-3 text-sm text-muted-foreground" role="status">{preferencesStatus}</p>}
              </SettingsCard>
            </>
          )}
        </main>
      </ScrollArea>
      <AlertDialog open={deleteThemeOpen} onOpenChange={(open) => {
        setDeleteThemeOpen(open);
        if (!open) setReplacementThemeId("");
      }}>
        <AlertDialogContent className="wj-dialog wj-dialog-medium">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{selectedTheme.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedThemeIsAssigned
                ? `Choose the ${selectedTheme.variant} theme wheeljack should use anywhere this theme is assigned.`
                : `Choose the ${selectedTheme.variant} theme to show after this custom theme is deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label>Replace with</Label>
            <div className="mt-2 grid max-h-72 grid-cols-1 gap-2 overflow-y-auto p-0.5 sm:grid-cols-2">
              {replacementThemes.map((theme) => <ThemeChoice key={theme.id} theme={theme} selected={theme.id === replacementThemeId} onClick={() => setReplacementThemeId(theme.id)} />)}
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={!replacementThemeId} onClick={removeTheme}>Delete theme</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(pendingThemeImport)} onOpenChange={(open) => !open && setPendingThemeImport(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Choose a terminal scheme</AlertDialogTitle>
            <AlertDialogDescription>This file contains several Windows Terminal schemes. Choose one to import and apply.</AlertDialogDescription>
          </AlertDialogHeader>
          <Select value={pendingThemeIndex} onValueChange={setPendingThemeIndex}>
            <SelectTrigger aria-label="Terminal scheme"><SelectValue /></SelectTrigger>
            <SelectContent>{pendingThemeImport?.themes.map((theme, index) => <SelectItem key={`${theme.name}-${index}`} value={String(index)}>{theme.name}</SelectItem>)}</SelectContent>
          </Select>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const theme = pendingThemeImport?.themes[Number(pendingThemeIndex)];
              if (pendingThemeImport && theme) applyThemeImport(pendingThemeImport, theme);
              setPendingThemeImport(undefined);
            }}>Import scheme</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={vsCodeThemes.length > 0} onOpenChange={(open) => !open && setVsCodeThemes([])}>
        <AlertDialogContent className="wj-dialog wj-dialog-medium">
          <AlertDialogHeader>
            <AlertDialogTitle>Import from VS Code</AlertDialogTitle>
            <AlertDialogDescription>Choose from the color themes installed in your local VS Code extensions.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input aria-label="Search VS Code themes" placeholder="Search themes or extensions…" value={vsCodeThemeQuery} onChange={(event) => setVsCodeThemeQuery(event.target.value)} />
          <ScrollArea className="wj-vscode-theme-list">
            {vsCodeThemes
              .filter((theme) => `${theme.label} ${theme.extension}`.toLowerCase().includes(vsCodeThemeQuery.trim().toLowerCase()))
              .map((theme) => <button type="button" aria-pressed={theme.path === vsCodeThemePath} className="wj-vscode-theme-option" key={theme.path} onClick={() => setVsCodeThemePath(theme.path)}><strong>{theme.label}</strong><small>{theme.extension}</small></button>)}
            {vsCodeThemes.every((theme) => !`${theme.label} ${theme.extension}`.toLowerCase().includes(vsCodeThemeQuery.trim().toLowerCase())) && <p className="p-3 text-sm text-muted-foreground">No matching themes.</p>}
          </ScrollArea>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!vsCodeThemePath} onClick={() => void importVsCodeTheme()}>Import theme</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ThemePreview({ theme, preferences }: { theme: ThemeDefinition; preferences: UiPreferences }) {
  const color = compileTheme(theme);
  const preview = {
    "--wj-preview-canvas": color.canvas,
    "--wj-preview-sidebar": color.sidebar,
    "--wj-preview-chrome": color.chrome,
    "--wj-preview-surface": color.surface,
    "--wj-preview-raised": color.raised,
    "--wj-preview-border": color.border,
    "--wj-preview-text": color.text,
    "--wj-preview-muted": color.muted,
    "--wj-preview-accent": color.accent,
    "--wj-preview-accent-foreground": color.accentForeground,
    "--wj-preview-success": color.success,
    "--wj-preview-warning": color.warning,
    "--wj-preview-terminal": color.terminalBackground,
    "--wj-preview-terminal-text": color.terminalForeground,
    "--wj-preview-heading-font": preferences.headingFontFamily,
    "--wj-preview-ui-font": preferences.uiFontFamily,
    "--wj-preview-code-font": preferences.codeFontFamily,
    "--wj-preview-ui-size": `${Math.max(8, preferences.uiFontSize * .72)}px`,
    "--wj-preview-code-size": `${Math.max(7, preferences.terminalFontSize * .62)}px`,
  } as React.CSSProperties;
  return (
    <aside className="wj-appearance-preview" aria-label="Appearance preview">
      <div className="wj-workspace-preview-label"><span>Preview</span><small>Updates as you edit</small></div>
      <div className="wj-appearance-preview-frame" style={preview} aria-hidden="true">
        <nav>
          <strong>WJ</strong>
          <span className="selected"><i />Home</span>
          <span><i />Work</span>
          <span><i />Plan</span>
          <small>PROJECTS</small>
          <span>wheeljack</span>
        </nav>
        <section>
          <header><span>codex · main</span><b>− &nbsp; □</b></header>
          <div className="wj-appearance-preview-terminal">
            <span>PS C:\wheeljack&gt; codex</span>
            <p>Inspecting workspace and coordinating agents…</p>
            <em>Ready</em>
          </div>
          <footer><span>Route a prompt to active agents…</span><b>↵</b></footer>
        </section>
        <div className="wj-appearance-preview-rail">
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="wj-appearance-preview-meta"><strong>{theme.name}</strong><span>{theme.isBuiltIn ? "Built-in" : "Custom"} · {theme.variant}</span></div>
    </aside>
  );
}

function ThemeChoice({ theme, selected, onClick }: { theme: ThemeDefinition; selected: boolean; onClick: () => void }) {
  const color = compileTheme(theme);
  const preview = {
    "--preview-canvas": color.canvas,
    "--preview-sidebar": color.sidebar,
    "--preview-chrome": color.chrome,
    "--preview-surface": color.surface,
    "--preview-text": color.text,
    "--preview-muted": color.muted,
    "--preview-accent": color.accent,
    "--preview-success": color.success,
    "--preview-warning": color.warning,
    "--preview-danger": color.danger,
    "--preview-terminal": color.terminalBackground,
    "--preview-terminal-text": color.terminalForeground,
  } as React.CSSProperties;
  return <button type="button" aria-pressed={selected} className={`wj-theme-choice ${selected ? "selected" : ""}`} onClick={onClick}><span aria-hidden className="wj-theme-choice-preview" style={preview}><span className="wj-theme-choice-preview-sidebar" /><span className="wj-theme-choice-preview-main"><span className="wj-theme-choice-preview-chrome" /><span className="wj-theme-choice-preview-terminal" /><span className="wj-theme-choice-preview-composer" /></span><span className="wj-theme-choice-preview-rail"><span /><span /><span /><span /></span></span><strong>{theme.name}</strong><small>{theme.isBuiltIn ? theme.variant === "dark" ? "Dark" : "Light" : `Custom · ${theme.variant === "dark" ? "Dark" : "Light"}`}</small></button>;
}

function ThemeColorField({ label, value, disabled, contrastAgainst, onChange, onReset }: { label: string; value: string; disabled: boolean; contrastAgainst?: string; onChange: (value: string) => void; onReset?: () => void }) {
  return <ColorPickerPopover label={label} value={value} disabled={disabled} contrastAgainst={contrastAgainst} onChange={onChange} onReset={onReset} />;
}

function seedContrastReference(key: keyof ThemeDefinition["seed"], theme: ThemeDefinition): string | undefined {
  if (key === "canvas" || key === "surface") return theme.seed.text;
  if (key === "text") return theme.seed.canvas;
  if (key === "muted") return theme.seed.surface;
  return undefined;
}

function paletteContrastReference(key: string, theme: ThemeDefinition): string | undefined {
  const palette = compileTheme(theme);
  if (key === "text") return palette.canvas;
  if (key === "muted" || key === "subtle") return palette.surface;
  if (key === "accentForeground") return palette.accent;
  if (key === "terminalForeground" || key === "cursor") return palette.terminalBackground;
  return undefined;
}

function ShortcutSettings({ bindings, onBindings }: { bindings: ShortcutBindings; onBindings: (bindings: ShortcutBindings) => void }) {
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<ShortcutAction>();
  const [status, setStatus] = useState("Select a shortcut field, then press the new key combination. Backspace clears it.");
  const visible = shortcutDefinitions.filter(({ label, group }) => `${label} ${group}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = [...new Set(visible.map(({ group }) => group))];
  const assign = (action: ShortcutAction, binding: string) => {
    const conflict = shortcutConflict(bindings, action, binding);
    if (conflict) {
      setStatus(`${formatShortcut(binding)} is already assigned to ${conflict.label}.`);
      return;
    }
    onBindings({ ...bindings, [action]: binding });
    setStatus(binding ? `${shortcutDefinitions.find(({ id }) => id === action)?.label} set to ${formatShortcut(binding)}.` : "Shortcut cleared.");
    setRecording(undefined);
  };
  return (
    <SettingsCard wide title="Keyboard shortcuts" description="Bindings are local to wheeljack and persist with your desktop preferences.">
      <div className="mb-4 flex items-center gap-3">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" aria-label="Search shortcuts" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands" /></div>
        <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl/Cmd, Alt, or F-key required</span>
      </div>
      <p className="mb-3 min-h-5 text-xs text-muted-foreground" role="status" aria-live="polite">{status}</p>
      <div className="divide-y divide-border rounded-md border">
        {groups.map((group) => <section key={group} aria-labelledby={`shortcut-group-${group.toLowerCase()}`}>
          <h3 id={`shortcut-group-${group.toLowerCase()}`} className="border-b bg-muted/35 px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group}</h3>
          <div className="divide-y divide-border">{visible.filter((definition) => definition.group === group).map((definition) => {
            const binding = bindings[definition.id];
            return <div className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(180px,1fr)_minmax(180px,240px)_auto]" key={definition.id}>
              <label className="flex min-w-0 items-center gap-2 text-sm" htmlFor={`shortcut-${definition.id}`}><Key className="size-4 shrink-0 text-muted-foreground" /><span>{definition.label}</span></label>
              <Input
                id={`shortcut-${definition.id}`}
                data-shortcut-recorder=""
                readOnly
                aria-label={`Shortcut for ${definition.label}`}
                className="cursor-default font-mono"
                value={recording === definition.id ? "Press shortcut…" : formatShortcut(binding)}
                onFocus={() => { setRecording(definition.id); setStatus(`Recording ${definition.label}. Press Escape to cancel.`); }}
                onBlur={() => setRecording((current) => current === definition.id ? undefined : current)}
                onKeyDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.key === "Escape") { event.currentTarget.blur(); return; }
                  if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.metaKey && !event.altKey) { assign(definition.id, ""); return; }
                  const next = bindingFromKeyboardEvent(event);
                  if (!next) return;
                  if (!isBindableShortcut(next)) { setStatus("Add Ctrl/Cmd or Alt, or use an F-key, so ordinary typing remains available."); return; }
                  assign(definition.id, next);
                  event.currentTarget.blur();
                }}
              />
              <div className="flex justify-end gap-1"><Button variant="ghost" size="xs" disabled={!binding} onClick={() => assign(definition.id, "")}>Clear</Button><Button variant="ghost" size="xs" disabled={binding === definition.defaultBinding} onClick={() => assign(definition.id, definition.defaultBinding)}>Reset</Button></div>
            </div>;
          })}</div>
        </section>)}
        {visible.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No matching shortcuts.</p>}
      </div>
    </SettingsCard>
  );
}

function SettingsCard({ title, description, action, danger = false, wide = false, children }: { title: string; description: string; action?: React.ReactNode; danger?: boolean; wide?: boolean; children: React.ReactNode }) {
  return <section className={`wj-settings-group ${danger ? "wj-settings-danger" : ""} ${wide ? "wj-settings-group-wide" : ""}`}><header><div><h2>{title}</h2><p>{description}</p></div>{action}</header><div className="wj-settings-group-content">{children}</div></section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function SliderField({ label, value, min, max, step = 1, suffix = "px", onValue }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onValue: (value: number) => void }) {
  return <div className="space-y-2"><div className="flex justify-between text-sm text-muted-foreground"><Label>{label}</Label><span className="font-mono">{value}{suffix}</span></div><Slider aria-label={label} value={[value]} min={min} max={max} step={step} onValueChange={([next]) => onValue(next)} /></div>;
}

function FontField({ ariaLabel, value, options, onValue }: { ariaLabel: string; value: string; options: string[]; onValue: (value: string) => void }) {
  return <div className="flex"><Input className="rounded-r-none" aria-label={ariaLabel} value={value} onChange={(event) => onValue(event.target.value)} /><DropdownMenu><DropdownMenuTrigger asChild><Button className="-ml-px rounded-l-none" variant="outline" size="icon" disabled={!options.length} aria-label={`Choose ${ariaLabel.toLowerCase()}`}><ChevronDownIcon /></Button></DropdownMenuTrigger><DropdownMenuContent className="max-h-64 min-w-64" align="end">{options.map((option) => <DropdownMenuCheckboxItem key={option} checked={option === value} onSelect={() => onValue(option)} style={{ fontFamily: option }}>{option}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu></div>;
}

function ToggleSetting({ label, description, checked, onChecked }: { label: string; description?: string; checked: boolean; onChecked: (checked: boolean) => void }) {
  const id = `wj-setting-${label.toLowerCase().replaceAll(" ", "-")}`;
  return <div className="wj-toggle-setting"><div><Label htmlFor={id}>{label}</Label>{description && <p>{description}</p>}</div><Switch id={id} aria-label={label} checked={checked} onCheckedChange={onChecked} /></div>;
}

const defaultInterfacePreferences: Partial<UiPreferences> = {
  sidebarCollapsed: false,
  expandedProjectIds: [],
  floorRailWidthByProject: {},
  sidebarWidth: 240,
  utilityPanelWidth: 400,
  utilityPanelTab: "inbox",
  showPaneActions: true,
  showProjectPaths: true,
  showRecentActivity: true,
  showAgentRail: true,
};
