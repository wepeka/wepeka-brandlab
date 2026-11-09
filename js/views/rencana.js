// Rencana — the Kalender's third view, next to Minggu and Bulan: the week
// on the Kalender's screen for the people who shoot it, Wepeka's team and
// its clients (owner, 2026-11-09, for Quatro: "nanti team atau clienku
// bakal check … plan minggu ini ngapain, ada referensi video, konsep konten,
// gearnya apa aja, dan notes yang harus dilakuin … bisa download dan check
// dari brandlab dengan mudah"; then "jangan buat tabs baru lagi, masukin aja
// di kalender"). Nothing new to fill in except Gear: it reads what Creator
// already holds (Ide = concept, Referensi = the videos, Catatan = notes,
// the script), day by day, and the same week downloads as one PDF whose
// video links stay clickable. js/views/calendar.js draws the head (arrows,
// week label, view switch) and mounts planBodyHTML + wirePlanBody.
//
// On Wepeka's own brands only, like the Antrean (canSeePlan): the account
// itself, and whoever it invited there (Kerja Tim, "Klien" included).
import { getBrand, listContent, listSeries, updateBrand, canEditBrand } from "../store.js";
import { isAdmin, currentUid } from "../account.js";
import { icon } from "../icons.js";
import { qs, qsa, escapeHtml, toast, formatDate, avatarHTML } from "../dom.js";
import { t } from "../i18n.js";
import { addDays } from "../goal-roadmap.js";
import { videoCode } from "../video-codes.js";
import { isCarouselContent } from "../script-format.js";
import { scriptPartBlocks } from "../script-pdf.js";
import { downloadPagedPdf, PDF_PAGE_BREAK } from "../pdf-libs.js";
import { weekPieces, byDay, parseRefs, gearItems, weekGear, youtubeThumb } from "../rencana.js";

export function canSeePlan(brandId) {
  if (isAdmin(currentUid())) return true;
  const b = getBrand(brandId);
  return !!b && isAdmin(b.ownerId);
}

const dayLong = (iso) => formatDate(`${iso}T00:00:00`, { weekday: "long", year: undefined });
const dayShort = (iso) => formatDate(`${iso}T00:00:00`, { weekday: "short", year: undefined });
const shortDate = (iso) => formatDate(`${iso}T00:00:00`, { year: undefined });
const rangeLabel = (from) => {
  const to = addDays(from, 6);
  return `${shortDate(from)} – ${formatDate(`${to}T00:00:00`)}`;
};
const isPosted = (c) => c.status === "published" || !!c.publishedDate;
const lines = (text) => escapeHtml(String(text || "").trim()).replace(/\n/g, "<br>");
// A paragraph of the reference field that only introduces the list
// ("Referensi video (pelajari polanya, jangan disalin):") — the section is
// already called that: keep only what it adds.
const refNote = (s) => s.replace(/^referensi(\s+video)?\s*/i, "").replace(/^\((.*)\)\s*:?$/s, "$1").replace(/:\s*$/, "").trim();
const SITE = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", link: "Link" };
const shortURL = (url) => url.replace(/^https?:\/\/(www\.|m\.)?/, "").replace(/\/$/, "").slice(0, 60);

// ---- On screen ---------------------------------------------------------------

function refCardHTML(r) {
  const thumb = r.kind === "youtube" ? youtubeThumb(r.id) : "";
  return `
    <a class="rc-ref is-${r.kind}" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">
      <span class="rc-ref-thumb"${thumb ? ` style="background-image:url('${escapeHtml(thumb)}')"` : ""}>
        <span class="rc-ref-play">${icon(r.kind === "link" ? "link" : r.kind, { size: 16 })}</span>
      </span>
      <span class="rc-ref-body">
        <b>${escapeHtml(r.title || t("rc.ref.untitled"))}</b>
        ${r.notes.map((n) => `<span class="rc-ref-note">${escapeHtml(n)}</span>`).join("")}
        <span class="rc-ref-site">${SITE[r.kind]} · ${t("rc.ref.watch")} ${icon("arrowRight", { size: 11 })}</span>
      </span>
    </a>`;
}

