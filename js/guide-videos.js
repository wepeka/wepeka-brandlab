// Short explainer videos, one per app (Beranda, Brand, Tujuan, Konten,
// Tulisan Cepat, Pelacak Penjualan) plus the "kenalan" intro. Every one of them
// works the same way, on purpose:
//   - Click the "Video" pill next to a page's "?" to open it, any time.
//   - It can be skipped at any moment ("Lewati video").
//   - When it ends (or is skipped) the same modal asks what's next, in three
//     answers: play it again, take the live tour of this page instead, or
//     "sudah paham".
// What plays by itself, each once per account:
//   - the "kenalan" video on a brand-new account's very first open
//     (js/main.js playFirstRunIntro, right after the welcome bumper);
//   - the videos that stand in front of something (playVideoGate: the
//     welcome video before the mode picker, the chat's before its first open);
//   - for a new account, each page's own video the first time that page is
//     opened, in Pemula and Pro alike (offerPageVideo, called by js/main.js
//     once a page has painted).
// All of them can be skipped and end on the same three answers — "Sudah
// paham", "Putar ulang video", "Tur website". After that the page's Panduan
// button (guideVideoButtonHTML) is the way back to its video.
//
// One video per app, many pages per app: a page inside an app (say the
// Kalender tab of Content OS) opens the app's video *at that page's chapter*
// (`start`, in seconds), so nobody sits through the Creator part to reach
// the Kalender part. Chapter times live in GUIDE_TO_VIDEO below and are
// updated once the recording exists (see .claude/brief-video-panduan.md).
//
// Three states per entry, set by its `src`:
//   ""               → silent. Nothing opens, nothing is marked as seen, so
//                      the entry still gets its one showing later.
//   PLACEHOLDER_SRC  → the whole flow runs, but the player area shows the
//                      "video lagi disiapkan" panel instead of a video. This
//                      is what every entry carries right now, so the flow can
//                      be used and tested before the recordings exist.
//   a real URL       → same flow, with the actual player. Publishing a video
//                      is just swapping that one entry's src for an
//                      .mp4/.webm URL or a YouTube/Vimeo link.
//
// Parts: one entry can be several videos ("Brand Builder" → 1. Brand DNA,
// 2. Brand Book), each with its own title, set in the wpk-dp admin. The
// player lists them, plays them in order (next one starts when the last
// ends) and lets you jump or press Berikutnya. Every frame carries the
// Wepeka Brandlab mark top-right (on a white chip) and the part's title
// top-left — an overlay, so it applies to any video put in the admin.
//
// Bumper: the same short Wepeka Brandlab ident opens and closes every guide
// video — once before the first part that plays, once after the last. It
// belongs to the player (assets/video/brandlab-bumper-*.mp4), not to the
// uploads, so every video in the admin gets it without being re-uploaded,
// and it carries a "Lewati intro" button.
import { icon } from "./icons.js";
import { escapeHtml, toast, showCalloutBubble, openMenu, closeMenu } from "./dom.js";
import { helpEntry } from "./help.js";
import { openModal, closeOverlay } from "./modals.js";
import { getSettings, updateSettings } from "./store.js";
import { getCachedAccount, isReadOnly, isAdmin, currentUid } from "./account.js";
import { getPageGuide } from "./section-guide.js";
import { readFlag, writeFlag, clearFlag } from "./seen-flags.js";
import { t } from "./i18n.js";

// A stand-in for "there will be a video here". Everything downstream treats
// it as a real src — the video is offered / is replayable — and only the
// player itself knows to draw the pending panel instead.
export const PLACEHOLDER_SRC = "placeholder";
const isPlaceholder = (src) => src === PLACEHOLDER_SRC;
// Only a video that has actually been published counts. Until then its
// Video button stays hidden and nothing autoplays — no user ever lands on
// a "video lagi disiapkan" panel.
const isLive = (key) => {
  const src = GUIDE_VIDEOS[key]?.src;
  return !!src && !isPlaceholder(src);
};
// The Wepeka admin account also sees the ones not uploaded yet (as the
// "video lagi disiapkan" panel), to check where each video will appear and
// walk the whole flow before the recordings are in.
const adminPreview = () => isAdmin(currentUid());
export const canShowVideo = (key) => !!GUIDE_VIDEOS[key] && (isLive(key) || adminPreview());

// `seconds` is the declared length. For Vimeo it is also "the video has
// ended" (an iframe can't be watched from here), and for YouTube until its
// IFrame API answers — so keep it equal to the real recording's length.
export const GUIDE_VIDEOS = {
  // Plays once, right after the account exists and before the Pemula/Pro
  // picker (js/main.js → playVideoGate).
  "akun-baru": { title: t("guide.video.akunBaru"), duration: t("guide.video.sec", { n: 60 }), seconds: 60, src: PLACEHOLDER_SRC },
  kenalan: { title: t("guide.video.kenalan"), duration: t("guide.video.sec", { n: 90 }), seconds: 90, src: PLACEHOLDER_SRC },
  // Beranda, plus the small things around it (mode, the ⋯ menu, Settings).
  beranda: { title: t("guide.video.beranda"), duration: t("guide.video.min", { n: 2 }), seconds: 120, src: PLACEHOLDER_SRC },
  // Plays once, the first time the round AI button (Tanya Brandlab) is
  // pressed, before the chat opens (js/consultant-panel.js).
  "tanya-brandlab": { title: t("guide.video.tanya"), duration: t("guide.video.sec", { n: 60 }), seconds: 60, src: PLACEHOLDER_SRC },
  "brand-builder": { title: t("guide.video.brandBuilder"), duration: t("guide.video.min", { n: 2.5 }), seconds: 150, src: PLACEHOLDER_SRC },
  campaign: { title: t("guide.video.campaign"), duration: t("guide.video.min", { n: 2 }), seconds: 120, src: PLACEHOLDER_SRC },
  "content-os": { title: t("guide.video.contentOs"), duration: t("guide.video.min", { n: 3 }), seconds: 180, src: PLACEHOLDER_SRC },
  copy: { title: t("guide.video.copy"), duration: t("guide.video.sec", { n: 60 }), seconds: 60, src: PLACEHOLDER_SRC },
  sales: { title: t("guide.video.sales"), duration: t("guide.video.sec", { n: 60 }), seconds: 60, src: PLACEHOLDER_SRC },
};

