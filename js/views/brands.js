import {
  listBrands, createBrand, updateBrand, archiveBrand, deleteBrand, listContent, updateContent,
} from "../store.js";
import { icon } from "../icons.js";
import { avatarHTML, resizeImageFile, qs, qsa, toast, pickTintTextColor, pickTintForeground, openMenu, closeMenu, escapeHtml as escapeText, passwordFieldHTML, wirePasswordToggles } from "../dom.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { testConnection } from "../instagram.js";
import { canUseInstagramApi } from "../account.js";
import { testFacebookConnection } from "../facebook.js";
import { canCreateBrand, getCachedAccount } from "../account.js";
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
  return unmountBg; // no store subscription needed — actions here re-render locally
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

  root.innerHTML = `
    <div class="hero-strip">
      <div class="kicker">Wepeka Brandlab</div>
      <h1>${guided ? t("brands.hero.titleGuided") : t("brands.hero.titlePro")}</h1>
      <p class="page-sub">${guided ? t("brands.hero.subGuided") : t("brands.hero.subPro")}</p>
    </div>
    <div class="brand-row-head">
      <button class="brand-quick-add" id="add-brand-quick" aria-label="${t("brands.add")}" title="${t("brands.add")}">${icon("plus", { size: 15 })}</button>
    </div>
    <div class="brand-grid" id="brand-grid">
      ${brands.map(brandCard).join("")}
      <button class="brand-tile brand-tile-add" id="add-brand">
        <div class="brand-tile-avatar brand-tile-avatar-add">${icon("plus", { size: 28 })}</div>
        <h3>${t("brands.add")}</h3>
      </button>
    </div>
  `;

  const dragState = wireBrandGridDrag(qs("#brand-grid"));

  qs("#add-brand").addEventListener("click", () => {
    if (dragState.wasDragged) return;
    openBrandModal({ onSaved: refresh });
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
            title: t("brands.delete.title"),
            message: t("brands.delete.message", { count }),
            confirmLabel: t("brands.delete.confirm"),
            danger: true,
          });
          if (ok) {
            deleteBrand(id);
            toast(t("brands.delete.done"));
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

function brandCard(brand) {
  const contents = listContent(brand.id);
  const published = contents.filter((c) => c.status === "published").length;
  // A brand's own picked color overrides --brand-tint just for this tile —
  // the existing .brand-tile-avatar:hover glow rule already reads
  // --brand-tint, so scoping it here (rather than only on document.body,
  // which only ever reflects the *currently open* brand) is what makes
  // each tile in this all-brands list glow in its own color instead of one
  // shared color.
  const tintStyle = brand.color
    ? `--brand-tint:${brand.color};--brand-tint-text:${pickTintTextColor(brand.color)};--brand-tint-fg:${pickTintForeground(brand.color)};`
    : "";
  return `
    <div class="brand-tile" data-id="${brand.id}" style="${tintStyle}">
      <div class="brand-tile-avatar">
        ${avatarHTML(brand)}
        <button class="icon-btn brand-tile-menu" data-menu-toggle data-id="${brand.id}" aria-label="${t("brands.tile.actions")}">${icon("dots", { size: 14 })}</button>
      </div>
      <h3>${brand.name}</h3>
      <div class="meta">${t("brands.tile.meta", { count: contents.length, published })}</div>
    </div>
  `;
}

const AVATAR_PREVIEW_STYLE = "width:64px;height:64px;border-radius:14px;font-size:22px;flex:none;";

// Shared create/edit modal (name + photo). Exported so Settings → Brand
// Management can reuse it too instead of duplicating the form.
export function openBrandModal({ brand = null, onSaved } = {}) {
  if (!brand && !canCreateBrand(listBrands().length)) {
    const limit = getCachedAccount()?.brandLimit ?? 3;
    openModal({
      title: t("brands.limit.title"),
      bodyHTML: `<p style="margin:0 0 4px;">${t("brands.limit.body", { limit })}</p>`,
      footHTML: `<a class="btn btn-primary" href="https://wa.me/62812xxxxxxx" target="_blank" rel="noopener noreferrer">${t("brands.limit.wa")}</a>`,
    });
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
        <div id="avatar-preview">${avatarHTML({ name: draft.name || "?", avatar: draft.avatar }, AVATAR_PREVIEW_STYLE)}</div>
        <div class="flex" style="flex-direction:column;gap:8px;">
          <button type="button" class="btn btn-secondary btn-sm" id="upload-avatar">${icon("upload", { size: 14 })}<span id="upload-label">${draft.avatar ? t("brands.form.changePhoto") : t("brands.form.uploadPhoto")}</span></button>
          <button type="button" class="btn btn-ghost btn-sm" id="remove-avatar" style="${draft.avatar ? "" : "display:none;"}">${icon("x", { size: 13 })}${t("brands.form.removePhoto")}</button>
          <input type="file" id="avatar-file" accept="image/*" style="display:none;" />
        </div>
        <div class="flex items-center gap-8" style="margin-left:auto;">
          <div style="text-align:right;">
            <label style="display:block;font-size:11.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">${t("brands.form.color")}</label>
            <input type="color" id="brand-color" value="${draft.color || "#ffa52b"}" style="width:40px;height:40px;border-radius:10px;border:1px solid var(--border);background:none;padding:0;cursor:pointer;" />
          </div>
        </div>
      </div>
      <p class="text-faint" style="font-size:11.5px;margin:-14px 0 18px;">${guided ? t("brands.form.colorHintGuided") : t("brands.form.colorHintPro")}</p>
      <div class="field">
        <label>${guided ? t("brands.form.nameGuided") : t("brands.form.name")}</label>
        <input class="input" id="brand-name" placeholder="${guided ? t("brands.form.namePhGuided") : t("brands.form.namePh")}" value="${(draft.name || "").replace(/"/g, "&quot;")}" />
      </div>
      <div class="field" id="brand-desc-field">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">${guided ? t("brands.form.descLabelGuided") : t("brands.form.descLabel")}</label>
          <div class="flex items-center gap-6">
            <button type="button" class="chip-icon-btn" id="brand-desc-mic" aria-label="${t("brandForm.mic")}" title="${t("brandForm.mic")}">${icon("mic", { size: 15 })}</button>
            <button type="button" class="btn btn-secondary btn-sm" id="brand-desc-ai">${icon("bot", { size: 13 })}${t("brandForm.aiHelp")}</button>
          </div>
        </div>
        <div class="warn-box">
          ${icon("info", { size: 15 })}
          <div><b>${t("brandForm.descWarningTitle")}</b>${t("brandForm.descWarning")}<span class="warn-box-sub">${t("brandForm.descChecklist")}</span></div>
        </div>
        <textarea class="textarea" id="brand-description" style="min-height:120px;" placeholder="${escapeText(guided ? t("brands.form.descPhGuided") : t("brands.form.descPh"))}">${(draft.businessDescription || "")}</textarea>
        <div id="brand-desc-ai-status" class="text-faint" style="font-size:11.5px;margin-top:4px;"></div>
        <div class="text-faint" style="font-size:11.5px;margin-top:4px;">${guided ? t("brands.form.descHintGuided") : t("brands.form.descHint")}</div>
      </div>
      <div class="field" style="margin-bottom:0;" ${guided && !brand ? "hidden" : ""}>
        <div class="creator-field-head">
          <label style="margin-bottom:0;">${t("brands.form.voiceLabel")}</label>
          <button type="button" class="btn btn-ghost btn-sm" id="upload-brandbook-text" style="flex:none;">${icon("upload", { size: 12 })}Upload .txt</button>
          <input type="file" id="brandbook-text-file" accept=".txt,.md" style="display:none;" />
        </div>
        <textarea class="textarea" id="brand-ai-voice" style="min-height:80px;" placeholder="${escapeText(t("brands.form.voicePh"))}">${(draft.aiVoiceGuide || "")}</textarea>
        <div class="text-faint" style="font-size:11.5px;margin-top:4px;">${t("brands.form.voiceHint")}</div>
      </div>

      ${
        brand
          ? `
      <div class="divider"></div>
      <div class="page-eyebrow" style="margin-bottom:12px;">${t("integr.ig.title")}</div>
      ${
        !canUseInstagramApi()
          ? `<div class="hint" style="margin:0;">${icon("info", { size: 12 })}<span>${t("integr.ig.soonNote")}</span></div>`
          : `
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">${t("integr.ig.intro")}</p>
      <div class="field">
        <label>Instagram Business Account ID</label>
        <input class="input" id="ig-userid" placeholder="17841400..." value="${(draft.instagram.igUserId || "").replace(/"/g, "&quot;")}" />
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Long-Lived Access Token</label>
        ${passwordFieldHTML("ig-token", { placeholder: "IGAA...", value: draft.instagram.accessToken })}
      </div>
      <div id="ig-status" style="margin:10px 0;font-size:12.5px;">${draft.instagram.username ? `<span style="color:var(--health-good);">${t("integr.connectedAs", { name: escapeText(draft.instagram.username) })}</span>` : ""}</div>
      <button type="button" class="btn btn-secondary btn-sm" id="ig-test">${icon("refresh", { size: 13 })}${t("integr.test")}</button>`
      }

      <div class="divider"></div>
      <div class="page-eyebrow" style="margin-bottom:12px;">${t("integr.fb.title")}</div>
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">${t("integr.fb.intro")}</p>
      <div class="field">
        <label>Facebook Page ID</label>
        <input class="input" id="fb-pageid" placeholder="${t("integr.fb.pageIdPh")}" value="${(draft.facebook.pageId || "").replace(/"/g, "&quot;")}" />
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Page Access Token</label>
        ${passwordFieldHTML("fb-token", { placeholder: "EAA...", value: draft.facebook.pageAccessToken })}
      </div>
      <div id="fb-status" style="margin:10px 0;font-size:12.5px;">${draft.facebook.pageName ? `<span style="color:var(--health-good);">${t("integr.connectedTo", { name: escapeText(draft.facebook.pageName) })}</span>` : ""}</div>
      <button type="button" class="btn btn-secondary btn-sm" id="fb-test">${icon("refresh", { size: 13 })}${t("integr.test")}</button>

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
        el.querySelector("#avatar-preview").innerHTML = avatarHTML({ name: nameInput.value || "?", avatar: draft.avatar }, AVATAR_PREVIEW_STYLE);
        el.querySelector("#upload-label").textContent = draft.avatar ? t("brands.form.changePhoto") : t("brands.form.uploadPhoto");
        el.querySelector("#remove-avatar").style.display = draft.avatar ? "" : "none";
      };

      nameInput.addEventListener("input", syncAvatarUI);
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
      el.querySelector("#upload-brandbook-text").addEventListener("click", () => el.querySelector("#brandbook-text-file").click());
      el.querySelector("#brandbook-text-file").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        el.querySelector("#brand-ai-voice").value = text;
        toast(t("brands.form.loaded", { name: file.name }));
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
    const aiVoiceGuide = overlay.querySelector("#brand-ai-voice").value;
    const businessDescription = overlay.querySelector("#brand-description").value;
    const color = overlay.querySelector("#brand-color").value;
    if (brand) {
      updateBrand(brand.id, { name, avatar: draft.avatar, color, instagram, facebook, aiVoiceGuide, businessDescription });
      toast(t("brands.form.updated"));
    } else {
      const created = createBrand({ name, avatar: draft.avatar, color, instagram, facebook, ads, aiVoiceGuide, businessDescription });
      toast(t("brands.form.created", { name }));
      // Every new brand, for every account, opens with the intro video —
      // not only a brand-new account's first boot. Overlays live on <body>,
      // so it stays put through the route change below.
      import("../guide-videos.js")
        .then((m) => m.playNewBrandIntro())
        .catch((e) => console.warn("new-brand video unavailable", e));
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