// The video cards and the lines around them ("" when the field is empty).
function refsBodyHTML(c) {
  const { refs, notes } = parseRefs(c.reference);
  if (!refs.length && !notes.length) return "";
  const intro = notes.map(refNote).filter(Boolean);
  return `
      ${refs.length ? `<div class="rc-refs">${refs.map(refCardHTML).join("")}</div>` : ""}
      ${intro.map((n) => `<p class="rc-muted">${lines(n)}</p>`).join("")}`;
}

function refsHTML(c) {
  const body = refsBodyHTML(c);
  if (!body) return "";
  return `
    <section class="rc-sec rc-sec-refs">
      <h5>${icon("play", { size: 13 })}${t("rc.sec.refs")}</h5>
      ${body}
    </section>`;
}

const gearSecHTML = (gear) => `<section class="rc-sec"><h5>${icon("box", { size: 13 })}${t("rc.sec.gear")}</h5><ul class="rc-gear">${gear.map((g) => `<li>${escapeHtml(g)}</li>`).join("")}</ul></section>`;
const notesSecHTML = (c) => (String(c.notes || "").trim() ? `<section class="rc-sec"><h5>${icon("edit", { size: 13 })}${t("rc.sec.notes")}</h5><p class="rc-text">${lines(c.notes)}</p></section>` : "");

function pieceHTML(c, { seriesName, canEdit, brandId }) {
  const code = videoCode(c);
  const gear = gearItems(c.gear);
  const time = c.posting?.time ? ` · ${escapeHtml(c.posting.time)}` : "";
  const tags = [c.format, seriesName].filter(Boolean);
  const script = String(c.script || "").trim();
  return `
    <article class="rc-piece">
      <header class="rc-piece-head">
        <div class="rc-tags">
          ${code ? `<span class="rc-code">${escapeHtml(code)}</span>` : ""}
          ${tags.map((x) => `<span class="rc-tag">${escapeHtml(x)}</span>`).join("")}
          ${isPosted(c) ? `<span class="rc-tag is-done">${icon("check", { size: 11 })}${t("rc.posted")}</span>` : ""}
        </div>
        <h4>${escapeHtml(c.title || t("common.untitled"))}</h4>
        <p class="rc-when">${icon("calendar", { size: 12 })}${t("rc.post", { when: escapeHtml(dayShort(c.scheduleDate)) })}${time}</p>
      </header>
      <div class="rc-cols">
        <div class="rc-col">
          ${String(c.idea || "").trim() ? `<section class="rc-sec"><h5>${icon("bulb", { size: 13 })}${t("rc.sec.idea")}</h5><p class="rc-text">${lines(c.idea)}</p></section>` : ""}
          ${refsHTML(c)}
        </div>
        <div class="rc-col">
          ${gear.length ? gearSecHTML(gear) : ""}
          ${notesSecHTML(c)}
        </div>
      </div>
      ${script || canEdit ? `<div class="rc-foot">
        ${script ? `<details class="rc-script" data-id="${escapeHtml(c.id)}"${OPEN.has(c.id) ? " open" : ""}><summary>${icon("chevronDown", { size: 13 })}${t(isCarouselContent(c) ? "rc.sec.slides" : "rc.script.show")}</summary><p class="rc-text">${lines(script)}</p></details>` : "<span></span>"}
        ${canEdit ? `<a class="rc-open" href="#/brand/${escapeHtml(brandId)}/content/creator/${escapeHtml(c.id)}">${t("rc.open")}${icon("arrowRight", { size: 12 })}</a>` : ""}
      </div>` : ""}
    </article>`;
}