// Published videos come from wpk-dp's admin (Brandlab > Video Panduan),
// which writes Firestore meta/guideVideos; /api/guide-videos serves it. Each
// entry there replaces that key's PLACEHOLDER_SRC (and its length), so a
// video goes live without a deploy. Fetched once per page load; anything
// failing (offline, local serve.py without /api) just leaves the
// placeholders in place.
function durationLabel(sec) {
  return sec < 120 ? t("guide.video.sec", { n: sec }) : t("guide.video.min", { n: Math.round(sec / 30) / 2 });
}
// An admin entry → its parts, in order. Older entries (one src, no parts)
// are a single part titled after the video itself; a part left untitled in
// the admin is just "Video 2".
export function partsFromAdmin(entry, fallbackTitle = "") {
  const raw = Array.isArray(entry?.parts) ? entry.parts : [];
  const parts = raw
    .filter((p) => typeof p?.src === "string" && p.src.trim())
    .map((p) => ({ title: String(p.title || "").trim(), src: p.src.trim(), seconds: Math.max(0, Math.round(Number(p.seconds) || 0)) }))
    .map((p, i, list) => ({ ...p, title: p.title || (list.length > 1 ? t("guide.video.partN", { n: i + 1 }) : fallbackTitle), untitled: !p.title && list.length > 1 }));
  if (!parts.length && typeof entry?.src === "string" && entry.src.trim()) {
    parts.push({ title: fallbackTitle, src: entry.src.trim(), seconds: Math.max(0, Math.round(Number(entry.seconds) || 0)) });
  }
  return parts;
}

// What plays for an entry: its admin parts, else the entry itself as one.
export function videoParts(videoKey) {
  const v = GUIDE_VIDEOS[videoKey];
  if (!v) return [];
  return v.parts?.length ? v.parts : [{ title: v.title, src: v.src, seconds: v.seconds }];
}

export const guideVideosReady = (typeof fetch === "function" ? fetch("/api/guide-videos") : Promise.reject())
  .then((r) => (r.ok ? r.json() : {}))
  .then(({ videos } = {}) => {
    for (const [key, o] of Object.entries(videos || {})) {
      const v = GUIDE_VIDEOS[key];
      const parts = v ? partsFromAdmin(o, v.title) : [];
      if (!parts.length) continue;
      v.parts = parts;
      v.src = parts[0].src;
      const total = parts.reduce((sum, p) => sum + p.seconds, 0);
      if (total > 0) {
        v.seconds = total;
        v.duration = durationLabel(total);
      }
    }
    // Buttons painted before the list arrived render hidden; show the ones
    // whose video turned out to be live.
    if (typeof document !== "undefined") {
      document.querySelectorAll("[data-guide-video-btn][hidden]").forEach((btn) => {
        const ref = videoRefForGuide(btn.dataset.guideVideoBtn);
        if (ref && canShowVideo(ref.video)) btn.hidden = false;
      });
    }
  })
  .catch(() => {});
// Wait for the fetch above, but never hold a video back for long on a slow line.
const whenReady = (ms = 2500) => Promise.race([guideVideosReady, new Promise((r) => setTimeout(r, ms))]);

// Guide/Panduan key → which video, and where in it this page's chapter
// starts. A bare string means "from the top". Content OS shares one Panduan
// button across its sub-tabs, so it resolves from the current route.
// Chapter `start` values are estimates from the brief — set them to the real
// timestamps after each video is recorded. When the video is uploaded as
// parts instead, `part` picks the part whose admin title matches (so the
// Brand Book page opens on "Video 2 - Brand Book"); no match = part 1.
const GUIDE_TO_VIDEO = {
  onboarding: "kenalan",
  // Beranda has its own video; until it is published the page keeps
  // offering the intro (`fallback`), so its Video row never goes missing.
  home: { video: "beranda", part: /beranda|home/i, fallback: "kenalan" },
  settings: { video: "beranda", part: /mode|menu|pengaturan|setting/i },
  tools: "kenalan",
  "brand-builder": "brand-builder",
  "brand-builder-hub": "brand-builder",
  "brand-dna": { video: "brand-builder", part: /dna/i },
  "brand-guidelines": { video: "brand-builder", start: 80, part: /brand ?book|guideline|logo|warna|font/i },
  campaigns: "campaign",
  "campaign-list": "campaign",
  // The goal page's part is titled "Halaman tujuan: …" in the scripts and
  // plain "Tujuan" in the admin — both open it; "Tujuan: Grow Brand" (the
  // list's part) does not.
  "campaign-detail": { video: "campaign", start: 30, part: /detail|level|misi|mission|halaman tujuan|^tujuan$/i },
  event: { video: "campaign", part: /event|acara|tanggal/i },
  brainstorm: { video: "campaign", start: 95, part: /brainstorm|chat|ide|halaman tujuan|^tujuan$/i },
  creator: { video: "content-os", part: /creator|tulis|bikin|buat/i },
  calendar: { video: "content-os", start: 80, part: /kalender|calendar|jadwal/i },
  "konten-dashboard": { video: "content-os", start: 135, part: /daftar|draft|dashboard|hasil|insight|result/i },
  series: { video: "content-os", part: /\bseri|series/i },
  "copy-studio": "copy",
  sales: "sales",
  chat: "tanya-brandlab",
};

// → { video, start } for a page, or null when the page has no video.
export function videoRefForGuide(guideKey) {
  let key = guideKey;
  if (guideKey === "content-os" || guideKey === "content-list") {
    const hash = typeof location !== "undefined" ? location.hash : "";
    key = /\/content\/creator/.test(hash) ? "creator" : /\/content\/calendar/.test(hash) ? "calendar" : /\/content\/series/.test(hash) ? "series" : "konten-dashboard";
  }
  const ref = GUIDE_TO_VIDEO[key];
  if (!ref) return null;
  const out = typeof ref === "string" ? { video: ref, start: 0, part: null } : { video: ref.video, start: Number(ref.start) || 0, part: ref.part || null };
  if (ref.fallback && !canShowVideo(out.video) && canShowVideo(ref.fallback)) return { video: ref.fallback, start: 0, part: null };
  return GUIDE_VIDEOS[out.video] ? out : null;
}

