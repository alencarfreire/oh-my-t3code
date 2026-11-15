use crate::models::{
    AppPaths, AppResult, DashboardSnapshot, GlobalAppConfig, PresetConfig, ProjectSummary,
    ProviderInstanceInfo, SkillMetadata, SubagentActivity, T3ModelOption, T3ModelSelection,
};
use crate::preset_engine::{
    detect_squad_dir, list_global_presets_unlocked, load_global_config_unlocked,
    local_preset_path, lock_config_state, resolve_jsonc_against_globals_unlocked,
    strip_jsonc_comments,
};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Default)]
pub struct ParsedSettings {
    pub available: bool,
    pub provider_instances: Vec<ProviderInstanceInfo>,
    pub default_model_selection: Option<T3ModelSelection>,
    pub fallback_model_selection: Option<T3ModelSelection>,
    pub project_overrides: HashMap<String, T3ModelSelection>,
}

fn known_models_for_driver(driver: &str) -> Vec<String> {
    match driver {
        "antigravity" => vec![
            "gemini-4-hydrogen".to_string(),
            "gemini-4-argon".to_string(),
        ],
        "codex" => vec![
            "gpt-6.1-sol".to_string(),
            "gpt-6.1-terra".to_string(),
            "gpt-6-astra".to_string(),
            "gpt-6-luna".to_string(),
        ],
        "claudeAgent" => vec![
            "claude-sonnet-4-5".to_string(),
            "claude-opus-4-1".to_string(),
        ],
        "grok" => vec!["grok-3".to_string()],
        "opencode" => vec!["opencode-default".to_string()],
        _ => Vec::new(),
    }
}

fn parse_model_selection(val: &Value) -> Option<T3ModelSelection> {
    let obj = val.as_object()?;
    let instance_id = obj
        .get("instanceId")
        .or_else(|| obj.get("providerInstanceId"))
        .and_then(|v| v.as_str())?
        .to_string();
    let model = obj.get("model").and_then(|v| v.as_str())?.to_string();

    let mut options = Vec::new();
    if let Some(opts) = obj.get("options") {
        if let Some(arr) = opts.as_array() {
            for item in arr {
                if let (Some(id), Some(value)) = (
                    item.get("id").and_then(|v| v.as_str()),
                    item.get("value"),
                ) {
                    options.push(T3ModelOption {
                        id: id.to_string(),
                        value: value.clone(),
                    });
                }
            }
        } else if let Some(map) = opts.as_object() {
            for (k, v) in map {
                options.push(T3ModelOption {
                    id: k.clone(),
                    value: v.clone(),
                });
            }
        }
    }

    Some(T3ModelSelection {
        instance_id,
        model,
        options,
    })
}

/// Reads `~/.t3/userdata/settings.json` strictly read-only.
pub fn read_t3_settings(settings_path: &Path) -> ParsedSettings {
    let raw = {
        let _guard = crate::settings_sync::lock_settings_file();
        fs::read_to_string(settings_path)
    };
    let Ok(raw) = raw else {
        return ParsedSettings {
            available: false,
            provider_instances: build_provider_instances(&BTreeMap::new()),
            ..Default::default()
        };
    };

    let Ok(root) = serde_json::from_str::<Value>(&raw) else {
        return ParsedSettings {
            available: false,
            provider_instances: build_provider_instances(&BTreeMap::new()),
            ..Default::default()
        };
    };

    let default_model_selection = root
        .get("defaultModelSelection")
        .and_then(parse_model_selection);
    let fallback_model_selection = root
        .get("fallbackModelSelection")
        .and_then(parse_model_selection);

    let mut project_overrides = HashMap::new();
    if let Some(overrides) = root
        .get("projectSettingsOverrides")
        .and_then(|v| v.as_object())
    {
        for (project_id, entry) in overrides {
            if let Some(sel) = entry
                .get("defaultModelSelection")
                .and_then(parse_model_selection)
            {
                project_overrides.insert(project_id.clone(), sel);
            }
        }
    }

    let mut raw_instances = BTreeMap::new();
    if let Some(instances) = root.get("providerInstances").and_then(|v| v.as_object()) {
        for (id, cfg) in instances {
            raw_instances.insert(id.clone(), cfg.clone());
        }
    }

    ParsedSettings {
        available: true,
        provider_instances: build_provider_instances(&raw_instances),
        default_model_selection,
        fallback_model_selection,
        project_overrides,
    }
}

