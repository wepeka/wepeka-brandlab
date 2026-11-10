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
import { listBrands, listContent, getBrand, getContent, onChange, localISODate, organicViews, isClientMember } from "../store.js";
import { icon } from "../icons.js";
import { qs, qsa, escapeHtml, toast, formatNumber, openMenu, closeMenu } from "../dom.js";
import { t, getLang } from "../i18n.js";
import { createArtSVG } from "../create-art.js";
import { weekStart, addDays } from "../goal-roadmap.js";
import { canUsePosting, canSeePosting, isClientView, clientCutCount, clientPosterOf, clientsOf, clientQueueURL, driveInfo, ensureDrive, connectOwnDrive, clientDriveGap, clientVideoURL, postingState, openPosting, usesOutbox, ensureOutbox, outboxInfo, linkOutbox, versionLabelOf, latestVersion, stateColor, stateLabelOf, decide, copyCode, editorChip, clientDriveLine } from "../posting.js";
import { outboxThumb, outboxFileURL } from "../outbox.js";
import { syncOutbox, pickBrand } from "../outbox-sync.js";
import { ensureCodes, videoCode, codedPiece } from "../video-codes.js";
import { listRecentMedia, thumbnailFromMedia, testConnection } from "../instagram.js";
import { canUseInstagramApi, currentUid } from "../account.js";

// The status chips over the list; "scheduled" also holds a failed post.
const FILTERS = ["all", "none", "review", "client", "revision", "ready", "scheduled", "published"];
// The client's own Antrean (Kerja Tim "Klien", 2026-11-09): the same page,
// their states — waiting on them first, then being fixed, approved, …
const CLIENT_FILTERS = ["all", "client", "revision", "ready", "scheduled", "published", "none"];
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
  // A client sees a trial cut only once it's sent to them.
  return brands.flatMap((brand) => listContent(brand.id).filter(codedPiece).filter((c) => !c.trialOf || !isClientView(c) || c.posting?.client).map((c) => ({ brand, c, state: postingState(c) })))
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
// Posted: Instagram's own "verified" seal in the frame's corner (owner, 2026-11-02:
// "tanda centang verified di pojok kanan framenya"), so a piece that went out
// still sits in its week but reads as done at a glance.
const SEAL = `<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><path fill="#0095F6" d="M19.998 3.094 14.638 0l-2.972 5.15H5.432v6.354L0 14.64 3.094 20 0 25.359l5.432 3.137v5.905h5.975L14.638 40l5.36-3.094L25.358 40l3.232-5.6h6.162v-6.01L40 25.359 36.905 20 40 14.641l-5.248-3.03v-6.46h-6.419L25.358 0l-5.36 3.094Z"/><path fill="#fff" d="m17.2 27.5-6.6-6.6 2.4-2.4 4.2 4.2 9.8-9.8 2.4 2.4z"/></svg>`;

function thumbHTML(c, cls = "pq-tile-img") {
  return `<span class="${cls}" data-thumb="${escapeHtml(c.id)}">${icon(TYPE_ICON[c.posting?.type] || "play", { size: 18 })}</span>`;
}

