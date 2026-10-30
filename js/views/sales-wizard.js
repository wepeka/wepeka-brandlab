// The two ways money gets logged in the Sales app (owner, 2026-10-30: "UI
// inputnya jelas banget, ada motion dan gambarnya, jelas mana pemasukan,
// mana pengeluaran, wizardnya jelas dapet sales dari mana — tapi jangan
// terlalu panjang"):
//   Pemasukan (money in), 3 short steps: what sold (+ how many / money) →
//     where the buyer came from (a channel tile; one tap moves on unless the
//     channel can be narrowed: which ad platform, which fair, which post) →
//     check & save (day, returning buyer, note, campaign).
//   Pengeluaran (money out), 2 steps: what it was for → how much & when.
// Each wizard has its own colour (green in, coral out) and picture (a coin
// dropping into / flying out of a wallet, js/sales-art.js). Saving shows a
// short "tercatat" moment with "Catat lagi". Passing `entry` opens the same
// wizard on its last step to edit that record.
import { getBrand, listCampaigns, localISODate } from "../store.js";
import {
  getTracker, logSale, updateSale, logExpense, updateExpense, effectivePrice, activeDiscountPct, saleSourceOptions,
  SALE_CHANNELS, AD_PLATFORMS, EXPENSE_CATEGORIES, channelByKey, expenseCategoryByKey, entryChannel,
} from "../sales-tracker.js";
import { salesArtSVG } from "../sales-art.js";
import { openModal, closeOverlay } from "../modals.js";
import { icon } from "../icons.js";
import { formatNumber, formatDate, qs, qsa, escapeHtml as esc } from "../dom.js";
import { t, campaignDisplayName } from "../i18n.js";

export const INCOME_COLORS = { color: "#3DDC84", color2: "#0FB878" };
export const EXPENSE_COLORS = { color: "#FF9A62", color2: "#FF4F6E" };
const PRODUCT_TINTS = ["#FFA52B", "#3B9BFF", "#E04FD8", "#30D97D", "#A974FF", "#FF5C35", "#14B8A6", "#FFD23F"];

const onlyDigits = (v) => String(v ?? "").replace(/[^\d]/g, "");
const toNum = (v) => (onlyDigits(v) === "" ? null : Number(onlyDigits(v)));
const rp = (n) => `Rp ${formatNumber(Math.round(n || 0))}`;
const shiftDay = (iso, by) => {
  const [y, m, d] = iso.split("-").map(Number);
  return localISODate(new Date(y, m - 1, d + by));
};
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
export const channelLabel = (key) => (key ? t(`sw.ch.${key}`) : t("sw.ch.none"));
export const adPlatformLabel = (key) => (AD_PLATFORMS.includes(key) ? t(`sw.ad.${key}`) : key);
export const categoryLabel = (key) => t(`sw.cat.${expenseCategoryByKey(key).key}`);

// The wizard shell: picture + kicker + the step's question, the step dots,
// the step body (slides in), and its own footer.
function shellHTML(kind, steps) {
  return `
    <div class="sw sw--${kind}">
      <div class="sw-hero">
        <span class="sw-hero-art lh-pic" aria-hidden="true">${salesArtSVG(kind)}</span>
        <div class="sw-hero-text">
          <span class="sw-kicker">${icon(kind === "income" ? "plus" : "arrowUp", { size: 12 })}${t(`sw.${kind}.kicker`)}</span>
          <h3 class="sw-q" id="sw-q"></h3>
          <p class="sw-hint" id="sw-hint"></p>
        </div>
      </div>
      <ol class="sw-dots" aria-hidden="true">${steps.map((s, i) => `<li data-dot="${i}"><span>${i + 1}</span>${esc(s)}</li>`).join("")}</ol>
      <div class="sw-body" id="sw-body"></div>
      <div class="sw-foot" id="sw-foot"></div>
    </div>`;
}

