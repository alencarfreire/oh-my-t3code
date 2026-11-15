use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("JSON parse/serialize error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Invalid input: {0}")]
    InvalidInput(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Cyclic preset inheritance detected: {0}")]
    CycleDetected(String),
    #[error("Path traversal rejected: {0}")]
    PathTraversal(String),
}

impl From<AppError> for String {
    fn from(err: AppError) -> Self {
        err.to_string()
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Resolved filesystem paths used by the backend. Parameterized so unit tests can inject temp dirs.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub t3_home: PathBuf,
    pub presets_dir: PathBuf,
    pub skill_roots: Vec<(String, PathBuf)>,
}

impl AppPaths {
    pub fn from_env() -> AppResult<Self> {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::InvalidInput("Unable to resolve user home directory".into()))?;

        let t3_home = match std::env::var("T3CODE_HOME") {
            Ok(val) if !val.trim().is_empty() => PathBuf::from(val),
            _ => home.join(".t3"),
        };

        let config_root = match std::env::var("OH_MY_T3CODE_CONFIG_DIR") {
            Ok(val) if !val.trim().is_empty() => PathBuf::from(val),
            _ => home.join(".config").join("oh-my-t3code"),
        };

        Ok(Self {
            t3_home,
            presets_dir: config_root.join("presets"),
            skill_roots: vec![
                ("skillshare".into(), home.join(".config").join("skillshare").join("skills")),
                ("gemini".into(), home.join(".gemini").join("config").join("skills")),
            ],
        })
    }

    pub fn sqlite_path(&self) -> PathBuf {
        self.t3_home.join("userdata").join("statev2.sqlite")
    }

    pub fn settings_path(&self) -> PathBuf {
        self.t3_home.join("userdata").join("settings.json")
    }

    pub fn global_config_path(&self) -> PathBuf {
        let config_root = self.presets_dir.parent().unwrap_or(&self.presets_dir);
        config_root.join("config.jsonc")
    }
}

pub fn default_true() -> bool {
    true
}

