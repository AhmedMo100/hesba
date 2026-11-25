import React from "react";
import styles from "./PageTitle.module.css";

/**
 * The heading at the top of an inner page, in the spirit of «دخلت بضاعة جديدة؟»: what the page
 * is good for, in plain Egyptian Arabic (the page's name stays in the top bar). One style for
 * every page: size, weight and spacing.
 */
export function PageTitle({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 className={`${styles.title} ${className}`} data-testid="page-title">
      {children}
    </h2>
  );
}
