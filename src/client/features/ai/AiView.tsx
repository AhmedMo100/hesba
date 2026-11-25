"use client";

import { readAiDraft, writeAiDraft } from "@/client/shared/ai-draft";
import { shareReport } from "@/client/shared/share";
import type { NavRoute } from "@/client/app-shell/BottomNav";
import React, { useState, useEffect, useRef, useCallback } from "react";
import styles from "./AiView.module.css";
import c from "./AiChat17.module.css";
import { Icon } from "@/client/shared/ui";
import { t } from "@/client/shared/i18n";
import { AI_SUGGESTED_QUESTIONS } from "@/schemas/ai";

const OFFLINE_MESSAGE = "مفيش نت دلوقتي. سؤالك محفوظ — ابعته لما النت يرجع.";
/** The unsent question survives a reload or a lost connection (this device only). */
const readDraft = readAiDraft;
const writeDraft = writeAiDraft;

/** Client backstop for one reply: the server's 20 s budget (AI_REPLY_TIMEOUT_MS) + margin. */
const AI_CLIENT_TIMEOUT_MS = 25_000;

export interface AiSource {
  type: "business_tool" | "web_search" | string;
  title: string;
  url?: string;
}

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: AiSource[];
  createdAt?: string;
  failed?: boolean;
}

export interface AiQuotaInfo {
  remaining: number;
  limit: number;
  resetsAt: string;
  day: string;
  /** `grounded` = private mode: answered on the server, nothing sent to an AI provider. */
  mode?: "model" | "grounded";
}

export interface AiConversationSummary {
  id: string;
  day: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface SpeechRecognitionResultItem {
  transcript: string;
}

interface SpeechRecognitionResultList {
  [index: number]: { [index: number]: SpeechRecognitionResultItem };
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface ISpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
}

type SpeechRecognitionConstructor = new () => ISpeechRecognition;

function generateClientUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getTodayCairoDateString(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const THINKING_PHRASES = [
  "بيحسب أرقام محلك...",
  "بيراجع المبيعات والمخزون...",
  "بيظبط الحسبة بالقرش...",
  "ثواني وبيرد عليك...",
];

function renderHighlightedText(text: string): React.ReactNode {
  if (!text.includes("**")) {
    return text;
  }
  const segments = text.split(/(\*\*[^*]+\*\*)/g);
  return segments.map((seg, i) => {
    if (seg.startsWith("**") && seg.endsWith("**")) {
      return <strong key={i}>{seg.slice(2, -2)}</strong>;
    }
    return seg;
  });
}

function AiMessageContent({ content }: { content: string }) {
  const lines = content.split("\n");

  return (
    <div className={styles.msgContent}>
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={idx} className={styles.spacerLine} />;
        }

        // Warning / Alert callout
        if (trimmed.startsWith("⚠️") || trimmed.startsWith("⚠")) {
          return (
            <div key={idx} className={styles.alertLine}>
              <Icon n="alert" s={16} />
              <span>{trimmed.replace(/^⚠️?\s*/, "")}</span>
            </div>
          );
        }

        // Advice / Tip callout (نصيحة: or قاعدة عامة:)
        if (trimmed.startsWith("نصيحة:") || trimmed.startsWith("قاعدة عامة:")) {
          const colonIdx = trimmed.indexOf(":");
          const label = trimmed.slice(0, colonIdx);
          const text = trimmed.slice(colonIdx + 1).trim();
          return (
            <div key={idx} className={styles.tipLine}>
              <span className={styles.tipBadge}>
                <Icon n="sparkle" s={14} />
                <b>{label}</b>
              </span>
              <span>{renderHighlightedText(text)}</span>
            </div>
          );
        }

        // Section header (ends with : or starts with # or title line)
        if (
          (trimmed.endsWith(":") || trimmed.startsWith("#")) &&
          !trimmed.startsWith("•") &&
          !trimmed.startsWith("-")
        ) {
          const headerText = trimmed.replace(/^#+\s*/, "");
          return (
            <div key={idx} className={styles.sectionHeader}>
              <span className={styles.sectionDot} />
              <b>{headerText}</b>
            </div>
          );
        }

        // Bullet point item
        if (trimmed.startsWith("•") || trimmed.startsWith("-")) {
          const rawItem = trimmed.replace(/^[•\-]\s*/, "");
          return (
            <div key={idx} className={styles.bulletItem}>
              <span className={styles.bulletIcon}>•</span>
              <span className={styles.bulletText}>
                {renderHighlightedText(rawItem)}
              </span>
            </div>
          );
        }

        // Numbered list item: 1. Item Name — Value
        const numberedMatch = trimmed.match(/^(\d+)[\.\)]\s*(.+)$/);
        if (numberedMatch && numberedMatch[1] && numberedMatch[2]) {
          const num = numberedMatch[1];
          const rest = numberedMatch[2];
          return (
            <div key={idx} className={styles.numberedItem}>
              <span className={styles.numberBadge}>{num}</span>
              <span className={styles.bulletText}>
                {renderHighlightedText(rest)}
              </span>
            </div>
          );
        }

        // Regular line
        return (
          <div key={idx} className={styles.regularLine}>
            {renderHighlightedText(trimmed)}
          </div>
        );
      })}
    </div>
  );
}