// ---- Creator's Syuting step -------------------------------------------------
// The piece's plan, read-only, above its script (owner, 2026-11-09: "di ide
// aja masukkannya, di syuting bisa previewnya sama download pdf aja"):
// everything is filled on the Ide step. Gear shows; the reference videos and
// the notes (a whole shooting brief on Quatro) fold, so the script stays near
// the top. The piece downloads as its own PDF.
const PLAN_OPEN = new Set();

export function shootPlanHTML(c) {
  const gear = gearItems(c.gear);
  const refs = refsBodyHTML(c);
  const notes = String(c.notes || "").trim();
  const nRefs = parseRefs(c.reference).refs.length;
  const fold = (key, iconName, label, body) => `
        <details class="cw-plan-fold" data-plan-fold="${key}"${PLAN_OPEN.has(`${c.id}:${key}`) ? " open" : ""}>
          <summary>${icon("chevronDown", { size: 13 })}${icon(iconName, { size: 13 })}<span>${label}</span></summary>
          ${body}
        </details>`;
  const body = [
    gear.length ? gearSecHTML(gear) : "",
    refs ? fold("refs", "play", nRefs ? `${t("rc.sec.refs")} (${nRefs})` : t("rc.sec.refs"), refs) : "",
    notes ? fold("notes", "edit", t("rc.sec.notes"), `<p class="rc-text">${lines(notes)}</p>`) : "",
  ].join("");
  return `
    <section class="cw-plan">
      <div class="cw-plan-head">
        <b>${t("rc.shoot.title")}</b>
        <button type="button" class="btn btn-secondary btn-sm" id="cw-plan-pdf">${icon("download", { size: 14 })}<span>${t("rc.pdf")}</span></button>
      </div>
      ${body.trim() ? `<div class="cw-plan-body">${body}</div>` : `<p class="rc-muted">${t("rc.shoot.empty")}</p>`}
    </section>`;
}

// `getPiece`: the piece as it is now (the page may be older than the store).
export function wireShootPlan(root, getPiece) {
  const btn = qs("#cw-plan-pdf", root);
  btn?.addEventListener("click", () => downloadPiecePdf(getPiece(), btn));
  qsa("[data-plan-fold]", root).forEach((d) => d.addEventListener("toggle", () => {
    const key = `${getPiece()?.id}:${d.dataset.planFold}`;
    if (d.open) PLAN_OPEN.add(key); else PLAN_OPEN.delete(key);
  }));
}

function weekNotesHTML(brand, week, canEdit) {
  const text = brand.weekNotes?.[week] || "";
  if (!canEdit && !text.trim()) return "";
  return `
    <section class="rc-box rc-notes">
      <h3>${icon("flag", { size: 14 })}${t("rc.notes.title")}<span class="rc-saved" id="rc-notes-saved" hidden>${t("rc.notes.saved")}</span></h3>
      ${canEdit
        ? `<textarea class="textarea rc-notes-input" id="rc-notes" rows="3" placeholder="${escapeHtml(t("rc.notes.ph"))}">${escapeHtml(text)}</textarea>`
        : `<p class="rc-text">${lines(text)}</p>`}
    </section>`;
}

function gearBoxHTML(items, canEdit) {
  const rows = weekGear(items, videoCode);
  return `
    <section class="rc-box rc-gearbox">
      <h3>${icon("box", { size: 14 })}${t("rc.gear.title")}</h3>
      ${rows.length
        ? `<ul class="rc-gearlist">${rows.map((g) => `<li><span class="rc-tick" aria-hidden="true"></span><span><span class="rc-gear-name">${escapeHtml(g.name)}</span>${g.codes.length ? ` <span class="rc-gear-for">${escapeHtml(t("rc.gear.for", { codes: g.codes.join(", ") }))}</span>` : ""}</span></li>`).join("")}</ul>`
        : `<p class="rc-muted">${t(canEdit ? "rc.gear.none" : "rc.gear.noneTeam")}</p>`}
    </section>`;
}

// What stays open while the Kalender repaints (it does on every change).
const OPEN = new Set();