// Where a page's video opens: with parts, the part matching the page (from
// its start); with one video, that page's chapter second.
function openingPoint(ref) {
  const parts = videoParts(ref.video);
  if (parts.length > 1) {
    const i = ref.part ? parts.findIndex((p) => ref.part.test(p.title)) : -1;
    return { part: Math.max(0, i), start: 0 };
  }
  // A single part made for another page (only "Brand DNA" is up, opened
  // from Brand Book) plays from its top: the chapter second is not its own.
  return { part: 0, start: ownPoint(ref)?.start || 0 };
}

// The same, but only where the video is really about this page — what a page
// may play by itself (pageVideoDue): the part its pattern names, or its
// chapter in the one recording made for the whole app (an entry with no
// parts named in the admin). null while this page's own part is not up.
function ownPoint(ref) {
  const parts = videoParts(ref.video);
  const wholeApp = parts.length === 1 && parts[0].title === GUIDE_VIDEOS[ref.video].title;
  if (wholeApp || !ref.part) return { part: 0, start: parts.length > 1 ? 0 : ref.start };
  const i = parts.findIndex((p) => ref.part.test(p.title));
  return i >= 0 ? { part: i, start: 0 } : null;
}

// Just the video key (kept for callers that only care which video).
export function videoKeyForGuide(guideKey) {
  return videoRefForGuide(guideKey)?.video || null;
}

// Every way a YouTube link gets copied: watch?v= (v anywhere in the query,
// e.g. after si= or feature=), youtu.be/, Shorts, Live, embed, the
// no-cookie domain, m./music. hosts, a YouTube Studio page. A YouTube ID is
// always 11 characters.
const YOUTUBE_RE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/|video\/)|youtu\.be\/)([\w-]{11})(?![\w-])/i;

// "…/watch?v=ID" | "…/ID" | "https://cdn/x.mp4" → what kind of player to build.
export function parseVideoSrc(src) {
  const s = String(src || "").trim();
  if (!s) return { kind: "none", id: "" };
  const yt = s.match(YOUTUBE_RE);
  if (yt) return { kind: "youtube", id: yt[1] };
  const vimeo = s.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { kind: "vimeo", id: vimeo[1] };
  return { kind: "file", id: "" };
}

// fs=0 / no native fullscreen: the player's own fullscreen button enlarges
// the whole frame, so the watermark stays on screen. enablejsapi + origin
// let the YouTube IFrame API (see watchYouTubeEnd) hear when it ends.
export function embedUrl(src, start = 0, autoplay = false) {
  const p = parseVideoSrc(src);
  const at = Math.max(0, Math.floor(Number(start) || 0));
  const origin = typeof location !== "undefined" && /^https?:/.test(location.origin) ? `&origin=${encodeURIComponent(location.origin)}` : "";
  if (p.kind === "youtube") return `https://www.youtube.com/embed/${p.id}?rel=0&playsinline=1&fs=0&modestbranding=1&enablejsapi=1${origin}${autoplay ? "&autoplay=1" : ""}${at ? `&start=${at}` : ""}`;
  if (p.kind === "vimeo") return `https://player.vimeo.com/video/${p.id}${autoplay ? "?autoplay=1" : ""}${at ? `#t=${at}s` : ""}`;
  return null;
}

// A plain media file starts at `start` via a media fragment (#t=), which
// every browser's <video> honours without any script.
function fileUrl(src, start = 0) {
  const at = Math.max(0, Math.floor(Number(start) || 0));
  return at ? `${src}#t=${at}` : src;
}

// The official YouTube IFrame API, fetched the first time a YouTube part
// plays. A failed load is forgotten so the next part can try again.
let youTubeApi = null;
function loadYouTubeApi() {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.reject(new Error("no browser"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youTubeApi) return youTubeApi;
  youTubeApi = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") prev();
      resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      youTubeApi = null;
      s.remove();
      reject(new Error("YouTube IFrame API failed to load"));
    };
    document.head.appendChild(s);
  });
  return youTubeApi;
}

// Hooks the YouTube API onto a player already on the page: `onReady` once
// it answers (from then on its own end event is trusted), `onEnded` when the
// video really finishes — a pause, a buffer or a blocked autoplay no longer
// count as watched. `isCurrent` drops a player that has since been replaced.
function watchYouTubeEnd(frame, { isCurrent, onReady, onEnded }) {
  loadYouTubeApi()
    .then((YT) => {
      if (!isCurrent() || !frame.isConnected) return;
      new YT.Player(frame, {
        events: {
          onReady: () => { if (isCurrent()) onReady(); },
          onStateChange: (e) => { if (isCurrent() && e.data === YT.PlayerState.ENDED) onEnded(); },
        },
      });
    })
    .catch(() => {});
}

// The watermark every guide video carries: the part's title top-left and
// the Wepeka Brandlab mark on a small white chip top-right. The title is set
// in a thin face (Inter 300, like a streaming player's episode title); the
// app bundles no light weight, so it's fetched the first time a player opens.
function ensureWatermarkFont() {
  if (typeof document === "undefined" || document.getElementById("gv-wm-font")) return;
  const link = document.createElement("link");
  link.id = "gv-wm-font";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@300&display=swap";
  document.head.appendChild(link);
}
function watermarkHTML(subtitle) {
  ensureWatermarkFont();
  return `
    <div class="gv-wm" aria-hidden="true">
      ${subtitle ? `<span class="gv-wm-title">${escapeHtml(subtitle)}</span>` : "<span></span>"}
      <span class="gv-wm-logo"><img src="assets/wepeka-logo-dark.png" alt="" /><i></i><b>Brandlab</b></span>
    </div>`;
}

// The ident that opens ("in") and closes ("out") every guide video, in the
// same frame the video plays in. No watermark and no controls — it is the
// brand moment itself — just the Lewati button, bottom-right over the
// picture. The closing one ends on the logo, which stays on screen behind
// the three answers.
const BUMPER_SRC = { in: "assets/video/brandlab-bumper-in.mp4", out: "assets/video/brandlab-bumper-out.mp4" };
export function bumperHTML(kind) {
  const src = BUMPER_SRC[kind];
  if (!src) return "";
  const label = t(kind === "in" ? "guide.video.skipIntro" : "guide.video.skipOutro");
  return `<div class="guide-video-frame is-bumper"><video src="${src}" playsinline preload="auto" disablepictureinpicture></video><button type="button" class="gv-skip" data-vc="skip-bumper">${label}${icon("chevronRight", { size: 13 })}</button></div>`;
}

