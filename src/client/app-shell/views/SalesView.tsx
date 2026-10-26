"use client";

import React, { useState } from "react";
import viewStyles from "./ViewLayout.module.css";
import { Empty, SearchBox } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function SalesView() {
  const [query, setQuery] = useState("");

  return (
    <div className={viewStyles.view} data-testid="page-sales">
      <div className={viewStyles.phead}>
        <div>
          <h1>{t("pages.sales.title")}</h1>
        </div>
      </div>
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={t("pages.sales.searchPlaceholder")}
      />
      <div className={viewStyles.card}>
        <Empty icon="cart" title={t("pages.sales.empty")} />
      </div>
    </div>
  );
}

export default SalesView;
