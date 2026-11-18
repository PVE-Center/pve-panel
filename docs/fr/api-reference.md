[English](../en/api-reference.md) | [Français](api-reference.md)

# Référence API (REST, WebSocket & SSE)

Tous les endpoints API sont exposés sous `/api` par FastAPI (`backend/app/main.py`). Les interfaces Swagger/ReDoc sont désactivées (`docs_url=None`, `redoc_url=None`) par mesure de sécurité.

---

## 1. Authentification, Rôles RBAC & Exemptions publiques

Chaque route protégée passe par `TailscaleSSOMiddleware` (`backend/app/middleware/tailscale_auth.py`) :

- **Loopback (`127.0.0.1` / `::1`)** : en-tête `Tailscale-User-Login` (présent dans `security.allowed_tailscale_users`), `Authorization: Bearer <token>`, ou `dev_auth_bypass: true`.
- **Hors loopback (LAN / Distant)** : `Authorization: Bearer <api_token_ou_session_jwt>` (pour WebSocket/SSE, le paramètre de requête `?token=<token>` est aussi accepté).
- **Application granulaire des rôles (`role`)** :
  - `admin` : accès complet en lecture et écriture (YAML déclaratif, jetons API, onboarding, code PIN, utilisateurs, opérations).
  - `operator` / `device` : lectures + écritures opérationnelles (`/api/pve/*`, `/api/ops/*`, `/api/incidents/*`, tests de sondes et enregistrement push) ; les écritures de config ou lectures YAML/jetons renvoient `403`.
  - `viewer` : télémétrie en lecture seule (`GET`/`HEAD`) + enregistrement push ; toute route d'écriture renvoie `403`.
- **Toujours publiques** :
  - `GET /api/health`
  - `POST /api/auth/login`
  - `/api/pairing/*`
  - `GET /api/onboarding/status`
  - `POST /api/custom-services/{service_id}/webhook` (valide son jeton dédié si `auth_type != "none"`)
- **Publiques uniquement avant configuration initiale (`is_configured == false`)** :
  - `POST /api/onboarding/init`, `GET /api/setup/status`, `POST /api/setup/test-service`, `PUT /api/setup/config`, `GET /api/discovery/lan`.

---

## 2. Santé & Flux temps réel

| Méthode / Proto | Chemin | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Retourne `{status, version, server_id, server_name, is_configured, config_hash}` |
| `WS` | `/api/ws/events` | Auth (ou `?token=`) | Flux JSON temps réel (`ping` serveur toutes les `25s`, accepte `"pong"` / `{"type": "pong"}` ; ferme avec code `4401` si non authentifié) |
| `GET` | `/api/events/stream` | Auth (ou `?token=`) | Flux Server-Sent Events (`text/event-stream`) émettant `data: {...}` et `: keepalive` toutes les `25s` |

Format des événements :
```json
{
  "type": "service_status_changed",
  "timestamp": "2026-11-18T10:00:00Z",
  "payload": {}
}
```
Types supportés : `config_reloaded`, `service_status_changed`, `alert_triggered`, `alert_resolved`, `incident_acknowledged`, `pairing_completed`, `ping`.

---

## 3. Authentification, Sessions, PIN & Jetons API

| Méthode | Chemin | Rôle / Auth | Description |
|---|---|---|---|
| `GET` | `/api/me` | Auth | Retourne l'identité active (`login`, `name`, `profile_pic`, `auth_mode`, `role`) |
| `POST` | `/api/auth/login` | Public (limité : `10` échecs / `60s`) | Corps `{pin?, api_token?, token?}` -> émet un JWT HS256 `{ok, access_token, token_type, expires_in: 86400, expires_at, user}` |
| `GET` | `/api/auth/tokens` | Admin | Liste les métadonnées des jetons API (`id`, `name`, `role`, `created_at`) sans exposer les hash |
| `POST` | `/api/auth/tokens` | Admin | Corps `{name, role}` (`admin \| operator \| viewer \| device`) -> retourne le jeton `pve_...` en clair une seule fois |
| `DELETE` | `/api/auth/tokens/{token_id}` | Admin | Révoque et supprime un jeton dans `config.yaml` |
| `PUT` | `/api/auth/pin` | Admin | Corps `{pin}` (`4..32` caractères) -> met à jour le hash `PBKDF2-HMAC-SHA256` dans `security.admin_pin_hash` |

---

## 4. Onboarding, YAML déclaratif & Setup hérité

