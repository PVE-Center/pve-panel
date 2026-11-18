[English](api-reference.md) | [Français](../fr/api-reference.md)

# API Reference (REST, WebSocket & SSE)

All API endpoints are served under `/api` by FastAPI (`backend/app/main.py`). Swagger/ReDoc UIs are disabled (`docs_url=None`, `redoc_url=None`) for security.

---

## 1. Authentication, RBAC Roles & Public Exemptions

Every protected route is guarded by `TailscaleSSOMiddleware` (`backend/app/middleware/tailscale_auth.py`):

- **Loopback (`127.0.0.1` / `::1`)**: `Tailscale-User-Login` header (allowlisted in `security.allowed_tailscale_users`), `Authorization: Bearer <token>`, or `dev_auth_bypass: true`.
- **Non-loopback (LAN / Remote)**: `Authorization: Bearer <api_token_or_session_jwt>` (for WebSocket/SSE, `?token=<token>` query parameter is also accepted).
- **Role Scoping (`role` claim / token role)**:
  - `admin`: full read/write access (configuration YAML, API tokens, onboarding, PIN rotation, users, operations).
  - `operator` / `device`: read endpoints + operational writes (`/api/pve/*`, `/api/ops/*`, `/api/incidents/*`, service probes & push device registration); configuration writes and token/YAML reads return `403`.
  - `viewer`: read-only telemetry (`GET`/`HEAD`) + push device registration; write routes return `403`.
- **Always Public**:
  - `GET /api/health`
  - `POST /api/auth/login`
  - `/api/pairing/*`
  - `GET /api/onboarding/status`
  - `POST /api/custom-services/{service_id}/webhook` (validates service-specific token if `auth_type != "none"`)
- **Public Only Before Initial Setup (`is_configured == false`)**:
  - `POST /api/onboarding/init`, `GET /api/setup/status`, `POST /api/setup/test-service`, `PUT /api/setup/config`, `GET /api/discovery/lan`.

---

## 2. Health & Realtime Streams

| Method / Proto | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Returns `{status, version, server_id, server_name, is_configured, config_hash}` |
| `WS` | `/api/ws/events` | Auth (or `?token=`) | Real-time JSON event stream (`25s` server `ping`, accepts `"pong"` / `{"type": "pong"}`; closes with `4401` if unauthenticated) |
| `GET` | `/api/events/stream` | Auth (or `?token=`) | Server-Sent Events (`text/event-stream`) emitting `data: {...}` events and `: keepalive` every `25s` |

Event envelope format:
```json
{
  "type": "service_status_changed",
  "timestamp": "2026-11-18T10:00:00Z",
  "payload": {}
}
```
Supported event types: `config_reloaded`, `service_status_changed`, `alert_triggered`, `alert_resolved`, `incident_acknowledged`, `pairing_completed`, `ping`.

---

## 3. Authentication, Sessions, PIN & API Tokens

| Method | Path | Role / Auth | Description |
|---|---|---|---|
| `GET` | `/api/me` | Auth | Returns current user object (`login`, `name`, `profile_pic`, `auth_mode`, `role`) |
| `POST` | `/api/auth/login` | Public (rate-limited: `10` fails / `60s`) | Body `{pin?, api_token?, token?}` -> returns HS256 session JWT `{ok, access_token, token_type, expires_in: 86400, expires_at, user}` |
| `GET` | `/api/auth/tokens` | Admin | Lists API token metadata (`id`, `name`, `role`, `created_at`) without hashes |
| `POST` | `/api/auth/tokens` | Admin | Body `{name, role}` (`admin \| operator \| viewer \| device`) -> returns plaintext `pve_...` token once |
| `DELETE` | `/api/auth/tokens/{token_id}` | Admin | Revokes and removes a token from `config.yaml` |
| `PUT` | `/api/auth/pin` | Admin | Body `{pin}` (`4..32` chars) -> updates `PBKDF2-HMAC-SHA256` hash in `security.admin_pin_hash` |

---

