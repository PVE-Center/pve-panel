"""Setup wizard, service connectivity tests, and hot-reload configuration API."""

import asyncio
import json
import re
import shutil
import time
from typing import Any, Literal
from urllib.parse import quote, urlparse
import xml.etree.ElementTree as ET

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.config import (
    _sanitize_categories,
    _sanitize_storage_mounts,
    get_settings,
    is_configured,
    is_secret_configured,
    load_services_config,
    load_storage_mounts_config,
    reload_settings,
    save_services_yaml,
    update_env_file,
)
from app.config_manager import get_config_manager
from app.config_schema import AppConfig, is_masked_or_empty
from app.services.realtime_bus import get_realtime_bus

router = APIRouter(prefix="/api/setup", tags=["setup"])

ServiceName = Literal[
    "proxmox",
    "jellyfin",
    "jellyseerr",
    "plex",
    "stremio",
    "radarr",
    "sonarr",
    "prowlarr",
    "qbittorrent",
]

_TS_HOST_RE = re.compile(r"^[a-z0-9.-]+\.ts\.net(?::\d+)?$", re.IGNORECASE)

_SERVICE_SECRET_ATTR: dict[str, str] = {
    "proxmox": "pve_token_secret",
    "jellyfin": "jellyfin_api_key",
    "jellyseerr": "jellyseerr_api_key",
    "plex": "plex_token",
    "stremio": "stremio_password",
    "radarr": "radarr_api_key",
    "sonarr": "sonarr_api_key",
    "prowlarr": "prowlarr_api_key",
    "qbittorrent": "qbit_password",
}

_ARR_STATUS_PATHS: dict[str, str] = {
    "radarr": "/api/v3/system/status",
    "sonarr": "/api/v3/system/status",
    "prowlarr": "/api/v1/system/status",
}


class TestServicePayload(BaseModel):
    """Request payload for live connectivity & authentication verification."""

    service: ServiceName
    url: str = ""
    node: str | None = None
    token_id: str | None = None
    secret: str | None = None
    username: str | None = None
    verify_ssl: bool | None = None


class SetupConfigUpdatePayload(BaseModel):
    """Request payload for updating .env and services.yaml with hot reload."""

    env: dict[str, Any] | None = None
    categories: list[dict[str, Any]] | None = None
    storage_mounts: list[dict[str, Any]] | None = None


def _normalize_ts_host(raw_host: str | None) -> str:
    """Validate and normalize a *.ts.net host header into an HTTPS base URL."""
    host = (raw_host or "").split(",")[0].strip().lower()
    if not host or not _TS_HOST_RE.match(host):
        return ""
    if host.endswith(":443"):
        host = host[:-4]
    return f"https://{host}"


async def _detect_tailscale_url(request: Request) -> str:
    """Detect panel HTTPS URL from local tailscale CLI or incoming .ts.net Host header."""
    if shutil.which("tailscale"):
        proc: asyncio.subprocess.Process | None = None
        try:
            proc = await asyncio.create_subprocess_exec(
                "tailscale",
                "status",
                "--json",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=1.5)
            if proc.returncode == 0 and stdout:
                data = json.loads(stdout.decode("utf-8", errors="replace"))
                dns_name = str((data.get("Self") or {}).get("DNSName") or "").rstrip(".")
                if dns_name:
                    return f"https://{dns_name}"
        except Exception:
            if proc is not None and proc.returncode is None:
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass

    for header in ("x-forwarded-host", "host"):
        detected = _normalize_ts_host(request.headers.get(header))
        if detected:
            return detected
    return ""


