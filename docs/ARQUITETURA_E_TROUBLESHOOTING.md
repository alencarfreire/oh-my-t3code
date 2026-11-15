# Arquitetura, segurança, IPC e troubleshooting (`oh-my-t3code`)

🌐 [English](en/ARCHITECTURE_AND_TROUBLESHOOTING.md) | **Português (Brasil)** · [Voltar ao README](../README.pt-BR.md)

Este documento descreve a arquitetura interna do `oh-my-t3code` (backend Tauri v2 em Rust, frontend React 19 + TypeScript e integração com o T3 Code), detalha as garantias de segurança e integridade de dados, lista os 15 comandos Inter-Process Communication (IPC) e reúne procedimentos diretos para diagnosticar e corrigir problemas operacionais.

## Arquitetura do sistema

O `oh-my-t3code` atua como aplicativo companheiro externo ao T3 Code: lê estado operacional em modo somente leitura, gerencia presets declarativos e grava artefatos compilados de squad no repositório de cada projeto e em `settings.json`.

### Módulos do backend Rust (`src-tauri/src/`)

Cada módulo em `src-tauri/src/` isola uma fronteira clara entre leitura do T3 Code, resolução de configuração, compilação e sincronização em disco:

- **[`main.rs`](../src-tauri/src/main.rs)**: ponto de entrada do binário nativo; delega imediatamente a inicialização para `oh_my_t3code_lib::run()`.
- **[`lib.rs`](../src-tauri/src/lib.rs)**: inicializa o `tauri::Builder`, configura `ActivationPolicy::Accessory` no macOS, cria o `TrayIconBuilder` (`main-tray`) com menu de contexto (`Alternar Popover`, `Abrir Preset Studio`, `Sair`), gerencia o posicionamento e visibilidade das janelas `popover` e `studio` e expõe os 15 comandos `#[tauri::command]`.
- **[`models.rs`](../src-tauri/src/models.rs)**: define `AppError`, `AppPaths::from_env` e todas as structs de domínio e IPC (`GlobalAppConfig`, `PresetConfig`, `RoleConfig`, `ContentionPolicy`, `DashboardSnapshot`, `ResolvedProjectPreset`, `CompilePreviewResult`, `SyncResult`) com `#[serde(rename_all = "camelCase")]`.
- **[`preset_engine.rs`](../src-tauri/src/preset_engine.rs)**: implementa o parser JSON with Comments (JSONC) (`strip_jsonc_comments`), validação de IDs (`validate_safe_id`), herança recursiva (`extends`, limite de 16 níveis e detecção de ciclos), o preset base padrão (`default`) e presets customizados do usuário com auto-reparo, escrita atômica (`atomic_write_file`) e o lock externo `lock_config_state()`.
- **[`compiler.rs`](../src-tauri/src/compiler.rs)**: compila deterministicamente `.t3code/preset.jsonc`, `.agents/skills/<slug>-squad/SKILL.md` e `roles/*.md` com verificação `ensure_within_workspace`, gera previews com unified diff (`compile_preset_preview`) e coordena fluxos de alto nível (`apply_preset_to_project`, `swap_project_primary_instance`, `set_global_preset_config`, `swap_global_instance`, `set_project_preset_enabled`, `remove_project_override`).
- **[`settings_sync.rs`](../src-tauri/src/settings_sync.rs)**: executa preview de diff, backup obrigatório em `settings.json.bak` e escrita atômica em `~/.t3/userdata/settings.json` (`sync_project_settings`, `sync_global_settings`, `remove_project_settings_override`), serializados pelo lock folha `lock_settings_file()`.
- **[`t3_reader.rs`](../src-tauri/src/t3_reader.rs)**: lê `settings.json` (instâncias de provedor, seleções globais e overrides por projeto), abre `statev2.sqlite` em modo estritamente read-only para extrair `projection_projects`, `projection_threads` e `orchestration_v2_projection_subagents`, varre raízes de skills (`skillshare` e `gemini`) e monta `DashboardSnapshot`.
- **[`importer.rs`](../src-tauri/src/importer.rs)**: implementa o Reverse Importer (`import_existing_squad`), convertendo diretórios manuais `.agents/skills/*-squad/{SKILL.md, roles/*.md}` em arquivos `.t3code/preset.jsonc` estruturados.

