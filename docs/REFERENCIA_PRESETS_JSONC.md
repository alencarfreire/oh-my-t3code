# Referência de presets e configuração JSONC (`oh-my-t3code`)

🌐 [English](en/JSONC_PRESETS_REFERENCE.md) | **Português (Brasil)** · [Voltar ao README](../README.pt-BR.md)

Esta referência documenta o formato completo de configuração do `oh-my-t3code`: variáveis de ambiente, hierarquia de arquivos em disco, sintaxe JSON with Comments (JSONC), esquema de tipos, regras exatas de herança (`extends`), o preset integrado padrão (`default`) e presets customizados, além do funcionamento do Preset Compiler, da sincronização de `settings.json` e do Reverse Importer.

## Mapa de arquivos e variáveis de ambiente

O backend resolve todos os caminhos em [`AppPaths::from_env`](../src-tauri/src/models.rs) usando duas variáveis de ambiente opcionais e duas raízes fixas de skills globais.

| Origem | Variável / Caminho padrão | Arquivos e finalidade |
| :--- | :--- | :--- |
| Configuração global | `$OH_MY_T3CODE_CONFIG_DIR` (`~/.config/oh-my-t3code/`) | `config.jsonc` (preset global ativo e toggle `enabled`) e `presets/*.jsonc` (fallback `.json` na leitura) |
| Dados do T3 Code | `$T3CODE_HOME` (`~/.t3/`) | `userdata/settings.json` (sobrescritas de modelo), `userdata/settings.json.bak` (backup automático) e `userdata/statev2.sqlite` (leitura read-only) |
| Raiz de skills (Skillshare) | `~/.config/skillshare/skills/` | Skills globais escaneadas em `<skill-id>/SKILL.md` com `source: "skillshare"` |
| Raiz de skills (Gemini) | `~/.gemini/config/skills/` | Skills globais escaneadas em `<skill-id>/SKILL.md` com `source: "gemini"` |
| Repositório do projeto | `<workspace_root>/.t3code/preset.jsonc` | Override local do projeto (pode usar `extends` apontando para um preset global) |
| Squad compilada | `<workspace_root>/.agents/skills/<slug>-squad/` | Artefatos determinísticos gerados pelo compiler: `SKILL.md` e `roles/<role-id>.md` |

Para diretórios de repositório, o backend deriva `<slug>` por meio da função `derive_project_slug`, que converte o nome da pasta raiz para minúsculas ASCII, substitui sequências não alfanuméricas por hífen único (`-`), remove hifens nas extremidades e adota `"project"` se o resultado ficar vazio.

Na leitura de presets globais, o motor procura primeiro `<presets_dir>/<id>.jsonc` e, se não existir, tenta `<presets_dir>/<id>.json`. Toda gravação pelo Studio ou pelo backend escreve sempre `.jsonc`. Na varredura de skills globais (`scan_global_skills`), a raiz `skillshare` tem precedência sobre `gemini` caso o mesmo `<skill-id>` exista em ambas.

## Sintaxe JSONC suportada

O parser `strip_jsonc_comments` em [`preset_engine.rs`](../src-tauri/src/preset_engine.rs) remove comentários e vírgulas finais antes de delegar o JSON resultante ao `serde_json`. Você pode usar:

- **Comentários de linha**: trechos iniciados por `//` até a quebra de linha `\n`.
- **Comentários de bloco**: trechos delimitados por `/* ... */` em uma ou várias linhas (as quebras de linha internas são preservadas).
- **Trailing commas**: vírgula imediatamente anterior a `}` ou `]`, mesmo com espaços ou quebras de linha entre eles.
- **Strings protegidas**: sequências `//`, `/* */` e vírgulas dentro de aspas duplas `"..."` (respeitando escapes `\"` e `\\`) permanecem intactas.

```jsonc
{
  // Comentário de linha permitido fora de strings
  "id": "demo-utf8",
  "name": "Demo // preservado dentro da string /* intacto */",
  /* Comentário de bloco
     multilinha */
  "roles": {
    "fixer": {
      "id": "fixer",
      "title": "Fixer", // vírgula final aceita abaixo
    },
  },
}
```

## Schema completo de configuração

