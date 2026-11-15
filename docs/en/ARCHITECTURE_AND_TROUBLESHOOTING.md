# Architecture, security, IPC, and troubleshooting (`oh-my-t3code`)

🌐 **English** | [Português (Brasil)](../ARQUITETURA_E_TROUBLESHOOTING.md) · [Back to README](../../README.md)

This document details the internal architecture of `oh-my-t3code` (Tauri v2 Rust backend, React 19 + TypeScript frontend, and T3 Code integration), explains its security and data-integrity guarantees, lists all 15 Inter-Process Communication (IPC) commands, and provides step-by-step troubleshooting procedures.

## System architecture

`oh-my-t3code` runs as an external companion application to T3 Code: it reads runtime state strictly in read-only mode, manages declarative presets, and writes compiled squad artifacts into each project repository and `settings.json`.

### Rust backend modules (`src-tauri/src/`)

Each module under `src-tauri/src/` enforces a clear boundary between T3 Code state discovery, configuration resolution, compilation, and disk synchronization:

- **[`main.rs`](../../src-tauri/src/main.rs)**: native binary entry point; delegates initialization immediately to `oh_my_t3code_lib::run()`
- **[`lib.rs`](../../src-tauri/src/lib.rs)**: initializes `tauri::Builder`, sets `ActivationPolicy::Accessory` on macOS, builds `TrayIconBuilder` (`main-tray`) with its context menu (`Alternar Popover` / Toggle Popover, `Abrir Preset Studio` / Open Preset Studio, `Sair` / Quit), manages positioning and visibility for the `popover` and `studio` windows, and registers the 15 `#[tauri::command]` handlers
- **[`models.rs`](../../src-tauri/src/models.rs)**: defines `AppError`, `AppPaths::from_env`, all domain and IPC structs (`GlobalAppConfig`, `PresetConfig`, `RoleConfig`, `ContentionPolicy`, `SessionPolicy`, `WorkerThinkingRule`, `ParentThreadHealth`, `ProjectSessionHealth`, `GlobalSessionHealth`, `DashboardSnapshot`, `ResolvedProjectPreset`, `CompilePreviewResult`, `SyncResult`) using `#[serde(rename_all = "camelCase")]`, plus `default_max_antigravity_for_profile`, `effective_parent_thinking_level`, and `effective_orchestrator_options`
- **[`preset_engine.rs`](../../src-tauri/src/preset_engine.rs)**: implements the JSON with Comments (JSONC) parser (`strip_jsonc_comments`), ID validation (`validate_safe_id`, `validate_worker_thinking_keys`), recursive inheritance (`extends`, depth limit of 16, and cycle detection), the built-in `default` preset and user-defined custom presets with self-healing, atomic file writes (`atomic_write_file`), and the outer lock `lock_config_state()`
- **[`compiler.rs`](../../src-tauri/src/compiler.rs)**: deterministically compiles `.t3code/preset.jsonc`, `.agents/skills/<slug>-squad/SKILL.md` (including deterministic Section 5 `## 5. Gestão de sessão e concorrência (oh-my-t3code)`), and `roles/*.md` with `ensure_within_workspace` checks and clamping via `effective_orchestrator_options` / `effective_parent_thinking_level`, generates unified diff previews (`compile_preset_preview`), and coordinates high-level flows (`apply_preset_to_project`, `swap_project_primary_instance`, `set_global_preset_config`, `swap_global_instance`, `set_project_preset_enabled`, `remove_project_override`)
- **[`settings_sync.rs`](../../src-tauri/src/settings_sync.rs)**: builds diff previews, writes mandatory `.bak` backups to `settings.json.bak`, and performs atomic updates on `~/.t3/userdata/settings.json` (`sync_project_settings`, `sync_global_settings`, `remove_project_settings_override`), applying `effective_orchestrator_options` (for the `laptop-8gb` clamp) and serializing under the leaf lock `lock_settings_file()`
- **[`t3_reader.rs`](../../src-tauri/src/t3_reader.rs)**: reads `settings.json` (provider instances, global selections, and project overrides), opens `statev2.sqlite` strictly read-only to extract `projection_projects`, `projection_threads`, `orchestration_v2_projection_threads`, `orchestration_v2_projection_subagents`, `orchestration_v2_projection_runs`, and `orchestration_v2_projection_turn_items`, computes `ProjectSessionHealth` and `GlobalSessionHealth` (`compute_global_session_health`), scans skill roots (`skillshare` and `gemini`), and assembles `DashboardSnapshot`
- **[`importer.rs`](../../src-tauri/src/importer.rs)**: implements the Reverse Importer (`import_existing_squad`), converting existing manual `.agents/skills/*-squad/{SKILL.md, roles/*.md}` directories into structured `.t3code/preset.jsonc` files

