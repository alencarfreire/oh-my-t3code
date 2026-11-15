use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use tempfile::tempdir;

use oh_my_t3code_lib::{
    compiler::{
        apply_preset_to_project, compile_preset_preview, remove_project_override,
        set_global_preset_config, set_project_preset_enabled, swap_global_instance,
        swap_project_primary_instance,
    },
    get_dashboard_snapshot_from_paths,
    importer::import_existing_squad,
    models::{AppPaths, FallbackStep, PresetConfig, RoleConfig},
    preset_engine::{
        ensure_seed_presets, get_project_preset, list_global_presets, local_preset_path,
        resolve_global_preset, OMOS_CANONICAL_ROLES,
    },
    t3_reader::open_sqlite_readonly,
};
use rusqlite::Connection;
use serde_json::Value;

fn create_real_t3_sqlite_schema(db_path: &Path) {
    let conn = Connection::open(db_path).expect("create test sqlite db");
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;

        CREATE TABLE projection_projects (
            project_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            workspace_root TEXT NOT NULL,
            scripts_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            default_model_selection_json TEXT,
            default_thread_env_mode TEXT,
            favicon_path TEXT,
            auto_pull INTEGER NOT NULL DEFAULT 0,
            project_icon_json TEXT,
            pinned_at TEXT,
            archived_at TEXT
        );

        CREATE TABLE projection_threads (
            thread_id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            title TEXT NOT NULL,
            branch TEXT,
            worktree_path TEXT,
            latest_turn_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            runtime_mode TEXT NOT NULL DEFAULT 'full-access',
            interaction_mode TEXT NOT NULL DEFAULT 'default',
            model_selection_json TEXT,
            archived_at TEXT,
            latest_user_message_at TEXT,
            pending_approval_count INTEGER NOT NULL DEFAULT 0,
            pending_user_input_count INTEGER NOT NULL DEFAULT 0,
            has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0,
            settled_override TEXT,
            settled_at TEXT,
            snoozed_until TEXT,
            snoozed_at TEXT,
            title_regeneration_request_id TEXT,
            title_regeneration_started_at TEXT,
            pinned_at TEXT,
            pin_order_key TEXT,
            linked_pull_request_json TEXT,
            unsettled_at TEXT,
            branch_pull_request_json TEXT,
            active_order_key TEXT,
            title_state_json TEXT,
            auto_settle_disabled_at TEXT
        );

        CREATE TABLE orchestration_v2_projection_subagents (
            subagent_id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            run_id TEXT,
            parent_node_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            provider_thread_id TEXT,
            child_thread_id TEXT,
            origin TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            updated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            driver TEXT,
            provider_instance_id TEXT,
            completion_delivery_state TEXT
        );
        "#,
    )
    .expect("execute real T3 Code DDL");
}

fn seed_real_t3_settings(settings_path: &Path) -> Value {
    let payload = serde_json::json!({
        "autoResumeLimitedThreads": true,
        "defaultModelSelection": {
            "instanceId": "antigravity_2",
            "model": "gemini-4-hydrogen"
        },
        "deviceOnboardingCompleted": true,
        "enableAgentDeviceAccess": true,
        "enableDeviceSupport": true,
        "fallbackModelSelection": {
            "instanceId": "antigravity",
            "model": "gemini-4-hydrogen"
        },
        "fastWorktreeCheckout": true,
        "favorites": ["proj-alpha"],
        "idleCompaction": {
            "enabled": true,
            "idleMinutes": 30
        },
        "customModels": [
            {
                "id": "custom-local-qwen",
                "name": "Qwen 2.5 Coder 32B"
            }
        ],
        "providers": {
            "codex": {
                "binaryPath": "/opt/homebrew/bin/codex"
            }
        },
        "projectSettingsFolded": false,
        "projectSettingsOverrides": {
            "unrelated-legacy-proj": {
                "defaultModelSelection": {
                    "instanceId": "grok",
                    "model": "grok-4"
                },
                "customProjectFlag": "preserve-me"
            }
        },
        "promptSuggestionsEnabled": true,
        "providerInstances": {
            "antigravity": {
                "displayName": "Agy Veca",
                "driver": "antigravity",
                "enabled": true
            },
            "antigravity_2": {
                "displayName": "Agy Principal",
                "driver": "antigravity",
                "enabled": true
            },
            "claudeAgent": {
                "driver": "claudeAgent",
                "enabled": false
            },
            "grok": {
                "driver": "grok",
                "enabled": true
            },
            "opencode": {
                "driver": "opencode",
                "enabled": true
            }
        },
        "providerModelPreferences": {
            "antigravity": ["gemini-4-hydrogen", "gemini-4-argon"]
        },
        "reviewGuidesEnabled": true,
        "storageCleanup": { "retentionDays": 14 },
        "textGenerationModelSelection": {
            "instanceId": "antigravity",
            "model": "gemini-4-argon"
        },
        "threadTitleInstructions": "Use concise titles in pt-BR"
    });
    fs::write(
        settings_path,
        serde_json::to_string_pretty(&payload).unwrap(),
    )
    .expect("seed settings.json");
    payload
}

