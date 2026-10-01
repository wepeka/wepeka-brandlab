import {
  listBrands, createBrand, updateBrand, archiveBrand, deleteBrand, listContent, updateContent, TRASH_DAYS,
} from "../store.js";
import { icon } from "../icons.js";
import { avatarHTML, resizeImageFile, qs, qsa, toast, pickTintTextColor, pickTintForeground, openMenu, closeMenu, escapeHtml as escapeText, passwordFieldHTML, wirePasswordToggles, wireClickableCards } from "../dom.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { testConnection } from "../instagram.js";
import { canUseInstagramApi } from "../account.js";
import { testFacebookConnection } from "../facebook.js";
import { canCreateBrand, brandLimitOf, lockedBrandIds } from "../account.js";
import { slotReminderHTML } from "../brand-locked.js";
import { buyAddon } from "../purchase.js";
import { BRAND_ADDONS } from "../site-links.js";
import { openBrandOffer } from "../brand-offer.js";
import { getMode } from "../mode.js";
import { getSettings } from "../store.js";
import { hasAiKey, draftBusinessDescription } from "../ai.js";
import { wireMic } from "../voice-input.js";
import { t } from "../i18n.js";
import { mountBrandsBg } from "../brands-bg.js";

export function render(root) {
  const refresh = () => paint(root, refresh);
  refresh();
  // Full-screen background lives on <body> (see js/brands-bg.js), so it has
  // to be torn down when this view goes away.
  const unmountBg = mountBrandsBg();
  // A bought brand slot lands on the account doc: unlock the "+" right away.
  window.addEventListener("account:change", refresh);
  return () => { window.removeEventListener("account:change", refresh); unmountBg(); }; // no store subscription needed — actions here re-render locally
}

