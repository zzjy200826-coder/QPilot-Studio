import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import type { Language } from "@qpilot/shared";
import { isProbablyCorruptedTranslation } from "./corruption";

const STORAGE_KEY = "qpilot.language.v1";

interface I18nContextValue {
  language: Language;
  locale: string;
  setLanguage: (next: Language) => void;
  pick: (english: string, chinese: string) => string;
  formatDateTime: (iso?: string | null, emptyText?: string) => string;
  formatRelativeTime: (iso?: string | null, emptyText?: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const normalizeLanguage = (value?: string | null): Language => {
  if (value === "zh-CN" || value?.toLowerCase().startsWith("zh")) {
    return "zh-CN";
  }
  return "en";
};

const detectInitialLanguage = (): Language => {
  if (typeof window === "undefined") {
    return "en";
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved) {
    return normalizeLanguage(saved);
  }

  return normalizeLanguage(window.navigator.language);
};

export const I18nProvider = ({ children }: PropsWithChildren) => {
  const [language, setLanguage] = useState<Language>(() => detectInitialLanguage());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nContextValue>(() => {
    const locale = language === "zh-CN" ? "zh-CN" : "en-US";
    const dateFormatter = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short"
    });
    const relativeFormatter = new Intl.RelativeTimeFormat(locale, {
      numeric: "auto"
    });

    return {
      language,
      locale,
      setLanguage,
      pick: (english, chinese) =>
        language === "zh-CN" && !isProbablyCorruptedTranslation(chinese) ? chinese : english,
      formatDateTime: (iso, emptyText) => {
        if (!iso) {
          return emptyText ?? "-";
        }
        return dateFormatter.format(new Date(iso));
      },
      formatRelativeTime: (iso, emptyText) => {
        if (!iso) {
          return emptyText ?? (language === "zh-CN" ? "\u6682\u65e0\u4fe1\u53f7" : "No signal yet");
        }

        const deltaSeconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
        const absoluteSeconds = Math.abs(deltaSeconds);

        if (absoluteSeconds < 5) {
          return language === "zh-CN" ? "\u521a\u521a" : "just now";
        }

        if (absoluteSeconds < 60) {
          return relativeFormatter.format(deltaSeconds, "second");
        }

        const deltaMinutes = Math.round(deltaSeconds / 60);
        if (Math.abs(deltaMinutes) < 60) {
          return relativeFormatter.format(deltaMinutes, "minute");
        }

        const deltaHours = Math.round(deltaMinutes / 60);
        if (Math.abs(deltaHours) < 24) {
          return relativeFormatter.format(deltaHours, "hour");
        }

        return relativeFormatter.format(Math.round(deltaHours / 24), "day");
      }
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextValue => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider.");
  }
  return context;
};
