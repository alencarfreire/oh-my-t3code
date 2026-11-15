use crate::models::{
    AppError, AppPaths, AppResult, ContentionPolicy, FallbackStep, OrchestratorSelection,
    PresetConfig, ResolvedProjectPreset, RoleConfig,
};
use serde::Deserialize;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const MAX_INHERITANCE_DEPTH: usize = 16;

/// Validates a preset or role identifier to prevent path traversal and invalid filenames.
pub fn validate_safe_id(id: &str, label: &str) -> AppResult<()> {
    if id.is_empty() || id.len() > 64 {
        return Err(AppError::InvalidInput(format!(
            "{label} must be between 1 and 64 characters"
        )));
    }
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err(AppError::PathTraversal(format!(
            "Unsafe {label} '{id}': path separators or '..' are forbidden"
        )));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::InvalidInput(format!(
            "Invalid {label} '{id}': only [a-zA-Z0-9_-] characters are allowed"
        )));
    }
    Ok(())
}

/// Derives a safe deterministic directory/skill slug from a workspace root or project title.
pub fn derive_project_slug(workspace_root: &str) -> String {
    let base = Path::new(workspace_root)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("project");
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in base.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
    }
    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "project".to_string()
    } else {
        trimmed
    }
}

/// Strips `//` line comments, `/* ... */` block comments, and trailing commas outside JSON strings.
pub fn strip_jsonc_comments(input: &str) -> String {
    let mut no_comments = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;

    while let Some(ch) = chars.next() {
        if in_string {
            no_comments.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        if ch == '"' {
            in_string = true;
            no_comments.push(ch);
        } else if ch == '/' && chars.peek() == Some(&'/') {
            chars.next();
            for c in chars.by_ref() {
                if c == '\n' {
                    no_comments.push('\n');
                    break;
                }
            }
        } else if ch == '/' && chars.peek() == Some(&'*') {
            chars.next();
            while let Some(c) = chars.next() {
                if c == '\n' {
                    no_comments.push('\n');
                } else if c == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    break;
                }
            }
        } else {
            no_comments.push(ch);
        }
    }

    strip_trailing_commas(&no_comments)
}

