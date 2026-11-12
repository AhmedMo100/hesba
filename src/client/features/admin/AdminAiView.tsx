"use client";

/**
 * @file AdminAiView.tsx
 * @description Hesba platform admin — AI usage and controls (ADR-0030): today's usage across
 * shops, provider status, budget, the 30-day trend, top shops, global switches and limits,
 * per-shop scanner quotas / bonus credits, and the audit log. Only users listed in
 * `platform_admins` get data; everyone else sees "not allowed" (the APIs refuse with 403).
 */
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Field } from "@/client/shared/ui";
import styles from "./AdminAiView.module.css";

type Json = Record<string, unknown>;

interface Settings {
  scannerEnabled: boolean;
  assistantEnabled: boolean;
  scannerDailyDefault: number;
  scannerMonthlyDefault: number;
  scannerMaxImages: number;
  scannerRpm: number;
  assistantRpm: number;
  scannerMaxConcurrent: number;
  assistantMaxConcurrent: number;
  shopRpm: number;
  monthlyBudgetMicros: number;
  scannerCostEstimateMicros: number;
  assistantCostEstimateMicros: number;
  warningThresholdPct: number;
  breakerFailureThreshold: number;
  breakerCooldownSeconds: number;
}

interface Overview {
  dayKey: string;
  today: {
    total: number;
    scanner: number;
    assistant: number;
    assistantMessages: number;
    failed: number;
    rejected: number;
    rateLimitEvents: number;
    estimatedCostMicros: number;
    actualCostMicros: number | null;
    byModel: Array<{
      feature: string;
      provider: string;
      model: string | null;
      requests: number;
      failed: number;
      inputTokens: number;
      outputTokens: number;
    }>;
    errors: Array<{ feature: string; category: string; count: number }>;
  };
  trend: Array<{
    day: string;
    feature: string;
    succeeded: number;
    failed: number;
  }>;
  topShops: Array<{
    storeId: string;
    name: string;
    scans: number;
    assistant: number;
    estimatedCostMicros: number;
  }>;
  budget: {
    monthlyCapMicros: number;
    spentMicros: number;
    reservedMicros: number;
    remainingMicros: number;
    warning: boolean;
  };
  providers: {
    scanner: { provider: string; model: string };
    assistant: {
      provider: string;
      model: string;
      dataSharing: string;
      mode: string;
    };
  };
  health: Array<{
    feature: string;
    available: boolean;
    openUntil: string | null;
    consecutiveFailures: number;
    lastError: string | null;
  }>;
  settings: Settings;
  audit: Array<{
    id: string;
    at: string;
    admin: string;
    shop: string | null;
    action: string;
    previous: unknown;
    next: unknown;
    reason: string | null;
  }>;
}

interface Shop {
  storeId: string;
  name: string;
  scannerEnabled: boolean;
  dailyOverride: number | null;
  monthlyOverride: number | null;
  dailyLimit: number;
  monthlyLimit: number;
  usedToday: number;
  usedThisMonth: number;
  remainingToday: number;
  remainingThisMonth: number;
  bonusCredits: number;
  assistantMessagesToday: number;
}

const usd = (micros: number) =>
  `$${(micros / 1_000_000).toFixed(micros > 0 && micros < 10_000 ? 4 : 2)}`;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as
    (T & { error?: { message?: string } }) | null;
  if (!res.ok || !json) {
    const err = new Error(json?.error?.message || "حصل خطأ") as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return json;
}

const NUMBER_FIELDS: Array<[keyof Settings, string]> = [
  ["scannerDailyDefault", "حد الاسكان اليومي الافتراضي (لكل محل)"],
  ["scannerMonthlyDefault", "حد الاسكان الشهري الافتراضي (لكل محل)"],
  ["scannerMaxImages", "أقصى صور في الاسكان الواحد"],
  ["scannerRpm", "طلبات الاسكان في الدقيقة (للمنصة)"],
  ["assistantRpm", "طلبات المساعد في الدقيقة (للمنصة)"],
  ["scannerMaxConcurrent", "اسكانات في نفس اللحظة"],
  ["assistantMaxConcurrent", "طلبات مساعد في نفس اللحظة"],
  ["shopRpm", "طلبات المحل الواحد في الدقيقة"],
  ["monthlyBudgetMicros", "سقف الصرف الشهري (micro-USD)"],
  ["scannerCostEstimateMicros", "تكلفة الاسكان التقديرية (micro-USD)"],
  ["assistantCostEstimateMicros", "تكلفة طلب المساعد التقديرية (micro-USD)"],
  ["warningThresholdPct", "تنبيه عند نسبة من الميزانية %"],
  ["breakerFailureThreshold", "أخطاء متتالية قبل الإيقاف المؤقت"],
  ["breakerCooldownSeconds", "مدة الإيقاف المؤقت (ثانية)"],
];

