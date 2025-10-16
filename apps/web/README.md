# Admin UI Overview

The admin UI (React + Vite) lets you manage projects, themes, nodes, and clusters stored in Firestore. It also communicates with the Express API (`apps/api`, default port **3001**) to trigger the pipeline or create nodes.

## Features
- Create / edit projects and themes
- Trigger the keyword pipeline for a project or a single theme
- View and add seed nodes (displayed in the “Node List” panel)
- Inspect generated clusters, outlines, and internal link recommendations
- Review recent job runs in the job-history dialog

## Screen Structure
1. **Project Switcher** – select or create projects, run the full pipeline, edit project metadata
2. **Project Settings** – adjust pipeline thresholds and weights (collapsible)
3. **Theme Table** – per-theme actions (expand for nodes, trigger updates, edit)
4. **Theme Settings** – optional overrides against project defaults
5. **Node List** – shows Firestore `nodes` for the selected theme and allows new entries
6. **Cluster Panel** – displays clusters sorted by priorityScore with outline and link details

## Environment (`apps/web/.env`)
```env
VITE_FIREBASE_API_KEY="..."
VITE_FIREBASE_AUTH_DOMAIN="..."
VITE_FIREBASE_PROJECT_ID="..."
VITE_FIREBASE_STORAGE_BUCKET="..."
VITE_FIREBASE_MESSAGING_SENDER_ID="..."
VITE_FIREBASE_APP_ID="..."
VITE_API_BASE_URL="http://localhost:3001"
```
Ensure the API server (apps/api) is running before executing “更新” from the UI.

## Local Development
```bash
npm install
npm run dev --workspace apps/api      # Express API (port 3001)
npm run dev --workspace @keywords/web # Vite dev server (default 5173)
```

With both servers running, open http://localhost:5173 to manage real Firestore data.
