"""Asynchronous Proxmox VE API client using restricted API Tokens."""

import asyncio
import os
from pathlib import Path
import re
from typing import Any, Literal
from urllib.parse import quote

import httpx

from app.config import get_settings, load_storage_mounts_config

HOST_MNT_ROOT = Path(os.environ.get("HOST_MNT_ROOT", "/host_mnt"))
PROC_MOUNTS_PATH = Path("/proc/mounts")

_COMMON_MERGERFS_POOL_NAMES: tuple[str, ...] = (
    "pool_medias",
    "pool",
    "mergerfs",
    "media_pool",
    "pool_media",
    "storage",
    "union",
)
_DISK_DIR_NAME_RE = re.compile(
    r"^(?:(?:disk|drive|hdd|ssd|nvme|disque|sd[a-z]|hd[a-z]|vd[a-z])[a-z0-9_-]*|(?:vol|volume|bay|slot|data)[-_]?\d+)$",
    re.IGNORECASE,
)
_IGNORED_MNT_DIRS = frozenset({"lost+found"})


def _normalize_subpath(raw: str) -> str:
    """Normalize a relative mount subpath while rejecting traversal segments."""
    cleaned = raw.strip().strip("/")
    parts = [p for p in cleaned.split("/") if p]
    if not parts or any(p in (".", "..") for p in parts):
        return ""
    return "/".join(parts)


def _detect_mergerfs_from_proc_mounts(
    root: Path,
    excluded_subpaths: set[str],
    proc_mounts_path: Path | None = None,
) -> str:
    """Inspect proc mounts for an active fuse.mergerfs mount located under HOST_MNT_ROOT."""
    mounts_file = proc_mounts_path or PROC_MOUNTS_PATH
    if not mounts_file.is_file():
        return ""
    try:
        root_resolved = root.resolve()
        lines = mounts_file.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""

    for line in lines:
        parts = line.split()
        if len(parts) < 3:
            continue
        mountpoint_raw, fstype = parts[1], parts[2].lower()
        if "mergerfs" not in fstype:
            continue
        mount_path = Path(mountpoint_raw.replace("\\040", " "))
        for base in (root, root_resolved):
            try:
                rel = mount_path.relative_to(base)
            except ValueError:
                continue
            rel_str = _normalize_subpath(rel.as_posix())
            if rel_str and rel_str not in excluded_subpaths:
                return rel_str
    return ""


def _resolve_mergerfs_pool_subpath() -> str:
    """Resolve the active MergerFS pool subpath from config/env or auto-detect under HOST_MNT_ROOT."""
    configured = _normalize_subpath(get_settings().mergerfs_pool_subpath)
    if configured:
        return configured

    configured_disk_subpaths = {
        _normalize_subpath(m.get("subpath", ""))
        for m in load_storage_mounts_config()
        if m.get("subpath")
    }
    configured_disk_subpaths.discard("")

    from_proc = _detect_mergerfs_from_proc_mounts(HOST_MNT_ROOT, configured_disk_subpaths)
    if from_proc:
        return from_proc

    if not HOST_MNT_ROOT.is_dir():
        return ""

    candidates = [
        entry.name
        for entry in sorted(HOST_MNT_ROOT.iterdir(), key=lambda p: p.name)
        if entry.is_dir()
        and not entry.name.startswith(".")
        and entry.name.lower() not in _IGNORED_MNT_DIRS
        and entry.name not in configured_disk_subpaths
    ]
    if not candidates:
        return ""

    by_lower = {name.lower(): name for name in candidates}
    for common_name in _COMMON_MERGERFS_POOL_NAMES:
        if common_name in by_lower:
            return by_lower[common_name]

    for name in candidates:
        lower = name.lower()
        if "pool" in lower or "mergerfs" in lower:
            return name

    for name in candidates:
        if not _DISK_DIR_NAME_RE.match(name):
            return name

    return ""


