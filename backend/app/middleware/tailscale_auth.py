"""DualAuth ASGI middleware: Tailscale Serve SSO (loopback) + Bearer API / HMAC Session tokens (LAN/WS/SSE)."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qs

from starlette.datastructures import Headers
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import is_configured
from app.config_manager import (
    get_config_manager,
    verify_session_token,
    verify_token_hash,
)

LOCAL_LOOPBACK_IPS = frozenset({"127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"})

_WEBHOOK_INGEST_RE = re.compile(r"^/api/custom-services/[^/]+/webhook$")
_CUSTOM_SERVICE_TEST_RE = re.compile(r"^/api/custom-services/[^/]+/test$")
_SERVICE_ITEM_TEST_RE = re.compile(r"^/api/services/items/[^/]+/test$")
_ADMIN_ONLY_READ_PATHS = frozenset(
    {
        "/api/config/yaml",
        "/api/config/export",
        "/api/auth/tokens",
        "/api/discovery/qr",
    }
)
_FIRST_RUN_EXEMPT_EXACT = frozenset(
    {
        "/api/setup/status",
        "/api/setup/test-service",
        "/api/setup/config",
        "/api/discovery/lan",
    }
)


def _extract_bearer_or_query_token(
    headers: Headers, scope: Scope, path: str
) -> str | None:
    """Extract token from Authorization: Bearer header, or ?token= on WS/SSE endpoints."""
    auth_header = (headers.get("authorization") or "").strip()
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        if token:
            return token

    if scope["type"] == "websocket" or path == "/api/events/stream" or path.startswith("/api/ws/"):
        raw_qs = scope.get("query_string", b"").decode("utf-8", errors="ignore")
        params = parse_qs(raw_qs, keep_blank_values=False)
        token_vals = params.get("token")
        if token_vals and token_vals[0].strip():
            return token_vals[0].strip()

    return None


def _is_public_exempt(path: str, scope_type: str, method: str) -> bool:
    """Return True for routes accessible without prior authentication."""
    if path == "/api/health" or path == "/api/auth/login":
        return True
    if path == "/api/pairing" or path.startswith("/api/pairing/"):
        return True
    if path == "/api/onboarding/status":
        return True
    if path.startswith("/assets/"):
        return True
    if scope_type == "http" and method in ("GET", "HEAD") and not path.startswith("/api") and path != "/metrics":
        return True
    if scope_type == "http" and method == "POST" and _WEBHOOK_INGEST_RE.match(path):
        return True

    if not is_configured():
        if path.startswith("/api/onboarding") or path in _FIRST_RUN_EXEMPT_EXACT:
            return True

    return False


def check_role_permission(role: str, path: str, method: str) -> tuple[bool, str]:
    """Enforce role-based permissions (`admin`, `operator`, `viewer`, `device`) on authenticated HTTP routes."""
    normalized_role = (role or "viewer").strip().lower()
    normalized_method = method.upper()

    if normalized_role == "admin":
        return True, ""

    if any(path == p or path.startswith(f"{p}/") for p in _ADMIN_ONLY_READ_PATHS):
        return (
            False,
            "Droits insuffisants : rôle 'admin' requis pour accéder à cette ressource.",
        )

    if path == "/api/notifications/devices" or path.startswith("/api/notifications/devices/"):
        return True, ""

    if normalized_method in ("GET", "HEAD", "OPTIONS"):
        return True, ""

    if normalized_role in ("operator", "device"):
        if (
            path.startswith("/api/pve/")
            or path.startswith("/api/operations/")
            or path.startswith("/api/ops/")
            or path.startswith("/api/incidents/")
            or _CUSTOM_SERVICE_TEST_RE.match(path)
            or _SERVICE_ITEM_TEST_RE.match(path)
        ):
            return True, ""
        return (
            False,
            "Droits insuffisants : rôle 'admin' requis pour modifier la configuration.",
        )

    return False, "Droits insuffisants : le rôle 'viewer' est en lecture seule."


def authenticate_scope(scope: Scope) -> tuple[dict[str, Any] | None, int, str]:
    """Authenticate an HTTP or WebSocket ASGI scope; return (user_dict, error_status, reason)."""
    headers = Headers(scope=scope)
    path = scope.get("path", "")
    client = scope.get("client")
    client_host = client[0] if client else ""

    manager = get_config_manager()
    cfg = manager.config
    security = cfg.security

    token = _extract_bearer_or_query_token(headers, scope, path)
    if token is not None:
        for entry in security.api_tokens:
            if verify_token_hash(token, entry.token_hash):
                return (
                    {
                        "login": f"token:{entry.name}",
                        "name": entry.name,
                        "profile_pic": "",
                        "auth_mode": "api_token",
                        "role": entry.role,
                        "token_id": entry.id,
                    },
                    200,
                    "",
                )

        claims = verify_session_token(token, manager.effective_session_secret)
        if claims is not None:
            return (
                {
                    "login": str(claims.get("sub", "session")),
                    "name": str(claims.get("name", claims.get("sub", "Session"))),
                    "profile_pic": "",
                    "auth_mode": "session",
                    "role": str(claims.get("role", "admin")),
                },
                200,
                "",
            )

        return None, 401, "Jeton d'authentification invalide ou expiré."

    if client_host in LOCAL_LOOPBACK_IPS:
        if security.dev_auth_bypass:
            primary_user = (
                security.allowed_tailscale_users[0]
                if security.allowed_tailscale_users
                else "dev@localhost"
            )
            return (
                {
                    "login": primary_user,
                    "name": "Admin (Mode Dev Local)",
                    "profile_pic": "",
                    "auth_mode": "dev_bypass",
                    "role": "admin",
                },
                200,
                "",
            )

        if security.tailscale_sso_enabled:
            ts_login = (headers.get("tailscale-user-login") or "").strip().lower()
            if not ts_login:
                return None, 401, "Authentification Tailscale Serve ou Bearer token requise."
            if ts_login not in set(security.allowed_tailscale_users):
                return (
                    None,
                    403,
                    f"Utilisateur '{ts_login}' non autorisé à accéder à ce panneau.",
                )
            return (
                {
                    "login": ts_login,
                    "name": (headers.get("tailscale-user-name") or ts_login).strip(),
                    "profile_pic": (
                        headers.get("tailscale-user-profile-pic") or ""
                    ).strip(),
                    "auth_mode": "tailscale_serve",
                    "role": "admin",
                },
                200,
                "",
            )

        return None, 401, "Authentification Bearer requise."

    return None, 401, "Authentification Bearer ou jeton de session requis hors loopback."


class TailscaleSSOMiddleware:
    """Pure ASGI DualAuth middleware supporting HTTP, SSE StreamingResponse, and WebSocket."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        scope_type = scope.get("type")
        if scope_type not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        method = str(scope.get("method", "GET")).upper()
        user, status_code, reason = authenticate_scope(scope)

        if user is not None:
            scope.setdefault("state", {})["user"] = user
            if scope_type == "http" and not _is_public_exempt(path, scope_type, method):
                allowed, deny_reason = check_role_permission(
                    str(user.get("role", "admin")), path, method
                )
                if not allowed:
                    deny_resp: Response = JSONResponse(
                        status_code=403,
                        content={"detail": deny_reason},
                    )
                    await deny_resp(scope, receive, send)
                    return
            await self.app(scope, receive, send)
            return

        if _is_public_exempt(path, scope_type, method):
            await self.app(scope, receive, send)
            return

        if scope_type == "websocket":
            # Consume initial websocket.connect if needed or reject immediately before accept
            await send({"type": "websocket.close", "code": 4401, "reason": reason[:120]})
            return

        response: Response = JSONResponse(
            status_code=status_code,
            content={"detail": reason},
            headers={"WWW-Authenticate": "Bearer"} if status_code == 401 else None,
        )
        await response(scope, receive, send)
