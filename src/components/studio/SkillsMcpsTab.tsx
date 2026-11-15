import { useMemo, useState } from "react";
import {
  Blocks,
  BookOpen,
  BrainCircuit,
  Globe,
  Kanban,
  Plus,
  Search,
  Wrench,
} from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { RECOMMENDED_MCPS } from "../../lib/preset-utils";
import type { PresetConfig, SkillMetadata } from "../../types/ipc";

interface SkillsMcpsTabProps {
  preset: PresetConfig;
  selectedRoleId: string | null;
  availableSkills: SkillMetadata[];
  onSelectRole: (roleId: string) => void;
  onChange: (next: PresetConfig) => void;
}

const MCP_ICONS: Record<string, typeof Blocks> = {
  "ai-memory": BrainCircuit,
  context7: BookOpen,
  playwright: Globe,
  linear: Kanban,
};

export function SkillsMcpsTab({
  preset,
  selectedRoleId,
  availableSkills,
  onSelectRole,
  onChange,
}: SkillsMcpsTabProps) {
  const [skillQuery, setSkillQuery] = useState("");
  const [skillFilterMode, setSkillFilterMode] = useState<"all" | "selected">("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [customMcp, setCustomMcp] = useState("");

  const roleEntries = Object.entries(preset.roles).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const activeRole =
    (selectedRoleId && preset.roles[selectedRoleId]) ||
    roleEntries[0]?.[1] ||
    null;

  const availableSources = useMemo(() => {
    const set = new Set<string>();
    for (const s of availableSkills) {
      if (s.source) set.add(s.source);
    }
    return Array.from(set).sort();
  }, [availableSkills]);

  const filteredSkills = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    return availableSkills.filter((s) => {
      if (skillFilterMode === "selected" && activeRole && !activeRole.skills.includes(s.id)) {
        return false;
      }
      if (sourceFilter !== "all" && s.source !== sourceFilter) {
        return false;
      }
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.source.toLowerCase().includes(q)
      );
    });
  }, [activeRole, availableSkills, skillFilterMode, skillQuery, sourceFilter]);

  if (!activeRole) {
    return (
      <div className="surface-card rounded-2xl border-dashed p-8 text-center text-xs text-zinc-400">
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
      <div className="surface-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
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
            className="text-xs font-medium text-zinc-300"
          >
            Papel:
          </label>
          <Select
            id="skills-role-selector"
            sizeVariant="xs"
            value={activeRole.id}
            onChange={(e) => onSelectRole(e.target.value)}
            wrapperClassName="min-w-48"
          >
            {roleEntries.map(([id, r]) => (
              <option key={id} value={id}>
                {r.title} ({id})
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Skills Catalog Selector */}
        <section className="surface-panel lg:col-span-7 rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg border border-indigo-400/25 bg-indigo-500/15 text-indigo-300">
                <Wrench className="size-3.5" aria-hidden="true" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-zinc-100 tabular-nums">
                  Skills Globais ({activeRole.skills.length} selecionadas)
                </h4>
              </div>
            </div>

            {/* Quick filter: All vs Selected */}
            <div
              role="group"
              aria-label="Filtrar skills por seleção"
              className="inline-flex rounded-lg border border-white/10 bg-zinc-950/90 p-0.5"
            >
              <button
                type="button"
                aria-pressed={skillFilterMode === "all"}
                onClick={() => setSkillFilterMode("all")}
                className={[
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 tabular-nums",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                  skillFilterMode === "all"
                    ? "bg-indigo-500 text-white"
                    : "text-zinc-400 hover:text-zinc-200",
                ].join(" ")}
              >
                Todas ({availableSkills.length})
              </button>
              <button
                type="button"
                aria-pressed={skillFilterMode === "selected"}
                onClick={() => setSkillFilterMode("selected")}
                className={[
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 tabular-nums",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                  skillFilterMode === "selected"
                    ? "bg-indigo-500 text-white"
                    : "text-zinc-400 hover:text-zinc-200",
                ].join(" ")}
              >
                Apenas Selecionadas ({activeRole.skills.length})
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <label htmlFor="skill-search-input" className="sr-only">
                Buscar skills por nome ou descrição
              </label>
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
                aria-hidden="true"
              />
              <input
                id="skill-search-input"
                type="search"
                value={skillQuery}
                onChange={(e) => setSkillQuery(e.target.value)}
                placeholder="Buscar skill (ex: tailwind, tdd, security)…"
                className="h-8.5 w-full rounded-lg border border-white/12 bg-zinc-950/90 ps-9 pe-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              />
            </div>

            {availableSources.length > 1 ? (
              <div
                role="group"
                aria-label="Filtrar por origem"
                className="inline-flex items-center gap-1"
              >
                <button
                  type="button"
                  aria-pressed={sourceFilter === "all"}
                  onClick={() => setSourceFilter("all")}
                  className={[
                    "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                    sourceFilter === "all"
                      ? "border-white/25 bg-zinc-800 text-zinc-100"
                      : "border-white/10 bg-zinc-950/70 text-zinc-400 hover:text-zinc-200",
                  ].join(" ")}
                >
                  Todas origens
                </button>
                {availableSources.map((src) => (
                  <button
                    key={src}
                    type="button"
                    aria-pressed={sourceFilter === src}
                    onClick={() => setSourceFilter(src)}
                    className={[
                      "rounded-md border px-2 py-1 font-mono text-[11px] transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                      sourceFilter === src
                        ? "border-sky-400/40 bg-sky-500/15 text-sky-200"
                        : "border-white/10 bg-zinc-950/70 text-zinc-400 hover:text-zinc-200",
                    ].join(" ")}
                  >
                    {src}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {filteredSkills.length === 0 ? (
            <div className="surface-card rounded-xl border-dashed py-6 text-center text-xs text-zinc-400">
              {skillFilterMode === "selected" && activeRole.skills.length === 0
                ? "Nenhuma skill selecionada para este papel ainda."
                : `Nenhuma skill encontrada para "${skillQuery}".`}
            </div>
          ) : (
            <ul className="max-h-96 space-y-1.5 overflow-y-auto overscroll-contain pe-1">
              {filteredSkills.map((skill) => {
                const checked = activeRole.skills.includes(skill.id);
                return (
                  <li key={`${skill.source}-${skill.id}`}>
                    <label
                      className={[
                        "flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 transition-[background-color,border-color,box-shadow] duration-150 ease-out",
                        checked
                          ? "border-indigo-400/50 bg-indigo-500/[0.14] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]"
                          : "border-white/8 bg-zinc-950/75 hover:border-white/18 hover:bg-zinc-900/75",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSkill(skill.id)}
                        className="mt-0.5 size-4 rounded border-white/20 bg-zinc-900 accent-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="font-mono text-xs font-medium text-zinc-100">
                            {skill.name}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {checked ? <Badge tone="indigo">Ativa</Badge> : null}
                            <Badge tone={skill.source === "skillshare" ? "sky" : "neutral"}>
                              {skill.source}
                            </Badge>
                          </div>
                        </div>
                        {skill.description ? (
                          <p className="mt-0.5 text-[11px] leading-[1.4] text-zinc-400">
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

        {/* Recommended MCPs Interactive Cards */}
        <section className="surface-panel lg:col-span-5 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg border border-emerald-400/25 bg-emerald-500/15 text-emerald-300">
              <Blocks className="size-3.5" aria-hidden="true" />
            </div>
            <h4 className="text-sm font-semibold text-zinc-100 tabular-nums">
              MCPs Recomendados ({activeRole.mcps.length})
            </h4>
          </div>

          <ul className="space-y-2">
            {RECOMMENDED_MCPS.map((mcp) => {
              const checked = activeRole.mcps.includes(mcp.id);
              const Icon = MCP_ICONS[mcp.id] ?? Blocks;
              return (
                <li key={mcp.id}>
                  <label
                    className={[
                      "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-[background-color,border-color,box-shadow] duration-150 ease-out",
                      checked
                        ? "border-emerald-400/45 bg-emerald-500/[0.11] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                        : "border-white/8 bg-zinc-950/75 hover:border-white/18 hover:bg-zinc-900/75",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMcp(mcp.id)}
                      className="mt-1 size-4 rounded border-white/20 bg-zinc-900 accent-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    />
                    <div
                      className={[
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border",
                        checked
                          ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-300"
                          : "border-white/10 bg-zinc-900 text-zinc-400",
                      ].join(" ")}
                    >
                      <Icon className="size-3.5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="font-mono text-xs font-semibold text-zinc-100">
                          {mcp.label}
                        </span>
                        <Badge tone={checked ? "emerald" : "neutral"}>
                          {mcp.roleHint}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[11px] leading-[1.4] text-zinc-400">
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
                      className="size-4 rounded border-white/20 bg-zinc-900 accent-indigo-500"
                    />
                    {mcpId}
                  </span>
                  <Badge tone="neutral">custom</Badge>
                </label>
              </li>
            ))}
          </ul>

          <div className="space-y-1.5 border-t border-white/8 pt-3">
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
                className="h-8 min-w-0 flex-1 rounded-lg border border-white/12 bg-zinc-950/90 px-2.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
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
