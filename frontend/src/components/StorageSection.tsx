import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  Database,
  Disc,
  HardDrive,
  Layers,
  Monitor,
  Server,
} from 'lucide-react';
import type { PveOverview } from '../types';

interface StorageSectionProps {
  overview: PveOverview | null;
  search: string;
}

type DriveSort = 'usage' | 'size' | 'mount';

function formatCapacity(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 Go';
  const tb = bytes / 1024 ** 4;
  if (tb >= 1) return `${tb.toFixed(2)} Tio`;
  const gb = bytes / 1024 ** 3;
  if (gb >= 10) return `${gb.toFixed(0)} Gio`;
  if (gb >= 1) return `${gb.toFixed(1)} Gio`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} Mio`;
}

function formatDecimalTB(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 To';
  const tb = bytes / 1e12;
  if (tb >= 1) return `${tb.toFixed(1)} To`;
  const gb = bytes / 1e9;
  return `${gb.toFixed(0)} Go`;
}

function barTone(pct: number): string {
  if (pct >= 90) return 'bg-rose-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-cyan-500';
}

function pctTextTone(pct: number): string {
  if (pct >= 90) return 'text-rose-700 dark:text-rose-300';
  if (pct >= 70) return 'text-amber-700 dark:text-amber-300';
  return 'text-cyan-700 dark:text-cyan-300';
}

function smartBadge(health: string) {
  const upper = health.toUpperCase();
  if (upper === 'PASSED' || upper === 'OK') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        SMART OK
      </span>
    );
  }
  if (upper === 'UNKNOWN' || !upper) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-200/70 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        USB / N/A
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-300">
      <AlertTriangle className="h-3 w-3" />
      {upper}
    </span>
  );
}

export function StorageSection({ overview, search }: StorageSectionProps) {
  const [sortBy, setSortBy] = useState<DriveSort>('usage');

  if (!overview) {
    return (
      <section className="liquid-glass rounded-3xl p-6">
        <div className="animate-pulse text-sm text-slate-500 dark:text-slate-400">
          Chargement des métriques de stockage et des disques physiques…
        </div>
      </section>
    );
  }

  const { node, resources, external_storage } = overview;
  const pool = external_storage?.pool;
  const rawDrives = external_storage?.drives || [];
  const systemSsd = external_storage?.system_ssd;

  const query = search.trim().toLowerCase();
  const filteredDrives = rawDrives
    .filter(
      (d) =>
        !query ||
        d.mount.toLowerCase().includes(query) ||
        d.label.toLowerCase().includes(query) ||
        d.model.toLowerCase().includes(query) ||
        d.devpath.toLowerCase().includes(query) ||
        d.serial.toLowerCase().includes(query)
    )
    .sort((a, b) => {
      if (sortBy === 'usage') return b.used_pct - a.used_pct;
      if (sortBy === 'size') return b.total_bytes - a.total_bytes;
      return a.mount.localeCompare(b.mount);
    });

  const sortedResources = [...resources]
    .filter(
      (r) =>
        !query ||
        r.name.toLowerCase().includes(query) ||
        String(r.vmid).includes(query)
    )
    .sort((a, b) => b.disk_total_bytes - a.disk_total_bytes);

  const rootPct =
    node.rootfs_total_bytes > 0
      ? Math.round((node.rootfs_used_bytes / node.rootfs_total_bytes) * 1000) / 10
      : 0;
  const swapPct =
    node.swap_total_bytes > 0
      ? Math.round((node.swap_used_bytes / node.swap_total_bytes) * 1000) / 10
      : 0;

  return (
    <section className="space-y-8">
      {/* 1. Pool Médias MergerFS */}
      {pool && (
        <div className="liquid-glass-elevated rounded-3xl border-cyan-500/25 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
                <Layers className="h-6 w-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {pool.name}
                  </h2>
                  <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[11px] font-medium text-cyan-700 dark:text-cyan-300">
                    {pool.drives_count} disques fusionnés
                  </span>
                  {pool.mount && (
                    <span className="rounded-md border border-slate-300 bg-white/75 px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
                      {pool.mount}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Système de fichiers{' '}
                  <span className="text-slate-700 dark:text-slate-300">{pool.fstype}</span> •
                  Politique d’écriture :{' '}
                  <span className="text-slate-700 dark:text-slate-300">{pool.policy}</span>
                </p>
              </div>
            </div>

            <div className="text-left sm:text-right">
              <div className={`text-2xl font-bold ${pctTextTone(pool.used_pct)}`}>
                {pool.used_pct}% utilisé
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {formatDecimalTB(pool.total_bytes)} bruts ({formatCapacity(pool.total_bytes)})
              </div>
            </div>
          </div>

          <div className="mt-4 h-3.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800/90">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barTone(
                pool.used_pct
              )}`}
              style={{ width: `${Math.min(pool.used_pct, 100)}%` }}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="liquid-subcard rounded-xl p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">
                Espace utilisé
              </div>
              <div className="mt-1 font-mono text-base font-semibold text-slate-900 dark:text-slate-100">
                {formatCapacity(pool.used_bytes)}
              </div>
              <div className="text-[11px] text-slate-500">
                ({formatDecimalTB(pool.used_bytes)})
              </div>
            </div>
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3">
              <div className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400/80">
                Espace libre disponible
              </div>
              <div className="mt-1 font-mono text-base font-semibold text-emerald-800 dark:text-emerald-300">
                {formatCapacity(pool.avail_bytes)}
              </div>
              <div className="text-[11px] text-emerald-700/80 dark:text-emerald-400/70">
                ({formatDecimalTB(pool.avail_bytes)} restants)
              </div>
            </div>
            <div className="liquid-subcard rounded-xl p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">
                Capacité totale du pool
              </div>
              <div className="mt-1 font-mono text-base font-semibold text-slate-900 dark:text-slate-100">
                {formatCapacity(pool.total_bytes)}
              </div>
              <div className="text-[11px] text-slate-500">
                ({formatDecimalTB(pool.total_bytes)})
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Stockage Système Proxmox */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-300">
              Stockage Proxmox VE (SSD Système)
            </h3>
          </div>
          {systemSsd && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span className="font-mono text-slate-800 dark:text-slate-300">{systemSsd.devpath}</span>
              <span>• {systemSsd.model.replace(/_/g, ' ')}</span>
              <span>• {formatDecimalTB(systemSsd.size_bytes)}</span>
              {smartBadge(systemSsd.health)}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {node.storages.map((st) => (
            <div key={st.name} className="liquid-glass rounded-3xl p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{st.name}</span>
                </div>
                <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  {st.type}
                </span>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className={`font-mono text-lg font-bold ${pctTextTone(st.used_pct)}`}>
                  {st.used_pct}%
                </span>
                <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
                  {formatCapacity(st.used_bytes)} / {formatCapacity(st.total_bytes)}
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className={`h-full rounded-full ${barTone(st.used_pct)}`}
                  style={{ width: `${Math.min(st.used_pct, 100)}%` }}
                />
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Libre : {formatCapacity(Math.max(0, st.total_bytes - st.used_bytes))}
              </div>
            </div>
          ))}

          <div className="liquid-glass rounded-3xl p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-500 dark:text-cyan-400" />
                <span className="font-semibold text-slate-900 dark:text-slate-100">pve-root (OS)</span>
              </div>
              <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                ext4
              </span>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className={`font-mono text-lg font-bold ${pctTextTone(rootPct)}`}>
                {rootPct}%
              </span>
              <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
                {formatCapacity(node.rootfs_used_bytes)} /{' '}
                {formatCapacity(node.rootfs_total_bytes)}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className={`h-full rounded-full ${barTone(rootPct)}`}
                style={{ width: `${Math.min(rootPct, 100)}%` }}
              />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Libre :{' '}
              {formatCapacity(Math.max(0, node.rootfs_total_bytes - node.rootfs_used_bytes))}
            </div>
          </div>

          <div className="liquid-glass rounded-3xl p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Disc className="h-4 w-4 text-amber-500 dark:text-amber-400" />
                <span className="font-semibold text-slate-900 dark:text-slate-100">Mémoire Swap</span>
              </div>
              <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                lvm
              </span>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className={`font-mono text-lg font-bold ${pctTextTone(swapPct)}`}>
                {swapPct}%
              </span>
              <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
                {formatCapacity(node.swap_used_bytes)} / {formatCapacity(node.swap_total_bytes)}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className={`h-full rounded-full ${barTone(swapPct)}`}
                style={{ width: `${Math.min(swapPct, 100)}%` }}
              />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Libre :{' '}
              {formatCapacity(Math.max(0, node.swap_total_bytes - node.swap_used_bytes))}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Détail des Disques Physiques */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-cyan-500 dark:text-cyan-400" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-300">
              Disques Durs Physiques du Pool ({filteredDrives.length})
            </h3>
          </div>

          <div className="liquid-pill flex items-center gap-1.5 rounded-full p-1 text-xs">
            <button
              type="button"
              onClick={() => setSortBy('usage')}
              className={`rounded-full px-2.5 py-1 font-medium transition ${
                sortBy === 'usage'
                  ? 'bg-cyan-500/20 text-cyan-800 dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Par % utilisé
            </button>
            <button
              type="button"
              onClick={() => setSortBy('size')}
              className={`rounded-full px-2.5 py-1 font-medium transition ${
                sortBy === 'size'
                  ? 'bg-cyan-500/20 text-cyan-800 dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Par capacité
            </button>
            <button
              type="button"
              onClick={() => setSortBy('mount')}
              className={`rounded-full px-2.5 py-1 font-medium transition ${
                sortBy === 'mount'
                  ? 'bg-cyan-500/20 text-cyan-800 dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Par montage
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredDrives.map((drive) => (
            <div
              key={drive.mount}
              className="liquid-glass flex flex-col justify-between rounded-3xl p-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                        {drive.mount}
                      </span>
                      {drive.devpath && (
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          {drive.devpath}
                        </span>
                      )}
                      {drive.rpm && drive.rpm !== '0' && (
                        <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                          {drive.rpm} RPM
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                      {drive.label}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500">
                      {drive.model.replace(/_/g, ' ')}
                      {drive.serial ? ` • S/N ${drive.serial}` : ''}
                    </div>
                  </div>
                  {smartBadge(drive.health)}
                </div>

                <div className="mt-3.5 flex items-baseline justify-between">
                  <span className={`font-mono text-base font-bold ${pctTextTone(drive.used_pct)}`}>
                    {drive.used_pct}%
                  </span>
                  <span className="font-mono text-xs text-slate-700 dark:text-slate-300">
                    {formatCapacity(drive.used_bytes)} /{' '}
                    <span className="text-slate-500 dark:text-slate-400">
                      {formatCapacity(drive.total_bytes)}
                    </span>
                  </span>
                </div>

                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barTone(
                      drive.used_pct
                    )}`}
                    style={{ width: `${Math.min(drive.used_pct, 100)}%` }}
                  />
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-between border-t border-slate-200/80 pt-2 text-[11px] text-slate-500 dark:border-slate-800/70 dark:text-slate-400">
                <span>
                  Libre :{' '}
                  <span className="font-medium text-emerald-700 dark:text-emerald-300">
                    {formatCapacity(drive.avail_bytes)}
                  </span>
                </span>
                <span>Brut : {formatDecimalTB(drive.size_bytes)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Disques alloués aux VMs & Conteneurs LXC */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Box className="h-4 w-4 text-cyan-500 dark:text-cyan-400" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-300">
            Allocation Disque des VMs &amp; Conteneurs LXC ({sortedResources.length})
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {sortedResources.map((res) => {
            const pct =
              res.disk_total_bytes > 0
                ? Math.round((res.disk_used_bytes / res.disk_total_bytes) * 1000) / 10
                : 0;
            return (
              <div
                key={`${res.node || 'node'}-${res.type}-${res.vmid}`}
                className="liquid-glass rounded-2xl p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-slate-400">
                      {res.type === 'qemu' ? (
                        <Monitor className="h-3.5 w-3.5 text-purple-600 dark:text-purple-300" />
                      ) : (
                        <Box className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" />
                      )}
                    </span>
                    <span className="font-mono text-xs text-slate-500">#{res.vmid}</span>
                    <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {res.name}
                    </span>
                    {res.node && (overview.cluster_nodes?.length || 0) > 1 && (
                      <span className="shrink-0 rounded border border-indigo-500/25 bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] text-indigo-700 dark:text-indigo-300">
                        {res.node}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-xs text-slate-700 dark:text-slate-300">
                    {formatCapacity(res.disk_total_bytes)}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full ${barTone(pct)}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    {res.disk_used_bytes > 0
                      ? `${formatCapacity(res.disk_used_bytes)} utilisés (${pct}%)`
                      : 'Disque thin / non mesuré'}
                  </span>
                  <span>{res.status === 'running' ? 'Actif' : 'Arrêté'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
