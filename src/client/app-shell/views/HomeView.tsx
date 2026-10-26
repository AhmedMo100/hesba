"use client";

import React from "react";
import viewStyles from "./ViewLayout.module.css";
import { Empty } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function HomeView() {
  return (
    <div className={viewStyles.view} data-testid="page-home">
      <div className={viewStyles.phead}>
        <div>
          <h1>{t("pages.home.title")}</h1>
        </div>
      </div>
      <div className={viewStyles.card}>
        <Empty icon="chart" title={t("pages.home.empty")} />
      </div>
    </div>
  );
}

export default HomeView;
