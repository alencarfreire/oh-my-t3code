# AGENTS.md — `oh-my-t3code`

## Visão Geral do Projeto

`oh-my-t3code` é um aplicativo companheiro nativo para **macOS Menu Bar** (com suporte futuro a System Tray multiplataforma) + **Preset Studio** + **Compiler** para o **T3 Code**, inspirado em `oh-my-opencode-slim` e `oh-my-opencode-companion`.

Ele permite monitorar subagentes em execução no T3 Code em tempo real, alternar e sincronizar presets de orquestração por projeto com 1 clique, editar presets com herança e matriz de modelos/fallback, e compilar skills determinísticas de squad (`<repo>/.agents/skills/<proj>-squad/`).

---

## Arquitetura (MVP macOS)

### 1. Backend Nativo — Tauri v2 + Rust (`src-tauri/`)
- **Menu Bar / Tray Icon:** `ActivationPolicy::Accessory` no macOS (sem ícone fixo no Dock quando apenas no tray) e posicionamento preciso da janela Popover ancorada ao ícone da Menu Bar (com `PopoverBlurGuard` + `TRAY_BLUR_DEBOUNCE = 250ms` em `lib.rs`).
- **Monitoramento SQLite (somente leitura):** leitura via `rusqlite` em `~/.t3/userdata/statev2.sqlite` (`OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX`, `PRAGMA query_only = true`, `busy_timeout = 250ms` e até 4 tentativas), consultando as 6 projeções:
  - `projection_projects`
  - `projection_threads`
  - `orchestration_v2_projection_threads`
  - `orchestration_v2_projection_subagents`
  - `orchestration_v2_projection_runs`
  - `orchestration_v2_projection_turn_items`
- **Telemetria de Saúde de Sessão (`SessionHealth`):** calcula `ProjectSessionHealth` e `GlobalSessionHealth` (`acp_dead` > `over_concurrency` > `fat_parent` > `ok`) com base em *runs*, *turns*, *items*, workers ativos e `hardwareProfile` (`ramWarning` em `laptop-8gb` quando `activeAntigravityWorkers > 2`).
- **Sincronização Segura de Settings:** leitura e escrita atômica segura em `~/.t3/userdata/settings.json` (campos `defaultModelSelection`, `fallbackModelSelection` e `projectSettingsOverrides`), com backup obrigatório em `settings.json.bak`.
- **Preset Compiler:** lê presets globais (`~/.config/oh-my-t3code/presets/*.jsonc`) e overrides por projeto (`<repo>/.t3code/preset.jsonc`), resolve herança (`extends`) + `disabledRoles` + `sessionPolicy`/`hardwareProfile` (incluindo *clamp* automático de `parentThinkingLevel` `high`/`xhigh` → `medium` em `laptop-8gb`), e compila arquivos `<repo>/.agents/skills/<proj>-squad/SKILL.md` (com Seção 5 determinística `## 5. Gestão de sessão e concorrência (oh-my-t3code)`) e `roles/*.md`.
- **Reverse Importer:** importa e converte squads manuais existentes (`.agents/skills/*-squad/{SKILL.md, roles/*.md}`) para o formato `<repo>/.t3code/preset.jsonc` do `oh-my-t3code`.

### 2. Frontend — React 19 + TypeScript + Vite + Tailwind CSS v4 (`src/`)
1. **Menu Bar Popover View (~380x500px):**
   - Resumo do **Preset Global (Default)**, faixa **`Saúde global da sessão e RAM`**, **`Monitor de Subagentes`** recolhível e barra de busca rápida (`⌘K` / `/`, visível quando há 2 ou mais projetos cadastrados no T3 Code: `snapshot.projects.length > 1`, exibindo inclusive projetos filtrados em `Seguindo Global Default`).
   - Lista de projetos com override em 1 clique (**Sync**, **Swap** `⇄` de orquestrador, **Swap Squad** para orquestrador + papéis da squad, toggle `Ativo`/`Desativado`, botão `Global` e acesso direto ao **Preset Studio**), além do botão **`Abrir thread pai novo`** para copiar o prompt de handoff quando há alerta de saúde.
   - Troca rápida de provedor/instância (`antigravity` Agy Veca ⇄ `antigravity_2` Agy Principal; `gpt-6.1-sol` ⇄ `gpt-6.1-terra` no `codex`), com opção global **Swap Squad** que também ressincroniza projetos herdados ativos (`GlobalSwapReport`).
2. **Preset Studio Window (~1120x760px):**
   - Editor completo de **Global Presets** (`~/.config/oh-my-t3code/presets/*.jsonc`) e **Project Overrides** (`<repo>/.t3code/preset.jsonc`) com suporte a herança `extends`, `Swap` / `Swap Squad` no cabeçalho e guarda de alterações não salvas (`alertdialog`).
   - Matriz **Role × Model × Fallback Chain** (`gemini-4-hydrogen`, `gemini-4-argon`, `thinking_level`, `reasoningEffort`, instâncias e cadeia de fallback).
   - Seletor de **Skills** (`~/.config/skillshare/skills`, `~/.gemini/config/skills`) e **MCPs** (`ai-memory`, `context7`, `playwright`, `linear`).
   - Aba **`Pontos de Contenção`**: configura **`sessionPolicy`** (`hardwareProfile`, limites de workers, orçamento de handoff, `workerThinkingByKind`, `forbiddenPatterns`) e **`contention`** (`singleTestDb`, `defaultIsolation`: `shared` vs `worktree`, `conflictFiles`).
   - **Markdown Diff Preview** obrigatório na aba **`Preview & Diff`** antes de gravar qualquer arquivo compilado em disco.

