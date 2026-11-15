# State Machines, Invariants & Confirmed Invalid Transitions (`oh-my-t3code`)

Este documento cataloga **todas as máquinas de estado explícitas e implícitas** do aplicativo `oh-my-t3code` (backend Rust/Tauri v2 + frontend React 19/TypeScript + Mock IPC + ciclo de janelas macOS), suas invariantes, tabelas de transição e os **estados/transições inválidos alcançáveis** comprovados no código — incluindo cenários de **retentativas (retries)** e **concorrência**.

---

## Sumário das Máquinas de Estado

| ID | Máquina de Estado | Camada | Arquivos Principais |
| :--- | :--- | :--- | :--- |
| **SM-1** | Configuração Global & Sync de `settings.json` | Rust + UI | `models.rs`, `preset_engine.rs`, `compiler.rs`, `settings_sync.rs`, `t3_reader.rs` |
| **SM-2** | Override por Projeto & Squad Compilada | Rust + Disk | `preset_engine.rs`, `compiler.rs`, `settings_sync.rs`, `t3_reader.rs`, `importer.rs` |
| **SM-3** | Persistência Atômica & RMW Concorrente | Rust I/O | `preset_engine.rs` (`atomic_write_file`), `settings_sync.rs`, `compiler.rs` |
| **SM-4** | Ações Assíncronas & Seleção no Menu Bar Popover | React UI | `src/views/PopoverView.tsx` |
| **SM-5** | Seleção, Navegação, Rascunho (`dirty`) & Save no Preset Studio | React UI + IPC | `src/views/StudioView.tsx`, `src/components/studio/StudioSidebar.tsx`, `src-tauri/src/lib.rs` |
| **SM-6** | Ciclo de Janelas macOS Tray/Popover & Paridade do Mock IPC | Tauri + Mock | `src-tauri/src/lib.rs`, `src/lib/mock-data.ts` |

---

## SM-1: Configuração Global & Sync de `settings.json`

