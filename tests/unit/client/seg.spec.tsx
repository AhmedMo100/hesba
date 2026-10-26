import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Seg, type SegOption } from "@/client/shared/ui/Seg/Seg";

describe("Seg component", () => {
  const options: SegOption[] = [
    ["day", "يومي", "clock"],
    ["week", "أسبوعي", "cal"],
    ["month", "شهري", "chart"],
  ];

  it("renders role=tablist and correct CSS variables --n and --i for selected item", () => {
    const html = renderToStaticMarkup(
      <Seg value="week" onChange={() => {}} options={options} />,
    );

    expect(html).toContain('role="tablist"');
    // --n is 3, --i is 1 for "week"
    expect(html).toContain("--n:3");
    expect(html).toContain("--i:1");
  });

  it("renders aria-selected=true on the active tab and aria-selected=false on others", () => {
    const html = renderToStaticMarkup(
      <Seg value="day" onChange={() => {}} options={options} />,
    );

    expect(html).toContain("--i:0");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain("يومي");
    expect(html).toContain("أسبوعي");
    expect(html).toContain("شهري");
  });

  it("handles unknown or missing value by defaulting index to 0", () => {
    const html = renderToStaticMarkup(
      <Seg value="unknown" onChange={() => {}} options={options} />,
    );

    expect(html).toContain("--i:0");
  });

  it("calls onChange callback when simulating click", () => {
    const handleChange = vi.fn();

    // Directly test component prop invocation
    const rendered = Seg({
      value: "day",
      onChange: handleChange,
      options,
    });

    // The children include the thumb and the buttons
    const buttons = React.Children.toArray(rendered.props.children).filter(
      (c) => React.isValidElement(c) && c.type === "button",
    );

    expect(buttons.length).toBe(3);
    const secondButton = buttons[1] as React.ReactElement<{
      onClick?: () => void;
    }>;
    secondButton.props.onClick?.();

    expect(handleChange).toHaveBeenCalledWith("week");
  });
});
