// Antrean Video (Create → Antrean): "what do I do now" for every video, next
// to the Kalender's "when" (owner, 2026-11-01: "dimana aku bisa lihat list
// video … jangan dimasukin calender gak sih?"). One set of pieces, three
// ways to look, each a habit people already have:
//   Galeri  — every Instagram piece from Creator as a gallery, day by day,
//             each with its code (KP-12) to tell Claude, its cover and hour,
//             its trial cuts (KP-12B) right after it (owner, 2026-11-02).
//   Feed    — the Instagram profile grid, to see the feed before it posts.
//   Review  — the waiting cuts full screen, one after another, like Reels.
// Private to Wepeka's own account (canUsePosting), like the rest of it.
import { listBrands, listContent, getBrand, getContent, onChange, localISODate } from "../store.js";
import { icon } from "../icons.js";
import { qs, qsa, escapeHtml } from "../dom.js";
import { t, getLang } from "../i18n.js";
import { createArtSVG } from "../create-art.js";
import { weekStart, addDays } from "../goal-roadmap.js";
import { canUsePosting, postingState, openPosting, usesOutbox, ensureOutbox, outboxInfo, linkOutbox, versionLabelOf, latestVersion, stateColor, stateLabelOf, decide, copyCode, editorChip } from "../posting.js";
import { outboxThumb, outboxFileURL } from "../outbox.js";
import { syncOutbox, pickBrand } from "../outbox-sync.js";
import { ensureCodes, videoCode, codedPiece } from "../video-codes.js";
import { listRecentMedia, thumbnailFromMedia, testConnection } from "../instagram.js";
import { canUseInstagramApi } from "../account.js";

// The status chips over the list; "scheduled" also holds a failed post.
const FILTERS = ["all", "none", "review", "client", "revision", "ready", "scheduled", "published"];
const filterOf = (state) => (state === "failed" ? "scheduled" : state);
const VIEW_KEY = "posting:queueView";

function rangeOf(period) {
  const today = localISODate();
  if (period === "week") { const a = weekStart(today); return [a, addDays(a, 6)]; }
  if (period === "next") { const a = addDays(weekStart(today), 7); return [a, addDays(a, 6)]; }
  if (period === "month") { const a = `${today.slice(0, 7)}-01`; const d = new Date(`${a}T00:00:00`); d.setMonth(d.getMonth() + 1); d.setDate(0); return [a, localISODate(d)]; }
  return null;
}

const isIG = (c) => !c.platform || /instagram/i.test(c.platform);
// Every coded piece of the picked brand(s) in the period: from an idea in
// Creator to what already went out.
function pieces({ brandId, period }) {
  const range = rangeOf(period);
  const inRange = (d) => !range || (d && d >= range[0] && d <= range[1]);
  const brands = listBrands().filter((b) => brandId === "all" || b.id === brandId);
  return brands.flatMap((brand) => listContent(brand.id).filter(codedPiece).map((c) => ({ brand, c, state: postingState(c) })))
    .filter(({ c }) => inRange(c.scheduleDate));
}

function whenLabel(c) {
  if (!c.scheduleDate) return t("pq.noDate");
  const today = localISODate();
  const time = c.posting?.time ? ` ${c.posting.time}` : "";
  if (c.scheduleDate === today) return `${t("pq.today")}${time}`;
  if (c.scheduleDate === addDays(today, 1)) return `${t("pq.tomorrow")}${time}`;
  const d = new Date(`${c.scheduleDate}T00:00:00`);
  return `${d.toLocaleDateString(getLang() === "en" ? "en-US" : "id-ID", { weekday: "short", day: "numeric", month: "short" })}${time}`;
}
const TYPE_ICON = { reels: "play", carousel: "layers", foto: "image", story: "clock" };

function thumbHTML(c, cls = "pq-tile-img") {
  return `<span class="${cls}" data-thumb="${escapeHtml(c.id)}">${icon(TYPE_ICON[c.posting?.type] || "play", { size: 18 })}</span>`;
}