Todos os objetos são serializados em `camelCase` (`#[serde(rename_all = "camelCase")]` em [`models.rs`](../src-tauri/src/models.rs)) para manter paridade estrita com [`src/types/ipc.ts`](../src/types/ipc.ts).

### Regras de validação de identificadores (`validate_safe_id`)

Todo `id` de preset, valor de `extends`, chave em `roles` e nome de arquivo de preset ou papel passa por `validate_safe_id` antes de qualquer leitura ou escrita em disco:

- Comprimento obrigatório entre `1` e `64` caracteres.
- Caracteres permitidos: apenas `[a-zA-Z0-9_-]` (ASCII alfanumérico, hífen e underscore).
- Bloqueio explícito contra path traversal: qualquer ocorrência de `..`, `/` ou `\` falha com `AppError::PathTraversal`.

### `GlobalAppConfig` (`config.jsonc`)

Controla qual preset global atua como padrão para projetos sem override local e se a sincronização global está ativa.

| Campo | Tipo | Padrão | Descrição |
| :--- | :--- | :--- | :--- |
| `activeGlobalPresetId` | `string` | `"default"` | Identificador do preset em `~/.config/oh-my-t3code/presets/` usado como padrão global |
| `enabled` | `boolean` | `true` | Indica se o preset global está ativo para sincronizar `defaultModelSelection` e `fallbackModelSelection` |

```jsonc
// Oh My T3Code global configuration
{
  "activeGlobalPresetId": "default",
  "enabled": true
}
```

### `PresetConfig` (presets globais e `.t3code/preset.jsonc`)

Define a estrutura completa de um preset de orquestração, sua cadeia de fallback, política de contenção e mapa de papéis.

| Campo | Tipo | Padrão | Descrição |
| :--- | :--- | :--- | :--- |
| `id` | `string` | Obrigatório | Identificador seguro do preset (`validate_safe_id`) |
| `name` | `string` | Obrigatório | Nome legível exibido no Popover e no Preset Studio |
| `description` | `string` | `""` | Resumo da estratégia de modelos e finalidade do preset |
| `extends` | `string \| null` | `null` | ID de um preset global pai do qual este arquivo herda e aplica patch |
| `enabled` | `boolean` | `true` | Ativa ou pausa o override local do projeto |
| `topology` | `string` | `"intra-thread-squad"` | Topologia de coordenação (`"intra-thread-squad"` ou `"issue-thread-orchestrator"`) |
| `orchestrator` | `OrchestratorSelection` | `{}` | Instância, modelo e opções do agente orquestrador principal |
| `fallbackChain` | `FallbackStep[]` | `[]` | Lista ordenada de contingência usada quando cota ou disponibilidade falham |
| `contention` | `ContentionPolicy` | Padrões de `shared` | Política de paralelismo, banco de testes, variáveis de ambiente e arquivos críticos |
| `roles` | `Record<string, RoleConfig>` | `{}` | Mapa ordenado (`BTreeMap`) dos papéis especializados compilados em `roles/*.md` |
| `disabledRoles` | `string[]` | `[]` *(omitido quando vazio)* | Lista ordenada e deduplicada (tombstone) de IDs de papéis herdados via `extends` que devem ser suprimidos (`validate_safe_id`) |

### `OrchestratorSelection` e `FallbackStep`

Ambos os objetos especificam qual instância de provedor e qual modelo o T3 Code deve usar, com `FallbackStep` adicionando uma justificativa operacional.

| Campo | Tipo | Padrão | Obrigatório em | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| `providerInstanceId` | `string` | `""` | `OrchestratorSelection`, `FallbackStep` | ID da instância no T3 Code (`"codex"`, `"antigravity"`, `"antigravity_2"`, `"claudeAgent"`, `"opencode"`, `"grok"` ou instância customizada) |
| `model` | `string` | `""` | `OrchestratorSelection`, `FallbackStep` | Identificador do modelo (ex.: `"gpt-6.1-sol"`, `"gemini-4-hydrogen"`, `"gemini-4-argon"`) |
| `options` | `Record<string, string>` | `{}` | Opcional | Parâmetros do provedor (ex.: `thinking_level` no Antigravity; `reasoningEffort` e `serviceTier` no Codex) |
| `reason` | `string` | `""` | Apenas `FallbackStep` | Motivo exibido na seção Cadeia de Fallback do `SKILL.md` compilado |

```jsonc
"orchestrator": {
  "providerInstanceId": "antigravity_2",
  "model": "gemini-4-hydrogen",
  "options": {
    "thinking_level": "high"
  }
},
"fallbackChain": [
  {
    "providerInstanceId": "antigravity",
    "model": "gemini-4-hydrogen",
    "options": { "thinking_level": "high" },
    "reason": "Nível 1: Troca de instância mantendo gemini-4-hydrogen"
  }
]
```

### `ContentionPolicy`

Documenta no `SKILL.md` compilado os limites de concorrência do repositório para evitar corrupção de banco de testes ou conflitos de merge entre subagentes.

| Campo | Tipo | Padrão | Descrição |
| :--- | :--- | :--- | :--- |
| `singleTestDb` | `boolean` | `false` | Indica que a suíte usa um único banco de testes e exige execução serializada |
| `envVars` | `Record<string, string>` | `{}` | Variáveis de ambiente obrigatórias impressas no playbook (ex.: `PARALLEL_WORKERS=1`) |
| `gitIgnoredBuilds` | `string[]` | `[]` | Diretórios de build fora do controle de versão (ex.: `target/`, `dist/`) |
| `conflictFiles` | `string[]` | `[]` | Arquivos de alta contenção que exigem ondas sequenciais (ex.: `Cargo.toml`, `package.json`) |
| `defaultIsolation` | `string` | `"shared"` | Modo padrão de workspace para subagentes (`"shared"` ou `"worktree"`) |

### `RoleConfig`

Cada entrada em `roles` representa um worker especializado e origina um arquivo `roles/<role-id>.md` dentro da skill da squad.

| Campo | Tipo | Padrão | Descrição |
| :--- | :--- | :--- | :--- |
| `id` | `string` | Obrigatório | Identificador do papel (`validate_safe_id`) e nome base do arquivo `<id>.md` |
| `title` | `string` | Obrigatório | Título exibido no cabeçalho `# Role: <title> (<slug>)` e na tabela de `SKILL.md` |
| `description` | `string` | `""` | Resumo das responsabilidades do papel |
| `whenToUse` | `string` | `""` | Critério de acionamento exibido na coluna Quando acionar da tabela de papéis |
| `providerInstanceId` | `string` | Obrigatório | Instância de provedor designada para este papel |
| `model` | `string` | Obrigatório | Modelo designado para este papel |
| `options` | `Record<string, string>` | `{}` | Opções específicas do modelo para este papel |
| `skills` | `string[]` | `[]` | IDs das skills recomendadas para o worker |
| `mcps` | `string[]` | `[]` | Servidores Model Context Protocol (MCP) recomendados (ex.: `ai-memory`, `context7`) |
| `allowedPaths` | `string[]` | `[]` | Caminhos ou globs permitidos para edição |
| `forbiddenPaths` | `string[]` | `[]` | Caminhos ou restrições que o papel deve evitar |
| `invariants` | `string[]` | `[]` | Lista numerada de regras obrigatórias do papel |
| `verificationCommands` | `string[]` | `[]` | Comandos executados pelo worker antes de concluir a tarefa |

## Regras exatas de herança (`extends`)

Um preset pode declarar `"extends": "<id-do-pai>"` para reutilizar um preset global existente e sobrescrever apenas os campos necessários via `PresetPatch`.

### Limite de profundidade e detecção de ciclos

O resolvedor recursivo em [`preset_engine.rs`](../src-tauri/src/preset_engine.rs) mantém um conjunto `visited` e um contador de profundidade com `MAX_INHERITANCE_DEPTH = 16`:

- Se um preset apontar para si mesmo (`extends == id`) ou formar qualquer ciclo (`A -> B -> A`), a resolução falha com `AppError::CycleDetected`.
- Se a cadeia de herança atingir `depth >= 16`, a resolução também retorna `AppError::CycleDetected`.
- Presets locais de projeto (`.t3code/preset.jsonc`) resolvem `extends` contra os arquivos do diretório global de presets (`~/.config/oh-my-t3code/presets/`).

### Comportamento do `merge_patch` campo a campo

Ao combinar o preset pai (`base`) com o arquivo filho (`patch`), o algoritmo aplica regras distintas conforme o tipo do campo:

1. **Identificador (`id`)**: usa `patch.id` se presente; caso contrário, usa o `fallback_id` (nome do arquivo ou slug do projeto).
2. **`name` e `description`**: sobrescrevem o valor do pai apenas quando presentes e não vazios após `.trim()`. Se omitidos, `""` ou só espaços, mantêm o valor do pai.
3. **`enabled` e `topology`**: sobrescrevem o valor do pai se estiverem presentes no filho.
4. **Dicionários (`orchestrator.options`, `contention.envVars`, `roles[id].options`)**: sofrem **merge chave a chave**. Chaves novas são inseridas e chaves com mesmo nome sobrescrevem o pai, preservando as demais chaves herdadas.
5. **Escalar em `orchestrator` e `contention`**: `providerInstanceId`, `model`, `singleTestDb` e `defaultIsolation` substituem o valor do pai quando especificados no filho.
6. **Vetores (arrays)**: `fallbackChain`, `contention.gitIgnoredBuilds`, `contention.conflictFiles` e todos os arrays de `RoleConfig` (`skills`, `mcps`, `allowedPaths`, `forbiddenPaths`, `invariants`, `verificationCommands`) **substituem integralmente** o array do pai quando especificados no filho; não há concatenação.
7. **Mapa `roles`**: se `role_id` já existir no pai, os campos definidos em `RolePatch` são mesclados sobre o papel do pai (preservando os demais campos do papel pai); se `role_id` não existir no pai, um novo papel é criado com `id` e `title` padronizados para `role_id`.

> [!NOTE]
> **Remoção e reativação de papéis herdados (`disabledRoles`)**: para suprimir um papel herdado via `extends` (inclusive em cadeias de herança multi-nível), liste seu `id` em `"disabledRoles": ["<role-id>"]` (validado por `validate_safe_id`, deduplicado e ordenado automaticamente). No **Preset Studio** (`RolesMatrixTab`), excluir um papel de um preset com `extends` adiciona automaticamente esse ID em `disabledRoles`. Para **reativar** um papel removido, basta redeclarar a chave `<role-id>` em `roles` (sem incluí-la em `disabledRoles` no mesmo arquivo) ou adicioná-la novamente no Preset Studio — o `merge_patch` e a UI removem o tombstone de `disabledRoles`.

### Exemplo prático comentado de `.t3code/preset.jsonc`

O arquivo abaixo demonstra um override de projeto herdando de `default` que mantém `explorer`, `oracle`, `designer` e `qa-reviewer` intactos e personaliza apenas o papel `fixer` e a política de contenção:

```jsonc
// Salve em <workspace_root>/.t3code/preset.jsonc
{
  "id": "meu-projeto",
  "name": "Meu Projeto (Custom)",
  "description": "Herda de default e ajusta banco único de testes e comandos de verificação do fixer.",
  "extends": "default",
  "enabled": true,
  "orchestrator": {
    // Mantém providerInstanceId ("codex") e model ("gpt-6.1-sol") do pai; merge chave a chave em options
    "options": {
      "reasoningEffort": "high",
    },
  },
  "contention": {
    "singleTestDb": true,
    // Merge chave a chave: adiciona PARALLEL_WORKERS mantendo defaultIsolation ("shared") do pai
    "envVars": {
      "PARALLEL_WORKERS": "1",
    },
    // Substitui conflictFiles herdado do pai
    "conflictFiles": ["Cargo.toml", "package.json", "Makefile"],
  },
  "roles": {
    "fixer": {
      // Mantém providerInstanceId ("codex") e model ("gpt-6.1-sol") herdados do pai
      "options": {
        // Merge chave a chave: sobrescreve reasoningEffort, preserva serviceTier="default"
        "reasoningEffort": "xhigh",
      },
      // Arrays presentes no filho substituem o array inteiro daquele campo no pai
      "verificationCommands": [
        "cargo check --manifest-path src-tauri/Cargo.toml",
        "cargo test --manifest-path src-tauri/Cargo.toml",
      ],
    },
  },
}
```

## Preset integrado padrão (`default`) e presets customizados

Na inicialização (ou ao listar presets), `ensure_seed_presets` garante a presença do preset base **`default` (`Default (OMOS Standard)`)** em `~/.config/oh-my-t3code/presets/default.jsonc`, populado com os cinco papéis canônicos inspirados no `oh-my-opencode-slim` (OMOS): `explorer`, `oracle`, `designer`, `fixer` e `qa-reviewer`.

Além do `default`, o diretório `~/.config/oh-my-t3code/presets/` aceita qualquer preset customizado criado pelo usuário (via Preset Studio ou arquivos `.jsonc` editados manualmente), permitindo definir outras combinações de provedores/modelos ou estender `default` com `"extends": "default"`.

### Visão geral e estratégia de fallback do preset `default`

| Preset (`id`) | Nome | Orquestrador | Topologia | `ContentionPolicy` | Fallback Chain (ordem 1 → 2 → 3) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `default` | `Default (OMOS Standard)` | `codex` / `gpt-6.1-sol` (`reasoningEffort=medium`, `serviceTier=default`) | `intra-thread-squad` | `singleTestDb: false`, `defaultIsolation: "shared"`, builds `target/`, `dist/`, conflitos `package.json`, `Cargo.toml`, `tauri.conf.json` | 1. `codex` / `gpt-6.1-terra` (`high`)<br>2. `codex` / `gpt-6-astra` (`high`)<br>3. `codex` / `gpt-6-luna` (`medium`) |

### Os 5 papéis canônicos OMOS no preset `default`

| Papel (`id`) | Provedor / Modelo padrão | Opção de raciocínio | Foco do papel |
| :--- | :--- | :--- | :--- |
| `explorer` | `codex` / `gpt-6-luna` | `low` | Mapeamento rápido e leitura de contexto do repositório |
| `oracle` | `codex` / `gpt-6.1-sol` | `high` | Decisões arquiteturais, planejamento e revisão de contratos |
| `designer` | `codex` / `gpt-6-luna` | `medium` | Interface, componentes visuais e fluxos de UX |
| `fixer` | `codex` / `gpt-6.1-sol` | `low` | Implementação focada, correções e verificação local |
| `qa-reviewer` | `codex` / `gpt-6-astra` | `high` | Auditoria de qualidade, segurança e execução de testes |

### Regra de auto-reparo e migração do preset integrado

A função `ensure_seed_presets` em [`preset_engine.rs`](../src-tauri/src/preset_engine.rs) preserva edições do usuário no preset `default`, mas regrava automaticamente o arquivo se detectar qualquer uma das três condições de legado ou corrupção:

1. Presença da chave legada `"thinkingLevel"` em camelCase.
2. Sequências de mojibake UTF-8 decodificadas como Latin-1 detectadas por `looks_like_mojibake` (por exemplo `NÃvel`, `instÃ¢ncia`, `â↔`).
3. JSONC inválido ou ausência de qualquer um dos cinco papéis canônicos OMOS (`explorer`, `oracle`, `designer`, `fixer`, `qa-reviewer`).

Se `~/.config/oh-my-t3code/config.jsonc` não existir, `ensure_seed_presets` cria o arquivo com `activeGlobalPresetId: "default"` e `enabled: true`.

## Como funcionam o Preset Compiler, o `settings.json` Sync e o Reverse Importer

Esses três módulos fecham o ciclo entre a declaração declarativa em JSONC, os arquivos Markdown lidos pelo T3 Code e o estado de runtime do cliente T3.

### Preset Compiler (`compiler.rs`)

Dado um `PresetConfig` resolvido e um `workspace_root`, o compiler valida os identificadores, verifica que todo caminho de saída permanece dentro do workspace (`ensure_within_workspace`) e gera saída 100% determinística usando `BTreeMap` (zero timestamps ou UUIDs):

- **`<workspace>/.t3code/preset.jsonc`**: serializa o preset do projeto com cabeçalho `// Oh My T3Code project preset`.
- **`<workspace>/.agents/skills/<slug>-squad/SKILL.md`**: gera frontmatter YAML (`name: <slug>-squad`, `description`) seguido pela assinatura `# <slug> Squad — Playbook do Orquestrador (T3 Code)` e quatro seções fixas (`1. Preparação do Orquestrador`, `2. Papéis da Squad (roles/)`, `3. Topologia, Contenção & Isolamento` e `4. Cadeia de Fallback`).
- **`<workspace>/.agents/skills/<slug>-squad/roles/<role-id>.md`**: gera um arquivo por papel contendo cabeçalho `# Role: <title> (<slug>)`, `## Modelo & Instância`, `## Escopo de arquivos`, `## Skills e MCPs recomendados`, `## Regras e Invariantes do Projeto` e `## Verificação obrigatória antes de concluir`.

Tanto o compiler quanto o sincronizador de `settings.json` aplicam normalização automática da chave legada `thinkingLevel` para `thinking_level` (`normalize_options`). Além disso, `t3_reader.rs` usa a presença exata da string `— Playbook do Orquestrador (T3 Code)` no `SKILL.md` para distinguir squads geradas pelo compiler de squads manuais externos.

### Sincronização de `settings.json` (`settings_sync.rs`)

Todas as mutações em `~/.t3/userdata/settings.json` criam primeiro um backup exato dos bytes originais em `~/.t3/userdata/settings.json.bak` via escrita atômica e preservam integralmente todas as chaves não gerenciadas (como `favorites`, `providerInstances` e chaves desconhecidas):

- **Sync global (`sync_global_settings`)**: atualiza `defaultModelSelection` a partir de `preset.orchestrator` e `fallbackModelSelection` a partir de `preset.fallbackChain[0]` (quando existe ao menos uma etapa de fallback).
- **Sync de projeto (`sync_project_settings`)**: atualiza apenas `projectSettingsOverrides[projectId].defaultModelSelection`, preservando outras chaves já presentes no objeto daquele projeto e overrides de outros projetos.
- **Remoção de override (`remove_project_settings_override`)**: remove `projectSettingsOverrides[projectId]` após salvar o backup `.bak`.

Em `settings.json`, o objeto `options` de cada `ModelSelection` é convertido de mapa `Record<string, string>` para o formato de array do T3 Code (`[{ "id": "<chave>", "value": "<valor>" }]`), com `thinkingLevel` normalizado para `thinking_level`.

### Reverse Importer (`importer.rs`)

Quando um projeto já possui uma squad manual em `<workspace>/.agents/skills/*-squad/` sem `.t3code/preset.jsonc`, o comando `import_project_squad` executa `import_existing_squad`:

1. Localiza o primeiro diretório `*-squad` em `.agents/skills/` em ordem alfabética que contenha `SKILL.md`.
2. Infere o preset base pelo conteúdo de `SKILL.md`: detecta o provedor predominante declarado na squad existente (por exemplo, `codex`, `antigravity` ou outro provedor configurado) para definir o `extends` inicial (como `default` ou um preset compatível) e importa os papéis encontrados em `roles/*.md`.
3. Percorre `roles/*.md` validando os nomes de arquivo com `validate_safe_id` e extrai título, descrição, `whenToUse`, instância, modelo, opções (`thinkingLevel` normalizado para `thinking_level`), skills, MCPs, `allowedPaths`, `forbiddenPaths`, `invariants` e `verificationCommands`.
4. Detecta heurísticas de modelo no corpo do Markdown (`gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra`, `gemini-4-argon`, `gemini-4-hydrogen`) e pistas de contenção no `SKILL.md` (`parallel_workers=1` ou `banco único` ativam `singleTestDb: true`; `isolation: "worktree"` sem `isolation: "shared"` define `defaultIsolation: "worktree"`).
5. Grava `.t3code/preset.jsonc` com `id: <project_slug>` e `extends: <base_preset_id>`.

Para o passo a passo operacional na interface, consulte o [Guia de Uso](GUIA_DE_USO.md). Para detalhes sobre arquitetura interna, invariantes de segurança, catálogo dos 15 comandos IPC e guia de resolução de problemas, consulte [Arquitetura e Troubleshooting](ARQUITETURA_E_TROUBLESHOOTING.md) e [Máquinas de Estado](STATE_MACHINES.md).
