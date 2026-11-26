import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import { ServiceIconBadge, ServiceIconPicker } from './ServiceIcon';
import type { ServiceItem } from '../types';

interface CategoryServiceModalProps {
  open: boolean;
  service: ServiceItem | null;
  categoryName: string;
  existingCategories: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

const WIDGET_OPTIONS = [
  { value: '', label: 'Aucun widget' },
  { value: 'jellyfin', label: 'Widget Jellyfin (flux, films, séries)' },
  { value: 'plex', label: 'Widget Plex (flux, librairies)' },
  { value: 'stremio', label: 'Widget Stremio (version, VAAPI, cache)' },
  { value: 'radarr', label: 'Widget Radarr (films, file)' },
  { value: 'sonarr', label: 'Widget Sonarr (séries, épisodes)' },
  { value: 'prowlarr', label: 'Widget Prowlarr (indexeurs, grabs)' },
  { value: 'qbittorrent', label: 'Widget qBittorrent (débit DL/UP)' },
];

export function CategoryServiceModal({
  open,
  service,
  categoryName,
  existingCategories,
  onClose,
  onSaved,
}: CategoryServiceModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [icon, setIcon] = useState('Server');
  const [url, setUrl] = useState('');
  const [pingUrl, setPingUrl] = useState('');
  const [widget, setWidget] = useState('');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    latency_ms: number | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !service) return;
    setName(service.name || '');
    setDescription(service.description || '');
    setCategory(categoryName || service.category || 'Services');
    setIcon(service.icon || 'Server');
    setUrl(service.url || '');
    setPingUrl(service.ping_url || '');
    setWidget(service.widget || '');
    setTestResult(null);
    setConfirmDelete(false);
    setErrorMsg(null);
  }, [open, service, categoryName]);

  if (!open || !service) return null;

  const categorySuggestions = Array.from(
    new Set([
      ...existingCategories,
      'Médias & Streaming',
      'Téléchargements & Indexeurs',
      'Cloud, Sécurité & Gaming',
      'Infrastructure & Réseau',
      'Services Personnalisés',
    ])
  );

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setErrorMsg(null);
    try {
      const resp = await fetch(`/api/services/items/${encodeURIComponent(service.id)}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          ping_url: pingUrl.trim(),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.detail || `Erreur HTTP ${resp.status}`);
      }
      setTestResult({
        ok: Boolean(data.ok),
        message: String(data.message || ''),
        latency_ms: typeof data.latency_ms === 'number' ? data.latency_ms : null,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Échec du test de joignabilité.');
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Le nom de l’application est obligatoire.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      const resp = await fetch(`/api/services/items/${encodeURIComponent(service.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          category: category.trim() || categoryName,
          icon: icon.trim() || 'Server',
          url: url.trim(),
          ping_url: pingUrl.trim(),
          widget: widget.trim(),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.detail || `Erreur HTTP ${resp.status}`);
      }
      onSaved(`Application « ${name.trim()} » personnalisée.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Impossible d’enregistrer.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setErrorMsg(null);
    try {
      const resp = await fetch(`/api/services/items/${encodeURIComponent(service.id)}`, {
        method: 'DELETE',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.detail || `Erreur HTTP ${resp.status}`);
      }
      onSaved(`Application « ${service.name} » retirée du panneau.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Impossible de supprimer le service.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={`Personnaliser ${service.name}`}
    >
      <div className="liquid-glass-elevated flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-200/80 px-6 py-4 dark:border-white/10">
          <div className="flex min-w-0 items-center gap-3">
            <ServiceIconBadge
              icon={icon}
              hint={{ id: service.id, name, widget }}
              size="md"
            />
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-slate-900 dark:text-white">
                Personnaliser {name || service.name}
              </h2>
              <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                id : {service.id}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="liquid-pill rounded-full p-2 text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {errorMsg && (
            <div className="flex items-center gap-2 rounded-2xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-200">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {testResult && (
            <div
              className={`flex items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-xs ${
                testResult.ok
                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                  : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-200'
              }`}
            >
              <span className="flex items-center gap-2">
                {testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0" />
                )}
                <span>{testResult.message}</span>
              </span>
              {testResult.latency_ms !== null && (
                <span className="font-mono text-[11px] font-semibold">
                  {testResult.latency_ms} ms
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                Nom affiché *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="liquid-input"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                Catégorie
              </label>
              <input
                type="text"
                list="category-service-suggestions"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="liquid-input"
              />
              <datalist id="category-service-suggestions">
                {categorySuggestions.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Courte description affichée sur la carte"
                className="liquid-input"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                URL d’ouverture (clic carte)
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://service.example.ts.net"
                className="liquid-input font-mono text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                URL Healthcheck interne (ping_url)
              </label>
              <input
                type="text"
                value={pingUrl}
                onChange={(e) => setPingUrl(e.target.value)}
                placeholder="http://192.168.1.117:80"
                className="liquid-input font-mono text-xs"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                Widget temps réel associé
              </label>
              <select
                value={widget}
                onChange={(e) => setWidget(e.target.value)}
                className="liquid-input"
              >
                {WIDGET_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="liquid-subcard p-4">
            <ServiceIconPicker
              value={icon}
              hint={{ id: service.id, name, widget }}
              onChange={setIcon}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-4 dark:border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={testing}
                onClick={() => void handleTest()}
                className="liquid-pill inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-500/15 disabled:opacity-50 dark:text-cyan-200"
              >
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Tester
              </button>

              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="liquid-pill inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium text-rose-600 transition hover:bg-rose-500/15 dark:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Supprimer
                </button>
              ) : (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                  onBlur={() => setConfirmDelete(false)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/20 px-3.5 py-2 text-xs font-semibold text-rose-700 dark:text-rose-200"
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Confirmer la suppression
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="liquid-pill rounded-full px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving}
                className="cider-accent-btn inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Enregistrer
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