// One tile of the gallery (owner, 2026-11-02: "list videonya dibuat kaya
// galeri jadi gak pusing"): the cover big, its code, where it stands, and
// under it only the title and the hour. Everything else is one tap away.
function tileHTML({ c, state, sub }) {
  const n = c.posting?.versions?.length || 0;
  const type = c.posting?.type || { Reels: "reels", Carousel: "carousel", "Static Post": "foto", Story: "story" }[c.format] || "reels";
  const code = videoCode(c);
  const time = c.posting?.time;
  const empty = state === "none";
  // At the editor (Claude), or its revision just in: said instead of the state.
  const ed = editorChip(c);
  return `<article class="pq-g ${sub ? "is-trial" : ""} ${empty ? "is-empty" : ""}" style="--pst:${stateColor(state)}">
      <button type="button" class="pq-g-media" data-open="${escapeHtml(c.id)}" aria-label="${escapeHtml(`${code} ${c.title || ""}`.trim())}">
        <span class="pq-g-img" data-thumb="${escapeHtml(c.id)}">${empty ? `${icon("upload", { size: 22 })}<small>${t("post.state.none")}</small>` : icon(TYPE_ICON[type] || "play", { size: 26 })}</span>
        ${n > 1 ? `<span class="pq-g-n">${icon("layers", { size: 12 })}${n}</span>` : ""}
        ${empty ? "" : ed ? `<span class="pq-g-state is-editor" style="--pst:${ed.color}"><i></i>${escapeHtml(ed.label)}</span>` : `<span class="pq-g-state"><i></i>${escapeHtml(stateLabelOf(c))}</span>`}
      </button>
      ${code ? `<button type="button" class="pq-g-code" data-copy="${escapeHtml(code)}" title="${escapeHtml(t("post.code.copy"))}">${escapeHtml(code)}</button>` : ""}
      <div class="pq-g-info">
        <b>${escapeHtml(c.title || t("common.untitled"))}</b>
        <small class="pq-g-when ${c.scheduleDate ? "" : "is-faint"}">${icon("calendar", { size: 11 })}${escapeHtml(c.scheduleDate ? whenLabel(c) : t("pq.noDate"))}${c.scheduleDate && !time ? ` <span class="is-faint" title="${escapeHtml(t("pq.noTime"))}">· --:--</span>` : ""}</small>
        <small>${icon(TYPE_ICON[type] || "play", { size: 11 })}${t(`post.type.${type}`)}${c.posting?.trialReel ? `<span class="pq-g-trial">${t("post.trialReel.label")}</span>` : ""}</small>
      </div>
    </article>`;
}

// Trials right after their piece when both are in the gallery.
function ordered(list) {
  const ids = new Set(list.map((x) => x.c.id));
  const byHour = (a, b) => `${a.c.scheduleDate || "9999"}${a.c.posting?.time || "99"}`.localeCompare(`${b.c.scheduleDate || "9999"}${b.c.posting?.time || "99"}`) || (a.c.videoNo || 0) - (b.c.videoNo || 0);
  return list.filter((x) => !x.c.trialOf || !ids.has(x.c.trialOf)).sort(byHour)
    .flatMap((m) => [m, ...list.filter((x) => x.c.trialOf === m.c.id).sort((a, b) => (a.c.trial || "").localeCompare(b.c.trial || "")).map((x) => ({ ...x, sub: true }))]);
}

