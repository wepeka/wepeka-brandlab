// One funnel-stage picker for every screen that asks "what's this content
// for" — Creator Studio's drafting panel, the Content Editor drawer, and
// the AI Script Generator modal. Advanced mode keeps the compact
// TOFU/MOFU/BOFU chip row; Guided mode swaps the acronyms for a plain
// question with three explained choices. Same underlying funnel value
// either way, so nothing downstream (thresholds, dashboard breakdowns, AI
// prompts) changes — only how the question is asked.
import { FUNNELS } from "./store.js";
import { getMode } from "./mode.js";
import { t } from "./i18n.js";

// Guided-mode names for the content pipeline statuses (store.js's
// STATUS_LABELS are the marketer terms Advanced mode shows). Keys are the
// stored status ids; only the display label follows the UI language.
export const STATUS_LABELS_GUIDED = Object.fromEntries(
  ["idea", "draft", "production", "editing", "scheduled", "published", "archived"].map((s) => [s, t(`funnel.status.${s}`)])
);

export function statusLabel(status, labels) {
  return getMode() === "guided" ? STATUS_LABELS_GUIDED[status] || labels[status] || status : labels[status] || status;
}

// 3.4: the plain-language Guided label for a funnel value, for anywhere
// that just tags a content row (Beranda's to-do list, Content OS's "up
// next") instead of rendering the full picker above. Falls back to "" for
// an empty/unrecognized value rather than leaking the raw tofu/mofu/bofu
// acronym into Pemula copy.
// The short tag for a funnel stage: plain words in Pemula ("Kenalan",
// "Yakinkan", "Jualan"), the acronym in Pro.
export function funnelShort(funnel) {
  if (!funnel || !FUNNELS.includes(funnel)) return funnel || "";
  return getMode() === "guided" ? t(`funnel.short.${funnel}`) : funnel;
}

export function funnelLabel(funnel) {
  if (!funnel || !FUNNELS.includes(funnel)) return "";
  return t(`creator.funnel.guided.${funnel}.title`);
}

// `extraHead` slots a small control (e.g. the "detect from caption" AI
// icon) next to the label without each caller rebuilding the header row.
export function funnelFieldHTML({ id, value, extraHead = "", fieldStyle = "" }) {
  const guided = getMode() === "guided";
  const label = guided ? t("creator.funnel.guidedLabel") : t("funnel.stage");
  const head = extraHead
    ? `<div class="creator-field-head"><label style="margin-bottom:0;">${label}</label>${extraHead}</div>`
    : `<label>${label}</label>`;
  if (guided) {
    return `
      <div class="field" style="${fieldStyle}">
        ${head}
        <div class="creator-funnel-guided" id="${id}" data-funnel-field>
          ${FUNNELS.map(
            (f) => `
            <button type="button" class="creator-funnel-guided-option ${value === f ? "active" : ""}" data-val="${f}">
              <strong>${t(`creator.funnel.guided.${f}.title`)}</strong>
              <span>${t(`creator.funnel.guided.${f}.desc`)}</span>
            </button>`
          ).join("")}
        </div>
      </div>
    `;
  }
  return `
    <div class="field" style="${fieldStyle}">
      ${head}
      <div class="chip-select" id="${id}" data-funnel-field>
        ${FUNNELS.map((f) => `<button type="button" data-val="${f}" class="${value === f ? "active" : ""}">${f}</button>`).join("")}
      </div>
    </div>
  `;
}

// Wires the picker under `root`; `onPick(funnel)` fires on every click and
// the active state is toggled here so callers don't repeat it.
export function wireFunnelField(root, id, onPick) {
  const wrap = root.querySelector(`#${id}`);
  if (!wrap) return;
  wrap.querySelectorAll("button[data-val]").forEach((btn) => {
    btn.addEventListener("click", () => {
      wrap.querySelectorAll("button[data-val]").forEach((b) => b.classList.toggle("active", b === btn));
      onPick(btn.dataset.val);
    });
  });
}

// Reflects an externally-set value (e.g. AI detect) back onto the picker.
export function setFunnelFieldValue(root, id, value) {
  root.querySelector(`#${id}`)?.querySelectorAll("button[data-val]").forEach((b) => b.classList.toggle("active", b.dataset.val === value));
}
