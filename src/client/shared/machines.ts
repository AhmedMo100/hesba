"use client";

export interface BalanceTransaction {
  id: string;
  type: "deposit" | "withdrawal" | "settlement" | "adjustment";
  amountPiasters: number;
  balanceAfterPiasters: number;
  source?: string;
  reference?: string;
  notes?: string;
  createdAt: string;
}

export interface PosMachine {
  id: string;
  name: string;
  provider: string;
  terminalId?: string;
  status: "active" | "inactive" | "maintenance";
  notes?: string;
  currentBalancePiasters: number;
  balanceTransactions: BalanceTransaction[];
  createdAt: string;
}

const STORAGE_KEY_PREFIX = "hesba_pos_machines_v2";

export function getMachineStorageKey(storeId?: string): string {
  if (!storeId || storeId === "default") {
    return STORAGE_KEY_PREFIX;
  }
  return `${STORAGE_KEY_PREFIX}_${storeId}`;
}

const DEFAULT_MACHINES: PosMachine[] = [
  {
    id: "mach-1",
    name: "ماكينة فوري الرئيسية",
    provider: "فوري (Fawry)",
    terminalId: "FAWRY-POS-01",
    status: "active",
    notes: "ماكينة الكاشير الأساسية لخدمات الدفع والشحن",
    currentBalancePiasters: 250000, // 2,500.00 EGP
    balanceTransactions: [
      {
        id: "tx-init-1",
        type: "deposit",
        amountPiasters: 250000,
        balanceAfterPiasters: 250000,
        source: "إيداع رصيد البداية - خزينة المحل",
        reference: "DEP-INIT-001",
        notes: "رصيد افتتاح الماكينة",
        createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      },
    ],
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: "mach-2",
    name: "ماكينة أمان",
    provider: "أمان (Aman)",
    terminalId: "AMAN-POS-02",
    status: "active",
    notes: "ماكينة ثانوية لفواتير الكهرباء والمرافق",
    currentBalancePiasters: 120000, // 1,200.00 EGP
    balanceTransactions: [
      {
        id: "tx-init-2",
        type: "deposit",
        amountPiasters: 120000,
        balanceAfterPiasters: 120000,
        source: "شحن رصيد - فودافون كاش",
        reference: "AMAN-DEP-992",
        notes: "شحن رصيد عمل فواتير",
        createdAt: new Date(Date.now() - 86400000).toISOString(),
      },
    ],
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

export function getStoredMachines(storeId?: string): PosMachine[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_MACHINES;
  }
  try {
    const key = getMachineStorageKey(storeId);
    let raw = window.localStorage.getItem(key);

    // Auto-migrate legacy storage keys if present
    if (!raw && (!storeId || storeId === "default")) {
      const v2Default = window.localStorage.getItem(
        "hesba_pos_machines_v2_default",
      );
      const v1Default = window.localStorage.getItem(
        "hesba_pos_machines_default",
      );
      if (v2Default) {
        raw = v2Default;
        window.localStorage.setItem(key, v2Default);
      } else if (v1Default) {
        raw = v1Default;
        window.localStorage.setItem(key, v1Default);
      }
    }

    if (!raw) {
      window.localStorage.setItem(key, JSON.stringify(DEFAULT_MACHINES));
      return DEFAULT_MACHINES;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((m: Partial<PosMachine>) => ({
        id: m.id || `mach-${Date.now()}`,
        name: m.name || "ماكينة دفع",
        provider: m.provider || "فوري (Fawry)",
        terminalId: m.terminalId,
        status: m.status || "active",
        notes: m.notes,
        currentBalancePiasters: m.currentBalancePiasters || 0,
        balanceTransactions: Array.isArray(m.balanceTransactions)
          ? m.balanceTransactions
          : [],
        createdAt: m.createdAt || new Date().toISOString(),
      }));
    }
    return DEFAULT_MACHINES;
  } catch {
    return DEFAULT_MACHINES;
  }
}

export function saveStoredMachines(
  machines: PosMachine[],
  storeId?: string,
): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const key = getMachineStorageKey(storeId);
    window.localStorage.setItem(key, JSON.stringify(machines));
    // Keep legacy fallback keys updated for any external consumers
    if (!storeId || storeId === "default") {
      window.localStorage.setItem(
        "hesba_pos_machines_v2_default",
        JSON.stringify(machines),
      );
    }
    window.dispatchEvent(new Event("hesba_machines_updated"));
  } catch (err) {
    console.error("Failed to persist POS machines:", err);
  }
}

export function addMachineTopup(
  machineId: string,
  amountPiasters: number,
  params?: {
    source?: string;
    reference?: string;
    notes?: string;
  },
  storeId?: string,
): PosMachine[] {
  const current = getStoredMachines(storeId);
  const updated = current.map((m) => {
    if (m.id !== machineId) return m;
    const newBalance = (m.currentBalancePiasters || 0) + amountPiasters;
    const tx: BalanceTransaction = {
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "deposit",
      amountPiasters,
      balanceAfterPiasters: newBalance,
      source: params?.source?.trim() || "إيداع رصيد ماكينة",
      reference: params?.reference?.trim() || undefined,
      notes: params?.notes?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    return {
      ...m,
      currentBalancePiasters: newBalance,
      balanceTransactions: [tx, ...(m.balanceTransactions || [])],
    };
  });
  saveStoredMachines(updated, storeId);
  return updated;
}