function listHTML(items, ui) {
  const counts = Object.fromEntries(FILTERS.map((f) => [f, f === "all" ? items.filter((x) => x.state !== "published").length : items.filter((x) => filterOf(x.state) === f).length]));
  const chips = `<div class="pq-filters" role="group" aria-label="${escapeHtml(t("pq.filterLabel"))}">${FILTERS.map((f) => `<button type="button" class="pq-filter ${ui.status === f ? "is-on" : ""}" data-status="${f}" aria-pressed="${ui.status === f}" style="--pst:${f === "all" ? "var(--text)" : stateColor(f)}">${f === "all" ? "" : "<i></i>"}${t(`pq.f.${f}`)}<b>${counts[f]}</b></button>`).join("")}</div>`;
  const shown = items.filter((x) => (ui.status === "all" ? x.state !== "published" : filterOf(x.state) === ui.status));
  if (!shown.length) return `${chips}<div class="pq-empty">${icon("check", { size: 20 })}<span>${t(ui.status === "all" ? "pq.emptyAll" : "pq.emptyFilter")}</span></div>`;
  const rows = (list) => ordered(list).map(tileHTML).join("");
  if (ui.status === "published") {
    const list = shown.sort((a, b) => (b.c.publishedDate || b.c.scheduleDate || "").localeCompare(a.c.publishedDate || a.c.scheduleDate || ""));
    return `${chips}<div class="pq-gal">${list.map(tileHTML).join("")}</div>`;
  }
  // One gallery, soonest first (no date last); what's past its date and
  // still not up waits folded underneath.
  const today = localISODate();
  const late = shown.filter((x) => x.c.scheduleDate && x.c.scheduleDate < today);
  const main = shown.filter((x) => !late.includes(x));
  return `${chips}
    ${main.length ? `<div class="pq-gal">${rows(main)}</div>` : ""}
    ${late.length ? `<details class="pq-day is-fold" data-fold="late" ${ui.open.late || !main.length ? "open" : ""}><summary><h3>${t("pq.group.late")}<span>${late.length}</span></h3>${icon("chevronDown", { size: 14 })}</summary><div class="pq-gal">${rows(late)}</div></details>` : ""}`;
}

function sourceHTML() {
  if (!usesOutbox()) return "";
  const o = outboxInfo();
  if (!o.checked) return "";
  if (o.connected) return `<span class="pq-source">${icon("folder", { size: 14 })}<span>${t("pq.source.on", { name: escapeHtml(o.name) })}</span><button type="button" class="pq-icon-btn" id="pq-sync" title="${escapeHtml(t("pq.source.sync"))}" aria-label="${escapeHtml(t("pq.source.sync"))}">${icon("refresh", { size: 14 })}</button></span>`;
  return `<button type="button" class="btn btn-secondary" id="pq-link">${icon("folder", { size: 15 })}${t(o.needsPermission ? "post.local.againCta" : "post.local.cta")}</button>`;
}

// The account's real grid (owner, 2026-11-02: "pastikan instagramnya sudah
// ter-fetch sesuai akun"): read from Instagram with the brand's own
// connection — the same one Brandlab's insights use — and kept a few
// minutes. The username Instagram answers with is the account it really is.
const IG = new Map(); // brandId → { at, key, media, username, error }
const igOf = (brand) => (brand?.instagram?.igUserId && brand.instagram.accessToken ? brand.instagram : null);
async function loadGrid(brandId) {
  const ig = igOf(getBrand(brandId));
  if (!ig || !canUseInstagramApi()) return null;
  const hit = IG.get(brandId);
  if (hit && hit.key === ig.igUserId && Date.now() - hit.at < 5 * 60 * 1000) return hit;
  let out;
  try {
    const [media, username] = await Promise.all([listRecentMedia(ig, { maxItems: 18 }), testConnection(ig)]);
    out = { at: Date.now(), key: ig.igUserId, media, username: String(username || "") };
  } catch (e) {
    out = { at: Date.now(), key: ig.igUserId, media: [], username: "", error: e.message || String(e) };
  }
  IG.set(brandId, out);
  return out;
}

