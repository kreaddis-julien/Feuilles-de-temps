# Screen Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track the user's active app, window title, and browser URL every 5 seconds, store deduplicated sessions in daily JSON files, and provide a tray toggle to enable/disable tracking.

**Architecture:** A Rust thread in lib.rs polls macOS APIs (NSWorkspace + AppleScript) for the frontmost app/title/URL. Data is sent to the Express server via HTTP POST to new `/api/tracking` endpoints. The server stores deduplicated sessions in `activity-YYYY-MM-DD.json` files using the existing Storage pattern. A toggle in the tray context menu controls screen tracking state, persisted in a config file.

**Tech Stack:** Rust (macOS APIs via objc2/cocoa), Express + TypeScript, JSON file storage, Tauri tray menu

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/src/types.ts` | Modify | Add tracking types (ScreenSession, IdlePeriod, TrackingDay, TrackingConfig) |
| `client/src/types.ts` | Modify | Mirror server types |
| `server/src/storage.ts` | Modify | Add loadTracking/saveTracking/loadTrackingConfig/saveTrackingConfig methods |
| `server/src/routes/tracking.ts` | Create | REST endpoints for tracking data and config |
| `server/src/app.ts` | Modify | Mount tracking router |
| `client/src/api.ts` | Modify | Add tracking API functions |
| `src-tauri/src/lib.rs` | Modify | Screen tracker thread + tray toggle items |
| `src-tauri/Cargo.toml` | Modify | Add objc2 dependencies for macOS APIs |
| `src-tauri/capabilities/default.json` | Modify | Add permissions if needed |

---

### Task 1: Tracking Types

**Files:**
- Modify: `server/src/types.ts`
- Modify: `client/src/types.ts`

- [ ] **Step 1: Add tracking types to server/src/types.ts**

Append at the end of the file:

```typescript
// --- Activity Tracking ---

export interface ScreenSession {
  from: string;       // ISO timestamp
  until: string;      // ISO timestamp
  app: string;        // e.g. "Google Chrome"
  bundleId: string;   // e.g. "com.google.Chrome"
  title: string;      // Window title
  url?: string;       // Browser URL (Chrome/Safari only)
}

export interface IdlePeriod {
  from: string;
  until: string;
}

export interface TrackingDay {
  date: string;
  screenSessions: ScreenSession[];
  audioSegments: [];   // Placeholder for Phase 3
  idlePeriods: IdlePeriod[];
  report: null;        // Placeholder for Phase 2
}

export interface TrackingConfig {
  screenEnabled: boolean;
  micEnabled: boolean;
}
```

- [ ] **Step 2: Copy the same types to client/src/types.ts**

Append the exact same block to `client/src/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add server/src/types.ts client/src/types.ts
git commit -m "feat: add tracking types for screen sessions, idle periods, and config"
```

---

### Task 2: Storage Methods for Tracking

**Files:**
- Modify: `server/src/storage.ts`

- [ ] **Step 1: Read server/src/storage.ts**

Read the full file to understand the existing pattern.

- [ ] **Step 2: Add tracking storage methods**

Add these methods to the Storage class, after the existing `saveTimesheet` method:

```typescript
  async loadTracking(date: string): Promise<TrackingDay> {
    const filePath = path.join(this.dataDir, `activity-${date}.json`);
    try {
      const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      return raw as TrackingDay;
    } catch {
      return { date, screenSessions: [], audioSegments: [], idlePeriods: [], report: null };
    }
  }

  async saveTracking(data: TrackingDay): Promise<void> {
    const filePath = path.join(this.dataDir, `activity-${data.date}.json`);
    await this.atomicWrite(filePath, JSON.stringify(data, null, 2));
  }

  async loadTrackingConfig(): Promise<TrackingConfig> {
    const filePath = path.join(this.dataDir, 'tracking-config.json');
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf-8')) as TrackingConfig;
    } catch {
      return { screenEnabled: true, micEnabled: false };
    }
  }

  async saveTrackingConfig(config: TrackingConfig): Promise<void> {
    const filePath = path.join(this.dataDir, 'tracking-config.json');
    await this.atomicWrite(filePath, JSON.stringify(config, null, 2));
  }
