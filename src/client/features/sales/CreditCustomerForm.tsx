"use client";

/**
 * @file CreditCustomerForm.tsx
 * @description Starts a credit sale (آجل): the customer is chosen once for the whole invoice.
 * The owner types a name and/or a phone. An existing customer can be picked from the matches;
 * a phone that already belongs to a customer always reuses that customer (no duplicate). Only
 * a new name with a new phone creates a customer, with no opening balance — the receivable
 * comes from the invoice itself at checkout.
 */
import { apiGet } from "@/client/shared/api/read-cache";
import React, { useEffect, useMemo, useState } from "react";
import { Button, Field, Input, Modal } from "@/client/shared/ui";
import { t } from "@/client/shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import type { CreditCustomer } from "./CartSheet";
import styles from "./CartSheet.module.css";

/** The last 10 digits of a phone (Arabic digits, +20 / 0 prefixes and spaces ignored). */
export function phoneKey(phone: string | null | undefined): string {
  const digits = (phone ?? "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");
  return digits.slice(-10);
}

/** The shop's customers («ليك»), for matching a typed name or phone. */
export async function loadCreditCustomers(): Promise<CreditCustomer[]> {
  const res = await apiGet("/api/people?section=owedToMe");
  if (!res.ok) return [];
  const data = (await res.json()) as {
    people?: Array<{ id: string; name: string; phone: string | null }>;
  } | null;
  return (data?.people ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone ?? null,
  }));
}

/**
 * The customer of a credit invoice from what the owner typed: the customer who already has
 * this phone, else (no phone typed) the customer with exactly this name, else someone new
 * (`id: ""`) whom the checkout records together with the sale. Never two records for one
 * person, even when a checkout is retried.
 */
export async function resolveCreditCustomer(
  name: string,
  phone: string,
  customers: readonly CreditCustomer[],
): Promise<CreditCustomer> {
  const key = phoneKey(phone);
  if (key.length >= 7) {
    const owner = customers.find((c) => phoneKey(c.phone) === key);
    if (owner) return owner;
  }
  const trimmed = name.trim();
  if (!trimmed) throw new Error(t("credit.nameRequired"));
  if (!key) {
    const n = normalizeArabic(trimmed);
    const same = customers.find((c) => normalizeArabic(c.name) === n);
    if (same) return same;
  }
  // Someone new: no record yet (id ""). The checkout creates the customer in the sale's
  // own transaction, so a sale that fails never leaves a customer owing nothing.
  return { id: "", name: trimmed, phone: phone.trim() || null };
}

export function CreditCustomerForm({
  onClose,
  onChosen,
}: {
  onClose: () => void;
  onChosen: (customer: CreditCustomer) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [customers, setCustomers] = useState<CreditCustomer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet("/api/people?section=owedToMe")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: {
            people?: Array<{ id: string; name: string; phone: string | null }>;
          } | null,
        ) => {
          if (alive)
            setCustomers(
              (data?.people ?? []).map((p) => ({
                id: p.id,
                name: p.name,
                phone: p.phone ?? null,
              })),
            );
        },
      )
      .catch(() => alive && setCustomers([]));
    return () => {
      alive = false;
    };
  }, []);

  const key = phoneKey(phone);
  // The customer who already has this phone (the same person: never a second record).
  const phoneOwner = useMemo(
    () =>
      key.length >= 7
        ? ((customers ?? []).find((c) => phoneKey(c.phone) === key) ?? null)
        : null,
    [customers, key],
  );
  const matches = useMemo(() => {
    const q = normalizeArabic(name.trim());
    if (!q && key.length < 3) return [];
    return (customers ?? [])
      .filter(
        (c) =>
          (q && normalizeArabic(c.name).includes(q)) ||
          (key.length >= 3 && phoneKey(c.phone).includes(key)),
      )
      .slice(0, 5);
  }, [customers, name, key]);

  const submit = async () => {
    setError(null);
    if (phoneOwner) {
      onChosen(phoneOwner);
      return;
    }
    if (!name.trim()) {
      setError(t("credit.nameRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || undefined,
          section: "owedToMe",
          amountEgp: "0",
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        person?: { id: string; name: string; phone: string | null };
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.person) {
        setError(json?.error?.message || t("invoice.loadFailed"));
        return;
      }
      onChosen({
        id: json.person.id,
        name: json.person.name,
        phone: json.person.phone ?? null,
      });
    } catch {
      setError(t("invoice.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("credit.title")} onClose={onClose}>
      <div data-testid="credit-form">
        <Field label={t("credit.name")}>
          <Input
            value={name}
            data-testid="credit-name"
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t("credit.phone")}>
          <Input
            value={phone}
            inputMode="tel"
            dir="ltr"
            data-testid="credit-phone"
            autoComplete="off"
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>

        {phoneOwner ? (
          <p className={styles.muted} data-testid="credit-phone-owner">
            {t("credit.phoneBelongsTo", { name: phoneOwner.name })}
          </p>
        ) : matches.length > 0 ? (
          <ul className={styles.lines} aria-label={t("credit.matches")}>
            {matches.map((c) => (
              <li key={c.id} className={styles.line}>
                <button
                  type="button"
                  className={styles.link}
                  data-testid="credit-match"
                  onClick={() => onChosen(c)}
                >
                  {c.name}
                  {c.phone ? <span dir="ltr"> · {c.phone}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {error && (
          <p className={styles.error} role="alert" data-testid="credit-error">
            {error}
          </p>
        )}
        <Button
          wide
          loading={busy}
          disabled={customers === null}
          data-testid="credit-continue"
          onClick={() => void submit()}
        >
          {phoneOwner ? t("credit.useExisting") : t("credit.continue")}
        </Button>
      </div>
    </Modal>
  );
}