// `autoplay`: the modal plays the video as soon as it opens — someone who
// pressed Video (or a new account's intro) came to watch, not to press play
// a second time. Browsers allow it after a click on the page; where one
// still blocks it, the player's own play button is right there.
// `part`: which of the entry's parts (see videoParts) to show.
export function guideVideoWidgetHTML(videoKey, { compact = false, start = 0, autoplay = false, part = 0 } = {}) {
  const v = GUIDE_VIDEOS[videoKey];
  if (!v) return "";
  const parts = videoParts(videoKey);
  const p = parts[Math.min(Math.max(0, part), parts.length - 1)] || { title: v.title, src: v.src };
  const size = compact ? " is-compact" : "";
  const subtitle = parts.length > 1 && !p.untitled ? t("guide.video.partLabel", { n: parts.indexOf(p) + 1, title: p.title }) : p.title || v.title;
  if (!p.src || isPlaceholder(p.src)) {
    return `
      <div class="guide-video-frame is-placeholder${size}" role="img" aria-label="${t("guide.video.pendingAria", { title: escapeHtml(v.title) })}">
        <div class="guide-video-play is-pending" aria-hidden="true">${icon("clock", { size: compact ? 16 : 22 })}</div>
        <div class="guide-video-ph-text"><b>${t("guide.video.pending")}</b><span>${escapeHtml(v.title)} · ${escapeHtml(v.duration)}</span>${adminPreview() ? `<small>${t("guide.video.adminPending")}</small>` : ""}</div>
        ${watermarkHTML(subtitle)}
      </div>`;
  }
  const embed = embedUrl(p.src, start, autoplay);
  if (embed) {
    const yt = parseVideoSrc(p.src).kind === "youtube" ? " data-yt" : "";
    return `<div class="guide-video-frame has-wm${size}"><iframe${yt} src="${escapeHtml(embed)}" title="${escapeHtml(p.title || v.title)}" allow="autoplay; encrypted-media"></iframe>${watermarkHTML(subtitle)}</div>`;
  }
  return `<div class="guide-video-frame has-wm${size}"><video src="${escapeHtml(fileUrl(p.src, start))}" controls controlslist="nofullscreen nodownload" disablepictureinpicture playsinline preload="metadata"${autoplay ? " autoplay" : ""}></video>${watermarkHTML(subtitle)}</div>`;
}

const fmtTime = (sec) => {
  const n = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};

// The parts as a list under the player: number, title, length; the one
// playing is marked. Only drawn when there's more than one.
function partListHTML(parts, current) {
  if (parts.length < 2) return "";
  return `
    <ol class="gv-parts" aria-label="${t("guide.video.partsAria")}">
      ${parts
        .map(
          (p, i) => `
        <li>
          <button type="button" class="gv-part ${i === current ? "is-current" : ""}" data-gv-part="${i}" ${i === current ? 'aria-current="true"' : ""}>
            <span class="gv-part-num">${i === current ? icon("play", { size: 11 }) : i + 1}</span>
            <span class="gv-part-title">${escapeHtml(p.title)}</span>
            ${p.seconds ? `<span class="gv-part-time">${fmtTime(p.seconds)}</span>` : ""}
          </button>
        </li>`
        )
        .join("")}
    </ol>`;
}

