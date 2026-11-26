import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BellOff,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react';
import { getServerUrl } from '../lib/apiClient';
import { ServiceIconBadge } from './ServiceIcon';
import type {
  CustomServiceItem,
  CustomServiceTestResponse,
  JellyfinWidget,
  PlexWidget,
  ProwlarrWidget,
  QbittorrentWidget,
  RadarrWidget,
  ServiceItem,
  ServiceProtocol,
  SonarrWidget,
  StremioWidget,
  WidgetsMap,
} from '../types';

const PROTOCOL_BADGE: Record<ServiceProtocol, { label: string; cls: string }> = {
  http_rest: {
    label: 'HTTP',
    cls: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  },
  tcp_port: {
    label: 'TCP',
    cls: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  },
  icmp_ping: {
    label: 'ICMP',
    cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  json_metrics: {
    label: 'JSON',
    cls: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300',
  },
  webhook_ingest: {
    label: 'WEBHOOK',
    cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
};

function formatSpeed(bytesPerSec: number | undefined): string {
  const val = bytesPerSec || 0;
  if (val >= 1024 * 1024) return `${(val / (1024 * 1024)).toFixed(1)} Mo/s`;
  if (val >= 1024) return `${(val / 1024).toFixed(0)} Ko/s`;
  return `${val} o/s`;
}

function MetricPill({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div className="liquid-subcard rounded-xl px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-xs font-semibold ${
          highlight
            ? 'text-cyan-700 dark:text-cyan-300'
            : 'text-slate-800 dark:text-slate-200'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function renderWidget(widgetType: string | undefined, widgets: WidgetsMap) {
  if (!widgetType) return null;

  if (widgetType === 'jellyfin') {
    const data = widgets.jellyfin as JellyfinWidget | undefined;
    if (!data || data.status !== 'ok') {
      return <div className="text-xs text-slate-500">Métriques indisponibles</div>;
    }
    const streams = data.active_streams || [];
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <MetricPill
            label="Flux actifs"
            value={data.active_streams_count ?? 0}
            highlight={(data.active_streams_count ?? 0) > 0}
          />
          <MetricPill label="Films" value={data.movies_count ?? 0} />
          <MetricPill label="Séries" value={data.series_count ?? 0} />
        </div>
        {streams.length > 0 && (
          <div className="space-y-1 rounded-lg border border-cyan-500/25 bg-cyan-500/10 p-2 text-[11px]">
            {streams.map((s, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-cyan-800 dark:text-cyan-200">
                  {s.is_paused ? '⏸ ' : '▶ '}
                  {s.title}
                </span>
                <span className="shrink-0 text-slate-600 dark:text-slate-400">{s.user}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (widgetType === 'plex') {
    const data = widgets.plex as PlexWidget | undefined;
    if (!data || data.status !== 'ok') {
      return <div className="text-xs text-slate-500">Métriques indisponibles</div>;
    }
    return (
      <div className="grid grid-cols-3 gap-2">
        <MetricPill
          label="Flux actifs"
          value={data.active_streams_count ?? 0}
          highlight={(data.active_streams_count ?? 0) > 0}
        />
        <MetricPill label="Biblio." value={data.libraries_count ?? 0} />
        <MetricPill label="Version" value={data.version || 'OK'} />
      </div>
    );
  }

  if (widgetType === 'radarr') {
    const data = widgets.radarr as RadarrWidget | undefined;
    if (!data || data.status !== 'ok') {
      return <div className="text-xs text-slate-500">Métriques indisponibles</div>;
    }
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <MetricPill label="Films" value={data.movies_downloaded ?? 0} />
          <MetricPill label="Manquants" value={data.movies_missing ?? 0} />
          <MetricPill
            label="En file"
            value={data.queue_count ?? 0}
            highlight={(data.queue_count ?? 0) > 0}
          />
        </div>
        {data.upcoming && data.upcoming.length > 0 && (
          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            Prochain :{' '}
            <span className="text-slate-800 dark:text-slate-200">{data.upcoming[0].title}</span>{' '}
            <span className="text-slate-400 dark:text-slate-500">({data.upcoming[0].date})</span>
          </div>
        )}
      </div>
    );
  }

  if (widgetType === 'sonarr') {
    const data = widgets.sonarr as SonarrWidget | undefined;
    if (!data || data.status !== 'ok') {
      return <div className="text-xs text-slate-500">Métriques indisponibles</div>;
    }
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <MetricPill label="Séries" value={data.series_total ?? 0} />
          <MetricPill label="Épisodes" value={data.episodes_downloaded ?? 0} />
          <MetricPill
            label="En file"
            value={data.queue_count ?? 0}
            highlight={(data.queue_count ?? 0) > 0}
          />
        </div>
        {data.upcoming && data.upcoming.length > 0 && (
          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            À venir :{' '}
            <span className="text-slate-800 dark:text-slate-200">{data.upcoming[0].title}</span>{' '}
            <span className="text-slate-400 dark:text-slate-500">({data.upcoming[0].date})</span>
          </div>
        )}
      </div>
    );
  }

  if (widgetType === 'qbittorrent') {
    const data = widgets.qbittorrent as QbittorrentWidget | undefined;
    if (!data || data.status !== 'ok') {
      return <div className="text-xs text-slate-500">Métriques indisponibles</div>;
    }
    return (
      <div className="grid grid-cols-3 gap-2">
        <div className="liquid-subcard rounded-xl px-2.5 py-1.5">
          <div className="flex items-center gap-1 text-[10px] uppercase text-slate-500 dark:text-slate-400">
            <ArrowDown className="h-3 w-3 text-emerald-500" />
            DL
          </div>
          <div className="mt-0.5 font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            {formatSpeed(data.dl_speed_bytes)}
          </div>
        </div>
        <div className="liquid-subcard rounded-xl px-2.5 py-1.5">
          <div className="flex items-center gap-1 text-[10px] uppercase text-slate-500 dark:text-slate-400">
            <ArrowUp className="h-3 w-3 text-cyan-500" />
            UP
          </div>
          <div className="mt-0.5 font-mono text-xs font-semibold text-cyan-700 dark:text-cyan-300">
            {formatSpeed(data.up_speed_bytes)}
          </div>
        </div>
        <MetricPill
          label="DL / Seed"
          value={`${data.downloading_count ?? 0} / ${data.seeding_count ?? 0}`}
        />
      </div>
    );
  }

  if (widgetType === 'prowlarr') {
    const data = widgets.prowlarr as ProwlarrWidget | undefined;
    if (!data || data.status !== 'ok') {
      return <div className="text-xs text-slate-500">Métriques indisponibles</div>;
    }
    return (
      <div className="grid grid-cols-3 gap-2">
        <MetricPill
          label="Indexeurs"
          value={`${data.indexers_enabled ?? 0}/${data.indexers_total ?? 0}`}
        />
        <MetricPill label="Requêtes" value={data.queries ?? 0} />
        <MetricPill label="Grabs" value={data.grabs ?? 0} highlight />
      </div>
    );
  }

  if (widgetType === 'stremio') {
    const data = widgets.stremio as StremioWidget | undefined;
    if (!data || data.status !== 'ok') {
      return <div className="text-xs text-slate-500">Métriques indisponibles</div>;
    }
    const ver = data.server_version
      ? data.server_version.startsWith('v')
        ? data.server_version
        : `v${data.server_version}`
      : 'OK';
    const firstProfile = (data.hw_accel_profiles?.[0] || '').toLowerCase();
    const transcodeLabel = firstProfile
      ? firstProfile.includes('vaapi')
        ? 'VAAPI'
        : firstProfile.includes('nvenc')
          ? 'NVENC'
          : firstProfile.includes('qsv')
            ? 'QSV'
            : 'HW'
      : data.hw_accel_enabled
        ? 'HW'
        : 'CPU';
    const cacheLabel =
      typeof data.cache_size_bytes === 'number'
        ? data.cache_size_bytes === 0
          ? 'Off'
          : `${(data.cache_size_bytes / 1024 ** 3).toFixed(1)} Go`
        : 'Auto';
    return (
      <div className="grid grid-cols-3 gap-2">
        <MetricPill label="Version" value={ver} />
        <MetricPill
          label="Transcodage"
          value={transcodeLabel}
          highlight={Boolean(data.hw_accel_enabled)}
        />
        <MetricPill label="Cache" value={cacheLabel} />
      </div>
    );
  }

  return null;
}

function isMutedNow(mutedUntil: string | null | undefined): boolean {
  if (!mutedUntil) return false;
  const ts = new Date(mutedUntil).getTime();
  return !Number.isNaN(ts) && ts > Date.now();
}

interface ServiceCardProps {
  service: ServiceItem;
  widgets: WidgetsMap;
  customService?: CustomServiceItem;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onEditService?: (svc: ServiceItem, categoryName: string) => void;
  onMoveService?: (svc: ServiceItem, direction: 'up' | 'down') => Promise<void>;
  categoryName?: string;
  onEditCustom?: (svc: CustomServiceItem) => void;
  onDeleteCustom?: (svc: CustomServiceItem) => Promise<void>;
  onMoveCustom?: (svc: CustomServiceItem, direction: 'up' | 'down') => Promise<void>;
  onTestCustom?: (svc: CustomServiceItem) => Promise<CustomServiceTestResponse | null>;
}

export function ServiceCard({
  service,
  widgets,
  customService,
  canMoveUp = false,
  canMoveDown = false,
  onEditService,
  onMoveService,
  categoryName = 'Services',
  onEditCustom,
  onDeleteCustom,
  onMoveCustom,
  onTestCustom,
}: ServiceCardProps) {
  const [testing, setTesting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [lastTestBadge, setLastTestBadge] = useState<string | null>(null);

  const isCustom = Boolean(service.is_custom || customService);
  const protocol = service.protocol || customService?.protocol;
  const protoMeta = protocol ? PROTOCOL_BADGE[protocol] : null;
  const statusVal =
    service.status || (service.online ? 'up' : service.enabled === false ? 'disabled' : 'down');
  const muted = isMutedNow(service.muted_until ?? customService?.muted_until);

  const metricsEntries = Object.entries(
    service.metrics || customService?.metrics || {}
  ).slice(0, 6);

  const statusPill = (() => {
    if (statusVal === 'disabled') {
      return {
        cls: 'border-slate-300/80 bg-slate-200/70 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
        dot: 'bg-slate-400',
        text: 'Désactivé',
      };
    }
    if (statusVal === 'degraded') {
      return {
        cls: 'border-amber-500/35 bg-amber-500/15 text-amber-800 dark:text-amber-200',
        dot: 'bg-amber-500',
        text: service.latency_ms !== null ? `Dégradé • ${service.latency_ms} ms` : 'Dégradé',
      };
    }
    if (statusVal === 'up' || service.online) {
      return {
        cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        dot: 'bg-emerald-500',
        text: service.latency_ms !== null ? `${service.latency_ms} ms` : 'OK',
      };
    }
    if (statusVal === 'unknown') {
      return {
        cls: 'border-slate-300/80 bg-slate-200/70 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
        dot: 'bg-slate-400',
        text: 'En attente',
      };
    }
    return {
      cls: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
      dot: 'bg-rose-500',
      text: 'Hors ligne',
    };
  })();

  const handleTest = async () => {
    if (!customService || !onTestCustom) return;
    setTesting(true);
    setLastTestBadge(null);
    try {
      const res = await onTestCustom(customService);
      if (res) {
        setLastTestBadge(
          res.ok
            ? `OK${res.latency_ms !== null ? ` (${res.latency_ms} ms)` : ''}`
            : `Échec (${res.status})`
        );
      }
    } finally {
      setTesting(false);
    }
  };

  const handleCopyWebhookUrl = async () => {
    const base =
      getServerUrl() || (typeof window !== 'undefined' ? window.location.origin : '');
    const webhookUrl = `${base}/api/custom-services/${encodeURIComponent(service.id)}/webhook`;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhook(true);
      window.setTimeout(() => setCopiedWebhook(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  const linkBody = (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <ServiceIconBadge
        icon={service.icon}
        hint={{ id: service.id, name: service.name, widget: service.widget }}
        size="md"
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold text-slate-900 group-hover:text-cyan-700 dark:text-slate-100 dark:group-hover:text-cyan-300">
            {service.name}
          </h3>
          {service.url && (
            <ExternalLink className="h-3 w-3 shrink-0 text-slate-400 opacity-60 transition group-hover:opacity-100" />
          )}
          {protoMeta && (
            <span
              className={`rounded-md border px-1.5 py-0.2 font-mono text-[9px] font-semibold uppercase ${protoMeta.cls}`}
            >
              {protoMeta.label}
            </span>
          )}
          {muted && (
            <span
              title="Alertes en sourdine"
              className="inline-flex items-center gap-0.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.2 text-[9px] font-semibold text-amber-700 dark:text-amber-300"
            >
              <BellOff className="h-2.5 w-2.5" />
              Mute
            </span>
          )}
        </div>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {service.description ||
            (service.host
              ? `${service.host}${service.port ? `:${service.port}` : ''}`
              : 'Service supervisé')}
        </p>
      </div>
    </div>
  );

  return (
    <div className="liquid-glass group flex flex-col justify-between rounded-3xl p-4 transition duration-200 hover:-translate-y-0.5 hover:!border-cyan-500/40">
      <div>
        <div className="flex items-start justify-between gap-2.5">
          {service.url ? (
            <a
              href={service.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block min-w-0 flex-1 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
            >
              {linkBody}
            </a>
          ) : (
            linkBody
          )}

          <div className="flex shrink-0 items-center gap-1.5">
            {!isCustom && onMoveService && (canMoveUp || canMoveDown) && (
              <div className="flex items-center gap-0.5 opacity-80 transition group-hover:opacity-100 md:opacity-0 md:group-focus-within:opacity-100">
                <button
                  type="button"
                  disabled={!canMoveUp}
                  onClick={() => void onMoveService(service, 'up')}
                  className="liquid-pill rounded-full p-1 text-slate-500 transition hover:text-slate-900 disabled:opacity-25 dark:text-slate-300 dark:hover:text-white"
                  title="Monter"
                  aria-label={`Monter ${service.name}`}
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={!canMoveDown}
                  onClick={() => void onMoveService(service, 'down')}
                  className="liquid-pill rounded-full p-1 text-slate-500 transition hover:text-slate-900 disabled:opacity-25 dark:text-slate-300 dark:hover:text-white"
                  title="Descendre"
                  aria-label={`Descendre ${service.name}`}
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>
            )}

            {!isCustom && onEditService && (
              <button
                type="button"
                onClick={() => onEditService(service, categoryName)}
                className="liquid-pill rounded-full p-1.5 text-slate-500 transition hover:text-cyan-600 dark:text-slate-300 dark:hover:text-cyan-300"
                title={`Personnaliser ${service.name}`}
                aria-label={`Personnaliser ${service.name}`}
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}

            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusPill.cls}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusPill.dot}`} />
              {statusPill.text}
            </span>
          </div>
        </div>

        {metricsEntries.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {metricsEntries.map(([key, val]) => (
              <span
                key={key}
                className="liquid-subcard inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:text-slate-200"
              >
                <span className="text-slate-500 dark:text-slate-400">{key}:</span>
                <span className="font-semibold">{String(val)}</span>
              </span>
            ))}
          </div>
        )}

        {isCustom && service.message && statusVal !== 'up' && (
          <p className="mt-2 truncate text-[11px] text-slate-600 dark:text-slate-300">
            {service.message}
          </p>
        )}
      </div>

      {service.widget && (
        <div className="mt-3.5 border-t border-slate-200/80 pt-3 dark:border-slate-800/80">
          {renderWidget(service.widget, widgets)}
        </div>
      )}

      {isCustom && customService && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-2.5 dark:border-white/10">
          <div className="flex flex-wrap items-center gap-1.5">
            {onTestCustom && (
              <button
                type="button"
                disabled={testing}
                onClick={() => void handleTest()}
                className="liquid-pill inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-cyan-700 transition hover:bg-cyan-500/15 disabled:opacity-50 dark:text-cyan-200"
              >
                {testing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                <span>Tester</span>
              </button>
            )}

            {protocol === 'webhook_ingest' && (
              <button
                type="button"
                onClick={() => void handleCopyWebhookUrl()}
                className="liquid-pill inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-500/15 dark:text-indigo-200"
                title="Copier l'URL Webhook"
              >
                {copiedWebhook ? (
                  <>
                    <Check className="h-3 w-3" /> Copié
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Webhook URL
                  </>
                )}
              </button>
            )}

            {lastTestBadge && (
              <span className="font-mono text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                {lastTestBadge}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {onMoveCustom && (
              <>
                <button
                  type="button"
                  disabled={!canMoveUp}
                  onClick={() => void onMoveCustom(customService, 'up')}
                  className="liquid-pill rounded-full p-1 text-slate-600 transition hover:text-slate-900 disabled:opacity-30 dark:text-slate-300 dark:hover:text-white"
                  title="Monter"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={!canMoveDown}
                  onClick={() => void onMoveCustom(customService, 'down')}
                  className="liquid-pill rounded-full p-1 text-slate-600 transition hover:text-slate-900 disabled:opacity-30 dark:text-slate-300 dark:hover:text-white"
                  title="Descendre"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
              </>
            )}

            {onEditCustom && (
              <button
                type="button"
                onClick={() => onEditCustom(customService)}
                className="liquid-pill rounded-full p-1 text-slate-600 transition hover:text-cyan-600 dark:text-slate-300 dark:hover:text-cyan-300"
                title="Modifier"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}

            {onDeleteCustom &&
              (!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="liquid-pill rounded-full p-1 text-slate-500 transition hover:text-rose-500 dark:text-slate-400 dark:hover:text-rose-300"
                  title="Supprimer"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      await onDeleteCustom(customService);
                    } finally {
                      setDeleting(false);
                      setConfirmDelete(false);
                    }
                  }}
                  onBlur={() => setConfirmDelete(false)}
                  className="rounded-full border border-rose-500/40 bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:text-rose-200"
                >
                  {deleting ? '…' : 'Confirmer'}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
