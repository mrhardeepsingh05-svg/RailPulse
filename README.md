# RAILPULSE AI

**Intelligent Railway Asset Inspection & Maintenance Management System**  
**Tagline:** Smarter Inspections. Better Maintenance. Reliable Railways.

> **Important Safety & Data Integrity Notice:** RailPulse AI assists authorised railway teams in organizing asset records, inspections, repairs, and reports. It does **not** replace professional human safety inspections or engineering decisions, claims **no** official affiliation or endorsement by Indian Railways, and clearly distinguishes `DEMO DATA`, `LIVE DATA`, `AI-GENERATED SUGGESTIONS`, and `PREDICTIVE ESTIMATES`.

---

## Problem Statement

Railway maintenance operations involve periodic asset inspections, condition records, fault reporting, repair task assignment, and completion tracking. Managing these workflows across disconnected spreadsheets or manual paperwork makes defect follow-up, historical trend visibility, and timely maintenance reporting difficult for engineering and maintenance teams.

## Proposed Solution

RailPulse AI is a centralized full-stack GovTech platform that connects railway asset inventories, digital photo-backed inspections, transparent AI-assisted observation triage, rule-based predictive maintenance watchlists, role-based repair task tracking, verified GIS asset mapping, scheduling, analytics, and audit-ready PDF/CSV reporting behind a single role-enforced API and database.

---

## Core Features & Module Alignment

1. **Dashboard / Command Center (`/`)**: Live database-calculated KPIs (`Total Railway Assets`, `Inspections Completed`, `Inspections Waiting`, `Open Maintenance Tasks`, `Critical Alerts`, `Assets Requiring Attention`), asset condition overview, fault category chart, maintenance completion progress, upcoming inspections, and category/date filters.
2. **Railway Assets (`/assets`)**: Manage `Railway Tracks`, `Bridges`, `Railway Stations`, `Signals`, `Level Crossings`, and `Railway Equipment` with search, sorting, filtering, condition & operational status tracking, validated image uploads, inspection/fault/task history, and optional verified GPS coordinates.
3. **Manage Inspections & AI-Assisted Fault Analysis (`/inspections`)**: Step-by-step inspection submission with validated photo uploads (JPG, PNG, WebP up to 5 MB; magic-byte & SHA-256 checked), optional Gemini Vision (`GEMINI_API_KEY`) or clearly labelled text-only rule fallback, explicit separation of observations vs possible defects vs uncertain limits, mandatory human verification, and approval workflow.
4. **Predictive Maintenance (`/predictive`)**: Transparent rule-based risk watchlist computed strictly from stored database records identifying repeated maintenance issues, frequent-fault assets, and overdue inspections, displaying exact prediction basis, data availability (`Insufficient Data` guardrail for zero-history assets), confidence depth, and recommended follow-up checks. Never claims to predict accidents or guarantee safety.
5. **Maintenance Tasks (`/maintenance`)**: Track repair tasks across `New`, `Assigned`, `In Progress`, `Waiting for Review`, and `Completed` with engineer assignment, priority, due dates, supporting photo uploads, completion notes, and auditable status change history.
6. **Asset Map (`/map`)**: Interactive map plotting only verified database coordinates (never invented routes or locations).
7. **Schedule Calendar (`/calendar`)**: Monthly and weekly interactive views for upcoming inspections, task deadlines, and completed work.
8. **Analytics & Reports (`/analytics`, `/reports`)**: Live trend charts and 6 downloadable PDF/CSV reports (`Inspection Reports`, `Asset Condition Reports`, `Maintenance Reports`, `Overdue Task Reports`, `Team Activity Reports`, `Fault Summary Reports`).
9. **Team Management & Notifications (`/team`, `/notifications`)**: Backend-enforced 4-role RBAC (`Admin`, `Inspector`, `Engineer`, `Maintenance Staff`), audit logs, asset type intervals, live System Health telemetry, consistent online SQLite backups, notifications, and global search.
10. **Raily Assistant (`RailyAssistant`)**: Floating animated railway guide grounded in live database totals (uses connected Gemini AI when configured, or clearly labelled Guided Help mode).