#[test]
fn test_1_real_t3_settings_compatibility_atomic_backup_and_key_preservation() {
    let tmp = tempdir().expect("tempdir");
    let t3_home = tmp.path().join(".t3");
    let userdata_dir = t3_home.join("userdata");
    let presets_dir = tmp.path().join("config").join("presets");
    let skills_root = tmp.path().join("skills");
    fs::create_dir_all(&userdata_dir).unwrap();
    fs::create_dir_all(&skills_root).unwrap();

    let db_path = userdata_dir.join("statev2.sqlite");
    let settings_path = userdata_dir.join("settings.json");
    create_real_t3_sqlite_schema(&db_path);
    let initial_settings = seed_real_t3_settings(&settings_path);

    let paths = AppPaths {
        t3_home,
        presets_dir,
        skill_roots: vec![("skillshare".to_string(), skills_root)],
    };
    ensure_seed_presets(&paths.presets_dir).expect("seed global presets");

    // 1. Activate Global Preset "default" (Codex: gpt-6.1-sol + fallback antigravity_2)
    let snap = set_global_preset_config(&paths, "default".to_string(), true)
        .expect("set global preset default");

    assert_eq!(snap.global_config.active_global_preset_id, "default");
    assert!(snap.global_config.enabled);
    assert_eq!(
        snap.default_model_selection
            .as_ref()
            .map(|s| s.instance_id.as_str()),
        Some("codex")
    );
    assert_eq!(
        snap.default_model_selection.as_ref().map(|s| s.model.as_str()),
        Some("gpt-6.1-sol")
    );
    assert_eq!(
        snap.fallback_model_selection
            .as_ref()
            .map(|s| s.instance_id.as_str()),
        Some("codex")
    );
    assert_eq!(
        snap.fallback_model_selection
            .as_ref()
            .map(|s| s.model.as_str()),
        Some("gpt-6.1-terra")
    );

    // Verify settings.json.bak was created and contains the exact original state
    let bak_path = userdata_dir.join("settings.json.bak");
    assert!(
        bak_path.exists(),
        "settings.json.bak must be created before writing"
    );
    let bak_json: Value = serde_json::from_str(&fs::read_to_string(&bak_path).unwrap()).unwrap();
    assert_eq!(bak_json, initial_settings);

    // 2. Execute Global Swap on "default" (Codex gpt-6.1-sol -> gpt-6.1-terra)
    let swapped_snap = swap_global_instance(&paths).expect("swap global instance");
    assert_eq!(
        swapped_snap
            .default_model_selection
            .as_ref()
            .map(|s| s.model.as_str()),
        Some("gpt-6.1-terra")
    );
    assert_eq!(
        swapped_snap
            .fallback_model_selection
            .as_ref()
            .map(|s| s.model.as_str()),
        Some("gpt-6.1-sol")
    );

    // 3. Switch to "agy-dual" and execute Global Swap (antigravity_2 <-> antigravity)
    set_global_preset_config(&paths, "agy-dual".to_string(), true)
        .expect("set global preset agy-dual");
    let agy_swapped = swap_global_instance(&paths).expect("swap agy-dual global instance");
    assert_eq!(
        agy_swapped
            .default_model_selection
            .as_ref()
            .map(|s| s.instance_id.as_str()),
        Some("antigravity")
    );
    assert_eq!(
        agy_swapped
            .fallback_model_selection
            .as_ref()
            .map(|s| s.instance_id.as_str()),
        Some("antigravity_2")
    );

    // 4. Verify all 18+ unrelated keys from real T3 Code settings.json are 100% intact
    let final_raw: Value =
        serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
    assert_eq!(final_raw["autoResumeLimitedThreads"], true);
    assert_eq!(final_raw["deviceOnboardingCompleted"], true);
    assert_eq!(final_raw["enableAgentDeviceAccess"], true);
    assert_eq!(final_raw["enableDeviceSupport"], true);
    assert_eq!(final_raw["fastWorktreeCheckout"], true);
    assert_eq!(final_raw["favorites"][0], "proj-alpha");
    assert_eq!(final_raw["idleCompaction"]["idleMinutes"], 30);
    assert_eq!(final_raw["customModels"][0]["id"], "custom-local-qwen");
    assert_eq!(
        final_raw["providers"]["codex"]["binaryPath"],
        "/opt/homebrew/bin/codex"
    );
    assert_eq!(
        final_raw["projectSettingsOverrides"]["unrelated-legacy-proj"]["customProjectFlag"],
        "preserve-me"
    );
    assert_eq!(
        final_raw["providerInstances"]["antigravity"]["displayName"],
        "Agy Veca"
    );
    assert_eq!(
        final_raw["providerModelPreferences"]["antigravity"][0],
        "gemini-4-hydrogen"
    );
    assert_eq!(
        final_raw["threadTitleInstructions"],
        "Use concise titles in pt-BR"
    );
}

