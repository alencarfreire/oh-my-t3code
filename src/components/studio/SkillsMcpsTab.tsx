import { useMemo, useState } from "react";
import { Blocks, Plus, Search, Wrench } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { RECOMMENDED_MCPS } from "../../lib/preset-utils";
import type { PresetConfig, SkillMetadata } from "../../types/ipc";

interface SkillsMcpsTabProps {
  preset: PresetConfig;
  selectedRoleId: string | null;
  availableSkills: SkillMetadata[];
  onSelectRole: (roleId: string) => void;
  onChange: (next: PresetConfig) => void;
}

export function SkillsMcpsTab({
  preset,
  selectedRoleId,
  availableSkills,
  onSelectRole,
  onChange,
}: SkillsMcpsTabProps) {
  const [skillQuery, setSkillQuery] = useState("");
  const [customMcp, setCustomMcp] = useState("");

  const roleEntries = Object.entries(preset.roles).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const activeRole =
    (selectedRoleId && preset.roles[selectedRoleId]) ||
    roleEntries[0]?.[1] ||
    null;

  const filteredSkills = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    if (!q) return availableSkills;
    return availableSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.source.toLowerCase().includes(q),
    );
  }, [availableSkills, skillQuery]);

  if (!activeRole) {
    return (
      <div className="rounded-2xl border border-dashed border-white/12 p-8 text-center text-xs text-zinc-400">
        Adicione ao menos um papel na aba <strong>Matriz de Papéis</strong> para vincular Skills e MCPs.
      </div>
    );
  }

  const toggleSkill = (skillId: string) => {
    const exists = activeRole.skills.includes(skillId);
    const nextSkills = exists
      ? activeRole.skills.filter((s) => s !== skillId)
      : [...activeRole.skills, skillId];
    onChange({
      ...preset,
      roles: {
        ...preset.roles,
        [activeRole.id]: { ...activeRole, skills: nextSkills },
      },
    });
  };

  const toggleMcp = (mcpId: string) => {
    const exists = activeRole.mcps.includes(mcpId);
    const nextMcps = exists
      ? activeRole.mcps.filter((m) => m !== mcpId)
      : [...activeRole.mcps, mcpId];
    onChange({
      ...preset,
      roles: {
        ...preset.roles,
        [activeRole.id]: { ...activeRole, mcps: nextMcps },
      },
    });
  };

  const handleAddCustomMcp = () => {
    const val = customMcp.trim();
    if (!val) return;
    if (!activeRole.mcps.includes(val)) {
      onChange({
        ...preset,
        roles: {
          ...preset.roles,
          [activeRole.id]: { ...activeRole, mcps: [...activeRole.mcps, val] },
        },
      });
    }
    setCustomMcp("");
  };

  const extraCustomMcps = activeRole.mcps.filter(
    (m) => !RECOMMENDED_MCPS.some((rec) => rec.id === m),
  );

  return (
    <div className="space-y-5">
      {/* Role Picker */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-900/60 px-4 py-3">
        <div>
          <h3 className="text-xs font-semibold text-zinc-100">
            Configurando Skills & MCPs para o papel
          </h3>
          <p className="text-[11px] text-zinc-400">
            Catálogo lido de `~/.config/skillshare/skills` e `~/.gemini/config/skills`.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="skills-role-selector"
            className="text-xs text-zinc-300"
          >
            Papel:
          </label>
          <select
            id="skills-role-selector"
            value={activeRole.id}
            onChange={(e) => onSelectRole(e.target.value)}
            className="rounded-lg border border-white/15 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            {roleEntries.map(([id, r]) => (
              <option key={id} value={id}>
                {r.title} ({id})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Skills Catalog Selector */}
        <section className="lg:col-span-7 rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wrench className="size-4 text-indigo-300" aria-hidden="true" />
              <h4 className="text-sm font-semibold text-zinc-100">
                Skills Globais ({activeRole.skills.length} selecionadas)
              </h4>
            </div>
          </div>

          <div className="relative">
            <label htmlFor="skill-search-input" className="sr-only">
              Buscar skills por nome ou descrição
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <input
              id="skill-search-input"
              type="search"
              value={skillQuery}
              onChange={(e) => setSkillQuery(e.target.value)}
              placeholder="Buscar skill (ex: tailwind, tdd, security)..."
              className="w-full rounded-lg border border-white/12 bg-zinc-950 py-2 pl-9 pr-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            />
          </div>

          {filteredSkills.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 py-6 text-center text-xs text-zinc-400">
              Nenhuma skill encontrada para &ldquo;{skillQuery}&rdquo;.
            </div>
          ) : (
            <ul className="max-h-96 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
              {filteredSkills.map((skill) => {
                const checked = activeRole.skills.includes(skill.id);
                return (
                  <li key={`${skill.source}-${skill.id}`}>
                    <label
                      className={[
                        "flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 transition-colors duration-150",
                        checked
                          ? "border-indigo-400/40 bg-indigo-500/12"
                          : "border-white/8 bg-zinc-950/70 hover:border-white/16",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSkill(skill.id)}
                        className="mt-0.5 size-4 rounded border-white/20 bg-zinc-900 text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-medium text-zinc-100">
                            {skill.name}
                          </span>
                          <Badge tone={skill.source === "skillshare" ? "sky" : "neutral"}>
                            {skill.source}
                          </Badge>
                        </div>
                        {skill.description ? (
                          <p className="mt-0.5 text-[11px] text-zinc-400">
                            {skill.description}
                          </p>
                        ) : null}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Recommended MCPs Selector */}
        <section className="lg:col-span-5 rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Blocks className="size-4 text-emerald-300" aria-hidden="true" />
            <h4 className="text-sm font-semibold text-zinc-100">
              MCPs Recomendados ({activeRole.mcps.length})
            </h4>
          </div>

          <ul className="space-y-2">
            {RECOMMENDED_MCPS.map((mcp) => {
              const checked = activeRole.mcps.includes(mcp.id);
              return (
                <li key={mcp.id}>
                  <label
                    className={[
                      "flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 transition-colors duration-150",
                      checked
                        ? "border-emerald-400/40 bg-emerald-500/10"
                        : "border-white/8 bg-zinc-950/70 hover:border-white/16",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMcp(mcp.id)}
                      className="mt-0.5 size-4 rounded border-white/20 bg-zinc-900 text-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs font-medium text-zinc-100">
                        {mcp.label}
                      </div>
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        {mcp.description}
                      </p>
                    </div>
                  </label>
                </li>
              );
            })}

            {extraCustomMcps.map((mcpId) => (
              <li key={mcpId}>
                <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-indigo-400/40 bg-indigo-500/10 p-2.5">
                  <span className="flex items-center gap-2 font-mono text-xs text-zinc-100">
                    <input
                      type="checkbox"
                      checked
                      onChange={() => toggleMcp(mcpId)}
                      className="size-4 rounded border-white/20 bg-zinc-900"
                    />
                    {mcpId}
                  </span>
                  <Badge tone="neutral">custom</Badge>
                </label>
              </li>
            ))}
          </ul>

          <div className="pt-2 border-t border-white/8 space-y-1.5">
            <label
              htmlFor="custom-mcp-input"
              className="block text-[11px] font-medium text-zinc-300"
            >
              Adicionar MCP customizado
            </label>
            <div className="flex gap-2">
              <input
                id="custom-mcp-input"
                type="text"
                value={customMcp}
                onChange={(e) => setCustomMcp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCustomMcp();
                  }
                }}
                placeholder="ex: postgres-mcp"
                className="min-w-0 flex-1 rounded-lg border border-white/12 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              />
              <Button variant="secondary" size="sm" onClick={handleAddCustomMcp}>
                <Plus className="size-3.5" aria-hidden="true" />
                Add
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
