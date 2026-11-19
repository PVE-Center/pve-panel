import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  HardDrive,
  LayoutGrid,
  Plus,
  Server,
  SlidersHorizontal,
  Sparkles,
  Users,
} from 'lucide-react';
import { AlertsBanner } from './components/AlertsBanner';
import { CategoryServiceModal } from './components/CategoryServiceModal';
import { ConfirmModal } from './components/ConfirmModal';
import { CustomServiceModal } from './components/CustomServiceModal';
import { Header } from './components/Header';
import { NotificationsModal } from './components/NotificationsModal';
import { OnboardingModal } from './components/OnboardingModal';
import { OperationsSection } from './components/OperationsSection';
import { ProxmoxSection } from './components/ProxmoxSection';
import { AuthLoginModal, ServerConfigModal } from './components/ServerConfigModal';
import { ServiceCard } from './components/ServiceCard';
import { SetupWizardModal } from './components/SetupWizardModal';
import { StorageSection } from './components/StorageSection';
import { UsersSection } from './components/UsersSection';
import { YamlConfigEditorModal } from './components/YamlConfigEditorModal';
import {
  clearAuthToken,
  getServerUrl,
  isDemoMode,
  isNativePlatform,
} from './lib/apiClient';
import { realtimeClient } from './lib/realtimeClient';
import {
  applyThemePreference,
  getThemePreference,
  subscribeSystemTheme,
  type ThemePreference,
} from './lib/theme';
import type {
  AuthUser,
  CustomServiceItem,
  CustomServiceTestResponse,
  IncidentsResponse,
  OnboardingStatusResponse,
  OpsOverview,
  PveAction,
  PveOverview,
  PveResource,
  RealtimeEvent,
  RealtimeTransportMode,
  ServiceCategory,
  ServiceHealthStatus,
  ServiceItem,
  SetupStatusResponse,
  UsersOverview,
  WidgetsMap,
} from './types';

type ActiveTab = 'all' | 'storage' | 'services' | 'proxmox' | 'ops' | 'users';

