# Timesheet Tracker

Application web locale de suivi du temps avec gestion des interruptions (pile LIFO), optimisée pour le reporting Odoo. Le temps est comptabilisé par tranches de 15 minutes avec support pause/reprise pour les interruptions de tâches.

## Fonctionnalités

- **Timer en temps réel** — Chronomètre persistant (survit au rafraîchissement du navigateur)
- **Gestion des interruptions** — Pile LIFO : démarrer une nouvelle tâche met automatiquement la tâche en cours en pause
- **Projets et tâches** — Organisés par catégorie (client, interne, support)
- **Arrondi au quart d'heure** — Le temps est arrondi aux 15 minutes supérieures à la complétion
- **Export CSV** — Export journalier ou par plage de dates, compatible import Odoo

## Prérequis

- [Bun](https://bun.sh/) (v1.0+)

## Installation

```bash
git clone https://github.com/kreaddis-julien/timesheet.git
cd timesheet
bun install
```

## Démarrage

```bash
# Lancer le frontend et le backend en parallèle
bun run dev
```

L'application est accessible sur **http://localhost:5173**. Le serveur API tourne sur le port 3001 (le proxy Vite redirige automatiquement les appels `/api`).

Pour lancer les serveurs séparément :

```bash
bun run dev:server   # Backend uniquement (port 3001)
bun run dev:client   # Frontend uniquement (port 5173)
```

## Tests

```bash
bun run test          # Tous les tests
bun run test:server   # Tests serveur uniquement
bun run test:client   # Tests client uniquement
```

## Stack technique

| Couche | Technologies |
|--------|-------------|
| Frontend | React 19, TypeScript, Vite, React Router |
| Backend | Express 5, TypeScript, Bun |
| Stockage | Fichiers JSON (`data/`) — un fichier par jour + registre projets |
| Tests | Vitest, Testing Library, Supertest |

## Structure du projet

```
timesheet/
├── client/          # Frontend React + Vite
│   └── src/
│       ├── pages/   # TrackerPage, ProjectsPage
│       ├── api.ts   # Client API typé
│       └── types.ts
├── server/          # Backend Express
│   └── src/
│       ├── routes/  # timesheet, projects, export
│       ├── storage.ts
│       ├── time-utils.ts
│       └── types.ts
└── data/            # Données JSON (créé automatiquement)
```

## Licence

Privé
