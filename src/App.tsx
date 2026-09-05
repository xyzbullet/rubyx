import { useEffect } from "react";
import { BrowserProvider, useBrowser } from "./state";
import { ContextMenuLayer, StatusBar, TabBar, Toolbar } from "./components/Chrome";
import StartPage from "./components/StartPage";
import { CookiesPanel, DownloadsPanel, ExtensionsPanel, SettingsPanel } from "./components/Panels";
import InspectorPanel from "./components/Inspector";
import { buildLists, engine } from "./lib/engine";

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
            <iframe
              key={`${t.id}:${t.key}`}
              title={t.title}
              src={t.url}
              className={`frame ${t.id === s.active ? "" : "hidden"}`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-downloads"
              referrerPolicy="no-referrer"
              onLoad={() => d({ type: "loaded", id: t.id })}
            />
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
