export interface AuthUser {
  login: string;
  name: string;
  profile_pic: string;
  auth_mode: 'tailscale_serve' | 'api_token' | 'session' | 'dev_bypass' | 'demo' | string;
  role?: 'admin' | 'operator' | 'viewer' | 'device' | string;
}

export interface AuthLoginResponse {
  ok: boolean;
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at: string;
  user: AuthUser;
}

export interface ApiTokenInfo {
  id: string;
  name: string;
  role: 'admin' | 'operator' | 'viewer' | 'device' | string;
  created_at: string;
}

export interface StorageInfo {
  name: string;
  type: string;
  active: boolean;
  used_bytes: number;
  total_bytes: number;
  used_pct: number;
  node?: string;
}

export interface ClusterNode {
  name: string;
  status: string;
  online: boolean;
  cpu_pct: number;
  cpus: number;
  mem_used_bytes: number;
  mem_total_bytes: number;
  mem_pct: number;
  uptime_seconds: number;
  uptime_human: string;
}

export interface PveNodesResponse {
  nodes: ClusterNode[];
  default_node: string;
}

export interface NodeSummary {
  name: string;
  cpu_pct: number;
  cpu_model: string;
  cpu_threads: number;
  loadavg: string[];
  mem_used_bytes: number;
  mem_total_bytes: number;
  mem_pct: number;
  swap_used_bytes: number;
  swap_total_bytes: number;
  rootfs_used_bytes: number;
  rootfs_total_bytes: number;
  uptime_seconds: number;
  uptime_human: string;
  pve_version: string;
  storages: StorageInfo[];
}

export interface PveResource {
  vmid: number;
  node?: string;
  name: string;
  type: 'lxc' | 'qemu';
  status: string;
  cpu_pct: number;
  cpus: number;
  mem_used_bytes: number;
  mem_total_bytes: number;
  mem_pct: number;
  disk_used_bytes: number;
  disk_total_bytes: number;
  uptime_seconds: number;
  uptime_human: string;
  tags: string[];
  is_self: boolean;
}

export interface MergerfsPoolInfo {
  name: string;
  mount: string;
  fstype: string;
  policy: string;
  drives_count: number;
  available: boolean;
  total_bytes: number;
  used_bytes: number;
  avail_bytes: number;
  used_pct: number;
}

export interface PhysicalDriveInfo {
  mount: string;
  label: string;
  wwn: string;
  devpath: string;
  model: string;
  vendor: string;
  serial: string;
  type: string;
  rpm: string;
  health: string;
  size_bytes: number;
  total_bytes: number;
  used_bytes: number;
  avail_bytes: number;
  used_pct: number;
}

export interface SystemSsdInfo {
  devpath: string;
  model: string;
  serial: string;
  health: string;
  size_bytes: number;
}

export interface ExternalStorageOverview {
  pool: MergerfsPoolInfo;
  drives: PhysicalDriveInfo[];
  system_ssd: SystemSsdInfo | null;
}

export interface PveOverview {
  online: boolean;
  selected_node?: string;
  failover_active?: boolean;
  cluster_nodes?: ClusterNode[];
  node: NodeSummary;
  counts: {
    total: number;
    running: number;
    stopped: number;
    lxc: number;
    qemu: number;
  };
  resources: PveResource[];
  external_storage?: ExternalStorageOverview;
}

export type PveAction = 'start' | 'shutdown' | 'reboot' | 'stop';

export type ServiceProtocol =
  | 'http_rest'
  | 'tcp_port'
  | 'icmp_ping'
  | 'json_metrics'
  | 'webhook_ingest';

export type ServiceAuthType = 'none' | 'bearer' | 'basic' | 'header';

export type ServiceHealthStatus = 'up' | 'degraded' | 'down' | 'disabled' | 'unknown';

export interface AlertPolicyConfig {
  enabled: boolean;
  consecutive_failures: number;
  cooldown_seconds: number;
}

export interface ServiceItem {
  id: string;
  name: string;
  description: string;
  url: string;
  ping_url?: string;
  icon: string;
  widget?: string;
  online: boolean;
  latency_ms: number | null;
  status_code: number | null;
  category?: string;
  protocol?: ServiceProtocol;
  host?: string;
  port?: number | null;
  health_url?: string;
  internal_url?: string;
  is_custom?: boolean;
  status?: ServiceHealthStatus;
  message?: string;
  metrics?: Record<string, string | number | boolean | null>;
  enabled?: boolean;
  muted_until?: string | null;
}

