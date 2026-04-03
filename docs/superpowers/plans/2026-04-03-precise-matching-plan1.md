# Precise Matching — Plan 1: Pipeline + Model Upgrade

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a reliable multi-source matching pipeline with ordered confidence levels, upgrade LLM to Qwen 3.5 27B, and fix gap detection to prevent sleep-merge bugs.

**Architecture:** Replace the current single-pass matching with an ordered pipeline: cmux mapping → Claude prompts → client domains → title matching. Each match has a confidence level. Gap detection prevents session merging across sleep/lock periods. Qwen 3.5 27B provides better instruction following for LLM analysis.

**Tech Stack:** TypeScript (Express), Rust (Tauri), Ollama (Qwen 3.5 27B)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/src/routes/report.ts` | Rewrite matching section | Pipeline couche 1 + couche 2 integration |
| `server/src/routes/tracking.ts` | Already fixed | Gap detection (30s threshold) already in place |
| `server/src/ollama.ts` | Modify | Update default model to qwen3.5:27b, use format:json |
| `server/src/types.ts` | Modify | Add confidence/source to SuggestedEntry |
| `client/src/types.ts` | Modify | Mirror server types |
| `client/src/pages/ReportPage.tsx` | Modify | Display confidence indicators |

---

### Task 1: Install Qwen 3.5 27B + update Ollama

- [ ] **Step 1: Update Ollama to 0.19**

```bash
brew upgrade ollama
```

- [ ] **Step 2: Pull Qwen 3.5 27B**

```bash
ollama pull qwen3.5:27b
```

This is ~17 GB, will take a few minutes.

- [ ] **Step 3: Remove old Qwen 2.5 14B**

```bash
ollama rm qwen2.5:14b
```

- [ ] **Step 4: Verify**

```bash
ollama list
```

Expected: `qwen3.5:27b` in the list.

---

### Task 2: Update ollama.ts for Qwen 3.5

**Files:**
- Modify: `server/src/ollama.ts`

- [ ] **Step 1: Read server/src/ollama.ts**

- [ ] **Step 2: Change default model**

Replace all occurrences of `model = 'qwen2.5:14b'` with `model = 'qwen3.5:27b'`.

- [ ] **Step 3: Add format:json to the generate call**

In the `generateWithLLM` function, add `format: 'json'` to the request body:

```typescript
body: JSON.stringify({
  model,
  prompt,
  stream: false,
  format: 'json',
  options: { temperature: 0.1 },
}),
```

This tells Ollama to guarantee valid JSON output.

- [ ] **Step 4: Run server tests**

```bash
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
cd server && bunx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add server/src/ollama.ts
git commit -m "feat: upgrade LLM to Qwen 3.5 27B with format:json"
```

---

### Task 3: Update types with confidence and source

**Files:**
- Modify: `server/src/types.ts`
- Modify: `client/src/types.ts`

- [ ] **Step 1: Update SuggestedEntry in server/src/types.ts**

Replace the existing SuggestedEntry interface:

```typescript
export interface SuggestedEntry {
  activityId: string;
  customerName?: string;
  description: string;
  totalMinutes: number;
  roundedMinutes: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'cmux' | 'claude' | 'domain' | 'calendar' | 'llm' | 'default';
  blockCount: number;
}
```

Also add to TrackingReport:

```typescript
export interface TrackingReport {
  date: string;
  generatedAt: string;
  status: 'pending' | 'validated';
  summary?: string;
  blocks: ReportBlock[];
  suggestedEntries: SuggestedEntry[];
  unmatched: UnmatchedBlock[];
  totalTrackedMinutes: number;
  aiEnhanced?: boolean;
  gaps?: { from: string; to: string; durationMinutes: number }[];
}
```

- [ ] **Step 2: Mirror changes in client/src/types.ts**

Both files must be identical.

- [ ] **Step 3: TypeScript check**

```bash
cd client && npx tsc -b
```

- [ ] **Step 4: Commit**

```bash
git add server/src/types.ts client/src/types.ts
git commit -m "feat: add confidence/source to SuggestedEntry, gaps to TrackingReport"
```

---

### Task 4: Refactor report.ts — Pipeline couche 1

**Files:**
- Modify: `server/src/routes/report.ts`

This is the core task. Rewrite the matching section of the `POST /:date/generate` route.

- [ ] **Step 1: Read the current report.ts to understand the full flow**

- [ ] **Step 2: Rewrite the matching pipeline**

After `const blocks = aggregateSessions(tracking.screenSessions);`, replace the entire matching logic up to the LLM call with this ordered pipeline:

```typescript
// ── COUCHE 1: Sources directes ──────────────────────────────

