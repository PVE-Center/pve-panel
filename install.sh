#!/usr/bin/env bash
# ==============================================================================
# PVE Command Center — Installateur universel (Proxmox VE LXC ou Serveur Linux)
# ==============================================================================
set -Eeuo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { printf "${CYAN}[INFO]${NC} %s\n" "$*"; }
log_ok()    { printf "${GREEN}[OK]${NC}   %s\n" "$*"; }
log_warn()  { printf "${YELLOW}[WARN]${NC} %s\n" "$*"; }
log_err()   { printf "${RED}[ERR]${NC}  %s\n" "$*" >&2; }

read_input() {
  local __var="$1" __prompt="$2" __default="${3:-}" __reply=""
  if [[ -r /dev/tty && -w /dev/tty ]]; then
    if [[ -n "$__default" ]]; then
      printf "%s [%s]: " "$__prompt" "$__default" >/dev/tty
    else
      printf "%s: " "$__prompt" >/dev/tty
    fi
    read -r __reply </dev/tty || __reply=""
  else
    if [[ -n "$__default" ]]; then
      printf "%s [%s]: " "$__prompt" "$__default"
    else
      printf "%s: " "$__prompt"
    fi
    read -r __reply || __reply=""
  fi
  __reply="${__reply:-$__default}"
  printf -v "$__var" '%s' "$__reply"
}

confirm_yes_no() {
  local __prompt="$1" __default="${2:-Y}" __ans=""
  local __hint="O/n"
  [[ "$__default" == "N" ]] && __hint="o/N"
  read_input __ans "$__prompt ($__hint)" "$__default"
  case "${__ans,,}" in
    y|yes|o|oui) return 0 ;;
    *) return 1 ;;
  esac
}

set_env_var() {
  local file="$1" key="$2" val="$3"
  local tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$val" '
    BEGIN { updated = 0 }
    $0 ~ "^[[:space:]]*" k "=" {
      if (!updated) {
        print k "=" v
        updated = 1
      }
      next
    }
    { print }
    END {
      if (!updated) {
        print k "=" v
      }
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
  chmod 600 "$file"
}

get_env_var() {
  local file="$1" key="$2"
  awk -F= -v k="$key" '
    $1 ~ "^[[:space:]]*" k "[[:space:]]*$" {
      sub(/^[^=]*=/, "", $0)
      print $0
      exit
    }
  ' "$file" 2>/dev/null || true
}

urlencode() {
  local raw="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$raw"
    return
  fi
  local i char out=""
  for ((i = 0; i < ${#raw}; i++)); do
    char="${raw:i:1}"
    case "$char" in
      [a-zA-Z0-9.~_-]) out+="$char" ;;
      *) printf -v hex '%%%02X' "'$char"; out+="$hex" ;;
    esac
  done
  printf '%s\n' "$out"
}

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    log_err "Ce script doit être exécuté en tant que root (utilisez sudo ./install.sh)."
    exit 1
  fi
}

resolve_repo_dir() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "${script_dir}/docker-compose.yml" && -d "${script_dir}/backend" ]]; then
    printf '%s\n' "$script_dir"
    return
  fi
  if [[ -f "/opt/pve-panel/docker-compose.yml" && -d "/opt/pve-panel/backend" ]]; then
    printf '%s\n' "/opt/pve-panel"
    return
  fi

  local repo_url=""
  log_warn "Dépôt pve-panel introuvable localement."
  read_input repo_url "URL Git du dépôt pve-panel à cloner dans /opt/pve-panel" "https://github.com/PVE-Center/pve-panel.git"
  if [[ -z "$repo_url" ]]; then
    log_err "Exécutez install.sh depuis le dossier cloné ou indiquez une URL Git valide."
    exit 1
  fi
  if ! command -v git >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y git
  fi
  git clone "$repo_url" /opt/pve-panel
  printf '%s\n' "/opt/pve-panel"
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log_ok "Docker Engine et Docker Compose sont déjà installés."
    systemctl enable --now docker >/dev/null 2>&1 || true
    return
  fi

  log_info "Installation de Docker Engine & Docker Compose..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y curl ca-certificates gnupg
  fi
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  log_ok "Docker Engine installé et démarré."
}

