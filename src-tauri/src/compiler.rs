use crate::models::{
    AppError, AppPaths, AppResult, CompilePreviewResult, CompiledFilePreview, DashboardSnapshot,
    FailedProjectResync, GlobalAppConfig, GlobalSwapReport, PresetConfig, ResyncedProjectReport,
    RoleConfig, SyncResult,
};
use crate::preset_engine::{
    atomic_write_file, derive_project_slug, ensure_seed_presets_unlocked,
    get_project_preset_unlocked, load_global_config_unlocked, local_preset_path, lock_config_state,
    normalize_disabled_roles, resolve_global_preset_unlocked,
    resolve_jsonc_against_globals_unlocked, resolve_preset_inheritance_unlocked,
    save_global_config_unlocked, save_global_preset_unlocked, save_project_preset_unlocked,
    strip_jsonc_comments, validate_safe_id,
};
use crate::settings_sync::{
    compute_unified_diff, preview_settings_override, remove_global_settings_override,
    remove_project_settings_override, sync_global_settings, sync_project_settings,
};
use crate::t3_reader::{
    build_dashboard_snapshot_unlocked, list_known_projects_readonly, read_t3_settings,
};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Ensures a target path is strictly contained inside `workspace_root` without traversal.
fn ensure_within_workspace(workspace_root: &Path, target: &Path) -> AppResult<()> {
    for comp in target.components() {
        if matches!(comp, Component::ParentDir) {
            return Err(AppError::PathTraversal(format!(
                "Refusing path containing '..': {}",
                target.display()
            )));
        }
    }
    if !target.starts_with(workspace_root) {
        return Err(AppError::PathTraversal(format!(
            "Target {} escapes workspace root {}",
            target.display(),
            workspace_root.display()
        )));
    }
    Ok(())
}

fn normalize_options(options: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut normalized = BTreeMap::new();
    for (k, v) in options {
        if k == "thinkingLevel" {
            normalized
                .entry("thinking_level".to_string())
                .or_insert_with(|| v.clone());
        } else {
            normalized.insert(k.clone(), v.clone());
        }
    }
    normalized
}

