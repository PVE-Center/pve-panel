"""Proxmox VE node supervision, cluster discovery & VM/LXC power control endpoints."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request

from app.config import get_settings
from app.services.pve_client import ProxmoxClient

router = APIRouter(prefix="/api/pve", tags=["proxmox"])


@router.get("/nodes")
async def list_pve_nodes(request: Request) -> dict:
    """List all Proxmox VE cluster nodes with live status, CPU, RAM and uptime."""
    client = ProxmoxClient(request.app.state.pve_http)
    nodes = await client.list_nodes()
    return {
        "nodes": nodes,
        "default_node": get_settings().pve_node,
    }


@router.get("/overview")
async def get_pve_overview(
    request: Request,
    node: str | None = Query(
        default=None,
        description="Target Proxmox node name, or '*' / 'all' for multi-node cluster aggregation.",
    ),
) -> dict:
    """Return real-time Proxmox node/cluster metrics, storages, and VM/LXC list."""
    client = ProxmoxClient(request.app.state.pve_http)
    return await client.get_overview(node=node)


@router.post("/{vm_type}/{vmid}/{action}")
async def control_vm_or_lxc(
    request: Request,
    vm_type: Literal["lxc", "qemu"],
    vmid: int,
    action: Literal["start", "stop", "reboot", "shutdown"],
    node: str | None = Query(
        default=None,
        description="Optional target Proxmox node name hosting the VM or container.",
    ),
) -> dict:
    """Execute power action (start/stop/reboot/shutdown) on a container or VM."""
    client = ProxmoxClient(request.app.state.pve_http)
    try:
        return await client.execute_action(vm_type, vmid, action, node=node)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