export function planBodyHTML(brandId, from) {
  const brand = getBrand(brandId);
  const canEdit = canEditBrand(brandId);
  const items = weekPieces(listContent(brandId), from);
  const seriesById = new Map(listSeries(brandId).map((s) => [s.id, s.name]));
  return `
    <div class="rc">
      <div class="rc-bar">
        <p class="rc-lead">${items.length ? `<b>${t("rc.count", { n: items.length })}</b> · ${t("rc.lead")}` : ""}</p>
        <div class="rc-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="rc-copy">${icon("link", { size: 14 })}<span>${t("rc.copy")}</span></button>
          <button type="button" class="cl-cta rc-pdf-btn" id="rc-pdf" ${items.length ? "" : "disabled"}><span>${t("rc.pdf")}</span><span class="cl-cta-dot rc-dot">${icon("download", { size: 16 })}</span></button>
        </div>
      </div>
      ${weekNotesHTML(brand, from, canEdit)}
      ${items.length ? `
        ${gearBoxHTML(items, canEdit)}
        ${byDay(items).map((d) => `
          <section class="rc-day">
            <h3>${escapeHtml(dayLong(d.date))}<span>${d.items.length}</span></h3>
            ${d.items.map((c) => pieceHTML(c, { seriesName: seriesById.get(c.seriesId) || "", canEdit, brandId })).join("")}
          </section>`).join("")}`
      : `
        <div class="rc-empty">
          <b>${t("rc.empty.title")}</b>
          <p>${t("rc.empty.body")}</p>
        </div>`}
    </div>`;
}

// Someone is typing this week's notes: the Kalender waits with its repaint.
export const planBusy = (root) => document.activeElement?.id === "rc-notes" && root.contains(document.activeElement);

// `onIdle`: called when the notes box loses focus, so a repaint held back
// while typing can happen now.
export function wirePlanBody(root, brandId, from, { onIdle = () => {} } = {}) {
  const pdfBtn = qs("#rc-pdf", root);
  pdfBtn?.addEventListener("click", () => { if (!pdfBtn.disabled) downloadWeekPdf(brandId, from, pdfBtn); });
  qs("#rc-copy", root)?.addEventListener("click", async () => {
    const url = `${location.origin}/#/brand/${brandId}/content/calendar/rencana`;
    try { await navigator.clipboard.writeText(url); } catch { /* the toast still says where */ }
    toast(t("rc.copied"));
  });
  qsa(".rc-script", root).forEach((d) => d.addEventListener("toggle", () => { if (d.open) OPEN.add(d.dataset.id); else OPEN.delete(d.dataset.id); }));
  const notes = qs("#rc-notes", root);
  if (!notes) return;
  const grow = () => { notes.style.height = "auto"; notes.style.height = `${Math.max(76, notes.scrollHeight + 2)}px`; };
  grow();
  notes.addEventListener("input", grow);
  notes.addEventListener("blur", () => {
    const brand = getBrand(brandId);
    const before = brand?.weekNotes?.[from] || "";
    if (brand && notes.value !== before) {
      const weekNotes = { ...(brand.weekNotes || {}) };
      if (notes.value.trim()) weekNotes[from] = notes.value;
      else delete weekNotes[from];
      updateBrand(brandId, { weekNotes });
      const saved = qs("#rc-notes-saved", root);
      if (saved) { saved.hidden = false; setTimeout(() => { saved.hidden = true; }, 1600); }
    }
    // After the click that took the focus away has landed.
    setTimeout(onIdle, 0);
  });
}

// ---- The PDF -----------------------------------------------------------------

const pdfPara = (text) => `<p class="sp-text">${lines(text)}</p>`;
const pdfTitle = (label) => `<div class="report-section-title">${escapeHtml(label)}</div>`;
// Long text in pieces of at most `max` lines, so a page can break between
// them (a block never splits across pages).
function chunks(text, max = 14) {
  const out = [];
  String(text || "").trim().replace(/\r\n?/g, "\n").split(/\n[ \t]*\n+/).forEach((para) => {
    const ls = para.split("\n");
    for (let i = 0; i < ls.length; i += max) out.push(ls.slice(i, i + max).join("\n"));
  });
  return out.filter((x) => x.trim());
}
function textBlocks(label, text) {
  return chunks(text).map((part, i) => `${i === 0 ? pdfTitle(label) : ""}${pdfPara(part)}`);
}

