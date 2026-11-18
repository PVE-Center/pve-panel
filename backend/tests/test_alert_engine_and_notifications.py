"""Tests for extensible connectors, StateStore, AlertEngine, notifications, mDNS, and pairing."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
import httpx
import jwt
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import reload_settings
from app.config_manager import ConfigManager, reset_config_manager
from app.config_schema import (
    APNsConfig,
    AlertsConfig,
    AppConfig,
    CustomServiceConfig,
    NotificationsConfig,
    WebhookChannelConfig,
)
from app.services.alert_engine import AlertEngine
from app.services.connectors import (
    http_rest,
    icmp_ping,
    json_metrics,
    tcp_port,
    webhook_ingest,
)
from app.services.mdns_publisher import (
    MDNSPublisher,
    decode_txt_properties,
    extract_server_advertisement_spec,
    suggested_protocol_for_service_type,
)
from app.services.notifications import (
    DISCORD_COLOR_DOWN,
    DISCORD_COLOR_UP,
    NotificationDispatcher,
    NotificationEvent,
    escape_markdown_v2,
)
from app.services.pairing_relay import PairingRelayStore
from app.services.realtime_bus import RealtimeBus
from app.services.state_store import StateStore


def _generate_ec_p8_key(path: Path) -> tuple[Path, ec.EllipticCurvePublicKey]:
    private_key = ec.generate_private_key(ec.SECP256R1())
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    path.write_bytes(pem)
    return path, private_key.public_key()


@pytest.fixture
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    cfg_path = tmp_path / "config" / "config.yaml"
    db_path = tmp_path / "config" / "state.db"
    env_path = tmp_path / ".env"
    env_path.write_text("", encoding="utf-8")

    monkeypatch.setenv("CONFIG_PATH", str(cfg_path))
    monkeypatch.setenv("STATE_DB_PATH", str(db_path))
    monkeypatch.setenv("ENV_FILE_PATH", str(env_path))
    monkeypatch.setenv("DEV_AUTH_BYPASS", "true")
    monkeypatch.setenv("PVE_HOST", "https://pve.example.local:8006")
    monkeypatch.setenv("PVE_TOKEN_ID", "root@pam!panel")
    monkeypatch.setenv("PVE_TOKEN_SECRET", "test-secret-value")

    reset_config_manager()
    reload_settings()
    yield tmp_path, cfg_path, db_path
    reset_config_manager()
    reload_settings()


# ---------------------------------------------------------------------------
# 1. Connectors
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_http_rest_connector_auth_and_status() -> None:
    captured_headers: dict[str, str] = {}
    captured_methods: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_methods.append(request.method)
        captured_headers.update(dict(request.headers))
        if request.url.path == "/fail":
            return httpx.Response(503, text="unavailable")
        return httpx.Response(204, text="")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        res_ok = await http_rest.check(
            {
                "protocol": "http_rest",
                "url": "http://svc.local/ok",
                "method": "HEAD",
                "auth_type": "bearer",
                "auth_token": "tok-123",
                "expected_status": 204,
            },
            client=client,
        )
        assert res_ok.ok is True
        assert res_ok.status == "up"
        assert res_ok.http_status == 204
        assert captured_methods[-1] == "HEAD"
        assert captured_headers.get("authorization") == "Bearer tok-123"

        res_basic = await http_rest.check(
            {
                "url": "http://svc.local/ok",
                "auth_type": "basic",
                "auth_token": "alice:s3cr3t",
                "expected_status": 204,
            },
            client=client,
        )
        assert res_basic.ok is True
        assert captured_headers.get("authorization", "").startswith("Basic ")

        res_custom = await http_rest.check(
            {
                "url": "http://svc.local/ok",
                "auth_type": "header",
                "auth_header_name": "X-Custom-Key",
                "auth_token": "abc",
                "expected_status": 204,
            },
            client=client,
        )
        assert res_custom.ok is True
        assert captured_headers.get("x-custom-key") == "abc"

        res_down = await http_rest.check(
            {"url": "http://svc.local/fail", "expected_status": 200},
            client=client,
        )
        assert res_down.ok is False
        assert res_down.status == "down"
        assert res_down.http_status == 503


@pytest.mark.asyncio
async def test_tcp_port_connector() -> None:
    async def _handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        writer.close()
        await writer.wait_closed()

    server = await asyncio.start_server(_handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        up_res = await tcp_port.check({"host": "127.0.0.1", "port": port}, timeout=2.0)
        assert up_res.ok is True
        assert up_res.status == "up"
        assert up_res.metrics["port"] == port
    finally:
        server.close()
        await server.wait_closed()

    down_res = await tcp_port.check({"host": "127.0.0.1", "port": port}, timeout=1.0)
    assert down_res.ok is False
    assert down_res.status == "down"


@pytest.mark.asyncio
async def test_icmp_ping_connector_mac_linux_and_missing_binary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(icmp_ping.shutil, "which", lambda _name: None)
    missing_res = await icmp_ping.check({"host": "192.0.2.1"})
    assert missing_res.ok is False
    assert missing_res.status == "down"
    assert "indisponible" in missing_res.message.lower()

    monkeypatch.setattr(icmp_ping.platform, "system", lambda: "Linux")
    assert icmp_ping._build_ping_command("10.0.0.1", 2.0) == ["ping", "-c", "1", "-W", "2", "10.0.0.1"]
    monkeypatch.setattr(icmp_ping.platform, "system", lambda: "Darwin")
    assert icmp_ping._build_ping_command("10.0.0.1", 2.0) == ["ping", "-c", "1", "-W", "2000", "10.0.0.1"]

    class FakeProc:
        returncode = 0

        async def communicate(self) -> tuple[bytes, bytes]:
            return (b"64 bytes from 10.0.0.1: icmp_seq=0 ttl=64 time=1.42 ms\n", b"")

        def kill(self) -> None:
            pass

        async def wait(self) -> int:
            return 0

    async def fake_exec(*_args: Any, **_kwargs: Any) -> FakeProc:
        return FakeProc()

    monkeypatch.setattr(icmp_ping.shutil, "which", lambda _name: "/sbin/ping")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    ok_res = await icmp_ping.check({"host": "10.0.0.1"})
    assert ok_res.ok is True
    assert ok_res.status == "up"
    assert ok_res.latency_ms == 1
    assert ok_res.metrics["rtt_ms"] == 1.42


@pytest.mark.asyncio
async def test_json_metrics_connector_dotted_paths() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/bad-json":
            return httpx.Response(200, text="not-json")
        return httpx.Response(
            200,
            json={
                "stats": {"active_users": 14, "streams": [{"bitrate": 12000}]},
                "version": "10.9.11",
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        res = await json_metrics.check(
            {
                "url": "http://media.local/stats",
                "json_metric_path": "stats.active_users, version, stats.streams[0].bitrate",
            },
            client=client,
        )
        assert res.ok is True
        assert res.status == "up"
        assert res.metrics == {
            "stats.active_users": 14,
            "version": "10.9.11",
            "stats.streams[0].bitrate": 12000,
        }

        bad_res = await json_metrics.check(
            {"url": "http://media.local/bad-json", "json_metric_path": "version"},
            client=client,
        )
        assert bad_res.ok is False
        assert bad_res.status == "degraded"


@pytest.mark.asyncio
async def test_webhook_ingest_connector_ttl(tmp_path: Path) -> None:
    store = StateStore(tmp_path / "state.db")
    await store.initialize()
    try:
        svc = {"id": "backup-cron", "protocol": "webhook_ingest", "webhook_ttl_seconds": 60}
        pending = await webhook_ingest.check(svc, state_store=store)
        assert pending.ok is False
        assert pending.status == "degraded"

        base_now = datetime(2026, 11, 16, 12, 0, 0, tzinfo=timezone.utc)
        await store.record_webhook_heartbeat(
            "backup-cron",
            status="up",
            message="Backup OK",
            metrics={"duration_s": 42},
            ttl_seconds=60,
            received_at=base_now.isoformat(),
        )
        fresh = await webhook_ingest.check(
            svc, state_store=store, now=base_now + timedelta(seconds=30)
        )
        assert fresh.ok is True
        assert fresh.status == "up"
        assert fresh.metrics["duration_s"] == 42

        expired = await webhook_ingest.check(
            svc, state_store=store, now=base_now + timedelta(seconds=61)
        )
        assert expired.ok is False
        assert expired.status == "down"
        assert "expiré" in expired.message.lower()
    finally:
        await store.close()


# ---------------------------------------------------------------------------
# 2. Multi-Channel Notification Dispatcher (APNs, Discord, Telegram, Generic)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_notifications_apns_signed_jwt_and_channels(tmp_path: Path) -> None:
    p8_path, public_key = _generate_ec_p8_key(tmp_path / "AuthKey.p8")
    store = StateStore(tmp_path / "state.db")
    await store.initialize()

    await store.upsert_apns_device(
        device_token="aabbccddeeff00112233445566778899",
        platform="ios",
        device_name="iPhone Test",
        app_version="1.0",
        environment="sandbox",
    )

    apns_calls: list[tuple[str, dict[str, str], dict[str, Any]]] = []
    webhook_calls: list[tuple[str, dict[str, str], dict[str, Any]]] = []

    def apns_handler(request: httpx.Request) -> httpx.Response:
        apns_calls.append(
            (str(request.url), dict(request.headers), json.loads(request.content.decode()))
        )
        return httpx.Response(200, text="")

    def webhook_handler(request: httpx.Request) -> httpx.Response:
        webhook_calls.append(
            (str(request.url), dict(request.headers), json.loads(request.content.decode()))
        )
        return httpx.Response(200, json={"ok": True})

    notif_cfg = NotificationsConfig(
        apns=APNsConfig(
            enabled=True,
            team_id="TEAM123456",
            key_id="KEY9876543",
            bundle_id="io.ac.pvepanel.app",
            private_key_path=str(p8_path),
            use_sandbox=True,
        ),
        webhooks=[
            WebhookChannelConfig(
                id="wh-discord",
                name="Discord Ops",
                type="discord",
                enabled=True,
                url="https://discord.example/api/webhooks/1/tok",
            ),
            WebhookChannelConfig(
                id="wh-tg",
                name="Telegram Ops",
                type="telegram",
                enabled=True,
                url="https://api.telegram.example",
                bot_token="12345:secret",
                chat_id="-100999",
            ),
            WebhookChannelConfig(
                id="wh-ntfy",
                name="Ntfy",
                type="generic",
                enabled=True,
                url="https://ntfy.example/pve",
                headers={"X-Custom-Auth": "ntfy-tok"},
            ),
        ],
    )

    async with (
        httpx.AsyncClient(transport=httpx.MockTransport(apns_handler)) as apns_client,
        httpx.AsyncClient(transport=httpx.MockTransport(webhook_handler)) as http_client,
    ):
        dispatcher = NotificationDispatcher(
            state_store=store,
            http_client=http_client,
            apns_client=apns_client,
        )
        event = NotificationEvent(
            event="alert_triggered",
            title="🚨 Jellyfin_Prod (v1.0)!",
            message="HTTP 503 [down] - check logs.",
            severity="critical",
            service_id="jellyfin",
            service_name="Jellyfin_Prod",
            status="down",
            latency_ms=120,
            incident_id="inc-1",
            details="timeout > 3s",
        )
        results = await dispatcher.dispatch_event(event, notifications_config=notif_cfg)

    assert len(results) == 4
    assert all(r["ok"] is True for r in results)

    # Verify APNs HTTP/2 request + ES256 JWT signature
    assert len(apns_calls) == 1
    apns_url, apns_headers, apns_body = apns_calls[0]
    assert apns_url.startswith("https://api.sandbox.push.apple.com/3/device/")
    assert apns_headers["apns-topic"] == "io.ac.pvepanel.app"
    assert apns_body["aps"]["mutable-content"] == 1
    assert apns_body["aps"]["category"] == "SERVICE_ALERT"
    bearer_jwt = apns_headers["authorization"].split(" ", 1)[1]
    decoded = jwt.decode(bearer_jwt, public_key, algorithms=["ES256"])
    assert decoded["iss"] == "TEAM123456"

    # Verify Discord, Telegram, Generic payloads
    by_host = {url: (hdrs, body) for url, hdrs, body in webhook_calls}
    discord_body = by_host["https://discord.example/api/webhooks/1/tok"][1]
    assert discord_body["embeds"][0]["color"] == DISCORD_COLOR_DOWN
    assert len(discord_body["embeds"][0]["fields"]) >= 4

    tg_body = by_host["https://api.telegram.example/bot12345:secret/sendMessage"][1]
    assert tg_body["parse_mode"] == "MarkdownV2"
    assert r"Jellyfin\_Prod" in tg_body["text"]

    ntfy_hdrs, ntfy_body = by_host["https://ntfy.example/pve"]
    assert ntfy_hdrs["x-custom-auth"] == "ntfy-tok"
    assert ntfy_body["event"] == "alert_triggered"
    assert ntfy_body["service_id"] == "jellyfin"
    assert ntfy_body["latency_ms"] == 120

    await store.close()


@pytest.mark.asyncio
async def test_notifications_gracefully_skips_missing_apns_key_without_failing_webhooks(
    tmp_path: Path,
) -> None:
    store = StateStore(tmp_path / "state.db")
    await store.initialize()

    def webhook_handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        assert body["embeds"][0]["color"] == DISCORD_COLOR_UP
        return httpx.Response(204, text="")

    notif_cfg = NotificationsConfig(
        apns=APNsConfig(
            enabled=True,
            team_id="",
            key_id="",
            private_key_path=str(tmp_path / "missing.p8"),
        ),
        webhooks=[
            WebhookChannelConfig(
                id="wh-discord",
                name="Discord",
                type="discord",
                enabled=True,
                url="https://discord.example/webhook",
            )
        ],
    )

    async with httpx.AsyncClient(transport=httpx.MockTransport(webhook_handler)) as http_client:
        dispatcher = NotificationDispatcher(state_store=store, http_client=http_client)
        results = await dispatcher.dispatch_event(
            NotificationEvent(
                event="alert_resolved",
                title="✅ Service rétabli",
                message="De nouveau en ligne",
                severity="info",
                service_id="svc-1",
                service_name="Svc",
                status="up",
                latency_ms=15,
            ),
            notifications_config=notif_cfg,
        )

    by_type = {r["channel_type"]: r for r in results}
    assert by_type["apns"]["skipped"] is True
    assert by_type["apns"]["ok"] is False
    assert by_type["discord"]["ok"] is True
    assert escape_markdown_v2("a_b*c[1](2).!") == r"a\_b\*c\[1\]\(2\)\.\!"

    await store.close()


# ---------------------------------------------------------------------------
# 3. AlertEngine: Debounce, Cooldown, Mute, Recovery, RealtimeBus
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_alert_engine_debounce_cooldown_mute_and_recovery(
    isolated_env: tuple[Path, Path, Path],
) -> None:
    tmp_path, cfg_path, db_path = isolated_env
    bus = RealtimeBus()
    await bus.start()
    store = StateStore(db_path)
    await store.initialize()

    sent_events: list[dict[str, Any]] = []

    def webhook_handler(request: httpx.Request) -> httpx.Response:
        sent_events.append(json.loads(request.content.decode()))
        return httpx.Response(200, json={"ok": True})

    should_fail = {"flag": True}

    def target_handler(_request: httpx.Request) -> httpx.Response:
        if should_fail["flag"]:
            return httpx.Response(503, text="down")
        return httpx.Response(200, text="ok")

    async with (
        httpx.AsyncClient(transport=httpx.MockTransport(webhook_handler)) as wh_client,
        httpx.AsyncClient(transport=httpx.MockTransport(target_handler)) as svc_client,
    ):
        manager = ConfigManager(config_path=cfg_path, state_db_path=db_path, bus=bus)
        cfg = AppConfig(
            alerts=AlertsConfig(
                enabled=True,
                default_consecutive_failures=3,
                default_cooldown_seconds=300,
                check_interval_seconds=10,
            ),
            notifications=NotificationsConfig(
                webhooks=[
                    WebhookChannelConfig(
                        id="wh-generic",
                        name="Generic",
                        type="generic",
                        enabled=True,
                        url="https://hook.example/alert",
                        notify_on_down=True,
                        notify_on_recovery=True,
                    )
                ]
            ),
            custom_services=[
                CustomServiceConfig(
                    id="gitea",
                    name="Gitea",
                    protocol="http_rest",
                    url="http://gitea.local/healthz",
                    expected_status=200,
                )
            ],
        )
        manager.save_config(cfg, emit_event=False)

        dispatcher = NotificationDispatcher(
            state_store=store, config_getter=lambda: manager.config, http_client=wh_client
        )
        engine = AlertEngine(
            state_store=store,
            dispatcher=dispatcher,
            config_manager=manager,
            bus=bus,
            http_client=svc_client,
        )

        async with bus.subscribe() as queue:
            base_t = datetime(2026, 11, 16, 14, 0, 0, tzinfo=timezone.utc)
            svc_cfg = manager.config.custom_services[0]

            # Failure #1 & #2: debounced -> degraded, NO incident, NO notification
            r1 = await engine.evaluate_service(svc_cfg, now=base_t)
            assert r1["state"]["current_status"] == "degraded"
            assert r1["state"]["consecutive_failures"] == 1
            assert r1["incident_created"] is None
            assert len(sent_events) == 0

            r2 = await engine.evaluate_service(svc_cfg, now=base_t + timedelta(seconds=10))
            assert r2["state"]["current_status"] == "degraded"
            assert r2["state"]["consecutive_failures"] == 2
            assert r2["incident_created"] is None
            assert len(sent_events) == 0

            # Failure #3: reaches threshold -> DOWN + incident + notification + alert_triggered
            r3 = await engine.evaluate_service(svc_cfg, now=base_t + timedelta(seconds=20))
            assert r3["state"]["current_status"] == "down"
            assert r3["state"]["consecutive_failures"] == 3
            assert r3["incident_created"] is not None
            assert len(sent_events) == 1
            assert sent_events[0]["event"] == "alert_triggered"

            # Failure #4: still DOWN -> NO duplicate incident, NO spam notification
            r4 = await engine.evaluate_service(svc_cfg, now=base_t + timedelta(seconds=30))
            assert r4["incident_created"] is None
            assert len(sent_events) == 1

            # Recovery: UP -> incident resolved + recovery notification + alert_resolved
            should_fail["flag"] = False
            r5 = await engine.evaluate_service(svc_cfg, now=base_t + timedelta(seconds=40))
            assert r5["state"]["current_status"] == "up"
            assert r5["state"]["consecutive_failures"] == 0
            assert len(r5["incidents_resolved"]) == 1
            assert r5["incidents_resolved"][0]["resolved_at"] is not None
            assert len(sent_events) == 2
            assert sent_events[1]["event"] == "alert_resolved"

            # Flapping within cooldown_seconds=300 (with threshold=1): suppresses duplicate alert notification
            svc_fast = svc_cfg.model_copy(
                update={"alert_policy": svc_cfg.alert_policy.model_copy(update={"consecutive_failures": 1})}
            )
            should_fail["flag"] = True
            r6 = await engine.evaluate_service(svc_fast, now=base_t + timedelta(seconds=60))
            assert r6["state"]["current_status"] == "down"
            assert r6["incident_created"] is not None
            assert len(sent_events) == 2  # Cooldown suppressed notification!

            # Mute suppresses recovery notification too
            await store.set_service_mute("gitea", minutes=60)
            should_fail["flag"] = False
            r7 = await engine.evaluate_service(svc_fast, now=base_t + timedelta(seconds=70))
            assert r7["state"]["current_status"] == "up"
            assert len(r7["incidents_resolved"]) == 1
            assert len(sent_events) == 2  # Muted!

            bus_events: list[str] = []
            while not queue.empty():
                item = queue.get_nowait()
                if item:
                    bus_events.append(item["type"])
            assert "service_status_changed" in bus_events
            assert "alert_triggered" in bus_events
            assert "alert_resolved" in bus_events

    await bus.stop()
    await store.close()


# ---------------------------------------------------------------------------
# 4. Pairing Relay, mDNS Helpers, and Full FastAPI Router Integration
# ---------------------------------------------------------------------------


def test_pairing_relay_ttl_once_and_rate_limit() -> None:
    relay = PairingRelayStore(ttl_seconds=300, rate_limit_max_failures=3, rate_limit_window_seconds=60)
    created = relay.create_session(public_key="B" * 88, device_name="Salon Apple TV")
    pin = created["pin"]
    assert len(pin) == 6 and pin.isdigit()

    info = relay.get_session(pin, client_key="10.0.0.5")
    assert info["device_name"] == "Salon Apple TV"
    assert info["completed"] is False

    from app.services.pairing_relay import PairingNotFoundError, PairingPendingError, PairingRateLimitError

    with pytest.raises(PairingPendingError):
        relay.consume_payload(pin, client_key="10.0.0.5")

    completed = relay.complete_session(
        pin,
        sender_public_key="S" * 88,
        nonce="N" * 16,
        ciphertext="C" * 32,
        tag="T" * 24,
        client_key="10.0.0.5",
    )
    assert completed["completed"] is True

    blob = relay.consume_payload(pin, client_key="10.0.0.5")
    assert blob["ciphertext"] == "C" * 32

    # Session cleared after one-time consumption
    with pytest.raises(PairingNotFoundError):
        relay.get_session(pin, client_key="10.0.0.5")

    # Rate-limiting after repeated bad PIN attempts (allows 3 failed attempts, blocks on 4th)
    for _ in range(3):
        with pytest.raises(PairingNotFoundError):
            relay.get_session("999999", client_key="10.0.0.99")
    with pytest.raises(PairingRateLimitError):
        relay.get_session("999999", client_key="10.0.0.99")


def test_mdns_helpers_and_fast_api_endpoints(
    isolated_env: tuple[Path, Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tmp_path, cfg_path, db_path = isolated_env
    from app import main as app_main
    from app.routers import discovery as discovery_router

    # Unit check mDNS helpers
    spec = extract_server_advertisement_spec(
        {
            "server": {
                "id": "srv-1",
                "name": "Homelab Alpha",
                "listen_port": 8443,
                "public_url": "https://panel.tail.ts.net",
                "mdns_enabled": True,
                "mdns_service_name": "Homelab.Alpha",
                "mdns_service_type": "_pvecenter._tcp.local.",
            }
        }
    )
    assert spec["https"] is True
    assert spec["instance_name"] == "Homelab Alpha"
    assert suggested_protocol_for_service_type("_ssh._tcp.local.") == "tcp_port"
    assert decode_txt_properties({b"id": b"srv-1", b"https": b"true"}) == {
        "id": "srv-1",
        "https": "true",
    }

    # Stub mDNS network calls so TestClient lifespan & /api/discovery/lan never hit network
    async def fake_mdns_start(self: MDNSPublisher, _cfg: Any = None) -> bool:
        return True

    async def fake_mdns_stop(self: MDNSPublisher) -> None:
        return None

    async def fake_discover_lan(*, timeout: float = 2.0) -> list[dict[str, Any]]:
        return [
            {
                "id": "abc123",
                "name": "NAS Synology",
                "service_type": "_smb._tcp.local.",
                "host": "192.168.1.50",
                "port": 445,
                "txt": {"model": "DS920+"},
                "suggested_protocol": "tcp_port",
            }
        ]

    monkeypatch.setattr(MDNSPublisher, "start", fake_mdns_start)
    monkeypatch.setattr(MDNSPublisher, "stop", fake_mdns_stop)
    monkeypatch.setattr(discovery_router, "discover_lan_services", fake_discover_lan)

    with TestClient(app_main.app, client=("127.0.0.1", 50000)) as client:
        # 1. Health & backward-compatible GET /api/services
        health_resp = client.get("/api/health")
        assert health_resp.status_code == 200
        assert health_resp.json()["status"] == "ok"

        services_resp = client.get("/api/services")
        assert services_resp.status_code == 200
        assert "categories" in services_resp.json()
        assert "custom_services" in services_resp.json()

        # 2. Custom services CRUD + reorder + webhook ingest + incident creation/ack/mute
        create_resp = client.post(
            "/api/custom-services",
            json={
                "id": "cron-backup",
                "name": "Nightly Backup",
                "category": "Infrastructure",
                "protocol": "webhook_ingest",
                "auth_type": "bearer",
                "auth_token": "hook-secret-42",
                "alert_policy": {"enabled": True, "consecutive_failures": 1, "cooldown_seconds": 300},
            },
        )
        assert create_resp.status_code == 201
        created_svc = create_resp.json()["service"]
        assert created_svc["auth_token"] == "********"
        assert created_svc["auth_token_set"] is True

        create_second = client.post(
            "/api/custom-services",
            json={
                "id": "uptime-ping",
                "name": "Router ICMP",
                "protocol": "icmp_ping",
                "host": "192.168.1.1",
            },
        )
        assert create_second.status_code == 201

        reorder_resp = client.post(
            "/api/custom-services/reorder",
            json={"service_ids": ["uptime-ping", "cron-backup"]},
        )
        assert reorder_resp.status_code == 200
        assert reorder_resp.json()["order"] == ["uptime-ping", "cron-backup"]

        # Update preserving masked secret
        update_resp = client.put(
            "/api/custom-services/cron-backup",
            json={"description": "ZFS snapshot push", "auth_token": "********"},
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["service"]["description"] == "ZFS snapshot push"
        assert update_resp.json()["service"]["auth_token_set"] is True

        # Webhook reject on bad token, accept on valid token + trigger incident on down
        bad_wh = client.post(
            "/api/custom-services/cron-backup/webhook",
            json={"status": "down", "message": "ZFS error"},
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert bad_wh.status_code == 401

        down_wh = client.post(
            "/api/custom-services/cron-backup/webhook",
            json={"status": "down", "message": "ZFS error", "disk_free_gb": 42},
            headers={"Authorization": "Bearer hook-secret-42"},
        )
        assert down_wh.status_code == 200
        assert down_wh.json()["incident_created"] is not None
        incident_id = down_wh.json()["incident_created"]["id"]

        # Incidents list, ack, mute, unmute
        inc_list = client.get("/api/incidents?active_only=true")
        assert inc_list.status_code == 200
        assert inc_list.json()["active_count"] == 1

        ack_resp = client.post(f"/api/incidents/{incident_id}/ack")
        assert ack_resp.status_code == 200
        assert ack_resp.json()["incident"]["acknowledged"] is True

        mute_resp = client.post(
            "/api/incidents/services/cron-backup/mute", json={"minutes": 60}
        )
        assert mute_resp.status_code == 200
        assert mute_resp.json()["muted_until"] is not None

        unmute_resp = client.delete("/api/incidents/services/cron-backup/mute")
        assert unmute_resp.status_code == 200
        assert unmute_resp.json()["muted_until"] is None

        # Recover via webhook
        up_wh = client.post(
            "/api/custom-services/cron-backup/webhook",
            json={"status": "up", "message": "ZFS recovered", "disk_free_gb": 120},
            headers={"Authorization": "Bearer hook-secret-42"},
        )
        assert up_wh.status_code == 200
        assert len(up_wh.json()["incidents_resolved"]) == 1

        # Test dry-run & saved service test
        test_saved = client.post("/api/custom-services/cron-backup/test")
        assert test_saved.status_code == 200
        assert test_saved.json()["ok"] is True
        assert test_saved.json()["metrics"]["disk_free_gb"] == 120

        test_dry_run = client.post(
            "/api/custom-services/dry-run/test",
            json={
                "name": "Dry Run TCP",
                "protocol": "tcp_port",
                "host": "127.0.0.1",
                "port": 1,
            },
        )
        assert test_dry_run.status_code == 200
        assert test_dry_run.json()["service_id"] == "dry-run"
        assert test_dry_run.json()["protocol"] == "tcp_port"
        assert test_dry_run.json()["ok"] is False

        # GET /api/services merges custom services cleanly
        merged_services = client.get("/api/services")
        assert merged_services.status_code == 200
        custom_ids = [s["id"] for s in merged_services.json()["custom_services"]]
        assert "cron-backup" in custom_ids

        # Delete custom service
        del_resp = client.delete("/api/custom-services/uptime-ping")
        assert del_resp.status_code == 200

        # 3. Notifications devices + masked channels + test
        reg_dev = client.post(
            "/api/notifications/devices",
            json={
                "device_token": "00112233445566778899aabbccddeeff",
                "platform": "ios",
                "device_name": "iPhone Pro",
                "app_version": "1.0.0",
                "environment": "sandbox",
            },
        )
        assert reg_dev.status_code == 200

        put_ch = client.put(
            "/api/notifications/channels",
            json={
                "webhooks": [
                    {
                        "id": "tg-1",
                        "name": "Telegram",
                        "type": "telegram",
                        "enabled": True,
                        "bot_token": "99999:my-secret-bot-token",
                        "chat_id": "123456",
                    }
                ]
            },
        )
        assert put_ch.status_code == 200

        get_ch = client.get("/api/notifications/channels")
        assert get_ch.status_code == 200
        ch_json = get_ch.json()
        assert ch_json["webhooks"][0]["bot_token"] == "********"
        assert ch_json["webhooks"][0]["bot_token_set"] is True
        assert "99999:my-secret-bot-token" not in json.dumps(ch_json)
        assert ch_json["apns"]["registered_devices_count"] == 1

        # Test POST /api/notifications/test endpoint with mocked transport
        def test_notif_transport(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"ok": True})

        app_main.app.state.notification_dispatcher._http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(test_notif_transport)
        )
        test_notif_resp = client.post(
            "/api/notifications/test",
            json={"channel_type": "telegram"},
        )
        assert test_notif_resp.status_code == 200
        assert test_notif_resp.json()["ok"] is True
        assert test_notif_resp.json()["results"][0]["channel_id"] == "tg-1"

        # PUT preserving masked bot_token sentinel
        put_keep = client.put(
            "/api/notifications/channels",
            json={
                "webhooks": [
                    {
                        "id": "tg-1",
                        "name": "Telegram Renamed",
                        "type": "telegram",
                        "enabled": True,
                        "bot_token": "********",
                        "chat_id": "123456",
                    }
                ]
            },
        )
        assert put_keep.status_code == 200
        assert (
            app_main.app.state.config_manager.config.notifications.webhooks[0].bot_token
            == "99999:my-secret-bot-token"
        )

        del_dev = client.delete("/api/notifications/devices/00112233445566778899aabbccddeeff")
        assert del_dev.status_code == 200
        assert del_dev.json()["deleted"] is True

        # 4. Discovery LAN + QR
        lan_resp = client.get("/api/discovery/lan")
        assert lan_resp.status_code == 200
        assert lan_resp.json()["services"][0]["host"] == "192.168.1.50"

        qr_resp = client.get("/api/discovery/qr")
        assert qr_resp.status_code == 200
        assert qr_resp.json()["deep_link"].startswith("pvecenter://connect?url=")
        assert "onboarding_link" in qr_resp.json()

        # 5. Pairing Relay HTTP flow
        p_create = client.post(
            "/api/pairing/sessions",
            json={"public_key": "R" * 88, "device_name": "Apple TV 4K"},
        )
        assert p_create.status_code == 201
        pin = p_create.json()["pin"]

        p_get = client.get(f"/api/pairing/sessions/{pin}")
        assert p_get.status_code == 200
        assert p_get.json()["device_name"] == "Apple TV 4K"

        p_pending = client.get(f"/api/pairing/sessions/{pin}/payload")
        assert p_pending.status_code == 425

        p_complete = client.post(
            f"/api/pairing/sessions/{pin}/complete",
            json={
                "sender_public_key": "S" * 88,
                "nonce": "N" * 16,
                "ciphertext": "C" * 32,
                "tag": "T" * 24,
            },
        )
        assert p_complete.status_code == 200

        p_blob = client.get(f"/api/pairing/sessions/{pin}/payload")
        assert p_blob.status_code == 200
        assert p_blob.json()["ciphertext"] == "C" * 32

        p_gone = client.get(f"/api/pairing/sessions/{pin}/payload")
        assert p_gone.status_code == 404
