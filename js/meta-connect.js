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

export function syncSummary(r) {
  if (r?.reconnect) return t("meta.err.reconnect");
  const parts = [];
  if (r?.updated) parts.push(t("meta.sync.updated", { count: r.updated }));
  if (r?.linked) parts.push(t("meta.sync.linked", { count: r.linked }));
  if (r?.added) parts.push(t("meta.sync.added", { count: r.added }));
  return parts.length ? t("meta.sync.done", { summary: parts.join(", ") }) : t("meta.sync.nothing");
}
// One server pass now: Instagram numbers, posts since connecting, followers,
// the Page, ad spend.
export async function syncMetaNow(brandId) {
  toast(t("meta.sync.running"));
  try {
    const r = await call("sync", { brandId });
    toast(syncSummary(r), r?.reconnect ? "error" : undefined);
    return r;
  } catch (e) {
    toast(metaErrorText(e), "error");
    return null;
  }
}

// ---------- picking ----------
const radio = (name, value, label, sub, checked) => `
  <label class="meta-opt">
    <input type="radio" name="${name}" value="${escapeHtml(value)}" ${checked ? "checked" : ""}>
    <span><b>${label}</b>${sub ? `<small>${sub}</small>` : ""}</span>
  </label>`;
function sectionHTML({ name, title, items, current, render, note = "" }) {
  // Only a choice already made (changing accounts) comes ticked: even a
  // single account is the owner's to pick (live 2026-11-25, the only
  // Instagram offered for the Quatro brand was @winkhsin).
  const picked = current || "";
  return `<fieldset class="meta-pick-sec">
    <legend>${title}</legend>
    ${items.length ? items.map((x) => radio(name, x.id, ...render(x), x.id === picked)).join("") + radio(name, "", t("meta.pick.none"), "", !picked) : `<p class="text-faint meta-pick-empty">${t("meta.pick.nothing")}</p>`}
    ${note && items.length ? `<p class="text-faint meta-pick-note">${note}</p>` : ""}
  </fieldset>`;
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
  const pageName = (id) => a.pages.find((p) => p.id === id)?.name || "";
  const overlay = openModal({
    title: t("meta.pick.title", { brand: escapeHtml(brand?.name || "") }),
    bodyHTML: `
      <p class="text-muted meta-pick-intro">${t("meta.pick.intro")}</p>
      ${sectionHTML({ name: "meta-ig", title: t("meta.pick.ig"), items: a.instagram, current: a.current.igUserId, render: (x) => [`${icon("instagram", { size: 14 })} @${escapeHtml(x.username || x.id)}`, x.pageId && pageName(x.pageId) ? escapeHtml(t("meta.pick.viaPage", { page: pageName(x.pageId) })) : ""] })}
      ${a.via === "facebook" ? sectionHTML({ name: "meta-page", title: t("meta.pick.page"), items: a.pages, current: a.current.pageId, render: (x) => [`${icon("facebook", { size: 14 })} ${escapeHtml(x.name || x.id)}`, ""] }) : ""}
      ${a.via === "facebook" ? sectionHTML({ name: "meta-ads", title: t("meta.pick.ads"), items: a.adAccounts, current: a.current.adAccountId, render: (x) => [escapeHtml(x.name || x.id), escapeHtml([x.id.replace(/^act_/, ""), x.currency].filter(Boolean).join(" · "))], note: t("meta.pick.adsNote") }) : ""}`,
    footHTML: `<button class="btn btn-secondary" data-cancel>${t("common.cancel")}</button><button class="btn btn-primary" id="meta-pick-save">${icon("check", { size: 15 })}${t("common.save")}</button>`,
  });
  overlay.classList.add("meta-pick");
  qs("[data-cancel]", overlay)?.addEventListener("click", () => closeOverlay(overlay));
  const val = (name) => qs(`input[name="${name}"]:checked`, overlay)?.value || "";
  qs("#meta-pick-save", overlay).addEventListener("click", async (e) => {
    const pick = { igUserId: val("meta-ig"), pageId: val("meta-page"), adAccountId: val("meta-ads") };
    if (!pick.igUserId && !pick.pageId && !pick.adAccountId) {
      toast(t("meta.pick.need"), "error");
      return;
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await call("select", { brandId, ...pick });
      closeOverlay(overlay);
      toast(t("meta.saved", { brand: brand?.name || "" }));
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
