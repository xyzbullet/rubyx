/* ============================================================
   WRAITH service worker v0.10 — the actual proxy.
   ------------------------------------------------------------
   1. REWRITING PROXY — every proxied link  /wisp/<b64url(url)>
      is intercepted: the target is fetched, framing headers
      (X-Frame-Options / CSP / CORP…) are stripped, and every
      absolute http(s) URL inside HTML, CSS and JS is rewritten
      back through /wisp/, so images, video, fonts, XHR and
      fetch all recurse through the tunnel. A <base> tag plus a
      click interceptor keep relative URLs and navigations in.
      The hot scan runs on the WASM core (wasm-engine.js).
   2. STRICT BLOCKING — ABP verdicts from the shell push a host
      hash set into WASM; blocked hosts short-circuit to 204
      before any byte leaves the browser.
   3. E2E WISP TUNNEL — when a gateway is configured the worker
      opens a WebSocket, does an X25519 ECDH handshake, derives
      an AES-256-GCM key via HKDF, and tunnels L7 requests as
      encrypted wisp frames (epoxy-style). Serverless hosts get
      the local rewrite path instead.
   ============================================================ */

const VERSION = "wraith-sw-0.10.0";
const PROXY_PREFIX = "/wisp/";
const te = new TextEncoder();

try {
  importScripts("/wasm-engine.js");
} catch (e) {
  console.warn("[wraith] wasm-engine.js unavailable:", e);
}

let W = null; // wasm api
if (self.WraithWasm) {
  self.WraithWasm.init().then((api) => {
    W = api;
    if (W && pendingHosts) {
      W.setHosts(pendingHosts);
      pendingHosts = null;
    }
  });
}

const verdicts = { enabled: true, hosts: new Set() };
let pendingHosts = null;

/* ------------------------------------------------- url scheme */

function b64url(s) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function fromB64url(s) {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(p + "=".repeat((4 - (p.length % 4)) % 4))));
}
function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
function abs(u, base) {
  try {
    return new URL(u, base).href;
  } catch {
    return u;
  }
}
function proxied(u) {
  return PROXY_PREFIX + b64url(u);
}

/* --------------------------------------------- wasm rewrite */

const BOUND = new Set([9, 10, 13, 32, 34, 39, 41, 60, 62, 92, 96]);
const URL_RE = /https?:\/\/[^\s"'<>)\\`]+/g;

function skipUrl(text, at, url) {
  if (text.slice(Math.max(0, at - 8), at).includes("xmlns")) return true;
  const h = hostOf(url);
  return h === "localhost" || h.startsWith("127.") || h === "::1";
}

/** Rewrite absolute URLs → proxied links. WASM does the scanning. */
function rewriteText(text, base) {
  const fix = (u) => proxied(abs(u, base));

  if (!W) {
    // JS fallback path — identical output
    return text.replace(URL_RE, (m, off) => (skipUrl(text, off, m) ? m : fix(m)));
  }

  const bytes = te.encode(text);
  W.reset(); // fresh arena per document — the bump pool is scratch space
  const hp = W.putBytes(bytes);
  let out = "";
  let i = 0;
  for (;;) {
    const o1 = W.scanRange(hp + i, bytes.length - i, "https://");
    const o2 = W.scanRange(hp + i, bytes.length - i, "http://");
    let rel = -1;
    let nl = 8;
    if (o1 >= 0 && (o2 < 0 || o1 <= o2)) rel = o1;
    else if (o2 >= 0) {
      rel = o2;
      nl = 7;
    }
    if (rel < 0) {
      out += text.slice(i);
      break;
    }
    const at = i + rel;
    let j = at + nl;
    while (j < text.length && !BOUND.has(text.charCodeAt(j))) j++;
    const url = text.slice(at, j);
    out += text.slice(i, at);
    out += skipUrl(text, at, url) ? url : fix(url);
    i = j;
  }
  return out;
}

const NAV_INTERCEPT =
  '<script>(function(){var P="/wisp/";function enc(u){try{return P+btoa(unescape(encodeURIComponent(u)))' +
  '.replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"")}catch(e){return u}}' +
  'document.addEventListener("click",function(e){var t=e.target;var a=t&&t.closest?t.closest("a"):null;' +
  'if(a&&a.href&&a.href.indexOf("javascript:")!==0&&a.target!=="_blank"){' +
  'e.preventDefault();location.href=enc(a.href);}},true);})();<\/script>';

function rewriteHtml(html, base) {
  let out = html.replace(/<base[^>]*>/gi, "");
  const baseTag = '<base href="' + base + '">';
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => m + baseTag + NAV_INTERCEPT);
  } else {
    out = baseTag + NAV_INTERCEPT + out;
  }
  return rewriteText(out, base);
}

