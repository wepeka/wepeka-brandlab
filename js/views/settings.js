import {
  getSettings, updateFormulas, updateThresholds, updateAiSettings, addPlatform, removePlatform, addFormat, removeFormat,
  listBrands, archiveBrand, deleteBrand, listContent,
  exportJSON, importJSON, resetAll, onChange, FUNNELS,
} from "../store.js";
import { validateFormula, evaluateFormula } from "../formulas.js";
import { testAiConnection } from "../ai.js";
import { icon } from "../icons.js";
import { avatarHTML, qs, qsa, toast } from "../dom.js";
import { confirmDialog } from "../modals.js";
import { openBrandModal } from "./brands.js";
import { getUserEmail, resetPassword, logout } from "../auth.js";
import { startOnboardingTour } from "../tour.js";

const PANELS = [
  { key: "benchmarks", label: "Performance Benchmarks" },
  { key: "platforms", label: "Platforms" },
  { key: "formats", label: "Content Formats" },
  { key: "brands", label: "Brand Management" },
  { key: "ai", label: "AI" },
  { key: "roadmap", label: "Roadmap" },
  { key: "data", label: "Data" },
  { key: "account", label: "Account" },
];

// What's built vs. what's planned — kept in one place so the product's
// direction is visible even before a feature has code behind it yet.
const ROADMAP = [
  { name: "Direct Publishing / Scheduling", where: "Content editor", desc: "Publish or schedule straight to Instagram from here, no separate app." },
  { name: "Multi-Platform Repurposing", where: "Content editor, platform picker", desc: "Reformat one piece of content for TikTok and YouTube Shorts automatically." },
  { name: "AI Video Editor Integration", where: "Creator tab", desc: "Light editing/captioning on raw footage without leaving the workspace." },
  { name: "Advanced Team Approval Workflow", where: "Content lifecycle", desc: "Multi-person review and sign-off before something moves to Scheduled." },
];

export function render(root) {
  const state = { panel: "benchmarks" };
  const refresh = () => paint(root, state, refresh);
  refresh();
  return onChange(refresh);
}

