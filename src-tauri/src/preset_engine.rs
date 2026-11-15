use crate::models::{
    AppError, AppPaths, AppResult, ContentionPolicy, FallbackStep, GlobalAppConfig,
    OrchestratorSelection, PresetConfig, ResolvedProjectPreset, RoleConfig,
};
use serde::Deserialize;
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};

/// Process-wide lock serializing Read-Modify-Write operations on `config.jsonc`,
/// `presets/*.jsonc`, `.t3code/preset.jsonc`, and compiled `.agents/skills/*-squad/` artifacts.
///
/// Lock hierarchy (strict acquisition order to prevent deadlocks):
/// 1. `preset_engine::lock_config_state()` (outer)
/// 2. `settings_sync::lock_settings_file()` (inner / leaf)
///
/// Callers holding `lock_config_state()` MUST invoke `*_unlocked` internal functions
/// rather than re-entering locked public entry points, and code holding `lock_settings_file()`
/// MUST NEVER acquire `lock_config_state()`.
pub(crate) fn lock_config_state() -> MutexGuard<'static, ()> {
    static CONFIG_STATE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    CONFIG_STATE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

const MAX_INHERITANCE_DEPTH: usize = 16;
pub const OMOS_CANONICAL_ROLES: [&str; 5] = [
    "explorer",
    "oracle",
    "designer",
    "fixer",
    "qa-reviewer",
];

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
    enabled: Option<bool>,
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
    let enabled = patch.enabled.unwrap_or(base.enabled);
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
        enabled,
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
        enabled: true,
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
    let _guard = lock_config_state();
    resolve_global_preset_unlocked(presets_dir, id)
}

pub(crate) fn resolve_global_preset_unlocked(
    presets_dir: &Path,
    id: &str,
) -> AppResult<PresetConfig> {
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
    let _guard = lock_config_state();
    resolve_jsonc_against_globals_unlocked(presets_dir, raw_jsonc, fallback_id)
}

pub(crate) fn resolve_jsonc_against_globals_unlocked(
    presets_dir: &Path,
    raw_jsonc: &str,
    fallback_id: &str,
) -> AppResult<PresetConfig> {
    let patch = parse_jsonc_patch(raw_jsonc)?;
    let base = if let Some(parent_id) = &patch.extends {
        resolve_global_preset_unlocked(presets_dir, parent_id)?
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
    let _guard = lock_config_state();
    resolve_preset_inheritance_unlocked(presets_dir, preset)
}

pub(crate) fn resolve_preset_inheritance_unlocked(
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
        let parent = resolve_global_preset_unlocked(presets_dir, parent_id)?;
        let serialized = serde_json::to_string(&preset)?;
        let patch: PresetPatch = serde_json::from_str(&serialized)?;
        Ok(merge_patch(parent, patch, &preset.id))
    } else {
        Ok(preset)
    }
}

static ATOMIC_TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Atomic file write helper inside a target directory.
///
/// Uses `std::process::id()` + a monotonically increasing `AtomicU64` suffix and
/// `OpenOptions::create_new(true)` so concurrent callers in the same process never
/// collide on a shared temporary file, and removes the temp file on any error.
pub fn atomic_write_file(target_path: &Path, content: &[u8]) -> AppResult<()> {
    let parent = target_path.parent().ok_or_else(|| {
        AppError::InvalidInput(format!("Path {} has no parent directory", target_path.display()))
    })?;
    fs::create_dir_all(parent)?;

    let file_name = target_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let pid = std::process::id();

    const MAX_OPEN_ATTEMPTS: usize = 64;
    let mut opened: Option<(PathBuf, fs::File)> = None;
    for _ in 0..MAX_OPEN_ATTEMPTS {
        let seq = ATOMIC_TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".{file_name}.tmp.{pid}.{seq}"));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => {
                opened = Some((candidate, file));
                break;
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(err.into()),
        }
    }

    let (tmp_path, mut file) = opened.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!(
                "Failed to allocate unique temporary file for {}",
                target_path.display()
            ),
        )
    })?;

    let write_result = (|| -> std::io::Result<()> {
        file.write_all(content)?;
        file.sync_all()?;
        Ok(())
    })();
    drop(file);

    if let Err(err) = write_result {
        let _ = fs::remove_file(&tmp_path);
        return Err(err.into());
    }

    if let Err(err) = fs::rename(&tmp_path, target_path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(err.into());
    }

    Ok(())
}

/// Returns the 4 built-in seed presets (`default`, `agy-dual`, `codex-squad`, `hybrid-agy-codex`).
pub fn default_seed_presets() -> Vec<PresetConfig> {
    vec![
        build_default_preset(),
        build_agy_dual_preset(),
        build_codex_squad_preset(),
        build_hybrid_preset(),
    ]
}