### React 19 + TypeScript frontend (`src/`)

The frontend runs inside two Tauri webviews or inside a standard browser via a mock IPC fallback for development and testing:

- **[`App.tsx`](../../src/App.tsx)**: reads `?view=popover` or `?view=studio` from the URL. Outside the Tauri runtime (when `window.__TAURI_INTERNALS__` is absent and `?view` is unset), it renders a `Browser Preview (Mock IPC ativo)` top bar to switch between `Popover (380×500)` and `Preset Studio (1120×760)`
- **[`views/PopoverView.tsx`](../../src/views/PopoverView.tsx)**: compact Menu Bar interface for switching the Global Preset, monitoring the `Saúde global da sessão e RAM` strip and per-project health badges (`OK`, `Pai gordo`, `ACP morto`, `Muitos workers`, `Alerta de RAM (8 GB)`), copying the handoff prompt via `Abrir thread pai novo`, inspecting the collapsible `Monitor de Subagentes`, filtering projects with `⌘K`, swapping project presets in one click, running **Swap** (`⇄`), pausing/enabling overrides, reverting to Global Default, and opening the Studio
- **[`views/StudioView.tsx`](../../src/views/StudioView.tsx)**: full five-tab editor with an architectural summary header, status/error bar, and actions to save, set as global default, pause, remove override, and sync
- **`src/components/studio/`**:
  - [`StudioSidebar.tsx`](../../src/components/studio/StudioSidebar.tsx): navigation across global presets and overridden projects, preset creation, **Configure Project** (`Configurar Projeto`) flow, and **Import Existing Squad** (`Importar Squad Existente`) action
  - [`OverviewFallbackTab.tsx`](../../src/components/studio/OverviewFallbackTab.tsx): metadata, `extends`, `topology`, orchestrator, and ordered `fallbackChain` editor
  - [`RolesMatrixTab.tsx`](../../src/components/studio/RolesMatrixTab.tsx): role matrix, instance, model, options (`thinking_level`, `reasoningEffort`, `serviceTier`), `allowedPaths`, `forbiddenPaths`, invariants, and verification commands
  - [`SkillsMcpsTab.tsx`](../../src/components/studio/SkillsMcpsTab.tsx): picker for discovered global skills and Model Context Protocol (MCP) servers (`ai-memory`, `context7`, `playwright`, `linear`)
  - [`ContentionTab.tsx`](../../src/components/studio/ContentionTab.tsx): pairs [`SessionPolicySection.tsx`](../../src/components/studio/SessionPolicySection.tsx) above the `ContentionPolicy` editor (`defaultIsolation`, `singleTestDb`, `envVars`, `gitIgnoredBuilds`, `conflictFiles`)
  - [`SessionPolicySection.tsx`](../../src/components/studio/SessionPolicySection.tsx): `SessionPolicy` editor covering `hardwareProfile`, `parentThinkingLevel` (including the automatic `laptop-8gb` downgrade note), the **Aplicar limites sugeridos** button, concurrency/turn/item/token thresholds, `delegateMode`, `onAcpSessionDead`, `workerThinkingByKind` table, and `forbiddenPatterns`
  - [`PreviewDiffTab.tsx`](../../src/components/studio/PreviewDiffTab.tsx): unified diff and full-content inspector for generated files and `settings.json` before writing to disk
- **[`lib/ipc-client.ts`](../../src/lib/ipc-client.ts)**: typed `invokeIpc` and `listenStudioNavigate` wrapper routing calls to `@tauri-apps/api` in Tauri or to `MockIpcStore` in a browser or Vitest
- **[`lib/mock-data.ts`](../../src/lib/mock-data.ts)**: in-memory `MockIpcStore` supporting standalone browser previews and the Vitest suite
- **[`lib/preset-utils.ts`](../../src/lib/preset-utils.ts)**: curated catalogs of models and options per provider, role templates (`COMMON_ROLE_TEMPLATES`), visual tags, ID sanitization/validation (`sanitizeSafeId`, `isValidSafeId`), session policy helpers (`createDefaultSessionPolicy`, `defaultMaxAntigravityForProfile`, `effectiveParentThinkingLevel`, `effectiveOrchestratorOptions`), and health/handoff helpers (`getSessionHealthMeta`, `formatProjectSessionSummary`, `buildSessionHandoffPrompt`)
- **[`types/ipc.ts`](../../src/types/ipc.ts)**: TypeScript definitions matching [`models.rs`](../../src-tauri/src/models.rs) (including `HardwareProfile`, `WorkerThinkingRule`, `SessionPolicy`, `ParentThreadHealth`, `ProjectSessionHealth`, and `GlobalSessionHealth`) and the 15 commands in [`lib.rs`](../../src-tauri/src/lib.rs) 1:1

