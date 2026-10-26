import { getBrand, listContent, listSeries, onChange, localISODate } from "../store.js";
import { brandDnaCompleteness, brandDnaDone } from "../brand-progress.js";
import { icon } from "../icons.js";
import { escapeHtml } from "../dom.js";
import * as contentListView from "./content-list.js";
import * as creatorView from "./creator.js";
import * as calendarView from "./calendar.js";
import * as copyStudioView from "./copy-studio.js";
import * as seriesView from "./series.js";
import { openContentEditor } from "./content-editor.js";
import { t } from "../i18n.js";
import { getMode } from "../mode.js";
import { setPageGuide } from "../section-guide.js";
import { runSpotlightTour } from "../tour.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { appCharacterSVG } from "../app-characters.js";
import { weekStart, addDays } from "../goal-roadmap.js";

// Umbrella for the content side: Creator, the calendar, the content list
// ("Daftar Konten"), Tulisan Cepat (copy you need right now, not scheduled
// content) and Seri live here as five sub-tabs — the same five, in the
// same order, for both modes. Each sub-view keeps its own render(root,
// {...}) signature; this only decides which one mounts from the URL's
// sub-route.
//
// Pemula (owner's ask, 2026-10-26: "kaya aplikasi", reference = a stack of
// colour category cards): opening Create shows the five as colour cards,
// each with its own colour and character (js/app-characters.js), instead
// of landing in Creator under a row of tabs. Inside one, a round back
// button returns to the cards. Pro keeps the tab row and opens on Creator.
const SUB_TABS = [
  { key: "creator", labelKey: "contentOs.tab.creator", color: "#3B9BFF", path: (id) => `#/brand/${id}/content/creator` },
  { key: "calendar", labelKey: "contentOs.tab.calendar", color: "#36D27F", path: (id) => `#/brand/${id}/content/calendar` },
  { key: "list", labelKey: "contentOs.tab.list", color: "#FF8A3D", path: (id) => `#/brand/${id}/content/list` },
  { key: "copy", labelKey: "contentOs.tab.copy", color: "#FF6FAE", path: (id) => `#/brand/${id}/content/copy` },
  { key: "series", labelKey: "contentOs.tab.series", color: "#E4B37E", path: (id) => `#/brand/${id}/content/series` },
];

// The Konten tab bar. (The chat, which used to sit here as "Brainstorm",
// has its own page now: js/views/chat.js.) Wrapped in .cos-tabs-wrap so a
// right-edge fade (css/styles.css) can hint there's more to scroll to on
// narrow phones, where all five sub-tabs don't fit in one screen width.
export function contentTabsHTML(brandId, activeSub) {
  return `<div class="cos-tabs-wrap" style="margin:-4px 0 20px;">
      <nav class="tabs cos-tabs" aria-label="${t("nav.content")}">
        ${SUB_TABS.map((tab) => `<a class="tab ${activeSub === tab.key ? "active" : ""}" href="${tab.path(brandId)}" ${activeSub === tab.key ? `aria-current="page"` : ""}>${t(tab.labelKey)}</a>`).join("")}
      </nav>
    </div>`;
}

// Pemula, inside one of the five: a round back button wearing that part's
// colour and character, back to the cards. The page's own title follows.
function backPillHTML(brandId, activeSub) {
  const tab = SUB_TABS.find((x) => x.key === activeSub) || SUB_TABS[0];
  return `<a class="cl-backpill" href="#/brand/${brandId}/content" style="--cat:${tab.color};" aria-label="${escapeHtml(t("cl.back"))}">
      ${icon("chevronLeft", { size: 16 })}
      <span class="cl-backpill-art">${appCharacterSVG(`cos-${tab.key}`)}</span>
      <span>${t("app.create.name")}</span>
    </a>`;
}

// Konten opens before Brand DNA is done — try it right away — so this slim
// line says what finishing it buys: sharper AI output.
function dnaHintHTML(brandId, brand) {
  if (brandDnaDone(brand)) return "";
  const dna = brandDnaCompleteness(brand.brandDNA);
  return `<a class="dna-hint" href="#/brand/${brandId}/dna">${icon("target", { size: 13 })}<span>${t("onb.dna.hint", { filled: dna.filled, total: dna.total })}</span><b>${dna.filled ? t("home.identity.ctaContinue") : t("home.identity.ctaStart")}${icon("arrowRight", { size: 12 })}</b></a>`;
}

// One-step orientation to the tab bar itself, offered from the topbar "?"
// on the Daftar tab (Creator and Kalender register their own guides).
function tourSteps() {
  return [{ selector: ".cos-tabs", title: t("cnt.os.tour.title"), body: t("cnt.os.tour.body") }];
}

// ---- Pemula: the five cards -------------------------------------------------

const isOpenPiece = (c) => c.status !== "published" && c.status !== "archived";

