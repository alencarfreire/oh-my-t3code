use crate::models::{AppError, AppResult, PresetConfig, SettingsOverridePreview};
use crate::preset_engine::atomic_write_file;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

/// Leaf process-wide lock serializing Read-Modify-Write operations (and backup creation)
/// on `settings.json` and `settings.json.bak`.
///
/// Lock hierarchy: callers may hold `preset_engine::lock_config_state()` before acquiring
/// `lock_settings_file()`, NEVER the reverse. Code holding `lock_settings_file()` must
/// never acquire any other lock or call back into `settings_sync` / `preset_engine` locked APIs.
pub(crate) fn lock_settings_file() -> MutexGuard<'static, ()> {
    static SETTINGS_FILE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    SETTINGS_FILE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Produces a simple deterministic unified diff between two text blobs.
pub fn compute_unified_diff(old_label: &str, new_label: &str, old_text: &str, new_text: &str) -> String {
    if old_text == new_text {
        return String::new();
    }

    let old_lines: Vec<&str> = old_text.lines().collect();
    let new_lines: Vec<&str> = new_text.lines().collect();

    let mut diff = String::new();
    diff.push_str(&format!("--- {old_label}\n"));
    diff.push_str(&format!("+++ {new_label}\n"));
    diff.push_str(&format!(
        "@@ -1,{} +1,{} @@\n",
        old_lines.len(),
        new_lines.len()
    ));

    // Simple LCS-based line diff for clean readable previews
    let n = old_lines.len();
    let m = new_lines.len();

    // Guard against huge quadratic DP on very large files
    if n * m > 250_000 {
        for line in &old_lines {
            diff.push_str(&format!("-{line}\n"));
        }
        for line in &new_lines {
            diff.push_str(&format!("+{line}\n"));
        }
        return diff;
    }

    let mut dp = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            if old_lines[i] == new_lines[j] {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = dp[i + 1][j].max(dp[i][j + 1]);
            }
        }
    }

    let mut i = 0;
    let mut j = 0;
    while i < n && j < m {
        if old_lines[i] == new_lines[j] {
            diff.push_str(&format!(" {}\n", old_lines[i]));
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            diff.push_str(&format!("-{}\n", old_lines[i]));
            i += 1;
        } else {
            diff.push_str(&format!("+{}\n", new_lines[j]));
            j += 1;
        }
    }
    while i < n {
        diff.push_str(&format!("-{}\n", old_lines[i]));
        i += 1;
    }
    while j < m {
        diff.push_str(&format!("+{}\n", new_lines[j]));
        j += 1;
    }

    diff
}

/// Builds a T3 Code `ModelSelection` JSON object (`instanceId`, `model`, `options`).
pub fn build_model_selection_value(
    provider_instance_id: &str,
    model: &str,
    options: &BTreeMap<String, String>,
) -> Value {
    let mut selection = Map::new();
    selection.insert(
        "instanceId".to_string(),
        Value::String(provider_instance_id.to_string()),
    );
    selection.insert("model".to_string(), Value::String(model.to_string()));

    if !options.is_empty() {
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
        let opts: Vec<Value> = normalized
            .iter()
            .map(|(k, v)| {
                let mut entry = Map::new();
                entry.insert("id".to_string(), Value::String(k.clone()));
                entry.insert("value".to_string(), Value::String(v.clone()));
                Value::Object(entry)
            })
            .collect();
        selection.insert("options".to_string(), Value::Array(opts));
    }

    Value::Object(selection)
}

/// Builds the T3 Code `projectSettingsOverrides[projectId]` JSON value for a preset.
pub fn build_project_override_value(preset: &PresetConfig) -> Value {
    let selection = build_model_selection_value(
        &preset.orchestrator.provider_instance_id,
        &preset.orchestrator.model,
        &preset.orchestrator.options,
    );
    let mut wrapper = Map::new();
    wrapper.insert("defaultModelSelection".to_string(), selection);
    Value::Object(wrapper)
}

