"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import styles from "./AiView.module.css";
import { Icon, Modal } from "@/client/shared/ui";
import { t } from "@/client/shared/i18n";
import { AI_SUGGESTED_QUESTIONS } from "@/schemas/ai";

/** The unsent question survives a reload or a lost connection (this device only). */
const DRAFT_KEY = "hesba_ai_draft";
const OFFLINE_MESSAGE = "مفيش نت دلوقتي. سؤالك محفوظ — ابعته لما النت يرجع.";

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(text: string): void {
  try {
    if (text) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private mode / blocked storage: the draft just is not kept.
  }
}

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

export function AiView() {
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

  const remainingQuota = quota ? quota.remaining : 5;
  const isQuotaExceeded = quota ? quota.remaining <= 0 : false;

  return (
    <div className={styles.page} data-testid="page-ai">
      {/* Header */}
      <header className={styles.phead}>
        <div className={styles.pheadInfo}>
          <h1>{t("pages.ai.title")}</h1>
          <p>{t("pages.ai.subtitle")}</p>
        </div>

        <div className={styles.pheadActions}>
          <span
            className={`${styles.quota} ${isQuotaExceeded ? styles.quotaZero : ""}`}
            data-testid="ai-quota-badge"
          >
            {isQuotaExceeded
              ? t("pages.ai.quotaZero")
              : t("pages.ai.quota", {
                  remaining: remainingQuota,
                  limit: quota?.limit ?? 5,
                })}
          </span>

          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => setShowHistoryModal(true)}
            aria-label={t("pages.ai.historyBtn")}
            title={t("pages.ai.historyBtn")}
          >
            <Icon n="history" s={18} />
          </button>
        </div>
      </header>

      {quota?.mode === "grounded" && (
        <div className={styles.privateNote} data-testid="ai-private-mode">
          <Icon n="lock" s={16} />
          <span>
            وضع خاص: الأسئلة بتتجاوب على سيرفر حسبة من بيانات محلك، ومش بتتبعت
            لأي شركة ذكاء اصطناعي.
          </span>
        </div>
      )}

      {/* Daily limit warning banner */}
      {isQuotaExceeded && (
        <div className={styles.limitBanner}>
          <Icon n="info" s={18} />
          <span>
            {t("pages.ai.quotaExceededBanner", { limit: quota?.limit ?? 5 })}
          </span>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className={styles.chat}>
        {messages.length === 0 ? (
          <div className={styles.aiHello}>
            <div className={styles.sparkleIconBox}>
              <Icon n="sparkle" s={26} />
            </div>
            <b>{t("pages.ai.emptyTitle")}</b>
            <span>
              اسأل عن مبيعاتك، مصروفاتك، النواقص، واللي ليك واللي عليك. الأرقام
              بتيجي من بيانات محلك بس.
            </span>
            <div
              className={styles.helloGrid}
              data-testid="ai-empty-suggestions"
            >
              {suggestions.slice(0, 4).map((q) => (
                <button
                  key={q}
                  type="button"
                  className={styles.helloCard}
                  disabled={isQuotaExceeded || isLoading}
                  onClick={() => void handleSend(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`${styles.msg} ${m.role === "user" ? styles.msgU : styles.msgA}`}
            >
              <div className={styles.bub}>
                {m.role === "assistant" ? (
                  <AiMessageContent content={m.content} />
                ) : (
                  m.content
                )}

                {/* Sources & Citations if present */}
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

                {/* Failed user message retry state */}
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
            </div>
          ))
        )}

        {/* Assistant typing indicator */}
        {isLoading && (
          <div className={`${styles.msg} ${styles.msgA}`} aria-live="polite">
            <div className={`${styles.bub} ${styles.thinkingCard}`}>
              <div className={styles.thinkingHeader}>
                <div className={styles.thinkingIconWrap}>
                  <Icon n="sparkle" s={16} />
                </div>
                <span className={styles.thinkingPhrase}>
                  {THINKING_PHRASES[thinkingIndex]}
                </span>
              </div>
              <div className={styles.typing}>
                <div className={styles.typingDot} />
                <div className={styles.typingDot} />
                <div className={styles.typingDot} />
              </div>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className={styles.errorState}>
            <span>{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Fixed Bottom Section: Suggestions Strip directly above Search + Composer Bar */}
      <div className={styles.bottomArea}>
        {/* Horizontal Suggestion Chips directly above the input box */}
        <div
          className={styles.suggestionsStrip}
          data-testid="ai-suggestions-strip"
          aria-label="الأسئلة المقترحة"
        >
          {suggestions.map((s, idx) => (
            <button
              type="button"
              key={idx}
              className={styles.suggChip}
              data-testid="ai-suggestion-chip"
              disabled={isQuotaExceeded || isLoading}
              onClick={() => void handleSend(s)}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Composer Bar */}
        <div className={styles.composer}>
          <button
            type="button"
            className={`${styles.micBtn} ${isListening ? styles.micBtnListening : ""}`}
            onClick={toggleVoice}
            aria-label={
              isListening ? t("pages.ai.listening") : t("pages.ai.voiceLabel")
            }
            title={
              isListening ? t("pages.ai.listening") : t("pages.ai.voiceLabel")
            }
          >
            <Icon n="mic" s={19} />
          </button>

          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            disabled={isQuotaExceeded || isLoading}
            onChange={(e) => {
              setInput(e.target.value);
              // Grows with the question, up to about five lines.
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`;
            }}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a new line. Not while composing (IME).
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
                  : t("pages.ai.placeholder")
            }
            aria-label={t("pages.ai.placeholder")}
            enterKeyHint="send"
            data-testid="ai-input"
          />

          <button
            type="button"
            className={`${styles.sendBtn} ${input.trim() ? styles.sendBtnActive : ""}`}
            disabled={!input.trim() || isLoading || isQuotaExceeded}
            onClick={() => void handleSend()}
            aria-label={t("pages.ai.send")}
          >
            <Icon n="send" s={17} />
          </button>
        </div>
      </div>

      {/* 7-Day History Modal */}
      {showHistoryModal && (
        <Modal
          title={t("pages.ai.historyTitle")}
          onClose={() => setShowHistoryModal(false)}
        >
          <div className={styles.historyList}>
            <div className={styles.historyNotice}>
              <Icon n="info" s={16} />
              <span>{t("pages.ai.historySubtitle")}</span>
            </div>

            {conversations.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "20px 0",
                  color: "var(--ink2)",
                }}
              >
                {t("pages.ai.noHistory")}
              </div>
            ) : (
              conversations.map((conv) => {
                const isActive = conv.id === activeConversationId;
                return (
                  <div
                    key={conv.id}
                    className={`${styles.historyItem} ${isActive ? styles.historyItemActive : ""}`}
                    onClick={() => {
                      void loadConversationMessages(conv.id);
                      setShowHistoryModal(false);
                    }}
                  >
                    <div>
                      <div className={styles.historyItemTitle}>
                        {conv.title}
                      </div>
                      <div className={styles.historyItemMeta}>
                        {conv.messageCount} رسائل
                      </div>
                    </div>
                    {isActive && (
                      <span className={styles.historyItemBadge}>
                        {t("pages.ai.todayConversation")}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

export default AiView;
