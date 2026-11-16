"use client";

import { apiGet } from "@/client/shared/api/read-cache";
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { Icon, Modal, useToast } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import { isServiceProduct as isServiceProductRule } from "@/domain/sale-pricing";
import { unitCostFromTotal } from "@/domain/stock/batch-cost";
import {
  type StoreProductItem,
  isServiceProduct,
} from "@/client/shared/store-items";
import type { StockInventoryItem } from "@/client/shared/store-items";
import { useAuth } from "@/client/shared/auth";
import { packWord } from "@/client/shared/unit-labels";
import { ProductFormModal } from "../products/ProductFormModal";
import { resolveSellingMethod, type StockProductOption } from "./AddStockModal";
import styles from "./StockView.module.css";

type Overlay = null | "manual" | "scan" | "quantity" | "confirm";

/** How the goods were paid: a paid invoice, or on credit to a supplier (آجل). */
type PayMode = "paid" | "credit";

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
}

const isUuid = (val?: string | null): val is string =>
  Boolean(
    val &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val),
  );

function physicalOnly(
  items: StockInventoryItem[] | undefined,
): StockInventoryItem[] {
  return (items ?? []).filter(
    (i) =>
      !isServiceProductRule({
        category: i.category ?? null,
        unit: i.unit ?? null,
      }),
  );
}

function formatOptionStock(opt?: StockProductOption): string {
  if (!opt) return "—";
  if (opt.currentStockBase <= 0) return "خلصان (0)";
  if (opt.unitMode === "weight") {
    return `${(opt.currentStockBase / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`;
  }
  const pack = opt.packQty || 1;
  if (pack > 1) {
    const cartons = Math.floor(opt.currentStockBase / pack);
    const pieces = opt.currentStockBase % pack;
    if (cartons > 0 && pieces > 0) return `${cartons} كرتونة و ${pieces} قطعة`;
    if (cartons > 0) return `${cartons} كرتونة`;
    return `${pieces} قطعة`;
  }
  return `${opt.currentStockBase} قطعة`;
}

function getUnitWord(u?: string, isCard?: boolean): string {
  const val = (u || "").toLowerCase();
  if (val === "can" || val === "علبة") return "علبة";
  if (val === "jar" || val === "برطمان") return "برطمان";
  if (val === "bag" || val === "كيس") return "كيس";
  if (val === "carton" || val === "كرتونة") return "كرتونة";
  if (val === "weight" || val === "kg" || val === "g") return "كجم";
  if (isCard) return "كارت";
  if (val && !["piece", "unit", "قطعة"].includes(val)) return val;
  return "قطعة";
}

