import { useState, useEffect, useCallback } from 'react';
import type { Activity, ActivitiesData, Customer, CustomersData, CustomerType } from '../types';
import * as api from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Search, X, Plus, Trash2, ChevronLeft, ChevronRight, RefreshCw, Download } from 'lucide-react';
import { isDesktop, getAppVersion, checkForUpdates, openExternal } from '@/desktop';

const RELEASES_URL = 'https://github.com/kreaddis-julien/Feuilles-de-temps/releases/latest';

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

  // App version + update check (desktop only)
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<{ text: string; kind: 'available' | 'uptodate' | 'error' } | null>(null);
  const [updateUrl, setUpdateUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [a, c] = await Promise.all([api.getActivities(), api.getCustomers()]);
    setActivities(a);
    setCustomers(c);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!isDesktop) return;
    getAppVersion().then(v => { if (v) setAppVersion(v); });
  }, []);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateMsg(null);
    setUpdateUrl(null);
    try {
      const res = await checkForUpdates();
      if (!res || !res.ok) {
        setUpdateMsg({ text: 'Vérification impossible pour le moment.', kind: 'error' });
      } else if (res.available) {
        setUpdateUrl(res.url ?? RELEASES_URL);
        setUpdateMsg({ text: `Nouvelle version disponible : v${res.version}`, kind: 'available' });
      } else if (res.noRelease) {
        setUpdateMsg({ text: 'Aucune version publiée pour le moment.', kind: 'uptodate' });
      } else {
        setUpdateMsg({ text: `Vous êtes à jour (v${res.current ?? appVersion}).`, kind: 'uptodate' });
      }
    } catch {
      setUpdateMsg({ text: 'Vérification impossible pour le moment.', kind: 'error' });
    } finally {
      setCheckingUpdate(false);
    }
  };

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
      {!editingCust && (
        <section className="space-y-4">
          {/* Page header */}
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight">Clients</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {customers.customers.length} client{customers.customers.length > 1 ? 's' : ''} · gérez leurs activités facturables
              </p>
            </div>
            <Button size="sm" onClick={() => { setNewCustName(''); setNewCustType('externe'); setNewCustActivities(new Set()); setShowNewCust(true); }}>
              <Plus className="h-4 w-4" />
              Nouveau client
            </Button>
          </div>

          {/* Search */}
          <div className="relative max-w-sm">
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

          {/* Client list (Vercel-style rows) */}
          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {filteredCustomers.map((c) => {
              const custActivities = getCustomerActivities(c.id);
              return (
                <button
                  key={c.id}
                  className="w-full flex items-center justify-between gap-4 px-4 py-3.5 text-left bg-card hover:bg-accent/60 transition-colors cursor-pointer"
                  onClick={() => openEditCustomer(c)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${c.type === 'interne' ? 'bg-tempo' : 'bg-success'}`}
                      aria-hidden="true"
                    />
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{typeLabel(c.type)}</span>
                  </div>
                  <div className="flex items-center gap-3 min-w-0 shrink">
                    <span className="text-xs text-muted-foreground truncate">
                      {custActivities.length > 0
                        ? custActivities.map(a => a.name).join(' · ')
                        : 'Aucune activité'}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  </div>
                </button>
              );
            })}
            {filteredCustomers.length === 0 && (
              <p className="text-center text-muted-foreground py-10 text-sm bg-card">
                {searchQuery ? `Aucun client trouvé pour "${searchQuery}"` : 'Aucun client pour le moment'}
              </p>
            )}
          </div>
        </section>
      )}

      {/* ===== À propos / Mises à jour ===== */}
      {!editingCust && isDesktop && (
        <section className="space-y-3 pt-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">À propos</h3>
          <Card className="py-4 gap-0">
            <CardContent className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Gestionnaire de feuilles de temps</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Version {appVersion ?? '—'}
                </p>
                {updateMsg && (
                  <p
                    className={`text-xs mt-1.5 ${
                      updateMsg.kind === 'available'
                        ? 'text-tempo font-medium'
                        : updateMsg.kind === 'error'
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {updateMsg.text}
                  </p>
                )}
              </div>
              <div className="shrink-0">
                {updateMsg?.kind === 'available' && updateUrl ? (
                  <Button size="sm" onClick={() => openExternal(updateUrl)}>
                    <Download className="h-4 w-4" />
                    Télécharger
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={handleCheckUpdate} disabled={checkingUpdate}>
                    <RefreshCw className={`h-4 w-4 ${checkingUpdate ? 'animate-spin' : ''}`} />
                    {checkingUpdate ? 'Vérification…' : 'Vérifier les mises à jour'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ===== Client Detail / Edit View ===== */}
      {editingCust && (
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8 -ml-2" onClick={() => setEditingCust(null)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{editingCust.name}</h1>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={`h-2 w-2 rounded-full ${editingCust.type === 'interne' ? 'bg-tempo' : 'bg-success'}`}
                aria-hidden="true"
              />
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
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Activités facturables</h3>
            <div className="flex flex-wrap gap-1.5">
              {activityCategories.map((name) => {
                const isActive = activities.activities.some(a => a.customerId === editingCust.id && a.name === name);
                return (
                  <button
                    key={name}
                    onClick={() => toggleActivity(editingCust.id, name)}
                    aria-pressed={isActive}
                    className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm transition-all cursor-pointer ${
                      isActive
                        ? 'border-foreground bg-foreground text-background font-medium'
                        : 'border-border bg-transparent text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground'
                    }`}
                  >
                    {isActive && <span aria-hidden="true">✓</span>}
                    {name}
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
                    className="h-8 w-28 rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                    onBlur={() => { if (!newCategoryName.trim()) setAddingCategory(false); }}
                  />
                  <Button type="submit" size="sm" className="h-8">OK</Button>
                </form>
              ) : (
                <button
                  onClick={() => { setNewCategoryName(''); setAddingCategory(true); }}
                  className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground/60 transition-all cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Autre
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Cliquez pour activer ou désactiver une activité pour ce client.</p>
          </div>

          {/* Danger zone */}
          <div className="pt-4 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
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
              <div className="flex flex-wrap gap-1.5">
                {activityCategories.map((name) => {
                  const isActive = newCustActivities.has(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => {
                        setNewCustActivities(prev => {
                          const next = new Set(prev);
                          if (next.has(name)) next.delete(name); else next.add(name);
                          return next;
                        });
                      }}
                      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm transition-all cursor-pointer ${
                        isActive
                          ? 'border-foreground bg-foreground text-background font-medium'
                          : 'border-border bg-transparent text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground'
                      }`}
                    >
                      {isActive && <span aria-hidden="true">✓</span>}
                      {name}
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