---

## Contratos Críticos de Integração com o T3 Code (Invariantes)

1. **Acesso estritamente Read-Only ao `statev2.sqlite`:**
   - `~/.t3/userdata/statev2.sqlite` **DEVE SEMPRE** ser aberto com `OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX`, `PRAGMA query_only = true` e `busy_timeout(250ms)` (nunca com flags de criação ou escrita).
   - É **terminantemente proibido** executar `INSERT`, `UPDATE`, `DELETE`, `PRAGMA journal_mode`, `wal_checkpoint` ou qualquer operação que adquira lock de escrita ou modifique o banco do T3 Code.
   - Sempre trate erros de busy/lock com backoff leve (até 4 tentativas com pausa de `50 ms`) e inspeção tolerante de colunas (`PRAGMA table_info`) para nunca travar o processo principal do T3 Code.
2. **Backup + Escrita Atômica em `settings.json`:**
   - Antes de qualquer modificação em `~/.t3/userdata/settings.json`, **DEVE** ser criado um backup íntegro do arquivo atual (`~/.t3/userdata/settings.json.bak` via escrita atômica).
   - A escrita **DEVE** ser atômica: serialize o JSON preservando todas as chaves não gerenciadas (`favorites`, `providerInstances` e campos desconhecidos), atualizando apenas `defaultModelSelection`, `fallbackModelSelection` e `projectSettingsOverrides`, grave em um arquivo temporário exclusivo (`.<file>.tmp.<pid>.<seq>`) no **mesmo diretório**, execute `sync_all()`/`fsync` e faça `rename` atômico sob a hierarquia de locks `lock_config_state()` → `lock_settings_file()`.
3. **Compilação Determinística, Clamp `laptop-8gb` e Cache-Safe:**
   - Os arquivos gerados pelo compiler (`<repo>/.agents/skills/<proj>-squad/SKILL.md` — incluindo a Seção 5 `## 5. Gestão de sessão e concorrência (oh-my-t3code)` — e `roles/*.md`) **DEVEM** ser determinísticos e cache-safe: `BTreeMap`, ordenação estável de chaves/listas, formatação Markdown consistente, sem timestamps aleatórios, UUIDs efêmeros ou variação não determinística entre execuções idênticas.
   - O perfil `laptop-8gb` **DEVE** aplicar *clamp* automático de `parentThinkingLevel` (`high`/`xhigh` → `medium`) via `effective_parent_thinking_level` / `effective_orchestrator_options` tanto em `settings.json` quanto na Seção 5 do `SKILL.md`.
   - Escritas em disco devem ser precedidas por preview de diff quando acionadas pelo Studio e protegidas contra path traversal (`validate_safe_id`, `ensure_within_workspace`).
4. **Paridade Estrita do Contrato IPC (Rust ↔ TypeScript):**
   - Toda struct/enum exposta via comandos Tauri em `src-tauri/src/models.rs` deve corresponder exatamente às definições TypeScript em `src/types/ipc.ts` (nomes de campos em camelCase/serde consistentes, tipos nullable explícitos e tratamento uniforme de erros), bem como ao comportamento do `MockIpcStore` em `src/lib/mock-data.ts`.

---

## Pontos de Contenção & Topologia da Squad

- **Arquivos de alta contenção (ímãs de conflito):**
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
  - `package.json`
  - Contrato IPC compartilhado (`src/types/ipc.ts` ↔ `src-tauri/src/models.rs` + `src-tauri/src/lib.rs`)
- **Regra de `isolation` na orquestração:**
  - Use **`isolation: "shared"` em ondas sequenciais** (`rust-core` → `frontend-ui` → `qa-reviewer`) sempre que a tarefa alterar comandos IPC, modelos compartilhados ou arquivos de manifesto/configuração (`Cargo.toml`, `tauri.conf.json`, `package.json`).
  - Use **`isolation: "worktree"` em paralelo** apenas quando as frentes forem desacopladas (ex.: módulo interno Rust isolado vs componentes puros de UI sem mudança de contrato IPC).

---

## Convenções de Idioma e Código

- **Código e artefatos técnicos:** identificadores, tipos, funções, comandos Tauri, testes, comentários técnicos e mensagens de commit em **inglês**.
- **Interface de usuário (UI) e documentação de governança:** textos voltados ao usuário, labels e documentação operacional em **pt-BR** (ou termos técnicos consagrados em inglês quando mais claros, como `Preset`, `Sync`, `Fallback`, `Worktree`, `Diff`).

---

## Comandos de Verificação Obrigatória

Execute os comandos aplicáveis após alterações antes de concluir qualquer entrega:

### Backend Rust / Tauri (`src-tauri/`)
```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

### Frontend (`src/`)
```bash
bun run typecheck
bun run test
bun run build
```