// The profile grid: what's coming on top (newest first, as Instagram shows
// it), then what's already on the account.
function feedHTML(brandId) {
  const brand = getBrand(brandId);
  const handle = String(brand?.instagram?.username || "").replace(/^@/, "");
  const connected = !!igOf(brand) && canUseInstagramApi();
  const grid = connected ? IG.get(brandId) : null;
  // Trial reels go to non-followers first and aren't on the grid.
  const all = listContent(brandId).filter((c) => isIG(c) && !c.trialOf && !c.posting?.trialReel);
  const coming = all.filter((c) => ["review", "client", "revision", "ready", "scheduled"].includes(postingState(c)))
    .sort((a, b) => `${b.scheduleDate || ""}${b.posting?.time || ""}`.localeCompare(`${a.scheduleDate || ""}${a.posting?.time || ""}`));
  const real = grid?.media?.length ? grid.media : null;
  const out = real ? [] : all.filter((c) => c.status === "published").sort((a, b) => (b.publishedDate || "").localeCompare(a.publishedDate || "")).slice(0, 12);
  const tile = (c, upcoming) => {
    const state = postingState(c);
    return `<button type="button" class="pq-tile ${upcoming ? "is-coming" : ""}" data-open="${escapeHtml(c.id)}" style="--pst:${stateColor(state)}" title="${escapeHtml(c.title || "")}">
        ${!upcoming && /^(https:|data:image\/)/.test(c.thumbnail || "") ? `<span class="pq-tile-img has-img" style="background-image:url('${escapeHtml(c.thumbnail)}')"></span>` : thumbHTML(c, "pq-tile-img")}
        ${upcoming ? `<span class="pq-tile-tag">${escapeHtml(whenLabel(c))}</span><span class="pq-tile-state">${escapeHtml(stateLabelOf(c))}</span>` : `<span class="pq-tile-title">${escapeHtml(c.title || "")}</span>`}
      </button>`;
  };
  const igTile = (m) => {
    const src = thumbnailFromMedia(m);
    return `<a class="pq-tile is-ig" href="${escapeHtml(m.permalink || "#")}" target="_blank" rel="noopener" title="${escapeHtml(String(m.caption || "").slice(0, 120))}">
        <span class="pq-tile-img ${src ? "has-img" : ""}" ${src ? `style="background-image:url('${escapeHtml(src)}')"` : ""}>${icon("instagram", { size: 18 })}</span>
        ${m.media_product_type === "REELS" || m.media_type === "VIDEO" ? `<span class="pq-tile-kind">${icon("play", { size: 12 })}</span>` : m.media_type === "CAROUSEL_ALBUM" ? `<span class="pq-tile-kind">${icon("layers", { size: 12 })}</span>` : ""}
      </a>`;
  };
  const shown = grid?.username || handle;
  const mismatch = grid?.username && handle && grid.username.toLowerCase() !== handle.toLowerCase();
  let source;
  if (!connected) source = `<span class="pq-feed-src is-off">${icon("info", { size: 13 })}${t("pq.feed.noIg")}</span>`;
  else if (!grid) source = `<span class="pq-feed-src">${icon("refresh", { size: 13 })}${t("pq.feed.loading")}</span>`;
  else if (grid.error) source = `<span class="pq-feed-src is-off">${icon("info", { size: 13 })}${t("pq.feed.igError", { msg: escapeHtml(grid.error) })}</span>`;
  else source = `<span class="pq-feed-src is-on">${icon("instagram", { size: 13 })}${t("pq.feed.fromIg", { time: escapeHtml(new Date(grid.at).toLocaleTimeString(getLang() === "en" ? "en-US" : "id-ID", { hour: "2-digit", minute: "2-digit" })) })}</span>`;
  return `<div class="pq-feed">
      <div class="pq-feed-head"><span class="pq-feed-av" style="background:${escapeHtml(brand?.color || "var(--accent)")}">${escapeHtml((brand?.name || "?")[0])}</span><span class="pq-feed-who"><b>${escapeHtml(shown ? `@${shown}` : brand?.name || "")}</b>${source}</span></div>
      ${mismatch ? `<p class="pq-warn">${icon("info", { size: 15 })}<span>${t("pq.feed.otherAccount", { got: escapeHtml(grid.username), want: escapeHtml(handle) })}</span></p>` : ""}
      <div class="pq-grid">${coming.map((c) => tile(c, true)).join("")}${real ? real.map(igTile).join("") : out.map((c) => tile(c, false)).join("")}</div>
      ${!coming.length && !out.length && !real ? `<p class="pq-col-empty">${t("pq.feed.empty")}</p>` : ""}
    </div>`;
}

