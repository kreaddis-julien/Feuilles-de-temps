import { useState, useEffect, useCallback } from 'react';
import type { Activity, ActivitiesData, CustomersData } from '../types';
import * as api from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

export default function ActivitiesPage() {
  const [data, setData] = useState<ActivitiesData>({ activities: [] });
  const [customers, setCustomers] = useState<CustomersData>({ customers: [] });
  const [newName, setNewName] = useState('');
  const [newCustomerId, setNewCustomerId] = useState('');
  const [editing, setEditing] = useState<Activity | null>(null);
  const [editName, setEditName] = useState('');
  const [editCustomerId, setEditCustomerId] = useState('');

  const refresh = useCallback(async () => {
    const [d, c] = await Promise.all([api.getActivities(), api.getCustomers()]);
    setData(d);
    setCustomers(c);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await api.createActivity({ name: newName.trim(), customerId: newCustomerId });
    setNewName('');
    refresh();
  };

  const handleDelete = async (id: string) => {
    await api.deleteActivity(id);
    refresh();
  };

  const openEdit = (a: Activity) => {
    setEditing(a);
    setEditName(a.name);
    setEditCustomerId(a.customerId);
  };

  const saveEdit = async () => {
    if (!editing || !editName.trim()) return;
    await api.updateActivity(editing.id, { name: editName.trim(), customerId: editCustomerId });
    setEditing(null);
    refresh();
  };

  const sorted = [...data.activities].sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <h1 className="text-2xl font-semibold">Activités</h1>

      <form onSubmit={handleCreate} className="flex gap-2 items-center flex-wrap">
        <Input
          placeholder="Nom de l'activité"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 max-w-80"
        />
        <select
          className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] min-w-32"
          value={newCustomerId}
          onChange={(e) => setNewCustomerId(e.target.value)}
        >
          <option value="">-- Client --</option>
          {customers.customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <Button type="submit">Ajouter</Button>
      </form>

      <div className="space-y-2">
        {sorted.map((activity) => {
          const customerName = customers.customers.find(c => c.id === activity.customerId)?.name;
          return (
            <Card
              key={activity.id}
              className="py-3 gap-0 cursor-pointer hover:border-primary transition-colors"
              onClick={() => openEdit(activity)}
            >
              <CardContent>
                <strong className="text-sm font-semibold">{activity.name}</strong>
                {customerName && (
                  <span className="ml-2 text-sm text-muted-foreground">{customerName}</span>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier l'activité</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Nom</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Client</label>
              <select
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                value={editCustomerId}
                onChange={(e) => setEditCustomerId(e.target.value)}
              >
                <option value="">-- Aucun --</option>
                {customers.customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={async () => {
              if (!editing) return;
              await handleDelete(editing.id);
              setEditing(null);
            }}>
              Supprimer
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)}>Annuler</Button>
            <Button onClick={saveEdit}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
