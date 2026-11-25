import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AiView } from "@/client/features/ai/AiView";
import { AI_SUGGESTED_QUESTIONS } from "@/schemas/ai";

describe("AiView Component (Assistant Chat Interface)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("V17 top: a new conversation and the previous ones, side by side", () => {
    const html = renderToStaticMarkup(<AiView />);
    expect(html).toContain("＋ محادثة جديدة");
    // The previous conversations card: the words only, no icon (2026-11-25).
    expect(html).toContain(">المحادثات السابقة</button>");
    expect(html).not.toContain("📚");
    expect(html.indexOf("＋ محادثة جديدة")).toBeLessThan(
      html.indexOf("المحادثات السابقة"),
    );
  });

  it("V17 empty state: «أهلاً بيك 👋» and five questions as chips", () => {
    const html = renderToStaticMarkup(<AiView />);
    expect(html).toContain("أهلاً بيك 👋");
    expect(html).toContain("اسألني عن محلك، أو عن البقالة بشكل عام.");
    expect(html).toContain('data-testid="ai-empty-suggestions"');
    // Only questions the read-only tools answer from the shop's data (Prompt 2).
    for (const q of AI_SUGGESTED_QUESTIONS.slice(0, 5))
      expect(html).toContain(q);
    expect(html).not.toContain("الدولار والبنزين");
    // No quota badge in V17; the limit shows only once it is reached.
    expect(html).not.toContain('data-testid="ai-quota-badge"');
  });

  it("V17 input bar: «اسأل أي حاجة...» + إرسال (voice kept)", () => {
    const html = renderToStaticMarkup(<AiView />);
    expect(html).toContain('placeholder="اسأل أي حاجة..."');
    expect(html).toContain(">إرسال</button>");
    expect(html).toContain('aria-label="اسأل بالصوت"');
  });

  it("the previous conversations button is labelled", () => {
    const html = renderToStaticMarkup(<AiView />);
    expect(html).toContain('aria-label="المحادثات السابقة"');
  });
});
