import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getStoredTheme,
  applyTheme,
  THEME_STORAGE_KEY,
} from "@/client/shared/theme";

describe("Hesba Central Theme Module", () => {
  let mockStorage: Map<string, string>;
  let docAttrs: Map<string, string>;
  let originalWindow: typeof globalThis.window;
  let originalDocument: typeof globalThis.document;

  beforeEach(() => {
    mockStorage = new Map<string, string>();
    docAttrs = new Map<string, string>();

    const fakeLocalStorage = {
      getItem: (key: string) => mockStorage.get(key) ?? null,
      setItem: (key: string, value: string) => mockStorage.set(key, value),
      removeItem: (key: string) => mockStorage.delete(key),
      clear: () => mockStorage.clear(),
    };

    const fakeDocElement = {
      getAttribute: (attr: string) => docAttrs.get(attr) ?? null,
      setAttribute: (attr: string, value: string) => docAttrs.set(attr, value),
      removeAttribute: (attr: string) => docAttrs.delete(attr),
    };

    originalWindow = globalThis.window;
    originalDocument = globalThis.document;

    globalThis.window = {
      localStorage: fakeLocalStorage,
      matchMedia: vi.fn((query: string) => ({
        matches: query.includes("dark"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window & typeof globalThis;

    globalThis.document = {
      documentElement: fakeDocElement,
    } as unknown as Document;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    vi.restoreAllMocks();
  });

  describe("getStoredTheme default and persistence", () => {
    it("defaults to 'light' when no theme preference is stored", () => {
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
      expect(getStoredTheme()).toBe("light");
    });

    it("respects and returns 'dark' when explicitly stored", () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
      expect(getStoredTheme()).toBe("dark");
    });

    it("respects and returns 'light' when explicitly stored", () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "light");
      expect(getStoredTheme()).toBe("light");
    });

    it("respects and returns 'auto' when explicitly stored", () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "auto");
      expect(getStoredTheme()).toBe("auto");
    });

    it("falls back to 'light' if stored value is invalid", () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "neon-pink");
      expect(getStoredTheme()).toBe("light");
    });
  });

  describe("applyTheme DOM manipulation", () => {
    it("sets data-theme='light' on document.documentElement", () => {
      applyTheme("light");
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });

    it("sets data-theme='dark' on document.documentElement", () => {
      applyTheme("dark");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    it("resolves 'auto' based on matchMedia prefers-color-scheme", () => {
      // Mock matchMedia to dark
      vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: query.includes("dark"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      applyTheme("auto");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

      // Mock matchMedia to light
      vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      applyTheme("auto");
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });
  });
});