function paint(root, state, refresh) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">Settings</div>
        <h1>Configure Wepeka Brandlab</h1>
        <p class="page-sub">Formulas, thresholds, and the building blocks every brand shares.</p>
      </div>
    </div>
    <div class="settings-grid">
      <div class="settings-nav">
        ${PANELS.map((p) => `<button data-panel="${p.key}" class="${state.panel === p.key ? "active" : ""}">${p.label}</button>`).join("")}
      </div>
      <div id="settings-content"></div>
    </div>
  `;

  qsa("[data-panel]").forEach((btn) => btn.addEventListener("click", () => { state.panel = btn.dataset.panel; paint(root, state, refresh); }));

  const content = qs("#settings-content");
  if (state.panel === "benchmarks") renderBenchmarks(content);
  else if (state.panel === "platforms") renderListEditor(content, "Platforms", getSettings().platforms, addPlatform, removePlatform, "e.g. LinkedIn");
  else if (state.panel === "formats") renderListEditor(content, "Content Formats", getSettings().formats, addFormat, removeFormat, "e.g. Live Stream");
  else if (state.panel === "brands") renderBrands(content, refresh);
  else if (state.panel === "ai") renderAi(content);
  else if (state.panel === "roadmap") renderRoadmap(content);
  else if (state.panel === "data") renderData(content);
  else if (state.panel === "account") renderAccount(content);
}

function renderBenchmarks(content) {
  const settings = getSettings();
  content.innerHTML = `
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:6px;">Formulas</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 18px;">Define exactly how Engagement Rate and Follower Conversion Rate are calculated. Use any of the metric names below.</p>
      ${formulaField("engagementRate", "Engagement Rate", settings.formulas.engagementRate)}
      ${formulaField("followerConversionRate", "Follower Conversion Rate", settings.formulas.followerConversionRate)}
    </div>
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:6px;">Thresholds by Funnel Stage</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 18px;">Content is rated Good / Average / Poor by comparing its rate to these lower bounds — set independently per funnel stage.</p>
      ${FUNNELS.map((f) => thresholdBlock(f, settings.thresholds[f])).join("")}
    </div>
  `;

  ["engagementRate", "followerConversionRate"].forEach((key) => {
    const input = qs(`#formula-${key}`);
    const status = qs(`#formula-status-${key}`);
    input.addEventListener("input", () => renderFormulaStatus(status, input.value));
    input.addEventListener("blur", () => {
      const check = validateFormula(input.value);
      if (check.valid) {
        updateFormulas({ [key]: input.value });
        toast("Formula saved");
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
        const th = getSettings().thresholds[f];
        const patch = {
          engagementRate: { good: Number(qs(`#th-${f}-er-good`).value), average: Number(qs(`#th-${f}-er-avg`).value) },
          followerConversionRate: { good: Number(qs(`#th-${f}-fcr-good`).value), average: Number(qs(`#th-${f}-fcr-avg`).value) },
        };
        updateThresholds(f, patch);
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
  el.innerHTML = `<span style="color:var(--health-good);">Valid.</span> Example with sample numbers: <strong>${result === null ? "—" : result.toFixed(2) + "%"}</strong>`;
}

function thresholdBlock(funnel, th) {
  return `
    <div style="margin-bottom:22px;">
      <div class="flex items-center gap-8" style="margin-bottom:10px;"><span class="tag tag-${funnel.toLowerCase()}">${funnel}</span></div>
      <div class="threshold-row">
        <div class="tl">Engagement</div>
        <div class="field" style="margin-bottom:0;"><label>Good ≥</label><input class="input" type="number" step="0.1" id="th-${funnel}-er-good" value="${th.engagementRate.good}" /></div>
        <div class="field" style="margin-bottom:0;"><label>Average ≥</label><input class="input" type="number" step="0.1" id="th-${funnel}-er-avg" value="${th.engagementRate.average}" /></div>
      </div>
      <div class="threshold-row">
        <div class="tl">Follower Conv.</div>
        <div class="field" style="margin-bottom:0;"><label>Good ≥</label><input class="input" type="number" step="0.1" id="th-${funnel}-fcr-good" value="${th.followerConversionRate.good}" /></div>
        <div class="field" style="margin-bottom:0;"><label>Average ≥</label><input class="input" type="number" step="0.1" id="th-${funnel}-fcr-avg" value="${th.followerConversionRate.average}" /></div>
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
          <button class="icon-btn" data-remove="${item.id}" aria-label="Remove ${item.name}" style="width:30px;height:30px;">${icon("trash", { size: 14 })}</button>
        </div>
      `).join("")}
      <div class="flex gap-8" style="margin-top:16px;">
        <input class="input" id="new-item" placeholder="${placeholder}" />
        <button class="btn btn-primary" id="add-item" style="flex:none;">${icon("plus", { size: 15 })}Add</button>
      </div>
    </div>
  `;
  qsa("[data-remove]").forEach((btn) => btn.addEventListener("click", () => { removeFn(btn.dataset.remove); toast("Removed"); }));
  const addOne = () => {
    const input = qs("#new-item");
    if (input.value.trim()) { addFn(input.value); input.value = ""; toast("Added"); }
  };
  qs("#add-item").addEventListener("click", addOne);
  qs("#new-item").addEventListener("keydown", (e) => { if (e.key === "Enter") addOne(); });
}

function renderBrands(content, refresh) {
  const brands = listBrands({ includeArchived: true });
  content.innerHTML = `
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:14px;">Brands</h3>
      ${brands.map((b) => `
        <div class="list-editor-row">
          ${avatarHTML(b, "flex:none;width:28px;height:28px;border-radius:8px;font-size:12px;margin-right:10px;")}
          <span class="row-label">${b.name} ${b.archived ? '<span class="text-faint">(archived)</span>' : ""} <span class="text-faint">· ${listContent(b.id, { includeArchived: true }).length} content</span></span>
          <button class="icon-btn" data-edit-brand="${b.id}" aria-label="Edit ${b.name}" style="width:30px;height:30px;">${icon("edit", { size: 14 })}</button>
          <button class="btn btn-secondary btn-sm" data-toggle-archive="${b.id}">${b.archived ? "Unarchive" : "Archive"}</button>
          <button class="icon-btn" data-delete-brand="${b.id}" aria-label="Delete ${b.name}" style="width:30px;height:30px;">${icon("trash", { size: 14 })}</button>
        </div>
      `).join("")}
      <div class="flex gap-8" style="margin-top:16px;">
        <button class="btn btn-primary" id="add-brand">${icon("plus", { size: 15 })}Add Brand</button>
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
    toast(wasArchived ? "Brand restored" : "Brand archived");
    refresh();
  }));
  qsa("[data-delete-brand]").forEach((btn) => btn.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Delete brand permanently?", message: "All of its content will be deleted too. This cannot be undone.", confirmLabel: "Delete Forever", danger: true });
    if (ok) { deleteBrand(btn.dataset.deleteBrand); toast("Brand deleted"); refresh(); }
  }));
}

