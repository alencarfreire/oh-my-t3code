import type {
  CompiledFilePreview,
  CompilePreviewResult,
  DashboardSnapshot,
  PresetConfig,
  ProjectSummary,
  ProviderInstanceInfo,
  ResolvedProjectPreset,
  RoleConfig,
  SkillMetadata,
  SubagentActivity,
  SyncResult,
} from "../types/ipc";

function deriveProjectSlug(workspaceRoot: string): string {
  const parts = workspaceRoot.split("/").filter(Boolean);
  const base = parts[parts.length - 1] ?? "project";
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

function buildSeedGlobalPresets(): PresetConfig[] {
  const agyDual: PresetConfig = {
    id: "agy-dual",
    name: "Agy Dual (Veca + Principal)",
    description:
      "Preset padrão inspirado no t3-global e cabrito-squad: balanceia antigravity (Agy Veca) e antigravity_2 (Agy Principal) com gemini-4-hydrogen e gemini-4-argon e fallback em 3 níveis.",
    extends: null,
    topology: "intra-thread-squad",
    orchestrator: {
      providerInstanceId: "antigravity_2",
      model: "gemini-4-hydrogen",
      options: { thinking_level: "high" },
    },
    fallbackChain: [
      {
        providerInstanceId: "antigravity",
        model: "gemini-4-hydrogen",
        options: { thinking_level: "high" },
        reason:
          "Nível 1: Troca de instância mantendo gemini-4-hydrogen (Agy Principal ↔ Agy Veca)",
      },
      {
        providerInstanceId: "antigravity_2",
        model: "gemini-4-argon",
        options: { thinking_level: "high" },
        reason:
          "Nível 2: Troca para gemini-4-argon quando hydrogen esgotar nas duas contas",
      },
      {
        providerInstanceId: "antigravity",
        model: "gemini-4-argon",
        options: { thinking_level: "medium" },
        reason:
          "Nível 3: Último recurso entre contas Agy antes de pausar e consultar o usuário",
      },
    ],
    contention: {
      singleTestDb: false,
      envVars: { PARALLEL_WORKERS: "1" },
      gitIgnoredBuilds: ["target/", "dist/"],
      conflictFiles: ["package.json", "Cargo.toml", "tauri.conf.json"],
      defaultIsolation: "shared",
    },
    roles: {
      backend: {
        id: "backend",
        title: "Backend",
        description:
          "APIs, models, domínio, jobs, migrations e suíte de testes unitários/integração.",
        whenToUse:
          "Implementações de domínio, regras de negócio, SQL/persistência, CLIs e endpoints.",
        providerInstanceId: "antigravity",
        model: "gemini-4-hydrogen",
        options: { thinking_level: "high" },
        skills: ["tdd-and-testing", "systematic-debugging", "ai-memory-retrieval"],
        mcps: ["ai-memory", "context7"],
        allowedPaths: ["src-tauri/**", "app/**", "db/**"],
        forbiddenPaths: ["src/components/**", "app/views/**"],
        invariants: [
          "Executar ciclo Red-Green-Refactor antes de declarar conclusão.",
          "Nunca quebrar contratos de API/IPC sem alinhar com Frontend.",
        ],
        verificationCommands: [
          "cargo check --manifest-path src-tauri/Cargo.toml",
          "cargo test --manifest-path src-tauri/Cargo.toml",
        ],
      },
      frontend: {
        id: "frontend",
        title: "Frontend UI",
        description:
          "Componentes React 19, Tailwind CSS v4, acessibilidade e ergonomia visual.",
        whenToUse:
          "Telas, estados vazios, interações, estilos Tailwind v4 e tipagem de UI.",
        providerInstanceId: "antigravity_2",
        model: "gemini-4-hydrogen",
        options: { thinking_level: "medium" },
        skills: ["tailwind-v4-design", "better-accessibility", "better-ui"],
        mcps: ["context7", "playwright", "ai-memory"],
        allowedPaths: ["src/**", "app/views/**", "app/javascript/**"],
        forbiddenPaths: ["src-tauri/**", "db/migrate/**"],
        invariants: [
          "Preservar paridade estrita com o contrato IPC/API.",
          "Garantir foco visível, contraste WCAG e copy claro em pt-BR.",
        ],
        verificationCommands: ["bun run typecheck", "bun run test", "bun run build"],
      },
      "qa-reviewer": {
        id: "qa-reviewer",
        title: "QA / Security Reviewer",
        description:
          "Auditoria independente de segurança, invariantes, paridade de contrato e CI completo.",
        whenToUse: "Revisão final após implementação ou antes de encerrar entrega/PR.",
        providerInstanceId: "antigravity_2",
        model: "gemini-4-argon",
        options: { thinking_level: "high" },
        skills: [
          "code-review-and-security",
          "security-audit",
          "web-design-guidelines",
          "webapp-testing",
        ],
        mcps: ["ai-memory", "playwright"],
        allowedPaths: ["**/* (read-only audit)"],
        forbiddenPaths: ["Edições diretas de feature — devolver achados para o papel dono"],
        invariants: [
          "Rodar sempre na instância oposta à de quem implementou.",
          "Reportar saídas literais de testes, lint e build sem mascarar falhas.",
        ],
        verificationCommands: [
          "cargo test --manifest-path src-tauri/Cargo.toml",
          "bun run typecheck && bun run build",
        ],
      },
    },
  };

  const codexSquad: PresetConfig = {
    id: "codex-squad",
    name: "Codex Squad (Sol + Terra)",
    description:
      "Preset focado em OpenAI Codex com gpt-6.1-sol para arquitetura/backend e gpt-6.1-terra para UI e revisão rápida.",
    extends: null,
    topology: "intra-thread-squad",
    orchestrator: {
      providerInstanceId: "codex",
      model: "gpt-6.1-sol",
      options: { reasoningEffort: "high", serviceTier: "default" },
    },
    fallbackChain: [
      {
        providerInstanceId: "codex",
        model: "gpt-6.1-terra",
        options: { reasoningEffort: "medium", serviceTier: "default" },
        reason: "Nível 1: Reduz para gpt-6.1-terra em tarefas iterativas",
      },
      {
        providerInstanceId: "antigravity_2",
        model: "gemini-4-hydrogen",
        options: { thinking_level: "high" },
        reason: "Nível 2: Transbordo para Agy Principal em caso de limite de uso",
      },
    ],
    contention: {
      singleTestDb: true,
      envVars: { PARALLEL_WORKERS: "1" },
      gitIgnoredBuilds: ["tmp/", "log/"],
      conflictFiles: ["db/schema.rb", "config/routes.rb", "Gemfile.lock"],
      defaultIsolation: "shared",
    },
    roles: {
      backend: {
        id: "backend",
        title: "Backend",
        description: "Models, schema, auth/sessão, queries, rotas e testes de domínio.",
        whenToUse: "Mudanças em schema, serviços, APIs, jobs e lógica de negócios.",
        providerInstanceId: "codex",
        model: "gpt-6.1-sol",
        options: { reasoningEffort: "high", serviceTier: "default" },
        skills: ["tdd-and-testing", "systematic-debugging", "rails-8-modern"],
        mcps: ["ai-memory", "context7"],
        allowedPaths: ["app/models/**", "app/controllers/**", "db/**"],
        forbiddenPaths: ["app/views/**", "app/assets/**"],
        invariants: [
          "Um único executor de DB de testes por vez; sem escritas paralelas em schema/rotas.",
        ],
        verificationCommands: ["bundle exec rspec"],
      },
      frontend: {
        id: "frontend",
        title: "Frontend UI",
        description: "Views, Stimulus/React, Tailwind v4 e acessibilidade.",
        whenToUse: "Fluxos visuais, formulários, estados de erro e responsividade.",
        providerInstanceId: "codex",
        model: "gpt-6.1-terra",
        options: { reasoningEffort: "medium", serviceTier: "default" },
        skills: ["tailwind-v4-design", "better-accessibility"],
        mcps: ["playwright", "context7"],
        allowedPaths: ["app/views/**", "app/javascript/**", "src/**"],
        forbiddenPaths: ["db/migrate/**"],
        invariants: ["Manter contraste AA e navegação por teclado."],
        verificationCommands: ["bun run typecheck"],
      },
      "qa-reviewer": {
        id: "qa-reviewer",
        title: "QA Reviewer",
        description: "Revisão de contrato, regressões e segurança.",
        whenToUse: "Após implementação para checar invariantes e testes.",
        providerInstanceId: "codex",
        model: "gpt-6.1-sol",
        options: { reasoningEffort: "high", serviceTier: "default" },
        skills: ["code-review-and-security", "webapp-testing"],
        mcps: ["ai-memory", "playwright"],
        allowedPaths: ["**/*"],
        forbiddenPaths: [],
        invariants: ["Validar testes de ponta a ponta sem mocks frágeis."],
        verificationCommands: ["bundle exec rspec"],
      },
    },
  };

  const hybridPreset: PresetConfig = {
    id: "hybrid-agy-codex",
    name: "Hybrid (Agy + Codex)",
    description:
      "Combina Agy Principal (gemini-4-hydrogen) como Orquestrador/Frontend com Codex (gpt-6.1-sol) no Backend e QA independente.",
    extends: "agy-dual",
    topology: "issue-thread-orchestrator",
    orchestrator: {
      providerInstanceId: "antigravity_2",
      model: "gemini-4-hydrogen",
      options: { thinking_level: "high" },
    },
    fallbackChain: [
      {
        providerInstanceId: "codex",
        model: "gpt-6.1-sol",
        options: { reasoningEffort: "high" },
        reason: "Nível 1: Transbordo do orquestrador para Codex Sol",
      },
      {
        providerInstanceId: "antigravity",
        model: "gemini-4-argon",
        options: { thinking_level: "medium" },
        reason: "Nível 2: Reserva econômica em Agy Veca Argon",
      },
    ],
    contention: {
      singleTestDb: false,
      envVars: { PARALLEL_WORKERS: "1" },
      gitIgnoredBuilds: ["dist/", "target/"],
      conflictFiles: ["package.json"],
      defaultIsolation: "worktree",
    },
    roles: {
      ...agyDual.roles,
      backend: {
        ...agyDual.roles.backend,
        providerInstanceId: "codex",
        model: "gpt-6.1-sol",
        options: { reasoningEffort: "high" },
      },
    },
  };

  return [agyDual, codexSquad, hybridPreset];
}

function buildSeedProviderInstances(): ProviderInstanceInfo[] {
  return [
    {
      id: "antigravity_2",
      label: "Agy Principal (antigravity_2)",
      provider: "antigravity",
      isBuiltin: true,
      configured: true,
      enabled: true,
      models: ["gemini-4-hydrogen", "gemini-4-argon"],
    },
    {
      id: "antigravity",
      label: "Agy Veca (antigravity)",
      provider: "antigravity",
      isBuiltin: true,
      configured: true,
      enabled: true,
      models: ["gemini-4-hydrogen", "gemini-4-argon"],
    },
    {
      id: "codex",
      label: "Codex (Built-in)",
      provider: "codex",
      isBuiltin: true,
      configured: true,
      enabled: true,
      models: ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-astra", "gpt-6-luna"],
    },
    {
      id: "claudeAgent",
      label: "Claude Agent",
      provider: "claudeAgent",
      isBuiltin: true,
      configured: false,
      enabled: false,
      models: ["claude-sonnet-4-5", "claude-opus-4-1"],
    },
    {
      id: "opencode",
      label: "OpenCode",
      provider: "opencode",
      isBuiltin: true,
      configured: false,
      enabled: false,
      models: ["opencode-default"],
    },
    {
      id: "grok",
      label: "Grok",
      provider: "grok",
      isBuiltin: true,
      configured: false,
      enabled: false,
      models: ["grok-3"],
    },
  ];
}

function buildSeedSkills(): SkillMetadata[] {
  return [
    {
      id: "tailwind-v4-design",
      name: "tailwind-v4-design",
      description: "CSS-first @theme, paleta moderna, estados focus/hover e responsividade.",
      path: "~/.config/skillshare/skills/tailwind-v4-design/SKILL.md",
      source: "skillshare",
    },
    {
      id: "better-accessibility",
      name: "better-accessibility",
      description: "WCAG 2.2: teclado, foco visível, ARIA, nomes acessíveis e reduced-motion.",
      path: "~/.config/skillshare/skills/better-accessibility/SKILL.md",
      source: "skillshare",
    },
    {
      id: "better-ui",
      name: "better-ui",
      description: "Polimento de superfícies, raios concêntricos, ícones e microinterações.",
      path: "~/.config/skillshare/skills/better-ui/SKILL.md",
      source: "skillshare",
    },
    {
      id: "better-layout",
      name: "better-layout",
      description: "Alinhamento, agrupamento, ordem de leitura e responsividade.",
      path: "~/.config/skillshare/skills/better-layout/SKILL.md",
      source: "skillshare",
    },
    {
      id: "tdd-and-testing",
      name: "tdd-and-testing",
      description: "Ciclo estrito Red-Green-Refactor e receitas de teste para Rust/Rails/TS.",
      path: "~/.config/skillshare/skills/tdd-and-testing/SKILL.md",
      source: "skillshare",
    },
    {
      id: "systematic-debugging",
      name: "systematic-debugging",
      description: "Metodologia científica de 4 passos: Capturar, Isolar, Hipotetizar e Verificar.",
      path: "~/.config/skillshare/skills/systematic-debugging/SKILL.md",
      source: "skillshare",
    },
    {
      id: "systems-rust-go-crystal",
      name: "systems-rust-go-crystal",
      description: "Programação de sistemas, concorrência e memória segura em Rust, Go e Crystal.",
      path: "~/.config/skillshare/skills/systems-rust-go-crystal/SKILL.md",
      source: "skillshare",
    },
    {
      id: "rails-8-modern",
      name: "rails-8-modern",
      description: "Rails 8: Solid Queue/Cache/Cable, Hotwire/Turbo 8 e migrations zero-downtime.",
      path: "~/.config/skillshare/skills/rails-8-modern/SKILL.md",
      source: "skillshare",
    },
    {
      id: "code-review-and-security",
      name: "code-review-and-security",
      description: "Checklist OWASP Top 10, race conditions, memory leaks e revisão de PRs.",
      path: "~/.config/skillshare/skills/code-review-and-security/SKILL.md",
      source: "skillshare",
    },
    {
      id: "security-audit",
      name: "security-audit",
      description: "Auditoria de vulnerabilidades, validação de caminhos e revisão defensiva.",
      path: "~/.config/skillshare/skills/security-audit/SKILL.md",
      source: "skillshare",
    },
    {
      id: "web-design-guidelines",
      name: "web-design-guidelines",
      description: "Conformidade de UI com diretrizes modernas de interface web.",
      path: "~/.config/skillshare/skills/web-design-guidelines/SKILL.md",
      source: "skillshare",
    },
    {
      id: "webapp-testing",
      name: "webapp-testing",
      description: "Testes automatizados com Playwright, logs e validação visual.",
      path: "~/.config/skillshare/skills/webapp-testing/SKILL.md",
      source: "skillshare",
    },
    {
      id: "ai-memory-retrieval",
      name: "ai-memory-retrieval",
      description: "Consulta de decisões, regras e histórico do projeto no ai-memory.",
      path: "~/.gemini/config/skills/ai-memory-retrieval/SKILL.md",
      source: "gemini",
    },
    {
      id: "ai-memory-handoff",
      name: "ai-memory-handoff",
      description: "Continuidade entre sessões e handoffs no ai-memory.",
      path: "~/.gemini/config/skills/ai-memory-handoff/SKILL.md",
      source: "gemini",
    },
    {
      id: "linear-issues",
      name: "linear-issues",
      description: "Criação e estruturação de épicos, issues e sub-issues no Linear.",
      path: "~/.config/skillshare/skills/linear-issues/SKILL.md",
      source: "skillshare",
    },
  ];
}

function buildSeedProjects(): ProjectSummary[] {
  const now = Date.now();
  return [
    {
      projectId: "proj-oh-my-t3code",
      title: "oh-my-t3code",
      workspaceRoot: "/Users/alencarfreire/.t3/projects/oh-my-t3code",
      defaultModel: "gemini-4-hydrogen",
      activeInstanceId: "antigravity_2",
      activeModel: "gemini-4-hydrogen",
      updatedAt: new Date(now - 2 * 60_000).toISOString(),
      hasLocalPreset: true,
      localPresetId: "agy-dual",
      localPresetExtends: "agy-dual",
      detectedSquadSlug: "oh-my-t3code-squad",
      detectedSquadPath:
        "/Users/alencarfreire/.t3/projects/oh-my-t3code/.agents/skills/oh-my-t3code-squad",
      activeSubagentCount: 1,
    },
    {
      projectId: "proj-cabrito",
      title: "cabrito",
      workspaceRoot: "/Users/alencarfreire/Workspace/cabrito",
      defaultModel: "gemini-4-hydrogen",
      activeInstanceId: "antigravity",
      activeModel: "gemini-4-hydrogen",
      updatedAt: new Date(now - 14 * 60_000).toISOString(),
      hasLocalPreset: false,
      localPresetId: null,
      localPresetExtends: null,
      detectedSquadSlug: "cabrito-squad",
      detectedSquadPath:
        "/Users/alencarfreire/Workspace/cabrito/.agents/skills/cabrito-squad",
      activeSubagentCount: 1,
    },
    {
      projectId: "proj-dashboard-meta",
      title: "dashboard-meta",
      workspaceRoot: "/Users/alencarfreire/Workspace/dashboard-meta",
      defaultModel: "gpt-6.1-sol",
      activeInstanceId: "codex",
      activeModel: "gpt-6.1-sol",
      updatedAt: new Date(now - 52 * 60_000).toISOString(),
      hasLocalPreset: true,
      localPresetId: "dashboard-meta",
      localPresetExtends: "codex-squad",
      detectedSquadSlug: "dashboard-meta-squad",
      detectedSquadPath:
        "/Users/alencarfreire/Workspace/dashboard-meta/.agents/skills/dashboard-meta-squad",
      activeSubagentCount: 0,
    },
  ];
}

function buildSeedSubagents(): SubagentActivity[] {
  const now = Date.now();
  return [
    {
      subagentId: "sub-01",
      parentThreadId: "thr-ohmyt3-main",
      childThreadId: "thr-ohmyt3-fe",
      projectId: "proj-oh-my-t3code",
      projectTitle: "oh-my-t3code",
      role: "frontend-ui",
      title: "Implementar Popover & Preset Studio (Onda 2)",
      promptPreview: "Construir views PopoverView e StudioView em React 19 + Tailwind v4...",
      providerInstanceId: "antigravity_2",
      requestedModel: "gemini-4-hydrogen",
      resolvedModel: "gemini-4-hydrogen",
      status: "running",
      summary: null,
      errorMessage: null,
      createdAt: new Date(now - 3 * 60_000).toISOString(),
      updatedAt: new Date(now - 12_000).toISOString(),
      settledAt: null,
    },
    {
      subagentId: "sub-02",
      parentThreadId: "thr-cabrito-main",
      childThreadId: "thr-cabrito-be",
      projectId: "proj-cabrito",
      projectTitle: "cabrito",
      role: "backend",
      title: "Otimizar queries de conciliação financeira",
      promptPreview: "Adicionar índice composto e testes de concorrência...",
      providerInstanceId: "antigravity",
      requestedModel: "gemini-4-hydrogen",
      resolvedModel: "gemini-4-hydrogen",
      status: "running",
      summary: null,
      errorMessage: null,
      createdAt: new Date(now - 8 * 60_000).toISOString(),
      updatedAt: new Date(now - 30_000).toISOString(),
      settledAt: null,
    },
    {
      subagentId: "sub-03",
      parentThreadId: "thr-meta-main",
      childThreadId: "thr-meta-qa",
      projectId: "proj-dashboard-meta",
      projectTitle: "dashboard-meta",
      role: "qa-reviewer",
      title: "Auditoria de contrato Meta Insights Sync",
      promptPreview: "Validar schema, fixtures e idempotência de sync...",
      providerInstanceId: "codex",
      requestedModel: "gpt-6.1-sol",
      resolvedModel: "gpt-6.1-sol",
      status: "completed",
      summary: "18/18 testes passando; sem regressões detectadas.",
      errorMessage: null,
      createdAt: new Date(now - 45 * 60_000).toISOString(),
      updatedAt: new Date(now - 22 * 60_000).toISOString(),
      settledAt: new Date(now - 22 * 60_000).toISOString(),
    },
  ];
}

function normalizeOptionsRecord(options: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(options)) {
    const key = k === "thinkingLevel" ? "thinking_level" : k;
    if (!(key in normalized) || k === "thinking_level") {
      normalized[key] = v;
    }
  }
  return normalized;
}

