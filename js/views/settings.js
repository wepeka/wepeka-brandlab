import {
  getSettings, addPlatform, removePlatform, addFormat, removeFormat,
  getGlobalAiSettings, updateGlobalAiSettings, deleteLegacyGlobalAiKeys, updateGlobalBrandsBg,
  listBrands, archiveBrand, deleteBrand, listContent,
  exportJSON, prepareExport, importJSON, resetAll, onChange,
  listTrash, restoreTrashItem, purgeTrashItem, TRASH_DAYS, getBrand, localISODate,
} from "../store.js";
import { getMode } from "../mode.js";
import { backToLastBrandHTML } from "../back-link.js";
import { currentUid, isAdmin } from "../account.js";
import { testAiConnection } from "../ai.js";
import { BG_PRESETS, DEFAULT_GLOW, resolveBrandsBg, bgHTML, paintBrandsBg } from "../brands-bg.js";
import { icon } from "../icons.js";
import { avatarHTML, qs, qsa, toast, escapeHtml, formatDate } from "../dom.js";
import { confirmDialog } from "../modals.js";
import { typedConfirmDialog } from "../typed-confirm.js";
import { openBrandModal } from "./brands.js";
import { getUserEmail, resetPassword, logout, authErrorMessage } from "../auth.js";
import { getCachedAccount, claimUsername, isReadOnly, isTrial, trialDaysLeft, LIFETIME_PLANS, brandLimitOf, canCreateBrand } from "../account.js";
import { aiDailyLimit, aiQuotaPeriod, aiUsageToday } from "../ai-usage.js";
import { canTopUp } from "../ai-topup.js";
import { t, getLang, setLang } from "../i18n.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { renderRemindersPanel } from "../reminders.js";

// One list for both modes. `pro` panels only show in Pro; the AI panel
// only exists for the Wepeka admin account (it edits the shared key —
// customers never manage one). Benchmarks (ER formulas, thresholds) are
// developer-level and no longer have a UI; the defaults in js/store.js apply.
const PANELS = [
  { key: "brands", labelKey: "settings.panel.brands" },
  { key: "language", labelKey: "settings.panel.language" },
  { key: "account", labelKey: "settings.panel.account" },
  // Opt-in upload reminders (js/reminders.js) — both modes; all off by default.
  { key: "reminders", labelKey: "settings.panel.reminders" },
  { key: "platforms", labelKey: "settings.panel.platforms", pro: true },
  { key: "formats", labelKey: "settings.panel.formats", pro: true },
  // Sampah is its own panel so Pemula can reach it too — every delete dialog
  // in the app points here ("Pengaturan → Sampah").
  { key: "trash", labelKey: "settings.panel.trash" },
  // Backup (export/import) for both modes: a Pemula account's data is worth saving too.
  { key: "data", labelKey: "settings.panel.data" },
  { key: "ai", labelKey: "settings.panel.ai", admin: true },
  { key: "bg", labelKey: "settings.panel.bg", admin: true },
];
function visiblePanels() {
  const pro = getMode() === "advanced";
  const admin = isAdmin(currentUid());
  return PANELS.filter((p) => (!p.pro || pro) && (!p.admin || admin));
}

export function render(root, { panel } = {}) {
  const panels = visiblePanels();
  const state = { panel: panels.some((p) => p.key === panel) ? panel : panels[0].key };
  const refresh = () => paint(root, state, refresh);
  refresh();
  return onChange(refresh);
}

