import { getBrand, listContent, getContent, updateContent, getSettings, onChange, STATUS_LABELS, FUNNELS } from "../store.js";
import { icon, platformIcon } from "../icons.js";
import { escapeHtml, formatDate, toast, avatarHTML, qs, qsa } from "../dom.js";
import { openContentEditor } from "./content-editor.js";
import { openTeleprompter } from "./teleprompter.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { generateScript, generateThumbnail } from "../ai.js";

// Web Speech API (built into Chrome/Edge) — no AI provider or key needed,
// purely browser-native speech-to-text. Silently disables the mic button
// where it isn't supported (notably Firefox) rather than erroring.
function wireMic(button, targetEl) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    button.disabled = true;
    button.title = "Voice input isn't supported in this browser";
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = "id-ID";
  recognition.interimResults = false;
  let listening = false;
  recognition.addEventListener("start", () => {
    listening = true;
    button.classList.add("mic-active");
  });
  recognition.addEventListener("end", () => {
    listening = false;
    button.classList.remove("mic-active");
  });
  recognition.addEventListener("result", (e) => {
    const text = e.results[0][0].transcript;
    targetEl.value = targetEl.value ? `${targetEl.value} ${text}` : text;
  });
  recognition.addEventListener("error", (e) => {
    if (e.error !== "aborted") toast(`Voice input error: ${e.error}`, "error");
  });
  button.addEventListener("click", () => {
    if (listening) recognition.stop();
    else recognition.start();
  });
}

// Same window.print()-based PDF trick as the Report Card, reusing its
// .report-sheet styling — just title/idea/script, nothing else, for handing
// a script to someone who doesn't need the whole app (an editor, a client).
function openScriptPdfPreview(content, brand) {
  const overlay = openModal({
    title: "Script PDF Preview",
    wide: true,
    bodyHTML: `<div class="report-preview-wrap"><div class="report-sheet" id="script-pdf-sheet">${scriptSheetHTML(content, brand)}</div></div>`,
    footHTML: `
      <button class="btn btn-secondary" id="script-pdf-print">${icon("layers", { size: 14 })}Print</button>
      <button class="btn btn-primary" id="script-pdf-download">${icon("download", { size: 14 })}Download PDF</button>
    `,
  });
  const doPrint = () => window.print();
  overlay.querySelector("#script-pdf-print").addEventListener("click", doPrint);
  overlay.querySelector("#script-pdf-download").addEventListener("click", () => {
    toast('In the print dialog, choose "Save as PDF" as the destination.');
    setTimeout(doPrint, 400);
  });
}

function scriptSheetHTML(c, brand) {
  const section = (label, text) => `
    <div class="report-section-title">${label}</div>
    <p style="white-space:pre-wrap;font-size:13.5px;line-height:1.65;color:#33302c;margin:0 0 4px;">${escapeHtml(text) || "—"}</p>
  `;
  return `
    <div class="report-header">
      ${avatarHTML(brand || { name: "?" }, "width:44px;height:44px;border-radius:10px;font-size:16px;")}
      <div>
        <div class="report-brand">${escapeHtml(c.title || "Untitled")}</div>
        <div class="report-title">${escapeHtml(brand?.name || "")}</div>
      </div>
      <div class="report-range">
        <div class="report-generated">Generated ${formatDate(new Date().toISOString())}</div>
      </div>
    </div>
    ${section("Idea / Concept", c.idea)}
    ${section("Script", c.script)}
    <div class="report-footer">Wepeka Brandlab — ${escapeHtml(brand?.name || "")}</div>
  `;
}

// Best-effort desktop notification — always toasts too, since Notification
// permission can be denied/unsupported and the in-app confirmation should
// never depend on it.
function notify(title, body) {
  toast(`${title} — ${body}`);
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") new Notification(title, { body });
    });
  }
}

// Generates hooks, a HOOK/ISI PEMBAHASAN-format script, and a caption —
// onInsert receives { hook } / { script } / { caption } depending on which
// button was clicked, and the caller decides which field to drop it into.
const DURATION_OPTIONS = ["<1 menit", "1:30 menit", "2 menit", ">2 menit", "Custom"];

