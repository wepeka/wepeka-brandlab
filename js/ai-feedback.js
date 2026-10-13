// Small 👍/👎 strip mounted under an AI result. 👍 records right away; 👎
// first asks "apa yang kurang?" (optional) so the rating carries a reason.
// Every rating lands in Firestore's aiFeedback collection via
// store.js recordAiFeedback — the raw material for an eval set.
// The strip also carries the "Laporkan" flag (js/ai-report.js): a rating
// teaches the AI, a report reaches the Wepeka team. The flag stays after
// the rating is given.
import { recordAiFeedback } from "./store.js";
import { rememberTaste } from "./brand-learning.js";
import { mountAiReport } from "./ai-report.js";
import { t } from "./i18n.js";

const asText = (v) => (typeof v === "string" ? v : JSON.stringify(v ?? ""));

// parent: element to append into. prompt/output: whatever produced and came
// back from the model (objects are JSON-stringified). onRated(rating) lets a
// caller that re-renders its own DOM (the consultant panel) remember that
// this result was already rated. report:false leaves the flag out (the chat
// puts its own on every answer).
export function mountAiFeedback(parent, { brandId = null, feature, prompt = "", output = "", onRated, report = true } = {}) {
  if (!parent || !feature) return null;
  const strip = document.createElement("div");
  strip.className = "ai-feedback";
  // The rating half; display:contents, so its children lay out as the
  // strip's own.
  const el = document.createElement("span");
  el.className = "ai-feedback-rate";
  el.innerHTML = `
    <span class="ai-feedback-q">${t("ai.feedback.question")}</span>
    <button type="button" class="ai-feedback-btn" data-ai-rate="up" aria-label="${t("ai.feedback.up")}" title="${t("ai.feedback.up")}">👍</button>
    <button type="button" class="ai-feedback-btn" data-ai-rate="down" aria-label="${t("ai.feedback.down")}" title="${t("ai.feedback.down")}">👎</button>
  `;
  strip.appendChild(el);
  if (report) mountAiReport(strip, { feature, output, prompt });
  parent.appendChild(strip);

  const send = (rating, note = "") => {
    recordAiFeedback({ brandId, feature, prompt: asText(prompt), output: asText(output), rating, note });
    // The readable copy the AI learns from (js/brand-learning.js).
    rememberTaste(brandId, { rating, note, output, feature });
    onRated?.(rating);
    el.innerHTML = `<span class="ai-feedback-thanks">${t("ai.feedback.thanks")}</span>`;
    setTimeout(() => {
      el.remove();
      if (!strip.childElementCount) strip.remove();
    }, 2500);
  };

  el.querySelector('[data-ai-rate="up"]').addEventListener("click", () => send("up"));
  el.querySelector('[data-ai-rate="down"]').addEventListener("click", () => {
    el.innerHTML = `
      <input class="input ai-feedback-note" maxlength="500" aria-label="${t("ai.feedback.notePlaceholder")}" placeholder="${t("ai.feedback.notePlaceholder")}" />
      <button type="button" class="btn btn-secondary btn-sm" data-ai-send>${t("ai.feedback.send")}</button>
    `;
    const input = el.querySelector(".ai-feedback-note");
    input.focus();
    el.querySelector("[data-ai-send]").addEventListener("click", () => send("down", input.value.trim()));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        send("down", input.value.trim());
      }
    });
  });
  return strip;
}
