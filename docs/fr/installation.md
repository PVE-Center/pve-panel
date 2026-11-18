[English](../en/installation.md) | [Français](installation.md)

# Guide d'installation et de déploiement

`pve-panel` prend en charge le déploiement automatisé sur hôte Proxmox VE (`install.sh`), l'installation manuelle via Docker Compose sur Linux/LXC et le développement local.

---

## 1. Prérequis

- **Proxmox VE 8+** (pour la création automatique de LXC en Mode A) ou tout **hôte Linux Debian/Ubuntu** supportant Docker.
- Un compte **Tailscale** (recommandé pour le HTTPS zéro-config via `tailscale serve` et les en-têtes SSO) ou un accès LAN avec jetons API Bearer.
- **Token API Proxmox VE** : créé automatiquement par `install.sh` en Mode A ; en installation manuelle, créez un rôle `PanelRole` doté des privilèges `Sys.Audit VM.Audit Datastore.Audit VM.PowerMgmt` et un jeton `root@pam!pve-panel` (séparation des privilèges activée).

---

## 2. Installation automatisée (`install.sh`)

Exécutez en tant que `root` ou via `sudo` :

```bash
git clone https://github.com/PVE-Center/pve-panel.git
cd pve-panel
chmod +x install.sh
sudo ./install.sh
```

### Mode A — Hôte Proxmox VE (`pveversion` détecté)

Exécuté directement sur un nœud Proxmox VE (sans `--in-container`), `install.sh` :

1. Demande le VMID (proposé via `/cluster/nextid`), nom d'hôte (`pve-panel`), RAM (`1024` Mo), disque (`8G`), stockage, bridge (`vmbr0`), IP (`dhcp` ou CIDR statique + passerelle), emails Tailscale autorisés, compte propriétaire protégé (`admin`), URL API Proxmox et nom du nœud.
2. Télécharge le dernier template LXC `debian-12-standard` si absent et crée un conteneur LXC non privilégié (`--features nesting=1,keyctl=1 --unprivileged 1 --onboot 1`).
3. Ajoute le montage en lecture seule dans `/etc/pve/lxc/<vmid>.conf` :
   ```text
   lxc.mount.entry: /mnt host_mnt none rbind,ro,create=dir 0 0
   ```
4. Crée ou met à jour le rôle `PanelRole` (`Sys.Audit VM.Audit Datastore.Audit VM.PowerMgmt`) et le token `root@pam!pve-panel` avec ACL sur `/`.
5. Copie le dépôt dans `/opt/pve-panel` à l'intérieur du LXC, initialise `.env` (`0600`) avec un `SESSION_SECRET` aléatoire (64 caractères hexadécimaux), puis exécute `install.sh --in-container` dans le LXC.

### Mode B — Serveur Linux ou LXC existant (`--in-container`)

À l'intérieur d'un LXC ou serveur Linux existant (ou si vous refusez la création de LXC) :

1. Installe **Docker Engine + Docker Compose** (`https://get.docker.com`) et **Tailscale** (`https://tailscale.com/install.sh`) si manquants.
2. Crée `./config` (`chmod 700`), copie `.env.example -> .env` (`0600`) et `services.example.yaml -> services.yaml`, et génère `config/config.yaml` (`0600`) s'il n'existe pas.
3. Construit et lance le conteneur via `docker compose up -d --build`.
4. Connecte Tailscale (tente `--advertise-tags=tag:panel`) et active `tailscale serve --bg http://127.0.0.1:8000`.
5. Met à jour `server.public_url` dans `config/config.yaml` avec l'URL `https://<host>.<tailnet>.ts.net` détectée et affiche le lien d'appairage `pvecenter://connect?...`.

### Options CLI

| Option | Description |
|---|---|
| `--in-container` | Force le Mode B (serveur Linux / conteneur LXC existant) |
| `--ts-hostname <nom>` | Nom d'hôte du nœud Tailscale |
| `--allowed-users <emails>` | Liste d'emails Tailscale autorisés séparés par des virgules |
| `--pve-node <noeud>` | Nom du nœud Proxmox VE par défaut |
| `-h`, `--help` | Affiche l'aide |