fn strip_trailing_commas(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut i = 0;
    let mut in_string = false;
    let mut escaped = false;

    while i < len {
        let c = chars[i];
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }

        if c == '"' {
            in_string = true;
            out.push(c);
            i += 1;
        } else if c == ',' {
            let mut j = i + 1;
            while j < len && chars[j].is_whitespace() {
                j += 1;
            }
            if j < len && (chars[j] == '}' || chars[j] == ']') {
                // Skip trailing comma
                i += 1;
            } else {
                out.push(c);
                i += 1;
            }
        } else {
            out.push(c);
            i += 1;
        }
    }

    out
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OrchestratorPatch {
    provider_instance_id: Option<String>,
    model: Option<String>,
    options: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ContentionPatch {
    single_test_db: Option<bool>,
    env_vars: Option<BTreeMap<String, String>>,
    git_ignored_builds: Option<Vec<String>>,
    conflict_files: Option<Vec<String>>,
    default_isolation: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RolePatch {
    id: Option<String>,
    title: Option<String>,
    description: Option<String>,
    when_to_use: Option<String>,
    provider_instance_id: Option<String>,
    model: Option<String>,
    options: Option<BTreeMap<String, String>>,
    skills: Option<Vec<String>>,
    mcps: Option<Vec<String>>,
    allowed_paths: Option<Vec<String>>,
    forbidden_paths: Option<Vec<String>>,
    invariants: Option<Vec<String>>,
    verification_commands: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PresetPatch {
    id: Option<String>,
    name: Option<String>,
    description: Option<String>,
    extends: Option<String>,
    topology: Option<String>,
    orchestrator: Option<OrchestratorPatch>,
    fallback_chain: Option<Vec<FallbackStep>>,
    contention: Option<ContentionPatch>,
    roles: Option<BTreeMap<String, RolePatch>>,
}

pub fn parse_jsonc_preset(raw: &str) -> AppResult<PresetConfig> {
    let clean = strip_jsonc_comments(raw);
    let preset: PresetConfig = serde_json::from_str(&clean)?;
    validate_safe_id(&preset.id, "preset id")?;
    for role_key in preset.roles.keys() {
        validate_safe_id(role_key, "role id")?;
    }
    Ok(preset)
}

fn parse_jsonc_patch(raw: &str) -> AppResult<PresetPatch> {
    let clean = strip_jsonc_comments(raw);
    let patch: PresetPatch = serde_json::from_str(&clean)?;
    if let Some(id) = &patch.id {
        validate_safe_id(id, "preset id")?;
    }
    if let Some(extends) = &patch.extends {
        validate_safe_id(extends, "extends preset id")?;
    }
    if let Some(roles) = &patch.roles {
        for role_key in roles.keys() {
            validate_safe_id(role_key, "role id")?;
        }
    }
    Ok(patch)
}

fn merge_patch(base: PresetConfig, patch: PresetPatch, fallback_id: &str) -> PresetConfig {
    let id = patch.id.unwrap_or_else(|| fallback_id.to_string());
    let name = match patch.name {
        Some(n) if !n.trim().is_empty() => n,
        _ => base.name,
    };
    let description = match patch.description {
        Some(d) if !d.trim().is_empty() => d,
        _ => base.description,
    };
    let topology = patch.topology.unwrap_or(base.topology);

    let mut orchestrator = base.orchestrator;
    if let Some(op) = patch.orchestrator {
        if let Some(inst) = op.provider_instance_id {
            orchestrator.provider_instance_id = inst;
        }
        if let Some(model) = op.model {
            orchestrator.model = model;
        }
        if let Some(opts) = op.options {
            for (k, v) in opts {
                orchestrator.options.insert(k, v);
            }
        }
    }

    let fallback_chain = patch.fallback_chain.unwrap_or(base.fallback_chain);

    let mut contention = base.contention;
    if let Some(cp) = patch.contention {
        if let Some(single) = cp.single_test_db {
            contention.single_test_db = single;
        }
        if let Some(env) = cp.env_vars {
            for (k, v) in env {
                contention.env_vars.insert(k, v);
            }
        }
        if let Some(builds) = cp.git_ignored_builds {
            contention.git_ignored_builds = builds;
        }
        if let Some(files) = cp.conflict_files {
            contention.conflict_files = files;
        }
        if let Some(iso) = cp.default_isolation {
            contention.default_isolation = iso;
        }
    }

    let mut roles = base.roles;
    if let Some(rp_map) = patch.roles {
        for (role_id, rp) in rp_map {
            let existing = roles.get(&role_id).cloned().unwrap_or_else(|| RoleConfig {
                id: role_id.clone(),
                title: role_id.clone(),
                ..Default::default()
            });
            let mut merged_opts = existing.options;
            if let Some(opts) = rp.options {
                for (k, v) in opts {
                    merged_opts.insert(k, v);
                }
            }
            let merged_role = RoleConfig {
                id: rp.id.unwrap_or(existing.id),
                title: rp.title.unwrap_or(existing.title),
                description: rp.description.unwrap_or(existing.description),
                when_to_use: rp.when_to_use.unwrap_or(existing.when_to_use),
                provider_instance_id: rp
                    .provider_instance_id
                    .unwrap_or(existing.provider_instance_id),
                model: rp.model.unwrap_or(existing.model),
                options: merged_opts,
                skills: rp.skills.unwrap_or(existing.skills),
                mcps: rp.mcps.unwrap_or(existing.mcps),
                allowed_paths: rp.allowed_paths.unwrap_or(existing.allowed_paths),
                forbidden_paths: rp.forbidden_paths.unwrap_or(existing.forbidden_paths),
                invariants: rp.invariants.unwrap_or(existing.invariants),
                verification_commands: rp
                    .verification_commands
                    .unwrap_or(existing.verification_commands),
            };
            roles.insert(role_id, merged_role);
        }
    }

    PresetConfig {
        id,
        name,
        description,
        extends: patch.extends,
        topology,
        orchestrator,
        fallback_chain,
        contention,
        roles,
    }
}

fn empty_base_preset(id: &str) -> PresetConfig {
    PresetConfig {
        id: id.to_string(),
        name: id.to_string(),
        description: String::new(),
        extends: None,
        topology: "intra-thread-squad".to_string(),
        orchestrator: OrchestratorSelection::default(),
        fallback_chain: Vec::new(),
        contention: ContentionPolicy::default(),
        roles: BTreeMap::new(),
    }
}

fn preset_file_path(presets_dir: &Path, id: &str) -> AppResult<PathBuf> {
    validate_safe_id(id, "preset id")?;
    let jsonc = presets_dir.join(format!("{id}.jsonc"));
    if jsonc.exists() {
        return Ok(jsonc);
    }
    let json = presets_dir.join(format!("{id}.json"));
    if json.exists() {
        return Ok(json);
    }
    Ok(jsonc)
}

/// Resolves a global preset by ID, recursively applying any `extends` parent chain.
pub fn resolve_global_preset(presets_dir: &Path, id: &str) -> AppResult<PresetConfig> {
    let mut visited = HashSet::new();
    resolve_global_preset_inner(presets_dir, id, &mut visited, 0)
}

fn resolve_global_preset_inner(
    presets_dir: &Path,
    id: &str,
    visited: &mut HashSet<String>,
    depth: usize,
) -> AppResult<PresetConfig> {
    validate_safe_id(id, "preset id")?;
    if depth >= MAX_INHERITANCE_DEPTH {
        return Err(AppError::CycleDetected(format!(
            "Inheritance depth exceeded {MAX_INHERITANCE_DEPTH} at '{id}'"
        )));
    }
    if !visited.insert(id.to_string()) {
        return Err(AppError::CycleDetected(format!(
            "Preset '{id}' participates in an inheritance cycle"
        )));
    }

    let path = preset_file_path(presets_dir, id)?;
    if !path.exists() {
        return Err(AppError::NotFound(format!(
            "Global preset '{id}' not found at {}",
            path.display()
        )));
    }

    let raw = fs::read_to_string(&path)?;
    let patch = parse_jsonc_patch(&raw)?;
    let base = if let Some(parent_id) = &patch.extends {
        resolve_global_preset_inner(presets_dir, parent_id, visited, depth + 1)?
    } else {
        empty_base_preset(id)
    };

    visited.remove(id);
    Ok(merge_patch(base, patch, id))
}

/// Resolves a raw `PresetPatch` (e.g. from a project `.t3code/preset.jsonc`) against global presets.
pub fn resolve_jsonc_against_globals(
    presets_dir: &Path,
    raw_jsonc: &str,
    fallback_id: &str,
) -> AppResult<PresetConfig> {
    let patch = parse_jsonc_patch(raw_jsonc)?;
    let base = if let Some(parent_id) = &patch.extends {
        resolve_global_preset(presets_dir, parent_id)?
    } else {
        empty_base_preset(fallback_id)
    };
    Ok(merge_patch(base, patch, fallback_id))
}

/// Resolves a concrete `PresetConfig` if it specifies `extends`.
pub fn resolve_preset_inheritance(
    presets_dir: &Path,
    preset: PresetConfig,
) -> AppResult<PresetConfig> {
    validate_safe_id(&preset.id, "preset id")?;
    if let Some(parent_id) = &preset.extends {
        validate_safe_id(parent_id, "extends preset id")?;
        if parent_id == &preset.id {
            return Err(AppError::CycleDetected(format!(
                "Preset '{}' cannot extend itself",
                preset.id
            )));
        }
        let parent = resolve_global_preset(presets_dir, parent_id)?;
        let serialized = serde_json::to_string(&preset)?;
        let patch: PresetPatch = serde_json::from_str(&serialized)?;
        Ok(merge_patch(parent, patch, &preset.id))
    } else {
        Ok(preset)
    }
}

/// Atomic file write helper inside a target directory.
pub fn atomic_write_file(target_path: &Path, content: &[u8]) -> AppResult<()> {
    let parent = target_path.parent().ok_or_else(|| {
        AppError::InvalidInput(format!("Path {} has no parent directory", target_path.display()))
    })?;
    fs::create_dir_all(parent)?;

    let file_name = target_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let tmp_path = parent.join(format!(".{file_name}.tmp.{}", std::process::id()));

    {
        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(content)?;
        file.sync_all()?;
    }

    fs::rename(&tmp_path, target_path)?;
    Ok(())
}

/// Returns the 3 built-in seed presets (`agy-dual`, `codex-squad`, `hybrid-agy-codex`).
pub fn default_seed_presets() -> Vec<PresetConfig> {
    vec![
        build_agy_dual_preset(),
        build_codex_squad_preset(),
        build_hybrid_preset(),
    ]
}

fn build_agy_dual_preset() -> PresetConfig {
    let mut roles = BTreeMap::new();
    roles.insert(
        "backend".to_string(),
        RoleConfig {
            id: "backend".to_string(),
            title: "Backend".to_string(),
            description: "APIs, models, domínio, jobs, migrations e suíte de testes unitários/integração.".to_string(),
            when_to_use: "Implementações de domínio, regras de negócio, SQL/persistência, CLIs e endpoints.".to_string(),
            provider_instance_id: "antigravity".to_string(),
            model: "gemini-4-hydrogen".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
            skills: vec![
                "tdd-and-testing".to_string(),
                "systematic-debugging".to_string(),
                "ai-memory-retrieval".to_string(),
            ],
            mcps: vec!["ai-memory".to_string(), "context7".to_string()],
            allowed_paths: vec!["src-tauri/**".to_string(), "app/**".to_string(), "db/**".to_string()],
            forbidden_paths: vec!["src/components/**".to_string(), "app/views/**".to_string()],
            invariants: vec![
                "Executar ciclo Red-Green-Refactor antes de declarar conclusão.".to_string(),
                "Nunca quebrar contratos de API/IPC sem alinhar com Frontend.".to_string(),
            ],
            verification_commands: vec![
                "cargo check --manifest-path src-tauri/Cargo.toml".to_string(),
                "cargo test --manifest-path src-tauri/Cargo.toml".to_string(),
            ],
        },
    );
    roles.insert(
        "frontend".to_string(),
        RoleConfig {
            id: "frontend".to_string(),
            title: "Frontend UI".to_string(),
            description: "Componentes React/Hotwire, Tailwind CSS v4, acessibilidade e ergonomia visual.".to_string(),
            when_to_use: "Telas, estados vazios, interações, estilos Tailwind v4 e tipagem de UI.".to_string(),
            provider_instance_id: "antigravity_2".to_string(),
            model: "gemini-4-hydrogen".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "medium".to_string())]),
            skills: vec![
                "tailwind-v4-design".to_string(),
                "better-accessibility".to_string(),
                "better-ui".to_string(),
                "better-layout".to_string(),
            ],
            mcps: vec!["context7".to_string(), "playwright".to_string(), "ai-memory".to_string()],
            allowed_paths: vec!["src/**".to_string(), "app/views/**".to_string(), "app/javascript/**".to_string()],
            forbidden_paths: vec!["src-tauri/**".to_string(), "db/migrate/**".to_string()],
            invariants: vec![
                "Preservar paridade estrita com o contrato IPC/API.".to_string(),
                "Garantir foco visível, contraste WCAG e copy claro em pt-BR.".to_string(),
            ],
            verification_commands: vec![
                "bun run typecheck".to_string(),
                "bun run test".to_string(),
                "bun run build".to_string(),
            ],
        },
    );
    roles.insert(
        "qa-reviewer".to_string(),
        RoleConfig {
            id: "qa-reviewer".to_string(),
            title: "QA / Security Reviewer".to_string(),
            description: "Auditoria independente de segurança, invariantes, paridade de contrato e CI completo.".to_string(),
            when_to_use: "Revisão final após implementação ou antes de encerrar entrega/PR.".to_string(),
            provider_instance_id: "antigravity_2".to_string(),
            model: "gemini-4-argon".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
            skills: vec![
                "code-review-and-security".to_string(),
                "security-audit".to_string(),
                "web-design-guidelines".to_string(),
                "webapp-testing".to_string(),
            ],
            mcps: vec!["ai-memory".to_string(), "playwright".to_string()],
            allowed_paths: vec!["**/* (read-only audit)".to_string()],
            forbidden_paths: vec!["Edições diretas de feature — devolver achados para o papel dono".to_string()],
            invariants: vec![
                "Rodar sempre na instância oposta à de quem implementou.".to_string(),
                "Reportar saídas literais de testes, lint e build sem mascarar falhas.".to_string(),
            ],
            verification_commands: vec![
                "cargo test --manifest-path src-tauri/Cargo.toml".to_string(),
                "bun run typecheck && bun run build".to_string(),
            ],
        },
    );

    PresetConfig {
        id: "agy-dual".to_string(),
        name: "Agy Dual (Veca + Principal)".to_string(),
        description: "Preset padrão inspirado no t3-global e cabrito-squad: balanceia antigravity (Agy Veca) e antigravity_2 (Agy Principal) com gemini-4-hydrogen e gemini-4-argon e fallback em 3 níveis.".to_string(),
        extends: None,
        topology: "intra-thread-squad".to_string(),
        orchestrator: OrchestratorSelection {
            provider_instance_id: "antigravity_2".to_string(),
            model: "gemini-4-hydrogen".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
        },
        fallback_chain: vec![
            FallbackStep {
                provider_instance_id: "antigravity".to_string(),
                model: "gemini-4-hydrogen".to_string(),
                options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
                reason: "Nível 1: Troca de instância mantendo gemini-4-hydrogen (Agy Principal ↔ Agy Veca)".to_string(),
            },
            FallbackStep {
                provider_instance_id: "antigravity_2".to_string(),
                model: "gemini-4-argon".to_string(),
                options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
                reason: "Nível 2: Troca para gemini-4-argon quando hydrogen esgotar nas duas contas".to_string(),
            },
            FallbackStep {
                provider_instance_id: "antigravity".to_string(),
                model: "gemini-4-argon".to_string(),
                options: BTreeMap::from([("thinking_level".to_string(), "medium".to_string())]),
                reason: "Nível 3: Último recurso entre contas Agy antes de pausar e consultar o usuário".to_string(),
            },
        ],
        contention: ContentionPolicy {
            single_test_db: false,
            env_vars: BTreeMap::new(),
            git_ignored_builds: vec!["target/".to_string(), "dist/".to_string()],
            conflict_files: vec![
                "package.json".to_string(),
                "Cargo.toml".to_string(),
                "tauri.conf.json".to_string(),
            ],
            default_isolation: "shared".to_string(),
        },
        roles,
    }
}

