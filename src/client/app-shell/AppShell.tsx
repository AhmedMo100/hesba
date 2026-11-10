"use client";

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
import styles from "./AppShell.module.css";
import { Header } from "./Header";
import { BottomNav, type NavRoute } from "./BottomNav";
import { SideNav } from "./SideNav";
import { SyncBar, type SyncState } from "./SyncBar";
import { ToastProvider } from "../shared/ui";
import { t } from "../shared/i18n";

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

const ProductsView = lazy(loadProductsView);
const SalesView = lazy(loadSalesView);
const StockView = lazy(loadStockView);
const ExpensesView = lazy(loadExpensesView);
const PeopleView = lazy(loadPeopleView);
const AlertsView = lazy(loadAlertsView);
const AiView = lazy(loadAiView);

const VALID_ROUTES: NavRoute[] = [
  "home",
  "products",
  "sales",
  "stock",
  "expenses",
  "people",
  "alerts",
  "ai",
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

function ViewLoading() {
  return (
    <div className={styles.viewLoading} role="status" aria-live="polite">
      <span>{t("common.loading")}</span>
    </div>
  );
}

import { AuthProvider, useAuth } from "../shared/auth";
import { useLiveQuery } from "dexie-react-hooks";
import {
  lastOutboxStore,
  listSaleOps,
  rememberOutboxStore,
  scheduleSaleSync,
  setActiveOutboxStore,
  type SaleOutboxOp,
} from "../offline/outbox";
import { AuthScreen } from "../features/auth/AuthScreen";
import { ProfileModal } from "../features/auth/ProfileModal";

function AppShellInner() {
  const { session, isOfflineExpired } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [alertCount, setAlertCount] = useState<number>(0);

  useEffect(() => {
    let isMounted = true;
    const fetchAlertsCount = () => {
      fetch("/api/alerts")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!isMounted) return;
          if (typeof data?.totalAlerts === "number") {
            setAlertCount(data.totalAlerts);
          }
        })
        .catch(() => {});
    };

    void fetchAlertsCount();
    window.addEventListener("hesba_alerts_updated", fetchAlertsCount);
    return () => {
      isMounted = false;
      window.removeEventListener("hesba_alerts_updated", fetchAlertsCount);
    };
  }, []);

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
    switch (route) {
      case "home":
        return <HomeView />;
      case "products":
        return <ProductsView />;
      case "sales":
        return <SalesView />;
      case "stock":
        return <StockView />;
      case "expenses":
        return <ExpensesView />;
      case "people":
        return <PeopleView />;
      case "alerts":
        return <AlertsView />;
      case "ai":
        return <AiView />;
      default:
        return <HomeView />;
    }
  };

  // Sales waiting in the outbox (ADR-0020), live across tabs. Sync runs on events only:
  // startup / sign-in, back online, tab visible again, a new sale, or a tap on the bar.
  // Offline the session request fails; the shop last signed in on this device still owns the
  // queue, so its waiting sales stay visible (and new ones can be queued) after a reload.
  const { isLoading: authLoading } = useAuth();
  useEffect(() => {
    if (session?.store?.id) {
      rememberOutboxStore(session.store.id);
    } else if (
      !authLoading &&
      typeof navigator !== "undefined" &&
      navigator.onLine
    ) {
      rememberOutboxStore(null); // online and signed out: forget it
    }
  }, [session?.store?.id, authLoading]);
  // While the session is not (re)loaded — offline, or just back online — keep showing the
  // remembered shop's queue instead of a false "0 waiting / synced".
  const storeId = session?.store?.id ?? lastOutboxStore();
  // `undefined` until IndexedDB has answered: the bar must not claim "synced" before that.
  const queuedSales = useLiveQuery(
    () =>
      storeId ? listSaleOps(storeId) : Promise.resolve([] as SaleOutboxOp[]),
    [storeId],
  );
  useEffect(() => {
    // Only the signed-in shop's queued sales are ever sent from this tab.
    setActiveOutboxStore(storeId ?? null);
    if (!storeId || typeof window === "undefined") return;
    scheduleSaleSync(storeId, { now: true });
    const onOnline = () => scheduleSaleSync(storeId, { now: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleSaleSync(storeId);
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [storeId]);
  const queueKnown = queuedSales !== undefined;
  const waitingCount = (queuedSales ?? []).filter(
    (o) => o.status === "pending" || o.status === "sending",
  ).length;
  const reviewCount = (queuedSales ?? []).filter(
    (o) => o.status === "rejected" || o.status === "quarantined",
  ).length;

  // Honest status: "synced" only when nothing is waiting or needs review.
  const effectiveSyncState: SyncState = isOfflineExpired
    ? "login"
    : syncState === "offline"
      ? "offline"
      : reviewCount > 0
        ? "needsReview"
        : waitingCount > 0 || !queueKnown
          ? "syncing"
          : "synced";

  return (
    <div className={styles.app} dir="rtl">
      <SideNav activeRoute={route} onNavigate={navigate} />
      <div className={styles.main}>
        <Header
          storeName={session?.store?.name}
          onStoreClick={() => setShowProfile(true)}
          alertCount={alertCount}
          onNavigate={navigate}
        />
        <SyncBar
          state={effectiveSyncState}
          pendingCount={waitingCount + reviewCount}
          onClick={() => {
            if (isOfflineExpired) {
              setShowAuthModal(true);
              return;
            }
            scheduleSaleSync(storeId, { now: true });
            if (reviewCount > 0) navigate("sales");
          }}
        />
        <main
          className={`${styles.content} ${route === "ai" ? styles.contentAi : ""}`}
        >
          <Suspense fallback={<ViewLoading />}>{renderCurrentView()}</Suspense>
        </main>
        <BottomNav
          activeRoute={route}
          onNavigate={navigate}
          alertCount={alertCount}
        />
      </div>

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}

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
            onSuccess={() => setShowAuthModal(false)}
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