| Méthode | Chemin | Auth | Description |
|---|---|---|---|
| `GET` | `/api/onboarding/status` | Public | Retourne `{is_configured, needs_onboarding, config_exists, is_synthesized, server_id, server_name, public_url, tailscale_sso_enabled, pin_configured, api_tokens_count, auth_methods}` |
| `POST` | `/api/onboarding/init` | Public au 1er lancement ; Admin ensuite | Écrit `config.yaml` et génère le premier jeton admin `pve_...` (`api_token`) |
| `GET` | `/api/config/yaml` | Admin | Retourne `{yaml, hash, is_synthesized, config_exists, secrets_masked, parsed_summary}` |
| `POST` | `/api/config/validate` | Admin | Corps `{yaml}` -> retourne `{valid, errors, warnings, parsed_summary}` sans écriture |
| `PUT` | `/api/config/yaml` | Admin | Corps `{yaml}` -> valide, restaure les secrets masqués `********`, écrit atomiquement et recharge à chaud |
| `GET` | `/api/config/export` | Admin | Télécharge un instantané masqué de `config.yaml` (`application/x-yaml`) |
| `GET` | `/api/setup/status` | Public 1er lancement / Auth | Retourne `{is_configured, server_id, server_name, tailscale_url, pairing_deep_link, env, categories, storage_mounts}` (secrets masqués par booléens `*_set`) |
| `POST` | `/api/setup/test-service` | Public 1er lancement / Auth | Teste en direct `proxmox`, `jellyfin`, `jellyseerr`, `plex`, `radarr`, `sonarr`, `prowlarr` ou `qbittorrent` |
| `PUT` | `/api/setup/config` | Public 1er lancement / Auth | Met à jour `config.yaml` (ou `.env` + `services.yaml`) avec rechargement à chaud |

---

## 5. Cluster Proxmox VE & Stockage

| Méthode | Chemin | Auth | Description |
|---|---|---|---|
| `GET` | `/api/pve/nodes` | Auth | Liste les nœuds du cluster Proxmox VE avec `status`, `online`, `cpu_pct`, `mem_pct` et `uptime` |
| `GET` | `/api/pve/overview` | Auth | Optionnel `?node=<nom> \| * \| all` : retourne `{online, selected_node, failover_active, cluster_nodes, node, counts, resources, external_storage}` |
| `POST` | `/api/pve/{vm_type}/{vmid}/{action}` | Operator / Admin | Optionnel `?node=<nom>` ; `vm_type`: `lxc \| qemu` ; `action`: `start \| stop \| reboot \| shutdown` (`400` si `vmid == panel_self_vmid`) |

---

## 6. Services catégorisés, Widgets & Connecteurs personnalisés

| Méthode | Chemin | Auth | Description |
|---|---|---|---|
| `GET` | `/api/services` | Auth | Exécute les contrôles de santé concurrents sur `categories` et `custom_services` |
| `PUT` | `/api/services/items/{service_id}` | Auth | Modifie une tuile catégorisée (`name`, `description`, `url`, `ping_url`, `icon`, `widget`, `category`) |
| `POST` | `/api/services/items/{service_id}/move` | Auth | Corps `{direction: "up" \| "down"}` -> réordonne la tuile dans sa catégorie |
| `POST` | `/api/services/items/{service_id}/test` | Auth | Test HTTP à blanc d'une tuile catégorisée (`url`, `ping_url`) |
| `DELETE` | `/api/services/items/{service_id}` | Auth | Supprime une tuile de sa catégorie |
| `GET` | `/api/widgets/all` | Auth | Retourne en parallèle les métriques de tous les widgets configurés |
| `GET` | `/api/widgets/{widget_name}` | Auth | Métriques d'un widget : `jellyfin`, `plex`, `radarr`, `sonarr`, `prowlarr` ou `qbittorrent` |
| `GET` | `/api/custom-services` | Auth | Liste les services personnalisés avec statut live, latence et état en cache |
| `POST` | `/api/custom-services` | Auth | Crée un service personnalisé dans `config.yaml` (`201`) |
| `POST` | `/api/custom-services/reorder` | Auth | Corps `{service_ids}` (ou `ids` / `order`) -> met à jour `order` |
| `PUT` | `/api/custom-services/{service_id}` | Auth | Met à jour un service personnalisé tout en préservant `auth_token` si vide/masqué |
| `DELETE` | `/api/custom-services/{service_id}` | Auth | Supprime un service personnalisé de `config.yaml` |
| `POST` | `/api/custom-services/{service_id}/test` | Auth | Test à blanc (`http_rest`, `tcp_port`, `icmp_ping`, `json_metrics`, `webhook_ingest`) |
| `POST` | `/api/custom-services/{service_id}/webhook` | Jeton du service (si configuré) | Reçoit un heartbeat `{status?, message?, metrics?, ttl_seconds?}` (`Authorization: Bearer`, `auth_header_name`, `x-webhook-token`, `x-api-key` ou `?token=`) |

---

## 7. Incidents & Notifications

