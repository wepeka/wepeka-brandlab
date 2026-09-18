import {
  getSettings, updateFormulas, updateThresholds, updatePlatformThresholds, addPlatform, removePlatform, addFormat, removeFormat,
  isGlobalAiActive, getGlobalAiSettings, updateGlobalAiSettings,
  listBrands, archiveBrand, deleteBrand, listContent,
  exportJSON, importJSON, resetAll, onChange, FUNNELS,
} from "../store.js";
import { getMode } from "../mode.js";
import { currentUid, isAdmin } from "../account.js";
import { validateFormula, evaluateFormula } from "../formulas.js";
import { testAiConnection } from "../ai.js";
import { icon } from "../icons.js";
import { avatarHTML, qs, qsa, toast, passwordFieldHTML, wirePasswordToggles, escapeHtml } from "../dom.js";
import { confirmDialog } from "../modals.js";
import { openBrandModal } from "./brands.js";
import { getUserEmail, resetPassword, logout, authErrorMessage } from "../auth.js";
import { getCachedAccount, claimUsername } from "../account.js";
import { startOnboardingTour } from "../tour.js";
import { replayGuideForBrand } from "../guides/common.js";
import { t, getLang, setLang } from "../i18n.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";

const PANELS = [
  { key: "benchmarks", labelKey: "settings.panel.benchmarks" },
  { key: "platforms", labelKey: "settings.panel.platforms" },
  { key: "formats", labelKey: "settings.panel.formats" },
  { key: "brands", labelKey: "settings.panel.brands" },
  { key: "ai", labelKey: "settings.panel.ai" },
  { key: "language", labelKey: "settings.panel.language" },
  { key: "roadmap", labelKey: "settings.panel.roadmap" },
  { key: "data", labelKey: "settings.panel.data" },
  { key: "account", labelKey: "settings.panel.account" },
];

// What's built vs. what's planned — kept in one place so the product's
// direction is visible even before a feature has code behind it yet.
const ROADMAP = ["publish", "repurpose", "video", "approval"].map((k) => ({
  name: t(`set.roadmap.${k}.name`),
  where: t(`set.roadmap.${k}.where`),
  desc: t(`set.roadmap.${k}.desc`),
}));

