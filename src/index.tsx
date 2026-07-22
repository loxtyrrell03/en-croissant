import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import i18n from "i18next";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";

import en_US from "./translation/en-US.json";
import { setAutoFreeze } from "immer";
import LanguageDetector from "i18next-browser-languagedetector";

// Only the fallback locale ships in the entry chunk; the other 15 languages
// load on demand (at init for the detected language, or when the user
// switches language in settings) so they don't weigh down startup.
type LocaleModule = { default: { translation: Record<string, string> } };
const localeLoaders: Record<string, () => Promise<LocaleModule>> = {
  "en-GB": () => import("./translation/en-GB.json"),
  "pt-PT": () => import("./translation/pt-PT.json"),
  "zh-CN": () => import("./translation/zh-CN.json"),
  "ru-RU": () => import("./translation/ru-RU.json"),
  "uk-UA": () => import("./translation/uk-UA.json"),
  "be-BY": () => import("./translation/be-BY.json"),
  "nb-NO": () => import("./translation/nb-NO.json"),
  "pl-PL": () => import("./translation/pl-PL.json"),
  "es-ES": () => import("./translation/es-ES.json"),
  "it-IT": () => import("./translation/it-IT.json"),
  "fr-FR": () => import("./translation/fr-FR.json"),
  "tr-TR": () => import("./translation/tr-TR.json"),
  "ko-KR": () => import("./translation/ko-KR.json"),
  "zh-TW": () => import("./translation/zh-TW.json"),
  "de-DE": () => import("./translation/de-DE.json"),
};

const lazyLocaleBackend = {
  type: "backend" as const,
  init() {},
  read(
    language: string,
    _namespace: string,
    callback: (error: unknown, data: Record<string, string> | null) => void,
  ) {
    const loader = localeLoaders[language];
    if (!loader) {
      callback(null, {});
      return;
    }
    loader().then(
      (module) => callback(null, module.default.translation),
      (error) => callback(error, null),
    );
  },
};

const i18nReady = i18n
  .use(LanguageDetector)
  .use(lazyLocaleBackend)
  .use(initReactI18next)
  .init({
    resources: {
      "en-US": en_US,
    },
    partialBundledLanguages: true,
    detection: {
      order: ["localStorage"],
      caches: ["localStorage"],
    },
    fallbackLng: "en-US",
    returnEmptyString: false,
  });
const i18nStartupReady = Promise.race([
  i18nReady.catch(() => undefined),
  new Promise<void>((resolve) => window.setTimeout(resolve, 2_000)),
]);

dayjs.extend(customParseFormat);

setAutoFreeze(false);

const container = document.getElementById("app");
const root = createRoot(container!);

root.render(
  <main
    style={{
      display: "grid",
      minHeight: "100vh",
      placeItems: "center",
      background: "#17191c",
      color: "#c9cdd3",
      fontFamily: "system-ui, sans-serif",
    }}
  >
    Starting En Croissant…
  </main>,
);

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

async function renderRoot() {
  const isTauriRuntime =
    typeof window !== "undefined" && Boolean((window as TauriWindow).__TAURI_INTERNALS__);
  const [module] = await Promise.all([
    isTauriRuntime ? import("./App") : import("./web/WebApp"),
    // Never let a failed lazy locale request strand the native window blank.
    i18nStartupReady,
  ]);
  const Root = module.default;

  root.render(<Root />);
}

void renderRoot().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error("Failed to start En Croissant", error);
  document.title = `En Croissant startup error: ${message}`;
  root.render(
    <main
      style={{
        boxSizing: "border-box",
        minHeight: "100vh",
        padding: "2rem",
        background: "#fff",
        color: "#202124",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1>En Croissant could not start</h1>
      <p>{message}</p>
      <p>Close and reopen the app after correcting the startup error.</p>
    </main>,
  );
});