fn format_options_inline(options: &BTreeMap<String, String>) -> String {
    let normalized = normalize_options(options);
    if normalized.is_empty() {
        return "default".to_string();
    }
    normalized
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_backtick_list(items: &[String], empty_fallback: &str) -> String {
    if items.is_empty() {
        empty_fallback.to_string()
    } else {
        items
            .iter()
            .map(|s| format!("`{s}`"))
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// Renders `<workspace_root>/.agents/skills/<project_slug>-squad/SKILL.md` deterministically.
pub fn render_squad_skill_md(project_slug: &str, preset: &PresetConfig) -> String {
    let squad_name = format!("{project_slug}-squad");
    let role_names: Vec<String> = preset.roles.values().map(|r| r.id.clone()).collect();
    let role_summary = if role_names.is_empty() {
        "nenhum papel configurado".to_string()
    } else {
        role_names.join(", ")
    };

    let mut out = String::new();
    out.push_str("---\n");
    out.push_str(&format!("name: {squad_name}\n"));
    out.push_str("description: >-\n");
    out.push_str(&format!(
        "  Atua como Tech Lead do projeto {project_slug} (preset `{}`) coordenando workers\n",
        preset.id
    ));
    out.push_str(&format!(
        "  especializados ({role_summary}) no T3 Code via `delegate_task`. Use quando o\n"
    ));
    out.push_str(&format!(
        "  usuário pedir para rodar a squad, dividir uma feature/bugfix por papéis ou usar `/{squad_name}`.\n"
    ));
    out.push_str("---\n\n");

    out.push_str(&format!(
        "# {project_slug} Squad — Playbook do Orquestrador (T3 Code)\n\n"
    ));
    out.push_str(&format!(
        "- **Preset ativo:** `{}` ({})\n",
        preset.id, preset.name
    ));
    out.push_str(&format!("- **Topologia:** `{}`\n", preset.topology));
    out.push_str(&format!(
        "- **Orquestrador:** `{}` / `{}` ({})\n\n",
        preset.orchestrator.provider_instance_id,
        preset.orchestrator.model,
        format_options_inline(&preset.orchestrator.options)
    ));

    out.push_str("## 1. Preparação do Orquestrador\n\n");
    out.push_str("1. Leia os documentos de governança do repositório (`AGENTS.md`, `README.md` e `roles/*.md`).\n");
    out.push_str("2. Consulte o **`ai-memory` MCP** (`memory_briefing` / `memory_query`) antes de dividir tarefas.\n");
    out.push_str("3. Chame `orchestrator_capabilities` uma única vez na thread antes do primeiro `delegate_task`.\n\n");

    out.push_str("## 2. Papéis da Squad (`roles/`)\n\n");
    out.push_str(
        "| Papel | Arquivo | Quando acionar | Skills & MCPs | Modelo / Instância |\n",
    );
    out.push_str("| :--- | :--- | :--- | :--- | :--- |\n");
    for (role_id, role) in &preset.roles {
        let skills_str = if role.skills.is_empty() {
            "—".to_string()
        } else {
            role
                .skills
                .iter()
                .map(|s| format!("`{s}`"))
                .collect::<Vec<_>>()
                .join(", ")
        };
        let mcps_str = if role.mcps.is_empty() {
            String::new()
        } else {
            format!(
                " + {}",
                role.mcps
                    .iter()
                    .map(|m| format!("`{m}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };
        let when = if role.when_to_use.is_empty() {
            role.description.as_str()
        } else {
            role.when_to_use.as_str()
        };
        out.push_str(&format!(
            "| **{}** | `roles/{role_id}.md` | {} | {}{} | `{}` / `{}` ({}) |\n",
            role.title,
            when.replace('|', "\\|"),
            skills_str,
            mcps_str,
            role.provider_instance_id,
            role.model,
            format_options_inline(&role.options),
        ));
    }
    out.push('\n');

    out.push_str("## 3. Topologia, Contenção & Isolamento\n\n");
    out.push_str(&format!(
        "- **Isolamento padrão:** `{}`\n",
        preset.contention.default_isolation
    ));
    out.push_str(&format!(
        "- **Banco de testes único compartilhado:** `{}`\n",
        preset.contention.single_test_db
    ));
    if !preset.contention.env_vars.is_empty() {
        let envs = preset
            .contention
            .env_vars
            .iter()
            .map(|(k, v)| format!("`{k}={v}`"))
            .collect::<Vec<_>>()
            .join(", ");
        out.push_str(&format!("- **Variáveis obrigatórias:** {envs}\n"));
    }
    if !preset.contention.git_ignored_builds.is_empty() {
        out.push_str(&format!(
            "- **Builds fora do Git:** {}\n",
            format_backtick_list(&preset.contention.git_ignored_builds, "nenhum")
        ));
    }
    if !preset.contention.conflict_files.is_empty() {
        out.push_str(&format!(
            "- **Arquivos de contenção:** {}\n",
            format_backtick_list(&preset.contention.conflict_files, "nenhum")
        ));
    }
    out.push('\n');

    out.push_str("## 4. Cadeia de Fallback\n\n");
    if preset.fallback_chain.is_empty() {
        out.push_str("Nenhuma etapa de fallback configurada.\n");
    } else {
        for (idx, step) in preset.fallback_chain.iter().enumerate() {
            out.push_str(&format!(
                "{}. `{}` / `{}` ({}) — {}\n",
                idx + 1,
                step.provider_instance_id,
                step.model,
                format_options_inline(&step.options),
                step.reason
            ));
        }
    }

    out
}

/// Renders `<workspace_root>/.agents/skills/<project_slug>-squad/roles/<role_id>.md` deterministically.
pub fn render_role_md(project_slug: &str, role: &RoleConfig) -> String {
    let mut out = String::new();
    out.push_str(&format!("# Role: {} ({project_slug})\n\n", role.title));
    if !role.description.is_empty() {
        out.push_str(&format!("{}\n\n", role.description));
    }
    if !role.when_to_use.is_empty() {
        out.push_str(&format!("**Quando acionar:** {}\n\n", role.when_to_use));
    }

    out.push_str("## Modelo & Instância\n");
    out.push_str(&format!(
        "- **Instância:** `{}`\n- **Modelo:** `{}`\n- **Opções:** `{}`\n\n",
        role.provider_instance_id,
        role.model,
        format_options_inline(&role.options)
    ));

    out.push_str("## Escopo de arquivos\n");
    out.push_str(&format!(
        "- **Pode editar:** {}\n",
        format_backtick_list(&role.allowed_paths, "definido no briefing")
    ));
    out.push_str(&format!(
        "- **Evitar / não alterar sem alinhamento:** {}\n\n",
        format_backtick_list(&role.forbidden_paths, "nenhum especificado")
    ));

    out.push_str("## Skills e MCPs recomendados\n");
    out.push_str(&format!(
        "- **Skills:** {}\n",
        format_backtick_list(&role.skills, "nenhuma")
    ));
    out.push_str(&format!(
        "- **MCPs:** {}\n\n",
        format_backtick_list(&role.mcps, "nenhum")
    ));

    out.push_str("## Regras e Invariantes do Projeto\n");
    if role.invariants.is_empty() {
        out.push_str("1. Seguir as convenções e invariantes descritas em `AGENTS.md`.\n\n");
    } else {
        for (idx, inv) in role.invariants.iter().enumerate() {
            out.push_str(&format!("{}. {inv}\n", idx + 1));
        }
        out.push('\n');
    }

    out.push_str("## Verificação obrigatória antes de concluir\n");
    if role.verification_commands.is_empty() {
        out.push_str("- Executar os testes e checagens aplicáveis ao escopo alterado.\n");
    } else {
        for cmd in &role.verification_commands {
            out.push_str(&format!("- `{cmd}`\n"));
        }
    }

    out
}

fn build_file_preview(
    workspace_root: &Path,
    target_path: PathBuf,
    new_content: String,
) -> AppResult<CompiledFilePreview> {
    ensure_within_workspace(workspace_root, &target_path)?;
    let relative_path = target_path
        .strip_prefix(workspace_root)
        .unwrap_or(&target_path)
        .display()
        .to_string();

    let existing_content = if target_path.exists() {
        Some(fs::read_to_string(&target_path)?)
    } else {
        None
    };

    let changed = existing_content.as_deref() != Some(new_content.as_str());
    let unified_diff = if changed {
        compute_unified_diff(
            &format!("a/{relative_path}"),
            &format!("b/{relative_path}"),
            existing_content.as_deref().unwrap_or(""),
            &new_content,
        )
    } else {
        String::new()
    };

    Ok(CompiledFilePreview {
        path: target_path.display().to_string(),
        relative_path,
        existing_content,
        new_content,
        unified_diff,
        changed,
    })
}

/// Computes a deterministic preview of all generated markdown/preset files and `settings.json` changes.
pub fn compile_preset_preview(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
    preset: &PresetConfig,
) -> AppResult<CompilePreviewResult> {
    let _guard = lock_config_state();
    compile_preset_preview_unlocked(paths, project_id, workspace_root, preset)
}

fn compile_preset_preview_unlocked(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
    preset: &PresetConfig,
) -> AppResult<CompilePreviewResult> {
    let ws_root = Path::new(workspace_root);
    if !ws_root.exists() {
        return Err(AppError::NotFound(format!(
            "Workspace root does not exist: {workspace_root}"
        )));
    }
    validate_safe_id(&preset.id, "preset id")?;
    for role_id in preset.roles.keys() {
        validate_safe_id(role_id, "role id")?;
    }
    let mut normalized_preset = preset.clone();
    normalized_preset.disabled_roles = normalize_disabled_roles(&preset.disabled_roles)?;
    for disabled_id in &normalized_preset.disabled_roles {
        normalized_preset.roles.remove(disabled_id);
    }

    let resolved =
        resolve_preset_inheritance_unlocked(&paths.presets_dir, normalized_preset.clone())?;
    let project_slug = derive_project_slug(workspace_root);
    let squad_dir = ws_root
        .join(".agents")
        .join("skills")
        .join(format!("{project_slug}-squad"));

    let mut files = Vec::new();

    // 1. .t3code/preset.jsonc
    let preset_json_content = format!(
        "// Oh My T3Code project preset\n{}\n",
        serde_json::to_string_pretty(&normalized_preset)?
    );
    files.push(build_file_preview(
        ws_root,
        local_preset_path(ws_root),
        preset_json_content,
    )?);

    // 2. SKILL.md
    let skill_md = render_squad_skill_md(&project_slug, &resolved);
    files.push(build_file_preview(
        ws_root,
        squad_dir.join("SKILL.md"),
        skill_md,
    )?);

    // 3. roles/*.md (deterministic BTreeMap order)
    for (role_id, role) in &resolved.roles {
        validate_safe_id(role_id, "role id")?;
        let role_md = render_role_md(&project_slug, role);
        files.push(build_file_preview(
            ws_root,
            squad_dir.join("roles").join(format!("{role_id}.md")),
            role_md,
        )?);
    }

    let settings_preview = preview_settings_override(&paths.settings_path(), project_id, &resolved)?;
    let has_changes = settings_preview.changed || files.iter().any(|f| f.changed);

    Ok(CompilePreviewResult {
        project_id: project_id.to_string(),
        workspace_root: workspace_root.to_string(),
        project_slug,
        preset_id: resolved.id,
        files,
        settings_preview,
        has_changes,
    })
}

/// Applies a preset (by global preset id, custom preset, or existing project preset) to disk and `settings.json`.
pub fn apply_preset_to_project(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
    preset_id_or_custom: Option<String>,
    custom_preset: Option<PresetConfig>,
) -> AppResult<SyncResult> {
    let _guard = lock_config_state();
    apply_preset_to_project_unlocked(
        paths,
        project_id,
        workspace_root,
        preset_id_or_custom,
        custom_preset,
    )
}

fn compile_resolved_project_unlocked(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
    resolved: &PresetConfig,
    local_preset_file: Option<CompiledFilePreview>,
) -> AppResult<SyncResult> {
    let ws_root = Path::new(workspace_root);
    if !ws_root.exists() {
        return Err(AppError::NotFound(format!(
            "Workspace root does not exist: {workspace_root}"
        )));
    }
    validate_safe_id(&resolved.id, "preset id")?;
    for role_id in resolved.roles.keys() {
        validate_safe_id(role_id, "role id")?;
    }

    let project_slug = derive_project_slug(workspace_root);
    let squad_dir = ws_root
        .join(".agents")
        .join("skills")
        .join(format!("{project_slug}-squad"));

    let mut files = Vec::new();
    if let Some(local_file) = local_preset_file {
        files.push(local_file);
    }

    let skill_md = render_squad_skill_md(&project_slug, resolved);
    files.push(build_file_preview(
        ws_root,
        squad_dir.join("SKILL.md"),
        skill_md,
    )?);

    for (role_id, role) in &resolved.roles {
        validate_safe_id(role_id, "role id")?;
        let role_md = render_role_md(&project_slug, role);
        files.push(build_file_preview(
            ws_root,
            squad_dir.join("roles").join(format!("{role_id}.md")),
            role_md,
        )?);
    }

    let mut written_files = Vec::new();
    for file in &files {
        if file.changed {
            atomic_write_file(Path::new(&file.path), file.new_content.as_bytes())?;
            written_files.push(file.path.clone());
        }
    }

    let roles_dir = squad_dir.join("roles");
    if roles_dir.exists() && roles_dir.is_dir() {
        ensure_within_workspace(ws_root, &roles_dir)?;
        let mut orphan_paths = Vec::new();
        for entry in fs::read_dir(&roles_dir)? {
            let entry = entry?;
            let file_path = entry.path();
            if !file_path.is_file() {
                continue;
            }
            if file_path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            if let Some(stem) = file_path.file_stem().and_then(|s| s.to_str()) {
                if !resolved.roles.contains_key(stem) {
                    ensure_within_workspace(ws_root, &file_path)?;
                    orphan_paths.push(file_path);
                }
            }
        }
        orphan_paths.sort();
        for orphan_path in orphan_paths {
            fs::remove_file(&orphan_path)?;
            written_files.push(orphan_path.display().to_string());
        }
    }

    let (backup_path, _) = if resolved.enabled {
        sync_project_settings(&paths.settings_path(), project_id, resolved)?
    } else {
        (
            remove_project_settings_override(&paths.settings_path(), project_id)?,
            serde_json::Value::Null,
        )
    };

    Ok(SyncResult {
        project_id: project_id.to_string(),
        workspace_root: workspace_root.to_string(),
        preset_id: resolved.id.clone(),
        written_files,
        settings_path: paths.settings_path().display().to_string(),
        backup_path: backup_path.map(|p| p.display().to_string()),
        active_instance_id: resolved.orchestrator.provider_instance_id.clone(),
        active_model: resolved.orchestrator.model.clone(),
        rebalanced_roles_count: 0,
        rebalanced_roles: Vec::new(),
    })
}

fn apply_preset_to_project_unlocked(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
    preset_id_or_custom: Option<String>,
    custom_preset: Option<PresetConfig>,
) -> AppResult<SyncResult> {
    ensure_seed_presets_unlocked(&paths.presets_dir)?;

    let mut target_preset: PresetConfig = if let Some(custom) = custom_preset {
        custom
    } else if let Some(preset_id) = preset_id_or_custom {
        if preset_id == "custom" {
            let resolved_proj =
                get_project_preset_unlocked(paths, project_id, workspace_root, None)?;
            resolved_proj
                .raw_local_preset
                .unwrap_or(resolved_proj.resolved_preset)
        } else {
            validate_safe_id(&preset_id, "preset id")?;
            resolve_global_preset_unlocked(&paths.presets_dir, &preset_id)?
        }
    } else {
        let resolved_proj = get_project_preset_unlocked(paths, project_id, workspace_root, None)?;
        resolved_proj
            .raw_local_preset
            .unwrap_or(resolved_proj.resolved_preset)
    };

    validate_safe_id(&target_preset.id, "preset id")?;
    for role_id in target_preset.roles.keys() {
        validate_safe_id(role_id, "role id")?;
    }
    target_preset.disabled_roles = normalize_disabled_roles(&target_preset.disabled_roles)?;
    for disabled_id in &target_preset.disabled_roles {
        target_preset.roles.remove(disabled_id);
    }

    let resolved =
        resolve_preset_inheritance_unlocked(&paths.presets_dir, target_preset.clone())?;
    let ws_root = Path::new(workspace_root);
    if !ws_root.exists() {
        return Err(AppError::NotFound(format!(
            "Workspace root does not exist: {workspace_root}"
        )));
    }
    let preset_json_content = format!(
        "// Oh My T3Code project preset\n{}\n",
        serde_json::to_string_pretty(&target_preset)?
    );
    let local_preset_file = build_file_preview(
        ws_root,
        local_preset_path(ws_root),
        preset_json_content,
    )?;

    compile_resolved_project_unlocked(
        paths,
        project_id,
        workspace_root,
        &resolved,
        Some(local_preset_file),
    )
}

fn migrate_role_to_codex_model(role: &mut RoleConfig, next_model: &str) {
    role.provider_instance_id = "codex".to_string();
    role.model = next_model.to_string();
    role.options.remove("thinkingLevel");
    role.options.remove("thinking_level");
    role.options
        .entry("reasoningEffort".to_string())
        .or_insert_with(|| "medium".to_string());
    role.options
        .entry("serviceTier".to_string())
        .or_insert_with(|| "default".to_string());
}

fn migrate_role_to_agy_instance(role: &mut RoleConfig, next_instance: &str) {
    role.provider_instance_id = next_instance.to_string();
    if let Some(legacy_val) = role.options.remove("thinkingLevel") {
        role.options
            .entry("thinking_level".to_string())
            .or_insert(legacy_val);
    }
    if !role.model.starts_with("gemini-4-") {
        role.model = "gemini-4-hydrogen".to_string();
        role.options
            .insert("thinking_level".to_string(), "high".to_string());
    }
}

/// Quick toggle between `antigravity` ↔ `antigravity_2` or `gpt-6.1-sol` ↔ `gpt-6.1-terra` (for `codex`) for a project.
pub fn swap_project_primary_instance(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
) -> AppResult<SyncResult> {
    swap_project_primary_instance_with_options(paths, project_id, workspace_root, false)
}

/// Quick toggle between `antigravity` ↔ `antigravity_2` or `gpt-6.1-sol` ↔ `gpt-6.1-terra` (for `codex`) for a project,
/// optionally migrating matching squad worker roles as well.
pub fn swap_project_primary_instance_with_options(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
    include_roles: bool,
) -> AppResult<SyncResult> {
    let _guard = lock_config_state();
    let settings = read_t3_settings(&paths.settings_path());
    let current_resolved = get_project_preset_unlocked(paths, project_id, workspace_root, None)?;

    if !current_resolved.resolved_preset.enabled
        || current_resolved
            .raw_local_preset
            .as_ref()
            .is_some_and(|p| !p.enabled)
    {
        return Err(AppError::InvalidInput(
            "Override do projeto está pausado. Reative-o antes de inverter a instância.".into(),
        ));
    }

    let current_instance = settings
        .project_overrides
        .get(project_id)
        .map(|s| s.instance_id.clone())
        .unwrap_or_else(|| {
            current_resolved
                .resolved_preset
                .orchestrator
                .provider_instance_id
                .clone()
        });
    let current_model = settings
        .project_overrides
        .get(project_id)
        .map(|s| s.model.clone())
        .unwrap_or_else(|| current_resolved.resolved_preset.orchestrator.model.clone());

    let resolved_for_roles = current_resolved.resolved_preset.clone();
    let mut updated = current_resolved
        .raw_local_preset
        .unwrap_or_else(|| current_resolved.resolved_preset.clone());

    if updated.orchestrator.provider_instance_id.is_empty() {
        updated.orchestrator.provider_instance_id = resolved_for_roles
            .orchestrator
            .provider_instance_id
            .clone();
    }
    if updated.orchestrator.model.is_empty() {
        updated.orchestrator.model = resolved_for_roles.orchestrator.model.clone();
    }
    if updated.orchestrator.options.is_empty() {
        updated.orchestrator.options = resolved_for_roles.orchestrator.options.clone();
    }

    let disabled_set: HashSet<String> = normalize_disabled_roles(&resolved_for_roles.disabled_roles)?
        .into_iter()
        .chain(normalize_disabled_roles(&updated.disabled_roles)?)
        .collect();

    let mut rebalanced_roles = Vec::new();

    if current_instance == "codex" {
        let previous_model = current_model;
        let next_model = if previous_model == "gpt-6.1-sol" {
            "gpt-6.1-terra".to_string()
        } else {
            "gpt-6.1-sol".to_string()
        };
        updated.orchestrator.provider_instance_id = "codex".to_string();
        updated.orchestrator.model = next_model.clone();
        updated.orchestrator.options.remove("thinkingLevel");
        updated.orchestrator.options.remove("thinking_level");
        updated
            .orchestrator
            .options
            .entry("reasoningEffort".to_string())
            .or_insert_with(|| "medium".to_string());
        updated
            .orchestrator
            .options
            .entry("serviceTier".to_string())
            .or_insert_with(|| "default".to_string());

        if include_roles {
            for (role_id, resolved_role) in &resolved_for_roles.roles {
                if disabled_set.contains(role_id) {
                    continue;
                }
                if resolved_role.provider_instance_id == "codex"
                    && resolved_role.model == previous_model
                {
                    let mut migrated = resolved_role.clone();
                    migrate_role_to_codex_model(&mut migrated, &next_model);
                    updated.roles.insert(role_id.clone(), migrated);
                    rebalanced_roles.push(role_id.clone());
                }
            }
        }
    } else {
        let previous_instance = if current_instance.is_empty() {
            "antigravity".to_string()
        } else {
            current_instance
        };
        let next_instance = if previous_instance == "antigravity_2" {
            "antigravity".to_string()
        } else {
            "antigravity_2".to_string()
        };

        updated.orchestrator.provider_instance_id = next_instance.clone();
        if let Some(legacy_val) = updated.orchestrator.options.remove("thinkingLevel") {
            updated
                .orchestrator
                .options
                .entry("thinking_level".to_string())
                .or_insert(legacy_val);
        }
        if !updated.orchestrator.model.starts_with("gemini-4-") {
            updated.orchestrator.model = "gemini-4-hydrogen".to_string();
            updated
                .orchestrator
                .options
                .insert("thinking_level".to_string(), "high".to_string());
        }

        if include_roles {
            for (role_id, resolved_role) in &resolved_for_roles.roles {
                if disabled_set.contains(role_id) {
                    continue;
                }
                if resolved_role.provider_instance_id == previous_instance {
                    let mut migrated = resolved_role.clone();
                    migrate_role_to_agy_instance(&mut migrated, &next_instance);
                    updated.roles.insert(role_id.clone(), migrated);
                    rebalanced_roles.push(role_id.clone());
                }
            }
        }
    }

    let mut result =
        apply_preset_to_project_unlocked(paths, project_id, workspace_root, None, Some(updated))?;
    result.rebalanced_roles_count = rebalanced_roles.len();
    result.rebalanced_roles = rebalanced_roles;
    Ok(result)
}

/// Saves a global preset and, when it is the active global preset and global sync is enabled,
/// automatically synchronizes `defaultModelSelection` and `fallbackModelSelection` in `settings.json`.
pub fn save_global_preset_and_sync(
    paths: &AppPaths,
    preset: PresetConfig,
) -> AppResult<PresetConfig> {
    let _guard = lock_config_state();
    ensure_seed_presets_unlocked(&paths.presets_dir)?;
    let saved = save_global_preset_unlocked(&paths.presets_dir, preset)?;
    let global_cfg = load_global_config_unlocked(&paths.global_config_path());
    if saved.id == global_cfg.active_global_preset_id && global_cfg.enabled {
        sync_global_settings(&paths.settings_path(), &saved)?;
    }
    Ok(saved)
}

/// Saves the global Oh My T3Code config (`~/.config/oh-my-t3code/config.jsonc`).
/// When `enabled == true`, syncs `defaultModelSelection` and `fallbackModelSelection` to `settings.json`.
/// When `enabled == false`, removes those global override keys from `settings.json` while preserving all other keys.
pub fn set_global_preset_config(
    paths: &AppPaths,
    active_preset_id: String,
    enabled: bool,
) -> AppResult<DashboardSnapshot> {
    let _guard = lock_config_state();
    ensure_seed_presets_unlocked(&paths.presets_dir)?;
    validate_safe_id(&active_preset_id, "active_preset_id")?;
    let preset = resolve_global_preset_unlocked(&paths.presets_dir, &active_preset_id)?;

    let config = GlobalAppConfig {
        active_global_preset_id: preset.id.clone(),
        enabled,
    };
    save_global_config_unlocked(&paths.global_config_path(), &config)?;

    if enabled {
        sync_global_settings(&paths.settings_path(), &preset)?;
    } else {
        remove_global_settings_override(&paths.settings_path())?;
    }

    build_dashboard_snapshot_unlocked(paths)
}

fn extends_chain_reaches(presets_dir: &Path, start_id: &str, target_id: &str) -> bool {
    const MAX_DEPTH: usize = 16;
    let mut visited = HashSet::new();
    let mut current = start_id.to_string();

    for _ in 0..MAX_DEPTH {
        if current == target_id {
            return true;
        }
        if validate_safe_id(&current, "extends preset id").is_err() || !visited.insert(current.clone()) {
            return false;
        }
        let jsonc = presets_dir.join(format!("{current}.jsonc"));
        let json = presets_dir.join(format!("{current}.json"));
        let path = if jsonc.exists() {
            jsonc
        } else if json.exists() {
            json
        } else {
            return false;
        };
        let Ok(raw) = fs::read_to_string(&path) else {
            return false;
        };
        let clean = strip_jsonc_comments(&raw);
        let Ok(val) = serde_json::from_str::<serde_json::Value>(&clean) else {
            return false;
        };
        match val.get("extends").and_then(|v| v.as_str()) {
            Some(parent_id) if !parent_id.is_empty() => current = parent_id.to_string(),
            _ => return false,
        }
    }

    false
}

fn is_active_inherited_project(
    presets_dir: &Path,
    workspace_root: &str,
    active_global_preset_id: &str,
) -> bool {
    let local_path = local_preset_path(Path::new(workspace_root));
    if !local_path.is_file() {
        return false;
    }
    let Ok(raw) = fs::read_to_string(&local_path) else {
        return false;
    };
    let clean = strip_jsonc_comments(&raw);
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&clean) else {
        return false;
    };
    let enabled = val.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
    if !enabled {
        return false;
    }
    match val.get("extends").and_then(|v| v.as_str()) {
        Some(parent_id) if !parent_id.is_empty() => {
            extends_chain_reaches(presets_dir, parent_id, active_global_preset_id)
        }
        _ => false,
    }
}

fn resync_inherited_project_unlocked(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
) -> AppResult<SyncResult> {
    let ws_root = Path::new(workspace_root);
    if !ws_root.exists() {
        return Err(AppError::NotFound(format!(
            "Workspace root does not exist: {workspace_root}"
        )));
    }
    let local_path = local_preset_path(ws_root);
    ensure_within_workspace(ws_root, &local_path)?;
    let raw = fs::read_to_string(&local_path)?;
    let project_slug = derive_project_slug(workspace_root);
    let mut resolved =
        resolve_jsonc_against_globals_unlocked(&paths.presets_dir, &raw, &project_slug)?;
    if !resolved.enabled {
        return Err(AppError::InvalidInput(
            "Override do projeto está pausado; re-sync ignorado.".into(),
        ));
    }
    resolved.disabled_roles = normalize_disabled_roles(&resolved.disabled_roles)?;
    for disabled_id in &resolved.disabled_roles {
        resolved.roles.remove(disabled_id);
    }

    compile_resolved_project_unlocked(paths, project_id, workspace_root, &resolved, None)
}

/// Quick toggle on the active global preset:
/// - For Agy presets (`antigravity` / `antigravity_2`): toggles `antigravity` ↔ `antigravity_2`.
/// - For Codex presets (`codex`, such as `default`): toggles orchestrator model `gpt-6.1-sol` ↔ `gpt-6.1-terra`.
pub fn swap_global_instance(paths: &AppPaths) -> AppResult<DashboardSnapshot> {
    swap_global_instance_with_options(paths, false, false)
}

/// Quick toggle on the active global preset with optional worker role rebalancing
/// and optional re-compilation of active projects inheriting from the active global preset.
pub fn swap_global_instance_with_options(
    paths: &AppPaths,
    include_roles: bool,
    resync_inherited: bool,
) -> AppResult<DashboardSnapshot> {
    let _guard = lock_config_state();
    ensure_seed_presets_unlocked(&paths.presets_dir)?;
    let global_cfg = load_global_config_unlocked(&paths.global_config_path());
    if !global_cfg.enabled {
        return Err(AppError::InvalidInput(
            "Preset global está desativado. Reative-o antes de inverter a instância.".into(),
        ));
    }
    let mut preset =
        resolve_global_preset_unlocked(&paths.presets_dir, &global_cfg.active_global_preset_id)?;

    let mut rebalanced_roles = Vec::new();

    if preset.orchestrator.provider_instance_id == "codex" {
        let previous_model = preset.orchestrator.model.clone();
        let next_model = if previous_model == "gpt-6.1-sol" {
            "gpt-6.1-terra".to_string()
        } else {
            "gpt-6.1-sol".to_string()
        };
        let opposite_model = if next_model == "gpt-6.1-sol" {
            "gpt-6.1-terra".to_string()
        } else {
            "gpt-6.1-sol".to_string()
        };

        preset.orchestrator.model = next_model.clone();
        preset.orchestrator.options.remove("thinkingLevel");
        preset.orchestrator.options.remove("thinking_level");
        preset
            .orchestrator
            .options
            .entry("reasoningEffort".to_string())
            .or_insert_with(|| "medium".to_string());
        preset
            .orchestrator
            .options
            .entry("serviceTier".to_string())
            .or_insert_with(|| "default".to_string());

        if let Some(first_fb) = preset.fallback_chain.first_mut() {
            if first_fb.provider_instance_id == "codex" && first_fb.model == next_model {
                first_fb.model = opposite_model;
            }
        }

        if include_roles {
            for (role_id, role) in &mut preset.roles {
                if role.provider_instance_id == "codex" && role.model == previous_model {
                    migrate_role_to_codex_model(role, &next_model);
                    rebalanced_roles.push(role_id.clone());
                }
            }
        }
    } else {
        let previous_instance = if preset.orchestrator.provider_instance_id.is_empty() {
            "antigravity".to_string()
        } else {
            preset.orchestrator.provider_instance_id.clone()
        };
        let next_instance = if previous_instance == "antigravity_2" {
            "antigravity".to_string()
        } else {
            "antigravity_2".to_string()
        };
        let opposite_instance = if next_instance == "antigravity_2" {
            "antigravity".to_string()
        } else {
            "antigravity_2".to_string()
        };

        preset.orchestrator.provider_instance_id = next_instance.clone();
        if let Some(legacy_val) = preset.orchestrator.options.remove("thinkingLevel") {
            preset
                .orchestrator
                .options
                .entry("thinking_level".to_string())
                .or_insert(legacy_val);
        }
        if !preset.orchestrator.model.starts_with("gemini-4-") {
            preset.orchestrator.model = "gemini-4-hydrogen".to_string();
            preset
                .orchestrator
                .options
                .insert("thinking_level".to_string(), "high".to_string());
        }

        if let Some(first_fb) = preset.fallback_chain.first_mut() {
            if first_fb.provider_instance_id == next_instance {
                first_fb.provider_instance_id = opposite_instance;
            }
        }

        if include_roles {
            for (role_id, role) in &mut preset.roles {
                if role.provider_instance_id == previous_instance {
                    migrate_role_to_agy_instance(role, &next_instance);
                    rebalanced_roles.push(role_id.clone());
                }
            }
        }
    }

    let saved = save_global_preset_unlocked(&paths.presets_dir, preset)?;
    save_global_config_unlocked(&paths.global_config_path(), &global_cfg)?;

    if global_cfg.enabled {
        sync_global_settings(&paths.settings_path(), &saved)?;
    }

    let mut resynced_projects = Vec::new();
    let mut failed_projects = Vec::new();

    if resync_inherited {
        let known_projects = list_known_projects_readonly(&paths.sqlite_path())?;
        for (project_id, title, workspace_root) in known_projects {
            if !is_active_inherited_project(&paths.presets_dir, &workspace_root, &saved.id) {
                continue;
            }
            match resync_inherited_project_unlocked(paths, &project_id, &workspace_root) {
                Ok(sync_res) => {
                    resynced_projects.push(ResyncedProjectReport {
                        project_id,
                        title,
                        workspace_root,
                        preset_id: sync_res.preset_id,
                        written_files: sync_res.written_files,
                    });
                }
                Err(err) => {
                    failed_projects.push(FailedProjectResync {
                        project_id,
                        title,
                        workspace_root,
                        error: err.to_string(),
                    });
                }
            }
        }
    }

    let mut snapshot = build_dashboard_snapshot_unlocked(paths)?;
    snapshot.last_global_swap_report = Some(GlobalSwapReport {
        include_roles,
        resync_inherited,
        rebalanced_roles_count: rebalanced_roles.len(),
        rebalanced_roles,
        resynced_projects,
        failed_projects,
    });
    Ok(snapshot)
}

/// Enables or disables a project's preset without deleting `.t3code/preset.jsonc`.
/// When `enabled == false`, removes `projectSettingsOverrides[project_id]` from `settings.json`.
/// When `enabled == true`, compiles `.agents/skills/<slug>-squad/` and syncs `projectSettingsOverrides[project_id]`.
pub fn set_project_preset_enabled(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
    enabled: bool,
) -> AppResult<SyncResult> {
    let _guard = lock_config_state();
    ensure_seed_presets_unlocked(&paths.presets_dir)?;
    let current = get_project_preset_unlocked(paths, project_id, workspace_root, None)?;
    let mut target_preset = current.raw_local_preset.unwrap_or(current.resolved_preset);
    target_preset.enabled = enabled;

    if enabled {
        return apply_preset_to_project_unlocked(
            paths,
            project_id,
            workspace_root,
            None,
            Some(target_preset),
        );
    }

    let saved = save_project_preset_unlocked(paths, project_id, workspace_root, target_preset)?;
    let backup_path = remove_project_settings_override(&paths.settings_path(), project_id)?;
    let preset_path = local_preset_path(Path::new(workspace_root));

    Ok(SyncResult {
        project_id: project_id.to_string(),
        workspace_root: workspace_root.to_string(),
        preset_id: saved.resolved_preset.id,
        written_files: vec![preset_path.display().to_string()],
        settings_path: paths.settings_path().display().to_string(),
        backup_path: backup_path.map(|p| p.display().to_string()),
        active_instance_id: saved.resolved_preset.orchestrator.provider_instance_id,
        active_model: saved.resolved_preset.orchestrator.model,
        rebalanced_roles_count: 0,
        rebalanced_roles: Vec::new(),
    })
}

/// Removes a project's custom override (`.t3code/preset.jsonc` and `projectSettingsOverrides[project_id]`),
/// reverting the project to follow the global default configuration.
pub fn remove_project_override(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
) -> AppResult<DashboardSnapshot> {
    let _guard = lock_config_state();
    let ws_root = Path::new(workspace_root);
    if !ws_root.exists() {
        return Err(AppError::NotFound(format!(
            "Workspace root does not exist: {workspace_root}"
        )));
    }

    let preset_path = local_preset_path(ws_root);
    ensure_within_workspace(ws_root, &preset_path)?;
    if preset_path.exists() {
        fs::remove_file(&preset_path)?;
        if let Some(t3code_dir) = preset_path.parent() {
            if t3code_dir.is_dir()
                && fs::read_dir(t3code_dir)
                    .map(|mut entries| entries.next().is_none())
                    .unwrap_or(false)
            {
                let _ = fs::remove_dir(t3code_dir);
            }
        }
    }

    let project_slug = derive_project_slug(workspace_root);
    let agents_dir = ws_root.join(".agents");
    let skills_dir = agents_dir.join("skills");
    let squad_dir = skills_dir.join(format!("{project_slug}-squad"));
    ensure_within_workspace(ws_root, &squad_dir)?;

    let skill_md_path = squad_dir.join("SKILL.md");
    ensure_within_workspace(ws_root, &skill_md_path)?;
    if skill_md_path.is_file() {
        let content = fs::read_to_string(&skill_md_path)?;
        if content.contains("— Playbook do Orquestrador (T3 Code)") {
            fs::remove_dir_all(&squad_dir)?;
            if skills_dir.is_dir()
                && fs::read_dir(&skills_dir)
                    .map(|mut entries| entries.next().is_none())
                    .unwrap_or(false)
            {
                let _ = fs::remove_dir(&skills_dir);
            }
            if agents_dir.is_dir()
                && fs::read_dir(&agents_dir)
                    .map(|mut entries| entries.next().is_none())
                    .unwrap_or(false)
            {
                let _ = fs::remove_dir(&agents_dir);
            }
        }
    }

    remove_project_settings_override(&paths.settings_path(), project_id)?;
    build_dashboard_snapshot_unlocked(paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preset_engine::{
        default_seed_presets, ensure_seed_presets, get_project_preset, load_global_config,
        resolve_global_preset,
    };
    use tempfile::tempdir;

    #[test]
    fn compiler_is_deterministic_and_empty_diff_when_synced() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("presets");
        let ws = dir.path().join("my-app");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::create_dir_all(&ws).unwrap();
        fs::write(t3_home.join("userdata").join("settings.json"), "{}").unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };
        ensure_seed_presets(&paths.presets_dir).unwrap();
        let preset = default_seed_presets()
            .into_iter()
            .find(|p| p.id == "agy-dual")
            .unwrap();

        let p1 = compile_preset_preview(&paths, "proj-1", ws.to_str().unwrap(), &preset).unwrap();
        let p2 = compile_preset_preview(&paths, "proj-1", ws.to_str().unwrap(), &preset).unwrap();
        assert_eq!(p1.files.len(), p2.files.len());
        for (a, b) in p1.files.iter().zip(p2.files.iter()) {
            assert_eq!(a.new_content.as_bytes(), b.new_content.as_bytes());
        }
        assert!(p1.has_changes);

        // Apply to disk
        let sync_res = apply_preset_to_project(
            &paths,
            "proj-1",
            ws.to_str().unwrap(),
            None,
            Some(preset.clone()),
        )
        .unwrap();
        assert!(!sync_res.written_files.is_empty());

        // Preview again -> zero diff!
        let p3 = compile_preset_preview(&paths, "proj-1", ws.to_str().unwrap(), &preset).unwrap();
        assert!(!p3.has_changes);
        assert!(!p3.settings_preview.changed);
        for f in &p3.files {
            assert!(!f.changed);
            assert!(f.unified_diff.is_empty());
        }
    }

    #[test]
    fn swap_project_primary_instance_toggles_codex_and_antigravity_accounts() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("presets");
        let ws = dir.path().join("swap-app");
        let ws_agy = dir.path().join("swap-agy-app");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::create_dir_all(&ws).unwrap();
        fs::create_dir_all(&ws_agy).unwrap();
        fs::write(t3_home.join("userdata").join("settings.json"), "{}").unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        // Default preset uses codex / gpt-6.1-sol -> swaps to gpt-6.1-terra and back
        let codex_1 =
            swap_project_primary_instance(&paths, "proj-swap-codex", ws.to_str().unwrap()).unwrap();
        assert_eq!(codex_1.active_instance_id, "codex");
        assert_eq!(codex_1.active_model, "gpt-6.1-terra");

        let codex_2 =
            swap_project_primary_instance(&paths, "proj-swap-codex", ws.to_str().unwrap()).unwrap();
        assert_eq!(codex_2.active_instance_id, "codex");
        assert_eq!(codex_2.active_model, "gpt-6.1-sol");

        // Agy project using agy-dual toggles antigravity_2 <-> antigravity
        apply_preset_to_project(
            &paths,
            "proj-swap-agy",
            ws_agy.to_str().unwrap(),
            Some("agy-dual".to_string()),
            None,
        )
        .unwrap();
        let res1 =
            swap_project_primary_instance(&paths, "proj-swap-agy", ws_agy.to_str().unwrap())
                .unwrap();
        assert_eq!(res1.active_instance_id, "antigravity");

        let res2 =
            swap_project_primary_instance(&paths, "proj-swap-agy", ws_agy.to_str().unwrap())
                .unwrap();
        assert_eq!(res2.active_instance_id, "antigravity_2");
    }

    #[test]
    fn global_config_sync_and_swap_global_instance_update_settings_and_config() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let config_dir = dir.path().join("oh-my-t3code");
        let presets_dir = config_dir.join("presets");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::write(
            t3_home.join("userdata").join("settings.json"),
            r#"{"favorites":["keep-me"]}"#,
        )
        .unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        // Initial default preset: codex / gpt-6.1-sol -> swap flips gpt-6.1-sol <-> gpt-6.1-terra
        let snap0 = set_global_preset_config(&paths, "default".to_string(), true).unwrap();
        assert_eq!(snap0.global_config.active_global_preset_id, "default");
        assert!(snap0.global_config.enabled);
        assert_eq!(
            snap0.default_model_selection.as_ref().unwrap().instance_id,
            "codex"
        );
        assert_eq!(
            snap0.default_model_selection.as_ref().unwrap().model,
            "gpt-6.1-sol"
        );
        assert_eq!(
            snap0.fallback_model_selection.as_ref().unwrap().model,
            "gpt-6.1-terra"
        );

        let snap0_swapped = swap_global_instance(&paths).unwrap();
        assert_eq!(
            snap0_swapped.default_model_selection.as_ref().unwrap().instance_id,
            "codex"
        );
        assert_eq!(
            snap0_swapped.default_model_selection.as_ref().unwrap().model,
            "gpt-6.1-terra"
        );
        assert_eq!(
            snap0_swapped.fallback_model_selection.as_ref().unwrap().model,
            "gpt-6.1-sol"
        );

        let snap0_restored = swap_global_instance(&paths).unwrap();
        assert_eq!(
            snap0_restored.default_model_selection.as_ref().unwrap().model,
            "gpt-6.1-sol"
        );

        // Switching to agy-dual and swapping toggles antigravity_2 <-> antigravity
        let snap1 = set_global_preset_config(&paths, "agy-dual".to_string(), true).unwrap();
        assert_eq!(snap1.global_config.active_global_preset_id, "agy-dual");
        assert!(snap1.global_config.enabled);
        assert!(paths.global_config_path().exists());
        assert_eq!(
            snap1.default_model_selection.as_ref().unwrap().instance_id,
            "antigravity_2"
        );
        assert_eq!(
            snap1.fallback_model_selection.as_ref().unwrap().instance_id,
            "antigravity"
        );

        let snap2 = swap_global_instance(&paths).unwrap();
        assert_eq!(
            snap2.default_model_selection.as_ref().unwrap().instance_id,
            "antigravity"
        );
        assert_eq!(
            snap2.fallback_model_selection.as_ref().unwrap().instance_id,
            "antigravity_2"
        );

        // Disable global config: settings.json removes global model selections, keeps favorites, and config.jsonc records enabled: false
        let snap3 = set_global_preset_config(&paths, "codex-squad".to_string(), false).unwrap();
        assert_eq!(snap3.global_config.active_global_preset_id, "codex-squad");
        assert!(!snap3.global_config.enabled);
        assert!(snap3.default_model_selection.is_none());
        assert!(snap3.fallback_model_selection.is_none());
        let settings_raw: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(paths.settings_path()).unwrap()).unwrap();
        assert_eq!(settings_raw["favorites"], serde_json::json!(["keep-me"]));
        assert!(settings_raw.get("defaultModelSelection").is_none());
        assert!(settings_raw.get("fallbackModelSelection").is_none());

        // Re-enable global config: settings.json restores defaultModelSelection and fallbackModelSelection for codex-squad
        let snap4 = set_global_preset_config(&paths, "codex-squad".to_string(), true).unwrap();
        assert!(snap4.global_config.enabled);
        assert_eq!(
            snap4.default_model_selection.as_ref().unwrap().instance_id,
            "codex"
        );
    }

    #[test]
    fn project_preset_enable_toggle_and_remove_override_work_safely() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("oh-my-t3code").join("presets");
        let ws = dir.path().join("proj-toggle");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::create_dir_all(&ws).unwrap();
        fs::write(t3_home.join("userdata").join("settings.json"), "{}").unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        // Enable with codex-squad first
        apply_preset_to_project(
            &paths,
            "proj-1",
            ws.to_str().unwrap(),
            Some("codex-squad".to_string()),
            None,
        )
        .unwrap();
        assert!(local_preset_path(&ws).exists());

        // Disable preserves .t3code/preset.jsonc with enabled: false and removes override from settings.json
        set_project_preset_enabled(&paths, "proj-1", ws.to_str().unwrap(), false).unwrap();
        assert!(local_preset_path(&ws).exists());
        let resolved_off =
            get_project_preset(&paths, "proj-1", ws.to_str().unwrap(), None).unwrap();
        assert!(!resolved_off.resolved_preset.enabled);
        let settings_off = read_t3_settings(&paths.settings_path());
        assert!(!settings_off.project_overrides.contains_key("proj-1"));

        // Re-enable restores override in settings.json
        set_project_preset_enabled(&paths, "proj-1", ws.to_str().unwrap(), true).unwrap();
        let resolved_on =
            get_project_preset(&paths, "proj-1", ws.to_str().unwrap(), None).unwrap();
        assert!(resolved_on.resolved_preset.enabled);
        let settings_on = read_t3_settings(&paths.settings_path());
        assert!(settings_on.project_overrides.contains_key("proj-1"));

        // Remove override deletes .t3code/preset.jsonc and removes projectSettingsOverrides entry
        remove_project_override(&paths, "proj-1", ws.to_str().unwrap()).unwrap();
        assert!(!local_preset_path(&ws).exists());
        let settings_removed = read_t3_settings(&paths.settings_path());
        assert!(!settings_removed.project_overrides.contains_key("proj-1"));
    }

    #[test]
    fn concurrent_swap_global_instance_serializes_rmw_without_lost_updates() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("oh-my-t3code").join("presets");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::write(
            t3_home.join("userdata").join("settings.json"),
            r#"{"favorites":["keep-me"]}"#,
        )
        .unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        // Start on agy-dual -> orchestrator is antigravity_2
        let init = set_global_preset_config(&paths, "agy-dual".to_string(), true).unwrap();
        assert_eq!(
            init.default_model_selection.as_ref().unwrap().instance_id,
            "antigravity_2"
        );

        let swap_threads = 8usize;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(swap_threads));
        let mut handles = Vec::with_capacity(swap_threads);
        for tid in 0..swap_threads {
            let paths_clone = paths.clone();
            let barrier = barrier.clone();
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                swap_global_instance(&paths_clone)
                    .unwrap_or_else(|e| panic!("thread {tid} swap_global_instance failed: {e}"))
            }));
        }

        let mut results = Vec::with_capacity(swap_threads);
        for h in handles {
            results.push(h.join().expect("swap thread must not panic"));
        }

        // Because 8 swaps ran sequentially under lock, half must return antigravity and half antigravity_2
        let agy1_count = results
            .iter()
            .filter(|s| {
                s.default_model_selection.as_ref().map(|m| m.instance_id.as_str())
                    == Some("antigravity")
            })
            .count();
        let agy2_count = results
            .iter()
            .filter(|s| {
                s.default_model_selection.as_ref().map(|m| m.instance_id.as_str())
                    == Some("antigravity_2")
            })
            .count();
        assert_eq!(
            agy1_count, 4,
            "expected 4 antigravity outcomes, got {agy1_count} (lost update under concurrency)"
        );
        assert_eq!(
            agy2_count, 4,
            "expected 4 antigravity_2 outcomes, got {agy2_count} (lost update under concurrency)"
        );

        // Even number of swaps (8) from antigravity_2 must end back on antigravity_2
        let final_settings = read_t3_settings(&paths.settings_path());
        assert_eq!(
            final_settings.default_model_selection.unwrap().instance_id,
            "antigravity_2"
        );
        let final_preset = resolve_global_preset(&paths.presets_dir, "agy-dual").unwrap();
        assert_eq!(final_preset.orchestrator.provider_instance_id, "antigravity_2");
    }

    #[test]
    fn concurrent_set_global_preset_and_apply_project_presets_never_corrupt_state() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("oh-my-t3code").join("presets");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::write(
            t3_home.join("userdata").join("settings.json"),
            r#"{"favorites":["keep-me"]}"#,
        )
        .unwrap();

        let project_count = 6usize;
        let mut workspaces = Vec::with_capacity(project_count);
        for i in 0..project_count {
            let ws = dir.path().join(format!("proj-{i}"));
            fs::create_dir_all(&ws).unwrap();
            workspaces.push(ws);
        }

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        let global_threads = 4usize;
        let total = project_count + global_threads;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(total));
        let mut handles = Vec::with_capacity(total);

        for (i, ws) in workspaces.iter().enumerate() {
            let paths_clone = paths.clone();
            let ws_str = ws.to_str().unwrap().to_string();
            let barrier = barrier.clone();
            let preset_id = if i % 2 == 0 { "agy-dual" } else { "codex-squad" };
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                apply_preset_to_project(
                    &paths_clone,
                    &format!("proj-{i}"),
                    &ws_str,
                    Some(preset_id.to_string()),
                    None,
                )
                .unwrap_or_else(|e| panic!("apply_preset_to_project proj-{i} failed: {e}"));
            }));
        }

        for i in 0..global_threads {
            let paths_clone = paths.clone();
            let barrier = barrier.clone();
            let preset_id = if i % 2 == 0 { "default" } else { "agy-dual" };
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                set_global_preset_config(&paths_clone, preset_id.to_string(), true)
                    .unwrap_or_else(|e| panic!("set_global_preset_config {i} failed: {e}"));
            }));
        }

        for h in handles {
            h.join().expect("worker thread must not panic");
        }

        let settings = read_t3_settings(&paths.settings_path());
        assert!(settings.available, "settings.json must remain valid JSON");
        for (i, ws) in workspaces.iter().enumerate() {
            assert!(
                settings.project_overrides.contains_key(&format!("proj-{i}")),
                "missing projectSettingsOverrides['proj-{i}']"
            );
            assert!(local_preset_path(ws).exists());
        }
        let cfg = load_global_config(&paths.global_config_path());
        assert!(cfg.enabled);
    }

    #[test]
    fn swap_global_instance_rejects_when_global_disabled_without_mutating_files() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("oh-my-t3code").join("presets");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::write(
            t3_home.join("userdata").join("settings.json"),
            r#"{"favorites":["keep-me"]}"#,
        )
        .unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        set_global_preset_config(&paths, "agy-dual".to_string(), true).unwrap();
        set_global_preset_config(&paths, "agy-dual".to_string(), false).unwrap();

        let preset_before = fs::read_to_string(paths.presets_dir.join("agy-dual.jsonc")).unwrap();
        let settings_before = fs::read_to_string(paths.settings_path()).unwrap();

        let err = swap_global_instance(&paths).unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
        assert!(
            err.to_string()
                .contains("Preset global está desativado"),
            "unexpected error message: {err}"
        );

        // Neither presets/<id>.jsonc nor settings.json may be mutated
        let preset_after = fs::read_to_string(paths.presets_dir.join("agy-dual.jsonc")).unwrap();
        let settings_after = fs::read_to_string(paths.settings_path()).unwrap();
        assert_eq!(preset_before, preset_after);
        assert_eq!(settings_before, settings_after);
    }

    #[test]
    fn save_global_preset_and_sync_updates_settings_only_when_active_and_enabled() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("oh-my-t3code").join("presets");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::write(
            t3_home.join("userdata").join("settings.json"),
            r#"{"favorites":["keep-me"]}"#,
        )
        .unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        // Active global is agy-dual with enabled: true
        set_global_preset_config(&paths, "agy-dual".to_string(), true).unwrap();

        // 1. Editing and saving the active global preset syncs settings.json immediately
        let mut edited_agy = resolve_global_preset(&paths.presets_dir, "agy-dual").unwrap();
        edited_agy.orchestrator.provider_instance_id = "antigravity".to_string();
        edited_agy.orchestrator.model = "gemini-4-argon".to_string();
        let saved = save_global_preset_and_sync(&paths, edited_agy).unwrap();
        assert_eq!(saved.orchestrator.provider_instance_id, "antigravity");
        assert_eq!(saved.orchestrator.model, "gemini-4-argon");

        let settings_after_active: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(paths.settings_path()).unwrap()).unwrap();
        assert_eq!(
            settings_after_active["defaultModelSelection"]["instanceId"],
            "antigravity"
        );
        assert_eq!(
            settings_after_active["defaultModelSelection"]["model"],
            "gemini-4-argon"
        );
        assert_eq!(
            settings_after_active["favorites"],
            serde_json::json!(["keep-me"])
        );

        // 2. Saving a NON-active global preset does NOT overwrite settings.json
        let mut edited_codex = resolve_global_preset(&paths.presets_dir, "codex-squad").unwrap();
        edited_codex.orchestrator.model = "gpt-6.1-terra".to_string();
        save_global_preset_and_sync(&paths, edited_codex).unwrap();

        let settings_after_inactive: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(paths.settings_path()).unwrap()).unwrap();
        assert_eq!(
            settings_after_inactive["defaultModelSelection"]["instanceId"],
            "antigravity"
        );
        assert_eq!(
            settings_after_inactive["defaultModelSelection"]["model"],
            "gemini-4-argon"
        );

        // 3. When global config is paused (enabled: false), saving the active preset does NOT write to settings.json
        set_global_preset_config(&paths, "agy-dual".to_string(), false).unwrap();
        let mut edited_paused = resolve_global_preset(&paths.presets_dir, "agy-dual").unwrap();
        edited_paused.orchestrator.model = "gemini-4-hydrogen".to_string();
        save_global_preset_and_sync(&paths, edited_paused).unwrap();

        let settings_after_paused: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(paths.settings_path()).unwrap()).unwrap();
        assert!(settings_after_paused.get("defaultModelSelection").is_none());
        assert!(settings_after_paused.get("fallbackModelSelection").is_none());
    }

    #[test]
    fn swap_project_primary_instance_rejects_when_paused_without_mutating_files() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("oh-my-t3code").join("presets");
        let ws = dir.path().join("proj-paused-swap");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::create_dir_all(&ws).unwrap();
        fs::write(
            t3_home.join("userdata").join("settings.json"),
            r#"{"favorites":["keep-me"]}"#,
        )
        .unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        apply_preset_to_project(
            &paths,
            "proj-paused",
            ws.to_str().unwrap(),
            Some("agy-dual".to_string()),
            None,
        )
        .unwrap();
        set_project_preset_enabled(&paths, "proj-paused", ws.to_str().unwrap(), false).unwrap();

        let preset_before = fs::read_to_string(local_preset_path(&ws)).unwrap();
        let settings_before = fs::read_to_string(paths.settings_path()).unwrap();
        let settings_parsed: serde_json::Value = serde_json::from_str(&settings_before).unwrap();
        assert!(settings_parsed["projectSettingsOverrides"]
            .get("proj-paused")
            .is_none());

        let err =
            swap_project_primary_instance(&paths, "proj-paused", ws.to_str().unwrap()).unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
        assert!(
            err.to_string().contains("Override do projeto está pausado"),
            "unexpected error: {err}"
        );

        let preset_after = fs::read_to_string(local_preset_path(&ws)).unwrap();
        let settings_after = fs::read_to_string(paths.settings_path()).unwrap();
        assert_eq!(preset_before, preset_after);
        assert_eq!(settings_before, settings_after);
    }

    #[test]
    fn apply_preset_to_project_prunes_orphan_roles_and_respects_enabled_false() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("oh-my-t3code").join("presets");
        let ws = dir.path().join("proj-prune");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::create_dir_all(&ws).unwrap();
        fs::write(
            t3_home.join("userdata").join("settings.json"),
            r#"{"favorites":["keep-me"]}"#,
        )
        .unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        // 1. Apply full agy-dual -> writes all 5 canonical roles/*.md and settings override
        apply_preset_to_project(
            &paths,
            "proj-prune",
            ws.to_str().unwrap(),
            Some("agy-dual".to_string()),
            None,
        )
        .unwrap();

        let roles_dir = ws
            .join(".agents")
            .join("skills")
            .join("proj-prune-squad")
            .join("roles");
        assert!(roles_dir.join("qa-reviewer.md").exists());
        assert!(roles_dir.join("designer.md").exists());

        // Inject an extra orphan markdown file in roles/
        fs::write(roles_dir.join("stale-role.md"), "# Stale\n").unwrap();

        // 2. Apply reduced preset (disabled_roles removes qa-reviewer and designer)
        let mut reduced = resolve_global_preset(&paths.presets_dir, "agy-dual").unwrap();
        reduced.id = "proj-prune-custom".to_string();
        reduced.extends = Some("agy-dual".to_string());
        reduced.roles.remove("qa-reviewer");
        reduced.roles.remove("designer");
        reduced.disabled_roles = vec!["qa-reviewer".to_string(), "designer".to_string()];

        let res_reduced = apply_preset_to_project(
            &paths,
            "proj-prune",
            ws.to_str().unwrap(),
            None,
            Some(reduced.clone()),
        )
        .unwrap();

        assert!(!roles_dir.join("qa-reviewer.md").exists());
        assert!(!roles_dir.join("designer.md").exists());
        assert!(!roles_dir.join("stale-role.md").exists());
        assert!(roles_dir.join("explorer.md").exists());
        assert!(roles_dir.join("oracle.md").exists());
        assert!(roles_dir.join("fixer.md").exists());
        assert!(res_reduced
            .written_files
            .iter()
            .any(|p| p.ends_with("qa-reviewer.md")));
        assert!(res_reduced
            .written_files
            .iter()
            .any(|p| p.ends_with("stale-role.md")));

        // Settings override exists while enabled == true
        let settings_enabled = read_t3_settings(&paths.settings_path());
        assert!(settings_enabled.project_overrides.contains_key("proj-prune"));

        // 3. Preview and apply with enabled == false -> previews removal and removes settings.json override
        let mut paused = reduced;
        paused.enabled = false;

        let preview_paused =
            compile_preset_preview(&paths, "proj-prune", ws.to_str().unwrap(), &paused).unwrap();
        assert!(preview_paused.settings_preview.changed);
        assert!(preview_paused.settings_preview.new_override.is_null());
        assert!(preview_paused
            .settings_preview
            .unified_diff
            .contains("-  \"defaultModelSelection\""));

        apply_preset_to_project(
            &paths,
            "proj-prune",
            ws.to_str().unwrap(),
            None,
            Some(paused.clone()),
        )
        .unwrap();

        let settings_disabled = read_t3_settings(&paths.settings_path());
        assert!(!settings_disabled.project_overrides.contains_key("proj-prune"));

        // Preview again when override is already absent -> settings_preview.changed == false
        let preview_after_disabled =
            compile_preset_preview(&paths, "proj-prune", ws.to_str().unwrap(), &paused).unwrap();
        assert!(!preview_after_disabled.settings_preview.changed);
        assert!(preview_after_disabled.settings_preview.new_override.is_null());
    }

    #[test]
    fn remove_project_override_cleans_compiler_squad_but_preserves_manual_squad() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("oh-my-t3code").join("presets");
        let ws_compiled = dir.path().join("compiled-app");
        let ws_sibling = dir.path().join("sibling-app");
        let ws_manual = dir.path().join("manual-app");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::create_dir_all(&ws_compiled).unwrap();
        fs::create_dir_all(&ws_sibling).unwrap();
        fs::create_dir_all(&ws_manual).unwrap();
        fs::write(t3_home.join("userdata").join("settings.json"), "{}").unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        // Case A: Compiler-generated squad is removed along with empty .agents/skills and .agents
        apply_preset_to_project(
            &paths,
            "proj-compiled",
            ws_compiled.to_str().unwrap(),
            Some("agy-dual".to_string()),
            None,
        )
        .unwrap();
        let compiled_squad_dir = ws_compiled.join(".agents/skills/compiled-app-squad");
        assert!(compiled_squad_dir.join("SKILL.md").exists());

        remove_project_override(&paths, "proj-compiled", ws_compiled.to_str().unwrap()).unwrap();
        assert!(!local_preset_path(&ws_compiled).exists());
        assert!(!compiled_squad_dir.exists());
        assert!(!ws_compiled.join(".agents").exists());
        assert!(!read_t3_settings(&paths.settings_path())
            .project_overrides
            .contains_key("proj-compiled"));

        // Case B: Sibling non-squad skills in .agents/skills/ are preserved when compiler squad is removed
        apply_preset_to_project(
            &paths,
            "proj-sibling",
            ws_sibling.to_str().unwrap(),
            Some("codex-squad".to_string()),
            None,
        )
        .unwrap();
        let sibling_skill = ws_sibling.join(".agents/skills/other-skill/SKILL.md");
        fs::create_dir_all(sibling_skill.parent().unwrap()).unwrap();
        fs::write(&sibling_skill, "---\nname: other-skill\n---\n# Keep\n").unwrap();

        remove_project_override(&paths, "proj-sibling", ws_sibling.to_str().unwrap()).unwrap();
        assert!(!ws_sibling.join(".agents/skills/sibling-app-squad").exists());
        assert!(sibling_skill.exists());

        // Case C: Manual squad without compiler signature is preserved intact
        let manual_squad_dir = ws_manual.join(".agents/skills/manual-app-squad");
        let manual_role = manual_squad_dir.join("roles/custom.md");
        fs::create_dir_all(manual_role.parent().unwrap()).unwrap();
        let manual_skill_content = "---\nname: manual-app-squad\n---\n# Hand-authored Squad\n";
        fs::write(manual_squad_dir.join("SKILL.md"), manual_skill_content).unwrap();
        fs::write(&manual_role, "# Custom Role\n").unwrap();

        let preset = resolve_global_preset(&paths.presets_dir, "agy-dual").unwrap();
        save_project_preset_unlocked(&paths, "proj-manual", ws_manual.to_str().unwrap(), preset.clone())
            .unwrap();
        sync_project_settings(&paths.settings_path(), "proj-manual", &preset).unwrap();

        remove_project_override(&paths, "proj-manual", ws_manual.to_str().unwrap()).unwrap();
        assert!(!local_preset_path(&ws_manual).exists());
        assert!(!read_t3_settings(&paths.settings_path())
            .project_overrides
            .contains_key("proj-manual"));
        assert!(manual_squad_dir.join("SKILL.md").exists());
        assert_eq!(
            fs::read_to_string(manual_squad_dir.join("SKILL.md")).unwrap(),
            manual_skill_content
        );
        assert!(manual_role.exists());
    }

    fn seed_projects_sqlite(db_path: &Path, projects: &[(&str, &str, &Path)]) {
        let conn = rusqlite::Connection::open(db_path).expect("create test sqlite db");
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

        for (project_id, title, ws) in projects {
            conn.execute(
                "INSERT INTO projection_projects VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
                rusqlite::params![
                    project_id,
                    title,
                    ws.to_str().unwrap(),
                    r#"{"instanceId":"antigravity_2","model":"gemini-4-hydrogen"}"#,
                    "2026-11-15T01:00:00Z",
                ],
            )
            .unwrap();
        }
    }

    #[test]
    fn swap_project_primary_instance_default_leaves_roles_untouched() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("oh-my-t3code").join("presets");
        let ws = dir.path().join("proj-default-swap");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::create_dir_all(&ws).unwrap();
        fs::write(t3_home.join("userdata").join("settings.json"), "{}").unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        apply_preset_to_project(
            &paths,
            "proj-default",
            ws.to_str().unwrap(),
            Some("agy-dual".to_string()),
            None,
        )
        .unwrap();

        let res = swap_project_primary_instance(&paths, "proj-default", ws.to_str().unwrap())
            .unwrap();
        assert_eq!(res.active_instance_id, "antigravity");
        assert_eq!(res.rebalanced_roles_count, 0);
        assert!(res.rebalanced_roles.is_empty());

        let after = get_project_preset(&paths, "proj-default", ws.to_str().unwrap(), None).unwrap();
        assert_eq!(after.resolved_preset.roles["oracle"].provider_instance_id, "antigravity_2");
        assert_eq!(after.resolved_preset.roles["fixer"].provider_instance_id, "antigravity");
    }

    #[test]
    fn swap_project_primary_instance_with_options_rebalances_agy_inherited_roles_selectively() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("oh-my-t3code").join("presets");
        let ws = dir.path().join("proj-agy-rebalance");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::create_dir_all(&ws).unwrap();
        fs::write(t3_home.join("userdata").join("settings.json"), "{}").unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };
        ensure_seed_presets(&paths.presets_dir).unwrap();

        // Create a global parent preset with mixed providers (agy_2, agy_1, codex) and an incompatible-model worker
        let mut parent = resolve_global_preset(&paths.presets_dir, "hybrid-agy-codex").unwrap();
        parent.id = "hybrid-mixed".to_string();
        parent.roles.insert(
            "legacy-worker".to_string(),
            RoleConfig {
                id: "legacy-worker".to_string(),
                title: "Legacy Worker".to_string(),
                provider_instance_id: "antigravity_2".to_string(),
                model: "gpt-6.1-sol".to_string(),
                options: BTreeMap::from([("thinkingLevel".to_string(), "low".to_string())]),
                ..Default::default()
            },
        );
        save_global_preset_and_sync(&paths, parent).unwrap();

        // Project inherits from hybrid-mixed with sparse JSONC (no explicit override for qa-reviewer or legacy-worker)
        // and disables designer via disabled_roles.
        let local_jsonc = r#"{
            "id": "proj-agy-rebalance",
            "name": "Proj Agy Rebalance",
            "extends": "hybrid-mixed",
            "enabled": true,
            "disabledRoles": ["designer"],
            "roles": {
                "explorer": {
                    "whenToUse": "Custom local note"
                }
            }
        }"#;
        fs::create_dir_all(ws.join(".t3code")).unwrap();
        fs::write(local_preset_path(&ws), local_jsonc).unwrap();
        apply_preset_to_project(&paths, "proj-inh", ws.to_str().unwrap(), None, None).unwrap();

        let swapped = swap_project_primary_instance_with_options(
            &paths,
            "proj-inh",
            ws.to_str().unwrap(),
            true,
        )
        .unwrap();

        assert_eq!(swapped.active_instance_id, "antigravity");
        assert_eq!(swapped.active_model, "gemini-4-hydrogen");
        assert_eq!(swapped.rebalanced_roles_count, 2);
        assert_eq!(
            swapped.rebalanced_roles,
            vec!["legacy-worker".to_string(), "qa-reviewer".to_string()]
        );

        let after = get_project_preset(&paths, "proj-inh", ws.to_str().unwrap(), None).unwrap();
        assert_eq!(after.resolved_preset.orchestrator.provider_instance_id, "antigravity");
        // Inherited qa-reviewer was written into raw local preset and migrated to antigravity keeping gemini-4-argon
        let raw_local = after.raw_local_preset.expect("raw local preset present");
        assert!(raw_local.roles.contains_key("qa-reviewer"));
        assert!(!raw_local.roles.contains_key("designer"));
        assert_eq!(after.resolved_preset.roles["qa-reviewer"].provider_instance_id, "antigravity");
        assert_eq!(after.resolved_preset.roles["qa-reviewer"].model, "gemini-4-argon");
        // Incompatible model normalized to gemini-4-hydrogen + thinking_level = high
        assert_eq!(after.resolved_preset.roles["legacy-worker"].provider_instance_id, "antigravity");
        assert_eq!(after.resolved_preset.roles["legacy-worker"].model, "gemini-4-hydrogen");
        assert_eq!(
            after.resolved_preset.roles["legacy-worker"].options.get("thinking_level").map(String::as_str),
            Some("high")
        );
        assert!(!after.resolved_preset.roles["legacy-worker"].options.contains_key("thinkingLevel"));
        // Explorer (antigravity) and Oracle/Fixer (codex) remained untouched
        assert_eq!(after.resolved_preset.roles["explorer"].provider_instance_id, "antigravity");
        assert_eq!(after.resolved_preset.roles["oracle"].provider_instance_id, "codex");
        assert_eq!(after.resolved_preset.roles["fixer"].provider_instance_id, "codex");

        let qa_md = fs::read_to_string(
            ws.join(".agents/skills/proj-agy-rebalance-squad/roles/qa-reviewer.md"),
        )
        .unwrap();
        assert!(qa_md.contains("- **Instância:** `antigravity`"));
    }

    #[test]
    fn swap_project_primary_instance_with_options_rebalances_codex_matching_model_only() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("oh-my-t3code").join("presets");
        let ws = dir.path().join("proj-codex-rebalance");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::create_dir_all(&ws).unwrap();
        fs::write(t3_home.join("userdata").join("settings.json"), "{}").unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };
        ensure_seed_presets(&paths.presets_dir).unwrap();

        let mut custom = resolve_global_preset(&paths.presets_dir, "default").unwrap();
        custom.id = "proj-codex-rebalance".to_string();
        custom.roles.insert(
            "agy-helper".to_string(),
            RoleConfig {
                id: "agy-helper".to_string(),
                title: "Agy Helper".to_string(),
                provider_instance_id: "antigravity_2".to_string(),
                model: "gemini-4-hydrogen".to_string(),
                options: BTreeMap::from([("thinking_level".to_string(), "medium".to_string())]),
                ..Default::default()
            },
        );
        apply_preset_to_project(&paths, "proj-codex", ws.to_str().unwrap(), None, Some(custom))
            .unwrap();

        let swapped = swap_project_primary_instance_with_options(
            &paths,
            "proj-codex",
            ws.to_str().unwrap(),
            true,
        )
        .unwrap();

        assert_eq!(swapped.active_instance_id, "codex");
        assert_eq!(swapped.active_model, "gpt-6.1-terra");
        assert_eq!(swapped.rebalanced_roles_count, 2);
        assert_eq!(
            swapped.rebalanced_roles,
            vec!["fixer".to_string(), "oracle".to_string()]
        );

        let after = get_project_preset(&paths, "proj-codex", ws.to_str().unwrap(), None).unwrap();
        assert_eq!(after.resolved_preset.roles["fixer"].model, "gpt-6.1-terra");
        assert_eq!(after.resolved_preset.roles["oracle"].model, "gpt-6.1-terra");
        assert_eq!(after.resolved_preset.roles["explorer"].model, "gpt-6-luna");
        assert_eq!(after.resolved_preset.roles["designer"].model, "gpt-6-luna");
        assert_eq!(after.resolved_preset.roles["qa-reviewer"].model, "gpt-6-astra");
        assert_eq!(after.resolved_preset.roles["agy-helper"].provider_instance_id, "antigravity_2");
    }

    #[test]
    fn swap_global_instance_with_options_rebalances_global_roles_agy_and_codex() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("oh-my-t3code").join("presets");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::write(t3_home.join("userdata").join("settings.json"), "{}").unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        // 1. Codex default preset: gpt-6.1-sol -> gpt-6.1-terra, only fixer + oracle migrate
        set_global_preset_config(&paths, "default".to_string(), true).unwrap();
        let codex_snap = swap_global_instance_with_options(&paths, true, false).unwrap();
        let codex_report = codex_snap
            .last_global_swap_report
            .as_ref()
            .expect("global swap report present");
        assert!(codex_report.include_roles);
        assert!(!codex_report.resync_inherited);
        assert_eq!(codex_report.rebalanced_roles_count, 2);
        assert_eq!(
            codex_report.rebalanced_roles,
            vec!["fixer".to_string(), "oracle".to_string()]
        );
        assert!(codex_report.resynced_projects.is_empty());
        assert!(codex_report.failed_projects.is_empty());

        let updated_default = resolve_global_preset(&paths.presets_dir, "default").unwrap();
        assert_eq!(updated_default.orchestrator.model, "gpt-6.1-terra");
        assert_eq!(updated_default.fallback_chain[0].model, "gpt-6.1-sol");
        assert_eq!(updated_default.roles["fixer"].model, "gpt-6.1-terra");
        assert_eq!(updated_default.roles["oracle"].model, "gpt-6.1-terra");
        assert_eq!(updated_default.roles["explorer"].model, "gpt-6-luna");
        assert_eq!(updated_default.roles["qa-reviewer"].model, "gpt-6-astra");

        // 2. Agy agy-dual preset: antigravity_2 -> antigravity, designer + oracle + qa-reviewer migrate
        set_global_preset_config(&paths, "agy-dual".to_string(), true).unwrap();
        let agy_snap = swap_global_instance_with_options(&paths, true, false).unwrap();
        let agy_report = agy_snap
            .last_global_swap_report
            .as_ref()
            .expect("agy global swap report present");
        assert_eq!(agy_report.rebalanced_roles_count, 3);
        assert_eq!(
            agy_report.rebalanced_roles,
            vec![
                "designer".to_string(),
                "oracle".to_string(),
                "qa-reviewer".to_string()
            ]
        );
        let updated_agy = resolve_global_preset(&paths.presets_dir, "agy-dual").unwrap();
        assert_eq!(updated_agy.orchestrator.provider_instance_id, "antigravity");
        assert_eq!(
            updated_agy.fallback_chain[0].provider_instance_id,
            "antigravity_2"
        );
        assert_eq!(updated_agy.roles["designer"].provider_instance_id, "antigravity");
        assert_eq!(updated_agy.roles["oracle"].provider_instance_id, "antigravity");
        assert_eq!(updated_agy.roles["qa-reviewer"].provider_instance_id, "antigravity");
        assert_eq!(updated_agy.roles["explorer"].provider_instance_id, "antigravity");
        assert_eq!(updated_agy.roles["fixer"].provider_instance_id, "antigravity");
    }

    #[test]
    fn swap_global_instance_with_options_resyncs_direct_and_transitive_inherited_projects_with_partial_failure() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let userdata = t3_home.join("userdata");
        let presets_dir = dir.path().join("oh-my-t3code").join("presets");

        let ws_direct = dir.path().join("proj-direct");
        let ws_transitive = dir.path().join("proj-transitive");
        let ws_paused = dir.path().join("proj-paused");
        let ws_no_local = dir.path().join("proj-no-local");
        let ws_broken = dir.path().join("proj-broken");

        fs::create_dir_all(&userdata).unwrap();
        for ws in [&ws_direct, &ws_transitive, &ws_paused, &ws_no_local, &ws_broken] {
            fs::create_dir_all(ws).unwrap();
        }
        fs::write(userdata.join("settings.json"), "{}").unwrap();
        seed_projects_sqlite(
            &userdata.join("statev2.sqlite"),
            &[
                ("proj-direct", "Direct App", &ws_direct),
                ("proj-transitive", "Transitive App", &ws_transitive),
                ("proj-paused", "Paused App", &ws_paused),
                ("proj-no-local", "Global Follower App", &ws_no_local),
                ("proj-broken", "Broken App", &ws_broken),
            ],
        );

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };
        set_global_preset_config(&paths, "agy-dual".to_string(), true).unwrap();

        // Global preset extending agy-dual sparsely for transitive inheritance test
        fs::write(
            paths.presets_dir.join("team-agy.jsonc"),
            r#"{"id":"team-agy","name":"Team Agy","extends":"agy-dual"}"#,
        )
        .unwrap();

        // 1. Direct active inherited project with sparse JSONC + custom role
        fs::create_dir_all(ws_direct.join(".t3code")).unwrap();
        let direct_jsonc = r#"{
            "id": "proj-direct",
            "name": "Direct App",
            "extends": "agy-dual",
            "enabled": true,
            "roles": {
                "observabilidade": {
                    "id": "observabilidade",
                    "title": "Observabilidade",
                    "providerInstanceId": "codex",
                    "model": "gpt-6-luna"
                }
            }
        }"#;
        fs::write(local_preset_path(&ws_direct), direct_jsonc).unwrap();
        apply_preset_to_project(&paths, "proj-direct", ws_direct.to_str().unwrap(), None, None)
            .unwrap();
        // Re-write sparse local JSONC so we verify resync preserves .t3code/preset.jsonc untouched
        fs::write(local_preset_path(&ws_direct), direct_jsonc).unwrap();

        // 2. Transitive active inherited project (extends team-agy -> agy-dual)
        fs::create_dir_all(ws_transitive.join(".t3code")).unwrap();
        fs::write(
            local_preset_path(&ws_transitive),
            r#"{"id":"proj-transitive","name":"Transitive App","extends":"team-agy","enabled":true}"#,
        )
        .unwrap();
        apply_preset_to_project(
            &paths,
            "proj-transitive",
            ws_transitive.to_str().unwrap(),
            None,
            None,
        )
        .unwrap();

        // 3. Paused project extending agy-dual -> must NEVER be reactivated or resynced
        apply_preset_to_project(
            &paths,
            "proj-paused",
            ws_paused.to_str().unwrap(),
            Some("agy-dual".to_string()),
            None,
        )
        .unwrap();
        set_project_preset_enabled(&paths, "proj-paused", ws_paused.to_str().unwrap(), false)
            .unwrap();
        let paused_preset_before = fs::read_to_string(local_preset_path(&ws_paused)).unwrap();

        // 5. Broken project extending agy-dual where `.agents` is a file blocking dir creation
        fs::create_dir_all(ws_broken.join(".t3code")).unwrap();
        fs::write(
            local_preset_path(&ws_broken),
            r#"{"id":"proj-broken","name":"Broken App","extends":"agy-dual","enabled":true}"#,
        )
        .unwrap();
        fs::write(ws_broken.join(".agents"), "blocker file").unwrap();

        let snap = swap_global_instance_with_options(&paths, true, true).unwrap();
        let report = snap
            .last_global_swap_report
            .as_ref()
            .expect("swap report present");

        assert!(report.include_roles);
        assert!(report.resync_inherited);
        assert_eq!(report.rebalanced_roles_count, 3);
        let resynced_ids: Vec<&str> = report
            .resynced_projects
            .iter()
            .map(|p| p.project_id.as_str())
            .collect();
        assert_eq!(resynced_ids, vec!["proj-direct", "proj-transitive"]);

        assert_eq!(report.failed_projects.len(), 1);
        assert_eq!(report.failed_projects[0].project_id, "proj-broken");
        assert!(!report.failed_projects[0].error.is_empty());

        // Direct & transitive projects compiled with antigravity & updated settings.json
        assert_eq!(
            fs::read_to_string(local_preset_path(&ws_direct)).unwrap(),
            direct_jsonc
        );
        let direct_oracle_md = fs::read_to_string(
            ws_direct.join(".agents/skills/proj-direct-squad/roles/oracle.md"),
        )
        .unwrap();
        assert!(direct_oracle_md.contains("- **Instância:** `antigravity`"));
        assert!(ws_direct
            .join(".agents/skills/proj-direct-squad/roles/observabilidade.md")
            .exists());
        let trans_skill_md = fs::read_to_string(
            ws_transitive.join(".agents/skills/proj-transitive-squad/SKILL.md"),
        )
        .unwrap();
        assert!(trans_skill_md.contains("- **Orquestrador:** `antigravity` / `gemini-4-hydrogen`"));

        let settings_after = read_t3_settings(&paths.settings_path());
        assert_eq!(
            settings_after.project_overrides["proj-direct"].instance_id,
            "antigravity"
        );
        assert_eq!(
            settings_after.project_overrides["proj-transitive"].instance_id,
            "antigravity"
        );

        // Paused project and no-local project remain untouched
        assert_eq!(
            fs::read_to_string(local_preset_path(&ws_paused)).unwrap(),
            paused_preset_before
        );
        assert!(!settings_after.project_overrides.contains_key("proj-paused"));
        assert!(!local_preset_path(&ws_no_local).exists());
        assert!(!settings_after.project_overrides.contains_key("proj-no-local"));
    }
}

