import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts';
import * as api from '../api';
import type { StatsData } from '../api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = start
  date.setDate(date.getDate() - diff);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function endOfWeek(dateStr: string): string {
  const start = startOfWeek(dateStr);
  const [y, m, d] = start.split('-').map(Number);
  const date = new Date(y, m - 1, d + 6);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfMonth(dateStr: string): string {
  return dateStr.slice(0, 7) + '-01';
}

function endOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function formatH(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

const COLORS = ['#49aeff', '#fc0036', '#29a948', '#ffae00', '#f32882', '#00ac96', '#f97ea8', '#a8a8a8'];

function PieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { fill: string; totalHours?: number } }> }) {
  if (!active || !payload?.length) return null;
  const { name, value, payload: p } = payload[0];
  const pct = p.totalHours ? Math.round(value / p.totalHours * 100) : 0;
  return (
    <div className="chart-tooltip">
      <span style={{ color: p.fill }}>{name}</span> : {value}h ({pct}%)
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Period = 'day' | 'week' | 'month' | 'custom';

export default function StatsPage() {
  const [period, setPeriod] = useState<Period>('week');
  const [refDate, setRefDate] = useState(todayStr);
  const [customFrom, setCustomFrom] = useState(todayStr);
  const [customTo, setCustomTo] = useState(todayStr);
  const [stats, setStats] = useState<StatsData | null>(null);

  const range = period === 'custom'
    ? { from: customFrom, to: customTo }
    : period === 'day'
      ? { from: refDate, to: refDate }
      : period === 'week'
        ? { from: startOfWeek(refDate), to: endOfWeek(refDate) }
        : { from: startOfMonth(refDate), to: endOfMonth(refDate) };

  const refresh = useCallback(async () => {
    const data = await api.getStats(range.from, range.to);
    setStats(data);
  }, [range.from, range.to]);

  useEffect(() => { refresh(); }, [refresh]);

  function shiftPeriod(offset: number) {
    const [y, m, d] = refDate.split('-').map(Number);
    if (period === 'day') {
      const date = new Date(y, m - 1, d + offset);
      setRefDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
    } else if (period === 'week') {
      const date = new Date(y, m - 1, d + offset * 7);
      setRefDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
    } else {
      const date = new Date(y, m - 1 + offset, 1);
      setRefDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`);
    }
  }

  const periodLabel = period === 'custom'
    ? `${shortDate(range.from)} — ${shortDate(range.to)}`
    : period === 'day'
      ? refDate
      : period === 'week'
        ? `${shortDate(range.from)} — ${shortDate(range.to)}`
        : `${range.from.slice(0, 7)}`;

  if (!stats) return <div>Chargement...</div>;

  const dayData = stats.byDay.map(d => ({ ...d, label: shortDate(d.date), hours: +(d.minutes / 60).toFixed(1) }));

  return (
    <div className="stats-page">
      {/* Period navigation */}
      <div className="stats-nav">
        <div className="stats-period-toggle">
          <button className={period === 'day' ? 'active' : ''} onClick={() => setPeriod('day')}>Jour</button>
          <button className={period === 'week' ? 'active' : ''} onClick={() => setPeriod('week')}>Semaine</button>
          <button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>Mois</button>
          <button className={period === 'custom' ? 'active' : ''} onClick={() => setPeriod('custom')}>Personnalisé</button>
        </div>
        {period === 'custom' ? (
          <div className="stats-custom-range">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span>—</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </div>
        ) : (
          <div className="date-nav">
            <button onClick={() => shiftPeriod(-1)}>&larr;</button>
            <span className="current-date">{periodLabel}</span>
            <button onClick={() => shiftPeriod(1)}>&rarr;</button>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="stats-summary">
        <div className="stat-card">
          <div className="stat-value">{formatH(stats.totalRoundedMinutes)}</div>
          <div className="stat-label">Total</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.entryCount}</div>
          <div className="stat-label">Entrées</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.byDay.length > 0 ? formatH(Math.round(stats.totalRoundedMinutes / stats.byDay.length)) : '0h'}</div>
          <div className="stat-label">Moy / jour</div>
        </div>
      </div>

      {/* Daily bar chart */}
      {dayData.length > 0 && (
        <section className="stats-section">
          <h2>Heures par jour</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={dayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} />
              <YAxis tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} unit="h" />
              <Tooltip
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 6 }}
                labelStyle={{ color: 'var(--color-text)' }}
                cursor={{ fill: 'var(--color-border)', opacity: 0.3 }}
                formatter={(value: number) => [`${value}h`, 'Heures']}
              />
              <Bar dataKey="hours" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* By customer pie */}
      <div className="stats-charts-row">
        {stats.byCustomer.length > 0 && (
          <section className="stats-section stats-half">
            <h2>Par client</h2>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={stats.byCustomer.map(c => ({ ...c, hours: +(c.minutes / 60).toFixed(1), totalHours: +(stats.totalRoundedMinutes / 60).toFixed(1) }))}
                  dataKey="hours"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  stroke="none"
                >
                  {stats.byCustomer.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </section>
        )}

        {/* By type pie */}
        {stats.byType.length > 0 && (
          <section className="stats-section stats-half">
            <h2>Interne / Externe</h2>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={stats.byType.map(t => ({ ...t, label: t.type.charAt(0).toUpperCase() + t.type.slice(1), hours: +(t.minutes / 60).toFixed(1), totalHours: +(stats.totalRoundedMinutes / 60).toFixed(1) }))}
                  dataKey="hours"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  stroke="none"
                >
                  {stats.byType.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </section>
        )}
      </div>

      {/* By activity charts row */}
      <div className="stats-charts-row">
        {stats.byActivity.length > 0 && (
          <section className="stats-section stats-half">
            <h2>Par activité détaillé</h2>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={stats.byActivity.map(a => ({ ...a, label: a.customerName ? `${a.name} — ${a.customerName}` : a.name, hours: +(a.minutes / 60).toFixed(1), totalHours: +(stats.totalRoundedMinutes / 60).toFixed(1) }))}
                  dataKey="hours"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  stroke="none"
                >
                  {stats.byActivity.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </section>
        )}

        {stats.byActivity.length > 0 && (
          <section className="stats-section stats-half">
            <h2>Par activité</h2>
            {(() => {
              const grouped = stats.byActivity.reduce<Record<string, number>>((acc, a) => {
                acc[a.name] = (acc[a.name] || 0) + a.minutes;
                return acc;
              }, {});
              const totalHours = +(stats.totalRoundedMinutes / 60).toFixed(1);
              const data = Object.entries(grouped).map(([name, minutes]) => ({ name, hours: +(minutes / 60).toFixed(1), totalHours }));
              return (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={data} dataKey="hours" nameKey="name" cx="50%" cy="50%" outerRadius={90} stroke="none">
                      {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              );
            })()}
          </section>
        )}
      </div>


      {stats.byDay.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', marginTop: '2rem' }}>
          Aucune donnée pour cette période.
        </p>
      )}
    </div>
  );
}