export interface ServiceCategory {
  name: string;
  services: ServiceItem[];
}

export interface CustomServiceItem extends ServiceItem {
  category: string;
  protocol: ServiceProtocol;
  host: string;
  port: number | null;
  health_url: string;
  internal_url: string;
  auth_type: ServiceAuthType;
  auth_token: string;
  auth_token_set: boolean;
  auth_header_name: string;
  json_metric_path: string;
  expected_status: number;
  refresh_interval_seconds: number;
  order: number;
  enabled: boolean;
  verify_ssl: boolean;
  webhook_ttl_seconds: number;
  alert_policy: AlertPolicyConfig;
  is_custom: true;
  status: ServiceHealthStatus;
  message: string;
  metrics: Record<string, string | number | boolean | null>;
  consecutive_failures: number;
  last_check_at: string | null;
  last_transition_at: string | null;
  last_alert_at: string | null;
  muted_until: string | null;
  last_error: string | null;
}

export interface CustomServicePayload {
  id?: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  protocol: ServiceProtocol;
  host?: string;
  port?: number | null;
  url?: string;
  health_url?: string;
  internal_url?: string;
  auth_type?: ServiceAuthType;
  auth_token?: string;
  auth_header_name?: string;
  json_metric_path?: string;
  expected_status?: number;
  refresh_interval_seconds?: number;
  order?: number;
  enabled?: boolean;
  verify_ssl?: boolean;
  webhook_ttl_seconds?: number;
  alert_policy?: AlertPolicyConfig;
}

export interface CustomServiceTestResponse {
  ok: boolean;
  service_id: string;
  protocol: ServiceProtocol;
  status: ServiceHealthStatus;
  latency_ms: number | null;
  http_status: number | null;
  message: string;
  metrics: Record<string, string | number | boolean | null>;
}

export interface IncidentItem {
  id: string;
  service_id: string;
  service_name: string;
  severity: 'critical' | 'warning' | 'info' | string;
  title: string;
  message: string;
  started_at: string;
  resolved_at: string | null;
  acknowledged: boolean;
  acknowledged_at: string | null;
}

export interface ServiceStateItem {
  service_id: string;
  service_name: string;
  current_status: ServiceHealthStatus;
  consecutive_failures: number;
  last_check_at: string | null;
  last_transition_at: string | null;
  last_alert_at: string | null;
  muted_until: string | null;
  last_error: string | null;
  last_latency_ms: number | null;
  last_metrics?: Record<string, string | number | boolean | null>;
}

export interface IncidentsResponse {
  incidents: IncidentItem[];
  count: number;
  active_count: number;
  service_states: ServiceStateItem[];
}

export interface APNsDeviceInfo {
  device_token: string;
  platform: 'ios' | 'ipados' | 'tvos' | 'macos' | string;
  device_name: string;
  app_version: string;
  environment: 'sandbox' | 'production' | string;
  created_at?: string;
  updated_at?: string;
}

export interface APNsConfigSummary {
  enabled: boolean;
  team_id: string;
  key_id: string;
  bundle_id: string;
  private_key_path: string;
  private_key_exists: boolean;
  use_sandbox: boolean;
  configured: boolean;
  registered_devices_count: number;
  devices: APNsDeviceInfo[];
}

export type WebhookChannelType = 'discord' | 'telegram' | 'generic';

export interface WebhookChannelItem {
  id: string;
  name: string;
  type: WebhookChannelType;
  enabled: boolean;
  url: string;
  bot_token: string;
  bot_token_set: boolean;
  chat_id: string;
  headers: Record<string, string>;
  has_secret_headers: boolean;
  notify_on_down: boolean;
  notify_on_recovery: boolean;
  include_details: boolean;
}

export interface NotificationChannelsResponse {
  apns: APNsConfigSummary;
  webhooks: WebhookChannelItem[];
}

export interface NotificationTestResultItem {
  channel_id: string;
  channel_name: string;
  channel_type: string;
  ok: boolean;
  skipped: boolean;
  http_status: number | null;
  message: string;
}

export interface NotificationTestResponse {
  ok: boolean;
  results: NotificationTestResultItem[];
}

export interface LanDiscoveredService {
  id: string;
  name: string;
  service_type: string;
  host: string;
  port: number;
  txt: Record<string, string>;
  suggested_protocol: ServiceProtocol;
}

