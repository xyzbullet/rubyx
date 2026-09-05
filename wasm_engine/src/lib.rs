//! Wraith engine — WASM entrypoints consumed by /public/sw.js.
//!
//! Exposes:
//!   * ABP-compatible network + cosmetic filtering (`filters` module)
//!   * HTML / JS / CSS URL rewriting for the scoped proxy origin
//!
//! The TS mirror in /src/lib/engine.ts keeps verdicts identical so the
//! shell can run on the JS fallback when the WASM blob is absent.

mod filters;

use filters::{Engine, ResourceType, VerdictKind};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WraithEngine {
    inner: Engine,
    proxy_prefix: String,
}

#[wasm_bindgen]
impl WraithEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(proxy_prefix: &str) -> WraithEngine {
        WraithEngine {
            inner: Engine::new(),
            proxy_prefix: proxy_prefix.to_string(),
        }
    }

    /// Parse + compile filter lists (ABP syntax). Returns rule count.
    pub fn load_filters(&mut self, text: &str) -> usize {
        self.inner.load(text);
        self.inner.len()
    }

    /// Network verdict for a request URL. Serialized as
    /// `{ verdict: "block" | "allow" | "pass", rule?: string }`.
    pub fn match_network(
        &self,
        url: &str,
        origin: &str,
        rtype: &str,
        third_party: bool,
    ) -> JsValue {
        let rt = ResourceType::parse(rtype);
        let v = self.inner.match_network(url, origin, rt, third_party);
        serde_wasm_bindgen::to_value(&v).unwrap_or(JsValue::NULL)
    }

    /// Newline-joined cosmetic selectors that apply to `host`.
    pub fn cosmetics_for(&self, host: &str) -> String {
        self.inner.cosmetics_for(host).join("\n")
    }

    pub fn stats(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.inner.stats()).unwrap_or(JsValue::NULL)
    }

    /// Rewrite an HTML document: route navigable/resource URLs through the
    /// proxy prefix and strip script tags whose src hits a blocked host.
    pub fn rewrite_html(&self, html: &str, origin: &str) -> String {
        rewrite::html(html, origin, &self.proxy_prefix, &self.inner)
    }

    /// Rewrite string-literal URLs inside JavaScript modules.
    pub fn rewrite_js(&self, js: &str) -> String {
        rewrite::js(js, &self.proxy_prefix)
    }

    /// Rewrite url(...) tokens inside CSS.
    pub fn rewrite_css(&self, css: &str) -> String {
        rewrite::css(css, &self.proxy_prefix)
    }

    /// Ops/sec over `n` synthetic request matches (playground parity).
    pub fn bench(&self, n: u32) -> f64 {
        let hosts = [
            "doubleclick.net",
            "googlesyndication.com",
            "cdn.wraith.dev",
            "graph.facebook.com",
            "ads.tiktok.com",
            "en.wikipedia.org",
        ];
        let start = js_sys::Date::now();
        for i in 0..n {
            let url = format!("https://{}/tag/js/gpt.js?c={}", hosts[(i % 6) as usize], i);
            let _ = self
                .inner
                .match_network(&url, "https://example.com", ResourceType::Script, true);
        }
        let ms = (js_sys::Date::now() - start).max(0.001);
        (n as f64 / ms) * 1000.0
    }
}

/* ------------------------------------------------------------ rewriter */

mod rewrite {
    use crate::filters::{Engine, ResourceType, VerdictKind};

    const URL_ATTRS: &[&str] = &["src=", "href=", "action=", "poster=", "srcset="];

    fn has_scheme(url: &str) -> bool {
        url.contains("://")
            || url.starts_with("data:")
            || url.starts_with("javascript:")
            || url.starts_with("mailto:")
            || url.starts_with("about:")
    }

    fn absolutize(url: &str, origin: &str) -> String {
        if has_scheme(url) {
            url.to_string()
        } else if let Some(rest) = url.strip_prefix("//") {
            format!("https://{rest}")
        } else if let Some(rest) = url.strip_prefix('/') {
            format!("{origin}/{rest}")
        } else {
            format!("{origin}/{url}")
        }
    }

