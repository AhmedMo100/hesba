"use client";

import React, { useState, useEffect } from "react";
import styles from "./ProfileModal.module.css";
import { Modal, Button, Field, useToast, Icon } from "../ui";
import { useTranslation } from "../i18n";
import { authApi } from "../api";
import type { StoreProfile, PasskeyInfo } from "../api";
import {
  GOVERNORATES,
  SHOP_TYPES,
  normDigits,
  okMail,
  okPhone,
} from "./AuthScreen";

export interface ProfileModalProps {
  onClose: () => void;
  onProfileUpdated?: (profile: StoreProfile) => void;
}

export function ProfileModal({ onClose, onProfileUpdated }: ProfileModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [pinEnabled, setPinEnabled] = useState(false);

  const [profile, setProfile] = useState<StoreProfile>({
    ownerName: "مجدي أحمد (TEST)",
    phone: "01012345678",
    email: "magdi.test@hesba.app",
    emailVerified: true,
    storeName: "سوبر ماركت البركة (TEST)",
    shopType: "سوبر ماركت",
    governorate: "القاهرة",
    area: "المعادي (TEST)",
    openedOn: "2020-01-01",
    workersCount: 2,
  });

  useEffect(() => {
    authApi.getSession().then((session) => {
      if (session) {
        setProfile({
          ownerName: session.user.name,
          phone: session.user.phone,
          email: session.user.email,
          emailVerified: session.user.emailVerified ?? true,
          storeName: session.store.name,
          shopType: session.store.shopType,
          governorate: session.store.governorate,
          area: session.store.area || "",
          openedOn: session.store.openedOn,
          workersCount: session.store.workersCount,
        });
        setPinEnabled(Boolean(session.pinEnabled));
      }
    });

    authApi.listPasskeys().then((res) => {
      if (res.success && res.data) {
        setPasskeys(res.data);
      }
    });
  }, []);

  const update = (patch: Partial<StoreProfile>) => {
    setProfile((prev) => ({ ...prev, ...patch }));
    setFieldErrors({});
    setServerError("");
  };

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (profile.ownerName.trim().length < 2) {
      errs["owner"] = t("errors.writeName");
    }
    if (!okPhone(profile.phone)) {
      errs["phone"] = t("errors.invalidPhone");
    }
    if (!okMail(profile.email)) {
      errs["email"] = t("errors.invalidEmail");
    }
    if (!profile.storeName.trim()) {
      errs["storeName"] = t("errors.writeStoreName");
    }
    if (!profile.openedOn) {
      errs["opened"] = t("errors.chooseOpenedDate");
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    setServerError("");
    try {
      const res = await authApi.updateProfile({
        ...profile,
        phone: normDigits(profile.phone).replace(/\s|-/g, ""),
        email: profile.email.trim().toLowerCase(),
      });

      if (!res.success || !res.data) {
        setServerError(res.error || t("errors.serverError"));
        return;
      }

      toast.show({ msg: t("profile.saveSuccess") });
      onProfileUpdated?.(res.data);
      onClose();
    } catch {
      setServerError(t("errors.serverError"));
    } finally {
      setBusy(false);
    }
  };

  const handleAddPasskey = async () => {
    setBusy(true);
    try {
      const res = await authApi.completePasskeyRegistration({
        id: `passkey-device-${Date.now()}-TEST`,
        rawId: `raw-device-${Date.now()}-TEST`,
        type: "public-key",
        response: { clientDataJSON: "eyJjaGFsbGVuZ2UiOiJ0ZXN0In0=" },
      });

      if (res.success) {
        const updatedList = await authApi.listPasskeys();
        if (updatedList.success && updatedList.data) {
          setPasskeys(updatedList.data);
        }
        toast.show({ msg: t("auth.passkeySuccessTitle") });
      } else {
        setServerError(res.error || t("errors.passkeyFailed"));
      }
    } catch {
      setServerError(t("errors.passkeyFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePin = async () => {
    const next = !pinEnabled;
    await authApi.setPin(next ? "123456" : null);
    setPinEnabled(next);
  };

  return (
    <Modal
      title={t("profile.title")}
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button icon="check" disabled={busy} onClick={handleSave}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      {serverError && <div className={styles.serverErr}>{serverError}</div>}

      <div className={styles.secMini}>{t("profile.ownerSection")}</div>
      <Field label={t("auth.ownerLabel")} err={fieldErrors["owner"]}>
        <input
          value={profile.ownerName}
          onChange={(e) => update({ ownerName: e.target.value })}
        />
      </Field>

      <div className={styles.row2}>
        <Field label={t("auth.phoneLabel")} err={fieldErrors["phone"]}>
          <input
            dir="ltr"
            className="ltr"
            inputMode="tel"
            value={profile.phone}
            onChange={(e) => update({ phone: e.target.value })}
          />
        </Field>
        <Field label={t("auth.emailLabel")} err={fieldErrors["email"]}>
          <div style={{ position: "relative" }}>
            <input
              dir="ltr"
              className="ltr"
              inputMode="email"
              value={profile.email}
              onChange={(e) => update({ email: e.target.value })}
            />
            <span
              style={{
                position: "absolute",
                left: "8px",
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: "11px",
                padding: "2px 6px",
                borderRadius: "6px",
                background: profile.emailVerified
                  ? "color-mix(in srgb, var(--green, #2ecc71) 15%, var(--sf))"
                  : "var(--sf2)",
                color: profile.emailVerified
                  ? "var(--green, #2ecc71)"
                  : "var(--ink2)",
              }}
            >
              {profile.emailVerified
                ? t("profile.verifiedEmailBadge")
                : t("profile.unverifiedEmailBadge")}
            </span>
          </div>
        </Field>
      </div>

      <div className={styles.secMini}>{t("profile.securitySection")}</div>
      <div
        style={{
          background: "var(--sf2)",
          border: "1px solid var(--line)",
          borderRadius: "14px",
          padding: "14px",
          marginBottom: "16px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "10px",
          }}
        >
          <span style={{ fontSize: "13.5px", fontWeight: 700 }}>
            {t("profile.passkeysListTitle")}
          </span>
          <span style={{ fontSize: "12px", color: "var(--ink2)" }}>
            {passkeys.length}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {passkeys.map((pk) => (
            <div
              key={pk.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "var(--sf)",
                padding: "8px 12px",
                borderRadius: "10px",
                border: "1px solid var(--line)",
                fontSize: "13px",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <Icon n="check" s={14} />
                <span>{pk.label}</span>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleAddPasskey}
          style={{
            background: "none",
            border: "none",
            color: "var(--br)",
            fontSize: "13px",
            fontWeight: 600,
            marginTop: "12px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          + {t("profile.addPasskeyBtn")}
        </button>
      </div>

      <div
        style={{
          background: "var(--sf2)",
          border: "1px solid var(--line)",
          borderRadius: "14px",
          padding: "12px 14px",
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <b style={{ display: "block", fontSize: "13.5px" }}>
            {t("profile.pinLockToggle")}
          </b>
          <small style={{ color: "var(--ink2)", fontSize: "11.5px" }}>
            {t("profile.pinLockDesc")}
          </small>
        </div>
        <input
          type="checkbox"
          checked={pinEnabled}
          onChange={handleTogglePin}
          style={{ width: "20px", height: "20px", accentColor: "var(--br)" }}
        />
      </div>

      <div className={styles.secMini}>{t("profile.storeSection")}</div>
      <Field label={t("auth.storeNameLabel")} err={fieldErrors["storeName"]}>
        <input
          value={profile.storeName}
          onChange={(e) => update({ storeName: e.target.value })}
        />
      </Field>

      <div>
        <div className={styles.fieldLabel}>{t("auth.shopTypeLabel")}</div>
        <div className={styles.chipsWrap}>
          {SHOP_TYPES.map((type) => (
            <button
              type="button"
              key={type}
              className={`${styles.chip} ${profile.shopType === type ? styles.on : ""}`}
              onClick={() => update({ shopType: type })}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.row2}>
        <Field label={t("auth.governorateLabel")}>
          <select
            value={profile.governorate}
            onChange={(e) => update({ governorate: e.target.value })}
          >
            {GOVERNORATES.map((gov) => (
              <option key={gov} value={gov}>
                {gov}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("auth.areaLabel")}>
          <input
            value={profile.area}
            onChange={(e) => update({ area: e.target.value })}
          />
        </Field>
      </div>

      <div className={styles.row2}>
        <Field label={t("auth.openedDateLabel")} err={fieldErrors["opened"]}>
          <input
            type="date"
            value={profile.openedOn}
            onChange={(e) => update({ openedOn: e.target.value })}
          />
        </Field>

        <Field label={t("auth.workersCountLabel")}>
          <div className={styles.stepper}>
            <button
              type="button"
              aria-label="أقل"
              onClick={() =>
                update({
                  workersCount: Math.max(0, profile.workersCount - 1),
                })
              }
            >
              −
            </button>
            <b>{profile.workersCount}</b>
            <button
              type="button"
              aria-label="أكتر"
              onClick={() =>
                update({
                  workersCount: Math.min(99, profile.workersCount + 1),
                })
              }
            >
              +
            </button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}