fn build_codex_squad_preset() -> PresetConfig {
    let mut roles = BTreeMap::new();
    let sol_opts = BTreeMap::from([
        ("reasoningEffort".to_string(), "high".to_string()),
        ("serviceTier".to_string(), "default".to_string()),
    ]);
    let terra_opts = BTreeMap::from([
        ("reasoningEffort".to_string(), "medium".to_string()),
        ("serviceTier".to_string(), "default".to_string()),
    ]);

    roles.insert(
        "backend".to_string(),
        RoleConfig {
            id: "backend".to_string(),
            title: "Backend".to_string(),
            description: "Models, schema, auth/sessão, queries, rotas e testes de domínio.".to_string(),
            when_to_use: "Mudanças em schema, serviços, APIs, jobs e lógica de negócios.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6.1-sol".to_string(),
            options: sol_opts.clone(),
            skills: vec!["tdd-and-testing".to_string(), "systematic-debugging".to_string()],
            mcps: vec!["ai-memory".to_string(), "context7".to_string()],
            allowed_paths: vec!["app/models/**".to_string(), "app/controllers/**".to_string(), "db/**".to_string()],
            forbidden_paths: vec!["app/views/**".to_string(), "app/assets/**".to_string()],
            invariants: vec![
                "Um único executor de DB de testes por vez; sem escritas paralelas em schema/rotas.".to_string(),
                "Preservar autenticação, parâmetros fortes e integridade de métricas.".to_string(),
            ],
            verification_commands: vec!["bin/rails test".to_string()],
        },
    );
    roles.insert(
        "delivery-manager".to_string(),
        RoleConfig {
            id: "delivery-manager".to_string(),
            title: "Delivery Manager".to_string(),
            description: "Evidências finais, Linear/Git, recomendação de prioridade e Settle.".to_string(),
            when_to_use: "Planejamento de rodada, checagem de escopo no Linear e encerramento controlado.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6.1-sol".to_string(),
            options: BTreeMap::from([
                ("reasoningEffort".to_string(), "medium".to_string()),
                ("serviceTier".to_string(), "default".to_string()),
            ]),
            skills: vec!["linear-issues".to_string(), "ai-memory-retrieval".to_string()],
            mcps: vec!["linear".to_string(), "ai-memory".to_string()],
            allowed_paths: vec!["docs/**".to_string()],
            forbidden_paths: vec!["app/**".to_string(), "src/**".to_string()],
            invariants: vec![
                "Nunca fechar issue ou fazer merge sem aprovação explícita do usuário.".to_string(),
                "Entregar sempre evidências reais de testes, commits e pendências.".to_string(),
            ],
            verification_commands: vec!["git status --short".to_string()],
        },
    );
    roles.insert(
        "fixer".to_string(),
        RoleConfig {
            id: "fixer".to_string(),
            title: "Fixer sob demanda".to_string(),
            description: "Correção pontual com causa conhecida e arquivos explícitos.".to_string(),
            when_to_use: "Ajustes localizados após achado de QA sem alteração de schema/segurança.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6.1-terra".to_string(),
            options: terra_opts.clone(),
            skills: vec!["systematic-debugging".to_string(), "tdd-and-testing".to_string()],
            mcps: vec!["ai-memory".to_string()],
            allowed_paths: vec!["Arquivos explícitos do briefing".to_string()],
            forbidden_paths: vec!["db/migrate/**".to_string(), "config/routes.rb".to_string()],
            invariants: vec![
                "Se a causa não se confirmar ou o escopo crescer, devolver para Backend/Sol.".to_string(),
            ],
            verification_commands: vec!["bin/rails test".to_string()],
        },
    );
    roles.insert(
        "frontend".to_string(),
        RoleConfig {
            id: "frontend".to_string(),
            title: "Frontend".to_string(),
            description: "Views, helpers, assets, Turbo/Stimulus, layout e acessibilidade.".to_string(),
            when_to_use: "Implementação e ajuste de interface, CSS e comportamento no navegador.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6.1-sol".to_string(),
            options: sol_opts.clone(),
            skills: vec!["tailwind-v4-design".to_string(), "better-accessibility".to_string(), "better-ui".to_string()],
            mcps: vec!["context7".to_string(), "playwright".to_string()],
            allowed_paths: vec!["app/views/**".to_string(), "app/javascript/**".to_string(), "app/assets/**".to_string()],
            forbidden_paths: vec!["db/**".to_string(), "app/models/**".to_string()],
            invariants: vec![
                "Manter escape seguro e responsividade desktop/mobile.".to_string(),
            ],
            verification_commands: vec!["bin/rails test:system".to_string()],
        },
    );
    roles.insert(
        "qa-reviewer".to_string(),
        RoleConfig {
            id: "qa-reviewer".to_string(),
            title: "QA / Reviewer".to_string(),
            description: "Revisão independente, segurança, UX e verificação completa de critérios.".to_string(),
            when_to_use: "Validação independente antes da entrega final ao usuário.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6-astra".to_string(),
            options: sol_opts.clone(),
            skills: vec!["code-review-and-security".to_string(), "security-audit".to_string(), "webapp-testing".to_string()],
            mcps: vec!["ai-memory".to_string(), "playwright".to_string()],
            allowed_paths: vec!["**/* (read-only audit)".to_string()],
            forbidden_paths: vec!["Implementação direta de correções".to_string()],
            invariants: vec![
                "QA nunca revisa a própria implementação.".to_string(),
                "Cada novo re-check deve rodar como tarefa independente.".to_string(),
            ],
            verification_commands: vec!["bin/ci".to_string()],
        },
    );

    PresetConfig {
        id: "codex-squad".to_string(),
        name: "Codex Squad (Issue Threads)".to_string(),
        description: "Preset estruturado inspirado no dashboard-meta-squad: topologia de threads por issue com Codex Sol, Terra e Astra, Delivery Manager e controle estrito de contenção.".to_string(),
        extends: None,
        topology: "issue-thread-orchestrator".to_string(),
        orchestrator: OrchestratorSelection {
            provider_instance_id: "codex".to_string(),
            model: "gpt-6.1-sol".to_string(),
            options: sol_opts,
        },
        fallback_chain: vec![
            FallbackStep {
                provider_instance_id: "codex".to_string(),
                model: "gpt-6.1-sol".to_string(),
                options: BTreeMap::from([
                    ("reasoningEffort".to_string(), "medium".to_string()),
                    ("serviceTier".to_string(), "default".to_string()),
                ]),
                reason: "Reduzir reasoningEffort mantendo gpt-6.1-sol".to_string(),
            },
            FallbackStep {
                provider_instance_id: "codex".to_string(),
                model: "gpt-6.1-terra".to_string(),
                options: terra_opts,
                reason: "Alternar para gpt-6.1-terra em correções delimitadas".to_string(),
            },
            FallbackStep {
                provider_instance_id: "codex".to_string(),
                model: "gpt-6-astra".to_string(),
                options: BTreeMap::from([
                    ("reasoningEffort".to_string(), "high".to_string()),
                    ("serviceTier".to_string(), "default".to_string()),
                ]),
                reason: "Escalonar para gpt-6-astra em auditorias críticas".to_string(),
            },
        ],
        contention: ContentionPolicy {
            single_test_db: true,
            env_vars: BTreeMap::from([("PARALLEL_WORKERS".to_string(), "1".to_string())]),
            git_ignored_builds: vec!["app/assets/builds/".to_string()],
            conflict_files: vec![
                "db/schema.rb".to_string(),
                "config/routes.rb".to_string(),
                "Gemfile.lock".to_string(),
                "package.json".to_string(),
            ],
            default_isolation: "shared".to_string(),
        },
        roles,
    }
}

