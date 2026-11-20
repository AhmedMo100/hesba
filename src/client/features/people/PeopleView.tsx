"use client";

import { apiGet } from "@/client/shared/api/read-cache";
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import styles from "./PeopleView.module.css";
import { Icon, Empty, Modal, useToast, ListSkeleton } from "@/client/shared/ui";
import { t } from "@/client/shared/i18n";
import { type PeopleSection } from "@/schemas/people";
import { parseEgpToPiasters } from "@/domain/money";
import { useRetryOpId } from "@/client/shared/hooks/useRetryOpId";
import { PurchasesSheet } from "./PurchasesSheet";
import { CustomerDebtSheet } from "./CustomerDebtSheet";
import { CustomerInvoicesSheet } from "./CustomerInvoicesSheet";
import {
  fetchStoreMachines,
  type PosMachine,
} from "@/client/shared/api/machines";

interface SuppliedProduct {
  id: string;
  name: string;
}

interface PersonItem {
  id: string;
  store_id: string;
  section: PeopleSection;
  kind: "customer" | "supplier" | "both";
  name: string;
  phone: string | null;
  /** Signed, never floored (ADR-0023): < 0 is a credit (paid beyond what was owed). */
  amount_piasters: number;
  /** The credit of a negative balance (≥ 0). */
  credit_piasters?: number;
  total_original_piasters?: number;
  total_paid_piasters?: number;
  is_settled?: boolean;
  note: string | null;
  supplies: SuppliedProduct[];
  created_at: string;
  updated_at: string;
}

interface StoreProductOption {
  id: string;
  name: string;
}

interface SectionFinancialSummary {
  total_original_piasters: number;
  total_paid_piasters: number;
  total_remaining_piasters: number;
  total_count: number;
  active_count: number;
  settled_count: number;
}

