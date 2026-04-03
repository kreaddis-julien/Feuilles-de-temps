const OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3.5:9b-q8_0';

export interface OllamaStatus {
  available: boolean;
  models: string[];
}

export async function checkOllama(): Promise<OllamaStatus> {
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!resp.ok) return { available: false, models: [] };
    const data = await resp.json() as { models: { name: string }[] };
    return {
      available: true,
      models: data.models.map(m => m.name),
    };
  } catch {
    return { available: false, models: [] };
  }
}

// Low-level chat call — all LLM interactions go through here
async function chat(system: string, user: string, options?: { temperature?: number; num_predict?: number; unload?: boolean }): Promise<string> {
  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      think: false,
      stream: false,
      ...(options?.unload ? { keep_alive: 0 } : {}),
      options: {
        num_ctx: 8192,
        num_predict: options?.num_predict ?? 2048,
        temperature: options?.temperature ?? 0.3,
        top_p: 0.95,
      },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Ollama error: ${resp.status}`);
  }

  const data = await resp.json() as { message: { content: string } };
  return data.message.content;
}

function parseJSON<T>(content: string, fallback: T): T {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    console.log('[ollama] Failed to parse JSON:', content.slice(0, 200));
    return fallback;
  }
}

// ── Chain Step 1: Summarize dev work ──────────────────────────

export interface DevContext {
  projectSummaries: { project: string; activityLabel: string; summary: string }[];
}

export async function summarizeDevWork(input: {
  claudePrompts: { time: string; project: string; prompt: string; gitBranch?: string; gitLastCommit?: string }[];
  projectMappings: { project: string; activityId: string; label: string }[];
}): Promise<DevContext> {
  if (!input.claudePrompts.length) return { projectSummaries: [] };

  // Group prompts by project, filter noise
  const byProject: Record<string, { prompts: string[]; branches: Set<string>; commits: Set<string> }> = {};
  for (const p of input.claudePrompts) {
    if (!p.project || p.prompt.length < 15) continue;
    if (/^(ok|oui|non|je|on |c'est|&)/i.test(p.prompt.trim())) continue;
    if (!byProject[p.project]) byProject[p.project] = { prompts: [], branches: new Set(), commits: new Set() };
    byProject[p.project].prompts.push(`[${p.time}] ${p.prompt.slice(0, 100)}`);
    if (p.gitBranch) byProject[p.project].branches.add(p.gitBranch);
    if (p.gitLastCommit) byProject[p.project].commits.add(p.gitLastCommit);
  }

  const projectLines = Object.entries(byProject).map(([proj, data]) => {
    const mapping = input.projectMappings.find(m => m.project === proj);
    const label = mapping ? mapping.label : proj;
    const gitInfo = [
      data.branches.size ? `Branches: ${[...data.branches].join(', ')}` : '',
      data.commits.size ? `Commits: ${[...data.commits].slice(0, 5).join('; ')}` : '',
    ].filter(Boolean).join('\n  ');
    return `Projet "${proj}" (${label}) :\n${gitInfo ? `  ${gitInfo}\n` : ''}${data.prompts.slice(0, 10).map(p => `  ${p}`).join('\n')}`;
  }).join('\n\n');

  if (!projectLines) return { projectSummaries: [] };

  const result = await chat(
    `Tu résumes le travail de développement d'un développeur Odoo à partir de ses prompts Claude Code.
Pour chaque projet, écris 1-2 phrases décrivant ce qui a été fait concrètement (pas les prompts eux-mêmes).
Réponds UNIQUEMENT en JSON. Format: {"projects":[{"project":"nom","summary":"résumé concret"}]}`,
    projectLines,
  );

  const parsed = parseJSON<{ projects: { project: string; summary: string }[] }>(result, { projects: [] });
  return {
    projectSummaries: parsed.projects.map(p => {
      const mapping = input.projectMappings.find(m => m.project === p.project);
      return { project: p.project, activityLabel: mapping?.label ?? p.project, summary: p.summary };
    }),
  };
}

// ── Chain Step 2: Match unmatched blocks ──────────────────────

export interface LLMSuggestedEntry {
  activityId: string;
  description: string;
  totalMinutes: number;
}

export async function matchUnmatchedBlocks(input: {
  date: string;
  unmatched: { app: string; title: string; domain?: string; totalMinutes: number }[];
  activities: { id: string; name: string; customerName: string }[];
  devContext: DevContext;
  projectMappings: { project: string; activityId: string; label: string }[];
}): Promise<{ summary: string; suggestions: LLMSuggestedEntry[] }> {
  if (!input.unmatched.length) return { summary: '', suggestions: [] };

  const activitiesList = input.activities
    .map(a => `- ID: "${a.id}" → ${a.customerName} - ${a.name}`)
    .join('\n');

  const unmatchedList = input.unmatched
    .map(b => `- ${b.app} | ${b.title} ${b.domain ? `(${b.domain})` : ''} | ${b.totalMinutes}min`)
    .join('\n');

  const devSection = input.devContext.projectSummaries.length
    ? `\nCONTEXTE DEV (résumé du travail de la journée) :\n${input.devContext.projectSummaries.map(p => `- ${p.activityLabel} : ${p.summary}`).join('\n')}\n`
    : '';

  const mappingSection = input.projectMappings.length
    ? `\nMAPPING RÉPERTOIRES → ACTIVITÉS :\n${input.projectMappings.map(m => `- "${m.project}" → "${m.activityId}" (${m.label})`).join('\n')}\n`
    : '';

  const result = await chat(
    `Tu analyses des feuilles de temps pour une société de services informatiques.

RÈGLES :
- activityId DOIT être un ID de la liste. Si inconnu, mets "".
- N'invente PAS de données. Utilise uniquement les blocs fournis.
- Analyse chaque bloc individuellement, ne mets pas tout sur le même client.
- "summary" résume la journée en 2-3 phrases.
- "suggestions" contient les blocs que tu as pu identifier.

Réponds UNIQUEMENT en JSON valide.
Format: {"summary":"...","suggestions":[{"activityId":"...","description":"...","totalMinutes":0}]}`,
    `ACTIVITÉS DISPONIBLES :\n${activitiesList}\n\nBLOCS NON IDENTIFIÉS DU ${input.date} :\n${unmatchedList}\n${devSection}${mappingSection}\nAnalyse et retourne le JSON.`,
  );

  const parsed = parseJSON<{ summary: string; suggestions: LLMSuggestedEntry[] }>(result, { summary: '', suggestions: [] });
  return {
    summary: parsed.summary || '',
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
  };
}

// ── Chain Step 3: Generate descriptions ──────────────────────

export async function generateDescriptions(input: {
  entries: { activityLabel: string; totalMinutes: number; context: string }[];
  styleProfile?: string;
}): Promise<string[]> {
  if (!input.entries.length) return [];

  const lines = input.entries.map((e, i) =>
    `${i + 1}. ${e.activityLabel} (${e.totalMinutes}min) : ${e.context}`
  );

  const styleSection = input.styleProfile
    ? `\nSTYLE DE L'UTILISATEUR :\n${input.styleProfile}\n`
    : '';

  const result = await chat(
    `Tu écris des descriptions courtes et professionnelles pour des feuilles de temps.
Une description par ligne, pas de numérotation.
NE COPIE PAS les titres de fenêtres ou noms de fichiers. Décris l'activité métier.${styleSection}`,
    lines.join('\n'),
    { temperature: 0.6, unload: true },
  );

  return result.trim().split('\n')
    .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter(l => l.length > 3);
}

// ── Legacy wrapper (used by report.ts description endpoint) ──

export async function generateWithLLM(prompt: string): Promise<string> {
  return chat(
    'Tu es un assistant concis qui répond directement sans explication superflue.',
    prompt,
    { temperature: 0.6, unload: true },
  );
}
