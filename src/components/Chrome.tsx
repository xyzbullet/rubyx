import React, { useEffect, useState } from "react";
import {
  activePreset,
  useBrowser,
  type Tab,
} from "../state";
import { fmtClock, hostOf, normalizeUrl, uid } from "../lib/lib";
import { engine } from "../lib/engine";

/* ------------------------------------------------------------- icon set */

const P: Record<string, React.ReactNode> = {
  back: <path d="M15 6l-6 6 6 6" />,
  fwd: <path d="M9 6l6 6-6 6" />,
  reload: (
    <>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 3v5h-5" />
    </>
  ),
  home: <path d="M4 11l8-7 8 7v9h-5v-6h-6v6H4z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  shield: <path d="M12 3l7 3v5c0 5-3.2 8.4-7 10-3.8-1.6-7-5-7-10V6z" />,
  shieldDot: (
    <>
      <path d="M12 3l7 3v5c0 5-3.2 8.4-7 10-3.8-1.6-7-5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  dl: (
    <>
      <path d="M12 3v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  puzzle: (
    <path d="M9 4a2 2 0 1 1 4 0h3v3a2 2 0 1 1 0 4v3h-3a2 2 0 1 0-4 0H6v-3a2 2 0 1 0 0-4V4h3z" />
  ),
  term: (
    <>
      <path d="M4 6l6 6-6 6" />
      <path d="M12 19h8" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </>
  ),
  dots: (
    <>
      <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  mask: (
    <>
      <path d="M4 6c3-1.5 13-1.5 16 0v6c0 4-3 7-8 9-5-2-8-5-8-9z" />
      <path d="M8 11c1-.8 2.5-.8 3.5 0M12.5 11c1-.8 2.5-.8 3.5 0" />
    </>
  ),
  cookie: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17 4 4 0 0 1 0-8.5 4.25 4.25 0 0 1 0-8.5z" />
      <circle cx="14.5" cy="14.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10" cy="15.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" transform="translate(2 2) scale(0.92)" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  zap: <path d="M13 2L4 14h6l-1 8 9-12h-6z" />,
  file: (
    <>
      <path d="M6 2h8l5 5v15H6z" />
      <path d="M14 2v5h5" />
    </>
  ),
  dup: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </>
  ),
  open: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4L10 14" />
      <path d="M19 13v7H4V5h7" />
    </>
  ),
};

export function Ic({ n, s = 16, sw = 1.7 }: { n: keyof typeof P | string; s?: number; sw?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[n]}
    </svg>
  );
}

export function GhostMark({ s = 26 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="#151B25" stroke="#243042" />
      <path
        d="M32 13c-8.9 0-15.2 7-15.2 16.8V51l6.1-4.6 5.1 4.6 4-3.6 4 3.6 5.1-4.6L47.2 51V29.8C47.2 20 40.9 13 32 13z"
        fill="#45E0A8"
      />
      <circle cx="26.2" cy="30" r="2.7" fill="#0C1016" />
      <circle cx="37.8" cy="30" r="2.7" fill="#0C1016" />
    </svg>
  );
}

/* ------------------------------------------------------------- tab bar */

export function TabBar() {
  const { s, d } = useBrowser();
  return (
    <div
      className="flex items-end gap-1 px-2 pt-[6px] bg-bg1 select-none"
      onContextMenu={(e) => {
        e.preventDefault();
        d({ type: "ctx", ctx: { x: e.clientX, y: e.clientY, kind: "chrome" } });
      }}
    >
      {s.tabs.map((t) => {
        const active = t.id === s.active;
        return (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            onClick={() => d({ type: "select", id: t.id })}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              d({ type: "ctx", ctx: { x: e.clientX, y: e.clientY, kind: "tab", tabId: t.id } });
            }}
            className={`group relative flex h-[30px] min-w-[118px] max-w-[198px] flex-1 cursor-pointer items-center gap-2 rounded-t-[7px] border border-b-0 px-2.5 transition-colors duration-150 ${
              active
                ? "border-edge bg-panel text-ink"
                : "border-transparent text-mute hover:bg-panel2/60 hover:text-ink"
            }`}
          >
            {active && <span className="absolute left-2.5 right-2.5 top-0 h-[2px] rounded-full bg-mint" />}
            {t.url ? (
              <img
                src={t.icon}
                alt=""
                className="h-[15px] w-[15px] shrink-0 rounded-[3px]"
                onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
              />
            ) : (
              <GhostMark s={15} />
            )}
            <span className="flex-1 truncate text-[12px] font-medium leading-none">
              {t.title || "New Tab"}
            </span>
            {t.status === "loading" ? (
              <span className="spin h-3 w-3 shrink-0 rounded-full border-[1.5px] border-edge2 border-t-mint" />
            ) : (
              <button
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-dim opacity-0 transition-opacity hover:bg-raise hover:text-ink group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  d({ type: "close-tab", id: t.id });
                }}
                title="Close tab"
              >
                <Ic n="x" s={10} sw={2.2} />
              </button>
            )}
          </div>
        );
      })}
      <button className="btn-icon mb-[3px] ml-1" onClick={() => d({ type: "new-tab" })} title="New tab (Ctrl+T)">
        <Ic n="plus" s={15} />
      </button>
      <div className="flex-1" />
      <button
        onClick={() => d({ type: "cloak" })}
        className={`chip mb-[5px] ${s.cloak ? "warn" : ""}`}
        title={`Tab cloak — panic key: ${keyLabel(s.settings.panicKey)}`}
      >
        <Ic n="mask" s={12} sw={1.8} />
        {s.cloak ? `CLOAKED · ${activePreset(s).name}` : "CLOAK"}
      </button>
    </div>
  );
}

