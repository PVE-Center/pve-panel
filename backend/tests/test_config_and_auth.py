"""Tests for declarative config.yaml, ConfigManager, RealtimeBus, DualAuth, and onboarding."""

from __future__ import annotations

import asyncio
import errno
import json
import os
from pathlib import Path
import sys
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
import httpx
import pytest
import yaml

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import (  # noqa: E402
    Settings,
    _write_text_safe,
    get_settings,
    is_configured,
    load_services_config,
    load_storage_mounts_config,
    reload_settings,
    save_services_yaml,
    update_env_file,
)
from app.config_manager import (  # noqa: E402
    get_config_manager,
    hash_pin,
    hash_token,
    reset_config_manager,
)
from app.config_schema import MASKED_SECRET_SENTINEL, validate_app_config  # noqa: E402
from app.middleware.tailscale_auth import TailscaleSSOMiddleware  # noqa: E402
from app.routers import auth as auth_router  # noqa: E402
from app.routers import config_yaml as config_yaml_router  # noqa: E402
from app.routers import setup as setup_router  # noqa: E402
from app.services.realtime_bus import get_realtime_bus  # noqa: E402


def _build_test_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(TailscaleSSOMiddleware)
    app.include_router(auth_router.router)
    app.include_router(setup_router.router)
    app.include_router(config_yaml_router.router)

    @app.get("/api/protected-ping")
    async def protected_ping(request: Request) -> dict[str, Any]:
        return {"ok": True, "user": getattr(request.state, "user", None)}

    @app.get("/api/pairing/test-probe")
    async def pairing_probe() -> dict[str, str]:
        return {"pairing": "public"}

    @app.get("/assets/app.js")
    async def assets_probe() -> JSONResponse:
        return JSONResponse({"asset": True})

    @app.get("/")
    async def spa_root() -> JSONResponse:
        return JSONResponse({"spa": True})

    return app


