"use client";

import "@/client/shared/zod-csp";

/**
 * @file AppShell.tsx
 * @description The single-route client application under `/app/*` (ADR-0013): header,
 * side/bottom navigation, sync bar, and the active screen.
 *
 * @responsibility
 * - Switches between screens in client state; Home is bundled, every other screen is a lazy
 *   chunk preloaded after first render so navigation keeps working offline.
 * - Registers the service worker (`/sw.js`) in production; in development unregisters old
 *   workers and clears their caches.
 * - Drives the sync bar from the connection and the sales outbox, and triggers the outbox sync
 *   on events (startup/sign-in, back online, tab visible, a tap on the bar) — ADR-0020.
 * - Opens the login modal and the profile modal.
 */

import React, { useState, useEffect, useCallback, Suspense, lazy } from "react";
import { useRouter } from "next/navigation";
import styles from "./AppShell.module.css";
import { Header } from "./Header";
import type { NavRoute } from "./BottomNav";
import { SideNav } from "./SideNav";
import { SyncBar, deriveSyncState, type SyncState } from "./SyncBar";
import { ListSkeleton, ToastProvider } from "../shared/ui";
import { t } from "../shared/i18n";
import type { SessionState } from "../shared/api";

// Eagerly loaded default view
import { HomeView } from "../features/home/HomeView";

// Lazy-loaded views
const loadProductsView = () => import("../features/products/ProductsView");
const loadSalesView = () => import("../features/sales/SalesView");
const loadStockView = () => import("../features/stock/StockView");
const loadExpensesView = () => import("../features/expenses/ExpensesView");
const loadPeopleView = () => import("../features/people/PeopleView");
const loadAlertsView = () => import("../features/alerts/AlertsView");
const loadAiView = () => import("../features/ai/AiView");
const loadInventoryView = () => import("../features/home/InventoryView");
const loadReportsView = () => import("../features/home/ReportsView");
const loadDrawerView = () => import("../features/home/DrawerView");
const loadDailySalesView = () =>
  import("../features/daily-sales/DailySalesView");

const ProductsView = lazy(loadProductsView);
const SalesView = lazy(loadSalesView);
const StockView = lazy(loadStockView);
const ExpensesView = lazy(loadExpensesView);
const PeopleView = lazy(loadPeopleView);
const AlertsView = lazy(loadAlertsView);
const AiView = lazy(loadAiView);
const InventoryView = lazy(loadInventoryView);
const ReportsView = lazy(loadReportsView);
const DrawerView = lazy(loadDrawerView);
const DailySalesView = lazy(loadDailySalesView);

const VALID_ROUTES: NavRoute[] = [
  "home",
  "products",
  "sales",
  "daily-sales",
  "stock",
  "expenses",
  "people",
  "alerts",
  "ai",
  "inventory",
  "reports",
  "drawer",
  "notifications",
];

function getRouteFromPathname(pathname: string): NavRoute {
  const segments = pathname
    .replace(/^\/app\/?/, "")
    .split("/")
    .filter(Boolean);
  const first = segments[0] as NavRoute;
  if (first && VALID_ROUTES.includes(first)) {
    return first;
  }
  return "home";
}

/** A screen's code is loading (first visit only; chunks are preloaded): its list's shape. */
/** The whole app while the session is read: a neutral page, never the dashboard. */
function ShellLoading() {
  return (
    <div className={styles.shellLoading} dir="rtl" data-testid="shell-loading">
      <span>{t("common.loading")}</span>
    </div>
  );
}

function ViewLoading() {
  return (
    <div className={styles.viewLoading}>
      <ListSkeleton rows={5} label={t("common.loading")} />
    </div>
  );
}

import { AuthProvider, useAuth } from "../shared/auth";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/client/offline/db";
import { syncCatalogFully } from "@/client/offline/catalog";
import {
  forgetShopIdentities,
  loadShopIdentity,
  saveShopIdentity,
} from "@/client/offline/shop";
import {
  lastOutboxStore,
  listSaleOps,
  rememberOutboxStore,
  scheduleSaleSync,
  setActiveOutboxStore,
  type SaleOutboxOp,
} from "../offline/outbox";
import { AuthScreen } from "../features/auth/AuthScreen";
import { ChangePasswordScreen } from "../features/auth/ChangePasswordScreen";
import {
  SubscriptionScreen,
  SubscriptionSheet,
} from "../features/subscription/SubscriptionScreen";
import { ModeSwitchSheet } from "../features/subscription/ModeSwitchSheet";
import {
  isAccessBlocked,
  modeOf,
  rememberMode,
} from "../features/subscription/access";
import { ProfileModal } from "../features/auth/ProfileModal";
import {
  apiGet,
  clearReadCache,
  installWriteInvalidation,
  setOfflineCopyStore,
} from "@/client/shared/api/read-cache";
import { offlineCopyStore } from "@/client/offline/read-cache";

