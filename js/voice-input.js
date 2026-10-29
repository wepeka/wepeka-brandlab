// Voice typing — the Web Speech API built into Chrome, Edge and Safari: no
// AI provider, no key, no cost to Brandlab and nothing stored (only the
// words end up in the field, like typed text). Where it isn't supported
// (Firefox) the mic button is disabled, or not added at all.
//
// Pressing a mic opens one listening sheet: a live sound wave, the words
// appearing while the owner talks, and Selesai / Batal. Words land in the
// field on Selesai, so a half-heard sentence never gets into an idea.
// Chrome stops listening after a pause; the sheet quietly starts it again
// until the owner is done (up to MAX_MS).
import { toast } from "./dom.js";
import { icon } from "./icons.js";
import { t, getLang } from "./i18n.js";

const MAX_MS = 5 * 60 * 1000;
const BARS = 28;
const Recognition = () => window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = () => !!Recognition();
// Phones run speech recognition on the system recognizer, which loses the
// mic (or repeats words) when the page records at the same time — the wave
// there follows the recognizer's own speech events instead of real levels.
const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

let active = null;

export function wireMic(button, targetEl) {
  if (!voiceSupported()) {
    button.disabled = true;
    button.title = t("ai.voice.unsupported");
    return;
  }
  button.addEventListener("click", (e) => {
    e.preventDefault();
    if (active?.button === button) active.finish(true);
    else listen(button, targetEl);
  });
}

// A mic button inside an idea box (bottom right), for the places owners
// jot ideas. Adds nothing where voice typing isn't supported.
export function attachMic(field) {
  if (!field || !voiceSupported() || field.parentElement?.classList.contains("vm-field")) return;
  const wrap = document.createElement("div");
  wrap.className = `vm-field${field.tagName === "INPUT" ? " is-line" : ""}`;
  field.replaceWith(wrap);
  wrap.append(field);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vm-field-mic";
  btn.setAttribute("aria-label", t("ai.voice.start"));
  btn.title = t("ai.voice.start");
  btn.innerHTML = icon("mic", { size: 16 });
  wrap.append(btn);
  wireMic(btn, field);
}

// Joins one recognizer session's results. Android Chrome can send each
// final result with the earlier ones repeated in front ("aku mau", "aku mau
// bikin"), so a result that starts with the previous one replaces it.
export function sessionText(results) {
  let final = "";
  let interim = "";
  let last = "";
  for (let i = 0; i < results.length; i++) {
    const piece = String(results[i][0]?.transcript || "").trim();
    if (!piece) continue;
    if (!results[i].isFinal) { interim = `${interim} ${piece}`.trim(); continue; }
    if (last && piece.toLowerCase().startsWith(last.toLowerCase())) final = final.slice(0, final.length - last.length) + piece;
    else final = `${final} ${piece}`.trim();
    last = piece;
  }
  return { final: final.trim(), interim };
}

function sheetHTML() {
  return `
    <div class="vm-card">
      <div class="vm-top">
        <span class="vm-dot" aria-hidden="true"></span>
        <span class="vm-status">${t("ai.voice.listening")}</span>
        <span class="vm-time">0:00</span>
        <button type="button" class="vm-x" aria-label="${t("ai.voice.cancel")}">${icon("x", { size: 16 })}</button>
      </div>
      <div class="vm-stage">
        <div class="vm-orb" aria-hidden="true"><span class="vm-halo"></span><span class="vm-core">${icon("mic", { size: 26 })}</span></div>
        <div class="vm-wave" aria-hidden="true">${"<i></i>".repeat(BARS)}</div>
      </div>
      <p class="vm-text" aria-live="polite"><span class="vm-final"></span> <span class="vm-interim"></span><span class="vm-ph">${t("ai.voice.hint")}</span></p>
      <div class="vm-actions">
        <button type="button" class="btn btn-secondary vm-cancel">${icon("x", { size: 15 })}<span>${t("ai.voice.cancel")}</span></button>
        <button type="button" class="btn btn-primary vm-done">${icon("check", { size: 15 })}<span>${t("ai.voice.done")}</span></button>
      </div>
    </div>`;
}