interface SectionState {
  people: PersonItem[];
  count: number;
  totalPiasters: number;
  summary: SectionFinancialSummary;
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

import {
  formatEgp,
  getWaUrl,
  parseCustomerNotes,
  serializeCustomerNotes,
  parseSupplierNotes,
  serializeSupplierNotes,
} from "./people.logic";

export function PeopleView() {
  const [section, setSection] = useState<PeopleSection>("owedToMe");

  const defaultSummary: SectionFinancialSummary = {
    total_original_piasters: 0,
    total_paid_piasters: 0,
    total_remaining_piasters: 0,
    total_count: 0,
    active_count: 0,
    settled_count: 0,
  };

  // Strictly isolated state per section
  const [sectionsData, setSectionsData] = useState<
    Record<PeopleSection, SectionState>
  >({
    owedToMe: {
      people: [],
      count: 0,
      totalPiasters: 0,
      summary: defaultSummary,
      loaded: false,
      loading: true,
      error: null,
    },
    iOwe: {
      people: [],
      count: 0,
      totalPiasters: 0,
      summary: defaultSummary,
      loaded: false,
      loading: false,
      error: null,
    },
    suppliers: {
      people: [],
      count: 0,
      totalPiasters: 0,
      summary: defaultSummary,
      loaded: false,
      loading: false,
      error: null,
    },
  });

  // Add / Edit Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<PersonItem | null>(null);

  // Progressive disclosure states in form
  const [showProductField, setShowProductField] = useState(false);

  // Product combobox dropdown state
  const [storeProducts, setStoreProducts] = useState<StoreProductOption[]>([]);
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const comboboxRef = useRef<HTMLDivElement>(null);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<PersonItem | null>(null);
  const toast = useToast();
  // QA-30: the supplier whose purchase invoices are open.
  const [debtTarget, setDebtTarget] = useState<PersonItem | null>(null);
  // V19: a row opens the person's sheet with every action on them.
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  // «فواتير الزبون»: the credit invoices behind what a customer owes (Prompt 2).
  const [invoicesTarget, setInvoicesTarget] = useState<PersonItem | null>(null);
  const [purchasesTarget, setPurchasesTarget] = useState<PersonItem | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Form input state
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formAmount, setFormAmount] = useState("");
  // The amount the edit form opened with: the balance is sent only when the owner changed
  // it, so renaming a person never writes a balance entry (QA-12).
  const [formAmountInitial, setFormAmountInitial] = useState("");
  const [formNote, setFormNote] = useState("");
  const [supplierOwedMoneyNote, setSupplierOwedMoneyNote] = useState("");
  const [supplierProductsNote, setSupplierProductsNote] = useState("");
  const [formSupplies, setFormSupplies] = useState<SuppliedProduct[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        comboboxRef.current &&
        !comboboxRef.current.contains(event.target as Node)
      ) {
        setIsProductDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Fetches data for a specific section independently
  const fetchSectionData = useCallback(async (targetSection: PeopleSection) => {
    setSectionsData((prev) => ({
      ...prev,
      [targetSection]: {
        ...prev[targetSection],
        loading: true,
        error: null,
      },
    }));

    try {
      const res = await apiGet(`/api/people?section=${targetSection}`);
      if (!res.ok) {
        throw new Error(t("pages.people.loadError") || "تعذر تحميل البيانات");
      }
      const data = await res.json();
      setSectionsData((prev) => ({
        ...prev,
        [targetSection]: {
          people: data.people || [],
          count: data.count || 0,
          totalPiasters: data.total_piasters || 0,
          summary: data.summary || {
            total_original_piasters: data.total_piasters || 0,
            total_paid_piasters: 0,
            total_remaining_piasters: data.total_piasters || 0,
            total_count: data.count || 0,
            active_count: data.count || 0,
            settled_count: 0,
          },
          loaded: true,
          loading: false,
          error: null,
        },
      }));
    } catch (err: unknown) {
      setSectionsData((prev) => ({
        ...prev,
        [targetSection]: {
          ...prev[targetSection],
          loading: false,
          error:
            err instanceof Error
              ? err.message
              : t("pages.people.loadError") || "تعذر تحميل البيانات",
        },
      }));
    }
  }, []);

  // On tab switch, trigger fetch if not yet loaded
  useEffect(() => {
    fetchSectionData(section);
  }, [section, fetchSectionData]);

  // Load store products when opening supplier modal
  const loadStoreProducts = useCallback(async () => {
    try {
      const res = await apiGet("/api/products?scope=store");
      if (res.ok) {
        const data = await res.json();
        const prods = (data.products || []).map(
          (p: { id: string; name_ar?: string; nameNorm?: string }) => ({
            id: p.id,
            name: p.name_ar || "منتج",
          }),
        );
        setStoreProducts(prods);
      }
    } catch {
      // Non-critical, fallback to empty
    }
  }, []);

  const openAddModal = () => {
    setEditingPerson(null);
    setFormName("");
    setFormPhone("");
    setFormAmount("");
    setFormNote("");
    setSupplierOwedMoneyNote("");
    setSupplierProductsNote("");
    setFormSupplies([]);
    setFormError(null);
    setShowProductField(false);
    setIsProductDropdownOpen(false);
    setProductSearchQuery("");
    setModalOpen(true);
    if (section === "suppliers") {
      loadStoreProducts();
    }
  };

  const openEditModal = (p: PersonItem) => {
    setEditingPerson(p);
    setFormName(p.name);
    setFormPhone(p.phone || "");
    const egpVal = p.amount_piasters / 100;
    const initialAmount =
      p.amount_piasters > 0
        ? p.amount_piasters % 100 === 0
          ? String(egpVal)
          : egpVal.toFixed(2)
        : "";
    setFormAmount(initialAmount);
    setFormAmountInitial(initialAmount);
    if (p.section === "suppliers") {
      const parsed = parseSupplierNotes(p.note);
      setSupplierOwedMoneyNote(parsed.owedMoneyNote);
      setSupplierProductsNote(parsed.productsNote);
      setFormNote(parsed.generalNote);
      setFormSupplies(p.supplies || []);
      setShowProductField((p.supplies || []).length > 0);
      loadStoreProducts();
    } else if (p.section === "owedToMe") {
      setSupplierOwedMoneyNote("");
      setSupplierProductsNote("");
      const parsedCust = parseCustomerNotes(p.note);
      setFormNote(parsedCust.generalNote);
      const custSupplies = parsedCust.products.map((name, idx) => ({
        id: `prod_${idx}_${name}`,
        name,
      }));
      setFormSupplies(custSupplies);
      setShowProductField(custSupplies.length > 0);
      loadStoreProducts();
    } else {
      setSupplierOwedMoneyNote("");
      setSupplierProductsNote("");
      setFormNote(p.note || "");
      setFormSupplies([]);
      setShowProductField(false);
    }
    setFormError(null);
    setIsProductDropdownOpen(false);
    setProductSearchQuery("");
    setModalOpen(true);
  };

  const handleSavePerson = async () => {
    if (!formName.trim()) {
      setFormError(t("pages.people.nameRequired") || "اكتب الاسم");
      return;
    }

    const isSupplier = section === "suppliers";
    const isCustomer = section === "owedToMe";

    let finalNote: string | null = formNote.trim() || null;
    if (isSupplier) {
      finalNote = serializeSupplierNotes({
        owedMoneyNote: supplierOwedMoneyNote,
        productsNote: supplierProductsNote,
        generalNote: formNote,
      });
    } else if (isCustomer) {
      finalNote = serializeCustomerNotes(
        formSupplies.map((s) => s.name),
        formNote,
      );
    }

    // Suppliers' balances are not edited in this form. For the others, an edit sends the
    // balance only when the owner changed the field (the server then records ONE labelled
    // owner adjustment); a new person sends their opening balance.
    const amountChanged = formAmount.trim() !== formAmountInitial.trim();
    const amountNum = isSupplier
      ? 0
      : formAmount.trim()
        ? parseEgpToPiasters(formAmount)
        : 0;

    if (amountNum < 0) {
      setFormError("المبلغ غير صحيح");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      if (editingPerson) {
        // PATCH existing
        const res = await fetch(`/api/people/${editingPerson.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            phone: formPhone.trim() || null,
            ...(!isSupplier && amountChanged
              ? { amountPiasters: amountNum }
              : {}),
            note: finalNote,
            supplies: isSupplier ? formSupplies.map((s) => s.id) : [],
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData?.error?.message || "فشل في حفظ التعديل");
        }
      } else {
        // POST new person explicitly scoped to current active section
        const res = await fetch("/api/people", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            phone: formPhone.trim() || null,
            section,
            amountPiasters: amountNum,
            note: finalNote,
            supplies: isSupplier ? formSupplies.map((s) => s.id) : [],
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData?.error?.message || "فشل في إضافة الشخص");
        }
      }

      setModalOpen(false);
      await fetchSectionData(section);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "حدث خطأ أثناء الحفظ");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/people/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("تعذر الحذف");
      setDeleteTarget(null);
      setModalOpen(false);
      await fetchSectionData(section);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "تعذر الحذف");
    } finally {
      setIsDeleting(false);
    }
  };

  const paymentOp = useRetryOpId();

  // ─── The person sheet's payment (V19 personPay): cash or one of the shop's wallets ───
  const [sheetAmount, setSheetAmount] = useState("");
  const [sheetPay, setSheetPay] = useState<string>("cash");
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [machines, setMachines] = useState<PosMachine[]>([]);
  useEffect(() => {
    void fetchStoreMachines().then((list) =>
      setMachines(list.filter((m) => m.status !== "inactive")),
    );
  }, []);
  useEffect(() => {
    // A fresh sheet for every person opened.
    setSheetAmount("");
    setSheetPay("cash");
    setSheetError(null);
  }, [openPersonId]);

  const payFromSheet = async (p: PersonItem) => {
    setSheetError(null);
    const amount = sheetAmount.trim() ? parseEgpToPiasters(sheetAmount) : 0;
    if (!(amount > 0)) {
      setSheetError("اكتب المبلغ");
      return;
    }
    const machine =
      sheetPay === "cash" ? null : machines.find((m) => m.id === sheetPay);
    const collect = section === "owedToMe";
    if (machine && !collect && machine.currentBalancePiasters < amount) {
      setSheetError(`رصيد ${machine.name} مش كافي`);
      return;
    }
    setSheetBusy(true);
    try {
      const body = {
        type: "payment" as const,
        amountPiasters: amount,
        paidFrom: machine ? ("wallet" as const) : ("cash" as const),
        ...(machine ? { paidFromMachineId: machine.id } : {}),
        person: p.id,
      };
      const { person: _p, ...send } = body;
      void _p;
      const res = await fetch(`/api/people/${p.id}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...send, opId: paymentOp.opIdFor(body) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "مقدرناش نسجّل الدفعة");
      }
      paymentOp.reset();
      setSheetAmount("");
      toast.show({ msg: "تمام ✅", kind: "ok" });
      await fetchSectionData(section);
      if (machine) {
        void fetchStoreMachines().then((list) =>
          setMachines(list.filter((m) => m.status !== "inactive")),
        );
      }
    } catch (err: unknown) {
      setSheetError(
        err instanceof Error ? err.message : "مقدرناش نسجّل الدفعة",
      );
    } finally {
      setSheetBusy(false);
    }
  };

  // Filtered available store products for supplier combobox
  const filteredProductOptions = useMemo(() => {
    const selectedIds = new Set(formSupplies.map((s) => s.id));
    const available = storeProducts.filter((p) => !selectedIds.has(p.id));
    if (!productSearchQuery.trim()) {
      return available;
    }
    const q = productSearchQuery.trim().toLowerCase();
    return available.filter((p) => p.name.toLowerCase().includes(q));
  }, [storeProducts, formSupplies, productSearchQuery]);

  // Current active section data
  const currentSectionData = sectionsData[section];
  const people = currentSectionData.people;
  const loading = currentSectionData.loading;
  const error = currentSectionData.error;

  return (
    <div className={styles.container} data-testid="page-people">
      {/* Tabs (V19 chips) */}
      <div className={styles.chips} role="tablist">
        {(
          [
            ["owedToMe", t("pages.people.owedToMe")],
            ["suppliers", t("pages.people.suppliers")],
          ] as Array<[PeopleSection, string]>
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={section === k}
            className={`${styles.chip} ${section === k ? styles.chipOn : ""}`}
            onClick={() => setSection(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content / States */}
      {error ? (
        <div className={styles.errorCard} role="alert">
          <Icon n="alert" s={24} />
          <p className={styles.errorTitle}>{error}</p>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={() => fetchSectionData(section)}
          >
            <Icon n="refresh" s={16} />
            <span>{t("pages.people.retry")}</span>
          </button>
        </div>
      ) : loading && !currentSectionData.loaded ? (
        <ListSkeleton label={t("common.loading")} />
      ) : people.length === 0 ? (
        <Empty icon="users" title={t("pages.people.empty")} />
      ) : (
        <div className={styles.rows}>
          {people.map((p) => (
            <button
              type="button"
              key={p.id}
              className={styles.row}
              data-testid={`person-row-${p.id}`}
              onClick={() => setOpenPersonId(p.id)}
            >
              <span className={styles.rowEm} aria-hidden="true">
                {section === "suppliers" ? "🚚" : "👤"}
              </span>
              <span className={styles.rowT}>
                <b>{p.name}</b>
                <small>
                  {p.phone || t("pages.people.noPhone")}
                  {section === "suppliers" &&
                  p.supplies &&
                  p.supplies.length > 0
                    ? ` · ${p.supplies.map((x) => x.name).join("، ")}`
                    : ""}
                </small>
              </span>
              <b className={styles.rowAmt}>
                {p.amount_piasters < 0
                  ? formatEgp(p.credit_piasters ?? 0)
                  : formatEgp(p.amount_piasters)}
              </b>
            </button>
          ))}
        </div>
      )}

      {/* The total, at the bottom (owed to me / what I owe the suppliers) */}
      {!error && currentSectionData.loaded && (
        <div className={styles.totalRow} data-testid="people-total">
          <span>
            {section === "suppliers"
              ? "المجموع اللي عليك للموردين"
              : "المجموع اللي ليك عند الناس"}
            <small>
              {" "}
              ·{" "}
              {section === "suppliers"
                ? t("pages.people.suppliersCount", {
                    count: currentSectionData.count,
                  })
                : `${currentSectionData.count} شخص`}
            </small>
          </span>
          <b>{formatEgp(currentSectionData.totalPiasters)}</b>
        </div>
      )}

      <button
        type="button"
        className={styles.v19Btn}
        onClick={openAddModal}
        data-testid="btn-add-person"
      >
        {section === "suppliers"
          ? "+ مورد جديد"
          : section === "owedToMe"
            ? "+ عميل جديد"
            : `+ ${t("pages.people.add")}`}
      </button>

      {/* The person's sheet (V19 personSheet): the balance, an amount, how it was paid, one
          button — plus the person's own actions (message, edit, delete, invoices). */}
      {(() => {
        const p = people.find((x) => x.id === openPersonId);
        if (!p) return null;
        const collect = section === "owedToMe";
        const credit = p.amount_piasters < 0;
        return (
          <Modal title={p.name} onClose={() => setOpenPersonId(null)}>
            <div
              className={styles.v19Sheet}
              key={p.id}
              data-testid={`person-card-${p.id}`}
            >
              <div className={styles.line}>
                <span>الرصيد</span>
                <b data-testid={`person-balance-${p.id}`}>
                  {credit
                    ? t(
                        collect
                          ? "pages.people.creditCustomer"
                          : "pages.people.creditPayable",
                        { amount: formatEgp(p.credit_piasters ?? 0) },
                      )
                    : formatEgp(p.amount_piasters)}
                </b>
              </div>
              {p.phone && (
                <div className={styles.line}>
                  <span>الموبايل</span>
                  <a href={`tel:${p.phone}`} dir="ltr" className={styles.tel}>
                    {p.phone}
                  </a>
                </div>
              )}
              {section === "suppliers" &&
                p.supplies &&
                p.supplies.length > 0 && (
                  <div className={styles.line}>
                    <span>بيوردلك</span>
                    <span>{p.supplies.map((x) => x.name).join("، ")}</span>
                  </div>
                )}

              <label className={styles.lbl} htmlFor="person-pay-amount">
                المبلغ
              </label>
              <input
                id="person-pay-amount"
                className={styles.v19Input}
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={sheetAmount}
                onChange={(e) => setSheetAmount(e.target.value)}
                data-testid="person-pay-amount"
              />
              <span className={styles.lbl}>
                {collect ? "الفلوس اتدفعت لك إزاي؟" : "بتدفع إزاي؟"}
              </span>
              <div className={styles.chips} data-testid="person-pay-from">
                <button
                  type="button"
                  className={`${styles.chip} ${sheetPay === "cash" ? styles.chipOn : ""}`}
                  onClick={() => setSheetPay("cash")}
                  data-testid="payment-from-cash"
                >
                  💵 كاش
                </button>
                {machines.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`${styles.chip} ${sheetPay === m.id ? styles.chipOn : ""}`}
                    onClick={() => setSheetPay(m.id)}
                    data-testid="payment-from-machine"
                  >
                    💳 {m.name}
                  </button>
                ))}
              </div>
              {(() => {
                // Paying more than is owed is allowed and becomes a visible credit (ADR-0023).
                const typed = sheetAmount.trim()
                  ? parseEgpToPiasters(sheetAmount)
                  : 0;
                const extra = typed - Math.max(p.amount_piasters, 0);
                return typed > 0 && extra > 0 ? (
                  <p className={styles.v19Note} data-testid="overpay-hint">
                    {t(
                      collect
                        ? "pages.people.overpayCustomerHint"
                        : "pages.people.overpayPayableHint",
                      { amount: formatEgp(extra) },
                    )}
                  </p>
                ) : null;
              })()}
              {sheetError && (
                <p className={styles.v19Error} role="alert">
                  {sheetError}
                </p>
              )}
              <button
                type="button"
                className={styles.v19Btn}
                disabled={sheetBusy}
                onClick={() => void payFromSheet(p)}
                data-testid="person-pay"
              >
                {collect ? "استلمت الفلوس ✅" : "دفعت ✅"}
              </button>

              <div className={styles.sheetActions}>
                {collect && (
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    data-testid={`customer-debt-${p.id}`}
                    onClick={() => setDebtTarget(p)}
                  >
                    📒 {t("pages.people.recordDebt")}
                  </button>
                )}
                {collect ? (
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    data-testid={`customer-invoices-${p.id}`}
                    onClick={() => setInvoicesTarget(p)}
                  >
                    🧾 الفواتير والمدفوعات
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    data-testid={`supplier-purchases-${p.id}`}
                    onClick={() => setPurchasesTarget(p)}
                  >
                    🧾 {t("invoice.purchasesTitle")}
                  </button>
                )}
                {p.phone && (
                  <a
                    className={styles.ghostBtn}
                    href={getWaUrl(p.phone, p.name, section, p.amount_piasters)}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`person-message-${p.id}`}
                    aria-label={`${t("pages.people.waChat")} ${p.name}`}
                  >
                    💬 ابعتله رسالة
                  </a>
                )}
                <button
                  type="button"
                  className={styles.ghostBtn}
                  data-testid={`person-edit-${p.id}`}
                  aria-label={`${t("common.edit")} ${p.name}`}
                  onClick={() => openEditModal(p)}
                >
                  ✏️ {t("common.edit")}
                </button>
                <button
                  type="button"
                  className={`${styles.ghostBtn} ${styles.ghostDanger}`}
                  data-testid={`person-delete-${p.id}`}
                  aria-label={`${t("common.delete")} ${p.name}`}
                  onClick={() => setDeleteTarget(p)}
                >
                  🗑️ {t("common.delete")}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* Add / Edit Modal */}
      {modalOpen && (
        <Modal
          onClose={() => !isSubmitting && setModalOpen(false)}
          title={
            editingPerson
              ? section === "suppliers"
                ? t("pages.people.editSupplier")
                : section === "iOwe"
                  ? t("pages.people.editPayable")
                  : t("pages.people.editCustomer")
              : section === "suppliers"
                ? t("pages.people.addSupplier")
                : section === "iOwe"
                  ? t("pages.people.addPayable")
                  : t("pages.people.addCustomer")
          }
          footer={
            <div className={styles.modalFooter}>
              {editingPerson && (
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={() => setDeleteTarget(editingPerson)}
                  disabled={isSubmitting}
                >
                  <Icon n="trash" s={16} />
                  <span>{t("common.delete")}</span>
                </button>
              )}

              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setModalOpen(false)}
                disabled={isSubmitting}
              >
                <span>{t("common.cancel")}</span>
              </button>

              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleSavePerson}
                disabled={isSubmitting}
              >
                <Icon n="check" s={18} />
                <span>
                  {isSubmitting ? t("common.saving") : t("common.save")}
                </span>
              </button>
            </div>
          }
        >
          <div className={styles.modalForm}>
            {formError && <div className={styles.formError}>{formError}</div>}

            {/* Name */}
            <div className={styles.formGroup}>
              <label className={styles.fieldLabel}>
                {t("pages.people.formName")}
              </label>
              <input
                type="text"
                className={styles.inputField}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={
                  section === "suppliers"
                    ? "مثلاً: شركة النور"
                    : "مثلاً: أبو خالد"
                }
                autoFocus
              />
            </div>

            {/* Phone */}
            <div className={styles.formGroup}>
              <label className={styles.fieldLabel}>
                {t("pages.people.formPhone")}
              </label>
              <input
                type="tel"
                className={styles.inputField}
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                placeholder="01001112233"
                dir="ltr"
              />
            </div>

            {/* Supplier Form Specific: Notes & Supplies */}
            {section === "suppliers" ? (
              <>
                {/* عليك ليهم فلوس؟ كـ ملاحظة */}
                <div className={styles.formGroup}>
                  <label className={styles.fieldLabel}>
                    {t("pages.people.supplierOwedMoneyNote")}
                  </label>
                  <input
                    type="text"
                    className={styles.inputField}
                    value={supplierOwedMoneyNote}
                    onChange={(e) => setSupplierOwedMoneyNote(e.target.value)}
                    placeholder={t("pages.people.supplierOwedMoneyPlaceholder")}
                  />
                </div>

                {/* ليك عندهم منتجات؟ كـ ملاحظة */}
                <div className={styles.formGroup}>
                  <label className={styles.fieldLabel}>
                    {t("pages.people.supplierProductsNote")}
                  </label>
                  <input
                    type="text"
                    className={styles.inputField}
                    value={supplierProductsNote}
                    onChange={(e) => setSupplierProductsNote(e.target.value)}
                    placeholder={t("pages.people.supplierProductsPlaceholder")}
                  />
                </div>

                {/* Supplies selection with Progressive Disclosure */}
                {!showProductField ? (
                  <button
                    type="button"
                    className={styles.toggleFieldBtn}
                    onClick={() => {
                      setShowProductField(true);
                      loadStoreProducts();
                    }}
                  >
                    <Icon n="plus" s={15} />
                    <span>{t("pages.people.specifyProductsOptional")}</span>
                  </button>
                ) : (
                  <div className={styles.formGroup}>
                    <div className={styles.labelWithAction}>
                      <label className={styles.fieldLabel}>
                        {t("pages.people.formSupplies")}
                      </label>
                      <button
                        type="button"
                        className={styles.removeFieldBtn}
                        onClick={() => {
                          setShowProductField(false);
                          setFormSupplies([]);
                        }}
                      >
                        {t("pages.people.remove")}
                      </button>
                    </div>

                    {/* Selected product chips */}
                    {formSupplies.length > 0 && (
                      <div className={styles.selectedSuppliesList}>
                        {formSupplies.map((s) => (
                          <button
                            type="button"
                            className={styles.selectedSupplyChip}
                            key={s.id}
                            onClick={() =>
                              setFormSupplies((prev) =>
                                prev.filter((item) => item.id !== s.id),
                              )
                            }
                            title={`${t("common.delete")} ${s.name}`}
                          >
                            <span className={styles.chipRemoveX}>×</span>
                            <span>{s.name}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Searchable Combobox Selector */}
                    <div className={styles.comboboxWrapper} ref={comboboxRef}>
                      <div
                        className={styles.comboboxTrigger}
                        onClick={() => {
                          setIsProductDropdownOpen((prev) => !prev);
                        }}
                      >
                        <div className={styles.comboboxRight}>
                          <Icon n="search" s={16} />
                          <input
                            type="text"
                            className={styles.comboboxInput}
                            placeholder={t("pages.people.addProductsHint")}
                            value={productSearchQuery}
                            onChange={(e) => {
                              setProductSearchQuery(e.target.value);
                              if (!isProductDropdownOpen) {
                                setIsProductDropdownOpen(true);
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onFocus={() => setIsProductDropdownOpen(true)}
                          />
                        </div>
                        <Icon
                          n="down"
                          s={16}
                          className={`${styles.comboboxArrow} ${isProductDropdownOpen ? styles.arrowOpen : ""}`}
                        />
                      </div>

                      {/* Dropdown Options List */}
                      {isProductDropdownOpen && (
                        <div className={styles.comboboxDropdown}>
                          {storeProducts.length === 0 ? (
                            <div className={styles.dropdownHint}>
                              {t("pages.people.noStoreProducts")}
                            </div>
                          ) : filteredProductOptions.length === 0 ? (
                            <div className={styles.dropdownHint}>
                              {formSupplies.length === storeProducts.length
                                ? t("pages.people.allProductsAdded")
                                : t("pages.people.noProductFound")}
                            </div>
                          ) : (
                            filteredProductOptions.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                className={styles.dropdownOption}
                                onClick={() => {
                                  setFormSupplies((prev) => [...prev, p]);
                                  setProductSearchQuery("");
                                  setIsProductDropdownOpen(false);
                                }}
                              >
                                <span>{p.name}</span>
                                <Icon n="plus" s={14} />
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Additional Notes for supplier */}
                <div className={styles.formGroup}>
                  <label className={styles.fieldLabel}>
                    {t("pages.people.additionalNotes")}
                  </label>
                  <input
                    type="text"
                    className={styles.inputField}
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                    placeholder={t("pages.people.additionalNotesPlaceholder")}
                  />
                </div>
              </>
            ) : (
              /* Customers & Payables Fields */
              <>
                <div className={styles.formGroup}>
                  <label className={styles.fieldLabel}>
                    {section === "iOwe"
                      ? t("pages.people.owedByMeOptional")
                      : t("pages.people.owedToMeOptional")}
                  </label>
                  <div className={styles.amountInputWrapper}>
                    <span className={styles.currencyBadge}>
                      {t("pages.people.currency")}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={styles.amountNumInput}
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  {editingPerson && (
                    <small className={styles.fieldHint}>
                      {(editingPerson.credit_piasters ?? 0) > 0
                        ? t("pages.people.editBalanceCreditHint", {
                            amount: formatEgp(
                              editingPerson.credit_piasters ?? 0,
                            ),
                          })
                        : t("pages.people.editBalanceHint")}
                    </small>
                  )}
                </div>

                {/* Credit products selection for owedToMe */}
                {section === "owedToMe" && (
                  <>
                    {!showProductField ? (
                      <button
                        type="button"
                        className={styles.toggleFieldBtn}
                        onClick={() => {
                          setShowProductField(true);
                          loadStoreProducts();
                        }}
                      >
                        <Icon n="plus" s={15} />
                        <span>
                          {t("pages.people.specifyCreditProductsOptional")}
                        </span>
                      </button>
                    ) : (
                      <div className={styles.formGroup}>
                        <div className={styles.labelWithAction}>
                          <label className={styles.fieldLabel}>
                            {t("pages.people.creditProducts")}
                          </label>
                          <button
                            type="button"
                            className={styles.removeFieldBtn}
                            onClick={() => {
                              setShowProductField(false);
                              setFormSupplies([]);
                            }}
                          >
                            {t("pages.people.remove")}
                          </button>
                        </div>

                        {/* Selected product chips */}
                        {formSupplies.length > 0 && (
                          <div className={styles.selectedSuppliesList}>
                            {formSupplies.map((s) => (
                              <button
                                type="button"
                                className={styles.selectedSupplyChip}
                                key={s.id}
                                onClick={() =>
                                  setFormSupplies((prev) =>
                                    prev.filter((item) => item.id !== s.id),
                                  )
                                }
                                title={`${t("common.delete")} ${s.name}`}
                              >
                                <span className={styles.chipRemoveX}>×</span>
                                <span>{s.name}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Searchable Combobox Selector */}
                        <div
                          className={styles.comboboxWrapper}
                          ref={comboboxRef}
                        >
                          <div
                            className={styles.comboboxTrigger}
                            onClick={() => {
                              setIsProductDropdownOpen((prev) => !prev);
                            }}
                          >
                            <div className={styles.comboboxRight}>
                              <Icon n="search" s={16} />
                              <input
                                type="text"
                                className={styles.comboboxInput}
                                placeholder={t(
                                  "pages.people.addCreditProductsHint",
                                )}
                                value={productSearchQuery}
                                onChange={(e) => {
                                  setProductSearchQuery(e.target.value);
                                  if (!isProductDropdownOpen) {
                                    setIsProductDropdownOpen(true);
                                  }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onFocus={() => setIsProductDropdownOpen(true)}
                              />
                            </div>
                            <Icon
                              n="down"
                              s={16}
                              className={`${styles.comboboxArrow} ${isProductDropdownOpen ? styles.arrowOpen : ""}`}
                            />
                          </div>

                          {/* Dropdown Options List */}
                          {isProductDropdownOpen && (
                            <div className={styles.comboboxDropdown}>
                              {storeProducts.length === 0 ? (
                                <div className={styles.dropdownHint}>
                                  {t("pages.people.noStoreProducts")}
                                </div>
                              ) : filteredProductOptions.length === 0 ? (
                                <div className={styles.dropdownHint}>
                                  {formSupplies.length === storeProducts.length
                                    ? t("pages.people.allProductsAdded")
                                    : t("pages.people.noProductFound")}
                                </div>
                              ) : (
                                filteredProductOptions.map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    className={styles.dropdownOption}
                                    onClick={() => {
                                      setFormSupplies((prev) => [...prev, p]);
                                      setProductSearchQuery("");
                                      setIsProductDropdownOpen(false);
                                    }}
                                  >
                                    <span>{p.name}</span>
                                    <Icon n="plus" s={14} />
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className={styles.formGroup}>
                  <label className={styles.fieldLabel}>
                    {t("pages.people.formNote")}
                  </label>
                  <input
                    type="text"
                    className={styles.inputField}
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                    placeholder={
                      section === "iOwe"
                        ? "مثلاً: سلفة / صيانة المحل"
                        : "مثلاً: حساب الشهر / سلفة"
                    }
                  />
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {debtTarget && (
        <CustomerDebtSheet
          customer={{ id: debtTarget.id, name: debtTarget.name }}
          onClose={() => setDebtTarget(null)}
          onDone={(message) => {
            setDebtTarget(null);
            toast.show({ msg: message, kind: "ok" });
            void fetchSectionData("owedToMe");
          }}
        />
      )}

      {invoicesTarget && (
        <CustomerInvoicesSheet
          customer={{ id: invoicesTarget.id, name: invoicesTarget.name }}
          onClose={() => setInvoicesTarget(null)}
          onChanged={(message) => {
            toast.show({ msg: message, kind: "ok" });
            void fetchSectionData("owedToMe");
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {purchasesTarget && (
        <PurchasesSheet
          supplierId={purchasesTarget.id}
          supplierName={purchasesTarget.name}
          onClose={() => setPurchasesTarget(null)}
          onChanged={(message) => {
            toast.show({ msg: message, kind: "ok" });
            void fetchSectionData("suppliers");
          }}
        />
      )}

      {deleteTarget && (
        <Modal
          onClose={() => !isDeleting && setDeleteTarget(null)}
          title={t("common.delete")}
          footer={
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
              >
                <span>{t("common.cancel")}</span>
              </button>

              <button
                type="button"
                className={styles.confirmDeleteBtn}
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <span>
                  {isDeleting
                    ? t("common.deleting")
                    : t("pages.people.confirmDelete")}
                </span>
              </button>
            </div>
          }
        >
          <div className={styles.confirmDialog}>
            <p className={styles.confirmMessage}>
              {t("pages.people.deleteMessage", { name: deleteTarget.name })}
            </p>
          </div>
        </Modal>
      )}

      {/* Payment / Collection Modal */}
    </div>
  );
}

export default PeopleView;
