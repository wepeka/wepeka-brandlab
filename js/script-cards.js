// "Kartu" — a video script written one card per part (bagian), the other
// way to write besides "Ketik biasa" (the plain box). Each card is a part
// of the video: its name (HOOK, ISI, CTA…), what to say (Narasi, the big
// box) and, only when wanted, what to show (Visual) and the text on screen
// (Teks layar). The seconds are worked out from the narration as it is
// typed, and a timeline on top shows how the video is split.
//
// Underneath it is still the one plain string in content.script, in the
// same beat format the AI writes (js/script-format.js) — the PDF, the
// teleprompter, the chat and "Ketik biasa" all keep reading that string.
// Used at two sizes: inside Creator, and full screen (js/script-focus.js).
import { icon } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { t } from "./i18n.js";
import { scriptToBeats, beatsToScript, beatTimeline } from "./script-format.js";

// The optional lines of a card, in the order the stored text has them.
const EXTRA = [
  { key: "visual", label: "cr.cards.visual", ph: "cr.cards.visualPh", add: "cr.cards.addVisual" },
  { key: "onScreen", label: "cr.cards.screen", ph: "cr.cards.screenPh", add: "cr.cards.addScreen" },
];

const countWords = (s) => (String(s || "").trim().match(/[^\s]+/g) || []).length;
const isEmptyBeat = (b) => !String(b.visual || "").trim() && !String(b.onScreen || "").trim() && !String(b.say || "").trim() && !String(b.note || "").trim();

