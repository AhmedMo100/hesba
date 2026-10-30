"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
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
  note: string | null;
  supplies: SuppliedProduct[];
  created_at: string;
  updated_at: string;
}

interface StoreProductOption {
  id: string;
  name: string;
}

interface SectionState {
  people: PersonItem[];
  count: number;
  totalPiasters: number;
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

function formatEgp(piasters: number): string {
  const egp = piasters / 100;
  if (piasters % 100 !== 0) {
    return `${egp.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
  }
  return `${Math.floor(egp).toLocaleString("en-US")} ج.م`;
}

export function PeopleView() {
  const [section, setSection] = useState<PeopleSection>("owedToMe");

  // Strictly isolated state per section — zero leakage between tabs
  const [sectionsData, setSectionsData] = useState<
    Record<PeopleSection, SectionState>
  >({
    owedToMe: {
      people: [],
      count: 0,
      totalPiasters: 0,
      loaded: false,
      loading: true,
      error: null,
    },
    iOwe: {
      people: [],
      count: 0,
      totalPiasters: 0,
      loaded: false,
      loading: false,
      error: null,
    },
    suppliers: {
      people: [],
      count: 0,
      totalPiasters: 0,
      loaded: false,
      loading: false,
      error: null,
    },
  });

  // Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<PersonItem | null>(null);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<PersonItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Partial repayment / transaction recording modal
  const [repayTarget, setRepayTarget] = useState<PersonItem | null>(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [repayNote, setRepayNote] = useState("");
  const [isSubmittingRepay, setIsSubmittingRepay] = useState(false);

  // Store products for supplier modal combobox
  const [storeProducts, setStoreProducts] = useState<StoreProductOption[]>([]);

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

  // Form state for Add/Edit
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formSupplies, setFormSupplies] = useState<SuppliedProduct[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openAddModal = () => {
    setEditingPerson(null);
    setFormName("");
    setFormPhone("");
    setFormAmount("");
    setFormNote("");
    setFormSupplies([]);
    setFormError(null);
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
    setFormNote(p.note || "");
    setFormSupplies(p.supplies || []);
    setFormError(null);
    setModalOpen(true);
    if (section === "suppliers") {
      loadStoreProducts();
    }
  };

  const handleSavePerson = async () => {
    if (!formName.trim()) {
      setFormError(t("pages.people.nameRequired") || "اكتب الاسم");
      return;
    }

    const amountNum = formAmount.trim() ? parseEgpToPiasters(formAmount) : 0;
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
            note: formNote.trim() || null,
            supplies: formSupplies.map((s) => s.id),
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData?.error?.message || "فشل في حفظ التعديل");
        }
      } else {
        // POST new person explicitly scoped to the current active section
        const res = await fetch("/api/people", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            phone: formPhone.trim() || null,
            section,
            amountPiasters: amountNum,
            note: formNote.trim() || null,
            supplies: formSupplies.map((s) => s.id),
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData?.error?.message || "فشل في إضافة الشخص");
        }
      }

      setModalOpen(false);
      // Refresh strictly the affected section
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

  const handleRepay = async () => {
    if (!repayTarget) return;
    if (!repayAmount.trim()) return;

    const amountNum = parseEgpToPiasters(repayAmount);
    if (amountNum <= 0) {
      alert("المبلغ لازم يكون أكبر من صفر");
      return;
    }

    setIsSubmittingRepay(true);
    try {
      const res = await fetch(`/api/people/${repayTarget.id}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "payment",
          amountPiasters: amountNum,
          note: repayNote.trim() || null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || "فشل تسجيل العملية");
      }