fn build_hybrid_preset() -> PresetConfig {
    let mut roles = BTreeMap::new();
    roles.insert(
        "backend".to_string(),
        RoleConfig {
            id: "backend".to_string(),
            title: "Backend (Codex Sol)".to_string(),
            description: "Arquitetura de dados, APIs e lógica crítica com Codex Sol.".to_string(),
            when_to_use: "Serviços complexos, migrações, concorrência e algoritmos centrais.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6.1-sol".to_string(),
            options: BTreeMap::from([
                ("reasoningEffort".to_string(), "high".to_string()),
                ("serviceTier".to_string(), "default".to_string()),
            ]),
            skills: vec!["tdd-and-testing".to_string(), "systematic-debugging".to_string()],
            mcps: vec!["ai-memory".to_string(), "context7".to_string()],
            allowed_paths: vec!["src-tauri/**".to_string(), "backend/**".to_string()],
            forbidden_paths: vec!["src/components/**".to_string()],
            invariants: vec!["Testes automatizados obrigatórios antes da entrega.".to_string()],
            verification_commands: vec!["cargo test".to_string()],
        },
    );
    roles.insert(
        "frontend".to_string(),
        RoleConfig {
            id: "frontend".to_string(),
            title: "Frontend & Research (Hydrogen)".to_string(),
            description: "Iteração rápida de UI, React/Tailwind e mapeamento de código com gemini-4-hydrogen.".to_string(),
            when_to_use: "Componentes visuais, CSS, responsividade e exploração rápida.".to_string(),
            provider_instance_id: "antigravity".to_string(),
            model: "gemini-4-hydrogen".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
            skills: vec![
                "tailwind-v4-design".to_string(),
                "vercel-react-best-practices".to_string(),
                "better-ui".to_string(),
            ],
            mcps: vec!["context7".to_string(), "playwright".to_string()],
            allowed_paths: vec!["src/**".to_string()],
            forbidden_paths: vec!["src-tauri/**".to_string()],
            invariants: vec!["Manter paridade 1:1 com tipos IPC.".to_string()],
            verification_commands: vec!["bun run typecheck".to_string(), "bun run build".to_string()],
        },
    );
    roles.insert(
        "qa-reviewer".to_string(),
        RoleConfig {
            id: "qa-reviewer".to_string(),
            title: "QA / Reviewer (Argon)".to_string(),
            description: "Auditoria independente de segurança e contrato com gemini-4-argon.".to_string(),
            when_to_use: "Validação final após integração entre Backend Codex e Frontend Agy.".to_string(),
            provider_instance_id: "antigravity_2".to_string(),
            model: "gemini-4-argon".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
            skills: vec!["code-review-and-security".to_string(), "security-audit".to_string()],
            mcps: vec!["ai-memory".to_string(), "playwright".to_string()],
            allowed_paths: vec!["**/* (read-only audit)".to_string()],
            forbidden_paths: vec!["Alteração direta de código sem retorno ao implementador".to_string()],
            invariants: vec!["Validar todas as invariantes de segurança e determinismo.".to_string()],
            verification_commands: vec!["cargo test && bun run build".to_string()],
        },
    );

    PresetConfig {
        id: "hybrid-agy-codex".to_string(),
        name: "Hybrid (Agy + Codex)".to_string(),
        description: "Estratégia híbrida: gemini-4-hydrogen para UI e pesquisa rápida, Codex gpt-6.1-sol para backend crítico e gemini-4-argon para QA independente.".to_string(),
        extends: None,
        topology: "intra-thread-squad".to_string(),
        orchestrator: OrchestratorSelection {
            provider_instance_id: "antigravity_2".to_string(),
            model: "gemini-4-hydrogen".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
        },
        fallback_chain: vec![
            FallbackStep {
                provider_instance_id: "antigravity".to_string(),
                model: "gemini-4-hydrogen".to_string(),
                options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
                reason: "Alternar instância Agy Veca mantendo velocidade de coordenação".to_string(),
            },
            FallbackStep {
                provider_instance_id: "codex".to_string(),
                model: "gpt-6.1-sol".to_string(),
                options: BTreeMap::from([
                    ("reasoningEffort".to_string(), "high".to_string()),
                    ("serviceTier".to_string(), "default".to_string()),
                ]),
                reason: "Fallback cross-provider para Codex Sol".to_string(),
            },
            FallbackStep {
                provider_instance_id: "antigravity_2".to_string(),
                model: "gemini-4-argon".to_string(),
                options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
                reason: "Fallback para Argon em análise crítica".to_string(),
            },
        ],
        contention: ContentionPolicy {
            single_test_db: false,
            env_vars: BTreeMap::new(),
            git_ignored_builds: vec!["target/".to_string(), "dist/".to_string()],
            conflict_files: vec!["package.json".to_string(), "Cargo.toml".to_string()],
            default_isolation: "worktree".to_string(),
        },
        roles,
    }
}

