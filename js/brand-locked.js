// A brand gone preview-only: its monthly slot lapsed and the account now
// holds more brands than its limit (js/account.js lockedBrandIds). Opening
// it lands here instead of the workspace — the owner can look (content
// list, Brand Book) but not change anything until the slot is renewed.
// Nothing is ever deleted. main.js renderRoute sends every #/brand/<id>/…
// address of a locked brand to this page.
import { t, getLang } from "./i18n.js";
import { icon } from "./icons.js";
import { avatarHTML, escapeHtml } from "./dom.js";
import { listContent, listBrands, STATUS_LABELS } from "./store.js";
import { getCachedAccount, isBrandLocked, slotEndingSoon } from "./account.js";
import { BRAND_ADDONS } from "./site-links.js";
import { rp } from "./purchase.js";
import { openBrandRenew } from "./brand-offer.js";

const dateLabel = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString(getLang() === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—");

export function renderLockedBrand(root, brand) {
  const content = listContent(brand.id).slice().sort((a, b) => String(b.scheduleDate || b.publishedDate || "").localeCompare(String(a.scheduleDate || a.publishedDate || "")));
  root.innerHTML = `
    <main class="view brand-locked">
      <a class="brand-locked-back" href="#/">${icon("chevronLeft", { size: 14 })}${t("brands.locked.back")}</a>
      <section class="card brand-locked-hero">
        ${avatarHTML(brand, "width:56px;height:56px;border-radius:14px;font-size:20px;flex:none;")}
        <div class="brand-locked-text">
          <span class="brand-locked-pill">${icon("lock", { size: 12 })}${t("brands.locked.pill")}</span>
          <h1>${escapeHtml(brand.name)}</h1>
          <p>${t("brands.locked.body")}</p>
        </div>
        <div class="brand-locked-actions">
          <button type="button" class="btn btn-primary" data-renew>${icon("refresh", { size: 14 })}${t("brands.locked.renewBtn", { price: rp(BRAND_ADDONS.sub[0].price) })}</button>
          <button type="button" class="btn btn-secondary" data-book>${icon("book", { size: 14 })}${t("brands.locked.book")}</button>
        </div>
      </section>
      <section class="card brand-locked-list">
        <h3>${t("brands.locked.contentTitle", { n: content.length })}</h3>
        ${content.length
          ? content.slice(0, 60).map((c) => `
            <div class="brand-locked-row">
              <span class="brand-locked-date">${dateLabel(c.scheduleDate || c.publishedDate)}</span>
              <span class="brand-locked-title">${escapeHtml(c.title || t("common.untitled"))}</span>
              <span class="status-pill status-${c.status}"><span class="status-dot"></span>${STATUS_LABELS[c.status] || c.status}</span>
            </div>`).join("")
          : `<p class="text-muted">${t("brands.locked.noContent")}</p>`}
      </section>
    </main>`;
  root.querySelector("[data-renew]").addEventListener("click", () => openBrandRenew(brand));
  root.querySelector("[data-book]").addEventListener("click", async () => {
    const { openBrandBookReadOnly } = await import("./views/brand-guidelines.js");
    openBrandBookReadOnly(brand);
  });
  // Renewed (the webhook landed): back to the real workspace.
  const onAccount = () => {
    if (!isBrandLocked(brand.id, listBrands())) window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  window.addEventListener("account:change", onAccount);
  return () => window.removeEventListener("account:change", onAccount);
}

// "Slot brand tambahanmu habis 2 Okt" — shown on the brands page three days
// before a monthly slot runs out (there's no automatic monthly charge).
export function slotReminderHTML(account = getCachedAccount()) {
  const ends = slotEndingSoon(account);
  if (!ends) return "";
  const date = new Date(ends).toLocaleDateString(getLang() === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "long" });
  return `
    <div class="brand-slot-reminder">
      ${icon("clock", { size: 15 })}
      <span>${t("brands.locked.reminder", { date })}</span>
      <button type="button" class="btn btn-primary btn-sm" data-slot-renew>${t("brands.locked.renewBtn", { price: rp(BRAND_ADDONS.sub[0].price) })}</button>
    </div>`;
}
