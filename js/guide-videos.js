// Short explainer videos, one per big page. Every one of them works the same
// way, on purpose:
//   - Click the "Video" pill next to a page's "?" to open it, any time.
//   - It can be skipped at any moment ("Lewati video").
//   - When it ends (or is skipped) the same modal asks what's next, in three
//     answers: play it again, take the live tour of this page instead, or
//     "sudah paham".
// Nothing here plays itself just from navigating to a page — the single
// exception is the "kenalan" video on a brand-new account's very first open
// (js/main.js playFirstRunIntro, once ever), which reuses this same modal
// with its `hint` bubble so the way back ("the Video button lives here from
// now on") is shown once, not left to be discovered.
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

// `seconds` is the declared length — kept for when a real video is
// published (some day it may drive a "estimated remaining" note); not used
// by anything today.
export const GUIDE_VIDEOS = {
  kenalan: { title: t("guide.video.kenalan"), duration: t("guide.video.min", { n: 2 }), seconds: 120, src: PLACEHOLDER_SRC },
  creator: { title: t("guide.video.creator"), duration: t("guide.video.sec", { n: 90 }), seconds: 90, src: PLACEHOLDER_SRC },
  "brand-dna": { title: t("guide.video.brandDna"), duration: t("guide.video.sec", { n: 90 }), seconds: 90, src: PLACEHOLDER_SRC },
  "brand-guidelines": { title: t("guide.video.brandGuidelines"), duration: t("guide.video.sec", { n: 60 }), seconds: 60, src: PLACEHOLDER_SRC },
  campaign: { title: t("guide.video.campaign"), duration: t("guide.video.sec", { n: 90 }), seconds: 90, src: PLACEHOLDER_SRC },
  kalender: { title: t("guide.video.kalender"), duration: t("guide.video.sec", { n: 60 }), seconds: 60, src: PLACEHOLDER_SRC },
  "konten-dashboard": { title: t("guide.video.kontenDashboard"), duration: t("guide.video.sec", { n: 90 }), seconds: 90, src: PLACEHOLDER_SRC },
  copy: { title: t("guide.video.copy"), duration: t("guide.video.sec", { n: 60 }), seconds: 60, src: PLACEHOLDER_SRC },
  tools: { title: t("guide.video.tools"), duration: t("guide.video.sec", { n: 60 }), seconds: 60, src: PLACEHOLDER_SRC },
  brainstorm: { title: t("guide.video.brainstorm"), duration: t("guide.video.sec", { n: 90 }), seconds: 90, src: PLACEHOLDER_SRC },
  sales: { title: t("guide.video.sales"), duration: t("guide.video.sec", { n: 60 }), seconds: 60, src: PLACEHOLDER_SRC },
};

// Guide/Panduan key → video key. Content OS shares one Panduan button across
// its sub-tabs, so it resolves from the current route.
const GUIDE_TO_VIDEO = {
  onboarding: "kenalan",
  home: "kenalan",
  "brand-builder": "brand-dna",
  "brand-builder-hub": "brand-dna",
  "brand-dna": "brand-dna",
  "brand-guidelines": "brand-guidelines",
  campaigns: "campaign",
  "campaign-list": "campaign",
  "campaign-detail": "campaign",
  calendar: "kalender",
  creator: "creator",
  "copy-studio": "copy",
  tools: "tools",
  brainstorm: "brainstorm",
  sales: "sales",
};

export function videoKeyForGuide(guideKey) {
  if (guideKey === "content-os" || guideKey === "content-list") {
    const hash = typeof location !== "undefined" ? location.hash : "";
    if (/\/content-os\/creator/.test(hash)) return "creator";
    if (/\/content-os\/calendar/.test(hash)) return "kalender";
    return "konten-dashboard";
  }
  return GUIDE_TO_VIDEO[guideKey] || null;
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

function embedUrl(src) {
  const p = parseVideoSrc(src);
  if (p.kind === "youtube") return `https://www.youtube.com/embed/${p.id}?rel=0`;
  if (p.kind === "vimeo") return `https://player.vimeo.com/video/${p.id}`;
  return null;
}

export function guideVideoWidgetHTML(videoKey, { compact = false } = {}) {
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
  const embed = embedUrl(v.src);
  if (embed) {
    return `<div class="guide-video-frame${size}"><iframe src="${escapeHtml(embed)}" title="${escapeHtml(v.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>`;
  }
  return `<div class="guide-video-frame${size}"><video src="${escapeHtml(v.src)}" controls playsinline preload="metadata"></video></div>`;
}

// The player, as a modal, in two states: watching (the video plus a Lewati
// button) and, once it ends or is skipped, the three answers. `onTour` is
// what "masih mau tur website" runs; by default it presses this page's own
// Panduan button, which is exactly what the closing bubble will point at.
export function openGuideVideo(videoKey, { onTour = startPageTour, hint = true } = {}) {
  const v = GUIDE_VIDEOS[videoKey];
  if (!v) return null;
  const real = !!v.src && !isPlaceholder(v.src);
  const overlay = openModal({
    title: v.title,
    wide: true,
    bodyHTML: `
      <div data-video-stage>${guideVideoWidgetHTML(videoKey)}</div>
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
    else ending = setTimeout(showChoices, Math.max(5, Number(v.seconds) || 60) * 1000);
  };

  overlay.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest("[data-vc]") : null;
    if (!btn) return;
    const what = btn.dataset.vc;
    if (what === "skip") return showChoices();
    if (what === "replay") {
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
  openGuideVideo("kenalan", { onTour: () => import("./tour.js").then((m) => m.startOnboardingTour()), hint: true });
}

// The "Video" pill next to a page's "?" (js/help.js helpButtonHTML) — same
// icon-button language, so the two read as a pair. Empty when that page has
// no video. Never opens on its own; only a click (via the delegated
// listener below) or an explicit openGuideVideo() call shows the modal.
export function guideVideoButtonHTML(guideKey) {
  if (!videoKeyForGuide(guideKey)) return "";
  return `<button type="button" class="icon-btn help-btn section-video-btn" data-guide-video-btn="${escapeHtml(guideKey)}" title="${t("guide.video.btnTitle")}" aria-label="${t("guide.video.btnTitle")}">${icon("play", { size: 14 })}<span>Video</span></button>`;
}

// One delegated listener for every Video button, so pages don't each need
// to wire it after every repaint.
if (typeof window !== "undefined" && !window.__guideVideoClickWired) {
  window.__guideVideoClickWired = true;
  document.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest("[data-guide-video-btn]") : null;
    if (!btn) return;
    const key = videoKeyForGuide(btn.dataset.guideVideoBtn);
    if (key) openGuideVideo(key);
  });
}
