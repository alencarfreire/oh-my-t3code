use oh_my_t3code_lib::{
    compiler::{
        apply_preset_to_project, compile_preset_preview, remove_project_override,
        save_global_preset_and_sync, set_global_preset_config, set_project_preset_enabled,
        swap_global_instance, swap_global_instance_with_options, swap_project_primary_instance,
        swap_project_primary_instance_with_options,
    },
    get_dashboard_snapshot_from_paths,
    importer::import_existing_squad,
    models::{AppPaths, PresetConfig, RoleConfig},
    preset_engine::{
        ensure_seed_presets, get_project_preset, list_global_presets, local_preset_path,
        looks_like_mojibake, parse_jsonc_preset, resolve_global_preset, save_project_preset,
        OMOS_CANONICAL_ROLES,
    },
    t3_reader::read_t3_settings,
};
use rusqlite::Connection;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use tempfile::tempdir;

fn seed_test_sqlite(db_path: &Path, agy_ws: &Path, codex_ws: &Path) {
    let conn = Connection::open(db_path).expect("create test sqlite db");
    conn.execute_batch(
        "
        CREATE TABLE projection_projects (
            project_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            workspace_root TEXT NOT NULL,
            default_model_selection_json TEXT,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
        CREATE TABLE projection_threads (
            thread_id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
        CREATE TABLE orchestration_v2_projection_subagents (
            subagent_id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            child_thread_id TEXT,
            provider TEXT NOT NULL,
            provider_instance_id TEXT,
            status TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            updated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );
        ",
    )
    .expect("create schema");

    conn.execute(
        "INSERT INTO projection_projects VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
        rusqlite::params![
            "proj-agy",
            "projeto-teste-agy",
            agy_ws.to_str().unwrap(),
            r#"{"instanceId":"antigravity_2","model":"gemini-4-hydrogen"}"#,
            "2026-11-15T01:00:00Z",
        ],
    )
    .unwrap();

    conn.execute(
        "INSERT INTO projection_projects VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
        rusqlite::params![
            "proj-codex",
            "projeto-teste-codex",
            codex_ws.to_str().unwrap(),
            r#"{"instanceId":"codex","model":"gpt-6.1-sol"}"#,
            "2026-11-15T00:50:00Z",
        ],
    )
    .unwrap();

    conn.execute_batch(
        "
        INSERT INTO projection_threads VALUES
            ('thr-agy-1', 'proj-agy', 'Squad Agy Thread', '2026-11-15T00:40:00Z', '2026-11-15T01:00:00Z', NULL),
            ('thr-codex-1', 'proj-codex', 'Squad Codex Thread', '2026-11-15T00:30:00Z', '2026-11-15T00:50:00Z', NULL);

        INSERT INTO orchestration_v2_projection_subagents VALUES
            (
                'sub-agy-1',
                'thr-agy-1',
                'thr-agy-child-1',
                'antigravity',
                'antigravity',
                'running',
                '2026-11-15T00:55:00Z',
                NULL,
                '2026-11-15T01:00:00Z',
                '{\"role\":\"backend\",\"title\":\"Implementar motor JSONC UTF-8\",\"model\":\"gemini-4-hydrogen\",\"prompt\":\"Corrigir strip_jsonc_comments e validar acentuação\"}'
            ),
            (
                'sub-codex-1',
                'thr-codex-1',
                'thr-codex-child-1',
                'codex',
                'codex',
                'completed',
                '2026-11-15T00:35:00Z',
                '2026-11-15T00:45:00Z',
                '2026-11-15T00:45:00Z',
                '{\"role\":\"qa-reviewer\",\"title\":\"Auditoria de segurança\",\"model\":\"gpt-6-astra\",\"prompt\":\"Validar invariantes\",\"result\":\"Suíte verde sem regressões\"}'
            );
        ",
    )
    .unwrap();
}

fn seed_test_skills(skill_root: &Path) {
    let skills = [
        ("tdd-and-testing", "Ciclo estrito Red-Green-Refactor e validação automatizada."),
        ("tailwind-v4-design", "CSS-first @theme e componentes acessíveis em Tailwind v4."),
        ("security-audit", "Auditoria defensiva e revisão de vulnerabilidades."),
    ];
    for (id, desc) in skills {
        let dir = skill_root.join(id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {id}\ndescription: {desc}\n---\n\n# {id}\n"),
        )
        .unwrap();
    }
}

#[test]
fn end_to_end_preset_configuration_compilation_execution_and_import() {
    let tmp = tempdir().unwrap();
    let t3_home = tmp.path().join(".t3");
    let userdata_dir = t3_home.join("userdata");
    let presets_dir = tmp.path().join("config").join("presets");
    let skills_root = tmp.path().join("skills");
    let agy_ws = tmp.path().join("projeto-teste-agy");
    let codex_ws = tmp.path().join("projeto-teste-codex");

    fs::create_dir_all(&userdata_dir).unwrap();
    fs::create_dir_all(&agy_ws).unwrap();
    fs::create_dir_all(&codex_ws).unwrap();

    let sqlite_path = userdata_dir.join("statev2.sqlite");
    seed_test_sqlite(&sqlite_path, &agy_ws, &codex_ws);
    seed_test_skills(&skills_root);

    let settings_path = userdata_dir.join("settings.json");
    let initial_settings = serde_json::json!({
        "favorites": ["proj-agy"],
        "customUserPreference": { "preserveMe": true, "theme": "dark" },
        "providerInstances": {
            "antigravity": { "driver": "antigravity", "displayName": "Agy Veca", "enabled": true },
            "antigravity_2": { "driver": "antigravity", "displayName": "Agy Principal", "enabled": true },
            "codex": { "driver": "codex", "displayName": "Codex", "enabled": true }
        },
        "defaultModelSelection": {
            "instanceId": "antigravity_2",
            "model": "gemini-4-hydrogen",
            "options": [{ "id": "thinking_level", "value": "high" }]
        }
    });
    fs::write(
        &settings_path,
        serde_json::to_string_pretty(&initial_settings).unwrap(),
    )
    .unwrap();

    let paths = AppPaths {
        t3_home,
        presets_dir: presets_dir.clone(),
        skill_roots: vec![("skillshare".to_string(), skills_root)],
    };

    // Passo 1: ensure_seed_presets + list_global_presets com default (OMOS Standard) + UTF-8 perfeito
    ensure_seed_presets(&paths.presets_dir).unwrap();
    let globals = list_global_presets(&paths.presets_dir).unwrap();
    assert_eq!(globals.len(), 4);
    assert_eq!(globals[0].id, "default");

    let default_preset = &globals[0];
    assert_eq!(default_preset.name, "Default (OMOS Standard)");
    assert_eq!(default_preset.orchestrator.provider_instance_id, "codex");
    assert_eq!(default_preset.orchestrator.model, "gpt-6.1-sol");
    assert_eq!(default_preset.roles["explorer"].model, "gpt-6-luna");
    assert_eq!(default_preset.roles["oracle"].model, "gpt-6.1-sol");
    assert_eq!(default_preset.roles["designer"].model, "gpt-6-luna");
    assert_eq!(default_preset.roles["fixer"].model, "gpt-6.1-sol");
    assert_eq!(default_preset.roles["qa-reviewer"].model, "gpt-6-astra");

    let agy_dual = globals.iter().find(|p| p.id == "agy-dual").unwrap();
    assert_eq!(
        agy_dual.fallback_chain[0].reason,
        "Nível 1: Troca de instância mantendo gemini-4-hydrogen (Agy Principal ↔ Agy Veca)"
    );
    assert!(!looks_like_mojibake(&agy_dual.description));
    assert_eq!(
        agy_dual.orchestrator.options.get("thinking_level").map(String::as_str),
        Some("medium")
    );
    assert!(!agy_dual.orchestrator.options.contains_key("thinkingLevel"));

    let hybrid = globals.iter().find(|p| p.id == "hybrid-agy-codex").unwrap();
    assert_eq!(
        hybrid.orchestrator.options.get("thinking_level").map(String::as_str),
        Some("medium")
    );
    assert!(!looks_like_mojibake(&hybrid.description));

    // Passo 2: get_dashboard_snapshot_from_paths lê SQLite read-only e retorna projetos, subagentes e skills
    let snapshot = get_dashboard_snapshot_from_paths(&paths).unwrap();
    assert!(snapshot.sqlite_available);
    assert!(snapshot.settings_available);
    assert_eq!(snapshot.global_config.active_global_preset_id, "default");
    assert!(snapshot.global_config.enabled);
    assert_eq!(snapshot.projects.len(), 2);
    assert_eq!(snapshot.subagents.len(), 2);
    assert_eq!(snapshot.skills.len(), 3);
    assert_eq!(snapshot.global_presets.len(), 4);
    assert_eq!(snapshot.global_presets[0].id, "default");
    for gp in &snapshot.global_presets {
        assert!(gp.enabled);
        for role_id in OMOS_CANONICAL_ROLES {
            assert!(
                gp.roles.contains_key(role_id),
                "preset {} missing OMOS role {}",
                gp.id,
                role_id
            );
        }
    }

    let proj_agy = snapshot
        .projects
        .iter()
        .find(|p| p.project_id == "proj-agy")
        .expect("proj-agy present");
    assert_eq!(proj_agy.title, "projeto-teste-agy");
    assert_eq!(proj_agy.active_subagent_count, 1);
    assert!(!proj_agy.has_custom_override);

    let proj_codex = snapshot
        .projects
        .iter()
        .find(|p| p.project_id == "proj-codex")
        .expect("proj-codex present");
    assert_eq!(proj_codex.title, "projeto-teste-codex");
    assert_eq!(proj_codex.active_subagent_count, 0);
    assert!(!proj_codex.has_custom_override);

    // Passo 3: compile_preset_preview para projeto-teste-agy (agy-dual) e projeto-teste-codex (codex-squad)
    let codex_squad = resolve_global_preset(&paths.presets_dir, "codex-squad").unwrap();
    let agy_preview =
        compile_preset_preview(&paths, "proj-agy", agy_ws.to_str().unwrap(), agy_dual).unwrap();
    assert!(agy_preview.has_changes);
    assert_eq!(agy_preview.project_slug, "projeto-teste-agy");
    assert!(agy_preview.files.iter().any(|f| f.relative_path == ".t3code/preset.jsonc"));
    assert!(agy_preview
        .files
        .iter()
        .any(|f| f.relative_path == ".agents/skills/projeto-teste-agy-squad/SKILL.md"));
    for role_id in OMOS_CANONICAL_ROLES {
        let expected = format!(".agents/skills/projeto-teste-agy-squad/roles/{role_id}.md");
        assert!(
            agy_preview.files.iter().any(|f| f.relative_path == expected),
            "missing compiled preview for {expected}"
        );
    }

    let codex_preview =
        compile_preset_preview(&paths, "proj-codex", codex_ws.to_str().unwrap(), &codex_squad)
            .unwrap();
    assert!(codex_preview.has_changes);
    assert_eq!(codex_preview.project_slug, "projeto-teste-codex");
    assert!(codex_preview
        .files
        .iter()
        .any(|f| f.relative_path == ".agents/skills/projeto-teste-codex-squad/roles/oracle.md"));

    // Passo 4: apply_preset_to_project em projeto-teste-agy e projeto-teste-codex
    let agy_sync = apply_preset_to_project(
        &paths,
        "proj-agy",
        agy_ws.to_str().unwrap(),
        Some("agy-dual".to_string()),
        None,
    )
    .unwrap();
    assert_eq!(agy_sync.preset_id, "agy-dual");
    assert_eq!(agy_sync.active_instance_id, "antigravity_2");
    assert!(agy_ws.join(".t3code/preset.jsonc").exists());

    let agy_squad_dir = agy_ws.join(".agents/skills/projeto-teste-agy-squad");
    assert!(agy_squad_dir.join("SKILL.md").exists());
    for role_id in OMOS_CANONICAL_ROLES {
        assert!(agy_squad_dir.join(format!("roles/{role_id}.md")).exists());
    }

    let bak_path = userdata_dir.join("settings.json.bak");
    assert!(bak_path.exists());
    let bak_val: Value =
        serde_json::from_str(&fs::read_to_string(&bak_path).unwrap()).unwrap();
    assert_eq!(bak_val, initial_settings);

    let codex_sync = apply_preset_to_project(
        &paths,
        "proj-codex",
        codex_ws.to_str().unwrap(),
        Some("codex-squad".to_string()),
        None,
    )
    .unwrap();
    assert_eq!(codex_sync.preset_id, "codex-squad");
    assert_eq!(codex_sync.active_instance_id, "codex");

    let settings_after: Value =
        serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
    assert_eq!(
        settings_after["customUserPreference"],
        initial_settings["customUserPreference"]
    );
    assert_eq!(
        settings_after["projectSettingsOverrides"]["proj-agy"]["defaultModelSelection"]["instanceId"],
        "antigravity_2"
    );
    assert_eq!(
        settings_after["projectSettingsOverrides"]["proj-agy"]["defaultModelSelection"]["options"][0]["id"],
        "thinking_level"
    );
    assert_eq!(
        settings_after["projectSettingsOverrides"]["proj-agy"]["defaultModelSelection"]["options"][0]["value"],
        "medium"
    );
    assert_eq!(
        settings_after["projectSettingsOverrides"]["proj-codex"]["defaultModelSelection"]["instanceId"],
        "codex"
    );

    // Passo 5: Customizar preset do projeto com herança (extends: Some("agy-dual")) + novo papel pt-BR
    let mut custom_roles = BTreeMap::new();
    custom_roles.insert(
        "observabilidade".to_string(),
        RoleConfig {
            id: "observabilidade".to_string(),
            title: "Observabilidade & Métricas".to_string(),
            description: "Telemetria, logs estruturados e prevenção de regressões em produção — atenção à latência.".to_string(),
            when_to_use: "Configuração de alertas, tracing distribuído e análise de métricas.".to_string(),
            provider_instance_id: "antigravity".to_string(),
            model: "gemini-4-hydrogen".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "medium".to_string())]),
            skills: vec!["systematic-debugging".to_string()],
            mcps: vec!["ai-memory".to_string()],
            allowed_paths: vec!["src-tauri/**".to_string()],
            forbidden_paths: vec!["src/**".to_string()],
            invariants: vec!["Nunca expor segredos ou tokens em logs estruturados.".to_string()],
            verification_commands: vec!["cargo test --manifest-path src-tauri/Cargo.toml".to_string()],
        },
    );

    let custom_project_preset = PresetConfig {
        id: "projeto-teste-agy-custom".to_string(),
        name: "Projeto Teste Agy — Configuração Avançada".to_string(),
        description: "Herança de agy-dual com papel dedicado de observabilidade e acentuação íntegra (Agy Principal ↔ Agy Veca).".to_string(),
        extends: Some("agy-dual".to_string()),
        enabled: true,
        topology: "intra-thread-squad".to_string(),
        orchestrator: agy_dual.orchestrator.clone(),
        fallback_chain: agy_dual.fallback_chain.clone(),
        contention: agy_dual.contention.clone(),
        session_policy: Default::default(),
        roles: custom_roles,
        disabled_roles: Vec::new(),
    };

    let saved_proj = save_project_preset(
        &paths,
        "proj-agy",
        agy_ws.to_str().unwrap(),
        custom_project_preset.clone(),
    )
    .unwrap();
    assert!(saved_proj.has_local_override);
    assert_eq!(saved_proj.resolved_preset.roles.len(), 6);
    assert!(saved_proj.resolved_preset.roles.contains_key("fixer"));
    assert!(saved_proj.resolved_preset.roles.contains_key("observabilidade"));

    apply_preset_to_project(
        &paths,
        "proj-agy",
        agy_ws.to_str().unwrap(),
        None,
        Some(custom_project_preset.clone()),
    )
    .unwrap();

    let obs_md = fs::read_to_string(agy_squad_dir.join("roles/observabilidade.md")).unwrap();
    assert!(obs_md.contains("Observabilidade & Métricas"));
    assert!(obs_md.contains("Telemetria, logs estruturados e prevenção de regressões em produção — atenção à latência."));
    assert!(obs_md.contains("`thinking_level=medium`"));
    assert!(!obs_md.contains('Ã'));
    assert!(!looks_like_mojibake(&obs_md));

    let skill_md = fs::read_to_string(agy_squad_dir.join("SKILL.md")).unwrap();
    assert!(skill_md.contains("Nível 1: Troca de instância mantendo gemini-4-hydrogen (Agy Principal ↔ Agy Veca)"));
    assert!(skill_md.contains("roles/observabilidade.md"));
    assert!(skill_md.contains("## 5. Gestão de sessão e concorrência (oh-my-t3code)"));
    assert!(!skill_md.contains('Ã'));
    assert!(!looks_like_mojibake(&skill_md));

    // Segunda chamada a compile_preset_preview deve ter changed == false em todos os arquivos
    let clean_preview = compile_preset_preview(
        &paths,
        "proj-agy",
        agy_ws.to_str().unwrap(),
        &custom_project_preset,
    )
    .unwrap();
    assert!(!clean_preview.has_changes);
    assert!(!clean_preview.settings_preview.changed);
    for file in &clean_preview.files {
        assert!(!file.changed, "expected no diff for {}", file.relative_path);
        assert!(file.unified_diff.is_empty());
    }

    // Passo 6: Testar swap_project_primary_instance e import_existing_squad
    let swap_1 =
        swap_project_primary_instance(&paths, "proj-agy", agy_ws.to_str().unwrap()).unwrap();
    assert_eq!(swap_1.active_instance_id, "antigravity");

    let swap_2 =
        swap_project_primary_instance(&paths, "proj-agy", agy_ws.to_str().unwrap()).unwrap();
    assert_eq!(swap_2.active_instance_id, "antigravity_2");

    // Verificar que o preset local salvo após swap continua parseável e com UTF-8 limpo
    let local_raw = fs::read_to_string(agy_ws.join(".t3code/preset.jsonc")).unwrap();
    assert!(!local_raw.contains('Ã'));
    let parsed_local = parse_jsonc_preset(&local_raw).unwrap();
    assert!(!looks_like_mojibake(&parsed_local.description));

    // Remover .t3code/preset.jsonc temporariamente e testar import_existing_squad do .agents/skills/
    fs::remove_file(agy_ws.join(".t3code/preset.jsonc")).unwrap();
    let imported = import_existing_squad(&paths, "proj-agy", agy_ws.to_str().unwrap()).unwrap();
    assert!(imported.has_local_override);
    assert_eq!(imported.resolved_preset.extends.as_deref(), Some("agy-dual"));
    assert!(imported.resolved_preset.roles.contains_key("observabilidade"));
    assert_eq!(
        imported.resolved_preset.roles["observabilidade"]
            .options
            .get("thinking_level")
            .map(String::as_str),
        Some("medium")
    );

    let reloaded = get_project_preset(&paths, "proj-agy", agy_ws.to_str().unwrap(), None).unwrap();
    assert!(reloaded.has_local_override);
    assert!(reloaded.resolved_preset.roles.contains_key("observabilidade"));
}