ensure_tailscale() {
  if command -v tailscale >/dev/null 2>&1; then
    log_ok "Tailscale est déjà installé."
    systemctl enable --now tailscaled >/dev/null 2>&1 || true
    return
  fi

  log_info "Installation de Tailscale..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y curl ca-certificates
  fi
  curl -fsSL https://tailscale.com/install.sh | sh
  systemctl enable --now tailscaled
  log_ok "Tailscale installé et démarré."
}

tailscale_backend_state() {
  tailscale status --json 2>/dev/null | awk -F'"' '/"BackendState"/{print $4; exit}' || true
}

detect_tailscale_dns_name() {
  if ! command -v tailscale >/dev/null 2>&1; then
    return
  fi
  local raw=""
  raw="$(tailscale status --json 2>/dev/null || true)"
  if [[ -z "$raw" ]]; then
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    dns = (data.get("Self") or {}).get("DNSName") or ""
    print(dns.rstrip("."))
except Exception:
    pass
' <<< "$raw"
  else
    printf '%s\n' "$raw" | awk -F'"' '/"DNSName"/{gsub(/\.$/, "", $4); print $4; exit}'
  fi
}

configure_tailscale_serve() {
  local ts_hostname="$1"
  local state
  state="$(tailscale_backend_state)"

  if [[ "$state" != "Running" ]]; then
    log_info "Connexion à Tailscale (tag:panel) — suivez le lien d'authentification si affiché :"
    if ! tailscale up --advertise-tags=tag:panel --hostname="$ts_hostname"; then
      log_warn "Impossible d'appliquer --advertise-tags=tag:panel (vérifiez tagOwners dans vos ACL Tailscale). Nouvelle tentative sans tag..."
      tailscale up --hostname="$ts_hostname"
    fi
  else
    log_ok "Tailscale est déjà connecté au Tailnet."
  fi

  log_info "Activation de Tailscale Serve HTTPS -> http://127.0.0.1:8000 ..."
  if ! tailscale serve --bg http://127.0.0.1:8000 >/dev/null 2>&1; then
    tailscale serve --bg 8000
  fi
  log_ok "Tailscale Serve actif sur http://127.0.0.1:8000."
}

print_final_summary() {
  local dns_name="$1"
  local pve_node="${2:-pve}"
  local admin_email="${3:-user@example.com}"

  local panel_url
  if [[ -n "$dns_name" ]]; then
    panel_url="https://${dns_name}"
  else
    panel_url="https://<hostname>.<tailnet>.ts.net"
  fi

  local enc_url enc_node pairing_link
  enc_url="$(urlencode "$panel_url")"
  enc_node="$(urlencode "$pve_node")"
  pairing_link="pvecenter://connect?url=${enc_url}&name=${enc_node}"

  printf "\n${BOLD}${GREEN}======================================================================${NC}\n"
  printf "${BOLD}${GREEN}  PVE Command Center est installé et prêt !${NC}\n"
  printf "${BOLD}${GREEN}======================================================================${NC}\n\n"
  printf "  ${BOLD}URL Web HTTPS :${NC}       %s\n" "$panel_url"
  printf "  ${BOLD}Appairage Apple :${NC}     %s\n" "$pairing_link"
  printf "  ${BOLD}Config déclarative :${NC}  ./config/config.yaml (monté sur /app/config/config.yaml)\n"
  printf "  ${BOLD}Découverte Bonjour :${NC}  _pvecenter._tcp.local.\n"
  printf "\n"
  printf "  ${CYAN}Prochaine étape :${NC}\n"
  printf "  Ouvrez l'URL HTTPS ci-dessus (ou scannez le QR Code / lien pvecenter:// sur iPhone / Mac).\n"
  printf "  L'assistant de premier lancement (Onboarding) vous permet de générer votre\n"
  printf "  jeton API Bearer (LAN / Apple TV), configurer Proxmox VE, vos services\n"
  printf "  personnalisés et vos alertes Discord / Telegram / ntfy / APNs à chaud.\n\n"
  printf "  ${YELLOW}Rappel ACL Tailscale recommandé :${NC}\n"
  printf '  {"tagOwners":{"tag:panel":["%s"]},"acls":[{"action":"accept","src":["%s"],"dst":["tag:panel:*"]}]}\n\n' "$admin_email" "$admin_email"
}