### Frontend React 19 + TypeScript (`src/`)

O frontend roda dentro das duas webviews Tauri ou em navegador comum via fallback de mock para desenvolvimento e testes:

- **[`App.tsx`](../src/App.tsx)**: lê `?view=popover` ou `?view=studio` na URL. Fora do runtime Tauri (quando `window.__TAURI_INTERNALS__` não existe e `?view` não foi passado), renderiza uma barra superior `Browser Preview (Mock IPC ativo)` para alternar entre `Popover (380×500)` e `Preset Studio (1120×760)`.
- **[`views/PopoverView.tsx`](../src/views/PopoverView.tsx)**: interface compacta da Menu Bar para alternar o Preset Global, filtrar projetos com `⌘K`, trocar presets por projeto com 1 clique, executar **Swap** (`⇄`), pausar/ativar overrides, reverter para Global Default e abrir o Studio.
- **[`views/StudioView.tsx`](../src/views/StudioView.tsx)**: editor completo em 5 abas com cabeçalho de resumo arquitetural, barra de status/erro e ações de salvar, definir como padrão global, pausar, remover override e sincronizar.
- **`src/components/studio/`**:
  - [`StudioSidebar.tsx`](../src/components/studio/StudioSidebar.tsx): navegação entre presets globais e projetos com override, criação de presets, fluxo **Configurar Projeto** e botão **Importar Squad Existente**.
  - [`OverviewFallbackTab.tsx`](../src/components/studio/OverviewFallbackTab.tsx): edição de metadados, `extends`, `topology`, orquestrador e cadeia ordenada `fallbackChain`.
  - [`RolesMatrixTab.tsx`](../src/components/studio/RolesMatrixTab.tsx): matriz de papéis, instância, modelo, opções (`thinking_level`, `reasoningEffort`, `serviceTier`), `allowedPaths`, `forbiddenPaths`, invariantes e comandos de verificação.
  - [`SkillsMcpsTab.tsx`](../src/components/studio/SkillsMcpsTab.tsx): seletor de skills globais descobertas e servidores Model Context Protocol (MCP) (`ai-memory`, `context7`, `playwright`, `linear`).
  - [`ContentionTab.tsx`](../src/components/studio/ContentionTab.tsx): configuração de `ContentionPolicy` (`defaultIsolation`, `singleTestDb`, `envVars`, `gitIgnoredBuilds`, `conflictFiles`).
  - [`PreviewDiffTab.tsx`](../src/components/studio/PreviewDiffTab.tsx): inspeção de unified diff e conteúdo completo dos arquivos gerados e de `settings.json` antes da gravação em disco.
- **[`lib/ipc-client.ts`](../src/lib/ipc-client.ts)**: wrapper tipado `invokeIpc` e `listenStudioNavigate` que roteia chamadas para `@tauri-apps/api` quando em Tauri e para `MockIpcStore` quando em navegador ou Vitest.
- **[`lib/mock-data.ts`](../src/lib/mock-data.ts)**: `MockIpcStore` em memória para preview standalone em navegador e suíte de testes Vitest.
- **[`lib/preset-utils.ts`](../src/lib/preset-utils.ts)**: catálogos curados de modelos/opções por provedor, templates de papéis (`COMMON_ROLE_TEMPLATES`), tags visuais e sanitização/validação de IDs (`sanitizeSafeId`, `isValidSafeId`).
- **[`types/ipc.ts`](../src/types/ipc.ts)**: definições TypeScript espelhando 1:1 [`models.rs`](../src-tauri/src/models.rs) e os 15 comandos de [`lib.rs`](../src-tauri/src/lib.rs).

### Janelas Tauri, Menu Bar no macOS e evento `studio://navigate`

O manifesto [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) registra duas janelas ocultas na inicialização (`visible: false`):