### Superfícies de Estado
1. `~/.config/oh-my-t3code/config.jsonc` → `GlobalAppConfig { activeGlobalPresetId: string, enabled: bool }` ([`models.rs:89-94`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/models.rs#L89-L94)).
2. `~/.config/oh-my-t3code/presets/<id>.jsonc` → `PresetConfig { id, enabled, orchestrator, fallbackChain, ... }` ([`models.rs:185-204`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/models.rs#L185-L204)).
3. `~/.t3/userdata/settings.json` → `defaultModelSelection`, `fallbackModelSelection` ([`settings_sync.rs:240-286`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L240-L286)).

### Estados
- `Uninitialized`: `config.jsonc` e/ou `presets/*.jsonc` ainda não existem; `load_global_config` retorna `GlobalAppConfig::default()` (`"default"`, `enabled: true`).
- `GlobalActive(presetId)`: `config.enabled == true` e `settings.json` (`defaultModelSelection`, `fallbackModelSelection`) reflete o orquestrador e `fallbackChain[0]` de `presetId`.
- `GlobalPaused(presetId)`: `config.enabled == false`; projetos sem override seguem a configuração nativa do T3 Code (sem override global injetado por nós).
- `MissingOrInvalidPreset(presetId)`: `config.activeGlobalPresetId` aponta para um ID ausente/inválido no diretório de presets.

### Invariantes
- **I1.1:** Em `GlobalActive(id)`, `settings.json.defaultModelSelection` e `settings.json.fallbackModelSelection` DEVEM corresponder exatamente a `presets/<id>.jsonc` (`orchestrator` e `fallbackChain[0]`).
- **I1.2:** Em `GlobalPaused(id)`, `oh-my-t3code` NÃO pode deixar um preset global desativado atuando em `settings.json` nem mutar silenciosamente a instância global deixando `settings.json` dessincronizado com a UI.
- **I1.3:** O estado `enabled` do preset ativo global em `config.jsonc` e o estado `draftPreset.enabled` exibido no Studio não devem divergir após salvar.
- **I1.4:** Todo projeto sem override local deve resolver para `config.activeGlobalPresetId` independentemente do `active_instance_hint` (`codex` vs `antigravity`).

### Tabela de Transições
| Origem | Gatilho / Comando | Guarda | Ações / Efeitos | Destino |
| :--- | :--- | :--- | :--- | :--- |
| `Uninitialized` | `ensure_seed_presets` | `!config.jsonc.exists()` | Grava 4 presets (`default`, `agy-dual`, `codex-squad`, `hybrid-agy-codex`) + `config.jsonc` (`"default"`, `true`) | `GlobalActive("default")` |
| `GlobalActive(A)` | `set_global_preset_config(B, true)` | `B` válido e existe | Atualiza `config.jsonc` + `sync_global_settings(B)` | `GlobalActive(B)` |
| `GlobalActive(A)` | `set_global_preset_config(A, false)` | — | Atualiza `config.jsonc` (`enabled=false`); **BUG SM1-1: não remove/restaura `settings.json`** | `GlobalPaused(A)` *(estado inconsistente com `settings.json`)* |
| `GlobalActive(A)` | `swap_global_instance()` | `A` é `codex` ou `antigravity*` | Alterna instância/modelo em `presets/A.jsonc` + `sync_global_settings` | `GlobalActive(A)` |
| `GlobalPaused(A)` | `swap_global_instance()` | Nenhum bloqueio na UI/backend! | **BUG SM1-1: muta `presets/A.jsonc` sem atualizar `settings.json`** | `GlobalPaused(A)` *(drift UI vs T3)* |
| `GlobalActive(A)` | Studio `handleSaveGlobalPreset` em `A` | `selection.presetId == A` | **BUG SM1-2: salva `presets/A.jsonc` sem chamar `sync_global_settings`** | `GlobalActive(A)` *(settings.json desatualizado)* |

### Estados / Transições Inválidos Alcançáveis (Com Evidência)
- **SM1-BUG-1 (Impacto Alto):** Pausar o Preset Global (`enabled: false`) mantém `defaultModelSelection` e `fallbackModelSelection` ativos em `settings.json`, enquanto a UI afirma o contrário; além disso, o botão **Swap Global** permanece habilitado quando `enabled == false`.
  - **Evidência:** [`compiler.rs:527-547`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L527-L547) (`set_global_preset_config` só sincroniza `if enabled`, nunca limpa/restaura `settings.json` ao desativar — comportamento inclusive fixado no teste [`compiler.rs:885-895`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L885-L895)); [`PopoverView.tsx:628`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L628) exibe `"Desativado — projetos sem override usam config padrão do T3 Code"`; [`PopoverView.tsx:666`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L666) não desabilita o botão Swap quando `!snapshot.globalConfig.enabled`.
- **SM1-BUG-2 (Impacto Alto):** Editar e salvar o preset ativo global no Studio não sincroniza `settings.json`, e alternar seu status no Studio não persiste `enabled` em `presets/<id>.jsonc`.
  - **Evidência:** [`StudioView.tsx:270-286`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L270-L286) (`handleSaveGlobalPreset`) chama apenas `save_global_preset`; [`StudioView.tsx:288-314`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L288-L314) (`handleToggleGlobalPresetStatus`) chama `set_global_preset_config` sem salvar `presets/<id>.jsonc`.
- **SM1-BUG-3 (Impacto Médio):** `get_project_preset` força `"codex-squad"` para projetos sem override local cujo `settings.json` tenha `instanceId == "codex"`, ignorando `global_config.active_global_preset_id` (inclusive `"default"`).
  - **Evidência:** [`preset_engine.rs:1490-1495`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L1490-L1495) e [`mock-data.ts:1109-1117`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1109-L1117), divergindo de `build_dashboard_snapshot` em [`t3_reader.rs:852-858`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/t3_reader.rs#L852-L858).

---

## SM-2: Override por Projeto & Squad Compilada

### Superfícies de Estado
1. `<workspace>/.t3code/preset.jsonc` (`has_local_preset`, `enabled`, `id`, `extends`, `roles`).
2. `<workspace>/.agents/skills/<slug>-squad/{SKILL.md, roles/*.md}` (`detected_squad`).
3. `~/.t3/userdata/settings.json` → `projectSettingsOverrides[projectId].defaultModelSelection`.
4. Derivado no snapshot: `has_custom_override` ([`t3_reader.rs:352-423`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/t3_reader.rs#L352-L423)).

### Estados
- `FollowingGlobal`: sem `.t3code/preset.jsonc`, sem `projectSettingsOverrides[id]` divergente, sem squad manual externo; `has_custom_override == false`.
- `ExternalSquadDetected`: existe `.agents/skills/*-squad/SKILL.md` sem cabeçalho do compilador e sem `.t3code/preset.jsonc`; `has_custom_override == true`.
- `ActiveOverride`: `.t3code/preset.jsonc` (`enabled: true`) + `.agents/skills/<slug>-squad/` compilada + `projectSettingsOverrides[id]` sincronizado em `settings.json`.
- `PausedOverride`: `.t3code/preset.jsonc` (`enabled: false`) + `projectSettingsOverrides[id]` ausente em `settings.json`; `has_custom_override == true` (permanece visível para reativação).

### Invariantes
- **I2.1:** Em `PausedOverride` (`enabled == false`), `projectSettingsOverrides[projectId]` NÃO pode existir em `settings.json`.
- **I2.2:** Em `ActiveOverride`, os arquivos em `.agents/skills/<slug>-squad/roles/*.md` devem ser exatamente o conjunto `resolved.roles.keys()` — sem arquivos órfãos de papéis removidos.
- **I2.3:** Ao executar `remove_project_override` (transição para `FollowingGlobal`), nenhum artefato gerado pelo compilador (`SKILL.md` / `roles/*.md` com assinatura do compilador) pode continuar ativo no workspace causando uso de squad fantasma.
- **I2.4:** Remover um papel em um preset derivado (`extends != null`) deve persistir após salvar e recarregar.

### Tabela de Transições
| Origem | Gatilho / Comando | Guarda | Ações / Efeitos | Destino |
| :--- | :--- | :--- | :--- | :--- |
| `FollowingGlobal` / `ExternalSquadDetected` | `apply_preset_to_project` / `import_existing_squad` | `enabled == true` | Grava `.t3code/preset.jsonc`, compila `SKILL.md` + `roles/*.md`, grava `settings.json` | `ActiveOverride` |
| `ActiveOverride` | `set_project_preset_enabled(false)` | — | Salva `enabled: false` em `.t3code/preset.jsonc`, remove `projectSettingsOverrides[id]` | `PausedOverride` |
| `PausedOverride` | `set_project_preset_enabled(true)` | — | Salva `enabled: true`, compila squad, grava `projectSettingsOverrides[id]` | `ActiveOverride` |
| `PausedOverride` | `swap_project_primary_instance()` | Nenhum bloqueio! | **BUG SM2-1: chama `apply_preset_to_project` com `enabled: false` e reescreve `settings.json`!** | *Estado inválido (`enabled=false` + override em `settings.json`)* |
| `ActiveOverride` | `apply_preset_to_project` após remover papel | Papel `X` removido | **BUG SM2-2: deixa `roles/X.md` órfão em `.agents/skills/`** | `ActiveOverride` *(roles órfãos)* |
| `ActiveOverride` / `PausedOverride` | `remove_project_override()` | — | Remove `.t3code/preset.jsonc` e `settings.json`; **BUG SM2-3: deixa `.agents/skills/<slug>-squad/` compilada no disco** | `FollowingGlobal` *(squad fantasma no disco)* |
| Qualquer com `extends != null` | Studio `handleDeleteRole` + Save | `preset.extends != null` | **BUG SM2-4: `merge_patch` copia `base.roles` e ressuscita papel deletado** | *Papel removido retorna* |

### Estados / Transições Inválidos Alcançáveis (Com Evidência)
- **SM2-BUG-1 (Impacto Alto):** `swap_project_primary_instance` em projeto pausado grava `projectSettingsOverrides[projectId]` em `settings.json` mantendo `"enabled": false` em `.t3code/preset.jsonc`, e o botão Swap no Popover não é desabilitado quando `!project.presetEnabled`.
  - **Evidência:** [`PopoverView.tsx:972-1006`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L972-L1006), [`compiler.rs:474-522`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L474-L522), e [`compiler.rs:433-434`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L433-L434) (que aplica `sync_project_settings` sem verificar `resolved.enabled`).
- **SM2-BUG-2 (Impacto Alto):** `apply_preset_to_project` não limpa arquivos `roles/*.md` órfãos quando papéis são removidos ou quando o preset troca para um com menos papéis, além de gravar `settings.json` mesmo se `target_preset.enabled == false`.
  - **Evidência:** [`compiler.rs:368-377`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L368-L377) e [`compiler.rs:425-434`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L425-L434).
- **SM2-BUG-3 (Impacto Alto):** `remove_project_override` remove `.t3code/preset.jsonc` e `projectSettingsOverrides[project_id]`, mas deixa `.agents/skills/<slug>-squad/SKILL.md` e `roles/*.md` compilados ativos no repositório.
  - **Evidência:** [`compiler.rs:669-698`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L669-L698) vs detecção da assinatura `"— Playbook do Orquestrador (T3 Code)"` em [`t3_reader.rs:397`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/t3_reader.rs#L397).
- **SM2-BUG-4 (Impacto Médio):** Excluir um papel de um preset que possui `extends` no Studio faz o papel reaparecer após salvar e resolver a herança.
  - **Evidência:** [`RolesMatrixTab.tsx:95-101`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/components/studio/RolesMatrixTab.tsx#L95-L101), [`preset_engine.rs:294-329`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L294-L329) (`merge_patch` nunca remove chaves herdadas de `base.roles`), e [`preset_engine.rs:1410`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L1410).

---

## SM-3: Persistência Atômica & RMW Concorrente (Backend Rust)

### Superfícies de Estado
- Helper [`atomic_write_file`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L456-L476)
- Ciclos Read-Modify-Write (RMW) em `settings.json`, `settings.json.bak`, `config.jsonc`, `presets/*.jsonc`, `.t3code/preset.jsonc`.

### Invariantes
- **I3.1:** Cada chamada a `atomic_write_file` deve usar um arquivo temporário exclusivo (sem colisão entre threads do mesmo processo).
- **I3.2:** Operações RMW em arquivos compartilhados (`settings.json`, `config.jsonc`, `presets/*.jsonc`) devem ser serializadas por lock para impedir *lost updates* e corrupção do backup `.bak`.

### Estados / Transições Inválidos Alcançáveis (Com Evidência)
- **SM3-BUG-1 (Impacto Crítico):** Colisão determinística de nome de arquivo temporário em `atomic_write_file` sob comandos IPC concorrentes.
  - **Evidência:** [`preset_engine.rs:466`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/preset_engine.rs#L466):
    ```rust
    let tmp_path = parent.join(format!(".{file_name}.tmp.{}", std::process::id()));
    ```
    Todos os comandos Tauri executam no mesmo processo (`std::process::id()` constante) em múltiplas threads do pool async. Duas chamadas simultâneas gravando `settings.json` ou `settings.json.bak` escrevem e truncam o mesmo `.tmp.<pid>` concorrentemente, gerando JSON corrompido ou falha `ENOENT` no `fs::rename`.
- **SM3-BUG-2 (Impacto Crítico):** Ciclos Read-Modify-Write sem lock em `settings.json`, `config.jsonc` e `presets/*.jsonc` causam perda silenciosa de atualizações (*lost updates*) e sobrescrita destrutiva de `settings.json.bak`.
  - **Evidência:** [`settings_sync.rs:177-236`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L177-L236), [`settings_sync.rs:240-286`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L240-L286), [`settings_sync.rs:289-332`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/settings_sync.rs#L289-L332) e [`compiler.rs:552-631`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/compiler.rs#L552-L631) (`swap_global_instance` concorrente lê a mesma instância inicial duas vezes e grava o mesmo valor duas vezes, anulando o segundo swap).

---

## SM-4: Ações Assíncronas & Seleção no Menu Bar Popover (`PopoverView.tsx`)

### Estados Implícitos
- `loading` / `refreshing` + `snapshot`
- `busyGlobalAction: "config" | "swap" | null`
- `busyProjectAction: Record<projectId, "sync" | "swap" | "toggle" | "remove">`
- `selectedPresets: Record<projectId, presetId>`
- `syncedProjectIds: Record<projectId, boolean>` + timers `setTimeout(..., 2600)`

### Invariantes
- **I4.1:** Nenhuma ação global (`config` ou `swap`) pode rodar em paralelo com outra ação global.
- **I4.2:** Respostas atrasadas de `loadSnapshot` nunca podem sobrescrever o estado de uma mutação mais recente.
- **I4.3:** `syncedProjectIds` e `selectedPresets` devem refletir a última operação concluída (sem timers órfãos de retentativas anteriores).

### Estados / Transições Inválidos Alcançáveis (Com Evidência)
- **SM4-BUG-1 (Impacto Alto):** Controles globais permitem concorrência entre `"swap"` e `"config"`, closures lêem `snapshot` obsoleto e `loadSnapshot` não tem controle de ordem (race out-of-order).
  - **Evidência:** [`PopoverView.tsx:634,650`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L634) (`disabled={busyGlobalAction === "config"}` permite clicar Toggle/Select durante `"swap"`); [`PopoverView.tsx:249,277`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L249) capturam `snapshot` do render; [`PopoverView.tsx:95-120`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L95-L120) sem `requestSeqRef`.
- **SM4-BUG-2 (Impacto Médio):** `selectedPresets[projectId]` permanece obsoleto após remoção/recriação ou edição no Studio, e `setTimeout` de `"Sincronizado!"` não cancela o timer anterior em retentativas.
  - **Evidência:** [`PopoverView.tsx:105-113`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L105-L113) (`if (!next[project.projectId])`); [`PopoverView.tsx:432-434`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/PopoverView.tsx#L432-L434) (timers não rastreados por `projectId` nem limpos no unmount).

---

## SM-5: Seleção, Navegação, Rascunho (`dirty`) & Save no Preset Studio (`StudioView.tsx`)

### Estados Implícitos
- `selection: { kind: "global", presetId } | { kind: "project", projectId } | null`
- `projectMeta`, `draftPreset`, `dirty`, `saving`, `activeTab`, `previewResult`, `previewLoading`
- Evento IPC `studio://navigate`

### Invariantes
- **I5.1:** Quando `selection.kind === "project"`, `projectMeta.projectId === selection.projectId` SEMPRE deve ser verdadeiro após o carregamento.
- **I5.2:** `previewResult.projectId` e `previewResult.presetId` devem corresponder à seleção e rascunho atuais.
- **I5.3:** Eventos `studio://navigate` devem navegar para o destino correto mesmo durante *cold-start* ou reabertura após alterações no Popover.
- **I5.4:** Em saves multi-etapa (`save_project_preset` → `apply_preset_sync`, ou `save_global_preset` → `set_global_preset_config`), falhas na etapa 2 não podem deixar `snapshot`/`projectMeta` dessincronizados do disco.

### Estados / Transições Inválidos Alcançáveis (Com Evidência)
- **SM5-BUG-1 (Impacto Alto):** Corrida *out-of-order* em `selectProject` e `runPreview` faz o editor exibir dados do Projeto A com cabeçalho/seleção apontando para o Projeto B.
  - **Evidência:** [`StudioView.tsx:117-136`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L117-L136) (`setSelection` antes de `await invokeIpc("get_project_preset")` sem token de sequência); [`StudioView.tsx:211-233`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L211-L233) (`runPreview` sem cancelamento/sequência).
- **SM5-BUG-2 (Impacto Alto):** Evento `studio://navigate` é descartado no *cold-start* (`!snapshotRef.current`) e lê `snapshotRef.current` obsoleto ao reabrir a janela Studio após mudanças feitas no Popover.
  - **Evidência:** [`StudioView.tsx:183-202`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L183-L202) (`if (!snap) return;`) e [`lib.rs:180-192`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L180-L192).
- **SM5-BUG-3 (Impacto Alto):** Falha parcial em `handleSaveProjectOverride`, `handleApplyProjectSync` ou `handleSetAsGlobalDefault` (etapa 1 grava em disco, etapa 2 falha) deixa `dirty: true`, `snapshot` e `projectMeta` dessincronizados da realidade no disco.
  - **Evidência:** [`StudioView.tsx:323-342`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L323-L342), [`StudioView.tsx:349-388`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L349-L388), [`StudioView.tsx:454-478`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L454-L478).
- **SM5-BUG-4 (Impacto Médio):** Navegar na sidebar ou via `studio://navigate` com `dirty === true` (ou enquanto `saving === true`) descarta edições não salvas silenciosamente sem guarda.
  - **Evidência:** [`StudioView.tsx:99-136`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/views/StudioView.tsx#L99-L136) e [`StudioSidebar.tsx:480`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/components/studio/StudioSidebar.tsx#L480).

---

## SM-6: Tray/Popover macOS & Paridade do `MockIpcStore`

### Estados / Transições Inválidos Alcançáveis (Com Evidência)
- **SM6-BUG-1 (Impacto Médio):** `MockIpcStore` possui transições divergentes do backend Rust (`setGlobalPresetConfig` aceita IDs inexistentes; `applyPresetSync` ignora herança `extends` e limpeza de roles; `setProjectPresetEnabled(false)` mantém `activeInstanceId`/`activeModel` do override ao invés de refletir o fallback global; `getProjectPreset` força `codex-squad`).
  - **Evidência:** [`mock-data.ts:1101-1130`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1101-L1130), [`mock-data.ts:1250-1304`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1250-L1304), [`mock-data.ts:1382-1388`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1382-L1388), [`mock-data.ts:1431-1463`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src/lib/mock-data.ts#L1431-L1463).
- **SM6-BUG-2 (Impacto Baixo):** Corrida `Focused(false)` vs `TrayIconEvent::Click` no Popover macOS: clicar no ícone da Menu Bar com o popover aberto dispara `Focused(false)` → `hide()` antes do `MouseButtonState::Up`, fazendo `is_visible()` retornar `false` e reabrindo o popover em vez de fechá-lo.
  - **Evidência:** [`lib.rs:235-242`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L235-L242), [`lib.rs:282-292`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L282-L292) e [`lib.rs:300-307`](file:///Users/alencarfreire/.t3/projects/oh-my-t3code/src-tauri/src/lib.rs#L300-L307).

---

## Backlog no Linear ([Oh My T3Code — Estabilização (State Machines)](https://linear.app/vtech-digital/project/oh-my-t3code-estabilizacao-state-machines-5279ee09da3c))

**Épico Pai:** [`VTECH-112`](https://linear.app/vtech-digital/issue/VTECH-112/epico-estabilizacao-das-maquinas-de-estado-concorrencia-e-retries-sm-1) — `[Épico] Estabilização das Máquinas de Estado, Concorrência e Retries (SM-1 a SM-6)`

| Prioridade | Issue | Título / Escopo | Bugs Cobertos | Frente | Bloqueada por |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P0 — Urgent** | [`VTECH-113`](https://linear.app/vtech-digital/issue/VTECH-113/sm-3-corrigir-colisao-de-arquivo-temporario-em-atomic_write_file-e) | Hardening de Concorrência & Escrita Atômica no Backend Rust | `SM3-BUG-1`, `SM3-BUG-2` | `rust-core` | — |
| **P1 — High** | [`VTECH-116`](https://linear.app/vtech-digital/issue/VTECH-116/sm-1-garantir-consistencia-entre-global-preset-settingsjson-e-studio) | Consistência entre Global Preset, `settings.json` e Studio | `SM1-BUG-1`, `SM1-BUG-2`, `SM1-BUG-3` | `rust-core` + `frontend-ui` | `VTECH-113` |
| **P1 — High** | [`VTECH-117`](https://linear.app/vtech-digital/issue/VTECH-117/sm-2-corrigir-swap-em-override-pausado-prune-de-rolesmd-limpeza-no) | Swap em override pausado, prune de `roles/*.md`, limpeza no remove e tombstone de herança | `SM2-BUG-1`, `SM2-BUG-2`, `SM2-BUG-3`, `SM2-BUG-4` | `rust-core` + `frontend-ui` | `VTECH-113` |
| **P1 — High** | [`VTECH-114`](https://linear.app/vtech-digital/issue/VTECH-114/sm-4sm-5-eliminar-race-conditions-out-of-order-drops-de-navegacao-e) | Race conditions *out-of-order*, drops de navegação e falhas parciais na UI | `SM4-BUG-1`, `SM4-BUG-2`, `SM5-BUG-1`, `SM5-BUG-2`, `SM5-BUG-3` | `frontend-ui` | — |
| **P2 — Medium** | [`VTECH-115`](https://linear.app/vtech-digital/issue/VTECH-115/sm-5sm-6-guarda-de-dirty-state-paridade-do-mockipcstore-e-corrida) | Guarda de `dirty` state, paridade do `MockIpcStore` e corrida Tray/Blur no macOS | `SM5-BUG-4`, `SM6-BUG-1`, `SM6-BUG-2` | `rust-core` + `frontend-ui` | — |
| **P1 — High** | [`VTECH-118`](https://linear.app/vtech-digital/issue/VTECH-118/qa-suite-de-testes-de-regressao-concorrenteretries-e-atualizacao-de) | Suíte de testes de regressão concorrente/retries e atualização final de `docs/STATE_MACHINES.md` | Todos (`SM1`–`SM6`) | `qa-reviewer` | `VTECH-113`..`VTECH-117` |
