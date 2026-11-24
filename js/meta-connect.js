// "Hubungkan akun Meta" — the app's half (owner, 2026-11-24: two ways in,
// Facebook Login for Business first, Instagram Login too). The tokens live
// on the server (api/instagram/[action].js); this file only starts a login,
// shows what Meta shared so the brand can pick, and reads the names and ids
// the server writes on the brand doc (brand.instagram / facebook / ads).
//
// Everything sits in one place, Pengaturan → Akun Meta (#/settings/meta),
// one row per brand this person may manage: the owner, or a member with My
// Brand edit and Posting (the Admin role) — the same rule as the server.
import { auth } from "./firebase.js";
import { t, getLang } from "./i18n.js";
import { getBrand, listBrands } from "./store.js";
import { currentUid } from "./account.js";
import { can } from "./permissions.js";
import { openModal, closeOverlay, confirmDialog } from "./modals.js";
import { icon } from "./icons.js";
import { qs, qsa, toast, escapeHtml, avatarHTML, formatNumber } from "./dom.js";
import { pageForIg, sortForBrand } from "./meta-pick.js";
import { openFetchPanel } from "./fetch-panel.js";

class MetaError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}
const KNOWN = ["not-configured", "not-allowed", "inactive", "too-soon", "not-connected", "reconnect"];
export const metaErrorText = (e) => t(`meta.err.${KNOWN.includes(e?.code) ? e.code : "server"}`);