| Janela (`label`) | Dimensões | Características | URL inicial |
| :--- | :--- | :--- | :--- |
| `popover` | `380 × 500` px | `resizable: false`, `decorations: false`, `alwaysOnTop: true`, `skipTaskbar: true` | `index.html?view=popover` |
| `studio` | `1120 × 760` px (mín. `900 × 620`) | `resizable: true`, `decorations: true` | `index.html?view=studio` |

No macOS, [`lib.rs`](../src-tauri/src/lib.rs) ativa `ActivationPolicy::Accessory` para manter o app exclusivamente na Menu Bar superior sem ocupar espaço fixo no Dock. Ao clicar com o botão esquerdo no ícone do tray, `position_popover_under_tray` alinha a janela `popover` centralizada `6` px abaixo do ícone (limitada às bordas do monitor ativo) e exibe o popover; ao perder o foco (`WindowEvent::Focused(false)`), o popover se oculta. Na janela `studio`, fechar pelo botão da janela intercepta `WindowEvent::CloseRequested` e apenas oculta a janela (`hide()`) para reabertura instantânea.

Quando o usuário aciona `open_studio_window(projectId, presetId)`, o backend oculta o `popover`, exibe e foca a janela `studio` e emite o evento `studio://navigate` com `{ projectId, presetId }`, consumido via `listenStudioNavigate` no frontend para selecionar diretamente o preset global ou o projeto desejado.

## Garantias de segurança e integridade

As invariantes abaixo protegem os dados do T3 Code e os arquivos do workspace contra corrupção, perda de configuração ou escrita fora do diretório permitido.

### Leitura SQLite estritamente read-only

A função `open_sqlite_readonly` em [`t3_reader.rs`](../src-tauri/src/t3_reader.rs) abre `~/.t3/userdata/statev2.sqlite` usando estritamente:

- `OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX` (nunca cria arquivo nem abre para escrita).
- `conn.busy_timeout(Duration::from_millis(250))` para aguardar brevemente sem travar quando o T3 Code estiver escrevendo.
- `PRAGMA query_only = true` como trava adicional no motor SQLite.

Para tolerar diferenças entre versões do schema do T3 Code, `read_sqlite_state_with_context` consulta `PRAGMA table_info(...)` antes de montar as queries em `projection_threads`, `projection_projects` e `orchestration_v2_projection_subagents` (aceitando tanto colunas diretas quanto fallback via `payload_json`, `default_model` ou `default_model_selection_json`, `parent_thread_id` ou `thread_id`, e filtrando registros com `deleted_at IS NULL` quando a coluna existir).

### Backup, escrita atômica e serialização Read-Modify-Write (RMW)

Toda escrita crítica usa `atomic_write_file` em [`preset_engine.rs`](../src-tauri/src/preset_engine.rs):

1. Aloca um arquivo temporário exclusivo no **mesmo diretório** do destino usando `.{file_name}.tmp.{pid}.{seq}` (com `AtomicU64` incremental e `OpenOptions::create_new(true)`), evitando colisões entre threads no mesmo processo.
2. Escreve o conteúdo completo, chama `file.sync_all()` (`fsync`) e fecha o descritor.
3. Executa `fs::rename` atômico sobre o arquivo final (removendo o `.tmp.*` em caso de falha).

Antes de qualquer alteração em `~/.t3/userdata/settings.json`, o backend grava os bytes originais exatos em `~/.t3/userdata/settings.json.bak` via `atomic_write_file`, preserva todas as chaves não relacionadas (`favorites`, `providerInstances`, etc.) e serializa operações concorrentes seguindo a hierarquia estrita de locks: `preset_engine::lock_config_state()` (externo) → `settings_sync::lock_settings_file()` (interno/folha).