generate_session_secret() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import secrets; print(secrets.token_hex(32))'
    return
  fi
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi
  od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
  printf '\n'
}

ensure_session_secret_in_env() {
  local env_file="$1"
  local current=""
  if [[ -f "$env_file" ]]; then
    current="$(get_env_var "$env_file" SESSION_SECRET)"
  fi
  if [[ -z "$current" || "$current" == replace-with-* || "$current" == '${'* ]]; then
    local generated
    generated="$(generate_session_secret)"
    if [[ -f "$env_file" ]]; then
      set_env_var "$env_file" SESSION_SECRET "$generated"
    fi
    printf '%s\n' "$generated"
    return
  fi
  printf '%s\n' "$current"
}

ensure_config_dir_and_mount() {
  local repo_dir="$1"
  mkdir -p "${repo_dir}/config"
  chmod 700 "${repo_dir}/config"
  if [[ -f "${repo_dir}/docker-compose.yml" ]]; then
    if grep -qE '\./config:/app/config(:rw)?' "${repo_dir}/docker-compose.yml"; then
      log_ok "Montage Docker ./config:/app/config:rw vérifié dans docker-compose.yml."
    else
      log_warn "Montage ./config:/app/config:rw absent de docker-compose.yml — vérifiez vos volumes persistants."
    fi
  fi
}