For full architecture, database, security, CI/CD, backup/recovery, and troubleshooting documentation, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Architecture & Technology Stack

- **Frontend**: React 19, TypeScript (`strict: true`), Vite, Tailwind CSS v4, React Router v7, Lucide Icons, WCAG 2.2 AA accessible components with `React.lazy` route splitting.
- **Backend**: Python FastAPI (`api/index.py`), Pydantic v2 validation, PyJWT (`HS256` + `HttpOnly` cookie sessions), PBKDF2-HMAC-SHA256 password hashing, sliding-window rate limiting, GZip compression, structured JSON logging (`api/logging_utils.py`).
- **Database**: Normalized 12-table SQLite relational schema (`database/schema.sql`, SQLite WAL mode, foreign keys enforced, `sqlite3.backup()` online backups; schema designed for PostgreSQL compatibility).
- **AI Integration**: Server-side `google-genai` integration (`api/ai_service.py`) with automatic honest fallback when `GEMINI_API_KEY` is absent.

---

## Installation & Running Locally

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

## Environment Configuration

Copy `.env.example` to `.env` before production deployment (never commit `.env` with real secrets):

| Variable | Purpose | Default / Behavior |
| :--- | :--- | :--- |
| `RAILPULSE_ENV` | Runtime mode (`development`, `test`, `production`) | `development` |
| `RAILPULSE_JWT_SECRET` | Minimum 32-char HMAC signing secret | Ephemeral random key if unset |
| `RAILPULSE_ALLOWED_ORIGINS` | Comma-separated CORS allow-list | `localhost:5173`, `localhost:8000` |
| `RAILPULSE_DB_PATH` | SQLite database file path | `data/railpulse.db` (`/tmp/railpulse_data` on read-only hosts) |
| `RAILPULSE_UPLOAD_DIR` | Uploaded inspection/task photo folder | `data/uploads` (`/tmp/railpulse_data/uploads` on read-only hosts) |
| `RAILPULSE_ENABLE_DEMO_DATA` | Seed clearly marked demo users & records | `true` (`false` for clean production DB) |
| `GEMINI_API_KEY` | Optional Google Gemini API key | Empty (`DEMO_MODE` / Guided Help used cleanly) |
| `GEMINI_MODEL` | Gemini model identifier | `gemini-2.5-flash` |

---

## Testing

```bash
python -m unittest discover -s tests -v
npm test
npm run lint
npx tsc --noEmit
npm run build
```

---

## Deployment Information

- **Single-Origin Production Server**: Build the React bundle (`npm run build`) into `dist/` and serve both API (`/api/*`) and SPA routes via `uvicorn api.index:app --host 0.0.0.0 --port $PORT`.
- **Serverless / Container Readiness**: Includes `vercel.json` API/SPA rewrites and automatic `/tmp/railpulse_data` storage fallback when `VERCEL=1` or `RAILPULSE_READONLY_FS=true`. For persistent multi-instance cloud hosting, back the backend with managed PostgreSQL and persistent object storage.

---

## Known Limitations

- Without `GEMINI_API_KEY`, photo analysis uses a clearly labelled text-only keyword check and does **not** perform computer vision on uploaded images.
- Default storage uses local SQLite (`data/railpulse.db`); serverless platforms like Vercel use ephemeral `/tmp` storage unless connected to an external managed database.
- Predictive Maintenance scores are transparent deterministic rules over stored history rather than trained statistical/sensor ML models (because RailPulse AI uses no fabricated live sensor feeds).

---

## Demo Login Accounts (`RAILPULSE_ENABLE_DEMO_DATA=true`)

| Role | Username | Password |
| :--- | :--- | :--- |
| Admin | `admin.demo` | `Admin@2026!` |
| Inspector | `inspector.demo` | `Inspector@2026!` |
| Engineer | `engineer.demo` | `Engineer@2026!` |
| Maintenance Staff | `staff.demo` | `Staff@2026!` |