def _build_env_summary() -> dict[str, Any]:
    """Return non-secret setup configuration fields and boolean secret presence flags."""
    settings = get_settings()
    return {
        "dev_auth_bypass": settings.dev_auth_bypass,
        "allowed_tailscale_users": settings.allowed_tailscale_users,
        "protected_owner_username": settings.protected_owner_username,
        "pve_host": settings.pve_host,
        "pve_node": settings.pve_node,
        "pve_token_id": settings.pve_token_id,
        "pve_token_secret_set": is_secret_configured(settings.pve_token_secret),
        "pve_verify_ssl": settings.pve_verify_ssl,
        "panel_self_vmid": settings.panel_self_vmid,
        "mergerfs_pool_subpath": settings.mergerfs_pool_subpath,
        "jellyfin_url": settings.jellyfin_url,
        "jellyfin_api_key_set": is_secret_configured(settings.jellyfin_api_key),
        "jellyseerr_url": settings.jellyseerr_url,
        "jellyseerr_api_key_set": is_secret_configured(settings.jellyseerr_api_key),
        "plex_url": settings.plex_url,
        "plex_token_set": is_secret_configured(settings.plex_token),
        "stremio_url": settings.stremio_url,
        "stremio_username": settings.stremio_username,
        "stremio_password_set": is_secret_configured(settings.stremio_password),
        "radarr_url": settings.radarr_url,
        "radarr_api_key_set": is_secret_configured(settings.radarr_api_key),
        "sonarr_url": settings.sonarr_url,
        "sonarr_api_key_set": is_secret_configured(settings.sonarr_api_key),
        "prowlarr_url": settings.prowlarr_url,
        "prowlarr_api_key_set": is_secret_configured(settings.prowlarr_api_key),
        "qbit_url": settings.qbit_url,
        "qbit_username": settings.qbit_username,
        "qbit_password_set": is_secret_configured(settings.qbit_password),
    }


def _test_result(
    service: str, ok: bool, message: str, latency_ms: float | None = None
) -> dict[str, Any]:
    return {
        "ok": ok,
        "service": service,
        "message": message,
        "latency_ms": latency_ms,
    }


def _extract_plex_version(resp: httpx.Response) -> str:
    """Extract Plex version from either JSON or XML /identity response."""
    text = resp.text.strip()
    if text.startswith("<"):
        root = ET.fromstring(text)
        return str(root.attrib.get("version") or "").split("-")[0]
    data = resp.json()
    return str((data.get("MediaContainer") or {}).get("version") or "").split("-")[0]