// The screens' read cache (fast navigation, offline copies per shop): installed once.
if (typeof window !== "undefined") {
  setOfflineCopyStore(offlineCopyStore());
  installWriteInvalidation();
}

function AppShellInner() {
  const {
    session,
    isOfflineExpired,
    isSessionRefused,
    isSignedOutByServer,
    isLoading: authLoading,
    logout,
    refreshSession,
    setSession,
  } = useAuth();
  // The shop whose data this tab may request: only a session the SERVER confirmed. Offline (the
  // session request failed, the server did not answer) the last shop on this device keeps its
  // queue and its offline copies; signed out, nothing protected is requested at all.
  const confirmedStore = session?.store?.id ?? null;
  const [showMode, setShowMode] = useState(false);
  const [showSubscription, setShowSubscription] = useState(false);
  const router = useRouter();
  const [showProfile, setShowProfile] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  // The server refused the session (revoked, expired, no longer a member): sign in again
  // (QA-51). Offline or on a server error this is never set, so offline use is unchanged.
  const [refusedShown, setRefusedShown] = useState(false);
  if (isSessionRefused && !refusedShown) {
    setRefusedShown(true);
    setShowAuthModal(true);
  }

  const [alertCount, setAlertCount] = useState<number>(0);

  useEffect(() => {
    let isMounted = true;
    const fetchAlertsCount = () => {
      apiGet("/api/alerts")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!isMounted) return;
          if (typeof data?.totalAlerts === "number") {
            setAlertCount(data.totalAlerts);
          }
        })
        .catch(() => {});
    };

    // The Alerts screen announces fresh alerts with their count: use it instead of asking the
    // server again (QA-28). An event without a count still triggers one fetch.
    const onAlertsUpdated = (e: Event) => {
      const total = (e as CustomEvent<{ totalAlerts?: unknown }>).detail
        ?.totalAlerts;
      if (typeof total === "number") setAlertCount(total);
      else fetchAlertsCount();
    };

    // Signed out (or not known yet): no request — it would only be a 401.
    if (!confirmedStore) return;
    void fetchAlertsCount();
    window.addEventListener("hesba_alerts_updated", onAlertsUpdated);
    return () => {
      isMounted = false;
      window.removeEventListener("hesba_alerts_updated", onAlertsUpdated);
    };
  }, [confirmedStore]);

  const [route, setRoute] = useState<NavRoute>(() => {
    if (typeof window !== "undefined") {
      return getRouteFromPathname(window.location.pathname);
    }
    return "home";
  });

  const [syncState, setSyncState] = useState<SyncState>(() => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return "offline";
    }
    return "synced";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Register service worker for offline precaching in production only.
    // In development mode, unregister any stale service worker and purge old precache caches
    // to prevent 404 errors on nonexistent static CSS bundles.
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker
          .register("/sw.js", { scope: "/" })
          .catch(() => {});
      } else {
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) => {
            for (const registration of registrations) {
              registration.unregister();
            }
          })
          .catch(() => {});

        if ("caches" in window) {
          caches
            .keys()
            .then((keys) => {
              for (const key of keys) {
                if (
                  key.includes("serwist") ||
                  key.includes("workbox") ||
                  key.includes("precache")
                ) {
                  caches.delete(key);
                }
              }
            })
            .catch(() => {});
        }
      }
    }

    // Preload lazy view chunks on mount so they are cached for offline navigation
    loadProductsView();
    loadSalesView();
    loadStockView();
    loadExpensesView();
    loadPeopleView();
    loadAlertsView();
    loadAiView();
    loadInventoryView();
    loadReportsView();
    loadDrawerView();
    loadDailySalesView();

    const handlePopState = () => {
      setRoute(getRouteFromPathname(window.location.pathname));
    };

    const handleOnline = () => setSyncState("synced");
    const handleOffline = () => setSyncState("offline");

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const navigate = useCallback((nextRoute: NavRoute) => {
    setRoute(nextRoute);
    if (typeof window !== "undefined") {
      const newPath = nextRoute === "home" ? "/app" : `/app/${nextRoute}`;
      if (window.location.pathname !== newPath) {
        window.history.pushState(null, "", newPath);
      }
    }
  }, []);

  const renderCurrentView = () => {
    // ADR-0033: the cashier in الكاشير الذكي, the daily total in إدارة المحل — the other one is
    // never shown (and the server refuses it anyway).
    const shown: NavRoute =
      mode === "simple" && route === "sales"
        ? "daily-sales"
        : mode === "pos" && route === "daily-sales"
          ? "sales"
          : route;
    switch (shown) {
      case "home":
        return (
          <HomeView
            onNavigate={navigate}
            operatingMode={mode}
            alertCount={alertCount}
            onOpenAlerts={() => navigate("alerts")}
            onLogout={async () => {
              await logout();
              await forgetShopIdentities(db).catch(() => {});
              await clearReadCache();
              router.push("/");
            }}
          />
        );
      case "products":
        return <ProductsView />;
      case "sales":
        return <SalesView onNavigate={navigate} />;
      case "daily-sales":
        return <DailySalesView />;
      case "stock":
        return <StockView />;
      case "expenses":
        return <ExpensesView />;
      case "people":
        return <PeopleView />;
      case "alerts":
        return <AlertsView mode="machines" />;
      case "notifications":
        return <AlertsView mode="alerts" onNavigate={navigate} />;
      case "reports":
        return <ReportsView />;
      case "drawer":
        return <DrawerView />;
      case "ai":
        return <AiView />;
      case "inventory":
        return <InventoryView />;
      default:
        return (
          <HomeView
            onNavigate={navigate}
            operatingMode={mode}
            alertCount={alertCount}
            onOpenAlerts={() => navigate("alerts")}
            onLogout={async () => {
              await logout();
              await forgetShopIdentities(db).catch(() => {});
              await clearReadCache();
              router.push("/");
            }}
          />
        );
    }
  };

  // Sales waiting in the outbox (ADR-0020), live across tabs. Sync runs on events only:
  // startup / sign-in, back online, tab visible again, a new sale, or a tap on the bar.
  // Offline the session request fails; the shop last signed in on this device still owns the
  // queue, so its waiting sales stay visible (and new ones can be queued) after a reload.
  useEffect(() => {
    if (session?.store?.id) {
      rememberOutboxStore(session.store.id);
      // QA-57: keep the shop's identity on the device for the offline header and menu.
      void saveShopIdentity(db, session).catch(() => {});
    } else if (!authLoading && isSignedOutByServer) {
      // Forgotten only when the SERVER answered that nobody is signed in (no session, or 401:
      // signed out, expired, removed from the shop). A failed session request (no network, even while the browser claims
      // to be online) keeps the shop's queue and identity (QA-57).
      rememberOutboxStore(null);
      void forgetShopIdentities(db).catch(() => {});
      void clearReadCache();
    }
  }, [session, authLoading, isSignedOutByServer]);
  // While the session is not (re)loaded — offline, or just back online — keep showing the
  // remembered shop's queue instead of a false "0 waiting / synced".
  const storeId = session?.store?.id ?? lastOutboxStore();
  // Queued sales are SENT only for a confirmed session, or offline for the device's last shop —
  // never while the session is still loading or after the server said nobody is signed in.
  const syncStore =
    confirmedStore ??
    (!authLoading && !isSignedOutByServer ? lastOutboxStore() : null);
  // `undefined` until IndexedDB has answered: the bar must not claim "synced" before that.
  const queuedSales = useLiveQuery(
    () =>
      storeId ? listSaleOps(storeId) : Promise.resolve([] as SaleOutboxOp[]),
    [storeId],
  );
  useEffect(() => {
    // Only the signed-in shop's queued sales are ever sent from this tab.
    setActiveOutboxStore(syncStore ?? null);
    if (!syncStore || typeof window === "undefined") return;
    scheduleSaleSync(syncStore, { now: true });
    const onOnline = () => scheduleSaleSync(syncStore, { now: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleSaleSync(syncStore);
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [syncStore]);
  // The offline catalog (QA-53): downloaded once a shop is signed in, then brought up to date
  // when the device is back online. Events only; a run resumes where the last one stopped.
  const signedInStore = session?.store?.id ?? null;
  useEffect(() => {
    if (!signedInStore || typeof window === "undefined") return;
    const run = () => {
      if (navigator.onLine !== false) void syncCatalogFully(db);
    };
    run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [signedInStore]);
  // The shop's name offline (QA-57): the identity saved on this device for the shop that
  // owns it (never another shop's), read locally — no request is made for it.
  const savedIdentity = useLiveQuery(
    () => (storeId ? loadShopIdentity(db, storeId) : Promise.resolve(null)),
    [storeId],
  );
  const identity =
    savedIdentity && savedIdentity.storeId === storeId ? savedIdentity : null;
  const storeName = session?.store?.name ?? identity?.storeName ?? null;
  // The operating mode (ADR-0033): the session's, else the last one seen on this device.
  const mode = modeOf(session, storeId ?? null);
  useEffect(() => {
    if (session?.store?.id)
      rememberMode(session.store.id, session.store.operatingMode);
  }, [session]);
  const ownerName = session?.user?.name ?? identity?.ownerName ?? null;
  // Honest status (QA-17): from the connection and the real queue, including each queued
  // sale's last answer (401 → log in, 503 → server updating).
  const { state: effectiveSyncState, pendingCount } = deriveSyncState({
    online: syncState !== "offline",
    sessionExpired: isOfflineExpired,
    queue: queuedSales,
  });

  const doLogout = async () => {
    await logout();
    await forgetShopIdentities(db).catch(() => {});
    await clearReadCache();
    router.push("/");
  };

  // Signed in elsewhere in this tab (the login / sign-up screen): a new session, possibly of
  // another shop — start from an empty read cache so no other shop's screen is ever shown.
  const onSignedIn = async (next: SessionState) => {
    await clearReadCache();
    setSession(next);
  };

  // 1. The session is being read: nothing of the app is shown or requested yet (no dashboard
  //    flash, no 401 noise).
  if (authLoading) {
    return <ShellLoading />;
  }

  // 2. Nobody is signed in. The server said so → the login / sign-up screen, and no API call.
  //    The server could not be reached (offline) → the app keeps working for the shop last
  //    signed in on this device (queue + offline copies, ADR-0020); a device that never had
  //    one gets the login screen with the offline notice.
  if (!session && (isSignedOutByServer || !lastOutboxStore())) {
    return (
      <AuthScreen
        initialMode="login"
        onSuccess={(next) => void onSignedIn(next)}
        isOffline={syncState === "offline"}
      />
    );
  }

  // 3. A temporary password from Hesba's team (admin reset): change it first. The server refuses
  //    everything else (403 PASSWORD_CHANGE_REQUIRED), whatever URL is opened.
  if (session?.user?.mustChangePassword) {
    return (
      <ChangePasswordScreen
        onChanged={async () => {
          await clearReadCache();
          await refreshSession();
        }}
        onLogout={() => void doLogout()}
      />
    );
  }

  // The trial or subscription is over (as the server said): only the subscription screen and
  // logout. Nothing is deleted; queued sales stay on the device (ADR-0033).
  if (session && isAccessBlocked(session)) {
    return (
      <SubscriptionScreen
        onLogout={() => void doLogout()}
        onRecheck={() => void refreshSession()}
      />
    );
  }

  return (
    <div className={styles.app} dir="rtl">
      <SideNav activeRoute={route} onNavigate={navigate} operatingMode={mode} />
      <div className={styles.main}>
        <Header
          storeName={storeName}
          ownerName={ownerName}
          online={syncState !== "offline"}
          syncState={effectiveSyncState}
          pendingCount={pendingCount}
          onSyncNow={() => scheduleSaleSync(storeId, { now: true })}
          onOpenProfile={() => setShowProfile(true)}
          onLogout={async () => {
            await logout();
            await forgetShopIdentities(db).catch(() => {});
            await clearReadCache();
            router.push("/");
          }}
          signedIn={Boolean(session)}
          onOpenMode={session ? () => setShowMode(true) : undefined}
          onOpenSubscription={
            session ? () => setShowSubscription(true) : undefined
          }
          route={route}
          onBack={route !== "home" ? () => navigate("home") : undefined}
        />
        {route !== "stock" && effectiveSyncState !== "synced" && (
          <SyncBar
            state={effectiveSyncState}
            pendingCount={pendingCount}
            onClick={() => {
              if (effectiveSyncState === "login") {
                setShowAuthModal(true);
                return;
              }
              scheduleSaleSync(storeId, { now: true });
              if (effectiveSyncState === "needsReview") navigate("sales");
            }}
          />
        )}
        <main
          className={`${styles.content} ${route === "ai" ? styles.contentAi : ""}`}
        >
          <Suspense fallback={<ViewLoading />}>{renderCurrentView()}</Suspense>
        </main>
      </div>

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {showMode && (
        <ModeSwitchSheet
          current={session?.store?.operatingMode}
          onClose={() => setShowMode(false)}
          onChanged={async () => {
            await refreshSession();
            await clearReadCache();
          }}
        />
      )}
      {showSubscription && (
        <SubscriptionSheet onClose={() => setShowSubscription(false)} />
      )}

      {showAuthModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999,
            overflowY: "auto",
          }}
        >
          <AuthScreen
            initialMode="login"
            onSuccess={(next) => {
              setShowAuthModal(false);
              void onSignedIn(next);
            }}
            isOffline={syncState === "offline"}
          />
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppShellInner />
      </ToastProvider>
    </AuthProvider>
  );
}

export default AppShell;
