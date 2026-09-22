// Short explainer videos, one per app (Brand Builder, Campaign, Content OS,
// Copy Studio, Sales Tracker) plus the "kenalan" intro. Every one of them
// works the same way, on purpose:
//   - Click the "Video" pill next to a page's "?" to open it, any time.
//   - It can be skipped at any moment ("Lewati video").
//   - When it ends (or is skipped) the same modal asks what's next, in three
//     answers: play it again, take the live tour of this page instead, or
//     "sudah paham".
// Nothing here plays itself just from navigating to a page. Two exceptions,
// both the "kenalan" video: a brand-new account's very first open
// (js/main.js playFirstRunIntro, once ever, right after the welcome bumper),
// which reuses this same modal with its `hint` bubble so the way back ("the
// Video button lives here from now on") is shown once, not left to be
// discovered; and every brand creation, for any account
// (js/views/brands.js playNewBrandIntro).
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
import { getCachedAccount, isReadOnly } from "./account.js";
import { readFlag, writeFlag, clearFlag } from "./seen-flags.js";
import { t } from "./i18n.js";

// A stand-in for "there will be a video here". Everything downstream treats
// it as a real src — the video is offered / is replayable — and only the
// player itself knows to draw the pending panel instead.
export const PLACEHOLDER_SRC = "placeholder";
const isPlaceholder = (src) => src === PLACEHOLDER_SRC;

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
    key = /\/content-os\/creator/.test(hash) ? "creator" : /\/content-os\/calendar/.test(hash) ? "calendar" : "konten-dashboard";
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

function embedUrl(src, start = 0) {
  const p = parseVideoSrc(src);
  const at = Math.max(0, Math.floor(Number(start) || 0));
  if (p.kind === "youtube") return `https://www.youtube.com/embed/${p.id}?rel=0${at ? `&start=${at}` : ""}`;
  if (p.kind === "vimeo") return `https://player.vimeo.com/video/${p.id}${at ? `#t=${at}s` : ""}`;
  return null;
}

// A plain media file starts at `start` via a media fragment (#t=), which
// every browser's <video> honours without any script.
function fileUrl(src, start = 0) {
  const at = Math.max(0, Math.floor(Number(start) || 0));
  return at ? `${src}#t=${at}` : src;
}

export function guideVideoWidgetHTML(videoKey, { compact = false, start = 0 } = {}) {
  const v = GUIDE_VIDEOS[videoKey];
  if (!v) return "";
  const size = compact ? " is-compact" : "";
  if (!v.src || isPlaceholder(v.src)) {
    return `
      <div class="guide-video-frame is-placeholder${size}" role="img" aria-label="${t("guide.video.pendingAria", { title: escapeHtml(v.title) })}">
        <div class="guide-video-play">${icon("play", { size: compact ? 16 : 22 })}</div>
        <div class="guide-video-ph-text"><b>${t("guide.video.pending")}</b><span>${escapeHtml(v.title)} · ${escapeHtml(v.duration)}</span></div>
      </div>`;
  }
  const embed = embedUrl(v.src, start);
  if (embed) {
    return `<div class="guide-video-frame${size}"><iframe src="${escapeHtml(embed)}" title="${escapeHtml(v.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>`;
  }
  return `<div class="guide-video-frame${size}"><video src="${escapeHtml(fileUrl(v.src, start))}" controls playsinline preload="metadata"></video></div>`;
}