function formatOptionsInline(options: Record<string, string>): string {
  const entries = Object.entries(normalizeOptionsRecord(options)).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (entries.length === 0) return "default";
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

function renderSkillMd(projectSlug: string, preset: PresetConfig): string {
  const squadName = `${projectSlug}-squad`;
  const sortedRoles = Object.entries(preset.roles).sort(([a], [b]) => a.localeCompare(b));
  const roleNames = sortedRoles.map(([, r]) => r.id).join(", ") || "nenhum papel configurado";

  const lines: string[] = [
    "---",
    `name: ${squadName}`,
    "description: >-",
    `  Atua como Tech Lead do projeto ${projectSlug} (preset \`${preset.id}\`) coordenando workers`,
    `  especializados (${roleNames}) no T3 Code via \`delegate_task\`. Use quando o`,
    `  usuário pedir para rodar a squad, dividir uma feature/bugfix por papéis ou usar \`/${squadName}\`.`,
    "---",
    "",
    `# ${projectSlug} Squad — Playbook do Orquestrador (T3 Code)`,
    "",
    `- **Preset ativo:** \`${preset.id}\` (${preset.name})`,
    `- **Topologia:** \`${preset.topology}\``,
    `- **Orquestrador:** \`${preset.orchestrator.providerInstanceId}\` / \`${preset.orchestrator.model}\` (${formatOptionsInline(preset.orchestrator.options)})`,
    "",
    "## 1. Preparação do Orquestrador",
    "",
    "1. Leia os documentos de governança do repositório (`AGENTS.md`, `README.md` e `roles/*.md`).",
    "2. Consulte o **`ai-memory` MCP** (`memory_briefing` / `memory_query`) antes de dividir tarefas.",
    "3. Chame `orchestrator_capabilities` uma única vez na thread antes do primeiro `delegate_task`.",
    "",
    "## 2. Papéis da Squad (`roles/`)",
    "",
    "| Papel | Arquivo | Quando acionar | Skills & MCPs | Modelo / Instância |",
    "| :--- | :--- | :--- | :--- | :--- |",
  ];

  for (const [roleId, role] of sortedRoles) {
    const skillsStr =
      role.skills.length > 0 ? role.skills.map((s) => `\`${s}\``).join(", ") : "—";
    const mcpsStr =
      role.mcps.length > 0 ? ` + ${role.mcps.map((m) => `\`${m}\``).join(", ")}` : "";
    const when = (role.whenToUse || role.description).replace(/\|/g, "\\|");
    lines.push(
      `| **${role.title}** | \`roles/${roleId}.md\` | ${when} | ${skillsStr}${mcpsStr} | \`${role.providerInstanceId}\` / \`${role.model}\` (${formatOptionsInline(role.options)}) |`,
    );
  }

  lines.push(
    "",
    "## 3. Topologia, Contenção & Isolamento",
    "",
    `- **Isolamento padrão:** \`${preset.contention.defaultIsolation}\``,
    `- **Banco de testes único compartilhado:** \`${String(preset.contention.singleTestDb)}\``,
  );

  const envEntries = Object.entries(preset.contention.envVars).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (envEntries.length > 0) {
    lines.push(
      `- **Variáveis obrigatórias:** ${envEntries.map(([k, v]) => `\`${k}=${v}\``).join(", ")}`,
    );
  }
  if (preset.contention.gitIgnoredBuilds.length > 0) {
    lines.push(
      `- **Builds fora do Git:** ${preset.contention.gitIgnoredBuilds.map((b) => `\`${b}\``).join(", ")}`,
    );
  }
  if (preset.contention.conflictFiles.length > 0) {
    lines.push(
      `- **Arquivos de contenção:** ${preset.contention.conflictFiles.map((c) => `\`${c}\``).join(", ")}`,
    );
  }

  lines.push("", "## 4. Cadeia de Fallback", "");
  if (preset.fallbackChain.length === 0) {
    lines.push("Nenhuma etapa de fallback configurada.");
  } else {
    preset.fallbackChain.forEach((step, idx) => {
      lines.push(
        `${idx + 1}. \`${step.providerInstanceId}\` / \`${step.model}\` (${formatOptionsInline(step.options)}) — ${step.reason}`,
      );
    });
  }

  return `${lines.join("\n")}\n`;
}

