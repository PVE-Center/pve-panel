import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BellRing,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  HardDrive,
  KeyRound,
  Layers,
  Loader2,
  Monitor,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Sun,
  Trash2,
  Tv,
  Wifi,
  Wrench,
  X,
} from 'lucide-react';
import { getServerUrl } from '../lib/apiClient';
import {
  ACCENT_PRESETS,
  applyAccentPreset,
  applyDensityMode,
  applyGlassIntensity,
  getAccentPreset,
  getDensityMode,
  getGlassIntensity,
  type AccentPreset,
  type DensityMode,
  type GlassIntensity,
  type ThemePreference,
} from '../lib/theme';
import { QrCodeView } from './NotificationsModal';
import { ServiceIconBadge, ServiceIconPicker } from './ServiceIcon';
import type {
  SetupCategoryConfig,
  SetupConfigUpdateRequest,
  SetupConfigUpdateResponse,
  SetupEnvConfig,
  SetupServiceConfig,
  SetupStatusResponse,
  SetupTestServiceName,
  SetupTestServiceRequest,
  SetupTestServiceResponse,
  StorageMountConfig,
} from '../types';

type SetupTab = 'appearance' | 'proxmox' | 'media' | 'services' | 'storage' | 'apps';

interface SetupEnvFormState {
  dev_auth_bypass: boolean;
  allowed_tailscale_users: string;
  protected_owner_username: string;
  pve_host: string;
  pve_node: string;
  pve_token_id: string;
  pve_token_secret: string;
  pve_verify_ssl: boolean;
  panel_self_vmid: string;
  jellyfin_url: string;
  jellyfin_api_key: string;
  jellyseerr_url: string;
  jellyseerr_api_key: string;
  plex_url: string;
  plex_token: string;
  stremio_url: string;
  stremio_username: string;
  stremio_password: string;
  radarr_url: string;
  radarr_api_key: string;
  sonarr_url: string;
  sonarr_api_key: string;
  prowlarr_url: string;
  prowlarr_api_key: string;
  qbit_url: string;
  qbit_username: string;
  qbit_password: string;
}

type SecretFlagMap = Record<
  | 'pve_token_secret_set'
  | 'jellyfin_api_key_set'
  | 'jellyseerr_api_key_set'
  | 'plex_token_set'
  | 'stremio_password_set'
  | 'radarr_api_key_set'
  | 'sonarr_api_key_set'
  | 'prowlarr_api_key_set'
  | 'qbit_password_set',
  boolean
>;

interface TestState {
  testing: boolean;
  result?: SetupTestServiceResponse;
  error?: string;
}

interface MediaServiceDescriptor {
  key: SetupTestServiceName;
  label: string;
  subtitle: string;
  urlKey: keyof SetupEnvFormState;
  urlPlaceholder: string;
  secretKey: keyof SetupEnvFormState;
  secretSetKey: keyof SecretFlagMap;
  secretLabel: string;
  usernameKey?: keyof SetupEnvFormState;
}

const MEDIA_SERVICES: MediaServiceDescriptor[] = [
  {
    key: 'jellyfin',
    label: 'Jellyfin',
    subtitle: 'Streaming média & gestion utilisateurs',
    urlKey: 'jellyfin_url',
    urlPlaceholder: 'http://192.168.1.26:8096',
    secretKey: 'jellyfin_api_key',
    secretSetKey: 'jellyfin_api_key_set',
    secretLabel: 'Clé API Jellyfin',
  },
  {
    key: 'jellyseerr',
    label: 'Jellyseerr',
    subtitle: 'Demandes films & séries',
    urlKey: 'jellyseerr_url',
    urlPlaceholder: 'http://192.168.1.31:5055',
    secretKey: 'jellyseerr_api_key',
    secretSetKey: 'jellyseerr_api_key_set',
    secretLabel: 'Clé API Jellyseerr',
  },
  {
    key: 'plex',
    label: 'Plex Media Server',
    subtitle: 'Bibliothèque & flux actifs',
    urlKey: 'plex_url',
    urlPlaceholder: 'http://192.168.1.30:32400',
    secretKey: 'plex_token',
    secretSetKey: 'plex_token_set',
    secretLabel: 'X-Plex-Token',
  },
  {
    key: 'stremio',
    label: 'Stremio (Web + Server)',
    subtitle: 'Streaming Web tout-en-un & VAAPI',
    urlKey: 'stremio_url',
    urlPlaceholder: 'http://192.168.1.33:8080',
    secretKey: 'stremio_password',
    secretSetKey: 'stremio_password_set',
    secretLabel: 'Mot de passe Basic Auth (optionnel)',
    usernameKey: 'stremio_username',
  },
  {
    key: 'radarr',
    label: 'Radarr',
    subtitle: 'Automatisation des films',
    urlKey: 'radarr_url',
    urlPlaceholder: 'http://192.168.1.27:7878',
    secretKey: 'radarr_api_key',
    secretSetKey: 'radarr_api_key_set',
    secretLabel: 'Clé API Radarr',
  },
  {
    key: 'sonarr',
    label: 'Sonarr',
    subtitle: 'Automatisation des séries TV',
    urlKey: 'sonarr_url',
    urlPlaceholder: 'http://192.168.1.28:8989',
    secretKey: 'sonarr_api_key',
    secretSetKey: 'sonarr_api_key_set',
    secretLabel: 'Clé API Sonarr',
  },
  {
    key: 'prowlarr',
    label: 'Prowlarr',
    subtitle: 'Indexeurs centralisés',
    urlKey: 'prowlarr_url',
    urlPlaceholder: 'http://192.168.1.29:9696',
    secretKey: 'prowlarr_api_key',
    secretSetKey: 'prowlarr_api_key_set',
    secretLabel: 'Clé API Prowlarr',
  },
  {
    key: 'qbittorrent',
    label: 'qBittorrent',
    subtitle: 'Client BitTorrent & limiteur de débit',
    urlKey: 'qbit_url',
    urlPlaceholder: 'http://192.168.1.32:8090',
    secretKey: 'qbit_password',
    secretSetKey: 'qbit_password_set',
    secretLabel: 'Mot de passe WebUI',
    usernameKey: 'qbit_username',
  },
];

const WIDGET_OPTIONS = [
  { value: '', label: 'Aucun widget' },
  { value: 'jellyfin', label: 'Widget Jellyfin' },
  { value: 'plex', label: 'Widget Plex' },
  { value: 'stremio', label: 'Widget Stremio' },
  { value: 'radarr', label: 'Widget Radarr' },
  { value: 'sonarr', label: 'Widget Sonarr' },
  { value: 'prowlarr', label: 'Widget Prowlarr' },
  { value: 'qbittorrent', label: 'Widget qBittorrent' },
];

const INPUT_CLASS = 'liquid-input';

function createEmptyEnvForm(): SetupEnvFormState {
  return {
    dev_auth_bypass: false,
    allowed_tailscale_users: '',
    protected_owner_username: 'admin',
    pve_host: '',
    pve_node: 'pve',
    pve_token_id: 'root@pam!pve-panel',
    pve_token_secret: '',
    pve_verify_ssl: false,
    panel_self_vmid: '116',
    jellyfin_url: '',
    jellyfin_api_key: '',
    jellyseerr_url: '',
    jellyseerr_api_key: '',
    plex_url: '',
    plex_token: '',
    stremio_url: '',
    stremio_username: 'admin',
    stremio_password: '',
    radarr_url: '',
    radarr_api_key: '',
    sonarr_url: '',
    sonarr_api_key: '',
    prowlarr_url: '',
    prowlarr_api_key: '',
    qbit_url: '',
    qbit_username: 'admin',
    qbit_password: '',
  };
}

