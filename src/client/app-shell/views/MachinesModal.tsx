"use client";

import React, { useState } from "react";
import { Modal, Button, Field, Icon } from "../../shared/ui";

export interface PosMachine {
  id: string;
  name: string; // e.g. "ماكينة فوري كاشير 1"
  provider: string; // e.g. "فوري", "أمان", "مصاري", "بي", "ممكن"
  terminalId?: string; // e.g. "POS-1049"
  status: "active" | "inactive" | "maintenance";
  notes?: string;
  createdAt: string;
}

export const KNOWN_PROVIDERS = [
  "فوري (Fawry)",
  "أمان (Aman)",
  "مصاري (Masary)",
  "بي (Bee)",
  "سداد (Sadad)",
  "ممكن (Momken)",
  "إنستاباي (InstaPay)",
  "فودافون كاش (Vodafone Cash)",
  "أخرى (مزود مخصص)",
];

export interface MachinesModalProps {
  storeId?: string;
  onClose: () => void;
  onMachinesUpdated?: (machines: PosMachine[]) => void;
}

export function MachinesModal({
  storeId = "default",
  onClose,
  onMachinesUpdated,
}: MachinesModalProps) {
  const storageKey = `hesba_pos_machines_${storeId}`;

  const [machines, setMachines] = useState<PosMachine[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
      const defaultMachines: PosMachine[] = [
        {
          id: "mach-1",
          name: "ماكينة فوري الرئيسية",
          provider: "فوري (Fawry)",
          terminalId: "FAWRY-POS-01",
          status: "active",
          notes:
            "ماكينة الكاشير الأساسية لخدمات الدفع وفواتير الكهرباء والإنترنت",
          createdAt: new Date().toISOString(),
        },
      ];
      localStorage.setItem(storageKey, JSON.stringify(defaultMachines));
      return defaultMachines;
    } catch {
      return [];
    }
  });

  const [isAdding, setIsAdding] = useState(false);
  const [editingMachine, setEditingMachine] = useState<PosMachine | null>(null);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<string>(
    KNOWN_PROVIDERS[0] || "فوري (Fawry)",
  );
  const [customProvider, setCustomProvider] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "maintenance">(
    "active",
  );
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const saveMachinesList = (updated: PosMachine[]) => {
    setMachines(updated);
    try {
      localStorage.setItem(storageKey, JSON.stringify(updated));
    } catch {
      // Storage unavailable
    }
    if (onMachinesUpdated) {
      onMachinesUpdated(updated);
    }
  };

  const handleOpenAdd = () => {
    setName("");
    setProvider(KNOWN_PROVIDERS[0] || "فوري (Fawry)");
    setCustomProvider("");
    setTerminalId("");
    setStatus("active");
    setNotes("");
    setError(null);
    setEditingMachine(null);
    setIsAdding(true);
  };

  const handleOpenEdit = (m: PosMachine) => {
    setEditingMachine(m);
    setName(m.name);
    if (KNOWN_PROVIDERS.includes(m.provider)) {
      setProvider(m.provider);
      setCustomProvider("");
    } else {
      setProvider("أخرى (مزود مخصص)");
      setCustomProvider(m.provider);
    }
    setTerminalId(m.terminalId || "");
    setStatus(m.status);
    setNotes(m.notes || "");
    setError(null);
    setIsAdding(true);
  };

  const handleDelete = (id: string) => {
    if (window.confirm("هل أنت متأكد من حذف هذه الماكينة؟")) {
      const updated = machines.filter((m) => m.id !== id);
      saveMachinesList(updated);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("اسم الماكينة مطلوب");
      return;
    }

    const resolvedProvider: string =
      (provider === "أخرى (مزود مخصص)" ? customProvider.trim() : provider) ||
      "مزود مخصص";

    if (editingMachine) {
      const updated: PosMachine[] = machines.map((m) =>
        m.id === editingMachine.id
          ? {
              ...m,
              name: name.trim(),
              provider: resolvedProvider,
              terminalId: terminalId.trim() || undefined,
              status,
              notes: notes.trim() || undefined,
            }
          : m,
      );
      saveMachinesList(updated);
    } else {
      const newMachine: PosMachine = {
        id: `mach-${Date.now()}`,
        name: name.trim(),
        provider: resolvedProvider,
        terminalId: terminalId.trim() || undefined,
        status,
        notes: notes.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      saveMachinesList([...machines, newMachine]);
    }

    setIsAdding(false);
    setEditingMachine(null);
  };

  return (
    <Modal
      title={
        isAdding
          ? editingMachine
            ? "تعديل ماكينة دفع"
            : "إضافة ماكينة دفع جديدة"
          : "ماكينات الدفع ومزودو الخدمة"
      }
      onClose={isAdding ? () => setIsAdding(false) : onClose}
      footer={
        <div style={{ display: "flex", gap: 10, width: "100%" }}>
          {isAdding ? (
            <>
              <Button
                kind="primary"
                size="lg"
                type="button"
                onClick={handleSubmit}
                style={{ flex: 1 }}
              >
                {editingMachine ? "حفظ التعديلات" : "إضافة الماكينة"}
              </Button>
              <Button
                kind="soft"
                size="lg"
                type="button"
                onClick={() => setIsAdding(false)}
              >
                إلغاء
              </Button>
            </>
          ) : (
            <>
              <Button
                kind="primary"
                size="lg"
                type="button"
                onClick={handleOpenAdd}
                style={{ flex: 1 }}
              >
                + إضافة ماكينة دفع
              </Button>
              <Button kind="soft" size="lg" type="button" onClick={onClose}>
                إغلاق
              </Button>
            </>
          )}
        </div>
      }
    >
      {isAdding ? (
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          {error && (
            <div
              style={{
                color: "var(--red, #cf3c3c)",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {error}
            </div>
          )}

          <Field label="اسم أو لقب الماكينة في المحل">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: ماكينة فوري كاشير 1"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1.5px solid var(--line)",
                fontSize: 14,
                boxSizing: "border-box",
              }}
              autoFocus
            />
          </Field>

          <Field label="مزود الخدمة أو الشبكة">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1.5px solid var(--line)",
                fontSize: 14,
                boxSizing: "border-box",
                background: "var(--card-bg, #1e241e)",
                color: "var(--ink)",
              }}
            >
              {KNOWN_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>

          {provider === "أخرى (مزود مخصص)" && (
            <Field label="اسم المزود المخصص">
              <input
                type="text"
                value={customProvider}
                onChange={(e) => setCustomProvider(e.target.value)}
                placeholder="اكتب اسم المزود أو الشركة..."
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1.5px solid var(--line)",
                  fontSize: 14,
                  boxSizing: "border-box",
                }}
              />
            </Field>
          )}

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
          >
            <Field label="معرف / رقم الجهاز (اختياري)">
              <input
                type="text"
                value={terminalId}
                onChange={(e) => setTerminalId(e.target.value)}
                placeholder="مثال: POS-9482"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1.5px solid var(--line)",
                  fontSize: 14,
                  boxSizing: "border-box",
                }}
              />
            </Field>

            <Field label="حالة الماكينة">
              <select
                value={status}
                onChange={(e) =>
                  setStatus(
                    e.target.value as "active" | "inactive" | "maintenance",
                  )
                }
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1.5px solid var(--line)",
                  fontSize: 14,
                  boxSizing: "border-box",
                  background: "var(--card-bg, #1e241e)",
                  color: "var(--ink)",
                }}
              >
                <option value="active">جاهزة ونشطة ✓</option>
                <option value="inactive">غير مفعلة</option>
                <option value="maintenance">تحت الصيانة</option>
              </select>
            </Field>
          </div>

          <Field label="ملاحظات اختيارية">
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: شريحة فودافون، مكان الجهاز بجوار الكاشير الرئيسي..."
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 10,
                border: "1.5px solid var(--line)",
                fontSize: 13,
                boxSizing: "border-box",
                resize: "none",
              }}
            />
          </Field>

          {/* Regulatory security disclaimer */}
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(224, 140, 36, 0.08)",
              border: "1px solid rgba(224, 140, 36, 0.25)",
              borderRadius: 10,
              fontSize: 12,
              color: "var(--ink2)",
              lineHeight: 1.5,
            }}
          >
            🔒 <b>حماية الأمان والخصوصية:</b> نظام حِسبة لا يطلب ولا يخزن أي
            أرقام سرية (PIN) أو رموز تأكيد (OTP) أو كلمات مرور خاصة بماكينات
            الدفع والشبكات.
          </div>
        </form>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--ink2)",
              lineHeight: 1.5,
            }}
          >
            قائمة ماكينات الدفع الإلكتروني (POS) وأجهزة التحصيل المتاحة في محلك
            لربط فواتير الإنترنت، شحن كروت الكهرباء، وتحويل الأموال بها:
          </p>

          {machines.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "30px 10px",
                color: "var(--ink2)",
                fontSize: 13.5,
              }}
            >
              لا توجد ماكينات دفع مسجلة حالياً. اضغط بالأسفل لإضافة أول ماكينة.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {machines.map((m) => (
                <div
                  key={m.id}
                  style={{
                    background: "var(--sf2, #fbf7ef)",
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    padding: "12px 14px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <b style={{ fontSize: 14.5, color: "var(--ink)" }}>
                        {m.name}
                      </b>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 6,
                          background:
                            m.status === "active"
                              ? "rgba(16, 142, 92, 0.12)"
                              : m.status === "maintenance"
                                ? "rgba(224, 140, 36, 0.12)"
                                : "rgba(120, 120, 120, 0.12)",
                          color:
                            m.status === "active"
                              ? "#108e5c"
                              : m.status === "maintenance"
                                ? "#e08c24"
                                : "var(--ink2)",
                        }}
                      >
                        {m.status === "active"
                          ? "نشطة"
                          : m.status === "maintenance"
                            ? "صيانة"
                            : "معطلة"}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, color: "var(--ink2)" }}>
                      مزود الخدمة: <b>{m.provider}</b>
                      {m.terminalId && <span> | المعرف: {m.terminalId}</span>}
                    </div>

                    {m.notes && (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--ink2)",
                          opacity: 0.85,
                        }}
                      >
                        {m.notes}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(m)}
                      title="تعديل الماكينة"
                      style={{
                        background: "var(--sf)",
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontSize: 12,
                        cursor: "pointer",
                        color: "var(--ink)",
                      }}
                    >
                      تعديل
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(m.id)}
                      title="حذف الماكينة"
                      style={{
                        background: "rgba(207, 60, 60, 0.08)",
                        border: "1px solid rgba(207, 60, 60, 0.2)",
                        borderRadius: 8,
                        padding: "6px 8px",
                        fontSize: 12,
                        cursor: "pointer",
                        color: "var(--red, #cf3c3c)",
                      }}
                    >
                      <Icon n="trash" s={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default MachinesModal;