export function StockView() {
  const toast = useToast();
  useAuth();

  const [overlay, setOverlay] = useState<Overlay>(null);
  const [inventory, setInventory] = useState<StockInventoryItem[]>([]);
  const [storeProducts, setStoreProducts] = useState<StoreProductItem[]>([]);

  // Manual selection
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOption, setSelectedOption] =
    useState<StockProductOption | null>(null);

  // New product modal
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [extraOptions, setExtraOptions] = useState<StockProductOption[]>([]);

  // Quantity form
  const [unitMode, setUnitMode] = useState<"piece" | "carton">("piece");
  const [qty, setQty] = useState(1);
  const [weightInput, setWeightInput] = useState("1");
  const [weightUnit] = useState<"kg" | "g">("kg");
  const [prodDate, setProdDate] = useState(
    () => new Date().toISOString().split("T")[0]!,
  );
  const [expiry, setExpiry] = useState("");
  const [noExpiry, setNoExpiry] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  // What one selling unit (piece / pack / kg) cost; empty = the registered buy price.
  const [costInput, setCostInput] = useState("");
  const [costTouched, setCostTouched] = useState(false);

  // Paid now, or on credit to a supplier (one purchase invoice, one payable).
  const [payMode, setPayMode] = useState<PayMode>("paid");
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [supplierId, setSupplierId] = useState<string>("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [paidNowInput, setPaidNowInput] = useState("");
  const purchaseOpRef = useRef<{ key: string; id: string } | null>(null);

  // Submission
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Scanner
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanStatus, setScanStatus] = useState("");
  const [scanError, setScanError] = useState("");
  const lastScannedRef = useRef<string>("");
  const lastScanTimeRef = useRef(0);

  // Physical scanner keyboard listener
  const physicalScanBuffer = useRef("");
  const physicalScanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Data loading ───

  const loadData = useCallback(async () => {
    try {
      const [stockRes, prodRes] = await Promise.all([
        apiGet("/api/stock?view=all"),
        apiGet("/api/products?filter=all").catch(() => null),
      ]);
      if (!stockRes.ok) throw new Error("فشل تحميل بيانات المخزون");
      const data = await stockRes.json();
      setInventory(physicalOnly(data.inventory));
      if (prodRes && prodRes.ok) {
        const prodData = await prodRes.json();
        setStoreProducts(prodData.products || []);
      }
    } catch {
      // silently fail, user can still use manual flow
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const fetchInitial = async () => {
      try {
        const [stockRes, prodRes] = await Promise.all([
          apiGet("/api/stock?view=all"),
          apiGet("/api/products?filter=all").catch(() => null),
        ]);
        if (ignore) return;
        if (!stockRes.ok) return;
        const data = await stockRes.json();
        setInventory(physicalOnly(data.inventory));
        if (prodRes && prodRes.ok) {
          const prodData = await prodRes.json();
          setStoreProducts(prodData.products || []);
        }
      } catch {
        // silently fail
      }
    };
    void fetchInitial();
    return () => {
      ignore = true;
    };
  }, []);

  // ─── Product options ───

  const productOptions: StockProductOption[] = useMemo(() => {
    const invMap = new Map<string, StockInventoryItem>();
    inventory.forEach((i) => {
      invMap.set(i.variantId, i);
      invMap.set(i.productId, i);
    });

    const options: StockProductOption[] = [];
    const seenIds = new Set<string>();

    storeProducts
      .filter((p) => !isServiceProduct(p))
      .forEach((p) => {
        const v = p.variants?.[0];
        const vId = v?.id || p.id;
        seenIds.add(vId);
        seenIds.add(p.id);
        const invItem = invMap.get(vId) || invMap.get(p.id);
        const isWeight =
          p.unit === "weight" ||
          p.unit === "kg" ||
          p.unit === "g" ||
          invItem?.unitMode === "weight";
        options.push({
          variantId: vId,
          productId: p.id,
          productName: p.name_ar,
          flavor: v?.flavor || invItem?.flavor,
          unitMode: isWeight ? "weight" : "piece",
          packQty: v?.pack_qty || invItem?.packQty || 12,
          currentStockBase:
            invItem?.currentStockBase ?? (p.stock_quantity || 0),
          buyCostPiasters:
            invItem?.buyPricePiasters ||
            p.buy_cost_piasters ||
            v?.buy_cost_piasters,
          unit: p.unit,
          category: p.category,
          packName: invItem?.packName ?? null,
        });
      });

    inventory.forEach((i) => {
      if (!seenIds.has(i.variantId) && !seenIds.has(i.productId)) {
        options.push({
          variantId: i.variantId,
          productId: i.productId,
          productName: i.productName,
          flavor: i.flavor,
          unitMode: i.unitMode,
          packQty: i.packQty,
          currentStockBase: i.currentStockBase,
          buyCostPiasters: i.buyPricePiasters,
          unit: i.unit || (i.unitMode === "weight" ? "kg" : "piece"),
          category: i.category,
          packName: i.packName ?? null,
        });
      }
    });

    extraOptions.forEach((opt) => {
      if (!seenIds.has(opt.variantId) && !seenIds.has(opt.productId)) {
        seenIds.add(opt.variantId);
        options.push(opt);
      }
    });

    return options;
  }, [inventory, storeProducts, extraOptions]);

  const filteredOptions = useMemo(() => {
    const q = normalizeArabic(searchQuery.trim());
    if (!q) return productOptions;
    return productOptions.filter(
      (opt) =>
        normalizeArabic(opt.productName).includes(q) ||
        (opt.flavor && normalizeArabic(opt.flavor).includes(q)),
    );
  }, [productOptions, searchQuery]);

  // ─── Derived quantities ───

  const sellingMethod = selectedOption
    ? resolveSellingMethod(selectedOption.unit)
    : "piece";
  const isWeight = sellingMethod === "weight";
  const packQty = Math.max(1, selectedOption?.packQty || 1);
  const isCard =
    selectedOption?.category === "كروت شحن" ||
    selectedOption?.category === "كروت مرافق";
  const unitWord = getUnitWord(selectedOption?.unit, isCard);

  const totalBaseQty = useMemo(() => {
    if (isWeight) {
      const wNum = parseFloat(weightInput) || 0;
      return weightUnit === "kg" ? Math.round(wNum * 1000) : Math.round(wNum);
    }
    if (unitMode === "carton") return qty * packQty;
    return qty;
  }, [isWeight, weightInput, weightUnit, unitMode, qty, packQty]);

  const regPiecePiasters = selectedOption?.buyCostPiasters ?? 0;
  const regPieceCost = regPiecePiasters > 0 ? regPiecePiasters / 100 : 0;
  const packWordNow = packWord(selectedOption?.packName, packQty);

  // One unit as chosen: a kg, a pack, or one piece.
  const unitCount = isWeight
    ? totalBaseQty / 1000
    : unitMode === "carton"
      ? qty
      : qty;
  const registeredUnitCost =
    regPieceCost > 0
      ? isWeight
        ? regPieceCost
        : unitMode === "carton"
          ? Math.round(regPieceCost * packQty * 100) / 100
          : regPieceCost
      : 0;
  const unitCostEgp = costTouched
    ? parseFloat(costInput) || 0
    : registeredUnitCost;
  const costNum = Math.round(unitCostEgp * unitCount * 100) / 100;

  const totalCostDisplay =
    costNum > 0 ? formatMoney(Math.round(costNum * 100)) : "—";
  const paidNowNum = Math.min(
    costNum,
    Math.max(0, parseFloat(paidNowInput) || 0),
  );
  const creditRest = Math.round((costNum - paidNowNum) * 100) / 100;

  const qtyDisplay = useMemo(() => {
    if (isWeight) {
      const wNum = parseFloat(weightInput) || 0;
      return `${wNum} ${weightUnit === "kg" ? "كجم" : "جم"}`;
    }
    if (unitMode === "carton") {
      return `${qty} ${packWordNow}`;
    }
    return `${qty} ${unitWord}`;
  }, [isWeight, weightInput, weightUnit, unitMode, qty, unitWord, packWordNow]);

  const qtyEquivDisplay = useMemo(() => {
    if (isWeight) return null;
    if (unitMode === "carton") return `= ${totalBaseQty} ${unitWord}`;
    return `= ${totalBaseQty} ${unitWord}`;
  }, [isWeight, unitMode, totalBaseQty, unitWord]);

  // ─── Expiry helpers ───

  const computeExpiryDate = (baseIso: string, months: number) => {
    const d = baseIso ? new Date(baseIso) : new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString().split("T")[0]!;
  };

  const expiryPresets = [
    { label: "بعد أسبوع", value: "week" },
    { label: "بعد شهر", value: "1m" },
    { label: "بعد 3 شهور", value: "3m" },
    { label: "بعد سنة", value: "1y" },
    { label: "من غير نهاية", value: "none" },
  ];

  const applyPreset = (preset: string) => {
    setActivePreset(preset);
    if (preset === "none") {
      setNoExpiry(true);
      setExpiry("");
      return;
    }
    setNoExpiry(false);
    const base = prodDate || new Date().toISOString().split("T")[0]!;
    const monthsMap: Record<string, number> = {
      week: 0,
      "1m": 1,
      "3m": 3,
      "1y": 12,
    };
    const months = monthsMap[preset] ?? 0;
    if (preset === "week") {
      const d = base ? new Date(base) : new Date();
      d.setDate(d.getDate() + 7);
      setExpiry(d.toISOString().split("T")[0]!);
    } else {
      setExpiry(computeExpiryDate(base, months));
    }
  };

  // ─── Select product and go to quantity step ───

  const selectProduct = useCallback((opt: StockProductOption) => {
    setSelectedOption(opt);
    const method = resolveSellingMethod(opt.unit);
    const w = method === "weight";
    if (w) {
      setWeightInput("1");
    } else {
      setQty(1);
      setUnitMode("piece");
    }
    setCostInput("");
    setCostTouched(false);
    setPayMode("paid");
    setPaidNowInput("");
    setProdDate(new Date().toISOString().split("T")[0]!);
    setExpiry("");
    setNoExpiry(false);
    setActivePreset(null);
    setSubmitError(null);
    setOverlay("quantity");
  }, []);

  // ─── Camera stop ───

  const stopScanner = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // ─── Barcode lookup ───

  const lookupBarcode = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;

      const now = Date.now();
      if (
        trimmed === lastScannedRef.current &&
        now - lastScanTimeRef.current < 2000
      ) {
        return;
      }
      lastScannedRef.current = trimmed;
      lastScanTimeRef.current = now;

      const found = storeProducts.find(
        (p) =>
          p.barcode?.trim() === trimmed ||
          p.variants?.some((v) => v.barcode?.trim() === trimmed),
      );

      if (found) {
        const v = found.variants?.[0];
        const vId = v?.id || found.id;
        const invItem = inventory.find(
          (i) => i.variantId === vId || i.productId === found.id,
        );
        const isW =
          found.unit === "weight" || found.unit === "kg" || found.unit === "g";
        const opt: StockProductOption = {
          variantId: vId,
          productId: found.id,
          productName: found.name_ar,
          flavor: v?.flavor || invItem?.flavor,
          unitMode: isW ? "weight" : "piece",
          packQty: v?.pack_qty || invItem?.packQty || 12,
          currentStockBase:
            invItem?.currentStockBase ?? (found.stock_quantity || 0),
          buyCostPiasters:
            invItem?.buyPricePiasters ||
            found.buy_cost_piasters ||
            v?.buy_cost_piasters,
          unit: found.unit,
          category: found.category,
        };
        stopScanner();
        selectProduct(opt);
        toast.show({ msg: `تم العثور على: ${found.name_ar}`, kind: "ok" });
      } else {
        setScanError(`الباركود ${trimmed} مش موجود في منتجاتك`);
      }
    },
    [storeProducts, inventory, toast, stopScanner, selectProduct],
  );

  // ─── Camera barcode scanner ───

  const startScanner = useCallback(async () => {
    setScanError("");
    setScanStatus("جاري فتح الكاميرا...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanStatus("وجّه الكاميرا على الباركود");

      if ("BarcodeDetector" in window) {
        const detector = new (
          window as unknown as {
            BarcodeDetector: new (opts: { formats: string[] }) => {
              detect: (
                source: HTMLVideoElement,
              ) => Promise<Array<{ rawValue: string }>>;
            };
          }
        ).BarcodeDetector({
          formats: [
            "ean_13",
            "ean_8",
            "code_128",
            "code_39",
            "upc_a",
            "upc_e",
            "qr_code",
          ],
        });
        scanIntervalRef.current = setInterval(async () => {
          if (videoRef.current && videoRef.current.readyState >= 2) {
            try {
              const results = await detector.detect(videoRef.current);
              if (results.length > 0) {
                const code = results[0]!.rawValue;
                lookupBarcode(code);
              }
            } catch {
              // detection failed, continue
            }
          }
        }, 500);
      } else {
        setScanStatus("الكاميرا شغالة — اكتب الباركود يدوي");
      }
    } catch {
      setScanError(
        "تعذر فتح الكاميرا. تأكد من السماح بالكاميرا أو اكتب الباركود يدوي.",
      );
      setScanStatus("");
    }
  }, [lookupBarcode]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  const openScan = useCallback(() => {
    setOverlay("scan");
    void startScanner();
  }, [startScanner]);

  const closeScan = useCallback(() => {
    stopScanner();
    setOverlay(null);
  }, [stopScanner]);

  // Physical barcode scanner: listen for rapid keystrokes ending with Enter
  useEffect(() => {
    if (overlay !== null && overlay !== "manual" && overlay !== "scan") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Enter") {
        const code = physicalScanBuffer.current.trim();
        if (code.length >= 4) {
          lookupBarcode(code);
        }
        physicalScanBuffer.current = "";
        return;
      }

      if (e.key.length === 1) {
        physicalScanBuffer.current += e.key;
        if (physicalScanTimer.current) clearTimeout(physicalScanTimer.current);
        physicalScanTimer.current = setTimeout(() => {
          physicalScanBuffer.current = "";
        }, 100);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [overlay, lookupBarcode]);

  // ─── Suppliers (آجل) ───

  useEffect(() => {
    if (payMode !== "credit" || suppliers !== null) return;
    let alive = true;
    apiGet("/api/people?section=suppliers")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          d: {
            people?: Array<{ id: string; name: string; phone: string | null }>;
          } | null,
        ) => {
          if (!alive) return;
          const list = (d?.people ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            phone: p.phone ?? null,
          }));
          setSuppliers(list);
          if (list[0]) setSupplierId((cur) => cur || list[0]!.id);
        },
      )
      .catch(() => alive && setSuppliers([]));
    return () => {
      alive = false;
    };
  }, [payMode, suppliers]);

  /** The chosen supplier, or a new one created once (a retry reuses it). */
  const ensureSupplier = async (): Promise<Supplier> => {
    const chosen = (suppliers ?? []).find((x) => x.id === supplierId);
    if (chosen) return chosen;
    const name = newSupplierName.trim();
    if (!name) throw new Error("اختار المورد أو اكتب اسم مورد جديد");
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        phone: newSupplierPhone.trim() || undefined,
        section: "suppliers",
        amountEgp: "0",
      }),
    });
    const json = (await res.json().catch(() => null)) as {
      person?: { id: string; name: string; phone: string | null };
      error?: { message?: string };
    } | null;
    if (!res.ok || !json?.person) {
      throw new Error(json?.error?.message || "تعذر تسجيل المورد");
    }
    const created = {
      id: json.person.id,
      name: json.person.name,
      phone: json.person.phone ?? null,
    };
    setSuppliers((prev) => [...(prev ?? []), created]);
    setSupplierId(created.id);
    return created;
  };

  const supplierReady =
    payMode !== "credit" ||
    (suppliers ?? []).some((x) => x.id === supplierId) ||
    newSupplierName.trim().length > 0;

  // ─── Submit ───

  const handleSubmit = async () => {
    if (!selectedOption || totalBaseQty <= 0) return;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const costPiasters = Math.round(costNum * 100);
      let targetVariantId = selectedOption.variantId;

      const isValidUuid = isUuid;

      if (
        targetVariantId.startsWith("temp_") ||
        targetVariantId.startsWith("created_") ||
        !isValidUuid(targetVariantId)
      ) {
        const newUnit = selectedOption.unit || (isWeight ? "kg" : "piece");
        const derivedUnitCost =
          costPiasters > 0 && totalBaseQty > 0
            ? unitCostFromTotal(costPiasters, totalBaseQty, newUnit)
            : null;
        const calculatedBuyCost =
          derivedUnitCost !== null
            ? Number(derivedUnitCost)
            : (selectedOption.buyCostPiasters ?? 0);

        const prodRes = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nameAr: selectedOption.productName,
            category: selectedOption.category || "المخزون",
            unit: newUnit,
            sellPricePiasters: costPiasters || 0,
            buyCostPiasters: calculatedBuyCost,
            variants: [
              {
                flavor: selectedOption.flavor ?? null,
                packQty: packQty,
                sellPricePiasters: costPiasters || 0,
                costPricePiasters: calculatedBuyCost,
              },
            ],
          }),
        });

        if (!prodRes.ok) {
          const prodErr = await prodRes.json().catch(() => ({}));
          throw new Error(
            prodErr.error?.message || "تعذر تجهيز المنتج للإضافة للمخزون",
          );
        }

        const prodData = await prodRes.json();
        targetVariantId =
          prodData.data?.variants?.[0]?.id ||
          prodData.product?.variants?.[0]?.id;
        if (!targetVariantId)
          throw new Error("تعذر تحديد معرّف الصنف في المخزون");
      }

      if (payMode === "credit") {
        // آجل: one supplier purchase — stock in and «عليك» up in one transaction.
        const supplier = await ensureSupplier();
        const body = {
          supplierId: supplier.id,
          lines: [
            {
              storeVariantId: targetVariantId,
              quantityBase: totalBaseQty,
              totalCostPiasters: Math.round(costNum * 100),
              expiryDate: noExpiry ? null : expiry || null,
            },
          ],
          paidNowPiasters: Math.round(paidNowNum * 100),
        };
        const key = JSON.stringify(body);
        if (purchaseOpRef.current?.key !== key) {
          purchaseOpRef.current = { key, id: crypto.randomUUID() };
        }
        const res = await fetch("/api/purchases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opId: purchaseOpRef.current.id, ...body }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error?.message || "فشل تسجيل فاتورة المورد");
        }
        purchaseOpRef.current = null;
        toast.show({
          msg: `اتسجلت الدخلة ✅ — ${formatMoney(Math.round(creditRest * 100))} آجل على ${supplier.name}`,
          kind: "ok",
        });
      } else {
        const payload = {
          action: "add",
          storeVariantId: targetVariantId,
          quantityBase: totalBaseQty,
          costTotalPiasters: Math.round(costNum * 100),
          productionDate: noExpiry ? null : prodDate || null,
          expiryDate: noExpiry ? null : expiry || null,
          batchCode: null,
        };

        const res = await fetch("/api/stock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            data.error?.message || "فشل تسجيل البضاعة في المخزون",
          );
        }

        toast.show({
          msg: `تم إضافة ${selectedOption.productName} للمخزون ✓`,
          kind: "ok",
        });
      }
      void loadData();

      setSelectedOption(null);
      setOverlay(null);
      setQty(1);
      setCostInput("");
      setCostTouched(false);
      setExpiry("");
      setNoExpiry(false);
      setActivePreset(null);
      setPayMode("paid");
      setPaidNowInput("");
      setNewSupplierName("");
      setNewSupplierPhone("");
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
      if (payMode !== "credit") setOverlay("quantity");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Render ───

  return (
    <div className={styles.view} data-testid="page-stock" dir="rtl">
      {/* Landing (V19) */}
      <h2 className={styles.landingTitle}>دخلت بضاعة جديدة؟</h2>

      <button
        type="button"
        className={styles.big}
        onClick={openScan}
        data-testid="stock-scan-btn"
      >
        <i aria-hidden="true">📷</i>
        امسح الباركود
      </button>

      <button
        type="button"
        className={styles.big}
        onClick={() => setOverlay("manual")}
        data-testid="stock-manual-btn"
      >
        <i aria-hidden="true">✍️</i>
        تسجيل يدوي
      </button>

      <p className={styles.note}>
        لو المنتج موجود، هتدخل الكمية والصلاحية بس. لو مش موجود، هتسجله بكل
        تفاصيله.
      </p>

      {/* Scanner Bottom Sheet */}
      {overlay === "scan" && (
        <Modal title="امسح الباركود" onClose={closeScan}>
          <div className={styles.scannerBody}>
            <video
              ref={videoRef}
              className={styles.scannerVideo}
              playsInline
              muted
            />
            {scanStatus && <p className={styles.scannerStatus}>{scanStatus}</p>}
            {scanError && <p className={styles.scannerError}>{scanError}</p>}
            <div className={styles.scannerManualRow}>
              <input
                type="text"
                className={styles.scannerManualInput}
                placeholder="أو اكتب الباركود هنا..."
                value={barcodeInput}
                onChange={(e) => {
                  setBarcodeInput(e.target.value);
                  setScanError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    lookupBarcode(barcodeInput);
                  }
                }}
                dir="ltr"
              />
              <button
                type="button"
                className={styles.scannerSearchBtn}
                onClick={() => lookupBarcode(barcodeInput)}
              >
                ابحث
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Manual selection Bottom Sheet */}
      {overlay === "manual" && (
        <Modal title="تسجيل يدوي" onClose={() => setOverlay(null)}>
          <div className={styles.view}>
            <p className={styles.fieldLabel}>اختار المنتج</p>

            <button
              type="button"
              className={styles.selectBtn}
              onClick={() => setDropdownOpen(!dropdownOpen)}
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
            >
              <span className={styles.selectChevron}>
                <Icon n="down" s={16} />
              </span>
              <span>
                {selectedOption
                  ? `${selectedOption.productName}${selectedOption.flavor ? ` (${selectedOption.flavor})` : ""}`
                  : "اختار المنتج"}
              </span>
            </button>

            {dropdownOpen && (
              <div className={styles.dropdownList}>
                <div className={styles.dropdownSearch}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="دوّر على المنتج..."
                    autoFocus
                  />
                </div>
                {filteredOptions.length === 0 ? (
                  <div className={styles.dropdownEmpty}>
                    مفيش منتج بالاسم ده
                  </div>
                ) : (
                  filteredOptions.map((opt) => (
                    <button
                      key={opt.variantId}
                      type="button"
                      className={styles.dropdownItem}
                      onClick={() => {
                        setSelectedOption(opt);
                        setDropdownOpen(false);
                        setSearchQuery("");
                      }}
                    >
                      <span className={styles.dropdownItemStock}>
                        {formatOptionStock(opt)}
                      </span>
                      <span>
                        {opt.productName}
                        {opt.flavor ? ` (${opt.flavor})` : ""}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}

            <p className={styles.hintText}>
              المنتجات اللي من غير باركود بتبان الأول
            </p>

            <button
              type="button"
              className={styles.continueBtn}
              disabled={!selectedOption}
              onClick={() => {
                if (selectedOption) selectProduct(selectedOption);
              }}
            >
              كمّل ← الكمية
            </button>

            <button
              type="button"
              className={styles.registerBtn}
              onClick={() => setShowNewProduct(true)}
            >
              المنتج مش موجود؟ سجّله
            </button>
          </div>
        </Modal>
      )}

      {/* Quantity Bottom Sheet */}
      {overlay === "quantity" && selectedOption && (
        <Modal
          title={selectedOption.productName}
          onClose={() => setOverlay(null)}
        >
          <div className={styles.sheetBody}>
            <p className={styles.note}>
              المتاح: {formatOptionStock(selectedOption)}
            </p>

            {submitError && <div className={styles.error}>{submitError}</div>}

            {!isWeight && packQty > 1 && (
              <div className={styles.chips}>
                <button
                  type="button"
                  className={`${styles.chip} ${unitMode === "carton" ? "" : styles.chipOn}`}
                  onClick={() => {
                    setUnitMode("piece");
                    setCostTouched(false);
                  }}
                >
                  {unitWord}
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${unitMode === "carton" ? styles.chipOn : ""}`}
                  data-testid="stock-unit-pack"
                  onClick={() => {
                    setUnitMode("carton");
                    setCostTouched(false);
                  }}
                >
                  {packWordNow} ({packQty})
                </button>
              </div>
            )}

            <div className={styles.lbl}>
              {isWeight
                ? "الكمية (كيلو)"
                : `الكمية (${unitMode === "carton" ? packWordNow : unitWord})`}
            </div>
            {isWeight ? (
              <input
                type="number"
                inputMode="decimal"
                step="0.25"
                min="0"
                className={styles.input}
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                placeholder="مثال: 5.5"
                data-testid="stock-weight"
              />
            ) : (
              <div className={styles.qty}>
                <button
                  type="button"
                  disabled={qty <= 1}
                  onClick={() => setQty((v) => Math.max(1, v - 1))}
                  data-testid="stock-qty-minus"
                  aria-label="أقل"
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={qty}
                  data-testid="stock-qty"
                  onChange={(e) =>
                    setQty(Math.max(1, Math.round(Number(e.target.value) || 1)))
                  }
                />
                <button
                  type="button"
                  onClick={() => setQty((v) => v + 1)}
                  data-testid="stock-qty-plus"
                  aria-label="أكتر"
                >
                  +
                </button>
              </div>
            )}
            {qtyEquivDisplay && unitMode === "carton" && (
              <p className={styles.note}>{qtyEquivDisplay}</p>
            )}

            <div className={styles.lbl}>
              سعر الشراء (
              {isWeight
                ? "الكيلو"
                : unitMode === "carton"
                  ? packWordNow
                  : unitWord}
              )
            </div>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              className={styles.input}
              value={costTouched ? costInput : registeredUnitCost || ""}
              placeholder="0"
              data-testid="stock-unit-cost"
              onChange={(e) => {
                setCostTouched(true);
                setCostInput(e.target.value);
              }}
            />

            <div className={styles.sumbox}>
              <div className={styles.line}>
                <span>تكلفة الكمية كلها</span>
                <b data-testid="stock-total">{totalCostDisplay}</b>
              </div>
            </div>

            <div className={styles.lbl}>تاريخ الصلاحية</div>
            <div className={styles.chips}>
              {expiryPresets.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`${styles.chip} ${activePreset === p.value ? styles.chipOn : ""}`}
                  onClick={() => applyPreset(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {!noExpiry && (
              <input
                type="date"
                className={styles.input}
                value={expiry}
                onChange={(e) => {
                  setExpiry(e.target.value);
                  setActivePreset(null);
                }}
                data-testid="stock-expiry"
              />
            )}

            <div className={styles.lbl}>الدفع إزاي؟</div>
            <div className={styles.chips}>
              <button
                type="button"
                className={`${styles.chip} ${payMode === "paid" ? styles.chipOn : ""}`}
                data-testid="stock-pay-paid"
                onClick={() => setPayMode("paid")}
              >
                🧾 فاتورة
              </button>
              <button
                type="button"
                className={`${styles.chip} ${payMode === "credit" ? styles.chipOn : ""}`}
                data-testid="stock-pay-credit"
                onClick={() => setPayMode("credit")}
              >
                📒 آجل على مورد
              </button>
            </div>

            <button
              type="button"
              className={styles.confirmBtn}
              disabled={
                totalBaseQty <= 0 || (payMode === "credit" && costNum <= 0)
              }
              onClick={() => setOverlay("confirm")}
            >
              كمّل ← التأكيد
            </button>
            {payMode === "credit" && costNum <= 0 && (
              <p className={styles.note}>
                اكتب سعر الشراء عشان نعرف المبلغ الآجل
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* Confirm Bottom Sheet */}
      {overlay === "confirm" && selectedOption && (
        <Modal title="تأكيد الدخول" onClose={() => setOverlay(null)}>
          <div className={styles.sheetBody}>
            <div className={styles.sumbox}>
              <div className={styles.line}>
                <span>{selectedOption.productName}</span>
                <b>{qtyDisplay}</b>
              </div>
              <div className={styles.line}>
                <span>الصلاحية</span>
                <b>{noExpiry ? "من غير نهاية" : expiry || "—"}</b>
              </div>
              <div className={styles.line}>
                <span>التكلفة</span>
                <b>{totalCostDisplay}</b>
              </div>
            </div>

            {payMode === "credit" && (
              <div data-testid="stock-supplier">
                <div className={styles.lbl}>المورد</div>
                <div className={styles.chips}>
                  {(suppliers ?? []).map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      className={`${styles.chip} ${supplierId === x.id ? styles.chipOn : ""}`}
                      onClick={() => setSupplierId(x.id)}
                    >
                      {x.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`${styles.chip} ${supplierId === "" ? styles.chipOn : ""}`}
                    data-testid="stock-new-supplier"
                    onClick={() => setSupplierId("")}
                  >
                    + مورد جديد
                  </button>
                </div>
                {supplierId === "" && (
                  <>
                    <input
                      className={styles.input}
                      placeholder="اسم المورد"
                      dir="auto"
                      value={newSupplierName}
                      data-testid="stock-supplier-name"
                      onChange={(e) => setNewSupplierName(e.target.value)}
                    />
                    <input
                      className={styles.input}
                      type="tel"
                      dir="ltr"
                      placeholder="رقم المورد (اختياري)"
                      value={newSupplierPhone}
                      onChange={(e) => setNewSupplierPhone(e.target.value)}
                    />
                  </>
                )}
                <div className={styles.lbl}>دفعت للمورد دلوقتي (اختياري)</div>
                <input
                  className={styles.input}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  placeholder="0"
                  value={paidNowInput}
                  data-testid="stock-paid-now"
                  onChange={(e) => setPaidNowInput(e.target.value)}
                />
                <div className={styles.sumbox}>
                  <div className={styles.line}>
                    <span>الباقي عليك للمورد</span>
                    <b data-testid="stock-credit-rest">
                      {formatMoney(Math.round(creditRest * 100))}
                    </b>
                  </div>
                </div>
              </div>
            )}

            {submitError && <div className={styles.error}>{submitError}</div>}

            <button
              type="button"
              className={styles.confirmBtn}
              disabled={isSubmitting || !supplierReady}
              onClick={handleSubmit}
              data-testid="stock-confirm"
            >
              {isSubmitting ? "بيتسجّل…" : "سجّل الدخلة ✅"}
            </button>

            <button
              type="button"
              className={styles.editBtn}
              disabled={isSubmitting}
              onClick={() => setOverlay("quantity")}
            >
              تعديل
            </button>
          </div>
        </Modal>
      )}

      {/* New product modal */}
      {showNewProduct && (
        <ProductFormModal
          presetName={searchQuery}
          onClose={() => setShowNewProduct(false)}
          onSaved={(newProduct: unknown) => {
            setShowNewProduct(false);
            const p = newProduct as {
              id?: string;
              nameAr?: string;
              name_ar?: string;
              unit?: string;
              variants?: Array<{
                id?: string;
                packQty?: number;
                pack_qty?: number;
                flavor?: string | null;
              }>;
            };
            const pName = p.nameAr || p.name_ar || "منتج جديد";
            const pVar = p.variants?.[0];
            const vId = pVar?.id || p.id || `created_${Date.now()}`;
            const newOpt: StockProductOption = {
              variantId: vId,
              productId: p.id || `prod_${Date.now()}`,
              productName: pName,
              flavor: pVar?.flavor ?? null,
              unitMode: p.unit === "kg" || p.unit === "g" ? "weight" : "piece",
              packQty: pVar?.packQty || pVar?.pack_qty || 1,
              currentStockBase: 0,
              unit: p.unit,
            };
            setExtraOptions((prev) => [newOpt, ...prev]);
            selectProduct(newOpt);
          }}
        />
      )}
    </div>
  );
}

export default StockView;
