import type {
  FallbackStep,
  HardwareProfile,
  PresetConfig,
  ProjectSessionHealth,
  ProjectSummary,
  ProviderInstanceInfo,
  RoleConfig,
  SessionPolicy,
  SubagentActivity,
} from "../types/ipc";

export const RECOMMENDED_MCPS = [
  {
    id: "ai-memory",
    label: "ai-memory",
    roleHint: "Memória & Handoffs",
    description: "Memória durável do projeto, decisões de arquitetura e handoffs entre sessões.",
  },
  {
    id: "context7",
    label: "context7",
    roleHint: "Docs Atualizadas",
    description: "Documentação atualizada de bibliotecas e frameworks (Tauri, React, Tailwind).",
  },
  {
    id: "playwright",
    label: "playwright",
    roleHint: "E2E & Visual",
    description: "Automação de navegador, snapshots de acessibilidade e testes E2E visuais.",
  },
  {
    id: "linear",
    label: "linear",
    roleHint: "Issues & Status",
    description: "Leitura e atualização de issues, projetos, ciclos e status no Linear.",
  },
] as const;

export const COMMON_ROLE_TEMPLATES: Record<string, Partial<RoleConfig>> = {
  explorer: {
    title: "Explorer",
    description:
      "Pesquisa rápida de código, mapeamento read-only do repositório e consulta de docs.",
    whenToUse:
      "Descoberta inicial de arquivos, símbolos, contratos IPC e documentação via context7/ai-memory.",
    providerInstanceId: "antigravity",
    model: "gemini-4-hydrogen",
    options: { thinking_level: "low" },
    skills: ["ai-memory-retrieval", "systematic-debugging"],
    mcps: ["context7", "ai-memory"],
  },
  oracle: {
    title: "Oracle",
    description:
      "Arquitetura, trade-offs de alto risco, simplificação de design e debug complexo.",
    whenToUse:
      "Decisões estruturais, migrações críticas, concorrência e análise de causa raiz difícil.",
    providerInstanceId: "antigravity_2",
    model: "gemini-4-argon",
    options: { thinking_level: "high" },
    skills: ["systematic-debugging", "code-review-and-security", "ai-memory-retrieval"],
    mcps: ["ai-memory", "context7"],
  },
  designer: {
    title: "Designer",
    description:
      "Implementação de UI/UX, layout, tipografia, responsividade e Tailwind CSS v4.",
    whenToUse:
      "Telas, estados vazios, interações, acessibilidade, design tokens e componentes visuais.",
    providerInstanceId: "antigravity_2",
    model: "gemini-4-hydrogen",
    options: { thinking_level: "medium" },
    skills: [
      "tailwind-v4-design",
      "frontend-design",
      "better-ui",
      "better-accessibility",
      "better-layout",
    ],
    mcps: ["context7", "playwright", "ai-memory"],
  },
  fixer: {
    title: "Fixer",
    description:
      "Implementação rápida e bem delimitada de backend, módulos de domínio e correções.",
    whenToUse:
      "Implementações de domínio, APIs, persistência, CLIs, módulos Rust/Rails e correções com testes.",
    providerInstanceId: "antigravity",
    model: "gemini-4-hydrogen",
    options: { thinking_level: "high" },
    skills: ["tdd-and-testing", "systems-rust-go-crystal", "systematic-debugging"],
    mcps: ["ai-memory", "context7"],
  },
  "qa-reviewer": {
    title: "QA / Security Reviewer",
    description: "Auditoria independente de segurança, invariantes, paridade IPC e testes.",
    whenToUse: "Revisão final independente antes de concluir entrega ou PR.",
    providerInstanceId: "antigravity_2",
    model: "gemini-4-argon",
    options: { thinking_level: "high" },
    skills: ["code-review-and-security", "security-audit", "web-design-guidelines"],
    mcps: ["ai-memory", "playwright"],
  },
  backend: {
    title: "Backend",
    description: "APIs, models, domínio, jobs, migrations e suíte de testes.",
    whenToUse: "Implementações de domínio, persistência, regras de negócio e endpoints.",
    providerInstanceId: "antigravity",
    model: "gemini-4-hydrogen",
    options: { thinking_level: "high" },
    skills: ["tdd-and-testing", "systematic-debugging", "ai-memory-retrieval"],
    mcps: ["ai-memory", "context7"],
  },
  frontend: {
    title: "Frontend UI",
    description: "Componentes React 19, Tailwind CSS v4, acessibilidade e ergonomia visual.",
    whenToUse: "Interfaces, estados, design tokens, responsividade e testes de componente.",
    providerInstanceId: "antigravity_2",
    model: "gemini-4-hydrogen",
    options: { thinking_level: "medium" },
    skills: ["tailwind-v4-design", "better-accessibility", "better-ui"],
    mcps: ["context7", "playwright", "ai-memory"],
  },
  "rust-core": {
    title: "Rust Core",
    description: "Backend nativo Tauri v2, SQLite read-only, escrita atômica e engine de presets.",
    whenToUse: "Comandos IPC Rust, I/O seguro, compiler de presets e modelos nativos.",
    providerInstanceId: "antigravity",
    model: "gemini-4-hydrogen",
    options: { thinking_level: "high" },
    skills: ["systems-rust-go-crystal", "tdd-and-testing"],
    mcps: ["ai-memory", "context7"],
  },
  crystal: {
    title: "Crystal Worker",
    description: "Serviços e CLIs em Crystal de alta performance com concorrência por fibers.",
    whenToUse: "Serviços Crystal, parsers e workers concorrentes.",
    providerInstanceId: "antigravity",
    model: "gemini-4-hydrogen",
    options: { thinking_level: "high" },
    skills: ["systems-rust-go-crystal", "tdd-and-testing"],
    mcps: ["ai-memory"],
  },
  "meta-sync": {
    title: "Meta Sync",
    description: "Sincronização de métricas, webhooks e pipelines de dados externos.",
    whenToUse: "Integrações Meta Ads, syncs agendados e ETL.",
    providerInstanceId: "antigravity",
    model: "gemini-4-argon",
    options: { thinking_level: "medium" },
    skills: ["systematic-debugging", "tdd-and-testing"],
    mcps: ["ai-memory"],
  },
  "delivery-manager": {
    title: "Delivery Manager",
    description: "Consolidação de PRs, releases, Linear issues e handoffs de sessão.",
    whenToUse: "Atualizar Linear, preparar changelog/PR e registrar handoff no ai-memory.",
    providerInstanceId: "antigravity_2",
    model: "gemini-4-argon",
    options: { thinking_level: "low" },
    skills: ["linear-issues", "ai-memory-handoff"],
    mcps: ["linear", "ai-memory"],
  },
};

