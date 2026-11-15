/**
 * Pure helpers extracted from PeopleView.tsx.
 * No React, no side effects.
 */

import type { PeopleSection } from "@/schemas/people";

export function formatEgp(piasters: number): string {
  const egp = (piasters || 0) / 100;
  if (piasters % 100 !== 0) {
    return `${egp.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
  }
  return `${Math.floor(egp).toLocaleString("en-US")} ج.م`;
}

export function getWaUrl(
  phone: string | null | undefined,
  name: string,
  sec: PeopleSection,
  amountPiasters: number,
): string {
  if (!phone) return "";
  const cleanDigits = phone.replace(/\D/g, "");
  if (!cleanDigits) return "";
  const phoneFormatted = cleanDigits.startsWith("20")
    ? cleanDigits
    : cleanDigits.startsWith("0")
      ? `20${cleanDigits.slice(1)}`
      : `20${cleanDigits}`;

  let text = "";
  if (sec !== "suppliers" && amountPiasters <= 0) {
    text = `السلام عليكم يا ${name}.`;
  } else if (sec === "owedToMe") {
    text = `السلام عليكم يا ${name}، بخصوص الحساب المتبقي وقدره ${formatEgp(amountPiasters)}.`;
  } else if (sec === "iOwe") {
    text = `السلام عليكم يا ${name}، بخصوص المبلغ المستحق لحضرتك وقدره ${formatEgp(amountPiasters)} من طرفنا.`;
  } else {
    text = `السلام عليكم يا ${name}، للتواصل بخصوص البضاعة والطلبيات.`;
  }

  return `https://wa.me/${phoneFormatted}?text=${encodeURIComponent(text)}`;
}

export function parseCustomerNotes(note: string | null): {
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

export function serializeCustomerNotes(
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

export function parseSupplierNotes(note: string | null): {
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

export function serializeSupplierNotes(parts: {
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