// Pemula sees two panels: the brands they manage and their own account
// (which is also where the tour replays live). Benchmarks, formats,
// platforms, AI keys, data export and the roadmap are Pro concerns — the
// AI key is global and already active for every account anyway.
const GUIDED_PANEL_KEYS = ["brands", "language", "roadmap", "account"];
function visiblePanels() {
  return getMode() === "guided" ? PANELS.filter((p) => GUIDED_PANEL_KEYS.includes(p.key)) : PANELS;
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
        <div class="page-eyebrow flex items-center gap-6">${t("settings.eyebrow")}${helpButtonHTML("settings")}</div>
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
  if (state.panel === "benchmarks") renderBenchmarks(content);
  else if (state.panel === "platforms") renderListEditor(content, t("settings.panel.platforms"), getSettings().platforms, addPlatform, removePlatform, t("set.platforms.ph"));
  else if (state.panel === "formats") renderListEditor(content, t("settings.panel.formats"), getSettings().formats, addFormat, removeFormat, t("set.formats.ph"));
  else if (state.panel === "brands") renderBrands(content, refresh);
  else if (state.panel === "ai") renderAi(content);
  else if (state.panel === "language") renderLanguage(content);
  else if (state.panel === "roadmap") renderRoadmap(content);
  else if (state.panel === "data") renderData(content);
  else if (state.panel === "account") renderAccount(content);
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

function renderBenchmarks(content) {
  const settings = getSettings();
  const platformNames = settings.platforms.map((p) => p.name);
  if (benchmarkPlatform && !platformNames.includes(benchmarkPlatform)) benchmarkPlatform = "";
  const overrides = settings.thresholdsByPlatform || {};
  const editing = benchmarkPlatform ? overrides[benchmarkPlatform] || null : null;
  // For a platform without its own override yet, show the defaults so the
  // owner edits from real numbers; saving any field creates the override.
  const shown = (f) => (editing && editing[f]) || settings.thresholds[f];
  content.innerHTML = `
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:6px;">${t("set.formula.title")}</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 18px;">${t("set.formula.sub")}</p>
      ${formulaField("engagementRate", t("set.formula.er"), settings.formulas.engagementRate)}
      ${formulaField("followerConversionRate", t("set.formula.fcr"), settings.formulas.followerConversionRate)}
    </div>
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:6px;">${t("set.th.title")}</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 10px;">${t("set.th.sub")}</p>
      <div class="hint" style="margin-bottom:16px;">${icon("info", { size: 12 })}<span>${t("set.th.hint")}</span></div>
      <div class="field">
        <label>${t("set.th.appliesTo")}</label>
        <div class="chip-select" id="th-platform" style="flex-wrap:wrap;">
          <button type="button" data-val="" class="${benchmarkPlatform ? "" : "active"}">${t("set.th.allPlatforms")}</button>
          ${platformNames.map((p) => `<button type="button" data-val="${p}" class="${benchmarkPlatform === p ? "active" : ""}">${p}${overrides[p] ? " ✓" : ""}</button>`).join("")}
        </div>
        <div class="text-faint" style="font-size:11.5px;margin-top:6px;">${
          benchmarkPlatform
            ? editing
              ? t("set.th.ownOverride", { platform: benchmarkPlatform })
              : t("set.th.usingDefault", { platform: benchmarkPlatform })
            : t("set.th.defaultNote")
        }</div>
        ${editing ? `<button type="button" class="btn btn-ghost btn-sm" id="th-platform-reset" style="margin-top:8px;">${icon("refresh", { size: 12 })}${t("set.th.reset", { platform: benchmarkPlatform })}</button>` : ""}
      </div>
      ${FUNNELS.map((f) => thresholdBlock(f, shown(f))).join("")}
    </div>
  `;

  qsa("#th-platform button").forEach((btn) => {
    btn.addEventListener("click", () => {
      benchmarkPlatform = btn.dataset.val;
      renderBenchmarks(content);
    });
  });
  qs("#th-platform-reset")?.addEventListener("click", () => {
    updatePlatformThresholds(benchmarkPlatform, null, null);
    toast(t("set.th.resetDone", { platform: benchmarkPlatform }));
    renderBenchmarks(content);
  });

  ["engagementRate", "followerConversionRate"].forEach((key) => {
    const input = qs(`#formula-${key}`);
    const status = qs(`#formula-status-${key}`);
    input.addEventListener("input", () => renderFormulaStatus(status, input.value));
    input.addEventListener("blur", () => {
      const check = validateFormula(input.value);
      if (check.valid) {
        updateFormulas({ [key]: input.value });
        toast(t("set.formula.saved"));
      }
    });
    qsa(`[data-insert="${key}"]`).forEach((chip) => {
      chip.addEventListener("click", () => {
        const pos = input.selectionStart ?? input.value.length;
        input.value = input.value.slice(0, pos) + chip.dataset.var + input.value.slice(pos);
        input.focus();
        renderFormulaStatus(status, input.value);
      });
    });
  });

  FUNNELS.forEach((f) => {
    ["er-good", "er-avg", "fcr-good", "fcr-avg"].forEach((id) => {
      const el = qs(`#th-${f}-${id}`);
      el.addEventListener("blur", () => {
        const patch = {
          engagementRate: { good: Number(qs(`#th-${f}-er-good`).value), average: Number(qs(`#th-${f}-er-avg`).value) },
          followerConversionRate: { good: Number(qs(`#th-${f}-fcr-good`).value), average: Number(qs(`#th-${f}-fcr-avg`).value) },
        };
        if (benchmarkPlatform) {
          const had = !!getSettings().thresholdsByPlatform?.[benchmarkPlatform];
          updatePlatformThresholds(benchmarkPlatform, f, patch);
          if (!had) renderBenchmarks(content);
        } else {
          updateThresholds(f, patch);
        }
      });
    });
  });
}

function formulaField(key, label, value) {
  return `
    <div class="field">
      <label>${label}</label>
      <input class="input formula-box" id="formula-${key}" value="${(value || "").replace(/"/g, "&quot;")}" />
      <div class="formula-vars">
        ${["views","reach","likes","comments","shares","saves","profileVisits","followersGained"].map((v) => `<span class="var-chip" data-insert="${key}" data-var="${v}">${v}</span>`).join("")}
      </div>
      <div class="formula-preview" id="formula-status-${key}"></div>
    </div>
  `;
}

function renderFormulaStatus(el, expr) {
  const check = validateFormula(expr);
  if (!check.valid) {
    el.innerHTML = `<span style="color:var(--health-poor);">${check.error}</span>`;
    return;
  }
  const sample = { views: 10000, reach: 8000, likes: 500, comments: 40, shares: 20, saves: 60, profileVisits: 150, followersGained: 25 };
  const result = evaluateFormula(expr, sample);
  el.innerHTML = `<span style="color:var(--health-good);">${t("set.formula.valid")}</span> ${t("set.formula.sample")} <strong>${result === null ? "—" : result.toFixed(2) + "%"}</strong>`;
}

function thresholdBlock(funnel, th) {
  return `
    <div style="margin-bottom:22px;">
      <div class="flex items-center gap-8" style="margin-bottom:10px;"><span class="tag tag-${funnel.toLowerCase()}">${funnel}</span></div>
      <div class="threshold-row">
        <div class="tl">${t("set.th.engagement")}</div>
        <div class="field" style="margin-bottom:0;"><label>${t("set.th.good")}</label><input class="input" type="number" step="0.1" id="th-${funnel}-er-good" value="${th.engagementRate.good}" /></div>
        <div class="field" style="margin-bottom:0;"><label>${t("set.th.avg")}</label><input class="input" type="number" step="0.1" id="th-${funnel}-er-avg" value="${th.engagementRate.average}" /></div>
      </div>
      <div class="threshold-row">
        <div class="tl">${t("set.th.fcr")}</div>
        <div class="field" style="margin-bottom:0;"><label>${t("set.th.good")}</label><input class="input" type="number" step="0.1" id="th-${funnel}-fcr-good" value="${th.followerConversionRate.good}" /></div>
        <div class="field" style="margin-bottom:0;"><label>${t("set.th.avg")}</label><input class="input" type="number" step="0.1" id="th-${funnel}-fcr-avg" value="${th.followerConversionRate.average}" /></div>
      </div>
    </div>
  `;
}

function renderListEditor(content, title, list, addFn, removeFn, placeholder) {
  content.innerHTML = `
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:14px;">${title}</h3>
      ${list.map((item) => `
        <div class="list-editor-row">
          <span class="row-label">${item.name}</span>
          <button class="icon-btn" data-remove="${item.id}" aria-label="${escapeHtml(t("set.list.removeAria", { name: item.name }))}" style="width:30px;height:30px;">${icon("trash", { size: 14 })}</button>
        </div>
      `).join("")}
      <div class="flex gap-8" style="margin-top:16px;">
        <input class="input" id="new-item" placeholder="${placeholder}" />
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
          <span class="row-label">${b.name} ${b.archived ? `<span class="text-faint">${t("set.brands.archived")}</span>` : ""} <span class="text-faint">· ${t("set.brands.contentCount", { count: listContent(b.id, { includeArchived: true }).length })}</span></span>
          <button class="icon-btn" data-edit-brand="${b.id}" aria-label="${escapeHtml(t("set.brands.editAria", { name: b.name }))}" style="width:30px;height:30px;">${icon("edit", { size: 14 })}</button>
          <button class="btn btn-secondary btn-sm" data-toggle-archive="${b.id}">${b.archived ? t("set.brands.unarchive") : t("brands.archive")}</button>
          <button class="icon-btn" data-delete-brand="${b.id}" aria-label="${escapeHtml(t("set.brands.deleteAria", { name: b.name }))}" style="width:30px;height:30px;">${icon("trash", { size: 14 })}</button>
        </div>
      `).join("")}
      <div class="flex gap-8" style="margin-top:16px;">
        <button class="btn btn-primary" id="add-brand">${icon("plus", { size: 15 })}${t("brands.add")}</button>
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
    const ok = await confirmDialog({ title: t("brands.delete.title"), message: t("set.brands.deleteMsg"), confirmLabel: t("brands.delete.confirm"), danger: true });
    if (ok) { deleteBrand(btn.dataset.deleteBrand); toast(t("brands.delete.done")); refresh(); }
  }));
}

