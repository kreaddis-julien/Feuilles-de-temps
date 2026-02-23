import { useState, useEffect, useCallback } from 'react';
import type { Activity, ActivitiesData, CustomersData } from '../types';
import * as api from '../api';

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
    <div className="activities-page">
      <h1>Activités</h1>

      <form onSubmit={handleCreate} className="add-activity-form">
        <input
          type="text"
          placeholder="Nom de l'activité"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <select value={newCustomerId} onChange={(e) => setNewCustomerId(e.target.value)}>
          <option value="">-- Client --</option>
          {customers.customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button type="submit">Ajouter</button>
      </form>

      <div className="activities-list">
        {sorted.map((activity) => {
          const customerName = customers.customers.find(c => c.id === activity.customerId)?.name;
          return (
            <div key={activity.id} className="activity-card" onClick={() => openEdit(activity)}>
              <div>
                <strong>{activity.name}</strong>
                {customerName && <span className="activity-customer">{customerName}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h2>Modifier l'activité</h2>
            <div className="modal-field">
              <label>Nom</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="modal-field">
              <label>Client</label>
              <select value={editCustomerId} onChange={(e) => setEditCustomerId(e.target.value)}>
                <option value="">-- Aucun --</option>
                {customers.customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-danger" onClick={async () => {
                await handleDelete(editing.id);
                setEditing(null);
              }}>
                Supprimer
              </button>
              <button onClick={() => setEditing(null)}>Annuler</button>
              <button className="btn-primary" onClick={saveEdit}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
