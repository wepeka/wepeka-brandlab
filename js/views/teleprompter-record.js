import { icon } from "../icons.js";
import { escapeHtml } from "../dom.js";
import { t, getLang } from "../i18n.js";

// Record mode for the teleprompter (opened from js/views/teleprompter.js):
// the front camera fills the screen, the script rolls in a narrow band at
// the very top — right under the lens, so the eyes stay near the camera
// while reading — with a big record button, a 3-2-1 countdown, and the text
// starting to roll the moment recording starts. MediaRecorder records the
// camera, never the screen: the text and the buttons never end up in the
// video. "Video cermin" (on by default, owner's ask 2026-10-15) saves the
// file mirrored like the preview, by drawing each camera frame flipped onto
// a canvas and recording that. Phone and laptop webcam work the same way.

const PREFS_KEY = "contentos:tp-rec";
// Long takes live in memory until they're saved; a phone browser tab that
// holds several hundred MB can get killed and lose the whole take.
const MAX_MS = 10 * 60 * 1000;
// Speed is words per second, not pixels: the band is narrow and the text
// size changes, so "4" should read at the same pace whatever the layout.
const WORDS_PER_SEC_PER_STEP = 0.7;

// First one the browser can record wins. MP4 first: iPhone Safari (14.3+)
// only records MP4, recent Chrome does too, and MP4 is what Instagram,
// TikTok and every gallery app take without fuss. WebM is the fallback for
// browsers that can't.
export const RECORDING_TYPES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function pickRecordingType(isSupported = (type) => globalThis.MediaRecorder?.isTypeSupported?.(type)) {
  for (const type of RECORDING_TYPES) {
    try {
      if (isSupported(type)) return type;
    } catch {
      /* some browsers throw on codec strings they don't know */
    }
  }
  return "";
}

export function recordingExtension(type = "") {
  if (/mp4/i.test(type)) return "mp4";
  if (/matroska/i.test(type)) return "mkv";
  return "webm";
}

export function recordingFileName(title, type, now = new Date()) {
  const slug =
    String(title || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "video";
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `brandlab-${slug}-${stamp}.${recordingExtension(type)}`;
}

// getUserMedia's error names → which help text to show.
export function cameraErrorKind(err) {
  const name = String(err?.name || "");
  if (/NotAllowed|Security|PermissionDenied/.test(name)) return "denied";
  if (/NotFound|DevicesNotFound|Overconstrained/.test(name)) return "notFound";
  if (/NotReadable|TrackStart|Abort/.test(name)) return "busy";
  return "generic";
}

// iPadOS reports itself as a Mac; the touch points give it away (checked
// after Android, whose UA always says so).
export function devicePlatform(nav = globalThis.navigator || {}) {
  const ua = String(nav.userAgent || "");
  if (/Android/i.test(ua)) return "android";
  if (/iPad|iPhone|iPod/.test(ua) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1)) return "ios";
  return "desktop";
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatSize(bytes) {
  const mb = bytes / (1024 * 1024);
  const n = mb.toLocaleString(getLang() === "en" ? "en-US" : "id-ID", { maximumFractionDigits: mb >= 10 ? 0 : 1 });
  return `${n} MB`;
}

function loadPrefs(phone) {
  const fallback = { speed: 4, size: phone ? 26 : 30, sliders: true, mirror: true };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    return saved && typeof saved === "object" ? { ...fallback, ...saved } : fallback;
  } catch {
    return fallback;
  }
}
function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode — the settings still hold for this take */
  }
}