function autosize(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// `onInput(text)` fires on every edit with the whole script as text; the
// caller decides when to save.
export function mountScriptCards(host, { value = "", lang = "id", onInput = () => {}, large = false } = {}) {
  let src = scriptToBeats(value, { lang });
  let beats = src.beats;
  let text = String(value || "");
  // Optional lines opened with "+ Visual" while still empty, as "index:key".
  const opened = new Set();

  host.classList.add("script-cards");
  host.classList.toggle("is-large", !!large);

  const emit = () => {
    text = beatsToScript(beats, { preamble: src.preamble, lang: src.lang });
    if (src.fromText) {
      src = { ...src, fromText: false };
      host.querySelector("[data-sc-fromtext]")?.remove();
    }
    paintTimes();
    onInput(text);
  };

  // Empty cards aren't in the saved text yet, so they get no seconds and no
  // place on the timeline — what's shown always matches what's saved.
  const timesOf = () => {
    const filled = beats.map((b, i) => ({ b, i })).filter((x) => !isEmptyBeat(x.b));
    const tl = beatTimeline(filled.map((x) => x.b));
    const byIndex = new Map(filled.map((x, k) => [x.i, tl[k]]));
    return { byIndex, total: tl.length ? tl[tl.length - 1].to : 0, filled };
  };

  const paintTimes = () => {
    const { byIndex, total, filled } = timesOf();
    const words = beats.reduce((n, b) => n + countWords(b.say), 0);
    const totalEl = host.querySelector("[data-sc-total]");
    if (totalEl) totalEl.textContent = total ? t("cr.ai.lengthBadge", { s: total, w: words }) : t("cr.cards.totalEmpty");
    const line = host.querySelector("[data-sc-timeline]");
    if (line) {
      line.hidden = !filled.length;
      line.innerHTML = filled
        .map(({ b, i }) => {
          const sec = byIndex.get(i).to - byIndex.get(i).from;
          const name = String(b.label || "").trim() || t("cr.cards.newLabel");
          return `<button type="button" class="sc-seg${i === 0 ? " is-hook" : ""}" style="flex:${sec} 1 0" data-sc-jump="${i}" title="${escapeHtml(t("cr.cards.jump", { label: name, s: sec }))}">${escapeHtml(name)} · ${sec} ${escapeHtml(t("cr.cards.unit"))}</button>`;
        })
        .join("");
    }
    host.querySelectorAll("[data-sc-card]").forEach((card) => {
      const r = byIndex.get(Number(card.dataset.scCard));
      const b = card.querySelector("[data-sc-time]");
      if (b) b.textContent = r ? `${r.from}–${r.to}` : "…";
    });
  };

  const extraHTML = (b, i) =>
    EXTRA.filter((f) => String(b[f.key] || "").trim() || opened.has(`${i}:${f.key}`))
      .map(
        (f) => `
        <label class="sc-field">
          <span class="sc-k">${t(f.label)}</span>
          <textarea class="sc-in" rows="1" data-sc-f="${f.key}" placeholder="${escapeHtml(t(f.ph))}">${escapeHtml(b[f.key] || "")}</textarea>
        </label>`
      )
      .join("");

  const chipsHTML = (b, i) => {
    const chips = EXTRA.filter((f) => !String(b[f.key] || "").trim() && !opened.has(`${i}:${f.key}`))
      .map((f) => `<button type="button" class="sc-chip" data-sc-open="${f.key}">${icon("plus", { size: 11 })}${t(f.add)}</button>`)
      .join("");
    return chips ? `<div class="sc-chips">${chips}</div>` : "";
  };

  const cardHTML = (b, i) => `
    <div class="sc-card${i === 0 ? " is-hook" : ""}" data-sc-card="${i}">
      <div class="sc-time"><b data-sc-time>…</b><span>${escapeHtml(t("cr.cards.unit"))}</span></div>
      <div class="sc-main">
        <div class="sc-head">
          <input class="sc-label" data-sc-f="label" maxlength="40" value="${escapeHtml(b.label || "")}" placeholder="${escapeHtml(t("cr.cards.newLabel"))}" aria-label="${escapeHtml(t("cr.cards.labelAria"))}" />
          <button type="button" class="chip-icon-btn" data-sc-up aria-label="${escapeHtml(t("cr.f.slideUp"))}" title="${escapeHtml(t("cr.f.slideUp"))}" ${i === 0 ? "disabled" : ""}>${icon("arrowUp", { size: 12 })}</button>
          <button type="button" class="chip-icon-btn" data-sc-del aria-label="${escapeHtml(t("common.delete"))}" title="${escapeHtml(t("common.delete"))}">${icon("trash", { size: 12 })}</button>
        </div>
        ${String(b.note || "").trim() ? `<label class="sc-field"><span class="sc-k">${t("cr.cards.note")}</span><textarea class="sc-in" rows="1" data-sc-f="note">${escapeHtml(b.note)}</textarea></label>` : ""}
        ${extraHTML(b, i)}
        <label class="sc-say-wrap">
          <span class="sc-k">${t("cr.cards.say")}</span>
          <textarea class="sc-say" rows="2" data-sc-f="say" placeholder="${escapeHtml(t("cr.focus.sayPh"))}">${escapeHtml(b.say || "")}</textarea>
        </label>
        ${chipsHTML(b, i)}
      </div>
    </div>`;

  // Whole redraw — only for changes in shape (a card added, moved, removed,
  // a line opened). Typing never redraws, so the caret stays put.
  const render = (focus = null) => {
    host.innerHTML = `
      <div class="sc-top">
        <div class="sc-total">${icon("clock", { size: 12 })}<span data-sc-total></span></div>
        <div class="sc-timeline" data-sc-timeline></div>
      </div>
      ${src.fromText ? `<p class="sc-fromtext" data-sc-fromtext>${t("cr.cards.fromText")}</p>` : ""}
      ${beats.map(cardHTML).join("")}
      <button type="button" class="btn btn-secondary btn-sm sc-add" data-sc-add>${icon("plus", { size: 13 })}${t("cr.cards.add")}</button>`;
    host.querySelectorAll("textarea").forEach(autosize);
    paintTimes();
    if (focus) {
      const card = host.querySelector(`[data-sc-card="${focus.i}"]`);
      const el = card?.querySelector(`[data-sc-f="${focus.key || "say"}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        if (el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length);
        card.scrollIntoView({ block: "nearest" });
      }
    }
  };

  const listen = new AbortController();
  const on = { signal: listen.signal };
  const indexOf = (el) => Number(el.closest("[data-sc-card]")?.dataset.scCard);

  host.addEventListener("input", (e) => {
    const f = e.target.dataset?.scF;
    if (!f) return;
    const i = indexOf(e.target);
    if (!beats[i]) return;
    beats[i][f] = e.target.value;
    if (e.target.tagName === "TEXTAREA") autosize(e.target);
    emit();
  }, on);
  // A button press keeps the caret where it is: leaving the cards saves
  // (and Creator then redraws), which would swallow the click — Safari
  // doesn't focus buttons, so the focus would otherwise seem to leave.
  host.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  }, on);
  host.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset?.scF === "label") {
      e.preventDefault();
      e.target.closest("[data-sc-card]")?.querySelector('[data-sc-f="say"]')?.focus();
    }
  }, on);
  host.addEventListener("click", (e) => {
    const jump = e.target.closest("[data-sc-jump]");
    if (jump) {
      const i = Number(jump.dataset.scJump);
      const say = host.querySelector(`[data-sc-card="${i}"] [data-sc-f="say"]`);
      say?.closest("[data-sc-card]")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      say?.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest("[data-sc-add]")) {
      beats.push({ label: t("cr.cards.newLabel"), visual: "", onScreen: "", say: "", note: "" });
      opened.clear();
      render({ i: beats.length - 1 });
      return;
    }
    const card = e.target.closest("[data-sc-card]");
    if (!card) return;
    const i = Number(card.dataset.scCard);
    const open = e.target.closest("[data-sc-open]");
    if (open) {
      opened.add(`${i}:${open.dataset.scOpen}`);
      render({ i, key: open.dataset.scOpen });
      return;
    }
    if (e.target.closest("[data-sc-up]") && i > 0) {
      [beats[i - 1], beats[i]] = [beats[i], beats[i - 1]];
      opened.clear();
      emit();
      render();
      return;
    }
    if (e.target.closest("[data-sc-del]")) {
      if (beats.length > 1) beats.splice(i, 1);
      else beats = [{ label: "HOOK", visual: "", onScreen: "", say: "", note: "" }];
      opened.clear();
      emit();
      render();
    }
  }, on);

  render();

  // The boxes grow with their text; a change of width (a phone turned, the
  // chat docked beside Layar penuh, fonts arriving) re-measures them.
  const fitAll = () => host.querySelectorAll("textarea").forEach(autosize);
  let lastWidth = host.clientWidth;
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
    if (host.clientWidth === lastWidth) return;
    lastWidth = host.clientWidth;
    fitAll();
  });
  resize?.observe(host);
  document.fonts?.ready.then(fitAll);

  return {
    get value() { return text; },
    // New text from outside (a chat revision, the AI writer): redraw from it.
    setValue(next) {
      text = String(next || "");
      src = scriptToBeats(text, { lang });
      beats = src.beats;
      opened.clear();
      render();
    },
    focus() {
      const say = host.querySelector('[data-sc-f="say"]');
      say?.focus({ preventScroll: true });
    },
    destroy() {
      listen.abort();
      resize?.disconnect();
      host.innerHTML = "";
      host.classList.remove("script-cards", "is-large");
    },
  };
}
