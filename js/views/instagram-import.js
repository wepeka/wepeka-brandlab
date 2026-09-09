import { getBrand, listContent, createContent, updateContent } from "../store.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay } from "../modals.js";
import { qs, qsa, showProgressBar, escapeHtml } from "../dom.js";
import { listRecentMedia, fetchMediaMetrics, shortcodeFromUrl, formatFromMedia, titleFromMedia, thumbnailFromMedia } from "../instagram.js";

function normalizeCaption(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Lets you see thumbnails of your recent Instagram posts and choose exactly
// which ones to bring into the Content Database, instead of a blind bulk
// import of everything on the account.
export async function openInstagramImportPicker(brandId, onImported) {
  const brand = getBrand(brandId);
  const ig = brand?.instagram;

  const overlay = openModal({
    title: "Import from Instagram",
    wide: true,
    bodyHTML: `<div id="ig-picker-body" style="min-height:140px;">
      <div class="ocr-status" style="margin:0;"><div class="spinner"></div><span>Looking up your recent Instagram posts…</span></div>
    </div>`,
    footHTML: `
      <button class="btn btn-secondary" id="ig-picker-cancel">Cancel</button>
      <button class="btn btn-primary" id="ig-picker-import" disabled>Import Selected</button>
    `,
  });
  const bodyEl = overlay.querySelector("#ig-picker-body");
  const importBtn = overlay.querySelector("#ig-picker-import");
  overlay.querySelector("#ig-picker-cancel").addEventListener("click", () => closeOverlay(overlay));

  let media;
  try {
    media = await listRecentMedia(ig, { maxItems: 100 });
  } catch (e) {
    bodyEl.innerHTML = errorRow(`Couldn't reach Instagram: ${e.message}`);
    return;
  }
  if (!media.length) {
    bodyEl.innerHTML = errorRow("No posts found on this Instagram account.");
    return;
  }

  const existing = listContent(brandId, { includeArchived: true });
  const existingCodes = new Set(existing.map((c) => shortcodeFromUrl(c.publishedUrl)).filter(Boolean));

  // Content you already planned in Creator (idea/draft, no post link yet)
  // gets matched by caption instead of being duplicated — publishing the
  // exact caption you wrote should upgrade that same card, not create a
  // second one.
  const captionMatches = new Map(); // normalized caption -> content
  existing
    .filter((c) => !c.publishedUrl && c.caption && c.caption.trim())
    .forEach((c) => captionMatches.set(normalizeCaption(c.caption), c));

  const linkTargets = new Map(); // shortcode -> matched existing content (to update, not create)
  media.forEach((m) => {
    const code = shortcodeFromUrl(m.permalink);
    if (!code || existingCodes.has(code)) return;
    const match = captionMatches.get(normalizeCaption(m.caption));
    if (match) linkTargets.set(code, match);
  });

  bodyEl.innerHTML = `
    <div class="ig-picker-toolbar">
      <button class="btn btn-ghost btn-sm" id="ig-select-all">Select All</button>
      <button class="btn btn-ghost btn-sm" id="ig-select-none">Select None</button>
      <span class="text-faint" style="font-size:12px;margin-left:auto;">${media.length} posts found</span>
    </div>
    <div class="ig-picker-grid">
      ${media.map((m) => pickerCardHTML(m, existingCodes, linkTargets)).join("")}
    </div>
  `;

  const checkboxes = () => qsa("input[type=checkbox][data-code]", bodyEl);
  const selectableCheckboxes = () => qsa("input[type=checkbox][data-code]:not(:disabled)", bodyEl);

  function updateImportCount() {
    const checked = checkboxes().filter((cb) => cb.checked && !cb.disabled).length;
    importBtn.disabled = checked === 0;
    importBtn.textContent = checked ? `Import Selected (${checked})` : "Import Selected";
  }
  checkboxes().forEach((cb) => cb.addEventListener("change", updateImportCount));
  overlay.querySelector("#ig-select-all").addEventListener("click", () => {
    selectableCheckboxes().forEach((cb) => (cb.checked = true));
    updateImportCount();
  });
  overlay.querySelector("#ig-select-none").addEventListener("click", () => {
    selectableCheckboxes().forEach((cb) => (cb.checked = false));
    updateImportCount();
  });
  updateImportCount();

  importBtn.addEventListener("click", async () => {
    const selectedCodes = new Set(
      checkboxes()
        .filter((cb) => cb.checked && !cb.disabled)
        .map((cb) => cb.dataset.code)
    );
    const toImport = media.filter((m) => selectedCodes.has(shortcodeFromUrl(m.permalink)));

    // Runs as a minimized floating progress bar instead of holding this
    // modal open — importing a big batch shouldn't block using the rest of
    // the app while it works through each one.
    closeOverlay(overlay);
    const bar = showProgressBar(`Importing from Instagram`);

    let created = 0;
    let linked = 0;
    let metricFails = 0;
    let done = 0;
    for (const m of toImport) {
      const code = shortcodeFromUrl(m.permalink);
      bar.update(done, toImport.length, titleFromMedia(m));

      const linkTarget = linkTargets.get(code);
      const publishFields = {
        platform: "Instagram",
        format: formatFromMedia(m),
        status: "published",
        publishedUrl: m.permalink,
        publishedDate: new Date(m.timestamp).toISOString().slice(0, 10),
      };

      let target;
      if (linkTarget) {
        target = updateContent(linkTarget.id, publishFields);
        linked++;
      } else {
        target = createContent(brandId, {
          title: titleFromMedia(m),
          caption: m.caption || "",
          thumbnail: thumbnailFromMedia(m),
          funnel: "TOFU",
          ...publishFields,
        });
        created++;
      }

      try {
        const { metrics } = await fetchMediaMetrics(ig, m);
        updateContent(target.id, { performance: metrics });
      } catch {
        metricFails++;
      }
      done++;
      bar.update(done, toImport.length);
      onImported?.();
    }

    const summaryParts = [];
    if (created) summaryParts.push(`${created} new`);
    if (linked) summaryParts.push(`${linked} linked to existing ideas`);
    bar.done(`Imported ${summaryParts.join(", ")}${metricFails ? ` — ${metricFails} need metrics filled in manually` : ""}`);
  });
}

function pickerCardHTML(media, existingCodes, linkTargets) {
  const code = shortcodeFromUrl(media.permalink);
  const already = code && existingCodes.has(code);
  const linkTarget = code ? linkTargets.get(code) : null;
  const thumb = thumbnailFromMedia(media);
  return `
    <label class="ig-picker-card" data-card="${code}">
      <input type="checkbox" data-code="${code}" ${already ? "checked disabled" : "checked"} />
      <div class="ig-picker-thumb">
        ${thumb ? `<img src="${thumb}" loading="lazy" alt="" />` : `<div class="ig-picker-noimg">${icon("image", { size: 20 })}</div>`}
        <span class="ig-picker-type">${formatFromMedia(media)}</span>
        <span class="ig-picker-check">${icon("check", { size: 12 })}</span>
      </div>
      <div class="ig-picker-caption">${escapeHtml(titleFromMedia(media))}</div>
      ${already ? `<div class="ig-picker-already">Already added</div>` : ""}
      ${linkTarget ? `<div class="ig-picker-linked">${icon("link", { size: 10 })} Matches "${escapeHtml(linkTarget.title || "Untitled")}"</div>` : ""}
    </label>
  `;
}

function errorRow(message) {
  return `<div class="ocr-status" style="margin:0;">${icon("info", { size: 15 })}<span>${escapeHtml(message)}</span></div>`;
}
