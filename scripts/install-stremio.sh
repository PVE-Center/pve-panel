#!/usr/bin/env bash
# ==============================================================================
# PVE Command Center — Installateur Stremio All-in-One (Proxmox LXC ou Linux)
# Déploie tsaridas/stremio-docker (stremio-web + stremio-server + FFmpeg/VAAPI)
# avec HTTP Basic Auth natif, prêt pour reverse proxy HTTPS (Zoraxy / NPM).
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

NON_INTERACTIVE="false"
IN_CONTAINER="false"
ARG_VMID=""
ARG_HOSTNAME="stremio"
ARG_RAM="2048"
ARG_CORES="2"
ARG_DISK="16"
ARG_STORAGE=""
ARG_BRIDGE="vmbr0"
ARG_IP="dhcp"
ARG_GW=""
ARG_DOMAIN=""
ARG_USERNAME="admin"
ARG_PASSWORD=""
ARG_PORT="8080"
ARG_NO_GPU="false"

read_input() {
  local __var="$1" __prompt="$2" __default="${3:-}" __reply=""
  if [[ "$NON_INTERACTIVE" == "true" ]]; then
    printf -v "$__var" '%s' "$__default"
    return
  fi
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

read_secret_optional() {
  local __var="$1" __prompt="$2" __reply=""
  if [[ "$NON_INTERACTIVE" == "true" ]]; then
    printf -v "$__var" '%s' ""
    return
  fi
  if [[ -r /dev/tty && -w /dev/tty ]]; then
    printf "%s (laisser vide = génération aléatoire): " "$__prompt" >/dev/tty
    read -rs __reply </dev/tty || __reply=""
    printf "\n" >/dev/tty
  else
    printf "%s (laisser vide = génération aléatoire): " "$__prompt"
    read -rs __reply || __reply=""
    printf "\n"
  fi
  printf -v "$__var" '%s' "$__reply"
}

confirm_yes_no() {
  local __prompt="$1" __default="${2:-Y}" __ans=""
  if [[ "$NON_INTERACTIVE" == "true" ]]; then
    [[ "$__default" == "Y" ]] && return 0 || return 1
  fi
  local __hint="O/n"
  [[ "$__default" == "N" ]] && __hint="o/N"
  read_input __ans "$__prompt ($__hint)" "$__default"
  case "${__ans,,}" in
    y|yes|o|oui) return 0 ;;
    *) return 1 ;;
  esac
}

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    log_err "Ce script doit être exécuté en tant que root (utilisez sudo ./install-stremio.sh)."
    exit 1
  fi
}

generate_password() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import secrets, string; a = string.ascii_letters + string.digits; print("".join(secrets.choice(a) for _ in range(24)))'
    return
  fi
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 24
    printf '\n'
    return
  fi
  tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24
  printf '\n'
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log_ok "Docker Engine et Docker Compose v2 sont déjà installés."
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

