import { useState } from "react";
import {
  Cpu,
  FolderLock,
  Plus,
  ShieldCheck,
  Terminal,
  Trash2,
  UserCog,
} from "lucide-react";
import { Badge, getInstanceBadgeTone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ModelRoutingFields } from "../ui/ModelRoutingFields";
import { StringListEditor } from "../ui/StringListEditor";
import {
  COMMON_ROLE_TEMPLATES,
  createEmptyRole,
  formatPrimaryOptionSummary,
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
    const nextDisabledRoles = (preset.disabledRoles ?? []).filter(
      (id) => id !== cleaned,
    );
    onChange({
      ...preset,
      roles: {
        ...preset.roles,
        [cleaned]: created,
      },
      disabledRoles:
        nextDisabledRoles.length > 0 ? nextDisabledRoles : undefined,
    });
    onSelectRole(cleaned);
    setAddingRole(false);
    setNewRoleId("");
    setRoleError(null);
  };

  const handleDeleteRole = (roleId: string) => {
    const nextRoles = { ...preset.roles };
    delete nextRoles[roleId];
    const nextDisabledRoles = preset.extends
      ? Array.from(new Set([...(preset.disabledRoles ?? []), roleId])).sort()
      : undefined;
    onChange({
      ...preset,
      roles: nextRoles,
      disabledRoles:
        nextDisabledRoles && nextDisabledRoles.length > 0
          ? nextDisabledRoles
          : undefined,
    });
    const remaining = Object.keys(nextRoles).sort();
    onSelectRole(remaining[0] ?? null);
  };

  const suggestedRoles = Object.keys(COMMON_ROLE_TEMPLATES).filter(
    (id) => !preset.roles[id],
  );

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      {/* Left column: Role cards with instant routing & counts summary */}
      <div className="min-w-0 lg:col-span-4 space-y-3">
        <div className="flex items-center justify-between px-0.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Papéis (`roles/`) ·{" "}
            <span className="tabular-nums">{roleEntries.length}</span>
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
          <div className="surface-card rounded-xl border-indigo-500/30 bg-zinc-900/90 p-3 space-y-2.5">
            <div className="space-y-1.5">
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
                  className="h-8 min-w-0 flex-1 rounded-lg border border-white/15 bg-zinc-950 px-2.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                />
                <Button
                  variant="primary"
                  size="xs"
                  className="h-8"
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
              <div className="space-y-1.5 pt-1 border-t border-white/8">
                <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                  Templates rápidos
                </div>
                <div className="flex flex-wrap gap-1">
                  {suggestedRoles.map((tplId) => (
                    <button
                      key={tplId}
                      type="button"
                      onClick={() => handleAddRole(tplId)}
                      className="rounded-md border border-white/10 bg-zinc-950 px-2 py-1 font-mono text-[10px] text-zinc-300 transition-colors hover:border-indigo-400/40 hover:text-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
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
          <div className="surface-card rounded-xl border-dashed p-5 text-center text-xs text-zinc-400">
            Nenhum papel configurado neste preset.
          </div>
        ) : (
          <ul className="space-y-2">
            {roleEntries.map(([roleId, role]) => {
              const isSelected = activeRole?.id === roleId;
              const optSummary = formatPrimaryOptionSummary(role.options);
              return (
                <li key={roleId}>
                  <button
                    type="button"
                    onClick={() => onSelectRole(roleId)}
                    aria-current={isSelected ? "true" : undefined}
                    className={[
                      "relative w-full rounded-xl border p-3 text-left transition-[background-color,border-color,box-shadow] duration-150 ease-out",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                      isSelected
                        ? "border-indigo-400/45 bg-indigo-500/[0.13] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]"
                        : "border-white/[0.08] bg-zinc-900/65 hover:border-white/[0.16] hover:bg-zinc-900/90",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-zinc-100">
                        {role.title || roleId}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                        {roleId}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge tone={getInstanceBadgeTone(role.providerInstanceId)}>
                        {resolveInstanceShortLabel(
                          role.providerInstanceId,
                          providerInstances,
                        )}
                      </Badge>
                      <span className="truncate font-mono text-[10px] text-zinc-300">
                        {role.model}
                      </span>
                      {optSummary ? (
                        <span className="rounded border border-white/10 bg-zinc-950/80 px-1.5 py-0.5 font-mono text-[10px] leading-none text-zinc-400">
                          {optSummary}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-400 tabular-nums">
                      <span>{role.skills.length} skills</span>
                      <span aria-hidden="true">·</span>
                      <span>{role.mcps.length} MCPs</span>
                      {role.verificationCommands.length > 0 ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{role.verificationCommands.length} checks</span>
                        </>
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Right column: Selected role editor split into 4 focused cards */}
      <div className="min-w-0 lg:col-span-8">
        {activeRole ? (
          <div className="min-w-0 space-y-4">
            {/* Card 1: Identity & When to use */}
            <section className="surface-panel min-w-0 rounded-2xl p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 pb-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-indigo-400/25 bg-indigo-500/15 text-indigo-300">
                    <UserCog className="size-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold text-zinc-100">
                      {activeRole.title || activeRole.id}
                    </h4>
                    <p className="truncate font-mono text-[11px] text-zinc-400">
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
                <div className="min-w-0">
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
                    className="mt-1.5 h-8.5 w-full min-w-0 rounded-lg border border-white/12 bg-zinc-950/90 px-3 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  />
                </div>

                <div className="min-w-0">
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
                    className="mt-1.5 h-8.5 w-full min-w-0 rounded-lg border border-white/12 bg-zinc-950/90 px-3 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  />
                </div>
              </div>

              <div className="min-w-0">
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
                  className="mt-1.5 w-full min-w-0 rounded-lg border border-white/12 bg-zinc-950/90 px-3 py-2 text-xs leading-relaxed text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                />
              </div>
            </section>

            {/* Card 2: Model & Instance Routing with 1-Click Quick-Picks */}
            <section className="surface-panel min-w-0 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Cpu className="size-4 text-indigo-300" aria-hidden="true" />
                <h5 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  Roteamento de Modelo & Instância
                </h5>
              </div>

              <ModelRoutingFields
                instanceId={activeRole.providerInstanceId}
                model={activeRole.model}
                options={activeRole.options}
                providerInstances={providerInstances}
                instanceSelectId="role-instance-select"
                modelSelectId="role-model-select"
                optionsLabel="Opções do Modelo (`thinking_level` / `reasoningEffort`)"
                onChange={(patch) => updateRole(activeRole.id, patch)}
              />
            </section>

            {/* Card 3: File Scope (allowedPaths / forbiddenPaths as crisp monospace chips) */}
            <section className="surface-panel min-w-0 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <FolderLock className="size-4 text-amber-300" aria-hidden="true" />
                <h5 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  Escopo de Arquivos
                </h5>
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
                <StringListEditor
                  label="Caminhos Permitidos (`allowedPaths`)"
                  items={activeRole.allowedPaths}
                  placeholder="ex: src/**"
                  monospace
                  displayMode="chips"
                  chipTone="emerald"
                  onChange={(allowedPaths) =>
                    updateRole(activeRole.id, { allowedPaths })
                  }
                />
                <StringListEditor
                  label="Caminhos Proibidos (`forbiddenPaths`)"
                  items={activeRole.forbiddenPaths}
                  placeholder="ex: src-tauri/**"
                  monospace
                  displayMode="chips"
                  chipTone="rose"
                  onChange={(forbiddenPaths) =>
                    updateRole(activeRole.id, { forbiddenPaths })
                  }
                />
              </div>
            </section>

            {/* Card 4: Invariants & Verification Commands */}
            <section className="surface-panel min-w-0 rounded-2xl p-4 space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-300" aria-hidden="true" />
                <h5 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  Invariantes & Verificação
                </h5>
              </div>

              <StringListEditor
                label="Invariantes do Papel (`invariants`)"
                items={activeRole.invariants}
                placeholder="ex: Nunca alterar schema sem alinhar contrato"
                onChange={(invariants) => updateRole(activeRole.id, { invariants })}
              />

              <div className="border-t border-white/8 pt-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                  <Terminal className="size-3.5 text-emerald-400" aria-hidden="true" />
                  <span>Gate de Qualidade</span>
                </div>
                <StringListEditor
                  label="Comandos de Verificação (`verificationCommands`)"
                  items={activeRole.verificationCommands}
                  placeholder="ex: bun run test"
                  monospace
                  displayMode="terminal"
                  onChange={(verificationCommands) =>
                    updateRole(activeRole.id, { verificationCommands })
                  }
                />
              </div>
            </section>
          </div>
        ) : (
          <div className="surface-card rounded-2xl border-dashed p-8 text-center text-xs text-zinc-400">
            Selecione ou adicione um papel à esquerda para configurar modelo, escopo e invariantes.
          </div>
        )}
      </div>
    </div>
  );
}