export function render(root, { brandId }) {
  if (!canUsePosting()) { location.hash = `#/brand/${brandId}/content`; return () => {}; }
  let view = "list";
  try { view = localStorage.getItem(VIEW_KEY) || "list"; } catch { /* default */ }
  // The brand open in the app (its switcher, top left) — no second brand picker here.
  const ui = { view, period: "all", status: "all", open: {}, unmatched: [] };

  const paint = () => {
    ensureCodes(); // a piece made in Creator since: it gets its number now
    const items = pieces({ brandId, period: ui.period });
    const reviewN = pieces({ brandId: "all", period: "all" }).filter((x) => x.state === "review").length;
    const brands = listBrands();
    root.innerHTML = `
      <div class="pq">
        <div class="calx-head">
          <div class="calx-head-title">
            <span class="calx-head-art cl-pic" style="--cat:#FF5F57;--cat2:#FF2E93">${createArtSVG("video")}</span>
            <div class="calx-head-text"><h1>${t("pq.title")}</h1><p class="calx-head-what">${t("pq.lead")}</p></div>
          </div>
          <div class="pq-actions">
            ${sourceHTML()}
            <button type="button" class="cl-cta" id="pq-review" ${reviewN ? "" : "disabled"}><span>${reviewN ? t("pq.review", { n: reviewN }) : t("pq.reviewNone")}</span><span class="cl-cta-dot pq-dot">${icon("play", { size: 16 })}</span></button>
          </div>
        </div>
        ${ui.unmatched.length ? `<div class="pq-warn is-soft">${icon("folder", { size: 15 })}<b>${t("pq.unmatched")}</b><div class="pq-warn-list">${ui.unmatched.map((u) => `<label class="pq-pick"><span>${escapeHtml(u.brandFolder)}</span><select data-folder="${escapeHtml(u.brandFolder)}"><option value="">${t("pq.pickBrand")}</option>${brands.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join("")}</select></label>`).join("")}</div></div>` : ""}
        <div class="pq-bar">
          <div class="segmented pq-seg">${["list", "feed"].map((v) => `<button data-view="${v}" class="${ui.view === v ? "active" : ""}" aria-pressed="${ui.view === v}">${t(`pq.view.${v}`)}</button>`).join("")}</div>
          ${ui.view === "list" ? `<div class="segmented pq-seg">${["all", "week", "next", "month"].map((v) => `<button data-period="${v}" class="${ui.period === v ? "active" : ""}" aria-pressed="${ui.period === v}">${t(`pq.period.${v}`)}</button>`).join("")}</div>` : ""}
        </div>
        ${ui.view === "feed" ? feedHTML(brandId) : listHTML(items, ui)}
      </div>`;
    wire();
    loadThumbs();
    if (ui.view === "feed" && igOf(getBrand(brandId)) && canUseInstagramApi()) {
      const before = IG.get(brandId);
      loadGrid(brandId).then((g) => { if (g && g !== before && ui.view === "feed" && root.isConnected) paint(); });
    }
  };

  const loadThumbs = () => {
    qsa("[data-thumb]", root).forEach((el) => {
      const c = getContent(el.dataset.thumb);
      const key = c?.posting?.local?.key;
      // No cut in the folder yet: the thumbnail made in Creator, if any.
      if ((!key || !outboxInfo().connected) && /^(https:|data:image\/)/.test(c?.thumbnail || "")) {
        el.style.backgroundImage = `url("${c.thumbnail.replace(/"/g, "%22")}")`;
        el.classList.add("has-img");
        return;
      }
      if (!key || !outboxInfo().connected) return;
      outboxThumb(key, latestVersion(c), c.posting.cover).then((src) => {
        if (src && el.isConnected) { el.style.backgroundImage = `url("${src}")`; el.classList.add("has-img"); }
      }).catch(() => {});
    });
  };

  const wire = () => {
    qsa("[data-open]", root).forEach((b) => b.addEventListener("click", () => openPosting({ contentId: b.dataset.open })));
    qsa("[data-view]", root).forEach((b) => b.addEventListener("click", () => { ui.view = b.dataset.view; try { localStorage.setItem(VIEW_KEY, ui.view); } catch { /* per tab */ } paint(); }));
    qsa("[data-period]", root).forEach((b) => b.addEventListener("click", () => { ui.period = b.dataset.period; paint(); }));
    qsa("[data-status]", root).forEach((b) => b.addEventListener("click", () => { ui.status = b.dataset.status; paint(); }));
    qsa("details[data-fold]", root).forEach((d) => d.addEventListener("toggle", () => { ui.open[d.dataset.fold] = d.open; }));
    qsa("[data-copy]", root).forEach((b) => b.addEventListener("click", () => copyCode(b.dataset.copy)));
    qs("#pq-review", root)?.addEventListener("click", () => openReview(pieces({ brandId: "all", period: "all" }).filter((x) => x.state === "review"), paint));
    qs("#pq-link", root)?.addEventListener("click", async () => { await linkOutbox(); await sync(); });
    qs("#pq-sync", root)?.addEventListener("click", () => sync(true));
    qsa("select[data-folder]", root).forEach((sel) => sel.addEventListener("change", () => { if (sel.value) { pickBrand(sel.dataset.folder, sel.value); sync(); } }));
  };

  const sync = async () => {
    if (!usesOutbox()) return;
    const o = await ensureOutbox();
    if (o.connected) {
      try { ui.unmatched = (await syncOutbox()).unmatched; } catch (e) { console.warn("[antrean] sync", e); }
    }
    paint();
  };

  paint();
  sync();
  // New cuts from Claude show up by themselves while this page is open.
  const timer = setInterval(() => { if (document.visibilityState === "visible" && outboxInfo().connected) sync(); }, 15000);
  const off = onChange(() => { if (!document.querySelector(".pq-review")) paint(); });
  return () => { clearInterval(timer); off(); };
}