create_initial_config_yaml() {
  local repo_dir="$1"
  local allowed_users="$2"
  local owner_user="$3"
  local pve_node="$4"
  local session_secret="$5"
  local config_file="${repo_dir}/config/config.yaml"
  local example_file="${repo_dir}/config/config.example.yaml"

  if [[ -f "$config_file" ]]; then
    chmod 600 "$config_file"
    log_ok "Fichier config/config.yaml déjà présent (conservé)."
    return
  fi

  local pve_host="" pve_token_id="root@pam!pve-panel" pve_token_secret="" pve_verify_ssl="false" panel_vmid="116"
  if [[ -f "${repo_dir}/.env" ]]; then
    pve_host="$(get_env_var "${repo_dir}/.env" PVE_HOST)"
    pve_token_id="$(get_env_var "${repo_dir}/.env" PVE_TOKEN_ID)"
    pve_token_secret="$(get_env_var "${repo_dir}/.env" PVE_TOKEN_SECRET)"
    pve_verify_ssl="$(get_env_var "${repo_dir}/.env" PVE_VERIFY_SSL)"
    panel_vmid="$(get_env_var "${repo_dir}/.env" PANEL_SELF_VMID)"
  fi

  if [[ -z "$pve_token_secret" || "$pve_token_secret" == replace-with-* || "$pve_token_secret" == '${'* ]]; then
    pve_host=""
    pve_token_secret=""
  fi
  pve_token_id="${pve_token_id:-root@pam!pve-panel}"
  pve_verify_ssl="${pve_verify_ssl:-false}"
  panel_vmid="${panel_vmid:-116}"
  [[ "$panel_vmid" =~ ^[0-9]+$ ]] || panel_vmid="116"

  if command -v python3 >/dev/null 2>&1; then
    PVE_CFG_OUT="$config_file" \
    PVE_CFG_EXAMPLE="$example_file" \
    PVE_ALLOWED_USERS="$allowed_users" \
    PVE_OWNER_USER="$owner_user" \
    PVE_SESSION_SECRET="$session_secret" \
    PVE_HOST_VAL="$pve_host" \
    PVE_NODE_VAL="$pve_node" \
    PVE_TOKEN_ID_VAL="$pve_token_id" \
    PVE_TOKEN_SECRET_VAL="$pve_token_secret" \
    PVE_VERIFY_SSL_VAL="$pve_verify_ssl" \
    PVE_SELF_VMID_VAL="$panel_vmid" \
    python3 - <<'PYEOF'
import json
import os
from pathlib import Path
import uuid

out_path = Path(os.environ["PVE_CFG_OUT"])
example_path = Path(os.environ["PVE_CFG_EXAMPLE"])
allowed_raw = os.environ.get("PVE_ALLOWED_USERS", "")
allowed = [u.strip().lower() for u in allowed_raw.split(",") if u.strip()]
owner = os.environ.get("PVE_OWNER_USER", "admin").strip() or "admin"
session_secret = os.environ.get("PVE_SESSION_SECRET", "").strip()
pve_host = os.environ.get("PVE_HOST_VAL", "").strip()
pve_node = os.environ.get("PVE_NODE_VAL", "pve").strip() or "pve"
pve_token_id = os.environ.get("PVE_TOKEN_ID_VAL", "root@pam!pve-panel").strip() or "root@pam!pve-panel"
pve_token_secret = os.environ.get("PVE_TOKEN_SECRET_VAL", "")
pve_verify_ssl = os.environ.get("PVE_VERIFY_SSL_VAL", "false").strip().lower() in {"1", "true", "yes", "on"}
try:
    panel_vmid = max(1, int(os.environ.get("PVE_SELF_VMID_VAL", "116") or "116"))
except ValueError:
    panel_vmid = 116

q = json.dumps
allowed_block = "\n".join(f"    - {q(u)}" for u in allowed) if allowed else "    []"
if allowed:
    allowed_yaml = "  allowed_tailscale_users:\n" + allowed_block
else:
    allowed_yaml = "  allowed_tailscale_users: []"

header = (
    "# ==============================================================================\n"
    "# PVE Command Center — Configuration déclarative (config/config.yaml)\n"
    f"# Généré par install.sh (référence : {example_path.name if example_path.is_file() else 'config.example.yaml'})\n"
    "# ==============================================================================\n"
)

content = f"""{header}version: 1

server:
  id: {q(str(uuid.uuid4()))}
  name: "PVE Command Center"
  listen_host: "0.0.0.0"
  listen_port: 8000
  public_url: ""
  mdns_enabled: true
  mdns_service_name: "PVE Command Center"
  mdns_service_type: "_pvecenter._tcp.local."
  refresh_interval_seconds: 5

security:
  tailscale_sso_enabled: true
{allowed_yaml}
  dev_auth_bypass: false
  protected_owner_username: {q(owner)}
  session_secret: {q(session_secret)}
  admin_pin_hash: ""
  api_tokens: []

proxmox:
  host: {q(pve_host)}
  token_id: {q(pve_token_id)}
  token_secret: {q(pve_token_secret)}
  verify_ssl: {"true" if pve_verify_ssl else "false"}
  default_node: {q(pve_node)}
  panel_self_vmid: {panel_vmid}

integrations:
  jellyfin:
    url: ""
    api_key: ""
  jellyseerr:
    url: ""
    api_key: ""
  plex:
    url: ""
    token: ""
  radarr:
    url: ""
    api_key: ""
  sonarr:
    url: ""
    api_key: ""
  prowlarr:
    url: ""
    api_key: ""
  qbittorrent:
    url: ""
    username: ""
    password: ""

alerts:
  enabled: true
  default_consecutive_failures: 3
  default_cooldown_seconds: 300
  check_interval_seconds: 30

notifications:
  apns:
    enabled: false
    team_id: ""
    key_id: ""
    bundle_id: "io.ac.pvepanel.app"
    private_key_path: "/app/config/AuthKey.p8"
    use_sandbox: true
  webhooks: []

categories: []
custom_services: []
storage_mounts: []
"""
out_path.write_text(content, encoding="utf-8")
PYEOF
  elif [[ -f "$example_file" ]]; then
    cp "$example_file" "$config_file"
  else
    cat >"$config_file" <<EOF
version: 1
server:
  name: "PVE Command Center"
  listen_host: "0.0.0.0"
  listen_port: 8000
  public_url: ""
  mdns_enabled: true
  mdns_service_name: "PVE Command Center"
  mdns_service_type: "_pvecenter._tcp.local."
  refresh_interval_seconds: 5
security:
  tailscale_sso_enabled: true
  allowed_tailscale_users: []
  dev_auth_bypass: false
  protected_owner_username: "${owner_user}"
  session_secret: "${session_secret}"
  admin_pin_hash: ""
  api_tokens: []
EOF
  fi

  chmod 600 "$config_file"
  log_ok "Fichier config/config.yaml initialisé (mode 600, prêt pour hot-reload et onboarding)."
}

