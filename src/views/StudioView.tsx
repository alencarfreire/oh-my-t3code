import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileDiff,
  Layers,
  Save,
  ShieldAlert,
  Sliders,
  UploadCloud,
  Users,
  Wrench,
} from "lucide-react";
import { ContentionTab } from "../components/studio/ContentionTab";
import { OverviewFallbackTab } from "../components/studio/OverviewFallbackTab";
import { PreviewDiffTab } from "../components/studio/PreviewDiffTab";
import { RolesMatrixTab } from "../components/studio/RolesMatrixTab";
import { SkillsMcpsTab } from "../components/studio/SkillsMcpsTab";
import {
  StudioSidebar,
  type StudioSelection,
} from "../components/studio/StudioSidebar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { invokeIpc, listenStudioNavigate } from "../lib/ipc-client";
import { clonePreset, createEmptyPreset } from "../lib/preset-utils";
import type {
  CompilePreviewResult,
  DashboardSnapshot,
  PresetConfig,
  ProjectSummary,
  ResolvedProjectPreset,
} from "../types/ipc";

type StudioTabId = "overview" | "roles" | "skills" | "contention" | "preview";

const STUDIO_TABS: ReadonlyArray<{
  id: StudioTabId;
  label: string;
  icon: typeof Sliders;
}> = [
  { id: "overview", label: "Visão Geral & Fallback", icon: Sliders },
  { id: "roles", label: "Matriz de Papéis", icon: Users },
  { id: "skills", label: "Skills & MCPs", icon: Wrench },
  { id: "contention", label: "Pontos de Contenção", icon: ShieldAlert },
  { id: "preview", label: "Preview & Diff", icon: FileDiff },
];

interface StudioViewProps {
  initialProjectId?: string | null;
  initialPresetId?: string | null;
}

