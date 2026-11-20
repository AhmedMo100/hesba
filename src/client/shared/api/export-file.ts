"use client";

/**
 * @file export-file.ts
 * @description Getting an export from the server as a file, and handing it on: the phone's
 * share sheet with the file itself (Web Share API level 2 — WhatsApp, Gmail, Drive…) where the
 * browser can share files, otherwise a normal download. Nothing here claims where the file went:
 * the share sheet is the user's choice, and a download is only a download.
 */

export interface ExportedFile {
  file: File;
  /** The server's one-line summary of what is in it (for a text message). */
  summary: string;
}

function nameFrom(disposition: string | null, fallback: string): string {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? "");
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition ?? "");
  return plain?.[1] ?? fallback;
}

/** Downloads the export from the server; throws the server's Arabic message on failure. */
export async function fetchExport(
  url: string,
  fallbackName: string,
): Promise<ExportedFile> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message || "مقدرناش نجهّز الملف");
  }
  const blob = await res.blob();
  const name = nameFrom(res.headers.get("Content-Disposition"), fallbackName);
  let summary = "";
  try {
    summary = decodeURIComponent(res.headers.get("X-Hesba-Summary") ?? "");
  } catch {
    summary = "";
  }
  return {
    file: new File([blob], name, {
      type: blob.type || res.headers.get("Content-Type") || "",
    }),
    summary,
  };
}

/** True when this browser can hand the file itself to the share sheet. */
export function canShareFile(file: File): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}

/**
 * Opens the share sheet with the file (call it straight from a tap: iPhone refuses a share
 * that is not one). Resolves "shared" when the user completed a share, "cancelled" when they
 * closed the sheet; rejects on any other failure.
 */
export async function shareFile(
  file: File,
  text: string,
): Promise<"shared" | "cancelled"> {
  try {
    await navigator.share({ files: [file], title: file.name, text });
    return "shared";
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return "cancelled";
    }
    throw err;
  }
}

/** Saves the file through the browser's download. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** A WhatsApp message with text only (WhatsApp links cannot carry a file). */
export function whatsappTextUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
