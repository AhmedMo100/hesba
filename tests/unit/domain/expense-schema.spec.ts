import { describe, expect, it } from "vitest";
import {
  createExpenseInputSchema,
  updateExpenseInputSchema,
  EXPENSE_CATEGORIES,
} from "@/schemas/expense";
import { computePeriodDateRange } from "@/server/modules/expenses/expense.service";

describe("Expense Schema & Validation", () => {
  it("validates valid expense creation payload", () => {
    const valid = {
      category: "كهرباء",
      amountPiasters: 12000,
      note: "فاتورة شهر أكتوبر",
      spentAt: "2026-10-29T10:00:00.000Z",
    };

    const parsed = createExpenseInputSchema.parse(valid);
    expect(parsed.category).toBe("كهرباء");
    expect(parsed.amountPiasters).toBe(12000);
    expect(parsed.note).toBe("فاتورة شهر أكتوبر");
  });

  it("normalizes alias category 'نت' to 'إنترنت'", () => {
    const parsed = createExpenseInputSchema.parse({
      category: "نت",
      amountPiasters: 25000,
    });
    expect(parsed.category).toBe("إنترنت");
  });

  it("accepts all canonical categories", () => {
    for (const cat of EXPENSE_CATEGORIES) {
      const parsed = createExpenseInputSchema.parse({
        category: cat,
        amountPiasters: 1000,
      });
      expect(parsed.category).toBe(cat);
    }
  });

  it("rejects non-positive and float amounts", () => {
    expect(() =>
      createExpenseInputSchema.parse({
        category: "كهرباء",
        amountPiasters: 0,
      }),
    ).toThrow();

    expect(() =>
      createExpenseInputSchema.parse({
        category: "كهرباء",
        amountPiasters: -500,
      }),
    ).toThrow();

    expect(() =>
      createExpenseInputSchema.parse({
        category: "كهرباء",
        amountPiasters: 12.5,
      }),
    ).toThrow();
  });

  it("rejects invalid categories", () => {
    expect(() =>
      createExpenseInputSchema.parse({
        category: "سياحة وسفر",
        amountPiasters: 5000,
      }),
    ).toThrow("تصنيف المصروف غير معروف");
  });

  it("validates updateExpenseInputSchema with partial fields", () => {
    const parsed = updateExpenseInputSchema.parse({
      amountPiasters: 15000,
    });
    expect(parsed.amountPiasters).toBe(15000);
    expect(parsed.category).toBeUndefined();
  });
});

describe("Expense Date Range Computation", () => {
  it("computes valid date range for today, yesterday, 7days, month, year", () => {
    const today = computePeriodDateRange("today");
    expect(today.gte).toBeInstanceOf(Date);
    expect(today.lte).toBeInstanceOf(Date);
    expect(today.gte!.getTime()).toBeLessThan(today.lte!.getTime());

    const yesterday = computePeriodDateRange("yesterday");
    expect(yesterday.gte!.getTime()).toBeLessThan(yesterday.lte!.getTime());
    expect(yesterday.lte!.getTime()).toBeLessThan(today.gte!.getTime());

    const week = computePeriodDateRange("7days");
    expect(week.gte!.getTime()).toBeLessThan(today.gte!.getTime());

    const month = computePeriodDateRange("month");
    expect(month.gte!.getTime()).toBeLessThanOrEqual(today.gte!.getTime());

    const year = computePeriodDateRange("year");
    expect(year.gte!.getTime()).toBeLessThanOrEqual(month.gte!.getTime());
  });

  it("computes custom date range correctly", () => {
    const custom = computePeriodDateRange("custom", {
      from: "2026-10-01",
      to: "2026-10-15",
    });
    expect(custom.gte).toBeInstanceOf(Date);
    expect(custom.lte).toBeInstanceOf(Date);
    expect(custom.gte!.getTime()).toBeLessThan(custom.lte!.getTime());
  });
});
