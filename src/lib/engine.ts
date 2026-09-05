/**
 * Wraith filter engine — TypeScript mirror of /wasm_engine (Rust/wasm-pack).
 *
 * Implements an ABP/uBlock-compatible filter parser & matcher:
 *  - network rules: pattern globs (*, ^, |, ||host anchors), $options
 *    (script, image, stylesheet, xmlhttprequest, websocket, document,
 *     third-party, first-party, domain=, important, ~negation)
 *  - whitelist rules (@@) with `important` precedence handling
 *  - cosmetic rules (##, ###, #@#) resolved per-host with domain options
 *
 * The service worker receives verdicts from this engine (or the WASM build
 * when compiled) and enforces strict request blocking at fetch time.
 */

import { EASYLIST_EXCERPT, WRAITH_CORE_LIST } from "./lib";

export type ResourceType =
  | "script"
  | "image"
  | "stylesheet"
  | "xmlhttprequest"
  | "websocket"
  | "document"
  | "subdocument"
  | "media"
  | "font"
  | "ping"
  | "other";

const TYPE_ALIASES: Record<string, ResourceType[]> = {
  script: ["script"],
  image: ["image"],
  stylesheet: ["stylesheet"],
  css: ["stylesheet"],
  xmlhttprequest: ["xmlhttprequest"],
  xhr: ["xmlhttprequest"],
  fetch: ["xmlhttprequest"],
  websocket: ["websocket"],
  document: ["document"],
  subdocument: ["subdocument"],
  iframe: ["subdocument"],
  media: ["media"],
  font: ["font"],
  ping: ["ping"],
  beacon: ["ping"],
  other: ["other"],
};

const KNOWN_OPTS = new Set([
  "script", "image", "stylesheet", "css", "xmlhttprequest", "xhr", "fetch",
  "websocket", "document", "subdocument", "iframe", "media", "font", "ping",
  "beacon", "other", "third-party", "first-party", "domain", "important",
  "elemhide", "generichide", "match-case", "all", "badfilter", "denyallow",
  "from", "to", "method", "redirect", "removeparam", "csp", "inline-script",
  "inline-font", "min-length", "popup", "strict1p", "strict3p",
]);

export interface NetRule {
  kind: "net";
  raw: string;
  re: RegExp;
  whitelist: boolean;
  important: boolean;
  types: Set<ResourceType> | null;
  domainInc: string[] | null;
  domainExc: string[] | null;
  thirdParty: boolean | null;
}

export interface CosmeticRule {
  kind: "cosmetic";
  raw: string;
  host: string; // '' = global
  selector: string;
  exception: boolean;
}

export type Rule = NetRule | CosmeticRule;

export interface Verdict {
  verdict: "block" | "allow" | "pass";
  rule?: Rule;
}

function splitOptions(part: string): { pattern: string; options: string | null } {
  const idx = part.lastIndexOf("$");
  if (idx <= 0 || idx === part.length - 1) return { pattern: part, options: null };
  const opts = part.slice(idx + 1).split(",");
  const known = opts.every((o) => {
    const k = o.replace(/^[~!]/, "").split("=")[0];
    return KNOWN_OPTS.has(k);
  });
  if (!known) return { pattern: part, options: null };
  return { pattern: part.slice(0, idx), options: part.slice(idx + 1) };
}

function patternToRegex(pattern: string): RegExp {
  let p = pattern;
  const endAnchored = p.endsWith("|");
  if (endAnchored) p = p.slice(0, -1);
  const startAnchored = p.startsWith("|");
  if (startAnchored) p = p.slice(1);
  const hostAnchored = p.startsWith("||");
  if (hostAnchored) p = p.slice(2);

  let body = p
    .replace(/[.+?{}()[\]\\^$]/g, (m) => "\\" + m)
    .replace(/\*/g, ".*")
    .replace(/\^/g, "(?:[^a-zA-Z0-9_.%-]|$)");

  if (hostAnchored) body = "^[a-z][a-z0-9+.-]*://(?:[^/?#]+\\.)?" + body;
  else if (startAnchored) body = "^" + body;
  if (endAnchored) body += "$";
  return new RegExp(body, "i");
}

