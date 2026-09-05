import { useMemo, useState } from "react";
import { useBrowser } from "../state";
import { buildLists, engine, sampleUrls, type ResourceType, type Verdict } from "../lib/engine";
import { fmtBytes, fmtClock } from "../lib/lib";
import { Ic } from "./Chrome";
import { Drawer } from "./Panels";

type Sub = "console" | "network" | "filters";

const LEVEL_COLOR: Record<string, string> = {
  log: "text-ink",
  info: "text-blue",
  warn: "text-amber",
  error: "text-red",
};

export default function InspectorPanel({ onClose }: { onClose: () => void }) {
  const { s, d } = useBrowser();
  const [sub, setSub] = useState<Sub>("console");
  const [filter, setFilter] = useState("");

  /* playground state */
  const [tUrl, setTUrl] = useState("https://www.doubleclick.net/tag/js/gpt.js?correlator=88");
  const [tOrigin, setTOrigin] = useState("https://example.com");
  const [tType, setTType] = useState<ResourceType>("script");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [bench, setBench] = useState<{ ops: number; ms: number; n: number } | null>(null);
  const [benchRun, setBenchRun] = useState(false);

  const st = useMemo(() => {
    engine.load(buildLists(s.settings));
    return engine.stats();
  }, [sub, s.settings]);

  const consoleRows = s.consoleLog.filter((c) => !filter || c.msg.toLowerCase().includes(filter.toLowerCase()));
  const netRows = s.net.filter(
    (n) => !filter || (n.host + n.path).toLowerCase().includes(filter.toLowerCase())
  );

  const runBench = () => {
    setBenchRun(true);
    setBench(null);
    setTimeout(() => {
      const urls = sampleUrls();
      const r = engine.benchmark(urls, { origin: "https://example.com", rtype: "script" });
      setBench({ ...r, n: urls.length });
      setBenchRun(false);
    }, 40);
  };

  return (
    <Drawer title="Inspector" sub="CONSOLE · NETWORK · FILTER ENGINE" onClose={onClose} wide>
      <div className="mb-3.5 flex items-center gap-1 rounded-md border border-edge bg-bg1 p-1">
        {(["console", "network", "filters"] as Sub[]).map((k) => (
          <button
            key={k}
            onClick={() => setSub(k)}
            className={`flex-1 rounded px-2 py-1.5 font-mono text-[10.5px] tracking-[0.12em] transition-colors ${
              sub === k ? "bg-panel2 text-mint" : "text-dim hover:text-mute"
            }`}
          >
            {k.toUpperCase()}
            {k === "console" && ` (${s.consoleLog.length})`}
            {k === "network" && ` (${s.net.length})`}
          </button>
        ))}
      </div>

      {sub !== "filters" && (
        <div className="mb-3 flex items-center gap-2">
          <input
            className="field field-mono !py-1.5"
            placeholder={`filter ${sub}…`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            className="btn-icon shrink-0"
            title="Clear"
            onClick={() => d({ type: sub === "console" ? "console-clear" : "net-clear" })}
          >
            <Ic n="trash" s={14} />
          </button>
        </div>
      )}

      {/* ------------------------------------------------ console */}
      {sub === "console" && (
        <div className="flex flex-col gap-1">
          {consoleRows.length === 0 && (
            <p className="rounded-md border border-dashed border-edge p-5 text-center font-mono text-[10.5px] text-dim">
              console tapped — page log/info/warn/error stream here
            </p>
          )}
          {consoleRows.map((c) => (
            <div key={c.id} className="feed-in flex items-start gap-2 rounded bg-bg1 px-2.5 py-[6px] font-mono text-[11px]">
              <span className="shrink-0 text-dim">{fmtClock(c.ts)}</span>
              <span className={`w-[38px] shrink-0 uppercase ${LEVEL_COLOR[c.level]}`}>{c.level}</span>
              <span className={`min-w-0 break-words ${LEVEL_COLOR[c.level]}`}>{c.msg || "—"}</span>
            </div>
          ))}
        </div>
      )}

      {/* ------------------------------------------------ network */}
      {sub === "network" && (
        <div className="flex flex-col gap-1">
          {netRows.length === 0 && (
            <p className="rounded-md border border-dashed border-edge p-5 text-center font-mono text-[10.5px] text-dim">
              the scoped SW mirrors every fetch it intercepts into this stream
            </p>
          )}
          {netRows.map((n) => (
            <div key={n.id} className="feed-in flex items-center gap-2 rounded bg-bg1 px-2.5 py-[5px] font-mono text-[10.5px]">
              <span className={`w-[30px] shrink-0 ${n.status === "blocked" ? "text-red" : "text-mint"}`}>
                {n.status === "blocked" ? "BLK" : "200"}
              </span>
              <span className="w-[36px] shrink-0 text-dim">{n.method}</span>
              <span className="min-w-0 flex-1 truncate text-mute">
                {n.host}
                <span className="text-dim">{n.path.slice(0, 48)}</span>
              </span>
              <span className="hidden shrink-0 text-dim sm:inline">{n.rtype}</span>
              <span className="shrink-0 tabular text-dim">{fmtBytes(n.size)}</span>
              <span className={`shrink-0 rounded-sm border px-1 text-[8.5px] ${n.src === "sw" ? "border-mint/40 text-mint" : "border-edge text-dim"}`}>
                {n.src === "sw" ? "SW" : "CHROME"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ------------------------------------------------ filters */}
      {sub === "filters" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-4 gap-2">
            {[
              ["RULES", st.total, "text-ink"],
              ["NET", st.network, "text-mint"],
              ["COSMETIC", st.cosmetic, "text-blue"],
              ["EXCEPT", st.exceptions, "text-amber"],
            ].map(([k, v, c]) => (
              <div key={k as string} className="rounded-md border border-edge bg-bg1 p-2.5 text-center">
                <div className="font-mono text-[8.5px] tracking-[0.16em] text-dim">{k}</div>
                <div className={`mt-1 font-mono text-[17px] tabular ${c}`}>{v}</div>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-edge bg-bg1 p-3">
            <div className="mb-2 font-mono text-[9.5px] tracking-[0.18em] text-dim">PLAYGROUND — MATCH A REQUEST</div>
            <div className="flex flex-col gap-1.5">
              <input className="field field-mono" value={tUrl} onChange={(e) => setTUrl(e.target.value)} placeholder="https://request-url…" spellCheck={false} />
              <div className="flex gap-1.5">
                <input className="field field-mono" value={tOrigin} onChange={(e) => setTOrigin(e.target.value)} placeholder="origin" spellCheck={false} />
                <select className="field field-mono !w-[130px]" value={tType} onChange={(e) => setTType(e.target.value as ResourceType)}>
                  {["script", "image", "stylesheet", "xmlhttprequest", "websocket", "document", "subdocument", "media", "font", "ping", "other"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => setVerdict(engine.matchNetwork(tUrl, { origin: tOrigin, rtype: tType }))}
                className="rounded-md border border-mint/45 bg-mint/10 py-2 text-[12.5px] font-semibold text-mint transition-colors hover:bg-mint/20"
              >
                Run matcher
              </button>
            </div>
            {verdict && (
              <div
                className={`feed-in mt-2.5 rounded-md border p-2.5 ${
                  verdict.verdict === "block"
                    ? "border-red/45 bg-red/10"
                    : verdict.verdict === "allow"
                      ? "border-mint/45 bg-mint/10"
                      : "border-edge bg-panel"
                }`}
              >
                <div className={`font-mono text-[12px] font-semibold tracking-[0.14em] ${
                  verdict.verdict === "block" ? "text-red" : verdict.verdict === "allow" ? "text-mint" : "text-dim"
                }`}>
                  VERDICT: {verdict.verdict.toUpperCase()}
                </div>
                <div className="mt-1 break-all font-mono text-[10px] text-mute">
                  {verdict.rule ? `matched → ${verdict.rule.raw}` : "no filter touched this request — passed to wisp tunnel"}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-md border border-edge bg-bg1 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[9.5px] tracking-[0.18em] text-dim">BENCHMARK — RUST-PORT ALGORITHM</span>
              {bench && (
                <span className="font-mono text-[10px] text-mint">
                  {(bench.ops / 1000).toFixed(0)}k ops/s · {bench.ms.toFixed(1)}ms
                </span>
              )}
            </div>
            <button
              onClick={runBench}
              disabled={benchRun}
              className="w-full rounded-md border border-blue/45 bg-blue/10 py-2 text-[12.5px] font-semibold text-blue transition-colors hover:bg-blue/20 disabled:opacity-60"
            >
              {benchRun ? "Sweeping…" : `Sweep ${bench?.n ?? 1200} requests through the matcher`}
            </button>
            <p className="mt-2 font-mono text-[9.5px] leading-relaxed text-dim">
              Same decision pipeline as the WASM build: pattern compile → type/domain/party gates → important ⊃ whitelist ⊃ block.
            </p>
          </div>

          <div className="rounded-md border border-edge bg-bg1 p-3">
            <div className="mb-2 font-mono text-[9.5px] tracking-[0.18em] text-dim">ACTIVE LISTS</div>
            {s.settings.lists.map((l) => (
              <div key={l.id} className="flex items-center justify-between py-1 font-mono text-[10.5px]">
                <span className="text-mute">{l.name}</span>
                <span className={l.enabled ? "text-mint" : "text-dim"}>{l.enabled ? "ACTIVE" : "OFF"}</span>
              </div>
            ))}
            <div className="flex items-center justify-between py-1 font-mono text-[10.5px]">
              <span className="text-mute">custom list</span>
              <span className={s.settings.customList.trim() ? "text-mint" : "text-dim"}>
                {s.settings.customList.trim() ? `${s.settings.customList.split("\n").filter((x) => x.trim()).length} lines` : "EMPTY"}
              </span>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