### Tauri windows, macOS Menu Bar, and `studio://navigate` event

The [`src-tauri/tauri.conf.json`](../../src-tauri/tauri.conf.json) manifest registers two hidden windows on startup (`visible: false`):

| Window (`label`) | Dimensions | Properties | Initial URL |
| :--- | :--- | :--- | :--- |
| `popover` | `380 × 500` px | `resizable: false`, `decorations: false`, `alwaysOnTop: true`, `skipTaskbar: true` | `index.html?view=popover` |
| `studio` | `1120 × 760` px (min. `900 × 620`) | `resizable: true`, `decorations: true` | `index.html?view=studio` |

On macOS, [`lib.rs`](../../src-tauri/src/lib.rs) enables `ActivationPolicy::Accessory` so the app lives exclusively in the top Menu Bar without taking permanent space in the Dock. Left-clicking the tray icon calls `position_popover_under_tray`, which centers `popover` `6` px below the icon (clamped to the active monitor bounds) and shows it; losing focus (`WindowEvent::Focused(false)`) hides the popover. Closing `studio` intercepts `WindowEvent::CloseRequested` and hides the window (`hide()`) for instant reopening.

When you trigger `open_studio_window(projectId, presetId)`, the backend hides `popover`, shows and focuses `studio`, and emits `studio://navigate` with `{ projectId, presetId }`. The frontend consumes this event via `listenStudioNavigate` to select the target global preset or project directly.

## Security and integrity guarantees

The invariants below protect T3 Code user data and repository workspaces against corruption, configuration loss, or out-of-bounds writes.

### Strictly read-only SQLite access

The `open_sqlite_readonly` function in [`t3_reader.rs`](../../src-tauri/src/t3_reader.rs) opens `~/.t3/userdata/statev2.sqlite` using strict safeguards:

- `OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX` (never creates a database file or opens it for writing)
- `conn.busy_timeout(Duration::from_millis(250))` to wait briefly without locking when T3 Code is writing
- `PRAGMA query_only = true` as an additional SQLite engine guard
- Automatic retry for up to **4 attempts** (up to 3 retries with a `50 ms` sleep) when SQLite returns `rusqlite::ErrorCode::DatabaseBusy` or `DatabaseLocked`

To tolerate schema differences across T3 Code versions with **graceful degradation**, `read_sqlite_state_with_context_unlocked` inspects `table_columns(&conn, table)` (`PRAGMA table_info(...)`) before building each query: if an optional table does not exist yet or lacks expected columns, `table_columns` returns an empty `HashSet` and that step is skipped without failing `get_dashboard_snapshot`. Queries read:

- `projection_projects`: active projects (filtering `deleted_at IS NULL` when present)
- `projection_threads` and `orchestration_v2_projection_threads`: `thread_id → project_id` mapping, title, `archived_at`, and `deleted_at` (preferring v2 over legacy, with fallbacks via `payload_json`, `default_model`, or `default_model_selection_json`)
- `orchestration_v2_projection_subagents`: active/recent subagent activity (`parent_thread_id` or `thread_id`, `child_thread_id`, status, model, and `payload_json`)
- `orchestration_v2_projection_runs`: per-thread turn counts (`run_counts_by_thread`), latest run selection via `parse_iso8601_to_epoch_ms` + sequence (`seq`), dead ACP session detection (`run_indicates_acp_dead` when status indicates failure and `error_message` contains `AcpRequestError` or duration is between `0` and `1000 ms`), and deduplication of active workers not represented in `subagents`
- `orchestration_v2_projection_turn_items`: `COUNT(*) ... GROUP BY thread_id` aggregation (`item_counts_by_thread`, filtering `deleted_at IS NULL` when present) to flag bloated parent threads (`fat_parent`)

Finally, `compute_global_session_health` computes `ProjectSessionHealth` and `GlobalSessionHealth` using severity precedence `acp_dead` > `over_concurrency` > `fat_parent` > `ok`, triggering `ramWarning` when `hardwareProfile == "laptop-8gb"` and `activeAntigravityWorkers > 2`.

### Backup, atomic writes, and Read-Modify-Write (RMW) serialization

Every critical write passes through `atomic_write_file` in [`preset_engine.rs`](../../src-tauri/src/preset_engine.rs):

