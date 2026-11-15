use crate::models::{
    effective_orchestrator_options, AppError, AppPaths, AppResult, DashboardSnapshot,
    GlobalAppConfig, GlobalSessionHealth, ParentThreadHealth, PresetConfig, ProjectSessionHealth,
    ProjectSummary, ProviderInstanceInfo, SessionPolicy, SkillMetadata, SubagentActivity,
    T3ModelOption, T3ModelSelection,
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
    let mut last_err = None;
    for attempt in 0..4 {
        match (|| -> Result<Connection, rusqlite::Error> {
            let conn = Connection::open_with_flags(
                sqlite_path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )?;
            conn.busy_timeout(Duration::from_millis(250))?;
            // Enforce read-only at the SQLite engine level in addition to OS/VFS flags.
            conn.pragma_update(None, "query_only", true)?;
            Ok(conn)
        })() {
            Ok(conn) => return Ok(conn),
            Err(err) => {
                let is_busy_or_locked = matches!(
                    err,
                    rusqlite::Error::SqliteFailure(ref f, _)
                        if matches!(
                            f.code,
                            rusqlite::ErrorCode::DatabaseBusy
                                | rusqlite::ErrorCode::DatabaseLocked
                        )
                );
                if is_busy_or_locked && attempt < 3 {
                    last_err = Some(err);
                    std::thread::sleep(Duration::from_millis(50));
                    continue;
                }
                return Err(AppError::Sqlite(err));
            }
        }
    }
    Err(AppError::Sqlite(
        last_err.expect("retry loop always captures last error"),
    ))
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
    let options = effective_orchestrator_options(preset)
        .into_iter()
        .map(|(k, v)| T3ModelOption {
            id: k,
            value: Value::String(v),
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
                        || resolved_local.session_policy != global_preset.session_policy
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

fn is_failed_status(status: &str) -> bool {
    matches!(
        status.to_ascii_lowercase().as_str(),
        "failed" | "error" | "errored"
    )
}

fn is_antigravity_worker(provider_instance_id: Option<&str>, model: Option<&str>) -> bool {
    let by_provider = provider_instance_id
        .map(|p| p.trim().to_ascii_lowercase().starts_with("antigravity"))
        .unwrap_or(false);
    let by_model = model
        .map(|m| m.trim().to_ascii_lowercase().starts_with("gemini-4-"))
        .unwrap_or(false);
    by_provider || by_model
}

/// Pure-Rust ISO-8601 / RFC3339 timestamp parser returning Unix epoch milliseconds.
pub(crate) fn parse_iso8601_to_epoch_ms(input: &str) -> Option<i64> {
    let s = input.trim();
    let bytes = s.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    if bytes[4] != b'-'
        || bytes[7] != b'-'
        || !matches!(bytes[10], b'T' | b't' | b' ')
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }

    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: i64 = s.get(5..7)?.parse().ok()?;
    let day: i64 = s.get(8..10)?.parse().ok()?;
    let hour: i64 = s.get(11..13)?.parse().ok()?;
    let minute: i64 = s.get(14..16)?.parse().ok()?;
    let second: i64 = s.get(17..19)?.parse().ok()?;

    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=60).contains(&second)
    {
        return None;
    }

    let mut rest = &s[19..];
    let mut millis: i64 = 0;
    if let Some(after_dot) = rest.strip_prefix('.') {
        let frac_len = after_dot
            .bytes()
            .take_while(|b| b.is_ascii_digit())
            .count();
        let frac_str = &after_dot[..frac_len];
        if !frac_str.is_empty() {
            let mut digits = frac_str.chars().take(3).collect::<String>();
            while digits.len() < 3 {
                digits.push('0');
            }
            millis = digits.parse().ok()?;
        }
        rest = &after_dot[frac_len..];
    }

    let tz_offset_secs: i64 = if rest.is_empty() || rest.eq_ignore_ascii_case("z") {
        0
    } else {
        let tz_rest = rest.strip_prefix('+').or_else(|| rest.strip_prefix('-'))?;
        let sign = if rest.starts_with('-') { -1 } else { 1 };
        let clean = tz_rest.replace(':', "");
        let (tz_h, tz_m): (i64, i64) = if clean.len() == 4 {
            (clean[0..2].parse().ok()?, clean[2..4].parse().ok()?)
        } else if clean.len() == 2 {
            (clean[0..2].parse().ok()?, 0)
        } else {
            return None;
        };
        if tz_h > 23 || tz_m > 59 {
            return None;
        }
        sign * (tz_h * 3600 + tz_m * 60)
    };

    // Howard Hinnant's days_from_civil
    let y = year - if month <= 2 { 1 } else { 0 };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;

    let total_secs = days * 86_400 + hour * 3600 + minute * 60 + second - tz_offset_secs;
    Some(total_secs * 1000 + millis)
}

#[derive(Debug, Clone)]
struct ThreadMeta {
    thread_id: String,
    project_id: String,
    title: String,
    updated_at: String,
    archived: bool,
}

#[derive(Debug, Clone)]
struct RunHealthRecord {
    status: String,
    error_message: Option<String>,
    started_at: Option<String>,
    ended_at: Option<String>,
    updated_at: String,
    seq: usize,
}

fn run_indicates_acp_dead(run: &RunHealthRecord) -> bool {
    if !is_failed_status(&run.status) {
        return false;
    }
    let has_acp_error = run
        .error_message
        .as_deref()
        .map(|e| e.to_ascii_lowercase().contains("acprequesterror"))
        .unwrap_or(false);
    if has_acp_error {
        return true;
    }
    if let (Some(start), Some(end)) = (run.started_at.as_deref(), run.ended_at.as_deref()) {
        if let (Some(start_ms), Some(end_ms)) = (
            parse_iso8601_to_epoch_ms(start),
            parse_iso8601_to_epoch_ms(end),
        ) {
            let duration = end_ms - start_ms;
            if (0..1000).contains(&duration) {
                return true;
            }
        }
    }
    false
}

fn resolve_project_session_policy(
    local_meta: &LocalPresetMeta,
    ctx: &GlobalOverrideContext<'_>,
) -> SessionPolicy {
    if local_meta.has_local_preset {
        if let Some(raw) = local_meta.raw_jsonc.as_deref() {
            let active_global_id = ctx.global_config.active_global_preset_id.as_str();
            if let Ok(resolved) =
                resolve_jsonc_against_globals_unlocked(ctx.presets_dir, raw, active_global_id)
            {
                return resolved.session_policy;
            }
        }
    }
    ctx.global_active_preset
        .map(|p| p.session_policy.clone())
        .unwrap_or_default()
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

fn read_thread_table_into(
    conn: &Connection,
    table: &str,
    thread_to_project: &mut HashMap<String, String>,
    thread_metas: &mut HashMap<String, ThreadMeta>,
) {
    let thread_cols = table_columns(conn, table);
    if thread_cols.is_empty()
        || !thread_cols.contains("thread_id")
        || !thread_cols.contains("project_id")
    {
        return;
    }
    let title_expr = if thread_cols.contains("title") {
        "title"
    } else {
        "thread_id"
    };
    let updated_expr = if thread_cols.contains("updated_at") {
        "updated_at"
    } else if thread_cols.contains("created_at") {
        "created_at"
    } else {
        "''"
    };
    let archived_expr = if thread_cols.contains("archived_at") {
        "archived_at"
    } else {
        "NULL"
    };
    let deleted_filter = if thread_cols.contains("deleted_at") {
        "WHERE deleted_at IS NULL"
    } else {
        ""
    };
    let sql = format!(
        "SELECT thread_id, project_id, COALESCE({title_expr}, thread_id), COALESCE({updated_expr}, ''), {archived_expr} \
         FROM {table} {deleted_filter}"
    );
    if let Ok(mut stmt) = conn.prepare(&sql) {
        if let Ok(mut rows) = stmt.query([]) {
            while let Ok(Some(row)) = rows.next() {
                if let (Ok(tid), Ok(pid)) = (row.get::<_, String>(0), row.get::<_, String>(1)) {
                    let title: String = row.get(2).unwrap_or_else(|_| tid.clone());
                    let updated_at: String = row.get(3).unwrap_or_default();
                    let archived_at: Option<String> = row.get(4).ok().flatten();
                    let archived = archived_at
                        .as_deref()
                        .map(|s| !s.trim().is_empty())
                        .unwrap_or(false);
                    thread_to_project.insert(tid.clone(), pid.clone());
                    thread_metas.insert(
                        tid.clone(),
                        ThreadMeta {
                            thread_id: tid,
                            project_id: pid,
                            title,
                            updated_at,
                            archived,
                        },
                    );
                }
            }
        }
    }
}

pub(crate) fn read_sqlite_state_with_context_unlocked(
    sqlite_path: &Path,
    ctx: &GlobalOverrideContext<'_>,
) -> AppResult<(Vec<ProjectSummary>, Vec<SubagentActivity>)> {
    let conn = open_sqlite_readonly(sqlite_path)?;

    // 1. Read thread -> project mapping & thread metadata (preferring orchestration_v2_projection_threads over projection_threads)
    let mut thread_to_project: HashMap<String, String> = HashMap::new();
    let mut thread_metas: HashMap<String, ThreadMeta> = HashMap::new();
    read_thread_table_into(
        &conn,
        "projection_threads",
        &mut thread_to_project,
        &mut thread_metas,
    );
    read_thread_table_into(
        &conn,
        "orchestration_v2_projection_threads",
        &mut thread_to_project,
        &mut thread_metas,
    );

    // 2. Read projects
    let proj_cols = table_columns(&conn, "projection_projects");
    let mut projects = Vec::new();
    let mut project_titles: HashMap<String, String> = HashMap::new();
    let mut project_policies: HashMap<String, SessionPolicy> = HashMap::new();

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
            let eff_policy = resolve_project_session_policy(&local_meta, ctx);

            project_titles.insert(project_id.clone(), title.clone());
            project_policies.insert(project_id.clone(), eff_policy.clone());
            projects.push(ProjectSummary {
                project_id: project_id.clone(),
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
                session_health: ProjectSessionHealth {
                    project_id,
                    max_concurrent_antigravity_workers: eff_policy
                        .max_concurrent_antigravity_workers,
                    max_concurrent_workers_total: eff_policy.max_concurrent_workers_total,
                    ..Default::default()
                },
            });
        }
    }

    // 3. Read subagents (supports both real T3 schema with payload_json + thread_id, and flat test fixture schema)
    let sub_cols = table_columns(&conn, "orchestration_v2_projection_subagents");
    let mut subagents = Vec::new();
    let mut active_counts: HashMap<String, usize> = HashMap::new();
    let mut active_workers: HashMap<String, (Option<String>, bool)> = HashMap::new();
    let mut parents_with_active_subagents: HashSet<String> = HashSet::new();
    let mut subagent_child_threads: HashSet<String> = HashSet::new();

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
            if let (Some(cid), Some(pid)) = (child_thread_id.as_deref(), project_id.as_ref()) {
                subagent_child_threads.insert(cid.to_string());
                thread_to_project
                    .entry(cid.to_string())
                    .or_insert_with(|| pid.clone());
            } else if let Some(cid) = child_thread_id.as_deref() {
                subagent_child_threads.insert(cid.to_string());
            }

            let project_title = project_id
                .as_ref()
                .and_then(|pid| project_titles.get(pid).cloned());

            if is_active_status(&status) {
                parents_with_active_subagents.insert(parent_thread_id.clone());
                if let Some(pid) = &project_id {
                    *active_counts.entry(pid.clone()).or_insert(0) += 1;
                }
                let worker_key = if let Some(cid) = child_thread_id.as_deref() {
                    format!("thread:{cid}")
                } else {
                    format!("subagent:{subagent_id}")
                };
                let is_agy = is_antigravity_worker(
                    provider_instance_id.as_deref(),
                    resolved_model.as_deref().or(requested_model.as_deref()),
                );
                active_workers
                    .entry(worker_key)
                    .or_insert((project_id.clone(), is_agy));
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

    // 4. Read orchestration_v2_projection_runs for turn count, acp_dead detection, and active worker dedup
    let run_cols = table_columns(&conn, "orchestration_v2_projection_runs");
    let mut run_counts_by_thread: HashMap<String, u32> = HashMap::new();
    let mut latest_run_by_thread: HashMap<String, RunHealthRecord> = HashMap::new();

    if !run_cols.is_empty() && run_cols.contains("thread_id") {
        let status_expr = if run_cols.contains("status") {
            "status"
        } else {
            "'unknown'"
        };
        let provider_expr = if run_cols.contains("provider_instance_id") {
            "provider_instance_id"
        } else if run_cols.contains("provider") {
            "provider"
        } else {
            "NULL"
        };
        let model_expr = if run_cols.contains("model") {
            "model"
        } else if run_cols.contains("resolved_model") {
            "resolved_model"
        } else if run_cols.contains("requested_model") {
            "requested_model"
        } else {
            "NULL"
        };
        let err_expr = if run_cols.contains("error_message") {
            "error_message"
        } else if run_cols.contains("error") {
            "error"
        } else {
            "NULL"
        };
        let started_expr = if run_cols.contains("started_at") {
            "started_at"
        } else if run_cols.contains("created_at") {
            "created_at"
        } else {
            "NULL"
        };
        let ended_expr = if run_cols.contains("completed_at") {
            "completed_at"
        } else if run_cols.contains("settled_at") {
            "settled_at"
        } else if run_cols.contains("updated_at") {
            "updated_at"
        } else {
            "NULL"
        };
        let updated_expr = if run_cols.contains("updated_at") {
            "updated_at"
        } else if run_cols.contains("created_at") {
            "created_at"
        } else if run_cols.contains("started_at") {
            "started_at"
        } else {
            "''"
        };
        let payload_expr = if run_cols.contains("payload_json") {
            "payload_json"
        } else {
            "NULL"
        };

        let sql = format!(
            "SELECT thread_id, COALESCE({status_expr}, 'unknown'), {provider_expr}, {model_expr}, \
             {err_expr}, {started_expr}, {ended_expr}, COALESCE({updated_expr}, ''), {payload_expr} \
             FROM orchestration_v2_projection_runs ORDER BY rowid ASC"
        );
        if let Ok(mut stmt) = conn.prepare(&sql) {
            if let Ok(mut rows) = stmt.query([]) {
                let mut seq = 0usize;
                while let Ok(Some(row)) = rows.next() {
                    let Ok(thread_id) = row.get::<_, String>(0) else {
                        continue;
                    };
                    let status: String = row.get(1).unwrap_or_else(|_| "unknown".to_string());
                    let mut provider_instance_id: Option<String> = row.get(2).ok().flatten();
                    let mut model: Option<String> = row.get(3).ok().flatten();
                    let mut error_message: Option<String> = row.get(4).ok().flatten();
                    let mut started_at: Option<String> = row.get(5).ok().flatten();
                    let mut ended_at: Option<String> = row.get(6).ok().flatten();
                    let updated_at: String = row.get(7).unwrap_or_default();
                    let payload_json: Option<String> = row.get(8).ok().flatten();

                    if let Some(raw_payload) = payload_json.as_deref() {
                        if let Ok(payload) = serde_json::from_str::<Value>(raw_payload) {
                            if provider_instance_id.is_none() {
                                provider_instance_id = payload
                                    .get("providerInstanceId")
                                    .and_then(|v| v.as_str())
                                    .map(ToString::to_string);
                            }
                            if model.is_none() {
                                model = payload
                                    .get("resolvedModel")
                                    .or_else(|| payload.get("requestedModel"))
                                    .or_else(|| payload.get("model"))
                                    .and_then(|v| v.as_str())
                                    .map(ToString::to_string);
                            }
                            if error_message.is_none() {
                                error_message = payload
                                    .get("errorMessage")
                                    .or_else(|| payload.get("error"))
                                    .and_then(|v| v.as_str())
                                    .map(ToString::to_string);
                            }
                            if started_at.is_none() {
                                started_at = payload
                                    .get("startedAt")
                                    .and_then(|v| v.as_str())
                                    .map(ToString::to_string);
                            }
                            if ended_at.is_none() {
                                ended_at = payload
                                    .get("completedAt")
                                    .or_else(|| payload.get("settledAt"))
                                    .and_then(|v| v.as_str())
                                    .map(ToString::to_string);
                            }
                        }
                    }

                    *run_counts_by_thread.entry(thread_id.clone()).or_insert(0) += 1;

                    if is_active_status(&status)
                        && !parents_with_active_subagents.contains(&thread_id)
                    {
                        let worker_key = format!("thread:{thread_id}");
                        let pid = thread_to_project.get(&thread_id).cloned();
                        let is_agy = is_antigravity_worker(
                            provider_instance_id.as_deref(),
                            model.as_deref(),
                        );
                        active_workers.entry(worker_key).or_insert((pid, is_agy));
                    }

                    let rec = RunHealthRecord {
                        status,
                        error_message,
                        started_at,
                        ended_at,
                        updated_at,
                        seq,
                    };
                    seq += 1;

                    let replace = match latest_run_by_thread.get(&thread_id) {
                        None => true,
                        Some(existing) => {
                            let new_ts = parse_iso8601_to_epoch_ms(&rec.updated_at)
                                .or_else(|| rec.ended_at.as_deref().and_then(parse_iso8601_to_epoch_ms))
                                .or_else(|| rec.started_at.as_deref().and_then(parse_iso8601_to_epoch_ms));
                            let old_ts = parse_iso8601_to_epoch_ms(&existing.updated_at)
                                .or_else(|| existing.ended_at.as_deref().and_then(parse_iso8601_to_epoch_ms))
                                .or_else(|| existing.started_at.as_deref().and_then(parse_iso8601_to_epoch_ms));
                            match (new_ts, old_ts) {
                                (Some(n), Some(o)) if n != o => n > o,
                                _ => {
                                    (rec.updated_at.as_str(), rec.seq)
                                        >= (existing.updated_at.as_str(), existing.seq)
                                }
                            }
                        }
                    };
                    if replace {
                        latest_run_by_thread.insert(thread_id, rec);
                    }
                }
            }
        }
    }

    // 5. Read orchestration_v2_projection_turn_items for item counts per thread
    let item_cols = table_columns(&conn, "orchestration_v2_projection_turn_items");
    let mut item_counts_by_thread: HashMap<String, u32> = HashMap::new();
    if !item_cols.is_empty() && item_cols.contains("thread_id") {
        let deleted_filter = if item_cols.contains("deleted_at") {
            "WHERE deleted_at IS NULL"
        } else {
            ""
        };
        let sql = format!(
            "SELECT thread_id, COUNT(*) FROM orchestration_v2_projection_turn_items {deleted_filter} GROUP BY thread_id"
        );
        if let Ok(mut stmt) = conn.prepare(&sql) {
            if let Ok(mut rows) = stmt.query([]) {
                while let Ok(Some(row)) = rows.next() {
                    if let (Ok(tid), Ok(cnt)) = (row.get::<_, String>(0), row.get::<_, i64>(1)) {
                        item_counts_by_thread.insert(tid, cnt.max(0) as u32);
                    }
                }
            }
        }
    }

    // 6. Aggregate active workers and thread health per project
    let mut active_agy_by_project: HashMap<String, u32> = HashMap::new();
    let mut active_total_by_project: HashMap<String, u32> = HashMap::new();
    for (pid_opt, is_agy) in active_workers.values() {
        if let Some(pid) = pid_opt {
            *active_total_by_project.entry(pid.clone()).or_insert(0) += 1;
            if *is_agy {
                *active_agy_by_project.entry(pid.clone()).or_insert(0) += 1;
            }
        }
    }

    let mut fat_threads_by_project: HashMap<String, Vec<ParentThreadHealth>> = HashMap::new();
    let mut dead_threads_by_project: HashMap<String, Vec<ParentThreadHealth>> = HashMap::new();
    for (tid, meta) in &thread_metas {
        if meta.archived || subagent_child_threads.contains(tid) {
            continue;
        }
        let Some(policy) = project_policies.get(&meta.project_id) else {
            continue;
        };
        let run_count = run_counts_by_thread.get(tid).copied().unwrap_or(0);
        let item_count = item_counts_by_thread.get(tid).copied().unwrap_or(0);
        let is_fat = run_count >= policy.parent_max_turns_before_handoff
            || item_count >= policy.parent_max_items_before_handoff;

        let latest_run = latest_run_by_thread.get(tid);
        let is_acp_dead = latest_run.map(run_indicates_acp_dead).unwrap_or(false);
        let last_error = latest_run.and_then(|r| r.error_message.clone());

        if is_acp_dead {
            dead_threads_by_project
                .entry(meta.project_id.clone())
                .or_default()
                .push(ParentThreadHealth {
                    thread_id: meta.thread_id.clone(),
                    project_id: meta.project_id.clone(),
                    title: meta.title.clone(),
                    run_count,
                    item_count,
                    status: "acp_dead".to_string(),
                    last_error,
                    updated_at: meta.updated_at.clone(),
                });
        } else if is_fat {
            fat_threads_by_project
                .entry(meta.project_id.clone())
                .or_default()
                .push(ParentThreadHealth {
                    thread_id: meta.thread_id.clone(),
                    project_id: meta.project_id.clone(),
                    title: meta.title.clone(),
                    run_count,
                    item_count,
                    status: "fat_parent".to_string(),
                    last_error,
                    updated_at: meta.updated_at.clone(),
                });
        }
    }

    for proj in &mut projects {
        proj.active_subagent_count = active_counts.get(&proj.project_id).copied().unwrap_or(0);

        let policy = project_policies
            .get(&proj.project_id)
            .cloned()
            .unwrap_or_default();
        let active_agy = active_agy_by_project
            .get(&proj.project_id)
            .copied()
            .unwrap_or(0);
        let active_total = active_total_by_project
            .get(&proj.project_id)
            .copied()
            .unwrap_or(0);
        let ram_warning = policy.hardware_profile == "laptop-8gb" && active_agy > 2;
        let over_concurrency = active_agy > policy.max_concurrent_antigravity_workers
            || active_total > policy.max_concurrent_workers_total
            || ram_warning;

        let mut fat_threads = fat_threads_by_project
            .remove(&proj.project_id)
            .unwrap_or_default();
        fat_threads.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.thread_id.cmp(&b.thread_id)));

        let mut dead_threads = dead_threads_by_project
            .remove(&proj.project_id)
            .unwrap_or_default();
        dead_threads.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.thread_id.cmp(&b.thread_id)));

        let status = if !dead_threads.is_empty() {
            "acp_dead".to_string()
        } else if over_concurrency {
            "over_concurrency".to_string()
        } else if !fat_threads.is_empty() {
            "fat_parent".to_string()
        } else {
            "ok".to_string()
        };

        let advisory = match status.as_str() {
            "acp_dead" => Some(format!(
                "{} thread(s) com sessão ACP morta detectada — abra uma nova thread ({}) em vez de continuar na mesma.",
                dead_threads.len(),
                policy.on_acp_session_dead
            )),
            "over_concurrency" => Some(format!(
                "Concorrência acima do limite ({active_agy}/{} Antigravity, {active_total}/{} total){}.",
                policy.max_concurrent_antigravity_workers,
                policy.max_concurrent_workers_total,
                if ram_warning { " [alerta de RAM em laptop-8gb]" } else { "" }
            )),
            "fat_parent" => Some(format!(
                "{} thread(s) pai atingiram o limiar de handoff ({} turns ou {} itens).",
                fat_threads.len(),
                policy.parent_max_turns_before_handoff,
                policy.parent_max_items_before_handoff
            )),
            _ => None,
        };

        proj.session_health = ProjectSessionHealth {
            project_id: proj.project_id.clone(),
            status,
            active_antigravity_workers: active_agy,
            active_workers_total: active_total,
            max_concurrent_antigravity_workers: policy.max_concurrent_antigravity_workers,
            max_concurrent_workers_total: policy.max_concurrent_workers_total,
            ram_warning,
            fat_parent_threads: fat_threads,
            dead_acp_threads: dead_threads,
            advisory,
        };
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