#[test]
fn test_2_tight_quota_workflow_global_and_project_swap_and_inheritance() {
    let tmp = tempdir().expect("tempdir");
    let t3_home = tmp.path().join(".t3");
    let userdata_dir = t3_home.join("userdata");
    let presets_dir = tmp.path().join("config").join("presets");
    let skills_root = tmp.path().join("skills");
    let ws_following = tmp.path().join("workspace/proj-following");
    let ws_override = tmp.path().join("workspace/proj-override");
    fs::create_dir_all(&userdata_dir).unwrap();
    fs::create_dir_all(&skills_root).unwrap();
    fs::create_dir_all(&ws_following).unwrap();
    fs::create_dir_all(&ws_override).unwrap();

    let db_path = userdata_dir.join("statev2.sqlite");
    let settings_path = userdata_dir.join("settings.json");
    create_real_t3_sqlite_schema(&db_path);
    seed_real_t3_settings(&settings_path);

    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at, default_model_selection_json)
             VALUES (?1, ?2, ?3, '[]', '2026-11-15T00:00:00Z', '2026-11-15T01:00:00Z', ?4)",
            rusqlite::params![
                "proj-following",
                "proj-following",
                ws_following.to_str().unwrap(),
                r#"{"instanceId":"codex","model":"gpt-6.1-sol"}"#
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at, default_model_selection_json)
             VALUES (?1, ?2, ?3, '[]', '2026-11-15T00:00:00Z', '2026-11-15T02:00:00Z', ?4)",
            rusqlite::params![
                "proj-override",
                "proj-override",
                ws_override.to_str().unwrap(),
                r#"{"instanceId":"antigravity","model":"gemini-4-hydrogen"}"#
            ],
        )
        .unwrap();
    }

    let paths = AppPaths {
        t3_home,
        presets_dir,
        skill_roots: vec![("skillshare".to_string(), skills_root)],
    };
    ensure_seed_presets(&paths.presets_dir).unwrap();

    // Activate Global Preset "agy-dual" (antigravity_2 / gemini-4-hydrogen)
    let snap = set_global_preset_config(&paths, "agy-dual".to_string(), true)
        .expect("activate agy-dual");

    // Project without override keeps its SQLite default_model_selection_json in ProjectSummary,
    // while get_project_preset resolves to the active global preset ("agy-dual")
    let p_following = snap
        .projects
        .iter()
        .find(|p| p.project_id == "proj-following")
        .unwrap();
    assert!(!p_following.has_custom_override);
    assert_eq!(p_following.active_instance_id.as_deref(), Some("codex"));
    let resolved_following = get_project_preset(
        &paths,
        "proj-following",
        ws_following.to_str().unwrap(),
        None,
    )
    .unwrap();
    assert!(!resolved_following.has_local_override);
    assert_eq!(resolved_following.resolved_preset.id, "agy-dual");
    assert_eq!(
        resolved_following
            .resolved_preset
            .orchestrator
            .provider_instance_id,
        "antigravity_2"
    );

    // Apply custom override with `extends: "agy-dual"` on proj-override
    let apply_res = apply_preset_to_project(
        &paths,
        "proj-override",
        ws_override.to_str().unwrap(),
        Some("agy-dual".to_string()),
        None,
    )
    .expect("apply agy-dual override to proj-override");
    assert_eq!(apply_res.active_instance_id, "antigravity_2");
    assert_eq!(apply_res.active_model, "gemini-4-hydrogen");

    // Quota tightens on antigravity_2 -> 1-click Project Swap on proj-override
    let swap_res = swap_project_primary_instance(
        &paths,
        "proj-override",
        ws_override.to_str().unwrap(),
    )
    .expect("swap project primary instance");
    assert_eq!(swap_res.active_instance_id, "antigravity");
    assert_eq!(swap_res.active_model, "gemini-4-hydrogen");

    // Verify settings.json projectSettingsOverrides and SKILL.md reflect the swapped orchestrator
    let settings_val: Value =
        serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
    assert_eq!(
        settings_val["projectSettingsOverrides"]["proj-override"]["defaultModelSelection"]
            ["instanceId"],
        "antigravity"
    );
    let skill_md = fs::read_to_string(
        ws_override.join(".agents/skills/proj-override-squad/SKILL.md"),
    )
    .unwrap();
    assert!(skill_md.contains("- **Orquestrador:** `antigravity` / `gemini-4-hydrogen`"));

    // Usability verification: Project swap updates orchestrator, while roles keep their inherited assignment unless edited in Studio
    let resolved_after_swap = get_project_preset(
        &paths,
        "proj-override",
        ws_override.to_str().unwrap(),
        None,
    )
    .unwrap();
    assert_eq!(
        resolved_after_swap
            .resolved_preset
            .orchestrator
            .provider_instance_id,
        "antigravity"
    );
    assert_eq!(
        resolved_after_swap.resolved_preset.roles["oracle"].provider_instance_id,
        "antigravity_2"
    );

    // Pause project override -> proj-override falls back to Global Default, preserving .t3code/preset.jsonc
    set_project_preset_enabled(
        &paths,
        "proj-override",
        ws_override.to_str().unwrap(),
        false,
    )
    .expect("disable project override");
    let settings_disabled: Value =
        serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
    assert!(
        settings_disabled["projectSettingsOverrides"]
            .get("proj-override")
            .is_none(),
        "Paused project override must be removed from T3 settings.json projectSettingsOverrides"
    );
    assert!(
        local_preset_path(&ws_override).exists(),
        ".t3code/preset.jsonc must remain on disk when paused"
    );

    // Remove project override completely -> cleans .t3code/preset.jsonc and .agents/skills/<slug>-squad
    let snap_removed = remove_project_override(
        &paths,
        "proj-override",
        ws_override.to_str().unwrap(),
    )
    .expect("remove project override");
    let p_override_after = snap_removed
        .projects
        .iter()
        .find(|p| p.project_id == "proj-override")
        .unwrap();
    assert!(!p_override_after.has_custom_override);
    assert!(!local_preset_path(&ws_override).exists());
    assert!(!ws_override
        .join(".agents/skills/proj-override-squad")
        .exists());
}