update_config_public_url() {
  local config_file="$1"
  local public_url="$2"
  [[ -f "$config_file" && -n "$public_url" ]] || return 0
  if command -v python3 >/dev/null 2>&1; then
    PVE_CFG_FILE="$config_file" PVE_PUBLIC_URL="$public_url" python3 - <<'PYEOF'
import json
import os
from pathlib import Path
import re

path = Path(os.environ["PVE_CFG_FILE"])
public_url = os.environ["PVE_PUBLIC_URL"].strip()
text = path.read_text(encoding="utf-8")
updated = re.sub(
    r'^(\s*public_url:\s*)(?:""|\x27\x27|https://pve-panel\.example\.ts\.net)\s*$',
    lambda m: f"{m.group(1)}{json.dumps(public_url)}",
    text,
    count=1,
    flags=re.MULTILINE,
)
if updated != text:
    path.write_text(updated, encoding="utf-8")
PYEOF
  fi
}

run_mode_b_linux() {
  local repo_dir="$1"
  local ts_hostname="${2:-}"
  local allowed_users="${3:-}"
  local pve_node="${4:-}"

  log_info "Déploiement Mode B (Serveur Linux / Conteneur LXC) dans ${repo_dir}"

  ensure_docker
  ensure_tailscale

  cd "$repo_dir"

  ensure_config_dir_and_mount "$repo_dir"

  if [[ ! -f .env ]]; then
    cp .env.example .env
    chmod 600 .env
    log_ok "Fichier .env créé depuis .env.example."
  fi
  if [[ ! -f services.yaml ]]; then
    cp services.example.yaml services.yaml
    log_ok "Fichier services.yaml créé depuis services.example.yaml."
  fi

  if [[ -z "$allowed_users" ]]; then
    local current_users
    current_users="$(get_env_var .env ALLOWED_TAILSCALE_USERS)"
    if [[ -z "$current_users" || "$current_users" == "user@example.com" ]]; then
      while [[ -z "$allowed_users" || "$allowed_users" == "user@example.com" ]]; do
        read_input allowed_users "Email(s) Tailscale autorisé(s) (ALLOWED_TAILSCALE_USERS)" ""
      done
    else
      read_input allowed_users "Email(s) Tailscale autorisé(s) (ALLOWED_TAILSCALE_USERS)" "$current_users"
    fi
  fi

  if [[ -z "$ts_hostname" ]]; then
    local default_host
    default_host="$(hostname -s 2>/dev/null || echo 'pve-panel')"
    read_input ts_hostname "Nom d'hôte Tailscale" "$default_host"
  fi

  set_env_var .env DEV_AUTH_BYPASS "false"
  set_env_var .env ALLOWED_TAILSCALE_USERS "$allowed_users"

  local session_secret
  session_secret="$(ensure_session_secret_in_env .env)"
  log_ok "SESSION_SECRET initial vérifié / généré."

  local owner_user
  owner_user="$(get_env_var .env PROTECTED_OWNER_USERNAME)"
  owner_user="${owner_user:-admin}"

  if [[ -z "$pve_node" ]]; then
    pve_node="$(get_env_var .env PVE_NODE)"
    pve_node="${pve_node:-pve}"
  fi

  create_initial_config_yaml "$repo_dir" "$allowed_users" "$owner_user" "$pve_node" "$session_secret"

  log_info "Construction et démarrage du conteneur Docker (pve-panel)..."
  docker compose up -d --build
  log_ok "Conteneur Docker démarré sur ${LISTEN_HOST:-0.0.0.0}:${LISTEN_PORT:-8000} (volume ./config:/app/config:rw)."

  configure_tailscale_serve "$ts_hostname"

  local dns_name
  dns_name="$(detect_tailscale_dns_name)"
  if [[ -n "$dns_name" ]]; then
    update_config_public_url "${repo_dir}/config/config.yaml" "https://${dns_name}"
  fi
  print_final_summary "$dns_name" "$pve_node" "${allowed_users%%,*}"
}

detect_pve_ip() {
  local ip
  ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)"
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  printf '%s\n' "${ip:-192.168.1.10}"
}

