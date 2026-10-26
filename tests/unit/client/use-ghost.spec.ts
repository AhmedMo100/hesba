import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGhostExit, useGhost } from "@/client/shared/hooks/useGhost";

interface MockElement {
  parentNode: MockParent | null;
  getBoundingClientRect: () => {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  cloneNode: (deep: boolean) => MockElement;
  removeAttribute: (attr: string) => void;
  classList: { add: (cls: string) => void };
  setAttribute: (attr: string, val: string) => void;
  style: Record<string, string>;
  querySelectorAll: (selector: string) => HTMLElement[];
}

interface MockParent {
  removeChild: (el: unknown) => void;
}

describe("useGhost hook and createGhostExit helper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("safely exits if node is null or element has no parentNode", () => {
    expect(createGhostExit(null)).toBeNull();

    const nodeWithoutParent: MockElement = {
      parentNode: null,
      getBoundingClientRect: vi.fn(() => ({
        top: 0,
        left: 0,
        width: 0,
        height: 0,
      })),
      cloneNode: vi.fn(),
      removeAttribute: vi.fn(),
      classList: { add: vi.fn() },
      setAttribute: vi.fn(),
      style: {},
      querySelectorAll: vi.fn().mockReturnValue([]),
    };
    expect(
      createGhostExit(nodeWithoutParent as unknown as HTMLElement),
    ).toBeNull();
  });

  it("clones DOM node, applies 'out' class, appends to body, and removes after timeout", () => {
    const appendedElements: unknown[] = [];
    let removed = false;

    const fakeClone: MockElement = {
      parentNode: {
        removeChild: vi.fn(() => {
          removed = true;
        }),
      },
      getBoundingClientRect: vi.fn(() => ({
        top: 0,
        left: 0,
        width: 0,
        height: 0,
      })),
      cloneNode: vi.fn(),
      removeAttribute: vi.fn(),
      classList: {
        add: vi.fn(),
      },
      setAttribute: vi.fn(),
      style: {},
      querySelectorAll: vi
        .fn()
        .mockReturnValue([
          { tabIndex: 0 } as HTMLElement,
          { tabIndex: 0 } as HTMLElement,
        ]),
    };

    const fakeNode: MockElement = {
      parentNode: {
        removeChild: vi.fn(),
      },
      getBoundingClientRect: vi.fn(() => ({
        top: 50,
        left: 20,
        width: 300,
        height: 400,
      })),
      cloneNode: vi.fn(() => fakeClone),
      removeAttribute: vi.fn(),
      classList: { add: vi.fn() },
      setAttribute: vi.fn(),
      style: {},
      querySelectorAll: vi.fn().mockReturnValue([]),
    };

    // Mock global window & document
    const mockMatchMedia = vi.fn().mockReturnValue({ matches: false });
    const mockGetComputedStyle = vi.fn().mockReturnValue({ zIndex: "60" });
    const mockAppendChild = vi.fn((el: unknown) => {
      appendedElements.push(el);
    });

    const globalObj = globalThis as unknown as {
      window: { matchMedia: unknown; getComputedStyle: unknown };
      document: { body: { appendChild: unknown } };
    };

    globalObj.window = {
      matchMedia: mockMatchMedia,
      getComputedStyle: mockGetComputedStyle,
    };
    globalObj.document = {
      body: {
        appendChild: mockAppendChild,
      },
    };

    const ghost = createGhostExit(
      fakeNode as unknown as HTMLElement,
      "out",
      300,
    );

    expect(ghost).toBe(fakeClone);
    expect(fakeNode.cloneNode).toHaveBeenCalledWith(true);
    expect(fakeClone.removeAttribute).toHaveBeenCalledWith("id");
    expect(fakeClone.classList.add).toHaveBeenCalledWith("out");
    expect(fakeClone.setAttribute).toHaveBeenCalledWith("aria-hidden", "true");
    expect(fakeClone.style["top"]).toBe("50px");
    expect(fakeClone.style["left"]).toBe("20px");
    expect(mockAppendChild).toHaveBeenCalledWith(fakeClone);

    // Fast forward timer to 300ms
    vi.advanceTimersByTime(300);
    expect(fakeClone.parentNode?.removeChild).toHaveBeenCalledWith(fakeClone);
    expect(removed).toBe(true);
  });

  it("skips ghost clone when prefers-reduced-motion is active", () => {
    const fakeClone: MockElement = {
      parentNode: null,
      getBoundingClientRect: vi.fn(() => ({
        top: 0,
        left: 0,
        width: 0,
        height: 0,
      })),
      cloneNode: vi.fn(),
      removeAttribute: vi.fn(),
      classList: { add: vi.fn() },
      setAttribute: vi.fn(),
      style: {},
      querySelectorAll: vi.fn().mockReturnValue([]),
    };

    const fakeNode: MockElement = {
      parentNode: { removeChild: vi.fn() },
      getBoundingClientRect: vi.fn(() => ({
        top: 0,
        left: 0,
        width: 100,
        height: 100,
      })),
      cloneNode: vi.fn(() => fakeClone),
      removeAttribute: vi.fn(),
      classList: { add: vi.fn() },
      setAttribute: vi.fn(),
      style: {},
      querySelectorAll: vi.fn().mockReturnValue([]),
    };

    const mockAppendChild = vi.fn();

    const globalObj = globalThis as unknown as {
      window: { matchMedia: unknown; getComputedStyle: unknown };
      document: { body: { appendChild: unknown } };
    };

    globalObj.window = {
      matchMedia: vi.fn().mockReturnValue({ matches: true }), // Reduced motion active
      getComputedStyle: vi.fn().mockReturnValue({ zIndex: "1" }),
    };
    globalObj.document = {
      body: {
        appendChild: mockAppendChild,
      },
    };

    const result = createGhostExit(
      fakeNode as unknown as HTMLElement,
      "out",
      300,
    );

    expect(result).toBeNull();
    expect(fakeNode.cloneNode).not.toHaveBeenCalled();
    expect(mockAppendChild).not.toHaveBeenCalled();
  });

  it("renders inside a React component without error", () => {
    function TestComponent() {
      const ref = React.useRef<HTMLDivElement>(null);
      useGhost(ref);
      return React.createElement("div", { ref });
    }

    expect(() =>
      renderToStaticMarkup(React.createElement(TestComponent)),
    ).not.toThrow();
  });
});
