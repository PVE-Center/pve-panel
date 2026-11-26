"""Tests for Stremio integration schema, secret masking, widget metrics, and setup probes."""

from __future__ import annotations

import base64
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

from app.config import get_settings, reload_settings  # noqa: E402
from app.config_manager import get_config_manager, reset_config_manager  # noqa: E402
from app.config_schema import MASKED_SECRET_SENTINEL, validate_app_config  # noqa: E402
from app.routers import setup as setup_router  # noqa: E402
from app.routers import widgets as widgets_router  # noqa: E402
from app.services.media_clients import fetch_stremio_widget  # noqa: E402


@pytest.fixture()
def stremio_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
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

    for var in ("STREMIO_URL", "STREMIO_USERNAME", "STREMIO_PASSWORD"):
        monkeypatch.delenv(var, raising=False)

    reset_config_manager()
    get_settings.cache_clear()
    yield cfg_path
    reset_config_manager()
    get_settings.cache_clear()


def test_stremio_schema_and_secret_masking(stremio_env: Path):
    raw_cfg = {
        "version": 1,
        "server": {"name": "Test Stremio", "mdns_enabled": False},
        "security": {
            "tailscale_sso_enabled": False,
            "dev_auth_bypass": True,
            "session_secret": "test-session-secret-0123456789abcd",
        },
        "integrations": {
            "stremio": {
                "url": "  http://192.168.1.33:8080  ",
                "username": " admin ",
                "password": "super-secret-stremio-password",
            }
        },
    }
    validated, errors, _warnings = validate_app_config(raw_cfg)
    assert errors == []
    assert validated is not None
    assert validated.integrations.stremio.url == "http://192.168.1.33:8080"
    assert validated.integrations.stremio.username == "admin"
    assert validated.integrations.stremio.password == "super-secret-stremio-password"

    stremio_env.write_text(yaml.safe_dump(raw_cfg), encoding="utf-8")
    reload_settings()
    manager = get_config_manager()
    masked = yaml.safe_load(manager.raw_yaml_text(mask_secrets=True))
    assert masked["integrations"]["stremio"]["password"] == MASKED_SECRET_SENTINEL


@pytest.mark.asyncio
async def test_fetch_stremio_widget_variants(stremio_env: Path):
    # 1. Unconfigured
    async with httpx.AsyncClient() as client:
        unconf = await fetch_stremio_widget(client)
    assert unconf == {"status": "unconfigured"}

    # 2. Nested values + VAAPI device-info + Basic Auth header check
    stremio_env.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "security": {"dev_auth_bypass": True, "tailscale_sso_enabled": False},
                "integrations": {
                    "stremio": {
                        "url": "http://192.168.1.33:8080",
                        "username": "admin",
                        "password": "my-password",
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    reload_settings()

    expected_auth = "Basic " + base64.b64encode(b"admin:my-password").decode("ascii")
    seen_auths: list[str | None] = []

    def handler_ok(request: httpx.Request) -> httpx.Response:
        seen_auths.append(request.headers.get("authorization"))
        if request.url.path == "/settings":
            return httpx.Response(
                200,
                json={
                    "values": {
                        "serverVersion": "4.20.12",
                        "cacheSize": 10737418240,
                        "btMaxConnections": 55,
                    }
                },
            )
        if request.url.path == "/device-info":
            return httpx.Response(
                200,
                json={"availableHardwareAccelerations": ["vaapi-linux", "qsv-linux"]},
            )
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler_ok)) as client:
        res = await fetch_stremio_widget(client)

    assert seen_auths == [expected_auth, expected_auth]
    assert res == {
        "status": "ok",
        "server_version": "4.20.12",
        "hw_accel_enabled": True,
        "hw_accel_profiles": ["vaapi-linux", "qsv-linux"],
        "cache_size_bytes": 10737418240,
        "bt_max_connections": 55,
    }

    # 3. 401 Basic Auth rejection
    def handler_401(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="Unauthorized")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler_401)) as client:
        res_401 = await fetch_stremio_widget(client)
    assert res_401["status"] == "error"
    assert "Authentification" in res_401["error"]

    # 4. SPA HTML fallback instead of JSON
    def handler_html(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<!doctype html><html></html>")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler_html)) as client:
        res_html = await fetch_stremio_widget(client)
    assert res_html == {"status": "error", "error": "Réponse Stremio non-JSON"}


def test_stremio_setup_probe_config_update_and_widget_endpoint(
    stremio_env: Path, monkeypatch: pytest.MonkeyPatch
):
    stremio_env.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "server": {"name": "Test Stremio", "mdns_enabled": False},
                "security": {
                    "dev_auth_bypass": True,
                    "tailscale_sso_enabled": False,
                    "session_secret": "test-session-secret-0123456789abcd",
                },
            }
        ),
        encoding="utf-8",
    )
    reload_settings()

    def mock_handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/settings":
            return httpx.Response(
                200,
                json={"serverVersion": "4.20.10", "cacheSize": 2147483648},
            )
        if request.url.path == "/device-info":
            return httpx.Response(200, json={"availableHardwareAccelerations": []})
        return httpx.Response(404)

    transport = httpx.MockTransport(mock_handler)
    orig_async_client = httpx.AsyncClient

    def _patched_async_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = transport
        return orig_async_client(*args, **kwargs)

    monkeypatch.setattr(setup_router.httpx, "AsyncClient", _patched_async_client)

    app = FastAPI()
    app.include_router(setup_router.router)
    app.include_router(widgets_router.router)
    app.state.media_http = httpx.AsyncClient(transport=transport)

    with TestClient(app) as client:
        probe = client.post(
            "/api/setup/test-service",
            json={
                "service": "stremio",
                "url": "http://192.168.1.33:8080",
                "username": "admin",
                "secret": "secret-pass",
            },
        )
        assert probe.status_code == 200
        probe_data = probe.json()
        assert probe_data["ok"] is True
        assert "4.20.10" in probe_data["message"]

        upd = client.put(
            "/api/setup/config",
            json={
                "env": {
                    "STREMIO_URL": "http://192.168.1.33:8080",
                    "STREMIO_USERNAME": "admin",
                    "STREMIO_PASSWORD": "secret-pass",
                }
            },
        )
        assert upd.status_code == 200
        assert upd.json()["ok"] is True

        status_resp = client.get("/api/setup/status")
        assert status_resp.status_code == 200
        env_summary = status_resp.json()["env"]
        assert env_summary["stremio_url"] == "http://192.168.1.33:8080"
        assert env_summary["stremio_username"] == "admin"
        assert env_summary["stremio_password_set"] is True

        widget_resp = client.get("/api/widgets/stremio")
        assert widget_resp.status_code == 200
        widget_data = widget_resp.json()
        assert widget_data["status"] == "ok"
        assert widget_data["server_version"] == "4.20.10"
        assert widget_data["hw_accel_enabled"] is False
        assert widget_data["cache_size_bytes"] == 2147483648
