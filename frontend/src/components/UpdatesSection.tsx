import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowUpCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Container,
  Copy,
  ExternalLink,
  KeyRound,
  Layers,
  Loader2,
  PackageCheck,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  Terminal,
  X,
  XCircle,
} from 'lucide-react';
import type {
  UpdateCategory,
  UpdateJob,
  UpdatesOverviewResponse,
  UpdatesSetupInfoResponse,
  UpdateTargetItem,
} from '../types';

interface UpdatesSectionProps {
  overview: UpdatesOverviewResponse | null;
  onRefreshUpdates: () => Promise<void>;
  onToast: (toast: { type: 'success' | 'error'; message: string }) => void;
  desktopUpdateSlot?: ReactNode;
}

const CATEGORY_META: Record<
  UpdateCategory,
  { label: string; badge: string; icon: typeof Server }
> = {
  pve_center: { label: 'PVE Command Center', badge: 'Plateforme', icon: Rocket },
  proxmox: { label: 'Nœuds Proxmox VE', badge: 'APT Hôte', icon: Server },
  containers_vms: { label: 'Conteneurs LXC & VMs', badge: 'OS Invités', icon: Layers },
  docker: { label: 'Stacks Docker', badge: 'Compose', icon: Container },
};

export function UpdatesSection({
  overview,
  onRefreshUpdates,
  onToast,
  desktopUpdateSlot,
}: UpdatesSectionProps) {
  const [filterCat, setFilterCat] = useState<'all' | UpdateCategory>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [includePanelSelf, setIncludePanelSelf] = useState(true);
  const [autoremove, setAutoremove] = useState(true);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [liveJob, setLiveJob] = useState<UpdateJob | null>(overview?.active_job ?? null);
  const [expandedPkgIds, setExpandedPkgIds] = useState<Set<string>>(new Set());

  const [sshModalOpen, setSshModalOpen] = useState(false);
  const [sshSetupInfo, setSshSetupInfo] = useState<UpdatesSetupInfoResponse | null>(null);
  const [loadingSsh, setLoadingSsh] = useState(false);
  const [rotatingSsh, setRotatingSsh] = useState(false);

  useEffect(() => {
    if (overview?.active_job) {
      setLiveJob(overview.active_job);
    }
  }, [overview?.active_job]);

  const activeJob = liveJob ?? overview?.active_job ?? null;
  const isJobRunning = activeJob?.status === 'running';

  useEffect(() => {
    if (!isJobRunning) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const resp = await fetch('/api/updates/jobs/current');
        if (!resp.ok || cancelled) return;
        const data = (await resp.json()) as {
          active_job?: UpdateJob | null;
        };
        if (cancelled || !data.active_job) return;
        setLiveJob(data.active_job);
        if (data.active_job.status !== 'running') {
          void onRefreshUpdates();
        }
      } catch {
        // Retry next interval
      }
    };
    const timer = window.setInterval(() => void poll(), 1400);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isJobRunning, onRefreshUpdates]);

  const targets = overview?.targets ?? [];
  const filteredTargets = useMemo(() => {
    if (filterCat === 'all') return targets;
    return targets.filter((t) => t.category === filterCat);
  }, [targets, filterCat]);

  const executableTargets = useMemo(
    () => targets.filter((t) => t.can_execute),
    [targets]
  );

  const updatableExecutableCount = useMemo(
    () =>
      executableTargets.filter(
        (t) =>
          (t.id !== 'panel:server' || includePanelSelf) &&
          (t.update_available || t.category === 'containers_vms' || t.category === 'docker')
      ).length,
    [executableTargets, includePanelSelf]
  );

  const handleCheckAll = useCallback(async () => {
    setChecking(true);
    try {
      const resp = await fetch('/api/updates/check', { method: 'POST' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.detail || `Erreur HTTP ${resp.status}`);
      }
      await onRefreshUpdates();
      onToast({
        type: 'success',
        message: 'Inventaire des mises à jour actualisé.',
      });
    } catch (err) {
      onToast({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Impossible de vérifier les mises à jour.',
      });
    } finally {
      setChecking(false);
    }
  }, [onRefreshUpdates, onToast]);

  const handleRunTargets = useCallback(
    async (targetIds: string[]) => {
      setStarting(true);
      setConfirmAllOpen(false);
      setShowLogs(true);
      try {
        const resp = await fetch('/api/updates/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_ids: targetIds,
            include_panel_self: includePanelSelf,
            autoremove,
          }),
        });
        const data = (await resp.json().catch(() => ({}))) as {
          job?: UpdateJob;
          detail?: string;
        };
        if (!resp.ok) {
          throw new Error(data.detail || `Erreur HTTP ${resp.status}`);
        }
        if (data.job) {
          setLiveJob(data.job);
        }
        setSelectedIds(new Set());
        onToast({
          type: 'success',
          message:
            targetIds.includes('all')
              ? 'Mise à jour globale lancée.'
              : `Mise à jour lancée pour ${targetIds.length} cible(s).`,
        });
      } catch (err) {
        onToast({
          type: 'error',
          message:
            err instanceof Error ? err.message : 'Impossible de démarrer la mise à jour.',
        });
      } finally {
        setStarting(false);
      }
    },
    [autoremove, includePanelSelf, onToast]
  );

  const openSshModal = async () => {
    setSshModalOpen(true);
    setLoadingSsh(true);
    try {
      const resp = await fetch('/api/updates/setup-info');
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.detail || `Erreur HTTP ${resp.status}`);
      }
      setSshSetupInfo(data as UpdatesSetupInfoResponse);
    } catch (err) {
      onToast({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Accès admin requis pour consulter la clé SSH.',
      });
    } finally {
      setLoadingSsh(false);
    }
  };

  const handleRotateSsh = async () => {
    setRotatingSsh(true);
    try {
      const resp = await fetch('/api/updates/ssh-key/rotate', { method: 'POST' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.detail || `Erreur HTTP ${resp.status}`);
      }
      setSshSetupInfo(data as UpdatesSetupInfoResponse);
      onToast({
        type: 'success',
        message: 'Nouvelle clé Ed25519 générée. Pensez à l’autoriser sur Proxmox.',
      });
      void onRefreshUpdates();
    } catch (err) {
      onToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Rotation SSH impossible.',
      });
    } finally {
      setRotatingSsh(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast({ type: 'success', message: `${label} copié dans le presse-papier.` });
    } catch {
      onToast({ type: 'error', message: 'Copie impossible dans ce navigateur.' });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePkgPreview = (id: string) => {
    setExpandedPkgIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const groupedByCategory = useMemo(() => {
    const groups: Array<{ category: UpdateCategory; items: UpdateTargetItem[] }> = [];
    const order: UpdateCategory[] = ['pve_center', 'proxmox', 'containers_vms', 'docker'];
    for (const cat of order) {
      const items = filteredTargets.filter((t) => t.category === cat);
      if (items.length > 0) {
        groups.push({ category: cat, items });
      }
    }
    return groups;
  }, [filteredTargets]);

  return (
    <section className="space-y-6">
      {/* En-tête & Action globale */}
      <div className="liquid-glass-elevated rounded-3xl p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/35 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300">
              <ArrowUpCircle className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white sm:text-lg">
                Centre de Mises à Jour Unifié
              </h2>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                Pilotez les mises à jour de PVE Command Center, Proxmox VE, conteneurs LXC/VMs et piles Docker Compose depuis un point central.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="liquid-pill inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-slate-700 dark:text-slate-200">
                  <PackageCheck className="h-3.5 w-3.5 text-cyan-500" />
                  {overview?.summary.updates_available ?? 0} cible(s) avec mise(s) à jour
                </span>
                <button
                  type="button"
                  onClick={() => void openSshModal()}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition active:scale-95 ${
                    overview?.ssh_configured
                      ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'border-amber-500/35 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  {overview?.ssh_configured
                    ? `SSH Proxmox prêt (${overview.ssh_host})`
                    : 'Configurer clé SSH Proxmox'}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void handleCheckAll()}
              disabled={checking || isJobRunning}
              className="liquid-pill inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:text-slate-950 disabled:opacity-50 dark:text-slate-200 dark:hover:text-white"
            >
              {checking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Vérifier tout
            </button>

            <button
              type="button"
              onClick={() => setConfirmAllOpen(true)}
              disabled={starting || isJobRunning || updatableExecutableCount === 0}
              className="cider-accent-btn inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {starting || isJobRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Rocket className="h-3.5 w-3.5" />
              )}
              Tout mettre à jour ({updatableExecutableCount})
            </button>
          </div>
        </div>

        {/* Options rapides */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-3 text-xs dark:border-white/10">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', 'Toutes les cibles'],
                ['pve_center', 'PVE Center'],
                ['proxmox', 'Proxmox VE'],
                ['containers_vms', 'LXC & VMs'],
                ['docker', 'Docker Compose'],
              ] as const
            ).map(([catKey, catLabel]) => (
              <button
                key={catKey}
                type="button"
                onClick={() => setFilterCat(catKey)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  filterCat === catKey
                    ? 'cider-accent-ring border text-slate-900 dark:text-white'
                    : 'liquid-pill text-slate-600 dark:text-slate-300'
                }`}
              >
                {catLabel}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600 dark:text-slate-300">
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={includePanelSelf}
                onChange={(e) => setIncludePanelSelf(e.target.checked)}
                className="rounded border-slate-300 text-cyan-500 focus:ring-cyan-500"
              />
              Inclure pve-panel en dernier
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={autoremove}
                onChange={(e) => setAutoremove(e.target.checked)}
                className="rounded border-slate-300 text-cyan-500 focus:ring-cyan-500"
              />
              apt autoremove
            </label>
          </div>
        </div>
      </div>

      {/* Confirmation Tout mettre à jour */}
      {confirmAllOpen && (
        <div className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-100">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">
                Confirmer la mise à jour centralisée de {updatableExecutableCount} cible(s) ?
              </p>
              <p className="mt-1 text-amber-800/90 dark:text-amber-200/80">
                Les paquets système Proxmox/LXC/VM et images Docker seront mis à jour séquentiellement. Si <code>pve-panel</code> est inclus, son redémarrage s’exécutera en dernier.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmAllOpen(false)}
                className="liquid-pill rounded-xl px-3.5 py-2 font-medium"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void handleRunTargets(['all'])}
                className="cider-accent-btn rounded-xl px-4 py-2 font-semibold text-white"
              >
                Lancer maintenant
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barre sélection multiple */}
      {selectedIds.size > 0 && (
        <div className="liquid-glass-elevated flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 text-xs">
          <span className="font-semibold text-slate-800 dark:text-slate-100">
            {selectedIds.size} cible(s) sélectionnée(s)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="liquid-pill rounded-xl px-3 py-1.5 font-medium"
            >
              Effacer
            </button>
            <button
              type="button"
              disabled={starting || isJobRunning}
              onClick={() => void handleRunTargets(Array.from(selectedIds))}
              className="cider-accent-btn rounded-xl px-3.5 py-1.5 font-semibold text-white disabled:opacity-50"
            >
              Mettre à jour la sélection ({selectedIds.size})
            </button>
          </div>
        </div>
      )}

      {/* Console de progression & logs temps réel */}
      {activeJob && (
        <div className="liquid-glass-card rounded-3xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {activeJob.status === 'running' ? (
                <Loader2 className="h-4 w-4 animate-spin text-cyan-500" />
              ) : activeJob.status === 'succeeded' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <XCircle className="h-4 w-4 text-rose-500" />
              )}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Opération {activeJob.id} — {activeJob.progress_pct}%
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {activeJob.steps.filter((s) => s.status === 'succeeded').length}/
                  {activeJob.steps.length} cible(s) terminée(s)
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowLogs((v) => !v)}
              className="liquid-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium"
            >
              <Terminal className="h-3.5 w-3.5" />
              {showLogs ? 'Masquer logs' : 'Afficher logs'}
            </button>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            <div
              className={`h-full transition-all duration-300 ${
                activeJob.status === 'failed'
                  ? 'bg-rose-500'
                  : activeJob.status === 'succeeded'
                    ? 'bg-emerald-500'
                    : 'bg-cyan-500'
              }`}
              style={{ width: `${Math.max(4, activeJob.progress_pct)}%` }}
            />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {activeJob.steps.map((step) => (
              <div
                key={step.target_id}
                className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200/70 bg-white/40 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/[0.03]"
              >
                <span className="truncate font-medium text-slate-800 dark:text-slate-100">
                  {step.name}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    step.status === 'succeeded'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : step.status === 'failed'
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                        : step.status === 'running'
                          ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                          : 'bg-slate-500/15 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {step.status === 'running'
                    ? 'En cours'
                    : step.status === 'succeeded'
                      ? 'OK'
                      : step.status === 'failed'
                        ? 'Échec'
                        : 'Attente'}
                </span>
              </div>
            ))}
          </div>

          {showLogs && activeJob.logs.length > 0 && (
            <pre className="mt-3 max-h-56 overflow-y-auto rounded-2xl border border-slate-800/70 bg-slate-950/90 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
              {activeJob.logs.join('\n')}
            </pre>
          )}
        </div>
      )}

      {/* Slot optionnel mise à jour Desktop Tauri */}
      {desktopUpdateSlot}

      {/* Cartes par catégorie */}
      {groupedByCategory.map(({ category, items }) => {
        const meta = CATEGORY_META[category];
        const CatIcon = meta.icon;
        return (
          <div key={category} className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CatIcon className="h-4 w-4 text-cyan-500 dark:text-cyan-300" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  {meta.label}
                </h3>
              </div>
              <span className="text-xs text-slate-500">
                {items.filter((i) => i.update_available).length}/{items.length} à mettre à jour
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => {
                const isSelected = selectedIds.has(item.id);
                const pkgExpanded = expandedPkgIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`liquid-glass-card flex flex-col justify-between rounded-3xl p-4 transition ${
                      isSelected ? 'ring-2 ring-cyan-500/60' : ''
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                          {item.can_execute && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(item.id)}
                              className="mt-1 rounded border-slate-300 text-cyan-500 focus:ring-cyan-500"
                            />
                          )}
                          <div className="min-w-0">
                            <h4 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                              {item.name}
                            </h4>
                            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                              {item.subtitle}
                            </p>
                          </div>
                        </label>

                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                            item.update_available
                              ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                              : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          {item.update_available ? item.latest_version : 'À jour'}
                        </span>
                      </div>

                      {item.packages_preview.length > 0 && (
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => togglePkgPreview(item.id)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-700 hover:underline dark:text-cyan-300"
                          >
                            {item.packages_preview.length} élément(s) détaillé(s)
                            {pkgExpanded ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </button>
                          {pkgExpanded && (
                            <ul className="mt-1.5 space-y-1 rounded-xl border border-slate-200/70 bg-white/40 p-2 font-mono text-[10px] text-slate-700 dark:border-white/10 dark:bg-black/25 dark:text-slate-300">
                              {item.packages_preview.map((pkg) => (
                                <li key={pkg} className="truncate">
                                  {pkg}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-200/70 pt-3 dark:border-white/10">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {item.current_version}
                      </span>

                      {item.can_execute ? (
                        <button
                          type="button"
                          disabled={starting || isJobRunning}
                          onClick={() => void handleRunTargets([item.id])}
                          className="liquid-pill inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-cyan-700 transition hover:border-cyan-500/50 disabled:opacity-50 dark:text-cyan-200"
                        >
                          <ArrowUpCircle className="h-3.5 w-3.5" />
                          Mettre à jour
                        </button>
                      ) : item.release_url ? (
                        <a
                          href={item.release_url}
                          target="_blank"
                          rel="noreferrer"
                          className="liquid-pill inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:text-slate-950 dark:text-slate-200 dark:hover:text-white"
                        >
                          Releases
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          {item.requires_ssh && !overview?.ssh_configured
                            ? 'SSH requis'
                            : 'Hors ligne'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Modal Configuration Clé SSH Proxmox */}
      {sshModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-md sm:items-center sm:p-4"
          onClick={() => setSshModalOpen(false)}
        >
          <div
            className="ios-sheet safe-bottom-sheet max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-[32px] p-5 text-slate-900 dark:text-slate-100 sm:rounded-3xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/35 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    Accès SSH Ed25519 vers l’hôte Proxmox
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Autorise pve-panel à exécuter <code>apt</code>, <code>pct exec</code> et <code>docker compose pull</code>.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSshModalOpen(false)}
                className="liquid-pill rounded-full p-2 text-slate-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {loadingSsh ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
              </div>
            ) : sshSetupInfo ? (
              <div className="mt-4 space-y-4 text-xs">
                <div
                  className={`rounded-2xl border p-3 ${
                    sshSetupInfo.ssh_configured
                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                      : 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                  }`}
                >
                  {sshSetupInfo.ssh_message}
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between font-medium">
                    <span>Commande à coller dans le shell root Proxmox VE</span>
                    <button
                      type="button"
                      onClick={() =>
                        void copyText(sshSetupInfo.proxmox_one_liner, 'Commande Proxmox')
                      }
                      className="inline-flex items-center gap-1 text-cyan-600 hover:underline dark:text-cyan-300"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copier
                    </button>
                  </div>
                  <pre className="overflow-x-auto rounded-2xl border border-slate-800/70 bg-slate-950/90 p-3 font-mono text-[11px] text-slate-200">
                    {sshSetupInfo.proxmox_one_liner}
                  </pre>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between font-medium">
                    <span>Clé publique Ed25519</span>
                    <button
                      type="button"
                      onClick={() =>
                        void copyText(sshSetupInfo.ssh_public_key, 'Clé publique')
                      }
                      className="inline-flex items-center gap-1 text-cyan-600 hover:underline dark:text-cyan-300"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copier
                    </button>
                  </div>
                  <pre className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/50 p-2.5 font-mono text-[11px] dark:border-white/10 dark:bg-white/[0.04]">
                    {sshSetupInfo.ssh_public_key}
                  </pre>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <button
                    type="button"
                    disabled={rotatingSsh}
                    onClick={() => void handleRotateSsh()}
                    className="liquid-pill inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 font-medium text-rose-600 dark:text-rose-300"
                  >
                    {rotatingSsh && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Régénérer la clé
                  </button>
                  <button
                    type="button"
                    onClick={() => void openSshModal().then(() => onRefreshUpdates())}
                    className="cider-accent-btn rounded-xl px-4 py-2 font-semibold text-white"
                  >
                    Tester la connexion SSH
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