function paint(root, state, refresh) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${backToLastBrandHTML(getBrand)}${helpButtonHTML("settings")}</div>
        <h1>${t("settings.title")}</h1>
        <p class="page-sub">${t("settings.sub")}</p>
      </div>
    </div>
    <div class="settings-grid">
      <div class="settings-nav">
        ${visiblePanels().map((p) => `<button data-panel="${p.key}" class="${state.panel === p.key ? "active" : ""}">${t(p.labelKey)}</button>`).join("")}
      </div>
      <div id="settings-content"></div>
    </div>
  `;

  wireHelpButtons(root);
  qsa("[data-panel]").forEach((btn) => btn.addEventListener("click", () => { state.panel = btn.dataset.panel; paint(root, state, refresh); }));

  const content = qs("#settings-content");
  if (state.panel === "platforms") renderListEditor(content, t("settings.panel.platforms"), getSettings().platforms, addPlatform, removePlatform, t("set.platforms.ph"));
  else if (state.panel === "formats") renderListEditor(content, t("settings.panel.formats"), getSettings().formats, addFormat, removeFormat, t("set.formats.ph"));
  else if (state.panel === "brands") renderBrands(content, refresh);
  else if (state.panel === "ai") renderAi(content);
  else if (state.panel === "bg") renderBrandsBg(content);
  else if (state.panel === "language") renderLanguage(content);
  else if (state.panel === "data") renderData(content);
  else if (state.panel === "trash") renderTrash(content);
  else if (state.panel === "account") renderAccount(content);
  else if (state.panel === "reminders") renderRemindersPanel(content);
}

function renderLanguage(content) {
  const current = getLang();
  content.innerHTML = `
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:6px;">${t("settings.language.title")}</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 18px;">${t("settings.language.sub")}</p>
      <div class="segmented" style="width:240px;">
        <button data-lang="id" class="${current === "id" ? "active" : ""}">${t("settings.language.id")}</button>
        <button data-lang="en" class="${current === "en" ? "active" : ""}">${t("settings.language.en")}</button>
      </div>
    </div>
  `;
  qsa("[data-lang]", content).forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.lang === current) return;
      setLang(btn.dataset.lang);
      toast(t("settings.language.reloading"));
      location.reload();
    });
  });
}

// Which platform's thresholds the form is editing: "" = the shared
// defaults, otherwise a platform name from Settings → Platform. Module
// state (not per-render) so re-rendering after a save keeps the tab.
let benchmarkPlatform = "";

function renderListEditor(content, title, list, addFn, removeFn, placeholder) {
  content.innerHTML = `
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:14px;">${title}</h3>
      ${list.map((item) => `
        <div class="list-editor-row">
          <span class="row-label">${escapeHtml(item.name)}</span>
          <button class="icon-btn" data-remove="${item.id}" aria-label="${escapeHtml(t("set.list.removeAria", { name: item.name }))}" style="width:30px;height:30px;">${icon("trash", { size: 14 })}</button>
        </div>
      `).join("")}
      <div class="flex gap-8" style="margin-top:16px;">
        <input class="input" id="new-item" aria-label="${escapeHtml(title)}" placeholder="${escapeHtml(placeholder)}" />
        <button class="btn btn-primary" id="add-item" style="flex:none;">${icon("plus", { size: 15 })}${t("set.list.add")}</button>
      </div>
    </div>
  `;
  qsa("[data-remove]").forEach((btn) => btn.addEventListener("click", () => { removeFn(btn.dataset.remove); toast(t("set.list.removed")); }));
  const addOne = () => {
    const input = qs("#new-item");
    if (input.value.trim()) { addFn(input.value); input.value = ""; toast(t("set.list.added")); }
  };
  qs("#add-item").addEventListener("click", addOne);
  qs("#new-item").addEventListener("keydown", (e) => { if (e.key === "Enter") addOne(); });
}

function renderBrands(content, refresh) {
  const brands = listBrands({ includeArchived: true });
  content.innerHTML = `
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:14px;">${t("set.brands.title")}</h3>
      ${brands.map((b) => `
        <div class="list-editor-row">
          ${avatarHTML(b, "flex:none;width:28px;height:28px;border-radius:8px;font-size:12px;margin-right:10px;")}
          <span class="row-label">${escapeHtml(b.name)} ${b.archived ? `<span class="text-faint">${t("set.brands.archived")}</span>` : ""} <span class="text-faint">· ${t("set.brands.contentCount", { count: listContent(b.id, { includeArchived: true }).length })}</span></span>
          <button class="icon-btn" data-edit-brand="${b.id}" aria-label="${escapeHtml(t("set.brands.editAria", { name: b.name }))}" style="width:30px;height:30px;">${icon("edit", { size: 14 })}</button>
          <button class="btn btn-secondary btn-sm" data-toggle-archive="${b.id}">${b.archived ? t("set.brands.unarchive") : t("brands.archive")}</button>
          <button class="icon-btn" data-delete-brand="${b.id}" aria-label="${escapeHtml(t("set.brands.deleteAria", { name: b.name }))}" style="width:30px;height:30px;">${icon("trash", { size: 14 })}</button>
        </div>
      `).join("")}
      <div class="flex gap-8" style="margin-top:16px;">
        <button class="btn btn-primary" id="add-brand">${icon(canCreateBrand(listBrands().length) ? "plus" : "lock", { size: 15 })}${t("brands.add")}</button>
      </div>
    </div>
  `;
  qs("#add-brand").addEventListener("click", () => openBrandModal({ onSaved: refresh }));
  qsa("[data-edit-brand]").forEach((btn) => btn.addEventListener("click", () => {
    const b = brands.find((x) => x.id === btn.dataset.editBrand);
    openBrandModal({ brand: b, onSaved: refresh });
  }));
  qsa("[data-toggle-archive]").forEach((btn) => btn.addEventListener("click", () => {
    const b = brands.find((x) => x.id === btn.dataset.toggleArchive);
    const wasArchived = b.archived;
    archiveBrand(b.id, !wasArchived);
    toast(wasArchived ? t("set.brands.restored") : t("brands.archive.done"));
    refresh();
  }));
  qsa("[data-delete-brand]").forEach((btn) => btn.addEventListener("click", async () => {
    const b = brands.find((x) => x.id === btn.dataset.deleteBrand);
    const count = listContent(b.id, { includeArchived: true }).length;
    const ok = await confirmDialog({ title: t("delete.toTrash.title"), message: t("delete.toTrash.brandMessage", { count, days: TRASH_DAYS }), confirmLabel: t("delete.toTrash.confirm"), danger: true });
    if (ok) { deleteBrand(btn.dataset.deleteBrand); toast(t("delete.toTrash.brandDone")); refresh(); }
  }));
}

// Display-only now — the actual key for whichever of these is picked lives
// in a Vercel env var api/ai.js reads (DEEPSEEK_API_KEY / ANTHROPIC_API_KEY
// / GEMINI_API_KEY, matched against AI_PROVIDER), never in Firestore. This
// select just tells the client (hasAiKey/aiCanSeeImages in js/ai.js) which
// provider is active, mainly so vision-dependent features know DeepSeek
// can't read images.
const AI_PROVIDERS = [
  { key: "anthropic", label: "Anthropic (Claude)" },
  { key: "gemini", label: "Google (Gemini)" },
  { key: "deepseek", label: "DeepSeek" },
];

function renderAi(content) {
  // Wepeka's shared config (settings/main) powers every AI feature for
  // every account — only the admin account sees this panel, and it edits
  // the shared doc. No key fields anymore (see api/ai.js) — just which
  // provider api/ai.js's AI_PROVIDER env var should match, and an on/off
  // switch.
  const ai = getGlobalAiSettings() || { provider: "deepseek", enabled: true };
  const provider = AI_PROVIDERS.find((p) => p.key === ai.provider) || AI_PROVIDERS[0];
  content.innerHTML = `
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:6px;">AI Script & Hook Generator</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 18px;">${t("set.ai.adminSub")}</p>
      <div class="field">
        <label>Provider</label>
        <select class="select" id="ai-provider">
          ${AI_PROVIDERS.map((p) => `<option value="${p.key}" ${p.key === provider.key ? "selected" : ""}>${p.label}</option>`).join("")}
        </select>
      </div>
      <label class="flex items-center gap-8" style="margin:14px 0;">
        <input type="checkbox" id="ai-enabled" ${ai.enabled !== false ? "checked" : ""} />
        <span>${t("ai.admin.enabledLabel")}</span>
      </label>
      <p class="text-faint" style="font-size:11.5px;margin:0 0 16px;">${t("ai.admin.keysNote")}</p>
      <button type="button" class="btn btn-secondary btn-sm" id="ai-test">${icon("refresh", { size: 13 })}${t("integr.test")}</button>
      <div id="ai-status" style="margin:10px 0;font-size:12.5px;"></div>
      <div class="divider"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="ai-clear-keys">${t("ai.admin.clearOldKeys")}</button>
    </div>
  `;
  qs("#ai-provider").addEventListener("change", (e) => updateGlobalAiSettings({ provider: e.target.value }));
  qs("#ai-enabled").addEventListener("change", (e) => updateGlobalAiSettings({ enabled: e.target.checked }));
  qs("#ai-test").addEventListener("click", async () => {
    const statusEl = qs("#ai-status");
    statusEl.innerHTML = `<span class="text-muted">${t("integr.testing")}</span>`;
    try {
      await testAiConnection(getGlobalAiSettings() || ai);
      statusEl.innerHTML = `<span style="color:var(--health-good);">${t("set.ai.connected")}</span>`;
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--health-poor);">${escapeHtml(e.message)}</span>`;
    }
  });
  qs("#ai-clear-keys").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: t("ai.admin.clearOldKeys"),
      message: t("ai.admin.clearOldKeysConfirmBody"),
    });
    if (!ok) return;
    try {
      await deleteLegacyGlobalAiKeys();
      toast(t("ai.admin.clearOldKeysDone"));
    } catch (e) {
      toast(e.message || t("ai.admin.clearOldKeysDone"), "error");
    }
  });
}

