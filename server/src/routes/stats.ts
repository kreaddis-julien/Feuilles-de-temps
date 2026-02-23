import { Router } from 'express';
import type { Storage } from '../storage.js';

export function createStatsRouter(storage: Storage) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { from, to } = req.query as { from: string; to: string };
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    const activities = await storage.loadActivities();
    const customers = await storage.loadCustomers();

    const byDay: { date: string; minutes: number }[] = [];
    const customerAgg: Record<string, number> = {};
    const activityAgg: Record<string, number> = {};
    let totalMinutes = 0;
    let totalRounded = 0;
    let entryCount = 0;

    const start = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const day = await storage.loadTimesheet(dateStr);
      let dayMinutes = 0;

      for (const entry of day.entries) {
        if (entry.status !== 'completed') continue;
        entryCount++;
        totalMinutes += entry.totalMinutes;
        totalRounded += entry.roundedMinutes;
        dayMinutes += entry.roundedMinutes;

        if (entry.activityId) {
          activityAgg[entry.activityId] = (activityAgg[entry.activityId] || 0) + entry.roundedMinutes;
          const act = activities.activities.find(a => a.id === entry.activityId);
          if (act?.customerId) {
            customerAgg[act.customerId] = (customerAgg[act.customerId] || 0) + entry.roundedMinutes;
          }
        }
      }

      if (dayMinutes > 0) {
        byDay.push({ date: dateStr, minutes: dayMinutes });
      }
    }

    const byCustomer = Object.entries(customerAgg).map(([id, minutes]) => {
      const c = customers.customers.find(cu => cu.id === id);
      return { id, name: c?.name ?? id, type: c?.type ?? '', minutes };
    }).sort((a, b) => b.minutes - a.minutes);

    const byActivity = Object.entries(activityAgg).map(([id, minutes]) => {
      const a = activities.activities.find(act => act.id === id);
      const c = a ? customers.customers.find(cu => cu.id === a.customerId) : undefined;
      return { id, name: a?.name ?? id, customerName: c?.name ?? '', minutes };
    }).sort((a, b) => b.minutes - a.minutes);

    const byType: { type: string; minutes: number }[] = [];
    const typeAgg: Record<string, number> = {};
    for (const c of byCustomer) {
      const t = c.type || 'non défini';
      typeAgg[t] = (typeAgg[t] || 0) + c.minutes;
    }
    for (const [type, minutes] of Object.entries(typeAgg)) {
      byType.push({ type, minutes });
    }

    res.json({
      period: { from, to },
      totalMinutes,
      totalRoundedMinutes: totalRounded,
      entryCount,
      byDay,
      byCustomer,
      byActivity,
      byType,
    });
  });

  return router;
}