function createEmptySecretFlags(): SecretFlagMap {
  return {
    pve_token_secret_set: false,
    jellyfin_api_key_set: false,
    jellyseerr_api_key_set: false,
    plex_token_set: false,
    stremio_password_set: false,
    radarr_api_key_set: false,
    sonarr_api_key_set: false,
    prowlarr_api_key_set: false,
    qbit_password_set: false,
  };
}

function envToFormState(env: SetupEnvConfig): SetupEnvFormState {
  return {
    dev_auth_bypass: Boolean(env.dev_auth_bypass),
    allowed_tailscale_users: env.allowed_tailscale_users || '',
    protected_owner_username: env.protected_owner_username || 'admin',
    pve_host: env.pve_host || '',
    pve_node: env.pve_node || 'pve',
    pve_token_id: env.pve_token_id || '',
    pve_token_secret: '',
    pve_verify_ssl: Boolean(env.pve_verify_ssl),
    panel_self_vmid: String(env.panel_self_vmid ?? 116),
    jellyfin_url: env.jellyfin_url || '',
    jellyfin_api_key: '',
    jellyseerr_url: env.jellyseerr_url || '',
    jellyseerr_api_key: '',
    plex_url: env.plex_url || '',
    plex_token: '',
    stremio_url: env.stremio_url || '',
    stremio_username: env.stremio_username || 'admin',
    stremio_password: '',
    radarr_url: env.radarr_url || '',
    radarr_api_key: '',
    sonarr_url: env.sonarr_url || '',
    sonarr_api_key: '',
    prowlarr_url: env.prowlarr_url || '',
    prowlarr_api_key: '',
    qbit_url: env.qbit_url || '',
    qbit_username: env.qbit_username || '',
    qbit_password: '',
  };
}

function extractSecretFlags(env: SetupEnvConfig): SecretFlagMap {
  return {
    pve_token_secret_set: Boolean(env.pve_token_secret_set),
    jellyfin_api_key_set: Boolean(env.jellyfin_api_key_set),
    jellyseerr_api_key_set: Boolean(env.jellyseerr_api_key_set),
    plex_token_set: Boolean(env.plex_token_set),
    stremio_password_set: Boolean(env.stremio_password_set),
    radarr_api_key_set: Boolean(env.radarr_api_key_set),
    sonarr_api_key_set: Boolean(env.sonarr_api_key_set),
    prowlarr_api_key_set: Boolean(env.prowlarr_api_key_set),
    qbit_password_set: Boolean(env.qbit_password_set),
  };
}

