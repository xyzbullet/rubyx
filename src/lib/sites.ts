/**
 * Site directory — the full launch library.
 *
 * Every URL in the omnibox tunnels regardless; this list is curation, not a
 * whitelist. `direct: true` marks hosts that send X-Frame-Options / CSP
 * frame-ancestors: the shell still attempts the embed, detects the refusal,
 * and offers direct-mode fallback (open raw, txtify, retry).
 */

export type SiteCat =
  | "reference"
  | "news"
  | "search"
  | "dev"
  | "games"
  | "social"
  | "video"
  | "music";

export interface SiteEntry {
  name: string;
  url: string;
  cat: SiteCat;
  tag?: string;
  direct?: boolean;
}

export const SITE_CATS: { id: SiteCat; label: string }[] = [
  { id: "reference", label: "Reference" },
  { id: "news", label: "News" },
  { id: "search", label: "Search" },
  { id: "dev", label: "Dev" },
  { id: "games", label: "Games" },
  { id: "social", label: "Social" },
  { id: "video", label: "Video" },
  { id: "music", label: "Music" },
];

export const SITES: SiteEntry[] = [
  /* ---- reference ---- */
  { name: "Wikipedia", url: "https://en.m.wikipedia.org/wiki/Main_Page", cat: "reference", tag: "enc" },
  { name: "Wikipedia Random", url: "https://en.m.wikipedia.org/wiki/Special:Random", cat: "reference", tag: "rng" },
  { name: "Wiktionary", url: "https://en.m.wiktionary.org/", cat: "reference", tag: "dict" },
  { name: "Wikisource", url: "https://en.m.wikisource.org/", cat: "reference", tag: "src" },
  { name: "OpenStreetMap", url: "https://www.openstreetmap.org/export/embed.html?bbox=-74.02,40.70,-73.95,40.76&layer=mapnik", cat: "reference", tag: "map" },
  { name: "wttr.in", url: "https://wttr.in/?F", cat: "reference", tag: "wx" },
  { name: "Project Gutenberg", url: "https://www.gutenberg.org/", cat: "reference", tag: "books" },
  { name: "info.cern.ch", url: "http://info.cern.ch/", cat: "reference", tag: "1991" },
  { name: "Example Domain", url: "https://example.com/", cat: "reference", tag: "rfc" },
  { name: "txtify.it", url: "https://txtify.it/", cat: "reference", tag: "any→text" },
  { name: "Time and Date", url: "https://www.timeanddate.com/worldclock/", cat: "reference", tag: "clocks" },

  /* ---- news ---- */
  { name: "NPR Text", url: "https://text.npr.org/", cat: "news", tag: "lite" },
  { name: "CNN Lite", url: "https://lite.cnn.com/", cat: "news", tag: "lite" },
  { name: "68k News", url: "https://68k.news/", cat: "news", tag: "ascii" },
  { name: "Hacker News", url: "https://news.ycombinator.com/", cat: "news", tag: "tech" },
  { name: "Lobsters", url: "https://lobste.rs/", cat: "news", tag: "tech" },

  /* ---- search ---- */
  { name: "DuckDuckGo Lite", url: "https://lite.duckduckgo.com/lite/", cat: "search", tag: "srch" },
  { name: "Marginalia", url: "https://search.marginalia.nu/", cat: "search", tag: "index" },
  { name: "Google", url: "https://www.google.com/", cat: "search", direct: true },
  { name: "Bing", url: "https://www.bing.com/", cat: "search", direct: true },
  { name: "DuckDuckGo", url: "https://duckduckgo.com/", cat: "search", direct: true },

  /* ---- dev ---- */
  { name: "httpbin", url: "https://httpbin.org/", cat: "dev", tag: "api" },
  { name: "JSON Placeholder", url: "https://jsonplaceholder.typicode.com/", cat: "dev", tag: "api" },
  { name: "Can I Use", url: "https://caniuse.com/", cat: "dev", tag: "compat" },
  { name: "Rust std docs", url: "https://doc.rust-lang.org/std/", cat: "dev", tag: "docs" },
  { name: "MDN Web Docs", url: "https://developer.mozilla.org/", cat: "dev", tag: "docs", direct: true },
  { name: "GitHub", url: "https://github.com/", cat: "dev", direct: true },
  { name: "Stack Overflow", url: "https://stackoverflow.com/", cat: "dev", direct: true },
  { name: "npm", url: "https://www.npmjs.com/", cat: "dev", direct: true },

  /* ---- games ---- */
  { name: "2048", url: "https://play2048.co/", cat: "games", tag: "puzzle" },
  { name: "Hextris", url: "https://hextris.io/", cat: "games", tag: "arcade" },
  { name: "T-Rex Runner", url: "https://wayou.github.io/t-rex-runner/", cat: "games", tag: "dino" },
  { name: "A Dark Room", url: "https://adarkroom.doublespeakgames.com/", cat: "games", tag: "text" },
  { name: "React Tetris", url: "https://chvin.github.io/react-tetris/", cat: "games", tag: "classic" },
  { name: "Cookie Clicker", url: "https://orteil.dashnet.org/cookieclicker/", cat: "games", tag: "idle" },

  /* ---- social ---- */
  { name: "X / Twitter", url: "https://x.com/", cat: "social", direct: true },
  { name: "Reddit", url: "https://www.reddit.com/", cat: "social", direct: true },
  { name: "Instagram", url: "https://www.instagram.com/", cat: "social", direct: true },
  { name: "Facebook", url: "https://www.facebook.com/", cat: "social", direct: true },
  { name: "Discord", url: "https://discord.com/app", cat: "social", direct: true },
  { name: "Bluesky", url: "https://bsky.app/", cat: "social", direct: true },
  { name: "Mastodon", url: "https://mastodon.social/", cat: "social", direct: true },

  /* ---- video ---- */
  { name: "YouTube", url: "https://www.youtube.com/", cat: "video", direct: true },
  { name: "Twitch", url: "https://www.twitch.tv/", cat: "video", direct: true },
  { name: "Netflix", url: "https://www.netflix.com/", cat: "video", direct: true },
  { name: "Vimeo", url: "https://vimeo.com/", cat: "video", direct: true },
  { name: "Vimeo Player", url: "https://player.vimeo.com/video/76979871", cat: "video", tag: "embed" },

  /* ---- music ---- */
  { name: "Spotify", url: "https://open.spotify.com/", cat: "music", direct: true },
  { name: "Bandcamp", url: "https://bandcamp.com/", cat: "music", direct: true },
  { name: "SoundCloud", url: "https://soundcloud.com/", cat: "music", direct: true },
  { name: "Radio Garden", url: "https://radio.garden/", cat: "music", tag: "globe", direct: true },
];