| Méthode | Chemin | Auth | Description |
|---|---|---|---|
| `GET` | `/api/incidents` | Auth | Paramètres `?active_only=false&limit=50&service_id=` -> `{incidents, count, active_count, service_states}` |
| `POST` | `/api/incidents/{incident_id}/ack` | Auth | Acquitte un incident et émet `incident_acknowledged` |
| `POST` | `/api/incidents/services/{service_id}/mute` | Auth | Corps `{minutes: 60}` (`1..43200`) -> coupe temporairement les alertes du service |
| `DELETE` | `/api/incidents/services/{service_id}/mute` | Auth | Annule la mise en sourdine d'un service |
| `POST` | `/api/notifications/devices` | Auth | Enregistre/met à jour un jeton APNs (`device_token`, `platform`, `device_name`, `app_version`, `environment`) |
| `DELETE` | `/api/notifications/devices/{token}` | Auth | Supprime un appareil APNs enregistré |
| `GET` | `/api/notifications/channels` | Auth | Retourne l'état APNs/appareils et les canaux webhooks masqués |
| `PUT` | `/api/notifications/channels` | Auth | Met à jour APNs et/ou les webhooks dans `config.yaml` en préservant les secrets |
| `POST` | `/api/notifications/test` | Auth | Corps `{channel_id?, channel_type: "all", title?, message?}` -> envoie une notification de test |

---

## 8. Opérations & Gestion unifiée des utilisateurs

| Méthode | Chemin | Auth | Description |
|---|---|---|---|
| `GET` | `/api/ops/overview` | Auth | Retourne en parallèle `{pve_tasks, seerr_requests, qbit_control}` |
| `POST` | `/api/ops/seerr/{request_id}/{decision}` | Auth | `decision`: `approve \| decline` sur une demande Jellyseerr |
| `POST` | `/api/ops/qbit/toggle-speed-mode` | Auth | Active/désactive les limites alternatives qBittorrent (Mode Tortue) |
| `POST` | `/api/ops/qbit/torrent/{torrent_hash}/{action}` | Auth | `action`: `pause \| resume` (compatible qBittorrent v4 et v5) |
| `POST` | `/api/ops/media/scan/{target}` | Auth | `target`: `jellyfin \| plex` -> lance une analyse des bibliothèques |
| `GET` | `/api/users` | Auth | Liste les utilisateurs Jellyfin, bibliothèques et statut de synchro Jellyseerr |
| `POST` | `/api/users` | Auth | Crée un utilisateur Jellyfin, applique les politiques et importe dans Jellyseerr |
| `POST` | `/api/users/sync` | Auth | Importe les utilisateurs Jellyfin manquants (ou ciblés) dans Jellyseerr |
| `PATCH` | `/api/users/{jellyfin_id}` | Auth | Met à jour les droits Jellyfin & auto-approbation Jellyseerr (protège `protected_owner_username`) |
| `POST` | `/api/users/{jellyfin_id}/password` | Auth | Réinitialise et définit un nouveau mot de passe Jellyfin |
| `DELETE` | `/api/users/{jellyfin_id}` | Auth | Supprime l'utilisateur de Jellyseerr et Jellyfin (protège `protected_owner_username`) |

---

## 9. Découverte LAN & Relais d'appairage Apple TV

| Méthode | Chemin | Auth | Description |
|---|---|---|---|
| `GET` | `/api/discovery/lan` | Public 1er lancement / Auth | `?timeout=2.0` (`0.5..4.0`) -> scan LAN mDNS asynchrone retournant les services détectés avec `suggested_protocol` |
| `GET` | `/api/discovery/qr` | Auth | Retourne `{deep_link, onboarding_link, public_url, server_id, server_name, mdns_service_type, lan_ip, port}` |
| `POST` | `/api/pairing/sessions` | Public | Corps `{public_key, device_name}` -> crée une session PIN à 6 chiffres (TTL `300s`) |
| `GET` | `/api/pairing/sessions/{pin}` | Public (limité) | Retourne `public_key` du récepteur, `device_name`, `expires_at`, `completed` |
| `POST` | `/api/pairing/sessions/{pin}/complete` | Public (limité) | Corps `{sender_public_key, nonce, ciphertext, tag}` -> stocke le bloc chiffré et émet `pairing_completed` |
| `GET` | `/api/pairing/sessions/{pin}/payload` | Public (limité) | Consomme le bloc chiffré en lecture unique et détruit la session (`425` si en attente) |

---

## 10. Métriques Prometheus

| Méthode | Chemin | Auth | Description |
|---|---|---|---|
| `GET` | `/metrics` | Auth (`viewer`+) | Format texte Prometheus (`0.0.4`) exposant `pve_center_up`, `pve_custom_service_up`, `pve_custom_service_latency_ms`, `pve_incidents_active_total`, `pve_node_*` et `pve_guest_up` |
| `GET` | `/api/metrics/prometheus` | Auth (`viewer`+) | Alias sous `/api` retournant la même charge Prometheus |
