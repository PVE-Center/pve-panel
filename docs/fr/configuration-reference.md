[English](../en/configuration-reference.md) | [Français](configuration-reference.md)

# Référence de configuration

`pve-panel` utilise une configuration déclarative YAML dans `config/config.yaml` (validée par [`AppConfig`](../../backend/app/config_schema.py)) avec interpolation automatique `${VAR_NAME}` / `${VAR_NAME:-default}` depuis `.env` et `os.environ`, ainsi qu'un repli transparent sur les installations `.env` + `services.yaml`.

---

## 1. Résolution des fichiers & Priorité

| Fichier | Ordre de résolution | Rôle |
|---|---|---|
| `config.yaml` | `CONFIG_PATH` -> `/app/config/config.yaml` (si présent ou si `/app` existe) -> `./config/config.yaml` | Configuration déclarative principale |
| `state.db` | `STATE_DB_PATH` -> `/app/config/state.db` -> `<dossier_config>/state.db` | Base SQLite WAL (états, incidents, heartbeats, appareils APNs) |
| `.env` | `ENV_FILE_PATH` -> `/app/.env` -> `./.env` -> `../.env` -> `<repo>/.env` | Variables pour interpolation `${VAR}` et repli hérité |
| `services.yaml` | `SERVICES_CONFIG_PATH` -> chemin configuré -> `<repo>/services.yaml` -> `/app/services.yaml` | Repli hérité pour catégories et points de montage |

Priorité lors de l'interpolation `${VAR}` : **`os.environ` prime sur `.env`**.

---

## 2. Référence du schéma `config/config.yaml`

Consultez [`config/config.example.yaml`](../../config/config.example.yaml) pour un modèle complet commenté.

### Racine

| Clé | Type | Défaut | Description |
|---|---|---|---|
| `version` | `int` (`>= 1`) | `1` | Version du schéma déclaratif |

### `server`

| Champ | Type | Défaut | Contraintes / Notes |
|---|---|---|---|
| `id` | `str` | UUIDv4 | Identifiant unique du serveur (généré si vide) |
| `name` | `str` | `"PVE Command Center"` | Nom affiché dans l'UI, liens QR et alertes |
| `listen_host` | `str` | `"0.0.0.0"` | Adresse d'écoute |
| `listen_port` | `int` | `8000` | `1..65535` |
| `public_url` | `str` | `""` | URL HTTPS publique (ex. `https://pve-panel.example.ts.net`) pour QR/métadonnées |
| `mdns_enabled` | `bool` | `true` | Active la publication Bonjour `_pvecenter._tcp.local.` |
| `mdns_service_name` | `str` | `"PVE Command Center"` | Nom d'instance Bonjour assaini (max 63 caractères) |
| `mdns_service_type` | `str` | `"_pvecenter._tcp.local."` | Normalisé pour se terminer par `.local.` |
| `refresh_interval_seconds` | `int` | `5` | `1..3600` |

### `security`

| Champ | Type | Défaut | Notes |
|---|---|---|---|
| `tailscale_sso_enabled` | `bool` | `true` | Valide l'en-tête `Tailscale-User-Login` sur connexions loopback |
| `allowed_tailscale_users` | `list[str]` (ou CSV) | `[]` | Liste d'emails Tailscale autorisés (normalisée en minuscules) |
| `dev_auth_bypass` | `bool` | `false` | Désactive l'auth sur loopback (`127.0.0.1` / `::1`) pour le dev local uniquement |
| `protected_owner_username` | `str` | `"admin"` | Compte Jellyfin protégé contre suppression/rétrogradation dans `/api/users` |
| `session_secret` | `str` | `""` | Secret de signature JWT HS256 (`${SESSION_SECRET}` recommandé ; aléatoire éphémère si vide) |
| `admin_pin_hash` | `str` | `""` | Hash `pbkdf2_sha256$<salt>$<hex>` (200 000 itérations) ou SHA-256 |
| `api_tokens` | `list[ApiTokenConfig]` | `[]` | Entrées `{id, name, token_hash, role, created_at}` où `role` vaut `admin \| operator \| viewer \| device` |

### `proxmox`