const AI_PROVIDERS = [
  { key: "anthropic", label: "Anthropic (Claude)", keyField: "anthropicApiKey", placeholder: "sk-ant-...", getKeyUrl: "https://console.anthropic.com/settings/keys", getKeyLabel: "console.anthropic.com", billedBy: "Anthropic" },
  { key: "gemini", label: "Google (Gemini)", keyField: "geminiApiKey", placeholder: "AIza...", getKeyUrl: "https://aistudio.google.com/apikey", getKeyLabel: "aistudio.google.com", billedBy: "Google" },
  { key: "deepseek", label: "DeepSeek", keyField: "deepseekApiKey", placeholder: "sk-...", getKeyUrl: "https://platform.deepseek.com/api_keys", getKeyLabel: "platform.deepseek.com", billedBy: "DeepSeek" },
];

function renderAi(content) {
  const admin = isAdmin(currentUid());
  const globalActive = isGlobalAiActive();
  // Customers never manage a key themselves — Wepeka's shared config
  // (settings/main) powers every AI feature for every account. Only the
  // Wepeka team account gets the editor below, and it edits the shared doc.
  if (!admin) {
    const provider = AI_PROVIDERS.find((p) => p.key === getSettings().ai?.provider) || AI_PROVIDERS[0];
    content.innerHTML = `
      <div class="card">
        <h3 style="font-size:16px;margin-bottom:6px;">${t("set.ai.title")}</h3>
        ${globalActive
          ? `<p class="text-muted" style="font-size:13px;margin:0;">${t("set.ai.active")} <span class="text-faint">(Model: ${provider.label})</span></p>`
          : `<p class="text-muted" style="font-size:13px;margin:0;">${t("set.ai.unavailable")}</p>`}
      </div>
    `;
    return;
  }
  const ai = getGlobalAiSettings() || { provider: "anthropic", anthropicApiKey: "", geminiApiKey: "", deepseekApiKey: "" };
  const provider = AI_PROVIDERS.find((p) => p.key === ai.provider) || AI_PROVIDERS[0];
  const currentKey = ai[provider.keyField] || "";
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
      <div class="field" style="margin-bottom:0;">
        <label>${provider.label} API Key</label>
        ${passwordFieldHTML("ai-key", { placeholder: provider.placeholder, value: currentKey })}
      </div>
      <div id="ai-status" style="margin:10px 0;font-size:12.5px;">${currentKey ? `<span class="text-faint">${t("set.ai.saved")}</span>` : ""}</div>
      <button type="button" class="btn btn-secondary btn-sm" id="ai-test">${icon("refresh", { size: 13 })}${t("integr.test")}</button>
      <p class="text-faint" style="font-size:11.5px;margin:14px 0 0;">${t("set.ai.getKey", { link: `<a href="${provider.getKeyUrl}" target="_blank" rel="noopener noreferrer" class="link">${provider.getKeyLabel}</a>`, vendor: provider.billedBy })}</p>
    </div>
  `;
  wirePasswordToggles(content);
  qs("#ai-provider").addEventListener("change", (e) => {
    updateGlobalAiSettings({ provider: e.target.value });
    renderAi(content);
  });
  qs("#ai-test").addEventListener("click", async () => {
    const key = qs("#ai-key").value.trim();
    const statusEl = qs("#ai-status");
    if (!key) {
      statusEl.innerHTML = `<span style="color:var(--health-poor);">${t("set.ai.pasteFirst")}</span>`;
      return;
    }
    statusEl.innerHTML = `<span class="text-muted">${t("integr.testing")}</span>`;
    try {
      await testAiConnection({ ...ai, [provider.keyField]: key });
      updateGlobalAiSettings({ [provider.keyField]: key });
      statusEl.innerHTML = `<span style="color:var(--health-good);">${t("set.ai.connected")}</span>`;
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--health-poor);">${escapeHtml(e.message)}</span>`;
    }
  });
}

