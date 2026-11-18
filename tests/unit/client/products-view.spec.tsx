import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductsView } from "@/client/features/products/ProductsView";
import { ProductFormModal } from "@/client/features/products/ProductFormModal";
import { ServiceFormModal } from "@/client/features/products/ServiceFormModal";
import { MachinesModal } from "@/client/features/products/MachinesModal";

describe("ProductsView Client Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders header with page title, add button, and products data-testid", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).toContain('data-testid="page-products"');
    expect(html).toContain("المنتجات");
    expect(html).toContain('data-testid="add-product-btn"');
    expect(html).toContain("+ جديد");
  });

  it("V19 exactly: «+ جديد», then المنتجات · العروض · السندوتشات — nothing else", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    for (const chip of ["المنتجات", "العروض", "السندوتشات"]) {
      expect(html).toContain(`>${chip}</button>`);
    }
    // No services tab, no machines, no hidden-items icon button, no extra search here.
    expect(html).not.toContain("الخدمات والفواتير");
    expect(html).not.toContain("ماكينات الدفع");
    expect(html).not.toContain("بحث بالصوت");
    expect(html).not.toContain('aria-label="المخفية');
    expect(html.indexOf("+ جديد")).toBeLessThan(html.indexOf(">المنتجات<"));
  });

  it("strictly omits stock balance, stock quantities, and stock badges from products view", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).not.toContain("متاح ");
    expect(html).not.toContain("المخزون الحالي");
    expect(html).not.toContain("قرب يخلص");
    expect(html).not.toContain("خلصان");
  });
});

