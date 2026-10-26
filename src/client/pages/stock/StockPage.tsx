"use client";

import React from "react";
import pageStyles from "../PageLayout.module.css";
import { Empty, Button } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function StockPage() {
  return (
    <div className={pageStyles.page} data-testid="page-stock">
      <div className={pageStyles.phead}>
        <div>
          <h1>{t("pages.stock.title")}</h1>
        </div>
        <div className={pageStyles.pact}>
          <Button icon="plus">{t("pages.stock.addGoods")}</Button>
        </div>
      </div>
      <div className={pageStyles.card}>
        <Empty icon="layers" title={t("pages.stock.empty")} />
      </div>
    </div>
  );
}