async def _run_service_probe(
    client: httpx.AsyncClient,
    payload: TestServicePayload,
    base_url: str,
    secret: str,
) -> tuple[bool, str]:
    """Execute service-specific HTTP probe and return (ok, human_message)."""
    service = payload.service
    settings = get_settings()

    if service == "proxmox":
        node = (payload.node or "").strip() or settings.pve_node
        token_id = (payload.token_id or "").strip() or settings.pve_token_id
        if not token_id or not is_secret_configured(secret):
            return False, "Token ID et Secret API Proxmox requis."
        resp = await client.get(
            f"{base_url}/api2/json/nodes/{node}/status",
            headers={"Authorization": f"PVEAPIToken={token_id}={secret}"},
        )
        if resp.status_code == 200:
            data = resp.json().get("data") or {}
            ver = str(data.get("pveversion") or "").strip()
            suffix = f" — PVE {ver}" if ver else ""
            return True, f"Connecté à Proxmox ({node}){suffix}."
        if resp.status_code in (401, 403):
            return False, "Authentification Proxmox refusée (Token ou rôle PanelRole invalide)."
        return False, f"Erreur Proxmox HTTP {resp.status_code}."

    if service == "jellyfin":
        if not is_secret_configured(secret):
            return False, "Clé API Jellyfin requise."
        resp = await client.get(
            f"{base_url}/System/Info",
            headers={"Authorization": f'MediaBrowser Token="{secret}"'},
        )
        if resp.status_code == 200:
            info = resp.json()
            name = info.get("ServerName") or "Jellyfin"
            ver = info.get("Version") or ""
            return True, f"Connecté à {name}" + (f" (v{ver})" if ver else "") + "."
        if resp.status_code in (401, 403):
            return False, "Clé API Jellyfin invalide."
        return False, f"Erreur Jellyfin HTTP {resp.status_code}."

    if service == "jellyseerr":
        if not is_secret_configured(secret):
            return False, "Clé API Jellyseerr requise."
        resp = await client.get(
            f"{base_url}/api/v1/status",
            headers={"X-Api-Key": secret},
        )
        if resp.status_code == 200:
            ver = str(resp.json().get("version") or "").strip()
            return True, "Connecté à Jellyseerr" + (f" (v{ver})" if ver else "") + "."
        if resp.status_code in (401, 403):
            return False, "Clé API Jellyseerr invalide."
        return False, f"Erreur Jellyseerr HTTP {resp.status_code}."

    if service == "plex":
        if not is_secret_configured(secret):
            return False, "Token Plex (X-Plex-Token) requis."
        resp = await client.get(
            f"{base_url}/identity",
            headers={"X-Plex-Token": secret, "Accept": "application/json"},
        )
        if resp.status_code == 200:
            ver = _extract_plex_version(resp)
            return True, "Connecté à Plex" + (f" (v{ver})" if ver else "") + "."
        if resp.status_code in (401, 403):
            return False, "Token Plex refusé."
        return False, f"Erreur Plex HTTP {resp.status_code}."

    if service == "stremio":
        username = (payload.username or "").strip() or settings.stremio_username
        auth = (
            httpx.BasicAuth(username, secret)
            if username and is_secret_configured(secret)
            else None
        )
        resp = await client.get(f"{base_url}/settings", auth=auth)
        if resp.status_code in (401, 403):
            return False, "Identifiants HTTP Basic Auth Stremio refusés."
        if resp.status_code == 200:
            try:
                data = resp.json()
            except Exception:
                return False, "Réponse Stremio non-JSON sur /settings."
            if not isinstance(data, dict) or not any(
                k in data for k in ("values", "serverVersion", "cacheSize")
            ):
                return False, "L'URL répond mais ne semble pas être un serveur Stremio."
            values = data.get("values") if isinstance(data.get("values"), dict) else data
            ver = str(
                (values or {}).get("serverVersion") or data.get("serverVersion") or ""
            ).strip()
            return True, (
                f"Connecté à Stremio Server (v{ver})."
                if ver
                else "Connecté à Stremio Server."
            )
        return False, f"Erreur Stremio HTTP {resp.status_code}."

    if service in _ARR_STATUS_PATHS:
        if not is_secret_configured(secret):
            return False, f"Clé API {service.capitalize()} requise."
        resp = await client.get(
            f"{base_url}{_ARR_STATUS_PATHS[service]}",
            headers={"X-Api-Key": secret},
        )
        if resp.status_code == 200:
            info = resp.json()
            app_name = info.get("appName") or service.capitalize()
            ver = info.get("version") or ""
            return True, f"Connecté à {app_name}" + (f" (v{ver})" if ver else "") + "."
        if resp.status_code in (401, 403):
            return False, f"Clé API {service.capitalize()} invalide."
        return False, f"Erreur {service.capitalize()} HTTP {resp.status_code}."

    # qbittorrent
    username = (payload.username or "").strip() or settings.qbit_username
    resp = await client.post(
        f"{base_url}/api/v2/auth/login",
        data={"username": username, "password": secret},
        headers={"Referer": base_url},
    )
    if resp.status_code == 200:
        body = resp.text.strip().lower()
        if "fails" in body:
            return False, "Identifiants qBittorrent refusés."
        return True, "Connexion qBittorrent réussie."
    if resp.status_code == 403:
        return False, "Accès qBittorrent bloqué (IP bannie ou identifiants refusés)."
    return False, f"Erreur qBittorrent HTTP {resp.status_code}."


