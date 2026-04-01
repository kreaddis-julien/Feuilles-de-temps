# Activity Tracking & Daily Report — Design Spec

## Purpose

Automatically track what the user works on throughout the day (screen activity + optional microphone) and generate a daily report the next morning with pre-filled timesheet proposals. The goal is to maximize billable time capture for Odoo timesheet reporting without manual tracking.

## Architecture

```
┌─────────────────── Tempo (Tauri) ───────────────────┐
│                                                       │
│  [Rust - lib.rs]                                      │
│    ├─ Screen tracker (thread) ──→ poll 5s             │
│    └─ Audio capture (thread) ──→ chunks 30s           │
│                                                       │
│  [Sidecar - Express]                                  │
│    ├─ /api/tracking/* ──→ store/query raw data         │
│    ├─ /api/report/* ──→ generate/serve reports         │
│    └─ Storage: activity-YYYY-MM-DD.json               │
│                                                       │
│  [Ollama - localhost:11434] (optional)                 │
│    ├─ whisper ──→ audio transcription                  │
│    └─ llama3.1/mistral ──→ analysis + report           │
│                                                       │
│  [Frontend - React]                                   │
│    ├─ Tray: 2 toggles (screen / mic) in context menu  │
│    ├─ "Rapport" page in navbar                         │
│    └─ Morning popup: report + timesheet validation     │
└───────────────────────────────────────────────────────┘
```

## Screen Tracking

**Mechanism:** A dedicated Rust thread polls every 5 seconds using macOS APIs:
- `NSWorkspace.shared.frontmostApplication` for the active app name and bundle ID
- AppleScript for the window title (works for all apps)
- AppleScript for browser URL (Chrome and Safari only)
- Idle detection via `CGEventSourceSecondsSinceLastEventType` (mouse/keyboard inactivity)

**Deduplication:** If app + title + url haven't changed since the last poll, don't write a new entry — just update the `until` timestamp on the current session. This reduces ~5760 raw polls/day to ~50-200 session entries.

**Data stored per session:**
```json
{
  "from": "2026-04-01T09:00:00.000Z",
  "until": "2026-04-01T10:28:00.000Z",
  "app": "Google Chrome",
  "bundleId": "com.google.Chrome",
  "title": "Ticket #312 - GemAddis - Odoo",
  "url": "https://gemaddis.odoo.com/web#id=312"
}
```

**Idle threshold:** 2 minutes of no mouse/keyboard input = idle. Idle periods are stored separately.

**Toggle:** Controlled via tray context menu (right-click). State persisted. Default: ON at first launch.

**No external dependencies** — screen tracking works without Ollama.

## Audio Tracking (Microphone)

**Mechanism:** A dedicated Rust thread captures audio from the default input device using macOS Core Audio APIs. Audio is buffered in 30-second chunks.

**Processing pipeline per chunk:**
1. Capture 30s of audio (PCM/WAV in memory)
2. Check for speech (simple energy/amplitude threshold — if silence, discard)
3. If speech detected, send to Ollama Whisper endpoint
4. Store transcript text, discard audio buffer
5. Never write audio to disk

**Data stored per segment with speech:**
```json
{
  "timestamp": "2026-04-01T09:15:30.000Z",
  "duration": 30,
  "transcript": "je suis en train de regarder le ticket 312 avec Pierre",
  "hasSpeech": true
}
```

**Resource usage:** Whisper "small" on Apple Silicon: ~5-8% CPU continuous. ~30-45 min battery impact over 8h.

**Toggle:** Independent toggle in tray context menu. Default: OFF. Grayed out if Ollama unavailable or whisper model not pulled.

**macOS permissions:** Microphone permission requested by OS on first toggle ON.

**Requires:** Ollama running + whisper model pulled.

## Inactivity Detection & Scenarios

The app combines screen idle state + audio detection to understand what the user is doing:

