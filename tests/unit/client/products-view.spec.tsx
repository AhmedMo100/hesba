import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductsView } from "@/client/app-shell/views/ProductsView";
import { ProductFormModal } from "@/client/app-shell/views/ProductFormModal";
import { ServiceFormModal } from "@/client/app-shell/views/ServiceFormModal";
import { AddStockModal } from "@/client/app-shell/views/AddStockModal";
import { MachinesModal } from "@/client/app-shell/views/MachinesModal";

describe("ProductsView Client Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders header with page title, add button, and products data-testid", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).toContain('data-testid="page-products"');
    expect(html).toContain("المنتجات");
    expect(html).toContain('data-testid="add-product-btn"');
    expect(html).toContain("إضافة منتج");
  });

  it("renders top segmented tabs switching between 'المنتجات' and 'الفواتير والشحن'", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).toContain("المنتجات");
    expect(html).toContain("الفواتير والشحن");
  });

  it("renders search box with Arabic placeholder and microphone button", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).toContain("دوّر على منتج… اكتب أو اتكلم");
    expect(html).toContain("بحث بالصوت");
  });

  it("renders filter chips for all products and toggle button for hidden products", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).toContain("الكل (0)");
    expect(html).toContain("المخفية (0)");
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
    expect(html).toContain("إضافة منتج");
    expect(html).toContain("اسم المنتج");
    expect(html).toContain("التصنيف");
    expect(html).toContain("إلزامي للإضافة");
    expect(html).toContain("بيتباع إزاي؟");
    expect(html).toContain("بالقطعة / الكرتونة");
    expect(html).toContain("بالوزن");
    expect(html).toContain("بالكيس");
    expect(html).toContain("بيتباع كرتونة كمان");
    expect(html).toContain("سعر القطعة");
    expect(html).toContain("إضافة");
    expect(html).toContain("إلغاء");
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
    expect(html).toContain("التسعير بالوزن:");
    expect(html).toContain("بالكيلو (كجم)");
    expect(html).toContain("بالجرام (جم)");
    expect(html).toContain("سعر الكيلو");
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
    expect(html).toContain("سعر الكرتونة");
    expect(html).toContain("سعر القطعة");
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
    expect(html).toContain("تعديل المنتج");
    expect(html).toContain("بيبسي 330 مل");
    expect(html).toContain("حذف");
    expect(html).toContain("حفظ");
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

    expect(html).toContain("بيتباع إزاي؟");
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

    expect(html).toContain("بالكيس");
    expect(html).toContain("محتوى الكيس");
    expect(html).toContain("بالوزن (جرام / كجم)");
    expect(html).toContain("بالعدد (قطع)");
    expect(html).toContain("بيتباع كرتونة كمان (تحتوي على أكياس)");
    expect(html).toContain("سعر الكيس الواحد");
    expect(html).toContain("مصنف بالفعل");
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

    expect(html).toContain("سعر الكارت");
  });
});

