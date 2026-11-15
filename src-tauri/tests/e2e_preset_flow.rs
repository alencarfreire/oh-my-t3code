use oh_my_t3code_lib::{
    compiler::{apply_preset_to_project, compile_preset_preview, swap_project_primary_instance},
    get_dashboard_snapshot_from_paths,
    importer::import_existing_squad,
    models::{AppPaths, PresetConfig, RoleConfig},
    preset_engine::{
        ensure_seed_presets, get_project_preset, list_global_presets, looks_like_mojibake,
        parse_jsonc_preset, resolve_global_preset, save_project_preset,
    },
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

    // Passo 1: ensure_seed_presets + list_global_presets com UTF-8 perfeito e thinking_level
    ensure_seed_presets(&paths.presets_dir).unwrap();
    let globals = list_global_presets(&paths.presets_dir).unwrap();
    assert_eq!(globals.len(), 3);

    let agy_dual = globals.iter().find(|p| p.id == "agy-dual").unwrap();
    assert_eq!(
        agy_dual.fallback_chain[0].reason,
        "Nível 1: Troca de instância mantendo gemini-4-hydrogen (Agy Principal ↔ Agy Veca)"
    );
    assert!(!looks_like_mojibake(&agy_dual.description));
    assert_eq!(
        agy_dual.orchestrator.options.get("thinking_level").map(String::as_str),
        Some("high")
    );
    assert!(!agy_dual.orchestrator.options.contains_key("thinkingLevel"));

    let hybrid = globals.iter().find(|p| p.id == "hybrid-agy-codex").unwrap();
    assert_eq!(
        hybrid.orchestrator.options.get("thinking_level").map(String::as_str),
        Some("high")
    );
    assert!(!looks_like_mojibake(&hybrid.description));

    // Passo 2: get_dashboard_snapshot_from_paths lê SQLite read-only e retorna projetos, subagentes e skills
    let snapshot = get_dashboard_snapshot_from_paths(&paths).unwrap();
    assert!(snapshot.sqlite_available);
    assert!(snapshot.settings_available);
    assert_eq!(snapshot.projects.len(), 2);
    assert_eq!(snapshot.subagents.len(), 2);
    assert_eq!(snapshot.skills.len(), 3);
    assert_eq!(snapshot.global_presets.len(), 3);

    let proj_agy = snapshot
        .projects
        .iter()
        .find(|p| p.project_id == "proj-agy")
        .expect("proj-agy present");
    assert_eq!(proj_agy.title, "projeto-teste-agy");
    assert_eq!(proj_agy.active_subagent_count, 1);

    let proj_codex = snapshot
        .projects
        .iter()
        .find(|p| p.project_id == "proj-codex")
        .expect("proj-codex present");
    assert_eq!(proj_codex.title, "projeto-teste-codex");
    assert_eq!(proj_codex.active_subagent_count, 0);

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
    assert!(agy_preview
        .files
        .iter()
        .any(|f| f.relative_path == ".agents/skills/projeto-teste-agy-squad/roles/backend.md"));
    assert!(agy_preview
        .files
        .iter()
        .any(|f| f.relative_path == ".agents/skills/projeto-teste-agy-squad/roles/frontend.md"));
    assert!(agy_preview
        .files
        .iter()
        .any(|f| f.relative_path == ".agents/skills/projeto-teste-agy-squad/roles/qa-reviewer.md"));

    let codex_preview =
        compile_preset_preview(&paths, "proj-codex", codex_ws.to_str().unwrap(), &codex_squad)
            .unwrap();
    assert!(codex_preview.has_changes);
    assert_eq!(codex_preview.project_slug, "projeto-teste-codex");
    assert!(codex_preview
        .files
        .iter()
        .any(|f| f.relative_path == ".agents/skills/projeto-teste-codex-squad/roles/delivery-manager.md"));

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
    assert!(agy_squad_dir.join("roles/backend.md").exists());
    assert!(agy_squad_dir.join("roles/frontend.md").exists());
    assert!(agy_squad_dir.join("roles/qa-reviewer.md").exists());

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
        topology: "intra-thread-squad".to_string(),
        orchestrator: agy_dual.orchestrator.clone(),
        fallback_chain: agy_dual.fallback_chain.clone(),
        contention: agy_dual.contention.clone(),
        roles: custom_roles,
    };

    let saved_proj = save_project_preset(
        &paths,
        "proj-agy",
        agy_ws.to_str().unwrap(),
        custom_project_preset.clone(),
    )
    .unwrap();
    assert!(saved_proj.has_local_override);
    assert_eq!(saved_proj.resolved_preset.roles.len(), 4);
    assert!(saved_proj.resolved_preset.roles.contains_key("backend"));
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
