use crate::models::{
    AppError, AppPaths, AppResult, CompilePreviewResult, CompiledFilePreview, PresetConfig,
    RoleConfig, SyncResult,
};
use crate::preset_engine::{
    atomic_write_file, derive_project_slug, ensure_seed_presets, get_project_preset,
    local_preset_path, resolve_global_preset, resolve_preset_inheritance, validate_safe_id,
};
use crate::settings_sync::{compute_unified_diff, preview_settings_override, sync_project_settings};
use crate::t3_reader::read_t3_settings;
use std::collections::BTreeMap;
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

fn format_options_inline(options: &BTreeMap<String, String>) -> String {
    if options.is_empty() {
        return "default".to_string();
    }
    options
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

    let resolved = resolve_preset_inheritance(&paths.presets_dir, preset.clone())?;
    let project_slug = derive_project_slug(workspace_root);
    let squad_dir = ws_root
        .join(".agents")
        .join("skills")
        .join(format!("{project_slug}-squad"));

    let mut files = Vec::new();

    // 1. .t3code/preset.jsonc
    let preset_json_content = format!(
        "// Oh My T3Code project preset\n{}\n",
        serde_json::to_string_pretty(preset)?
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
    ensure_seed_presets(&paths.presets_dir)?;

    let target_preset: PresetConfig = if let Some(custom) = custom_preset {
        custom
    } else if let Some(preset_id) = preset_id_or_custom {
        if preset_id == "custom" {
            let resolved_proj = get_project_preset(paths, project_id, workspace_root, None)?;
            resolved_proj
                .raw_local_preset
                .unwrap_or(resolved_proj.resolved_preset)
        } else {
            validate_safe_id(&preset_id, "preset id")?;
            resolve_global_preset(&paths.presets_dir, &preset_id)?
        }
    } else {
        let resolved_proj = get_project_preset(paths, project_id, workspace_root, None)?;
        resolved_proj
            .raw_local_preset
            .unwrap_or(resolved_proj.resolved_preset)
    };

    let resolved = resolve_preset_inheritance(&paths.presets_dir, target_preset.clone())?;
    let preview = compile_preset_preview(paths, project_id, workspace_root, &target_preset)?;

    let mut written_files = Vec::new();
    for file in &preview.files {
        if file.changed {
            atomic_write_file(Path::new(&file.path), file.new_content.as_bytes())?;
            written_files.push(file.path.clone());
        }
    }

    let (backup_path, _) =
        sync_project_settings(&paths.settings_path(), project_id, &resolved)?;

    Ok(SyncResult {
        project_id: project_id.to_string(),
        workspace_root: workspace_root.to_string(),
        preset_id: resolved.id,
        written_files,
        settings_path: paths.settings_path().display().to_string(),
        backup_path: backup_path.map(|p| p.display().to_string()),
        active_instance_id: resolved.orchestrator.provider_instance_id,
        active_model: resolved.orchestrator.model,
    })
}

/// Quick toggle between `antigravity` (Agy Veca) and `antigravity_2` (Agy Principal) for a project.
pub fn swap_project_primary_instance(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
) -> AppResult<SyncResult> {
    let settings = read_t3_settings(&paths.settings_path());
    let current_resolved = get_project_preset(paths, project_id, workspace_root, None)?;

    let current_instance = settings
        .project_overrides
        .get(project_id)
        .map(|s| s.instance_id.as_str())
        .unwrap_or(
            current_resolved
                .resolved_preset
                .orchestrator
                .provider_instance_id
                .as_str(),
        );

    let next_instance = if current_instance == "antigravity_2" {
        "antigravity".to_string()
    } else {
        "antigravity_2".to_string()
    };

    let mut updated = current_resolved
        .raw_local_preset
        .unwrap_or(current_resolved.resolved_preset);
    updated.orchestrator.provider_instance_id = next_instance.clone();
    if !updated.orchestrator.model.starts_with("gemini-4-") {
        updated.orchestrator.model = "gemini-4-hydrogen".to_string();
        updated
            .orchestrator
            .options
            .insert("thinkingLevel".to_string(), "high".to_string());
    }

    apply_preset_to_project(paths, project_id, workspace_root, None, Some(updated))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preset_engine::default_seed_presets;
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
    fn swap_project_primary_instance_toggles_antigravity_accounts() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("presets");
        let ws = dir.path().join("swap-app");
        fs::create_dir_all(t3_home.join("userdata")).unwrap();
        fs::create_dir_all(&ws).unwrap();
        fs::write(t3_home.join("userdata").join("settings.json"), "{}").unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        // Default agy-dual uses antigravity_2 -> first swap switches to antigravity
        let res1 = swap_project_primary_instance(&paths, "proj-swap", ws.to_str().unwrap()).unwrap();
        assert_eq!(res1.active_instance_id, "antigravity");

        // Second swap switches back to antigravity_2
        let res2 = swap_project_primary_instance(&paths, "proj-swap", ws.to_str().unwrap()).unwrap();
        assert_eq!(res2.active_instance_id, "antigravity_2");
    }
}