function pdfBlocks(brandId, week) {
  const brand = getBrand(brandId);
  const items = weekPieces(listContent(brandId), week);
  const seriesById = new Map(listSeries(brandId).map((s) => [s.id, s.name]));
  const notes = brand?.weekNotes?.[week] || "";
  const gear = weekGear(items, videoCode);
  const blocks = [`
    ${pdfHeaderHTML(brand, t("rc.pdf.cover", { range: rangeLabel(week) }))}
    <p class="sp-meta">${escapeHtml(t("rc.count", { n: items.length }))}</p>`];
  if (notes.trim()) blocks.push(...textBlocks(t("rc.notes.title"), notes));
  if (gear.length) {
    blocks.push(pdfTitle(t("rc.gear.title")));
    gear.forEach((g) => blocks.push(`<div class="rc-pdf-gear"><span class="rc-pdf-box"></span><b>${escapeHtml(g.name)}</b>${g.codes.length ? `<span>${escapeHtml(t("rc.gear.for", { codes: g.codes.join(", ") }))}</span>` : ""}</div>`));
  }
  blocks.push(pdfTitle(t("rc.pdf.list")));
  items.forEach((c, i) => blocks.push(`
    <div class="sp-toc-row">
      <span class="sp-toc-n">${i + 1}</span>
      <span class="sp-toc-d">${escapeHtml(dayShort(c.scheduleDate))}</span>
      <span class="sp-toc-t">${escapeHtml([videoCode(c), c.title || t("common.untitled")].filter(Boolean).join(" · "))}</span>
      <span class="sp-toc-l">${escapeHtml(c.format || "")}</span>
    </div>`));

  items.forEach((c, i) => {
    blocks.push(PDF_PAGE_BREAK);
    blocks.push(...pieceBlocks(c, { lead: t("rc.pdf.num", { i: i + 1, n: items.length }), seriesName: seriesById.get(c.seriesId) }));
  });
  return blocks;
}

// One piece: its date, code and title, then concept, reference videos (the
// links stay clickable), gear, notes and the script.
function pieceBlocks(c, { lead = "", seriesName = "" } = {}) {
  const blocks = [];
  const when = c.scheduleDate ? dayLong(c.scheduleDate) + (c.posting?.time ? ` · ${c.posting.time}` : "") : "";
  const meta = [lead, when, videoCode(c), c.format, seriesName].filter(Boolean);
  blocks.push(`
    <p class="sp-meta">${meta.map(escapeHtml).join(" · ")}</p>
    <div class="rc-pdf-title">${escapeHtml(c.title || t("common.untitled"))}</div>`);
  if (String(c.idea || "").trim()) blocks.push(...textBlocks(t("rc.sec.idea"), c.idea));
  const { refs, notes: refNotes } = parseRefs(c.reference);
  if (refs.length) {
    refs.forEach((r, k) => {
      const thumb = r.kind === "youtube" ? youtubeThumb(r.id) : "";
      blocks.push(`${k === 0 ? `${pdfTitle(t("rc.sec.refs"))}<p class="rc-pdf-tap">${escapeHtml(t("rc.pdf.tap"))}</p>` : ""}
        <div class="rc-pdf-ref">
          <a class="rc-pdf-thumb is-${r.kind}" href="${escapeHtml(r.url)}">${thumb ? `<img src="${escapeHtml(thumb)}" crossorigin="anonymous" alt="">` : `<span>${SITE[r.kind]}</span>`}</a>
          <div class="rc-pdf-ref-body">
            <b>${escapeHtml(r.title || t("rc.ref.untitled"))}</b>
            ${r.notes.map((n) => `<p>${escapeHtml(n)}</p>`).join("")}
            <a href="${escapeHtml(r.url)}">${escapeHtml(SITE[r.kind])} · ${escapeHtml(shortURL(r.url))}</a>
          </div>
        </div>`);
    });
    const extra = refNotes.map(refNote).filter(Boolean);
    if (extra.length) blocks.push(extra.map((n) => `<p class="rc-pdf-tap">${lines(n)}</p>`).join(""));
  } else if (refNotes.length) {
    blocks.push(...textBlocks(t("rc.sec.refs"), refNotes.join("\n\n")));
  }
  const g = gearItems(c.gear);
  if (g.length) blocks.push(`${pdfTitle(t("rc.sec.gear"))}<p class="sp-text">${g.map(escapeHtml).join(" · ")}</p>`);
  if (String(c.notes || "").trim()) blocks.push(...textBlocks(t("rc.sec.notes"), c.notes));
  if (String(c.script || "").trim()) blocks.push(...scriptPartBlocks(c, { heading: t(isCarouselContent(c) ? "rc.sec.slides" : "rc.sec.script") }));
  return blocks;
}

