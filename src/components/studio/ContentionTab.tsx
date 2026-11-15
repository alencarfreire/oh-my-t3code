import { ShieldAlert } from "lucide-react";
import { createDefaultSessionPolicy } from "../../lib/preset-utils";
import { KeyValueEditor } from "../ui/KeyValueEditor";
import { Select } from "../ui/Select";
import { StringListEditor } from "../ui/StringListEditor";
import type { ContentionPolicy, PresetConfig } from "../../types/ipc";
import { SessionPolicySection } from "./SessionPolicySection";

interface ContentionTabProps {
  preset: PresetConfig;
  onChange: (next: PresetConfig) => void;
}

export function ContentionTab({ preset, onChange }: ContentionTabProps) {
  const updateContention = (patch: Partial<ContentionPolicy>) => {
    onChange({
      ...preset,
      contention: {
        ...preset.contention,
        ...patch,
      },
    });
  };

  const sessionPolicy = preset.sessionPolicy ?? createDefaultSessionPolicy();

  return (
    <div className="space-y-5">
      <SessionPolicySection
        sessionPolicy={sessionPolicy}
        onChange={(nextSessionPolicy) =>
          onChange({
            ...preset,
            sessionPolicy: nextSessionPolicy,
          })
        }
      />

      <section className="surface-panel rounded-2xl p-5 space-y-5">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-amber-400/30 bg-amber-500/15 text-amber-300">
            <ShieldAlert className="size-3.5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Política de Contenção & Isolamento (`contention`)
            </h3>
            <p className="mt-0.5 text-xs text-zinc-400">
              Previne conflitos de escrita paralela, locks de banco de testes e colisões em arquivos de manifesto.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="surface-card flex cursor-pointer items-start gap-3 rounded-xl p-3.5 transition-colors hover:bg-zinc-900/90">
            <input
              type="checkbox"
              checked={preset.contention.singleTestDb}
              onChange={(e) =>
                updateContention({ singleTestDb: e.target.checked })
              }
              className="mt-0.5 size-4 rounded border-white/20 bg-zinc-900 accent-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            />
            <div>
              <div className="text-xs font-medium text-zinc-100">
                Banco de Testes Único (`singleTestDb`)
              </div>
              <p className="mt-0.5 text-[11px] leading-[1.4] text-zinc-400">
                Serializa suítes de testes (ex: RSpec/SQLite) para impedir locks entre workers paralelos.
              </p>
            </div>
          </label>

          <div className="surface-card rounded-xl p-3.5">
            <label
              htmlFor="contention-isolation-select"
              className="block text-xs font-medium text-zinc-100"
            >
              Isolamento Padrão (`defaultIsolation`)
            </label>
            <Select
              id="contention-isolation-select"
              value={preset.contention.defaultIsolation}
              onChange={(e) =>
                updateContention({ defaultIsolation: e.target.value })
              }
              wrapperClassName="mt-2"
            >
              <option value="shared">
                shared — Ondas sequenciais no mesmo workspace
              </option>
              <option value="worktree">
                worktree — Git worktrees isolados para frentes paralelas
              </option>
            </Select>
          </div>
        </div>

        <KeyValueEditor
          label="Variáveis de Ambiente Obrigatórias (`envVars`, ex: PARALLEL_WORKERS=1)"
          entries={preset.contention.envVars}
          keyPlaceholder="Chave (ex: PARALLEL_WORKERS)"
          valuePlaceholder="Valor (ex: 1)"
          onChange={(envVars) => updateContention({ envVars })}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <StringListEditor
            label="Artefatos de Build Fora do Git (`gitIgnoredBuilds`)"
            items={preset.contention.gitIgnoredBuilds}
            placeholder="ex: target/, dist/, tmp/"
            monospace
            displayMode="chips"
            onChange={(gitIgnoredBuilds) =>
              updateContention({ gitIgnoredBuilds })
            }
          />
          <StringListEditor
            label="Arquivos de Alta Contenção (`conflictFiles`)"
            items={preset.contention.conflictFiles}
            placeholder="ex: package.json, Cargo.toml"
            monospace
            displayMode="chips"
            chipTone="rose"
            onChange={(conflictFiles) => updateContention({ conflictFiles })}
          />
        </div>
      </section>
    </div>
  );
}
