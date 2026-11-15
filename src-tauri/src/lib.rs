pub mod compiler;
pub mod importer;
pub mod models;
pub mod preset_engine;
pub mod settings_sync;
pub mod t3_reader;

use models::{
    AppPaths, CompilePreviewResult, DashboardSnapshot, PresetConfig, ResolvedProjectPreset,
    SyncResult,
};
use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, Rect, WindowEvent,
};

const TRAY_BLUR_DEBOUNCE: Duration = Duration::from_millis(250);

#[derive(Debug, Default)]
struct PopoverBlurGuard {
    last_blur_hide_at: Mutex<Option<Instant>>,
}

impl PopoverBlurGuard {
    fn record_blur_hide(&self, at: Instant) {
        let mut guard = self
            .last_blur_hide_at
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = Some(at);
    }

    fn clear(&self) {
        let mut guard = self
            .last_blur_hide_at
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = None;
    }

    fn consume_if_suppressed(&self, was_visible: bool, now: Instant, window: Duration) -> bool {
        let mut guard = self
            .last_blur_hide_at
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let suppress = should_suppress_tray_reopen(was_visible, *guard, now, window);
        if suppress {
            *guard = None;
        }
        suppress
    }
}

fn should_suppress_tray_reopen(
    was_visible: bool,
    last_blur_hide_at: Option<Instant>,
    now: Instant,
    window: Duration,
) -> bool {
    if was_visible {
        return false;
    }

    match last_blur_hide_at {
        Some(last) => now
            .checked_duration_since(last)
            .is_some_and(|elapsed| elapsed <= window),
        None => false,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StudioNavigatePayload {
    project_id: Option<String>,
    preset_id: Option<String>,
}

pub fn get_dashboard_snapshot_from_paths(paths: &AppPaths) -> models::AppResult<DashboardSnapshot> {
    t3_reader::build_dashboard_snapshot(paths)
}

#[tauri::command]
fn get_dashboard_snapshot() -> Result<DashboardSnapshot, String> {
    let paths = AppPaths::from_env().map_err(String::from)?;
    get_dashboard_snapshot_from_paths(&paths).map_err(String::from)
}

#[tauri::command]
fn list_global_presets() -> Result<Vec<PresetConfig>, String> {
    let paths = AppPaths::from_env().map_err(String::from)?;
    preset_engine::list_global_presets(&paths.presets_dir).map_err(String::from)
}

#[tauri::command]
fn get_project_preset(
    project_id: String,
    workspace_root: String,
) -> Result<ResolvedProjectPreset, String> {
    let paths = AppPaths::from_env().map_err(String::from)?;
    let settings = t3_reader::read_t3_settings(&paths.settings_path());
    let hint = settings
        .project_overrides
        .get(&project_id)
        .map(|s| s.instance_id.as_str());
    preset_engine::get_project_preset(&paths, &project_id, &workspace_root, hint)
        .map_err(String::from)
}

#[tauri::command]
fn save_global_preset(preset: PresetConfig) -> Result<PresetConfig, String> {
    let paths = AppPaths::from_env().map_err(String::from)?;
    compiler::save_global_preset_and_sync(&paths, preset).map_err(String::from)
}

#[tauri::command]
fn save_project_preset(
    project_id: String,
    workspace_root: String,
    preset: PresetConfig,
) -> Result<ResolvedProjectPreset, String> {
    let paths = AppPaths::from_env().map_err(String::from)?;
    preset_engine::save_project_preset(&paths, &project_id, &workspace_root, preset)
        .map_err(String::from)
}

#[tauri::command]
fn preview_preset_sync(
    project_id: String,
    workspace_root: String,
    preset: PresetConfig,
) -> Result<CompilePreviewResult, String> {
    let paths = AppPaths::from_env().map_err(String::from)?;
    compiler::compile_preset_preview(&paths, &project_id, &workspace_root, &preset)
        .map_err(String::from)
}

#[tauri::command]
fn apply_preset_sync(
    project_id: String,
    workspace_root: String,
    preset_id_or_custom: Option<String>,
    custom_preset: Option<PresetConfig>,
) -> Result<SyncResult, String> {
    let paths = AppPaths::from_env().map_err(String::from)?;
    compiler::apply_preset_to_project(
        &paths,
        &project_id,
        &workspace_root,
        preset_id_or_custom,
        custom_preset,
    )
    .map_err(String::from)
}

#[tauri::command]
fn swap_project_instance(
    project_id: String,
    workspace_root: String,
    include_roles: Option<bool>,
) -> Result<SyncResult, String> {
    let paths = AppPaths::from_env().map_err(String::from)?;
    compiler::swap_project_primary_instance_with_options(
        &paths,
        &project_id,
        &workspace_root,
        include_roles.unwrap_or(false),
    )
    .map_err(String::from)
}

#[tauri::command]
fn import_project_squad(
    project_id: String,
    workspace_root: String,
) -> Result<ResolvedProjectPreset, String> {
    let paths = AppPaths::from_env().map_err(String::from)?;
    importer::import_existing_squad(&paths, &project_id, &workspace_root).map_err(String::from)
}

#[tauri::command]
fn set_global_preset_config(
    active_preset_id: String,
    enabled: bool,
) -> Result<DashboardSnapshot, String> {
    let paths = AppPaths::from_env().map_err(String::from)?;
    compiler::set_global_preset_config(&paths, active_preset_id, enabled).map_err(String::from)
}

#[tauri::command]
fn swap_global_instance(
    include_roles: Option<bool>,
    resync_inherited: Option<bool>,
) -> Result<DashboardSnapshot, String> {
    let paths = AppPaths::from_env().map_err(String::from)?;
    compiler::swap_global_instance_with_options(
        &paths,
        include_roles.unwrap_or(false),
        resync_inherited.unwrap_or(false),
    )
    .map_err(String::from)
}

#[tauri::command]
fn set_project_preset_enabled(
    project_id: String,
    workspace_root: String,
    enabled: bool,
) -> Result<SyncResult, String> {
    let paths = AppPaths::from_env().map_err(String::from)?;
    compiler::set_project_preset_enabled(&paths, &project_id, &workspace_root, enabled)
        .map_err(String::from)
}

#[tauri::command]
fn remove_project_override(
    project_id: String,
    workspace_root: String,
) -> Result<DashboardSnapshot, String> {
    let paths = AppPaths::from_env().map_err(String::from)?;
    compiler::remove_project_override(&paths, &project_id, &workspace_root).map_err(String::from)
}

#[tauri::command]
fn open_studio_window(
    app: AppHandle,
    project_id: Option<String>,
    preset_id: Option<String>,
) -> Result<(), String> {
    open_studio_window_internal(&app, project_id, preset_id)
}

#[tauri::command]
fn toggle_popover_window(app: AppHandle) -> Result<(), String> {
    toggle_popover_window_internal(&app, None, false)
}

fn open_studio_window_internal(
    app: &AppHandle,
    project_id: Option<String>,
    preset_id: Option<String>,
) -> Result<(), String> {
    if let Some(guard) = app.try_state::<PopoverBlurGuard>() {
        guard.clear();
    }
    if let Some(popover) = app.get_webview_window("popover") {
        let _ = popover.hide();
    }

    let studio = app
        .get_webview_window("studio")
        .ok_or_else(|| "Studio window is not registered".to_string())?;

    studio.show().map_err(|e| e.to_string())?;
    studio.set_focus().map_err(|e| e.to_string())?;
    let _ = studio.emit(
        "studio://navigate",
        StudioNavigatePayload {
            project_id,
            preset_id,
        },
    );
    Ok(())
}

fn position_popover_under_tray(
    popover: &tauri::WebviewWindow,
    tray_rect: Option<Rect>,
) {
    let Some(rect) = tray_rect else {
        return;
    };

    let scale = popover.scale_factor().unwrap_or(1.0);
    let tray_pos = rect.position.to_physical::<f64>(scale);
    let tray_size = rect.size.to_physical::<f64>(scale);
    let win_size = popover
        .outer_size()
        .unwrap_or_else(|_| tauri::PhysicalSize::new((380.0 * scale) as u32, (500.0 * scale) as u32));

    let mut target_x = (tray_pos.x + tray_size.width / 2.0 - (win_size.width as f64) / 2.0).round() as i32;
    let target_y = (tray_pos.y + tray_size.height + 6.0 * scale).round() as i32;

    if let Ok(Some(monitor)) = popover.current_monitor() {
        let mon_pos = monitor.position();
        let mon_size = monitor.size();
        let min_x = mon_pos.x + (8.0 * scale) as i32;
        let max_x = mon_pos.x + mon_size.width as i32 - win_size.width as i32 - (8.0 * scale) as i32;
        if max_x >= min_x {
            target_x = target_x.clamp(min_x, max_x);
        }
    }

    let _ = popover.set_position(PhysicalPosition::new(target_x, target_y));
}

fn toggle_popover_window_internal(
    app: &AppHandle,
    tray_rect: Option<Rect>,
    from_tray_click: bool,
) -> Result<(), String> {
    let popover = app
        .get_webview_window("popover")
        .ok_or_else(|| "Popover window is not registered".to_string())?;

    let is_visible = popover.is_visible().unwrap_or(false);
    if from_tray_click {
        if let Some(guard) = app.try_state::<PopoverBlurGuard>() {
            if guard.consume_if_suppressed(is_visible, Instant::now(), TRAY_BLUR_DEBOUNCE) {
                return Ok(());
            }
        }
    }

    if is_visible {
        if let Some(guard) = app.try_state::<PopoverBlurGuard>() {
            guard.clear();
        }
        popover.hide().map_err(|e| e.to_string())?;
    } else {
        if let Some(guard) = app.try_state::<PopoverBlurGuard>() {
            guard.clear();
        }
        position_popover_under_tray(&popover, tray_rect);
        popover.show().map_err(|e| e.to_string())?;
        popover.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PopoverBlurGuard::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if let Ok(paths) = AppPaths::from_env() {
                let _ = preset_engine::ensure_seed_presets(&paths.presets_dir);
            }

            let toggle_item =
                MenuItem::with_id(app, "toggle_popover", "Alternar Popover", true, None::<&str>)?;
            let studio_item =
                MenuItem::with_id(app, "open_studio", "Abrir Preset Studio", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&toggle_item, &studio_item, &separator, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("Oh My T3Code")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle_popover" => {
                        let _ = toggle_popover_window_internal(app, None, false);
                    }
                    "open_studio" => {
                        let _ = open_studio_window_internal(app, None, None);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        let _ = toggle_popover_window_internal(
                            tray.app_handle(),
                            Some(rect),
                            true,
                        );
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon).icon_as_template(false);
            }

            let _tray = tray_builder.build(app)?;

            if let Some(popover) = app.get_webview_window("popover") {
                let popover_handle = popover.clone();
                popover.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        if popover_handle.is_visible().unwrap_or(false) {
                            if let Some(guard) = popover_handle.try_state::<PopoverBlurGuard>() {
                                guard.record_blur_hide(Instant::now());
                            }
                            if popover_handle.hide().is_err() {
                                if let Some(guard) = popover_handle.try_state::<PopoverBlurGuard>()
                                {
                                    guard.clear();
                                }
                            }
                        }
                    }
                });
            }

            if let Some(studio) = app.get_webview_window("studio") {
                let studio_handle = studio.clone();
                studio.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = studio_handle.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_dashboard_snapshot,
            list_global_presets,
            get_project_preset,
            save_global_preset,
            save_project_preset,
            preview_preset_sync,
            apply_preset_sync,
            swap_project_instance,
            import_project_squad,
            set_global_preset_config,
            swap_global_instance,
            set_project_preset_enabled,
            remove_project_override,
            open_studio_window,
            toggle_popover_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Oh My T3Code Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suppresses_tray_reopen_within_debounce_window_and_consumes_guard() {
        let guard = PopoverBlurGuard::default();
        let blur_at = Instant::now();
        guard.record_blur_hide(blur_at);

        let within_window = blur_at + Duration::from_millis(120);
        assert!(should_suppress_tray_reopen(
            false,
            Some(blur_at),
            within_window,
            TRAY_BLUR_DEBOUNCE
        ));
        assert!(guard.consume_if_suppressed(false, within_window, TRAY_BLUR_DEBOUNCE));

        // Second tray click right after (even still within 250ms) must open because guard was consumed.
        let second_click = blur_at + Duration::from_millis(180);
        assert!(!guard.consume_if_suppressed(false, second_click, TRAY_BLUR_DEBOUNCE));
    }

    #[test]
    fn suppresses_at_exact_debounce_boundary_and_allows_after_window() {
        let blur_at = Instant::now();
        let at_boundary = blur_at + TRAY_BLUR_DEBOUNCE;
        let after_window = blur_at + TRAY_BLUR_DEBOUNCE + Duration::from_millis(1);

        assert!(should_suppress_tray_reopen(
            false,
            Some(blur_at),
            at_boundary,
            TRAY_BLUR_DEBOUNCE
        ));
        assert!(!should_suppress_tray_reopen(
            false,
            Some(blur_at),
            after_window,
            TRAY_BLUR_DEBOUNCE
        ));

        let guard = PopoverBlurGuard::default();
        guard.record_blur_hide(blur_at);
        assert!(!guard.consume_if_suppressed(false, after_window, TRAY_BLUR_DEBOUNCE));
    }

    #[test]
    fn never_suppresses_when_popover_is_currently_visible_or_no_prior_blur() {
        let blur_at = Instant::now();
        let within_window = blur_at + Duration::from_millis(20);

        assert!(!should_suppress_tray_reopen(
            true,
            Some(blur_at),
            within_window,
            TRAY_BLUR_DEBOUNCE
        ));
        assert!(!should_suppress_tray_reopen(
            true,
            None,
            within_window,
            TRAY_BLUR_DEBOUNCE
        ));
        assert!(!should_suppress_tray_reopen(
            false,
            None,
            within_window,
            TRAY_BLUR_DEBOUNCE
        ));

        // Defensive: now earlier than blur_at should never panic and should not suppress.
        assert!(!should_suppress_tray_reopen(
            false,
            Some(within_window),
            blur_at,
            TRAY_BLUR_DEBOUNCE
        ));
    }
}