def _resolve_disk_mounts(pool_subpath: str | None = None) -> list[dict[str, str]]:
    """Load configured storage mounts or auto-discover physical disk subdirectories under HOST_MNT_ROOT."""
    active_pool = (
        _resolve_mergerfs_pool_subpath()
        if pool_subpath is None
        else _normalize_subpath(pool_subpath)
    )
    pool_top_dir = active_pool.split("/", 1)[0] if active_pool else ""

    configured = load_storage_mounts_config()
    if configured:
        if not active_pool:
            return configured
        return [
            m
            for m in configured
            if _normalize_subpath(m.get("subpath", "")) != active_pool
        ]

    if not HOST_MNT_ROOT.is_dir():
        return []
    discovered: list[dict[str, str]] = []
    for entry in sorted(HOST_MNT_ROOT.iterdir(), key=lambda p: p.name):
        if (
            entry.is_dir()
            and not entry.name.startswith(".")
            and entry.name.lower() not in _IGNORED_MNT_DIRS
            and entry.name != pool_top_dir
        ):
            discovered.append(
                {
                    "mount": f"/mnt/{entry.name}",
                    "subpath": entry.name,
                    "wwn": "",
                    "label": f"Disque {entry.name}",
                }
            )
    return discovered


def _statvfs_usage(path: Path) -> dict[str, Any] | None:
    """Read filesystem byte usage via statvfs when mount exists."""
    if not path.exists():
        return None
    try:
        st = os.statvfs(path)
    except OSError:
        return None
    total_bytes = int(st.f_frsize * st.f_blocks)
    avail_bytes = int(st.f_frsize * st.f_bavail)
    free_bytes = int(st.f_frsize * st.f_bfree)
    used_bytes = max(0, total_bytes - free_bytes)
    usable = used_bytes + avail_bytes
    used_pct = round((used_bytes / usable) * 100, 1) if usable > 0 else 0.0
    return {
        "total_bytes": total_bytes,
        "used_bytes": used_bytes,
        "avail_bytes": avail_bytes,
        "used_pct": used_pct,
    }


