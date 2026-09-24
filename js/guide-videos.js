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
import { icon } from "./icons.js";
import { escapeHtml, toast, showCalloutBubble } from "./dom.js";
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
  kenalan: { title: t("guide.video.kenalan"), duration: t("guide.video.sec", { n: 90 }), seconds: 90, src: PLACEHOLDER_SRC },
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
export const guideVideosReady = (typeof fetch === "function" ? fetch("/api/guide-videos") : Promise.reject())
  .then((r) => (r.ok ? r.json() : {}))
  .then(({ videos } = {}) => {
    for (const [key, o] of Object.entries(videos || {})) {
      const v = GUIDE_VIDEOS[key];
      if (!v || !o?.src) continue;
      v.src = o.src;
      if (o.seconds > 0) {
        v.seconds = o.seconds;
        v.duration = durationLabel(o.seconds);
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
// timestamps after each video is recorded.
const GUIDE_TO_VIDEO = {
  onboarding: "kenalan",
  home: "kenalan",
  tools: "kenalan",
  "brand-builder": "brand-builder",
  "brand-builder-hub": "brand-builder",
  "brand-dna": "brand-builder",
  "brand-guidelines": { video: "brand-builder", start: 80 },
  campaigns: "campaign",
  "campaign-list": "campaign",
  "campaign-detail": { video: "campaign", start: 30 },
  brainstorm: { video: "campaign", start: 95 },
  creator: "content-os",
  calendar: { video: "content-os", start: 80 },
  "konten-dashboard": { video: "content-os", start: 135 },
  "copy-studio": "copy",
  sales: "sales",
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
  const out = typeof ref === "string" ? { video: ref, start: 0 } : { video: ref.video, start: Number(ref.start) || 0 };
  return GUIDE_VIDEOS[out.video] ? out : null;
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

function embedUrl(src, start = 0, autoplay = false) {
  const p = parseVideoSrc(src);
  const at = Math.max(0, Math.floor(Number(start) || 0));
  if (p.kind === "youtube") return `https://www.youtube.com/embed/${p.id}?rel=0&playsinline=1${autoplay ? "&autoplay=1" : ""}${at ? `&start=${at}` : ""}`;
  if (p.kind === "vimeo") return `https://player.vimeo.com/video/${p.id}${autoplay ? "?autoplay=1" : ""}${at ? `#t=${at}s` : ""}`;
  return null;
}

// A plain media file starts at `start` via a media fragment (#t=), which
// every browser's <video> honours without any script.
function fileUrl(src, start = 0) {
  const at = Math.max(0, Math.floor(Number(start) || 0));
  return at ? `${src}#t=${at}` : src;
}

// `autoplay`: the modal plays the video as soon as it opens — someone who
// pressed Video (or a new account's intro) came to watch, not to press play
// a second time. Browsers allow it after a click on the page; where one
// still blocks it, the player's own play button is right there.
export function guideVideoWidgetHTML(videoKey, { compact = false, start = 0, autoplay = false } = {}) {
  const v = GUIDE_VIDEOS[videoKey];
  if (!v) return "";
  const size = compact ? " is-compact" : "";
  if (!v.src || isPlaceholder(v.src)) {
    return `
      <div class="guide-video-frame is-placeholder${size}" role="img" aria-label="${t("guide.video.pendingAria", { title: escapeHtml(v.title) })}">
        <div class="guide-video-play">${icon("play", { size: compact ? 16 : 22 })}</div>
        <div class="guide-video-ph-text"><b>${t("guide.video.pending")}</b><span>${escapeHtml(v.title)} · ${escapeHtml(v.duration)}</span>${adminPreview() ? `<small>${t("guide.video.adminPending")}</small>` : ""}</div>
      </div>`;
  }
  const embed = embedUrl(v.src, start, autoplay);
  if (embed) {
    return `<div class="guide-video-frame${size}"><iframe src="${escapeHtml(embed)}" title="${escapeHtml(v.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
  }
  return `<div class="guide-video-frame${size}"><video src="${escapeHtml(fileUrl(v.src, start))}" controls playsinline preload="metadata"${autoplay ? " autoplay" : ""}></video></div>`;
}

// The player, as a modal, in two states: watching (the video plus a Lewati
// button) and, once it ends or is skipped, the three answers. `onTour` is
// what "masih mau tur website" runs; by default it presses this page's own
// Panduan button, which is exactly what the closing bubble will point at.
// `start` (seconds) opens the video at that page's chapter; the replay
// button starts from the top, so the whole app video is one click away.
export function openGuideVideo(videoKey, { onTour = startPageTour, tourLabel = null, hint = true, start = 0 } = {}) {
  const v = GUIDE_VIDEOS[videoKey];
  if (!v) return null;
  const real = !!v.src && !isPlaceholder(v.src);
  if (!real && !adminPreview()) return null;
  // "Tur website" for the intro; on a page, that page's own guide when it
  // has one (it is what the choice runs).
  const tourText = tourLabel || (onTour === startPageTour && getPageGuide() ? t("guide.video.choices.pageGuide") : t("guide.video.choices.tour"));
  // A chapter start past the end of the actual video (chapter times are set
  // for the final recordings; a shorter clip may be up) plays from the top.
  if (Number(v.seconds) > 0 && start >= Number(v.seconds) - 3) start = 0;
  const overlay = openModal({
    title: v.title,
    wide: true,
    bodyHTML: `
      <div data-video-stage>${guideVideoWidgetHTML(videoKey, { start, autoplay: true })}</div>
      <p class="guide-video-note">${real ? t("guide.video.duration", { duration: escapeHtml(v.duration) }) : t("guide.video.pendingNote", { duration: escapeHtml(v.duration) })}</p>
      <div class="guide-video-skip" data-video-skip hidden>
        <button type="button" class="btn btn-ghost btn-sm" data-vc="skip">${t("guide.video.skip")}</button>
      </div>
      <div class="guide-video-choices" data-video-choices hidden>
        <p class="guide-video-choices-head">${t("guide.video.choices.head")}</p>
        <div class="guide-video-choice-row">
          <button type="button" class="btn btn-ghost btn-sm" data-vc="replay">${icon("play", { size: 13 })}${t("guide.video.choices.replay")}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-vc="tour">${icon("target", { size: 13 })}${escapeHtml(tourText)}</button>
          <button type="button" class="btn btn-primary btn-sm" data-vc="done">${t("guide.video.choices.done")}</button>
        </div>
      </div>
    `,
  });
  overlay.setAttribute("data-guide-video-modal", videoKey);

  const choices = overlay.querySelector("[data-video-choices]");
  const skipRow = overlay.querySelector("[data-video-skip]");
  const stage = overlay.querySelector("[data-video-stage]");
  let ending = null;
  let tourTaken = false;

  const showChoices = () => {
    if (ending) { clearTimeout(ending); ending = null; }
    skipRow.hidden = true;
    choices.hidden = false;
  };
  // A real video announces its own end; an embed can't be watched from here
  // without its player API, so fall back to the declared length. The
  // placeholder has nothing to play at all, so it asks straight away.
  const watchForEnd = () => {
    choices.hidden = true;
    if (!real) return showChoices();
    skipRow.hidden = false;
    const el = stage.querySelector("video");
    if (el) {
      // Same guard for a file whose real length is shorter than declared.
      el.addEventListener("loadedmetadata", () => {
        if (el.duration && el.currentTime >= el.duration - 1) el.currentTime = 0;
      }, { once: true });
      el.addEventListener("ended", showChoices, { once: true });
    }
    else ending = setTimeout(showChoices, Math.max(5, (Number(v.seconds) || 60) - (Number(start) || 0)) * 1000);
  };

  overlay.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest("[data-vc]") : null;
    if (!btn) return;
    const what = btn.dataset.vc;
    if (what === "skip") return showChoices();
    if (what === "replay") {
      start = 0;
      stage.innerHTML = guideVideoWidgetHTML(videoKey, { autoplay: true });
      stage.querySelector("video")?.play?.().catch(() => {});
      return watchForEnd();
    }
    tourTaken = what === "tour";
    closeOverlay(overlay);
    if (tourTaken) onTour?.();
  });

  // However it closes — a choice, the X, Escape, a click outside — the same
  // sentence is what's left on screen. After the tour it waits for the tour
  // to finish, so the bubble never fights the spotlight for attention.
  if (hint) {
    const obs = new MutationObserver(() => {
      if (overlay.isConnected) return;
      obs.disconnect();
      if (ending) clearTimeout(ending);
      if (tourTaken) hintAfterTour();
      else replayHint();
    });
    obs.observe(document.body, { childList: true });
  }
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
  const btn = document.querySelector("[data-guide-video-btn]");
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

// The two pills next to a page's "?" (js/help.js helpButtonHTML), same
// icon-button language so the three read as one group:
//   Video   — that page's video (at its chapter). Hidden until the video is
//             published (admins see it anyway, see canShowVideo).
//   Panduan — that page's spotlight guide, or the website tour where a page
//             has none. Shown once the page has registered its guide
//             (js/section-guide.js keeps these in step).
// Neither opens on its own; only a click (delegated listener below) does.
export function guideVideoButtonHTML(guideKey) {
  const ref = videoRefForGuide(guideKey);
  const video = ref
    ? `<button type="button" class="icon-btn help-btn section-video-btn"${canShowVideo(ref.video) ? "" : " hidden"} data-guide-video-btn="${escapeHtml(guideKey)}" title="${t("guide.video.btnTitle")}" aria-label="${t("guide.video.btnTitle")}">${icon("play", { size: 14 })}<span>Video</span></button>`
    : "";
  const guide = `<button type="button" class="icon-btn help-btn section-video-btn section-guide-btn"${getPageGuide() ? "" : " hidden"} data-page-guide-btn title="${t("help.pageGuide")}" aria-label="${t("help.pageGuide")}">${icon("target", { size: 14 })}<span>${t("guide.btn")}</span></button>`;
  return video + guide;
}

// One delegated listener for every Video button, so pages don't each need
// to wire it after every repaint.
if (typeof window !== "undefined" && !window.__guideVideoClickWired) {
  window.__guideVideoClickWired = true;
  document.addEventListener("click", (e) => {
    const guideBtn = e.target instanceof Element ? e.target.closest("[data-page-guide-btn]") : null;
    if (guideBtn) { startPageTour(); return; }
    const btn = e.target instanceof Element ? e.target.closest("[data-guide-video-btn]") : null;
    if (!btn) return;
    const ref = videoRefForGuide(btn.dataset.guideVideoBtn);
    if (ref) whenReady().then(() => openGuideVideo(ref.video, { start: ref.start }));
  });
}
