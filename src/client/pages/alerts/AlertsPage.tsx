"use client";

import React from "react";
import pageStyles from "../PageLayout.module.css";
import { Empty } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function AlertsPage() {
  return (
    <div className={pageStyles.page} data-testid="page-alerts">
      <div className={pageStyles.phead}>
        <div>
          <h1>{t("pages.alerts.title")}</h1>
        </div>
      </div>
      <div className={pageStyles.card}>
        <Empty icon="bell" title={t("pages.alerts.empty")} />
      </div>
    </div>
  );
}
