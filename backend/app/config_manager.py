"""Declarative YAML ConfigManager with ${VAR} interpolation, template preservation, atomic write, and watchfiles hot-reload."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import errno
import hashlib
import hmac
import inspect
import os
from pathlib import Path
import re
import secrets
import shutil
import tempfile
import threading
from typing import Any, Callable, Mapping
from uuid import uuid4

from dotenv import dotenv_values
import jwt
import yaml
from watchfiles import awatch

from app.config_schema import (
    ENV_VAR_PATTERN,
    MASKED_SECRET_SENTINEL,
    AppConfig,
    is_env_template,
    is_masked_or_empty,
    is_secret_configured,
    validate_app_config,
)
from app.services.realtime_bus import RealtimeBus, get_realtime_bus

_SCALAR_SECRET_PATHS: tuple[tuple[str, ...], ...] = (
    ("security", "session_secret"),
    ("security", "admin_pin_hash"),
    ("proxmox", "token_secret"),
    ("integrations", "jellyfin", "api_key"),
    ("integrations", "jellyseerr", "api_key"),
    ("integrations", "plex", "token"),
    ("integrations", "radarr", "api_key"),
    ("integrations", "sonarr", "api_key"),
    ("integrations", "prowlarr", "api_key"),
    ("integrations", "qbittorrent", "password"),
)

_SENSITIVE_HEADER_TOKENS = ("auth", "token", "secret", "key", "password")


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def resolve_env_file() -> Path:
    """Locate .env file prioritizing /app/.env in Docker, then cwd and repo root."""
    override = os.environ.get("ENV_FILE_PATH", "").strip()
    if override:
        return Path(override)
    candidates = [
        Path("/app/.env"),
        Path.cwd() / ".env",
        Path.cwd().parent / ".env",
        _repo_root() / ".env",
    ]
    for path in candidates:
        if path.is_file():
            return path
    if Path("/app").is_dir():
        return Path("/app/.env")
    return _repo_root() / ".env"


def resolve_config_path() -> Path:
    """Locate config.yaml prioritizing CONFIG_PATH env, /app/config/config.yaml, then repo config/config.yaml."""
    override = os.environ.get("CONFIG_PATH", "").strip()
    if override:
        return Path(override)
    docker_cfg = Path("/app/config/config.yaml")
    if docker_cfg.is_file() or Path("/app").is_dir():
        return docker_cfg
    cwd_cfg = Path.cwd() / "config" / "config.yaml"
    if cwd_cfg.is_file():
        return cwd_cfg
    return _repo_root() / "config" / "config.yaml"


def resolve_state_db_path() -> Path:
    """Locate SQLite state.db prioritizing STATE_DB_PATH env, /app/config/state.db, then config dir."""
    override = os.environ.get("STATE_DB_PATH", "").strip()
    if override:
        return Path(override)
    docker_db = Path("/app/config/state.db")
    if docker_db.is_file() or Path("/app").is_dir():
        return docker_db
    return resolve_config_path().parent / "state.db"


def resolve_services_yaml_path(configured_path: str = "../services.yaml") -> Path:
    """Locate legacy services.yaml across Docker and local development layouts."""
    env_override = os.environ.get("SERVICES_CONFIG_PATH", "").strip()
    if env_override:
        candidate = Path(env_override)
        if candidate.is_file() or candidate.is_absolute():
            return candidate
    if configured_path:
        candidate = Path(configured_path)
        if candidate.is_file():
            return candidate
    repo_candidate = _repo_root() / "services.yaml"
    if repo_candidate.is_file():
        return repo_candidate
    if Path("/app/services.yaml").is_file() or Path("/app").is_dir():
        return Path("/app/services.yaml")
    return repo_candidate


CONFIG_PATH: Path = resolve_config_path()
STATE_DB_PATH: Path = resolve_state_db_path()


def write_text_safe(
    path: Path, content: str, new_file_mode: int | None = None
) -> None:
    """Write text atomically, falling back to in-place write on bind-mounted EBUSY files."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as tmp_file:
            tmp_path = Path(tmp_file.name)
            tmp_file.write(content)
            tmp_file.flush()
            os.fsync(tmp_file.fileno())

        if path.exists():
            shutil.copymode(path, tmp_path)
        elif new_file_mode is not None:
            os.chmod(tmp_path, new_file_mode)

        os.replace(tmp_path, path)
        tmp_path = None
    except OSError as exc:
        if exc.errno not in {errno.EBUSY, errno.EXDEV, errno.EPERM}:
            raise
        with path.open("w", encoding="utf-8") as fh:
            fh.write(content)
            fh.flush()
            os.fsync(fh.fileno())
        if new_file_mode is not None and path.exists():
            try:
                os.chmod(path, new_file_mode)
            except OSError:
                pass
    finally:
        if tmp_path is not None and tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def hash_token(plaintext: str) -> str:
    """Return SHA-256 hex digest of an API token."""
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def verify_token_hash(plaintext: str, stored_hash: str) -> bool:
    """Constant-time check of a plaintext bearer token against a stored SHA-256 hash."""
    cleaned = (stored_hash or "").strip()
    if cleaned.lower().startswith("sha256:"):
        cleaned = cleaned[7:].strip()
    if not plaintext or not cleaned:
        return False
    candidate = hash_token(plaintext)
    return hmac.compare_digest(candidate.lower(), cleaned.lower())


