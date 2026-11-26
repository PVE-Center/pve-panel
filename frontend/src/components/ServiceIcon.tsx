import { useId, type ComponentType, type ReactNode } from 'react';
import {
  Activity,
  Clapperboard,
  Cloud,
  Cpu,
  Database,
  Download,
  Film,
  Gamepad2,
  Globe,
  HardDrive,
  LayoutGrid,
  Lock,
  Play,
  Radar,
  Router,
  Search,
  Server,
  Shield,
  Sparkles,
  Terminal,
  Tv,
  Webhook,
  Wifi,
} from 'lucide-react';

export interface BrandIconMeta {
  id: string;
  label: string;
  tintClass: string;
  aliases: string[];
  keywords: string[];
  renderSvg: (uid: string) => ReactNode;
}

const GENERIC_LUCIDE_MAP: Record<string, ComponentType<{ className?: string }>> = {
  Server,
  Globe,
  Activity,
  Shield,
  Database,
  Cpu,
  HardDrive,
  Wifi,
  Tv,
  Film,
  Cloud,
  Download,
  Radar,
  Router,
  Sparkles,
  Lock,
  Gamepad2,
  LayoutGrid,
  Terminal,
  Webhook,
  Play,
  Clapperboard,
  Search,
};

export const GENERIC_ICON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'lucide:Server', label: 'Serveur' },
  { value: 'lucide:Globe', label: 'Web' },
  { value: 'lucide:Activity', label: 'Monitoring' },
  { value: 'lucide:Shield', label: 'Sécurité' },
  { value: 'lucide:Database', label: 'Base de données' },
  { value: 'lucide:HardDrive', label: 'Stockage' },
  { value: 'lucide:Cpu', label: 'CPU / VM' },
  { value: 'lucide:Wifi', label: 'Réseau / Wi-Fi' },
  { value: 'lucide:Router', label: 'Routeur' },
  { value: 'lucide:Terminal', label: 'SSH / Shell' },
  { value: 'lucide:Webhook', label: 'Webhook' },
  { value: 'lucide:Cloud', label: 'Cloud' },
  { value: 'lucide:Download', label: 'Téléchargements' },
  { value: 'lucide:Film', label: 'Films' },
  { value: 'lucide:Tv', label: 'Séries / TV' },
  { value: 'lucide:Gamepad2', label: 'Gaming' },
  { value: 'lucide:LayoutGrid', label: 'Dashboard' },
  { value: 'lucide:Lock', label: 'Coffre-fort' },
  { value: 'lucide:Radar', label: 'Indexeur' },
  { value: 'lucide:Sparkles', label: 'IA / Demandes' },
];

const LEGACY_AUTO_MATCH_ICONS = new Set([
  '',
  'film',
  'play',
  'sparkles',
  'clapperboard',
  'tv',
  'search',
  'download',
  'cloud',
  'lock',
  'gamepad2',
  'server',
  'globe',
  'activity',
  'layoutgrid',
  'router',
  'wifi',
  'database',
  'cpu',
  'harddrive',
  'shield',
  'radar',
  'terminal',
]);

