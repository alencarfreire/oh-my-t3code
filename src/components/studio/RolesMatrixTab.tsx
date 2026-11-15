import { useState } from "react";
import { Plus, Trash2, UserCog } from "lucide-react";
import { Badge, getInstanceBadgeTone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { KeyValueEditor } from "../ui/KeyValueEditor";
import { StringListEditor } from "../ui/StringListEditor";
import {
  COMMON_ROLE_TEMPLATES,
  createEmptyRole,
  getModelsForInstance,
  isValidSafeId,
  resolveInstanceShortLabel,
  sanitizeSafeId,
} from "../../lib/preset-utils";
import type {
  PresetConfig,
  ProviderInstanceInfo,
  RoleConfig,
} from "../../types/ipc";

interface RolesMatrixTabProps {
  preset: PresetConfig;
  selectedRoleId: string | null;
  providerInstances: ProviderInstanceInfo[];
  onSelectRole: (roleId: string | null) => void;
  onChange: (next: PresetConfig) => void;
}

export function RolesMatrixTab({
  preset,
  selectedRoleId,
  providerInstances,
  onSelectRole,
  onChange,
}: RolesMatrixTabProps) {
  const [addingRole, setAddingRole] = useState(false);
  const [newRoleId, setNewRoleId] = useState("");
  const [roleError, setRoleError] = useState<string | null>(null);

  const roleEntries = Object.entries(preset.roles).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const activeRole =
    (selectedRoleId && preset.roles[selectedRoleId]) ||
    roleEntries[0]?.[1] ||
    null;

  const updateRole = (roleId: string, patch: Partial<RoleConfig>) => {
    const current = preset.roles[roleId];
    if (!current) return;
    onChange({
      ...preset,
      roles: {
        ...preset.roles,
        [roleId]: { ...current, ...patch },
      },
    });
  };

  const handleAddRole = (rawId: string) => {
    const cleaned = sanitizeSafeId(rawId);
    if (!isValidSafeId(cleaned)) {
      setRoleError("ID inválido. Use apenas [a-z0-9_-].");
      return;
    }
    if (preset.roles[cleaned]) {
      onSelectRole(cleaned);
      setAddingRole(false);
      setNewRoleId("");
      setRoleError(null);
      return;
    }
    const created = createEmptyRole(cleaned);
    onChange({
      ...preset,
      roles: {
        ...preset.roles,
        [cleaned]: created,
      },
    });
    onSelectRole(cleaned);
    setAddingRole(false);
    setNewRoleId("");
    setRoleError(null);
  };

  const handleDeleteRole = (roleId: string) => {
    const nextRoles = { ...preset.roles };
    delete nextRoles[roleId];
    onChange({ ...preset, roles: nextRoles });
    const remaining = Object.keys(nextRoles).sort();
    onSelectRole(remaining[0] ?? null);
  };

  const suggestedRoles = Object.keys(COMMON_ROLE_TEMPLATES).filter(
    (id) => !preset.roles[id],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Left column: Role list */}
      <div className="lg:col-span-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Papéis (`roles/`)
          </h3>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => {
              setAddingRole((v) => !v);
              setRoleError(null);
            }}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Adicionar Papel
          </Button>
        </div>

        {addingRole ? (
          <div className="rounded-xl border border-indigo-500/30 bg-zinc-900/90 p-3 space-y-2.5">
            <div className="space-y-1">
              <label
                htmlFor="new-role-id-input"
                className="block text-[11px] font-medium text-zinc-300"
              >
                ID do Novo Papel
              </label>
              <div className="flex gap-1.5">
                <input
                  id="new-role-id-input"
                  type="text"
                  value={newRoleId}
                  onChange={(e) => setNewRoleId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddRole(newRoleId);
                    }
                  }}
                  placeholder="ex: rust-core, crystal, fixer"
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                />
                <Button
                  variant="primary"
                  size="xs"
                  onClick={() => handleAddRole(newRoleId)}
                >
                  Criar
                </Button>
              </div>
              {roleError ? (
                <p role="alert" className="text-[11px] text-rose-300">
                  {roleError}
                </p>
              ) : null}
            </div>

            {suggestedRoles.length > 0 ? (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                  Templates rápidos
                </div>
                <div className="flex flex-wrap gap-1">
                  {suggestedRoles.map((tplId) => (
                    <button
                      key={tplId}
                      type="button"
                      onClick={() => handleAddRole(tplId)}
                      className="rounded-md border border-white/10 bg-zinc-950 px-2 py-1 font-mono text-[10px] text-zinc-300 hover:border-indigo-400/40 hover:text-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    >
                      + {tplId}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {roleEntries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/12 p-4 text-center text-xs text-zinc-400">
            Nenhum papel configurado neste preset.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {roleEntries.map(([roleId, role]) => {
              const isSelected = activeRole?.id === roleId;
              return (
                <li key={roleId}>
                  <button
                    type="button"
                    onClick={() => onSelectRole(roleId)}
                    aria-current={isSelected ? "true" : undefined}
                    className={[
                      "w-full rounded-xl border p-2.5 text-left transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                      isSelected
                        ? "border-indigo-400/45 bg-indigo-500/15"
                        : "border-white/8 bg-zinc-900/60 hover:border-white/16",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-zinc-100">
                        {role.title || roleId}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400">
                        {roleId}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <Badge tone={getInstanceBadgeTone(role.providerInstanceId)}>
                        {resolveInstanceShortLabel(
                          role.providerInstanceId,
                          providerInstances,
                        )}
                      </Badge>
                      <span className="truncate font-mono text-[10px] text-zinc-400">
                        {role.model}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Right column: Selected role editor */}
      <div className="lg:col-span-8">
        {activeRole ? (
          <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 pb-3">
              <div className="flex items-center gap-2">
                <UserCog className="size-4 text-indigo-300" aria-hidden="true" />
                <div>
                  <h4 className="text-sm font-semibold text-zinc-100">
                    {activeRole.title || activeRole.id}
                  </h4>
                  <p className="font-mono text-[11px] text-zinc-400">
                    roles/{activeRole.id}.md
                  </p>
                </div>
              </div>

              <Button
                variant="danger"
                size="xs"
                onClick={() => handleDeleteRole(activeRole.id)}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Remover Papel
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="role-title-input"
                  className="block text-xs font-medium text-zinc-200"
                >
                  Título do Papel
                </label>
                <input
                  id="role-title-input"
                  type="text"
                  value={activeRole.title}
                  onChange={(e) =>
                    updateRole(activeRole.id, { title: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-white/12 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                />
              </div>

              <div>
                <label
                  htmlFor="role-when-input"
                  className="block text-xs font-medium text-zinc-200"
                >
                  Quando Acionar (`whenToUse`)
                </label>
                <input
                  id="role-when-input"
                  type="text"
                  value={activeRole.whenToUse}
                  onChange={(e) =>
                    updateRole(activeRole.id, { whenToUse: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-white/12 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                />
              </div>

              <div>
                <label
                  htmlFor="role-instance-select"
                  className="block text-xs font-medium text-zinc-200"
                >
                  Instância (`providerInstanceId`)
                </label>
                <select
                  id="role-instance-select"
                  value={activeRole.providerInstanceId}
                  onChange={(e) => {
                    const inst = e.target.value;
                    const ms = getModelsForInstance(inst, providerInstances);
                    updateRole(activeRole.id, {
                      providerInstanceId: inst,
                      model: ms.includes(activeRole.model)
                        ? activeRole.model
                        : (ms[0] ?? activeRole.model),
                    });
                  }}
                  className="mt-1 w-full rounded-lg border border-white/12 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
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
                  htmlFor="role-model-select"
                  className="block text-xs font-medium text-zinc-200"
                >
                  Modelo (`model`)
                </label>
                <select
                  id="role-model-select"
                  value={activeRole.model}
                  onChange={(e) =>
                    updateRole(activeRole.id, { model: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-white/12 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  {getModelsForInstance(
                    activeRole.providerInstanceId,
                    providerInstances,
                  ).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  {!getModelsForInstance(
                    activeRole.providerInstanceId,
                    providerInstances,
                  ).includes(activeRole.model) ? (
                    <option value={activeRole.model}>{activeRole.model}</option>
                  ) : null}
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="role-description-input"
                className="block text-xs font-medium text-zinc-200"
              >
                Descrição do Papel
              </label>
              <textarea
                id="role-description-input"
                rows={2}
                value={activeRole.description}
                onChange={(e) =>
                  updateRole(activeRole.id, { description: e.target.value })
                }
                className="mt-1 w-full rounded-lg border border-white/12 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              />
            </div>

            <KeyValueEditor
              label="Opções do Modelo (`thinking_level` / `reasoningEffort`)"
              entries={activeRole.options}
              onChange={(options) => updateRole(activeRole.id, { options })}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <StringListEditor
                label="Caminhos Permitidos (`allowedPaths`)"
                items={activeRole.allowedPaths}
                placeholder="ex: src/**"
                monospace
                onChange={(allowedPaths) =>
                  updateRole(activeRole.id, { allowedPaths })
                }
              />
              <StringListEditor
                label="Caminhos Proibidos (`forbiddenPaths`)"
                items={activeRole.forbiddenPaths}
                placeholder="ex: src-tauri/**"
                monospace
                onChange={(forbiddenPaths) =>
                  updateRole(activeRole.id, { forbiddenPaths })
                }
              />
            </div>

            <StringListEditor
              label="Invariantes do Papel (`invariants`)"
              items={activeRole.invariants}
              placeholder="ex: Nunca alterar schema sem alinhar contrato"
              onChange={(invariants) => updateRole(activeRole.id, { invariants })}
            />

            <StringListEditor
              label="Comandos de Verificação (`verificationCommands`)"
              items={activeRole.verificationCommands}
              placeholder="ex: bun run test"
              monospace
              onChange={(verificationCommands) =>
                updateRole(activeRole.id, { verificationCommands })
              }
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/12 p-8 text-center text-xs text-zinc-400">
            Selecione ou adicione um papel à esquerda para configurar modelo, escopo e invariantes.
          </div>
        )}
      </div>
    </div>
  );
}
