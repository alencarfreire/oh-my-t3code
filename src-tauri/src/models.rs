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
