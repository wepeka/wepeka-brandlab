// The Wepeka Billboard banner on Beranda (owner, 2026-11-24: "wepeka
// billboardnya gak kelihatan, aku mau di home kaya ada visual yang
// mengarahkan gitu kaya iklan, kesannya bisa di close"). The newest story —
// its cover, its title — and a way to the Billboard page; ✕ hides it until
// a newer story goes up (one a day), remembered on this device.
import { loadBillboard } from "./billboard-data.js";
import { icon } from "./icons.js";
import { qs, escapeHtml as esc } from "./dom.js";
import { t } from "./i18n.js";

const CLOSED_KEY = "brandlab:bb-promo-closed";
const closedId = () => { try { return localStorage.getItem(CLOSED_KEY) || ""; } catch { return ""; } };

export const billboardPromoSlotHTML = () => `<div id="bb-promo-slot" class="bb-promo-slot"></div>`;

function promoHTML(p) {
  return `
    <aside class="bb-promo" role="complementary" aria-label="${esc(t("bb.promo.label"))}">
      <a class="bb-promo-link" href="#/billboard" data-bb-promo-open>
        <span class="bb-promo-cover">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : ""}${icon("megaphone", { size: 22 })}</span>
        <span class="bb-promo-body">
          <span class="bb-promo-eyebrow"><em>${esc(t("bb.promo.eyebrow"))}</em><span>${esc(t("bb.promo.fresh"))}</span></span>
          <b class="bb-promo-title">${esc(p.title)}</b>
          <span class="bb-promo-cta">${esc(t("bb.promo.cta"))}${icon("arrowRight", { size: 14 })}</span>
        </span>
      </a>
      <button type="button" class="bb-promo-close" data-bb-promo-close aria-label="${esc(t("bb.promo.close"))}" title="${esc(t("bb.promo.close"))}">${icon("x", { size: 15 })}</button>
    </aside>`;
}

// Fills the slot once the stories are in; nothing when closed for this
// story, when the Billboard can't be read, or when there's no story.
export function mountBillboardPromo(root) {
  const slot = qs("#bb-promo-slot", root);
  if (!slot) return;
  loadBillboard().then((data) => {
    const p = data?.posts?.[0];
    if (!p || !slot.isConnected || closedId() === p.id) return;
    slot.innerHTML = promoHTML(p);
    slot.classList.add("is-on");
    qs("[data-bb-promo-close]", slot)?.addEventListener("click", () => {
      try { localStorage.setItem(CLOSED_KEY, p.id); } catch { /* this visit only */ }
      slot.classList.add("is-closing");
      setTimeout(() => { slot.innerHTML = ""; slot.classList.remove("is-on", "is-closing"); }, 220);
    });
  }).catch(() => {});
}
