// "Template hook" — 100 opening lines with blanks (js/knowledge/
// hook-templates.js), opened from Creator's Script / Slides field and from
// Layar penuh. Kept to three moves: pick a group, tap a line, fill its
// blanks (or ask AI for ideas to put in them), "Pakai hook ini".
//
// The picker only builds the line; the caller puts it where the hook goes
// (`onUse(line)` — Creator runs it through applyHook, so it becomes the
// first part of the script, or slide 1 of a carousel).
//
// AI is help, not the author: "Bantu isi pakai AI" (js/ai.js
// fillHookTemplate) shows three sets of values as finished lines; tapping
// one puts its values in the boxes, where the owner changes them. Blanks
// that need real data (a price, a number, a deadline) come back empty.
import { icon } from "./icons.js";
import { escapeHtml, toast } from "./dom.js";
import { openModal, closeOverlay } from "./modals.js";
import { t, getLang } from "./i18n.js";
import { getMode } from "./mode.js";
import { getSettings } from "./store.js";
import { fillHookTemplate, AiApiError } from "./ai.js";
import { mountAiFeedback } from "./ai-feedback.js";
import { HOOK_TEMPLATE_GROUPS, templatesInGroup, templateText, templateBlanks, templateParts, fillTemplate, blankLabel, isFactBlank, recommendedTemplateGroups, templateByNumber } from "./knowledge/hook-templates.js";

// What was typed into a template's boxes stays for the rest of the visit,
// so switching groups or closing the picker by mistake loses nothing.
const typed = new Map(); // template number → { BLANK: value }

