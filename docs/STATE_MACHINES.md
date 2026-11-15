# State Machines, Invariants & Stabilized Transitions (`oh-my-t3code`)

Este documento cataloga **todas as máquinas de estado explícitas e implícitas** do aplicativo `oh-my-t3code` (backend Rust/Tauri v2 + frontend React 19/TypeScript + Mock IPC + ciclo de janelas macOS), suas invariantes, tabelas de transição estabilizadas e o histórico de resolução dos **17 bugs de transição, retentativas (retries) e concorrência** (`SM1-BUG-1` a `SM6-BUG-2`) — todos corrigidos e cobertos por testes de regressão automatizados no épico [`VTECH-112`](https://linear.app/vtech-digital/issue/VTECH-112/epico-estabilizacao-das-maquinas-de-estado-concorrencia-e-retries-sm-1).

---

## Sumário das Máquinas de Estado

| ID | Máquina de Estado | Camada | Arquivos Principais |
| :--- | :--- | :--- | :--- |
| **SM-1** | Configuração Global & Sync de `settings.json` | Rust + UI | `models.rs`, `preset_engine.rs`, `compiler.rs`, `settings_sync.rs`, `PopoverView.tsx`, `StudioView.tsx` |
| **SM-2** | Override por Projeto & Squad Compilada | Rust + Disk + UI | `models.rs`, `preset_engine.rs`, `compiler.rs`, `settings_sync.rs`, `t3_reader.rs`, `RolesMatrixTab.tsx` |
| **SM-3** | Persistência Atômica & RMW Concorrente | Rust I/O | `preset_engine.rs` (`atomic_write_file`, `lock_config_state`), `settings_sync.rs` (`lock_settings_file`), `compiler.rs` |
| **SM-4** | Ações Assíncronas & Seleção no Menu Bar Popover | React UI | `src/views/PopoverView.tsx` |
| **SM-5** | Seleção, Navegação, Rascunho (`dirty`) & Save no Preset Studio | React UI + IPC | `src/views/StudioView.tsx`, `src/components/studio/StudioSidebar.tsx`, `src/lib/ipc-client.ts`, `src-tauri/src/lib.rs` |
| **SM-6** | Ciclo de Janelas macOS Tray/Popover & Paridade do Mock IPC | Tauri + Mock | `src-tauri/src/lib.rs`, `src/lib/mock-data.ts`, `src/types/ipc.ts` |

---

## SM-1: Configuração Global & Sync de `settings.json`

### Superfícies de Estado
1. `~/.config/oh-my-t3code/config.jsonc` → `GlobalAppConfig { activeGlobalPresetId: string, enabled: bool }` ([`models.rs:89-94`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/models.rs#L89-L94)).
2. `~/.config/oh-my-t3code/presets/<id>.jsonc` → `PresetConfig { id, enabled, orchestrator, fallbackChain, disabledRoles, ... }` ([`models.rs:391-414`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/models.rs#L391-L414)).
3. `~/.t3/userdata/settings.json` → `defaultModelSelection`, `fallbackModelSelection` ([`settings_sync.rs:271-358`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L271-L358)).

### Estados
- `Uninitialized`: `config.jsonc` e/ou `presets/*.jsonc` ainda não existem; `load_global_config` retorna `GlobalAppConfig::default()` (`"default"`, `enabled: true`).
- `GlobalActive(presetId)`: `config.enabled == true` e `settings.json` (`defaultModelSelection`, `fallbackModelSelection`) reflete o orquestrador e `fallbackChain[0]` de `presetId`.
- `GlobalPaused(presetId)`: `config.enabled == false`; [`remove_global_settings_override`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L327-L358) remove `defaultModelSelection` e `fallbackModelSelection` de `settings.json` preservando todas as demais chaves, e projetos sem override seguem a configuração nativa do T3 Code.
- `MissingOrInvalidPreset(presetId)`: `config.activeGlobalPresetId` aponta para um ID ausente/inválido; `get_project_preset_unlocked` e `build_dashboard_snapshot` aplicam fallback seguro para `"default"` / `"agy-dual"`, e comandos de escrita rejeitam IDs inválidos.

### Invariantes
- **I1.1:** Em `GlobalActive(id)`, `settings.json.defaultModelSelection` e `settings.json.fallbackModelSelection` correspondem exatamente a `presets/<id>.jsonc` (`orchestrator` e `fallbackChain[0]`).
- **I1.2:** Em `GlobalPaused(id)`, `settings.json` não mantém `defaultModelSelection`/`fallbackModelSelection` ativos de `oh-my-t3code`, e `swap_global_instance` é bloqueado tanto no backend quanto na UI.
- **I1.3:** O estado `enabled` em `config.jsonc` e o estado `draftPreset.enabled` / `presets/<id>.jsonc` permanecem alinhados no Studio após salvar ou alternar status.
- **I1.4:** Todo projeto sem override local resolve para `config.activeGlobalPresetId` independentemente do `active_instance_hint` (`codex` vs `antigravity`).

### Tabela de Transições (Estabilizada)
| Origem | Gatilho / Comando | Guarda | Ações / Efeitos | Destino |
| :--- | :--- | :--- | :--- | :--- |
| `Uninitialized` | `ensure_seed_presets` | `!config.jsonc.exists()` | Grava 4 presets (`default`, `agy-dual`, `codex-squad`, `hybrid-agy-codex`) + `config.jsonc` (`"default"`, `true`) | `GlobalActive("default")` |
| `GlobalActive(A)` / `GlobalPaused(A)` | `set_global_preset_config(B, true)` | `B` válido e existe | Atualiza `config.jsonc` (`B`, `true`) + `sync_global_settings(B)` | `GlobalActive(B)` |
| `GlobalActive(A)` | `set_global_preset_config(A, false)` | `A` válido e existe | Atualiza `config.jsonc` (`enabled=false`) + `remove_global_settings_override` (com `.bak`, preservando `favorites`/`projectSettingsOverrides`) | `GlobalPaused(A)` |
| `GlobalActive(A)` | `swap_global_instance()` | `global_cfg.enabled == true` | Alterna instância/modelo em `presets/A.jsonc` + `sync_global_settings` sob `lock_config_state()` | `GlobalActive(A)` |
| `GlobalPaused(A)` | `swap_global_instance()` | `!global_cfg.enabled` | Botão desabilitado na UI; backend rejeita com `AppError::InvalidInput` sem mutar disco | `GlobalPaused(A)` *(inalterado)* |
| `GlobalActive(A)` | Studio `handleSaveGlobalPreset` em `A` | `saved.id == active && globalConfig.enabled` | Chama `save_global_preset_and_sync` → salva `presets/A.jsonc` + `sync_global_settings` | `GlobalActive(A)` |
| `GlobalPaused(A)` | Studio `handleSaveGlobalPreset` em `A` | `!globalConfig.enabled` | Salva `presets/A.jsonc` mantendo alinhamento sem gravar `settings.json` | `GlobalPaused(A)` |
| `GlobalActive(A)` / `GlobalPaused(A)` | Studio `handleToggleGlobalPresetStatus` | `!dirtyRef.current` (ou preserva `dirty`) | Chama `set_global_preset_config`; se `!dirty`, persiste `enabled` também em `presets/A.jsonc` via `save_global_preset` | `GlobalPaused(A)` / `GlobalActive(A)` |

### Bugs Catalogados e Resolvidos
- **SM1-BUG-1 `[CORRIGIDO — VTECH-116]`:** Pausar o Preset Global agora remove `defaultModelSelection` e `fallbackModelSelection` de `settings.json` (com backup `.bak`), desabilita o botão **Swap Global** na UI e bloqueia `swap_global_instance` no backend quando `!global_cfg.enabled`.
  - **Correção:** [`compiler.rs:904-927`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L904-L927), [`compiler.rs:1027-1189`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1027-L1189), [`settings_sync.rs:327-358`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L327-L358), [`PopoverView.tsx:448-491`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L448-L491) e [`PopoverView.tsx:1053-1091`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L1053-L1091).
  - **Testes de Regressão:** [`settings_sync.rs:617-659`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L617-L659), [`compiler.rs:1712-1748`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1712-L1748), [`e2e_preset_flow.rs:647-735`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/tests/e2e_preset_flow.rs#L647-L735) e [`sm1.test.tsx:13-90`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm1.test.tsx#L13-L90).
- **SM1-BUG-2 `[CORRIGIDO — VTECH-116]`:** `save_global_preset` no Tauri agora delega para `save_global_preset_and_sync` (sincronizando `settings.json` quando o preset salvo é o Global ativo e habilitado), e o Studio alinha `draftPreset.enabled` no carregamento, no save e no toggle de status.
  - **Correção:** [`lib.rs:115-118`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L115-L118), [`compiler.rs:887-899`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L887-L899), [`StudioView.tsx:212-215`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L212-L215), [`StudioView.tsx:581-609`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L581-L609) e [`StudioView.tsx:611-658`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L611-L658).
  - **Testes de Regressão:** [`compiler.rs:1751-1820`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1751-L1820), [`e2e_preset_flow.rs:697-711`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/tests/e2e_preset_flow.rs#L697-L711) e [`sm1.test.tsx:92-213`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm1.test.tsx#L92-L213).
- **SM1-BUG-3 `[CORRIGIDO — VTECH-116]`:** `get_project_preset_unlocked` (e `MockIpcStore.getProjectPreset`) agora resolvem projetos sem override local usando `global_cfg.active_global_preset_id` (com fallback para `"default"` / `"agy-dual"`), sem forçar `"codex-squad"` por hint.
  - **Correção:** [`preset_engine.rs:1811-1826`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L1811-L1826) e [`mock-data.ts:1752-1771`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1752-L1771).
  - **Testes de Regressão:** [`preset_engine.rs:2256-2307`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L2256-L2307), [`e2e_preset_flow.rs:691-695`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/tests/e2e_preset_flow.rs#L691-L695) e [`sm5_sm6.test.tsx:371-383`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm5_sm6.test.tsx#L371-L383).

---

## SM-2: Override por Projeto & Squad Compilada

### Superfícies de Estado
1. `<workspace>/.t3code/preset.jsonc` (`has_local_preset`, `enabled`, `id`, `extends`, `roles`, `disabledRoles`).
2. `<workspace>/.agents/skills/<slug>-squad/{SKILL.md, roles/*.md}` (`detected_squad`).
3. `~/.t3/userdata/settings.json` → `projectSettingsOverrides[projectId].defaultModelSelection`.
4. Derivado no snapshot: `has_custom_override` ([`t3_reader.rs:380-453`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/t3_reader.rs#L380-L453)).

### Estados
- `FollowingGlobal`: sem `.t3code/preset.jsonc`, sem `projectSettingsOverrides[id]` divergente, sem squad manual externo; `has_custom_override == false`.
- `ExternalSquadDetected`: existe `.agents/skills/*-squad/SKILL.md` sem cabeçalho do compilador (`"— Playbook do Orquestrador (T3 Code)"`) e sem `.t3code/preset.jsonc`; `has_custom_override == true`.
- `ActiveOverride`: `.t3code/preset.jsonc` (`enabled: true`) + `.agents/skills/<slug>-squad/` compilada (sem `roles/*.md` órfãos) + `projectSettingsOverrides[id]` sincronizado em `settings.json`.
- `PausedOverride`: `.t3code/preset.jsonc` (`enabled: false`) + `projectSettingsOverrides[id]` ausente em `settings.json`; `has_custom_override == true` (permanece visível para reativação, sem swap permitido).

### Invariantes
- **I2.1:** Em `PausedOverride` (`enabled == false`), `projectSettingsOverrides[projectId]` NÃO existe em `settings.json`, inclusive após `apply_preset_to_project` ou `set_project_preset_enabled(false)`.
- **I2.2:** Em `ActiveOverride` (e `PausedOverride` após compilação), os arquivos em `.agents/skills/<slug>-squad/roles/*.md` são exatamente o conjunto `resolved.roles.keys()` — qualquer arquivo `*.md` órfão é removido.
- **I2.3:** Ao executar `remove_project_override`, qualquer squad gerada pelo compilador (identificada pela assinatura `"— Playbook do Orquestrador (T3 Code)"` em `SKILL.md`) e diretórios `.agents/skills` / `.agents` vazios são removidos; squads manuais e skills irmãs não relacionadas são preservadas intactas.
- **I2.4:** Remover um papel em um preset derivado (`extends != null`) persiste via tombstone `disabledRoles` após salvar e recarregar, e é automaticamente limpo se o papel for redeclarado explicitamente.

### Tabela de Transições (Estabilizada)
| Origem | Gatilho / Comando | Guarda | Ações / Efeitos | Destino |
| :--- | :--- | :--- | :--- | :--- |
| `FollowingGlobal` / `ExternalSquadDetected` | `apply_preset_to_project` / `import_existing_squad` | `resolved.enabled == true` | Grava `.t3code/preset.jsonc`, compila `SKILL.md` + `roles/*.md`, faz prune de `roles/*.md` órfãos, grava `settings.json` | `ActiveOverride` |
| `FollowingGlobal` / `ActiveOverride` | `apply_preset_to_project` | `resolved.enabled == false` | Grava `.t3code/preset.jsonc` (`enabled=false`), compila/prune `roles/*.md`, remove `projectSettingsOverrides[id]` | `PausedOverride` |
| `ActiveOverride` | `set_project_preset_enabled(false)` | — | Salva `enabled: false` em `.t3code/preset.jsonc`, remove `projectSettingsOverrides[id]` | `PausedOverride` |
| `PausedOverride` | `set_project_preset_enabled(true)` | — | Salva `enabled: true`, compila squad/prune, grava `projectSettingsOverrides[id]` | `ActiveOverride` |
| `PausedOverride` | `swap_project_primary_instance()` | `!resolved.enabled` ou `raw_local.enabled == false` | Botão desabilitado na UI; backend rejeita com `AppError::InvalidInput` sem mutar disco | `PausedOverride` *(inalterado)* |
| `ActiveOverride` | `apply_preset_to_project` após remover/suprimir papel | Papel `X` ausente de `resolved.roles` | Atualiza `SKILL.md` + remove `roles/X.md` e quaisquer `*.md` órfãos | `ActiveOverride` |
| `ActiveOverride` / `PausedOverride` | `remove_project_override()` | `SKILL.md` com assinatura do compilador | Remove `.t3code/preset.jsonc`, `projectSettingsOverrides[id]` e `.agents/skills/<slug>-squad/` (preservando squads manuais/skills irmãs) | `FollowingGlobal` *(ou `ExternalSquadDetected`)* |
| Preset com `extends != null` | Studio `handleDeleteRole` + Save | `preset.extends != null` | Adiciona `roleId` em `disabledRoles` (tombstone); `merge_patch` respeita tombstone em herança multi-nível e remove se redeclarado | *Papel suprimido persiste* |

### Bugs Catalogados e Resolvidos
- **SM2-BUG-1 `[CORRIGIDO — VTECH-117]`:** `swap_project_primary_instance` agora rejeita overrides pausados (`!resolved.enabled || raw_local.enabled == false`) antes de mutar qualquer arquivo, `apply_preset_to_project_unlocked` respeita `resolved.enabled` (removendo o override de `settings.json` quando `false`), e o botão Swap no Popover fica desabilitado quando `!project.presetEnabled`.
  - **Correção:** [`compiler.rs:608-615`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L608-L615), [`compiler.rs:735-883`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L735-L883), [`PopoverView.tsx:681-691`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L681-L691) e [`PopoverView.tsx:1504-1552`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L1504-L1552).
  - **Testes de Regressão:** [`compiler.rs:1823-1871`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1823-L1871), [`e2e_preset_flow.rs:800-805`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/tests/e2e_preset_flow.rs#L800-L805) e [`sm2.test.tsx:15-80`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm2.test.tsx#L15-L80).
- **SM2-BUG-2 `[CORRIGIDO — VTECH-117]`:** `apply_preset_to_project_unlocked` agora remove arquivos `roles/*.md` órfãos que não existem em `resolved.roles` (registrando-os em `written_files`), além de alinhar preview/apply quando `preset.enabled == false`.
  - **Correção:** [`compiler.rs:581-615`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L581-L615) e [`settings_sync.rs:173-181`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L173-L181).
  - **Testes de Regressão:** [`compiler.rs:1874-1980`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1874-L1980) e [`sm2.test.tsx:206-240`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm2.test.tsx#L206-L240).
- **SM2-BUG-3 `[CORRIGIDO — VTECH-117]`:** `remove_project_override` agora detecta a assinatura `"— Playbook do Orquestrador (T3 Code)"` em `.agents/skills/<slug>-squad/SKILL.md` e remove a squad gerada pelo compilador (limpando diretórios pais vazios) sem tocar squads manuais nem skills irmãs.
  - **Correção:** [`compiler.rs:1236-1295`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1236-L1295).
  - **Testes de Regressão:** [`compiler.rs:1983-2063`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1983-L2063), [`e2e_preset_flow.rs:807-817`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/tests/e2e_preset_flow.rs#L807-L817) e [`sm2.test.tsx:241-261`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm2.test.tsx#L241-L261).
- **SM2-BUG-4 `[CORRIGIDO — VTECH-117]`:** Adicionado campo `disabledRoles` (com validação de path traversal via `normalize_disabled_roles`) em `PresetConfig` / `PresetPatch`, suporte a tombstones em `merge_patch`, e atualização automática em `RolesMatrixTab.handleDeleteRole` / `handleAddRole`.
  - **Correção:** [`models.rs:412-413`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/models.rs#L412-L413), [`preset_engine.rs:222-229`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L222-L229), [`preset_engine.rs:316-498`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L316-L498) e [`RolesMatrixTab.tsx:68-116`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/components/studio/RolesMatrixTab.tsx#L68-L116).
  - **Testes de Regressão:** [`preset_engine.rs:2310-2401`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L2310-L2401), [`e2e_preset_flow.rs:775-798`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/tests/e2e_preset_flow.rs#L775-L798) e [`sm2.test.tsx:82-182`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm2.test.tsx#L82-L182).

---

## SM-3: Persistência Atômica & RMW Concorrente (Backend Rust)

### Superfícies de Estado
- Helper [`atomic_write_file`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L646-L712) com contador atômico `ATOMIC_TMP_COUNTER` + `OpenOptions::create_new(true)`.
- Hierarquia estrita de locks em processo:
  1. `preset_engine::lock_config_state()` (lock externo: `config.jsonc`, `presets/*.jsonc`, `.t3code/preset.jsonc`, `.agents/skills/*-squad/`, snapshots read-only via `build_dashboard_snapshot` — [`preset_engine.rs:14-30`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L14-L30)).
  2. `settings_sync::lock_settings_file()` (lock folha: ciclos RMW de `settings.json` e `settings.json.bak` — [`settings_sync.rs:11-23`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L11-L23)).

### Invariantes
- **I3.1:** Cada chamada a `atomic_write_file` aloca um arquivo temporário exclusivo (`.<file>.tmp.<pid>.<seq>`) via `AtomicU64` + `O_CREAT | O_EXCL` (`create_new(true)`), limpando o `.tmp` em qualquer erro.
- **I3.2:** Todas as operações RMW em arquivos compartilhados (`settings.json`, `settings.json.bak`, `config.jsonc`, `presets/*.jsonc`) e leituras de snapshot adquirem locks respeitando a ordem fixa `lock_config_state() -> lock_settings_file()` (sem deadlock e sem *lost updates*).

### Tabela de Transições (Estabilizada)
| Origem | Gatilho / Comando | Guarda | Ações / Efeitos | Destino |
| :--- | :--- | :--- | :--- | :--- |
| Qualquer | `atomic_write_file(path, bytes)` | `OpenOptions::create_new(true)` | Aloca `.file.tmp.<pid>.<seq>`, `write_all` + `sync_all`, `fs::rename` atômico | Arquivo íntegro sem resíduos `.tmp` |
| Operações RMW concorrentes | `sync_*` / `remove_*` em `settings.json` | `lock_settings_file()` | Serializa leitura, gravação de `settings.json.bak` e escrita final de `settings.json` | Zero *lost updates* e `.bak` válido |
| Comandos IPC concorrentes | `swap_global_instance`, `set_global_preset_config`, `apply_preset_to_project`, `build_dashboard_snapshot` | `lock_config_state()` → `*_unlocked` → `lock_settings_file()` | Serializa RMW entre presets, `config.jsonc` e `settings.json` sem reentrância nem inversão de lock | Estado consistente em disco |

### Bugs Catalogados e Resolvidos
- **SM3-BUG-1 `[CORRIGIDO — VTECH-113]`:** Eliminada a colisão determinística de `.tmp.<pid>` em `atomic_write_file` usando `AtomicU64` (`ATOMIC_TMP_COUNTER`) + `OpenOptions::create_new(true)` com limpeza automática em caso de erro de escrita ou `rename`.
  - **Correção:** [`preset_engine.rs:646-712`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L646-L712).
  - **Testes de Regressão:** [`preset_engine.rs:2197-2253`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L2197-L2253) (16 threads × 25 iterações simultâneas sem corrupção nem resíduos `.tmp.*`).
- **SM3-BUG-2 `[CORRIGIDO — VTECH-113]`:** Serializados todos os ciclos RMW em `settings.json` (`lock_settings_file`) e `config.jsonc` / `presets/*.jsonc` / snapshots (`lock_config_state` + variantes `*_unlocked`), eliminando *lost updates* e corrupção de `settings.json.bak`.
  - **Correção:** [`preset_engine.rs:14-30`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L14-L30), [`settings_sync.rs:17-23`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L17-L23), [`settings_sync.rs:206-407`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L206-L407), [`compiler.rs:509-1295`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L509-L1295) e [`t3_reader.rs:1509-1512`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/t3_reader.rs#L1509-L1512).
  - **Testes de Regressão:** [`settings_sync.rs:523-614`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L523-L614), [`compiler.rs:1558-1632`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1558-L1632) e [`compiler.rs:1635-1709`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1635-L1709).

---

## SM-4: Ações Assíncronas & Seleção no Menu Bar Popover (`PopoverView.tsx`)

### Estados & Refs de Controle
- `snapshotRef` + `snapshotSeqRef` + `loadSeqRef` ([`PopoverView.tsx:121-125`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L121-L125)): eliminam closures obsoletas e respostas `get_dashboard_snapshot` *out-of-order*.
- `busyGlobalRef` + `busyGlobalAction: "config" | "swap" | null` ([`PopoverView.tsx:106-107`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L106-L107), [`PopoverView.tsx:122`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L122)): guard síncrono mútuo para controles globais.
- `busyProjectRef: Set<string>` + `busyProjectAction: Record<projectId, "sync" | "swap" | "toggle" | "remove">` ([`PopoverView.tsx:104-105`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L104-L105), [`PopoverView.tsx:123`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L123)): guard síncrono por projeto antes de qualquer `await`.
- `lastSyncedPresetRef` + `selectedPresets` ([`PopoverView.tsx:126`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L126), [`PopoverView.tsx:145-171`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L145-L171)): atualiza o preset selecionado quando o backend muda e preserva rascunhos locais não sincronizados enquanto o backend não divergir.
- `syncedTimersRef` + `handoffTimersRef` + `isMountedRef` ([`PopoverView.tsx:127-143`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L127-L143), [`PopoverView.tsx:593-652`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L593-L652)): rastreia timers de 2600ms (`"Sincronizado!"`) e feedback de cópia por `projectId`, cancela timers anteriores em retentativas e limpa todos no `unmount()`.

### Invariantes
- **I4.1:** Nenhuma ação global (`config` ou `swap`) pode rodar em paralelo com outra ação global (`busyGlobalRef` + `disabled={busyGlobalAction !== null}`).
- **I4.2:** Nenhuma ação por projeto (`sync`, `swap`, `toggle`, `remove`) pode rodar em paralelo no mesmo `projectId` (`busyProjectRef` + `<Select>` e botões `disabled={Boolean(busy)}`).
- **I4.3:** Respostas atrasadas de `loadSnapshot` (`seq !== snapshotSeqRef.current`) nunca sobrescrevem o estado de uma mutação ou refresh mais recente.
- **I4.4:** `syncedProjectIds` e `selectedPresets` refletem a última operação concluída, sem timers órfãos após retentativas ou `unmount()`.

### Tabela de Transições (Estabilizada)
| Origem | Gatilho / Evento | Guarda | Ações / Efeitos | Destino |
| :--- | :--- | :--- | :--- | :--- |
| `Idle` | `loadSnapshot()` | Incrementa `snapshotSeqRef` e `loadSeqRef` | Busca snapshot; aplica apenas se `seq === snapshotSeqRef.current`; encerra spinner se `loadSeq === loadSeqRef.current` | `Ready` *(ou descarta stale)* |
| `GlobalBusy(op)` | Toggle / Select / Swap Global | `busyGlobalRef.current !== null` | Bloqueado síncronamente na entrada e via `disabled={busyGlobalAction !== null}` | `GlobalBusy(op)` *(noop)* |
| `Ready` | Ação Global (`config` / `swap`) | `busyGlobalRef.current === null` | Lê `snapshotRef.current`, grava `busyGlobalRef.current`, incrementa `snapshotSeqRef` na resposta e atualiza `snapshot` | `Ready` |
| `ProjectBusy(id, op)` | `Sync` / `Swap` / `Toggle` / `Remove` / `<Select>` no projeto `id` | `busyProjectRef.current.has(id)` | Bloqueado síncronamente via `busyProjectRef` e via `disabled={Boolean(busy)}` | `ProjectBusy(id, op)` *(noop)* |
| `SyncCooldown(id)` | Novo `handleSyncProject(id)` antes de 2600ms | `syncedTimersRef.current.has(id)` | Cancela timer anterior via `clearTimeout`, executa sync e agenda novo timer de 2600ms | `SyncCooldown(id)` *(resetado)* |
| `SyncCooldown(id)` | `unmount()` | — | `isMountedRef = false`; itera `syncedTimersRef` e `handoffTimersRef` executando `window.clearTimeout` em todos os timers ativos | `Unmounted` |

### Bugs Catalogados e Resolvidos
- **SM4-BUG-1 `[CORRIGIDO — VTECH-114 & VTECH-118]`:** Adicionados `busyGlobalRef` + `disabled={busyGlobalAction !== null}` nos controles globais, `busyProjectRef` + `disabled={Boolean(busy)}` nos handlers e `<Select>` de cada projeto, `snapshotRef` contra closures obsoletas e `snapshotSeqRef` / `loadSeqRef` em `loadSnapshot`.
  - **Correção:** [`PopoverView.tsx:121-204`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L121-L204), [`PopoverView.tsx:391-491`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L391-L491), [`PopoverView.tsx:493-770`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L493-L770), [`PopoverView.tsx:1020-1091`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L1020-L1091) e [`PopoverView.tsx:1420-1635`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L1420-L1635).
  - **Testes de Regressão:** [`sm4_sm5.test.tsx:138-254`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L138-L254) e [`sm4_sm5.test.tsx:668-738`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L668-L738).
- **SM4-BUG-2 `[CORRIGIDO — VTECH-114 & VTECH-118]`:** `syncSelectedPresetsWithSnapshot` passou a atualizar `selectedPresets[projectId]` quando o backend altera o preset efetivo (preservando seleções locais pendentes enquanto o backend não muda), e `syncedTimersRef` + `isMountedRef` cancelam timers anteriores em retentativas e no `unmount()`.
  - **Correção:** [`PopoverView.tsx:126-171`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L126-L171) e [`PopoverView.tsx:593-652`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L593-L652).
  - **Testes de Regressão:** [`sm4_sm5.test.tsx:256-339`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L256-L339) e [`sm4_sm5.test.tsx:740-773`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L740-L773).

---

## SM-5: Seleção, Navegação, Rascunho (`dirty`) & Save no Preset Studio (`StudioView.tsx`)

### Estados & Refs de Controle
- `selection: { kind: "global", presetId } | { kind: "project", projectId } | null` + `selectionRef` + `selectionSeqRef`
- `previewSeqRef` + `navigateSeqRef`
- `pendingNavigateRef` (buffering em *cold-start*) + `deferredNavigateDuringSaveRef` (buffering durante `saving === true`)
- `dirtyRef` + `savingRef` + `pendingSwitch` (modal acessível `role="alertdialog"`)

### Invariantes
- **I5.1:** Quando `selection.kind === "project"`, `projectMeta.projectId === selection.projectId` após o carregamento (`selectionSeqRef` descarta respostas atrasadas).
- **I5.2:** `previewResult.projectId` e `previewResult.presetId` correspondem sempre à seleção e ao rascunho atuais (`previewSeqRef` descarta resultados *out-of-order*).
- **I5.3:** Eventos `studio://navigate` nunca são perdidos em *cold-start*, fazem refresh do snapshot ao chegar, respeitam `navigateSeqRef` contra corridas *out-of-order*, e são adiados se `saving === true`.
- **I5.4:** Em saves multi-etapa (`handleSaveProjectOverride`, `handleApplyProjectSync`, `handleSetAsGlobalDefault`), se a etapa 1 grava em disco e a etapa 2 falha, o Studio limpa `dirty` (`updateDirty(false)`), atualiza o snapshot, exibe alerta claro com erro da etapa 2 e permite retentativa segura.
- **I5.5:** Com `dirty === true`, qualquer troca de seleção/criação/navegação exige confirmação explícita em `role="alertdialog"` (`Escape` / `"Continuar editando"` preserva o foco e o rascunho). Enquanto `saving === true`, a sidebar inteira fica desabilitada (`disabled={saving}`).

### Tabela de Transições (Estabilizada)
| Origem | Gatilho / Evento | Guarda | Ações / Efeitos | Destino |
| :--- | :--- | :--- | :--- | :--- |
| `ColdStart` (`!snapshotRef.current`) | `studio://navigate` | `!snapshotRef.current` | Armazena payload em `pendingNavigateRef.current` | `ColdStart` → drena ao fim de `loadInitial` |
| `Clean` / `Dirty` | `selectProject` / `runPreview` | `seq !== *SeqRef.current` | Descarta resposta atrasada antes de `setProjectMeta` / `setPreviewResult` | Estado da última seleção |
| `Clean` | `studio://navigate` | `!savingRef && !dirtyRef` | Atualiza `freshSnap` via `get_dashboard_snapshot`, verifica `navSeq === navigateSeqRef.current` e navega | Destino atualizado |
| `Saving` (`saving === true`) | Qualquer troca na Sidebar ou `studio://navigate` | `savingRef.current === true` | Sidebar desabilitada (`disabled={saving}`); `studio://navigate` armazenado em `deferredNavigateDuringSaveRef` e drenado ao fim do save | Destino drenado após `saving=false` |
| `Dirty` (`dirty === true`) | Troca de preset/projeto, criação ou `studio://navigate` | `dirtyRef.current === true` | Abre `role="alertdialog"`; confirmar descarta e executa `pendingSwitch`, cancelar restaura foco | `PendingSwitchConfirm` → destino ou `Dirty` |
| `SavingMultiStep` | Etapa 1 OK, Etapa 2 falha (`apply_preset_sync` / `set_global_preset_config`) | Catch na etapa 2 | Mantém estado gravado na etapa 1, executa `updateDirty(false)`, recarrega snapshot e exibe alerta de retentativa | `Clean` *(com erro acionável)* |

### Bugs Catalogados e Resolvidos
- **SM5-BUG-1 `[CORRIGIDO — VTECH-114]`:** `selectProject` e `runPreview` agora usam tokens monotonicos (`selectionSeqRef` e `previewSeqRef`) descartando respostas atrasadas de projetos/previews anteriores.
  - **Correção:** [`StudioView.tsx:228-255`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L228-L255) e [`StudioView.tsx:505-540`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L505-L540).
  - **Testes de Regressão:** [`sm4_sm5.test.tsx:341-482`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L341-L482).
- **SM5-BUG-2 `[CORRIGIDO — VTECH-114 & VTECH-118]`:** `handleNavigationEvent` agora guarda payload em `pendingNavigateRef` no *cold-start*, busca snapshot atualizado via `get_dashboard_snapshot`, protege contra corridas *out-of-order* via `navigateSeqRef`, e `NavigateListener` suporta `void | Promise<void>` para drenar navegação sem warnings de `act(...)` nos testes.
  - **Correção:** [`StudioView.tsx:257-410`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L257-L410), [`ipc-client.ts:11`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/ipc-client.ts#L11) e [`ipc-client.ts:50-58`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/ipc-client.ts#L50-L58).
  - **Testes de Regressão:** [`sm4_sm5.test.tsx:484-558`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L484-L558) e [`sm4_sm5.test.tsx:775-873`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L775-L873).
- **SM5-BUG-3 `[CORRIGIDO — VTECH-114]`:** Em `handleSetAsGlobalDefault`, `handleSaveProjectOverride` e `handleApplyProjectSync`, a etapa 1 limpa `dirty` e atualiza o estado local imediatamente; falhas na etapa 2 atualizam `snapshot` e reportam erro explícito preservando a persistência da etapa 1.
  - **Correção:** [`StudioView.tsx:660-758`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L660-L758) e [`StudioView.tsx:844-905`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L844-L905).
  - **Testes de Regressão:** [`sm4_sm5.test.tsx:560-666`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L560-L666).
- **SM5-BUG-4 `[CORRIGIDO — VTECH-115]`:** Adicionada guarda de `dirty` com modal acessível `role="alertdialog"` (`Escape`, gerenciamento/restauração de foco, atalho noop quando clicando no item já selecionado), bloqueio completo da `StudioSidebar` (`disabled={saving}`) e fila `deferredNavigateDuringSaveRef` para `studio://navigate` recebido durante um save.
  - **Correção:** [`StudioView.tsx:148-201`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L148-L201), [`StudioView.tsx:337-410`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L337-L410), [`StudioView.tsx:942-1150`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L942-L1150), [`StudioView.tsx:1801-1858`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L1801-L1858) e [`StudioSidebar.tsx:350-554`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/components/studio/StudioSidebar.tsx#L350-L554).
  - **Testes de Regressão:** [`sm5_sm6.test.tsx:138-253`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm5_sm6.test.tsx#L138-L253) e [`sm5_sm6.test.tsx:255-369`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm5_sm6.test.tsx#L255-L369).

---

## SM-6: Tray/Popover macOS & Paridade do `MockIpcStore`

### Superfícies & Contratos
- **macOS Tray / Popover Blur Guard:** `TRAY_BLUR_DEBOUNCE` (250ms) + `PopoverBlurGuard` + `should_suppress_tray_reopen` ([`lib.rs:21-74`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L21-L74)).
- **Paridade `MockIpcStore` ↔ Backend Rust:** [`mock-data.ts:1454-2547`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1454-L2547) e [`SettingsOverridePreview`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/types/ipc.ts#L250-L257).

### Invariantes
- **I6.1:** Clicar no ícone da Menu Bar enquanto o Popover está aberto não pode reabrir a janela caso `WindowEvent::Focused(false)` tenha ocultado o Popover nos últimos `250ms` (`TRAY_BLUR_DEBOUNCE`); um segundo clique subsequente (após o guard ser consumido) reabre normalmente.
- **I6.2:** `MockIpcStore` espelha estritamente as validações, herança com `disabledRoles`, prune de `roles/*.md`, fallback global, remoção seletiva de squads e formato completo de `previewPresetSync` (incluindo `.t3code/preset.jsonc` como 1º arquivo e `newOverride = null` quando `enabled === false`).

### Bugs Catalogados e Resolvidos
- **SM6-BUG-1 `[CORRIGIDO — VTECH-115 & VTECH-118]`:** Alinhada paridade completa do `MockIpcStore` com o backend Rust: `getProjectPreset` segue `activeGlobalPresetId`; `setGlobalPresetConfig` / `applyPresetSync` / `saveGlobalPreset` / `saveProjectPreset` validam IDs e herança atomicamente antes de mutar; `setProjectPresetEnabled(false)` e `swapGlobalInstance` aplicam fallback global correto; `applyPresetSync` resolve `disabledRoles` e faz prune de `roles/*.md`; `previewPresetSync` inclui `.t3code/preset.jsonc` como 1º item de `files` e retorna `settingsPreview.newOverride = null` quando `enabled === false`.
  - **Correção:** [`mock-data.ts:1454-2547`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1454-L2547) (em especial `previewPresetSync` em [`mock-data.ts:1818-1928`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1818-L1928), `applyPresetSync` em [`mock-data.ts:1930-2029`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1930-L2029), `setGlobalPresetConfig` em [`mock-data.ts:2259-2278`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L2259-L2278) e `setProjectPresetEnabled` em [`mock-data.ts:2468-2509`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L2468-L2509)) + `SettingsOverridePreview.newOverride` tipado como `Record<string, unknown> | null` em [`ipc.ts:250-257`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/types/ipc.ts#L250-L257).
  - **Testes de Regressão:** [`sm2.test.tsx:184-261`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm2.test.tsx#L184-L261) e [`sm5_sm6.test.tsx:371-501`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm5_sm6.test.tsx#L371-L501).
- **SM6-BUG-2 `[CORRIGIDO — VTECH-115]`:** Introduzido `PopoverBlurGuard` com janela `TRAY_BLUR_DEBOUNCE` (250ms): `WindowEvent::Focused(false)` registra o instante de ocultação ao fechar por perda de foco; `toggle_popover_window_internal` com `from_tray_click = true` consome e suprime a reabertura espúria dentro da janela de debounce, sendo limpo em fechamentos explícitos ou abertura do Studio.
  - **Correção:** [`lib.rs:21-74`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L21-L74), [`lib.rs:247-249`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L247-L249), [`lib.rs:301-333`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L301-L333) e [`lib.rs:394-411`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L394-L411).
  - **Testes de Regressão:** [`lib.rs:447-526`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L447-L526).

---

## Backlog no Linear ([Oh My T3Code — Estabilização (State Machines)](https://linear.app/vtech-digital/project/oh-my-t3code-estabilizacao-state-machines-5279ee09da3c))

**Épico Pai:** [`VTECH-112`](https://linear.app/vtech-digital/issue/VTECH-112/epico-estabilizacao-das-maquinas-de-estado-concorrencia-e-retries-sm-1) — `[Épico] Estabilização das Máquinas de Estado, Concorrência e Retries (SM-1 a SM-6)` (**Status:** Concluída)

| Prioridade | Issue | Título / Escopo | Bugs Cobertos | Frente | Bloqueada por | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **P0 — Urgent** | [`VTECH-113`](https://linear.app/vtech-digital/issue/VTECH-113/sm-3-corrigir-colisao-de-arquivo-temporario-em-atomic_write_file-e) | Hardening de Concorrência & Escrita Atômica no Backend Rust | `SM3-BUG-1`, `SM3-BUG-2` | `rust-core` | — | **Concluída** |
| **P1 — High** | [`VTECH-116`](https://linear.app/vtech-digital/issue/VTECH-116/sm-1-garantir-consistencia-entre-global-preset-settingsjson-e-studio) | Consistência entre Global Preset, `settings.json` e Studio | `SM1-BUG-1`, `SM1-BUG-2`, `SM1-BUG-3` | `rust-core` + `frontend-ui` | `VTECH-113` | **Concluída** |
| **P1 — High** | [`VTECH-117`](https://linear.app/vtech-digital/issue/VTECH-117/sm-2-corrigir-swap-em-override-pausado-prune-de-rolesmd-limpeza-no) | Swap em override pausado, prune de `roles/*.md`, limpeza no remove e tombstone de herança | `SM2-BUG-1`, `SM2-BUG-2`, `SM2-BUG-3`, `SM2-BUG-4` | `rust-core` + `frontend-ui` | `VTECH-113` | **Concluída** |
| **P1 — High** | [`VTECH-114`](https://linear.app/vtech-digital/issue/VTECH-114/sm-4sm-5-eliminar-race-conditions-out-of-order-drops-de-navegacao-e) | Race conditions *out-of-order*, drops de navegação e falhas parciais na UI | `SM4-BUG-1`, `SM4-BUG-2`, `SM5-BUG-1`, `SM5-BUG-2`, `SM5-BUG-3` | `frontend-ui` | — | **Concluída** |
| **P2 — Medium** | [`VTECH-115`](https://linear.app/vtech-digital/issue/VTECH-115/sm-5sm-6-guarda-de-dirty-state-paridade-do-mockipcstore-e-corrida) | Guarda de `dirty` state, paridade do `MockIpcStore` e corrida Tray/Blur no macOS | `SM5-BUG-4`, `SM6-BUG-1`, `SM6-BUG-2` | `rust-core` + `frontend-ui` | — | **Concluída** |
| **P1 — High** | [`VTECH-118`](https://linear.app/vtech-digital/issue/VTECH-118/qa-suite-de-testes-de-regressao-concorrenteretries-e-atualizacao-de) | Suíte de testes de regressão concorrente/retries, fechamento da auditoria QA e atualização final de `docs/STATE_MACHINES.md` | Todos (`SM1`–`SM6`) | `qa-reviewer` + `frontend-ui` | `VTECH-113`..`VTECH-117` | **Concluída** |
