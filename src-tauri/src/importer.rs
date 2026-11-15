use crate::models::{
    AppError, AppPaths, AppResult, PresetConfig, ResolvedProjectPreset, RoleConfig, SessionPolicy,
    WorkerThinkingRule,
};
use crate::preset_engine::{
    derive_project_slug, detect_squad_dir, ensure_seed_presets_unlocked, lock_config_state,
    resolve_global_preset_unlocked, save_project_preset_unlocked, validate_safe_id,
};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

fn extract_backtick_tokens(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut in_tick = false;
    let mut current = String::new();
    for ch in line.chars() {
        if ch == '`' {
            if in_tick {
                let trimmed = current.trim().to_string();
                if !trimmed.is_empty() {
                    tokens.push(trimmed);
                }
                current.clear();
                in_tick = false;
            } else {
                in_tick = true;
            }
        } else if in_tick {
            current.push(ch);
        }
    }
    tokens
}

fn clean_md_cell(raw: &str) -> String {
    raw.trim()
        .trim_matches('*')
        .trim_matches('`')
        .trim()
        .to_string()
}

fn map_table_kind(raw_label: &str) -> Option<&'static str> {
    let lower = raw_label.to_ascii_lowercase();
    let has_token = |needle: &str| {
        lower
            .split(|c: char| !c.is_ascii_alphanumeric())
            .any(|tok| tok == needle)
    };
    if lower.contains("pesquisa") || lower.contains("mapeamento") || lower.contains("research") {
        Some("research")
    } else if lower.contains("arquitetura")
        || lower.contains("architecture")
        || lower.contains("migração")
        || lower.contains("migracao")
        || lower.contains("debug")
    {
        Some("architecture")
    } else if lower.contains("frontend") || has_token("ui") || has_token("css") {
        Some("frontend")
    } else if lower.contains("backend")
        || has_token("api")
        || has_token("jobs")
        || has_token("cli")
    {
        Some("backend")
    } else if has_token("qa") || lower.contains("security") || lower.contains("reviewer") {
        Some("qa")
    } else {
        None
    }
}

fn extract_thinking_token(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    for token in lower.split(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-') {
        match token {
            "low" | "medium" | "high" | "xhigh" => return Some(token.to_string()),
            _ => {}
        }
    }
    None
}

fn extract_model_token(raw: &str) -> Option<String> {
    let cleaned = clean_md_cell(raw);
    for token in cleaned.split_whitespace() {
        let tok = token.trim_matches(|c: char| c == '`' || c == ',' || c == '(' || c == ')');
        if tok.starts_with("gemini-") || tok.starts_with("gpt-") || tok.starts_with("claude-") {
            return Some(tok.to_string());
        }
    }
    None
}

fn parse_t3_global_session_policy(skill_md: &str, base_policy: SessionPolicy) -> (bool, SessionPolicy) {
    let lower = skill_md.to_ascii_lowercase();
    let is_t3_global = lower.contains("t3-global")
        || lower.contains("matriz padrão de distribuição")
        || lower.contains("matriz padrao de distribuicao")
        || (lower.contains("thinking_level") && lower.contains("tipo de tarefa"));

    let mut policy = base_policy;
    let mut extracted_any = false;

    for line in skill_md.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('|') {
            continue;
        }
        let cells: Vec<&str> = trimmed.split('|').map(str::trim).collect();
        if cells.len() < 4 {
            continue;
        }
        // Leading/trailing empty slice due to outer '|'
        let inner: Vec<&str> = cells
            .iter()
            .copied()
            .filter(|c| !c.is_empty())
            .collect();
        if inner.len() < 3 {
            continue;
        }
        let label = clean_md_cell(inner[0]);
        if label.starts_with(':') || label.starts_with('-') || label.to_ascii_lowercase().contains("papel") {
            continue;
        }
        let Some(kind) = map_table_kind(&label) else {
            continue;
        };

        let mut model: Option<String> = None;
        let mut thinking: Option<String> = None;
        for cell in &inner[1..] {
            if model.is_none() {
                model = extract_model_token(cell);
            }
            if thinking.is_none() {
                thinking = extract_thinking_token(cell);
            }
        }

        if let (Some(m), Some(t)) = (model, thinking) {
            policy
                .worker_thinking_by_kind
                .insert(kind.to_string(), WorkerThinkingRule { model: m, thinking_level: t });
            extracted_any = true;
        }
    }

    if is_t3_global || extracted_any {
        policy.parent_thinking_level = "medium".to_string();
    }

    (is_t3_global || extracted_any, policy)
}