function parseLine(line: string): Rule | null {
  const t = line.trim();
  if (!t || t.startsWith("!") || t.startsWith("[Adblock")) return null;

  // cosmetic -----------------------------------------------------------
  const cIdx = t.search(/##|#@#|#\?#/);
  if (cIdx >= 0) {
    const sep = t.slice(cIdx, cIdx + 3);
    if (sep === "##" || sep === "#@#" || sep === "#?#") {
      const host = t.slice(0, cIdx);
      const selector = t.slice(cIdx + 3).trim();
      if (!selector) return null;
      if (host.includes(",") || host.includes("$")) return null;
      return { kind: "cosmetic", raw: t, host, selector, exception: sep === "#@#" };
    }
  }

  // network ------------------------------------------------------------
  const whitelist = t.startsWith("@@");
  const body = whitelist ? t.slice(2) : t;
  const { pattern, options } = splitOptions(body);
  if (!pattern) return null;

  let important = false;
  let types: Set<ResourceType> | null = null;
  let domainInc: string[] | null = null;
  let domainExc: string[] | null = null;
  let thirdParty: boolean | null = null;

  if (options) {
    for (const opt of options.split(",")) {
      const neg = opt.startsWith("~");
      const key = (neg ? opt.slice(1) : opt).toLowerCase();
      const eq = key.indexOf("=");
      const name = eq >= 0 ? key.slice(0, eq) : key;
      const val = eq >= 0 ? key.slice(eq + 1) : null;
      switch (name) {
        case "important":
          important = true;
          break;
        case "third-party":
          thirdParty = !neg;
          break;
        case "first-party":
          thirdParty = neg;
          break;
        case "domain":
          if (val) {
            for (const d of val.split("|")) {
              if (d.startsWith("~")) (domainExc ??= []).push(d.slice(1));
              else (domainInc ??= []).push(d);
            }
          }
          break;
        default: {
          const aliases = TYPE_ALIASES[name];
          if (aliases) {
            types ??= new Set();
            if (neg) types.add("other");
            else aliases.forEach((a) => types!.add(a));
          }
        }
      }
    }
  }

  let re: RegExp;
  try {
    re = patternToRegex(pattern);
  } catch {
    return null;
  }
  return { kind: "net", raw: t, re, whitelist, important, types, domainInc, domainExc, thirdParty };
}

export class FilterEngine {
  rules: Rule[] = [];
  private net: NetRule[] = [];
  private cos: CosmeticRule[] = [];

  load(lists: string[]): void {
    const rules: Rule[] = [];
    for (const list of lists) {
      for (const line of list.split("\n")) {
        const r = parseLine(line);
        if (r) rules.push(r);
      }
    }
    this.rules = rules;
    this.net = rules.filter((r): r is NetRule => r.kind === "net");
    this.cos = rules.filter((r): r is CosmeticRule => r.kind === "cosmetic");
  }

  stats() {
    return {
      total: this.rules.length,
      network: this.net.length,
      cosmetic: this.cos.length,
      exceptions: this.net.filter((r) => r.whitelist).length + this.cos.filter((r) => r.exception).length,
    };
  }

  matchNetwork(
    url: string,
    ctx: { origin: string; rtype: ResourceType; thirdParty?: boolean }
  ): Verdict {
    let blocked: NetRule | null = null;
    let whitelisted: NetRule | null = null;
    let importantBlock: NetRule | null = null;
    const originHost = ctx.origin.replace(/^www\./, "");

    for (const r of this.net) {
      if (r.types && !r.types.has(ctx.rtype)) continue;
      if (r.thirdParty !== null && r.thirdParty !== (ctx.thirdParty ?? true)) continue;
      if (r.domainInc || r.domainExc) {
        const inExc = r.domainExc?.some((d) => originHost === d || originHost.endsWith("." + d));
        if (inExc) continue;
        if (r.domainInc && !r.domainInc.some((d) => originHost === d || originHost.endsWith("." + d))) continue;
      }
      if (!r.re.test(url)) continue;
      if (r.whitelist) {
        if (!whitelisted || r.important) whitelisted = r;
      } else if (r.important) {
        importantBlock = r;
      } else if (!blocked) {
        blocked = r;
      }
    }

    if (importantBlock) return { verdict: "block", rule: importantBlock };
    if (whitelisted) return { verdict: "allow", rule: whitelisted };
    if (blocked) return { verdict: "block", rule: blocked };
    return { verdict: "pass" };
  }

  cosmeticsFor(host: string): string[] {
    const h = host.replace(/^www\./, "");
    const out: string[] = [];
    const exc = new Set<string>();
    for (const r of this.cos) {
      const match =
        !r.host ||
        h === r.host ||
        h.endsWith("." + r.host) ||
        r.host.split(",").some((d) => h === d || h.endsWith("." + d));
      if (!match) continue;
      if (r.exception) exc.add(r.selector);
      else out.push(r.selector);
    }
    return out.filter((s) => !exc.has(s));
  }

  /** Bulk sweep used by the playground benchmark — returns ops/sec. */
  benchmark(urls: string[], ctx: { origin: string; rtype: ResourceType }): { ops: number; ms: number } {
    const t0 = performance.now();
    for (const u of urls) this.matchNetwork(u, ctx);
    const ms = performance.now() - t0;
    return { ops: Math.round((urls.length / ms) * 1000), ms: Math.max(ms, 0.01) };
  }
}

export const engine = new FilterEngine();

/** Compose the active list corpus from shield settings. */
export function buildLists(cfg: {
  adblock: boolean;
  lists: { id: string; enabled: boolean }[];
  customList: string;
}): string[] {
  const lists: string[] = [];
  if (!cfg.adblock) return lists;
  if (cfg.lists.find((l) => l.id === "core")?.enabled) lists.push(WRAITH_CORE_LIST);
  if (cfg.lists.find((l) => l.id === "easylist")?.enabled) lists.push(EASYLIST_EXCERPT);
  if (cfg.customList.trim()) lists.push(cfg.customList);
  return lists;
}

export function sampleUrls(): string[] {
  const hosts = [
    "doubleclick.net", "googlesyndication.com", "cdn.wraith.dev", "en.wikipedia.org",
    "graph.facebook.com", "api.openai.com", "ads.tiktok.com", "static.cloudflareinsights.com",
    "www.google-analytics.com", "media.fastly.net", "taboola.com", "lite.duckduckgo.com",
  ];
  const paths = ["/tag/js/gpt.js", "/tr?id=42", "/v1/stream", "/img/hero.webp", "/beacon.gif", "/chunk-88.js"];
  const out: string[] = [];
  for (let i = 0; i < 1200; i++) {
    const h = hosts[i % hosts.length];
    const p = paths[(i * 7) % paths.length];
    out.push(`https://${h}${p}?q=${i}`);
  }
  return out;
}
