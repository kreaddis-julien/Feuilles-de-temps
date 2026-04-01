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

export async function generateWithLLM(prompt: string, model = 'llama3.1'): Promise<string> {
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
  blocks: { app: string; title: string; domain?: string; totalMinutes: number }[];
  unmatched: { app: string; title: string; domain?: string; totalMinutes: number }[];
  activities: { id: string; name: string; customerName: string }[];
}

export interface LLMSuggestedEntry {
  activityId: string;
  description: string;
  totalMinutes: number;
}

export async function analyzeReport(input: LLMReportInput, model = 'llama3.1'): Promise<{
  summary: string;
  suggestions: LLMSuggestedEntry[];
}> {
  const activitiesList = input.activities
    .map(a => `- ID: "${a.id}" → ${a.customerName} - ${a.name}`)
    .join('\n');

  const blocksList = input.blocks
    .filter(b => b.totalMinutes >= 1)
    .map(b => `- ${b.app} | ${b.title} ${b.domain ? `(${b.domain})` : ''} | ${b.totalMinutes}min`)
    .join('\n');

  const unmatchedList = input.unmatched
    .map(b => `- ${b.app} | ${b.title} ${b.domain ? `(${b.domain})` : ''} | ${b.totalMinutes}min`)
    .join('\n');

  const prompt = `Tu es un assistant qui analyse l'activité d'un employé pour l'aider à remplir ses feuilles de temps.

Voici les activités/clients configurés dans le système :
${activitiesList}

Voici l'activité écran du ${input.date} :

BLOCS DÉJÀ IDENTIFIÉS :
${blocksList}

BLOCS NON IDENTIFIÉS :
${unmatchedList}

Analyse ces données et retourne un JSON avec :
1. "summary" : un résumé en français de la journée en 2-3 phrases
2. "suggestions" : une liste d'entrées de timesheet suggérées pour les blocs NON IDENTIFIÉS. Pour chaque suggestion, essaie de deviner quel activityId correspond en te basant sur le nom de l'app, le titre, le domaine. Si tu ne peux pas deviner, mets activityId à "".

Chaque suggestion a : activityId (string), description (string courte en français), totalMinutes (number).

Réponds UNIQUEMENT avec le JSON, sans commentaire ni markdown.

Exemple de réponse :
{"summary":"Journée sur le projet Baouw et support GemAddis","suggestions":[{"activityId":"abc123","description":"Développement","totalMinutes":15}]}`;

  const response = await generateWithLLM(prompt, model);

  // Parse JSON from response (LLM might wrap it in markdown)
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
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
