"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "./ProfileModal.module.css";
import {
  Modal,
  Button,
  Field,
  useToast,
  Alert,
  Chip,
  Chips,
  Icon,
} from "@/client/shared/ui";
import { useTranslation } from "@/client/shared/i18n";
import { authApi } from "@/client/shared/api";
import type { StoreProfile } from "@/client/shared/api";
import { useAuth } from "@/client/shared/auth";
import { MAX_PERSON_NAME_LENGTH } from "@/domain/limits";
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

/**
 * The stored phone is canonical `+20…` (what login looks up); the form shows and validates
 * the local `01…` form the owner types. The server normalizes it back (QA-11).
 */
function toLocalPhone(phone: string): string {
  return phone.startsWith("+20") ? `0${phone.slice(3)}` : phone;
}

export function ProfileModal({ onClose, onProfileUpdated }: ProfileModalProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();
  const { setSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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
          phone: toLocalPhone(session.user.phone),
          email: session.user.email,
          emailVerified: session.user.emailVerified ?? true,
          storeName: session.store.name,
          shopType: session.store.shopType,
          governorate: session.store.governorate,
          area: session.store.area || "",
          openedOn: session.store.openedOn,
          workersCount: session.store.workersCount,
        });
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
    } else if (profile.ownerName.trim().length > MAX_PERSON_NAME_LENGTH) {
      errs["owner"] = t("errors.nameTooLong", { max: MAX_PERSON_NAME_LENGTH });
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

      // Show what the server saved (e.g. the phone in its +20… form) everywhere the session
      // is used, such as the header's store name (QA-11).
      setProfile({ ...res.data, phone: toLocalPhone(res.data.phone) });
      const refreshed = await authApi.getSession();
      if (refreshed) setSession(refreshed);
      toast.show({ msg: t("profile.saveSuccess") });
      onProfileUpdated?.(res.data);
      onClose();
    } catch {
      setServerError(t("errors.serverError"));
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeOtherSessions = async () => {
    setBusy(true);
    try {
      const res = await authApi.revokeOtherSessions();
      if (res.success) {
        toast.show({ msg: t("profile.revokeOtherSessionsSuccess") });
      } else {
        toast.show({ msg: res.error || t("errors.serverError"), kind: "err" });
      }
    } catch {
      toast.show({ msg: t("errors.serverError"), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    await authApi.logout();
    onClose();
    router.push("/");
  };

  return (
    <Modal
      title={t("profile.title")}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            icon="check"
            disabled={busy}
            busy={busy}
            onClick={handleSave}
            data-testid="profile-save"
          >
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </>
      }
    >
      <div className={styles.form} data-testid="profile-form">
        {serverError && (
          <Alert kind="error" onClose={() => setServerError("")}>
            {serverError}
          </Alert>
        )}

        <section className={styles.card}>
          <h3 className={styles.cardTitle}>
            <Icon n="users" s={17} />
            {t("profile.ownerSection")}
          </h3>
          <Field label={t("auth.ownerLabel")} err={fieldErrors["owner"]}>
            <input
              autoComplete="name"
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
                autoComplete="tel"
                value={profile.phone}
                onChange={(e) => update({ phone: e.target.value })}
              />
            </Field>
            <Field
              label={t("auth.emailLabel")}
              err={fieldErrors["email"]}
              hint={
                profile.emailVerified
                  ? `✓ ${t("profile.verifiedEmailBadge")}`
                  : t("profile.unverifiedEmailBadge")
              }
            >
              <input
                dir="ltr"
                className="ltr"
                inputMode="email"
                autoComplete="email"
                value={profile.email}
                onChange={(e) => update({ email: e.target.value })}
              />
            </Field>
          </div>
        </section>

        <section className={styles.card}>
          <h3 className={styles.cardTitle}>
            <Icon n="store" s={17} />
            {t("profile.storeSection")}
          </h3>
          <Field
            label={t("auth.storeNameLabel")}
            err={fieldErrors["storeName"]}
          >
            <input
              value={profile.storeName}
              onChange={(e) => update({ storeName: e.target.value })}
            />
          </Field>

          <div
            className={styles.group}
            role="group"
            aria-label={t("auth.shopTypeLabel")}
          >
            <span className={styles.groupLabel}>{t("auth.shopTypeLabel")}</span>
            <Chips tight>
              {SHOP_TYPES.map((type) => (
                <Chip
                  key={type}
                  active={profile.shopType === type}
                  onClick={() => update({ shopType: type })}
                >
                  {type}
                </Chip>
              ))}
            </Chips>
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
            <Field
              label={t("auth.openedDateLabel")}
              err={fieldErrors["opened"]}
            >
              <input
                type="date"
                value={profile.openedOn}
                onChange={(e) => update({ openedOn: e.target.value })}
              />
            </Field>
            {/* A div, not a label: a label would press the first stepper button on tap. */}
            <Field label={t("auth.workersCountLabel")} div>
              <div className={styles.stepper}>
                <button
                  type="button"
                  aria-label="أقل"
                  onClick={() =>
                    update({
                      workersCount: Math.max(1, profile.workersCount - 1),
                    })
                  }
                >
                  −
                </button>
                <b aria-live="polite">{profile.workersCount}</b>
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
        </section>

        <section className={styles.card}>
          <h3 className={styles.cardTitle}>
            <Icon n="lock" s={17} />
            {t("profile.securitySection")}
          </h3>
          <div className={styles.securityRow}>
            <div>
              <b>{t("profile.revokeOtherSessions")}</b>
              <small>{t("profile.revokeOtherSessionsDesc")}</small>
            </div>
            <Button
              size="sm"
              kind="soft"
              disabled={busy}
              onClick={handleRevokeOtherSessions}
            >
              {t("common.confirm")}
            </Button>
          </div>
        </section>

        <Button kind="dangerghost" wide onClick={handleLogout} disabled={busy}>
          {t("profile.logout")}
        </Button>
      </div>
    </Modal>
  );
}