fn parse_role_markdown(role_id: &str, raw: &str, default_instance: &str, default_model: &str) -> RoleConfig {
    let mut title = role_id.to_string();
    let mut description_lines = Vec::new();
    let mut when_to_use = String::new();
    let mut provider_instance_id = default_instance.to_string();
    let mut model = default_model.to_string();
    let mut options = BTreeMap::new();
    let mut skills = Vec::new();
    let mut mcps = Vec::new();
    let mut allowed_paths = Vec::new();
    let mut forbidden_paths = Vec::new();
    let mut invariants = Vec::new();
    let mut verification_commands = Vec::new();

    let mut current_section = "";
    let mut seen_heading = false;

    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(h1) = trimmed.strip_prefix("# ") {
            if !seen_heading {
                let cleaned = h1.strip_prefix("Role:").unwrap_or(h1).trim();
                // Strip trailing " (<project>)" if present
                title = cleaned
                    .split(" (")
                    .next()
                    .unwrap_or(cleaned)
                    .trim()
                    .to_string();
                seen_heading = true;
                continue;
            }
        }
        if let Some(h2) = trimmed.strip_prefix("## ") {
            let lower = h2.to_ascii_lowercase();
            current_section = if lower.contains("escopo") || lower.contains("scope") {
                "scope"
            } else if lower.contains("skill") || lower.contains("mcp") {
                "skills"
            } else if lower.contains("regra") || lower.contains("invariante") {
                "invariants"
            } else if lower.contains("verificação") || lower.contains("verification") {
                "verification"
            } else if lower.contains("modelo") || lower.contains("instância") {
                "model"
            } else {
                "other"
            };
            continue;
        }

        if current_section.is_empty() && !trimmed.is_empty() {
            if let Some(rest) = trimmed.strip_prefix("**Quando acionar:**") {
                when_to_use = rest.trim().to_string();
            } else {
                description_lines.push(trimmed.to_string());
            }
            continue;
        }

        match current_section {
            "model" => {
                if trimmed.contains("Instância:") {
                    if let Some(tok) = extract_backtick_tokens(trimmed).into_iter().next() {
                        provider_instance_id = tok;
                    }
                } else if trimmed.contains("Modelo:") {
                    if let Some(tok) = extract_backtick_tokens(trimmed).into_iter().next() {
                        model = tok;
                    }
                } else if trimmed.contains("Opções:") || trimmed.contains("Opcoes:") {
                    if let Some(tok) = extract_backtick_tokens(trimmed).into_iter().next() {
                        if tok != "default" {
                            for pair in tok.split(',') {
                                if let Some((k, v)) = pair.split_once('=') {
                                    let key = k.trim();
                                    let val = v.trim();
                                    if !key.is_empty() && !val.is_empty() {
                                        let norm_key = if key == "thinkingLevel" {
                                            "thinking_level"
                                        } else {
                                            key
                                        };
                                        options.insert(norm_key.to_string(), val.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
            "scope" => {
                let lower = trimmed.to_ascii_lowercase();
                if lower.contains("pode editar") || lower.contains("allowed") {
                    let toks = extract_backtick_tokens(trimmed);
                    if !toks.is_empty() {
                        allowed_paths.extend(toks);
                    }
                } else if lower.contains("evitar") || lower.contains("não alterar") || lower.contains("forbidden") {
                    let toks = extract_backtick_tokens(trimmed);
                    if !toks.is_empty() {
                        forbidden_paths.extend(toks);
                    }
                }
            }
            "skills" => {
                let lower = trimmed.to_ascii_lowercase();
                if lower.contains("skills:") {
                    for tok in extract_backtick_tokens(trimmed) {
                        if !matches!(tok.as_str(), "ai-memory" | "context7" | "playwright" | "linear") {
                            skills.push(tok);
                        } else {
                            mcps.push(tok);
                        }
                    }
                } else if lower.contains("mcps:") {
                    mcps.extend(extract_backtick_tokens(trimmed));
                }
            }
            "invariants" => {
                if !trimmed.is_empty() && !trimmed.starts_with('#') {
                    let clean = trimmed
                        .trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c == '-' || c == ' ')
                        .trim()
                        .to_string();
                    if !clean.is_empty() {
                        invariants.push(clean);
                    }
                }
            }
            "verification" => {
                let toks = extract_backtick_tokens(trimmed);
                if !toks.is_empty() {
                    verification_commands.extend(toks);
                } else if trimmed.starts_with("- ") {
                    verification_commands.push(trimmed.trim_start_matches("- ").trim().to_string());
                }
            }
            _ => {}
        }
    }

    // Detect model/instance hints inside role prose if not explicitly listed in ## Modelo
    let lower_raw = raw.to_ascii_lowercase();
    if lower_raw.contains("gpt-6.1-sol") {
        provider_instance_id = "codex".to_string();
        model = "gpt-6.1-sol".to_string();
    } else if lower_raw.contains("gpt-6.1-terra") {
        provider_instance_id = "codex".to_string();
        model = "gpt-6.1-terra".to_string();
    } else if lower_raw.contains("gpt-6-astra") {
        provider_instance_id = "codex".to_string();
        model = "gpt-6-astra".to_string();
    } else if lower_raw.contains("gemini-4-argon") {
        model = "gemini-4-argon".to_string();
        if lower_raw.contains("antigravity_2") {
            provider_instance_id = "antigravity_2".to_string();
        }
    } else if lower_raw.contains("gemini-4-hydrogen") {
        model = "gemini-4-hydrogen".to_string();
    }

    RoleConfig {
        id: role_id.to_string(),
        title,
        description: description_lines.join(" "),
        when_to_use,
        provider_instance_id,
        model,
        options,
        skills,
        mcps,
        allowed_paths,
        forbidden_paths,
        invariants,
        verification_commands,
    }
}

/// Reverse-imports an existing `<workspace_root>/.agents/skills/*-squad/` into `.t3code/preset.jsonc`.
pub fn import_existing_squad(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
) -> AppResult<ResolvedProjectPreset> {
    let _guard = lock_config_state();
    ensure_seed_presets_unlocked(&paths.presets_dir)?;
    let ws_root = Path::new(workspace_root);
    if !ws_root.exists() {
        return Err(AppError::NotFound(format!(
            "Workspace root does not exist: {workspace_root}"
        )));
    }

    let (squad_slug, squad_dir_str) = detect_squad_dir(ws_root).ok_or_else(|| {
        AppError::NotFound(format!(
            "No existing .agents/skills/*-squad/SKILL.md found in {workspace_root}"
        ))
    })?;

    let squad_dir = Path::new(&squad_dir_str);
    let skill_md = fs::read_to_string(squad_dir.join("SKILL.md"))?;
    let lower_skill = skill_md.to_ascii_lowercase();

    let is_codex = lower_skill.contains("codex")
        && (lower_skill.contains("gpt-6") || !lower_skill.contains("antigravity_2"));

    let base_preset_id = if is_codex { "codex-squad" } else { "agy-dual" };
    let base = resolve_global_preset_unlocked(&paths.presets_dir, base_preset_id)?;

    let mut roles = BTreeMap::new();
    let roles_dir = squad_dir.join("roles");
    if roles_dir.exists() && roles_dir.is_dir() {
        let mut entries = Vec::new();
        for entry in fs::read_dir(&roles_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("md") {
                entries.push(path);
            }
        }
        entries.sort();

        for path in entries {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if validate_safe_id(stem, "role filename").is_ok() {
                    let content = fs::read_to_string(&path)?;
                    let default_inst = if is_codex {
                        "codex"
                    } else if stem.contains("qa") {
                        "antigravity_2"
                    } else {
                        "antigravity"
                    };
                    let default_model = if is_codex {
                        if stem.contains("qa") {
                            "gpt-6-astra"
                        } else if stem.contains("fixer") {
                            "gpt-6.1-terra"
                        } else {
                            "gpt-6.1-sol"
                        }
                    } else if stem.contains("qa") {
                        "gemini-4-argon"
                    } else {
                        "gemini-4-hydrogen"
                    };
                    let parsed_role =
                        parse_role_markdown(stem, &content, default_inst, default_model);
                    roles.insert(stem.to_string(), parsed_role);
                }
            }
        }
    }

    let mut contention = base.contention.clone();
    if lower_skill.contains("parallel_workers=1") || lower_skill.contains("banco único") {
        contention.single_test_db = true;
    }
    if lower_skill.contains("isolation: \"worktree\"") && !lower_skill.contains("isolation: \"shared\"")
    {
        contention.default_isolation = "worktree".to_string();
    }

    let (is_t3_global_style, session_policy) =
        parse_t3_global_session_policy(&skill_md, base.session_policy.clone());

    let mut orchestrator = base.orchestrator;
    if is_t3_global_style
        && (orchestrator.provider_instance_id.starts_with("antigravity")
            || orchestrator.model == "gemini-4-hydrogen")
    {
        orchestrator.options.remove("thinkingLevel");
        orchestrator
            .options
            .insert("thinking_level".to_string(), "medium".to_string());
    }

    let project_slug = derive_project_slug(workspace_root);
    let imported = PresetConfig {
        id: project_slug.clone(),
        name: format!("{project_slug} (Imported from {squad_slug})"),
        description: format!(
            "Preset importado automaticamente de .agents/skills/{squad_slug}/ (base {base_preset_id})."
        ),
        extends: Some(base_preset_id.to_string()),
        enabled: true,
        topology: if is_codex {
            "issue-thread-orchestrator".to_string()
        } else {
            "intra-thread-squad".to_string()
        },
        orchestrator,
        fallback_chain: base.fallback_chain,
        contention,
        session_policy,
        roles: if roles.is_empty() { base.roles } else { roles },
        disabled_roles: Vec::new(),
    };

    save_project_preset_unlocked(paths, project_id, workspace_root, imported)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn imports_sample_squad_directory_and_writes_project_preset() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("presets");
        let ws = dir.path().join("sample-app");
        let squad_roles = ws.join(".agents/skills/sample-squad/roles");
        fs::create_dir_all(&squad_roles).unwrap();
        fs::create_dir_all(t3_home.join("userdata")).unwrap();

        fs::write(
            ws.join(".agents/skills/sample-squad/SKILL.md"),
            r#"---
name: sample-squad
description: Sample squad using antigravity and antigravity_2
---
# Sample Squad
Usa `antigravity` e `antigravity_2` com `gemini-4-hydrogen` e `gemini-4-argon`.
"#,
        )
        .unwrap();

        fs::write(
            squad_roles.join("backend.md"),
            r#"# Role: Backend Rust (sample-app)

Especialista backend.

## Escopo de arquivos
- **Pode editar:** `src-tauri/**`
- **Evitar / não alterar sem alinhamento:** `src/**`

## Skills e MCPs recomendados
- **Skills:** `systems-rust-go-crystal`, `tdd-and-testing`
- **MCPs:** `ai-memory`, `context7`

## Regras e Invariantes do Projeto
1. Abrir SQLite apenas em modo read-only.

## Verificação obrigatória antes de concluir
- `cargo test`
"#,
        )
        .unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        let imported = import_existing_squad(&paths, "proj-sample", ws.to_str().unwrap()).unwrap();
        assert!(imported.has_local_override);
        assert!(Path::new(&imported.local_preset_path).exists());
        assert_eq!(
            imported.resolved_preset.extends.as_deref(),
            Some("agy-dual")
        );
        let backend = imported.resolved_preset.roles.get("backend").unwrap();
        assert_eq!(backend.title, "Backend Rust");
        assert!(backend.skills.contains(&"systems-rust-go-crystal".to_string()));
        assert!(backend.mcps.contains(&"ai-memory".to_string()));
        assert!(backend.allowed_paths.contains(&"src-tauri/**".to_string()));
        assert!(backend.verification_commands.contains(&"cargo test".to_string()));
    }

    #[test]
    fn imports_t3_global_style_skill_extracts_worker_thinking_and_forces_medium_parent() {
        let dir = tempdir().unwrap();
        let t3_home = dir.path().join(".t3");
        let presets_dir = dir.path().join("presets");
        let ws = dir.path().join("t3global-app");
        let squad_dir = ws.join(".agents/skills/t3global-app-squad");
        fs::create_dir_all(&squad_dir).unwrap();
        fs::create_dir_all(t3_home.join("userdata")).unwrap();

        fs::write(
            squad_dir.join("SKILL.md"),
            r#"---
name: t3global-app-squad
description: Squad no padrão t3-global com antigravity e antigravity_2
---

# t3global-app Squad

### 2.2 Matriz Padrão de Distribuição

| Papel / Tipo de Tarefa | Modelo | thinking_level | Instância sugerida | Motivo |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend / UI / Copy / CSS** | gemini-4-hydrogen | high | Agy Principal | Interface complexa |
| **Backend / API / Jobs / CLI** | gemini-4-hydrogen | high | Agy Veca | Lógica de backend |
| **Mapeamento / Pesquisa paralela** | gemini-4-hydrogen | low | Agy Veca | Varredura leve |
| **Arquitetura / Migração grande / Debug longo** | gemini-4-argon | xhigh | Agy Principal | Raciocínio profundo |
| **QA / Security Reviewer** | gemini-4-argon | high | Oposta | Revisão independente |
"#,
        )
        .unwrap();

        let paths = AppPaths {
            t3_home,
            presets_dir,
            skill_roots: Vec::new(),
        };

        let imported = import_existing_squad(&paths, "proj-t3g", ws.to_str().unwrap()).unwrap();
        let policy = &imported.resolved_preset.session_policy;
        assert_eq!(policy.parent_thinking_level, "medium");
        assert_eq!(
            imported
                .resolved_preset
                .orchestrator
                .options
                .get("thinking_level")
                .map(String::as_str),
            Some("medium")
        );
        assert_eq!(
            policy.worker_thinking_by_kind["frontend"],
            WorkerThinkingRule {
                model: "gemini-4-hydrogen".to_string(),
                thinking_level: "high".to_string(),
            }
        );
        assert_eq!(
            policy.worker_thinking_by_kind["research"],
            WorkerThinkingRule {
                model: "gemini-4-hydrogen".to_string(),
                thinking_level: "low".to_string(),
            }
        );
        assert_eq!(
            policy.worker_thinking_by_kind["architecture"],
            WorkerThinkingRule {
                model: "gemini-4-argon".to_string(),
                thinking_level: "xhigh".to_string(),
            }
        );
        assert_eq!(
            policy.worker_thinking_by_kind["qa"],
            WorkerThinkingRule {
                model: "gemini-4-argon".to_string(),
                thinking_level: "high".to_string(),
            }
        );
    }
}