export const BRAND_ICONS: BrandIconMeta[] = [
  {
    id: 'jellyfin',
    label: 'Jellyfin',
    tintClass:
      'border-violet-500/30 bg-gradient-to-br from-violet-500/15 to-sky-500/15 dark:border-violet-400/30',
    aliases: ['jellyfin'],
    keywords: ['jellyfin'],
    renderSvg: (uid) => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={`jf-${uid}`} x1="4" y1="2" x2="20" y2="21" gradientUnits="userSpaceOnUse">
            <stop stopColor="#AA5CC3" />
            <stop offset="1" stopColor="#00A4DC" />
          </linearGradient>
        </defs>
        <path
          d="M12 2.4c-2.6 0-8.6 10.9-7.4 13.7 1.2 2.7 13.6 2.7 14.8 0C20.6 13.3 14.6 2.4 12 2.4Z"
          fill={`url(#jf-${uid})`}
        />
        <path
          d="M12 8.2c-1.1 0-3.7 4.7-3.2 6 .5 1.2 5.9 1.2 6.4 0 .5-1.3-2.1-6-3.2-6Z"
          fill="#0B1220"
          fillOpacity="0.65"
        />
      </svg>
    ),
  },
  {
    id: 'plex',
    label: 'Plex',
    tintClass:
      'border-amber-500/35 bg-gradient-to-br from-amber-500/20 to-yellow-500/10 dark:border-amber-400/30',
    aliases: ['plex'],
    keywords: ['plex'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#1F222A" />
        <path d="M8.5 5.5h4.3L17.4 12l-4.6 6.5H8.5L13.1 12 8.5 5.5Z" fill="#E5A00D" />
      </svg>
    ),
  },
  {
    id: 'stremio',
    label: 'Stremio',
    tintClass:
      'border-purple-500/35 bg-gradient-to-br from-purple-500/20 to-indigo-600/15 dark:border-purple-400/30',
    aliases: ['stremio', 'stremio-web', 'stremio-server', 'streamio'],
    keywords: ['stremio', 'streamio'],
    renderSvg: (uid) => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={`strem-${uid}`} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
            <stop stopColor="#8A5AAB" />
            <stop offset="1" stopColor="#5E35B1" />
          </linearGradient>
        </defs>
        <path
          d="M12 2.4 21.6 12 12 21.6 2.4 12 12 2.4Z"
          fill={`url(#strem-${uid})`}
        />
        <path
          d="M10.2 8.6v6.8l5.6-3.4-5.6-3.4Z"
          fill="#FFFFFF"
        />
      </svg>
    ),
  },
  {
    id: 'jellyseerr',
    label: 'Jellyseerr / Overseerr',
    tintClass:
      'border-indigo-500/30 bg-gradient-to-br from-indigo-500/15 to-purple-500/15 dark:border-indigo-400/30',
    aliases: ['jellyseerr', 'overseerr', 'seerr'],
    keywords: ['jellyseerr', 'overseerr', 'seerr'],
    renderSvg: (uid) => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={`js-${uid}`} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6366F1" />
            <stop offset="1" stopColor="#A855F7" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="9" fill={`url(#js-${uid})`} fillOpacity="0.22" stroke={`url(#js-${uid})`} strokeWidth="1.75" />
        <path
          d="M12 6.2 13.7 10.3l4.1 1.7-4.1 1.7L12 17.8l-1.7-4.1L6.2 12l4.1-1.7L12 6.2Z"
          fill={`url(#js-${uid})`}
        />
      </svg>
    ),
  },
  {
    id: 'radarr',
    label: 'Radarr',
    tintClass:
      'border-amber-500/35 bg-gradient-to-br from-amber-400/15 to-orange-500/15 dark:border-amber-400/30',
    aliases: ['radarr'],
    keywords: ['radarr'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9.2" fill="#F59E0B" fillOpacity="0.2" stroke="#F59E0B" strokeWidth="1.7" />
        <path d="M9.4 8.2v7.6l6.7-3.8-6.7-3.8Z" fill="#FFC230" stroke="#D97706" strokeWidth="0.9" strokeLinejoin="round" />
        <circle cx="17.3" cy="6.8" r="2.1" fill="#FBBF24" />
      </svg>
    ),
  },
  {
    id: 'sonarr',
    label: 'Sonarr',
    tintClass:
      'border-sky-500/35 bg-gradient-to-br from-sky-500/15 to-blue-500/15 dark:border-sky-400/30',
    aliases: ['sonarr'],
    keywords: ['sonarr'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <rect x="3.2" y="6.2" width="17.6" height="12.2" rx="3" fill="#0EA5E9" fillOpacity="0.2" stroke="#38BDF8" strokeWidth="1.7" />
        <path d="M8.5 3.8 12 6.2l3.5-2.4" stroke="#38BDF8" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7.5 14.3a5.8 5.8 0 0 1 9 0" stroke="#00CCFF" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M9.6 15.8a3 3 0 0 1 4.8 0" stroke="#38BDF8" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="12" cy="11.2" r="1.4" fill="#38BDF8" />
      </svg>
    ),
  },
  {
    id: 'prowlarr',
    label: 'Prowlarr',
    tintClass:
      'border-orange-500/35 bg-gradient-to-br from-orange-500/15 to-rose-500/15 dark:border-orange-400/30',
    aliases: ['prowlarr'],
    keywords: ['prowlarr'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="#F97316" strokeWidth="1.6" strokeDasharray="3.2 2.2" />
        <circle cx="12" cy="12" r="5" fill="#F97316" fillOpacity="0.22" stroke="#FB923C" strokeWidth="1.5" />
        <path d="M12 12 17.5 6.5" stroke="#FB923C" strokeWidth="1.9" strokeLinecap="round" />
        <circle cx="12" cy="12" r="1.8" fill="#F97316" />
      </svg>
    ),
  },
  {
    id: 'qbittorrent',
    label: 'qBittorrent',
    tintClass:
      'border-blue-500/35 bg-gradient-to-br from-blue-500/18 to-sky-500/15 dark:border-blue-400/30',
    aliases: ['qbittorrent', 'qbit'],
    keywords: ['qbittorrent', 'qbit'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9.3" fill="#2563EB" />
        <circle cx="8.9" cy="12.2" r="2.7" stroke="#FFFFFF" strokeWidth="1.7" />
        <path d="M11.6 10v7.1" stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="15.4" cy="12.2" r="2.7" stroke="#93C5FD" strokeWidth="1.7" />
        <path d="M12.7 7v5.2" stroke="#93C5FD" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'nextcloud',
    label: 'Nextcloud',
    tintClass:
      'border-sky-500/35 bg-gradient-to-br from-sky-500/20 to-blue-500/15 dark:border-sky-400/30',
    aliases: ['nextcloud'],
    keywords: ['nextcloud'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="6" fill="#0082C9" />
        <circle cx="12" cy="12" r="3.2" stroke="#FFFFFF" strokeWidth="1.9" />
        <circle cx="6.7" cy="12" r="1.9" stroke="#FFFFFF" strokeWidth="1.7" />
        <circle cx="17.3" cy="12" r="1.9" stroke="#FFFFFF" strokeWidth="1.7" />
      </svg>
    ),
  },
  {
    id: 'vaultwarden',
    label: 'Vaultwarden / Bitwarden',
    tintClass:
      'border-blue-600/35 bg-gradient-to-br from-blue-600/20 to-indigo-500/15 dark:border-blue-400/30',
    aliases: ['vaultwarden', 'bitwarden'],
    keywords: ['vaultwarden', 'bitwarden'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="M12 2.8 4.6 5.4v6.3c0 4.6 3.1 8.4 7.4 9.5 4.3-1.1 7.4-4.9 7.4-9.5V5.4L12 2.8Z"
          fill="#175DDC"
        />
        <path d="M12 5.3v13.2c2.8-1 4.8-3.7 4.8-6.9V6.8L12 5.3Z" fill="#FFFFFF" fillOpacity="0.92" />
      </svg>
    ),
  },
  {
    id: 'pelican',
    label: 'Pelican / Game Panel',
    tintClass:
      'border-emerald-500/35 bg-gradient-to-br from-emerald-500/15 to-teal-500/15 dark:border-emerald-400/30',
    aliases: ['pelican', 'pterodactyl'],
    keywords: ['pelican', 'pterodactyl', 'minecraft'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="M4.5 16.5c1.5-5.8 5.2-10 11.4-11.2-.8 2.3-.3 4.2 1.8 4.8-3 1.4-4.5 3.6-4.7 6.4l6.5 1.1c-2.6 2-5.8 2.9-9.4 2.7-2.4-.1-4.3-1.3-5.6-3.8Z"
          fill="#10B981"
        />
        <circle cx="14.2" cy="8.2" r="1" fill="#064E3B" />
      </svg>
    ),
  },
  {
    id: 'proxmox',
    label: 'Proxmox VE',
    tintClass:
      'border-orange-500/35 bg-gradient-to-br from-orange-500/20 to-amber-500/10 dark:border-orange-400/30',
    aliases: ['proxmox', 'pve'],
    keywords: ['proxmox', 'pve'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="m6.2 6.2 5.8 5.8-5.8 5.8"
          stroke="#E57000"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="m17.8 6.2-5.8 5.8 5.8 5.8"
          stroke="#E57000"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M9.1 4.2 12 7.1l2.9-2.9" stroke="#FB923C" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.1 19.8 12 16.9l2.9 2.9" stroke="#FB923C" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'zoraxy',
    label: 'Zoraxy',
    tintClass:
      'border-teal-500/35 bg-gradient-to-br from-teal-500/20 to-emerald-500/15 dark:border-teal-400/30',
    aliases: ['zoraxy', 'zoraxy-tunnel'],
    keywords: ['zoraxy'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.2" fill="#0F172A" stroke="#14B8A6" strokeWidth="1.5" />
        <path
          d="M7 7.5h10l-9.5 9H17"
          stroke="#2DD4BF"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="17.2" cy="7.5" r="1.4" fill="#38BDF8" />
        <circle cx="6.8" cy="16.5" r="1.4" fill="#38BDF8" />
      </svg>
    ),
  },
  {
    id: 'npm',
    label: 'Nginx Proxy Manager',
    tintClass:
      'border-rose-500/30 bg-gradient-to-br from-orange-500/15 to-teal-500/15 dark:border-orange-400/30',
    aliases: ['npm', 'nginx', 'nginxproxymanager', 'nginx-proxy-manager'],
    keywords: ['nginx', 'proxy manager'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="M12 2.8 20 7.4v9.2L12 21.2l-8-4.6V7.4L12 2.8Z"
          fill="#0D9488"
          fillOpacity="0.2"
          stroke="#14B8A6"
          strokeWidth="1.7"
        />
        <path d="M9 15.5v-7l6 7v-7" stroke="#F15A24" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'uptime-kuma',
    label: 'Uptime Kuma',
    tintClass:
      'border-emerald-500/35 bg-gradient-to-br from-emerald-500/20 to-green-500/15 dark:border-emerald-400/30',
    aliases: ['uptime-kuma', 'uptimekuma', 'kuma'],
    keywords: ['uptime', 'kuma'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9.3" fill="#10B981" />
        <path
          d="M5.5 12.5h3l1.7-4.1 2.7 7.1 1.9-3.6h3.7"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'homepage',
    label: 'Homepage',
    tintClass:
      'border-indigo-500/30 bg-gradient-to-br from-indigo-500/15 to-sky-500/15 dark:border-indigo-400/30',
    aliases: ['homepage', 'dashy', 'homarr'],
    keywords: ['homepage', 'homarr', 'dashy'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <rect x="3.5" y="3.5" width="7.2" height="7.2" rx="2" fill="#6366F1" />
        <rect x="13.3" y="3.5" width="7.2" height="7.2" rx="2" fill="#38BDF8" />
        <rect x="3.5" y="13.3" width="7.2" height="7.2" rx="2" fill="#38BDF8" />
        <rect x="13.3" y="13.3" width="7.2" height="7.2" rx="2" fill="#818CF8" />
      </svg>
    ),
  },
  {
    id: 'freebox',
    label: 'Freebox OS',
    tintClass:
      'border-rose-500/35 bg-gradient-to-br from-rose-500/20 to-red-500/15 dark:border-rose-400/30',
    aliases: ['freebox', 'freeboxos'],
    keywords: ['freebox'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="#E11D48" />
        <path
          d="M14.8 7.4c-1.8 0-2.8 1-3 2.9l-.8 6.5M8.7 11.4h5.1"
          stroke="#FFFFFF"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'adguard',
    label: 'AdGuard Home',
    tintClass:
      'border-emerald-500/35 bg-gradient-to-br from-emerald-500/18 to-lime-500/10 dark:border-emerald-400/30',
    aliases: ['adguard', 'adguardhome', 'adguard-home'],
    keywords: ['adguard'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="M12 3 4.8 5.8v5.9c0 4.5 3.1 8.1 7.2 9.3 4.1-1.2 7.2-4.8 7.2-9.3V5.8L12 3Z"
          fill="#67B279"
        />
        <path d="m8.7 12.1 2.2 2.3 4.6-4.7" stroke="#FFFFFF" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'pihole',
    label: 'Pi-hole',
    tintClass:
      'border-red-500/35 bg-gradient-to-br from-red-500/20 to-rose-500/15 dark:border-red-400/30',
    aliases: ['pihole', 'pi-hole'],
    keywords: ['pihole', 'pi-hole'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <circle cx="12" cy="13.2" r="6.8" fill="#EF4444" />
        <path d="M9 5.5c1.5 0 2.7.9 3 2.2.3-1.3 1.5-2.2 3-2.2-1 1.6-2 2.3-3 2.4-1-.1-2-.8-3-2.4Z" fill="#22C55E" />
        <circle cx="12" cy="13.2" r="2.7" fill="#991B1B" />
      </svg>
    ),
  },
  {
    id: 'home-assistant',
    label: 'Home Assistant',
    tintClass:
      'border-sky-500/35 bg-gradient-to-br from-sky-500/20 to-blue-500/15 dark:border-sky-400/30',
    aliases: ['home-assistant', 'homeassistant', 'hass'],
    keywords: ['home assistant', 'home-assistant', 'hass'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path d="m12 3.4 8 7.2v9a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 19.6v-9l8-7.2Z" fill="#18BCF2" />
        <path d="M12 9.2v8.4M9 13.3l3-2.4 3 2.4" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="8.4" r="1.1" fill="#FFFFFF" />
      </svg>
    ),
  },
  {
    id: 'grafana',
    label: 'Grafana',
    tintClass:
      'border-orange-500/35 bg-gradient-to-br from-orange-500/20 to-yellow-500/15 dark:border-orange-400/30',
    aliases: ['grafana', 'prometheus'],
    keywords: ['grafana'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.2" stroke="#F46800" strokeWidth="2.1" strokeDasharray="4 2" />
        <circle cx="12" cy="12" r="4.5" stroke="#F59E0B" strokeWidth="2" />
        <circle cx="12" cy="12" r="1.8" fill="#F46800" />
      </svg>
    ),
  },
  {
    id: 'tailscale',
    label: 'Tailscale',
    tintClass:
      'border-slate-500/30 bg-gradient-to-br from-slate-500/15 to-cyan-500/10 dark:border-slate-400/30',
    aliases: ['tailscale', 'headscale'],
    keywords: ['tailscale', 'headscale'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <circle cx="6.5" cy="7" r="1.9" fill="#94A3B8" />
        <circle cx="12" cy="7" r="1.9" fill="#94A3B8" />
        <circle cx="17.5" cy="7" r="1.9" fill="#94A3B8" />
        <circle cx="6.5" cy="12.2" r="1.9" fill="#38BDF8" />
        <circle cx="12" cy="12.2" r="1.9" fill="#38BDF8" />
        <circle cx="17.5" cy="12.2" r="1.9" fill="#38BDF8" />
        <circle cx="6.5" cy="17.4" r="1.9" fill="#94A3B8" />
        <circle cx="12" cy="17.4" r="1.9" fill="#38BDF8" />
        <circle cx="17.5" cy="17.4" r="1.9" fill="#94A3B8" />
      </svg>
    ),
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    tintClass:
      'border-amber-500/35 bg-gradient-to-br from-orange-500/20 to-amber-500/15 dark:border-amber-400/30',
    aliases: ['cloudflare', 'cloudflared'],
    keywords: ['cloudflare', 'tunnel'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="M17.2 17.5H6.9a3.4 3.4 0 0 1-.4-6.8 4.9 4.9 0 0 1 9.4-1.2 3.8 3.8 0 0 1 1.3 8Z"
          fill="#F38020"
        />
        <path d="M18.3 17.5h1.5a2.1 2.1 0 0 0 0-4.2h-1.1" stroke="#FDBA74" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'docker',
    label: 'Docker',
    tintClass:
      'border-sky-500/35 bg-gradient-to-br from-sky-500/20 to-blue-500/15 dark:border-sky-400/30',
    aliases: ['docker'],
    keywords: ['docker', 'compose'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <rect x="4" y="9" width="3" height="2.7" rx="0.5" fill="#2496ED" />
        <rect x="7.8" y="9" width="3" height="2.7" rx="0.5" fill="#2496ED" />
        <rect x="11.6" y="9" width="3" height="2.7" rx="0.5" fill="#2496ED" />
        <rect x="7.8" y="5.6" width="3" height="2.7" rx="0.5" fill="#38BDF8" />
        <rect x="11.6" y="5.6" width="3" height="2.7" rx="0.5" fill="#38BDF8" />
        <path
          d="M3.2 12.7h13.7c1.6 0 2.8-.6 3.5-1.7.7.6 1 1.5.5 2.5-1.2 2.9-4.1 4.9-8.5 4.9-5.6 0-9.2-2.2-9.2-5.7Z"
          fill="#0284C7"
        />
      </svg>
    ),
  },
  {
    id: 'portainer',
    label: 'Portainer',
    tintClass:
      'border-sky-500/35 bg-gradient-to-br from-sky-500/20 to-blue-500/15 dark:border-sky-400/30',
    aliases: ['portainer'],
    keywords: ['portainer'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="5.3" stroke="#13BEF9" strokeWidth="1.9" />
        <path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7" stroke="#0EA5E9" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="12" cy="12" r="1.9" fill="#13BEF9" />
      </svg>
    ),
  },
  {
    id: 'immich',
    label: 'Immich',
    tintClass:
      'border-fuchsia-500/30 bg-gradient-to-br from-amber-500/15 via-rose-500/15 to-indigo-500/15 dark:border-fuchsia-400/30',
    aliases: ['immich'],
    keywords: ['immich'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <circle cx="12" cy="7.2" r="3.4" fill="#F43F5E" fillOpacity="0.9" />
        <circle cx="16.8" cy="12" r="3.4" fill="#F59E0B" fillOpacity="0.9" />
        <circle cx="12" cy="16.8" r="3.4" fill="#10B981" fillOpacity="0.9" />
        <circle cx="7.2" cy="12" r="3.4" fill="#6366F1" fillOpacity="0.9" />
        <circle cx="12" cy="12" r="2.2" fill="#FFFFFF" />
      </svg>
    ),
  },
  {
    id: 'traefik',
    label: 'Traefik',
    tintClass:
      'border-cyan-500/35 bg-gradient-to-br from-cyan-500/20 to-blue-500/15 dark:border-cyan-400/30',
    aliases: ['traefik'],
    keywords: ['traefik'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="M12 3.2 19.6 7.6v8.8L12 20.8l-7.6-4.4V7.6L12 3.2Z"
          fill="#24A1C1"
          fillOpacity="0.2"
          stroke="#24A1C1"
          strokeWidth="1.7"
        />
        <path d="M8.5 9.5h7M12 9.5v6.8" stroke="#24A1C1" strokeWidth="2.1" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'authentik',
    label: 'Authentik',
    tintClass:
      'border-orange-500/35 bg-gradient-to-br from-orange-500/20 to-red-500/15 dark:border-orange-400/30',
    aliases: ['authentik', 'authelia'],
    keywords: ['authentik', 'authelia', 'sso'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" fill="#FD4B2D" />
        <path d="m8.2 16.5 3.8-9 3.8 9M9.6 13.7h4.8" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'gitea',
    label: 'Gitea / Forgejo',
    tintClass:
      'border-emerald-500/35 bg-gradient-to-br from-emerald-500/20 to-lime-500/15 dark:border-emerald-400/30',
    aliases: ['gitea', 'forgejo', 'gitlab'],
    keywords: ['gitea', 'forgejo', 'gitlab'],
    renderSvg: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path d="M6.5 8h10v6.2a4.8 4.8 0 0 1-4.8 4.8h-.4a4.8 4.8 0 0 1-4.8-4.8V8Z" fill="#609926" />
        <path d="M16.5 9.2h1.6a2.1 2.1 0 0 1 0 4.2h-1.6" stroke="#609926" strokeWidth="1.9" />
        <circle cx="11.5" cy="11.5" r="1.2" fill="#FFFFFF" />
        <circle cx="11.5" cy="15.2" r="1.2" fill="#FFFFFF" />
        <path d="M11.5 11.5v3.7" stroke="#FFFFFF" strokeWidth="1.4" />
      </svg>
    ),
  },
];

const BRAND_BY_ALIAS = new Map<string, BrandIconMeta>();
for (const brand of BRAND_ICONS) {
  BRAND_BY_ALIAS.set(brand.id, brand);
  for (const alias of brand.aliases) {
    BRAND_BY_ALIAS.set(alias.toLowerCase(), brand);
  }
}

export const SERVICE_ICON_OPTIONS: string[] = [
  ...BRAND_ICONS.map((b) => b.id),
  ...GENERIC_ICON_OPTIONS.map((g) => g.value),
];

export interface ServiceIconHint {
  id?: string | null;
  name?: string | null;
  widget?: string | null;
}

export function resolveBrandIcon(
  icon?: string | null,
  hint?: ServiceIconHint
): BrandIconMeta | null {
  const raw = (icon || '').trim();
  if (raw.toLowerCase().startsWith('lucide:')) {
    return null;
  }

  const normalized = raw.toLowerCase();
  const direct = BRAND_BY_ALIAS.get(normalized);
  if (direct) {
    return direct;
  }

  if (LEGACY_AUTO_MATCH_ICONS.has(normalized)) {
    const haystack = `${hint?.id || ''} ${hint?.widget || ''} ${hint?.name || ''}`
      .toLowerCase()
      .trim();
    if (haystack) {
      for (const brand of BRAND_ICONS) {
        if (brand.keywords.some((kw) => haystack.includes(kw))) {
          return brand;
        }
      }
    }
  }

  return null;
}

export function resolveGenericLucideName(icon?: string | null): string {
  const raw = (icon || '').trim();
  const clean = raw.toLowerCase().startsWith('lucide:') ? raw.slice(7) : raw;
  if (GENERIC_LUCIDE_MAP[clean]) {
    return clean;
  }
  const caseMatch = Object.keys(GENERIC_LUCIDE_MAP).find(
    (k) => k.toLowerCase() === clean.toLowerCase()
  );
  return caseMatch || 'Server';
}

export function formatServiceIconLabel(icon?: string | null, hint?: ServiceIconHint): string {
  const brand = resolveBrandIcon(icon, hint);
  if (brand) return brand.label;
  const clean = resolveGenericLucideName(icon);
  const opt = GENERIC_ICON_OPTIONS.find((g) => g.value === `lucide:${clean}`);
  return opt ? opt.label : clean;
}

interface ServiceIconBadgeProps {
  icon?: string | null;
  hint?: ServiceIconHint;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function ServiceIconBadge({
  icon,
  hint,
  size = 'md',
  className = '',
}: ServiceIconBadgeProps) {
  const uid = useId().replace(/:/g, '');
  const brand = resolveBrandIcon(icon, hint);

  const boxSize =
    size === 'sm'
      ? 'h-8 w-8 rounded-lg'
      : size === 'lg'
        ? 'h-12 w-12 rounded-2xl'
        : 'h-10 w-10 rounded-xl';

  if (brand) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center border transition ${boxSize} ${brand.tintClass} ${className}`}
      >
        {brand.renderSvg(uid)}
      </div>
    );
  }

  const lucideKey = resolveGenericLucideName(icon);
  const LucideIcon = GENERIC_LUCIDE_MAP[lucideKey] || Server;
  const iconSize = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-6 w-6' : 'h-5 w-5';

  return (
    <div
      className={`flex shrink-0 items-center justify-center border border-slate-200/90 bg-white/80 text-cyan-600 transition group-hover:border-cyan-500/40 group-hover:bg-cyan-500/10 dark:border-slate-700/80 dark:bg-slate-800/80 dark:text-cyan-400 ${boxSize} ${className}`}
    >
      <LucideIcon className={iconSize} />
    </div>
  );
}

interface ServiceIconPickerProps {
  value: string;
  hint?: ServiceIconHint;
  onChange: (nextIcon: string) => void;
}

export function ServiceIconPicker({ value, hint, onChange }: ServiceIconPickerProps) {
  const activeBrand = resolveBrandIcon(value, hint);
  const activeGeneric = activeBrand ? null : `lucide:${resolveGenericLucideName(value)}`;

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-slate-600 dark:text-slate-300">
          <span>Icônes dédiées Homelab</span>
          <span className="font-mono text-[10px] text-cyan-600 dark:text-cyan-300">
            {formatServiceIconLabel(value, hint)}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-7">
          {BRAND_ICONS.map((brand) => {
            const selected = activeBrand?.id === brand.id;
            return (
              <button
                key={brand.id}
                type="button"
                onClick={() => onChange(brand.id)}
                title={brand.label}
                aria-label={brand.label}
                className={`flex flex-col items-center gap-1 rounded-xl border p-1.5 transition ${
                  selected
                    ? 'border-cyan-500 bg-cyan-500/15 ring-2 ring-cyan-500/30 dark:border-cyan-400'
                    : 'border-slate-200/80 bg-white/50 hover:border-cyan-400/50 dark:border-white/10 dark:bg-white/[0.03]'
                }`}
              >
                <ServiceIconBadge icon={brand.id} size="sm" />
                <span className="w-full truncate text-center text-[9px] font-medium text-slate-700 dark:text-slate-300">
                  {brand.label.split('/')[0].trim()}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
          Icônes génériques
        </div>
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
          {GENERIC_ICON_OPTIONS.map((opt) => {
            const selected = !activeBrand && activeGeneric === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(opt.value)}
                title={opt.label}
                aria-label={opt.label}
                className={`flex items-center justify-center rounded-xl border p-1.5 transition ${
                  selected
                    ? 'border-cyan-500 bg-cyan-500/15 ring-2 ring-cyan-500/30 dark:border-cyan-400'
                    : 'border-slate-200/80 bg-white/50 hover:border-cyan-400/50 dark:border-white/10 dark:bg-white/[0.03]'
                }`}
              >
                <ServiceIconBadge icon={opt.value} size="sm" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
