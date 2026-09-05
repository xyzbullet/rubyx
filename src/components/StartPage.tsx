import { useEffect, useMemo, useRef, useState } from "react";
import { activePreset, useBrowser } from "../state";
import {
  CLOAK_PRESETS,
  faviconFor,
  fmtBytes,
  fmtClock,
  fmtUptime,
  hostOf,
  normalizeUrl,
} from "../lib/lib";
import { buildLists, engine } from "../lib/engine";
import { SITES, SITE_CATS, type SiteCat } from "../lib/sites";
import { GhostMark, Ic, keyLabel } from "./Chrome";

function Sparkline({ samples }: { samples: number[] }) {
  const w = 132;
  const h = 30;
  const max = Math.max(4, ...samples);
  const pts = samples
    .map((v, i) => `${((i / Math.max(1, samples.length - 1)) * w).toFixed(1)},${(h - 3 - (v / max) * (h - 7)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke="#45E0A8" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
      {samples.length > 0 && (
        <circle cx={w} cy={h - 3 - (samples[samples.length - 1] / max) * (h - 7)} r="2.4" fill="#45E0A8" className="rise-glow" />
      )}
    </svg>
  );
}

export default function StartPage() {
  const { s, d } = useBrowser();
  const [val, setVal] = useState("");
  const [now, setNow] = useState(Date.now());
  const [samples, setSamples] = useState<number[]>([]);
  const [cat, setCat] = useState<"all" | SiteCat>("all");
  const [q, setQ] = useState("");
  const start = useRef(Date.now());
  const st = useMemo(() => {
    engine.load(buildLists(s.settings));
    return engine.stats();
  }, [s.settings]);
  const bytes = s.net.reduce((a, n) => a + (n.size || 0), 0);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      setSamples((p) => [...p.slice(-39), s.latency != null ? s.latency : 1 + Math.random() * 2]);
    }, 850);
    return () => clearInterval(iv);
  }, [s.latency]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const u = normalizeUrl(val);
    if (u) d({ type: "nav", id: s.active, url: u });
  };

  const preset = activePreset(s);
  const ql = q.trim().toLowerCase();
  const filtered = SITES.filter(
    (x) =>
      (cat === "all" || x.cat === cat) &&
      (!ql || x.name.toLowerCase().includes(ql) || hostOf(x.url).includes(ql) || (x.tag ?? "").toLowerCase().includes(ql))
  );

  return (
    <div
      className="deck-bg noise relative h-full overflow-y-auto"
      onContextMenu={(e) => {
        e.preventDefault();
        d({ type: "ctx", ctx: { x: e.clientX, y: e.clientY, kind: "chrome" } });
      }}
    >
      <div className="relative mx-auto max-w-[1120px] px-8 pb-14 pt-10">
        {/* masthead */}
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-3.5">
            <GhostMark s={40} />
            <div>
              <div className="flex items-baseline gap-3">
                <h1 className="font-display text-[26px] font-bold leading-none tracking-[0.22em] text-ink">WRAITH</h1>
                <span className="rounded border border-mint/35 bg-mint/8 px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.14em] text-mint">
                  WISP-CORE 0.9.2
                </span>
              </div>
              <p className="mt-1.5 font-mono text-[10.5px] tracking-[0.16em] text-dim">
                STEALTH PROXY SHELL — SCOPED SW · WASM REWRITE · TAB CLOAK
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="font-mono text-[13px] tabular text-mute">{fmtClock(now)}</span>
            <span className={`chip ${s.cloak ? "warn" : ""}`}>
              <Ic n="mask" s={11} sw={2} />
              {s.cloak ? `MASQUERADING · ${preset.name}` : "IDENTITY · REAL"}
            </span>
          </div>
        </div>

        {/* omnibox */}
        <form onSubmit={submit} className="mt-9">
          <label className="mb-2 block font-mono text-[10px] tracking-[0.2em] text-dim">
            OMNIBOX — EVERY HOST TUNNELS, NOT JUST THE DIRECTORY
          </label>
          <div className="group flex h-[54px] items-center gap-3 rounded-lg border border-edge bg-panel px-4 transition-all focus-within:border-mint focus-within:shadow-[0_0_0_4px_rgba(69,224,168,0.1)]">
            <span className="text-mint">
              <Ic n="zap" s={18} />
            </span>
            <input
              autoFocus
              value={val}
              onChange={(e) => setVal(e.target.value)}
              placeholder="type any host or search — youtube.com, reddit.com, anything…"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent font-mono text-[14px] text-ink placeholder:text-dim"
            />
            <span className="hidden items-center gap-1.5 text-dim sm:flex">
              <kbd>↵</kbd> tunnel
            </span>
          </div>
          <p className="mt-2 font-mono text-[9.5px] tracking-[0.1em] text-dim">
            SITES THAT REFUSE FRAMING (XFO/CSP) ARE DETECTED LIVE AND OFFER DIRECT-MODE + TEXT-MODE FALLBACK
          </p>
        </form>

        {/* deck grid */}
        <div className="mt-9 grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* directory */}
          <div>
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[10px] tracking-[0.2em] text-dim">
                SITE DIRECTORY — {filtered.length}/{SITES.length} NODES
              </span>
              <div className="relative">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="filter directory…"
                  spellCheck={false}
                  className="field field-mono !w-[190px] !py-1.5 !text-[11px]"
                />
              </div>
            </div>

            <div className="mb-3 flex flex-wrap gap-1.5">
              <button className={`chip ${cat === "all" ? "on" : ""}`} onClick={() => setCat("all")}>
                ALL · {SITES.length}
              </button>
              {SITE_CATS.map((c) => {
                const n = SITES.filter((x) => x.cat === c.id).length;
                return (
                  <button key={c.id} className={`chip ${cat === c.id ? "on" : ""}`} onClick={() => setCat(cat === c.id ? "all" : c.id)}>
                    {c.label.toUpperCase()} · {n}
                  </button>
                );
              })}
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-md border border-dashed border-edge p-8 text-center">
                <div className="font-mono text-[11px] text-mute">no directory match for “{q}”</div>
                <button
                  className="mt-3 rounded-md border border-mint/45 bg-mint/10 px-3 py-1.5 text-[12px] font-semibold text-mint hover:bg-mint/20"
                  onClick={() => {
                    const u = normalizeUrl(q) ?? `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
                    d({ type: "nav", id: s.active, url: u });
                  }}
                >
                  Tunnel “{q}” anyway ↵
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                {filtered.map((t) => (
                  <button
                    key={t.url}
                    onClick={() => d({ type: "nav", id: s.active, url: t.url })}
                    className="group flex flex-col items-start gap-2.5 rounded-md border border-edge bg-panel p-3 text-left transition-all duration-150 hover:-translate-y-[2px] hover:border-mint/45 hover:shadow-[0_10px_28px_rgba(0,0,0,0.35)]"
                  >
                    <div className="flex w-full items-center justify-between">
                      <img
                        src={faviconFor(hostOf(t.url))}
                        alt=""
                        className="h-[18px] w-[18px] rounded-[4px]"
                        onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                      />
                      <span
                        className={`rounded-sm border px-1 py-px font-mono text-[8px] tracking-[0.12em] ${
                          t.direct ? "border-amber/45 text-amber" : "border-mint/40 text-mint"
                        }`}
                      >
                        {t.direct ? "DIRECT" : "EMBED"}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-semibold text-ink group-hover:text-mint">{t.name}</div>
                      <div className="mt-0.5 truncate font-mono text-[9.5px] tracking-wider text-dim">
                        {hostOf(t.url)}
                        {t.tag ? ` · ${t.tag}` : ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-7 mb-2.5 font-mono text-[10px] tracking-[0.2em] text-dim">KEYBOARD PROTOCOL</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-edge bg-panel/60 p-3.5 sm:grid-cols-3">
              {[
                ["Ctrl+L", "focus omnibox"],
                ["Ctrl+T", "new tab"],
                [keyLabel(s.settings.panicKey), "panic — cloak now"],
                ["Ctrl+⇧+I", "inspector"],
                ["Alt+←/→", "back / forward"],
                ["RMB", "context deck"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-2 text-[11.5px] text-mute">
                  <span>{v}</span>
                  <kbd>{k}</kbd>
                </div>
              ))}
            </div>
          </div>

          {/* telemetry */}
          <div className="flex flex-col gap-3.5">
            <div className="rounded-md border border-edge bg-panel p-4">
              <div className="mb-3.5 flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.2em] text-dim">LIVE TELEMETRY</span>
                <span className="pulse-dot h-[7px] w-[7px] rounded-full bg-mint" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded border border-edge/70 bg-bg1 p-2.5">
                  <div className="font-mono text-[9px] tracking-[0.16em] text-dim">UPTIME</div>
                  <div className="mt-1 font-mono text-[16px] tabular text-ink">{fmtUptime(now - start.current)}</div>
                </div>
                <div className="rounded border border-edge/70 bg-bg1 p-2.5">
                  <div className="font-mono text-[9px] tracking-[0.16em] text-dim">BYTES MOVED</div>
                  <div className="mt-1 font-mono text-[16px] tabular text-ink">{fmtBytes(bytes)}</div>
                </div>
                <div className="rounded border border-edge/70 bg-bg1 p-2.5">
                  <div className="font-mono text-[9px] tracking-[0.16em] text-dim">BLOCKED</div>
                  <div className="mt-1 font-mono text-[16px] tabular text-amber">{s.blocked}</div>
                </div>
                <div className="rounded border border-edge/70 bg-bg1 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[9px] tracking-[0.16em] text-dim">SW PING</span>
                    <span className="font-mono text-[10px] tabular text-mint">{s.latency != null ? `${s.latency}ms` : "···"}</span>
                  </div>
                  <div className="mt-1.5">
                    <Sparkline samples={samples} />
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1.5 font-mono text-[9px] tracking-[0.16em] text-dim">SHIELDS FEED</div>
                <div className="flex flex-col gap-1">
                  {s.net.length === 0 && (
                    <div className="rounded border border-dashed border-edge px-2.5 py-3 text-center font-mono text-[10px] text-dim">
                      intercepting… navigate somewhere to populate the feed
                    </div>
                  )}
                  {s.net.slice(0, 6).map((n) => (
                    <div key={n.id} className="feed-in flex items-center gap-2 rounded bg-bg1 px-2 py-[5px] font-mono text-[10px]">
                      <span className={n.status === "blocked" ? "text-red" : "text-mint"}>
                        {n.status === "blocked" ? "BLK" : "200"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-mute">{n.host || n.path}</span>
                      <span className="text-dim">{fmtClock(n.ts).slice(0, 5)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* cloak presets */}
            <div className="rounded-md border border-edge bg-panel p-4">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.2em] text-dim">TAB CLOAK</span>
                <span className="font-mono text-[9px] text-dim">panic: {keyLabel(s.settings.panicKey)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CLOAK_PRESETS.filter((p) => p.id !== "custom").map((p) => {
                  const active = s.settings.presetId === p.id;
                  return (
                    <button
                      key={p.id}
                      className={`chip ${active ? (s.cloak ? "warn" : "on") : ""}`}
                      onClick={() => {
                        d({ type: "settings", patch: { presetId: p.id } });
                        if (p.id === "none") d({ type: "cloak", on: false });
                        else d({ type: "cloak", on: true });
                      }}
                    >
                      <img
                        src={p.icon}
                        alt=""
                        className="h-[12px] w-[12px] rounded-[2px]"
                        onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                      />
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* engine */}
            <div className="rounded-md border border-edge bg-panel p-4">
              <div className="mb-2 font-mono text-[10px] tracking-[0.2em] text-dim">FILTER ENGINE</div>
              <div className="flex items-center justify-between font-mono text-[10.5px] text-mute">
                <span>
                  <span className="text-ink">{st.total}</span> rules · <span className="text-mint">{st.network}</span> net ·{" "}
                  <span className="text-blue">{st.cosmetic}</span> cosmetic
                </span>
                <button className="text-mint hover:underline" onClick={() => d({ type: "panel", panel: "inspector" })}>
                  playground →
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 flex items-center justify-between border-t border-edge/60 pt-4 font-mono text-[9.5px] tracking-[0.14em] text-dim">
          <span>WASM: JS-FALLBACK (BUILD /wasm_engine · wasm-pack) — SW SCOPE ./ — TRANSPORT {s.settings.transport.toUpperCase()}</span>
          <span className="hidden sm:inline">RIGHT-CLICK ANYWHERE FOR THE CONTEXT DECK</span>
        </div>
      </div>
    </div>
  );
}