## 4. Onboarding, Declarative YAML Config & Legacy Setup

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/onboarding/status` | Public | Returns `{is_configured, needs_onboarding, config_exists, is_synthesized, server_id, server_name, public_url, tailscale_sso_enabled, pin_configured, api_tokens_count, auth_methods}` |
| `POST` | `/api/onboarding/init` | First-run public; Admin once configured | Writes `config.yaml` and mints the initial admin `pve_...` token (`api_token`) |
| `GET` | `/api/config/yaml` | Admin | Returns `{yaml, hash, is_synthesized, config_exists, secrets_masked, parsed_summary}` |
| `POST` | `/api/config/validate` | Admin | Body `{yaml}` -> returns `{valid, errors, warnings, parsed_summary}` without writing |
| `PUT` | `/api/config/yaml` | Admin | Body `{yaml}` -> validates, restores `********` masked secrets, persists atomically, and hot-reloads |
| `GET` | `/api/config/export` | Admin | Downloads masked `config.yaml` snapshot (`application/x-yaml`) |
| `GET` | `/api/setup/status` | First-run public / Auth | Returns `{is_configured, server_id, server_name, tailscale_url, pairing_deep_link, env, categories, storage_mounts}` (secrets exposed only as `*_set` booleans) |
| `POST` | `/api/setup/test-service` | First-run public / Auth | Live HTTP connectivity probe for `proxmox`, `jellyfin`, `jellyseerr`, `plex`, `radarr`, `sonarr`, `prowlarr`, or `qbittorrent` |
| `PUT` | `/api/setup/config` | First-run public / Auth | Updates `config.yaml` (or `.env` + `services.yaml`) and hot-reloads settings |

---

## 5. Proxmox VE Cluster & Storage

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/pve/nodes` | Auth | Lists all Proxmox VE cluster nodes with `status`, `online`, `cpu_pct`, `mem_pct`, and `uptime` |
| `GET` | `/api/pve/overview` | Auth | Optional `?node=<name> \| * \| all`: returns `{online, selected_node, failover_active, cluster_nodes, node, counts, resources, external_storage}` |
| `POST` | `/api/pve/{vm_type}/{vmid}/{action}` | Operator / Admin | Optional `?node=<name>`; `vm_type`: `lxc \| qemu`; `action`: `start \| stop \| reboot \| shutdown` (`400` if `vmid == panel_self_vmid`) |

---

## 6. Categorized Services, Widgets & Custom Connectors

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/services` | Auth | Runs concurrent healthchecks across `categories` and `custom_services` |
| `PUT` | `/api/services/items/{service_id}` | Auth | Updates a categorized tile (`name`, `description`, `url`, `ping_url`, `icon`, `widget`, `category`) |
| `POST` | `/api/services/items/{service_id}/move` | Auth | Body `{direction: "up" \| "down"}` -> reorders tile within its category |
| `POST` | `/api/services/items/{service_id}/test` | Auth | Live dry-run HTTP check for a categorized service (`url`, `ping_url`) |
| `DELETE` | `/api/services/items/{service_id}` | Auth | Removes a tile from its category |
| `GET` | `/api/widgets/all` | Auth | Returns live metrics for all configured built-in widgets concurrently |
| `GET` | `/api/widgets/{widget_name}` | Auth | Fetches live metrics for `jellyfin`, `plex`, `radarr`, `sonarr`, `prowlarr`, or `qbittorrent` |
| `GET` | `/api/custom-services` | Auth | Lists custom services with live connector status, latency, and cached state |
| `POST` | `/api/custom-services` | Auth | Creates a custom service in `config.yaml` (`201`) |
| `POST` | `/api/custom-services/reorder` | Auth | Body `{service_ids}` (or `ids` / `order`) -> updates `order` indices |
| `PUT` | `/api/custom-services/{service_id}` | Auth | Updates a custom service while keeping masked/blank `auth_token` |
| `DELETE` | `/api/custom-services/{service_id}` | Auth | Deletes a custom service from `config.yaml` |
| `POST` | `/api/custom-services/{service_id}/test` | Auth | Runs live dry-run probe (`http_rest`, `tcp_port`, `icmp_ping`, `json_metrics`, `webhook_ingest`) |
| `POST` | `/api/custom-services/{service_id}/webhook` | Service Token (if configured) | Ingests heartbeat `{status?, message?, metrics?, ttl_seconds?}` (auth via `Authorization: Bearer`, custom `auth_header_name`, `x-webhook-token`, `x-api-key`, or `?token=`) |

---

## 7. Incidents & Notifications

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/incidents` | Auth | Query `?active_only=false&limit=50&service_id=` -> returns `{incidents, count, active_count, service_states}` |
| `POST` | `/api/incidents/{incident_id}/ack` | Auth | Marks incident as acknowledged and emits `incident_acknowledged` |
| `POST` | `/api/incidents/services/{service_id}/mute` | Auth | Body `{minutes: 60}` (`1..43200`) -> mutes alerts for that service |
| `DELETE` | `/api/incidents/services/{service_id}/mute` | Auth | Clears active mute window for a service |
| `POST` | `/api/notifications/devices` | Auth | Registers/updates APNs device token (`device_token`, `platform`, `device_name`, `app_version`, `environment`) |
| `DELETE` | `/api/notifications/devices/{token}` | Auth | Unregisters an APNs device token |
| `GET` | `/api/notifications/channels` | Auth | Returns APNs status/devices and masked webhook channels |
| `PUT` | `/api/notifications/channels` | Auth | Updates APNs config and/or webhook channels in `config.yaml` while preserving secrets |
| `POST` | `/api/notifications/test` | Auth | Body `{channel_id?, channel_type: "all", title?, message?}` -> dispatches a test alert |

