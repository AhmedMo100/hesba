"use client";

import React, { useState } from "react";
import viewStyles from "./ViewLayout.module.css";
import { Empty, Button } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function AiView() {
  const [input, setInput] = useState("");

  return (
    <div className={viewStyles.view} data-testid="page-ai">
      <div className={viewStyles.phead}>
        <div>
          <h1>{t("pages.ai.title")}</h1>
        </div>
      </div>
      <div className={viewStyles.card}>
        <Empty icon="sparkle" title={t("pages.ai.empty")} />
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("pages.ai.placeholder")}
            style={{
              flex: 1,
              padding: "12px 14px",
              border: "1.5px solid var(--line)",
              borderRadius: "14px",
              background: "var(--sf)",
              color: "var(--ink)",
            }}
          />
          <Button icon="send">{t("common.save")}</Button>
        </div>
      </div>
    </div>
  );
}

export default AiView;
