# Tempo v2 — Vision & Ideas

## Context

Ideas collected during the precise matching pipeline implementation (2026-04-03). These represent the future direction of Tempo beyond the current couche 1 + LLM pipeline.

## Immediate Improvements (current sprint)

1. **Remove audio tracking** — Whisper sans diarisation = plus de bruit que de signal
2. **LLM prompt chaining** — 3 appels focalisés au lieu d'un prompt massif :
   - Etape 1: Résumer le travail dev (prompts Claude + git)
   - Etape 2: Matcher les blocs non identifiés (avec contexte digéré)
   - Etape 3: Générer les descriptions (avec style profile)
3. **Style profile / mémoire longue** — L'app apprend du style de l'utilisateur :
   - Descriptions fréquentes par activité
   - Vocabulaire utilisé
   - Corrections faites (LLM proposait X → utilisateur a mis Y)
   - Stocké dans `style-profile.json`, injecté en début de prompt (~20-30 lignes)
   - Mis à jour à chaque validation de rapport
4. **Hook Claude Code enrichi** — Envoyer branche git, dernier commit, fichiers modifiés en plus du prompt
5. **Bouton Recalculer** — Fusionne entrées par activité + régénère descriptions après assignation manuelle

## Future Features (Tempo v2)

### LLM configurable
- Ne pas hardcoder le modèle (actuellement qwen3.5:9b-q8_0)
- Détecter Ollama automatiquement, lister les modèles disponibles
- Permettre de choisir le modèle dans les paramètres
- Proposer `ollama pull` depuis l'UI pour installer des modèles
- Supporter d'autres backends : llama.cpp, LM Studio, API cloud (Claude, OpenAI)
- Adapter num_ctx et paramètres selon le modèle choisi

### Extension Chrome
- Extension navigateur connectée à Tempo
- Fournit : URL complète, titre exact onglet actif, temps par onglet, onglets simultanés
- Beaucoup plus riche que l'AppleScript (fenêtre active uniquement)
- Configurable dans les paramètres de l'app

### Google Calendar integration
- Connecter le compte Google dans les paramètres
- Fetch les événements du jour au moment de la génération
- Chaque événement = signal fort pour l'attribution de temps
- "Point GemAddis 14:00-14:30" → attribution exacte des sessions Meet/Teams
- Utilise le MCP Google Calendar déjà disponible

### Git log comme source de données
- Analyser `git log --since=today --all` au moment de la génération
- Chaque commit : message, branche, timestamp, fichiers modifiés
- Source la plus fiable de ce qui a été **produit** dans la journée
- Configurer les repos à surveiller dans les paramètres

### Sync tâches/tickets Odoo
- Synchroniser les tâches et tickets Odoo dans Tempo
- Chaque entrée Tempo = une tâche/ticket Odoo
- Le matching se fait par tâche, pas par plage horaire
- Push automatique des timesheets validés vers Odoo
- Objectif : zéro saisie manuelle dans Odoo

### Cartographie projets via Claude Code
- Scanner les CLAUDE.md de tous les projets sur le système
- Lire les conversations Claude Code pour comprendre le contexte de chaque projet
- Construire automatiquement une carte des projets et leur client associé
- Alimenter le matching sans configuration manuelle
- Visualisation dans Tempo de l'ensemble des projets et conversations

### Contexte temporel pour le matching
- Envoyer la timeline ordonnée au LLM (pas des blocs agrégés)
- Si avant = GemAddis et après = GemAddis → le bloc inconnu au milieu = probablement GemAddis
- Enrichir la couche 1 avec cette heuristique

### Patterns de titres appris
- Après plusieurs semaines, l'app apprend que "Factures - * - Odoo" = client dans le titre
- Que "PR #" sur GitHub = projet de la branche
- Ces règles intégrées dans la couche 1 sans LLM

### Feedback loop automatique
- Quand l'utilisateur corrige une description ou réassigne un bloc, stocker la correction
- "LLM proposait X → utilisateur a mis Y"
- Le style profile s'enrichit automatiquement

## Architecture LLM cible

```
Sources:
  Screen sessions ─┐
  Claude prompts  ─┤
  Git log du jour ─┤──→ [Couche 1: Matching direct] ──→ Entrées matchées
  Calendar events ─┤     (cmux, domains, calendar)         │
  Chrome extension─┘                                        │
                                                            ▼
  Blocs non matchés ──→ [Chain LLM]                    
    Etape 1: Résumé dev (prompts + git) ──→ contexte dev
    Etape 2: Matching (blocs + contexte) ──→ attributions
    Etape 3: Descriptions (tout + style) ──→ descriptions pro
                                                            │
  Style profile ──→ injecté dans étape 3                    │
  Mémoire corrections ──→ améliore couche 1                 ▼
                                              [UI Validation]
                                              ├─ Recalculer (fusionne + descriptions)
                                              ├─ Valider → push Odoo
                                              └─ Corrections → feedback loop
```

## Out of Scope
- Multi-user / multi-tenant
- Mobile app
- Keyboard/mouse tracking
