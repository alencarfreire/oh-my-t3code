import { useId, useState } from "react";
import { Cpu, SlidersHorizontal, Sparkles } from "lucide-react";
import { KeyValueEditor } from "./KeyValueEditor";
import { Select } from "./Select";
import {
  getModelsForInstance,
  getOptionSpecsForInstance,
  normalizeOptionsForInstance,
  resolveInstanceShortLabel,
} from "../../lib/preset-utils";
import type { ProviderInstanceInfo } from "../../types/ipc";

interface ModelRoutingFieldsProps {
  instanceId: string;
  model: string;
  options: Record<string, string>;
  providerInstances: ProviderInstanceInfo[];
  instanceSelectId?: string;
  modelSelectId?: string;
  instanceLabel?: string;
  modelLabel?: string;
  optionsLabel?: string;
  compact?: boolean;
  onChange: (patch: {
    providerInstanceId: string;
    model: string;
    options: Record<string, string>;
  }) => void;
}

export function ModelRoutingFields({
  instanceId,
  model,
  options,
  providerInstances,
  instanceSelectId,
  modelSelectId,
  instanceLabel = "Instância (`providerInstanceId`)",
  modelLabel = "Modelo (`model`)",
  optionsLabel = "Opções do Modelo",
  compact = false,
  onChange,
}: ModelRoutingFieldsProps) {
  const autoInstanceId = useId();
  const autoModelId = useId();
  const customModelInputId = useId();
  const resolvedInstanceSelectId = instanceSelectId ?? autoInstanceId;
  const resolvedModelSelectId = modelSelectId ?? autoModelId;

  const [customModelMode, setCustomModelMode] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);

  const models = getModelsForInstance(instanceId, providerInstances);
  const optionSpecs = getOptionSpecsForInstance(instanceId, providerInstances);

  const handleInstanceChange = (nextInstanceId: string) => {
    const nextModels = getModelsForInstance(nextInstanceId, providerInstances);
    const nextModel = nextModels.includes(model)
      ? model
      : (nextModels[0] ?? model);
    const nextOptions = normalizeOptionsForInstance(
      nextInstanceId,
      options,
      providerInstances,
    );
    onChange({
      providerInstanceId: nextInstanceId,
      model: nextModel,
      options: nextOptions,
    });
  };

  const handleOptionPillSelect = (key: string, value: string) => {
    onChange({
      providerInstanceId: instanceId,
      model,
      options: {
        ...options,
        [key]: value,
      },
    });
  };

  const extraOptionKeys = Object.keys(options).filter(
    (k) => !optionSpecs.some((spec) => spec.key === k),
  );

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <div>
          <label
            htmlFor={resolvedInstanceSelectId}
            className="flex items-center gap-1.5 text-xs font-medium text-zinc-200"
          >
            <Cpu className="size-3.5 text-zinc-400" aria-hidden="true" />
            <span>{instanceLabel}</span>
          </label>
          <Select
            id={resolvedInstanceSelectId}
            value={instanceId}
            onChange={(e) => handleInstanceChange(e.target.value)}
            wrapperClassName="mt-1.5"
          >
            {providerInstances.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.label}
                {inst.configured ? "" : " (não configurado)"}
              </option>
            ))}
          </Select>

          {/* 1-Click Instance Quick Chips for configured primary instances */}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {providerInstances
              .filter((inst) => inst.configured || inst.id === instanceId)
              .map((inst) => {
                const active = inst.id === instanceId;
                return (
                  <button
                    key={inst.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleInstanceChange(inst.id)}
                    className={[
                      "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out",
                      "enabled:active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                      active
                        ? "border-indigo-400/50 bg-indigo-500/20 text-indigo-200"
                        : "border-white/10 bg-zinc-950/70 text-zinc-400 hover:border-white/20 hover:text-zinc-200",
                    ].join(" ")}
                  >
                    {resolveInstanceShortLabel(inst.id, providerInstances)}
                  </button>
                );
              })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={customModelMode ? customModelInputId : resolvedModelSelectId}
              className="flex items-center gap-1.5 text-xs font-medium text-zinc-200"
            >
              <Sparkles className="size-3.5 text-amber-300/90" aria-hidden="true" />
              <span>{modelLabel}</span>
            </label>
            <button
              type="button"
              onClick={() => setCustomModelMode((v) => !v)}
              className="text-[11px] font-medium text-zinc-400 transition-colors hover:text-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded px-1"
            >
              {customModelMode ? "Usar lista" : "Custom"}
            </button>
          </div>

          {customModelMode ? (
            <input
              id={customModelInputId}
              type="text"
              value={model}
              onChange={(e) =>
                onChange({
                  providerInstanceId: instanceId,
                  model: e.target.value,
                  options,
                })
              }
              placeholder="ex: gemini-4-hydrogen"
              className="mt-1.5 h-8.5 w-full rounded-lg border border-white/12 bg-zinc-950/90 px-3 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            />
          ) : (
            <Select
              id={resolvedModelSelectId}
              value={model}
              monospace
              onChange={(e) =>
                onChange({
                  providerInstanceId: instanceId,
                  model: e.target.value,
                  options,
                })
              }
              wrapperClassName="mt-1.5"
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              {!models.includes(model) ? <option value={model}>{model}</option> : null}
            </Select>
          )}

          {/* 1-Click Model Quick-Picks */}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {models.map((m) => {
              const active = m === model;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setCustomModelMode(false);
                    onChange({
                      providerInstanceId: instanceId,
                      model: m,
                      options,
                    });
                  }}
                  className={[
                    "rounded-md border px-2 py-0.5 font-mono text-[10px] transition-[background-color,border-color,color,transform] duration-150 ease-out",
                    "enabled:active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                    active
                      ? "border-amber-400/45 bg-amber-500/15 text-amber-200"
                      : "border-white/10 bg-zinc-950/70 text-zinc-400 hover:border-white/20 hover:text-zinc-200",
                  ].join(" ")}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 1-Click Provider Option Pills + Collapsible Advanced Key/Value */}
      <div className="rounded-xl border border-white/8 bg-zinc-950/65 p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-zinc-300">
            {optionsLabel}
          </span>
          <button
            type="button"
            aria-expanded={showAdvancedOptions}
            onClick={() => setShowAdvancedOptions((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <SlidersHorizontal className="size-3" aria-hidden="true" />
            {showAdvancedOptions
              ? "Ocultar chave/valor"
              : extraOptionKeys.length > 0
                ? `Avançado (+${extraOptionKeys.length})`
                : "Avançado"}
          </button>
        </div>

        {optionSpecs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-4">
            {optionSpecs.map((spec) => {
              const currentValue =
                options[spec.key] ??
                (spec.key === "thinking_level" ? options.thinkingLevel : undefined) ??
                "";

              return (
                <div key={spec.key} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-zinc-400">
                    {spec.label}:
                  </span>
                  <div
                    role="group"
                    aria-label={`${spec.label} para ${resolveInstanceShortLabel(instanceId, providerInstances)}`}
                    className="inline-flex items-center rounded-lg border border-white/10 bg-zinc-900/90 p-0.5"
                  >
                    {spec.values.map((val) => {
                      const active = currentValue === val;
                      return (
                        <button
                          key={val}
                          type="button"
                          aria-pressed={active}
                          onClick={() => handleOptionPillSelect(spec.key, val)}
                          className={[
                            "rounded-md px-2 py-0.5 font-mono text-[11px] font-medium transition-[background-color,color,transform] duration-150 ease-out",
                            "enabled:active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                            active
                              ? "bg-indigo-500 text-white shadow-xs"
                              : "text-zinc-400 hover:text-zinc-200",
                          ].join(" ")}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-zinc-400">
            Use o editor avançado para definir parâmetros específicos deste provedor.
          </p>
        )}

        {showAdvancedOptions || optionSpecs.length === 0 ? (
          <div className="pt-2 border-t border-white/8">
            <KeyValueEditor
              label="Parâmetros personalizados (key / value)"
              entries={options}
              onChange={(nextOptions) =>
                onChange({
                  providerInstanceId: instanceId,
                  model,
                  options: nextOptions,
                })
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