ensure_debian12_template() {
  local tmpl_storage="$1"
  pveam update >/dev/null 2>&1 || true
  local existing
  existing="$(pveam list "$tmpl_storage" 2>/dev/null | awk '/debian-12-standard/ {print $1; exit}' || true)"
  if [[ -n "$existing" ]]; then
    printf '%s\n' "$existing"
    return
  fi

  local available
  available="$(pveam available -section system 2>/dev/null | awk '/debian-12-standard/ {print $2}' | sort -V | tail -n1 || true)"
  if [[ -z "$available" ]]; then
    log_err "Impossible de trouver un template Debian 12 via pveam."
    exit 1
  fi
  log_info "Téléchargement du template LXC ${available} sur ${tmpl_storage}..." >&2
  pveam download "$tmpl_storage" "$available" >&2
  printf '%s:vztmpl/%s\n' "$tmpl_storage" "$available"
}

create_pve_api_token() {
  log_info "Configuration du rôle Proxmox PanelRole et du token root@pam!pve-panel..." >&2
  if pveum role list 2>/dev/null | grep -qw "PanelRole"; then
    pveum role modify PanelRole -privs "Sys.Audit VM.Audit Datastore.Audit VM.PowerMgmt" >/dev/null
  else
    pveum role add PanelRole -privs "Sys.Audit VM.Audit Datastore.Audit VM.PowerMgmt" >/dev/null
  fi

  local create_token="yes"
  if pveum user token list root@pam --output-format json 2>/dev/null | grep -q '"pve-panel"'; then
    log_warn "Le token API root@pam!pve-panel existe déjà." >&2
    if confirm_yes_no "Régénérer un nouveau secret pour root@pam!pve-panel ?" "Y"; then
      pveum user token remove root@pam pve-panel >/dev/null
    else
      create_token="no"
    fi
  fi

  local token_secret=""
  if [[ "$create_token" == "yes" ]]; then
    local token_json
    token_json="$(pveum user token add root@pam pve-panel --privsep 1 --output-format json)"
    token_secret="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["value"])' <<< "$token_json")"
    log_ok "Token API Proxmox root@pam!pve-panel généré." >&2
  else
    read_input token_secret "Secret existant pour root@pam!pve-panel (laisser vide pour le saisir dans le Setup Web)" "replace-with-pve-token-secret"
  fi

  pveum acl modify / -tokens "root@pam!pve-panel" -roles PanelRole >/dev/null
  printf '%s\n' "$token_secret"
}