@pytest.fixture()
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Isolate CONFIG_PATH, STATE_DB_PATH, ENV_FILE_PATH, and SERVICES_CONFIG_PATH per test."""
    cfg_dir = tmp_path / "config"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    cfg_path = cfg_dir / "config.yaml"
    db_path = cfg_dir / "state.db"
    env_path = tmp_path / ".env"
    services_path = tmp_path / "services.yaml"

    monkeypatch.setenv("CONFIG_PATH", str(cfg_path))
    monkeypatch.setenv("STATE_DB_PATH", str(db_path))
    monkeypatch.setenv("ENV_FILE_PATH", str(env_path))
    monkeypatch.setenv("SERVICES_CONFIG_PATH", str(services_path))

    # Clear process env variables that could bleed from host shell
    for var in (
        "PVE_HOST",
        "PVE_NODE",
        "PVE_TOKEN_ID",
        "PVE_TOKEN_SECRET",
        "MERGERFS_POOL_SUBPATH",
        "DEV_AUTH_BYPASS",
        "ALLOWED_TAILSCALE_USERS",
        "TAILSCALE_SSO_ENABLED",
        "SESSION_SECRET",
    ):
        monkeypatch.delenv(var, raising=False)

    reset_config_manager()
    get_settings.cache_clear()
    yield {
        "tmp_path": tmp_path,
        "config_path": cfg_path,
        "db_path": db_path,
        "env_path": env_path,
        "services_path": services_path,
    }
    reset_config_manager()
    get_settings.cache_clear()


async def _asgi_request(
    app: FastAPI,
    method: str,
    path: str,
    *,
    client: tuple[str, int] = ("192.168.1.42", 51234),
    headers: dict[str, str] | None = None,
    json_body: Any = None,
) -> httpx.Response:
    transport = httpx.ASGITransport(app=app, client=client)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
        return await ac.request(method, path, headers=headers, json=json_body)


def test_config_example_yaml_is_valid() -> None:
    example_path = REPO_ROOT / "config" / "config.example.yaml"
    assert example_path.is_file()
    raw_text = example_path.read_text(encoding="utf-8")
    parsed = yaml.safe_load(raw_text)
    assert isinstance(parsed, dict)
    assert parsed["version"] == 1
    assert parsed["notifications"]["apns"]["bundle_id"] == "io.ac.pvepanel.app"
    assert parsed["server"]["mdns_service_type"] == "_pvecenter._tcp.local."
    cfg, errors, _warnings = validate_app_config(parsed)
    assert errors == []
    assert cfg is not None
    assert cfg.proxmox.mergerfs_pool_subpath == ""
    assert len(cfg.custom_services) >= 1
    assert len(cfg.notifications.webhooks) >= 1


def test_auto_migration_from_legacy_env_and_services_yaml(isolated_env) -> None:
    env_path: Path = isolated_env["env_path"]
    services_path: Path = isolated_env["services_path"]
    cfg_path: Path = isolated_env["config_path"]

    env_path.write_text(
        "PVE_HOST=https://10.0.0.10:8006\n"
        "PVE_NODE=pve-lab\n"
        "PVE_TOKEN_ID=root@pam!panel\n"
        "PVE_TOKEN_SECRET=legacy-secret-123\n"
        "ALLOWED_TAILSCALE_USERS=alice@example.com, bob@example.com\n"
        "JELLYFIN_URL=http://10.0.0.20:8096\n"
        "JELLYFIN_API_KEY=jf-key-456\n",
        encoding="utf-8",
    )
    services_path.write_text(
        yaml.safe_dump(
            {
                "categories": [
                    {
                        "name": "Médias",
                        "services": [
                            {
                                "id": "jellyfin",
                                "name": "Jellyfin",
                                "url": "http://10.0.0.20:8096",
                                "ping_url": "http://10.0.0.20:8096/health",
                            }
                        ],
                    }
                ],
                "storage_mounts": [
                    {
                        "mount": "/mnt/data1",
                        "subpath": "data1",
                        "wwn": "0x50001",
                        "label": "Data 1",
                    }
                ],
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    manager = get_config_manager()
    assert manager.is_synthesized is True
    assert manager.config_exists is False
    assert not cfg_path.exists()  # Never writes config.yaml implicitly!

    settings = get_settings()
    assert settings.pve_host == "https://10.0.0.10:8006"
    assert settings.pve_node == "pve-lab"
    assert settings.pve_token_secret == "legacy-secret-123"
    assert settings.allowed_users_set == {"alice@example.com", "bob@example.com"}
    assert is_configured() is True
    assert is_configured(Settings(pve_host="https://10.0.0.10:8006", pve_token_secret="")) is False

    cats = load_services_config()
    assert len(cats) == 1
    assert cats[0]["services"][0]["id"] == "jellyfin"
    mounts = load_storage_mounts_config()
    assert len(mounts) == 1
    assert mounts[0]["subpath"] == "data1"


def test_env_interpolation_and_template_preservation_on_save(
    isolated_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    cfg_path: Path = isolated_env["config_path"]
    env_path: Path = isolated_env["env_path"]

    env_path.write_text("PVE_TOKEN_SECRET=from-dotenv-secret\n", encoding="utf-8")
    monkeypatch.setenv("JF_API_SECRET", "from-os-environ")
    monkeypatch.setenv("TG_BOT_TOK", "bot123:xyz")

    cfg_path.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "server": {"id": "srv-1", "name": "Lab"},
                "proxmox": {
                    "host": "https://192.168.1.10:8006",
                    "token_id": "root@pam!panel",
                    "token_secret": "${PVE_TOKEN_SECRET}",
                    "default_node": "pve",
                },
                "integrations": {
                    "jellyfin": {"url": "http://192.168.1.26:8096", "api_key": "${JF_API_SECRET}"}
                },
                "notifications": {
                    "webhooks": [
                        {
                            "id": "tg-1",
                            "name": "TG",
                            "type": "telegram",
                            "enabled": True,
                            "bot_token": "${TG_BOT_TOK}",
                            "chat_id": "999",
                        }
                    ]
                },
                "custom_services": [
                    {
                        "id": "svc-1",
                        "name": "Custom",
                        "protocol": "http_rest",
                        "url": "http://192.168.1.99",
                        "auth_type": "bearer",
                        "auth_token": "${CUSTOM_SVC_TOK:-fallback-tok}",
                    }
                ],
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    manager = get_config_manager()
    assert manager.config_exists is True
    assert manager.config.proxmox.token_secret == "from-dotenv-secret"
    assert manager.config.integrations.jellyfin.api_key == "from-os-environ"
    assert manager.config.notifications.webhooks[0].bot_token == "bot123:xyz"
    assert manager.config.custom_services[0].auth_token == "fallback-tok"

    # Mutate non-secret fields and pass empty/masked/unchanged secrets -> placeholders MUST survive!
    updated_dict = manager.config.model_dump()
    updated_dict["proxmox"]["default_node"] = "pve2"
    updated_dict["proxmox"]["token_secret"] = ""  # Empty must not overwrite
    updated_dict["integrations"]["jellyfin"]["api_key"] = MASKED_SECRET_SENTINEL
    # Leave bot_token unchanged resolved value -> placeholder must stay ${TG_BOT_TOK}
    manager.save_config(updated_dict)

    raw_on_disk = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
    assert raw_on_disk["proxmox"]["default_node"] == "pve2"
    assert raw_on_disk["proxmox"]["token_secret"] == "${PVE_TOKEN_SECRET}"
    assert raw_on_disk["integrations"]["jellyfin"]["api_key"] == "${JF_API_SECRET}"
    assert raw_on_disk["notifications"]["webhooks"][0]["bot_token"] == "${TG_BOT_TOK}"
    assert raw_on_disk["custom_services"][0]["auth_token"] == "${CUSTOM_SVC_TOK:-fallback-tok}"

    # Passing a brand-new secret should replace it cleanly
    updated_dict2 = manager.config.model_dump()
    updated_dict2["proxmox"]["token_secret"] = "brand-new-secret-value"
    manager.save_config(updated_dict2)
    raw_on_disk2 = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
    assert raw_on_disk2["proxmox"]["token_secret"] == "brand-new-secret-value"
    assert manager.config.proxmox.token_secret == "brand-new-secret-value"


def test_write_text_safe_ebusy_fallback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "mounted.yaml"
    target.write_text("old: 1\n", encoding="utf-8")

    def _raise_ebusy(*_args, **_kwargs):
        raise OSError(errno.EBUSY, "Device or resource busy")

    monkeypatch.setattr(os, "replace", _raise_ebusy)
    _write_text_safe(target, "new: 2\n")
    assert target.read_text(encoding="utf-8") == "new: 2\n"


@pytest.mark.asyncio
async def test_watchfiles_hot_reload_and_realtime_bus(isolated_env) -> None:
    cfg_path: Path = isolated_env["config_path"]
    cfg_path.write_text(
        yaml.safe_dump({"version": 1, "server": {"name": "Initial"}}),
        encoding="utf-8",
    )

    bus = get_realtime_bus()
    await bus.start()
    manager = get_config_manager()

    reloaded_names: list[str] = []
    unsub = manager.on_reload(lambda cfg: reloaded_names.append(cfg.server.name))
    await manager.start_watcher()
    try:
        async with bus.subscribe() as queue:
            await asyncio.sleep(0.2)
            cfg_path.write_text(
                yaml.safe_dump({"version": 1, "server": {"name": "HotReloaded"}}),
                encoding="utf-8",
            )
            event = await asyncio.wait_for(queue.get(), timeout=4.0)
            assert event is not None
            assert event["type"] == "config_reloaded"
            assert "timestamp" in event
            assert event["payload"]["source"] == "watchfiles"
            assert "HotReloaded" in reloaded_names
            assert get_settings().pve_host == ""
            assert manager.config.server.name == "HotReloaded"
    finally:
        unsub()
        await manager.stop_watcher()
        await bus.stop()


@pytest.mark.asyncio
async def test_onboarding_and_setup_lockdown_plus_dual_auth(isolated_env) -> None:
    app = _build_test_app()
    cfg_path: Path = isolated_env["config_path"]

    # 1. Unconfigured initial state
    assert is_configured() is False

    r_health = await _asgi_request(app, "GET", "/api/health")
    assert r_health.status_code == 200
    assert r_health.json()["is_configured"] is False

    r_onb = await _asgi_request(app, "GET", "/api/onboarding/status")
    assert r_onb.status_code == 200
    assert r_onb.json()["needs_onboarding"] is True

    r_setup = await _asgi_request(app, "GET", "/api/setup/status")
    assert r_setup.status_code == 200  # Exempt only before configuration!

    # Protected APIs still reject unauthenticated calls during first run
    r_prot = await _asgi_request(app, "GET", "/api/protected-ping")
    assert r_prot.status_code == 401

    # Public exemptions work
    assert (await _asgi_request(app, "GET", "/")).status_code == 200
    assert (await _asgi_request(app, "GET", "/assets/app.js")).status_code == 200
    assert (await _asgi_request(app, "GET", "/api/pairing/test-probe")).status_code == 200

    # 2. Run onboarding/init
    init_res = await _asgi_request(
        app,
        "POST",
        "/api/onboarding/init",
        json_body={
            "server_name": "Home Node",
            "tailscale_sso_enabled": True,
            "allowed_tailscale_users": ["admin@example.com"],
            "admin_pin": "2580",
            "proxmox": {
                "host": "https://192.168.1.10:8006",
                "token_id": "root@pam!panel",
                "token_secret": "pve-secret-xyz",
                "default_node": "pve",
            },
            "custom_services": [
                {
                    "id": "ping-router",
                    "name": "Router",
                    "protocol": "icmp_ping",
                    "host": "192.168.1.1",
                }
            ],
        },
    )
    assert init_res.status_code == 200, init_res.text
    init_data = init_res.json()
    assert init_data["ok"] is True
    assert init_data["is_configured"] is True
    api_token = init_data["api_token"]
    assert api_token.startswith("pve_")
    assert cfg_path.is_file()

    # Plaintext token must NOT be stored in config.yaml
    disk_yaml = cfg_path.read_text(encoding="utf-8")
    assert api_token not in disk_yaml
    assert hash_token(api_token) in disk_yaml

    # 3. Once configured, /api/setup/* and POST /api/onboarding/init require auth!
    assert (await _asgi_request(app, "GET", "/api/setup/status")).status_code == 401
    assert (
        await _asgi_request(app, "PUT", "/api/setup/config", json_body={"env": {"PVE_NODE": "pve2"}})
    ).status_code == 401
    assert (
        await _asgi_request(app, "POST", "/api/onboarding/init", json_body={"server_name": "Hack"})
    ).status_code == 401

    # 4. Spoofing Tailscale header from non-loopback IP MUST fail with 401
    r_spoof = await _asgi_request(
        app,
        "GET",
        "/api/protected-ping",
        client=("192.168.1.88", 40000),
        headers={"Tailscale-User-Login": "admin@example.com"},
    )
    assert r_spoof.status_code == 401

    # 5. Valid Bearer API token works on LAN
    r_bearer = await _asgi_request(
        app,
        "GET",
        "/api/setup/status",
        client=("192.168.1.88", 40000),
        headers={"Authorization": f"Bearer {api_token}"},
    )
    assert r_bearer.status_code == 200
    assert r_bearer.json()["is_configured"] is True

    # 6. PIN login returns HMAC session JWT usable on LAN
    r_bad_pin = await _asgi_request(
        app, "POST", "/api/auth/login", json_body={"pin": "0000"}
    )
    assert r_bad_pin.status_code == 401

    r_login = await _asgi_request(
        app, "POST", "/api/auth/login", json_body={"pin": "2580"}
    )
    assert r_login.status_code == 200
    session_token = r_login.json()["access_token"]
    assert session_token

    r_sess = await _asgi_request(
        app,
        "GET",
        "/api/protected-ping",
        client=("192.168.1.88", 40000),
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert r_sess.status_code == 200
    assert r_sess.json()["user"]["auth_mode"] == "session"

    # 7. Loopback Tailscale SSO checks allowlist
    r_ts_ok = await _asgi_request(
        app,
        "GET",
        "/api/protected-ping",
        client=("127.0.0.1", 40000),
        headers={"Tailscale-User-Login": "admin@example.com"},
    )
    assert r_ts_ok.status_code == 200
    assert r_ts_ok.json()["user"]["auth_mode"] == "tailscale_serve"

    r_ts_denied = await _asgi_request(
        app,
        "GET",
        "/api/protected-ping",
        client=("127.0.0.1", 40000),
        headers={"Tailscale-User-Login": "stranger@example.com"},
    )
    assert r_ts_denied.status_code == 403

    r_loopback_noauth = await _asgi_request(
        app, "GET", "/api/protected-ping", client=("127.0.0.1", 40000)
    )
    assert r_loopback_noauth.status_code == 401


@pytest.mark.asyncio
async def test_dev_auth_bypass_loopback_only_and_token_crud(isolated_env) -> None:
    app = _build_test_app()
    cfg_path: Path = isolated_env["config_path"]
    tok_plain = "pve_seed_token_12345"
    cfg_path.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "security": {
                    "tailscale_sso_enabled": False,
                    "dev_auth_bypass": True,
                    "session_secret": "test-session-secret-32-bytes-long",
                    "admin_pin_hash": hash_pin("1234"),
                    "api_tokens": [
                        {
                            "id": "tok-1",
                            "name": "Seed",
                            "token_hash": hash_token(tok_plain),
                            "role": "admin",
                            "created_at": "2026-11-16T00:00:00Z",
                        }
                    ],
                },
            }
        ),
        encoding="utf-8",
    )
    get_config_manager().reload(emit_event=False)

    # Loopback bypass works
    r_local = await _asgi_request(app, "GET", "/api/protected-ping", client=("127.0.0.1", 1234))
    assert r_local.status_code == 200
    assert r_local.json()["user"]["auth_mode"] == "dev_bypass"

    # Non-loopback STILL blocked even with dev_auth_bypass=True!
    r_lan = await _asgi_request(app, "GET", "/api/protected-ping", client=("192.168.1.99", 1234))
    assert r_lan.status_code == 401

    # Create, list, use, revoke token
    headers = {"Authorization": f"Bearer {tok_plain}"}
    r_create = await _asgi_request(
        app,
        "POST",
        "/api/auth/tokens",
        headers=headers,
        json_body={"name": "iPhone Pro", "role": "admin"},
    )
    assert r_create.status_code == 200
    new_tok = r_create.json()["token"]
    new_id = r_create.json()["token_info"]["id"]

    r_list = await _asgi_request(app, "GET", "/api/auth/tokens", headers=headers)
    assert r_list.status_code == 200
    assert all("token_hash" not in item for item in r_list.json()["tokens"])
    assert len(r_list.json()["tokens"]) == 2

    assert (
        await _asgi_request(
            app, "GET", "/api/protected-ping", headers={"Authorization": f"Bearer {new_tok}"}
        )
    ).status_code == 200

    assert (
        await _asgi_request(app, "DELETE", f"/api/auth/tokens/{new_id}", headers=headers)
    ).status_code == 200
    assert (
        await _asgi_request(
            app, "GET", "/api/protected-ping", headers={"Authorization": f"Bearer {new_tok}"}
        )
    ).status_code == 401

    # Rotate PIN
    assert (
        await _asgi_request(app, "PUT", "/api/auth/pin", headers=headers, json_body={"pin": "9876"})
    ).status_code == 200
    assert (await _asgi_request(app, "POST", "/api/auth/login", json_body={"pin": "1234"})).status_code == 401
    assert (await _asgi_request(app, "POST", "/api/auth/login", json_body={"pin": "9876"})).status_code == 200


@pytest.mark.asyncio
async def test_yaml_endpoints_and_setup_preserve_secrets(isolated_env) -> None:
    app = _build_test_app()
    cfg_path: Path = isolated_env["config_path"]
    tok = "pve_admin_yaml_tok"
    cfg_path.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "server": {"id": "srv-yaml", "name": "YAML Node"},
                "security": {
                    "api_tokens": [
                        {
                            "id": "adm-1",
                            "name": "Admin",
                            "token_hash": hash_token(tok),
                            "role": "admin",
                            "created_at": "2026-11-16T00:00:00Z",
                        }
                    ]
                },
                "proxmox": {
                    "host": "https://192.168.1.10:8006",
                    "token_id": "root@pam!panel",
                    "token_secret": "super-literal-secret",
                    "default_node": "pve",
                },
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    get_config_manager().reload(emit_event=False)
    headers = {"Authorization": f"Bearer {tok}"}

    # GET /api/config/yaml masks secrets
    r_get = await _asgi_request(app, "GET", "/api/config/yaml", headers=headers)
    assert r_get.status_code == 200
    body = r_get.json()
    assert "super-literal-secret" not in body["yaml"]
    assert MASKED_SECRET_SENTINEL in body["yaml"]
    assert body["parsed_summary"]["server_id"] == "srv-yaml"

    # POST /api/config/validate catches duplicate service IDs without saving
    bad_yaml = yaml.safe_dump(
        {
            "version": 1,
            "custom_services": [
                {"id": "dup", "name": "A", "protocol": "icmp_ping", "host": "1.1.1.1"},
                {"id": "dup", "name": "B", "protocol": "icmp_ping", "host": "8.8.8.8"},
            ],
        }
    )
    r_val_bad = await _asgi_request(
        app, "POST", "/api/config/validate", headers=headers, json_body={"yaml": bad_yaml}
    )
    assert r_val_bad.status_code == 200
    assert r_val_bad.json()["valid"] is False
    assert any("Duplicate custom service id" in e for e in r_val_bad.json()["errors"])

    # PUT /api/config/yaml with masked secret preserves underlying secret!
    edited_yaml = body["yaml"].replace("YAML Node", "YAML Node Updated")
    r_put = await _asgi_request(
        app, "PUT", "/api/config/yaml", headers=headers, json_body={"yaml": edited_yaml}
    )
    assert r_put.status_code == 200
    assert get_config_manager().config.server.name == "YAML Node Updated"
    assert get_config_manager().config.proxmox.token_secret == "super-literal-secret"

    # PUT /api/setup/config preserves secret when empty ""
    r_setup_put = await _asgi_request(
        app,
        "PUT",
        "/api/setup/config",
        headers=headers,
        json_body={"env": {"PVE_NODE": "pve-updated", "PVE_TOKEN_SECRET": ""}},
    )
    assert r_setup_put.status_code == 200
    assert get_settings().pve_node == "pve-updated"
    assert get_settings().pve_token_secret == "super-literal-secret"

    # GET /api/config/export returns YAML download without raw secret
    r_exp = await _asgi_request(app, "GET", "/api/config/export", headers=headers)
    assert r_exp.status_code == 200
    assert "attachment" in r_exp.headers.get("content-disposition", "")
    assert "super-literal-secret" not in r_exp.text


def test_websocket_ping_pong_events_and_auth(
    isolated_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    cfg_path: Path = isolated_env["config_path"]
    tok = "pve_ws_token_abc"
    cfg_path.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "security": {
                    "api_tokens": [
                        {
                            "id": "ws-1",
                            "name": "AppleTV",
                            "token_hash": hash_token(tok),
                            "role": "admin",
                            "created_at": "2026-11-16T00:00:00Z",
                        }
                    ]
                },
            }
        ),
        encoding="utf-8",
    )
    get_config_manager().reload(emit_event=False)
    monkeypatch.setattr(config_yaml_router, "WS_PING_INTERVAL_SECONDS", 0.05)

    app = _build_test_app()
    with TestClient(app) as client:
        # Unauthenticated WS rejected
        with pytest.raises(Exception):
            with client.websocket_connect("/api/ws/events"):
                pass

        # Authenticated WS via ?token= receives ping, accepts pong, receives published events
        with client.websocket_connect(f"/api/ws/events?token={tok}") as ws:
            ping_msg = ws.receive_json()
            assert ping_msg["type"] == "ping"
            assert "timestamp" in ping_msg
            ws.send_text(json.dumps({"type": "pong"}))

            get_realtime_bus().publish_nowait(
                "alert_triggered", {"service_id": "jellyfin", "status": "down"}
            )
            evt = ws.receive_json()
            # In case a second ping raced just before publish_nowait, read next if ping
            if evt["type"] == "ping":
                evt = ws.receive_json()
            assert evt["type"] == "alert_triggered"
            assert evt["payload"] == {"service_id": "jellyfin", "status": "down"}


def test_sse_stream_receives_events(isolated_env) -> None:
    import threading
    import time

    cfg_path: Path = isolated_env["config_path"]
    tok = "pve_sse_token_abc"
    cfg_path.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "security": {
                    "api_tokens": [
                        {
                            "id": "sse-1",
                            "name": "Web",
                            "token_hash": hash_token(tok),
                            "role": "admin",
                            "created_at": "2026-11-16T00:00:00Z",
                        }
                    ]
                },
            }
        ),
        encoding="utf-8",
    )
    get_config_manager().reload(emit_event=False)
    app = _build_test_app()
    bus = get_realtime_bus()

    def _publisher() -> None:
        deadline = time.monotonic() + 3.0
        while bus.subscriber_count() == 0 and time.monotonic() < deadline:
            time.sleep(0.02)
        bus.publish_nowait(
            "service_status_changed", {"service_id": "radarr", "status": "up"}
        )
        time.sleep(0.05)
        bus.stop_nowait()

    thread = threading.Thread(target=_publisher, daemon=True)
    with TestClient(app) as client:
        thread.start()
        with client.stream("GET", f"/api/events/stream?token={tok}") as resp:
            assert resp.status_code == 200
            lines = [line for line in resp.iter_lines() if line]
        thread.join(timeout=2.0)

    assert lines[0] == ": connected"
    data_lines = [ln for ln in lines if ln.startswith("data: ")]
    assert len(data_lines) == 1
    parsed = json.loads(data_lines[0][6:])
    assert parsed["type"] == "service_status_changed"
    assert parsed["payload"] == {"service_id": "radarr", "status": "up"}


def test_legacy_update_env_and_save_services_yaml(isolated_env) -> None:
    env_path: Path = isolated_env["env_path"]
    services_path: Path = isolated_env["services_path"]
    env_path.write_text("# comment\nPVE_HOST=https://old:8006\nPVE_TOKEN_SECRET=keep-me\n", encoding="utf-8")

    update_env_file({"PVE_HOST": "https://new:8006", "PVE_TOKEN_SECRET": ""})
    content = env_path.read_text(encoding="utf-8")
    assert "# comment" in content
    assert "PVE_HOST=https://new:8006" in content
    assert "PVE_TOKEN_SECRET=keep-me" in content

    save_services_yaml(
        categories=[
            {
                "name": "Apps",
                "services": [
                    {
                        "id": "svc",
                        "name": "Svc",
                        "url": "http://127.0.0.1",
                        "online": True,  # transient key must be stripped
                    }
                ],
            }
        ],
        storage_mounts=[{"subpath": "disk1", "label": "Disk 1"}],
    )
    assert services_path.is_file()
    raw_svc = yaml.safe_load(services_path.read_text(encoding="utf-8"))
    assert "online" not in raw_svc["categories"][0]["services"][0]
    assert raw_svc["storage_mounts"][0]["mount"] == "/mnt/disk1"

    reloaded = reload_settings()
    assert reloaded.pve_host == "https://new:8006"


def test_spa_html_has_no_store_cache_headers(tmp_path: Path) -> None:
    from app.main import _serve_spa_file

    index_html = tmp_path / "index.html"
    index_html.write_text("<html><body>ok</body></html>", encoding="utf-8")
    js_bundle = tmp_path / "app-abc123.js"
    js_bundle.write_text("console.log('ok');", encoding="utf-8")

    html_resp = _serve_spa_file(index_html)
    assert html_resp.headers["cache-control"] == "no-store, no-cache, must-revalidate, max-age=0"
    assert html_resp.headers["pragma"] == "no-cache"
    assert html_resp.headers["expires"] == "0"

    asset_resp = _serve_spa_file(js_bundle)
    assert "cache-control" not in asset_resp.headers


def test_category_service_crud_and_move_in_legacy_services_yaml(isolated_env) -> None:
    from app.routers import services as services_router

    env_path: Path = isolated_env["env_path"]
    services_path: Path = isolated_env["services_path"]
    env_path.write_text(
        f"SESSION_SECRET=test-session-secret-legacy-32-bytes-minimum\nADMIN_PIN_HASH={hash_pin('2580')}\n",
        encoding="utf-8",
    )
    services_path.write_text(
        yaml.safe_dump(
            {
                "categories": [
                    {
                        "name": "Infrastructure & Réseau",
                        "services": [
                            {
                                "id": "npm",
                                "name": "Nginx Proxy Manager",
                                "description": "Reverse proxy",
                                "url": "http://192.168.1.20:81",
                                "icon": "Globe",
                            },
                            {
                                "id": "uptime-kuma",
                                "name": "Uptime Kuma",
                                "description": "Monitoring",
                                "url": "http://192.168.1.30:3001",
                                "icon": "Activity",
                            },
                        ],
                    }
                ],
                "storage_mounts": [],
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    get_config_manager().reload(emit_event=False)

    app = _build_test_app()
    app.include_router(services_router.router)
    app.state.media_http = httpx.AsyncClient()
    app.state.state_store = None

    with TestClient(app) as client:
        # Unauthenticated request must be blocked
        unauth = client.put("/api/services/items/npm", json={"name": "Zoraxy"})
        assert unauth.status_code == 401

        login = client.post("/api/auth/login", json={"pin": "2580"})
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        # Update icon, name, url and ping_url in-place
        put_resp = client.put(
            "/api/services/items/npm",
            headers=headers,
            json={
                "name": "Zoraxy",
                "description": "Reverse proxy & Tunnel",
                "icon": "zoraxy",
                "url": "https://zoraxy.example.ts.net",
                "ping_url": "http://192.168.1.117:80",
            },
        )
        assert put_resp.status_code == 200
        assert put_resp.json()["service"]["name"] == "Zoraxy"
        assert put_resp.json()["service"]["icon"] == "zoraxy"

        # Move second item before first
        move_resp = client.post(
            "/api/services/items/uptime-kuma/move",
            headers=headers,
            json={"direction": "up"},
        )
        assert move_resp.status_code == 200

        raw = yaml.safe_load(services_path.read_text(encoding="utf-8"))
        ids = [s["id"] for s in raw["categories"][0]["services"]]
        assert ids == ["uptime-kuma", "npm"]
        assert raw["categories"][0]["services"][1]["icon"] == "zoraxy"

        # Move item to a new category
        cat_move_resp = client.put(
            "/api/services/items/npm",
            headers=headers,
            json={"category": "Proxy & Tunnels"},
        )
        assert cat_move_resp.status_code == 200
        raw2 = yaml.safe_load(services_path.read_text(encoding="utf-8"))
        assert len(raw2["categories"]) == 2
        assert raw2["categories"][1]["name"] == "Proxy & Tunnels"
        assert raw2["categories"][1]["services"][0]["id"] == "npm"

        # Delete item prunes empty category
        del_resp = client.delete("/api/services/items/npm", headers=headers)
        assert del_resp.status_code == 200
        raw3 = yaml.safe_load(services_path.read_text(encoding="utf-8"))
        assert len(raw3["categories"]) == 1
        assert [s["id"] for s in raw3["categories"][0]["services"]] == ["uptime-kuma"]


@pytest.mark.asyncio
async def test_rbac_scoping_enforced_across_roles(isolated_env) -> None:
    from app.routers import proxmox as proxmox_router

    cfg_path: Path = isolated_env["config_path"]
    adm_tok = "pve_adm_role_tok"
    op_tok = "pve_op_role_tok"
    view_tok = "pve_view_role_tok"
    cfg_path.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "security": {
                    "tailscale_sso_enabled": False,
                    "api_tokens": [
                        {"id": "r-adm", "name": "Admin", "token_hash": hash_token(adm_tok), "role": "admin"},
                        {"id": "r-op", "name": "Operator", "token_hash": hash_token(op_tok), "role": "operator"},
                        {"id": "r-view", "name": "Viewer", "token_hash": hash_token(view_tok), "role": "viewer"},
                    ],
                },
                "proxmox": {
                    "host": "https://pve.local:8006",
                    "token_id": "root@pam!panel",
                    "token_secret": "sec",
                    "default_node": "pve",
                },
            }
        ),
        encoding="utf-8",
    )
    get_config_manager().reload(emit_event=False)
    get_settings.cache_clear()

    app = _build_test_app()
    app.include_router(proxmox_router.router)

    def _pve_mock(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/status/start"):
            return httpx.Response(200, json={"data": "UPID:pve:0001"})
        if req.url.path.endswith("/api2/json/nodes"):
            return httpx.Response(200, json={"data": [{"node": "pve", "status": "online"}]})
        return httpx.Response(200, json={"data": {}})

    app.state.pve_http = httpx.AsyncClient(transport=httpx.MockTransport(_pve_mock))

    try:
        # Viewer: GET protected OK, POST PVE action blocked (403), GET admin YAML blocked (403)
        h_view = {"Authorization": f"Bearer {view_tok}"}
        assert (await _asgi_request(app, "GET", "/api/pve/nodes", headers=h_view)).status_code == 200
        assert (await _asgi_request(app, "POST", "/api/pve/lxc/101/start", headers=h_view)).status_code == 403
        assert (await _asgi_request(app, "GET", "/api/config/yaml", headers=h_view)).status_code == 403

        # Operator: operational PVE write allowed (200), admin config/token mutation & reads blocked (403)
        h_op = {"Authorization": f"Bearer {op_tok}"}
        assert (await _asgi_request(app, "POST", "/api/pve/lxc/101/start", headers=h_op)).status_code == 200
        assert (await _asgi_request(app, "GET", "/api/auth/tokens", headers=h_op)).status_code == 403
        assert (
            await _asgi_request(app, "PUT", "/api/setup/config", headers=h_op, json_body={"env": {"PVE_NODE": "pve2"}})
        ).status_code == 403

        # Admin: allowed everywhere
        h_adm = {"Authorization": f"Bearer {adm_tok}"}
        assert (await _asgi_request(app, "GET", "/api/config/yaml", headers=h_adm)).status_code == 200
        assert (await _asgi_request(app, "GET", "/api/auth/tokens", headers=h_adm)).status_code == 200
    finally:
        await app.state.pve_http.aclose()


@pytest.mark.asyncio
async def test_multinode_pve_cluster_aggregation_and_failover(isolated_env) -> None:
    from app.routers import proxmox as proxmox_router

    cfg_path: Path = isolated_env["config_path"]
    tok = "pve_cluster_tok"
    cfg_path.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "security": {
                    "api_tokens": [
                        {"id": "c-1", "name": "Cluster", "token_hash": hash_token(tok), "role": "admin"}
                    ]
                },
                "proxmox": {
                    "host": "https://pve.cluster.local:8006",
                    "token_id": "root@pam!panel",
                    "token_secret": "sec",
                    "default_node": "pve1",
                },
            }
        ),
        encoding="utf-8",
    )
    get_config_manager().reload(emit_event=False)
    get_settings.cache_clear()

    node1_online = True

    def _cluster_mock(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path == "/api2/json/nodes":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"node": "pve1", "status": "online" if node1_online else "offline", "cpu": 0.2, "maxcpu": 8, "mem": 4000, "maxmem": 16000, "uptime": 3600},
                        {"node": "pve2", "status": "online", "cpu": 0.4, "maxcpu": 16, "mem": 8000, "maxmem": 32000, "uptime": 7200},
                    ]
                },
            )
        if "/nodes/pve1/" in path and not node1_online:
            return httpx.Response(500, json={"errors": "node offline"})
        if path == "/api2/json/nodes/pve1/status":
            return httpx.Response(200, json={"data": {"cpu": 0.2, "memory": {"used": 4000, "total": 16000}, "uptime": 3600, "cpuinfo": {"cpus": 8}}})
        if path == "/api2/json/nodes/pve2/status":
            return httpx.Response(200, json={"data": {"cpu": 0.4, "memory": {"used": 8000, "total": 32000}, "uptime": 7200, "cpuinfo": {"cpus": 16}}})
        if path == "/api2/json/nodes/pve1/lxc":
            return httpx.Response(200, json={"data": [{"vmid": 101, "name": "ct-web", "status": "running", "cpu": 0.1, "cpus": 2, "mem": 500, "maxmem": 1000}]})
        if path == "/api2/json/nodes/pve2/qemu":
            return httpx.Response(200, json={"data": [{"vmid": 201, "name": "vm-db", "status": "running", "cpu": 0.3, "cpus": 4, "mem": 2000, "maxmem": 4000}]})
        if path.endswith("/storage"):
            return httpx.Response(200, json={"data": [{"storage": "local-lvm", "type": "lvmthin", "active": 1, "used": 100, "total": 1000}]})
        return httpx.Response(200, json={"data": []})

    app = _build_test_app()
    app.include_router(proxmox_router.router)
    app.state.pve_http = httpx.AsyncClient(transport=httpx.MockTransport(_cluster_mock))
    headers = {"Authorization": f"Bearer {tok}"}

    try:
        r_nodes = await _asgi_request(app, "GET", "/api/pve/nodes", headers=headers)
        assert r_nodes.status_code == 200
        assert [n["name"] for n in r_nodes.json()["nodes"]] == ["pve1", "pve2"]

        r_all = await _asgi_request(app, "GET", "/api/pve/overview?node=*", headers=headers)
        assert r_all.status_code == 200
        all_data = r_all.json()
        assert all_data["online"] is True
        assert all_data["counts"]["total"] == 2
        assert {r["node"] for r in all_data["resources"]} == {"pve1", "pve2"}
        assert all_data["node"]["mem_total_bytes"] == 48000

        # Simulate primary pve1 offline -> automatic failover to pve2
        node1_online = False
        r_failover = await _asgi_request(app, "GET", "/api/pve/overview", headers=headers)
        assert r_failover.status_code == 200
        fo = r_failover.json()
        assert fo["failover_active"] is True
        assert fo["selected_node"] == "pve2"
        assert fo["resources"][0]["name"] == "vm-db"
    finally:
        await app.state.pve_http.aclose()


@pytest.mark.asyncio
async def test_prometheus_metrics_endpoints_and_auth(isolated_env) -> None:
    from app.routers import metrics as metrics_router
    from app.services.state_store import StateStore

    cfg_path: Path = isolated_env["config_path"]
    view_tok = "pve_prom_viewer"
    cfg_path.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "security": {
                    "api_tokens": [
                        {"id": "v-1", "name": "Prom", "token_hash": hash_token(view_tok), "role": "viewer"}
                    ]
                },
                "custom_services": [
                    {"id": "dns-1", "name": "AdGuard", "protocol": "icmp_ping", "host": "192.168.1.2"}
                ],
            }
        ),
        encoding="utf-8",
    )
    get_config_manager().reload(emit_event=False)

    store = StateStore(isolated_env["db_path"])
    await store.initialize()
    await store.upsert_service_state(
        "dns-1",
        service_name="AdGuard",
        current_status="up",
        consecutive_failures=0,
        last_check_at="2026-11-18T12:00:00Z",
        last_transition_at=None,
        last_alert_at=None,
        muted_until=None,
        last_error=None,
        last_latency_ms=14,
    )

    app = _build_test_app()
    app.include_router(metrics_router.router)
    app.state.state_store = store

    try:
        assert (await _asgi_request(app, "GET", "/metrics")).status_code == 401
        r_metrics = await _asgi_request(
            app, "GET", "/metrics", headers={"Authorization": f"Bearer {view_tok}"}
        )
        assert r_metrics.status_code == 200
        assert "pve_center_up 1" in r_metrics.text
        assert 'pve_custom_service_up{service_id="dns-1",protocol="icmp_ping"} 1' in r_metrics.text
        assert 'pve_custom_service_latency_ms{service_id="dns-1",protocol="icmp_ping"} 14' in r_metrics.text
        assert "pve_incidents_active_total 0" in r_metrics.text

        r_api = await _asgi_request(
            app, "GET", "/api/metrics/prometheus", headers={"Authorization": f"Bearer {view_tok}"}
        )
        assert r_api.status_code == 200
        assert "pve_center_up 1" in r_api.text
    finally:
        await store.close()


def test_mergerfs_pool_subpath_config_and_autodetect(
    isolated_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services import pve_client
    from app.services.pve_client import ProxmoxClient

    tmp_path: Path = isolated_env["tmp_path"]
    cfg_path: Path = isolated_env["config_path"]
    env_path: Path = isolated_env["env_path"]

    host_mnt = tmp_path / "host_mnt"
    host_mnt.mkdir()
    monkeypatch.setattr(pve_client, "HOST_MNT_ROOT", host_mnt)
    monkeypatch.setattr(pve_client, "PROC_MOUNTS_PATH", tmp_path / "no_proc_mounts")

    # 1. Disks only (no MergerFS pool directory) -> available=False and all disks returned
    (host_mnt / "disk1").mkdir()
    (host_mnt / "disk2").mkdir()
    ext_disks_only = ProxmoxClient._build_external_storage([])
    assert ext_disks_only["pool"]["available"] is False
    assert ext_disks_only["pool"]["mount"] == ""
    assert ext_disks_only["pool"]["drives_count"] == 2
    assert [d["mount"] for d in ext_disks_only["drives"]] == ["/mnt/disk1", "/mnt/disk2"]

    # 2. Auto-detect generic pool name ("pool") and exclude it from physical drives
    (host_mnt / "pool").mkdir()
    ext_pool = ProxmoxClient._build_external_storage([])
    assert ext_pool["pool"]["available"] is True
    assert ext_pool["pool"]["mount"] == "/mnt/pool"
    assert ext_pool["pool"]["drives_count"] == 2
    assert [d["mount"] for d in ext_pool["drives"]] == ["/mnt/disk1", "/mnt/disk2"]

    # 3. Auto-detect arbitrary non-disk directory when no common pool name exists
    (host_mnt / "pool").rmdir()
    (host_mnt / "media_vault").mkdir()
    ext_non_disk = ProxmoxClient._build_external_storage([])
    assert ext_non_disk["pool"]["available"] is True
    assert ext_non_disk["pool"]["mount"] == "/mnt/media_vault"
    assert [d["mount"] for d in ext_non_disk["drives"]] == ["/mnt/disk1", "/mnt/disk2"]

    # 4. /proc/mounts fuse.mergerfs detection takes priority over directory guessing
    (host_mnt / "proc_array").mkdir()
    fake_proc_mounts = tmp_path / "proc_mounts"
    fake_proc_mounts.write_text(
        f"disk1:disk2 {host_mnt / 'proc_array'} fuse.mergerfs rw,relatime 0 0\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(pve_client, "PROC_MOUNTS_PATH", fake_proc_mounts)
    ext_proc = ProxmoxClient._build_external_storage([])
    assert ext_proc["pool"]["available"] is True
    assert ext_proc["pool"]["mount"] == "/mnt/proc_array"
    assert [d["mount"] for d in ext_proc["drives"]] == [
        "/mnt/disk1",
        "/mnt/disk2",
        "/mnt/media_vault",
    ]

    # 5. MERGERFS_POOL_SUBPATH in .env (synthesized mode) overrides auto-detection
    (host_mnt / "custom_env_pool").mkdir()
    env_path.write_text("MERGERFS_POOL_SUBPATH=/custom_env_pool/\n", encoding="utf-8")
    reload_settings()
    assert get_settings().mergerfs_pool_subpath == "custom_env_pool"
    ext_env = ProxmoxClient._build_external_storage([])
    assert ext_env["pool"]["available"] is True
    assert ext_env["pool"]["mount"] == "/mnt/custom_env_pool"
    assert "/mnt/custom_env_pool" not in [d["mount"] for d in ext_env["drives"]]

    # 6. Declarative config.yaml proxmox.mergerfs_pool_subpath + traversal sanitization
    (host_mnt / "yaml_pool").mkdir()
    cfg_path.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "proxmox": {
                    "host": "https://pve.local:8006",
                    "mergerfs_pool_subpath": "/yaml_pool/",
                },
            }
        ),
        encoding="utf-8",
    )
    reload_settings()
    assert get_settings().mergerfs_pool_subpath == "yaml_pool"
    ext_yaml = ProxmoxClient._build_external_storage([])
    assert ext_yaml["pool"]["available"] is True
    assert ext_yaml["pool"]["mount"] == "/mnt/yaml_pool"
    assert "/mnt/yaml_pool" not in [d["mount"] for d in ext_yaml["drives"]]

    # Traversal attempt normalizes to empty string
    cfg_ok, errs, _ = validate_app_config(
        {"version": 1, "proxmox": {"mergerfs_pool_subpath": "../etc/passwd"}}
    )
    assert errs == []
    assert cfg_ok is not None
    assert cfg_ok.proxmox.mergerfs_pool_subpath == ""



