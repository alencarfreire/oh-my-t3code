import { ShieldAlert } from "lucide-react";
import { KeyValueEditor } from "../ui/KeyValueEditor";
import { StringListEditor } from "../ui/StringListEditor";
import type { ContentionPolicy, PresetConfig } from "../../types/ipc";

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

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-4">
        <div className="flex items-start gap-2.5">
          <ShieldAlert
            className="mt-0.5 size-4 shrink-0 text-amber-300"
            aria-hidden="true"
          />
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
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-zinc-950/75 p-3">
            <input
              type="checkbox"
              checked={preset.contention.singleTestDb}
              onChange={(e) =>
                updateContention({ singleTestDb: e.target.checked })
              }
              className="mt-0.5 size-4 rounded border-white/20 bg-zinc-900 text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            />
            <div>
              <div className="text-xs font-medium text-zinc-100">
                Banco de Testes Único (`singleTestDb`)
              </div>
              <p className="mt-0.5 text-[11px] text-zinc-400">
                Serializa suítes de testes (ex: RSpec/SQLite) para impedir locks entre workers paralelos.
              </p>
            </div>
          </label>

          <div className="rounded-xl border border-white/10 bg-zinc-950/75 p-3">
            <label
              htmlFor="contention-isolation-select"
              className="block text-xs font-medium text-zinc-100"
            >
              Isolamento Padrão (`defaultIsolation`)
            </label>
            <select
              id="contention-isolation-select"
              value={preset.contention.defaultIsolation}
              onChange={(e) =>
                updateContention({ defaultIsolation: e.target.value })
              }
              className="mt-2 w-full rounded-lg border border-white/12 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <option value="shared">
                shared — Ondas sequenciais no mesmo workspace
              </option>
              <option value="worktree">
                worktree — Git worktrees isolados para frentes paralelas
              </option>
            </select>
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
            onChange={(gitIgnoredBuilds) =>
              updateContention({ gitIgnoredBuilds })
            }
          />
          <StringListEditor
            label="Arquivos de Alta Contenção (`conflictFiles`)"
            items={preset.contention.conflictFiles}
            placeholder="ex: package.json, Cargo.toml"
            monospace
            onChange={(conflictFiles) => updateContention({ conflictFiles })}
          />
        </div>
      </section>
    </div>
  );
}