const AI_PROVIDERS = [
  { key: "anthropic", label: "Anthropic (Claude)", keyField: "anthropicApiKey", placeholder: "sk-ant-...", getKeyUrl: "https://console.anthropic.com/settings/keys", getKeyLabel: "console.anthropic.com" },
  { key: "gemini", label: "Google (Gemini)", keyField: "geminiApiKey", placeholder: "AIza...", getKeyUrl: "https://aistudio.google.com/apikey", getKeyLabel: "aistudio.google.com" },
];

function renderAi(content) {
  const ai = getSettings().ai || { provider: "anthropic", anthropicApiKey: "", geminiApiKey: "" };
  const provider = AI_PROVIDERS.find((p) => p.key === ai.provider) || AI_PROVIDERS[0];
  const currentKey = ai[provider.keyField] || "";
  content.innerHTML = `
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:6px;">AI Script & Hook Generator</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 18px;">Powers the AI button next to Script in Creator, for every brand. Called directly from your browser — no server involved, same as the other integrations here.</p>
      <div class="field">
        <label>Provider</label>
        <select class="select" id="ai-provider">
          ${AI_PROVIDERS.map((p) => `<option value="${p.key}" ${p.key === provider.key ? "selected" : ""}>${p.label}</option>`).join("")}
        </select>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>${provider.label} API Key</label>
        <input class="input" type="password" id="ai-key" placeholder="${provider.placeholder}" value="${currentKey.replace(/"/g, "&quot;")}" />
      </div>
      <div id="ai-status" style="margin:10px 0;font-size:12.5px;">${currentKey ? `<span class="text-faint">Saved — click Test Connection to verify it still works.</span>` : ""}</div>
      <button type="button" class="btn btn-secondary btn-sm" id="ai-test">${icon("refresh", { size: 13 })}Test Connection</button>
      <p class="text-faint" style="font-size:11.5px;margin:14px 0 0;">Get a key at <a href="${provider.getKeyUrl}" target="_blank" rel="noopener noreferrer" class="link">${provider.getKeyLabel}</a>. Usage is billed to that account directly by ${provider.key === "gemini" ? "Google" : "Anthropic"}.</p>
    </div>
  `;
  qs("#ai-provider").addEventListener("change", (e) => {
    updateAiSettings({ provider: e.target.value });
    renderAi(content);
  });
  qs("#ai-test").addEventListener("click", async () => {
    const key = qs("#ai-key").value.trim();
    const statusEl = qs("#ai-status");
    if (!key) {
      statusEl.innerHTML = `<span style="color:var(--health-poor);">Paste a key first.</span>`;
      return;
    }
    statusEl.innerHTML = `<span class="text-muted">Testing…</span>`;
    try {
      await testAiConnection({ ...getSettings().ai, [provider.keyField]: key });
      updateAiSettings({ [provider.keyField]: key });
      statusEl.innerHTML = `<span style="color:var(--health-good);">Connected — key saved.</span>`;
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--health-poor);">${e.message}</span>`;
    }
  });
}

