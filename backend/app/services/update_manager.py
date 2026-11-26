"""Centralized Update Manager for PVE Command Center, Proxmox nodes, LXC/QEMU guests & Docker Compose stacks."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
from typing import Any, Callable, Literal
from urllib.parse import urlparse
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519
import httpx

from app.config import get_settings
from app.config_manager import ConfigManager, write_text_safe
from app.config_schema import AppConfig, utc_now_iso
from app.services.pve_client import ProxmoxClient
from app.services.realtime_bus import RealtimeBus

UpdateCategory = Literal["pve_center", "proxmox", "containers_vms", "docker"]

_VALID_NODE_RE = re.compile(r"^[A-Za-z0-9._-]+$")
_VALID_ABS_POSIX_DIR_RE = re.compile(r"^/[A-Za-z0-9._/@+-]+$")
_LXC_PROBE_SCRIPT = (
    "if command -v apt-get >/dev/null 2>&1; then "
    "apt-get -qq update >/dev/null 2>&1 || true; "
    "apt-get -s upgrade 2>/dev/null | grep -c '^Inst ' || echo 0; "
    "elif command -v apk >/dev/null 2>&1; then "
    "apk update >/dev/null 2>&1 || true; "
    "apk version -l '<' 2>/dev/null | grep -c '<' || echo 0; "
    "elif command -v dnf >/dev/null 2>&1; then "
    "dnf check-update -q 2>/dev/null | awk 'NF' | wc -l; "
    "else echo -1; fi"
)
_GUEST_OS_UPGRADE_SCRIPT = (
    "set -e; "
    "if command -v apt-get >/dev/null 2>&1; then "
    "export DEBIAN_FRONTEND=noninteractive; "
    "apt-get update && "
    "apt-get -y -o Dpkg::Options::='--force-confdef' -o Dpkg::Options::='--force-confold' upgrade"
    "{autoremove}; "
    "elif command -v apk >/dev/null 2>&1; then "
    "apk update && apk upgrade; "
    "elif command -v dnf >/dev/null 2>&1; then "
    "dnf upgrade -y; "
    "else echo 'Gestionnaire de paquets non supporté (apt/apk/dnf requis).' >&2; exit 1; fi"
)


def _validate_node_name(node: str) -> str:
    cleaned = (node or "").strip()
    if not cleaned or not _VALID_NODE_RE.fullmatch(cleaned):
        raise ValueError(f"Nom de nœud invalide : {node!r}")
    return cleaned


def _validate_compose_dir(compose_dir: str) -> str:
    cleaned = (compose_dir or "").strip().rstrip("/") or "/"
    parts = cleaned.split("/")
    if not _VALID_ABS_POSIX_DIR_RE.fullmatch(cleaned) or ".." in parts or cleaned == "/":
        raise ValueError(f"Chemin Docker Compose invalide : {compose_dir!r}")
    return cleaned


def _parse_version_tuple(raw: str) -> tuple[int, ...]:
    cleaned = (raw or "").strip().lstrip("vV")
    nums = [int(part) for part in re.findall(r"\d+", cleaned)[:4]]
    return tuple(nums)


def _is_newer_version(current: str, latest: str) -> bool:
    c_clean = (current or "").strip().lstrip("vV")
    l_clean = (latest or "").strip().lstrip("vV")
    if not l_clean:
        return False
    c_parts = _parse_version_tuple(c_clean)
    l_parts = _parse_version_tuple(l_clean)
    if c_parts and l_parts:
        max_len = max(len(c_parts), len(l_parts))
        c_pad = c_parts + (0,) * (max_len - len(c_parts))
        l_pad = l_parts + (0,) * (max_len - len(l_parts))
        return l_pad > c_pad
    return bool(c_clean and l_clean != c_clean)


class UpdateManager:
    """Orchestrates discovery, dry-run checks, and live streamed updates across all PVE-Center layers."""

    def __init__(
        self,
        *,
        config_manager: ConfigManager,
        bus: RealtimeBus,
        pve_http: httpx.AsyncClient,
        outbound_http: httpx.AsyncClient,
        app_version: str = "1.0.0",
    ) -> None:
        self._config_manager = config_manager
        self._bus = bus
        self._pve_http = pve_http
        self._outbound_http = outbound_http
        self._app_version = app_version

        self._targets: dict[str, dict[str, Any]] = {}
        self._last_checked_at: str | None = None
        self._ssh_connected: bool = False
        self._ssh_message: str = "Vérification SSH en attente."
        self._active_job: dict[str, Any] | None = None
        self._job_task: asyncio.Task[None] | None = None
        self._history: list[dict[str, Any]] = self._load_history()
        self._github_cache: tuple[float, dict[str, dict[str, Any]]] | None = None

    @property
    def history_path(self) -> Path:
        return self._config_manager.config_path.parent / "updates_history.json"

    def _load_history(self) -> list[dict[str, Any]]:
        path = self.history_path
        if not path.is_file():
            return []
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                return [item for item in raw if isinstance(item, dict)][:15]
        except Exception:
            pass
        return []

    def _save_history(self) -> None:
        try:
            write_text_safe(
                self.history_path,
                json.dumps(self._history[:15], indent=2, ensure_ascii=False),
                new_file_mode=0o600,
            )
        except Exception:
            pass

    def _config(self) -> AppConfig:
        return self._config_manager.config

    def _resolve_ssh_paths(self) -> tuple[Path, Path]:
        cfg = self._config()
        explicit = cfg.updates.ssh_key_path.strip()
        if explicit:
            priv = Path(explicit)
        else:
            priv = self._config_manager.config_path.parent / "id_ed25519_updates"
        pub = priv.with_name(f"{priv.name}.pub")
        return priv, pub

    def ensure_ssh_keypair(self, *, force_rotate: bool = False) -> tuple[Path, str]:
        """Return (private_key_path, public_key_line), generating an Ed25519 keypair safely if absent."""
        priv_path, pub_path = self._resolve_ssh_paths()
        if not force_rotate and priv_path.is_file() and pub_path.is_file():
            pub_text = pub_path.read_text(encoding="utf-8").strip()
            if pub_text:
                return priv_path, pub_text

        private_key = ed25519.Ed25519PrivateKey.generate()
        priv_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.OpenSSH,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8")
        pub_openssh = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.OpenSSH,
            format=serialization.PublicFormat.OpenSSH,
        ).decode("utf-8")
        pub_line = f"{pub_openssh} pve-center-updates\n"

        write_text_safe(priv_path, priv_pem, new_file_mode=0o600)
        try:
            os.chmod(priv_path, 0o600)
        except OSError:
            pass
        write_text_safe(pub_path, pub_line, new_file_mode=0o644)
        return priv_path, pub_line.strip()

    def _resolve_ssh_host(self) -> str:
        cfg = self._config()
        if cfg.updates.ssh_host.strip():
            return cfg.updates.ssh_host.strip()
        pve_host = cfg.proxmox.host.strip()
        if pve_host:
            parsed = urlparse(pve_host if "://" in pve_host else f"https://{pve_host}")
            if parsed.hostname:
                return parsed.hostname
        return ""

    async def _run_local_cmd(
        self,
        args: list[str],
        *,
        cwd: str | None = None,
        timeout_sec: float = 120.0,
        on_line: Callable[[str], None] | None = None,
    ) -> tuple[int, str]:
        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except FileNotFoundError as exc:
            return 127, f"Binaire introuvable : {exc.filename}"
        except Exception as exc:
            return 1, f"Impossible de lancer la commande : {exc}"

        lines: list[str] = []
        assert proc.stdout is not None

        async def _drain() -> None:
            while True:
                raw_line = await proc.stdout.readline()
                if not raw_line:
                    break
                text = raw_line.decode("utf-8", errors="replace").rstrip()
                if text:
                    lines.append(text)
                    if on_line is not None:
                        on_line(text)

        try:
            await asyncio.wait_for(_drain(), timeout=timeout_sec)
            rc = await asyncio.wait_for(proc.wait(), timeout=10.0)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            return 124, "\n".join(lines[-20:] + [f"Délai dépassé ({int(timeout_sec)}s)."])

        return int(rc), "\n".join(lines[-40:])

    async def _run_ssh_cmd(
        self,
        remote_script: str,
        *,
        timeout_sec: float = 180.0,
        host_override: str | None = None,
        on_line: Callable[[str], None] | None = None,
    ) -> tuple[int, str]:
        cfg = self._config()
        host = (host_override or "").strip() or self._resolve_ssh_host()
        if not host:
            return 1, "Hôte SSH Proxmox non configuré."
        if not shutil.which("ssh"):
            return 127, "Client OpenSSH (ssh) absent dans le conteneur."

        priv_path, _ = self.ensure_ssh_keypair()
        cmd = [
            "ssh",
            "-i",
            str(priv_path),
            "-p",
            str(cfg.updates.ssh_port),
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "ConnectTimeout=5",
            f"{cfg.updates.ssh_user}@{host}",
            remote_script,
        ]
        return await self._run_local_cmd(cmd, timeout_sec=timeout_sec, on_line=on_line)

    async def check_ssh_connectivity(self) -> tuple[bool, str]:
        """Test batch-mode SSH connectivity to the Proxmox host."""
        host = self._resolve_ssh_host()
        if not host:
            self._ssh_connected = False
            self._ssh_message = "Aucun hôte Proxmox configuré pour l'accès SSH."
            return False, self._ssh_message

        self.ensure_ssh_keypair()
        if not shutil.which("ssh"):
            self._ssh_connected = False
            self._ssh_message = "Client ssh absent sur ce système."
            return False, self._ssh_message

        rc, out = await self._run_ssh_cmd("echo PVE_CENTER_SSH_OK", timeout_sec=7.0)
        if rc == 0 and "PVE_CENTER_SSH_OK" in out:
            self._ssh_connected = True
            self._ssh_message = f"Connecté en SSH ({self._config().updates.ssh_user}@{host})."
        else:
            self._ssh_connected = False
            snippet = (out.splitlines()[-1] if out else "").strip()
            self._ssh_message = snippet or f"Connexion SSH refusée vers {host}."
        return self._ssh_connected, self._ssh_message

    def get_setup_info(self) -> dict[str, Any]:
        """Return SSH public key, target host details, and copyable Proxmox authorization one-liner."""
        cfg = self._config()
        _, pub_key = self.ensure_ssh_keypair()
        host = self._resolve_ssh_host()
        quoted_pub = shlex.quote(pub_key)
        one_liner = (
            "mkdir -p ~/.ssh && chmod 700 ~/.ssh && "
            f"grep -qxF {quoted_pub} ~/.ssh/authorized_keys 2>/dev/null || "
            f"printf '%s\\n' {quoted_pub} >> ~/.ssh/authorized_keys && "
            "chmod 600 ~/.ssh/authorized_keys"
        )
        return {
            "ssh_configured": self._ssh_connected,
            "ssh_message": self._ssh_message,
            "ssh_host": host,
            "ssh_port": cfg.updates.ssh_port,
            "ssh_user": cfg.updates.ssh_user,
            "ssh_public_key": pub_key,
            "proxmox_one_liner": one_liner,
            "panel_repo_dir": cfg.updates.panel_repo_dir,
        }

    def rotate_ssh_key(self) -> dict[str, Any]:
        """Regenerate Ed25519 keypair used for Proxmox/LXC/Docker updates."""
        self.ensure_ssh_keypair(force_rotate=True)
        self._ssh_connected = False
        self._ssh_message = "Nouvelle clé Ed25519 générée : autorisez-la sur votre hôte Proxmox."
        return self.get_setup_info()

    async def _fetch_github_releases(self, *, force: bool = False) -> dict[str, dict[str, Any]]:
        now = asyncio.get_running_loop().time()
        if not force and self._github_cache and (now - self._github_cache[0]) < 600.0:
            return self._github_cache[1]

        org = self._config().updates.github_org.strip() or "PVE-Center"
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "pve-command-center-updater/1.0",
        }
        repos = ("pve-panel", "pve-center-clients", "pve-center-apple")
        info: dict[str, dict[str, Any]] = {}

        async def _query_repo(repo_name: str) -> tuple[str, dict[str, Any]]:
            base_url = f"https://api.github.com/repos/{org}/{repo_name}"
            try:
                resp = await self._outbound_http.get(
                    f"{base_url}/releases/latest", headers=headers, timeout=4.0
                )
                if resp.status_code == 200:
                    data = resp.json()
                    tag = str(data.get("tag_name") or "").strip()
                    assets = [
                        {
                            "name": str(a.get("name") or ""),
                            "url": str(a.get("browser_download_url") or ""),
                        }
                        for a in (data.get("assets") or [])
                        if isinstance(a, dict)
                    ]
                    return repo_name, {
                        "tag": tag or self._app_version,
                        "release_url": str(
                            data.get("html_url") or f"https://github.com/{org}/{repo_name}/releases"
                        ),
                        "assets": assets,
                        "notes": str(data.get("name") or tag or ""),
                    }
            except Exception:
                pass

            try:
                c_resp = await self._outbound_http.get(
                    f"{base_url}/commits/main", headers=headers, timeout=4.0
                )
                if c_resp.status_code == 200:
                    sha = str(c_resp.json().get("sha") or "")[:7]
                    return repo_name, {
                        "tag": f"{self._app_version} ({sha})" if sha else self._app_version,
                        "release_url": f"https://github.com/{org}/{repo_name}/releases",
                        "assets": [],
                        "notes": "",
                    }
            except Exception:
                pass

            return repo_name, {
                "tag": self._app_version,
                "release_url": f"https://github.com/{org}/{repo_name}/releases",
                "assets": [],
                "notes": "",
            }

        results = await asyncio.gather(*(_query_repo(r) for r in repos))
        for repo_name, meta in results:
            info[repo_name] = meta
        self._github_cache = (now, info)
        return info

    def _local_git_compose_ready(self) -> bool:
        repo_dir = Path(self._config().updates.panel_repo_dir)
        return (repo_dir / ".git").exists() and bool(shutil.which("git")) and bool(shutil.which("docker"))

    async def _discover_docker_targets(
        self,
        running_lxcs: list[dict[str, Any]],
        *,
        ssh_ready: bool,
        refresh_remote: bool,
    ) -> list[dict[str, Any]]:
        cfg = self._config()
        targets: list[dict[str, Any]] = []
        seen_keys: set[tuple[str, int | None, str]] = set()

        for dt in cfg.updates.docker_targets:
            if not dt.enabled:
                continue
            key = (dt.scope, dt.vmid, dt.compose_dir)
            seen_keys.add(key)
            can_exec = dt.scope == "local" or dt.scope == "qemu" or ssh_ready
            targets.append(
                {
                    "id": f"docker:{dt.id}",
                    "category": "docker",
                    "kind": "docker_compose",
                    "name": dt.name,
                    "subtitle": f"{dt.scope.upper()} • {dt.compose_dir}",
                    "scope": dt.scope,
                    "node": dt.node or cfg.proxmox.default_node,
                    "vmid": dt.vmid,
                    "compose_dir": dt.compose_dir,
                    "status": "configured",
                    "current_version": "Compose",
                    "latest_version": "Dernière image",
                    "update_available": False,
                    "pending_count": None,
                    "packages_preview": [],
                    "can_execute": can_exec,
                    "requires_ssh": dt.scope in ("proxmox_host", "lxc"),
                    "release_url": None,
                    "last_checked_at": self._last_checked_at,
                }
            )

        if not refresh_remote:
            return targets

        ps_fmt = "{{.Label \"com.docker.compose.project\"}}|{{.Label \"com.docker.compose.project.working_dir\"}}|{{.Names}}|{{.Image}}"

        async def _parse_ps_lines(
            lines_raw: str, *, scope: Literal["local", "proxmox_host", "lxc"], node: str, vmid: int | None
        ) -> None:
            grouped: dict[str, dict[str, Any]] = {}
            for line in lines_raw.splitlines():
                parts = line.split("|")
                if len(parts) < 4:
                    continue
                project, workdir, cname, image = [p.strip() for p in parts[:4]]
                if not workdir or not workdir.startswith("/") or project == "pve-panel":
                    continue
                try:
                    safe_dir = _validate_compose_dir(workdir)
                except ValueError:
                    continue
                entry = grouped.setdefault(
                    safe_dir,
                    {
                        "project": project or Path(safe_dir).name,
                        "containers": [],
                        "images": [],
                    },
                )
                entry["containers"].append(f"{cname} ({image})")
                entry["images"].append(image)

            for safe_dir, meta in grouped.items():
                key = (scope, vmid, safe_dir)
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                digest = hashlib.sha1(f"{scope}:{vmid}:{safe_dir}".encode("utf-8")).hexdigest()[:8]
                label = str(meta["project"])
                targets.append(
                    {
                        "id": f"docker:auto:{digest}",
                        "category": "docker",
                        "kind": "docker_compose",
                        "name": f"Stack Docker : {label}",
                        "subtitle": (
                            f"LXC {vmid} ({node}) • {safe_dir}"
                            if scope == "lxc" and vmid is not None
                            else f"{scope} • {safe_dir}"
                        ),
                        "scope": scope,
                        "node": node,
                        "vmid": vmid,
                        "compose_dir": safe_dir,
                        "status": "running",
                        "current_version": f"{len(meta['containers'])} conteneur(s)",
                        "latest_version": "Pull / Recreate",
                        "update_available": False,
                        "pending_count": len(meta["containers"]),
                        "packages_preview": meta["containers"][:8],
                        "can_execute": True,
                        "requires_ssh": scope in ("proxmox_host", "lxc"),
                        "release_url": None,
                        "last_checked_at": self._last_checked_at,
                    }
                )

        if shutil.which("docker") and Path("/var/run/docker.sock").exists():
            rc, out = await self._run_local_cmd(
                ["docker", "ps", "--format", ps_fmt], timeout_sec=6.0
            )
            if rc == 0 and out:
                await _parse_ps_lines(out, scope="local", node=cfg.proxmox.default_node, vmid=None)

        if ssh_ready and running_lxcs:
            sem = asyncio.Semaphore(4)

            async def _scan_lxc_docker(lxc_res: dict[str, Any]) -> None:
                vmid = int(lxc_res["vmid"])
                node_name = str(lxc_res.get("node") or cfg.proxmox.default_node)
                async with sem:
                    rc, out = await self._run_ssh_cmd(
                        f"pct exec {vmid} -- sh -c {shlex.quote(f'command -v docker >/dev/null 2>&1 && docker ps --format {shlex.quote(ps_fmt)} || true')}",
                        timeout_sec=10.0,
                    )
                if rc == 0 and out:
                    await _parse_ps_lines(out, scope="lxc", node=node_name, vmid=vmid)

            await asyncio.gather(*(_scan_lxc_docker(r) for r in running_lxcs[:16]))

        return targets

    async def check_updates(self, *, refresh_remote: bool = False) -> dict[str, Any]:
        """Discover all update targets across PVE Center, Proxmox nodes, LXC/QEMU & Docker stacks."""
        cfg = self._config()
        settings = get_settings()
        checked_at = utc_now_iso()
        self._last_checked_at = checked_at

        if refresh_remote:
            ssh_ready, _ = await self.check_ssh_connectivity()
        elif not self._ssh_connected:
            ssh_ready, _ = await self.check_ssh_connectivity()
        else:
            ssh_ready = self._ssh_connected

        pve_client = ProxmoxClient(self._pve_http)
        gh_coro = self._fetch_github_releases(force=refresh_remote)
        nodes_coro = pve_client.list_nodes()
        overview_coro = pve_client.get_overview(node="*")
        gh_info, nodes_list, cluster_overview = await asyncio.gather(
            gh_coro, nodes_coro, overview_coro
        )

        new_targets: list[dict[str, Any]] = []

        # 1. PVE Command Center (server + clients)
        panel_meta = gh_info.get("pve-panel", {})
        panel_latest = str(panel_meta.get("tag") or self._app_version)
        panel_update_avail = _is_newer_version(self._app_version, panel_latest)
        local_panel_exec = self._local_git_compose_ready()
        new_targets.append(
            {
                "id": "panel:server",
                "category": "pve_center",
                "kind": "panel_server",
                "name": "Serveur PVE Command Center",
                "subtitle": f"Repo {cfg.updates.panel_repo_dir} • conteneur LXC #{cfg.proxmox.panel_self_vmid}",
                "node": cfg.proxmox.default_node,
                "vmid": cfg.proxmox.panel_self_vmid,
                "status": "online",
                "current_version": f"v{self._app_version.lstrip('v')}",
                "latest_version": panel_latest,
                "update_available": panel_update_avail,
                "pending_count": 1 if panel_update_avail else 0,
                "packages_preview": (
                    [f"pve-panel -> {panel_latest}"] if panel_update_avail else []
                ),
                "can_execute": bool(ssh_ready or local_panel_exec),
                "requires_ssh": not local_panel_exec,
                "release_url": panel_meta.get("release_url"),
                "last_checked_at": checked_at,
            }
        )

        clients_meta = gh_info.get("pve-center-clients", {})
        apple_meta = gh_info.get("pve-center-apple", {})
        for cid, label, sub, repo_meta in (
            ("client:desktop", "Client Desktop (Windows / Linux)", "Tauri v2 auto-updater (.exe / .msi / .AppImage / .deb)", clients_meta),
            ("client:android", "Application Android", "Capacitor 8 APK (GitHub Releases)", clients_meta),
            ("client:apple", "Applications Apple (iOS / macOS / tvOS)", "Swift 6 natif (Xcode / TestFlight)", apple_meta),
        ):
            new_targets.append(
                {
                    "id": cid,
                    "category": "pve_center",
                    "kind": "client_app",
                    "name": label,
                    "subtitle": sub,
                    "node": None,
                    "vmid": None,
                    "status": "available",
                    "current_version": f"v{self._app_version.lstrip('v')}",
                    "latest_version": str(repo_meta.get("tag") or self._app_version),
                    "update_available": _is_newer_version(
                        self._app_version, str(repo_meta.get("tag") or "")
                    ),
                    "pending_count": None,
                    "packages_preview": [
                        a["name"] for a in (repo_meta.get("assets") or [])[:6] if a.get("name")
                    ],
                    "can_execute": False,
                    "requires_ssh": False,
                    "release_url": repo_meta.get("release_url"),
                    "last_checked_at": checked_at,
                }
            )

        # 2. Proxmox VE Cluster Nodes (APT API + SSH dist-upgrade)
        online_nodes = [n for n in nodes_list if n.get("online")] or nodes_list[:1]
        if refresh_remote:
            upids = await asyncio.gather(
                *(pve_client.refresh_apt_database(str(n["name"])) for n in online_nodes)
            )
            await asyncio.gather(
                *(
                    pve_client.wait_task(str(n["name"]), upid, timeout_sec=15.0)
                    for n, upid in zip(online_nodes, upids)
                    if upid
                )
            )

        apt_lists = await asyncio.gather(
            *(pve_client.list_apt_updates(str(n["name"])) for n in online_nodes)
        )
        for node_info, pkgs in zip(online_nodes, apt_lists):
            node_name = str(node_info.get("name") or settings.pve_node)
            preview = [
                f"{p.get('Package', '?')} ({p.get('OldVersion', '?')} -> {p.get('Version', '?')})"
                for p in pkgs[:15]
            ]
            new_targets.append(
                {
                    "id": f"proxmox:{node_name}",
                    "category": "proxmox",
                    "kind": "pve_node",
                    "name": f"Nœud Proxmox VE : {node_name}",
                    "subtitle": "APT système & hyperviseur Proxmox",
                    "node": node_name,
                    "vmid": None,
                    "status": "online" if node_info.get("online") else "unknown",
                    "current_version": "APT",
                    "latest_version": f"{len(pkgs)} paquet(s)" if pkgs else "À jour",
                    "update_available": len(pkgs) > 0,
                    "pending_count": len(pkgs),
                    "packages_preview": preview,
                    "can_execute": ssh_ready,
                    "requires_ssh": True,
                    "release_url": None,
                    "last_checked_at": checked_at,
                }
            )

        # 3. LXC & QEMU Guests
        resources = [
            r
            for r in (cluster_overview.get("resources") or [])
            if isinstance(r, dict) and int(r.get("vmid", 0)) != settings.panel_self_vmid
        ]
        running_lxcs = [
            r for r in resources if r.get("type") == "lxc" and r.get("status") == "running"
        ]

        lxc_counts: dict[int, int | None] = {}
        if refresh_remote and ssh_ready and running_lxcs:
            sem = asyncio.Semaphore(4)

            async def _probe_lxc_pkg_count(res: dict[str, Any]) -> None:
                vid = int(res["vmid"])
                async with sem:
                    rc, out = await self._run_ssh_cmd(
                        f"pct exec {vid} -- sh -c {shlex.quote(_LXC_PROBE_SCRIPT)}",
                        timeout_sec=12.0,
                    )
                if rc == 0 and out.strip():
                    last_line = out.strip().splitlines()[-1].strip()
                    if last_line.lstrip("-").isdigit():
                        val = int(last_line)
                        lxc_counts[vid] = val if val >= 0 else None

            await asyncio.gather(*(_probe_lxc_pkg_count(r) for r in running_lxcs[:20]))

        for res in resources:
            vm_type = str(res.get("type") or "lxc")
            vmid = int(res.get("vmid") or 0)
            node_name = str(res.get("node") or settings.pve_node)
            is_running = res.get("status") == "running"
            pending = lxc_counts.get(vmid)
            can_exec = is_running and (ssh_ready if vm_type == "lxc" else True)
            new_targets.append(
                {
                    "id": f"{vm_type}:{vmid}",
                    "category": "containers_vms",
                    "kind": vm_type,
                    "name": f"{res.get('name') or f'{vm_type}-{vmid}'} (#{vmid})",
                    "subtitle": f"{vm_type.upper()} sur {node_name} • {res.get('status', 'unknown')}",
                    "node": node_name,
                    "vmid": vmid,
                    "status": str(res.get("status") or "unknown"),
                    "current_version": "OS invité",
                    "latest_version": (
                        f"{pending} paquet(s)"
                        if isinstance(pending, int) and pending > 0
                        else ("À jour" if pending == 0 else "Prêt pour apt/apk/dnf")
                    ),
                    "update_available": bool(isinstance(pending, int) and pending > 0),
                    "pending_count": pending,
                    "packages_preview": [],
                    "can_execute": can_exec,
                    "requires_ssh": vm_type == "lxc",
                    "release_url": None,
                    "last_checked_at": checked_at,
                }
            )

        # 4. Docker Compose targets (configured + auto-discovered)
        docker_targets = await self._discover_docker_targets(
            running_lxcs, ssh_ready=ssh_ready, refresh_remote=refresh_remote
        )
        new_targets.extend(docker_targets)

        self._targets = {item["id"]: item for item in new_targets}
        return self.get_overview()

    def get_overview(self) -> dict[str, Any]:
        """Return cached targets summary, SSH readiness status, and active/recent update jobs."""
        targets = list(self._targets.values())
        updates_available = sum(1 for t in targets if t.get("update_available"))
        pending_packages = sum(
            int(t["pending_count"])
            for t in targets
            if isinstance(t.get("pending_count"), int) and t.get("update_available")
        )
        return {
            "enabled": self._config().updates.enabled,
            "ssh_configured": self._ssh_connected,
            "ssh_message": self._ssh_message,
            "ssh_host": self._resolve_ssh_host(),
            "last_checked_at": self._last_checked_at,
            "summary": {
                "total_targets": len(targets),
                "updates_available": updates_available,
                "pending_packages": pending_packages,
                "executable_targets": sum(1 for t in targets if t.get("can_execute")),
            },
            "targets": targets,
            "active_job": self._active_job,
            "recent_jobs": self._history[:8],
        }

    def get_jobs_status(self) -> dict[str, Any]:
        return {
            "active_job": self._active_job,
            "recent_jobs": self._history[:8],
        }

    def _emit_job_progress(self) -> None:
        if not self._active_job:
            return
        self._bus.publish_nowait("update_job_progress", {"job": dict(self._active_job)})

    def _append_job_log(self, line: str) -> None:
        if not self._active_job:
            return
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        logs = self._active_job.setdefault("logs", [])
        logs.append(f"[{ts}] {line}")
        if len(logs) > 300:
            del logs[: len(logs) - 300]

    async def start_update_job(
        self,
        *,
        target_ids: list[str],
        include_panel_self: bool = True,
        autoremove: bool = True,
    ) -> dict[str, Any]:
        """Validate targets and launch an asynchronous sequential update job."""
        if self._active_job and self._active_job.get("status") == "running":
            raise RuntimeError("Une opération de mise à jour est déjà en cours.")

        if not self._targets:
            await self.check_updates(refresh_remote=False)

        requested = [tid.strip() for tid in target_ids if tid and tid.strip()]
        if not requested:
            raise ValueError("Aucune cible de mise à jour sélectionnée.")

        if "all" in requested:
            selected = [
                t
                for t in self._targets.values()
                if t.get("can_execute")
                and (t["id"] != "panel:server" or include_panel_self)
                and (
                    t.get("update_available")
                    or t.get("category") in ("containers_vms", "docker")
                )
            ]
        else:
            selected = []
            for tid in requested:
                target = self._targets.get(tid)
                if target and target.get("can_execute"):
                    selected.append(target)

        if not selected:
            raise ValueError(
                "Aucune cible exécutable trouvée (vérifiez l'accès SSH Proxmox ou que les conteneurs soient démarrés)."
            )

        # Always execute panel self-update LAST so container restart does not abort earlier steps.
        selected.sort(key=lambda item: (1 if item["id"] == "panel:server" else 0, item["id"]))

        job_id = f"upd-{str(uuid4())[:8]}"
        steps = [
            {
                "target_id": t["id"],
                "name": t["name"],
                "category": t["category"],
                "status": "pending",
                "message": "En attente",
            }
            for t in selected
        ]
        self._active_job = {
            "id": job_id,
            "status": "running",
            "started_at": utc_now_iso(),
            "finished_at": None,
            "progress_pct": 0,
            "steps": steps,
            "logs": [],
        }
        self._append_job_log(
            f"Démarrage de la mise à jour centralisée ({len(selected)} cible(s))."
        )
        self._emit_job_progress()

        self._job_task = asyncio.create_task(
            self._execute_job(selected, autoremove=autoremove),
            name=f"update-job-{job_id}",
        )
        return self._active_job

    async def _execute_job(
        self, targets: list[dict[str, Any]], *, autoremove: bool
    ) -> None:
        assert self._active_job is not None
        total = max(1, len(targets))
        had_failure = False

        for idx, target in enumerate(targets):
            step = self._active_job["steps"][idx]
            step["status"] = "running"
            step["message"] = "Mise à jour en cours…"
            self._append_job_log(f"--- [{idx + 1}/{total}] {target['name']} ({target['id']}) ---")
            self._emit_job_progress()

            try:
                ok, msg = await self._execute_single_target(target, autoremove=autoremove)
            except Exception as exc:
                ok, msg = False, str(exc)

            step["status"] = "succeeded" if ok else "failed"
            step["message"] = msg
            if ok:
                target["update_available"] = False
                target["pending_count"] = 0
                target["latest_version"] = "À jour"
            else:
                had_failure = True

            self._append_job_log(
                f"{'OK' if ok else 'ERREUR'} {target['name']} : {msg}"
            )
            self._active_job["progress_pct"] = int(((idx + 1) / total) * 100)
            self._emit_job_progress()

        self._active_job["status"] = "failed" if had_failure else "succeeded"
        self._active_job["finished_at"] = utc_now_iso()
        self._active_job["progress_pct"] = 100
        self._append_job_log(
            "Mise à jour globale terminée avec erreurs."
            if had_failure
            else "Toutes les mises à jour sélectionnées sont terminées."
        )
        self._emit_job_progress()

        self._history.insert(0, dict(self._active_job))
        self._history = self._history[:15]
        self._save_history()

    async def _execute_single_target(
        self, target: dict[str, Any], *, autoremove: bool
    ) -> tuple[bool, str]:
        kind = target.get("kind")
        autoremove_part = " && apt-get -y autoremove" if autoremove else ""
        guest_script = _GUEST_OS_UPGRADE_SCRIPT.format(autoremove=autoremove_part)

        def _log(line: str) -> None:
            self._append_job_log(f"  {line[:220]}")

        if kind == "pve_node":
            _validate_node_name(str(target.get("node") or ""))
            cmd = (
                "set -e; export DEBIAN_FRONTEND=noninteractive; "
                "apt-get update && "
                "apt-get -y -o Dpkg::Options::='--force-confdef' -o Dpkg::Options::='--force-confold' dist-upgrade"
                + autoremove_part
            )
            rc, out = await self._run_ssh_cmd(cmd, timeout_sec=300.0, on_line=_log)
            if rc == 0:
                return True, "Paquets Proxmox VE mis à jour."
            return False, (out.splitlines()[-1] if out else f"Code retour SSH {rc}")

        if kind == "lxc":
            vmid = int(target["vmid"])
            if vmid <= 0:
                raise ValueError("VMID LXC invalide.")
            rc, out = await self._run_ssh_cmd(
                f"pct exec {vmid} -- sh -c {shlex.quote(guest_script)}",
                timeout_sec=300.0,
                on_line=_log,
            )
            if rc == 0:
                return True, f"Conteneur LXC #{vmid} mis à jour."
            return False, (out.splitlines()[-1] if out else f"Échec LXC #{vmid} (code {rc})")

        if kind == "qemu":
            vmid = int(target["vmid"])
            node_name = _validate_node_name(str(target.get("node") or ""))
            pve_client = ProxmoxClient(self._pve_http)
            ok, out = await pve_client.qemu_agent_exec(
                node_name, vmid, ["sh", "-c", guest_script], timeout_sec=300.0
            )
            if out:
                for line in out.splitlines()[-8:]:
                    _log(line)
            return ok, (
                f"VM #{vmid} mise à jour via QEMU Guest Agent."
                if ok
                else (out.splitlines()[-1] if out else "QEMU Guest Agent indisponible.")
            )

        if kind == "docker_compose":
            compose_dir = _validate_compose_dir(str(target.get("compose_dir") or ""))
            scope = str(target.get("scope") or "lxc")
            compose_cmd = (
                f"cd {shlex.quote(compose_dir)} && "
                "docker compose pull && docker compose up -d --remove-orphans && "
                "docker image prune -f >/dev/null 2>&1 || true"
            )
            if scope == "local":
                rc, out = await self._run_local_cmd(
                    ["docker", "compose", "pull"], cwd=compose_dir, timeout_sec=240.0, on_line=_log
                )
                if rc != 0:
                    return False, (out.splitlines()[-1] if out else "docker compose pull a échoué.")
                rc2, out2 = await self._run_local_cmd(
                    ["docker", "compose", "up", "-d", "--remove-orphans"],
                    cwd=compose_dir,
                    timeout_sec=180.0,
                    on_line=_log,
                )
                return rc2 == 0, (
                    "Images tirées et pile Docker recréée."
                    if rc2 == 0
                    else (out2.splitlines()[-1] if out2 else "docker compose up a échoué.")
                )
            if scope == "lxc":
                vmid = int(target["vmid"])
                rc, out = await self._run_ssh_cmd(
                    f"pct exec {vmid} -- sh -c {shlex.quote(compose_cmd)}",
                    timeout_sec=300.0,
                    on_line=_log,
                )
                return rc == 0, (
                    f"Pile Docker mise à jour dans LXC #{vmid}."
                    if rc == 0
                    else (out.splitlines()[-1] if out else f"Échec Docker LXC #{vmid}")
                )
            if scope == "proxmox_host":
                rc, out = await self._run_ssh_cmd(compose_cmd, timeout_sec=300.0, on_line=_log)
                return rc == 0, (
                    "Pile Docker mise à jour sur l'hôte Proxmox."
                    if rc == 0
                    else (out.splitlines()[-1] if out else "Échec Docker sur l'hôte.")
                )
            if scope == "qemu":
                vmid = int(target["vmid"])
                node_name = _validate_node_name(str(target.get("node") or ""))
                pve_client = ProxmoxClient(self._pve_http)
                ok, out = await pve_client.qemu_agent_exec(
                    node_name, vmid, ["sh", "-c", compose_cmd], timeout_sec=300.0
                )
                return ok, (
                    f"Pile Docker mise à jour dans VM #{vmid}."
                    if ok
                    else (out.splitlines()[-1] if out else "Échec Docker QEMU.")
                )

        if kind == "panel_server":
            cfg = self._config()
            repo_dir = _validate_compose_dir(cfg.updates.panel_repo_dir)
            detached_script = (
                f"nohup sh -c 'sleep 2 && cd {shlex.quote(repo_dir)} && "
                "git pull --ff-only && docker compose up -d --build' "
                ">/tmp/pve-panel-self-update.log 2>&1 </dev/null &"
            )
            if self._ssh_connected:
                self_vmid = cfg.proxmox.panel_self_vmid
                rc, out = await self._run_ssh_cmd(
                    f"pct exec {self_vmid} -- sh -c {shlex.quote(detached_script)}",
                    timeout_sec=20.0,
                    on_line=_log,
                )
                if rc == 0:
                    return True, "Auto-mise à jour détachée de pve-panel déclenchée (redémarrage ~30s)."
                return False, (out.splitlines()[-1] if out else "Échec déclenchement auto-mise à jour.")

            if self._local_git_compose_ready():
                proc = await asyncio.create_subprocess_shell(detached_script)
                await proc.wait()
                return True, "Auto-mise à jour locale détachée de pve-panel déclenchée."
            return False, "Auto-mise à jour serveur impossible sans SSH Proxmox ou dépôt Git local."

        return False, f"Type de cible non exécutable : {kind}"
