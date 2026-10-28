import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Alert } from "@/client/shared/ui/Alert/Alert";
import { Field } from "@/client/shared/ui/Field/Field";

describe("Alert & Form Feedback Component", () => {
  it("renders error alert with role=alert and aria-live=assertive by default", () => {
    const html = renderToStaticMarkup(
      <Alert kind="error">حصل خطأ أثناء الاتصال بالسيرفر</Alert>,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("حصل خطأ أثناء الاتصال بالسيرفر");
    // Should render SVG icon
    expect(html).toContain("<svg");
  });

  it("renders success alert with role=status, aria-live=polite and title", () => {
    const html = renderToStaticMarkup(
      <Alert kind="success" title="تم تغيير كلمة السر بنجاح">
        سجل دخولك الآن بكلمة السر الجديدة للاستمرار
      </Alert>,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("تم تغيير كلمة السر بنجاح");
    expect(html).toContain("سجل دخولك الآن بكلمة السر الجديدة للاستمرار");
  });

  it("renders warning and info alerts with their respective variants", () => {
    const warnHtml = renderToStaticMarkup(
      <Alert kind="warning">تنبيه: أنت غير متصل بالإنترنت</Alert>,
    );
    expect(warnHtml).toContain('role="alert"');
    expect(warnHtml).toContain("تنبيه: أنت غير متصل بالإنترنت");

    const infoHtml = renderToStaticMarkup(
      <Alert kind="info">تم إرسال كود التأكيد إلى بريدك</Alert>,
    );
    expect(infoHtml).toContain('role="status"');
    expect(infoHtml).toContain("تم إرسال كود التأكيد إلى بريدك");
  });

  it("omits icon when icon={false}", () => {
    const html = renderToStaticMarkup(
      <Alert kind="error" icon={false}>
        تنبيه بدون أيقونة
      </Alert>,
    );

    expect(html).not.toContain("<svg");
    expect(html).toContain("تنبيه بدون أيقونة");
  });

  it("renders dismiss button and triggers onClose when clicked", () => {
    const handleClose = vi.fn();
    const rendered = Alert({
      kind: "success",
      onClose: handleClose,
      children: "رسالة قابلة للإغلاق",
    });

    const closeBtn = React.Children.toArray(rendered.props.children).find(
      (c) =>
        React.isValidElement(c) &&
        c.type === "button" &&
        (c.props as { "aria-label"?: string })["aria-label"] ===
          "إغلاق التنبيه",
    ) as React.ReactElement<{ onClick?: () => void }> | undefined;

    expect(closeBtn).toBeDefined();
    closeBtn?.props.onClick?.();
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("Field component renders error icon and aria-live alert when err is present", () => {
    const html = renderToStaticMarkup(
      <Field label="رقم الموبايل" err="رقم موبايل غير صحيح">
        <input type="tel" />
      </Field>,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("رقم موبايل غير صحيح");
    expect(html).toContain("<svg");
  });
});