fn build_provider_instances(raw_instances: &BTreeMap<String, Value>) -> Vec<ProviderInstanceInfo> {
    let builtins: [(&str, &str, &str); 6] = [
        ("codex", "Codex (Built-in)", "codex"),
        ("antigravity", "Agy Veca (antigravity)", "antigravity"),
        ("antigravity_2", "Agy Principal (antigravity_2)", "antigravity"),
        ("opencode", "OpenCode", "opencode"),
        ("grok", "Grok", "grok"),
        ("claudeAgent", "Claude Agent", "claudeAgent"),
    ];

    let mut result_map: BTreeMap<String, ProviderInstanceInfo> = BTreeMap::new();

    for (id, default_label, driver) in builtins {
        let cfg = raw_instances.get(id);
        let configured = cfg.is_some() || id == "codex";
        let enabled = cfg
            .and_then(|v| v.get("enabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(id == "codex");
        let label = cfg
            .and_then(|v| v.get("displayName"))
            .and_then(|v| v.as_str())
            .map(|name| format!("{name} ({id})"))
            .unwrap_or_else(|| default_label.to_string());

        result_map.insert(
            id.to_string(),
            ProviderInstanceInfo {
                id: id.to_string(),
                label,
                provider: driver.to_string(),
                is_builtin: true,
                configured,
                enabled,
                models: known_models_for_driver(driver),
            },
        );
    }

    for (id, cfg) in raw_instances {
        if result_map.contains_key(id) {
            continue;
        }
        let driver = cfg
            .get("driver")
            .and_then(|v| v.as_str())
            .unwrap_or(id.as_str())
            .to_string();
        let enabled = cfg
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let label = cfg
            .get("displayName")
            .and_then(|v| v.as_str())
            .map(|name| format!("{name} ({id})"))
            .unwrap_or_else(|| id.clone());

        result_map.insert(
            id.clone(),
            ProviderInstanceInfo {
                id: id.clone(),
                label,
                provider: driver.clone(),
                is_builtin: false,
                configured: true,
                enabled,
                models: known_models_for_driver(&driver),
            },
        );
    }

    result_map.into_values().collect()
}

/// Opens `~/.t3/userdata/statev2.sqlite` strictly read-only (`SQLITE_OPEN_READ_ONLY`).
pub fn open_sqlite_readonly(sqlite_path: &Path) -> AppResult<Connection> {
    let conn = Connection::open_with_flags(
        sqlite_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(Duration::from_millis(250))?;
    // Enforce read-only at the SQLite engine level in addition to OS/VFS flags.
    conn.pragma_update(None, "query_only", true)?;
    Ok(conn)
}

fn table_columns(conn: &Connection, table: &str) -> HashSet<String> {
    let mut cols = HashSet::new();
    let sql = format!("PRAGMA table_info({table})");
    if let Ok(mut stmt) = conn.prepare(&sql) {
        if let Ok(mut rows) = stmt.query([]) {
            while let Ok(Some(row)) = rows.next() {
                if let Ok(name) = row.get::<_, String>(1) {
                    cols.insert(name);
                }
            }
        }
    }
    cols
}

struct LocalPresetMeta {
    has_local_preset: bool,
    id: Option<String>,
    extends: Option<String>,
    enabled: bool,
    raw_jsonc: Option<String>,
}

fn read_local_preset_meta(workspace_root: &Path) -> LocalPresetMeta {
    let path = local_preset_path(workspace_root);
    if !path.exists() {
        return LocalPresetMeta {
            has_local_preset: false,
            id: None,
            extends: None,
            enabled: true,
            raw_jsonc: None,
        };
    }
    let Ok(raw) = fs::read_to_string(&path) else {
        return LocalPresetMeta {
            has_local_preset: true,
            id: None,
            extends: None,
            enabled: true,
            raw_jsonc: None,
        };
    };
    let clean = strip_jsonc_comments(&raw);
    let Ok(val) = serde_json::from_str::<Value>(&clean) else {
        return LocalPresetMeta {
            has_local_preset: true,
            id: None,
            extends: None,
            enabled: true,
            raw_jsonc: Some(raw),
        };
    };
    let id = val
        .get("id")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);
    let extends = val
        .get("extends")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);
    let enabled = val
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    LocalPresetMeta {
        has_local_preset: true,
        id,
        extends,
        enabled,
        raw_jsonc: Some(raw),
    }
}

fn normalize_selection_options(options: &[T3ModelOption]) -> BTreeMap<String, Value> {
    let mut map = BTreeMap::new();
    for opt in options {
        let key = if opt.id == "thinkingLevel" {
            "thinking_level".to_string()
        } else {
            opt.id.clone()
        };
        map.insert(key, opt.value.clone());
    }
    map
}

fn selections_differ(a: &T3ModelSelection, b: &T3ModelSelection) -> bool {
    a.instance_id != b.instance_id
        || a.model != b.model
        || normalize_selection_options(&a.options) != normalize_selection_options(&b.options)
}

fn preset_selection(preset: &PresetConfig) -> T3ModelSelection {
    let options = preset
        .orchestrator
        .options
        .iter()
        .map(|(k, v)| T3ModelOption {
            id: if k == "thinkingLevel" {
                "thinking_level".to_string()
            } else {
                k.clone()
            },
            value: Value::String(v.clone()),
        })
        .collect();
    T3ModelSelection {
        instance_id: preset.orchestrator.provider_instance_id.clone(),
        model: preset.orchestrator.model.clone(),
        options,
    }
}

pub struct GlobalOverrideContext<'a> {
    pub settings_overrides: &'a HashMap<String, T3ModelSelection>,
    pub global_config: &'a GlobalAppConfig,
    pub global_active_preset: Option<&'a PresetConfig>,
    pub global_default_selection: Option<&'a T3ModelSelection>,
    pub presets_dir: &'a Path,
}