// The player, as a modal, in two states: watching (the video plus a Lewati
// button) and, once it ends or is skipped, the three answers. `onTour` is
// what "masih mau tur website" runs; by default it presses this page's own
// Panduan button, which is exactly what the closing bubble will point at.
// `start` (seconds) opens the video at that page's chapter; the replay
// button starts from the top, so the whole app video is one click away.
// The three answers — Ulangi video, Tur website (or this page's guide),
// Sudah paham — sit under the player the whole time, not only once it ends.
// `onClose(choice)`: the video stands in front of something (the mode
// picker, the chat); it's told how the modal closed ("tour" or "done" — the
// X counts as done) and takes over from there instead of the usual hint.
// `onDone`: runs, after the usual hint, when it closed without the tour.
export function openGuideVideo(videoKey, { onTour = startPageTour, tourLabel = null, hint = true, start = 0, part = 0, onClose = null, onDone = null } = {}) {
  const v = GUIDE_VIDEOS[videoKey];
  if (!v) return null;
  const real = !!v.src && !isPlaceholder(v.src);
  if (!real && !adminPreview()) return null;
  const parts = videoParts(videoKey);
  const multi = parts.length > 1;
  let current = Math.min(Math.max(0, Number(part) || 0), parts.length - 1);
  // "Tur website" for the intro; on a page, that page's own guide when it
  // has one (it is what the choice runs).
  const tourText = tourLabel || (onTour === startPageTour && getPageGuide() ? t("guide.video.choices.pageGuide") : t("guide.video.choices.tour"));
  // A chapter start past the end of the actual video (chapter times are set
  // for the final recordings; a shorter clip may be up) plays from the top.
  const partSeconds = () => Number(parts[current]?.seconds) || (multi ? 0 : Number(v.seconds) || 0);
  if (partSeconds() > 0 && start >= partSeconds() - 3) start = 0;
  const overlay = openModal({
    title: v.title,
    wide: true,
    bodyHTML: `
      <div class="gv-stage-wrap" data-video-frame-host>
        <div data-video-stage>${real ? "" : guideVideoWidgetHTML(videoKey, { start, autoplay: true, part: current })}</div>
      </div>
      <div class="gv-bar">
        ${multi ? `<button type="button" class="btn btn-ghost btn-sm" data-vc="prev">${icon("chevronLeft", { size: 13 })}${t("guide.video.prev")}</button>` : ""}
        <span class="gv-bar-status" data-gv-status></span>
        ${multi ? `<button type="button" class="btn btn-secondary btn-sm" data-vc="next">${t("guide.video.next")}${icon("chevronRight", { size: 13 })}</button>` : ""}
        ${real && typeof document !== "undefined" && document.fullscreenEnabled ? `<button type="button" class="icon-btn" data-vc="fullscreen" title="${t("guide.video.fullscreen")}" aria-label="${t("guide.video.fullscreen")}">${icon("expand", { size: 14 })}</button>` : ""}
      </div>
      <div data-gv-list>${partListHTML(parts, current)}</div>
      <p class="guide-video-note">${real ? t("guide.video.duration", { duration: escapeHtml(v.duration) }) : t("guide.video.pendingNote", { duration: escapeHtml(v.duration) })}</p>
      <div class="guide-video-choices" data-video-choices>
        <p class="guide-video-choices-head" data-video-choices-head hidden>${t("guide.video.choices.head")}</p>
        <div class="guide-video-choice-row">
          ${real ? `<button type="button" class="btn btn-ghost btn-sm" data-vc="replay">${icon("play", { size: 13 })}${t("guide.video.choices.replay")}</button>` : ""}
          <button type="button" class="btn btn-ghost btn-sm" data-vc="tour">${icon("target", { size: 13 })}${escapeHtml(tourText)}</button>
          <button type="button" class="btn btn-primary btn-sm" data-vc="done">${t("guide.video.choices.done")}</button>
        </div>
      </div>
    `,
  });
  overlay.setAttribute("data-guide-video-modal", videoKey);

  const choicesHead = overlay.querySelector("[data-video-choices-head]");
  const stage = overlay.querySelector("[data-video-stage]");
  const frameHost = overlay.querySelector("[data-video-frame-host]");
  const listHost = overlay.querySelector("[data-gv-list]");
  const status = overlay.querySelector("[data-gv-status]");
  const prevBtn = overlay.querySelector('[data-vc="prev"]');
  const nextBtn = overlay.querySelector('[data-vc="next"]');
  let ending = null;
  // Bumped every time a part starts, so a YouTube player that was replaced
  // (or a modal that closed) can't end the part playing now.
  let playId = 0;
  let tourTaken = false;
  let choice = "done";

  const paintBar = () => {
    if (status) status.textContent = multi ? t("guide.video.partOf", { n: current + 1, total: parts.length }) : "";
    if (prevBtn) prevBtn.disabled = current === 0;
    if (nextBtn) nextBtn.disabled = current >= parts.length - 1;
    listHost.innerHTML = partListHTML(parts, current);
  };
  // The end of the last part: the buttons were there all along; now the
  // question above them shows too.
  const showChoices = () => {
    if (ending) { clearTimeout(ending); ending = null; }
    choicesHead.hidden = false;
  };
  // A part ending: the next one starts by itself; after the last, the
  // closing bumper and then the three answers.
  const partEnded = () => {
    // Watched to the end, however it was opened: never played by itself again.
    markPartSeen(videoKey, current);
    if (current < parts.length - 1) playPart(current + 1);
    else playBumper("out", showChoices);
  };
  // The Wepeka Brandlab bumper, in the frame the video plays in. It always
  // hands over to `then`: when it ends, on Lewati, on an error, or when the
  // file is slow to start (nobody waits on a bumper) — but never once
  // something else started playing in its place, or the modal has closed.
  let endBumper = null;
  function playBumper(kind, then) {
    if (!overlay.isConnected) return;
    if (ending) { clearTimeout(ending); ending = null; }
    const id = ++playId;
    choicesHead.hidden = true;
    stage.innerHTML = bumperHTML(kind);
    const el = stage.querySelector("video");
    const skipBtn = stage.querySelector(".gv-skip");
    let started = false;
    let guard = setTimeout(() => { if (!started) finish(); }, 2500);
    const finish = () => {
      clearTimeout(guard);
      if (id !== playId || !endBumper || !overlay.isConnected) return;
      endBumper = null;
      skipBtn.remove();
      then();
    };
    // Lewati: the closing bumper still lands on its last frame, the logo.
    endBumper = () => {
      el.pause?.();
      if (kind === "out" && el.duration) el.currentTime = el.duration;
      finish();
    };
    el.addEventListener("playing", () => { started = true; clearTimeout(guard); guard = setTimeout(finish, 6000); }, { once: true });
    el.addEventListener("ended", finish, { once: true });
    el.addEventListener("error", finish, { once: true });
    // With its sound where the browser allows it (the player opens on a
    // click), silent where it doesn't.
    el.play?.()?.catch?.(() => { el.muted = true; el.play().catch(finish); });
  }
  // A real video announces its own end, and so does YouTube through its
  // IFrame API. Vimeo — or YouTube before its API answers, or if it never
  // loads — falls back to the declared length. The placeholder has nothing
  // to play at all, so it asks straight away.
  const watchForEnd = () => {
    if (ending) { clearTimeout(ending); ending = null; }
    const id = ++playId;
    choicesHead.hidden = true;
    if (!real) return showChoices();
    const el = stage.querySelector("video");
    if (el) {
      // Same guard for a file whose real length is shorter than declared.
      el.addEventListener("loadedmetadata", () => {
        if (el.duration && el.currentTime >= el.duration - 1) el.currentTime = 0;
      }, { once: true });
      el.addEventListener("ended", partEnded, { once: true });
      return;
    }
    ending = setTimeout(partEnded, Math.max(5, (partSeconds() || 60) - (Number(start) || 0)) * 1000);
    const yt = stage.querySelector("iframe[data-yt]");
    if (yt) {
      watchYouTubeEnd(yt, {
        isCurrent: () => id === playId && overlay.isConnected,
        onReady: () => { if (ending) { clearTimeout(ending); ending = null; } },
        onEnded: partEnded,
      });
    }
  };
  function playPart(i, { from = 0 } = {}) {
    endBumper = null;
    current = Math.min(Math.max(0, i), parts.length - 1);
    start = from;
    stage.innerHTML = guideVideoWidgetHTML(videoKey, { autoplay: true, part: current, start });
    stage.querySelector("video")?.play?.().catch(() => {});
    paintBar();
    watchForEnd();
  }

  overlay.addEventListener("click", (e) => {
    const partBtn = e.target instanceof Element ? e.target.closest("[data-gv-part]") : null;
    if (partBtn) return playPart(Number(partBtn.dataset.gvPart));
    const btn = e.target instanceof Element ? e.target.closest("[data-vc]") : null;
    if (!btn) return;
    const what = btn.dataset.vc;
    if (what === "skip-bumper") return endBumper?.();
    if (what === "prev") return playPart(current - 1);
    if (what === "next") return playPart(current + 1);
    if (what === "fullscreen") {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      else frameHost.requestFullscreen?.().catch(() => {});
      return;
    }
    if (what === "replay") return playPart(0);
    tourTaken = what === "tour";
    choice = tourTaken ? "tour" : "done";
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    closeOverlay(overlay);
    if (tourTaken && !onClose) onTour?.();
  });

  // However it closes — a choice, the X, Escape, a click outside — the same
  // sentence is what's left on screen. After the tour it waits for the tour
  // to finish, so the bubble never fights the spotlight for attention.
  if (hint || onClose || onDone) {
    const obs = new MutationObserver(() => {
      if (overlay.isConnected) return;
      obs.disconnect();
      if (ending) clearTimeout(ending);
      if (onClose) return onClose(choice);
      if (tourTaken) return hint ? hintAfterTour() : undefined;
      if (hint) replayHint();
      onDone?.();
    });
    obs.observe(document.body, { childList: true });
  }
  paintBar();
  // A real video opens on the bumper, then plays from this page's chapter.
  if (real) playBumper("in", () => playPart(current, { from: start }));
  else watchForEnd();
  return overlay;
}

