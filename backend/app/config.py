"""Compatibility configuration wrapper delegating to declarative ConfigManager."""

from __future__ import annotations

from functools import lru_cache
import os
from pathlib import Path
import re
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict
import yaml

from app.config_manager import (
    get_config_manager,
    resolve_env_file,
    resolve_services_yaml_path,
    write_text_safe as _write_text_safe,
)
from app.config_schema import AppConfig, is_secret_configured

SECRET_ENV_KEYS = frozenset(
    {
        "PVE_TOKEN_SECRET",
        "JELLYFIN_API_KEY",
        "JELLYSEERR_API_KEY",
        "PLEX_TOKEN",
        "RADARR_API_KEY",
        "SONARR_API_KEY",
        "PROWLARR_API_KEY",
        "QBIT_PASSWORD",
    }
)

_ENV_LINE_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=.*$")
_TRANSIENT_SERVICE_KEYS = frozenset({"online", "latency_ms", "status_code"})
_REGISTERED_MANAGER_IDS: set[int] = set()


def _find_env_file() -> str | None:
    """Return existing .env path string for pydantic-settings default model_config."""
    path = resolve_env_file()
    return str(path) if path.is_file() else None


class Settings(BaseSettings):
    """Typed application settings backed by ConfigManager (config.yaml or .env + services.yaml)."""

    model_config = SettingsConfigDict(
        env_file=_find_env_file(),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    dev_auth_bypass: bool = False
    allowed_tailscale_users: str = ""
    protected_owner_username: str = "admin"

    services_config_path: str = "../services.yaml"
    static_dir: str = ""

    pve_host: str = "https://192.168.1.110:8006"
    pve_node: str = "pve"
    pve_token_id: str = ""
    pve_token_secret: str = ""
    pve_verify_ssl: bool = False
    panel_self_vmid: int = 116
    mergerfs_pool_subpath: str = ""

    jellyfin_url: str = ""
    jellyfin_api_key: str = ""

    jellyseerr_url: str = ""
    jellyseerr_api_key: str = ""

    plex_url: str = ""
    plex_token: str = ""

    radarr_url: str = ""
    radarr_api_key: str = ""

    sonarr_url: str = ""
    sonarr_api_key: str = ""

    prowlarr_url: str = ""
    prowlarr_api_key: str = ""

    qbit_url: str = ""
    qbit_username: str = ""
    qbit_password: str = ""

    @property
    def allowed_users_set(self) -> set[str]:
        """Normalized lowercase set of allowed Tailscale login emails."""
        return {
            u.strip().lower()
            for u in self.allowed_tailscale_users.split(",")
            if u.strip()
        }

    def resolve_services_yaml(self) -> Path:
        """Resolve services.yaml dynamically across dev and container layouts."""
        return resolve_services_yaml_path(self.services_config_path)

    def resolve_static_dir(self) -> Path | None:
        """Locate compiled React frontend static directory."""
        candidates: list[Path] = []
        if self.static_dir:
            candidates.append(Path(self.static_dir))
        env_static = os.environ.get("STATIC_DIR", "").strip()
        if env_static:
            candidates.append(Path(env_static))
        candidates.extend(
            [
                Path("/app/static"),
                Path(__file__).resolve().parents[2] / "frontend" / "dist",
            ]
        )
        for path in candidates:
            if path.is_dir() and (path / "index.html").is_file():
                return path
        return None


def _settings_from_app_config(cfg: AppConfig) -> Settings:
    """Project declarative AppConfig onto the legacy flat Settings interface."""
    return Settings.model_construct(
        dev_auth_bypass=cfg.security.dev_auth_bypass,
        allowed_tailscale_users=",".join(cfg.security.allowed_tailscale_users),
        protected_owner_username=cfg.security.protected_owner_username,
        services_config_path=os.environ.get("SERVICES_CONFIG_PATH", "../services.yaml"),
        static_dir=os.environ.get("STATIC_DIR", ""),
        pve_host=cfg.proxmox.host,
        pve_node=cfg.proxmox.default_node,
        pve_token_id=cfg.proxmox.token_id,
        pve_token_secret=cfg.proxmox.token_secret,
        pve_verify_ssl=cfg.proxmox.verify_ssl,
        panel_self_vmid=cfg.proxmox.panel_self_vmid,
        mergerfs_pool_subpath=cfg.proxmox.mergerfs_pool_subpath,
        jellyfin_url=cfg.integrations.jellyfin.url,
        jellyfin_api_key=cfg.integrations.jellyfin.api_key,
        jellyseerr_url=cfg.integrations.jellyseerr.url,
        jellyseerr_api_key=cfg.integrations.jellyseerr.api_key,
        plex_url=cfg.integrations.plex.url,
        plex_token=cfg.integrations.plex.token,
        radarr_url=cfg.integrations.radarr.url,
        radarr_api_key=cfg.integrations.radarr.api_key,
        sonarr_url=cfg.integrations.sonarr.url,
        sonarr_api_key=cfg.integrations.sonarr.api_key,
        prowlarr_url=cfg.integrations.prowlarr.url,
        prowlarr_api_key=cfg.integrations.prowlarr.api_key,
        qbit_url=cfg.integrations.qbittorrent.url,
        qbit_username=cfg.integrations.qbittorrent.username,
        qbit_password=cfg.integrations.qbittorrent.password,
    )


def _ensure_cache_invalidation_hook() -> None:
    manager = get_config_manager()
    mgr_id = id(manager)
    if mgr_id not in _REGISTERED_MANAGER_IDS:
        _REGISTERED_MANAGER_IDS.add(mgr_id)
        manager.on_reload(lambda _cfg: get_settings.cache_clear())


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached Settings projected from ConfigManager."""
    _ensure_cache_invalidation_hook()
    return _settings_from_app_config(get_config_manager().config)


def reload_settings() -> Settings:
    """Reload ConfigManager from disk/env, clear cached settings, and return fresh Settings."""
    get_config_manager().reload(emit_event=False, source="reload_settings")
    get_settings.cache_clear()
    return get_settings()


def is_configured(settings: Settings | None = None) -> bool:
    """Return True when panel has either Proxmox credentials or persisted config.yaml onboarding."""
    if settings is not None:
        host = settings.pve_host.strip()
        secret = settings.pve_token_secret.strip()
        return bool(host) and is_secret_configured(secret)

    manager = get_config_manager()
    cfg = manager.config
    proxmox_ok = bool(cfg.proxmox.host.strip()) and is_secret_configured(
        cfg.proxmox.token_secret
    )
    if proxmox_ok:
        return True
    if manager.config_exists and (
        bool(cfg.security.api_tokens)
        or bool(cfg.security.admin_pin_hash)
        or bool(cfg.custom_services)
    ):
        return True
    return False


def _format_env_value(raw: str) -> str:
    """Format a scalar string for .env, quoting only when needed."""
    if any(ch.isspace() or ch in {"#", '"', "'", "$"} for ch in raw):
        escaped = raw.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return raw


def update_env_file(updates: dict[str, Any]) -> Path:
    """Atomically update known Settings keys in .env while preserving comments."""
    env_path = resolve_env_file()
    allowed_keys = {field.upper() for field in Settings.model_fields}

    normalized: dict[str, str] = {}
    for raw_key, raw_val in updates.items():
        env_key = str(raw_key).strip().upper()
        if env_key not in allowed_keys or raw_val is None:
            continue
        if isinstance(raw_val, bool):
            str_val = "true" if raw_val else "false"
        else:
            str_val = str(raw_val).replace("\r", "").replace("\n", "")
            if env_key not in SECRET_ENV_KEYS:
                str_val = str_val.strip()

        if env_key in SECRET_ENV_KEYS and str_val.strip() == "":
            continue
        normalized[env_key] = str_val

    existing_lines = (
        env_path.read_text(encoding="utf-8").splitlines() if env_path.is_file() else []
    )
    if not normalized and env_path.is_file():
        return env_path

    new_lines: list[str] = []
    written_keys: set[str] = set()
    for line in existing_lines:
        match = _ENV_LINE_RE.match(line)
        if not match:
            new_lines.append(line)
            continue
        key = match.group(1)
        if key in normalized:
            if key not in written_keys:
                new_lines.append(f"{key}={_format_env_value(normalized[key])}")
                written_keys.add(key)
        else:
            new_lines.append(line)

    for key, val in normalized.items():
        if key not in written_keys:
            new_lines.append(f"{key}={_format_env_value(val)}")
            written_keys.add(key)

    rendered = "\n".join(new_lines) + ("\n" if new_lines else "")
    _write_text_safe(env_path, rendered, new_file_mode=0o600)

    # Docker env_file seeds os.environ at container startup, which overrides .env in pydantic-settings.
    for key, val in normalized.items():
        os.environ[key] = val

    get_config_manager().reload(emit_event=False, source="env_update")
    get_settings.cache_clear()
    return env_path


def _sanitize_categories(categories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for cat in categories:
        if not isinstance(cat, dict):
            continue
        raw_services = cat.get("services") or []
        services_list: list[dict[str, Any]] = []
        for svc in raw_services:
            if not isinstance(svc, dict):
                continue
            item = {
                k: v
                for k, v in svc.items()
                if k not in _TRANSIENT_SERVICE_KEYS and v is not None
            }
            if item.get("widget") == "":
                item.pop("widget", None)
            services_list.append(item)
        cleaned.append({"name": str(cat.get("name") or "Services"), "services": services_list})
    return cleaned


def _sanitize_storage_mounts(mounts: list[dict[str, Any]]) -> list[dict[str, str]]:
    cleaned: list[dict[str, str]] = []
    for mount in mounts:
        if not isinstance(mount, dict):
            continue
        subpath = str(mount.get("subpath") or "").strip()
        if not subpath:
            continue
        cleaned.append(
            {
                "mount": str(mount.get("mount") or f"/mnt/{subpath}").strip(),
                "subpath": subpath,
                "wwn": str(mount.get("wwn") or "").strip(),
                "label": str(mount.get("label") or f"Disque {subpath}").strip(),
            }
        )
    return cleaned


def _read_services_yaml_raw() -> dict[str, Any]:
    """Read raw services.yaml mapping dynamically without caching across edits."""
    yaml_path = get_settings().resolve_services_yaml()
    if not yaml_path.is_file():
        return {}
    with yaml_path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    return data if isinstance(data, dict) else {}


def save_services_yaml(
    categories: list[dict[str, Any]] | None = None,
    storage_mounts: list[dict[str, Any]] | None = None,
) -> Path:
    """Save services.yaml cleanly (and mirror into config.yaml if present)."""
    yaml_path = get_settings().resolve_services_yaml()
    existing = dict(_read_services_yaml_raw())

    sanitized_categories = (
        _sanitize_categories(categories) if categories is not None else None
    )
    sanitized_mounts = (
        _sanitize_storage_mounts(storage_mounts) if storage_mounts is not None else None
    )

    if sanitized_categories is not None:
        existing["categories"] = sanitized_categories
    if sanitized_mounts is not None:
        existing["storage_mounts"] = sanitized_mounts

    ordered: dict[str, Any] = {}
    for preferred_key in ("categories", "storage_mounts"):
        if preferred_key in existing:
            ordered[preferred_key] = existing.pop(preferred_key)
    ordered.update(existing)

    rendered = yaml.safe_dump(
        ordered,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
        indent=2,
    )
    _write_text_safe(yaml_path, rendered)

    manager = get_config_manager()
    if manager.config_exists:
        cfg_dict = manager.config.model_dump()
        if sanitized_categories is not None:
            cfg_dict["categories"] = sanitized_categories
        if sanitized_mounts is not None:
            cfg_dict["storage_mounts"] = sanitized_mounts
        manager.save_config(cfg_dict, preserve_templates=True, emit_event=False)
    else:
        manager.reload(emit_event=False, source="services_yaml_save")
    get_settings.cache_clear()
    return yaml_path


def persist_categories_config(
    categories: list[dict[str, Any]],
    *,
    source: str = "categories_edit",
) -> list[dict[str, Any]]:
    """Persist categorized service definitions to config.yaml or legacy services.yaml cleanly."""
    sanitized = _sanitize_categories(categories)
    manager = get_config_manager()
    if manager.config_exists:
        manager.update_section(
            "categories",
            sanitized,
            preserve_templates=True,
            emit_event=True,
            source=source,
        )
        get_settings.cache_clear()
    else:
        save_services_yaml(categories=sanitized)
    return load_services_config()


def load_services_config() -> list[dict[str, Any]]:
    """Read service categories from active ConfigManager (config.yaml or legacy services.yaml)."""
    return [
        cat.model_dump(exclude_none=True)
        for cat in get_config_manager().config.categories
    ]


def load_storage_mounts_config() -> list[dict[str, str]]:
    """Read physical storage mounts mapping from active ConfigManager."""
    return [
        mount.model_dump()
        for mount in get_config_manager().config.storage_mounts
        if mount.subpath
    ]