/* ------------------------------------------- e2e wisp tunnel */

const P25519 = (1n << 255n) - 19n;
function x25519(kBytes, uBytes) {
  const le = (b) => {
    let x = 0n;
    for (let i = b.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(b[i]);
    return x;
  };
  const be = (x) => {
    const b = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      b[i] = Number(x & 0xffn);
      x >>= 8n;
    }
    return b;
  };
  const k = Uint8Array.from(kBytes);
  k[0] &= 248;
  k[31] &= 127;
  k[31] |= 64;
  const kk = le(k);
  const u = le(uBytes) % P25519;
  let x1 = u, x2 = 1n, z2 = 0n, x3 = u, z3 = 1n, swap = 0n;
  for (let t = 254n; t >= 0n; t--) {
    const kt = (kk >> t) & 1n;
    swap ^= kt;
    if (swap) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }
    swap = kt;
    const A = (x2 + z2) % P25519, AA = (A * A) % P25519;
    const B = (x2 - z2 + P25519) % P25519, BB = (B * B) % P25519;
    const E = (AA - BB + P25519) % P25519;
    const C = (x3 + z3) % P25519, D = (x3 - z3 + P25519) % P25519;
    const DA = (D * A) % P25519, CB = (C * B) % P25519;
    x3 = (DA + CB) % P25519;
    x3 = (x3 * x3) % P25519;
    z3 = (DA - CB + P25519) % P25519;
    z3 = (z3 * z3) % P25519;
    z3 = (z3 * u) % P25519;
    x2 = (AA * BB) % P25519;
    z2 = (E * ((AA + (121665n * E) % P25519) % P25519)) % P25519;
  }
  if (swap) {
    [x2, x3] = [x3, x2];
    [z2, z3] = [z3, z2];
  }
  const inv = (a) => {
    let r = 1n, e = P25519 - 2n;
    while (e) {
      if (e & 1n) r = (r * a) % P25519;
      a = (a * a) % P25519;
      e >>= 1n;
    }
    return r;
  };
  return be((x2 * inv(z2)) % P25519);
}
const X_BASE = new Uint8Array(32);
X_BASE[0] = 9;

async function hkdfKey(shared) {
  const ikm = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: te.encode("wraith-wisp-v1"),
      info: te.encode("wisp-gcm-aes256"),
    },
    ikm,
    256
  );
  return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}
async function seal(key, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain)
  );
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}
async function open(key, msg) {
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: msg.slice(0, 12) },
        key,
        msg.slice(12)
      )
    );
  } catch {
    return null;
  }
}

function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64Bytes(s) {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const tunnel = { ws: null, key: null, sid: 1, pending: new Map() };

function wispFrame(type, sid, payload) {
  const out = new Uint8Array(9 + payload.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, payload.length + 5, true);
  out[4] = type;
  dv.setUint32(5, sid, true);
  out.set(payload, 9);
  return out;
}

async function tunnelSend(frame) {
  const msg = tunnel.key ? await seal(tunnel.key, frame) : frame;
  tunnel.ws.send(msg.buffer ?? msg);
}

async function connectTunnel(gateway) {
  if (!gateway) return false;
  try {
    const wsUrl = gateway.replace(/^http/, "ws");
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error("connect timeout")), 3000);
      ws.onopen = () => {
        clearTimeout(to);
        res();
      };
      ws.onerror = () => {
        clearTimeout(to);
        rej(new Error("ws error"));
      };
    });
    const priv = crypto.getRandomValues(new Uint8Array(32));
    const pub = x25519(priv, X_BASE);
    ws.send(JSON.stringify({ v: 1, pub: toB64(pub) }));
    const hs = await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error("handshake timeout")), 3000);
      ws.onmessage = (e) => {
        clearTimeout(to);
        try {
          res(JSON.parse(e.data));
        } catch (err) {
          rej(err);
        }
      };
    });
    const key = await hkdfKey(x25519(priv, fromB64Bytes(hs.pub)));
    tunnel.ws = ws;
    tunnel.key = key;
    ws.binaryType = "arraybuffer";
    ws.onmessage = async (e) => {
      const plain = tunnel.key ? await open(tunnel.key, new Uint8Array(e.data)) : new Uint8Array(e.data);
      if (!plain || plain.length < 9) return;
      const dv = new DataView(plain.buffer, plain.byteOffset);
      const type = plain[4];
      const sid = dv.getUint32(5, true);
      const payload = plain.slice(9);
      const p = tunnel.pending.get(sid);
      if (!p) return;
      if (type === 0x07) p.res = payload; // T_RES
      if (type === 0x03) {
        tunnel.pending.delete(sid);
        p.resolve(p.res || new Uint8Array(0));
      }
    };
    ws.onclose = () => {
      tunnel.ws = null;
      tunnel.key = null;
    };
    return true;
  } catch (e) {
    console.warn("[wraith] tunnel unavailable (" + e.message + ") — local rewrite path");
    return false;
  }
}

