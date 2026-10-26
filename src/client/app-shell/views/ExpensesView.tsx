"use client";

import React from "react";
import viewStyles from "./ViewLayout.module.css";
import { Empty, Button } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function ExpensesView() {
  return (
    <div className={viewStyles.view} data-testid="page-expenses">
      <div className={viewStyles.phead}>
        <div>
          <h1>{t("pages.expenses.title")}</h1>
        </div>
        <div className={viewStyles.pact}>
          <Button icon="plus">{t("pages.expenses.addExpense")}</Button>
        </div>
      </div>
      <div className={viewStyles.card}>
        <Empty icon="wallet" title={t("pages.expenses.empty")} />
      </div>
    </div>
  );
}

export default ExpensesView;