const CURATED_MODELS_BY_PROVIDER: Record<string, string[]> = {
  antigravity: [
    "gemini-4-hydrogen",
    "gemini-4-argon",
    "gemini-3.8-flash",
    "claude-opus-5-5",
    "claude-sonnet-5-5",
  ],
  codex: ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-astra", "gpt-6-luna"],
  claudeAgent: ["claude-opus-4-1", "claude-sonnet-4-5"],
  opencode: ["opencode-default"],
  grok: ["grok-3"],
};

export interface ProviderOptionSpec {
  key: string;
  label: string;
  values: readonly string[];
}

export function resolveProviderFamily(
  instanceId: string,
  instances: ProviderInstanceInfo[],
): string {
  const found = instances.find((i) => i.id === instanceId);
  if (found?.provider) return found.provider;
  if (instanceId.startsWith("antigravity")) return "antigravity";
  if (instanceId === "codex") return "codex";
  if (instanceId === "claudeAgent") return "claudeAgent";
  if (instanceId === "opencode") return "opencode";
  if (instanceId === "grok") return "grok";
  return "antigravity";
}

export function getOptionSpecsForInstance(
  instanceId: string,
  instances: ProviderInstanceInfo[],
): ProviderOptionSpec[] {
  const family = resolveProviderFamily(instanceId, instances);
  if (family === "antigravity") {
    return [
      {
        key: "thinking_level",
        label: "thinking_level",
        values: ["low", "medium", "high", "xhigh"],
      },
    ];
  }
  if (family === "codex") {
    return [
      {
        key: "reasoningEffort",
        label: "reasoningEffort",
        values: ["low", "medium", "high", "xhigh"],
      },
      {
        key: "serviceTier",
        label: "serviceTier",
        values: ["default", "priority"],
      },
    ];
  }
  return [];
}

export function getModelsForInstance(
  instanceId: string,
  instances: ProviderInstanceInfo[],
): string[] {
  const found = instances.find((i) => i.id === instanceId);
  const family = resolveProviderFamily(instanceId, instances);
  const curated = CURATED_MODELS_BY_PROVIDER[family] ?? [];
  const merged = new Set<string>([...(found?.models ?? []), ...curated]);
  if (merged.size === 0) {
    return ["gemini-4-hydrogen", "gemini-4-argon"];
  }
  return Array.from(merged);
}

