/* Shared primitives: URL handling, cloak presets, formatters, quick access. */

export const GHOST_FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#0C1016'/><path d='M32 13c-8.9 0-15.2 7-15.2 16.8V51l6.1-4.6 5.1 4.6 4-3.6 4 3.6 5.1-4.6L47.2 51V29.8C47.2 20 40.9 13 32 13z' fill='#45E0A8'/><circle cx='26.2' cy='30' r='2.7' fill='#0C1016'/><circle cx='37.8' cy='30' r='2.7' fill='#0C1016'/></svg>"
  );

export const APP_TITLE = "Wraith — Stealth Proxy Browser";

export interface CloakPreset {
  id: string;
  name: string;
  title: string;
  icon: string;
}

const s2 = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

export const CLOAK_PRESETS: CloakPreset[] = [
  { id: "none", name: "Off — real identity", title: APP_TITLE, icon: GHOST_FAVICON },
  {
    id: "drive",
    name: "Google Drive",
    title: "My Drive - Google Drive",
    icon: "https://ssl.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png",
  },
  {
    id: "canvas",
    name: "Canvas LMS",
    title: "Dashboard",
    icon: s2("canvaslms.com"),
  },
  {
    id: "gdocs",
    name: "Google Docs",
    title: "Untitled document - Google Docs",
    icon: "https://ssl.gstatic.com/images/branding/product/2x/docs_2020q4_48dp.png",
  },
  {
    id: "gmail",
    name: "Gmail",
    title: "Inbox - Gmail",
    icon: "https://ssl.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png",
  },
  {
    id: "clever",
    name: "Clever Portal",
    title: "Clever | Portal",
    icon: s2("clever.com"),
  },
  {
    id: "schoology",
    name: "Schoology",
    title: "Home | Schoology",
    icon: s2("schoology.com"),
  },
  {
    id: "custom",
    name: "Custom…",
    title: "",
    icon: "",
  },
];

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "";
  }
}

export function faviconFor(host: string): string {
  if (!host) return GHOST_FAVICON;
  return `https://icons.duckduckgo.com/ip3/${host}.ico`;
}

/** Turn omnibox input into a navigable URL (direct host or proxied search). */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^(about|wraith):/i.test(raw)) return raw.toLowerCase();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  const looksLikeHost =
    /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(raw) && !raw.includes(" ");
  if (looksLikeHost) return "https://" + raw;
  return "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(raw);
}

export function fmtBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const LS = {
  settings: "wraith.settings.v1",
  jar: "wraith.jar.v1",
  exts: "wraith.exts.v1",
  downloads: "wraith.downloads.v1",
  blocked: "wraith.blocked.v1",
};

export interface QuickTile {
  name: string;
  url: string;
  note: string;
}

/** Frame-permissive destinations used by the quick-access deck. */
export const QUICK_TILES: QuickTile[] = [
  { name: "Wikipedia", url: "https://en.m.wikipedia.org/wiki/Main_Page", note: "enc" },
  { name: "DuckDuckGo Lite", url: "https://lite.duckduckgo.com/lite/", note: "srch" },
  { name: "OpenStreetMap", url: "https://www.openstreetmap.org/export/embed.html?bbox=-0.15,51.49,-0.09,51.52", note: "map" },
  { name: "wttr.in", url: "https://wttr.in/?F", note: "wx" },
  { name: "NPR Text", url: "https://text.npr.org/", note: "news" },
  { name: "info.cern.ch", url: "http://info.cern.ch/", note: "1991" },
  { name: "httpbin", url: "https://httpbin.org/", note: "api" },
  { name: "Example", url: "https://example.com/", note: "rfc" },
];

export const WRAITH_CORE_LIST = `! wraith-core — bundled interception rules (ABP syntax)
[Adblock Plus 3.1]
||doubleclick.net^
||googlesyndication.com^
||google-analytics.com^$third-party
||googletagmanager.com^$third-party
||googletagservices.com^
||adservice.google.*/
||amazon-adsystem.com^
||facebook.net/tr$third-party
||facebook.com/tr/?$image
||graph.facebook.com^$third-party
||analytics.tiktok.com^
||ads.tiktok.com^
||hotjar.com^$third-party
||clarity.ms^$third-party
||criteo.com^
||outbrain.com^
||taboola.com^
||moatads.com^
||scorecardresearch.com^
||chartbeat.com^
||mixpanel.com^$third-party
||segment.com^$third-party
||sentry-cdn.com^$third-party
||adnxs.com^
||rubiconproject.com^
||pubmatic.com^
||openx.net^
||casalemedia.com^
||smartadserver.com^
||zedo.com^
||exponential.com^
||quantserve.com^
||krxd.net^
||bluekai.com^
||demdex.net^
||omtrdc.net^
@@||wikipedia.org^$document
@@||wikimedia.org^
! cosmetic
##.ad-slot
##.adsbygoogle
###ad-container
##.sponsored-content
##[id^="div-gpt-ad"]
##.trc_related_container
###taboola-below-article
##.OUTBRAIN
##.ad-banner
`;

export const EASYLIST_EXCERPT = `! EasyList — bundled excerpt (easylist.to)
[Adblock Plus 2.0]
||0emn.com^
||0fmm.com^
||ad-brix.com^
||ad-stir.com^
||ad4game.com^
||adadvisor.net^
||adblade.com^
||adbrn.com^
||adcolony.com^
||addthis.com^$third-party
||adform.net^
||adglare.net^
||adhigh.net^
||adition.com^
||adkernel.com^
||admanmedia.com^
||admatic.com.tr^
||admedo.com^
||admicro.vn^
||admob.com^
||adnium.com^
||adotmob.com^
||adroll.com^
||adriver.ru^
||ads-twitter.com^
||adsafeprotected.com^
||adscale.de^
||adserver.org^
||adskeeper.co.uk^
||adsrvr.org^
||adtech.de^
||adtechus.com^
||adthrive.com^
||adtng.com^
||adultadvertising.com^
||advombat.ru^
||adwhirl.com^
||adzerk.net^
||affec.tv^
||affiliatewindow.com^
||afy11.net^
||agkn.com^
||ampxchange.com^
##.ad-wrapper
##.advert-label
##.top-ad-container
###advert-banner
`;
