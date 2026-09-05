/* ============================================================
   WRAITH service worker — scoped interception layer (sw v0.9.2)
   ------------------------------------------------------------
   • registers under the app shell scope "./" and claims every
     fetch event: HTML, JS, CSS, XHR/fetch, media, websockets
     (upgrade requests) — mirroring each into the inspector feed
   • enforces strict network blocking: the page-side ABP engine
     (or the /wasm_engine build when compiled) pushes a host
     verdict set via `set-blocklist`; matched requests are
     short-circuited with an empty 204 before they leave scope
   • answers `ping` probes so the shell can chart node latency
   • a WASM hook (wasm/wraith_engine_bg.wasm) is mounted here by
     the production build; when absent the worker falls back to
     the host-set above (JS path, identical verdicts)
   ============================================================ */

const VERSION = "wraith-sw-0.9.2";

const verdicts = {
  enabled: true,
  hosts: new Set(),
};

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(self.clients.claim());
});

function broadcast(msg) {
  self.clients.matchAll({ type: "window" }).then((cls) => {
    for (const c of cls) c.postMessage(msg);
  });
}

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

self.addEventListener("message", (ev) => {
  const m = ev.data || {};
  if (m.type === "ping") {
    broadcast({ type: "pong", t: m.t, v: VERSION });
  } else if (m.type === "set-blocklist") {
    verdicts.enabled = !!m.enabled;
    verdicts.hosts = new Set(m.hosts || []);
  }
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (!req.url.startsWith("http")) return;

  let parsed;
  try {
    parsed = new URL(req.url);
  } catch {
    return;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  const path = (parsed.pathname + parsed.search).slice(0, 90);
  const rtype = req.destination || "fetch";
  const method = req.method;

  /* strict block — never hits the network */
  if (verdicts.enabled && verdicts.hosts.has(host)) {
    broadcast({ type: "net", method, host, path, rtype, size: 0, blocked: true });
    ev.respondWith(
      new Response("", { status: 204, headers: { "X-Wraith-Verdict": "blocked" } })
    );
    return;
  }

  ev.respondWith(
    fetch(req)
      .then((res) => {
        /* mirror size into the feed once the body settles */
        try {
          const clone = res.clone();
          clone
            .arrayBuffer()
            .then((buf) =>
              broadcast({ type: "net", method, host, path, rtype, size: buf.byteLength, blocked: false })
            )
            .catch(() =>
              broadcast({ type: "net", method, host, path, rtype, size: 0, blocked: false })
            );
        } catch {
          broadcast({ type: "net", method, host, path, rtype, size: 0, blocked: false });
        }
        return res;
      })
      .catch(
        () =>
          new Response("", {
            status: 504,
            headers: { "X-Wraith-Verdict": "tunnel-timeout" },
          })
      )
  );
});
