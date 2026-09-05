import { useRef, useState } from "react";
import { useBrowser, type DownloadItem, type JarEntry } from "../state";
import { CLOAK_PRESETS, fmtBytes, fmtClock, hostOf, uid } from "../lib/lib";
import { engine } from "../lib/engine";
import { parseExtensionArchive, parseUnpackedDirectory } from "../lib/crx";
import { Ic, keyLabel } from "./Chrome";

/* ------------------------------------------------------------- drawer */

export function Drawer({
  title,
  sub,
  onClose,
  children,
  wide,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`drawer-in absolute bottom-0 right-0 top-0 z-30 flex flex-col border-l border-edge bg-panel shadow-[-24px_0_60px_rgba(0,0,0,0.45)] ${
        wide ? "w-full max-w-[460px]" : "w-full max-w-[390px]"
      }`}
    >
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <div>
          <div className="font-display text-[15px] font-semibold tracking-wide text-ink">{title}</div>
          {sub && <div className="mt-0.5 font-mono text-[9.5px] tracking-[0.14em] text-dim">{sub}</div>}
        </div>
        <button className="btn-icon" onClick={onClose} title="Close panel">
          <Ic n="x" s={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </div>
  );
}

function Sect({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[9.5px] tracking-[0.2em] text-dim">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Switch({ on, onClick, danger }: { on: boolean; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`relative h-[20px] w-[36px] shrink-0 rounded-full border transition-colors ${
        on ? (danger ? "border-red/60 bg-red/25" : "border-mint/60 bg-mint/25") : "border-edge bg-bg1"
      }`}
    >
      <span
        className={`absolute top-[2.5px] h-[13px] w-[13px] rounded-full transition-all ${
          on ? (danger ? "left-[18px] bg-red" : "left-[18px] bg-mint") : "left-[3px] bg-dim"
        }`}
      />
    </button>
  );
}

function statusChip(st: DownloadItem["status"]) {
  if (st === "complete") return <span className="rounded-sm border border-mint/40 bg-mint/10 px-1.5 py-0.5 font-mono text-[8.5px] tracking-wider text-mint">COMPLETE</span>;
  if (st === "intercepted") return <span className="rounded-sm border border-blue/40 bg-blue/10 px-1.5 py-0.5 font-mono text-[8.5px] tracking-wider text-blue">INTERCEPTED</span>;
  return <span className="rounded-sm border border-red/40 bg-red/10 px-1.5 py-0.5 font-mono text-[8.5px] tracking-wider text-red">BLOCKED·CORS</span>;
}

/* --------------------------------------------------------- downloads */

export function DownloadsPanel({ onClose }: { onClose: () => void }) {
  const { s, d } = useBrowser();
  return (
    <Drawer title="Downloads" sub="INTERCEPTED FILE TRANSFERS" onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[12px] text-mute">{s.downloads.length} captured this session</span>
        {s.downloads.length > 0 && (
          <button className="text-[11px] text-red hover:underline" onClick={() => d({ type: "downloads-clear" })}>
            Clear all
          </button>
        )}
      </div>
      {s.downloads.length === 0 && (
        <div className="rounded-md border border-dashed border-edge p-6 text-center">
          <div className="mx-auto mb-2 w-fit text-dim"><Ic n="dl" s={22} /></div>
          <p className="text-[12px] text-mute">No intercepted transfers yet.</p>
          <p className="mt-1 font-mono text-[10px] text-dim">right-click a page → “Save page as…” to capture one</p>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {s.downloads.map((dl) => (
          <div key={dl.id} className="feed-in rounded-md border border-edge bg-bg1 p-2.5">
            <div className="flex items-center gap-2">
              <span className="text-mute"><Ic n="file" s={15} /></span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{dl.name}</span>
              {statusChip(dl.status)}
            </div>
            <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-dim">
              <span className="truncate">{fmtBytes(dl.size)} · {dl.mime || "?"} · {fmtClock(dl.ts)}</span>
              {dl.blobUrl && (
                <a href={dl.blobUrl} download={dl.name} className="ml-2 flex items-center gap-1 text-mint hover:underline">
                  <Ic n="dl" s={11} /> save
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  );
}

/* ----------------------------------------------------------- cookies */

function readBrowserCookies(): { name: string; value: string }[] {
  return document.cookie
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const i = c.indexOf("=");
      return { name: i < 0 ? c : c.slice(0, i), value: i < 0 ? "" : decodeURIComponent(c.slice(i + 1)) };
    });
}

export function CookiesPanel({ onClose }: { onClose: () => void }) {
  const { s, d } = useBrowser();
  const [tick, setTick] = useState(0);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const browserCookies = readBrowserCookies();
  void tick;

  const addJar = () => {
    if (!name.trim()) return;
    const entry: JarEntry = { name: name.trim(), value, domain: hostOf(location.href) || "wraith.local", ts: Date.now() };
    d({ type: "jar-add", entry });
    setName("");
    setValue("");
  };

  return (
    <Drawer title="Cookies" sub="SCOPED JAR · ISOLATED PER PROXY ORIGIN" onClose={onClose}>
      <Sect title={`BROWSER CONTEXT (${browserCookies.length})`}>
        {browserCookies.length === 0 && (
          <p className="rounded-md border border-dashed border-edge p-3 text-center font-mono text-[10px] text-dim">
            origin jar is clean — no tracking cookies present
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          {browserCookies.map((c) => (
            <div key={c.name} className="flex items-center gap-2 rounded border border-edge bg-bg1 px-2.5 py-2">
              <span className="text-amber"><Ic n="cookie" s={13} /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[11px] text-ink">{c.name}</div>
                <div className="truncate font-mono text-[10px] text-dim">{c.value.slice(0, 60)}</div>
              </div>
              <button
                className="btn-icon !h-6 !w-6"
                title="Expire cookie"
                onClick={() => {
                  document.cookie = `${c.name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
                  setTick((t) => t + 1);
                }}
              >
                <Ic n="trash" s={12} />
              </button>
            </div>
          ))}
        </div>
      </Sect>

      <Sect title={`SCOPED PROXY JAR (${s.jar.length})`}>
        <div className="mb-2.5 rounded-md border border-edge bg-bg1 p-2.5">
          <div className="mb-2 font-mono text-[9.5px] text-dim">inject a scoped cookie into the proxy jar</div>
          <div className="flex flex-col gap-1.5">
            <input className="field field-mono" placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="field field-mono" placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} />
            <button
              onClick={addJar}
              className="mt-0.5 rounded-md border border-mint/45 bg-mint/10 py-1.5 text-[12px] font-semibold text-mint transition-colors hover:bg-mint/20"
            >
              Inject cookie
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {s.jar.map((j) => (
            <div key={j.name} className="feed-in flex items-center gap-2 rounded border border-edge bg-bg1 px-2.5 py-2">
              <span className="text-mint"><Ic n="zap" s={13} /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[11px] text-ink">{j.name}=<span className="text-mute">{j.value}</span></div>
                <div className="font-mono text-[10px] text-dim">{j.domain} · persisted</div>
              </div>
              <button className="btn-icon !h-6 !w-6" onClick={() => d({ type: "jar-del", name: j.name })}>
                <Ic n="trash" s={12} />
              </button>
            </div>
          ))}
        </div>
      </Sect>
      <p className="rounded-md border border-edge/60 bg-bg1/60 p-2.5 font-mono text-[9.5px] leading-relaxed text-dim">
        Cookies set inside proxied frames are rewritten to the scoped jar by the SW before reaching document.cookie — remote origins never observe the real client jar.
      </p>
    </Drawer>
  );
}