export function normalizeOptionsForInstance(
  instanceId: string,
  currentOptions: Record<string, string>,
  instances: ProviderInstanceInfo[],
): Record<string, string> {
  const family = resolveProviderFamily(instanceId, instances);
  if (family === "antigravity") {
    const level =
      currentOptions.thinking_level ??
      currentOptions.thinkingLevel ??
      currentOptions.reasoningEffort ??
      "high";
    return { thinking_level: level };
  }
  if (family === "codex") {
    const effort =
      currentOptions.reasoningEffort ??
      currentOptions.thinking_level ??
      "high";
    return {
      reasoningEffort: effort,
      serviceTier: currentOptions.serviceTier ?? "default",
    };
  }
  return { ...currentOptions };
}

export function formatPrimaryOptionSummary(options: Record<string, string>): string | null {
  const level = options.thinking_level ?? options.thinkingLevel ?? options.reasoningEffort;
  if (level) return level;
  const first = Object.entries(options)[0];
  return first ? `${first[0]}=${first[1]}` : null;
}

export function resolvePresetFamilyTag(preset: PresetConfig): {
  label: string;
  tone: "indigo" | "emerald" | "amber" | "sky" | "neutral";
} {
  const id = preset.id.toLowerCase();
  const base = (preset.extends ?? "").toLowerCase();
  if (id === "default") {
    return { label: "OMOS Standard", tone: "sky" };
  }
  if (id.includes("hybrid") || base.includes("hybrid")) {
    return { label: "Hybrid", tone: "amber" };
  }
  if (id.includes("codex") || base.includes("codex") || preset.orchestrator.providerInstanceId === "codex") {
    return { label: "Codex", tone: "emerald" };
  }
  if (
    id.includes("agy") ||
    base.includes("agy") ||
    preset.orchestrator.providerInstanceId.startsWith("antigravity")
  ) {
    return { label: "Dual Agy", tone: "indigo" };
  }
  return { label: "Custom", tone: "neutral" };
}

export function sanitizeSafeId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function isValidSafeId(id: string): boolean {
  return id.length >= 1 && id.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(id);
}

export function resolveInstanceShortLabel(
  instanceId: string | null | undefined,
  instances: ProviderInstanceInfo[],
): string {
  if (!instanceId) return "Não definido";
  const found = instances.find((i) => i.id === instanceId);
  if (found) {
    if (instanceId === "antigravity") return "Agy Veca";
    if (instanceId === "antigravity_2") return "Agy Principal";
    if (instanceId === "codex") return "Codex";
    return found.label.replace(/\s*\([^)]+\)$/, "");
  }
  if (instanceId === "antigravity") return "Agy Veca";
  if (instanceId === "antigravity_2") return "Agy Principal";
  if (instanceId === "codex") return "Codex";
  return instanceId;
}

export function createEmptyRole(id: string): RoleConfig {
  const template = COMMON_ROLE_TEMPLATES[id];
  return {
    id,
    title: template?.title ?? id,
    description: template?.description ?? "",
    whenToUse: template?.whenToUse ?? "",
    providerInstanceId: template?.providerInstanceId ?? "antigravity",
    model: template?.model ?? "gemini-4-hydrogen",
    options: template?.options ? { ...template.options } : { thinking_level: "medium" },
    skills: template?.skills ? [...template.skills] : [],
    mcps: template?.mcps ? [...template.mcps] : ["ai-memory"],
    allowedPaths: [],
    forbiddenPaths: [],
    invariants: [],
    verificationCommands: [],
  };
}

export function normalizeDisabledRoles(
  disabledRoles?: readonly string[] | null,
): string[] | undefined {
  if (!disabledRoles || disabledRoles.length === 0) return undefined;
  const normalized = Array.from(
    new Set(disabledRoles.map((id) => id.trim()).filter((id) => isValidSafeId(id))),
  ).sort();
  return normalized.length > 0 ? normalized : undefined;
}

export function defaultMaxAntigravityForProfile(profile: HardwareProfile): number {
  switch (profile) {
    case "laptop-8gb":
      return 2;
    case "desktop-16gb":
      return 3;
    case "desktop-32gb-plus":
      return 4;
    default:
      return 2;
  }
}

