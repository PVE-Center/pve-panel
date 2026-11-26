"""Tests for Unified Update Center schema, Ed25519 key lifecycle, RBAC, and UpdateManager orchestration."""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx
import pytest
import yaml

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config_manager import get_config_manager, hash_token, reset_config_manager  # noqa: E402
from app.config_schema import DockerUpdateTargetConfig, validate_app_config  # noqa: E402
from app.middleware.tailscale_auth import TailscaleSSOMiddleware  # noqa: E402
from app.routers import updates as updates_router  # noqa: E402
from app.services.realtime_bus import get_realtime_bus  # noqa: E402
from app.services.update_manager import UpdateManager  # noqa: E402


@pytest.fixture()
def update_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    cfg_dir = tmp_path / "config"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    cfg_path = cfg_dir / "config.yaml"
    db_path = cfg_dir / "state.db"
    env_path = tmp_path / ".env"

    monkeypatch.setenv("CONFIG_PATH", str(cfg_path))
    monkeypatch.setenv("STATE_DB_PATH", str(db_path))
    monkeypatch.setenv("ENV_FILE_PATH", str(env_path))

    admin_tok = "pve_admin_updates_token"
    op_tok = "pve_op_updates_token"
    viewer_tok = "pve_viewer_updates_token"

    raw_cfg = {
        "version": 1,
        "server": {"name": "Test Updates", "mdns_enabled": False},
        "security": {
            "tailscale_sso_enabled": False,
            "dev_auth_bypass": False,
            "session_secret": "test-session-secret-0123456789abcd",
            "api_tokens": [
                {"id": "t-adm", "name": "Admin", "token_hash": hash_token(admin_tok), "role": "admin"},
                {"id": "t-op", "name": "Operator", "token_hash": hash_token(op_tok), "role": "operator"},
                {"id": "t-vw", "name": "Viewer", "token_hash": hash_token(viewer_tok), "role": "viewer"},
            ],
        },
        "proxmox": {
            "host": "https://192.168.10.2:8006",
            "token_id": "root@pam!panel",
            "token_secret": "secret-val",
            "default_node": "pve1",
            "panel_self_vmid": 116,
        },
        "updates": {
            "enabled": True,
            "docker_targets": [
                {
                    "id": "media",
                    "name": "Media Stack",
                    "scope": "local",
                    "compose_dir": "/opt/stacks/media",
                }
            ],
        },
    }
    cfg_path.write_text(yaml.safe_dump(raw_cfg), encoding="utf-8")
    reset_config_manager()
    manager = get_config_manager()

    def _pve_handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api2/json/nodes":
            return httpx.Response(
                200,
                json={"data": [{"node": "pve1", "status": "online", "cpu": 0.1, "maxcpu": 8, "mem": 1024, "maxmem": 8192, "uptime": 1200}]},
            )
        if path == "/api2/json/nodes/pve1/apt/update":
            if request.method == "POST":
                return httpx.Response(200, json={"data": ""})
            return httpx.Response(
                200,
                json={"data": [{"Package": "pve-manager", "OldVersion": "8.3.1", "Version": "8.3.2"}]},
            )
        if path == "/api2/json/nodes/pve1/status":
            return httpx.Response(200, json={"data": {"cpu": 0.1, "cpuinfo": {"cpus": 8}, "memory": {"used": 100, "total": 1000}}})
        if path == "/api2/json/nodes/pve1/lxc":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"vmid": 102, "name": "ct-media", "status": "running", "cpus": 2, "mem": 100, "maxmem": 1000},
                        {"vmid": 116, "name": "pve-panel", "status": "running", "cpus": 1, "mem": 50, "maxmem": 500},
                    ]
                },
            )
        if path in (
            "/api2/json/nodes/pve1/storage",
            "/api2/json/nodes/pve1/qemu",
            "/api2/json/nodes/pve1/disks/list",
        ):
            return httpx.Response(200, json={"data": []})
        return httpx.Response(404, json={"data": None})

    def _outbound_handler(request: httpx.Request) -> httpx.Response:
        if "pve-panel" in str(request.url):
            return httpx.Response(
                200,
                json={"tag_name": "v1.2.0", "html_url": "https://github.com/PVE-Center/pve-panel/releases/tag/v1.2.0", "assets": []},
            )
        return httpx.Response(200, json={"tag_name": "v1.0.0", "html_url": "https://github.com/PVE-Center/releases", "assets": []})

    pve_http = httpx.AsyncClient(transport=httpx.MockTransport(_pve_handler))
    out_http = httpx.AsyncClient(transport=httpx.MockTransport(_outbound_handler))

    update_manager = UpdateManager(
        config_manager=manager,
        bus=get_realtime_bus(),
        pve_http=pve_http,
        outbound_http=out_http,
        app_version="1.0.0",
    )

    app = FastAPI()
    app.add_middleware(TailscaleSSOMiddleware)
    app.include_router(updates_router.router)
    app.state.update_manager = update_manager

    yield {
        "app": app,
        "client": TestClient(app),
        "manager": update_manager,
        "cfg_dir": cfg_dir,
        "admin_token": admin_tok,
        "op_token": op_tok,
        "viewer_token": viewer_tok,
    }
    reset_config_manager()


