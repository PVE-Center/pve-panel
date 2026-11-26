"""Unified Update Center API endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.services.update_manager import UpdateManager

router = APIRouter(prefix="/api/updates", tags=["updates"])


class RunUpdatesRequest(BaseModel):
    target_ids: list[str] = Field(default_factory=lambda: ["all"], min_length=1)
    include_panel_self: bool = True
    autoremove: bool = True


def _get_manager(request: Request) -> UpdateManager:
    manager = getattr(request.app.state, "update_manager", None)
    if manager is None:
        raise HTTPException(status_code=503, detail="UpdateManager non initialisé.")
    return manager


@router.get("/overview")
async def get_updates_overview(request: Request) -> dict:
    """Return cached update targets, Proxmox SSH readiness status, and active/recent update jobs."""
    manager = _get_manager(request)
    overview = manager.get_overview()
    if overview.get("last_checked_at") is None:
        overview = await manager.check_updates(refresh_remote=False)
    return overview


@router.post("/check")
async def check_updates(request: Request) -> dict:
    """Refresh GitHub releases, Proxmox APT package indexes, LXC packages, and Docker stacks."""
    manager = _get_manager(request)
    return await manager.check_updates(refresh_remote=True)


@router.post("/run")
async def run_updates(request: Request, body: RunUpdatesRequest) -> dict:
    """Start an asynchronous update job across all or selected targets."""
    manager = _get_manager(request)
    try:
        job = await manager.start_update_job(
            target_ids=body.target_ids,
            include_panel_self=body.include_panel_self,
            autoremove=body.autoremove,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "job": job}


@router.get("/jobs/current")
async def get_current_update_job(request: Request) -> dict:
    """Return current running job (if any) and recent update history."""
    manager = _get_manager(request)
    return manager.get_jobs_status()


@router.get("/setup-info")
async def get_updates_setup_info(request: Request) -> dict:
    """Return Ed25519 SSH public key and one-liner for authorizing automated Proxmox updates."""
    manager = _get_manager(request)
    await manager.check_ssh_connectivity()
    return manager.get_setup_info()


@router.post("/ssh-key/rotate")
async def rotate_updates_ssh_key(request: Request) -> dict:
    """Regenerate the Ed25519 SSH keypair used by the Update Center."""
    manager = _get_manager(request)
    return manager.rotate_ssh_key()
