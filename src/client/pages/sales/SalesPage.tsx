"use client";

import React, { useState } from "react";
import pageStyles from "../PageLayout.module.css";
import { Empty, SearchBox } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function SalesPage() {
  const [query, setQuery] = useState("");

  return (
    <div className={pageStyles.page} data-testid="page-sales">
      <div className={pageStyles.phead}>
        <div>
          <h1>{t("pages.sales.title")}</h1>
        </div>
      </div>
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={t("pages.sales.searchPlaceholder")}
      />
      <div className={pageStyles.card}>
        <Empty icon="cart" title={t("pages.sales.empty")} />
      </div>
    </div>
  );
}