describe("ProductFormModal Component", () => {
  it("renders creation modal with name, packaging selection, and piece pricing matching demo", () => {
    const html = renderToStaticMarkup(
      <ProductFormModal onClose={() => {}} onSaved={() => {}} />,
    );
    expect(html).toContain("📦 منتج جديد");
    expect(html).toContain("اسم المنتج");
    expect(html).toContain("التصنيف");
    expect(html).toContain("الباركود (اختياري)");
    expect(html).toContain("📷 امسح");
    expect(html).toContain("بتبيعه إزاي؟");
    expect(html).toContain("برطمان");
    expect(html).toContain("بالوزن");
    expect(html).toContain("كيس");
    expect(html).toContain("كمان بتتباع بعبوة أكبر");
    expect(html).toContain("سعر الشراء (القطعة)");
    expect(html).toContain("سعر البيع (القطعة)");
    expect(html).toContain("حفظ المنتج ✅");
  });

  it("renders weight pricing options (kilo and gram) when weighed product is passed", () => {
    const sampleWeighedProduct = {
      id: "prod-weight",
      name_ar: "جبنة رومي قديمة",
      category: "ألبان وجبن",
      unit: "kg",
      sell_price_piasters: 24000,
      buy_cost_piasters: 20000,
      variants: [
        {
          id: "var-w",
          pack_qty: 1,
          sell_price_piasters: 24000,
          buy_cost_piasters: 20000,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProductFormModal
        product={sampleWeighedProduct}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(html).toContain("بالكيلو");
    expect(html).toContain("بالجرام");
    expect(html).toContain("سعر البيع (الكيلو)");
  });

  it("renders carton fields and pricing when packaged product is passed", () => {
    const samplePackagedProduct = {
      id: "prod-pkg",
      name_ar: "Pepsi 1L",
      category: "مشروبات",
      unit: "piece",
      sell_price_piasters: 1500,
      buy_cost_piasters: 1350,
      variants: [
        {
          id: "var-1",
          pack_qty: 12,
          sell_price_piasters: 1500,
          buy_cost_piasters: 1350,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProductFormModal
        product={samplePackagedProduct}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(html).toContain("عدد القطع في الكرتونة");
    expect(html).toContain("سعر البيع (الكرتونة)");
    expect(html).toContain("سعر البيع (القطعة)");
  });

  it("renders edit modal with existing product data and delete button, with NO stock inputs", () => {
    const sampleProduct = {
      id: "prod-1",
      name_ar: "بيبسي 330 مل",
      category: "مشروبات",
      unit: "piece",
      sell_price_piasters: 1000,
      buy_cost_piasters: 800,
      is_custom: true,
      variants: [
        {
          id: "var-1",
          pack_qty: 1,
          sell_price_piasters: 1000,
          buy_cost_piasters: 800,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProductFormModal
        product={sampleProduct}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(html).toContain("✏️ تعديل المنتج");
    expect(html).toContain("بيبسي 330 مل");
    expect(html).toContain("احذف المنتج");
    expect(html).toContain("حفظ التعديل");
    expect(html).not.toContain("المخزون الحالي:");
  });

  it("strictly keeps physical product form free from digital commission fields", () => {
    const physicalProduct = {
      id: "prod-phys",
      name_ar: "سمن روابي 1.5 كجم",
      category: "زيوت وسمن",
      unit: "piece",
      sell_price_piasters: 14000,
      variants: [
        {
          id: "var-phys",
          pack_qty: 1,
          sell_price_piasters: 14000,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProductFormModal
        product={physicalProduct}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    expect(html).toContain("بتبيعه إزاي؟");
    expect(html).not.toContain("طريقة احتساب عمولة المحل");
    expect(html).not.toContain("محاكي الأرباح");
    expect(html).not.toContain("رسوم المزود");
  });

  it("renders bag packaging options (content type, weight/count, carton of bags) when bag unit product is passed", () => {
    const bagProduct = {
      id: "prod-bag",
      name_ar: "مكرونة الملكة 400 جم",
      category: "مكرونة وأرز",
      unit: "bag",
      sell_price_piasters: 1500,
      buy_cost_piasters: 1200,
      variants: [
        {
          id: "var-b1",
          pack_qty: 20,
          size_value: 400,
          size_unit: "g",
          sell_price_piasters: 1500,
          buy_cost_piasters: 1200,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProductFormModal
        product={bagProduct}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    expect(html).toContain("الكيس فيه");
    expect(html).toContain("وزن الكيس");
    expect(html).toContain("عدد قطع");
    expect(html).toContain("كمان بتتباع بالكرتونة");
    expect(html).toContain("سعر البيع (الكيس)");
  });

  it("renders scratch card title 'سعر الكارت' when prepaid card category is edited", () => {
    const cardProduct = {
      id: "prod-card",
      name_ar: "كارت شحن فودافون فكة 10",
      category: "كروت شحن",
      unit: "piece",
      sell_price_piasters: 1100,
      buy_cost_piasters: 1050,
      variants: [
        {
          id: "var-card",
          pack_qty: 1,
          sell_price_piasters: 1100,
          buy_cost_piasters: 1050,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProductFormModal
        product={cardProduct}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    expect(html).toContain("سعر البيع (الكارت)");
  });
});

describe("MachinesModal Component (Payment POS Terminals & Providers)", () => {
  it("renders POS machines manager with registered machines and action to add machine", () => {
    const html = renderToStaticMarkup(
      <MachinesModal onClose={() => {}} onMachinesUpdated={() => {}} />,
    );

    expect(html).toContain("ماكينات الدفع ومزودو الخدمة");
    expect(html).toContain("+ إضافة ماكينة دفع");
  });

  it("renders safety and privacy disclaimer without asking for PIN or OTP", () => {
    const html = renderToStaticMarkup(
      <MachinesModal onClose={() => {}} onMachinesUpdated={() => {}} />,
    );

    expect(html).not.toContain("رمز PIN");
    expect(html).not.toContain("كلمة المرور");
  });
});

describe("ServiceFormModal Component (Bills, Digital Services & Recharge)", () => {
  it("renders dedicated digital service form with responsive commission grid and no simulator or provider fee", () => {
    const serviceProduct = {
      id: "prod-bill",
      name_ar: "دفع فاتورة إنترنت منزلي وي",
      category: "فواتير إنترنت",
      unit: "service",
      sell_price_piasters: 500,
      variants: [
        {
          id: "var-bill",
          pack_qty: 1,
          sell_price_piasters: 500,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ServiceFormModal
        product={serviceProduct}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    // V19 serviceForm, the same for add and edit, prefilled.
    expect(html).toContain("تعديل الخدمة");
    expect(html).toContain("اسم الخدمة");
    expect(html).toContain("دفع فاتورة إنترنت منزلي وي");
    // Commission: fixed or percent, then the optional tiers.
    expect(html).toContain("مبلغ ثابت");
    expect(html).toContain("نسبة مئوية");
    expect(html).toContain("العمولة (جنيه لكل عملية)");
    expect(html).toContain('value="5"');
    expect(html).toContain("شرائح حسب قيمة العملية (اختياري)");
    expect(html).toContain("+ شريحة");
    expect(html).toContain("بتتشحن من أنهي ماكينات / محافظ؟");
    expect(html).toContain("حفظ الخدمة");
    expect(html).toContain("🗑️ امسح الخدمة");
    expect(html).not.toContain("محاكي الأرباح");
    expect(html).not.toContain("بيتباع إزاي؟");
  });

  it("a new service: the same form, empty, with no delete", () => {
    const html = renderToStaticMarkup(
      <ServiceFormModal onClose={() => {}} onSaved={() => {}} />,
    );
    expect(html).toContain("خدمة جديدة");
    expect(html).toContain("مثلاً: تحويل فودافون كاش");
    expect(html).toContain("شرائح حسب قيمة العملية (اختياري)");
    expect(html).not.toContain("امسح الخدمة");
  });

  it("renders 'أخرى (إنشاء تصنيف جديد...)' option and input in ProductFormModal", () => {
    const htmlNormal = renderToStaticMarkup(
      <ProductFormModal onClose={() => {}} onSaved={() => {}} />,
    );
    expect(htmlNormal).toContain("تصنيف جديد…");

    // When custom category is preset, custom input field is rendered
    const htmlCustom = renderToStaticMarkup(
      <ProductFormModal
        defaultCategory="أدوات مكتبية"
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(htmlCustom).toContain("اسم التصنيف الجديد");
    expect(htmlCustom).toContain("أدوات مكتبية");
  });
});
