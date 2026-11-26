"""Security utilities: password hashing, JWT auth, RBAC, upload validation, rate limiting, and sanitization."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from api.config import settings
from api.database import get_db

PBKDF2_ITERATIONS = 260_000
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    """Hash a password using PBKDF2-HMAC-SHA256 with a 16-byte cryptographic salt."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Constant-time password verification against stored PBKDF2 hash."""
    try:
        scheme, iter_str, salt_hex, hash_hex = stored_hash.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        iterations = int(iter_str)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except (ValueError, TypeError):
        return False

    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(candidate, expected)


def create_access_token(user_id: int, username: str, role: str) -> str:
    """Create a signed HS256 JWT access token."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)).timestamp()),
        "jti": secrets.token_hex(12),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and validate an HS256 JWT access token."""
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        ) from exc


def get_client_ip(request: Request) -> str:
    """Extract client IP safely, respecting standard proxy headers when present."""
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded:
        return forwarded[:64]
    return request.client.host if request.client else "unknown"


def log_activity(
    conn: Any,
    *,
    actor_user_id: int | None,
    actor_username: str,
    actor_role: str,
    action: str,
    entity_type: str,
    entity_id: str,
    details: str = "",
    ip_address: str = "unknown",
) -> None:
    """Append an immutable audit log record."""
    conn.execute(
        """
        INSERT INTO activity_logs (
            actor_user_id, actor_username, actor_role, action,
            entity_type, entity_id, details, ip_address
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            actor_user_id,
            actor_username,
            actor_role,
            action,
            entity_type,
            str(entity_id),
            details[:1000],
            ip_address[:64],
        ),
    )


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    """Resolve and verify the currently authenticated user from JWT + live DB check."""
    token = credentials.credentials if credentials else request.cookies.get("railpulse_token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    payload = decode_access_token(token)
    user_id = int(payload["sub"])

    with get_db() as conn:
        row = conn.execute(
            """
            SELECT u.id, u.username, u.email, u.full_name, u.department,
                   u.is_active, u.is_demo, r.name AS role, r.display_name AS role_display
            FROM users u
            JOIN roles r ON r.id = u.role_id
            WHERE u.id = ?
            """,
            (user_id,),
        ).fetchone()

    if not row or not row["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is inactive or no longer exists.",
        )

    return dict(row)


def require_roles(*allowed_roles: str) -> Callable[..., dict[str, Any]]:
    """Dependency factory enforcing backend RBAC."""

    def _checker(
        request: Request,
        user: dict[str, Any] = Depends(get_current_user),
    ) -> dict[str, Any]:
        if user["role"] not in allowed_roles:
            with get_db() as conn:
                log_activity(
                    conn,
                    actor_user_id=user["id"],
                    actor_username=user["username"],
                    actor_role=user["role"],
                    action="ACCESS_DENIED",
                    entity_type="endpoint",
                    entity_id=request.url.path,
                    details=f"Role '{user['role']}' attempted restricted action requiring {allowed_roles}",
                    ip_address=get_client_ip(request),
                )
                conn.commit()
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied. Required role: {', '.join(allowed_roles)}.",
            )
        return user

    return _checker


def detect_image_mime_from_magic_bytes(data: bytes) -> str | None:
    """Verify actual image file signature (magic bytes) to prevent spoofed uploads."""
    if len(data) < 12:
        return None
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def validate_image_upload(data: bytes, filename: str, declared_mime: str | None) -> tuple[str, str]:
    """Validate uploaded image size, extension, declared MIME, and magic bytes."""
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded image file is empty.")
    if len(data) > settings.MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Image exceeds maximum allowed size of {settings.MAX_IMAGE_BYTES // (1024 * 1024)} MB.",
        )

    detected_mime = detect_image_mime_from_magic_bytes(data)
    if detected_mime not in settings.ALLOWED_IMAGE_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Unsupported or invalid image signature. Allowed formats: JPEG, PNG, WebP.",
        )

    ext_map = {
        "image/jpeg": {".jpg", ".jpeg"},
        "image/png": {".png"},
        "image/webp": {".webp"},
    }
    lower_name = (filename or "").lower()
    if not any(lower_name.endswith(ext) for ext in ext_map[detected_mime]):
        raise HTTPException(
            status_code=400,
            detail="File extension does not match verified image format.",
        )

    if declared_mime and declared_mime.lower() not in settings.ALLOWED_IMAGE_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported image MIME type.")

    canonical_ext = ".jpg" if detected_mime == "image/jpeg" else ".png" if detected_mime == "image/png" else ".webp"
    return detected_mime, canonical_ext


def sanitize_csv_cell(value: Any) -> str:
    """Prevent CSV formula injection in spreadsheet tools."""
    text = "" if value is None else str(value)
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text
    return text


def clean_text(value: str) -> str:
    """Strip unsafe null bytes and excess whitespace from user-supplied text."""
    return value.replace("\x00", "").strip()


class SlidingWindowRateLimiter:
    """Thread-safe sliding window in-memory rate limiter."""

    def __init__(self) -> None:
        self._buckets: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, max_requests: int, window_seconds: int) -> tuple[bool, int]:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            q = self._buckets[key]
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= max_requests:
                retry_after = max(1, int(q[0] + window_seconds - now) + 1)
                return False, retry_after
            q.append(now)
            return True, 0

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()


rate_limiter = SlidingWindowRateLimiter()
