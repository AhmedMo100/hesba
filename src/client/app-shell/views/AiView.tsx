"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import styles from "./AiView.module.css";
import { Icon, Modal } from "../../shared/ui";
import { t } from "../../shared/i18n";

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

export function AiView() {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
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
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const loadConversationMessages = useCallback(
    async (conversationId: string) => {
      try {
        setIsLoading(true);
        setError(null);
        const res = await fetch(`/api/ai/conversations/${conversationId}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            setActiveConversationId(json.data.id);
            setMessages(
              json.data.messages.map(
                (m: {
                  id: string;
                  role: "user" | "assistant";
                  content: string;
                  sources?: AiSource[];
                  createdAt?: string;
                }) => ({
                  id: m.id,
                  role: m.role,
                  content: m.content,
                  sources: m.sources,
                  createdAt: m.createdAt,
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
        if (json.success && json.data) {
          setQuota(json.data);
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
        if (json.success && Array.isArray(json.data)) {
          setConversations(json.data);
          if (json.data.length > 0 && !activeConversationId) {
            const todayConv = json.data[0];
            setActiveConversationId(todayConv.id);
            await loadConversationMessages(todayConv.id);
          }
        }
      }
    } catch {
      // Ignore background load errors
    }
  }, [activeConversationId, loadConversationMessages]);

  useEffect(() => {
    let ignore = false;

    const init = async () => {
      try {
        const [quotaRes, convRes] = await Promise.all([
          fetch("/api/ai/quota"),
          fetch("/api/ai/conversations"),
        ]);

        if (!ignore && quotaRes.ok) {
          const quotaJson = await quotaRes.json();
          if (quotaJson.success && quotaJson.data) {
            setQuota(quotaJson.data);
          }
        }

        if (!ignore && convRes.ok) {
          const convJson = await convRes.json();
          if (convJson.success && Array.isArray(convJson.data)) {
            setConversations(convJson.data);
            if (convJson.data.length > 0) {
              const todayConv = convJson.data[0];
              setActiveConversationId(todayConv.id);
              const msgsRes = await fetch(
                `/api/ai/conversations/${todayConv.id}`,
              );
              if (!ignore && msgsRes.ok) {
                const msgsJson = await msgsRes.json();
                if (msgsJson.success && msgsJson.data?.messages) {
                  setMessages(
                    msgsJson.data.messages.map(
                      (m: {
                        id: string;
                        role: "user" | "assistant";
                        content: string;
                        sources?: AiSource[];
                        createdAt?: string;
                      }) => ({
                        id: m.id,
                        role: m.role,
                        content: m.content,
                        sources: m.sources,
                        createdAt: m.createdAt,
                      }),
                    ),
                  );
                }
              }
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

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend ?? input).trim();
    if (!text || isLoading) return;
    if (quota && quota.remaining <= 0) return;

    setError(null);
    setInput("");

    const clientMsgId = generateClientUuid();
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId: activeConversationId || undefined,
          clientMessageId: clientMsgId,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || t("pages.ai.sendError"));
      }

      if (json.data) {
        if (json.data.conversationId) {
          setActiveConversationId(json.data.conversationId);
        }
        if (json.data.quota) {
          setQuota(json.data.quota);
        }
        if (json.data.message) {
          setMessages((prev) => [
            ...prev,
            {
              id: json.data.message.id,
              role: "assistant",
              content: json.data.message.content,
              sources: json.data.message.sources,
              createdAt: json.data.message.createdAt,
            },
          ]);
        }
        void loadConversations();
      }
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : t("pages.ai.sendError");
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
    void handleSend(failedMsg.content);
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

  const suggestions = [
    t("pages.ai.sugg1"),
    t("pages.ai.sugg2"),
    t("pages.ai.sugg3"),
    t("pages.ai.sugg4"),
  ];

  const remainingQuota = quota ? quota.remaining : 5;
  const isQuotaExceeded = quota ? quota.remaining <= 0 : false;

  return (
    <div className={styles.page} data-testid="page-ai">
      <header className={styles.phead}>
        <div className={styles.pheadInfo}>
          <h1>{t("pages.ai.title")}</h1>
          <p>{t("pages.ai.subtitle")}</p>
        </div>

        <div className={styles.pheadActions}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => setShowHistoryModal(true)}
            aria-label={t("pages.ai.historyBtn")}
            title={t("pages.ai.historyBtn")}
          >
            <Icon n="history" s={18} />
          </button>

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
        </div>
      </header>

      {isQuotaExceeded && (
        <div className={styles.limitBanner}>
          <Icon n="info" s={18} />
          <span>
            {t("pages.ai.quotaExceededBanner", { limit: quota?.limit ?? 5 })}
          </span>
        </div>
      )}

      <div className={styles.chat}>
        {messages.length === 0 ? (
          <div className={styles.aiHello}>
            <div className={styles.sparkleIconBox}>
              <Icon n="sparkle" s={30} />
            </div>
            <b>{t("pages.ai.emptyTitle")}</b>
            <span>{t("pages.ai.emptySubtitle")}</span>

            <div className={styles.chips}>
              {suggestions.map((s, idx) => (
                <button
                  type="button"
                  key={idx}
                  className={styles.suggChip}
                  disabled={isQuotaExceeded || isLoading}
                  onClick={() => void handleSend(s)}
                >
                  {s}
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
                {m.content}

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

                {m.failed && (
                  <div style={{ marginTop: 8 }}>
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

        {isLoading && (
          <div className={`${styles.msg} ${styles.msgA}`}>
            <div className={`${styles.bub} ${styles.typing}`}>
              <div className={styles.typingDot} />
              <div className={styles.typingDot} />
              <div className={styles.typingDot} />
            </div>
          </div>
        )}

        {error && (
          <div className={styles.errorState}>
            <span>{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

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
          <Icon n="mic" s={20} />
        </button>

        <input
          ref={inputRef}
          type="text"
          value={input}
          disabled={isQuotaExceeded || isLoading}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
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
        />

        <button
          type="button"
          className={`${styles.sendBtn} ${input.trim() ? styles.sendBtnActive : ""}`}
          disabled={!input.trim() || isLoading || isQuotaExceeded}
          onClick={() => void handleSend()}
          aria-label={t("pages.ai.send")}
        >
          <Icon n="send" s={18} />
        </button>
      </div>

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
                  padding: "24px 0",
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
