[English](installation.md) | [Français](../fr/installation.md)

# Installation & Deployment Guide

`pve-panel` supports automated provisioning on a Proxmox VE host (`install.sh`), manual Docker Compose deployment on Linux/LXC, and local development.

---

## 1. Prerequisites

- **Proxmox VE 8+** (if using Mode A LXC provisioning) or any **Debian/Ubuntu Linux host** with Docker support.
- **Tailscale** account (recommended for zero-config HTTPS via `tailscale serve` and SSO headers) or LAN access with Bearer API tokens.
- **Proxmox VE API Token**: `install.sh` Mode A creates this automatically; for manual setups, create a `PanelRole` with privileges `Sys.Audit VM.Audit Datastore.Audit VM.PowerMgmt` and token `root@pam!pve-panel` (with privilege separation enabled).

---

## 2. Automated Installation (`install.sh`)

Run as `root` or via `sudo`:

```bash
git clone https://github.com/PVE-Center/pve-panel.git
cd pve-panel
chmod +x install.sh
sudo ./install.sh
```

### Mode A — Proxmox VE Host (`pveversion` detected)

When executed directly on a Proxmox VE host (without `--in-container`), `install.sh`:

1. Prompts for VMID (defaults to `/cluster/nextid`), hostname (`pve-panel`), RAM (`1024` MB), disk (`8G`), storage, bridge (`vmbr0`), IP (`dhcp` or static CIDR + gateway), allowed Tailscale user emails, protected owner username (`admin`), PVE API URL, and PVE node name.
2. Downloads the latest `debian-12-standard` LXC template if not present and creates an unprivileged LXC container (`--features nesting=1,keyctl=1 --unprivileged 1 --onboot 1`).
3. Appends a read-only bind mount to `/etc/pve/lxc/<vmid>.conf`:
   ```text
   lxc.mount.entry: /mnt host_mnt none rbind,ro,create=dir 0 0
   ```
4. Configures Proxmox role `PanelRole` (`Sys.Audit VM.Audit Datastore.Audit VM.PowerMgmt`) and token `root@pam!pve-panel` with ACL on `/`.
5. Copies the repository into `/opt/pve-panel` inside the LXC, creates `.env` (`0600`) with a generated 64-hex-char `SESSION_SECRET`, and invokes `install.sh --in-container` inside the LXC.

### Mode B — Existing Linux Server or LXC (`--in-container`)

When running inside an existing LXC or Linux VM (or when declining LXC creation):

1. Installs **Docker Engine + Docker Compose** (`https://get.docker.com`) and **Tailscale** (`https://tailscale.com/install.sh`) if missing.
2. Creates `./config` (`chmod 700`), copies `.env.example -> .env` (`0600`) and `services.example.yaml -> services.yaml`, and initializes `config/config.yaml` (`0600`) if absent.
3. Builds and starts the container with `docker compose up -d --build`.
4. Connects Tailscale (attempting `--advertise-tags=tag:panel`) and configures `tailscale serve --bg http://127.0.0.1:8000`.
5. Updates `server.public_url` in `config/config.yaml` with the detected `https://<host>.<tailnet>.ts.net` URL and prints the `pvecenter://connect?...` pairing link.

### CLI Flags

| Flag | Description |
|---|---|
| `--in-container` | Force Mode B (existing Linux host / LXC deployment) |
| `--ts-hostname <name>` | Tailscale node hostname |
| `--allowed-users <emails>` | Comma-separated Tailscale allowlisted login emails |
| `--pve-node <node>` | Default Proxmox VE node name |
| `-h`, `--help` | Display usage help |

---

## 3. Manual Docker Compose Deployment

### Multi-Stage `Dockerfile`

The [`Dockerfile`](../../Dockerfile) builds in two stages:
1. **`frontend-builder` (`node:22-alpine`)**: Installs frontend dependencies (`npm ci`) and compiles the React 19 + TypeScript SPA (`npm run build`).
2. **`runtime` (`python:3.12-slim`)**: Installs `iputils-ping` (required for `icmp_ping` connectors) and `ca-certificates`, installs Python packages from `backend/requirements.txt`, copies `backend/app` and compiled assets into `/app/static`, and runs:
   ```text
   uvicorn app.main:app --host ${LISTEN_HOST:-0.0.0.0} --port ${LISTEN_PORT:-8000} --no-proxy-headers
   ```

### Setup Steps

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

### Networking Modes (`host` vs `bridge`)

[`docker-compose.yml`](../../docker-compose.yml) defaults to `network_mode: host` for two reasons:
1. **Bonjour / mDNS**: Multicast UDP (`224.0.0.251:5353`) works directly on the host LAN interface for `_pvecenter._tcp.local.` advertisement and `GET /api/discovery/lan` scanning.
2. **Exact Loopback Verification for Tailscale Serve**: With `--no-proxy-headers`, requests proxied by host `tailscale serve` reach FastAPI from `127.0.0.1`, enabling trusted `Tailscale-User-Login` verification.

If you prefer Docker `bridge` mode:
- Replace `network_mode: host` with `ports: ["${LISTEN_PORT:-8000}:8000"]`.
- Optionally mount `/var/run/dbus` and `/var/run/avahi-daemon/socket` if `avahi-daemon` runs on the host.
- Note that traffic from a host-level `tailscale serve` arrives via the Docker bridge gateway (e.g. `172.17.0.1`) rather than `127.0.0.1`, so clients should authenticate using Bearer API tokens or `POST /api/auth/login` (PIN / token).

### Recommended Tailscale ACL

```json
{
  "tagOwners": { "tag:panel": ["admin@example.com"] },
  "acls": [
    { "action": "accept", "src": ["admin@example.com"], "dst": ["tag:panel:*"] }
  ]
}
```

---

## 4. First-Run Onboarding & Updates

1. Open your panel URL in a browser. While `is_configured == false`, the **Onboarding Wizard** walks through server naming, Tailscale SSO settings, an Admin PIN, Proxmox VE API credentials, and minting your first `pve_...` Bearer API token.
2. You can later scan the QR code (`GET /api/discovery/qr`) from [`pve-center-apple`](https://github.com/PVE-Center/pve-center-apple) or enter the server URL & token in [`pve-center-clients`](https://github.com/PVE-Center/pve-center-clients).
3. To upgrade an existing deployment while preserving `./config/` (which holds `config.yaml`, `state.db`, and optional `AuthKey.p8`):
   ```bash
   cd /opt/pve-panel
   git pull origin main
   docker compose up -d --build
   ```

---

## 5. Local Development Setup

```bash
# Terminal 1 — Build or serve frontend
cd frontend
npm ci
npm run dev   # Proxies /api to http://127.0.0.1:8000

# Terminal 2 — Run FastAPI with loopback dev auth bypass
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt ruff
DEV_AUTH_BYPASS=true uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

> **Warning:** Never set `DEV_AUTH_BYPASS=true` in production or on publicly reachable hosts.
