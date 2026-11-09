"use client";

/**
 * @file IngredientPicker.tsx
 * @description Searchable product picker for one sandwich recipe row. Common sandwich
 * ingredients (cheese/luncheon, then chips, then ketchup/mayonnaise) are listed first; typing
 * filters by Arabic or English name (`searchIngredientOptions`). Products already used in
 * another row are shown but cannot be picked twice.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/client/shared/ui";
import { t } from "@/client/shared/i18n";
import type { SandwichIngredientOption } from "@/client/shared/api/sandwiches";
import { recipeUnitLabel, searchIngredientOptions } from "./sandwich-form";
import styles from "./SandwichFormModal.module.css";

interface IngredientPickerProps {
  options: readonly SandwichIngredientOption[];
  value: string;
  /** Variants already chosen in other rows. */
  takenIds: ReadonlySet<string>;
  onChange: (variantId: string) => void;
  testId: string;
  /** Opens the list immediately (a freshly added, empty row). */
  defaultOpen?: boolean;
}

function stockLabel(option: SandwichIngredientOption): string {
  return option.isWeight
    ? t("sandwich.stockGrams", { count: option.stockBase })
    : t("sandwich.stockUnits", {
        count: option.stockBase,
        unit: recipeUnitLabel(option.unit),
      });
}

export function IngredientPicker({
  options,
  value,
  takenIds,
  onChange,
  testId,
  defaultOpen = false,
}: IngredientPickerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.variantId === value);

  const results = useMemo(
    () => searchIngredientOptions(options, query),
    [options, query],
  );
  const firstPickable = results.find(
    (o) => o.variantId === value || !takenIds.has(o.variantId),
  );

  useEffect(() => {
    if (open) searchRef.current?.focus({ preventScroll: true });
  }, [open]);

  const pick = (variantId: string) => {
    onChange(variantId);
    setOpen(false);
    setQuery("");
  };

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <div className={styles.picker}>
      <button
        type="button"
        className={`${styles.pickerTrigger} ${selected ? "" : styles.pickerEmpty}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid={`${testId}-product`}
      >
        <span className={styles.pickerName}>
          {selected ? selected.name : t("sandwich.choose")}
        </span>
        <Icon n="down" s={16} />
      </button>

      {open && (
        <div className={styles.pickerPanel}>
          <div className={styles.pickerSearch}>
            <Icon n="search" s={16} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (firstPickable) pick(firstPickable.variantId);
                } else if (e.key === "Escape") {
                  // Close only the list, not the whole form.
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                }
              }}
              placeholder={t("sandwich.searchPlaceholder")}
              aria-label={t("sandwich.searchPlaceholder")}
              data-testid={`${testId}-search`}
              enterKeyHint="search"
              autoComplete="off"
            />
          </div>
          <ul
            className={styles.pickerList}
            role="listbox"
            aria-label={t("sandwich.product")}
          >
            {results.length === 0 ? (
              <li className={styles.pickerNone} role="status">
                {t("sandwich.noMatch")}
              </li>
            ) : (
              results.map((o, i) => {
                const taken =
                  o.variantId !== value && takenIds.has(o.variantId);
                const startsOthers =
                  i > 0 && o.priority === 3 && results[i - 1]!.priority < 3;
                return (
                  <React.Fragment key={o.variantId}>
                    {i === 0 && o.priority < 3 && (
                      <li className={styles.pickerGroup} aria-hidden="true">
                        {t("sandwich.groupCommon")}
                      </li>
                    )}
                    {startsOthers && (
                      <li className={styles.pickerGroup} aria-hidden="true">
                        {t("sandwich.groupOther")}
                      </li>
                    )}
                    <li role="none">
                      <button
                        type="button"
                        role="option"
                        aria-selected={o.variantId === value}
                        disabled={taken}
                        className={`${styles.pickerOption} ${o.variantId === value ? styles.pickerOptionOn : ""}`}
                        onClick={() => pick(o.variantId)}
                        data-testid={`ingredient-option-${o.variantId}`}
                      >
                        <span className={styles.pickerOptionName}>
                          {o.name}
                          {o.nameEn && (
                            <small className={styles.pickerEn}>
                              {o.nameEn}
                            </small>
                          )}
                        </span>
                        <span className={styles.pickerMeta}>
                          {taken ? t("sandwich.alreadyAdded") : stockLabel(o)}
                        </span>
                      </button>
                    </li>
                  </React.Fragment>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
