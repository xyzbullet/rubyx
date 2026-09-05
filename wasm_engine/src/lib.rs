//! Wraith engine — WASM entrypoints consumed by /public/sw.js.
//!
//! Exposes:
//!   * ABP-compatible network + cosmetic filtering (`filters` module)
//!   * HTML / JS / CSS URL rewriting for the scoped proxy origin
//!
//! The TS mirror in /src/lib/engine.ts keeps verdicts identical so the
//! shell can run on the JS fallback when the WASM blob is absent.

mod filters;

use filters::{Engine, ResourceType, Verdict};
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
        let v: Verdict = self.inner.match_network(url, origin, rt, third_party);
        serde_wasm_bindgen::to_value(&v).unwrap_or(JsValue::NULL)
    }

    /// Newline-joined cosmetic selectors that apply to `host`.
    pub fn cosmetics_for(&self, host: &str) -> String {
        self.inner.cosmetics_for(host).join("\n")
    }

    pub fn stats(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.inner.stats()).unwrap_or(JsValue::NULL)
    }

    /// Rewrite an HTML document: absolutize relative URLs against the
    /// request origin, route navigable/resource URLs through the proxy
    /// prefix, and strip script tags whose src hits a blocked host.
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
    use crate::filters::{Engine, ResourceType};

    const URL_ATTRS: &[&str] = &["src=", "href=", "action=", "poster=", "srcset="];

    fn absolutize(url: &str, origin: &str) -> String {
        if url.starts_with("http://") || url.starts_with("https://") || url.starts_with("data:") {
            url.to_string()
        } else if url.starts_with("//") {
            format!("https:{url}")
        } else if url.starts_with('/') {
            format!("{origin}{url}")
        } else {
            format!("{origin}/{url}")
        }
    }

    pub fn html(doc: &str, origin: &str, prefix: &str, engine: &Engine) -> String {
        let mut out = String::with_capacity(doc.len() + 1024);
        let bytes = doc.as_bytes();
        let mut i = 0;

        while i < bytes.len() {
            // drop <script src="…blocked-host…"> tags entirely
            if bytes[i] == b'<' && doc[i..].get(..7).map(|s| s.eq_ignore_ascii_case("<script")) == Some(true) {
                if let Some(end) = doc[i..].find('>') {
                    let tag = &doc[i..i + end + 1];
                    if let Some(src_pos) = tag.to_ascii_lowercase().find("src=") {
                        let rest = &tag[src_pos + 5..];
                        let quote = rest.as_bytes().first().copied().unwrap_or(b'"');
                        if let Some(q2) = rest[1..].find(quote as char) {
                            let src = &rest[1..1 + q2];
                            let abs = absolutize(src, origin);
                            let v = engine.match_network(&abs, origin, ResourceType::Script, true);
                            if v.verdict == "block" {
                                i += end + 1; // swallow the opening tag; </script> is inert without src
                                continue;
                            }
                        }
                    }
                }
            }
            out.push(bytes[i] as char);
            i += 1;
        }

        // attribute pass (kept separate for clarity; single allocation)
        let mut rewritten = out;
        for attr in URL_ATTRS {
            let mut idx = 0;
            while let Some(pos) = rewritten[idx..].to_ascii_lowercase().find(attr) {
                let start = idx + pos + attr.len();
                let b = rewritten.as_bytes();
                if start >= b.len() {
                    break;
                }
                let quote = b[start] as char;
                if quote != '"' && quote != '\'' {
                    idx = start;
                    continue;
                }
                if let Some(end) = rewritten[start + 1..].find(quote) {
                    let url = &rewritten[start + 1..start + 1 + end];
                    if !url.starts_with("data:") && !url.starts_with("javascript:") && !url.starts_with('#') {
                        let abs = absolutize(url, origin);
                        let proxied = format!("{prefix}{abs}");
                        rewritten.replace_range(start + 1..start + 1 + end, &proxied);
                        idx = start + 1 + proxied.len();
                    } else {
                        idx = start + 1 + end;
                    }
                } else {
                    break;
                }
            }
        }
        rewritten
    }

    /// Prefix absolute http(s) literals inside JS with the proxy route.
    pub fn js(src: &str, prefix: &str) -> String {
        let mut out = String::with_capacity(src.len() + 256);
        let mut rest = src;
        while let Some(pos) = rest.find("https://").or_else(|| rest.find("http://")) {
            let p = match (rest.find("https://"), rest.find("http://")) {
                (Some(a), Some(b)) => a.min(b),
                (Some(a), None) => a,
                (None, b) => b.unwrap(),
            };
            out.push_str(&rest[..p]);
            // find literal end (quote or backtick or whitespace)
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
            if raw.starts_with("http") {
                out.push_str(prefix);
            }
            out.push_str(&tail[..end]);
            rest = &tail[end..];
        }
        out.push_str(rest);
        out
    }
}
