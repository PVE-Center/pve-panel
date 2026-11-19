[English](configuration-reference.md) | [Français](../fr/configuration-reference.md)

# Configuration Reference

`pve-panel` supports declarative YAML configuration in `config/config.yaml` (validated by [`AppConfig`](../../backend/app/config_schema.py)) with automatic `${VAR_NAME}` / `${VAR_NAME:-default}` interpolation from `.env` and `os.environ`, plus transparent fallback for legacy `.env` + `services.yaml` setups.

---

## 1. Configuration File Resolution & Precedence

| Artifact | Resolution Order | Purpose |
|---|---|---|
| `config.yaml` | `CONFIG_PATH` env -> `/app/config/config.yaml` (if present or `/app` exists) -> `./config/config.yaml` | Primary declarative configuration |
| `state.db` | `STATE_DB_PATH` env -> `/app/config/state.db` -> `<config_dir>/state.db` | SQLite WAL DB for service states, incidents, heartbeats, APNs devices |
| `.env` | `ENV_FILE_PATH` env -> `/app/.env` -> `./.env` -> `../.env` -> `<repo>/.env` | Environment variables for `${VAR}` interpolation and legacy fallback |
| `services.yaml` | `SERVICES_CONFIG_PATH` env -> configured relative path -> `<repo>/services.yaml` -> `/app/services.yaml` | Legacy categorized tiles and storage mounts fallback |

Environment variable precedence during `${VAR}` interpolation: **`os.environ` overrides `.env`**.

---

## 2. `config/config.yaml` Schema Reference

See [`config/config.example.yaml`](../../config/config.example.yaml) for a complete annotated template.

### Top-Level Fields

| Key | Type | Default | Description |
|---|---|---|---|
| `version` | `int` (`>= 1`) | `1` | Declarative config schema version |

### `server`

| Field | Type | Default | Constraints / Notes |
|---|---|---|---|
| `id` | `str` | UUIDv4 | Unique server identifier (auto-generated if empty) |
| `name` | `str` | `"PVE Command Center"` | Display name in UI, QR links, and notifications |
| `listen_host` | `str` | `"0.0.0.0"` | Bind address (used by metadata / compose) |
| `listen_port` | `int` | `8000` | `1..65535` |
| `public_url` | `str` | `""` | External HTTPS URL (e.g. `https://pve-panel.example.ts.net`) used for QR metadata |
| `mdns_enabled` | `bool` | `true` | Enable `_pvecenter._tcp.local.` Bonjour advertisement |
| `mdns_service_name` | `str` | `"PVE Command Center"` | Sanitized Bonjour instance name (max 63 chars) |
| `mdns_service_type` | `str` | `"_pvecenter._tcp.local."` | Normalized to end with `.local.` |
| `refresh_interval_seconds` | `int` | `5` | `1..3600` |

### `security`

| Field | Type | Default | Notes |
|---|---|---|---|
| `tailscale_sso_enabled` | `bool` | `true` | Trust `Tailscale-User-Login` header on loopback connections |
| `allowed_tailscale_users` | `list[str]` (or CSV string) | `[]` | Lowercase allowlist of Tailscale login emails |
| `dev_auth_bypass` | `bool` | `false` | Allows unauthenticated loopback (`127.0.0.1` / `::1`) access for local development only |
| `protected_owner_username` | `str` | `"admin"` | Jellyfin username protected from disable/demote/delete in `/api/users` |
| `session_secret` | `str` | `""` | HS256 JWT signing secret (`${SESSION_SECRET}` recommended; ephemeral random secret used if empty) |
| `admin_pin_hash` | `str` | `""` | `pbkdf2_sha256$<salt>$<hex>` (200,000 iterations) or SHA-256 hash |
| `api_tokens` | `list[ApiTokenConfig]` | `[]` | Each entry: `{id, name, token_hash, role, created_at}` where `role` is `admin \| operator \| viewer \| device` |

