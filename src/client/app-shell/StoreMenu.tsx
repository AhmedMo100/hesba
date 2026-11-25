"use client";

/**
 * @file StoreMenu.tsx
 * @description The shop-name button in the header and its menu, ported from the demo
 * (`docs/demo/src/g_app.jsx` `StoreMenu`): shop and owner name with the connection state,
 * account/shop details, the theme (moved here from the top bar), sync status with
 * "sync now", and the shop's package (read-only). Logout is at the end of Home.
 *
 * @remarks
 * The demo's "simulate offline" and "reset demo data" items are demo-only and not ported.
 * Names come from the session, or offline from the identity saved on the device (QA-57).
 */

import React, { useEffect, useRef, useState } from "react";
import styles from "./StoreMenu.module.css";
import { Icon, Seg } from "../shared/ui";
import { t } from "../shared/i18n";
import { useTheme, type ThemeMode } from "../shared/theme";
import { useGhost } from "../shared/hooks/useGhost";
import type { SyncState } from "./SyncBar";

export interface StoreMenuProps {
  storeName?: string | null;
  ownerName?: string | null;
  online: boolean;
  syncState: SyncState;
  pendingCount: number;
  onSyncNow: () => void;
  onOpenProfile: () => void;
  /** Signed in (a session or a saved identity): account items are shown. */
  signedIn: boolean;
  /** When set, the trigger shows this page title instead of the app name. */
  pageTitle?: string;
  /** The shop's package, shown read-only: Hesba's administration changes it (ADR-0037). */
  packageLabel?: string;
  /** «الاشتراك» (ADR-0033), shown when signed in. */
  onOpenSubscription?: () => void;
}

function MenuBox({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGhost(ref, "out");
  return (
    <div className={styles.menu} role="menu" ref={ref} data-testid="store-menu">
      {children}
    </div>
  );
}

export function StoreMenu({
  storeName,
  ownerName,
  online,
  syncState,
  pendingCount,
  onSyncNow,
  onOpenProfile,
  signedIn,
  pageTitle,
  packageLabel,
  onOpenSubscription,
}: StoreMenuProps) {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const displayName = storeName || t("common.appName");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const syncing = syncState === "syncing" || syncState === "updating";
  const syncText = syncing
    ? t("storeMenu.syncing")
    : pendingCount > 0
      ? t("storeMenu.waiting", { count: pendingCount })
      : t("storeMenu.allSynced");

  return (
    <div className={styles.smenu}>
      <button
        type="button"
        className={styles.storeBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t("common.store")}: ${displayName}`}
        data-testid="store-button"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.nameGroup}>
          <span className={styles.appName}>
            {pageTitle || t("common.appName")}
          </span>
          <span className={styles.storeName} data-testid="store-name">
            {displayName}
          </span>
        </span>
        {!online && (
          <i className={styles.offDot} title={t("storeMenu.offline")} />
        )}
      </button>

      {open && (
        <>
          <div className={styles.shield} onClick={() => setOpen(false)} />
          <MenuBox>
            <div className={styles.head}>
              <b>{displayName}</b>
              <small>
                {ownerName ? `${ownerName} · ` : ""}
                {online ? t("storeMenu.online") : t("storeMenu.offlineSaved")}
              </small>
            </div>

            {signedIn && (
              <button
                type="button"
                className={styles.item}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onOpenProfile();
                }}
              >
                <Icon n="store" s={18} />
                {t("storeMenu.profile")}
              </button>
            )}
            {signedIn && packageLabel && (
              <div
                className={styles.packageRow}
                data-testid="store-menu-package"
              >
                <Icon n="layers" s={18} />
                <span>
                  <b>الباقة: {packageLabel}</b>
                  <small>لتغيير الباقة كلّم إدارة حِسبة</small>
                </span>
              </div>
            )}
            {signedIn && onOpenSubscription && (
              <button
                type="button"
                className={styles.item}
                role="menuitem"
                data-testid="store-menu-subscription"
                onClick={() => {
                  setOpen(false);
                  onOpenSubscription();
                }}
              >
                <Icon n="wallet" s={18} />
                {t("storeMenu.subscription")}
              </button>
            )}

            <div className={styles.section}>
              <div className={styles.label}>
                <Icon n="sun" s={18} />
                {t("storeMenu.theme")}
              </div>
              <Seg<ThemeMode>
                size="sm"
                value={theme}
                onChange={setTheme}
                ariaLabel={t("storeMenu.theme")}
                options={[
                  ["light", t("storeMenu.light")],
                  ["dark", t("storeMenu.dark")],
                  ["auto", t("storeMenu.auto")],
                ]}
              />
            </div>

            <div className={styles.section}>
              <div className={styles.label}>
                <Icon n={online ? "wifi" : "wifioff"} s={18} />
                {t("storeMenu.sync")}
              </div>
              <div className={styles.syncRow}>
                <span data-testid="store-menu-sync">{syncText}</span>
                <button
                  type="button"
                  className={styles.syncBtn}
                  disabled={!online || pendingCount === 0 || syncing}
                  onClick={onSyncNow}
                >
                  <Icon n="refresh" s={15} />
                  {t("storeMenu.syncNow")}
                </button>
              </div>
            </div>
          </MenuBox>
        </>
      )}
    </div>
  );
}