/// Detects classic UTF-8-decoded-as-Latin-1 mojibake sequences (e.g. `NÃvel`, `instÃ¢ncia`, `â\u{86}\u{94}`).
pub fn looks_like_mojibake(s: &str) -> bool {
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if matches!(c, 'Ã' | 'Â' | 'â') {
            if let Some(&next) = chars.peek() {
                if ('\u{0080}'..='\u{00BF}').contains(&next) {
                    return true;
                }
            }
        }
    }
    false
}

/// Ensures the 3 built-in global presets exist in `presets_dir` without overwriting user edits,
/// while automatically repairing/migrating legacy seed files containing `"thinkingLevel"` or UTF-8 mojibake.
pub fn ensure_seed_presets(presets_dir: &Path) -> AppResult<()> {
    fs::create_dir_all(presets_dir)?;
    for preset in default_seed_presets() {
        let jsonc_path = presets_dir.join(format!("{}.jsonc", preset.id));
        let json_path = presets_dir.join(format!("{}.json", preset.id));

        let existing_path = if jsonc_path.exists() {
            Some((&jsonc_path, true))
        } else if json_path.exists() {
            Some((&json_path, false))
        } else {
            None
        };

        let needs_write = match existing_path {
            None => Some((&jsonc_path, true)),
            Some((path, is_jsonc)) => match fs::read_to_string(path) {
                Ok(raw) => {
                    if raw.contains("\"thinkingLevel\"") || looks_like_mojibake(&raw) {
                        Some((path, is_jsonc))
                    } else {
                        None
                    }
                }
                Err(_) => Some((path, is_jsonc)),
            },
        };

        if let Some((target_path, is_jsonc)) = needs_write {
            let body = if is_jsonc {
                format!(
                    "// Oh My T3Code built-in preset: {}\n{}\n",
                    preset.name,
                    serde_json::to_string_pretty(&preset)?
                )
            } else {
                format!("{}\n", serde_json::to_string_pretty(&preset)?)
            };
            atomic_write_file(target_path, body.as_bytes())?;
        }
    }
    Ok(())
}