---

## 3. Déploiement Docker Compose manuel

### Dockerfile multi-étapes

Le [`Dockerfile`](../../Dockerfile) compile en deux étapes :
1. **`frontend-builder` (`node:22-alpine`)** : installe les dépendances (`npm ci`) et génère le bundle React 19 + TypeScript (`npm run build`).
2. **`runtime` (`python:3.12-slim`)** : installe `iputils-ping` (nécessaire pour le connecteur `icmp_ping`) et `ca-certificates`, installe `backend/requirements.txt`, copie `backend/app` et les assets compilés dans `/app/static`, puis lance :
   ```text
   uvicorn app.main:app --host ${LISTEN_HOST:-0.0.0.0} --port ${LISTEN_PORT:-8000} --no-proxy-headers
   ```

### Étapes de mise en place

```bash
git clone https://github.com/PVE-Center/pve-panel.git
cd pve-panel
mkdir -p config && chmod 700 config
cp config/config.example.yaml config/config.yaml
cp .env.example .env
cp services.example.yaml services.yaml
chmod 600 .env config/config.yaml
docker compose up -d --build
```

### Modes réseau (`host` vs `bridge`)

[`docker-compose.yml`](../../docker-compose.yml) utilise `network_mode: host` par défaut pour deux raisons :
1. **Bonjour / mDNS natif** : le multicast UDP (`224.0.0.251:5353`) fonctionne directement sur l'interface LAN de l'hôte pour publier `_pvecenter._tcp.local.` et scanner le réseau (`GET /api/discovery/lan`).
2. **Vérification loopback exacte pour Tailscale Serve** : avec `--no-proxy-headers`, le trafic HTTPS de `tailscale serve` arrive sur `127.0.0.1`, permettant de valider l'en-tête `Tailscale-User-Login`.

Si vous préférez le mode `bridge` :
- Remplacez `network_mode: host` par `ports: ["${LISTEN_PORT:-8000}:8000"]`.
- Décommentez éventuellement `/var/run/dbus` et `/var/run/avahi-daemon/socket` si `avahi-daemon` tourne sur l'hôte.
- En mode `bridge`, le trafic provenant de `tailscale serve` sur l'hôte passe par la passerelle Docker (ex. `172.17.0.1`) plutôt que `127.0.0.1` : authentifiez vos clients par jeton API Bearer ou `POST /api/auth/login` (PIN / jeton).

### ACL Tailscale recommandée

```json
{
  "tagOwners": { "tag:panel": ["admin@example.com"] },
  "acls": [
    { "action": "accept", "src": ["admin@example.com"], "dst": ["tag:panel:*"] }
  ]
}
```

---

## 4. Onboarding initial & Mises à jour

1. Ouvrez l'URL du panel dans votre navigateur. Tant que `is_configured == false`, l'**assistant d'onboarding** configure le nom du serveur, Tailscale SSO, le code PIN Admin, Proxmox VE et génère votre premier jeton API Bearer `pve_...`.
2. Vous pouvez ensuite scanner le QR Code (`GET /api/discovery/qr`) depuis [`pve-center-apple`](https://github.com/PVE-Center/pve-center-apple) ou saisir l'URL et le jeton dans [`pve-center-clients`](https://github.com/PVE-Center/pve-center-clients).
3. Pour mettre à jour tout en conservant `./config/` (`config.yaml`, `state.db`, `AuthKey.p8`) :
   ```bash
   cd /opt/pve-panel
   git pull origin main
   docker compose up -d --build
   ```

---

## 5. Environnement de développement local

```bash
# Terminal 1 — Serveur de développement frontend
cd frontend
npm ci
npm run dev   # Proxy /api vers http://127.0.0.1:8000

# Terminal 2 — Backend FastAPI avec contournement d'auth loopback dev
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt ruff
DEV_AUTH_BYPASS=true uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

> **Attention :** n'activez jamais `DEV_AUTH_BYPASS=true` en production ou sur un hôte exposé.