/* -------------------------------------------------------- extensions */

export function ExtensionsPanel({ onClose }: { onClose: () => void }) {
  const { s, d } = useBrowser();
  const dirRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  const onDir = async (fl: FileList | null) => {
    if (!fl?.length) return;
    try {
      setErr(null);
      const meta = await parseUnpackedDirectory(fl);
      d({ type: "ext-add", meta });
      console.info(`[wraith] unpacked extension loaded: ${meta.name} v${meta.version}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onFile = async (f: File | null) => {
    if (!f) return;
    try {
      setErr(null);
      const meta = await parseExtensionArchive(f);
      d({ type: "ext-add", meta });
      console.info(`[wraith] ${meta.source} parsed: ${meta.name} — ${meta.fileCount} entries`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Drawer title="Extensions" sub="CRX / UNPACKED PLUGIN SANDBOX" onClose={onClose}>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => dirRef.current?.click()}
          className="rounded-md border border-mint/45 bg-mint/10 py-2.5 text-[12px] font-semibold text-mint transition-colors hover:bg-mint/20"
        >
          Load unpacked
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-md border border-edge bg-bg1 py-2.5 text-[12px] font-semibold text-mute transition-colors hover:border-edge2 hover:text-ink"
        >
          Import .crx / .zip
        </button>
        <input ref={dirRef} type="file" className="hidden" onChange={(e) => onDir(e.target.files)} {...({ webkitdirectory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} />
        <input ref={fileRef} type="file" accept=".crx,.zip" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      </div>

      {err && (
        <div className="mb-3 rounded-md border border-red/40 bg-red/10 p-2.5 font-mono text-[10.5px] text-red">
          {err}
        </div>
      )}

      {s.exts.length === 0 && !err && (
        <div className="rounded-md border border-dashed border-edge p-6 text-center">
          <div className="mx-auto mb-2 w-fit text-dim"><Ic n="puzzle" s={22} /></div>
          <p className="text-[12px] text-mute">No plugins sandboxed yet.</p>
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-dim">
            CRX3 archives are de-shelled client-side (magic “Cr24” → zip payload) and content scripts are injected into the proxy sandbox.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {s.exts.map((e) => (
          <div key={e.id} className={`feed-in rounded-md border bg-bg1 p-3 transition-opacity ${e.enabled ? "border-edge" : "border-edge/60 opacity-55"}`}>
            <div className="flex items-center gap-2.5">
              <span className={e.enabled ? "text-mint" : "text-dim"}><Ic n="puzzle" s={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink">{e.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[9.5px] text-dim">
                  <span>v{e.version}</span>·<span>MV{e.manifestVersion}</span>·<span>{e.fileCount} files</span>·<span className="uppercase text-blue">{e.source}</span>
                </div>
              </div>
              <Switch on={e.enabled} onClick={() => d({ type: "ext-toggle", id: e.id })} />
            </div>
            {e.description && <p className="mt-2 text-[11.5px] leading-snug text-mute">{e.description}</p>}
            {e.permissions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {e.permissions.map((p) => (
                  <span key={p} className="rounded-sm border border-edge px-1.5 py-0.5 font-mono text-[9px] text-mute">{p}</span>
                ))}
              </div>
            )}
            {e.contentScripts.length > 0 && (
              <div className="mt-2 font-mono text-[9.5px] text-dim">
                matches: {e.contentScripts.join(", ")}
              </div>
            )}
            <div className="mt-2 flex justify-end">
              <button className="flex items-center gap-1 font-mono text-[10px] text-red hover:underline" onClick={() => d({ type: "ext-del", id: e.id })}>
                <Ic n="trash" s={11} /> remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  );
}

/* ---------------------------------------------------------- settings */

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { s, d } = useBrowser();
  const [probe, setProbe] = useState<{ state: "idle" | "run" | "ok" | "fail"; msg: string }>({ state: "idle", msg: "" });
  const set = (patch: Partial<typeof s.settings>) => d({ type: "settings", patch });

  const doProbe = async () => {
    if (!s.settings.gateway) {
      setProbe({ state: "fail", msg: "no gateway configured — running in local-sim mode" });
      return;
    }
    setProbe({ state: "run", msg: "probing…" });
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 3500);
    try {
      await fetch(s.settings.gateway, { mode: "no-cors", signal: ctl.signal });
      setProbe({ state: "ok", msg: "node reachable (opaque response — wisp handshake next)" });
    } catch {
      setProbe({ state: "fail", msg: "node unreachable — falling back to HTTP polling transport" });
    } finally {
      clearTimeout(to);
    }
  };

  const exportSession = () => {
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), settings: s.settings, jar: s.jar, extensions: s.exts, downloads: s.downloads, blocked: s.blocked }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    d({
      type: "download",
      item: { id: uid(), name: "wraith-session.json", url: "wraith://export", size: blob.size, mime: "application/json", status: "complete", blobUrl: url, ts: Date.now() },
    });
  };

  return (
    <Drawer title="Settings" sub="GATEWAY · SHIELDS · STEALTH" onClose={onClose}>
      <Sect title="WISP GATEWAY">
        <input
          className="field field-mono"
          placeholder="wss://node.example.dev/wisp"
          value={s.settings.gateway}
          onChange={(e) => set({ gateway: e.target.value })}
          spellCheck={false}
        />
        <div className="mt-2.5 flex items-center gap-2">
          {(["ws", "polling"] as const).map((t) => (
            <button key={t} className={`chip ${s.settings.transport === t ? "on" : ""}`} onClick={() => set({ transport: t })}>
              {t === "ws" ? "WEBSOCKET" : "HTTP POLLING (SERVERLESS)"}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={doProbe}
            className="rounded-md border border-edge bg-bg1 px-3 py-1.5 font-mono text-[10.5px] text-mute transition-colors hover:border-mint/50 hover:text-mint"
          >
            PROBE NODE
          </button>
        </div>
        {probe.state !== "idle" && (
          <div className={`mt-2 rounded-md border p-2.5 font-mono text-[10.5px] ${
            probe.state === "ok" ? "border-mint/40 bg-mint/10 text-mint"
            : probe.state === "fail" ? "border-amber/40 bg-amber/10 text-amber"
            : "border-edge bg-bg1 text-mute"
          }`}>
            {probe.state === "run" && <span className="spin mr-1.5 inline-block h-2.5 w-2.5 rounded-full border border-mint border-t-transparent align-middle" />}
            {probe.msg}
          </div>
        )}
        <p className="mt-2 font-mono text-[9.5px] leading-relaxed text-dim">
          Persistent multiplexed TCP/UDP over WebSocket; on serverless hosts (Vercel) the client degrades to chunked HTTP polling automatically.
        </p>
      </Sect>

      <Sect title="SHIELDS — ABP FILTER ENGINE" right={<Switch on={s.settings.adblock} onClick={() => set({ adblock: !s.settings.adblock })} />}>
        <div className="flex flex-col gap-1.5">
          {s.settings.lists.map((l) => (
            <button
              key={l.id}
              onClick={() => set({ lists: s.settings.lists.map((x) => (x.id === l.id ? { ...x, enabled: !x.enabled } : x)) })}
              className={`flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
                l.enabled ? "border-mint/35 bg-mint/5" : "border-edge bg-bg1 opacity-60"
              }`}
            >
              <span className={`text-[12px] ${l.enabled ? "text-ink" : "text-mute"}`}>{l.name}</span>
              <span className={`font-mono text-[9px] tracking-wider ${l.enabled ? "text-mint" : "text-dim"}`}>{l.enabled ? "ACTIVE" : "OFF"}</span>
            </button>
          ))}
        </div>
        <textarea
          className="field field-mono mt-2.5 h-[110px] resize-y"
          placeholder={"! custom ABP filters\n||tracker.example^\n##.ad-banner"}
          value={s.settings.customList}
          onChange={(e) => set({ customList: e.target.value })}
          spellCheck={false}
        />
        <div className="mt-1.5 flex items-center justify-between font-mono text-[9.5px] text-dim">
          <span>{engine.stats().total} rules loaded · {engine.stats().cosmetic} cosmetic</span>
          <span>strict blocking via SW + WASM</span>
        </div>
      </Sect>

      <Sect title="STEALTH — TAB CLOAK">
        <div className="flex flex-wrap gap-1.5">
          {CLOAK_PRESETS.map((p) => (
            <button key={p.id} className={`chip ${s.settings.presetId === p.id ? "on" : ""}`} onClick={() => set({ presetId: p.id })}>
              {p.name}
            </button>
          ))}
        </div>
        {s.settings.presetId === "custom" && (
          <div className="mt-2.5 flex flex-col gap-1.5">
            <input className="field" placeholder="Decoy tab title — e.g. “Chapter 4 Notes”" value={s.settings.customTitle} onChange={(e) => set({ customTitle: e.target.value })} />
            <input className="field field-mono" placeholder="Decoy favicon URL (https://…)" value={s.settings.customIcon} onChange={(e) => set({ customIcon: e.target.value })} />
          </div>
        )}
        <div className="mt-3 flex items-center justify-between rounded-md border border-edge bg-bg1 px-3 py-2.5">
          <div>
            <div className="text-[12px] text-ink">Panic key</div>
            <div className="font-mono text-[9.5px] text-dim">instantly masquerade title + favicon</div>
          </div>
          <select className="field field-mono !w-[92px] !py-1.5" value={s.settings.panicKey} onChange={(e) => set({ panicKey: e.target.value as typeof s.settings.panicKey })}>
            <option value="Backquote">` (backtick)</option>
            <option value="F2">F2</option>
            <option value="F4">F4</option>
            <option value="F9">F9</option>
          </select>
        </div>
        <div className="mt-2 flex items-center justify-between rounded-md border border-edge bg-bg1 px-3 py-2.5">
          <div>
            <div className="text-[12px] text-ink">Auto-cloak on window blur</div>
            <div className="font-mono text-[9.5px] text-dim">teacher-walk-by defense</div>
          </div>
          <Switch on={s.settings.autoCloak} onClick={() => set({ autoCloak: !s.settings.autoCloak })} />
        </div>
        <button
          onClick={() => d({ type: "cloak" })}
          className={`mt-2.5 w-full rounded-md border py-2 text-[12.5px] font-semibold transition-colors ${
            s.cloak ? "border-amber/50 bg-amber/10 text-amber hover:bg-amber/20" : "border-edge bg-bg1 text-mute hover:border-amber/50 hover:text-amber"
          }`}
        >
          {s.cloak ? "Drop the cloak" : `Cloak now (${keyLabel(s.settings.panicKey)})`}
        </button>
      </Sect>

      <Sect title="SESSION DATA">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={exportSession} className="rounded-md border border-edge bg-bg1 py-2 text-[12px] font-medium text-mute transition-colors hover:border-mint/50 hover:text-mint">
            Export session
          </button>
          <button
            onClick={() => { d({ type: "wipe" }); setTimeout(() => location.reload(), 60); }}
            className="rounded-md border border-red/45 bg-red/10 py-2 text-[12px] font-semibold text-red transition-colors hover:bg-red/20"
          >
            Wipe all traces
          </button>
        </div>
        <p className="mt-2 font-mono text-[9.5px] leading-relaxed text-dim">
          Wiping clears the scoped jar, plugins, captured downloads and cloak state, then hard-reloads to drop in-memory sessions.
        </p>
      </Sect>

      <div className="rounded-md border border-edge/60 bg-bg1/60 p-3 font-mono text-[9.5px] leading-relaxed text-dim">
        WRAITH 0.9.2 — wisp-core shell. Rewrites run in /wasm_engine (Rust → wasm-pack) with a JS fallback; tunneling terminates at the /server wisp node (SOCKS5 + Tor bridge, on-node DNS).
      </div>
    </Drawer>
  );
}
