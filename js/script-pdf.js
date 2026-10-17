// Scripts as PDFs for whoever shoots or edits them (an editor, a client, the
// crew on shoot day). One script from Creator (openScriptPdfPreview), or many
// at once — a whole series, or any pick — as one PDF (openScriptBulkPdf).
// Both use the same sheet (scriptSheetBlocks).
import { getBrand, listContent, listSeries, localISODate } from "./store.js";
import { icon } from "./icons.js";
import { escapeHtml, formatDate, toast, avatarHTML, qs, qsa } from "./dom.js";
import { openModal, closeOverlay } from "./modals.js";
import { t } from "./i18n.js";
import { parseScript, beatTimeline, scriptLength, parseSlides, isCarouselContent } from "./script-format.js";
import { downloadPagedPdf, PDF_PAGE_BREAK } from "./pdf-libs.js";
import { addDays } from "./goal-roadmap.js";

// A script's length as the PDF states it: a beat script by its timeline, other
// text by its spoken words; a carousel has none (0).
function scriptSeconds(c) {
  if (isCarouselContent(c)) return 0;
  const parsed = parseScript(String(c.script || "").replace(/\r\n?/g, "\n"));
  return parsed ? beatTimeline(parsed.beats).pop().to : scriptLength(c.script).seconds;
}

const fileSlug = (text) => String(text || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60).toLowerCase();

// "Unduh PDF" makes a real .pdf (html2canvas + jsPDF, js/pdf-libs.js — like
// the Brand Book, report and Brand DNA); "Cetak" still goes through the browser.
export function openScriptPdfPreview(content, brand) {
  const blocks = scriptSheetBlocks(content, brand);
  const overlay = openModal({
    title: t("cr.pdf.title"),
    wide: true,
    bodyHTML: `<div class="report-preview-wrap script-preview-wrap"><div class="report-sheet script-sheet" id="script-pdf-sheet">${blocks.join("")}<div class="report-footer">Wepeka Brandlab — ${escapeHtml(brand?.name || "")}</div></div></div>`,
    footHTML: `
      <button class="btn btn-secondary" id="script-pdf-print">${icon("layers", { size: 14 })}${t("cr.pdf.print")}</button>
      <button class="btn btn-primary" id="script-pdf-download">${icon("download", { size: 14 })}${t("cr.pdf.download")}</button>
    `,
  });
  overlay.querySelector("#script-pdf-print").addEventListener("click", () => window.print());
  const dlBtn = overlay.querySelector("#script-pdf-download");
  dlBtn.addEventListener("click", async () => {
    if (dlBtn.disabled) return;
    const label = dlBtn.innerHTML;
    dlBtn.disabled = true;
    dlBtn.innerHTML = `<span class="spinner" style="width:14px;height:14px;"></span>${t("cr.pdf.making")}`;
    try {
      await downloadPagedPdf({
        blocks,
        pageClass: "report-sheet script-sheet",
        footer: (n, total) => `Wepeka Brandlab — ${brand?.name || ""} · ${n}/${total}`,
        filename: `${fileSlug(content.title || brand?.name) || "script"}-script.pdf`,
      });
      toast(t("cr.pdf.saved"));
    } catch (e) {
      console.error("Script PDF failed", e);
      toast(t("cr.pdf.failed"), "error");
    } finally {
      dlBtn.disabled = false;
      dlBtn.innerHTML = label;
    }
  });
}