/// Previews the change to `~/.t3/userdata/settings.json` without modifying disk.
pub fn preview_settings_override(
    settings_path: &Path,
    project_id: &str,
    preset: &PresetConfig,
) -> AppResult<SettingsOverridePreview> {
    let existing_override = {
        let _guard = lock_settings_file();
        if settings_path.exists() {
            let raw = fs::read_to_string(settings_path)?;
            let root: Value = serde_json::from_str(&raw)?;
            root.get("projectSettingsOverrides")
                .and_then(|v| v.as_object())
                .and_then(|map| map.get(project_id))
                .cloned()
        } else {
            None
        }
    };

    let old_str = existing_override
        .as_ref()
        .map(|v| serde_json::to_string_pretty(v).unwrap_or_default())
        .unwrap_or_default();

    let (new_override, new_str, changed) = if preset.enabled {
        let new_ov = build_project_override_value(preset);
        let new_s = serde_json::to_string_pretty(&new_ov)?;
        let is_changed = existing_override.as_ref() != Some(&new_ov);
        (new_ov, new_s, is_changed)
    } else {
        let is_changed = existing_override.is_some();
        (Value::Null, String::new(), is_changed)
    };

    let unified_diff = if changed {
        compute_unified_diff(
            &format!("settings.json (projectSettingsOverrides.{project_id})"),
            &format!("settings.json (projectSettingsOverrides.{project_id})"),
            &old_str,
            &new_str,
        )
    } else {
        String::new()
    };

    Ok(SettingsOverridePreview {
        settings_path: settings_path.display().to_string(),
        project_id: project_id.to_string(),
        existing_override,
        new_override,
        unified_diff,
        changed,
    })
}

/// Backs up `settings.json` to `settings.json.bak` and atomically updates `projectSettingsOverrides[project_id]`,
/// preserving 100% of all unrelated keys in `settings.json`.
pub fn sync_project_settings(
    settings_path: &Path,
    project_id: &str,
    preset: &PresetConfig,
) -> AppResult<(Option<PathBuf>, Value)> {
    if project_id.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "project_id cannot be empty when syncing settings.json".into(),
        ));
    }

    let _guard = lock_settings_file();

    let mut backup_path: Option<PathBuf> = None;
    let mut root: Value = if settings_path.exists() {
        let existing_bytes = fs::read(settings_path)?;
        let parsed: Value = serde_json::from_slice(&existing_bytes)?;
        if !parsed.is_object() {
            return Err(AppError::InvalidInput(
                "settings.json root must be a JSON object".into(),
            ));
        }

        // Mandatory backup before any modification
        let bak = settings_path.with_file_name("settings.json.bak");
        atomic_write_file(&bak, &existing_bytes)?;
        backup_path = Some(bak);
        parsed
    } else {
        Value::Object(Map::new())
    };

    let new_override = build_project_override_value(preset);
    let root_obj = root
        .as_object_mut()
        .ok_or_else(|| AppError::InvalidInput("settings.json root is not an object".into()))?;

    let overrides_val = root_obj
        .entry("projectSettingsOverrides".to_string())
        .or_insert_with(|| Value::Object(Map::new()));

    let overrides_obj = overrides_val.as_object_mut().ok_or_else(|| {
        AppError::InvalidInput("projectSettingsOverrides in settings.json is not an object".into())
    })?;

    // Preserve any extra fields on this project's override object while updating defaultModelSelection
    let merged_entry = match overrides_obj.get_mut(project_id) {
        Some(Value::Object(existing_proj)) => {
            if let Some(sel) = new_override.get("defaultModelSelection").cloned() {
                existing_proj.insert("defaultModelSelection".to_string(), sel);
            }
            Value::Object(existing_proj.clone())
        }
        _ => new_override.clone(),
    };
    overrides_obj.insert(project_id.to_string(), merged_entry);

    let serialized = format!("{}\n", serde_json::to_string_pretty(&root)?);
    atomic_write_file(settings_path, serialized.as_bytes())?;

    Ok((backup_path, new_override))
}