export function keyLabel(code: string): string {
  return code === "Backquote" ? "`" : code;
}

/* ------------------------------------------------------------- toolbar */

export function Toolbar() {
  const { s, d } = useBrowser();
  const tab = s.tabs.find((t) => t.id === s.active) as Tab;
  const [val, setVal] = useState(tab.url);
  useEffect(() => setVal(tab.url), [tab.url, tab.id, tab.key]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const u = normalizeUrl(val);
    if (u) d({ type: "nav", id: tab.id, url: u });
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const panelBtn = (panel: NonNullable<typeof s.panel>, icon: string, title: string, badge?: number) => (
    <button
      className={`btn-icon relative ${s.panel === panel ? "bg-panel2 text-mint" : ""}`}
      onClick={() => d({ type: "panel", panel })}
      title={title}
    >
      <Ic n={icon} s={16} />
      {!!badge && badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-[13px] min-w-[13px] items-center justify-center rounded-full bg-mint px-1 font-mono text-[8.5px] font-semibold text-bg0">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );

  return (
    <div className="relative flex items-center gap-2 border-b border-edge bg-panel px-2 py-[7px]">
      <button className="btn-icon" disabled={tab.idx <= 0} onClick={() => d({ type: "back", id: tab.id })} title="Back">
        <Ic n="back" />
      </button>
      <button
        className="btn-icon"
        disabled={tab.idx >= tab.hist.length - 1}
        onClick={() => d({ type: "fwd", id: tab.id })}
        title="Forward"
      >
        <Ic n="fwd" />
      </button>
      <button className="btn-icon" onClick={() => d({ type: "reload", id: tab.id })} title="Reload" disabled={!tab.url}>
        <Ic n="reload" />
      </button>
      <button className="btn-icon" onClick={() => d({ type: "nav", id: tab.id, url: "" })} title="Start page">
        <Ic n="home" s={15} />
      </button>

      <form onSubmit={submit} className="group relative flex h-[34px] min-w-0 flex-1 items-center">
        <div className="flex h-full w-full items-center overflow-hidden rounded-[7px] border border-edge bg-bg1 pl-1.5 pr-2 transition-all focus-within:border-mint focus-within:shadow-[0_0_0_3px_rgba(69,224,168,0.12)]">
          <button
            type="button"
            onClick={() => d({ type: "settings", patch: { adblock: !s.settings.adblock } })}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] transition-colors ${
              s.settings.adblock ? "text-mint hover:bg-mintd/40" : "text-dim hover:bg-panel2 hover:text-mute"
            }`}
            title={s.settings.adblock ? `Shields ON — ${engine.stats().total} filters loaded` : "Shields OFF — click to enable"}
          >
            <Ic n={s.settings.adblock ? "shieldDot" : "shield"} s={16} />
          </button>
          <input
            id="omnibox"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onFocus={(e) => e.target.select()}
            spellCheck={false}
            autoComplete="off"
            placeholder="Search or tunnel a URL…"
            className="h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-[12.5px] text-ink placeholder:text-dim"
          />
          {s.cloak && (
            <span className="flex shrink-0 items-center gap-1 rounded border border-amber/40 bg-amber/10 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-amber">
              <Ic n="mask" s={10} sw={2} /> MASQ
            </span>
          )}
        </div>
      </form>

      <div className="flex items-center gap-0.5">
        {panelBtn("downloads", "dl", "Downloads", s.downloads.length)}
        {panelBtn("cookies", "cookie", "Cookies & scoped jar")}
        {panelBtn("extensions", "puzzle", "Extensions", s.exts.filter((e) => e.enabled).length)}
        {panelBtn("inspector", "term", "Inspector (Ctrl+Shift+I)")}
        {panelBtn("settings", "gear", "Settings")}
        <button
          className={`btn-icon ${s.menuOpen ? "bg-panel2 text-ink" : ""}`}
          onClick={() => d({ type: "menu", open: !s.menuOpen })}
          title="Menu"
        >
          <Ic n="dots" s={16} />
        </button>
      </div>

      {s.menuOpen && <Menu />}
    </div>
  );
}

function Menu() {
  const { s, d } = useBrowser();
  const tab = s.tabs.find((t) => t.id === s.active) as Tab;
  const Row = ({
    icon,
    label,
    hint,
    danger,
    fn,
  }: {
    icon: string;
    label: string;
    hint?: string;
    danger?: boolean;
    fn: () => void;
  }) => (
    <button
      onClick={fn}
      className={`flex w-full items-center gap-2.5 px-3 py-[7px] text-left text-[12.5px] transition-colors ${
        danger ? "text-red hover:bg-red/10" : "text-ink hover:bg-panel2"
      }`}
    >
      <span className={danger ? "text-red" : "text-mute"}>
        <Ic n={icon} s={14} />
      </span>
      <span className="flex-1">{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  );
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => d({ type: "menu", open: false })} onContextMenu={(e) => { e.preventDefault(); d({ type: "menu", open: false }); }} />
      <div className="pop-in absolute right-2 top-[46px] z-50 w-[248px] overflow-hidden rounded-lg border border-edge bg-panel py-1 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
        <Row icon="plus" label="New tab" hint="Ctrl+T" fn={() => d({ type: "new-tab" })} />
        <Row icon="dup" label="Duplicate tab" fn={() => d({ type: "duplicate", id: tab.id })} />
        <div className="my-1 h-px bg-edge" />
        <Row icon="mask" label={s.cloak ? "Disable cloak" : `Enable cloak — ${activePreset(s).name}`} hint={keyLabel(s.settings.panicKey)} fn={() => d({ type: "cloak" })} />
        <div className="my-1 h-px bg-edge" />
        <Row icon="dl" label="Downloads" fn={() => d({ type: "panel", panel: "downloads" })} />
        <Row icon="cookie" label="Cookies" fn={() => d({ type: "panel", panel: "cookies" })} />
        <Row icon="puzzle" label="Extensions" fn={() => d({ type: "panel", panel: "extensions" })} />
        <Row icon="term" label="Inspector" hint="Ctrl+⇧+I" fn={() => d({ type: "panel", panel: "inspector" })} />
        <Row icon="gear" label="Settings" fn={() => d({ type: "panel", panel: "settings" })} />
        <div className="my-1 h-px bg-edge" />
        <Row
          icon="trash"
          label="Wipe session traces"
          danger
          fn={() => {
            d({ type: "wipe" });
            setTimeout(() => location.reload(), 60);
          }}
        />
      </div>
    </>
  );
}

/* ----------------------------------------------------------- status bar */

export function StatusBar() {
  const { s } = useBrowser();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  const tab = s.tabs.find((t) => t.id === s.active) as Tab;
  const bytes = s.net.reduce((a, n) => a + (n.size || 0), 0);
  const host = tab.url ? hostOf(tab.url) : "wraith://start";
  const st = engine.stats();
  return (
    <div className="flex h-[26px] shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-edge bg-bg1 px-3 font-mono text-[10.5px] tracking-wide text-dim select-none">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span className={`pulse-dot h-[7px] w-[7px] rounded-full ${s.latency != null ? "bg-mint" : "bg-edge2"}`} />
          WISP/{s.settings.transport === "ws" ? "WS" : "POLL"}
        </span>
        <span className="hidden text-mute sm:inline">{s.settings.gateway ? hostOf(s.settings.gateway) : "local-sim"}</span>
        <span className="tabular text-mute">{s.latency != null ? `${s.latency}ms` : "—"}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2 truncate">
        <span className="truncate text-mute">{host}</span>
        <span className="text-mint">▸ TUNNELED</span>
        {s.cloak && <span className="rounded-sm border border-amber/40 bg-amber/10 px-1 text-amber">CLOAKED</span>}
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden md:inline">ENGINE·JS-FALLBACK</span>
        <span className="hidden text-mute md:inline">{st.total} rules</span>
        <span className="text-amber">{s.blocked} blk</span>
        <span className="hidden text-mute lg:inline">{(bytes / 1024).toFixed(1)}KB</span>
        <span className="tabular text-mute">{fmtClock(now)}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- context menu */

interface Item {
  icon: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  sep?: boolean;
  fn: () => void;
}

export function ContextMenuLayer() {
  const { s, d } = useBrowser();
  const ctx = s.ctx;
  if (!ctx) return null;
  const tab = s.tabs.find((t) => t.id === (ctx.tabId ?? s.active)) as Tab;

  const savePage = () => {
    d({ type: "ctx", ctx: null });
    if (!tab.url) return;
    const id = uid();
    d({
      type: "download",
      item: { id, name: hostOf(tab.url) + ".html", url: tab.url, size: 0, mime: "text/html", status: "intercepted", ts: Date.now() },
    });
    fetch(tab.url, { mode: "cors" })
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = url;
        a.download = hostOf(tab.url) + ".html";
        document.body.appendChild(a);
        a.click();
        a.remove();
        d({ type: "download-status", id, status: "complete", size: b.size, blobUrl: url });
      })
      .catch(() => d({ type: "download-status", id, status: "blocked" }));
  };

  let items: Item[];
  if (ctx.kind === "tab") {
    items = [
      { icon: "open", label: "Open tab", fn: () => d({ type: "select", id: tab.id }) },
      { icon: "dup", label: "Duplicate tab", fn: () => d({ type: "duplicate", id: tab.id }) },
      { icon: "x", label: "Close tab", danger: true, fn: () => d({ type: "close-tab", id: tab.id }) },
      { icon: "x", label: "Close other tabs", danger: true, fn: () => d({ type: "close-others", id: tab.id }) },
    ];
  } else {
    items = [
      { icon: "back", label: "Back", hint: "Alt+←", disabled: tab.idx <= 0, fn: () => d({ type: "back", id: tab.id }) },
      { icon: "fwd", label: "Forward", hint: "Alt+→", disabled: tab.idx >= tab.hist.length - 1, fn: () => d({ type: "fwd", id: tab.id }) },
      { icon: "reload", label: "Reload", disabled: !tab.url, fn: () => d({ type: "reload", id: tab.id }) },
      { icon: "", label: "", sep: true, fn: () => {} },
      { icon: "plus", label: "New tab", hint: "Ctrl+T", fn: () => d({ type: "new-tab" }) },
      { icon: "dup", label: "Duplicate tab", fn: () => d({ type: "duplicate", id: tab.id }) },
      { icon: "", label: "", sep: true, fn: () => {} },
      { icon: "mask", label: s.cloak ? "Disable cloak" : "Toggle cloak", hint: keyLabel(s.settings.panicKey), fn: () => d({ type: "cloak" }) },
      { icon: "file", label: "Save page as…", disabled: !tab.url, fn: savePage },
      { icon: "copy", label: "Copy page URL", disabled: !tab.url, fn: () => { void navigator.clipboard?.writeText(tab.url).catch(() => {}); } },
      { icon: "", label: "", sep: true, fn: () => {} },
      { icon: "eye", label: "Inspect element", hint: "Ctrl+⇧+I", fn: () => d({ type: "panel", panel: "inspector" }) },
    ];
  }

  const x = Math.min(ctx.x, window.innerWidth - 236);
  const y = Math.min(ctx.y, window.innerHeight - items.length * 33 - 14);

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        onClick={() => d({ type: "ctx", ctx: null })}
        onContextMenu={(e) => {
          e.preventDefault();
          d({ type: "ctx", ctx: null });
        }}
      />
      <div
        className="pop-in fixed z-[61] w-[224px] overflow-hidden rounded-lg border border-edge bg-panel py-1 shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
        style={{ left: x, top: y }}
      >
        {items.map((it, i) =>
          it.sep ? (
            <div key={i} className="my-1 h-px bg-edge" />
          ) : (
            <button
              key={i}
              disabled={it.disabled}
              onClick={() => {
                d({ type: "ctx", ctx: null });
                it.fn();
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-[6.5px] text-left text-[12.5px] transition-colors disabled:pointer-events-none disabled:opacity-35 ${
                it.danger ? "text-red hover:bg-red/10" : "text-ink hover:bg-panel2"
              }`}
            >
              <span className={it.danger ? "text-red" : "text-mute"}>{it.icon && <Ic n={it.icon} s={14} />}</span>
              <span className="flex-1">{it.label}</span>
              {it.hint && <kbd>{it.hint}</kbd>}
            </button>
          )
        )}
      </div>
    </>
  );
}