fn compute_has_custom_override(
    project_id: &str,
    local_meta: &LocalPresetMeta,
    detected_squad: Option<&(String, String)>,
    ctx: &GlobalOverrideContext<'_>,
) -> bool {
    let active_global_id = ctx.global_config.active_global_preset_id.as_str();

    // 1. Check .t3code/preset.jsonc against the active global preset
    if local_meta.has_local_preset {
        if local_meta.id.as_deref() != Some(active_global_id) {
            return true;
        }
        if let Some(ext) = local_meta.extends.as_deref() {
            if ext != active_global_id {
                return true;
            }
        }
        if let (Some(raw), Some(global_preset)) =
            (local_meta.raw_jsonc.as_deref(), ctx.global_active_preset)
        {
            match resolve_jsonc_against_globals_unlocked(ctx.presets_dir, raw, active_global_id) {
                Ok(resolved_local) => {
                    if resolved_local.roles != global_preset.roles
                        || resolved_local.disabled_roles != global_preset.disabled_roles
                        || resolved_local.orchestrator != global_preset.orchestrator
                        || resolved_local.fallback_chain != global_preset.fallback_chain
                        || resolved_local.contention != global_preset.contention
                        || resolved_local.topology != global_preset.topology
                    {
                        return true;
                    }
                }
                Err(_) => return true,
            }
        } else if local_meta.raw_jsonc.is_none() {
            return true;
        }
    }

    // 2. Check .agents/skills/*-squad/SKILL.md configured specifically for this project
    if let Some((_, squad_dir)) = detected_squad {
        let skill_md_path = Path::new(squad_dir).join("SKILL.md");
        match fs::read_to_string(&skill_md_path) {
            Ok(content) => {
                let is_compiler_generated =
                    content.contains("— Playbook do Orquestrador (T3 Code)");
                if !is_compiler_generated {
                    return true;
                }
            }
            Err(_) => return true,
        }
    }

    // 3. Check projectSettingsOverrides[project_id] in settings.json against global selection
    if let Some(override_sel) = ctx.settings_overrides.get(project_id) {
        let fallback_global_sel = ctx.global_active_preset.map(preset_selection);
        let effective_global = ctx
            .global_default_selection
            .or(fallback_global_sel.as_ref());
        match effective_global {
            Some(global_sel) => {
                if selections_differ(override_sel, global_sel) {
                    return true;
                }
            }
            None => return true,
        }
    }

    false
}

fn extract_prompt_preview(raw: &str) -> String {
    let trimmed = raw.trim();
    let first_line = trimmed
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or(trimmed);
    let mut chars = first_line.chars();
    let preview: String = chars.by_ref().take(140).collect();
    if chars.next().is_some() {
        format!("{preview}...")
    } else {
        preview
    }
}

fn is_active_status(status: &str) -> bool {
    matches!(
        status.to_ascii_lowercase().as_str(),
        "running" | "pending" | "queued" | "waiting" | "in_progress"
    )
}

