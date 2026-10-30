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

  // Progressive disclosure states in form
  const [showAmountField, setShowAmountField] = useState(false);
  const [showProductField, setShowProductField] = useState(false);

  // Product combobox dropdown state
  const [storeProducts, setStoreProducts] = useState<StoreProductOption[]>([]);
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const comboboxRef = useRef<HTMLDivElement>(null);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<PersonItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form input state
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formNote, setFormNote] = useState("");
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
    setFormSupplies([]);
    setFormError(null);
    setShowAmountField(false);
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
    setFormNote(p.note || "");
    setFormSupplies(p.supplies || []);
    setFormError(null);
    setShowAmountField(p.amount_piasters > 0);
    setShowProductField((p.supplies || []).length > 0);
    setIsProductDropdownOpen(false);
    setProductSearchQuery("");
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

    const amountNum =
      showAmountField || section !== "suppliers"
        ? formAmount.trim()
          ? parseEgpToPiasters(formAmount)
          : 0
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
            note: formNote.trim() || null,
            supplies: showProductField ? formSupplies.map((s) => s.id) : [],
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
            note: formNote.trim() || null,
            supplies: showProductField ? formSupplies.map((s) => s.id) : [],
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
  const count = currentSectionData.count;
  const totalPiasters = currentSectionData.totalPiasters;
  const people = currentSectionData.people;
  const loading = currentSectionData.loading;
  const error = currentSectionData.error;

  // Dynamic banner title matching screenshots
  const bannerText = useMemo(() => {
    if (section === "owedToMe") {
      return `فلوس ليك عند ${count} شخص`;
    }
    if (section === "iOwe") {
      return `فلوس عليك ل ${count}`;
    }
    return `${count} مورد – المتبقي ليهم`;
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

                  <button
                    type="button"
                    className={styles.editBtn}
                    aria-label={`تعديل ${p.name}`}
                    onClick={() => openEditModal(p)}
                  >
                    <Icon n="edit" s={16} />
                  </button>
                </div>

                {/* Supplier product tags chips matching screenshot */}
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

                {/* Footer row */}
                <div className={styles.cardFooter}>
                  {section === "suppliers" ? (
                    <>
                      <span className={styles.amountLabel}>
                        {t("pages.people.remainingOwed") || "المتبقي له:"}
                      </span>
                      <span className={styles.amountDark}>
                        {formatEgp(p.amount_piasters)}
                      </span>
                    </>
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

      {/* Add / Edit Modal matching screenshot */}
      {modalOpen && (
        <Modal
          onClose={() => !isSubmitting && setModalOpen(false)}
          title={
            editingPerson
              ? section === "suppliers"
                ? "تعديل مورد"
                : section === "iOwe"
                  ? "تعديل التزام"
                  : "تعديل شخص"
              : section === "suppliers"
                ? "إضافة مورد"
                : section === "iOwe"
                  ? "إضافة التزام"
                  : "إضافة شخص"
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
                  <span>{t("common.delete") || "حذف"}</span>
                </button>
              )}

              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setModalOpen(false)}
                disabled={isSubmitting}
              >
                <span>{t("common.cancel") || "إلغاء"}</span>
              </button>

              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleSavePerson}
                disabled={isSubmitting}
              >
                <Icon n="check" s={18} />
                <span>
                  {isSubmitting ? "جاري الحفظ..." : t("common.save") || "حفظ"}
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
                {t("pages.people.formName") || "الاسم"}
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
                {t("pages.people.formPhone") || "رقم التليفون"}
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

            {/* Supplier Form Specific: Amount with Progressive Disclosure */}
            {section === "suppliers" ? (
              <>
                {!showAmountField ? (
                  <button
                    type="button"
                    className={styles.toggleFieldBtn}
                    onClick={() => setShowAmountField(true)}
                  >
                    <Icon n="plus" s={15} />
                    <span>إضافة مبلغ مستحق (اختياري)</span>
                  </button>
                ) : (
                  <div className={styles.formGroup}>
                    <div className={styles.labelWithAction}>
                      <label className={styles.fieldLabel}>
                        {t("pages.people.remainingOptional") ||
                          "المتبقي له (اختياري)"}
                      </label>
                      <button
                        type="button"
                        className={styles.removeFieldBtn}
                        onClick={() => {
                          setShowAmountField(false);
                          setFormAmount("");
                        }}
                      >
                        إزالة
                      </button>
                    </div>
                    <div className={styles.amountInputWrapper}>
                      <span className={styles.currencyBadge}>ج.م</span>
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
                )}

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
                    <span>تحديد المنتجات اللي بيوردها (اختياري)</span>
                  </button>
                ) : (
                  <div className={styles.formGroup}>
                    <div className={styles.labelWithAction}>
                      <label className={styles.fieldLabel}>
                        {t("pages.people.formSupplies") || "بيورّدلك إيه؟"}
                      </label>
                      <button
                        type="button"
                        className={styles.removeFieldBtn}
                        onClick={() => {
                          setShowProductField(false);
                          setFormSupplies([]);
                        }}
                      >
                        إزالة
                      </button>
                    </div>

                    {/* Selected product chips matching screenshot */}
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
                            title={`إزالة ${s.name}`}
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
                            placeholder="ضف منتج..."
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
                              لا توجد منتجات مسجلة في المحل حالياً
                            </div>
                          ) : filteredProductOptions.length === 0 ? (
                            <div className={styles.dropdownHint}>
                              {formSupplies.length === storeProducts.length
                                ? "تمت إضافة جميع المنتجات"
                                : "مفيش منتج بالاسم ده"}
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

                {/* Notes for supplier */}
                <div className={styles.formGroup}>
                  <label className={styles.fieldLabel}>
                    {t("pages.people.formNote") || "ملاحظات (اختياري)"}
                  </label>
                  <input
                    type="text"
                    className={styles.inputField}
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                    placeholder="مثلاً: بيمر كل يوم ثلاثاء"
                  />
                </div>
              </>
            ) : (
              /* Customers & Payables Fields */
              <>
                <div className={styles.formGroup}>
                  <label className={styles.fieldLabel}>
                    {section === "iOwe"
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
                      className={styles.amountNumInput}
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.fieldLabel}>
                    {t("pages.people.formNote") || "ملاحظة (اختياري)"}
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

      {/* Delete Confirmation Modal matching screenshot */}
      {deleteTarget && (
        <Modal
          onClose={() => !isDeleting && setDeleteTarget(null)}
          title={t("common.delete") || "حذف"}
          footer={
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
              >
                <span>{t("common.cancel") || "إلغاء"}</span>
              </button>

              <button
                type="button"
                className={styles.confirmDeleteBtn}
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <span>
                  {isDeleting
                    ? t("common.deleting") || "جاري الحذف..."
                    : t("common.delete") || "احذف"}
                </span>
              </button>
            </div>
          }
        >
          <div className={styles.confirmDialog}>
            <p className={styles.confirmMessage}>
              هتحذف &quot;{deleteTarget.name}&quot; من القايمة.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default PeopleView;