```

Also add the import for the new types at the top of the file:

```typescript
import type { TrackingDay, TrackingConfig } from './types.js';
```

- [ ] **Step 3: Commit**

```bash
git add server/src/storage.ts
git commit -m "feat: add tracking storage methods for daily activity and config"
```

---

### Task 3: Tracking Server Routes

**Files:**
- Create: `server/src/routes/tracking.ts`
- Modify: `server/src/app.ts`

- [ ] **Step 1: Create the tracking router**

Create `server/src/routes/tracking.ts`:

```typescript
import { Router } from 'express';
import type { Storage } from '../storage.js';
import type { ScreenSession, IdlePeriod } from '../types.js';

export function createTrackingRouter(storage: Storage) {
  const router = Router();

  // Get full tracking data for a day
  router.get('/:date', async (req, res) => {
    const data = await storage.loadTracking(req.params.date);
    res.json(data);
  });

  // Append or update a screen session
  router.post('/:date/screen', async (req, res) => {
    const data = await storage.loadTracking(req.params.date);
    const session: ScreenSession = req.body;

    // Deduplication: if last session has same app+title+url, extend it
    const last = data.screenSessions[data.screenSessions.length - 1];
    if (
      last &&
      last.app === session.app &&
      last.title === session.title &&
      (last.url ?? '') === (session.url ?? '')
    ) {
      last.until = session.until;
    } else {
      data.screenSessions.push(session);
    }

    await storage.saveTracking(data);
    res.json({ ok: true });
  });

  // Record an idle period
  router.post('/:date/idle', async (req, res) => {
    const data = await storage.loadTracking(req.params.date);
    const idle: IdlePeriod = req.body;

    // Extend last idle period if contiguous
    const last = data.idlePeriods[data.idlePeriods.length - 1];
    if (last && last.until === idle.from) {
      last.until = idle.until;
    } else {
      data.idlePeriods.push(idle);
    }

    await storage.saveTracking(data);
    res.json({ ok: true });
  });

  // Get tracking config
  router.get('/config/current', async (_req, res) => {
    const config = await storage.loadTrackingConfig();
    res.json(config);
  });

  // Update tracking config
  router.put('/config/current', async (req, res) => {
    const config = await storage.loadTrackingConfig();
    if (req.body.screenEnabled !== undefined) config.screenEnabled = req.body.screenEnabled;
    if (req.body.micEnabled !== undefined) config.micEnabled = req.body.micEnabled;
    await storage.saveTrackingConfig(config);
    res.json(config);
  });

  return router;
}
```

- [ ] **Step 2: Mount the router in app.ts**

In `server/src/app.ts`, add the import:

```typescript
import { createTrackingRouter } from './routes/tracking.js';
```

And mount it after the existing routes:

```typescript
app.use('/api/tracking', createTrackingRouter(storage));
```

- [ ] **Step 3: Run server tests to make sure nothing is broken**

```bash
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
cd /Users/kreaddis-julien/Documents/Feuilles-de-temps/server && bunx vitest run
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/tracking.ts server/src/app.ts
git commit -m "feat: add tracking API endpoints for screen sessions, idle, and config"
```

---

### Task 4: Client API Functions

**Files:**
- Modify: `client/src/api.ts`

- [ ] **Step 1: Add tracking API functions**

Append before the `// Deferred` section in `client/src/api.ts`:

```typescript
// Tracking
export const getTracking = (date: string) =>
  json<TrackingDay>(`/tracking/${date}`);

export const postScreenSession = (date: string, session: ScreenSession) =>
  json<{ ok: boolean }>(`/tracking/${date}/screen`, {
    method: 'POST',
    body: JSON.stringify(session),
  });

export const postIdlePeriod = (date: string, idle: IdlePeriod) =>
  json<{ ok: boolean }>(`/tracking/${date}/idle`, {
    method: 'POST',
    body: JSON.stringify(idle),
  });

export const getTrackingConfig = () =>
  json<TrackingConfig>('/tracking/config/current');

export const updateTrackingConfig = (config: Partial<TrackingConfig>) =>
  json<TrackingConfig>('/tracking/config/current', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
```

Also update the import at the top to include the new types:

