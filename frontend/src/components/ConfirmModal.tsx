import { AlertTriangle, X } from 'lucide-react';
import type { PveAction, PveResource } from '../types';

interface ConfirmModalProps {
  resource: PveResource;
  action: PveAction;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const ACTION_META: Record<
  PveAction,
  { label: string; tone: string; buttonClass: string; warning: string }
> = {
  start: {
    label: 'Démarrer',
    tone: 'text-emerald-500 dark:text-emerald-400',
    buttonClass: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    warning: 'Cette ressource va être démarrée sur le nœud Proxmox.',
  },
  reboot: {
    label: 'Redémarrer',
    tone: 'text-amber-500 dark:text-amber-400',
    buttonClass: 'bg-amber-600 hover:bg-amber-500 text-white',
    warning: 'Les connexions et services en cours sur cette ressource seront temporairement coupés.',
  },
  shutdown: {
    label: 'Arrêter proprement',
    tone: 'text-rose-500 dark:text-rose-400',
    buttonClass: 'bg-rose-600 hover:bg-rose-500 text-white',
    warning: 'Un signal ACPI / d’extinction propre va être envoyé à cette ressource.',
  },
  stop: {
    label: 'Forcer l’arrêt',
    tone: 'text-rose-500 dark:text-rose-400',
    buttonClass: 'bg-rose-700 hover:bg-rose-600 text-white',
    warning: 'Attention : arrêt immédiat sans extinction propre du système.',
  },
};

export function ConfirmModal({
  resource,
  action,
  busy,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  const meta = ACTION_META[action];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onCancel}
    >
      <div
        className="ios-sheet safe-bottom-sheet w-full max-w-md rounded-t-[32px] p-5 text-slate-900 dark:text-slate-100 sm:rounded-3xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex justify-center sm:hidden">
          <div className="ios-grabber" />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="liquid-pill flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl">
              <AlertTriangle className={`h-5 w-5 ${meta.tone}`} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                {meta.label} {resource.type.toUpperCase()} {resource.vmid}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {resource.name}
                {resource.node ? ` • ${resource.node}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="liquid-pill rounded-full p-2 text-slate-500 hover:text-slate-900 active:scale-95 dark:text-slate-300 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="liquid-subcard mt-4 p-3.5 text-sm text-slate-700 dark:text-slate-200">
          {meta.warning}
        </p>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="liquid-pill rounded-2xl px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:text-slate-950 active:scale-[0.98] disabled:opacity-50 dark:text-slate-200 dark:hover:text-white"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-lg transition active:scale-[0.98] disabled:opacity-50 ${meta.buttonClass}`}
          >
            {busy ? 'Exécution…' : `Confirmer (${meta.label})`}
          </button>
        </div>
      </div>
    </div>
  );
}