export function createDefaultSessionPolicy(): SessionPolicy {
  return {
    hardwareProfile: "laptop-8gb",
    maxConcurrentAntigravityWorkers: 2,
    maxConcurrentWorkersTotal: 3,
    parentMaxTurnsBeforeHandoff: 15,
    parentMaxItemsBeforeHandoff: 120,
    parentWarnInputTokens: 200_000,
    parentHardInputTokens: 700_000,
    parentThinkingLevel: "medium",
    workerThinkingByKind: {
      architecture: { model: "gemini-4-argon", thinkingLevel: "high" },
      backend: { model: "gemini-4-hydrogen", thinkingLevel: "high" },
      frontend: { model: "gemini-4-hydrogen", thinkingLevel: "medium" },
      qa: { model: "gemini-4-argon", thinkingLevel: "high" },
      research: { model: "gemini-4-hydrogen", thinkingLevel: "low" },
    },
    delegateMode: "async-default",
    onAcpSessionDead: "advise-new-thread",
    forbiddenPatterns: [
      "orquestrar+implementar no mesmo chat",
      "4 ACP simultâneos neste perfil",
      "thinking high no pai",
      "continuar thread após provider_error AcpRequestError",
    ],
  };
}

export function effectiveParentThinkingLevel(policy: SessionPolicy): string {
  const configured = policy.parentThinkingLevel.trim();
  if (policy.hardwareProfile === "laptop-8gb" && (configured === "high" || configured === "xhigh")) {
    return "medium";
  }
  return configured || "medium";
}

function thinkingRank(level: string): number {
  switch (level) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    case "xhigh":
      return 4;
    default:
      return 2;
  }
}

export function effectiveOrchestratorOptions(preset: PresetConfig): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(preset.orchestrator.options)) {
    if (k === "thinkingLevel") {
      if (!("thinking_level" in normalized)) {
        normalized.thinking_level = v;
      }
    } else {
      normalized[k] = v;
    }
  }

  const effLevel = effectiveParentThinkingLevel(preset.sessionPolicy);
  if (
    preset.orchestrator.providerInstanceId.startsWith("antigravity") ||
    preset.orchestrator.model.startsWith("gemini-4-") ||
    "thinking_level" in normalized
  ) {
    normalized.thinking_level = effLevel;
  } else if ("reasoningEffort" in normalized) {
    const currentEffort = normalized.reasoningEffort;
    if (thinkingRank(effLevel) < thinkingRank(currentEffort)) {
      normalized.reasoningEffort = effLevel;
    }
  }

  return normalized;
}

export function createEmptyPreset(
  id: string,
  extendsId: string | null = "default",
  disabledRoles?: readonly string[] | null,
): PresetConfig {
  const normalizedDisabled = normalizeDisabledRoles(disabledRoles);
  return {
    id,
    name: id,
    description: "",
    extends: extendsId,
    enabled: true,
    topology: "intra-thread-squad",
    orchestrator: {
      providerInstanceId: "antigravity_2",
      model: "gemini-4-hydrogen",
      options: { thinking_level: "medium" },
    },
    fallbackChain: [
      {
        providerInstanceId: "antigravity",
        model: "gemini-4-hydrogen",
        options: { thinking_level: "high" },
        reason: "Nível 1: Alternar para Agy Veca mantendo gemini-4-hydrogen",
      },
    ],
    contention: {
      singleTestDb: false,
      envVars: {},
      gitIgnoredBuilds: [],
      conflictFiles: [],
      defaultIsolation: "shared",
    },
    sessionPolicy: createDefaultSessionPolicy(),
    roles: {},
    ...(normalizedDisabled ? { disabledRoles: normalizedDisabled } : {}),
  };
}

export function createDefaultFallbackStep(): FallbackStep {
  return {
    providerInstanceId: "antigravity",
    model: "gemini-4-argon",
    options: { thinking_level: "medium" },
    reason: "Alternar conta/modelo quando a instância primária atingir cota",
  };
}

export function clonePreset(preset: PresetConfig): PresetConfig {
  const cloned = JSON.parse(JSON.stringify(preset)) as PresetConfig;
  const normalizedDisabled = normalizeDisabledRoles(cloned.disabledRoles);
  if (normalizedDisabled) {
    cloned.disabledRoles = normalizedDisabled;
  } else {
    delete cloned.disabledRoles;
  }
  return cloned;
}

