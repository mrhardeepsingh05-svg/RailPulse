"""SQLite relational database manager with schema initialization and v2 migration support."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from api.config import settings


def _ensure_dirs() -> None:
    settings.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    """Open a SQLite connection with foreign keys and WAL mode enabled."""
    target = db_path or settings.DB_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target), check_same_thread=False, timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    """Context manager yielding a database connection and closing it cleanly."""
    conn = get_connection()
    try:
        yield conn
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
    if "current_condition" not in cols or "latitude" not in cols:
        return True
    return False


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
        conn.executescript(schema_sql)
        conn.commit()
    finally:
        conn.close()
