import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import type { Storage } from '../storage.js';
import type { TimesheetEntry } from '../types.js';
import { nowTimestamp, calcTotalMinutes, roundUp15 } from '../time-utils.js';

export function createTimesheetRouter(storage: Storage) {
  const router = Router();

  router.get('/:date', async (req, res) => {
    const data = await storage.loadTimesheet(req.params.date);
    res.json(data);
  });

  router.post('/:date/entries', async (req, res) => {
    const data = await storage.loadTimesheet(req.params.date);
    const { activityId = '', description = '' } = req.body;

    const entry: TimesheetEntry = {
      id: uuid(),
      activityId,
      description,
      segments: [{ start: nowTimestamp(), end: null }],
      totalMinutes: 0,
      roundedMinutes: 0,
      status: 'active',
    };

    data.entries.push(entry);
    data.activeEntries.push(entry.id);
    await storage.saveTimesheet(data);
    res.status(201).json(data);
  });

  router.patch('/:date/entries/:id', async (req, res) => {
    const data = await storage.loadTimesheet(req.params.date);
    const entry = data.entries.find((e) => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });

    if (req.body.status === 'completed') {
      const openSeg = entry.segments.find((s) => s.end === null);
      if (openSeg) openSeg.end = nowTimestamp();
      entry.totalMinutes = calcTotalMinutes(entry.segments);
      entry.roundedMinutes = roundUp15(entry.totalMinutes);
      entry.status = 'completed';
      data.activeEntries = data.activeEntries.filter((id) => id !== entry.id);
      data.pausedEntries = data.pausedEntries.filter((id) => id !== entry.id);
    } else {
      if (req.body.description !== undefined) entry.description = req.body.description;
      if (req.body.roundedMinutes !== undefined) entry.roundedMinutes = req.body.roundedMinutes;
      if (req.body.activityId !== undefined) entry.activityId = req.body.activityId;
      if (req.body.deferred !== undefined) entry.deferred = req.body.deferred;
    }

    await storage.saveTimesheet(data);
    res.json(data);
  });

  router.delete('/:date/entries/:id', async (req, res) => {
    const data = await storage.loadTimesheet(req.params.date);
    data.entries = data.entries.filter((e) => e.id !== req.params.id);
    data.activeEntries = data.activeEntries.filter((id) => id !== req.params.id);
    data.pausedEntries = data.pausedEntries.filter((id) => id !== req.params.id);
    await storage.saveTimesheet(data);
    res.json(data);
  });

  router.post('/:date/entries/:id/pause', async (req, res) => {
    const data = await storage.loadTimesheet(req.params.date);
    const entry = data.entries.find((e) => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });

    const openSeg = entry.segments.find((s) => s.end === null);
    if (openSeg) openSeg.end = nowTimestamp();
    entry.totalMinutes = calcTotalMinutes(entry.segments);
    entry.status = 'paused';

    data.activeEntries = data.activeEntries.filter((id) => id !== entry.id);
    if (!data.pausedEntries.includes(entry.id)) {
      data.pausedEntries.push(entry.id);
    }

    await storage.saveTimesheet(data);
    res.json(data);
  });

  router.post('/:date/entries/:id/resume', async (req, res) => {
    const data = await storage.loadTimesheet(req.params.date);
    const entry = data.entries.find((e) => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });

    entry.segments.push({ start: nowTimestamp(), end: null });
    entry.status = 'active';
    if (!data.activeEntries.includes(entry.id)) data.activeEntries.push(entry.id);
    data.pausedEntries = data.pausedEntries.filter((id) => id !== entry.id);

    await storage.saveTimesheet(data);
    res.json(data);
  });

  return router;
}