// The tour a page's video (and its Panduan button) leads to: the page's own
// guide (js/section-guide.js setPageGuide) when it registered one, else the
// website tour.
export function startPageTour() {
  const guide = getPageGuide();
  if (guide) guide();
  else startWebsiteTour();
}
const startWebsiteTour = () => import("./tour.js").then((m) => m.startOnboardingTour()).catch((e) => console.warn("tur tidak bisa dibuka", e));

// Every guide video in one list, for the topbar ⋯ menu ("Video panduan"):
// the welcome videos first, then the chat, then one per app. Only the
// published ones; the admin also sees the rest, marked "belum diupload".
const LIBRARY_ORDER = ["akun-baru", "kenalan", "beranda", "tanya-brandlab", "brand-builder", "campaign", "content-os", "copy", "sales"];
export const libraryVideoKeys = () => LIBRARY_ORDER.filter((key) => canShowVideo(key));

// The list as a modal; picking one closes it and plays that video with the
// usual three answers ("Tur website" runs the website tour).
export function openVideoLibrary() {
  return whenReady().then(() => {
    const keys = libraryVideoKeys();
    if (!keys.length) return null;
    const rows = keys
      .map((key) => {
        const v = GUIDE_VIDEOS[key];
        const n = videoParts(key).length;
        const meta = !isLive(key) ? t("guide.library.notUploaded") : [n > 1 ? t("guide.library.parts", { n }) : "", fmtTime(v.seconds)].filter(Boolean).join(" · ");
        return `
        <li>
          <button type="button" class="gv-part" data-gv-lib="${escapeHtml(key)}">
            <span class="gv-part-num">${icon("play", { size: 11 })}</span>
            <span class="gv-part-title">${escapeHtml(v.title)}</span>
            <span class="gv-part-time">${escapeHtml(meta)}</span>
          </button>
        </li>`;
      })
      .join("");
    const overlay = openModal({
      title: t("guide.library.title"),
      bodyHTML: `<p class="text-muted gv-library-sub">${t("guide.library.sub")}</p><ol class="gv-parts gv-library">${rows}</ol>`,
    });
    overlay.addEventListener("click", (e) => {
      const btn = e.target instanceof Element ? e.target.closest("[data-gv-lib]") : null;
      if (!btn) return;
      closeOverlay(overlay);
      openGuideVideo(btn.dataset.gvLib, { onTour: startWebsiteTour, tourLabel: t("guide.video.choices.tour"), hint: false });
    });
    return overlay;
  });
}

// ---------- "Already seen" ----------
// Same "seen" storage shape as section-guide.js's guideSeen (account first,
// browser as a mirror) but under its own `video:` namespace, written here
// rather than imported so guide-videos.js stays free of a circular import
// back through section-guide.js.
const VIDEO_SEEN_PREFIX = "contentos:video-seen:";
const seenKey = (videoKey) => `video:${videoKey}`;

export function videoSeen(videoKey) {
  const onAccount = !!getSettings()?.guideSeen?.[seenKey(videoKey)];
  const local = readFlag(VIDEO_SEEN_PREFIX, videoKey);
  if (local && !onAccount) queueMicrotask(() => markVideoSeen(videoKey));
  return local || onAccount;
}

export function markVideoSeen(videoKey) {
  writeFlag(VIDEO_SEEN_PREFIX, videoKey);
  const seen = getSettings()?.guideSeen || {};
  if (seen[seenKey(videoKey)] || isReadOnly(getCachedAccount())) return;
  updateSettings({ guideSeen: { ...seen, [seenKey(videoKey)]: Date.now() } });
}

// Forgets every "already shown this one" mark. Meant for testing — from the
// console:
//   (await import("./js/guide-videos.js")).resetVideoSeen()
export function resetVideoSeen() {
  const keys = Object.keys(GUIDE_VIDEOS).flatMap((k) => videoParts(k).map((_, i) => partSeenKey(k, i)));
  keys.forEach((k) => clearFlag(VIDEO_SEEN_PREFIX, k));
  const seen = { ...(getSettings()?.guideSeen || {}) };
  keys.forEach((k) => delete seen[seenKey(k)]);
  if (!isReadOnly(getCachedAccount())) updateSettings({ guideSeen: seen });
  return keys.length;
}

// One part of a video. Part 1 is the video's own mark, so a page that opens
// on part 1 and a gate on the same video (the chat's, the intro) never both
// play it; later parts carry their number.
const partSeenKey = (videoKey, part) => (part > 0 ? `${videoKey}#${part + 1}` : videoKey);
export const partSeen = (videoKey, part = 0) => videoSeen(partSeenKey(videoKey, part));
export const markPartSeen = (videoKey, part = 0) => markVideoSeen(partSeenKey(videoKey, part));