| Champ | Type | Défaut | Notes |
|---|---|---|---|
| `host` | `str` | `""` | URL de base Proxmox VE (ex. `https://192.168.1.10:8006`) |
| `token_id` | `str` | `""` | Identifiant du jeton PVE (ex. `root@pam!pve-panel`) |
| `token_secret` | `str` | `""` | Secret du jeton PVE (`${PVE_TOKEN_SECRET}`) |
| `verify_ssl` | `bool` | `false` | Vérifie le certificat TLS Proxmox VE |
| `default_node` | `str` | `"pve"` | Nom du nœud cible sous `/api2/json/nodes/<node>` |
| `panel_self_vmid` | `int` | `116` | `>= 1` ; bloque les actions `stop` et `shutdown` sur ce VMID |
| `mergerfs_pool_subpath` | `str` | `""` | Sous-dossier optionnel du pool MergerFS sous `HOST_MNT_ROOT` (vide = auto-détection) |

### `integrations`

Alimente `/api/widgets/*`, `/api/ops/*` et `/api/users/*` :

| Intégration | Champs |
|---|---|
| `jellyfin` | `url`, `api_key` |
| `jellyseerr` | `url`, `api_key` |
| `plex` | `url`, `token` (accepte également l'alias `api_key` en entrée) |
| `radarr` | `url`, `api_key` |
| `sonarr` | `url`, `api_key` |
| `prowlarr` | `url`, `api_key` |
| `qbittorrent` | `url`, `username`, `password` |

### `alerts`

| Champ | Type | Défaut | Contraintes |
|---|---|---|---|
| `enabled` | `bool` | `true` | Active/désactive globalement le moteur d'alertes |
| `default_consecutive_failures` | `int` | `3` | `1..100` échecs consécutifs avant ouverture d'incident |
| `default_cooldown_seconds` | `int` | `300` | `0..86400` délai minimum entre alertes répétées |
| `check_interval_seconds` | `int` | `30` | `5..3600` cadence de vérification par défaut |

### `notifications`

- **`notifications.apns`** :
  - `enabled` (`bool`, défaut `false`)
  - `team_id` (`str`), `key_id` (`str`)
  - `bundle_id` (`str`, défaut `"io.ac.pvepanel.app"`)
  - `private_key_path` (`str`, défaut `"/app/config/AuthKey.p8"`)
  - `use_sandbox` (`bool`, défaut `true`)
- **`notifications.webhooks[]`** :
  - `id` (`str`), `name` (`str`), `type` (`"discord" | "telegram" | "generic"`), `enabled` (`bool`, défaut `true`)
  - `url` (`str`, utilisé par `discord` et `generic`)
  - `bot_token` (`str`), `chat_id` (`str`, utilisé par `telegram`)
  - `headers` (`dict[str, str]`, utilisé par `generic`, ex. `Authorization: "Bearer ${NTFY_TOKEN}"`)
  - `notify_on_down` (`bool`, `true`), `notify_on_recovery` (`bool`, `true`), `include_details` (`bool`, `true`)

### `custom_services[]`

| Champ | Type | Défaut | Notes |
|---|---|---|---|
| `id` | `str` | requis | Identifiant slug unique |
| `name` | `str` | requis | Nom affiché |
| `description` | `str` | `""` | Sous-titre |
| `category` | `str` | `"Services"` | Catégorie d'affichage |
| `icon` | `str` | `"Globe"` | ID d'icône marque, `lucide:<Nom>` ou icône Lucide |
| `protocol` | `ServiceProtocol` | `"http_rest"` | `http_rest \| tcp_port \| icmp_ping \| json_metrics \| webhook_ingest` |
| `host` | `str` | `""` | Nom d'hôte ou IP (pour `tcp_port`, `icmp_ping`, ou HTTP par hôte) |
| `port` | `int \| null` | `null` | `1..65535` (requis lorsque `protocol == "tcp_port"`) |
| `url` | `str` | `""` | URL publique d'ouverture |
| `health_url` | `str` | `""` | URL de sonde (prioritaire sur `internal_url` et `url`) |
| `internal_url` | `str` | `""` | URL de sonde interne de repli |
| `auth_type` | `ServiceAuthType` | `"none"` | `none \| bearer \| basic \| header` |
| `auth_token` | `str` | `""` | Jeton/mot de passe (ou `user:pass` / base64 pour `basic`) |
| `auth_header_name` | `str` | `""` | En-tête personnalisé si `auth_type == "header"` (`X-API-Key` par défaut) |
| `json_metric_path` | `str` | `""` | Liste séparée par `,`/`;`/retour ligne de chemins pointés ou `alias=chemin` (`json_metrics`) |
| `expected_status` | `int` | `200` | `100..599` code HTTP attendu |
| `refresh_interval_seconds` | `int` | `30` | `5..3600` intervalle de sonde |
| `order` | `int` | `0` | Ordre d'affichage |
| `enabled` | `bool` | `true` | Active/désactive la sonde et les alertes |
| `verify_ssl` | `bool` | `false` | Vérification TLS pour ce service |
| `webhook_ttl_seconds` | `int` | `300` | `10..86400` durée de validité des heartbeats `webhook_ingest` |
| `alert_policy` | `AlertPolicyConfig` | `{enabled: true, consecutive_failures: null, cooldown_seconds: null}` | Surcharge par service |

### `categories[]` & `storage_mounts[]`

- **`categories[]`** : tuiles héritées (`name`, `services[]` avec `id`, `name`, `description`, `url`, `ping_url`, `icon`, `widget`).
- **`storage_mounts[]`** : correspondance disques (`mount`, `subpath`, `wwn`, `label`) associant `/host_mnt/<subpath>` (`statvfs`) et infos SMART Proxmox. Si vide, les sous-dossiers de `HOST_MNT_ROOT` (hors sous-dossier du pool MergerFS actif) sont auto-détectés.

---

## 3. Variables d'environnement (`.env.example` & Surcharges)

### Chemins système & Repli hérité

| Variable | Défaut / Comportement | Notes |
|---|---|---|
| `CONFIG_PATH` | `/app/config/config.yaml` (Docker) ou `./config/config.yaml` | Chemin vers `config.yaml` |
| `STATE_DB_PATH` | `/app/config/state.db` (Docker) ou `<dossier_config>/state.db` | Chemin vers `state.db` |
| `ENV_FILE_PATH` | `.env` détecté automatiquement | Surcharge du chemin `.env` |
| `SERVICES_CONFIG_PATH` | `../services.yaml` | Emplacement hérité `services.yaml` |
| `STATIC_DIR` | Auto-détecté (`/app/static` ou `frontend/dist`) | Dossier du build frontend |
| `HOST_MNT_ROOT` | `/host_mnt` | Racine des montages disques / MergerFS |
| `LISTEN_HOST` / `LISTEN_PORT` | `0.0.0.0` / `8000` | Adresse et port d'écoute Uvicorn |
| `SERVER_NAME`, `PUBLIC_URL`, `MDNS_ENABLED`, `MDNS_SERVICE_NAME`, `REFRESH_INTERVAL_SECONDS`, `TAILSCALE_SSO_ENABLED`, `SESSION_SECRET`, `ADMIN_PIN_HASH` | Voir `ConfigManager._synthesize_from_legacy` | Utilisées sans `config.yaml` ou via interpolation `${VAR}` |

### Variables déclarées dans `.env.example`

- **Auth & Chemins** : `DEV_AUTH_BYPASS`, `ALLOWED_TAILSCALE_USERS`, `PROTECTED_OWNER_USERNAME`, `SERVICES_CONFIG_PATH`, `STATIC_DIR`
- **Proxmox VE** : `PVE_HOST`, `PVE_NODE`, `PVE_TOKEN_ID`, `PVE_TOKEN_SECRET`, `PVE_VERIFY_SSL`, `PANEL_SELF_VMID`, `MERGERFS_POOL_SUBPATH`
- **Médias & Téléchargements** : `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `JELLYSEERR_URL`, `JELLYSEERR_API_KEY`, `PLEX_URL`, `PLEX_TOKEN`, `RADARR_URL`, `RADARR_API_KEY`, `SONARR_URL`, `SONARR_API_KEY`, `PROWLARR_URL`, `PROWLARR_API_KEY`, `QBIT_URL`, `QBIT_USERNAME`, `QBIT_PASSWORD`