@router.get("/status")
async def get_setup_status(request: Request) -> dict[str, Any]:
    """Return setup completeness, Tailscale pairing info, sanitized env, and services."""
    settings = get_settings()
    cfg = get_config_manager().config
    tailscale_url = await _detect_tailscale_url(request)
    pairing_deep_link = (
        f"pvecenter://connect?url={quote(tailscale_url, safe='')}"
        f"&name={quote(cfg.server.name or settings.pve_node or 'PVE', safe='')}"
        if tailscale_url
        else ""
    )
    return {
        "is_configured": is_configured(),
        "server_id": cfg.server.id,
        "server_name": cfg.server.name,
        "tailscale_url": tailscale_url,
        "pairing_deep_link": pairing_deep_link,
        "env": _build_env_summary(),
        "categories": load_services_config(),
        "storage_mounts": load_storage_mounts_config(),
    }


@router.post("/test-service")
async def test_service_connection(payload: TestServicePayload) -> dict[str, Any]:
    """Test real async HTTP connectivity and credentials against a configured service."""
    settings = get_settings()
    base_url = payload.url.strip().rstrip("/")
    parsed = urlparse(base_url)
    if not base_url or parsed.scheme not in ("http", "https") or not parsed.netloc:
        return _test_result(
            payload.service, False, "URL invalide (doit commencer par http:// ou https://)."
        )

    secret = (payload.secret or "").strip()
    if not secret:
        secret = getattr(settings, _SERVICE_SECRET_ATTR[payload.service], "")

    verify_ssl = (
        payload.verify_ssl
        if payload.service == "proxmox" and payload.verify_ssl is not None
        else (settings.pve_verify_ssl if payload.service == "proxmox" else False)
    )

    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(
            verify=verify_ssl,
            timeout=httpx.Timeout(5.0, connect=3.0),
        ) as client:
            ok, message = await _run_service_probe(client, payload, base_url, secret)
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        return _test_result(payload.service, ok, message, latency_ms)
    except httpx.TimeoutException:
        return _test_result(payload.service, False, "Délai d'attente dépassé (timeout).")
    except httpx.ConnectError:
        return _test_result(
            payload.service, False, "Connexion refusée ou hôte injoignable."
        )
    except httpx.HTTPError as exc:
        return _test_result(
            payload.service, False, f"Erreur réseau : {str(exc)[:120]}"
        )
    except Exception as exc:
        return _test_result(
            payload.service, False, f"Erreur inattendue : {str(exc)[:120]}"
        )


_ENV_TO_CONFIG_MAP: dict[str, tuple[str, ...]] = {
    "DEV_AUTH_BYPASS": ("security", "dev_auth_bypass"),
    "ALLOWED_TAILSCALE_USERS": ("security", "allowed_tailscale_users"),
    "PROTECTED_OWNER_USERNAME": ("security", "protected_owner_username"),
    "PVE_HOST": ("proxmox", "host"),
    "PVE_NODE": ("proxmox", "default_node"),
    "PVE_TOKEN_ID": ("proxmox", "token_id"),
    "PVE_TOKEN_SECRET": ("proxmox", "token_secret"),
    "PVE_VERIFY_SSL": ("proxmox", "verify_ssl"),
    "PANEL_SELF_VMID": ("proxmox", "panel_self_vmid"),
    "MERGERFS_POOL_SUBPATH": ("proxmox", "mergerfs_pool_subpath"),
    "JELLYFIN_URL": ("integrations", "jellyfin", "url"),
    "JELLYFIN_API_KEY": ("integrations", "jellyfin", "api_key"),
    "JELLYSEERR_URL": ("integrations", "jellyseerr", "url"),
    "JELLYSEERR_API_KEY": ("integrations", "jellyseerr", "api_key"),
    "PLEX_URL": ("integrations", "plex", "url"),
    "PLEX_TOKEN": ("integrations", "plex", "token"),
    "STREMIO_URL": ("integrations", "stremio", "url"),
    "STREMIO_USERNAME": ("integrations", "stremio", "username"),
    "STREMIO_PASSWORD": ("integrations", "stremio", "password"),
    "RADARR_URL": ("integrations", "radarr", "url"),
    "RADARR_API_KEY": ("integrations", "radarr", "api_key"),
    "SONARR_URL": ("integrations", "sonarr", "url"),
    "SONARR_API_KEY": ("integrations", "sonarr", "api_key"),
    "PROWLARR_URL": ("integrations", "prowlarr", "url"),
    "PROWLARR_API_KEY": ("integrations", "prowlarr", "api_key"),
    "QBIT_URL": ("integrations", "qbittorrent", "url"),
    "QBIT_USERNAME": ("integrations", "qbittorrent", "username"),
    "QBIT_PASSWORD": ("integrations", "qbittorrent", "password"),
}