function dayPickerHTML(date) {
  const today = localISODate();
  const yesterday = shiftDay(today, -1);
  const chip = (iso, label) => `<button type="button" data-day="${iso}" class="${date === iso ? "active" : ""}">${label}</button>`;
  return `
    <div class="sw-field"><span class="sw-label">${t("sales.log.date")}</span>
      <div class="chip-select sw-days">${chip(today, t("sales.log.today"))}${chip(yesterday, t("sales.log.yesterday"))}
        <input class="input st-date-input ${date !== today && date !== yesterday ? "is-custom" : ""}" type="date" id="sw-date" value="${date}" max="${today}" aria-label="${esc(t("sales.log.otherDay"))}" />
      </div>
    </div>`;
}
function wireDayPicker(body, st, after) {
  const dateEl = qs("#sw-date", body);
  const set = (iso) => {
    const today = localISODate();
    st.date = !iso || iso > today ? today : iso;
    dateEl.value = st.date;
    qsa("[data-day]", body).forEach((b) => b.classList.toggle("active", b.dataset.day === st.date));
    dateEl.classList.toggle("is-custom", st.date !== today && st.date !== shiftDay(today, -1));
    after?.();
  };
  qsa("[data-day]", body).forEach((b) => b.addEventListener("click", () => set(b.dataset.day)));
  dateEl.addEventListener("change", () => set(dateEl.value));
}
const tileHTML = ({ value, label, sub = "", iconName, color, active, attr = "data-pick" }) => `
  <button type="button" class="sw-tile${active ? " is-active" : ""}" ${attr}="${esc(value)}" style="--c:${color}">
    <span class="sw-tile-ico">${icon(iconName, { size: 20 })}</span>
    <span class="sw-tile-text"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
    <span class="sw-tile-check">${icon("check", { size: 12 })}</span>
  </button>`;
const chipsHTML = (items, current, attr) => `<div class="chip-select sw-chips">${items.map((x) => `<button type="button" ${attr}="${esc(x.value)}" class="${x.value === current ? "active" : ""}">${esc(x.label)}</button>`).join("")}</div>`;

// "Terhubung ke My Goals": one optional pick among the brand's running
// events and goals, for any channel (an ad for a launch, a post for an event…).
// A linked sale shows on that goal's own page; a linked expense counts as
// that event's cost there. `st.eventId` / `st.campaignId` hold the pick.
function goalLinkHTML(sources, allCampaigns, st, { forExpense = false } = {}) {
  const items = [
    ...sources.events.map((c) => ({ id: c.id, kind: "event", name: c.name, date: c.eventPlan?.eventDate })),
    ...sources.campaigns.map((c) => ({ id: c.id, kind: "goal", name: campaignDisplayName(c.name) || t("camp.untitled") })),
  ];
  const picked = st.eventId || st.campaignId;
  if (picked && !items.some((x) => x.id === picked)) {
    const c = allCampaigns.find((x) => x.id === picked);
    if (c) items.unshift({ id: c.id, kind: c.eventPlan ? "event" : "goal", name: campaignDisplayName(c.name) || c.name, date: c.eventPlan?.eventDate });
  }
  return `
    <div class="sw-field sw-goals">
      <span class="sw-label">${icon("target", { size: 13 })}${t(forExpense ? "sw.goal.labelOut" : "sw.goal.label")} <span class="copy-optional">${t("goal.sales.optional")}</span></span>
      ${items.length
        ? `<div class="sw-goal-list">${items.map((x) => `
            <button type="button" class="sw-goal${x.id === picked ? " is-active" : ""}" data-goal="${x.id}" data-goal-kind="${x.kind}">
              <span class="sw-goal-ico is-${x.kind}">${icon(x.kind === "event" ? "calendar" : "flag", { size: 14 })}</span>
              <span class="sw-goal-text"><b>${esc(x.name || "")}</b><small>${x.kind === "event" ? `${t("sw.goal.event")}${x.date ? ` · ${esc(formatDate(x.date, { year: undefined }))}` : ""}` : t("sw.goal.goal")}</small></span>
              <span class="sw-tile-check">${icon("check", { size: 12 })}</span>
            </button>`).join("")}</div>
           <p class="sw-note">${t(forExpense ? "sw.goal.hintOut" : "sw.goal.hint")}</p>`
        : `<p class="sw-note">${t("sw.goal.none")}</p>`}
    </div>`;
}
function wireGoalLink(body, st) {
  qsa("[data-goal]", body).forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.goal;
      const on = (st.eventId || st.campaignId) !== id;
      st.eventId = on && b.dataset.goalKind === "event" ? id : "";
      st.campaignId = on && b.dataset.goalKind === "goal" ? id : "";
      qsa("[data-goal]", body).forEach((x) => x.classList.toggle("is-active", on && x === b));
    })
  );
}

