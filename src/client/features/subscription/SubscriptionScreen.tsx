"use client";

/**
 * @file SubscriptionScreen.tsx
 * @description The shop's subscription (ADR-0033, ADR-0008). Blocking: shown instead of the app
 * when the trial or subscription is over — the shop's data is kept, nothing else can be used,
 * and the owner can reach Hesba, check again, or log out. Not blocking: the same facts in a
 * sheet from the shop menu. It never claims a payment or an activation: Hesba activates shops.
 */
import React, { useEffect, useState } from "react";
import { Modal } from "@/client/shared/ui";
import {
  SUBSCRIPTION_LABELS,
  type StoreAccessView,
} from "@/domain/subscription";
import { MODE_LABELS, isOperatingMode } from "@/domain/operating-mode";
import { cairoDateTime, timeLeft } from "./access";
import styles from "./Subscription.module.css";

interface SubscriptionInfo extends StoreAccessView {
  store: { id: string; name: string };
  contact: {
    whatsapp: string | null;
    vodafoneCash: string | null;
    instapay: string | null;
  };
}

function useSubscription(): {
  info: SubscriptionInfo | null;
  error: string | null;
  reload: () => void;
} {
  const [info, setInfo] = useState<SubscriptionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/subscription", { credentials: "same-origin" })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok)
          throw new Error(body?.error?.message || "مقدرناش نجيب حالة الاشتراك");
        return body as SubscriptionInfo;
      })
      .then((b) => {
        if (!alive) return;
        setInfo(b);
        setError(null);
      })
      .catch(
        (e: unknown) =>
          alive && setError(e instanceof Error ? e.message : "مفيش نت"),
      );
    return () => {
      alive = false;
    };
  }, [n]);
  return { info, error, reload: () => setN((x) => x + 1) };
}

function Details({ info }: { info: SubscriptionInfo }) {
  const s = info.subscription;
  const left = timeLeft(s.endsAt, s.checkedAt);
  return (
    <div className={styles.sumbox} data-testid="subscription-details">
      <div className={styles.line}>
        <span>الحالة</span>
        <b
          className={s.allowed ? styles.ok : styles.bad}
          data-testid="subscription-status"
        >
          {SUBSCRIPTION_LABELS[s.status]}
        </b>
      </div>
      {s.status === "trialing" && (
        <div className={styles.line}>
          <span>التجربة بتخلص</span>
          <b>{cairoDateTime(s.trialEndsAt)}</b>
        </div>
      )}
      {s.status === "active" && (
        <div className={styles.line}>
          <span>الاشتراك لحد</span>
          <b>{cairoDateTime(s.subscriptionEndsAt)}</b>
        </div>
      )}
      {left && (
        <div className={styles.line}>
          <span>فاضل</span>
          <b data-testid="subscription-left">{left}</b>
        </div>
      )}
      <div className={styles.line}>
        <span>طريقة التشغيل</span>
        <b>
          {isOperatingMode(info.operatingMode)
            ? MODE_LABELS[info.operatingMode]
            : "—"}
        </b>
      </div>
    </div>
  );
}

function Contact({ info }: { info: SubscriptionInfo }) {
  const c = info.contact;
  const text = `أهلاً، عايز أفعّل اشتراك حِسبة لمحل «${info.store.name}» (رقم المحل: ${info.store.id.slice(0, 8)}).`;
  const wa = c.whatsapp
    ? `https://wa.me/${c.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`
    : null;
  return (
    <>
      {(c.vodafoneCash || c.instapay) && (
        <div className={styles.sumbox} data-testid="subscription-payment">
          {c.vodafoneCash && (
            <div className={styles.line}>
              <span>فودافون كاش</span>
              <b dir="ltr">{c.vodafoneCash}</b>
            </div>
          )}
          {c.instapay && (
            <div className={styles.line}>
              <span>إنستاباي</span>
              <b dir="ltr">{c.instapay}</b>
            </div>
          )}
        </div>
      )}
      {wa ? (
        <a
          className={styles.btn}
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="subscription-whatsapp"
        >
          💬 كلّم إدارة حِسبة على واتساب
        </a>
      ) : (
        <p className={styles.note}>كلّم إدارة حِسبة عشان تفعّل الاشتراك.</p>
      )}
      <p className={styles.note}>
        بعد ما تحوّل، إدارة حِسبة بتفعّل حسابك بنفسها. التفعيل مش بيحصل لوحده من
        التطبيق.
      </p>
    </>
  );
}

/** Blocking: instead of the app, when the trial or subscription is over. */
export function SubscriptionScreen({
  onLogout,
  onRecheck,
}: {
  onLogout: () => void;
  onRecheck: () => void;
}) {
  const { info, error, reload } = useSubscription();
  const suspended = info?.subscription.status === "suspended";
  return (
    <div className={styles.screen} dir="rtl" data-testid="subscription-screen">
      <div className={styles.box}>
        <div className={styles.hero} aria-hidden="true">
          {suspended ? "⛔" : "⏳"}
        </div>
        <h1 className={styles.title}>
          {suspended ? "الحساب موقوف" : "انتهت الفترة"}
        </h1>
        <p className={styles.lead}>
          {suspended
            ? "الحساب ده موقوف من إدارة حِسبة. بيانات المحل محفوظة زي ما هي."
            : "الفترة التجريبية أو الاشتراك خلص. بيانات محلك ومنتجاتك وحساباتك محفوظة كلها، ومحتاج تفعيل عشان تكمّل."}
        </p>
        {error && <div className={styles.err}>{error}</div>}
        {info && <Details info={info} />}
        {info && <Contact info={info} />}
        <button
          type="button"
          className={`${styles.btn} ${styles.ghost}`}
          onClick={() => {
            reload();
            onRecheck();
          }}
          data-testid="subscription-recheck"
        >
          🔄 اتفعّل؟ حدّث الحالة
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.ghost} ${styles.danger}`}
          onClick={onLogout}
          data-testid="subscription-logout"
        >
          تسجيل الخروج
        </button>
      </div>
    </div>
  );
}

/** Not blocking: the subscription from the shop menu. */
export function SubscriptionSheet({ onClose }: { onClose: () => void }) {
  const { info, error } = useSubscription();
  return (
    <Modal title="💳 الاشتراك" onClose={onClose}>
      <div data-testid="subscription-sheet">
        {error && <div className={styles.err}>{error}</div>}
        {!info && !error && <p className={styles.note}>بيحمّل…</p>}
        {info && <Details info={info} />}
        {info && <Contact info={info} />}
      </div>
    </Modal>
  );
}
