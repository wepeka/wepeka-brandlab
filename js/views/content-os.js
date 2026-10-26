import { getBrand, listContent, listSeries, onChange, localISODate, STATUS_LABELS } from "../store.js";
import { brandDnaCompleteness, brandDnaDone } from "../brand-progress.js";
import { icon } from "../icons.js";
import { escapeHtml } from "../dom.js";
import { statusLabel } from "../funnel-field.js";
import * as contentListView from "./content-list.js";
import * as creatorView from "./creator.js";
import * as calendarView from "./calendar.js";
import * as copyStudioView from "./copy-studio.js";
import * as seriesView from "./series.js";
import { openContentEditor } from "./content-editor.js";
import { t, getLang } from "../i18n.js";
import { getMode } from "../mode.js";
import { setPageGuide } from "../section-guide.js";
import { startCreateLandingGuide, startContentListGuide } from "../guides/create-guides.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { createArtSVG } from "../create-art.js";
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
// each with its own two-hue gradient and picture (js/create-art.js, the
// Beranda launcher's style: no mascots), instead of landing in Creator
// under a row of tabs. Inside one, a round back
// button returns to the cards. Pro keeps the tab row and opens on Creator.
const SUB_TABS = [
  { key: "creator", labelKey: "contentOs.tab.creator", color: "#3B9BFF", color2: "#4F55F5", path: (id) => `#/brand/${id}/content/creator` },
  { key: "calendar", labelKey: "contentOs.tab.calendar", color: "#36D27F", color2: "#0FA3A3", path: (id) => `#/brand/${id}/content/calendar` },
  { key: "list", labelKey: "contentOs.tab.list", color: "#FF9F3D", color2: "#FF4F4F", path: (id) => `#/brand/${id}/content/list` },
  { key: "copy", labelKey: "contentOs.tab.copy", color: "#FF6FAE", color2: "#B65CF0", path: (id) => `#/brand/${id}/content/copy` },
  { key: "series", labelKey: "contentOs.tab.series", color: "#F2C46D", color2: "#D9822B", path: (id) => `#/brand/${id}/content/series` },
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
  return `<a class="cl-backpill" href="#/brand/${brandId}/content" style="--cat:${tab.color};--cat2:${tab.color2};" aria-label="${escapeHtml(t("cl.back"))}">
      ${icon("chevronLeft", { size: 16 })}
      <span class="cl-backpill-art cl-pic">${createArtSVG(tab.key)}</span>
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

// What's inside each card, shown when it opens under the mouse — like
// pulling a file out of the drawer (owner, 2026-10-27: "dia bakal mbuka jadi
// lebih besar kaya kertas arsipan"): a few real pieces as paper slips.
const PEEK_MAX = 3;
const STEP_OF = { idea: "idea", draft: "script", production: "shoot", editing: "edit", scheduled: "upload" };
function peekItems(key, brandId) {
  const content = listContent(brandId);
  const today = localISODate();
  const untitled = (c) => c.title || t("common.untitled");
  if (key === "creator") {
    return content.filter(isOpenPiece)
      .sort((a, b) => (a.scheduleDate || "9999").localeCompare(b.scheduleDate || "9999"))
      .slice(0, PEEK_MAX)
      .map((c) => ({ title: untitled(c), meta: t(`cw.step.${STEP_OF[c.status] || "idea"}`), warn: !!(c.scheduleDate && c.scheduleDate < today) }));
  }
  if (key === "calendar") {
    const end = addDays(today, 6);
    const loc = getLang() === "en" ? "en-US" : "id-ID";
    return content.filter((c) => c.scheduleDate && c.scheduleDate >= today && c.scheduleDate <= end)
      .sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate))
      .slice(0, PEEK_MAX)
      .map((c) => ({ title: untitled(c), meta: c.scheduleDate === today ? t("nw.when.today") : new Date(`${c.scheduleDate}T00:00:00`).toLocaleDateString(loc, { weekday: "short", day: "numeric" }) }));
  }
  if (key === "list") return content.slice(0, PEEK_MAX).map((c) => ({ title: untitled(c), meta: statusLabel(c.status, STATUS_LABELS) }));
  if (key === "series") return listSeries(brandId).slice(0, PEEK_MAX).map((s) => ({ title: s.name || t("common.untitled"), meta: "" }));
  return t("cl.peek.copyItems").split(" · ").map((title) => ({ title, meta: "", chip: true }));
}

function peekHTML(key, brandId) {
  const items = peekItems(key, brandId);
  if (!items.length) return `<span class="cl-peek" aria-hidden="true"><span class="cl-slip is-empty">${escapeHtml(t(key === "series" ? "cl.peek.seriesNone" : "cl.peek.empty"))}</span></span>`;
  if (items[0].chip) return `<span class="cl-peek is-chips" aria-hidden="true">${items.map((x) => `<span class="cl-slip">${escapeHtml(x.title)}</span>`).join("")}</span>`;
  return `<span class="cl-peek" aria-hidden="true">${items.map((x, i) => `<span class="cl-slip${x.warn ? " is-warn" : ""}" style="--s:${i};"><span class="cl-slip-title">${escapeHtml(x.title)}</span>${x.meta ? `<span class="cl-slip-meta">${escapeHtml(x.meta)}</span>` : ""}</span>`).join("")}</span>`;
}

function landingHTML(brandId, brand, { animate }) {
  const cards = SUB_TABS.map((tab, i) => {
    const st = cardStatus(tab.key, brandId);
    return `
      <a class="cl-card" data-cat="${tab.key}" href="${tab.path(brandId)}" style="--cat:${tab.color};--cat2:${tab.color2};--i:${i};">
        <span class="cl-pill">${t(tab.labelKey)}</span>
        <span class="cl-sub">${t(`cl.cat.${tab.key}.sub`)}</span>
        <span class="cl-status${st.warn ? " is-warn" : ""}">${escapeHtml(st.text)}</span>
        ${peekHTML(tab.key, brandId)}
        <span class="cl-art cl-pic">${createArtSVG(tab.key)}</span>
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
    // A soft light follows the mouse over a card (like the Beranda cards).
    root.querySelectorAll(".cl-card").forEach((card) => card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${Math.round(e.clientX - r.left)}px`);
      card.style.setProperty("--my", `${Math.round(e.clientY - r.top)}px`);
    }));
  };
  paint();
  setPageGuide(() => startCreateLandingGuide());
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
    // Its own tour: the views, search, filter, a row, the numbers button.
    setPageGuide(() => startContentListGuide());
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
