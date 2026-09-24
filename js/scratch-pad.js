// Coretan (Bank Konsep) — a scratch pad of raw notes, per brand
// (brand.scratch) or per campaign (campaign.scratch), grouped in folders like
// a phone's notes app (…scratchFolders). Deliberately inert: nothing here is
// read by any AI call, the calendar or content — unlike brand.ideas /
// campaign.ideas, which feed every campaign prompt. The only way out is
// "Setor ke chat": the ticked notes go to a Brainstorm thread (scoped to the
// same brand/campaign) where the AI maps what the owner seems to want and
// the better flow for it.
//
// Shown in the floating notes panel (js/notes-float.js), which repaints on
// every store change — so the open folder, the ticked selection, the
// half-typed note and the "keep typing" focus live here, outside the DOM.
//
// Shapes: note { id, text, folderId?, createdAt, sentAt? };
// folder { id, name, color }.
import { getBrand, updateBrand, getCampaign, updateCampaign } from "./store.js";
import { go } from "./nav-context.js";
import { icon } from "./icons.js";
import { escapeHtml as esc, qs, qsa, toast, openMenu, closeMenu } from "./dom.js";
import { confirmDialog, promptDialog } from "./modals.js";
import { t } from "./i18n.js";

const SCRATCH_CAP = 200;
const FOLDER_CAP = 30;
// Sticky-note paper colours; a folder gets the next one round.
export const NOTE_COLORS = ["yellow", "pink", "green", "blue", "orange", "purple"];
const ALL = "all";

const picked = new Map(); // scopeKey -> Set of note ids
const openFolder = new Map(); // scopeKey -> null (folder list) | "all" | folderId
const drafts = new Map(); // scopeKey -> text typed in the add box, not yet added
let refocus = null; // scopeKey whose add box should get focus after a repaint

const scopeKey = (brandId, campaignId) => (campaignId ? `c:${campaignId}` : `b:${brandId}`);
const ownerOf = (brandId, campaignId) => (campaignId ? getCampaign(campaignId) : getBrand(brandId));
const notesFor = (brandId, campaignId) => ownerOf(brandId, campaignId)?.scratch || [];
const foldersFor = (brandId, campaignId) => ownerOf(brandId, campaignId)?.scratchFolders || [];
function save(brandId, campaignId, patch) {
  if (patch.scratch) patch.scratch = patch.scratch.slice(-SCRATCH_CAP);
  if (campaignId) updateCampaign(campaignId, patch);
  else updateBrand(brandId, patch);
}
const pickedSet = (key) => {
  if (!picked.has(key)) picked.set(key, new Set());
  return picked.get(key);
};
const newId = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export function scratchCount(brandId, campaignId = null) {
  return notesFor(brandId, campaignId).length;
}

function folderListHTML(brandId, campaignId) {
  const notes = notesFor(brandId, campaignId);
  const folders = foldersFor(brandId, campaignId);
  const count = (id) => notes.filter((n) => n.folderId === id).length;
  const row = (id, name, color, n, menu) => `
    <div class="sn-folder">
      <button type="button" class="sn-folder-open" data-sn-open="${id}">
        <span class="sn-folder-icon sn-c-${color}">${icon("folder", { size: 15 })}</span>
        <span class="sn-folder-name">${esc(name)}</span>
        <span class="sn-folder-count">${n}</span>
        ${icon("chevronRight", { size: 14 })}
      </button>
      ${menu ? `<button type="button" class="sn-folder-menu" data-sn-fmenu="${id}" aria-label="${t("common.more")}">${icon("dots", { size: 14 })}</button>` : ""}
    </div>`;
  return `
    <div class="sn-folders">
      ${row(ALL, t("scratch.allNotes"), "yellow", notes.length, false)}
      ${folders.map((f) => row(f.id, f.name, f.color, count(f.id), true)).join("")}
    </div>
    <button type="button" class="sn-new-folder" data-sn-newfolder>${icon("plus", { size: 13 })}${t("scratch.newFolder")}</button>`;
}

