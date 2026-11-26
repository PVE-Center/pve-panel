"""Declarative Pydantic v2 schema and semantic validators for PVE Command Center config.yaml."""

from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

MASKED_SECRET_SENTINEL = "********"
SECRET_PLACEHOLDER_PREFIX = "replace-with-"

ApiTokenRole = Literal["admin", "operator", "viewer", "device"]
WebhookType = Literal["discord", "telegram", "generic"]
ServiceProtocol = Literal["http_rest", "tcp_port", "icmp_ping", "json_metrics", "webhook_ingest"]
ServiceAuthType = Literal["none", "bearer", "basic", "header"]

ENV_VAR_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}")


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def is_secret_configured(value: str | None) -> bool:
    """Return True when a secret string is set and not a placeholder or mask sentinel."""
    cleaned = (value or "").strip()
    return (
        bool(cleaned)
        and not cleaned.startswith(SECRET_PLACEHOLDER_PREFIX)
        and cleaned != MASKED_SECRET_SENTINEL
        and not bool(ENV_VAR_PATTERN.fullmatch(cleaned))
    )


def is_masked_or_empty(value: Any) -> bool:
    """Return True if an incoming secret value should keep the existing stored secret."""
    if value is None:
        return True
    if not isinstance(value, str):
        return False
    stripped = value.strip()
    return stripped == "" or stripped == MASKED_SECRET_SENTINEL


def is_env_template(value: Any) -> bool:
    """Return True when a value contains an unexpanded ${VAR_NAME} placeholder."""
    return isinstance(value, str) and bool(ENV_VAR_PATTERN.search(value))


class ServerConfig(BaseModel):
    """Server identity, HTTP bind settings, and Bonjour/mDNS advertisement config."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = "PVE Command Center"
    listen_host: str = "0.0.0.0"
    listen_port: int = Field(default=8000, ge=1, le=65535)
    public_url: str = ""
    mdns_enabled: bool = True
    mdns_service_name: str = "PVE Command Center"
    mdns_service_type: str = "_pvecenter._tcp.local."
    refresh_interval_seconds: int = Field(default=5, ge=1, le=3600)

    @field_validator("id", mode="before")
    @classmethod
    def _ensure_id(cls, value: Any) -> str:
        text = str(value or "").strip()
        return text or str(uuid4())

    @field_validator("name", "listen_host", "public_url", "mdns_service_name", "mdns_service_type", mode="before")
    @classmethod
    def _coerce_str(cls, value: Any) -> str:
        return str(value or "").strip()


class ApiTokenConfig(BaseModel):
    """Hashed API bearer token entry stored in security.api_tokens."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(..., min_length=1)
    token_hash: str = Field(..., min_length=1)
    role: ApiTokenRole = "admin"
    created_at: str = Field(default_factory=utc_now_iso)

    @field_validator("id", mode="before")
    @classmethod
    def _ensure_id(cls, value: Any) -> str:
        text = str(value or "").strip()
        return text or str(uuid4())