function SettingsForm({
  initial,
  onSaved,
}: {
  initial: Settings;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Settings>(initial);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const changed: Json = {};
      for (const k of Object.keys(draft) as Array<keyof Settings>) {
        if (draft[k] !== initial[k]) changed[k] = draft[k];
      }
      if (Object.keys(changed).length === 0) {
        setMsg("مفيش تغيير");
        return;
      }
      await api("/api/admin/ai/settings", {
        ...changed,
        reason: reason || undefined,
      });
      setMsg("اتحفظ ✓");
      setReason("");
      onSaved();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "حصل خطأ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.form} data-testid="admin-settings">
      <label className={styles.switch}>
        <input
          type="checkbox"
          checked={draft.scannerEnabled}
          onChange={(e) =>
            setDraft({ ...draft, scannerEnabled: e.target.checked })
          }
          data-testid="admin-scanner-enabled"
        />
        اسكان المنتجات شغال للمنصة
      </label>
      <label className={styles.switch}>
        <input
          type="checkbox"
          checked={draft.assistantEnabled}
          onChange={(e) =>
            setDraft({ ...draft, assistantEnabled: e.target.checked })
          }
        />
        المساعد شغال للمنصة
      </label>
      <div className={styles.grid}>
        {NUMBER_FIELDS.map(([k, label]) => (
          <Field key={k} label={label}>
            <input
              inputMode="numeric"
              value={String(draft[k])}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  [k]: Number(e.target.value.replace(/\D/g, "") || 0),
                })
              }
              data-testid={`admin-setting-${k}`}
            />
          </Field>
        ))}
      </div>
      <Field label="السبب (بيتسجل في السجل)">
        <input
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <div className={styles.row}>
        <Button
          busy={busy}
          disabled={busy}
          onClick={() => void save()}
          data-testid="admin-settings-save"
        >
          احفظ الإعدادات
        </Button>
        {msg && <span role="status">{msg}</span>}
      </div>
    </div>
  );
}

function ShopRow({ shop, onSaved }: { shop: Shop; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [daily, setDaily] = useState(
    shop.dailyOverride === null ? "" : String(shop.dailyOverride),
  );
  const [monthly, setMonthly] = useState(
    shop.monthlyOverride === null ? "" : String(shop.monthlyOverride),
  );
  const [enabled, setEnabled] = useState(shop.scannerEnabled);
  const [grant, setGrant] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const body: Json = {
        dailyLimit: daily === "" ? null : Number(daily),
        monthlyLimit: monthly === "" ? null : Number(monthly),
        enabled,
        reason: reason || undefined,
      };
      if (grant) body.grantBonusCredits = Number(grant);
      await api(`/api/admin/ai/shops/${shop.storeId}`, body);
      setEdit(false);
      setGrant("");
      setReason("");
      onSaved();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "حصل خطأ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={styles.shop} data-testid={`admin-shop-${shop.storeId}`}>
      <div className={styles.shopHead}>
        <b>{shop.name}</b>
        {!shop.scannerEnabled && (
          <span className={styles.off}>الاسكان مقفول</span>
        )}
        <button
          type="button"
          className={styles.link}
          onClick={() => setEdit((v) => !v)}
          data-testid="admin-shop-edit"
        >
          {edit ? "إغلاق" : "تعديل"}
        </button>
      </div>
      <p className={styles.muted}>
        اسكان اليوم {shop.usedToday}/{shop.dailyLimit} (فاضل{" "}
        {shop.remainingToday}) · الشهر {shop.usedThisMonth}/{shop.monthlyLimit}{" "}
        (فاضل {shop.remainingThisMonth}) · رصيد إضافي {shop.bonusCredits} ·
        رسائل المساعد النهارده {shop.assistantMessagesToday}
      </p>
      {edit && (
        <div className={styles.form}>
          <div className={styles.grid}>
            <Field label="حد يومي (فاضي = الافتراضي)">
              <input
                inputMode="numeric"
                value={daily}
                onChange={(e) => setDaily(e.target.value.replace(/\D/g, ""))}
                data-testid="admin-shop-daily"
              />
            </Field>
            <Field label="حد شهري (فاضي = الافتراضي)">
              <input
                inputMode="numeric"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label="إضافة رصيد اسكان">
              <input
                inputMode="numeric"
                value={grant}
                onChange={(e) => setGrant(e.target.value.replace(/\D/g, ""))}
                data-testid="admin-shop-grant"
              />
            </Field>
          </div>
          <label className={styles.switch}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            الاسكان شغال للمحل ده
          </label>
          <Field label="السبب">
            <input
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className={styles.row}>
            <Button
              busy={busy}
              disabled={busy}
              onClick={() => void save()}
              data-testid="admin-shop-save"
            >
              احفظ
            </Button>
            {msg && <span role="alert">{msg}</span>}
          </div>
        </div>
      )}
    </li>
  );
}