function slugifyId(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function SecretInput({
  id,
  label,
  value,
  isSet,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  isSet: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
          <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
          <span>{label}</span>
        </label>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            isSet
              ? 'border border-emerald-400/30 bg-emerald-500/15 text-emerald-200'
              : 'border border-white/10 bg-white/[0.06] text-slate-400'
          }`}
        >
          {isSet ? 'Défini' : 'Non défini'}
        </span>
      </div>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            isSet
              ? 'Déjà défini — laisser vide pour conserver'
              : placeholder || 'Saisir le secret / token'
          }
          className={`${INPUT_CLASS} pr-10 font-mono text-xs`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Masquer' : 'Afficher'}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 transition hover:text-white"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function TestFeedbackBadge({ state }: { state?: TestState }) {
  if (!state) return null;
  if (state.testing) {
    return (
      <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span>Test de connexion en cours…</span>
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" />
        <span>{state.error}</span>
      </div>
    );
  }
  if (!state.result) return null;

  const { ok, message, latency_ms } = state.result;
  return (
    <div
      className={`mt-2.5 flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
        ok
          ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
          : 'border-rose-400/30 bg-rose-500/10 text-rose-200'
      }`}
    >
      <div className="flex min-w-0 items-start gap-2">
        {ok ? (
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
        ) : (
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" />
        )}
        <span className="break-words">{message}</span>
      </div>
      {latency_ms !== null && (
        <span className="shrink-0 rounded-full bg-black/30 px-2 py-0.5 font-mono text-[10px] font-semibold">
          {Math.round(latency_ms)} ms
        </span>
      )}
    </div>
  );
}

interface SetupWizardModalProps {
  open: boolean;
  initialStatus?: SetupStatusResponse | null;
  theme?: ThemePreference;
  onThemeChange?: (theme: ThemePreference) => void;
  onOpenNotifications?: () => void;
  onOpenYamlEditor?: () => void;
  onOpenServerConfig?: () => void;
  onOpenOnboarding?: () => void;
  onClose: () => void;
  onApplied: (message?: string) => void;
}

export function SetupWizardModal({
  open,
  initialStatus,
  theme = 'system',
  onThemeChange,
  onOpenNotifications,
  onOpenYamlEditor,
  onOpenServerConfig,
  onOpenOnboarding,
  onClose,
  onApplied,
}: SetupWizardModalProps) {
  const [activeTab, setActiveTab] = useState<SetupTab>('appearance');
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [accentPreset, setAccentPreset] = useState<AccentPreset>(() => getAccentPreset());
  const [glassIntensity, setGlassIntensity] = useState<GlassIntensity>(() => getGlassIntensity());
  const [densityMode, setDensityMode] = useState<DensityMode>(() => getDensityMode());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [isConfigured, setIsConfigured] = useState(false);
  const [tailscaleUrl, setTailscaleUrl] = useState('');
  const [pairingDeepLink, setPairingDeepLink] = useState('');
  const [form, setForm] = useState<SetupEnvFormState>(createEmptyEnvForm);
  const [secretFlags, setSecretFlags] = useState<SecretFlagMap>(createEmptySecretFlags);
  const [categories, setCategories] = useState<SetupCategoryConfig[]>([]);
  const [storageMounts, setStorageMounts] = useState<StorageMountConfig[]>([]);
  const [expandedServiceKey, setExpandedServiceKey] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [copiedKey, setCopiedKey] = useState<'url' | 'deeplink' | null>(null);

  const hydrateFromStatus = useCallback((data: SetupStatusResponse) => {
    setIsConfigured(Boolean(data.is_configured));
    setTailscaleUrl(data.tailscale_url || '');
    setPairingDeepLink(data.pairing_deep_link || '');
    setForm(envToFormState(data.env));
    setSecretFlags(extractSecretFlags(data.env));
    setCategories(
      (data.categories || []).map((cat) => ({
        name: cat.name,
        services: (cat.services || []).map((svc) => ({ ...svc })),
      }))
    );
    setStorageMounts((data.storage_mounts || []).map((m) => ({ ...m })));
  }, []);

  const loadSetupStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const resp = await fetch('/api/setup/status');
      if (!resp.ok) {
        const errData = (await resp.json().catch(() => ({}))) as { detail?: string };
        throw new Error(errData.detail || `Erreur HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as SetupStatusResponse;
      hydrateFromStatus(data);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Impossible de charger la configuration du serveur.'
      );
    } finally {
      setLoading(false);
    }
  }, [hydrateFromStatus]);

  const wasOpenRef = useRef(false);
  const initialStatusRef = useRef(initialStatus);
  initialStatusRef.current = initialStatus;

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      setSaveFeedback(null);
      setTests({});
      if (initialStatusRef.current) {
        hydrateFromStatus(initialStatusRef.current);
      }
      void loadSetupStatus();
    } else if (!open) {
      wasOpenRef.current = false;
    }
  }, [open, hydrateFromStatus, loadSetupStatus]);

  if (!open) return null;

  const updateForm = <K extends keyof SetupEnvFormState>(
    key: K,
    value: SetupEnvFormState[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const runServiceTest = async (
    service: SetupTestServiceName,
    payload: Omit<SetupTestServiceRequest, 'service'>
  ) => {
    setTests((prev) => ({ ...prev, [service]: { testing: true } }));
    try {
      const resp = await fetch('/api/setup/test-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service, ...payload }),
      });
      const data = (await resp.json().catch(() => ({}))) as Partial<SetupTestServiceResponse> & {
        detail?: string;
      };
      if (!resp.ok) {
        throw new Error(data.detail || `Erreur HTTP ${resp.status}`);
      }
      setTests((prev) => ({
        ...prev,
        [service]: {
          testing: false,
          result: {
            ok: Boolean(data.ok),
            service: data.service || service,
            message: data.message || (data.ok ? 'Connexion réussie' : 'Échec de connexion'),
            latency_ms: typeof data.latency_ms === 'number' ? data.latency_ms : null,
          },
        },
      }));
    } catch (err) {
      setTests((prev) => ({
        ...prev,
        [service]: {
          testing: false,
          error: err instanceof Error ? err.message : 'Erreur lors du test.',
        },
      }));
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    setSaveFeedback(null);
    try {
      const parsedVmid = Number.parseInt(form.panel_self_vmid, 10);
      const cleanedCategories: SetupCategoryConfig[] = categories
        .map((cat) => ({
          name: cat.name.trim() || 'Services',
          services: cat.services.map((svc) => {
            const cleanSvc: SetupServiceConfig = {
              id: (svc.id.trim() || slugifyId(svc.name) || `svc-${Date.now()}`),
              name: svc.name.trim() || 'Nouveau service',
              description: svc.description.trim(),
              url: svc.url.trim(),
              icon: svc.icon.trim() || 'Server',
            };
            if (svc.ping_url?.trim()) cleanSvc.ping_url = svc.ping_url.trim();
            if (svc.widget?.trim()) cleanSvc.widget = svc.widget.trim();
            return cleanSvc;
          }),
        }))
        .filter((cat) => cat.name.length > 0);

      const cleanedMounts: StorageMountConfig[] = storageMounts
        .filter((m) => m.mount.trim() || m.subpath.trim() || m.label.trim())
        .map((m) => {
          const subpath =
            m.subpath.trim() || m.mount.trim().replace(/^\/mnt\/+/, '').replace(/^\/+/, '');
          return {
            mount: m.mount.trim() || (subpath ? `/mnt/${subpath}` : ''),
            subpath,
            wwn: m.wwn.trim(),
            label: m.label.trim() || subpath || 'Disque',
          };
        });

      const payload: SetupConfigUpdateRequest = {
        env: {
          dev_auth_bypass: form.dev_auth_bypass,
          allowed_tailscale_users: form.allowed_tailscale_users.trim(),
          protected_owner_username: form.protected_owner_username.trim() || 'admin',
          pve_host: form.pve_host.trim(),
          pve_node: form.pve_node.trim(),
          pve_token_id: form.pve_token_id.trim(),
          pve_token_secret: form.pve_token_secret,
          pve_verify_ssl: form.pve_verify_ssl,
          panel_self_vmid: Number.isFinite(parsedVmid) && parsedVmid > 0 ? parsedVmid : 116,
          jellyfin_url: form.jellyfin_url.trim(),
          jellyfin_api_key: form.jellyfin_api_key,
          jellyseerr_url: form.jellyseerr_url.trim(),
          jellyseerr_api_key: form.jellyseerr_api_key,
          plex_url: form.plex_url.trim(),
          plex_token: form.plex_token,
          stremio_url: form.stremio_url.trim(),
          stremio_username: form.stremio_username.trim(),
          stremio_password: form.stremio_password,
          radarr_url: form.radarr_url.trim(),
          radarr_api_key: form.radarr_api_key,
          sonarr_url: form.sonarr_url.trim(),
          sonarr_api_key: form.sonarr_api_key,
          prowlarr_url: form.prowlarr_url.trim(),
          prowlarr_api_key: form.prowlarr_api_key,
          qbit_url: form.qbit_url.trim(),
          qbit_username: form.qbit_username.trim(),
          qbit_password: form.qbit_password,
        },
        categories: cleanedCategories,
        storage_mounts: cleanedMounts,
      };

      const resp = await fetch('/api/setup/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await resp.json().catch(() => ({}))) as Partial<SetupConfigUpdateResponse> & {
        detail?: string;
      };
      if (!resp.ok || data.ok === false) {
        throw new Error(data.detail || data.message || `Erreur HTTP ${resp.status}`);
      }

      setIsConfigured(Boolean(data.is_configured));
      setSaveFeedback({
        type: 'success',
        text: data.message || 'Configuration enregistrée et appliquée à chaud.',
      });
      onApplied(data.message || 'Configuration enregistrée et appliquée à chaud.');
    } catch (err) {
      setSaveFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Échec de l’enregistrement.',
      });
    } finally {
      setSaving(false);
    }
  };

  const addCategory = () => {
    const newIndex = categories.length;
    setCategories((prev) => [...prev, { name: 'Nouvelle catégorie', services: [] }]);
    setExpandedServiceKey(`${newIndex}-0`);
  };

  const removeCategory = (catIdx: number) => {
    setCategories((prev) => prev.filter((_, idx) => idx !== catIdx));
  };

  const updateCategoryName = (catIdx: number, name: string) => {
    setCategories((prev) =>
      prev.map((cat, idx) => (idx === catIdx ? { ...cat, name } : cat))
    );
  };

  const addService = (catIdx: number) => {
    const newSvcIdx = categories[catIdx]?.services.length ?? 0;
    const newService: SetupServiceConfig = {
      id: `service-${Date.now().toString().slice(-4)}`,
      name: 'Nouveau service',
      description: '',
      url: 'https://',
      ping_url: '',
      icon: 'Server',
      widget: '',
    };
    setCategories((prev) =>
      prev.map((cat, idx) =>
        idx === catIdx ? { ...cat, services: [...cat.services, newService] } : cat
      )
    );
    setExpandedServiceKey(`${catIdx}-${newSvcIdx}`);
  };

  const updateService = (
    catIdx: number,
    svcIdx: number,
    patch: Partial<SetupServiceConfig>
  ) => {
    setCategories((prev) =>
      prev.map((cat, idx) =>
        idx === catIdx
          ? {
              ...cat,
              services: cat.services.map((svc, sIdx) =>
                sIdx === svcIdx ? { ...svc, ...patch } : svc
              ),
            }
          : cat
      )
    );
  };

  const removeService = (catIdx: number, svcIdx: number) => {
    setCategories((prev) =>
      prev.map((cat, idx) =>
        idx === catIdx
          ? { ...cat, services: cat.services.filter((_, sIdx) => sIdx !== svcIdx) }
          : cat
      )
    );
  };

  const addStorageMount = () => {
    const nextNum = storageMounts.length + 1;
    setStorageMounts((prev) => [
      ...prev,
      {
        mount: `/mnt/disk${nextNum}`,
        subpath: `disk${nextNum}`,
        wwn: '',
        label: `Disque ${nextNum}`,
      },
    ]);
  };

  const updateStorageMount = (index: number, patch: Partial<StorageMountConfig>) => {
    setStorageMounts((prev) =>
      prev.map((m, idx) => (idx === index ? { ...m, ...patch } : m))
    );
  };

  const removeStorageMount = (index: number) => {
    setStorageMounts((prev) => prev.filter((_, idx) => idx !== index));
  };

  const detectedPanelUrl =
    tailscaleUrl ||
    getServerUrl() ||
    (typeof window !== 'undefined' ? window.location.origin : '');

  const computedDeepLink =
    tailscaleUrl && pairingDeepLink
      ? pairingDeepLink
      : detectedPanelUrl
        ? `pvecenter://connect?url=${encodeURIComponent(detectedPanelUrl)}&name=${encodeURIComponent(form.pve_node.trim() || 'PVE Center')}`
        : '';

  const handleCopy = async (target: 'url' | 'deeplink', value: string) => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopiedKey(target);
      window.setTimeout(() => setCopiedKey(null), 2200);
    }
  };

  const handleSelectAccent = (preset: AccentPreset) => {
    setAccentPreset(preset);
    applyAccentPreset(preset);
  };

  const handleSelectGlass = (next: GlassIntensity) => {
    setGlassIntensity(next);
    applyGlassIntensity(next);
  };

  const handleSelectDensity = (next: DensityMode) => {
    setDensityMode(next);
    applyDensityMode(next);
  };

  interface SidebarNavItem {
    id: SetupTab;
    group: 'PRÉFÉRENCES' | 'INFRASTRUCTURE' | 'CONNECTIVITÉ';
    label: string;
    subtitle: string;
    icon: typeof Server;
    iconBg: string;
    keywords: string;
  }

  const navItems: SidebarNavItem[] = [
    {
      id: 'appearance',
      group: 'PRÉFÉRENCES',
      label: 'Apparence',
      subtitle: 'Couleurs, verre & aperçu',
      icon: Palette,
      iconBg: 'from-rose-500 to-pink-500',
      keywords: 'theme couleur cider verre dark light accentuation apparence',
    },
    {
      id: 'proxmox',
      group: 'INFRASTRUCTURE',
      label: 'Proxmox & Tailscale',
      subtitle: 'API PVE, nœud & SSO',
      icon: Server,
      iconBg: 'from-cyan-500 to-blue-500',
      keywords: 'proxmox pve tailscale token sso ssl',
    },
    {
      id: 'media',
      group: 'INFRASTRUCTURE',
      label: 'Médias & *arr',
      subtitle: 'Jellyfin, Plex, Radarr…',
      icon: Sparkles,
      iconBg: 'from-violet-500 to-indigo-500',
      keywords: 'jellyfin plex jellyseerr radarr sonarr prowlarr qbittorrent',
    },
    {
      id: 'services',
      group: 'INFRASTRUCTURE',
      label: 'Services & Icônes',
      subtitle: 'Cartes & icônes dédiées',
      icon: Layers,
      iconBg: 'from-sky-500 to-cyan-500',
      keywords: 'services categories icones cartes widgets urls',
    },
    {
      id: 'storage',
      group: 'INFRASTRUCTURE',
      label: 'Disques & Stockage',
      subtitle: 'Montages /host_mnt & SMART',
      icon: HardDrive,
      iconBg: 'from-emerald-500 to-teal-500',
      keywords: 'disques stockage host_mnt wwn smart mergerfs',
    },
    {
      id: 'apps',
      group: 'CONNECTIVITÉ',
      label: 'Apps Apple & QR',
      subtitle: 'iPhone, iPad, Mac & tvOS',
      icon: Smartphone,
      iconBg: 'from-indigo-500 to-purple-500',
      keywords: 'apple ios macos tvos qr appairage deeplink tailscale',
    },
  ];

  const normalizedQuery = sidebarQuery.trim().toLowerCase();
  const visibleNavItems = normalizedQuery
    ? navItems.filter(
        (it) =>
          it.label.toLowerCase().includes(normalizedQuery) ||
          it.subtitle.toLowerCase().includes(normalizedQuery) ||
          it.keywords.includes(normalizedQuery)
      )
    : navItems;
  const activeMeta = navItems.find((n) => n.id === activeTab) || navItems[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-wizard-title"
        className="cider-window legacy-dark-surface safe-bottom-sheet flex h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-[28px] text-slate-900 dark:text-slate-100 sm:h-[86dvh] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Sidebar gauche style Cider / macOS */}
          <aside className="cider-sidebar flex shrink-0 flex-col border-b border-white/10 md:w-64 md:border-b-0 md:border-r">
            {/* Barre de titre + Pastilles fenêtre + Recherche */}
            <div className="shrink-0 px-4 pb-3 pt-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="hidden items-center gap-1.5 md:flex">
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label="Fermer"
                      className="h-3 w-3 rounded-full bg-rose-500/90 transition hover:brightness-110"
                    />
                    <span className="h-3 w-3 rounded-full bg-amber-400/80" />
                    <span className="h-3 w-3 rounded-full bg-emerald-400/80" />
                  </div>
                  <div className="flex items-center gap-2 md:pl-2">
                    <div className="cider-accent-btn flex h-7 w-7 items-center justify-center rounded-lg text-white">
                      <Wrench className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <h2
                        id="setup-wizard-title"
                        className="truncate text-xs font-bold tracking-tight text-white"
                      >
                        Préférences Studio
                      </h2>
                      <p className="truncate text-[10px] text-slate-400">
                        {isConfigured ? 'Serveur connecté' : 'Configuration requise'}
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fermer"
                  className="liquid-pill rounded-full p-1.5 text-slate-300 md:hidden"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="relative hidden md:block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={sidebarQuery}
                  onChange={(e) => setSidebarQuery(e.target.value)}
                  placeholder="Filtrer les réglages…"
                  className="w-full rounded-xl border border-white/10 bg-black/25 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-400 focus:border-cyan-400/60 focus:outline-none"
                />
              </div>
            </div>

            {/* Navigation : barre horizontale sur mobile, sidebar groupée sur desktop */}
            <div className="flex gap-1.5 overflow-x-auto px-4 pb-3 md:flex-1 md:flex-col md:space-y-4 md:overflow-y-auto md:px-3 md:pb-4">
              {(['PRÉFÉRENCES', 'INFRASTRUCTURE', 'CONNECTIVITÉ'] as const).map((groupName) => {
                const itemsInGroup = visibleNavItems.filter((item) => item.group === groupName);
                if (itemsInGroup.length === 0) return null;
                return (
                  <div key={groupName} className="flex shrink-0 gap-1.5 md:flex-col md:space-y-1">
                    <div className="hidden px-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400/80 md:block">
                      {groupName}
                    </div>
                    {itemsInGroup.map((item) => {
                      const Icon = item.icon;
                      const active = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setActiveTab(item.id)}
                          className={`group flex shrink-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition active:scale-[0.98] md:w-full ${
                            active
                              ? 'cider-accent-ring text-white shadow-sm'
                              : 'border-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.06] hover:text-white'
                          }`}
                        >
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${item.iconBg} text-white shadow-sm`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-semibold leading-tight">
                              {item.label}
                            </div>
                            <div className="hidden truncate text-[10px] text-slate-400 md:block">
                              {item.subtitle}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              {/* Raccourcis outils dans le bas de sidebar (desktop) */}
              {(onOpenNotifications || onOpenYamlEditor || onOpenServerConfig || onOpenOnboarding) && (
                <div className="hidden space-y-1 border-t border-white/10 pt-3 md:block">
                  <div className="px-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400/80">
                    OUTILS RAPIDES
                  </div>
                  {onOpenNotifications && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenNotifications();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-xs text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-orange-500/20 text-orange-300">
                        <BellRing className="h-3.5 w-3.5" />
                      </span>
                      <span className="truncate">Alertes &amp; Webhooks</span>
                    </button>
                  )}
                  {onOpenYamlEditor && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenYamlEditor();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-xs text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
                        <FileCode2 className="h-3.5 w-3.5" />
                      </span>
                      <span className="truncate">Éditeur config.yaml</span>
                    </button>
                  )}
                  {onOpenServerConfig && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenServerConfig();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-xs text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                      </span>
                      <span className="truncate">Serveur &amp; Mode Démo</span>
                    </button>
                  )}
                  {onOpenOnboarding && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenOnboarding();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-xs text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-300">
                        <Rocket className="h-3.5 w-3.5" />
                      </span>
                      <span className="truncate">Assistant initial</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </aside>

          {/* Panneau principal style Cider */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Hero Header de section */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${activeMeta.iconBg} text-white shadow-md`}
                >
                  <activeMeta.icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold text-white">{activeMeta.label}</h3>
                  <p className="truncate text-xs text-slate-400">{activeMeta.subtitle}</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadSetupStatus()}
                  disabled={loading}
                  title="Recharger depuis le serveur"
                  className="liquid-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:text-white disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Actualiser</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fermer"
                  className="liquid-pill hidden rounded-full p-2 text-slate-300 transition hover:text-white md:inline-flex"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Contenu scrollable */}
            <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7">
              {loadError && (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3.5 text-xs text-rose-200">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-300" />
                    <span>{loadError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadSetupStatus()}
                    className="liquid-pill shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Réessayer
                  </button>
                </div>
              )}

              {/* ONGLET 0 : Apparence & Thème (Studio Cider) */}
              {activeTab === 'appearance' && (
                <div className="space-y-5">
                  {/* Aperçu en direct style Cider */}
                  <div className="cider-card relative overflow-hidden p-5">
                    <div
                      className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-35 blur-2xl"
                      style={{
                        background: `radial-gradient(circle, var(--accent-hex, #06b6d4), transparent 70%)`,
                      }}
                    />
                    <div className="relative flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                          Aperçu en direct
                        </div>
                        <h4 className="mt-0.5 text-sm font-bold text-white">
                          Style {ACCENT_PRESETS.find((p) => p.id === accentPreset)?.label} • Verre{' '}
                          {glassIntensity === 'cider'
                            ? 'Acrylique Intense'
                            : glassIntensity === 'subtle'
                              ? 'Sobre'
                              : 'Équilibré'}
                        </h4>
                        <p className="mt-1 text-xs text-slate-400">
                          Chaque changement s’applique instantanément à tout le panneau.
                        </p>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <ServiceIconBadge icon="jellyfin" size="md" />
                        <ServiceIconBadge icon="zoraxy" size="md" />
                        <ServiceIconBadge icon="nextcloud" size="md" />
                        <ServiceIconBadge icon="proxmox" size="md" />
                      </div>
                    </div>
                  </div>

                  {/* Carte Mode Clair / Sombre / Système */}
                  <div className="cider-card divide-y divide-white/10">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <div>
                        <div className="text-xs font-semibold text-white">Apparence générale</div>
                        <div className="text-[11px] text-slate-400">
                          Adaptez automatiquement au système ou figez en Clair / Sombre
                        </div>
                      </div>
                      <div className="inline-flex rounded-xl border border-white/10 bg-black/25 p-1">
                        {(
                          [
                            { id: 'system', label: 'Auto', icon: Monitor },
                            { id: 'light', label: 'Clair', icon: Sun },
                            { id: 'dark', label: 'Sombre', icon: Moon },
                          ] as const
                        ).map((opt) => {
                          const Icon = opt.icon;
                          const selected = theme === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => onThemeChange?.(opt.id)}
                              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                                selected
                                  ? 'cider-accent-btn text-white'
                                  : 'text-slate-300 hover:text-white'
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              <span>{opt.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Couleurs d'accentuation */}
                    <div className="space-y-3 px-5 py-4">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-white">
                            Couleur d’accentuation &amp; halo ambiant
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Signature visuelle des boutons, onglets et reflets verre
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        {ACCENT_PRESETS.map((preset) => {
                          const selected = accentPreset === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => handleSelectAccent(preset.id)}
                              className={`flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition ${
                                selected
                                  ? 'border-white/35 bg-white/[0.11] text-white shadow-sm'
                                  : 'border-white/10 bg-white/[0.02] text-slate-300 hover:bg-white/[0.06]'
                              }`}
                            >
                              <span
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full shadow-inner"
                                style={{
                                  background: `linear-gradient(135deg, ${preset.swatchHex}, ${preset.secondaryHex})`,
                                }}
                              >
                                {selected && <Check className="h-3.5 w-3.5 text-white" />}
                              </span>
                              <span className="truncate text-xs font-semibold">{preset.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Effet Verre (Blur) */}
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <div>
                        <div className="text-xs font-semibold text-white">
                          Transparence &amp; Verre Acrylique
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Contrôle le flou Liquid Glass façon Cider
                        </div>
                      </div>
                      <div className="inline-flex rounded-xl border border-white/10 bg-black/25 p-1">
                        {(
                          [
                            { id: 'cider', label: 'Cider Intense' },
                            { id: 'balanced', label: 'Équilibré' },
                            { id: 'subtle', label: 'Sobre' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleSelectGlass(opt.id)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                              glassIntensity === opt.id
                                ? 'cider-accent-btn text-white'
                                : 'text-slate-300 hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Densité */}
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <div>
                        <div className="text-xs font-semibold text-white">Densité des cartes</div>
                        <div className="text-[11px] text-slate-400">
                          Aération confortable ou affichage dense pour grands homelabs
                        </div>
                      </div>
                      <div className="inline-flex rounded-xl border border-white/10 bg-black/25 p-1">
                        {(
                          [
                            { id: 'comfortable', label: 'Confortable' },
                            { id: 'compact', label: 'Compacte' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleSelectDensity(opt.id)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                              densityMode === opt.id
                                ? 'cider-accent-btn text-white'
                                : 'text-slate-300 hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {loading && !isConfigured && !form.pve_host && categories.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-slate-400">
                  <Loader2 className="h-6 w-6 animate-spin text-cyan-300" />
                  <span>Chargement de la configuration serveur…</span>
                </div>
              ) : (
                <>
              {/* ONGLET 1 : Proxmox & Tailscale */}
              {activeTab === 'proxmox' && (
                <div className="space-y-6">
                  <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-500/15 text-cyan-300">
                          <Server className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-white">Hyperviseur Proxmox VE</h3>
                          <p className="text-xs text-slate-400">
                            Connexion API via Token restreint (sans privilèges shell)
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={tests.proxmox?.testing}
                        onClick={() =>
                          void runServiceTest('proxmox', {
                            url: form.pve_host.trim(),
                            node: form.pve_node.trim(),
                            token_id: form.pve_token_id.trim(),
                            secret: form.pve_token_secret,
                            verify_ssl: form.pve_verify_ssl,
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-2xl border border-cyan-400/40 bg-cyan-500/20 px-3.5 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/30 active:scale-95 disabled:opacity-50"
                      >
                        {tests.proxmox?.testing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Wifi className="h-3.5 w-3.5" />
                        )}
                        <span>Tester Proxmox</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="setup-pve-host"
                          className="mb-1.5 block text-xs font-medium text-slate-300"
                        >
                          URL Hôte Proxmox <code className="ml-1 text-[10px] text-slate-500">pve_host</code>
                        </label>
                        <input
                          id="setup-pve-host"
                          type="url"
                          value={form.pve_host}
                          onChange={(e) => updateForm('pve_host', e.target.value)}
                          placeholder="https://192.168.1.10:8006"
                          className={INPUT_CLASS}
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="setup-pve-node"
                          className="mb-1.5 block text-xs font-medium text-slate-300"
                        >
                          Nom du nœud <code className="ml-1 text-[10px] text-slate-500">pve_node</code>
                        </label>
                        <input
                          id="setup-pve-node"
                          type="text"
                          value={form.pve_node}
                          onChange={(e) => updateForm('pve_node', e.target.value)}
                          placeholder="pve"
                          className={INPUT_CLASS}
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="setup-pve-token-id"
                          className="mb-1.5 block text-xs font-medium text-slate-300"
                        >
                          Token ID <code className="ml-1 text-[10px] text-slate-500">pve_token_id</code>
                        </label>
                        <input
                          id="setup-pve-token-id"
                          type="text"
                          value={form.pve_token_id}
                          onChange={(e) => updateForm('pve_token_id', e.target.value)}
                          placeholder="root@pam!pve-panel"
                          className={`${INPUT_CLASS} font-mono text-xs`}
                        />
                      </div>

                      <SecretInput
                        id="setup-pve-token-secret"
                        label="Secret du Token Proxmox"
                        value={form.pve_token_secret}
                        isSet={secretFlags.pve_token_secret_set}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        onChange={(v) => updateForm('pve_token_secret', v)}
                      />

                      <div>
                        <label
                          htmlFor="setup-self-vmid"
                          className="mb-1.5 block text-xs font-medium text-slate-300"
                        >
                          VMID protégé du panel <code className="ml-1 text-[10px] text-slate-500">panel_self_vmid</code>
                        </label>
                        <input
                          id="setup-self-vmid"
                          type="number"
                          min={100}
                          max={999999}
                          value={form.panel_self_vmid}
                          onChange={(e) => updateForm('panel_self_vmid', e.target.value)}
                          placeholder="116"
                          className={INPUT_CLASS}
                        />
                      </div>

                      <div className="flex items-end">
                        <label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs">
                          <div>
                            <div className="font-medium text-slate-200">
                              Vérifier le certificat SSL
                            </div>
                            <div className="text-[11px] text-slate-400">
                              Désactiver pour certificat auto-signé Proxmox
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={form.pve_verify_ssl}
                            onChange={(e) => updateForm('pve_verify_ssl', e.target.checked)}
                            className="h-4 w-4 accent-cyan-400"
                          />
                        </label>
                      </div>
                    </div>

                    <TestFeedbackBadge state={tests.proxmox} />
                  </section>

                  <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                    <div className="mb-4 flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-500/15 text-emerald-300">
                        <ShieldCheck className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          Sécurité Tailscale SSO &amp; Propriétaire
                        </h3>
                        <p className="text-xs text-slate-400">
                          Contrôle d’accès via Tailscale Serve et protection du compte principal
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="setup-allowed-users"
                          className="mb-1.5 block text-xs font-medium text-slate-300"
                        >
                          Utilisateurs Tailscale autorisés
                        </label>
                        <input
                          id="setup-allowed-users"
                          type="text"
                          value={form.allowed_tailscale_users}
                          onChange={(e) =>
                            updateForm('allowed_tailscale_users', e.target.value)
                          }
                          placeholder="user1@example.com, user2@example.com"
                          className={INPUT_CLASS}
                        />
                        <p className="mt-1 text-[11px] text-slate-500">
                          Emails séparés par des virgules.
                        </p>
                      </div>

                      <div>
                        <label
                          htmlFor="setup-owner-username"
                          className="mb-1.5 block text-xs font-medium text-slate-300"
                        >
                          Compte propriétaire protégé
                        </label>
                        <input
                          id="setup-owner-username"
                          type="text"
                          value={form.protected_owner_username}
                          onChange={(e) =>
                            updateForm('protected_owner_username', e.target.value)
                          }
                          placeholder="admin"
                          className={INPUT_CLASS}
                        />
                        <p className="mt-1 text-[11px] text-slate-500">
                          Protégé contre la suppression/rétrogradation Jellyfin.
                        </p>
                      </div>
                    </div>

                    <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs">
                      <div>
                        <div className="font-medium text-slate-200">
                          Contournement Auth Local (dev uniquement)
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Laisser désactivé en production derrière Tailscale Serve.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={form.dev_auth_bypass}
                        onChange={(e) => updateForm('dev_auth_bypass', e.target.checked)}
                        className="h-4 w-4 accent-amber-400"
                      />
                    </label>
                  </section>
                </div>
              )}

              {/* ONGLET 2 : Médias & Téléchargements */}
              {activeTab === 'media' && (
                <div className="space-y-4">
                  <p className="text-xs text-slate-400">
                    Renseignez les URLs internes et clés API de vos services pour activer les
                    widgets temps réel et la gestion des utilisateurs. Laissez un secret vide pour
                    conserver sa valeur actuelle.
                  </p>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {MEDIA_SERVICES.map((svc) => {
                      const testState = tests[svc.key];
                      const urlVal = String(form[svc.urlKey] || '');
                      const secretVal = String(form[svc.secretKey] || '');
                      const usernameVal = svc.usernameKey
                        ? String(form[svc.usernameKey] || '')
                        : undefined;

                      return (
                        <div
                          key={svc.key}
                          className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"
                        >
                          <div className="mb-3 flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <ServiceIconBadge icon={svc.key} size="sm" />
                              <div className="min-w-0">
                                <h3 className="truncate text-sm font-semibold text-white">
                                  {svc.label}
                                </h3>
                                <p className="truncate text-xs text-slate-400">{svc.subtitle}</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={testState?.testing}
                              onClick={() =>
                                void runServiceTest(svc.key, {
                                  url: urlVal.trim(),
                                  secret: secretVal,
                                  ...(svc.usernameKey
                                    ? { username: (usernameVal || '').trim() }
                                    : {}),
                                })
                              }
                              className="liquid-pill inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-cyan-200 transition hover:text-white active:scale-95 disabled:opacity-50"
                            >
                              {testState?.testing ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Wifi className="h-3.5 w-3.5 text-cyan-300" />
                              )}
                              <span>Tester</span>
                            </button>
                          </div>

                          <div className="space-y-3">
                            <div>
                              <label
                                htmlFor={`setup-${svc.key}-url`}
                                className="mb-1 block text-xs font-medium text-slate-300"
                              >
                                URL du service
                              </label>
                              <input
                                id={`setup-${svc.key}-url`}
                                type="url"
                                value={urlVal}
                                onChange={(e) => updateForm(svc.urlKey, e.target.value)}
                                placeholder={svc.urlPlaceholder}
                                className={INPUT_CLASS}
                              />
                            </div>

                            {svc.usernameKey && (
                              <div>
                                <label
                                  htmlFor={`setup-${svc.key}-username`}
                                  className="mb-1 block text-xs font-medium text-slate-300"
                                >
                                  Nom d’utilisateur
                                </label>
                                <input
                                  id={`setup-${svc.key}-username`}
                                  type="text"
                                  value={usernameVal || ''}
                                  onChange={(e) =>
                                    updateForm(svc.usernameKey!, e.target.value)
                                  }
                                  placeholder="admin"
                                  className={INPUT_CLASS}
                                />
                              </div>
                            )}

                            <SecretInput
                              id={`setup-${svc.key}-secret`}
                              label={svc.secretLabel}
                              value={secretVal}
                              isSet={secretFlags[svc.secretSetKey]}
                              onChange={(v) => updateForm(svc.secretKey, v)}
                            />
                          </div>

                          <TestFeedbackBadge state={testState} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ONGLET 3 : Services & Disques (services.yaml) */}
              {activeTab === 'services' && (
                <div className="space-y-6">
                  {/* Éditeur Catégories & Services */}
                  <section className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          Catégories &amp; Services{' '}
                          <code className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-normal text-cyan-200">
                            services.yaml
                          </code>
                        </h3>
                        <p className="text-xs text-slate-400">
                          Cartes affichées sur le tableau de bord avec ping et widgets associés
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={addCategory}
                        className="inline-flex items-center gap-1.5 rounded-2xl border border-cyan-400/40 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/30 active:scale-95"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Ajouter une catégorie</span>
                      </button>
                    </div>

                    {categories.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-xs text-slate-400">
                        Aucune catégorie configurée. Cliquez sur « Ajouter une catégorie » pour
                        commencer.
                      </div>
                    )}

                    <div className="space-y-4">
                      {categories.map((cat, catIdx) => (
                        <div
                          key={catIdx}
                          className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={cat.name}
                              onChange={(e) => updateCategoryName(catIdx, e.target.value)}
                              placeholder="Nom de la catégorie"
                              className="min-w-[180px] flex-1 rounded-2xl border border-white/15 bg-slate-950/70 px-3.5 py-2 text-sm font-semibold text-white focus:border-cyan-400/60 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => addService(catIdx)}
                              className="liquid-pill inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-medium text-cyan-200 transition hover:text-white active:scale-95"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              <span>Service</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => removeCategory(catIdx)}
                              title="Supprimer la catégorie"
                              className="rounded-2xl border border-rose-400/25 bg-rose-500/10 p-2 text-rose-300 transition hover:bg-rose-500/20 active:scale-95"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="mt-3 space-y-2.5">
                            {cat.services.length === 0 && (
                              <p className="rounded-xl border border-dashed border-white/10 py-3 text-center text-xs text-slate-500">
                                Aucun service dans cette catégorie
                              </p>
                            )}

                            {cat.services.map((svc, svcIdx) => {
                              const rowKey = `${catIdx}-${svcIdx}`;
                              const expanded = expandedServiceKey === rowKey;

                              return (
                                <div
                                  key={rowKey}
                                  className="rounded-2xl border border-white/10 bg-slate-950/55"
                                >
                                  <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedServiceKey(expanded ? null : rowKey)
                                      }
                                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                                    >
                                      {expanded ? (
                                        <ChevronUp className="h-4 w-4 shrink-0 text-cyan-300" />
                                      ) : (
                                        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                                      )}
                                      <ServiceIconBadge
                                        icon={svc.icon}
                                        hint={{ id: svc.id, name: svc.name, widget: svc.widget }}
                                        size="sm"
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="truncate text-xs font-semibold text-white">
                                            {svc.name || 'Sans nom'}
                                          </span>
                                          <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                                            {svc.id || 'id'}
                                          </span>
                                          {svc.widget && (
                                            <span className="rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium text-cyan-200">
                                              widget: {svc.widget}
                                            </span>
                                          )}
                                        </div>
                                        <div className="truncate text-[11px] text-slate-400">
                                          {svc.url || 'URL non définie'}
                                        </div>
                                      </div>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => removeService(catIdx, svcIdx)}
                                      aria-label={`Supprimer ${svc.name}`}
                                      className="rounded-xl p-1.5 text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-300"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>

                                  {expanded && (
                                    <div className="grid grid-cols-1 gap-3 border-t border-white/10 p-3.5 sm:grid-cols-2">
                                      <div>
                                        <label className="mb-1 block text-[11px] font-medium text-slate-400">
                                          Nom
                                        </label>
                                        <input
                                          type="text"
                                          value={svc.name}
                                          onChange={(e) =>
                                            updateService(catIdx, svcIdx, { name: e.target.value })
                                          }
                                          placeholder="Jellyfin"
                                          className={INPUT_CLASS}
                                        />
                                      </div>

                                      <div>
                                        <label className="mb-1 block text-[11px] font-medium text-slate-400">
                                          Identifiant unique
                                        </label>
                                        <input
                                          type="text"
                                          value={svc.id}
                                          onChange={(e) =>
                                            updateService(catIdx, svcIdx, { id: e.target.value })
                                          }
                                          placeholder="jellyfin"
                                          className={`${INPUT_CLASS} font-mono text-xs`}
                                        />
                                      </div>

                                      <div className="sm:col-span-2">
                                        <label className="mb-1 block text-[11px] font-medium text-slate-400">
                                          Description
                                        </label>
                                        <input
                                          type="text"
                                          value={svc.description}
                                          onChange={(e) =>
                                            updateService(catIdx, svcIdx, {
                                              description: e.target.value,
                                            })
                                          }
                                          placeholder="Serveur multimédia 4K"
                                          className={INPUT_CLASS}
                                        />
                                      </div>

                                      <div>
                                        <label className="mb-1 block text-[11px] font-medium text-slate-400">
                                          URL d’ouverture
                                        </label>
                                        <input
                                          type="url"
                                          value={svc.url}
                                          onChange={(e) =>
                                            updateService(catIdx, svcIdx, { url: e.target.value })
                                          }
                                          placeholder="https://service.example.ts.net"
                                          className={INPUT_CLASS}
                                        />
                                      </div>

                                      <div>
                                        <label className="mb-1 block text-[11px] font-medium text-slate-400">
                                          URL Ping / Healthcheck (optionnel)
                                        </label>
                                        <input
                                          type="url"
                                          value={svc.ping_url || ''}
                                          onChange={(e) =>
                                            updateService(catIdx, svcIdx, {
                                              ping_url: e.target.value,
                                            })
                                          }
                                          placeholder="http://192.168.1.26:8096/health"
                                          className={INPUT_CLASS}
                                        />
                                      </div>

                                      <div className="sm:col-span-2">
                                        <label className="mb-1 block text-[11px] font-medium text-slate-400">
                                          Widget intégré
                                        </label>
                                        <select
                                          value={svc.widget || ''}
                                          onChange={(e) =>
                                            updateService(catIdx, svcIdx, {
                                              widget: e.target.value,
                                            })
                                          }
                                          className={INPUT_CLASS}
                                        >
                                          {WIDGET_OPTIONS.map((opt) => (
                                            <option key={opt.value} value={opt.value}>
                                              {opt.label}
                                            </option>
                                          ))}
                                        </select>
                                      </div>

                                      <div className="sm:col-span-2 rounded-2xl border border-white/10 bg-black/25 p-3">
                                        <ServiceIconPicker
                                          value={svc.icon}
                                          hint={{ id: svc.id, name: svc.name, widget: svc.widget }}
                                          onChange={(nextIcon) =>
                                            updateService(catIdx, svcIdx, { icon: nextIcon })
                                          }
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              )}

              {/* ONGLET 4 : Montages Disques & Stockage */}
              {activeTab === 'storage' && (
                <div className="space-y-4">
                  {/* Éditeur Montages Disques (storage_mounts) */}
                  <section className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                          <HardDrive className="h-4 w-4 text-cyan-300" />
                          <span>Montages disques physiques</span>
                        </h3>
                        <p className="text-xs text-slate-400">
                          Association entre les dossiers{' '}
                          <code className="text-slate-300">/host_mnt/*</code> et les disques SMART
                          Proxmox
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={addStorageMount}
                        className="inline-flex items-center gap-1.5 rounded-2xl border border-cyan-400/40 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/30 active:scale-95"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Ajouter un montage</span>
                      </button>
                    </div>

                    {storageMounts.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/15 p-5 text-center text-xs text-slate-400">
                        Aucun montage manuel défini (détection automatique des sous-dossiers dans{' '}
                        <code className="text-slate-300">/host_mnt</code> si omis).
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {storageMounts.map((mount, idx) => (
                          <div
                            key={idx}
                            className="grid grid-cols-1 gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 sm:grid-cols-12 sm:items-end"
                          >
                            <div className="sm:col-span-3">
                              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                                Libellé
                              </label>
                              <input
                                type="text"
                                value={mount.label}
                                onChange={(e) =>
                                  updateStorageMount(idx, { label: e.target.value })
                                }
                                placeholder="Disque 1 • 16 To"
                                className={INPUT_CLASS}
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                                Point de montage
                              </label>
                              <input
                                type="text"
                                value={mount.mount}
                                onChange={(e) =>
                                  updateStorageMount(idx, { mount: e.target.value })
                                }
                                placeholder="/mnt/disk1"
                                className={`${INPUT_CLASS} font-mono text-xs`}
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                                Sous-dossier
                              </label>
                              <input
                                type="text"
                                value={mount.subpath}
                                onChange={(e) =>
                                  updateStorageMount(idx, { subpath: e.target.value })
                                }
                                placeholder="disk1"
                                className={`${INPUT_CLASS} font-mono text-xs`}
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                                WWN SMART
                              </label>
                              <input
                                type="text"
                                value={mount.wwn}
                                onChange={(e) =>
                                  updateStorageMount(idx, { wwn: e.target.value })
                                }
                                placeholder="0x5000000000000001"
                                className={`${INPUT_CLASS} font-mono text-xs`}
                              />
                            </div>
                            <div className="flex justify-end sm:col-span-1">
                              <button
                                type="button"
                                onClick={() => removeStorageMount(idx)}
                                aria-label="Supprimer le montage"
                                className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-2 text-rose-300 transition hover:bg-rose-500/20"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              )}

              {/* ONGLET 4 : Apps iPhone / Mac / Apple TV */}
              {activeTab === 'apps' && (
                <div className="space-y-5">
                  <section className="rounded-3xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/15 via-indigo-500/10 to-transparent p-5">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/35 bg-cyan-500/20 text-cyan-200">
                        <Smartphone className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-white">
                          Appairage rapide iPhone, iPad &amp; Mac
                        </h3>
                        <p className="mt-1 text-xs text-slate-300">
                          Connectez l’application native <strong>PVE Center</strong> en 1 clic à ce
                          serveur ou copiez son URL Tailscale Serve HTTPS.
                        </p>

                        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                          {computedDeepLink && (
                            <div className="shrink-0 self-center sm:self-start">
                              <QrCodeView value={computedDeepLink} size={136} />
                            </div>
                          )}
                          <div className="min-w-0 flex-1 rounded-2xl border border-white/15 bg-slate-950/75 p-3">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                              URL du panel détectée
                            </div>
                            <div className="mt-1 break-all font-mono text-xs text-cyan-200">
                              {detectedPanelUrl || 'Non détectée'}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <button
                            type="button"
                            disabled={!detectedPanelUrl}
                            onClick={() => void handleCopy('url', detectedPanelUrl)}
                            className="liquid-pill inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-white/10 active:scale-[0.98] disabled:opacity-50"
                          >
                            {copiedKey === 'url' ? (
                              <>
                                <Check className="h-4 w-4 text-emerald-300" />
                                <span>URL copiée !</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-4 w-4 text-cyan-300" />
                                <span>Copier l’URL</span>
                              </>
                            )}
                          </button>

                          {computedDeepLink && (
                            <a
                              href={computedDeepLink}
                              className="cider-accent-btn inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 active:scale-[0.98]"
                            >
                              <ExternalLink className="h-4 w-4" />
                              <span>Ouvrir dans PVE Center</span>
                            </a>
                          )}
                        </div>

                        {computedDeepLink && (
                          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                            <span className="truncate font-mono text-[11px] text-slate-400">
                              {computedDeepLink}
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleCopy('deeplink', computedDeepLink)}
                              className="shrink-0 text-[11px] font-medium text-cyan-300 hover:text-cyan-200"
                            >
                              {copiedKey === 'deeplink' ? 'Copié !' : 'Copier le lien'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-indigo-400/30 bg-indigo-500/15 text-indigo-200">
                        <Tv className="h-5 w-5" />
                      </div>
                      <div className="space-y-2 text-xs text-slate-300">
                        <h3 className="text-sm font-semibold text-white">
                          Configuration sur Apple TV (tvOS)
                        </h3>
                        <ol className="list-inside list-decimal space-y-1.5 leading-relaxed text-slate-300">
                          <li>
                            Installez <strong>Tailscale</strong> sur l’Apple TV (ou connectez-la au
                            même réseau local que votre serveur).
                          </li>
                          <li>
                            Ouvrez <strong>PVE Center</strong> sur tvOS et sélectionnez l’icône de
                            réglages serveur en haut de l’écran.
                          </li>
                          <li>
                            Saisissez l’URL ci-dessus (
                            <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-cyan-200">
                              {detectedPanelUrl || 'https://votre-panel.ts.net'}
                            </code>
                            ) via le clavier Siri / iPhone, puis validez pour synchroniser tous vos
                            onglets 10-foot UI.
                          </li>
                        </ol>
                      </div>
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
        </div>

            {/* Footer sticky Enregistrer & Appliquer à chaud */}
            <div className="shrink-0 border-t border-white/10 bg-black/20 px-5 py-4 sm:px-6">
              {saveFeedback && (
                <div
                  className={`mb-3 flex items-start gap-2 rounded-2xl border px-3.5 py-2.5 text-xs ${
                    saveFeedback.type === 'success'
                      ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                      : 'border-rose-400/30 bg-rose-500/10 text-rose-200'
                  }`}
                >
                  {saveFeedback.type === 'success' ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                  )}
                  <span>{saveFeedback.text}</span>
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="liquid-pill rounded-2xl px-4 py-2.5 text-xs font-medium text-slate-200 transition hover:text-white active:scale-[0.98] disabled:opacity-50"
                >
                  Fermer
                </button>

                <button
                  type="button"
                  onClick={() => void handleSaveConfig()}
                  disabled={saving || loading}
                  className="cider-accent-btn inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Application en cours…</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Enregistrer &amp; Appliquer à chaud</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