// The player, as a modal, in two states: watching (the video plus a Lewati
// button) and, once it ends or is skipped, the three answers. `onTour` is
// what "masih mau tur website" runs; by default it presses this page's own
// Panduan button, which is exactly what the closing bubble will point at.
// `start` (seconds) opens the video at that page's chapter; the replay
// button starts from the top, so the whole app video is one click away.
export function openGuideVideo(videoKey, { onTour = startPageTour, hint = true, start = 0 } = {}) {
  const v = GUIDE_VIDEOS[videoKey];
  if (!v) return null;
  const real = !!v.src && !isPlaceholder(v.src);
  const overlay = openModal({
    title: v.title,
    wide: true,
    bodyHTML: `
      <div data-video-stage>${guideVideoWidgetHTML(videoKey, { start })}</div>
      <p class="guide-video-note">${real ? t("guide.video.duration", { duration: escapeHtml(v.duration) }) : t("guide.video.pendingNote", { duration: escapeHtml(v.duration) })}</p>
      <div class="guide-video-skip" data-video-skip hidden>
        <button type="button" class="btn btn-ghost btn-sm" data-vc="skip">${t("guide.video.skip")}</button>
      </div>
      <div class="guide-video-choices" data-video-choices hidden>
        <p class="guide-video-choices-head">${t("guide.video.choices.head")}</p>
        <div class="guide-video-choice-row">
          <button type="button" class="btn btn-ghost btn-sm" data-vc="replay">${icon("play", { size: 13 })}${t("guide.video.choices.replay")}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-vc="tour">${icon("target", { size: 13 })}${t("guide.video.choices.tour")}</button>
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
    if (el) el.addEventListener("ended", showChoices, { once: true });
    else ending = setTimeout(showChoices, Math.max(5, (Number(v.seconds) || 60) - (Number(start) || 0)) * 1000);
  };

  overlay.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest("[data-vc]") : null;
    if (!btn) return;
    const what = btn.dataset.vc;
    if (what === "skip") return showChoices();
    if (what === "replay") {
      start = 0;
      stage.innerHTML = guideVideoWidgetHTML(videoKey);
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

// "Masih mau tur website": this page's own Panduan button runs the tour that
// belongs to it, and every page that has a video has one. The very first
// video plays before any page is on screen (right after the mode picker), so
// there the global onboarding tour stands in.
function startPageTour() {
  const btn = document.querySelector("[data-section-guide-btn]");
  if (btn) btn.click();
  else import("./tour.js").then((m) => m.startOnboardingTour()).catch((e) => console.warn("tur tidak bisa dibuka", e));
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
  introJustPlayed = true;
  openGuideVideo("kenalan", { onTour: () => import("./tour.js").then((m) => m.startOnboardingTour()), hint: true });
}

// The second autoplay: every time a brand is created, for anyone — not just
// a brand-new account. Deliberately NOT videoSeen-gated; a new brand is a
// fresh start, so the "kenalan" video plays again (it can be skipped at once
// with "Lewati video"). The one exception is a new account's first brand
// made in the same visit as the first-run intro: that video finished moments
// ago, so playing it back-to-back would be a repeat, not a welcome. The
// exception is spent on that one brand — every brand after it plays.
// No `hint`: the Video button was already pointed out by the first run.
let introJustPlayed = false;
export function playNewBrandIntro() {
  if (introJustPlayed) {
    introJustPlayed = false;
    return;
  }
  openGuideVideo("kenalan", { onTour: () => import("./tour.js").then((m) => m.startOnboardingTour()), hint: false });
}

// The "Video" pill next to a page's "?" (js/help.js helpButtonHTML) — same
// icon-button language, so the two read as a pair. Empty when that page has
// no video. Never opens on its own; only a click (via the delegated
// listener below) or an explicit openGuideVideo() call shows the modal.
export function guideVideoButtonHTML(guideKey) {
  if (!videoRefForGuide(guideKey)) return "";
  return `<button type="button" class="icon-btn help-btn section-video-btn" data-guide-video-btn="${escapeHtml(guideKey)}" title="${t("guide.video.btnTitle")}" aria-label="${t("guide.video.btnTitle")}">${icon("play", { size: 14 })}<span>Video</span></button>`;
}

// One delegated listener for every Video button, so pages don't each need
// to wire it after every repaint.
if (typeof window !== "undefined" && !window.__guideVideoClickWired) {
  window.__guideVideoClickWired = true;
  document.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest("[data-guide-video-btn]") : null;
    if (!btn) return;
    const ref = videoRefForGuide(btn.dataset.guideVideoBtn);
    if (ref) openGuideVideo(ref.video, { start: ref.start });
  });
}