export function openRecordMode({ text = "", title = "", onExit } = {}) {
  const platform = devicePlatform();
  const phone = platform !== "desktop" || !!globalThis.matchMedia?.("(pointer: coarse)").matches;
  const prefs = loadPrefs(phone);
  const hasText = !!text.trim();
  const preferredType = pickRecordingType();
  const wordCount = Math.max(1, (text.match(/\S+/g) || []).length);

  const el = document.createElement("div");
  el.className = "tpr";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", t("tp.rec.label"));
  el.style.setProperty("--tpr-size", `${prefs.size}px`);
  el.innerHTML = `
    <video class="tpr-cam" playsinline muted autoplay></video>
    <div class="tpr-top">
      <div class="tpr-band" id="tpr-band" title="${t("tp.rec.tapText")}">
        <div class="tpr-scroll" id="tpr-scroll">
          <div class="tpr-text" id="tpr-text">${hasText ? escapeHtml(text) : `<span class="tpr-faint">${t("tp.noScript")}</span>`}</div>
        </div>
      </div>
      <div class="tpr-status">
        <span class="tpr-timer" id="tpr-timer" hidden><i></i><span id="tpr-time">0:00</span></span>
        <button type="button" class="tpr-chip" id="tpr-roll" ${hasText ? "" : "hidden"}></button>
        <button type="button" class="tpr-chip" id="tpr-top" hidden>${icon("refresh", { size: 13 })}<span>${t("tp.rec.fromTop")}</span></button>
      </div>
      <p class="tpr-hint" id="tpr-hint" hidden></p>
    </div>
    <div class="tpr-count" id="tpr-count" hidden aria-live="assertive"></div>
    <div class="tpr-bottom" id="tpr-bottom">
      <div class="tpr-sliders" id="tpr-sliders" ${prefs.sliders ? "" : "hidden"}>
        <label class="tpr-slider"><span>${t("tp.speed")}</span><input type="range" id="tpr-speed" min="1" max="10" step="0.5" value="${prefs.speed}" /></label>
        <label class="tpr-slider"><span>${t("tp.size")}</span><input type="range" id="tpr-size" min="18" max="48" value="${prefs.size}" /></label>
        <div class="tpr-slider tpr-switch-row">
          <span id="tpr-mirror-label">${t("tp.rec.mirror")}</span>
          <small class="tpr-switch-state" id="tpr-mirror-state">${t(prefs.mirror ? "tp.rec.on" : "tp.rec.off")}</small>
          <button type="button" class="tpr-switch" id="tpr-mirror" role="switch" aria-checked="${prefs.mirror}" aria-labelledby="tpr-mirror-label"><i></i></button>
        </div>
      </div>
      <div class="tpr-bar">
        <button type="button" class="tpr-round" id="tpr-exit" aria-label="${t("tp.rec.exit")}" title="${t("tp.rec.exit")}">${icon("x", { size: 20 })}</button>
        <button type="button" class="tpr-rec" id="tpr-rec" aria-label="${t("tp.rec.start")}" disabled><span></span></button>
        <button type="button" class="tpr-round tpr-aa" id="tpr-aa" aria-label="${t("tp.rec.settings")}" title="${t("tp.rec.settings")}" aria-expanded="${prefs.sliders}">${icon("gear", { size: 20 })}</button>
      </div>
    </div>
    <div class="tpr-msg" id="tpr-msg" hidden>
      <div class="tpr-msg-card" role="alert">
        <h3 id="tpr-msg-title"></h3>
        <p id="tpr-msg-body"></p>
        <div class="tpr-msg-actions" id="tpr-msg-actions">
          <button type="button" class="btn btn-primary" id="tpr-retry">${icon("refresh", { size: 14 })}<span>${t("tp.rec.retry")}</span></button>
          <button type="button" class="btn btn-secondary" id="tpr-back">${t("tp.rec.back")}</button>
        </div>
      </div>
    </div>
    <div class="tpr-review" id="tpr-review" hidden>
      <div class="tpr-review-card">
        <div class="tpr-review-head">
          <strong>${t("tp.rec.review")}</strong>
          <span class="tpr-review-meta" id="tpr-meta"></span>
          <button type="button" class="icon-btn" id="tpr-review-close" aria-label="${t("tp.rec.exit")}">${icon("x", { size: 18 })}</button>
        </div>
        <video class="tpr-playback" id="tpr-playback" controls playsinline></video>
        <p class="tpr-note" id="tpr-note"></p>
        <div class="tpr-confirm" id="tpr-confirm" hidden>
          <span>${t("tp.rec.discardAsk")}</span>
          <div class="tpr-confirm-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="tpr-keep">${t("tp.rec.keep")}</button>
            <button type="button" class="btn btn-danger btn-sm" id="tpr-discard">${t("tp.rec.discard")}</button>
          </div>
        </div>
        <div class="tpr-review-actions">
          <button type="button" class="btn btn-primary" id="tpr-save">${icon("download", { size: 15 })}<span>${t(phone ? "tp.rec.save.phone" : "tp.rec.save.desktop")}</span></button>
          <button type="button" class="btn btn-secondary" id="tpr-share" hidden>${icon("send", { size: 15 })}<span>${t("tp.rec.share")}</span></button>
          <button type="button" class="btn btn-ghost" id="tpr-retake">${icon("refresh", { size: 15 })}<span>${t("tp.rec.retake")}</span></button>
        </div>
        <p class="tpr-save-hint" id="tpr-save-hint">${t(`tp.rec.saveHint.${platform}`)}</p>
        <p class="tpr-saved" id="tpr-saved" role="status"></p>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  const $ = (sel) => el.querySelector(sel);
  const cam = $(".tpr-cam");
  const band = $("#tpr-band");
  const scrollEl = $("#tpr-scroll");
  const textEl = $("#tpr-text");
  const timerEl = $("#tpr-timer");
  const timeEl = $("#tpr-time");
  const rollBtn = $("#tpr-roll");
  const topBtn = $("#tpr-top");
  const hintEl = $("#tpr-hint");
  const countEl = $("#tpr-count");
  const bottomEl = $("#tpr-bottom");
  const slidersEl = $("#tpr-sliders");
  const speedInput = $("#tpr-speed");
  const sizeInput = $("#tpr-size");
  const exitBtn = $("#tpr-exit");
  const recBtn = $("#tpr-rec");
  const aaBtn = $("#tpr-aa");
  const mirrorBtn = $("#tpr-mirror");
  const mirrorState = $("#tpr-mirror-state");
  const noteEl = $("#tpr-note");
  const msgEl = $("#tpr-msg");
  const msgTitle = $("#tpr-msg-title");
  const msgBody = $("#tpr-msg-body");
  const msgActions = $("#tpr-msg-actions");
  const reviewEl = $("#tpr-review");
  const playback = $("#tpr-playback");
  const metaEl = $("#tpr-meta");
  const confirmEl = $("#tpr-confirm");
  const shareBtn = $("#tpr-share");
  const savedEl = $("#tpr-saved");

  // starting → live → countdown → recording → finishing → review
  // (error can replace starting/live; retake goes review → live).
  let state = "starting";
  let stream = null;
  let recorder = null;
  let chunks = [];
  let blob = null;
  let blobUrl = "";
  let fileName = "";
  let saved = false;
  let startedAt = 0;
  let elapsed = 0;
  let timerId = null;
  let countdownTimer = null;
  let closed = false;
  let noMic = false;
  let hitMax = false;
  let pendingDiscard = null;
  let enteredFullscreen = false;
  let takeMirrored = false;
  let stopMirror = null;

  // ---- Rolling text ----
  // Our own float position, written to scrollTop each frame: scrollTop
  // rounds on some screens, and at slow speeds a frame's step is under a
  // pixel — rounding alone would freeze the text.
  let rolling = false;
  let raf = null;
  let lastTs = null;
  let pos = 0;
  let pxPerWord = 0;

  const maxScroll = () => Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
  function measure() {
    pxPerWord = textEl.offsetHeight / wordCount;
  }
  function roll(ts) {
    if (!rolling) return;
    if (lastTs === null) lastTs = ts;
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    if (!pxPerWord) measure();
    const end = maxScroll();
    pos = Math.min(end, pos + prefs.speed * WORDS_PER_SEC_PER_STEP * pxPerWord * dt);
    scrollEl.scrollTop = pos;
    if (pos >= end - 1) {
      stopRolling();
      if (state === "recording") showHint(t("tp.rec.textEnd"));
      return;
    }
    raf = requestAnimationFrame(roll);
  }
  function startRolling() {
    if (!hasText || rolling) return;
    if (pos >= maxScroll() - 1) jumpTo(0);
    rolling = true;
    lastTs = null;
    raf = requestAnimationFrame(roll);
    paintChips();
  }
  function stopRolling() {
    rolling = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    paintChips();
  }
  function jumpTo(y) {
    pos = y;
    scrollEl.scrollTop = y;
    paintChips();
  }
  function paintChips() {
    rollBtn.innerHTML = rolling
      ? `${icon("pause", { size: 13 })}<span>${t("tp.rec.pauseText")}</span>`
      : `${icon("play", { size: 13 })}<span>${t("tp.rec.runText")}</span>`;
    rollBtn.hidden = !hasText || !["live", "recording"].includes(state);
    topBtn.hidden = !hasText || state !== "live" || rolling || pos < 2;
  }
  scrollEl.addEventListener("scroll", () => {
    // A finger dragging the text moves our position along with it.
    if (Math.abs(scrollEl.scrollTop - pos) > 2) {
      pos = scrollEl.scrollTop;
      paintChips();
    }
  });
  const toggleRolling = () => (rolling ? stopRolling() : startRolling());
  band.addEventListener("click", () => {
    if (state === "live" || state === "recording") toggleRolling();
  });
  rollBtn.addEventListener("click", toggleRolling);
  topBtn.addEventListener("click", () => jumpTo(0));

  // ---- Settings (speed, size) — usable while recording too ----
  speedInput.addEventListener("input", () => {
    prefs.speed = Number(speedInput.value);
    savePrefs(prefs);
  });
  sizeInput.addEventListener("input", () => {
    const ratio = textEl.offsetHeight ? pos / textEl.offsetHeight : 0;
    prefs.size = Number(sizeInput.value);
    el.style.setProperty("--tpr-size", `${prefs.size}px`);
    measure();
    jumpTo(Math.min(maxScroll(), ratio * textEl.offsetHeight));
    savePrefs(prefs);
  });
  mirrorBtn.addEventListener("click", () => {
    prefs.mirror = !prefs.mirror;
    mirrorBtn.setAttribute("aria-checked", String(prefs.mirror));
    mirrorState.textContent = t(prefs.mirror ? "tp.rec.on" : "tp.rec.off");
    savePrefs(prefs);
  });
  aaBtn.addEventListener("click", () => {
    slidersEl.hidden = !slidersEl.hidden;
    prefs.sliders = !slidersEl.hidden;
    aaBtn.setAttribute("aria-expanded", String(prefs.sliders));
    savePrefs(prefs);
  });

  function showHint(textValue) {
    hintEl.textContent = textValue;
    hintEl.hidden = !textValue;
  }
  function idleHint() {
    const lines = [t(phone ? "tp.rec.hint.phone" : "tp.rec.hint.desktop")];
    if (!phone) lines.push(t("tp.rec.hint.space"));
    if (noMic) lines.push(t("tp.rec.noMic"));
    if (hitMax) lines.push(t("tp.rec.maxReached"));
    return lines.join(" ");
  }

  function setState(next) {
    state = next;
    el.dataset.state = next;
    el.classList.toggle("is-recording", next === "recording" || next === "finishing");
    el.classList.toggle("is-countdown", next === "countdown");
    const label = next === "recording" ? t("tp.rec.stop") : next === "countdown" ? t("tp.rec.cancel") : t("tp.rec.start");
    recBtn.setAttribute("aria-label", label);
    recBtn.title = label;
    recBtn.disabled = !["live", "countdown", "recording"].includes(next);
    exitBtn.hidden = next === "recording" || next === "finishing" || next === "countdown";
    // The file is mirrored or not from its first frame: no switching mid-take.
    mirrorBtn.disabled = next === "recording" || next === "finishing" || next === "countdown";
    timerEl.hidden = !(next === "recording" || next === "finishing");
    bottomEl.hidden = next === "review";
    reviewEl.hidden = next !== "review";
    countEl.hidden = next !== "countdown";
    if (next === "live") showHint(idleHint());
    else if (next !== "recording") showHint("");
    paintChips();
  }

  function showMessage({ title: heading, body = "", actions = true }) {
    msgTitle.textContent = heading;
    msgBody.textContent = body;
    msgBody.hidden = !body;
    msgActions.hidden = !actions;
    msgEl.hidden = false;
  }
  function hideMessage() {
    msgEl.hidden = true;
  }
  function showError(kind) {
    if (closed) return;
    stopStream();
    setState("error");
    const body = kind === "denied" ? t(`tp.rec.err.denied.${platform}`) : t(`tp.rec.err.${kind}.body`);
    showMessage({ title: t(`tp.rec.err.${kind}.title`), body });
    $("#tpr-retry").hidden = kind === "unsupported";
  }

  // ---- Camera ----
  function stopStream() {
    if (stream) stream.getTracks().forEach((tr) => tr.stop());
    stream = null;
    cam.srcObject = null;
  }
  function onTrackEnded() {
    if (closed) return;
    if (state === "recording") stopRecording();
    else if (state === "live" || state === "countdown") showError("generic");
  }
  async function startCamera() {
    stopStream();
    setState("starting");
    showMessage({ title: t("tp.rec.starting"), body: t("tp.rec.startingHint"), actions: false });
    const media = globalThis.navigator?.mediaDevices;
    if (!media?.getUserMedia || typeof globalThis.MediaRecorder === "undefined") return showError("unsupported");
    // Landscape numbers on purpose: phones swap them for an upright screen,
    // so this asks for 1080×1920 portrait on a phone and 1080p on a laptop.
    const video = { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
    noMic = false;
    let s = null;
    try {
      s = await media.getUserMedia({ video, audio: true });
    } catch (err) {
      try {
        if (err?.name === "OverconstrainedError") s = await media.getUserMedia({ video: { facingMode: "user" }, audio: true });
        else if (err?.name === "NotFoundError") {
          // No microphone (a desktop without one): record picture only and say so.
          s = await media.getUserMedia({ video, audio: false });
          noMic = true;
        } else throw err;
      } catch (err2) {
        return showError(cameraErrorKind(err2));
      }
    }
    if (closed) {
      s.getTracks().forEach((tr) => tr.stop());
      return;
    }
    stream = s;
    cam.muted = true;
    cam.srcObject = s;
    cam.play?.()?.catch?.(() => {});
    s.getVideoTracks()[0]?.addEventListener("ended", onTrackEnded);
    keepAwake(true);
    hideMessage();
    setState("live");
    measure();
    recBtn.focus?.({ preventScroll: true });
  }

  // ---- Recording ----
  function onRecPress() {
    if (state === "live") startCountdown();
    else if (state === "countdown") cancelCountdown();
    else if (state === "recording") stopRecording();
  }
  function startCountdown() {
    hitMax = false;
    setState("countdown");
    let n = 3;
    const tick = () => {
      if (closed || state !== "countdown") return;
      if (n === 0) {
        countEl.textContent = "";
        beginRecording();
        return;
      }
      // A fresh span each second restarts the pop animation.
      countEl.innerHTML = `<span>${n}</span>`;
      n -= 1;
      countdownTimer = setTimeout(tick, 1000);
    };
    tick();
  }
  function cancelCountdown() {
    clearTimeout(countdownTimer);
    countdownTimer = null;
    setState("live");
  }
  // Mirrored file: each new camera frame is drawn flipped onto a canvas and
  // the canvas is recorded together with the microphone. Falls back to the
  // plain camera (and says so on the review) where a canvas can't be
  // recorded or the frame size isn't known yet.
  function recordingStream() {
    takeMirrored = false;
    if (!prefs.mirror || typeof HTMLCanvasElement === "undefined" || !HTMLCanvasElement.prototype.captureStream) return stream;
    const w = cam.videoWidth;
    const h = cam.videoHeight;
    const canvas = document.createElement("canvas");
    const ctx = w && h ? canvas.getContext("2d") : null;
    if (!ctx) return stream;
    canvas.width = w;
    canvas.height = h;
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    let drawing = true;
    const nextFrame = () => (cam.requestVideoFrameCallback ? cam.requestVideoFrameCallback(draw) : requestAnimationFrame(draw));
    function draw() {
      if (!drawing) return;
      ctx.drawImage(cam, 0, 0, w, h);
      nextFrame();
    }
    draw();
    const out = canvas.captureStream(30);
    stream.getAudioTracks().forEach((tr) => out.addTrack(tr));
    stopMirror = () => {
      drawing = false;
      // Only the canvas track: the microphone belongs to the camera stream
      // and is needed again for a retake.
      out.getVideoTracks().forEach((tr) => tr.stop());
    };
    takeMirrored = true;
    return out;
  }
  function endMirror() {
    stopMirror?.();
    stopMirror = null;
  }
  function makeRecorder(s) {
    const options = { videoBitsPerSecond: 6_000_000 };
    if (preferredType) options.mimeType = preferredType;
    try {
      return new MediaRecorder(s, options);
    } catch {
      return new MediaRecorder(s);
    }
  }
  function beginRecording() {
    if (!stream) return showError("generic");
    chunks = [];
    try {
      recorder = makeRecorder(recordingStream());
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      recorder.onstop = finishRecording;
      recorder.onerror = () => {
        if (state === "recording") stopRecording();
      };
      recorder.start(1000);
    } catch {
      recorder = null;
      endMirror();
      setState("live");
      showHint(t("tp.rec.err.recordFailed"));
      return;
    }
    startedAt = performance.now();
    elapsed = 0;
    timeEl.textContent = formatDuration(0);
    timerId = setInterval(tickTimer, 250);
    setState("recording");
    startRolling();
  }
  function tickTimer() {
    elapsed = performance.now() - startedAt;
    timeEl.textContent = formatDuration(elapsed);
    if (elapsed >= MAX_MS) {
      hitMax = true;
      stopRecording();
    }
  }
  function stopRecording() {
    if (state !== "recording") return;
    clearInterval(timerId);
    timerId = null;
    elapsed = performance.now() - startedAt;
    stopRolling();
    setState("finishing");
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else finishRecording();
    } catch {
      finishRecording();
    }
  }
  function finishRecording() {
    endMirror();
    if (closed) return;
    const type = String(recorder?.mimeType || preferredType || "video/webm").split(";")[0] || "video/webm";
    const take = new Blob(chunks, { type });
    chunks = [];
    recorder = null;
    if (!take.size) {
      setState("live");
      showHint(t("tp.rec.err.recordFailed"));
      return;
    }
    blob = take;
    saved = false;
    fileName = recordingFileName(title, type);
    blobUrl = URL.createObjectURL(take);
    playback.src = blobUrl;
    metaEl.textContent = `${formatDuration(elapsed)} · ${formatSize(take.size)}`;
    savedEl.textContent = "";
    noteEl.textContent = t(takeMirrored ? "tp.rec.reviewNoteMirror" : prefs.mirror ? "tp.rec.mirrorUnsupported" : "tp.rec.reviewNote");
    confirmEl.hidden = true;
    shareBtn.hidden = platform !== "android" || !canShareFile(takeFile());
    setState("review");
  }

  // ---- Review: save, share, retake ----
  const takeFile = () => new File([blob], fileName, { type: blob.type || "video/mp4" });
  function canShareFile(file) {
    try {
      return !!globalThis.navigator?.canShare?.({ files: [file] });
    } catch {
      return false;
    }
  }
  function downloadTake() {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function markSaved(how) {
    saved = true;
    confirmEl.hidden = true;
    savedEl.textContent = how === "shared" ? t("tp.rec.done.shared") : t("tp.rec.done.download");
  }
  // iPhone: the share sheet is the only way into Photos ("Save Video");
  // a download lands in the Files app instead. Android and laptops:
  // a download goes straight to the Download folder (and the gallery).
  // Files only — adding a title or text to the share drops "Save Video"
  // from the iPhone sheet.
  $("#tpr-save").addEventListener("click", async () => {
    if (!blob) return;
    if (platform === "ios") {
      const file = takeFile();
      if (canShareFile(file)) {
        try {
          await navigator.share({ files: [file] });
          markSaved("shared");
          return;
        } catch (err) {
          if (err?.name === "AbortError") return;
        }
      }
    }
    downloadTake();
    markSaved("download");
  });
  shareBtn.addEventListener("click", async () => {
    if (!blob) return;
    try {
      await navigator.share({ files: [takeFile()] });
      markSaved("shared");
    } catch (err) {
      if (err?.name !== "AbortError") savedEl.textContent = t("tp.rec.shareFailed");
    }
  });
  function dropTake() {
    playback.pause?.();
    playback.removeAttribute("src");
    playback.load?.();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = "";
    blob = null;
    saved = false;
  }
  // An unsaved take asks once before it's thrown away.
  function whenDiscardOk(action) {
    if (!blob || saved) return action();
    pendingDiscard = action;
    confirmEl.hidden = false;
    $("#tpr-keep").focus?.();
  }
  $("#tpr-keep").addEventListener("click", () => {
    pendingDiscard = null;
    confirmEl.hidden = true;
  });
  $("#tpr-discard").addEventListener("click", () => {
    const action = pendingDiscard;
    pendingDiscard = null;
    confirmEl.hidden = true;
    action?.();
  });
  function retake() {
    dropTake();
    jumpTo(0);
    if (stream) setState("live");
    else startCamera();
  }
  $("#tpr-retake").addEventListener("click", () => whenDiscardOk(retake));
  $("#tpr-review-close").addEventListener("click", () => whenDiscardOk(exit));

  // ---- Screen awake, app switches, leaving ----
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
        });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {
      wakeLock = null;
    }
  }
  // Switching apps mid-take freezes the camera on phones: end the take
  // there so what was recorded is kept, instead of a frozen tail.
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      if (state === "recording") stopRecording();
      else if (state === "countdown") cancelCountdown();
    } else if (state === "live") {
      keepAwake(true);
      cam.play?.()?.catch?.(() => {});
    }
  };
  const onResize = () => measure();
  // Laptop: Space starts and stops a take wherever the focus is (the record
  // button handles its own Space; text fields keep theirs).
  const onKey = (e) => {
    if (e.key !== " " || e.repeat || e.target === recBtn) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "") && e.target.type !== "range") return;
    if (!["live", "countdown", "recording"].includes(state)) return;
    e.preventDefault();
    onRecPress();
  };
  // Moving to another page must never leave the camera on.
  const onLeave = () => exit();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", onResize);
  document.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", onLeave);
  window.addEventListener("pagehide", onLeave);

  function exit() {
    if (closed) return;
    closed = true;
    clearTimeout(countdownTimer);
    clearInterval(timerId);
    stopRolling();
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    recorder = null;
    chunks = [];
    endMirror();
    stopStream();
    dropTake();
    keepAwake(false);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("hashchange", onLeave);
    window.removeEventListener("pagehide", onLeave);
    if (enteredFullscreen && document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {});
    el.remove();
    onExit?.();
  }

  // Esc: leave when nothing is at stake; a running take only stops with
  // the stop button.
  function onEscape() {
    if (state === "countdown") cancelCountdown();
    else if (state === "review") {
      if (!confirmEl.hidden) confirmEl.hidden = true;
      else whenDiscardOk(exit);
    } else if (state !== "recording" && state !== "finishing") exit();
  }

  recBtn.addEventListener("click", onRecPress);
  exitBtn.addEventListener("click", exit);
  $("#tpr-retry").addEventListener("click", startCamera);
  $("#tpr-back").addEventListener("click", exit);

  // On a phone, full screen hides the browser's address bar so the text
  // band sits right under the camera. Asked for while the tap that opened
  // record mode still counts as a user gesture; iPhone Safari has no
  // full screen for pages and simply skips this.
  const root = document.documentElement;
  if (phone && root.requestFullscreen && !document.fullscreenElement) {
    try {
      root
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          enteredFullscreen = true;
          if (closed) document.exitFullscreen?.()?.catch?.(() => {});
        })
        .catch(() => {});
    } catch {
      /* not allowed here */
    }
  }

  paintChips();
  startCamera();
  return { close: exit, onEscape };
}