// The sheet as separate blocks, so the PDF can break pages between them
// (never inside a part of the script). A beat script is laid out as a
// shooting table: time and part | what to show | what to say, one row per
// part, so it reads like a rundown on set. `meta` goes in front of the
// format/platform/length line (the bulk PDF puts "Script 2/9" and the date there).
export function scriptSheetBlocks(c, brand, { meta: lead = [] } = {}) {
  const para = (text) => `<p class="sp-text">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  const title = (label) => `<div class="report-section-title">${label}</div>`;
  const script = String(c.script || "").replace(/\r\n?/g, "\n");
  const carousel = isCarouselContent(c);
  const parsed = carousel ? null : parseScript(script);
  const { words } = scriptLength(script);
  const meta = [...lead, c.format, c.platform, !carousel && words ? t("cr.pdf.length", { s: scriptSeconds(c), w: words }) : ""].filter(Boolean);
  const blocks = [`
    <div class="report-header">
      ${avatarHTML(brand || { name: "?" }, "width:44px;height:44px;border-radius:10px;font-size:16px;")}
      <div>
        <div class="report-brand">${escapeHtml(c.title || t("common.untitled"))}</div>
        <div class="report-title">${escapeHtml(brand?.name || "")}</div>
      </div>
      <div class="report-range">
        <div class="report-generated">${t("cr.pdf.generated", { date: formatDate(new Date().toISOString()) })}</div>
      </div>
    </div>
    ${meta.length ? `<p class="sp-meta">${meta.map(escapeHtml).join(" · ")}</p>` : ""}`];
  if (String(c.idea || "").trim()) blocks.push(`${title(t("cr.pdf.idea"))}${para(c.idea.trim())}`);

  const scriptTitle = title(carousel ? t("cr.f.slides") : t("cr.pdf.script"));
  if (parsed) {
    const cell = (label, text, cls = "") => (String(text || "").trim() ? `<div class="sp-k">${escapeHtml(label)}</div><p class="sp-text${cls}">${escapeHtml(text.trim()).replace(/\n/g, "<br>")}</p>` : "");
    const row = (b, i) => `
      <div class="sp-beat${i === 0 ? " is-hook" : ""}">
        <div class="sp-part"><em>${escapeHtml(b.label)}</em></div>
        <div class="sp-show">${cell(t("cr.cards.visual"), b.visual)}${cell(t("cr.cards.screen"), b.onScreen, " sp-screen")}${cell(t("cr.cards.note"), b.note)}${!b.visual && !b.onScreen && !b.note ? `<p class="sp-text sp-none">—</p>` : ""}</div>
        <div class="sp-say"><div class="sp-k sp-say-k">${t("cr.pdf.colSay")}</div>${String(b.say || "").trim() ? `<p>${escapeHtml(b.say.trim()).replace(/\n/g, "<br>")}</p>` : `<p class="sp-none">—</p>`}</div>
      </div>`;
    const head = `<div class="sp-cols"><span>${t("cr.pdf.colPart")}</span><span>${t("cr.pdf.colShow")}</span><span>${t("cr.pdf.colSay")}</span></div>`;
    // The section title and column heads stay with the first part.
    blocks.push(`${scriptTitle}${parsed.preamble ? para(parsed.preamble) : ""}${head}${row(parsed.beats[0], 0)}`);
    parsed.beats.slice(1).forEach((b, i) => blocks.push(row(b, i + 1)));
  } else if (carousel && script.trim()) {
    const slides = parseSlides(script);
    slides.forEach((sl, i) => blocks.push(`${i === 0 ? scriptTitle : ""}<div class="sp-slide"><span class="sp-slide-num">${escapeHtml(t("cr.ai.slideLabel", { n: i + 1 }))}</span>${para(sl.text || "—")}</div>`));
  } else {
    const paras = script.split(/\n[ \t]*\n+/).map((p) => p.trim()).filter(Boolean);
    if (!paras.length) blocks.push(`${scriptTitle}${para("—")}`);
    paras.forEach((p, i) => blocks.push(`${i === 0 ? scriptTitle : ""}${para(p)}`));
  }
  if (String(c.caption || "").trim()) blocks.push(`${title(t("cr.pdf.caption"))}${para(c.caption.trim())}`);
  return blocks;
}

// ---------- Many scripts, one PDF ----------

const SCOPE_ALL = "";
const SCOPE_NONE = "__none";

const hasScript = (c) => !!String(c.script || "").trim();
const isPublished = (c) => c.status === "published" || !!c.publishedDate;
const dateOf = (c) => String(c.scheduleDate || c.publishedDate || "").slice(0, 10);
const dayLabel = (iso) => (iso ? formatDate(`${iso}T00:00:00`, { weekday: "short", year: undefined }) : t("cr.bulk.noDate"));

// A week is picked by its first day ("" = any date), and a week here is the
// Kalender's (Sunday to Saturday), so "Minggu ini" names the same seven days
// as the week view next to it. Its label: "11 Okt – 17 Okt".
const calWeekStart = (iso) => addDays(iso, -new Date(`${iso}T00:00:00`).getDay());
const shortDay = (iso) => formatDate(`${iso}T00:00:00`, { year: undefined });
const weekRangeLabel = (first) => `${shortDay(first)} – ${shortDay(addDays(first, 6))}`;

// The pieces in a scope (and week), in shooting order: dated ones by date,
// then the undated ones (Bank Konten) oldest first. A piece posted to two
// platforms (mirror twins) shares one script, so it is listed once.
function scopeItems(brandId, scope, week = "") {
  const seen = new Set();
  return listContent(brandId)
    .filter((c) => (scope === SCOPE_ALL ? true : scope === SCOPE_NONE ? !c.seriesId : c.seriesId === scope))
    .filter((c) => !week || (dateOf(c) >= week && dateOf(c) <= addDays(week, 6)))
    .sort((a, b) => {
      const da = dateOf(a), db = dateOf(b);
      if (da && db && da !== db) return da.localeCompare(db);
      if (!da !== !db) return da ? -1 : 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    })
    .filter((c) => {
      if (!c.mirrorGroupId) return true;
      if (seen.has(c.mirrorGroupId)) return false;
      seen.add(c.mirrorGroupId);
      return true;
    });
}

// A picker of every script in a series (or all content), for any date or one
// week, each one ticked or not, then one PDF: a contents page, and every
// script from a fresh page. Pieces not yet posted start ticked — the usual
// job is the scripts for the next shoot; a set that is all posted starts
// with everything ticked. `week`: "this", or any day of the week to open on
// (Kalender passes the week it shows).
export function openScriptBulkPdf({ brandId, seriesId = "", week = "" } = {}) {
  const brand = getBrand(brandId);
  if (!brand) return;
  const series = listSeries(brandId);
  const seriesById = new Map(series.map((s) => [s.id, s]));
  const thisWeek = calWeekStart(localISODate());
  const nextWeek = addDays(thisWeek, 7);
  const openWeek = week === "this" ? thisWeek : week ? calWeekStart(week) : "";
  const weeks = [
    { key: "", label: t("cr.bulk.weekAll") },
    { key: thisWeek, label: t("cr.bulk.weekThis", { range: weekRangeLabel(thisWeek) }) },
    { key: nextWeek, label: t("cr.bulk.weekNext", { range: weekRangeLabel(nextWeek) }) },
  ];
  if (openWeek && !weeks.some((w) => w.key === openWeek)) weeks.push({ key: openWeek, label: t("cr.bulk.weekOf", { range: weekRangeLabel(openWeek) }) });
  const weekName = (key) => (key === thisWeek ? t("cr.bulk.weekThisShort") : key === nextWeek ? t("cr.bulk.weekNextShort") : "");
  // The PDF's title: the series (or "Semua konten" when there is no week to
  // name it by), then the week — "Minggu ini · 12 Okt – 18 Okt".
  const pdfName = (scope, wk) => [
    scope === SCOPE_ALL ? (wk ? "" : t("cr.bulk.scopeAll")) : scope === SCOPE_NONE ? t("cr.bulk.scopeNone") : seriesById.get(scope)?.name || t("common.untitled"),
    wk ? [weekName(wk), weekRangeLabel(wk)].filter(Boolean).join(" · ") : "",
  ].filter(Boolean).join(" · ");
  const scopeLabelFor = (scope) => (scope === SCOPE_NONE ? t("cr.bulk.scopeNone") : seriesById.get(scope)?.name || "");
  const state = { scope: seriesById.has(seriesId) ? seriesId : SCOPE_ALL, week: openWeek, items: [], picked: new Set(), busy: false };

  const overlay = openModal({
    title: t("cr.bulk.title"),
    wide: true,
    bodyHTML: `
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">${t("cr.bulk.sub")}</p>
      <div class="sbulk-bar">
        ${series.length ? `<select class="select" id="sbulk-scope" aria-label="${escapeHtml(t("cr.bulk.scopeAria"))}">
          <option value="${SCOPE_ALL}">${escapeHtml(t("cr.bulk.scopeAll"))}</option>
          ${series.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name || t("common.untitled"))}</option>`).join("")}
          <option value="${SCOPE_NONE}">${escapeHtml(t("cr.bulk.scopeNone"))}</option>
        </select>` : ""}
        <select class="select" id="sbulk-week" aria-label="${escapeHtml(t("cr.bulk.weekAria"))}">
          ${weeks.map((w) => `<option value="${w.key}">${escapeHtml(w.label)}</option>`).join("")}
        </select>
        <label class="sbulk-all"><input type="checkbox" id="sbulk-all" />${t("cr.bulk.pickAll")}</label>
      </div>
      <div class="auto-schedule-list sbulk-list" id="sbulk-list"></div>
      <p class="text-faint sbulk-missing" id="sbulk-missing"></p>
    `,
    footHTML: `
      <button class="btn btn-secondary" id="sbulk-cancel">${t("common.cancel")}</button>
      <button class="btn btn-primary" id="sbulk-go">${icon("download", { size: 14 })}<span></span></button>
    `,
  });
  const listEl = qs("#sbulk-list", overlay);
  const allBox = qs("#sbulk-all", overlay);
  const goBtn = qs("#sbulk-go", overlay);
  const scopeSel = qs("#sbulk-scope", overlay);
  const weekSel = qs("#sbulk-week", overlay);
  if (scopeSel) scopeSel.value = state.scope;
  weekSel.value = state.week;

  const syncPicked = () => {
    const n = state.picked.size;
    allBox.checked = !!n && n === state.items.length;
    allBox.indeterminate = !!n && n < state.items.length;
    allBox.disabled = !state.items.length || state.busy;
    if (!state.busy) {
      goBtn.querySelector("span").textContent = t("cr.bulk.download", { n });
      goBtn.disabled = !n;
    }
  };

  const paintList = () => {
    const all = scopeItems(brandId, state.scope, state.week);
    state.items = all.filter(hasScript);
    const fresh = state.items.filter((c) => !isPublished(c));
    state.picked = new Set((fresh.length ? fresh : state.items).map((c) => c.id));
    const missing = all.length - state.items.length;
    const showSeries = state.scope === SCOPE_ALL;
    listEl.innerHTML = state.items.length
      ? state.items.map((c) => {
          const seconds = scriptSeconds(c);
          const meta = [showSeries && c.seriesId ? seriesById.get(c.seriesId)?.name : "", seconds ? t("cr.bulk.secs", { s: seconds }) : "", isPublished(c) ? t("cr.bulk.published") : ""].filter(Boolean);
          return `
            <label class="auto-schedule-row sbulk-row">
              <input type="checkbox" data-sbulk-pick="${escapeHtml(c.id)}" ${state.picked.has(c.id) ? "checked" : ""} />
              <span class="sbulk-date${dateOf(c) ? "" : " is-none"}">${escapeHtml(dayLabel(dateOf(c)))}</span>
              <span class="sbulk-main">
                <span class="auto-schedule-title">${escapeHtml(c.title || t("common.untitled"))}</span>
                ${meta.length ? `<span class="sbulk-meta">${meta.map(escapeHtml).join(" · ")}</span>` : ""}
              </span>
            </label>`;
        }).join("")
      : `<div class="sbulk-empty">${icon("edit", { size: 16 })}<span>${t(state.week ? "cr.bulk.emptyWeek" : "cr.bulk.empty")}</span></div>`;
    qs("#sbulk-missing", overlay).textContent = missing && state.items.length ? t("cr.bulk.missing", { n: missing }) : "";
    qsa("[data-sbulk-pick]", listEl).forEach((box) => box.addEventListener("change", () => {
      if (box.checked) state.picked.add(box.dataset.sbulkPick);
      else state.picked.delete(box.dataset.sbulkPick);
      syncPicked();
    }));
    syncPicked();
  };

  scopeSel?.addEventListener("change", () => {
    state.scope = scopeSel.value;
    paintList();
  });
  weekSel.addEventListener("change", () => {
    state.week = weekSel.value;
    paintList();
  });
  allBox.addEventListener("change", () => {
    state.picked = new Set(allBox.checked ? state.items.map((c) => c.id) : []);
    qsa("[data-sbulk-pick]", listEl).forEach((box) => { box.checked = allBox.checked; });
    syncPicked();
  });
  qs("#sbulk-cancel", overlay).addEventListener("click", () => closeOverlay(overlay));

  goBtn.addEventListener("click", async () => {
    const chosen = state.items.filter((c) => state.picked.has(c.id));
    if (!chosen.length || state.busy) return;
    const name = pdfName(state.scope, state.week);
    const label = goBtn.innerHTML;
    state.busy = true;
    goBtn.disabled = true;
    if (scopeSel) scopeSel.disabled = true;
    weekSel.disabled = true;
    qsa("input", listEl).forEach((box) => { box.disabled = true; });
    syncPicked();
    goBtn.innerHTML = `<span class="spinner" style="width:14px;height:14px;"></span><span>${t("cr.pdf.making")}</span>`;
    try {
      await downloadPagedPdf({
        blocks: bulkBlocks(chosen, brand, name, state.scope === SCOPE_ALL ? seriesById : null),
        pageClass: "report-sheet script-sheet",
        footer: (n, total) => `Wepeka Brandlab — ${brand.name || ""} · ${name} · ${n}/${total}`,
        filename: `${[fileSlug(brand.name), state.scope === SCOPE_ALL ? "" : fileSlug(scopeLabelFor(state.scope)), state.week].filter(Boolean).join("-") || "brand"}-script.pdf`,
        onProgress: (done, total) => {
          const span = goBtn.querySelector("span:last-child");
          if (span) span.textContent = t("cr.bulk.making", { done, total });
        },
      });
      toast(t("cr.bulk.saved", { n: chosen.length }));
    } catch (e) {
      console.error("Bulk script PDF failed", e);
      toast(t("cr.bulk.failed"), "error");
    } finally {
      state.busy = false;
      goBtn.innerHTML = label;
      if (scopeSel) scopeSel.disabled = false;
      weekSel.disabled = false;
      qsa("input", listEl).forEach((box) => { box.disabled = false; });
      syncPicked();
    }
  });

  paintList();
}

