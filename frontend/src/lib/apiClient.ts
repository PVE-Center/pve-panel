import type {
  APNsConfigSummary,
  ApiTokenInfo,
  AuthLoginResponse,
  AuthUser,
  ClusterNode,
  ConfigParsedSummary,
  ConfigSaveResponse,
  ConfigValidateResponse,
  ConfigYamlResponse,
  CustomServiceItem,
  CustomServiceTestResponse,
  DiscoveryLanResponse,
  DiscoveryQrResponse,
  ExternalStorageOverview,
  IncidentItem,
  IncidentsResponse,
  NodeSummary,
  NotificationChannelsResponse,
  NotificationTestResponse,
  NotificationTestResultItem,
  OnboardingInitResponse,
  OnboardingStatusResponse,
  OpsOverview,
  PveOverview,
  PveResource,
  PveTaskItem,
  QbitTorrentItem,
  SeerrRequestItem,
  ServiceCategory,
  ServiceHealthStatus,
  ServiceProtocol,
  ServiceStateItem,
  SetupCategoryConfig,
  SetupConfigUpdateResponse,
  SetupEnvConfig,
  SetupStatusResponse,
  SetupTestServiceResponse,
  StorageMountConfig,
  UnifiedUser,
  UpdateJob,
  UpdatesOverviewResponse,
  UpdatesSetupInfoResponse,
  UpdateTargetItem,
  UsersOverview,
  WebhookChannelItem,
  WidgetsMap,
} from '../types';

const STORAGE_SERVER_URL = 'pve_panel_server_url';
const STORAGE_DEMO_MODE = 'pve_panel_demo_mode';
const STORAGE_AUTH_TOKEN = 'pve_panel_auth_token';

let interceptorInstalled = false;
let nativeFetchRef: typeof window.fetch | null = null;

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  return candidate.replace(/\/+$/, '');
}

export function getServerUrl(): string {
  if (typeof window === 'undefined') return '';
  return normalizeServerUrl(window.localStorage.getItem(STORAGE_SERVER_URL) || '');
}

export function setServerUrl(url: string): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeServerUrl(url);
  if (normalized) {
    window.localStorage.setItem(STORAGE_SERVER_URL, normalized);
  } else {
    window.localStorage.removeItem(STORAGE_SERVER_URL);
  }
}

export function getAuthToken(): string {
  if (typeof window === 'undefined') return '';
  return (window.localStorage.getItem(STORAGE_AUTH_TOKEN) || '').trim();
}

export function setAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = token.trim();
  if (trimmed) {
    window.localStorage.setItem(STORAGE_AUTH_TOKEN, trimmed);
  } else {
    window.localStorage.removeItem(STORAGE_AUTH_TOKEN);
  }
}

export function clearAuthToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_AUTH_TOKEN);
}

export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_DEMO_MODE) === 'true';
}

export function setDemoMode(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  if (enabled) {
    window.localStorage.setItem(STORAGE_DEMO_MODE, 'true');
  } else {
    window.localStorage.removeItem(STORAGE_DEMO_MODE);
  }
}

interface DemoNodeProfile {
  name: string;
  status: string;
  online: boolean;
  summary: NodeSummary;
}

interface DemoState {
  serverId: string;
  serverName: string;
  publicUrl: string;
  mdnsEnabled: boolean;
  tailscaleSsoEnabled: boolean;
  pinConfigured: boolean;
  apiTokens: ApiTokenInfo[];
  pveNodes: DemoNodeProfile[];
  resources: PveResource[];
  pveTasks: PveTaskItem[];
  seerrRequests: SeerrRequestItem[];
  qbitAltSpeed: boolean;
  qbitTorrents: QbitTorrentItem[];
  users: UnifiedUser[];
  setupConfigured: boolean;
  setupEnv: SetupEnvConfig;
  categories: SetupCategoryConfig[];
  customServices: CustomServiceItem[];
  incidents: IncidentItem[];
  serviceStates: ServiceStateItem[];
  apns: APNsConfigSummary;
  webhooks: WebhookChannelItem[];
  storageMounts: StorageMountConfig[];
  updatesTargets: UpdateTargetItem[];
  activeUpdateJob: UpdateJob | null;
  recentUpdateJobs: UpdateJob[];
  updatesSshConfigured: boolean;
  updatesLastCheckedAt: string | null;
  yamlOverride: string | null;
}