/** A conversation about stocktaking gets a button to the real (safe) stocktake screen. */
const STOCKTAKE_WORDS = /جرد/;

export function AiView({
  onNavigate,
}: { onNavigate?: (route: NavRoute) => void } = {}) {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInputState] = useState(() =>
    typeof window === "undefined" ? "" : readDraft(),
  );
  const setInput = useCallback((text: string) => {
    setInputState(text);
    writeDraft(text);
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingIndex, setThinkingIndex] = useState(0);
  const [quota, setQuota] = useState<AiQuotaInfo | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [conversations, setConversations] = useState<AiConversationSummary[]>(
    [],
  );
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setThinkingIndex((prev) => (prev + 1) % THINKING_PHRASES.length);
    }, 2200);
    return () => clearInterval(interval);
  }, [isLoading]);

  const loadConversationMessages = useCallback(
    async (conversationId: string) => {
      try {
        setIsLoading(true);
        setError(null);
        const res = await fetch(`/api/ai/conversations/${conversationId}`);
        if (res.ok) {
          const json = await res.json();
          const conv = json.conversation ?? json.data;
          if (conv && Array.isArray(conv.messages)) {
            setActiveConversationId(conv.id);
            setMessages(
              conv.messages.map(
                (m: {
                  id: string;
                  role: "user" | "assistant";
                  body_text?: string;
                  content?: string;
                  sources?: AiSource[];
                  created_at?: string;
                  createdAt?: string;
                }) => ({
                  id: m.id,
                  role: m.role,
                  content: m.body_text ?? m.content ?? "",
                  sources: m.sources,
                  createdAt: m.created_at ?? m.createdAt,
                }),
              ),
            );
          }
        }
      } catch {
        setError(t("pages.ai.loadError"));
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const refreshQuota = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/quota");
      if (res.ok) {
        const json = await res.json();
        const q = json.data ?? json;
        if (q && typeof q.remaining === "number") {
          setQuota({
            remaining: q.remaining,
            limit: q.limit ?? 5,
            resetsAt: q.resets_at ?? q.resetsAt ?? "",
            day: q.day_key ?? q.dayKey ?? "",
            mode: q.mode === "grounded" ? "grounded" : "model",
          });
        }
      }
    } catch {
      // Ignore background refresh errors
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/conversations");
      if (res.ok) {
        const json = await res.json();
        const list = json.conversations ?? json.data;
        if (Array.isArray(list)) {
          const formatted = list.map((c) => ({
            id: c.id,
            day: c.day,
            title: c.title,
            createdAt: c.created_at ?? c.createdAt ?? "",
            updatedAt: c.updated_at ?? c.updatedAt ?? "",
            messageCount: c.message_count ?? c.messageCount ?? 0,
          }));
          setConversations(formatted);
        }
      }
    } catch {
      // Ignore background load errors
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    const init = async () => {
      try {
        const [quotaRes, convRes] = await Promise.all([
          fetch("/api/ai/quota"),
          fetch("/api/ai/conversations"),
        ]);

        let currentDayKey = getTodayCairoDateString();

        if (!ignore && quotaRes.ok) {
          const quotaJson = await quotaRes.json();
          const q = quotaJson.data ?? quotaJson;
          if (q && typeof q.remaining === "number") {
            setQuota({
              remaining: q.remaining,
              limit: q.limit ?? 5,
              resetsAt: q.resets_at ?? q.resetsAt ?? "",
              day: q.day_key ?? q.dayKey ?? "",
              mode: q.mode === "grounded" ? "grounded" : "model",
            });
            if (q.day_key || q.dayKey) {
              currentDayKey = q.day_key ?? q.dayKey;
            }
          }
        }

        if (!ignore && convRes.ok) {
          const convJson = await convRes.json();
          const list = convJson.conversations ?? convJson.data;
          if (Array.isArray(list)) {
            const formatted = list.map((c) => ({
              id: c.id,
              day: c.day,
              title: c.title,
              createdAt: c.created_at ?? c.createdAt ?? "",
              updatedAt: c.updated_at ?? c.updatedAt ?? "",
              messageCount: c.message_count ?? c.messageCount ?? 0,
            }));
            setConversations(formatted);

            // Keep today's conversation visible in chat as long as we are in the same day!
            // When the day ends (tomorrow), it automatically moves to the previous chats list.
            const todayConv = formatted.find((c) => c.day === currentDayKey);
            if (todayConv) {
              setActiveConversationId(todayConv.id);
              const msgsRes = await fetch(
                `/api/ai/conversations/${todayConv.id}`,
              );
              if (!ignore && msgsRes.ok) {
                const msgsJson = await msgsRes.json();
                const conv = msgsJson.conversation ?? msgsJson.data;
                if (conv && Array.isArray(conv.messages)) {
                  setMessages(
                    conv.messages.map(
                      (m: {
                        id: string;
                        role: "user" | "assistant";
                        body_text?: string;
                        content?: string;
                        sources?: AiSource[];
                        created_at?: string;
                        createdAt?: string;
                      }) => ({
                        id: m.id,
                        role: m.role,
                        content: m.body_text ?? m.content ?? "",
                        sources: m.sources,
                        createdAt: m.created_at ?? m.createdAt,
                      }),
                    ),
                  );
                }
              }
            } else {
              // Day has ended or new day: fresh chat!
              setActiveConversationId(null);
              setMessages([]);
            }
          }
        }
      } catch {
        // Ignore initial load network errors
      }
    };

    void init();

    return () => {
      ignore = true;
    };
  }, []);

  const handleSend = async (textToSend?: string, retryId?: string) => {
    const text = (textToSend ?? input).trim();
    if (!text || isLoading) return;
    if (quota && quota.remaining <= 0) return;
    // Offline: nothing is sent and no credit is used; the question stays in the box.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError(OFFLINE_MESSAGE);
      if (textToSend && !retryId) setInput(textToSend);
      return;
    }

    setError(null);
    setInput("");

    // A retry keeps the same id: the server answers it once and counts it once.
    const clientMsgId = retryId ?? generateClientUuid();
    const optimisticUserMsg: AiChatMessage = {
      id: clientMsgId,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticUserMsg]);
    setIsLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        // A backstop a little past the server's 20 s reply budget (QA-29): the shopkeeper is
        // never left waiting on a request that hangs.
        signal: AbortSignal.timeout(AI_CLIENT_TIMEOUT_MS),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body_text: text,
          message: text,
          conversation_id: activeConversationId || undefined,
          conversationId: activeConversationId || undefined,
          client_message_id: clientMsgId,
          clientMessageId: clientMsgId,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        // The error body is `{ error: { code, message } }`: show its message (it used to show
        // "[object Object]"). A 503 means busy or too slow: say so (QA-29).
        const serverMessage =
          typeof json.error === "string" ? json.error : json.error?.message;
        throw new Error(
          serverMessage ||
            (res.status === 503
              ? t("pages.ai.slowReply")
              : t("pages.ai.sendError")),
        );
      }

      const convId =
        json.conversation_id ??
        json.conversationId ??
        json.data?.conversationId;
      const msgId =
        json.message_id ??
        json.messageId ??
        json.data?.message?.id ??
        generateClientUuid();
      const bodyText =
        json.body_text ?? json.message?.content ?? json.data?.message?.content;
      const sources =
        json.sources ?? json.message?.sources ?? json.data?.message?.sources;
      const rawQuota = json.quota ?? json.data?.quota;

      if (convId) {
        setActiveConversationId(convId);
      }
      if (rawQuota && typeof rawQuota.remaining === "number") {
        setQuota((prev) => ({
          remaining: rawQuota.remaining,
          limit: rawQuota.limit ?? 5,
          resetsAt: rawQuota.resets_at ?? rawQuota.resetsAt ?? "",
          day: rawQuota.day_key ?? rawQuota.dayKey ?? "",
          mode: prev?.mode,
        }));
      }
      if (bodyText) {
        setMessages((prev) => [
          ...prev,
          {
            id: msgId,
            role: "assistant",
            content: bodyText,
            sources: sources,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
      void loadConversations();
    } catch (err: unknown) {
      const timedOut =
        err instanceof Error &&
        (err.name === "TimeoutError" || err.name === "AbortError");
      const errMsg = timedOut
        ? t("pages.ai.slowReply")
        : err instanceof Error
          ? err.message
          : t("pages.ai.sendError");
      setError(errMsg);
      setMessages((prev) =>
        prev.map((m) => (m.id === clientMsgId ? { ...m, failed: true } : m)),
      );
      void refreshQuota();
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = (failedMsg: AiChatMessage) => {
    setMessages((prev) => prev.filter((m) => m.id !== failedMsg.id));
    void handleSend(failedMsg.content, failedMsg.id);
  };

  const toggleVoice = () => {
    if (typeof window === "undefined") return;

    const windowWithSpeech = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };

    const SpeechRecognition =
      windowWithSpeech.SpeechRecognition ||
      windowWithSpeech.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert(t("pages.ai.voiceError"));
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "ar-EG";
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setInput(transcript);
          inputRef.current?.focus();
        }
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  const suggestions: readonly string[] = AI_SUGGESTED_QUESTIONS;

  const isQuotaExceeded = quota ? quota.remaining <= 0 : false;

  // V17: five questions under «أهلاً بيك 👋».
  const helloQuestions = suggestions.slice(0, 5);

  const newChat = () => {
    setActiveConversationId(null);
    setMessages([]);
    setError(null);
    setShowHistoryModal(false);
  };

  return (
    <div className={c.page} data-testid="page-ai" dir="rtl">
      {/* V17 .chatTop: a new conversation, the previous ones */}
      <div className={c.chatTop}>
        <button
          type="button"
          className={c.ghostBtn}
          onClick={newChat}
          data-testid="ai-new-chat"
        >
          ＋ محادثة جديدة
        </button>
        <button
          type="button"
          className={c.ghostBtn}
          onClick={() => setShowHistoryModal(true)}
          aria-label={t("pages.ai.historyBtn")}
          data-testid="ai-history"
        >
          المحادثات السابقة
        </button>
      </div>

      <div className={c.body}>
        {showHistoryModal ? (
          /* V17: the previous conversations in the chat body */
          <>
            <div className={c.head}>المحادثات السابقة</div>
            {conversations.length === 0 ? (
              <div className={c.note}>{t("pages.ai.noHistory")}</div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  className={c.row}
                  onClick={() => {
                    void loadConversationMessages(conv.id);
                    setShowHistoryModal(false);
                  }}
                >
                  <span className={c.t}>
                    <b>{conv.title}</b>
                    <span>
                      {conv.messageCount} رسائل
                      {conv.id === activeConversationId
                        ? ` · ${t("pages.ai.todayConversation")}`
                        : ""}
                    </span>
                  </span>
                </button>
              ))
            )}
            <div className={c.note}>{t("pages.ai.historySubtitle")}</div>
          </>
        ) : (
          <>
            {isQuotaExceeded && (
              <div className={c.warn} data-testid="ai-quota-badge">
                {t("pages.ai.quotaExceededBanner", {
                  limit: quota?.limit ?? 5,
                })}
              </div>
            )}

            {messages.length === 0 ? (
              <>
                <div className={c.hello} data-testid="ai-empty-suggestions">
                  <b>أهلاً بيك 👋</b>
                  <br />
                  اسألني عن محلك، أو عن البقالة بشكل عام.
                </div>
                {helloQuestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className={c.chip}
                    data-testid="ai-suggestion-chip"
                    disabled={isQuotaExceeded || isLoading}
                    onClick={() => void handleSend(q)}
                  >
                    {q}
                  </button>
                ))}
              </>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`${c.msg} ${m.role === "user" ? c.u : c.b}`}
                  data-testid={m.role === "user" ? "ai-msg-user" : "ai-msg-bot"}
                >
                  {m.role === "assistant" ? (
                    <AiMessageContent content={m.content} />
                  ) : (
                    m.content
                  )}
                  {m.sources && m.sources.length > 0 && (
                    <div className={styles.sources}>
                      <span className={styles.sourcesTitle}>
                        {t("pages.ai.sourcesTitle")}
                      </span>
                      {m.sources.map((src, i) => (
                        <div key={i} className={styles.sourceItem}>
                          {src.url ? (
                            <a
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.sourceLink}
                            >
                              • {src.title}
                            </a>
                          ) : (
                            <span>• {src.title}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {m.role === "assistant" && !m.failed && m.content && (
                    <div className={styles.msgActions}>
                      <button
                        type="button"
                        className={styles.msgAction}
                        onClick={() =>
                          void shareReport({
                            title: "من حِسبة",
                            text: m.content,
                            file: {
                              name: "تقرير-حسبة.txt",
                              content: m.content,
                              mime: "text/plain;charset=utf-8",
                            },
                          })
                        }
                        data-testid="ai-msg-share"
                      >
                        📤 شارك / نزّل
                      </button>
                      {onNavigate && STOCKTAKE_WORDS.test(m.content) && (
                        <button
                          type="button"
                          className={styles.msgAction}
                          onClick={() => onNavigate("stocktake")}
                          data-testid="ai-open-stocktake"
                        >
                          🧮 افتح «اعمل جرد»
                        </button>
                      )}
                    </div>
                  )}
                  {m.failed && (
                    <div style={{ marginTop: 6 }}>
                      <button
                        type="button"
                        className={styles.retryBtn}
                        onClick={() => handleRetry(m)}
                      >
                        {t("pages.ai.retry")}
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}

            {isLoading && (
              <div className={`${c.msg} ${c.b}`} aria-live="polite">
                <span className={c.note}>
                  {THINKING_PHRASES[thinkingIndex]}{" "}
                </span>
                <span className={c.typing} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}

            {error && (
              <div className={c.error} role="alert">
                {error}
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* V17 .chatIn: «اسأل أي حاجة...» + إرسال */}
      {!showHistoryModal && (
        <div className={c.chatIn}>
          <button
            type="button"
            className={`${c.mic} ${isListening ? c.micOn : ""}`}
            onClick={toggleVoice}
            aria-label={
              isListening ? t("pages.ai.listening") : t("pages.ai.voiceLabel")
            }
          >
            🎤
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            dir="auto"
            value={input}
            disabled={isQuotaExceeded || isLoading}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`;
            }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={
              isQuotaExceeded
                ? t("pages.ai.placeholderExceeded")
                : isListening
                  ? t("pages.ai.listening")
                  : "اسأل أي حاجة..."
            }
            aria-label="اسأل أي حاجة..."
            enterKeyHint="send"
            data-testid="ai-input"
          />
          <button
            type="button"
            className={c.send}
            disabled={!input.trim() || isLoading || isQuotaExceeded}
            onClick={() => void handleSend()}
            aria-label={t("pages.ai.send")}
          >
            إرسال
          </button>
        </div>
      )}
    </div>
  );
}

export default AiView;
