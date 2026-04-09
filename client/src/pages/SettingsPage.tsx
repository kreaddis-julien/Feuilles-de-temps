import { useState, useEffect, useCallback } from 'react';
import type { Activity, ActivitiesData, Customer, CustomersData, CustomerType, TrackingConfig } from '../types';
import * as api from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Monitor, Search, X, Plus, Trash2, ChevronLeft } from 'lucide-react';

export default function SettingsPage() {
  const [activities, setActivities] = useState<ActivitiesData>({ activities: [] });
  const [customers, setCustomers] = useState<CustomersData>({ customers: [] });

  // Customer form
  const [newCustName, setNewCustName] = useState('');
  const [newCustType, setNewCustType] = useState<CustomerType>('externe');
  const [editingCust, setEditingCust] = useState<Customer | null>(null);
  const [editCustName, setEditCustName] = useState('');
  const [editCustType, setEditCustType] = useState<CustomerType>('externe');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewCust, setShowNewCust] = useState(false);
  const [newCustActivities, setNewCustActivities] = useState<Set<string>>(new Set());
  const [newCategoryName, setNewCategoryName] = useState('');

  // Activity categories
  const defaultCategories = ['Odoo', 'Web', 'Dev', 'Interne', 'Support', 'Gestion de projet', 'Formation', 'Divers'];
  const existingNames = [...new Set(activities.activities.map(a => a.name))];
  const activityCategories = [...new Set([...defaultCategories, ...existingNames])].sort((a, b) => a.localeCompare(b, 'fr'));

  // Tracking
  const [trackingConfig, setTrackingConfig] = useState<TrackingConfig>({ screenEnabled: true, micEnabled: false });
  const [ollamaStatus, setOllamaStatus] = useState<{ available: boolean; models: string[] }>({ available: false, models: [] });
  const [trackingStats, setTrackingStats] = useState<{ fileCount: number } | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<'clients' | 'tracking'>('clients');

  const refresh = useCallback(async () => {
    const [a, c] = await Promise.all([api.getActivities(), api.getCustomers()]);
    setActivities(a);
    setCustomers(c);
  }, []);

  const refreshTracking = useCallback(async () => {
    try {
      const [config, ollama] = await Promise.all([
        api.getTrackingConfig(),
        fetch(`${api.BASE}/tracking/ollama/status`).then(r => r.json()).catch(() => ({ available: false, models: [] })),
      ]);
      setTrackingConfig(config);
      setOllamaStatus(ollama);
      const dates = await api.getReportDates();
      setTrackingStats({ fileCount: dates.length });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { refreshTracking(); }, [refreshTracking]);

  async function toggleScreen() {
    const updated = await api.updateTrackingConfig({ screenEnabled: !trackingConfig.screenEnabled });
    setTrackingConfig(updated);
  }


  // --- Customers ---
  const handleCreateCustomer = async () => {
    if (!newCustName.trim()) return;
    await api.createCustomer({ name: newCustName.trim(), type: newCustType });
    // Create activities for the new customer
    const newCustomers = await api.getCustomers();
    const created = newCustomers.customers.find(c => c.name === newCustName.trim());
    if (created) {
      for (const actName of newCustActivities) {
        await api.createActivity({ name: actName, customerId: created.id });
      }
    }
    setNewCustName('');
    setNewCustType('externe');
    setNewCustActivities(new Set());
    setShowNewCust(false);
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
  function getCustomerActivities(customerId: string): Activity[] {
    return activities.activities.filter(a => a.customerId === customerId);
  }

  async function toggleActivity(customerId: string, activityName: string) {
    const existing = activities.activities.find(a => a.customerId === customerId && a.name === activityName);
    if (existing) {
      await api.deleteActivity(existing.id);
    } else {
      await api.createActivity({ name: activityName, customerId });
    }
    refresh();
  }

  const [addingCategory, setAddingCategory] = useState(false);

  async function addCustomCategory(customerId: string) {
    if (!newCategoryName.trim()) return;
    await api.createActivity({ name: newCategoryName.trim(), customerId });
    setNewCategoryName('');
    setAddingCategory(false);
    refresh();
  }

  const custTypes: CustomerType[] = ['externe', 'interne'];
  const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

  const filteredCustomers = [...customers.customers]
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .filter(c => !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Tabs */}
      <div className="flex gap-1.5 border-b border-border pb-1">
        <button
          onClick={() => setActiveTab('clients')}
          className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
            activeTab === 'clients'
              ? 'text-primary bg-primary/10 border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Clients & Activités
        </button>
        <button
          onClick={() => setActiveTab('tracking')}
          className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
            activeTab === 'tracking'
              ? 'text-primary bg-primary/10 border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Tracking
        </button>
      </div>

      {activeTab === 'tracking' && (
        <section className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="py-4 gap-0">
              <CardContent className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Monitor className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Tracking écran</p>
                    <p className="text-xs text-muted-foreground">App active, titre, URL</p>
                  </div>
                </div>
                <button
                  onClick={toggleScreen}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    trackingConfig.screenEnabled ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    trackingConfig.screenEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </CardContent>
            </Card>

          </div>

          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between px-1">
              <span className="text-muted-foreground">Ollama</span>
              <span className={ollamaStatus.available ? 'text-green-600' : 'text-destructive'}>
                {ollamaStatus.available ? `Connecté (${ollamaStatus.models.join(', ')})` : 'Non disponible'}
              </span>
            </div>
            {trackingStats && (
              <div className="flex items-center justify-between px-1">
                <span className="text-muted-foreground">Données de tracking</span>
                <span>{trackingStats.fileCount} jour(s)</span>
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === 'clients' && !editingCust && (
        <section className="space-y-4">
          {/* Search + Add */}
          <div className="flex gap-2 items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un client..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Button size="sm" onClick={() => { setNewCustName(''); setNewCustType('externe'); setNewCustActivities(new Set()); setShowNewCust(true); }}>
              <Plus className="h-4 w-4" />
              Nouveau client
            </Button>
          </div>

          {/* Client grid */}
          <div className="grid gap-2 sm:grid-cols-2">
            {filteredCustomers.map((c) => {
              const custActivities = getCustomerActivities(c.id);
              return (
                <Card
                  key={c.id}
                  className="py-3 gap-0 cursor-pointer hover:border-primary/50 transition-colors group"
                  onClick={() => openEditCustomer(c)}
                >
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <strong className="text-sm font-semibold">{c.name}</strong>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          c.type === 'interne'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        }`}>
                          {typeLabel(c.type)}
                        </span>
                      </div>
                    </div>
                    {custActivities.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {custActivities.map((a) => (
                          <span key={a.id} className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                            {a.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {filteredCustomers.length === 0 && searchQuery && (
            <p className="text-center text-muted-foreground py-8 text-sm">Aucun client trouvé pour "{searchQuery}"</p>
          )}
        </section>
      )}

      {/* ===== Client Detail / Edit View ===== */}
      {activeTab === 'clients' && editingCust && (
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => setEditingCust(null)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-xl font-semibold">{editingCust.name}</h2>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              editingCust.type === 'interne'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
            }`}>
              {typeLabel(editingCust.type)}
            </span>
          </div>

          {/* Edit name/type */}
          <Card className="py-4 gap-0">
            <CardContent className="space-y-3">
              <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <label className="text-xs text-muted-foreground">Nom</label>
                  <Input
                    value={editCustName}
                    onChange={(e) => setEditCustName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Type</label>
                  <select
                    className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm min-w-28"
                    value={editCustType}
                    onChange={(e) => setEditCustType(e.target.value as CustomerType)}
                  >
                    {custTypes.map((t) => (
                      <option key={t} value={t}>{typeLabel(t)}</option>
                    ))}
                  </select>
                </div>
                <Button size="sm" onClick={saveEditCustomer}>Enregistrer</Button>
              </div>
            </CardContent>
          </Card>

          {/* Activities as toggleable chips */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Activités</h3>
            <div className="flex flex-wrap gap-2">
              {activityCategories.map((name) => {
                const isActive = activities.activities.some(a => a.customerId === editingCust.id && a.name === name);
                return (
                  <button
                    key={name}
                    onClick={() => toggleActivity(editingCust.id, name)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    {isActive ? '✓ ' : ''}{name}
                  </button>
                );
              })}
              {addingCategory ? (
                <form onSubmit={(e) => { e.preventDefault(); addCustomCategory(editingCust.id); }} className="inline-flex gap-1">
                  <input
                    autoFocus
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="Nom..."
                    className="h-8 w-28 rounded-full border border-input bg-transparent px-3 text-sm"
                    onBlur={() => { if (!newCategoryName.trim()) setAddingCategory(false); }}
                  />
                  <Button type="submit" size="sm" className="h-8 rounded-full">OK</Button>
                </form>
              ) : (
                <button
                  onClick={() => { setNewCategoryName(''); setAddingCategory(true); }}
                  className="px-3 py-1.5 rounded-full text-sm font-medium border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-all"
                >
                  + Autre
                </button>
              )}
            </div>
          </div>

          {/* Danger zone */}
          <div className="pt-4 border-t border-border">
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                if (!confirm(`Supprimer le client "${editingCust.name}" et toutes ses activités ?`)) return;
                // Delete all activities for this customer first
                const custActs = activities.activities.filter(a => a.customerId === editingCust.id);
                for (const a of custActs) {
                  await api.deleteActivity(a.id);
                }
                await api.deleteCustomer(editingCust.id);
                setEditingCust(null);
                refresh();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Supprimer ce client
            </Button>
          </div>
        </section>
      )}

      {/* ===== Dialog: New Customer ===== */}
      <Dialog open={showNewCust} onOpenChange={setShowNewCust}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nouveau client</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-xs text-muted-foreground">Nom</label>
                <Input
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="Nom du client"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Type</label>
                <select
                  className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm min-w-28"
                  value={newCustType}
                  onChange={(e) => setNewCustType(e.target.value as CustomerType)}
                >
                  {custTypes.map((t) => (
                    <option key={t} value={t}>{typeLabel(t)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Activités</label>
              <div className="flex flex-wrap gap-2">
                {activityCategories.map((name) => {
                  const isActive = newCustActivities.has(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        setNewCustActivities(prev => {
                          const next = new Set(prev);
                          if (next.has(name)) next.delete(name); else next.add(name);
                          return next;
                        });
                      }}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      {isActive ? '✓ ' : ''}{name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewCust(false)}>Annuler</Button>
            <Button onClick={handleCreateCustomer} disabled={!newCustName.trim()}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