1. Allocates an exclusive temporary file in the **same directory** as the target using `.{file_name}.tmp.{pid}.{seq}` (with an incrementing `AtomicU64` and `OpenOptions::create_new(true)`), preventing intra-process thread collisions.
2. Writes the full payload, calls `file.sync_all()` (`fsync`), and closes the file descriptor.
3. Performs an atomic `fs::rename` over the destination file (cleaning up `.tmp.*` on failure).

Before modifying `~/.t3/userdata/settings.json`, the backend writes an exact byte copy of the original file to `~/.t3/userdata/settings.json.bak` via `atomic_write_file`, preserves all unrelated keys (`favorites`, `providerInstances`, and unknown fields), and serializes concurrent operations using a strict lock hierarchy: `preset_engine::lock_config_state()` (outer) → `settings_sync::lock_settings_file()` (inner/leaf).

> [!NOTE]
> Disk concurrency hardening (`SM-3`: `lock_config_state`, `lock_settings_file`, and `.tmp.<pid>.<seq>`), global preset sync/cleanup (`SM-1`: `save_global_preset_and_sync`, clearing `defaultModelSelection`/`fallbackModelSelection` on pause, and guarding `swap_global_instance`), and project override stabilization (`SM-2`: paused swap guard, orphaned `roles/*.md` pruning, compiler squad cleanup on `remove_project_override` preserving manual squads, and `disabledRoles` tombstone) are already implemented. Remaining UI/Mock architecture notes (`SM-4`, `SM-5`, and `SM-6`, covering UI race conditions, `dirty` state guard, `MockIpcStore` parity, and the macOS Tray/Blur race) are documented in [`STATE_MACHINES.md`](../STATE_MACHINES.md).

### Path traversal protection and deterministic compilation

