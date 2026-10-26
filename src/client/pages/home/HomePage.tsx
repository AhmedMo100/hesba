"use client";

import React from "react";
import pageStyles from "../PageLayout.module.css";
import { Empty } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function HomePage() {
  return (
    <div className={pageStyles.page} data-testid="page-home">
      <div className={pageStyles.phead}>
        <div>
          <h1>{t("pages.home.title")}</h1>
        </div>
      </div>
      <div className={pageStyles.card}>
        <Empty icon="chart" title={t("pages.home.empty")} />
      </div>
    </div>
  );
}
