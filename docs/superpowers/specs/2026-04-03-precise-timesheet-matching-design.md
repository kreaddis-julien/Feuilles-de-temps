# Precise Timesheet Matching — Design Spec

## Purpose

Improve the accuracy of automatic timesheet report generation in Tempo by implementing a multi-layered matching pipeline, integrating Google Calendar, upgrading to Qwen 3.5 27B, and adding split/confidence UI controls. The goal is a report that requires only 2-3 minutes of user correction each morning.

## Current Problems

1. **Time ≠ work**: screen left open during breaks counts as work (95 min Alti-Dsi during lunch)
2. **Wrong client matching**: titles on internal ERP (kreaddis.com) contain client names that don't represent actual work
3. **Meet/Teams poorly matched**: meeting titles like "Point GemAi" don't match client name "GemAddis"
4. **Audio not integrated**: 30 min support call with Jocelyn not counted
5. **LLM hallucinations**: Qwen 2.5 14B invents IDs, descriptions, fake clients

## Architecture

```
Screen sessions ─┐
Claude prompts  ─┤
Calendar events ─┤──→ [Couche 1: Sources directes] ──→ Matched entries (confiance haute)
Client domains  ─┤                                        │
                 │                                        ▼
                 └──→ Unmatched blocks ──→ [Couche 2: LLM Qwen 3.5 27B] ──→ More matches (confiance moyenne)
                                                          │
Audio transcripts ──→ Context for LLM                     ▼
                                              [Couche 3: UI Validation]
                                              ├─ Confidence indicators
                                              ├─ Split button
                                              └─ Gap detection display
```

## Couche 1: Sources directes (no LLM)

Matching order — first match wins:

### 1.1 Répertoire cmux → project mapping (confiance: haute)
- Session cmux with `[project]` in title → lookup `trackingConfig.projectMap` → activityId
- Already implemented, works well when mapping exists

### 1.2 Prompts Claude Code → project mapping (confiance: haute)
- Each prompt has a `project` field → same lookup as 1.1
- Estimate 3 min per prompt as active work time
- Creates virtual blocks for projects without screen sessions

### 1.3 Client-specific domains (confiance: haute)
- Any `.odoo.com` or `.odoo.sh` domain containing a client name → that client
- Pattern: `{client}*.odoo.com`, `{client}*.dev.odoo.com`
- **Exclude** `kreaddis.com` — internal ERP, always mapped to "Interne"
- **Exclude** generic domains: `google.com`, `microsoft.com`, `github.com`

### 1.4 Google Calendar events (confiance: moyenne-haute)
- At report generation time, call MCP Google Calendar to fetch the day's events
- Each event: extract title, start time, end time
- Match event title against client names (with alias support)
- Matched events create "calendar blocks" attributed to the client
- Overlapping screen sessions during a calendar event inherit the event's client if unmatched
- Audio segments during a calendar event are attributed to the event's client

### 1.5 Default rules
- All time on `kreaddis.com` → "Interne" (never match by page title)
- `meet.google.com` / `teams.microsoft.com` → match by meeting title against clients
- `timesheet` app → "Interne"

## Gap Detection

In the screen session deduplication endpoint (`POST /tracking/:date/screen`):
- If gap between last `until` and new `from` is **> 30 seconds** → create new session
- Prevents sleep/lock periods from being merged into one giant session
- Visible in the report UI as "⏸ Pause HH:MM → HH:MM (duration)"

## Couche 2: LLM (Qwen 3.5 27B)

### Model upgrade
- Replace Qwen 2.5 14B with **Qwen 3.5 27B** (~17 GB RAM)
- IFEval score: 95% (vs 85% for 2.5 14B) — much better instruction following
- Ollama 0.19 with MLX backend for Apple Silicon acceleration
- `format: "json"` parameter for guaranteed valid JSON output

### What the LLM receives
- Unmatched blocks from couche 1 (app, title, domain, duration)
- Already matched blocks (for context)
- Audio transcriptions
- Claude Code prompts
- Calendar events of the day
- Project mapping
- Recent validated timesheets (last 7 days, for style learning)

### What the LLM does
- Match remaining unmatched blocks by crossing all sources
- Generate day summary
- Generate descriptions for ALL entries (matched + newly matched) via dedicated plain-text call

### What the LLM does NOT do
- Modify couche 1 matches (except descriptions)
- Invent time that doesn't exist in tracking data
- Use activityIds not present in the system (validated server-side)

### Client aliases
- Stored in `trackingConfig.clientAliases`: `{"gemai": "GemAddis", "kréatys": "KreAddis"}`
- Used by both couche 1 (calendar matching) and couche 2 (LLM matching)
- Learnable: when user corrects a match in the UI, an alias is created

## Couche 3: UI de validation

### Confidence indicators
Each suggested entry shows a colored indicator:
- 🟢 **Haute** — matched by cmux/prompts/client domain (couche 1)
- 🟡 **Moyenne** — matched by calendar or LLM (couche 2)  
- 🔴 **Basse** — unmatched time on kreaddis.com, defaulted to Interne

### Split button
- Available on every suggested entry
- Click → entry splits into two rows with the same total duration
- Each row has its own activity selector and duration field
- Can split multiple times (e.g., 2h → 30min + 30min + 1h)
- Duration fields update proportionally or manually

### Gap detection display
- Detected pauses (sleep, screen lock, gap > 30s between sessions) shown in timeline
- Format: "⏸ Pause 11:54 → 13:20 (1h26)"
- Not counted in total tracked time

### kreaddis.com time
- Displayed as "Interne (ERP)" with 🔴 confidence
- Splittable to any client
- Tooltip: "Temps sur l'ERP interne — splitter si attribuable à un client"

## Data Model Changes

### TrackingConfig additions
```typescript
export interface TrackingConfig {
  screenEnabled: boolean;
  micEnabled: boolean;
  projectMap?: Record<string, { activityId: string }>;
  clientAliases?: Record<string, string>; // NEW: "gemai" → "GemAddis"
}
```

### SuggestedEntry additions
```typescript
export interface SuggestedEntry {
  activityId: string;
  customerName?: string;
  description: string;
  totalMinutes: number;
  roundedMinutes: number;
  confidence: 'high' | 'medium' | 'low'; // NEW
  source: 'cmux' | 'claude' | 'domain' | 'calendar' | 'llm' | 'default'; // NEW
  blockCount: number;
}
```

### TrackingReport additions
```typescript
export interface TrackingReport {
  // ... existing fields
  calendarEvents?: CalendarEvent[]; // NEW
  gaps?: { from: string; to: string; durationMinutes: number }[]; // NEW
}

export interface CalendarEvent { // NEW
  title: string;
  start: string;
  end: string;
  matchedActivityId?: string;
  matchedCustomerName?: string;
}
```

## Implementation Order

1. **Gap detection** in session deduplication (fix the 95 min sleep bug)
2. **Upgrade to Qwen 3.5 27B** via Ollama
3. **Couche 1 pipeline** refactor (ordered matching with confidence)
4. **Google Calendar integration** via MCP
5. **Client aliases** storage and matching
6. **Couche 2 LLM** improvements (use Qwen 3.5, format: json)
7. **UI: confidence indicators** on report entries
8. **UI: split button** on report entries
9. **UI: gap display** in report timeline
10. **kreaddis.com → Interne** default rule

## Out of Scope

- Keyboard/mouse tracking (future improvement)
- Bidirectional calendar sync
- Automatic Odoo export
- Multi-user support
