"""Prometheus exposition endpoints (`/metrics` and `/api/metrics/prometheus`)."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

from app.config import get_settings
from app.config_manager import get_config_manager
from app.services.pve_client import ProxmoxClient

router = APIRouter(tags=["metrics"])

PROMETHEUS_MEDIA_TYPE = "text/plain; version=0.0.4; charset=utf-8"


def _escape_label(value: object) -> str:
    text = str(value or "")
    return text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


async def _render_prometheus_metrics(request: Request) -> str:
    """Render server, Proxmox node/guest, and custom-service health metrics in Prometheus text format."""
    lines: list[str] = [
        "# HELP pve_center_up Whether the PVE Command Center API server is up.",
        "# TYPE pve_center_up gauge",
        "pve_center_up 1",
    ]

    cfg = get_config_manager().config
    protocol_by_id = {svc.id: svc.protocol for svc in cfg.custom_services}
    state_store = getattr(request.app.state, "state_store", None)

    if state_store is not None:
        try:
            service_states = await state_store.list_service_states()
            incidents = await state_store.list_incidents(active_only=True, limit=1000)
        except Exception:
            service_states = []
            incidents = []

        lines.extend(
            [
                "# HELP pve_custom_service_up Health state of monitored custom service probes (1=up, 0=down).",
                "# TYPE pve_custom_service_up gauge",
            ]
        )
        latency_lines: list[str] = [
            "# HELP pve_custom_service_latency_ms Last probe round-trip latency in milliseconds.",
            "# TYPE pve_custom_service_latency_ms gauge",
        ]
        for row in service_states:
            svc_id = _escape_label(row.get("service_id", ""))
            proto = _escape_label(protocol_by_id.get(str(row.get("service_id", "")), "unknown"))
            up_val = 1 if str(row.get("current_status", "")).lower() == "up" else 0
            lines.append(
                f'pve_custom_service_up{{service_id="{svc_id}",protocol="{proto}"}} {up_val}'
            )
            lat = row.get("last_latency_ms")
            if lat is not None:
                latency_lines.append(
                    f'pve_custom_service_latency_ms{{service_id="{svc_id}",protocol="{proto}"}} {int(lat)}'
                )

        if len(latency_lines) > 2:
            lines.extend(latency_lines)

        lines.extend(
            [
                "# HELP pve_incidents_active_total Count of currently open incidents.",
                "# TYPE pve_incidents_active_total gauge",
                f"pve_incidents_active_total {len(incidents)}",
            ]
        )

    pve_http = getattr(request.app.state, "pve_http", None)
    if pve_http is not None and get_settings().pve_host:
        try:
            overview = await ProxmoxClient(pve_http).get_overview(node="*")
            cluster_nodes = overview.get("cluster_nodes") or []
            if cluster_nodes:
                lines.extend(
                    [
                        "# HELP pve_node_online Proxmox node availability (1=online, 0=offline).",
                        "# TYPE pve_node_online gauge",
                    ]
                )
                cpu_lines = [
                    "# HELP pve_node_cpu_ratio Proxmox node CPU utilization ratio (0..1).",
                    "# TYPE pve_node_cpu_ratio gauge",
                ]
                mem_used_lines = [
                    "# HELP pve_node_memory_used_bytes Proxmox node used RAM in bytes.",
                    "# TYPE pve_node_memory_used_bytes gauge",
                ]
                mem_total_lines = [
                    "# HELP pve_node_memory_total_bytes Proxmox node total RAM in bytes.",
                    "# TYPE pve_node_memory_total_bytes gauge",
                ]
                for node_entry in cluster_nodes:
                    n_lbl = _escape_label(node_entry.get("name", ""))
                    lines.append(f'pve_node_online{{node="{n_lbl}"}} {1 if node_entry.get("online") else 0}')
                    cpu_lines.append(
                        f'pve_node_cpu_ratio{{node="{n_lbl}"}} {round(float(node_entry.get("cpu_pct", 0.0)) / 100.0, 4)}'
                    )
                    mem_used_lines.append(
                        f'pve_node_memory_used_bytes{{node="{n_lbl}"}} {int(node_entry.get("mem_used_bytes", 0))}'
                    )
                    mem_total_lines.append(
                        f'pve_node_memory_total_bytes{{node="{n_lbl}"}} {int(node_entry.get("mem_total_bytes", 0))}'
                    )
                lines.extend(cpu_lines + mem_used_lines + mem_total_lines)

            resources = overview.get("resources") or []
            if resources:
                lines.extend(
                    [
                        "# HELP pve_guest_up Running state of Proxmox LXC/QEMU guests (1=running, 0=stopped).",
                        "# TYPE pve_guest_up gauge",
                    ]
                )
                for res in resources:
                    n_lbl = _escape_label(res.get("node", ""))
                    t_lbl = _escape_label(res.get("type", ""))
                    vmid_lbl = _escape_label(res.get("vmid", ""))
                    name_lbl = _escape_label(res.get("name", ""))
                    is_running = 1 if str(res.get("status", "")).lower() == "running" else 0
                    lines.append(
                        f'pve_guest_up{{node="{n_lbl}",type="{t_lbl}",vmid="{vmid_lbl}",name="{name_lbl}"}} {is_running}'
                    )
        except Exception:
            pass

    return "\n".join(lines) + "\n"


@router.get("/metrics", response_class=PlainTextResponse)
async def prometheus_metrics_root(request: Request) -> PlainTextResponse:
    """Prometheus scrape endpoint at `/metrics`."""
    payload = await _render_prometheus_metrics(request)
    return PlainTextResponse(content=payload, media_type=PROMETHEUS_MEDIA_TYPE)


@router.get("/api/metrics/prometheus", response_class=PlainTextResponse)
async def prometheus_metrics_api(request: Request) -> PlainTextResponse:
    """Prometheus scrape endpoint under `/api/metrics/prometheus`."""
    payload = await _render_prometheus_metrics(request)
    return PlainTextResponse(content=payload, media_type=PROMETHEUS_MEDIA_TYPE)
