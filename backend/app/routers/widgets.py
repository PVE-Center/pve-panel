"""Live metric widget endpoints for media and download services."""

from fastapi import APIRouter, HTTPException, Request

from app.services.media_clients import (
    fetch_all_widgets,
    fetch_jellyfin_widget,
    fetch_plex_widget,
    fetch_prowlarr_widget,
    fetch_qbittorrent_widget,
    fetch_radarr_widget,
    fetch_sonarr_widget,
    fetch_stremio_widget,
)

router = APIRouter(prefix="/api/widgets", tags=["widgets"])

WIDGET_HANDLERS = {
    "jellyfin": fetch_jellyfin_widget,
    "plex": fetch_plex_widget,
    "stremio": fetch_stremio_widget,
    "radarr": fetch_radarr_widget,
    "sonarr": fetch_sonarr_widget,
    "prowlarr": fetch_prowlarr_widget,
    "qbittorrent": fetch_qbittorrent_widget,
}


@router.get("/all")
async def get_all_widgets(request: Request) -> dict:
    """Return live metrics for all configured service widgets in parallel."""
    return await fetch_all_widgets(request.app.state.media_http)


@router.get("/{widget_name}")
async def get_single_widget(request: Request, widget_name: str) -> dict:
    """Return live metrics for a specific widget."""
    handler = WIDGET_HANDLERS.get(widget_name.lower())
    if not handler:
        raise HTTPException(status_code=404, detail=f"Widget inconnu : {widget_name}")
    return await handler(request.app.state.media_http)
