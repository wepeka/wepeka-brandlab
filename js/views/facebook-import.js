import { getBrand, listContent, createContent, updateContent } from "../store.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay } from "../modals.js";
import { qs, qsa, showProgressBar, escapeHtml } from "../dom.js";
import { listRecentVideos, fetchFacebookVideoMetrics, thumbnailFromVideo, titleFromVideo } from "../facebook.js";

function normalizeCaption(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Same "browse thumbnails, pick which ones to bring in" picker as
// instagram-import.js, pointed at this brand's Facebook Page instead —
// a separate source, not just the crosspost check content-editor does
// automatically for Instagram Reels.
export async function openFacebookImportPicker(brandId, onImported) {
  const brand = getBrand(brandId);
  const fb = brand?.facebook;

  const overlay = openModal({
    title: "Import from Facebook",
    wide: true,
    bodyHTML: `<div id="fb-picker-body" style="min-height:140px;">
      <div class="ocr-status" style="margin:0;"><div class="spinner"></div><span>Looking up this Page's recent videos…</span></div>
    </div>`,
    footHTML: `
      <button class="btn btn-secondary" id="fb-picker-cancel">Cancel</button>
      <button class="btn btn-primary" id="fb-picker-import" disabled>Import Selected</button>
    `,
  });
  const bodyEl = overlay.querySelector("#fb-picker-body");
  const importBtn = overlay.querySelector("#fb-picker-import");
  overlay.querySelector("#fb-picker-cancel").addEventListener("click", () => closeOverlay(overlay));

  let videos, warnings;
  try {
    ({ videos, warnings } = await listRecentVideos(fb, { maxItems: 100 }));
  } catch (e) {
    bodyEl.innerHTML = errorRow(`Couldn't reach Facebook: ${e.message}`);
    return;
  }
  if (!videos.length) {
    bodyEl.innerHTML = warnings.length
      ? errorRow(`No videos found — and one lookup failed: ${warnings.join(" · ")}`)
      : errorRow("No videos or Reels found on this Facebook Page.");
    return;
  }

  const existing = listContent(brandId, { includeArchived: true });
  const existingUrls = new Set(existing.map((c) => c.publishedUrl).filter(Boolean));

  const captionMatches = new Map(); // normalized caption -> content
  existing
    .filter((c) => !c.publishedUrl && c.caption && c.caption.trim())
    .forEach((c) => captionMatches.set(normalizeCaption(c.caption), c));

  const linkTargets = new Map(); // video id -> matched existing content (to update, not create)
  videos.forEach((v) => {
    if (existingUrls.has(v.permalink_url)) return;
    const match = captionMatches.get(normalizeCaption(v.description));
    if (match) linkTargets.set(v.id, match);
  });

  bodyEl.innerHTML = `
    <div class="ig-picker-toolbar">
      <button class="btn btn-ghost btn-sm" id="fb-select-all">Select All</button>
      <button class="btn btn-ghost btn-sm" id="fb-select-none">Select None</button>
      <span class="text-faint" style="font-size:12px;margin-left:auto;">${videos.length} videos found</span>
    </div>
    <div class="ig-picker-grid">
      ${videos.map((v) => pickerCardHTML(v, existingUrls, linkTargets)).join("")}
    </div>
  `;

  const checkboxes = () => qsa("input[type=checkbox][data-vid]", bodyEl);
  const selectableCheckboxes = () => qsa("input[type=checkbox][data-vid]:not(:disabled)", bodyEl);

  function updateImportCount() {
    const checked = checkboxes().filter((cb) => cb.checked && !cb.disabled).length;
    importBtn.disabled = checked === 0;
    importBtn.textContent = checked ? `Import Selected (${checked})` : "Import Selected";
  }
  checkboxes().forEach((cb) => cb.addEventListener("change", updateImportCount));
  overlay.querySelector("#fb-select-all").addEventListener("click", () => {
    selectableCheckboxes().forEach((cb) => (cb.checked = true));
    updateImportCount();
  });
  overlay.querySelector("#fb-select-none").addEventListener("click", () => {
    selectableCheckboxes().forEach((cb) => (cb.checked = false));
    updateImportCount();
  });
  updateImportCount();

  importBtn.addEventListener("click", async () => {
    const selectedIds = new Set(
      checkboxes()
        .filter((cb) => cb.checked && !cb.disabled)
        .map((cb) => cb.dataset.vid)
    );
    const toImport = videos.filter((v) => selectedIds.has(v.id));

    // Same as the Instagram import — runs as a minimized floating bar
    // instead of a blocking modal.
    closeOverlay(overlay);
    const bar = showProgressBar(`Importing from Facebook`);

    let created = 0;
    let linked = 0;
    let metricFails = 0;
    let done = 0;
    for (const v of toImport) {
      bar.update(done, toImport.length, titleFromVideo(v));

      const linkTarget = linkTargets.get(v.id);
      const publishFields = {
        platform: "Facebook",
        status: "published",
        publishedUrl: v.permalink_url,
        publishedDate: new Date(v.created_time).toISOString().slice(0, 10),
      };

      let target;
      if (linkTarget) {
        target = updateContent(linkTarget.id, publishFields);
        linked++;
      } else {
        target = createContent(brandId, {
          title: titleFromVideo(v),
          caption: v.description || "",
          thumbnail: thumbnailFromVideo(v),
          funnel: "TOFU",
          ...publishFields,
        });
        created++;
      }

      try {
        const { metrics } = await fetchFacebookVideoMetrics(fb, v.id);
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

function pickerCardHTML(video, existingUrls, linkTargets) {
  const already = existingUrls.has(video.permalink_url);
  const linkTarget = linkTargets.get(video.id);
  const thumb = thumbnailFromVideo(video);
  return `
    <label class="ig-picker-card" data-card="${video.id}">
      <input type="checkbox" data-vid="${video.id}" ${already ? "checked disabled" : "checked"} />
      <div class="ig-picker-thumb">
        ${thumb ? `<img src="${thumb}" loading="lazy" alt="" />` : `<div class="ig-picker-noimg">${icon("image", { size: 20 })}</div>`}
        <span class="ig-picker-type">Video</span>
        <span class="ig-picker-check">${icon("check", { size: 12 })}</span>
      </div>
      <div class="ig-picker-caption">${escapeHtml(titleFromVideo(video))}</div>
      ${already ? `<div class="ig-picker-already">Already added</div>` : ""}
      ${linkTarget ? `<div class="ig-picker-linked">${icon("link", { size: 10 })} Matches "${escapeHtml(linkTarget.title || "Untitled")}"</div>` : ""}
    </label>
  `;
}

function errorRow(message) {
  return `<div class="ocr-status" style="margin:0;">${icon("info", { size: 15 })}<span>${escapeHtml(message)}</span></div>`;
}
