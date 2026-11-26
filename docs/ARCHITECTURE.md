# RailPulse AI — Architecture, Database, Security & Operations Guide

## 1. System Architecture
RailPulse AI is a two-tier web application:
- **Frontend (`src/`)**: React 19 + TypeScript (`strict: true`) + Tailwind CSS v4 + React Router v7, bundled by Vite with route-level code splitting (`React.lazy`) and wrapped in a global `ErrorBoundary`.
- **API Client (`src/lib/api.ts`)**: Typed `fetch` wrapper with 15s `AbortController` timeouts, external `AbortSignal` cancellation, automatic retry (1x) only on idempotent `GET` transient `502/503/504`/abort failures, and zero retries on `POST`/`PATCH` to prevent duplicate writes.
- **Backend (`api/`)**: Python FastAPI application (`api/index.py`) with GZip compression, CORS allow-listing, sliding-window rate limiting, structured JSON request logging with automatic secret redaction (`api/logging_utils.py`), and `X-Request-ID` tracing.

## 2. Database & Backup / Recovery (`database/schema.sql`, `api/database.py`)
- Normalized 12-table relational SQLite schema with `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, and 16 indexes.
- Every `get_db()` context wraps transactions with automatic `conn.rollback()` on exceptions.
- **Backups**: Admins can trigger online consistent SQLite backups via `POST /api/admin/backup` (or the Team Management → System Health panel), which uses `sqlite3.Connection.backup()` and verifies `PRAGMA integrity_check;` on both source and backup files.
- **Recovery**: Stop the application server, copy the verified backup `.db` file from `data/backups/` over `data/railpulse.db` (removing stale `-wal`/`-shm` files if present), and restart Uvicorn.

## 3. Security Controls
- **Passwords**: PBKDF2-HMAC-SHA256 (`260,000` iterations, 16-byte random salt, `hmac.compare_digest`).
- **Sessions**: HS256 JWT tokens + `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production), live DB `is_active` validation on every authenticated call.
- **RBAC (`require_roles`)**: Enforced on every backend route for `admin`, `inspector`, `engineer`, and `staff` with `403` audit logging.
- **Uploads (`validate_image_upload`)**: Magic-byte verification for JPEG, PNG, and WebP (max 5 MB, max 5 files), UUID filenames, SHA-256 checksums, and `X-Content-Type-Options: nosniff`.
- **Headers**: `Content-Security-Policy`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and `Cache-Control: no-store` on auth/admin routes.

## 4. API Overview
- `GET /api/health` — Public health status and AI mode (`DEMO_MODE` vs `LIVE_VISION_LLM`).
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/dashboard`, `GET /api/analytics`, `GET /api/calendar`, `GET /api/search?q=`
- `GET/POST /api/assets`, `GET/PATCH /api/assets/{id}`, `POST /api/assets/{id}/images`
- `GET/POST /api/inspections`, `PATCH /api/inspections/{id}/review`, `POST /api/ai/analyze`
- `GET/POST /api/work-orders`, `GET/PATCH /api/work-orders/{id}`, `POST /api/work-orders/{id}/images`
- `GET /api/reports`, `GET /api/reports/export?fmt=pdf|csv&report_type=...`
- `GET/POST /api/admin/users`, `PATCH /api/admin/users/{id}`, `GET /api/admin/audit-logs`, `GET /api/admin/system-health`, `POST /api/admin/backup`

## 5. CI/CD, Deployment & Rollback
- A ready-to-use GitHub Actions workflow template is provided at [docs/github-actions-ci.yml](github-actions-ci.yml) (copy to `.github/workflows/ci.yml` using an account with GitHub `workflow` token scope). It blocks merges/pushes on lint, TypeScript strict check, Vitest, backend test coverage (`>= 80%`), Vite build, and `npm audit` / `pip-audit`.
- **Deployment Rollback**: Redeploy the previous Git commit (`git checkout <tag-or-sha>`) and restore the matching database backup from `data/backups/` if schema changes occurred.

## 6. Troubleshooting
- **AI shows Guided Mode / Demo Mode**: Configure a valid `GEMINI_API_KEY` in `.env` and restart the backend server.
- **429 Too Many Requests**: Wait for the `Retry-After` interval (login limit: 25/min, AI limit: 35/min, general API: 300/min).
- **403 Permission Denied**: Verify your signed-in role (`Admin`, `Inspector`, `Engineer`, `Maintenance Staff`) matches the requested action.
