"use client";

/**
 * @file PasswordInput.tsx
 * @description A password field with a show/hide (eye) button — sign-up, login and the
 * change-password screen use it.
 *
 * @remarks
 * - Hidden by default; the button only switches `type` between "password" and "text", the value
 *   never leaves the input. It is a `type="button"`, so it never submits the form, and it keeps
 *   the caret in the field.
 * - The typed password is left-to-right (Latin letters and digits) inside the RTL form.
 */

import React, { useState } from "react";
import fieldStyles from "../Field/Field.module.css";
import styles from "./PasswordInput.module.css";
import { Icon } from "../Icon/Icon";

export type PasswordInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
>;

export function PasswordInput({ className = "", ...rest }: PasswordInputProps) {
  const [shown, setShown] = useState(false);
  return (
    <span className={styles.wrap}>
      <input
        {...rest}
        type={shown ? "text" : "password"}
        dir="ltr"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={`${fieldStyles.input} ${styles.input} ${className}`}
      />
      <button
        type="button"
        className={styles.toggle}
        aria-label={shown ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
        aria-pressed={shown}
        data-testid="password-toggle"
        // Keep the focus (and the mobile keyboard) in the field.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShown((v) => !v);
        }}
        disabled={rest.disabled}
      >
        <Icon n={shown ? "eyeoff" : "eye"} s={20} />
      </button>
    </span>
  );
}
