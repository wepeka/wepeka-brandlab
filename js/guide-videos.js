// Short explainer videos, one per app (Brand Builder, Campaign, Content OS,
// Copy Studio, Sales Tracker) plus the "kenalan" intro. Every one of them
// works the same way, on purpose:
//   - Click the "Video" pill next to a page's "?" to open it, any time.
//   - It can be skipped at any moment ("Lewati video").
//   - When it ends (or is skipped) the same modal asks what's next, in three
//     answers: play it again, take the live tour of this page instead, or
//     "sudah paham".
// Nothing here plays itself just from navigating to a page. The one
// exception is the "kenalan" video on a brand-new account's very first open
// (js/main.js playFirstRunIntro, once ever, right after the welcome bumper):
// it autoplays, can be skipped, and ends on the same three answers —
// "Sudah paham", "Putar ulang video", "Tur website". From then on every page
// carries a Video button and a Panduan button (guideVideoButtonHTML) instead.
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

// `seconds` is the declared length. For an embed (YouTube/Vimeo) it is also
// the fallback for "the video has ended", since an iframe can't be watched
// from here — so keep it equal to the real recording's length.
export const GUIDE_VIDEOS = {
  // Plays once, right after the account exists and before the Pemula/Pro
  // picker (js/main.js → playVideoGate).
  "akun-baru": { title: t("guide.video.akunBaru"), duration: t("guide.video.sec", { n: 60 }), seconds: 60, src: PLACEHOLDER_SRC },
  kenalan: { title: t("guide.video.kenalan"), duration: t("guide.video.sec", { n: 90 }), seconds: 90, src: PLACEHOLDER_SRC },
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
  home: "kenalan",
  tools: "kenalan",
  "brand-builder": "brand-builder",
  "brand-builder-hub": "brand-builder",
  "brand-dna": { video: "brand-builder", part: /dna/i },
  "brand-guidelines": { video: "brand-builder", start: 80, part: /brand ?book|guideline|logo|warna|font/i },
  campaigns: "campaign",
  "campaign-list": "campaign",
  "campaign-detail": { video: "campaign", start: 30, part: /detail|level|misi|mission/i },
  brainstorm: { video: "campaign", start: 95, part: /brainstorm|chat|ide/i },
  creator: { video: "content-os", part: /creator|tulis|bikin|buat/i },
  calendar: { video: "content-os", start: 80, part: /kalender|calendar|jadwal/i },
  "konten-dashboard": { video: "content-os", start: 135, part: /dashboard|hasil|insight|result/i },
  "copy-studio": "copy",
  sales: "sales",
  chat: "tanya-brandlab",
};

// → { video, start } for a page, or null when the page has no video.
export function videoRefForGuide(guideKey) {
  let key = guideKey;
  if (guideKey === "content-os" || guideKey === "content-list") {
    const hash = typeof location !== "undefined" ? location.hash : "";
    key = /\/content\/creator/.test(hash) ? "creator" : /\/content\/calendar/.test(hash) ? "calendar" : "konten-dashboard";
  }
  const ref = GUIDE_TO_VIDEO[key];
  if (!ref) return null;
  const out = typeof ref === "string" ? { video: ref, start: 0, part: null } : { video: ref.video, start: Number(ref.start) || 0, part: ref.part || null };
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
  return { part: 0, start: ref.start };
}

// Just the video key (kept for callers that only care which video).
export function videoKeyForGuide(guideKey) {
  return videoRefForGuide(guideKey)?.video || null;
}

// "…/watch?v=ID" | "…/ID" | "https://cdn/x.mp4" → what kind of player to build.
export function parseVideoSrc(src) {
  const s = String(src || "");
  if (!s) return { kind: "none", id: "" };
  const yt = s.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  if (yt) return { kind: "youtube", id: yt[1] };
  const vimeo = s.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { kind: "vimeo", id: vimeo[1] };
  return { kind: "file", id: "" };
}

// fs=0 / no native fullscreen: the player's own fullscreen button enlarges
// the whole frame, so the watermark stays on screen.
function embedUrl(src, start = 0, autoplay = false) {
  const p = parseVideoSrc(src);
  const at = Math.max(0, Math.floor(Number(start) || 0));
  if (p.kind === "youtube") return `https://www.youtube.com/embed/${p.id}?rel=0&playsinline=1&fs=0&modestbranding=1${autoplay ? "&autoplay=1" : ""}${at ? `&start=${at}` : ""}`;
  if (p.kind === "vimeo") return `https://player.vimeo.com/video/${p.id}${autoplay ? "?autoplay=1" : ""}${at ? `#t=${at}s` : ""}`;
  return null;
}