function renderRoadmap(content) {
  content.innerHTML = `
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:6px;">What's Coming</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 18px;">Planned features not built yet — so it's clear what's here today vs. on the way.</p>
      ${ROADMAP.map(
        (f) => `
        <div class="list-editor-row" style="align-items:flex-start;padding:14px 0;">
          <div class="row-label" style="flex:1;">
            <div class="flex items-center gap-8" style="margin-bottom:3px;"><strong>${f.name}</strong><span class="tag" style="background:var(--surface-2);color:var(--text-muted);">Coming Soon</span></div>
            <div class="text-muted" style="font-size:12.5px;">${f.desc}</div>
            <div class="text-faint" style="font-size:11.5px;margin-top:2px;">Will live in: ${f.where}</div>
          </div>
        </div>`
      ).join("")}
    </div>
  `;
}

function renderData(content) {
  content.innerHTML = `
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:6px;">Backup</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">Everything is stored locally in this browser. Export a backup now and then, or move your data to another device.</p>
      <div class="flex gap-8">
        <button class="btn btn-secondary" id="export-btn">${icon("download", { size: 15 })}Export JSON</button>
        <button class="btn btn-secondary" id="import-btn">${icon("upload", { size: 15 })}Import JSON</button>
        <input type="file" id="import-file" accept="application/json" style="display:none;" />
      </div>
    </div>
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:6px;color:var(--health-poor);">Reset</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">Wipes every brand, content record, and setting on this device.</p>
      <button class="btn btn-danger" id="reset-btn">${icon("trash", { size: 15 })}Reset All Data</button>
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
      toast("Data imported");
    } catch (err) {
      const reason = err instanceof SyntaxError
        ? "that file isn't valid JSON"
        : err.message || "unknown error";
      toast(`Import failed: ${reason}`, "error");
      console.error("Import failed", err);
    }
  });
  qs("#reset-btn").addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Reset everything?", message: "This permanently deletes all brands and content on this device.", confirmLabel: "Reset Everything", danger: true });
    if (ok) { resetAll(); toast("All data reset"); location.hash = "#/"; }
  });
}

function renderAccount(content) {
  const email = getUserEmail();
  content.innerHTML = `
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:14px;">Logged in as</h3>
      <div class="kv"><span class="k">Email</span><span class="v">${email}</span></div>
    </div>
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:6px;">Guided tour</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">Replay the walkthrough of brands, Creator Studio, Calendar, notifications, and Settings.</p>
      <button class="btn btn-secondary" id="acc-tour">${icon("play", { size: 14 })}Take the Tour</button>
    </div>
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:6px;">Password</h3>
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">Sends a password reset link to this account's email.</p>
      <button class="btn btn-secondary" id="acc-reset">${icon("check", { size: 15 })}Send Password Reset Email</button>
    </div>
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:14px;">Session</h3>
      <button class="btn btn-secondary" id="acc-logout">${icon("logout", { size: 15 })}Log Out</button>
    </div>
  `;

  qs("#acc-tour").addEventListener("click", () => startOnboardingTour());

  qs("#acc-reset").addEventListener("click", async () => {
    try {
      await resetPassword(email);
      toast(`Password reset email sent to ${email}`);
    } catch (err) {
      toast(err.message || "Couldn't send reset email.", "error");
    }
  });

  qs("#acc-logout").addEventListener("click", async () => {
    await logout();
    location.hash = "";
    location.reload();
  });
}