/// Reads projects, threads, and subagent rows from `statev2.sqlite` (read-only).
pub fn read_sqlite_state(
    sqlite_path: &Path,
    settings_overrides: &HashMap<String, T3ModelSelection>,
) -> AppResult<(Vec<ProjectSummary>, Vec<SubagentActivity>)> {
    let default_cfg = GlobalAppConfig::default();
    let ctx = GlobalOverrideContext {
        settings_overrides,
        global_config: &default_cfg,
        global_active_preset: None,
        global_default_selection: None,
        presets_dir: Path::new("."),
    };
    read_sqlite_state_with_context(sqlite_path, &ctx)
}

/// Reads projects, threads, and subagent rows from `statev2.sqlite` (read-only)
/// with global preset context to compute `preset_enabled` and `has_custom_override`.
pub fn read_sqlite_state_with_context(
    sqlite_path: &Path,
    ctx: &GlobalOverrideContext<'_>,
) -> AppResult<(Vec<ProjectSummary>, Vec<SubagentActivity>)> {
    let _guard = lock_config_state();
    read_sqlite_state_with_context_unlocked(sqlite_path, ctx)
}

pub(crate) fn read_sqlite_state_with_context_unlocked(
    sqlite_path: &Path,
    ctx: &GlobalOverrideContext<'_>,
) -> AppResult<(Vec<ProjectSummary>, Vec<SubagentActivity>)> {
    let conn = open_sqlite_readonly(sqlite_path)?;

    // 1. Read thread -> project mapping (for attributing subagents to projects)
    let thread_cols = table_columns(&conn, "projection_threads");
    let mut thread_to_project: HashMap<String, String> = HashMap::new();
    if !thread_cols.is_empty() {
        let deleted_filter = if thread_cols.contains("deleted_at") {
            "WHERE deleted_at IS NULL"
        } else {
            ""
        };
        let sql = format!("SELECT thread_id, project_id FROM projection_threads {deleted_filter}");
        if let Ok(mut stmt) = conn.prepare(&sql) {
            if let Ok(mut rows) = stmt.query([]) {
                while let Ok(Some(row)) = rows.next() {
                    if let (Ok(tid), Ok(pid)) = (row.get::<_, String>(0), row.get::<_, String>(1)) {
                        thread_to_project.insert(tid, pid);
                    }
                }
            }
        }
    }

    // 2. Read projects
    let proj_cols = table_columns(&conn, "projection_projects");
    let mut projects = Vec::new();
    let mut project_titles: HashMap<String, String> = HashMap::new();

    if !proj_cols.is_empty() {
        let default_model_expr = if proj_cols.contains("default_model") {
            "default_model"
        } else if proj_cols.contains("default_model_selection_json") {
            "default_model_selection_json"
        } else {
            "NULL"
        };
        let deleted_filter = if proj_cols.contains("deleted_at") {
            "WHERE deleted_at IS NULL"
        } else {
            ""
        };
        let sql = format!(
            "SELECT project_id, title, workspace_root, {default_model_expr}, updated_at \
             FROM projection_projects {deleted_filter} ORDER BY updated_at DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let project_id: String = row.get(0)?;
            let title: String = row.get(1)?;
            let workspace_root: String = row.get(2)?;
            let raw_default: Option<String> = row.get(3)?;
            let updated_at: String = row.get(4)?;

            let mut default_model = raw_default.clone();
            let mut active_instance_id = None;
            let mut active_model = None;

            if let Some(raw_json) = raw_default.as_deref() {
                if raw_json.trim_start().starts_with('{') {
                    if let Ok(val) = serde_json::from_str::<Value>(raw_json) {
                        if let Some(sel) = parse_model_selection(&val) {
                            default_model = Some(sel.model.clone());
                            active_instance_id = Some(sel.instance_id);
                            active_model = Some(sel.model);
                        }
                    }
                }
            }

            if let Some(override_sel) = ctx.settings_overrides.get(&project_id) {
                active_instance_id = Some(override_sel.instance_id.clone());
                active_model = Some(override_sel.model.clone());
            }

            let ws_path = Path::new(&workspace_root);
            let local_meta = read_local_preset_meta(ws_path);
            let detected_squad = detect_squad_dir(ws_path);
            let has_custom_override = compute_has_custom_override(
                &project_id,
                &local_meta,
                detected_squad.as_ref(),
                ctx,
            );

            project_titles.insert(project_id.clone(), title.clone());
            projects.push(ProjectSummary {
                project_id,
                title,
                workspace_root,
                default_model,
                active_instance_id,
                active_model,
                updated_at,
                has_local_preset: local_meta.has_local_preset,
                local_preset_id: local_meta.id,
                local_preset_extends: local_meta.extends,
                preset_enabled: local_meta.enabled,
                has_custom_override,
                detected_squad_slug: detected_squad.as_ref().map(|(s, _)| s.clone()),
                detected_squad_path: detected_squad.map(|(_, p)| p),
                active_subagent_count: 0,
            });
        }
    }

    // 3. Read subagents (supports both real T3 schema with payload_json + thread_id, and flat test fixture schema)
    let sub_cols = table_columns(&conn, "orchestration_v2_projection_subagents");
    let mut subagents = Vec::new();
    let mut active_counts: HashMap<String, usize> = HashMap::new();

    if !sub_cols.is_empty() {
        let parent_col = if sub_cols.contains("parent_thread_id") {
            "parent_thread_id"
        } else {
            "thread_id"
        };
        let role_expr = if sub_cols.contains("role") { "role" } else { "NULL" };
        let title_expr = if sub_cols.contains("title") { "title" } else { "NULL" };
        let prompt_expr = if sub_cols.contains("prompt") { "prompt" } else { "NULL" };
        let req_model_expr = if sub_cols.contains("requested_model") {
            "requested_model"
        } else {
            "NULL"
        };
        let res_model_expr = if sub_cols.contains("resolved_model") {
            "resolved_model"
        } else {
            "NULL"
        };
        let summary_expr = if sub_cols.contains("summary") { "summary" } else { "NULL" };
        let err_expr = if sub_cols.contains("error_message") {
            "error_message"
        } else {
            "NULL"
        };
        let created_expr = if sub_cols.contains("created_at") {
            "created_at"
        } else if sub_cols.contains("started_at") {
            "started_at"
        } else {
            "NULL"
        };
        let settled_expr = if sub_cols.contains("settled_at") {
            "settled_at"
        } else if sub_cols.contains("completed_at") {
            "completed_at"
        } else {
            "NULL"
        };
        let payload_expr = if sub_cols.contains("payload_json") {
            "payload_json"
        } else {
            "NULL"
        };

        let sql = format!(
            "SELECT subagent_id, {parent_col}, child_thread_id, {role_expr}, {title_expr}, \
             {prompt_expr}, provider_instance_id, {req_model_expr}, {res_model_expr}, status, \
             {summary_expr}, {err_expr}, {created_expr}, updated_at, {settled_expr}, {payload_expr} \
             FROM orchestration_v2_projection_subagents \
             ORDER BY updated_at DESC LIMIT 80"
        );

        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let subagent_id: String = row.get(0)?;
            let parent_thread_id: String = row.get(1)?;
            let child_thread_id: Option<String> = row.get(2)?;
            let mut role: Option<String> = row.get(3)?;
            let mut title: Option<String> = row.get(4)?;
            let mut prompt: Option<String> = row.get(5)?;
            let mut provider_instance_id: Option<String> = row.get(6)?;
            let mut requested_model: Option<String> = row.get(7)?;
            let mut resolved_model: Option<String> = row.get(8)?;
            let status: String = row.get(9)?;
            let mut summary: Option<String> = row.get(10)?;
            let mut error_message: Option<String> = row.get(11)?;
            let created_at: Option<String> = row.get(12)?;
            let updated_at: String = row.get(13)?;
            let settled_at: Option<String> = row.get(14)?;
            let payload_json: Option<String> = row.get(15)?;

            if let Some(raw_payload) = payload_json.as_deref() {
                if let Ok(payload) = serde_json::from_str::<Value>(raw_payload) {
                    if role.is_none() {
                        role = payload
                            .get("role")
                            .and_then(|v| v.as_str())
                            .map(ToString::to_string);
                    }
                    if title.is_none() {
                        title = payload
                            .get("title")
                            .and_then(|v| v.as_str())
                            .map(ToString::to_string);
                    }
                    if prompt.is_none() {
                        prompt = payload
                            .get("prompt")
                            .and_then(|v| v.as_str())
                            .map(ToString::to_string);
                    }
                    if provider_instance_id.is_none() {
                        provider_instance_id = payload
                            .get("providerInstanceId")
                            .and_then(|v| v.as_str())
                            .map(ToString::to_string);
                    }
                    if requested_model.is_none() {
                        requested_model = payload
                            .get("requestedModel")
                            .or_else(|| payload.get("model"))
                            .and_then(|v| v.as_str())
                            .map(ToString::to_string);
                    }
                    if resolved_model.is_none() {
                        resolved_model = payload
                            .get("resolvedModel")
                            .or_else(|| payload.get("model"))
                            .and_then(|v| v.as_str())
                            .map(ToString::to_string);
                    }
                    if summary.is_none() {
                        summary = payload
                            .get("summary")
                            .or_else(|| payload.get("result"))
                            .and_then(|v| v.as_str())
                            .map(extract_prompt_preview);
                    }
                    if error_message.is_none() {
                        error_message = payload
                            .get("errorMessage")
                            .or_else(|| payload.get("error"))
                            .and_then(|v| v.as_str())
                            .map(ToString::to_string);
                    }
                }
            }

            let project_id = thread_to_project.get(&parent_thread_id).cloned();
            let project_title = project_id
                .as_ref()
                .and_then(|pid| project_titles.get(pid).cloned());

            if is_active_status(&status) {
                if let Some(pid) = &project_id {
                    *active_counts.entry(pid.clone()).or_insert(0) += 1;
                }
            }

            let prompt_preview = prompt.as_deref().map(extract_prompt_preview);

            subagents.push(SubagentActivity {
                subagent_id,
                parent_thread_id,
                child_thread_id,
                project_id,
                project_title,
                role,
                title,
                prompt_preview,
                provider_instance_id,
                requested_model,
                resolved_model,
                status,
                summary,
                error_message,
                created_at,
                updated_at,
                settled_at,
            });
        }
    }

    for proj in &mut projects {
        proj.active_subagent_count = active_counts.get(&proj.project_id).copied().unwrap_or(0);
    }

    Ok((projects, subagents))
}