// One tile of the gallery (owner, 2026-11-02: "list videonya dibuat kaya
// galeri jadi gak pusing"): the cover big, its code, where it stands, and
// under it only the title and the hour. Everything else is one tap away.
function tileHTML({ c, state, sub }) {
  const n = isClientView(c) ? clientCutCount(c) : c.posting?.versions?.length || 0;
  const type = c.posting?.type || { Reels: "reels", Carousel: "carousel", "Static Post": "foto", Story: "story" }[c.format] || "reels";
  const code = videoCode(c);
  const time = c.posting?.time;
  const empty = state === "none";
  // At the editor (Claude), or its revision just in: said instead of the state.
  const ed = editorChip(c);
  // Posted: how it did, on the tile (owner: "dibuka bisa juga lihat ada views").
  const posted = state === "published";
  const views = posted ? organicViews(c) : null;
  return `<article class="pq-g ${sub ? "is-trial" : ""} ${empty ? "is-empty" : ""} ${posted ? "is-posted" : ""}" style="--pst:${stateColor(state)}">
      <button type="button" class="pq-g-media" data-open="${escapeHtml(c.id)}" aria-label="${escapeHtml(`${code} ${c.title || ""}`.trim())}">
        <span class="pq-g-img" data-thumb="${escapeHtml(c.id)}">${empty ? `${icon(isClientView(c) ? "clock" : "upload", { size: 22 })}<small>${t(isClientView(c) ? "post.cst.none" : "post.state.none")}</small>` : icon(TYPE_ICON[type] || "play", { size: 26 })}</span>
        ${posted ? `<span class="pq-g-ok" title="${escapeHtml(t("pq.posted.seal"))}">${SEAL}</span>` : n > 1 ? `<span class="pq-g-n">${icon("layers", { size: 12 })}${n}</span>` : ""}
        ${views !== null && views !== undefined && views !== "" ? `<span class="pq-g-views" title="${escapeHtml(t("pq.views"))}">${icon("eye", { size: 12 })}${formatNumber(views)}</span>` : ""}
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
  // "Semua" in a week or month keeps what already went out, sealed (owner,
  // 2026-11-02: "yang sudah tayang tetap bisa dilihat di antrean minggu ini");
  // over all time it stays under its own chip, or every old post would fill it.
  const inAll = (x) => ui.period !== "all" || x.state !== "published";
  const list = ui.client ? CLIENT_FILTERS : FILTERS;
  const counts = Object.fromEntries(list.map((f) => [f, f === "all" ? items.filter(inAll).length : items.filter((x) => filterOf(x.state) === f).length]));
  const chips = `<div class="pq-filters" role="group" aria-label="${escapeHtml(t("pq.filterLabel"))}">${list.map((f) => `<button type="button" class="pq-filter ${ui.status === f ? "is-on" : ""}" data-status="${f}" aria-pressed="${ui.status === f}" style="--pst:${f === "all" ? "var(--text)" : stateColor(f)}">${f === "all" ? "" : "<i></i>"}${t(ui.client && f !== "all" ? `post.cst.${f}` : `pq.f.${f}`)}<b>${counts[f]}</b></button>`).join("")}</div>`;
  const shown = items.filter((x) => (ui.status === "all" ? inAll(x) : filterOf(x.state) === ui.status));
  if (!shown.length) return `${chips}<div class="pq-empty">${icon("check", { size: 20 })}<span>${t(ui.status === "all" ? "pq.emptyAll" : "pq.emptyFilter")}</span></div>`;
  const rows = (list) => ordered(list).map(tileHTML).join("");
  if (ui.status === "published") {
    const list = shown.sort((a, b) => (b.c.publishedDate || b.c.scheduleDate || "").localeCompare(a.c.publishedDate || a.c.scheduleDate || ""));
    return `${chips}<div class="pq-gal">${list.map(tileHTML).join("")}</div>`;
  }
  // One gallery, soonest first (no date last); what's past its date and
  // still not up waits folded on top of it (owner, 2026-11-03: folded under
  // ~90 tiles, Winson Wrapped #4 read as "hilang" the day after its date).
  const today = localISODate();
  const late = shown.filter((x) => x.c.scheduleDate && x.c.scheduleDate < today && x.state !== "published");
  const main = shown.filter((x) => !late.includes(x));
  return `${chips}
    ${late.length ? `<details class="pq-day is-fold" data-fold="late" ${ui.open.late || !main.length ? "open" : ""}><summary><h3>${t("pq.group.late")}<span>${late.length}</span></h3>${icon("chevronDown", { size: 14 })}</summary><div class="pq-gal">${rows(late)}</div></details>` : ""}
    ${main.length ? `<div class="pq-gal">${rows(main)}</div>` : ""}`;
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

// "Klien": who the brand's client is, whether their Drive is on, and the
// way in to send them (their Antrean in Brandlab).
function openClientMenu(btn, brandId) {
  const r = btn.getBoundingClientRect();
  const menu = openMenu(btn, { className: "pq-client-menu", top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 340)) });
  if (!menu) return; // the same button again closes it
  const brand = getBrand(brandId);
  const people = clientsOf(brand);
  const line = clientDriveLine(brand);
  const url = clientQueueURL(brandId);
  menu.innerHTML = `<div class="pq-client-pop">
      <b>${t("pq.client.head")}</b>
      <p>${t("pq.client.what")}</p>
      <p class="pst-client-drive is-${line.tone}"><i></i>${line.text}</p>
      <div class="pq-client-row">
        ${people.length ? `<button type="button" class="btn btn-primary btn-sm" data-client-copy>${icon("link", { size: 14 })}${t("post.client.copy")}</button>
        <a class="btn btn-secondary btn-sm" href="https://wa.me/?text=${encodeURIComponent(t("post.client.waText", { brand: brand?.name || "", url }))}" target="_blank" rel="noopener">${icon("chat", { size: 14 })}WhatsApp</a>` : ""}
        <button type="button" class="btn ${people.length ? "btn-ghost" : "btn-primary"} btn-sm" data-client-invite>${icon("users", { size: 14 })}${t(people.length ? "pq.client.more" : "post.client.invite")}</button>
      </div></div>`;
  qs("[data-client-copy]", menu)?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url); } catch { /* the WhatsApp button has it too */ }
    toast(t("post.client.copied"));
  });
  qs("[data-client-invite]", menu)?.addEventListener("click", async () => {
    closeMenu();
    const { openShareDialog } = await import("./team-panel.js");
    openShareDialog({ brandId, role: "klien" });
  });
}

// The client's header: their Google Drive, where the videos land. An editor
// (or a second Klien) reads the client's: whose it is, or that it isn't
// connected yet — only the client connects it.
function clientDriveHTML(brandId) {
  const brand = getBrand(brandId);
  if (clientDriveGap(brand) === "wait") return `<span class="pq-source">${icon("folder", { size: 14 })}<span>${t("pq.cl.driveTeamOff")}</span></span>`;
  if (brand?.clientDrive?.uid && !(isClientMember(brand) && brand.clientDrive.uid === currentUid())) {
    return `<span class="pq-source">${icon("folder", { size: 14 })}<span>${t("pq.cl.driveTeam", { email: escapeHtml(brand.clientDrive.email || "") })}</span></span>`;
  }
  const d = driveInfo();
  if (!d.checked) return "";
  if (d.connected) return `<span class="pq-source">${icon("folder", { size: 14 })}<span>${t("pq.cl.driveOn", { email: escapeHtml(d.email || "") })}</span></span>`;
  return `<button type="button" class="cl-cta" id="pq-drive"><span>${t("post.cl.driveCta")}</span><span class="cl-cta-dot pq-dot">${icon("link", { size: 16 })}</span></button>`;
}

export function render(root, { brandId }) {
  if (!canSeePosting(brandId)) { location.hash = `#/brand/${brandId}/content`; return () => {}; }
  const client = !canUsePosting();
  let view = "list";
  try { view = localStorage.getItem(VIEW_KEY) || "list"; } catch { /* default */ }
  // The brand open in the app (its switcher, top left) — no second brand picker here.
  if (client) view = "list"; // the profile grid reads Wepeka's Instagram connection
  const ui = { view, period: "all", status: "all", open: {}, unmatched: [], client };

  const paint = () => {
    if (!client) ensureCodes(); // a piece made in Creator since: it gets its number now
    const items = pieces({ brandId, period: ui.period });
    const reviewN = client ? 0 : pieces({ brandId: "all", period: "all" }).filter((x) => x.state === "review").length;
    const brands = listBrands();
    root.innerHTML = `
      <div class="pq">
        <div class="calx-head">
          <div class="calx-head-title">
            <span class="calx-head-art cl-pic" style="--cat:#FF5F57;--cat2:#FF2E93">${createArtSVG("video")}</span>
            <div class="calx-head-text"><h1>${t("pq.title")}</h1><p class="calx-head-what">${t(client ? "pq.cl.lead" : "pq.lead")}</p></div>
          </div>
          <div class="pq-actions">
            ${client ? clientDriveHTML(brandId) : `${sourceHTML()}
            <button type="button" class="btn btn-secondary pq-client-btn" id="pq-client" aria-haspopup="true">${icon("users", { size: 15 })}<span>${t("pq.client.btn")}</span><i class="pq-client-dot is-${clientDriveLine(getBrand(brandId)).tone}"></i></button>
            <button type="button" class="cl-cta" id="pq-review" ${reviewN ? "" : "disabled"}><span>${reviewN ? t("pq.review", { n: reviewN }) : t("pq.reviewNone")}</span><span class="cl-cta-dot pq-dot">${icon("play", { size: 16 })}</span></button>`}
          </div>
        </div>
        ${ui.unmatched.length ? `<div class="pq-warn is-soft">${icon("folder", { size: 15 })}<b>${t("pq.unmatched")}</b><div class="pq-warn-list">${ui.unmatched.map((u) => `<label class="pq-pick"><span>${escapeHtml(u.brandFolder)}</span><select data-folder="${escapeHtml(u.brandFolder)}"><option value="">${t("pq.pickBrand")}</option>${brands.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join("")}</select></label>`).join("")}</div></div>` : ""}
        <div class="pq-bar">
          ${client ? "" : `<div class="segmented pq-seg">${["list", "feed"].map((v) => `<button data-view="${v}" class="${ui.view === v ? "active" : ""}" aria-pressed="${ui.view === v}">${t(`pq.view.${v}`)}</button>`).join("")}</div>`}
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
    if (client) {
      // The cover of the cut sent last, from the client's Drive.
      if (clientDriveGap(brandId)) return;
      qsa("[data-thumb]", root).forEach((el) => {
        const c = getContent(el.dataset.thumb);
        const poster = clientPosterOf(c);
        if (poster) clientVideoURL(c, poster).then((src) => { if (el.isConnected) { el.style.backgroundImage = `url("${src}")`; el.classList.add("has-img"); } }).catch(() => {});
      });
      return;
    }
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
    // A tile opens the piece's page on its video, with a way back here.
    qsa("[data-open]", root).forEach((b) => b.addEventListener("click", () => {
      const c = getContent(b.dataset.open);
      openPosting({ contentId: b.dataset.open, step: postingState(c) === "published" ? "done" : "edit", from: t("pq.title") });
    }));
    qsa("[data-view]", root).forEach((b) => b.addEventListener("click", () => { ui.view = b.dataset.view; try { localStorage.setItem(VIEW_KEY, ui.view); } catch { /* per tab */ } paint(); }));
    qsa("[data-period]", root).forEach((b) => b.addEventListener("click", () => { ui.period = b.dataset.period; paint(); }));
    qsa("[data-status]", root).forEach((b) => b.addEventListener("click", () => { ui.status = b.dataset.status; paint(); }));
    qsa("details[data-fold]", root).forEach((d) => d.addEventListener("toggle", () => { ui.open[d.dataset.fold] = d.open; }));
    qsa("[data-copy]", root).forEach((b) => b.addEventListener("click", () => copyCode(b.dataset.copy)));
    qs("#pq-review", root)?.addEventListener("click", () => openReview(pieces({ brandId: "all", period: "all" }).filter((x) => x.state === "review"), paint));
    qs("#pq-link", root)?.addEventListener("click", async () => { await linkOutbox(); await sync(); });
    // The brand's client (Kerja Tim "Klien", 2026-11-09).
    qs("#pq-client", root)?.addEventListener("click", (e) => openClientMenu(e.currentTarget, brandId));
    qs("#pq-drive", root)?.addEventListener("click", () => connectOwnDrive());
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
  if (client) ensureDrive().then(() => { if (root.isConnected) paint(); });
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
      <div class="pq-rv-sent" id="pq-rv-sent"></div>
      <div class="pq-rv-note" id="pq-rv-note" hidden><input class="input" id="pq-rv-text" placeholder="${escapeHtml(t("post.note.ph"))}"><button type="button" class="btn btn-primary btn-sm" id="pq-rv-send">${t("pq.sendNote")}</button></div>
      <div class="pq-rv-actions" id="pq-rv-actions"></div>`;
    if (key && outboxInfo().connected) {
      if (isVideo) outboxFileURL(key, v.local.file).then((u) => { const m = media(); if (m) { m.src = u; m.play().catch(() => {}); } });
      qsa("img[data-f]", el).forEach((img) => outboxFileURL(key, img.dataset.f).then((u) => { img.src = u; }));
    } else if (v.url) media()?.play().catch(() => {});
    const strip = qs(".pq-rv-slides", el);
    strip?.addEventListener("scroll", () => { const n = qs(".pq-rv-slide-n", el); if (n) n.textContent = `${Math.round(strip.scrollLeft / strip.clientWidth) + 1}/${files.length}`; }, { passive: true });
    // Tap the video to pause or carry on; a mark says it's paused.
    const m = media();
    if (m) {
      const stage = qs(".pq-rv-stage", el);
      stage.insertAdjacentHTML("beforeend", `<span class="pq-rv-paused" aria-hidden="true">${icon("play", { size: 30 })}</span>`);
      const mark = () => stage.classList.toggle("is-paused", m.paused && !!m.currentSrc);
      ["play", "pause", "loadeddata"].forEach((ev) => m.addEventListener(ev, mark));
      m.addEventListener("click", () => (m.paused ? m.play().catch(() => {}) : m.pause()));
    }
    qs("#pq-rv-x", el).addEventListener("click", close);
    qs("#pq-rv-prev", el).addEventListener("click", () => { if (i) { i--; show(); } });
    qs("#pq-rv-next", el).addEventListener("click", () => { i++; show(); });

    // Notes stay on this cut (owner, 2026-11-02: after a note the video
    // doesn't go back to 0:00 or jump to the next one). Once it has notes,
    // the buttons are "another note" and "next video".
    const notesHere = () => (getContent(c.id)?.posting?.notes || []).filter((n) => n.versionId === v.id && !n.done).sort((a, b) => a.t - b.t);
    const paintNotes = () => {
      const ns = notesHere();
      qs("#pq-rv-sent", el).innerHTML = ns.map((n) => `<button type="button" class="pq-rv-chip" data-t="${n.t}"><b>${clock(n.t)}</b><span>${escapeHtml(n.text)}</span></button>`).join("");
      qsa(".pq-rv-chip", el).forEach((b) => b.addEventListener("click", () => { const mm = media(); if (mm) mm.currentTime = +b.dataset.t; }));
      qs("#pq-rv-actions", el).innerHTML = ns.length
        ? `<button type="button" class="pq-rv-btn is-rev" id="pq-rv-rev">${icon("edit", { size: 20 })}<span>${t("pq.addNote")}</span></button>
           <button type="button" class="pq-rv-btn is-next" id="pq-rv-go"><span>${t("pq.nextCut")}</span>${icon("chevronRight", { size: 20 })}</button>`
        : `<button type="button" class="pq-rv-btn is-rev" id="pq-rv-rev">${icon("edit", { size: 20 })}<span>${t("post.decide.revise")}</span></button>
           <button type="button" class="pq-rv-btn is-ok" id="pq-rv-ok">${icon("check", { size: 22 })}<span>${t("post.decide.ok")}</span></button>`;
      qs("#pq-rv-ok", el)?.addEventListener("click", () => { decide(c.id, v.id, "approve"); i++; show(); });
      qs("#pq-rv-go", el)?.addEventListener("click", () => { i++; show(); });
      qs("#pq-rv-rev", el).addEventListener("click", () => {
        noting = true;
        media()?.pause();
        const row = qs("#pq-rv-note", el);
        row.hidden = false;
        qs("#pq-rv-send", el).textContent = t("post.note.send", { time: clock(now()) });
        qs("#pq-rv-text", el).focus();
      });
    };
    paintNotes();
    const send = () => {
      const text = qs("#pq-rv-text", el).value.trim();
      if (!text) { qs("#pq-rv-text", el).focus(); return; }
      const at = now();
      decide(c.id, v.id, "revise", { t: at, text });
      noting = false;
      qs("#pq-rv-text", el).value = "";
      qs("#pq-rv-note", el).hidden = true;
      paintNotes();
      toast(t("post.note.added", { time: clock(at) }));
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
