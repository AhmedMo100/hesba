/**
 * @file share.ts
 * @description Share or download a report from the phone: the system share sheet (WhatsApp,
 * Gmail…) when the browser has one, otherwise a normal file download. Nothing is sent to a
 * server: the file is built on the device from data the screen already shows.
 */

export interface ShareFile {
  name: string;
  content: string;
  mime: string;
}

/** Saves the file on the device (a download). */
export function downloadFile(file: ShareFile): void {
  const blob = new Blob([file.content], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Opens the share sheet with the text (and the file when the browser can share files);
 * falls back to downloading the file, or copying the text. Resolves with what happened.
 */
export async function shareReport(opts: {
  title: string;
  text: string;
  file?: ShareFile;
}): Promise<"shared" | "downloaded" | "copied" | "cancelled"> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  try {
    if (nav?.share) {
      if (opts.file && typeof File !== "undefined") {
        const f = new File([opts.file.content], opts.file.name, {
          type: opts.file.mime,
        });
        if (nav.canShare?.({ files: [f] })) {
          await nav.share({ title: opts.title, text: opts.text, files: [f] });
          return "shared";
        }
      }
      await nav.share({ title: opts.title, text: opts.text });
      return "shared";
    }
  } catch (err) {
    // The owner closed the share sheet: not an error.
    if (err instanceof DOMException && err.name === "AbortError")
      return "cancelled";
  }
  if (opts.file) {
    downloadFile(opts.file);
    return "downloaded";
  }
  try {
    await nav?.clipboard?.writeText(opts.text);
    return "copied";
  } catch {
    downloadFile({
      name: "تقرير.txt",
      content: opts.text,
      mime: "text/plain;charset=utf-8",
    });
    return "downloaded";
  }
}