const GB = 1024 ** 3;
const TB = 1024 ** 4;

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function createInitialDemoState(): DemoState {
  const nowSec = Math.floor(Date.now() / 1000);
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const twelveMinAgo = new Date(Date.now() - 12 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const twoMinAgo = new Date(Date.now() - 120_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  return {
    serverId: 'demo-server-001',
    serverName: 'PVE Command Center (Démo)',
    publicUrl: 'https://panel.example.ts.net',
    mdnsEnabled: true,
    tailscaleSsoEnabled: true,
    pinConfigured: true,
    apiTokens: [
      {
        id: 'tok-demo-admin',
        name: 'Initial Admin Token',
        role: 'admin',
        created_at: oneHourAgo,
      },
      {
        id: 'tok-demo-iphone',
        name: 'iPhone App Token',
        role: 'device',
        created_at: oneHourAgo,
      },
    ],
    pveNodes: [
      {
        name: 'pve-node-01',
        status: 'online',
        online: true,
        summary: {
          name: 'pve-node-01',
          cpu_pct: 23.8,
          cpu_model: 'AMD EPYC / Ryzen Pro Virtualization Host',
          cpu_threads: 16,
          loadavg: ['1.18', '1.05', '0.94'],
          mem_used_bytes: Math.round(28.4 * GB),
          mem_total_bytes: 64 * GB,
          mem_pct: 44.4,
          swap_used_bytes: Math.round(0.4 * GB),
          swap_total_bytes: 8 * GB,
          rootfs_used_bytes: Math.round(42.6 * GB),
          rootfs_total_bytes: 120 * GB,
          uptime_seconds: 1842310,
          uptime_human: '21j 7h 45m',
          pve_version: '8.3.2',
          storages: [
            {
              name: 'local-lvm',
              type: 'lvmthin',
              active: true,
              used_bytes: 412 * GB,
              total_bytes: 1000 * GB,
              used_pct: 41.2,
            },
            {
              name: 'local',
              type: 'dir',
              active: true,
              used_bytes: 88 * GB,
              total_bytes: 240 * GB,
              used_pct: 36.7,
            },
          ],
        },
      },
      {
        name: 'pve-node-02',
        status: 'online',
        online: true,
        summary: {
          name: 'pve-node-02',
          cpu_pct: 14.5,
          cpu_model: 'Intel Xeon E-2388G Virtualization Node',
          cpu_threads: 12,
          loadavg: ['0.62', '0.58', '0.51'],
          mem_used_bytes: Math.round(14.2 * GB),
          mem_total_bytes: 32 * GB,
          mem_pct: 44.4,
          swap_used_bytes: Math.round(0.1 * GB),
          swap_total_bytes: 4 * GB,
          rootfs_used_bytes: Math.round(28.0 * GB),
          rootfs_total_bytes: 100 * GB,
          uptime_seconds: 1123200,
          uptime_human: '13j 0h 0m',
          pve_version: '8.3.2',
          storages: [
            {
              name: 'local-lvm',
              type: 'lvmthin',
              active: true,
              used_bytes: 184 * GB,
              total_bytes: 500 * GB,
              used_pct: 36.8,
            },
            {
              name: 'local',
              type: 'dir',
              active: true,
              used_bytes: 44 * GB,
              total_bytes: 120 * GB,
              used_pct: 36.7,
            },
          ],
        },
      },
    ],
    resources: [
      {
        vmid: 101,
        node: 'pve-node-01',
        name: 'ct-reverse-proxy',
        type: 'lxc',
        status: 'running',
        cpu_pct: 4.2,
        cpus: 2,
        mem_used_bytes: Math.round(0.42 * GB),
        mem_total_bytes: 2 * GB,
        mem_pct: 21.0,
        disk_used_bytes: Math.round(4.2 * GB),
        disk_total_bytes: 16 * GB,
        uptime_seconds: 1842300,
        uptime_human: '21j 7h',
        tags: ['network', 'prod'],
        is_self: false,
      },
      {
        vmid: 102,
        node: 'pve-node-01',
        name: 'ct-media-server',
        type: 'lxc',
        status: 'running',
        cpu_pct: 31.4,
        cpus: 8,
        mem_used_bytes: Math.round(6.8 * GB),
        mem_total_bytes: 16 * GB,
        mem_pct: 42.5,
        disk_used_bytes: 28 * GB,
        disk_total_bytes: 64 * GB,
        uptime_seconds: 914520,
        uptime_human: '10j 14h',
        tags: ['media', 'gpu'],
        is_self: false,
      },
      {
        vmid: 103,
        node: 'pve-node-02',
        name: 'vm-docker-host',
        type: 'qemu',
        status: 'running',
        cpu_pct: 18.6,
        cpus: 6,
        mem_used_bytes: Math.round(11.2 * GB),
        mem_total_bytes: 16 * GB,
        mem_pct: 70.0,
        disk_used_bytes: 54 * GB,
        disk_total_bytes: 120 * GB,
        uptime_seconds: 1408120,
        uptime_human: '16j 7h',
        tags: ['docker', 'prod'],
        is_self: false,
      },
      {
        vmid: 104,
        node: 'pve-node-02',
        name: 'ct-backup-node',
        type: 'lxc',
        status: 'stopped',
        cpu_pct: 0,
        cpus: 4,
        mem_used_bytes: 0,
        mem_total_bytes: 4 * GB,
        mem_pct: 0,
        disk_used_bytes: 14 * GB,
        disk_total_bytes: 40 * GB,
        uptime_seconds: 0,
        uptime_human: 'Arrêté',
        tags: ['backup'],
        is_self: false,
      },
      {
        vmid: 105,
        node: 'pve-node-02',
        name: 'ct-observability',
        type: 'lxc',
        status: 'running',
        cpu_pct: 6.4,
        cpus: 2,
        mem_used_bytes: Math.round(1.4 * GB),
        mem_total_bytes: 4 * GB,
        mem_pct: 35.0,
        disk_used_bytes: Math.round(6.2 * GB),
        disk_total_bytes: 24 * GB,
        uptime_seconds: 1123200,
        uptime_human: '13j 0h',
        tags: ['metrics', 'prometheus'],
        is_self: false,
      },
      {
        vmid: 116,
        node: 'pve-node-01',
        name: 'pve-panel',
        type: 'lxc',
        status: 'running',
        cpu_pct: 1.8,
        cpus: 2,
        mem_used_bytes: Math.round(0.35 * GB),
        mem_total_bytes: 2 * GB,
        mem_pct: 17.5,
        disk_used_bytes: Math.round(2.4 * GB),
        disk_total_bytes: 8 * GB,
        uptime_seconds: 604800,
        uptime_human: '7j 0h',
        tags: ['panel', 'tailscale'],
        is_self: true,
      },
    ],
    pveTasks: [
      {
        upid: 'UPID:pve-node-01:demo-vzdump-102',
        type: 'vzdump',
        vmid: '102',
        user: 'root@pam',
        status: 'OK',
        starttime: nowSec - 3200,
        endtime: nowSec - 2810,
        duration_sec: 390,
      },
      {
        upid: 'UPID:pve-node-01:demo-aptupdate',
        type: 'aptupdate',
        vmid: '',
        user: 'root@pam',
        status: 'OK',
        starttime: nowSec - 14400,
        endtime: nowSec - 14350,
        duration_sec: 50,
      },
      {
        upid: 'UPID:pve-node-01:demo-vzstart-101',
        type: 'vzstart',
        vmid: '101',
        user: 'root@pam',
        status: 'OK',
        starttime: nowSec - 86400,
        endtime: nowSec - 86392,
        duration_sec: 8,
      },
    ],
    seerrRequests: [
      {
        id: 401,
        status: 1,
        media_type: 'movie',
        title: 'Dune : Deuxième Partie (2024)',
        requested_by: 'Alex',
        created_at: new Date(Date.now() - 25 * 60_000).toISOString(),
        media_status: 2,
      },
      {
        id: 402,
        status: 2,
        media_type: 'tv',
        title: 'Severance - Saison 2',
        requested_by: 'Camille',
        created_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
        media_status: 4,
      },
    ],
    qbitAltSpeed: false,
    qbitTorrents: [
      {
        hash: 'demo-hash-ubuntu-2404',
        name: 'ubuntu-24.04.2-live-server-amd64.iso',
        state: 'downloading',
        progress_pct: 74.2,
        dlspeed: 24_800_000,
        upspeed: 3_100_000,
        size: Math.round(2.9 * GB),
        eta: 32,
      },
      {
        hash: 'demo-hash-debian-12',
        name: 'debian-12.9.0-amd64-netinst.iso',
        state: 'uploading',
        progress_pct: 100,
        dlspeed: 0,
        upspeed: 5_400_000,
        size: Math.round(0.68 * GB),
        eta: 8640000,
      },
    ],
    users: [
      {
        jellyfin_id: 'demo-admin-01',
        name: 'Admin Démo',
        is_admin: true,
        is_protected: true,
        is_disabled: false,
        enable_all_folders: true,
        enabled_folders: [],
        enable_downloading: true,
        max_active_sessions: 0,
        last_activity: new Date(Date.now() - 120_000).toISOString(),
        in_jellyseerr: true,
        jellyseerr_id: 1,
        request_count: 14,
        auto_approve: true,
      },
      {
        jellyfin_id: 'demo-guest-02',
        name: 'Alex',
        is_admin: false,
        is_protected: false,
        is_disabled: false,
        enable_all_folders: false,
        enabled_folders: ['lib-movies', 'lib-series'],
        enable_downloading: true,
        max_active_sessions: 2,
        last_activity: new Date(Date.now() - 3 * 3600_000).toISOString(),
        in_jellyseerr: true,
        jellyseerr_id: 2,
        request_count: 6,
        auto_approve: true,
      },
      {
        jellyfin_id: 'demo-guest-03',
        name: 'Camille',
        is_admin: false,
        is_protected: false,
        is_disabled: false,
        enable_all_folders: true,
        enabled_folders: [],
        enable_downloading: false,
        max_active_sessions: 2,
        last_activity: new Date(Date.now() - 26 * 3600_000).toISOString(),
        in_jellyseerr: false,
        jellyseerr_id: null,
        request_count: 0,
        auto_approve: false,
      },
    ],
    setupConfigured: true,
    setupEnv: {
      dev_auth_bypass: false,
      allowed_tailscale_users: 'user@example.com',
      protected_owner_username: 'admin',
      pve_host: 'https://192.168.1.10:8006',
      pve_node: 'pve-node-01',
      pve_token_id: 'root@pam!pve-panel',
      pve_token_secret_set: true,
      pve_verify_ssl: false,
      panel_self_vmid: 116,
      jellyfin_url: 'http://192.168.1.26:8096',
      jellyfin_api_key_set: true,
      jellyseerr_url: 'http://192.168.1.31:5055',
      jellyseerr_api_key_set: true,
      plex_url: 'http://192.168.1.30:32400',
      plex_token_set: false,
      radarr_url: 'http://192.168.1.27:7878',
      radarr_api_key_set: true,
      sonarr_url: 'http://192.168.1.28:8989',
      sonarr_api_key_set: true,
      prowlarr_url: 'http://192.168.1.29:9696',
      prowlarr_api_key_set: true,
      qbit_url: 'http://192.168.1.32:8090',
      qbit_username: 'admin',
      qbit_password_set: true,
    },
    categories: [
      {
        name: 'Médias & Streaming',
        services: [
          {
            id: 'jellyfin',
            name: 'Jellyfin',
            description: 'Serveur multimédia 4K HDR & transcodage matériel',
            url: 'https://panel.example.ts.net',
            ping_url: 'http://192.168.1.26:8096/health',
            icon: 'Tv',
            widget: 'jellyfin',
          },
          {
            id: 'jellyseerr',
            name: 'Jellyseerr',
            description: 'Portail de demandes de films et séries',
            url: 'https://panel.example.ts.net',
            ping_url: 'http://192.168.1.31:5055',
            icon: 'Sparkles',
          },
        ],
      },
      {
        name: 'Téléchargements & Automation',
        services: [
          {
            id: 'radarr',
            name: 'Radarr',
            description: 'Gestion automatisée de la vidéothèque Films',
            url: 'https://panel.example.ts.net',
            ping_url: 'http://192.168.1.27:7878/ping',
            icon: 'Film',
            widget: 'radarr',
          },
          {
            id: 'sonarr',
            name: 'Sonarr',
            description: 'Suivi et téléchargement des séries TV',
            url: 'https://panel.example.ts.net',
            ping_url: 'http://192.168.1.28:8989/ping',
            icon: 'Clapperboard',
            widget: 'sonarr',
          },
          {
            id: 'prowlarr',
            name: 'Prowlarr',
            description: 'Gestionnaire centralisé d’indexeurs',
            url: 'https://panel.example.ts.net',
            ping_url: 'http://192.168.1.29:9696/ping',
            icon: 'Search',
            widget: 'prowlarr',
          },
          {
            id: 'qbittorrent',
            name: 'qBittorrent',
            description: 'Client BitTorrent haute vitesse',
            url: 'https://panel.example.ts.net',
            ping_url: 'http://192.168.1.32:8090',
            icon: 'Download',
            widget: 'qbittorrent',
          },
        ],
      },
      {
        name: 'Infrastructure & Sécurité',
        services: [
          {
            id: 'proxmox',
            name: 'Proxmox VE',
            description: 'Hyperviseur principal KVM / LXC',
            url: 'https://panel.example.ts.net',
            ping_url: 'https://192.168.1.10:8006',
            icon: 'Server',
          },
          {
            id: 'vaultwarden',
            name: 'Vaultwarden',
            description: 'Coffre-fort de mots de passe chiffré',
            url: 'https://panel.example.ts.net',
            icon: 'Shield',
          },
        ],
      },
    ],
    customServices: [
      {
        id: 'adguard-home',
        name: 'AdGuard Home DNS',
        description: 'Filtrage DNS réseau & statistiques requêtes JSON',
        category: 'Infrastructure & Sécurité',
        icon: 'Shield',
        protocol: 'json_metrics',
        host: '192.168.1.5',
        port: 3000,
        url: 'http://192.168.1.5:3000',
        health_url: 'http://192.168.1.5:3000/control/stats',
        internal_url: 'http://192.168.1.5:3000',
        auth_type: 'basic',
        auth_token: '********',
        auth_token_set: true,
        auth_header_name: '',
        json_metric_path: 'num_dns_queries, num_blocked_filtering, avg_processing_time',
        expected_status: 200,
        refresh_interval_seconds: 30,
        order: 0,
        enabled: true,
        verify_ssl: false,
        webhook_ttl_seconds: 300,
        alert_policy: { enabled: true, consecutive_failures: 2, cooldown_seconds: 300 },
        is_custom: true,
        online: true,
        status: 'up',
        latency_ms: 8,
        status_code: 200,
        message: 'Connecteur json_metrics opérationnel',
        metrics: {
          num_dns_queries: 48210,
          num_blocked_filtering: '18.4%',
          avg_processing_time: '4 ms',
        },
        consecutive_failures: 0,
        last_check_at: twoMinAgo,
        last_transition_at: oneHourAgo,
        last_alert_at: null,
        muted_until: null,
        last_error: null,
      },
      {
        id: 'postgres-homelab',
        name: 'PostgreSQL Cluster',
        description: 'Sonde TCP port 5432 base de données applicative',
        category: 'Infrastructure & Sécurité',
        icon: 'Database',
        protocol: 'tcp_port',
        host: '192.168.1.20',
        port: 5432,
        url: '',
        health_url: '',
        internal_url: '',
        auth_type: 'none',
        auth_token: '',
        auth_token_set: false,
        auth_header_name: '',
        json_metric_path: '',
        expected_status: 200,
        refresh_interval_seconds: 20,
        order: 1,
        enabled: true,
        verify_ssl: false,
        webhook_ttl_seconds: 300,
        alert_policy: { enabled: true, consecutive_failures: 2, cooldown_seconds: 300 },
        is_custom: true,
        online: true,
        status: 'up',
        latency_ms: 2,
        status_code: null,
        message: 'Socket TCP 192.168.1.20:5432 ouvert',
        metrics: { host: '192.168.1.20', port: 5432 },
        consecutive_failures: 0,
        last_check_at: twoMinAgo,
        last_transition_at: oneHourAgo,
        last_alert_at: null,
        muted_until: null,
        last_error: null,
      },
      {
        id: 'nas-backup-agent',
        name: 'Agent Backup Offsite',
        description: 'Heartbeat push webhook nightly Restic / Borg',
        category: 'Services Personnalisés',
        icon: 'Activity',
        protocol: 'webhook_ingest',
        host: '',
        port: null,
        url: '',
        health_url: '',
        internal_url: '',
        auth_type: 'bearer',
        auth_token: '********',
        auth_token_set: true,
        auth_header_name: 'X-Webhook-Token',
        json_metric_path: '',
        expected_status: 200,
        refresh_interval_seconds: 60,
        order: 2,
        enabled: true,
        verify_ssl: false,
        webhook_ttl_seconds: 600,
        alert_policy: { enabled: true, consecutive_failures: 1, cooldown_seconds: 600 },
        is_custom: true,
        online: false,
        status: 'down',
        latency_ms: null,
        status_code: null,
        message: 'TTL heartbeat webhook expiré (> 600s)',
        metrics: { last_snapshot: '2026-11-16 03:00', repo_size_gb: 842 },
        consecutive_failures: 2,
        last_check_at: twoMinAgo,
        last_transition_at: twelveMinAgo,
        last_alert_at: twelveMinAgo,
        muted_until: null,
        last_error: 'TTL heartbeat webhook expiré (> 600s)',
      },
    ],
    incidents: [
      {
        id: 'inc-demo-002',
        service_id: 'nas-backup-agent',
        service_name: 'Agent Backup Offsite',
        severity: 'critical',
        title: 'Agent Backup Offsite hors ligne',
        message: 'TTL heartbeat webhook expiré (> 600s) — dernier signal reçu à 03:00.',
        started_at: twelveMinAgo,
        resolved_at: null,
        acknowledged: false,
        acknowledged_at: null,
      },
      {
        id: 'inc-demo-001',
        service_id: 'adguard-home',
        service_name: 'AdGuard Home DNS',
        severity: 'warning',
        title: 'Latence DNS élevée (> 250 ms)',
        message: 'Pic temporaire lors de la mise à jour des listes de blocage.',
        started_at: oneHourAgo,
        resolved_at: twelveMinAgo,
        acknowledged: true,
        acknowledged_at: oneHourAgo,
      },
    ],
    serviceStates: [
      {
        service_id: 'adguard-home',
        service_name: 'AdGuard Home DNS',
        current_status: 'up',
        consecutive_failures: 0,
        last_check_at: twoMinAgo,
        last_transition_at: oneHourAgo,
        last_alert_at: oneHourAgo,
        muted_until: null,
        last_error: null,
        last_latency_ms: 8,
      },
      {
        service_id: 'postgres-homelab',
        service_name: 'PostgreSQL Cluster',
        current_status: 'up',
        consecutive_failures: 0,
        last_check_at: twoMinAgo,
        last_transition_at: oneHourAgo,
        last_alert_at: null,
        muted_until: null,
        last_error: null,
        last_latency_ms: 2,
      },
      {
        service_id: 'nas-backup-agent',
        service_name: 'Agent Backup Offsite',
        current_status: 'down',
        consecutive_failures: 2,
        last_check_at: twoMinAgo,
        last_transition_at: twelveMinAgo,
        last_alert_at: twelveMinAgo,
        muted_until: null,
        last_error: 'TTL heartbeat webhook expiré (> 600s)',
        last_latency_ms: null,
      },
    ],
    apns: {
      enabled: true,
      team_id: 'DEMO123456',
      key_id: 'KEY9876543',
      bundle_id: 'com.example.pvecenter',
      private_key_path: '/app/config/apns_key.p8',
      private_key_exists: true,
      use_sandbox: false,
      configured: true,
      registered_devices_count: 2,
      devices: [
        {
          device_token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00',
          platform: 'ios',
          device_name: 'iPhone 16 Pro',
          app_version: '1.2.0',
          environment: 'production',
          updated_at: twoMinAgo,
        },
        {
          device_token: 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100',
          platform: 'macos',
          device_name: 'MacBook Pro M4',
          app_version: '1.2.0',
          environment: 'production',
          updated_at: oneHourAgo,
        },
      ],
    },
    webhooks: [
      {
        id: 'wh-discord-demo',
        name: 'Discord #homelab-alerts',
        type: 'discord',
        enabled: true,
        url: 'https://discord.com/api/webhooks/000000000000000000/demo-webhook-token',
        bot_token: '',
        bot_token_set: false,
        chat_id: '',
        headers: {},
        has_secret_headers: false,
        notify_on_down: true,
        notify_on_recovery: true,
        include_details: true,
      },
      {
        id: 'wh-ntfy-demo',
        name: 'ntfy.sh Homelab',
        type: 'generic',
        enabled: true,
        url: 'https://ntfy.sh/pve-center-demo-alerts',
        bot_token: '',
        bot_token_set: false,
        chat_id: '',
        headers: { Authorization: '********', 'X-Priority': 'high' },
        has_secret_headers: true,
        notify_on_down: true,
        notify_on_recovery: true,
        include_details: true,
      },
    ],
    storageMounts: [
      {
        mount: '/mnt/disk1',
        subpath: 'disk1',
        wwn: 'wwn-0x5000demo00000001',
        label: 'Disque 1 • 16 To',
      },
      {
        mount: '/mnt/disk2',
        subpath: 'disk2',
        wwn: 'wwn-0x5000demo00000002',
        label: 'Disque 2 • 16 To',
      },
      {
        mount: '/mnt/disk3',
        subpath: 'disk3',
        wwn: 'wwn-0x5000demo00000003',
        label: 'Cache NVMe • 2 To',
      },
    ],
    updatesTargets: [
      {
        id: 'panel:server',
        category: 'pve_center',
        kind: 'panel_server',
        name: 'Serveur PVE Command Center',
        subtitle: 'Repo /opt/pve-panel • conteneur LXC #116',
        node: 'pve-node-01',
        vmid: 116,
        status: 'online',
        current_version: 'v1.0.0',
        latest_version: 'v1.1.0',
        update_available: true,
        pending_count: 1,
        packages_preview: ['pve-panel -> v1.1.0'],
        can_execute: true,
        requires_ssh: true,
        release_url: 'https://github.com/PVE-Center/pve-panel/releases',
        last_checked_at: twoMinAgo,
      },
      {
        id: 'client:desktop',
        category: 'pve_center',
        kind: 'client_app',
        name: 'Client Desktop (Windows / Linux)',
        subtitle: 'Tauri v2 auto-updater (.exe / .msi / .AppImage / .deb)',
        node: null,
        vmid: null,
        status: 'available',
        current_version: 'v1.0.0',
        latest_version: 'v1.1.0',
        update_available: true,
        pending_count: null,
        packages_preview: ['PVE.Center-setup.exe', 'pve-center_amd64.AppImage'],
        can_execute: false,
        requires_ssh: false,
        release_url: 'https://github.com/PVE-Center/pve-center-clients/releases',
        last_checked_at: twoMinAgo,
      },
      {
        id: 'client:android',
        category: 'pve_center',
        kind: 'client_app',
        name: 'Application Android',
        subtitle: 'Capacitor 8 APK (GitHub Releases)',
        node: null,
        vmid: null,
        status: 'available',
        current_version: 'v1.0.0',
        latest_version: 'v1.1.0',
        update_available: true,
        pending_count: null,
        packages_preview: ['pve-center-android.apk'],
        can_execute: false,
        requires_ssh: false,
        release_url: 'https://github.com/PVE-Center/pve-center-clients/releases',
        last_checked_at: twoMinAgo,
      },
      {
        id: 'client:apple',
        category: 'pve_center',
        kind: 'client_app',
        name: 'Applications Apple (iOS / macOS / tvOS)',
        subtitle: 'Swift 6 natif (Xcode / TestFlight)',
        node: null,
        vmid: null,
        status: 'available',
        current_version: 'v1.0.0',
        latest_version: 'v1.1.0',
        update_available: true,
        pending_count: null,
        packages_preview: ['PVECenter.app (macOS / iOS / tvOS)'],
        can_execute: false,
        requires_ssh: false,
        release_url: 'https://github.com/PVE-Center/pve-center-apple/releases',
        last_checked_at: twoMinAgo,
      },
      {
        id: 'proxmox:pve-node-01',
        category: 'proxmox',
        kind: 'pve_node',
        name: 'Nœud Proxmox VE : pve-node-01',
        subtitle: 'APT système & hyperviseur Proxmox',
        node: 'pve-node-01',
        vmid: null,
        status: 'online',
        current_version: 'APT',
        latest_version: '3 paquet(s)',
        update_available: true,
        pending_count: 3,
        packages_preview: [
          'pve-manager (8.3.1 -> 8.3.2)',
          'proxmox-ve (8.3.0 -> 8.3.1)',
          'libpve-storage-perl (8.3.1 -> 8.3.3)',
        ],
        can_execute: true,
        requires_ssh: true,
        release_url: null,
        last_checked_at: twoMinAgo,
      },
      {
        id: 'lxc:102',
        category: 'containers_vms',
        kind: 'lxc',
        name: 'ct-media-server (#102)',
        subtitle: 'LXC sur pve-node-01 • running',
        node: 'pve-node-01',
        vmid: 102,
        status: 'running',
        current_version: 'OS invité',
        latest_version: '5 paquet(s)',
        update_available: true,
        pending_count: 5,
        packages_preview: [],
        can_execute: true,
        requires_ssh: true,
        release_url: null,
        last_checked_at: twoMinAgo,
      },
      {
        id: 'qemu:103',
        category: 'containers_vms',
        kind: 'qemu',
        name: 'vm-docker-host (#103)',
        subtitle: 'QEMU sur pve-node-01 • running',
        node: 'pve-node-01',
        vmid: 103,
        status: 'running',
        current_version: 'OS invité',
        latest_version: 'Prêt pour QEMU Guest Agent',
        update_available: true,
        pending_count: 4,
        packages_preview: [],
        can_execute: true,
        requires_ssh: false,
        release_url: null,
        last_checked_at: twoMinAgo,
      },
      {
        id: 'docker:media-stack',
        category: 'docker',
        kind: 'docker_compose',
        name: 'Stack Docker : media-stack',
        subtitle: 'LXC 102 (pve-node-01) • /opt/stacks/media',
        scope: 'lxc',
        node: 'pve-node-01',
        vmid: 102,
        compose_dir: '/opt/stacks/media',
        status: 'running',
        current_version: '4 conteneur(s)',
        latest_version: 'Pull / Recreate',
        update_available: true,
        pending_count: 4,
        packages_preview: [
          'jellyfin (jellyfin/jellyfin:latest)',
          'radarr (lscr.io/linuxserver/radarr:latest)',
          'sonarr (lscr.io/linuxserver/sonarr:latest)',
          'prowlarr (lscr.io/linuxserver/prowlarr:latest)',
        ],
        can_execute: true,
        requires_ssh: true,
        release_url: null,
        last_checked_at: twoMinAgo,
      },
    ],
    activeUpdateJob: null,
    recentUpdateJobs: [],
    updatesSshConfigured: true,
    updatesLastCheckedAt: twoMinAgo,
    yamlOverride: null,
  };
}

let demoState: DemoState = createInitialDemoState();

function buildDemoSummary(): ConfigParsedSummary {
  return {
    version: 1,
    server_id: demoState.serverId,
    server_name: demoState.serverName,
    listen_port: 8000,
    public_url: demoState.publicUrl,
    proxmox_host: demoState.setupEnv.pve_host,
    proxmox_node: demoState.setupEnv.pve_node,
    categories_count: demoState.categories.length,
    custom_services_count: demoState.customServices.length,
    webhooks_count: demoState.webhooks.length,
    api_tokens_count: demoState.apiTokens.length,
    alerts_enabled: true,
    apns_enabled: demoState.apns.enabled,
  };
}

function buildDemoYaml(): string {
  if (demoState.yamlOverride) return demoState.yamlOverride;
  const lines: string[] = [
    'version: 1',
    'server:',
    `  id: "${demoState.serverId}"`,
    `  name: "${demoState.serverName}"`,
    '  listen_host: "0.0.0.0"',
    '  listen_port: 8000',
    `  public_url: "${demoState.publicUrl}"`,
    `  mdns_enabled: ${demoState.mdnsEnabled}`,
    '  mdns_service_type: "_pvecenter._tcp.local."',
    'security:',
    `  tailscale_sso_enabled: ${demoState.tailscaleSsoEnabled}`,
    `  protected_owner_username: "${demoState.setupEnv.protected_owner_username}"`,
    `  dev_auth_bypass: ${demoState.setupEnv.dev_auth_bypass}`,
    '  allowed_tailscale_users:',
    `    - "${demoState.setupEnv.allowed_tailscale_users || 'user@example.com'}"`,
    'proxmox:',
    `  host: "${demoState.setupEnv.pve_host}"`,
    `  default_node: "${demoState.setupEnv.pve_node}"`,
    `  token_id: "${demoState.setupEnv.pve_token_id}"`,
    `  token_secret: "${demoState.setupEnv.pve_token_secret_set ? '********' : ''}"`,
    `  verify_ssl: ${demoState.setupEnv.pve_verify_ssl}`,
    `  panel_self_vmid: ${demoState.setupEnv.panel_self_vmid}`,
    'alerts:',
    '  enabled: true',
    '  check_interval_seconds: 15',
    '  default_consecutive_failures: 2',
    '  default_cooldown_seconds: 300',
    'notifications:',
    '  apns:',
    `    enabled: ${demoState.apns.enabled}`,
    `    team_id: "${demoState.apns.team_id}"`,
    `    key_id: "${demoState.apns.key_id}"`,
    `    bundle_id: "${demoState.apns.bundle_id}"`,
    `    private_key_path: "${demoState.apns.private_key_path}"`,
    `    use_sandbox: ${demoState.apns.use_sandbox}`,
    '  webhooks:',
  ];

  for (const wh of demoState.webhooks) {
    lines.push(
      `    - id: "${wh.id}"`,
      `      name: "${wh.name}"`,
      `      type: "${wh.type}"`,
      `      enabled: ${wh.enabled}`,
      `      url: "${wh.url}"`
    );
  }

  lines.push('custom_services:');
  for (const svc of demoState.customServices) {
    lines.push(
      `  - id: "${svc.id}"`,
      `    name: "${svc.name}"`,
      `    category: "${svc.category}"`,
      `    protocol: "${svc.protocol}"`,
      `    enabled: ${svc.enabled}`,
      `    order: ${svc.order}`
    );
  }

  return `${lines.join('\n')}\n`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildDemoUpdatesOverview(): UpdatesOverviewResponse {
  const targets = demoState.updatesTargets;
  return {
    enabled: true,
    ssh_configured: demoState.updatesSshConfigured,
    ssh_message: demoState.updatesSshConfigured
      ? 'Connecté en SSH (root@192.168.1.10 • Mode Démo).'
      : 'SSH Proxmox non autorisé.',
    ssh_host: '192.168.1.10',
    last_checked_at: demoState.updatesLastCheckedAt,
    summary: {
      total_targets: targets.length,
      updates_available: targets.filter((t) => t.update_available).length,
      pending_packages: targets.reduce(
        (sum, t) => sum + (t.update_available && typeof t.pending_count === 'number' ? t.pending_count : 0),
        0
      ),
      executable_targets: targets.filter((t) => t.can_execute).length,
    },
    targets,
    active_job: demoState.activeUpdateJob,
    recent_jobs: demoState.recentUpdateJobs,
  };
}

function slugifyDemoId(name: string, existingIds: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'service';
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function handleDemoRequest(apiPath: string, init?: RequestInit): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 60));

  const url = new URL(apiPath, 'https://demo.local');
  const path = url.pathname;
  const method = (init?.method || 'GET').toUpperCase();
  let body: Record<string, unknown> = {};
  if (typeof init?.body === 'string' && init.body.trim()) {
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  if (path === '/api/health' && method === 'GET') {
    return jsonResponse({
      status: 'ok',
      version: '1.0.0',
      server_id: demoState.serverId,
      server_name: demoState.serverName,
      is_configured: demoState.setupConfigured,
      config_hash: 'demo7f2e91c4',
    });
  }

  if (path === '/api/me' && method === 'GET') {
    const me: AuthUser = {
      login: 'demo@pve-center.app',
      name: 'Mode Démo App Store',
      profile_pic: '',
      auth_mode: 'demo',
      role: 'admin',
    };
    return jsonResponse(me);
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const pin = String(body.pin || '').trim();
    const tok = String(body.api_token || body.token || '').trim();
    if (pin.length >= 4 || tok.startsWith('pve_')) {
      const expiresAt = new Date(Date.now() + 86400 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const resp: AuthLoginResponse = {
        ok: true,
        access_token: 'demo_session_jwt_token',
        token_type: 'bearer',
        expires_in: 86400,
        expires_at: expiresAt,
        user: {
          login: 'demo@pve-center.app',
          name: 'Administrateur Démo',
          profile_pic: '',
          auth_mode: 'session',
          role: 'admin',
        },
      };
      return jsonResponse(resp);
    }
    return jsonResponse({ detail: 'PIN ou jeton API invalide.' }, 401);
  }

  if (path === '/api/auth/tokens' && method === 'GET') {
    return jsonResponse({ tokens: demoState.apiTokens });
  }

  if (path === '/api/auth/tokens' && method === 'POST') {
    const name = String(body.name || 'Jeton API').trim();
    const role = String(body.role || 'admin');
    const info: ApiTokenInfo = {
      id: `tok-${Date.now()}`,
      name,
      role,
      created_at: nowIso(),
    };
    demoState.apiTokens.push(info);
    return jsonResponse({
      ok: true,
      token: `pve_demo_${Math.random().toString(36).slice(2, 18)}`,
      token_info: info,
    });
  }

  const delTokMatch = path.match(/^\/api\/auth\/tokens\/([^/]+)$/);
  if (delTokMatch && method === 'DELETE') {
    const id = delTokMatch[1];
    demoState.apiTokens = demoState.apiTokens.filter((t) => t.id !== id);
    return jsonResponse({ ok: true, deleted_id: id });
  }

  if (path === '/api/auth/pin' && method === 'PUT') {
    demoState.pinConfigured = true;
    return jsonResponse({ ok: true, pin_configured: true });
  }

  if (path === '/api/onboarding/status' && method === 'GET') {
    const resp: OnboardingStatusResponse = {
      is_configured: demoState.setupConfigured,
      needs_onboarding: !demoState.setupConfigured,
      config_exists: true,
      is_synthesized: false,
      server_id: demoState.serverId,
      server_name: demoState.serverName,
      public_url: demoState.publicUrl,
      tailscale_sso_enabled: demoState.tailscaleSsoEnabled,
      pin_configured: demoState.pinConfigured,
      api_tokens_count: demoState.apiTokens.length,
      auth_methods: [
        ...(demoState.tailscaleSsoEnabled ? ['tailscale_sso'] : []),
        'api_token',
        ...(demoState.pinConfigured ? ['pin'] : []),
      ],
    };
    return jsonResponse(resp);
  }

  if (path === '/api/onboarding/init' && method === 'POST') {
    if (typeof body.server_name === 'string' && body.server_name.trim()) {
      demoState.serverName = body.server_name.trim();
    }
    if (typeof body.public_url === 'string') {
      demoState.publicUrl = body.public_url.trim() || demoState.publicUrl;
    }
    if (typeof body.mdns_enabled === 'boolean') {
      demoState.mdnsEnabled = body.mdns_enabled;
    }
    if (typeof body.tailscale_sso_enabled === 'boolean') {
      demoState.tailscaleSsoEnabled = body.tailscale_sso_enabled;
    }
    if (typeof body.admin_pin === 'string' && body.admin_pin.trim().length >= 4) {
      demoState.pinConfigured = true;
    }
    if (Array.isArray(body.custom_services)) {
      const existingIds = new Set(demoState.customServices.map((s) => s.id));
      for (const item of body.custom_services as Array<Record<string, unknown>>) {
        const name = String(item.name || '').trim();
        if (!name) continue;
        const id = String(item.id || '').trim() || slugifyDemoId(name, existingIds);
        if (existingIds.has(id)) continue;
        existingIds.add(id);
        demoState.customServices.push({
          id,
          name,
          description: String(item.description || ''),
          category: String(item.category || 'Services'),
          icon: String(item.icon || 'Globe'),
          protocol: (item.protocol as ServiceProtocol) || 'http_rest',
          host: String(item.host || ''),
          port: typeof item.port === 'number' ? item.port : null,
          url: String(item.url || ''),
          health_url: String(item.health_url || ''),
          internal_url: String(item.internal_url || ''),
          auth_type: 'none',
          auth_token: '',
          auth_token_set: false,
          auth_header_name: '',
          json_metric_path: String(item.json_metric_path || ''),
          expected_status: 200,
          refresh_interval_seconds: 30,
          order: demoState.customServices.length,
          enabled: true,
          verify_ssl: false,
          webhook_ttl_seconds: 300,
          alert_policy: { enabled: true, consecutive_failures: 2, cooldown_seconds: 300 },
          is_custom: true,
          online: true,
          status: 'up',
          latency_ms: 9,
          status_code: 200,
          message: 'Service initialisé (Démo)',
          metrics: {},
          consecutive_failures: 0,
          last_check_at: nowIso(),
          last_transition_at: nowIso(),
          last_alert_at: null,
          muted_until: null,
          last_error: null,
        });
      }
    }
    const tokenId = `tok-${Date.now()}`;
    demoState.apiTokens.push({
      id: tokenId,
      name: String(body.token_name || 'Initial Admin Token'),
      role: 'admin',
      created_at: nowIso(),
    });
    demoState.setupConfigured = true;
    demoState.yamlOverride = null;

    const resp: OnboardingInitResponse = {
      ok: true,
      is_configured: true,
      server_id: demoState.serverId,
      server_name: demoState.serverName,
      api_token: `pve_demo_${Math.random().toString(36).slice(2, 22)}`,
      token_id: tokenId,
      config_hash: 'demo8c4e12a9',
      config_path: '/app/config/config.yaml',
    };
    return jsonResponse(resp);
  }

  if (path === '/api/pve/nodes' && method === 'GET') {
    const nodes: ClusterNode[] = demoState.pveNodes.map((n) => ({
      name: n.name,
      status: n.status,
      online: n.online,
      cpu_pct: n.summary.cpu_pct,
      cpus: n.summary.cpu_threads,
      mem_used_bytes: n.summary.mem_used_bytes,
      mem_total_bytes: n.summary.mem_total_bytes,
      mem_pct: n.summary.mem_pct,
      uptime_seconds: n.summary.uptime_seconds,
      uptime_human: n.summary.uptime_human,
    }));
    return jsonResponse({ nodes, default_node: demoState.setupEnv.pve_node });
  }

  if (path === '/api/pve/overview' && method === 'GET') {
    const reqNode = (url.searchParams.get('node') || '').trim();
    const clusterNodes: ClusterNode[] = demoState.pveNodes.map((n) => ({
      name: n.name,
      status: n.status,
      online: n.online,
      cpu_pct: n.summary.cpu_pct,
      cpus: n.summary.cpu_threads,
      mem_used_bytes: n.summary.mem_used_bytes,
      mem_total_bytes: n.summary.mem_total_bytes,
      mem_pct: n.summary.mem_pct,
      uptime_seconds: n.summary.uptime_seconds,
      uptime_human: n.summary.uptime_human,
    }));

    const externalStorage: ExternalStorageOverview = {
      pool: {
        name: 'Pool MergerFS (32 To)',
        mount: '/mnt/pool',
        fstype: 'fuse.mergerfs',
        policy: 'mfs (most free space)',
        drives_count: 3,
        available: true,
        total_bytes: 32 * TB,
        used_bytes: Math.round(19.6 * TB),
        avail_bytes: Math.round(12.4 * TB),
        used_pct: 61.3,
      },
      drives: [
        {
          mount: '/mnt/disk1',
          label: 'Disque 1 • 16 To',
          wwn: 'wwn-0x5000demo00000001',
          devpath: '/dev/sda',
          model: 'Seagate IronWolf Pro 16TB',
          vendor: 'ATA',
          serial: 'DEMO-16TB-01',
          type: 'HDD',
          rpm: '7200 rpm',
          health: 'PASSED',
          size_bytes: 16 * TB,
          total_bytes: 16 * TB,
          used_bytes: Math.round(10.1 * TB),
          avail_bytes: Math.round(5.9 * TB),
          used_pct: 63.1,
        },
        {
          mount: '/mnt/disk2',
          label: 'Disque 2 • 16 To',
          wwn: 'wwn-0x5000demo00000002',
          devpath: '/dev/sdb',
          model: 'Seagate IronWolf Pro 16TB',
          vendor: 'ATA',
          serial: 'DEMO-16TB-02',
          type: 'HDD',
          rpm: '7200 rpm',
          health: 'PASSED',
          size_bytes: 16 * TB,
          total_bytes: 16 * TB,
          used_bytes: Math.round(9.5 * TB),
          avail_bytes: Math.round(6.5 * TB),
          used_pct: 59.4,
        },
        {
          mount: '/mnt/disk3',
          label: 'Cache NVMe • 2 To',
          wwn: 'wwn-0x5000demo00000003',
          devpath: '/dev/nvme0n1',
          model: 'Samsung 990 PRO 2TB',
          vendor: 'NVMe',
          serial: 'DEMO-NVME-01',
          type: 'SSD',
          rpm: 'NVMe',
          health: 'PASSED',
          size_bytes: 2 * TB,
          total_bytes: 2 * TB,
          used_bytes: Math.round(0.84 * TB),
          avail_bytes: Math.round(1.16 * TB),
          used_pct: 42.0,
        },
      ],
      system_ssd: {
        devpath: '/dev/nvme1n1',
        model: 'Enterprise Boot NVMe 512GB',
        serial: 'DEMO-SYS-01',
        health: 'PASSED',
        size_bytes: 512 * GB,
      },
    };

    if (reqNode === '*' || reqNode === 'all') {
      const onlineNodes = demoState.pveNodes.filter((n) => n.online);
      const memUsed = demoState.pveNodes.reduce((sum, n) => sum + n.summary.mem_used_bytes, 0);
      const memTotal =
        demoState.pveNodes.reduce((sum, n) => sum + n.summary.mem_total_bytes, 0) || 1;
      const swapUsed = demoState.pveNodes.reduce((sum, n) => sum + n.summary.swap_used_bytes, 0);
      const swapTotal = demoState.pveNodes.reduce((sum, n) => sum + n.summary.swap_total_bytes, 0);
      const rootUsed = demoState.pveNodes.reduce((sum, n) => sum + n.summary.rootfs_used_bytes, 0);
      const rootTotal = demoState.pveNodes.reduce((sum, n) => sum + n.summary.rootfs_total_bytes, 0);
      const totalThreads = demoState.pveNodes.reduce((sum, n) => sum + n.summary.cpu_threads, 0);
      const avgCpu =
        onlineNodes.length > 0
          ? Math.round(
              (onlineNodes.reduce((sum, n) => sum + n.summary.cpu_pct, 0) / onlineNodes.length) * 10
            ) / 10
          : 0;
      const combinedStorages = demoState.pveNodes.flatMap((n) =>
        n.summary.storages.map((st) => ({
          ...st,
          node: n.name,
          name: `${n.name}:${st.name}`,
        }))
      );
      const resources = [...demoState.resources].sort(
        (a, b) => a.vmid - b.vmid || (a.node || '').localeCompare(b.node || '')
      );
      const running = resources.filter((r) => r.status === 'running').length;
      const baseSummary = (onlineNodes[0] || demoState.pveNodes[0]).summary;

      const clusterOverview: PveOverview = {
        online: onlineNodes.length > 0,
        selected_node: reqNode,
        failover_active: false,
        cluster_nodes: clusterNodes,
        node: {
          name: `Cluster (${demoState.pveNodes.length} nœuds)`,
          cpu_pct: avgCpu,
          cpu_model: baseSummary.cpu_model,
          cpu_threads: totalThreads,
          loadavg: baseSummary.loadavg,
          mem_used_bytes: memUsed,
          mem_total_bytes: memTotal,
          mem_pct: Math.round((memUsed / memTotal) * 1000) / 10,
          swap_used_bytes: swapUsed,
          swap_total_bytes: swapTotal,
          rootfs_used_bytes: rootUsed,
          rootfs_total_bytes: rootTotal,
          uptime_seconds: Math.max(...demoState.pveNodes.map((n) => n.summary.uptime_seconds), 0),
          uptime_human: baseSummary.uptime_human,
          pve_version: baseSummary.pve_version,
          storages: combinedStorages,
        },
        counts: {
          total: resources.length,
          running,
          stopped: resources.length - running,
          lxc: resources.filter((r) => r.type === 'lxc').length,
          qemu: resources.filter((r) => r.type === 'qemu').length,
        },
        resources,
        external_storage: externalStorage,
      };
      return jsonResponse(clusterOverview);
    }

    const targetProfile = reqNode
      ? demoState.pveNodes.find((n) => n.name === reqNode)
      : demoState.pveNodes.find((n) => n.name === demoState.setupEnv.pve_node) ||
        demoState.pveNodes[0];

    if (!targetProfile) {
      const missingOverview: PveOverview = {
        online: false,
        selected_node: reqNode,
        failover_active: false,
        cluster_nodes: clusterNodes,
        node: {
          name: reqNode,
          cpu_pct: 0,
          cpu_model: 'Inconnu',
          cpu_threads: 0,
          loadavg: ['0.00', '0.00', '0.00'],
          mem_used_bytes: 0,
          mem_total_bytes: 1,
          mem_pct: 0,
          swap_used_bytes: 0,
          swap_total_bytes: 0,
          rootfs_used_bytes: 0,
          rootfs_total_bytes: 0,
          uptime_seconds: 0,
          uptime_human: '—',
          pve_version: '',
          storages: [],
        },
        counts: { total: 0, running: 0, stopped: 0, lxc: 0, qemu: 0 },
        resources: [],
        external_storage: externalStorage,
      };
      return jsonResponse(missingOverview);
    }

    const nodeResources = demoState.resources.filter((r) => r.node === targetProfile.name);
    const running = nodeResources.filter((r) => r.status === 'running').length;
    const stopped = nodeResources.length - running;

    const overview: PveOverview = {
      online: targetProfile.online,
      selected_node: targetProfile.name,
      failover_active: false,
      cluster_nodes: clusterNodes,
      node: targetProfile.summary,
      counts: {
        total: nodeResources.length,
        running,
        stopped,
        lxc: nodeResources.filter((r) => r.type === 'lxc').length,
        qemu: nodeResources.filter((r) => r.type === 'qemu').length,
      },
      resources: nodeResources,
      external_storage: externalStorage,
    };
    return jsonResponse(overview);
  }

  const pveMatch = path.match(/^\/api\/pve\/(lxc|qemu)\/(\d+)\/(start|stop|shutdown|reboot)$/);
  if (pveMatch && method === 'POST') {
    const [, type, vmidStr, action] = pveMatch;
    const vmid = Number(vmidStr);
    const reqNode = (url.searchParams.get('node') || '').trim();
    const target = demoState.resources.find(
      (r) => r.vmid === vmid && r.type === type && (!reqNode || r.node === reqNode)
    );
    if (!target) {
      return jsonResponse({ detail: 'Ressource introuvable en mode démo' }, 404);
    }
    if (
      vmid === demoState.setupEnv.panel_self_vmid &&
      (action === 'stop' || action === 'shutdown')
    ) {
      return jsonResponse(
        {
          detail: `Protection activée : impossible d'arrêter le conteneur du panel (${vmid}).`,
        },
        400
      );
    }
    if (action === 'stop' || action === 'shutdown') {
      target.status = 'stopped';
      target.cpu_pct = 0;
      target.mem_used_bytes = 0;
      target.mem_pct = 0;
      target.uptime_seconds = 0;
      target.uptime_human = 'Arrêté';
    } else {
      target.status = 'running';
      target.cpu_pct = 8.4;
      target.mem_used_bytes = Math.round(target.mem_total_bytes * 0.35);
      target.mem_pct = 35.0;
      target.uptime_seconds = 60;
      target.uptime_human = '1m';
    }
    const targetNode = target.node || reqNode || demoState.setupEnv.pve_node || 'pve-node-01';
    const nowSec = Math.floor(Date.now() / 1000);
    demoState.pveTasks.unshift({
      upid: `UPID:${targetNode}:demo-${action}-${vmid}-${Date.now()}`,
      type: `${type === 'lxc' ? 'vz' : 'qm'}${action}`,
      vmid: String(vmid),
      user: 'demo@pve',
      status: 'OK',
      starttime: nowSec,
      endtime: nowSec + 1,
      duration_sec: 1,
    });
    return jsonResponse({ ok: true, node: targetNode, vmid, type, action, upid: 'demo-task-ok' });
  }

  if (path === '/api/services' && method === 'GET') {
    const orderedCustom = [...demoState.customServices].sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name)
    );
    const categories: ServiceCategory[] = demoState.categories.map((cat) => ({
      name: cat.name,
      services: cat.services.map((svc, idx) => ({
        ...svc,
        online: true,
        status: 'up' as ServiceHealthStatus,
        latency_ms: 6 + ((idx * 3) % 11),
        status_code: 200,
      })),
    }));

    const catMap = new Map<string, ServiceCategory>();
    for (const c of categories) catMap.set(c.name.toLowerCase(), c);

    for (const cs of orderedCustom) {
      if (!cs.enabled) continue;
      const catName = cs.category || 'Services';
      const key = catName.toLowerCase();
      let targetCat = catMap.get(key);
      if (!targetCat) {
        targetCat = { name: catName, services: [] };
        categories.push(targetCat);
        catMap.set(key, targetCat);
      }
      targetCat.services.push({ ...cs });
    }

    return jsonResponse({ categories, custom_services: orderedCustom });
  }

  if (path.startsWith('/api/services/items/')) {
    const subPath = path.slice('/api/services/items/'.length);
    const parts = subPath.split('/');
    const itemId = decodeURIComponent(parts[0] || '');
    const action = parts[1] || '';

    let foundCatIdx = -1;
    let foundSvcIdx = -1;
    for (let c = 0; c < demoState.categories.length; c += 1) {
      const idx = demoState.categories[c].services.findIndex((s) => s.id === itemId);
      if (idx >= 0) {
        foundCatIdx = c;
        foundSvcIdx = idx;
        break;
      }
    }

    if (action === 'test' && method === 'POST') {
      const candidateUrl = String(body.ping_url || body.url || '').trim();
      return jsonResponse({
        ok: Boolean(candidateUrl || foundSvcIdx >= 0),
        service_id: itemId,
        online: true,
        status_code: 200,
        latency_ms: 9,
        message: 'Joignable (HTTP 200 • Mode Démo)',
      });
    }

    if (foundCatIdx < 0 || foundSvcIdx < 0) {
      return jsonResponse({ detail: `Service introuvable : ${itemId}` }, 404);
    }

    if (action === 'move' && method === 'POST') {
      const list = demoState.categories[foundCatIdx].services;
      const targetIdx = body.direction === 'up' ? foundSvcIdx - 1 : foundSvcIdx + 1;
      if (targetIdx >= 0 && targetIdx < list.length) {
        const [item] = list.splice(foundSvcIdx, 1);
        list.splice(targetIdx, 0, item);
      }
      return jsonResponse({ ok: true, service_id: itemId });
    }

    if (!action && method === 'PUT') {
      const currentCat = demoState.categories[foundCatIdx];
      const currentSvc = currentCat.services[foundSvcIdx];
      const updatedSvc = {
        ...currentSvc,
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : currentSvc.name,
        description:
          typeof body.description === 'string' ? body.description.trim() : currentSvc.description,
        url: typeof body.url === 'string' ? body.url.trim() : currentSvc.url,
        ping_url: typeof body.ping_url === 'string' ? body.ping_url.trim() : currentSvc.ping_url,
        icon: typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim() : currentSvc.icon,
        widget:
          typeof body.widget === 'string'
            ? body.widget.trim() || undefined
            : currentSvc.widget,
      };
      const targetCatName =
        typeof body.category === 'string' && body.category.trim()
          ? body.category.trim()
          : currentCat.name;

      if (targetCatName.toLowerCase() === currentCat.name.toLowerCase()) {
        currentCat.services[foundSvcIdx] = updatedSvc;
      } else {
        currentCat.services.splice(foundSvcIdx, 1);
        if (currentCat.services.length === 0) {
          demoState.categories.splice(foundCatIdx, 1);
        }
        let dest = demoState.categories.find(
          (c) => c.name.toLowerCase() === targetCatName.toLowerCase()
        );
        if (!dest) {
          dest = { name: targetCatName, services: [] };
          demoState.categories.push(dest);
        }
        dest.services.push(updatedSvc);
      }
      return jsonResponse({ ok: true, category: targetCatName, service: { ...updatedSvc, online: true, latency_ms: 8, status_code: 200 } });
    }

    if (!action && method === 'DELETE') {
      demoState.categories[foundCatIdx].services.splice(foundSvcIdx, 1);
      if (demoState.categories[foundCatIdx].services.length === 0) {
        demoState.categories.splice(foundCatIdx, 1);
      }
      return jsonResponse({ ok: true, deleted_id: itemId });
    }
  }

  if (path === '/api/custom-services' && method === 'GET') {
    const ordered = [...demoState.customServices].sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name)
    );
    return jsonResponse({ services: ordered, count: ordered.length });
  }

  if (path === '/api/custom-services' && method === 'POST') {
    const name = String(body.name || '').trim();
    if (!name) return jsonResponse({ detail: 'Nom requis' }, 422);
    const existingIds = new Set(demoState.customServices.map((s) => s.id));
    const requestedId = String(body.id || '').trim();
    if (requestedId && existingIds.has(requestedId)) {
      return jsonResponse({ detail: `Un service avec l'id '${requestedId}' existe déjà.` }, 409);
    }
    const id = requestedId || slugifyDemoId(name, existingIds);
    const nextOrder =
      typeof body.order === 'number'
        ? body.order
        : Math.max(-1, ...demoState.customServices.map((s) => s.order)) + 1;
    const protocol = (body.protocol as ServiceProtocol) || 'http_rest';
    const rawToken = String(body.auth_token || '').trim();
    const hasToken = Boolean(rawToken && rawToken !== '********');

    const created: CustomServiceItem = {
      id,
      name,
      description: String(body.description || ''),
      category: String(body.category || 'Services'),
      icon: String(body.icon || 'Globe'),
      protocol,
      host: String(body.host || ''),
      port: typeof body.port === 'number' ? body.port : null,
      url: String(body.url || ''),
      health_url: String(body.health_url || ''),
      internal_url: String(body.internal_url || ''),
      auth_type: (body.auth_type as CustomServiceItem['auth_type']) || 'none',
      auth_token: hasToken ? '********' : '',
      auth_token_set: hasToken,
      auth_header_name: String(body.auth_header_name || ''),
      json_metric_path: String(body.json_metric_path || ''),
      expected_status: typeof body.expected_status === 'number' ? body.expected_status : 200,
      refresh_interval_seconds:
        typeof body.refresh_interval_seconds === 'number' ? body.refresh_interval_seconds : 30,
      order: nextOrder,
      enabled: body.enabled !== false,
      verify_ssl: Boolean(body.verify_ssl),
      webhook_ttl_seconds:
        typeof body.webhook_ttl_seconds === 'number' ? body.webhook_ttl_seconds : 300,
      alert_policy: (body.alert_policy as CustomServiceItem['alert_policy']) || {
        enabled: true,
        consecutive_failures: 2,
        cooldown_seconds: 300,
      },
      is_custom: true,
      online: body.enabled !== false,
      status: body.enabled === false ? 'disabled' : 'up',
      latency_ms: protocol === 'webhook_ingest' ? 0 : 11,
      status_code: protocol === 'http_rest' || protocol === 'json_metrics' ? 200 : null,
      message:
        protocol === 'webhook_ingest'
          ? 'En attente de heartbeat webhook'
          : `Connecteur ${protocol} opérationnel (Démo)`,
      metrics: protocol === 'json_metrics' ? { status: 'healthy', uptime: '99.9%' } : {},
      consecutive_failures: 0,
      last_check_at: nowIso(),
      last_transition_at: nowIso(),
      last_alert_at: null,
      muted_until: null,
      last_error: null,
    };

    demoState.customServices.push(created);
    demoState.serviceStates.push({
      service_id: created.id,
      service_name: created.name,
      current_status: created.status,
      consecutive_failures: 0,
      last_check_at: nowIso(),
      last_transition_at: nowIso(),
      last_alert_at: null,
      muted_until: null,
      last_error: null,
      last_latency_ms: created.latency_ms,
    });
    demoState.yamlOverride = null;
    return jsonResponse({ ok: true, service: created }, 201);
  }

  if (path === '/api/custom-services/reorder' && method === 'POST') {
    const rawIds =
      (Array.isArray(body.service_ids) && body.service_ids) ||
      (Array.isArray(body.ids) && body.ids) ||
      (Array.isArray(body.order) && body.order) ||
      [];
    const ids = rawIds.map((x) => String(x));
    const byId = new Map(demoState.customServices.map((s) => [s.id, s]));
    const reordered: CustomServiceItem[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const item = byId.get(id);
      if (item && !seen.has(id)) {
        seen.add(id);
        reordered.push(item);
      }
    }
    for (const s of demoState.customServices) {
      if (!seen.has(s.id)) reordered.push(s);
    }
    demoState.customServices = reordered.map((s, idx) => ({ ...s, order: idx }));
    demoState.yamlOverride = null;
    return jsonResponse({ ok: true, order: demoState.customServices.map((s) => s.id) });
  }

  const csTestMatch = path.match(/^\/api\/custom-services\/([^/]+)\/test$/);
  if (csTestMatch && method === 'POST') {
    const svcId = csTestMatch[1];
    const saved = demoState.customServices.find((s) => s.id === svcId);
    const protocol = (body.protocol as ServiceProtocol) || saved?.protocol || 'http_rest';
    const host = String(body.host ?? saved?.host ?? '');
    const targetUrl = String(body.health_url ?? body.url ?? saved?.health_url ?? saved?.url ?? '');

    if ((protocol === 'http_rest' || protocol === 'json_metrics') && !targetUrl) {
      const fail: CustomServiceTestResponse = {
        ok: false,
        service_id: svcId,
        protocol,
        status: 'down',
        latency_ms: null,
        http_status: null,
        message: 'URL requise pour tester ce connecteur HTTP/JSON.',
        metrics: {},
      };
      return jsonResponse(fail);
    }

    if ((protocol === 'tcp_port' || protocol === 'icmp_ping') && !host) {
      const fail: CustomServiceTestResponse = {
        ok: false,
        service_id: svcId,
        protocol,
        status: 'down',
        latency_ms: null,
        http_status: null,
        message: 'Hôte / IP requis pour ce connecteur.',
        metrics: {},
      };
      return jsonResponse(fail);
    }

    const demoMetrics: Record<string, string | number | boolean | null> =
      protocol === 'json_metrics'
        ? { queries_today: 14280, blocked_pct: '19.2%', version: 'v0.107.52' }
        : protocol === 'tcp_port'
          ? { host, port: Number(body.port ?? saved?.port ?? 80) }
          : protocol === 'icmp_ping'
            ? { host, rtt_ms: 1.8, packet_loss: '0%' }
            : protocol === 'webhook_ingest'
              ? { ttl_seconds: Number(body.webhook_ttl_seconds ?? 300), state: 'listening' }
              : { endpoint: targetUrl };

    const res: CustomServiceTestResponse = {
      ok: true,
      service_id: svcId,
      protocol,
      status: 'up',
      latency_ms: protocol === 'tcp_port' || protocol === 'icmp_ping' ? 2 : 14,
      http_status: protocol === 'http_rest' || protocol === 'json_metrics' ? 200 : null,
      message: `Test ${protocol} réussi (Mode Démo)`,
      metrics: demoMetrics,
    };
    return jsonResponse(res);
  }

  const csMatch = path.match(/^\/api\/custom-services\/([^/]+)$/);
  if (csMatch && method === 'PUT') {
    const svcId = csMatch[1];
    const idx = demoState.customServices.findIndex((s) => s.id === svcId);
    if (idx === -1) return jsonResponse({ detail: 'Service introuvable' }, 404);
    const current = demoState.customServices[idx];
    const nextToken = typeof body.auth_token === 'string' ? body.auth_token.trim() : '';
    const keepToken = !nextToken || nextToken === '********';
    const updated: CustomServiceItem = {
      ...current,
      name: typeof body.name === 'string' ? body.name : current.name,
      description: typeof body.description === 'string' ? body.description : current.description,
      category: typeof body.category === 'string' ? body.category : current.category,
      icon: typeof body.icon === 'string' ? body.icon : current.icon,
      protocol: (body.protocol as ServiceProtocol) || current.protocol,
      host: typeof body.host === 'string' ? body.host : current.host,
      port: body.port === null ? null : typeof body.port === 'number' ? body.port : current.port,
      url: typeof body.url === 'string' ? body.url : current.url,
      health_url: typeof body.health_url === 'string' ? body.health_url : current.health_url,
      internal_url: typeof body.internal_url === 'string' ? body.internal_url : current.internal_url,
      auth_type: (body.auth_type as CustomServiceItem['auth_type']) || current.auth_type,
      auth_token: keepToken ? current.auth_token : '********',
      auth_token_set: keepToken ? current.auth_token_set : true,
      auth_header_name:
        typeof body.auth_header_name === 'string' ? body.auth_header_name : current.auth_header_name,
      json_metric_path:
        typeof body.json_metric_path === 'string' ? body.json_metric_path : current.json_metric_path,
      expected_status:
        typeof body.expected_status === 'number' ? body.expected_status : current.expected_status,
      refresh_interval_seconds:
        typeof body.refresh_interval_seconds === 'number'
          ? body.refresh_interval_seconds
          : current.refresh_interval_seconds,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
      verify_ssl: typeof body.verify_ssl === 'boolean' ? body.verify_ssl : current.verify_ssl,
      webhook_ttl_seconds:
        typeof body.webhook_ttl_seconds === 'number'
          ? body.webhook_ttl_seconds
          : current.webhook_ttl_seconds,
      alert_policy:
        (body.alert_policy as CustomServiceItem['alert_policy']) || current.alert_policy,
    };
    if (!updated.enabled) {
      updated.online = false;
      updated.status = 'disabled';
      updated.message = 'Service désactivé';
    } else if (current.status === 'disabled') {
      updated.online = true;
      updated.status = 'up';
      updated.message = 'Connecteur opérationnel';
    }
    demoState.customServices[idx] = updated;
    demoState.yamlOverride = null;
    return jsonResponse({ ok: true, service: updated });
  }

  if (csMatch && method === 'DELETE') {
    const svcId = csMatch[1];
    const lenBefore = demoState.customServices.length;
    demoState.customServices = demoState.customServices.filter((s) => s.id !== svcId);
    if (demoState.customServices.length === lenBefore) {
      return jsonResponse({ detail: 'Service introuvable' }, 404);
    }
    demoState.yamlOverride = null;
    return jsonResponse({ ok: true, deleted_id: svcId });
  }

  if (path === '/api/incidents' && method === 'GET') {
    const activeOnly = url.searchParams.get('active_only') === 'true';
    const serviceFilter = url.searchParams.get('service_id');
    const limit = Number(url.searchParams.get('limit') || '50');
    let list = [...demoState.incidents];
    if (activeOnly) list = list.filter((i) => i.resolved_at === null);
    if (serviceFilter) list = list.filter((i) => i.service_id === serviceFilter);
    list = list.slice(0, limit);
    const activeCount = demoState.incidents.filter((i) => i.resolved_at === null).length;
    const resp: IncidentsResponse = {
      incidents: list,
      count: list.length,
      active_count: activeCount,
      service_states: demoState.serviceStates,
    };
    return jsonResponse(resp);
  }

  const ackMatch = path.match(/^\/api\/incidents\/([^/]+)\/ack$/);
  if (ackMatch && method === 'POST') {
    const id = ackMatch[1];
    const incident = demoState.incidents.find((i) => i.id === id);
    if (!incident) return jsonResponse({ detail: 'Incident introuvable' }, 404);
    incident.acknowledged = true;
    incident.acknowledged_at = nowIso();
    return jsonResponse({ ok: true, incident });
  }

  const muteMatch = path.match(/^\/api\/incidents\/services\/([^/]+)\/mute$/);
  if (muteMatch && method === 'POST') {
    const serviceId = muteMatch[1];
    const minutes = Math.max(1, Number(body.minutes || 60));
    const mutedUntil = new Date(Date.now() + minutes * 60_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
    let st = demoState.serviceStates.find((s) => s.service_id === serviceId);
    const svc = demoState.customServices.find((s) => s.id === serviceId);
    if (!st) {
      st = {
        service_id: serviceId,
        service_name: svc?.name || serviceId,
        current_status: svc?.status || 'unknown',
        consecutive_failures: 0,
        last_check_at: nowIso(),
        last_transition_at: null,
        last_alert_at: null,
        muted_until: mutedUntil,
        last_error: null,
        last_latency_ms: svc?.latency_ms ?? null,
      };
      demoState.serviceStates.push(st);
    } else {
      st.muted_until = mutedUntil;
    }
    if (svc) svc.muted_until = mutedUntil;
    return jsonResponse({ ok: true, service_id: serviceId, muted_until: mutedUntil, service_state: st });
  }

  if (muteMatch && method === 'DELETE') {
    const serviceId = muteMatch[1];
    const st = demoState.serviceStates.find((s) => s.service_id === serviceId);
    if (st) st.muted_until = null;
    const svc = demoState.customServices.find((s) => s.id === serviceId);
    if (svc) svc.muted_until = null;
    return jsonResponse({
      ok: true,
      service_id: serviceId,
      muted_until: null,
      service_state: st || null,
    });
  }

  if (path === '/api/notifications/channels' && method === 'GET') {
    const resp: NotificationChannelsResponse = {
      apns: demoState.apns,
      webhooks: demoState.webhooks,
    };
    return jsonResponse(resp);
  }

  if (path === '/api/notifications/channels' && method === 'PUT') {
    if (body.apns && typeof body.apns === 'object') {
      demoState.apns = {
        ...demoState.apns,
        ...(body.apns as Partial<APNsConfigSummary>),
      };
    }
    if (Array.isArray(body.webhooks)) {
      const prevById = new Map(demoState.webhooks.map((w) => [w.id, w]));
      demoState.webhooks = (body.webhooks as Array<Record<string, unknown>>).map((item) => {
        const wid = String(item.id || '').trim() || `wh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const prev = prevById.get(wid);
        const rawBot = typeof item.bot_token === 'string' ? item.bot_token.trim() : '';
        const keepBot = !rawBot || rawBot === '********';
        return {
          id: wid,
          name: String(item.name || 'Webhook'),
          type: (item.type as WebhookChannelItem['type']) || 'generic',
          enabled: item.enabled !== false,
          url: String(item.url || ''),
          bot_token: keepBot ? (prev?.bot_token_set ? '********' : '') : '********',
          bot_token_set: keepBot ? Boolean(prev?.bot_token_set) : true,
          chat_id: String(item.chat_id || ''),
          headers: (item.headers as Record<string, string>) || {},
          has_secret_headers: Boolean(
            Object.keys((item.headers as Record<string, string>) || {}).some((k) =>
              /auth|token|secret|key|pass/i.test(k)
            )
          ),
          notify_on_down: item.notify_on_down !== false,
          notify_on_recovery: item.notify_on_recovery !== false,
          include_details: item.include_details !== false,
        };
      });
    }
    demoState.yamlOverride = null;
    return jsonResponse({ ok: true, apns: demoState.apns, webhooks: demoState.webhooks });
  }

  const devDelMatch = path.match(/^\/api\/notifications\/devices\/([^/]+)$/);
  if (devDelMatch && method === 'DELETE') {
    const token = decodeURIComponent(devDelMatch[1]);
    demoState.apns.devices = demoState.apns.devices.filter((d) => d.device_token !== token);
    demoState.apns.registered_devices_count = demoState.apns.devices.length;
    return jsonResponse({ ok: true, deleted: true, device_token: token });
  }

  if (path === '/api/notifications/test' && method === 'POST') {
    const channelId = typeof body.channel_id === 'string' ? body.channel_id : null;
    const channelType = String(body.channel_type || 'all');
    const results: NotificationTestResultItem[] = [];

    if (!channelId && (channelType === 'all' || channelType === 'apns')) {
      results.push({
        channel_id: 'apns',
        channel_name: `Apple Push (${demoState.apns.devices.length} appareil(s))`,
        channel_type: 'apns',
        ok: demoState.apns.enabled && demoState.apns.devices.length > 0,
        skipped: !demoState.apns.enabled,
        http_status: demoState.apns.enabled ? 200 : null,
        message: demoState.apns.enabled
          ? `Notification test envoyée vers ${demoState.apns.devices.length} appareil(s) APNs (Démo)`
          : 'APNs désactivé',
      });
    }

    for (const wh of demoState.webhooks) {
      if (channelId && wh.id !== channelId) continue;
      if (!channelId && channelType !== 'all' && wh.type !== channelType) continue;
      results.push({
        channel_id: wh.id,
        channel_name: wh.name,
        channel_type: wh.type,
        ok: wh.enabled,
        skipped: !wh.enabled,
        http_status: wh.enabled ? (wh.type === 'discord' ? 204 : 200) : null,
        message: wh.enabled
          ? `Webhook ${wh.type} délivré avec succès (Démo)`
          : 'Canal désactivé',
      });
    }

    const resp: NotificationTestResponse = {
      ok: results.some((r) => r.ok),
      results,
    };
    return jsonResponse(resp);
  }

  if (path === '/api/discovery/lan' && method === 'GET') {
    const resp: DiscoveryLanResponse = {
      services: [
        {
          id: 'lan-proxmox',
          name: 'Proxmox VE (pve-node-01)',
          service_type: '_https._tcp.local.',
          host: '192.168.1.10',
          port: 8006,
          txt: { product: 'pve' },
          suggested_protocol: 'http_rest',
        },
        {
          id: 'lan-jellyfin',
          name: 'Jellyfin Media Server',
          service_type: '_http._tcp.local.',
          host: '192.168.1.26',
          port: 8096,
          txt: { version: '10.10' },
          suggested_protocol: 'http_rest',
        },
        {
          id: 'lan-homeassistant',
          name: 'Home Assistant',
          service_type: '_home-assistant._tcp.local.',
          host: '192.168.1.40',
          port: 8123,
          txt: { version: '2026.11' },
          suggested_protocol: 'http_rest',
        },
        {
          id: 'lan-adguard',
          name: 'AdGuard Home DNS',
          service_type: '_http._tcp.local.',
          host: '192.168.1.5',
          port: 3000,
          txt: { path: '/control/stats' },
          suggested_protocol: 'json_metrics',
        },
      ],
      count: 4,
    };
    return jsonResponse(resp);
  }

  if (path === '/api/discovery/qr' && method === 'GET') {
    const deepLink =
      `pvecenter://connect?url=${encodeURIComponent(demoState.publicUrl)}` +
      `&name=${encodeURIComponent(demoState.serverName)}` +
      `&id=${encodeURIComponent(demoState.serverId)}`;
    const resp: DiscoveryQrResponse = {
      deep_link: deepLink,
      onboarding_link: `${demoState.publicUrl}/?onboarding=1`,
      public_url: demoState.publicUrl,
      svg_data_url_or_text: deepLink,
      server_id: demoState.serverId,
      server_name: demoState.serverName,
      mdns_service_type: '_pvecenter._tcp.local.',
      lan_ip: '192.168.1.50',
      port: 8000,
    };
    return jsonResponse(resp);
  }

  if (path === '/api/config/yaml' && method === 'GET') {
    const resp: ConfigYamlResponse = {
      yaml: buildDemoYaml(),
      hash: 'demo7f2e91c4a803b1f29e04d7a88a',
      is_synthesized: false,
      config_exists: true,
      secrets_masked: true,
      parsed_summary: buildDemoSummary(),
    };
    return jsonResponse(resp);
  }

  if (path === '/api/config/validate' && method === 'POST') {
    const yamlText = String(body.yaml || '');
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!yamlText.trim()) errors.push('Le document YAML est vide.');
    if (!yamlText.includes('server:')) errors.push('Section obligatoire "server:" manquante.');
    if (yamlText.includes('\t')) errors.push('Les tabulations ne sont pas autorisées en YAML (utilisez des espaces).');
    if (!yamlText.includes('proxmox:')) warnings.push('Section "proxmox:" absente — la supervision PVE sera désactivée.');
    const resp: ConfigValidateResponse = {
      valid: errors.length === 0,
      errors,
      warnings,
      parsed_summary: errors.length === 0 ? buildDemoSummary() : null,
    };
    return jsonResponse(resp);
  }

  if (path === '/api/config/yaml' && method === 'PUT') {
    const yamlText = String(body.yaml || '');
    if (!yamlText.trim() || !yamlText.includes('server:') || yamlText.includes('\t')) {
      return jsonResponse(
        {
          ok: false,
          valid: false,
          errors: [
            !yamlText.trim()
              ? 'Le document YAML est vide.'
              : yamlText.includes('\t')
                ? 'Tabulations interdites en YAML.'
                : 'Section "server:" requise.',
          ],
          warnings: [],
          detail: 'Validation YAML échouée.',
        },
        422
      );
    }
    demoState.yamlOverride = yamlText;
    const resp: ConfigSaveResponse = {
      ok: true,
      valid: true,
      hash: `demo${Date.now().toString(16)}`,
      warnings: [],
      parsed_summary: buildDemoSummary(),
      message: 'Configuration YAML enregistrée et rechargée à chaud (Démo).',
    };
    return jsonResponse(resp);
  }

  if (path === '/api/config/export' && method === 'GET') {
    return new Response(buildDemoYaml(), {
      status: 200,
      headers: {
        'Content-Type': 'application/x-yaml',
        'Content-Disposition': 'attachment; filename="config.yaml"',
      },
    });
  }

  if (path === '/api/widgets/all' && method === 'GET') {
    const dlTotal = demoState.qbitTorrents.reduce(
      (sum, t) => sum + (t.state.startsWith('paused') ? 0 : t.dlspeed),
      0
    );
    const upTotal = demoState.qbitTorrents.reduce(
      (sum, t) => sum + (t.state.startsWith('paused') ? 0 : t.upspeed),
      0
    );
    const widgets: WidgetsMap = {
      jellyfin: {
        status: 'ok',
        active_streams_count: 2,
        active_streams: [
          {
            user: 'Alex',
            title: 'Dune : Deuxième Partie',
            device: 'Apple TV 4K',
            play_method: 'DirectPlay',
            is_paused: false,
          },
          {
            user: 'Camille',
            title: 'Severance S02E03',
            device: 'iPhone 16 Pro',
            play_method: 'Transcode',
            is_paused: false,
          },
        ],
        movies_count: 418,
        series_count: 64,
        episodes_count: 1840,
      },
      radarr: {
        status: 'ok',
        movies_total: 418,
        movies_downloaded: 414,
        movies_missing: 4,
        queue_count: 1,
        upcoming: [{ title: 'Mickey 17', date: '2026-11-22' }],
      },
      sonarr: {
        status: 'ok',
        series_total: 64,
        episodes_downloaded: 1840,
        queue_count: 2,
        upcoming: [{ title: 'Severance S02E04', date: '2026-11-20' }],
      },
      prowlarr: {
        status: 'ok',
        indexers_enabled: 8,
        indexers_total: 8,
        queries: 1420,
        grabs: 86,
      },
      qbittorrent: {
        status: 'ok',
        dl_speed_bytes: demoState.qbitAltSpeed ? Math.round(dlTotal * 0.25) : dlTotal,
        up_speed_bytes: demoState.qbitAltSpeed ? Math.round(upTotal * 0.25) : upTotal,
        dl_total_bytes: Math.round(1.8 * TB),
        up_total_bytes: Math.round(6.4 * TB),
        downloading_count: demoState.qbitTorrents.filter((t) => t.state === 'downloading').length,
        seeding_count: demoState.qbitTorrents.filter((t) => t.state === 'uploading').length,
        torrents_total: demoState.qbitTorrents.length,
      },
    };
    return jsonResponse(widgets);
  }

  if (path === '/api/ops/overview' && method === 'GET') {
    const ops: OpsOverview = {
      pve_tasks: demoState.pveTasks.slice(0, 12),
      seerr_requests: demoState.seerrRequests,
      qbit_control: {
        available: true,
        alt_speed_enabled: demoState.qbitAltSpeed,
        torrents: demoState.qbitTorrents,
      },
    };
    return jsonResponse(ops);
  }

  const seerrMatch = path.match(/^\/api\/ops\/seerr\/(\d+)\/(approve|decline)$/);
  if (seerrMatch && method === 'POST') {
    const [, idStr, action] = seerrMatch;
    const reqItem = demoState.seerrRequests.find((r) => r.id === Number(idStr));
    if (!reqItem) return jsonResponse({ detail: 'Demande introuvable' }, 404);
    reqItem.status = action === 'approve' ? 2 : 3;
    return jsonResponse({ ok: true, id: reqItem.id, action });
  }

  if (path === '/api/ops/qbit/toggle-speed-mode' && method === 'POST') {
    demoState.qbitAltSpeed = !demoState.qbitAltSpeed;
    return jsonResponse({ ok: true, alt_speed_enabled: demoState.qbitAltSpeed });
  }

  const torrentMatch = path.match(/^\/api\/ops\/qbit\/torrent\/([^/]+)\/(pause|resume)$/);
  if (torrentMatch && method === 'POST') {
    const [, hash, action] = torrentMatch;
    const torrent = demoState.qbitTorrents.find((t) => t.hash === hash);
    if (!torrent) return jsonResponse({ detail: 'Torrent introuvable' }, 404);
    if (action === 'pause') {
      torrent.state = torrent.progress_pct >= 100 ? 'pausedUP' : 'pausedDL';
    } else {
      torrent.state = torrent.progress_pct >= 100 ? 'uploading' : 'downloading';
    }
    return jsonResponse({ ok: true, hash, action });
  }

  const scanMatch = path.match(/^\/api\/ops\/media\/scan\/(jellyfin|plex)$/);
  if (scanMatch && method === 'POST') {
    return jsonResponse({ ok: true, service: scanMatch[1], message: 'Scan démarré (Démo)' });
  }

  if (path === '/api/users' && method === 'GET') {
    const total = demoState.users.length;
    const synced = demoState.users.filter((u) => u.in_jellyseerr).length;
    const disabled = demoState.users.filter((u) => u.is_disabled).length;
    const overview: UsersOverview = {
      counts: {
        total_jellyfin: total,
        synced_jellyseerr: synced,
        unsynced_count: total - synced,
        disabled_count: disabled,
      },
      libraries: [
        { id: 'lib-movies', name: 'Films 4K & HD' },
        { id: 'lib-series', name: 'Séries TV' },
        { id: 'lib-anime', name: 'Animation' },
      ],
      users: demoState.users,
    };
    return jsonResponse(overview);
  }

  if (path === '/api/users' && method === 'POST') {
    const username = String(body.username || '').trim();
    if (!username) return jsonResponse({ detail: 'Nom d’utilisateur requis' }, 400);
    const created: UnifiedUser = {
      jellyfin_id: `demo-user-${Date.now()}`,
      name: username,
      is_admin: Boolean(body.is_admin),
      is_protected: false,
      is_disabled: false,
      enable_all_folders: Boolean(body.enable_all_folders ?? true),
      enabled_folders: Array.isArray(body.enabled_folders) ? (body.enabled_folders as string[]) : [],
      enable_downloading: Boolean(body.enable_downloading ?? true),
      max_active_sessions: typeof body.max_active_sessions === 'number' ? body.max_active_sessions : 2,
      last_activity: null,
      in_jellyseerr: Boolean(body.sync_jellyseerr ?? true),
      jellyseerr_id: body.sync_jellyseerr ? demoState.users.length + 10 : null,
      request_count: 0,
      auto_approve: Boolean(body.auto_approve ?? true),
    };
    demoState.users.push(created);
    return jsonResponse({
      ok: true,
      user: created,
      jellyfin: { ok: true },
      jellyseerr: { ok: true, status: created.in_jellyseerr ? 'created' : 'skipped' },
    });
  }

  if (path === '/api/users/sync' && method === 'POST') {
    demoState.users = demoState.users.map((u, idx) => ({
      ...u,
      in_jellyseerr: true,
      jellyseerr_id: u.jellyseerr_id ?? idx + 10,
      auto_approve: true,
    }));
    return jsonResponse({ ok: true, imported_count: demoState.users.length });
  }

  const userPatchMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (userPatchMatch && method === 'PATCH') {
    const user = demoState.users.find((u) => u.jellyfin_id === userPatchMatch[1]);
    if (!user) return jsonResponse({ detail: 'Utilisateur introuvable' }, 404);
    if (user.is_protected) return jsonResponse({ detail: 'Compte administrateur protégé' }, 403);
    if (typeof body.is_disabled === 'boolean') user.is_disabled = body.is_disabled;
    if (typeof body.is_admin === 'boolean') user.is_admin = body.is_admin;
    if (typeof body.enable_all_folders === 'boolean') user.enable_all_folders = body.enable_all_folders;
    if (Array.isArray(body.enabled_folders)) user.enabled_folders = body.enabled_folders as string[];
    if (typeof body.enable_downloading === 'boolean') user.enable_downloading = body.enable_downloading;
    if (typeof body.max_active_sessions === 'number') user.max_active_sessions = body.max_active_sessions;
    if (typeof body.auto_approve === 'boolean') user.auto_approve = body.auto_approve;
    return jsonResponse({ ok: true, user });
  }

  const userPassMatch = path.match(/^\/api\/users\/([^/]+)\/password$/);
  if (userPassMatch && method === 'POST') {
    return jsonResponse({ ok: true });
  }

  if (userPatchMatch && method === 'DELETE') {
    const user = demoState.users.find((u) => u.jellyfin_id === userPatchMatch[1]);
    if (!user) return jsonResponse({ detail: 'Utilisateur introuvable' }, 404);
    if (user.is_protected) return jsonResponse({ detail: 'Compte administrateur protégé' }, 403);
    demoState.users = demoState.users.filter((u) => u.jellyfin_id !== user.jellyfin_id);
    return jsonResponse({ ok: true });
  }

  if (path === '/api/setup/status' && method === 'GET') {
    const tailscaleUrl = demoState.publicUrl || 'https://panel.example.ts.net';
    const status: SetupStatusResponse = {
      is_configured: demoState.setupConfigured,
      tailscale_url: tailscaleUrl,
      pairing_deep_link: `pvecenter://connect?url=${encodeURIComponent(tailscaleUrl)}&name=${encodeURIComponent(demoState.serverName)}`,
      env: { ...demoState.setupEnv },
      categories: demoState.categories.map((cat) => ({
        name: cat.name,
        services: cat.services.map((svc) => ({ ...svc })),
      })),
      storage_mounts: demoState.storageMounts.map((mount) => ({ ...mount })),
    };
    return jsonResponse(status);
  }

  if (path === '/api/setup/test-service' && method === 'POST') {
    const service = String(body.service || 'service');
    const targetUrl = String(body.url || '').trim();
    if (!targetUrl) {
      const missing: SetupTestServiceResponse = {
        ok: false,
        service,
        message: 'URL requise pour tester ce service.',
        latency_ms: null,
      };
      return jsonResponse(missing);
    }
    if (!/^https?:\/\//i.test(targetUrl)) {
      const invalid: SetupTestServiceResponse = {
        ok: false,
        service,
        message: 'L’URL doit commencer par http:// ou https://.',
        latency_ms: null,
      };
      return jsonResponse(invalid);
    }
    const passed: SetupTestServiceResponse = {
      ok: true,
      service,
      message: `Connexion ${service} validée (Mode Démo).`,
      latency_ms: 12,
    };
    return jsonResponse(passed);
  }

  if (path === '/api/setup/config' && method === 'PUT') {
    const envPatch =
      body.env && typeof body.env === 'object'
        ? (body.env as Record<string, unknown>)
        : {};

    const stringKeys = [
      'allowed_tailscale_users',
      'protected_owner_username',
      'pve_host',
      'pve_node',
      'pve_token_id',
      'jellyfin_url',
      'jellyseerr_url',
      'plex_url',
      'radarr_url',
      'sonarr_url',
      'prowlarr_url',
      'qbit_url',
      'qbit_username',
    ] as const;

    for (const key of stringKeys) {
      if (typeof envPatch[key] === 'string') {
        demoState.setupEnv[key] = envPatch[key];
      }
    }

    if (typeof envPatch.dev_auth_bypass === 'boolean') {
      demoState.setupEnv.dev_auth_bypass = envPatch.dev_auth_bypass;
    }
    if (typeof envPatch.pve_verify_ssl === 'boolean') {
      demoState.setupEnv.pve_verify_ssl = envPatch.pve_verify_ssl;
    }
    if (typeof envPatch.panel_self_vmid === 'number' && Number.isFinite(envPatch.panel_self_vmid)) {
      demoState.setupEnv.panel_self_vmid = envPatch.panel_self_vmid;
    }

    const secretSetMap: Array<[string, keyof SetupEnvConfig]> = [
      ['pve_token_secret', 'pve_token_secret_set'],
      ['jellyfin_api_key', 'jellyfin_api_key_set'],
      ['jellyseerr_api_key', 'jellyseerr_api_key_set'],
      ['plex_token', 'plex_token_set'],
      ['radarr_api_key', 'radarr_api_key_set'],
      ['sonarr_api_key', 'sonarr_api_key_set'],
      ['prowlarr_api_key', 'prowlarr_api_key_set'],
      ['qbit_password', 'qbit_password_set'],
    ];

    for (const [secretKey, flagKey] of secretSetMap) {
      const val = envPatch[secretKey];
      if (typeof val === 'string' && val.trim().length > 0) {
        (demoState.setupEnv[flagKey] as boolean) = true;
      }
    }

    if (Array.isArray(body.categories)) {
      demoState.categories = body.categories as SetupCategoryConfig[];
    }
    if (Array.isArray(body.storage_mounts)) {
      demoState.storageMounts = body.storage_mounts as StorageMountConfig[];
    }

    demoState.setupConfigured = Boolean(
      demoState.setupEnv.pve_host.trim() && demoState.setupEnv.pve_token_secret_set
    );
    demoState.yamlOverride = null;

    const updated: SetupConfigUpdateResponse = {
      ok: true,
      is_configured: demoState.setupConfigured,
      message: 'Configuration enregistrée et rechargée à chaud (Démo).',
    };
    return jsonResponse(updated);
  }

  if (path === '/api/updates/overview' && method === 'GET') {
    return jsonResponse(buildDemoUpdatesOverview());
  }

  if (path === '/api/updates/check' && method === 'POST') {
    const ts = nowIso();
    demoState.updatesLastCheckedAt = ts;
    for (const target of demoState.updatesTargets) {
      target.last_checked_at = ts;
    }
    return jsonResponse(buildDemoUpdatesOverview());
  }

  if (path === '/api/updates/jobs/current' && method === 'GET') {
    return jsonResponse({
      active_job: demoState.activeUpdateJob,
      recent_jobs: demoState.recentUpdateJobs,
    });
  }

  if (path === '/api/updates/setup-info' && method === 'GET') {
    const pubKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDemoUpdateCenterKey000000000000 pve-center-updates';
    const setupInfo: UpdatesSetupInfoResponse = {
      ssh_configured: demoState.updatesSshConfigured,
      ssh_message: demoState.updatesSshConfigured
        ? 'Connecté en SSH (root@192.168.1.10 • Mode Démo).'
        : 'Clé en attente d’autorisation.',
      ssh_host: '192.168.1.10',
      ssh_port: 22,
      ssh_user: 'root',
      ssh_public_key: pubKey,
      proxmox_one_liner: `mkdir -p ~/.ssh && printf '%s\\n' '${pubKey}' >> ~/.ssh/authorized_keys`,
      panel_repo_dir: '/opt/pve-panel',
    };
    return jsonResponse(setupInfo);
  }

  if (path === '/api/updates/ssh-key/rotate' && method === 'POST') {
    demoState.updatesSshConfigured = true;
    const pubKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIRotatedDemoKey00000000000000 pve-center-updates';
    return jsonResponse({
      ssh_configured: true,
      ssh_message: 'Nouvelle clé Ed25519 générée (Mode Démo).',
      ssh_host: '192.168.1.10',
      ssh_port: 22,
      ssh_user: 'root',
      ssh_public_key: pubKey,
      proxmox_one_liner: `mkdir -p ~/.ssh && printf '%s\\n' '${pubKey}' >> ~/.ssh/authorized_keys`,
      panel_repo_dir: '/opt/pve-panel',
    });
  }

  if (path === '/api/updates/run' && method === 'POST') {
    if (demoState.activeUpdateJob?.status === 'running') {
      return jsonResponse({ detail: 'Une opération de mise à jour est déjà en cours.' }, 409);
    }
    const reqIds = Array.isArray(body.target_ids) ? body.target_ids.map(String) : ['all'];
    const includeSelf = body.include_panel_self !== false;
    const selected = demoState.updatesTargets
      .filter((t) =>
        reqIds.includes('all')
          ? t.can_execute && (t.id !== 'panel:server' || includeSelf)
          : reqIds.includes(t.id) && t.can_execute
      )
      .sort((a, b) => (a.id === 'panel:server' ? 1 : 0) - (b.id === 'panel:server' ? 1 : 0));

    if (selected.length === 0) {
      return jsonResponse({ detail: 'Aucune cible exécutable trouvée.' }, 400);
    }

    const job: UpdateJob = {
      id: `upd-demo-${Date.now().toString(36).slice(-5)}`,
      status: 'running',
      started_at: nowIso(),
      finished_at: null,
      progress_pct: 5,
      steps: selected.map((t, i) => ({
        target_id: t.id,
        name: t.name,
        category: t.category,
        status: i === 0 ? 'running' : 'pending',
        message: i === 0 ? 'Mise à jour en cours (Démo)…' : 'En attente',
      })),
      logs: [`[${nowIso().slice(11, 19)}] Démarrage de la mise à jour centralisée (${selected.length} cible(s)).`],
    };
    demoState.activeUpdateJob = job;

    selected.forEach((target, idx) => {
      window.setTimeout(() => {
        if (!demoState.activeUpdateJob || demoState.activeUpdateJob.id !== job.id) return;
        const step = demoState.activeUpdateJob.steps[idx];
        if (step) {
          step.status = 'succeeded';
          step.message = `${target.name} mis à jour (Démo).`;
        }
        target.update_available = false;
        target.pending_count = 0;
        target.latest_version = 'À jour';
        demoState.activeUpdateJob.logs.push(
          `[${nowIso().slice(11, 19)}] OK ${target.name} -> À jour`
        );
        demoState.activeUpdateJob.progress_pct = Math.round(((idx + 1) / selected.length) * 100);
        if (idx + 1 < selected.length && demoState.activeUpdateJob.steps[idx + 1]) {
          demoState.activeUpdateJob.steps[idx + 1].status = 'running';
          demoState.activeUpdateJob.steps[idx + 1].message = 'Mise à jour en cours…';
        } else {
          demoState.activeUpdateJob.status = 'succeeded';
          demoState.activeUpdateJob.finished_at = nowIso();
          demoState.recentUpdateJobs.unshift({ ...demoState.activeUpdateJob });
        }
      }, (idx + 1) * 650);
    });

    return jsonResponse({ ok: true, job });
  }

  return jsonResponse({ detail: `Endpoint démo non simulé: ${method} ${path}` }, 404);
}

function extractApiPath(input: RequestInfo | URL): string | null {
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  if (raw.startsWith('/api/')) {
    return raw;
  }

  if (typeof window !== 'undefined' && raw.startsWith(window.location.origin + '/api/')) {
    return raw.slice(window.location.origin.length);
  }

  return null;
}

export function installApiInterceptor(): void {
  if (typeof window === 'undefined' || interceptorInstalled) return;
  interceptorInstalled = true;
  nativeFetchRef = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const apiPath = extractApiPath(input);
    const nativeFetch = nativeFetchRef!;

    if (!apiPath) {
      return nativeFetch(input, init);
    }

    if (isDemoMode()) {
      return handleDemoRequest(apiPath, init);
    }

    const token = getAuthToken();
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const remoteBase = getServerUrl();
    const nextInit: RequestInit = {
      ...init,
      headers,
      credentials: init?.credentials ?? 'include',
    };

    if (remoteBase) {
      const targetUrl = `${remoteBase}${apiPath}`;
      return nativeFetch(targetUrl, nextInit);
    }

    return nativeFetch(input, nextInit);
  };
}
