import { useEffect, useId, useState } from "react";
import { Cpu, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { StringListEditor } from "../ui/StringListEditor";
import {
  defaultMaxAntigravityForProfile,
  effectiveParentThinkingLevel,
  isValidSafeId,
  sanitizeSafeId,
} from "../../lib/preset-utils";
import type {
  HardwareProfile,
  SessionPolicy,
  WorkerThinkingRule,
} from "../../types/ipc";

const HARDWARE_PROFILE_OPTIONS: ReadonlyArray<{
  value: HardwareProfile;
  label: string;
}> = [
  {
    value: "laptop-8gb",
    label: "laptop-8gb — Laptop 8 GB (máx. 2 Antigravity, pai medium)",
  },
  {
    value: "desktop-16gb",
    label: "desktop-16gb — Desktop 16 GB (máx. 3 Antigravity)",
  },
  {
    value: "desktop-32gb-plus",
    label: "desktop-32gb-plus — Workstation 32+ GB (máx. 4 Antigravity)",
  },
];

const THINKING_LEVEL_OPTIONS = ["low", "medium", "high", "xhigh"] as const;

const WORKER_MODEL_OPTIONS = [
  "gemini-4-hydrogen",
  "gemini-4-argon",
  "gemini-3.8-flash",
  "gpt-6.1-sol",
  "gpt-6.1-terra",
  "gpt-6-astra",
  "gpt-6-luna",
  "claude-sonnet-4-5",
  "claude-opus-4-1",
] as const;

const DELEGATE_MODE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  {
    value: "async-default",
    label: "async-default — Delegação assíncrona padrão (sem polling)",
  },
  {
    value: "sync-only",
    label: "sync-only — Apenas tarefas síncronas curtas",
  },
  {
    value: "adaptive",
    label: "adaptive — Adapta conforme carga e perfil de hardware",
  },
];

const ACP_DEAD_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  {
    value: "advise-new-thread",
    label: "advise-new-thread — Instruir handoff imediato em novo thread pai",
  },
  {
    value: "fallback-codex",
    label: "fallback-codex — Transbordar worker para Codex quando possível",
  },
  {
    value: "halt",
    label: "halt — Interromper novas delegações até diagnóstico",
  },
];

interface NumberFieldProps {
  id: string;
  label: string;
  helper?: string;
  value: number;
  min: number;
  step?: number;
  onCommit: (next: number) => void;
}