function listen(button, targetEl) {
  active?.finish(false);
  const rec = new (Recognition())();
  const phone = isPhone();
  rec.lang = getLang() === "en" ? "en-US" : "id-ID";
  rec.interimResults = true;
  rec.continuous = !phone;
  rec.maxAlternatives = 1;

  // Drop the keyboard first: on a phone it would cover the sheet's buttons.
  try { document.activeElement?.blur?.(); } catch { /* nothing focused */ }
  const backdrop = document.createElement("div");
  backdrop.className = "vm-backdrop";
  document.body.append(backdrop);
  const sheet = document.createElement("div");
  sheet.className = "vm-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", t("ai.voice.start"));
  sheet.innerHTML = sheetHTML();
  document.body.append(sheet);
  requestAnimationFrame(() => { sheet.classList.add("is-in"); backdrop.classList.add("is-in"); });
  // Keep the sheet above the on-screen keyboard if it comes back.
  const lift = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    sheet.style.setProperty("--vm-lift", `${Math.round(covered)}px`);
  };
  window.visualViewport?.addEventListener("resize", lift);
  lift();
  const $ = (sel) => sheet.querySelector(sel);
  const bars = [...sheet.querySelectorAll(".vm-wave i")];
  button.classList.add("mic-active");

  let committed = "";
  let session = { final: "", interim: "" };
  let running = true;
  let speaking = 0;
  let level = 0;
  let stream = null;
  let audioCtx = null;
  let analyser = null;
  let raf = 0;
  const started = Date.now();

  const words = () => [committed, session.final].filter(Boolean).join(" ");
  const paint = () => {
    $(".vm-final").textContent = words();
    $(".vm-interim").textContent = session.interim;
    $(".vm-ph").hidden = !!(words() || session.interim);
    const box = $(".vm-text");
    box.scrollTop = box.scrollHeight;
  };
  const setStatus = (text, kind = "") => {
    $(".vm-status").textContent = text;
    sheet.dataset.state = kind;
  };

  rec.addEventListener("result", (e) => {
    session = sessionText(e.results);
    speaking = Date.now();
    paint();
  });
  rec.addEventListener("speechstart", () => { speaking = Date.now(); });
  rec.addEventListener("error", (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    running = false;
    const key = e.error === "not-allowed" || e.error === "service-not-allowed" ? "ai.voice.denied" : e.error === "network" ? "ai.voice.offline" : e.error === "audio-capture" ? "ai.voice.noMic" : "";
    setStatus(key ? t(key) : t("ai.voice.error", { error: e.error }), "error");
    $(".vm-done").disabled = !words();
    $(".vm-cancel span").textContent = t("ai.voice.close");
  });
  rec.addEventListener("end", () => {
    committed = words();
    session = { final: "", interim: "" };
    paint();
    if (running && Date.now() - started < MAX_MS) {
      try { rec.start(); } catch { /* already starting */ }
    } else if (running) finish(true);
  });

  // The wave: real mic levels on a computer, the recognizer's speech
  // events on a phone (see isPhone).
  if (!phone && navigator.mediaDevices?.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then((s) => {
      if (active !== handle) { s.getTracks().forEach((tr) => tr.stop()); return; }
      stream = s;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      audioCtx.createMediaStreamSource(s).connect(analyser);
    }).catch(() => { /* the wave falls back to speech events */ });
  }
  const samples = new Uint8Array(256);
  const tick = () => {
    if (analyser) {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      level = level * 0.6 + Math.min(1, Math.sqrt(sum / samples.length) * 4.5) * 0.4;
    } else {
      const talking = running && Date.now() - speaking < 700;
      level = level * 0.8 + (talking ? 0.35 + Math.random() * 0.5 : 0.04) * 0.2;
    }
    const now = performance.now() / 1000;
    bars.forEach((b, i) => {
      const center = 1 - Math.abs(i - (BARS - 1) / 2) / (BARS / 2);
      const wobble = 0.55 + 0.45 * Math.sin(now * 7 + i * 0.9) * Math.sin(now * 3.1 + i * 0.37);
      const h = running ? 0.08 + level * (0.35 + 0.65 * center) * wobble : 0.08;
      b.style.transform = `scaleY(${Math.max(0.08, Math.min(1, h)).toFixed(3)})`;
    });
    sheet.style.setProperty("--vm-level", (running ? level : 0).toFixed(3));
    const sec = Math.floor((Date.now() - started) / 1000);
    $(".vm-time").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    e.preventDefault();
    finish(false);
  };
  document.addEventListener("keydown", onKey, true);

  function finish(keep) {
    if (active !== handle) return;
    active = null;
    running = false;
    cancelAnimationFrame(raf);
    document.removeEventListener("keydown", onKey, true);
    stream?.getTracks().forEach((tr) => tr.stop());
    audioCtx?.close().catch(() => {});
    try { rec.abort(); } catch { /* not started */ }
    button.classList.remove("mic-active");
    // What was still being heard when Selesai was pressed counts too.
    const text = [words(), session.interim].filter(Boolean).join(" ").trim();
    sheet.classList.remove("is-in");
    backdrop.classList.remove("is-in");
    window.visualViewport?.removeEventListener("resize", lift);
    setTimeout(() => { sheet.remove(); backdrop.remove(); }, 200);
    if (!keep || !text) return;
    const before = targetEl.value.replace(/\s+$/, "");
    const joined = before ? `${before} ${text}` : text;
    targetEl.value = targetEl.maxLength > 0 ? joined.slice(0, targetEl.maxLength) : joined;
    // Pages that track the field's value (and tour input gates) listen for input.
    targetEl.dispatchEvent(new Event("input", { bubbles: true }));
    targetEl.focus();
    try { targetEl.setSelectionRange(targetEl.value.length, targetEl.value.length); } catch { /* not a text field */ }
  }
  const handle = { button, finish };
  active = handle;

  $(".vm-done").addEventListener("click", () => finish(true));
  $(".vm-cancel").addEventListener("click", () => finish(false));
  $(".vm-x").addEventListener("click", () => finish(false));
  // Tapping outside the sheet keeps what was said, like pressing Selesai.
  backdrop.addEventListener("click", () => finish(true));
  try {
    rec.start();
  } catch (err) {
    finish(false);
    toast(t("ai.voice.error", { error: err?.message || "start" }), "error");
  }
}