export function App() {
  const [theme, setTheme] = useState<ThemePreference>(() => getThemePreference());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [pveOverview, setPveOverview] = useState<PveOverview | null>(null);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [customServices, setCustomServices] = useState<CustomServiceItem[]>([]);
  const [widgets, setWidgets] = useState<WidgetsMap>({});
  const [usersOverview, setUsersOverview] = useState<UsersOverview | null>(null);
  const [opsOverview, setOpsOverview] = useState<OpsOverview | null>(null);
  const [incidentsData, setIncidentsData] = useState<IncidentsResponse | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatusResponse | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatusResponse | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('all');
  const [selectedNode, setSelectedNode] = useState<string>('');
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeTransportMode>('disconnected');

  const [authError, setAuthError] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [serverModalOpen, setServerModalOpen] = useState<boolean>(
    () => isNativePlatform() && !getServerUrl() && !isDemoMode()
  );
  const [serverModalHint, setServerModalHint] = useState<string | null>(null);

  const [onboardingModalOpen, setOnboardingModalOpen] = useState(false);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [yamlModalOpen, setYamlModalOpen] = useState(false);
  const [notificationsModalOpen, setNotificationsModalOpen] = useState(false);
  const [customServiceModalState, setCustomServiceModalState] = useState<{
    open: boolean;
    service: CustomServiceItem | null;
  }>({ open: false, service: null });
  const [categoryServiceModalState, setCategoryServiceModalState] = useState<{
    open: boolean;
    service: ServiceItem | null;
    categoryName: string;
  }>({ open: false, service: null, categoryName: '' });

  const hasLoadedOnceRef = useRef(false);
  const autoPromptedOnboardingRef = useRef(false);
  const selectedNodeRef = useRef(selectedNode);
  selectedNodeRef.current = selectedNode;
  const pveReqIdRef = useRef(0);

  const [pendingAction, setPendingAction] = useState<{
    resource: PveResource;
    action: PveAction;
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const handleThemeChange = useCallback((next: ThemePreference) => {
    setTheme(next);
    applyThemePreference(next);
  }, []);

  useEffect(() => {
    applyThemePreference(theme);
    return subscribeSystemTheme(() => {
      // Theme DOM classes updated by subscribeSystemTheme
    });
  }, [theme]);

  const fetchUsersOnly = useCallback(async () => {
    const resp = await fetch('/api/users');
    if (resp.ok) setUsersOverview(await resp.json());
  }, []);

  const fetchOpsOnly = useCallback(async () => {
    const resp = await fetch('/api/ops/overview');
    if (resp.ok) setOpsOverview(await resp.json());
  }, []);

  const fetchIncidentsOnly = useCallback(async () => {
    const resp = await fetch('/api/incidents?limit=50');
    if (resp.ok) setIncidentsData(await resp.json());
  }, []);

  const fetchServicesOnly = useCallback(async () => {
    const [svcResp, csResp] = await Promise.all([
      fetch('/api/services'),
      fetch('/api/custom-services'),
    ]);
    if (svcResp.ok) {
      const svcData = await svcResp.json();
      setCategories(svcData.categories || []);
      if (!csResp.ok && Array.isArray(svcData.custom_services)) {
        setCustomServices(svcData.custom_services);
      }
    }
    if (csResp.ok) {
      const csData = await csResp.json();
      setCustomServices(csData.services || []);
    }
  }, []);

  const fetchAllData = useCallback(async () => {
    if (isNativePlatform() && !getServerUrl() && !isDemoMode()) {
      setServerModalHint(
        'Configurez votre URL Tailscale Serve ou activez le Mode Démo interactif pour explorer l’application.'
      );
      setServerModalOpen(true);
      return;
    }

    setIsRefreshing(true);
    try {
      const [onbResp, meResp] = await Promise.all([
        fetch('/api/onboarding/status'),
        fetch('/api/me'),
      ]);

      let nextOnboarding: OnboardingStatusResponse | null = null;
      if (onbResp.ok) {
        nextOnboarding = (await onbResp.json()) as OnboardingStatusResponse;
        setOnboardingStatus(nextOnboarding);
        const urlForcesOnboarding =
          typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('onboarding') === '1';

        if (
          ((!nextOnboarding.is_configured && !isDemoMode()) || urlForcesOnboarding) &&
          !autoPromptedOnboardingRef.current
        ) {
          autoPromptedOnboardingRef.current = true;
          setOnboardingModalOpen(true);
        }
      }

      if (meResp.status === 401) {
        setUser(null);
        // Only prompt LAN login modal if server is already configured (first-run onboarding runs unauthenticated)
        if (nextOnboarding?.is_configured !== false) {
          setAuthModalOpen(true);
        }
        return;
      }

      if (meResp.status === 403) {
        const err = await meResp.json().catch(() => ({}));
        setAuthError(err.detail || 'Accès refusé par le middleware Tailscale SSO.');
        return;
      }

      if (!meResp.ok) {
        throw new Error(`HTTP ${meResp.status}`);
      }

      setAuthModalOpen(false);
      setAuthError(null);
      const currentUser = (await meResp.json()) as AuthUser;
      setUser(currentUser);

      const pveReqId = ++pveReqIdRef.current;
      const targetNode = selectedNodeRef.current;
      const pveOverviewUrl = targetNode
        ? `/api/pve/overview?node=${encodeURIComponent(targetNode)}`
        : '/api/pve/overview';

      const [pveResp, svcResp, csResp, widResp, usrResp, opsResp, incResp, setupResp] =
        await Promise.all([
          fetch(pveOverviewUrl),
          fetch('/api/services'),
          fetch('/api/custom-services'),
          fetch('/api/widgets/all'),
          fetch('/api/users'),
          fetch('/api/ops/overview'),
          fetch('/api/incidents?limit=50'),
          fetch('/api/setup/status'),
        ]);

      if (pveResp.ok && pveReqId === pveReqIdRef.current) {
        setPveOverview(await pveResp.json());
      }
      if (svcResp.ok) {
        const svcData = await svcResp.json();
        setCategories(svcData.categories || []);
        if (!csResp.ok && Array.isArray(svcData.custom_services)) {
          setCustomServices(svcData.custom_services);
        }
      }
      if (csResp.ok) {
        const csData = await csResp.json();
        setCustomServices(csData.services || []);
      }
      if (widResp.ok) setWidgets(await widResp.json());
      if (usrResp.ok) setUsersOverview(await usrResp.json());
      if (opsResp.ok) setOpsOverview(await opsResp.json());
      if (incResp.ok) setIncidentsData(await incResp.json());
      if (setupResp.ok) {
        setSetupStatus((await setupResp.json()) as SetupStatusResponse);
      }

      hasLoadedOnceRef.current = true;
      setLastUpdated(new Date());
      setServerModalHint(null);
    } catch {
      if (!hasLoadedOnceRef.current) {
        setServerModalHint(
          'Impossible de joindre le serveur. Vérifiez la connexion réseau, Tailscale ou passez en Mode Démo interactif.'
        );
        setServerModalOpen(true);
      } else {
        setToast({
          type: 'error',
          message: 'Impossible de joindre le backend FastAPI.',
        });
      }
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchAllData();
  }, [fetchAllData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      if (!authModalOpen) {
        void fetchAllData();
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, authModalOpen, fetchAllData]);

  // Connect RealtimeClient (WS with SSE fallback) once authenticated or in Demo mode
  useEffect(() => {
    const unsubStatus = realtimeClient.onStatusChange(setRealtimeStatus);
    const unsubAuth = realtimeClient.onAuthRequired(() => {
      setAuthModalOpen(true);
    });
    const unsubEvents = realtimeClient.subscribe((event: RealtimeEvent) => {
      const payload = event.payload || {};
      if (event.type === 'service_status_changed') {
        const svcId = String(payload.service_id || '');
        const nextStatus = (payload.status as ServiceHealthStatus) || 'unknown';
        const isOnline = nextStatus === 'up';
        const nextLatency =
          typeof payload.latency_ms === 'number' ? payload.latency_ms : null;
        const nextMessage = typeof payload.message === 'string' ? payload.message : '';
        const nextMetrics =
          payload.metrics && typeof payload.metrics === 'object'
            ? (payload.metrics as Record<string, string | number | boolean | null>)
            : undefined;

        if (svcId) {
          setCategories((prev) =>
            prev.map((cat) => ({
              ...cat,
              services: cat.services.map((svc) =>
                svc.id === svcId
                  ? {
                      ...svc,
                      online: isOnline,
                      status: nextStatus,
                      latency_ms: nextLatency,
                      message: nextMessage || svc.message,
                      metrics: nextMetrics ?? svc.metrics,
                    }
                  : svc
              ),
            }))
          );
          setCustomServices((prev) =>
            prev.map((svc) =>
              svc.id === svcId
                ? {
                    ...svc,
                    online: isOnline,
                    status: nextStatus,
                    latency_ms: nextLatency,
                    message: nextMessage || svc.message,
                    metrics: nextMetrics ?? svc.metrics,
                  }
                : svc
            )
          );
        }
        void fetchIncidentsOnly();
      } else if (event.type === 'alert_triggered') {
        const svcName = String(payload.service_name || payload.service_id || 'Service');
        const msg = String(payload.message || 'Service hors ligne');
        setToast({ type: 'error', message: `Alerte : ${svcName} — ${msg}` });
        void fetchIncidentsOnly();
        void fetchServicesOnly();
      } else if (event.type === 'alert_resolved') {
        const svcName = String(payload.service_name || payload.service_id || 'Service');
        setToast({
          type: 'success',
          message: `Rétabli : ${svcName} est de nouveau opérationnel.`,
        });
        void fetchIncidentsOnly();
        void fetchServicesOnly();
      } else if (event.type === 'incident_acknowledged') {
        const incId = String(payload.incident_id || '');
        const ackAt =
          typeof payload.acknowledged_at === 'string'
            ? payload.acknowledged_at
            : new Date().toISOString();
        if (incId) {
          setIncidentsData((prev) =>
            prev
              ? {
                  ...prev,
                  incidents: prev.incidents.map((inc) =>
                    inc.id === incId
                      ? { ...inc, acknowledged: true, acknowledged_at: ackAt }
                      : inc
                  ),
                }
              : prev
          );
        }
      } else if (event.type === 'config_reloaded') {
        void fetchAllData();
      }
    });

    if (user || isDemoMode()) {
      realtimeClient.connect();
    } else {
      realtimeClient.disconnect();
    }

    return () => {
      unsubStatus();
      unsubAuth();
      unsubEvents();
    };
  }, [user, fetchAllData, fetchIncidentsOnly, fetchServicesOnly]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleSelectNode = useCallback(async (nextNode: string) => {
    setSelectedNode(nextNode);
    selectedNodeRef.current = nextNode;
    const pveReqId = ++pveReqIdRef.current;
    const queryStr = nextNode ? `?node=${encodeURIComponent(nextNode)}` : '';
    try {
      const resp = await fetch(`/api/pve/overview${queryStr}`);
      if (resp.ok && pveReqId === pveReqIdRef.current) {
        setPveOverview(await resp.json());
      }
    } catch {
      // Next periodic refresh will retry
    }
  }, []);

  const handleConfirmAction = async () => {
    if (!pendingAction) return;
    setActionBusy(true);
    const { resource, action } = pendingAction;
    const targetNode =
      resource.node ||
      (selectedNode && selectedNode !== '*' && selectedNode !== 'all' ? selectedNode : '');
    const nodeQuery = targetNode ? `?node=${encodeURIComponent(targetNode)}` : '';
    try {
      const resp = await fetch(
        `/api/pve/${resource.type}/${resource.vmid}/${action}${nodeQuery}`,
        { method: 'POST' }
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.detail || `Erreur HTTP ${resp.status}`);
      }
      setToast({
        type: 'success',
        message: `Action "${action}" envoyée à ${resource.name} (#${resource.vmid}).`,
      });
      setPendingAction(null);
      window.setTimeout(() => void fetchAllData(), 1200);
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Échec de la commande Proxmox.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const orderedCustomServices = useMemo(
    () =>
      [...customServices].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)
      ),
    [customServices]
  );

  const customServiceMap = useMemo(() => {
    const map = new Map<string, CustomServiceItem>();
    for (const svc of orderedCustomServices) {
      map.set(svc.id, svc);
    }
    return map;
  }, [orderedCustomServices]);

  const handleDeleteCustomService = async (svc: CustomServiceItem) => {
    try {
      const resp = await fetch(`/api/custom-services/${encodeURIComponent(svc.id)}`, {
        method: 'DELETE',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.detail || `Erreur HTTP ${resp.status}`);
      }
      setToast({ type: 'success', message: `Service « ${svc.name} » supprimé.` });
      await fetchServicesOnly();
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Suppression impossible.',
      });
    }
  };

  const handleMoveCustomService = async (
    svc: CustomServiceItem,
    direction: 'up' | 'down'
  ) => {
    const idx = orderedCustomServices.findIndex((item) => item.id === svc.id);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= orderedCustomServices.length) return;

    const nextList = [...orderedCustomServices];
    const [moved] = nextList.splice(idx, 1);
    nextList.splice(swapIdx, 0, moved);
    const serviceIds = nextList.map((item) => item.id);

    setCustomServices(nextList.map((item, i) => ({ ...item, order: i })));
    try {
      const resp = await fetch('/api/custom-services/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_ids: serviceIds }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await fetchServicesOnly();
    } catch {
      setToast({ type: 'error', message: 'Impossible de réordonner les services.' });
      await fetchServicesOnly();
    }
  };

  const handleMoveCategoryService = async (
    svc: ServiceItem,
    direction: 'up' | 'down'
  ) => {
    try {
      const resp = await fetch(`/api/services/items/${encodeURIComponent(svc.id)}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await fetchServicesOnly();
    } catch {
      setToast({ type: 'error', message: 'Impossible de déplacer le service.' });
      await fetchServicesOnly();
    }
  };

  const handleTestCustomService = async (
    svc: CustomServiceItem
  ): Promise<CustomServiceTestResponse | null> => {
    try {
      const resp = await fetch(
        `/api/custom-services/${encodeURIComponent(svc.id)}/test`,
        { method: 'POST' }
      );
      const data = (await resp.json().catch(() => ({}))) as CustomServiceTestResponse & {
        detail?: string;
      };
      if (!resp.ok) {
        throw new Error(data.detail || `Erreur HTTP ${resp.status}`);
      }
      setToast({
        type: data.ok ? 'success' : 'error',
        message: `${svc.name} : ${data.message}`,
      });
      void fetchServicesOnly();
      return data;
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Échec du test.',
      });
      return null;
    }
  };

  const handleSignOut = () => {
    clearAuthToken();
    realtimeClient.disconnect();
    setUser(null);
    setAuthModalOpen(true);
  };

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="liquid-glass-elevated max-w-md rounded-3xl p-6 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-rose-500 dark:text-rose-400" />
          <h1 className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">
            Accès strictement réservé
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{authError}</p>
          <button
            type="button"
            onClick={() => setServerModalOpen(true)}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-cyan-500/40 bg-cyan-500/20 px-4 py-2.5 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/30 active:scale-[0.98] dark:text-cyan-100"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Configurer serveur ou Mode Démo
          </button>
        </div>

        <ServerConfigModal
          open={serverModalOpen}
          initialMessage={serverModalHint}
          onClose={() => setServerModalOpen(false)}
          onApplied={() => {
            setServerModalOpen(false);
            setAuthError(null);
            hasLoadedOnceRef.current = false;
            autoPromptedOnboardingRef.current = false;
            void fetchAllData();
          }}
        />
      </div>
    );
  }

  const query = search.trim().toLowerCase();
  const filteredCategories = categories
    .map((cat) => ({
      ...cat,
      services: cat.services.filter(
        (svc) =>
          !query ||
          svc.name.toLowerCase().includes(query) ||
          svc.description.toLowerCase().includes(query) ||
          cat.name.toLowerCase().includes(query)
      ),
    }))
    .filter((cat) => cat.services.length > 0);

  const disabledCustomServices = orderedCustomServices.filter(
    (svc) =>
      !svc.enabled &&
      (!query ||
        svc.name.toLowerCase().includes(query) ||
        svc.description.toLowerCase().includes(query))
  );

  const pool = pveOverview?.external_storage?.pool;
  const poolBadge =
    pool && pool.total_bytes > 0
      ? `${(pool.total_bytes / 1e12).toFixed(1)} To • ${pool.used_pct}%`
      : undefined;

  const pendingSeerrCount = (opsOverview?.seerr_requests || []).filter(
    (r) => r.status === 1
  ).length;
  const activeIncidentsCount = incidentsData?.active_count ?? 0;
  const opsAlertCount = pendingSeerrCount + activeIncidentsCount;

  const navTabs: Array<{
    id: ActiveTab;
    label: string;
    shortLabel: string;
    icon: typeof LayoutGrid;
    badge?: string;
    dot?: boolean;
  }> = [
    { id: 'all', label: "Vue d'ensemble", shortLabel: 'Accueil', icon: LayoutGrid },
    {
      id: 'storage',
      label: 'Stockage & Disques',
      shortLabel: 'Stockage',
      icon: HardDrive,
      badge: poolBadge,
    },
    { id: 'proxmox', label: 'Proxmox (LXC / VM)', shortLabel: 'Proxmox', icon: Server },
    { id: 'services', label: 'Services & Widgets', shortLabel: 'Services', icon: Sparkles },
    {
      id: 'ops',
      label: 'Incidents & Actions',
      shortLabel: 'Actions',
      icon: Activity,
      badge:
        activeIncidentsCount > 0
          ? `${activeIncidentsCount} alerte${activeIncidentsCount > 1 ? 's' : ''}`
          : pendingSeerrCount > 0
            ? `${pendingSeerrCount} en attente`
            : undefined,
      dot: opsAlertCount > 0,
    },
    { id: 'users', label: 'Utilisateurs', shortLabel: 'Comptes', icon: Users },
  ];

  const showSection = (tab: Exclude<ActiveTab, 'all'>) =>
    activeTab === 'all' || activeTab === tab;

  const demoActive = isDemoMode();
  const existingCategoryNames = Array.from(
    new Set([
      ...categories.map((c) => c.name),
      ...orderedCustomServices.map((c) => c.category),
    ])
  ).filter(Boolean);

  return (
    <div className="min-h-screen pb-28 md:pb-14">
      <Header
        user={user}
        search={search}
        onSearchChange={setSearch}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
        isRefreshing={isRefreshing}
        onRefreshNow={() => void fetchAllData()}
        lastUpdated={lastUpdated}
        demoActive={demoActive}
        needsSetup={Boolean(
          ((onboardingStatus && !onboardingStatus.is_configured) ||
            (setupStatus && !setupStatus.is_configured)) &&
            !demoActive
        )}
        realtimeStatus={realtimeStatus}
        activeIncidentsCount={activeIncidentsCount}
        theme={theme}
        onThemeChange={handleThemeChange}
        onOpenIncidents={() => {
          setActiveTab('ops');
          window.setTimeout(() => {
            document
              .getElementById('incidents-timeline')
              ?.scrollIntoView({ behavior: 'smooth' });
          }, 80);
        }}
        onOpenNotifications={() => setNotificationsModalOpen(true)}
        onOpenYamlEditor={() => setYamlModalOpen(true)}
        onOpenOnboarding={() => setOnboardingModalOpen(true)}
        onOpenServerConfig={() => setServerModalOpen(true)}
        onOpenSetupWizard={() => setSetupModalOpen(true)}
        onSignOut={handleSignOut}
      />

      {/* Barre d'onglets Liquid Glass (Desktop / iPad) */}
      <div className="hidden border-b border-slate-200/80 bg-white/50 backdrop-blur-xl dark:border-white/10 dark:bg-black/25 md:block">
        <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-4 py-2.5 sm:px-6">
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition active:scale-95 ${
                  active
                    ? 'cider-accent-ring text-slate-900 shadow-inner dark:text-white'
                    : 'border-transparent bg-transparent text-slate-600 hover:border-slate-300/70 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:border-white/10 dark:hover:bg-white/[0.06] dark:hover:text-slate-100'
                }`}
              >
                <Icon
                  className={`h-3.5 w-3.5 ${
                    active ? 'text-cyan-600 dark:text-cyan-300' : ''
                  }`}
                />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      active
                        ? 'bg-cyan-500/20 text-cyan-800 dark:bg-cyan-400/25 dark:text-cyan-100'
                        : 'bg-slate-200/80 text-slate-700 dark:bg-white/10 dark:text-slate-300'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Floating Liquid Glass Bottom Tab Bar (iPhone) */}
      <nav
        aria-label="Navigation principale iPhone"
        className="safe-bottom-dock fixed inset-x-3 z-40 md:hidden"
      >
        <div className="liquid-glass-dock mx-auto flex max-w-md items-center justify-between gap-1 rounded-[28px] p-1.5">
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] py-1.5 text-[10px] font-medium transition active:scale-95 ${
                  active
                    ? 'cider-accent-ring border text-slate-900 shadow-inner dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${
                    active ? 'text-cyan-600 dark:text-cyan-300' : ''
                  }`}
                />
                <span className="truncate leading-none">{tab.shortLabel}</span>
                {tab.dot && (
                  <span className="absolute right-2.5 top-1.5 h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)]" />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl space-y-10 px-4 pt-6 sm:px-6">
        <AlertsBanner
          pveOverview={pveOverview}
          categories={categories}
          usersOverview={usersOverview}
          opsOverview={opsOverview}
          incidentsData={incidentsData}
          onJumpToTab={(tab) => setActiveTab(tab)}
        />

        {/* Section 1 : Supervision & Contrôle Proxmox VE */}
        {showSection('proxmox') && (
          <ProxmoxSection
            overview={pveOverview}
            search={search}
            selectedNode={selectedNode}
            onSelectNode={(nextNode) => void handleSelectNode(nextNode)}
            onRequestAction={(resource, action) =>
              setPendingAction({ resource, action })
            }
          />
        )}

        {/* Onglet / Section Stockage Proxmox & Pool MergerFS */}
        {activeTab === 'storage' && (
          <StorageSection overview={pveOverview} search={search} />
        )}

        {/* Onglet Incidents, Activité, Actions Rapides Médias/Torrents & Tâches Proxmox */}
        {activeTab === 'ops' && (
          <OperationsSection
            ops={opsOverview}
            incidentsData={incidentsData}
            search={search}
            onRefreshOps={fetchOpsOnly}
            onRefreshIncidents={fetchIncidentsOnly}
            onToast={setToast}
          />
        )}

        {/* Section 2 : Hub de services, Connecteurs personnalisés & Widgets */}
        {showSection('services') && (
          <section className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                  Services, Connecteurs &amp; Widgets
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  HTTP, TCP, ICMP, JSON Metrics et Webhooks push supervisés en temps réel
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCustomServiceModalState({ open: true, service: null })}
                className="cider-accent-btn inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter un service
              </button>
            </div>

            {filteredCategories.map((category) => (
              <div key={category.name} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    {category.name}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {category.services.filter((s) => s.online).length}/
                    {category.services.length} en ligne
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                  {category.services.map((service, svcIndex) => {
                    const customSvc = customServiceMap.get(service.id);
                    const customIdx = customSvc
                      ? orderedCustomServices.findIndex((c) => c.id === customSvc.id)
                      : -1;
                    const categoryServiceCount = category.services.length;
                    return (
                      <ServiceCard
                        key={service.id}
                        service={service}
                        widgets={widgets}
                        customService={customSvc}
                        categoryName={category.name}
                        canMoveUp={
                          customSvc ? customIdx > 0 : svcIndex > 0
                        }
                        canMoveDown={
                          customSvc
                            ? customIdx >= 0 && customIdx < orderedCustomServices.length - 1
                            : svcIndex < categoryServiceCount - 1
                        }
                        onEditService={(target, catName) =>
                          setCategoryServiceModalState({
                            open: true,
                            service: target,
                            categoryName: catName,
                          })
                        }
                        onMoveService={handleMoveCategoryService}
                        onEditCustom={(target) =>
                          setCustomServiceModalState({ open: true, service: target })
                        }
                        onDeleteCustom={handleDeleteCustomService}
                        onMoveCustom={handleMoveCustomService}
                        onTestCustom={handleTestCustomService}
                      />
                    );
                  })}
                </div>
              </div>
            ))}

            {disabledCustomServices.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Services personnalisés désactivés
                  </h3>
                  <span className="text-xs text-slate-500">
                    {disabledCustomServices.length} en pause
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                  {disabledCustomServices.map((customSvc) => {
                    const customIdx = orderedCustomServices.findIndex(
                      (c) => c.id === customSvc.id
                    );
                    return (
                      <ServiceCard
                        key={customSvc.id}
                        service={customSvc}
                        widgets={widgets}
                        customService={customSvc}
                        canMoveUp={customIdx > 0}
                        canMoveDown={
                          customIdx >= 0 && customIdx < orderedCustomServices.length - 1
                        }
                        onEditCustom={(target) =>
                          setCustomServiceModalState({ open: true, service: target })
                        }
                        onDeleteCustom={handleDeleteCustomService}
                        onMoveCustom={handleMoveCustomService}
                        onTestCustom={handleTestCustomService}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Section 3 : Gestion unifiée Utilisateurs Jellyfin <-> Jellyseerr */}
        {showSection('users') && (
          <UsersSection
            overview={usersOverview}
            search={search}
            onRefreshUsers={fetchUsersOnly}
            onToast={setToast}
          />
        )}
      </main>

      {pendingAction && (
        <ConfirmModal
          resource={pendingAction.resource}
          action={pendingAction.action}
          busy={actionBusy}
          onCancel={() => setPendingAction(null)}
          onConfirm={handleConfirmAction}
        />
      )}

      <AuthLoginModal
        open={authModalOpen}
        serverName={onboardingStatus?.server_name || 'PVE Command Center'}
        pinConfigured={onboardingStatus?.pin_configured ?? true}
        onAuthenticated={() => {
          setAuthModalOpen(false);
          hasLoadedOnceRef.current = false;
          void fetchAllData();
          realtimeClient.reconnect();
        }}
        onOpenServerConfig={() => {
          setAuthModalOpen(false);
          setServerModalOpen(true);
        }}
      />

      <ServerConfigModal
        open={serverModalOpen}
        initialMessage={serverModalHint}
        onClose={() => setServerModalOpen(false)}
        onApplied={() => {
          setServerModalOpen(false);
          setAuthModalOpen(false);
          setAuthError(null);
          setSelectedNode('');
          selectedNodeRef.current = '';
          hasLoadedOnceRef.current = false;
          autoPromptedOnboardingRef.current = false;
          void fetchAllData();
          realtimeClient.reconnect();
        }}
      />

      <OnboardingModal
        open={onboardingModalOpen}
        onClose={() => setOnboardingModalOpen(false)}
        onCompleted={(message) => {
          setOnboardingModalOpen(false);
          setToast({ type: 'success', message });
          void fetchAllData();
          realtimeClient.reconnect();
        }}
      />

      <SetupWizardModal
        open={setupModalOpen}
        initialStatus={setupStatus}
        theme={theme}
        onThemeChange={handleThemeChange}
        onOpenNotifications={() => setNotificationsModalOpen(true)}
        onOpenYamlEditor={() => setYamlModalOpen(true)}
        onOpenServerConfig={() => setServerModalOpen(true)}
        onOpenOnboarding={() => setOnboardingModalOpen(true)}
        onClose={() => setSetupModalOpen(false)}
        onApplied={(message) => {
          setSetupModalOpen(false);
          setToast({
            type: 'success',
            message: message || 'Configuration enregistrée et appliquée à chaud.',
          });
          void fetchAllData();
        }}
      />

      <CustomServiceModal
        open={customServiceModalState.open}
        service={customServiceModalState.service}
        existingCategories={existingCategoryNames}
        onClose={() => setCustomServiceModalState({ open: false, service: null })}
        onSaved={(message) => {
          setCustomServiceModalState({ open: false, service: null });
          setToast({ type: 'success', message });
          void fetchServicesOnly();
          void fetchIncidentsOnly();
        }}
      />

      <CategoryServiceModal
        open={categoryServiceModalState.open}
        service={categoryServiceModalState.service}
        categoryName={categoryServiceModalState.categoryName}
        existingCategories={existingCategoryNames}
        onClose={() =>
          setCategoryServiceModalState({ open: false, service: null, categoryName: '' })
        }
        onSaved={(message) => {
          setCategoryServiceModalState({ open: false, service: null, categoryName: '' });
          setToast({ type: 'success', message });
          void fetchServicesOnly();
          void fetchIncidentsOnly();
        }}
      />

      <YamlConfigEditorModal
        open={yamlModalOpen}
        onClose={() => setYamlModalOpen(false)}
        onSaved={(message) => {
          setYamlModalOpen(false);
          setToast({ type: 'success', message });
          void fetchAllData();
        }}
      />

      <NotificationsModal
        open={notificationsModalOpen}
        onClose={() => setNotificationsModalOpen(false)}
        onToast={setToast}
        onUpdated={() => void fetchAllData()}
      />

      {toast && (
        <div className="liquid-glass-elevated fixed bottom-24 left-4 right-4 z-50 flex items-center gap-2.5 rounded-2xl px-4 py-3 text-sm text-slate-900 dark:text-white sm:left-auto sm:right-5 md:bottom-5">
          {toast.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-500 dark:text-rose-400" />
          )}
          <span className="min-w-0 flex-1">{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default App;
