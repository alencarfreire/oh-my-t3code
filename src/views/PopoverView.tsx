import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  Check,
  Cpu,
  FolderGit2,
  Layers,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Badge, getInstanceBadgeTone } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { invokeIpc } from "../lib/ipc-client";
import { resolveInstanceShortLabel } from "../lib/preset-utils";
import type { DashboardSnapshot, ProjectSummary } from "../types/ipc";

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
  return snapshot.globalPresets[0]?.id ?? "agy-dual";
}

export function PopoverView() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [selectedPresets, setSelectedPresets] = useState<Record<string, string>>({});
  const [busyProjectAction, setBusyProjectAction] = useState<Record<string, "sync" | "swap">>({});
  const [syncedProjectIds, setSyncedProjectIds] = useState<Record<string, boolean>>({});

  const loadSnapshot = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMsg(null);
    try {
      const data = await invokeIpc("get_dashboard_snapshot");
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

  // Escape closes/toggles the popover window on macOS Menu Bar
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void invokeIpc("toggle_popover_window");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const syncedProjectsCount = useMemo(() => {
    if (!snapshot) return 0;
    return snapshot.projects.filter((project) => project.hasLocalPreset).length;
  }, [snapshot]);

  const normalizedQuery = projectQuery.trim().toLowerCase();

  const filteredProjects = useMemo(() => {
    if (!snapshot) return [];
    if (!normalizedQuery) return snapshot.projects;
    return snapshot.projects.filter((project) => {
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
  }, [snapshot, normalizedQuery]);

  const handleOpenStudio = async (projectId?: string | null) => {
    try {
      await invokeIpc("open_studio_window", {
        projectId: projectId ?? null,
        presetId: null,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSyncProject = async (project: ProjectSummary) => {
    if (!snapshot) return;
    const presetId =
      selectedPresets[project.projectId] ?? defaultPresetForProject(project, snapshot);

    setBusyProjectAction((prev) => ({ ...prev, [project.projectId]: "sync" }));
    setErrorMsg(null);
    try {
      const result = await invokeIpc("apply_preset_sync", {
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
    if (!snapshot) return;
    setBusyProjectAction((prev) => ({ ...prev, [project.projectId]: "swap" }));
    setErrorMsg(null);
    try {
      const result = await invokeIpc("swap_project_instance", {
        projectId: project.projectId,
        workspaceRoot: project.workspaceRoot,
      });
      const label = resolveInstanceShortLabel(
        result.activeInstanceId,
        snapshot.providerInstances,
      );
      setStatusMessage(
        `Instância alternada em ${project.title}: ${label} (${result.activeModel}).`,
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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-zinc-950/95 text-zinc-100">
      {/* Compact macOS Menu Bar Header */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-zinc-950 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-amber-400/25 bg-zinc-900/90 p-0.5">
            <img
              src="/logo.png"
              alt="Oh My T3Code"
              className="size-full object-contain"
            />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xs font-semibold tracking-tight text-zinc-100">
              Oh My T3Code
            </h1>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Layers className="size-3 shrink-0 text-indigo-300" aria-hidden="true" />
              {snapshot ? (
                <span className="truncate tabular-nums">
                  {syncedProjectsCount}/{snapshot.projects.length} sincronizados ·{" "}
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
            onClick={() => void handleOpenStudio(null)}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            Preset Studio
          </Button>
        </div>
      </header>

      {/* Live polite status region rendered stably for screen readers & visual feedback */}
      <div
        role="status"
        aria-live="polite"
        className={
          statusMessage
            ? "shrink-0 border-b border-emerald-500/20 bg-emerald-500/10 px-3.5 py-1.5 text-[11px] text-emerald-200"
            : "sr-only"
        }
      >
        {statusMessage}
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

      {/* Main Scrollable Content (strictly no horizontal overflow) */}
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3.5 py-3 space-y-3">
        {loading && !snapshot ? (
          <div className="space-y-3 py-6 text-center text-xs text-zinc-400">
            Carregando estado do T3 Code...
          </div>
        ) : snapshot ? (
          <section aria-labelledby="popover-projects-heading" className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2
                id="popover-projects-heading"
                className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
              >
                Projetos & 1-Click Sync
              </h2>
              <span className="text-[11px] text-zinc-500 tabular-nums">
                {normalizedQuery
                  ? `${filteredProjects.length} de ${snapshot.projects.length}`
                  : `${snapshot.projects.length} projetos`}
              </span>
            </div>

            {snapshot.projects.length > 1 ? (
              <div className="relative">
                <label htmlFor="popover-project-filter" className="sr-only">
                  Filtrar projetos
                </label>
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500"
                  aria-hidden="true"
                />
                <input
                  id="popover-project-filter"
                  type="search"
                  value={projectQuery}
                  onChange={(e) => setProjectQuery(e.target.value)}
                  placeholder="Filtrar projetos, preset ou instância..."
                  className="w-full rounded-lg border border-white/10 bg-zinc-900/80 py-1.5 pl-8 pr-7 text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                />
                {projectQuery ? (
                  <button
                    type="button"
                    onClick={() => setProjectQuery("")}
                    aria-label="Limpar filtro de projetos"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : null}

            {snapshot.projects.length === 0 ? (
              <div className="rounded-xl border border-white/8 bg-zinc-900/50 px-3 py-3 text-center text-xs text-zinc-400">
                Nenhum projeto encontrado em statev2.sqlite.
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="rounded-xl border border-white/8 bg-zinc-900/50 px-3 py-4 text-center space-y-2">
                <p className="text-xs text-zinc-400">
                  Nenhum projeto corresponde a &ldquo;{projectQuery.trim()}&rdquo;.
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
              <ul className="space-y-2.5">
                {filteredProjects.map((project) => {
                    const selectedPresetId =
                      selectedPresets[project.projectId] ??
                      defaultPresetForProject(project, snapshot);
                    const busy = busyProjectAction[project.projectId];
                    const isSynced = Boolean(syncedProjectIds[project.projectId]);
                    const activeInstanceLabel = resolveInstanceShortLabel(
                      project.activeInstanceId,
                      snapshot.providerInstances,
                    );

                    return (
                      <li
                        key={project.projectId}
                        className="rounded-xl border border-white/10 bg-zinc-900/80 p-2.5 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <FolderGit2
                                className="size-3.5 shrink-0 text-indigo-300"
                                aria-hidden="true"
                              />
                              <span className="truncate text-xs font-semibold text-zinc-100">
                                {project.title}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {project.detectedSquadSlug ? (
                                <Badge tone="indigo">
                                  .{project.detectedSquadSlug}
                                </Badge>
                              ) : null}
                              {project.hasLocalPreset ? (
                                <Badge tone="emerald">.t3code/preset</Badge>
                              ) : null}
                              <Badge tone={getInstanceBadgeTone(project.activeInstanceId)}>
                                <Cpu className="size-2.5" aria-hidden="true" />
                                {activeInstanceLabel}
                              </Badge>
                              {project.activeModel ? (
                                <span className="truncate font-mono text-[10px] text-zinc-400">
                                  {project.activeModel}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => void handleOpenStudio(project.projectId)}
                            aria-label={`Editar ${project.title} no Studio`}
                            title="Editar no Preset Studio"
                          >
                            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                          </Button>
                        </div>

                        {/* 1-Click Preset Dropdown + Sync + Swap Instance */}
                        <div className="flex items-center gap-1.5">
                          <label
                            htmlFor={`preset-select-${project.projectId}`}
                            className="sr-only"
                          >
                            Preset para {project.title}
                          </label>
                          <select
                            id={`preset-select-${project.projectId}`}
                            value={selectedPresetId}
                            onChange={(e) =>
                              setSelectedPresets((prev) => ({
                                ...prev,
                                [project.projectId]: e.target.value,
                              }))
                            }
                            className="min-w-0 flex-1 rounded-lg border border-white/12 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                          >
                            {snapshot.globalPresets.map((preset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.id} — {preset.name}
                              </option>
                            ))}
                          </select>

                          <Button
                            variant={isSynced ? "secondary" : "primary"}
                            size="xs"
                            disabled={Boolean(busy)}
                            onClick={() => void handleSyncProject(project)}
                            aria-label={`Sync ${project.title}`}
                          >
                            {isSynced ? (
                              <>
                                <Check className="size-3.5 text-emerald-400" aria-hidden="true" />
                                Sincronizado!
                              </>
                            ) : busy === "sync" ? (
                              "Sincronizando..."
                            ) : (
                              "Sync"
                            )}
                          </Button>

                          <Button
                            variant="secondary"
                            size="xs"
                            disabled={Boolean(busy)}
                            onClick={() => void handleSwapInstance(project)}
                            aria-label={`Alternar instância Agy em ${project.title}`}
                            title="Alternar Agy Veca ⇄ Agy Principal (1 clique)"
                          >
                            <ArrowLeftRight className="size-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