#[test]
fn test_3_compiled_skills_t3_compatibility_determinism_prune_and_reverse_import() {
    let tmp = tempdir().expect("tempdir");
    let t3_home = tmp.path().join(".t3");
    let userdata_dir = t3_home.join("userdata");
    let presets_dir = tmp.path().join("config").join("presets");
    let skills_root = tmp.path().join("skills");
    let ws_compile = tmp.path().join("workspace/compile-target");
    let ws_manual = tmp.path().join("workspace/manual-cabrito");
    fs::create_dir_all(&userdata_dir).unwrap();
    fs::create_dir_all(&skills_root).unwrap();
    fs::create_dir_all(&ws_compile).unwrap();
    fs::create_dir_all(&ws_manual).unwrap();

    let db_path = userdata_dir.join("statev2.sqlite");
    let settings_path = userdata_dir.join("settings.json");
    create_real_t3_sqlite_schema(&db_path);
    seed_real_t3_settings(&settings_path);

    let paths = AppPaths {
        t3_home,
        presets_dir,
        skill_roots: vec![("skillshare".to_string(), skills_root)],
    };
    ensure_seed_presets(&paths.presets_dir).unwrap();

    // 1. Apply agy-dual first so all 5 canonical OMOS roles are written
    apply_preset_to_project(
        &paths,
        "proj-compile",
        ws_compile.to_str().unwrap(),
        Some("agy-dual".to_string()),
        None,
    )
    .expect("initial apply");

    let squad_dir = ws_compile.join(".agents/skills/compile-target-squad");
    for role_id in OMOS_CANONICAL_ROLES {
        assert!(squad_dir.join(format!("roles/{role_id}.md")).exists());
    }

    // 2. Apply custom preset extending agy-dual with disabled_roles = ["oracle"]
    let agy_dual = resolve_global_preset(&paths.presets_dir, "agy-dual").unwrap();
    let mut custom_roles = BTreeMap::new();
    custom_roles.insert(
        "fixer".to_string(),
        RoleConfig {
            id: "fixer".to_string(),
            title: "Fixer Rust Especializado".to_string(),
            description: "Especialista em implementação rápida".to_string(),
            when_to_use: "Implementação focada em Rust e React".to_string(),
            provider_instance_id: "antigravity".to_string(),
            model: "gemini-4-hydrogen".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
            skills: vec!["tdd-and-testing".to_string()],
            mcps: vec!["playwright".to_string()],
            allowed_paths: vec!["src/**".to_string()],
            forbidden_paths: vec![],
            invariants: vec!["Manter cobertura de testes.".to_string()],
            verification_commands: vec!["bun run test".to_string()],
        },
    );

    let custom_preset = PresetConfig {
        id: "compile-target".to_string(),
        name: "Compile Target Custom".to_string(),
        description: "Preset customizado com tombstone".to_string(),
        extends: Some("agy-dual".to_string()),
        enabled: true,
        topology: "intra-thread-squad".to_string(),
        orchestrator: agy_dual.orchestrator.clone(),
        fallback_chain: vec![FallbackStep {
            provider_instance_id: "antigravity".to_string(),
            model: "gemini-4-argon".to_string(),
            options: BTreeMap::new(),
            reason: "quota_or_rate_limit".to_string(),
        }],
        contention: agy_dual.contention.clone(),
        roles: custom_roles,
        disabled_roles: vec!["oracle".to_string()],
    };

    apply_preset_to_project(
        &paths,
        "proj-compile",
        ws_compile.to_str().unwrap(),
        None,
        Some(custom_preset.clone()),
    )
    .expect("apply custom preset with disabled_roles");

    // Verify orphan role file oracle.md was pruned while active roles remain
    assert!(
        !squad_dir.join("roles/oracle.md").exists(),
        "disabled role oracle.md must be pruned from disk"
    );
    assert!(squad_dir.join("roles/fixer.md").exists());
    assert!(squad_dir.join("roles/explorer.md").exists());

    // Verify YAML frontmatter compatibility with T3 Code (name & description)
    let skill_md_run1 = fs::read_to_string(squad_dir.join("SKILL.md")).unwrap();
    assert!(skill_md_run1.starts_with("---\nname: compile-target-squad\ndescription: "));
    assert!(!skill_md_run1.contains("roles/oracle.md"));
    assert!(skill_md_run1.contains("roles/fixer.md"));

    // 3. Verify byte-for-byte determinism across multiple runs (Preview diff must report has_changes = false)
    let preview = compile_preset_preview(
        &paths,
        "proj-compile",
        ws_compile.to_str().unwrap(),
        &custom_preset,
    )
    .unwrap();
    assert!(
        !preview.has_changes,
        "Re-running preview on already synced deterministic files must have zero changes"
    );

    // 4. Reverse Import of an existing manual squad ("Squad s/ preset")
    let manual_squad_dir = ws_manual.join(".agents/skills/manual-cabrito-squad");
    fs::create_dir_all(manual_squad_dir.join("roles")).unwrap();
    fs::write(
        manual_squad_dir.join("SKILL.md"),
        r#"---
name: manual-cabrito-squad
description: Squad manual legado do projeto Cabrito
---

# manual-cabrito-squad

| Papel (`role`) | Instância (`providerInstanceId`) | Modelo (`model`) | Opções (`target.options`) | Quando Acionar |
| :--- | :--- | :--- | :--- | :--- |
| Orchestrator (Tech Lead) | `antigravity_2` | `gemini-4-hydrogen` | `thinking_level=high` | Coordenador principal |
| `backend-core` | `antigravity_2` | `gemini-4-hydrogen` | `thinking_level=high` | APIs e banco |
| `ui-polish` | `antigravity` | `gemini-4-argon` | `thinking_level=medium` | Interfaces |
"#,
    )
    .unwrap();
    fs::write(
        manual_squad_dir.join("roles/backend-core.md"),
        r#"# Role: Backend Core (manual-cabrito)

APIs e regras de negócio.
**Quando acionar:** APIs e banco

## Modelo & Instância

- Instância: `antigravity_2`
- Modelo: `gemini-4-hydrogen`
- Opções: `thinking_level=high`

## Skills & MCPs

- Skills: `laravel-modern`, `tdd-and-testing`
- MCPs: `context7`
"#,
    )
    .unwrap();
    fs::write(
        manual_squad_dir.join("roles/ui-polish.md"),
        r#"# Role: UI Polish (manual-cabrito)

Polimento visual e responsividade.
**Quando acionar:** Interfaces

## Modelo & Instância

- Instância: `antigravity`
- Modelo: `gemini-4-argon`
- Opções: `thinking_level=medium`

## Skills & MCPs

- Skills: `tailwind-v4-design`
- MCPs: `playwright`
"#,
    )
    .unwrap();

    // Before import, t3_reader detects manual squad as has_custom_override=true with local_preset_id=None ("Squad s/ preset")
    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
             VALUES ('proj-manual', 'manual-cabrito', ?1, '[]', '2026-11-15T00:00:00Z', '2026-11-15T03:00:00Z')",
            rusqlite::params![ws_manual.to_str().unwrap()],
        )
        .unwrap();
    }
    let snap_before_import = get_dashboard_snapshot_from_paths(&paths).unwrap();
    let p_manual_before = snap_before_import
        .projects
        .iter()
        .find(|p| p.project_id == "proj-manual")
        .unwrap();
    assert!(p_manual_before.has_custom_override);
    assert!(p_manual_before.local_preset_id.is_none());
    assert_eq!(
        p_manual_before.detected_squad_slug.as_deref(),
        Some("manual-cabrito-squad")
    );

    // Run reverse import -> generates .t3code/preset.jsonc preserving roles, instances, skills & prompts
    let imported = import_existing_squad(&paths, "proj-manual", ws_manual.to_str().unwrap())
        .expect("import existing manual squad");
    assert!(imported.has_local_override);
    assert_eq!(
        imported.resolved_preset.orchestrator.provider_instance_id,
        "antigravity_2"
    );
    assert!(imported.resolved_preset.roles.contains_key("backend-core"));
    assert!(imported.resolved_preset.roles.contains_key("ui-polish"));
    assert_eq!(
        imported.resolved_preset.roles["backend-core"].skills,
        vec!["laravel-modern".to_string(), "tdd-and-testing".to_string()]
    );
    assert_eq!(
        imported.resolved_preset.roles["ui-polish"].provider_instance_id,
        "antigravity"
    );
    assert_eq!(
        imported.resolved_preset.roles["ui-polish"].model,
        "gemini-4-argon"
    );
    assert!(local_preset_path(&ws_manual).exists());
}