// Steps run inside one modal. `go(n, dir)` repaints the body, sliding it in.
function runWizard({ kind, title, steps, st, paintStep, onClose }) {
  const colors = kind === "income" ? INCOME_COLORS : EXPENSE_COLORS;
  const overlay = openModal({ title, bodyHTML: shellHTML(kind, steps), width: "min(620px, 94vw)" });
  overlay.querySelector(".modal")?.classList.add("sw-modal");
  const root = qs(".sw", overlay);
  root.style.setProperty("--app", colors.color);
  root.style.setProperty("--app2", colors.color2);
  const go = (n, dir = "next") => {
    st.step = n;
    qsa("[data-dot]", root).forEach((d) => {
      const i = Number(d.dataset.dot);
      d.classList.toggle("is-done", i < n);
      d.classList.toggle("is-current", i === n);
    });
    const body = qs("#sw-body", root);
    body.classList.remove("sw-in-next", "sw-in-back");
    void body.offsetWidth;
    body.classList.add(dir === "back" ? "sw-in-back" : "sw-in-next");
    paintStep({ root, body, foot: qs("#sw-foot", root), q: qs("#sw-q", root), hint: qs("#sw-hint", root), go, close: () => closeOverlay(overlay) });
  };
  go(st.step || 0);
  return overlay;
}
const footHTML = ({ back = true, nextLabel = t("sw.next"), nextIcon = "arrowRight", disabled = false, primaryId = "sw-next" }) => `
  ${back ? `<button type="button" class="btn btn-ghost" id="sw-back">${icon("chevronLeft", { size: 15 })}${t("sw.back")}</button>` : "<span></span>"}
  <button type="button" class="btn sw-go" id="${primaryId}" ${disabled ? "disabled" : ""}>${nextLabel}${icon(nextIcon, { size: 15 })}</button>`;

// "Tercatat!" — the moment after a save, with "log another".
function doneHTML(kind, amountText, line) {
  return `
    <div class="sw-done">
      <span class="sw-done-badge">${icon("check", { size: 34 })}<i></i><i></i><i></i><i></i><i></i></span>
      <b class="sw-done-amount">${kind === "income" ? "+" : "−"} ${esc(amountText)}</b>
      <p>${esc(line)}</p>
    </div>`;
}

