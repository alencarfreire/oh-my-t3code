import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  FileDiff,
  GitBranch,
  Globe,
  Layers,
  Network,
  RotateCcw,
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
import { Badge, getInstanceBadgeTone } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { StatusToggle } from "../components/ui/StatusToggle";
import {
  invokeIpc,
  listenStudioNavigate,
  type StudioNavigatePayload,
} from "../lib/ipc-client";
import {
  clonePreset,
  createEmptyPreset,
  formatPrimaryOptionSummary,
  resolveInstanceShortLabel,
} from "../lib/preset-utils";
import {
  IPC_COMMANDS,
  type CompilePreviewResult,
  type DashboardSnapshot,
  type PresetConfig,
  type ProjectSummary,
  type ResolvedProjectPreset,
  type SyncResult,
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

type PendingSwitchAction =
  | { kind: "global"; presetId: string }
  | { kind: "project"; project: ProjectSummary }
  | { kind: "create-global"; id: string; extendsId: string | null }
  | { kind: "configure-override"; project: ProjectSummary; presetId: string }
  | { kind: "import-squad"; project: ProjectSummary }
  | {
      kind: "navigate";
      payload: StudioNavigatePayload;
      snapshot: DashboardSnapshot;
    };

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
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitchAction | null>(null);
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
  const selectionRef = useRef<StudioSelection | null>(null);
  selectionRef.current = selection;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const savingRef = useRef(false);
  savingRef.current = saving;

  const selectionSeqRef = useRef(0);
  const previewSeqRef = useRef(0);
  const pendingNavigateRef = useRef<StudioNavigatePayload | null>(null);
  const deferredNavigateDuringSaveRef = useRef<StudioNavigatePayload | null>(null);
  const navigateSeqRef = useRef(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const updateSelection = useCallback((next: StudioSelection | null) => {
    selectionRef.current = next;
    setSelection(next);
  }, []);

  const updateDirty = useCallback((next: boolean) => {
    dirtyRef.current = next;
    setDirty(next);
  }, []);

  const updateSaving = useCallback((next: boolean) => {
    savingRef.current = next;
    setSaving(next);
  }, []);

  const openDirtyDialog = useCallback((action: PendingSwitchAction) => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingSwitch(action);
  }, []);

  const cancelPendingSwitch = useCallback(() => {
    setPendingSwitch(null);
    const prev = previousFocusRef.current;
    previousFocusRef.current = null;
    if (prev && prev.isConnected) {
      prev.focus();
    }
  }, []);

  useEffect(() => {
    if (!pendingSwitch) return;
    const cancelBtn = dialogRef.current?.querySelector<HTMLButtonElement>(
      '[data-dialog-cancel="true"]',
    );
    cancelBtn?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelPendingSwitch();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [cancelPendingSwitch, pendingSwitch]);

  const selectGlobalPreset = useCallback(
    (presetId: string, sourceSnapshot?: DashboardSnapshot | null) => {
      const snap = sourceSnapshot ?? snapshotRef.current;
      if (!snap) return;
      const found = snap.globalPresets.find((p) => p.id === presetId);
      if (!found) return;
      selectionSeqRef.current += 1;
      previewSeqRef.current += 1;
      setPreviewLoading(false);
      const nextDraft = clonePreset(found);
      if (found.id === snap.globalConfig.activeGlobalPresetId) {
        nextDraft.enabled = snap.globalConfig.enabled;
      }
      updateSelection({ kind: "global", presetId: found.id });
      setProjectMeta(null);
      setDraftPreset(nextDraft);
      const firstRole = Object.keys(found.roles).sort()[0] ?? null;
      setSelectedRoleId(firstRole);
      updateDirty(false);
      setPreviewResult(null);
      setPreviewTargetProjectId(snap.projects[0]?.projectId ?? null);
    },
    [updateDirty, updateSelection],
  );

  const selectProject = useCallback(
    async (project: ProjectSummary) => {
      const seq = ++selectionSeqRef.current;
      previewSeqRef.current += 1;
      setPreviewLoading(false);
      setErrorMsg(null);
      updateSelection({ kind: "project", projectId: project.projectId });
      setPreviewTargetProjectId(project.projectId);
      setPreviewResult(null);
      try {
        const resolved = await invokeIpc("get_project_preset", {
          projectId: project.projectId,
          workspaceRoot: project.workspaceRoot,
        });
        if (seq !== selectionSeqRef.current) return;
        setProjectMeta(resolved);
        setDraftPreset(clonePreset(resolved.resolvedPreset));
        const firstRole =
          Object.keys(resolved.resolvedPreset.roles).sort()[0] ?? null;
        setSelectedRoleId(firstRole);
        updateDirty(false);
      } catch (err) {
        if (seq !== selectionSeqRef.current) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    },
    [updateDirty, updateSelection],
  );

  const applyNavigationPayload = useCallback(
    async (payload: StudioNavigatePayload, snap: DashboardSnapshot) => {
      if (payload.projectId) {
        const proj = snap.projects.find((p) => p.projectId === payload.projectId);
        if (proj) {
          await selectProject(proj);
          return true;
        }
      }
      if (payload.presetId) {
        const preset = snap.globalPresets.find((p) => p.id === payload.presetId);
        if (preset) {
          selectGlobalPreset(preset.id, snap);
          return true;
        }
      }
      return false;
    },
    [selectGlobalPreset, selectProject],
  );

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await invokeIpc("get_dashboard_snapshot");
      snapshotRef.current = data;
      setSnapshot(data);

      const pendingNav = pendingNavigateRef.current;
      pendingNavigateRef.current = null;
      if (pendingNav) {
        const applied = await applyNavigationPayload(pendingNav, data);
        if (applied) {
          return;
        }
      }

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
        const activeGlobal =
          data.globalPresets.find(
            (p) => p.id === data.globalConfig.activeGlobalPresetId,
          ) ?? data.globalPresets[0];
        selectGlobalPreset(activeGlobal.id, data);
      } else if (data.projects.length > 0) {
        await selectProject(data.projects[0]);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [
    applyNavigationPayload,
    initialPresetId,
    initialProjectId,
    selectGlobalPreset,
    selectProject,
  ]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const handleNavigationEvent = useCallback(
    async (payload: StudioNavigatePayload, isCancelled: () => boolean) => {
      if (!snapshotRef.current) {
        pendingNavigateRef.current = payload;
        return;
      }
      if (savingRef.current) {
        deferredNavigateDuringSaveRef.current = payload;
        return;
      }
      const navSeq = ++navigateSeqRef.current;
      try {
        const freshSnap = await invokeIpc("get_dashboard_snapshot");
        if (isCancelled() || navSeq !== navigateSeqRef.current) return;
        if (savingRef.current) {
          deferredNavigateDuringSaveRef.current = payload;
          return;
        }
        snapshotRef.current = freshSnap;
        setSnapshot(freshSnap);

        const hasTarget = Boolean(
          (payload.projectId &&
            freshSnap.projects.some((p) => p.projectId === payload.projectId)) ||
            (payload.presetId &&
              freshSnap.globalPresets.some((p) => p.id === payload.presetId)),
        );
        if (!hasTarget) return;

        if (dirtyRef.current) {
          openDirtyDialog({
            kind: "navigate",
            payload,
            snapshot: freshSnap,
          });
          return;
        }
        await applyNavigationPayload(payload, freshSnap);
      } catch (err) {
        if (isCancelled() || navSeq !== navigateSeqRef.current) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    },
    [applyNavigationPayload, openDirtyDialog],
  );

  // Listen for `studio://navigate` events emitted from Rust when Popover opens Studio for a project
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listenStudioNavigate((payload) => {
      if (cancelled) return;
      return handleNavigationEvent(payload, () => cancelled);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [handleNavigationEvent]);

  // Drain deferred `studio://navigate` received while saving was in flight
  useEffect(() => {
    if (saving) return;
    const deferred = deferredNavigateDuringSaveRef.current;
    if (!deferred) return;
    deferredNavigateDuringSaveRef.current = null;
    void handleNavigationEvent(deferred, () => false);
  }, [handleNavigationEvent, saving]);

  const activePreviewProject = useMemo(() => {
    if (!snapshot || !previewTargetProjectId) return null;
    return (
      snapshot.projects.find((p) => p.projectId === previewTargetProjectId) ?? null
    );
  }, [previewTargetProjectId, snapshot]);

  const runPreview = useCallback(
    async (
      targetProject: ProjectSummary | null,
      preset: PresetConfig | null,
      options?: { clearError?: boolean },
    ) => {
      if (!targetProject || !preset) {
        previewSeqRef.current += 1;
        setPreviewResult(null);
        setPreviewLoading(false);
        return;
      }
      const seq = ++previewSeqRef.current;
      setPreviewLoading(true);
      if (options?.clearError ?? true) {
        setErrorMsg(null);
      }
      try {
        const result = await invokeIpc("preview_preset_sync", {
          projectId: targetProject.projectId,
          workspaceRoot: targetProject.workspaceRoot,
          preset,
        });
        if (seq !== previewSeqRef.current) return;
        setPreviewResult(result);
      } catch (err) {
        if (seq !== previewSeqRef.current) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        if (seq === previewSeqRef.current) {
          setPreviewLoading(false);
        }
      }
    },
    [],
  );

  // Refresh diff automatically whenever switching to Preview & Diff tab
  useEffect(() => {
    if (activeTab === "preview" && draftPreset && activePreviewProject) {
      void runPreview(activePreviewProject, draftPreset, { clearError: false });
    }
  }, [activePreviewProject, activeTab, draftPreset, runPreview]);

  const handleDraftChange = (next: PresetConfig) => {
    setDraftPreset(next);
    updateDirty(true);
  };

  const executeCreateGlobalPreset = (id: string, extendsId: string | null) => {
    selectionSeqRef.current += 1;
    previewSeqRef.current += 1;
    setPreviewLoading(false);
    setPreviewResult(null);
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

    updateSelection({ kind: "global", presetId: id });
    setProjectMeta(null);
    setDraftPreset(created);
    setSelectedRoleId(Object.keys(created.roles).sort()[0] ?? null);
    updateDirty(true);
    setActiveTab("overview");
    setStatusMessage(`Novo preset global '${id}' criado em rascunho. Salve para gravar.`);
  };

  const handleSaveGlobalPreset = async () => {
    if (!draftPreset || savingRef.current) return;
    updateSaving(true);
    setErrorMsg(null);
    try {
      const saved = await invokeIpc("save_global_preset", { preset: draftPreset });
      const refreshed = await invokeIpc("get_dashboard_snapshot");
      const isSyncedGlobal =
        saved.id === refreshed.globalConfig.activeGlobalPresetId &&
        refreshed.globalConfig.enabled;
      const nextDraft = clonePreset(saved);
      if (saved.id === refreshed.globalConfig.activeGlobalPresetId) {
        nextDraft.enabled = refreshed.globalConfig.enabled;
      }
      snapshotRef.current = refreshed;
      setSnapshot(refreshed);
      setDraftPreset(nextDraft);
      updateDirty(false);
      setStatusMessage(
        isSyncedGlobal
          ? `Preset global '${saved.id}' salvo e sincronizado com settings.json.`
          : `Preset global '${saved.id}' salvo com sucesso.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      updateSaving(false);
    }
  };

  const handleToggleGlobalPresetStatus = async () => {
    if (!draftPreset || !snapshot || savingRef.current) return;
    const isActiveGlobalDefault =
      snapshot.globalConfig.activeGlobalPresetId === draftPreset.id;
    if (isActiveGlobalDefault) {
      const nextEnabled = !snapshot.globalConfig.enabled;
      updateSaving(true);
      setErrorMsg(null);
      try {
        const updatedConfigSnap = await invokeIpc(
          IPC_COMMANDS.setGlobalPresetConfig,
          {
            activePresetId: draftPreset.id,
            enabled: nextEnabled,
          },
        );
        snapshotRef.current = updatedConfigSnap;
        setSnapshot(updatedConfigSnap);
        const updatedDraft = { ...clonePreset(draftPreset), enabled: nextEnabled };
        setDraftPreset(updatedDraft);

        if (!dirtyRef.current) {
          const saved = await invokeIpc(IPC_COMMANDS.saveGlobalPreset, {
            preset: updatedDraft,
          });
          const refreshed = await invokeIpc(IPC_COMMANDS.getDashboardSnapshot);
          const nextDraft = clonePreset(saved);
          nextDraft.enabled = refreshed.globalConfig.enabled;
          snapshotRef.current = refreshed;
          setSnapshot(refreshed);
          setDraftPreset(nextDraft);
        }

        setStatusMessage(
          nextEnabled
            ? `Preset Global '${draftPreset.id}' ativado e sincronizado.`
            : `Preset Global '${draftPreset.id}' desativado.`,
        );
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        updateSaving(false);
      }
      return;
    }

    handleDraftChange({ ...draftPreset, enabled: !draftPreset.enabled });
  };

  const handleSetAsGlobalDefault = async () => {
    if (!draftPreset || savingRef.current) return;
    updateSaving(true);
    setErrorMsg(null);
    try {
      const presetToActivate = { ...draftPreset, enabled: true };
      const saved = await invokeIpc(IPC_COMMANDS.saveGlobalPreset, {
        preset: presetToActivate,
      });
      setDraftPreset(clonePreset(saved));
      updateDirty(false);

      try {
        const updated = await invokeIpc(IPC_COMMANDS.setGlobalPresetConfig, {
          activePresetId: saved.id,
          enabled: true,
        });
        snapshotRef.current = updated;
        setSnapshot(updated);
        setStatusMessage(
          `Preset '${saved.id}' definido como Global Default (Ativo) e sincronizado no T3 Code.`,
        );
      } catch (err) {
        try {
          const refreshed = await invokeIpc(IPC_COMMANDS.getDashboardSnapshot);
          snapshotRef.current = refreshed;
          setSnapshot(refreshed);
        } catch {
          // Keep current snapshot if refresh fails
        }
        const detail = err instanceof Error ? err.message : String(err);
        setErrorMsg(
          `Preset '${saved.id}' salvo no disco, mas a ativação como Global Default falhou: ${detail}. Tente definir como Global Default novamente.`,
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      updateSaving(false);
    }
  };

  const handleSaveProjectOverride = async () => {
    if (!draftPreset || !projectMeta || savingRef.current) return;
    updateSaving(true);
    setErrorMsg(null);
    try {
      const saved = await invokeIpc("save_project_preset", {
        projectId: projectMeta.projectId,
        workspaceRoot: projectMeta.workspaceRoot,
        preset: draftPreset,
      });
      setProjectMeta(saved);
      setDraftPreset(clonePreset(saved.resolvedPreset));
      updateDirty(false);

      let nextStatusMessage = `Override local salvo em ${saved.localPresetPath} (pausado).`;
      if (draftPreset.enabled !== false) {
        try {
          const res = await invokeIpc("apply_preset_sync", {
            projectId: projectMeta.projectId,
            workspaceRoot: projectMeta.workspaceRoot,
            presetIdOrCustom: draftPreset.id,
            customPreset: draftPreset,
          });
          nextStatusMessage = `Override salvo e squad compilada (${res.writtenFiles.length} arquivos em .agents/skills + settings.json sincronizado).`;
        } catch (err) {
          try {
            const refreshed = await invokeIpc("get_dashboard_snapshot");
            snapshotRef.current = refreshed;
            setSnapshot(refreshed);
          } catch {
            // Keep current snapshot if refresh fails
          }
          const detail = err instanceof Error ? err.message : String(err);
          setErrorMsg(
            `Preset salvo no disco (${saved.localPresetPath}), mas a sincronização falhou: ${detail}. Tente sincronizar novamente.`,
          );
          return;
        }
      }

      try {
        const refreshed = await invokeIpc("get_dashboard_snapshot");
        snapshotRef.current = refreshed;
        setSnapshot(refreshed);
      } catch {
        // Keep current snapshot if refresh fails
      }
      setStatusMessage(nextStatusMessage);
      if (activeTab === "preview" && activePreviewProject) {
        await runPreview(activePreviewProject, saved.resolvedPreset);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      updateSaving(false);
    }
  };

  const handleToggleProjectEnabled = async () => {
    if (!draftPreset || !projectMeta || !snapshot || savingRef.current) return;
    const activeProject = snapshot.projects.find(
      (p) => p.projectId === projectMeta.projectId,
    );
    const currentEnabled = activeProject?.presetEnabled ?? draftPreset.enabled;
    const nextEnabled = !currentEnabled;

    updateSaving(true);
    setErrorMsg(null);
    try {
      await invokeIpc(IPC_COMMANDS.setProjectPresetEnabled, {
        projectId: projectMeta.projectId,
        workspaceRoot: projectMeta.workspaceRoot,
        enabled: nextEnabled,
      });
      const refreshed = await invokeIpc(IPC_COMMANDS.getDashboardSnapshot);
      snapshotRef.current = refreshed;
      setSnapshot(refreshed);
      setDraftPreset({ ...draftPreset, enabled: nextEnabled });
      setStatusMessage(
        nextEnabled
          ? `Override de ${projectMeta.projectSlug} ativado e sincronizado.`
          : `Override de ${projectMeta.projectSlug} desativado — seguindo Global Default.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      updateSaving(false);
    }
  };

  const handleRemoveProjectOverride = async () => {
    if (!projectMeta || savingRef.current) return;
    updateSaving(true);
    setErrorMsg(null);
    try {
      const refreshed = await invokeIpc(IPC_COMMANDS.removeProjectOverride, {
        projectId: projectMeta.projectId,
        workspaceRoot: projectMeta.workspaceRoot,
      });
      snapshotRef.current = refreshed;
      setSnapshot(refreshed);
      selectGlobalPreset(refreshed.globalConfig.activeGlobalPresetId, refreshed);
      setStatusMessage(
        `Override de ${projectMeta.projectSlug} removido — projeto voltou ao Global Default.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      updateSaving(false);
    }
  };

  const executeConfigureProjectOverride = async (
    project: ProjectSummary,
    presetId: string,
  ) => {
    if (savingRef.current) return;
    updateSaving(true);
    setErrorMsg(null);
    try {
      await invokeIpc(IPC_COMMANDS.applyPresetSync, {
        projectId: project.projectId,
        workspaceRoot: project.workspaceRoot,
        presetIdOrCustom: presetId,
        customPreset: null,
      });
      const refreshed = await invokeIpc(IPC_COMMANDS.getDashboardSnapshot);
      snapshotRef.current = refreshed;
      setSnapshot(refreshed);
      const updatedProj =
        refreshed.projects.find((p) => p.projectId === project.projectId) ?? project;
      await selectProject(updatedProj);
      setStatusMessage(
        `Override criado para ${project.title} com preset ${presetId}.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      updateSaving(false);
    }
  };

  const handleApplyProjectSync = async () => {
    if (!draftPreset || !activePreviewProject || savingRef.current) return;
    updateSaving(true);
    setErrorMsg(null);
    try {
      let savedProjectPreset: ResolvedProjectPreset | null = null;
      if (selectionRef.current?.kind === "project" && projectMeta) {
        savedProjectPreset = await invokeIpc("save_project_preset", {
          projectId: projectMeta.projectId,
          workspaceRoot: projectMeta.workspaceRoot,
          preset: draftPreset,
        });
        setProjectMeta(savedProjectPreset);
        setDraftPreset(clonePreset(savedProjectPreset.resolvedPreset));
        updateDirty(false);
      }

      const presetForSync = savedProjectPreset?.resolvedPreset ?? draftPreset;
      let res: SyncResult;
      try {
        res = await invokeIpc("apply_preset_sync", {
          projectId: activePreviewProject.projectId,
          workspaceRoot: activePreviewProject.workspaceRoot,
          presetIdOrCustom: presetForSync.id,
          customPreset: presetForSync,
        });
      } catch (err) {
        if (savedProjectPreset) {
          try {
            const refreshed = await invokeIpc("get_dashboard_snapshot");
            snapshotRef.current = refreshed;
            setSnapshot(refreshed);
          } catch {
            // Keep current snapshot if refresh fails
          }
          const detail = err instanceof Error ? err.message : String(err);
          setErrorMsg(
            `Preset salvo no disco (${savedProjectPreset.localPresetPath}), mas a sincronização falhou: ${detail}. Tente sincronizar novamente.`,
          );
          return;
        }
        throw err;
      }

      try {
        const refreshed = await invokeIpc("get_dashboard_snapshot");
        snapshotRef.current = refreshed;
        setSnapshot(refreshed);
      } catch {
        // Keep current snapshot if refresh fails
      }
      updateDirty(false);
      setStatusMessage(
        `Sincronizado! ${res.writtenFiles.length} arquivos gravados e settings.json atualizado (${res.activeInstanceId} · ${res.activeModel}).`,
      );
      await runPreview(activePreviewProject, presetForSync);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      updateSaving(false);
    }
  };

  const executeImportSquad = async (project: ProjectSummary) => {
    if (savingRef.current) return;
    const seq = ++selectionSeqRef.current;
    setImportingProjectId(project.projectId);
    setErrorMsg(null);
    try {
      const imported = await invokeIpc("import_project_squad", {
        projectId: project.projectId,
        workspaceRoot: project.workspaceRoot,
      });
      const refreshed = await invokeIpc("get_dashboard_snapshot");
      snapshotRef.current = refreshed;
      setSnapshot(refreshed);
      if (seq !== selectionSeqRef.current) return;
      previewSeqRef.current += 1;
      setPreviewLoading(false);
      setPreviewResult(null);
      updateSelection({ kind: "project", projectId: project.projectId });
      setProjectMeta(imported);
      setDraftPreset(clonePreset(imported.resolvedPreset));
      setPreviewTargetProjectId(project.projectId);
      setSelectedRoleId(
        Object.keys(imported.resolvedPreset.roles).sort()[0] ?? null,
      );
      updateDirty(false);
      setStatusMessage(
        `Squad importada de ${project.title} para ${imported.localPresetPath}.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingProjectId(null);
    }
  };

  const requestSelectGlobal = (presetId: string) => {
    if (savingRef.current) return;
    if (
      selectionRef.current?.kind === "global" &&
      selectionRef.current.presetId === presetId
    ) {
      return;
    }
    if (dirtyRef.current) {
      openDirtyDialog({ kind: "global", presetId });
      return;
    }
    selectGlobalPreset(presetId);
  };

  const requestSelectProject = (project: ProjectSummary) => {
    if (savingRef.current) return;
    if (
      selectionRef.current?.kind === "project" &&
      selectionRef.current.projectId === project.projectId
    ) {
      return;
    }
    if (dirtyRef.current) {
      openDirtyDialog({ kind: "project", project });
      return;
    }
    void selectProject(project);
  };

  const requestCreateGlobalPreset = (id: string, extendsId: string | null) => {
    if (savingRef.current) return;
    if (dirtyRef.current) {
      openDirtyDialog({ kind: "create-global", id, extendsId });
      return;
    }
    executeCreateGlobalPreset(id, extendsId);
  };

  const requestConfigureProjectOverride = (
    project: ProjectSummary,
    presetId: string,
  ) => {
    if (savingRef.current) return;
    if (dirtyRef.current) {
      openDirtyDialog({ kind: "configure-override", project, presetId });
      return;
    }
    void executeConfigureProjectOverride(project, presetId);
  };

  const requestImportSquad = (project: ProjectSummary) => {
    if (savingRef.current) return;
    if (dirtyRef.current) {
      openDirtyDialog({ kind: "import-squad", project });
      return;
    }
    void executeImportSquad(project);
  };

  const confirmPendingSwitch = async () => {
    if (savingRef.current) return;
    const action = pendingSwitch;
    if (!action) return;
    setPendingSwitch(null);
    previousFocusRef.current = null;
    switch (action.kind) {
      case "global":
        selectGlobalPreset(action.presetId);
        break;
      case "project":
        await selectProject(action.project);
        break;
      case "create-global":
        executeCreateGlobalPreset(action.id, action.extendsId);
        break;
      case "configure-override":
        await executeConfigureProjectOverride(action.project, action.presetId);
        break;
      case "import-squad":
        await executeImportSquad(action.project);
        break;
      case "navigate":
        await applyNavigationPayload(action.payload, action.snapshot);
        break;
    }
  };

  const handleDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusables = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first || document.activeElement === dialogRef.current) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
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

  const roleCount = draftPreset ? Object.keys(draftPreset.roles).length : 0;
  const fallbackCount = draftPreset ? draftPreset.fallbackChain.length : 0;
  const activeRole =
    draftPreset &&
    ((selectedRoleId && draftPreset.roles[selectedRoleId]) ||
      Object.values(draftPreset.roles)[0] ||
      null);
  const roleToolsCount = activeRole
    ? activeRole.skills.length + activeRole.mcps.length
    : 0;

  const getTabBadgeCount = (tabId: StudioTabId): number | null => {
    if (!draftPreset) return null;
    if (tabId === "overview") return fallbackCount;
    if (tabId === "roles") return roleCount;
    if (tabId === "skills") return roleToolsCount;
    if (tabId === "preview" && previewResult?.hasChanges) {
      return (
        previewResult.files.filter((f) => f.changed).length +
        (previewResult.settingsPreview.changed ? 1 : 0)
      );
    }
    return null;
  };

  if (loading && !snapshot) {
    return (
      <div className="surface-backdrop flex h-full items-center justify-center text-xs text-zinc-400">
        Carregando Preset Studio…
      </div>
    );
  }

  const orchLabel =
    draftPreset && snapshot
      ? resolveInstanceShortLabel(
          draftPreset.orchestrator.providerInstanceId,
          snapshot.providerInstances,
        )
      : null;
  const orchOption = draftPreset
    ? formatPrimaryOptionSummary(draftPreset.orchestrator.options)
    : null;
  const topologyLabel =
    draftPreset?.topology === "issue-thread-orchestrator"
      ? "Issue-Thread"
      : "Intra-Thread";

  const isActiveGlobalDefault =
    selection?.kind === "global" &&
    Boolean(draftPreset) &&
    snapshot?.globalConfig.activeGlobalPresetId === draftPreset?.id;

  const activeProjectSummary =
    selection?.kind === "project" && projectMeta && snapshot
      ? snapshot.projects.find((p) => p.projectId === projectMeta.projectId) ?? null
      : null;

  const globalOrPresetEnabled = isActiveGlobalDefault
    ? Boolean(snapshot?.globalConfig.enabled)
    : Boolean(draftPreset?.enabled);

  const projectOverrideEnabled =
    activeProjectSummary?.presetEnabled ?? Boolean(draftPreset?.enabled);

  return (
    <div className="surface-backdrop flex h-full w-full overflow-hidden text-zinc-100">
      <StudioSidebar
        globalConfig={
          snapshot?.globalConfig ?? {
            activeGlobalPresetId: "default",
            enabled: true,
          }
        }
        globalPresets={snapshot?.globalPresets ?? []}
        projects={snapshot?.projects ?? []}
        selection={selection}
        onSelectGlobal={requestSelectGlobal}
        onSelectProject={requestSelectProject}
        onCreateGlobalPreset={requestCreateGlobalPreset}
        onImportProjectSquad={requestImportSquad}
        onConfigureProjectOverride={requestConfigureProjectOverride}
        importingProjectId={importingProjectId}
        disabled={saving}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Editor Header + Visual Architecture Summary */}
        <header className="shrink-0 border-b border-white/[0.08] bg-zinc-950/85 px-6 py-4 backdrop-blur-md space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-base font-semibold tracking-tight text-zinc-100">
                  {selection?.kind === "project" && projectMeta
                    ? projectMeta.projectSlug
                    : (draftPreset?.name ?? "Preset Studio")}
                </h1>

                {selection?.kind === "project" ? (
                  <Badge tone="emerald" dot>
                    Projeto · Override Local
                  </Badge>
                ) : (
                  <>
                    <Badge tone="indigo">
                      <Layers className="size-3" aria-hidden="true" />
                      Preset Global
                    </Badge>
                    {isActiveGlobalDefault ? (
                      <Badge
                        tone={snapshot?.globalConfig.enabled ? "emerald" : "neutral"}
                        dot
                      >
                        Default Global
                      </Badge>
                    ) : null}
                    {draftPreset?.id === "default" ? (
                      <Badge tone="sky">Instalado por padrão</Badge>
                    ) : null}
                  </>
                )}

                {dirty ? (
                  <Badge tone="amber" dot>
                    Alterações não salvas
                  </Badge>
                ) : null}
              </div>

              <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">
                {selection?.kind === "project" && projectMeta
                  ? projectMeta.localPresetPath
                  : `~/.config/oh-my-t3code/presets/${draftPreset?.id ?? "preset"}.jsonc`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selection?.kind === "global" && draftPreset ? (
                <>
                  <StatusToggle
                    size="sm"
                    enabled={globalOrPresetEnabled}
                    disabled={saving}
                    onClick={() => void handleToggleGlobalPresetStatus()}
                    aria-label={
                      isActiveGlobalDefault
                        ? "Alternar status do Preset Global"
                        : `Alternar status de ${draftPreset.name}`
                    }
                  />

                  {!isActiveGlobalDefault ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={saving}
                      onClick={() => void handleSetAsGlobalDefault()}
                    >
                      <Globe className="size-3.5" aria-hidden="true" />
                      Definir como Global Default
                    </Button>
                  ) : null}

                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!draftPreset || saving}
                    onClick={() => void handleSaveGlobalPreset()}
                  >
                    <Save className="size-3.5" aria-hidden="true" />
                    Salvar Preset Global
                  </Button>
                </>
              ) : selection?.kind === "project" && draftPreset && projectMeta ? (
                <>
                  <StatusToggle
                    size="sm"
                    enabled={projectOverrideEnabled}
                    disabled={saving}
                    onClick={() => void handleToggleProjectEnabled()}
                    aria-label={`Alternar preset de ${projectMeta.projectSlug}`}
                  />

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => void handleRemoveProjectOverride()}
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                    Voltar ao Global (Remover Override)
                  </Button>

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
              ) : null}
            </div>
          </div>

          {/* Visual Architecture Summary Strip */}
          {draftPreset && snapshot ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <Badge
                tone={getInstanceBadgeTone(
                  draftPreset.orchestrator.providerInstanceId,
                )}
              >
                <Cpu className="size-3" aria-hidden="true" />
                <span>
                  Orquestrador: {orchLabel} ·{" "}
                  <span className="font-mono">
                    {draftPreset.orchestrator.model}
                  </span>
                  {orchOption ? ` (${orchOption})` : ""}
                </span>
              </Badge>

              <Badge tone="neutral">
                <Network className="size-3 text-zinc-400" aria-hidden="true" />
                <span>Topologia: {topologyLabel}</span>
              </Badge>

              <Badge tone="neutral" className="tabular-nums">
                <GitBranch className="size-3 text-amber-300" aria-hidden="true" />
                <span>
                  Fallback: {fallbackCount}{" "}
                  {fallbackCount === 1 ? "nível" : "níveis"}
                </span>
              </Badge>

              <Badge tone="neutral" className="tabular-nums">
                <Users className="size-3 text-indigo-300" aria-hidden="true" />
                <span>Papéis: {roleCount}</span>
              </Badge>
            </div>
          ) : null}
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

        {/* Accessible Tablist with discrete numeric badges */}
        <nav
          aria-label="Seções do Editor"
          className="shrink-0 border-b border-white/[0.08] bg-zinc-950/60 px-6"
        >
          <div role="tablist" className="flex items-center gap-1 overflow-x-auto">
            {STUDIO_TABS.map((tab, idx) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              const count = getTabBadgeCount(tab.id);

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
                    "transition-[color,border-color] duration-150 ease-out",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400",
                    selected
                      ? "border-indigo-400 text-zinc-100"
                      : "border-transparent text-zinc-400 hover:text-zinc-200",
                  ].join(" ")}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  <span>{tab.label}</span>
                  {count !== null ? (
                    <span
                      className={[
                        "rounded-full px-1.5 py-0.5 text-[10px] leading-none tabular-nums",
                        selected
                          ? "bg-indigo-500/25 text-indigo-200"
                          : "bg-white/[0.07] text-zinc-400",
                      ].join(" ")}
                    >
                      {count}
                    </span>
                  ) : null}
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
            <div className="surface-card rounded-2xl border-dashed p-8 text-center text-xs text-zinc-400">
              Selecione um preset global ou projeto na barra lateral para iniciar a edição.
            </div>
          )}
        </main>
      </div>

      {pendingSwitch ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={cancelPendingSwitch}
        >
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="studio-dirty-dialog-title"
            aria-describedby="studio-dirty-dialog-desc"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleDialogKeyDown}
            className="surface-card w-full max-w-md rounded-2xl border border-amber-400/30 bg-zinc-950 p-5 shadow-2xl space-y-4 focus:outline-none"
          >
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-500/15 text-amber-300">
                <AlertCircle className="size-4.5" aria-hidden="true" />
              </div>
              <div className="min-w-0 space-y-1">
                <h2
                  id="studio-dirty-dialog-title"
                  className="text-sm font-semibold tracking-tight text-zinc-100"
                >
                  Alterações não salvas
                </h2>
                <p
                  id="studio-dirty-dialog-desc"
                  className="text-xs leading-relaxed text-zinc-300"
                >
                  Você tem edições não salvas no preset atual. Se continuar, essas
                  alterações serão descartadas.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button
                variant="secondary"
                size="sm"
                data-dialog-cancel="true"
                onClick={cancelPendingSwitch}
              >
                Continuar editando
              </Button>
              <Button
                variant="danger"
                size="sm"
                data-dialog-confirm="true"
                onClick={() => void confirmPendingSwitch()}
              >
                Descartar alterações e continuar
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
