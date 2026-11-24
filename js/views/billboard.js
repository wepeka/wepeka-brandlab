// Wepeka Billboard (#/billboard) — the newest branding & marketing stories from
// Wepeka's Billboard on wepeka.com, inside Brandlab (owner, 2026-11-24:
// "Menampilkan update terbaru dari Wepeka Billboard, preview konten, link
// menuju konten lengkap, menghubungkan pengguna Brandlab dengan ekosistem
// Wepeka"). Read-only: the stories are written and queued in wepeka.com's
// admin; this page shows their cards (api/billboard.js) and every card opens
// the full story on wepeka.com in a new tab.
import { getBrand } from "../store.js";
import { backToLastBrandHTML } from "../back-link.js";
import { icon } from "../icons.js";
import { escapeHtml as esc, skeletonHTML } from "../dom.js";
import { t, getLang } from "../i18n.js";
import { loadBillboard, BILLBOARD_WALL } from "../billboard-data.js";

const WALL = BILLBOARD_WALL;
const load = (opts) => loadBillboard(opts);

const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString(getLang() === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "long", year: "numeric" }) : "");
const catLabel = (c) => {
  const k = `bb.cat.${c}`;
  const s = t(k);
  return s === k ? c : s;
};

function cardHTML(p, { lead = false } = {}) {
  return `
    <a class="bb-card${lead ? " is-lead" : ""}" href="${esc(p.url)}" target="_blank" rel="noopener">
      <span class="bb-cover">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : ""}${icon("megaphone", { size: lead ? 30 : 22 })}</span>
      <span class="bb-body">
        <span class="bb-meta">${p.category ? `<em class="bb-cat">${esc(catLabel(p.category))}</em>` : ""}<span>${esc(dateOf(p.publishedAt))}</span><span>· ${esc(t("bb.read", { n: p.readMinutes }))}</span></span>
        <b class="bb-title">${esc(p.title)}</b>
        ${p.excerpt ? `<span class="bb-excerpt">${esc(p.excerpt)}</span>` : ""}
        <span class="bb-go">${t("bb.open")}${icon("link", { size: 13 })}</span>
      </span>
    </a>`;
}

const headHTML = () => `
  <div class="page-head">
    <div>
      <div class="page-eyebrow">${backToLastBrandHTML(getBrand)}</div>
      <h1>${t("bb.title")}</h1>
      <p class="page-sub">${t("bb.sub")}</p>
    </div>
    <a class="btn btn-secondary" href="${WALL}" target="_blank" rel="noopener">${icon("link", { size: 15 })}${t("bb.wall")}</a>
  </div>`;

export function render(root) {
  let alive = true;
  const paint = (state) => {
    if (!alive) return;
    if (state.loading) {
      root.innerHTML = `${headHTML()}<div class="bb-grid">${skeletonHTML({ rows: 3 })}</div>`;
      return;
    }
    const posts = state.data?.posts || [];
    if (!posts.length) {
      root.innerHTML = `${headHTML()}
        <div class="card bb-empty">${icon("megaphone", { size: 22 })}<p>${t(state.error ? "bb.error" : "bb.empty")}</p>
          <div class="flex items-center gap-8"><button type="button" class="btn btn-secondary btn-sm" id="bb-retry">${icon("refresh", { size: 13 })}${t("bb.retry")}</button>
          <a class="btn btn-ghost btn-sm" href="${WALL}" target="_blank" rel="noopener">${t("bb.wall")}</a></div></div>`;
      root.querySelector("#bb-retry")?.addEventListener("click", () => run(true));
      return;
    }
    const [lead, ...rest] = posts;
    root.innerHTML = `${headHTML()}
      ${state.data.source === "archive" ? `<p class="bb-note">${icon("info", { size: 13 })}${t("bb.archiveNote")}</p>` : ""}
      ${cardHTML(lead, { lead: true })}
      ${rest.length ? `<div class="bb-grid">${rest.map((p) => cardHTML(p)).join("")}</div>` : ""}
      <p class="bb-foot">${t("bb.foot")}</p>`;
  };
  const run = (fresh = false) => {
    paint({ loading: true });
    load({ fresh }).then((data) => paint({ data }), () => paint({ error: true }));
  };
  run();
  return () => { alive = false; };
}
