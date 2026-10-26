"use client";

import React from "react";
import pageStyles from "../PageLayout.module.css";
import { Empty } from "../../shared/ui";
import { t } from "../../shared/i18n";

export function PeoplePage() {
  return (
    <div className={pageStyles.page} data-testid="page-people">
      <div className={pageStyles.phead}>
        <div>
          <h1>{t("pages.people.title")}</h1>
        </div>
      </div>
      <div className={pageStyles.card}>
        <Empty icon="users" title={t("pages.people.empty")} />
      </div>
    </div>
  );
}