/// Built-in installation `default` preset mirroring `oh-my-opencode-slim` default on T3 Code's universal `codex` provider.
pub fn build_default_preset() -> PresetConfig {
    let mut roles = BTreeMap::new();
    let luna_low_opts = BTreeMap::from([
        ("reasoningEffort".to_string(), "low".to_string()),
        ("serviceTier".to_string(), "default".to_string()),
    ]);
    let luna_medium_opts = BTreeMap::from([
        ("reasoningEffort".to_string(), "medium".to_string()),
        ("serviceTier".to_string(), "default".to_string()),
    ]);
    let sol_low_opts = BTreeMap::from([
        ("reasoningEffort".to_string(), "low".to_string()),
        ("serviceTier".to_string(), "default".to_string()),
    ]);
    let sol_medium_opts = BTreeMap::from([
        ("reasoningEffort".to_string(), "medium".to_string()),
        ("serviceTier".to_string(), "default".to_string()),
    ]);
    let sol_high_opts = BTreeMap::from([
        ("reasoningEffort".to_string(), "high".to_string()),
        ("serviceTier".to_string(), "default".to_string()),
    ]);
    let terra_high_opts = BTreeMap::from([
        ("reasoningEffort".to_string(), "high".to_string()),
        ("serviceTier".to_string(), "default".to_string()),
    ]);
    let astra_high_opts = BTreeMap::from([
        ("reasoningEffort".to_string(), "high".to_string()),
        ("serviceTier".to_string(), "default".to_string()),
    ]);

    roles.insert(
        "explorer".to_string(),
        RoleConfig {
            id: "explorer".to_string(),
            title: "Explorer".to_string(),
            description: "Pesquisa rápida read-only no codebase e documentação (context7, ai-memory).".to_string(),
            when_to_use: "Descoberta inicial de arquivos, símbolos, contratos IPC e documentação via context7/ai-memory.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6-luna".to_string(),
            options: luna_low_opts,
            skills: vec![
                "ai-memory-retrieval".to_string(),
                "systematic-debugging".to_string(),
            ],
            mcps: vec!["context7".to_string(), "ai-memory".to_string()],
            allowed_paths: vec!["**/* (read-only)".to_string()],
            forbidden_paths: vec!["Edições em arquivos de código ou configuração".to_string()],
            invariants: vec![
                "Atuar estritamente em modo read-only retornando paths e símbolos verificados.".to_string(),
            ],
            verification_commands: vec![],
        },
    );
    roles.insert(
        "oracle".to_string(),
        RoleConfig {
            id: "oracle".to_string(),
            title: "Oracle".to_string(),
            description: "Revisão de arquitetura, decisões de alto risco, simplificação e debug de último recurso.".to_string(),
            when_to_use: "Decisões estruturais, migrações críticas, concorrência e análise de causa raiz difícil.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6.1-sol".to_string(),
            options: sol_high_opts,
            skills: vec![
                "systematic-debugging".to_string(),
                "code-review-and-security".to_string(),
                "ai-memory-retrieval".to_string(),
            ],
            mcps: vec!["ai-memory".to_string(), "context7".to_string()],
            allowed_paths: vec!["**/* (arquitetura e diagnóstico)".to_string()],
            forbidden_paths: vec!["Mudanças cosméticas fora do escopo arquitetural".to_string()],
            invariants: vec![
                "Preservar acesso read-only ao statev2.sqlite e escrita atômica com backup em settings.json.".to_string(),
            ],
            verification_commands: vec![
                "cargo check --manifest-path src-tauri/Cargo.toml".to_string(),
            ],
        },
    );
    roles.insert(
        "designer".to_string(),
        RoleConfig {
            id: "designer".to_string(),
            title: "Designer".to_string(),
            description: "Implementação de UI/UX, layout, hierarquia visual, responsividade e Tailwind CSS v4.".to_string(),
            when_to_use: "Telas, estados vazios, interações, acessibilidade, design tokens e componentes visuais.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6-luna".to_string(),
            options: luna_medium_opts.clone(),
            skills: vec![
                "tailwind-v4-design".to_string(),
                "frontend-design".to_string(),
                "better-ui".to_string(),
                "better-accessibility".to_string(),
                "better-layout".to_string(),
            ],
            mcps: vec!["context7".to_string(), "playwright".to_string(), "ai-memory".to_string()],
            allowed_paths: vec!["src/**".to_string(), "app/views/**".to_string(), "app/javascript/**".to_string()],
            forbidden_paths: vec!["src-tauri/**".to_string(), "db/migrate/**".to_string()],
            invariants: vec![
                "Preservar paridade estrita com o contrato IPC/API.".to_string(),
                "Garantir foco visível, contraste WCAG e copy claro.".to_string(),
            ],
            verification_commands: vec![
                "bun run typecheck".to_string(),
                "bun run test".to_string(),
                "bun run build".to_string(),
            ],
        },
    );
    roles.insert(
        "fixer".to_string(),
        RoleConfig {
            id: "fixer".to_string(),
            title: "Fixer".to_string(),
            description: "Especialista de implementação rápida e mudanças mecânicas/multi-arquivo bem definidas.".to_string(),
            when_to_use: "Implementações de domínio, APIs, persistência, CLIs, módulos Rust/Rails e correções com testes.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6.1-sol".to_string(),
            options: sol_low_opts,
            skills: vec![
                "tdd-and-testing".to_string(),
                "systems-rust-go-crystal".to_string(),
                "rails-8-modern".to_string(),
                "systematic-debugging".to_string(),
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
        "qa-reviewer".to_string(),
        RoleConfig {
            id: "qa-reviewer".to_string(),
            title: "QA / Security Reviewer".to_string(),
            description: "Auditoria independente de qualidade, segurança e execução completa da suíte de testes/CI.".to_string(),
            when_to_use: "Revisão final após implementação ou antes de encerrar entrega/PR.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6-astra".to_string(),
            options: astra_high_opts.clone(),
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
                "Auditar de forma independente sem editar arquivos de feature.".to_string(),
                "Reportar saídas literais de testes, lint e build sem mascarar falhas.".to_string(),
            ],
            verification_commands: vec![
                "cargo test --manifest-path src-tauri/Cargo.toml".to_string(),
                "bun run typecheck && bun run build".to_string(),
            ],
        },
    );

    PresetConfig {
        id: "default".to_string(),
        name: "Default (OMOS Standard)".to_string(),
        description: "Preset global padrão de instalação (inspirado no default do oh-my-opencode-slim): orquestrador, oracle e fixer em gpt-6.1-sol, explorer e designer em gpt-6-luna, e qa-reviewer em gpt-6-astra.".to_string(),
        extends: None,
        enabled: true,
        topology: "intra-thread-squad".to_string(),
        orchestrator: OrchestratorSelection {
            provider_instance_id: "codex".to_string(),
            model: "gpt-6.1-sol".to_string(),
            options: sol_medium_opts,
        },
        fallback_chain: vec![
            FallbackStep {
                provider_instance_id: "codex".to_string(),
                model: "gpt-6.1-terra".to_string(),
                options: terra_high_opts,
                reason: "Nível 1: Fallback rápido mantendo raciocínio alto em gpt-6.1-terra".to_string(),
            },
            FallbackStep {
                provider_instance_id: "codex".to_string(),
                model: "gpt-6-astra".to_string(),
                options: astra_high_opts,
                reason: "Nível 2: Fallback alternativo em gpt-6-astra quando o modelo primário atingir limite".to_string(),
            },
            FallbackStep {
                provider_instance_id: "codex".to_string(),
                model: "gpt-6-luna".to_string(),
                options: luna_medium_opts,
                reason: "Nível 3: Fallback leve de continuidade em gpt-6-luna antes de pausar".to_string(),
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

fn build_agy_dual_preset() -> PresetConfig {
    let mut roles = BTreeMap::new();
    roles.insert(
        "explorer".to_string(),
        RoleConfig {
            id: "explorer".to_string(),
            title: "Explorer".to_string(),
            description: "Pesquisa rápida de código, mapeamento read-only do repositório e consulta de docs.".to_string(),
            when_to_use: "Descoberta inicial de arquivos, símbolos, contratos IPC e documentação via context7/ai-memory.".to_string(),
            provider_instance_id: "antigravity".to_string(),
            model: "gemini-4-hydrogen".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "low".to_string())]),
            skills: vec![
                "ai-memory-retrieval".to_string(),
                "systematic-debugging".to_string(),
            ],
            mcps: vec!["context7".to_string(), "ai-memory".to_string()],
            allowed_paths: vec!["**/* (read-only)".to_string()],
            forbidden_paths: vec!["Edições em arquivos de código ou configuração".to_string()],
            invariants: vec![
                "Atuar estritamente em modo read-only retornando paths e símbolos verificados.".to_string(),
            ],
            verification_commands: vec![],
        },
    );
    roles.insert(
        "oracle".to_string(),
        RoleConfig {
            id: "oracle".to_string(),
            title: "Oracle".to_string(),
            description: "Arquitetura, trade-offs de alto risco, simplificação de design e debug complexo.".to_string(),
            when_to_use: "Decisões estruturais, migrações críticas, concorrência e análise de causa raiz difícil.".to_string(),
            provider_instance_id: "antigravity_2".to_string(),
            model: "gemini-4-argon".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
            skills: vec![
                "systematic-debugging".to_string(),
                "code-review-and-security".to_string(),
                "ai-memory-retrieval".to_string(),
            ],
            mcps: vec!["ai-memory".to_string(), "context7".to_string()],
            allowed_paths: vec!["**/* (arquitetura e diagnóstico)".to_string()],
            forbidden_paths: vec!["Mudanças cosméticas fora do escopo arquitetural".to_string()],
            invariants: vec![
                "Preservar acesso read-only ao statev2.sqlite e escrita atômica com backup em settings.json.".to_string(),
            ],
            verification_commands: vec![
                "cargo check --manifest-path src-tauri/Cargo.toml".to_string(),
            ],
        },
    );
    roles.insert(
        "designer".to_string(),
        RoleConfig {
            id: "designer".to_string(),
            title: "Designer".to_string(),
            description: "Implementação de UI/UX, layout, tipografia, responsividade e Tailwind CSS v4.".to_string(),
            when_to_use: "Telas, estados vazios, interações, acessibilidade, design tokens e componentes visuais.".to_string(),
            provider_instance_id: "antigravity_2".to_string(),
            model: "gemini-4-hydrogen".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "medium".to_string())]),
            skills: vec![
                "tailwind-v4-design".to_string(),
                "frontend-design".to_string(),
                "better-ui".to_string(),
                "better-accessibility".to_string(),
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
        "fixer".to_string(),
        RoleConfig {
            id: "fixer".to_string(),
            title: "Fixer".to_string(),
            description: "Implementação rápida e bem delimitada de backend, módulos de domínio e correções.".to_string(),
            when_to_use: "Implementações de domínio, APIs, persistência, CLIs, módulos Rust/Rails e correções com testes.".to_string(),
            provider_instance_id: "antigravity".to_string(),
            model: "gemini-4-hydrogen".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
            skills: vec![
                "tdd-and-testing".to_string(),
                "systems-rust-go-crystal".to_string(),
                "rails-8-modern".to_string(),
                "systematic-debugging".to_string(),
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
        description: "Preset padrão estilo oh-my-opencode-slim adaptado ao T3 Code: balanceia antigravity (Agy Veca) e antigravity_2 (Agy Principal) com explorer, oracle, designer, fixer e qa-reviewer.".to_string(),
        extends: None,
        enabled: true,
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
    let luna_opts = BTreeMap::from([
        ("reasoningEffort".to_string(), "low".to_string()),
        ("serviceTier".to_string(), "default".to_string()),
    ]);
    let xhigh_opts = BTreeMap::from([
        ("reasoningEffort".to_string(), "xhigh".to_string()),
        ("serviceTier".to_string(), "default".to_string()),
    ]);
    let sol_opts = BTreeMap::from([
        ("reasoningEffort".to_string(), "high".to_string()),
        ("serviceTier".to_string(), "default".to_string()),
    ]);
    let terra_opts = BTreeMap::from([
        ("reasoningEffort".to_string(), "medium".to_string()),
        ("serviceTier".to_string(), "default".to_string()),
    ]);

    roles.insert(
        "explorer".to_string(),
        RoleConfig {
            id: "explorer".to_string(),
            title: "Explorer".to_string(),
            description: "Pesquisa rápida de código, mapeamento read-only e consulta de docs com gpt-6-luna.".to_string(),
            when_to_use: "Mapeamento de codebase, busca de símbolos e leitura de documentação.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6-luna".to_string(),
            options: luna_opts,
            skills: vec!["ai-memory-retrieval".to_string(), "systematic-debugging".to_string()],
            mcps: vec!["context7".to_string(), "ai-memory".to_string()],
            allowed_paths: vec!["**/* (read-only)".to_string()],
            forbidden_paths: vec!["Edições em arquivos de produção".to_string()],
            invariants: vec![
                "Atuar em modo somente leitura e citar caminhos e linhas verificados.".to_string(),
            ],
            verification_commands: vec![],
        },
    );
    roles.insert(
        "oracle".to_string(),
        RoleConfig {
            id: "oracle".to_string(),
            title: "Oracle".to_string(),
            description: "Arquitetura, trade-offs de alto risco, simplificação e debug complexo com gpt-6.1-sol (xhigh).".to_string(),
            when_to_use: "Decisões de schema, concorrência, arquitetura de serviços e debugging profundo.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6.1-sol".to_string(),
            options: xhigh_opts,
            skills: vec!["systematic-debugging".to_string(), "code-review-and-security".to_string(), "ai-memory-retrieval".to_string()],
            mcps: vec!["ai-memory".to_string(), "context7".to_string()],
            allowed_paths: vec!["**/* (arquitetura e diagnóstico)".to_string()],
            forbidden_paths: vec!["Mudanças cosméticas fora do escopo arquitetural".to_string()],
            invariants: vec![
                "Preservar integridade de schema, segurança e contratos IPC/API.".to_string(),
            ],
            verification_commands: vec!["git status --short".to_string()],
        },
    );
    roles.insert(
        "designer".to_string(),
        RoleConfig {
            id: "designer".to_string(),
            title: "Designer".to_string(),
            description: "Implementação de UI/UX, layout, tipografia, responsividade e Tailwind CSS v4 com gpt-6.1-terra.".to_string(),
            when_to_use: "Implementação e ajuste de interface, CSS, acessibilidade e comportamento no navegador.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6.1-terra".to_string(),
            options: terra_opts.clone(),
            skills: vec![
                "tailwind-v4-design".to_string(),
                "frontend-design".to_string(),
                "better-ui".to_string(),
                "better-accessibility".to_string(),
            ],
            mcps: vec!["context7".to_string(), "playwright".to_string()],
            allowed_paths: vec!["app/views/**".to_string(), "app/javascript/**".to_string(), "src/**".to_string()],
            forbidden_paths: vec!["db/**".to_string(), "app/models/**".to_string()],
            invariants: vec![
                "Manter escape seguro, contraste WCAG e responsividade desktop/mobile.".to_string(),
            ],
            verification_commands: vec!["bun run typecheck".to_string()],
        },
    );
    roles.insert(
        "fixer".to_string(),
        RoleConfig {
            id: "fixer".to_string(),
            title: "Fixer".to_string(),
            description: "Implementação rápida e bem delimitada de backend, módulos e correções com gpt-6.1-sol.".to_string(),
            when_to_use: "Models, schema, serviços, módulos Rust/Rails e correções bem delimitadas.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6.1-sol".to_string(),
            options: sol_opts.clone(),
            skills: vec![
                "tdd-and-testing".to_string(),
                "systems-rust-go-crystal".to_string(),
                "rails-8-modern".to_string(),
                "systematic-debugging".to_string(),
            ],
            mcps: vec!["ai-memory".to_string(), "context7".to_string()],
            allowed_paths: vec!["app/models/**".to_string(), "app/controllers/**".to_string(), "db/**".to_string(), "src-tauri/**".to_string()],
            forbidden_paths: vec!["app/views/**".to_string(), "app/assets/**".to_string()],
            invariants: vec![
                "Um único executor de DB de testes por vez; sem escritas paralelas em schema/rotas.".to_string(),
                "Preservar autenticação, parâmetros fortes e integridade de métricas.".to_string(),
            ],
            verification_commands: vec!["bin/rails test".to_string()],
        },
    );
    roles.insert(
        "qa-reviewer".to_string(),
        RoleConfig {
            id: "qa-reviewer".to_string(),
            title: "QA / Reviewer".to_string(),
            description: "Auditoria independente de segurança, testes e CI completo com gpt-6-astra.".to_string(),
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
        description: "Preset estruturado estilo oh-my-opencode-slim para OpenAI Codex: Luna (explorer), Sol (oracle/fixer), Terra (designer) e Astra (qa-reviewer).".to_string(),
        extends: None,
        enabled: true,
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
        "explorer".to_string(),
        RoleConfig {
            id: "explorer".to_string(),
            title: "Explorer (Hydrogen)".to_string(),
            description: "Pesquisa rápida de código, mapeamento read-only e consulta de docs com gemini-4-hydrogen.".to_string(),
            when_to_use: "Descoberta rápida de arquivos, referências e documentação.".to_string(),
            provider_instance_id: "antigravity".to_string(),
            model: "gemini-4-hydrogen".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "low".to_string())]),
            skills: vec!["ai-memory-retrieval".to_string(), "systematic-debugging".to_string()],
            mcps: vec!["context7".to_string(), "ai-memory".to_string()],
            allowed_paths: vec!["**/* (read-only)".to_string()],
            forbidden_paths: vec!["Edições em arquivos de produção".to_string()],
            invariants: vec!["Operação estritamente read-only.".to_string()],
            verification_commands: vec![],
        },
    );
    roles.insert(
        "oracle".to_string(),
        RoleConfig {
            id: "oracle".to_string(),
            title: "Oracle (Codex Sol)".to_string(),
            description: "Arquitetura, trade-offs de alto risco, simplificação e debug complexo com Codex Sol.".to_string(),
            when_to_use: "Decisões críticas de arquitetura, concorrência e algoritmos centrais.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6.1-sol".to_string(),
            options: BTreeMap::from([
                ("reasoningEffort".to_string(), "xhigh".to_string()),
                ("serviceTier".to_string(), "default".to_string()),
            ]),
            skills: vec!["systematic-debugging".to_string(), "code-review-and-security".to_string(), "ai-memory-retrieval".to_string()],
            mcps: vec!["ai-memory".to_string(), "context7".to_string()],
            allowed_paths: vec!["**/* (arquitetura e diagnóstico)".to_string()],
            forbidden_paths: vec!["Alterações visuais fora do escopo arquitetural".to_string()],
            invariants: vec!["Validar invariantes de segurança, concorrência e contratos IPC.".to_string()],
            verification_commands: vec!["cargo check --manifest-path src-tauri/Cargo.toml".to_string()],
        },
    );
    roles.insert(
        "designer".to_string(),
        RoleConfig {
            id: "designer".to_string(),
            title: "Designer (Hydrogen)".to_string(),
            description: "Implementação de UI/UX, layout, tipografia, responsividade e Tailwind CSS v4 com gemini-4-hydrogen.".to_string(),
            when_to_use: "Componentes visuais, CSS, responsividade e acessibilidade.".to_string(),
            provider_instance_id: "antigravity".to_string(),
            model: "gemini-4-hydrogen".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
            skills: vec![
                "tailwind-v4-design".to_string(),
                "frontend-design".to_string(),
                "better-ui".to_string(),
                "better-accessibility".to_string(),
            ],
            mcps: vec!["context7".to_string(), "playwright".to_string(), "ai-memory".to_string()],
            allowed_paths: vec!["src/**".to_string()],
            forbidden_paths: vec!["src-tauri/**".to_string()],
            invariants: vec!["Manter paridade 1:1 com tipos IPC.".to_string()],
            verification_commands: vec!["bun run typecheck".to_string(), "bun run build".to_string()],
        },
    );
    roles.insert(
        "fixer".to_string(),
        RoleConfig {
            id: "fixer".to_string(),
            title: "Fixer (Codex Sol)".to_string(),
            description: "Implementação rápida e bem delimitada de backend, módulos e correções com Codex Sol.".to_string(),
            when_to_use: "Serviços, persistência, módulos Rust/Rails e correções bem delimitadas.".to_string(),
            provider_instance_id: "codex".to_string(),
            model: "gpt-6.1-sol".to_string(),
            options: BTreeMap::from([
                ("reasoningEffort".to_string(), "high".to_string()),
                ("serviceTier".to_string(), "default".to_string()),
            ]),
            skills: vec![
                "tdd-and-testing".to_string(),
                "systems-rust-go-crystal".to_string(),
                "rails-8-modern".to_string(),
            ],
            mcps: vec!["ai-memory".to_string(), "context7".to_string()],
            allowed_paths: vec!["src-tauri/**".to_string(), "backend/**".to_string()],
            forbidden_paths: vec!["src/components/**".to_string()],
            invariants: vec!["Testes automatizados obrigatórios antes da entrega.".to_string()],
            verification_commands: vec!["cargo test".to_string()],
        },
    );
    roles.insert(
        "qa-reviewer".to_string(),
        RoleConfig {
            id: "qa-reviewer".to_string(),
            title: "QA / Reviewer (Argon)".to_string(),
            description: "Auditoria independente de segurança, testes e CI com gemini-4-argon.".to_string(),
            when_to_use: "Validação final após integração entre Fixer Codex e Designer Agy.".to_string(),
            provider_instance_id: "antigravity_2".to_string(),
            model: "gemini-4-argon".to_string(),
            options: BTreeMap::from([("thinking_level".to_string(), "high".to_string())]),
            skills: vec!["code-review-and-security".to_string(), "security-audit".to_string(), "webapp-testing".to_string()],
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
        description: "Estratégia híbrida estilo oh-my-opencode-slim: gemini-4-hydrogen para explorer/designer, Codex gpt-6.1-sol para oracle/fixer e gemini-4-argon para qa-reviewer.".to_string(),
        extends: None,
        enabled: true,
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

fn has_all_omos_roles(raw: &str) -> bool {
    let Ok(parsed) = parse_jsonc_preset(raw) else {
        return false;
    };
    OMOS_CANONICAL_ROLES
        .iter()
        .all(|role_id| parsed.roles.contains_key(*role_id))
}

/// Ensures the 4 built-in global presets (`default`, `agy-dual`, `codex-squad`, `hybrid-agy-codex`) exist in `presets_dir`
/// without overwriting user edits, while automatically repairing/migrating legacy seed files containing `"thinkingLevel"`,
/// UTF-8 mojibake, or missing the canonical OMOS roles (`explorer`, `oracle`, `designer`, `fixer`, `qa-reviewer`).
/// Also initializes `~/.config/oh-my-t3code/config.jsonc` with `activeGlobalPresetId: "default"` and `enabled: true` if absent.
pub fn ensure_seed_presets(presets_dir: &Path) -> AppResult<()> {
    let _guard = lock_config_state();
    ensure_seed_presets_unlocked(presets_dir)
}

pub(crate) fn ensure_seed_presets_unlocked(presets_dir: &Path) -> AppResult<()> {
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
                    if raw.contains("\"thinkingLevel\"")
                        || looks_like_mojibake(&raw)
                        || !has_all_omos_roles(&raw)
                    {
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

    if presets_dir.file_name().and_then(|s| s.to_str()) == Some("presets") {
        if let Some(config_root) = presets_dir.parent() {
            let config_path = config_root.join("config.jsonc");
            if !config_path.exists() {
                save_global_config_unlocked(&config_path, &GlobalAppConfig::default())?;
            }
        }
    }

    Ok(())
}

/// Loads `~/.config/oh-my-t3code/config.jsonc` safely, returning defaults (`default`, `enabled: true`) if absent or invalid.
pub fn load_global_config(config_path: &Path) -> GlobalAppConfig {
    let _guard = lock_config_state();
    load_global_config_unlocked(config_path)
}

pub(crate) fn load_global_config_unlocked(config_path: &Path) -> GlobalAppConfig {
    let Ok(raw) = fs::read_to_string(config_path) else {
        return GlobalAppConfig::default();
    };
    let clean = strip_jsonc_comments(&raw);
    let Ok(cfg) = serde_json::from_str::<GlobalAppConfig>(&clean) else {
        return GlobalAppConfig::default();
    };
    if validate_safe_id(&cfg.active_global_preset_id, "active_global_preset_id").is_err() {
        return GlobalAppConfig {
            active_global_preset_id: GlobalAppConfig::default().active_global_preset_id,
            enabled: cfg.enabled,
        };
    }
    cfg
}

/// Saves `~/.config/oh-my-t3code/config.jsonc` atomically.
pub fn save_global_config(config_path: &Path, config: &GlobalAppConfig) -> AppResult<()> {
    let _guard = lock_config_state();
    save_global_config_unlocked(config_path, config)
}

pub(crate) fn save_global_config_unlocked(
    config_path: &Path,
    config: &GlobalAppConfig,
) -> AppResult<()> {
    validate_safe_id(&config.active_global_preset_id, "active_global_preset_id")?;
    let content = format!(
        "// Oh My T3Code global configuration\n{}\n",
        serde_json::to_string_pretty(config)?
    );
    atomic_write_file(config_path, content.as_bytes())
}

/// Lists and resolves all global presets in `presets_dir`, placing `default` first.
pub fn list_global_presets(presets_dir: &Path) -> AppResult<Vec<PresetConfig>> {
    let _guard = lock_config_state();
    list_global_presets_unlocked(presets_dir)
}

pub(crate) fn list_global_presets_unlocked(presets_dir: &Path) -> AppResult<Vec<PresetConfig>> {
    ensure_seed_presets_unlocked(presets_dir)?;
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
        if let Ok(resolved) = resolve_global_preset_unlocked(presets_dir, id) {
            presets.push(resolved);
        }
    }
    presets.sort_by(|a, b| {
        let rank = |id: &str| match id {
            "default" => 0,
            "agy-dual" => 1,
            "codex-squad" => 2,
            "hybrid-agy-codex" => 3,
            _ => 4,
        };
        rank(&a.id).cmp(&rank(&b.id)).then_with(|| a.id.cmp(&b.id))
    });
    Ok(presets)
}

/// Saves a global preset as `<presets_dir>/<id>.jsonc` atomically.
pub fn save_global_preset(presets_dir: &Path, preset: PresetConfig) -> AppResult<PresetConfig> {
    let _guard = lock_config_state();
    save_global_preset_unlocked(presets_dir, preset)
}

pub(crate) fn save_global_preset_unlocked(
    presets_dir: &Path,
    mut preset: PresetConfig,
) -> AppResult<PresetConfig> {
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
    resolve_global_preset_unlocked(presets_dir, &preset.id)
}

pub fn local_preset_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".t3code").join("preset.jsonc")
}

/// Saves a project-level preset override to `<workspace_root>/.t3code/preset.jsonc`.
pub fn save_project_preset(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
    preset: PresetConfig,
) -> AppResult<ResolvedProjectPreset> {
    let _guard = lock_config_state();
    save_project_preset_unlocked(paths, project_id, workspace_root, preset)
}

pub(crate) fn save_project_preset_unlocked(
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

    let resolved = resolve_preset_inheritance_unlocked(&paths.presets_dir, preset.clone())?;
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

/// Resolves the active preset for a project, falling back to detected squad or `default` / `codex-squad`.
pub fn get_project_preset(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
    active_instance_hint: Option<&str>,
) -> AppResult<ResolvedProjectPreset> {
    let _guard = lock_config_state();
    get_project_preset_unlocked(paths, project_id, workspace_root, active_instance_hint)
}

pub(crate) fn get_project_preset_unlocked(
    paths: &AppPaths,
    project_id: &str,
    workspace_root: &str,
    active_instance_hint: Option<&str>,
) -> AppResult<ResolvedProjectPreset> {
    ensure_seed_presets_unlocked(&paths.presets_dir)?;
    let root = Path::new(workspace_root);
    let local_path = local_preset_path(root);
    let project_slug = derive_project_slug(workspace_root);
    let detected_squad = detect_squad_dir(root);

    if local_path.exists() {
        let raw = fs::read_to_string(&local_path)?;
        let resolved =
            resolve_jsonc_against_globals_unlocked(&paths.presets_dir, &raw, &project_slug)?;
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

    let global_cfg = load_global_config_unlocked(&paths.global_config_path());
    let fallback_id = match active_instance_hint {
        Some("codex") => "codex-squad",
        _ => global_cfg.active_global_preset_id.as_str(),
    };
    let resolved = resolve_global_preset_unlocked(&paths.presets_dir, fallback_id)
        .or_else(|_| resolve_global_preset_unlocked(&paths.presets_dir, "default"))
        .or_else(|_| resolve_global_preset_unlocked(&paths.presets_dir, "agy-dual"))?;

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
                "fixer": {
                    "id": "fixer",
                    "title": "Fixer",
                    "providerInstanceId": "antigravity",
                    "model": "gemini-4-hydrogen",
                },
            },
        }"#;
        let parsed = parse_jsonc_preset(raw).expect("valid jsonc");
        assert_eq!(parsed.id, "demo");
        assert!(parsed.enabled);
        assert_eq!(
            parsed.name,
            "Demo // keep inside string /* also keep */"
        );
        assert!(parsed.roles.contains_key("fixer"));
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
                "fixer": {
                    "model": "gemini-4-argon"
                }
            }
        }"#;

        let resolved =
            resolve_jsonc_against_globals(presets_dir, child_jsonc, "custom-child").unwrap();
        assert_eq!(resolved.id, "custom-child");
        assert!(resolved.enabled);
        assert_eq!(resolved.orchestrator.provider_instance_id, "antigravity");
        // Inherited from agy-dual
        assert_eq!(resolved.orchestrator.model, "gemini-4-hydrogen");
        assert_eq!(
            resolved.roles.get("fixer").unwrap().model,
            "gemini-4-argon"
        );
        // Inherited skills from agy-dual fixer role
        assert!(!resolved.roles.get("fixer").unwrap().skills.is_empty());
        // Inherited OMOS roles untouched
        assert!(resolved.roles.contains_key("explorer"));
        assert!(resolved.roles.contains_key("oracle"));
        assert!(resolved.roles.contains_key("designer"));
        assert!(resolved.roles.contains_key("qa-reviewer"));
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
    fn seed_presets_have_omos_roles_enabled_and_preserve_utf8() {
        let seeds = default_seed_presets();
        assert_eq!(seeds.len(), 4);
        assert_eq!(seeds[0].id, "default");

        for seed in &seeds {
            assert!(seed.enabled, "seed {} should start enabled", seed.id);
            for canonical in OMOS_CANONICAL_ROLES {
                assert!(
                    seed.roles.contains_key(canonical),
                    "seed {} missing OMOS canonical role '{}'",
                    seed.id,
                    canonical
                );
            }

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

        let default_preset = &seeds[0];
        assert_eq!(default_preset.name, "Default (OMOS Standard)");
        assert_eq!(default_preset.topology, "intra-thread-squad");
        assert_eq!(default_preset.orchestrator.provider_instance_id, "codex");
        assert_eq!(default_preset.orchestrator.model, "gpt-6.1-sol");
        assert_eq!(
            default_preset.orchestrator.options.get("reasoningEffort").map(String::as_str),
            Some("medium")
        );
        assert_eq!(
            default_preset.orchestrator.options.get("serviceTier").map(String::as_str),
            Some("default")
        );
        assert_eq!(default_preset.fallback_chain.len(), 3);
        assert_eq!(default_preset.fallback_chain[0].model, "gpt-6.1-terra");
        assert_eq!(default_preset.fallback_chain[1].model, "gpt-6-astra");
        assert_eq!(default_preset.fallback_chain[2].model, "gpt-6-luna");
        assert_eq!(default_preset.roles["explorer"].model, "gpt-6-luna");
        assert_eq!(
            default_preset.roles["explorer"].options.get("reasoningEffort").map(String::as_str),
            Some("low")
        );
        assert_eq!(default_preset.roles["oracle"].model, "gpt-6.1-sol");
        assert_eq!(
            default_preset.roles["oracle"].options.get("reasoningEffort").map(String::as_str),
            Some("high")
        );
        assert_eq!(default_preset.roles["designer"].model, "gpt-6-luna");
        assert_eq!(
            default_preset.roles["designer"].options.get("reasoningEffort").map(String::as_str),
            Some("medium")
        );
        assert_eq!(default_preset.roles["fixer"].model, "gpt-6.1-sol");
        assert_eq!(
            default_preset.roles["fixer"].options.get("reasoningEffort").map(String::as_str),
            Some("low")
        );
        assert_eq!(default_preset.roles["qa-reviewer"].model, "gpt-6-astra");
        assert_eq!(
            default_preset.roles["qa-reviewer"].options.get("reasoningEffort").map(String::as_str),
            Some("high")
        );

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
        assert!(hybrid.roles["explorer"].options.contains_key("thinking_level"));
        assert!(hybrid.roles["designer"].options.contains_key("thinking_level"));
        assert!(hybrid.roles["qa-reviewer"].options.contains_key("thinking_level"));
    }

    #[test]
    fn ensure_seed_presets_upgrades_legacy_thinking_level_mojibake_and_missing_omos_roles() {
        let dir = tempdir().unwrap();
        let config_root = dir.path().join("oh-my-t3code");
        let presets_dir = config_root.join("presets");
        fs::create_dir_all(&presets_dir).unwrap();

        // Simulate legacy agy-dual with thinkingLevel and mojibake ("Nível" decoded byte-by-byte as Latin-1)
        fs::write(
            presets_dir.join("agy-dual.jsonc"),
            "{\"id\":\"agy-dual\",\"name\":\"Agy Dual\",\"description\":\"NÃ\u{00AD}vel 1\",\"orchestrator\":{\"providerInstanceId\":\"antigravity_2\",\"model\":\"gemini-4-hydrogen\",\"options\":{\"thinkingLevel\":\"high\"}}}",
        )
        .unwrap();

        // Simulate legacy hybrid-agy-codex with old non-OMOS roles (backend/frontend only)
        fs::write(
            presets_dir.join("hybrid-agy-codex.jsonc"),
            r#"{"id":"hybrid-agy-codex","name":"Hybrid","roles":{"backend":{"id":"backend","title":"Backend","providerInstanceId":"codex","model":"gpt-6.1-sol"}}}"#,
        )
        .unwrap();

        // Simulate a clean custom user edit on codex-squad (all OMOS roles, no thinkingLevel, no mojibake)
        let mut custom_codex = build_codex_squad_preset();
        custom_codex.name = "Codex Customizado".to_string();
        fs::write(
            presets_dir.join("codex-squad.jsonc"),
            serde_json::to_string_pretty(&custom_codex).unwrap(),
        )
        .unwrap();

        ensure_seed_presets(&presets_dir).unwrap();

        assert!(presets_dir.join("default.jsonc").exists());
        let config_path = config_root.join("config.jsonc");
        assert!(config_path.exists());
        let loaded_cfg = load_global_config(&config_path);
        assert_eq!(loaded_cfg.active_global_preset_id, "default");
        assert!(loaded_cfg.enabled);

        let listed = list_global_presets(&presets_dir).unwrap();
        assert_eq!(listed.len(), 4);
        assert_eq!(listed[0].id, "default");

        let upgraded_agy = resolve_global_preset(&presets_dir, "agy-dual").unwrap();
        assert_eq!(
            upgraded_agy.orchestrator.options.get("thinking_level").map(String::as_str),
            Some("high")
        );
        assert!(!upgraded_agy.orchestrator.options.contains_key("thinkingLevel"));
        assert!(!looks_like_mojibake(&upgraded_agy.description));
        for role_id in OMOS_CANONICAL_ROLES {
            assert!(upgraded_agy.roles.contains_key(role_id));
        }

        let upgraded_hybrid = resolve_global_preset(&presets_dir, "hybrid-agy-codex").unwrap();
        for role_id in OMOS_CANONICAL_ROLES {
            assert!(upgraded_hybrid.roles.contains_key(role_id));
        }

        let kept_codex = resolve_global_preset(&presets_dir, "codex-squad").unwrap();
        assert_eq!(kept_codex.name, "Codex Customizado");
    }

    #[test]
    fn global_config_defaults_and_roundtrips_atomically() {
        let dir = tempdir().unwrap();
        let cfg_path = dir.path().join("config.jsonc");

        let default_cfg = load_global_config(&cfg_path);
        assert_eq!(default_cfg.active_global_preset_id, "default");
        assert!(default_cfg.enabled);

        for preset_id in ["agy-dual", "codex-squad", "hybrid-agy-codex", "default"] {
            let updated = GlobalAppConfig {
                active_global_preset_id: preset_id.to_string(),
                enabled: preset_id != "codex-squad",
            };
            save_global_config(&cfg_path, &updated).unwrap();
            let reloaded = load_global_config(&cfg_path);
            assert_eq!(reloaded, updated);
        }
    }

    #[test]
    fn atomic_write_file_is_safe_under_concurrent_threads() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("concurrent.json");
        let thread_count = 16usize;
        let iterations = 25usize;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(thread_count));

        let mut handles = Vec::with_capacity(thread_count);
        for tid in 0..thread_count {
            let dir_path = dir.path().to_path_buf();
            let target_path = target.clone();
            let barrier = barrier.clone();
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                for iter in 0..iterations {
                    let payload = serde_json::json!({
                        "thread": tid,
                        "iter": iter,
                        "padding": "oh-my-t3code-atomic-write-check"
                    });
                    let bytes = serde_json::to_vec_pretty(&payload).unwrap();
                    atomic_write_file(&target_path, &bytes).unwrap_or_else(|e| {
                        panic!("thread {tid} iter {iter} atomic_write_file failed: {e}");
                    });

                    // Also exercise distinct targets inside the same parent directory
                    let per_thread_target = dir_path.join(format!("worker-{tid}.json"));
                    atomic_write_file(&per_thread_target, &bytes).unwrap_or_else(|e| {
                        panic!("thread {tid} iter {iter} per-thread write failed: {e}");
                    });
                }
            }));
        }

        for h in handles {
            h.join().expect("worker thread must not panic");
        }

        // Target file must be intact, valid JSON from one of the writers
        let final_raw = fs::read_to_string(&target).unwrap();
        let parsed: serde_json::Value =
            serde_json::from_str(&final_raw).expect("final target must be valid JSON");
        assert!(parsed.get("thread").and_then(|v| v.as_u64()).is_some());
        assert_eq!(
            parsed.get("padding").and_then(|v| v.as_str()),
            Some("oh-my-t3code-atomic-write-check")
        );

        // No residual .tmp.* files should remain in directory
        for entry in fs::read_dir(dir.path()).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().to_string();
            assert!(
                !name.contains(".tmp."),
                "residual temp file left behind: {name}"
            );
        }
    }
}