def _format_uptime(seconds: int | float) -> str:
    """Format raw uptime seconds into concise French duration."""
    sec = int(seconds or 0)
    days, rem = divmod(sec, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, _ = divmod(rem, 60)
    if days > 0:
        return f"{days}j {hours}h {minutes}m"
    if hours > 0:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


class ProxmoxClient:
    """Stateless async client for Proxmox VE node & VM/LXC management."""

    def __init__(self, http_client: httpx.AsyncClient) -> None:
        self._http = http_client

    def _headers(self) -> dict[str, str]:
        settings = get_settings()
        return {
            "Authorization": f"PVEAPIToken={settings.pve_token_id}={settings.pve_token_secret}"
        }

    def _base_url(self, node: str | None = None) -> str:
        settings = get_settings()
        target_node = (node or "").strip() or settings.pve_node
        return f"{settings.pve_host.rstrip('/')}/api2/json/nodes/{target_node}"

    async def list_nodes(self) -> list[dict[str, Any]]:
        """Query /api2/json/nodes to discover all Proxmox VE cluster nodes."""
        settings = get_settings()
        base_host = settings.pve_host.rstrip("/")
        if not base_host:
            return []
        try:
            resp = await self._http.get(
                f"{base_host}/api2/json/nodes", headers=self._headers()
            )
            nodes_raw = self._extract_data(resp, default=[])
        except Exception:
            nodes_raw = []

        nodes: list[dict[str, Any]] = []
        if isinstance(nodes_raw, list):
            for entry in sorted(
                (n for n in nodes_raw if isinstance(n, dict)),
                key=lambda item: str(item.get("node") or ""),
            ):
                node_name = str(entry.get("node") or "").strip()
                if not node_name:
                    continue
                status_val = str(entry.get("status") or "unknown").lower()
                mem = int(entry.get("mem", 0))
                maxmem = int(entry.get("maxmem", 1)) or 1
                uptime = int(entry.get("uptime", 0))
                nodes.append(
                    {
                        "name": node_name,
                        "status": status_val,
                        "online": status_val == "online",
                        "cpu_pct": round(float(entry.get("cpu", 0.0)) * 100, 1),
                        "cpus": int(entry.get("maxcpu", 0)),
                        "mem_used_bytes": mem,
                        "mem_total_bytes": maxmem,
                        "mem_pct": round((mem / maxmem) * 100, 1),
                        "uptime_seconds": uptime,
                        "uptime_human": _format_uptime(uptime) if uptime > 0 else "—",
                    }
                )

        if not nodes:
            nodes.append(
                {
                    "name": settings.pve_node,
                    "status": "unknown",
                    "online": False,
                    "cpu_pct": 0.0,
                    "cpus": 0,
                    "mem_used_bytes": 0,
                    "mem_total_bytes": 0,
                    "mem_pct": 0.0,
                    "uptime_seconds": 0,
                    "uptime_human": "—",
                }
            )
        return nodes

    async def _fetch_single_node_overview(self, node_name: str) -> dict[str, Any]:
        """Fetch status, storage pools, LXCs, VMs, and physical disks for one Proxmox node."""
        base = self._base_url(node_name)
        headers = self._headers()

        status_req = self._http.get(f"{base}/status", headers=headers)
        storage_req = self._http.get(f"{base}/storage", headers=headers)
        lxc_req = self._http.get(f"{base}/lxc", headers=headers)
        qemu_req = self._http.get(f"{base}/qemu", headers=headers)
        disks_req = self._http.get(f"{base}/disks/list", headers=headers)

        results = await asyncio.gather(
            status_req, storage_req, lxc_req, qemu_req, disks_req, return_exceptions=True
        )

        node_data = self._extract_data(results[0], default={})
        storage_raw = self._extract_data(results[1], default=[])
        lxc_raw = self._extract_data(results[2], default=[])
        qemu_raw = self._extract_data(results[3], default=[])
        disks_raw = self._extract_data(results[4], default=[])

        node_summary = self._build_node_summary(node_data, storage_raw, node_name=node_name)
        resources = self._build_resources_list(lxc_raw, qemu_raw, node_name=node_name)
        external_storage = self._build_external_storage(disks_raw)

        running_count = sum(1 for r in resources if r["status"] == "running")
        stopped_count = len(resources) - running_count

        return {
            "online": bool(node_data),
            "node": node_summary,
            "counts": {
                "total": len(resources),
                "running": running_count,
                "stopped": stopped_count,
                "lxc": len(lxc_raw) if isinstance(lxc_raw, list) else 0,
                "qemu": len(qemu_raw) if isinstance(qemu_raw, list) else 0,
            },
            "resources": resources,
            "external_storage": external_storage,
        }

    async def get_overview(self, node: str | None = None) -> dict[str, Any]:
        """Fetch Proxmox node or multi-node cluster metrics, with automatic failover."""
        settings = get_settings()
        req_node = (node or "").strip()

        if req_node in ("*", "all"):
            cluster_nodes = await self.list_nodes()
            online_names = [n["name"] for n in cluster_nodes if n.get("online")]
            target_names = online_names or [settings.pve_node]
            per_node = await asyncio.gather(
                *(self._fetch_single_node_overview(n_name) for n_name in target_names)
            )
            return self._aggregate_cluster_overviews(
                per_node, target_names, cluster_nodes, selected_node=req_node
            )

        if req_node:
            overview, cluster_nodes = await asyncio.gather(
                self._fetch_single_node_overview(req_node),
                self.list_nodes(),
            )
            overview["selected_node"] = req_node
            overview["failover_active"] = False
            overview["cluster_nodes"] = cluster_nodes
            return overview

        default_node = settings.pve_node
        primary, cluster_nodes = await asyncio.gather(
            self._fetch_single_node_overview(default_node),
            self.list_nodes(),
        )
        if primary["online"]:
            primary["selected_node"] = default_node
            primary["failover_active"] = False
            primary["cluster_nodes"] = cluster_nodes
            return primary

        backup_candidates = [
            n["name"]
            for n in cluster_nodes
            if n.get("online") and n.get("name") != default_node
        ]
        for backup_name in backup_candidates:
            backup_overview = await self._fetch_single_node_overview(backup_name)
            if backup_overview["online"]:
                backup_overview["selected_node"] = backup_name
                backup_overview["failover_active"] = True
                backup_overview["cluster_nodes"] = cluster_nodes
                return backup_overview

        primary["selected_node"] = default_node
        primary["failover_active"] = False
        primary["cluster_nodes"] = cluster_nodes
        return primary

    @staticmethod
    def _aggregate_cluster_overviews(
        overviews: list[dict[str, Any]],
        target_names: list[str],
        cluster_nodes: list[dict[str, Any]],
        *,
        selected_node: str,
    ) -> dict[str, Any]:
        """Merge single-node overviews into a unified cluster summary."""
        if len(overviews) == 1:
            single = dict(overviews[0])
            single["selected_node"] = selected_node
            single["failover_active"] = False
            single["cluster_nodes"] = cluster_nodes
            return single

        online_parts = [ov for ov in overviews if ov.get("online")]
        online_any = bool(online_parts)
        mem_used = sum(ov["node"]["mem_used_bytes"] for ov in overviews)
        mem_total = sum(ov["node"]["mem_total_bytes"] for ov in overviews if ov["node"]["mem_total_bytes"] > 1) or 1
        swap_used = sum(ov["node"]["swap_used_bytes"] for ov in overviews)
        swap_total = sum(ov["node"]["swap_total_bytes"] for ov in overviews)
        rootfs_used = sum(ov["node"]["rootfs_used_bytes"] for ov in overviews)
        rootfs_total = sum(ov["node"]["rootfs_total_bytes"] for ov in overviews)
        total_threads = sum(ov["node"]["cpu_threads"] for ov in overviews)
        avg_cpu = (
            round(sum(ov["node"]["cpu_pct"] for ov in online_parts) / len(online_parts), 1)
            if online_parts
            else 0.0
        )

        combined_storages: list[dict[str, Any]] = []
        combined_resources: list[dict[str, Any]] = []
        for n_name, ov in zip(target_names, overviews):
            for st in ov["node"].get("storages", []):
                entry = dict(st)
                entry["node"] = n_name
                entry["name"] = f"{n_name}:{entry['name']}"
                combined_storages.append(entry)
            combined_resources.extend(ov.get("resources", []))

        combined_resources.sort(key=lambda r: (r["vmid"], r.get("node", "")))
        running_count = sum(1 for r in combined_resources if r["status"] == "running")
        base_ext = (online_parts[0] if online_parts else overviews[0])["external_storage"]
        base_node = (online_parts[0] if online_parts else overviews[0])["node"]

        return {
            "online": online_any,
            "node": {
                "name": f"Cluster ({len(target_names)} nœuds)",
                "cpu_pct": avg_cpu,
                "cpu_model": base_node.get("cpu_model", "Cluster"),
                "cpu_threads": total_threads,
                "loadavg": base_node.get("loadavg", ["0.00", "0.00", "0.00"]),
                "mem_used_bytes": mem_used,
                "mem_total_bytes": mem_total,
                "mem_pct": round((mem_used / mem_total) * 100, 1),
                "swap_used_bytes": swap_used,
                "swap_total_bytes": swap_total,
                "rootfs_used_bytes": rootfs_used,
                "rootfs_total_bytes": rootfs_total,
                "uptime_seconds": max((ov["node"]["uptime_seconds"] for ov in overviews), default=0),
                "uptime_human": base_node.get("uptime_human", "—"),
                "pve_version": base_node.get("pve_version", ""),
                "storages": combined_storages,
            },
            "counts": {
                "total": len(combined_resources),
                "running": running_count,
                "stopped": len(combined_resources) - running_count,
                "lxc": sum(ov["counts"]["lxc"] for ov in overviews),
                "qemu": sum(ov["counts"]["qemu"] for ov in overviews),
            },
            "resources": combined_resources,
            "external_storage": base_ext,
            "selected_node": selected_node,
            "failover_active": False,
            "cluster_nodes": cluster_nodes,
        }

    @staticmethod
    def _build_external_storage(disks_raw: list[dict[str, Any]]) -> dict[str, Any]:
        """Combine MergerFS statvfs mount metrics with Proxmox physical disk SMART info."""
        by_wwn = {
            str(d.get("wwn") or "").lower(): d
            for d in (disks_raw if isinstance(disks_raw, list) else [])
            if isinstance(d, dict) and d.get("wwn")
        }

        pool_subpath = _resolve_mergerfs_pool_subpath()
        pool_path = (HOST_MNT_ROOT / pool_subpath) if pool_subpath else None
        pool_stats = (
            _statvfs_usage(pool_path) if pool_path is not None else None
        ) or {
            "total_bytes": 0,
            "used_bytes": 0,
            "avail_bytes": 0,
            "used_pct": 0.0,
        }
        disk_mounts = _resolve_disk_mounts(pool_subpath=pool_subpath)
        pool = {
            "name": "Pool MergerFS",
            "mount": f"/mnt/{pool_subpath}" if pool_subpath else "",
            "fstype": "fuse.mergerfs",
            "policy": "mfs (Most Free Space)",
            "drives_count": len(disk_mounts),
            "available": bool(pool_path is not None and pool_path.exists()),
            **pool_stats,
        }

        drives = []
        for spec in disk_mounts:
            wwn = str(spec.get("wwn") or "").lower()
            disk_meta = by_wwn.get(wwn, {}) if wwn else {}
            usage = _statvfs_usage(HOST_MNT_ROOT / spec["subpath"]) or {
                "total_bytes": int(disk_meta.get("size") or 0),
                "used_bytes": 0,
                "avail_bytes": 0,
                "used_pct": 0.0,
            }
            drives.append(
                {
                    "mount": spec.get("mount") or f"/mnt/{spec['subpath']}",
                    "label": spec.get("label") or f"Disque {spec['subpath']}",
                    "wwn": spec.get("wwn") or "",
                    "devpath": str(disk_meta.get("devpath") or ""),
                    "model": str(disk_meta.get("model") or "").strip(),
                    "vendor": str(disk_meta.get("vendor") or "").strip(),
                    "serial": str(disk_meta.get("serial") or "").strip(),
                    "type": str(disk_meta.get("type") or "hdd"),
                    "rpm": str(disk_meta.get("rpm") or ""),
                    "health": str(disk_meta.get("health") or "UNKNOWN"),
                    "size_bytes": int(disk_meta.get("size") or usage["total_bytes"]),
                    **usage,
                }
            )

        ssd_meta = None
        if isinstance(disks_raw, list):
            ssd_meta = next(
                (d for d in disks_raw if isinstance(d, dict) and d.get("type") == "ssd"),
                None,
            )
        system_ssd = (
            {
                "devpath": str(ssd_meta.get("devpath") or ""),
                "model": str(ssd_meta.get("model") or "").strip(),
                "serial": str(ssd_meta.get("serial") or "").strip(),
                "health": str(ssd_meta.get("health") or "UNKNOWN"),
                "size_bytes": int(ssd_meta.get("size") or 0),
            }
            if ssd_meta
            else None
        )

        return {
            "pool": pool,
            "drives": drives,
            "system_ssd": system_ssd,
        }

    @staticmethod
    def _extract_data(resp: Any, default: Any) -> Any:
        if isinstance(resp, Exception) or resp.status_code >= 400:
            return default
        try:
            return resp.json().get("data", default)
        except Exception:
            return default

    @staticmethod
    def _build_node_summary(
        node_data: dict[str, Any],
        storage_raw: list[dict[str, Any]],
        *,
        node_name: str | None = None,
    ) -> dict[str, Any]:
        settings = get_settings()
        resolved_node_name = (node_name or "").strip() or settings.pve_node
        mem = node_data.get("memory") or {}
        swap = node_data.get("swap") or {}
        rootfs = node_data.get("rootfs") or {}
        cpuinfo = node_data.get("cpuinfo") or {}

        mem_used = int(mem.get("used", 0))
        mem_total = int(mem.get("total", 1)) or 1
        cpu_pct = round(float(node_data.get("cpu", 0.0)) * 100, 1)

        storages = []
        if isinstance(storage_raw, list):
            for st in sorted(storage_raw, key=lambda x: x.get("storage", "")):
                total = int(st.get("total", 0))
                used = int(st.get("used", 0))
                pct = round((used / total) * 100, 1) if total > 0 else 0.0
                storages.append(
                    {
                        "name": st.get("storage", ""),
                        "type": st.get("type", ""),
                        "active": bool(st.get("active", 0)),
                        "used_bytes": used,
                        "total_bytes": total,
                        "used_pct": pct,
                    }
                )

        return {
            "name": resolved_node_name,
            "cpu_pct": cpu_pct,
            "cpu_model": cpuinfo.get("model", "Intel Xeon"),
            "cpu_threads": int(cpuinfo.get("cpus", 0)),
            "loadavg": node_data.get("loadavg", ["0.00", "0.00", "0.00"]),
            "mem_used_bytes": mem_used,
            "mem_total_bytes": mem_total,
            "mem_pct": round((mem_used / mem_total) * 100, 1),
            "swap_used_bytes": int(swap.get("used", 0)),
            "swap_total_bytes": int(swap.get("total", 0)),
            "rootfs_used_bytes": int(rootfs.get("used", 0)),
            "rootfs_total_bytes": int(rootfs.get("total", 0)),
            "uptime_seconds": int(node_data.get("uptime", 0)),
            "uptime_human": _format_uptime(node_data.get("uptime", 0)),
            "pve_version": node_data.get("pveversion", ""),
            "storages": storages,
        }

    @staticmethod
    def _build_resources_list(
        lxc_raw: list[dict[str, Any]],
        qemu_raw: list[dict[str, Any]],
        *,
        node_name: str | None = None,
    ) -> list[dict[str, Any]]:
        settings = get_settings()
        resolved_node_name = (node_name or "").strip() or settings.pve_node
        items: list[dict[str, Any]] = []

        for vm_type, raw_list in (("lxc", lxc_raw), ("qemu", qemu_raw)):
            if not isinstance(raw_list, list):
                continue
            for entry in raw_list:
                vmid = int(entry.get("vmid", 0))
                mem = int(entry.get("mem", 0))
                maxmem = int(entry.get("maxmem", 0))
                disk = int(entry.get("disk", 0))
                maxdisk = int(entry.get("maxdisk", 0))
                uptime = int(entry.get("uptime", 0))
                raw_tags = str(entry.get("tags") or "")
                tags = [t.strip() for t in raw_tags.split(";") if t.strip()]

                items.append(
                    {
                        "vmid": vmid,
                        "node": str(entry.get("node") or resolved_node_name),
                        "name": entry.get("name") or f"{vm_type}-{vmid}",
                        "type": vm_type,
                        "status": entry.get("status", "unknown"),
                        "cpu_pct": round(float(entry.get("cpu", 0.0)) * 100, 1),
                        "cpus": int(entry.get("cpus", 1)),
                        "mem_used_bytes": mem,
                        "mem_total_bytes": maxmem,
                        "mem_pct": round((mem / maxmem) * 100, 1) if maxmem > 0 else 0.0,
                        "disk_used_bytes": disk,
                        "disk_total_bytes": maxdisk,
                        "uptime_seconds": uptime,
                        "uptime_human": _format_uptime(uptime) if uptime > 0 else "—",
                        "tags": tags,
                        "is_self": vmid == settings.panel_self_vmid,
                    }
                )

        items.sort(key=lambda x: x["vmid"])
        return items

    async def execute_action(
        self,
        vm_type: Literal["lxc", "qemu"],
        vmid: int,
        action: Literal["start", "stop", "reboot", "shutdown"],
        *,
        node: str | None = None,
    ) -> dict[str, Any]:
        """Trigger start/stop/reboot/shutdown on a specific LXC or QEMU VM."""
        settings = get_settings()
        target_node = (node or "").strip() or settings.pve_node
        if vmid == settings.panel_self_vmid and action in ("stop", "shutdown"):
            raise ValueError(
                f"Protection activée : impossible d'arrêter le conteneur du panel ({vmid})."
            )

        url = f"{self._base_url(target_node)}/{vm_type}/{vmid}/status/{action}"
        resp = await self._http.post(url, headers=self._headers())
        if resp.status_code >= 400:
            detail = resp.text[:300]
            raise RuntimeError(f"Erreur Proxmox ({resp.status_code}) : {detail}")

        payload = resp.json()
        return {
            "ok": True,
            "node": target_node,
            "vmid": vmid,
            "type": vm_type,
            "action": action,
            "upid": payload.get("data", ""),
        }

    async def list_apt_updates(self, node: str | None = None) -> list[dict[str, Any]]:
        """Return pending APT package updates reported by Proxmox VE on a node."""
        settings = get_settings()
        base_host = settings.pve_host.rstrip("/")
        if not base_host:
            return []
        try:
            resp = await self._http.get(
                f"{self._base_url(node)}/apt/update", headers=self._headers()
            )
            data = self._extract_data(resp, default=[])
            return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []
        except Exception:
            return []

    async def refresh_apt_database(self, node: str | None = None) -> str | None:
        """Trigger `apt-get update` on a Proxmox node via REST API and return task UPID if started."""
        settings = get_settings()
        base_host = settings.pve_host.rstrip("/")
        if not base_host:
            return None
        try:
            resp = await self._http.post(
                f"{self._base_url(node)}/apt/update", headers=self._headers()
            )
            if resp.status_code >= 400:
                return None
            upid = self._extract_data(resp, default="")
            return str(upid).strip() or None
        except Exception:
            return None

    async def wait_task(
        self, node: str | None, upid: str, *, timeout_sec: float = 20.0
    ) -> str:
        """Poll a Proxmox UPID task status briefly until stopped or timeout."""
        if not upid:
            return "unknown"
        loop = asyncio.get_running_loop()
        deadline = loop.time() + max(1.0, timeout_sec)
        url = f"{self._base_url(node)}/tasks/{quote(upid, safe='')}/status"
        while loop.time() < deadline:
            try:
                resp = await self._http.get(url, headers=self._headers())
                data = self._extract_data(resp, default={})
                if isinstance(data, dict) and data.get("status") == "stopped":
                    return str(data.get("exitstatus") or "OK")
            except Exception:
                return "unknown"
            await asyncio.sleep(1.0)
        return "running"

    async def qemu_agent_exec(
        self,
        node: str | None,
        vmid: int,
        command: list[str],
        *,
        timeout_sec: float = 120.0,
    ) -> tuple[bool, str]:
        """Execute a command inside a QEMU VM via Proxmox QEMU Guest Agent API."""
        base = self._base_url(node)
        try:
            resp = await self._http.post(
                f"{base}/qemu/{vmid}/agent/exec",
                headers=self._headers(),
                json={"command": command},
            )
        except Exception as exc:
            return False, f"Erreur communication QEMU Guest Agent : {exc}"

        if resp.status_code >= 400:
            return False, f"QEMU Guest Agent indisponible (HTTP {resp.status_code}) : {resp.text[:240]}"

        payload = self._extract_data(resp, default={})
        pid = payload.get("pid") if isinstance(payload, dict) else None
        if pid is None:
            return False, "QEMU Guest Agent n'a pas renvoyé de PID."

        loop = asyncio.get_running_loop()
        deadline = loop.time() + max(5.0, timeout_sec)
        status_url = f"{base}/qemu/{vmid}/agent/exec-status"
        while loop.time() < deadline:
            await asyncio.sleep(1.0)
            try:
                st_resp = await self._http.get(
                    status_url, headers=self._headers(), params={"pid": pid}
                )
            except Exception as exc:
                return False, f"Erreur lecture statut QEMU Guest Agent : {exc}"
            if st_resp.status_code >= 400:
                continue
            st_data = self._extract_data(st_resp, default={})
            if not isinstance(st_data, dict):
                continue
            if int(st_data.get("exited", 0)) == 1:
                exit_code = int(st_data.get("exitcode", 1))
                out_txt = str(st_data.get("out-data") or "").strip()
                err_txt = str(st_data.get("err-data") or "").strip()
                combined = "\n".join(part for part in (out_txt, err_txt) if part)
                return exit_code == 0, combined
        return False, f"Délai dépassé ({int(timeout_sec)}s) lors de l'exécution QEMU Guest Agent."
