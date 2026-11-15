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
2. `~/.config/oh-my-t3code/presets/<id>.jsonc` → `PresetConfig { id, enabled, orchestrator, fallbackChain, disabledRoles, ... }` ([`models.rs:185-206`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/models.rs#L185-L206)).
3. `~/.t3/userdata/settings.json` → `defaultModelSelection`, `fallbackModelSelection` ([`settings_sync.rs:268-354`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L268-L354)).

### Estados
- `Uninitialized`: `config.jsonc` e/ou `presets/*.jsonc` ainda não existem; `load_global_config` retorna `GlobalAppConfig::default()` (`"default"`, `enabled: true`).
- `GlobalActive(presetId)`: `config.enabled == true` e `settings.json` (`defaultModelSelection`, `fallbackModelSelection`) reflete o orquestrador e `fallbackChain[0]` de `presetId`.
- `GlobalPaused(presetId)`: `config.enabled == false`; [`remove_global_settings_override`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L323-L354) remove `defaultModelSelection` e `fallbackModelSelection` de `settings.json` preservando todas as demais chaves, e projetos sem override seguem a configuração nativa do T3 Code.
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
  - **Correção:** [`compiler.rs:638-674`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L638-L674), [`settings_sync.rs:323-354`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L323-L354), [`PopoverView.tsx:353-361`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L353-L361) e [`PopoverView.tsx:781-795`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L781-L795).
  - **Testes de Regressão:** [`settings_sync.rs:613-655`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L613-L655), [`compiler.rs:1273-1309`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1273-L1309), [`e2e_preset_flow.rs:640-727`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/tests/e2e_preset_flow.rs#L640-L727) e [`sm1.test.tsx:13-90`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm1.test.tsx#L13-L90).
- **SM1-BUG-2 `[CORRIGIDO — VTECH-116]`:** `save_global_preset` no Tauri agora delega para `save_global_preset_and_sync` (sincronizando `settings.json` quando o preset salvo é o Global ativo e habilitado), e o Studio alinha `draftPreset.enabled` no carregamento, no save e no toggle de status.
  - **Correção:** [`lib.rs:115-118`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L115-L118), [`compiler.rs:621-633`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L621-L633), [`StudioView.tsx:189-192`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L189-L192), [`StudioView.tsx:472-500`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L472-L500) e [`StudioView.tsx:502-546`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L502-L546).
  - **Testes de Regressão:** [`compiler.rs:1312-1381`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1312-L1381), [`e2e_preset_flow.rs:690-703`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/tests/e2e_preset_flow.rs#L690-L703) e [`sm1.test.tsx:92-213`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm1.test.tsx#L92-L213).
- **SM1-BUG-3 `[CORRIGIDO — VTECH-116]`:** `get_project_preset_unlocked` (e `MockIpcStore.getProjectPreset`) agora resolvem projetos sem override local usando `global_cfg.active_global_preset_id` (com fallback para `"default"` / `"agy-dual"`), sem forçar `"codex-squad"` por hint.
  - **Correção:** [`preset_engine.rs:1684-1699`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L1684-L1699) e [`mock-data.ts:1349-1368`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1349-L1368).
  - **Testes de Regressão:** [`preset_engine.rs:2129-2180`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L2129-L2180), [`e2e_preset_flow.rs:684-688`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/tests/e2e_preset_flow.rs#L684-L688) e [`sm5_sm6.test.tsx:370-377`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm5_sm6.test.tsx#L370-L377).

---

## SM-2: Override por Projeto & Squad Compilada

### Superfícies de Estado
1. `<workspace>/.t3code/preset.jsonc` (`has_local_preset`, `enabled`, `id`, `extends`, `roles`, `disabledRoles`).
2. `<workspace>/.agents/skills/<slug>-squad/{SKILL.md, roles/*.md}` (`detected_squad`).
3. `~/.t3/userdata/settings.json` → `projectSettingsOverrides[projectId].defaultModelSelection`.
4. Derivado no snapshot: `has_custom_override` ([`t3_reader.rs:357-429`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/t3_reader.rs#L357-L429)).

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
  - **Correção:** [`compiler.rs:509-549`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L509-L549), [`PopoverView.tsx:553-561`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L553-L561) e [`PopoverView.tsx:1090-1105`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L1090-L1105).
  - **Testes de Regressão:** [`compiler.rs:1384-1432`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1384-L1432), [`e2e_preset_flow.rs:793-798`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/tests/e2e_preset_flow.rs#L793-L798) e [`sm2.test.tsx:15-80`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm2.test.tsx#L15-L80).
- **SM2-BUG-2 `[CORRIGIDO — VTECH-117]`:** `apply_preset_to_project_unlocked` agora remove arquivos `roles/*.md` órfãos que não existem em `resolved.roles` (registrando-os em `written_files`), além de alinhar preview/apply quando `preset.enabled == false`.
  - **Correção:** [`compiler.rs:476-516`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L476-L516) e [`settings_sync.rs:170-178`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L170-L178).
  - **Testes de Regressão:** [`compiler.rs:1435-1541`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1435-L1541) e [`sm2.test.tsx:205-239`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm2.test.tsx#L205-L239).
- **SM2-BUG-3 `[CORRIGIDO — VTECH-117]`:** `remove_project_override` agora detecta a assinatura `"— Playbook do Orquestrador (T3 Code)"` em `.agents/skills/<slug>-squad/SKILL.md` e remove a squad gerada pelo compilador (limpando diretórios pais vazios) sem tocar squads manuais nem skills irmãs.
  - **Correção:** [`compiler.rs:797-856`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L797-L856).
  - **Testes de Regressão:** [`compiler.rs:1544-1624`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1544-L1624), [`e2e_preset_flow.rs:800-810`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/tests/e2e_preset_flow.rs#L800-L810) e [`sm2.test.tsx:241-260`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm2.test.tsx#L241-L260).
- **SM2-BUG-4 `[CORRIGIDO — VTECH-117]`:** Adicionado campo `disabledRoles` (com validação de path traversal via `normalize_disabled_roles`) em `PresetConfig` / `PresetPatch`, suporte a tombstones em `merge_patch`, e atualização automática em `RolesMatrixTab.handleDeleteRole` / `handleAddRole`.
  - **Correção:** [`models.rs:204-205`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/models.rs#L204-L205), [`preset_engine.rs:221-244`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L221-L244), [`preset_engine.rs:328-393`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L328-L393) e [`RolesMatrixTab.tsx:68-116`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/components/studio/RolesMatrixTab.tsx#L68-L116).
  - **Testes de Regressão:** [`preset_engine.rs:2183-2274`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L2183-L2274), [`e2e_preset_flow.rs:768-791`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/tests/e2e_preset_flow.rs#L768-L791) e [`sm2.test.tsx:82-182`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm2.test.tsx#L82-L182).

---

## SM-3: Persistência Atômica & RMW Concorrente (Backend Rust)

### Superfícies de Estado
- Helper [`atomic_write_file`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L547-L606) com contador atômico `ATOMIC_TMP_COUNTER` + `OpenOptions::create_new(true)`.
- Hierarquia estrita de locks em processo:
  1. `preset_engine::lock_config_state()` (lock externo: `config.jsonc`, `presets/*.jsonc`, `.t3code/preset.jsonc`, `.agents/skills/*-squad/`, snapshots read-only via `build_dashboard_snapshot` — [`preset_engine.rs:13-29`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L13-L29)).
  2. `settings_sync::lock_settings_file()` (lock folha: ciclos RMW de `settings.json` e `settings.json.bak` — [`settings_sync.rs:9-21`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L9-L21)).

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
  - **Correção:** [`preset_engine.rs:540-606`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L540-L606).
  - **Testes de Regressão:** [`preset_engine.rs:2070-2126`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L2070-L2126) (16 threads × 25 iterações simultâneas sem corrupção nem resíduos `.tmp.*`).
- **SM3-BUG-2 `[CORRIGIDO — VTECH-113]`:** Serializados todos os ciclos RMW em `settings.json` (`lock_settings_file`) e `config.jsonc` / `presets/*.jsonc` / snapshots (`lock_config_state` + variantes `*_unlocked`), eliminando *lost updates* e corrupção de `settings.json.bak`.
  - **Correção:** [`preset_engine.rs:13-29`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L13-L29), [`settings_sync.rs:15-21`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L15-L21), [`settings_sync.rs:203-403`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L203-L403), [`compiler.rs:412-856`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L412-L856) e [`t3_reader.rs:862-865`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/t3_reader.rs#L862-L865).
  - **Testes de Regressão:** [`settings_sync.rs:519-610`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L519-L610), [`compiler.rs:1119-1193`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1119-L1193) e [`compiler.rs:1196-1270`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L1196-L1270).

---

## SM-4: Ações Assíncronas & Seleção no Menu Bar Popover (`PopoverView.tsx`)

### Estados & Refs de Controle
- `snapshotRef` + `snapshotSeqRef` + `loadSeqRef` ([`PopoverView.tsx:94-99`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L94-L99)): eliminam closures obsoletas e respostas `get_dashboard_snapshot` *out-of-order*.
- `busyGlobalRef` + `busyGlobalAction: "config" | "swap" | null` ([`PopoverView.tsx:85-87,96`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L85-L96)): guard síncrono mútuo para controles globais.
- `busyProjectRef: Set<string>` + `busyProjectAction: Record<projectId, "sync" | "swap" | "toggle" | "remove">` ([`PopoverView.tsx:82-84,97`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L82-L97)): guard síncrono por projeto antes de qualquer `await`.
- `lastSyncedPresetRef` + `selectedPresets` ([`PopoverView.tsx:100,114-140`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L114-L140)): atualiza o preset selecionado quando o backend muda e preserva rascunhos locais não sincronizados enquanto o backend não divergir.
- `syncedTimersRef` + `isMountedRef` ([`PopoverView.tsx:101-112,500-540`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L101-L112)): rastreia timers de 2600ms (`"Sincronizado!"`) por `projectId`, cancela timers anteriores em retentativas e limpa todos no `unmount()`.

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
| `SyncCooldown(id)` | `unmount()` | — | `isMountedRef = false`; itera `syncedTimersRef` executando `window.clearTimeout` em todos os timers ativos | `Unmounted` |

### Bugs Catalogados e Resolvidos
- **SM4-BUG-1 `[CORRIGIDO — VTECH-114 & VTECH-118]`:** Adicionados `busyGlobalRef` + `disabled={busyGlobalAction !== null}` nos controles globais, `busyProjectRef` + `disabled={Boolean(busy)}` nos handlers e `<Select>` de cada projeto, `snapshotRef` contra closures obsoletas e `snapshotSeqRef` / `loadSeqRef` em `loadSnapshot`.
  - **Correção:** [`PopoverView.tsx:94-169`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L94-L169), [`PopoverView.tsx:296-449`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L296-L449), [`PopoverView.tsx:492-591`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L492-L591), [`PopoverView.tsx:750-788`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L750-L788) e [`PopoverView.tsx:1080-1174`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L1080-L1174).
  - **Testes de Regressão:** [`sm4_sm5.test.tsx:132-248`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L132-L248) e [`sm4_sm5.test.tsx:662-732`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L662-L732).
- **SM4-BUG-2 `[CORRIGIDO — VTECH-114 & VTECH-118]`:** `syncSelectedPresetsWithSnapshot` passou a atualizar `selectedPresets[projectId]` quando o backend altera o preset efetivo (preservando seleções locais pendentes enquanto o backend não muda), e `syncedTimersRef` + `isMountedRef` cancelam timers anteriores em retentativas e no `unmount()`.
  - **Correção:** [`PopoverView.tsx:100-140`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L100-L140) e [`PopoverView.tsx:500-540`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L500-L540).
  - **Testes de Regressão:** [`sm4_sm5.test.tsx:250-333`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L250-L333) e [`sm4_sm5.test.tsx:734-767`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L734-L767).

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
  - **Correção:** [`StudioView.tsx:205-232`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L205-L232) e [`StudioView.tsx:396-431`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L396-L431).
  - **Testes de Regressão:** [`sm4_sm5.test.tsx:335-476`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L335-L476).
- **SM5-BUG-2 `[CORRIGIDO — VTECH-114 & VTECH-118]`:** `handleNavigationEvent` agora guarda payload em `pendingNavigateRef` no *cold-start*, busca snapshot atualizado via `get_dashboard_snapshot`, protege contra corridas *out-of-order* via `navigateSeqRef`, e `NavigateListener` suporta `void | Promise<void>` para drenar navegação sem warnings de `act(...)` nos testes.
  - **Correção:** [`StudioView.tsx:255-387`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L255-L387) e [`ipc-client.ts:11,42-51`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/ipc-client.ts#L11).
  - **Testes de Regressão:** [`sm4_sm5.test.tsx:478-552`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L478-L552) e [`sm4_sm5.test.tsx:769-867`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L769-L867).
- **SM5-BUG-3 `[CORRIGIDO — VTECH-114]`:** Em `handleSetAsGlobalDefault`, `handleSaveProjectOverride` e `handleApplyProjectSync`, a etapa 1 limpa `dirty` e atualiza o estado local imediatamente; falhas na etapa 2 atualizam `snapshot` e reportam erro explícito preservando a persistência da etapa 1.
  - **Correção:** [`StudioView.tsx:551-649`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L551-L649) e [`StudioView.tsx:735-796`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L735-L796).
  - **Testes de Regressão:** [`sm4_sm5.test.tsx:554-660`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm4_sm5.test.tsx#L554-L660).
- **SM5-BUG-4 `[CORRIGIDO — VTECH-115]`:** Adicionada guarda de `dirty` com modal acessível `role="alertdialog"` (`Escape`, gerenciamento/restauração de foco, atalho noop quando clicando no item já selecionado), bloqueio completo da `StudioSidebar` (`disabled={saving}`) e fila `deferredNavigateDuringSaveRef` para `studio://navigate` recebido durante um save.
  - **Correção:** [`StudioView.tsx:146-178`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L146-L178), [`StudioView.tsx:320-387`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L320-L387), [`StudioView.tsx:833-940`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L833-L940), [`StudioView.tsx:1364-1421`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L1364-L1421) e [`StudioSidebar.tsx:347-554`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/components/studio/StudioSidebar.tsx#L347-L554).
  - **Testes de Regressão:** [`sm5_sm6.test.tsx:132-247`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm5_sm6.test.tsx#L132-L247) e [`sm5_sm6.test.tsx:249-363`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm5_sm6.test.tsx#L249-L363).

---

## SM-6: Tray/Popover macOS & Paridade do `MockIpcStore`

### Superfícies & Contratos
- **macOS Tray / Popover Blur Guard:** `TRAY_BLUR_DEBOUNCE` (250ms) + `PopoverBlurGuard` + `should_suppress_tray_reopen` ([`lib.rs:21-74`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L21-L74)).
- **Paridade `MockIpcStore` ↔ Backend Rust:** [`mock-data.ts:1107-1910`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1107-L1910) e [`SettingsOverridePreview`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/types/ipc.ts).

### Invariantes
- **I6.1:** Clicar no ícone da Menu Bar enquanto o Popover está aberto não pode reabrir a janela caso `WindowEvent::Focused(false)` tenha ocultado o Popover nos últimos `250ms` (`TRAY_BLUR_DEBOUNCE`); um segundo clique subsequente (após o guard ser consumido) reabre normalmente.
- **I6.2:** `MockIpcStore` espelha estritamente as validações, herança com `disabledRoles`, prune de `roles/*.md`, fallback global, remoção seletiva de squads e formato completo de `previewPresetSync` (incluindo `.t3code/preset.jsonc` como 1º arquivo e `newOverride = null` quando `enabled === false`).

### Bugs Catalogados e Resolvidos
- **SM6-BUG-1 `[CORRIGIDO — VTECH-115 & VTECH-118]`:** Alinhada paridade completa do `MockIpcStore` com o backend Rust: `getProjectPreset` segue `activeGlobalPresetId`; `setGlobalPresetConfig` / `applyPresetSync` / `saveGlobalPreset` / `saveProjectPreset` validam IDs e herança atomicamente antes de mutar; `setProjectPresetEnabled(false)` e `swapGlobalInstance` aplicam fallback global correto; `applyPresetSync` resolve `disabledRoles` e faz prune de `roles/*.md`; `previewPresetSync` inclui `.t3code/preset.jsonc` como 1º item de `files` e retorna `settingsPreview.newOverride = null` quando `enabled === false`.
  - **Correção:** [`mock-data.ts:1013-1910`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1013-L1910) (em especial `previewPresetSync` em [`mock-data.ts:1415-1525`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1415-L1525), `applyPresetSync` em [`mock-data.ts:1527-1624`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1527-L1624), `setGlobalPresetConfig` em [`mock-data.ts:1737-1756`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1737-L1756) e `setProjectPresetEnabled` em [`mock-data.ts:1832-1871`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1832-L1871)) + `SettingsOverridePreview.newOverride` tipado como `Record<string, unknown> | null` em [`ipc.ts`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/types/ipc.ts).
  - **Testes de Regressão:** [`sm2.test.tsx:184-261`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm2.test.tsx#L184-L261) e [`sm5_sm6.test.tsx:365-495`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/test/sm5_sm6.test.tsx#L365-L495).
- **SM6-BUG-2 `[CORRIGIDO — VTECH-115]`:** Introduzido `PopoverBlurGuard` com janela `TRAY_BLUR_DEBOUNCE` (250ms): `WindowEvent::Focused(false)` registra o instante de ocultação ao fechar por perda de foco; `toggle_popover_window_internal` com `from_tray_click = true` consome e suprime a reabertura espúria dentro da janela de debounce, sendo limpo em fechamentos explícitos ou abertura do Studio.
  - **Correção:** [`lib.rs:21-74`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L21-L74), [`lib.rs:233-235`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L233-L235), [`lib.rs:287-319`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L287-L319) e [`lib.rs:358-397`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L358-L397).
  - **Testes de Regressão:** [`lib.rs:437-511`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L437-L511).

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