write_stremio_stack() {
  local stack_dir="/opt/stremio"
  local port="$1"
  local domain="$2"
  local username="$3"
  local password="$4"
  local use_gpu="$5"

  mkdir -p "${stack_dir}/stremio-data"

  local server_url=""
  if [[ -n "$domain" ]]; then
    domain="${domain#https://}"
    domain="${domain#http://}"
    domain="${domain%%/*}"
    server_url="https://${domain}/"
  fi

  local env_file="${stack_dir}/.env"
  cat > "$env_file" <<EOF
# Stremio All-in-One (tsaridas/stremio-docker)
STREMIO_PORT=${port}
NO_CORS=1
AUTO_SERVER_URL=1
SERVER_URL=${server_url}
USERNAME=${username}
PASSWORD=${password}
CASTING_DISABLED=1
VAAPI_PREFLIGHT=1
EOF
  chmod 600 "$env_file"

  local devices_block=""
  if [[ "$use_gpu" == "true" ]] && [[ -d /dev/dri ]]; then
    local render_nodes=()
    for node in /dev/dri/renderD*; do
      [[ -e "$node" ]] && render_nodes+=("$(basename "$node")")
    done
    if [[ ${#render_nodes[@]} -gt 0 ]]; then
      if [[ -e /dev/dri/renderD128 ]]; then
        devices_block=$'    devices:\n      - /dev/dri:/dev/dri'
      else
        local first_render="${render_nodes[0]}"
        devices_block=$'    devices:\n      - /dev/dri/'"${first_render}"$':/dev/dri/renderD128'
        for card in /dev/dri/card*; do
          if [[ -e "$card" ]]; then
            local card_name
            card_name="$(basename "$card")"
            devices_block+=$'\n      - /dev/dri/'"${card_name}:/dev/dri/${card_name}"
          fi
        done
      fi
    fi
  fi

  local compose_file="${stack_dir}/docker-compose.yml"
  cat > "$compose_file" <<EOF
services:
  stremio:
    image: tsaridas/stremio-docker:latest
    container_name: stremio
    restart: unless-stopped
    ports:
      - "\${STREMIO_PORT:-8080}:8080"
    env_file:
      - .env
    volumes:
      - ./stremio-data:/root/.stremio-server
EOF
  if [[ -n "$devices_block" ]]; then
    printf '%s\n' "$devices_block" >> "$compose_file"
  fi
  cat >> "$compose_file" <<'EOF'
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:11470/settings').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 25s
EOF
}

wait_for_stremio_http() {
  local port="$1"
  local username="$2"
  local password="$3"
  local curl_auth=()
  if [[ -n "$username" && -n "$password" ]]; then
    curl_auth=(-u "${username}:${password}")
  fi

  log_info "Attente du démarrage de Stremio sur le port ${port} (max 45s)..."
  for _ in $(seq 1 45); do
    local code body
    body="$(curl -fsS --max-time 2 "${curl_auth[@]}" "http://127.0.0.1:${port}/settings" 2>/dev/null || true)"
    if [[ -n "$body" ]] && printf '%s' "$body" | grep -qE 'serverVersion|cacheSize|values'; then
      log_ok "Stremio Server répond en HTTP 200 JSON sur /settings."
      return 0
    fi
    sleep 1
  done
  log_warn "Stremio met plus de 45s à répondre sur /settings. Vérifiez : docker logs stremio"
  return 0
}

print_summary() {
  local host_ip="$1"
  local port="$2"
  local domain="$3"
  local username="$4"
  local password="$5"
  local vmid="${6:-}"
  local has_gpu="${7:-false}"

  local clean_domain="${domain#https://}"
  clean_domain="${clean_domain#http://}"
  clean_domain="${clean_domain%%/*}"
  local example_domain="${clean_domain:-stremio.example.com}"

  printf "\n${BOLD}${GREEN}======================================================================${NC}\n"
  printf "${BOLD}${GREEN}  Stremio All-in-One est installé et opérationnel !${NC}\n"
  printf "${BOLD}${GREEN}======================================================================${NC}\n\n"
  printf "  ${BOLD}URL LAN directe :${NC}      http://%s:%s\n" "$host_ip" "$port"
  printf "  ${BOLD}Identifiant Basic Auth :${NC} %s\n" "$username"
  printf "  ${BOLD}Mot de passe Basic Auth :${NC} %s\n" "$password"
  printf "  ${BOLD}Dossier stack Docker :${NC} /opt/stremio\n"
  printf "  ${BOLD}Transcodage VAAPI :${NC}    %s\n" "$([[ "$has_gpu" == "true" ]] && echo "Activé (/dev/dri monté)" || echo "CPU (aucun GPU monté)")"
  [[ -n "$vmid" ]] && printf "  ${BOLD}Conteneur LXC Proxmox :${NC} VMID %s\n" "$vmid"

  printf "\n${BOLD}${CYAN}--- Configuration Reverse Proxy HTTPS ---${NC}\n"
  printf "  ${BOLD}Option A — Zoraxy :${NC}\n"
  printf "    1. Créez une règle Proxy : Domaine '%s' -> http://%s:%s\n" "$example_domain" "$host_ip" "$port"
  printf "    2. Activez HTTPS (ACME Let's Encrypt) et WebSockets Support.\n"
  printf "    3. ${YELLOW}IMPORTANT :${NC} n'activez PAS la Basic Auth globale dans Zoraxy :\n"
  printf "       elle est déjà assurée dans le conteneur (sinon les sondes HLS /manifest.json\n"
  printf "       et /{infoHash}/-1 sont bloquées).\n\n"
  printf "  ${BOLD}Option B — Nginx Proxy Manager (NPM) :${NC}\n"
  printf "    1. Details : Domain '%s', Scheme 'http', Forward '%s:%s', Websockets ON.\n" "$example_domain" "$host_ip" "$port"
  printf "    2. SSL : Let's Encrypt, Force SSL, HTTP/2 Support.\n"
  printf "    3. Advanced (Custom Nginx) :\n"
  printf "       proxy_buffering off;\n"
  printf "       proxy_request_buffering off;\n"
  printf "       proxy_read_timeout 3600s;\n"
  printf "       client_max_body_size 0;\n\n"

  printf "${BOLD}${CYAN}--- Intégration PVE Command Center ---${NC}\n"
  printf "  1. Assistant Setup (Médias) : URL http://%s:%s, User '%s', Password ci-dessus.\n" "$host_ip" "$port" "$username"
  printf "  2. Carte Services : Icône 'stremio', Widget 'stremio', URL https://%s\n" "$example_domain"
  if [[ -n "$vmid" ]]; then
    printf "  3. Mises à jour (config.yaml -> updates.docker_targets) :\n"
    printf "     - { id: \"stremio\", name: \"Stremio Web & Server\", scope: \"lxc\", vmid: %s, compose_dir: \"/opt/stremio\" }\n\n" "$vmid"
  else
    printf "  3. Mises à jour (config.yaml -> updates.docker_targets) :\n"
    printf "     - { id: \"stremio\", name: \"Stremio Web & Server\", scope: \"local\", compose_dir: \"/opt/stremio\" }\n\n"
  fi
}

run_in_container() {
  local port="$1"
  local domain="$2"
  local username="$3"
  local password="$4"
  local no_gpu="$5"
  local vmid="${6:-}"

  ensure_docker
  if command -v apt-get >/dev/null 2>&1 && ! command -v curl >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y curl
  fi

  local use_gpu="false"
  if [[ "$no_gpu" != "true" ]] && [[ -d /dev/dri ]] && ls /dev/dri/renderD* >/dev/null 2>&1; then
    use_gpu="true"
  fi

  log_info "Génération de /opt/stremio/docker-compose.yml et /opt/stremio/.env..."
  write_stremio_stack "$port" "$domain" "$username" "$password" "$use_gpu"

  log_info "Téléchargement de tsaridas/stremio-docker:latest et démarrage..."
  (cd /opt/stremio && docker compose pull && docker compose up -d)

  wait_for_stremio_http "$port" "$username" "$password"

  local host_ip
  host_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  host_ip="${host_ip:-127.0.0.1}"

  if [[ "$IN_CONTAINER" == "true" && -z "$vmid" ]]; then
    print_summary "$host_ip" "$port" "$domain" "$username" "$password" "" "$use_gpu"
  fi
}

run_on_proxmox_host() {
  log_info "Hôte Proxmox VE détecté ($(pveversion | head -n1))."

  local next_vmid default_storage default_tmpl_storage
  next_vmid="$(pvesh get /cluster/nextid 2>/dev/null || echo '120')"
  default_storage="$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $2=="active" {print $1; exit}' || true)"
  default_storage="${default_storage:-local-lvm}"
  default_tmpl_storage="$(pvesm status -content vztmpl 2>/dev/null | awk 'NR>1 && $2=="active" {print $1; exit}' || true)"
  default_tmpl_storage="${default_tmpl_storage:-local}"

  local vmid lxc_hostname ram_mb cores disk_gb bridge rootfs_storage ip_cfg gw_cfg net0_spec domain username password port
  vmid="${ARG_VMID:-$next_vmid}"
  read_input vmid "VMID du nouveau conteneur LXC Stremio" "$vmid"
  if pct status "$vmid" >/dev/null 2>&1 || qm status "$vmid" >/dev/null 2>&1; then
    log_err "Le VMID ${vmid} existe déjà sur ce nœud."
    exit 1
  fi

  read_input lxc_hostname "Nom d'hôte du LXC" "$ARG_HOSTNAME"
  read_input ram_mb "Mémoire RAM (Mo)" "$ARG_RAM"
  read_input cores "Nombre de vCPU" "$ARG_CORES"
  read_input disk_gb "Taille disque rootfs (Go)" "$ARG_DISK"
  disk_gb="${disk_gb%[Gg]}"
  read_input rootfs_storage "Stockage Proxmox pour le rootfs" "${ARG_STORAGE:-$default_storage}"
  read_input bridge "Bridge réseau" "$ARG_BRIDGE"
  read_input ip_cfg "Adresse IP du LXC (dhcp ou CIDR recommandé ex: 192.168.1.33/24)" "$ARG_IP"

  if [[ "$ip_cfg" == "dhcp" ]]; then
    net0_spec="name=eth0,bridge=${bridge},ip=dhcp"
  else
    read_input gw_cfg "Passerelle (Gateway)" "$ARG_GW"
    net0_spec="name=eth0,bridge=${bridge},ip=${ip_cfg}"
    [[ -n "$gw_cfg" ]] && net0_spec+=",gw=${gw_cfg}"
  fi

  read_input domain "Domaine HTTPS public Zoraxy/NPM (optionnel, ex: stremio.example.com)" "$ARG_DOMAIN"
  read_input username "Identifiant HTTP Basic Auth Stremio" "$ARG_USERNAME"
  if [[ -n "$ARG_PASSWORD" ]]; then
    password="$ARG_PASSWORD"
  else
    read_secret_optional password "Mot de passe HTTP Basic Auth Stremio"
  fi
  if [[ -z "$password" ]]; then
    password="$(generate_password)"
    log_ok "Mot de passe Basic Auth généré aléatoirement (24 caractères)."
  fi
  read_input port "Port HTTP interne Stremio" "$ARG_PORT"

  local use_gpu="false"
  local render_dev=""
  if [[ "$ARG_NO_GPU" != "true" ]] && ls /dev/dri/renderD* >/dev/null 2>&1; then
    if [[ -e /dev/dri/renderD128 ]]; then
      render_dev="/dev/dri/renderD128"
    else
      render_dev="$(ls /dev/dri/renderD* 2>/dev/null | head -n1 || true)"
    fi
    if [[ -n "$render_dev" ]] && confirm_yes_no "GPU détecté (${render_dev}). Activer le passthrough VAAPI dans le LXC ?" "Y"; then
      use_gpu="true"
    fi
  fi

  local tmpl_vol
  tmpl_vol="$(ensure_debian12_template "$default_tmpl_storage")"

  log_info "Création du LXC ${vmid} (${lxc_hostname})..."
  pct create "$vmid" "$tmpl_vol" \
    --hostname "$lxc_hostname" \
    --memory "$ram_mb" \
    --swap 1024 \
    --cores "$cores" \
    --rootfs "${rootfs_storage}:${disk_gb}" \
    --net0 "$net0_spec" \
    --features "nesting=1,keyctl=1" \
    --unprivileged 1 \
    --onboot 1 \
    --start 0

  if [[ "$use_gpu" == "true" ]]; then
    local lxc_conf="/etc/pve/lxc/${vmid}.conf"
    local render_name
    render_name="$(basename "$render_dev")"
    if pct set "$vmid" -dev0 "/dev/dri/${render_name},gid=44,mode=0666" >/dev/null 2>&1; then
      log_ok "Passthrough VAAPI configuré via pct set -dev0 (/dev/dri/${render_name})."
    else
      {
        printf '\nlxc.cgroup2.devices.allow: c 226:* rwm\n'
        printf 'lxc.mount.entry: /dev/dri dev/dri none bind,optional,create=dir 0 0\n'
      } >> "$lxc_conf"
      log_ok "Passthrough VAAPI configuré via lxc.mount.entry dans ${lxc_conf}."
    fi
  fi

  log_info "Démarrage du LXC ${vmid}..."
  pct start "$vmid"

  log_info "Attente de la connectivité réseau dans le LXC ${vmid}..."
  pct exec "$vmid" -- bash -c 'for i in $(seq 1 30); do getent hosts deb.debian.org >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'

  log_info "Installation de Docker & Stremio à l'intérieur du LXC ${vmid}..."
  pct push "$vmid" "$0" /tmp/install-stremio.sh --perms 0755
  local gpu_flag=""
  [[ "$use_gpu" != "true" ]] && gpu_flag="--no-gpu"

  pct exec "$vmid" -- bash /tmp/install-stremio.sh \
    --in-container \
    --non-interactive \
    --port "$port" \
    --domain "$domain" \
    --username "$username" \
    --password "$password" \
    ${gpu_flag:+"$gpu_flag"}
  pct exec "$vmid" -- rm -f /tmp/install-stremio.sh

  local lxc_ip
  lxc_ip="$(pct exec "$vmid" -- hostname -I 2>/dev/null | awk '{print $1}' || true)"
  lxc_ip="${lxc_ip:-<IP_DU_LXC_${vmid}>}"
  print_summary "$lxc_ip" "$port" "$domain" "$username" "$password" "$vmid" "$use_gpu"
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --in-container)    IN_CONTAINER="true"; shift ;;
      --non-interactive) NON_INTERACTIVE="true"; shift ;;
      --vmid)            ARG_VMID="${2:-}"; shift 2 ;;
      --hostname)        ARG_HOSTNAME="${2:-}"; shift 2 ;;
      --ram)             ARG_RAM="${2:-}"; shift 2 ;;
      --cores)           ARG_CORES="${2:-}"; shift 2 ;;
      --disk)            ARG_DISK="${2:-}"; shift 2 ;;
      --storage)         ARG_STORAGE="${2:-}"; shift 2 ;;
      --bridge)          ARG_BRIDGE="${2:-}"; shift 2 ;;
      --ip)              ARG_IP="${2:-}"; shift 2 ;;
      --gw)              ARG_GW="${2:-}"; shift 2 ;;
      --domain)          ARG_DOMAIN="${2:-}"; shift 2 ;;
      --username)        ARG_USERNAME="${2:-}"; shift 2 ;;
      --password)        ARG_PASSWORD="${2:-}"; shift 2 ;;
      --port)            ARG_PORT="${2:-}"; shift 2 ;;
      --no-gpu)          ARG_NO_GPU="true"; shift ;;
      -h|--help)
        cat <<'EOF'
