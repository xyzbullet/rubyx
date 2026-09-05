import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  APP_TITLE,
  CLOAK_PRESETS,
  LS,
  faviconFor,
  hostOf,
  uid,
} from "./lib/lib";
import type { ExtensionMeta } from "./lib/crx";

/* ------------------------------------------------------------------ types */

export type PanelId =
  | "downloads"
  | "cookies"
  | "extensions"
  | "settings"
  | "inspector"
  | null;

export interface Tab {
  id: string;
  title: string;
  url: string; // '' = start page
  icon: string;
  status: "start" | "loading" | "loaded";
  hist: string[];
  idx: number;
  key: number; // remount counter (reload)
  blocked?: boolean; // site refused frame embedding (XFO / CSP frame-ancestors)
}

export interface Settings {
  gateway: string;
  transport: "ws" | "polling";
  theme?: "dark" | "light";
  adblock: boolean;
  lists: { id: string; name: string; enabled: boolean }[];
  customList: string;
  presetId: string;
  customTitle: string;
  customIcon: string;
  panicKey: "Backquote" | "F2" | "F4" | "F9";
  autoCloak: boolean;
}

export interface DownloadItem {
  id: string;
  name: string;
  url: string;
  size: number;
  mime: string;
  status: "intercepted" | "complete" | "blocked";
  blobUrl?: string;
  ts: number;
}

export interface JarEntry {
  name: string;
  value: string;
  domain: string;
  ts: number;
}

export interface NetEntry {
  id: string;
  ts: number;
  method: string;
  host: string;
  path: string;
  rtype: string;
  size: number;
  status: "ok" | "blocked";
  src: "sw" | "chrome";
}

export interface ConsoleEntry {
  id: string;
  ts: number;
  level: "log" | "info" | "warn" | "error";
  msg: string;
  src: string;
}

export interface State {
  tabs: Tab[];
  active: string;
  panel: PanelId;
  cloak: boolean;
  cloakFlash: number;
  settings: Settings;
  downloads: DownloadItem[];
  jar: JarEntry[];
  exts: ExtensionMeta[];
  net: NetEntry[];
  consoleLog: ConsoleEntry[];
  blocked: number;
  latency: number | null;
  ctx: { x: number; y: number; kind: "chrome" | "tab"; tabId?: string } | null;
  menuOpen: boolean;
}

export type Action =
  | { type: "new-tab" }
  | { type: "close-tab"; id: string }
  | { type: "close-others"; id: string }
  | { type: "duplicate"; id: string }
  | { type: "select"; id: string }
  | { type: "nav"; id: string; url: string }
  | { type: "back"; id: string }
  | { type: "fwd"; id: string }
  | { type: "reload"; id: string }
  | { type: "loaded"; id: string }
  | { type: "frame-blocked"; id: string }
  | { type: "frame-retry"; id: string }
  | { type: "panel"; panel: PanelId }
  | { type: "cloak"; on?: boolean }
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "download"; item: DownloadItem }
  | { type: "download-status"; id: string; status: DownloadItem["status"]; size?: number; blobUrl?: string }
  | { type: "downloads-clear" }
  | { type: "jar-add"; entry: JarEntry }
  | { type: "jar-del"; name: string }
  | { type: "ext-add"; meta: ExtensionMeta }
  | { type: "ext-toggle"; id: string }
  | { type: "ext-del"; id: string }
  | { type: "net"; entry: NetEntry }
  | { type: "net-clear" }
  | { type: "console"; entry: ConsoleEntry }
  | { type: "console-clear" }
  | { type: "blocked-inc"; n: number }
  | { type: "latency"; ms: number }
  | { type: "ctx"; ctx: State["ctx"] }
  | { type: "menu"; open: boolean }
  | { type: "wipe" };

/* --------------------------------------------------------------- console tap */

const consoleSubs = new Set<(e: ConsoleEntry) => void>();