### `proxmox`

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | `str` | `""` | Proxmox VE base URL (e.g. `https://192.168.1.10:8006`) |
| `token_id` | `str` | `""` | PVE API token ID (e.g. `root@pam!pve-panel`) |
| `token_secret` | `str` | `""` | PVE API token secret (`${PVE_TOKEN_SECRET}`) |
| `verify_ssl` | `bool` | `false` | Verify TLS certificate when talking to Proxmox VE |
| `default_node` | `str` | `"pve"` | Target Proxmox node name under `/api2/json/nodes/<node>` |
| `panel_self_vmid` | `int` | `116` | `>= 1`; protects this VMID from `stop` and `shutdown` actions |
| `mergerfs_pool_subpath` | `str` | `""` | Optional subpath under `HOST_MNT_ROOT` for your MergerFS pool (empty auto-detects) |

### `integrations`

Each built-in integration feeds `/api/widgets/*`, `/api/ops/*`, and `/api/users/*`:

| Integration | Fields |
|---|---|
| `jellyfin` | `url`, `api_key` |
| `jellyseerr` | `url`, `api_key` |
| `plex` | `url`, `token` (also accepts `api_key` alias on input) |
| `radarr` | `url`, `api_key` |
| `sonarr` | `url`, `api_key` |
| `prowlarr` | `url`, `api_key` |
| `qbittorrent` | `url`, `username`, `password` |

### `alerts`

| Field | Type | Default | Constraints |
|---|---|---|---|
| `enabled` | `bool` | `true` | Global alerting toggle |
| `default_consecutive_failures` | `int` | `3` | `1..100` failures before opening an incident & notifying |
| `default_cooldown_seconds` | `int` | `300` | `0..86400` minimum interval between repeated alerts |
| `check_interval_seconds` | `int` | `30` | `5..3600` default polling cadence |

### `notifications`

- **`notifications.apns`**:
  - `enabled` (`bool`, default `false`)
  - `team_id` (`str`), `key_id` (`str`)
  - `bundle_id` (`str`, default `"io.ac.pvepanel.app"`)
  - `private_key_path` (`str`, default `"/app/config/AuthKey.p8"`)
  - `use_sandbox` (`bool`, default `true`)
- **`notifications.webhooks[]`**:
  - `id` (`str`), `name` (`str`), `type` (`"discord" | "telegram" | "generic"`), `enabled` (`bool`, default `true`)
  - `url` (`str`, used by `discord` and `generic`)
  - `bot_token` (`str`), `chat_id` (`str`, used by `telegram`)
  - `headers` (`dict[str, str]`, used by `generic`, e.g. `Authorization: "Bearer ${NTFY_TOKEN}"`)
  - `notify_on_down` (`bool`, `true`), `notify_on_recovery` (`bool`, `true`), `include_details` (`bool`, `true`)

### `custom_services[]`

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | `str` | required | Unique slug identifier |
| `name` | `str` | required | Display title |
| `description` | `str` | `""` | Subtitle |
| `category` | `str` | `"Services"` | Group name in UI |
| `icon` | `str` | `"Globe"` | Brand icon ID, `lucide:<Name>`, or Lucide icon name |
| `protocol` | `ServiceProtocol` | `"http_rest"` | `http_rest \| tcp_port \| icmp_ping \| json_metrics \| webhook_ingest` |
| `host` | `str` | `""` | Hostname or IP (for `tcp_port`, `icmp_ping`, or host-only HTTP) |
| `port` | `int \| null` | `null` | `1..65535` (required when `protocol == "tcp_port"`) |
| `url` | `str` | `""` | User-facing URL |
| `health_url` | `str` | `""` | Probe URL (takes precedence over `internal_url` and `url`) |
| `internal_url` | `str` | `""` | Internal probe fallback URL |
| `auth_type` | `ServiceAuthType` | `"none"` | `none \| bearer \| basic \| header` |
| `auth_token` | `str` | `""` | Token/password (or `user:pass` / base64 for `basic`) |
| `auth_header_name` | `str` | `""` | Custom header name when `auth_type == "header"` (defaults to `X-API-Key`) |
| `json_metric_path` | `str` | `""` | Comma/semicolon/newline list of dotted paths or `alias=path` for `json_metrics` |
| `expected_status` | `int` | `200` | `100..599` expected HTTP status code |
| `refresh_interval_seconds` | `int` | `30` | `5..3600` polling interval |
| `order` | `int` | `0` | Display order |
| `enabled` | `bool` | `true` | Enables/disables probing & alerting |
| `verify_ssl` | `bool` | `false` | Verify TLS for this service |
| `webhook_ttl_seconds` | `int` | `300` | `10..86400` TTL for `webhook_ingest` heartbeats |
| `alert_policy` | `AlertPolicyConfig` | `{enabled: true, consecutive_failures: null, cooldown_seconds: null}` | Per-service overrides |

