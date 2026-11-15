# Complete user guide: Menu Bar Popover & Preset Studio

🌐 **English** | [Português (Brasil)](../GUIA_DE_USO.md) · [Back to README](../../README.md)

This guide walks through every screen, button, keyboard shortcut, and workflow in **Oh My T3Code** across both the **Menu Bar Popover** (`380×500px`) and the **Preset Studio** (`1120×760px`). The current app interface uses Portuguese (Brazil) labels, so this guide keeps each exact UI label alongside its English meaning.

## 1. Menu Bar Popover (`380×500px`)

The **Popover** is your macOS menu bar control center for switching the global preset, managing per-project overrides, and swapping accounts or models in one click.

### Accessing the popover and keyboard shortcuts

In native macOS mode (`bun run tauri:dev` or the compiled app), `oh-my-t3code` runs as a menu bar accessory with no Dock icon:

- **Left-click the menu bar icon**: opens or closes the **Popover** aligned below the icon
- **Right-click the menu bar icon**: opens the native context menu with **`Alternar Popover`** (Toggle Popover), **`Abrir Preset Studio`** (Open Preset Studio), and **`Sair`** (Quit)
- **Click outside the window**: hides the **Popover** automatically when it loses focus

While the **Popover** has focus, use these keyboard shortcuts:

| Shortcut | Action |
| :--- | :--- |
| `⌘K` / `Ctrl+K` or `/` | Focuses the filter input for projects with overrides (shown when 2 or more overrides exist) |
| `⌘,` / `Ctrl+,` | Hides the Popover and opens the **Preset Studio** |
| `Esc` | Closes the **Popover** |

> [!NOTE]
> Pressing `/` focuses the search input only when your cursor is outside an `input`, `textarea`, or `select` field.

### Header and `Preset Global (Default)` section

The top header displays the live status summary (`Global Ativo` when active, or `Global Pausado · N override(s) · M presets` when paused), the refresh button (**`Atualizar dados do T3 Code`**), and the **Studio** button (`⌘,`).

Directly below the header sits the **`Preset Global (Default)`** card, which controls the default configuration applied to every project without a local override:

- **Status badges**: **`Global Ativo`** (Active) / **`Global Pausado`** (Paused) in the header, and **`Instalado por padrão`** (blue badge shown when the active preset is `default`)
- **Toggle `Ativo` / `Desativado`**: enables or pauses the Global Preset. When active, it displays `Padrão para todos os projetos · <model>` and syncs `defaultModelSelection` and `fallbackModelSelection` to `~/.t3/userdata/settings.json`. When disabled, it displays `Desativado — projetos sem override usam config padrão do T3 Code`
- **`Preset Global Default` dropdown**: selects which global preset in `~/.config/oh-my-t3code/presets/*.jsonc` acts as the default (`default` or custom global presets you create)
- **Swap `⇄` button**: switches between configured provider instances/accounts or models in T3 Code in one click when rate limits hit:
  - When primary and secondary instances of the same provider are configured (such as `antigravity` ⇄ `antigravity_2`): displays the active instance label and swaps between both configured instances (`Inverter instância global`)
  - On Codex presets (`codex`): displays `Codex · <model>` and toggles between configured models (such as `gpt-6.1-sol` ⇄ `gpt-6.1-terra`)
  - On other providers (`claudeAgent`, `opencode`, `grok`): displays a pill with the configured instance name
- **Settings icon (`Editar Preset Global no Studio`)**: opens the **Preset Studio** directly on the active Global Preset

### `Projetos com Override` section

T3 Code projects without customizations stay hidden from the main list because they inherit **`Preset Global (Default)`** automatically. Only projects with a local override, a detected squad, or an existing `settings.json` divergence appear under **`Projetos com Override (N)`** (Projects with Override).

To add an override to a project that currently follows the Global Default:

1. Click **`+ Configurar Projeto`** (Configure Project) in the section header.
2. Under **`Projeto do T3 Code (seguindo Global Default)`**, select the target repository.
3. Under **`Preset de Override`**, pick the starting preset to base the override on.
4. Click **`Aplicar Override`** (Apply Override), or **`Cancelar`** (Cancel) to abort.

