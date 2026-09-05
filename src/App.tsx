import { useEffect, useState, type SyntheticEvent } from "react";
import { BrowserProvider, useBrowser, type Action, type Tab } from "./state";
import { ContextMenuLayer, Ic, StatusBar, TabBar, Toolbar } from "./components/Chrome";
import StartPage from "./components/StartPage";
import { CookiesPanel, DownloadsPanel, ExtensionsPanel, SettingsPanel } from "./components/Panels";
import InspectorPanel from "./components/Inspector";
import { buildLists, engine } from "./lib/engine";
import { toProxyUrl } from "./lib/proxy";
import { hostOf } from "./lib/lib";

/* ---------------------------------------------------------------- frames */

function FrameView({ tab, active, d, swReady }: { tab: Tab; active: boolean; d: (a: Action) => void; swReady: boolean }) {
  /* If this tab was refused before the SW owned the scope, retry through
     the rewriting proxy the moment it comes online. */
  useEffect(() => {
    if (swReady && tab.blocked) d({ type: "frame-retry", id: tab.id });
  }, [swReady]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Heuristic: a real cross-origin page throws SecurityError when we touch
     contentWindow.location. An X-Frame-Options / CSP-refused frame stays at
     about:blank, where href reads back as '' — that's our refusal signal. */
  const onLoad = (e: SyntheticEvent<HTMLIFrameElement>) => {
    d({ type: "loaded", id: tab.id });
    if (!/^https?:/i.test(tab.url)) return;
    const win = (e.target as HTMLIFrameElement).contentWindow;
    window.setTimeout(() => {
      try {
        const href = win?.location?.href;
        if (!href || href === "about:blank") d({ type: "frame-blocked", id: tab.id });
      } catch {
        /* SecurityError = a real page loaded through the tunnel — all good */
      }
    }, 900);
  };

  return (
    <div className={`relative h-full ${active ? "" : "hidden"}`}>
      <iframe
        key={`${tab.id}:${tab.key}`}
        title={tab.title}
        src={swReady ? toProxyUrl(tab.url) : tab.url}
        className="frame"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-downloads"
        referrerPolicy="no-referrer"
        onLoad={onLoad}
      />
      {tab.blocked && active && <BlockedOverlay tab={tab} d={d} />}
    </div>
  );
}

function BlockedOverlay({ tab, d }: { tab: Tab; d: (a: Action) => void }) {
  const host = hostOf(tab.url);
  const act = "rounded-md border px-3 py-2 text-[12px] font-semibold transition-colors";
  return (
    <div className="fade-in absolute inset-0 z-20 flex items-center justify-center overflow-y-auto bg-bg0/95 p-6">
      <div className="w-full max-w-[460px] rounded-lg border border-amber/35 bg-panel p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-amber/40 bg-amber/10 text-amber">
            <Ic n="shield" s={20} />
          </span>
          <div>
            <div className="font-display text-[16px] font-bold leading-tight text-ink">Frame embedding refused</div>
            <div className="mt-0.5 font-mono text-[10px] tracking-wider text-amber">{host} · XFO / CSP FRAME-ANCESTORS</div>
          </div>
        </div>
        <p className="mt-4 text-[12.5px] leading-relaxed text-mute">
          <span className="text-ink">{host}</span> instructs browsers to block in-page embedding. The tunnel still
          reaches it — pick how to proceed:
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            className={`${act} border-mint/45 bg-mint/10 text-mint hover:bg-mint/20`}
            onClick={() => window.open(tab.url, "_blank", "noopener")}
          >
            Open direct ↗
          </button>
          <button
            className={`${act} border-blue/45 bg-blue/10 text-blue hover:bg-blue/20`}
            onClick={() => d({ type: "nav", id: tab.id, url: "https://txtify.it/" + tab.url })}
          >
            View as text
          </button>
          <button className={`${act} border-edge bg-bg1 text-ink hover:bg-panel2`} onClick={() => d({ type: "frame-retry", id: tab.id })}>
            Retry embed
          </button>
          <button
            className={`${act} border-edge bg-bg1 text-mute hover:bg-panel2`}
            onClick={() => {
              void navigator.clipboard?.writeText(tab.url).catch(() => {});
            }}
          >
            Copy URL
          </button>
        </div>
        <p className="mt-4 border-t border-edge pt-3 font-mono text-[9.5px] leading-relaxed text-dim">
          FULL REWRITE MODE — run the wisp node (server/) behind deploy/: request-level tunneling strips framing
          headers so every host renders inline, not just embed-friendly ones.
        </p>
      </div>
    </div>
  );
}

function Shell() {
  const { s, d } = useBrowser();

  /* load the filter engine whenever shield configuration changes, and push
     the strict-block host set down to the service worker */
  useEffect(() => {
    const cfg = s.settings;
    engine.load(buildLists(cfg));

    const hosts = engine.rules
      .filter((r): r is Extract<typeof r, { kind: "net" }> => r.kind === "net" && !r.whitelist)
      .map((r) => r.raw)
      .filter((raw) => raw.startsWith("||"))
      .map((raw) => raw.slice(2).split("^")[0].split("/")[0])
      .filter(Boolean);
    navigator.serviceWorker?.controller?.postMessage({
      type: "set-blocklist",
      enabled: cfg.adblock,
      hosts,
    });
  }, [s.settings.adblock, s.settings.lists, s.settings.customList]);

  /* proxied links only work once the SW owns the scope */
  const [swReady, setSwReady] = useState(!!navigator.serviceWorker?.controller);
  useEffect(() => {
    navigator.serviceWorker?.ready.then(() => setSwReady(true)).catch(() => {});
  }, []);

  /* theme — flips the variable set the whole shell keys off */
  useEffect(() => {
    document.documentElement.classList.toggle("light", s.settings.theme === "light");
  }, [s.settings.theme]);

  /* ask the SW to open the encrypted wisp tunnel */
  useEffect(() => {
    navigator.serviceWorker?.controller?.postMessage({
      type: "connect-tunnel",
      gateway: s.settings.transport === "ws" ? s.settings.gateway : "",
    });
  }, [s.settings.gateway, s.settings.transport]);

  /* browser-grade keybindings */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "t") {
        e.preventDefault();
        d({ type: "new-tab" });
      } else if (k === "i" && e.shiftKey) {
        e.preventDefault();
        d({ type: "panel", panel: "inspector" });
      } else if (k === "w") {
        e.preventDefault();
        d({ type: "close-tab", id: s.active });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.active, d]);

  const closePanel = () => d({ type: "panel", panel: null });

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg0">
      <TabBar />
      <Toolbar />

      <main
        className="relative min-h-0 flex-1"
        onContextMenu={(e) => {
          e.preventDefault();
          d({ type: "ctx", ctx: { x: e.clientX, y: e.clientY, kind: "chrome" } });
        }}
      >
        {s.tabs.map((t) =>
          t.url === "" ? (
            <div key={t.id} className={t.id === s.active ? "h-full" : "hidden"}>
              {t.id === s.active && <StartPage />}
            </div>
          ) : (
            <FrameView key={t.id} tab={t} active={t.id === s.active} d={d} swReady={swReady} />
          )
        )}

        {s.panel === "downloads" && <DownloadsPanel onClose={closePanel} />}
        {s.panel === "cookies" && <CookiesPanel onClose={closePanel} />}
        {s.panel === "extensions" && <ExtensionsPanel onClose={closePanel} />}
        {s.panel === "settings" && <SettingsPanel onClose={closePanel} />}
        {s.panel === "inspector" && <InspectorPanel onClose={closePanel} />}

        {s.cloak && <div key={s.cloakFlash} className="cloak-sweep" />}
      </main>

      <StatusBar />
      <ContextMenuLayer />
    </div>
  );
}

export default function App() {
  return (
    <BrowserProvider>
      <Shell />
    </BrowserProvider>
  );
}
