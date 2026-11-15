import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { KeyValueEditor } from "../ui/KeyValueEditor";
import {
  createDefaultFallbackStep,
  getModelsForInstance,
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
  const orchestratorModels = getModelsForInstance(
    preset.orchestrator.providerInstanceId,
    providerInstances,
  );

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

  const handleOrchestratorInstanceChange = (instanceId: string) => {
    const models = getModelsForInstance(instanceId, providerInstances);
    const nextModel = models.includes(preset.orchestrator.model)
      ? preset.orchestrator.model
      : (models[0] ?? preset.orchestrator.model);
    updateOrchestrator({ providerInstanceId: instanceId, model: nextModel });
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

  return (
    <div className="space-y-6">
      {/* Identity & Inheritance */}
      <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">
            Identidade, Herança (`extends`) & Topologia
          </h3>
          <p className="mt-0.5 text-xs text-zinc-400">
            Defina metadados do preset e se ele herda regras de um Preset Global base.
          </p>
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
              className="mt-1.5 w-full rounded-lg border border-white/12 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
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
              className="mt-1.5 w-full rounded-lg border border-white/8 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-400"
            />
          </div>

          <div>
            <label
              htmlFor="preset-extends-select"
              className="block text-xs font-medium text-zinc-200"
            >
              Herda de (`extends`)
            </label>
            <select
              id="preset-extends-select"
              value={preset.extends ?? ""}
              onChange={(e) =>
                onChange({
                  ...preset,
                  extends: e.target.value ? e.target.value : null,
                })
              }
              className="mt-1.5 w-full rounded-lg border border-white/12 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <option value="">Nenhum (Base)</option>
              {availableParents.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.id} — {parent.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="preset-topology-select"
              className="block text-xs font-medium text-zinc-200"
            >
              Topologia da Squad
            </label>
            <select
              id="preset-topology-select"
              value={preset.topology}
              onChange={(e) => onChange({ ...preset, topology: e.target.value })}
              className="mt-1.5 w-full rounded-lg border border-white/12 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <option value="intra-thread-squad">
                intra-thread-squad (Workers via delegate_task)
              </option>
              <option value="issue-thread-orchestrator">
                issue-thread-orchestrator (Orquestração por threads/issues)
              </option>
            </select>
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
            className="mt-1.5 w-full rounded-lg border border-white/12 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          />
        </div>
      </section>

      {/* Orchestrator Config */}
      <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">
            Orquestrador Primário (`settings.json` Override)
          </h3>
          <p className="mt-0.5 text-xs text-zinc-400">
            Modelo e instância aplicados como `defaultModelSelection` do projeto no T3 Code.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="orch-instance-select"
              className="block text-xs font-medium text-zinc-200"
            >
              Instância do Provedor (`providerInstanceId`)
            </label>
            <select
              id="orch-instance-select"
              value={preset.orchestrator.providerInstanceId}
              onChange={(e) => handleOrchestratorInstanceChange(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-white/12 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {providerInstances.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="orch-model-select"
              className="block text-xs font-medium text-zinc-200"
            >
              Modelo (`model`)
            </label>
            <select
              id="orch-model-select"
              value={preset.orchestrator.model}
              onChange={(e) => updateOrchestrator({ model: e.target.value })}
              className="mt-1.5 w-full rounded-lg border border-white/12 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {orchestratorModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              {!orchestratorModels.includes(preset.orchestrator.model) ? (
                <option value={preset.orchestrator.model}>
                  {preset.orchestrator.model}
                </option>
              ) : null}
            </select>
          </div>
        </div>

        <KeyValueEditor
          label="Opções do Orquestrador (ex: thinkingLevel, reasoningEffort)"
          entries={preset.orchestrator.options}
          onChange={(options) => updateOrchestrator({ options })}
        />
      </section>

      {/* Fallback Chain Editor */}
      <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Cadeia de Fallback (`fallbackChain`)
            </h3>
            <p className="mt-0.5 text-xs text-zinc-400">
              Ordem determinística de transbordo quando cota ou disponibilidade falhar.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={addFallbackStep}>
            <Plus className="size-3.5" aria-hidden="true" />
            Adicionar Passo
          </Button>
        </div>

        {preset.fallbackChain.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/12 px-4 py-5 text-center text-xs text-zinc-400">
            Nenhum nível de fallback configurado.
          </div>
        ) : (
          <ol className="space-y-3">
            {preset.fallbackChain.map((step, idx) => {
              const stepModels = getModelsForInstance(
                step.providerInstanceId,
                providerInstances,
              );
              return (
                <li
                  key={`${step.providerInstanceId}-${step.model}-${idx}`}
                  className="rounded-xl border border-white/10 bg-zinc-950/80 p-3 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
                      Nível {idx + 1}
                    </span>

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
                        disabled={idx === preset.fallbackChain.length - 1}
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

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <label
                        htmlFor={`fb-inst-${idx}`}
                        className="block text-[11px] font-medium text-zinc-300"
                      >
                        Instância
                      </label>
                      <select
                        id={`fb-inst-${idx}`}
                        value={step.providerInstanceId}
                        onChange={(e) => {
                          const inst = e.target.value;
                          const ms = getModelsForInstance(inst, providerInstances);
                          updateFallbackStep(idx, {
                            providerInstanceId: inst,
                            model: ms.includes(step.model)
                              ? step.model
                              : (ms[0] ?? step.model),
                          });
                        }}
                        className="mt-1 w-full rounded-lg border border-white/12 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      >
                        {providerInstances.map((inst) => (
                          <option key={inst.id} value={inst.id}>
                            {inst.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`fb-model-${idx}`}
                        className="block text-[11px] font-medium text-zinc-300"
                      >
                        Modelo
                      </label>
                      <select
                        id={`fb-model-${idx}`}
                        value={step.model}
                        onChange={(e) =>
                          updateFallbackStep(idx, { model: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-white/12 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      >
                        {stepModels.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                        {!stepModels.includes(step.model) ? (
                          <option value={step.model}>{step.model}</option>
                        ) : null}
                      </select>
                    </div>
                  </div>

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
                      className="mt-1 w-full rounded-lg border border-white/12 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    />
                  </div>

                  <KeyValueEditor
                    label={`Opções do Nível ${idx + 1}`}
                    entries={step.options}
                    onChange={(options) => updateFallbackStep(idx, { options })}
                  />
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