// A plain media file starts at `start` via a media fragment (#t=), which
// every browser's <video> honours without any script.
function fileUrl(src, start = 0) {
  const at = Math.max(0, Math.floor(Number(start) || 0));
  return at ? `${src}#t=${at}` : src;
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
    return `<div class="guide-video-frame has-wm${size}"><iframe src="${escapeHtml(embed)}" title="${escapeHtml(p.title || v.title)}" allow="autoplay; encrypted-media"></iframe>${watermarkHTML(subtitle)}</div>`;
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
export function openGuideVideo(videoKey, { onTour = startPageTour, tourLabel = null, hint = true, start = 0, part = 0, onClose = null } = {}) {
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
        <div data-video-stage>${guideVideoWidgetHTML(videoKey, { start, autoplay: true, part: current })}</div>
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
  // three answers.
  const partEnded = () => {
    if (current < parts.length - 1) playPart(current + 1);
    else showChoices();
  };
  // A real video announces its own end; an embed can't be watched from here
  // without its player API, so fall back to the declared length. The
  // placeholder has nothing to play at all, so it asks straight away.
  const watchForEnd = () => {
    if (ending) { clearTimeout(ending); ending = null; }
    choicesHead.hidden = true;
    if (!real) return showChoices();
    const el = stage.querySelector("video");
    if (el) {
      // Same guard for a file whose real length is shorter than declared.
      el.addEventListener("loadedmetadata", () => {
        if (el.duration && el.currentTime >= el.duration - 1) el.currentTime = 0;
      }, { once: true });
      el.addEventListener("ended", partEnded, { once: true });
    }
    else ending = setTimeout(partEnded, Math.max(5, (partSeconds() || 60) - (Number(start) || 0)) * 1000);
  };
  function playPart(i, { from = 0 } = {}) {
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
  if (hint || onClose) {
    const obs = new MutationObserver(() => {
      if (overlay.isConnected) return;
      obs.disconnect();
      if (ending) clearTimeout(ending);
      if (onClose) return onClose(choice);
      if (tourTaken) hintAfterTour();
      else replayHint();
    });
    obs.observe(document.body, { childList: true });
  }
  paintBar();
  watchForEnd();
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

// The intro video on demand (the topbar "?" menu): same three answers, and
// "Tur website" runs the website tour.
export function openIntroVideo() {
  whenReady().then(() => openGuideVideo("kenalan", { onTour: startWebsiteTour, tourLabel: t("guide.video.choices.tour"), hint: false }));
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
  const keys = Object.keys(GUIDE_VIDEOS);
  keys.forEach((k) => clearFlag(VIDEO_SEEN_PREFIX, k));
  const seen = { ...(getSettings()?.guideSeen || {}) };
  keys.forEach((k) => delete seen[seenKey(k)]);
  if (!isReadOnly(getCachedAccount())) updateSettings({ guideSeen: seen });
  return keys.length;
}

// ---------- "You can play it again here" ----------
// Said once, right after the video closes, pointing at the Video button next
// to Panduan — the button is small and lives in the page eyebrow, so being
// told where it is beats being expected to spot it. Used by the first-run
// "kenalan" video (js/main.js playFirstRunIntro) and available to any other
// caller that opens a video with `hint: true`.
function replayHint() {
  const btn = document.querySelector("[data-page-help]");
  const text = t("guide.video.offer.replay");
  if (btn) showCalloutBubble(btn, text);
  else toast(text);
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

// The one autoplay left in the app: a brand-new account's very first boot
// (js/main.js, right after that boot's first renderRoute()). Guarded by the
// same videoSeen flag as every replay, so it only ever runs once per
// account, ever — a second onAccountChange firing mid-signup, a re-login,
// none of it shows it again. `hint: true` is what leaves the "you can
// replay it from the Video button" bubble behind once it closes.
export function playFirstRunIntro() {
  if (videoSeen("kenalan")) return;
  markVideoSeen("kenalan");
  const startTour = () => import("./tour.js").then((m) => m.startOnboardingTour());
  // No published intro yet: go straight to the tour the video would offer.
  whenReady().then(() => (isLive("kenalan") ? openGuideVideo("kenalan", { onTour: startTour, tourLabel: t("guide.video.choices.tour"), hint: true }) : startTour()));
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

// The two pills next to a page's "?" (js/help.js helpButtonHTML), same
// icon-button language so the three read as one group:
//   Video   — that page's video (at its chapter). Hidden until the video is
//             published (admins see it anyway, see canShowVideo).
//   Panduan — that page's spotlight guide, or the website tour where a page
//             has none. Shown once the page has registered its guide
//             (js/section-guide.js keeps these in step).
// Neither opens on its own; only a click (delegated listener below) does.
// The page's ONE help door. It used to be three things side by side — a
// "?" explainer, a "Panduan" tour pill and a "Video" pill — plus another "?"
// in the topbar. Now one "Panduan" pill opens a small menu with everything
// this page has: what the page is for, the spotlight tour, the video, and
// "ask the AI". The eyebrow's own "?" hides itself next to it (CSS :has).
export function guideVideoButtonHTML(guideKey) {
  return `<button type="button" class="icon-btn help-btn section-video-btn page-help-btn" data-page-help="${escapeHtml(guideKey)}" title="${t("guide.btn")}" aria-label="${t("guide.btn")}" aria-haspopup="menu">${icon("help", { size: 14 })}<span>${t("guide.btn")}</span></button>`;
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
      ${inBrand ? `<button type="button" data-ph="ai">${icon("chat", { size: 15 })}${t("help.askAi")}</button>` : ""}
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
    const guideBtn = e.target instanceof Element ? e.target.closest("[data-page-guide-btn]") : null;
    if (guideBtn) { startPageTour(); return; }
    const btn = e.target instanceof Element ? e.target.closest("[data-guide-video-btn]") : null;
    if (!btn) return;
    const ref = videoRefForGuide(btn.dataset.guideVideoBtn);
    if (ref) whenReady().then(() => openGuideVideo(ref.video, openingPoint(ref)));
  });
}
