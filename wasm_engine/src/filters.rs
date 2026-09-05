//! ABP / uBlock-compatible filter parser + matcher — deliberately
//! regex-free: patterns compile to a small segment automaton.

use serde::Serialize;

#[derive(Clone, Copy, PartialEq)]
pub enum ResourceType {
    Script, Image, Stylesheet, Xhr, Websocket, Document, Subdocument, Media, Font, Ping, Other,
}

impl ResourceType {
    pub fn parse(s: &str) -> Self {
        match s {
            "script" => Self::Script,
            "image" => Self::Image,
            "stylesheet" | "css" => Self::Stylesheet,
            "xmlhttprequest" | "xhr" | "fetch" => Self::Xhr,
            "websocket" => Self::Websocket,
            "document" => Self::Document,
            "subdocument" | "iframe" => Self::Subdocument,
            "media" => Self::Media,
            "font" => Self::Font,
            "ping" | "beacon" => Self::Ping,
            _ => Self::Other,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VerdictKind { Block, Allow, Pass }

#[derive(Serialize)]
pub struct Verdict {
    pub verdict: VerdictKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule: Option<String>,
}

#[derive(PartialEq, Clone)]
enum Seg { Lit(String), Wild, Sep }

pub struct NetRule {
    pub raw: String,
    segs: Vec<Seg>,
    host_anchored: bool,
    start_anchored: bool,
    end_anchored: bool,
    whitelist: bool,
    important: bool,
    types: Option<Vec<ResourceType>>,
    domain_inc: Vec<String>,
    domain_exc: Vec<String>,
    third_party: Option<bool>,
}

pub struct CosmeticRule {
    pub raw: String,
    pub host: String,
    pub selector: String,
    pub exception: bool,
}

#[derive(Serialize)]
pub struct Stats {
    pub total: usize,
    pub network: usize,
    pub cosmetic: usize,
    pub exceptions: usize,
}

#[derive(Default)]
pub struct Engine {
    net: Vec<NetRule>,
    cos: Vec<CosmeticRule>,
}

const KNOWN_OPTS: &[&str] = &[
    "script","image","stylesheet","css","xmlhttprequest","xhr","fetch","websocket","document",
    "subdocument","iframe","media","font","ping","beacon","other","third-party","first-party",
    "domain","important","elemhide","generichide","match-case","all","badfilter","denyallow",
    "from","to","method","redirect","removeparam","csp","popup",
];

fn type_aliases(name: &str) -> Option<Vec<ResourceType>> {
    use ResourceType::*;
    Some(match name {
        "script" => vec![Script],
        "image" => vec![Image],
        "stylesheet" | "css" => vec![Stylesheet],
        "xmlhttprequest" | "xhr" | "fetch" => vec![Xhr],
        "websocket" => vec![Websocket],
        "document" => vec![Document],
        "subdocument" | "iframe" => vec![Subdocument],
        "media" => vec![Media],
        "font" => vec![Font],
        "ping" | "beacon" => vec![Ping],
        "other" => vec![Other],
        _ => return None,
    })
}

fn compile_pattern(p: &str) -> (Vec<Seg>, bool, bool, bool) {
    let mut pat = p;
    let end_anchored = pat.ends_with('|');
    if end_anchored { pat = &pat[..pat.len() - 1]; }
    let start_anchored = pat.starts_with('|');
    if start_anchored { pat = &pat[1..]; }
    let host_anchored = pat.starts_with("||");
    if host_anchored { pat = &pat[2..]; }

    let mut segs = Vec::new();
    let mut lit = String::new();
    for c in pat.chars() {
        match c {
            '*' => { if !lit.is_empty() { segs.push(Seg::Lit(std::mem::take(&mut lit))); } segs.push(Seg::Wild); }
            '^' => { if !lit.is_empty() { segs.push(Seg::Lit(std::mem::take(&mut lit))); } segs.push(Seg::Sep); }
            _ => lit.push(c),
        }
    }
    if !lit.is_empty() { segs.push(Seg::Lit(lit)); }
    (segs, host_anchored, start_anchored, end_anchored)
}

fn is_sep(b: u8) -> bool {
    !(b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b'%'))
}

/// Backtracking segment match against lowercased haystack.
fn seg_match(segs: &[Seg], hay: &[u8], hi: usize, must_end: bool) -> bool {
    if segs.is_empty() {
        return !must_end || hi == hay.len();
    }
    match &segs[0] {
        Seg::Lit(l) => {
            let lb = l.as_bytes();
            if hi + lb.len() > hay.len() || &hay[hi..hi + lb.len()] != lb {
                return false;
            }
            seg_match(&segs[1..], hay, hi + lb.len(), must_end)
        }
        Seg::Sep => {
            if hi < hay.len() && !is_sep(hay[hi]) {
                return false;
            }
            seg_match(&segs[1..], hay, hi, must_end)
        }
        Seg::Wild => {
            if segs.len() == 1 {
                return !must_end || true;
            }
            for skip in 0..=(hay.len() - hi) {
                if seg_match(&segs[1..], hay, hi + skip, must_end) {
                    return true;
                }
            }
            false
        }
    }
}

impl NetRule {
    fn matches(&self, url: &str) -> bool {
        let hay = url.to_ascii_lowercase();
        let bytes = hay.as_bytes();

        let starts: Vec<usize> = if self.host_anchored {
            // scheme://[sub.]host positions
            match hay.find("://") {
                Some(s) => {
                    let host_start = s + 3;
                    let host_end = bytes[host_start..]
                        .iter().position(|b| matches!(b, b'/' | b'?' | b'#'))
                        .map(|p| p + host_start)
                        .unwrap_or(bytes.len());
                    let host = &hay[host_start..host_end];
                    let mut v = vec![host_start];
                    for (i, _) in host.match_indices('.') {
                        v.push(host_start + i + 1);
                    }
                    v
                }
                None => return false,
            }
        } else if self.start_anchored {
            vec![0]
        } else {
            (0..=bytes.len().saturating_sub(1)).collect()
        };

        for st in starts {
            if seg_match(&self.segs, bytes, st, self.end_anchored) {
                return true;
            }
        }
        false
    }
}

impl Engine {
    pub fn new() -> Self { Self::default() }

    pub fn len(&self) -> usize { self.net.len() + self.cos.len() }

    pub fn stats(&self) -> Stats {
        Stats {
            total: self.len(),
            network: self.net.len(),
            cosmetic: self.cos.len(),
            exceptions: self.net.iter().filter(|r| r.whitelist).count()
                + self.cos.iter().filter(|r| r.exception).count(),
        }
    }

    pub fn load(&mut self, text: &str) {
        self.net.clear();
        self.cos.clear();
        for line in text.lines() {
            let t = line.trim();
            if t.is_empty() || t.starts_with('!') || t.starts_with("[Adblock") { continue; }
            self.parse_line(t);
        }
    }

    fn parse_line(&mut self, t: &str) {
        // cosmetic ---------------------------------------------------
        for sep in ["##", "#@#", "#?#"] {
            if let Some(pos) = t.find(sep) {
                let host = &t[..pos];
                let selector = t[pos + 3..].trim().to_string();
                if selector.is_empty() || host.contains(',') || host.contains('$') { return; }
                self.cos.push(CosmeticRule {
                    raw: t.to_string(),
                    host: host.to_string(),
                    selector,
                    exception: sep == "#@#",
                });
                return;
            }
        }

        // network ----------------------------------------------------
        let whitelist = t.starts_with("@@");
        let body = if whitelist { &t[2..] } else { t };
        let (pattern, options) = match body.rfind('$') {
            Some(i) if i > 0 && i < body.len() - 1 => {
                let opts = &body[i + 1..];
                let known = opts.split(',').all(|o| {
                    let k = o.trim_start_matches(['~', '!']).split('=').next().unwrap_or("");
                    KNOWN_OPTS.contains(&k)
                });
                if known { (&body[..i], Some(opts)) } else { (body, None) }
            }
            _ => (body, None),
        };
        if pattern.is_empty() { return; }

        let mut rule = NetRule {
            raw: t.to_string(),
            segs: Vec::new(),
            host_anchored: false,
            start_anchored: false,
            end_anchored: false,
            whitelist,
            important: false,
            types: None,
            domain_inc: Vec::new(),
            domain_exc: Vec::new(),
            third_party: None,
        };

        if let Some(opts) = options {
            for opt in opts.split(',') {
                let neg = opt.starts_with('~');
                let key = if neg { &opt[1..] } else { opt }.to_ascii_lowercase();
                let (name, val) = match key.split_once('=') {
                    Some((n, v)) => (n.to_string(), Some(v.to_string())),
                    None => (key, None),
                };
                match name.as_str() {
                    "important" => rule.important = true,
                    "third-party" => rule.third_party = Some(!neg),
                    "first-party" => rule.third_party = Some(neg),
                    "domain" => {
                        if let Some(v) = val {
                            for d in v.split('|') {
                                if let Some(stripped) = d.strip_prefix('~') {
                                    rule.domain_exc.push(stripped.to_string());
                                } else {
                                    rule.domain_inc.push(d.to_string());
                                }
                            }
                        }
                    }
                    other => {
                        if let Some(aliases) = type_aliases(other) {
                            let t = rule.types.get_or_insert_with(Vec::new);
                            if neg { t.push(ResourceType::Other); } else { t.extend(aliases); }
                        }
                    }
                }
            }
        }

        let (segs, ha, sa, ea) = compile_pattern(pattern);
        rule.segs = segs;
        rule.host_anchored = ha;
        rule.start_anchored = sa;
        rule.end_anchored = ea;
        self.net.push(rule);
    }

    pub fn match_network(&self, url: &str, origin: &str, rtype: ResourceType, third_party: bool) -> Verdict {
        let origin_host = origin.trim_start_matches("https://").trim_start_matches("http://");
        let origin_host = origin_host.split(['/', ':']).next().unwrap_or("").trim_start_matches("www.").to_string();

        let mut blocked: Option<&NetRule> = None;
        let mut whitelisted: Option<&NetRule> = None;
        let mut important: Option<&NetRule> = None;

        for r in &self.net {
            if let Some(types) = &r.types {
                if !types.contains(&rtype) { continue; }
            }
            if let Some(tp) = r.third_party {
                if tp != third_party { continue; }
            }
            if !r.domain_inc.is_empty() || !r.domain_exc.is_empty() {
                if r.domain_exc.iter().any(|d| origin_host == *d || origin_host.ends_with(&format!(".{d}"))) { continue; }
                if !r.domain_inc.is_empty()
                    && !r.domain_inc.iter().any(|d| origin_host == *d || origin_host.ends_with(&format!(".{d}")))
                { continue; }
            }
            if !r.matches(url) { continue; }
            if r.whitelist { whitelisted = Some(r); }
            else if r.important { important = Some(r); }
            else if blocked.is_none() { blocked = Some(r); }
        }

        let pick = important.or(whitelisted).or(blocked);
        match pick {
            Some(r) if r.whitelist => Verdict { verdict: VerdictKind::Allow, rule: Some(r.raw.clone()) },
            Some(r) => Verdict { verdict: VerdictKind::Block, rule: Some(r.raw.clone()) },
            None => Verdict { verdict: VerdictKind::Pass, rule: None },
        }
    }

    pub fn cosmetics_for(&self, host: &str) -> Vec<String> {
        let h = host.trim_start_matches("www.");
        let mut exc = std::collections::HashSet::new();
        let mut out = Vec::new();
        for r in &self.cos {
            let hit = r.host.is_empty()
                || h == r.host
                || h.ends_with(&format!(".{}", r.host))
                || r.host.split(',').any(|d| h == d || h.ends_with(&format!(".{d}")));
            if !hit { continue; }
            if r.exception { exc.insert(r.selector.clone()); } else { out.push(r.selector.clone()); }
        }
        out.retain(|s| !exc.contains(s));
        out
    }
}
