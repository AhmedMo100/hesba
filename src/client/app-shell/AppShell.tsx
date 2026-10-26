"use client";

import React, { useState, useEffect, useCallback, Suspense, lazy } from "react";
import styles from "./AppShell.module.css";
import { Header } from "./Header";
import { BottomNav, type NavRoute } from "./BottomNav";
import { SideNav } from "./SideNav";
import { SyncBar, type SyncState } from "./SyncBar";
import { ToastProvider } from "../shared/ui";
import { t } from "../shared/i18n";

// Eagerly loaded default view
import { HomeView } from "./views/HomeView";

// Lazy-loaded views
const loadProductsView = () => import("./views/ProductsView");
const loadSalesView = () => import("./views/SalesView");
const loadStockView = () => import("./views/StockView");
const loadExpensesView = () => import("./views/ExpensesView");
const loadPeopleView = () => import("./views/PeopleView");
const loadAlertsView = () => import("./views/AlertsView");
const loadAiView = () => import("./views/AiView");

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

export function AppShell() {
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

    // Register service worker for offline precaching
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {});
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

  return (
    <ToastProvider>
      <div className={styles.app} dir="rtl">
        <SideNav activeRoute={route} onNavigate={navigate} />
        <div className={styles.main}>
          <Header />
          <SyncBar state={syncState} />
          <main className={styles.content}>
            <Suspense fallback={<ViewLoading />}>
              {renderCurrentView()}
            </Suspense>
          </main>
          <BottomNav activeRoute={route} onNavigate={navigate} />
        </div>
      </div>
    </ToastProvider>
  );
}

export default AppShell;