/** L7 request through the encrypted tunnel; null on failure. */
async function tunnelFetch(target, method, headers, body) {
  if (!tunnel.ws || tunnel.ws.readyState !== 1) return null;
  try {
    const u = new URL(target);
    const sid = tunnel.sid++;
    const path = u.pathname + u.search;
    let req = `${method} ${path || "/"} HTTP/1.1\r\nHost: ${u.host}\r\nConnection: close\r\n`;
    for (const [k, v] of headers) req += `${k}: ${v}\r\n`;
    req += "\r\n";
    const reqBytes = te.encode(req);
    const payload = new Uint8Array(reqBytes.length + (body ? body.length : 0));
    payload.set(reqBytes, 0);
    if (body) payload.set(body, reqBytes.length);

    const done = new Promise((resolve) => {
      tunnel.pending.set(sid, { resolve, res: null });
      setTimeout(() => {
        if (tunnel.pending.has(sid)) {
          tunnel.pending.delete(sid);
          resolve(null);
        }
      }, 8000);
    });
    await tunnelSend(wispFrame(0x01, sid, new Uint8Array([3, ...te.encode(u.host + ":443")])));
    await tunnelSend(wispFrame(0x06, sid, payload));
    const res = await done;
    if (!res) return null;
    return parseHttpResponse(res);
  } catch {
    return null;
  }
}

function parseHttpResponse(raw) {
  let headEnd = -1;
  for (let i = 0; i + 3 < raw.length; i++) {
    if (raw[i] === 13 && raw[i + 1] === 10 && raw[i + 2] === 13 && raw[i + 3] === 10) {
      headEnd = i;
      break;
    }
  }
  if (headEnd < 0) return null;
  const head = new TextDecoder().decode(raw.slice(0, headEnd));
  const body = raw.slice(headEnd + 4);
  const lines = head.split("\r\n");
  const status = parseInt((lines[0] || "").split(" ")[1] || "200", 10);
  const headers = new Headers();
  for (const l of lines.slice(1)) {
    const c = l.indexOf(":");
    if (c > 0) headers.set(l.slice(0, c).trim(), l.slice(c + 1).trim());
  }
  return new Response(body, { status, headers });
}

/* --------------------------------------------- fetch handler */

function broadcast(msg) {
  self.clients.matchAll({ type: "window" }).then((cls) => {
    for (const c of cls) c.postMessage(msg);
  });
}

const STRIP_HEADERS = [
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "content-encoding",
  "content-length",
];

function cleanHeaders(src) {
  const h = new Headers();
  for (const [k, v] of src.entries()) {
    if (!STRIP_HEADERS.includes(k.toLowerCase())) h.set(k, v);
  }
  h.set("access-control-allow-origin", "*");
  return h;
}

function isBlocked(host) {
  if (!verdicts.enabled || !host) return false;
  if (W) return W.blocked(host);
  return verdicts.hosts.has(host);
}

