# RAILPULSE AI

**Tagline:** Smarter Inspections. Better Maintenance. Reliable Railways.

RailPulse AI is a railway asset inspection and maintenance management platform written in simple, natural English for railway operations and maintenance teams.

> **Important Note:** RailPulse AI helps railway teams organize assets, inspections, repairs, and reports. It does not replace human safety checks or engineering decisions, and claims no official affiliation or endorsement by Indian Railways.

---

## Features

- **Dashboard (`/`)**: Live database counts (total assets, inspections completed, inspections waiting, open maintenance tasks, critical alerts, assets requiring attention), upcoming inspections, maintenance progress, fault category chart, asset condition overview, recent activities, and category/date filters.
- **Railway Assets (`/assets`)**: Manage Railway Tracks, Bridges, Railway Stations, Signals, Level Crossings, and Railway Equipment with search, sorting, filtering, condition & status tracking, photo attachments, maintenance history, and optional verified GPS coordinates.
- **Manage Inspections & AI Check (`/inspections`)**: Step-by-step inspection recording with photo uploads (JPG, PNG, WebP up to 5 MB), AI-assisted inspection review (observation, possible fault category, image evidence, AI confidence, suggested next steps, and human verification), and human approval workflow.
- **Maintenance Tasks (`/maintenance`)**: Track repair tasks through `New`, `Assigned`, `In Progress`, `Waiting for Review`, and `Completed`, assign team members, upload supporting repair photos, add work notes, and inspect full task history.
- **Asset Map (`/map`)**: Interactive zoomable map displaying only verified GPS coordinates stored in the database (never fake routes or invented locations).
- **Schedule Calendar (`/calendar`)**: Monthly and weekly calendar views for upcoming inspections, task deadlines, and completed activities.
- **Analytics & Trends (`/analytics`)**: Fault category distribution, monthly inspection activity, maintenance completion rate, asset condition breakdown by type, and inspection history.
- **Reports (`/reports`)**: View and download PDF or CSV reports for Inspection Reports, Asset Condition Reports, Maintenance Reports, Team Activity Reports, and Fault Summary Reports.
- **Notifications (`/notifications`)**: Central notification centre for new inspections, assigned tasks, reviews, completed tasks, asset alerts, and upcoming inspection reminders.
- **Team Management (`/team`)**: Admin workspace for `Admin`, `Inspector`, `Engineer`, and `Maintenance Staff` roles, asset type schedules, system activity logs, live **System Health** checks, and online database backups.
- **Global Search**: Top header search bar across Assets, Inspections, Maintenance Tasks, Team Members, and Reports.
- **Raily Helper**: Cute floating animated railway assistant grounded in live database records (uses connected Gemini AI when `GEMINI_API_KEY` is set, or clearly states Guided Help mode when unavailable).

For full architecture, database, API, security, CI/CD, backup/recovery, and troubleshooting documentation, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Running Locally

```bash
npm install
pip install -r requirements.txt
npm run build
python -m uvicorn api.index:app --host 127.0.0.1 --port 8000
```

For development with Vite HMR:
```bash
python -m uvicorn api.index:app --reload --port 8000
npm run dev
```

---

## Testing

```bash
python -m unittest discover -s tests -v
npm test
npm run lint
npm run build
```

---

## Demo Login Accounts (`RAILPULSE_ENABLE_DEMO_DATA=true`)

| Role | Username | Password |
| :--- | :--- | :--- |
| Admin | `admin.demo` | `Admin@2026!` |
| Inspector | `inspector.demo` | `Inspector@2026!` |
| Engineer | `engineer.demo` | `Engineer@2026!` |
| Maintenance Staff | `staff.demo` | `Staff@2026!` |