#[test]
fn vtech_110_global_config_toggle_and_override_filtering_flow() {
    let tmp = tempdir().unwrap();
    let t3_home = tmp.path().join(".t3");
    let userdata_dir = t3_home.join("userdata");
    let presets_dir = tmp.path().join("config").join("presets");
    let skills_root = tmp.path().join("skills");
    let agy_ws = tmp.path().join("projeto-teste-agy");
    let codex_ws = tmp.path().join("projeto-teste-codex");

    fs::create_dir_all(&userdata_dir).unwrap();
    fs::create_dir_all(&agy_ws).unwrap();
    fs::create_dir_all(&codex_ws).unwrap();

    seed_test_sqlite(&userdata_dir.join("statev2.sqlite"), &agy_ws, &codex_ws);
    seed_test_skills(&skills_root);

    let settings_path = userdata_dir.join("settings.json");
    let initial_settings = serde_json::json!({
        "favorites": ["proj-agy"],
        "customUserPreference": { "keep": 42 },
        "providerInstances": {
            "antigravity": { "driver": "antigravity", "displayName": "Agy Veca", "enabled": true },
            "antigravity_2": { "driver": "antigravity", "displayName": "Agy Principal", "enabled": true },
            "codex": { "driver": "codex", "displayName": "Codex", "enabled": true }
        }
    });
    fs::write(
        &settings_path,
        serde_json::to_string_pretty(&initial_settings).unwrap(),
    )
    .unwrap();

    let paths = AppPaths {
        t3_home,
        presets_dir,
        skill_roots: vec![("skillshare".to_string(), skills_root)],
    };

    // 1. Default snapshot when config.jsonc doesn't exist: default + enabled: true + no overrides
    let snap0 = get_dashboard_snapshot_from_paths(&paths).unwrap();
    assert_eq!(snap0.global_config.active_global_preset_id, "default");
    assert!(snap0.global_config.enabled);
    assert!(paths.global_config_path().exists());
    assert!(paths.presets_dir.join("default.jsonc").exists());
    assert!(snap0.projects.iter().all(|p| !p.has_custom_override));
    assert!(snap0.projects.iter().all(|p| p.preset_enabled));

    // Swap on default preset toggles codex gpt-6.1-sol -> gpt-6.1-terra -> gpt-6.1-sol
    let snap_default_sync = set_global_preset_config(&paths, "default".to_string(), true).unwrap();
    assert_eq!(
        snap_default_sync.default_model_selection.as_ref().unwrap().instance_id,
        "codex"
    );
    assert_eq!(
        snap_default_sync.default_model_selection.as_ref().unwrap().model,
        "gpt-6.1-sol"
    );
    let snap_default_swap = swap_global_instance(&paths).unwrap();
    assert_eq!(
        snap_default_swap.default_model_selection.as_ref().unwrap().model,
        "gpt-6.1-terra"
    );
    assert_eq!(
        snap_default_swap.fallback_model_selection.as_ref().unwrap().model,
        "gpt-6.1-sol"
    );
    let snap_default_unswap = swap_global_instance(&paths).unwrap();
    assert_eq!(
        snap_default_unswap.default_model_selection.as_ref().unwrap().model,
        "gpt-6.1-sol"
    );

    // Can switch freely across all 4 global presets (hybrid-agy-codex, codex-squad, agy-dual, default)
    let snap_hybrid = set_global_preset_config(&paths, "hybrid-agy-codex".to_string(), true).unwrap();
    assert_eq!(snap_hybrid.global_config.active_global_preset_id, "hybrid-agy-codex");
    let snap_codex = set_global_preset_config(&paths, "codex-squad".to_string(), true).unwrap();
    assert_eq!(snap_codex.global_config.active_global_preset_id, "codex-squad");

    // 2. set_global_preset_config("agy-dual") syncs defaultModelSelection & fallbackModelSelection
    let snap1 = set_global_preset_config(&paths, "agy-dual".to_string(), true).unwrap();
    assert_eq!(
        snap1.default_model_selection.as_ref().unwrap().instance_id,
        "antigravity_2"
    );
    assert_eq!(
        snap1.fallback_model_selection.as_ref().unwrap().instance_id,
        "antigravity"
    );
    let settings_after_global: Value =
        serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
    assert_eq!(
        settings_after_global["customUserPreference"],
        initial_settings["customUserPreference"]
    );
    assert!(userdata_dir.join("settings.json.bak").exists());

    // swap_global_instance toggles antigravity_2 -> antigravity
    let snap2 = swap_global_instance(&paths).unwrap();
    assert_eq!(
        snap2.default_model_selection.as_ref().unwrap().instance_id,
        "antigravity"
    );
    assert_eq!(
        snap2.fallback_model_selection.as_ref().unwrap().instance_id,
        "antigravity_2"
    );

    // 3. Apply custom override (codex-squad) to proj-codex -> has_custom_override == true
    apply_preset_to_project(
        &paths,
        "proj-codex",
        codex_ws.to_str().unwrap(),
        Some("codex-squad".to_string()),
        None,
    )
    .unwrap();
    let snap3 = get_dashboard_snapshot_from_paths(&paths).unwrap();
    let p_agy = snap3
        .projects
        .iter()
        .find(|p| p.project_id == "proj-agy")
        .unwrap();
    let p_codex = snap3
        .projects
        .iter()
        .find(|p| p.project_id == "proj-codex")
        .unwrap();
    assert!(!p_agy.has_custom_override);
    assert!(p_codex.has_custom_override);
    assert!(p_codex.preset_enabled);

    // 4. Disable proj-codex preset -> preserves .t3code/preset.jsonc (enabled: false) & removes settings override
    set_project_preset_enabled(&paths, "proj-codex", codex_ws.to_str().unwrap(), false).unwrap();
    assert!(local_preset_path(&codex_ws).exists());
    let settings_disabled = read_t3_settings(&settings_path);
    assert!(!settings_disabled.project_overrides.contains_key("proj-codex"));
    let snap4 = get_dashboard_snapshot_from_paths(&paths).unwrap();
    let p_codex_off = snap4
        .projects
        .iter()
        .find(|p| p.project_id == "proj-codex")
        .unwrap();
    assert!(!p_codex_off.preset_enabled);

    // Re-enable proj-codex -> restores settings override
    set_project_preset_enabled(&paths, "proj-codex", codex_ws.to_str().unwrap(), true).unwrap();
    let settings_reenabled = read_t3_settings(&settings_path);
    assert!(settings_reenabled.project_overrides.contains_key("proj-codex"));

    // 5. remove_project_override reverts proj-codex back to has_custom_override == false
    let snap5 = remove_project_override(&paths, "proj-codex", codex_ws.to_str().unwrap()).unwrap();
    assert!(!local_preset_path(&codex_ws).exists());
    let settings_removed = read_t3_settings(&settings_path);
    assert!(!settings_removed.project_overrides.contains_key("proj-codex"));
    let p_codex_removed = snap5
        .projects
        .iter()
        .find(|p| p.project_id == "proj-codex")
        .unwrap();
    assert!(!p_codex_removed.has_custom_override);

    // Manual project-specific .agents/skills/*-squad/SKILL.md triggers has_custom_override == true
    let manual_squad_dir = agy_ws.join(".agents").join("skills").join("projeto-teste-agy-squad");
    fs::create_dir_all(&manual_squad_dir).unwrap();
    fs::write(
        manual_squad_dir.join("SKILL.md"),
        "---\nname: projeto-teste-agy-squad\ndescription: Custom hand-authored squad\n---\n# Custom Squad\n",
    )
    .unwrap();
    let snap6 = get_dashboard_snapshot_from_paths(&paths).unwrap();
    let p_agy_manual = snap6
        .projects
        .iter()
        .find(|p| p.project_id == "proj-agy")
        .unwrap();
    assert!(p_agy_manual.has_custom_override);
}

