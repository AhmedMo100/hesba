"use client";

import React, { useState } from "react";
import {
  Button,
  Field,
  Input,
  Num,
  SearchBox,
  Seg,
  Modal,
  ToastProvider,
  useToast,
  Chip,
  Chips,
  type SegOption,
} from "@/client/shared/ui";
import { SyncBar } from "@/client/app-shell/SyncBar";
import { t } from "@/client/shared/i18n";

function PlaygroundContent() {
  const toast = useToast();
  const [searchValue, setSearchValue] = useState("");
  const [numValue, setNumValue] = useState("15.5");
  const [textValue, setTextValue] = useState("");
  const [segValue, setSegValue] = useState("day");
  const [activeChip, setActiveChip] = useState("all");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const segOptions: SegOption[] = [
    ["day", t("dev.segOpt1"), "clock"],
    ["week", t("dev.segOpt2"), "cal"],
    ["month", t("dev.segOpt3"), "chart"],
  ];

  return (
    <div
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "24px 16px 80px",
        display: "flex",
        flexDirection: "column",
        gap: 32,
      }}
      dir="rtl"
    >
      <header>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>
          {t("dev.title")}
        </h1>
        <p style={{ color: "var(--ink2)" }}>{t("dev.subtitle")}</p>
      </header>

      {/* SyncBar Showcase */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>SyncBar</h2>
        <SyncBar state="synced" />
        <SyncBar state="syncing" />
        <SyncBar state="offline" pendingCount={3} />
      </section>

      {/* Buttons Showcase */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>{t("dev.buttons")}</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Button kind="primary">{t("dev.primaryBtn")}</Button>
          <Button kind="ghost">{t("dev.ghostBtn")}</Button>
          <Button kind="soft">{t("dev.softBtn")}</Button>
          <Button kind="danger">{t("dev.dangerBtn")}</Button>
          <Button kind="dangerghost">{t("common.delete")}</Button>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <Button size="sm" icon="plus">
            {t("dev.smBtn")}
          </Button>
          <Button size="md" icon="check">
            {t("common.save")}
          </Button>
          <Button size="lg" icon="cart">
            {t("dev.lgBtn")}
          </Button>
          <Button loading>{t("common.loading")}</Button>
          <Button disabled>{t("common.cancel")}</Button>
        </div>
      </section>

      {/* Inputs & Num Showcase */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>{t("dev.inputs")}</h2>
        <Field label={t("dev.fieldLabel")} hint={t("dev.fieldHint")}>
          <Input
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            placeholder={t("dev.fieldPlaceholder")}
          />
        </Field>
        <Field label={t("dev.fieldLabel")} err={t("dev.fieldError")}>
          <Input value="invalid text" onChange={() => {}} />
        </Field>
        <Field label={t("dev.numLabel")} hint="100 piasters = 1 EGP">
          <Num
            value={numValue}
            onChange={setNumValue}
            suffix={t("common.currency")}
            placeholder="0"
          />
        </Field>
      </section>

      {/* SearchBox Showcase */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>{t("dev.search")}</h2>
        <SearchBox
          value={searchValue}
          onChange={setSearchValue}
          sampleVoiceText={t("dev.toastSold")}
        />
      </section>

      {/* Seg Showcase */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>{t("dev.seg")}</h2>
        <Seg value={segValue} onChange={setSegValue} options={segOptions} />
      </section>

      {/* Chips Showcase */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>{t("dev.chips")}</h2>
        <Chips>
          <Chip
            active={activeChip === "all"}
            onClick={() => setActiveChip("all")}
          >
            {t("dev.chip1")}
          </Chip>
          <Chip
            active={activeChip === "drinks"}
            onClick={() => setActiveChip("drinks")}
          >
            {t("dev.chip2")}
          </Chip>
          <Chip
            active={activeChip === "groceries"}
            onClick={() => setActiveChip("groceries")}
          >
            {t("dev.chip3")}
          </Chip>
          <Chip
            active={activeChip === "detergents"}
            onClick={() => setActiveChip("detergents")}
          >
            {t("dev.chip4")}
          </Chip>
          <Chip isStatic>{t("common.piece")}</Chip>
        </Chips>
      </section>

      {/* Toast Showcase */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>{t("dev.toast")}</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Button
            kind="soft"
            onClick={() =>
              toast.show({
                msg: t("dev.toastSuccess"),
                kind: "ok",
              })
            }
          >
            {t("dev.showToastOk")}
          </Button>
          <Button
            kind="dangerghost"
            onClick={() =>
              toast.show({
                msg: t("dev.toastError"),
                kind: "err",
              })
            }
          >
            {t("dev.showToastErr")}
          </Button>
          <Button
            kind="primary"
            onClick={() =>
              toast.show({
                msg: t("dev.toastSold"),
                kind: "ok",
                undo: () => {
                  toast.show({ msg: t("common.undo"), kind: "ok" });
                },
              })
            }
          >
            {t("dev.showToastUndo")}
          </Button>
        </div>
      </section>

      {/* Modal / Sheet Showcase */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>{t("dev.modal")}</h2>
        <Button kind="ghost" onClick={() => setIsModalOpen(true)}>
          {t("dev.openModal")}
        </Button>
      </section>

      {isModalOpen && (
        <Modal
          title={t("dev.openModal")}
          onClose={() => setIsModalOpen(false)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setIsModalOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                kind="primary"
                onClick={() => {
                  toast.show({ msg: t("dev.toastSuccess") });
                  setIsModalOpen(false);
                }}
              >
                {t("common.confirm")}
              </Button>
            </>
          }
        >
          <p style={{ lineHeight: 1.8 }}>{t("dev.modalContent")}</p>
          <div style={{ marginTop: 16 }}>
            <Field label={t("dev.fieldLabel")}>
              <Input placeholder={t("dev.fieldPlaceholder")} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function DevUiClient() {
  return (
    <ToastProvider>
      <PlaygroundContent />
    </ToastProvider>
  );
}
