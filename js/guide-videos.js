// Short explainer videos, one per big page. Every one of them works the same
// way, on purpose:
//   - It takes the screen, by itself, the first time that page is opened —
//     a big player in a modal, not a card someone has to notice and accept.
//     That is the whole point: the person who most needs the explanation is
//     the one least likely to go looking for it.
//   - It can be skipped at any moment ("Lewati video").
//   - When it ends (or is skipped) the same modal asks what's next, in three
//     answers: play it again, take the live tour of this page instead, or
//     "saya sudah paham".
//   - Whichever way it closes, a bubble points at the "Video" button next to
//     Panduan and says the explainer lives there from now on — so the way
//     back is shown once, not left to be discovered.
// Shown once per page per account (videoSeen); after that only the Video
// button opens it, as many times as wanted.
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
// it as a real src — the video auto-plays / is offered / is replayable — and
// only the player itself knows to draw the pending panel instead.
export const PLACEHOLDER_SRC = "placeholder";
const isPlaceholder = (src) => src === PLACEHOLDER_SRC;

// `seconds` is the declared length, used only as the safety net for the watch
// gate (see wireWatchGate): if the YouTube/Vimeo player API can't load we
// unlock after that many seconds instead of leaving the user stuck. Keep it
// roughly in sync with `duration` when a real video is published.
export const GUIDE_VIDEOS = {
  kenalan: { title: t("guide.video.kenalan"), duration: t("guide.video.min", { n: 2 }), seconds: 120, src: PLACEHOLDER_SRC },
  creator: { title: t("guide.video.creator"), duration: t("guide.video.sec", { n: 90 }), seconds: 90, src: PLACEHOLDER_SRC },
  "brand-dna": { title: t("guide.video.brandDna"), duration: t("guide.video.sec", { n: 90 }), seconds: 90, src: PLACEHOLDER_SRC },
  "brand-guidelines": { title: t("guide.video.brandGuidelines"), duration: t("guide.video.sec", { n: 60 }), seconds: 60, src: PLACEHOLDER_SRC },
  campaign: { title: t("guide.video.campaign"), duration: t("guide.video.sec", { n: 90 }), seconds: 90, src: PLACEHOLDER_SRC },
  kalender: { title: t("guide.video.kalender"), duration: t("guide.video.sec", { n: 60 }), seconds: 60, src: PLACEHOLDER_SRC },
  "konten-dashboard": { title: t("guide.video.kontenDashboard"), duration: t("guide.video.sec", { n: 90 }), seconds: 90, src: PLACEHOLDER_SRC },
  copy: { title: t("guide.video.copy"), duration: t("guide.video.sec", { n: 60 }), seconds: 60, src: PLACEHOLDER_SRC },
};

// Guide/Panduan key → video key. Content OS shares one Panduan button across
// its sub-tabs, so it resolves from the current route.
const GUIDE_TO_VIDEO = {
  onboarding: "kenalan",
  "beginner-home": "kenalan",
  "brand-builder": "brand-dna",
  "brand-dna": "brand-dna",
  "brand-guidelines": "brand-guidelines",
  campaigns: "campaign",
  "campaign-list": "campaign",
  "campaign-detail": "campaign",
  calendar: "kalender",
  creator: "creator",
  "copy-studio": "copy",
};

