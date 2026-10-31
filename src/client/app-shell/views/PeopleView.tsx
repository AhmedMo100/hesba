"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import styles from "./PeopleView.module.css";
import { Icon, Seg, Empty, Modal } from "../../shared/ui";
import { t } from "../../shared/i18n";
import { type PeopleSection } from "@/schemas/people";
import { parseEgpToPiasters } from "@/domain/money";

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
  amount_piasters: number;
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

interface PaymentModalState {
  person: PersonItem;
  isCollection: boolean;
}

function formatEgp(piasters: number): string {
  const egp = (piasters || 0) / 100;
  if (piasters % 100 !== 0) {
    return `${egp.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
  }
  return `${Math.floor(egp).toLocaleString("en-US")} ج.م`;
}

function parseCustomerNotes(note: string | null): {
  products: string[];
  generalNote: string;
} {
  if (!note) return { products: [], generalNote: "" };
  const lines = note.split("\n");
  const products: string[] = [];
  const remaining: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("الأصناف:") || trimmed.startsWith("المنتجات:")) {
      const items = trimmed
        .replace(/^(الأصناف|المنتجات):\s*/, "")
        .split(/[،,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      products.push(...items);
    } else if (trimmed) {
      remaining.push(trimmed);
    }
  }

  return {
    products,
    generalNote: remaining.join("\n"),
  };
}

function serializeCustomerNotes(
  products: string[],
  generalNote: string,
): string | null {
  const lines: string[] = [];
  if (products.length > 0) {
    lines.push(`المنتجات: ${products.join("، ")}`);
  }
  if (generalNote.trim()) {
    lines.push(generalNote.trim());
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function parseSupplierNotes(note: string | null): {
  owedMoneyNote: string;
  productsNote: string;
  generalNote: string;
} {
  if (!note) {
    return { owedMoneyNote: "", productsNote: "", generalNote: "" };
  }
  const lines = note.split("\n");
  let owedMoneyNote = "";
  let productsNote = "";
  const remainingLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("عليك ليهم فلوس:") ||
      trimmed.startsWith("فلوس ليهم:")
    ) {
      owedMoneyNote = trimmed
        .replace(/^(عليك ليهم فلوس|فلوس ليهم):\s*/, "")
        .trim();
    } else if (
      trimmed.startsWith("ليك عندهم منتجات:") ||
      trimmed.startsWith("منتجات عندهم:")
    ) {
      productsNote = trimmed
        .replace(/^(ليك عندهم منتجات|منتجات عندهم):\s*/, "")
        .trim();
    } else if (trimmed) {
      remainingLines.push(trimmed);
    }
  }

  return {
    owedMoneyNote,
    productsNote,
    generalNote: remainingLines.join("\n"),
  };
}

function serializeSupplierNotes(parts: {
  owedMoneyNote?: string;
  productsNote?: string;
  generalNote?: string;
}): string | null {
  const lines: string[] = [];
  if (parts.owedMoneyNote?.trim()) {
    lines.push(`عليك ليهم فلوس: ${parts.owedMoneyNote.trim()}`);
  }
  if (parts.productsNote?.trim()) {
    lines.push(`ليك عندهم منتجات: ${parts.productsNote.trim()}`);
  }
  if (parts.generalNote?.trim()) {
    lines.push(parts.generalNote.trim());
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

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
  const [isDeleting, setIsDeleting] = useState(false);

  // Payment / Collection Modal state
  const [paymentTarget, setPaymentTarget] = useState<PaymentModalState | null>(
    null,
  );
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [paymentNote, setPaymentNote] = useState("");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Form input state
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formAmount, setFormAmount] = useState("");
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
      const res = await fetch(`/api/people?section=${targetSection}`);
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
      const res = await fetch("/api/products");
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
    setFormAmount(
      p.amount_piasters > 0
        ? p.amount_piasters % 100 === 0
          ? String(egpVal)
          : egpVal.toFixed(2)
        : "",
    );
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

  const openPaymentModal = (person: PersonItem) => {
    setPaymentTarget({
      person,
      isCollection: section === "owedToMe",
    });
    const egpVal = person.amount_piasters / 100;
    setPaymentAmount(
      person.amount_piasters > 0
        ? person.amount_piasters % 100 === 0
          ? String(egpVal)
          : egpVal.toFixed(2)
        : "",
    );
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentNote("");
    setPaymentError(null);
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

    const amountNum = isSupplier
      ? editingPerson?.amount_piasters || 0
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
            amountPiasters: amountNum,
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

  const handleRecordPayment = async () => {
    if (!paymentTarget) return;
    if (!paymentAmount.trim()) {
      setPaymentError("اكتب المبلغ");
      return;
    }

    const amountNum = parseEgpToPiasters(paymentAmount);
    if (amountNum <= 0) {
      setPaymentError("المبلغ لازم يكون أكبر من صفر");
      return;
    }

    setIsSubmittingPayment(true);
    setPaymentError(null);

    try {
      const res = await fetch(
        `/api/people/${paymentTarget.person.id}/transactions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "payment",
            amountPiasters: amountNum,
            note: paymentNote.trim() || null,
            date: paymentDate ? new Date(paymentDate).toISOString() : undefined,
          }),
        },
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || "فشل تسجيل العملية");
      }

      setPaymentTarget(null);

      // Refresh section data
      await fetchSectionData(section);
    } catch (err: unknown) {
      setPaymentError(
        err instanceof Error ? err.message : "حدث خطأ أثناء تسجيل المعاملة",
      );
    } finally {
      setIsSubmittingPayment(false);
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
      {/* Header */}
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>{t("pages.people.title")}</h1>
          <p className={styles.sub}>{t("pages.people.sub")}</p>
        </div>
        <button
          type="button"
          className={styles.addBtn}
          onClick={openAddModal}
          data-testid="btn-add-person"
        >
          <Icon n="plus" s={18} />
          <span>{t("pages.people.add")}</span>
        </button>
      </div>

      {/* Tabs */}
      <div className={styles.segWrapper}>
        <Seg<PeopleSection>
          size="big"
          value={section}
          onChange={(newSec) => setSection(newSec)}
          options={[
            ["owedToMe", t("pages.people.owedToMe")],
            ["iOwe", t("pages.people.iOwe")],
            ["suppliers", t("pages.people.suppliers")],
          ]}
        />
      </div>

      {/* Summary Banner */}
      <div className={styles.summaryBanner}>
        <span className={styles.summaryText}>
          {section === "owedToMe"
            ? t("pages.people.summaryOwedToMe", {
                count: currentSectionData.count,
              })
            : section === "iOwe"
              ? t("pages.people.summaryIOwe", {
                  count: currentSectionData.count,
                })
              : t("pages.people.suppliersCountTitle")}
        </span>
        <span className={styles.summaryAmount}>
          {section === "suppliers"
            ? t("pages.people.suppliersCount", {
                count: currentSectionData.count,
              })
            : formatEgp(currentSectionData.totalPiasters)}
        </span>
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
        <div className={styles.loadingCard}>
          <p>{t("common.loading")}</p>
        </div>
      ) : people.length === 0 ? (
        <Empty
          icon="users"
          title={t("pages.people.empty")}
          action={
            <button
              type="button"
              className={styles.addBtn}
              onClick={openAddModal}
            >
              <Icon n="plus" s={18} />
              <span>{t("pages.people.add")}</span>
            </button>
          }
        />
      ) : (
        <div className={styles.cardsGrid}>
          {people.map((p) => {
            return (
              <div
                className={styles.personCard}
                key={p.id}
                data-testid={`person-card-${p.id}`}
              >
                {/* Header row */}
                <div className={styles.cardHeader}>
                  <div className={styles.personMeta}>
                    <div className={styles.nameRow}>
                      <span className={styles.personName}>{p.name}</span>
                      {p.is_settled && (
                        <span className={styles.settledBadge}>
                          {section === "owedToMe"
                            ? "تم التحصيل ✓"
                            : "تم السداد ✓"}
                        </span>
                      )}
                    </div>
                    {p.phone ? (
                      <a
                        className={styles.personPhone}
                        href={`tel:${p.phone}`}
                        dir="ltr"
                      >
                        <Icon n="phone" s={13} />
                        <span>{p.phone}</span>
                      </a>
                    ) : (
                      <span className={styles.noPhone}>
                        {t("pages.people.noPhone")}
                      </span>
                    )}
                  </div>

                  {/* Card quick actions */}
                  <div className={styles.cardActionsGroup}>
                    {/* Collection / Payment quick button */}
                    {p.amount_piasters > 0 && (
                      <button
                        type="button"
                        className={
                          section === "owedToMe"
                            ? styles.collectBtn
                            : styles.payBtn
                        }
                        onClick={() => openPaymentModal(p)}
                        title={
                          section === "owedToMe"
                            ? t("pages.people.collect")
                            : t("pages.people.pay")
                        }
                      >
                        <span>
                          {section === "owedToMe"
                            ? t("pages.people.collect")
                            : t("pages.people.pay")}
                        </span>
                      </button>
                    )}

                    {/* WhatsApp quick contact */}
                    {p.phone && (
                      <a
                        href={`https://wa.me/20${p.phone.replace(/^(\+?20|0)/, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.cardWaBtn}
                        title={t("pages.people.waChat")}
                        aria-label={`${t("pages.people.waChat")} ${p.name}`}
                      >
                        <svg
                          width={15}
                          height={15}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                      </a>
                    )}

                    {/* Edit button */}
                    <button
                      type="button"
                      className={styles.editBtn}
                      aria-label={`${t("common.edit")} ${p.name}`}
                      onClick={() => openEditModal(p)}
                      title={t("common.edit")}
                    >
                      <Icon n="edit" s={15} />
                    </button>

                    {/* Delete button right next to edit */}
                    <button
                      type="button"
                      className={styles.cardDeleteBtn}
                      aria-label={`${t("common.delete")} ${p.name}`}
                      onClick={() => setDeleteTarget(p)}
                      title={t("common.delete")}
                    >
                      <Icon n="trash" s={15} />
                    </button>
                  </div>
                </div>

                {/* Supplier product tags chips */}
                {section === "suppliers" &&
                  p.supplies &&
                  p.supplies.length > 0 && (
                    <div className={styles.suppliesChips}>
                      {p.supplies.map((s) => (
                        <span className={styles.supplyChip} key={s.id}>
                          {s.name}
                        </span>
                      ))}
                    </div>
                  )}

                {/* Customer credit products chips in 'owedToMe' */}
                {section === "owedToMe" &&
                  (() => {
                    const parsedCust = parseCustomerNotes(p.note);
                    if (parsedCust.products.length === 0) return null;
                    return (
                      <div className={styles.suppliesChips}>
                        {parsedCust.products.map((prodName, idx) => (
                          <span className={styles.creditProductChip} key={idx}>
                            <Icon n="box" s={12} />
                            <span>{prodName}</span>
                          </span>
                        ))}
                      </div>
                    );
                  })()}

                {/* Footer / Notes row */}
                {section === "suppliers" ? (
                  (() => {
                    const parsed = parseSupplierNotes(p.note);
                    return (
                      <div className={styles.supplierNotesBlock}>
                        {parsed.owedMoneyNote && (
                          <div className={styles.supplierNoteRow}>
                            <span className={styles.supplierNoteLabel}>
                              {t("pages.people.supplierOwedLabel")}
                            </span>
                            <span className={styles.supplierNoteValOwed}>
                              {parsed.owedMoneyNote}
                            </span>
                          </div>
                        )}
                        {parsed.productsNote && (
                          <div className={styles.supplierNoteRow}>
                            <span className={styles.supplierNoteLabel}>
                              {t("pages.people.supplierProductsLabel")}
                            </span>
                            <span className={styles.supplierNoteValProducts}>
                              {parsed.productsNote}
                            </span>
                          </div>
                        )}
                        {parsed.generalNote && (
                          <span
                            className={styles.noteText}
                            title={parsed.generalNote}
                          >
                            {parsed.generalNote}
                          </span>
                        )}
                        {p.amount_piasters > 0 && !parsed.owedMoneyNote && (
                          <div className={styles.cardFooter}>
                            <span className={styles.amountLabel}>
                              {t("pages.people.remainingOwed")}
                            </span>
                            <span className={styles.amountDark}>
                              {formatEgp(p.amount_piasters)}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className={styles.cardFooter}>
                    {section === "owedToMe" ? (
                      (() => {
                        const custNote = parseCustomerNotes(p.note).generalNote;
                        return custNote ? (
                          <span className={styles.noteText} title={custNote}>
                            {custNote}
                          </span>
                        ) : (
                          <span />
                        );
                      })()
                    ) : p.note ? (
                      <span className={styles.noteText} title={p.note}>
                        {p.note}
                      </span>
                    ) : (
                      <span />
                    )}
                    <span
                      className={
                        section === "owedToMe"
                          ? styles.amountPos
                          : styles.amountNeg
                      }
                    >
                      {formatEgp(p.amount_piasters)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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

      {/* Delete Confirmation Modal */}
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
      {paymentTarget && (
        <Modal
          onClose={() => !isSubmittingPayment && setPaymentTarget(null)}
          title={
            paymentTarget.isCollection
              ? t("pages.people.collectFrom", {
                  name: paymentTarget.person.name,
                })
              : t("pages.people.payTo", { name: paymentTarget.person.name })
          }
          footer={
            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setPaymentTarget(null)}
                disabled={isSubmittingPayment}
              >
                <span>{t("common.cancel")}</span>
              </button>

              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleRecordPayment}
                disabled={isSubmittingPayment}
              >
                <Icon n="check" s={18} />
                <span>
                  {isSubmittingPayment
                    ? t("common.saving")
                    : paymentTarget.isCollection
                      ? t("pages.people.confirmCollection")
                      : t("pages.people.confirmPayment")}
                </span>
              </button>
            </div>
          }
        >
          <div className={styles.modalForm}>
            {paymentError && (
              <div className={styles.formError}>{paymentError}</div>
            )}

            <div className={styles.currentBalanceBanner}>
              <span className={styles.currentBalanceLabel}>
                {t("pages.people.currentBalance")}
              </span>
              <span className={styles.currentBalanceValue}>
                {formatEgp(paymentTarget.person.amount_piasters)}
              </span>
            </div>

            {/* Amount */}
            <div className={styles.formGroup}>
              <label className={styles.fieldLabel}>
                {paymentTarget.isCollection
                  ? t("pages.people.amountCollected")
                  : t("pages.people.amountPaid")}
              </label>
              <div className={styles.amountInputWrapper}>
                <span className={styles.currencyBadge}>
                  {t("pages.people.currency")}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  className={styles.amountNumInput}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="0"
                  autoFocus
                />
              </div>
            </div>

            {/* Date */}
            <div className={styles.formGroup}>
              <label className={styles.fieldLabel}>
                {t("pages.people.date")}
              </label>
              <input
                type="date"
                className={styles.inputField}
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>

            {/* Note */}
            <div className={styles.formGroup}>
              <label className={styles.fieldLabel}>
                {t("pages.people.formNote")}
              </label>
              <input
                type="text"
                className={styles.inputField}
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                placeholder="دفعة نقدية / تحصيل كاش"
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default PeopleView;
