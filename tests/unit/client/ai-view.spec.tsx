import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AiView } from "@/client/features/ai/AiView";
import { AI_SUGGESTED_QUESTIONS } from "@/schemas/ai";

describe("AiView Component (Assistant Chat Interface)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders page header, title, and Egyptian colloquial subtitle", () => {
    const html = renderToStaticMarkup(<AiView />);
    expect(html).toContain("مساعد حسبة");
    expect(html).toContain("اسأل عن محلك أو السوق");
  });

  it("renders quota badge in header with initial 5 messages limit", () => {
    const html = renderToStaticMarkup(<AiView />);
    expect(html).toContain('data-testid="ai-quota-badge"');
    expect(html).toContain("باقي 5 من 5 رسائل النهارده");
  });

  it("renders minimal calm empty state with sparkle icon and guidance", () => {
    const html = renderToStaticMarkup(<AiView />);
    expect(html).toContain("اسألني أي حاجة عن محلك");
    expect(html).toContain("الأرقام بتيجي من بيانات محلك بس");
    expect(html).toContain('data-testid="ai-empty-suggestions"');
  });

  it("renders suggestions strip positioned above the composer", () => {
    const html = renderToStaticMarkup(<AiView />);
    expect(html).toContain('data-testid="ai-suggestions-strip"');
    // Only questions the read-only tools answer from the shop's data (Prompt 2).
    for (const q of AI_SUGGESTED_QUESTIONS) expect(html).toContain(q);
    expect(html).not.toContain("الدولار والبنزين");
  });

  it("renders bottom composer with voice mic and RTL-flipped send button", () => {
    const html = renderToStaticMarkup(<AiView />);
    expect(html).toContain('placeholder="اكتب سؤالك…"');
    expect(html).toContain('aria-label="اسأل بالصوت"');
    expect(html).toContain('aria-label="إرسال"');
  });

  it("renders history drawer button with history icon in header", () => {
    const html = renderToStaticMarkup(<AiView />);
    expect(html).toContain('aria-label="المحادثات السابقة"');
  });
});
