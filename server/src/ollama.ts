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

export async function generateWithLLM(prompt: string, model = 'qwen3.5:9b', format?: 'json'): Promise<string> {
  const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: `/no_think\n${prompt}`,
      stream: false,
      ...(format ? { format } : {}),
      options: { temperature: 0.1 },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Ollama error: ${resp.status}`);
  }

  const data = await resp.json() as { response: string };
  return data.response;
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

export async function analyzeReport(input: LLMReportInput, model = 'qwen3.5:9b'): Promise<{
  summary: string;
  suggestions: LLMSuggestedEntry[];
}> {
  const activitiesList = input.activities
    .map(a => `- ID: "${a.id}" → ${a.customerName} - ${a.name}`)
    .join('\n');

  const blocksList = input.blocks
    .filter(b => b.totalMinutes >= 1)
    .map(b => `- [activityId: "${b.activityId || ''}"] ${b.app} | titres fenêtres: ${b.title} | ${b.totalMinutes}min`)
    .join('\n');

  const unmatchedList = input.unmatched
    .map(b => `- ${b.app} | ${b.title} ${b.domain ? `(${b.domain})` : ''} | ${b.totalMinutes}min`)
    .join('\n');

  const audioSection = input.audioTranscripts?.length
    ? `\nTRANSCRIPTIONS AUDIO (micro, conversations captées) :\n${input.audioTranscripts.map(a => `- [${a.time}] ${a.text}`).join('\n')}\n`
    : '';

  const mappingSection = input.projectMappings?.length
    ? `\nMAPPING RÉPERTOIRES → ACTIVITÉS (FAIT CONFIANCE À CES CORRESPONDANCES) :\n${input.projectMappings.map(m => `- Répertoire "${m.project}" → activityId "${m.activityId}" (${m.label})`).join('\n')}\n`
    : '';

  const claudeSection = input.claudePrompts?.length
    ? `\nPROMPTS CLAUDE CODE (commandes de développement, donnent le contexte exact du travail) :\n${input.claudePrompts.map(c => `- [${c.time}] projet: ${c.project} | "${c.prompt.slice(0, 150)}"`).join('\n')}\n`
    : '';

  const historySection = input.recentTimesheets?.length
    ? `\nEXEMPLES DE TIMESHEETS RÉCENTS (pour apprendre le style de l'utilisateur) :\n${input.recentTimesheets.map(t => `- [${t.date}] ${t.activityLabel} | "${t.description}" | ${t.minutes}min`).join('\n')}\n`
    : '';

  const prompt = `Tu es un assistant qui analyse l'activité écran d'un employé d'une société de services informatiques (développement Odoo, support, gestion de projet) pour remplir ses feuilles de temps.

ACTIVITÉS DISPONIBLES (utilise UNIQUEMENT ces IDs) :
${activitiesList}

ACTIVITÉ ÉCRAN DU ${input.date} :
${unmatchedList}
${mappingSection}${audioSection}${claudeSection}${historySection}
RÈGLES DE CORRESPONDANCE :
- Si un nom entre crochets [xxx] est présent, c'est le répertoire du projet actif. Utilise le MAPPING RÉPERTOIRES ci-dessus pour trouver l'activityId correspondant.
- Les URLs contenant un nom de client identifient le client (ex: gemaddis.odoo.com = GemAddis).
- "Claude Code", "cmux" SANS crochets = regarder les PROMPTS CLAUDE CODE pour deviner le projet.
- "timesheet" = travail interne sur l'outil de suivi du temps.
- NE COPIE PAS les titres de fenêtres dans les descriptions. Écris ce que la personne faisait (ex: "Développement site web", "Support client", "Migration DHL").
- IMPORTANT : ne mets PAS tout dans le même client. Regarde attentivement les crochets de CHAQUE bloc et utilise le mapping.

Retourne UNIQUEMENT un JSON :
{"summary":"résumé français 2-3 phrases","suggestions":[{"activityId":"ID","description":"description métier courte","totalMinutes":nombre}]}

RÈGLES :
- "summary" : résume la journée en mentionnant les clients/projets.
- "suggestions" : pour les BLOCS NON IDENTIFIÉS UNIQUEMENT, essaie de deviner l'activité avec le mapping.
- activityId DOIT être un ID de la liste ci-dessus. Si tu ne sais pas, mets "".
- N'invente PAS de données.`;

  const response = await generateWithLLM(prompt, model, 'json');

  // Parse JSON from response (LLM might wrap it in markdown)
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log('[ollama] No JSON found in response');
    return { summary: '', suggestions: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      summary: parsed.summary || '',
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    };
  } catch {
    return { summary: '', suggestions: [] };
  }
}