/// Backs up `settings.json` to `settings.json.bak` and atomically updates `defaultModelSelection`
/// and `fallbackModelSelection` (from `preset.fallback_chain[0]`, if present), preserving all other keys.
pub fn sync_global_settings(
    settings_path: &Path,
    preset: &PresetConfig,
) -> AppResult<Option<PathBuf>> {
    let _guard = lock_settings_file();

    let mut backup_path: Option<PathBuf> = None;
    let mut root: Value = if settings_path.exists() {
        let existing_bytes = fs::read(settings_path)?;
        let parsed: Value = serde_json::from_slice(&existing_bytes)?;
        if !parsed.is_object() {
            return Err(AppError::InvalidInput(
                "settings.json root must be a JSON object".into(),
            ));
        }

        let bak = settings_path.with_file_name("settings.json.bak");
        atomic_write_file(&bak, &existing_bytes)?;
        backup_path = Some(bak);
        parsed
    } else {
        Value::Object(Map::new())
    };

    let root_obj = root
        .as_object_mut()
        .ok_or_else(|| AppError::InvalidInput("settings.json root is not an object".into()))?;

    let default_sel = build_model_selection_value(
        &preset.orchestrator.provider_instance_id,
        &preset.orchestrator.model,
        &preset.orchestrator.options,
    );
    root_obj.insert("defaultModelSelection".to_string(), default_sel);

    if let Some(level1) = preset.fallback_chain.first() {
        let fallback_sel = build_model_selection_value(
            &level1.provider_instance_id,
            &level1.model,
            &level1.options,
        );
        root_obj.insert("fallbackModelSelection".to_string(), fallback_sel);
    } else {
        root_obj.remove("fallbackModelSelection");
    }

    let serialized = format!("{}\n", serde_json::to_string_pretty(&root)?);
    atomic_write_file(settings_path, serialized.as_bytes())?;

    Ok(backup_path)
}

/// Backs up `settings.json` to `settings.json.bak` and atomically removes global
/// `defaultModelSelection` and `fallbackModelSelection` keys, preserving all other keys
/// (`projectSettingsOverrides`, `favorites`, etc.).
pub fn remove_global_settings_override(settings_path: &Path) -> AppResult<Option<PathBuf>> {
    let _guard = lock_settings_file();

    if !settings_path.exists() {
        return Ok(None);
    }

    let existing_bytes = fs::read(settings_path)?;
    let mut root: Value = serde_json::from_slice(&existing_bytes)?;
    let Some(root_obj) = root.as_object_mut() else {
        return Err(AppError::InvalidInput(
            "settings.json root must be a JSON object".into(),
        ));
    };

    let has_global_keys = root_obj.contains_key("defaultModelSelection")
        || root_obj.contains_key("fallbackModelSelection");
    if !has_global_keys {
        return Ok(None);
    }

    let bak = settings_path.with_file_name("settings.json.bak");
    atomic_write_file(&bak, &existing_bytes)?;

    root_obj.remove("defaultModelSelection");
    root_obj.remove("fallbackModelSelection");

    let serialized = format!("{}\n", serde_json::to_string_pretty(&root)?);
    atomic_write_file(settings_path, serialized.as_bytes())?;

    Ok(Some(bak))
}