export default function AdminAiView() {
  const [state, setState] = useState<"loading" | "denied" | "ready" | "error">(
    "loading",
  );
  const [data, setData] = useState<Overview | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(
    () =>
      api<Overview>("/api/admin/ai").then(
        (d) => {
          setData(d);
          setState("ready");
        },
        (e: Error & { status?: number }) => {
          if (e.status === 403 || e.status === 401) setState("denied");
          else {
            setError(e.message);
            setState("error");
          }
        },
      ),
    [],
  );
  const loadShops = useCallback(
    (query: string) =>
      api<{ shops: Shop[] }>(
        `/api/admin/ai/shops?q=${encodeURIComponent(query)}`,
      ).then(
        (r) => setShops(r.shops),
        () => undefined,
      ),
    [],
  );

  useEffect(() => {
    void loadOverview().then(() => loadShops(""));
  }, [loadOverview, loadShops]);

  if (state === "loading") return <main className={styles.page}>بيحمّل…</main>;
  if (state === "denied") {
    return (
      <main className={styles.page} data-testid="admin-denied">
        <h1>غير مسموح</h1>
        <p>الصفحة دي لإدارة حسبة بس.</p>
        <Link href="/app">ارجع للمحل</Link>
      </main>
    );
  }
  if (state === "error" || !data) {
    return (
      <main className={styles.page} role="alert">
        {error ?? "حصل خطأ"}
      </main>
    );
  }

  const t = data.today;
  const days = [...new Set(data.trend.map((r) => r.day))];
  const of = (day: string, feature: string) =>
    data.trend.find((r) => r.day === day && r.feature === feature);

  return (
    <main className={styles.page} data-testid="admin-ai" dir="rtl">
      <header className={styles.head}>
        <h1>إدارة الذكاء الاصطناعي</h1>
        <span className={styles.muted}>اليوم {data.dayKey} (القاهرة)</span>
      </header>

      <section className={styles.tiles}>
        <div className={styles.tile}>
          <span>طلبات النهارده</span>
          <b data-testid="admin-today-total">{t.total}</b>
        </div>
        <div className={styles.tile}>
          <span>اسكان ناجح</span>
          <b>{t.scanner}</b>
        </div>
        <div className={styles.tile}>
          <span>ردود المساعد</span>
          <b>{t.assistant}</b>
          <small>رسائل محسوبة: {t.assistantMessages}</small>
        </div>
        <div className={styles.tile}>
          <span>فشل / اترفض</span>
          <b>
            {t.failed} / {t.rejected}
          </b>
        </div>
        <div className={styles.tile}>
          <span>أحداث حدود الاستخدام</span>
          <b>{t.rateLimitEvents}</b>
        </div>
        <div className={styles.tile}>
          <span>تكلفة تقديرية</span>
          <b>{usd(t.estimatedCostMicros)}</b>
          <small>
            فعلية:{" "}
            {t.actualCostMicros === null
              ? "غير متاحة"
              : usd(t.actualCostMicros)}
          </small>
        </div>
      </section>

      <section className={styles.card}>
        <h2>المزوّد والحالة</h2>
        <ul className={styles.list}>
          <li>
            الاسكان: <b>{data.providers.scanner.provider}</b> ·{" "}
            {data.providers.scanner.model}
          </li>
          <li>
            المساعد: <b>{data.providers.assistant.provider}</b> ·{" "}
            {data.providers.assistant.model} ·{" "}
            {data.providers.assistant.mode === "grounded"
              ? "وضع خاص (من غير إرسال بيانات المحل)"
              : "بالنموذج مع الأدوات"}
          </li>
          {data.health.length === 0 && <li>مفيش أخطاء متسجلة.</li>}
          {data.health.map((h) => (
            <li key={h.feature}>
              {h.feature === "scanner" ? "الاسكان" : "المساعد"}:{" "}
              {h.available
                ? "متاح ✓"
                : `واقف مؤقتاً لحد ${new Date(h.openUntil!).toLocaleTimeString("ar-EG")}`}
              {h.lastError
                ? ` · آخر خطأ: ${h.lastError} (${h.consecutiveFailures} متتالي)`
                : ""}
            </li>
          ))}
        </ul>
        <p className={data.budget.warning ? styles.warn : styles.muted}>
          الميزانية الشهرية: {usd(data.budget.monthlyCapMicros)} · اتصرف{" "}
          {usd(data.budget.spentMicros)} · محجوز{" "}
          {usd(data.budget.reservedMicros)} · فاضل{" "}
          {usd(data.budget.remainingMicros)}
          {data.budget.warning ? " — قربت توصل للسقف" : ""}
        </p>
        {t.byModel.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>الخدمة</th>
                <th>المزوّد / النموذج</th>
                <th>طلبات</th>
                <th>فشل</th>
                <th>توكنز (دخل/خرج)</th>
              </tr>
            </thead>
            <tbody>
              {t.byModel.map((m, i) => (
                <tr key={i}>
                  <td>{m.feature}</td>
                  <td>
                    {m.provider} / {m.model ?? "—"}
                  </td>
                  <td>{m.requests}</td>
                  <td>{m.failed}</td>
                  <td>
                    {m.inputTokens}/{m.outputTokens}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {t.errors.length > 0 && (
          <p className={styles.muted}>
            الأخطاء:{" "}
            {t.errors
              .map((e) => `${e.feature}:${e.category}×${e.count}`)
              .join(" · ")}
          </p>
        )}
      </section>

      <section className={styles.card}>
        <h2>آخر 30 يوم</h2>
        {days.length === 0 ? (
          <p className={styles.muted}>مفيش استخدام لسه.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>اليوم</th>
                <th>اسكان</th>
                <th>مساعد</th>
                <th>فشل</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d}>
                  <td>{d}</td>
                  <td>{of(d, "scanner")?.succeeded ?? 0}</td>
                  <td>{of(d, "assistant")?.succeeded ?? 0}</td>
                  <td>
                    {(of(d, "scanner")?.failed ?? 0) +
                      (of(d, "assistant")?.failed ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.card}>
        <h2>أكتر المحلات استخداماً (الشهر)</h2>
        {data.topShops.length === 0 ? (
          <p className={styles.muted}>مفيش استخدام لسه.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>المحل</th>
                <th>اسكان</th>
                <th>مساعد</th>
                <th>تكلفة تقديرية</th>
              </tr>
            </thead>
            <tbody>
              {data.topShops.map((s) => (
                <tr key={s.storeId}>
                  <td>{s.name}</td>
                  <td>{s.scans}</td>
                  <td>{s.assistant}</td>
                  <td>{usd(s.estimatedCostMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.card}>
        <h2>الإعدادات العامة</h2>
        <SettingsForm
          key={JSON.stringify(data.settings)}
          initial={data.settings}
          onSaved={() => void loadOverview()}
        />
      </section>

      <section className={styles.card}>
        <h2>حدود الاسكان لكل محل</h2>
        <div className={styles.row}>
          <input
            className={styles.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="اسم المحل أو رقمه"
            data-testid="admin-shop-search"
          />
          <Button kind="ghost" onClick={() => void loadShops(q)}>
            دوّر
          </Button>
        </div>
        <ul className={styles.shops}>
          {shops.map((s) => (
            <ShopRow
              key={`${s.storeId}-${s.bonusCredits}-${s.dailyLimit}-${s.monthlyLimit}-${s.scannerEnabled}`}
              shop={s}
              onSaved={() => {
                void loadShops(q);
                void loadOverview();
              }}
            />
          ))}
        </ul>
      </section>

      <section className={styles.card}>
        <h2>سجل التعديلات</h2>
        {data.audit.length === 0 ? (
          <p className={styles.muted}>مفيش تعديلات لسه.</p>
        ) : (
          <ul className={styles.list} data-testid="admin-audit">
            {data.audit.map((a) => (
              <li key={a.id}>
                <b>
                  {new Date(a.at).toLocaleString("ar-EG", {
                    timeZone: "Africa/Cairo",
                  })}
                </b>{" "}
                · {a.admin} · {a.shop ?? "المنصة"} · {a.action}
                <br />
                <small className={styles.muted}>
                  قبل: {JSON.stringify(a.previous)} ← بعد:{" "}
                  {JSON.stringify(a.next)}
                  {a.reason ? ` · السبب: ${a.reason}` : ""}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
