---
name: arabic-ui
description: Arabic RTL user interface standards, localized copywriting in ar.json, mobile touch ergonomics, and displaying integer piasters as Egyptian Pounds.
---

# Arabic RTL UI & Localization Skill

## When to Use

- Creating or editing any component, modal, sheet, or page in `src/client/` or `src/app/`.
- Adding user-facing text, notifications, error messages, or form labels.
- Rendering prices, balances, discounts, or receipts.
- Styling layouts, margins, padding, and alignments.

## Core Rules & Principles

1. **Strictly Arabic RTL**: The interface is right-to-left (`dir="rtl"`) with Cairo typography (`font-family: var(--font-cairo)`).
2. **Simple Egyptian Colloquial**: Copy must be concise, familiar, and conversational Egyptian Arabic (e.g. "زامن", "حفظ", "فاتورة جديدة", "المخزن فاضي"). Avoid overly stiff classical phrasing.
3. **Zero Hard-Coded Arabic**: All visible strings MUST reside in `src/client/shared/i18n/ar.json` and be accessed via `t('namespace.key')`. Never embed Arabic string literals directly in `.tsx` files.
4. **Piasters Displayed as Pounds**:
   - Internal storage is ALWAYS integer piasters (`100 piasters = 1 EGP`).
   - The user must NEVER see raw piasters.
   - Always format via currency helpers (e.g., `formatMoney(1550)` produces `15.50 ج.م` or `15.50 EGP`).
5. **Mobile Ergonomics**:
   - Primary viewports: 320px, 360px, 390px.
   - Minimum touch target: 44×44px for buttons, list items, and inputs.
   - Respect `prefers-reduced-motion`. No hover-only interactions.

## Implementation Steps

### 1. Adding Strings to `ar.json`

In `src/client/shared/i18n/ar.json`:

```json
{
  "sales": {
    "title": "نقطة البيع",
    "cartEmpty": "السلة فاضية",
    "checkout": "إتمام البيع",
    "total": "الإجمالي"
  },
  "common": {
    "currencySymbol": "ج.م",
    "save": "حفظ",
    "cancel": "إلغاء",
    "sync": "زامن"
  }
}
```

### 2. Rendering Localized Text with `t()`

In components:

```tsx
import { useTranslation } from "@/client/shared/i18n";

export function CartSummary({ totalPiasters }: { totalPiasters: number }) {
  const { t, formatMoney } = useTranslation();

  return (
    <div className="cart-summary" dir="rtl">
      <span>{t("sales.total")}</span>
      <strong>{formatMoney(totalPiasters)}</strong>
    </div>
  );
}
```

### 3. Currency Formatting Utility

Integer piasters are converted to formatted Egyptian Pounds:

```ts
export function formatMoney(piasters: number): string {
  const pounds = piasters / 100;
  return `${pounds.toLocaleString("ar-EG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ج.م`;
}
```

### 4. RTL Styling Best Practices

- Use CSS logical properties: `margin-inline-start`, `padding-inline-end`, `border-inline-start`.
- Use demo CSS variables: `var(--bg)`, `var(--sf)`, `var(--ink)`, `var(--br)`, `var(--accent)`.
- Test on 320px and 360px viewport widths to ensure zero horizontal scroll or clipped text.

## Mandatory Checks

- [ ] Are all UI text strings extracted into `src/client/shared/i18n/ar.json`?
- [ ] Is there zero hard-coded Arabic text in `.tsx` files?
- [ ] Are all prices formatted with `formatMoney` and displayed in pounds (ج.م)?
- [ ] Are touch targets at least 44×44px on a 360px screen?
- [ ] Does layout align correctly in RTL without horizontal scroll overflow?

## Documentation Links

- [docs/05-ui.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/05-ui.md) — UI/UX specification, color tokens, typography, and motion rules.
- [docs/demo/hesba-demo.html](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/demo/hesba-demo.html) — Reference visual styles, component behaviors, and interactive demo.
- [docs/02-arch.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/02-arch.md) — Client directory layout and i18n structure.