const config = await storage.loadTrackingConfig() as any;
const projectMap: Record<string, { activityId: string }> = config.projectMap || {};

const activitiesWithCustomer = activities.activities.map(a => {
  const c = customers.customers.find(c => c.id === a.customerId);
  return { id: a.id, name: a.name, customerName: c?.name ?? '' };
});

// Accumulate time per activityId with confidence tracking
const matched = new Map<string, {
  totalSecs: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'cmux' | 'claude' | 'domain' | 'calendar' | 'llm' | 'default';
  titles: Set<string>;
  customerName?: string;
}>();
const unmatchedBlocks: typeof blocks = [];

function addMatch(activityId: string, secs: number, confidence: 'high' | 'medium' | 'low', source: string, title?: string) {
  const existing = matched.get(activityId) || {
    totalSecs: 0,
    confidence,
    source: source as any,
    titles: new Set<string>(),
    customerName: activitiesWithCustomer.find(a => a.id === activityId)?.customerName,
  };
  existing.totalSecs += secs;
  // Keep highest confidence
  const confOrder = { high: 3, medium: 2, low: 1 };
  if (confOrder[confidence] > confOrder[existing.confidence]) {
    existing.confidence = confidence;
    existing.source = source as any;
  }
  if (title) existing.titles.add(title);
  matched.set(activityId, existing);
}

// 1.1 Match screen sessions
for (const b of blocks) {
  let wasMatched = false;

  // Extract project from brackets [project]
  const bracketMatch = b.title.match(/\[([^\]]+)\]/);
  const project = bracketMatch ? bracketMatch[1].trim() : null;

  // Priority 1: Project mapping from brackets (cmux)
  if (project && projectMap[project]) {
    addMatch(projectMap[project].activityId, b.totalSeconds, 'high', 'cmux', b.title);
    wasMatched = true;
  }

  // Priority 2: Client-specific domains (not internal ERP)
  if (!wasMatched && b.domain) {
    const domain = b.domain.toLowerCase();
    const isInternal = domain.includes('kreaddis.com');
    const isGeneric = domain.includes('google.com') || domain.includes('microsoft.com') || domain.includes('github.com');

    if (!isInternal && !isGeneric) {
      for (const customer of customers.customers) {
        if (domain.includes(customer.name.toLowerCase())) {
          const activity = activities.activities.find(a => a.customerId === customer.id);
          if (activity) {
            addMatch(activity.id, b.totalSeconds, 'high', 'domain', b.title);
            wasMatched = true;
            break;
          }
        }
      }
    }

    // Internal ERP → default to Interne
    if (!wasMatched && isInternal) {
      // Find "Interne" customer's default activity
      const interneCustomer = customers.customers.find(c => c.name.toLowerCase() === 'interne');
      if (interneCustomer) {
        const interneActivity = activities.activities.find(a => a.customerId === interneCustomer.id);
        if (interneActivity) {
          addMatch(interneActivity.id, b.totalSeconds, 'low', 'default', b.title);
          wasMatched = true;
        }
      }
    }
  }

  // Priority 3: Meet/Teams — match by title
  if (!wasMatched && b.domain && (b.domain.includes('meet.google.com') || b.domain.includes('teams.microsoft.com'))) {
    const titleLower = b.title.toLowerCase();
    for (const customer of customers.customers) {
      if (titleLower.includes(customer.name.toLowerCase())) {
        const activity = activities.activities.find(a => a.customerId === customer.id);
        if (activity) {
          addMatch(activity.id, b.totalSeconds, 'medium', 'calendar', b.title);
          wasMatched = true;
          break;
        }
      }
    }
  }

  if (!wasMatched && b.totalMinutes >= 1) {
    unmatchedBlocks.push(b);
  }
}

// 1.2 Add Claude Code prompt time
const claudeTimeByProject: Record<string, number> = {};
for (const p of (tracking.claudePrompts || []) as any[]) {
  if (p.project) {
    claudeTimeByProject[p.project] = (claudeTimeByProject[p.project] || 0) + 180; // 3 min per prompt in seconds
  }
}
for (const [project, secs] of Object.entries(claudeTimeByProject)) {
  if (projectMap[project]) {
    addMatch(projectMap[project].activityId, secs, 'high', 'claude');
  }
}

