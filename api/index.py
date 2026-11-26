"""RAILPULSE AI FastAPI Backend Application (v2 — Expanded Modules & 4-Role RBAC)."""

from __future__ import annotations

import hashlib
import re
import secrets
import shutil
import threading
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from api.ai_service import analyze_inspection_with_ai, generate_raily_reply, is_live_ai_configured
from api.analytics import (
    build_calendar_events,
    build_report_data,
    compute_analytics_overview,
    compute_dashboard_summary,
    compute_predictive_maintenance,
    export_report_csv,
    export_report_pdf,
    global_search,
)
from api.config import BASE_DIR, settings
from api.database import backup_database, check_db_integrity, get_db, init_db
from api.logging_utils import app_logger
from api.schemas import (
    AssetCreateRequest,
    AssetUpdateRequest,
    CategoryCreateRequest,
    FaultCreateRequest,
    FaultVerifyRequest,
    InspectionReviewRequest,
    LoginRequest,
    RailyChatRequest,
    UserCreateRequest,
    UserUpdateRequest,
    WorkOrderCreateRequest,
    WorkOrderUpdateRequest,
)
from api.seed import seed_initial_data
from api.security import (
    clean_text,
    create_access_token,
    get_client_ip,
    get_current_user,
    hash_password,
    log_activity,
    rate_limiter,
    require_roles,
    validate_image_upload,
    verify_password,
)

SAFE_IMAGE_NAME_RE = re.compile(r"^[a-f0-9]{32}\.(jpg|png|webp)$")
ALLOWED_INSPECTION_CATEGORIES = {
    "Routine Check",
    "Track & Structure Check",
    "Signal Check",
    "Safety & Crossing Check",
    "Urgent Check",
}
ALLOWED_FAULT_SEVERITIES = {"Low", "Medium", "High", "Critical"}


class MetricsCollector:
    """Thread-safe rolling runtime telemetry for System Health reporting."""

    def __init__(self) -> None:
        self.started_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.total_requests = 0
        self.error_5xx_count = 0
        self.durations_ms: deque[float] = deque(maxlen=500)
        self._lock = threading.Lock()

    def record(self, status_code: int, duration_ms: float) -> None:
        with self._lock:
            self.total_requests += 1
            if status_code >= 500:
                self.error_5xx_count += 1
            self.durations_ms.append(duration_ms)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            samples = sorted(self.durations_ms)
            total = self.total_requests
            errs = self.error_5xx_count
        if samples:
            p50 = round(samples[len(samples) // 2], 2)
            p95 = round(samples[min(len(samples) - 1, int(len(samples) * 0.95))], 2)
        else:
            p50 = 0.0
            p95 = 0.0
        err_rate = round((errs / total) * 100, 2) if total > 0 else 0.0
        return {
            "started_at": self.started_at,
            "total_requests": total,
            "error_5xx_count": errs,
            "error_rate_pct": err_rate,
            "p50_ms": p50,
            "p95_ms": p95,
        }


runtime_metrics = MetricsCollector()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    seed_initial_data()
    if settings.ENV == "production" and settings.USING_EPHEMERAL_SECRET:
        app_logger.warning(
            "Using ephemeral JWT secret in production mode; configure RAILPULSE_JWT_SECRET.",
            extra={"structured": {"event": "ephemeral_secret_warning"}},
        )
    yield


app = FastAPI(
    title="RAILPULSE AI API",
    description="Railway Asset Inspection & Maintenance Management System",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.ENV != "production" else None,
    redoc_url=None,
)

app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_and_rate_limit_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:16]
    request.state.request_id = request_id
    started = time.perf_counter()
    path = request.url.path
    ip = get_client_ip(request)

    if path.startswith("/api/"):
        if path == "/api/auth/login":
            ok, retry = rate_limiter.check(f"login:{ip}", max_requests=25, window_seconds=60)
        elif path.startswith("/api/ai/") or path.startswith("/api/assistant/"):
            ok, retry = rate_limiter.check(f"ai:{ip}", max_requests=35, window_seconds=60)
        else:
            ok, retry = rate_limiter.check(f"api:{ip}", max_requests=300, window_seconds=60)

        if not ok:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests right now. Please wait a moment and try again.", "request_id": request_id},
                headers={"Retry-After": str(retry), "X-Request-ID": request_id},
            )

    response = await call_next(request)
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    if path.startswith("/api/"):
        runtime_metrics.record(response.status_code, duration_ms)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' data: blob:; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; "
        "connect-src 'self'; "
        "frame-ancestors 'none';"
    )
    if path.startswith("/api/auth/") or path.startswith("/api/admin/"):
        response.headers["Cache-Control"] = "no-store"
    elif path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"

    if path.startswith("/api/") and settings.ENV != "test":
        app_logger.info(
            "http_request",
            extra={
                "structured": {
                    "request_id": request_id,
                    "method": request.method,
                    "path": path,
                    "status_code": response.status_code,
                    "duration_ms": duration_ms,
                    "client_ip": ip,
                }
            },
        )
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    req_id = getattr(request.state, "request_id", "unknown")
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail, "request_id": req_id})
    app_logger.error(
        "unhandled_server_error",
        extra={"structured": {"request_id": req_id, "path": request.url.path, "error_type": type(exc).__name__}},
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong on the server. Please try again.", "request_id": req_id},
    )


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _next_code(conn: Any, table: str, column: str, prefix: str) -> str:
    row = conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()
    seq = int(row["c"]) + 1
    while True:
        candidate = f"{prefix}-{seq:04d}"
        exists = conn.execute(f"SELECT 1 FROM {table} WHERE {column} = ?", (candidate,)).fetchone()
        if not exists:
            return candidate
        seq += 1


