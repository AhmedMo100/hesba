/**
 * @file ai-draft.ts
 * @description The «اسأل حسبة» draft kept on the device. Other screens (e.g. «اعمل جرد») put a
 * question there and open the assistant: the owner reads it and sends it himself, so no AI
 * message (and none of the 5 daily messages) is ever spent without his tap.
 */
export const AI_DRAFT_KEY = "hesba_ai_draft";

export function readAiDraft(): string {
  try {
    return localStorage.getItem(AI_DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeAiDraft(text: string): void {
  try {
    if (text) localStorage.setItem(AI_DRAFT_KEY, text);
    else localStorage.removeItem(AI_DRAFT_KEY);
  } catch {
    // Private mode / blocked storage: the draft just is not kept.
  }
}
