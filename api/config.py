"""Application configuration loaded safely from environment variables."""

from __future__ import annotations

import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _default_writable_dir(subpath: str) -> Path:
    """Use project data/ locally, or /tmp when deployed to read-only serverless hosts."""
    if os.environ.get("VERCEL") or os.environ.get("RAILPULSE_READONLY_FS") == "true":
        return Path("/tmp/railpulse_data") / subpath
    return BASE_DIR / "data" / subpath


class Settings:
    """Central runtime configuration for RAILPULSE AI."""

    ENV: str = os.environ.get("RAILPULSE_ENV", "development").lower()
    _configured_secret: str = os.environ.get("RAILPULSE_JWT_SECRET", "").strip()
    # Generate an ephemeral cryptographic key if running locally without .env;
    # never embed a static secret string in source code.
    JWT_SECRET: str = (
        _configured_secret
        if len(_configured_secret) >= 32 and "change-this" not in _configured_secret
        else secrets.token_urlsafe(48)
    )
    USING_EPHEMERAL_SECRET: bool = not (
        len(_configured_secret) >= 32 and "change-this" not in _configured_secret
    )
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = int(os.environ.get("RAILPULSE_JWT_EXPIRE_MINUTES", "480"))

    ALLOWED_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.environ.get(
            "RAILPULSE_ALLOWED_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000",
        ).split(",")
        if origin.strip()
    ]

    DB_PATH: Path = Path(
        os.environ.get("RAILPULSE_DB_PATH") or str(_default_writable_dir("railpulse.db"))
    )
    UPLOAD_DIR: Path = Path(
        os.environ.get("RAILPULSE_UPLOAD_DIR") or str(_default_writable_dir("uploads"))
    )
    SCHEMA_PATH: Path = BASE_DIR / "database" / "schema.sql"

    ENABLE_DEMO_DATA: bool = os.environ.get("RAILPULSE_ENABLE_DEMO_DATA", "true").lower() == "true"

    GEMINI_API_KEY: str = os.environ.get("GEMINI_API_KEY", "").strip()
    GEMINI_MODEL: str = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()

    MAX_IMAGE_BYTES: int = 5 * 1024 * 1024  # 5 MB
    MAX_IMAGES_PER_INSPECTION: int = 5
    ALLOWED_IMAGE_MIME_TYPES: set[str] = {"image/jpeg", "image/png", "image/webp"}


settings = Settings()
