// Aturan tulisan — two small things every brand writes the same way every
// time, so the AI shouldn't guess them:
//   • how the brand addresses its customers ("Kak", "Bestie", "Bunda"…),
//   • the fixed hashtags that close every social caption.
// Stored on the brand (brand.writingRules = { customerCall, hashtags[] }),
// read by every AI writer through js/ai.js buildBrandContext, and the
// hashtags are also put on the caption by code (applyFixedHashtags) so a
// caption never ends up with invented ones. One modal, opened from where
// writing happens (Tulisan Cepat, Creator's AI writer).
import { getBrand, updateBrand, getSettings, listContent, listCampaigns } from "./store.js";
import { openModal, closeOverlay } from "./modals.js";
import { icon } from "./icons.js";
import { escapeHtml as esc, qs, qsa, toast } from "./dom.js";
import { suggestHashtags, hasAiKey, AiApiError } from "./ai.js";
import { pulseTextFor } from "./brand-pulse.js";
import { t } from "./i18n.js";

const CALL_CHOICES = ["Kak", "Kakak", "Sis", "Gan", "Bestie", "Bunda", "Kamu", "Anda"];
const MAX_HASHTAGS = 15;

export function writingRulesOf(brand) {
  const r = brand?.writingRules || {};
  return { customerCall: String(r.customerCall || "").trim(), hashtags: Array.isArray(r.hashtags) ? r.hashtags : [] };
}

// "kopi senja, #Kediri  #kopi" → ["#kopisenja", "#Kediri", "#kopi"]: commas
// and "#" separate tags; spaces inside one tag are squeezed out.
export function parseHashtags(text) {
  const out = [];
  String(text || "")
    .split(/[,;\n]+/)
    .flatMap((chunk) => (chunk.includes("#") ? chunk.split("#") : [chunk]))
    .map((x) => x.replace(/\s+/g, ""))
    .filter(Boolean)
    .forEach((x) => {
      const tag = `#${x.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")}`;
      if (tag.length > 1 && !out.some((y) => y.toLowerCase() === tag.toLowerCase())) out.push(tag);
    });
  return out.slice(0, MAX_HASHTAGS);
}