function NumberField({
  id,
  label,
  helper,
  value,
  min,
  step = 1,
  onCommit,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(() => String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const handleChange = (raw: string) => {
    setDraft(raw);
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed >= min) {
      onCommit(parsed);
    }
  };

  const handleBlur = () => {
    const trimmed = draft.trim();
    if (!/^\d+$/.test(trimmed)) {
      setDraft(String(value));
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed < min) {
      setDraft(String(value));
      return;
    }
    setDraft(String(parsed));
    if (parsed !== value) {
      onCommit(parsed);
    }
  };

  return (
    <div className="surface-card rounded-xl p-3 space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-zinc-100">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        step={step}
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        className="h-8.5 w-full rounded-lg border border-white/12 bg-zinc-950/90 px-3 font-mono text-xs tabular-nums text-zinc-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      />
      {helper ? (
        <p className="text-[11px] leading-[1.4] text-zinc-400">{helper}</p>
      ) : null}
    </div>
  );
}

interface SessionPolicySectionProps {
  sessionPolicy: SessionPolicy;
  onChange: (next: SessionPolicy) => void;
}

export function SessionPolicySection({
  sessionPolicy,
  onChange,
}: SessionPolicySectionProps) {
  const [newKind, setNewKind] = useState("");
  const [newKindModel, setNewKindModel] = useState("gemini-4-hydrogen");
  const [newKindThinking, setNewKindThinking] = useState("medium");
  const [kindError, setKindError] = useState<string | null>(null);
  const newKindInputId = useId();

  const update = (patch: Partial<SessionPolicy>) => {
    onChange({
      ...sessionPolicy,
      ...patch,
    });
  };

  const effectiveThinking = effectiveParentThinkingLevel(sessionPolicy);
  const showLaptopDowngradeNote =
    sessionPolicy.hardwareProfile === "laptop-8gb" &&
    (sessionPolicy.parentThinkingLevel === "high" ||
      sessionPolicy.parentThinkingLevel === "xhigh");

  const suggestedAgy = defaultMaxAntigravityForProfile(
    sessionPolicy.hardwareProfile,
  );

  const handleApplySuggestedLimits = () => {
    update({
      maxConcurrentAntigravityWorkers: suggestedAgy,
      maxConcurrentWorkersTotal: suggestedAgy + 1,
      parentThinkingLevel:
        sessionPolicy.hardwareProfile === "laptop-8gb"
          ? "medium"
          : sessionPolicy.parentThinkingLevel,
    });
  };

  const handleUpdateWorkerRule = (
    kind: string,
    patch: Partial<WorkerThinkingRule>,
  ) => {
    const current = sessionPolicy.workerThinkingByKind[kind] ?? {
      model: "gemini-4-hydrogen",
      thinkingLevel: "medium",
    };
    update({
      workerThinkingByKind: {
        ...sessionPolicy.workerThinkingByKind,
        [kind]: { ...current, ...patch },
      },
    });
  };

  const handleRemoveWorkerKind = (kind: string) => {
    const next = { ...sessionPolicy.workerThinkingByKind };
    delete next[kind];
    update({ workerThinkingByKind: next });
  };

  const handleAddWorkerKind = () => {
    const rawTrimmed = newKind.trim();
    const candidate = isValidSafeId(rawTrimmed)
      ? rawTrimmed
      : sanitizeSafeId(rawTrimmed);
    if (!candidate || !isValidSafeId(candidate)) {
      setKindError(
        "Informe um identificador válido (letras, números, '_' ou '-').",
      );
      return;
    }
    if (candidate in sessionPolicy.workerThinkingByKind) {
      setKindError(`O tipo "${candidate}" já existe.`);
      return;
    }
    setKindError(null);
    update({
      workerThinkingByKind: {
        ...sessionPolicy.workerThinkingByKind,
        [candidate]: {
          model: newKindModel,
          thinkingLevel: newKindThinking,
        },
      },
    });
    setNewKind("");
  };

  const workerEntries = Object.entries(sessionPolicy.workerThinkingByKind).sort(
    ([a], [b]) => a.localeCompare(b),
  );

  const hasCustomHardwareProfile = !HARDWARE_PROFILE_OPTIONS.some(
    (opt) => opt.value === sessionPolicy.hardwareProfile,
  );
  const hasCustomParentThinking = !THINKING_LEVEL_OPTIONS.includes(
    sessionPolicy.parentThinkingLevel as (typeof THINKING_LEVEL_OPTIONS)[number],
  );
  const hasCustomDelegateMode = !DELEGATE_MODE_OPTIONS.some(
    (opt) => opt.value === sessionPolicy.delegateMode,
  );
  const hasCustomAcpDead = !ACP_DEAD_OPTIONS.some(
    (opt) => opt.value === sessionPolicy.onAcpSessionDead,
  );

  return (
    <section className="surface-panel rounded-2xl p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-indigo-400/30 bg-indigo-500/15 text-indigo-300">
            <Cpu className="size-3.5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Sessão e hardware (`sessionPolicy`)
            </h3>
            <p className="mt-0.5 text-xs text-zinc-400">
              Limites de concorrência Antigravity, orçamento de turns/tokens do thread pai, thinking por tipo de worker e recuperação de sessões ACP.
            </p>
          </div>
        </div>

        <Button
          variant="secondary"
          size="xs"
          onClick={handleApplySuggestedLimits}
          title={`Aplicar limites recomendados para ${sessionPolicy.hardwareProfile}`}
        >
          <Sparkles className="size-3" aria-hidden="true" />
          <span>Aplicar limites sugeridos ({suggestedAgy} Agy)</span>
        </Button>
      </div>

      {/* Hardware Profile + Parent Thinking Level */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="surface-card rounded-xl p-3.5 space-y-2">
          <label
            htmlFor="session-hardware-profile"
            className="block text-xs font-medium text-zinc-100"
          >
            Perfil de Hardware (`hardwareProfile`)
          </label>
          <Select
            id="session-hardware-profile"
            value={sessionPolicy.hardwareProfile}
            onChange={(e) => update({ hardwareProfile: e.target.value })}
          >
            {HARDWARE_PROFILE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
            {hasCustomHardwareProfile ? (
              <option value={sessionPolicy.hardwareProfile}>
                {sessionPolicy.hardwareProfile}
              </option>
            ) : null}
          </Select>
          <p className="text-[11px] leading-[1.4] text-zinc-400">
            Define o teto seguro de processos Antigravity simultâneos para evitar swap e falhas de ACP.
          </p>
        </div>

        <div className="surface-card rounded-xl p-3.5 space-y-2">
          <label
            htmlFor="session-parent-thinking"
            className="block text-xs font-medium text-zinc-100"
          >
            Thinking do Thread Pai (`parentThinkingLevel`)
          </label>
          <Select
            id="session-parent-thinking"
            value={sessionPolicy.parentThinkingLevel}
            onChange={(e) => update({ parentThinkingLevel: e.target.value })}
          >
            {THINKING_LEVEL_OPTIONS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
            {hasCustomParentThinking ? (
              <option value={sessionPolicy.parentThinkingLevel}>
                {sessionPolicy.parentThinkingLevel}
              </option>
            ) : null}
          </Select>
          {showLaptopDowngradeNote ? (
            <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-200">
              Nota `laptop-8gb`: o compilador rebaixa automaticamente o thinking efetivo do thread pai para{" "}
              <span className="font-mono font-semibold">{effectiveThinking}</span>{" "}
              (em vez de <span className="font-mono">{sessionPolicy.parentThinkingLevel}</span>) para evitar saturação de RAM.
            </p>
          ) : (
            <p className="text-[11px] leading-[1.4] text-zinc-400">
              Nível efetivo compilado: <span className="font-mono text-zinc-200">{effectiveThinking}</span>.
            </p>
          )}
        </div>
      </div>

      {/* Concurrency & Parent Budgets */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NumberField
          id="session-max-agy-workers"
          label="Máx. Workers Antigravity"
          helper="Limite simultâneo de instâncias Agy antes do alerta."
          value={sessionPolicy.maxConcurrentAntigravityWorkers}
          min={1}
          onCommit={(maxConcurrentAntigravityWorkers) =>
            update({ maxConcurrentAntigravityWorkers })
          }
        />
        <NumberField
          id="session-max-total-workers"
          label="Máx. Total de Workers"
          helper="Soma máxima de workers em paralelo por projeto."
          value={sessionPolicy.maxConcurrentWorkersTotal}
          min={1}
          onCommit={(maxConcurrentWorkersTotal) =>
            update({ maxConcurrentWorkersTotal })
          }
        />
        <NumberField
          id="session-parent-max-turns"
          label="Máx. Turns do Pai (Handoff)"
          helper="Acima deste limite o pai vira 'Pai gordo'."
          value={sessionPolicy.parentMaxTurnsBeforeHandoff}
          min={1}
          onCommit={(parentMaxTurnsBeforeHandoff) =>
            update({ parentMaxTurnsBeforeHandoff })
          }
        />
        <NumberField
          id="session-parent-max-items"
          label="Máx. Itens do Pai (Handoff)"
          helper="Itens acumulados antes de sugerir novo thread pai."
          value={sessionPolicy.parentMaxItemsBeforeHandoff}
          min={1}
          onCommit={(parentMaxItemsBeforeHandoff) =>
            update({ parentMaxItemsBeforeHandoff })
          }
        />
        <NumberField
          id="session-parent-warn-tokens"
          label="Alerta de Input Tokens"
          helper="Limiar de aviso no contexto do orquestrador."
          value={sessionPolicy.parentWarnInputTokens}
          min={1000}
          step={1000}
          onCommit={(parentWarnInputTokens) =>
            update({ parentWarnInputTokens })
          }
        />
        <NumberField
          id="session-parent-hard-tokens"
          label="Limite Rígido de Input Tokens"
          helper="Teto rígido antes de exigir handoff de sessão."
          value={sessionPolicy.parentHardInputTokens}
          min={1000}
          step={1000}
          onCommit={(parentHardInputTokens) =>
            update({ parentHardInputTokens })
          }
        />
      </div>

      {/* Delegate Mode & On ACP Session Dead */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="surface-card rounded-xl p-3.5 space-y-2">
          <label
            htmlFor="session-delegate-mode"
            className="block text-xs font-medium text-zinc-100"
          >
            Modo de Delegação (`delegateMode`)
          </label>
          <Select
            id="session-delegate-mode"
            value={sessionPolicy.delegateMode}
            onChange={(e) => update({ delegateMode: e.target.value })}
          >
            {DELEGATE_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
            {hasCustomDelegateMode ? (
              <option value={sessionPolicy.delegateMode}>
                {sessionPolicy.delegateMode}
              </option>
            ) : null}
          </Select>
        </div>

        <div className="surface-card rounded-xl p-3.5 space-y-2">
          <label
            htmlFor="session-on-acp-dead"
            className="block text-xs font-medium text-zinc-100"
          >
            Recuperação ACP Morto (`onAcpSessionDead`)
          </label>
          <Select
            id="session-on-acp-dead"
            value={sessionPolicy.onAcpSessionDead}
            onChange={(e) => update({ onAcpSessionDead: e.target.value })}
          >
            {ACP_DEAD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
            {hasCustomAcpDead ? (
              <option value={sessionPolicy.onAcpSessionDead}>
                {sessionPolicy.onAcpSessionDead}
              </option>
            ) : null}
          </Select>
        </div>
      </div>

      {/* workerThinkingByKind editor */}
      <div className="surface-card rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold text-zinc-100">
              Thinking & Modelo por Tipo de Worker (`workerThinkingByKind`)
            </h4>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              Define o modelo e profundidade de raciocínio por especialidade compilados no `SKILL.md`.
            </p>
          </div>
          <span className="text-[11px] tabular-nums text-zinc-400">
            {workerEntries.length}{" "}
            {workerEntries.length === 1 ? "tipo" : "tipos"}
          </span>
        </div>

        {workerEntries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-center text-[11px] text-zinc-500">
            Nenhum tipo de worker configurado.
          </p>
        ) : (
          <ul className="space-y-2">
            {workerEntries.map(([kind, rule]) => {
              const hasCustomModel = !WORKER_MODEL_OPTIONS.includes(
                rule.model as (typeof WORKER_MODEL_OPTIONS)[number],
              );
              const hasCustomLevel = !THINKING_LEVEL_OPTIONS.includes(
                rule.thinkingLevel as (typeof THINKING_LEVEL_OPTIONS)[number],
              );

              return (
                <li
                  key={kind}
                  className="grid grid-cols-1 items-center gap-2 rounded-lg border border-white/[0.08] bg-zinc-950/70 p-2.5 sm:grid-cols-[minmax(120px,1fr)_minmax(180px,1.4fr)_minmax(110px,0.9fr)_auto]"
                >
                  <div className="min-w-0">
                    <span className="inline-block truncate rounded-md border border-indigo-400/25 bg-indigo-500/10 px-2 py-1 font-mono text-[11px] font-medium text-indigo-200">
                      {kind}
                    </span>
                  </div>

                  <div>
                    <label
                      htmlFor={`worker-kind-model-${kind}`}
                      className="sr-only"
                    >
                      Modelo para {kind}
                    </label>
                    <Select
                      id={`worker-kind-model-${kind}`}
                      sizeVariant="xs"
                      monospace
                      value={rule.model}
                      onChange={(e) =>
                        handleUpdateWorkerRule(kind, { model: e.target.value })
                      }
                    >
                      {WORKER_MODEL_OPTIONS.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                      {hasCustomModel ? (
                        <option value={rule.model}>{rule.model}</option>
                      ) : null}
                    </Select>
                  </div>

                  <div>
                    <label
                      htmlFor={`worker-kind-thinking-${kind}`}
                      className="sr-only"
                    >
                      Thinking para {kind}
                    </label>
                    <Select
                      id={`worker-kind-thinking-${kind}`}
                      sizeVariant="xs"
                      value={rule.thinkingLevel}
                      onChange={(e) =>
                        handleUpdateWorkerRule(kind, {
                          thinkingLevel: e.target.value,
                        })
                      }
                    >
                      {THINKING_LEVEL_OPTIONS.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                      {hasCustomLevel ? (
                        <option value={rule.thinkingLevel}>
                          {rule.thinkingLevel}
                        </option>
                      ) : null}
                    </Select>
                  </div>

                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => handleRemoveWorkerKind(kind)}
                    aria-label={`Remover tipo ${kind}`}
                    className="justify-self-end text-zinc-400 hover:bg-rose-500/15 hover:text-rose-300"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Add new kind row */}
        <div className="pt-1 space-y-1.5">
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(120px,1fr)_minmax(180px,1.4fr)_minmax(110px,0.9fr)_auto]">
            <div>
              <label htmlFor={newKindInputId} className="sr-only">
                Novo tipo de worker
              </label>
              <input
                id={newKindInputId}
                type="text"
                value={newKind}
                onChange={(e) => {
                  setNewKind(e.target.value);
                  if (kindError) setKindError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddWorkerKind();
                  }
                }}
                placeholder="Novo tipo (ex: security)"
                className="h-7 w-full rounded-lg border border-white/12 bg-zinc-950/90 px-2.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              />
            </div>

            <div>
              <label htmlFor="worker-kind-new-model" className="sr-only">
                Modelo do novo tipo
              </label>
              <Select
                id="worker-kind-new-model"
                sizeVariant="xs"
                monospace
                value={newKindModel}
                onChange={(e) => setNewKindModel(e.target.value)}
              >
                {WORKER_MODEL_OPTIONS.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label htmlFor="worker-kind-new-thinking" className="sr-only">
                Thinking do novo tipo
              </label>
              <Select
                id="worker-kind-new-thinking"
                sizeVariant="xs"
                value={newKindThinking}
                onChange={(e) => setNewKindThinking(e.target.value)}
              >
                {THINKING_LEVEL_OPTIONS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </Select>
            </div>

            <Button
              variant="secondary"
              size="xs"
              onClick={handleAddWorkerKind}
              className="shrink-0"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span>Adicionar tipo</span>
            </Button>
          </div>
          {kindError ? (
            <p className="text-[11px] text-rose-300">{kindError}</p>
          ) : null}
        </div>
      </div>

      {/* forbiddenPatterns */}
      <StringListEditor
        label="Padrões Proibidos (forbiddenPatterns)"
        items={sessionPolicy.forbiddenPatterns}
        placeholder="ex: thinking high no pai"
        helperText="Regras negativas compiladas no SKILL.md"
        displayMode="chips"
        chipTone="rose"
        onChange={(forbiddenPatterns) => update({ forbiddenPatterns })}
      />
    </section>
  );
}