// ---------- Pemasukan ----------
export function openIncomeWizard({ brandId, unit, entry = null, presetCampaignId = null, onSaved, onAddProduct = null }) {
  const tracker = getTracker(getBrand(brandId));
  // A product added from inside the wizard joins this list.
  let products = tracker.products.filter((p) => !p.archived || p.id === entry?.productId);
  const sources = saleSourceOptions(brandId);
  const allCampaigns = listCampaigns(brandId);
  const preset = presetCampaignId ? allCampaigns.find((c) => c.id === presetCampaignId) : null;
  const st = entry
    ? {
        step: 2, productId: entry.productId, qty: entry.qty, amount: entry.amount, auto: false, date: entry.date,
        channel: entryChannel(entry), detail: entry.channelDetail || "", contentId: entry.source?.contentId || "",
        eventId: entry.eventId || "", campaignId: !entry.source?.contentId && !entry.eventId ? entry.source?.campaignId || "" : "",
        repeat: !!entry.repeat, note: entry.note || "", answered: true,
      }
    : {
        step: 0, productId: products[0]?.id || null, qty: 1, amount: null, auto: true, date: localISODate(),
        channel: preset?.eventPlan ? "event" : null, detail: "", contentId: "", eventId: preset?.eventPlan ? preset.id : "",
        campaignId: preset && !preset.eventPlan ? preset.id : "", repeat: false, note: "", answered: !!preset?.eventPlan,
      };
  const product = () => products.find((p) => p.id === st.productId);
  const autoAmount = () => (product() ? effectivePrice(product(), st.date) * Math.max(1, st.qty || 1) : 0);
  const amount = () => (st.auto ? autoAmount() : st.amount || 0);

  const stepProduct = ({ body, foot, q, hint, go }) => {
    q.textContent = t("sw.income.q1");
    hint.textContent = t("sw.income.h1");
    body.innerHTML = `
      <div class="sw-products">
        ${products.map((p, i) => {
          const pct = activeDiscountPct(p, st.date);
          return `<button type="button" class="sw-product${p.id === st.productId ? " is-active" : ""}" data-product="${p.id}" style="--c:${PRODUCT_TINTS[i % PRODUCT_TINTS.length]}">
            <span class="sw-product-ava">${esc(initials(p.name))}</span>
            <span class="sw-product-text"><b>${esc(p.name)}</b><small>${rp(effectivePrice(p, st.date))}${pct ? ` <em>-${pct}%</em>` : ""}</small></span>
            <span class="sw-tile-check">${icon("check", { size: 12 })}</span>
          </button>`;
        }).join("")}
        ${onAddProduct ? `<button type="button" class="sw-product sw-product--new" id="sw-new-product" style="--c:#8A8479">
          <span class="sw-product-ava">${icon("plus", { size: 18 })}</span>
          <span class="sw-product-text"><b>${t("sw.income.newProduct")}</b><small>${t("sw.income.newProductSub")}</small></span>
        </button>` : ""}
      </div>
      <div class="sw-row">
        <div class="sw-field"><span class="sw-label">${t("sales.log.qty", { unit })}</span>
          <div class="st-stepper sw-stepper">
            <button type="button" class="icon-btn" id="sw-minus" aria-label="${esc(t("sales.log.qtyMinus"))}">−</button>
            <input class="input" id="sw-qty" inputmode="numeric" autocomplete="off" value="${formatNumber(st.qty)}" />
            <button type="button" class="icon-btn" id="sw-plus" aria-label="${esc(t("sales.log.qtyPlus"))}">+</button>
          </div>
        </div>
        <div class="sw-field sw-grow"><label class="sw-label" for="sw-amount">${t("sw.income.amount")}</label>
          <div class="sw-money"><span>Rp</span><input class="input" id="sw-amount" inputmode="numeric" autocomplete="off" value="${formatNumber(amount())}" /></div>
        </div>
      </div>
      <p class="sw-note" id="sw-price-note"></p>`;
    foot.innerHTML = footHTML({ back: false, disabled: !st.productId });
    const qtyEl = qs("#sw-qty", body);
    const amtEl = qs("#sw-amount", body);
    const note = qs("#sw-price-note", body);
    const refresh = () => {
      if (st.auto) amtEl.value = formatNumber(autoAmount());
      const per = st.qty ? Math.round(amount() / st.qty) : 0;
      const list = product() ? effectivePrice(product(), st.date) : 0;
      const off = !st.auto && list && per !== list;
      note.classList.toggle("is-warn", !!off);
      note.textContent = off ? t("sales.log.perUnitOff", { price: rp(per), unit, list: rp(list) }) : t("sw.income.autoNote");
    };
    qs("#sw-new-product", body)?.addEventListener("click", () =>
      onAddProduct((p) => {
        if (!p?.id) return;
        products = getTracker(getBrand(brandId)).products.filter((x) => !x.archived || x.id === entry?.productId);
        Object.assign(st, { productId: p.id, auto: true, amount: null });
        go(0);
      })
    );
    qsa("[data-product]", body).forEach((b) =>
      b.addEventListener("click", () => {
        st.productId = b.dataset.product;
        st.auto = true;
        qsa("[data-product]", body).forEach((x) => x.classList.toggle("is-active", x === b));
        qs("#sw-next", foot).disabled = false;
        refresh();
      })
    );
    const setQty = (n) => {
      st.qty = Math.max(1, n || 1);
      qtyEl.value = formatNumber(st.qty);
      refresh();
    };
    qs("#sw-minus", body).addEventListener("click", () => setQty(st.qty - 1));
    qs("#sw-plus", body).addEventListener("click", () => setQty(st.qty + 1));
    qtyEl.addEventListener("input", () => {
      st.qty = toNum(qtyEl.value) || 0;
      qtyEl.value = st.qty ? formatNumber(st.qty) : "";
      refresh();
    });
    amtEl.addEventListener("input", () => {
      const n = toNum(amtEl.value);
      amtEl.value = n === null ? "" : formatNumber(n);
      st.auto = n === null;
      st.amount = n;
      refresh();
    });
    const next = () => {
      if (!st.productId || !(st.qty > 0)) return;
      go(1);
    };
    [qtyEl, amtEl].forEach((el) => el.addEventListener("keydown", (e) => e.key === "Enter" && next()));
    qs("#sw-next", foot).addEventListener("click", next);
    refresh();
  };

  const stepChannel = ({ body, foot, q, hint, go }) => {
    q.textContent = t("sw.income.q2");
    hint.textContent = t("sw.income.h2");
    const detailHTML = () => {
      const ch = channelByKey(st.channel);
      if (!ch?.detail) return "";
      if (ch.detail === "ad") return `<div class="sw-detail"><span class="sw-label">${t("sw.detail.ad")}</span>${chipsHTML(AD_PLATFORMS.map((k) => ({ value: k, label: adPlatformLabel(k) })), st.detail, "data-detail")}</div>`;
      if (ch.detail === "event") {
        return `<div class="sw-detail"><span class="sw-label">${t("sw.detail.event")}</span>
          ${sources.events.length ? chipsHTML(sources.events.map((ev) => ({ value: ev.id, label: ev.name || "" })), st.eventId, "data-event") : ""}
          <input class="input" id="sw-event-name" maxlength="60" placeholder="${esc(t("sw.detail.eventPh"))}" value="${esc(st.eventId ? "" : st.detail)}" /></div>`;
      }
      if (ch.detail === "content" && sources.content.length) {
        return `<div class="sw-detail"><label class="sw-label" for="sw-content">${t("sw.detail.content")}</label>
          <select class="select input" id="sw-content"><option value="">${t("sw.detail.contentNone")}</option>${sources.content.map((c) => `<option value="${c.id}" ${c.id === st.contentId ? "selected" : ""}>${esc(c.title || t("common.untitled"))}${c.publishedDate ? ` — ${esc(formatDate(c.publishedDate, { year: undefined }))}` : ""}</option>`).join("")}</select></div>`;
      }
      return "";
    };
    const paint = () => {
      body.innerHTML = `
        <div class="sw-tiles">${SALE_CHANNELS.map((c) => tileHTML({ value: c.key, label: t(`sw.ch.${c.key}`), sub: t(`sw.ch.${c.key}.sub`), iconName: c.icon, color: c.color, active: st.channel === c.key })).join("")}
          ${tileHTML({ value: "", label: t("sw.ch.unknownTile"), sub: t("sw.ch.unknownSub"), iconName: "help", color: "#8A8479", active: st.answered && !st.channel, attr: "data-unknown" })}</div>
        <div id="sw-detail-slot">${detailHTML()}</div>
        <p class="sw-note sw-why">${icon("info", { size: 13 })}${t("sw.ch.why")}</p>`;
      wire();
    };
    const wire = () => {
      qsa("[data-pick]", body).forEach((b) =>
        b.addEventListener("click", () => {
          const changed = st.channel !== b.dataset.pick;
          st.channel = b.dataset.pick;
          st.answered = true;
          qs("#sw-next", foot).disabled = false;
          if (changed) {
            st.detail = "";
            st.contentId = "";
            if (!preset?.eventPlan) st.eventId = "";
          }
          // A channel with nothing to narrow down: one tap is the answer.
          if (!channelByKey(st.channel).detail) {
            qsa("[data-pick], [data-unknown]", body).forEach((x) => x.classList.toggle("is-active", x === b));
            setTimeout(() => go(2), 260);
            return;
          }
          paint();
          qs("#sw-detail-slot", body).scrollIntoView({ block: "nearest", behavior: "smooth" });
        })
      );
      qsa("[data-detail]", body).forEach((b) => b.addEventListener("click", () => {
        st.detail = st.detail === b.dataset.detail ? "" : b.dataset.detail;
        qsa("[data-detail]", body).forEach((x) => x.classList.toggle("active", x.dataset.detail === st.detail));
      }));
      qsa("[data-event]", body).forEach((b) => b.addEventListener("click", () => {
        st.eventId = st.eventId === b.dataset.event ? "" : b.dataset.event;
        if (st.eventId) st.campaignId = "";
        qsa("[data-event]", body).forEach((x) => x.classList.toggle("active", x.dataset.event === st.eventId));
        if (st.eventId) qs("#sw-event-name", body).value = "";
      }));
      qs("#sw-event-name", body)?.addEventListener("input", (e) => {
        st.detail = e.target.value;
        if (st.detail) {
          st.eventId = "";
          qsa("[data-event]", body).forEach((x) => x.classList.remove("active"));
        }
      });
      qs("#sw-content", body)?.addEventListener("change", (e) => (st.contentId = e.target.value));
      qs("[data-unknown]", body).addEventListener("click", (e) => {
        Object.assign(st, { channel: null, detail: "", contentId: "", answered: true });
        qs("#sw-next", foot).disabled = false;
        qsa("[data-pick], [data-unknown]", body).forEach((x) => x.classList.toggle("is-active", x === e.currentTarget));
        setTimeout(() => go(2), 260);
      });
    };
    // Where the buyer came from is required (an honest "don't know" counts):
    // it is what "Pembeli datang dari mana" and the AI's strategy read.
    foot.innerHTML = footHTML({ disabled: !st.answered });
    qs("#sw-back", foot).addEventListener("click", () => go(0, "back"));
    qs("#sw-next", foot).addEventListener("click", () => st.answered && go(2));
    paint();
  };

  const stepCheck = ({ body, foot, q, hint, go, close }) => {
    q.textContent = entry ? t("sw.income.qEdit") : t("sw.income.q3");
    hint.textContent = t("sw.income.h3");
    const p = product();
    const ch = channelByKey(st.channel);
    const event = st.eventId ? allCampaigns.find((c) => c.id === st.eventId) : null;
    const where = st.channel
      ? `${channelLabel(st.channel)}${st.channel === "ads" && st.detail ? ` · ${adPlatformLabel(st.detail)}` : ""}${st.channel === "event" ? (event ? ` · ${event.name}` : st.detail ? ` · ${st.detail}` : "") : ""}`
      : t("sw.ch.none");
    body.innerHTML = `
      <div class="sw-receipt">
        <div class="sw-receipt-main">
          <span class="sw-receipt-amount">+ ${rp(amount())}</span>
          <span class="sw-receipt-what">${formatNumber(st.qty)}× ${esc(p?.name || "—")}</span>
        </div>
        <button type="button" class="sw-receipt-edit" data-goto="0">${icon("edit", { size: 13 })}${t("common.edit")}</button>
        <div class="sw-receipt-row"><span class="sw-receipt-ch" style="--c:${ch?.color || "#8A8479"}">${icon(ch?.icon || "help", { size: 13 })}${esc(where)}</span>
          <button type="button" class="sw-receipt-edit" data-goto="1">${icon("edit", { size: 13 })}${t("sw.change")}</button></div>
      </div>
      ${dayPickerHTML(st.date)}
      ${goalLinkHTML(sources, allCampaigns, st)}
      <div class="sw-field"><label class="checkbox-chip"><input type="checkbox" id="sw-repeat" ${st.repeat ? "checked" : ""} />${t("sales.log.repeat")}</label></div>
      <details class="sw-more" ${st.note ? "open" : ""}>
        <summary>${t("sw.more2")}</summary>
        <div class="sw-field"><label class="sw-label" for="sw-note">${t("sales.log.note")}</label><input class="input" id="sw-note" maxlength="140" autocomplete="off" placeholder="${esc(t("sales.log.notePh"))}" value="${esc(st.note)}" /></div>
      </details>`;
    foot.innerHTML = footHTML({ nextLabel: entry ? t("common.save") : t("sw.income.save"), nextIcon: "check", primaryId: "sw-save" });
    wireDayPicker(body, st, () => {
      if (st.auto) qs(".sw-receipt-amount", body).textContent = `+ ${rp(amount())}`;
    });
    qsa("[data-goto]", body).forEach((b) => b.addEventListener("click", () => go(Number(b.dataset.goto), "back")));
    qs("#sw-repeat", body).addEventListener("change", (e) => (st.repeat = e.target.checked));
    qs("#sw-note", body).addEventListener("input", (e) => (st.note = e.target.value));
    wireGoalLink(body, st);
    qs("#sw-back", foot).addEventListener("click", () => go(1, "back"));
    qs("#sw-save", foot).addEventListener("click", () => {
      // The My Goals link works with any channel; a post brings its own campaign when none is picked.
      const event = st.eventId ? allCampaigns.find((c) => c.id === st.eventId) : null;
      const goalId = event?.id || st.campaignId || null;
      const contentId = st.channel === "social" && st.contentId ? st.contentId : null;
      const source = contentId || goalId ? { ...(contentId ? { contentId } : {}), ...(goalId ? { campaignId: goalId } : {}) } : null;
      const detail = st.channel === "ads" ? st.detail : st.channel === "event" ? event?.name || st.detail : "";
      const data = {
        productId: st.productId, qty: st.qty, amount: st.auto ? null : st.amount, date: st.date, note: st.note, repeat: st.repeat,
        channel: st.channel, channelDetail: detail, source, eventId: event?.id || null,
      };
      const saved = entry ? updateSale(brandId, entry.id, { ...data, amount: amount(), channel: st.channel || "", referral: st.channel === "referral" ? true : entry.channel === "referral" ? false : undefined }) : logSale(brandId, data);
      if (!saved) return;
      onSaved?.({ kind: "income", entry: saved, edited: !!entry });
      if (entry) {
        close();
        return;
      }
      body.classList.remove("sw-in-next", "sw-in-back");
      body.innerHTML = doneHTML("income", rp(saved.amount), t("sw.income.done", { qty: formatNumber(saved.qty), name: p?.name || "", where }));
      q.textContent = t("sw.doneTitle");
      hint.textContent = "";
      foot.innerHTML = `<button type="button" class="btn btn-ghost" id="sw-close">${t("sw.finish")}</button><button type="button" class="btn sw-go" id="sw-again">${icon("plus", { size: 15 })}${t("sw.again")}</button>`;
      qs("#sw-close", foot).addEventListener("click", close);
      qs("#sw-again", foot).addEventListener("click", () => {
        Object.assign(st, { qty: 1, amount: null, auto: true, channel: preset?.eventPlan ? "event" : null, answered: !!preset?.eventPlan, detail: "", contentId: "", eventId: preset?.eventPlan ? preset.id : "", campaignId: preset && !preset.eventPlan ? preset.id : "", repeat: false, note: "" });
        go(0);
      });
      qs("#sw-again", foot).focus();
    });
  };

  return runWizard({
    kind: "income", title: entry ? t("sw.income.editTitle") : t("sw.income.title"), steps: [t("sw.income.s1"), t("sw.income.s2"), t("sw.income.s3")], st,
    paintStep: (ctx) => [stepProduct, stepChannel, stepCheck][st.step](ctx),
  });
}

