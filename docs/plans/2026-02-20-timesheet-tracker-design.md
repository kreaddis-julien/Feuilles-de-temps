# Timesheet Tracker — Design Document

**Date :** 2026-02-20
**Objectif :** Application web locale pour optimiser le reporting de feuilles de temps sur Odoo, avec gestion des interruptions.

## Contexte

Consultant/dev en entreprise jonglant entre tâches clients (facturables), support (tickets) et tâches internes. Les interruptions sont fréquentes. Le reporting Odoo est fait manuellement — l'app sert à tracker le temps précisément puis exporter en CSV.

## Architecture

```
[React + TS + Vite]  <--REST API-->  [Express + TS]  <--fs-->  [data/*.json]
     (client/)                          (server/)              [exports/*.csv]
```

- **Frontend :** React + TypeScript + Vite (port 5173)
- **Backend :** Node.js + Express + TypeScript (port 3001)
- **Stockage :** Fichiers JSON locaux — un par jour (`data/YYYY-MM-DD.json`) + un référentiel (`data/projects.json`)
- **Monorepo simple :** `client/` et `server/`

## Modèle de données

### Référentiel projets/tâches (`data/projects.json`)

```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "Client ABC - Migration ERP",
      "category": "client | interne | support",
      "tasks": [
        { "id": "uuid", "name": "Migration données comptables" }
      ]
    }
  ]
}
```

### Feuille de temps journalière (`data/YYYY-MM-DD.json`)

```json
{
  "date": "2026-02-20",
  "entries": [
    {
      "id": "uuid",
      "projectId": "proj-uuid",
      "taskId": "task-uuid",
      "description": "Description libre du travail effectué",
      "segments": [
        { "start": "08:00", "end": "10:15" },
        { "start": "11:00", "end": null }
      ],
      "totalMinutes": 195,
      "roundedMinutes": 195,
      "status": "active | paused | completed"
    }
  ],
  "activeEntry": "entry-uuid | null",
  "pausedEntries": ["entry-uuid"]
}
```

**Segments :** Chaque entrée a un ou plusieurs segments de temps. Quand une tâche est interrompue puis reprise, un nouveau segment est créé. Un segment avec `end: null` indique un timer en cours.

## Approche choisie : Timer-first avec pile d'interruptions

Un seul timer actif à la fois. Quand l'utilisateur est interrompu :
1. La tâche en cours est mise en pause (empilée dans `pausedEntries`)
2. Une nouvelle tâche est créée et son timer démarre
3. Quand l'interruption est terminée, la tâche précédente reprend automatiquement

Les interruptions peuvent s'empiler (interruption pendant une interruption).

## Interface utilisateur

### Vue 1 : Tracker (accueil)

- **Tâche en cours** : nom projet/tâche, description, timer en temps réel, boutons [Pause & Interruption] et [Terminer]
- **Tâches en pause** : pile avec bouton [Reprendre] sur chaque
- **Entrées terminées** : liste des entrées du jour avec durées arrondies
- **Barre de progression** : total arrondi vs. objectif journée (8h par défaut)
- **Navigation par date** : voir les jours précédents
- **Bouton [+ Nouvelle tâche]** : formulaire avec sélecteurs projet/tâche (combobox avec recherche) + création à la volée via bouton "+"
- **Bouton [Export CSV]** : export du jour ou d'une période

### Vue 2 : Gestion projets/tâches

CRUD sur le référentiel : liste des projets avec leurs tâches, création, modification, suppression.

## API REST

### Entrées de temps
- `GET /api/timesheet/:date`
- `POST /api/timesheet/:date/entries`
- `PATCH /api/timesheet/:date/entries/:id`
- `DELETE /api/timesheet/:date/entries/:id`
- `POST /api/timesheet/:date/entries/:id/pause`
- `POST /api/timesheet/:date/entries/:id/resume`

### Projets/Tâches
- `GET /api/projects`
- `POST /api/projects`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`
- `POST /api/projects/:id/tasks`
- `DELETE /api/projects/:id/tasks/:taskId`

### Export
- `GET /api/export/:date?format=csv`
- `GET /api/export?from=:date&to=:date&format=csv`

## Règles métier

### Arrondi aux 15 minutes
- Arrondi au quart d'heure supérieur à la terminaison (37 min → 45 min, 16 min → 30 min)
- Ajustement manuel possible après coup

### Timer
- Un seul timer actif à la fois
- Plusieurs tâches en pause simultanément (pile LIFO)
- Timer persistant : si le navigateur est fermé, au rechargement le temps est recalculé via les timestamps (pas de setInterval côté serveur)
- La source de vérité est le champ `start` du dernier segment ouvert

### Journée
- Objectif par défaut : 8h (configurable)
- Barre de progression basée sur le total arrondi

## Export CSV

Colonnes : Date, Projet, Catégorie, Tâche, Description, Heure début (premier segment), Heure fin (dernier segment), Durée réelle (min), Durée arrondie (min), Nombre de segments, Nombre d'interruptions