| Screen | Audio | Interpretation | Report treatment |
|--------|-------|---------------|-----------------|
| Active (mouse/keyboard) | Any | Working on what's on screen | Normal tracking |
| Idle (<5 min) | Speech detected | Interrupted — discussing something else | "Discussion (écran inactif, audio détecté)" + transcript for context |
| Idle (<5 min) | Silence | Reading/thinking or brief pause | "À clarifier" — user decides in report, with last active app shown as context |
| Idle (>5 min) | Silence | Absent (break, away from desk) | Excluded from working time |
| Idle (>5 min) | Speech detected | Long discussion away from computer | "Discussion prolongée" |
| Mac asleep/locked | N/A | Absent — tracking threads suspended by macOS | Gap in data = absent |

**Key:** The user does NOT need to manually lock or sleep the Mac. The combination of idle + silence reliably detects absence. Audio provides the missing context for interruptions.

## Daily Report Generation

**Trigger:** At app launch, if:
1. Activity data exists for the previous day
2. No report has been generated for that day yet

**Two modes:**

### Basic mode (without Ollama LLM)
Simple aggregation of screen sessions — time per app, per window title, grouped by matching rules. No audio analysis, no AI summary. Still useful as an activity breakdown.

### Full AI mode (with Ollama LLM)
1. Load previous day's tracking data
2. Load user's clients and activities from Tempo
3. Load matching rules
4. **Phase 1 — Rule-based matching:** Apply pattern rules to screen sessions. Handles ~90% of cases.
5. **Phase 2 — LLM analysis:** Send unmatched sessions + audio transcripts + client/activity list to LLM. It:
   - Matches remaining sessions to clients/activities
   - Merges screen + audio context (e.g., screen shows VS Code but audio says "discussing GemAddis ticket")
   - Handles inactivity scenarios (idle + audio = discussion, idle + silence = à clarifier)
   - Generates timeline summary
   - Proposes timesheet entries with durations rounded to 15 minutes

**Report structure:**
```json
{
  "date": "2026-04-01",
  "generatedAt": "2026-04-02T08:30:00.000Z",
  "summary": "Journée principalement sur GemAddis (support) avec dev interne Tempo l'après-midi",
  "timeline": [
    {
      "from": "09:00",
      "to": "10:30",
      "description": "Support GemAddis - Ticket #312, problème de facturation",
      "sources": ["screen: Chrome - gemaddis.odoo.com", "audio: discussion ticket 312 avec Pierre"],
      "matchedActivityId": "act-gemaddis-odoo",
      "confidence": 0.9
    },
    {
      "from": "14:00",
      "to": "14:20",
      "type": "clarify",
      "description": "Écran inactif, pas d'audio — lecture/réflexion ou pause ?",
      "lastActiveApp": "VS Code",
      "lastActiveTitle": "feuilles-de-temps - lib.rs"
    }
  ],
  "suggestedEntries": [
    {
      "activityId": "act-gemaddis-odoo",
      "description": "Ticket #312 - Correction facturation",
      "totalMinutes": 90,
      "roundedMinutes": 90,
      "confidence": 0.9
    }
  ],
  "unmatched": [
    {
      "from": "14:00",
      "to": "14:20",
      "description": "Discussion non identifiée (audio uniquement, écran inactif)",
      "totalMinutes": 20
    }
  ],
  "toClarify": [
    {
      "from": "16:00",
      "to": "16:12",
      "description": "Inactif sans audio — dernière app: VS Code (feuilles-de-temps)",
      "totalMinutes": 12
    }
  ],
  "status": "pending"
}
```

**Report status:** `pending` → `validated` after user reviews.

## Matching Rules

Stored in `tracking-rules.json`:
```json
{
  "rules": [
    {
      "id": "rule-1",
      "pattern": "gemaddis.odoo.com",
      "matchType": "url_contains",
      "activityId": "act-gemaddis-odoo",
      "source": "auto"
    },
    {
      "id": "rule-2",
      "pattern": "VS Code - feuilles-de-temps",
      "matchType": "title_contains",
      "activityId": "act-kreaddis-dev",
      "source": "user_correction"
    }
  ]
}
```

**Match types:** `url_contains`, `title_contains`, `app_equals`, `title_regex`

**Learning from corrections:** When the user assigns an unmatched block to an activity in the report UI, a new rule is created with `source: "user_correction"`. Next time a similar title/URL appears, it's matched automatically.