function noteHTML(n, sel, folders, showFolder) {
  const folder = folders.find((f) => f.id === n.folderId);
  const color = folder?.color || "yellow";
  return `
    <div class="sn-note sn-c-${color} ${sel.has(n.id) ? "is-picked" : ""}" data-scratch-note="${n.id}">
      <label class="sn-check" title="${esc(t("scratch.pick"))}"><input type="checkbox" data-scratch-pick="${n.id}" ${sel.has(n.id) ? "checked" : ""} aria-label="${esc(t("scratch.pick"))}" /></label>
      <div class="sn-text" data-scratch-edit="${n.id}" title="${esc(t("scratch.editHint"))}">${esc(n.text)}</div>
      <div class="sn-meta">
        ${showFolder && folder ? `<span class="sn-tag">${esc(folder.name)}</span>` : ""}
        ${n.sentAt ? `<span class="sn-tag">${t("scratch.sent")}</span>` : ""}
        <span style="flex:1;"></span>
        <button type="button" class="sn-act" data-sn-move="${n.id}" aria-label="${t("scratch.move")}" title="${t("scratch.move")}">${icon("folder", { size: 12 })}</button>
        <button type="button" class="sn-act" data-scratch-del="${n.id}" aria-label="${t("common.delete")}" title="${t("common.delete")}">${icon("trash", { size: 12 })}</button>
      </div>
    </div>`;
}

export function scratchPadHTML({ brandId, campaignId = null }) {
  const key = scopeKey(brandId, campaignId);
  const all = notesFor(brandId, campaignId);
  const folders = foldersFor(brandId, campaignId);
  const sel = pickedSet(key);
  [...sel].forEach((id) => { if (!all.some((n) => n.id === id)) sel.delete(id); });
  let where = openFolder.has(key) ? openFolder.get(key) : null;
  if (where && where !== ALL && !folders.some((f) => f.id === where)) where = null;
  const hint = `<p class="scratch-hint">${t(campaignId ? "scratch.hintCampaign" : "scratch.hint")}</p>`;
  if (!where) return `<div class="scratch-pad" data-scratch-scope="${key}">${hint}${folderListHTML(brandId, campaignId)}</div>`;

  const folder = folders.find((f) => f.id === where);
  const notes = where === ALL ? all : all.filter((n) => n.folderId === where);
  const shownPicked = notes.filter((n) => sel.has(n.id)).length;
  return `
    <div class="scratch-pad" data-scratch-scope="${key}">
      <div class="sn-bar">
        <button type="button" class="sn-back" data-sn-back>${icon("chevronLeft", { size: 14 })}${t("scratch.folders")}</button>
        <b class="sn-bar-title">${esc(folder ? folder.name : t("scratch.allNotes"))}</b>
      </div>
      <textarea class="textarea scratch-add" rows="2" placeholder="${esc(t("scratch.placeholder"))}">${esc(drafts.get(key) || "")}</textarea>
      <div class="sn-grid">${notes.slice().reverse().map((n) => noteHTML(n, sel, folders, where === ALL)).join("") || `<p class="text-faint" style="font-size:12px;margin:6px 0;grid-column:1/-1;">${t("scratch.empty")}</p>`}</div>
      ${
        notes.length
          ? `<div class="scratch-foot">
              <button type="button" class="link" data-scratch-all style="font-size:12px;">${shownPicked === notes.length ? t("scratch.none") : t("scratch.all")}</button>
              <button type="button" class="btn btn-primary btn-sm" data-scratch-send ${sel.size ? "" : "disabled"}>${icon("send", { size: 12 })}${t("scratch.send", { n: sel.size })}</button>
            </div>`
          : ""
      }
    </div>`;
}