#[test]
fn vtech_116_sm1_global_pause_save_sync_and_fallback_flow() {
    let tmp = tempdir().unwrap();
    let t3_home = tmp.path().join(".t3");
    let userdata_dir = t3_home.join("userdata");
    let presets_dir = tmp.path().join("config").join("presets");
    let skills_root = tmp.path().join("skills");
    let agy_ws = tmp.path().join("projeto-teste-agy");
    let codex_ws = tmp.path().join("projeto-teste-codex");

    fs::create_dir_all(&userdata_dir).unwrap();
    fs::create_dir_all(&agy_ws).unwrap();
    fs::create_dir_all(&codex_ws).unwrap();

    seed_test_sqlite(&userdata_dir.join("statev2.sqlite"), &agy_ws, &codex_ws);
    seed_test_skills(&skills_root);

    let settings_path = userdata_dir.join("settings.json");
    let initial_settings = serde_json::json!({
        "favorites": ["proj-agy"],
        "customUserPreference": { "preserveMe": true },
        "projectSettingsOverrides": {
            "proj-codex": {
                "defaultModelSelection": { "instanceId": "codex", "model": "gpt-6.1-sol" }
            }
        }
    });
    fs::write(
        &settings_path,
        serde_json::to_string_pretty(&initial_settings).unwrap(),
    )
    .unwrap();

    let paths = AppPaths {
        t3_home,
        presets_dir,
        skill_roots: vec![("skillshare".to_string(), skills_root)],
    };

    // Activate agy-dual globally
    let snap_active = set_global_preset_config(&paths, "agy-dual".to_string(), true).unwrap();
    assert!(snap_active.global_config.enabled);
    assert!(snap_active.default_model_selection.is_some());
    assert!(snap_active.fallback_model_selection.is_some());

    // SM1-BUG-3: get_project_preset with Some("codex") hint resolves to active_global_preset_id ("agy-dual"), not "codex-squad"
    let resolved_codex_hint =
        get_project_preset(&paths, "proj-codex", codex_ws.to_str().unwrap(), Some("codex"))
            .unwrap();
    assert_eq!(resolved_codex_hint.resolved_preset.id, "agy-dual");

    // SM1-BUG-2: Editing and saving active global preset syncs settings.json
    let mut edited_agy = resolve_global_preset(&paths.presets_dir, "agy-dual").unwrap();
    edited_agy.orchestrator.provider_instance_id = "antigravity".to_string();
    edited_agy.orchestrator.model = "gemini-4-argon".to_string();
    save_global_preset_and_sync(&paths, edited_agy).unwrap();
    let settings_synced = read_t3_settings(&settings_path);
    assert_eq!(
        settings_synced.default_model_selection.as_ref().unwrap().instance_id,
        "antigravity"
    );
    assert_eq!(
        settings_synced.default_model_selection.as_ref().unwrap().model,
        "gemini-4-argon"
    );

    // SM1-BUG-1: Pausing global preset removes defaultModelSelection & fallbackModelSelection while preserving projectSettingsOverrides and favorites
    let snap_paused = set_global_preset_config(&paths, "agy-dual".to_string(), false).unwrap();
    assert!(!snap_paused.global_config.enabled);
    assert!(snap_paused.default_model_selection.is_none());
    assert!(snap_paused.fallback_model_selection.is_none());

    let raw_paused: Value =
        serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
    assert!(raw_paused.get("defaultModelSelection").is_none());
    assert!(raw_paused.get("fallbackModelSelection").is_none());
    assert_eq!(raw_paused["favorites"], initial_settings["favorites"]);
    assert_eq!(
        raw_paused["customUserPreference"],
        initial_settings["customUserPreference"]
    );
    assert_eq!(
        raw_paused["projectSettingsOverrides"],
        initial_settings["projectSettingsOverrides"]
    );

    // SM1-BUG-1: swap_global_instance rejects when paused
    assert!(swap_global_instance(&paths).is_err());
}

