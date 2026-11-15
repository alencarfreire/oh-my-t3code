import { useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  FileCode2,
  FileDiff,
  FileJson,
  FileText,
  RefreshCw,
  Save,
  UploadCloud,
  UserCog,
} from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DiffViewer } from "../ui/DiffViewer";
import { Select } from "../ui/Select";
import type {
  CompilePreviewResult,
  ProjectSummary,
} from "../../types/ipc";

interface PreviewDiffTabProps {
  preview: CompilePreviewResult | null;
  loading: boolean;
  isProjectMode: boolean;
  projects: ProjectSummary[];
  previewTargetProjectId: string | null;
  onChangePreviewTargetProject: (projectId: string) => void;
  onRefreshPreview: () => void;
  onApplyProjectSync: () => void;
  onSaveGlobalPreset: () => void;
  saving: boolean;
}

export function PreviewDiffTab({
  preview,
  loading,
  isProjectMode,
  projects,
  previewTargetProjectId,
  onChangePreviewTargetProject,
  onRefreshPreview,
  onApplyProjectSync,
  onSaveGlobalPreset,
  saving,
}: PreviewDiffTabProps) {
  const [selectedTarget, setSelectedTarget] = useState<string>("__settings__");
  const [viewMode, setViewMode] = useState<"diff" | "compiled">("diff");
  const [copied, setCopied] = useState(false);

  const activeFile = preview?.files.find(
    (f) => f.relativePath === selectedTarget,
  );
  const showingSettings =
    selectedTarget === "__settings__" || (!activeFile && preview);

  const compiledContent = showingSettings
    ? JSON.stringify(preview?.settingsPreview.newOverride ?? {}, null, 2)
    : (activeFile?.newContent ?? "");

  const diffContent = showingSettings
    ? (preview?.settingsPreview.unifiedDiff ?? "")
    : (activeFile?.unifiedDiff ?? "");

  const handleCopyContent = async () => {
    const payload = viewMode === "diff" && diffContent.trim() ? diffContent : compiledContent;
    if (!payload) return;
    try {
      await navigator.clipboard?.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard might be restricted in headless test environments
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Control Bar */}
      <div className="surface-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Preview & Unified Diff antes da gravação
            </h3>
            <p className="text-[11px] text-zinc-400">
              Revise `SKILL.md`, `roles/*.md` e o override em `~/.t3/userdata/settings.json`.
            </p>
          </div>

          {!isProjectMode && projects.length > 0 ? (
            <div className="flex items-center gap-2">
              <label
                htmlFor="preview-target-project"
                className="text-[11px] font-medium text-zinc-300"
              >
                Simular no projeto:
              </label>
              <Select
                id="preview-target-project"
                sizeVariant="xs"
                value={previewTargetProjectId ?? ""}
                onChange={(e) => onChangePreviewTargetProject(e.target.value)}
                wrapperClassName="min-w-40"
              >
                {projects.map((p) => (
                  <option key={p.projectId} value={p.projectId}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefreshPreview}
            disabled={loading}
          >
            <RefreshCw
              className={`size-3.5 ${loading ? "motion-safe:animate-spin" : ""}`}
              aria-hidden="true"
            />
            Atualizar Diff
          </Button>

          {!isProjectMode ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={saving}
              onClick={onSaveGlobalPreset}
            >
              <Save className="size-3.5" aria-hidden="true" />
              Salvar Preset Global
            </Button>
          ) : null}

          {previewTargetProjectId ? (
            <Button
              variant="primary"
              size="sm"
              disabled={saving || loading}
              onClick={onApplyProjectSync}
            >
              <UploadCloud className="size-3.5" aria-hidden="true" />
              Salvar & Sincronizar Projeto
            </Button>
          ) : null}
        </div>
      </div>

      {loading && !preview ? (
        <div className="surface-card rounded-2xl p-8 text-center text-xs text-zinc-400">
          Calculando preview determinístico dos arquivos compilados…
        </div>
      ) : preview ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* File list */}
          <div className="lg:col-span-4 space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Arquivos Alvo ({preview.files.length + 1})
              </span>
              {preview.hasChanges ? (
                <Badge tone="amber" dot>
                  Alterações pendentes
                </Badge>
              ) : (
                <Badge tone="emerald">
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  Em dia
                </Badge>
              )}
            </div>

            <ul className="space-y-1.5">
              <li>
                <button
                  type="button"
                  onClick={() => setSelectedTarget("__settings__")}
                  aria-current={showingSettings ? "true" : undefined}
                  className={[
                    "flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color] duration-150 ease-out",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                    showingSettings
                      ? "border-indigo-400/50 bg-indigo-500/[0.14]"
                      : "border-white/8 bg-zinc-900/65 hover:border-white/18",
                  ].join(" ")}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileJson
                      className="size-4 shrink-0 text-amber-300"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs font-medium text-zinc-100">
                        settings.json (override)
                      </div>
                      <div className="truncate text-[10px] text-zinc-400">
                        projectSettingsOverrides
                      </div>
                    </div>
                  </div>
                  <Badge tone={preview.settingsPreview.changed ? "amber" : "neutral"}>
                    {preview.settingsPreview.changed ? "Modificado" : "Idêntico"}
                  </Badge>
                </button>
              </li>

              {preview.files.map((file) => {
                const active = selectedTarget === file.relativePath;
                const isRoleFile = file.relativePath.includes("/roles/");
                const FileIcon = isRoleFile ? UserCog : FileText;

                return (
                  <li key={file.relativePath}>
                    <button
                      type="button"
                      onClick={() => setSelectedTarget(file.relativePath)}
                      aria-current={active ? "true" : undefined}
                      className={[
                        "flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color] duration-150 ease-out",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                        active
                          ? "border-indigo-400/50 bg-indigo-500/[0.14]"
                          : "border-white/8 bg-zinc-900/65 hover:border-white/18",
                      ].join(" ")}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <FileIcon
                          className={`size-4 shrink-0 ${
                            isRoleFile ? "text-sky-300" : "text-indigo-300"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 truncate font-mono text-xs text-zinc-100">
                          {file.relativePath}
                        </span>
                      </span>
                      <Badge
                        tone={
                          file.changed
                            ? file.existingContent === null
                              ? "emerald"
                              : "amber"
                            : "neutral"
                        }
                      >
                        {file.changed
                          ? file.existingContent === null
                            ? "Novo"
                            : "Modificado"
                          : "Idêntico"}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Diff / Compiled Markdown pane */}
          <div className="lg:col-span-8 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1 truncate rounded-lg border border-white/8 bg-zinc-900/60 px-2.5 py-1 font-mono text-[11px] text-zinc-300">
                {showingSettings
                  ? preview.settingsPreview.settingsPath
                  : activeFile?.path}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => void handleCopyContent()}
                >
                  {copied ? (
                    <>
                      <Check className="size-3.5 text-emerald-400" aria-hidden="true" />
                      Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" aria-hidden="true" />
                      Copiar Conteúdo
                    </>
                  )}
                </Button>

                <div
                  className="inline-flex rounded-lg border border-white/10 bg-zinc-900 p-0.5"
                  role="group"
                  aria-label="Modo de visualização do arquivo"
                >
                  <button
                    type="button"
                    onClick={() => setViewMode("diff")}
                    aria-pressed={viewMode === "diff"}
                    className={[
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                      viewMode === "diff"
                        ? "bg-indigo-500 text-white"
                        : "text-zinc-300 hover:text-zinc-100",
                    ].join(" ")}
                  >
                    <FileDiff className="size-3.5" aria-hidden="true" />
                    Unified Diff
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("compiled")}
                    aria-pressed={viewMode === "compiled"}
                    className={[
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                      viewMode === "compiled"
                        ? "bg-indigo-500 text-white"
                        : "text-zinc-300 hover:text-zinc-100",
                    ].join(" ")}
                  >
                    <FileCode2 className="size-3.5" aria-hidden="true" />
                    Markdown Compilado
                  </button>
                </div>
              </div>
            </div>

            {viewMode === "diff" ? (
              <DiffViewer diffText={diffContent} />
            ) : (
              <pre className="max-h-[480px] overflow-auto overscroll-contain rounded-xl border border-white/10 bg-[#0b0b0e] p-4 font-mono text-[12px] leading-5 text-zinc-200 whitespace-pre-wrap shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
                {compiledContent}
              </pre>
            )}
          </div>
        </div>
      ) : (
        <div className="surface-card rounded-2xl border-dashed p-8 text-center text-xs text-zinc-400">
          Nenhum projeto disponível para gerar preview de compilação.
        </div>
      )}
    </div>
  );
}