---

## 8. Operations & Unified User Management

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/ops/overview` | Auth | Returns `{pve_tasks, seerr_requests, qbit_control}` concurrently |
| `POST` | `/api/ops/seerr/{request_id}/{decision}` | Auth | `decision`: `approve \| decline` on Jellyseerr request |
| `POST` | `/api/ops/qbit/toggle-speed-mode` | Auth | Toggles qBittorrent alternative speed limits (Turtle Mode) |
| `POST` | `/api/ops/qbit/torrent/{torrent_hash}/{action}` | Auth | `action`: `pause \| resume` (supports qBittorrent v4 and v5 endpoints) |
| `POST` | `/api/ops/media/scan/{target}` | Auth | `target`: `jellyfin \| plex` -> triggers library refresh |
| `GET` | `/api/users` | Auth | Lists Jellyfin users, media libraries, and Jellyseerr sync/permission status |
| `POST` | `/api/users` | Auth | Creates Jellyfin user, applies policy, and optionally imports to Jellyseerr |
| `POST` | `/api/users/sync` | Auth | Imports missing (or specified) Jellyfin users into Jellyseerr |
| `PATCH` | `/api/users/{jellyfin_id}` | Auth | Updates Jellyfin policy flags & Jellyseerr auto-approve (blocks disabling/demoting `protected_owner_username`) |
| `POST` | `/api/users/{jellyfin_id}/password` | Auth | Resets and sets a Jellyfin user's password |
| `DELETE` | `/api/users/{jellyfin_id}` | Auth | Deletes user from Jellyseerr and Jellyfin (blocks deleting `protected_owner_username`) |

---

## 9. LAN Discovery & Apple TV Encrypted Pairing Relay

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/discovery/lan` | First-run public / Auth | Query `?timeout=2.0` (`0.5..4.0`) -> async mDNS LAN scan returning discovered services with `suggested_protocol` |
| `GET` | `/api/discovery/qr` | Auth | Returns `{deep_link, onboarding_link, public_url, server_id, server_name, mdns_service_type, lan_ip, port}` |
| `POST` | `/api/pairing/sessions` | Public | Body `{public_key, device_name}` -> creates 6-digit PIN session (`300s` TTL) |
| `GET` | `/api/pairing/sessions/{pin}` | Public (rate-limited) | Returns receiver `public_key`, `device_name`, `expires_at`, `completed` |
| `POST` | `/api/pairing/sessions/{pin}/complete` | Public (rate-limited) | Body `{sender_public_key, nonce, ciphertext, tag}` -> stores encrypted bundle and emits `pairing_completed` |
| `GET` | `/api/pairing/sessions/{pin}/payload` | Public (rate-limited) | Consumes encrypted bundle once and destroys the ephemeral session (`425` if pending) |

---

## 10. Prometheus Observability

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/metrics` | Auth (`viewer`+) | Prometheus text format (`0.0.4`) exposing `pve_center_up`, `pve_custom_service_up`, `pve_custom_service_latency_ms`, `pve_incidents_active_total`, `pve_node_*`, and `pve_guest_up` |
| `GET` | `/api/metrics/prometheus` | Auth (`viewer`+) | Alias under `/api` returning the same Prometheus payload |