// ---------- Pengeluaran ----------
export function openExpenseWizard({ brandId, entry = null, onSaved }) {
  const sources = saleSourceOptions(brandId);
  const allCampaigns = listCampaigns(brandId);
  const st = entry
    ? { step: 1, category: entry.category, detail: entry.channelDetail || "", eventId: entry.eventId || "", campaignId: entry.campaignId || "", amount: entry.amount, date: entry.date, note: entry.note || "" }
    : { step: 0, category: null, detail: "", eventId: "", campaignId: "", amount: null, date: localISODate(), note: "" };

  const stepWhat = ({ body, foot, q, hint, go }) => {
    q.textContent = t("sw.expense.q1");
    hint.textContent = t("sw.expense.h1");
    const detailHTML = () => {
      const cat = st.category ? expenseCategoryByKey(st.category) : null;
      if (cat?.detail === "ad") return `<div class="sw-detail"><span class="sw-label">${t("sw.detail.adSpend")}</span>${chipsHTML(AD_PLATFORMS.map((k) => ({ value: k, label: adPlatformLabel(k) })), st.detail, "data-detail")}</div>`;
      if (cat?.detail === "event") {
        return `<div class="sw-detail"><span class="sw-label">${t("sw.detail.eventSpend")}</span>
          ${sources.events.length ? chipsHTML(sources.events.map((ev) => ({ value: ev.id, label: ev.name || "" })), st.eventId, "data-event") : ""}
          <input class="input" id="sw-event-name" maxlength="60" placeholder="${esc(t("sw.detail.eventPh"))}" value="${esc(st.eventId ? "" : st.detail)}" /></div>`;
      }
      return "";
    };
    const paint = () => {
      body.innerHTML = `
        <div class="sw-tiles sw-tiles--4">${EXPENSE_CATEGORIES.map((c) => tileHTML({ value: c.key, label: t(`sw.cat.${c.key}`), sub: t(`sw.cat.${c.key}.sub`), iconName: c.icon, color: c.color, active: st.category === c.key })).join("")}</div>
        <div id="sw-detail-slot">${detailHTML()}</div>`;
      qsa("[data-pick]", body).forEach((b) =>
        b.addEventListener("click", () => {
          if (st.category !== b.dataset.pick) Object.assign(st, { detail: "", eventId: "" });
          st.category = b.dataset.pick;
          qs("#sw-next", foot).disabled = false;
          if (!expenseCategoryByKey(st.category).detail) {
            qsa("[data-pick]", body).forEach((x) => x.classList.toggle("is-active", x === b));
            setTimeout(() => go(1), 260);
            return;
          }
          paint();
        })
      );
      qsa("[data-detail]", body).forEach((b) => b.addEventListener("click", () => {
        st.detail = st.detail === b.dataset.detail ? "" : b.dataset.detail;
        qsa("[data-detail]", body).forEach((x) => x.classList.toggle("active", x.dataset.detail === st.detail));
      }));
      qsa("[data-event]", body).forEach((b) => b.addEventListener("click", () => {
        st.eventId = st.eventId === b.dataset.event ? "" : b.dataset.event;
        if (st.eventId) st.campaignId = "";
        qsa("[data-event]", body).forEach((x) => x.classList.toggle("active", x.dataset.event === st.eventId));
      }));
      qs("#sw-event-name", body)?.addEventListener("input", (e) => {
        st.detail = e.target.value;
        if (st.detail) st.eventId = "";
      });
    };
    foot.innerHTML = footHTML({ back: false, disabled: !st.category });
    qs("#sw-next", foot).addEventListener("click", () => st.category && go(1));
    paint();
  };

  const stepHowMuch = ({ body, foot, q, hint, go, close }) => {
    const cat = expenseCategoryByKey(st.category);
    q.textContent = entry ? t("sw.expense.qEdit") : t("sw.expense.q2");
    hint.textContent = t("sw.expense.h2");
    const event = st.eventId ? allCampaigns.find((e) => e.id === st.eventId) : null;
    const what = `${t(`sw.cat.${cat.key}`)}${cat.detail === "ad" && st.detail ? ` · ${adPlatformLabel(st.detail)}` : ""}${cat.detail === "event" ? (event ? ` · ${event.name}` : st.detail ? ` · ${st.detail}` : "") : ""}`;
    body.innerHTML = `
      <div class="sw-receipt is-out">
        <div class="sw-receipt-row"><span class="sw-receipt-ch" style="--c:${cat.color}">${icon(cat.icon, { size: 13 })}${esc(what)}</span>
          <button type="button" class="sw-receipt-edit" data-goto="0">${icon("edit", { size: 13 })}${t("sw.change")}</button></div>
      </div>
      <div class="sw-field"><label class="sw-label" for="sw-amount">${t("sw.expense.amount")}</label>
        <div class="sw-money sw-money--big"><span>Rp</span><input class="input" id="sw-amount" inputmode="numeric" autocomplete="off" placeholder="0" value="${st.amount ? formatNumber(st.amount) : ""}" /></div>
      </div>
      ${dayPickerHTML(st.date)}
      ${goalLinkHTML(sources, allCampaigns, st, { forExpense: true })}
      <div class="sw-field"><label class="sw-label" for="sw-note">${t("sales.log.note")} <span class="copy-optional">${t("goal.sales.optional")}</span></label><input class="input" id="sw-note" maxlength="140" autocomplete="off" placeholder="${esc(t(`sw.cat.${cat.key}.ph`))}" value="${esc(st.note)}" /></div>
      ${cat.key === "stock" ? `<p class="sw-note">${t("sw.expense.stockNote")}</p>` : ""}`;
    foot.innerHTML = footHTML({ nextLabel: entry ? t("common.save") : t("sw.expense.save"), nextIcon: "check", primaryId: "sw-save", disabled: !st.amount });
    const amtEl = qs("#sw-amount", body);
    amtEl.addEventListener("input", () => {
      st.amount = toNum(amtEl.value);
      amtEl.value = st.amount === null ? "" : formatNumber(st.amount);
      qs("#sw-save", foot).disabled = !st.amount;
    });
    setTimeout(() => amtEl.focus(), 60);
    wireDayPicker(body, st);
    wireGoalLink(body, st);
    qs("[data-goto]", body).addEventListener("click", () => go(0, "back"));
    qs("#sw-note", body).addEventListener("input", (e) => (st.note = e.target.value));
    qs("#sw-back", foot).addEventListener("click", () => go(0, "back"));
    const save = () => {
      if (!st.amount) return;
      const linked = st.eventId ? allCampaigns.find((e) => e.id === st.eventId) : null;
      const data = { category: st.category, amount: st.amount, date: st.date, note: st.note, channelDetail: cat.detail === "event" ? linked?.name || st.detail : cat.detail === "ad" ? st.detail : "", eventId: linked?.id || null, campaignId: st.campaignId || null };
      const saved = entry ? updateExpense(brandId, entry.id, data) : logExpense(brandId, data);
      if (!saved) return;
      onSaved?.({ kind: "expense", entry: saved, edited: !!entry });
      if (entry) {
        close();
        return;
      }
      body.classList.remove("sw-in-next", "sw-in-back");
      body.innerHTML = doneHTML("expense", rp(saved.amount), t("sw.expense.done", { what }));
      q.textContent = t("sw.doneTitle");
      hint.textContent = "";
      foot.innerHTML = `<button type="button" class="btn btn-ghost" id="sw-close">${t("sw.finish")}</button><button type="button" class="btn sw-go" id="sw-again">${icon("plus", { size: 15 })}${t("sw.againOut")}</button>`;
      qs("#sw-close", foot).addEventListener("click", close);
      qs("#sw-again", foot).addEventListener("click", () => {
        Object.assign(st, { category: null, detail: "", eventId: "", campaignId: "", amount: null, note: "" });
        go(0);
      });
      qs("#sw-again", foot).focus();
    };
    amtEl.addEventListener("keydown", (e) => e.key === "Enter" && save());
    qs("#sw-save", foot).addEventListener("click", save);
  };

  return runWizard({
    kind: "expense", title: entry ? t("sw.expense.editTitle") : t("sw.expense.title"), steps: [t("sw.expense.s1"), t("sw.expense.s2")], st,
    paintStep: (ctx) => [stepWhat, stepHowMuch][st.step](ctx),
  });
}