async function proxyFetch(req) {
  const u = new URL(req.url);
  let target;
  try {
    target = fromB64url(u.pathname.slice(PROXY_PREFIX.length) + u.search);
  } catch {
    return new Response("wraith: malformed proxied link", { status: 400 });
  }
  const th = hostOf(target);

  if (isBlocked(th)) {
    broadcast({ type: "net", host: th, path: new URL(target).pathname.slice(0, 90), method: req.method, rtype: "proxied", size: 0, blocked: true });
    return new Response("", { status: 204, headers: { "X-Wraith-Verdict": "blocked" } });
  }

  try {
    /* 1 — try the encrypted tunnel first */
    const fwdHeaders = new Headers();
    for (const [k, v] of req.headers.entries()) {
      const lk = k.toLowerCase();
      if (!["host", "origin", "referer", "accept-encoding", "connection", "sec-fetch-mode", "sec-fetch-site", "sec-fetch-dest"].includes(lk)) {
        fwdHeaders.set(k, v);
      }
    }
    fwdHeaders.set("accept-encoding", "identity");
    let res = null;
    let via = "local";
    if (tunnel.ws) {
      const body = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer().catch(() => null);
      res = await tunnelFetch(target, req.method, fwdHeaders, body ? new Uint8Array(body) : null);
      if (res) via = "wisp-e2ee";
    }

    /* 2 — local rewrite path */
    if (!res) {
      res = await fetch(target, {
        method: req.method,
        headers: fwdHeaders,
        redirect: "manual",
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      });
      if (res.type === "opaqueredirect") {
        const loc = res.headers.get("location");
        return new Response("", {
          status: 302,
          headers: { location: loc ? proxied(abs(loc, target)) : target },
        });
      }
    }

    const h2 = cleanHeaders(res.headers);
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const tu = new URL(target);
    const feedBase = { host: th, path: tu.pathname.slice(0, 90), method: req.method, blocked: false, via };

    if (/text\/html|application\/xhtml/.test(ct)) {
      const text = await res.text();
      broadcast({ ...feedBase, rtype: "document", size: text.length });
      return new Response(rewriteHtml(text, target), { status: res.status, headers: h2 });
    }
    if (/text\/css/.test(ct)) {
      const text = await res.text();
      broadcast({ ...feedBase, rtype: "stylesheet", size: text.length });
      return new Response(rewriteText(text, target), { status: res.status, headers: h2 });
    }
    if (/(javascript|json|ecmascript)/.test(ct)) {
      const text = await res.text();
      broadcast({ ...feedBase, rtype: "script", size: text.length });
      return new Response(rewriteText(text, target), { status: res.status, headers: h2 });
    }

    // binary / media / everything else — stream through untouched
    res
      .clone()
      .arrayBuffer()
      .then((b) => broadcast({ ...feedBase, rtype: ct.split("/")[0] || "other", size: b.byteLength }))
      .catch(() => broadcast({ ...feedBase, rtype: "other", size: 0 }));
    return new Response(res.body, { status: res.status, headers: h2 });
  } catch (e) {
    return new Response("WRAITH TUNNEL ERROR\n" + e.message + "\n\ntarget: " + target, {
      status: 502,
      headers: { "content-type": "text/plain" },
    });
  }
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (ev) => ev.waitUntil(self.clients.claim()));

self.addEventListener("message", (ev) => {
  const m = ev.data || {};
  if (m.type === "ping") {
    broadcast({
      type: "pong",
      t: m.t,
      v: VERSION,
      engine: W ? "WASM" : "JS-FALLBACK",
      wasmVersion: W ? W.version : null,
      transport: tunnel.ws ? "wisp-e2ee" : "local",
    });
  } else if (m.type === "set-blocklist") {
    verdicts.enabled = !!m.enabled;
    const hosts = m.hosts || [];
    verdicts.hosts = new Set(hosts);
    if (W) W.setHosts(hosts);
    else pendingHosts = hosts;
  } else if (m.type === "connect-tunnel") {
    connectTunnel(m.gateway).then((ok) =>
      broadcast({ type: "tunnel", ok, transport: ok ? "wisp-e2ee" : "local" })
    );
  }
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (!req.url.startsWith("http")) return;
  let u;
  try {
    u = new URL(req.url);
  } catch {
    return;
  }

  /* the rewriting proxy */
  if (u.pathname.startsWith(PROXY_PREFIX)) {
    ev.respondWith(proxyFetch(req));
    return;
  }

  /* everything else in scope: mirror + strict blocking */
  const host = u.hostname.replace(/^www\./, "");
  const path = (u.pathname + u.search).slice(0, 90);
  const rtype = req.destination || "fetch";

  if (isBlocked(host)) {
    broadcast({ type: "net", method: req.method, host, path, rtype, size: 0, blocked: true });
    ev.respondWith(new Response("", { status: 204, headers: { "X-Wraith-Verdict": "blocked" } }));
    return;
  }

  ev.respondWith(
    fetch(req)
      .then((res) => {
        try {
          res
            .clone()
            .arrayBuffer()
            .then((buf) =>
              broadcast({ type: "net", method: req.method, host, path, rtype, size: buf.byteLength, blocked: false })
            )
            .catch(() => broadcast({ type: "net", method: req.method, host, path, rtype, size: 0, blocked: false }));
        } catch {
          broadcast({ type: "net", method: req.method, host, path, rtype, size: 0, blocked: false });
        }
        return res;
      })
      .catch(() => new Response("", { status: 504, headers: { "X-Wraith-Verdict": "tunnel-timeout" } }))
  );
});
