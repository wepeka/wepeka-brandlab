// Content Series ("Content Series Memory") — a reusable AI context the
// owner sets up once for a recurring content concept (e.g. "Bedah Brand":
// its tone, structure, hooks, CTA) so a new episode never has to re-explain
// it. Mounted as a Content OS sub-tab (js/views/content-os.js). Series are
// created/edited here, then linked to a piece in Creator (js/views/
// creator.js's seriesFieldHTML) or picked/auto-detected in Brainstorm
// (js/consultant-panel.js) — see js/store.js's Series CRUD and js/ai.js's
// buildSeriesContext for how the saved DNA turns into AI context.
import { getBrand, listContent, listSeries, getSeries, createSeries, updateSeries, deleteSeries, onChange } from "../store.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { toast, qs, qsa, escapeHtml as escapeText, escapeHtml as escapeAttr } from "../dom.js";
import { t } from "../i18n.js";

export function render(root, { brandId }) {
  const refresh = () => paint(root, brandId, refresh);
  refresh();
  return onChange(refresh);
}

function paint(root, brandId, refresh) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return;
  }
  const series = listSeries(brandId);
  const content = listContent(brandId);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">${t("series.list.title")}</div>
        <h1>${t("series.tab")}</h1>
      </div>
      <button class="btn btn-primary" id="new-series">${icon("plus", { size: 16 })}${t("series.new")}</button>
    </div>
    <p class="page-sub" style="margin-bottom:24px;">${t("series.list.sub")}</p>
    ${
      series.length
        ? `<div class="brand-grid">${series.map((s) => seriesCardHTML(s, content)).join("")}</div>`
        : `<div class="content-view-card glass-card" style="max-width:460px;cursor:default;">
             <div class="icon-wrap">${icon("sparkle", { size: 22 })}</div>
             <h3>${t("series.list.empty.title")}</h3>
             <p>${t("series.list.empty.body")}</p>
           </div>`
    }
  `;

  qs("#new-series")?.addEventListener("click", () => openSeriesModal({ brandId, onSaved: refresh }));
  qsa("[data-open-series]", root).forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-delete-series]")) return;
      openSeriesModal({ brandId, series: getSeries(card.dataset.openSeries), onSaved: refresh });
    });
  });
  qsa("[data-delete-series]", root).forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog({ title: t("series.deleteConfirm.title"), message: t("series.deleteConfirm.body"), danger: true });
      if (!ok) return;
      deleteSeries(btn.dataset.deleteSeries);
      toast(t("series.deleted"));
      refresh();
    });
  });
}

function seriesCardHTML(s, content) {
  const linked = content.filter((c) => c.seriesId === s.id).length;
  return `
    <div class="brand-card glass-card campaign-card" data-open-series="${s.id}" style="cursor:pointer;">
      <button class="icon-btn card-menu" data-delete-series="${s.id}" aria-label="${t("common.delete")}" style="width:30px;height:30px;">${icon("trash", { size: 15 })}</button>
      <h3>${escapeText(s.name)}</h3>
      ${s.dna?.description ? `<div class="meta" style="margin-bottom:10px;">${escapeText(s.dna.description)}</div>` : ""}
      ${linked ? `<div class="campaign-card-next">${icon("layers", { size: 12 })}<span>${t("series.episodeCount", { n: linked })}</span></div>` : ""}
    </div>
  `;
}

// ---------- Create/edit modal ----------

export function openSeriesModal({ brandId, series = null, onSaved } = {}) {
  const dna = series?.dna || {};
  const draft = {
    name: series?.name || "",
    description: dna.description || "",
    mainTopic: dna.mainTopic || "",
    objective: dna.objective || "",
    targetAudience: dna.targetAudience || "",
    platform: dna.platform || "",
    format: dna.format || "",
    tone: dna.tone || "",
    writingStyle: dna.writingStyle || "",
    typicalHook: dna.typicalHook || "",
    storytellingStyle: dna.storytellingStyle || "",
    structure: dna.structure || "",
    averageLength: dna.averageLength || "",
    ctaStyle: dna.ctaStyle || "",
    visualStyle: dna.visualStyle || "",
    thingsToAvoid: dna.thingsToAvoid || "",
    additionalInstructions: dna.additionalInstructions || "",
  };

  const overlay = openModal({
    title: series ? t("series.edit.title") : t("series.new"),
    bodyHTML: `
      <div class="field">
        <label>${t("series.edit.name")}</label>
        <input class="input" id="s-name" placeholder="${escapeAttr(t("series.edit.namePh"))}" value="${escapeAttr(draft.name)}" />
      </div>

      <div class="divider"></div>
      <div class="page-eyebrow" style="margin-bottom:12px;">${t("series.edit.section.basic")}</div>
      <div class="field">
        <label>${t("series.edit.description")}</label>
        <textarea class="textarea" id="s-description" style="min-height:60px;" placeholder="${escapeAttr(t("series.edit.descriptionPh"))}">${draft.description}</textarea>
      </div>
      <div class="row-2">
        <div class="field">
          <label>${t("series.edit.mainTopic")}</label>
          <input class="input" id="s-mainTopic" value="${escapeAttr(draft.mainTopic)}" />
        </div>
        <div class="field">
          <label>${t("series.edit.objective")}</label>
          <input class="input" id="s-objective" placeholder="${escapeAttr(t("series.edit.objectivePh"))}" value="${escapeAttr(draft.objective)}" />
        </div>
      </div>
      <div class="field">
        <label>${t("series.edit.audience")}</label>
        <input class="input" id="s-targetAudience" value="${escapeAttr(draft.targetAudience)}" />
      </div>
      <div class="row-2">
        <div class="field">
          <label>${t("series.edit.platform")}</label>
          <input class="input" id="s-platform" placeholder="${escapeAttr(t("series.edit.platformPh"))}" value="${escapeAttr(draft.platform)}" />
        </div>
        <div class="field">
          <label>${t("series.edit.format")}</label>
          <input class="input" id="s-format" placeholder="${escapeAttr(t("series.edit.formatPh"))}" value="${escapeAttr(draft.format)}" />
        </div>
      </div>

      <div class="divider"></div>
      <div class="page-eyebrow" style="margin-bottom:12px;">${t("series.edit.section.style")}</div>
      <div class="row-2">
        <div class="field">
          <label>${t("series.edit.tone")}</label>
          <input class="input" id="s-tone" value="${escapeAttr(draft.tone)}" />
        </div>
        <div class="field">
          <label>${t("series.edit.writingStyle")}</label>
          <input class="input" id="s-writingStyle" value="${escapeAttr(draft.writingStyle)}" />
        </div>
      </div>
      <div class="field">
        <label>${t("series.edit.structure")}</label>
        <textarea class="textarea" id="s-structure" style="min-height:70px;" placeholder="${escapeAttr(t("series.edit.structurePh"))}">${draft.structure}</textarea>
      </div>
      <div class="field">
        <label>${t("series.edit.typicalHook")}</label>
        <textarea class="textarea" id="s-typicalHook" style="min-height:50px;">${draft.typicalHook}</textarea>
      </div>
      <div class="row-2">
        <div class="field">
          <label>${t("series.edit.storytellingStyle")}</label>
          <input class="input" id="s-storytellingStyle" value="${escapeAttr(draft.storytellingStyle)}" />
        </div>
        <div class="field">
          <label>${t("series.edit.averageLength")}</label>
          <input class="input" id="s-averageLength" value="${escapeAttr(draft.averageLength)}" />
        </div>
      </div>
      <div class="field">
        <label>${t("series.edit.ctaStyle")}</label>
        <textarea class="textarea" id="s-ctaStyle" style="min-height:50px;">${draft.ctaStyle}</textarea>
      </div>
      <div class="field">
        <label>${t("series.edit.visualStyle")}</label>
        <textarea class="textarea" id="s-visualStyle" style="min-height:50px;">${draft.visualStyle}</textarea>
      </div>
      <div class="field">
        <label>${t("series.edit.avoid")}</label>
        <textarea class="textarea" id="s-thingsToAvoid" style="min-height:50px;">${draft.thingsToAvoid}</textarea>
      </div>
      <div class="field">
        <label>${t("series.edit.additional")}</label>
        <textarea class="textarea" id="s-additionalInstructions" style="min-height:50px;">${draft.additionalInstructions}</textarea>
      </div>
    `,
    footHTML: `
      <button class="btn btn-secondary" data-cancel>${t("common.cancel")}</button>
      <button class="btn btn-primary" data-save>${icon("check", { size: 15 })}${t("common.save")}</button>
    `,
    onMount: (el) => {
      setTimeout(() => el.querySelector("#s-name").focus(), 30);
    },
  });

  overlay.querySelector("[data-cancel]").addEventListener("click", () => closeOverlay(overlay));
  overlay.querySelector("[data-save]").addEventListener("click", () => {
    const nameInput = overlay.querySelector("#s-name");
    const name = nameInput.value.trim();
    if (!name) {
      toast(t("series.edit.nameRequired"), "error");
      nameInput.focus();
      return;
    }
    const val = (id) => overlay.querySelector(`#${id}`).value.trim();
    const patch = {
      name,
      dna: {
        description: val("s-description"),
        mainTopic: val("s-mainTopic"),
        objective: val("s-objective"),
        targetAudience: val("s-targetAudience"),
        platform: val("s-platform"),
        format: val("s-format"),
        tone: val("s-tone"),
        writingStyle: val("s-writingStyle"),
        typicalHook: val("s-typicalHook"),
        storytellingStyle: val("s-storytellingStyle"),
        structure: val("s-structure"),
        averageLength: val("s-averageLength"),
        ctaStyle: val("s-ctaStyle"),
        visualStyle: val("s-visualStyle"),
        thingsToAvoid: val("s-thingsToAvoid"),
        additionalInstructions: val("s-additionalInstructions"),
      },
    };
    let saved;
    if (series) {
      saved = updateSeries(series.id, patch);
      toast(t("series.edit.updated"));
    } else {
      saved = createSeries(brandId, patch);
      toast(t("series.edit.created", { name }));
    }
    closeOverlay(overlay);
    onSaved?.(saved);
  });
}
