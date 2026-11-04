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

/**
 * Resolves current active store ID from session storage or auth cache.
 */
export function getActiveStoreId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const fromSession = window.sessionStorage?.getItem(
      "hesba_current_store_id",
    );
    if (fromSession) return fromSession;

    const testSession = window.localStorage?.getItem("hesba_test_session");
    if (testSession) {
      const parsed = JSON.parse(testSession);
      if (parsed?.store?.id) return parsed.store.id;
    }
  } catch {}
  return undefined;
}

export function getMachineStorageKey(storeId?: string): string {
  const effectiveStoreId =
    storeId && storeId !== "default" ? storeId : getActiveStoreId();
  if (!effectiveStoreId) {
    return `${STORAGE_KEY_PREFIX}_unscoped`;
  }
  return `${STORAGE_KEY_PREFIX}_${effectiveStoreId}`;
}

export const DEFAULT_MACHINES: PosMachine[] = [];

/**
 * Returns cached POS machines synchronously from localStorage.
 * If no machines were created for this store yet, returns an empty array [].
 */
export function getStoredMachines(storeId?: string): PosMachine[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const key = getMachineStorageKey(storeId);
    const raw = window.localStorage.getItem(key);

    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Purge legacy demo mock machines (mach-1, mach-2) if they were artificially seeded in previous sessions
      const sanitized = parsed.filter(
        (m: Partial<PosMachine>) =>
          !(m.id === "mach-1" && m.terminalId === "FAWRY-POS-01") &&
          !(m.id === "mach-2" && m.terminalId === "AMAN-POS-02"),
      );

      return sanitized.map((m: Partial<PosMachine>) => ({
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
    return [];
  } catch {
    return [];
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
    return [];
  }

  try {
    const res = await fetch("/api/machines");
    if (!res.ok) {
      return getStoredMachines(storeId);
    }
    const data = await res.json();
    if (Array.isArray(data.machines)) {
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

/**
 * Deducts balance from a POS machine upon executing a bill or service sale.
 */
export async function deductRemoteMachineBalance(
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
    const res = await fetch("/api/machines/deduct", {
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
      return await fetchStoreMachines(storeId);
    } else {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || "فشل خصم رصيد الماكينة");
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("غير كافٍ")) {
      throw err;
    }
    console.error("Remote deduct failed, falling back to local:", err);
  }

  return deductMachineBalance(machineId, amountPiasters, params, storeId);
}

/**
 * Synchronous local deduction fallback
 */
export function deductMachineBalance(
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
  const target = current.find((m) => m.id === machineId);
  if (!target) {
    throw new Error("ماكينة الدفع غير موجودة");
  }

  if ((target.currentBalancePiasters || 0) < amountPiasters) {
    throw new Error(
      `رصيد ماكينة ${target.name} غير كافٍ. المتاح: ${((target.currentBalancePiasters || 0) / 100).toFixed(2)} ج.م والمطلوب: ${(amountPiasters / 100).toFixed(2)} ج.م`,
    );
  }

  const updated = current.map((m) => {
    if (m.id !== machineId) return m;
    const newBalance = (m.currentBalancePiasters || 0) - amountPiasters;
    const tx: BalanceTransaction = {
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "withdrawal",
      amountPiasters: -amountPiasters,
      balanceAfterPiasters: newBalance,
      source: params?.source?.trim() || "تنفيذ عملية بيع خدمة / شحن",
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

/**
 * Key for storing service-to-machine links (supports multiple machines per service).
 */
export function getServiceMachinesKey(storeId?: string): string {
  const effectiveStoreId =
    storeId && storeId !== "default" ? storeId : getActiveStoreId();
  if (!effectiveStoreId) {
    return "hesba_service_machines_unscoped";
  }
  return `hesba_service_machines_${effectiveStoreId}`;
}

/**
 * Retrieves machine IDs linked to a given service/card product.
 */
export function getServiceLinkedMachineIds(
  productId: string,
  storeId?: string,
): string[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(getServiceMachinesKey(storeId));
    if (!raw) return [];
    const mapping = JSON.parse(raw);
    const entry = mapping[productId];
    if (Array.isArray(entry)) return entry.filter(Boolean);
    if (typeof entry === "string" && entry) return [entry];
    return [];
  } catch {
    return [];
  }
}

/**
 * Sets machine IDs linked to a given service/card product.
 */
export function setServiceLinkedMachineIds(
  productId: string,
  machineIds: string[],
  storeId?: string,
): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const key = getServiceMachinesKey(storeId);
    const raw = window.localStorage.getItem(key);
    const mapping: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    mapping[productId] = machineIds.filter(Boolean);
    window.localStorage.setItem(key, JSON.stringify(mapping));
    window.dispatchEvent(new Event("hesba_service_machines_updated"));
  } catch (err) {
    console.error("Failed to persist service machines link:", err);
  }
}
