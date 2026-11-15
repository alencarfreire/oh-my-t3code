# AGENTS.md — `oh-my-t3code`

## Visão Geral do Projeto

`oh-my-t3code` é um aplicativo companheiro nativo para **macOS Menu Bar** (com suporte futuro a System Tray multiplataforma) + **Preset Studio** + **Compiler** para o **T3 Code**, inspirado em `oh-my-opencode-slim` e `oh-my-opencode-companion`.

Ele permite monitorar subagentes em execução no T3 Code em tempo real, alternar e sincronizar presets de orquestração por projeto com 1 clique, editar presets com herança e matriz de modelos/fallback, e compilar skills determinísticas de squad (`<repo>/.agents/skills/<proj>-squad/`).

---

## Arquitetura (MVP macOS)

### 1. Backend Nativo — Tauri v2 + Rust (`src-tauri/`)
- **Menu Bar / Tray Icon:** `ActivationPolicy::Accessory` no macOS (sem ícone fixo no Dock quando apenas no tray) e posicionamento preciso da janela Popover ancorada ao ícone da Menu Bar.
- **Monitoramento SQLite (somente leitura):** leitura via `rusqlite` em `~/.t3/userdata/statev2.sqlite`, consultando as projeções:
  - `projection_projects`
  - `orchestration_v2_projection_subagents`
  - `projection_threads`
- **Sincronização Segura de Settings:** leitura e escrita atômica segura em `~/.t3/userdata/settings.json` (campo `projectSettingsOverrides`).
- **Preset Compiler:** lê presets globais (`~/.config/oh-my-t3code/presets/*.jsonc`) e overrides por projeto (`<repo>/.t3code/preset.jsonc`), resolve herança (`extends`) e compila arquivos `<repo>/.agents/skills/<proj>-squad/SKILL.md` e `roles/*.md`.
- **Reverse Importer:** importa e converte setups existentes (`dashboard-meta`, `cabrito`, `t3-global`) para o formato de preset JSONC do `oh-my-t3code`.

### 2. Frontend — React 19 + TypeScript + Vite + Tailwind CSS v4 (`src/`)
1. **Menu Bar Popover View (~380x500px):**
   - Monitor ao vivo de subagentes em execução (atividade de `delegate_task` vinda de `orchestration_v2_projection_subagents`).
   - Lista de projetos do T3 Code com dropdown de troca rápida de Preset em 1 clique e botão de **Sync**.
   - Toggle rápido de troca de provedor/instância (`antigravity` / `antigravity_2`).
2. **Preset Studio Window:**
   - Editor completo de **Global Presets** (`~/.config/oh-my-t3code/presets/*.jsonc`) e **Project Overrides** (`<repo>/.t3code/preset.jsonc`) com suporte a herança `extends`.
   - Matriz **Role × Model × Fallback Chain** (`gemini-4-hydrogen`, `gemini-4-argon`, `thinking_level`, instâncias e cadeia de fallback).
   - Seletor de **Skills** (`~/.config/skillshare/skills`) e **MCPs** (`ai-memory`, `context7`, `playwright`, `linear`).
   - Configurador de **Contention Points** e regras de isolamento (`shared` vs `worktree`).
   - **Markdown Diff Preview** obrigatório antes de gravar qualquer arquivo compilado em disco.

---

## Contratos Críticos de Integração com o T3 Code (Invariantes)

1. **Acesso estritamente Read-Only ao `statev2.sqlite`:**
   - `~/.t3/userdata/statev2.sqlite` **DEVE SEMPRE** ser aberto com `OpenFlags::SQLITE_OPEN_READ_ONLY` (e nunca com flags de criação ou escrita).
   - É **terminantemente proibido** executar `INSERT`, `UPDATE`, `DELETE`, `PRAGMA journal_mode`, `wal_checkpoint` ou qualquer operação que adquira lock de escrita ou modifique o banco do T3 Code.
   - Sempre trate erros de busy/lock com backoff leve ou leitura tolerante para nunca travar o processo principal do T3 Code.
2. **Backup + Escrita Atômica em `settings.json`:**
   - Antes de qualquer modificação em `~/.t3/userdata/settings.json`, **DEVE** ser criado um backup íntegro do arquivo atual (ex.: `~/.t3/userdata/settings.json.bak` ou backup versionado com timestamp antes da gravação).
   - A escrita **DEVE** ser atômica: serialize o JSON preservando todas as chaves não relacionadas a `projectSettingsOverrides`, grave em um arquivo temporário no **mesmo diretório**, execute `sync_all()`/`fsync` e faça `rename` atômico sobre o destino.
3. **Compilação Determinística e Cache-Safe:**
   - Os arquivos gerados pelo compiler (`<repo>/.agents/skills/<proj>-squad/SKILL.md` e `roles/*.md`) **DEVEM** ser determinísticos e cache-safe: ordenação estável de chaves/listas, formatação Markdown consistente, sem timestamps aleatórios, UUIDs efêmeros ou variação não determinística entre execuções idênticas.
   - Escritas em disco devem ser precedidas por preview de diff quando acionadas pelo Studio e protegidas contra path traversal.
4. **Paridade Estrita do Contrato IPC (Rust ↔ TypeScript):**
   - Toda struct/enum exposta via comandos Tauri em `src-tauri/src/models/` deve corresponder exatamente às definições TypeScript em `src/types/` (nomes de campos em camelCase/serde consistentes, tipos nullable explícitos e tratamento uniforme de erros).

---

## Pontos de Contenção & Topologia da Squad

- **Arquivos de alta contenção (ímãs de conflito):**
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
  - `package.json`
  - Contrato IPC compartilhado (`src/types/` ↔ `src-tauri/src/models/`)
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
