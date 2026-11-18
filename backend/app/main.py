"""FastAPI entrypoint serving APIs, realtime streams, mDNS, alerting, and static frontend."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.config_manager import get_config_manager
from app.config_schema import AppConfig
from app.middleware.tailscale_auth import TailscaleSSOMiddleware
from app.routers import (
    auth,
    config_yaml,
    custom_services,
    discovery,
    incidents,
    metrics,
    notifications,
    operations,
    pairing,
    proxmox,
    services,
    setup,
    users,
    widgets,
)
from app.services.alert_engine import AlertEngine
from app.services.mdns_publisher import MDNSPublisher
from app.services.notifications import NotificationDispatcher
from app.services.pairing_relay import PairingRelayStore
from app.services.realtime_bus import get_realtime_bus
from app.services.state_store import StateStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage HTTP clients, SQLite state store, ConfigManager watcher, mDNS, and AlertEngine."""
    config_manager = get_config_manager()
    cfg = config_manager.config
    realtime_bus = get_realtime_bus()
    await realtime_bus.start()

    pve_http = httpx.AsyncClient(
        verify=cfg.proxmox.verify_ssl, timeout=httpx.Timeout(5.0, connect=3.0)
    )
    media_http = httpx.AsyncClient(
        verify=False, timeout=httpx.Timeout(3.5, connect=2.5)
    )

    state_store = StateStore(config_manager.state_db_path)
    await state_store.initialize()

    pairing_relay = PairingRelayStore()
    dispatcher = NotificationDispatcher(
        state_store=state_store,
        config_getter=lambda: config_manager.config,
        http_client=media_http,
    )
    mdns_publisher = MDNSPublisher(
        config_getter=lambda: config_manager.config,
        version=app.version,
    )
    alert_engine = AlertEngine(
        state_store=state_store,
        dispatcher=dispatcher,
        config_manager=config_manager,
        bus=realtime_bus,
        http_client=media_http,
    )

    app.state.config_manager = config_manager
    app.state.realtime_bus = realtime_bus
    app.state.pve_http = pve_http
    app.state.media_http = media_http
    app.state.state_store = state_store
    app.state.pairing_relay = pairing_relay
    app.state.notification_dispatcher = dispatcher
    app.state.mdns_publisher = mdns_publisher
    app.state.alert_engine = alert_engine

    async def _on_config_reload(new_cfg: AppConfig) -> None:
        alert_engine.notify_config_reload(new_cfg)
        await mdns_publisher.reload(new_cfg)

    unsub_reload = config_manager.on_reload(_on_config_reload)

    await config_manager.start_watcher()
    await mdns_publisher.start(cfg)
    await alert_engine.start()

    try:
        yield
    finally:
        unsub_reload()
        await alert_engine.stop()
        await mdns_publisher.stop()
        await config_manager.stop_watcher()
        await realtime_bus.stop()
        await state_store.close()
        await app.state.pve_http.aclose()
        await media_http.aclose()


app = FastAPI(
    title="PVE Command Center",
    description="Panel d'administration privé sécurisé via Tailscale Serve et API tokens",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(TailscaleSSOMiddleware)

app.include_router(auth.router)
app.include_router(config_yaml.router)
app.include_router(proxmox.router)
app.include_router(services.router)
app.include_router(custom_services.router)
app.include_router(incidents.router)
app.include_router(metrics.router)
app.include_router(notifications.router)
app.include_router(discovery.router)
app.include_router(pairing.router)
app.include_router(setup.router)
app.include_router(widgets.router)
app.include_router(users.router)
app.include_router(operations.router)


_NO_STORE_HTML_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}


def _serve_spa_file(path: Path) -> FileResponse:
    """Serve SPA file with no-store caching on HTML so deployments never leave stale UI cached."""
    if path.suffix.lower() == ".html":
        return FileResponse(path, headers=_NO_STORE_HTML_HEADERS)
    return FileResponse(path)


_static_dir = get_settings().resolve_static_dir()
if _static_dir:
    assets_dir = _static_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_spa(full_path: str) -> Any:
        """Serve static assets or fallback to React index.html for SPA routes."""
        if full_path.startswith("api"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        candidate = (_static_dir / full_path).resolve()
        if (
            full_path
            and candidate.is_file()
            and str(candidate).startswith(str(_static_dir.resolve()))
        ):
            return _serve_spa_file(candidate)
        return _serve_spa_file(_static_dir / "index.html")
else:

    @app.get("/", include_in_schema=False)
    async def missing_frontend() -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content={"detail": "Frontend non compilé (frontend/dist introuvable)."},
        )
