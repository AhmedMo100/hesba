"use client";

import React from "react";
import pageStyles from "../PageLayout.module.css";
import { Empty, Button } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function ExpensesPage() {
  return (
    <div className={pageStyles.page} data-testid="page-expenses">
      <div className={pageStyles.phead}>
        <div>
          <h1>{t("pages.expenses.title")}</h1>
        </div>
        <div className={pageStyles.pact}>
          <Button icon="plus">{t("pages.expenses.addExpense")}</Button>
        </div>
      </div>
      <div className={pageStyles.card}>
        <Empty icon="wallet" title={t("pages.expenses.empty")} />
      </div>
    </div>
  );
}