// lite: pass a field name ("script" or "caption") to show a stripped-down
// version — just the prompt box (pre-filled from that field) and Generate,
// skipping funnel/duration/goal/article. The results (hooks + script +
// caption, each with a Use button) are identical either way.
function openAiScriptModal(content, brand, onInsert, lite = null) {
  const ai = getSettings().ai || { provider: "anthropic" };
  const hasKey = ai.provider === "gemini" ? !!ai.geminiApiKey : !!ai.anthropicApiKey;
  if (!hasKey) {
    toast("Add your AI API key in Settings → AI first.", "error");
    return;
  }

  const state = { funnel: content.funnel || "TOFU", duration: DURATION_OPTIONS[0] };
  const prefill = lite ? content[lite] || content.idea || "" : content.idea || "";

  const overlay = openModal({
    title: lite ? `Quick AI Generate — ${lite === "script" ? "Script" : "Caption"}` : "AI Script & Hook Generator",
    wide: true,
    bodyHTML: `
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">Also uses this content's Title/Idea (if filled) and ${brand?.name || "this brand"}'s AI Voice Guide as context.</p>

      <div class="field" style="margin-bottom:14px;">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">${lite ? "Apa yang mau diisi ke sini?" : "What do you want this content to be about?"}</label>
          <button type="button" class="chip-icon-btn" id="ai-mic" aria-label="Voice input" title="Jelasin pakai suara">${icon("mic", { size: 15 })}</button>
        </div>
        <textarea class="textarea" id="ai-prompt" style="min-height:70px;" placeholder="Jelasin konten apa yang mau kamu buat — boleh detail, boleh cuma garis besar, atau pakai mic">${escapeHtml(prefill)}</textarea>
      </div>

      ${
        lite
          ? ""
          : `
      <div class="field" style="margin-bottom:14px;">
        <label>Funnel stage</label>
        <div class="chip-select" id="ai-funnel">
          ${FUNNELS.map((f) => `<button type="button" data-val="${f}" class="${state.funnel === f ? "active" : ""}">${f}</button>`).join("")}
        </div>
      </div>
      <div class="field" style="margin-bottom:14px;" id="ai-funnel-followup"></div>

      <div class="field" style="margin-bottom:14px;">
        <label>Durasi video</label>
        <div class="chip-select" id="ai-duration-chips">
          ${DURATION_OPTIONS.map((d) => `<button type="button" data-val="${d}" class="${state.duration === d ? "active" : ""}">${d}</button>`).join("")}
        </div>
        <input class="input" id="ai-duration-custom" style="margin-top:8px;${state.duration === "Custom" ? "" : "display:none;"}" placeholder="e.g. 45 detik" />
      </div>
      <div class="field" style="margin-bottom:14px;">
        <label>Goals video ini apa?</label>
        <input class="input" id="ai-goal" placeholder="e.g. edukasi, bikin penasaran" />
      </div>

      <div class="field" style="margin-bottom:14px;">
        <label>Artikel/referensi (opsional)</label>
        <textarea class="textarea" id="ai-article" style="min-height:70px;" placeholder="Link tidak bisa dibaca otomatis (diblokir situs beritanya) — paste teks artikelnya di sini kalau ada"></textarea>
      </div>`
      }

      <button type="button" class="btn btn-primary btn-block" id="ai-generate">${icon("bot", { size: 14 })}Generate</button>
      <div id="ai-result" style="margin-top:16px;"></div>
    `,
    footHTML: `<button class="btn btn-secondary" id="ai-close">Close</button>`,
  });
  overlay.querySelector("#ai-close").addEventListener("click", () => closeOverlay(overlay));

  const micBtn = overlay.querySelector("#ai-mic");
  if (micBtn) wireMic(micBtn, overlay.querySelector("#ai-prompt"));

  function renderFunnelFollowup() {
    const el = overlay.querySelector("#ai-funnel-followup");
    if (!el) return;
    if (state.funnel === "MOFU") {
      el.innerHTML = `<label>Apa yang mau kamu tunjukkan/demonstrasikan?</label><input class="input" id="ai-mofu-goal" placeholder="e.g. cara pakai produk, proses di balik layar" />`;
    } else if (state.funnel === "BOFU") {
      el.innerHTML = `<label>Apa yang mau kamu jual?</label><input class="input" id="ai-bofu-offer" placeholder="e.g. produk/promo apa, kenapa harus beli sekarang" />`;
    } else {
      el.innerHTML = "";
    }
  }
  renderFunnelFollowup();
  overlay.querySelectorAll("#ai-funnel button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.funnel = btn.dataset.val;
      overlay.querySelectorAll("#ai-funnel button").forEach((b) => b.classList.toggle("active", b === btn));
      renderFunnelFollowup();
    });
  });

  const customDurationInput = overlay.querySelector("#ai-duration-custom");
  overlay.querySelectorAll("#ai-duration-chips button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.duration = btn.dataset.val;
      overlay.querySelectorAll("#ai-duration-chips button").forEach((b) => b.classList.toggle("active", b === btn));
      customDurationInput.style.display = state.duration === "Custom" ? "" : "none";
      if (state.duration === "Custom") customDurationInput.focus();
    });
  });

  // Each click adds a new batch below the last instead of replacing it —
  // not satisfied with what came back? Generate More just gives you
  // another set to compare against, every batch's own "Use" buttons still
  // work.
  let batchCount = 0;
  const runGenerate = async () => {
    const btn = overlay.querySelector("#ai-generate");
    const resultEl = overlay.querySelector("#ai-result");
    btn.disabled = true;
    const loadingEl = document.createElement("div");
    loadingEl.className = "ocr-status";
    loadingEl.innerHTML = `<div class="spinner"></div><span>Writing…</span>`;
    resultEl.appendChild(loadingEl);
    try {
      const prompt = overlay.querySelector("#ai-prompt").value.trim();
      const { hooks, script, caption } = await generateScript(ai, {
        title: content.title,
        idea: content.idea,
        platform: content.platform,
        format: content.format,
        funnel: state.funnel,
        prompt,
        duration: state.duration === "Custom" ? customDurationInput?.value.trim() : state.duration,
        goal: overlay.querySelector("#ai-goal")?.value.trim(),
        mofuGoal: overlay.querySelector("#ai-mofu-goal")?.value.trim(),
        bofuOffer: overlay.querySelector("#ai-bofu-offer")?.value.trim(),
        articleText: overlay.querySelector("#ai-article")?.value.trim(),
        brandGuidelines: brand?.aiVoiceGuide || "",
      });
      loadingEl.remove();
      batchCount++;
      const suffix = batchCount > 1 ? ` — batch ${batchCount}` : "";
      const batchEl = document.createElement("div");
      batchEl.className = "ai-batch";
      batchEl.innerHTML = `
        ${batchCount > 1 ? `<div class="divider"></div>` : ""}
        ${hooks.length ? `<div class="page-eyebrow" style="margin-bottom:8px;">Hook options${suffix}</div>` : ""}
        ${hooks
          .map(
            (h, i) => `
          <div class="card card-tight" style="margin-bottom:8px;display:flex;justify-content:space-between;gap:10px;align-items:center;">
            <span style="font-size:13px;">${escapeHtml(h)}</span>
            <button type="button" class="btn btn-secondary btn-sm" data-insert-hook="${i}" style="flex:none;">Use</button>
          </div>`
          )
          .join("")}
        ${
          script
            ? `<div class="page-eyebrow" style="margin:14px 0 8px;">Full script${suffix}</div>
               <div class="card card-tight" style="white-space:pre-wrap;font-size:13px;margin-bottom:10px;">${escapeHtml(script)}</div>
               <button type="button" class="btn btn-primary btn-block use-script-btn">Use this script</button>`
            : ""
        }
        ${
          caption
            ? `<div class="page-eyebrow" style="margin:14px 0 8px;">Caption${suffix}</div>
               <div class="card card-tight" style="white-space:pre-wrap;font-size:13px;margin-bottom:10px;">${escapeHtml(caption)}</div>
               <button type="button" class="btn btn-secondary btn-block use-caption-btn">Use this caption</button>`
            : ""
        }
      `;
      resultEl.appendChild(batchEl);
      batchEl.querySelectorAll("[data-insert-hook]").forEach((b) => {
        b.addEventListener("click", () => {
          onInsert({ hook: hooks[Number(b.dataset.insertHook)] });
          toast("Hook inserted");
        });
      });
      batchEl.querySelector(".use-script-btn")?.addEventListener("click", () => {
        onInsert({ script, funnel: state.funnel });
        toast("Script inserted");
      });
      batchEl.querySelector(".use-caption-btn")?.addEventListener("click", () => {
        onInsert({ caption });
        toast("Caption inserted");
      });
      btn.innerHTML = `${icon("bot", { size: 14 })}Generate More`;
    } catch (e) {
      loadingEl.outerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>${e.message}</span></div>`;
    } finally {
      btn.disabled = false;
    }
  };
  overlay.querySelector("#ai-generate").addEventListener("click", runGenerate);
}

// Creator is the "what still needs to be made" workspace — once something
// is published, its script/caption/etc. move here only if you deep-link to
// it directly (e.g. from the "Edit in Creator" button on a published item);
// otherwise this list only shows what's still in progress, sorted so the
// most time-sensitive piece is first.
export function render(root, { brandId, initialContentId }) {
  const state = { selectedId: initialContentId || null, collapsedGroups: new Set() };
  const refresh = () => paint(root, brandId, state, refresh);
  refresh();
  return onChange(refresh);
}

function paint(root, brandId, state, refresh) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return;
  }
  const all = listContent(brandId);
  const items = all
    .filter((c) => c.status !== "published" || c.id === state.selectedId)
    .sort((a, b) => {
      const da = a.scheduleDate || "9999-99-99";
      const db = b.scheduleDate || "9999-99-99";
      if (da !== db) return da.localeCompare(db);
      return b.updatedAt - a.updatedAt;
    });

  if (!state.selectedId || !items.find((c) => c.id === state.selectedId)) {
    state.selectedId = items[0]?.id || null;
  }
  const selected = state.selectedId ? getContent(state.selectedId) : null;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">Creator Studio — Mission</div>
        <h1>${brand.name}</h1>
      </div>
      <button class="btn btn-primary" id="new-content">${icon("plus", { size: 16 })}New Content</button>
    </div>

    <div class="creator-layout">
      <div class="creator-sidebar">
        <div class="creator-sidebar-list">
          ${
            items.length
              ? groupedSidebarHTML(items, state.selectedId, state.collapsedGroups)
              : `<div class="table-empty" style="padding:32px 16px;">Nothing in progress — everything's published, or start something new.</div>`
          }
        </div>
      </div>
      <div class="creator-main">
        ${selected ? mainPanel(selected) : emptyPanel()}
        <a class="link" href="#/brand/${brandId}/calendar" style="display:block;text-align:center;font-size:12.5px;margin-top:4px;">${icon("calendar", { size: 13 })} Go to Calendar</a>
      </div>
    </div>
  `;

  qs("#new-content").addEventListener("click", () => openContentEditor({ brandId, onSaved: refresh }));
  const emptyNewBtn = qs("#new-content-empty");
  if (emptyNewBtn) emptyNewBtn.addEventListener("click", () => openContentEditor({ brandId, onSaved: refresh }));

  qsa("[data-select]", root).forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedId = row.dataset.select;
      paint(root, brandId, state, refresh);
    });
  });

  qsa("[data-toggle-group]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.toggleGroup;
      if (state.collapsedGroups.has(key)) state.collapsedGroups.delete(key);
      else state.collapsedGroups.add(key);
      paint(root, brandId, state, refresh);
    });
  });

  if (!selected) return;

  const pdfBtn = qs("#download-script-pdf", root);
  if (pdfBtn) {
    pdfBtn.addEventListener("click", () => {
      const current = {
        ...selected,
        title: qs("#f-title", root)?.value ?? selected.title,
        idea: qs("#f-idea", root)?.value ?? selected.idea,
        script: qs("#f-script", root)?.value ?? selected.script,
      };
      openScriptPdfPreview(current, brand);
    });
  }

  const fieldMap = { title: "f-title", idea: "f-idea", caption: "f-caption", script: "f-script", cta: "f-cta", reference: "f-reference", notes: "f-notes" };
  const indicator = qs("#save-indicator", root);
  let flashTimer = null;
  const flashSaved = () => {
    if (!indicator) return;
    indicator.textContent = "Saved";
    indicator.classList.add("show");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => indicator.classList.remove("show"), 1400);
  };

  Object.entries(fieldMap).forEach(([key, id]) => {
    const el = qs(`#${id}`, root);
    if (!el) return;
    el.addEventListener("blur", () => {
      if (el.value === (selected[key] || "")) return;
      updateContent(selected.id, { [key]: el.value });
      flashSaved();
    });
  });

  const tpBtn = qs("#open-teleprompter", root);
  if (tpBtn) {
    tpBtn.addEventListener("click", () => {
      const currentScript = qs("#f-script", root)?.value ?? selected.script;
      openTeleprompter(currentScript, { title: selected.title || "Untitled" });
    });
  }

  const openAiFor = () => {
    const current = {
      ...selected,
      idea: qs("#f-idea", root)?.value ?? selected.idea,
      title: qs("#f-title", root)?.value ?? selected.title,
    };
    openAiScriptModal(current, brand, ({ hook, script, caption, funnel }) => {
      if (caption !== undefined) {
        const captionEl = qs("#f-caption", root);
        if (!captionEl) return;
        captionEl.value = caption;
        updateContent(selected.id, { caption: captionEl.value });
      } else {
        const scriptEl = qs("#f-script", root);
        if (!scriptEl) return;
        scriptEl.value = script ? script : hook + (scriptEl.value ? "\n\n" + scriptEl.value : "");
        updateContent(selected.id, { script: scriptEl.value, ...(funnel ? { funnel } : {}) });
      }
      flashSaved();
    });
  };

  const aiBtn = qs("#ai-generate-all", root);
  if (aiBtn) aiBtn.addEventListener("click", openAiFor);

  // Quick per-field generate — a stripped-down version of the same modal
  // (just a prompt box, pre-filled from that field), still with the full
  // hooks/script/caption results to pick from, not an instant silent swap.
  function quickGenerate(field) {
    const current = {
      ...selected,
      idea: qs("#f-idea", root)?.value ?? selected.idea,
      title: qs("#f-title", root)?.value ?? selected.title,
      script: qs("#f-script", root)?.value ?? selected.script,
      caption: qs("#f-caption", root)?.value ?? selected.caption,
    };
    openAiScriptModal(
      current,
      brand,
      ({ hook, script, caption, funnel }) => {
        if (caption !== undefined) {
          const captionEl = qs("#f-caption", root);
          if (!captionEl) return;
          captionEl.value = caption;
          updateContent(selected.id, { caption: captionEl.value });
        } else {
          const scriptEl = qs("#f-script", root);
          if (!scriptEl) return;
          scriptEl.value = script ? script : hook + (scriptEl.value ? "\n\n" + scriptEl.value : "");
          updateContent(selected.id, { script: scriptEl.value, ...(funnel ? { funnel } : {}) });
        }
        flashSaved();
      },
      field
    );
  }
  const quickScriptBtn = qs("#ai-quick-script", root);
  if (quickScriptBtn) quickScriptBtn.addEventListener("click", () => quickGenerate("script"));
  const quickCaptionBtn = qs("#ai-quick-caption", root);
  if (quickCaptionBtn) quickCaptionBtn.addEventListener("click", () => quickGenerate("caption"));

  const markSubmitted = qs("#mark-submitted", root);
  if (markSubmitted) {
    markSubmitted.addEventListener("change", () => {
      updateContent(selected.id, { status: "production" });
      notify("Moved to Execution", `"${selected.title || "Untitled"}" idea submitted — ready to shoot.`);
    });
  }
  const markShotBig = qs("#mark-shot-big", root);
  if (markShotBig) {
    markShotBig.addEventListener("click", () => {
      updateContent(selected.id, { status: "editing" });
      notify("Moved to Editing", `"${selected.title || "Untitled"}" finished shooting.`);
    });
  }
  const markEditedBig = qs("#mark-edited-big", root);
  if (markEditedBig) {
    markEditedBig.addEventListener("click", () => {
      updateContent(selected.id, { status: "scheduled" });
      notify("Ready to Upload", `"${selected.title || "Untitled"}" finished editing.`);
    });
  }
  // Whichever platform(s) got checked, then Done — publishing doesn't need
  // to wait for every platform, just at least one.
  const markUploadedDone = qs("#mark-uploaded-done", root);
  if (markUploadedDone) {
    markUploadedDone.addEventListener("click", () => {
      const uploadedPlatforms = {
        tiktok: !!qs("#uploaded-tiktok", root)?.checked,
        instagram: !!qs("#uploaded-instagram", root)?.checked,
      };
      if (!uploadedPlatforms.tiktok && !uploadedPlatforms.instagram) {
        toast("Check at least one platform first.", "error");
        return;
      }
      updateContent(selected.id, {
        uploadedPlatforms,
        status: "published",
        publishedDate: selected.publishedDate || new Date().toISOString().slice(0, 10),
      });
      notify("Published", `"${selected.title || "Untitled"}" is live.`);
    });
  }

  const aiThumbGenReady = qs("#ai-thumb-gen-ready", root);
  if (aiThumbGenReady) {
    aiThumbGenReady.addEventListener("click", async () => {
      const ai = getSettings().ai || {};
      const statusEl = qs("#ready-thumb-status", root);
      if (ai.provider !== "gemini" || !ai.geminiApiKey) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>Needs the Gemini provider connected in Settings → AI.</span></div>`;
        return;
      }
      aiThumbGenReady.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>Generating…</span></div>`;
      try {
        const dataUrl = await generateThumbnail(ai, {
          title: selected.title,
          idea: selected.idea,
          brandGuidelines: brand?.aiVoiceGuide || "",
          logoDataUrl: brand?.logoAssets?.[0]?.dataUrl,
        });
        updateContent(selected.id, { thumbnail: dataUrl });
        const img = qs("#ready-thumb-img", root);
        if (img) {
          img.src = dataUrl;
          img.style.display = "block";
        }
        statusEl.innerHTML = `<div class="ocr-status">${icon("check", { size: 15 })}<span>Generated and saved.</span></div>`;
      } catch (err) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>${err.message || "Couldn't generate a thumbnail."}${/quota|billing|429/i.test(err.message || "") ? " Needs billing enabled on your Google Cloud project." : ""}</span></div>`;
      } finally {
        aiThumbGenReady.disabled = false;
      }
    });
  }

  const stageBackBtn = qs("#stage-back", root);
  if (stageBackBtn) {
    stageBackBtn.addEventListener("click", async () => {
      const prev = PREV_STATUS[selected.status];
      if (!prev) return;
      const ok = await confirmDialog({
        title: "Move back a stage?",
        message: `"${selected.title || "Untitled"}" will move from ${STATUS_LABELS[selected.status]} back to ${STATUS_LABELS[prev]}.`,
        confirmLabel: "Yes, move back",
      });
      if (!ok) return;
      updateContent(selected.id, { status: prev });
      toast(`Moved back to ${STATUS_LABELS[prev]}`);
    });
  }
}

// A quick "what's due" signal — not a real notification system (there's no
// server to run one), just a visible cue while you're in here so the most
// urgent piece is easy to spot.
function dueBadge(c) {
  if (!c.scheduleDate) return "";
  const today = new Date().toISOString().slice(0, 10);
  if (c.scheduleDate < today) return `<span class="due-badge due-overdue">Overdue</span>`;
  if (c.scheduleDate === today) return `<span class="due-badge due-today">Due today</span>`;
  return `<span class="due-badge due-soon">Due ${formatDate(c.scheduleDate)}</span>`;
}

// Separates "still drafting" from what's been submitted onward — each
// phase gets its own labeled folder in the sidebar instead of one flat
// list, so submitted content doesn't sit mixed in with raw ideas.
const SIDEBAR_GROUPS = [
  { key: "drafting", label: "Drafting", statuses: ["idea", "draft"] },
  { key: "execution", label: "Execution", statuses: ["production"] },
  { key: "editing", label: "Editing", statuses: ["editing"] },
  { key: "scheduled", label: "Ready to Upload", statuses: ["scheduled"] },
  { key: "other", label: "Other", statuses: ["published", "archived"] },
];

function groupedSidebarHTML(items, selectedId, collapsedGroups) {
  return SIDEBAR_GROUPS.map((g) => ({ ...g, items: items.filter((c) => g.statuses.includes(c.status)) }))
    .filter((g) => g.items.length)
    .map((g) => {
      const collapsed = collapsedGroups.has(g.key);
      return `
    <div class="creator-sidebar-group ${collapsed ? "collapsed" : ""}">
      <button type="button" class="creator-sidebar-group-head" data-toggle-group="${g.key}">
        <span>${g.label} <span class="text-faint">${g.items.length}</span></span>
        ${icon("chevronDown", { size: 13, className: "creator-sidebar-group-chevron" })}
      </button>
      <div class="creator-sidebar-group-body">
        <div class="creator-sidebar-group-body-inner">
          ${g.items.map((c) => sidebarRow(c, c.id === selectedId)).join("")}
        </div>
      </div>
    </div>`;
    })
    .join("");
}

function sidebarRow(c, active) {
  return `
    <div class="creator-item ${active ? "active" : ""}" data-select="${c.id}">
      <span class="status-pill status-${c.status}" style="padding:3px 8px;"><span class="status-dot"></span></span>
      <div class="ti">
        <div class="t">${escapeHtml(c.title || "Untitled")}</div>
        <div class="m">${c.platform || "—"} · ${formatDate(new Date(c.updatedAt))}</div>
      </div>
      ${dueBadge(c)}
    </div>
  `;
}

function emptyPanel() {
  return `
    <div class="empty-state card" style="margin:0;">
      <div class="icon-wrap">${icon("edit", { size: 22 })}</div>
      <h3>Nothing to write yet</h3>
      <p>Create your first piece of content to start drafting titles, captions, and scripts here.</p>
      <button class="btn btn-primary" id="new-content-empty">${icon("plus", { size: 15 })}New Content</button>
    </div>
  `;
}

// Reverts a checkbox click that moved a card forward one stage too many —
// each key's value is where "Back" sends it.
const PREV_STATUS = { production: "draft", editing: "production", scheduled: "editing" };

// Submit Idea lives at the bottom of the drafting form — you finish
// writing, then submit, not the other way around. (Execution/Editing/Ready
// to Upload have their own dedicated single-purpose panels below, not this
// one, since by then there's nothing left to draft.)
function stageProgressHTML(c) {
  if (c.status !== "idea" && c.status !== "draft") return "";
  return `
    <div class="divider"></div>
    <div class="flex items-center justify-between" style="flex-wrap:wrap;gap:10px;">
      <span></span>
      <label class="checkbox-chip" id="mark-submitted"><input type="checkbox" />Submit Idea</label>
    </div>
  `;
}

// Each stage past drafting gets its own minimal, single-purpose panel —
// once you're shooting or editing, you don't need the whole form, just the
// script to work from and one big action.
function mainPanel(c) {
  if (c.status === "production") return executionPanel(c);
  if (c.status === "editing") return editingPanel(c);
  if (c.status === "scheduled") return readyToUploadPanel(c);
  return draftingPanel(c);
}

function phaseHead(c) {
  const back = PREV_STATUS[c.status]
    ? `<button type="button" class="btn btn-ghost btn-sm" id="stage-back">${icon("chevronLeft", { size: 13 })}Back to ${STATUS_LABELS[PREV_STATUS[c.status]]}</button>`
    : "";
  return `
    <div class="creator-field-head" style="margin-bottom:18px;">
      <span class="status-pill status-${c.status}"><span class="status-dot"></span>${STATUS_LABELS[c.status]}</span>
      ${back}
    </div>
  `;
}

function executionPanel(c) {
  return `
    <div class="card">
      ${phaseHead(c)}
      <div class="creator-field-head" style="margin-bottom:4px;">
        <div class="page-eyebrow" style="margin-bottom:0;">${escapeHtml(c.title || "Untitled")}</div>
        <button type="button" class="chip-icon-btn" id="open-teleprompter" aria-label="Open teleprompter" title="Open teleprompter">${icon("teleprompter", { size: 15 })}</button>
      </div>
      <div class="stage-script-display">${escapeHtml(c.script || "No script written yet — go Back to Scripting to add one.").replace(/\n/g, "<br>")}</div>
      <button type="button" class="btn btn-primary btn-block stage-big-action" id="mark-shot-big">${icon("check", { size: 20 })}Footage Done</button>
    </div>
  `;
}

function editingPanel(c) {
  return `
    <div class="card">
      ${phaseHead(c)}
      <div class="page-eyebrow" style="margin-bottom:20px;">${escapeHtml(c.title || "Untitled")}</div>
      <button type="button" class="btn btn-primary btn-block stage-big-action" id="mark-edited-big">${icon("check", { size: 20 })}Editing Done</button>
    </div>
  `;
}

function readyToUploadPanel(c) {
  const up = c.uploadedPlatforms || {};
  return `
    <div class="card">
      ${phaseHead(c)}
      <div class="page-eyebrow" style="margin-bottom:16px;">${escapeHtml(c.title || "Untitled")}</div>

      <div class="field" style="margin-bottom:6px;">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">Thumbnail</label>
          <button type="button" class="chip-icon-btn" id="ai-thumb-gen-ready" aria-label="AI Thumbnail Creator" title="AI Thumbnail Creator">${icon("bot", { size: 15 })}</button>
        </div>
        ${c.thumbnail ? `<img class="thumb-preview" id="ready-thumb-img" src="${c.thumbnail}" />` : `<img class="thumb-preview" id="ready-thumb-img" style="display:none;" />`}
        <div id="ready-thumb-status" style="margin-top:6px;"></div>
      </div>

      <div class="divider"></div>

      <div class="field" style="margin-bottom:8px;">
        <label>Confirm upload — check whichever you've posted to</label>
        <div class="flex gap-8" style="flex-wrap:wrap;">
          <label class="checkbox-chip"><input type="checkbox" id="uploaded-tiktok" ${up.tiktok ? "checked" : ""} />${platformIcon("tiktok")}Uploaded to TikTok</label>
          <label class="checkbox-chip"><input type="checkbox" id="uploaded-instagram" ${up.instagram ? "checked" : ""} />${platformIcon("instagram")}Uploaded to Instagram</label>
        </div>
      </div>
      <button type="button" class="btn btn-primary btn-block stage-big-action" id="mark-uploaded-done">${icon("check", { size: 20 })}Done</button>
      <p class="text-faint" style="font-size:11px;margin:10px 0 0;">Check at least one platform, then Done — no need to wait for both. Could link to the Instagram/TikTok APIs later to confirm automatically instead of checking by hand.</p>
    </div>
  `;
}

function draftingPanel(c) {
  const publishedNote =
    c.status === "published"
      ? `<div class="hint" style="margin:0 0 16px;">${icon("info", { size: 12 })} This content is published — you're viewing it here via a direct link.</div>`
      : "";
  return `
    <div class="card">
      <button type="button" class="btn btn-primary btn-block" id="ai-generate-all">${icon("bot", { size: 15 })}AI Generate — Hook, Script & Caption</button>
      <p class="text-faint" style="font-size:11.5px;text-align:center;margin:6px 0 16px;">${icon("arrowUp", { size: 10 })} Click here to auto-generate all — or use the small AI icon on Script/Caption to just fill in that one field from what's already written.</p>

      <div class="creator-field-head" style="margin-bottom:18px;">
        <span class="status-pill status-${c.status}"><span class="status-dot"></span>${STATUS_LABELS[c.status]}</span>
        <div class="flex items-center gap-8">
          <span class="save-indicator" id="save-indicator">Saved</span>
          <button class="btn btn-ghost btn-sm" id="download-script-pdf">${icon("download", { size: 13 })}Download PDF</button>
        </div>
      </div>
      ${publishedNote}

      <div class="field">
        <label>Title</label>
        <input class="input" id="f-title" value="${escapeHtml(c.title)}" placeholder="Content title" />
      </div>
      <div class="field">
        <label>Idea</label>
        <textarea class="textarea" id="f-idea" style="min-height:60px;" placeholder="What is this content about?">${c.idea || ""}</textarea>
      </div>
      <div class="field">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">Script</label>
          <div class="flex items-center gap-6">
            <button type="button" class="chip-icon-btn" id="ai-quick-script" aria-label="Quick AI generate from this script/idea" title="Quick generate — just fills in Script from what's already here">${icon("bot", { size: 15 })}</button>
            <button type="button" class="chip-icon-btn" id="open-teleprompter" aria-label="Open teleprompter" title="Open teleprompter">${icon("teleprompter", { size: 15 })}</button>
          </div>
        </div>
        <textarea class="textarea" id="f-script" style="min-height:220px;" placeholder="HOOK...\n\nISI PEMBAHASAN...">${c.script || ""}</textarea>
      </div>
      <div class="field">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">Caption</label>
          <button type="button" class="chip-icon-btn" id="ai-quick-caption" aria-label="Quick AI generate caption" title="Quick generate — just fills in Caption from what's already here">${icon("bot", { size: 15 })}</button>
        </div>
        <textarea class="textarea" id="f-caption" placeholder="Caption text for the post">${c.caption || ""}</textarea>
      </div>
      <div class="row-2">
        <div class="field">
          <label>CTA</label>
          <input class="input" id="f-cta" value="${escapeHtml(c.cta)}" placeholder="What should the viewer do next?" />
        </div>
        <div class="field">
          <label>Reference</label>
          <input class="input" id="f-reference" value="${escapeHtml(c.reference)}" placeholder="Links or inspiration" />
        </div>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Notes</label>
        <textarea class="textarea" id="f-notes" style="min-height:60px;">${c.notes || ""}</textarea>
      </div>
      ${stageProgressHTML(c)}
    </div>
  `;
}
