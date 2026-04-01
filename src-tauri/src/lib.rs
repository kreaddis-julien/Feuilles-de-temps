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

#[tauri::command]
fn get_tracking_config() -> Result<serde_json::Value, String> {
    let client = reqwest::blocking::Client::new();
    client
        .get("http://localhost:3001/api/tracking/config/current")
        .send()
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_tracking_config(screen_enabled: Option<bool>, mic_enabled: Option<bool>) -> Result<serde_json::Value, String> {
    let mut body = serde_json::Map::new();
    if let Some(v) = screen_enabled {
        body.insert("screenEnabled".to_string(), serde_json::Value::Bool(v));
    }
    if let Some(v) = mic_enabled {
        body.insert("micEnabled".to_string(), serde_json::Value::Bool(v));
    }
    let client = reqwest::blocking::Client::new();
    client
        .put("http://localhost:3001/api/tracking/config/current")
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .map_err(|e| e.to_string())
}

// ───────────────────────────────────────────────────────────────────────────

/// Spawn a thread that captures audio from the microphone in 30s chunks and sends to server for transcription.
fn spawn_mic_tracker(_app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .unwrap();

        loop {
            // Check if mic tracking is enabled
            let config_ok = client
                .get("http://localhost:3001/api/tracking/config/current")
                .send()
                .ok()
                .and_then(|r| r.text().ok())
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());

            let mic_enabled = config_ok
                .as_ref()
                .and_then(|v| v["micEnabled"].as_bool())
                .unwrap_or(false);

            if !mic_enabled {
                std::thread::sleep(std::time::Duration::from_secs(5));
                continue;
            }

            // Record 30 seconds of audio using sox
            let tmp_path = format!("/tmp/tempo-mic-{}-{}.wav", std::process::id(), chrono::Utc::now().timestamp_millis());
            let record = std::process::Command::new("/opt/homebrew/bin/sox")
                .args([
                    "-d",                    // default input device (microphone)
                    "-r", "16000",           // 16kHz sample rate (whisper requirement)
                    "-c", "1",               // mono
                    "-b", "16",              // 16-bit
                    &tmp_path,               // output file
                    "trim", "0", "30",       // record 30 seconds
                ])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();

            match record {
                Ok(status) if status.success() => {
                    // Read the WAV file and send to server
                    if let Ok(audio_data) = std::fs::read(&tmp_path) {
                        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                        let today = &now[..10];

                        let _ = client
                            .post(format!("http://localhost:3001/api/tracking/{}/audio", today))
                            .header("Content-Type", "audio/wav")
                            .body(audio_data)
                            .send();
                    }
                    // Cleanup
                    let _ = std::fs::remove_file(&tmp_path);
                }
                _ => {
                    let _ = std::fs::remove_file(&tmp_path);
                    eprintln!("[mic-tracker] sox recording failed");
                    std::thread::sleep(std::time::Duration::from_secs(5));
                }
            }
        }
    });
}