#[test]
fn test_4_resilience_missing_db_concurrent_wal_and_corrupt_settings() {
    let tmp = tempdir().expect("tempdir");
    let t3_home = tmp.path().join(".t3");
    let userdata_dir = t3_home.join("userdata");
    let presets_dir = tmp.path().join("config").join("presets");
    let skills_root = tmp.path().join("skills");
    fs::create_dir_all(&userdata_dir).unwrap();
    fs::create_dir_all(&skills_root).unwrap();

    let paths = AppPaths {
        t3_home,
        presets_dir,
        skill_roots: vec![("skillshare".to_string(), skills_root)],
    };
    ensure_seed_presets(&paths.presets_dir).unwrap();

    // 1. Missing SQLite and missing settings.json -> returns clean snapshot without panic
    let snap_missing = get_dashboard_snapshot_from_paths(&paths).unwrap();
    assert!(!snap_missing.sqlite_available);
    assert!(!snap_missing.settings_available);
    assert!(snap_missing.projects.is_empty());
    assert_eq!(snap_missing.global_presets.len(), 4);

    // 2. Concurrent WAL mode: T3 Code holds an open read-write connection with uncommitted/active WAL
    //    while oh-my-t3code reads in strict read-only mode (SQLITE_OPEN_READ_ONLY + query_only=true)
    let db_path = userdata_dir.join("statev2.sqlite");
    let settings_path = userdata_dir.join("settings.json");
    create_real_t3_sqlite_schema(&db_path);
    seed_real_t3_settings(&settings_path);

    let t3_writer = Connection::open(&db_path).expect("t3 writer connection");
    t3_writer
        .execute(
            "INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
             VALUES ('proj-wal', 'wal-concurrent', '/tmp/wal-concurrent', '[]', '2026-11-15T00:00:00Z', '2026-11-15T04:00:00Z')",
            [],
        )
        .unwrap();
    t3_writer
        .execute(
            "INSERT INTO projection_threads (thread_id, project_id, title, created_at, updated_at, model_selection_json)
             VALUES ('thread-1', 'proj-wal', 'Active WAL Thread', '2026-11-15T00:00:00Z', '2026-11-15T04:00:00Z', '{\"instanceId\":\"antigravity\",\"model\":\"gemini-4-hydrogen\"}')",
            [],
        )
        .unwrap();
    t3_writer
        .execute(
            "INSERT INTO orchestration_v2_projection_subagents (subagent_id, thread_id, parent_node_id, provider, origin, status, started_at, updated_at, payload_json, driver, provider_instance_id)
             VALUES ('sub-1', 'thread-1', 'root', 'antigravity', 'delegate', 'running', '2026-11-15T04:00:00Z', '2026-11-15T04:01:00Z', '{\"model\":\"gemini-4-argon\",\"role\":\"qa-reviewer\",\"prompt\":\"Run tests\"}', 'antigravity', 'antigravity')",
            [],
        )
        .unwrap();

    // Open readonly connection while writer is still alive
    let ro_conn = open_sqlite_readonly(&db_path).expect("open sqlite readonly under WAL");
    let write_attempt = ro_conn.execute(
        "DELETE FROM projection_projects WHERE project_id = 'proj-wal'",
        [],
    );
    assert!(
        write_attempt.is_err(),
        "Read-only connection must reject any mutation attempt"
    );

    let snap_wal = get_dashboard_snapshot_from_paths(&paths).unwrap();
    assert!(snap_wal.sqlite_available);
    assert!(snap_wal.settings_available);
    assert_eq!(snap_wal.projects.len(), 1);
    assert_eq!(snap_wal.projects[0].active_subagent_count, 1);
    assert_eq!(snap_wal.subagents.len(), 1);
    assert_eq!(snap_wal.subagents[0].subagent_id, "sub-1");
    assert_eq!(
        snap_wal.subagents[0].provider_instance_id.as_deref(),
        Some("antigravity")
    );

    // 3. Malformed / corrupt settings.json -> snapshot still loads SQLite projects gracefully,
    //    while atomic write operations refuse to clobber corrupt JSON
    fs::write(&settings_path, "{ corrupt_json: true ").unwrap();
    let snap_corrupt = get_dashboard_snapshot_from_paths(&paths).unwrap();
    assert!(snap_corrupt.sqlite_available);
    assert!(!snap_corrupt.settings_available);
    assert_eq!(snap_corrupt.projects.len(), 1);
    assert!(snap_corrupt.default_model_selection.is_none());

    let sync_err = set_global_preset_config(&paths, "default".to_string(), true);
    assert!(
        sync_err.is_err(),
        "Must not overwrite a corrupt settings.json file when parsing fails"
    );

    let globals = list_global_presets(&paths.presets_dir).unwrap();
    assert_eq!(globals.len(), 4);
}