function renderRoleMd(projectSlug: string, role: RoleConfig): string {
  const lines: string[] = [
    `# Role: ${role.title} (\`${projectSlug}\`)`,
    "",
    role.description || "Especialista da squad.",
    "",
    "## Modelo e Instância Recomendados",
    `- **Instância (\`providerInstanceId\`):** \`${role.providerInstanceId}\``,
    `- **Modelo (\`model\`):** \`${role.model}\``,
    `- **Opções:** \`${formatOptionsInline(role.options)}\``,
    "",
    "## Quando acionar",
    role.whenToUse || "Quando a tarefa pertencer ao escopo deste papel.",
    "",
    "## Skills & MCPs",
    `- **Skills:** ${role.skills.length > 0 ? role.skills.map((s) => `\`${s}\``).join(", ") : "nenhuma"}`,
    `- **MCPs:** ${role.mcps.length > 0 ? role.mcps.map((m) => `\`${m}\``).join(", ") : "nenhum"}`,
    "",
    "## Escopo de Arquivos",
    `- **Permitidos:** ${role.allowedPaths.length > 0 ? role.allowedPaths.map((p) => `\`${p}\``).join(", ") : "a definir"}`,
    `- **Proibidos:** ${role.forbiddenPaths.length > 0 ? role.forbiddenPaths.map((p) => `\`${p}\``).join(", ") : "nenhum"}`,
    "",
    "## Invariantes",
  ];
  if (role.invariants.length === 0) {
    lines.push("- Seguir as convenções descritas em `AGENTS.md`.");
  } else {
    role.invariants.forEach((inv) => lines.push(`- ${inv}`));
  }
  lines.push("", "## Comandos de Verificação");
  if (role.verificationCommands.length === 0) {
    lines.push("- Executar suíte de testes e build do projeto.");
  } else {
    role.verificationCommands.forEach((cmd) => lines.push(`- \`${cmd}\``));
  }
  return `${lines.join("\n")}\n`;
}

