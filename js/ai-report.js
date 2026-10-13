// The small flag on an AI answer: "jawaban ini salah / aneh / nggak nyambung".
// It opens the same "Laporkan masalah" form (js/report-problem.js) with the
// answer attached, so the Wepeka team reads what the AI actually said.
//
//   aiReportButtonHTML(feature)
//       for views that paint with innerHTML. The answer is the visible text
//       of the nearest [data-ai-answer] ancestor (the button's parent when
//       there is none).
//   aiReportButtonHTML(feature, { from: "#some-list" })
//       the same, with the answer block named by a selector (the button
//       sits outside it).
//   aiReportButtonHTML(feature, { recent: "dna" })
//       for AI that fills a form field: shown only while the AI layer still
//       holds a fresh answer of that kind for this page (js/ai-last.js), and
//       reports that answer.
//   mountAiReport(parent, { feature, output, prompt })
//       the same button with the answer handed over directly.
//
// One delegated listener opens the form, so a view never wires it.
import { icon } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { t } from "./i18n.js";
import { lastAiAnswer, pageOf, readableAnswer } from "./ai-last.js";

const handed = new WeakMap();

export function aiReportButtonHTML(feature, { recent = "", from = "", label = true } = {}) {
  if (recent && !lastAiAnswer({ feature: recent, page: pageOf(location.hash) })) return "";
  const title = escapeHtml(t("lapor.ai.btnTitle"));
  return `<button type="button" class="ai-report-btn" data-ai-report="${escapeHtml(feature)}"${recent ? ` data-ai-recent="${escapeHtml(recent)}"` : ""}${from ? ` data-ai-from="${escapeHtml(from)}"` : ""} title="${title}" aria-label="${title}">${icon("flag", { size: 12 })}${label ? `<span>${t("lapor.ai.btn")}</span>` : ""}</button>`;
}

export function mountAiReport(parent, { feature, output = "", prompt = "", label = true } = {}) {
  if (!parent || !feature) return null;
  const holder = document.createElement("span");
  holder.innerHTML = aiReportButtonHTML(feature, { label });
  const btn = holder.firstElementChild;
  handed.set(btn, { output, prompt });
  parent.appendChild(btn);
  return btn;
}

// What the person sees in an answer block, without its buttons and inputs.
// `skip`: a selector for labels around the answer that aren't part of it.
// The copy is laid out off-screen next to the original for a moment, so
// innerText breaks lines the way the page does (a span styled as a block, a
// numbered row); without layout it falls back to one line per block tag.
const BLOCKS = "p,div,li,h1,h2,h3,h4,h5,h6,br,tr,summary,label,section";
export function answerTextFrom(el, skip = "") {
  if (!el) return "";
  const copy = el.cloneNode(true);
  copy.querySelectorAll(`button, select, textarea, input, script, style, svg, .ai-feedback, [hidden]${skip ? `, ${skip}` : ""}`).forEach((n) => n.remove());
  let text = "";
  if (el.isConnected && el.parentNode) {
    copy.removeAttribute("id");
    copy.setAttribute("aria-hidden", "true");
    copy.style.cssText += `;position:absolute !important;left:-99999px !important;top:0 !important;width:${el.offsetWidth || 320}px !important;pointer-events:none !important;`;
    el.after(copy);
    text = copy.innerText || "";
    copy.remove();
  }
  if (!text.trim()) {
    copy.querySelectorAll(BLOCKS).forEach((n) => n.after("\n"));
    text = copy.textContent;
  }
  return text.split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

function answerFor(btn) {
  const given = handed.get(btn);
  if (given) return { output: readableAnswer(given.output), prompt: readableAnswer(given.prompt) };
  if (btn.dataset.aiRecent) {
    const a = lastAiAnswer({ feature: btn.dataset.aiRecent });
    return { output: readableAnswer(a?.output), prompt: a?.prompt || "" };
  }
  const block = (btn.dataset.aiFrom && document.querySelector(btn.dataset.aiFrom)) || btn.closest("[data-ai-answer]") || btn.parentElement;
  return { output: answerTextFrom(block), prompt: "" };
}

export function openAiReport(feature, ai) {
  return import("./report-problem.js")
    .then((m) => m.openReportProblem({ kind: "ai", source: "ai", feature, ai }))
    .catch((e) => console.warn("[report] unavailable", e));
}

if (typeof window !== "undefined" && !window.__aiReportClickWired) {
  window.__aiReportClickWired = true;
  // Capture phase: the flag can sit inside a clickable card or a label, and
  // a tap on it must never also pick that card.
  document.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest("[data-ai-report]") : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    openAiReport(btn.dataset.aiReport, answerFor(btn));
  }, true);
}