export function videoKeyForGuide(guideKey) {
  if (guideKey === "content-os") {
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

// ---------- Auto-play, once per account ----------
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

// Forgets every "already shown this one" mark, so the whole set of videos
// introduces itself again on this account. Meant for testing while the
// entries are still placeholders — from the console:
//   (await import("./js/guide-videos.js")).resetVideoSeen()
export function resetVideoSeen() {
  const keys = Object.keys(GUIDE_VIDEOS);
  keys.forEach((k) => clearFlag(VIDEO_SEEN_PREFIX, k));
  const seen = { ...(getSettings()?.guideSeen || {}) };
  keys.forEach((k) => delete seen[seenKey(k)]);
  if (!isReadOnly(getCachedAccount())) updateSettings({ guideSeen: seen });
  return keys.length;
}

// Something else already has the screen: a modal/drawer, the teleprompter,
// or a running tour. Checked through the DOM rather than by importing
// tour.js, which imports this module back.
function screenIsBusy() {
  if (typeof document === "undefined") return false;
  return !!document.querySelector(".overlay, .tp-overlay") || document.body.classList.contains("tour-active");
}

// Call from a page's render() once its DOM is painted. Opens the player once
// ever per account, then never again on its own — the Video button next to
// Panduan is the way back to it. Returns true only when it actually opened,
// so a caller can skip its own tour/banner for this visit.
export function maybeAutoPlayVideo(videoKey, { tries = 20 } = {}) {
  const v = videoKey ? GUIDE_VIDEOS[videoKey] : null;
  // Every "nothing happened" path says why in the console. This is the one
  // moment in the app nobody can ask to see again if it silently no-ops, so
  // a skipped showing has to be diagnosable from a screen recording instead
  // of guessed at.
  const skip = (why) => {
    console.info(`[video] "${videoKey}" tidak diputar otomatis: ${why}`);
    return false;
  };
  if (!v) return skip("tidak ada entri video dengan key ini");
  if (!v.src) return skip("entri ini belum punya src");
  // Stays unseen when it can't play, so it still gets its one automatic
  // showing another time.
  if (videoSeen(videoKey)) return skip("sudah pernah tampil di akun ini");
  // Something else has the screen (a modal, the teleprompter, a running
  // tour). Don't drop the showing — wait for the screen and take it then.
  if (screenIsBusy()) {
    if (tries <= 0) return skip("layar tetap sibuk, menyerah");
    setTimeout(() => maybeAutoPlayVideo(videoKey, { tries: tries - 1 }), 400);
    return false;
  }
  markVideoSeen(videoKey);
  openGuideVideo(videoKey);
  return true;
}

// ---------- "You can play it again here" ----------
// Said once, right after the video closes, pointing at the Video button next
// to Panduan — the button is small and lives in the page eyebrow, so being
// told where it is beats being expected to spot it.
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


// Rendered next to Panduan; empty when that page has no video.
export function guideVideoButtonHTML(guideKey) {
  if (!videoKeyForGuide(guideKey)) return "";
  return `<button type="button" class="section-guide-btn section-video-btn" data-guide-video-btn="${escapeHtml(guideKey)}" title="${t("guide.video.btnTitle")}" aria-label="${t("guide.video.btnTitle")}">${icon("play", { size: 14 })}<span>Video</span></button>`;
}

// ---------- Watch gate ----------
// NOT CURRENTLY USED by any screen: the intro modal dropped it when the
// explainer videos moved to "plays once by itself, replay from the Video
// button" (maybeAutoPlayVideo above), which is deliberately skippable. Kept
// because it's the whole "they have to actually watch it" mechanism, ready
// for a screen that needs one. Wire it up with the same two calls:
//
//   bodyHTML: watchGateHTML("kenalan")
//   wireWatchGate(overlay, "kenalan", { onWatched, onFallback })
//
// Per source type:
//   - self-hosted mp4/webm: the <video>'s own `ended` event, plus a
//     furthest-watched guard that snaps a forward seek back (you can rewind
//     and re-watch, you just can't jump ahead), and no download button.
//   - YouTube: the IFrame Player API, state ENDED (0). Progress and the
//     seek guard come from polling, since the API has no `seeked` event.
//   - Vimeo: the Player API's `ended` / `timeupdate` / `seeked` events.
// If the external API script is blocked or offline we can't observe the
// player at all, so we fall back to a plain countdown over the entry's
// declared `seconds` and say so in the status line — the caller gets
// onFallback and should offer its own escape hatch too.
const YT_API = "https://www.youtube.com/iframe_api";
const VIMEO_API = "https://player.vimeo.com/api/player.js";
const apiCache = new Map();

function loadPlayerApi(src, ready, timeoutMs = 12000) {
  if (ready()) return Promise.resolve();
  let p = apiCache.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      let iv = null;
      const stop = () => { if (iv) clearInterval(iv); iv = null; };
      const started = Date.now();
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.addEventListener("error", () => { stop(); reject(new Error(`video API failed to load: ${src}`)); });
      document.head.appendChild(s);
      // The script tag loading isn't the same as the global being usable
      // (YT publishes window.YT.Player a beat later), so poll for `ready`.
      iv = setInterval(() => {
        if (ready()) { stop(); resolve(); }
        else if (Date.now() - started > timeoutMs) { stop(); reject(new Error(`video API timed out: ${src}`)); }
      }, 120);
    });
    apiCache.set(src, p);
    p.catch(() => apiCache.delete(src));
  }
  return p;
}