fn default_global_preset_id() -> String {
    "default".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GlobalAppConfig {
    #[serde(default = "default_global_preset_id")]
    pub active_global_preset_id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

impl Default for GlobalAppConfig {
    fn default() -> Self {
        Self {
            active_global_preset_id: default_global_preset_id(),
            enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorSelection {
    pub provider_instance_id: String,
    pub model: String,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FallbackStep {
    pub provider_instance_id: String,
    pub model: String,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentionPolicy {
    #[serde(default)]
    pub single_test_db: bool,
    #[serde(default)]
    pub env_vars: BTreeMap<String, String>,
    #[serde(default)]
    pub git_ignored_builds: Vec<String>,
    #[serde(default)]
    pub conflict_files: Vec<String>,
    #[serde(default = "default_isolation_mode")]
    pub default_isolation: String,
}

fn default_isolation_mode() -> String {
    "shared".to_string()
}

impl Default for ContentionPolicy {
    fn default() -> Self {
        Self {
            single_test_db: false,
            env_vars: BTreeMap::new(),
            git_ignored_builds: Vec::new(),
            conflict_files: Vec::new(),
            default_isolation: default_isolation_mode(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoleConfig {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub when_to_use: String,
    pub provider_instance_id: String,
    pub model: String,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub mcps: Vec<String>,
    #[serde(default)]
    pub allowed_paths: Vec<String>,
    #[serde(default)]
    pub forbidden_paths: Vec<String>,
    #[serde(default)]
    pub invariants: Vec<String>,
    #[serde(default)]
    pub verification_commands: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkerThinkingRule {
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub thinking_level: String,
}

pub fn default_max_antigravity_for_profile(profile: &str) -> u32 {
    match profile {
        "laptop-8gb" => 2,
        "desktop-16gb" => 3,
        "desktop-32gb-plus" => 4,
        _ => 2,
    }
}

fn default_hardware_profile() -> String {
    "laptop-8gb".to_string()
}

fn default_max_concurrent_antigravity_workers() -> u32 {
    2
}

fn default_max_concurrent_workers_total() -> u32 {
    3
}

fn default_parent_max_turns_before_handoff() -> u32 {
    15
}

fn default_parent_max_items_before_handoff() -> u32 {
    120
}

fn default_parent_warn_input_tokens() -> u64 {
    200_000
}

fn default_parent_hard_input_tokens() -> u64 {
    700_000
}

fn default_parent_thinking_level() -> String {
    "medium".to_string()
}

fn default_worker_thinking_by_kind() -> BTreeMap<String, WorkerThinkingRule> {
    BTreeMap::from([
        (
            "architecture".to_string(),
            WorkerThinkingRule {
                model: "gemini-4-argon".to_string(),
                thinking_level: "high".to_string(),
            },
        ),
        (
            "backend".to_string(),
            WorkerThinkingRule {
                model: "gemini-4-hydrogen".to_string(),
                thinking_level: "high".to_string(),
            },
        ),
        (
            "frontend".to_string(),
            WorkerThinkingRule {
                model: "gemini-4-hydrogen".to_string(),
                thinking_level: "medium".to_string(),
            },
        ),
        (
            "qa".to_string(),
            WorkerThinkingRule {
                model: "gemini-4-argon".to_string(),
                thinking_level: "high".to_string(),
            },
        ),
        (
            "research".to_string(),
            WorkerThinkingRule {
                model: "gemini-4-hydrogen".to_string(),
                thinking_level: "low".to_string(),
            },
        ),
    ])
}

fn default_delegate_mode() -> String {
    "async-default".to_string()
}

fn default_on_acp_session_dead() -> String {
    "advise-new-thread".to_string()
}

fn default_forbidden_patterns() -> Vec<String> {
    vec![
        "orquestrar+implementar no mesmo chat".to_string(),
        "4 ACP simultâneos neste perfil".to_string(),
        "thinking high no pai".to_string(),
        "continuar thread após provider_error AcpRequestError".to_string(),
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionPolicy {
    #[serde(default = "default_hardware_profile")]
    pub hardware_profile: String,
    #[serde(default = "default_max_concurrent_antigravity_workers")]
    pub max_concurrent_antigravity_workers: u32,
    #[serde(default = "default_max_concurrent_workers_total")]
    pub max_concurrent_workers_total: u32,
    #[serde(default = "default_parent_max_turns_before_handoff")]
    pub parent_max_turns_before_handoff: u32,
    #[serde(default = "default_parent_max_items_before_handoff")]
    pub parent_max_items_before_handoff: u32,
    #[serde(default = "default_parent_warn_input_tokens")]
    pub parent_warn_input_tokens: u64,
    #[serde(default = "default_parent_hard_input_tokens")]
    pub parent_hard_input_tokens: u64,
    #[serde(default = "default_parent_thinking_level")]
    pub parent_thinking_level: String,
    #[serde(default = "default_worker_thinking_by_kind")]
    pub worker_thinking_by_kind: BTreeMap<String, WorkerThinkingRule>,
    #[serde(default = "default_delegate_mode")]
    pub delegate_mode: String,
    #[serde(default = "default_on_acp_session_dead")]
    pub on_acp_session_dead: String,
    #[serde(default = "default_forbidden_patterns")]
    pub forbidden_patterns: Vec<String>,
}

impl Default for SessionPolicy {
    fn default() -> Self {
        Self {
            hardware_profile: default_hardware_profile(),
            max_concurrent_antigravity_workers: default_max_concurrent_antigravity_workers(),
            max_concurrent_workers_total: default_max_concurrent_workers_total(),
            parent_max_turns_before_handoff: default_parent_max_turns_before_handoff(),
            parent_max_items_before_handoff: default_parent_max_items_before_handoff(),
            parent_warn_input_tokens: default_parent_warn_input_tokens(),
            parent_hard_input_tokens: default_parent_hard_input_tokens(),
            parent_thinking_level: default_parent_thinking_level(),
            worker_thinking_by_kind: default_worker_thinking_by_kind(),
            delegate_mode: default_delegate_mode(),
            on_acp_session_dead: default_on_acp_session_dead(),
            forbidden_patterns: default_forbidden_patterns(),
        }
    }
}

/// Forces `parent_thinking_level` down to `"medium"` on `laptop-8gb` whenever configured as `"high"` or `"xhigh"`.
pub fn effective_parent_thinking_level(policy: &SessionPolicy) -> String {
    let configured = policy.parent_thinking_level.trim();
    if policy.hardware_profile == "laptop-8gb" && matches!(configured, "high" | "xhigh") {
        return "medium".to_string();
    }
    if configured.is_empty() {
        "medium".to_string()
    } else {
        configured.to_string()
    }
}

fn thinking_rank(level: &str) -> u8 {
    match level {
        "low" => 1,
        "medium" => 2,
        "high" => 3,
        "xhigh" => 4,
        _ => 2,
    }
}

/// Normalizes orchestrator options and applies `effective_parent_thinking_level(&preset.session_policy)`.
pub fn effective_orchestrator_options(preset: &PresetConfig) -> BTreeMap<String, String> {
    let mut normalized = BTreeMap::new();
    for (k, v) in &preset.orchestrator.options {
        if k == "thinkingLevel" {
            normalized
                .entry("thinking_level".to_string())
                .or_insert_with(|| v.clone());
        } else {
            normalized.insert(k.clone(), v.clone());
        }
    }

    let eff_level = effective_parent_thinking_level(&preset.session_policy);
    if preset.orchestrator.provider_instance_id.starts_with("antigravity")
        || preset.orchestrator.model.starts_with("gemini-4-")
        || normalized.contains_key("thinking_level")
    {
        normalized.insert("thinking_level".to_string(), eff_level);
    } else if let Some(current_effort) = normalized.get("reasoningEffort").cloned() {
        if thinking_rank(&eff_level) < thinking_rank(&current_effort) {
            normalized.insert("reasoningEffort".to_string(), eff_level);
        }
    }

    normalized
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PresetConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub extends: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_topology")]
    pub topology: String,
    #[serde(default)]
    pub orchestrator: OrchestratorSelection,
    #[serde(default)]
    pub fallback_chain: Vec<FallbackStep>,
    #[serde(default)]
    pub contention: ContentionPolicy,
    #[serde(default)]
    pub session_policy: SessionPolicy,
    #[serde(default)]
    pub roles: BTreeMap<String, RoleConfig>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_roles: Vec<String>,
}

fn default_topology() -> String {
    "intra-thread-squad".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInstanceInfo {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub is_builtin: bool,
    pub configured: bool,
    pub enabled: bool,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct T3ModelOption {
    pub id: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct T3ModelSelection {
    pub instance_id: String,
    pub model: String,
    #[serde(default)]
    pub options: Vec<T3ModelOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubagentActivity {
    pub subagent_id: String,
    pub parent_thread_id: String,
    pub child_thread_id: Option<String>,
    pub project_id: Option<String>,
    pub project_title: Option<String>,
    pub role: Option<String>,
    pub title: Option<String>,
    pub prompt_preview: Option<String>,
    pub provider_instance_id: Option<String>,
    pub requested_model: Option<String>,
    pub resolved_model: Option<String>,
    pub status: String,
    pub summary: Option<String>,
    pub error_message: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: String,
    pub settled_at: Option<String>,
}

fn default_health_status() -> String {
    "ok".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ParentThreadHealth {
    pub thread_id: String,
    pub project_id: String,
    pub title: String,
    pub run_count: u32,
    pub item_count: u32,
    pub status: String,
    pub last_error: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionHealth {
    #[serde(default)]
    pub project_id: String,
    #[serde(default = "default_health_status")]
    pub status: String,
    #[serde(default)]
    pub active_antigravity_workers: u32,
    #[serde(default)]
    pub active_workers_total: u32,
    #[serde(default = "default_max_concurrent_antigravity_workers")]
    pub max_concurrent_antigravity_workers: u32,
    #[serde(default = "default_max_concurrent_workers_total")]
    pub max_concurrent_workers_total: u32,
    #[serde(default)]
    pub ram_warning: bool,
    #[serde(default)]
    pub fat_parent_threads: Vec<ParentThreadHealth>,
    #[serde(default)]
    pub dead_acp_threads: Vec<ParentThreadHealth>,
    #[serde(default)]
    pub advisory: Option<String>,
}

impl Default for ProjectSessionHealth {
    fn default() -> Self {
        Self {
            project_id: String::new(),
            status: default_health_status(),
            active_antigravity_workers: 0,
            active_workers_total: 0,
            max_concurrent_antigravity_workers: default_max_concurrent_antigravity_workers(),
            max_concurrent_workers_total: default_max_concurrent_workers_total(),
            ram_warning: false,
            fat_parent_threads: Vec::new(),
            dead_acp_threads: Vec::new(),
            advisory: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSessionHealth {
    #[serde(default = "default_health_status")]
    pub status: String,
    #[serde(default)]
    pub active_antigravity_workers: u32,
    #[serde(default)]
    pub active_workers_total: u32,
    #[serde(default = "default_max_concurrent_antigravity_workers")]
    pub max_concurrent_antigravity_workers: u32,
    #[serde(default = "default_max_concurrent_workers_total")]
    pub max_concurrent_workers_total: u32,
    #[serde(default)]
    pub ram_warning: bool,
    #[serde(default)]
    pub affected_projects: Vec<String>,
    #[serde(default)]
    pub advisory: Option<String>,
}

impl Default for GlobalSessionHealth {
    fn default() -> Self {
        Self {
            status: default_health_status(),
            active_antigravity_workers: 0,
            active_workers_total: 0,
            max_concurrent_antigravity_workers: default_max_concurrent_antigravity_workers(),
            max_concurrent_workers_total: default_max_concurrent_workers_total(),
            ram_warning: false,
            affected_projects: Vec::new(),
            advisory: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub project_id: String,
    pub title: String,
    pub workspace_root: String,
    pub default_model: Option<String>,
    pub active_instance_id: Option<String>,
    pub active_model: Option<String>,
    pub updated_at: String,
    pub has_local_preset: bool,
    pub local_preset_id: Option<String>,
    pub local_preset_extends: Option<String>,
    pub preset_enabled: bool,
    pub has_custom_override: bool,
    pub detected_squad_slug: Option<String>,
    pub detected_squad_path: Option<String>,
    pub active_subagent_count: usize,
    #[serde(default)]
    pub session_health: ProjectSessionHealth,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResyncedProjectReport {
    pub project_id: String,
    pub title: String,
    pub workspace_root: String,
    pub preset_id: String,
    pub written_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FailedProjectResync {
    pub project_id: String,
    pub title: String,
    pub workspace_root: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSwapReport {
    pub include_roles: bool,
    pub resync_inherited: bool,
    pub rebalanced_roles_count: usize,
    pub rebalanced_roles: Vec<String>,
    pub resynced_projects: Vec<ResyncedProjectReport>,
    pub failed_projects: Vec<FailedProjectResync>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSnapshot {
    pub global_config: GlobalAppConfig,
    pub projects: Vec<ProjectSummary>,
    pub subagents: Vec<SubagentActivity>,
    pub provider_instances: Vec<ProviderInstanceInfo>,
    pub global_presets: Vec<PresetConfig>,
    pub skills: Vec<SkillMetadata>,
    pub default_model_selection: Option<T3ModelSelection>,
    pub fallback_model_selection: Option<T3ModelSelection>,
    pub sqlite_available: bool,
    pub settings_available: bool,
    #[serde(default)]
    pub session_health: GlobalSessionHealth,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_global_swap_report: Option<GlobalSwapReport>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedProjectPreset {
    pub project_id: String,
    pub workspace_root: String,
    pub project_slug: String,
    pub has_local_override: bool,
    pub local_preset_path: String,
    pub raw_local_preset: Option<PresetConfig>,
    pub resolved_preset: PresetConfig,
    pub detected_squad_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompiledFilePreview {
    pub path: String,
    pub relative_path: String,
    pub existing_content: Option<String>,
    pub new_content: String,
    pub unified_diff: String,
    pub changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsOverridePreview {
    pub settings_path: String,
    pub project_id: String,
    pub existing_override: Option<serde_json::Value>,
    pub new_override: serde_json::Value,
    pub unified_diff: String,
    pub changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompilePreviewResult {
    pub project_id: String,
    pub workspace_root: String,
    pub project_slug: String,
    pub preset_id: String,
    pub files: Vec<CompiledFilePreview>,
    pub settings_preview: SettingsOverridePreview,
    pub has_changes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub project_id: String,
    pub workspace_root: String,
    pub preset_id: String,
    pub written_files: Vec<String>,
    pub settings_path: String,
    pub backup_path: Option<String>,
    pub active_instance_id: String,
    pub active_model: String,
    #[serde(default)]
    pub rebalanced_roles_count: usize,
    #[serde(default)]
    pub rebalanced_roles: Vec<String>,
}