export function formatRelativeTime(isoDate: string | null | undefined): string {
  if (!isoDate) return "agora";
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return isoDate;
  const diffSec = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (diffSec < 60) return "agora";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m atrás`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h atrás`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d atrás`;
}

const ACTIVE_SUBAGENT_STATUSES = new Set([
  "running",
  "pending",
  "queued",
  "waiting",
  "in_progress",
]);

export function isSubagentActive(status: string | null | undefined): boolean {
  if (!status) return false;
  return ACTIVE_SUBAGENT_STATUSES.has(status.toLowerCase());
}

export function formatSubagentStatusLabel(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "running" || normalized === "in_progress") return "Em execução";
  if (normalized === "pending" || normalized === "queued" || normalized === "waiting") {
    return "Aguardando";
  }
  if (normalized === "completed" || normalized === "succeeded" || normalized === "done") {
    return "Concluído";
  }
  if (normalized === "failed" || normalized === "error") return "Falhou";
  if (normalized === "canceled" || normalized === "cancelled") return "Cancelado";
  return status;
}

export function getSubagentStatusTone(
  status: string,
): "emerald" | "neutral" | "rose" | "amber" {
  const normalized = status.toLowerCase();
  if (ACTIVE_SUBAGENT_STATUSES.has(normalized)) return "emerald";
  if (normalized === "failed" || normalized === "error") return "rose";
  if (normalized === "canceled" || normalized === "cancelled") return "amber";
  return "neutral";
}

export interface InstanceSubagentSummary {
  instanceId: string;
  label: string;
  count: number;
}

export function summarizeActiveSubagentsByInstance(
  subagents: readonly SubagentActivity[],
  instances: readonly ProviderInstanceInfo[],
): InstanceSubagentSummary[] {
  const counts = new Map<string, number>();
  for (const sub of subagents) {
    if (!isSubagentActive(sub.status)) continue;
    const key = sub.providerInstanceId || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([instanceId, count]) => ({
      instanceId,
      label:
        instanceId === "unknown"
          ? "Desconhecida"
          : resolveInstanceShortLabel(instanceId, [...instances]),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function formatGlobalSwapFeedback(params: {
  instanceId: string;
  model: string;
  instances: readonly ProviderInstanceInfo[];
  report?: import("../types/ipc").GlobalSwapReport | null;
}): { status: string; partialError: string | null } {
  const { instanceId, model, instances, report } = params;
  const label = resolveInstanceShortLabel(instanceId, [...instances]);
  const parts: string[] = [
    instanceId === "codex"
      ? `Modelo global alternado: ${label} (${model}).`
      : `Instância global invertida: ${label} (${model}).`,
  ];

  if (report) {
    if (report.rebalancedRolesCount > 0) {
      parts.push(
        `${report.rebalancedRolesCount} ${
          report.rebalancedRolesCount === 1 ? "papel rebalanceado" : "papéis rebalanceados"
        }.`,
      );
    }
    if (report.resyncedProjects.length > 0) {
      parts.push(
        `${report.resyncedProjects.length} ${
          report.resyncedProjects.length === 1
            ? "projeto herdado ressincronizado"
            : "projetos herdados ressincronizados"
        }.`,
      );
    }
  }

  parts.push("Alteração vale para novas threads no T3 Code.");

  const failed = report?.failedProjects ?? [];
  const partialError =
    failed.length > 0
      ? `Falha parcial ao ressincronizar ${failed.length} ${
          failed.length === 1 ? "projeto" : "projetos"
        }: ${failed.map((f) => `${f.title} (${f.error})`).join("; ")}.`
      : null;

  return { status: parts.join(" "), partialError };
}

export function formatProjectSwapFeedback(params: {
  projectTitle: string;
  result: import("../types/ipc").SyncResult;
  instances: readonly ProviderInstanceInfo[];
}): string {
  const { projectTitle, result, instances } = params;
  const label = resolveInstanceShortLabel(result.activeInstanceId, [...instances]);
  const parts: string[] = [
    result.activeInstanceId === "codex"
      ? `Modelo alternado em ${projectTitle}: ${label} (${result.activeModel}).`
      : `Instância alternada em ${projectTitle}: ${label} (${result.activeModel}).`,
  ];

  const rebalancedCount = result.rebalancedRolesCount ?? 0;
  if (rebalancedCount > 0) {
    parts.push(
      `${rebalancedCount} ${
        rebalancedCount === 1 ? "papel rebalanceado" : "papéis rebalanceados"
      }.`,
    );
  }

  parts.push("Alteração vale para novas threads no T3 Code.");
  return parts.join(" ");
}

export interface SessionHealthMeta {
  label: string;
  tone: "emerald" | "amber" | "rose" | "neutral";
}

export function getSessionHealthMeta(status: string | null | undefined): SessionHealthMeta {
  switch (status) {
    case "ok":
      return { label: "OK", tone: "emerald" };
    case "fat_parent":
      return { label: "Pai gordo", tone: "amber" };
    case "acp_dead":
      return { label: "ACP morto", tone: "rose" };
    case "over_concurrency":
      return { label: "Muitos workers", tone: "rose" };
    default:
      return { label: status || "OK", tone: "neutral" };
  }
}

export function formatProjectSessionSummary(health: ProjectSessionHealth): string {
  const agyPart = `Agy ${health.activeAntigravityWorkers}/${health.maxConcurrentAntigravityWorkers}`;
  const primaryThread = health.deadAcpThreads[0] ?? health.fatParentThreads[0];
  if (primaryThread) {
    return `${agyPart} · pai ${primaryThread.runCount} turns · ${primaryThread.itemCount} itens`;
  }
  if (health.status === "over_concurrency") {
    return `${agyPart} · ${health.activeWorkersTotal}/${health.maxConcurrentWorkersTotal} workers`;
  }
  return `${agyPart} · saudável`;
}

export function buildSessionHandoffPrompt(params: {
  project: ProjectSummary;
  sessionPolicy?: SessionPolicy | null;
  globalPresetId?: string | null;
}): string {
  const { project, sessionPolicy, globalPresetId } = params;
  const health = project.sessionHealth;
  const meta = getSessionHealthMeta(health.status);
  const policy = sessionPolicy ?? createDefaultSessionPolicy();
  const effectiveThinking = effectiveParentThinkingLevel(policy);
  const slug =
    project.workspaceRoot.split("/").filter(Boolean).pop() ?? project.title;
  const presetLabel = project.localPresetId ?? globalPresetId ?? "default";
  const affectedThreads = [...health.deadAcpThreads, ...health.fatParentThreads];

  const lines: string[] = [
    `# Handoff de Sessão — ${project.title}`,
    "",
    `- **Motivo do alerta:** ${meta.label} (\`${health.status}\`)${health.ramWarning ? " · Alerta de RAM (8 GB)" : ""}`,
    `- **Projeto:** \`${project.title}\` (\`${project.workspaceRoot}\`)`,
    `- **Preset / Modelo:** \`${presetLabel}\` · ${project.activeInstanceId ?? "padrão"} / \`${project.activeModel ?? "padrão"}\``,
    `- **Concorrência observada:** \`Agy ${health.activeAntigravityWorkers}/${health.maxConcurrentAntigravityWorkers}\` · \`${health.activeWorkersTotal}/${health.maxConcurrentWorkersTotal}\` workers totais`,
  ];

  if (health.advisory) {
    lines.push(`- **Diagnóstico:** ${health.advisory}`);
  }

  if (affectedThreads.length > 0) {
    lines.push("", "## Threads afetadas", "");
    for (const thread of affectedThreads) {
      const errSuffix = thread.lastError ? ` · erro: \`${thread.lastError}\`` : "";
      lines.push(
        `- [${thread.status}] **${thread.title}** (\`threadId: ${thread.threadId}\`) — ${thread.runCount} turns, ${thread.itemCount} itens${errSuffix}`,
      );
    }
  }

  lines.push(
    "",
    "## Retomada recomendada no novo thread pai (T3 Code)",
    "",
    `1. Leia \`AGENTS.md\`, \`README.md\` e \`.agents/skills/${slug}-squad/SKILL.md\` (se existir).`,
    "2. Consulte o `ai-memory` (`memory_briefing`, `memory_handoff_accept`, `memory_query`) para recuperar o contexto consolidado sem reler histórico antigo.",
    "3. Verifique `git status --short` e `git diff --stat` antes de iniciar novas ondas.",
    `4. Siga a \`sessionPolicy\` (\`${policy.hardwareProfile}\`): mantenha \`parentThinkingLevel\` efetivo em \`${effectiveThinking}\`, limite de \`${policy.maxConcurrentAntigravityWorkers}\` worker(s) Antigravity e \`${policy.maxConcurrentWorkersTotal}\` worker(s) no total, delegando em \`delegateMode: "${policy.delegateMode}"\` (\`onAcpSessionDead: "${policy.onAcpSessionDead}"\`).`,
  );

  return lines.join("\n");
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below for headless/restricted environments
    }
  }
  if (typeof document !== "undefined" && typeof document.execCommand === "function") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }
  return false;
}