function fmtArg(a: unknown): string {
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a)?.slice(0, 300) ?? String(a);
  } catch {
    return String(a);
  }
}

(function tapConsole() {
  const levels: ConsoleEntry["level"][] = ["log", "info", "warn", "error"];
  for (const level of levels) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      const entry: ConsoleEntry = {
        id: uid(),
        ts: Date.now(),
        level,
        msg: args.map(fmtArg).join(" "),
        src: "page",
      };
      consoleSubs.forEach((cb) => cb(entry));
    };
  }
})();

export function onConsoleEntry(cb: (e: ConsoleEntry) => void): () => void {
  consoleSubs.add(cb);
  return () => consoleSubs.delete(cb);
}

/* -------------------------------------------------------------- reducer */

function newTab(): Tab {
  return { id: uid(), title: "New Tab", url: "", icon: "", status: "start", hist: [""], idx: 0, key: 0 };
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const defaultSettings: Settings = {
  gateway: "",
  transport: "ws",
  adblock: true,
  lists: [
    { id: "core", name: "wraith-core (bundled)", enabled: true },
    { id: "easylist", name: "EasyList excerpt (bundled)", enabled: true },
  ],
  customList: "",
  presetId: "none",
  customTitle: "",
  customIcon: "",
  panicKey: "Backquote",
  autoCloak: false,
};

function initialState(): State {
  const first = newTab();
  return {
    tabs: [first],
    active: first.id,
    panel: null,
    cloak: false,
    cloakFlash: 0,
    settings: { ...defaultSettings, ...load<Partial<Settings>>(LS.settings, {}) },
    downloads: load<DownloadItem[]>(LS.downloads, []).map((d) => ({ ...d, blobUrl: undefined })),
    jar: load<JarEntry[]>(LS.jar, []),
    exts: load<ExtensionMeta[]>(LS.exts, []),
    net: [],
    consoleLog: [],
    blocked: load<number>(LS.blocked, 0),
    latency: null,
    ctx: null,
    menuOpen: false,
  };
}

function patchTab(s: State, id: string, fn: (t: Tab) => Tab): State {
  return { ...s, tabs: s.tabs.map((t) => (t.id === id ? fn(t) : t)) };
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "new-tab": {
      const t = newTab();
      return { ...s, tabs: [...s.tabs, t], active: t.id, menuOpen: false };
    }
    case "close-tab": {
      const idx = s.tabs.findIndex((t) => t.id === a.id);
      if (idx < 0) return s;
      let tabs = s.tabs.filter((t) => t.id !== a.id);
      if (!tabs.length) tabs = [newTab()];
      const active =
        s.active === a.id ? tabs[Math.min(idx, tabs.length - 1)].id : s.active;
      return { ...s, tabs, active };
    }
    case "select":
      return { ...s, active: a.id, ctx: null };
    case "duplicate": {
      const src = s.tabs.find((t) => t.id === a.id);
      if (!src) return s;
      const t: Tab = { ...src, id: uid(), key: src.key + 1 };
      return { ...s, tabs: [...s.tabs, t], active: t.id, ctx: null, menuOpen: false };
    }
    case "close-others": {
      const keep = s.tabs.find((t) => t.id === a.id);
      if (!keep) return s;
      return { ...s, tabs: [keep], active: keep.id, ctx: null };
    }
    case "nav":
      return patchTab(s, a.id, (t) => {
        const hist = [...t.hist.slice(0, t.idx + 1), a.url];
        const host = hostOf(a.url);
        return {
          ...t,
          hist,
          idx: hist.length - 1,
          url: a.url,
          title: host || "New Tab",
          icon: faviconFor(host),
          status: a.url ? "loading" : "start",
          blocked: undefined,
          key: t.key + 1,
        };
      });
    case "back":
      return patchTab(s, a.id, (t) => {
        if (t.idx <= 0) return t;
        const idx = t.idx - 1;
        const url = t.hist[idx];
        return { ...t, idx, url, title: url ? hostOf(url) : "New Tab", icon: url ? faviconFor(hostOf(url)) : "", status: url ? "loading" : "start", blocked: undefined, key: t.key + 1 };
      });
    case "fwd":
      return patchTab(s, a.id, (t) => {
        if (t.idx >= t.hist.length - 1) return t;
        const idx = t.idx + 1;
        const url = t.hist[idx];
        return { ...t, idx, url, title: url ? hostOf(url) : "New Tab", icon: url ? faviconFor(hostOf(url)) : "", status: "loading", blocked: undefined, key: t.key + 1 };
      });
    case "reload":
      return patchTab(s, a.id, (t) =>
        t.url ? { ...t, key: t.key + 1, status: "loading", blocked: undefined } : t
      );
    case "loaded":
      return patchTab(s, a.id, (t) => ({ ...t, status: t.url ? "loaded" : "start" }));
    case "frame-blocked":
      return patchTab(s, a.id, (t) => ({ ...t, blocked: true, status: "loaded" }));
    case "frame-retry":
      return patchTab(s, a.id, (t) => ({ ...t, blocked: false, status: "loading", key: t.key + 1 }));
    case "panel":
      return { ...s, panel: s.panel === a.panel ? null : a.panel, menuOpen: false };
    case "cloak": {
      const on = a.on ?? !s.cloak;
      if (on === s.cloak) return s;
      return { ...s, cloak: on, cloakFlash: Date.now(), menuOpen: false };
    }
    case "settings":
      return { ...s, settings: { ...s.settings, ...a.patch }, menuOpen: false };
    case "download":
      return { ...s, downloads: [a.item, ...s.downloads].slice(0, 40) };
    case "download-status":
      return {
        ...s,
        downloads: s.downloads.map((d) =>
          d.id === a.id
            ? { ...d, status: a.status, size: a.size ?? d.size, blobUrl: a.blobUrl ?? d.blobUrl }
            : d
        ),
      };
    case "downloads-clear":
      return { ...s, downloads: [] };
    case "jar-add":
      return { ...s, jar: [a.entry, ...s.jar.filter((j) => j.name !== a.entry.name)] };
    case "jar-del":
      return { ...s, jar: s.jar.filter((j) => j.name !== a.name) };
    case "ext-add":
      return { ...s, exts: [a.meta, ...s.exts] };
    case "ext-toggle":
      return { ...s, exts: s.exts.map((e) => (e.id === a.id ? { ...e, enabled: !e.enabled } : e)) };
    case "ext-del":
      return { ...s, exts: s.exts.filter((e) => e.id !== a.id) };
    case "net":
      return {
        ...s,
        net: [a.entry, ...s.net].slice(0, 250),
        blocked: s.blocked + (a.entry.status === "blocked" ? 1 : 0),
      };
    case "net-clear":
      return { ...s, net: [] };
    case "console":
      return { ...s, consoleLog: [a.entry, ...s.consoleLog].slice(0, 300) };
    case "console-clear":
      return { ...s, consoleLog: [] };
    case "blocked-inc":
      return { ...s, blocked: s.blocked + a.n };
    case "latency":
      return { ...s, latency: a.ms };
    case "ctx":
      return { ...s, ctx: a.ctx, menuOpen: false };
    case "menu":
      return { ...s, menuOpen: a.open, ctx: null };
    case "wipe": {
      Object.values(LS).forEach((k) => localStorage.removeItem(k));
      return s;
    }
    default:
      return s;
  }
}

