"use client";

import React, { useState, useEffect, useCallback } from "react";
import styles from "./AppShell.module.css";
import { Header } from "./Header";
import { BottomNav, type NavRoute } from "./BottomNav";
import { SideNav } from "./SideNav";
import { SyncBar, type SyncState } from "./SyncBar";
import { ToastProvider } from "../shared/ui";

// Import the 8 empty pages
import { HomePage } from "../pages/home/HomePage";
import { ProductsPage } from "../pages/products/ProductsPage";
import { SalesPage } from "../pages/sales/SalesPage";
import { StockPage } from "../pages/stock/StockPage";
import { ExpensesPage } from "../pages/expenses/ExpensesPage";
import { PeoplePage } from "../pages/people/PeoplePage";
import { AlertsPage } from "../pages/alerts/AlertsPage";
import { AiPage } from "../pages/ai/AiPage";

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

  const renderCurrentPage = () => {
    switch (route) {
      case "home":
        return <HomePage />;
      case "products":
        return <ProductsPage />;
      case "sales":
        return <SalesPage />;
      case "stock":
        return <StockPage />;
      case "expenses":
        return <ExpensesPage />;
      case "people":
        return <PeoplePage />;
      case "alerts":
        return <AlertsPage />;
      case "ai":
        return <AiPage />;
      default:
        return <HomePage />;
    }
  };

  return (
    <ToastProvider>
      <div className={styles.app} dir="rtl">
        <SideNav activeRoute={route} onNavigate={navigate} />
        <div className={styles.main}>
          <Header />
          <SyncBar state={syncState} />
          <main className={styles.content}>{renderCurrentPage()}</main>
          <BottomNav activeRoute={route} onNavigate={navigate} />
        </div>
      </div>
    </ToastProvider>
  );
}

export default AppShell;