def hash_pin(pin: str) -> str:
    """Hash an admin PIN using PBKDF2-HMAC-SHA256 with random 16-byte salt."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, 200_000)
    return f"pbkdf2_sha256${salt.hex()}${digest.hex()}"


def verify_pin(pin: str, stored_hash: str) -> bool:
    """Constant-time verification of a PIN against PBKDF2-HMAC-SHA256 or SHA-256 hash."""
    cleaned = (stored_hash or "").strip()
    if not pin or not cleaned:
        return False
    if cleaned.startswith("pbkdf2_sha256$"):
        parts = cleaned.split("$", 2)
        if len(parts) != 3:
            return False
        _, salt_hex, expected_hex = parts
        try:
            salt = bytes.fromhex(salt_hex)
        except ValueError:
            return False
        digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, 200_000).hex()
        return hmac.compare_digest(digest.lower(), expected_hex.lower())
    return verify_token_hash(pin, cleaned)


def create_session_token(
    *,
    subject: str,
    name: str,
    role: str,
    secret: str,
    ttl_seconds: int = 86400,
) -> tuple[str, str]:
    """Mint an HS256 JWT session token and return (token, expires_at_iso)."""
    now = datetime.now(timezone.utc)
    exp = now + timedelta(seconds=ttl_seconds)
    payload = {
        "sub": subject,
        "name": name,
        "role": role,
        "auth_mode": "session",
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    token = jwt.encode(payload, secret, algorithm="HS256")
    return token, exp.strftime("%Y-%m-%dT%H:%M:%SZ")


def verify_session_token(token: str, secret: str) -> dict[str, Any] | None:
    """Validate an HS256 JWT session token and return its claims or None."""
    if not token or not secret:
        return None
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"])
        if not isinstance(claims, dict) or not claims.get("sub"):
            return None
        return claims
    except jwt.PyJWTError:
        return None


def _parse_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


def _parse_int(value: Any, default: int) -> int:
    if value is None or str(value).strip() == "":
        return default
    try:
        return int(str(value).strip())
    except ValueError:
        return default


def _build_env_lookup(env_file: Path | None = None) -> dict[str, str]:
    """Merge .env file values with os.environ (os.environ takes precedence)."""
    lookup: dict[str, str] = {}
    target_env = env_file if env_file is not None else resolve_env_file()
    if target_env.is_file():
        for key, val in dotenv_values(target_env).items():
            if key and val is not None:
                lookup[key] = str(val)
    for key, val in os.environ.items():
        lookup[key] = val
    return lookup


def interpolate_env_vars(
    value: Any,
    env_lookup: Mapping[str, str],
    unresolved: list[str] | None = None,
) -> Any:
    """Recursively expand ${VAR_NAME} and ${VAR_NAME:-default} in strings/dicts/lists."""
    if unresolved is None:
        unresolved = []

    if isinstance(value, dict):
        return {
            k: interpolate_env_vars(v, env_lookup, unresolved)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [interpolate_env_vars(item, env_lookup, unresolved) for item in value]
    if isinstance(value, str):
        def _replace(match: re.Match[str]) -> str:
            var_name = match.group(1)
            default_val = match.group(2)
            if var_name in env_lookup:
                resolved = env_lookup[var_name]
                if resolved != "" or default_val is None:
                    return resolved
            if default_val is not None:
                return default_val
            unresolved.append(var_name)
            return ""

        return ENV_VAR_PATTERN.sub(_replace, value)
    return value


def _get_nested(data: Mapping[str, Any], path: tuple[str, ...]) -> Any:
    cur: Any = data
    for key in path:
        if not isinstance(cur, Mapping) or key not in cur:
            return None
        cur = cur[key]
    return cur


def _set_nested(data: dict[str, Any], path: tuple[str, ...], value: Any) -> None:
    cur: dict[str, Any] = data
    for key in path[:-1]:
        nxt = cur.get(key)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[key] = nxt
        cur = nxt
    cur[path[-1]] = value


def _mask_yaml_dict(raw_data: dict[str, Any]) -> dict[str, Any]:
    """Deep-copy raw YAML dict and mask literal secrets while keeping ${VAR_NAME} templates visible."""
    masked = yaml.safe_load(yaml.safe_dump(raw_data, sort_keys=False)) or {}
    if not isinstance(masked, dict):
        return {}

    for path in _SCALAR_SECRET_PATHS:
        val = _get_nested(masked, path)
        if isinstance(val, str) and val.strip() and not is_env_template(val) and not val.strip().startswith("replace-with-"):
            _set_nested(masked, path, MASKED_SECRET_SENTINEL)

    tokens = _get_nested(masked, ("security", "api_tokens"))
    if isinstance(tokens, list):
        for item in tokens:
            if isinstance(item, dict) and item.get("token_hash") and not is_env_template(item["token_hash"]):
                item["token_hash"] = MASKED_SECRET_SENTINEL

    webhooks = _get_nested(masked, ("notifications", "webhooks"))
    if isinstance(webhooks, list):
        for wh in webhooks:
            if not isinstance(wh, dict):
                continue
            if wh.get("bot_token") and not is_env_template(wh["bot_token"]):
                wh["bot_token"] = MASKED_SECRET_SENTINEL
            headers = wh.get("headers")
            if isinstance(headers, dict):
                for h_key, h_val in list(headers.items()):
                    if (
                        any(tok in str(h_key).lower() for tok in _SENSITIVE_HEADER_TOKENS)
                        and isinstance(h_val, str)
                        and h_val.strip()
                        and not is_env_template(h_val)
                    ):
                        headers[h_key] = MASKED_SECRET_SENTINEL

    custom_services = masked.get("custom_services")
    if isinstance(custom_services, list):
        for svc in custom_services:
            if isinstance(svc, dict) and svc.get("auth_token") and not is_env_template(svc["auth_token"]):
                svc["auth_token"] = MASKED_SECRET_SENTINEL

    return masked


def _preserve_secret_value(
    incoming_val: Any,
    existing_raw_val: Any,
    prev_resolved_val: Any,
) -> Any:
    """Keep ${VAR_NAME} template or existing secret when incoming value is empty, masked, or unchanged."""
    if is_masked_or_empty(incoming_val):
        return existing_raw_val if existing_raw_val is not None else ""
    if (
        isinstance(existing_raw_val, str)
        and existing_raw_val != ""
        and incoming_val == prev_resolved_val
    ):
        return existing_raw_val
    return incoming_val


def _merge_preserving_templates(
    existing_raw: dict[str, Any],
    incoming_dict: dict[str, Any],
    prev_resolved: dict[str, Any],
) -> dict[str, Any]:
    """Merge incoming config dictionary over existing raw template without expanding/erasing secrets."""
    merged = yaml.safe_load(yaml.safe_dump(incoming_dict, sort_keys=False)) or {}
    if not isinstance(merged, dict):
        return {}

    # Preserve scalar secret fields
    for path in _SCALAR_SECRET_PATHS:
        existing_raw_val = _get_nested(existing_raw, path)
        prev_res_val = _get_nested(prev_resolved, path)
        incoming_val = _get_nested(merged, path)
        if existing_raw_val is not None or incoming_val is not None:
            preserved = _preserve_secret_value(incoming_val, existing_raw_val, prev_res_val)
            if preserved is not None and _get_nested(merged, path[:-1]) is not None:
                _set_nested(merged, path, preserved)

    # Preserve security.api_tokens[].token_hash by token id
    existing_tokens = {
        t.get("id"): t
        for t in (_get_nested(existing_raw, ("security", "api_tokens")) or [])
        if isinstance(t, dict) and t.get("id")
    }
    prev_tokens = {
        t.get("id"): t
        for t in (_get_nested(prev_resolved, ("security", "api_tokens")) or [])
        if isinstance(t, dict) and t.get("id")
    }
    for tok in _get_nested(merged, ("security", "api_tokens")) or []:
        if isinstance(tok, dict) and tok.get("id") in existing_tokens:
            tid = tok["id"]
            tok["token_hash"] = _preserve_secret_value(
                tok.get("token_hash"),
                existing_tokens[tid].get("token_hash"),
                (prev_tokens.get(tid) or {}).get("token_hash"),
            )

    # Preserve notifications.webhooks[].bot_token and sensitive headers by webhook id
    existing_wh = {
        w.get("id"): w
        for w in (_get_nested(existing_raw, ("notifications", "webhooks")) or [])
        if isinstance(w, dict) and w.get("id")
    }
    prev_wh = {
        w.get("id"): w
        for w in (_get_nested(prev_resolved, ("notifications", "webhooks")) or [])
        if isinstance(w, dict) and w.get("id")
    }
    for wh in _get_nested(merged, ("notifications", "webhooks")) or []:
        if not isinstance(wh, dict) or wh.get("id") not in existing_wh:
            continue
        wid = wh["id"]
        wh["bot_token"] = _preserve_secret_value(
            wh.get("bot_token"),
            existing_wh[wid].get("bot_token"),
            (prev_wh.get(wid) or {}).get("bot_token"),
        )
        raw_headers = existing_wh[wid].get("headers") or {}
        prev_headers = (prev_wh.get(wid) or {}).get("headers") or {}
        inc_headers = wh.get("headers")
        if isinstance(inc_headers, dict) and isinstance(raw_headers, dict):
            for hk, hv in list(inc_headers.items()):
                if hk in raw_headers:
                    inc_headers[hk] = _preserve_secret_value(
                        hv, raw_headers.get(hk), prev_headers.get(hk)
                    )

    # Preserve custom_services[].auth_token by service id
    existing_svcs = {
        s.get("id"): s
        for s in (existing_raw.get("custom_services") or [])
        if isinstance(s, dict) and s.get("id")
    }
    prev_svcs = {
        s.get("id"): s
        for s in (prev_resolved.get("custom_services") or [])
        if isinstance(s, dict) and s.get("id")
    }
    for svc in merged.get("custom_services") or []:
        if isinstance(svc, dict) and svc.get("id") in existing_svcs:
            sid = svc["id"]
            svc["auth_token"] = _preserve_secret_value(
                svc.get("auth_token"),
                existing_svcs[sid].get("auth_token"),
                (prev_svcs.get(sid) or {}).get("auth_token"),
            )

    return merged


def _dump_yaml(data: dict[str, Any]) -> str:
    return yaml.safe_dump(
        data,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
        indent=2,
    )


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class ConfigManager:
    """Thread-safe / async-aware declarative configuration manager for config.yaml."""

    def __init__(
        self,
        config_path: Path | None = None,
        state_db_path: Path | None = None,
        env_file_path: Path | None = None,
        bus: RealtimeBus | None = None,
    ) -> None:
        self._explicit_config_path = config_path
        self._explicit_state_db_path = state_db_path
        self._explicit_env_file_path = env_file_path
        self._bus = bus or get_realtime_bus()
        self._lock = threading.RLock()
        self._callbacks: list[Callable[[AppConfig], Any]] = []
        self._ephemeral_session_secret: str = secrets.token_hex(32)

        self._config: AppConfig = AppConfig()
        self._raw_template: dict[str, Any] = {}
        self._raw_yaml_cache: str = ""
        self._content_hash: str = ""
        self._is_synthesized: bool = True
        self._config_exists: bool = False
        self._legacy_stamp: tuple[float | None, float | None] = (None, None)

        self._watcher_task: asyncio.Task[None] | None = None
        self._stop_event: asyncio.Event | None = None

        self.load()

    @property
    def config_path(self) -> Path:
        return self._explicit_config_path or resolve_config_path()

    @property
    def state_db_path(self) -> Path:
        return self._explicit_state_db_path or resolve_state_db_path()

    @property
    def env_file_path(self) -> Path:
        return self._explicit_env_file_path or resolve_env_file()

    @property
    def config(self) -> AppConfig:
        with self._lock:
            # In legacy synthesized mode, detect external edits to .env or services.yaml cleanly
            if self._is_synthesized and not self.config_path.is_file():
                stamp = self._current_legacy_stamp()
                if stamp != self._legacy_stamp:
                    self.load()
            return self._config

    @property
    def content_hash(self) -> str:
        with self._lock:
            return self._content_hash

    @property
    def is_synthesized(self) -> bool:
        with self._lock:
            return self._is_synthesized

    @property
    def config_exists(self) -> bool:
        with self._lock:
            return self.config_path.is_file()

    @property
    def effective_session_secret(self) -> str:
        """Return configured security.session_secret or an ephemeral process secret."""
        cfg_secret = self.config.security.session_secret.strip()
        return cfg_secret or self._ephemeral_session_secret

    def _current_legacy_stamp(self) -> tuple[float | None, float | None]:
        env_p = self.env_file_path
        svc_p = resolve_services_yaml_path()
        env_m = env_p.stat().st_mtime if env_p.is_file() else None
        svc_m = svc_p.stat().st_mtime if svc_p.is_file() else None
        return (env_m, svc_m)

    def _synthesize_from_legacy(self, env_lookup: Mapping[str, str]) -> tuple[AppConfig, dict[str, Any]]:
        """Build an in-memory AppConfig from .env/os.environ + services.yaml without writing config.yaml."""
        services_path = resolve_services_yaml_path(
            env_lookup.get("SERVICES_CONFIG_PATH", "../services.yaml")
        )
        services_raw: dict[str, Any] = {}
        if services_path.is_file():
            try:
                loaded = yaml.safe_load(services_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    services_raw = loaded
            except yaml.YAMLError:
                services_raw = {}

        raw_dict: dict[str, Any] = {
            "version": 1,
            "server": {
                "id": str(uuid4()),
                "name": env_lookup.get("SERVER_NAME", "PVE Command Center") or "PVE Command Center",
                "listen_host": env_lookup.get("LISTEN_HOST", "0.0.0.0") or "0.0.0.0",
                "listen_port": _parse_int(env_lookup.get("LISTEN_PORT"), 8000),
                "public_url": env_lookup.get("PUBLIC_URL", ""),
                "mdns_enabled": _parse_bool(env_lookup.get("MDNS_ENABLED"), True),
                "mdns_service_name": env_lookup.get("MDNS_SERVICE_NAME", "PVE Command Center") or "PVE Command Center",
                "mdns_service_type": "_pvecenter._tcp.local.",
                "refresh_interval_seconds": _parse_int(env_lookup.get("REFRESH_INTERVAL_SECONDS"), 5),
            },
            "security": {
                "tailscale_sso_enabled": _parse_bool(env_lookup.get("TAILSCALE_SSO_ENABLED"), True),
                "allowed_tailscale_users": env_lookup.get("ALLOWED_TAILSCALE_USERS", ""),
                "dev_auth_bypass": _parse_bool(env_lookup.get("DEV_AUTH_BYPASS"), False),
                "protected_owner_username": env_lookup.get("PROTECTED_OWNER_USERNAME", "admin") or "admin",
                "session_secret": env_lookup.get("SESSION_SECRET", ""),
                "api_tokens": [],
                "admin_pin_hash": env_lookup.get("ADMIN_PIN_HASH", ""),
            },
            "proxmox": {
                "host": env_lookup.get("PVE_HOST", ""),
                "token_id": env_lookup.get("PVE_TOKEN_ID", ""),
                "token_secret": env_lookup.get("PVE_TOKEN_SECRET", ""),
                "verify_ssl": _parse_bool(env_lookup.get("PVE_VERIFY_SSL"), False),
                "default_node": env_lookup.get("PVE_NODE", "pve") or "pve",
                "panel_self_vmid": _parse_int(env_lookup.get("PANEL_SELF_VMID"), 116),
            },
            "integrations": {
                "jellyfin": {
                    "url": env_lookup.get("JELLYFIN_URL", ""),
                    "api_key": env_lookup.get("JELLYFIN_API_KEY", ""),
                },
                "jellyseerr": {
                    "url": env_lookup.get("JELLYSEERR_URL", ""),
                    "api_key": env_lookup.get("JELLYSEERR_API_KEY", ""),
                },
                "plex": {
                    "url": env_lookup.get("PLEX_URL", ""),
                    "token": env_lookup.get("PLEX_TOKEN", ""),
                },
                "radarr": {
                    "url": env_lookup.get("RADARR_URL", ""),
                    "api_key": env_lookup.get("RADARR_API_KEY", ""),
                },
                "sonarr": {
                    "url": env_lookup.get("SONARR_URL", ""),
                    "api_key": env_lookup.get("SONARR_API_KEY", ""),
                },
                "prowlarr": {
                    "url": env_lookup.get("PROWLARR_URL", ""),
                    "api_key": env_lookup.get("PROWLARR_API_KEY", ""),
                },
                "qbittorrent": {
                    "url": env_lookup.get("QBIT_URL", ""),
                    "username": env_lookup.get("QBIT_USERNAME", ""),
                    "password": env_lookup.get("QBIT_PASSWORD", ""),
                },
            },
            "categories": [
                c for c in (services_raw.get("categories") or []) if isinstance(c, dict)
            ],
            "custom_services": [],
            "storage_mounts": [
                m
                for m in (services_raw.get("storage_mounts") or [])
                if isinstance(m, dict) and m.get("subpath")
            ],
        }
        cfg = AppConfig.model_validate(raw_dict)
        return cfg, cfg.model_dump()

    def load(self) -> AppConfig:
        """Load config.yaml (with ${VAR} interpolation) or synthesize from .env + services.yaml."""
        with self._lock:
            env_lookup = _build_env_lookup(self.env_file_path)
            cfg_path = self.config_path
            if cfg_path.is_file():
                raw_text = cfg_path.read_text(encoding="utf-8")
                parsed = yaml.safe_load(raw_text)
                if parsed is None:
                    parsed = {}
                if not isinstance(parsed, dict):
                    raise ValueError(f"{cfg_path} must contain a YAML mapping at root.")
                unresolved: list[str] = []
                resolved_dict = interpolate_env_vars(parsed, env_lookup, unresolved)
                config = AppConfig.model_validate(resolved_dict)
                self._raw_template = parsed
                self._raw_yaml_cache = raw_text
                self._content_hash = _sha256_text(raw_text)
                self._config = config
                self._is_synthesized = False
                self._config_exists = True
                return config

            config, canonical_dict = self._synthesize_from_legacy(env_lookup)
            rendered = _dump_yaml(canonical_dict)
            self._raw_template = canonical_dict
            self._raw_yaml_cache = rendered
            self._content_hash = _sha256_text(rendered)
            self._config = config
            self._is_synthesized = True
            self._config_exists = False
            self._legacy_stamp = self._current_legacy_stamp()
            return config

    def on_reload(self, callback: Callable[[AppConfig], Any]) -> Callable[[], None]:
        """Register a sync or async callback invoked whenever configuration reloads."""
        with self._lock:
            self._callbacks.append(callback)

        def _unsubscribe() -> None:
            with self._lock:
                try:
                    self._callbacks.remove(callback)
                except ValueError:
                    pass

        return _unsubscribe

    def _run_sync_and_schedule_async_callbacks(
        self, new_cfg: AppConfig, emit_event: bool, source: str
    ) -> None:
        callbacks = list(self._callbacks)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        for cb in callbacks:
            try:
                result = cb(new_cfg)
                if inspect.isawaitable(result) and loop is not None:
                    loop.create_task(result)
            except Exception:
                pass

        if emit_event:
            self._bus.publish_nowait(
                "config_reloaded",
                {
                    "hash": self._content_hash,
                    "source": source,
                    "server_id": new_cfg.server.id,
                    "is_synthesized": self._is_synthesized,
                },
            )

    async def _run_callbacks_async(
        self, new_cfg: AppConfig, emit_event: bool, source: str
    ) -> None:
        callbacks = list(self._callbacks)
        for cb in callbacks:
            try:
                result = cb(new_cfg)
                if inspect.isawaitable(result):
                    await result
            except Exception:
                pass

        if emit_event:
            await self._bus.publish(
                "config_reloaded",
                {
                    "hash": self._content_hash,
                    "source": source,
                    "server_id": new_cfg.server.id,
                    "is_synthesized": self._is_synthesized,
                },
            )

    def reload(self, *, emit_event: bool = True, source: str = "manual") -> AppConfig:
        """Reload configuration synchronously, run sync callbacks, and schedule async notifications."""
        new_cfg = self.load()
        self._run_sync_and_schedule_async_callbacks(new_cfg, emit_event, source)
        return new_cfg

    async def async_reload(
        self, *, emit_event: bool = True, source: str = "manual"
    ) -> AppConfig:
        """Reload configuration and await all sync/async reload callbacks and bus broadcast."""
        new_cfg = self.load()
        await self._run_callbacks_async(new_cfg, emit_event, source)
        return new_cfg

    def raw_yaml_text(self, *, mask_secrets: bool = True) -> str:
        """Return YAML representation (preserving ${VAR_NAME} placeholders; masking literal secrets)."""
        with self._lock:
            if not mask_secrets and self._raw_yaml_cache:
                return self._raw_yaml_cache
            source_dict = self._raw_template or self._config.model_dump()
            if mask_secrets:
                source_dict = _mask_yaml_dict(source_dict)
            return _dump_yaml(source_dict)

    def validate_yaml(
        self, raw_yaml: str
    ) -> tuple[bool, list[str], list[str], AppConfig | None]:
        """Parse, interpolate, and validate raw YAML text without persisting it."""
        if not raw_yaml or not raw_yaml.strip():
            return False, ["YAML payload is empty."], [], None

        try:
            parsed = yaml.safe_load(raw_yaml)
        except yaml.YAMLError as exc:
            return False, [f"YAML syntax error: {exc}"], [], None

        if not isinstance(parsed, dict):
            return False, ["Root YAML document must be a key-value mapping."], [], None

        env_lookup = _build_env_lookup(self.env_file_path)
        unresolved: list[str] = []
        resolved = interpolate_env_vars(parsed, env_lookup, unresolved)
        config, errors, warnings = validate_app_config(resolved, unresolved)
        return len(errors) == 0, errors, warnings, config

    def _persist_raw_dict(
        self,
        raw_dict: dict[str, Any],
        *,
        rendered_text: str | None = None,
        emit_event: bool = True,
        source: str = "save",
    ) -> AppConfig:
        text = rendered_text if rendered_text is not None else _dump_yaml(raw_dict)
        env_lookup = _build_env_lookup(self.env_file_path)
        unresolved: list[str] = []
        resolved = interpolate_env_vars(raw_dict, env_lookup, unresolved)
        new_cfg = AppConfig.model_validate(resolved)

        with self._lock:
            write_text_safe(self.config_path, text, new_file_mode=0o600)
            self._raw_template = raw_dict
            self._raw_yaml_cache = text
            self._content_hash = _sha256_text(text)
            self._config = new_cfg
            self._is_synthesized = False
            self._config_exists = True

        self._run_sync_and_schedule_async_callbacks(new_cfg, emit_event, source)
        return new_cfg

    def save_raw_yaml(
        self,
        raw_yaml: str,
        *,
        emit_event: bool = True,
        source: str = "yaml_put",
    ) -> tuple[AppConfig, list[str]]:
        """Validate raw YAML, restore masked secrets if sent as ********, write atomically, and reload."""
        valid, errors, warnings, _ = self.validate_yaml(raw_yaml)
        if not valid:
            raise ValueError("; ".join(errors))

        parsed = yaml.safe_load(raw_yaml)
        assert isinstance(parsed, dict)

        with self._lock:
            existing_raw = self._raw_template if self._config_exists else {}
            prev_resolved = self._config.model_dump() if self._config_exists else {}

        # If editor left MASKED_SECRET_SENTINEL ("********") untouched, restore original raw value/template
        merged = _restore_masked_sentinels(existing_raw, parsed, prev_resolved)
        # Re-validate after restoring secrets
        env_lookup = _build_env_lookup(self.env_file_path)
        unresolved: list[str] = []
        resolved = interpolate_env_vars(merged, env_lookup, unresolved)
        validated_cfg, errors2, warnings2 = validate_app_config(resolved, unresolved)
        if validated_cfg is None or errors2:
            raise ValueError("; ".join(errors2))

        # Preserve user formatting/comments when no masked sentinel replacement changed the parsed dict
        text_to_write = raw_yaml if merged == parsed else _dump_yaml(merged)
        if not text_to_write.endswith("\n"):
            text_to_write += "\n"

        cfg = self._persist_raw_dict(
            merged,
            rendered_text=text_to_write,
            emit_event=emit_event,
            source=source,
        )
        return cfg, warnings2

    def save_config(
        self,
        new_config: AppConfig | Mapping[str, Any],
        *,
        preserve_templates: bool = True,
        emit_event: bool = True,
        source: str = "api_save",
    ) -> AppConfig:
        """Persist an AppConfig (or dict) to config.yaml while preserving ${VAR} templates and secrets."""
        incoming_dict = (
            new_config.model_dump()
            if isinstance(new_config, AppConfig)
            else dict(new_config)
        )
        with self._lock:
            existing_raw = self._raw_template
            prev_resolved = self._config.model_dump()

        if preserve_templates and existing_raw:
            final_dict = _merge_preserving_templates(existing_raw, incoming_dict, prev_resolved)
        else:
            final_dict = incoming_dict

        return self._persist_raw_dict(final_dict, emit_event=emit_event, source=source)

    def update_section(
        self,
        section: str,
        value: Any,
        *,
        preserve_templates: bool = True,
        emit_event: bool = True,
        source: str = "section_update",
    ) -> AppConfig:
        """Update a single top-level section of AppConfig and persist config.yaml atomically."""
        with self._lock:
            base = self._config.model_dump()
        if hasattr(value, "model_dump"):
            base[section] = value.model_dump()
        elif isinstance(value, list):
            base[section] = [
                item.model_dump() if hasattr(item, "model_dump") else item
                for item in value
            ]
        else:
            base[section] = value
        validated = AppConfig.model_validate(base)
        return self.save_config(
            validated,
            preserve_templates=preserve_templates,
            emit_event=emit_event,
            source=source,
        )

    async def start_watcher(self) -> None:
        """Start background watchfiles loop monitoring config.yaml (and legacy files if synthesized)."""
        if self._watcher_task is not None and not self._watcher_task.done():
            return
        self._stop_event = asyncio.Event()
        self._watcher_task = asyncio.create_task(self._watch_loop(), name="config-watcher")

    async def stop_watcher(self) -> None:
        """Stop background watchfiles loop cleanly."""
        if self._stop_event is not None:
            self._stop_event.set()
        if self._watcher_task is not None:
            try:
                await asyncio.wait_for(self._watcher_task, timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._watcher_task.cancel()
                try:
                    await self._watcher_task
                except asyncio.CancelledError:
                    pass
            self._watcher_task = None
            self._stop_event = None

    async def _watch_loop(self) -> None:
        assert self._stop_event is not None
        while not self._stop_event.is_set():
            cfg_path = self.config_path
            watch_dirs: list[Path] = []
            if cfg_path.parent.is_dir():
                watch_dirs.append(cfg_path.parent)
            if self._is_synthesized:
                for p in (self.env_file_path, resolve_services_yaml_path()):
                    if p.parent.is_dir() and p.parent not in watch_dirs:
                        watch_dirs.append(p.parent)

            if not watch_dirs:
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                break

            target_names = {
                cfg_path.name,
                self.env_file_path.name,
                resolve_services_yaml_path().name,
            }
            try:
                async for changes in awatch(*watch_dirs, stop_event=self._stop_event):
                    relevant = any(
                        Path(changed).name in target_names for _, changed in changes
                    )
                    if not relevant:
                        continue
                    if cfg_path.is_file():
                        new_hash = _sha256_text(cfg_path.read_text(encoding="utf-8"))
                        if new_hash == self.content_hash and not self._is_synthesized:
                            continue
                    await self.async_reload(emit_event=True, source="watchfiles")
            except asyncio.CancelledError:
                raise
            except Exception:
                if self._stop_event.is_set():
                    break
                await asyncio.sleep(1.0)


def _restore_masked_sentinels(
    existing_raw: dict[str, Any],
    parsed_yaml: dict[str, Any],
    prev_resolved: dict[str, Any],
) -> dict[str, Any]:
    """Replace '********' sentinels in PUT /api/config/yaml with existing raw template values."""
    if not existing_raw:
        return parsed_yaml
    copied = yaml.safe_load(yaml.safe_dump(parsed_yaml, sort_keys=False)) or {}
    if not isinstance(copied, dict):
        return parsed_yaml

    for path in _SCALAR_SECRET_PATHS:
        val = _get_nested(copied, path)
        if isinstance(val, str) and val.strip() == MASKED_SECRET_SENTINEL:
            existing_val = _get_nested(existing_raw, path)
            if existing_val is not None:
                _set_nested(copied, path, existing_val)

    existing_tokens = {
        t.get("id"): t
        for t in (_get_nested(existing_raw, ("security", "api_tokens")) or [])
        if isinstance(t, dict) and t.get("id")
    }
    for tok in _get_nested(copied, ("security", "api_tokens")) or []:
        if isinstance(tok, dict) and str(tok.get("token_hash", "")).strip() == MASKED_SECRET_SENTINEL:
            tid = tok.get("id")
            if tid in existing_tokens:
                tok["token_hash"] = existing_tokens[tid].get("token_hash", "")

    existing_wh = {
        w.get("id"): w
        for w in (_get_nested(existing_raw, ("notifications", "webhooks")) or [])
        if isinstance(w, dict) and w.get("id")
    }
    for wh in _get_nested(copied, ("notifications", "webhooks")) or []:
        if not isinstance(wh, dict) or wh.get("id") not in existing_wh:
            continue
        wid = wh["id"]
        if str(wh.get("bot_token", "")).strip() == MASKED_SECRET_SENTINEL:
            wh["bot_token"] = existing_wh[wid].get("bot_token", "")
        raw_headers = existing_wh[wid].get("headers") or {}
        inc_headers = wh.get("headers")
        if isinstance(inc_headers, dict) and isinstance(raw_headers, dict):
            for hk, hv in list(inc_headers.items()):
                if str(hv).strip() == MASKED_SECRET_SENTINEL and hk in raw_headers:
                    inc_headers[hk] = raw_headers[hk]

    existing_svcs = {
        s.get("id"): s
        for s in (existing_raw.get("custom_services") or [])
        if isinstance(s, dict) and s.get("id")
    }
    for svc in copied.get("custom_services") or []:
        if (
            isinstance(svc, dict)
            and str(svc.get("auth_token", "")).strip() == MASKED_SECRET_SENTINEL
            and svc.get("id") in existing_svcs
        ):
            svc["auth_token"] = existing_svcs[svc["id"]].get("auth_token", "")

    return copied


_manager_lock = threading.Lock()
_manager_instance: ConfigManager | None = None


def get_config_manager() -> ConfigManager:
    """Return process-wide singleton ConfigManager (creating it lazily)."""
    global _manager_instance
    with _manager_lock:
        if _manager_instance is None:
            _manager_instance = ConfigManager()
        return _manager_instance


def reset_config_manager() -> None:
    """Clear singleton ConfigManager (for tests or CONFIG_PATH overrides)."""
    global _manager_instance
    with _manager_lock:
        _manager_instance = None


def get_app_config() -> AppConfig:
    """Convenience accessor returning current validated AppConfig."""
    return get_config_manager().config


__all__ = [
    "CONFIG_PATH",
    "STATE_DB_PATH",
    "ConfigManager",
    "create_session_token",
    "get_app_config",
    "get_config_manager",
    "hash_pin",
    "hash_token",
    "interpolate_env_vars",
    "is_secret_configured",
    "reset_config_manager",
    "resolve_config_path",
    "resolve_env_file",
    "resolve_services_yaml_path",
    "resolve_state_db_path",
    "verify_pin",
    "verify_session_token",
    "verify_token_hash",
    "write_text_safe",
]