// Build suggested entries from matches
let suggestedEntries: SuggestedEntry[] = [];
for (const [activityId, data] of matched) {
  const totalMinutes = Math.round(data.totalSecs / 60);
  if (totalMinutes < 2) continue;
  suggestedEntries.push({
    activityId,
    customerName: data.customerName,
    description: '',
    totalMinutes,
    roundedMinutes: Math.max(15, Math.ceil(totalMinutes / 15) * 15),
    confidence: data.confidence,
    source: data.source,
    blockCount: data.titles.size,
  });
}

let unmatched = unmatchedBlocks;
```

- [ ] **Step 3: Detect and record gaps**

After the block aggregation, add gap detection:

```typescript
// Detect gaps (sleep/lock periods)
const gaps: { from: string; to: string; durationMinutes: number }[] = [];
const sortedSessions = [...tracking.screenSessions].sort((a, b) => a.from.localeCompare(b.from));
for (let i = 1; i < sortedSessions.length; i++) {
  const prevEnd = new Date(sortedSessions[i-1].until).getTime();
  const nextStart = new Date(sortedSessions[i].from).getTime();
  const gapMs = nextStart - prevEnd;
  if (gapMs > 5 * 60 * 1000) { // > 5 minutes
    gaps.push({
      from: sortedSessions[i-1].until,
      to: sortedSessions[i].from,
      durationMinutes: Math.round(gapMs / 60000),
    });
  }
}
```

Include `gaps` in the report object.

- [ ] **Step 4: Keep the LLM call for couche 2 (unmatched blocks + descriptions)**

The existing LLM call stays but only receives `unmatched` blocks. Keep the dedicated description call.

- [ ] **Step 5: Update the report object to include gaps**

```typescript
const report = {
  // ... existing fields
  gaps,
};
```

- [ ] **Step 6: Run tests + TypeScript check**

```bash
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
cd server && bunx vitest run
cd ../client && npx tsc -b
```

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/report.ts
git commit -m "feat: implement couche 1 matching pipeline with confidence levels"
```

---

### Task 5: Display confidence in Report page

**Files:**
- Modify: `client/src/pages/ReportPage.tsx`

- [ ] **Step 1: Add confidence indicator to each suggested entry card**

In the header of each suggested entry (where the activity name is shown), add a colored dot:

```tsx
<div className="flex items-center gap-2">
  <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${
    entry.confidence === 'high' ? 'bg-green-500' :
    entry.confidence === 'medium' ? 'bg-yellow-500' : 'bg-red-400'
  }`} title={`Confiance ${entry.confidence} — source: ${entry.source}`} />
  <span className="font-medium text-sm">{activityLabel(entry.activityId)}</span>
</div>
```

- [ ] **Step 2: Display gaps in the report**

After the summary card, if there are gaps, show them:

```tsx
{report.gaps && report.gaps.length > 0 && (
  <div className="flex flex-wrap gap-2">
    {report.gaps.map((g, i) => (
      <span key={i} className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground">
        ⏸ {new Date(g.from).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})} → {new Date(g.to).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})} ({g.durationMinutes}min)
      </span>
    ))}
  </div>
)}
```

- [ ] **Step 3: TypeScript check**

```bash
cd client && npx tsc -b
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ReportPage.tsx
git commit -m "feat: display confidence indicators and gaps in Report page"
```

---

### Task 6: Build, install, and verify

- [ ] **Step 1: Run all server tests**

```bash
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
cd server && bunx vitest run
```

- [ ] **Step 2: TypeScript check**

```bash
cd client && npx tsc -b
```

- [ ] **Step 3: Build Tauri app**

```bash
cd /Users/kreaddis-julien/Documents/Feuilles-de-temps && bun run build:tauri
```

- [ ] **Step 4: Install and test**

```bash
bun run install:tauri
```

Verify:
- Generate report for 2026-04-03 → entries have colored confidence dots
- cmux sessions → green (high, cmux source)
- Chrome gemaddis-erp.odoo.com → green (high, domain source)
- Chrome kreaddis.com → red (low, default → Interne)
- Meet sessions → yellow (medium, calendar source)
- Gaps visible (e.g., lunch break 11:54 → 13:20)
- No more 95 min sleep-merge sessions
