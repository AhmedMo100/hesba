"use client";

import React from "react";
import styles from "./Header.module.css";
import { StoreMenu, type StoreMenuProps } from "./StoreMenu";

export type HeaderProps = StoreMenuProps;

export function Header({ ...menu }: HeaderProps) {
  return (
    <header className={styles.top}>
      <div className={styles.leftGroup}>
        <StoreMenu {...menu} />
      </div>

      <div className={styles.rightGroup} />
    </header>
  );
}
