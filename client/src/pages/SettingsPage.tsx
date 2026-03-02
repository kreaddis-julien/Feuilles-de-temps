import { useState, useEffect, useCallback } from 'react';
import type { Activity, ActivitiesData, Customer, CustomersData, CustomerType } from '../types';
import * as api from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

export default function SettingsPage() {
  const [activities, setActivities] = useState<ActivitiesData>({ activities: [] });
  const [customers, setCustomers] = useState<CustomersData>({ customers: [] });

  // Customer form
  const [newCustName, setNewCustName] = useState('');
  const [newCustType, setNewCustType] = useState<CustomerType>('externe');
  const [editingCust, setEditingCust] = useState<Customer | null>(null);
  const [editCustName, setEditCustName] = useState('');
  const [editCustType, setEditCustType] = useState<CustomerType>('externe');

  // Activity form
  const [newActName, setNewActName] = useState('');
  const [newActCustomerId, setNewActCustomerId] = useState('');
  const [editingAct, setEditingAct] = useState<Activity | null>(null);
  const [editActName, setEditActName] = useState('');
  const [editActCustomerId, setEditActCustomerId] = useState('');

  const refresh = useCallback(async () => {
    const [a, c] = await Promise.all([api.getActivities(), api.getCustomers()]);
    setActivities(a);
    setCustomers(c);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // --- Customers ---
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;
    await api.createCustomer({ name: newCustName.trim(), type: newCustType });
    setNewCustName('');
    refresh();
  };

  const openEditCustomer = (c: Customer) => {
    setEditingCust(c);
    setEditCustName(c.name);
    setEditCustType(c.type);
  };

  const saveEditCustomer = async () => {
    if (!editingCust || !editCustName.trim()) return;
    await api.updateCustomer(editingCust.id, { name: editCustName.trim(), type: editCustType });
    setEditingCust(null);
    refresh();
  };

  // --- Activities ---
  const handleCreateActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newActName.trim()) return;
    await api.createActivity({ name: newActName.trim(), customerId: newActCustomerId });
    setNewActName('');
    refresh();
  };

  const openEditActivity = (a: Activity) => {
    setEditingAct(a);
    setEditActName(a.name);
    setEditActCustomerId(a.customerId);
  };

  const saveEditActivity = async () => {
    if (!editingAct || !editActName.trim()) return;
    await api.updateActivity(editingAct.id, { name: editActName.trim(), customerId: editActCustomerId });
    setEditingAct(null);
    refresh();
  };

  const custTypes: CustomerType[] = ['externe', 'interne'];
  const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const sortedCustomers = [...customers.customers].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const sortedActivities = [...activities.activities].sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] min-w-32";

  return (
    <div className="space-y-10 animate-in fade-in duration-200">
      {/* ===== Clients ===== */}
      <section className="space-y-6">
        <h1 className="text-2xl font-semibold">Clients</h1>

        <form onSubmit={handleCreateCustomer} className="flex gap-2 items-center flex-wrap">
          <Input
            placeholder="Nom du client"
            value={newCustName}
            onChange={(e) => setNewCustName(e.target.value)}
            className="flex-1 max-w-80"
          />
          <select
            className={selectClass}
            value={newCustType}
            onChange={(e) => setNewCustType(e.target.value as CustomerType)}
          >
            {custTypes.map((t) => (
              <option key={t} value={t}>{typeLabel(t)}</option>
            ))}
          </select>
          <Button type="submit">Ajouter</Button>
        </form>

        <div className="space-y-2">
          {sortedCustomers.map((c) => (
            <Card
              key={c.id}
              className="py-3 gap-0 cursor-pointer hover:border-primary transition-colors"
              onClick={() => openEditCustomer(c)}
            >
              <CardContent className="flex items-center justify-between">
                <div>
                  <strong className="text-sm font-semibold">{c.name}</strong>
                  <span className="ml-2 text-sm text-muted-foreground">{typeLabel(c.type)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ===== Activités ===== */}
      <section className="space-y-6">
        <h1 className="text-2xl font-semibold">Activités</h1>

        <form onSubmit={handleCreateActivity} className="flex gap-2 items-center flex-wrap">
          <Input
            placeholder="Nom de l'activité"
            value={newActName}
            onChange={(e) => setNewActName(e.target.value)}
            className="flex-1 max-w-80"
          />
          <select
            className={selectClass}
            value={newActCustomerId}
            onChange={(e) => setNewActCustomerId(e.target.value)}
          >
            <option value="">-- Client --</option>
            {customers.customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <Button type="submit">Ajouter</Button>
        </form>

        <div className="space-y-2">
          {sortedActivities.map((activity) => {
            const customerName = customers.customers.find(c => c.id === activity.customerId)?.name;
            return (
              <Card
                key={activity.id}
                className="py-3 gap-0 cursor-pointer hover:border-primary transition-colors"
                onClick={() => openEditActivity(activity)}
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
      </section>

      {/* ===== Dialog: Edit Customer ===== */}
      <Dialog open={!!editingCust} onOpenChange={(open) => { if (!open) setEditingCust(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le client</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Nom</label>
              <Input
                value={editCustName}
                onChange={(e) => setEditCustName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Type</label>
              <select
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                value={editCustType}
                onChange={(e) => setEditCustType(e.target.value as CustomerType)}
              >
                {custTypes.map((t) => (
                  <option key={t} value={t}>{typeLabel(t)}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={async () => {
              if (!editingCust) return;
              await api.deleteCustomer(editingCust.id);
              setEditingCust(null);
              refresh();
            }}>
              Supprimer
            </Button>
            <Button variant="outline" onClick={() => setEditingCust(null)}>Annuler</Button>
            <Button onClick={saveEditCustomer}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Dialog: Edit Activity ===== */}
      <Dialog open={!!editingAct} onOpenChange={(open) => { if (!open) setEditingAct(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier l'activité</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Nom</label>
              <Input
                value={editActName}
                onChange={(e) => setEditActName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Client</label>
              <select
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                value={editActCustomerId}
                onChange={(e) => setEditActCustomerId(e.target.value)}
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
              if (!editingAct) return;
              await api.deleteActivity(editingAct.id);
              setEditingAct(null);
              refresh();
            }}>
              Supprimer
            </Button>
            <Button variant="outline" onClick={() => setEditingAct(null)}>Annuler</Button>
            <Button onClick={saveEditActivity}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
