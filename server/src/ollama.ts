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

export async function generateWithLLM(prompt: string, model = 'qwen2.5:14b'): Promise<string> {
  const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
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
  recentTimesheets?: { date: string; activityId: string; activityLabel: string; description: string; minutes: number }[];
}

export interface LLMSuggestedEntry {
  activityId: string;
  description: string;
  totalMinutes: number;
}

export async function analyzeReport(input: LLMReportInput, model = 'qwen2.5:14b'): Promise<{
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

  const historySection = input.recentTimesheets?.length
    ? `\nEXEMPLES DE TIMESHEETS RÉCENTS (pour apprendre le style de l'utilisateur) :\n${input.recentTimesheets.map(t => `- [${t.date}] ${t.activityLabel} | "${t.description}" | ${t.minutes}min`).join('\n')}\n`
    : '';

  const prompt = `Tu es un assistant qui analyse l'activité écran d'un employé d'une société de services informatiques (développement Odoo, support, gestion de projet) pour remplir ses feuilles de temps.

ACTIVITÉS DISPONIBLES (utilise UNIQUEMENT ces IDs) :
${activitiesList}

ACTIVITÉ ÉCRAN DU ${input.date} :
${unmatchedList}
${audioSection}${historySection}
RÈGLES DE CORRESPONDANCE :
- Les noms entre crochets [xxx] sont des répertoires de projets. "baouw" = Baouw, "psbe-gemaddis-erp" ou "gemaddis" = GemAddis, "Feuilles-de-temps" ou "feuille-de-temps" = travail interne KreAddis.
- Les URLs contenant un nom de client identifient le client (ex: gemaddis.odoo.com = GemAddis, baouw = Baouw).
- "cmux" et "Claude Code" sont des outils de développement — le projet dépend du répertoire entre crochets.
- "timesheet" et "Tempo" = travail interne sur l'outil de suivi du temps.
- NE COPIE PAS les titres de fenêtres dans les descriptions. Écris ce que la personne faisait (ex: "Développement site web", "Support client", "Migration DHL").

Retourne UNIQUEMENT un JSON :
{"summary":"résumé français 2-3 phrases","suggestions":[{"activityId":"ID_existant","description":"description métier courte","totalMinutes":nombre}]}

IMPORTANT :
- activityId DOIT être un ID de la liste ci-dessus. Si tu ne sais pas, mets "".
- Regroupe les blocs du même client/projet en UNE seule suggestion.
- La somme des totalMinutes doit être cohérente avec l'activité écran.
- N'invente PAS de données. Base-toi uniquement sur les blocs fournis.`;

  const response = await generateWithLLM(prompt, model);

  // Parse JSON from response (LLM might wrap it in markdown)
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { summary: '', descriptions: {}, suggestions: [] };
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