#[test]
fn vtech_117_sm2_project_override_lifecycle_and_tombstones() {
    let tmp = tempdir().unwrap();
    let t3_home = tmp.path().join(".t3");
    let userdata_dir = t3_home.join("userdata");
    let presets_dir = tmp.path().join("config").join("presets");
    let skills_root = tmp.path().join("skills");
    let agy_ws = tmp.path().join("projeto-teste-agy");
    let codex_ws = tmp.path().join("projeto-teste-codex");

    fs::create_dir_all(&userdata_dir).unwrap();
    fs::create_dir_all(&agy_ws).unwrap();
    fs::create_dir_all(&codex_ws).unwrap();

    seed_test_sqlite(&userdata_dir.join("statev2.sqlite"), &agy_ws, &codex_ws);
    seed_test_skills(&skills_root);

    let settings_path = userdata_dir.join("settings.json");
    fs::write(&settings_path, "{}").unwrap();

    let paths = AppPaths {
        t3_home,
        presets_dir,
        skill_roots: vec![("skillshare".to_string(), skills_root)],
    };
    ensure_seed_presets(&paths.presets_dir).unwrap();

    // 1. Apply agy-dual to proj-agy -> 5 roles/*.md + active settings override
    apply_preset_to_project(
        &paths,
        "proj-agy",
        agy_ws.to_str().unwrap(),
        Some("agy-dual".to_string()),
        None,
    )
    .unwrap();
    let roles_dir = agy_ws.join(".agents/skills/projeto-teste-agy-squad/roles");
    assert!(roles_dir.join("qa-reviewer.md").exists());

    // 2. SM2-BUG-4 + SM2-BUG-2: Derive from agy-dual with tombstone for qa-reviewer -> save, reload, apply prunes qa-reviewer.md
    let mut derived = resolve_global_preset(&paths.presets_dir, "agy-dual").unwrap();
    derived.id = "projeto-teste-agy".to_string();
    derived.extends = Some("agy-dual".to_string());
    derived.roles.remove("qa-reviewer");
    derived.disabled_roles = vec!["qa-reviewer".to_string()];

    let saved = save_project_preset(&paths, "proj-agy", agy_ws.to_str().unwrap(), derived.clone())
        .unwrap();
    assert!(!saved.resolved_preset.roles.contains_key("qa-reviewer"));

    let reloaded = get_project_preset(&paths, "proj-agy", agy_ws.to_str().unwrap(), None).unwrap();
    assert!(!reloaded.resolved_preset.roles.contains_key("qa-reviewer"));

    apply_preset_to_project(
        &paths,
        "proj-agy",
        agy_ws.to_str().unwrap(),
        None,
        Some(derived),
    )
    .unwrap();
    assert!(!roles_dir.join("qa-reviewer.md").exists());
    assert!(roles_dir.join("fixer.md").exists());

    // 3. SM2-BUG-1: Pause override -> swap_project_primary_instance rejects without writing settings.json
    set_project_preset_enabled(&paths, "proj-agy", agy_ws.to_str().unwrap(), false).unwrap();
    assert!(swap_project_primary_instance(&paths, "proj-agy", agy_ws.to_str().unwrap()).is_err());
    assert!(!read_t3_settings(&settings_path)
        .project_overrides
        .contains_key("proj-agy"));

    // 4. SM2-BUG-3: remove_project_override cleans compiler-generated squad and returns has_custom_override == false
    let snap_after_remove =
        remove_project_override(&paths, "proj-agy", agy_ws.to_str().unwrap()).unwrap();
    assert!(!agy_ws.join(".agents/skills/projeto-teste-agy-squad").exists());
    assert!(!local_preset_path(&agy_ws).exists());
    let proj_agy = snap_after_remove
        .projects
        .iter()
        .find(|p| p.project_id == "proj-agy")
        .unwrap();
    assert!(!proj_agy.has_custom_override);
}