Usage: ./install-stremio.sh [OPTIONS]
Déploie Stremio All-in-One (stremio-web + stremio-server + VAAPI) dans un nouveau
conteneur LXC Proxmox VE ou directement sur un hôte Linux / LXC existant.

Options :
  --in-container          Déployer localement via Docker Compose dans /opt/stremio
  --non-interactive       Accepter les valeurs par défaut / paramètres CLI sans prompt
  --vmid <id>             VMID du conteneur LXC Proxmox
  --hostname <nom>        Nom d'hôte du LXC (défaut: stremio)
  --ram <Mo>              Mémoire RAM en Mo (défaut: 2048)
  --cores <n>             vCPU (défaut: 2)
  --disk <Go>             Taille disque en Go (défaut: 16)
  --storage <pool>        Stockage rootfs Proxmox
  --bridge <vmbr>         Bridge réseau (défaut: vmbr0)
  --ip <dhcp|CIDR>        Configuration IP (défaut: dhcp)
  --gw <ip>               Passerelle réseau (si IP statique)
  --domain <fqdn>         Domaine HTTPS public (ex: stremio.example.com)
  --username <user>       Identifiant Basic Auth (défaut: admin)
  --password <pass>       Mot de passe Basic Auth (généré si omis)
  --port <port>           Port HTTP exposé (défaut: 8080)
  --no-gpu                Désactiver le passthrough GPU VAAPI
  -h, --help              Afficher cette aide
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

  if [[ "$IN_CONTAINER" == "true" ]]; then
    local pw="${ARG_PASSWORD}"
    if [[ -z "$pw" ]]; then
      pw="$(generate_password)"
    fi
    run_in_container "$ARG_PORT" "$ARG_DOMAIN" "$ARG_USERNAME" "$pw" "$ARG_NO_GPU" ""
    return
  fi

  if command -v pveversion >/dev/null 2>&1; then
    run_on_proxmox_host
  else
    local pw="${ARG_PASSWORD}"
    read_input ARG_DOMAIN "Domaine HTTPS public Zoraxy/NPM (optionnel)" "$ARG_DOMAIN"
    read_input ARG_USERNAME "Identifiant HTTP Basic Auth Stremio" "$ARG_USERNAME"
    if [[ -z "$pw" ]]; then
      read_secret_optional pw "Mot de passe HTTP Basic Auth Stremio"
      [[ -z "$pw" ]] && pw="$(generate_password)"
    fi
    read_input ARG_PORT "Port HTTP interne Stremio" "$ARG_PORT"
    run_in_container "$ARG_PORT" "$ARG_DOMAIN" "$ARG_USERNAME" "$pw" "$ARG_NO_GPU" ""
  fi
}

main "$@"
