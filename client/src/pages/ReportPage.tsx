import { useState, useEffect, useCallback } from 'react';
import type { TrackingReport, SuggestedEntry } from '../types';
import * as api from '../api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft, FileText, Check, Clock, AlertCircle, ChevronDown, Terminal, Monitor, Sparkles } from 'lucide-react';

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function formatDateFR(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  return `${days[date.getDay()]}. ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export default function ReportPage() {
  const [dates, setDates] = useState<{ date: string; hasReport: boolean; status: string | null }[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [report, setReport] = useState<TrackingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ step: number; total: number; label: string } | null>(null);
  const [validating, setValidating] = useState(false);
  // Editable suggested entries
  const [editEntries, setEditEntries] = useState<(SuggestedEntry & { selected: boolean })[]>([]);
  const [activities, setActivities] = useState<{ id: string; name: string; customerId: string }[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [claudePrompts, setClaudePrompts] = useState<{ timestamp: string; project: string; prompt: string }[]>([]);
  const [showClaude, setShowClaude] = useState(false);
  const [screenSessions, setScreenSessions] = useState<{ from: string; until: string; app: string; title: string; url?: string }[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  // Editable unmatched blocks
  const [editUnmatched, setEditUnmatched] = useState<{ app: string; title: string; totalMinutes: number; activityId: string; description: string; selected: boolean }[]>([]);

  const refreshDates = useCallback(async () => {
    try {
      const data = await api.getReportDates();
      setDates(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refreshDates(); }, [refreshDates]);

  useEffect(() => {
    api.getActivities().then(a => setActivities(a.activities));
    api.getCustomers().then(c => setCustomers(c.customers));
  }, []);

  function applyReport(r: TrackingReport) {
    setReport(r);
    setEditEntries(r.suggestedEntries.map(e => ({ ...e, selected: true })));
    setEditUnmatched(r.unmatched.map(b => ({
      app: b.app,
      title: b.title,
      totalMinutes: b.totalMinutes,
      activityId: '',
      description: `${b.app}: ${b.title}`,
      selected: false,
    })));
  }

  async function selectDate(date: string) {
    setSelectedDate(date);
    setLoading(true);
    setProgress(null);
    try {
      let r = await api.getReport(date);
      if (!r) {
        r = await api.generateReportSSE(date, (step, total, label) => {
          setProgress({ step, total, label });
        });
      }
      applyReport(r);
      const tracking = await api.getTracking(date);
      setClaudePrompts((tracking as any).claudePrompts || []);
      setScreenSessions(tracking.screenSessions || []);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  // Auto-refresh tracking data when viewing a report
  useEffect(() => {
    if (!selectedDate || loading) return;
    const refreshTracking = async () => {
      try {
        const tracking = await api.getTracking(selectedDate);
          setClaudePrompts((tracking as any).claudePrompts || []);
      setScreenSessions(tracking.screenSessions || []);
      } catch { /* ignore */ }
    };
    const id = setInterval(refreshTracking, 5000);
    return () => clearInterval(id);
  }, [selectedDate, loading]);

  async function regenerateReport() {
    if (!selectedDate) return;
    setLoading(true);
    setProgress(null);
    try {
      const r = await api.generateReportSSE(selectedDate, (step, total, label) => {
        setProgress({ step, total, label });
      });
      applyReport(r);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  function updateUnmatched(index: number, updates: Partial<typeof editUnmatched[0]>) {
    setEditUnmatched(prev => prev.map((e, i) => i === index ? { ...e, ...updates } : e));
  }

  function activityLabel(activityId: string): string {
    const activity = activities.find(a => a.id === activityId);
    if (!activity) return activityId || '(non assigne)';
    const customer = customers.find(c => c.id === activity.customerId);
    return customer ? `${customer.name} - ${activity.name}` : activity.name;
  }

  async function handleValidate() {
    if (!selectedDate || !report) return;
    setValidating(true);
    try {
      const suggested = editEntries
        .filter(e => e.selected)
        .map(e => ({
          activityId: e.activityId,
          description: e.description,
          roundedMinutes: e.roundedMinutes,
        }));
      const unmatched = editUnmatched
        .filter(e => e.selected && e.activityId)
        .map(e => ({
          activityId: e.activityId,
          description: e.description,
          roundedMinutes: Math.max(15, Math.ceil(e.totalMinutes / 15) * 15),
        }));
      await api.validateReport(selectedDate, [...suggested, ...unmatched]);
      setReport({ ...report, status: 'validated' });
      await refreshDates();
    } finally {
      setValidating(false);
    }
  }

  async function handleUnvalidate() {
    if (!selectedDate || !report) return;
    setValidating(true);
    try {
      await api.unvalidateReport(selectedDate);
      setReport({ ...report, status: 'pending' });
      await refreshDates();
    } finally {
      setValidating(false);
    }
  }

  function updateEntry(index: number, updates: Partial<SuggestedEntry & { selected: boolean }>) {
    setEditEntries(prev => prev.map((e, i) => i === index ? { ...e, ...updates } : e));
  }

  const [regeneratingDescs, setRegeneratingDescs] = useState(false);

  async function handleRecalculate() {
    if (!selectedDate) return;
    setRegeneratingDescs(true);
    try {
      // Collect all entries: suggested + assigned unmatched
      const allEntries = [
        ...editEntries.filter(e => e.selected).map(e => ({ activityId: e.activityId, totalMinutes: e.totalMinutes })),
        ...editUnmatched.filter(e => e.selected && e.activityId).map(e => ({ activityId: e.activityId, totalMinutes: e.totalMinutes })),
      ];
      if (allEntries.length === 0) return;

      // Merge entries with same activityId
      const merged = new Map<string, number>();
      for (const e of allEntries) {
        merged.set(e.activityId, (merged.get(e.activityId) || 0) + e.totalMinutes);
      }

      const mergedEntries = [...merged.entries()].map(([activityId, totalMinutes]) => ({
        activityId,
        totalMinutes,
      }));

      // Regenerate descriptions for merged entries
      const result = await api.regenerateDescriptions(selectedDate, mergedEntries);

      // Build new suggested entries from merged results
      const newEntries = mergedEntries.map((e, i) => {
        const act = activities.find(a => a.id === e.activityId);
        const customer = act ? customers.find(c => c.id === act.customerId) : null;
        return {
          activityId: e.activityId,
          customerName: customer?.name,
          description: result.descriptions[i] || '',
          totalMinutes: e.totalMinutes,
          roundedMinutes: Math.max(15, Math.ceil(e.totalMinutes / 15) * 15),
          confidence: 'high' as const,
          source: 'cmux' as const,
          blockCount: 1,
          selected: true,
        };
      }).sort((a, b) => b.totalMinutes - a.totalMinutes);

      setEditEntries(newEntries);
      // Remove assigned unmatched (they're now merged into suggested)
      setEditUnmatched(prev => prev.filter(e => !e.selected || !e.activityId));
    } catch { /* ignore */ } finally {
      setRegeneratingDescs(false);
    }
  }

  // --- List view ---
  if (!selectedDate) {
    return (
      <div className="space-y-6 animate-in fade-in duration-200">
        <h1 className="text-2xl font-bold">Rapports d'activite</h1>
        {dates.length === 0 ? (
          <p className="text-muted-foreground text-center py-12">Aucune donnee de tracking disponible.</p>
        ) : (
          <div className="space-y-2">
            {dates.map(d => (
              <Card
                key={d.date}
                className="cursor-pointer hover:bg-accent/50 transition-colors py-3 gap-0"
                onClick={() => selectDate(d.date)}
              >
                <CardContent className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{formatDateFR(d.date)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.status === 'validated' ? (
                      <span className="text-xs font-medium text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full">Valide</span>
                    ) : d.hasReport ? (
                      <span className="text-xs font-medium text-warning-foreground bg-warning/20 px-2 py-0.5 rounded-full">En attente</span>
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Non genere</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- Detail view ---
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => { setSelectedDate(null); setReport(null); }}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold">Rapport — {formatDateFR(selectedDate)}</h1>
        {report?.status === 'validated' && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full">Validé</span>
            <Button variant="outline" size="sm" className="h-7 text-xs text-destructive" onClick={handleUnvalidate} disabled={validating}>
              Annuler
            </Button>
          </div>
        )}
        <Button variant="outline" size="sm" onClick={regenerateReport} disabled={loading}>
          {loading ? (
            <>
              <div className="h-3.5 w-3.5 rounded-full border-2 border-muted animate-spin border-t-foreground" />
              Génération...
            </>
          ) : 'Regénérer'}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Progress indicator */}
          {progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{progress.label}</span>
                <span className="font-mono text-xs text-muted-foreground">{progress.step}/{progress.total}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${(progress.step / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
          {!progress && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <div className="h-4 w-4 rounded-full border-2 border-muted animate-spin border-t-primary" />
              Chargement...
            </div>
          )}

          {/* Skeleton cards */}
          <Card className="py-4 gap-0">
            <CardContent className="space-y-2">
              <div className="h-4 w-48 bg-muted rounded animate-pulse" />
              <div className="h-3 w-full bg-muted rounded animate-pulse" />
            </CardContent>
          </Card>
          {[1, 2, 3].map(i => (
            <Card key={i} className="py-3 gap-0">
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full bg-muted animate-pulse" />
                    <div className="h-4 w-32 bg-muted rounded animate-pulse" />
                  </div>
                  <div className="h-4 w-12 bg-muted rounded animate-pulse" />
                </div>
                <div className="pl-6">
                  <div className="h-8 w-full bg-muted rounded animate-pulse" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !report ? (
        <p className="text-center text-muted-foreground py-12">Aucune donnee disponible.</p>
      ) : (
        <>
          {/* Summary */}
          <Card className="py-4 gap-0">
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Temps total tracké : <strong>{formatDuration(report.totalTrackedMinutes)}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  {report.aiEnhanced && (
                    <span className="text-xs font-medium text-purple-600 bg-purple-100 dark:bg-purple-900/30 dark:text-purple-400 px-2 py-0.5 rounded-full">IA</span>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {report.suggestedEntries.length} identifiée(s) · {report.unmatched.length} non identifiée(s)
                  </span>
                </div>
              </div>
              {report.summary && (
                <p className="text-sm text-muted-foreground italic">{report.summary}</p>
              )}
            </CardContent>
          </Card>

          {report.gaps && report.gaps.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {report.gaps.map((g, i) => (
                <span key={i} className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground">
                  Pause {new Date(g.from).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})} → {new Date(g.to).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})} ({g.durationMinutes}min)
                </span>
              ))}
            </div>
          )}

          {/* Suggested entries */}
          {editEntries.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Timesheets proposes</h2>
              <div className="space-y-2">
                {editEntries.map((entry, i) => (
                  <Card key={i} className={`py-3 gap-0 ${entry.selected ? '' : 'opacity-50'}`}>
                    <CardContent className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={entry.selected}
                            onChange={e => updateEntry(i, { selected: e.target.checked })}
                            className="h-4 w-4 rounded accent-primary cursor-pointer"
                          />
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                              entry.confidence === 'high' ? 'bg-green-500' :
                              entry.confidence === 'medium' ? 'bg-yellow-500' : 'bg-red-400'
                            }`} title={`Confiance ${entry.confidence} — source: ${entry.source}`} />
                            {entry.source && entry.source !== 'cmux' && (
                              <span className="text-[10px] text-muted-foreground">{entry.source}</span>
                            )}
                            <span className="font-medium text-sm">{activityLabel(entry.activityId)}</span>
                          </div>
                        </div>
                        <span className="font-mono text-sm font-semibold tabular-nums">{formatDuration(entry.roundedMinutes)}</span>
                      </div>
                      <div className="pl-6">
                        <input
                          className="w-full h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                          value={entry.description}
                          onChange={e => updateEntry(i, { description: e.target.value })}
                          placeholder="Description..."
                        />
                      </div>
                      <div className="pl-6 flex items-center gap-2">
                        <select
                          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm flex-1"
                          value={entry.activityId}
                          onChange={e => updateEntry(i, { activityId: e.target.value })}
                        >
                          <option value="">-- Activite --</option>
                          {activities
                            .map(a => {
                              const c = customers.find(c => c.id === a.customerId);
                              const label = c ? `${c.name} - ${a.name}` : a.name;
                              return { ...a, label };
                            })
                            .sort((a, b) => a.label.localeCompare(b.label))
                            .map(a => (
                              <option key={a.id} value={a.id}>{a.label}</option>
                            ))}
                        </select>
                        <input
                          type="number"
                          className="w-20 h-8 rounded-md border border-input bg-transparent px-2 text-sm text-right"
                          value={entry.roundedMinutes}
                          onChange={e => updateEntry(i, { roundedMinutes: parseInt(e.target.value) || 0 })}
                          min={0}
                          step={15}
                        />
                        <span className="text-xs text-muted-foreground">min</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Unmatched blocks */}
          {editUnmatched.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-warning" />
                Non identifiées ({editUnmatched.length})
              </h2>
              <div className="space-y-2">
                {editUnmatched.map((block, i) => (
                  <Card key={i} className={`py-3 gap-0 ${block.selected ? '' : 'opacity-60'}`}>
                    <CardContent className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={block.selected}
                            onChange={e => updateUnmatched(i, { selected: e.target.checked })}
                            className="h-4 w-4 rounded accent-primary cursor-pointer"
                          />
                          <span className="text-sm"><strong>{block.app}</strong>: {block.title || '(sans titre)'}</span>
                        </div>
                        <span className="font-mono text-sm tabular-nums shrink-0">{formatDuration(block.totalMinutes)}</span>
                      </div>
                      {block.selected && (
                        <div className="pl-6 flex items-center gap-2">
                          <select
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm flex-1"
                            value={block.activityId}
                            onChange={e => updateUnmatched(i, { activityId: e.target.value })}
                          >
                            <option value="">-- Assigner une activité --</option>
                            {activities
                              .map(a => {
                                const c = customers.find(c => c.id === a.customerId);
                                const label = c ? `${c.name} - ${a.name}` : a.name;
                                return { ...a, label };
                              })
                              .sort((a, b) => a.label.localeCompare(b.label))
                              .map(a => (
                                <option key={a.id} value={a.id}>{a.label}</option>
                              ))}
                          </select>
                          <input
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm flex-1"
                            value={block.description}
                            onChange={e => updateUnmatched(i, { description: e.target.value })}
                            placeholder="Description..."
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Screen sessions */}
          {screenSessions.length > 0 && (
            <section className="space-y-3">
              <button
                onClick={() => setShowSessions(v => !v)}
                className="flex items-center gap-2 text-lg font-semibold hover:text-primary transition-colors"
              >
                <Monitor className="h-4 w-4" />
                Sessions écran ({screenSessions.length})
                <ChevronDown className={`h-4 w-4 transition-transform ${showSessions ? 'rotate-180' : ''}`} />
              </button>
              {showSessions && (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {screenSessions.map((s, i) => {
                    const from = new Date(s.from).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                    const until = new Date(s.until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div key={i} className="flex gap-3 text-sm px-3 py-1.5 rounded-lg bg-muted/50">
                        <span className="text-muted-foreground shrink-0 tabular-nums">{from}→{until}</span>
                        <span className="text-xs text-primary font-medium shrink-0">{s.app}</span>
                        <span className="truncate text-muted-foreground">{s.title || '(sans titre)'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}


          {/* Claude Code prompts */}
          {claudePrompts.length > 0 && (
            <section className="space-y-3">
              <button
                onClick={() => setShowClaude(v => !v)}
                className="flex items-center gap-2 text-lg font-semibold hover:text-primary transition-colors"
              >
                <Terminal className="h-4 w-4" />
                Prompts Claude Code ({claudePrompts.length})
                <ChevronDown className={`h-4 w-4 transition-transform ${showClaude ? 'rotate-180' : ''}`} />
              </button>
              {showClaude && (
                <div className="space-y-1">
                  {claudePrompts.map((p, i) => (
                    <div key={i} className="flex gap-3 text-sm px-3 py-2 rounded-lg bg-muted/50">
                      <span className="text-muted-foreground shrink-0 tabular-nums">{new Date(p.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="text-xs text-primary font-medium shrink-0">{p.project}</span>
                      <span className="truncate">{p.prompt}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Action buttons */}
          {report.status !== 'validated' && (editEntries.some(e => e.selected) || editUnmatched.some(e => e.selected && e.activityId)) && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button variant="outline" onClick={handleRecalculate} disabled={regeneratingDescs}>
                {regeneratingDescs ? (
                  <>
                    <div className="h-3.5 w-3.5 rounded-full border-2 border-muted animate-spin border-t-foreground" />
                    Descriptions...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Recalculer
                  </>
                )}
              </Button>
              <Button size="lg" onClick={handleValidate} disabled={validating} className="text-base font-semibold px-8">
                <Check className="h-5 w-5" />
                Tout valider ({editEntries.filter(e => e.selected).length + editUnmatched.filter(e => e.selected && e.activityId).length} entrée(s))
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