def _notify_roles(
    conn: Any,
    roles: tuple[str, ...],
    *,
    title: str,
    message: str,
    category: str,
    severity: str,
    link_path: str,
) -> None:
    placeholders = ",".join("?" for _ in roles)
    users = conn.execute(
        f"SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name IN ({placeholders}) AND u.is_active = 1",
        roles,
    ).fetchall()
    for u in users:
        conn.execute(
            """
            INSERT INTO notifications (user_id, title, message, category, severity, link_path)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (u["id"], title, message, category, severity, link_path),
        )


async def _save_validated_uploads(files: list[UploadFile], max_count: int = 5) -> list[tuple[bytes, str, str, str]]:
    if len(files) > max_count:
        raise HTTPException(status_code=400, detail=f"You can upload up to {max_count} images at a time.")
    results: list[tuple[bytes, str, str, str]] = []
    for f in files:
        if not f.filename:
            continue
        blob = await f.read()
        detected_mime, ext = validate_image_upload(blob, f.filename, f.content_type)
        results.append((blob, detected_mime, ext, Path(f.filename).name[:120]))
    return results


# ---------------------------------------------------------------------------
# Health & Authentication
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "service": "RAILPULSE AI",
        "demo_data_enabled": settings.ENABLE_DEMO_DATA,
        "live_ai_configured": is_live_ai_configured(),
        "ai_mode": "LIVE_VISION_LLM" if is_live_ai_configured() else "DEMO_MODE",
    }


@app.get("/api/auth/demo-accounts")
def list_demo_accounts():
    if not settings.ENABLE_DEMO_DATA:
        return {"enabled": False, "accounts": []}
    return {
        "enabled": True,
        "notice": "Demo accounts for testing and training.",
        "accounts": [
            {
                "username": "admin.demo",
                "role": "admin",
                "role_display": "Admin",
                "summary": "Manage team members, roles, categories, and system activity.",
            },
            {
                "username": "inspector.demo",
                "role": "inspector",
                "role_display": "Inspector",
                "summary": "Create inspections, upload photos, run AI checks, and review reports.",
            },
            {
                "username": "engineer.demo",
                "role": "engineer",
                "role_display": "Engineer",
                "summary": "Manage assets, verify AI findings, and assign maintenance tasks.",
            },
            {
                "username": "staff.demo",
                "role": "staff",
                "role_display": "Maintenance Staff",
                "summary": "Update assigned maintenance tasks, add notes, and upload repair photos.",
            },
        ],
    }


@app.post("/api/auth/login")
def login(payload: LoginRequest, request: Request, response: Response):
    username = clean_text(payload.username).lower()
    ip = get_client_ip(request)

    with get_db() as conn:
        row = conn.execute(
            """
            SELECT u.id, u.username, u.email, u.full_name, u.password_hash,
                   u.department, u.is_active, u.is_demo,
                   r.name AS role, r.display_name AS role_display
            FROM users u
            JOIN roles r ON r.id = u.role_id
            WHERE lower(u.username) = ?
            """,
            (username,),
        ).fetchone()

        if not row or not verify_password(payload.password, row["password_hash"]):
            log_activity(
                conn,
                actor_user_id=row["id"] if row else None,
                actor_username=username,
                actor_role=row["role"] if row else "anonymous",
                action="LOGIN_FAILED",
                entity_type="auth",
                entity_id=username,
                details="Wrong username or password entered.",
                ip_address=ip,
            )
            conn.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Wrong username or password. Please check and try again.",
            )

        if not row["is_active"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account is turned off. Ask your Admin to turn it back on.",
            )

        token = create_access_token(row["id"], row["username"], row["role"])
        log_activity(
            conn,
            actor_user_id=row["id"],
            actor_username=row["username"],
            actor_role=row["role"],
            action="SIGNED_IN",
            entity_type="auth",
            entity_id=str(row["id"]),
            details="User signed in.",
            ip_address=ip,
        )
        conn.commit()

    response.set_cookie(
        key="railpulse_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=settings.ENV == "production",
        max_age=settings.JWT_EXPIRE_MINUTES * 60,
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": row["id"],
            "username": row["username"],
            "email": row["email"],
            "full_name": row["full_name"],
            "department": row["department"],
            "role": row["role"],
            "role_display": row["role_display"],
            "is_demo": bool(row["is_demo"]),
        },
    }


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, user: dict[str, Any] = Depends(get_current_user)):
    with get_db() as conn:
        log_activity(
            conn,
            actor_user_id=user["id"],
            actor_username=user["username"],
            actor_role=user["role"],
            action="SIGNED_OUT",
            entity_type="auth",
            entity_id=str(user["id"]),
            details="User signed out.",
            ip_address=get_client_ip(request),
        )
        conn.commit()
    response.delete_cookie("railpulse_token")
    return {"message": "Signed out."}


@app.get("/api/auth/me")
def get_me(user: dict[str, Any] = Depends(get_current_user)):
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "full_name": user["full_name"],
        "department": user["department"],
        "role": user["role"],
        "role_display": user["role_display"],
        "is_demo": bool(user["is_demo"]),
    }


# ---------------------------------------------------------------------------
# Dashboard, Analytics, Calendar, Global Search
# ---------------------------------------------------------------------------


@app.get("/api/dashboard")
def get_dashboard(
    category_id: Optional[int] = Query(default=None, ge=1),
    days: Optional[int] = Query(default=None, ge=1, le=3650),
    _: dict[str, Any] = Depends(get_current_user),
):
    with get_db() as conn:
        return compute_dashboard_summary(conn, category_id=category_id, days=days)


@app.get("/api/analytics")
def get_analytics(_: dict[str, Any] = Depends(get_current_user)):
    with get_db() as conn:
        return compute_analytics_overview(conn)


@app.get("/api/predictive")
def get_predictive_maintenance(_: dict[str, Any] = Depends(get_current_user)):
    with get_db() as conn:
        return compute_predictive_maintenance(conn)


@app.get("/api/calendar")
def get_calendar(_: dict[str, Any] = Depends(get_current_user)):
    with get_db() as conn:
        return build_calendar_events(conn)


@app.get("/api/search")
def search_everything(
    q: str = Query(default="", max_length=100),
    _: dict[str, Any] = Depends(get_current_user),
):
    with get_db() as conn:
        return global_search(conn, q)


# ---------------------------------------------------------------------------
# Categories & Team Management
# ---------------------------------------------------------------------------


@app.get("/api/categories")
def list_categories(_: dict[str, Any] = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, code, name, inspection_interval_days, description, created_at FROM asset_categories ORDER BY name ASC"
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@app.post("/api/categories", status_code=201)
def create_category(
    payload: CategoryCreateRequest,
    request: Request,
    admin: dict[str, Any] = Depends(require_roles("admin")),
):
    with get_db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM asset_categories WHERE code = ? OR lower(name) = ?",
            (payload.code.upper(), payload.name.strip().lower()),
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="That category code or name already exists.")

        cur = conn.execute(
            "INSERT INTO asset_categories (code, name, inspection_interval_days, description) VALUES (?, ?, ?, ?)",
            (payload.code.upper(), clean_text(payload.name), payload.inspection_interval_days, clean_text(payload.description)),
        )
        cat_id = cur.lastrowid
        log_activity(
            conn,
            actor_user_id=admin["id"],
            actor_username=admin["username"],
            actor_role=admin["role"],
            action="CATEGORY_ADDED",
            entity_type="category",
            entity_id=str(cat_id),
            details=f"Added category {payload.name}",
            ip_address=get_client_ip(request),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM asset_categories WHERE id = ?", (cat_id,)).fetchone()
    return dict(row)


@app.get("/api/team/members")
def list_team_members(_: dict[str, Any] = Depends(get_current_user)):
    """Active team members for assignment dropdowns."""
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT u.id, u.username, u.full_name, u.department, u.is_demo,
                   r.name AS role, r.display_name AS role_display
            FROM users u
            JOIN roles r ON r.id = u.role_id
            WHERE u.is_active = 1
            ORDER BY u.full_name ASC
            """
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@app.get("/api/admin/users")
def admin_list_users(_: dict[str, Any] = Depends(require_roles("admin"))):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT u.id, u.username, u.email, u.full_name, u.department,
                   u.is_active, u.is_demo, u.created_at,
                   r.name AS role, r.display_name AS role_display
            FROM users u
            JOIN roles r ON r.id = u.role_id
            ORDER BY u.id ASC
            """
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@app.post("/api/admin/users", status_code=201)
def admin_create_user(
    payload: UserCreateRequest,
    request: Request,
    admin: dict[str, Any] = Depends(require_roles("admin")),
):
    uname = clean_text(payload.username).lower()
    email = clean_text(payload.email).lower()
    with get_db() as conn:
        dup = conn.execute(
            "SELECT 1 FROM users WHERE lower(username) = ? OR lower(email) = ?",
            (uname, email),
        ).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail="Username or email is already in use.")

        role_row = conn.execute("SELECT id FROM roles WHERE name = ?", (payload.role,)).fetchone()
        if not role_row:
            raise HTTPException(status_code=400, detail="Invalid role selected.")

        cur = conn.execute(
            """
            INSERT INTO users (username, email, full_name, password_hash, role_id, department, is_active, is_demo)
            VALUES (?, ?, ?, ?, ?, ?, 1, 0)
            """,
            (uname, email, clean_text(payload.full_name), hash_password(payload.password), role_row["id"], clean_text(payload.department)),
        )
        new_id = cur.lastrowid
        log_activity(
            conn,
            actor_user_id=admin["id"],
            actor_username=admin["username"],
            actor_role=admin["role"],
            action="TEAM_MEMBER_ADDED",
            entity_type="user",
            entity_id=str(new_id),
            details=f"Added {uname} ({payload.role})",
            ip_address=get_client_ip(request),
        )
        conn.commit()
        created = conn.execute(
            """
            SELECT u.id, u.username, u.email, u.full_name, u.department, u.is_active, u.is_demo,
                   r.name AS role, r.display_name AS role_display
            FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?
            """,
            (new_id,),
        ).fetchone()
    return dict(created)


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(
    user_id: int,
    payload: UserUpdateRequest,
    request: Request,
    admin: dict[str, Any] = Depends(require_roles("admin")),
):
    with get_db() as conn:
        target = conn.execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="Team member not found.")

        if payload.role is not None:
            role_row = conn.execute("SELECT id FROM roles WHERE name = ?", (payload.role,)).fetchone()
            conn.execute("UPDATE users SET role_id = ?, updated_at = ? WHERE id = ?", (role_row["id"], _now_utc_iso(), user_id))
        if payload.department is not None:
            conn.execute("UPDATE users SET department = ?, updated_at = ? WHERE id = ?", (clean_text(payload.department), _now_utc_iso(), user_id))
        if payload.is_active is not None:
            if user_id == admin["id"] and not payload.is_active:
                raise HTTPException(status_code=400, detail="You cannot turn off your own Admin account.")
            conn.execute("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?", (1 if payload.is_active else 0, _now_utc_iso(), user_id))

        log_activity(
            conn,
            actor_user_id=admin["id"],
            actor_username=admin["username"],
            actor_role=admin["role"],
            action="TEAM_MEMBER_UPDATED",
            entity_type="user",
            entity_id=str(user_id),
            details=f"Updated {target['username']}",
            ip_address=get_client_ip(request),
        )
        conn.commit()
        updated = conn.execute(
            """
            SELECT u.id, u.username, u.email, u.full_name, u.department, u.is_active, u.is_demo,
                   r.name AS role, r.display_name AS role_display
            FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?
            """,
            (user_id,),
        ).fetchone()
    return dict(updated)


@app.get("/api/admin/audit-logs")
def admin_audit_logs(
    limit: int = Query(default=50, ge=1, le=200),
    _: dict[str, Any] = Depends(require_roles("admin")),
):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, actor_username, actor_role, action, entity_type, entity_id, details, ip_address, created_at FROM activity_logs ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@app.post("/api/admin/backup")
def admin_create_backup(
    request: Request,
    admin: dict[str, Any] = Depends(require_roles("admin")),
):
    integrity_ok = check_db_integrity()
    backup_path = backup_database()
    backup_ok = check_db_integrity(backup_path)
    with get_db() as conn:
        log_activity(
            conn,
            actor_user_id=admin["id"],
            actor_username=admin["username"],
            actor_role=admin["role"],
            action="DATABASE_BACKUP_CREATED",
            entity_type="database",
            entity_id=backup_path.name,
            details=f"Integrity source={integrity_ok}, backup={backup_ok}",
            ip_address=get_client_ip(request),
        )
        conn.commit()
    return {
        "status": "ok" if (integrity_ok and backup_ok) else "warning",
        "source_integrity": integrity_ok,
        "backup_integrity": backup_ok,
        "backup_filename": backup_path.name,
        "size_bytes": backup_path.stat().st_size,
    }


@app.get("/api/admin/system-health")
def admin_system_health(_: dict[str, Any] = Depends(require_roles("admin"))):
    db_t0 = time.perf_counter()
    db_ok = False
    try:
        db_ok = check_db_integrity()
    except Exception:
        db_ok = False
    db_latency_ms = round((time.perf_counter() - db_t0) * 1000, 2)

    db_size = settings.DB_PATH.stat().st_size if settings.DB_PATH.exists() else 0
    upload_files = list(settings.UPLOAD_DIR.glob("*")) if settings.UPLOAD_DIR.exists() else []
    uploads_bytes = sum(f.stat().st_size for f in upload_files if f.is_file())
    disk_usage = shutil.disk_usage(str(settings.DB_PATH.parent if settings.DB_PATH.parent.exists() else BASE_DIR))

    backup_dir = settings.DB_PATH.parent / "backups"
    backups = sorted(backup_dir.glob("*.db"), key=lambda p: p.stat().st_mtime, reverse=True) if backup_dir.exists() else []
    last_backup = (
        {
            "status": "AVAILABLE",
            "filename": backups[0].name,
            "size_bytes": backups[0].stat().st_size,
            "created_at": datetime.fromtimestamp(backups[0].stat().st_mtime, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        if backups
        else {"status": "UNAVAILABLE", "message": "No database backup created yet."}
    )

    api_stats = runtime_metrics.snapshot()
    return {
        "backend_status": "HEALTHY",
        "database_status": "HEALTHY" if db_ok else "UNAVAILABLE",
        "db_latency_ms": db_latency_ms,
        "api_health": api_stats,
        "ai_service_status": "CONNECTED" if is_live_ai_configured() else "UNAVAILABLE",
        "ai_service_detail": "Gemini Vision/LLM connected" if is_live_ai_configured() else "No GEMINI_API_KEY configured (Guided/Demo mode)",
        "storage": {
            "database_bytes": db_size,
            "upload_files_count": len([f for f in upload_files if f.is_file()]),
            "uploads_bytes": uploads_bytes,
            "disk_free_bytes": disk_usage.free,
        },
        "last_backup": last_backup,
        "latest_test_results": "UNKNOWN — Execute CI or local test suite to verify latest commit",
        "security_scan_status": "UNKNOWN — Execute npm audit / pip-audit / secret scan to verify",
    }


# ---------------------------------------------------------------------------
# Railway Assets & Verified Coordinates Map
# ---------------------------------------------------------------------------


@app.get("/api/assets")
def list_assets(
    q: str = Query(default="", max_length=100),
    category_id: Optional[int] = Query(default=None, ge=1),
    condition: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    sort_by: str = Query(default="newest", pattern="^(newest|name|condition|next_inspection|last_inspection)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    _: dict[str, Any] = Depends(get_current_user),
):
    where = ["1=1"]
    params: list[Any] = []
    if q.strip():
        like = f"%{q.strip()}%"
        where.append("(a.asset_code LIKE ? OR a.name LIKE ? OR a.section_location LIKE ?)")
        params.extend([like, like, like])
    if category_id is not None:
        where.append("a.category_id = ?")
        params.append(category_id)
    if condition:
        where.append("a.current_condition = ?")
        params.append(condition)
    if status_filter:
        where.append("a.maintenance_status = ?")
        params.append(status_filter)

    order_map = {
        "newest": "a.id DESC",
        "name": "a.name ASC",
        "condition": "CASE a.current_condition WHEN 'Critical Alert' THEN 1 WHEN 'Under Repair' THEN 2 WHEN 'Needs Attention' THEN 3 ELSE 4 END, a.name ASC",
        "next_inspection": "COALESCE(a.next_inspection_date, '9999-12-31') ASC",
        "last_inspection": "COALESCE(a.last_inspection_date, '0000-01-01') DESC",
    }

    where_sql = " AND ".join(where)
    offset = (page - 1) * page_size

    with get_db() as conn:
        total = conn.execute(f"SELECT COUNT(*) AS c FROM railway_assets a WHERE {where_sql}", params).fetchone()["c"]
        rows = conn.execute(
            f"""
            SELECT a.*, c.code AS category_code, c.name AS category_name,
                   c.inspection_interval_days,
                   u.full_name AS assigned_engineer_name,
                   (SELECT COUNT(*) FROM inspections i WHERE i.asset_id = a.id) AS inspection_count,
                   (SELECT COUNT(*) FROM fault_reports f WHERE f.asset_id = a.id AND f.status IN ('Open', 'Assigned')) AS open_fault_count,
                   (SELECT COUNT(*) FROM asset_images ai WHERE ai.asset_id = a.id) AS image_count
            FROM railway_assets a
            JOIN asset_categories c ON c.id = a.category_id
            LEFT JOIN users u ON u.id = a.assigned_engineer_id
            WHERE {where_sql}
            ORDER BY {order_map[sort_by]}
            LIMIT ? OFFSET ?
            """,
            [*params, page_size, offset],
        ).fetchall()

    return {"total": total, "page": page, "page_size": page_size, "items": [dict(r) for r in rows]}


@app.post("/api/assets", status_code=201)
def create_asset(
    payload: AssetCreateRequest,
    request: Request,
    user: dict[str, Any] = Depends(require_roles("admin", "engineer", "inspector")),
):
    with get_db() as conn:
        cat = conn.execute("SELECT id, code, inspection_interval_days FROM asset_categories WHERE id = ?", (payload.category_id,)).fetchone()
        if not cat:
            raise HTTPException(status_code=400, detail="Selected asset type does not exist.")

        if payload.assigned_engineer_id is not None:
            assignee = conn.execute("SELECT id FROM users WHERE id = ? AND is_active = 1", (payload.assigned_engineer_id,)).fetchone()
            if not assignee:
                raise HTTPException(status_code=400, detail="Assigned team member was not found.")

        asset_code = payload.asset_code.upper() if payload.asset_code else _next_code(conn, "railway_assets", "asset_code", f"RP-{cat['code']}")
        if conn.execute("SELECT 1 FROM railway_assets WHERE asset_code = ?", (asset_code,)).fetchone():
            raise HTTPException(status_code=409, detail=f"Asset ID '{asset_code}' already exists.")

        next_insp = payload.next_inspection_date
        if not next_insp:
            next_insp = (datetime.now(timezone.utc) + timedelta(days=int(cat["inspection_interval_days"]))).strftime("%Y-%m-%d")

        coords_verified = 1 if (payload.latitude is not None and payload.longitude is not None and payload.coordinates_verified) else 0

        cur = conn.execute(
            """
            INSERT INTO railway_assets (
                asset_code, name, category_id, section_location, description,
                installation_date, registration_date, next_inspection_date,
                current_condition, maintenance_status, latitude, longitude,
                coordinates_verified, assigned_engineer_id, is_demo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            """,
            (
                asset_code,
                clean_text(payload.name),
                payload.category_id,
                clean_text(payload.section_location),
                clean_text(payload.description),
                payload.installation_date,
                payload.registration_date,
                next_insp,
                payload.current_condition,
                payload.maintenance_status,
                payload.latitude if coords_verified else None,
                payload.longitude if coords_verified else None,
                coords_verified,
                payload.assigned_engineer_id,
            ),
        )
        asset_id = cur.lastrowid

        if payload.current_condition in ("Needs Attention", "Critical Alert"):
            _notify_roles(
                conn,
                ("admin", "engineer", "inspector"),
                title=f"Important Asset Alert: {asset_code}",
                message=f"{payload.name} was added with condition '{payload.current_condition}'.",
                category="asset_alert",
                severity="critical" if payload.current_condition == "Critical Alert" else "warning",
                link_path="/assets",
            )

        log_activity(
            conn,
            actor_user_id=user["id"],
            actor_username=user["username"],
            actor_role=user["role"],
            action="ASSET_ADDED",
            entity_type="asset",
            entity_id=asset_code,
            details=f"Added {payload.name} at {payload.section_location}",
            ip_address=get_client_ip(request),
        )
        conn.commit()
        created = conn.execute(
            """
            SELECT a.*, c.code AS category_code, c.name AS category_name,
                   u.full_name AS assigned_engineer_name
            FROM railway_assets a
            JOIN asset_categories c ON c.id = a.category_id
            LEFT JOIN users u ON u.id = a.assigned_engineer_id
            WHERE a.id = ?
            """,
            (asset_id,),
        ).fetchone()
    return dict(created)


@app.get("/api/assets/{asset_id}")
def get_asset_detail(asset_id: int, _: dict[str, Any] = Depends(get_current_user)):
    with get_db() as conn:
        asset = conn.execute(
            """
            SELECT a.*, c.code AS category_code, c.name AS category_name,
                   c.inspection_interval_days, u.full_name AS assigned_engineer_name
            FROM railway_assets a
            JOIN asset_categories c ON c.id = a.category_id
            LEFT JOIN users u ON u.id = a.assigned_engineer_id
            WHERE a.id = ?
            """,
            (asset_id,),
        ).fetchone()
        if not asset:
            raise HTTPException(status_code=404, detail="Asset not found.")

        asset_images = conn.execute(
            "SELECT id, original_filename, stored_filename, mime_type, file_size_bytes, created_at FROM asset_images WHERE asset_id = ? ORDER BY id DESC",
            (asset_id,),
        ).fetchall()

        inspections = conn.execute(
            """
            SELECT i.*, u.full_name AS inspector_name, r.full_name AS reviewer_name
            FROM inspections i
            JOIN users u ON u.id = i.inspector_id
            LEFT JOIN users r ON r.id = i.reviewer_id
            WHERE i.asset_id = ?
            ORDER BY i.inspection_date DESC, i.id DESC
            """,
            (asset_id,),
        ).fetchall()

        insp_images = conn.execute(
            """
            SELECT ii.id, ii.original_filename, ii.stored_filename, ii.mime_type, ii.file_size_bytes, ii.created_at
            FROM inspection_images ii
            JOIN inspections i ON i.id = ii.inspection_id
            WHERE i.asset_id = ?
            ORDER BY ii.id DESC
            """,
            (asset_id,),
        ).fetchall()

        faults = conn.execute(
            "SELECT f.*, u.full_name AS reporter_name FROM fault_reports f JOIN users u ON u.id = f.reported_by WHERE f.asset_id = ? ORDER BY f.created_at DESC",
            (asset_id,),
        ).fetchall()

        work_orders = conn.execute(
            "SELECT w.*, u.full_name AS assignee_name FROM work_orders w LEFT JOIN users u ON u.id = w.assigned_to WHERE w.asset_id = ? ORDER BY w.created_at DESC",
            (asset_id,),
        ).fetchall()

    return {
        "asset": dict(asset),
        "images": [dict(r) for r in asset_images] + [dict(r) for r in insp_images],
        "inspections": [dict(r) for r in inspections],
        "faults": [dict(r) for r in faults],
        "work_orders": [dict(r) for r in work_orders],
    }


@app.patch("/api/assets/{asset_id}")
def update_asset(
    asset_id: int,
    payload: AssetUpdateRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    with get_db() as conn:
        asset = conn.execute("SELECT * FROM railway_assets WHERE id = ?", (asset_id,)).fetchone()
        if not asset:
            raise HTTPException(status_code=404, detail="Asset not found.")

        if user["role"] == "staff" and asset["assigned_engineer_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="Maintenance Staff can only update assets assigned to them.")

        updates = payload.model_dump(exclude_none=True)
        if "category_id" in updates:
            if not conn.execute("SELECT 1 FROM asset_categories WHERE id = ?", (updates["category_id"],)).fetchone():
                raise HTTPException(status_code=400, detail="Asset type not found.")

        if "coordinates_verified" in updates:
            updates["coordinates_verified"] = 1 if updates["coordinates_verified"] else 0

        allowed = {
            "name",
            "category_id",
            "section_location",
            "description",
            "installation_date",
            "next_inspection_date",
            "current_condition",
            "maintenance_status",
            "latitude",
            "longitude",
            "coordinates_verified",
            "assigned_engineer_id",
        }
        set_clauses: list[str] = []
        values: list[Any] = []
        for field, val in updates.items():
            if field in allowed:
                set_clauses.append(f"{field} = ?")
                values.append(clean_text(val) if isinstance(val, str) else val)

        if set_clauses:
            set_clauses.append("updated_at = ?")
            values.append(_now_utc_iso())
            values.append(asset_id)
            conn.execute(f"UPDATE railway_assets SET {', '.join(set_clauses)} WHERE id = ?", values)

        if payload.current_condition in ("Needs Attention", "Critical Alert") and payload.current_condition != asset["current_condition"]:
            _notify_roles(
                conn,
                ("admin", "engineer", "inspector"),
                title=f"Important Asset Alert: {asset['asset_code']}",
                message=f"Condition changed to '{payload.current_condition}'.",
                category="asset_alert",
                severity="critical" if payload.current_condition == "Critical Alert" else "warning",
                link_path="/assets",
            )

        log_activity(
            conn,
            actor_user_id=user["id"],
            actor_username=user["username"],
            actor_role=user["role"],
            action="ASSET_UPDATED",
            entity_type="asset",
            entity_id=asset["asset_code"],
            details=f"Updated {', '.join(updates.keys())}",
            ip_address=get_client_ip(request),
        )
        conn.commit()
        updated = conn.execute(
            """
            SELECT a.*, c.code AS category_code, c.name AS category_name,
                   u.full_name AS assigned_engineer_name
            FROM railway_assets a
            JOIN asset_categories c ON c.id = a.category_id
            LEFT JOIN users u ON u.id = a.assigned_engineer_id
            WHERE a.id = ?
            """,
            (asset_id,),
        ).fetchone()
    return dict(updated)


@app.post("/api/assets/{asset_id}/images", status_code=201)
async def upload_asset_images(
    asset_id: int,
    files: list[UploadFile] = File(...),
    user: dict[str, Any] = Depends(require_roles("admin", "engineer", "inspector")),
):
    validated = await _save_validated_uploads(files, max_count=5)
    if not validated:
        raise HTTPException(status_code=400, detail="Please attach at least one valid image.")
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    saved = []
    with get_db() as conn:
        if not conn.execute("SELECT 1 FROM railway_assets WHERE id = ?", (asset_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Asset not found.")
        for blob, mime, ext, orig in validated:
            stored = f"{secrets.token_hex(16)}{ext}"
            (settings.UPLOAD_DIR / stored).write_bytes(blob)
            sha = hashlib.sha256(blob).hexdigest()
            conn.execute(
                """
                INSERT INTO asset_images (asset_id, original_filename, stored_filename, mime_type, file_size_bytes, sha256_hash, uploaded_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (asset_id, orig, stored, mime, len(blob), sha, user["id"]),
            )
            saved.append({"original_filename": orig, "stored_filename": stored, "mime_type": mime, "file_size_bytes": len(blob)})
        conn.commit()
    return {"items": saved}


# ---------------------------------------------------------------------------
# Smart Inspection & AI Check
# ---------------------------------------------------------------------------


@app.get("/api/inspections")
def list_inspections(
    asset_id: Optional[int] = Query(default=None, ge=1),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    q: str = Query(default="", max_length=100),
    _: dict[str, Any] = Depends(get_current_user),
):
    where = ["1=1"]
    params: list[Any] = []
    if asset_id is not None:
        where.append("i.asset_id = ?")
        params.append(asset_id)
    if status_filter:
        where.append("i.status = ?")
        params.append(status_filter)
    if q.strip():
        like = f"%{q.strip()}%"
        where.append("(i.inspection_code LIKE ? OR a.asset_code LIKE ? OR a.name LIKE ? OR i.observed_conditions LIKE ?)")
        params.extend([like, like, like, like])

    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT i.*, a.asset_code, a.name AS asset_name, a.section_location,
                   u.full_name AS inspector_name, r.full_name AS reviewer_name
            FROM inspections i
            JOIN railway_assets a ON a.id = i.asset_id
            JOIN users u ON u.id = i.inspector_id
            LEFT JOIN users r ON r.id = i.reviewer_id
            WHERE {' AND '.join(where)}
            ORDER BY i.inspection_date DESC, i.id DESC
            """,
            params,
        ).fetchall()

        items = []
        for r in rows:
            d = dict(r)
            imgs = conn.execute(
                "SELECT id, original_filename, stored_filename, mime_type, file_size_bytes, created_at FROM inspection_images WHERE inspection_id = ?",
                (d["id"],),
            ).fetchall()
            d["images"] = [dict(img) for img in imgs]
            items.append(d)

    return {"items": items}


@app.post("/api/inspections", status_code=201)
async def submit_inspection(
    request: Request,
    asset_id: int = Form(...),
    inspection_date: str = Form(...),
    inspection_category: str = Form(...),
    observed_conditions: str = Form(...),
    report_fault: bool = Form(default=False),
    fault_title: str = Form(default=""),
    fault_category: str = Form(default="General Maintenance"),
    fault_severity: str = Form(default="Medium"),
    fault_description: str = Form(default=""),
    files: list[UploadFile] = File(default=[]),
    user: dict[str, Any] = Depends(require_roles("inspector", "engineer", "admin")),
):
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", inspection_date):
        raise HTTPException(status_code=400, detail="Inspection date must be YYYY-MM-DD.")
    if inspection_category not in ALLOWED_INSPECTION_CATEGORIES:
        raise HTTPException(status_code=400, detail="Please choose a valid inspection type.")
    cleaned_obs = clean_text(observed_conditions)
    if len(cleaned_obs) < 10:
        raise HTTPException(status_code=400, detail="Please write at least 10 characters about what you saw.")

    validated_files = await _save_validated_uploads(files, max_count=settings.MAX_IMAGES_PER_INSPECTION)

    if report_fault:
        if fault_severity not in ALLOWED_FAULT_SEVERITIES:
            raise HTTPException(status_code=400, detail="Invalid fault priority.")
        if len(clean_text(fault_title)) < 3:
            raise HTTPException(status_code=400, detail="Please give the problem a short title.")

    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    with get_db() as conn:
        asset = conn.execute(
            """
            SELECT a.id, a.asset_code, a.name, c.inspection_interval_days
            FROM railway_assets a JOIN asset_categories c ON c.id = a.category_id
            WHERE a.id = ?
            """,
            (asset_id,),
        ).fetchone()
        if not asset:
            raise HTTPException(status_code=404, detail="Selected asset was not found.")

        insp_code = _next_code(conn, "inspections", "inspection_code", "INSP-2026")
        cur = conn.execute(
            """
            INSERT INTO inspections (
                inspection_code, asset_id, inspector_id, inspection_date,
                inspection_category, observed_conditions, status, is_demo
            ) VALUES (?, ?, ?, ?, ?, ?, 'Waiting for Review', 0)
            """,
            (insp_code, asset_id, user["id"], inspection_date, inspection_category, cleaned_obs),
        )
        insp_id = cur.lastrowid

        next_due = (
            datetime.strptime(inspection_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            + timedelta(days=int(asset["inspection_interval_days"]))
        ).strftime("%Y-%m-%d")

        conn.execute(
            """
            UPDATE railway_assets
            SET last_inspection_date = CASE
                WHEN last_inspection_date IS NULL OR last_inspection_date < ? THEN ?
                ELSE last_inspection_date
            END,
            next_inspection_date = ?,
            updated_at = ?
            WHERE id = ?
            """,
            (inspection_date, inspection_date, next_due, _now_utc_iso(), asset_id),
        )

        saved_images = []
        for blob, mime_type, ext, orig_name in validated_files:
            stored_name = f"{secrets.token_hex(16)}{ext}"
            (settings.UPLOAD_DIR / stored_name).write_bytes(blob)
            sha256 = hashlib.sha256(blob).hexdigest()
            conn.execute(
                """
                INSERT INTO inspection_images (
                    inspection_id, original_filename, stored_filename,
                    mime_type, file_size_bytes, sha256_hash, uploaded_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (insp_id, orig_name, stored_name, mime_type, len(blob), sha256, user["id"]),
            )
            saved_images.append({"original_filename": orig_name, "stored_filename": stored_name, "mime_type": mime_type, "file_size_bytes": len(blob)})

        created_fault_code = None
        if report_fault:
            created_fault_code = _next_code(conn, "fault_reports", "fault_code", "FLT-2026")
            conn.execute(
                """
                INSERT INTO fault_reports (
                    fault_code, inspection_id, asset_id, reported_by, category,
                    severity, title, description, ai_mode, human_verified, status, is_demo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', 0, 'Open', 0)
                """,
                (
                    created_fault_code,
                    insp_id,
                    asset_id,
                    user["id"],
                    clean_text(fault_category),
                    fault_severity,
                    clean_text(fault_title),
                    clean_text(fault_description) or cleaned_obs,
                ),
            )
            if fault_severity in ("High", "Critical"):
                new_cond = "Critical Alert" if fault_severity == "Critical" else "Needs Attention"
                conn.execute("UPDATE railway_assets SET current_condition = ?, updated_at = ? WHERE id = ?", (new_cond, _now_utc_iso(), asset_id))

        _notify_roles(
            conn,
            ("engineer", "admin", "inspector"),
            title=f"New Inspection Submitted ({insp_code})",
            message=f"{user['full_name']} submitted an inspection for {asset['asset_code']} — waiting for review.",
            category="inspection_submitted",
            severity="warning" if report_fault else "info",
            link_path="/inspections",
        )

        log_activity(
            conn,
            actor_user_id=user["id"],
            actor_username=user["username"],
            actor_role=user["role"],
            action="INSPECTION_SAVED",
            entity_type="inspection",
            entity_id=insp_code,
            details=f"Asset {asset['asset_code']} | Photos: {len(saved_images)}",
            ip_address=get_client_ip(request),
        )
        conn.commit()
        created = conn.execute(
            """
            SELECT i.*, a.asset_code, a.name AS asset_name, u.full_name AS inspector_name
            FROM inspections i JOIN railway_assets a ON a.id = i.asset_id JOIN users u ON u.id = i.inspector_id
            WHERE i.id = ?
            """,
            (insp_id,),
        ).fetchone()

    result = dict(created)
    result["images"] = saved_images
    result["created_fault_code"] = created_fault_code
    return result


@app.get("/api/files/{stored_filename}")
@app.get("/api/inspections/images/{stored_filename}")
def get_uploaded_image(stored_filename: str, _: dict[str, Any] = Depends(get_current_user)):
    if not SAFE_IMAGE_NAME_RE.match(stored_filename):
        raise HTTPException(status_code=400, detail="Invalid image name.")
    file_path = (settings.UPLOAD_DIR / stored_filename).resolve()
    if not str(file_path).startswith(str(settings.UPLOAD_DIR.resolve())) or not file_path.exists():
        raise HTTPException(status_code=404, detail="Image not found.")
    return FileResponse(path=str(file_path), headers={"X-Content-Type-Options": "nosniff"})


@app.patch("/api/inspections/{inspection_id}/review")
def review_inspection(
    inspection_id: int,
    payload: InspectionReviewRequest,
    request: Request,
    reviewer: dict[str, Any] = Depends(require_roles("engineer", "inspector", "admin")),
):
    with get_db() as conn:
        insp = conn.execute("SELECT id, inspection_code, inspector_id FROM inspections WHERE id = ?", (inspection_id,)).fetchone()
        if not insp:
            raise HTTPException(status_code=404, detail="Inspection not found.")

        conn.execute(
            "UPDATE inspections SET status = ?, reviewer_id = ?, review_notes = ?, reviewed_at = ?, updated_at = ? WHERE id = ?",
            (payload.status, reviewer["id"], clean_text(payload.review_notes), _now_utc_iso(), _now_utc_iso(), inspection_id),
        )
        conn.execute(
            """
            INSERT INTO notifications (user_id, title, message, category, severity, link_path)
            VALUES (?, ?, ?, 'inspection_reviewed', ?, '/inspections')
            """,
            (
                insp["inspector_id"],
                f"Inspection {insp['inspection_code']}: {payload.status}",
                f"Reviewed by {reviewer['full_name']}: {clean_text(payload.review_notes) or 'No extra notes.'}",
                "success" if payload.status == "Approved" else "warning",
            ),
        )
        log_activity(
            conn,
            actor_user_id=reviewer["id"],
            actor_username=reviewer["username"],
            actor_role=reviewer["role"],
            action=f"INSPECTION_REVIEWED",
            entity_type="inspection",
            entity_id=insp["inspection_code"],
            details=f"Marked {payload.status}",
            ip_address=get_client_ip(request),
        )
        conn.commit()
        updated = conn.execute(
            """
            SELECT i.*, a.asset_code, a.name AS asset_name,
                   u.full_name AS inspector_name, r.full_name AS reviewer_name
            FROM inspections i JOIN railway_assets a ON a.id = i.asset_id
            JOIN users u ON u.id = i.inspector_id LEFT JOIN users r ON r.id = i.reviewer_id
            WHERE i.id = ?
            """,
            (inspection_id,),
        ).fetchone()
    return dict(updated)


# ---------------------------------------------------------------------------
# Fault Reports & AI Inspection Check
# ---------------------------------------------------------------------------


@app.get("/api/faults")
def list_faults(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    asset_id: Optional[int] = Query(default=None, ge=1),
    _: dict[str, Any] = Depends(get_current_user),
):
    where = ["1=1"]
    params: list[Any] = []
    if status_filter:
        where.append("f.status = ?")
        params.append(status_filter)
    if asset_id is not None:
        where.append("f.asset_id = ?")
        params.append(asset_id)

    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT f.*, a.asset_code, a.name AS asset_name,
                   u.full_name AS reporter_name, v.full_name AS verifier_name,
                   i.inspection_code
            FROM fault_reports f
            JOIN railway_assets a ON a.id = f.asset_id
            JOIN users u ON u.id = f.reported_by
            LEFT JOIN users v ON v.id = f.verified_by
            LEFT JOIN inspections i ON i.id = f.inspection_id
            WHERE {' AND '.join(where)}
            ORDER BY f.created_at DESC, f.id DESC
            """,
            params,
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@app.post("/api/faults", status_code=201)
def create_fault_report(
    payload: FaultCreateRequest,
    request: Request,
    user: dict[str, Any] = Depends(require_roles("inspector", "engineer", "admin")),
):
    with get_db() as conn:
        asset = conn.execute("SELECT id, asset_code FROM railway_assets WHERE id = ?", (payload.asset_id,)).fetchone()
        if not asset:
            raise HTTPException(status_code=404, detail="Asset not found.")

        fault_code = _next_code(conn, "fault_reports", "fault_code", "FLT-2026")
        verified = 1 if (payload.human_verified and user["role"] in ("engineer", "admin", "inspector")) else 0
        cur = conn.execute(
            """
            INSERT INTO fault_reports (
                fault_code, inspection_id, asset_id, reported_by, category, severity,
                title, description, ai_analysis_json, ai_confidence, ai_mode, human_verified,
                verified_by, verified_at, status, is_demo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', 0)
            """,
            (
                fault_code,
                payload.inspection_id,
                payload.asset_id,
                user["id"],
                clean_text(payload.category),
                payload.severity,
                clean_text(payload.title),
                clean_text(payload.description),
                payload.ai_analysis_json,
                payload.ai_confidence,
                payload.ai_mode,
                verified,
                user["id"] if verified else None,
                _now_utc_iso() if verified else None,
            ),
        )
        fid = cur.lastrowid
        log_activity(
            conn,
            actor_user_id=user["id"],
            actor_username=user["username"],
            actor_role=user["role"],
            action="FAULT_ADDED",
            entity_type="fault",
            entity_id=fault_code,
            details=f"{payload.severity} issue on {asset['asset_code']}",
            ip_address=get_client_ip(request),
        )
        conn.commit()
        created = conn.execute("SELECT * FROM fault_reports WHERE id = ?", (fid,)).fetchone()
    return dict(created)


@app.patch("/api/faults/{fault_id}/verify")
def verify_fault_report(
    fault_id: int,
    payload: FaultVerifyRequest,
    request: Request,
    reviewer: dict[str, Any] = Depends(require_roles("engineer", "inspector", "admin")),
):
    with get_db() as conn:
        fault = conn.execute("SELECT * FROM fault_reports WHERE id = ?", (fault_id,)).fetchone()
        if not fault:
            raise HTTPException(status_code=404, detail="Fault report not found.")

        conn.execute(
            """
            UPDATE fault_reports
            SET human_verified = ?, verified_by = ?, verified_at = ?,
                severity = COALESCE(?, severity),
                category = COALESCE(?, category),
                status = COALESCE(?, status),
                updated_at = ?
            WHERE id = ?
            """,
            (
                1 if payload.human_verified else 0,
                reviewer["id"] if payload.human_verified else None,
                _now_utc_iso() if payload.human_verified else None,
                payload.severity,
                clean_text(payload.category) if payload.category else None,
                payload.status,
                _now_utc_iso(),
                fault_id,
            ),
        )
        log_activity(
            conn,
            actor_user_id=reviewer["id"],
            actor_username=reviewer["username"],
            actor_role=reviewer["role"],
            action="FAULT_VERIFIED",
            entity_type="fault",
            entity_id=fault["fault_code"],
            details=f"Human approved={payload.human_verified}",
            ip_address=get_client_ip(request),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM fault_reports WHERE id = ?", (fault_id,)).fetchone()
    return dict(updated)


@app.post("/api/ai/analyze")
async def ai_analyze_draft(
    request: Request,
    observed_conditions: str = Form(...),
    inspection_category: str = Form(default="Routine Check"),
    asset_id: Optional[int] = Form(default=None),
    files: list[UploadFile] = File(default=[]),
    user: dict[str, Any] = Depends(get_current_user),
):
    cleaned = clean_text(observed_conditions)
    if len(cleaned) < 5:
        raise HTTPException(status_code=400, detail="Please enter at least 5 characters of notes first.")

    validated = await _save_validated_uploads(files, max_count=3)
    image_blobs = [(blob, mime) for blob, mime, _, _ in validated]

    asset_ctx = None
    with get_db() as conn:
        if asset_id is not None:
            row = conn.execute(
                "SELECT a.id, a.asset_code, a.name, a.section_location, c.name AS category_name FROM railway_assets a JOIN asset_categories c ON c.id = a.category_id WHERE a.id = ?",
                (asset_id,),
            ).fetchone()
            if row:
                asset_ctx = dict(row)

        analysis = analyze_inspection_with_ai(
            observed_conditions=cleaned,
            inspection_category=inspection_category,
            image_blobs=image_blobs,
            asset_context=asset_ctx,
        )
        log_activity(
            conn,
            actor_user_id=user["id"],
            actor_username=user["username"],
            actor_role=user["role"],
            action="AI_CHECK_RUN",
            entity_type="ai",
            entity_id=asset_ctx["asset_code"] if asset_ctx else "draft",
            details=f"Mode={analysis['mode']}",
            ip_address=get_client_ip(request),
        )
        conn.commit()
    return analysis


@app.post("/api/ai/analyze-inspection/{inspection_id}")
def ai_analyze_existing_inspection(
    inspection_id: int,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    with get_db() as conn:
        insp = conn.execute(
            """
            SELECT i.*, a.asset_code, a.name AS asset_name, a.section_location, c.name AS category_name
            FROM inspections i JOIN railway_assets a ON a.id = i.asset_id JOIN asset_categories c ON c.id = a.category_id
            WHERE i.id = ?
            """,
            (inspection_id,),
        ).fetchone()
        if not insp:
            raise HTTPException(status_code=404, detail="Inspection not found.")

        imgs = conn.execute("SELECT stored_filename, mime_type FROM inspection_images WHERE inspection_id = ?", (inspection_id,)).fetchall()
        image_blobs: list[tuple[bytes, str]] = []
        for img in imgs[:3]:
            path = settings.UPLOAD_DIR / img["stored_filename"]
            if path.exists():
                image_blobs.append((path.read_bytes(), img["mime_type"]))

        analysis = analyze_inspection_with_ai(
            observed_conditions=insp["observed_conditions"],
            inspection_category=insp["inspection_category"],
            image_blobs=image_blobs,
            asset_context={
                "asset_code": insp["asset_code"],
                "name": insp["asset_name"],
                "section_location": insp["section_location"],
                "category_name": insp["category_name"],
            },
        )
        log_activity(
            conn,
            actor_user_id=user["id"],
            actor_username=user["username"],
            actor_role=user["role"],
            action="AI_INSPECTION_CHECKED",
            entity_type="inspection",
            entity_id=insp["inspection_code"],
            details=f"Mode={analysis['mode']}",
            ip_address=get_client_ip(request),
        )
        conn.commit()
    return analysis


# ---------------------------------------------------------------------------
# Maintenance Management (New -> Assigned -> In Progress -> Waiting for Review -> Completed)
# ---------------------------------------------------------------------------


@app.get("/api/work-orders")
def list_work_orders(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    priority: Optional[str] = Query(default=None),
    assigned_to_me: bool = Query(default=False),
    user: dict[str, Any] = Depends(get_current_user),
):
    where = ["1=1"]
    params: list[Any] = []
    if status_filter:
        where.append("w.status = ?")
        params.append(status_filter)
    if priority:
        where.append("w.priority = ?")
        params.append(priority)
    if assigned_to_me:
        where.append("w.assigned_to = ?")
        params.append(user["id"])

    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT w.*, a.asset_code, a.name AS asset_name, a.section_location,
                   u.full_name AS assignee_name, c.full_name AS creator_name,
                   f.fault_code,
                   (SELECT COUNT(*) FROM work_order_images wi WHERE wi.work_order_id = w.id) AS image_count
            FROM work_orders w
            JOIN railway_assets a ON a.id = w.asset_id
            LEFT JOIN users u ON u.id = w.assigned_to
            JOIN users c ON c.id = w.created_by
            LEFT JOIN fault_reports f ON f.id = w.fault_report_id
            WHERE {' AND '.join(where)}
            ORDER BY
                CASE w.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
                w.due_date ASC
            """,
            params,
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@app.post("/api/work-orders", status_code=201)
def create_work_order(
    payload: WorkOrderCreateRequest,
    request: Request,
    creator: dict[str, Any] = Depends(require_roles("engineer", "admin")),
):
    with get_db() as conn:
        asset = conn.execute("SELECT id, asset_code, name FROM railway_assets WHERE id = ?", (payload.asset_id,)).fetchone()
        if not asset:
            raise HTTPException(status_code=404, detail="Asset not found.")

        assignee = None
        if payload.assigned_to is not None:
            assignee = conn.execute(
                "SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND r.name IN ('engineer', 'staff') AND u.is_active = 1",
                (payload.assigned_to,),
            ).fetchone()
            if not assignee:
                raise HTTPException(status_code=400, detail="Assigned person must be an active Engineer or Maintenance Staff member.")

        initial_status = "Assigned" if assignee else "New"
        wo_code = _next_code(conn, "work_orders", "work_order_code", "TASK-2026")

        cur = conn.execute(
            """
            INSERT INTO work_orders (
                work_order_code, asset_id, fault_report_id, inspection_id,
                title, description, priority, status, assigned_to, created_by,
                due_date, is_demo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            """,
            (
                wo_code,
                payload.asset_id,
                payload.fault_report_id,
                payload.inspection_id,
                clean_text(payload.title),
                clean_text(payload.description),
                payload.priority,
                initial_status,
                payload.assigned_to,
                creator["id"],
                payload.due_date,
            ),
        )
        wo_id = cur.lastrowid

        if payload.fault_report_id:
            conn.execute("UPDATE fault_reports SET status = 'Assigned', updated_at = ? WHERE id = ?", (_now_utc_iso(), payload.fault_report_id))

        conn.execute(
            """
            INSERT INTO maintenance_records (
                work_order_id, asset_id, performed_by, previous_status,
                new_status, action_summary, notes
            ) VALUES (?, ?, ?, NULL, ?, ?, ?)
            """,
            (
                wo_id,
                payload.asset_id,
                creator["id"],
                initial_status,
                "Maintenance task created",
                f"Assigned to {assignee['full_name']}" if assignee else "Added as New task.",
            ),
        )

        if assignee:
            conn.execute(
                """
                INSERT INTO notifications (user_id, title, message, category, severity, link_path)
                VALUES (?, ?, ?, 'task_assigned', ?, '/maintenance')
                """,
                (
                    assignee["id"],
                    f"Maintenance Task Assigned ({wo_code})",
                    f"{payload.priority} task for {asset['asset_code']}: {payload.title}",
                    "warning" if payload.priority in ("High", "Critical") else "info",
                ),
            )

        log_activity(
            conn,
            actor_user_id=creator["id"],
            actor_username=creator["username"],
            actor_role=creator["role"],
            action="TASK_CREATED",
            entity_type="task",
            entity_id=wo_code,
            details=f"{payload.priority} task for {asset['asset_code']}",
            ip_address=get_client_ip(request),
        )
        conn.commit()
        created = conn.execute(
            """
            SELECT w.*, a.asset_code, a.name AS asset_name, u.full_name AS assignee_name
            FROM work_orders w JOIN railway_assets a ON a.id = w.asset_id LEFT JOIN users u ON u.id = w.assigned_to
            WHERE w.id = ?
            """,
            (wo_id,),
        ).fetchone()
    return dict(created)


@app.get("/api/work-orders/{wo_id}")
def get_work_order_detail(wo_id: int, _: dict[str, Any] = Depends(get_current_user)):
    with get_db() as conn:
        wo = conn.execute(
            """
            SELECT w.*, a.asset_code, a.name AS asset_name, a.section_location,
                   u.full_name AS assignee_name, c.full_name AS creator_name
            FROM work_orders w JOIN railway_assets a ON a.id = w.asset_id
            LEFT JOIN users u ON u.id = w.assigned_to JOIN users c ON c.id = w.created_by
            WHERE w.id = ?
            """,
            (wo_id,),
        ).fetchone()
        if not wo:
            raise HTTPException(status_code=404, detail="Maintenance task not found.")

        history = conn.execute(
            """
            SELECT m.*, u.full_name AS performed_by_name, u.username AS performed_by_username
            FROM maintenance_records m JOIN users u ON u.id = m.performed_by
            WHERE m.work_order_id = ?
            ORDER BY m.recorded_at ASC, m.id ASC
            """,
            (wo_id,),
        ).fetchall()

        images = conn.execute(
            "SELECT id, original_filename, stored_filename, mime_type, file_size_bytes, created_at FROM work_order_images WHERE work_order_id = ? ORDER BY id DESC",
            (wo_id,),
        ).fetchall()
    return {"work_order": dict(wo), "history": [dict(h) for h in history], "images": [dict(img) for img in images]}


@app.post("/api/work-orders/{wo_id}/images", status_code=201)
async def upload_work_order_images(
    wo_id: int,
    files: list[UploadFile] = File(...),
    user: dict[str, Any] = Depends(require_roles("staff", "engineer", "admin")),
):
    validated = await _save_validated_uploads(files, max_count=5)
    if not validated:
        raise HTTPException(status_code=400, detail="Please pick at least one valid image.")
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    saved = []
    with get_db() as conn:
        wo = conn.execute("SELECT id, assigned_to FROM work_orders WHERE id = ?", (wo_id,)).fetchone()
        if not wo:
            raise HTTPException(status_code=404, detail="Maintenance task not found.")
        if user["role"] == "staff" and wo["assigned_to"] != user["id"]:
            raise HTTPException(status_code=403, detail="You can only upload images to tasks assigned to you.")

        for blob, mime, ext, orig in validated:
            stored = f"{secrets.token_hex(16)}{ext}"
            (settings.UPLOAD_DIR / stored).write_bytes(blob)
            sha = hashlib.sha256(blob).hexdigest()
            conn.execute(
                """
                INSERT INTO work_order_images (work_order_id, original_filename, stored_filename, mime_type, file_size_bytes, sha256_hash, uploaded_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (wo_id, orig, stored, mime, len(blob), sha, user["id"]),
            )
            saved.append({"original_filename": orig, "stored_filename": stored, "mime_type": mime, "file_size_bytes": len(blob)})
        conn.commit()
    return {"items": saved}


@app.patch("/api/work-orders/{wo_id}")
def update_work_order(
    wo_id: int,
    payload: WorkOrderUpdateRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    with get_db() as conn:
        wo = conn.execute("SELECT * FROM work_orders WHERE id = ?", (wo_id,)).fetchone()
        if not wo:
            raise HTTPException(status_code=404, detail="Maintenance task not found.")

        if user["role"] == "inspector":
            raise HTTPException(status_code=403, detail="Inspectors cannot edit maintenance tasks.")

        if user["role"] == "staff":
            if wo["assigned_to"] != user["id"]:
                raise HTTPException(status_code=403, detail="Maintenance Staff can only update tasks assigned to them.")
            if payload.assigned_to is not None or payload.priority is not None or payload.due_date is not None:
                raise HTTPException(status_code=403, detail="Only Engineers or Admins can reassign or change priority and due dates.")
            if payload.status and payload.status not in ("In Progress", "Waiting for Review"):
                raise HTTPException(
                    status_code=403,
                    detail="Maintenance Staff can move tasks to 'In Progress' or 'Waiting for Review'. An Engineer or Admin marks tasks Completed.",
                )

        prev_status = wo["status"]
        new_status = payload.status or prev_status
        if payload.assigned_to is not None and new_status == "New":
            new_status = "Assigned"

        if payload.assigned_to is not None:
            assignee = conn.execute(
                "SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND r.name IN ('engineer', 'staff') AND u.is_active = 1",
                (payload.assigned_to,),
            ).fetchone()
            if not assignee:
                raise HTTPException(status_code=400, detail="Assigned person must be an active Engineer or Maintenance Staff member.")

        completed_at = _now_utc_iso() if new_status == "Completed" and prev_status != "Completed" else wo["completed_at"]

        conn.execute(
            """
            UPDATE work_orders
            SET status = ?,
                assigned_to = COALESCE(?, assigned_to),
                priority = COALESCE(?, priority),
                due_date = COALESCE(?, due_date),
                maintenance_notes = COALESCE(?, maintenance_notes),
                completion_notes = COALESCE(?, completion_notes),
                completed_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                new_status,
                payload.assigned_to,
                payload.priority,
                payload.due_date,
                clean_text(payload.maintenance_notes) if payload.maintenance_notes is not None else None,
                clean_text(payload.completion_notes) if payload.completion_notes is not None else None,
                completed_at,
                _now_utc_iso(),
                wo_id,
            ),
        )

        if new_status == "Completed":
            if wo["fault_report_id"]:
                conn.execute("UPDATE fault_reports SET status = 'Resolved', updated_at = ? WHERE id = ?", (_now_utc_iso(), wo["fault_report_id"]))
            _notify_roles(
                conn,
                ("admin", "engineer", "inspector"),
                title=f"Maintenance Task Completed ({wo['work_order_code']})",
                message=f"{wo['title']} was marked Completed by {user['full_name']}.",
                category="task_completed",
                severity="success",
                link_path="/maintenance",
            )

        summary = clean_text(payload.action_summary) if payload.action_summary else (
            f"Moved from {prev_status} to {new_status}" if new_status != prev_status else "Notes updated"
        )
        note_body = clean_text(payload.completion_notes or payload.maintenance_notes or "")

        conn.execute(
            """
            INSERT INTO maintenance_records (
                work_order_id, asset_id, performed_by, previous_status,
                new_status, action_summary, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (wo_id, wo["asset_id"], user["id"], prev_status, new_status, summary, note_body),
        )
        log_activity(
            conn,
            actor_user_id=user["id"],
            actor_username=user["username"],
            actor_role=user["role"],
            action="TASK_UPDATED",
            entity_type="task",
            entity_id=wo["work_order_code"],
            details=f"{prev_status} -> {new_status}",
            ip_address=get_client_ip(request),
        )
        conn.commit()
        updated = conn.execute(
            """
            SELECT w.*, a.asset_code, a.name AS asset_name, u.full_name AS assignee_name
            FROM work_orders w JOIN railway_assets a ON a.id = w.asset_id LEFT JOIN users u ON u.id = w.assigned_to
            WHERE w.id = ?
            """,
            (wo_id,),
        ).fetchone()
    return dict(updated)


# ---------------------------------------------------------------------------
# Reports (5 Report Types + CSV & PDF Downloads)
# ---------------------------------------------------------------------------


@app.get("/api/reports")
def get_reports(_: dict[str, Any] = Depends(require_roles("admin", "engineer", "inspector"))):
    with get_db() as conn:
        return build_report_data(conn)


@app.get("/api/reports/export")
def export_reports(
    request: Request,
    fmt: str = Query(default="pdf", pattern="^(csv|pdf)$"),
    report_type: str = Query(default="asset_condition", pattern="^(inspections|asset_condition|maintenance|overdue_tasks|team_activity|fault_summary)$"),
    user: dict[str, Any] = Depends(require_roles("admin", "engineer", "inspector")),
):
    with get_db() as conn:
        report = build_report_data(conn)
        log_activity(
            conn,
            actor_user_id=user["id"],
            actor_username=user["username"],
            actor_role=user["role"],
            action="REPORT_DOWNLOADED",
            entity_type="report",
            entity_id=f"{report_type}.{fmt}",
            details=f"Downloaded {report_type} ({fmt.upper()})",
            ip_address=get_client_ip(request),
        )
        conn.commit()

    if fmt == "pdf":
        pdf_bytes = export_report_pdf(report, report_type)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="railpulse-{report_type}-report.pdf"',
                "X-Content-Type-Options": "nosniff",
            },
        )

    csv_text = export_report_csv(report, report_type)
    return PlainTextResponse(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="railpulse-{report_type}-report.csv"',
            "X-Content-Type-Options": "nosniff",
        },
    )


# ---------------------------------------------------------------------------
# Notifications & RAILY Assistant
# ---------------------------------------------------------------------------


@app.get("/api/notifications")
def list_notifications(user: dict[str, Any] = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, title, message, category, severity, link_path, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40",
            (user["id"],),
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@app.patch("/api/notifications/{notif_id}/read")
def mark_notification_read(notif_id: int, user: dict[str, Any] = Depends(get_current_user)):
    with get_db() as conn:
        conn.execute("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?", (notif_id, user["id"]))
        conn.commit()
    return {"ok": True}


@app.post("/api/notifications/read-all")
def mark_all_notifications_read(user: dict[str, Any] = Depends(get_current_user)):
    with get_db() as conn:
        conn.execute("UPDATE notifications SET is_read = 1 WHERE user_id = ?", (user["id"],))
        conn.commit()
    return {"ok": True}


@app.post("/api/assistant/chat")
def raily_assistant_chat(payload: RailyChatRequest, user: dict[str, Any] = Depends(get_current_user)):
    with get_db() as conn:
        dash = compute_dashboard_summary(conn)
        kpis = dash["kpis"]
        snapshot = {
            "total_assets": kpis["total_assets"],
            "assets_requiring_attention": kpis["assets_requiring_attention"],
            "critical_alerts": kpis["critical_alerts"],
            "inspections_completed": kpis["inspections_completed"],
            "inspections_waiting": kpis["inspections_waiting"],
            "open_maintenance_tasks": kpis["open_maintenance_tasks"],
            "waiting_review_tasks": kpis["waiting_review_tasks"],
        }

    return generate_raily_reply(
        message=clean_text(payload.message),
        current_route=payload.current_route,
        user_role=user["role"],
        db_snapshot=snapshot,
    )


# ---------------------------------------------------------------------------
# Static Frontend Serving (when built into dist/)
# ---------------------------------------------------------------------------

DIST_DIR = BASE_DIR / "dist"
if DIST_DIR.exists() and (DIST_DIR / "index.html").exists():
    assets_dir = DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="frontend-assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found.")
        candidate = (DIST_DIR / full_path).resolve()
        if full_path and str(candidate).startswith(str(DIST_DIR.resolve())) and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(DIST_DIR / "index.html"))
