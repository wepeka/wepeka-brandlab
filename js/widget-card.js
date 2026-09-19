// Shared "glass widget" card — the same closable, softly-glowing dark card
// used across Beranda ("This week's work" in js/views/brands.js), the Brand
// the brand home (js/views/home.js), the brand list (js/views/brands.js)
// and the campaign
// detail widgets (js/views/campaign-detail.js — Rencana, Ide Campaign,
// Sales Tracker). One HTML shape, one CSS recipe (css/styles.css
// .dash-widget-card / .dash-widget-collapsed), so "close this section" and
// "what does a widget look like" never drift apart between pages.
//
// Collapse state is the CALLER's problem (each page decides where to
// persist it — a brand field, a campaign field, etc.) — this module only
// renders the two shapes and expects a `data-widget-toggle="key"` click
// handler to be wired by the caller.
import { icon } from "./icons.js";
import { t } from "./i18n.js";

// key: a short id unique on the page, used as data-widget-toggle.
// iconName: js/icons.js icon key. title: already-escaped/plain string.
// bodyHTML: the widget's own content, already built.
// opts.sub: optional one-line subtitle under the title (already-escaped HTML ok).
// opts.extraHead: optional extra HTML (e.g. a button or link) before the collapse toggle.
export function widgetCardHTML(key, iconName, title, bodyHTML, { sub = "", extraHead = "" } = {}) {
  return `
    <div class="dash-widget-card">
      <div class="dash-widget-backdrop" aria-hidden="true"><div class="dash-widget-glow"></div></div>
      <div class="dash-widget-card-head">
        <div class="dash-widget-card-icon">${icon(iconName, { size: 18 })}</div>
        <div class="dash-widget-card-title"><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div>
        <div class="dash-widget-card-actions">
          ${extraHead}
          <button type="button" class="icon-btn dash-widget-collapse-btn" data-widget-toggle="${key}" aria-label="${t("dashboard.widget.collapse")}" title="${t("dashboard.widget.collapse")}">${icon("chevronDown", { size: 14 })}</button>
        </div>
      </div>
      <div class="dash-widget-card-body">${bodyHTML}</div>
    </div>`;
}

// summary: a real one-line description of what's hidden (never a bare label).
export function widgetCollapsedHTML(key, iconName, title, summary) {
  return `
    <button type="button" class="dash-widget-collapsed" data-widget-toggle="${key}">
      <span class="dash-widget-collapsed-icon">${icon(iconName, { size: 17 })}</span>
      <span class="dash-widget-collapsed-text"><b>${title}</b>${summary ? `<small>${summary}</small>` : ""}</span>
      ${icon("chevronDown", { size: 14 })}
    </button>`;
}

// Wires every [data-widget-toggle] found in `root` to flip one key in/out
// of a Set built from `collapsedList` (an array read off whatever the
// caller persists collapse state on), persisting via `save(nextArray)` and
// re-rendering via `refresh()`. Shared so every page's toggle wiring is a
// one-liner instead of its own hand-rolled Set/array dance.
export function wireWidgetToggle(root, { collapsedList, save, refresh }) {
  root.querySelectorAll("[data-widget-toggle]").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.dataset.widgetToggle;
      const next = new Set(collapsedList || []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      save([...next]);
      refresh();
    });
  });
}