def test_docker_target_schema_rejects_traversal():
    with pytest.raises(ValueError):
        DockerUpdateTargetConfig(id="bad", name="Bad", scope="local", compose_dir="../etc")
    with pytest.raises(ValueError):
        DockerUpdateTargetConfig(id="bad2", name="Root", scope="local", compose_dir="/")

    valid_cfg, errors, _ = validate_app_config(
        {
            "version": 1,
            "updates": {
                "enabled": True,
                "docker_targets": [
                    {"id": "ok", "name": "Jellyfin", "scope": "lxc", "vmid": 102, "compose_dir": "/opt/jellyfin"}
                ],
            },
        }
    )
    assert valid_cfg is not None
    assert not errors
    assert valid_cfg.updates.docker_targets[0].compose_dir == "/opt/jellyfin"


def test_updates_setup_info_and_rbac(update_env: dict[str, Any]):
    client: TestClient = update_env["client"]
    admin_hdr = {"Authorization": f"Bearer {update_env['admin_token']}"}
    op_hdr = {"Authorization": f"Bearer {update_env['op_token']}"}
    viewer_hdr = {"Authorization": f"Bearer {update_env['viewer_token']}"}

    # Unauthenticated blocked
    assert client.get("/api/updates/overview").status_code == 401

    # Viewer can read overview, cannot run or inspect SSH key
    assert client.get("/api/updates/overview", headers=viewer_hdr).status_code == 200
    assert client.get("/api/updates/setup-info", headers=viewer_hdr).status_code == 403
    assert client.post("/api/updates/run", json={"target_ids": ["all"]}, headers=viewer_hdr).status_code == 403

    # Operator can trigger /check, cannot run or rotate SSH key
    assert client.post("/api/updates/check", headers=op_hdr).status_code == 200
    assert client.post("/api/updates/run", json={"target_ids": ["all"]}, headers=op_hdr).status_code == 403

    # Admin gets Ed25519 public key (private key saved 0o600 locally and never leaked)
    setup_resp = client.get("/api/updates/setup-info", headers=admin_hdr)
    assert setup_resp.status_code == 200
    payload = setup_resp.json()
    assert payload["ssh_public_key"].startswith("ssh-ed25519 ")
    assert payload["ssh_host"] == "192.168.10.2"
    assert "PRIVATE KEY" not in str(payload)

    priv_path = update_env["cfg_dir"] / "id_ed25519_updates"
    assert priv_path.is_file()
    first_pub = payload["ssh_public_key"]

    rot_resp = client.post("/api/updates/ssh-key/rotate", headers=admin_hdr)
    assert rot_resp.status_code == 200
    assert rot_resp.json()["ssh_public_key"].startswith("ssh-ed25519 ")
    assert rot_resp.json()["ssh_public_key"] != first_pub


def test_update_job_executes_and_orders_panel_self_last(
    update_env: dict[str, Any], monkeypatch: pytest.MonkeyPatch
):
    manager: UpdateManager = update_env["manager"]
    executed_order: list[str] = []

    async def fake_ssh_connect():
        manager._ssh_connected = True
        manager._ssh_message = "Connecté (mock)"
        return True, "Connecté (mock)"

    async def fake_exec(target: dict[str, Any], *, autoremove: bool = True):
        executed_order.append(target["id"])
        return True, f"Updated {target['id']}"

    async def fake_run_local(args: list[str], **_kwargs):
        return 0, ""

    monkeypatch.setattr(manager, "check_ssh_connectivity", fake_ssh_connect)
    monkeypatch.setattr(manager, "_execute_single_target", fake_exec)
    monkeypatch.setattr(manager, "_run_local_cmd", fake_run_local)

    async def _exercise():
        overview = await manager.check_updates(refresh_remote=True)
        target_ids = [t["id"] for t in overview["targets"]]
        assert "panel:server" in target_ids
        assert "proxmox:pve1" in target_ids
        assert "lxc:102" in target_ids
        assert "lxc:116" not in target_ids  # panel_self_vmid excluded from generic LXC list
        assert "docker:media" in target_ids

        job = await manager.start_update_job(
            target_ids=["all"], include_panel_self=True, autoremove=True
        )
        assert job["status"] == "running"
        assert manager._job_task is not None
        await manager._job_task

        assert executed_order[-1] == "panel:server"
        assert "proxmox:pve1" in executed_order
        assert "lxc:102" in executed_order
        assert "docker:media" in executed_order
        assert manager.get_jobs_status()["active_job"]["status"] == "succeeded"

    asyncio.run(_exercise())