// ---- Review: the waiting cuts one by one, full screen ----------------------
function openReview(queue, onClose) {
  if (!queue.length) return;
  let i = 0;
  let noting = false;
  const el = document.createElement("div");
  el.className = "pq-review";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", t("pq.reviewTitle"));
  document.body.appendChild(el);
  document.body.classList.add("pq-review-open");

  const close = () => { el.remove(); document.body.classList.remove("pq-review-open"); document.removeEventListener("keydown", onKey); onClose?.(); };
  const media = () => qs("video", el);
  const now = () => media()?.currentTime || 0;
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  const show = () => {
    if (i >= queue.length) {
      el.innerHTML = `<div class="pq-rv-done"><span class="pq-rv-done-ic">${icon("check", { size: 30 })}</span><b>${t("pq.reviewDone")}</b><span>${t("pq.reviewDoneBody", { n: queue.length })}</span><button type="button" class="cl-cta" id="pq-rv-close"><span>${t("common.close")}</span><span class="cl-cta-dot pq-dot">${icon("x", { size: 16 })}</span></button></div>`;
      qs("#pq-rv-close", el).addEventListener("click", close);
      return;
    }
    const { brand, c } = queue[i];
    const v = latestVersion(c);
    const key = c.posting?.local?.key;
    const isVideo = !v.local || v.kind === "video";
    const files = v.kind === "set" ? (v.local.slides || []).map((f) => (v.local.file === "slides" ? f : `${v.local.file}/${f}`)) : v.kind === "image" ? [v.local.file] : [];
    noting = false;
    el.innerHTML = `
      <div class="pq-rv-top">
        <span class="pq-rv-av" style="background:${escapeHtml(brand.color || "var(--accent)")}">${escapeHtml((brand.name || "?")[0])}</span>
        <span class="pq-rv-what"><b>${videoCode(c) ? `<em class="pq-rv-code">${escapeHtml(videoCode(c))}</em>` : ""}${escapeHtml(c.title || t("common.untitled"))}</b><small>${escapeHtml(brand.name)} · ${escapeHtml(versionLabelOf(v))} · ${escapeHtml(whenLabel(c))}</small></span>
        <span class="pq-rv-n">${i + 1}/${queue.length}</span>
        <button type="button" class="pq-rv-x" id="pq-rv-x" aria-label="${escapeHtml(t("common.close"))}">${icon("x", { size: 18 })}</button>
      </div>
      <div class="pq-rv-stage">
        ${isVideo ? `<video playsinline loop ${v.url ? `src="${escapeHtml(v.url)}"` : ""}></video>` : `<div class="pq-rv-slides">${files.map((f) => `<img data-f="${escapeHtml(f)}" alt="">`).join("")}</div>${files.length > 1 ? `<span class="pq-rv-slide-n">1/${files.length}</span>` : ""}`}
        <button type="button" class="pq-rv-nav is-prev" id="pq-rv-prev" ${i ? "" : "disabled"} aria-label="${escapeHtml(t("pq.prev"))}">${icon("chevronLeft", { size: 22 })}</button>
        <button type="button" class="pq-rv-nav is-next" id="pq-rv-next" aria-label="${escapeHtml(t("pq.skip"))}">${icon("chevronRight", { size: 22 })}</button>
      </div>
      ${c.caption ? `<p class="pq-rv-cap">${escapeHtml(c.caption)}</p>` : ""}
      <div class="pq-rv-note" id="pq-rv-note" hidden><input class="input" id="pq-rv-text" placeholder="${escapeHtml(t("post.note.ph"))}"><button type="button" class="btn btn-primary btn-sm" id="pq-rv-send">${t("pq.sendNote")}</button></div>
      <div class="pq-rv-actions">
        <button type="button" class="pq-rv-btn is-rev" id="pq-rv-rev">${icon("edit", { size: 20 })}<span>${t("post.decide.revise")}</span></button>
        <button type="button" class="pq-rv-btn is-ok" id="pq-rv-ok">${icon("check", { size: 22 })}<span>${t("post.decide.ok")}</span></button>
      </div>`;
    if (key && outboxInfo().connected) {
      if (isVideo) outboxFileURL(key, v.local.file).then((u) => { const m = media(); if (m) { m.src = u; m.play().catch(() => {}); } });
      qsa("img[data-f]", el).forEach((img) => outboxFileURL(key, img.dataset.f).then((u) => { img.src = u; }));
    } else if (v.url) media()?.play().catch(() => {});
    const strip = qs(".pq-rv-slides", el);
    strip?.addEventListener("scroll", () => { const n = qs(".pq-rv-slide-n", el); if (n) n.textContent = `${Math.round(strip.scrollLeft / strip.clientWidth) + 1}/${files.length}`; }, { passive: true });
    qs("#pq-rv-x", el).addEventListener("click", close);
    qs("#pq-rv-prev", el).addEventListener("click", () => { if (i) { i--; show(); } });
    qs("#pq-rv-next", el).addEventListener("click", () => { i++; show(); });
    qs("#pq-rv-ok", el).addEventListener("click", () => { decide(c.id, v.id, "approve"); i++; show(); });
    qs("#pq-rv-rev", el).addEventListener("click", () => {
      noting = true;
      media()?.pause();
      const row = qs("#pq-rv-note", el);
      row.hidden = false;
      qs("#pq-rv-send", el).textContent = t("post.note.send", { time: clock(now()) });
      qs("#pq-rv-text", el).focus();
    });
    const send = () => {
      const text = qs("#pq-rv-text", el).value.trim();
      if (!text) { qs("#pq-rv-text", el).focus(); return; }
      decide(c.id, v.id, "revise", { t: now(), text });
      i++;
      show();
    };
    qs("#pq-rv-send", el).addEventListener("click", send);
    qs("#pq-rv-text", el).addEventListener("keydown", (e) => { if (e.key === "Enter") send(); e.stopPropagation(); });
  };

  // Arrows move between cuts; Escape closes (or leaves the note first).
  const onKey = (e) => {
    if (e.key === "Escape") { if (noting) { noting = false; qs("#pq-rv-note", el).hidden = true; } else close(); }
    else if (!noting && (e.key === "ArrowDown" || e.key === "ArrowRight")) { i = Math.min(i + 1, queue.length); show(); }
    else if (!noting && (e.key === "ArrowUp" || e.key === "ArrowLeft") && i) { i--; show(); }
  };
  document.addEventListener("keydown", onKey);
  show();
}
