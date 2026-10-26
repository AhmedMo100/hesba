"use client";

import React, { useState, useRef, useEffect } from "react";
import styles from "./SearchBox.module.css";
import { Icon } from "../Icon/Icon";
import { t } from "../../i18n";

export interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  voice?: boolean;
  sampleVoiceText?: string;
  className?: string;
  autoFocus?: boolean;
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  voice = true,
  sampleVoiceText,
  className = "",
  autoFocus = false,
}: SearchBoxProps) {
  const [isRecording, setIsRecording] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore
        }
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleVoiceClick = () => {
    if (isRecording) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore
        }
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      setIsRecording(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const windowWithSpeech = window as any;
    const SpeechRecognition =
      windowWithSpeech.SpeechRecognition ||
      windowWithSpeech.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      // Fallback simulation
      setIsRecording(true);
      timerRef.current = setTimeout(() => {
        setIsRecording(false);
        if (sampleVoiceText) {
          onChange(sampleVoiceText);
        }
      }, 1200);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "ar-EG";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognitionRef.current = recognition;

      let hasResult = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (e: any) => {
        hasResult = true;
        const transcript = e.results?.[0]?.[0]?.transcript || "";
        const clean = String(transcript)
          .replace(/[.،؟?]/g, "")
          .trim();
        onChange(clean);
      };

      recognition.onerror = () => {
        if (!hasResult) {
          setIsRecording(false);
        }
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognition.start();
      setIsRecording(true);
    } catch {
      setIsRecording(false);
    }
  };

  const defaultPlaceholder = placeholder || t("common.search");

  return (
    <div className={`${styles.sbox} ${className}`}>
      <span className={styles.searchIcon}>
        <Icon n="search" s={18} />
      </span>
      <input
        type="text"
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={defaultPlaceholder}
        aria-label={defaultPlaceholder}
        autoFocus={autoFocus}
      />
      {value && (
        <button
          type="button"
          className={styles.clearBtn}
          aria-label={t("common.clear")}
          onClick={() => onChange("")}
        >
          <Icon n="x" s={16} />
        </button>
      )}
      {voice && (
        <button
          type="button"
          className={`${styles.micBtn} ${isRecording ? styles.rec : ""}`}
          aria-label={t("common.voiceSearch")}
          title={t("common.voiceSearch")}
          onClick={handleVoiceClick}
        >
          <Icon n="mic" s={18} />
        </button>
      )}
    </div>
  );
}