function pdfHeaderHTML(brand, label) {
  return `
    <div class="report-header">
      ${avatarHTML(brand || { name: "?" }, "width:44px;height:44px;border-radius:10px;font-size:16px;")}
      <div>
        <div class="report-brand">${escapeHtml(label)}</div>
        <div class="report-title">${escapeHtml(brand?.name || "")}</div>
      </div>
      <div class="report-range"><div class="report-generated">${escapeHtml(t("rc.pdf.generated", { date: formatDate(new Date().toISOString()) }))}</div></div>
    </div>`;
}

const fileSlug = (text) => String(text || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40).toLowerCase();

async function downloadWeekPdf(brandId, week, btn) {
  if (!weekPieces(listContent(brandId), week).length) { toast(t("rc.pdf.none"), "error"); return; }
  const brand = getBrand(brandId);
  await makePdf(btn, {
    busyHTML: `<span>${t("rc.pdf.making", { done: 0, total: "…" })}</span><span class="cl-cta-dot rc-dot"><span class="spinner" style="width:14px;height:14px;"></span></span>`,
    brand,
    blocks: pdfBlocks(brandId, week),
    filename: `rencana-minggu-${week}-${fileSlug(brand?.name) || "brand"}.pdf`,
  });
}

// Creator's Syuting step: this piece alone.
export async function downloadPiecePdf(c, btn) {
  if (!c || btn.disabled) return;
  const brand = getBrand(c.brandId);
  const seriesName = listSeries(c.brandId).find((s) => s.id === c.seriesId)?.name || "";
  await makePdf(btn, {
    busyHTML: `<span class="spinner" style="width:13px;height:13px;"></span><span>${t("rc.pdf.making", { done: 0, total: "…" })}</span>`,
    brand,
    blocks: [pdfHeaderHTML(brand, t("rc.shoot.title")), ...pieceBlocks(c, { seriesName })],
    filename: `rencana-syuting-${fileSlug([videoCode(c), c.title].filter(Boolean).join(" ")) || "konten"}.pdf`,
  });
}

async function makePdf(btn, { busyHTML, brand, blocks, filename }) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = busyHTML;
  const status = () => [...btn.querySelectorAll("span")].find((s) => !s.classList.contains("spinner") && !s.querySelector(".spinner"));
  try {
    await downloadPagedPdf({
      blocks,
      pageClass: "report-sheet script-sheet rc-pdf",
      footer: (n, total) => `Wepeka Brandlab — ${brand?.name || ""} · ${n}/${total}`,
      filename,
      links: true,
      onProgress: (done, total) => { const s = status(); if (s) s.textContent = t("rc.pdf.making", { done, total }); },
    });
    toast(t("rc.pdf.saved"));
  } catch (e) {
    console.error("Rencana PDF failed", e);
    toast(t("rc.pdf.failed"), "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
}