/// Lists and resolves all global presets in `presets_dir` sorted by `id`.
pub fn list_global_presets(presets_dir: &Path) -> AppResult<Vec<PresetConfig>> {
    ensure_seed_presets(presets_dir)?;
    let mut ids = BTreeMap::<String, ()>::new();
    for entry in fs::read_dir(presets_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
        if ext != "jsonc" && ext != "json" {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            if validate_safe_id(stem, "preset filename").is_ok() {
                ids.insert(stem.to_string(), ());
            }
        }
    }

    let mut presets = Vec::with_capacity(ids.len());
    for id in ids.keys() {
        if let Ok(resolved) = resolve_global_preset(presets_dir, id) {
            presets.push(resolved);
        }
    }
    Ok(presets)
}

/// Saves a global preset as `<presets_dir>/<id>.jsonc` atomically.
pub fn save_global_preset(presets_dir: &Path, mut preset: PresetConfig) -> AppResult<PresetConfig> {
    validate_safe_id(&preset.id, "preset id")?;
    if let Some(parent) = &preset.extends {
        validate_safe_id(parent, "extends preset id")?;
        if parent == &preset.id {
            return Err(AppError::CycleDetected(format!(
                "Preset '{}' cannot extend itself",
                preset.id
            )));
        }
    }
    // Normalize role keys and IDs
    for (key, role) in &mut preset.roles {
        validate_safe_id(key, "role id")?;
        if role.id.is_empty() {
            role.id = key.clone();
        }
    }

    let path = presets_dir.join(format!("{}.jsonc", preset.id));
    let body = format!("{}\n", serde_json::to_string_pretty(&preset)?);
    atomic_write_file(&path, body.as_bytes())?;
    resolve_global_preset(presets_dir, &preset.id)
}

pub fn local_preset_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".t3code").join("preset.jsonc")
}

/// Saves a project-level preset override to `<workspace_root>/.t3code/preset.jsonc`.
pub fn save_project_preset(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
    mut preset: PresetConfig,
) -> AppResult<ResolvedProjectPreset> {
    let root = Path::new(workspace_root);
    if !root.exists() {
        return Err(AppError::NotFound(format!(
            "Workspace root does not exist: {workspace_root}"
        )));
    }
    validate_safe_id(&preset.id, "preset id")?;
    for (key, role) in &mut preset.roles {
        validate_safe_id(key, "role id")?;
        if role.id.is_empty() {
            role.id = key.clone();
        }
    }

    let resolved = resolve_preset_inheritance(&paths.presets_dir, preset.clone())?;
    let path = local_preset_path(root);
    let content = format!(
        "// Oh My T3Code project preset override\n{}\n",
        serde_json::to_string_pretty(&preset)?
    );
    atomic_write_file(&path, content.as_bytes())?;

    let project_slug = derive_project_slug(workspace_root);
    let detected_squad = detect_squad_dir(root);

    Ok(ResolvedProjectPreset {
        project_id: project_id.to_string(),
        workspace_root: workspace_root.to_string(),
        project_slug,
        has_local_override: true,
        local_preset_path: path.display().to_string(),
        raw_local_preset: Some(preset),
        resolved_preset: resolved,
        detected_squad_path: detected_squad.map(|(_, p)| p),
    })
}