- Every preset ID, `extends` target, and role ID (as well as every `workerThinkingByKind` key validated by `validate_worker_thinking_keys`) passes `validate_safe_id` (`[a-zA-Z0-9_-]`, `1` to `64` characters, rejecting `..`, `/`, and `\`)
- Every workspace file written by the compiler passes `ensure_within_workspace(workspace_root, target)`, rejecting any `Component::ParentDir` or path outside `workspace_root` with `AppError::PathTraversal`
- The `roles`, `options`, `envVars`, and `workerThinkingByKind` maps use `BTreeMap` with zero random timestamps or UUIDs, ensuring identical outputs across repeated compiles and cache-safe LLM prompts

### Automatic `laptop-8gb` clamp and deterministic Section 5 in `SKILL.md`

- **Automatic downgrade on `laptop-8gb`**: `effective_parent_thinking_level` in [`models.rs`](../../src-tauri/src/models.rs) (mirrored by `effectiveParentThinkingLevel` in [`preset-utils.ts`](../../src/lib/preset-utils.ts)) clamps `parentThinkingLevel` from `"high"` or `"xhigh"` down to `"medium"` whenever `hardwareProfile == "laptop-8gb"`.
- **Single normalization path for `settings.json` and `SKILL.md`**: `effective_orchestrator_options` (mirrored by `effectiveOrchestratorOptions`) normalizes `thinkingLevel` to `thinking_level`, applies `effective_parent_thinking_level` for `antigravity*` / `gemini-4-*` orchestrators (or whenever `thinking_level` is set), and caps `reasoningEffort` to the same ceiling. Because [`settings_sync.rs`](../../src-tauri/src/settings_sync.rs) (`build_project_override_value` and `sync_global_settings`) and [`compiler.rs`](../../src-tauri/src/compiler.rs) (`render_squad_skill_md`) both use this helper, `high`/`xhigh` are never emitted for the parent thread under `laptop-8gb`.
- **Deterministic Section 5 (`render_squad_skill_md`)**: every compiled `SKILL.md` emits `## 5. Gestão de sessão e concorrência (oh-my-t3code)` with the hardware profile, Antigravity and total worker limits, turn/item/token thresholds, effective vs. configured thinking, `delegateMode`, `onAcpSessionDead`, sorted `workerThinkingByKind` table, `forbiddenPatterns` list, and 8 mandatory operational rules (including Rule 5, which enforces sequential waves with `isolation: "shared"` whenever `defaultIsolation == "worktree"` and a concurrency limit is `<= 1`).

## Reference of the 15 IPC commands

All 15 commands below are registered in [`src-tauri/src/lib.rs`](../../src-tauri/src/lib.rs) and typed in [`src/types/ipc.ts`](../../src/types/ipc.ts) (arguments and return payloads use `camelCase`).

| Command | Parameters | Return type | Behavior |
| :--- | :--- | :--- | :--- |
| `get_dashboard_snapshot` | — | `DashboardSnapshot` | Reads `config.jsonc`, global presets, `settings.json`, `statev2.sqlite` (read-only), and skill roots to build the full dashboard state, including global and per-project `sessionHealth` |
| `list_global_presets` | — | `PresetConfig[]` | Ensures the built-in `default` preset exists, resolves inheritance for all presets in `~/.config/oh-my-t3code/presets/`, and returns `default` followed by custom user presets |
| `get_project_preset` | `projectId`, `workspaceRoot` | `ResolvedProjectPreset` | Resolves `.t3code/preset.jsonc` (or global fallback / instance hint) and detects `.agents/skills/*-squad/` in the repository |
| `save_global_preset` | `preset: PresetConfig` | `PresetConfig` | Delegates to `save_global_preset_and_sync`: validates IDs and simple cycles, atomically writes `<presets_dir>/<id>.jsonc`, syncs `settings.json` automatically if it matches `activeGlobalPresetId` while `globalConfig.enabled == true`, and returns the resolved preset |
| `save_project_preset` | `projectId`, `workspaceRoot`, `preset: PresetConfig` | `ResolvedProjectPreset` | Validates IDs and workspace existence, resolves `extends`, and atomically writes `<workspace>/.t3code/preset.jsonc` |
| `preview_preset_sync` | `projectId`, `workspaceRoot`, `preset: PresetConfig` | `CompilePreviewResult` | Simulates compilation of `preset.jsonc`, `SKILL.md`, `roles/*.md`, and `projectSettingsOverrides`, returning unified diffs without writing to disk |
| `apply_preset_sync` | `projectId`, `workspaceRoot`, `presetIdOrCustom?`, `customPreset?` | `SyncResult` | Atomically writes only changed files in the workspace, prunes orphaned `roles/*.md` files no longer in `resolved.roles`, and updates `projectSettingsOverrides[projectId]` in `settings.json` after creating a `.bak` backup (or removes the override from `settings.json` when `enabled == false`) |
| `swap_project_instance` | `projectId`, `workspaceRoot` | `SyncResult` | Requires an active override (`enabled == true`, returning `InvalidInput` when paused); swaps `antigravity` ⇄ `antigravity_2` (or `gpt-6.1-sol` ⇄ `gpt-6.1-terra` on `codex`) and reapplies the project preset |
| `import_project_squad` | `projectId`, `workspaceRoot` | `ResolvedProjectPreset` | Imports existing `.agents/skills/*-squad/{SKILL.md, roles/*.md}` and writes `.t3code/preset.jsonc` extending the built-in `default` preset or a compatible custom preset |
| `set_global_preset_config` | `activePresetId`, `enabled` | `DashboardSnapshot` | Updates `~/.config/oh-my-t3code/config.jsonc`; when `enabled == true`, syncs `defaultModelSelection` and `fallbackModelSelection` in `settings.json`; when `enabled == false`, removes those keys via `remove_global_settings_override` while preserving all other settings |
| `swap_global_instance` | — | `DashboardSnapshot` | Requires `globalConfig.enabled == true` (returns `InvalidInput` when paused); swaps the orchestrator instance/model on the active global preset, adjusts `fallbackChain[0]` on collision, and syncs `settings.json` |
| `set_project_preset_enabled` | `projectId`, `workspaceRoot`, `enabled` | `SyncResult` | If `enabled == true`, recompiles and syncs the override; if `false`, writes `enabled: false` to `.t3code/preset.jsonc` and removes `projectSettingsOverrides[projectId]` |
| `remove_project_override` | `projectId`, `workspaceRoot` | `DashboardSnapshot` | Deletes `.t3code/preset.jsonc` (and `.t3code/` if empty), removes `.agents/skills/<slug>-squad/` when compiler-generated (preserving manual squads without the compiler signature and sibling skills), and removes `projectSettingsOverrides[projectId]` from `settings.json` |
| `open_studio_window` | `projectId?`, `presetId?` | `void` | Hides `popover`, shows and focuses `studio`, and emits `studio://navigate` with the selected target |
| `toggle_popover_window` | — | `void` | Toggles visibility of the `popover` window |

### Session and health contracts (`models.rs` ↔ `src/types/ipc.ts`)

Beyond the core preset and project types, [`models.rs`](../../src-tauri/src/models.rs) and [`src/types/ipc.ts`](../../src/types/ipc.ts) maintain 1:1 (`camelCase`) parity for session governance and health telemetry:

- **`HardwareProfile` and `SessionPolicy`** (`PresetConfig.sessionPolicy`): defines `hardwareProfile` (`"laptop-8gb"`, `"desktop-16gb"`, `"desktop-32gb-plus"`), `maxConcurrentAntigravityWorkers` (defaults `2` / `3` / `4` via `default_max_antigravity_for_profile`), `maxConcurrentWorkersTotal` (default `3`), `parentMaxTurnsBeforeHandoff` (`15`), `parentMaxItemsBeforeHandoff` (`120`), `parentWarnInputTokens` (`200_000`), `parentHardInputTokens` (`700_000`), `parentThinkingLevel` (`"medium"`), `workerThinkingByKind` (`Record<string, WorkerThinkingRule>` with `{ model, thinkingLevel }`), `delegateMode` (`"async-default"`), `onAcpSessionDead` (`"advise-new-thread"`), and `forbiddenPatterns`.
- **`ParentThreadHealth`**: summarizes each flagged parent thread in `fatParentThreads` or `deadAcpThreads` with `threadId`, `projectId`, `title`, `runCount`, `itemCount`, `status` (`"fat_parent"` or `"acp_dead"`), `lastError`, and `updatedAt`.
- **`ProjectSessionHealth`** (`ProjectSummary.sessionHealth`): aggregates per-project `status` (`"ok"`, `"fat_parent"`, `"acp_dead"`, `"over_concurrency"`), `activeAntigravityWorkers` / `activeWorkersTotal` counts, `maxConcurrentAntigravityWorkers` / `maxConcurrentWorkersTotal` ceilings, `ramWarning`, `fatParentThreads` / `deadAcpThreads` lists, and `advisory`.
- **`GlobalSessionHealth`** (`DashboardSnapshot.sessionHealth`): globally aggregates active workers (including active subagents without a mapped `projectId`), the active global preset's ceilings, `ramWarning`, `affectedProjects`, and `advisory`.

## Troubleshooting and FAQ

Follow these steps to diagnose and fix common issues during daily use or local development.

### 1. The app opens with no projects (`sqliteAvailable: false` or empty list)

The backend looks for the T3 Code database at `$T3CODE_HOME/userdata/statev2.sqlite` (default `~/.t3/userdata/statev2.sqlite`).

1. Verify the file exists from a terminal:

```bash
ls -la "${T3CODE_HOME:-$HOME/.t3}/userdata/statev2.sqlite"
```

2. If T3 Code stores data in a custom location, export `T3CODE_HOME` before launching `oh-my-t3code` (or open T3 Code at least once so it initializes `statev2.sqlite` and `settings.json`).
3. Refresh the snapshot using the refresh icon button at the top of the Popover (`Atualizar dados do T3 Code`).

### 2. The app does not appear in the macOS Dock

This is intentional: [`lib.rs`](../../src-tauri/src/lib.rs) sets `ActivationPolicy::Accessory` on macOS and `skipTaskbar: true` on the popover.

1. Look for the `Oh My T3Code` icon in the top **macOS Menu Bar**.
2. Left-click to open the Popover, or right-click to open the context menu (`Alternar Popover`, `Abrir Preset Studio`, `Sair`).

### 3. `InvalidInput` or `PathTraversal` error when creating a preset or role

`validate_safe_id` allows only `[a-zA-Z0-9_-]` between `1` and `64` characters and rejects `..`, `/`, and `\`.

1. Rename the ID without spaces, accents, dots, or slashes (for example, replace `my.preset/v1` with `my-preset-v1`).
2. When editing JSONC manually, ensure both the key inside `"roles"` and the nested `"id"` field obey the same rule.

### 4. `CycleDetected` or depth >= 16 error in `extends`

The inheritance resolver aborts chains containing cycles (`A -> B -> A`), self-inheritance (`A -> A`), or more than `16` levels.

1. Inspect `"extends"` in `<workspace>/.t3code/preset.jsonc` and in `~/.config/oh-my-t3code/presets/*.jsonc`:

```bash
grep -n '"extends"' ~/.config/oh-my-t3code/presets/*.jsonc .t3code/preset.jsonc 2>/dev/null
```

2. Break the cycle by pointing the child preset to an acyclic base preset (such as the built-in `default` preset or an acyclic custom user preset), or set `"extends": null`.

### 5. Invalid JSONC syntax error in `preset.jsonc` or `config.jsonc`

A syntax error (unclosed quotes, extra brace, or misplaced comma) blocks preset parsing:

- If `~/.config/oh-my-t3code/config.jsonc` is corrupted, `load_global_config` falls back to `default` with `enabled: true`
- If `<workspace>/.t3code/preset.jsonc` is invalid, the app surfaces a parse warning when opening the project or syncing in the Studio

To recover:

1. Open the affected file in your editor and confirm every `/* ... */` block comment and string quote is properly closed.
2. Save the file and click **Refresh** (`Atualizar`) in the Popover, or reopen the project in the Preset Studio.

### 6. Port `1420` conflict when running `bun run dev` or `bun run tauri:dev`

[`vite.config.ts`](../../vite.config.ts) locks `port: 1420` and `strictPort: true`, matching `devUrl` in [`tauri.conf.json`](../../src-tauri/tauri.conf.json).

1. Check which process holds port `1420`:

```bash
lsof -i :1420
```

2. Terminate the stale process by PID:

```bash
kill <PID>
```

3. Run `bun run dev` or `bun run tauri:dev` again.

### 7. Native build failure (`bun run tauri:build` or `cargo`)

Native builds require a working Rust toolchain, Xcode Command Line Tools on macOS, and an up-to-date Bun installation.

1. Check the installed tool versions:

```bash
rustc --version && cargo --version && bun --version
```

2. If `cargo` fails due to a missing macOS SDK or linker, install Xcode Command Line Tools:

```bash
xcode-select --install
```

3. If the Rust toolchain is missing or outdated, run `rustup update` and verify with `cargo check --manifest-path src-tauri/Cargo.toml` before executing `bun run tauri:build`.

### 8. Project displays `Squad s/ preset` and needs `oh-my-t3code` management

When a repository already contains a manual `.agents/skills/*-squad/SKILL.md` without `.t3code/preset.jsonc`, the Popover renders the **Squad s/ preset** (Squad without preset) badge.

1. Open the **Preset Studio** (sliders icon in the Popover or Menu Bar context menu).
2. In the Studio sidebar, locate the repository under **Projects with Override** (`Projetos com Override`), or inside **Configure Project** (`Configurar Projeto`) if it is not listed yet, and click **Import Existing Squad** (`Importar Squad Existente` / `Importar Squad`).
3. Review the imported roles, options, and contention settings mapped into `.t3code/preset.jsonc`, then click **Review Diff & Sync** (`Revisar Diff & Sincronizar`) to place the squad under compiler management.

### 9. Model or Antigravity account quota ran out mid-session

You can switch the primary instance or model without editing files by hand:

- **One-click instance/model swap**: click the Swap pill (`⇄`) on the project card or inside **Preset Global (Default)** in the Popover. On Antigravity instances, it toggles between the primary and secondary instances (`antigravity` ⇄ `antigravity_2`); on `codex` instances, it toggles between the configured provider models (for example, `gpt-6.1-sol` ⇄ `gpt-6.1-terra`).
- **Permanent fallback adjustment**: open the preset in **Preset Studio**, switch to **Overview & Fallback** (`Visão Geral & Fallback`, `OverviewFallbackTab`), and reorder or add steps to `fallbackChain` (such as a cross-provider step from `antigravity` to `codex`).

### 10. Known behaviors under stabilization

The backend state machines (`SM-1`, `SM-2`, and `SM-3`) are already implemented (covering locks and atomic writes, `settings.json` cleanup when paused, paused project swap guard, orphaned `roles/*.md` pruning, compiler squad cleanup on `remove_project_override` while preserving manual squads, and `disabledRoles` inheritance tombstone). Remaining UI/Mock stabilization notes are documented in [`STATE_MACHINES.md`](../STATE_MACHINES.md):

- **Popover async actions and timers (`SM-4`: `SM4-BUG-1`, `SM4-BUG-2`)**: concurrent global `config`/`swap` actions, out-of-order `loadSnapshot` responses, stale `selectedPresets` after external edits, and untracked `"Sincronizado!"` retry timers.
- **Studio selection, `studio://navigate`, partial saves, and draft guard (`SM-5`: `SM5-BUG-1`..`SM5-BUG-4`)**: out-of-order `selectProject`/`runPreview` races, dropped or stale `studio://navigate` events on cold-start/reopen, state drift when step 2 of a two-step save fails, and unsaved `dirty` draft loss on sidebar navigation.
- **`MockIpcStore` parity and macOS Tray/Blur race (`SM-6`: `SM6-BUG-1`, `SM6-BUG-2`)**: remaining behavioral discrepancies in the browser mock store outside Tauri and the `Focused(false)` vs `TrayIconEvent::Click` race when toggling the Menu Bar popover.

### 11. Parent thread with `AcpRequestError` (`ACP morto`) or bloated context (`Pai gordo`)

When the Popover displays the **`ACP morto`** (`status: "acp_dead"`, triggered by `AcpRequestError` or a failure within `<= 1000 ms` on the latest run in `orchestration_v2_projection_runs`) or **`Pai gordo`** (`status: "fat_parent"`, triggered upon reaching `parentMaxTurnsBeforeHandoff` runs or `parentMaxItemsBeforeHandoff` items in `orchestration_v2_projection_turn_items`) badge, continuing in the same thread perpetuates ACP session failures or degrades the context window.

1. On the project card inside the Popover, click **Abrir thread pai novo** (the button switches to **Handoff copiado!** as `buildSessionHandoffPrompt` in [`preset-utils.ts`](../../src/lib/preset-utils.ts) copies the structured recovery prompt to the clipboard).
2. Open a fresh parent thread in T3 Code and paste the copied prompt; it instructs the new orchestrator to read `AGENTS.md`, `README.md`, `.agents/skills/<slug>-squad/SKILL.md`, restore consolidated context via `ai-memory` (`memory_briefing`, `memory_handoff_accept`, `memory_query`), and verify `git status --short`.
3. To adjust thresholds (`parentMaxTurnsBeforeHandoff`, `parentMaxItemsBeforeHandoff`, `onAcpSessionDead`), edit `sessionPolicy` under **Contention & Session** (`ContentionTab` → [`SessionPolicySection.tsx`](../../src/components/studio/SessionPolicySection.tsx)). `oh-my-t3code` **never** writes, closes, or modifies threads directly inside `statev2.sqlite` — all detection stays strictly read-only.

### 12. RAM saturation, `Muitos workers` badge, or `Alerta de RAM (8 GB)` on a `laptop-8gb` machine

On 8 GB RAM machines (`hardwareProfile: "laptop-8gb"`), running more than `2` simultaneous Antigravity (ACP) workers (`activeAntigravityWorkers > 2`) or exceeding `maxConcurrentAntigravityWorkers` / `maxConcurrentWorkersTotal` triggers **`Muitos workers`** (`over_concurrency`) and the **`Alerta de RAM (8 GB)`** banner inside the Popover's `Saúde global da sessão e RAM` strip.

1. Wait for the current wave to settle or cancel excess workers in T3 Code before spawning new delegations; track live worker counts in the Popover's **Monitor de Subagentes**.
2. In **Preset Studio**, open the active preset (or project override), go to **Contention & Session** (`ContentionTab` → [`SessionPolicySection.tsx`](../../src/components/studio/SessionPolicySection.tsx)), select `laptop-8gb`, and click **Aplicar limites sugeridos (2 Agy)** (sets `maxConcurrentAntigravityWorkers: 2`, `maxConcurrentWorkersTotal: 3`, and `parentThinkingLevel: "medium"`).
3. Verify in **Preview & Diff** that `settings.json` and Section 5 of `SKILL.md` reflect the limits and the automatic `high`/`xhigh` → `medium` clamp, then click **Sync** (`Sincronizar`) to persist changes.

## Quick contributor guide

Follow these contention boundaries, language conventions, and verification checks before finishing any change.

### High-contention files (conflict magnets)

Edits to the files below require sequential coordination (`isolation: "shared"` across `rust-core` → `frontend-ui` → `qa-reviewer` waves):

- [`src-tauri/Cargo.toml`](../../src-tauri/Cargo.toml)
- [`src-tauri/tauri.conf.json`](../../src-tauri/tauri.conf.json)
- [`package.json`](../../package.json)
- Shared IPC contract: [`src-tauri/src/models.rs`](../../src-tauri/src/models.rs) + [`src-tauri/src/lib.rs`](../../src-tauri/src/lib.rs) ↔ [`src/types/ipc.ts`](../../src/types/ipc.ts) + [`src/lib/ipc-client.ts`](../../src/lib/ipc-client.ts) + [`src/lib/mock-data.ts`](../../src/lib/mock-data.ts)

### Language conventions

- **Code and technical artifacts**: keep identifiers, types, functions, Tauri commands, tests, code comments, and commit messages in **English**
- **UI and operational docs**: keep UI labels and in-app user messages in **pt-BR**, while maintaining synchronized bilingual documentation (`docs/*.md` in pt-BR and `docs/en/*.md` in English) and established technical terms (`Preset`, `Sync`, `Fallback`, `Worktree`, `Diff`) where clearest

### Full verification suite

Run all applicable checks before completing any task (see also the [User Guide](USER_GUIDE.md), [`README.md`](../../README.md), and [JSONC Presets Reference](JSONC_PRESETS_REFERENCE.md)):

```bash
# Rust / Tauri backend
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml

# React / TypeScript frontend
bun run typecheck
bun run test
bun run build
```