/// Parses YAML frontmatter `name` and `description` from a `SKILL.md` file.
pub fn parse_skill_frontmatter(raw: &str, fallback_id: &str) -> (String, String) {
    let normalized = raw.replace("\r\n", "\n");
    let Some(rest) = normalized.strip_prefix("---\n") else {
        return (fallback_id.to_string(), String::new());
    };
    let Some(end_idx) = rest.find("\n---") else {
        return (fallback_id.to_string(), String::new());
    };
    let fm = &rest[..end_idx];

    let mut name: Option<String> = None;
    let mut desc_lines: Vec<String> = Vec::new();
    let mut in_multiline_desc = false;

    for line in fm.lines() {
        let trimmed = line.trim();
        if in_multiline_desc {
            if line.starts_with(' ') || line.starts_with('\t') {
                if !trimmed.is_empty() {
                    desc_lines.push(trimmed.to_string());
                }
                continue;
            } else {
                in_multiline_desc = false;
            }
        }

        if let Some(val) = trimmed.strip_prefix("name:") {
            let clean = val.trim().trim_matches('"').trim_matches('\'').to_string();
            if !clean.is_empty() {
                name = Some(clean);
            }
        } else if let Some(val) = trimmed.strip_prefix("description:") {
            let v = val.trim();
            if v == ">-" || v == ">" || v == "|-" || v == "|" {
                in_multiline_desc = true;
            } else {
                let clean = v.trim_matches('"').trim_matches('\'').to_string();
                if !clean.is_empty() {
                    desc_lines.push(clean);
                }
            }
        }
    }

    (
        name.unwrap_or_else(|| fallback_id.to_string()),
        desc_lines.join(" "),
    )
}