function fmtClock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

let gateSeq = 0;

// Returns "" when the video has no src yet, so callers can simply check for
// an empty string and keep their old ungated behaviour.
export function watchGateHTML(videoKey, { compact = false } = {}) {
  const v = GUIDE_VIDEOS[videoKey];
  if (!v || !v.src || isPlaceholder(v.src)) return "";
  const p = parseVideoSrc(v.src);
  const id = `watch-gate-${++gateSeq}`;
  const title = escapeHtml(v.title);
  const frameAllow = `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`;
  let player;
  if (p.kind === "youtube") {
    const origin = typeof location !== "undefined" && location.origin && location.origin !== "null"
      ? `&origin=${encodeURIComponent(location.origin)}` : "";
    const src = `https://www.youtube.com/embed/${p.id}?rel=0&modestbranding=1&playsinline=1&enablejsapi=1${origin}`;
    player = `<iframe data-gate-player id="${id}-player" src="${escapeHtml(src)}" title="${title}" ${frameAllow} allowfullscreen></iframe>`;
  } else if (p.kind === "vimeo") {
    player = `<iframe data-gate-player id="${id}-player" src="${escapeHtml(`https://player.vimeo.com/video/${p.id}`)}" title="${title}" ${frameAllow} allowfullscreen></iframe>`;
  } else {
    player = `<video data-gate-player id="${id}-player" src="${escapeHtml(v.src)}" title="${title}" controls controlsList="nodownload noplaybackrate" disablepictureinpicture playsinline preload="metadata"></video>`;
  }
  return `
    <div class="watch-gate" id="${id}" data-watch-gate="${escapeHtml(videoKey)}">
      <div class="guide-video-frame watch-gate-frame${compact ? " is-compact" : ""}">${player}</div>
      <div class="watch-gate-bar" data-gate-bar role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="${t("guide.gate.progressAria")}"><span data-gate-fill></span></div>
      <p class="watch-gate-status" data-gate-status role="status">${t("guide.gate.hint")}</p>
    </div>`;
}