// ---------- "You can play it again here" ----------
// Said once, right after the video closes, pointing at the Video button next
// to Panduan — the button is small and lives in the page eyebrow, so being
// told where it is beats being expected to spot it. Used by the first-run
// "kenalan" video (js/main.js playFirstRunIntro), by each page's video on a
// new account's first visit (offerPageVideo), and by any other caller that
// opens a video with `hint: true`.
function replayHint() {
  const btn = document.querySelector("[data-page-help]");
  if (btn) showCalloutBubble(btn, t("guide.video.offer.replay"));
  else toast(t("guide.video.offer.replayMenu"));
}

// Same sentence, but held back until the tour the person chose instead has
// finished (tour.js marks a running tour on <body>), so the bubble never
// fights the spotlight for attention.
function hintAfterTour() {
  const running = () => document.body.classList.contains("tour-active");
  const waitFor = (cond, then, tries) => {
    if (cond()) return then();
    if (tries <= 0) return;
    setTimeout(() => waitFor(cond, then, tries - 1), 300);
  };
  // Give the tour a moment to start before watching for it to end; if it
  // never starts at all, the hint is still said.
  waitFor(running, () => waitFor(() => !running(), replayHint, 600), 10);
}

// The intro, by itself, on a brand-new account's very first boot
// (js/main.js, right after that boot's first renderRoute()). Guarded by the
// same videoSeen flag as every replay, so it only ever runs once per
// account, ever — a second onAccountChange firing mid-signup, a re-login,
// none of it shows it again. `hint: true` is what leaves the "you can
// replay it from the Video button" bubble behind once it closes.
// "Sudah paham" (or the X) also leaves the floating "Mau tur website?" pill
// (js/tour-offer.js): armed as the video opens, so a reload mid-video still
// gets it on the next boot, and shown once the video closes without the tour.
// Resolves once the video (or the tour) is up, so main.js knows when the
// screen is no longer being held for it.
export function playFirstRunIntro() {
  if (videoSeen("kenalan")) return Promise.resolve();
  markVideoSeen("kenalan");
  const startTour = (opts) => import("./tour.js").then((m) => m.startOnboardingTour(opts));
  const offer = () => import("./tour-offer.js").catch((e) => (console.warn("tour offer unavailable", e), null));
  // No published intro yet: start the tour on its own — the short first-run
  // version that ends on "Mulai Brand DNA" (the full one stays in the ⋯
  // menu → Tur website). Pressing "Tur website" on the video is an explicit ask,
  // so that still gets the full tour.
  return whenReady().then(() => {
    if (!isLive("kenalan")) return startTour({ firstRun: true });
    offer().then((m) => m?.armTourOffer());
    return openGuideVideo("kenalan", { onTour: () => startTour(), tourLabel: t("guide.video.choices.tour"), hint: true, onDone: () => offer().then((m) => m?.showTourOffer()) });
  });
}

// A video that stands in front of something, once per account. Resolves
// with { tour } once it closes — tour: true when "Tur website" was pressed —
// or right away ({ tour: false }) when it isn't published / was already
// seen. The caller carries on (show the mode picker, open the chat).
// `tourNow`: start the website tour here; false when the caller has to put
// something on screen first (the mode picker) and starts it itself.
export function playVideoGate(videoKey, { tourNow = true } = {}) {
  if (videoSeen(videoKey)) return Promise.resolve({ tour: false });
  return whenReady().then(
    () =>
      new Promise((resolve) => {
        if (!canShowVideo(videoKey)) return resolve({ tour: false });
        markVideoSeen(videoKey);
        const done = (choice) => {
          const tour = choice === "tour";
          if (tour && tourNow) startWebsiteTour();
          resolve({ tour });
        };
        const overlay = openGuideVideo(videoKey, { hint: false, onTour: startWebsiteTour, tourLabel: t("guide.video.choices.tour"), onClose: done });
        if (!overlay) resolve({ tour: false });
      })
  );
}

// The website tour, for a caller that held it back (playVideoGate tourNow:false).
export function startTour() {
  return startWebsiteTour();
}

// ---------- A page's video, by itself, the first time ----------
// A new account gets each page's video the first time it opens that page:
// Brand DNA's on the first open of Brand DNA, the Kalender part on the first
// open of Kalender, and so on — whichever mode it picked. "New" is an account
// made since the videos went up (12 Oct 2026, release day); accounts older
// than that already know the app and keep finding the videos under Panduan.
export const PAGE_VIDEO_SINCE = Date.UTC(2026, 9, 11, 17); // 12 Oct 2026, 00:00 WIB
export const isNewAccount = (account) => Number(account?.createdAt) >= PAGE_VIDEO_SINCE;

// → { video, part, start } to play by itself on this page now, or null:
// only a published video, only the part made for this page (Brand Book
// stays quiet while only "Brand DNA" is up), and only one this account has
// not seen. Pages that share a part (the Brand hub and Brand DNA) play it
// once between them.
export function pageVideoDue(guideKey, { account = getCachedAccount(), seen = partSeen } = {}) {
  if (!isNewAccount(account)) return null;
  const ref = videoRefForGuide(guideKey);
  if (!ref || !isLive(ref.video)) return null;
  const at = ownPoint(ref);
  return !at || seen(ref.video, at.part) ? null : { video: ref.video, ...at };
}

// The page on screen says which one it is through its Panduan button.
const pageGuideKey = () => document.querySelector("#view-root [data-page-help]")?.dataset.pageHelp || null;
// Something else has the screen: a modal or sheet, the greeting, the
// congratulations page after a payment.
const screenTaken = () => !!document.querySelector(".overlay:not(.is-leaving), .brandlab-bumper, #mode-root, .pay-thanks");
const tourRunning = () => document.body.classList.contains("tour-active");