/// Scans configured skill roots (`~/.config/skillshare/skills` and `~/.gemini/config/skills`).
pub fn scan_global_skills(skill_roots: &[(String, std::path::PathBuf)]) -> Vec<SkillMetadata> {
    let mut map: BTreeMap<String, SkillMetadata> = BTreeMap::new();

    for (source, root) in skill_roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let skill_md = path.join("SKILL.md");
            if !skill_md.exists() {
                continue;
            }
            let Some(id) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if map.contains_key(id) {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&skill_md) else {
                continue;
            };
            let (name, description) = parse_skill_frontmatter(&raw, id);
            map.insert(
                id.to_string(),
                SkillMetadata {
                    id: id.to_string(),
                    name,
                    description,
                    path: skill_md.display().to_string(),
                    source: source.clone(),
                },
            );
        }
    }

    map.into_values().collect()
}

/// Lists `(project_id, title, workspace_root)` from `statev2.sqlite` strictly read-only.
pub(crate) fn list_known_projects_readonly(
    sqlite_path: &Path,
) -> AppResult<Vec<(String, String, String)>> {
    if !sqlite_path.exists() {
        return Ok(Vec::new());
    }
    let conn = open_sqlite_readonly(sqlite_path)?;
    let proj_cols = table_columns(&conn, "projection_projects");
    if proj_cols.is_empty() {
        return Ok(Vec::new());
    }
    let deleted_filter = if proj_cols.contains("deleted_at") {
        "WHERE deleted_at IS NULL"
    } else {
        ""
    };
    let sql = format!(
        "SELECT project_id, title, workspace_root \
         FROM projection_projects {deleted_filter} \
         ORDER BY updated_at DESC, project_id ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([])?;
    let mut projects = Vec::new();
    while let Some(row) = rows.next()? {
        let project_id: String = row.get(0)?;
        let title: String = row.get(1)?;
        let workspace_root: String = row.get(2)?;
        projects.push((project_id, title, workspace_root));
    }
    Ok(projects)
}

/// Builds the full dashboard snapshot read-only.
pub fn build_dashboard_snapshot(paths: &AppPaths) -> AppResult<DashboardSnapshot> {
    let _guard = lock_config_state();
    build_dashboard_snapshot_unlocked(paths)
}

pub(crate) fn build_dashboard_snapshot_unlocked(paths: &AppPaths) -> AppResult<DashboardSnapshot> {
    let settings = read_t3_settings(&paths.settings_path());
    let global_presets = list_global_presets_unlocked(&paths.presets_dir)?;
    let global_config = load_global_config_unlocked(&paths.global_config_path());
    let global_active_preset = global_presets
        .iter()
        .find(|p| p.id == global_config.active_global_preset_id);
    let effective_global_selection = settings
        .default_model_selection
        .clone()
        .or_else(|| global_active_preset.map(preset_selection));

    let sqlite_path = paths.sqlite_path();

    let (sqlite_available, projects, subagents) = if sqlite_path.exists() {
        let ctx = GlobalOverrideContext {
            settings_overrides: &settings.project_overrides,
            global_config: &global_config,
            global_active_preset,
            global_default_selection: effective_global_selection.as_ref(),
            presets_dir: &paths.presets_dir,
        };
        let (projs, subs) = read_sqlite_state_with_context_unlocked(&sqlite_path, &ctx)?;
        (true, projs, subs)
    } else {
        (false, Vec::new(), Vec::new())
    };

    let skills = scan_global_skills(&paths.skill_roots);

    Ok(DashboardSnapshot {
        global_config,
        projects,
        subagents,
        provider_instances: settings.provider_instances,
        global_presets,
        skills,
        default_model_selection: settings.default_model_selection,
        fallback_model_selection: settings.fallback_model_selection,
        sqlite_available,
        settings_available: settings.available,
        last_global_swap_report: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn sqlite_readonly_reads_fixture_and_rejects_writes() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("statev2.sqlite");
        let ws_dir = dir.path().join("demo-repo");
        fs::create_dir_all(&ws_dir).unwrap();

        // Populate fixture database using a separate write connection that is closed before testing read-only
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "
                CREATE TABLE projection_projects (
                    project_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    workspace_root TEXT NOT NULL,
                    default_model TEXT,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
                CREATE TABLE projection_threads (
                    thread_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    model TEXT,
                    branch TEXT,
                    worktree_path TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    archived_at TEXT,
                    deleted_at TEXT
                );
                CREATE TABLE orchestration_v2_projection_subagents (
                    subagent_id TEXT PRIMARY KEY,
                    parent_thread_id TEXT NOT NULL,
                    child_thread_id TEXT,
                    role TEXT,
                    title TEXT,
                    prompt TEXT,
                    provider_instance_id TEXT,
                    requested_model TEXT,
                    resolved_model TEXT,
                    status TEXT NOT NULL,
                    summary TEXT,
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    settled_at TEXT
                );
                ",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO projection_projects VALUES ('p1', 'Demo Repo', ?1, 'gemini-4-hydrogen', '2026-11-15T00:00:00Z', NULL)",
                [ws_dir.to_str().unwrap()],
            )
            .unwrap();
            conn.execute_batch(
                "
                INSERT INTO projection_projects VALUES ('p2', 'Deleted Repo', '/tmp/deleted', 'gemini-4-hydrogen', '2026-11-15T00:00:00Z', '2026-11-15T00:01:00Z');
                INSERT INTO projection_threads VALUES ('t1', 'p1', 'Main thread', 'gemini-4-hydrogen', 'main', NULL, '2026-11-15T00:00:00Z', '2026-11-15T00:00:00Z', NULL, NULL);
                INSERT INTO orchestration_v2_projection_subagents VALUES (
                    'sub1', 't1', 'child1', 'backend', 'Implement API', 'Build endpoint',
                    'antigravity_2', 'gemini-4-hydrogen', 'gemini-4-hydrogen', 'running',
                    NULL, NULL, '2026-11-15T00:00:00Z', '2026-11-15T00:05:00Z', NULL
                );
                ",
            )
            .unwrap();
        }

        // Verify read_sqlite_state reads projects and subagents properly
        let (projects, subagents) = read_sqlite_state(&db_path, &HashMap::new()).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].project_id, "p1");
        assert_eq!(projects[0].active_subagent_count, 1);
        assert_eq!(subagents.len(), 1);
        assert_eq!(subagents[0].role.as_deref(), Some("backend"));
        assert_eq!(subagents[0].project_title.as_deref(), Some("Demo Repo"));

        // Verify open_sqlite_readonly rejects any write operation
        let ro_conn = open_sqlite_readonly(&db_path).unwrap();
        let insert_err = ro_conn
            .execute(
                "INSERT INTO projection_projects VALUES ('p3', 'Evil', '/tmp', NULL, 'now', NULL)",
                [],
            )
            .unwrap_err();
        let msg = insert_err.to_string().to_lowercase();
        assert!(msg.contains("read-only") || msg.contains("readonly"));
    }

    #[test]
    fn sqlite_readonly_reads_real_t3_payload_json_schema() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("statev2.sqlite");
        let ws_dir = dir.path().join("real-repo");
        fs::create_dir_all(&ws_dir).unwrap();

        {
            let conn = Connection::open(&db_path).unwrap();
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
            .unwrap();
            conn.execute(
                "INSERT INTO projection_projects VALUES ('p1', 'Real Repo', ?1, '{\"instanceId\":\"antigravity_2\",\"model\":\"gemini-4-hydrogen\"}', '2026-11-15T00:00:00Z', NULL)",
                [ws_dir.to_str().unwrap()],
            )
            .unwrap();
            conn.execute_batch(
                "
                INSERT INTO projection_threads VALUES ('t1', 'p1', 'Thread 1', '2026-11-15T00:00:00Z', '2026-11-15T00:00:00Z', NULL);
                INSERT INTO orchestration_v2_projection_subagents VALUES (
                    'sub1', 't1', 'child1', 'antigravity_2', 'antigravity_2', 'completed',
                    '2026-11-15T00:00:00Z', '2026-11-15T00:01:00Z', '2026-11-15T00:01:00Z',
                    '{\"title\":\"Build core\",\"model\":\"gemini-4-hydrogen\",\"prompt\":\"Do work\",\"result\":\"All done\"}'
                );
                ",
            )
            .unwrap();
        }

        let (projects, subagents) = read_sqlite_state(&db_path, &HashMap::new()).unwrap();
        assert_eq!(projects[0].active_instance_id.as_deref(), Some("antigravity_2"));
        assert_eq!(projects[0].active_model.as_deref(), Some("gemini-4-hydrogen"));
        assert_eq!(subagents[0].title.as_deref(), Some("Build core"));
        assert_eq!(subagents[0].resolved_model.as_deref(), Some("gemini-4-hydrogen"));
        assert_eq!(subagents[0].summary.as_deref(), Some("All done"));
    }

    #[test]
    fn scans_skills_and_reads_t3_settings() {
        let dir = tempdir().unwrap();
        let skills_dir = dir.path().join("skills").join("rust-skill");
        fs::create_dir_all(&skills_dir).unwrap();
        fs::write(
            skills_dir.join("SKILL.md"),
            "---\nname: rust-skill\ndescription: >-\n  Rust best practices\n  and patterns.\n---\n# Body\n",
        )
        .unwrap();

        let skills = scan_global_skills(&[("skillshare".into(), dir.path().join("skills"))]);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "rust-skill");
        assert_eq!(skills[0].description, "Rust best practices and patterns.");

        let settings_path = dir.path().join("settings.json");
        fs::write(
            &settings_path,
            r#"{
                "providerInstances": {
                    "antigravity": {"driver":"antigravity","displayName":"Agy Veca","enabled":true},
                    "antigravity_2": {"driver":"antigravity","displayName":"Agy Principal","enabled":true}
                },
                "defaultModelSelection": {"instanceId":"antigravity_2","model":"gemini-4-hydrogen"}
            }"#,
        )
        .unwrap();
        let parsed = read_t3_settings(&settings_path);
        assert!(parsed.available);
        assert_eq!(
            parsed.default_model_selection.unwrap().instance_id,
            "antigravity_2"
        );
        assert!(parsed
            .provider_instances
            .iter()
            .any(|p| p.id == "antigravity" && p.label == "Agy Veca (antigravity)"));
    }
}
