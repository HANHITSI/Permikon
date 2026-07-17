mod commands;
mod error;
mod songdb;
mod storage;

use tauri::{Manager, WindowEvent, DragDropEvent, Emitter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .setup(|app| {
        // Initialize database
        let _ = tauri::async_runtime::block_on(async {
            crate::commands::init_database(app.handle().clone()).await
        });

        // Native drag-drop handler
        if let Some(window) = app.get_webview_window("main") {
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::DragDrop(drag_drop_event) = event {
                    match drag_drop_event {
                        DragDropEvent::Drop { paths, .. } => {
                            let paths_str: Vec<String> = paths.iter()
                                .map(|p| p.to_string_lossy().to_string())
                                .collect();
                            let _ = window_clone.emit("file-dropped", paths_str);
                        }
                        DragDropEvent::Enter { .. } => {}
                        DragDropEvent::Leave => {}
                        DragDropEvent::Over { .. } => {}
                        _ => {}
                    }
                }
            });
        }

        Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        crate::commands::analyze_chart,
        crate::commands::search,
        crate::commands::load_chart,
        crate::commands::toggle_favorite,
        crate::commands::delete_history,
        crate::commands::clear_history,
        crate::commands::open_file_dialog,
        crate::commands::open_song_db_dialog,
        crate::commands::export_json,
        crate::commands::copy_analysis,
        crate::commands::get_settings,
        crate::commands::save_settings,
        crate::commands::get_recent_analyses,
        crate::commands::save_analysis,
        crate::commands::drag_drop_analyze,
        crate::commands::load_song_database,
        crate::commands::remove_song_database,
        crate::commands::get_song_databases,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