export interface DiscoveryLanResponse {
  services: LanDiscoveredService[];
  count: number;
}

export interface DiscoveryQrResponse {
  deep_link: string;
  onboarding_link: string;
  public_url: string;
  svg_data_url_or_text: string;
  server_id: string;
  server_name: string;
  mdns_service_type: string;
  lan_ip: string;
  port: number;
}

export interface OnboardingStatusResponse {
  is_configured: boolean;
  needs_onboarding: boolean;
  config_exists: boolean;
  is_synthesized: boolean;
  server_id: string;
  server_name: string;
  public_url: string;
  tailscale_sso_enabled: boolean;
  pin_configured: boolean;
  api_tokens_count: number;
  auth_methods: string[];
}

export interface OnboardingInitRequest {
  server_name: string;
  public_url?: string;
  listen_host?: string;
  listen_port?: number;
  mdns_enabled?: boolean;
  tailscale_sso_enabled?: boolean;
  allowed_tailscale_users?: string[];
  dev_auth_bypass?: boolean;
  admin_pin?: string;
  token_name?: string;
  proxmox?: Record<string, unknown>;
  integrations?: Record<string, unknown>;
  alerts?: Record<string, unknown>;
  notifications?: Record<string, unknown>;
  categories?: SetupCategoryConfig[];
  custom_services?: CustomServicePayload[];
  storage_mounts?: StorageMountConfig[];
}

export interface OnboardingInitResponse {
  ok: boolean;
  is_configured: boolean;
  server_id: string;
  server_name: string;
  api_token: string;
  token_id: string;
  config_hash: string;
  config_path: string;
}

export interface ConfigParsedSummary {
  version: number;
  server_id: string;
  server_name: string;
  listen_port: number;
  public_url: string;
  proxmox_host: string;
  proxmox_node: string;
  categories_count: number;
  custom_services_count: number;
  webhooks_count: number;
  api_tokens_count: number;
  alerts_enabled: boolean;
  apns_enabled: boolean;
}

export interface ConfigYamlResponse {
  yaml: string;
  hash: string;
  is_synthesized: boolean;
  config_exists: boolean;
  secrets_masked: boolean;
  parsed_summary: ConfigParsedSummary;
}

export interface ConfigValidateResponse {
  valid: boolean;
  errors: string[];
  warnings: string[];
  parsed_summary: ConfigParsedSummary | null;
}

export interface ConfigSaveResponse {
  ok: boolean;
  valid: boolean;
  hash?: string;
  warnings: string[];
  errors?: string[];
  parsed_summary?: ConfigParsedSummary;
  message?: string;
  detail?: string;
}

export type RealtimeTransportMode = 'ws' | 'sse' | 'demo' | 'connecting' | 'disconnected';