function renderRoadmap(content) {
  content.innerHTML = `
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:6px;">${t("set.roadmap.title")}</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 18px;">${t("set.roadmap.sub")}</p>
      ${ROADMAP.map(
        (f) => `
        <div class="list-editor-row" style="align-items:flex-start;padding:14px 0;">
          <div class="row-label" style="flex:1;">
            <div class="flex items-center gap-8" style="margin-bottom:3px;"><strong>${f.name}</strong><span class="tag" style="background:var(--surface-2);color:var(--text-muted);">${t("app.comingSoon")}</span></div>
            <div class="text-muted" style="font-size:12.5px;">${f.desc}</div>
            <div class="text-faint" style="font-size:11.5px;margin-top:2px;">${t("set.roadmap.where", { where: f.where })}</div>
          </div>
        </div>`
      ).join("")}
    </div>
  `;
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
  qs("#export-btn").addEventListener("click", () => {
    const blob = new Blob([exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `content-os-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  qs("#import-btn").addEventListener("click", () => qs("#import-file").click());
  qs("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await importJSON(await file.text());
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
    const ok = await confirmDialog({ title: t("set.data.resetTitle"), message: t("set.data.resetMsg"), confirmLabel: t("set.data.resetConfirm"), danger: true });
    if (ok) { resetAll(); toast(t("set.data.resetDone")); location.hash = "#/"; }
  });
}

function renderAccount(content) {
  const email = getUserEmail();
  const account = getCachedAccount();
  content.innerHTML = `
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:14px;">${t("set.acc.loggedInAs")}</h3>
      <div class="kv"><span class="k">Email</span><span class="v">${escapeHtml(email)}</span></div>
      ${account?.accountNumber ? `<div class="kv"><span class="k">${t("set.acc.id")}</span><span class="v">#${account.accountNumber}</span></div>` : ""}
    </div>
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:6px;">Wepeka Account</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${t("set.acc.usernameSub")}</p>
      <div class="field" style="margin-bottom:10px;">
        <label>Username</label>
        <div class="flex items-center gap-8">
          <span class="text-faint" style="font-weight:800;">@</span>
          <input class="input" id="acc-username" placeholder="${t("set.acc.usernamePh")}" value="${account?.username || ""}" style="flex:1;" />
        </div>
      </div>
      <button class="btn btn-secondary btn-sm" id="acc-username-save">${icon("check", { size: 14 })}${t("common.save")}</button>
    </div>
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:6px;">${t("set.acc.tourTitle")}</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${t("set.acc.tourSub")}</p>
      <button class="btn btn-secondary" id="acc-tour">${icon("play", { size: 14 })}${t("brands.onboard.cta")}</button>
      <div class="flex gap-8" style="flex-wrap:wrap;margin-top:10px;">
        <button class="btn btn-secondary btn-sm" id="acc-guide-creator">${icon("edit", { size: 13 })}${t("set.acc.replayCreator")}</button>
        <button class="btn btn-secondary btn-sm" id="acc-guide-calendar">${icon("calendar", { size: 13 })}${t("set.acc.replayCalendar")}</button>
        <button class="btn btn-secondary btn-sm" id="acc-guide-campaigns">${icon("target", { size: 13 })}${t("set.acc.replayCampaign")}</button>
      </div>
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

  qs("#acc-tour").addEventListener("click", () => startOnboardingTour());
  qs("#acc-guide-creator").addEventListener("click", () =>
    replayGuideForBrand({ startKey: "creator", path: (id) => `#/brand/${id}/content-os/creator` })
  );
  qs("#acc-guide-calendar").addEventListener("click", () =>
    replayGuideForBrand({ startKey: "calendar", path: (id) => `#/brand/${id}/content-os/calendar` })
  );
  qs("#acc-guide-campaigns").addEventListener("click", () =>
    replayGuideForBrand({ startKey: "campaigns", path: (id) => `#/brand/${id}/campaigns` })
  );

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