// Called by js/main.js each time a page has painted. Waits for a free
// screen (the greeting, a sheet that opened first — `busy` is main.js's own
// "boot is still putting things up"), then plays what is due. `stillHere`
// turns false once the person has moved on. A tour on the page (the website
// tour passing through, the page's own guide) ends the wait: its last step
// hands the person something to press, and a video must not land on that.
// A video that did not get its turn stays unseen and plays on the next visit.
const PAGE_VIDEO_TICK_MS = 300;
export function offerPageVideo({ stillHere = () => true, busy = () => false } = {}) {
  if (typeof document === "undefined" || !isNewAccount(getCachedAccount())) return Promise.resolve(null);
  return whenReady().then(
    () =>
      new Promise((resolve) => {
        let ticks = 0;
        let free = 0;
        const tick = () => {
          if (!stillHere() || tourRunning()) return resolve(null);
          const key = pageGuideKey();
          // No button yet: the page may still be painting its head.
          if (!key) return ++ticks > 6 ? resolve(null) : setTimeout(tick, PAGE_VIDEO_TICK_MS);
          const due = pageVideoDue(key);
          if (!due) return resolve(null);
          free = busy() || screenTaken() ? 0 : free + 1;
          // Free on two looks in a row, so it never lands between a greeting
          // closing and the sheet that follows it.
          if (free < 2) return ++ticks > 40 ? resolve(null) : setTimeout(tick, PAGE_VIDEO_TICK_MS);
          // Closing it leaves the bubble on Panduan: the video is in there.
          const overlay = openGuideVideo(due.video, { part: due.part, start: due.start, hint: true });
          if (overlay) markPartSeen(due.video, due.part);
          resolve(overlay ? due : null);
        };
        setTimeout(tick, PAGE_VIDEO_TICK_MS);
      })
  );
}

// The two pills next to a page's "?" (js/help.js helpButtonHTML), same
// icon-button language so the three read as one group:
//   Video   — that page's video (at its chapter). Hidden until the video is
//             published (admins see it anyway, see canShowVideo).
//   Panduan — that page's spotlight guide, or the website tour where a page
//             has none. Shown once the page has registered its guide
//             (js/section-guide.js keeps these in step).
// A click (delegated listener below) opens them; the video also plays by
// itself on a new account's first visit (offerPageVideo above).
// The page's ONE help door. It used to be three things side by side — a
// "?" explainer, a "Panduan" tour pill and a "Video" pill — plus another "?"
// in the topbar. Now one "Panduan" pill opens a small menu with everything
// this page has: what the page is for, the spotlight tour, the video, and
// "ask the AI". The eyebrow's own "?" hides itself next to it (CSS :has).
// Right after it sits a small flag: "Laporkan masalah" about this very page
// (js/report-problem.js), so a bug is reported where it is seen instead of
// from the ⋯ menu.
export function guideVideoButtonHTML(guideKey) {
  return `<button type="button" class="icon-btn help-btn section-video-btn page-help-btn" data-page-help="${escapeHtml(guideKey)}" title="${t("guide.btn")}" aria-label="${t("guide.btn")}" aria-haspopup="menu">${icon("help", { size: 14 })}<span>${t("guide.btn")}</span></button>${pageReportButtonHTML(guideKey)}`;
}

export function pageReportButtonHTML(guideKey) {
  return `<button type="button" class="icon-btn help-btn page-report-btn" data-page-report="${escapeHtml(guideKey)}" title="${t("lapor.page.btn")}" aria-label="${t("lapor.page.btn")}">${icon("flag", { size: 13 })}</button>`;
}

function pageHelpMenu(btn) {
  const guideKey = btn.dataset.pageHelp;
  // The explainer text: this page's own help entry, else the one the
  // eyebrow's (now hidden) "?" button carried.
  const helpKey = helpEntry(guideKey) ? guideKey : btn.parentElement?.querySelector("[data-help]")?.dataset.help;
  const entry = helpKey ? helpEntry(helpKey) : null;
  const ref = videoRefForGuide(guideKey);
  const hasVideo = !!(ref && canShowVideo(ref.video));
  const hasTour = !!getPageGuide();
  const inBrand = /^#\/brand\//.test(location.hash);
  const rect = btn.getBoundingClientRect();
  const menu = openMenu(btn, { className: "help-popover page-help-menu", top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - 308)) });
  if (!menu) return;
  menu.innerHTML = `
    ${entry ? `<div class="help-popover-title">${escapeHtml(entry.title)}</div><p class="help-popover-body">${escapeHtml(entry.body)}</p>` : ""}
    <div class="page-help-actions">
      ${hasTour ? `<button type="button" data-ph="tour">${icon("target", { size: 15 })}${t("help.pageGuide")}</button>` : ""}
      ${hasVideo ? `<button type="button" data-ph="video">${icon("play", { size: 15 })}${t("guide.video.btnTitle")}</button>` : ""}
      ${inBrand && guideKey !== "chat" ? `<button type="button" data-ph="ai">${icon("chat", { size: 15 })}${t("help.askAi")}</button>` : ""}
    </div>`;
  menu.addEventListener("click", (ev) => {
    const act = ev.target.closest("[data-ph]")?.dataset.ph;
    if (!act) return;
    closeMenu();
    if (act === "tour") startPageTour();
    else if (act === "video") whenReady().then(() => openGuideVideo(ref.video, openingPoint(ref)));
    else if (act === "ai") import("./consultant-panel.js").then((m) => m.openConsultantPanel());
  });
}

// One delegated listener for every Video button, so pages don't each need
// to wire it after every repaint.
if (typeof window !== "undefined" && !window.__guideVideoClickWired) {
  window.__guideVideoClickWired = true;
  document.addEventListener("click", (e) => {
    const helpBtn = e.target instanceof Element ? e.target.closest("[data-page-help]") : null;
    if (helpBtn) { e.preventDefault(); e.stopPropagation(); pageHelpMenu(helpBtn); return; }
    const reportBtn = e.target instanceof Element ? e.target.closest("[data-page-report]") : null;
    if (reportBtn) {
      e.preventDefault();
      import("./report-problem.js").then((m) => m.openReportProblem({ source: "page", feature: reportBtn.dataset.pageReport })).catch((err) => console.warn("[report] unavailable", err));
      return;
    }
    const guideBtn = e.target instanceof Element ? e.target.closest("[data-page-guide-btn]") : null;
    if (guideBtn) { startPageTour(); return; }
    const btn = e.target instanceof Element ? e.target.closest("[data-guide-video-btn]") : null;
    if (!btn) return;
    const ref = videoRefForGuide(btn.dataset.guideVideoBtn);
    if (ref) whenReady().then(() => openGuideVideo(ref.video, openingPoint(ref)));
  });
}