describe("AddStockModal Component", () => {
  it("renders quantity mode choice (carton/piece vs weight) and total purchase cost input", () => {
    const sampleProduct = {
      id: "prod-sample",
      name_ar: "بيبسي 1 لتر",
      category: "مشروبات",
      unit: "piece",
      sell_price_piasters: 1500,
      buy_cost_piasters: 1350,
      is_custom: false,
      variants: [
        {
          id: "var-p1",
          pack_qty: 12,
          sell_price_piasters: 1500,
          buy_cost_piasters: 1350,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <AddStockModal
        targetProduct={sampleProduct}
        onClose={() => {}}
        onAdded={() => {}}
      />,
    );

    expect(html).toContain("إضافة للمخزون: بيبسي 1 لتر");
    expect(html).toContain("طريقة البيع والكمية المدخلة:");
    expect(html).toContain("قطعة");
    expect(html).toContain("علبة");
    expect(html).toContain("برطمان");
    expect(html).toContain("كيس");
    expect(html).toContain("كرتونة");
    expect(html).toContain("وزن");
    expect(html).toContain("كراتين");
    expect(html).toContain("قطع زيادة");
    expect(html).toContain("قطع/كرتونة");
    expect(html).toContain("إجمالي سعر الشراء للكمية دي (ج.م)");
    expect(html).toContain("تاريخ الإنتاج / البداية (اختياري)");
    expect(html).toContain("تاريخ الانتهاء");
    expect(html).toContain(
      "المنتج ملوش تاريخ صلاحية (زي الكروت، المنظفات، والورقيات)",
    );
    expect(html).toContain("بعد 3 شهور");
    expect(html).toContain("بعد سنة");
  });

  it("allows re-supplying stock at any time even when product already has stock > 0", () => {
    const stockedProduct = {
      id: "prod-stocked",
      name_ar: "شيبسي عائلي بالجبنة",
      category: "سناكس ومقرمشات",
      unit: "piece",
      sell_price_piasters: 1000,
      buy_cost_piasters: 800,
      stock_quantity: 48,
      is_custom: false,
      variants: [
        {
          id: "var-s1",
          pack_qty: 12,
          sell_price_piasters: 1000,
          buy_cost_piasters: 800,
          stock_quantity: 48,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <AddStockModal
        targetProduct={stockedProduct}
        onClose={() => {}}
        onAdded={() => {}}
      />,
    );

    expect(html).toContain("إضافة للمخزون: شيبسي عائلي بالجبنة");
    expect(html).toContain("الرصيد الحالي: <b>4 كرتونة</b>");
    expect(html).toContain("إضافة ✓");
  });

  it("renders bag-specific labels when adding stock for a product sold in bags", () => {
    const bagProduct = {
      id: "prod-bag-stock",
      name_ar: "سكر الأسرة 1 كجم",
      category: "سلع أساسية",
      unit: "bag",
      sell_price_piasters: 3500,
      buy_cost_piasters: 3000,
      stock_quantity: 0,
      is_custom: false,
      variants: [
        {
          id: "var-b2",
          pack_qty: 10,
          sell_price_piasters: 3500,
          buy_cost_piasters: 3000,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <AddStockModal
        targetProduct={bagProduct}
        onClose={() => {}}
        onAdded={() => {}}
      />,
    );

    expect(html).toContain("أكياس زيادة");
    expect(html).toContain("أكياس/كرتونة");
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

    // Header & Title
    expect(html).toContain("تعديل الخدمة / الكارت");
    expect(html).toContain("اسم الخدمة أو الكارت");

    // Preselected Category with badge
    expect(html).toContain("تصنيف الخدمة");
    expect(html).toContain("مصنف بالفعل");

    // Commission Model Options
    expect(html).toContain("طريقة احتساب عمولة المحل:");
    expect(html).toContain("مبلغ ثابت (ج.م)");
    expect(html).toContain("نسبة مئوية (%)");
    expect(html).toContain("شرائح مبالغ");

    // Strictly omitted elements
    expect(html).not.toContain("محاكي الأرباح");
    expect(html).not.toContain("رسوم المزود");
    expect(html).not.toContain("بيتباع إزاي؟");

    // Regulatory disclaimer
    expect(html).toContain("تطبيق «حِسبة» يقوم بحساب وتسجيل العمولات");
  });

  it("renders card-specific labels and placeholder when card category is selected", () => {
    const html = renderToStaticMarkup(
      <ServiceFormModal
        presetCategory="كروت شحن"
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    expect(html).toContain("إضافة خدمة أو كارت");
    expect(html).toContain("مثال: كارت شحن فودافون فكة 10");
    expect(html).toContain("إلزامي للإضافة");
    expect(html).toContain("سعر بيع الكارت (ج.م)");
  });

  it("renders 'أخرى (إنشاء تصنيف جديد...)' option and input in ProductFormModal", () => {
    const htmlNormal = renderToStaticMarkup(
      <ProductFormModal onClose={() => {}} onSaved={() => {}} />,
    );
    expect(htmlNormal).toContain("أخرى (إنشاء تصنيف جديد...)");

    // When custom category is preset, custom input field is rendered
    const htmlCustom = renderToStaticMarkup(
      <ProductFormModal
        defaultCategory="أدوات مكتبية"
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(htmlCustom).toContain("اكتب اسم التصنيف الجديد هنا...");
    expect(htmlCustom).toContain("أدوات مكتبية");
  });
});