// `lang`: the language the lines are written in — the brand's audience
// language when it has one, so the hook matches the video; the picker's own
// words follow the app. `aiContext()`: { brandContext, title, idea, funnel,
// platform } read when the owner asks — leave it out to hide the AI button
// (no AI available, or the guided tour).
export function openHookTemplatePicker({ funnel = "TOFU", brandId = null, lang = getLang(), aiContext = null, onUse }) {
  const rec = recommendedTemplateGroups(funnel);
  const state = { group: rec[0] || HOOK_TEMPLATE_GROUPS[0].key, open: null, ai: new Map() };

  const overlay = openModal({
    title: t("hooktpl.title"),
    wide: true,
    bodyHTML: `
      <div class="htpl">
        <p class="htpl-intro">${t("hooktpl.intro")}</p>
        <div class="htpl-groups" role="group" aria-label="${escapeHtml(t("hooktpl.groupsAria"))}" data-htpl-groups></div>
        <p class="htpl-group-desc" data-htpl-desc></p>
        <div class="htpl-list" data-htpl-list></div>
        <p class="htpl-foot">${t("hooktpl.foot")}</p>
      </div>`,
  });
  // Above Layar penuh too (js/script-focus.js), which it can open from.
  overlay.classList.add("htpl-overlay");
  const groupsEl = overlay.querySelector("[data-htpl-groups]");
  const descEl = overlay.querySelector("[data-htpl-desc]");
  const listEl = overlay.querySelector("[data-htpl-list]");

  const valuesOf = (n) => {
    if (!typed.has(n)) typed.set(n, {});
    return typed.get(n);
  };

  // A template line with its blanks marked; `values` fills the ones it has.
  const lineHTML = (text, values = null) =>
    templateParts(text)
      .map((p) => {
        if (p.text !== undefined) return escapeHtml(p.text);
        const v = values && String(values[p.blank] || "").trim();
        return v ? `<span class="htpl-val">${escapeHtml(v)}</span>` : `<span class="htpl-blank">${escapeHtml(blankLabel(p.blank))}</span>`;
      })
      .join("");

  function paintGroups() {
    groupsEl.innerHTML = HOOK_TEMPLATE_GROUPS.map((g) => {
      const on = g.key === state.group;
      const isRec = rec.includes(g.key);
      return `<button type="button" class="hook-chip${on ? " active" : ""}" data-htpl-group="${g.key}" aria-pressed="${on}">${escapeHtml(t(`hooktpl.group.${g.key}.label`))}${isRec ? `<span class="hook-rec-dot" aria-hidden="true"></span>` : ""}</button>`;
    }).join("");
    const g = HOOK_TEMPLATE_GROUPS.find((x) => x.key === state.group);
    const term = getMode() === "advanced" ? ` <span class="htpl-term">${escapeHtml(g.term)}</span>` : "";
    const legend = rec.includes(state.group) ? `<span class="htpl-rec"><span class="hook-rec-dot" aria-hidden="true"></span>${escapeHtml(t("hooktpl.recFor"))}</span>` : "";
    descEl.innerHTML = `${escapeHtml(t(`hooktpl.group.${g.key}.desc`))}${term}${legend}`;
  }

  function fillHTML(tpl) {
    const text = templateText(tpl, lang);
    const blanks = templateBlanks(text);
    const values = valuesOf(tpl.n);
    const facts = blanks.some(isFactBlank);
    // The line itself, in the row above, is the live preview.
    const got = state.ai.get(tpl.n);
    return `
      <div class="htpl-fill">
        <div class="htpl-inputs">
          ${blanks.map((b, i) => `
            <label class="htpl-input">
              <span>${escapeHtml(blankLabel(b))}${isFactBlank(b) ? ` <em>${t("hooktpl.realData")}</em>` : ""}</span>
              <input class="input" type="text" data-blank="${escapeHtml(b)}" data-blank-i="${i}" value="${escapeHtml(values[b] || "")}" autocomplete="off" enterkeyhint="${i === blanks.length - 1 ? "done" : "next"}" />
            </label>`).join("")}
        </div>
        ${facts ? `<p class="htpl-fact">${icon("info", { size: 12 })}<span>${t("hooktpl.factNote")}</span></p>` : ""}
        <div class="htpl-ai" data-htpl-ai-out>${aiOutHTML(tpl)}</div>
        <div class="htpl-actions">
          ${aiContext ? `<button type="button" class="btn btn-secondary btn-sm" data-htpl-ai ${got?.loading ? "disabled" : ""}>${icon("sparkle", { size: 13 })}<span>${got && !got.loading ? t("hooktpl.aiMore") : t("hooktpl.aiFill")}</span></button>` : "<span></span>"}
          <button type="button" class="btn btn-primary btn-sm" data-htpl-use>${t("hooktpl.use")}${icon("arrowRight", { size: 13 })}</button>
        </div>
      </div>`;
  }

  // The AI's sets of values, each shown as the finished line.
  function aiOutHTML(tpl) {
    const got = state.ai.get(tpl.n);
    if (!got) return "";
    if (got.loading) return `<p class="htpl-ai-loading">${icon("sparkle", { size: 13 })}<span>${t("hooktpl.aiLoading")}</span></p>`;
    const text = templateText(tpl, lang);
    const missing = got.options.some((o) => Object.values(withTyped(tpl, o)).some((v) => !String(v || "").trim()));
    return `
      <p class="htpl-ai-head">${t("hooktpl.aiPick")}</p>
      ${got.note ? `<p class="htpl-ai-note">${escapeHtml(got.note)}</p>` : ""}
      <div class="htpl-ai-options">
        ${got.options.map((o, i) => `<button type="button" class="htpl-ai-option${got.picked === i ? " active" : ""}" data-htpl-ai-pick="${i}">${lineHTML(text, withTyped(tpl, o))}</button>`).join("")}
      </div>
      ${missing ? `<p class="htpl-ai-note">${t("hooktpl.aiMissing")}</p>` : ""}
      <div data-htpl-feedback></div>`;
  }

  // An AI set on top of what the owner already typed: its empty values
  // (real data it didn't have) never hide or wipe the owner's own.
  const withTyped = (tpl, option) => {
    const out = { ...(typed.get(tpl.n) || {}) };
    Object.entries(option).forEach(([b, v]) => { if (v) out[b] = v; });
    return out;
  };

  function paintList() {
    listEl.innerHTML = templatesInGroup(state.group)
      .map((tpl) => {
        const open = state.open === tpl.n;
        return `
          <div class="htpl-item${open ? " is-open" : ""}" data-htpl-n="${tpl.n}">
            <button type="button" class="htpl-row" data-htpl-toggle="${tpl.n}" aria-expanded="${open}">
              <span class="htpl-line" ${open ? `aria-live="polite"` : ""}>${lineHTML(templateText(tpl, lang), typed.get(tpl.n))}</span>
              ${icon("chevronDown", { size: 14 })}
            </button>
            ${open ? fillHTML(tpl) : ""}
          </div>`;
      })
      .join("");
    const tpl = state.open && templateByNumber(state.open);
    const got = tpl && state.ai.get(tpl.n);
    if (got && !got.loading && got.feedback !== false) mountFeedback(tpl, got);
  }

  function mountFeedback(tpl, got) {
    const host = listEl.querySelector(`[data-htpl-n="${tpl.n}"] [data-htpl-feedback]`);
    if (!host || host.childElementCount) return;
    mountAiFeedback(host, {
      brandId,
      feature: "creator-hook-template",
      prompt: { template: templateText(tpl, lang), ...got.asked },
      output: got.options.map((o) => fillTemplate(templateText(tpl, lang), o, { lang })),
      onRated: () => { got.feedback = false; },
    });
  }

  const openItem = () => listEl.querySelector(".htpl-item.is-open");
  const repaintPreview = (tpl) => {
    const el = openItem()?.querySelector(".htpl-line");
    if (el) el.innerHTML = lineHTML(templateText(tpl, lang), valuesOf(tpl.n));
  };
  const repaintAi = (tpl) => {
    const el = openItem()?.querySelector("[data-htpl-ai-out]");
    if (!el) return;
    el.innerHTML = aiOutHTML(tpl);
    const got = state.ai.get(tpl.n);
    if (got && !got.loading && got.feedback !== false) mountFeedback(tpl, got);
  };

  function use(tpl) {
    const line = fillTemplate(templateText(tpl, lang), valuesOf(tpl.n), { lang });
    closeOverlay(overlay);
    onUse?.(line, tpl);
  }

  async function askAi(tpl) {
    if (!aiContext || state.ai.get(tpl.n)?.loading) return;
    const ctx = aiContext() || {};
    const text = templateText(tpl, lang);
    state.ai.set(tpl.n, { loading: true });
    const btn = openItem()?.querySelector("[data-htpl-ai]");
    if (btn) btn.disabled = true;
    repaintAi(tpl);
    try {
      // What the owner already typed is kept as given; the AI fills the rest.
      const filled = Object.fromEntries(Object.entries(typed.get(tpl.n) || {}).filter(([, v]) => String(v || "").trim()));
      const { options, note } = await fillHookTemplate(getSettings().ai || {}, { template: text, blanks: templateBlanks(text), filled, lang, ...ctx });
      state.ai.set(tpl.n, { options, note, picked: null, asked: { title: ctx.title || "", idea: ctx.idea || "", funnel: ctx.funnel || "" } });
    } catch (e) {
      state.ai.delete(tpl.n);
      toast(e instanceof AiApiError ? e.message : t("hooktpl.aiFailed"), "error");
    }
    if (!overlay.isConnected || state.open !== tpl.n) return;
    const now = openItem()?.querySelector("[data-htpl-ai]");
    if (now) {
      now.disabled = false;
      now.querySelector("span").textContent = state.ai.has(tpl.n) ? t("hooktpl.aiMore") : t("hooktpl.aiFill");
    }
    repaintAi(tpl);
  }

  groupsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-htpl-group]");
    if (!b || b.dataset.htplGroup === state.group) return;
    state.group = b.dataset.htplGroup;
    state.open = null;
    paintGroups();
    paintList();
  });

  listEl.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-htpl-toggle]");
    if (toggle) {
      const n = Number(toggle.dataset.htplToggle);
      state.open = state.open === n ? null : n;
      paintList();
      if (state.open) {
        const item = openItem();
        item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        // A phone keyboard would cover the line — focus only where there's room.
        if (!matchMedia("(pointer: coarse)").matches) item?.querySelector("input[data-blank]")?.focus({ preventScroll: true });
      }
      return;
    }
    const tpl = state.open && templateByNumber(state.open);
    if (!tpl) return;
    if (e.target.closest("[data-htpl-use]")) return use(tpl);
    if (e.target.closest("[data-htpl-ai]")) return askAi(tpl);
    const pick = e.target.closest("[data-htpl-ai-pick]");
    if (pick) {
      const got = state.ai.get(tpl.n);
      const option = got?.options[Number(pick.dataset.htplAiPick)];
      if (!option) return;
      got.picked = Number(pick.dataset.htplAiPick);
      const values = Object.assign(valuesOf(tpl.n), withTyped(tpl, option));
      openItem()?.querySelectorAll("input[data-blank]").forEach((inp) => { inp.value = values[inp.dataset.blank] || ""; });
      qsaActive(got.picked);
      repaintPreview(tpl);
    }
  });
  const qsaActive = (i) => openItem()?.querySelectorAll("[data-htpl-ai-pick]").forEach((b) => b.classList.toggle("active", Number(b.dataset.htplAiPick) === i));

  listEl.addEventListener("input", (e) => {
    const inp = e.target.closest("input[data-blank]");
    const tpl = state.open && templateByNumber(state.open);
    if (!inp || !tpl) return;
    valuesOf(tpl.n)[inp.dataset.blank] = inp.value;
    repaintPreview(tpl);
  });
  // Enter walks to the next box, then to "Pakai hook ini".
  listEl.addEventListener("keydown", (e) => {
    const inp = e.target.closest("input[data-blank]");
    if (!inp || e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    const all = [...(openItem()?.querySelectorAll("input[data-blank]") || [])];
    const next = all[all.indexOf(inp) + 1];
    if (next) next.focus();
    else openItem()?.querySelector("[data-htpl-use]")?.focus();
  });

  paintGroups();
  paintList();
  // On a phone the group chips scroll sideways — bring the open one into view.
  groupsEl.querySelector(".active")?.scrollIntoView({ inline: "center", block: "nearest" });
  return overlay;
}
