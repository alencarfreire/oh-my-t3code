export type TopologyKind = "intra-thread-squad" | "issue-thread-orchestrator" | (string & {});

export type IsolationKind = "shared" | "worktree" | (string & {});

export interface OrchestratorSelection {
  providerInstanceId: string;
  model: string;
  options: Record<string, string>;
}

export interface FallbackStep {
  providerInstanceId: string;
  model: string;
  options: Record<string, string>;
  reason: string;
}

export interface ContentionPolicy {
  singleTestDb: boolean;
  envVars: Record<string, string>;
  gitIgnoredBuilds: string[];
  conflictFiles: string[];
  defaultIsolation: IsolationKind;
}

export interface RoleConfig {
  id: string;
  title: string;
  description: string;
  whenToUse: string;
  providerInstanceId: string;
  model: string;
  options: Record<string, string>;
  skills: string[];
  mcps: string[];
  allowedPaths: string[];
  forbiddenPaths: string[];
  invariants: string[];
  verificationCommands: string[];
}

export interface GlobalAppConfig {
  activeGlobalPresetId: string;
  enabled: boolean;
}

export interface PresetConfig {
  id: string;
  name: string;
  description: string;
  extends: string | null;
  enabled: boolean;
  topology: TopologyKind;
  orchestrator: OrchestratorSelection;
  fallbackChain: FallbackStep[];
  contention: ContentionPolicy;
  roles: Record<string, RoleConfig>;
  disabledRoles?: string[];
}

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  path: string;
  source: "skillshare" | "gemini" | "project" | (string & {});
}

export interface ProviderInstanceInfo {
  id: string;
  label: string;
  provider: string;
  isBuiltin: boolean;
  configured: boolean;
  enabled: boolean;
  models: string[];
}

export interface T3ModelOption {
  id: string;
  value: unknown;
}

export interface T3ModelSelection {
  instanceId: string;
  model: string;
  options: T3ModelOption[];
}

export interface SubagentActivity {
  subagentId: string;
  parentThreadId: string;
  childThreadId: string | null;
  projectId: string | null;
  projectTitle: string | null;
  role: string | null;
  title: string | null;
  promptPreview: string | null;
  providerInstanceId: string | null;
  requestedModel: string | null;
  resolvedModel: string | null;
  status: string;
  summary: string | null;
  errorMessage: string | null;
  createdAt: string | null;
  updatedAt: string;
  settledAt: string | null;
}

export interface ProjectSummary {
  projectId: string;
  title: string;
  workspaceRoot: string;
  defaultModel: string | null;
  activeInstanceId: string | null;
  activeModel: string | null;
  updatedAt: string;
  hasLocalPreset: boolean;
  localPresetId: string | null;
  localPresetExtends: string | null;
  presetEnabled: boolean;
  hasCustomOverride: boolean;
  detectedSquadSlug: string | null;
  detectedSquadPath: string | null;
  activeSubagentCount: number;
}

export interface DashboardSnapshot {
  globalConfig: GlobalAppConfig;
  projects: ProjectSummary[];
  subagents: SubagentActivity[];
  providerInstances: ProviderInstanceInfo[];
  globalPresets: PresetConfig[];
  skills: SkillMetadata[];
  defaultModelSelection: T3ModelSelection | null;
  fallbackModelSelection: T3ModelSelection | null;
  sqliteAvailable: boolean;
  settingsAvailable: boolean;
}

export interface ResolvedProjectPreset {
  projectId: string;
  workspaceRoot: string;
  projectSlug: string;
  hasLocalOverride: boolean;
  localPresetPath: string;
  rawLocalPreset: PresetConfig | null;
  resolvedPreset: PresetConfig;
  detectedSquadPath: string | null;
}

export interface CompiledFilePreview {
  path: string;
  relativePath: string;
  existingContent: string | null;
  newContent: string;
  unifiedDiff: string;
  changed: boolean;
}