/// Spawn a thread that polls the frontmost app every 5 seconds and sends data to the server.
fn spawn_screen_tracker(_app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let client = reqwest::blocking::Client::new();
        let mut last_app = String::new();
        let mut last_title = String::new();
        let mut last_url = String::new();
        let mut was_idle = false;
        let mut idle_start: Option<String> = None;

        loop {
            std::thread::sleep(std::time::Duration::from_secs(5));

            // Check if screen tracking is enabled
            let config_ok = client
                .get("http://localhost:3001/api/tracking/config/current")
                .send()
                .ok()
                .and_then(|r| r.text().ok())
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());

            let screen_enabled = config_ok
                .as_ref()
                .and_then(|v| v["screenEnabled"].as_bool())
                .unwrap_or(false);

            if !screen_enabled {
                last_app.clear();
                last_title.clear();
                last_url.clear();
                was_idle = false;
                idle_start = None;
                continue;
            }

            // Get frontmost app, bundle id, and window title via AppleScript
            let script = r#"
tell application "System Events"
    set fp to first application process whose frontmost is true
    set frontApp to name of fp
    set frontAppId to bundle identifier of fp
    set winTitle to ""
    -- Use AXFocusedWindow first (works best for modern apps like cmux)
    try
        set focWin to value of attribute "AXFocusedWindow" of fp
        set winTitle to name of focWin
    end try
    -- Fallback: iterate windows for first non-empty name
    if winTitle is "" then
        try
            repeat with w in (every window of fp)
                set wName to name of w
                if wName is not "" then
                    set winTitle to wName
                    exit repeat
                end if
            end repeat
        end try
    end if
end tell
-- App-specific title overrides (more accurate than System Events)
if frontAppId is "com.google.Chrome" then
    try
        tell application "Google Chrome" to set winTitle to title of active tab of front window
    end try
else if frontAppId is "com.apple.Safari" then
    try
        tell application "Safari" to set winTitle to name of front document
    end try
else if frontAppId is "com.cmuxterm.app" then
    try
        tell application "cmux" to set winTitle to name of front window
    end try
end if
return frontApp & "||" & frontAppId & "||" & winTitle
            "#;

            let output = std::process::Command::new("osascript")
                .arg("-e")
                .arg(script)
                .output();

            let app_info = match &output {
                Ok(o) => {
                    let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
                    if !stderr.is_empty() {
                        eprintln!("[screen-tracker] osascript stderr: {}", stderr);
                    }
                    stdout
                }
                Err(e) => {
                    eprintln!("[screen-tracker] osascript error: {}", e);
                    continue;
                }
            };

            let parts: Vec<&str> = app_info.splitn(3, "||").collect();
            if parts.len() < 3 {
                eprintln!("[screen-tracker] unexpected output: {}", app_info);
                continue;
            }

            let app_name = parts[0].to_string();
            let bundle_id = parts[1].to_string();
            let title = parts[2].to_string();

            // Get browser URL if Chrome or Safari
            let url = if bundle_id == "com.google.Chrome" {
                let url_script = r#"tell application "Google Chrome" to return URL of active tab of front window"#;
                std::process::Command::new("osascript")
                    .arg("-e")
                    .arg(url_script)
                    .output()
                    .ok()
                    .and_then(|o| String::from_utf8(o.stdout).ok())
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default()
            } else if bundle_id == "com.apple.Safari" {
                let url_script = r#"tell application "Safari" to return URL of front document"#;
                std::process::Command::new("osascript")
                    .arg("-e")
                    .arg(url_script)
                    .output()
                    .ok()
                    .and_then(|o| String::from_utf8(o.stdout).ok())
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default()
            } else {
                String::new()
            };

            // Check idle time (seconds since last user input)
            let idle_script = r#"do shell script "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'"#;
            let idle_secs: u64 = std::process::Command::new("osascript")
                .arg("-e")
                .arg(idle_script)
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0);

            let is_idle = idle_secs >= 120; // 2 minutes
            let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            let today = &now[..10]; // YYYY-MM-DD

            // Handle idle transitions
            if is_idle && !was_idle {
                idle_start = Some(now.clone());
            } else if !is_idle && was_idle {
                if let Some(start) = idle_start.take() {
                    let _ = client
                        .post(format!("http://localhost:3001/api/tracking/{}/idle", today))
                        .json(&serde_json::json!({ "from": start, "until": now }))
                        .send();
                }
            }
            was_idle = is_idle;

            // Don't record screen sessions while idle
            if is_idle {
                continue;
            }

            // Send screen session (server handles deduplication)
            if app_name != last_app || title != last_title || url != last_url {
                last_app = app_name.clone();
                last_title = title.clone();
                last_url = url.clone();
            }

            let mut body = serde_json::json!({
                "from": now,
                "until": now,
                "app": last_app,
                "bundleId": bundle_id,
                "title": last_title,
            });
            if !last_url.is_empty() {
                body["url"] = serde_json::json!(last_url);
            }

            let _ = client
                .post(format!("http://localhost:3001/api/tracking/{}/screen", today))
                .json(&body)
                .send();
        }
    });
}

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
            get_tracking_config,
            set_tracking_config,
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
            use tauri::menu::PredefinedMenuItem;

            let screen_i = MenuItem::with_id(app, "toggle_screen", "● Tracking écran", true, None::<&str>)?;
            let mic_i = MenuItem::with_id(app, "toggle_mic", "○ Tracking micro", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let open_i = MenuItem::with_id(app, "open", "Ouvrir", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&screen_i, &mic_i, &sep, &open_i, &quit_i])?;

            let tray_icon = tauri::image::Image::from_bytes(
                include_bytes!("../icons/tray-icon@2x.png"),
            )
            .expect("failed to load tray icon");

            let screen_i_clone = screen_i.clone();
            let mic_i_clone = mic_i.clone();
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
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "toggle_screen" => {
                        let client = reqwest::blocking::Client::new();
                        if let Ok(resp) = client.get("http://localhost:3001/api/tracking/config/current").send() {
                            if let Ok(config) = resp.json::<serde_json::Value>() {
                                let current = config["screenEnabled"].as_bool().unwrap_or(true);
                                let new_val = !current;
                                let _ = client
                                    .put("http://localhost:3001/api/tracking/config/current")
                                    .json(&serde_json::json!({ "screenEnabled": new_val }))
                                    .send();
                                // Update menu item label
                                let label = if new_val { "● Tracking écran" } else { "○ Tracking écran" };
                                let _ = screen_i_clone.set_text(label);
                            }
                        }
                    }
                    "toggle_mic" => {
                        let client = reqwest::blocking::Client::new();
                        if let Ok(resp) = client.get("http://localhost:3001/api/tracking/config/current").send() {
                            if let Ok(config) = resp.json::<serde_json::Value>() {
                                let current = config["micEnabled"].as_bool().unwrap_or(false);
                                let new_val = !current;
                                let _ = client
                                    .put("http://localhost:3001/api/tracking/config/current")
                                    .json(&serde_json::json!({ "micEnabled": new_val }))
                                    .send();
                                let label = if new_val { "● Tracking micro" } else { "○ Tracking micro" };
                                let _ = mic_i_clone.set_text(label);
                            }
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

            // Set initial toggle labels from saved config
            {
                let client = reqwest::blocking::Client::new();
                if let Ok(resp) = client.get("http://localhost:3001/api/tracking/config/current").send() {
                    if let Ok(config) = resp.json::<serde_json::Value>() {
                        let screen_on = config["screenEnabled"].as_bool().unwrap_or(true);
                        let mic_on = config["micEnabled"].as_bool().unwrap_or(false);
                        let _ = screen_i.set_text(if screen_on { "● Tracking écran" } else { "○ Tracking écran" });
                        let _ = mic_i.set_text(if mic_on { "● Tracking micro" } else { "○ Tracking micro" });
                    }
                }
            }

            // Enable autostart
            {
                use tauri_plugin_autostart::ManagerExt;
                let autostart = app.autolaunch();
                let _ = autostart.enable();
            }

            // ── Screen activity tracker ───────────────────────────────────
            spawn_screen_tracker(app.handle().clone());
            spawn_mic_tracker(app.handle().clone());

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