export interface RealtimeEvent {
  type:
    | 'service_status_changed'
    | 'alert_triggered'
    | 'alert_resolved'
    | 'incident_acknowledged'
    | 'pairing_completed'
    | 'config_reloaded'
    | 'ping'
    | string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface JellyfinStream {
  user: string;
  title: string;
  device: string;
  play_method: string;
  is_paused: boolean;
}

export interface JellyfinWidget {
  status: string;
  active_streams_count?: number;
  active_streams?: JellyfinStream[];
  movies_count?: number;
  series_count?: number;
  episodes_count?: number;
}

export interface PlexWidget {
  status: string;
  active_streams_count?: number;
  libraries_count?: number;
  libraries?: string[];
  version?: string;
}

export interface UpcomingItem {
  title: string;
  date: string;
}

export interface RadarrWidget {
  status: string;
  movies_total?: number;
  movies_downloaded?: number;
  movies_missing?: number;
  queue_count?: number;
  upcoming?: UpcomingItem[];
}

export interface SonarrWidget {
  status: string;
  series_total?: number;
  episodes_downloaded?: number;
  queue_count?: number;
  upcoming?: UpcomingItem[];
}

export interface ProwlarrWidget {
  status: string;
  indexers_enabled?: number;
  indexers_total?: number;
  queries?: number;
  grabs?: number;
}

export interface QbittorrentWidget {
  status: string;
  dl_speed_bytes?: number;
  up_speed_bytes?: number;
  dl_total_bytes?: number;
  up_total_bytes?: number;
  downloading_count?: number;
  seeding_count?: number;
  torrents_total?: number;
}

export interface WidgetsMap {
  jellyfin?: JellyfinWidget;
  plex?: PlexWidget;
  radarr?: RadarrWidget;
  sonarr?: SonarrWidget;
  prowlarr?: ProwlarrWidget;
  qbittorrent?: QbittorrentWidget;
  [key: string]: unknown;
}

export interface JellyfinLibrary {
  id: string;
  name: string;
}

export interface UnifiedUser {
  jellyfin_id: string;
  name: string;
  is_admin: boolean;
  is_protected?: boolean;
  is_disabled: boolean;
  enable_all_folders: boolean;
  enabled_folders: string[];
  enable_downloading: boolean;
  max_active_sessions: number;
  last_activity: string | null;
  in_jellyseerr: boolean;
  jellyseerr_id: number | null;
  request_count: number;
  auto_approve: boolean;
}

export interface UsersOverview {
  counts: {
    total_jellyfin: number;
    synced_jellyseerr: number;
    unsynced_count: number;
    disabled_count: number;
  };
  libraries: JellyfinLibrary[];
  users: UnifiedUser[];
}

export interface PveTaskItem {
  upid: string;
  type: string;
  vmid: string;
  user: string;
  status: string;
  starttime: number;
  endtime: number;
  duration_sec: number | null;
}

export interface SeerrRequestItem {
  id: number;
  status: number;
  media_type: string;
  title: string;
  requested_by: string;
  created_at: string;
  media_status: number;
}

export interface QbitTorrentItem {
  hash: string;
  name: string;
  state: string;
  progress_pct: number;
  dlspeed: number;
  upspeed: number;
  size: number;
  eta: number;
}

export interface OpsOverview {
  pve_tasks: PveTaskItem[];
  seerr_requests: SeerrRequestItem[];
  qbit_control: {
    available: boolean;
    alt_speed_enabled: boolean;
    torrents: QbitTorrentItem[];
  };
}

export interface SetupEnvConfig {
  dev_auth_bypass: boolean;
  allowed_tailscale_users: string;
  protected_owner_username: string;
  pve_host: string;
  pve_node: string;
  pve_token_id: string;
  pve_token_secret_set: boolean;
  pve_verify_ssl: boolean;
  panel_self_vmid: number;
  mergerfs_pool_subpath?: string;
  jellyfin_url: string;
  jellyfin_api_key_set: boolean;
  jellyseerr_url: string;
  jellyseerr_api_key_set: boolean;
  plex_url: string;
  plex_token_set: boolean;
  radarr_url: string;
  radarr_api_key_set: boolean;
  sonarr_url: string;
  sonarr_api_key_set: boolean;
  prowlarr_url: string;
  prowlarr_api_key_set: boolean;
  qbit_url: string;
  qbit_username: string;
  qbit_password_set: boolean;
}

export interface SetupServiceConfig {
  id: string;
  name: string;
  description: string;
  url: string;
  ping_url?: string;
  icon: string;
  widget?: string;
}

export interface SetupCategoryConfig {
  name: string;
  services: SetupServiceConfig[];
}

export interface StorageMountConfig {
  mount: string;
  subpath: string;
  wwn: string;
  label: string;
}

export interface SetupStatusResponse {
  is_configured: boolean;
  tailscale_url: string;
  pairing_deep_link: string;
  env: SetupEnvConfig;
  categories: SetupCategoryConfig[];
  storage_mounts: StorageMountConfig[];
}

export type SetupTestServiceName =
  | 'proxmox'
  | 'jellyfin'
  | 'jellyseerr'
  | 'plex'
  | 'radarr'
  | 'sonarr'
  | 'prowlarr'
  | 'qbittorrent';

export interface SetupTestServiceRequest {
  service: SetupTestServiceName | string;
  url: string;
  node?: string;
  token_id?: string;
  secret?: string;
  username?: string;
  verify_ssl?: boolean;
}

export interface SetupTestServiceResponse {
  ok: boolean;
  service: string;
  message: string;
  latency_ms: number | null;
}

export interface SetupConfigUpdateRequest {
  env: Partial<Record<string, string | number | boolean>>;
  categories?: SetupCategoryConfig[];
  storage_mounts?: StorageMountConfig[];
}

export interface SetupConfigUpdateResponse {
  ok: boolean;
  is_configured: boolean;
  message: string;
}
