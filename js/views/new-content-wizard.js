// "Konten baru" for Pemula — two short steps instead of the long drawer
// (owner's ask, 2026-10-26: "jangan satu form panjang, maksimal 2 langkah").
//
//   1. Mau bikin apa?   — a colour card per kind of piece (its own little
//                         character), and where it goes out.
//   2. Idenya apa?      — the idea in the owner's own words (or nothing:
//                         it gets found with the AI next), when it goes out,
//                         and the campaign it is for, if there is one.
//
// Then the piece opens in Creator on its first step, Ide, with the chat next
// to it — the wizard asks only what the AI and the calendar need to start.
// Everything else (the goal of the piece, references, notes) waits in
// Creator. Pro keeps the full drawer (js/views/content-editor.js).
import { createContent, getSettings, listCampaigns, getCampaign, localISODate } from "../store.js";
import { icon, platformIcon } from "../icons.js";
import { escapeHtml, toast } from "../dom.js";
import { openModal, closeOverlay } from "../modals.js";
import { t, campaignDisplayName } from "../i18n.js";
import { appCharacterSVG } from "../app-characters.js";
import { activeCampaignsFor } from "../week-plan.js";
import { addDays } from "../goal-roadmap.js";

// The kinds, matched by name against the account's own Format list
// (Pengaturan → Format can rename or remove them). `pick` = the format names
// to store, best first; a short video on TikTok/YouTube is a "Short Video".
const KINDS = [
  { key: "video", art: "fmt-video", color: "#FF6FAE", match: /reel|short/i },
  { key: "carousel", art: "fmt-carousel", color: "#FFC83D", match: /carousel/i },
  { key: "photo", art: "fmt-photo", color: "#36D27F", match: /static|post|foto|photo|image/i },
  { key: "story", art: "fmt-story", color: "#A974FF", match: /story/i },
  { key: "long", art: "fmt-long", color: "#FF8A3D", match: /long|panjang/i },
];

// Which of this account's formats a kind stands for on a platform.
export function formatForKind(kindKey, platform, formats) {
  const names = (formats || []).map((f) => f.name);
  const kind = KINDS.find((k) => k.key === kindKey);
  if (!kind) return names.includes(kindKey) ? kindKey : "";
  const hits = names.filter((n) => kind.match.test(n));
  if (kindKey === "video") {
    const short = hits.find((n) => /short/i.test(n));
    const reels = hits.find((n) => /reel/i.test(n));
    return (/tiktok|youtube/i.test(platform || "") ? short || reels : reels || short) || "";
  }
  return hits[0] || "";
}

// The kind a stored format name belongs to (a Calendar default, say).
export function kindOfFormat(format) {
  return KINDS.find((k) => k.match.test(format || ""))?.key || "";
}

// The words typed in step 2 → the piece's working title (the first line)
// and its idea (the lines after it; a first line too long for a title is
// cut at a word and kept whole as the idea).
export function titleAndIdea(text) {
  const lines = String(text || "").trim().split("\n");
  const first = (lines[0] || "").trim();
  const rest = lines.slice(1).join("\n").trim();
  if (first.length <= 80) return { title: first, idea: rest };
  const cut = first.slice(0, 80);
  const title = (cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut).trim();
  return { title, idea: [first, rest].filter(Boolean).join("\n") };
}

function kindsFor(formats) {
  return KINDS.filter((k) => (formats || []).some((f) => k.match.test(f.name)));
}

function step1HTML(s, kinds, platforms, extraFormats) {
  return `
    <div class="nw-tiles" role="radiogroup" aria-label="${escapeHtml(t("nw.title1"))}">
      ${kinds.map((k, i) => `
        <button type="button" class="nw-tile${s.kind === k.key ? " is-on" : ""}" role="radio" aria-checked="${s.kind === k.key}" data-kind="${k.key}" style="--tile:${k.color};--i:${i};">
          <span class="nw-tile-art">${appCharacterSVG(k.art)}</span>
          <span class="nw-tile-name">${t(`nw.fmt.${k.key}`)}</span>
          <span class="nw-tile-sub">${t(`nw.fmt.${k.key}.sub`)}</span>
          <span class="nw-tile-check" aria-hidden="true">${icon("check", { size: 14 })}</span>
        </button>`).join("")}
      ${extraFormats.map((name, i) => `
        <button type="button" class="nw-tile is-plain${s.kind === name ? " is-on" : ""}" role="radio" aria-checked="${s.kind === name}" data-kind="${escapeHtml(name)}" style="--tile:#e9e2d6;--i:${kinds.length + i};">
          <span class="nw-tile-name">${escapeHtml(name)}</span>
          <span class="nw-tile-check" aria-hidden="true">${icon("check", { size: 14 })}</span>
        </button>`).join("")}
    </div>
    ${platforms.length ? `
    <div class="nw-row">
      <span class="nw-label" id="nw-where">${t("nw.where")}</span>
      <div class="nw-chips" role="radiogroup" aria-labelledby="nw-where">
        ${platforms.map((p) => `<button type="button" class="nw-chip${s.platform === p.name ? " is-on" : ""}" role="radio" aria-checked="${s.platform === p.name}" data-platform="${escapeHtml(p.name)}">${platformIcon(p.id || p.name)}<span>${escapeHtml(p.name)}</span></button>`).join("")}
      </div>
    </div>` : ""}`;
}