// One short line of status per card, from the brand's own content.
function cardStatus(key, brandId) {
  const content = listContent(brandId);
  const today = localISODate();
  if (key === "creator") {
    const open = content.filter(isOpenPiece);
    const late = open.filter((c) => c.scheduleDate && c.scheduleDate < today).length;
    if (late) return { text: t("cl.st.creatorLate", { n: late }), warn: true };
    return { text: open.length ? t("cl.st.creatorWip", { n: open.length }) : t("cl.st.creatorNone") };
  }
  if (key === "calendar") {
    const from = weekStart(today);
    const to = addDays(from, 6);
    const n = content.filter((c) => c.scheduleDate && c.scheduleDate >= from && c.scheduleDate <= to).length;
    return { text: n ? t("cl.st.calWeek", { n }) : t("cl.st.calEmpty") };
  }
  if (key === "list") return { text: content.length ? t("cl.st.listN", { n: content.length }) : t("cl.st.listNone") };
  if (key === "series") {
    const n = listSeries(brandId).length;
    return { text: n ? t("cl.st.seriesN", { n }) : t("cl.st.seriesNone") };
  }
  return { text: t("cl.st.copy") };
}

function landingHTML(brandId, brand, { animate }) {
  const cards = SUB_TABS.map((tab, i) => {
    const st = cardStatus(tab.key, brandId);
    return `
      <a class="cl-card" data-cat="${tab.key}" href="${tab.path(brandId)}" style="--cat:${tab.color};--i:${i};">
        <span class="cl-pill">${t(tab.labelKey)}</span>
        <span class="cl-sub">${t(`cl.cat.${tab.key}.sub`)}</span>
        <span class="cl-status${st.warn ? " is-warn" : ""}">${escapeHtml(st.text)}</span>
        <span class="cl-art">${appCharacterSVG(`cos-${tab.key}`)}</span>
        <span class="cl-go" aria-hidden="true">${icon("arrowRight", { size: 16 })}</span>
      </a>`;
  }).join("");
  return `
    <div class="cl${animate ? " is-entering" : ""}">
      <div class="cl-head">
        <div class="cl-head-text">
          <h1 class="cl-title">${t("app.create.name")}</h1>
          <p class="cl-lead">${t("cl.lead")}</p>
        </div>
        <div class="cl-head-actions">
          ${guideVideoButtonHTML("creator")}
          <button type="button" class="cl-cta" id="cl-new"><span>${t("cl.new")}</span><span class="cl-cta-dot">${icon("plus", { size: 18 })}</span></button>
        </div>
      </div>
      ${dnaHintHTML(brandId, brand)}
      <nav class="cl-stack" aria-label="${escapeHtml(t("nav.content"))}">${cards}</nav>
    </div>`;
}

function renderLanding(root, brandId) {
  let first = true;
  let last = "";
  const paint = () => {
    const brand = getBrand(brandId);
    if (!brand) { location.hash = "#/"; return; }
    // Nothing on the cards changed: leave them (and their motion) alone.
    const html = landingHTML(brandId, brand, { animate: first });
    const stable = html.replace(" is-entering", "");
    if (!first && stable === last) return;
    last = stable;
    root.innerHTML = html;
    first = false;
    wireHelpButtons(root);
    root.querySelector("#cl-new")?.addEventListener("click", () => openContentEditor({ brandId, onSaved: () => {} }));
  };
  paint();
  setPageGuide(null);
  const off = onChange(paint);
  return () => off();
}

export function render(root, { brandId, sub, contentId }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  const guided = getMode() === "guided";
  // Pemula's bare Create address: the cards. (Old /dashboard links and
  // Pro land on Creator, as before.)
  if (guided && !sub) return renderLanding(root, brandId);
  // The bare URL (and any old /dashboard link) lands on the first tab.
  const activeSub = SUB_TABS.some((x) => x.key === sub) ? sub : "creator";
  // Creator, Kalender, Konten and Tulisan Cepat draw their own "?" and
  // "Panduan" next to their title — the ones up here only for Series, which
  // has none, so a page never shows the same guide twice.

  root.innerHTML = guided
    ? `
    <div class="cl-bar">${backPillHTML(brandId, activeSub)}${activeSub === "series" ? `<span class="cl-bar-help">${helpButtonHTML("content-os")}${guideVideoButtonHTML("content-os")}</span>` : ""}</div>
    ${dnaHintHTML(brandId, brand)}
    <div id="cos-mount" class="cos-mount-pemula" data-cat="${activeSub}"></div>`
    : `
    ${activeSub === "list" ? "" : `<div class="page-eyebrow flex items-center gap-6" style="margin-bottom:14px;">${t("nav.content")}${activeSub === "series" ? `${helpButtonHTML("content-os")}${guideVideoButtonHTML("content-os")}` : ""}</div>`}
    ${contentTabsHTML(brandId, activeSub)}
    ${dnaHintHTML(brandId, brand)}
    <div id="cos-mount"></div>
  `;
  wireHelpButtons(root);
  const mount = document.getElementById("cos-mount");

  let cleanup;
  if (activeSub === "list") {
    // Pemula has no tab row for this one-step tour to point at.
    setPageGuide(guided ? null : () => runSpotlightTour(tourSteps()));
    cleanup = contentListView.render(mount, { brandId });
    if (contentId) openContentEditor({ brandId, contentId, onSaved: () => {} });
  } else if (activeSub === "calendar") {
    cleanup = calendarView.render(mount, { brandId });
  } else if (activeSub === "copy") {
    cleanup = copyStudioView.render(mount, { brandId });
  } else if (activeSub === "series") {
    cleanup = seriesView.render(mount, { brandId });
  } else {
    cleanup = creatorView.render(mount, { brandId, initialContentId: contentId });
  }

  return () => cleanup?.();
}
