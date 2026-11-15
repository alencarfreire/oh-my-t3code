import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  Check,
  Cpu,
  FolderGit2,
  Globe,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Badge, getInstanceBadgeTone } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { StatusToggle } from "../components/ui/StatusToggle";
import { invokeIpc } from "../lib/ipc-client";
import { resolveInstanceShortLabel } from "../lib/preset-utils";
import {
  IPC_COMMANDS,
  type DashboardSnapshot,
  type PresetConfig,
  type ProjectSummary,
} from "../types/ipc";

function defaultPresetForProject(
  project: ProjectSummary,
  snapshot: DashboardSnapshot,
): string {
  if (
    project.localPresetExtends &&
    snapshot.globalPresets.some((p) => p.id === project.localPresetExtends)
  ) {
    return project.localPresetExtends;
  }
  if (
    project.localPresetId &&
    snapshot.globalPresets.some((p) => p.id === project.localPresetId)
  ) {
    return project.localPresetId;
  }
  if (project.activeInstanceId === "codex") {
    const codex = snapshot.globalPresets.find((p) => p.id === "codex-squad");
    if (codex) return codex.id;
  }
  return snapshot.globalConfig.activeGlobalPresetId ?? snapshot.globalPresets[0]?.id ?? "default";
}

const SWAP_PILL_CLASSES: Record<string, string> = {
  indigo:
    "border-indigo-400/35 bg-indigo-500/15 text-indigo-200 enabled:hover:bg-indigo-500/25 enabled:hover:border-indigo-400/55",
  sky: "border-sky-400/35 bg-sky-500/15 text-sky-200 enabled:hover:bg-sky-500/25 enabled:hover:border-sky-400/55",
  emerald:
    "border-emerald-400/35 bg-emerald-500/15 text-emerald-200 enabled:hover:bg-emerald-500/25 enabled:hover:border-emerald-400/55",
  amber:
    "border-amber-400/35 bg-amber-500/15 text-amber-200 enabled:hover:bg-amber-500/25 enabled:hover:border-amber-400/55",
  neutral:
    "border-white/15 bg-zinc-800/80 text-zinc-200 enabled:hover:bg-zinc-700/80 enabled:hover:border-white/25",
};

const STATIC_PILL_CLASSES: Record<string, string> = {
  indigo: "border-indigo-400/30 bg-indigo-500/12 text-indigo-200",
  sky: "border-sky-400/30 bg-sky-500/12 text-sky-200",
  emerald: "border-emerald-400/30 bg-emerald-500/12 text-emerald-200",
  amber: "border-amber-400/30 bg-amber-500/12 text-amber-200",
  neutral: "border-white/12 bg-zinc-800/80 text-zinc-200",
};

