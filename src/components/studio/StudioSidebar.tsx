import { useState } from "react";
import {
  Download,
  FolderGit2,
  Layers,
  Plus,
  Sparkles,
} from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { isValidSafeId, sanitizeSafeId } from "../../lib/preset-utils";
import type { PresetConfig, ProjectSummary } from "../../types/ipc";

export type StudioSelection =
  | { kind: "global"; presetId: string }
  | { kind: "project"; projectId: string };

interface StudioSidebarProps {
  globalPresets: PresetConfig[];
  projects: ProjectSummary[];
  selection: StudioSelection | null;
  onSelectGlobal: (presetId: string) => void;
  onSelectProject: (project: ProjectSummary) => void;
  onCreateGlobalPreset: (id: string, extendsId: string | null) => void;
  onImportProjectSquad: (project: ProjectSummary) => void;
  importingProjectId: string | null;
}

export function StudioSidebar({
  globalPresets,
  projects,
  selection,
  onSelectGlobal,
  onSelectProject,
  onCreateGlobalPreset,
  onImportProjectSquad,
  importingProjectId,
}: StudioSidebarProps) {
  const [creatingGlobal, setCreatingGlobal] = useState(false);
  const [newPresetId, setNewPresetId] = useState("");
  const [newPresetBase, setNewPresetBase] = useState<string>("agy-dual");
  const [createError, setCreateError] = useState<string | null>(null);

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

  return (
    <aside
      aria-label="Navegação de Presets e Projetos"
      className="flex h-full w-72 shrink-0 flex-col border-r border-white/10 bg-zinc-950/90"
    >
      <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
        <div
          className="flex size-8 items-center justify-center rounded-lg border border-indigo-400/25 bg-indigo-500/15 text-indigo-300"
          aria-hidden="true"
        >
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-100">
            Oh My T3Code
          </div>
          <div className="text-[11px] text-zinc-400">Preset Studio</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-5">
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
              className="rounded-xl border border-indigo-500/30 bg-zinc-900/90 p-2.5 space-y-2"
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
                  className="mt-1 w-full rounded-lg border border-white/15 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                />
              </div>
              <div>
                <label
                  htmlFor="new-global-preset-base"
                  className="block text-[11px] font-medium text-zinc-300"
                >
                  Herdar de (`extends`)
                </label>
                <select
                  id="new-global-preset-base"
                  value={newPresetBase}
                  onChange={(e) => setNewPresetBase(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <option value="">Nenhum (Base)</option>
                  {globalPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                    </option>
                  ))}
                </select>
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

          <ul className="space-y-1">
            {globalPresets.map((preset) => {
              const active =
                selection?.kind === "global" && selection.presetId === preset.id;
              return (
                <li key={preset.id}>
                  <button
                    type="button"
                    onClick={() => onSelectGlobal(preset.id)}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "flex w-full items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                      active
                        ? "border-indigo-400/40 bg-indigo-500/15 text-zinc-100"
                        : "border-transparent bg-transparent text-zinc-300 hover:bg-white/5 hover:text-zinc-100",
                    ].join(" ")}
                  >
                    <Layers
                      className={`mt-0.5 size-3.5 shrink-0 ${
                        active ? "text-indigo-300" : "text-zinc-400"
                      }`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{preset.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-400">
                        <span className="font-mono">{preset.id}</span>
                        {preset.extends ? (
                          <span className="truncate text-indigo-300/80">
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

        {/* T3 Code Projects Group */}
        <section aria-labelledby="sidebar-projects" className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2
              id="sidebar-projects"
              className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
            >
              Projetos T3 Code
            </h2>
            <span className="text-[11px] text-zinc-500 tabular-nums">
              {projects.length}
            </span>
          </div>

          <ul className="space-y-1.5">
            {projects.map((project) => {
              const active =
                selection?.kind === "project" && selection.projectId === project.projectId;
              const isImporting = importingProjectId === project.projectId;

              return (
                <li
                  key={project.projectId}
                  className={[
                    "rounded-xl border transition-colors duration-150",
                    active
                      ? "border-indigo-400/40 bg-indigo-500/12"
                      : "border-white/6 bg-zinc-900/40 hover:border-white/12",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => onSelectProject(project)}
                    aria-current={active ? "page" : undefined}
                    className="flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <FolderGit2
                      className={`mt-0.5 size-3.5 shrink-0 ${
                        active ? "text-indigo-300" : "text-zinc-400"
                      }`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-zinc-100">
                        {project.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {project.hasLocalPreset ? (
                          <Badge tone="emerald">Override</Badge>
                        ) : (
                          <Badge tone="neutral">Global</Badge>
                        )}
                        {project.detectedSquadSlug ? (
                          <Badge tone="indigo">squad</Badge>
                        ) : null}
                      </div>
                    </div>
                  </button>

                  {project.detectedSquadSlug ? (
                    <div className="border-t border-white/6 px-2.5 py-1.5">
                      <Button
                        variant="ghost"
                        size="xs"
                        className="w-full justify-start text-[11px]"
                        disabled={isImporting}
                        onClick={() => onImportProjectSquad(project)}
                      >
                        <Download className="size-3" aria-hidden="true" />
                        {isImporting
                          ? "Importando..."
                          : "Importar Squad Existente"}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </aside>
  );
}