// Contents page first (number, date, title, length), then each script from
// a fresh page with "Script 2/9 · date" on top. One script needs no contents.
// `seriesById` is given when the PDF mixes series: each script then says its own.
function bulkBlocks(items, brand, name, seriesById) {
  const total = items.length;
  const blocks = [];
  if (total > 1) {
    blocks.push(`
      <div class="report-header">
        ${avatarHTML(brand || { name: "?" }, "width:44px;height:44px;border-radius:10px;font-size:16px;")}
        <div>
          <div class="report-brand">${escapeHtml(name)}</div>
          <div class="report-title">${escapeHtml(brand?.name || "")}</div>
        </div>
        <div class="report-range">
          <div class="report-generated">${t("cr.pdf.generated", { date: formatDate(new Date().toISOString()) })}</div>
        </div>
      </div>
      <p class="sp-meta">${escapeHtml(t("cr.bulk.count", { n: total }))}</p>
      <div class="report-section-title">${t("cr.bulk.contents")}</div>`);
    items.forEach((c, i) => {
      const seconds = scriptSeconds(c);
      const sub = [seriesById && c.seriesId ? seriesById.get(c.seriesId)?.name : "", seconds ? t("cr.bulk.secs", { s: seconds }) : ""].filter(Boolean).join(" · ");
      blocks.push(`
        <div class="sp-toc-row">
          <span class="sp-toc-n">${i + 1}</span>
          <span class="sp-toc-d">${escapeHtml(dayLabel(dateOf(c)))}</span>
          <span class="sp-toc-t">${escapeHtml(c.title || t("common.untitled"))}</span>
          <span class="sp-toc-l">${escapeHtml(sub)}</span>
        </div>`);
    });
  }
  items.forEach((c, i) => {
    if (blocks.length) blocks.push(PDF_PAGE_BREAK);
    const lead = [total > 1 ? t("cr.bulk.num", { i: i + 1, n: total }) : "", dateOf(c) ? dayLabel(dateOf(c)) : "", seriesById && c.seriesId ? seriesById.get(c.seriesId)?.name : ""];
    blocks.push(...scriptSheetBlocks(c, brand, { meta: lead.filter(Boolean) }));
  });
  return blocks;
}
