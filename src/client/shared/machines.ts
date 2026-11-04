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

export const DEFAULT_MACHINES: PosMachine[] = [
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

/**
 * Returns cached POS machines synchronously from localStorage.
 */
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

/**
 * Saves POS machines into local cache and dispatches update event.
 */
export function saveStoredMachines(
  machines: PosMachine[],
  storeId?: string,
): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const key = getMachineStorageKey(storeId);
    window.localStorage.setItem(key, JSON.stringify(machines));
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

/**
 * Fetches POS machines from PostgreSQL database via API.
 * Updates local cache automatically for offline resilience.
 */
export async function fetchStoreMachines(
  storeId?: string,
): Promise<PosMachine[]> {
  if (typeof window === "undefined") {
    return DEFAULT_MACHINES;
  }

  try {
    const res = await fetch("/api/machines");
    if (!res.ok) {
      return getStoredMachines(storeId);
    }
    const data = await res.json();
    if (Array.isArray(data.machines) && data.machines.length > 0) {
      saveStoredMachines(data.machines, storeId);
      return data.machines;
    }
    return getStoredMachines(storeId);
  } catch {
    return getStoredMachines(storeId);
  }
}

/**
 * Upserts a POS machine in the database and updates cache.
 */
export async function createOrUpdateRemoteMachine(
  machine: {
    id?: string;
    name: string;
    provider: string;
    terminalId?: string;
    status?: "active" | "inactive" | "maintenance";
    notes?: string;
  },
  storeId?: string,
): Promise<PosMachine | null> {
  try {
    const res = await fetch("/api/machines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(machine),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.machine) {
        // Refresh full list from DB
        void fetchStoreMachines(storeId);
        return data.machine;
      }
    }
  } catch (err) {
    console.error("Remote machine upsert failed, falling back to local:", err);
  }

  // Fallback to local persistence
  const current = getStoredMachines(storeId);
  let updated: PosMachine[];
  if (machine.id) {
    updated = current.map((m) =>
      m.id === machine.id
        ? {
            ...m,
            name: machine.name,
            provider: machine.provider,
            terminalId: machine.terminalId,
            status: machine.status || m.status,
            notes: machine.notes,
          }
        : m,
    );
  } else {
    const newMach: PosMachine = {
      id: `mach-${Date.now()}`,
      name: machine.name,
      provider: machine.provider,
      terminalId: machine.terminalId,
      status: machine.status || "active",
      notes: machine.notes,
      currentBalancePiasters: 0,
      balanceTransactions: [],
      createdAt: new Date().toISOString(),
    };
    updated = [...current, newMach];
  }
  saveStoredMachines(updated, storeId);
  return updated.find((m) => m.name === machine.name) || null;
}

/**
 * Deletes a POS machine from database and local cache.
 */
export async function deleteRemoteMachine(
  machineId: string,
  storeId?: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/machines?id=${encodeURIComponent(machineId)}`,
      {
        method: "DELETE",
      },
    );
    if (res.ok) {
      void fetchStoreMachines(storeId);
      return true;
    }
  } catch (err) {
    console.error("Remote machine deletion failed, fallback to local:", err);
  }

  const current = getStoredMachines(storeId);
  const updated = current.filter((m) => m.id !== machineId);
  saveStoredMachines(updated, storeId);
  return true;
}

/**
 * Adds a topup / balance deposit to a POS machine in the database.
 */
export async function addRemoteMachineTopup(
  machineId: string,
  amountPiasters: number,
  params?: {
    source?: string;
    reference?: string;
    notes?: string;
  },
  storeId?: string,
): Promise<PosMachine[]> {
  try {
    const res = await fetch("/api/machines/topup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machineId,
        amountPiasters,
        source: params?.source,
        reference: params?.reference,
        notes: params?.notes,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.machine) {
        return await fetchStoreMachines(storeId);
      }
    }
  } catch (err) {
    console.error("Remote topup failed, falling back to local:", err);
  }

  return addMachineTopup(machineId, amountPiasters, params, storeId);
}

/**
 * Synchronous local topup fallback
 */
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
