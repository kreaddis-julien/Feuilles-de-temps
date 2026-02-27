import { useState, useEffect, useCallback } from 'react';
import type { Customer, CustomersData, CustomerType } from '../types';
import * as api from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

export default function CustomersPage() {
  const [data, setData] = useState<CustomersData>({ customers: [] });
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<CustomerType>('externe');
  const [editing, setEditing] = useState<Customer | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<CustomerType>('externe');

  const refresh = useCallback(async () => {
    const d = await api.getCustomers();
    setData(d);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await api.createCustomer({ name: newName.trim(), type: newType });
    setNewName('');
    refresh();
  };

  const handleDelete = async (id: string) => {
    await api.deleteCustomer(id);
    refresh();
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setEditName(c.name);
    setEditType(c.type);
  };

  const saveEdit = async () => {
    if (!editing || !editName.trim()) return;
    await api.updateCustomer(editing.id, { name: editName.trim(), type: editType });
    setEditing(null);
    refresh();
  };

  const types: CustomerType[] = ['externe', 'interne'];
  const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const sorted = [...data.customers].sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <h1 className="text-2xl font-semibold">Clients</h1>

      <form onSubmit={handleCreate} className="flex gap-2 items-center flex-wrap">
        <Input
          placeholder="Nom du client"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 max-w-80"
        />
        <select
          className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] min-w-32"
          value={newType}
          onChange={(e) => setNewType(e.target.value as CustomerType)}
        >
          {types.map((t) => (
            <option key={t} value={t}>{typeLabel(t)}</option>
          ))}
        </select>
        <Button type="submit">Ajouter</Button>
      </form>

      <div className="space-y-2">
        {sorted.map((c) => (
          <Card
            key={c.id}
            className="py-3 gap-0 cursor-pointer hover:border-primary transition-colors"
            onClick={() => openEdit(c)}
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

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le client</DialogTitle>
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
              <label className="text-sm font-medium text-muted-foreground">Type</label>
              <select
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                value={editType}
                onChange={(e) => setEditType(e.target.value as CustomerType)}
              >
                {types.map((t) => (
                  <option key={t} value={t}>{typeLabel(t)}</option>
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
