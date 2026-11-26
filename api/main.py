"""ASGI entry point alias for uvicorn (uvicorn api.main:app)."""

from api.index import app

__all__ = ["app"]
