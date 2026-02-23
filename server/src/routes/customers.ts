import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import type { Storage } from '../storage.js';

export function createCustomersRouter(storage: Storage) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const data = await storage.loadCustomers();
    res.json(data);
  });

  router.post('/', async (req, res) => {
    const { name, type } = req.body;
    const data = await storage.loadCustomers();
    const customer = { id: uuid(), name, type: type || 'externe' };
    data.customers.push(customer);
    await storage.saveCustomers(data);
    res.status(201).json(customer);
  });

  router.patch('/:id', async (req, res) => {
    const data = await storage.loadCustomers();
    const customer = data.customers.find((c) => c.id === req.params.id);
    if (!customer) return res.status(404).json({ error: 'Not found' });
    Object.assign(customer, req.body, { id: customer.id });
    await storage.saveCustomers(data);
    res.json(customer);
  });

  router.delete('/:id', async (req, res) => {
    const data = await storage.loadCustomers();
    data.customers = data.customers.filter((c) => c.id !== req.params.id);
    await storage.saveCustomers(data);
    res.status(204).end();
  });

  return router;
}
