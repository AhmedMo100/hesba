"use client";

import React, { useState } from "react";
import viewStyles from "./ViewLayout.module.css";
import { Empty, SearchBox, Button } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function ProductsView() {
  const [query, setQuery] = useState("");

  return (
    <div className={viewStyles.view} data-testid="page-products">
      <div className={viewStyles.phead}>
        <div>
          <h1>{t("pages.products.title")}</h1>
        </div>
        <div className={viewStyles.pact}>
          <Button icon="plus">{t("pages.products.add")}</Button>
        </div>
      </div>
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={t("pages.products.searchPlaceholder")}
      />
      <div className={viewStyles.card}>
        <Empty icon="box" title={t("pages.products.empty")} />
      </div>
    </div>
  );
}

export default ProductsView;
