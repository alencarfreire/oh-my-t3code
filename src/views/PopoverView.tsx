import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  Check,
  Cpu,
  FolderGit2,
  Layers,
  Lock,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Badge, getInstanceBadgeTone } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
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

const SWAP_PILL_CLASSES: Record<string, string> = {
  indigo:
    "border-indigo-400/35 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25 hover:border-indigo-400/55",
  sky: "border-sky-400/35 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25 hover:border-sky-400/55",
  emerald:
    "border-emerald-400/35 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 hover:border-emerald-400/55",
  amber:
    "border-amber-400/35 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 hover:border-amber-400/55",
  neutral:
    "border-white/15 bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700/80 hover:border-white/25",
};

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
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleOpenStudio = useCallback(async (projectId?: string | null) => {
    try {
      await invokeIpc("open_studio_window", {
        projectId: projectId ?? null,
        presetId: null,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Keyboard shortcuts: Escape closes popover, Cmd+K or '/' focuses search, Cmd+, opens Studio
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void invokeIpc("toggle_popover_window");
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
        void handleOpenStudio(null);
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
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3.5 py-3 space-y-2.5">
        {loading && !snapshot ? (
          <div className="space-y-3 py-8 text-center text-xs text-zinc-400">
            Carregando estado do T3 Code…
          </div>
        ) : snapshot ? (
          <section aria-labelledby="popover-projects-heading" className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 px-0.5">
              <h2
                id="popover-projects-heading"
                className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
              >
                Projetos & 1-Click Sync
              </h2>
              <span className="text-[11px] text-zinc-400 tabular-nums">
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
                  className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500"
                  aria-hidden="true"
                />
                <input
                  ref={searchInputRef}
                  id="popover-project-filter"
                  type="search"
                  value={projectQuery}
                  onChange={(e) => setProjectQuery(e.target.value)}
                  placeholder="Filtrar projetos, preset ou instância…"
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

            {snapshot.projects.length === 0 ? (
              <div className="surface-card rounded-xl px-3 py-4 text-center text-xs text-zinc-400">
                Nenhum projeto encontrado em statev2.sqlite.
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="surface-card rounded-xl px-3 py-4 text-center space-y-2">
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
              <ul className="space-y-2">
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
                  const instanceTone = getInstanceBadgeTone(project.activeInstanceId);

                  return (
                    <li
                      key={project.projectId}
                      className="surface-card-interactive rounded-xl p-2.5 space-y-2"
                    >
                      {/* Row 1: Project identity + Semantic Status + Integrated Instance Swap Pill */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <FolderGit2
                              className="size-3.5 shrink-0 text-indigo-300"
                              aria-hidden="true"
                            />
                            <span className="truncate text-xs font-semibold text-zinc-100">
                              {project.title}
                            </span>
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
                                Não configurado
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
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
                          </div>
                        </div>

                        {/* Integrated Active Instance Pill + Instant Swap (⇄) */}
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void handleSwapInstance(project)}
                          aria-label={`Alternar instância Agy em ${project.title}`}
                          title="Alternar Agy Veca ⇄ Agy Principal (1 clique)"
                          className={[
                            "inline-flex h-6 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium whitespace-nowrap",
                            "transition-[background-color,border-color,color,transform,opacity] duration-150 ease-out",
                            "enabled:active:scale-[0.96] disabled:opacity-50",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                            SWAP_PILL_CLASSES[instanceTone] ?? SWAP_PILL_CLASSES.neutral,
                          ].join(" ")}
                        >
                          <Cpu className="size-3 shrink-0" aria-hidden="true" />
                          <span>{activeInstanceLabel}</span>
                          <ArrowLeftRight
                            className={`size-3 shrink-0 opacity-85 ${
                              busy === "swap" ? "motion-safe:animate-pulse" : ""
                            }`}
                            aria-hidden="true"
                          />
                        </button>
                      </div>

                      {/* Row 2: Unified Action Bar (Preset Select + Sync + Open in Studio) */}
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
                          {snapshot.globalPresets.map((preset) => (
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
                              <Check className="size-3.5 text-emerald-400" aria-hidden="true" />
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
                          onClick={() => void handleOpenStudio(project.projectId)}
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