// The caption ends with exactly the fixed hashtags: any hashtags the model
// put at the end are replaced, ones woven into sentences are left alone.
export function applyFixedHashtags(text, hashtags) {
  if (!hashtags?.length || !text) return text;
  const lines = String(text).replace(/\s+$/, "").split("\n");
  while (lines.length && /^\s*(#[\p{L}\p{N}_]+\s*)+$/u.test(lines[lines.length - 1])) lines.pop();
  let body = lines.join("\n").replace(/(\s+#[\p{L}\p{N}_]+)+\s*$/u, "").replace(/\s+$/, "");
  return `${body}\n\n${hashtags.join(" ")}`;
}

// The one-line summary with its edit button, for the top of a writing form.
export function writingRulesRowHTML(brand) {
  const { customerCall, hashtags } = writingRulesOf(brand);
  const parts = [
    customerCall ? t("wr.row.call", { call: esc(customerCall) }) : "",
    hashtags.length ? t("wr.row.tags", { tags: esc(hashtags.slice(0, 4).join(" ")) + (hashtags.length > 4 ? ` +${hashtags.length - 4}` : "") }) : "",
  ].filter(Boolean);
  return `
    <button type="button" class="wr-row" data-writing-rules>
      ${icon("edit", { size: 13 })}
      <span>${parts.length ? parts.join(" · ") : t("wr.row.empty")}</span>
      <b>${parts.length ? t("wr.row.edit") : t("wr.row.set")}</b>
    </button>`;
}

export function wireWritingRules(root, brandId, onSaved = () => {}) {
  qsa("[data-writing-rules]", root).forEach((btn) => btn.addEventListener("click", () => openWritingRulesModal(brandId, { onSaved })));
}

export function openWritingRulesModal(brandId, { onSaved = () => {} } = {}) {
  const brand = getBrand(brandId);
  if (!brand) return;
  const st = { ...writingRulesOf(brand), hashtags: [...writingRulesOf(brand).hashtags], suggestions: [], busy: false };

  const tagsHTML = () =>
    st.hashtags.length
      ? st.hashtags.map((h, i) => `<span class="wr-tag">${esc(h)}<button type="button" data-wr-remove="${i}" aria-label="${t("common.delete")}">${icon("x", { size: 11 })}</button></span>`).join("")
      : `<span class="text-faint" style="font-size:12px;">${t("wr.tags.none")}</span>`;
  const suggestHTML = () =>
    st.busy
      ? `<div class="ocr-status" style="margin:8px 0 0;"><div class="spinner"></div><span>${t("wr.suggest.busy")}</span></div>`
      : st.suggestions.length
      ? `<p class="text-faint" style="font-size:11.5px;margin:10px 0 6px;">${t("wr.suggest.pick")}</p><div class="wr-suggest">${st.suggestions
          .map((h) => `<button type="button" class="consultant-starter ${st.hashtags.some((x) => x.toLowerCase() === h.toLowerCase()) ? "is-added" : ""}" data-wr-add="${esc(h)}">${icon("plus", { size: 11 })}${esc(h)}</button>`)
          .join("")}</div>`
      : "";

  const overlay = openModal({
    title: t("wr.title"),
    bodyHTML: `
      <p class="text-muted" style="font-size:12.5px;margin:0 0 16px;">${t("wr.intro")}</p>
      <div class="field">
        <label for="wr-call">${t("wr.call.label")}</label>
        <input class="input" id="wr-call" maxlength="24" autocomplete="off" placeholder="${esc(t("wr.call.ph"))}" value="${esc(st.customerCall)}" />
        <div class="chip-select wr-call-chips">${CALL_CHOICES.map((c) => `<button type="button" data-wr-call="${c}" class="${st.customerCall === c ? "active" : ""}">${c}</button>`).join("")}</div>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label for="wr-tag-input">${t("wr.tags.label")}</label>
        <div class="wr-tags" id="wr-tags">${tagsHTML()}</div>
        <div class="wr-tag-add">
          <input class="input" id="wr-tag-input" autocomplete="off" placeholder="${esc(t("wr.tags.ph"))}" />
          <button type="button" class="btn btn-secondary btn-sm" id="wr-tag-add">${icon("plus", { size: 12 })}${t("wr.tags.add")}</button>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="wr-suggest" style="margin-top:8px;">${icon("sparkle", { size: 12 })}${t("wr.suggest.btn")}</button>
        <div id="wr-suggest-box">${suggestHTML()}</div>
        <p class="ev-field-hint" style="margin-top:8px;">${t("wr.tags.hint")}</p>
      </div>`,
    footHTML: `<button type="button" class="btn btn-secondary" id="wr-cancel">${t("common.cancel")}</button><button type="button" class="btn btn-primary" id="wr-save">${icon("check", { size: 14 })}${t("common.save")}</button>`,
  });

  const paintTags = () => { qs("#wr-tags", overlay).innerHTML = tagsHTML(); qs("#wr-suggest-box", overlay).innerHTML = suggestHTML(); wireDynamic(); };
  const addTags = (text) => {
    parseHashtags(text).forEach((h) => { if (!st.hashtags.some((x) => x.toLowerCase() === h.toLowerCase()) && st.hashtags.length < MAX_HASHTAGS) st.hashtags.push(h); });
    paintTags();
  };
  const wireDynamic = () => {
    qsa("[data-wr-remove]", overlay).forEach((b) => b.addEventListener("click", () => { st.hashtags.splice(Number(b.dataset.wrRemove), 1); paintTags(); }));
    qsa("[data-wr-add]", overlay).forEach((b) => b.addEventListener("click", () => addTags(b.dataset.wrAdd)));
  };
  wireDynamic();

  const callInput = qs("#wr-call", overlay);
  qsa("[data-wr-call]", overlay).forEach((b) =>
    b.addEventListener("click", () => {
      callInput.value = b.dataset.wrCall;
      qsa("[data-wr-call]", overlay).forEach((x) => x.classList.toggle("active", x === b));
    })
  );
  const tagInput = qs("#wr-tag-input", overlay);
  qs("#wr-tag-add", overlay).addEventListener("click", () => { addTags(tagInput.value); tagInput.value = ""; tagInput.focus(); });
  tagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTags(tagInput.value); tagInput.value = ""; }
  });
  qs("#wr-suggest", overlay).addEventListener("click", async () => {
    const ai = getSettings().ai || {};
    if (!hasAiKey(ai)) { toast(t("bs.noKey"), "error"); return; }
    st.busy = true; paintTags();
    try {
      const b = getBrand(brandId);
      const pulseText = pulseTextFor(b, { content: listContent(brandId), campaigns: listCampaigns(brandId), settings: getSettings() });
      st.suggestions = await suggestHashtags(ai, { brand: b, pulseText, current: st.hashtags });
    } catch (e) {
      toast(e instanceof AiApiError ? e.message : t("wr.suggest.failed"), "error");
    }
    st.busy = false; paintTags();
  });
  qs("#wr-cancel", overlay).addEventListener("click", () => closeOverlay(overlay));
  qs("#wr-save", overlay).addEventListener("click", () => {
    if (tagInput.value.trim()) addTags(tagInput.value);
    const next = { customerCall: callInput.value.trim().slice(0, 24), hashtags: st.hashtags.slice(0, MAX_HASHTAGS) };
    updateBrand(brandId, { writingRules: next });
    closeOverlay(overlay);
    toast(t("wr.saved"));
    onSaved(next);
  });
  callInput.focus();
}
