import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import type {
  IncidentsResponse,
  OpsOverview,
  PveOverview,
  ServiceCategory,
  UsersOverview,
} from '../types';

export type NavTabTarget = 'storage' | 'services' | 'proxmox' | 'users' | 'ops';

interface AlertsBannerProps {
  pveOverview: PveOverview | null;
  categories: ServiceCategory[];
  usersOverview: UsersOverview | null;
  opsOverview: OpsOverview | null;
  incidentsData?: IncidentsResponse | null;
  onJumpToTab: (tab: NavTabTarget) => void;
}

interface AlertItem {
  id: string;
  severity: 'warn' | 'critical';
  text: string;
  tab: NavTabTarget;
}

export function AlertsBanner({
  pveOverview,
  categories,
  usersOverview,
  opsOverview,
  incidentsData,
  onJumpToTab,
}: AlertsBannerProps) {
  const [expanded, setExpanded] = useState(false);

  const alerts: AlertItem[] = [];

  const openIncidents = (incidentsData?.incidents || []).filter((i) => i.resolved_at === null);
  if (openIncidents.length > 0) {
    alerts.push({
      id: 'active-incidents',
      severity: openIncidents.some((i) => i.severity === 'critical') ? 'critical' : 'warn',
      text: `${openIncidents.length} incident(s) actif(s) : ${openIncidents
        .slice(0, 2)
        .map((i) => i.service_name)
        .join(', ')}${openIncidents.length > 2 ? '…' : ''}`,
      tab: 'ops',
    });
  }

  const offlineServices = categories.flatMap((c) =>
    c.services
      .filter((s) => !s.online && s.enabled !== false && s.status !== 'disabled')
      .map((s) => s.name)
  );
  if (offlineServices.length > 0) {
    alerts.push({
      id: 'offline-svcs',
      severity: 'critical',
      text: `${offlineServices.length} service(s) hors ligne : ${offlineServices.join(', ')}`,
      tab: 'services',
    });
  }

  const highLvm = (pveOverview?.node.storages || []).find(
    (s) => (s.name === 'local-lvm' || s.name.endsWith(':local-lvm')) && s.used_pct >= 80
  );
  if (highLvm) {
    alerts.push({
      id: 'lvm-warn',
      severity: highLvm.used_pct >= 90 ? 'critical' : 'warn',
      text: `Stockage Proxmox ${highLvm.name} à ${highLvm.used_pct}%`,
      tab: 'storage',
    });
  }

  const fullDrives = (pveOverview?.external_storage?.drives || []).filter(
    (d) => d.used_pct >= 90
  );
  if (fullDrives.length > 0) {
    alerts.push({
      id: 'full-drives',
      severity: 'warn',
      text: `${fullDrives.length} disque(s) du pool ≥ 90% (${fullDrives
        .slice(0, 3)
        .map((d) => `${d.mount} ${d.used_pct}%`)
        .join(', ')}${fullDrives.length > 3 ? '…' : ''})`,
      tab: 'storage',
    });
  }

  const pendingSeerr = (opsOverview?.seerr_requests || []).filter(
    (r) => r.status === 1
  ).length;
  if (pendingSeerr > 0) {
    alerts.push({
      id: 'seerr-pending',
      severity: 'warn',
      text: `${pendingSeerr} demande(s) Jellyseerr en attente d'approbation`,
      tab: 'ops',
    });
  }

  if (usersOverview && usersOverview.counts.unsynced_count > 0) {
    alerts.push({
      id: 'users-unsynced',
      severity: 'warn',
      text: `${usersOverview.counts.unsynced_count} utilisateur(s) Jellyfin non synchronisé(s) sur Jellyseerr`,
      tab: 'users',
    });
  }

  if (alerts.length === 0) return null;

  const hasCritical = alerts.some((a) => a.severity === 'critical');

  return (
    <div
      className={`rounded-2xl border px-4 py-2.5 backdrop-blur ${
        hasCritical
          ? 'border-rose-500/35 bg-rose-500/10'
          : 'border-amber-500/30 bg-amber-500/10'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-2.5 text-left"
        >
          <AlertTriangle
            className={`h-4 w-4 shrink-0 ${
              hasCritical ? 'text-rose-500 dark:text-rose-400' : 'text-amber-500 dark:text-amber-400'
            }`}
          />
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            {alerts.length} point{alerts.length > 1 ? 's' : ''} d’attention détecté
            {alerts.length > 1 ? 's' : ''}
          </span>
          <span className="hidden truncate text-xs text-slate-600 dark:text-slate-300 sm:inline">
            — {alerts[0].text}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-lg p-1 text-slate-600 hover:bg-black/5 dark:text-slate-300 dark:hover:bg-slate-900/50"
          title={expanded ? 'Masquer le détail' : 'Afficher le détail'}
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="mt-2.5 grid grid-cols-1 gap-1.5 border-t border-slate-300/60 pt-2.5 dark:border-slate-800/60 sm:grid-cols-2">
          {alerts.map((alert) => (
            <button
              key={alert.id}
              type="button"
              onClick={() => onJumpToTab(alert.tab)}
              className="liquid-pill flex items-center justify-between gap-2 rounded-2xl px-3 py-2 text-left text-xs text-slate-800 transition hover:!border-cyan-500/40 active:scale-[0.98] dark:text-slate-100"
            >
              <span className="truncate">{alert.text}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
