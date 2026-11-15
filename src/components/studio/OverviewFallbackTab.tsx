import {
  ArrowDown,
  ArrowUp,
  Cpu,
  GitBranch,
  Layers,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge, getInstanceBadgeTone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ModelRoutingFields } from "../ui/ModelRoutingFields";
import { Select } from "../ui/Select";
import {
  createDefaultFallbackStep,
  formatPrimaryOptionSummary,
  resolveInstanceShortLabel,
} from "../../lib/preset-utils";
import type {
  FallbackStep,
  PresetConfig,
  ProviderInstanceInfo,
} from "../../types/ipc";

interface OverviewFallbackTabProps {
  preset: PresetConfig;
  globalPresets: PresetConfig[];
  providerInstances: ProviderInstanceInfo[];
  onChange: (next: PresetConfig) => void;
}

export function OverviewFallbackTab({
  preset,
  globalPresets,
  providerInstances,
  onChange,
}: OverviewFallbackTabProps) {
  const availableParents = globalPresets.filter((g) => g.id !== preset.id);

  const updateOrchestrator = (
    patch: Partial<PresetConfig["orchestrator"]>,
  ) => {
    onChange({
      ...preset,
      orchestrator: {
        ...preset.orchestrator,
        ...patch,
      },
    });
  };

  const updateFallbackStep = (idx: number, patch: Partial<FallbackStep>) => {
    const nextChain = preset.fallbackChain.map((step, i) =>
      i === idx ? { ...step, ...patch } : step,
    );
    onChange({ ...preset, fallbackChain: nextChain });
  };

  const moveFallbackStep = (idx: number, direction: -1 | 1) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= preset.fallbackChain.length) return;
    const copy = [...preset.fallbackChain];
    const [removed] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, removed);
    onChange({ ...preset, fallbackChain: copy });
  };

  const removeFallbackStep = (idx: number) => {
    onChange({
      ...preset,
      fallbackChain: preset.fallbackChain.filter((_, i) => i !== idx),
    });
  };

  const addFallbackStep = () => {
    onChange({
      ...preset,
      fallbackChain: [...preset.fallbackChain, createDefaultFallbackStep()],
    });
  };

  const orchOptSummary = formatPrimaryOptionSummary(preset.orchestrator.options);

  return (
    <div className="space-y-6">
      {/* Identity & Inheritance */}
      <section className="surface-panel rounded-2xl p-5 space-y-4">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-zinc-900 text-indigo-300">
            <Layers className="size-3.5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Identidade, Herança (`extends`) & Topologia
            </h3>
            <p className="mt-0.5 text-xs text-zinc-400">
              Defina metadados do preset e se ele herda regras de um Preset Global base.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="preset-name-input"
              className="block text-xs font-medium text-zinc-200"
            >
              Nome do Preset
            </label>
            <input
              id="preset-name-input"
              type="text"
              value={preset.name}
              onChange={(e) => onChange({ ...preset, name: e.target.value })}
              className="mt-1.5 h-8.5 w-full rounded-lg border border-white/12 bg-zinc-950/90 px-3 text-xs text-zinc-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            />
          </div>

          <div>
            <label
              htmlFor="preset-id-readonly"
              className="block text-xs font-medium text-zinc-200"
            >
              Identificador (`id`)
            </label>
            <input
              id="preset-id-readonly"
              type="text"
              value={preset.id}
              readOnly
              className="mt-1.5 h-8.5 w-full rounded-lg border border-white/8 bg-zinc-950/55 px-3 font-mono text-xs text-zinc-400"
            />
          </div>

          <div>
            <label
              htmlFor="preset-extends-select"
              className="block text-xs font-medium text-zinc-200"
            >
              Herda de (`extends`)
            </label>
            <Select
              id="preset-extends-select"
              value={preset.extends ?? ""}
              onChange={(e) =>
                onChange({
                  ...preset,
                  extends: e.target.value ? e.target.value : null,
                })
              }
              wrapperClassName="mt-1.5"
            >
              <option value="">Nenhum (Base)</option>
              {availableParents.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.id} — {parent.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label
              htmlFor="preset-topology-select"
              className="block text-xs font-medium text-zinc-200"
            >
              Topologia da Squad
            </label>
            <Select
              id="preset-topology-select"
              value={preset.topology}
              onChange={(e) => onChange({ ...preset, topology: e.target.value })}
              wrapperClassName="mt-1.5"
            >
              <option value="intra-thread-squad">
                intra-thread-squad (Workers via delegate_task)
              </option>
              <option value="issue-thread-orchestrator">
                issue-thread-orchestrator (Orquestração por threads/issues)
              </option>
            </Select>
          </div>
        </div>

        <div>
          <label
            htmlFor="preset-description-input"
            className="block text-xs font-medium text-zinc-200"
          >
            Descrição
          </label>
          <textarea
            id="preset-description-input"
            rows={2}
            value={preset.description}
            onChange={(e) => onChange({ ...preset, description: e.target.value })}
            className="mt-1.5 w-full rounded-lg border border-white/12 bg-zinc-950/90 px-3 py-2 text-xs leading-relaxed text-zinc-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          />
        </div>
      </section>

      {/* Orchestrator Config */}
      <section className="surface-panel rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-indigo-400/30 bg-indigo-500/15 text-indigo-300">
              <Cpu className="size-3.5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">
                Orquestrador Primário (`settings.json` Override)
              </h3>
              <p className="mt-0.5 text-xs text-zinc-400">
                Modelo e instância aplicados como `defaultModelSelection` do projeto no T3 Code.
              </p>
            </div>
          </div>

          <Badge tone={getInstanceBadgeTone(preset.orchestrator.providerInstanceId)}>
            {resolveInstanceShortLabel(
              preset.orchestrator.providerInstanceId,
              providerInstances,
            )}{" "}
            · {preset.orchestrator.model}
            {orchOptSummary ? ` (${orchOptSummary})` : ""}
          </Badge>
        </div>

        <ModelRoutingFields
          instanceId={preset.orchestrator.providerInstanceId}
          model={preset.orchestrator.model}
          options={preset.orchestrator.options}
          providerInstances={providerInstances}
          instanceSelectId="orch-instance-select"
          modelSelectId="orch-model-select"
          optionsLabel="Opções do Orquestrador (1-clique)"
          onChange={(patch) => updateOrchestrator(patch)}
        />
      </section>

      {/* Visual Connected Fallback Pipeline */}
      <section className="surface-panel rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-amber-400/30 bg-amber-500/15 text-amber-300">
              <GitBranch className="size-3.5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">
                Pipeline Visual de Fallback (`fallbackChain`)
              </h3>
              <p className="mt-0.5 text-xs text-zinc-400">
                Ordem determinística de transbordo quando cota ou disponibilidade falhar.
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={addFallbackStep}>
            <Plus className="size-3.5" aria-hidden="true" />
            Adicionar Passo
          </Button>
        </div>

        {/* Visual Origin Node (Primary Orchestrator) */}
        <div className="relative ps-8">
          <div
            aria-hidden="true"
            className="absolute start-3 top-6 bottom-0 w-px bg-gradient-to-b from-indigo-400/60 via-white/15 to-transparent"
          />
          <div
            aria-hidden="true"
            className="absolute start-1 top-2 flex size-4.5 items-center justify-center rounded-full border border-indigo-400/60 bg-indigo-500/25 shadow-[0_0_10px_rgba(99,102,241,0.4)]"
          >
            <span className="size-1.5 rounded-full bg-indigo-300" />
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-400/25 bg-indigo-500/[0.08] px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-indigo-200">
                Orquestrador Primário
              </span>
              <span className="text-zinc-500">➔</span>
              <span className="font-mono text-zinc-200">
                {resolveInstanceShortLabel(
                  preset.orchestrator.providerInstanceId,
                  providerInstances,
                )}{" "}
                / {preset.orchestrator.model}
              </span>
            </div>
            <span className="text-[11px] text-zinc-400 tabular-nums">
              {preset.fallbackChain.length}{" "}
              {preset.fallbackChain.length === 1 ? "nível de fallback" : "níveis de fallback"}
            </span>
          </div>

          {preset.fallbackChain.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/12 px-4 py-5 text-center text-xs text-zinc-400">
              Nenhum nível de fallback configurado.
            </div>
          ) : (
            <ol className="space-y-3">
              {preset.fallbackChain.map((step, idx) => {
                const isLast = idx === preset.fallbackChain.length - 1;
                const stepOptSummary = formatPrimaryOptionSummary(step.options);

                return (
                  <li
                    key={`${step.providerInstanceId}-${step.model}-${idx}`}
                    className="relative"
                  >
                    {/* Pipeline connector mask on last step */}
                    {isLast ? (
                      <div
                        aria-hidden="true"
                        className="absolute -start-5 top-5 bottom-0 w-px bg-[#111114]"
                      />
                    ) : null}

                    {/* Step Node Number */}
                    <span
                      aria-hidden="true"
                      className="absolute -start-7.5 top-3.5 flex size-5 items-center justify-center rounded-full border border-white/20 bg-zinc-900 font-mono text-[10px] font-semibold text-zinc-200 tabular-nums shadow-xs"
                    >
                      {idx + 1}
                    </span>

                    <div className="surface-card rounded-xl p-3.5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-indigo-300 tabular-nums">
                            Nível {idx + 1}
                          </span>
                          <Badge tone={getInstanceBadgeTone(step.providerInstanceId)}>
                            {resolveInstanceShortLabel(
                              step.providerInstanceId,
                              providerInstances,
                            )}
                          </Badge>
                          <span className="font-mono text-[11px] text-zinc-300">
                            {step.model}
                            {stepOptSummary ? ` (${stepOptSummary})` : ""}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={idx === 0}
                            onClick={() => moveFallbackStep(idx, -1)}
                            aria-label={`Subir Nível ${idx + 1}`}
                          >
                            <ArrowUp className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={isLast}
                            onClick={() => moveFallbackStep(idx, 1)}
                            aria-label={`Descer Nível ${idx + 1}`}
                          >
                            <ArrowDown className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="danger"
                            size="xs"
                            onClick={() => removeFallbackStep(idx)}
                            aria-label={`Remover Nível ${idx + 1}`}
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>

                      <ModelRoutingFields
                        compact
                        instanceId={step.providerInstanceId}
                        model={step.model}
                        options={step.options}
                        providerInstances={providerInstances}
                        instanceSelectId={`fb-inst-${idx}`}
                        modelSelectId={`fb-model-${idx}`}
                        instanceLabel="Instância"
                        modelLabel="Modelo"
                        optionsLabel={`Opções do Nível ${idx + 1}`}
                        onChange={(patch) => updateFallbackStep(idx, patch)}
                      />

                      <div>
                        <label
                          htmlFor={`fb-reason-${idx}`}
                          className="block text-[11px] font-medium text-zinc-300"
                        >
                          Motivo / Regra de Acionamento
                        </label>
                        <input
                          id={`fb-reason-${idx}`}
                          type="text"
                          value={step.reason}
                          onChange={(e) =>
                            updateFallbackStep(idx, { reason: e.target.value })
                          }
                          className="mt-1 h-8 w-full rounded-lg border border-white/12 bg-zinc-950/90 px-2.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
