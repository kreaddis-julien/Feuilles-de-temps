use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
    WebviewWindowBuilder,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_shell::ShellExt;

#[cfg(target_os = "macos")]
use tauri_nspanel::{ManagerExt as NSPanelManagerExt, WebviewWindowExt};

struct SidecarChild(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

// ── Tauri commands callable from the frontend ──────────────────────────────

/// Update the tray icon title (shows timer next to icon in macOS menu bar)
#[tauri::command]
fn set_tray_title(app: tauri::AppHandle, title: String) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let display = if title.is_empty() {
            None
        } else {
            // Add leading space for visual separation from tray icon
            Some(format!(" {}", title))
        };
        let _ = tray.set_title(display.as_deref());
    }
}

/// Toggle the tray popup window visibility
#[tauri::command]
fn toggle_tray_popup(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    if let Ok(panel) = app.get_webview_panel("tray-popup") {
        if panel.is_visible() {
            panel.order_out(None);
        } else {
            panel.show();
        }
        return;
    }
    // Fallback for non-macOS
    if let Some(popup) = app.get_webview_window("tray-popup") {
        if popup.is_visible().unwrap_or(false) {
            let _ = popup.hide();
        } else {
            let _ = popup.show();
            let _ = popup.set_focus();
        }
    }
}

/// Close the tray popup
#[tauri::command]
fn close_tray_popup(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    if let Ok(panel) = app.get_webview_panel("tray-popup") {
        panel.order_out(None);
        return;
    }
    if let Some(popup) = app.get_webview_window("tray-popup") {
        let _ = popup.hide();
    }
}

// ───────────────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_nspanel::init())
        .invoke_handler(tauri::generate_handler![
            set_tray_title,
            toggle_tray_popup,
            close_tray_popup,
        ])
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

            // ── Tray popup window (small, borderless, hidden at start) ──────
            let popup = WebviewWindowBuilder::new(
                app,
                "tray-popup",
                tauri::WebviewUrl::App("index.html#/tray-popup".into()),
            )
            .title("Timer")
            .inner_size(340.0, 420.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .background_color(tauri::webview::Color(0, 0, 0, 0))
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .shadow(true)
            .build()?;

            // ── Convert to NSPanel for proper focus handling on macOS ────────
            #[cfg(target_os = "macos")]
            {

                let panel = popup.to_panel().unwrap();

                // Set panel level above menu bar
                let ns_main_menu_window_level: i32 = 24;
                panel.set_level(ns_main_menu_window_level + 1);

                // Allow panel on all spaces, non-activating so it doesn't steal focus
                // from other apps in a disruptive way
                use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior;
                panel.set_collection_behaviour(
                    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
                );

                // Set up delegate to hide panel when it loses key window status
                let app_handle = app.handle().clone();
                let panel_delegate = tauri_nspanel::panel_delegate!(TrayPanelDelegate {
                    window_did_resign_key
                });
                panel_delegate.set_listener(Box::new(move |delegate_name: String| {
                    if delegate_name.as_str() == "window_did_resign_key" {
                        if let Ok(p) = app_handle.get_webview_panel("tray-popup") {
                            p.order_out(None);
                        }
                    }
                }));
                panel.set_delegate(panel_delegate);
            }

            // ── System tray ──────────────────────────────────────────────────
            let open_i = MenuItem::with_id(app, "open", "Ouvrir", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

            let tray_icon = tauri::image::Image::from_bytes(
                include_bytes!("../icons/tray-icon@2x.png"),
            )
            .expect("failed to load tray icon");

            TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .icon_as_template(true)
                .menu(&menu)
                // Left click → toggle popup ; right click → menu
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Down,
                        position,
                        rect,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();

                        #[cfg(target_os = "macos")]
                        if let Ok(panel) = app.get_webview_panel("tray-popup") {
                            if panel.is_visible() {
                                panel.order_out(None);
                            } else {
                                // Position panel under tray icon
                                if let Some(popup_win) = app.get_webview_window("tray-popup") {
                                    let scale_factor = popup_win.scale_factor().unwrap_or(2.0);
                                    let logical_width = 340.0;
                                    let physical_width = logical_width * scale_factor;
                                    let rect_size = rect.size.to_physical::<f64>(scale_factor);
                                    let rect_pos = rect.position.to_physical::<f64>(scale_factor);
                                    let (tray_x, tray_y) = if rect_size.width > 0.0 && rect_size.height > 0.0 {
                                        (rect_pos.x + (rect_size.width / 2.0), rect_pos.y + rect_size.height)
                                    } else {
                                        (position.x, position.y)
                                    };
                                    let x = tray_x - (physical_width / 2.0);
                                    let y = tray_y + (4.0 * scale_factor);
                                    let _ = popup_win.set_position(tauri::PhysicalPosition::new(x, y));
                                }
                                panel.show();
                            }
                            return;
                        }

                        // Fallback for non-macOS
                        if let Some(popup) = app.get_webview_window("tray-popup") {
                            let visible = popup.is_visible().unwrap_or(false);
                            if visible {
                                let _ = popup.hide();
                            } else {
                                let _ = popup.show();
                                let _ = popup.set_focus();
                            }
                        }
                    }
                })
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