/// Resolves the active preset for a project, falling back to detected squad or `agy-dual` / `codex-squad`.
pub fn get_project_preset(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
    active_instance_hint: Option<&str>,
) -> AppResult<ResolvedProjectPreset> {
    ensure_seed_presets(&paths.presets_dir)?;
    let root = Path::new(workspace_root);
    let local_path = local_preset_path(root);
    let project_slug = derive_project_slug(workspace_root);
    let detected_squad = detect_squad_dir(root);

    if local_path.exists() {
        let raw = fs::read_to_string(&local_path)?;
        let resolved = resolve_jsonc_against_globals(&paths.presets_dir, &raw, &project_slug)?;
        let raw_parsed = parse_jsonc_preset(&raw).ok();
        return Ok(ResolvedProjectPreset {
            project_id: project_id.to_string(),
            workspace_root: workspace_root.to_string(),
            project_slug,
            has_local_override: true,
            local_preset_path: local_path.display().to_string(),
            raw_local_preset: raw_parsed,
            resolved_preset: resolved,
            detected_squad_path: detected_squad.map(|(_, p)| p),
        });
    }

    let fallback_id = match active_instance_hint {
        Some("codex") => "codex-squad",
        _ => "agy-dual",
    };
    let resolved = resolve_global_preset(&paths.presets_dir, fallback_id)?;

    Ok(ResolvedProjectPreset {
        project_id: project_id.to_string(),
        workspace_root: workspace_root.to_string(),
        project_slug,
        has_local_override: false,
        local_preset_path: local_path.display().to_string(),
        raw_local_preset: None,
        resolved_preset: resolved,
        detected_squad_path: detected_squad.map(|(_, p)| p),
    })
}

