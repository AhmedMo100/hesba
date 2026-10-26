"use client";

import React, { useState } from "react";
import pageStyles from "../PageLayout.module.css";
import { Empty, SearchBox, Button } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function ProductsPage() {
  const [query, setQuery] = useState("");

  return (
    <div className={pageStyles.page} data-testid="page-products">
      <div className={pageStyles.phead}>
        <div>
          <h1>{t("pages.products.title")}</h1>
        </div>
        <div className={pageStyles.pact}>
          <Button icon="plus">{t("pages.products.add")}</Button>
        </div>
      </div>
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={t("pages.products.searchPlaceholder")}
      />
      <div className={pageStyles.card}>
        <Empty icon="box" title={t("pages.products.empty")} />
      </div>
    </div>
  );
}
