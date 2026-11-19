import { useState } from 'react';
import {
  AlertTriangle,
  Box,
  Clock,
  Cpu,
  HardDrive,
  Layers,
  MemoryStick,
  Monitor,
  Play,
  RotateCw,
  Server,
  Square,
} from 'lucide-react';
import type { PveAction, PveOverview, PveResource } from '../types';

interface ProxmoxSectionProps {
  overview: PveOverview | null;
  search: string;
  selectedNode: string;
  onSelectNode: (node: string) => void;
  onRequestAction: (resource: PveResource, action: PveAction) => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 Go';
  const gb = bytes / 1024 ** 3;
  if (gb >= 100) return `${gb.toFixed(0)} Go`;
  if (gb >= 1) return `${gb.toFixed(1)} Go`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} Mo`;
}

function progressTone(pct: number): string {
  if (pct >= 85) return 'bg-rose-500';
  if (pct >= 65) return 'bg-amber-500';
  return 'bg-cyan-500';
}

export function ProxmoxSection({
  overview,
  search,
  selectedNode,
  onSelectNode,
  onRequestAction,
}: ProxmoxSectionProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped'>('all');

  if (!overview) {
    return (
      <section className="liquid-glass rounded-3xl p-6">
        <div className="animate-pulse text-sm text-slate-500 dark:text-slate-400">
          Connexion à l’API Proxmox VE…
        </div>
      </section>
    );
  }

  const { node, counts, resources } = overview;
  const clusterNodes = overview.cluster_nodes || [];
  const activeNode = selectedNode || overview.selected_node || node.name;
  const isClusterMode = activeNode === '*' || activeNode === 'all';
  const isMultiNode = clusterNodes.length > 1;
  const query = search.trim().toLowerCase();

  const filteredResources = resources.filter((item) => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (!query) return true;
    return (
      item.name.toLowerCase().includes(query) ||
      String(item.vmid).includes(query) ||
      (item.node ? item.node.toLowerCase().includes(query) : false) ||
      item.tags.some((t) => t.toLowerCase().includes(query))
    );
  });

  const lvmStorage =
    node.storages.find((s) => s.name === 'local-lvm' || s.name.endsWith(':local-lvm')) ||
    node.storages[0];

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              overview.online
                ? 'bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.7)]'
                : 'bg-rose-500'
            }`}
          />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-300">
            {isClusterMode
              ? `Supervision Proxmox VE — ${node.name}`
              : `Supervision Proxmox VE — Nœud ${node.name}`}
          </h2>
          {node.pve_version && (
            <span className="rounded-md border border-slate-200 bg-white/75 px-2 py-0.5 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              {node.pve_version}
            </span>
          )}
        </div>

        <div className="liquid-pill flex items-center gap-1.5 rounded-full p-1 text-xs">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`rounded-full px-2.5 py-1 font-medium transition ${
              statusFilter === 'all'
                ? 'bg-cyan-500/20 text-cyan-800 dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Tous ({counts.total})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('running')}
            className={`rounded-full px-2.5 py-1 font-medium transition ${
              statusFilter === 'running'
                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Actifs ({counts.running})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('stopped')}
            className={`rounded-full px-2.5 py-1 font-medium transition ${
              statusFilter === 'stopped'
                ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Arrêtés ({counts.stopped})
          </button>
        </div>
      </div>

      {/* Sélecteur de nœuds du cluster Proxmox VE */}
      {(isMultiNode || isClusterMode) && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="liquid-pill flex flex-wrap items-center gap-1.5 rounded-2xl p-1 text-xs sm:rounded-full">
            <button
              type="button"
              onClick={() => onSelectNode('*')}
              aria-pressed={isClusterMode}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition ${
                isClusterMode
                  ? 'bg-cyan-500/20 text-cyan-800 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Layers className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" />
              <span>Tous les nœuds (*)</span>
            </button>
            {clusterNodes.map((cn) => {
              const selected = !isClusterMode && activeNode === cn.name;
              return (
                <button
                  key={cn.name}
                  type="button"
                  onClick={() => onSelectNode(cn.name)}
                  aria-pressed={selected}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition ${
                    selected
                      ? 'bg-cyan-500/20 text-cyan-800 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      cn.online
                        ? 'bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.7)]'
                        : 'bg-rose-500'
                    }`}
                  />
                  <span>{cn.name}</span>
                  <span className="font-mono text-[11px] opacity-75">
                    {cn.online ? `${cn.cpu_pct}%` : 'Hors ligne'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Bannière d'avertissement si failover automatique actif */}
      {overview.failover_active && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-xs text-amber-900 backdrop-blur dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold">Bascule automatique (Failover) activée :</span>{' '}
            le nœud principal est injoignable. Supervision redirigée automatiquement vers le nœud{' '}
            <span className="font-mono font-semibold">{overview.selected_node || node.name}</span>.
          </div>
        </div>
      )}

      {/* KPIs Nœud Proxmox */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="liquid-glass rounded-3xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <span className="flex items-center gap-1.5 font-medium">
              <Cpu className="h-4 w-4 text-cyan-500 dark:text-cyan-400" />
              Processeur ({node.cpu_threads} threads)
            </span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">{node.cpu_pct}%</span>
          </div>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ${progressTone(node.cpu_pct)}`}
              style={{ width: `${Math.min(node.cpu_pct, 100)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span className="truncate">{node.cpu_model}</span>
            <span className="shrink-0 pl-2">
              Load: {node.loadavg.slice(0, 3).join(' ')}
            </span>
          </div>
        </div>

        <div className="liquid-glass rounded-3xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <span className="flex items-center gap-1.5 font-medium">
              <MemoryStick className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
              Mémoire RAM
            </span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">{node.mem_pct}%</span>
          </div>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ${progressTone(node.mem_pct)}`}
              style={{ width: `${Math.min(node.mem_pct, 100)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span>
              {formatBytes(node.mem_used_bytes)} / {formatBytes(node.mem_total_bytes)}
            </span>
            <span>Swap: {formatBytes(node.swap_used_bytes)}</span>
          </div>
        </div>

        <div className="liquid-glass rounded-3xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <span className="flex items-center gap-1.5 font-medium">
              <HardDrive className="h-4 w-4 text-amber-500 dark:text-amber-400" />
              Stockage {lvmStorage ? lvmStorage.name : 'Système'}
            </span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {lvmStorage ? `${lvmStorage.used_pct}%` : '—'}
            </span>
          </div>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ${progressTone(
                lvmStorage?.used_pct || 0
              )}`}
              style={{ width: `${Math.min(lvmStorage?.used_pct || 0, 100)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span>
              {lvmStorage
                ? `${formatBytes(lvmStorage.used_bytes)} / ${formatBytes(lvmStorage.total_bytes)}`
                : 'N/A'}
            </span>
            <span>Root: {formatBytes(node.rootfs_used_bytes)}</span>
          </div>
        </div>

        <div className="liquid-glass rounded-3xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <span className="flex items-center gap-1.5 font-medium">
              <Clock className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
              Disponibilité &amp; Instances
            </span>
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">
              {node.uptime_human}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="liquid-subcard flex-1 rounded-xl px-3 py-1.5">
              <div className="text-[11px] text-slate-500">Conteneurs LXC</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {counts.lxc}
              </div>
            </div>
            <div className="liquid-subcard flex-1 rounded-xl px-3 py-1.5">
              <div className="text-[11px] text-slate-500">Machines VM</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {counts.qemu}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Liste des LXC & VMs */}
      <div className="liquid-glass overflow-hidden rounded-3xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-100/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800/80 dark:bg-slate-950/50 dark:text-slate-400">
                <th className="px-4 py-3">ID &amp; Nom</th>
                <th className="px-4 py-3">État</th>
                <th className="hidden px-4 py-3 md:table-cell">CPU</th>
                <th className="hidden px-4 py-3 sm:table-cell">RAM</th>
                <th className="hidden px-4 py-3 lg:table-cell">Uptime</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/60">
              {filteredResources.map((item) => {
                const isRunning = item.status === 'running';
                return (
                  <tr
                    key={`${item.node || 'node'}-${item.type}-${item.vmid}`}
                    className="transition hover:bg-black/[0.02] dark:hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs ${
                            item.type === 'qemu'
                              ? 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300'
                              : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
                          }`}
                          title={item.type === 'qemu' ? 'Machine Virtuelle' : 'Conteneur LXC'}
                        >
                          {item.type === 'qemu' ? (
                            <Monitor className="h-3.5 w-3.5" />
                          ) : (
                            <Box className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-slate-500">
                              #{item.vmid}
                            </span>
                            <span className="font-medium text-slate-900 dark:text-slate-100">
                              {item.name}
                            </span>
                            {(isClusterMode || isMultiNode) && item.node && (
                              <span className="inline-flex items-center gap-1 rounded border border-indigo-500/25 bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
                                <Server className="h-2.5 w-2.5" />
                                {item.node}
                              </span>
                            )}
                            {item.is_self && (
                              <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium text-cyan-700 dark:text-cyan-300">
                                Panel
                              </span>
                            )}
                          </div>
                          {item.tags.length > 0 && (
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {item.tags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded bg-slate-200/80 px-1.5 py-0.2 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          isRunning
                            ? 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border border-slate-300 bg-slate-200/70 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isRunning ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-500'
                          }`}
                        />
                        {isRunning ? 'Actif' : 'Arrêté'}
                      </span>
                    </td>

                    <td className="hidden px-4 py-2.5 md:table-cell">
                      {isRunning ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                            <div
                              className={`h-full rounded-full ${progressTone(item.cpu_pct)}`}
                              style={{ width: `${Math.min(item.cpu_pct, 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs text-slate-700 dark:text-slate-300">
                            {item.cpu_pct}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>

                    <td className="hidden px-4 py-2.5 sm:table-cell">
                      {isRunning ? (
                        <div className="text-xs text-slate-700 dark:text-slate-300">
                          <span className="font-mono">{formatBytes(item.mem_used_bytes)}</span>
                          <span className="text-slate-500">
                            {' '}
                            / {formatBytes(item.mem_total_bytes)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">
                          {formatBytes(item.mem_total_bytes)} max
                        </span>
                      )}
                    </td>

                    <td className="hidden px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 lg:table-cell">
                      {item.uptime_human}
                    </td>

                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {!isRunning ? (
                          <button
                            type="button"
                            onClick={() => onRequestAction(item, 'start')}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300"
                            title="Démarrer"
                          >
                            <Play className="h-3 w-3" />
                            <span className="hidden sm:inline">Démarrer</span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onRequestAction(item, 'reboot')}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-500/20 dark:text-amber-300"
                              title="Redémarrer"
                            >
                              <RotateCw className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              disabled={item.is_self}
                              onClick={() => onRequestAction(item, 'shutdown')}
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-35 dark:text-rose-300"
                              title={
                                item.is_self
                                  ? 'Protection du panel activée'
                                  : 'Arrêter proprement'
                              }
                            >
                              <Square className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredResources.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                    Aucune VM ou conteneur LXC ne correspond à ce filtre.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