export interface SettingsOverridePreview {
  settingsPath: string;
  projectId: string;
  existingOverride: Record<string, unknown> | null;
  newOverride: Record<string, unknown>;
  unifiedDiff: string;
  changed: boolean;
}

export interface CompilePreviewResult {
  projectId: string;
  workspaceRoot: string;
  projectSlug: string;
  presetId: string;
  files: CompiledFilePreview[];
  settingsPreview: SettingsOverridePreview;
  hasChanges: boolean;
}

export interface SyncResult {
  projectId: string;
  workspaceRoot: string;
  presetId: string;
  writtenFiles: string[];
  settingsPath: string;
  backupPath: string | null;
  activeInstanceId: string;
  activeModel: string;
}

/**
 * Exact Tauri IPC command names exposed by `src-tauri/src/lib.rs`.
 */
export const IPC_COMMANDS = {
  getDashboardSnapshot: "get_dashboard_snapshot",
  listGlobalPresets: "list_global_presets",
  getProjectPreset: "get_project_preset",
  saveGlobalPreset: "save_global_preset",
  saveProjectPreset: "save_project_preset",
  previewPresetSync: "preview_preset_sync",
  applyPresetSync: "apply_preset_sync",
  swapProjectInstance: "swap_project_instance",
  importProjectSquad: "import_project_squad",
  setGlobalPresetConfig: "set_global_preset_config",
  swapGlobalInstance: "swap_global_instance",
  setProjectPresetEnabled: "set_project_preset_enabled",
  removeProjectOverride: "remove_project_override",
  openStudioWindow: "open_studio_window",
  togglePopoverWindow: "toggle_popover_window",
} as const;

export type IpcCommandName = (typeof IPC_COMMANDS)[keyof typeof IPC_COMMANDS];

export interface IpcCommandArgs {
  get_dashboard_snapshot: Record<string, never> | undefined;
  list_global_presets: Record<string, never> | undefined;
  get_project_preset: {
    projectId: string;
    workspaceRoot: string;
  };
  save_global_preset: {
    preset: PresetConfig;
  };
  save_project_preset: {
    projectId: string;
    workspaceRoot: string;
    preset: PresetConfig;
  };
  preview_preset_sync: {
    projectId: string;
    workspaceRoot: string;
    preset: PresetConfig;
  };
  apply_preset_sync: {
    projectId: string;
    workspaceRoot: string;
    presetIdOrCustom?: string | null;
    customPreset?: PresetConfig | null;
  };
  swap_project_instance: {
    projectId: string;
    workspaceRoot: string;
  };
  import_project_squad: {
    projectId: string;
    workspaceRoot: string;
  };
  set_global_preset_config: {
    activePresetId: string;
    enabled: boolean;
  };
  swap_global_instance: Record<string, never> | undefined;
  set_project_preset_enabled: {
    projectId: string;
    workspaceRoot: string;
    enabled: boolean;
  };
  remove_project_override: {
    projectId: string;
    workspaceRoot: string;
  };
  open_studio_window: {
    projectId?: string | null;
    presetId?: string | null;
  };
  toggle_popover_window: Record<string, never> | undefined;
}

export interface IpcCommandReturns {
  get_dashboard_snapshot: DashboardSnapshot;
  list_global_presets: PresetConfig[];
  get_project_preset: ResolvedProjectPreset;
  save_global_preset: PresetConfig;
  save_project_preset: ResolvedProjectPreset;
  preview_preset_sync: CompilePreviewResult;
  apply_preset_sync: SyncResult;
  swap_project_instance: SyncResult;
  import_project_squad: ResolvedProjectPreset;
  set_global_preset_config: DashboardSnapshot;
  swap_global_instance: DashboardSnapshot;
  set_project_preset_enabled: SyncResult;
  remove_project_override: DashboardSnapshot;
  open_studio_window: void;
  toggle_popover_window: void;
}
