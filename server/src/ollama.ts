const OLLAMA_URL = 'http://localhost:11434';

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

// Chat-based LLM call (Qwen 3.5 requires /api/chat, not /api/generate)
// think: false for fast plain-text responses (descriptions)
export async function generateWithLLM(prompt: string, model = 'qwen3.5:9b-q8_0'): Promise<string> {
  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Tu es un assistant concis qui répond directement sans explication superflue.' },
        { role: 'user', content: prompt },
      ],
      think: false,
      stream: false,
      options: {
        num_ctx: 8192,
        num_predict: 2048,
        temperature: 0.6,
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

export interface LLMReportInput {
  date: string;
  blocks: { app: string; title: string; domain?: string; totalMinutes: number; activityId?: string }[];
  unmatched: { app: string; title: string; domain?: string; totalMinutes: number }[];
  activities: { id: string; name: string; customerName: string }[];
  audioTranscripts?: { time: string; text: string }[];
  claudePrompts?: { time: string; project: string; prompt: string }[];
  projectMappings?: { project: string; activityId: string; label: string }[];
  recentTimesheets?: { date: string; activityId: string; activityLabel: string; description: string; minutes: number }[];
}

export interface LLMSuggestedEntry {
  activityId: string;
  description: string;
  totalMinutes: number;
}

// JSON analysis call: think: true + format schema (required for reliable JSON with Qwen 3.5)
export async function analyzeReport(input: LLMReportInput, model = 'qwen3.5:9b-q8_0'): Promise<{
  summary: string;
  suggestions: LLMSuggestedEntry[];
}> {
  const activitiesList = input.activities
    .map(a => `- ID: "${a.id}" → ${a.customerName} - ${a.name}`)
    .join('\n');

  const unmatchedList = input.unmatched
    .map(b => `- ${b.app} | ${b.title} ${b.domain ? `(${b.domain})` : ''} | ${b.totalMinutes}min`)
    .join('\n');

  const audioSection = input.audioTranscripts?.length
    ? `\nTRANSCRIPTIONS AUDIO (micro, conversations captées) :\n${input.audioTranscripts.map(a => `- [${a.time}] ${a.text}`).join('\n')}\n`
    : '';

  const mappingSection = input.projectMappings?.length
    ? `\nMAPPING RÉPERTOIRES → ACTIVITÉS :\n${input.projectMappings.map(m => `- Répertoire "${m.project}" → activityId "${m.activityId}" (${m.label})`).join('\n')}\n`
    : '';

  const claudeSection = input.claudePrompts?.length
    ? `\nPROMPTS CLAUDE CODE :\n${input.claudePrompts.map(c => `- [${c.time}] projet: ${c.project} | "${c.prompt.slice(0, 150)}"`).join('\n')}\n`
    : '';

  const historySection = input.recentTimesheets?.length
    ? `\nTIMESHEETS RÉCENTS (style à imiter) :\n${input.recentTimesheets.map(t => `- [${t.date}] ${t.activityLabel} | "${t.description}" | ${t.minutes}min`).join('\n')}\n`
    : '';

  const systemPrompt = `Tu es un assistant d'analyse de feuilles de temps pour une société de services informatiques (développement Odoo, support, gestion de projet).

Tu reçois des blocs d'activité écran non identifiés et tu dois les associer aux bonnes activités.

RÈGLES STRICTES :
- activityId DOIT être un ID de la liste fournie. Si tu ne sais pas, mets "".
- N'invente PAS de données ou de temps qui n'existent pas dans l'entrée.
- NE COPIE PAS les titres de fenêtres dans les descriptions. Écris ce que la personne faisait.
- Ne mets PAS tout dans le même client. Analyse chaque bloc individuellement.
- Le champ "summary" résume la journée en 2-3 phrases en français.
- Le champ "suggestions" contient uniquement les blocs que tu as pu identifier.

Réponds UNIQUEMENT avec un JSON valide. Aucun texte, aucun markdown, juste le JSON.
Format: {"summary":"...","suggestions":[{"activityId":"...","description":"...","totalMinutes":0}]}`;

  const userPrompt = `ACTIVITÉS DISPONIBLES :
${activitiesList}

BLOCS NON IDENTIFIÉS DU ${input.date} :
${unmatchedList}
${mappingSection}${audioSection}${claudeSection}${historySection}
Analyse ces blocs et retourne le JSON.`;

  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      think: false,
      stream: false,
      options: {
        num_ctx: 8192,
        num_predict: 2048,
        temperature: 0.3,
        top_p: 0.95,
      },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Ollama error: ${resp.status}`);
  }

  const data = await resp.json() as { message: { content: string } };
  const content = data.message.content;

  try {
    const parsed = JSON.parse(content);
    return {
      summary: parsed.summary || '',
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    };
  } catch {
    // Fallback: try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || '',
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        };
      } catch { /* fall through */ }
    }
    console.log('[ollama] Failed to parse JSON:', content.slice(0, 200));
    return { summary: '', suggestions: [] };
  }
}
