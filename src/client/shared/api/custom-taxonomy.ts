"use client";

export const STANDARD_CATEGORIES = [
  "السلع الاستهلاكية",
  "سلع أساسية",
  "ألبان وجبن",
  "مشروبات",
  "سناكس ومقرمشات",
  "بقوليات ومخبوزات",
  "حلويات وشوكولاتة",
  "زيوت وسمن",
  "معلبات وصلصات",
  "منظفات وعناية منزلية",
  "عناية شخصية",
  "مجمدات ولحوم",
  "توابل وبهارات",
  "أخرى",
] as const;

export const STANDARD_SELLING_METHODS = [
  { key: "piece", label: "قطعة", icon: "box" },
  { key: "can", label: "علبة", icon: "box" },
  { key: "jar", label: "برطمان", icon: "box" },
  { key: "bag", label: "كيس", icon: "layers" },
  { key: "carton", label: "كرتونة", icon: "store" },
  { key: "weight", label: "وزن", icon: "scale" },
] as const;

export const SECONDARY_PACKAGING_PRESETS = [
  { key: "carton", label: "كرتونة", defaultPack: 12 },
  { key: "dozen", label: "دستة (12)", defaultPack: 12 },
  { key: "bag", label: "كيس / باكت", defaultPack: 10 },
  { key: "box", label: "علبة / باكيت", defaultPack: 6 },
  { key: "custom", label: "أخرى (طريقة مخصصة)", defaultPack: 12 },
] as const;

const TAXONOMY_STORAGE_KEY_PREFIX = "hesba_custom_taxonomy";

function getStorageKey(storeId?: string): string {
  return `${TAXONOMY_STORAGE_KEY_PREFIX}_${storeId || "default"}`;
}

export interface CustomTaxonomyState {
  customCategories: string[];
  customSellingMethods: string[];
}

export function getCachedCustomTaxonomy(storeId?: string): CustomTaxonomyState {
  if (typeof window === "undefined") {
    return { customCategories: [], customSellingMethods: [] };
  }
  try {
    const raw = localStorage.getItem(getStorageKey(storeId));
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        customCategories: Array.isArray(parsed.customCategories)
          ? parsed.customCategories
          : [],
        customSellingMethods: Array.isArray(parsed.customSellingMethods)
          ? parsed.customSellingMethods
          : [],
      };
    }
  } catch {}
  return { customCategories: [], customSellingMethods: [] };
}

export async function fetchCustomTaxonomy(
  storeId?: string,
): Promise<CustomTaxonomyState> {
  try {
    const res = await fetch("/api/store/custom-taxonomy");
    if (res.ok) {
      const data = await res.json();
      const state: CustomTaxonomyState = {
        customCategories: Array.isArray(data.customCategories)
          ? data.customCategories
          : [],
        customSellingMethods: Array.isArray(data.customSellingMethods)
          ? data.customSellingMethods
          : [],
      };
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(getStorageKey(storeId), JSON.stringify(state));
        } catch {}
      }
      return state;
    }
  } catch {}
  return getCachedCustomTaxonomy(storeId);
}

export async function saveCustomTaxonomy(
  item: { newCategory?: string; newSellingMethod?: string },
  storeId?: string,
): Promise<CustomTaxonomyState> {
  const current = getCachedCustomTaxonomy(storeId);
  const updatedCategories = [...current.customCategories];
  const updatedMethods = [...current.customSellingMethods];

  if (item.newCategory && item.newCategory !== "أخرى") {
    const trimmed = item.newCategory.trim();
    if (trimmed && !updatedCategories.includes(trimmed)) {
      updatedCategories.push(trimmed);
    }
  }

  if (item.newSellingMethod && item.newSellingMethod !== "أخرى") {
    const trimmed = item.newSellingMethod.trim();
    if (trimmed && !updatedMethods.includes(trimmed)) {
      updatedMethods.push(trimmed);
    }
  }

  const newState = {
    customCategories: updatedCategories,
    customSellingMethods: updatedMethods,
  };

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(getStorageKey(storeId), JSON.stringify(newState));
      window.dispatchEvent(new Event("hesba_custom_taxonomy_updated"));
    } catch {}
  }

  // Persist to server in background
  try {
    await fetch("/api/store/custom-taxonomy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
  } catch {}

  return newState;
}