### `categories[]` & `storage_mounts[]`

- **`categories[]`**: Legacy service tiles (`name`, `services[]` with `id`, `name`, `description`, `url`, `ping_url`, `icon`, `widget`).
- **`storage_mounts[]`**: Physical disk mappings (`mount`, `subpath`, `wwn`, `label`) used to correlate `/host_mnt/<subpath>` `statvfs` usage with Proxmox SMART disk metadata. If empty, subdirectories under `HOST_MNT_ROOT` (excluding the active MergerFS pool subpath) are auto-discovered.

---

## 3. Environment Variables (`.env.example` & Runtime Overrides)

### Core Runtime Paths & Synthesized Fallbacks

| Variable | Default / Behavior | Notes |
|---|---|---|
| `CONFIG_PATH` | `/app/config/config.yaml` (Docker) or `./config/config.yaml` | Path to declarative YAML file |
| `STATE_DB_PATH` | `/app/config/state.db` (Docker) or `<config_dir>/state.db` | Path to SQLite WAL database |
| `ENV_FILE_PATH` | Auto-detected `.env` | Explicit `.env` path override |
| `SERVICES_CONFIG_PATH` | `../services.yaml` | Legacy `services.yaml` location |
| `STATIC_DIR` | Auto-detected (`/app/static` or `frontend/dist`) | Compiled SPA directory |
| `HOST_MNT_ROOT` | `/host_mnt` | Root directory for host disk/MergerFS bind mounts |
| `LISTEN_HOST` / `LISTEN_PORT` | `0.0.0.0` / `8000` | Uvicorn bind host/port & synthesized fallback |
| `SERVER_NAME`, `PUBLIC_URL`, `MDNS_ENABLED`, `MDNS_SERVICE_NAME`, `REFRESH_INTERVAL_SECONDS`, `TAILSCALE_SSO_ENABLED`, `SESSION_SECRET`, `ADMIN_PIN_HASH` | See `ConfigManager._synthesize_from_legacy` | Used when running without `config.yaml`, or via `${VAR}` interpolation |

### Variables Defined in `.env.example`

- **Auth & Paths**: `DEV_AUTH_BYPASS`, `ALLOWED_TAILSCALE_USERS`, `PROTECTED_OWNER_USERNAME`, `SERVICES_CONFIG_PATH`, `STATIC_DIR`
- **Proxmox VE**: `PVE_HOST`, `PVE_NODE`, `PVE_TOKEN_ID`, `PVE_TOKEN_SECRET`, `PVE_VERIFY_SSL`, `PANEL_SELF_VMID`, `MERGERFS_POOL_SUBPATH`
- **Media & Download Clients**: `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `JELLYSEERR_URL`, `JELLYSEERR_API_KEY`, `PLEX_URL`, `PLEX_TOKEN`, `RADARR_URL`, `RADARR_API_KEY`, `SONARR_URL`, `SONARR_API_KEY`, `PROWLARR_URL`, `PROWLARR_API_KEY`, `QBIT_URL`, `QBIT_USERNAME`, `QBIT_PASSWORD`