// Admin-only: seasonal background of the all-brands home. Writes to
// settings/main.brandsBg (see js/brands-bg.js); every account picks it up.
function renderBrandsBg(content) {
  const draw = () => {
    const c = resolveBrandsBg();
    content.innerHTML = `
      <div class="card">
        <h3 style="font-size:16px;margin-bottom:6px;">${t("set.bg.title")}</h3>
        <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${t("set.bg.sub")}</p>
        ${bgHTML("brands-bg-preview")}
        <div class="field" style="margin-top:16px;">
          <label>${t("set.bg.preset")}</label>
          <select class="select" id="bg-preset">
            ${BG_PRESETS.map((p) => `<option value="${p.key}" ${c.preset === p.key ? "selected" : ""}>${p.label}</option>`).join("")}
            <option value="custom" ${c.preset === "custom" ? "selected" : ""}>${t("set.bg.custom")}</option>
          </select>
        </div>
        <div class="field">
          <label>${t("set.bg.base")}</label>
          <div class="flex gap-8">${c.base.map((v, i) => `<input type="color" class="bg-color" data-kind="base" data-i="${i}" value="${v}" />`).join("")}</div>
        </div>
        <div class="field">
          <label>${t("set.bg.blobs")}</label>
          <div class="flex gap-8">${c.blobs.map((v, i) => `<input type="color" class="bg-color" data-kind="blobs" data-i="${i}" value="${v}" />`).join("")}</div>
        </div>
        <div class="field" style="margin-bottom:4px;">
          <label>${t("set.bg.glow")} — <span id="bg-glow-val">${Math.round(c.glow * 100)}%</span></label>
          <input type="range" id="bg-glow" min="2" max="50" step="1" value="${Math.round(c.glow * 100)}" style="width:100%;" />
          <div class="text-faint" style="font-size:11.5px;margin-top:4px;">${t("set.bg.glowHint")}</div>
        </div>
        <div class="flex gap-8" style="margin-top:14px;align-items:center;">
          <button type="button" class="btn btn-secondary btn-sm" id="bg-reset">${t("set.bg.reset")}</button>
        </div>
      </div>
    `;
    paintBrandsBg(qs(".brands-bg-preview", content), c);
    const save = (next) => {
      updateGlobalBrandsBg(next);
      toast(t("set.bg.saved"));
    };
    qs("#bg-preset", content).addEventListener("change", (e) => {
      const key = e.target.value;
      if (key === "custom") { save({ preset: "custom", base: c.base, blobs: c.blobs, glow: c.glow }); }
      else save({ preset: key, glow: c.glow });
      draw();
    });
    // Colour pickers: preview live while dragging, save (and flip to
    // "custom") only when the picker closes — a write per drag tick would
    // hammer Firestore.
    const readColors = () => {
      const base = [0, 1].map((i) => qs(`.bg-color[data-kind="base"][data-i="${i}"]`, content).value);
      const blobs = [0, 1, 2].map((i) => qs(`.bg-color[data-kind="blobs"][data-i="${i}"]`, content).value);
      return { preset: "custom", base, blobs, glow: +qs("#bg-glow", content).value / 100 };
    };
    qsa(".bg-color", content).forEach((el) => {
      el.addEventListener("input", () => paintBrandsBg(qs(".brands-bg-preview", content), resolveBrandsBg(readColors())));
      el.addEventListener("change", () => { save(readColors()); qs("#bg-preset", content).value = "custom"; });
    });
    const glow = qs("#bg-glow", content);
    glow.addEventListener("input", () => {
      qs("#bg-glow-val", content).textContent = `${glow.value}%`;
      const raw = c.preset === "custom" ? readColors() : { preset: c.preset, glow: +glow.value / 100 };
      paintBrandsBg(qs(".brands-bg-preview", content), resolveBrandsBg({ ...raw, glow: +glow.value / 100 }));
    });
    glow.addEventListener("change", () => {
      const g = +glow.value / 100;
      save(c.preset === "custom" ? { ...readColors(), glow: g } : { preset: c.preset, glow: g });
    });
    qs("#bg-reset", content).addEventListener("click", () => { save({ preset: "default", glow: DEFAULT_GLOW }); draw(); });
  };
  draw();
}