      setRepayTarget(null);
      setRepayAmount("");
      setRepayNote("");
      await fetchSectionData(section);
    } catch (err: unknown) {
      alert(
        err instanceof Error ? err.message : "حدث خطأ أثناء تسجيل المعاملة",
      );
    } finally {
      setIsSubmittingRepay(false);
    }
  };

  // Available product options to add to supplier
  const availableProductOptions = useMemo(() => {
    const selectedIds = new Set(formSupplies.map((s) => s.id));
    return storeProducts.filter((p) => !selectedIds.has(p.id));
  }, [storeProducts, formSupplies]);

  // Current active section data
  const currentSectionData = sectionsData[section];
  const count = currentSectionData.count;
  const totalPiasters = currentSectionData.totalPiasters;
  const people = currentSectionData.people;
  const loading = currentSectionData.loading;
  const error = currentSectionData.error;

  // Dynamic banner title
  const bannerText = useMemo(() => {
    if (section === "owedToMe") {
      return (
        t("pages.people.summaryOwedToMe", { count }) ||
        `فلوس ليك عند ${count} شخص`
      );
    }
    if (section === "iOwe") {
      return (
        t("pages.people.summaryIOwe", { count }) || `فلوس عليك لـ ${count}`
      );
    }
    return (
      t("pages.people.summarySuppliers", { count }) ||
      `${count} مورد – المتبقي ليهم`
    );
  }, [section, count]);

  return (
    <div className={styles.container} data-testid="page-people">
      {/* Header */}
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>{t("pages.people.title") || "الناس"}</h1>
          <p className={styles.sub}>
            {t("pages.people.sub") || "اللي ليك، واللي عليك، والموردين"}
          </p>
        </div>
        <button
          type="button"
          className={styles.addBtn}
          onClick={openAddModal}
          data-testid="btn-add-person"
        >
          <Icon n="plus" s={18} />
          {t("pages.people.add") || "إضافة"}
        </button>
      </div>

      {/* Tabs */}
      <div className={styles.segWrapper}>
        <Seg<PeopleSection>
          size="big"
          value={section}
          onChange={(newSec) => setSection(newSec)}
          options={[
            ["owedToMe", t("pages.people.owedToMe") || "ليك"],
            ["iOwe", t("pages.people.iOwe") || "عليك"],
            ["suppliers", t("pages.people.suppliers") || "الموردين"],
          ]}
        />
      </div>

      {/* Summary Banner */}
      <div className={styles.summaryBanner}>
        <span className={styles.summaryText}>{bannerText}</span>
        <span className={styles.summaryAmount}>{formatEgp(totalPiasters)}</span>
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
            {t("pages.people.retry") || "إعادة المحاولة"}
          </button>
        </div>
      ) : loading && !currentSectionData.loaded ? (
        <div className={styles.loadingCard}>
          <p>جاري التحميل...</p>
        </div>
      ) : people.length === 0 ? (
        <Empty
          icon="users"
          title={t("pages.people.empty") || "القايمة فاضية"}
          action={
            <button
              type="button"
              className={styles.addBtn}
              onClick={openAddModal}
            >
              <Icon n="plus" s={18} />
              {t("pages.people.add") || "إضافة"}
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
                    <span className={styles.personName}>{p.name}</span>
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
                        {t("pages.people.noPhone") || "بدون رقم"}
                      </span>
                    )}
                  </div>

                  <div className={styles.cardActions}>
                    {p.amount_piasters > 0 && (
                      <button
                        type="button"
                        className={styles.payActionBtn}
                        onClick={() => {
                          setRepayTarget(p);
                          setRepayAmount("");
                          setRepayNote("");
                        }}
                        title={section === "owedToMe" ? "تحصيل" : "سداد"}
                      >
                        {section === "owedToMe"
                          ? t("pages.people.collect") || "تحصيل"
                          : t("pages.people.pay") || "سداد"}
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label={`تعديل ${p.name}`}
                      onClick={() => openEditModal(p)}
                    >
                      <Icon n="edit" s={16} />
                    </button>
                  </div>
                </div>

                {/* Supplier product tags */}
                {section === "suppliers" && (
                  <div className={styles.suppliesChips}>
                    {p.supplies && p.supplies.length > 0 ? (
                      p.supplies.map((s) => (
                        <span className={styles.supplyChip} key={s.id}>
                          {s.name}
                        </span>
                      ))
                    ) : (
                      <span className={styles.noSuppliesText}>
                        {t("pages.people.noSupplies") || "لسه ما اتحددش"}
                      </span>
                    )}
                  </div>
                )}

                {/* Footer row */}
                <div className={styles.cardFooter}>
                  {section === "suppliers" ? (
                    <div className={styles.amountLine}>
                      <span className={styles.amountLabel}>
                        {t("pages.people.remainingOwed") || "المتبقي له:"}
                      </span>
                      <span className={styles.amountDark}>
                        {formatEgp(p.amount_piasters)}
                      </span>
                    </div>
                  ) : (
                    <>
                      {p.note ? (
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
                    </>
                  )}
                </div>
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
                ? t("pages.people.editSupplier") || "تعديل مورد"
                : section === "iOwe"
                  ? t("pages.people.editPayable") || "تعديل التزام"
                  : t("pages.people.editCustomer") || "تعديل شخص"
              : section === "suppliers"
                ? t("pages.people.addSupplier") || "إضافة مورد"
                : section === "iOwe"
                  ? t("pages.people.addPayable") || "إضافة التزام"
                  : t("pages.people.addCustomer") || "إضافة شخص"
          }
        >
          <div className={styles.modalForm}>
            {formError && <div className={styles.formError}>{formError}</div>}

            {/* Name */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                {t("pages.people.formName") || "الاسم"}
              </label>
              <input
                type="text"
                className={styles.textInput}
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
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                {t("pages.people.formPhone") || "رقم التليفون"}
              </label>
              <input
                type="tel"
                className={styles.textInput}
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                placeholder="01012345678"
                dir="ltr"
              />
            </div>

            {/* Amount */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                {section === "suppliers"
                  ? t("pages.people.remainingOptional") ||
                    "المتبقي له (اختياري)"
                  : section === "iOwe"
                    ? t("pages.people.owedByMeOptional") ||
                      "المبلغ عليك (اختياري)"
                    : t("pages.people.owedToMeOptional") ||
                      "المبلغ ليك (اختياري)"}
              </label>
              <div className={styles.amountInputWrapper}>
                <span className={styles.currencyBadge}>ج.م</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className={styles.amountInput}
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Supplies selection for suppliers */}
            {section === "suppliers" ? (
              <div className={styles.fieldGroup}>
                <label className={styles.label}>
                  {t("pages.people.formSupplies") || "بيورّدلك إيه؟"}
                </label>
                {formSupplies.length > 0 && (
                  <div className={styles.suppliesChipsEdit}>
                    {formSupplies.map((s) => (
                      <span className={styles.supplyChipEdit} key={s.id}>
                        {s.name}
                        <button
                          type="button"
                          className={styles.removeChipBtn}
                          onClick={() =>
                            setFormSupplies((prev) =>
                              prev.filter((item) => item.id !== s.id),
                            )
                          }
                          aria-label={`إزالة ${s.name}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {availableProductOptions.length > 0 ? (
                  <select
                    className={styles.productSelect}
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      const prod = storeProducts.find((p) => p.id === id);
                      if (prod) {
                        setFormSupplies((prev) => [...prev, prod]);
                      }
                    }}
                  >
                    <option value="">
                      {t("pages.people.selectProduct") || "+ ضيف منتج..."}
                    </option>
                    {availableProductOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className={styles.hintText}>
                    {storeProducts.length === 0
                      ? t("pages.people.noStoreProducts") ||
                        "لا توجد منتجات مسجلة في المحل حالياً"
                      : t("pages.people.allProductsAdded") ||
                        "تمت إضافة جميع المنتجات"}
                  </p>
                )}
              </div>
            ) : (
              /* Note for customers & payables */
              <div className={styles.fieldGroup}>
                <label className={styles.label}>
                  {t("pages.people.formNote") || "ملاحظة (اختياري)"}
                </label>
                <input
                  type="text"
                  className={styles.textInput}
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  placeholder={
                    section === "iOwe"
                      ? "مثلاً: سلفة للمحل / صيانة"
                      : "مثلاً: حساب الشهر / سلفة"
                  }
                />
              </div>
            )}

            {/* Modal Actions matching screenshot */}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleSavePerson}
                disabled={isSubmitting}
              >
                <Icon n="check" s={16} />
                {editingPerson
                  ? t("common.save") || "حفظ"
                  : t("common.save") || "حفظ"}
              </button>

              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setModalOpen(false)}
                disabled={isSubmitting}
              >
                {t("common.cancel") || "إلغاء"}
              </button>

              {editingPerson && (
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={() => setDeleteTarget(editingPerson)}
                  disabled={isSubmitting}
                >
                  <Icon n="trash" s={15} />
                  {t("common.delete") || "حذف"}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal matching screenshot */}
      {deleteTarget && (
        <Modal
          onClose={() => !isDeleting && setDeleteTarget(null)}
          title={t("common.delete") || "حذف"}
        >
          <div className={styles.deleteConfirmDialog}>
            <p className={styles.deleteConfirmMessage}>
              {t("pages.people.deleteMessage", { name: deleteTarget.name }) ||
                `هتحذف "${deleteTarget.name}" من القايمة.`}
            </p>
            <div className={styles.deleteConfirmActions}>
              <button
                type="button"
                className={styles.confirmDeleteBtn}
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting
                  ? t("common.deleting") || "جاري الحذف..."
                  : t("common.delete") || "احذف"}
              </button>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
              >
                {t("common.cancel") || "إلغاء"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Repay / Settle Modal */}
      {repayTarget && (
        <Modal
          onClose={() => !isSubmittingRepay && setRepayTarget(null)}
          title={
            section === "owedToMe"
              ? t("pages.people.collectFrom", { name: repayTarget.name }) ||
                `تحصيل من ${repayTarget.name}`
              : t("pages.people.payTo", { name: repayTarget.name }) ||
                `سداد لـ ${repayTarget.name}`
          }
        >
          <div className={styles.modalForm}>
            <p className={styles.repayHint}>
              {t("pages.people.currentBalance") || "الرصيد الحالي:"}{" "}
              <strong>{formatEgp(repayTarget.amount_piasters)}</strong>
            </p>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                {t("pages.people.amountPaid") || "المبلغ المدفوع"}
              </label>
              <div className={styles.amountInputWrapper}>
                <span className={styles.currencyBadge}>ج.م</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className={styles.amountInput}
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(e.target.value)}
                  placeholder="0"
                  autoFocus
                />
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                {t("pages.people.formNote") || "ملاحظة (اختياري)"}
              </label>
              <input
                type="text"
                className={styles.textInput}
                value={repayNote}
                onChange={(e) => setRepayNote(e.target.value)}
                placeholder="سداد دفعة / تحصيل كاش"
              />
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleRepay}
                disabled={isSubmittingRepay}
              >
                <Icon n="check" s={16} />
                {t("common.confirm") || "تأكيد"}
              </button>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setRepayTarget(null)}
                disabled={isSubmittingRepay}
              >
                {t("common.cancel") || "إلغاء"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default PeopleView;