/// Backs up `settings.json` to `settings.json.bak` and atomically removes `projectSettingsOverrides[project_id]`.
pub fn remove_project_settings_override(
    settings_path: &Path,
    project_id: &str,
) -> AppResult<Option<PathBuf>> {
    if project_id.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "project_id cannot be empty when removing settings override".into(),
        ));
    }

    let _guard = lock_settings_file();

    if !settings_path.exists() {
        return Ok(None);
    }

    let existing_bytes = fs::read(settings_path)?;
    let mut root: Value = serde_json::from_slice(&existing_bytes)?;
    let Some(root_obj) = root.as_object_mut() else {
        return Err(AppError::InvalidInput(
            "settings.json root must be a JSON object".into(),
        ));
    };

    let has_entry = root_obj
        .get("projectSettingsOverrides")
        .and_then(|v| v.as_object())
        .is_some_and(|map| map.contains_key(project_id));
    if !has_entry {
        return Ok(None);
    }

    let bak = settings_path.with_file_name("settings.json.bak");
    atomic_write_file(&bak, &existing_bytes)?;

    if let Some(overrides_obj) = root_obj
        .get_mut("projectSettingsOverrides")
        .and_then(|v| v.as_object_mut())
    {
        overrides_obj.remove(project_id);
    }

    let serialized = format!("{}\n", serde_json::to_string_pretty(&root)?);
    atomic_write_file(settings_path, serialized.as_bytes())?;

    Ok(Some(bak))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preset_engine::default_seed_presets;
    use tempfile::tempdir;

    #[test]
    fn creates_backup_and_preserves_unknown_keys_atomically() {
        let dir = tempdir().unwrap();
        let settings_path = dir.path().join("settings.json");

        let original = serde_json::json!({
            "favorites": ["proj-x"],
            "enableDeviceSupport": true,
            "customUnknownKey": { "nested": [1, 2, 3] },
            "providerInstances": {
                "antigravity": { "driver": "antigravity", "displayName": "Agy Veca", "enabled": true }
            },
            "projectSettingsOverrides": {
                "other-project": {
                    "defaultModelSelection": { "instanceId": "codex", "model": "gpt-6.1-sol" }
                }
            }
        });
        fs::write(&settings_path, serde_json::to_string_pretty(&original).unwrap()).unwrap();

        let preset = default_seed_presets()
            .into_iter()
            .find(|p| p.id == "agy-dual")
            .unwrap();

        let (backup_path, _) = sync_project_settings(&settings_path, "proj-1", &preset).unwrap();
        let bak = backup_path.expect("backup path must be created");
        assert!(bak.exists());

        // Backup matches exact original content
        let bak_val: Value = serde_json::from_str(&fs::read_to_string(&bak).unwrap()).unwrap();
        assert_eq!(bak_val, original);

        // Updated settings preserves unknown keys and other project overrides
        let updated: Value =
            serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
        assert_eq!(updated["favorites"], original["favorites"]);
        assert_eq!(updated["enableDeviceSupport"], original["enableDeviceSupport"]);
        assert_eq!(updated["customUnknownKey"], original["customUnknownKey"]);
        assert_eq!(
            updated["projectSettingsOverrides"]["other-project"],
            original["projectSettingsOverrides"]["other-project"]
        );
        assert_eq!(
            updated["projectSettingsOverrides"]["proj-1"]["defaultModelSelection"]["instanceId"],
            "antigravity_2"
        );
        assert_eq!(
            updated["projectSettingsOverrides"]["proj-1"]["defaultModelSelection"]["model"],
            "gemini-4-hydrogen"
        );
    }

    #[test]
    fn sync_global_settings_and_remove_project_override_preserve_keys() {
        let dir = tempdir().unwrap();
        let settings_path = dir.path().join("settings.json");

        let original = serde_json::json!({
            "favorites": ["proj-1"],
            "projectSettingsOverrides": {
                "proj-1": {
                    "defaultModelSelection": { "instanceId": "codex", "model": "gpt-6.1-sol" }
                },
                "proj-2": {
                    "defaultModelSelection": { "instanceId": "antigravity", "model": "gemini-4-hydrogen" }
                }
            }
        });
        fs::write(&settings_path, serde_json::to_string_pretty(&original).unwrap()).unwrap();

        let preset = default_seed_presets()
            .into_iter()
            .find(|p| p.id == "agy-dual")
            .unwrap();

        let bak = sync_global_settings(&settings_path, &preset).unwrap();
        assert!(bak.is_some());

        let after_global: Value =
            serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
        assert_eq!(after_global["favorites"], original["favorites"]);
        assert_eq!(
            after_global["defaultModelSelection"]["instanceId"],
            "antigravity_2"
        );
        assert_eq!(
            after_global["defaultModelSelection"]["model"],
            "gemini-4-hydrogen"
        );
        assert_eq!(
            after_global["fallbackModelSelection"]["instanceId"],
            "antigravity"
        );
        assert_eq!(
            after_global["fallbackModelSelection"]["model"],
            "gemini-4-hydrogen"
        );

        let remove_bak = remove_project_settings_override(&settings_path, "proj-1").unwrap();
        assert!(remove_bak.is_some());
        let after_remove: Value =
            serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
        assert!(after_remove["projectSettingsOverrides"].get("proj-1").is_none());
        assert!(after_remove["projectSettingsOverrides"].get("proj-2").is_some());
    }

    #[test]
    fn concurrent_rmw_settings_sync_preserves_all_project_overrides_and_valid_backup() {
        let dir = tempdir().unwrap();
        let settings_path = dir.path().join("settings.json");

        let original = serde_json::json!({
            "favorites": ["keep-proj"],
            "customUnknownKey": { "preserved": true },
            "projectSettingsOverrides": {}
        });
        fs::write(&settings_path, serde_json::to_string_pretty(&original).unwrap()).unwrap();

        let project_threads = 16usize;
        let global_threads = 2usize;
        let total_threads = project_threads + global_threads;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(total_threads));

        let agy_preset = default_seed_presets()
            .into_iter()
            .find(|p| p.id == "agy-dual")
            .unwrap();
        let codex_preset = default_seed_presets()
            .into_iter()
            .find(|p| p.id == "codex-squad")
            .unwrap();

        let mut handles = Vec::with_capacity(total_threads);
        for idx in 0..project_threads {
            let sp = settings_path.clone();
            let barrier = barrier.clone();
            let mut preset = agy_preset.clone();
            preset.orchestrator.model = "gemini-4-hydrogen".to_string();
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                sync_project_settings(&sp, &format!("p{idx}"), &preset).unwrap_or_else(|e| {
                    panic!("sync_project_settings p{idx} failed: {e}");
                });
            }));
        }
        for idx in 0..global_threads {
            let sp = settings_path.clone();
            let barrier = barrier.clone();
            let preset = if idx % 2 == 0 {
                agy_preset.clone()
            } else {
                codex_preset.clone()
            };
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                sync_global_settings(&sp, &preset).unwrap_or_else(|e| {
                    panic!("sync_global_settings {idx} failed: {e}");
                });
            }));
        }

        for h in handles {
            h.join().expect("worker thread must not panic");
        }

        let final_raw = fs::read_to_string(&settings_path).unwrap();
        let final_val: Value =
            serde_json::from_str(&final_raw).expect("settings.json must be valid JSON");
        assert_eq!(final_val["favorites"], original["favorites"]);
        assert_eq!(final_val["customUnknownKey"], original["customUnknownKey"]);
        assert!(final_val.get("defaultModelSelection").is_some());
        assert!(final_val.get("fallbackModelSelection").is_some());

        let overrides = final_val["projectSettingsOverrides"]
            .as_object()
            .expect("projectSettingsOverrides must be an object");
        for idx in 0..project_threads {
            let key = format!("p{idx}");
            assert!(
                overrides.contains_key(&key),
                "lost update detected: missing projectSettingsOverrides['{key}']"
            );
        }

        let bak_path = settings_path.with_file_name("settings.json.bak");
        assert!(bak_path.exists(), "settings.json.bak must exist");
        let bak_raw = fs::read_to_string(&bak_path).unwrap();
        let bak_val: Value =
            serde_json::from_str(&bak_raw).expect("settings.json.bak must be valid JSON");
        assert!(bak_val.is_object(), "settings.json.bak must be a JSON object");

        for entry in fs::read_dir(dir.path()).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().to_string();
            assert!(
                !name.contains(".tmp."),
                "residual temp file left behind: {name}"
            );
        }
    }

    #[test]
    fn remove_global_settings_override_removes_global_keys_creates_backup_and_preserves_other_keys()
    {
        let dir = tempdir().unwrap();
        let settings_path = dir.path().join("settings.json");

        // Missing file -> Ok(None)
        assert!(remove_global_settings_override(&settings_path).unwrap().is_none());

        let original = serde_json::json!({
            "favorites": ["proj-1"],
            "customUnknownKey": { "nested": "keep" },
            "defaultModelSelection": { "instanceId": "antigravity_2", "model": "gemini-4-hydrogen" },
            "fallbackModelSelection": { "instanceId": "antigravity", "model": "gemini-4-hydrogen" },
            "projectSettingsOverrides": {
                "proj-1": {
                    "defaultModelSelection": { "instanceId": "codex", "model": "gpt-6.1-sol" }
                }
            }
        });
        fs::write(&settings_path, serde_json::to_string_pretty(&original).unwrap()).unwrap();

        let bak = remove_global_settings_override(&settings_path)
            .unwrap()
            .expect("backup must be created when global keys exist");
        assert!(bak.exists());

        let bak_val: Value = serde_json::from_str(&fs::read_to_string(&bak).unwrap()).unwrap();
        assert_eq!(bak_val, original);

        let updated: Value =
            serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
        assert!(updated.get("defaultModelSelection").is_none());
        assert!(updated.get("fallbackModelSelection").is_none());
        assert_eq!(updated["favorites"], original["favorites"]);
        assert_eq!(updated["customUnknownKey"], original["customUnknownKey"]);
        assert_eq!(
            updated["projectSettingsOverrides"],
            original["projectSettingsOverrides"]
        );

        // Idempotent second call when global keys are already absent -> Ok(None)
        assert!(remove_global_settings_override(&settings_path).unwrap().is_none());
    }
}