export function wireScratchPad(root, { brandId, campaignId = null, fromLabel = "", onSent = null }) {
  const key = scopeKey(brandId, campaignId);
  const pad = qs(`[data-scratch-scope="${key}"]`, root);
  if (!pad) return;
  const sel = pickedSet(key);
  const rewire = () => {
    const cur = qs(`[data-scratch-scope="${key}"]`, root);
    if (!cur) return;
    cur.outerHTML = scratchPadHTML({ brandId, campaignId });
    wireScratchPad(root, { brandId, campaignId, fromLabel, onSent });
  };
  const where = openFolder.get(key) || null;
  const notes = () => notesFor(brandId, campaignId);
  const folders = () => foldersFor(brandId, campaignId);

  // Folder list
  qsa("[data-sn-open]", pad).forEach((b) => b.addEventListener("click", () => { openFolder.set(key, b.dataset.snOpen); refocus = key; rewire(); }));
  qs("[data-sn-back]", pad)?.addEventListener("click", () => { openFolder.set(key, null); rewire(); });
  qs("[data-sn-newfolder]", pad)?.addEventListener("click", async () => {
    const name = (await promptDialog({ title: t("scratch.newFolder"), label: t("scratch.folderName"), placeholder: t("scratch.folderPh"), confirmLabel: t("scratch.create") }))?.trim();
    if (!name) return;
    const list = folders();
    if (list.length >= FOLDER_CAP) return;
    const folder = { id: newId("sf"), name: name.slice(0, 40), color: NOTE_COLORS[list.length % NOTE_COLORS.length] };
    openFolder.set(key, folder.id);
    refocus = key;
    save(brandId, campaignId, { scratchFolders: [...list, folder] });
  });
  qsa("[data-sn-fmenu]", pad).forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.snFmenu;
      const f = folders().find((x) => x.id === id);
      if (!f) return;
      const r = btn.getBoundingClientRect();
      const menu = openMenu(btn, { className: "sn-menu", top: r.bottom + 4, right: window.innerWidth - r.right });
      if (!menu) return;
      menu.innerHTML = `
        <button type="button" data-a="rename">${icon("edit", { size: 13 })}${t("scratch.rename")}</button>
        <div class="sn-colors">${NOTE_COLORS.map((c) => `<button type="button" class="sn-swatch sn-c-${c} ${f.color === c ? "is-on" : ""}" data-color="${c}" aria-label="${c}"></button>`).join("")}</div>
        <button type="button" class="danger" data-a="delete">${icon("trash", { size: 13 })}${t("scratch.deleteFolder")}</button>`;
      menu.querySelector('[data-a="rename"]').addEventListener("click", async () => {
        closeMenu();
        const name = (await promptDialog({ title: t("scratch.rename"), label: t("scratch.folderName"), value: f.name, confirmLabel: t("common.save") }))?.trim();
        if (name) save(brandId, campaignId, { scratchFolders: folders().map((x) => (x.id === id ? { ...x, name: name.slice(0, 40) } : x)) });
      });
      menu.querySelectorAll("[data-color]").forEach((sw) =>
        sw.addEventListener("click", () => {
          closeMenu();
          save(brandId, campaignId, { scratchFolders: folders().map((x) => (x.id === id ? { ...x, color: sw.dataset.color } : x)) });
        })
      );
      menu.querySelector('[data-a="delete"]').addEventListener("click", async () => {
        closeMenu();
        const ok = await confirmDialog({ title: t("scratch.deleteFolderTitle", { name: f.name }), message: t("scratch.deleteFolderBody"), confirmLabel: t("scratch.deleteFolder"), danger: true });
        if (!ok) return;
        // The notes stay (under "Semua coretan"); only the folder goes.
        save(brandId, campaignId, {
          scratchFolders: folders().filter((x) => x.id !== id),
          scratch: notes().map((n) => (n.folderId === id ? { ...n, folderId: null } : n)),
        });
      });
    })
  );

  // Inside a folder
  const add = qs(".scratch-add", pad);
  if (add && refocus === key) {
    refocus = null;
    add.focus();
  }
  add?.addEventListener("input", () => drafts.set(key, add.value));
  add?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    const text = add.value.trim();
    if (!text) return;
    refocus = key;
    drafts.delete(key);
    save(brandId, campaignId, { scratch: [...notes(), { id: newId("sc"), text: text.slice(0, 1000), folderId: where && where !== ALL ? where : null, createdAt: Date.now() }] });
  });
  qsa("[data-scratch-pick]", pad).forEach((cb) =>
    cb.addEventListener("change", () => {
      if (cb.checked) sel.add(cb.dataset.scratchPick);
      else sel.delete(cb.dataset.scratchPick);
      rewire();
    })
  );
  qs("[data-scratch-all]", pad)?.addEventListener("click", () => {
    const shown = notes().filter((n) => where === ALL || n.folderId === where);
    if (shown.every((n) => sel.has(n.id))) shown.forEach((n) => sel.delete(n.id));
    else shown.forEach((n) => sel.add(n.id));
    rewire();
  });
  qsa("[data-scratch-del]", pad).forEach((btn) =>
    btn.addEventListener("click", async () => {
      const id = btn.dataset.scratchDel;
      const note = notes().find((n) => n.id === id);
      if (note && note.text.length > 80 && !(await confirmDialog({ title: t("scratch.delTitle"), message: note.text.slice(0, 120), confirmLabel: t("common.delete"), danger: true }))) return;
      sel.delete(id);
      save(brandId, campaignId, { scratch: notes().filter((n) => n.id !== id) });
    })
  );
  qsa("[data-sn-move]", pad).forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.snMove;
      const note = notes().find((n) => n.id === id);
      const r = btn.getBoundingClientRect();
      const menu = openMenu(btn, { className: "sn-menu", top: r.bottom + 4, right: window.innerWidth - r.right });
      if (!menu || !note) return;
      const opts = [{ id: null, name: t("scratch.noFolder") }, ...folders()];
      menu.innerHTML = `<div class="sn-menu-label">${t("scratch.moveTo")}</div>${opts
        .map((f) => `<button type="button" data-to="${f.id || ""}" ${(note.folderId || null) === f.id ? "disabled" : ""}>${icon("folder", { size: 13 })}${esc(f.name)}</button>`)
        .join("")}`;
      menu.querySelectorAll("[data-to]").forEach((b) =>
        b.addEventListener("click", () => {
          closeMenu();
          const to = b.dataset.to || null;
          save(brandId, campaignId, { scratch: notes().map((n) => (n.id === id ? { ...n, folderId: to } : n)) });
          toast(t("scratch.moved"));
        })
      );
    })
  );
  // Click a note to edit it in place; blur or Enter saves, Esc cancels.
  qsa("[data-scratch-edit]", pad).forEach((el) =>
    el.addEventListener("click", () => {
      const id = el.dataset.scratchEdit;
      const note = notes().find((n) => n.id === id);
      if (!note || el.querySelector("textarea")) return;
      el.innerHTML = `<textarea class="scratch-editbox" rows="4">${esc(note.text)}</textarea>`;
      const box = el.querySelector("textarea");
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
      let done = false;
      const finish = (keep) => {
        if (done) return;
        done = true;
        const text = box.value.trim();
        if (keep && text && text !== note.text) save(brandId, campaignId, { scratch: notes().map((n) => (n.id === id ? { ...n, text: text.slice(0, 1000) } : n)) });
        else el.textContent = note.text;
      };
      box.addEventListener("click", (e) => e.stopPropagation());
      box.addEventListener("blur", () => finish(true));
      box.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); finish(false); }
      });
    })
  );
  qs("[data-scratch-send]", pad)?.addEventListener("click", () => {
    const list = notes();
    const chosen = list.filter((n) => sel.has(n.id));
    if (!chosen.length) return;
    const fl = folders();
    // Folder names ride along as headings — the owner already grouped them.
    const groups = new Map();
    chosen.forEach((n) => {
      const name = fl.find((f) => f.id === n.folderId)?.name || "";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(n);
    });
    const body = [...groups]
      .map(([name, ns]) => `${name ? `[${name}]\n` : ""}${ns.map((n) => `- ${n.text.replace(/\n+/g, " / ")}`).join("\n")}`)
      .join("\n\n");
    const seed = `${t("scratch.seedIntro")}\n${body}\n\n${t("scratch.seedAsk")}`;
    const now = Date.now();
    save(brandId, campaignId, { scratch: list.map((n) => (sel.has(n.id) ? { ...n, sentAt: now } : n)) });
    sel.clear();
    toast(t("scratch.sentToast", { n: chosen.length }));
    onSent?.();
    go(`#/brand/${brandId}/chat`, { campaignId, seed, intent: "plot", fromLabel });
  });
}