function computeSimpleUnifiedDiff(
  label: string,
  oldText: string | null,
  newText: string,
): string {
  if (oldText === newText) {
    return "";
  }
  const oldLines = oldText ? oldText.replace(/\n$/, "").split("\n") : [];
  const newLines = newText.replace(/\n$/, "").split("\n");
  const out: string[] = [
    `--- a/${label}`,
    `+++ b/${label}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
  ];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i += 1) {
    const a = oldLines[i];
    const b = newLines[i];
    if (a === b) {
      if (a !== undefined) out.push(` ${a}`);
    } else {
      if (a !== undefined) out.push(`-${a}`);
      if (b !== undefined) out.push(`+${b}`);
    }
  }
  return `${out.join("\n")}\n`;
}

export class MockIpcStore {
  private projects: ProjectSummary[] = [];
  private subagents: SubagentActivity[] = [];
  private providerInstances: ProviderInstanceInfo[] = [];
  private globalPresets: PresetConfig[] = [];
  private skills: SkillMetadata[] = [];
  private localPresetsByProject: Map<string, PresetConfig> = new Map();
  private compiledFilesByPath: Map<string, string> = new Map();

  constructor() {
    this.reset();
  }

  reset(): void {
    this.projects = buildSeedProjects();
    this.subagents = buildSeedSubagents();
    this.providerInstances = buildSeedProviderInstances();
    this.globalPresets = buildSeedGlobalPresets();
    this.skills = buildSeedSkills();
    this.localPresetsByProject = new Map();
    this.compiledFilesByPath = new Map();

    // Seed baseline compiled files for oh-my-t3code so diffs look realistic on edit
    const basePreset = this.globalPresets[0];
    const ohMyRoot = "/Users/alencarfreire/.t3/projects/oh-my-t3code";
    const slug = deriveProjectSlug(ohMyRoot);
    this.localPresetsByProject.set("proj-oh-my-t3code", structuredClone(basePreset));
    this.compiledFilesByPath.set(
      `${ohMyRoot}/.agents/skills/${slug}-squad/SKILL.md`,
      renderSkillMd(slug, basePreset),
    );
    for (const [roleId, role] of Object.entries(basePreset.roles)) {
      this.compiledFilesByPath.set(
        `${ohMyRoot}/.agents/skills/${slug}-squad/roles/${roleId}.md`,
        renderRoleMd(slug, role),
      );
    }
  }

  getDashboardSnapshot(): DashboardSnapshot {
    return structuredClone({
      projects: this.projects,
      subagents: this.subagents,
      providerInstances: this.providerInstances,
      globalPresets: this.globalPresets,
      skills: this.skills,
      defaultModelSelection: {
        instanceId: "antigravity_2",
        model: "gemini-4-hydrogen",
        options: [{ id: "thinking_level", value: "high" }],
      },
      fallbackModelSelection: {
        instanceId: "antigravity",
        model: "gemini-4-hydrogen",
        options: [{ id: "thinking_level", value: "high" }],
      },
      sqliteAvailable: true,
      settingsAvailable: true,
    });
  }

  listGlobalPresets(): PresetConfig[] {
    return structuredClone(this.globalPresets);
  }

  getProjectPreset(projectId: string, workspaceRoot: string): ResolvedProjectPreset {
    const projectSlug = deriveProjectSlug(workspaceRoot);
    const localPreset = this.localPresetsByProject.get(projectId) ?? null;
    const project = this.projects.find((p) => p.projectId === projectId);

    let resolved: PresetConfig;
    if (localPreset) {
      resolved = structuredClone(localPreset);
    } else if (project?.activeInstanceId === "codex") {
      resolved = structuredClone(
        this.globalPresets.find((p) => p.id === "codex-squad") ?? this.globalPresets[0],
      );
    } else {
      resolved = structuredClone(this.globalPresets[0]);
    }

    return {
      projectId,
      workspaceRoot,
      projectSlug,
      hasLocalOverride: Boolean(localPreset),
      localPresetPath: `${workspaceRoot}/.t3code/preset.jsonc`,
      rawLocalPreset: localPreset ? structuredClone(localPreset) : null,
      resolvedPreset: resolved,
      detectedSquadPath: project?.detectedSquadPath ?? null,
    };
  }

  saveGlobalPreset(preset: PresetConfig): PresetConfig {
    const idx = this.globalPresets.findIndex((p) => p.id === preset.id);
    const saved = structuredClone(preset);
    if (idx >= 0) {
      this.globalPresets[idx] = saved;
    } else {
      this.globalPresets.push(saved);
    }
    return structuredClone(saved);
  }

  saveProjectPreset(
    projectId: string,
    workspaceRoot: string,
    preset: PresetConfig,
  ): ResolvedProjectPreset {
    const saved = structuredClone(preset);
    this.localPresetsByProject.set(projectId, saved);
    const proj = this.projects.find((p) => p.projectId === projectId);
    if (proj) {
      proj.hasLocalPreset = true;
      proj.localPresetId = saved.id;
      proj.localPresetExtends = saved.extends;
      proj.updatedAt = new Date().toISOString();
    }
    return this.getProjectPreset(projectId, workspaceRoot);
  }

  previewPresetSync(
    projectId: string,
    workspaceRoot: string,
    preset: PresetConfig,
  ): CompilePreviewResult {
    const projectSlug = deriveProjectSlug(workspaceRoot);
    const squadRelDir = `.agents/skills/${projectSlug}-squad`;
    const files: CompiledFilePreview[] = [];

    const skillRelative = `${squadRelDir}/SKILL.md`;
    const skillAbs = `${workspaceRoot}/${skillRelative}`;
    const existingSkill = this.compiledFilesByPath.get(skillAbs) ?? null;
    const newSkill = renderSkillMd(projectSlug, preset);
    files.push({
      path: skillAbs,
      relativePath: skillRelative,
      existingContent: existingSkill,
      newContent: newSkill,
      unifiedDiff: computeSimpleUnifiedDiff(skillRelative, existingSkill, newSkill),
      changed: existingSkill !== newSkill,
    });

    const sortedRoles = Object.entries(preset.roles).sort(([a], [b]) => a.localeCompare(b));
    for (const [roleId, role] of sortedRoles) {
      const roleRelative = `${squadRelDir}/roles/${roleId}.md`;
      const roleAbs = `${workspaceRoot}/${roleRelative}`;
      const existingRole = this.compiledFilesByPath.get(roleAbs) ?? null;
      const newRole = renderRoleMd(projectSlug, role);
      files.push({
        path: roleAbs,
        relativePath: roleRelative,
        existingContent: existingRole,
        newContent: newRole,
        unifiedDiff: computeSimpleUnifiedDiff(roleRelative, existingRole, newRole),
        changed: existingRole !== newRole,
      });
    }

    const proj = this.projects.find((p) => p.projectId === projectId);
    const existingOverride = proj?.activeInstanceId
      ? {
          defaultModelSelection: {
            instanceId: proj.activeInstanceId,
            model: proj.activeModel ?? "gemini-4-hydrogen",
          },
        }
      : null;

    const newOverride = {
      defaultModelSelection: {
        instanceId: preset.orchestrator.providerInstanceId,
        model: preset.orchestrator.model,
        options: Object.entries(
          normalizeOptionsRecord(preset.orchestrator.options),
        ).map(([id, value]) => ({
          id,
          value,
        })),
      },
    };

    const oldSettingsJson = existingOverride ? JSON.stringify(existingOverride, null, 2) : null;
    const newSettingsJson = JSON.stringify(newOverride, null, 2);
    const settingsDiff = computeSimpleUnifiedDiff(
      "settings.json",
      oldSettingsJson,
      newSettingsJson,
    );
    const settingsChanged = oldSettingsJson !== newSettingsJson;

    return {
      projectId,
      workspaceRoot,
      projectSlug,
      presetId: preset.id,
      files,
      settingsPreview: {
        settingsPath: "/Users/alencarfreire/.t3/userdata/settings.json",
        projectId,
        existingOverride,
        newOverride,
        unifiedDiff: settingsDiff,
        changed: settingsChanged,
      },
      hasChanges: settingsChanged || files.some((f) => f.changed),
    };
  }

  applyPresetSync(
    projectId: string,
    workspaceRoot: string,
    presetIdOrCustom?: string | null,
    customPreset?: PresetConfig | null,
  ): SyncResult {
    let targetPreset: PresetConfig | undefined;
    if (customPreset) {
      targetPreset = structuredClone(customPreset);
    } else if (presetIdOrCustom) {
      targetPreset = structuredClone(
        this.globalPresets.find((p) => p.id === presetIdOrCustom) ??
          this.localPresetsByProject.get(projectId) ??
          this.globalPresets[0],
      );
    } else {
      targetPreset = structuredClone(
        this.localPresetsByProject.get(projectId) ?? this.globalPresets[0],
      );
    }

    const preview = this.previewPresetSync(projectId, workspaceRoot, targetPreset);
    const writtenFiles: string[] = [];
    for (const file of preview.files) {
      this.compiledFilesByPath.set(file.path, file.newContent);
      writtenFiles.push(file.path);
    }

    this.localPresetsByProject.set(projectId, structuredClone(targetPreset));

    const proj = this.projects.find((p) => p.projectId === projectId);
    if (proj) {
      proj.activeInstanceId = targetPreset.orchestrator.providerInstanceId;
      proj.activeModel = targetPreset.orchestrator.model;
      proj.hasLocalPreset = true;
      proj.localPresetId = targetPreset.id;
      proj.localPresetExtends = targetPreset.extends ?? targetPreset.id;
      proj.detectedSquadSlug = `${preview.projectSlug}-squad`;
      proj.detectedSquadPath = `${workspaceRoot}/.agents/skills/${preview.projectSlug}-squad`;
      proj.updatedAt = new Date().toISOString();
    }

    return {
      projectId,
      workspaceRoot,
      presetId: targetPreset.id,
      writtenFiles,
      settingsPath: "/Users/alencarfreire/.t3/userdata/settings.json",
      backupPath: "/Users/alencarfreire/.t3/userdata/settings.json.bak",
      activeInstanceId: targetPreset.orchestrator.providerInstanceId,
      activeModel: targetPreset.orchestrator.model,
    };
  }

  swapProjectInstance(projectId: string, workspaceRoot: string): SyncResult {
    const proj = this.projects.find((p) => p.projectId === projectId);
    const current = proj?.activeInstanceId ?? "antigravity_2";
    const nextInstance = current === "antigravity" ? "antigravity_2" : "antigravity";
    const nextModel =
      proj?.activeModel && proj.activeModel.startsWith("gemini-")
        ? proj.activeModel
        : "gemini-4-hydrogen";

    if (proj) {
      proj.activeInstanceId = nextInstance;
      proj.activeModel = nextModel;
      proj.updatedAt = new Date().toISOString();
    }

    const local = this.localPresetsByProject.get(projectId);
    if (local) {
      local.orchestrator.providerInstanceId = nextInstance;
      local.orchestrator.model = nextModel;
    }

    return {
      projectId,
      workspaceRoot,
      presetId: local?.id ?? proj?.localPresetId ?? "agy-dual",
      writtenFiles: [],
      settingsPath: "/Users/alencarfreire/.t3/userdata/settings.json",
      backupPath: "/Users/alencarfreire/.t3/userdata/settings.json.bak",
      activeInstanceId: nextInstance,
      activeModel: nextModel,
    };
  }

  importProjectSquad(projectId: string, workspaceRoot: string): ResolvedProjectPreset {
    const slug = deriveProjectSlug(workspaceRoot);
    const base = structuredClone(this.globalPresets[0]);
    const imported: PresetConfig = {
      ...base,
      id: slug,
      name: `${slug} (Importado)`,
      description: `Preset importado automaticamente de .agents/skills/${slug}-squad/`,
      extends: "agy-dual",
    };
    this.localPresetsByProject.set(projectId, imported);
    const proj = this.projects.find((p) => p.projectId === projectId);
    if (proj) {
      proj.hasLocalPreset = true;
      proj.localPresetId = imported.id;
      proj.localPresetExtends = imported.extends;
      proj.detectedSquadSlug = `${slug}-squad`;
      proj.detectedSquadPath = `${workspaceRoot}/.agents/skills/${slug}-squad`;
    }
    return this.getProjectPreset(projectId, workspaceRoot);
  }
}
