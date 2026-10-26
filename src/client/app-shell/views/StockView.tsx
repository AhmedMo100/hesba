"use client";

import React from "react";
import viewStyles from "./ViewLayout.module.css";
import { Empty, Button } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function StockView() {
  return (
    <div className={viewStyles.view} data-testid="page-stock">
      <div className={viewStyles.phead}>
        <div>
          <h1>{t("pages.stock.title")}</h1>
        </div>
        <div className={viewStyles.pact}>
          <Button icon="plus">{t("pages.stock.addGoods")}</Button>
        </div>
      </div>
      <div className={viewStyles.card}>
        <Empty icon="layers" title={t("pages.stock.empty")} />
      </div>
    </div>
  );
}

export default StockView;