When **2 or more** projects have overrides, the **`Filtrar overrides, preset ou instância…`** (`⌘K`) filter bar appears automatically. It matches project title, path (`workspaceRoot`), local preset `id` or `extends`, detected squad slug, and configured instance name (such as `antigravity`, `antigravity_2`, `Codex`, etc.).

Each card in **`Projetos com Override`** displays status badges and dedicated actions:

- **Project badges and status**:
  - **`Sincronizado`** (green, Synced): `<repo>/.t3code/preset.jsonc` exists and the override is active
  - **`Squad s/ preset`** (amber, Squad without preset): a manual squad exists at `<repo>/.agents/skills/*-squad/` without `<repo>/.t3code/preset.jsonc`
  - **`Override`** (neutral): an override exists in `settings.json` without a local preset file in `.t3code/`
  - **`Seguindo Global Default (override pausado)`** (amber): shown when the project's individual toggle is set to `Desativado`
- **Card actions**:
  - **Individual toggle (`Ativo` / `Desativado`)**: pauses or reactivates the project override without deleting `.t3code/preset.jsonc`. Pausing removes `projectSettingsOverrides[projectId]` from `settings.json`
  - **One-click Swap `⇄`**: toggles between configured instances of the same provider (e.g. `antigravity` ⇄ `antigravity_2`) or between configured models on `codex` (e.g. `gpt-6.1-sol` ⇄ `gpt-6.1-terra`), recompiles the squad, and updates `settings.json`
  - **`Global` button**: removes the override (`.t3code/preset.jsonc` and `projectSettingsOverrides[projectId]`) and returns the project to the **Global Default**
  - **Preset dropdown + `Sync` button**: applies the chosen preset to the project (displays `Sync…` while writing and `Sincronizado!` when complete)
  - **Settings icon (`Editar no Preset Studio`)**: opens the **Preset Studio** directly on the selected project

### Footer and subagent activity note

The **Popover** footer confirms the safety guarantees with the **`SQLite Read-Only · ~/.t3`** badge and the **`Esc para fechar`** (Esc to close) reminder.

> [!NOTE]
> Reading subagent activity from `~/.t3/userdata/statev2.sqlite` (`orchestration_v2_projection_subagents`, exposed via `activeSubagentCount` and `subagents` on `DashboardSnapshot`) is already implemented in the Rust backend. In the current UI version, the **Popover** focuses exclusively on preset management and 1-Click Sync and does not render a live subagent panel.

## 2. Preset Studio (`1120×760px`)

The **Preset Studio** is the full editor for creating global presets, inheriting configurations with `extends`, building the role matrix, attaching skills and MCPs, defining contention policies, and inspecting the **Unified Diff** before writing to disk.

Closing the **Preset Studio** window hides it rather than quitting, keeping the companion resident in the macOS menu bar.

### Left sidebar (`StudioSidebar`)

The left sidebar splits navigation into two groups:

1. **`Presets Globais`** (Global Presets):
   - Lists every preset in `~/.config/oh-my-t3code/presets/*.jsonc` with badges such as **`Default · Ativo`**, **`Default · Pausado`**, **`Desativado`**, **`Instalado por padrão`**, preset family (`OMOS Standard`, `Codex`, `Custom`, etc.), role count (`N roles`), and inheritance (`↳ <parent>`)
   - Click **`+ Novo Preset Global`** (New Global Preset) to open the creation form: enter **`ID do Preset (~/.config/.../presets/*.jsonc)`** (letters, numbers, `-`, or `_`) and choose **`Nenhum (Base)`** (None / Base) under **`Herdar de (extends)`** to start from scratch, or pick an existing preset to clone and extend its settings
2. **`Projetos com Override`** (Projects with Override):
   - Lists only projects that have an override or a detected squad, displaying the **`Ativo`** / **`Desativado`** badge and inheritance reference (`extends: ...`, `preset: ...`, or `override local`)
   - Click **`+ Configurar Projeto`** to convert a project following the Global Default into a local override (or import its squad directly using **`Importar Squad`** when present)
   - **Reverse Importer (`Importar Squad Existente`)**: whenever the backend detects an `.agents/skills/*-squad/` directory in a repository, the card shows **`Importar Squad Existente`** (Import Existing Squad). Clicking it reads the existing `SKILL.md` and `roles/*.md` files and converts the manual squad into `<repo>/.t3code/preset.jsonc`