run_mode_a_proxmox() {
  local repo_dir="$1"
  log_info "Hôte Proxmox VE détecté ($(pveversion | head -n1))."

  if ! confirm_yes_no "Créer un conteneur LXC Debian 12 dédié pour PVE Command Center ?" "Y"; then
    run_mode_b_linux "$repo_dir"
    return
  fi

  local next_vmid default_storage default_tmpl_storage
  next_vmid="$(pvesh get /cluster/nextid 2>/dev/null || echo '116')"
  default_storage="$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $2=="active" {print $1; exit}' || true)"
  default_storage="${default_storage:-local-lvm}"
  default_tmpl_storage="$(pvesm status -content vztmpl 2>/dev/null | awk 'NR>1 && $2=="active" {print $1; exit}' || true)"
  default_tmpl_storage="${default_tmpl_storage:-local}"

  local vmid lxc_hostname ram_mb disk_raw disk_gb bridge rootfs_storage ip_cfg gw_cfg net0_spec
  read_input vmid "VMID du nouveau LXC" "$next_vmid"
  if pct status "$vmid" >/dev/null 2>&1 || qm status "$vmid" >/dev/null 2>&1; then
    log_err "Le VMID ${vmid} existe déjà sur ce nœud."
    exit 1
  fi

  read_input lxc_hostname "Nom d'hôte du LXC" "pve-panel"
  read_input ram_mb "Mémoire RAM (Mo)" "1024"
  read_input disk_raw "Taille disque" "8G"
  disk_gb="${disk_raw%[Gg]}"
  read_input rootfs_storage "Stockage Proxmox pour le disque rootfs" "$default_storage"
  read_input bridge "Bridge réseau" "vmbr0"
  read_input ip_cfg "Adresse IP du LXC (dhcp ou CIDR ex: 192.168.1.50/24)" "dhcp"

  if [[ "$ip_cfg" == "dhcp" ]]; then
    net0_spec="name=eth0,bridge=${bridge},ip=dhcp"
  else
    read_input gw_cfg "Passerelle (Gateway)" ""
    net0_spec="name=eth0,bridge=${bridge},ip=${ip_cfg}"
    [[ -n "$gw_cfg" ]] && net0_spec+=",gw=${gw_cfg}"
  fi

  local allowed_users=""
  while [[ -z "$allowed_users" || "$allowed_users" == "user@example.com" ]]; do
    read_input allowed_users "Email(s) Tailscale autorisé(s) (ALLOWED_TAILSCALE_USERS)" ""
  done

  local owner_user
  read_input owner_user "Nom d'utilisateur propriétaire protégé (PROTECTED_OWNER_USERNAME)" "admin"

  local default_pve_ip default_pve_node pve_host pve_node
  default_pve_ip="$(detect_pve_ip)"
  default_pve_node="$(hostname -s)"
  read_input pve_host "URL API Proxmox accessible depuis le LXC" "https://${default_pve_ip}:8006"
  read_input pve_node "Nom du nœud Proxmox" "$default_pve_node"

  local tmpl_vol
  tmpl_vol="$(ensure_debian12_template "$default_tmpl_storage")"

  log_info "Création du LXC ${vmid} (${lxc_hostname})..."
  pct create "$vmid" "$tmpl_vol" \
    --hostname "$lxc_hostname" \
    --memory "$ram_mb" \
    --swap 512 \
    --cores 2 \
    --rootfs "${rootfs_storage}:${disk_gb}" \
    --net0 "$net0_spec" \
    --features "nesting=1,keyctl=1" \
    --unprivileged 1 \
    --onboot 1 \
    --start 0

  local lxc_conf="/etc/pve/lxc/${vmid}.conf"
  if ! grep -q "host_mnt" "$lxc_conf" 2>/dev/null; then
    printf '\nlxc.mount.entry: /mnt host_mnt none rbind,ro,create=dir 0 0\n' >> "$lxc_conf"
    log_ok "Montage /mnt -> /host_mnt (lecture seule) ajouté dans ${lxc_conf}."
  fi

  log_info "Démarrage du LXC ${vmid}..."
  pct start "$vmid"

  log_info "Attente de la connectivité réseau dans le LXC ${vmid}..."
  pct exec "$vmid" -- bash -c 'for i in $(seq 1 30); do getent hosts deb.debian.org >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'

  local token_secret
  token_secret="$(create_pve_api_token)"

  log_info "Copie du dépôt dans /opt/pve-panel du LXC ${vmid}..."
  pct exec "$vmid" -- mkdir -p /opt/pve-panel /opt/pve-panel/config
  tar \
    --exclude='.git' \
    --exclude='.env' \
    --exclude='services.yaml' \
    --exclude='config/config.yaml' \
    --exclude='config/*.db' \
    --exclude='config/*.db-*' \
    --exclude='config/*.p8' \
    --exclude='.venv' \
    --exclude='frontend/node_modules' \
    --exclude='frontend/dist' \
    --exclude='ios-native' \
    --exclude='__pycache__' \
    -C "$repo_dir" -cf - . | pct exec "$vmid" -- tar -C /opt/pve-panel -xf -

  pct exec "$vmid" -- bash -c '
    set -e
    cd /opt/pve-panel
    mkdir -p config
    chmod 700 config
    [[ -f .env ]] || cp .env.example .env
    [[ -f services.yaml ]] || cp services.example.yaml services.yaml
    chmod 600 .env
  '

  local tmp_env lxc_session_secret
  tmp_env="$(mktemp)"
  lxc_session_secret="$(generate_session_secret)"
  pct pull "$vmid" /opt/pve-panel/.env "$tmp_env"
  set_env_var "$tmp_env" DEV_AUTH_BYPASS "false"
  set_env_var "$tmp_env" ALLOWED_TAILSCALE_USERS "$allowed_users"
  set_env_var "$tmp_env" PROTECTED_OWNER_USERNAME "$owner_user"
  set_env_var "$tmp_env" SESSION_SECRET "$lxc_session_secret"
  set_env_var "$tmp_env" PVE_HOST "$pve_host"
  set_env_var "$tmp_env" PVE_NODE "$pve_node"
  set_env_var "$tmp_env" PVE_TOKEN_ID "root@pam!pve-panel"
  set_env_var "$tmp_env" PVE_TOKEN_SECRET "$token_secret"
  set_env_var "$tmp_env" PVE_VERIFY_SSL "false"
  set_env_var "$tmp_env" PANEL_SELF_VMID "$vmid"
  pct push "$vmid" "$tmp_env" /opt/pve-panel/.env --perms 0600
  rm -f "$tmp_env"

  log_info "Installation de Docker + Tailscale + Stack dans le LXC ${vmid}..."
  pct exec "$vmid" -- chmod +x /opt/pve-panel/install.sh
  pct exec "$vmid" -- bash /opt/pve-panel/install.sh \
    --in-container \
    --ts-hostname "$lxc_hostname" \
    --allowed-users "$allowed_users" \
    --pve-node "$pve_node"

  log_info "Configuration automatique de la clé SSH Ed25519 du Centre de Mises à Jour..."
  pct exec "$vmid" -- bash -c '
    set -e
    if [[ ! -f /opt/pve-panel/config/id_ed25519_updates.pub ]]; then
      if command -v ssh-keygen >/dev/null 2>&1; then
        ssh-keygen -t ed25519 -N "" -C "pve-center-updates" -f /opt/pve-panel/config/id_ed25519_updates >/dev/null
      fi
    fi
  ' >/dev/null 2>&1 || true

  local upd_pub=""
  upd_pub="$(pct exec "$vmid" -- cat /opt/pve-panel/config/id_ed25519_updates.pub 2>/dev/null || true)"
  if [[ -n "$upd_pub" ]]; then
    mkdir -p /root/.ssh
    chmod 700 /root/.ssh
    touch /root/.ssh/authorized_keys
    chmod 600 /root/.ssh/authorized_keys
    grep -qxF "$upd_pub" /root/.ssh/authorized_keys 2>/dev/null || printf '%s\n' "$upd_pub" >> /root/.ssh/authorized_keys
    log_ok "Clé SSH du Centre de Mises à Jour autorisée dans /root/.ssh/authorized_keys (Proxmox, LXC & Docker prêts)."
  fi
}