    /// Extract the quoted value following `attr=` (case-insensitive hit).
    fn quoted_value<'a>(tag: &'a str, tag_lower: &str, attr: &str) -> Option<&'a str> {
        let pos = tag_lower.find(attr)?;
        let rest = &tag[pos + attr.len()..];
        let mut rb = rest.as_bytes();
        // tolerate whitespace between = and the quote
        let mut skip = 0;
        while skip < rb.len() && (rb[skip] == b' ' || rb[skip] == b'\t') {
            skip += 1;
        }
        rb = &rb[skip..];
        let quote = *rb.first()?;
        if quote != b'"' && quote != b'\'' {
            return None;
        }
        let inner = &rest[skip + 1..];
        let end = inner.find(quote as char)?;
        Some(&inner[..end])
    }

    pub fn html(doc: &str, origin: &str, prefix: &str, engine: &Engine) -> String {
        // lower-cased twin keeps byte offsets aligned for tag scanning
        let lower = doc.to_ascii_lowercase();
        let mut out = String::with_capacity(doc.len() + 1024);
        let mut i = 0;

        while i < doc.len() {
            if lower[i..].starts_with("<script") {
                if let Some(rel) = doc[i..].find('>') {
                    let tag = &doc[i..i + rel + 1];
                    let tag_lower = &lower[i..i + rel + 1];
                    let mut drop_tag = false;
                    if let Some(src) = quoted_value(tag, tag_lower, "src=") {
                        let abs = absolutize(src, origin);
                        if engine.match_network(&abs, origin, ResourceType::Script, true).verdict
                            == VerdictKind::Block
                        {
                            drop_tag = true;
                        }
                    }
                    if drop_tag {
                        i += rel + 1;
                        continue;
                    }
                    out.push_str(tag);
                    i += rel + 1;
                    continue;
                }
            }
            // copy one UTF-8 char at a time (byte-slicing a &str must stay on boundaries)
            let ch = doc[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }

        // attribute pass — single allocation, positions recomputed per attr
        let mut rewritten = out;
        for attr in URL_ATTRS {
            let mut idx = 0;
            while idx < rewritten.len() {
                let hay = rewritten[idx..].to_ascii_lowercase();
                let Some(pos) = hay.find(attr) else { break };
                let start = idx + pos + attr.len();
                if start >= rewritten.len() {
                    break;
                }
                let bytes = rewritten.as_bytes();
                let quote = bytes[start];
                if quote != b'"' && quote != b'\'' {
                    idx = start;
                    continue;
                }
                let Some(end) = rewritten[start + 1..].find(quote as char) else {
                    break;
                };
                let url = &rewritten[start + 1..start + 1 + end];
                if url.is_empty() || has_scheme(url) || url.starts_with('#') {
                    idx = start + 1 + end;
                    continue;
                }
                let abs = absolutize(url, origin);
                let proxied = format!("{prefix}{abs}");
                rewritten.replace_range(start + 1..start + 1 + end, &proxied);
                idx = start + 1 + proxied.len();
            }
        }
        rewritten
    }

    /// Prefix absolute http(s) literals inside JS with the proxy route.
    pub fn js(src: &str, prefix: &str) -> String {
        let mut out = String::with_capacity(src.len() + 256);
        let mut rest = src;
        loop {
            let https = rest.find("https://");
            let http = rest.find("http://");
            let p = match (https, http) {
                (None, None) => break,
                (Some(a), None) => a,
                (None, Some(b)) => b,
                (Some(a), Some(b)) => a.min(b),
            };
            out.push_str(&rest[..p]);
            let tail = &rest[p..];
            let end = tail
                .find(|c: char| c == '"' || c == '\'' || c == '`' || c.is_whitespace())
                .unwrap_or(tail.len());
            out.push_str(prefix);
            out.push_str(&tail[..end]);
            rest = &tail[end..];
        }
        out.push_str(rest);
        out
    }

    pub fn css(src: &str, prefix: &str) -> String {
        let mut out = String::with_capacity(src.len() + 128);
        let mut rest = src;
        while let Some(pos) = rest.find("url(") {
            let start = pos + 4;
            out.push_str(&rest[..start]);
            let tail = &rest[start..];
            let end = tail.find(')').unwrap_or(tail.len());
            let raw = tail[..end].trim().trim_matches(|c| c == '"' || c == '\'');
            if raw.starts_with("http://") || raw.starts_with("https://") {
                out.push_str(prefix);
            }
            out.push_str(&tail[..end]);
            rest = &tail[end..];
        }
        out.push_str(rest);
        out
    }
}