### Editor header and architecture summary strip

The top bar adapts its badges and actions based on the item selected in the sidebar:

- **Global Mode**:
  - Displays the **`Preset Global`** badge (plus **`Default Global`** and **`Instalado por padrão`** when applicable) and the file path `~/.config/oh-my-t3code/presets/<id>.jsonc`
  - Actions: **`StatusToggle`** (`Ativo` / `Desativado`), **`Definir como Global Default`** (Set as Global Default, shown when the selected preset is not the active global default), and **`Salvar Preset Global`** (Save Global Preset)
- **Project Mode**:
  - Displays the **`Projeto · Override Local`** badge and the file path `<repo>/.t3code/preset.jsonc`
  - Actions: **`StatusToggle`** (`Ativo` / `Desativado`), **`Voltar ao Global (Remover Override)`** (Return to Global / Remove Override), **`Salvar Override`** (Save Override), and **`Revisar Diff & Sincronizar`** (Review Diff & Sync, which jumps straight to the **`Preview & Diff`** tab)
- **`Alterações não salvas` badge**: appears in amber whenever the current draft differs from the file saved on disk
- **Architecture summary strip**: shows **`Orquestrador`** (Orchestrator), **`Topologia`** (`Intra-Thread` or `Issue-Thread`), **`Fallback: N nível(is)`**, and **`Papéis: N`** (Roles) at a glance

### Navigating the 5 editor tabs

The tab bar (**`Seções do Editor`**) supports keyboard navigation with `ArrowLeft` and `ArrowRight` across the 5 panels below.

#### Tab 1: `Visão Geral & Fallback` (Overview & Fallback)

Centralizes preset metadata, inheritance, primary orchestrator routing, and the fallback chain:

- **Identity, Inheritance (`extends`) & Topology**:
  - **`Nome do Preset`**: display name shown in the sidebar and selectors
  - **`Identificador (id)`**: read-only field matching the `.jsonc` filename
  - **`Herda de (extends)`**: choose **`Nenhum (Base)`** or any parent Global Preset to inherit roles, fallback chain, and contention rules
  - **`Topologia da Squad`**: choose between `intra-thread-squad (Workers via delegate_task)` for workers inside the same thread and `issue-thread-orchestrator (Orquestração por threads/issues)` for independent threads per issue or worktree
  - **`Descrição`**: short summary of the preset's purpose
- **Primary Orchestrator (`settings.json` Override)**:
  - Uses the `ModelRoutingFields` component to define `defaultModelSelection` written to T3 Code:
  - **`Instância (providerInstanceId)`**: full dropdown plus one-click chips for the provider instances configured in your T3 Code setup (such as primary and secondary `antigravity` / `antigravity_2`, `Codex`, etc.)
  - **`Modelo (model)`**: dropdown plus fast chips for known models, and a **`Custom`** button that switches to a free-text input (click **`Usar lista`** to switch back to the dropdown)
  - **`Opções do Orquestrador (1-clique)`**: provider-specific quick pills:
    - Antigravity (`antigravity`, `antigravity_2`): `thinking_level` (`low`, `medium`, `high`, `xhigh`)
    - Codex (`codex`): `reasoningEffort` (`low`, `medium`, `high`, `xhigh`) and `serviceTier` (`default`, `priority`)
  - **`Avançado`**: expands the key/value editor (**`Parâmetros personalizados (key / value)`**) to add or adjust extra options; the button label switches to **`Ocultar chave/valor`** when open
- **Visual Fallback Pipeline (`fallbackChain`)**:
  - Connects the origin node (**`Orquestrador Primário`**) to each numbered fallback step (`Nível 1`, `Nível 2`, …)
  - Click **`Adicionar Passo`** (Add Step) to append a new fallback level
  - On each step, use the arrow buttons to move priority up or down, the trash icon to remove it, the **`Instância`**, **`Modelo`**, and **`Opções do Nível`** controls, and **`Motivo / Regra de Acionamento`** to document when the squad should trigger that fallback

#### Tab 2: `Matriz de Papéis` (Role Matrix)