## Storage

**File per day:** `activity-YYYY-MM-DD.json` containing:
- `screenSessions[]` — deduplicated screen activity
- `audioSegments[]` — transcribed audio chunks
- `idlePeriods[]` — detected idle periods
- `trackingConfig` — toggle states for that day
- `report` — generated report (null until generated)

**Size estimate:** ~600 Ko/day (500 Ko screen + 100 Ko audio transcripts).

**Retention:** 30 days configurable, auto-cleanup at app launch. Validated reports can optionally be kept longer (just the report JSON, not raw tracking data).

## Tray Integration

**Context menu (right-click) additions:**
```
┌──────────────────────────────┐
│ ● Tracking écran         [ON]│
│ ● Tracking micro        [OFF]│
│ ────────────────────────────│
│ Ouvrir                      │
│ Quitter                     │
└──────────────────────────────┘
```

- Toggle states persisted in `tracking-config.json`
- Default: screen ON, mic OFF
- Mic toggle grayed out with tooltip "Nécessite Ollama" if Ollama unavailable
- Visual indicator when mic is active (colored dot on tray icon or mic symbol in tray title)

## Frontend — Report Page

**New navbar tab:** "Rapport" between "Stats" and "Paramètres".

**List view:** Days with available reports, most recent first. Badge for pending reports count.

**Detail view (click on a day):**
- Summary text (collapsible)
- Timeline (collapsed by default, expandable)
- Suggested timesheet entries: Validate / Edit / Delete per line
- "À clarifier" blocks: user assigns to an activity or marks as break/personal
- Unmatched blocks: activity selector dropdown
- "Tout valider" button creates all entries in Tempo

**Validation action:** Creates completed `TimesheetEntry` records in the corresponding day's timesheet data. Entries appear in TrackerPage like manually created ones.

## Frontend — Morning Popup

**Trigger:** After report generation, a modal opens automatically.

**Content:** Same as report detail view, in a Dialog.

**Actions:**
- "Tout valider" → creates entries, closes popup, marks report as validated
- "Plus tard" → closes popup, reopens at next app launch
- Individual entry validation/edit/delete

## Settings Page — Tracking Section

New section in existing Settings page:

- **Ollama status:** Connected / Not found (with install instructions)
- **Models:** Available models, pull status
- **Storage:** Disk space used by tracking data
- **Retention:** Configurable days (default 30), purge button
- **LLM model choice:** Dropdown for report generation model
- **Matching rules:** List with edit/delete

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /api/tracking/:date/screen` | POST | Append/update screen session |
| `POST /api/tracking/:date/audio` | POST | Append audio segment |
| `GET /api/tracking/:date` | GET | Get full tracking data for a day |
| `POST /api/report/:date/generate` | POST | Trigger report generation |
| `GET /api/report/:date` | GET | Get report for a day |
| `POST /api/report/:date/validate` | POST | Validate report → create timesheet entries |
| `GET /api/report/pending` | GET | List dates with pending reports |
| `GET /api/tracking/rules` | GET | Get matching rules |
| `POST /api/tracking/rules` | POST | Create/update matching rule |
| `DELETE /api/tracking/rules/:id` | DELETE | Delete matching rule |
| `GET /api/tracking/config` | GET | Get tracking toggle states |
| `PUT /api/tracking/config` | PUT | Update tracking toggle states |
| `GET /api/tracking/ollama-status` | GET | Check Ollama availability and models |

## Graceful Degradation

| Ollama state | Screen tracking | Mic tracking | Report |
|-------------|----------------|--------------|--------|
| Not installed | Works | Disabled (grayed) | Basic aggregation only |
| Running, no whisper | Works | Disabled (grayed) | Basic aggregation only |
| Running, whisper only | Works | Works | Basic aggregation only |
| Running, whisper + LLM | Works | Works | Full AI report |

## Out of Scope (for now)

- Direct Odoo XML-RPC integration (export remains CSV-based)
- Multi-device tracking
- Screenshot capture
- Keylogging or content analysis
- Cloud sync of tracking data
- Real-time activity categorization (LLM runs once per day only)
