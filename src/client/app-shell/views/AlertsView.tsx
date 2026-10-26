"use client";

import React from "react";
import viewStyles from "./ViewLayout.module.css";
import { Empty } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function AlertsView() {
  return (
    <div className={viewStyles.view} data-testid="page-alerts">
      <div className={viewStyles.phead}>
        <div>
          <h1>{t("pages.alerts.title")}</h1>
        </div>
      </div>
      <div className={viewStyles.card}>
        <Empty icon="bell" title={t("pages.alerts.empty")} />
      </div>
    </div>
  );
}

export default AlertsView;