// `handlers` is either onWatched(reason) or { onWatched, onFallback }.
// onWatched runs at most once, with "ended" (really watched) or "timer"
// (the API never loaded and the declared duration elapsed).
export function wireWatchGate(root, videoKey, handlers) {
  const cb = typeof handlers === "function" ? { onWatched: handlers } : (handlers || {});
  const sel = `[data-watch-gate="${videoKey}"]`;
  const gate = root && root.matches && root.matches(sel) ? root : root && root.querySelector ? root.querySelector(sel) : null;
  const v = GUIDE_VIDEOS[videoKey];
  const el = gate ? gate.querySelector("[data-gate-player]") : null;
  if (!gate || !el || !v || !v.src) return null;

  const bar = gate.querySelector("[data-gate-bar]");
  const fill = gate.querySelector("[data-gate-fill]");
  const statusEl = gate.querySelector("[data-gate-status]");
  const declared = Number(v.seconds) || 0;
  let total = declared;
  let furthest = 0;
  let done = false;
  let poll = null;
  let countdown = null;

  let lastSaid = "";
  let holdUntil = 0; // keeps a transient message ("no skipping") readable
  const say = (html) => {
    if (!statusEl || html === lastSaid) return;
    lastSaid = html;
    statusEl.innerHTML = html;
  };
  const stopTimers = () => {
    if (poll) clearInterval(poll);
    if (countdown) clearInterval(countdown);
    poll = countdown = null;
  };
  const setProgress = (cur, dur) => {
    const d = Number(dur) || total || 0;
    const pct = d > 0 ? Math.max(0, Math.min(100, (cur / d) * 100)) : 0;
    if (fill) fill.style.width = `${pct}%`;
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(pct)));
    if (!done && d > 0 && Date.now() > holdUntil) {
      say(`${t("guide.gate.hint")} <b>${t("guide.gate.remaining", { time: fmtClock(d - cur) })}</b>`);
    }
  };
  const finish = (reason) => {
    if (done) return;
    done = true;
    stopTimers();
    gate.classList.add("is-watched");
    if (fill) fill.style.width = "100%";
    if (bar) bar.setAttribute("aria-valuenow", "100");
    say(t("guide.gate.done"));
    try { cb.onWatched?.(reason); } catch (e) { console.warn("watch gate onWatched failed", e); }
  };
  // The player can't be observed — count the declared duration down instead
  // of locking the user out of the app.
  const fallback = (why) => {
    if (done || countdown) return;
    console.warn("watch gate falling back to a timer", why);
    gate.classList.add("is-fallback");
    const started = Date.now();
    const tick = () => {
      if (!gate.isConnected) { stopTimers(); return; }
      const left = declared - (Date.now() - started) / 1000;
      const pct = declared > 0 ? Math.max(0, Math.min(100, (1 - left / declared) * 100)) : 100;
      if (fill) fill.style.width = `${pct}%`;
      if (bar) bar.setAttribute("aria-valuenow", String(Math.round(pct)));
      if (left <= 0) finish("timer");
      else say(t("guide.gate.failed", { time: fmtClock(left) }));
    };
    countdown = setInterval(tick, 1000);
    tick();
    try { cb.onFallback?.(why); } catch (e) { console.warn("watch gate onFallback failed", e); }
  };
  const noSkip = () => {
    if (done) return;
    holdUntil = Date.now() + 2500;
    say(t("guide.gate.noSkip"));
  };

  const kind = parseVideoSrc(v.src).kind;

  if (kind === "file") {
    let snapping = false;
    el.addEventListener("loadedmetadata", () => {
      if (isFinite(el.duration) && el.duration > 0) total = el.duration;
      setProgress(0, total);
    });
    el.addEventListener("timeupdate", () => {
      if (!snapping && el.currentTime > furthest) furthest = el.currentTime;
      setProgress(furthest, el.duration || total);
    });
    el.addEventListener("seeking", () => {
      if (done || snapping) return;
      if (el.currentTime > furthest + 1.2) { snapping = true; el.currentTime = furthest; noSkip(); }
    });
    el.addEventListener("seeked", () => { snapping = false; });
    el.addEventListener("ended", () => finish("ended"));
    el.addEventListener("error", () => fallback("media error"));
    setProgress(0, total);
  } else if (kind === "youtube") {
    setProgress(0, total);
    loadPlayerApi(YT_API, () => !!(window.YT && window.YT.Player))
      .then(() => {
        const player = new window.YT.Player(el, {
          events: {
            onReady: () => {
              total = Number(player.getDuration?.()) || total;
              poll = setInterval(() => {
                if (!gate.isConnected) { stopTimers(); return; }
                const dur = Number(player.getDuration?.()) || total;
                const cur = Number(player.getCurrentTime?.()) || 0;
                if (cur > furthest + 2.5) { try { player.seekTo(furthest, true); } catch (e) { /* ignore */ } noSkip(); }
                else if (cur > furthest) furthest = cur;
                setProgress(furthest, dur);
              }, 500);
            },
            onStateChange: (e) => { if (e && e.data === 0) finish("ended"); },
            onError: () => fallback("youtube player error"),
          },
        });
      })
      .catch((e) => fallback(e));
  } else if (kind === "vimeo") {
    setProgress(0, total);
    loadPlayerApi(VIMEO_API, () => !!(window.Vimeo && window.Vimeo.Player))
      .then(() => {
        const player = new window.Vimeo.Player(el);
        player.getDuration().then((d) => { total = Number(d) || total; }).catch(() => {});
        player.on("timeupdate", (d) => {
          if (d && d.seconds > furthest) furthest = d.seconds;
          setProgress(furthest, (d && d.duration) || total);
        });
        player.on("seeked", (d) => {
          if (done || !d) return;
          if (d.seconds > furthest + 1.5) { player.setCurrentTime(furthest).catch(() => {}); noSkip(); }
        });
        player.on("ended", () => finish("ended"));
        player.on("error", () => fallback("vimeo player error"));
      })
      .catch((e) => fallback(e));
  }

  return {
    isWatched: () => done,
    stop: stopTimers,
  };
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
