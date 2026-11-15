use crate::models::{AppError, AppResult, PresetConfig, SettingsOverridePreview};
use crate::preset_engine::atomic_write_file;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

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

/// Builds the T3 Code `projectSettingsOverrides[projectId]` JSON value for a preset.
pub fn build_project_override_value(preset: &PresetConfig) -> Value {
    let mut selection = Map::new();
    selection.insert(
        "instanceId".to_string(),
        Value::String(preset.orchestrator.provider_instance_id.clone()),
    );
    selection.insert(
        "model".to_string(),
        Value::String(preset.orchestrator.model.clone()),
    );

    if !preset.orchestrator.options.is_empty() {
        let opts: Vec<Value> = preset
            .orchestrator
            .options
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

    let mut wrapper = Map::new();
    wrapper.insert("defaultModelSelection".to_string(), Value::Object(selection));
    Value::Object(wrapper)
}

/// Previews the change to `~/.t3/userdata/settings.json` without modifying disk.
pub fn preview_settings_override(
    settings_path: &Path,
    project_id: &str,
    preset: &PresetConfig,
) -> AppResult<SettingsOverridePreview> {
    let new_override = build_project_override_value(preset);
    let existing_override = if settings_path.exists() {
        let raw = fs::read_to_string(settings_path)?;
        let root: Value = serde_json::from_str(&raw)?;
        root.get("projectSettingsOverrides")
            .and_then(|v| v.as_object())
            .and_then(|map| map.get(project_id))
            .cloned()
    } else {
        None
    };

    let old_str = existing_override
        .as_ref()
        .map(|v| serde_json::to_string_pretty(v).unwrap_or_default())
        .unwrap_or_default();
    let new_str = serde_json::to_string_pretty(&new_override)?;
    let changed = existing_override.as_ref() != Some(&new_override);
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
}