async function call(action, body) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new MetaError("auth");
  const res = await fetch(`/api/instagram/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new MetaError(typeof json.error === "string" ? json.error : "server", json.message);
  return json;
}

// The sync with its steps as they happen: the server sends one JSON line per
// step (NDJSON) and the result last. A plain JSON reply (a refusal, or a
// platform that held the lines back) works too.
async function callStream(action, body, onLine) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new MetaError("auth");
  const res = await fetch(`/api/instagram/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: JSON.stringify({ ...(body || {}), stream: true }),
  });
  if (!/ndjson/.test(res.headers.get("content-type") || "") || !res.body?.getReader) {
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new MetaError(typeof json.error === "string" ? json.error : "server", json.message);
    return json;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let last = null;
  const take = (text) => {
    if (!text.trim()) return;
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      return;
    }
    // The last line is {done: true, result} or {error}; a step's own
    // `done` is a count.
    if (obj.done === true || typeof obj.error === "string") last = obj;
    else onLine?.(obj);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      take(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  take(buf);
  if (!last) throw new MetaError("server");
  if (last.error) throw new MetaError(typeof last.error === "string" ? last.error : "server", last.message);
  return last.result;
}

// ---------- what the brand doc says ----------
export const metaConnected = (b) => !!(b?.instagram?.connected || b?.facebook?.connected || b?.ads?.connected);
export const metaVia = (b) => b?.instagram?.via || b?.facebook?.via || (b?.ads?.connected ? "facebook" : "");
export const metaNeedsReconnect = (b) => metaConnected(b) && [b.instagram?.status, b.facebook?.status, b.ads?.status].includes("reconnect");
export const canManageMeta = (b) => !!b && can(b, currentUid(), "brand", "edit") && can(b, currentUid(), "publish", "publish");
export const canSyncMeta = (b) => !!b && (can(b, currentUid(), "publish", "publish") || can(b, currentUid(), "create", "edit"));

// ---------- actions ----------
// Leaves for Meta's dialog (or, reusing a Facebook login made for another
// brand, goes straight to picking). Meta sends the person back to
// /?meta=…&brand=…#/settings/meta (handleMetaReturn).
export async function startMetaConnect(brandId, via = "facebook") {
  try {
    const r = await call("connect", { brandId, via, offerReuse: via === "facebook" });
    const reuse = r.reusable?.[0];
    if (reuse) {
      const ok = await confirmDialog({
        title: t("meta.reuseTitle"),
        message: t("meta.reuseBody", { label: escapeHtml(reuse.label || "Meta") }),
        confirmLabel: t("meta.reuseYes"),
        cancelLabel: t("meta.reuseNo"),
      });
      if (ok) {
        await call("connect", { brandId, via, reuseGrantId: reuse.grantId });
        return openMetaPicker(brandId);
      }
    }
    toast(t("meta.going"));
    location.assign(r.url);
  } catch (e) {
    toast(metaErrorText(e), "error");
  }
}

export async function disconnectMeta(brandId) {
  const brand = getBrand(brandId);
  const ok = await confirmDialog({ title: t("meta.disconnectTitle"), message: t("meta.disconnectBody"), confirmLabel: t("meta.disconnect"), danger: true });
  if (!ok) return false;
  try {
    await call("disconnect", { brandId });
    toast(t("meta.disconnected", { brand: brand?.name || "" }));
    return true;
  } catch (e) {
    toast(metaErrorText(e), "error");
    return false;
  }
}

// One server pass now: Instagram numbers, posts since connecting, followers,
// the Page, ad spend — shown step by step in the floating panel (each post's
// picture drops in as its numbers are read), with the counts when it's done.
const STEP_AT = { account: 80, page: 87, ads: 93, save: 97 };
function stepLine(panel, line) {
  if (line.step === "posts") {
    if (Number.isFinite(line.found)) {
      panel.step("posts", "done", t("fetch.val.posts", { n: formatNumber(line.found) }));
      panel.progress(12);
    } else {
      panel.step("posts", "active");
      panel.progress(6);
    }
    return;
  }
  if (line.step === "numbers") {
    const total = Number(line.total) || 0;
    const done = Math.min(Number(line.done) || 0, total);
    if (!total) {
      panel.step("numbers", "done", t("fetch.val.none"));
      return panel.progress(75);
    }
    panel.step("numbers", done >= total ? "done" : "active", `${done}/${total}`);
    panel.thumb(line.thumb);
    return panel.progress(12 + 63 * (done / total));
  }
  if (STEP_AT[line.step]) {
    panel.step(line.step, "active");
    panel.progress(STEP_AT[line.step]);
  }
}
export async function syncMetaNow(brandId) {
  const brand = getBrand(brandId);
  const ig = !!brand?.instagram?.connected;
  const fb = !!brand?.facebook?.connected;
  const ads = !!brand?.ads?.connected;
  const steps = [
    ...(ig ? [{ key: "posts", label: t("fetch.s.posts") }, { key: "numbers", label: t("fetch.s.numbers") }, { key: "account", label: t("fetch.s.account") }] : []),
    ...(fb ? [{ key: "page", label: t("fetch.s.page") }] : []),
    ...(ads ? [{ key: "ads", label: t("fetch.s.ads") }] : []),
    { key: "save", label: t("fetch.s.save") },
  ];
  const panel = openFetchPanel({
    platform: ig ? "instagram" : "facebook",
    badge: ig && fb ? "facebook" : "",
    title: t(ig && fb ? "fetch.title.both" : ig ? "fetch.title.ig" : "fetch.title.fb"),
    sub: brand?.name || "",
    steps,
  });
  panel.step(steps[0].key, "active");
  panel.progress(3);
  try {
    const r = await callStream("sync", { brandId }, (line) => stepLine(panel, line));
    if (r?.reconnect) {
      panel.fail(t("meta.err.reconnect"), t("fetch.failed"));
      return r;
    }
    const changed = (r?.updated || 0) + (r?.added || 0) + (r?.linked || 0);
    panel.done({
      title: t(changed ? "fetch.done" : "fetch.doneSame"),
      note: t("fetch.doneNote"),
      stats: [
        r?.updated ? { n: r.updated, label: t("fetch.stat.updated") } : null,
        r?.added ? { n: r.added, label: t("fetch.stat.added") } : null,
        r?.linked ? { n: r.linked, label: t("fetch.stat.linked") } : null,
        Number.isFinite(r?.followers) ? { n: r.followers, label: t("fetch.stat.followers") } : null,
      ],
    });
    return r;
  } catch (e) {
    panel.fail(metaErrorText(e), t("fetch.failed"));
    return null;
  }
}

// ---------- picking ----------
// One question: which Instagram is this brand's. Its Facebook Page follows by
// itself (with "Ganti" to change it), the ad account waits behind a fold, and
// accounts another brand already uses stay out of the way (live 2026-11-25:
// one login shows every account the person has, which read like a matching
// game). Nothing comes ticked except a choice already made.
const radio = (name, value, label, sub, checked, extra = "") => `
  <label class="meta-opt${extra}">
    <input type="radio" name="${name}" value="${escapeHtml(value)}" ${checked ? "checked" : ""}>
    <span><b>${label}</b>${sub ? `<small>${sub}</small>` : ""}</span>
  </label>`;
const matchTag = () => `<em class="meta-match">${escapeHtml(t("meta.pick.match"))}</em>`;
const usedSub = (x) => escapeHtml(t("meta.pick.usedBy", { brand: x.usedBy }));

function listHTML({ name, sorted, picked, render, noneLabel, noneTicked = false }) {
  const row = (x) => {
    const [label, sub] = render(x);
    return radio(name, x.id, `${label}${x.match ? matchTag() : ""}`, x.usedBy ? usedSub(x) : sub, x.id === picked, x.usedBy ? " is-used" : "");
  };
  const usedOpen = sorted.used.some((x) => x.id === picked) || !sorted.free.length;
  return `${sorted.free.map(row).join("")}
    ${sorted.used.length ? `<button type="button" class="meta-pick-more" data-more="${name}" ${usedOpen ? "hidden" : ""}>${escapeHtml(t("meta.pick.showUsed", { n: sorted.used.length }))}</button>
    <div class="meta-pick-used" data-used="${name}" ${usedOpen ? "" : "hidden"}>${sorted.used.map(row).join("")}</div>` : ""}
    ${radio(name, "", noneLabel, "", !picked && noneTicked, " is-none")}`;
}

export async function openMetaPicker(brandId) {
  const brand = getBrand(brandId);
  let a;
  try {
    a = await call("assets", { brandId });
  } catch (e) {
    toast(metaErrorText(e), "error");
    return;
  }
  const brandName = a.brandName || brand?.name || "";
  const usedBy = a.usedBy || {};
  const fb = a.via === "facebook";
  const pages = a.pages || [];
  const pageName = (id) => pages.find((p) => p.id === id)?.name || "";
  const igs = sortForBrand(a.instagram || [], { brandName, usedBy: usedBy.instagram, current: a.current.igUserId, label: (x) => x.username });
  const pageList = sortForBrand(pages, { brandName, usedBy: usedBy.pages, current: a.current.pageId, label: (x) => x.name });
  const adList = sortForBrand(a.adAccounts || [], { brandName, usedBy: usedBy.ads, current: a.current.adAccountId, label: (x) => x.name });
  const igRender = (x) => [`${icon("instagram", { size: 14 })} @${escapeHtml(x.username || x.id)}`, ""];
  const pageRender = (x) => [`${icon("facebook", { size: 14 })} ${escapeHtml(x.name || x.id)}`, ""];
  const adRender = (x) => [escapeHtml(x.name || x.id), escapeHtml([x.id.replace(/^act_/, ""), x.currency].filter(Boolean).join(" · "))];

  // "Tidak pakai" is only ticked for a brand already saved without one.
  const saved = !!(a.current.igUserId || a.current.pageId || a.current.adAccountId);
  // The Page follows the Instagram account until the person changes it.
  let pageId = a.current.pageId || pageForIg((a.instagram || []).find((x) => x.id === a.current.igUserId), pages);
  let pageByHand = !!a.current.pageId;

  const igSection = (a.instagram || []).length
    ? listHTML({ name: "meta-ig", sorted: igs, picked: a.current.igUserId, render: igRender, noneLabel: t("meta.pick.noIg"), noneTicked: saved })
    : `<p class="text-faint meta-pick-empty">${t("meta.pick.nothing")}</p>`;
  const overlay = openModal({
    title: t("meta.pick.title", { brand: escapeHtml(brandName) }),
    bodyHTML: `
      <fieldset class="meta-pick-sec">
        <legend>${t("meta.pick.igFor", { brand: escapeHtml(brandName) })}</legend>
        ${igSection}
      </fieldset>
      ${fb ? `<div class="meta-pick-sec meta-pick-page">
        <div class="meta-pick-label">${t("meta.pick.page")}</div>
        <div class="meta-page-now" id="meta-page-now"></div>
        <fieldset class="meta-pick-pages" id="meta-page-list" hidden>
          <legend class="sr-only">${t("meta.pick.page")}</legend>
          ${pages.length ? listHTML({ name: "meta-page", sorted: pageList, picked: pageId, render: pageRender, noneLabel: t("meta.pick.noPage") }) : `<p class="text-faint meta-pick-empty">${t("meta.pick.nothing")}</p>`}
        </fieldset>
      </div>
      <details class="meta-pick-ads" ${a.current.adAccountId ? "open" : ""}>
        <summary>${icon("plus", { size: 14 })}${t("meta.pick.addAds")}</summary>
        <fieldset class="meta-pick-sec">
          <legend class="sr-only">${t("meta.pick.ads")}</legend>
          ${(a.adAccounts || []).length ? listHTML({ name: "meta-ads", sorted: adList, picked: a.current.adAccountId, render: adRender, noneLabel: t("meta.pick.none"), noneTicked: saved }) : `<p class="text-faint meta-pick-empty">${t("meta.pick.nothing")}</p>`}
          <p class="text-faint meta-pick-note">${t("meta.pick.adsNote")}</p>
        </fieldset>
      </details>` : ""}`,
    footHTML: `<button class="btn btn-secondary" data-cancel>${t("common.cancel")}</button><button class="btn btn-primary" id="meta-pick-save">${icon("check", { size: 15 })}${t("common.save")}</button>`,
  });
  overlay.classList.add("meta-pick");
  qs("[data-cancel]", overlay)?.addEventListener("click", () => closeOverlay(overlay));
  const val = (name) => qs(`input[name="${name}"]:checked`, overlay)?.value || "";
  qsa("[data-more]", overlay).forEach((b) =>
    b.addEventListener("click", () => {
      b.hidden = true;
      const box = qs(`[data-used="${b.dataset.more}"]`, overlay);
      if (box) box.hidden = false;
    }),
  );

  const showPage = () => {
    const now = qs("#meta-page-now", overlay);
    if (!now) return;
    const name = pageName(pageId);
    const hint = !pageId ? (val("meta-ig") ? t("meta.pick.pageNone") : t("meta.pick.pageWait")) : pageByHand ? "" : t("meta.pick.pageFollows");
    now.innerHTML = `<span>${pageId ? `<b>${icon("facebook", { size: 14 })} ${escapeHtml(name || pageId)}</b>` : `<b class="text-muted">${t("meta.pick.noPage")}</b>`}${hint ? `<small>${escapeHtml(hint)}</small>` : ""}</span>
      ${pages.length ? `<button type="button" class="btn btn-ghost btn-sm" id="meta-page-change">${t(pageId ? "meta.pick.change" : "meta.pick.choose")}</button>` : ""}`;
    qs("#meta-page-change", overlay)?.addEventListener("click", () => {
      const list = qs("#meta-page-list", overlay);
      qsa('input[name="meta-page"]', overlay).forEach((r) => (r.checked = r.value === pageId));
      const ticked = qs('input[name="meta-page"]:checked', overlay);
      const usedBox = ticked?.closest("[data-used]");
      if (usedBox) {
        usedBox.hidden = false;
        const more = qs('[data-more="meta-page"]', overlay);
        if (more) more.hidden = true;
      }
      if (list) list.hidden = false;
      now.hidden = true;
    });
  };
  showPage();
  qsa('input[name="meta-ig"]', overlay).forEach((r) =>
    r.addEventListener("change", () => {
      if (pageByHand) return;
      pageId = pageForIg((a.instagram || []).find((x) => x.id === r.value), pages);
      showPage();
    }),
  );
  qsa('input[name="meta-page"]', overlay).forEach((r) =>
    r.addEventListener("change", () => {
      pageId = r.value;
      pageByHand = true;
    }),
  );

  qs("#meta-pick-save", overlay).addEventListener("click", async (e) => {
    const pick = { igUserId: val("meta-ig"), pageId: fb ? pageId : "", adAccountId: val("meta-ads") };
    if (!pick.igUserId && !pick.pageId && !pick.adAccountId) {
      toast(t("meta.pick.need"), "error");
      return;
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await call("select", { brandId, ...pick });
      closeOverlay(overlay);
      toast(t("meta.saved", { brand: brandName }));
    } catch (err) {
      btn.disabled = false;
      toast(metaErrorText(err), "error");
    }
  });
}

// Meta's dialog sends the person back to /?meta=pick|connected|no-insights|
// error&reason=…&brand=<id>#/settings/meta. Says how it went once, takes the
// flags off the address, and after a Facebook login opens the picker.
export async function handleMetaReturn() {
  const params = new URLSearchParams(location.search);
  const result = params.get("meta");
  if (!result) return;
  const reason = params.get("reason") || "failed";
  const brandId = params.get("brand") || "";
  ["meta", "reason", "brand"].forEach((k) => params.delete(k));
  const qsLeft = params.toString();
  history.replaceState(null, "", `${location.pathname}${qsLeft ? `?${qsLeft}` : ""}${location.hash}`);
  if (result === "error") {
    toast(t(`meta.ret.${["denied", "expired", "nothing"].includes(reason) ? reason : "failed"}`), "error");
    return;
  }
  const brand = getBrand(brandId);
  if (result === "pick" && brandId) return openMetaPicker(brandId);
  if (result === "no-insights") return toast(t("meta.ret.noInsights"), "error");
  toast(t("meta.ret.connected", { name: brand?.instagram?.username ? `@${brand.instagram.username}` : "", brand: brand?.name || "" }));
}

// ---------- Pengaturan → Akun Meta ----------
const when = (ms) => new Date(ms).toLocaleString(getLang() === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function rowsHTML(b) {
  const line = (ic, label, value, off) => `<div class="meta-line${off ? " is-off" : ""}">${icon(ic, { size: 15 })}<span>${label}</span><b>${value}</b></div>`;
  const ig = b.instagram?.connected ? `@${escapeHtml(b.instagram.username || b.instagram.igUserId)}` : "";
  const page = b.facebook?.connected ? escapeHtml(b.facebook.pageName || b.facebook.pageId) : "";
  const ads = b.ads?.connected ? escapeHtml([b.ads.name, b.ads.currency].filter(Boolean).join(" · ")) : "";
  const fb = metaVia(b) === "facebook";
  return [
    line("instagram", t("meta.row.instagram"), ig || t("meta.row.off"), !ig),
    fb ? line("facebook", t("meta.row.page"), page || t("meta.row.off"), !page) : "",
    fb ? line("megaphone", t("meta.row.ads"), ads || t("meta.row.off"), !ads) : "",
  ].join("");
}
// What the last pass brought: followers and reach, Instagram and the Page.
function numbersHTML(b) {
  const n = (v) => (v === null || v === undefined ? "–" : formatNumber(v));
  const ig = b.instagram?.connected && b.insights?.instagram?.source === "instagram" ? b.insights.instagram : null;
  const pg = b.facebook?.connected && b.insights?.facebook?.source === "facebook" ? b.insights.facebook : null;
  const lines = [
    ig ? t("meta.numbers.ig", { followers: n(ig.followers), reach: n(ig.reach30d) }) : "",
    pg ? t("meta.numbers.page", { followers: n(pg.followers), reach: n(pg.reach30d) }) : "",
  ].filter(Boolean);
  return lines.length ? `<p class="text-faint meta-when">${lines.join(" · ")}</p>` : "";
}
function brandCardHTML(b) {
  const head = `<div class="meta-card-head">${avatarHTML(b, "flex:none;width:30px;height:30px;border-radius:9px;font-size:12px;")}<div><b>${escapeHtml(b.name)}</b><small>${metaConnected(b) ? t(metaVia(b) === "instagram" ? "meta.viaInstagram" : "meta.viaFacebook") : t("meta.notConnected")}</small></div></div>`;
  if (!metaConnected(b)) {
    return `<div class="card meta-card" data-meta-brand="${escapeHtml(b.id)}">${head}
      <div class="meta-ways">
        <button type="button" class="meta-way is-main" data-meta-connect="facebook">${icon("facebook", { size: 18 })}<span><b>${t("meta.connectFb")}</b><small>${t("meta.connectFbHint")}</small></span></button>
        <button type="button" class="meta-way" data-meta-connect="instagram">${icon("instagram", { size: 18 })}<span><b>${t("meta.connectIg")}</b><small>${t("meta.connectIgHint")}</small></span></button>
      </div></div>`;
  }
  const last = b.instagram?.lastSyncAt || b.facebook?.lastSyncAt || b.ads?.lastSyncAt;
  const adsNote = b.ads?.lastSync?.currencySkipped ? t("meta.adsNotIdr") : b.ads?.lastSync?.unmatched ? t("meta.adsUnmatched", { n: b.ads.lastSync.unmatched }) : "";
  return `<div class="card meta-card" data-meta-brand="${escapeHtml(b.id)}">${head}
    ${metaNeedsReconnect(b) ? `<p class="meta-warn">${icon("info", { size: 14 })}${t("meta.reconnectNote")}</p>` : ""}
    <div class="meta-lines">${rowsHTML(b)}</div>
    ${numbersHTML(b)}
    <p class="text-faint meta-when">${last ? t("meta.lastSync", { when: escapeHtml(when(last)) }) : t("meta.neverSynced")}${adsNote ? ` · ${adsNote}` : ""}</p>
    <div class="meta-actions">
      ${metaNeedsReconnect(b) ? `<button type="button" class="btn btn-primary btn-sm" data-meta-connect="${escapeHtml(metaVia(b) || "facebook")}">${icon("refresh", { size: 14 })}${t("meta.reconnect")}</button>` : `<button type="button" class="btn btn-secondary btn-sm" data-meta-sync>${icon("refresh", { size: 14 })}${t("meta.syncNow")}</button>`}
      ${metaVia(b) === "facebook" ? `<button type="button" class="btn btn-secondary btn-sm" data-meta-change>${t("meta.change")}</button>` : ""}
      <button type="button" class="btn btn-ghost btn-sm" data-meta-disconnect>${t("meta.disconnect")}</button>
    </div></div>`;
}

export function renderMetaPanel(content) {
  const brands = listBrands().filter((b) => !b.archived && canManageMeta(b));
  content.innerHTML = `
    <div class="meta-panel">
      <div class="card meta-intro">
        <h3>${t("meta.title")}</h3>
        <p class="text-muted">${t("meta.intro")}</p>
        <p class="text-faint">${icon("info", { size: 13 })}${t("meta.proOnly")}</p>
      </div>
      ${brands.length ? brands.map(brandCardHTML).join("") : `<div class="card"><p class="text-muted" style="margin:0;">${t("meta.none")}</p></div>`}
    </div>`;
  qsa("[data-meta-brand]", content).forEach((card) => {
    const brandId = card.dataset.metaBrand;
    qsa("[data-meta-connect]", card).forEach((btn) => btn.addEventListener("click", () => {
      btn.disabled = true;
      startMetaConnect(brandId, btn.dataset.metaConnect).finally(() => { if (btn.isConnected) btn.disabled = false; });
    }));
    qs("[data-meta-sync]", card)?.addEventListener("click", (e) => {
      e.currentTarget.disabled = true;
      syncMetaNow(brandId).finally(() => { if (e.currentTarget?.isConnected) e.currentTarget.disabled = false; });
    });
    qs("[data-meta-change]", card)?.addEventListener("click", () => openMetaPicker(brandId));
    qs("[data-meta-disconnect]", card)?.addEventListener("click", () => disconnectMeta(brandId));
  });
}

// The brand form's line about it (js/views/brands.js): where it stands and
// where to change it.
export function metaBrandRowHTML(b) {
  const what = metaConnected(b)
    ? [b.instagram?.connected ? `@${escapeHtml(b.instagram.username || "")}` : "", b.facebook?.connected ? escapeHtml(b.facebook.pageName || "") : "", b.ads?.connected ? escapeHtml(b.ads.name || "") : ""].filter(Boolean).join(" · ")
    : t("meta.notConnected");
  return `<div class="meta-brand-row">${icon("instagram", { size: 16 })}<div><b>${t("meta.brandRow")}</b><small>${what}</small></div><a class="btn btn-secondary btn-sm" href="#/settings/meta">${t("meta.brandRowManage")}</a></div>`;
}