fn compute_global_session_health(
    projects: &[ProjectSummary],
    subagents: &[SubagentActivity],
    global_active_preset: Option<&PresetConfig>,
) -> GlobalSessionHealth {
    let policy = global_active_preset
        .map(|p| p.session_policy.clone())
        .unwrap_or_default();

    let mut active_agy: u32 = projects
        .iter()
        .map(|p| p.session_health.active_antigravity_workers)
        .sum();
    let mut active_total: u32 = projects
        .iter()
        .map(|p| p.session_health.active_workers_total)
        .sum();

    // Include any active subagents whose parent thread could not be mapped to a project
    let mut unattributed_seen: HashSet<String> = HashSet::new();
    for sub in subagents {
        if sub.project_id.is_none() && is_active_status(&sub.status) {
            let key = if let Some(cid) = sub.child_thread_id.as_deref() {
                format!("thread:{cid}")
            } else {
                format!("subagent:{}", sub.subagent_id)
            };
            if unattributed_seen.insert(key) {
                active_total += 1;
                if is_antigravity_worker(
                    sub.provider_instance_id.as_deref(),
                    sub.resolved_model
                        .as_deref()
                        .or(sub.requested_model.as_deref()),
                ) {
                    active_agy += 1;
                }
            }
        }
    }

    let ram_warning = (policy.hardware_profile == "laptop-8gb" && active_agy > 2)
        || projects.iter().any(|p| p.session_health.ram_warning);
    let over_concurrency = active_agy > policy.max_concurrent_antigravity_workers
        || active_total > policy.max_concurrent_workers_total
        || ram_warning
        || projects
            .iter()
            .any(|p| p.session_health.status == "over_concurrency");

    let has_acp_dead = projects
        .iter()
        .any(|p| p.session_health.status == "acp_dead");
    let has_fat_parent = projects
        .iter()
        .any(|p| p.session_health.status == "fat_parent");

    let status = if has_acp_dead {
        "acp_dead".to_string()
    } else if over_concurrency {
        "over_concurrency".to_string()
    } else if has_fat_parent {
        "fat_parent".to_string()
    } else {
        "ok".to_string()
    };

    let affected_projects: Vec<String> = projects
        .iter()
        .filter(|p| p.session_health.status != "ok")
        .map(|p| p.project_id.clone())
        .collect();

    let advisory = match status.as_str() {
        "acp_dead" => Some(format!(
            "Sessão ACP morta detectada em {} projeto(s). Abra uma nova thread ({}).",
            affected_projects.len().max(1),
            policy.on_acp_session_dead
        )),
        "over_concurrency" => Some(format!(
            "Concorrência global acima do perfil ({active_agy}/{} Antigravity, {active_total}/{} total){}.",
            policy.max_concurrent_antigravity_workers,
            policy.max_concurrent_workers_total,
            if ram_warning { " [alerta de RAM em laptop-8gb]" } else { "" }
        )),
        "fat_parent" => Some(format!(
            "Thread pai extensa detectada em {} projeto(s). Recomenda-se handoff via ai-memory.",
            affected_projects.len().max(1)
        )),
        _ => None,
    };

    GlobalSessionHealth {
        status,
        active_antigravity_workers: active_agy,
        active_workers_total: active_total,
        max_concurrent_antigravity_workers: policy.max_concurrent_antigravity_workers,
        max_concurrent_workers_total: policy.max_concurrent_workers_total,
        ram_warning,
        affected_projects,
        advisory,
    }
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

    let session_health =
        compute_global_session_health(&projects, &subagents, global_active_preset);
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
        session_health,
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
        assert_eq!(projects[0].session_health.status, "ok");
        assert_eq!(projects[0].session_health.active_antigravity_workers, 1);
        assert_eq!(projects[0].session_health.active_workers_total, 1);
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

    #[test]
    fn parses_iso8601_timestamps_and_subsecond_durations() {
        let t0 = parse_iso8601_to_epoch_ms("1970-01-01T00:00:00Z").unwrap();
        assert_eq!(t0, 0);

        let a = parse_iso8601_to_epoch_ms("2026-11-15T12:00:00.100Z").unwrap();
        let b = parse_iso8601_to_epoch_ms("2026-11-15T12:00:00.900Z").unwrap();
        assert_eq!(b - a, 800);

        let tz = parse_iso8601_to_epoch_ms("2026-11-15T09:00:00.100-03:00").unwrap();
        assert_eq!(tz, a);
    }

    #[test]
    fn detects_fat_parent_acp_dead_over_concurrency_priority_and_worker_dedup() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("statev2.sqlite");
        let ws_ok = dir.path().join("repo-ok");
        let ws_fat = dir.path().join("repo-fat");
        let ws_dead = dir.path().join("repo-dead");
        fs::create_dir_all(&ws_ok).unwrap();
        fs::create_dir_all(&ws_fat).unwrap();
        fs::create_dir_all(&ws_dead).unwrap();

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
                CREATE TABLE orchestration_v2_projection_threads (
                    thread_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    archived_at TEXT,
                    deleted_at TEXT
                );
                CREATE TABLE orchestration_v2_projection_subagents (
                    subagent_id TEXT PRIMARY KEY,
                    parent_thread_id TEXT NOT NULL,
                    child_thread_id TEXT,
                    provider_instance_id TEXT,
                    resolved_model TEXT,
                    status TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE orchestration_v2_projection_runs (
                    run_id TEXT PRIMARY KEY,
                    thread_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    provider_instance_id TEXT,
                    model TEXT,
                    error_message TEXT,
                    started_at TEXT,
                    completed_at TEXT,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE orchestration_v2_projection_turn_items (
                    item_id TEXT PRIMARY KEY,
                    thread_id TEXT NOT NULL,
                    deleted_at TEXT
                );
                ",
            )
            .unwrap();

            conn.execute(
                "INSERT INTO projection_projects VALUES ('p-ok', 'OK Repo', ?1, 'gemini-4-hydrogen', '2026-11-15T01:00:00Z', NULL)",
                [ws_ok.to_str().unwrap()],
            ).unwrap();
            conn.execute(
                "INSERT INTO projection_projects VALUES ('p-fat', 'Fat Repo', ?1, 'gemini-4-hydrogen', '2026-11-15T02:00:00Z', NULL)",
                [ws_fat.to_str().unwrap()],
            ).unwrap();
            conn.execute(
                "INSERT INTO projection_projects VALUES ('p-dead', 'Dead Repo', ?1, 'gemini-4-hydrogen', '2026-11-15T03:00:00Z', NULL)",
                [ws_dead.to_str().unwrap()],
            ).unwrap();

            // p-ok: 1 active subagent on child-ok-1 + matching active run on child-ok-1 (must dedup to 1!)
            // plus active run on parent t-ok (must be excluded since t-ok has active subagent!)
            conn.execute_batch(
                "
                INSERT INTO orchestration_v2_projection_threads VALUES ('t-ok', 'p-ok', 'OK Thread', '2026-11-15T01:00:00Z', NULL, NULL);
                INSERT INTO orchestration_v2_projection_subagents VALUES ('s-ok-1', 't-ok', 'child-ok-1', 'antigravity', 'gemini-4-hydrogen', 'running', '2026-11-15T01:00:00Z');
                INSERT INTO orchestration_v2_projection_runs VALUES ('r-ok-parent', 't-ok', 'running', 'antigravity_2', 'gemini-4-hydrogen', NULL, '2026-11-15T01:00:00Z', NULL, '2026-11-15T01:00:00Z');
                INSERT INTO orchestration_v2_projection_runs VALUES ('r-ok-child', 'child-ok-1', 'running', 'antigravity', 'gemini-4-hydrogen', NULL, '2026-11-15T01:00:00Z', NULL, '2026-11-15T01:00:00Z');
                ",
            ).unwrap();

            // p-fat: 120 turn items on t-fat -> triggers fat_parent
            conn.execute_batch(
                "
                INSERT INTO orchestration_v2_projection_threads VALUES ('t-fat', 'p-fat', 'Fat Thread', '2026-11-15T02:00:00Z', NULL, NULL);
                INSERT INTO orchestration_v2_projection_runs VALUES ('r-fat-1', 't-fat', 'completed', 'antigravity_2', 'gemini-4-hydrogen', NULL, '2026-11-15T02:00:00Z', '2026-11-15T02:00:10Z', '2026-11-15T02:00:10Z');
                ",
            ).unwrap();
            for i in 0..120 {
                conn.execute(
                    "INSERT INTO orchestration_v2_projection_turn_items VALUES (?1, 't-fat', NULL)",
                    [format!("item-{i}")],
                )
                .unwrap();
            }

            // p-dead: ALSO has 3 active antigravity workers (over_concurrency + ram_warning) AND 15 runs (fat_parent)
            // AND latest run failed in 250ms with AcpRequestError -> status priority MUST be "acp_dead"!
            conn.execute_batch(
                "
                INSERT INTO orchestration_v2_projection_threads VALUES ('t-dead', 'p-dead', 'Dead Thread', '2026-11-15T03:00:00Z', NULL, NULL);
                INSERT INTO orchestration_v2_projection_subagents VALUES ('s-d1', 't-dead', 'c-d1', 'antigravity', 'gemini-4-hydrogen', 'running', '2026-11-15T03:00:00Z');
                INSERT INTO orchestration_v2_projection_subagents VALUES ('s-d2', 't-dead', 'c-d2', 'antigravity_2', 'gemini-4-hydrogen', 'running', '2026-11-15T03:00:00Z');
                INSERT INTO orchestration_v2_projection_subagents VALUES ('s-d3', 't-dead', 'c-d3', 'antigravity', 'gemini-4-argon', 'pending', '2026-11-15T03:00:00Z');
                ",
            ).unwrap();
            for i in 0..14 {
                conn.execute(
                    "INSERT INTO orchestration_v2_projection_runs VALUES (?1, 't-dead', 'completed', 'antigravity_2', 'gemini-4-hydrogen', NULL, '2026-11-15T02:50:00Z', '2026-11-15T02:50:05Z', ?2)",
                    [format!("r-dead-{i}"), format!("2026-11-15T02:{i:02}:00Z")],
                )
                .unwrap();
            }
            conn.execute(
                "INSERT INTO orchestration_v2_projection_runs VALUES ('r-dead-latest', 't-dead', 'failed', 'antigravity_2', 'gemini-4-hydrogen', 'provider_error: AcpRequestError session closed', '2026-11-15T03:05:00.100Z', '2026-11-15T03:05:00.350Z', '2026-11-15T03:05:00.350Z')",
                [],
            ).unwrap();
        }

        let (projects, subagents) = read_sqlite_state(&db_path, &HashMap::new()).unwrap();
        let by_id: HashMap<&str, &ProjectSummary> = projects
            .iter()
            .map(|p| (p.project_id.as_str(), p))
            .collect();

        // p-ok: deduped to 1 active worker
        assert_eq!(by_id["p-ok"].session_health.status, "ok");
        assert_eq!(by_id["p-ok"].session_health.active_antigravity_workers, 1);
        assert_eq!(by_id["p-ok"].session_health.active_workers_total, 1);
        assert!(!by_id["p-ok"].session_health.ram_warning);

        // p-fat: 120 turn items -> fat_parent
        assert_eq!(by_id["p-fat"].session_health.status, "fat_parent");
        assert_eq!(by_id["p-fat"].session_health.fat_parent_threads.len(), 1);
        assert_eq!(
            by_id["p-fat"].session_health.fat_parent_threads[0].item_count,
            120
        );

        // p-dead: priority acp_dead > over_concurrency > fat_parent, and ram_warning = true (3 agy on laptop-8gb)
        assert_eq!(by_id["p-dead"].session_health.status, "acp_dead");
        assert!(by_id["p-dead"].session_health.ram_warning);
        assert_eq!(by_id["p-dead"].session_health.active_antigravity_workers, 3);
        assert_eq!(by_id["p-dead"].session_health.dead_acp_threads.len(), 1);
        assert_eq!(
            by_id["p-dead"].session_health.dead_acp_threads[0].run_count,
            15
        );

        // Global session health aggregates across all projects
        let global = compute_global_session_health(&projects, &subagents, None);
        assert_eq!(global.status, "acp_dead");
        assert_eq!(global.active_antigravity_workers, 4);
        assert_eq!(global.active_workers_total, 4);
        assert!(global.ram_warning);
        assert!(global.affected_projects.contains(&"p-fat".to_string()));
        assert!(global.affected_projects.contains(&"p-dead".to_string()));
        assert!(!global.affected_projects.contains(&"p-ok".to_string()));
    }
}