function paint(root, refresh) {
  const brands = listBrands();
  const guided = getMode() === "guided";

  // No brand yet (either mode): the whole page is one card with one
  // button — never a bare "add brand" tile on an empty grid, which is what
  // a brand-new account used to land on. Pemula gets the journey framing;
  // Pro gets the same card with a tour link. #add-brand keeps its id so
  // the onboarding tour (js/tour.js) still finds it.
  if (!brands.length) {
    root.innerHTML = `
      <section class="card journey-hero guided-first-brand" id="journey-hero">
        <div class="journey-hero-eyebrow"><span class="journey-hero-step">${guided ? t("brands.first.stepGuided") : t("brands.first.stepPro")}</span><span class="journey-hero-time">${icon("clock", { size: 12 })}${t("brands.first.time")}</span></div>
        <h2>${t("brands.first.title")}</h2>
        <p>${guided ? t("brands.first.subGuided") : t("brands.first.subPro")}</p>
        <button type="button" class="btn btn-primary journey-hero-cta" id="add-brand">${t("brands.first.cta")}${icon("arrowRight", { size: 15 })}</button>
        <div class="journey-hero-note">${guided ? t("brands.first.noteGuided") : t("brands.first.notePro")}</div>
      </section>
    `;
    qs("#add-brand").addEventListener("click", () => openBrandModal({ onSaved: refresh }));
    return;
  }

  const locked = !canCreateBrand(brands.length);
  const previewOnly = lockedBrandIds(brands);
  const lockTitle = locked ? t("brands.offer.lockedTitle", { limit: brandLimitOf() }) : t("brands.add");
  root.innerHTML = `
    <div class="hero-strip">
      <div class="kicker">Wepeka Brandlab</div>
      <h1>${guided ? t("brands.hero.titleGuided") : t("brands.hero.titlePro")}</h1>
      <p class="page-sub">${guided ? t("brands.hero.subGuided") : t("brands.hero.subPro")}</p>
    </div>
    ${slotReminderHTML()}
    <div class="brand-row-head">
      <button class="brand-quick-add ${locked ? "is-locked" : ""}" id="add-brand-quick" aria-label="${escapeText(lockTitle)}" title="${escapeText(lockTitle)}">${icon(locked ? "lock" : "plus", { size: 15 })}</button>
    </div>
    <div class="brand-grid brand-grid--picker" id="brand-grid">
      ${brands.map((b) => brandCard(b, previewOnly.has(b.id))).join("")}
      <button class="brand-tile brand-tile-add ${locked ? "is-locked" : ""}" id="add-brand" title="${escapeText(lockTitle)}">
        <div class="brand-tile-avatar brand-tile-avatar-add">${icon(locked ? "lock" : "plus", { size: 28 })}</div>
        <h3>${t("brands.add")}</h3>
        ${locked ? `<div class="meta">${t("brands.offer.lockedMeta", { limit: brandLimitOf() })}</div>` : ""}
      </button>
    </div>
  `;

  const dragState = wireBrandGridDrag(qs("#brand-grid"));

  qs("#add-brand").addEventListener("click", () => {
    if (dragState.wasDragged) return;
    openBrandModal({ onSaved: refresh });
  });
  qs("[data-slot-renew]", root)?.addEventListener("click", () => {
    buyAddon(BRAND_ADDONS.sub[0].renewKey);
  });
  qs("#add-brand-quick")?.addEventListener("click", () => {
    openBrandModal({ onSaved: refresh });
  });

  qsa(".brand-tile:not(.brand-tile-add)").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (dragState.wasDragged) return;
      if (e.target.closest("[data-menu-toggle]") || e.target.closest(".menu")) return;
      location.hash = `#/brand/${card.dataset.id}`;
    });
  });
  wireClickableCards(root, ".brand-tile:not(.brand-tile-add)", { role: "link" });

  qsa("[data-menu-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const rect = btn.getBoundingClientRect();
      const menu = openMenu(btn, { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 190) });
      if (!menu) return;
      menu.innerHTML = `
        <button data-act="edit">${icon("edit", { size: 15 })}${t("common.edit")}</button>
        <button data-act="archive">${icon("archive", { size: 15 })}${t("brands.archive")}</button>
        <div class="menu-divider"></div>
        <button data-act="delete" class="danger">${icon("trash", { size: 15 })}${t("common.delete")}</button>
      `;
      menu.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const act = ev.target.closest("[data-act]")?.dataset.act;
        if (!act) return;
        closeMenu();
        const brand = brands.find((b) => b.id === id);
        if (act === "edit") {
          openBrandModal({ brand, onSaved: refresh });
        } else if (act === "archive") {
          const ok = await confirmDialog({
            title: t("brands.archive.title"),
            message: t("brands.archive.message"),
            confirmLabel: t("brands.archive"),
          });
          if (ok) {
            archiveBrand(id, true);
            toast(t("brands.archive.done"));
            refresh();
          }
        } else if (act === "delete") {
          const count = listContent(id, { includeArchived: true }).length;
          const ok = await confirmDialog({
            title: t("delete.toTrash.title"),
            message: t("delete.toTrash.brandMessage", { count, days: TRASH_DAYS }),
            confirmLabel: t("delete.toTrash.confirm"),
            danger: true,
          });
          if (ok) {
            deleteBrand(id);
            toast(t("delete.toTrash.brandDone"));
            refresh();
          }
        }
      });
    });
  });
}