main() {
  local in_container="false"
  local ts_hostname=""
  local allowed_users=""
  local pve_node=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --in-container)
        in_container="true"
        shift
        ;;
      --ts-hostname)
        ts_hostname="${2:-}"
        shift 2
        ;;
      --allowed-users)
        allowed_users="${2:-}"
        shift 2
        ;;
      --pve-node)
        pve_node="${2:-}"
        shift 2
        ;;
      -h|--help)
        cat <<'EOF'
Usage: ./install.sh [OPTIONS]
Installe PVE Command Center sur un hôte Proxmox VE (création LXC dédiée)
ou sur un serveur Linux / conteneur LXC existant (Docker + Tailscale Serve + config/config.yaml).

Options :
  --in-container             Forcer le mode serveur Linux / LXC existant (Mode B)
  --ts-hostname <nom>        Nom d'hôte Tailscale souhaité
  --allowed-users <emails>   Email(s) Tailscale autorisés séparés par des virgules
  --pve-node <noeud>         Nom du nœud Proxmox VE par défaut
  -h, --help                 Afficher cette aide
EOF
        exit 0
        ;;
      *)
        log_err "Option inconnue : $1"
        exit 1
        ;;
    esac
  done

  require_root

  local repo_dir
  repo_dir="$(resolve_repo_dir)"

  if [[ "$in_container" == "true" ]]; then
    run_mode_b_linux "$repo_dir" "$ts_hostname" "$allowed_users" "$pve_node"
    return
  fi

  if command -v pveversion >/dev/null 2>&1; then
    run_mode_a_proxmox "$repo_dir"
  else
    run_mode_b_linux "$repo_dir" "$ts_hostname" "$allowed_users" "$pve_node"
  fi
}

main "$@"