/// Detects `<workspace_root>/.agents/skills/*-squad/SKILL.md` deterministically.
pub fn detect_squad_dir(workspace_root: &Path) -> Option<(String, String)> {
    let skills_dir = workspace_root.join(".agents").join("skills");
    let entries = fs::read_dir(&skills_dir).ok()?;
    let mut candidates = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = path.file_name().and_then(|s| s.to_str())?;
        if dir_name.ends_with("-squad") && path.join("SKILL.md").exists() {
            candidates.push((dir_name.to_string(), path.display().to_string()));
        }
    }
    candidates.sort_by(|a, b| a.0.cmp(&b.0));
    candidates.into_iter().next()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn jsonc_strips_comments_and_trailing_commas_safely() {
        let raw = r#"{
            // line comment
            "id": "demo",
            "name": "Demo // keep inside string /* also keep */",
            /* multi
               line comment */
            "roles": {
                "backend": {
                    "id": "backend",
                    "title": "Backend",
                    "providerInstanceId": "antigravity",
                    "model": "gemini-4-hydrogen",
                },
            },
        }"#;
        let parsed = parse_jsonc_preset(raw).expect("valid jsonc");
        assert_eq!(parsed.id, "demo");
        assert_eq!(
            parsed.name,
            "Demo // keep inside string /* also keep */"
        );
        assert!(parsed.roles.contains_key("backend"));
    }

    #[test]
    fn rejects_path_traversal_and_detects_inheritance_cycles() {
        assert!(matches!(
            validate_safe_id("../evil", "preset id"),
            Err(AppError::PathTraversal(_))
        ));
        assert!(matches!(
            validate_safe_id("foo/bar", "preset id"),
            Err(AppError::PathTraversal(_))
        ));

        let dir = tempdir().unwrap();
        let presets_dir = dir.path();
        fs::write(
            presets_dir.join("a.jsonc"),
            r#"{"id":"a","name":"A","extends":"b"}"#,
        )
        .unwrap();
        fs::write(
            presets_dir.join("b.jsonc"),
            r#"{"id":"b","name":"B","extends":"a"}"#,
        )
        .unwrap();

        let err = resolve_global_preset(presets_dir, "a").unwrap_err();
        assert!(matches!(err, AppError::CycleDetected(_)));
    }

    #[test]
    fn resolves_extends_inheritance_deterministically() {
        let dir = tempdir().unwrap();
        let presets_dir = dir.path();
        ensure_seed_presets(presets_dir).unwrap();

        let child_jsonc = r#"{
            // Child override
            "id": "custom-child",
            "name": "Custom Child",
            "extends": "agy-dual",
            "orchestrator": {
                "providerInstanceId": "antigravity"
            },
            "roles": {
                "backend": {
                    "model": "gemini-4-argon"
                }
            }
        }"#;

        let resolved =
            resolve_jsonc_against_globals(presets_dir, child_jsonc, "custom-child").unwrap();
        assert_eq!(resolved.id, "custom-child");
        assert_eq!(resolved.orchestrator.provider_instance_id, "antigravity");
        // Inherited from agy-dual
        assert_eq!(resolved.orchestrator.model, "gemini-4-hydrogen");
        assert_eq!(
            resolved.roles.get("backend").unwrap().model,
            "gemini-4-argon"
        );
        // Inherited skills from agy-dual backend role
        assert!(!resolved.roles.get("backend").unwrap().skills.is_empty());
        // Inherited frontend role untouched
        assert!(resolved.roles.contains_key("frontend"));
    }

    #[test]
    fn jsonc_preserves_utf8_accents_and_unicode_symbols() {
        let raw = r#"{
            // Comentário com acentuação: ç ã é í ó ú — ↔ 🚀
            "id": "utf8-check",
            "name": "Nível 1: Troca de instância — ç ã ✅",
            /* Bloco multilinha com Unicode: ↔ — 🚀
               "ignored": "valor" */
            "description": "Configuração avançada (Agy Principal ↔ Agy Veca) com emojis 🚀 e ✅ — prevenção de regressões.",
            "fallbackChain": [
                {
                    "providerInstanceId": "antigravity",
                    "model": "gemini-4-hydrogen",
                    "options": {
                        "thinking_level": "high" // comentário inline após string
                    },
                    "reason": "Nível 1: Troca de instância mantendo gemini-4-hydrogen (Agy Principal ↔ Agy Veca)",
                },
            ],
            "roles": {
                "revisor": {
                    "id": "revisor",
                    "title": "Revisor Técnico — Atenção & Qualidade",
                    "description": "Validação de acentuação: ç, ã, õ, é, ê, í, ó, ú, ↔, —, 🚀.",
                    "providerInstanceId": "antigravity_2",
                    "model": "gemini-4-argon",
                    "options": {
                        "thinking_level": "medium",
                    },
                },
            },
        }"#;

        let parsed = parse_jsonc_preset(raw).expect("valid UTF-8 jsonc");
        assert_eq!(parsed.name, "Nível 1: Troca de instância — ç ã ✅");
        assert_eq!(
            parsed.description,
            "Configuração avançada (Agy Principal ↔ Agy Veca) com emojis 🚀 e ✅ — prevenção de regressões."
        );
        assert_eq!(
            parsed.fallback_chain[0].reason,
            "Nível 1: Troca de instância mantendo gemini-4-hydrogen (Agy Principal ↔ Agy Veca)"
        );
        assert_eq!(
            parsed.roles["revisor"].title,
            "Revisor Técnico — Atenção & Qualidade"
        );
        assert_eq!(
            parsed.roles["revisor"].description,
            "Validação de acentuação: ç, ã, õ, é, ê, í, ó, ú, ↔, —, 🚀."
        );
        assert!(!looks_like_mojibake(&parsed.name));
        assert!(!looks_like_mojibake(&parsed.description));
        assert!(!looks_like_mojibake(&parsed.fallback_chain[0].reason));
    }

    #[test]
    fn seed_presets_roundtrip_preserve_utf8_and_thinking_level() {
        let seeds = default_seed_presets();
        assert_eq!(seeds.len(), 3);

        for seed in &seeds {
            let jsonc = format!(
                "// Built-in preset: {}\n{}\n",
                seed.name,
                serde_json::to_string_pretty(seed).unwrap()
            );
            assert!(
                !jsonc.contains("\"thinkingLevel\""),
                "seed {} should not contain legacy thinkingLevel",
                seed.id
            );

            let parsed = parse_jsonc_preset(&jsonc).expect("seed preset must parse cleanly");
            assert_eq!(&parsed, seed, "seed {} changed during JSONC roundtrip", seed.id);
            assert!(!looks_like_mojibake(&parsed.name));
            assert!(!looks_like_mojibake(&parsed.description));

            for step in &parsed.fallback_chain {
                assert!(!looks_like_mojibake(&step.reason));
                assert!(!step.reason.contains('Ã'), "mojibake found in {}", step.reason);
            }
        }

        let agy_dual = seeds.iter().find(|p| p.id == "agy-dual").unwrap();
        assert_eq!(
            agy_dual.fallback_chain[0].reason,
            "Nível 1: Troca de instância mantendo gemini-4-hydrogen (Agy Principal ↔ Agy Veca)"
        );
        assert_eq!(
            agy_dual.orchestrator.options.get("thinking_level").map(String::as_str),
            Some("high")
        );
        assert!(!agy_dual.orchestrator.options.contains_key("thinkingLevel"));
        for role in agy_dual.roles.values() {
            assert!(role.options.contains_key("thinking_level"));
            assert!(!role.options.contains_key("thinkingLevel"));
        }

        let hybrid = seeds.iter().find(|p| p.id == "hybrid-agy-codex").unwrap();
        assert_eq!(
            hybrid.orchestrator.options.get("thinking_level").map(String::as_str),
            Some("high")
        );
        assert!(!hybrid.orchestrator.options.contains_key("thinkingLevel"));
        assert!(hybrid.roles["frontend"].options.contains_key("thinking_level"));
        assert!(hybrid.roles["qa-reviewer"].options.contains_key("thinking_level"));
    }

    #[test]
    fn ensure_seed_presets_upgrades_legacy_thinking_level_and_mojibake() {
        let dir = tempdir().unwrap();
        let presets_dir = dir.path();

        // Simulate legacy agy-dual with thinkingLevel and mojibake ("Nível" decoded byte-by-byte as Latin-1)
        fs::write(
            presets_dir.join("agy-dual.jsonc"),
            "{\"id\":\"agy-dual\",\"name\":\"Agy Dual\",\"description\":\"NÃ\u{00AD}vel 1\",\"orchestrator\":{\"providerInstanceId\":\"antigravity_2\",\"model\":\"gemini-4-hydrogen\",\"options\":{\"thinkingLevel\":\"high\"}}}",
        )
        .unwrap();

        // Simulate a clean custom user edit on codex-squad (no thinkingLevel, no mojibake)
        let mut custom_codex = build_codex_squad_preset();
        custom_codex.name = "Codex Customizado".to_string();
        fs::write(
            presets_dir.join("codex-squad.jsonc"),
            serde_json::to_string_pretty(&custom_codex).unwrap(),
        )
        .unwrap();

        ensure_seed_presets(presets_dir).unwrap();

        let upgraded_agy = resolve_global_preset(presets_dir, "agy-dual").unwrap();
        assert_eq!(
            upgraded_agy.orchestrator.options.get("thinking_level").map(String::as_str),
            Some("high")
        );
        assert!(!upgraded_agy.orchestrator.options.contains_key("thinkingLevel"));
        assert!(!looks_like_mojibake(&upgraded_agy.description));

        let kept_codex = resolve_global_preset(presets_dir, "codex-squad").unwrap();
        assert_eq!(kept_codex.name, "Codex Customizado");
    }
}