/* -------------------------------------------------------------- context */

const Ctx = createContext<{ s: State; d: React.Dispatch<Action> } | null>(null);

export function useBrowser() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBrowser outside provider");
  return v;
}

export function activePreset(s: State) {
  const { presetId, customTitle, customIcon } = s.settings;
  const base = CLOAK_PRESETS.find((p) => p.id === presetId) ?? CLOAK_PRESETS[0];
  if (base.id === "custom")
    return {
      id: "custom",
      name: "Custom",
      title: customTitle || "New Tab",
      icon: customIcon || "",
    };
  return base;
}

export function BrowserProvider({ children }: { children: React.ReactNode }) {
  const [s, d] = useReducer(reducer, undefined, initialState);
  const sRef = useRef(s);
  sRef.current = s;

  /* persistence */
  useEffect(() => localStorage.setItem(LS.settings, JSON.stringify(s.settings)), [s.settings]);
  useEffect(() => localStorage.setItem(LS.jar, JSON.stringify(s.jar)), [s.jar]);
  useEffect(() => localStorage.setItem(LS.exts, JSON.stringify(s.exts)), [s.exts]);
  useEffect(() => {
    localStorage.setItem(
      LS.downloads,
      JSON.stringify(s.downloads.map(({ blobUrl: _b, ...rest }) => rest))
    );
  }, [s.downloads]);
  useEffect(() => localStorage.setItem(LS.blocked, JSON.stringify(s.blocked)), [s.blocked]);

  /* cloak — document.title + favicon masquerade */
  useEffect(() => {
    const preset = activePreset(s);
    document.title = s.cloak ? preset.title : APP_TITLE;
    const link = document.getElementById("favicon") as HTMLLinkElement | null;
    if (link) {
      const icon = s.cloak ? preset.icon : "";
      if (icon) link.href = icon;
      else
        link.href =
          "data:image/svg+xml," +
          encodeURIComponent(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#0C1016'/><path d='M32 13c-8.9 0-15.2 7-15.2 16.8V51l6.1-4.6 5.1 4.6 4-3.6 4 3.6 5.1-4.6L47.2 51V29.8C47.2 20 40.9 13 32 13z' fill='#45E0A8'/><circle cx='26.2' cy='30' r='2.7' fill='#0C1016'/><circle cx='37.8' cy='30' r='2.7' fill='#0C1016'/></svg>"
          );
    }
  }, [s.cloak, s.settings]);

  /* console tap */
  useEffect(() => onConsoleEntry((entry) => d({ type: "console", entry })), []);

  /* service worker + net feed */
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("sw.js", { scope: "./" })
      .then(() => console.info("[wraith] service worker registered (scoped interception live)"))
      .catch((e) => console.warn("[wraith] sw registration failed:", String(e)));

    const onMsg = (ev: MessageEvent) => {
      const m = ev.data ?? {};
      if (m.type === "net") {
        d({
          type: "net",
          entry: {
            id: uid(),
            ts: Date.now(),
            method: m.method ?? "GET",
            host: m.host ?? "",
            path: m.path ?? "",
            rtype: m.rtype ?? "fetch",
            size: m.size ?? 0,
            status: m.blocked ? "blocked" : "ok",
            src: "sw",
          },
        });
      } else if (m.type === "pong") {
        d({ type: "latency", ms: Math.max(1, Math.round(performance.now() - m.t)) });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);

  /* latency probe to the worker */
  useEffect(() => {
    const tick = () => {
      const ctl = navigator.serviceWorker?.controller;
      if (ctl) ctl.postMessage({ type: "ping", t: performance.now() });
    };
    tick();
    const iv = setInterval(tick, 2500);
    return () => clearInterval(iv);
  }, []);

  /* panic key */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === sRef.current.settings.panicKey) {
        e.preventDefault();
        d({ type: "cloak" });
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        document.getElementById("omnibox")?.focus();
        (document.getElementById("omnibox") as HTMLInputElement | null)?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* auto-cloak when the window loses focus */
  useEffect(() => {
    const onBlur = () => {
      if (sRef.current.settings.autoCloak && !sRef.current.cloak) d({ type: "cloak", on: true });
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  const value = useMemo(() => ({ s, d }), [s]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