let brandGridDragCleanup = null;
function wireBrandGridDrag(grid) {
  brandGridDragCleanup?.();
  brandGridDragCleanup = null;
  if (!grid) return { wasDragged: false };

  const state = { down: false, wasDragged: false, startX: 0, startScroll: 0 };
  grid.classList.add("draggable");

  const onDown = (e) => {
    if (e.button !== 0) return;
    state.down = true;
    state.wasDragged = false;
    state.startX = e.pageX;
    state.startScroll = grid.scrollLeft;
    grid.classList.add("pressing");
  };
  const onMove = (e) => {
    if (!state.down) return;
    const dx = e.pageX - state.startX;
    if (Math.abs(dx) > 5 && !state.wasDragged) {
      state.wasDragged = true;
      // Only now (a confirmed drag, not just a click) does pointer-events
      // get disabled on the tiles via the .dragging class — doing that
      // from mousedown instead would risk swallowing a plain click's own
      // click event before it has a chance to fire.
      grid.classList.add("dragging");
    }
    if (state.wasDragged) {
      e.preventDefault();
      grid.scrollLeft = state.startScroll - dx;
    }
  };
  const onUp = () => {
    if (!state.down) return;
    state.down = false;
    grid.classList.remove("pressing", "dragging");
  };

  grid.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  brandGridDragCleanup = () => {
    grid.removeEventListener("mousedown", onDown);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  return state;
}

function brandCard(brand, previewOnly = false) {
  const contents = listContent(brand.id);
  const published = contents.filter((c) => c.status === "published").length;
  // A brand's own picked color overrides --brand-tint just for this tile —
  // the existing .brand-tile-avatar:hover glow rule already reads
  // --brand-tint, so scoping it here (rather than only on document.body,
  // which only ever reflects the *currently open* brand) is what makes
  // each tile in this all-brands list glow in its own color instead of one
  // shared color.
  const color = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(brand.color || "") ? brand.color : "";
  const tintStyle = color
    ? `--brand-tint:${color};--brand-tint-text:${pickTintTextColor(color)};--brand-tint-fg:${pickTintForeground(color)};`
    : "";
  return `
    <div class="brand-tile ${previewOnly ? "is-preview" : ""}" data-id="${escapeText(brand.id)}" style="${tintStyle}" aria-label="${escapeText(brand.name)}" ${previewOnly ? `title="${escapeText(t("brands.locked.tileTitle"))}"` : ""}>
      <div class="brand-tile-avatar">
        ${avatarHTML(brand)}
        ${previewOnly ? `<span class="brand-tile-lock">${icon("lock", { size: 16 })}</span>` : ""}
        <button class="icon-btn brand-tile-menu" data-menu-toggle data-id="${escapeText(brand.id)}" aria-label="${t("brands.tile.actions")}">${icon("dots", { size: 14 })}</button>
      </div>
      <h3>${escapeText(brand.name)}</h3>
      <div class="meta">${previewOnly ? t("brands.locked.tileMeta") : t("brands.tile.meta", { count: contents.length, published })}</div>
    </div>
  `;
}

const AVATAR_PREVIEW_STYLE = "width:64px;height:64px;border-radius:14px;font-size:22px;flex:none;";

// Live preview of the brand mark in the create/edit form: the uploaded
// logo, else a monogram (first letter of the name being typed) on the
// chosen brand color; before any name is typed, an empty dashed tile —
// not a "?" that reads like an error.
function brandMarkPreviewHTML(name, avatar, color) {
  if (avatar) return avatarHTML({ name, avatar }, AVATAR_PREVIEW_STYLE);
  const letter = String(name || "").trim().charAt(0).toUpperCase();
  if (!letter) return `<div class="avatar brand-mark-empty" style="${AVATAR_PREVIEW_STYLE}" aria-hidden="true">${icon("image", { size: 22 })}</div>`;
  const bg = /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#ffa52b";
  return `<div class="avatar" style="${AVATAR_PREVIEW_STYLE}background:${bg};color:${pickTintTextColor(bg)};" aria-hidden="true">${escapeText(letter)}</div>`;
}

// Shared create/edit modal (name + photo). Exported so Settings → Brand
// Management can reuse it too instead of duplicating the form.
export function openBrandModal({ brand = null, onSaved } = {}) {
  // At the plan's brand limit the "+" is locked: it opens the offer (buy a
  // slot on the spot), and the form itself once the slot has landed.
  if (!brand && !canCreateBrand(listBrands().length)) {
    openBrandOffer({ onUnlocked: () => openBrandModal({ brand, onSaved }) });
    return;
  }
  const draft = {
    name: brand?.name || "",
    avatar: brand?.avatar || "",
    color: brand?.color || "",
    instagram: brand?.instagram || { accessToken: "", igUserId: "", username: "", connectedAt: null },
    facebook: brand?.facebook || { pageId: "", pageAccessToken: "", pageName: "", connectedAt: null },
    aiVoiceGuide: brand?.aiVoiceGuide || "",
    businessDescription: brand?.businessDescription || "",
    audienceLanguage: brand?.audienceLanguage || "",
  };

  // Pemula mode: same fields, plainer words, and the brandbook/tone field
  // tucked away (it's optional and "brandbook" means nothing to someone on
  // day one — tone of voice gets set properly inside Brand Builder anyway).
  // The field stays in the DOM (hidden) so the save handler below can keep
  // reading it unconditionally.
  const guided = getMode() === "guided";
  const overlay = openModal({
    title: brand ? t("brands.form.titleEdit") : guided ? t("brands.form.titleGuided") : t("brands.form.titleNew"),
    bodyHTML: `
      <div class="flex items-center gap-8" style="margin-bottom:22px;">
        <div id="avatar-preview">${brandMarkPreviewHTML(draft.name, draft.avatar, draft.color || "#ffa52b")}</div>
        <div class="flex" style="flex-direction:column;gap:8px;">
          <button type="button" class="btn btn-secondary btn-sm" id="upload-avatar">${icon("upload", { size: 14 })}<span id="upload-label">${draft.avatar ? t("brands.form.changePhoto") : t("brands.form.uploadPhoto")}</span></button>
          <button type="button" class="btn btn-ghost btn-sm" id="remove-avatar" style="${draft.avatar ? "" : "display:none;"}">${icon("x", { size: 13 })}${t("brands.form.removePhoto")}</button>
          <input type="file" id="avatar-file" accept="image/*" style="display:none;" />
        </div>
        <div class="flex items-center gap-8" style="margin-left:auto;">
          <div style="text-align:right;">
            <label for="brand-color" style="display:block;font-size:11.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">${t("brands.form.color")}</label>
            <input type="color" id="brand-color" value="${/^#[0-9a-f]{6}$/i.test(draft.color || "") ? draft.color : "#ffa52b"}" style="width:40px;height:40px;border-radius:10px;border:1px solid var(--border);background:none;padding:0;cursor:pointer;" />
          </div>
        </div>
      </div>
      <p class="text-faint" style="font-size:11.5px;margin:-14px 0 18px;">${guided ? t("brands.form.colorHintGuided") : t("brands.form.colorHintPro")}</p>
      <div class="field">
        <label for="brand-name">${guided ? t("brands.form.nameGuided") : t("brands.form.name")}</label>
        <input class="input" id="brand-name" placeholder="${guided ? t("brands.form.namePhGuided") : t("brands.form.namePh")}" value="${escapeText(draft.name || "")}" />
      </div>
      <div class="field" id="brand-desc-field">
        <div class="creator-field-head">
          <label for="brand-description" style="margin-bottom:0;">${guided ? t("brands.form.descLabelGuided") : t("brands.form.descLabel")}</label>
          <div class="flex items-center gap-6">
            <button type="button" class="chip-icon-btn" id="brand-desc-mic" aria-label="${t("brandForm.mic")}" title="${t("brandForm.mic")}">${icon("mic", { size: 15 })}</button>
            <button type="button" class="btn btn-secondary btn-sm" id="brand-desc-ai">${icon("bot", { size: 13 })}${t("brandForm.aiHelp")}</button>
          </div>
        </div>
        <div class="warn-box info-box">
          ${icon("info", { size: 15 })}
          <div><b>${t("brandForm.descWarningTitle")}</b>${t("brandForm.descWarning")}<span class="warn-box-sub">${t("brandForm.descChecklist")}</span></div>
        </div>
        <textarea class="textarea" id="brand-description" style="min-height:120px;" placeholder="${escapeText(guided ? t("brands.form.descPhGuided") : t("brands.form.descPh"))}">${escapeText((draft.businessDescription || ""))}</textarea>
        <div id="brand-desc-ai-status" class="text-faint" style="font-size:11.5px;margin-top:4px;"></div>
        <div class="text-faint" style="font-size:11.5px;margin-top:4px;">${guided ? t("brands.form.descHintGuided") : t("brands.form.descHint")}</div>
      </div>
      <!-- The free-text "AI voice guide" textarea that used to live here was
           removed: Brand DNA (personality + tone of voice) is now the one
           canonical source of a brand's voice — see store.js brandVoiceText().
           An old brand's aiVoiceGuide value is kept (draft.aiVoiceGuide,
           round-tripped unchanged below) and still read as a fallback
           wherever voice is used, it just can't be edited from here anymore. -->
      <div class="field" ${guided && !brand ? "hidden" : ""}>
        <label for="brand-audience-lang">${t("ai.audienceLang.label")}</label>
        <select class="select" id="brand-audience-lang">
          <option value="" ${!draft.audienceLanguage ? "selected" : ""}>${t("ai.audienceLang.auto")}</option>
          <option value="id" ${draft.audienceLanguage === "id" ? "selected" : ""}>${t("ai.audienceLang.id")}</option>
          <option value="en" ${draft.audienceLanguage === "en" ? "selected" : ""}>${t("ai.audienceLang.en")}</option>
        </select>
        <div class="text-faint" style="font-size:11.5px;margin-top:4px;">${t("ai.audienceLang.hint")}</div>
      </div>

      ${
        brand
          ? `
      ${
        !canUseInstagramApi()
          ? ""
          : `
      <div class="divider"></div>
      <div class="page-eyebrow" style="margin-bottom:12px;">${t("integr.ig.title")}</div>
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">${t("integr.ig.intro")}</p>
      <div class="field">
        <label for="ig-userid">Instagram Business Account ID</label>
        <input class="input" id="ig-userid" placeholder="17841400..." value="${escapeText(draft.instagram.igUserId || "")}" />
      </div>
      <div class="field" style="margin-bottom:0;">
        <label for="ig-token">Long-Lived Access Token</label>
        ${passwordFieldHTML("ig-token", { placeholder: "IGAA...", value: draft.instagram.accessToken })}
      </div>
      <div id="ig-status" style="margin:10px 0;font-size:12.5px;">${draft.instagram.username ? `<span style="color:var(--health-good);">${t("integr.connectedAs", { name: escapeText(draft.instagram.username) })}</span>` : ""}</div>
      <button type="button" class="btn btn-secondary btn-sm" id="ig-test">${icon("refresh", { size: 13 })}${t("integr.test")}</button>`
      }

      ${
        // The Facebook connector is a stub — js/facebook.js only ever calls
        // testFacebookConnection, nothing reads the metrics it'd return —
        // so it's gated behind the same admin-only check Instagram uses,
        // to stop customers from being shown a connector that does nothing.
        !canUseInstagramApi()
          ? ""
          : `
      <div class="divider"></div>
      <div class="page-eyebrow" style="margin-bottom:12px;">${t("integr.fb.title")}</div>
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">${t("integr.fb.intro")}</p>
      <div class="field">
        <label for="fb-pageid">Facebook Page ID</label>
        <input class="input" id="fb-pageid" placeholder="${t("integr.fb.pageIdPh")}" value="${escapeText(draft.facebook.pageId || "")}" />
      </div>
      <div class="field" style="margin-bottom:0;">
        <label for="fb-token">Page Access Token</label>
        ${passwordFieldHTML("fb-token", { placeholder: "EAA...", value: draft.facebook.pageAccessToken })}
      </div>
      <div id="fb-status" style="margin:10px 0;font-size:12.5px;">${draft.facebook.pageName ? `<span style="color:var(--health-good);">${t("integr.connectedTo", { name: escapeText(draft.facebook.pageName) })}</span>` : ""}</div>
      <button type="button" class="btn btn-secondary btn-sm" id="fb-test">${icon("refresh", { size: 13 })}${t("integr.test")}</button>
      `
      }

      `
          : guided
            ? ""
            : `
      <div class="divider"></div>
      <p class="text-faint" style="font-size:11.5px;margin:0;">${t("brands.form.connectLater")}</p>
      `
      }
    `,
    footHTML: `
      <button class="btn btn-secondary" data-cancel>${t("common.cancel")}</button>
      <button class="btn btn-primary" data-save>${icon("check", { size: 15 })}${guided && !brand ? t("brands.form.saveNext") : t("common.save")}</button>
    `,
    onMount: (el) => {
      wirePasswordToggles(el);
      const nameInput = el.querySelector("#brand-name");
      setTimeout(() => nameInput.focus(), 30);

      const syncAvatarUI = () => {
        el.querySelector("#avatar-preview").innerHTML = brandMarkPreviewHTML(nameInput.value, draft.avatar, el.querySelector("#brand-color")?.value);
        el.querySelector("#upload-label").textContent = draft.avatar ? t("brands.form.changePhoto") : t("brands.form.uploadPhoto");
        el.querySelector("#remove-avatar").style.display = draft.avatar ? "" : "none";
      };

      nameInput.addEventListener("input", syncAvatarUI);
      el.querySelector("#brand-color")?.addEventListener("input", syncAvatarUI);
      el.querySelector("#upload-avatar").addEventListener("click", () => el.querySelector("#avatar-file").click());
      el.querySelector("#avatar-file").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        draft.avatar = await resizeImageFile(file, { maxDimension: 400 });
        syncAvatarUI();
      });
      el.querySelector("#remove-avatar").addEventListener("click", () => {
        draft.avatar = "";
        syncAvatarUI();
      });
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") overlay.querySelector("[data-save]").click();
      });

      el.querySelector("#ig-test")?.addEventListener("click", async () => {
        const igUserId = el.querySelector("#ig-userid").value.trim();
        const accessToken = el.querySelector("#ig-token").value.trim();
        const statusEl = el.querySelector("#ig-status");
        if (!igUserId || !accessToken) {
          statusEl.innerHTML = `<span style="color:var(--health-poor);">${t("integr.bothRequired")}</span>`;
          return;
        }
        statusEl.innerHTML = `<span class="text-muted">${t("integr.testing")}</span>`;
        try {
          const username = await testConnection({ igUserId, accessToken });
          draft.instagram = { igUserId, accessToken, username, connectedAt: Date.now() };
          statusEl.innerHTML = `<span style="color:var(--health-good);">${t("integr.connectedAs", { name: escapeText(username) })}</span>`;
        } catch (e) {
          statusEl.innerHTML = `<span style="color:var(--health-poor);">${escapeText(e.message)}</span>`;
        }
      });

      el.querySelector("#fb-test")?.addEventListener("click", async () => {
        const pageId = el.querySelector("#fb-pageid").value.trim();
        const pageAccessToken = el.querySelector("#fb-token").value.trim();
        const statusEl = el.querySelector("#fb-status");
        if (!pageId || !pageAccessToken) {
          statusEl.innerHTML = `<span style="color:var(--health-poor);">${t("integr.bothRequired")}</span>`;
          return;
        }
        statusEl.innerHTML = `<span class="text-muted">${t("integr.testing")}</span>`;
        try {
          const pageName = await testFacebookConnection({ pageId, pageAccessToken });
          draft.facebook = { pageId, pageAccessToken, pageName, connectedAt: Date.now() };
          statusEl.innerHTML = `<span style="color:var(--health-good);">${t("integr.connectedTo", { name: escapeText(pageName) })}</span>`;
        } catch (e) {
          statusEl.innerHTML = `<span style="color:var(--health-poor);">${escapeText(e.message)}</span>`;
        }
      });
    },
  });

  // Business description helpers: mic dictation, and an AI pass that turns
  // rough notes into a proper description (never invents facts — see
  // draftBusinessDescription in js/ai.js).
  const descEl = overlay.querySelector("#brand-description");
  const micBtn = overlay.querySelector("#brand-desc-mic");
  if (micBtn) wireMic(micBtn, descEl);
  overlay.querySelector("#brand-desc-ai")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const statusEl = overlay.querySelector("#brand-desc-ai-status");
    const ai = getSettings().ai || {};
    if (!hasAiKey(ai)) {
      toast(t("brandForm.aiNoKey"), "error");
      return;
    }
    const notes = descEl.value.trim();
    if (notes.length < 5) {
      toast(t("brandForm.aiNeedNotes"), "error");
      descEl.focus();
      return;
    }
    btn.disabled = true;
    statusEl.textContent = t("brandForm.aiWorking");
    try {
      descEl.value = await draftBusinessDescription(ai, { name: overlay.querySelector("#brand-name").value.trim(), notes });
      descEl.dispatchEvent(new Event("input", { bubbles: true }));
      statusEl.textContent = t("brandForm.aiDone");
    } catch (err) {
      statusEl.textContent = "";
      toast(err.message || t("brands.form.aiError"), "error");
    } finally {
      btn.disabled = false;
    }
  });

  overlay.querySelector("[data-cancel]").addEventListener("click", () => closeOverlay(overlay));
  overlay.querySelector("[data-save]").addEventListener("click", () => {
    const nameInput = overlay.querySelector("#brand-name");
    const name = nameInput.value.trim();
    if (!name) {
      toast(t("brands.form.needName"), "error");
      nameInput.focus();
      return;
    }
    // Every AI feature (Brand DNA options, scripts, the consultant) reads
    // this description as its base context — an empty one quietly makes
    // all of them generic, so it's required at the same bar the onboarding
    // tour already sets, not just inside the tour.
    const descInput = overlay.querySelector("#brand-description");
    if (descInput.value.trim().length < 20) {
      toast(t("brandForm.needDesc"), "error");
      descInput.focus();
      return;
    }
    // The Instagram/Facebook/Ads fields only exist in the DOM when editing
    // an existing brand (see bodyHTML above) — a brand new-created here has
    // no connections yet, so these just fall back to draft's empty defaults.
    const igUserIdEl = overlay.querySelector("#ig-userid");
    const instagram = igUserIdEl
      ? { ...draft.instagram, igUserId: igUserIdEl.value.trim(), accessToken: overlay.querySelector("#ig-token").value.trim() }
      : draft.instagram;
    const fbPageIdEl = overlay.querySelector("#fb-pageid");
    const facebook = fbPageIdEl
      ? { ...draft.facebook, pageId: fbPageIdEl.value.trim(), pageAccessToken: overlay.querySelector("#fb-token").value.trim() }
      : draft.facebook;
    // No textarea for this anymore (see the create/edit form above) — an
    // existing brand's old value just rides along unchanged.
    const aiVoiceGuide = draft.aiVoiceGuide;
    const businessDescription = overlay.querySelector("#brand-description").value;
    const audienceLanguage = overlay.querySelector("#brand-audience-lang").value;
    const color = overlay.querySelector("#brand-color").value;
    if (brand) {
      updateBrand(brand.id, { name, avatar: draft.avatar, color, instagram, facebook, aiVoiceGuide, businessDescription, audienceLanguage });
      toast(t("brands.form.updated"));
    } else {
      const created = createBrand({ name, avatar: draft.avatar, color, instagram, facebook, aiVoiceGuide, businessDescription, audienceLanguage });
      toast(t("brands.form.created", { name }));
      // Pemula: a brand you just made is obviously the one you want to
      // open — go straight in instead of showing a "pick a brand" page
      // with a single option on it. Beranda takes over from there.
      if (guided && created?.id) {
        closeOverlay(overlay);
        location.hash = `#/brand/${created.id}`;
        return;
      }
    }
    closeOverlay(overlay);
    onSaved?.();
  });
}