function trashRowHTML(row) {
  const daysLeft = Math.max(0, TRASH_DAYS - Math.floor((Date.now() - row.deletedAt) / 86400000));
  return `
    <div class="list-editor-row">
      <span class="row-label"><b>${escapeHtml(row.name)}</b> <span class="text-faint">· ${t(`set.trash.kind.${row.kind}`)} · ${escapeHtml(row.brandName)} · ${t("set.trash.daysLeft", { n: daysLeft })}</span></span>
      <button class="btn btn-secondary btn-sm" data-trash-restore="${row.kind}:${row.id}">${t("set.trash.restore")}</button>
      <button class="icon-btn" data-trash-purge="${row.kind}:${row.id}" aria-label="${escapeHtml(t("set.trash.purgeAria", { name: row.name }))}" style="width:30px;height:30px;">${icon("trash", { size: 14 })}</button>
    </div>`;
}
function renderTrash(content) {
  const trash = listTrash();
  content.innerHTML = `
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:6px;">${t("set.trash.title")}</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${t("set.trash.sub", { days: TRASH_DAYS })}</p>
      ${trash.length ? trash.map(trashRowHTML).join("") : `<p class="text-faint" style="font-size:13px;margin:0;">${t("set.trash.empty")}</p>`}
    </div>
  `;
  qsa("[data-trash-restore]", content).forEach((btn) =>
    btn.addEventListener("click", () => {
      const [kind, id] = btn.dataset.trashRestore.split(":");
      restoreTrashItem(kind, id);
      toast(t("set.trash.restored"));
      renderTrash(content);
    })
  );
  qsa("[data-trash-purge]", content).forEach((btn) =>
    btn.addEventListener("click", async () => {
      const [kind, id] = btn.dataset.trashPurge.split(":");
      const ok = await confirmDialog({ title: t("set.trash.purgeTitle"), message: t("set.trash.purgeMsg"), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      purgeTrashItem(kind, id);
      toast(t("set.trash.purged"));
      renderTrash(content);
    })
  );
}

function renderData(content) {
  content.innerHTML = `
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:6px;">${t("set.data.backup")}</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${t("set.data.backupSub")}</p>
      <div class="flex gap-8">
        <button class="btn btn-secondary" id="export-btn">${icon("download", { size: 15 })}${t("set.data.export")}</button>
        <button class="btn btn-secondary" id="import-btn">${icon("upload", { size: 15 })}${t("set.data.import")}</button>
        <input type="file" id="import-file" accept="application/json" style="display:none;" />
      </div>
    </div>
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:6px;color:var(--health-poor);">${t("set.data.reset")}</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${t("set.data.resetSub")}</p>
      <button class="btn btn-danger" id="reset-btn">${icon("trash", { size: 15 })}${t("set.data.resetBtn")}</button>
    </div>
  `;
  qs("#export-btn").addEventListener("click", async () => {
    // Files, sales and chat threads load per brand: fetch the rest first —
    // and if any of it can't be read, say so instead of a partial backup.
    let skipped = [];
    try {
      skipped = (await prepareExport()) || [];
    } catch (err) {
      console.error("Backup export failed", err);
      toast(t("store.syncLoadFailed", { what: t("store.sync.brands") }), "error");
      return;
    }
    const blob = new Blob([exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `brandlab-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    // A file a brand still pointed at but that no longer exists: left out —
    // say which, so it can be uploaded again.
    if (skipped.length) {
      const list = skipped.map((f) => `${f.brandName} (${t(`store.fileKind.${f.kind}`)})`).join(", ");
      toast(t("store.exportSkipped", { count: skipped.length, list }), "error");
    }
  });
  qs("#import-btn").addEventListener("click", () => qs("#import-file").click());
  qs("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // the same file can be picked again after a cancel
    if (!file) return;
    try {
      const text = await file.text();
      // Say what the file holds and what it overwrites before writing anything.
      const parsed = JSON.parse(text);
      const n = (k) => (Array.isArray(parsed?.[k]) ? parsed[k].length : 0);
      const ok = await confirmDialog({
        title: t("set.data.importTitle"),
        message: t("set.data.importMsg", { file: escapeHtml(file.name), brands: n("brands"), content: n("content"), campaigns: n("campaigns") }),
        confirmLabel: t("set.data.importConfirm"),
        danger: true,
      });
      if (!ok) return;
      await importJSON(text);
      toast(t("set.data.imported"));
    } catch (err) {
      const reason = err instanceof SyntaxError
        ? t("set.data.invalidJson")
        : err.message || t("set.data.unknownError");
      toast(t("set.data.importFailed", { reason }), "error");
      console.error("Import failed", err);
    }
  });
  qs("#reset-btn").addEventListener("click", async () => {
    const word = t("set.data.resetWord");
    const ok = await typedConfirmDialog({ title: t("set.data.resetTitle"), message: t("set.data.resetMsg"), word, prompt: t("set.data.resetType", { word }), confirmLabel: t("set.data.resetConfirm") });
    if (ok) { resetAll(); toast(t("set.data.resetDone")); location.hash = "#/"; }
  });
}

// What the account is on — nowhere else in the app said it once the trial
// badge was gone. Tier names (Starter/Pro/Studio) are never shown to people
// (pricing decision 2026-09-23): a subscription reads as "Langganan · N brand".
function planName(account) {
  const plan = account?.plan;
  if (plan === "trial") return t("set.plan.trial");
  if (plan === "founder") return "Founder Lifetime";
  if (plan === "founder-ultimate") return "Agency Lifetime";
  if (plan === "lifetime") return "Lifetime";
  if (["starter", "pro", "studio"].includes(plan)) return t("set.plan.subscription", { n: account.brandLimit || { starter: 1, pro: 3, studio: 10 }[plan] });
  return plan || "—";
}
function planStatus(account) {
  if (isReadOnly(account)) return t("set.plan.status.readonly");
  if (isTrial(account)) return t("set.plan.status.trial", { n: trialDaysLeft(account) });
  if (LIFETIME_PLANS.includes(account?.plan)) return t("set.plan.status.lifetime");
  const until = Number(account?.subscriptionExpiresAt);
  return until ? t("set.plan.status.until", { date: formatDate(localISODate(new Date(until))) }) : t("set.plan.status.active");
}
function planCardHTML(account) {
  if (!account) return "";
  const limit = aiDailyLimit();
  const period = aiQuotaPeriod();
  const credits = limit === Infinity
    ? t("set.plan.creditsUnlimited")
    : t(`set.plan.credits.${period === "month" ? "month" : period === "total" ? "total" : "day"}`, { used: aiUsageToday(), limit });
  return `
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:14px;">${t("set.plan.title")}</h3>
      <div class="kv"><span class="k">${t("set.plan.name")}</span><span class="v">${escapeHtml(planName(account))}</span></div>
      <div class="kv"><span class="k">${t("set.plan.status")}</span><span class="v">${escapeHtml(planStatus(account))}</span></div>
      <div class="kv"><span class="k">${t("set.plan.brands")}</span><span class="v">${listBrands().length} / ${brandLimitOf(account)}</span></div>
      <div class="kv"><span class="k">AI credit</span><span class="v">${escapeHtml(credits)}</span></div>
      ${account.scheduledPlan?.plan ? `<div class="kv"><span class="k">${t("set.plan.next")}</span><span class="v">${escapeHtml(t("set.plan.nextValue", { name: planName({ plan: account.scheduledPlan.plan, brandLimit: account.scheduledPlan.brandLimit }), date: formatDate(localISODate(new Date(Number(account.scheduledPlan.startsAt)))) }))}</span></div>` : ""}
      ${autoRenewHTML(account)}
      <div class="flex gap-8" style="flex-wrap:wrap;margin-top:14px;">
        <a class="btn btn-secondary btn-sm" href="#/pricing">${icon("arrowUp", { size: 13 })}${t("set.plan.see")}</a>
        ${limit === Infinity ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-ai-topup>${icon("plus", { size: 13 })}${t(canTopUp(account) ? "ai.topup.button" : "ai.topup.upgradeButton")}</button>`}
      </div>
    </div>`;
}

// Payments Midtrans charges by itself (api/_plans.js recurringFor): one row
// each, with the card and a stop button. Stopping keeps the time already paid.
const AUTO_RENEW_NAME = (entry) => entry.planKey === "ai-unlimited" ? t("pricing.addons.aiUnlimited")
  : entry.planKey === "addon-brand-sub" ? t("pricing.addons.brandSub")
  : planName({ plan: entry.planKey.replace(/-(monthly|yearly)$/, "") });
function autoRenewHTML(account) {
  const rows = Object.entries(account.autoRenew || {});
  if (!rows.length) return "";
  return `
    <div class="auto-renew">
      <div class="auto-renew-title">${icon("refresh", { size: 13 })}${t("set.autoRenew.title")}</div>
      ${rows.map(([slot, e]) => `
        <div class="auto-renew-row">
          <span><b>${escapeHtml(AUTO_RENEW_NAME(e))}</b><small>${escapeHtml(t("set.autoRenew.row", { amount: `Rp ${Number(e.amount).toLocaleString("id-ID")}`, card: e.card || "—", date: e.nextAt ? formatDate(localISODate(new Date(Number(e.nextAt)))) : "—" }))}</small></span>
          <button type="button" class="btn btn-ghost btn-sm" data-stop-renew="${escapeHtml(slot)}">${t("set.autoRenew.stop")}</button>
        </div>`).join("")}
    </div>`;
}
async function stopAutoRenew(slot) {
  const ok = await confirmDialog({ title: t("set.autoRenew.confirmTitle"), message: t("set.autoRenew.confirmBody"), confirmLabel: t("set.autoRenew.stop"), danger: true });
  if (!ok) return;
  try {
    const { auth } = await import("../firebase.js");
    const idToken = await auth.currentUser?.getIdToken();
    const res = await fetch("/api/midtrans/auto-renew", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ slot }) });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || t("set.autoRenew.fail"));
    toast(t("set.autoRenew.stopped"));
  } catch (err) {
    toast(err.message || t("set.autoRenew.fail"), "error");
  }
}

function renderAccount(content) {
  const email = getUserEmail();
  const account = getCachedAccount();
  content.innerHTML = `
    ${planCardHTML(account)}
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:14px;">${t("set.acc.loggedInAs")}</h3>
      <div class="kv"><span class="k">Email</span><span class="v">${escapeHtml(email)}</span></div>
      ${account?.accountNumber ? `<div class="kv"><span class="k">${t("set.acc.id")}</span><span class="v">#${account.accountNumber}</span></div>` : ""}
    </div>
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:6px;">${t("set.acc.wepekaTitle")}</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${t("set.acc.usernameSub")}</p>
      <div class="field" style="margin-bottom:10px;">
        <label for="acc-username">${t("set.acc.usernameLabel")}</label>
        <div class="flex items-center gap-8">
          <span class="text-faint" style="font-weight:800;">@</span>
          <input class="input" id="acc-username" placeholder="${escapeHtml(t("set.acc.usernamePh"))}" value="${account?.username || ""}" style="flex:1;" />
        </div>
      </div>
      <button class="btn btn-secondary btn-sm" id="acc-username-save">${icon("check", { size: 14 })}${t("common.save")}</button>
    </div>
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:6px;">Password</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${t("set.acc.passwordSub")}</p>
      <button class="btn btn-secondary" id="acc-reset">${icon("check", { size: 15 })}${t("set.acc.sendReset")}</button>
    </div>
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:14px;">${t("set.acc.session")}</h3>
      <button class="btn btn-secondary" id="acc-logout">${icon("logout", { size: 15 })}${t("topbar.logout")}</button>
    </div>
  `;

  qs("#acc-username-save").addEventListener("click", async () => {
    const uid = getCachedAccount()?.uid;
    const raw = qs("#acc-username").value;
    if (!uid || !raw.trim()) { toast(t("set.acc.needUsername"), "error"); return; }
    try {
      const username = await claimUsername(uid, raw);
      toast(t("set.acc.usernameSaved", { username }));
    } catch (err) {
      toast(err.message || t("set.acc.usernameFailed"), "error");
    }
  });

  content.querySelectorAll("[data-stop-renew]").forEach((btn) => btn.addEventListener("click", async () => {
    btn.disabled = true;
    // The row goes once the server has removed it from the account doc.
    window.addEventListener("account:change", () => renderAccount(content), { once: true });
    await stopAutoRenew(btn.dataset.stopRenew);
    btn.disabled = false;
  }));
  qs("#acc-reset").addEventListener("click", async () => {
    try {
      await resetPassword(email);
      toast(t("auth.resetSent", { email }));
    } catch (err) {
      toast(authErrorMessage(err, "auth.resetFailed"), "error");
    }
  });

  qs("#acc-logout").addEventListener("click", async () => {
    await logout();
    location.hash = "";
    location.reload();
  });
}