export function PopoverView() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [selectedPresets, setSelectedPresets] = useState<Record<string, string>>({});
  const [busyProjectAction, setBusyProjectAction] = useState<
    Record<string, "sync" | "swap" | "toggle" | "remove">
  >({});
  const [busyGlobalAction, setBusyGlobalAction] = useState<"config" | "swap" | null>(
    null,
  );
  const [syncedProjectIds, setSyncedProjectIds] = useState<Record<string, boolean>>({});
  const [configuringProject, setConfiguringProject] = useState(false);
  const [newOverrideProjectId, setNewOverrideProjectId] = useState("");
  const [newOverridePresetId, setNewOverridePresetId] = useState("");
  const [applyingNewOverride, setApplyingNewOverride] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const loadSnapshot = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMsg(null);
    try {
      const data = await invokeIpc(IPC_COMMANDS.getDashboardSnapshot);
      setSnapshot(data);
      setSelectedPresets((prev) => {
        const next = { ...prev };
        for (const project of data.projects) {
          if (!next[project.projectId]) {
            next[project.projectId] = defaultPresetForProject(project, data);
          }
        }
        return next;
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSnapshot(false);
  }, [loadSnapshot]);

  const handleOpenStudio = useCallback(
    async (projectId?: string | null, presetId?: string | null) => {
      try {
        await invokeIpc(IPC_COMMANDS.openStudioWindow, {
          projectId: projectId ?? null,
          presetId: presetId ?? null,
        });
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  // Keyboard shortcuts: Escape closes popover, Cmd+K or '/' focuses search, Cmd+, opens Studio
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void invokeIpc(IPC_COMMANDS.togglePopoverWindow);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        void handleOpenStudio(null, null);
        return;
      }
      const target = event.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);
      if (event.key === "/" && !isEditable) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleOpenStudio]);

  const sortedGlobalPresets = useMemo(() => {
    if (!snapshot) return [];
    const rank = (id: string) => {
      if (id === "default") return 0;
      if (id === "agy-dual") return 1;
      if (id === "codex-squad") return 2;
      if (id === "hybrid-agy-codex") return 3;
      return 4;
    };
    return [...snapshot.globalPresets].sort((a, b) => {
      const diff = rank(a.id) - rank(b.id);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
  }, [snapshot]);

  const activeGlobalPreset: PresetConfig | null = useMemo(() => {
    if (!snapshot) return null;
    return (
      snapshot.globalPresets.find(
        (p) => p.id === snapshot.globalConfig.activeGlobalPresetId,
      ) ??
      sortedGlobalPresets[0] ??
      null
    );
  }, [snapshot, sortedGlobalPresets]);

  const overrideProjects = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.projects.filter((project) => project.hasCustomOverride);
  }, [snapshot]);

  const unconfiguredProjects = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.projects.filter((project) => !project.hasCustomOverride);
  }, [snapshot]);

  // Keep the "+ Configurar Projeto" form defaults synchronized with available items
  useEffect(() => {
    if (
      unconfiguredProjects.length > 0 &&
      !unconfiguredProjects.some((p) => p.projectId === newOverrideProjectId)
    ) {
      setNewOverrideProjectId(unconfiguredProjects[0].projectId);
    }
    if (
      snapshot &&
      snapshot.globalPresets.length > 0 &&
      !snapshot.globalPresets.some((p) => p.id === newOverridePresetId)
    ) {
      setNewOverridePresetId(snapshot.globalConfig.activeGlobalPresetId);
    }
  }, [newOverridePresetId, newOverrideProjectId, snapshot, unconfiguredProjects]);

  const normalizedQuery = projectQuery.trim().toLowerCase();

  const filteredOverrideProjects = useMemo(() => {
    if (!snapshot) return [];
    if (!normalizedQuery) return overrideProjects;
    return overrideProjects.filter((project) => {
      const instanceLabel = resolveInstanceShortLabel(
        project.activeInstanceId,
        snapshot.providerInstances,
      );
      return (
        project.title.toLowerCase().includes(normalizedQuery) ||
        project.workspaceRoot.toLowerCase().includes(normalizedQuery) ||
        (project.localPresetId?.toLowerCase().includes(normalizedQuery) ?? false) ||
        (project.localPresetExtends?.toLowerCase().includes(normalizedQuery) ?? false) ||
        (project.detectedSquadSlug?.toLowerCase().includes(normalizedQuery) ?? false) ||
        instanceLabel.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [normalizedQuery, overrideProjects, snapshot]);

  const handleToggleGlobalEnabled = async () => {
    if (!snapshot) return;
    const nextEnabled = !snapshot.globalConfig.enabled;
    setBusyGlobalAction("config");
    setErrorMsg(null);
    try {
      const updated = await invokeIpc(IPC_COMMANDS.setGlobalPresetConfig, {
        activePresetId: snapshot.globalConfig.activeGlobalPresetId,
        enabled: nextEnabled,
      });
      setSnapshot(updated);
      setStatusMessage(
        nextEnabled
          ? `Preset Global (${updated.globalConfig.activeGlobalPresetId}) ativado e sincronizado no T3 Code.`
          : `Preset Global (${updated.globalConfig.activeGlobalPresetId}) desativado.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyGlobalAction(null);
    }
  };

  const handleChangeGlobalPreset = async (nextPresetId: string) => {
    if (!snapshot) return;
    setBusyGlobalAction("config");
    setErrorMsg(null);
    try {
      const updated = await invokeIpc(IPC_COMMANDS.setGlobalPresetConfig, {
        activePresetId: nextPresetId,
        enabled: snapshot.globalConfig.enabled,
      });
      setSnapshot(updated);
      setStatusMessage(
        updated.globalConfig.enabled
          ? `Preset Global Default alterado para ${nextPresetId} e sincronizado no settings.json.`
          : `Preset Global Default alterado para ${nextPresetId} (pausado).`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyGlobalAction(null);
    }
  };

  const handleSwapGlobalInstance = async () => {
    if (!snapshot || !snapshot.globalConfig.enabled) return;
    setBusyGlobalAction("swap");
    setErrorMsg(null);
    try {
      const updated = await invokeIpc(IPC_COMMANDS.swapGlobalInstance);
      setSnapshot(updated);
      const nextPreset =
        updated.globalPresets.find(
          (p) => p.id === updated.globalConfig.activeGlobalPresetId,
        ) ?? updated.globalPresets[0];
      const nextLabel = resolveInstanceShortLabel(
        nextPreset?.orchestrator.providerInstanceId,
        updated.providerInstances,
      );
      setStatusMessage(
        nextPreset?.orchestrator.providerInstanceId === "codex"
          ? `Modelo global alternado: ${nextLabel} (${nextPreset.orchestrator.model}).`
          : `Instância global invertida: ${nextLabel} (${nextPreset?.orchestrator.model ?? "gemini-4-hydrogen"}).`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyGlobalAction(null);
    }
  };

  const handleToggleProjectEnabled = async (project: ProjectSummary) => {
    if (!snapshot) return;
    const nextEnabled = !project.presetEnabled;
    setBusyProjectAction((prev) => ({ ...prev, [project.projectId]: "toggle" }));
    setErrorMsg(null);
    try {
      await invokeIpc(IPC_COMMANDS.setProjectPresetEnabled, {
        projectId: project.projectId,
        workspaceRoot: project.workspaceRoot,
        enabled: nextEnabled,
      });
      setStatusMessage(
        nextEnabled
          ? `Override de ${project.title} ativado e sincronizado.`
          : `Override de ${project.title} desativado — seguindo Global Default.`,
      );
      await loadSnapshot(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProjectAction((prev) => {
        const next = { ...prev };
        delete next[project.projectId];
        return next;
      });
    }
  };

  const handleRemoveProjectOverride = async (project: ProjectSummary) => {
    setBusyProjectAction((prev) => ({ ...prev, [project.projectId]: "remove" }));
    setErrorMsg(null);
    try {
      const updated = await invokeIpc(IPC_COMMANDS.removeProjectOverride, {
        projectId: project.projectId,
        workspaceRoot: project.workspaceRoot,
      });
      setSnapshot(updated);
      setStatusMessage(
        `Override de ${project.title} removido — projeto voltou ao Global Default.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProjectAction((prev) => {
        const next = { ...prev };
        delete next[project.projectId];
        return next;
      });
    }
  };

  const handleApplyNewProjectOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!snapshot) return;
    const targetProject = unconfiguredProjects.find(
      (p) => p.projectId === newOverrideProjectId,
    );
    if (!targetProject) return;
    const presetId =
      newOverridePresetId || snapshot.globalConfig.activeGlobalPresetId;

    setApplyingNewOverride(true);
    setErrorMsg(null);
    try {
      const result = await invokeIpc(IPC_COMMANDS.applyPresetSync, {
        projectId: targetProject.projectId,
        workspaceRoot: targetProject.workspaceRoot,
        presetIdOrCustom: presetId,
        customPreset: null,
      });
      const label = resolveInstanceShortLabel(
        result.activeInstanceId,
        snapshot.providerInstances,
      );
      setSelectedPresets((prev) => ({
        ...prev,
        [targetProject.projectId]: presetId,
      }));
      setConfiguringProject(false);
      setStatusMessage(
        `Override criado! ${targetProject.title} configurado com ${result.presetId} (${label} · ${result.activeModel}).`,
      );
      await loadSnapshot(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingNewOverride(false);
    }
  };

  const handleSyncProject = async (project: ProjectSummary) => {
    if (!snapshot) return;
    const presetId =
      selectedPresets[project.projectId] ?? defaultPresetForProject(project, snapshot);

    setBusyProjectAction((prev) => ({ ...prev, [project.projectId]: "sync" }));
    setErrorMsg(null);
    try {
      const result = await invokeIpc(IPC_COMMANDS.applyPresetSync, {
        projectId: project.projectId,
        workspaceRoot: project.workspaceRoot,
        presetIdOrCustom: presetId,
        customPreset: null,
      });
      setSyncedProjectIds((prev) => ({ ...prev, [project.projectId]: true }));
      const label = resolveInstanceShortLabel(
        result.activeInstanceId,
        snapshot.providerInstances,
      );
      setStatusMessage(
        `Sincronizado! ${project.title} atualizado com ${result.presetId} (${label} · ${result.activeModel}).`,
      );
      await loadSnapshot(true);
      window.setTimeout(() => {
        setSyncedProjectIds((prev) => ({ ...prev, [project.projectId]: false }));
      }, 2600);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProjectAction((prev) => {
        const next = { ...prev };
        delete next[project.projectId];
        return next;
      });
    }
  };

  const handleSwapInstance = async (project: ProjectSummary) => {
    if (!snapshot || !project.presetEnabled) return;
    setBusyProjectAction((prev) => ({ ...prev, [project.projectId]: "swap" }));
    setErrorMsg(null);
    try {
      const result = await invokeIpc(IPC_COMMANDS.swapProjectInstance, {
        projectId: project.projectId,
        workspaceRoot: project.workspaceRoot,
      });
      const label = resolveInstanceShortLabel(
        result.activeInstanceId,
        snapshot.providerInstances,
      );
      setStatusMessage(
        result.activeInstanceId === "codex"
          ? `Modelo alternado em ${project.title}: ${label} (${result.activeModel}).`
          : `Instância alternada em ${project.title}: ${label} (${result.activeModel}).`,
      );
      await loadSnapshot(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProjectAction((prev) => {
        const next = { ...prev };
        delete next[project.projectId];
        return next;
      });
    }
  };

  const globalInstanceId = activeGlobalPreset?.orchestrator.providerInstanceId ?? "codex";
  const globalModel = activeGlobalPreset?.orchestrator.model ?? "gpt-6.1-sol";
  const globalInstanceLabel = snapshot
    ? resolveInstanceShortLabel(globalInstanceId, snapshot.providerInstances)
    : "Codex";
  const globalInstanceTone = getInstanceBadgeTone(globalInstanceId);
  const canSwapGlobal =
    globalInstanceId === "antigravity" ||
    globalInstanceId === "antigravity_2" ||
    globalInstanceId === "codex";
  const globalSwapLabel =
    globalInstanceId === "codex" ? `${globalInstanceLabel} · ${globalModel}` : globalInstanceLabel;
  const globalSwapTitle = !snapshot?.globalConfig.enabled
    ? "Ative o Preset Global para inverter a instância"
    : globalInstanceId === "codex"
      ? "Alternar modelo global Codex (gpt-6.1-sol ⇄ gpt-6.1-terra)"
      : "Inverter instância global (Agy Veca ⇄ Agy Principal)";

  return (
    <div className="surface-backdrop flex h-full w-full flex-col overflow-hidden text-zinc-100">
      {/* Compact Raycast/OrbStack-style Menu Bar Header */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.08] bg-zinc-950/90 px-3.5 py-2.5 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Concentric outer radius 10px (8px inner + 2px padding) */}
          <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-amber-400/30 bg-gradient-to-b from-amber-500/15 to-zinc-900 p-0.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]">
            <img
              src="/logo.png"
              alt="Oh My T3Code"
              className="size-full rounded-lg object-contain"
            />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[13px] font-semibold leading-tight tracking-tight text-zinc-100">
              Oh My T3Code
            </h1>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Layers className="size-3 shrink-0 text-amber-300/90" aria-hidden="true" />
              {snapshot ? (
                <span className="truncate tabular-nums">
                  {snapshot.globalConfig.enabled ? "Global Ativo" : "Global Pausado"} ·{" "}
                  {overrideProjects.length}{" "}
                  {overrideProjects.length === 1 ? "override" : "overrides"} ·{" "}
                  {snapshot.globalPresets.length} presets
                </span>
              ) : (
                <span className="truncate">Presets & 1-Click Sync</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void loadSnapshot(true)}
            disabled={refreshing}
            aria-label="Atualizar painel"
            title="Atualizar dados do T3 Code"
          >
            <RefreshCw
              className={`size-3.5 ${refreshing ? "motion-safe:animate-spin" : ""}`}
              aria-hidden="true"
            />
          </Button>
          <Button
            variant="primary"
            size="xs"
            onClick={() => void handleOpenStudio(null, null)}
            title="Abrir Preset Studio (⌘,)"
          >
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            <span>Studio</span>
            <kbd className="hidden rounded border border-white/25 bg-white/10 px-1 font-mono text-[10px] leading-3.5 text-indigo-100 sm:inline-block">
              ⌘,
            </kbd>
          </Button>
        </div>
      </header>

      {/* Live polite status region rendered stably */}
      <div
        role="status"
        aria-live="polite"
        className={
          statusMessage
            ? "flex shrink-0 items-center gap-1.5 border-b border-emerald-500/20 bg-emerald-500/10 px-3.5 py-1.5 text-[11px] text-emerald-200"
            : "sr-only"
        }
      >
        {statusMessage ? (
          <>
            <Check className="size-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
            <span className="min-w-0 truncate">{statusMessage}</span>
          </>
        ) : null}
      </div>

      {errorMsg ? (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-rose-500/25 bg-rose-500/10 px-3.5 py-2 text-[11px] text-rose-200"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-rose-400" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words">{errorMsg}</span>
        </div>
      ) : null}

      {/* Main Scrollable Content */}
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3.5 py-3 space-y-3">
        {loading && !snapshot ? (
          <div className="space-y-3 py-8 text-center text-xs text-zinc-400">
            Carregando estado do T3 Code…
          </div>
        ) : snapshot ? (
          <>
            {/* Featured Top Card: Global Default Preset */}
            <section
              aria-labelledby="popover-global-heading"
              className={[
                "rounded-xl border p-3 space-y-2.5 transition-[border-color,background-color,box-shadow] duration-150",
                snapshot.globalConfig.enabled
                  ? "border-indigo-400/35 bg-gradient-to-b from-indigo-500/[0.12] to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.09),0_8px_20px_-10px_rgba(99,102,241,0.35)]"
                  : "border-white/[0.08] bg-zinc-900/65 opacity-90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
              ].join(" ")}
            >
              {/* Row 1: Title + Global Active/Disabled Toggle */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Globe
                      className={`size-3.5 shrink-0 ${
                        snapshot.globalConfig.enabled
                          ? "text-indigo-300"
                          : "text-zinc-500"
                      }`}
                      aria-hidden="true"
                    />
                    <h2
                      id="popover-global-heading"
                      className="truncate text-xs font-semibold tracking-tight text-zinc-100"
                    >
                      Preset Global (Default)
                    </h2>
                    {activeGlobalPreset?.id === "default" ? (
                      <Badge tone="sky">Instalado por padrão</Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-[10px] text-zinc-400">
                    {snapshot.globalConfig.enabled
                      ? `Padrão para todos os projetos · ${
                          activeGlobalPreset?.orchestrator.model ?? "gpt-6.1-sol"
                        }`
                      : "Desativado — projetos sem override usam config padrão do T3 Code"}
                  </p>
                </div>

                <StatusToggle
                  enabled={snapshot.globalConfig.enabled}
                  disabled={busyGlobalAction === "config"}
                  onClick={() => void handleToggleGlobalEnabled()}
                  aria-label="Alternar status do Preset Global"
                />
              </div>

              {/* Row 2: Global Select + Instance Pill / Swap + Studio Button */}
              <div className="flex flex-wrap items-center gap-1.5">
                <label htmlFor="popover-global-preset-select" className="sr-only">
                  Preset Global Default
                </label>
                <Select
                  id="popover-global-preset-select"
                  aria-label="Preset Global Default"
                  sizeVariant="xs"
                  value={snapshot.globalConfig.activeGlobalPresetId}
                  disabled={busyGlobalAction === "config"}
                  onChange={(e) => void handleChangeGlobalPreset(e.target.value)}
                  wrapperClassName="min-w-0 flex-1"
                >
                  {sortedGlobalPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.id === "default"
                        ? `${preset.id} — ${preset.name} (Instalado por padrão)`
                        : `${preset.id} — ${preset.name}`}
                    </option>
                  ))}
                </Select>

                {canSwapGlobal ? (
                  <button
                    type="button"
                    disabled={busyGlobalAction !== null || !snapshot.globalConfig.enabled}
                    onClick={() => void handleSwapGlobalInstance()}
                    aria-label="Inverter instância global"
                    title={globalSwapTitle}
                    className={[
                      "inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium whitespace-nowrap",
                      "transition-[background-color,border-color,color,transform,opacity] duration-150 ease-out",
                      "enabled:active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                      SWAP_PILL_CLASSES[globalInstanceTone] ?? SWAP_PILL_CLASSES.neutral,
                    ].join(" ")}
                  >
                    <Cpu className="size-3 shrink-0" aria-hidden="true" />
                    <span>{globalSwapLabel}</span>
                    <ArrowLeftRight
                      className={`size-3 shrink-0 opacity-85 ${
                        busyGlobalAction === "swap" ? "motion-safe:animate-pulse" : ""
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                ) : (
                  <span
                    className={[
                      "inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium whitespace-nowrap",
                      STATIC_PILL_CLASSES[globalInstanceTone] ??
                        STATIC_PILL_CLASSES.neutral,
                    ].join(" ")}
                  >
                    <Cpu className="size-3 shrink-0" aria-hidden="true" />
                    <span>{globalInstanceLabel}</span>
                  </span>
                )}

                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    void handleOpenStudio(
                      null,
                      snapshot.globalConfig.activeGlobalPresetId,
                    )
                  }
                  aria-label="Editar Preset Global no Studio"
                  title="Editar Preset Global no Studio"
                >
                  <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            </section>

            {/* Strict Overrides Section */}
            <section aria-labelledby="popover-projects-heading" className="space-y-2">
              <div className="flex items-center justify-between gap-2 px-0.5">
                <h2
                  id="popover-projects-heading"
                  className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
                >
                  Projetos com Override{" "}
                  <span className="tabular-nums text-zinc-300">
                    ({overrideProjects.length})
                  </span>
                </h2>

                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => setConfiguringProject((v) => !v)}
                  aria-expanded={configuringProject}
                >
                  <Plus className="size-3" aria-hidden="true" />
                  <span>Configurar Projeto</span>
                </Button>
              </div>

              {configuringProject ? (
                <form
                  onSubmit={(e) => void handleApplyNewProjectOverride(e)}
                  className="surface-card rounded-xl border border-indigo-400/30 bg-zinc-900/95 p-2.5 space-y-2"
                >
                  {unconfiguredProjects.length === 0 ? (
                    <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                      <span>
                        Todos os projetos do T3 Code já possuem override configurado.
                      </span>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setConfiguringProject(false)}
                      >
                        Fechar
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <label
                          htmlFor="configure-project-select"
                          className="block text-[10px] font-medium uppercase tracking-wider text-zinc-400"
                        >
                          Projeto do T3 Code (seguindo Global Default)
                        </label>
                        <Select
                          id="configure-project-select"
                          aria-label="Selecionar projeto para configurar"
                          sizeVariant="xs"
                          value={newOverrideProjectId}
                          onChange={(e) => setNewOverrideProjectId(e.target.value)}
                        >
                          {unconfiguredProjects.map((project) => (
                            <option key={project.projectId} value={project.projectId}>
                              {project.title}
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <label
                          htmlFor="configure-project-preset-select"
                          className="block text-[10px] font-medium uppercase tracking-wider text-zinc-400"
                        >
                          Preset de Override
                        </label>
                        <Select
                          id="configure-project-preset-select"
                          aria-label="Selecionar preset para override"
                          sizeVariant="xs"
                          value={newOverridePresetId}
                          onChange={(e) => setNewOverridePresetId(e.target.value)}
                        >
                          {sortedGlobalPresets.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.id} — {preset.name}
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div className="flex items-center justify-end gap-1.5 pt-0.5">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setConfiguringProject(false)}
                        >
                          Cancelar
                        </Button>
                        <Button
                          type="submit"
                          variant="primary"
                          size="xs"
                          disabled={applyingNewOverride}
                        >
                          {applyingNewOverride ? "Aplicando…" : "Aplicar Override"}
                        </Button>
                      </div>
                    </>
                  )}
                </form>
              ) : null}

              {overrideProjects.length > 1 ? (
                <div className="relative">
                  <label htmlFor="popover-project-filter" className="sr-only">
                    Filtrar projetos
                  </label>
                  <Search
                    className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500"
                    aria-hidden="true"
                  />
                  <input
                    ref={searchInputRef}
                    id="popover-project-filter"
                    type="search"
                    value={projectQuery}
                    onChange={(e) => setProjectQuery(e.target.value)}
                    placeholder="Filtrar overrides, preset ou instância…"
                    className="h-8 w-full rounded-lg border border-white/10 bg-zinc-900/90 ps-8 pe-12 text-xs text-zinc-100 placeholder:text-zinc-500 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] transition-[border-color,background-color] duration-150 hover:border-white/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  />
                  {projectQuery ? (
                    <button
                      type="button"
                      onClick={() => setProjectQuery("")}
                      aria-label="Limpar filtro de projetos"
                      className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  ) : (
                    <kbd
                      aria-hidden="true"
                      className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded border border-white/10 bg-zinc-950/90 px-1.5 py-0.5 font-mono text-[10px] leading-none text-zinc-500"
                    >
                      ⌘K
                    </kbd>
                  )}
                </div>
              ) : null}

              {overrideProjects.length === 0 ? (
                <div className="surface-card rounded-xl border-dashed px-3 py-4 text-center space-y-1">
                  <p className="text-xs font-medium text-zinc-300">
                    Nenhum projeto com override configurado.
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Todos os projetos ({snapshot.projects.length}) seguem o Preset Global
                    Default.
                  </p>
                </div>
              ) : filteredOverrideProjects.length === 0 ? (
                <div className="surface-card rounded-xl px-3 py-4 text-center space-y-2">
                  <p className="text-xs text-zinc-400">
                    Nenhum override corresponde a &ldquo;{projectQuery.trim()}&rdquo;.
                  </p>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setProjectQuery("")}
                  >
                    Limpar filtro
                  </Button>
                </div>
              ) : (
                <ul className="space-y-2">
                  {filteredOverrideProjects.map((project) => {
                    const selectedPresetId =
                      selectedPresets[project.projectId] ??
                      defaultPresetForProject(project, snapshot);
                    const busy = busyProjectAction[project.projectId];
                    const isSynced = Boolean(syncedProjectIds[project.projectId]);
                    const activeInstanceLabel = resolveInstanceShortLabel(
                      project.activeInstanceId,
                      snapshot.providerInstances,
                    );
                    const instanceTone = getInstanceBadgeTone(project.activeInstanceId);

                    return (
                      <li
                        key={project.projectId}
                        className={[
                          "surface-card-interactive rounded-xl p-2.5 space-y-2",
                          !project.presetEnabled ? "opacity-85" : "",
                        ].join(" ")}
                      >
                        {/* Row 1: Project identity + Active/Disabled Toggle */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-1.5">
                              <FolderGit2
                                className={`size-3.5 shrink-0 ${
                                  project.presetEnabled
                                    ? "text-indigo-300"
                                    : "text-zinc-500"
                                }`}
                                aria-hidden="true"
                              />
                              <span className="truncate text-xs font-semibold text-zinc-100">
                                {project.title}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-400">
                              {!project.presetEnabled ? (
                                <span className="text-amber-300/90">
                                  Seguindo Global Default (override pausado)
                                </span>
                              ) : (
                                <>
                                  {project.hasLocalPreset ? (
                                    <Badge tone="emerald" dot>
                                      Sincronizado
                                    </Badge>
                                  ) : project.detectedSquadSlug ? (
                                    <Badge tone="amber" dot>
                                      Squad s/ preset
                                    </Badge>
                                  ) : (
                                    <Badge tone="neutral" dot>
                                      Override
                                    </Badge>
                                  )}
                                  {project.activeModel ? (
                                    <span className="truncate font-mono text-zinc-300/90">
                                      {project.activeModel}
                                    </span>
                                  ) : null}
                                  {project.detectedSquadSlug ? (
                                    <span className="truncate font-mono text-zinc-500">
                                      · .{project.detectedSquadSlug}
                                    </span>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </div>

                          <StatusToggle
                            enabled={project.presetEnabled}
                            disabled={Boolean(busy)}
                            onClick={() => void handleToggleProjectEnabled(project)}
                            aria-label={`Alternar preset de ${project.title}`}
                          />
                        </div>

                        {/* Row 2: Active Instance Swap Pill + Quick Actions */}
                        <div className="flex items-center justify-between gap-1.5">
                          <button
                            type="button"
                            disabled={Boolean(busy) || !project.presetEnabled}
                            onClick={() => void handleSwapInstance(project)}
                            aria-label={
                              project.activeInstanceId === "codex"
                                ? `Alternar modelo Codex em ${project.title}`
                                : `Alternar instância Agy em ${project.title}`
                            }
                            title={
                              !project.presetEnabled
                                ? "Ative o override do projeto para inverter a instância"
                                : project.activeInstanceId === "codex"
                                  ? "Alternar gpt-6.1-sol ⇄ gpt-6.1-terra (1 clique)"
                                  : "Alternar Agy Veca ⇄ Agy Principal (1 clique)"
                            }
                            className={[
                              "inline-flex h-6 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium whitespace-nowrap",
                              "transition-[background-color,border-color,color,transform,opacity] duration-150 ease-out",
                              "enabled:active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                              SWAP_PILL_CLASSES[instanceTone] ?? SWAP_PILL_CLASSES.neutral,
                            ].join(" ")}
                          >
                            <Cpu className="size-3 shrink-0" aria-hidden="true" />
                            <span>
                              {project.activeInstanceId === "codex"
                                ? `${activeInstanceLabel} · ${project.activeModel ?? "gpt-6.1-sol"}`
                                : activeInstanceLabel}
                            </span>
                            <ArrowLeftRight
                              className={`size-3 shrink-0 opacity-85 ${
                                busy === "swap" ? "motion-safe:animate-pulse" : ""
                              }`}
                              aria-hidden="true"
                            />
                          </button>

                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => void handleRemoveProjectOverride(project)}
                            aria-label={`Remover override de ${project.title}`}
                            title="Remover override e voltar ao Global Default"
                            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-lg border border-transparent px-1.5 text-[10px] text-zinc-400 transition-colors hover:border-white/10 hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
                          >
                            <RotateCcw className="size-3" aria-hidden="true" />
                            <span>Global</span>
                          </button>
                        </div>

                        {/* Row 3: Unified Action Bar (Preset Select + Sync + Open in Studio) */}
                        <div className="flex items-center gap-1.5">
                          <label
                            htmlFor={`preset-select-${project.projectId}`}
                            className="sr-only"
                          >
                            Preset para {project.title}
                          </label>
                          <Select
                            id={`preset-select-${project.projectId}`}
                            sizeVariant="xs"
                            value={selectedPresetId}
                            onChange={(e) =>
                              setSelectedPresets((prev) => ({
                                ...prev,
                                [project.projectId]: e.target.value,
                              }))
                            }
                            wrapperClassName="min-w-0 flex-1"
                          >
                            {sortedGlobalPresets.map((preset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.id} — {preset.name}
                              </option>
                            ))}
                          </Select>

                          <Button
                            variant={isSynced ? "secondary" : "primary"}
                            size="xs"
                            disabled={Boolean(busy)}
                            onClick={() => void handleSyncProject(project)}
                            aria-label={`Sync ${project.title}`}
                          >
                            {isSynced ? (
                              <>
                                <Check
                                  className="size-3.5 text-emerald-400"
                                  aria-hidden="true"
                                />
                                Sincronizado!
                              </>
                            ) : busy === "sync" ? (
                              <>
                                <RefreshCw
                                  className="size-3 motion-safe:animate-spin"
                                  aria-hidden="true"
                                />
                                Sync…
                              </>
                            ) : (
                              "Sync"
                            )}
                          </Button>

                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => void handleOpenStudio(project.projectId, null)}
                            aria-label={`Editar ${project.title} no Studio`}
                            title="Editar no Preset Studio"
                          >
                            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </main>

      {/* Compact Native macOS Footer */}
      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-white/[0.08] bg-zinc-950/95 px-3.5 py-2 text-[10px] text-zinc-400">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-300">
            <Lock className="size-2.5 text-emerald-400" aria-hidden="true" />
            <span>SQLite Read-Only</span>
          </span>
          <span className="truncate font-mono text-zinc-500" title="~/.t3/userdata">
            ~/.t3
          </span>
        </div>

        <span className="shrink-0 text-zinc-500">
          <kbd className="rounded border border-white/10 bg-zinc-900 px-1 py-0.5 font-mono text-[9px] text-zinc-300">
            Esc
          </kbd>{" "}
          para fechar
        </span>
      </footer>
    </div>
  );
}
