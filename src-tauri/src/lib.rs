use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // Resolve data directory
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir).expect("failed to create data dir");
            let data_dir_str = data_dir.to_string_lossy().to_string();

            // Resolve static dir for mobile access
            let static_dir = app
                .path()
                .resource_dir()
                .expect("failed to resolve resource dir")
                .join("webroot");
            let static_dir_str = static_dir.to_string_lossy().to_string();

            // Spawn the sidecar server
            let (mut rx, child) = app
                .shell()
                .sidecar("timesheet-server")
                .expect("failed to create sidecar command")
                .args(["--data-dir", &data_dir_str, "--static-dir", &static_dir_str])
                .spawn()
                .expect("failed to spawn sidecar");

            // Store child handle for cleanup
            app.manage(SidecarChild(std::sync::Mutex::new(Some(child))));

            // Log sidecar output in background
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!("[sidecar stdout] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[sidecar stderr] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[sidecar] terminated with {:?}", payload);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // Health check: wait for server to be ready (max 5s)
            let client = reqwest::blocking::Client::new();
            let mut ready = false;
            for _ in 0..50 {
                if client
                    .get("http://localhost:3001/api/health")
                    .send()
                    .ok()
                    .and_then(|r| if r.status().is_success() { Some(()) } else { None })
                    .is_some()
                {
                    ready = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }

            if !ready {
                eprintln!("Warning: server health check timed out after 5s");
            }

            // Show the main window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // System tray
            let open_i = MenuItem::with_id(app, "open", "Ouvrir", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

            let tray_icon = tauri::image::Image::from_bytes(
                include_bytes!("../icons/tray-icon@2x.png"),
            )
            .expect("failed to load tray icon");

            TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        // Kill sidecar before exiting
                        if let Some(state) = app.try_state::<SidecarChild>() {
                            if let Ok(mut guard) = state.0.lock() {
                                if let Some(child) = guard.take() {
                                    let _ = child.kill();
                                }
                            }
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Enable autostart
            {
                use tauri_plugin_autostart::ManagerExt;
                let autostart = app.autolaunch();
                let _ = autostart.enable();
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide window on close instead of quitting (macOS pattern)
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

struct SidecarChild(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);
