"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import styles from "./PeopleView.module.css";
import { Icon, Seg, Empty, Modal } from "../../shared/ui";
import { t } from "../../shared/i18n";
import { type PeopleSection } from "@/schemas/people";

interface SuppliedProduct {
  id: string;
  name: string;
}

interface PersonItem {
  id: string;
  store_id: string;
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

function formatEgp(piasters: number): string {
  const egp = Math.floor(piasters / 100);
  return `${egp.toLocaleString("en-US")} ج.م`;
}

export function PeopleView() {
  const [section, setSection] = useState<PeopleSection>("owedToMe");
  const [people, setPeople] = useState<PersonItem[]>([]);
  const [count, setCount] = useState(0);
  const [totalPiasters, setTotalPiasters] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Reload people list
  const reloadPeople = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/people?section=${section}`);
      if (!res.ok) {
        throw new Error(t("pages.people.loadError") || "تعذر تحميل البيانات");
      }
      const data = await res.json();
      setPeople(data.people || []);
      setCount(data.count || 0);
      setTotalPiasters(data.total_piasters || 0);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : t("pages.people.loadError") || "تعذر تحميل البيانات",
      );
    } finally {
      setLoading(false);
    }
  }, [section]);

  useEffect(() => {
    let ignore = false;

    fetch(`/api/people?section=${section}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(t("pages.people.loadError") || "تعذر تحميل البيانات");
        }
        return res.json();
      })
      .then((data) => {
        if (!ignore) {
          setPeople(data.people || []);
          setCount(data.count || 0);
          setTotalPiasters(data.total_piasters || 0);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setError(
            err instanceof Error
              ? err.message
              : t("pages.people.loadError") || "تعذر تحميل البيانات",
          );
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [section]);

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
    setFormAmount(
      p.amount_piasters > 0 ? String(Math.floor(p.amount_piasters / 100)) : "",
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

    const amountNum = formAmount.trim()
      ? Math.floor(Number(formAmount) * 100)
      : 0;
    if (Number.isNaN(amountNum) || amountNum < 0) {
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
        // POST new
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
      await reloadPeople();
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
      await reloadPeople();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "حدث خطأ أثناء الحذف");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRecordRepayment = async () => {
    if (!repayTarget) return;
    const amountVal = Math.floor(Number(repayAmount) * 100);
    if (!amountVal || amountVal <= 0) {
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
          amountPiasters: amountVal,
          note: repayNote.trim() || null,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || "فشل في تسجيل المعاملة");
      }

      setRepayTarget(null);
      setRepayAmount("");
      setRepayNote("");
      await reloadPeople();
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
            onClick={() => reloadPeople()}
          >
            <Icon n="refresh" s={16} />
            {t("pages.people.retry") || "إعادة المحاولة"}
          </button>
        </div>
      ) : loading && people.length === 0 ? (
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
                    <>
                      <div className={styles.amountLine}>
                        <span className={styles.amountLabel}>
                          {t("pages.people.remainingOwed") || "المتبقي له:"}
                        </span>
                        <span className={styles.amountDark}>
                          {formatEgp(p.amount_piasters)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <span
                        className={
                          section === "owedToMe"
                            ? styles.amountPos
                            : styles.amountNeg
                        }
                      >
                        {formatEgp(p.amount_piasters)}
                      </span>
                      {p.note && (
                        <span className={styles.noteText} title={p.note}>
                          {p.note}
                        </span>
                      )}
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
          title={
            editingPerson
              ? section === "owedToMe"
                ? t("pages.people.editOwedToMe") || "تعديل حد عليه فلوس ليك"
                : section === "iOwe"
                  ? t("pages.people.editIOwe") || "تعديل حد ليه فلوس عندك"
                  : t("pages.people.editSupplier") || "تعديل مورد"
              : section === "owedToMe"
                ? t("pages.people.addOwedToMe") || "إضافة حد عليه فلوس ليك"
                : section === "iOwe"
                  ? t("pages.people.addIOwe") || "إضافة حد ليه فلوس عندك"
                  : t("pages.people.addSupplier") || "إضافة مورد"
          }
          onClose={() => setModalOpen(false)}
          footer={
            <div className={styles.modalFooter}>
              {editingPerson && (
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={() => setDeleteTarget(editingPerson)}
                  disabled={isSubmitting}
                >
                  <Icon n="trash" s={15} />
                  {t("pages.people.delete") || "حذف"}
                </button>
              )}
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setModalOpen(false)}
                disabled={isSubmitting}
              >
                {t("pages.people.cancel") || "إلغاء"}
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleSavePerson}
                disabled={isSubmitting}
              >
                <Icon n="check" s={16} />
                {isSubmitting
                  ? t("pages.people.saving") || "جاري الحفظ..."
                  : t("pages.people.save") || "حفظ"}
              </button>
            </div>
          }
        >
          {formError && (
            <div className={styles.errorCard} style={{ marginBottom: 12 }}>
              <p className={styles.errorTitle}>{formError}</p>
            </div>
          )}

          {/* Name Field */}
          <div className={styles.formGroup}>
            <label className={styles.fieldLabel}>
              {t("pages.people.name") || "الاسم"}
            </label>
            <input
              type="text"
              className={styles.inputField}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={section === "suppliers" ? "شركة النور" : "أبو خالد"}
              autoFocus
            />
          </div>

          {/* Phone Field */}
          <div className={styles.formGroup}>
            <label className={styles.fieldLabel}>
              {t("pages.people.phone") || "رقم التليفون"}
            </label>
            <input
              type="tel"
              dir="ltr"
              style={{ textAlign: "right" }}
              className={styles.inputField}
              value={formPhone}
              onChange={(e) => setFormPhone(e.target.value)}
              placeholder="01xxxxxxxxx"
            />
          </div>

          {/* Amount Field */}
          <div className={styles.formGroup}>
            <label className={styles.fieldLabel}>
              {section === "suppliers"
                ? t("pages.people.owedOptional") || "المتبقي له (اختياري)"
                : t("pages.people.amount") || "المبلغ"}
            </label>
            <div className={styles.amountInputWrapper}>
              <span className={styles.currencyBadge}>ج.م</span>
              <input
                type="number"
                min="0"
                step="1"
                className={styles.amountNumInput}
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {/* Note Field (for non-suppliers) */}
          {section !== "suppliers" && (
            <div className={styles.formGroup}>
              <label className={styles.fieldLabel}>
                {t("pages.people.note") || "ملاحظة"}
              </label>
              <input
                type="text"
                className={styles.inputField}
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                placeholder="حساب الشهر / سلفة..."
              />
            </div>
          )}

          {/* Supplies Section (for suppliers) */}
          {section === "suppliers" && (
            <div className={styles.formGroup}>
              <label className={styles.fieldLabel}>
                {t("pages.people.supplies") || "بيورّدلك إيه؟"}
              </label>

              {/* Selected chips */}
              <div className={styles.selectedSuppliesList}>
                {formSupplies.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={styles.selectedSupplyChip}
                    onClick={() =>
                      setFormSupplies(
                        formSupplies.filter((item) => item.id !== s.id),
                      )
                    }
                    title="اضغط للحذف"
                  >
                    <span>×</span>
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>

              {/* Product selector dropdown */}
              <div className={styles.productSelectWrapper}>
                <select
                  className={styles.productSelect}
                  value=""
                  onChange={(e) => {
                    const selectedId = e.target.value;
                    if (!selectedId) return;
                    const found = storeProducts.find(
                      (p) => p.id === selectedId,
                    );
                    if (found) {
                      setFormSupplies((prev) => [
                        ...prev,
                        { id: found.id, name: found.name },
                      ]);
                    }
                  }}
                >
                  <option value="">
                    {t("pages.people.addProduct") || "ضِف منتج..."}
                  </option>
                  {availableProductOptions.map((prod) => (
                    <option key={prod.id} value={prod.id}>
                      {prod.name}
                    </option>
                  ))}
                </select>
                <div className={styles.productSelectIcon}>
                  <Icon n="down" s={14} />
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <Modal
          title={t("pages.people.delete") || "حذف"}
          onClose={() => setDeleteTarget(null)}
          footer={
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
              >
                {t("pages.people.cancel") || "إلغاء"}
              </button>
              <button
                type="button"
                className={styles.confirmDeleteBtn}
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting
                  ? "جاري الحذف..."
                  : t("pages.people.confirmDelete") || "احذف"}
              </button>
            </div>
          }
        >
          <p className={styles.confirmMessage}>
            {t("pages.people.deletePrompt", { name: deleteTarget.name }) ||
              `هتحذف "${deleteTarget.name}" من القايمة.`}
          </p>
        </Modal>
      )}

      {/* Repayment / Collection Modal */}
      {repayTarget && (
        <Modal
          title={
            section === "owedToMe"
              ? `تحصيل من "${repayTarget.name}"`
              : `سداد إلى "${repayTarget.name}"`
          }
          onClose={() => setRepayTarget(null)}
          footer={
            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setRepayTarget(null)}
                disabled={isSubmittingRepay}
              >
                {t("pages.people.cancel") || "إلغاء"}
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleRecordRepayment}
                disabled={isSubmittingRepay}
              >
                <Icon n="check" s={16} />
                {isSubmittingRepay ? "جاري التسجيل..." : "سجّل المعاملة"}
              </button>
            </div>
          }
        >
          <div className={styles.formGroup}>
            <label className={styles.fieldLabel}>
              {section === "owedToMe" ? "المبلغ المحصّل" : "المبلغ المدفوع"}
            </label>
            <div className={styles.amountInputWrapper}>
              <span className={styles.currencyBadge}>ج.م</span>
              <input
                type="number"
                min="1"
                step="1"
                className={styles.amountNumInput}
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
                placeholder="0"
                autoFocus
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.fieldLabel}>
              {t("pages.people.note") || "ملاحظة"}
            </label>
            <input
              type="text"
              className={styles.inputField}
              value={repayNote}
              onChange={(e) => setRepayNote(e.target.value)}
              placeholder="دفعة نقدية / سداد..."
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

export default PeopleView;