Configures each specialized worker compiled into `<repo>/.agents/skills/<slug>-squad/roles/<id>.md`:

- **Left column (`Papéis (roles/)`)**:
  - Lists all roles alphabetically with model, instance, primary option, and counts for skills, MCPs, and verification checks
  - Click **`+ Adicionar Papel`** (Add Role) to create a custom ID (`[a-z0-9_-]`) or pick one of the **11 pre-configured quick templates**: `explorer`, `oracle`, `designer`, `fixer`, `qa-reviewer`, `backend`, `frontend`, `rust-core`, `crystal`, `meta-sync`, and `delivery-manager`
- **Right column (4 cards for the selected role)**:
  1. **`Identidade (roles/<id>.md)`**: edit **`Título do Papel`** (Role Title), **`Quando Acionar (whenToUse)`** (When to Use), and **`Descrição do Papel`** (Role Description), or click **`Remover Papel`** (Remove Role)
  2. **`Roteamento de Modelo & Instância`**: assign an instance, model, and options (`thinking_level` / `reasoningEffort`) specific to this role without changing the orchestrator
  3. **`Escopo de Arquivos`**: add glob patterns or directories to **`Caminhos Permitidos (allowedPaths)`** (green chips) and **`Caminhos Proibidos (forbiddenPaths)`** (red chips) to prevent parallel edit conflicts
  4. **`Invariantes & Verificação`**: list mandatory rules under **`Invariantes do Papel (invariants)`** and quality-gate commands under **`Comandos de Verificação (verificationCommands)`** (rendered in terminal format `$ ...`, such as `cargo test --manifest-path src-tauri/Cargo.toml` and `bun run typecheck`)

#### Tab 3: `Skills & MCPs`

Optionally attaches local skills and Model Context Protocol (MCP) servers configured in your environment to each role in the squad:

- **Top selector (`Papel:`)**: switch between roles in the preset without leaving the tab
- **`Skills Globais`**:
  - Default directories scanned for local skills: `~/.config/skillshare/skills` and `~/.gemini/config/skills` (optional; if these directories do not exist in your environment, you can still create and manage presets without local skills)
  - Switch between **`Todas`** (All) and **`Apenas Selecionadas`** (Selected Only), search by name or description in **`Buscar skill (ex: tailwind, tdd, security)…`**, and filter by source (**`Todas origens`** or any detected source directory)
  - Check or uncheck the skills you want to attach; enabled items display the **`Ativa`** badge
- **`MCPs Recomendados`**:
  - All MCP servers are optional and configurable based on your environment. Studio provides quick toggles for common optional MCP servers if they are part of your setup:
    - **`ai-memory`** (`Memória & Handoffs`): durable project memory, architecture decisions, and cross-session handoffs
    - **`context7`** (`Docs Atualizadas`): up-to-date library and framework documentation (Tauri, React, Tailwind)
    - **`playwright`** (`E2E & Visual`): browser automation, accessibility snapshots, and visual E2E testing
    - **`linear`** (`Issues & Status`): optional integration for reading and updating issues, projects, cycles, and statuses in Linear
  - Use **`Adicionar MCP customizado`** (button **`Add`**) to attach any other MCP server configured in your environment (tagged with the `custom` badge)

#### Tab 4: `Pontos de Contenção` (Contention Points)

Defines operational safety rules (`contention`) compiled into the squad's `SKILL.md` to prevent collisions across parallel workers:

- **`Banco de Testes Único (singleTestDb)`**: when checked, instructs the squad to serialize test suites (such as RSpec or SQLite) to avoid database locks between parallel workers
- **`Isolamento Padrão (defaultIsolation)`**: choose `shared — Ondas sequenciais no mesmo workspace` (sequential waves in the same workspace) or `worktree — Git worktrees isolados para frentes paralelas` (isolated Git worktrees for parallel tracks)
- **`Variáveis de Ambiente Obrigatórias (envVars)`**: required key/value pairs such as `PARALLEL_WORKERS=1`
- **`Artefatos de Build Fora do Git (gitIgnoredBuilds)`**: untracked build directories such as `target/`, `dist/`, and `tmp/`
- **`Arquivos de Alta Contenção (conflictFiles)`**: shared manifests or lock-prone files (red chips, such as `package.json`, `Cargo.toml`, `tauri.conf.json`, and `db/schema.rb`) that workers must not edit concurrently