```typescript
import type { TimesheetDay, TimesheetEntry, ActivitiesData, CustomersData, Customer, TrackingDay, ScreenSession, IdlePeriod, TrackingConfig } from './types';
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
cd /Users/kreaddis-julien/Documents/Feuilles-de-temps/client && npx tsc -b
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/api.ts
git commit -m "feat: add tracking API client functions"
```

---

### Task 5: Rust Screen Tracker Thread

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

This is the core task — a Rust thread that polls macOS for the frontmost app, window title, URL, and idle state every 5 seconds, then sends the data to the Express server.

- [ ] **Step 1: Add dependencies to Cargo.toml**

No new Rust dependencies needed for this approach. We'll use `std::process::Command` to run AppleScript via `osascript`, and `reqwest` (already a dependency) to POST data to the server. This avoids complex objc2 bindings.

- [ ] **Step 2: Add the screen tracker to lib.rs**

Read the current `lib.rs` first. Then add a new function and spawn it as a thread in the setup block.

Add this function before the `pub fn run()` function:

```rust
/// Spawn a thread that polls the frontmost app every 5 seconds and sends data to the server.
fn spawn_screen_tracker(app_handle: tauri::AppHandle) {
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

            // Get frontmost app and title via AppleScript
            let script = r#"
                tell application "System Events"
                    set frontApp to name of first application process whose frontmost is true
                    set frontAppId to bundle identifier of first application process whose frontmost is true
                end tell
                tell application "System Events"
                    try
                        set winTitle to name of front window of (first application process whose frontmost is true)
                    on error
                        set winTitle to ""
                    end try
                end tell
                return frontApp & "||" & frontAppId & "||" & winTitle
            "#;

            let app_info = std::process::Command::new("osascript")
                .arg("-e")
                .arg(script)
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .unwrap_or_default()
                .trim()
                .to_string();

            let parts: Vec<&str> = app_info.splitn(3, "||").collect();
            if parts.len() < 3 {
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
            let idle_script = r#"
                do shell script "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'"
            "#;
            let idle_secs: u64 = std::process::Command::new("osascript")
                .arg("-e")
                .arg(idle_script)
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0);

            let is_idle = idle_secs >= 120; // 2 minutes
            let now = chrono::Utc::now().to_rfc3339();
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
```

- [ ] **Step 3: Add chrono dependency to Cargo.toml**

Add to `[dependencies]` in `src-tauri/Cargo.toml`:

```toml
chrono = "0.4"
```

- [ ] **Step 4: Call spawn_screen_tracker in setup**

In the `setup` closure in `lib.rs`, after the autostart block and before `Ok(())`, add:

```rust
            // ── Screen activity tracker ───────────────────────────────────
            spawn_screen_tracker(app.handle().clone());
```

- [ ] **Step 5: Build and verify**

```bash
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
cd /Users/kreaddis-julien/Documents/Feuilles-de-temps && bun run build:tauri
```

Expected: successful build.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs
git commit -m "feat: add screen tracking thread with macOS AppleScript polling"
```

---

### Task 6: Tray Menu Toggles

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Read current tray menu construction in lib.rs**

Find the section where `MenuItem::with_id` and `Menu::with_items` are called.

- [ ] **Step 2: Add Tauri commands for toggle state**

Add two new commands before the `pub fn run()` function:

```rust
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
```

Register them in the `invoke_handler`:

```rust
.invoke_handler(tauri::generate_handler![
    set_tray_title,
    toggle_tray_popup,
    close_tray_popup,
    get_tracking_config,
    set_tracking_config,
])
```

- [ ] **Step 3: Add tracking toggles to tray context menu**

Replace the existing menu construction:

```rust
let open_i = MenuItem::with_id(app, "open", "Ouvrir", true, None::<&str>)?;
let quit_i = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
let menu = Menu::with_items(app, &[&open_i, &quit_i])?;
```

With:

```rust
use tauri::menu::PredefinedMenuItem;