function step2HTML(s, campaigns) {
  const today = localISODate();
  const tomorrow = addDays(today, 1);
  const when = s.date === "" ? "none" : s.date === today ? "today" : s.date === tomorrow ? "tomorrow" : "pick";
  const chip = (key, label) => `<button type="button" class="nw-chip${when === key ? " is-on" : ""}" role="radio" aria-checked="${when === key}" data-when="${key}">${label}</button>`;
  return `
    <textarea class="nw-text" id="nw-text" rows="3" aria-label="${escapeHtml(t("nw.ideaAria"))}" placeholder="${escapeHtml(t("nw.ideaPh"))}">${escapeHtml(s.text)}</textarea>
    <p class="nw-hint">${icon("sparkle", { size: 12 })}${t("nw.ideaHint")}</p>
    <div class="nw-row">
      <span class="nw-label" id="nw-when">${t("nw.when")}</span>
      <div class="nw-chips" role="radiogroup" aria-labelledby="nw-when">
        ${chip("none", t("nw.when.none"))}${chip("today", t("nw.when.today"))}${chip("tomorrow", t("nw.when.tomorrow"))}${chip("pick", `${icon("calendar", { size: 13 })}${t("nw.when.pick")}`)}
        <input type="date" class="input nw-date" id="nw-date" min="${today}" value="${when === "pick" ? escapeHtml(s.date) : ""}" ${when === "pick" ? "" : "hidden"} aria-label="${escapeHtml(t("nw.when.pick"))}" />
      </div>
    </div>
    ${campaigns.length ? `
    <div class="nw-row">
      <span class="nw-label" id="nw-goal">${t("nw.goal")}</span>
      <div class="nw-chips" role="radiogroup" aria-labelledby="nw-goal">
        <button type="button" class="nw-chip${s.campaignId ? "" : " is-on"}" role="radio" aria-checked="${!s.campaignId}" data-campaign="">${t("nw.goal.none")}</button>
        ${campaigns.map((c) => `<button type="button" class="nw-chip${s.campaignId === c.id ? " is-on" : ""}" role="radio" aria-checked="${s.campaignId === c.id}" data-campaign="${escapeHtml(c.id)}">${icon("flag", { size: 13 })}<span>${escapeHtml(campaignDisplayName(c.name))}</span></button>`).join("")}
      </div>
    </div>` : ""}`;
}

