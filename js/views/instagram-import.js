import { getBrand, listContent, createContent, updateContent, localISODate } from "../store.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay } from "../modals.js";
import { qs, qsa, escapeHtml, toast, formatNumber } from "../dom.js";
import { canUseInstagramApi } from "../account.js";
import { t, getLang } from "../i18n.js";
import { listRecentMedia, fetchMediaMetrics, shortcodeFromUrl, formatFromMedia, titleFromMedia, thumbnailFromMedia, igRef } from "../instagram.js";
import { platformRingHTML, openFetchPanel } from "../fetch-panel.js";

function normalizeCaption(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
const locale = () => (getLang() === "en" ? "en-US" : "id-ID");
const monthKey = (ts) => {
  const d = new Date(ts);
  return isNaN(d) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale(), { month: "long", year: "numeric" });
};
const dayLabel = (ts) => new Date(ts).toLocaleDateString(locale(), { day: "numeric", month: "short" });
const TYPE = {
  Reels: { icon: "play", key: "integr.import.type.reels" },
  Carousel: { icon: "layers", key: "integr.import.type.carousel" },
  "Short Video": { icon: "film", key: "integr.import.type.video" },
  "Static Post": { icon: "image", key: "integr.import.type.photo" },
};

// Your recent Instagram posts as a grid, grouped by month: tap the ones to
// bring into the Content Database (nothing is picked for you). Posts already
// in Brandlab sit in their own tab; a post whose caption matches a planned
// card says so and fills that card instead of adding a second one.
export async function openInstagramImportPicker(brandId, onImported) {
  if (!canUseInstagramApi()) {
    toast(t("integr.ig.importSoon"), "error");
    return;
  }
  const brand = getBrand(brandId);
  const ig = igRef(brand);
  const handle = ig?.username || brand?.instagram?.username || "";

  const overlay = openModal({
    title: t("integr.import.igTitle"),
    width: "min(980px, 94vw)",
    bodyHTML: `<div id="ig-picker-body" class="igi-body">
      <div class="igi-loading">
        ${platformRingHTML("instagram", { size: 76 })}
        <b>${escapeHtml(handle ? t("integr.import.loadingFrom", { user: handle }) : t("integr.import.igLoading"))}</b>
        <span>${escapeHtml(t("integr.import.loadingHint"))}</span>
      </div>
    </div>`,
    footHTML: `
      <span class="igi-count" id="ig-picker-count"></span>
      <button class="btn btn-secondary" id="ig-picker-cancel">${t("common.cancel")}</button>
      <button class="btn btn-primary" id="ig-picker-import" disabled>${icon("download", { size: 15 })}<span>${t("integr.import.ctaNone")}</span></button>
    `,
  });
  overlay.classList.add("igi");
  const bodyEl = overlay.querySelector("#ig-picker-body");
  const importBtn = overlay.querySelector("#ig-picker-import");
  const countEl = overlay.querySelector("#ig-picker-count");
  overlay.querySelector("#ig-picker-cancel").addEventListener("click", () => closeOverlay(overlay));

  let media;
  try {
    media = await listRecentMedia(ig, { maxItems: 100 });
  } catch (e) {
    bodyEl.innerHTML = errorRow(t("integr.import.igUnreachable", { msg: e.message }));
    return;
  }
  if (!overlay.isConnected) return;
  if (!media.length) {
    bodyEl.innerHTML = errorRow(t("integr.import.igEmpty"));
    return;
  }

  const existing = listContent(brandId, { includeArchived: true });
  const existingCodes = new Set(existing.map((c) => shortcodeFromUrl(c.publishedUrl)).filter(Boolean));

  // Content you already planned in Creator (idea/draft, no post link yet)
  // gets matched by caption instead of being duplicated — publishing the
  // exact caption you wrote should upgrade that same card, not create a
  // second one.
  const captionMatches = new Map(); // normalized caption -> content
  existing
    .filter((c) => !c.publishedUrl && c.caption && c.caption.trim())
    .forEach((c) => captionMatches.set(normalizeCaption(c.caption), c));

  const linkTargets = new Map(); // shortcode -> matched existing content (to update, not create)
  media.forEach((m) => {
    const code = shortcodeFromUrl(m.permalink);
    if (!code || existingCodes.has(code)) return;
    const match = captionMatches.get(normalizeCaption(m.caption));
    if (match) linkTargets.set(code, match);
  });

  const fresh = media.filter((m) => {
    const code = shortcodeFromUrl(m.permalink);
    return code && !existingCodes.has(code);
  });
  const already = media.filter((m) => !fresh.includes(m));
  const picked = new Set();
  let tab = fresh.length ? "new" : "in";

  const groups = (list) => {
    const out = new Map();
    for (const m of list) {
      const k = monthKey(m.timestamp);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(m);
    }
    return [...out.entries()];
  };

  function paint() {
    const list = tab === "new" ? fresh : already;
    bodyEl.innerHTML = `
      <div class="igi-head">
        <div class="igi-who">
          ${platformRingHTML("instagram", { size: 40 })}
          <div><b>${handle ? `@${escapeHtml(handle)}` : escapeHtml(t("integr.import.igTitle"))}</b>
          <span>${escapeHtml(t("integr.import.summary", { found: media.length, fresh: fresh.length }))}</span></div>
        </div>
        <div class="igi-tabs" role="tablist">
          <button type="button" role="tab" data-tab="new" aria-selected="${tab === "new"}">${escapeHtml(t("integr.import.tabNew", { count: fresh.length }))}</button>
          <button type="button" role="tab" data-tab="in" aria-selected="${tab === "in"}">${escapeHtml(t("integr.import.tabIn", { count: already.length }))}</button>
        </div>
      </div>
      ${tab === "new" ? `<p class="igi-hint">${escapeHtml(t("integr.import.hint"))}</p>` : ""}
      <div class="igi-scroll">
        ${list.length ? groups(list).map(([k, items]) => monthHTML(k, items, tab === "new")).join("") : `<p class="igi-empty">${escapeHtml(t(tab === "new" ? "integr.import.allIn" : "integr.import.noneIn"))}</p>`}
      </div>`;
    qsa("[data-tab]", bodyEl).forEach((b) => b.addEventListener("click", () => {
      tab = b.dataset.tab;
      paint();
    }));
    qsa(".igi-card[data-code]", bodyEl).forEach((card) => card.addEventListener("click", () => {
      const code = card.dataset.code;
      if (picked.has(code)) picked.delete(code);
      else picked.add(code);
      card.setAttribute("aria-pressed", String(picked.has(code)));
      syncMonthButtons();
      updateCount();
    }));
    qsa("[data-month]", bodyEl).forEach((b) => b.addEventListener("click", () => {
      const codes = qsa(`.igi-month[data-key="${b.dataset.month}"] .igi-card[data-code]`, bodyEl).map((c) => c.dataset.code);
      const all = codes.every((c) => picked.has(c));
      codes.forEach((c) => (all ? picked.delete(c) : picked.add(c)));
      qsa(`.igi-month[data-key="${b.dataset.month}"] .igi-card[data-code]`, bodyEl).forEach((c) => c.setAttribute("aria-pressed", String(picked.has(c.dataset.code))));
      syncMonthButtons();
      updateCount();
    }));
    syncMonthButtons();
  }

  function monthHTML(key, items, selectable) {
    return `<section class="igi-month" data-key="${key}">
      <div class="igi-month-head">
        <h3>${escapeHtml(monthLabel(key))}</h3>
        ${selectable ? `<button type="button" class="igi-month-all" data-month="${key}"></button>` : `<span class="igi-month-n">${items.length}</span>`}
      </div>
      <div class="igi-grid">${items.map((m) => cardHTML(m, selectable)).join("")}</div>
    </section>`;
  }

  function cardHTML(m, selectable) {
    const code = shortcodeFromUrl(m.permalink);
    const link = code ? linkTargets.get(code) : null;
    const thumb = thumbnailFromMedia(m);
    const type = TYPE[formatFromMedia(m)] || TYPE["Static Post"];
    const eng = [
      Number.isFinite(m.like_count) ? `${icon("heart", { size: 12 })}${formatNumber(m.like_count)}` : "",
      Number.isFinite(m.comments_count) ? `${icon("comment", { size: 12 })}${formatNumber(m.comments_count)}` : "",
    ].filter(Boolean).join("");
    const inner = `
      <span class="igi-thumb">
        ${thumb ? `<img src="${escapeHtml(thumb)}" loading="lazy" alt="" />` : `<span class="igi-noimg">${icon("image", { size: 22 })}</span>`}
        <span class="igi-type">${icon(type.icon, { size: 12 })}${escapeHtml(t(type.key))}</span>
        ${selectable ? `<span class="igi-tick">${icon("check", { size: 14 })}</span>` : `<span class="igi-in">${icon("check", { size: 12 })}${escapeHtml(t("integr.import.already"))}</span>`}
      </span>
      <span class="igi-meta"><span>${escapeHtml(dayLabel(m.timestamp))}</span>${eng ? `<span class="igi-eng">${eng}</span>` : ""}</span>
      <span class="igi-cap">${escapeHtml(titleFromMedia(m))}</span>
      ${link ? `<span class="igi-link">${icon("link", { size: 11 })}<span>${escapeHtml(t("integr.import.matchShort", { title: link.title || t("common.untitled") }))}</span></span>` : ""}`;
    return selectable
      ? `<button type="button" class="igi-card" data-code="${escapeHtml(code)}" aria-pressed="${picked.has(code)}">${inner}</button>`
      : `<div class="igi-card is-in">${inner}</div>`;
  }

  function syncMonthButtons() {
    qsa("[data-month]", bodyEl).forEach((b) => {
      const codes = qsa(`.igi-month[data-key="${b.dataset.month}"] .igi-card[data-code]`, bodyEl).map((c) => c.dataset.code);
      const all = codes.length && codes.every((c) => picked.has(c));
      b.textContent = all ? t("integr.import.unpickMonth") : t("integr.import.pickMonth", { count: codes.length });
    });
  }

  function updateCount() {
    const n = picked.size;
    importBtn.disabled = n === 0;
    importBtn.querySelector("span").textContent = n ? t("integr.import.cta", { count: n }) : t("integr.import.ctaNone");
    countEl.textContent = n ? t("integr.import.chosen", { count: n }) : "";
  }

  paint();
  updateCount();

  importBtn.addEventListener("click", async () => {
    const toImport = fresh.filter((m) => picked.has(shortcodeFromUrl(m.permalink)));
    if (!toImport.length) return;

    // The floating panel instead of holding this modal open — a big batch
    // shouldn't block using the rest of the app while it works through each one.
    closeOverlay(overlay);
    const panel = openFetchPanel({
      platform: "instagram",
      title: t("integr.import.panelTitle"),
      sub: brand?.name || "",
      firstStep: t("integr.import.panelStep", { done: 1, total: toImport.length, title: titleFromMedia(toImport[0]) }),
    });

    let created = 0;
    let linked = 0;
    let metricFails = 0;
    let done = 0;
    for (const m of toImport) {
      const code = shortcodeFromUrl(m.permalink);
      panel.step(t("integr.import.panelStep", { done: done + 1, total: toImport.length, title: titleFromMedia(m) }), (done / toImport.length) * 100);

      const linkTarget = linkTargets.get(code);
      const publishFields = {
        platform: "Instagram",
        format: formatFromMedia(m),
        status: "published",
        publishedUrl: m.permalink,
        publishedDate: localISODate(new Date(m.timestamp)),
      };

      let target;
      if (linkTarget) {
        target = updateContent(linkTarget.id, publishFields);
        linked++;
      } else {
        target = createContent(brandId, {
          title: titleFromMedia(m),
          caption: m.caption || "",
          thumbnail: thumbnailFromMedia(m),
          funnel: "TOFU",
          ...publishFields,
        });
        created++;
      }

      try {
        const { metrics } = await fetchMediaMetrics(ig, m);
        updateContent(target.id, { performance: metrics });
      } catch {
        metricFails++;
      }
      done++;
      panel.step("", (done / toImport.length) * 100);
      onImported?.();
    }

    panel.done({
      title: t("integr.import.doneTitle"),
      note: metricFails ? t("integr.import.needMetrics", { count: metricFails }) : "",
      stats: [
        created ? { n: created, label: t("integr.import.statNew") } : null,
        linked ? { n: linked, label: t("integr.import.statLinked") } : null,
      ],
    });
  });
}

function errorRow(message) {
  return `<div class="ocr-status" style="margin:0;">${icon("info", { size: 15 })}<span>${escapeHtml(message)}</span></div>`;
}