let screen_label = "● Tracking écran";
let mic_label = "○ Tracking micro";
let screen_i = MenuItem::with_id(app, "toggle_screen", screen_label, true, None::<&str>)?;
let mic_i = MenuItem::with_id(app, "toggle_mic", mic_label, true, None::<&str>)?;
let sep = PredefinedMenuItem::separator(app)?;
let open_i = MenuItem::with_id(app, "open", "Ouvrir", true, None::<&str>)?;
let quit_i = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
let menu = Menu::with_items(app, &[&screen_i, &mic_i, &sep, &open_i, &quit_i])?;
```

- [ ] **Step 4: Handle toggle menu events**

In the `.on_menu_event()` handler, add cases for the new menu items:

```rust
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
            // Update menu item text
            if let Some(item) = app.get_menu_item("toggle_screen") {
                let label = if new_val { "● Tracking écran" } else { "○ Tracking écran" };
                let _ = item.set_text(label);
            }
        }
    }
}
"toggle_mic" => {
    // Mic toggle — grayed out for now (Phase 3)
    // Will be enabled when Ollama integration is added
}
```

- [ ] **Step 5: Initialize toggle labels from config at startup**

After building the tray, update the labels based on saved config. Add after the tray `.build(app)?;` line:

```rust
// Set initial toggle labels from saved config
{
    let client = reqwest::blocking::Client::new();
    if let Ok(resp) = client.get("http://localhost:3001/api/tracking/config/current").send() {
        if let Ok(config) = resp.json::<serde_json::Value>() {
            let screen_on = config["screenEnabled"].as_bool().unwrap_or(true);
            if let Some(item) = app.get_menu_item("toggle_screen") {
                let label = if screen_on { "● Tracking écran" } else { "○ Tracking écran" };
                let _ = item.set_text(label);
            }
        }
    }
}
```

- [ ] **Step 6: Build and verify**

```bash
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
cd /Users/kreaddis-julien/Documents/Feuilles-de-temps && bun run build:tauri
```

Expected: successful build.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add screen/mic tracking toggles in tray context menu"
```

---

### Task 7: Data Retention Cleanup

**Files:**
- Modify: `server/src/storage.ts`
- Modify: `server/src/app.ts`

- [ ] **Step 1: Add cleanup method to Storage**

Add to the Storage class:

```typescript
  async cleanupOldTracking(retentionDays: number = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    let deleted = 0;

    try {
      const files = await fs.readdir(this.dataDir);
      for (const file of files) {
        const match = file.match(/^activity-(\d{4}-\d{2}-\d{2})\.json$/);
        if (match && match[1] < cutoffStr) {
          await fs.unlink(path.join(this.dataDir, file));
          deleted++;
        }
      }
    } catch {
      // directory might not exist yet
    }

    return deleted;
  }
```

- [ ] **Step 2: Run cleanup at server startup**

In `server/src/app.ts`, after mounting all routes, add:

```typescript
  // Cleanup old tracking data on startup
  storage.cleanupOldTracking(30).then((n) => {
    if (n > 0) console.log(`Cleaned up ${n} old tracking file(s)`);
  });
```

- [ ] **Step 3: Run tests**

```bash
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
cd /Users/kreaddis-julien/Documents/Feuilles-de-temps/server && bunx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/src/storage.ts server/src/app.ts
git commit -m "feat: add automatic cleanup of tracking data older than 30 days"
```

---

### Task 8: Build, Install, and Verify End-to-End

- [ ] **Step 1: Run all server tests**

```bash
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
cd /Users/kreaddis-julien/Documents/Feuilles-de-temps/server && bunx vitest run
```

Expected: ALL PASS.

- [ ] **Step 2: TypeScript check**

```bash
cd /Users/kreaddis-julien/Documents/Feuilles-de-temps/client && npx tsc -b
```

Expected: no errors.

- [ ] **Step 3: Build Tauri app**

```bash
cd /Users/kreaddis-julien/Documents/Feuilles-de-temps && bun run build:tauri
```

Expected: successful build.

- [ ] **Step 4: Install and test**

```bash
bun run install:tauri
```

Verify:
- Right-click tray icon → see "● Tracking écran" and "○ Tracking micro" toggles
- Click "● Tracking écran" → toggles to "○ Tracking écran" (disabled)
- Click again → re-enables
- With tracking enabled, check `~/Library/Application Support/com.timesheet.tracker/activity-YYYY-MM-DD.json` after 30 seconds — should contain screen session data
- Switch between apps — new sessions should appear
- Open Chrome with a URL — the url field should be populated
- Leave Mac idle for 2+ minutes — idle period should be recorded
