import type {
  CompiledFilePreview,
  CompilePreviewResult,
  DashboardSnapshot,
  FailedProjectResync,
  GlobalAppConfig,
  GlobalSessionHealth,
  GlobalSwapReport,
  PresetConfig,
  ProjectSessionHealth,
  ProjectSummary,
  ProviderInstanceInfo,
  ResolvedProjectPreset,
  ResyncedProjectReport,
  RoleConfig,
  SessionPolicy,
  SkillMetadata,
  SubagentActivity,
  SyncResult,
  T3ModelSelection,
} from "../types/ipc";
import {
  createDefaultSessionPolicy,
  effectiveOrchestratorOptions,
  effectiveParentThinkingLevel,
  isValidSafeId,
  normalizeDisabledRoles,
} from "./preset-utils";

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
  const defaultPreset: PresetConfig = {
    id: "default",
    name: "Default (OMOS Standard)",
    description:
      "Preset global padrão de instalação (inspirado no default do oh-my-opencode-slim): orquestrador, oracle e fixer em gpt-6.1-sol, explorer e designer em gpt-6-luna, e qa-reviewer em gpt-6-astra.",
    extends: null,
    enabled: true,
    topology: "intra-thread-squad",
    orchestrator: {
      providerInstanceId: "codex",
      model: "gpt-6.1-sol",
      options: { reasoningEffort: "medium", serviceTier: "default" },
    },
    fallbackChain: [
      {
        providerInstanceId: "codex",
        model: "gpt-6.1-terra",
        options: { reasoningEffort: "high", serviceTier: "default" },
        reason: "Nível 1: Fallback rápido mantendo raciocínio alto em gpt-6.1-terra",
      },
      {
        providerInstanceId: "codex",
        model: "gpt-6-astra",
        options: { reasoningEffort: "high", serviceTier: "default" },
        reason:
          "Nível 2: Fallback alternativo em gpt-6-astra quando o modelo primário atingir limite",
      },
      {
        providerInstanceId: "codex",
        model: "gpt-6-luna",
        options: { reasoningEffort: "medium", serviceTier: "default" },
        reason: "Nível 3: Fallback leve de continuidade em gpt-6-luna antes de pausar",
      },
    ],
    contention: {
      singleTestDb: false,
      envVars: {},
      gitIgnoredBuilds: ["target/", "dist/"],
      conflictFiles: ["package.json", "Cargo.toml", "tauri.conf.json"],
      defaultIsolation: "shared",
    },
    sessionPolicy: createDefaultSessionPolicy(),
    roles: {
      explorer: {
        id: "explorer",
        title: "Explorer",
        description:
          "Pesquisa rápida read-only no codebase e documentação (context7, ai-memory).",
        whenToUse:
          "Descoberta inicial de arquivos, símbolos, contratos IPC e documentação via context7/ai-memory.",
        providerInstanceId: "codex",
        model: "gpt-6-luna",
        options: { reasoningEffort: "low", serviceTier: "default" },
        skills: ["ai-memory-retrieval", "systematic-debugging"],
        mcps: ["context7", "ai-memory"],
        allowedPaths: ["**/* (read-only)"],
        forbiddenPaths: ["Edições em arquivos de código ou configuração"],
        invariants: [
          "Atuar estritamente em modo read-only retornando paths e símbolos verificados.",
        ],
        verificationCommands: [],
      },
      oracle: {
        id: "oracle",
        title: "Oracle",
        description:
          "Revisão de arquitetura, decisões de alto risco, simplificação e debug de último recurso.",
        whenToUse:
          "Decisões estruturais, migrações críticas, concorrência e análise de causa raiz difícil.",
        providerInstanceId: "codex",
        model: "gpt-6.1-sol",
        options: { reasoningEffort: "high", serviceTier: "default" },
        skills: [
          "systematic-debugging",
          "code-review-and-security",
          "ai-memory-retrieval",
        ],
        mcps: ["ai-memory", "context7"],
        allowedPaths: ["**/* (arquitetura e diagnóstico)"],
        forbiddenPaths: ["Mudanças cosméticas fora do escopo arquitetural"],
        invariants: [
          "Preservar acesso read-only ao statev2.sqlite e escrita atômica com backup em settings.json.",
        ],
        verificationCommands: ["cargo check --manifest-path src-tauri/Cargo.toml"],
      },
      designer: {
        id: "designer",
        title: "Designer",
        description:
          "Implementação de UI/UX, layout, hierarquia visual, responsividade e Tailwind CSS v4.",
        whenToUse:
          "Telas, estados vazios, interações, acessibilidade, design tokens e componentes visuais.",
        providerInstanceId: "codex",
        model: "gpt-6-luna",
        options: { reasoningEffort: "medium", serviceTier: "default" },
        skills: [
          "tailwind-v4-design",
          "frontend-design",
          "better-ui",
          "better-accessibility",
          "better-layout",
        ],
        mcps: ["context7", "playwright", "ai-memory"],
        allowedPaths: ["src/**", "app/views/**", "app/javascript/**"],
        forbiddenPaths: ["src-tauri/**", "db/migrate/**"],
        invariants: [
          "Preservar paridade estrita com o contrato IPC/API.",
          "Garantir foco visível, contraste WCAG e copy claro.",
        ],
        verificationCommands: ["bun run typecheck", "bun run test", "bun run build"],
      },
      fixer: {
        id: "fixer",
        title: "Fixer",
        description:
          "Especialista de implementação rápida e mudanças mecânicas/multi-arquivo bem definidas.",
        whenToUse:
          "Implementações de domínio, APIs, persistência, CLIs, módulos Rust/Rails e correções com testes.",
        providerInstanceId: "codex",
        model: "gpt-6.1-sol",
        options: { reasoningEffort: "low", serviceTier: "default" },
        skills: [
          "tdd-and-testing",
          "systems-rust-go-crystal",
          "rails-8-modern",
          "systematic-debugging",
        ],
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
      "qa-reviewer": {
        id: "qa-reviewer",
        title: "QA / Security Reviewer",
        description:
          "Auditoria independente de qualidade, segurança e execução completa da suíte de testes/CI.",
        whenToUse: "Revisão final após implementação ou antes de encerrar entrega/PR.",
        providerInstanceId: "codex",
        model: "gpt-6-astra",
        options: { reasoningEffort: "high", serviceTier: "default" },
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
          "Auditar de forma independente sem editar arquivos de feature.",
          "Reportar saídas literais de testes, lint e build sem mascarar falhas.",
        ],
        verificationCommands: [
          "cargo test --manifest-path src-tauri/Cargo.toml",
          "bun run typecheck && bun run build",
        ],
      },
    },
  };

  const agyDual: PresetConfig = {
    id: "agy-dual",
    name: "Agy Dual (Veca + Principal)",
    description:
      "Preset padrão inspirado no t3-global e cabrito-squad: balanceia antigravity (Agy Veca) e antigravity_2 (Agy Principal) com gemini-4-hydrogen e gemini-4-argon e fallback em 3 níveis.",
    extends: null,
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
    sessionPolicy: createDefaultSessionPolicy(),
    roles: {
      explorer: {
        id: "explorer",
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
        allowedPaths: ["**/* (read-only)"],
        forbiddenPaths: ["Edições em arquivos de código ou configuração"],
        invariants: [
          "Atuar estritamente em modo read-only retornando paths e símbolos verificados.",
        ],
        verificationCommands: [],
      },
      oracle: {
        id: "oracle",
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
        allowedPaths: ["**/* (arquitetura e diagnóstico)"],
        forbiddenPaths: ["Mudanças cosméticas fora do escopo arquitetural"],
        invariants: [
          "Preservar acesso read-only ao statev2.sqlite e escrita atômica com backup em settings.json.",
        ],
        verificationCommands: ["cargo check --manifest-path src-tauri/Cargo.toml"],
      },
      designer: {
        id: "designer",
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
          "better-ui",
          "better-accessibility",
          "better-layout",
        ],
        mcps: ["context7", "playwright", "ai-memory"],
        allowedPaths: ["src/**", "app/views/**", "app/javascript/**"],
        forbiddenPaths: ["src-tauri/**", "db/migrate/**"],
        invariants: [
          "Preservar paridade estrita com o contrato IPC/API.",
          "Garantir foco visível, contraste WCAG e copy claro em pt-BR.",
        ],
        verificationCommands: ["bun run typecheck", "bun run test", "bun run build"],
      },
      fixer: {
        id: "fixer",
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
      "Preset estruturado estilo oh-my-opencode-slim para OpenAI Codex: Luna (explorer), Sol (oracle/fixer), Terra (designer) e Astra (qa-reviewer).",
    extends: null,
    enabled: true,
    topology: "issue-thread-orchestrator",
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
    sessionPolicy: createDefaultSessionPolicy(),
    roles: {
      explorer: {
        id: "explorer",
        title: "Explorer",
        description: "Pesquisa rápida e mapeamento read-only com gpt-6-luna.",
        whenToUse: "Busca de símbolos e leitura de docs.",
        providerInstanceId: "codex",
        model: "gpt-6-luna",
        options: { reasoningEffort: "low", serviceTier: "default" },
        skills: ["ai-memory-retrieval", "systematic-debugging"],
        mcps: ["context7", "ai-memory"],
        allowedPaths: ["**/* (read-only)"],
        forbiddenPaths: ["Edições em produção"],
        invariants: ["Atuar em modo somente leitura."],
        verificationCommands: [],
      },
      oracle: {
        id: "oracle",
        title: "Oracle",
        description: "Arquitetura e debug complexo com gpt-6.1-sol (xhigh).",
        whenToUse: "Decisões de schema, concorrência e debugging profundo.",
        providerInstanceId: "codex",
        model: "gpt-6.1-sol",
        options: { reasoningEffort: "xhigh", serviceTier: "default" },
        skills: ["systematic-debugging", "code-review-and-security"],
        mcps: ["ai-memory", "context7"],
        allowedPaths: ["**/*"],
        forbiddenPaths: [],
        invariants: ["Preservar integridade de schema e contratos."],
        verificationCommands: ["git status --short"],
      },
      designer: {
        id: "designer",
        title: "Designer",
        description: "UI/UX, React/Tailwind v4 e acessibilidade com gpt-6.1-terra.",
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
      fixer: {
        id: "fixer",
        title: "Fixer",
        description: "Implementação de backend, models, rotas e testes com gpt-6.1-sol.",
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
      "qa-reviewer": {
        id: "qa-reviewer",
        title: "QA Reviewer",
        description: "Revisão de contrato, regressões e segurança com gpt-6-astra.",
        whenToUse: "Após implementação para checar invariantes e testes.",
        providerInstanceId: "codex",
        model: "gpt-6-astra",
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
      "Combina Agy Principal (gemini-4-hydrogen) como Orquestrador/Designer com Codex (gpt-6.1-sol) no Fixer e QA independente.",
    extends: "agy-dual",
    enabled: true,
    topology: "issue-thread-orchestrator",
    orchestrator: {
      providerInstanceId: "antigravity_2",
      model: "gemini-4-hydrogen",
      options: { thinking_level: "medium" },
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
    sessionPolicy: createDefaultSessionPolicy(),
    roles: {
      ...agyDual.roles,
      fixer: {
        ...agyDual.roles.fixer,
        providerInstanceId: "codex",
        model: "gpt-6.1-sol",
        options: { reasoningEffort: "high", serviceTier: "default" },
      },
    },
  };

  return [defaultPreset, agyDual, codexSquad, hybridPreset];
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

function defaultProjectSessionHealth(
  projectId: string,
  activeAntigravityWorkers = 0,
  activeWorkersTotal = 0,
): ProjectSessionHealth {
  return {
    projectId,
    status: "ok",
    activeAntigravityWorkers,
    activeWorkersTotal,
    maxConcurrentAntigravityWorkers: 2,
    maxConcurrentWorkersTotal: 3,
    ramWarning: false,
    fatParentThreads: [],
    deadAcpThreads: [],
    advisory: null,
  };
}

export function createMockSessionHealthScenario(
  scenario: "ok" | "fat_parent" | "acp_dead" | "over_concurrency",
  projectId = "proj-oh-my-t3code",
): ProjectSessionHealth {
  const nowIso = new Date().toISOString();
  if (scenario === "acp_dead") {
    return {
      projectId,
      status: "acp_dead",
      activeAntigravityWorkers: 1,
      activeWorkersTotal: 1,
      maxConcurrentAntigravityWorkers: 2,
      maxConcurrentWorkersTotal: 3,
      ramWarning: false,
      fatParentThreads: [],
      deadAcpThreads: [
        {
          threadId: "thr-acp-dead-6ms",
          projectId,
          title: "Squad — Sessão ACP interrompida",
          runCount: 6,
          itemCount: 42,
          status: "acp_dead",
          lastError: "provider_error: AcpRequestError — run failed in 6 ms",
          updatedAt: nowIso,
        },
      ],
      advisory:
        "1 thread(s) com sessão ACP morta detectada — abra uma nova thread (advise-new-thread) em vez de continuar na mesma.",
    };
  }
  if (scenario === "fat_parent") {
    return {
      projectId,
      status: "fat_parent",
      activeAntigravityWorkers: 2,
      activeWorkersTotal: 2,
      maxConcurrentAntigravityWorkers: 2,
      maxConcurrentWorkersTotal: 3,
      ramWarning: false,
      fatParentThreads: [
        {
          threadId: "thr-fat-parent-18",
          projectId,
          title: "Tech Lead — Feature extensa (Onda 2)",
          runCount: 18,
          itemCount: 830,
          status: "fat_parent",
          lastError: null,
          updatedAt: nowIso,
        },
      ],
      deadAcpThreads: [],
      advisory:
        "1 thread(s) pai atingiram o limiar de handoff (15 turns ou 120 itens).",
    };
  }
  if (scenario === "over_concurrency") {
    return {
      projectId,
      status: "over_concurrency",
      activeAntigravityWorkers: 3,
      activeWorkersTotal: 4,
      maxConcurrentAntigravityWorkers: 2,
      maxConcurrentWorkersTotal: 3,
      ramWarning: true,
      fatParentThreads: [],
      deadAcpThreads: [],
      advisory:
        "Concorrência acima do limite (3/2 Antigravity, 4/3 total) [alerta de RAM em laptop-8gb].",
    };
  }
  return defaultProjectSessionHealth(projectId, 0, 0);
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
      presetEnabled: true,
      hasCustomOverride: true,
      detectedSquadSlug: "oh-my-t3code-squad",
      detectedSquadPath:
        "/Users/alencarfreire/.t3/projects/oh-my-t3code/.agents/skills/oh-my-t3code-squad",
      activeSubagentCount: 1,
      sessionHealth: defaultProjectSessionHealth("proj-oh-my-t3code", 1, 1),
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
      presetEnabled: true,
      hasCustomOverride: true,
      detectedSquadSlug: "cabrito-squad",
      detectedSquadPath:
        "/Users/alencarfreire/Workspace/cabrito/.agents/skills/cabrito-squad",
      activeSubagentCount: 1,
      sessionHealth: defaultProjectSessionHealth("proj-cabrito", 1, 1),
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
      presetEnabled: true,
      hasCustomOverride: true,
      detectedSquadSlug: "dashboard-meta-squad",
      detectedSquadPath:
        "/Users/alencarfreire/Workspace/dashboard-meta/.agents/skills/dashboard-meta-squad",
      activeSubagentCount: 0,
      sessionHealth: defaultProjectSessionHealth("proj-dashboard-meta", 0, 0),
    },
    {
      projectId: "proj-landing-page",
      title: "landing-page",
      workspaceRoot: "/Users/alencarfreire/Workspace/landing-page",
      defaultModel: "gemini-4-hydrogen",
      activeInstanceId: "antigravity_2",
      activeModel: "gemini-4-hydrogen",
      updatedAt: new Date(now - 3 * 60 * 60_000).toISOString(),
      hasLocalPreset: false,
      localPresetId: null,
      localPresetExtends: null,
      presetEnabled: true,
      hasCustomOverride: false,
      detectedSquadSlug: null,
      detectedSquadPath: null,
      activeSubagentCount: 0,
      sessionHealth: defaultProjectSessionHealth("proj-landing-page", 0, 0),
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

  const effOrchOptions = effectiveOrchestratorOptions(preset);
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
    `- **Orquestrador:** \`${preset.orchestrator.providerInstanceId}\` / \`${preset.orchestrator.model}\` (${formatOptionsInline(effOrchOptions)})`,
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

  const sp = preset.sessionPolicy;
  const effParentThinking = effectiveParentThinkingLevel(sp);
  lines.push(
    "",
    "## 5. Gestão de sessão e concorrência (oh-my-t3code)",
    "",
    `- **Perfil de hardware:** \`${sp.hardwareProfile}\``,
    `- **Limite simultâneo Antigravity (ACP):** \`${sp.maxConcurrentAntigravityWorkers}\` worker(s)`,
    `- **Limite simultâneo total de workers:** \`${sp.maxConcurrentWorkersTotal}\` worker(s)`,
    `- **Handoff do chat pai:** após \`${sp.parentMaxTurnsBeforeHandoff}\` turns ou \`${sp.parentMaxItemsBeforeHandoff}\` itens`,
    `- **Limiares de tokens do chat pai:** aviso em \`${sp.parentWarnInputTokens}\` / handoff obrigatório em \`${sp.parentHardInputTokens}\``,
    `- **Thinking efetivo do chat pai:** \`${effParentThinking}\` (configurado: \`${sp.parentThinkingLevel}\`)`,
    `- **Modo padrão de delegação:** \`${sp.delegateMode}\``,
    `- **Ao detectar sessão ACP morta:** \`${sp.onAcpSessionDead}\``,
    "",
    "### Thinking dos workers por tipo",
    "",
  );

  const sortedKinds = Object.entries(sp.workerThinkingByKind).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (sortedKinds.length === 0) {
    lines.push("Nenhuma regra por tipo configurada.", "");
  } else {
    lines.push("| Tipo | Modelo | Thinking |", "| :--- | :--- | :--- |");
    for (const [kind, rule] of sortedKinds) {
      lines.push(`| \`${kind}\` | \`${rule.model}\` | \`${rule.thinkingLevel}\` |`);
    }
    lines.push("");
  }

  lines.push("### Padrões proibidos", "");
  if (sp.forbiddenPatterns.length === 0) {
    lines.push("Nenhum padrão proibido configurado.", "");
  } else {
    for (const pattern of sp.forbiddenPatterns) {
      lines.push(`- \`${pattern}\``);
    }
    lines.push("");
  }

  const isolationRule =
    preset.contention.defaultIsolation === "worktree" &&
    (sp.maxConcurrentAntigravityWorkers <= 1 || sp.maxConcurrentWorkersTotal <= 1)
      ? 'como o limite de concorrência é `<= 1`, force ondas sequenciais com `isolation: "shared"` (não abra múltiplos worktrees simultâneos).'
      : "respeite o isolamento padrão configurado mantendo no máximo os limites de concorrência acima.";

  lines.push(
    "### Regras operacionais obrigatórias",
    "",
    '1. O orquestrador **nunca** edita código diretamente nem implementa no mesmo chat — delegue via `delegate_task` (`mode: "async"`).',
    `2. Respeite o teto de concorrência: no máximo \`${sp.maxConcurrentAntigravityWorkers}\` worker(s) Antigravity (ACP) e \`${sp.maxConcurrentWorkersTotal}\` worker(s) no total por onda.`,
    `3. Mantenha \`thinking_level: "${effParentThinking}"\` no chat pai (em \`laptop-8gb\`, \`high\`/\`xhigh\` são sempre rebaixados para \`medium\`).`,
    "4. Aplique `workerThinkingByKind` conforme a natureza da sub-tarefa (`research`, `frontend`, `backend`, `architecture`, `qa`).",
    `5. **Isolamento (\`${preset.contention.defaultIsolation}\`):** ${isolationRule}`,
    `6. **Handoff proativo:** ao atingir \`${sp.parentMaxTurnsBeforeHandoff}\` turns, \`${sp.parentMaxItemsBeforeHandoff}\` itens ou \`${sp.parentWarnInputTokens}\`/\`${sp.parentHardInputTokens}\` tokens no chat pai, salve \`memory_handoff_begin\` no \`ai-memory\` e inicie uma nova thread.`,
    `7. **Sessão ACP morta:** diante de \`provider_error\` / \`AcpRequestError\` ou falha em \`< 1000ms\`, não insista na mesma thread — aplique \`${sp.onAcpSessionDead}\` e abra uma nova thread.`,
    "8. Evite polling em loop (`task_status` / `sleep`); aguarde o retorno reativo das ondas.",
  );

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

const COMPILER_PLAYBOOK_SIGNATURE = "— Playbook do Orquestrador (T3 Code)";
const MAX_INHERITANCE_DEPTH = 16;

function selectionFromPreset(preset: PresetConfig): T3ModelSelection {
  const normalizedOptions = effectiveOrchestratorOptions(preset);
  return {
    instanceId: preset.orchestrator.providerInstanceId,
    model: preset.orchestrator.model,
    options: Object.entries(normalizedOptions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, value]) => ({ id, value })),
  };
}

function stripDisabledRoles(preset: PresetConfig): PresetConfig {
  const cloned = structuredClone(preset);
  const normalizedDisabled = normalizeDisabledRoles(cloned.disabledRoles);
  if (normalizedDisabled) {
    cloned.disabledRoles = normalizedDisabled;
    for (const disabledId of normalizedDisabled) {
      delete cloned.roles[disabledId];
    }
  } else {
    delete cloned.disabledRoles;
  }
  return cloned;
}

function mergeSessionPolicy(base: SessionPolicy, patch?: Partial<SessionPolicy>): SessionPolicy {
  if (!patch) return structuredClone(base);
  const mergedWorkerThinking: Record<string, { model: string; thinkingLevel: string }> =
    structuredClone(base.workerThinkingByKind);
  if (patch.workerThinkingByKind) {
    for (const [kind, rule] of Object.entries(patch.workerThinkingByKind)) {
      const existing = mergedWorkerThinking[kind];
      mergedWorkerThinking[kind] = {
        model: rule.model || existing?.model || "",
        thinkingLevel: rule.thinkingLevel || existing?.thinkingLevel || "",
      };
    }
  }
  return {
    hardwareProfile: patch.hardwareProfile || base.hardwareProfile,
    maxConcurrentAntigravityWorkers:
      patch.maxConcurrentAntigravityWorkers ?? base.maxConcurrentAntigravityWorkers,
    maxConcurrentWorkersTotal:
      patch.maxConcurrentWorkersTotal ?? base.maxConcurrentWorkersTotal,
    parentMaxTurnsBeforeHandoff:
      patch.parentMaxTurnsBeforeHandoff ?? base.parentMaxTurnsBeforeHandoff,
    parentMaxItemsBeforeHandoff:
      patch.parentMaxItemsBeforeHandoff ?? base.parentMaxItemsBeforeHandoff,
    parentWarnInputTokens:
      patch.parentWarnInputTokens ?? base.parentWarnInputTokens,
    parentHardInputTokens:
      patch.parentHardInputTokens ?? base.parentHardInputTokens,
    parentThinkingLevel: patch.parentThinkingLevel || base.parentThinkingLevel,
    workerThinkingByKind: mergedWorkerThinking,
    delegateMode: patch.delegateMode || base.delegateMode,
    onAcpSessionDead: patch.onAcpSessionDead || base.onAcpSessionDead,
    forbiddenPatterns: patch.forbiddenPatterns
      ? [...patch.forbiddenPatterns]
      : [...base.forbiddenPatterns],
  };
}

function mergePresetPatch(base: PresetConfig, patch: PresetConfig): PresetConfig {
  const id = patch.id || base.id;
  const name = patch.name.trim() ? patch.name : base.name;
  const description = patch.description.trim() ? patch.description : base.description;
  const enabled = patch.enabled;
  const topology = patch.topology || base.topology;

  const orchestrator = {
    providerInstanceId:
      patch.orchestrator.providerInstanceId || base.orchestrator.providerInstanceId,
    model: patch.orchestrator.model || base.orchestrator.model,
    options: {
      ...base.orchestrator.options,
      ...patch.orchestrator.options,
    },
  };

  const fallbackChain =
    patch.fallbackChain !== undefined
      ? structuredClone(patch.fallbackChain)
      : structuredClone(base.fallbackChain);

  const contention = {
    singleTestDb: patch.contention.singleTestDb,
    envVars: {
      ...base.contention.envVars,
      ...patch.contention.envVars,
    },
    gitIgnoredBuilds: [...patch.contention.gitIgnoredBuilds],
    conflictFiles: [...patch.contention.conflictFiles],
    defaultIsolation:
      patch.contention.defaultIsolation || base.contention.defaultIsolation,
  };

  const sessionPolicy = mergeSessionPolicy(base.sessionPolicy, patch.sessionPolicy);

  const disabledSet = new Set<string>(base.disabledRoles ?? []);
  const patchDisabledSet = new Set<string>(patch.disabledRoles ?? []);
  for (const disabledId of patchDisabledSet) {
    disabledSet.add(disabledId);
  }

  const roles: Record<string, RoleConfig> = structuredClone(base.roles);
  for (const [roleId, role] of Object.entries(patch.roles)) {
    if (!patchDisabledSet.has(roleId)) {
      disabledSet.delete(roleId);
    }
    const existing = roles[roleId];
    roles[roleId] = {
      ...(existing ? structuredClone(existing) : {}),
      ...structuredClone(role),
      options: {
        ...(existing?.options ?? {}),
        ...(role.options ?? {}),
      },
    };
  }

  for (const disabledId of disabledSet) {
    delete roles[disabledId];
  }

  const disabledRoles = Array.from(disabledSet).sort();

  const merged: PresetConfig = {
    id,
    name,
    description,
    extends: patch.extends,
    enabled,
    topology,
    orchestrator,
    fallbackChain,
    contention,
    sessionPolicy,
    roles,
  };
  if (disabledRoles.length > 0) {
    merged.disabledRoles = disabledRoles;
  }
  return merged;
}

export class MockIpcStore {
  private globalConfig: GlobalAppConfig = {
    activeGlobalPresetId: "default",
    enabled: true,
  };
  private projects: ProjectSummary[] = [];
  private subagents: SubagentActivity[] = [];
  private providerInstances: ProviderInstanceInfo[] = [];
  private globalPresets: PresetConfig[] = [];
  private skills: SkillMetadata[] = [];
  private localPresetsByProject: Map<string, PresetConfig> = new Map();
  private compiledFilesByPath: Map<string, string> = new Map();
  private projectSettingsOverrides: Map<string, T3ModelSelection> = new Map();

  constructor() {
    this.reset();
  }

  reset(): void {
    this.globalConfig = {
      activeGlobalPresetId: "default",
      enabled: true,
    };
    this.projects = buildSeedProjects();
    this.subagents = buildSeedSubagents();
    this.providerInstances = buildSeedProviderInstances();
    this.globalPresets = buildSeedGlobalPresets();
    this.skills = buildSeedSkills();
    this.localPresetsByProject = new Map();
    this.compiledFilesByPath = new Map();
    this.projectSettingsOverrides = new Map();

    // Seed baseline compiled files for oh-my-t3code so diffs look realistic on edit
    const basePreset =
      this.globalPresets.find((p) => p.id === "agy-dual") ?? this.globalPresets[0];
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
    this.projectSettingsOverrides.set(
      "proj-oh-my-t3code",
      selectionFromPreset(basePreset),
    );

    // Seed cabrito as a manual external squad (without compiler signature)
    this.compiledFilesByPath.set(
      "/Users/alencarfreire/Workspace/cabrito/.agents/skills/cabrito-squad/SKILL.md",
      "# cabrito Squad — Manual\n",
    );
    this.projectSettingsOverrides.set("proj-cabrito", {
      instanceId: "antigravity",
      model: "gemini-4-hydrogen",
      options: [],
    });

    const codexPreset = this.globalPresets.find((p) => p.id === "codex-squad");
    if (codexPreset) {
      this.localPresetsByProject.set("proj-dashboard-meta", {
        ...structuredClone(codexPreset),
        id: "dashboard-meta",
        name: "dashboard-meta",
        extends: "codex-squad",
      });
      this.projectSettingsOverrides.set(
        "proj-dashboard-meta",
        selectionFromPreset(codexPreset),
      );
    }
  }

  getCompiledFilePaths(): string[] {
    return Array.from(this.compiledFilesByPath.keys()).sort();
  }

  hasProjectSettingsOverride(projectId: string): boolean {
    return this.projectSettingsOverrides.has(projectId);
  }

  setProjectSessionHealth(
    projectId: string,
    health: ProjectSessionHealth,
  ): void {
    const proj = this.projects.find((p) => p.projectId === projectId);
    if (proj) {
      proj.sessionHealth = structuredClone(health);
    }
  }

  private assertValidPresetStructure(preset: PresetConfig): void {
    if (!isValidSafeId(preset.id)) {
      throw new Error(`Invalid preset id '${preset.id}'`);
    }
    if (preset.extends !== null && preset.extends !== undefined && preset.extends !== "") {
      if (!isValidSafeId(preset.extends)) {
        throw new Error(`Invalid extends preset id '${preset.extends}'`);
      }
      if (preset.extends === preset.id) {
        throw new Error(`Preset '${preset.id}' cannot extend itself`);
      }
    }
    for (const [roleId, role] of Object.entries(preset.roles)) {
      if (!isValidSafeId(roleId)) {
        throw new Error(`Invalid role id '${roleId}'`);
      }
      if (!role.id) {
        role.id = roleId;
      }
    }
    for (const kind of Object.keys(preset.sessionPolicy?.workerThinkingByKind ?? {})) {
      if (!isValidSafeId(kind)) {
        throw new Error(`Invalid workerThinkingByKind key '${kind}'`);
      }
    }
  }

  private resolvePresetInheritance(
    preset: PresetConfig,
    visited: Set<string> = new Set(),
    depth = 0,
    catalog: PresetConfig[] = this.globalPresets,
  ): PresetConfig {
    const normalized = stripDisabledRoles(preset);
    if (!normalized.extends) {
      return normalized;
    }
    if (depth >= MAX_INHERITANCE_DEPTH) {
      throw new Error(`Inheritance depth exceeded ${MAX_INHERITANCE_DEPTH} at '${normalized.id}'`);
    }
    if (normalized.extends === normalized.id) {
      throw new Error(`Preset '${normalized.id}' cannot extend itself`);
    }
    if (visited.has(normalized.extends)) {
      throw new Error(`Preset '${normalized.extends}' participates in an inheritance cycle`);
    }
    const parentRaw = catalog.find((p) => p.id === normalized.extends);
    if (!parentRaw) {
      throw new Error(`Global preset '${normalized.extends}' not found`);
    }
    const nextVisited = new Set(visited);
    nextVisited.add(normalized.id);
    const resolvedParent = this.resolvePresetInheritance(
      parentRaw,
      nextVisited,
      depth + 1,
      catalog,
    );
    return mergePresetPatch(resolvedParent, normalized);
  }

  private resolveGlobalPresetById(id: string): PresetConfig | null {
    const found = this.globalPresets.find((p) => p.id === id);
    return found ? this.resolvePresetInheritance(found) : null;
  }

  private resolveGlobalFallbackPreset(): PresetConfig {
    const candidates = [
      this.globalConfig.activeGlobalPresetId,
      "default",
      "agy-dual",
    ];
    let lastError: unknown = null;
    for (const candidateId of candidates) {
      const found = this.globalPresets.find((p) => p.id === candidateId);
      if (!found) continue;
      try {
        return this.resolvePresetInheritance(found);
      } catch (err) {
        lastError = err;
      }
    }
    if (this.globalPresets[0]) {
      return this.resolvePresetInheritance(this.globalPresets[0]);
    }
    if (lastError) {
      throw lastError;
    }
    throw new Error("No global presets available");
  }

  private applyGlobalFallbackToProject(proj: ProjectSummary): void {
    if (!this.globalConfig.enabled) {
      proj.activeInstanceId = null;
      proj.activeModel = proj.defaultModel;
      return;
    }
    const activeGlobal =
      this.resolveGlobalPresetById(this.globalConfig.activeGlobalPresetId) ??
      this.resolveGlobalPresetById("default") ??
      this.resolveGlobalPresetById(this.globalPresets[0]?.id ?? "agy-dual");
    if (activeGlobal) {
      proj.activeInstanceId = activeGlobal.orchestrator.providerInstanceId;
      proj.activeModel = activeGlobal.orchestrator.model;
    } else {
      proj.activeInstanceId = null;
      proj.activeModel = proj.defaultModel;
    }
  }

  getDashboardSnapshot(): DashboardSnapshot {
    const resolvedGlobalPresets = this.globalPresets.map((p) =>
      this.resolvePresetInheritance(p),
    );
    const activeGlobal =
      resolvedGlobalPresets.find((p) => p.id === this.globalConfig.activeGlobalPresetId) ??
      resolvedGlobalPresets[0];
    const firstFallback = activeGlobal?.fallbackChain[0];
    const globalEnabled = this.globalConfig.enabled;
    const policy = activeGlobal?.sessionPolicy ?? createDefaultSessionPolicy();

    const activeAntigravityWorkers = this.projects.reduce(
      (sum, p) => sum + (p.sessionHealth?.activeAntigravityWorkers ?? 0),
      0,
    );
    const activeWorkersTotal = this.projects.reduce(
      (sum, p) => sum + (p.sessionHealth?.activeWorkersTotal ?? 0),
      0,
    );
    const ramWarning =
      (policy.hardwareProfile === "laptop-8gb" && activeAntigravityWorkers > 2) ||
      this.projects.some((p) => p.sessionHealth?.ramWarning);
    const overConcurrency =
      activeAntigravityWorkers > policy.maxConcurrentAntigravityWorkers ||
      activeWorkersTotal > policy.maxConcurrentWorkersTotal ||
      ramWarning ||
      this.projects.some((p) => p.sessionHealth?.status === "over_concurrency");
    const hasAcpDead = this.projects.some((p) => p.sessionHealth?.status === "acp_dead");
    const hasFatParent = this.projects.some((p) => p.sessionHealth?.status === "fat_parent");
    const status = hasAcpDead
      ? "acp_dead"
      : overConcurrency
        ? "over_concurrency"
        : hasFatParent
          ? "fat_parent"
          : "ok";
    const affectedProjects = this.projects
      .filter((p) => p.sessionHealth && p.sessionHealth.status !== "ok")
      .map((p) => p.projectId);
    const advisory =
      status === "acp_dead"
        ? `Sessão ACP morta detectada em ${Math.max(1, affectedProjects.length)} projeto(s). Abra uma nova thread (${policy.onAcpSessionDead}).`
        : status === "over_concurrency"
          ? `Concorrência global acima do perfil (${activeAntigravityWorkers}/${policy.maxConcurrentAntigravityWorkers} Antigravity, ${activeWorkersTotal}/${policy.maxConcurrentWorkersTotal} total)${ramWarning ? " [alerta de RAM em laptop-8gb]" : ""}.`
          : status === "fat_parent"
            ? `Thread pai extensa detectada em ${Math.max(1, affectedProjects.length)} projeto(s). Recomenda-se handoff via ai-memory.`
            : null;

    const sessionHealth: GlobalSessionHealth = {
      status,
      activeAntigravityWorkers,
      activeWorkersTotal,
      maxConcurrentAntigravityWorkers: policy.maxConcurrentAntigravityWorkers,
      maxConcurrentWorkersTotal: policy.maxConcurrentWorkersTotal,
      ramWarning,
      affectedProjects,
      advisory,
    };

    return structuredClone({
      globalConfig: this.globalConfig,
      projects: this.projects,
      subagents: this.subagents,
      providerInstances: this.providerInstances,
      globalPresets: resolvedGlobalPresets,
      skills: this.skills,
      defaultModelSelection:
        globalEnabled && activeGlobal ? selectionFromPreset(activeGlobal) : null,
      fallbackModelSelection:
        globalEnabled && firstFallback
          ? {
              instanceId: firstFallback.providerInstanceId,
              model: firstFallback.model,
              options: Object.entries(firstFallback.options).map(([id, value]) => ({
                id,
                value,
              })),
            }
          : null,
      sqliteAvailable: true,
      settingsAvailable: true,
      sessionHealth,
    });
  }

  listGlobalPresets(): PresetConfig[] {
    return structuredClone(
      this.globalPresets.map((p) => this.resolvePresetInheritance(p)),
    );
  }

  getProjectPreset(projectId: string, workspaceRoot: string): ResolvedProjectPreset {
    const projectSlug = deriveProjectSlug(workspaceRoot);
    const localPreset = this.localPresetsByProject.get(projectId) ?? null;
    const project = this.projects.find((p) => p.projectId === projectId);

    const resolved = localPreset
      ? this.resolvePresetInheritance(localPreset)
      : this.resolveGlobalFallbackPreset();

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
    const saved = stripDisabledRoles(preset);
    this.assertValidPresetStructure(saved);
    const idx = this.globalPresets.findIndex((p) => p.id === saved.id);
    const candidateCatalog =
      idx >= 0
        ? this.globalPresets.map((p, i) => (i === idx ? saved : p))
        : [...this.globalPresets, saved];
    const resolved = this.resolvePresetInheritance(saved, new Set(), 0, candidateCatalog);
    if (idx >= 0) {
      this.globalPresets[idx] = saved;
    } else {
      this.globalPresets.push(saved);
    }
    if (saved.id === this.globalConfig.activeGlobalPresetId) {
      for (const proj of this.projects) {
        if (!proj.presetEnabled || !proj.hasCustomOverride) {
          this.applyGlobalFallbackToProject(proj);
        }
      }
    }
    return resolved;
  }

  saveProjectPreset(
    projectId: string,
    workspaceRoot: string,
    preset: PresetConfig,
  ): ResolvedProjectPreset {
    const saved = stripDisabledRoles(preset);
    this.assertValidPresetStructure(saved);
    this.resolvePresetInheritance(saved);
    this.localPresetsByProject.set(projectId, saved);
    const proj = this.projects.find((p) => p.projectId === projectId);
    if (proj) {
      proj.hasLocalPreset = true;
      proj.localPresetId = saved.id;
      proj.localPresetExtends = saved.extends;
      proj.presetEnabled = saved.enabled;
      proj.hasCustomOverride = true;
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
    const normalizedPreset = stripDisabledRoles(preset);
    const resolved = this.resolvePresetInheritance(normalizedPreset);
    const squadRelDir = `.agents/skills/${projectSlug}-squad`;
    const files: CompiledFilePreview[] = [];

    // 1. .t3code/preset.jsonc (matches compiler.rs:367-376)
    const localPresetRelative = ".t3code/preset.jsonc";
    const localPresetAbs = `${workspaceRoot}/${localPresetRelative}`;
    const existingLocalPreset = this.localPresetsByProject.get(projectId) ?? null;
    const existingLocalContent = existingLocalPreset
      ? `// Oh My T3Code project preset\n${JSON.stringify(
          stripDisabledRoles(existingLocalPreset),
          null,
          2,
        )}\n`
      : null;
    const newLocalContent = `// Oh My T3Code project preset\n${JSON.stringify(
      normalizedPreset,
      null,
      2,
    )}\n`;
    files.push({
      path: localPresetAbs,
      relativePath: localPresetRelative,
      existingContent: existingLocalContent,
      newContent: newLocalContent,
      unifiedDiff: computeSimpleUnifiedDiff(
        localPresetRelative,
        existingLocalContent,
        newLocalContent,
      ),
      changed: existingLocalContent !== newLocalContent,
    });

    // 2. SKILL.md
    const skillRelative = `${squadRelDir}/SKILL.md`;
    const skillAbs = `${workspaceRoot}/${skillRelative}`;
    const existingSkill = this.compiledFilesByPath.get(skillAbs) ?? null;
    const newSkill = renderSkillMd(projectSlug, resolved);
    files.push({
      path: skillAbs,
      relativePath: skillRelative,
      existingContent: existingSkill,
      newContent: newSkill,
      unifiedDiff: computeSimpleUnifiedDiff(skillRelative, existingSkill, newSkill),
      changed: existingSkill !== newSkill,
    });

    // 3. roles/*.md
    const sortedRoles = Object.entries(resolved.roles).sort(([a], [b]) => a.localeCompare(b));
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

    const existingSelection = this.projectSettingsOverrides.get(projectId) ?? null;
    const existingOverride = existingSelection
      ? { defaultModelSelection: structuredClone(existingSelection) }
      : null;

    const newOverride: Record<string, unknown> | null = resolved.enabled
      ? {
          defaultModelSelection: selectionFromPreset(resolved),
        }
      : null;

    const oldSettingsJson = existingOverride ? JSON.stringify(existingOverride, null, 2) : null;
    const newSettingsJson =
      resolved.enabled && newOverride !== null ? JSON.stringify(newOverride, null, 2) : "";
    const settingsDiff = computeSimpleUnifiedDiff(
      "settings.json",
      oldSettingsJson,
      newSettingsJson,
    );
    const settingsChanged = resolved.enabled
      ? oldSettingsJson !== newSettingsJson
      : existingOverride !== null;

    return {
      projectId,
      workspaceRoot,
      projectSlug,
      presetId: resolved.id,
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
    let targetPreset: PresetConfig;
    if (customPreset) {
      this.assertValidPresetStructure(customPreset);
      targetPreset = stripDisabledRoles(customPreset);
    } else if (presetIdOrCustom && presetIdOrCustom !== "custom") {
      if (!isValidSafeId(presetIdOrCustom)) {
        throw new Error(`Invalid preset id '${presetIdOrCustom}'`);
      }
      const foundGlobal = this.globalPresets.find((p) => p.id === presetIdOrCustom);
      if (!foundGlobal) {
        throw new Error(`Global preset '${presetIdOrCustom}' not found`);
      }
      targetPreset = stripDisabledRoles(foundGlobal);
    } else {
      const current = this.getProjectPreset(projectId, workspaceRoot);
      targetPreset = stripDisabledRoles(current.rawLocalPreset ?? current.resolvedPreset);
    }

    this.assertValidPresetStructure(targetPreset);
    const resolved = this.resolvePresetInheritance(targetPreset);
    const preview = this.previewPresetSync(projectId, workspaceRoot, targetPreset);
    const writtenFiles: string[] = [];
    for (const file of preview.files) {
      if (file.changed) {
        if (file.relativePath !== ".t3code/preset.jsonc") {
          this.compiledFilesByPath.set(file.path, file.newContent);
        }
        writtenFiles.push(file.path);
      } else if (
        file.relativePath !== ".t3code/preset.jsonc" &&
        !this.compiledFilesByPath.has(file.path)
      ) {
        this.compiledFilesByPath.set(file.path, file.newContent);
      }
    }

    // Prune orphan roles/*.md files
    const rolesPrefix = `${workspaceRoot}/.agents/skills/${preview.projectSlug}-squad/roles/`;
    const orphanPaths = Array.from(this.compiledFilesByPath.keys())
      .filter((existingPath) => {
        if (!existingPath.startsWith(rolesPrefix) || !existingPath.endsWith(".md")) {
          return false;
        }
        const fileName = existingPath.slice(rolesPrefix.length);
        if (fileName.includes("/")) return false;
        const roleId = fileName.slice(0, -3);
        return !(roleId in resolved.roles);
      })
      .sort();

    for (const orphanPath of orphanPaths) {
      this.compiledFilesByPath.delete(orphanPath);
      writtenFiles.push(orphanPath);
    }

    this.localPresetsByProject.set(projectId, structuredClone(targetPreset));

    if (resolved.enabled) {
      this.projectSettingsOverrides.set(projectId, selectionFromPreset(resolved));
    } else {
      this.projectSettingsOverrides.delete(projectId);
    }

    const proj = this.projects.find((p) => p.projectId === projectId);
    if (proj) {
      if (resolved.enabled) {
        proj.activeInstanceId = resolved.orchestrator.providerInstanceId;
        proj.activeModel = resolved.orchestrator.model;
      } else {
        this.applyGlobalFallbackToProject(proj);
      }
      proj.hasLocalPreset = true;
      proj.localPresetId = targetPreset.id;
      proj.localPresetExtends = targetPreset.extends ?? targetPreset.id;
      proj.presetEnabled = resolved.enabled;
      proj.hasCustomOverride = true;
      proj.detectedSquadSlug = `${preview.projectSlug}-squad`;
      proj.detectedSquadPath = `${workspaceRoot}/.agents/skills/${preview.projectSlug}-squad`;
      proj.updatedAt = new Date().toISOString();
    }

    return {
      projectId,
      workspaceRoot,
      presetId: resolved.id,
      writtenFiles,
      settingsPath: "/Users/alencarfreire/.t3/userdata/settings.json",
      backupPath: "/Users/alencarfreire/.t3/userdata/settings.json.bak",
      activeInstanceId: resolved.orchestrator.providerInstanceId,
      activeModel: resolved.orchestrator.model,
      rebalancedRolesCount: 0,
      rebalancedRoles: [],
    };
  }

  private migrateRoleToCodexModel(role: RoleConfig, nextModel: string): void {
    role.providerInstanceId = "codex";
    role.model = nextModel;
    delete role.options.thinkingLevel;
    delete role.options.thinking_level;
    role.options.reasoningEffort ??= "medium";
    role.options.serviceTier ??= "default";
  }

  private migrateRoleToAgyInstance(role: RoleConfig, nextInstance: string): void {
    role.providerInstanceId = nextInstance;
    if (role.options.thinkingLevel && !role.options.thinking_level) {
      role.options.thinking_level = role.options.thinkingLevel;
    }
    delete role.options.thinkingLevel;
    if (!role.model.startsWith("gemini-4-")) {
      role.model = "gemini-4-hydrogen";
      role.options.thinking_level = "high";
    }
  }

  private extendsChainReaches(
    startId: string,
    targetId: string,
    catalog: PresetConfig[],
  ): boolean {
    const visited = new Set<string>();
    let current: string | null = startId;
    for (let depth = 0; depth < MAX_INHERITANCE_DEPTH && current; depth++) {
      if (current === targetId) return true;
      if (!isValidSafeId(current) || visited.has(current)) return false;
      visited.add(current);
      const found = catalog.find((p) => p.id === current);
      current = found?.extends ?? null;
    }
    return false;
  }

  swapProjectInstance(
    projectId: string,
    workspaceRoot: string,
    includeRoles = false,
  ): SyncResult {
    const proj = this.projects.find((p) => p.projectId === projectId);
    const currentResolved = this.getProjectPreset(projectId, workspaceRoot);
    if (
      !currentResolved.resolvedPreset.enabled ||
      currentResolved.rawLocalPreset?.enabled === false ||
      proj?.presetEnabled === false
    ) {
      throw new Error(
        "Override do projeto está pausado. Reative-o antes de inverter a instância.",
      );
    }

    const local = this.localPresetsByProject.get(projectId);
    const candidateLocal = local
      ? structuredClone(local)
      : includeRoles
        ? structuredClone(currentResolved.resolvedPreset)
        : null;
    const current =
      this.projectSettingsOverrides.get(projectId)?.instanceId ??
      proj?.activeInstanceId ??
      currentResolved.resolvedPreset.orchestrator.providerInstanceId ??
      "antigravity_2";
    const currentModel =
      this.projectSettingsOverrides.get(projectId)?.model ??
      proj?.activeModel ??
      currentResolved.resolvedPreset.orchestrator.model ??
      "gemini-4-hydrogen";

    if (candidateLocal) {
      if (!candidateLocal.orchestrator.providerInstanceId) {
        candidateLocal.orchestrator.providerInstanceId =
          currentResolved.resolvedPreset.orchestrator.providerInstanceId;
      }
      if (!candidateLocal.orchestrator.model) {
        candidateLocal.orchestrator.model =
          currentResolved.resolvedPreset.orchestrator.model;
      }
      if (Object.keys(candidateLocal.orchestrator.options).length === 0) {
        candidateLocal.orchestrator.options = structuredClone(
          currentResolved.resolvedPreset.orchestrator.options,
        );
      }
    }

    const disabledSet = new Set([
      ...(normalizeDisabledRoles(currentResolved.resolvedPreset.disabledRoles ?? []) ?? []),
      ...(normalizeDisabledRoles(candidateLocal?.disabledRoles ?? []) ?? []),
    ]);
    const rebalancedRoles: string[] = [];

    let nextInstance: string;
    let nextModel: string;

    if (current === "codex") {
      const previousModel = currentModel;
      nextInstance = "codex";
      nextModel = previousModel === "gpt-6.1-sol" ? "gpt-6.1-terra" : "gpt-6.1-sol";
      if (candidateLocal) {
        candidateLocal.orchestrator.providerInstanceId = "codex";
        candidateLocal.orchestrator.model = nextModel;
        delete candidateLocal.orchestrator.options.thinkingLevel;
        delete candidateLocal.orchestrator.options.thinking_level;
        candidateLocal.orchestrator.options.reasoningEffort ??= "medium";
        candidateLocal.orchestrator.options.serviceTier ??= "default";

        if (includeRoles) {
          for (const [roleId, resolvedRole] of Object.entries(
            currentResolved.resolvedPreset.roles,
          ).sort(([a], [b]) => a.localeCompare(b))) {
            if (disabledSet.has(roleId)) continue;
            if (
              resolvedRole.providerInstanceId === "codex" &&
              resolvedRole.model === previousModel
            ) {
              const migrated = structuredClone(resolvedRole);
              this.migrateRoleToCodexModel(migrated, nextModel);
              candidateLocal.roles[roleId] = migrated;
              rebalancedRoles.push(roleId);
            }
          }
        }
      }
    } else {
      const previousInstance = current || "antigravity";
      nextInstance = previousInstance === "antigravity_2" ? "antigravity" : "antigravity_2";
      nextModel =
        currentModel && currentModel.startsWith("gemini-4-")
          ? currentModel
          : "gemini-4-hydrogen";
      if (candidateLocal) {
        candidateLocal.orchestrator.providerInstanceId = nextInstance;
        if (
          candidateLocal.orchestrator.options.thinkingLevel &&
          !candidateLocal.orchestrator.options.thinking_level
        ) {
          candidateLocal.orchestrator.options.thinking_level =
            candidateLocal.orchestrator.options.thinkingLevel;
        }
        delete candidateLocal.orchestrator.options.thinkingLevel;
        if (!candidateLocal.orchestrator.model.startsWith("gemini-4-")) {
          candidateLocal.orchestrator.model = "gemini-4-hydrogen";
          candidateLocal.orchestrator.options.thinking_level = effectiveParentThinkingLevel(
            candidateLocal.sessionPolicy,
          );
        }
        nextModel = candidateLocal.orchestrator.model;

        if (includeRoles) {
          for (const [roleId, resolvedRole] of Object.entries(
            currentResolved.resolvedPreset.roles,
          ).sort(([a], [b]) => a.localeCompare(b))) {
            if (disabledSet.has(roleId)) continue;
            if (resolvedRole.providerInstanceId === previousInstance) {
              const migrated = structuredClone(resolvedRole);
              this.migrateRoleToAgyInstance(migrated, nextInstance);
              candidateLocal.roles[roleId] = migrated;
              rebalancedRoles.push(roleId);
            }
          }
        }
      }
    }

    if (candidateLocal) {
      const result = this.applyPresetSync(projectId, workspaceRoot, null, candidateLocal);
      return {
        ...result,
        rebalancedRolesCount: rebalancedRoles.length,
        rebalancedRoles,
      };
    }

    this.projectSettingsOverrides.set(projectId, {
      instanceId: nextInstance,
      model: nextModel,
      options: [],
    });

    if (proj) {
      proj.activeInstanceId = nextInstance;
      proj.activeModel = nextModel;
      proj.updatedAt = new Date().toISOString();
    }

    return {
      projectId,
      workspaceRoot,
      presetId: proj?.localPresetId ?? currentResolved.resolvedPreset.id ?? "default",
      writtenFiles: [],
      settingsPath: "/Users/alencarfreire/.t3/userdata/settings.json",
      backupPath: "/Users/alencarfreire/.t3/userdata/settings.json.bak",
      activeInstanceId: nextInstance,
      activeModel: nextModel,
      rebalancedRolesCount: 0,
      rebalancedRoles: [],
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
      extends: "default",
      enabled: true,
    };
    this.localPresetsByProject.set(projectId, imported);
    this.projectSettingsOverrides.set(projectId, selectionFromPreset(imported));
    const proj = this.projects.find((p) => p.projectId === projectId);
    if (proj) {
      proj.hasLocalPreset = true;
      proj.localPresetId = imported.id;
      proj.localPresetExtends = imported.extends;
      proj.presetEnabled = true;
      proj.hasCustomOverride = true;
      proj.detectedSquadSlug = `${slug}-squad`;
      proj.detectedSquadPath = `${workspaceRoot}/.agents/skills/${slug}-squad`;
    }
    return this.getProjectPreset(projectId, workspaceRoot);
  }

  setGlobalPresetConfig(activePresetId: string, enabled: boolean): DashboardSnapshot {
    if (!isValidSafeId(activePresetId)) {
      throw new Error(`Invalid active_preset_id '${activePresetId}'`);
    }
    const found = this.globalPresets.find((p) => p.id === activePresetId);
    if (!found) {
      throw new Error(`Global preset '${activePresetId}' not found`);
    }
    const resolved = this.resolvePresetInheritance(found);
    this.globalConfig = {
      activeGlobalPresetId: resolved.id,
      enabled,
    };
    for (const proj of this.projects) {
      if (!proj.presetEnabled || !proj.hasCustomOverride) {
        this.applyGlobalFallbackToProject(proj);
      }
    }
    return this.getDashboardSnapshot();
  }

  swapGlobalInstance(
    includeRoles = false,
    resyncInherited = false,
  ): DashboardSnapshot {
    if (!this.globalConfig.enabled) {
      throw new Error(
        "Preset global está desativado. Reative-o antes de inverter a instância.",
      );
    }
    const idx = this.globalPresets.findIndex(
      (p) => p.id === this.globalConfig.activeGlobalPresetId,
    );
    if (idx < 0) {
      throw new Error(
        `Global preset '${this.globalConfig.activeGlobalPresetId}' not found`,
      );
    }

    const rawActive = this.globalPresets[idx];
    const resolvedActive = this.resolvePresetInheritance(rawActive);
    const candidate = structuredClone(resolvedActive);
    candidate.extends = rawActive.extends;
    const rebalancedRoles: string[] = [];

    if (candidate.orchestrator.providerInstanceId === "codex") {
      const previousModel = candidate.orchestrator.model;
      const nextModel =
        previousModel === "gpt-6.1-sol" ? "gpt-6.1-terra" : "gpt-6.1-sol";
      const oppositeModel =
        nextModel === "gpt-6.1-sol" ? "gpt-6.1-terra" : "gpt-6.1-sol";
      candidate.orchestrator.model = nextModel;
      delete candidate.orchestrator.options.thinkingLevel;
      delete candidate.orchestrator.options.thinking_level;
      candidate.orchestrator.options.reasoningEffort ??= "medium";
      candidate.orchestrator.options.serviceTier ??= "default";
      if (
        candidate.fallbackChain[0]?.providerInstanceId === "codex" &&
        candidate.fallbackChain[0].model === nextModel
      ) {
        candidate.fallbackChain[0].model = oppositeModel;
      }
      if (includeRoles) {
        for (const [roleId, role] of Object.entries(candidate.roles).sort(([a], [b]) =>
          a.localeCompare(b),
        )) {
          if (role.providerInstanceId === "codex" && role.model === previousModel) {
            this.migrateRoleToCodexModel(role, nextModel);
            rebalancedRoles.push(roleId);
          }
        }
      }
    } else {
      const previousInstance = candidate.orchestrator.providerInstanceId || "antigravity";
      const nextInstance =
        previousInstance === "antigravity_2" ? "antigravity" : "antigravity_2";
      const oppositeInstance =
        nextInstance === "antigravity_2" ? "antigravity" : "antigravity_2";
      candidate.orchestrator.providerInstanceId = nextInstance;
      if (
        candidate.orchestrator.options.thinkingLevel &&
        !candidate.orchestrator.options.thinking_level
      ) {
        candidate.orchestrator.options.thinking_level =
          candidate.orchestrator.options.thinkingLevel;
      }
      delete candidate.orchestrator.options.thinkingLevel;
      if (!candidate.orchestrator.model.startsWith("gemini-4-")) {
        candidate.orchestrator.model = "gemini-4-hydrogen";
        candidate.orchestrator.options = {
          thinking_level: effectiveParentThinkingLevel(candidate.sessionPolicy),
        };
      }
      if (candidate.fallbackChain[0]?.providerInstanceId === nextInstance) {
        candidate.fallbackChain[0].providerInstanceId = oppositeInstance;
      }
      if (includeRoles) {
        for (const [roleId, role] of Object.entries(candidate.roles).sort(([a], [b]) =>
          a.localeCompare(b),
        )) {
          if (role.providerInstanceId === previousInstance) {
            this.migrateRoleToAgyInstance(role, nextInstance);
            rebalancedRoles.push(roleId);
          }
        }
      }
    }

    const candidateCatalog = this.globalPresets.map((p, i) => (i === idx ? candidate : p));
    this.resolvePresetInheritance(candidate, new Set(), 0, candidateCatalog);
    this.globalPresets[idx] = candidate;

    for (const proj of this.projects) {
      if (!proj.presetEnabled || !proj.hasCustomOverride) {
        this.applyGlobalFallbackToProject(proj);
      }
    }

    const resyncedProjects: ResyncedProjectReport[] = [];
    const failedProjects: FailedProjectResync[] = [];

    if (resyncInherited) {
      for (const proj of this.projects) {
        const localPreset = this.localPresetsByProject.get(proj.projectId);
        if (!localPreset || localPreset.enabled === false || !proj.presetEnabled) {
          continue;
        }
        if (
          !localPreset.extends ||
          !this.extendsChainReaches(localPreset.extends, candidate.id, this.globalPresets)
        ) {
          continue;
        }

        try {
          const normalized = stripDisabledRoles(localPreset);
          const resolvedProj = this.resolvePresetInheritance(normalized);
          const projectSlug = deriveProjectSlug(proj.workspaceRoot);
          const squadDir = `${proj.workspaceRoot}/.agents/skills/${projectSlug}-squad`;
          const writtenFiles: string[] = [];

          const skillPath = `${squadDir}/SKILL.md`;
          const newSkill = renderSkillMd(projectSlug, resolvedProj);
          if (this.compiledFilesByPath.get(skillPath) !== newSkill) {
            this.compiledFilesByPath.set(skillPath, newSkill);
            writtenFiles.push(skillPath);
          }

          for (const [roleId, role] of Object.entries(resolvedProj.roles).sort(([a], [b]) =>
            a.localeCompare(b),
          )) {
            const rolePath = `${squadDir}/roles/${roleId}.md`;
            const newRole = renderRoleMd(projectSlug, role);
            if (this.compiledFilesByPath.get(rolePath) !== newRole) {
              this.compiledFilesByPath.set(rolePath, newRole);
              writtenFiles.push(rolePath);
            }
          }

          const rolesPrefix = `${squadDir}/roles/`;
          for (const existingPath of Array.from(this.compiledFilesByPath.keys()).sort()) {
            if (!existingPath.startsWith(rolesPrefix) || !existingPath.endsWith(".md")) {
              continue;
            }
            const fileName = existingPath.slice(rolesPrefix.length);
            if (fileName.includes("/")) continue;
            const roleId = fileName.slice(0, -3);
            if (!(roleId in resolvedProj.roles)) {
              this.compiledFilesByPath.delete(existingPath);
              writtenFiles.push(existingPath);
            }
          }

          this.projectSettingsOverrides.set(proj.projectId, selectionFromPreset(resolvedProj));
          proj.activeInstanceId = resolvedProj.orchestrator.providerInstanceId;
          proj.activeModel = resolvedProj.orchestrator.model;
          proj.updatedAt = new Date().toISOString();

          resyncedProjects.push({
            projectId: proj.projectId,
            title: proj.title,
            workspaceRoot: proj.workspaceRoot,
            presetId: resolvedProj.id,
            writtenFiles,
          });
        } catch (err) {
          failedProjects.push({
            projectId: proj.projectId,
            title: proj.title,
            workspaceRoot: proj.workspaceRoot,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const report: GlobalSwapReport = {
      includeRoles,
      resyncInherited,
      rebalancedRolesCount: rebalancedRoles.length,
      rebalancedRoles,
      resyncedProjects,
      failedProjects,
    };
    const snapshot = this.getDashboardSnapshot();
    snapshot.lastGlobalSwapReport = report;
    return snapshot;
  }

  setProjectPresetEnabled(
    projectId: string,
    workspaceRoot: string,
    enabled: boolean,
  ): SyncResult {
    const current = this.getProjectPreset(projectId, workspaceRoot);
    const updated: PresetConfig = {
      ...structuredClone(current.rawLocalPreset ?? current.resolvedPreset),
      enabled,
    };
    this.assertValidPresetStructure(updated);
    const resolved = this.resolvePresetInheritance(updated);

    if (enabled) {
      return this.applyPresetSync(projectId, workspaceRoot, null, updated);
    }

    this.localPresetsByProject.set(projectId, updated);
    this.projectSettingsOverrides.delete(projectId);
    const proj = this.projects.find((p) => p.projectId === projectId);
    if (proj) {
      proj.hasLocalPreset = true;
      proj.localPresetId = updated.id;
      proj.localPresetExtends = updated.extends;
      proj.presetEnabled = false;
      proj.hasCustomOverride = true;
      proj.updatedAt = new Date().toISOString();
      this.applyGlobalFallbackToProject(proj);
    }
    return {
      projectId,
      workspaceRoot,
      presetId: resolved.id,
      writtenFiles: [`${workspaceRoot}/.t3code/preset.jsonc`],
      settingsPath: "/Users/alencarfreire/.t3/userdata/settings.json",
      backupPath: "/Users/alencarfreire/.t3/userdata/settings.json.bak",
      activeInstanceId: resolved.orchestrator.providerInstanceId,
      activeModel: resolved.orchestrator.model,
      rebalancedRolesCount: 0,
      rebalancedRoles: [],
    };
  }

  removeProjectOverride(projectId: string, workspaceRoot: string): DashboardSnapshot {
    this.localPresetsByProject.delete(projectId);
    this.projectSettingsOverrides.delete(projectId);

    const projectSlug = deriveProjectSlug(workspaceRoot);
    const squadDir = `${workspaceRoot}/.agents/skills/${projectSlug}-squad`;
    const skillMdPath = `${squadDir}/SKILL.md`;
    const skillContent = this.compiledFilesByPath.get(skillMdPath);
    const removedCompilerSquad = Boolean(
      skillContent && skillContent.includes(COMPILER_PLAYBOOK_SIGNATURE),
    );

    if (removedCompilerSquad) {
      const squadPrefix = `${squadDir}/`;
      for (const pathKey of Array.from(this.compiledFilesByPath.keys())) {
        if (pathKey.startsWith(squadPrefix)) {
          this.compiledFilesByPath.delete(pathKey);
        }
      }
    }

    const proj = this.projects.find((p) => p.projectId === projectId);
    if (proj) {
      proj.hasLocalPreset = false;
      proj.localPresetId = null;
      proj.localPresetExtends = null;
      proj.presetEnabled = true;
      if (removedCompilerSquad) {
        proj.detectedSquadSlug = null;
        proj.detectedSquadPath = null;
      }
      proj.hasCustomOverride = Boolean(proj.detectedSquadSlug);
      this.applyGlobalFallbackToProject(proj);
      proj.updatedAt = new Date().toISOString();
    }
    return this.getDashboardSnapshot();
  }
}