export function StudioView({
  initialProjectId = null,
  initialPresetId = null,
}: StudioViewProps) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<StudioSelection | null>(null);
  const [activeTab, setActiveTab] = useState<StudioTabId>("overview");
  const [draftPreset, setDraftPreset] = useState<PresetConfig | null>(null);
  const [projectMeta, setProjectMeta] = useState<ResolvedProjectPreset | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [previewTargetProjectId, setPreviewTargetProjectId] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<CompilePreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [importingProjectId, setImportingProjectId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const tabRefs = useRef<Record<StudioTabId, HTMLButtonElement | null>>({
    overview: null,
    roles: null,
    skills: null,
    contention: null,
    preview: null,
  });

  const snapshotRef = useRef<DashboardSnapshot | null>(null);
  snapshotRef.current = snapshot;

  const selectGlobalPreset = useCallback(
    (presetId: string, sourceSnapshot?: DashboardSnapshot | null) => {
      const snap = sourceSnapshot ?? snapshotRef.current;
      if (!snap) return;
      const found = snap.globalPresets.find((p) => p.id === presetId);
      if (!found) return;
      setSelection({ kind: "global", presetId: found.id });
      setProjectMeta(null);
      setDraftPreset(clonePreset(found));
      const firstRole = Object.keys(found.roles).sort()[0] ?? null;
      setSelectedRoleId(firstRole);
      setDirty(false);
      setPreviewResult(null);
      setPreviewTargetProjectId(snap.projects[0]?.projectId ?? null);
    },
    [],
  );

  const selectProject = useCallback(async (project: ProjectSummary) => {
    setErrorMsg(null);
    setSelection({ kind: "project", projectId: project.projectId });
    setPreviewTargetProjectId(project.projectId);
    setPreviewResult(null);
    try {
      const resolved = await invokeIpc("get_project_preset", {
        projectId: project.projectId,
        workspaceRoot: project.workspaceRoot,
      });
      setProjectMeta(resolved);
      setDraftPreset(clonePreset(resolved.resolvedPreset));
      const firstRole =
        Object.keys(resolved.resolvedPreset.roles).sort()[0] ?? null;
      setSelectedRoleId(firstRole);
      setDirty(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await invokeIpc("get_dashboard_snapshot");
      snapshotRef.current = data;
      setSnapshot(data);

      if (initialProjectId) {
        const proj = data.projects.find((p) => p.projectId === initialProjectId);
        if (proj) {
          await selectProject(proj);
          return;
        }
      }

      if (initialPresetId) {
        const preset = data.globalPresets.find((p) => p.id === initialPresetId);
        if (preset) {
          selectGlobalPreset(preset.id, data);
          return;
        }
      }

      if (data.globalPresets.length > 0) {
        selectGlobalPreset(data.globalPresets[0].id, data);
      } else if (data.projects.length > 0) {
        await selectProject(data.projects[0]);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [initialPresetId, initialProjectId, selectGlobalPreset, selectProject]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // Listen for `studio://navigate` events emitted from Rust when Popover opens Studio for a project
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenStudioNavigate((payload) => {
      const snap = snapshotRef.current;
      if (!snap) return;
      if (payload.projectId) {
        const proj = snap.projects.find((p) => p.projectId === payload.projectId);
        if (proj) {
          void selectProject(proj);
        }
      } else if (payload.presetId) {
        selectGlobalPreset(payload.presetId);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [selectGlobalPreset, selectProject]);

  const activePreviewProject = useMemo(() => {
    if (!snapshot || !previewTargetProjectId) return null;
    return (
      snapshot.projects.find((p) => p.projectId === previewTargetProjectId) ?? null
    );
  }, [previewTargetProjectId, snapshot]);

  const runPreview = useCallback(
    async (targetProject: ProjectSummary | null, preset: PresetConfig | null) => {
      if (!targetProject || !preset) {
        setPreviewResult(null);
        return;
      }
      setPreviewLoading(true);
      setErrorMsg(null);
      try {
        const result = await invokeIpc("preview_preset_sync", {
          projectId: targetProject.projectId,
          workspaceRoot: targetProject.workspaceRoot,
          preset,
        });
        setPreviewResult(result);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setPreviewLoading(false);
      }
    },
    [],
  );

  // Refresh diff automatically whenever switching to Preview & Diff tab
  useEffect(() => {
    if (activeTab === "preview" && draftPreset && activePreviewProject) {
      void runPreview(activePreviewProject, draftPreset);
    }
  }, [activePreviewProject, activeTab, draftPreset, runPreview]);

  const handleDraftChange = (next: PresetConfig) => {
    setDraftPreset(next);
    setDirty(true);
  };

  const handleCreateGlobalPreset = (id: string, extendsId: string | null) => {
    const base = extendsId
      ? snapshot?.globalPresets.find((p) => p.id === extendsId)
      : null;
    const created = base
      ? {
          ...clonePreset(base),
          id,
          name: id,
          extends: extendsId,
          description: `Preset derivado de ${extendsId}.`,
        }
      : createEmptyPreset(id, extendsId);

    setSelection({ kind: "global", presetId: id });
    setProjectMeta(null);
    setDraftPreset(created);
    setSelectedRoleId(Object.keys(created.roles).sort()[0] ?? null);
    setDirty(true);
    setActiveTab("overview");
    setStatusMessage(`Novo preset global '${id}' criado em rascunho. Salve para gravar.`);
  };

  const handleSaveGlobalPreset = async () => {
    if (!draftPreset) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const saved = await invokeIpc("save_global_preset", { preset: draftPreset });
      const refreshed = await invokeIpc("get_dashboard_snapshot");
      setSnapshot(refreshed);
      setDraftPreset(clonePreset(saved));
      setDirty(false);
      setStatusMessage(`Preset global '${saved.id}' salvo com sucesso.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProjectOverride = async () => {
    if (!draftPreset || !projectMeta) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const saved = await invokeIpc("save_project_preset", {
        projectId: projectMeta.projectId,
        workspaceRoot: projectMeta.workspaceRoot,
        preset: draftPreset,
      });
      setProjectMeta(saved);
      setDraftPreset(clonePreset(saved.resolvedPreset));
      const refreshed = await invokeIpc("get_dashboard_snapshot");
      setSnapshot(refreshed);
      setDirty(false);
      setStatusMessage(
        `Override local salvo em ${saved.localPresetPath}.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleApplyProjectSync = async () => {
    if (!draftPreset || !activePreviewProject) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      if (selection?.kind === "project" && projectMeta) {
        await invokeIpc("save_project_preset", {
          projectId: projectMeta.projectId,
          workspaceRoot: projectMeta.workspaceRoot,
          preset: draftPreset,
        });
      }
      const res = await invokeIpc("apply_preset_sync", {
        projectId: activePreviewProject.projectId,
        workspaceRoot: activePreviewProject.workspaceRoot,
        presetIdOrCustom: draftPreset.id,
        customPreset: draftPreset,
      });
      const refreshed = await invokeIpc("get_dashboard_snapshot");
      setSnapshot(refreshed);
      setDirty(false);
      setStatusMessage(
        `Sincronizado! ${res.writtenFiles.length} arquivos gravados e settings.json atualizado (${res.activeInstanceId} · ${res.activeModel}).`,
      );
      await runPreview(activePreviewProject, draftPreset);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleImportSquad = async (project: ProjectSummary) => {
    setImportingProjectId(project.projectId);
    setErrorMsg(null);
    try {
      const imported = await invokeIpc("import_project_squad", {
        projectId: project.projectId,
        workspaceRoot: project.workspaceRoot,
      });
      const refreshed = await invokeIpc("get_dashboard_snapshot");
      setSnapshot(refreshed);
      setSelection({ kind: "project", projectId: project.projectId });
      setProjectMeta(imported);
      setDraftPreset(clonePreset(imported.resolvedPreset));
      setPreviewTargetProjectId(project.projectId);
      setSelectedRoleId(
        Object.keys(imported.resolvedPreset.roles).sort()[0] ?? null,
      );
      setDirty(false);
      setStatusMessage(
        `Squad importada de ${project.title} para ${imported.localPresetPath}.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingProjectId(null);
    }
  };

  const handleTabKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number,
  ) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const nextTab =
      STUDIO_TABS[(idx + delta + STUDIO_TABS.length) % STUDIO_TABS.length];
    setActiveTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  if (loading && !snapshot) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 text-xs text-zinc-400">
        Carregando Preset Studio...
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-zinc-950 text-zinc-100">
      <StudioSidebar
        globalPresets={snapshot?.globalPresets ?? []}
        projects={snapshot?.projects ?? []}
        selection={selection}
        onSelectGlobal={(id) => selectGlobalPreset(id)}
        onSelectProject={(proj) => void selectProject(proj)}
        onCreateGlobalPreset={handleCreateGlobalPreset}
        onImportProjectSquad={(proj) => void handleImportSquad(proj)}
        importingProjectId={importingProjectId}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Editor Header */}
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-zinc-950/90 px-6 py-3.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-base font-semibold tracking-tight text-zinc-100">
                {selection?.kind === "project" && projectMeta
                  ? projectMeta.projectSlug
                  : (draftPreset?.name ?? "Preset Studio")}
              </h1>

              {selection?.kind === "project" ? (
                <Badge tone="emerald">Projeto · Override Local</Badge>
              ) : (
                <Badge tone="indigo">
                  <Layers className="size-3" aria-hidden="true" />
                  Preset Global
                </Badge>
              )}

              {dirty ? <Badge tone="amber">Alterações não salvas</Badge> : null}
            </div>

            <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">
              {selection?.kind === "project" && projectMeta
                ? projectMeta.localPresetPath
                : `~/.config/oh-my-t3code/presets/${draftPreset?.id ?? "preset"}.jsonc`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selection?.kind === "global" ? (
              <Button
                variant="primary"
                size="sm"
                disabled={!draftPreset || saving}
                onClick={() => void handleSaveGlobalPreset()}
              >
                <Save className="size-3.5" aria-hidden="true" />
                Salvar Preset Global
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!draftPreset || saving}
                  onClick={() => void handleSaveProjectOverride()}
                >
                  <Save className="size-3.5" aria-hidden="true" />
                  Salvar Override
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!draftPreset || saving}
                  onClick={() => setActiveTab("preview")}
                >
                  <UploadCloud className="size-3.5" aria-hidden="true" />
                  Revisar Diff & Sincronizar
                </Button>
              </>
            )}
          </div>
        </header>

        {/* Polite status region */}
        <div
          role="status"
          aria-live="polite"
          className={
            statusMessage
              ? "flex shrink-0 items-center gap-2 border-b border-emerald-500/20 bg-emerald-500/10 px-6 py-2 text-xs text-emerald-200"
              : "sr-only"
          }
        >
          {statusMessage ? (
            <>
              <CheckCircle2
                className="size-3.5 shrink-0 text-emerald-400"
                aria-hidden="true"
              />
              <span>{statusMessage}</span>
            </>
          ) : null}
        </div>

        {errorMsg ? (
          <div
            role="alert"
            className="flex shrink-0 items-center gap-2 border-b border-rose-500/25 bg-rose-500/10 px-6 py-2 text-xs text-rose-200"
          >
            <AlertCircle className="size-4 shrink-0 text-rose-400" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        ) : null}

        {/* Accessible Tablist */}
        <nav
          aria-label="Seções do Editor"
          className="shrink-0 border-b border-white/10 bg-zinc-950/60 px-6"
        >
          <div role="tablist" className="flex items-center gap-1 overflow-x-auto">
            {STUDIO_TABS.map((tab, idx) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[tab.id] = el;
                  }}
                  role="tab"
                  id={`studio-tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls={`studio-panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, idx)}
                  className={[
                    "relative inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium whitespace-nowrap",
                    "transition-[color,border-color] duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400",
                    selected
                      ? "border-indigo-400 text-zinc-100"
                      : "border-transparent text-zinc-400 hover:text-zinc-200",
                  ].join(" ")}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Tab Panel Content */}
        <main
          role="tabpanel"
          id={`studio-panel-${activeTab}`}
          aria-labelledby={`studio-tab-${activeTab}`}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6"
        >
          {draftPreset && snapshot ? (
            <>
              {activeTab === "overview" ? (
                <OverviewFallbackTab
                  preset={draftPreset}
                  globalPresets={snapshot.globalPresets}
                  providerInstances={snapshot.providerInstances}
                  onChange={handleDraftChange}
                />
              ) : null}

              {activeTab === "roles" ? (
                <RolesMatrixTab
                  preset={draftPreset}
                  selectedRoleId={selectedRoleId}
                  providerInstances={snapshot.providerInstances}
                  onSelectRole={setSelectedRoleId}
                  onChange={handleDraftChange}
                />
              ) : null}

              {activeTab === "skills" ? (
                <SkillsMcpsTab
                  preset={draftPreset}
                  selectedRoleId={selectedRoleId}
                  availableSkills={snapshot.skills}
                  onSelectRole={setSelectedRoleId}
                  onChange={handleDraftChange}
                />
              ) : null}

              {activeTab === "contention" ? (
                <ContentionTab
                  preset={draftPreset}
                  onChange={handleDraftChange}
                />
              ) : null}

              {activeTab === "preview" ? (
                <PreviewDiffTab
                  preview={previewResult}
                  loading={previewLoading}
                  isProjectMode={selection?.kind === "project"}
                  projects={snapshot.projects}
                  previewTargetProjectId={previewTargetProjectId}
                  onChangePreviewTargetProject={setPreviewTargetProjectId}
                  onRefreshPreview={() =>
                    void runPreview(activePreviewProject, draftPreset)
                  }
                  onApplyProjectSync={() => void handleApplyProjectSync()}
                  onSaveGlobalPreset={() => void handleSaveGlobalPreset()}
                  saving={saving}
                />
              ) : null}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/12 p-8 text-center text-xs text-zinc-400">
              Selecione um preset global ou projeto na barra lateral para iniciar a edição.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