class SecurityConfig(BaseModel):
    """DualAuth (Tailscale Serve SSO + Bearer API tokens / HMAC session + PIN) config."""

    model_config = ConfigDict(extra="ignore")

    tailscale_sso_enabled: bool = True
    allowed_tailscale_users: list[str] = Field(default_factory=list)
    dev_auth_bypass: bool = False
    protected_owner_username: str = "admin"
    session_secret: str = ""
    api_tokens: list[ApiTokenConfig] = Field(default_factory=list)
    admin_pin_hash: str = ""

    @field_validator("allowed_tailscale_users", mode="before")
    @classmethod
    def _normalize_allowed_users(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            raw_items = value.split(",")
        elif isinstance(value, (list, tuple, set)):
            raw_items = [str(item) for item in value if item is not None]
        else:
            return []
        normalized: list[str] = []
        seen: set[str] = set()
        for item in raw_items:
            cleaned = item.strip().lower()
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                normalized.append(cleaned)
        return normalized


class ProxmoxConfig(BaseModel):
    """Proxmox VE API connection configuration."""

    model_config = ConfigDict(extra="ignore")

    host: str = ""
    token_id: str = ""
    token_secret: str = ""
    verify_ssl: bool = False
    default_node: str = "pve"
    panel_self_vmid: int = Field(default=116, ge=1)
    mergerfs_pool_subpath: str = ""

    @field_validator("host", "token_id", "default_node", mode="before")
    @classmethod
    def _strip_str(cls, value: Any) -> str:
        return str(value or "").strip()

    @field_validator("mergerfs_pool_subpath", mode="before")
    @classmethod
    def _normalize_pool_subpath(cls, value: Any) -> str:
        cleaned = str(value or "").strip().strip("/")
        parts = [p for p in cleaned.split("/") if p]
        if not parts or any(p in (".", "..") for p in parts):
            return ""
        return "/".join(parts)

    @field_validator("token_secret", mode="before")
    @classmethod
    def _coerce_secret(cls, value: Any) -> str:
        return "" if value is None else str(value)


class UrlApiKeyIntegration(BaseModel):
    """Generic URL + API key integration block."""

    model_config = ConfigDict(extra="ignore")

    url: str = ""
    api_key: str = ""

    @field_validator("url", mode="before")
    @classmethod
    def _strip_url(cls, value: Any) -> str:
        return str(value or "").strip()

    @field_validator("api_key", mode="before")
    @classmethod
    def _coerce_key(cls, value: Any) -> str:
        return "" if value is None else str(value)


class PlexIntegration(BaseModel):
    """Plex Media Server integration configuration."""

    model_config = ConfigDict(extra="ignore")

    url: str = ""
    token: str = ""

    @model_validator(mode="before")
    @classmethod
    def _accept_api_key_alias(cls, data: Any) -> Any:
        if isinstance(data, dict) and not data.get("token") and data.get("api_key"):
            copied = dict(data)
            copied["token"] = copied["api_key"]
            return copied
        return data

    @field_validator("url", mode="before")
    @classmethod
    def _strip_url(cls, value: Any) -> str:
        return str(value or "").strip()

    @field_validator("token", mode="before")
    @classmethod
    def _coerce_token(cls, value: Any) -> str:
        return "" if value is None else str(value)


class QBittorrentIntegration(BaseModel):
    """qBittorrent WebUI integration configuration."""

    model_config = ConfigDict(extra="ignore")

    url: str = ""
    username: str = ""
    password: str = ""

    @field_validator("url", "username", mode="before")
    @classmethod
    def _strip_fields(cls, value: Any) -> str:
        return str(value or "").strip()

    @field_validator("password", mode="before")
    @classmethod
    def _coerce_password(cls, value: Any) -> str:
        return "" if value is None else str(value)


class IntegrationsConfig(BaseModel):
    """Built-in homelab media & download integrations."""

    model_config = ConfigDict(extra="ignore")

    jellyfin: UrlApiKeyIntegration = Field(default_factory=UrlApiKeyIntegration)
    jellyseerr: UrlApiKeyIntegration = Field(default_factory=UrlApiKeyIntegration)
    plex: PlexIntegration = Field(default_factory=PlexIntegration)
    radarr: UrlApiKeyIntegration = Field(default_factory=UrlApiKeyIntegration)
    sonarr: UrlApiKeyIntegration = Field(default_factory=UrlApiKeyIntegration)
    prowlarr: UrlApiKeyIntegration = Field(default_factory=UrlApiKeyIntegration)
    qbittorrent: QBittorrentIntegration = Field(default_factory=QBittorrentIntegration)


class AlertsConfig(BaseModel):
    """Global alerting engine defaults."""

    model_config = ConfigDict(extra="ignore")

    enabled: bool = True
    default_consecutive_failures: int = Field(default=3, ge=1, le=100)
    default_cooldown_seconds: int = Field(default=300, ge=0, le=86400)
    check_interval_seconds: int = Field(default=30, ge=5, le=3600)


class APNsConfig(BaseModel):
    """Apple Push Notification service configuration."""

    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    team_id: str = ""
    key_id: str = ""
    bundle_id: str = "io.ac.pvepanel.app"
    private_key_path: str = "/app/config/AuthKey.p8"
    use_sandbox: bool = True

    @field_validator("team_id", "key_id", "bundle_id", "private_key_path", mode="before")
    @classmethod
    def _strip_fields(cls, value: Any) -> str:
        return str(value or "").strip()


class WebhookChannelConfig(BaseModel):
    """Configured outbound notification webhook (Discord, Telegram, or Generic)."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(..., min_length=1)
    type: WebhookType
    enabled: bool = True
    url: str = ""
    bot_token: str = ""
    chat_id: str = ""
    headers: dict[str, str] = Field(default_factory=dict)
    notify_on_down: bool = True
    notify_on_recovery: bool = True
    include_details: bool = True

    @field_validator("id", mode="before")
    @classmethod
    def _ensure_id(cls, value: Any) -> str:
        text = str(value or "").strip()
        return text or str(uuid4())

    @field_validator("headers", mode="before")
    @classmethod
    def _coerce_headers(cls, value: Any) -> dict[str, str]:
        if not isinstance(value, dict):
            return {}
        return {str(k): str(v) for k, v in value.items() if v is not None}


class NotificationsConfig(BaseModel):
    """APNs and webhook notification channels."""

    model_config = ConfigDict(extra="ignore")

    apns: APNsConfig = Field(default_factory=APNsConfig)
    webhooks: list[WebhookChannelConfig] = Field(default_factory=list)


class AlertPolicyConfig(BaseModel):
    """Per-service override for alerting thresholds."""

    model_config = ConfigDict(extra="ignore")

    enabled: bool = True
    consecutive_failures: int | None = Field(default=None, ge=1, le=100)
    cooldown_seconds: int | None = Field(default=None, ge=0, le=86400)


class CustomServiceConfig(BaseModel):
    """Extensible user-defined service monitored by connectors and the alert engine."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    description: str = ""
    category: str = "Services"
    icon: str = "Globe"
    protocol: ServiceProtocol = "http_rest"
    host: str = ""
    port: int | None = Field(default=None, ge=1, le=65535)
    url: str = ""
    health_url: str = ""
    internal_url: str = ""
    auth_type: ServiceAuthType = "none"
    auth_token: str = ""
    auth_header_name: str = ""
    json_metric_path: str = ""
    expected_status: int = Field(default=200, ge=100, le=599)
    refresh_interval_seconds: int = Field(default=30, ge=5, le=3600)
    order: int = 0
    enabled: bool = True
    verify_ssl: bool = False
    webhook_ttl_seconds: int = Field(default=300, ge=10, le=86400)
    alert_policy: AlertPolicyConfig = Field(default_factory=AlertPolicyConfig)

    @field_validator("id", "name", "category", "icon", "host", "url", "health_url", "internal_url", "auth_header_name", "json_metric_path", mode="before")
    @classmethod
    def _strip_text(cls, value: Any) -> str:
        return str(value or "").strip()

    @field_validator("auth_token", mode="before")
    @classmethod
    def _coerce_token(cls, value: Any) -> str:
        return "" if value is None else str(value)


class CategoryServiceConfig(BaseModel):
    """Legacy services.yaml service entry within a category."""

    model_config = ConfigDict(extra="allow")

    id: str = ""
    name: str = "Service"
    description: str = ""
    url: str = ""
    ping_url: str = ""
    icon: str = "Server"
    widget: str | None = None

    @model_validator(mode="after")
    def _ensure_id(self) -> "CategoryServiceConfig":
        if not self.id.strip():
            slug = re.sub(r"[^a-z0-9]+", "-", self.name.lower()).strip("-")
            self.id = slug or str(uuid4())[:8]
        return self

    @field_validator("widget", mode="before")
    @classmethod
    def _empty_widget_to_none(cls, value: Any) -> str | None:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None


class ServiceCategoryConfig(BaseModel):
    """Legacy services.yaml category group."""

    model_config = ConfigDict(extra="ignore")

    name: str = "Services"
    services: list[CategoryServiceConfig] = Field(default_factory=list)


class StorageMountConfig(BaseModel):
    """Physical disk mount mapping for SMART / disk usage correlation."""

    model_config = ConfigDict(extra="ignore")

    mount: str = ""
    subpath: str = Field(..., min_length=1)
    wwn: str = ""
    label: str = ""

    @model_validator(mode="after")
    def _fill_defaults(self) -> "StorageMountConfig":
        self.subpath = self.subpath.strip()
        self.mount = self.mount.strip() or f"/mnt/{self.subpath}"
        self.wwn = self.wwn.strip()
        self.label = self.label.strip() or f"Disque {self.subpath}"
        return self


UpdateDockerScope = Literal["local", "proxmox_host", "lxc", "qemu"]
_VALID_ABS_UNIX_DIR_RE = re.compile(r"^/[A-Za-z0-9._/@+-]+$")


class DockerUpdateTargetConfig(BaseModel):
    """Configured Docker Compose stack target for centralized updates."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid4())[:8])
    name: str = Field(..., min_length=1)
    enabled: bool = True
    scope: UpdateDockerScope = "lxc"
    node: str = ""
    vmid: int | None = Field(default=None, ge=1)
    compose_dir: str = Field(..., min_length=2)

    @field_validator("id", "name", "node", mode="before")
    @classmethod
    def _strip_fields(cls, value: Any) -> str:
        return str(value or "").strip()

    @field_validator("compose_dir", mode="before")
    @classmethod
    def _validate_compose_dir(cls, value: Any) -> str:
        cleaned = str(value or "").strip().rstrip("/") or "/"
        parts = cleaned.split("/")
        if (
            not _VALID_ABS_UNIX_DIR_RE.fullmatch(cleaned)
            or ".." in parts
            or cleaned == "/"
        ):
            raise ValueError(
                "compose_dir must be a safe non-root absolute POSIX directory path."
            )
        return cleaned


class UpdatesConfig(BaseModel):
    """Centralized Update Center settings (Proxmox SSH automation, PVE Panel & Docker targets)."""

    model_config = ConfigDict(extra="ignore")

    enabled: bool = True
    github_org: str = "PVE-Center"
    ssh_host: str = ""
    ssh_port: int = Field(default=22, ge=1, le=65535)
    ssh_user: str = "root"
    ssh_key_path: str = ""
    panel_repo_dir: str = "/opt/pve-panel"
    auto_autoremove: bool = True
    docker_targets: list[DockerUpdateTargetConfig] = Field(default_factory=list)

    @field_validator(
        "github_org", "ssh_host", "ssh_user", "ssh_key_path", "panel_repo_dir", mode="before"
    )
    @classmethod
    def _strip_text(cls, value: Any) -> str:
        return str(value or "").strip()


class AppConfig(BaseModel):
    """Complete declarative configuration model for PVE Command Center."""

    model_config = ConfigDict(extra="ignore")

    version: int = Field(default=1, ge=1)
    server: ServerConfig = Field(default_factory=ServerConfig)
    security: SecurityConfig = Field(default_factory=SecurityConfig)
    proxmox: ProxmoxConfig = Field(default_factory=ProxmoxConfig)
    integrations: IntegrationsConfig = Field(default_factory=IntegrationsConfig)
    alerts: AlertsConfig = Field(default_factory=AlertsConfig)
    notifications: NotificationsConfig = Field(default_factory=NotificationsConfig)
    updates: UpdatesConfig = Field(default_factory=UpdatesConfig)
    categories: list[ServiceCategoryConfig] = Field(default_factory=list)
    custom_services: list[CustomServiceConfig] = Field(default_factory=list)
    storage_mounts: list[StorageMountConfig] = Field(default_factory=list)


def format_pydantic_errors(exc: ValidationError) -> list[str]:
    """Convert Pydantic ValidationError into concise readable field error strings."""
    errors: list[str] = []
    for err in exc.errors():
        loc = ".".join(str(part) for part in err.get("loc", ()))
        msg = str(err.get("msg", "Invalid value"))
        errors.append(f"{loc}: {msg}" if loc else msg)
    return errors


def validate_app_config(
    resolved_data: dict[str, Any],
    unresolved_vars: list[str] | None = None,
) -> tuple[AppConfig | None, list[str], list[str]]:
    """Validate an interpolated config dictionary and return (config, errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []

    if unresolved_vars:
        uniq = sorted(set(unresolved_vars))
        warnings.append(
            f"Unresolved environment variables referenced in YAML: {', '.join(uniq)}"
        )

    try:
        config = AppConfig.model_validate(resolved_data)
    except ValidationError as exc:
        return None, format_pydantic_errors(exc), warnings

    # Duplicate ID checks
    seen_services: set[str] = set()
    for idx, svc in enumerate(config.custom_services):
        if svc.id in seen_services:
            errors.append(f"custom_services[{idx}].id: Duplicate custom service id '{svc.id}'.")
        seen_services.add(svc.id)
        if svc.enabled:
            if svc.protocol in ("http_rest", "json_metrics") and not (
                svc.health_url or svc.internal_url or svc.url
            ):
                warnings.append(
                    f"custom_services[{idx}] ({svc.id}): Enabled {svc.protocol} service has no url/health_url/internal_url."
                )
            elif svc.protocol in ("tcp_port", "icmp_ping") and not svc.host:
                warnings.append(
                    f"custom_services[{idx}] ({svc.id}): Enabled {svc.protocol} service has no host."
                )
            if svc.protocol == "tcp_port" and svc.port is None:
                errors.append(
                    f"custom_services[{idx}].port: tcp_port service '{svc.id}' requires a port."
                )

    seen_webhooks: set[str] = set()
    for idx, wh in enumerate(config.notifications.webhooks):
        if wh.id in seen_webhooks:
            errors.append(f"notifications.webhooks[{idx}].id: Duplicate webhook id '{wh.id}'.")
        seen_webhooks.add(wh.id)
        if wh.enabled:
            if wh.type == "telegram" and (not wh.bot_token or not wh.chat_id):
                warnings.append(
                    f"notifications.webhooks[{idx}] ({wh.id}): Telegram channel missing bot_token or chat_id."
                )
            elif wh.type in ("discord", "generic") and not wh.url:
                warnings.append(
                    f"notifications.webhooks[{idx}] ({wh.id}): {wh.type} channel missing url."
                )

    seen_tokens: set[str] = set()
    for idx, tok in enumerate(config.security.api_tokens):
        if tok.id in seen_tokens:
            errors.append(f"security.api_tokens[{idx}].id: Duplicate token id '{tok.id}'.")
        seen_tokens.add(tok.id)

    seen_docker: set[str] = set()
    for idx, target in enumerate(config.updates.docker_targets):
        if target.id in seen_docker:
            errors.append(f"updates.docker_targets[{idx}].id: Duplicate docker target id '{target.id}'.")
        seen_docker.add(target.id)

    if config.security.dev_auth_bypass:
        warnings.append("security.dev_auth_bypass is true (loopback auth disabled — never use in production).")

    if config.notifications.apns.enabled and (
        not config.notifications.apns.team_id or not config.notifications.apns.key_id
    ):
        warnings.append("notifications.apns is enabled but team_id or key_id is empty.")

    if errors:
        return None, errors, warnings
    return config, errors, warnings
