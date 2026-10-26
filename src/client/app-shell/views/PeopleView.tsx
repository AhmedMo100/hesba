"use client";

import React from "react";
import viewStyles from "./ViewLayout.module.css";
import { Empty } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function PeopleView() {
  return (
    <div className={viewStyles.view} data-testid="page-people">
      <div className={viewStyles.phead}>
        <div>
          <h1>{t("pages.people.title")}</h1>
        </div>
      </div>
      <div className={viewStyles.card}>
        <Empty icon="users" title={t("pages.people.empty")} />
      </div>
    </div>
  );
}

export default PeopleView;