#### Tab 5: `Preview & Diff`

Generates and displays the deterministic compilation output before anything is written to disk:

- **`Simular no projeto`** (visible in Global Mode): select any T3 Code project to preview how the Global Preset would compile in that repository
- **`Atualizar Diff` button**: recalculates the deterministic preview (`SKILL.md`, `roles/*.md`, `.t3code/preset.jsonc`, and `settings.json`)
- **`Arquivos Alvo` list**:
  - Shows `settings.json (override)` (`projectSettingsOverrides`), followed by `.t3code/preset.jsonc`, `.agents/skills/<slug>-squad/SKILL.md`, and each `roles/<id>.md`
  - Each entry receives a status badge (**`Novo`** in green, **`Modificado`** in amber, or **`Idêntico`** in neutral), alongside the global **`Alterações pendentes`** or **`Em dia`** badge
- **Right-hand viewer**:
  - Displays the full path of the selected file, the **`Copiar Conteúdo`** button (changes to **`Copiado`** after copying), and the view switcher between **`Unified Diff`** and **`Markdown Compilado`**
- **Saving**:
  - In Global Mode, click **`Salvar Preset Global`** to save `~/.config/oh-my-t3code/presets/<id>.jsonc`
  - To save and sync to the selected project, click **`Salvar & Sincronizar Projeto`**: the backend creates `settings.json.bak`, updates `settings.json` atomically, and writes only modified files to the repository

## 3. Recommended daily workflows

These four workflows cover the most common tasks when operating multiple accounts and repositories in T3 Code.

### Scenario 1: Initial setup with T3 Code

1. Launch `oh-my-t3code` (`bun run tauri:dev` or the installed app) to initialize the default `default` preset in `~/.config/oh-my-t3code/presets/`.
2. Click the menu bar icon to open the **Popover**.
3. Under **`Preset Global (Default)`**, keep `default` or select a custom global preset you created in Preset Studio (`+ Novo Preset Global`) with your preferred providers and models, and verify the toggle is set to **`Ativo`**.
4. From that point on, every project without a local override follows this global default in `~/.t3/userdata/settings.json`.

### Scenario 2: Project with an existing manual squad (`.agents/skills/*-squad/`)

1. Open **Preset Studio** (`⌘,`).
2. In the left sidebar, locate the project marked with a detected squad (or click **`+ Configurar Projeto`** if it is not yet in the override list) and click **`Importar Squad Existente`**.
3. The **Reverse Importer** extracts roles, models, skills, MCPs, file scopes, and verification commands into `<repo>/.t3code/preset.jsonc`.
4. Refine roles, `extends`, or contention rules across the Studio tabs.
5. Open the **`Preview & Diff`** tab, inspect the **Unified Diff** for `SKILL.md`, `roles/*.md`, and `settings.json`, and click **`Salvar & Sincronizar Projeto`**.

### Scenario 3: Hitting a rate limit or quota mid-session

1. Left-click the menu bar icon to open the **Popover**.
2. If the session belongs to a project with its own override, click the **`⇄`** pill directly on that project's card to switch between configured instances of the same provider (such as `antigravity` ⇄ `antigravity_2`) or between configured models (such as `Codex · gpt-6.1-sol` ⇄ `gpt-6.1-terra`).
3. If the project follows the global default, click the **`⇄`** pill inside the **`Preset Global (Default)`** card.
4. Within seconds, the backend backs up `settings.json` to `.bak`, updates it atomically, and routes the project's squad to the alternate instance or model.

### Scenario 4: Testing preset changes safely in Browser Preview

1. From the project root, run `bun run dev` to start the frontend on port `1420` with `MockIpcStore` enabled (no real files under `~/.t3` or `~/.config/oh-my-t3code` are touched).
2. Open `http://localhost:1420` in your browser, or jump straight to `http://localhost:1420/?view=studio` and `http://localhost:1420/?view=popover`.
3. Experiment with new presets using `extends`, configure `fallbackChain`, test filters, and inspect the generated **Unified Diff** using the in-memory sample projects.
4. Once satisfied with the configuration, apply it in the native app (`bun run tauri:dev`).