// Same promise as the drawer: `onSaved(made)` once the piece exists; unless
// `stay`, the app then opens it in Creator.
export function openNewContentWizard({ brandId, defaults = {}, onSaved, stay = false }) {
  const settings = getSettings();
  const formats = settings.formats || [];
  const platforms = settings.platforms || [];
  const kinds = kindsFor(formats);
  // Formats the five kinds don't cover (renamed or added by the owner).
  const extraFormats = formats.map((f) => f.name).filter((n) => !KINDS.some((k) => k.match.test(n)));
  let campaigns = activeCampaignsFor(listCampaigns(brandId));
  const preset = defaults.campaignId ? getCampaign(defaults.campaignId) : null;
  if (preset && !campaigns.some((c) => c.id === preset.id)) campaigns = [preset, ...campaigns];

  const presetKind = defaults.format ? kindOfFormat(defaults.format) || (extraFormats.includes(defaults.format) ? defaults.format : "") : "";
  const s = {
    step: 1,
    kind: presetKind,
    platform: defaults.platform || platforms.find((p) => /instagram/i.test(p.name))?.name || platforms[0]?.name || "",
    text: [defaults.title, defaults.idea].filter(Boolean).join("\n"),
    date: defaults.scheduleDate || "",
    campaignId: defaults.campaignId || "",
  };

  const overlay = openModal({
    title: `<span class="nw-title">${t("nw.title1")}</span><span class="nw-count">${t("nw.step", { n: 1 })}</span>`,
    width: "min(720px, 94vw)",
    bodyHTML: `<div class="nw" id="nw-body"></div>`,
    footHTML: `
      <button type="button" class="btn btn-ghost" id="nw-back" style="visibility:hidden;">${icon("chevronLeft", { size: 14 })}${t("nw.back")}</button>
      <span class="nw-foot-spacer"></span>
      <button type="button" class="nw-cta" id="nw-next"><span></span><span class="nw-cta-dot">${icon("arrowRight", { size: 16 })}</span></button>`,
  });
  overlay.classList.add("nw-overlay");
  const body = overlay.querySelector("#nw-body");
  const nextBtn = overlay.querySelector("#nw-next");
  const backBtn = overlay.querySelector("#nw-back");
  const head = overlay.querySelector(".drawer-head h2");

  const paint = (dir = 0) => {
    head.innerHTML = `<span class="nw-title">${t(s.step === 1 ? "nw.title1" : "nw.title2")}</span><span class="nw-count">${t("nw.step", { n: s.step })}</span>`;
    body.innerHTML = s.step === 1 ? step1HTML(s, kinds, platforms, extraFormats) : step2HTML(s, campaigns);
    body.dataset.step = String(s.step);
    if (dir) { body.classList.remove("is-fwd", "is-back"); void body.offsetWidth; body.classList.add(dir > 0 ? "is-fwd" : "is-back"); }
    backBtn.style.visibility = s.step === 1 ? "hidden" : "";
    syncNext();
    if (s.step === 2) {
      const ta = body.querySelector("#nw-text");
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  };
  const syncNext = () => {
    const label = nextBtn.querySelector("span");
    if (s.step === 1) {
      label.textContent = t("nw.next");
      nextBtn.disabled = !s.kind;
    } else {
      label.textContent = s.text.trim() ? t("nw.start") : t("nw.startEmpty");
      nextBtn.disabled = false;
    }
  };

  body.addEventListener("click", (e) => {
    const tile = e.target.closest("[data-kind]");
    if (tile) {
      s.kind = tile.dataset.kind;
      body.querySelectorAll("[data-kind]").forEach((b) => { const on = b === tile; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); });
      tile.classList.remove("is-pop"); void tile.offsetWidth; tile.classList.add("is-pop");
      syncNext();
      return;
    }
    const plat = e.target.closest("[data-platform]");
    if (plat) {
      s.platform = plat.dataset.platform;
      body.querySelectorAll("[data-platform]").forEach((b) => { const on = b === plat; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); });
      return;
    }
    const when = e.target.closest("[data-when]");
    if (when) {
      const today = localISODate();
      const key = when.dataset.when;
      const dateInput = body.querySelector("#nw-date");
      if (key === "pick") {
        dateInput.hidden = false;
        s.date = dateInput.value || "";
        dateInput.showPicker?.();
        dateInput.focus();
      } else {
        dateInput.hidden = true;
        dateInput.value = "";
        s.date = key === "today" ? today : key === "tomorrow" ? addDays(today, 1) : "";
      }
      body.querySelectorAll("[data-when]").forEach((b) => { const on = b === when; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); });
      return;
    }
    const camp = e.target.closest("[data-campaign]");
    if (camp) {
      s.campaignId = camp.dataset.campaign;
      body.querySelectorAll("[data-campaign]").forEach((b) => { const on = b === camp; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); });
    }
  });
  body.addEventListener("input", (e) => {
    if (e.target.id === "nw-text") { s.text = e.target.value; syncNext(); }
  });
  body.addEventListener("change", (e) => {
    if (e.target.id === "nw-date") s.date = e.target.value;
  });
  body.addEventListener("keydown", (e) => {
    if (e.target.id === "nw-text" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); nextBtn.click(); }
  });

  backBtn.addEventListener("click", () => { s.step = 1; paint(-1); });
  nextBtn.addEventListener("click", () => {
    if (s.step === 1) {
      if (!s.kind) return;
      s.step = 2;
      paint(1);
      return;
    }
    if (s.date && s.date < localISODate()) { toast(t("calendar.pastDate"), "error"); return; }
    const { title, idea } = titleAndIdea(s.text);
    const format = formatForKind(s.kind, s.platform, formats) || defaults.format || "";
    const campaign = s.campaignId ? getCampaign(s.campaignId) : null;
    const made = createContent(brandId, {
      funnel: "TOFU",
      ...defaults,
      title,
      idea,
      format,
      platform: s.platform,
      status: "idea",
      scheduleDate: s.date,
      campaignId: campaign?.id || "",
      // A phase only travels with the campaign it came with.
      campaignPhaseId: campaign && campaign.id === defaults.campaignId ? defaults.campaignPhaseId || "" : "",
      seriesId: defaults.seriesId || "",
    });
    if (!made) return;
    closeOverlay(overlay);
    toast(t("nw.created"));
    onSaved?.(made);
    if (!stay) location.hash = `#/brand/${brandId}/content/creator/${made.id}`;
  });

  paint();
  return overlay;
}