#[test]
fn vtech_123_swap_rebalance_and_inherited_resync_e2e() {
    let tmp = tempdir().unwrap();
    let t3_home = tmp.path().join(".t3");
    let userdata_dir = t3_home.join("userdata");
    let presets_dir = tmp.path().join("config").join("presets");
    let skills_root = tmp.path().join("skills");
    let agy_ws = tmp.path().join("projeto-teste-agy");
    let codex_ws = tmp.path().join("projeto-teste-codex");

    fs::create_dir_all(&userdata_dir).unwrap();
    fs::create_dir_all(&agy_ws).unwrap();
    fs::create_dir_all(&codex_ws).unwrap();

    seed_test_sqlite(&userdata_dir.join("statev2.sqlite"), &agy_ws, &codex_ws);
    seed_test_skills(&skills_root);

    let settings_path = userdata_dir.join("settings.json");
    let initial_settings = serde_json::json!({
        "favorites": ["proj-agy"],
        "customUserPreference": { "preserveMe": true }
    });
    fs::write(
        &settings_path,
        serde_json::to_string_pretty(&initial_settings).unwrap(),
    )
    .unwrap();

    let paths = AppPaths {
        t3_home,
        presets_dir,
        skill_roots: vec![("skillshare".to_string(), skills_root)],
    };
    set_global_preset_config(&paths, "agy-dual".to_string(), true).unwrap();

    // 1. Project proj-agy inherits from agy-dual with a sparse local override (no explicit roles override)
    fs::create_dir_all(agy_ws.join(".t3code")).unwrap();
    fs::write(
        local_preset_path(&agy_ws),
        r#"{"id":"projeto-teste-agy","name":"Projeto Agy","extends":"agy-dual","enabled":true}"#,
    )
    .unwrap();
    apply_preset_to_project(&paths, "proj-agy", agy_ws.to_str().unwrap(), None, None).unwrap();

    // Project proj-codex uses codex-squad (unrelated to agy-dual)
    apply_preset_to_project(
        &paths,
        "proj-codex",
        codex_ws.to_str().unwrap(),
        Some("codex-squad".to_string()),
        None,
    )
    .unwrap();

    // 2. Global swap with include_roles = true & resync_inherited = true
    let snap = swap_global_instance_with_options(&paths, true, true).unwrap();
    let report = snap
        .last_global_swap_report
        .as_ref()
        .expect("last_global_swap_report present");
    assert_eq!(report.rebalanced_roles_count, 3);
    assert_eq!(
        report.rebalanced_roles,
        vec![
            "designer".to_string(),
            "oracle".to_string(),
            "qa-reviewer".to_string()
        ]
    );
    assert_eq!(report.resynced_projects.len(), 1);
    assert_eq!(report.resynced_projects[0].project_id, "proj-agy");
    assert!(report.failed_projects.is_empty());

    // proj-agy SKILL.md, roles/*.md, and settings.json updated to antigravity
    let oracle_md = fs::read_to_string(
        agy_ws.join(".agents/skills/projeto-teste-agy-squad/roles/oracle.md"),
    )
    .unwrap();
    assert!(oracle_md.contains("- **Instância:** `antigravity`"));

    let settings_after = read_t3_settings(&settings_path);
    assert_eq!(
        settings_after.project_overrides["proj-agy"].instance_id,
        "antigravity"
    );
    assert_eq!(
        settings_after.project_overrides["proj-codex"].instance_id,
        "codex"
    );
    assert!(userdata_dir.join("settings.json.bak").exists());

    // 3. Project-level Codex swap with include_roles = true on proj-codex
    let codex_swap = swap_project_primary_instance_with_options(
        &paths,
        "proj-codex",
        codex_ws.to_str().unwrap(),
        true,
    )
    .unwrap();
    assert_eq!(codex_swap.active_instance_id, "codex");
    assert_eq!(codex_swap.active_model, "gpt-6.1-terra");
    assert_eq!(codex_swap.rebalanced_roles_count, 2);
    assert_eq!(
        codex_swap.rebalanced_roles,
        vec!["fixer".to_string(), "oracle".to_string()]
    );
    let codex_after = get_project_preset(&paths, "proj-codex", codex_ws.to_str().unwrap(), None)
        .unwrap()
        .resolved_preset;
    assert_eq!(codex_after.roles["explorer"].model, "gpt-6-luna");
    assert_eq!(codex_after.roles["qa-reviewer"].model, "gpt-6-astra");
    assert_eq!(codex_after.roles["designer"].model, "gpt-6.1-terra");
}