_SETUP_SECRET_ENV_KEYS = frozenset(
    {
        "PVE_TOKEN_SECRET",
        "JELLYFIN_API_KEY",
        "JELLYSEERR_API_KEY",
        "PLEX_TOKEN",
        "STREMIO_PASSWORD",
        "RADARR_API_KEY",
        "SONARR_API_KEY",
        "PROWLARR_API_KEY",
        "QBIT_PASSWORD",
    }
)


def _apply_env_updates_to_config_dict(
    cfg_dict: dict[str, Any], updates: dict[str, Any]
) -> None:
    for raw_key, raw_val in updates.items():
        env_key = str(raw_key).strip().upper()
        target_path = _ENV_TO_CONFIG_MAP.get(env_key)
        if not target_path or raw_val is None:
            continue
        if env_key in _SETUP_SECRET_ENV_KEYS and is_masked_or_empty(raw_val):
            continue
        cur = cfg_dict
        for part in target_path[:-1]:
            cur = cur.setdefault(part, {})
        cur[target_path[-1]] = raw_val


@router.put("/config")
async def update_setup_config(
    request: Request, payload: SetupConfigUpdatePayload
) -> dict[str, Any]:
    """Persist config.yaml (or legacy .env/services.yaml) updates and hot-reload application settings."""
    old_verify_ssl = get_settings().pve_verify_ssl
    manager = get_config_manager()

    if manager.config_exists:
        cfg_dict = manager.config.model_dump()
        if payload.env:
            _apply_env_updates_to_config_dict(cfg_dict, payload.env)
        if payload.categories is not None:
            cfg_dict["categories"] = _sanitize_categories(payload.categories)
        if payload.storage_mounts is not None:
            cfg_dict["storage_mounts"] = _sanitize_storage_mounts(payload.storage_mounts)
        validated = AppConfig.model_validate(cfg_dict)
        manager.save_config(
            validated, preserve_templates=True, emit_event=True, source="setup_put"
        )
        new_settings = reload_settings()
    else:
        if payload.env:
            update_env_file(payload.env)
        if payload.categories is not None or payload.storage_mounts is not None:
            save_services_yaml(payload.categories, payload.storage_mounts)
        new_settings = reload_settings()
        await get_realtime_bus().publish(
            "config_reloaded",
            {
                "hash": manager.content_hash,
                "source": "setup_put",
                "server_id": manager.config.server.id,
                "is_synthesized": manager.is_synthesized,
            },
        )

    if new_settings.pve_verify_ssl != old_verify_ssl:
        old_client = getattr(request.app.state, "pve_http", None)
        request.app.state.pve_http = httpx.AsyncClient(
            verify=new_settings.pve_verify_ssl,
            timeout=httpx.Timeout(5.0, connect=3.0),
        )
        if old_client is not None:
            try:
                await old_client.aclose()
            except Exception:
                pass

    return {
        "ok": True,
        "is_configured": is_configured(),
        "message": "Configuration enregistrée et rechargée à chaud.",
    }
