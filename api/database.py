"""SQLite relational database manager with transaction rollback, integrity checks, and online backup."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from api.config import settings


def _ensure_dirs() -> None:
    settings.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    """Open a fast SQLite connection with foreign keys enabled."""
    target = db_path or settings.DB_PATH
    conn = sqlite3.connect(str(target), check_same_thread=False, timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 10000;")
    return conn


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    """Context manager yielding a database connection, rolling back on error, and closing cleanly."""
    conn = get_connection()
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _needs_v2_reset(conn: sqlite3.Connection) -> bool:
    """Detect older v1 local demo database so v2 schema (roles & columns) initializes cleanly."""
    tbl = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='railway_assets'"
    ).fetchone()
    if not tbl:
        return False
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(railway_assets)").fetchall()}
    return "current_condition" not in cols or "latitude" not in cols


def init_db(db_path: Path | None = None) -> None:
    """Apply the normalized SQL schema idempotently."""
    _ensure_dirs()
    schema_sql = settings.SCHEMA_PATH.read_text(encoding="utf-8")
    conn = get_connection(db_path)
    try:
        if _needs_v2_reset(conn):
            conn.close()
            target = db_path or settings.DB_PATH
            target.unlink(missing_ok=True)
            conn = get_connection(db_path)
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.executescript(schema_sql)
        conn.commit()
    finally:
        conn.close()


def check_db_integrity(db_path: Path | None = None) -> bool:
    """Verify SQLite database structural integrity."""
    conn = get_connection(db_path)
    try:
        row = conn.execute("PRAGMA integrity_check;").fetchone()
        return bool(row and row[0] == "ok")
    finally:
        conn.close()


def backup_database(dest_path: Path | None = None) -> Path:
    """Create an online consistent SQLite backup using sqlite3.Connection.backup()."""
    if dest_path is None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        dest_path = settings.DB_PATH.parent / "backups" / f"railpulse-backup-{stamp}.db"
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    src_conn = get_connection()
    dst_conn = sqlite3.connect(str(dest_path), timeout=15.0)
    try:
        src_conn.backup(dst_conn)
        dst_conn.commit()
    finally:
        dst_conn.close()
        src_conn.close()
    return dest_path
