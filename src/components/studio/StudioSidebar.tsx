import { useEffect, useMemo, useState } from "react";
import {
  Download,
  FolderGit2,
  GitBranch,
  Layers,
  Plus,
  Sparkles,
} from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import {
  isValidSafeId,
  resolvePresetFamilyTag,
  sanitizeSafeId,
} from "../../lib/preset-utils";
import type {
  GlobalAppConfig,
  PresetConfig,
  ProjectSummary,
} from "../../types/ipc";

export type StudioSelection =
  | { kind: "global"; presetId: string }
  | { kind: "project"; projectId: string };

interface StudioSidebarProps {
  globalConfig: GlobalAppConfig;
  globalPresets: PresetConfig[];
  projects: ProjectSummary[];
  selection: StudioSelection | null;
  onSelectGlobal: (presetId: string) => void;
  onSelectProject: (project: ProjectSummary) => void;
  onCreateGlobalPreset: (id: string, extendsId: string | null) => void;
  onImportProjectSquad: (project: ProjectSummary) => void;
  onConfigureProjectOverride: (project: ProjectSummary, presetId: string) => void;
  importingProjectId: string | null;
}

export function StudioSidebar({
  globalConfig,
  globalPresets,
  projects,
  selection,
  onSelectGlobal,
  onSelectProject,
  onCreateGlobalPreset,
  onImportProjectSquad,
  onConfigureProjectOverride,
  importingProjectId,
}: StudioSidebarProps) {
  const [creatingGlobal, setCreatingGlobal] = useState(false);
  const [newPresetId, setNewPresetId] = useState("");
  const [newPresetBase, setNewPresetBase] = useState<string>("default");
  const [createError, setCreateError] = useState<string | null>(null);

  const sortedGlobalPresets = useMemo(() => {
    const rank = (id: string) => {
      if (id === "default") return 0;
      if (id === "agy-dual") return 1;
      if (id === "codex-squad") return 2;
      if (id === "hybrid-agy-codex") return 3;
      return 4;
    };
    return [...globalPresets].sort((a, b) => {
      const diff = rank(a.id) - rank(b.id);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
  }, [globalPresets]);

  const [configuringProject, setConfiguringProject] = useState(false);
  const [selectedUnconfiguredId, setSelectedUnconfiguredId] = useState("");
  const [selectedPresetForOverride, setSelectedPresetForOverride] = useState(
    globalConfig.activeGlobalPresetId,
  );

  const overrideProjects = useMemo(
    () => projects.filter((p) => p.hasCustomOverride),
    [projects],
  );

  const unconfiguredProjects = useMemo(
    () => projects.filter((p) => !p.hasCustomOverride),
    [projects],
  );

  useEffect(() => {
    if (
      unconfiguredProjects.length > 0 &&
      !unconfiguredProjects.some((p) => p.projectId === selectedUnconfiguredId)
    ) {
      setSelectedUnconfiguredId(unconfiguredProjects[0].projectId);
    }
    if (
      globalPresets.length > 0 &&
      !globalPresets.some((p) => p.id === selectedPresetForOverride)
    ) {
      setSelectedPresetForOverride(globalConfig.activeGlobalPresetId);
    }
  }, [
    globalConfig.activeGlobalPresetId,
    globalPresets,
    selectedPresetForOverride,
    selectedUnconfiguredId,
    unconfiguredProjects,
  ]);

  const selectedUnconfiguredProject =
    unconfiguredProjects.find((p) => p.projectId === selectedUnconfiguredId) ?? null;

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = sanitizeSafeId(newPresetId);
    if (!isValidSafeId(cleaned)) {
      setCreateError("Use apenas letras, números, '-' ou '_' (1 a 64 caracteres).");
      return;
    }
    if (globalPresets.some((p) => p.id === cleaned)) {
      setCreateError(`Já existe um preset global com id '${cleaned}'.`);
      return;
    }
    setCreateError(null);
    onCreateGlobalPreset(cleaned, newPresetBase || null);
    setNewPresetId("");
    setCreatingGlobal(false);
  };

  const handleConfigureSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUnconfiguredProject) return;
    onConfigureProjectOverride(
      selectedUnconfiguredProject,
      selectedPresetForOverride || globalConfig.activeGlobalPresetId,
    );
    setConfiguringProject(false);
  };

  return (
    <aside
      aria-label="Navegação de Presets e Projetos"
      className="flex h-full w-76 shrink-0 flex-col border-e border-white/[0.08] bg-[#0c0c0f]"
    >
      {/* Brand Header */}
      <div className="flex items-center gap-2.5 border-b border-white/[0.08] px-4 py-3.5">
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-amber-400/30 bg-gradient-to-b from-amber-500/15 to-zinc-900 p-0.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]">
          <img
            src="/logo.png"
            alt="Oh My T3Code"
            className="size-full rounded-lg object-contain"
          />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight text-zinc-100">
            Oh My T3Code
          </div>
          <div className="flex items-center gap-1 text-[11px] text-zinc-400">
            <Sparkles className="size-3 text-amber-400/90" aria-hidden="true" />
            <span>Preset Studio</span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-6">
        {/* Global Presets Group */}
        <section aria-labelledby="sidebar-global-presets" className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2
              id="sidebar-global-presets"
              className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
            >
              Presets Globais
            </h2>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setCreatingGlobal((v) => !v);
                setCreateError(null);
              }}
              aria-expanded={creatingGlobal}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Novo Preset Global
            </Button>
          </div>

          {creatingGlobal ? (
            <form
              onSubmit={handleCreateSubmit}
              className="surface-card rounded-xl border-indigo-500/30 bg-zinc-900/90 p-3 space-y-2.5"
            >
              <div>
                <label
                  htmlFor="new-global-preset-id"
                  className="block text-[11px] font-medium text-zinc-300"
                >
                  ID do Preset (`~/.config/.../presets/*.jsonc`)
                </label>
                <input
                  id="new-global-preset-id"
                  type="text"
                  value={newPresetId}
                  onChange={(e) => setNewPresetId(e.target.value)}
                  placeholder="ex: rails-agy-squad"
                  autoFocus
                  className="mt-1 h-8 w-full rounded-lg border border-white/15 bg-zinc-950 px-2.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                />
              </div>
              <div>
                <label
                  htmlFor="new-global-preset-base"
                  className="block text-[11px] font-medium text-zinc-300"
                >
                  Herdar de (`extends`)
                </label>
                <Select
                  id="new-global-preset-base"
                  sizeVariant="xs"
                  value={newPresetBase}
                  onChange={(e) => setNewPresetBase(e.target.value)}
                  wrapperClassName="mt-1"
                >
                  <option value="">Nenhum (Base)</option>
                  {sortedGlobalPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                    </option>
                  ))}
                </Select>
              </div>
              {createError ? (
                <p role="alert" className="text-[11px] text-rose-300">
                  {createError}
                </p>
              ) : null}
              <div className="flex justify-end gap-1.5">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setCreatingGlobal(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" size="xs">
                  Criar
                </Button>
              </div>
            </form>
          ) : null}

          <ul className="space-y-1.5">
            {sortedGlobalPresets.map((preset) => {
              const active =
                selection?.kind === "global" && selection.presetId === preset.id;
              const isDefaultGlobal = preset.id === globalConfig.activeGlobalPresetId;
              const isBuiltinInstallDefault = preset.id === "default";
              const family = resolvePresetFamilyTag(preset);
              const roleCount = Object.keys(preset.roles).length;

              return (
                <li key={preset.id}>
                  <button
                    type="button"
                    onClick={() => onSelectGlobal(preset.id)}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "relative flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-150 ease-out",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                      active
                        ? "border-indigo-400/45 bg-indigo-500/[0.14] text-zinc-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]"
                        : "border-transparent bg-transparent text-zinc-300 hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-zinc-100",
                    ].join(" ")}
                  >
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="absolute start-0 top-2 bottom-2 w-0.5 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.9)]"
                      />
                    ) : null}
                    <Layers
                      className={`mt-0.5 size-3.5 shrink-0 ${
                        active ? "text-indigo-300" : "text-zinc-400"
                      }`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium">
                          {preset.name}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        {isDefaultGlobal ? (
                          <Badge
                            tone={globalConfig.enabled ? "emerald" : "neutral"}
                            dot
                          >
                            {globalConfig.enabled ? "Default · Ativo" : "Default · Pausado"}
                          </Badge>
                        ) : !preset.enabled ? (
                          <Badge tone="neutral">Desativado</Badge>
                        ) : null}
                        {isBuiltinInstallDefault ? (
                          <Badge tone="sky">Instalado por padrão</Badge>
                        ) : null}
                        <Badge tone={family.tone}>{family.label}</Badge>
                        <span className="text-zinc-400 tabular-nums">
                          {roleCount} {roleCount === 1 ? "role" : "roles"}
                        </span>
                        {preset.extends ? (
                          <span className="truncate font-mono text-indigo-300/80">
                            ↳ {preset.extends}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* T3 Code Override Projects Group */}
        <section aria-labelledby="sidebar-projects" className="space-y-2">
          <div className="flex items-center justify-between gap-1.5 px-1">
            <h2
              id="sidebar-projects"
              className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
            >
              Projetos com Override{" "}
              <span className="tabular-nums text-zinc-500">
                ({overrideProjects.length})
              </span>
            </h2>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setConfiguringProject((v) => !v)}
              aria-expanded={configuringProject}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Configurar Projeto
            </Button>
          </div>

          {configuringProject ? (
            <form
              onSubmit={handleConfigureSubmit}
              className="surface-card rounded-xl border-indigo-500/30 bg-zinc-900/90 p-3 space-y-2.5"
            >
              {unconfiguredProjects.length === 0 ? (
                <div className="space-y-2 text-[11px] text-zinc-400">
                  <p>Todos os projetos do T3 Code já possuem override.</p>
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
                  <div>
                    <label
                      htmlFor="sidebar-configure-project-select"
                      className="block text-[11px] font-medium text-zinc-300"
                    >
                      Projeto (seguindo Global Default)
                    </label>
                    <Select
                      id="sidebar-configure-project-select"
                      aria-label="Selecionar projeto sem override"
                      sizeVariant="xs"
                      value={selectedUnconfiguredId}
                      onChange={(e) => setSelectedUnconfiguredId(e.target.value)}
                      wrapperClassName="mt-1"
                    >
                      {unconfiguredProjects.map((project) => (
                        <option key={project.projectId} value={project.projectId}>
                          {project.title}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <label
                      htmlFor="sidebar-configure-preset-select"
                      className="block text-[11px] font-medium text-zinc-300"
                    >
                      Preset Inicial
                    </label>
                    <Select
                      id="sidebar-configure-preset-select"
                      aria-label="Preset inicial do override"
                      sizeVariant="xs"
                      value={selectedPresetForOverride}
                      onChange={(e) => setSelectedPresetForOverride(e.target.value)}
                      wrapperClassName="mt-1"
                    >
                      {sortedGlobalPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.id} — {preset.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setConfiguringProject(false)}
                    >
                      Cancelar
                    </Button>
                    {selectedUnconfiguredProject?.detectedSquadSlug ? (
                      <Button
                        variant="secondary"
                        size="xs"
                        disabled={
                          importingProjectId === selectedUnconfiguredProject.projectId
                        }
                        onClick={() => {
                          onImportProjectSquad(selectedUnconfiguredProject);
                          setConfiguringProject(false);
                        }}
                      >
                        <Download className="size-3" aria-hidden="true" />
                        Importar Squad
                      </Button>
                    ) : null}
                    <Button type="submit" variant="primary" size="xs">
                      Criar Override
                    </Button>
                  </div>
                </>
              )}
            </form>
          ) : null}

          {overrideProjects.length === 0 ? (
            <div className="surface-card rounded-xl border-dashed p-3 text-center text-[11px] text-zinc-400">
              Nenhum projeto com override. Todos seguem o Global Default.
            </div>
          ) : (
            <ul className="space-y-2">
              {overrideProjects.map((project) => {
                const active =
                  selection?.kind === "project" &&
                  selection.projectId === project.projectId;
                const isImporting = importingProjectId === project.projectId;
                const inheritsLabel = project.localPresetExtends
                  ? `extends: ${project.localPresetExtends}`
                  : project.localPresetId
                    ? `preset: ${project.localPresetId}`
                    : "override local";

                return (
                  <li
                    key={project.projectId}
                    className={[
                      "relative overflow-hidden rounded-xl border transition-[background-color,border-color,box-shadow] duration-150 ease-out",
                      active
                        ? "border-indigo-400/45 bg-indigo-500/[0.12] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]"
                        : "border-white/[0.07] bg-zinc-900/50 hover:border-white/[0.14] hover:bg-zinc-900/75",
                    ].join(" ")}
                  >
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="absolute start-0 top-2 bottom-2 w-0.5 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.9)]"
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onSelectProject(project)}
                      aria-current={active ? "page" : undefined}
                      className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    >
                      <FolderGit2
                        className={`mt-0.5 size-3.5 shrink-0 ${
                          active ? "text-indigo-300" : "text-zinc-400"
                        }`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-zinc-100">
                            {project.title}
                          </span>
                          {project.presetEnabled ? (
                            <Badge tone="emerald" dot>
                              Ativo
                            </Badge>
                          ) : (
                            <Badge tone="neutral" dot>
                              Desativado
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                          <GitBranch
                            className="size-2.5 shrink-0 text-zinc-500"
                            aria-hidden="true"
                          />
                          <span className="truncate font-mono">{inheritsLabel}</span>
                        </div>
                      </div>
                    </button>

                    {project.detectedSquadSlug ? (
                      <div className="border-t border-white/[0.06] bg-zinc-950/35 px-2.5 py-1.5">
                        <Button
                          variant={project.hasLocalPreset ? "ghost" : "secondary"}
                          size="xs"
                          className="w-full justify-start text-[11px]"
                          disabled={isImporting}
                          onClick={() => onImportProjectSquad(project)}
                        >
                          <Download
                            className={`size-3 ${
                              project.hasLocalPreset ? "text-zinc-400" : "text-amber-300"
                            }`}
                            aria-hidden="true"
                          />
                          <span className="truncate">
                            {isImporting
                              ? "Importando…"
                              : "Importar Squad Existente"}
                          </span>
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
