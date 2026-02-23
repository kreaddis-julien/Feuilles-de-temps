import { useState, useEffect, useCallback } from 'react';
import type { Customer, CustomersData, CustomerType } from '../types';
import * as api from '../api';

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
    <div className="activities-page">
      <h1>Clients</h1>

      <form onSubmit={handleCreate} className="add-activity-form">
        <input
          type="text"
          placeholder="Nom du client"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <select value={newType} onChange={(e) => setNewType(e.target.value as CustomerType)}>
          {types.map((t) => (
            <option key={t} value={t}>{typeLabel(t)}</option>
          ))}
        </select>
        <button type="submit">Ajouter</button>
      </form>

      <div className="customers-list">
        {sorted.map((c) => (
          <div key={c.id} className="customer-card" onClick={() => openEdit(c)}>
            <div>
              <strong>{c.name}</strong>
              <span className="activity-customer">{typeLabel(c.type)}</span>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h2>Modifier le client</h2>
            <div className="modal-field">
              <label>Nom</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="modal-field">
              <label>Type</label>
              <select value={editType} onChange={(e) => setEditType(e.target.value as CustomerType)}>
                {types.map((t) => (
                  <option key={t} value={t}>{typeLabel(t)}</option>
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