> [!NOTE]
> O hardening de concorrência em disco (`SM-3`: `lock_config_state`, `lock_settings_file` e `.tmp.<pid>.<seq>`), a sincronização/limpeza do preset global (`SM-1`: `save_global_preset_and_sync`, remoção de `defaultModelSelection`/`fallbackModelSelection` ao pausar e guarda em `swap_global_instance`) e a estabilização de overrides por projeto (`SM-2`: guarda de swap quando pausado, prune de `roles/*.md` órfãos, limpeza de squad compilada em `remove_project_override` preservando squads manuais e tombstone `disabledRoles`) já estão implementados. Os demais pontos de arquitetura/UI pendentes (`SM-4`, `SM-5` e `SM-6`, como *race conditions* na UI, guarda de `dirty` state, paridade do `MockIpcStore` e corrida Tray/Blur no macOS) seguem documentados em [`STATE_MACHINES.md`](STATE_MACHINES.md).

### Proteção contra path traversal e compilação determinística

- Todo ID de preset, `extends` e `role` é validado por `validate_safe_id` (`[a-zA-Z0-9_-]`, `1` a `64` caracteres, proibindo `..`, `/` e `\`).
- Todo arquivo gravado no repositório pelo compiler passa por `ensure_within_workspace(workspace_root, target)`, rejeitando qualquer `Component::ParentDir` ou caminho fora de `workspace_root` com `AppError::PathTraversal`.
- Os mapas `roles`, `options` e `envVars` usam `BTreeMap` e zero timestamps ou UUIDs aleatórios, garantindo saídas idênticas entre compilações repetidas e cache-safety para provedores de LLM.

## Referência dos 15 comandos IPC

Todos os comandos abaixo são registrados em [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs) e tipados em [`src/types/ipc.ts`](../src/types/ipc.ts) (argumentos e retornos em `camelCase`).

| Comando | Parâmetros | Retorno | O que faz |
| :--- | :--- | :--- | :--- |
| `get_dashboard_snapshot` | — | `DashboardSnapshot` | Lê `config.jsonc`, presets globais, `settings.json`, `statev2.sqlite` (read-only) e raízes de skills para montar o estado completo do painel |
| `list_global_presets` | — | `PresetConfig[]` | Garante o preset base padrão (`default`), resolve a herança de todos os presets em `~/.config/oh-my-t3code/presets/` e retorna `default` seguido pelos presets customizados do usuário |
| `get_project_preset` | `projectId`, `workspaceRoot` | `ResolvedProjectPreset` | Resolve `.t3code/preset.jsonc` (ou fallback global / hint de instância) e detecta `.agents/skills/*-squad/` no repositório |
| `save_global_preset` | `preset: PresetConfig` | `PresetConfig` | Delega para `save_global_preset_and_sync`: valida IDs e ciclos simples, grava `<presets_dir>/<id>.jsonc` atomicamente, sincroniza `settings.json` automaticamente quando for o `activeGlobalPresetId` com `globalConfig.enabled == true` e retorna o preset resolvido |
| `save_project_preset` | `projectId`, `workspaceRoot`, `preset: PresetConfig` | `ResolvedProjectPreset` | Valida IDs e existência do workspace, resolve `extends` e grava `<workspace>/.t3code/preset.jsonc` atomicamente |
| `preview_preset_sync` | `projectId`, `workspaceRoot`, `preset: PresetConfig` | `CompilePreviewResult` | Simula a compilação de `preset.jsonc`, `SKILL.md`, `roles/*.md` e `projectSettingsOverrides` retornando unified diffs sem escrever em disco |
| `apply_preset_sync` | `projectId`, `workspaceRoot`, `presetIdOrCustom?`, `customPreset?` | `SyncResult` | Grava atomicamente apenas os arquivos modificados no workspace, remove arquivos `roles/*.md` órfãos que não existem mais em `resolved.roles` e atualiza `projectSettingsOverrides[projectId]` em `settings.json` com backup `.bak` (ou remove o override de `settings.json` quando `enabled == false`) |
| `swap_project_instance` | `projectId`, `workspaceRoot` | `SyncResult` | Exige override ativo (`enabled == true`, retornando erro `InvalidInput` se pausado); alterna `antigravity` ⇄ `antigravity_2` (ou `gpt-6.1-sol` ⇄ `gpt-6.1-terra` no `codex`) e reaplica o preset do projeto |
| `import_project_squad` | `projectId`, `workspaceRoot` | `ResolvedProjectPreset` | Importa `.agents/skills/*-squad/{SKILL.md, roles/*.md}` existentes e grava `.t3code/preset.jsonc` herdando do preset base padrão (`default`) ou de um preset customizado compatível |
| `set_global_preset_config` | `activePresetId`, `enabled` | `DashboardSnapshot` | Atualiza `~/.config/oh-my-t3code/config.jsonc`; quando `enabled == true`, sincroniza `defaultModelSelection` e `fallbackModelSelection` em `settings.json`; quando `enabled == false`, remove essas chaves via `remove_global_settings_override` preservando o restante |
| `swap_global_instance` | — | `DashboardSnapshot` | Exige `globalConfig.enabled == true` (retorna erro `InvalidInput` quando desativado); alterna a instância/modelo do orquestrador no preset global ativo, ajusta `fallbackChain[0]` se houver colisão e sincroniza `settings.json` |
| `set_project_preset_enabled` | `projectId`, `workspaceRoot`, `enabled` | `SyncResult` | Se `enabled == true`, recompila e sincroniza o override; se `false`, grava `enabled: false` em `.t3code/preset.jsonc` e remove `projectSettingsOverrides[projectId]` |
| `remove_project_override` | `projectId`, `workspaceRoot` | `DashboardSnapshot` | Remove `.t3code/preset.jsonc` (e `.t3code/` se ficar vazio), remove `.agents/skills/<slug>-squad/` quando gerada pelo compiler (preservando squads manuais sem a assinatura do compiler e demais skills) e remove `projectSettingsOverrides[projectId]` de `settings.json` |
| `open_studio_window` | `projectId?`, `presetId?` | `void` | Oculta o `popover`, mostra e foca o `studio` e emite o evento `studio://navigate` com o alvo escolhido |
| `toggle_popover_window` | — | `void` | Alterna a visibilidade da janela `popover` |

## Solução de problemas e FAQ

Use os procedimentos abaixo para diagnosticar e resolver ocorrências comuns durante o uso diário ou desenvolvimento.

### 1. O app abre mas não mostra projetos (`sqliteAvailable: false` ou lista vazia)

O backend procura o banco do T3 Code em `$T3CODE_HOME/userdata/statev2.sqlite` (padrão `~/.t3/userdata/statev2.sqlite`).

1. Confirme se o arquivo existe no terminal:

```bash
ls -la "${T3CODE_HOME:-$HOME/.t3}/userdata/statev2.sqlite"
```

2. Se o T3 Code estiver instalado em outro diretório, exporte `T3CODE_HOME` antes de iniciar o `oh-my-t3code` (ou abra o T3 Code pelo menos uma vez para que ele crie `statev2.sqlite` e `settings.json`).
3. Recarregue o snapshot pelo botão de atualização no topo do Popover.

### 2. O app não aparece no Dock do macOS

Esse comportamento é intencional: [`lib.rs`](../src-tauri/src/lib.rs) define `ActivationPolicy::Accessory` no macOS e `skipTaskbar: true` no popover.

1. Procure o ícone do `Oh My T3Code` na **Menu Bar superior** do macOS.
2. Clique com o botão esquerdo para abrir o Popover ou com o botão direito para abrir o menu (`Alternar Popover`, `Abrir Preset Studio`, `Sair`).

### 3. Erro `InvalidInput` ou `PathTraversal` ao criar preset ou papel

`validate_safe_id` aceita apenas `[a-zA-Z0-9_-]` com comprimento de `1` a `64` caracteres e rejeita `..`, `/` ou `\`.

1. Renomeie o ID removendo espaços, acentos, pontos ou barras (por exemplo, troque `meu.preset/v1` por `meu-preset-v1`).
2. Se estiver editando JSONC manualmente, confirme que tanto a chave dentro de `"roles"` quanto o campo `"id"` interno seguem a mesma regra.

### 4. Erro `CycleDetected` ou profundidade >= 16 em `extends`

O resolvedor de herança interrompe cadeias com ciclo (`A -> B -> A`), auto-herança (`A -> A`) ou mais de `16` níveis.

1. Inspecione o campo `"extends"` em `<workspace>/.t3code/preset.jsonc` e nos arquivos em `~/.config/oh-my-t3code/presets/*.jsonc`:

```bash
grep -n '"extends"' ~/.config/oh-my-t3code/presets/*.jsonc .t3code/preset.jsonc 2>/dev/null
```

2. Quebre o ciclo apontando o preset filho para um preset base sem ciclo (como o preset base padrão `default` ou um preset customizado do usuário sem ciclo) ou defina `"extends": null`.

### 5. Erro de JSONC inválido em `preset.jsonc` ou `config.jsonc`

Um erro de sintaxe (aspas não fechadas, chave extra ou vírgula fora de lugar) impede o parse do preset:

- Se `~/.config/oh-my-t3code/config.jsonc` estiver corrompido, `load_global_config` recua silenciosamente para `default` com `enabled: true`.
- Se `<workspace>/.t3code/preset.jsonc` estiver inválido, o app exibe alerta de parse ao abrir o projeto ou tentar sincronizar no Studio.

Para validar um JSONC rapidamente com Node/Bun após corrigir a sintaxe ou conferir aspas:

1. Abra o arquivo em questão no editor e confira se todos os blocos `/* ... */` foram fechados.
2. Salve o arquivo e clique em **Atualizar** no Popover ou abra o projeto novamente no Preset Studio.

### 6. Conflito na porta `1420` ao rodar `bun run dev` ou `bun run tauri:dev`

O arquivo [`vite.config.ts`](../vite.config.ts) fixa `port: 1420` e `strictPort: true`, conforme esperado por `devUrl` em [`tauri.conf.json`](../src-tauri/tauri.conf.json).

1. Liste qual processo ocupa a porta `1420`:

```bash
lsof -i :1420
```

2. Encerre o processo antigo pelo PID retornado:

```bash
kill <PID>
```

3. Execute `bun run dev` ou `bun run tauri:dev` novamente.

### 7. Erro ao compilar o app nativo (`bun run tauri:build` ou `cargo`)

A compilação nativa exige toolchain Rust funcional e ferramentas de linha de comando do Xcode no macOS, além do Bun atualizado.

1. Verifique as versões instaladas:

```bash
rustc --version && cargo --version && bun --version
```

2. Se `cargo` falhar por SDK ou linker ausente no macOS, instale os Xcode Command Line Tools:

```bash
xcode-select --install
```

3. Se o toolchain Rust estiver ausente ou desatualizado, atualize via `rustup update` e execute `cargo check --manifest-path src-tauri/Cargo.toml` antes de rodar `bun run tauri:build`.

### 8. Projeto aparece como `Squad s/ preset` e quero gerenciar pelo `oh-my-t3code`

Quando o repositório já possui `.agents/skills/*-squad/SKILL.md` criado manualmente, sem `.t3code/preset.jsonc`, o Popover exibe o badge **Squad s/ preset**.

1. Abra o **Preset Studio** (ícone de sliders no Popover ou menu da Menu Bar).
2. Na barra lateral do Studio, localize o projeto em **Projetos com Override** (ou dentro de **Configurar Projeto** se ainda não tiver override listado) e clique em **Importar Squad Existente** (ou **Importar Squad**).
3. Revise os papéis, opções e contenção importados para `.t3code/preset.jsonc` e clique em **Revisar Diff & Sincronizar** para consolidar a squad sob gestão do compiler.

### 9. Cota de um modelo ou conta Antigravity acabou no meio do trabalho

Você pode alternar a instância ou modelo primário sem editar arquivos na mão:

- **Troca imediata de instância/modelo**: clique na pílula de Swap (`⇄`) no card do projeto (ou na seção **Preset Global (Default)**) no Popover. Em instâncias Antigravity, o botão alterna entre a instância primária e a secundária (`antigravity` ⇄ `antigravity_2`); em instâncias `codex`, alterna entre os modelos configurados no provedor (por exemplo, `gpt-6.1-sol` ⇄ `gpt-6.1-terra`).
- **Ajuste permanente da contingência**: abra o preset no **Preset Studio**, acesse a aba **Visão Geral & Fallback** (`OverviewFallbackTab`) e reordene ou adicione etapas em `fallbackChain` (por exemplo, cross-provider de `antigravity` para `codex`).

### 10. Comportamentos conhecidos em estabilização

As máquinas de estado do backend (`SM-1`, `SM-2` e `SM-3`) já estão implementadas (incluindo locks e escrita atômica, limpeza de `settings.json` ao pausar, guarda contra swap em override pausado, prune de `roles/*.md` órfãos, limpeza da squad compilada em `remove_project_override` preservando squads manuais e tombstone `disabledRoles` na herança). Os pontos pendentes de UI/Mock seguem documentados em [`STATE_MACHINES.md`](STATE_MACHINES.md):

- **Ações assíncronas e timers no Popover (`SM-4`: `SM4-BUG-1`, `SM4-BUG-2`)**: concorrência entre ações globais (`config` vs `swap`), respostas *out-of-order* de `loadSnapshot`, estado `selectedPresets` obsoleto após alterações externas e timers de `"Sincronizado!"` não cancelados em retentativas.
- **Seleção, `studio://navigate`, saves parciais e guarda de rascunho no Studio (`SM-5`: `SM5-BUG-1`..`SM5-BUG-4`)**: corridas *out-of-order* em `selectProject`/`runPreview`, descarte ou leitura obsoleta de `studio://navigate` no *cold-start*/reabertura, dessincronização após falha na etapa 2 de saves compostos e perda de rascunho `dirty` ao navegar na sidebar.
- **Paridade do `MockIpcStore` e corrida Tray/Blur no macOS (`SM-6`: `SM6-BUG-1`, `SM6-BUG-2`)**: divergências residuais do store de mock em navegador fora do Tauri e corrida entre `Focused(false)` e `TrayIconEvent::Click` ao alternar o Popover na Menu Bar.

## Guia rápido para contribuidores

Ao evoluir o projeto, respeite os pontos de contenção, as convenções de idioma e a suíte de verificação obrigatória antes de encerrar qualquer entrega.

### Arquivos de alta contenção (ímãs de conflito)

Alterações nos arquivos abaixo exigem coordenação sequencial (`isolation: "shared"` em ondas `rust-core` → `frontend-ui` → `qa-reviewer`):

- [`src-tauri/Cargo.toml`](../src-tauri/Cargo.toml)
- [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json)
- [`package.json`](../package.json)
- Contrato IPC compartilhado: [`src-tauri/src/models.rs`](../src-tauri/src/models.rs) + [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs) ↔ [`src/types/ipc.ts`](../src/types/ipc.ts) + [`src/lib/ipc-client.ts`](../src/lib/ipc-client.ts) + [`src/lib/mock-data.ts`](../src/lib/mock-data.ts)

### Convenções de idioma

- **Código e artefatos técnicos**: mantenha identificadores, tipos, funções, comandos Tauri, testes, comentários de código e mensagens de commit em **inglês**.
- **UI e documentação operacional**: mantenha labels de interface, mensagens ao usuário e documentação em **pt-BR**, preservando termos técnicos consagrados em inglês (`Preset`, `Sync`, `Fallback`, `Worktree`, `Diff`) quando forem mais claros.

### Suíte completa de verificação

Execute todos os comandos aplicáveis antes de concluir qualquer tarefa (consulte também o [Guia de Uso](GUIA_DE_USO.md), [`README.pt-BR.md`](../README.pt-BR.md) e [`REFERENCIA_PRESETS_JSONC.md`](REFERENCIA_PRESETS_JSONC.md)):

```bash
# Backend Rust / Tauri
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml

# Frontend React / TypeScript
bun run typecheck
bun run test
bun run build
```
