// Video & posting (private preview, 2026-11-01): a piece on the Kalender can
// carry its video versions, the review decision and its Instagram slot, all
// in one drawer. Owner's ask: "di kalender brandlab di click bisa langsung
// upload, ada tanda mana yang sudah ter-upload", "UI se-simpel dan sejelas
// mungkin". First only his own account; since 2026-11-16 every account on
// the brands it owns (canUsePosting), Drive only — the Mac folder, posting
// from Brandlab, clients and trials stay his (isWepekaDesk). Every hook in
// js/views/calendar.js asks canUsePosting(brand) first and adds nothing otherwise.
//
// Stored on the content doc itself (no second calendar, no second list):
//   posting = {
//     versions: [{ id, n, status: "pending"|"revision"|"approved", at, by, drive: { id, link, folderId, ext, poster }, name, size, w, h, dur }],
//     finalId,                 // the approved version that gets posted
//     notes: [{ id, versionId, t, text, at, done }],
//     time: "19:00",           // WIB, the day is the piece's scheduleDate
//     ig: { state: "scheduled"|"published"|"failed", at, error, permalink },
//     fb: { state: "scheduled"|"waiting"|"sent"|"done"|"failed"|"skipped", page, permalink, error },  // the brand's Facebook Page, after Instagram
//     editor: { status: "requested"|"done"|"cancelled", requestedAt, version, message, noteIds },  // "Send to editor"
//     thumb: { status: "requested"|"done"|"cancelled", requestedAt, version, at, message, had, file },  // "Ask editor to make thumbnail"
//   }
// The files live in the person's OWN Google Drive (js/drive.js), in
// Brandlab / brand / month / piece folders — Brandlab keeps no copy (owner
// picked "yang hemat", 2026-11-01). They are read back from Drive to play.
// Scheduling still only marks the piece until the server worker exists; that
// worker will copy the final cut to a short-lived spot for Instagram to
// fetch (.claude/social-hub/ARSITEKTUR.md).
import { listBrands, getBrand, updateBrand, listContent, getContent, createContent, updateContent, setContentQuiet, localISODate, onChange as onStoreChange, isClientMember, brandRole, canEditBrand, scopeBrandId } from "./store.js";
import { isAdmin, currentUid } from "./account.js";
import { can } from "./permissions.js";
import { driveStatus, connectDrive, ensureFolders, uploadToDrive, driveVideoURL, driveImageURL, renameDriveFile } from "./drive.js";
import { outboxSupported, restoreOutbox, connectOutbox, grantOutbox, outboxFileURL, outboxThumb, writeDecisions, addToOutbox, writeRootFile } from "./outbox.js";
import { syncOutbox, versionIdOf, FORMAT_OF, editorVersionOf, editorVersionIndex, noteForEditor, writeEditorQueue } from "./outbox-sync.js";
import { ensureCodes, videoCode, codedPiece, trialFields, nextTrialLetter, brandCodePrefix } from "./video-codes.js";
import { outboxFile } from "./outbox.js";
import { syncFootageToMac, macName, wantsMac, wishMac, freshLook } from "./footage-mac.js";
import { sendToClient, cleanPreviews, keepFinalOnly, clientDecide, clientViewKey } from "./review-share.js";
import { postToInstagram, shareToFacebook, cancelInstagramPost } from "./ig-post.js";
import { icon } from "./icons.js";
import { qs, qsa, toast, escapeHtml, openMenu, closeMenu, resizeImageFile } from "./dom.js";
import { confirmDialog } from "./modals.js";
import { go } from "./nav-context.js";
import { t, getLang } from "./i18n.js";

const brandOfC = (x) => (typeof x === "string" ? getBrand(x) : x?.brandId ? getBrand(x.brandId) : x);

// Wepeka's own account: the whole desk — the Mac folder and its editor,
// posting to Instagram/Facebook from Brandlab, clients and their footage,
// trial cuts. Everything below that is only for it asks this.
export const isWepekaDesk = () => isAdmin(currentUid());

// Video & posting for every Brandlab account (owner, 2026-11-16: "aktivasi
// ke semua orang user brandlab biasa"): the Antrean Video and each piece's
// video page on the brands this account OWNS — cuts kept in its own Google
// Drive, every version, notes by the second, approve, the video codes,
// "Sudah tayang". Wepeka's account keeps it on every brand it sees. A brand
// shared through Kerja Tim stays its owner's (a teammate's Drive can't play
// the owner's files), and Wepeka's brands keep their Klien view below.
export function canUsePosting(x) {
  if (isWepekaDesk()) return true;
  const b = brandOfC(x);
  return !!b && !isAdmin(b.ownerId) && brandRole(b) === "owner";
}

// The brand's client (owner, 2026-11-09: "aku mau quatro buka lewat
// brandlab"): someone Wepeka invited as "Klien" in Kerja Tim sees the same
// Antrean Video and the same video page — only the cuts sent to them,
// played from their own Google Drive — and can write notes and approve,
// never upload, schedule or post (api/_review.js).
// A Kerja Tim editor on that brand sees it the same way (owner, 2026-11-10:
// "editor bisa lihat antrean video juga dan bisa upload kaya client ya,
// bedanya editor bisa edit brand dna dll"): watch, note, approve, download,
// send footage — and, unlike the client, still edits the brand everywhere
// else. A paused seat reads like a viewer (store.js brandRole), so not that.
// Since 2026-11-24 any owner's Klien sees the same ("aku mau ada pilihan
// role client juga"): only the cuts the team approved and sent to them.
export function isClientView(x) {
  const b = brandOfC(x);
  if (!b || isWepekaDesk()) return false;
  return isAdmin(b.ownerId) ? isClientMember(b) || brandRole(b) === "editor" : isClientMember(b);
}
export const canSeePosting = (x) => canUsePosting(x) || isClientView(x);
// Who makes the videos, in the client's words: Wepeka on Wepeka's brands,
// else the brand owner's name (any owner's Klien since 2026-11-24).
export function clientTeam(x = scopeBrandId()) {
  const b = brandOfC(x);
  if (!b || isAdmin(b.ownerId)) return "Wepeka";
  return b.ownerName || t("post.cl.theTeam");
}
const tc = (key, vars = {}) => t(key, { team: clientTeam(), ...vars });
// Video codes (KP-12) on the brands this account works on here — never
// written into somebody else's brand it only sees.
export const ensureVideoCodes = () => ensureCodes((b) => canUsePosting(b));
// Creator's Edit step: the editing-app tips stay above the video for
// everyone but Wepeka's account until the piece has its first cut.
export const editTipsToo = (c) => !isWepekaDesk() && !isClientView(c) && !postingOf(c).versions.length;
// The client who only reads ("Klien"): no "Sudah syuting / Sudah edit"
// buttons; an editor and a "Klien (bisa edit)" keep them.
export const isClientOnly = (x) => isClientView(x) && !canEditBrand(brandOfC(x));

// Whose Drive the cuts are read from. The client who connected theirs reads
// with their own token (js/drive.js); anyone else on the team (an editor, a
// second Klien) with a short-lived key from the server (api/review view-key).
// null = their own Drive.
const ownsClientDrive = (b) => isClientMember(b) && (!b.clientDrive?.uid || b.clientDrive.uid === currentUid());
const VIEW_KEYS = new Map(); // brandId → { get, drop }
function clientDriveKey(x) {
  const b = brandOfC(x);
  if (!b || !isClientView(b) || ownsClientDrive(b)) return null;
  if (!VIEW_KEYS.has(b.id)) {
    let tok = null, asking = null;
    VIEW_KEYS.set(b.id, {
      get() {
        if (tok && tok.exp > Date.now() + 60_000) return Promise.resolve(tok.value);
        asking ||= clientViewKey(b.id)
          .then((r) => { tok = { value: r.accessToken, exp: Date.now() + (r.expiresIn || 3600) * 1000 }; return tok.value; })
          .finally(() => { asking = null; });
        return asking;
      },
      drop() { tok = null; },
    });
  }
  return VIEW_KEYS.get(b.id);
}
// A cut, its still or a slide, from the client's Drive, for whoever is watching.
export const clientVideoURL = (x, fileId, opts = {}) => driveVideoURL(fileId, { ...opts, key: clientDriveKey(x) });
// Why the cuts can't play yet: "connect" (the client's own Drive isn't
// connected — they connect it here), "wait" (someone else's: the client
// hasn't connected theirs yet), or false.
export function clientDriveGap(x) {
  const b = brandOfC(x);
  if (!b) return false;
  if (ownsClientDrive(b)) return DRIVE.checked && !DRIVE.connected ? "connect" : false;
  return clientDriveLine(b).tone === "on" ? false : "wait";
}

// Instagram publishing by itself (owner, 2026-11-02: "bisa upload dari
// brandlab ke akunku … tinggal click2"): a piece whose cuts are in the Mac
// folder goes up through the server (js/ig-post.js → api/_igPost.js), at
// the hour or right away. Anything else still books the slot and is marked
// posted by hand.
// Since 2026-11-24 any brand connected through "Hubungkan akun Meta"
// (Pengaturan → Akun Meta) posts from Brandlab too: the cut from the
// owner's Google Drive, by whoever on the brand has Posting (the owner,
// Admin, Editor & Sosmed — js/permissions.js), the token on the server
// (api/instagram/post.js reads the vault).
export const metaPosts = (brand) => !!brand && brand.instagram?.connected === true && !!brand.instagram.igUserId
  && brand.instagram.status !== "reconnect" && can(brand, currentUid(), "publish", "publish");
// The cut that goes up from Drive: the approved one, or — working alone,
// where approving is never a step — the newest.
export function postCutOf(c) {
  const p = postingOf(c);
  const v = p.versions.find((x) => x.id === p.finalId && x.status === "approved") || (isSoloBrand(c) ? latestOf(p) : null);
  return v && !v.local && (v.drive?.id || v.driveFiles?.length) ? v : null;
}
const autoPost = (c) => (isWepekaDesk() && !!postingOf(c).local?.key) || (!isWepekaDesk() && metaPosts(getBrand(c.brandId)) && !!postCutOf(c));

// Wepeka's own account works from a folder on the Mac (js/outbox.js) instead
// of Google Drive (owner, 2026-11-01): Claude edits there, the results flow
// in by themselves (js/outbox-sync.js), and every decision is written back
// to the folder for Claude to read. Drive stays the way for everyone else
// once Video & posting opens up.
export const usesOutbox = () => isWepekaDesk() && outboxSupported();
const OUT = { checked: false, connected: false, needsPermission: false, name: "" };
let outboxCheck = null;
export function ensureOutbox(force = false) {
  if (!outboxCheck || force) outboxCheck = restoreOutbox().then((s) => { Object.assign(OUT, s, { checked: true }); watchIndex(); return OUT; });
  return outboxCheck;
}
export const outboxInfo = () => ({ ...OUT });
// Both open a Chrome prompt, so both come straight from a click.
export async function linkOutbox() {
  try {
    Object.assign(OUT, OUT.needsPermission ? await grantOutbox() : await connectOutbox(), { checked: true });
  } catch { return OUT; }
  watchIndex();
  if (OUT.connected) {
    const r = await syncOutbox();
    toast(t("post.local.synced", { n: r.posts }));
    copyCutsForPhone().catch(() => {});
  }
  return OUT;
}

// The decisions, as Claude reads them in the post's folder (brandlab.json).
export function decisionsFor(c) {
  const p = postingOf(c);
  const fileOf = (id) => p.versions.find((v) => v.id === id)?.local?.file || "";
  return {
    about: "Ditulis oleh Brandlab: keputusan Winson untuk post ini. Baca sebelum membuat versi berikutnya.",
    code: videoCode(c),
    trialOf: c.trialOf ? videoCode(getContent(c.trialOf)) : "",
    trialReel: !!p.trialReel,
    status: postingState(c),
    statusLabel: stateLabel(c),
    title: c.title || "",
    date: c.scheduleDate || "",
    time: p.time || "",
    type: p.type || "",
    caption: c.caption || "",
    cover: p.cover || "",
    final: fileOf(p.finalId),
    versions: p.versions.map((v) => ({ file: v.local?.file || v.name || "", status: v.status })),
    // id: put it in post.json "done" once fixed. from: "winson" or "klien".
    notes: (p.notes || []).map((n) => noteForEditor(p, n)),
    client: p.client ? { file: fileOf(p.client.versionId), status: p.client.status, name: p.client.name || "" } : null,
    // "Send to editor": { status, requestedAt, version, message, noteIds } — the same
    // request permintaan-editor.json lists while it is "requested".
    editor: p.editor || null,
    // "Ask editor to make thumbnail": { status, requestedAt, version, at (seconds), message } —
    // answered by a thumbnail-N.jpg in this folder.
    thumbnail: p.thumb || null,
    updatedAt: new Date().toISOString(),
  };
}
// Written after every decision here, and — through the store watcher below —
// whenever one arrives from elsewhere (the client's review link, another
// device), each folder only when its content changed.
const written = new Map(); // contentId → what brandlab.json last said
export function writeBack(contentId) {
  const c = getContent(contentId);
  const key = c?.posting?.local?.key;
  if (!key || !OUT.connected) return;
  const { updatedAt, ...data } = decisionsFor(c);
  written.set(contentId, JSON.stringify(data));
  writeDecisions(key, { ...data, updatedAt }).catch((e) => { written.delete(contentId); console.warn("[posting] brandlab.json not written", e); });
}
function writeBackChanged() {
  for (const b of listBrands()) {
    for (const c of listContent(b.id)) {
      if (!c.posting?.local?.key) continue;
      const { updatedAt, ...data } = decisionsFor(c);
      // As it was when this tab started — except a request for the editor
      // sent from the phone, which the folder may not have yet.
      if (!written.has(c.id) && c.posting.editor?.status !== "requested" && c.posting.thumb?.status !== "requested") { written.set(c.id, JSON.stringify(data)); continue; }
      if (written.get(c.id) !== JSON.stringify(data)) writeBack(c.id);
    }
  }
}

// Where a piece's files go in the folder: the one it already has, or
// "<brand>/<code> <date> <title>" for Claude to make.
// Chrome's folder reader skips a name ending in "." or a space, so a title
// like '"Logo itu…" Nggak.' made a folder Brandlab never saw: those go too.
export const cleanName = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 90).replace(/[.\s]+$/, "");
export function folderKeyOf(c) {
  const p = postingOf(c);
  if (p.local?.key) return p.local.key;
  // Where its raw footage already landed (js/footage-mac.js): the cuts go there too.
  if (c.footageMac) return c.footageMac;
  const brand = getBrand(c.brandId);
  const used = listContent(c.brandId).map((x) => x.posting?.local?.key).find(Boolean);
  const brandFolder = used ? used.split("/")[0] : cleanName(brand?.name) || "Brand";
  return `${brandFolder}/${cleanName([videoCode(c), c.scheduleDate, c.title || t("common.untitled")].filter(Boolean).join(" "))}`;
}

// daftar-video.json at the top of the folder: every coded piece, so the
// owner can say "KP-12" to Claude and Claude knows what and where.
export function videoIndex() {
  const items = [];
  for (const b of listBrands()) {
    for (const c of listContent(b.id).filter((x) => x.videoNo && codedPiece(x))) {
      const p = postingOf(c);
      const parent = c.trialOf ? getContent(c.trialOf) : null;
      items.push({
        code: videoCode(c), brand: b.name, title: c.title || "",
        date: c.scheduleDate || "", time: p.time || "", type: p.type || (c.format || "").toLowerCase(),
        status: postingState(c), statusLabel: stateLabel(c), step: c.status,
        caption: c.caption || "", script: (parent || c).script || "", idea: (parent || c).idea || "",
        folder: folderKeyOf(c), hasFolder: !!p.local?.key,
        trialOf: parent ? videoCode(parent) : "",
        trials: listContent(b.id).filter((x) => x.trialOf === c.id).map(videoCode).filter(Boolean),
        trialReel: !!p.trialReel,
        versions: p.versions.map((v) => ({ file: v.local?.file || v.name || "", status: v.status })),
        final: p.versions.find((v) => v.id === p.finalId)?.local?.file || "",
        cover: p.cover || "",
        // The shoot's raw clips from the client's crew (in their Drive); in
        // <folder>/footage/ once "Salin ke Mac" was pressed (footageToMac).
        footage: (c.footage?.files || []).map((f) => macName(f.name)),
        footageToMac: !!(c.footage?.files?.length && wantsMac(c.id)),
      });
    }
  }
  items.sort((a, b) => `${a.date || "9999"}${a.time}${a.code}`.localeCompare(`${b.date || "9999"}${b.time}${b.code}`));
  return {
    about: "Ditulis oleh Brandlab. Semua konten Instagram dari Creator dengan kodenya. Winson menyebut kode (mis. KP-12): cari di sini, lalu taruh hasil edit di 'folder' (buat kalau belum ada). Huruf di belakang (KP-12B) = video trial. 'footage' = video mentah hasil syuting tim klien (bahan editnya), disimpan di Google Drive klien. Baru disalin ke '<folder>/footage/' kalau diminta: tombol 'Salin ke Mac' di Antrean Video > Footage (per video). Kalau folder footage belum ada/belum lengkap, minta Winson tekan tombol itu (atau tekan sendiri lewat Chrome), tunggu sampai 'Semua N di Mac'.",
    items,
  };
}
let lastIndex = "";
let indexTimer = null;
let indexWatch = null;
function writeIndexSoon() {
  clearTimeout(indexTimer);
  indexTimer = setTimeout(() => {
    if (!OUT.connected || !isWepekaDesk()) return;
    writeBackChanged();
    writeEditorQueue();
    copyFootageSoon();
    const data = videoIndex();
    const sig = JSON.stringify(data);
    if (sig === lastIndex) return;
    lastIndex = sig;
    writeRootFile("daftar-video.json", JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2))
      .catch((e) => { lastIndex = ""; console.warn("[posting] daftar-video.json not written", e); });
  }, 1200);
}
// The shoot's raw clips from the client's crew, into a piece's folder
// (js/footage-mac.js) — only the pieces asked for with "Salin ke Mac"
// (owner, 2026-11-13: "Copy pas mau edit"); the rest stay in the client's
// Drive. A wish on a piece that has gone out since is let go, so a folder
// cleared after posting doesn't fill up again.
const askedHere = new Set(); // asked in this tab: copied even when already out
export function copiesFootageToMac(c) {
  if (!c?.footage?.files?.length) return false;
  if (askedHere.has(c.id)) return true;
  if (!wantsMac(c.id)) return false;
  if (postingState(c) !== "published") return true;
  wishMac(c.id, false); // out now: let it go
  return false;
}
const withFootage = () => listBrands().flatMap((b) => listContent(b.id).filter(copiesFootageToMac));
// "Salin ke Mac" (Antrean → Footage, the Syuting step): from a click, since
// a folder not connected yet opens Chrome's prompt.
export async function copyFootageToMac(contentId) {
  const c = getContent(contentId);
  if (!c?.footage?.files?.length || !isWepekaDesk()) return false;
  if (!OUT.connected) await linkOutbox();
  if (!OUT.connected) return false;
  askedHere.add(c.id);
  if (postingState(c) !== "published") wishMac(c.id);
  freshLook(c.id);
  copyFootageSoon();
  writeIndexSoon(); // daftar-video.json: footageToMac
  return true;
}
function copyFootageSoon() {
  if (!OUT.connected || !isWepekaDesk() || !withFootage().length) return;
  syncFootageToMac(withFootage, {
    keyOf: folderKeyOf,
    remember: (c, key) => { if (!c.posting?.local?.key && c.footageMac !== key) setContentQuiet(c.id, { footageMac: key }); },
  }).catch((e) => console.warn("[posting] footage to Mac", e));
}
function watchIndex() {
  if (!OUT.connected || !isWepekaDesk()) return;
  writeIndexSoon();
  if (!indexWatch) indexWatch = onStoreChange(writeIndexSoon);
}

// One more cut of the same piece to try as an Instagram trial reel: KP-12B,
// KP-12C … Its own videos, cover, caption and time; same day to start.
export function createTrial(contentId) {
  const base = getContent(contentId);
  const parent = base?.trialOf ? getContent(base.trialOf) || base : base;
  if (!parent || !isWepekaDesk()) return null;
  ensureVideoCodes();
  const letter = nextTrialLetter(parent.id, listContent(parent.brandId, { includeArchived: true, includeDeleted: true }));
  if (!letter) return null;
  const c = createContent(parent.brandId, { ...trialFields(parent, letter, parent.title || t("common.untitled")), posting: { versions: [], notes: [], type: "reels", time: postingOf(parent).time || "", trialReel: true } });
  if (c) toast(t("post.trial.made", { code: videoCode(c) }));
  return c;
}

// Copies a code for the chat with Claude.
export async function copyCode(code) {
  if (!code) return;
  try { await navigator.clipboard.writeText(code); } catch { /* the toast still shows it */ }
  toast(t("post.code.copied", { code }));
}

// Is this person's Google Drive connected? Asked once, then kept for the tab.
const DRIVE = { checked: false, connected: false, email: "", reason: "" };
let driveCheck = null;
function checkDrive(force = false) {
  if (!driveCheck || force) {
    driveCheck = driveStatus().then((s) => {
      Object.assign(DRIVE, { checked: true, connected: s.connected, email: s.email || "", reason: s.reason || "" });
      return DRIVE;
    });
  }
  return driveCheck;
}

// Connecting leaves the page for Google's consent screen; this note says
// which piece to reopen when Google sends the person back.
const AFTER_DRIVE = "posting:afterDrive";
async function goConnect(contentId) {
  try { sessionStorage.setItem(AFTER_DRIVE, JSON.stringify({ contentId: contentId || "", at: Date.now() })); } catch { /* still connects */ }
  try {
    await connectDrive(location.hash);
  } catch (e) {
    toast(e.code === "setup" ? t("post.drive.setup") : e.code === "inactive" ? t("post.drive.inactive") : t("post.toast.uploadFailed"), "error");
  }
}
// The signed-in person's own Drive (a client keeps the cuts sent to them there).
export const driveInfo = () => ({ ...DRIVE });
export const ensureDrive = (force = false) => checkDrive(force);
export const connectOwnDrive = () => goConnect("");
async function askConnect(contentId) {
  const ok = await confirmDialog({ title: t("post.drive.askTitle"), message: t("post.drive.body"), confirmLabel: t("post.drive.cta") });
  if (ok) goConnect(contentId);
}

// Uploads running in this tab, by piece: { label, pct }. A big video takes
// minutes, so the drawer can be closed meanwhile; closing the TAB would cut
// it off, hence the leave warning.
const UPLOADS = new Map();
const uploadWatchers = new Set();
const tellWatchers = (contentId, done) => uploadWatchers.forEach((fn) => fn(contentId, done));
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!UPLOADS.size) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

const STATE_COLOR = {
  none: "var(--text-faint)", review: "#3B9BFF", client: "#2EC4B6", revision: "#FF9F3D", ready: "#A974FF",
  scheduled: "#FFC83D", published: "#36D27F", failed: "#FF5F57",
};
const STATE_ICON = { none: "upload", review: "eye", client: "users", revision: "refresh", ready: "check", scheduled: "clock", published: "instagram", failed: "x" };

// A piece can hold only part of `posting`: the server saved just the
// client's Drive folder when the crew started uploading footage on a piece
// with no cut yet (2026-11-10, QKC-30), and Create stopped loading. So the
// two lists are always there, whatever else is.
const postingOf = (c) => {
  const p = c?.posting;
  if (!p) return { versions: [], notes: [] };
  if (Array.isArray(p.versions) && Array.isArray(p.notes)) return p;
  return { ...p, versions: Array.isArray(p.versions) ? p.versions : [], notes: Array.isArray(p.notes) ? p.notes : [] };
};
const latestOf = (p) => p.versions[p.versions.length - 1] || null;
const versionLabel = (v) => (v.n ? t("post.v.revision", { n: v.n }) : t("post.v.original"));

export function postingState(c) {
  const p = postingOf(c);
  if (isClientView(c)) return clientStateOf(c, p);
  if (p.ig?.state === "published" || (c.status === "published" && p.versions.length)) return "published";
  if (p.ig?.state === "failed") return "failed";
  if (p.ig?.state === "scheduled") return "scheduled";
  const last = latestOf(p);
  if (!last) return "none";
  // Sent to the client's review link and not answered yet.
  if (p.client?.status === "waiting" && p.client.versionId === last.id) return "client";
  // Someone working alone reviews their own cut: the newest one is simply
  // the one to post, no "Perlu dicek" to click through first.
  if (last.status === "pending") return isSoloBrand(c) ? "ready" : "review";
  if (p.finalId && p.versions.some((v) => v.id === p.finalId && v.status === "approved")) return "ready";
  return "revision";
}

// A brand nobody else works on: no Kerja Tim member and not Wepeka's own
// desk (owner, 2026-11-24: "Untuk pengguna individu, jangan memaksakan
// workflow approval yang tidak diperlukan"). Approving stays possible, it's
// just never a step they have to take.
export function isSoloBrand(x) {
  // A piece names its brand; anything else must already be a brand (an id
  // or the doc) — a bare piece without brandId is never taken for one.
  const b = typeof x === "string" ? getBrand(x) : x?.brandId ? getBrand(x.brandId) : x && "ownerId" in x ? x : null;
  return !!b && !isWepekaDesk() && !(Array.isArray(b.memberIds) && b.memberIds.length);
}

// The words follow the review flow: Sedang diedit → Menunggu review →
// Perlu revisi → Review ulang → Disetujui → Siap upload → Terjadwal →
// Sudah tayang. The keys (and the colours, filters) stay the same.
function stateLabel(c, key = postingState(c)) {
  if (isClientView(c)) return t(`post.cst.${key}`);
  const p = postingOf(c);
  if (key === "none" && c?.status === "editing") return t("post.state.editing");
  if (key === "review" && (latestOf(p)?.n || 0) > 0) return t("post.state.rereview");
  if (key === "ready") return t(c?.scheduleDate && String(c?.caption || "").trim() ? "post.state.readyUpload" : isSoloBrand(c) ? "post.state.readySolo" : "post.state.ready");
  return t(`post.state.${key}`, { time: p.time || "" }).trim();
}

// Where a piece stands for its client: sent and waiting on them, being
// fixed, approved, then Wepeka's schedule and post; before any cut is sent,
// "being made".
function clientStateOf(c, p) {
  if (p.ig?.state === "published" || c.status === "published") return "published";
  if (p.ig?.state === "scheduled") return "scheduled";
  const cl = p.client;
  if (!cl || !p.versions.some((v) => v.id === cl.versionId)) return "none";
  return cl.status === "waiting" ? "client" : cl.status === "approved" ? "ready" : "revision";
}

// The piece as its client sees it: only the cuts sent to them, each with
// its copy in their Drive, and its state from their side.
function clientPosting(p) {
  const cl = p.client;
  const versions = p.versions.filter((v) => p.previews?.[v.id]?.drive?.length).map((v) => {
    const pv = p.previews[v.id];
    const status = v.id === cl?.versionId ? ({ waiting: "pending", revision: "revision", approved: "approved" }[cl.status] || "pending") : v.id === p.finalId ? "approved" : "revision";
    return { ...v, local: undefined, url: undefined, kind: pv.kind || "video", status, drive: { id: pv.drive[0].id }, driveFiles: pv.drive, poster: pv.poster || "" };
  });
  return { ...p, versions, finalId: versions.some((v) => v.id === p.finalId) ? p.finalId : null };
}
export const clientCutCount = (c) => clientPosting(postingOf(c)).versions.length;
// The still the client's gallery shows: the cover of the cut sent last.
export function clientPosterOf(c) {
  const p = postingOf(c);
  const pv = p.previews?.[p.client?.versionId] || p.previews?.[p.finalId];
  return pv?.poster || (pv?.kind && pv.kind !== "video" ? pv.drive?.[0]?.id : "") || "";
}

// Only Instagram pieces, and not old posts that went out before this existed.
const tracked = (c) => canUsePosting(c) && (!c.platform || /instagram/i.test(c.platform)) && !(c.status === "published" && !postingOf(c).versions.length);

// Calendar card (week view, a phone's picked day): one line under the step.
export function postingBadgeHTML(c) {
  if (!tracked(c)) return "";
  if (UPLOADS.has(c.id)) return `<span class="pst-badge is-uploading" style="--pst:${STATE_COLOR.review}">${icon("upload", { size: 11 })}${t("post.state.uploading")}</span>`;
  const key = postingState(c);
  const n = postingOf(c).versions.length;
  const code = videoCode(c);
  return `<span class="pst-badge is-${key}" style="--pst:${STATE_COLOR[key]}">${code ? `<em class="pst-badge-code">${escapeHtml(code)}</em>` : ""}${icon(STATE_ICON[key], { size: 11 })}${escapeHtml(stateLabel(c, key))}${n > 1 ? `<b>${n}</b>` : ""}</span>`;
}

// Month grid chip: just the coloured mark, the title says the rest.
export function postingDotHTML(c) {
  if (!tracked(c)) return "";
  const key = postingState(c);
  if (key === "none") return "";
  return `<span class="pst-dot" style="--pst:${STATE_COLOR[key]}" title="${escapeHtml(stateLabel(c, key))}">${icon(STATE_ICON[key], { size: 9 })}</span>`;
}

// For the Antrean Video page (js/views/posting-queue.js).
export const versionLabelOf = (v) => (v ? versionLabel(v) : "");
export const latestVersion = (c) => latestOf(postingOf(c));
export const stateColor = (key) => STATE_COLOR[key];
export const stateLabelOf = (c) => stateLabel(c);

// Sent to the client or not (owner, 2026-11-14: "aku bingung di brandlab
// mana yang sudah aku kirim client yang mana yang belum, bisa kamu kasih
// tanda?"). A cut counts as sent while it's the one the client holds or its
// copy still sits in their Drive. Wepeka's side only, on brands with a Klien,
// until the piece is scheduled or posted.
const sentToClient = (p, v) => !!v && (p.client?.versionId === v.id || !!p.previews?.[v.id]);
export function clientSendMark(c) {
  if (!c || isClientView(c) || !canUsePosting(c)) return null;
  const p = postingOf(c);
  const last = latestOf(p);
  if (!last || (!p.client && !clientsOf(getBrand(c.brandId)).length)) return null;
  if (["scheduled", "published", "failed"].includes(postingState(c))) return null;
  const cl = p.client;
  const held = cl ? p.versions.find((x) => x.id === cl.versionId) : null;
  if (held && held.id === last.id) {
    const st = cl.status === "approved" ? "approved" : cl.status === "revision" ? "revision" : "waiting";
    return { key: "sent", st, label: t(`post.mark.${st}`), title: t(cl.sentAt ? "post.mark.sentTitle" : "post.mark.sentTitleNoTime", { label: versionLabel(last), when: cl.sentAt ? timeLabel(cl.sentAt) : "" }) };
  }
  if (held) return { key: "newer", label: t("post.mark.newer", { label: versionLabel(last) }), title: t(cl.sentAt ? "post.mark.newerTitle" : "post.mark.newerTitleNoTime", { label: versionLabel(held), when: cl.sentAt ? timeLabel(cl.sentAt) : "" }) };
  return { key: "none", label: t("post.mark.none"), title: t("post.mark.noneTitle") };
}

// ---------------------------------------------------------------- editor
// "Send to editor" (owner, 2026-11-02): his notes on the newest cut go to
// Claude, who edits the piece and drops the next version in the Mac folder.
// Stored as posting.editor = { status: "requested"|"done"|"cancelled",
// requestedAt, version, message, noteIds, doneAt|cancelledAt }; Claude reads
// it from permintaan-editor.json and brandlab.json (js/outbox-sync.js).
// Only his account ever sees any of it — checked here again, on its own.
const EDITOR_COLOR = { pending: "#FF2E93", delivered: "#3B9BFF" };

// The chip for the drawer and the gallery tile, in place of the state:
// waiting at the editor, then "Revisi N masuk" until that cut is decided.
export function editorChip(c) {
  if (!isWepekaDesk()) return null;
  const p = postingOf(c);
  const ed = p.editor;
  if (ed?.status === "requested") return { key: "pending", label: t("post.editor.pending"), color: EDITOR_COLOR.pending, icon: "clock" };
  const last = latestOf(p);
  if (ed?.status === "done" && last?.status === "pending" && p.versions.indexOf(last) > editorVersionIndex(p.versions, ed.version)) {
    return { key: "delivered", label: t("post.editor.delivered", { n: last.n }), color: EDITOR_COLOR.delivered, icon: "check" };
  }
  return null;
}

const openNotesOf = (p, v) => (p.notes || []).filter((n) => n.versionId === v.id && !n.done).sort(byTime);

// Under the newest cut's notes: the button, its small form (a message, the
// open notes ticked), or — once sent — where it stands and "Batalkan".
// Only for cuts in the Mac folder, which is where Claude delivers.
export function editorBlockHTML(c, ui = {}) {
  if (!isWepekaDesk() || !c) return "";
  const p = postingOf(c);
  const last = latestOf(p);
  if (!p.local?.key || !last?.local || postingState(c) === "published") return "";
  if (p.editor?.status === "requested") {
    return `<div class="pst-editor">
        <span class="pst-badge" style="--pst:${EDITOR_COLOR.pending}">${icon("clock", { size: 11 })}${t("post.editor.pending")}</span>
        <button type="button" class="pst-link" id="pst-ed-undo">${t("post.editor.cancel")}</button>
        ${OUT.connected ? "" : `<p class="pst-hint">${icon("info", { size: 13 })}${t("post.editor.phoneHint")}</p>`}
      </div>`;
  }
  const send = (key, id) => `<button type="button" class="cl-cta pst-cta" id="${id}"><span>${t(key)}</span><span class="cl-cta-dot pst-dot-editor">${icon("send", { size: 16 })}</span></button>`;
  if (!ui.editorOpen) return `<div class="pst-editor">${send("post.editor.send", "pst-ed-open")}</div>`;
  const draft = ui.edDraft || { msg: "", off: [] };
  const open = openNotesOf(p, last);
  return `<div class="pst-editor-form">
      <label class="pst-sub" for="pst-ed-msg">${t("post.editor.msg")}</label>
      <textarea class="textarea" id="pst-ed-msg" rows="2" placeholder="${escapeHtml(t("post.editor.msgPh"))}">${escapeHtml(draft.msg)}</textarea>
      ${open.length ? `<span class="pst-sub">${t("post.editor.notes")}</span>
      <div class="pst-ed-notes">${open.map((n) => `<label class="pst-ed-note"><input type="checkbox" data-ed-note="${escapeHtml(n.id)}" ${draft.off.includes(n.id) ? "" : "checked"}><b>${noteWhen(n)}</b><span>${escapeHtml(n.text)}</span></label>`).join("")}</div>`
        : `<p class="pst-hint">${icon("info", { size: 13 })}${t("post.editor.noNotes")}</p>`}
      <div class="pst-decide">${send("post.editor.confirm", "pst-ed-send")}<button type="button" class="btn btn-ghost btn-sm" id="pst-ed-close">${t("common.cancel")}</button></div>
    </div>`;
}

// Saved like every other decision (Firestore, brandlab.json through the
// drawer's repaint) and listed for Claude at once when the folder is here;
// from the phone, the Mac lists it on its next look at the folder.
function sendToEditor(contentId, { message, noteIds }) {
  const p = postingOf(getContent(contentId));
  const last = latestOf(p);
  if (!isWepekaDesk() || !p.local?.key || !last?.local) return false;
  const editor = { status: "requested", requestedAt: new Date().toISOString(), version: editorVersionOf(last), message, noteIds };
  // Asking for a new cut is asking for changes: an unchecked cut stops waiting in "Perlu dicek".
  const versions = p.versions.map((x) => (x.id === last.id && x.status === "pending" ? { ...x, status: "revision" } : x));
  updateContent(contentId, { posting: { ...p, versions, editor } });
  writeEditorQueue();
  toast(t(OUT.connected ? "post.editor.sent" : "post.editor.phoneHint"));
  return true;
}

function cancelEditor(contentId) {
  const p = postingOf(getContent(contentId));
  if (!isWepekaDesk() || p.editor?.status !== "requested") return;
  updateContent(contentId, { posting: { ...p, editor: { ...p.editor, status: "cancelled", cancelledAt: new Date().toISOString() } } });
  writeEditorQueue();
  toast(t("post.editor.cancelled"));
}

// "Ask editor to make thumbnail" (owner, 2026-11-02), next to the covers:
// the same queue as Send to editor, answered by a thumbnail-N.jpg in the
// folder, which becomes the chosen cover (js/outbox-sync.js planSync).
export function thumbBlockHTML(c, ui = {}) {
  if (!isWepekaDesk() || !c) return "";
  const p = postingOf(c);
  const last = latestOf(p);
  if (!p.local?.key || last?.kind !== "video" || postingState(c) === "published") return "";
  if (p.thumb?.status === "requested") {
    return `<div class="pst-editor is-thumb">
        <span class="pst-badge" style="--pst:${EDITOR_COLOR.pending}">${icon("clock", { size: 11 })}${t("post.thumb.pending")}</span>
        <button type="button" class="pst-link" id="pst-th-undo">${t("post.editor.cancel")}</button>
        ${OUT.connected ? "" : `<p class="pst-hint">${icon("info", { size: 13 })}${t("post.editor.phoneHint")}</p>`}
      </div>`;
  }
  if (!ui.thumbOpen) return `<button type="button" class="btn btn-secondary btn-sm pst-th-ask" id="pst-th-open">${icon("image", { size: 14 })}${t("post.thumb.ask")}</button>`;
  const draft = ui.thDraft || { msg: "", frame: true };
  return `<div class="pst-editor-form">
      <label class="pst-sub" for="pst-th-msg">${t("post.editor.msg")}</label>
      <textarea class="textarea" id="pst-th-msg" rows="2" placeholder="${escapeHtml(t("post.thumb.msgPh"))}">${escapeHtml(draft.msg)}</textarea>
      <label class="pst-ed-note"><input type="checkbox" id="pst-th-frame" ${draft.frame ? "checked" : ""}><span>${t("post.thumb.useFrame", { time: `<b id="pst-th-time">${clock(ui.t)}</b>` })}</span></label>
      <div class="pst-decide"><button type="button" class="cl-cta pst-cta" id="pst-th-send"><span>${t("post.editor.confirm")}</span><span class="cl-cta-dot pst-dot-editor">${icon("send", { size: 16 })}</span></button><button type="button" class="btn btn-ghost btn-sm" id="pst-th-close">${t("common.cancel")}</button></div>
    </div>`;
}

function askThumbnail(contentId, { message, at, vid }) {
  const p = postingOf(getContent(contentId));
  const last = latestOf(p);
  if (!isWepekaDesk() || !p.local?.key || !last?.local) return false;
  // The frame is from the cut on screen; without one, the newest.
  const from = p.versions.find((x) => x.id === vid && x.local && x.kind === "video") || last;
  const thumb = { status: "requested", requestedAt: new Date().toISOString(), version: editorVersionOf(from), at, message, had: [...(p.covers || [])] };
  updateContent(contentId, { posting: { ...p, thumb } });
  writeEditorQueue();
  toast(t(OUT.connected ? "post.thumb.sent" : "post.editor.phoneHint"));
  return true;
}

function cancelThumbnail(contentId) {
  const p = postingOf(getContent(contentId));
  if (!isWepekaDesk() || p.thumb?.status !== "requested") return;
  updateContent(contentId, { posting: { ...p, thumb: { ...p.thumb, status: "cancelled", cancelledAt: new Date().toISOString() } } });
  writeEditorQueue();
  toast(t("post.thumb.cancelled"));
}

// One decision on one cut — the review mode's buttons. Same rules as the
// drawer: approving makes it the cut that gets posted; asking for changes
// can carry a note at a moment of the video. Written back for Claude.
export function decide(contentId, vid, verdict, note) {
  const c = getContent(contentId);
  if (!c) return;
  const p = postingOf(c);
  const next = { ...p, versions: p.versions.map((x) => (x.id === vid ? { ...x, status: verdict === "approve" ? "approved" : "revision" } : x)) };
  if (verdict === "approve") {
    markFinalInDrive(p, p.finalId, vid);
    next.finalId = vid;
  } else if (p.finalId === vid) next.finalId = null;
  if (note?.text) next.notes = [...(p.notes || []), { id: `n${Date.now().toString(36)}`, versionId: vid, t: Math.floor(note.t || 0), text: note.text, at: Date.now(), done: false }];
  updateContent(contentId, { posting: next });
  writeBack(contentId);
  if (verdict === "approve") keepClientFinal(contentId);
}

// Approved here: in the client's Google Drive only that cut stays — older
// ones are deleted, as when the client approves on their link (owner,
// 2026-11-09). After the save has had a moment to reach the server.
function keepClientFinal(contentId) {
  const p = postingOf(getContent(contentId));
  if (!p.finalId || !Object.entries(p.previews || {}).some(([vid]) => vid !== p.finalId)) return;
  setTimeout(() => keepFinalOnly(contentId).catch((e) => console.warn("[posting] client Drive not tidied", e)), 2500);
}

// Creator's Edit step (owner, 2026-11-02: "di Creator fase edit diarahkan
// ke sana juga, biar gak bingung"): one card for this piece's video — its
// code to tell Claude, where it stands, how many cuts — that opens the same
// drawer as the Kalender and Antrean Video. Wherever canSeePosting says.
export function editStepVideoHTML(c) {
  if (!c || !canSeePosting(c)) return "";
  const client = isClientView(c);
  if (!client) ensureVideoCodes();
  const fresh = getContent(c.id) || c;
  const key = postingState(fresh);
  const p = client ? clientPosting(postingOf(fresh)) : postingOf(fresh);
  const code = videoCode(fresh);
  const last = latestOf(p);
  const line = client ? (last ? t("post.edit.cuts", { n: p.versions.length, label: escapeHtml(versionLabel(last)) }) : t("post.cl.emptyTitle")) : key === "none"
    ? t(isWepekaDesk() ? "post.edit.none" : "post.edit.noneOwn", { code: escapeHtml(code || "") })
    : [t("post.edit.cuts", { n: p.versions.length, label: escapeHtml(versionLabel(last)) }), last?.changeNote ? escapeHtml(last.changeNote) : ""].filter(Boolean).join(" · ");
  return `<div class="pst-edit" style="--pst:${STATE_COLOR[key]}">
      <span class="pst-edit-img" data-pst-edit-thumb="${escapeHtml(fresh.id)}">${icon(key === "none" ? "upload" : "play", { size: 20 })}</span>
      <div class="pst-edit-text">
        <div class="pst-edit-top">${code ? `<button type="button" class="pst-code is-small" data-copy-code="${escapeHtml(code)}" title="${escapeHtml(t("post.code.copy"))}">${escapeHtml(code)}${icon("copy", { size: 11 })}</button>` : ""}<span class="pst-badge is-${key}" style="--pst:${STATE_COLOR[key]}">${icon(STATE_ICON[key], { size: 11 })}${escapeHtml(stateLabel(fresh, key))}</span></div>
        <b>${t("post.edit.title")}</b>
        <small>${line}</small>
      </div>
      <button type="button" class="cl-cta pst-cta pst-edit-go" data-pst-edit-open="${escapeHtml(fresh.id)}"><span>${t(key === "none" ? "post.edit.openEmpty" : "post.edit.open")}</span><span class="cl-cta-dot">${icon("arrowRight", { size: 16 })}</span></button>
    </div>`;
}
export function wireEditStepVideo(root, { onChange } = {}) {
  qsa("[data-pst-edit-open]", root).forEach((b) => b.addEventListener("click", () => openPosting({ contentId: b.dataset.pstEditOpen, onChange })));
  qsa(".pst-edit [data-copy-code]", root).forEach((b) => b.addEventListener("click", () => copyCode(b.dataset.copyCode)));
  qsa("[data-pst-edit-thumb]", root).forEach((el) => {
    const c = getContent(el.dataset.pstEditThumb);
    if (!c) return;
    const show = (src) => { if (src && el.isConnected) { el.style.backgroundImage = `url("${src}")`; el.classList.add("has-img"); } };
    // The client: the cover of the cut sent to them, from their Drive.
    if (isClientView(c)) {
      const poster = !clientDriveGap(c) ? clientPosterOf(c) : "";
      if (poster) clientVideoURL(c, poster).then(show).catch(() => {});
      return;
    }
    const key = c.posting?.local?.key;
    const last = latestOf(postingOf(c));
    if (key && last?.local && OUT.connected) {
      outboxThumb(key, last, c.posting.cover).then(show).catch(() => {});
    } else if (usesOutbox() && key && !OUT.checked) {
      ensureOutbox().then(() => { if (OUT.connected && el.isConnected) wireEditStepVideo(root, { onChange }); });
    } else if (drivePosterOf(c)) {
      // Everyone else: the still saved next to the cut in their own Drive.
      driveImageURL(drivePosterOf(c)).then(show).catch(() => {});
    }
  });
}

// The row the calendar adds to a day's menu.
export const uploadMenuItemHTML = (brandId) => (canUsePosting(brandId) ? `<button data-posting-upload>${icon("upload", { size: 15 })}${t("post.menu.upload")}</button>` : "");

// ---------------------------------------------------------------- review

export function reviewQueue() {
  return listBrands().filter((b) => canUsePosting(b)).flatMap((b) => listContent(b.id).filter((c) => postingState(c) === "review").map((c) => ({ brand: b, c })));
}

export function reviewButtonHTML() {
  const n = reviewQueue().length;
  return n ? `<button type="button" class="btn btn-secondary pst-review-btn" id="pst-review" aria-label="${escapeHtml(t("post.review.btn", { n }))}">${icon("eye", { size: 15 })}<b>${n}</b><span class="pst-review-l">${t("post.review.label")}</span></button>` : "";
}

// The calendar's hook: the review list, and — once per page load — picking
// up where the person was after Google's Drive consent screen.
let resumed = false;
let lastSync = 0;
export function wirePosting(root, { brandId, onChange } = {}) {
  if (!canUsePosting(brandId)) return;
  ensureVideoCodes();
  if (usesOutbox() && Date.now() - lastSync > 30_000) {
    lastSync = Date.now();
    ensureOutbox().then((o) => { if (o.connected) syncOutbox().then(() => copyCutsForPhone()).catch(() => {}); });
  }
  if (!resumed) {
    resumed = true;
    let note = null;
    try { note = JSON.parse(sessionStorage.getItem(AFTER_DRIVE) || "null"); sessionStorage.removeItem(AFTER_DRIVE); } catch { /* nothing to resume */ }
    if (note && Date.now() - note.at < 30 * 60 * 1000) {
      checkDrive(true).then((d) => {
        toast(d.connected ? t("post.drive.connected", { email: d.email }) : t("post.drive.notConnected"), d.connected ? "success" : "error");
        if (d.connected && note.contentId && getContent(note.contentId)) openPosting({ contentId: note.contentId, onChange });
      });
    }
  }
  const btn = qs("#pst-review", root);
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = btn.getBoundingClientRect();
    const menu = openMenu(btn, { className: "pst-review-menu", top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 320)) });
    if (!menu) return;
    const list = reviewQueue().sort((a, b) => (a.brand.id === brandId ? -1 : 0) - (b.brand.id === brandId ? -1 : 0));
    menu.innerHTML = `<div class="pst-review-head">${t("post.review.head")}</div>${list.length ? list.map(({ brand, c }) => {
      const last = latestOf(postingOf(c));
      return `<button data-pst-open="${escapeHtml(c.id)}">
        <span class="pst-review-av" style="background:${escapeHtml(brand.color || "var(--accent)")}">${escapeHtml((brand.name || "?")[0])}</span>
        <span class="pst-review-text"><b>${escapeHtml(c.title || t("common.untitled"))}</b><small>${escapeHtml(brand.name)} · ${escapeHtml(versionLabel(last))} · ${escapeHtml(dayLabel(c.scheduleDate))}</small></span>
      </button>`;
    }).join("") : `<div class="pst-review-empty">${t("post.review.empty")}</div>`}<div class="menu-divider"></div><button data-pst-queue>${icon("layers", { size: 15 })}${t("pq.openPage")}</button>`;
    menu.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-pst-queue]")) { closeMenu(); location.hash = `#/brand/${brandId}/content/antrean`; return; }
      const id = ev.target.closest("[data-pst-open]")?.dataset.pstOpen;
      if (!id) return;
      closeMenu();
      openPosting({ contentId: id });
    });
  });
}

// ---------------------------------------------------------------- upload

function pickFile(onPick) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/mp4,video/quicktime,video/*";
  input.addEventListener("change", () => { if (input.files[0]) onPick(input.files[0]); });
  input.click();
}

const isVideoFile = (f) => !!f && (/^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name || ""));

// What the browser can read about the file before anything is sent — and,
// when asked, a small still of it (a second in) for the Antrean gallery.
// Never holds the upload up: a file the browser can't draw gives no still.
function probe(file, { still = false } = {}) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    let meta = { w: 0, h: 0, dur: 0 };
    let over = false;
    const done = (shot = null) => { if (over) return; over = true; clearTimeout(timer); URL.revokeObjectURL(url); resolve(still ? { ...meta, still: shot } : meta); };
    const timer = setTimeout(() => done(), 6000);
    v.preload = still ? "auto" : "metadata";
    v.muted = true;
    v.playsInline = true;
    v.onloadedmetadata = () => {
      meta = { w: v.videoWidth, h: v.videoHeight, dur: v.duration };
      if (!still || !v.videoWidth) { done(); return; }
      v.currentTime = Math.min(1, (v.duration || 0) / 3);
    };
    v.onseeked = () => {
      try {
        const w = 360, h = Math.round((w * v.videoHeight) / v.videoWidth);
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        cv.getContext("2d").drawImage(v, 0, 0, w, h);
        cv.toBlob((b) => done(b), "image/jpeg", 0.75);
      } catch { done(); }
    };
    v.onerror = () => done();
    v.src = url;
  });
}

const MAX_BYTES = 300 * 1048576; // Instagram's Reels limit
const extOf = (name) => ((name || "").match(/\.([a-z0-9]{2,4})$/i)?.[1] || "mp4").toLowerCase();

// Where a piece's videos sit in Drive: Brandlab / brand / "2026-11 November"
// / "04 Nov · title". Names Drive can't hold (slashes and the like) become "-".
export function driveFolderPath(brand, c, lang = getLang()) {
  const clean = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 90);
  const d = c?.scheduleDate ? new Date(`${c.scheduleDate}T00:00:00`) : null;
  const loc = lang === "en" ? "en-US" : "id-ID";
  const month = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")} ${d.toLocaleDateString(loc, { month: "long" })}` : t("post.drive.noDate");
  const day = d ? `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleDateString(loc, { month: "short" }).replace(".", "")} · ` : "";
  return ["Brandlab", clean(brand?.name) || "Brand", month, clean(`${day}${c?.title || t("common.untitled")}`)];
}
// "Revisi 2.mp4", and "Revisi 2 (FINAL).mp4" for the cut that gets posted.
export const driveFileName = (v, ext = "mp4", final = false) => `${versionLabel(v)}${final ? " (FINAL)" : ""}.${ext}`;

async function storeVideo(file, { content, n, onProgress }) {
  const { still, ...meta } = await probe(file, { still: true });
  const ext = extOf(file.name);
  const folderId = await ensureFolders(driveFolderPath(getBrand(content.brandId), content));
  const up = await uploadToDrive(file, { name: driveFileName({ n }, ext), folderId, onProgress });
  // Its still, next to it ("Revisi 1 · cover.jpg"), for the gallery tile.
  let poster = "";
  if (still) {
    try { poster = (await uploadToDrive(still, { name: `${versionLabel({ n })} · cover.jpg`, folderId })).id || ""; } catch (e) { console.warn("[posting] still not saved", e); }
  }
  return { ...meta, drive: { id: up.id, link: up.webViewLink || "", folderId, ext, ...(poster ? { poster } : {}) }, name: file.name, size: file.size, type: file.type };
}

// The still a piece shows in the gallery, from its own Drive: the approved
// cut's, else the newest one's.
export function drivePosterOf(c) {
  const p = postingOf(c);
  const v = p.versions.find((x) => x.id === p.finalId) || latestOf(p);
  return v && !v.local ? v.drive?.poster || "" : "";
}

// Keeps "(FINAL)" on the one file that gets posted. Best effort: a name
// that didn't change in Drive never blocks a decision here.
function markFinalInDrive(p, oldId, newId) {
  const name = (v, final) => driveFileName(v, v.drive?.ext || "mp4", final);
  const was = p.versions.find((x) => x.id === oldId);
  const now = p.versions.find((x) => x.id === newId);
  if (was?.drive?.id && oldId !== newId) renameDriveFile(was.drive.id, name(was, false)).catch(() => {});
  if (now?.drive?.id && oldId !== newId) renameDriveFile(now.drive.id, name(now, true)).catch(() => {});
}

export function formatIssues(v) {
  const out = [];
  if (v.w && v.h && Math.abs(v.w / v.h - 9 / 16) > 0.02) out.push(t("post.check.ratio", { w: v.w, h: v.h }));
  if (v.dur > 900) out.push(t("post.check.long"));
  if (v.size > 300 * 1048576) out.push(t("post.check.big"));
  if (v.type && !/mp4|quicktime/.test(v.type)) out.push(t("post.check.type", { type: v.type.replace("video/", "").toUpperCase() }));
  return out;
}

const fileProblem = (f) => (!isVideoFile(f) ? t("post.toast.notVideo") : f.size > MAX_BYTES ? t("post.check.big") : "");

// A video dropped into Brandlab on the owner's account is copied into the
// Outbox folder, next to Claude's cuts, so the folder stays the one place.
async function addLocalVersion(contentId, file, onChange) {
  const c = getContent(contentId);
  const p = postingOf(c);
  const key = folderKeyOf(c);
  const [brandFolder, folder] = key.split("/");
  const name = `v${p.versions.length + 1}.${extOf(file.name)}`;
  const label = versionLabel({ n: p.versions.length });
  UPLOADS.set(contentId, { label, pct: 0 });
  tellWatchers(contentId, true);
  onChange?.();
  try {
    const meta = await probe(file);
    await addToOutbox({ brandFolder, folder, file, name, manifest: p.local ? null : { code: videoCode(c), title: c.title || "", date: c.scheduleDate || "", time: p.time || "19:00", type: p.type || "reels", caption: c.caption || "" } });
    const fresh = getContent(contentId);
    const fp = postingOf(fresh);
    const v = { id: versionIdOf(name), n: fp.versions.length, status: "pending", at: Date.now(), by: "you", kind: "video", local: { file: name }, ...meta, name: file.name, size: file.size, type: file.type };
    const status = ["idea", "draft", "production", "scheduled"].includes(fresh.status) ? "editing" : fresh.status;
    updateContent(contentId, { status, posting: { ...fp, local: { key }, type: fp.type || "reels", versions: [...fp.versions, v], ig: fp.ig?.state === "scheduled" ? null : fp.ig } });
    toast(t("post.toast.uploaded", { label }));
    return v;
  } catch (e) {
    console.warn("[posting] copy to folder failed", e);
    toast(t("post.toast.uploadFailed"), "error");
    return null;
  } finally {
    UPLOADS.delete(contentId);
    tellWatchers(contentId, true);
    onChange?.();
  }
}

// A cover picked from the video or from an image: into the post's folder,
// then chosen.
async function addCover(contentId, blob, name, repaint) {
  const key = postingOf(getContent(contentId)).local?.key;
  if (!key) return;
  const [brandFolder, folder] = key.split("/");
  try {
    await addToOutbox({ brandFolder, folder, file: blob, name });
    const p = postingOf(getContent(contentId));
    updateContent(contentId, { posting: { ...p, covers: [...new Set([...(p.covers || []), name])], cover: name } });
    toast(t("post.cover.saved"));
    repaint();
  } catch (e) {
    console.warn("[posting] cover not saved", e);
    toast(t("post.toast.uploadFailed"), "error");
  }
}

async function addVersion(contentId, file, onChange) {
  const problem = fileProblem(file);
  if (problem) { toast(problem, "error"); return null; }
  if (UPLOADS.has(contentId)) { toast(t("post.toast.busy"), "error"); return null; }
  const c = getContent(contentId);
  if (!c) return null;
  if (usesOutbox()) {
    if (!(await ensureOutbox()).connected) { toast(t("post.local.needFolder"), "error"); return null; }
    return addLocalVersion(contentId, file, onChange);
  }
  if (!(await checkDrive()).connected) { askConnect(contentId); return null; }
  const n = postingOf(c).versions.length;
  const versionId = `v${Date.now().toString(36)}`;
  const label = versionLabel({ n });
  UPLOADS.set(contentId, { label, pct: 0 });
  tellWatchers(contentId, true);
  onChange?.();
  try {
    const stored = await storeVideo(file, {
      content: c, n,
      onProgress: (f) => { const u = UPLOADS.get(contentId); if (u) { u.pct = f; tellWatchers(contentId, false); } },
    });
    const v = { id: versionId, n, status: "pending", at: Date.now(), by: "you", ...stored };
    // Re-read: notes or a decision may have landed while this uploaded.
    const fresh = getContent(contentId);
    const p = postingOf(fresh);
    // A new video means the piece is at least being edited (Creator's "Edit"
    // step), and a new version always waits for a fresh look — a slot
    // already booked on Instagram is let go until it's approved again.
    const status = ["idea", "draft", "production", "scheduled"].includes(fresh.status) ? "editing" : fresh.status;
    updateContent(contentId, { status, posting: { ...p, versions: [...p.versions, v], ig: p.ig?.state === "scheduled" ? null : p.ig } });
    toast(t("post.toast.uploaded", { label }));
    return v;
  } catch (e) {
    console.warn("[posting] upload failed", e);
    toast(t("post.toast.uploadFailed"), "error");
    return null;
  } finally {
    UPLOADS.delete(contentId);
    tellWatchers(contentId, true);
    onChange?.();
  }
}

// "Upload video" on a day: a new piece named after the file, on that day.
// The drawer opens right away so the upload's progress is in view.
export function uploadForDate({ brandId, dateISO, file, onChange }) {
  if (!canUsePosting(brandId)) return;
  if (dateISO < localISODate()) { toast(t("post.toast.past"), "error"); return; }
  const go = async (f) => {
    const problem = fileProblem(f);
    if (problem) { toast(problem, "error"); return; }
    if (usesOutbox() ? !(await ensureOutbox()).connected : !(await checkDrive()).connected) {
      if (usesOutbox()) toast(t("post.local.needFolder"), "error");
      else askConnect("");
      return;
    }
    const title = (f.name || "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || t("common.untitled");
    const c = createContent(brandId, { title, scheduleDate: dateISO, status: "editing", platform: "Instagram", format: "Reels" });
    if (!c) return;
    openPosting({ contentId: c.id, onChange });
    addVersion(c.id, f, onChange);
  };
  file ? go(file) : pickFile(go);
}

// A video file dragged from the desktop onto a calendar day.
export function handleFileDrop(e, { brandId, dateISO, onChange }) {
  if (!canUsePosting(brandId)) return false;
  const file = [...(e.dataTransfer?.files || [])].find(isVideoFile);
  if (!file) return false;
  e.preventDefault();
  uploadForDate({ brandId, dateISO, file, onChange });
  return true;
}

// ---------------------------------------------------------------- drawer

const two = (n) => String(n).padStart(2, "0");
const clock = (s) => `${Math.floor((s || 0) / 60)}:${two(Math.floor((s || 0) % 60))}`;
// A note for the whole video (owner, 2026-11-02: "speed 1.15x semua") has no
// second: t is null. It comes first in the list and never moves the player.
const isWhole = (n) => n.t == null;
const byTime = (a, b) => (isWhole(a) ? -1 : a.t) - (isWhole(b) ? -1 : b.t);
const noteWhen = (n) => (isWhole(n) ? t("post.note.whole") : clock(n.t));
function dayLabel(dateISO) {
  if (!dateISO) return "";
  const d = new Date(`${dateISO}T00:00:00`);
  return d.toLocaleDateString(getLang() === "en" ? "en-US" : "id-ID", { weekday: "short", day: "numeric", month: "short" });
}
const igHandleOf = (brand) => {
  const own = (brand?.instagram?.username || "").replace(/^@/, "");
  if (own || !brand) return own;
  // A brand made later for an account another brand is connected to (winkhsin) — same rule as api/_igPost.js accountFor.
  const name = String(brand.name || "").trim().toLowerCase();
  const other = listBrands().find((b) => b.id !== brand.id && b.instagram?.accessToken && String(b.instagram.username || "").replace(/^@/, "").toLowerCase() === name);
  return other ? String(other.instagram.username).replace(/^@/, "") : "";
};

// The Facebook Page a post is also shared to (owner, 2026-11-07: "tiap aku
// upload via brandlab … link ke facebook juga") — same rule as
// api/_igPost.js facebookFor: the brand's own Page, or the one on the
// owner's brand that holds the same Instagram. The switch is remembered per
// brand (brand.shareFacebook, on unless turned off).
const handleKey = (x) => String(x || "").replace(/^@/, "").trim().toLowerCase();
export const fbPageOf = (brand) => {
  if (!brand) return null;
  // Connected through "Hubungkan akun Meta": its own Page or none (the
  // server posts to the Page that connection picked, nothing else).
  if (brand.instagram?.connected === true) return brand.facebook?.connected && brand.facebook.pageId ? { name: brand.facebook.pageName || "Facebook", brandId: brand.id } : null;
  const ok = (b) => (b?.facebook?.pageAccessToken && b.facebook.pageId ? { name: b.facebook.pageName || "Facebook", brandId: b.id } : null);
  if (ok(brand)) return ok(brand);
  const names = [brand.name, brand.instagram?.username, igHandleOf(brand)].map(handleKey).filter(Boolean);
  return ok(listBrands().find((b) => b.id !== brand.id && b.ownerId === brand.ownerId && ok(b) && names.includes(handleKey(b.instagram?.username))));
};
const shareFb = (brand) => !!fbPageOf(brand) && brand.shareFacebook !== false;

// One piece = one page (owner, 2026-11-02: "terlalu banyak dan redundant …
// enaknya diapakan"): the video, its revisions and its posting live on the
// piece's own page in Creator — the Edit step holds the video, the Upload
// step the posting — instead of a drawer of their own. Every way in (the
// Antrean gallery, the Kalender, the review list, a video dropped on a day)
// opens that page.
export function openPosting({ contentId, step = "edit", from = "" } = {}) {
  const c = getContent(contentId);
  if (!c || !canSeePosting(c)) return;
  go(`#/brand/${c.brandId}/content/creator/${c.id}`, { contentId: c.id, step, ...(from ? { fromLabel: from } : {}) });
}

// The slot the piece's page leaves for it: part "video" (Edit) or "post"
// (Upload). Wherever canSeePosting says.
export const postingMountHTML = (c, part = "video") => (c && canSeePosting(c) ? `<div class="pst pst-embed" data-pst-mount="${escapeHtml(c.id)}" data-part="${part}"></div>` : "");
export function wirePostingMounts(root, { onChange } = {}) {
  qsa("[data-pst-mount]:not(.is-mounted)", root).forEach((el) => {
    el.classList.add("is-mounted");
    mountPosting(el, { contentId: el.dataset.pstMount, part: el.dataset.part, onChange });
  });
}

// The panel, live inside its slot until the slot leaves the page: an
// upload's progress, the client's answer, the editor's next cut.
function mountPosting(root, { contentId, part = "video", onChange } = {}) {
  const c0 = getContent(contentId);
  if (!c0 || !canSeePosting(c0)) return;
  const client = isClientView(c0);
  const p0 = client ? clientPosting(postingOf(c0)) : postingOf(c0);
  const ui = { vid: (client ? p0.versions.find((v) => v.id === p0.client?.versionId) : p0.versions.find((v) => v.id === p0.finalId))?.id || latestOf(p0)?.id || null, compare: false, t: 0, part, onChange, client };
  const repaint = () => { if (root.isConnected) paint(root, contentId, ui, repaint); if (!client) writeBack(contentId); onChange?.(); };
  // Upload progress: the bar moves in place (a playing video keeps playing);
  // start and finish repaint, and a finished upload is shown next to the
  // one before it.
  let count = postingOf(c0).versions.length;
  const watch = (id, done) => {
    if (!root.isConnected) { uploadWatchers.delete(watch); return; }
    if (id !== contentId) return;
    if (!done) {
      const u = UPLOADS.get(contentId);
      const pct = Math.round((u?.pct || 0) * 100);
      const fill = qs("#pst-progress-fill", root), num = qs("#pst-progress-pct", root);
      if (fill) fill.style.width = `${pct}%`;
      if (num) num.textContent = `${pct}%`;
      return;
    }
    const p = postingOf(getContent(contentId));
    if (p.versions.length > count) { ui.vid = latestOf(p).id; ui.compare = p.versions.length > 1; }
    count = p.versions.length;
    paint(root, contentId, ui, repaint);
  };
  uploadWatchers.add(watch);
  // A decision from elsewhere (the client's link, Claude's next cut, another
  // device) shows up here — unless the person is typing.
  const sig = () => { const c = getContent(contentId); const p = postingOf(c); return JSON.stringify([p.client, Object.keys(p.previews || {}), p.versions.map((v) => [v.id, v.status, v.changeNote]), (p.notes || []).map((n) => [n.id, n.done]), p.ig?.state, p.ig?.permalink, p.fb?.state, p.fb?.permalink, p.finalId, p.editor?.status, p.thumb?.status, p.cover, (p.covers || []).length, p.time, c?.scheduleDate, c?.caption]); };
  let seen = sig();
  const offStore = onStoreChange(() => {
    if (!root.isConnected) { offStore(); return; }
    const now = sig();
    if (now === seen) return;
    seen = now;
    if (root.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    paint(root, contentId, ui, repaint);
  });
  paint(root, contentId, ui, repaint);
  if (usesOutbox()) { if (!OUT.checked) ensureOutbox().then(() => { if (root.isConnected) paint(root, contentId, ui, repaint); }); }
  else if (!DRIVE.checked) checkDrive().then(() => { if (root.isConnected) paint(root, contentId, ui, repaint); });
}

function progressHTML(up) {
  const pct = Math.round((up.pct || 0) * 100);
  return `<div class="pst-progress" role="status">
      <div class="pst-progress-row">${icon("upload", { size: 14 })}<span>${t("post.up.progress", { label: escapeHtml(up.label) })}</span><b id="pst-progress-pct">${pct}%</b></div>
      <div class="pst-progress-bar"><i id="pst-progress-fill" style="width:${pct}%"></i></div>
      <small>${t("post.up.keepOpen")}</small>
    </div>`;
}

function paint(root, contentId, ui, repaint) {
  const c = getContent(contentId);
  if (!c) return;
  if (ui.client) { paintClient(root, c, ui, repaint); return; }
  const brand = getBrand(c.brandId);
  const p = postingOf(c);
  const key = postingState(c);
  const v = p.versions.find((x) => x.id === ui.vid) || latestOf(p);
  if (v) ui.vid = v.id;
  const idx = v ? p.versions.indexOf(v) : -1;
  const prev = idx > 0 ? p.versions[idx - 1] : null;
  if (!prev) ui.compare = false;
  const handle = igHandleOf(brand);
  const up = UPLOADS.get(contentId);
  const local = usesOutbox();
  const needSource = !up && (local ? OUT.checked && !OUT.connected : DRIVE.checked && !DRIVE.connected);
  const isVideo = !!v && (!v.local || v.kind === "video");
  if (!isVideo) ui.compare = false;
  const code = videoCode(c);
  const ed = editorChip(c);
  const restorePlayers = keepPlayers(root);
  // Listeners on a kept <video> belong to one paint only.
  ui.ac?.abort();
  ui.ac = new AbortController();

  // Upload step: only the posting — the day, hour, caption, posted.
  if (ui.part === "post") {
    root.innerHTML = postHTML(c, p, key, handle, POSTING.get(contentId));
    wire(root, contentId, ui, repaint);
    return;
  }

  // Edit step: the page above already says the title, day and step; this
  // starts with the code to tell the editor, where the video stands, trials.
  root.innerHTML = `
    <div class="pst-embed-top">
      ${code ? `<button type="button" class="pst-code" data-copy-code="${escapeHtml(code)}" title="${escapeHtml(t("post.code.copy"))}">${escapeHtml(code)}${icon("copy", { size: 12 })}</button>` : ""}
      ${ed ? `<span class="pst-badge is-editor" style="--pst:${ed.color}">${icon(ed.icon, { size: 11 })}${escapeHtml(ed.label)}</span>` : `<span class="pst-badge is-${key}" style="--pst:${STATE_COLOR[key]}">${icon(STATE_ICON[key], { size: 11 })}${escapeHtml(stateLabel(c, key))}</span>`}
      ${p.time ? `<span class="pst-embed-when">${icon("clock", { size: 12 })}${escapeHtml(p.time)}</span>` : ""}
    </div>
    ${isWepekaDesk() ? trialsHTML(c) : ""}

    <div class="pst-grid ${v ? "has-video" : ""}">
    <section class="pst-block pst-video" id="pst-drop">
      ${needSource ? (local ? localConnectHTML() : connectHTML()) : v ? `
        <div class="pst-players ${ui.compare ? "is-compare" : ""}">
          ${ui.compare ? playerHTML(prev, "A", c) : ""}${playerHTML(v, ui.compare ? "B" : "", c)}
        </div>
        ${isVideo ? `<div class="pst-ctl">
          <button type="button" class="pst-play" id="pst-play" aria-label="${t("post.play")}">${icon("play", { size: 16 })}</button>
          <div class="pst-seek-wrap"><input type="range" id="pst-seek" min="0" max="${Math.max(1, v.dur || 10)}" step="0.05" value="0" aria-label="${t("post.play")}">${marksHTML(p, v)}</div>
          <span class="pst-time" id="pst-time">0:00 / ${clock(v.dur)}</span>
        </div>
        <div id="pst-format">${formatLineHTML(v)}</div>` : ""}
        ${up ? progressHTML(up) : ""}
        ${prev && isVideo ? `<button type="button" class="pst-link" id="pst-compare">${icon(ui.compare ? "x" : "layers", { size: 13 })}${ui.compare ? t("post.compare.off") : t("post.compare.on", { label: versionLabel(prev) })}</button>` : ""}
      ` : up ? progressHTML(up) : `
        <div class="pst-empty">
          <span class="pst-empty-art">${icon("upload", { size: 26 })}</span>
          <b>${t("post.empty.title")}</b>
          <span>${t(isTouch() ? "post.empty.bodyPhone" : "post.empty.body")}</span>
          <button type="button" class="cl-cta pst-cta" id="pst-add"><span>${t("post.empty.pick")}</span><span class="cl-cta-dot">${icon("upload", { size: 16 })}</span></button>
        </div>`}
    </section>

    <div class="pst-side">
    ${v ? decideHTML(p, v, prev, ui, v.id === latestOf(p).id ? editorBlockHTML(c, ui) : "", isVideo && !needSource) : ""}
    ${v && !needSource ? `<section class="pst-block pst-more">
      ${versionsHTML(p, v, up, { sent: !!(p.client || clientsOf(brand).length) })}
      ${ownDownloadHTML(c, v)}
      ${extrasHTML(p, v, c, ui)}
      ${v.drive ? whereHTML(brand, c, v) : v.local ? localWhereHTML(p, v) : ""}
    </section>` : ""}
    ${v && (isWepekaDesk() || clientsOf(brand).length) ? clientHTML(c, p, v, key) : ""}
    </div>
    </div>
  `;
  restorePlayers();
  wire(root, contentId, ui, repaint);
  qsa("[data-own-dl]", root).forEach((btn) => btn.addEventListener("click", () => {
    const cur = getContent(contentId);
    const x = cur && postingOf(cur).versions.find((y) => y.id === btn.dataset.ownDl);
    if (x) downloadCut(cur, x, btn);
  }));
}

// The client's page (same layout as Wepeka's): the cuts sent to them from
// their own Drive, the revision column to note and approve, every version
// to compare. No uploads, covers, editor or posting.
function paintClient(root, c, ui, repaint) {
  const p = clientPosting(postingOf(c));
  const key = postingState(c);
  const v = p.versions.find((x) => x.id === ui.vid) || p.versions.find((x) => x.id === p.client?.versionId) || latestOf(p);
  if (v) ui.vid = v.id;
  const idx = v ? p.versions.indexOf(v) : -1;
  const prev = idx > 0 ? p.versions[idx - 1] : null;
  const isVideo = v?.kind === "video";
  if (!prev || !isVideo) ui.compare = false;
  const code = videoCode(c);
  const gap = clientDriveGap(c);
  const restorePlayers = keepPlayers(root);
  ui.ac?.abort();
  ui.ac = new AbortController();
  if (ui.part === "post") {
    root.innerHTML = clientPostHTML(c, postingOf(c), key, { gap });
    wire(root, c.id, ui, repaint);
    wireClientFiles(root, c);
    return;
  }
  root.innerHTML = `
    <div class="pst-embed-top">
      ${code ? `<button type="button" class="pst-code" data-copy-code="${escapeHtml(code)}" title="${escapeHtml(t("post.code.copy"))}">${escapeHtml(code)}${icon("copy", { size: 12 })}</button>` : ""}
      <span class="pst-badge is-${key}" style="--pst:${STATE_COLOR[key]}">${icon(STATE_ICON[key], { size: 11 })}${escapeHtml(stateLabel(c, key))}</span>
      ${p.time ? `<span class="pst-embed-when">${icon("clock", { size: 12 })}${escapeHtml(p.time)}</span>` : ""}
    </div>
    <div class="pst-grid ${v ? "has-video" : ""}">
    <section class="pst-block pst-video">
      ${gap ? clientGapHTML(gap) : v ? `
        <div class="pst-players ${ui.compare ? "is-compare" : ""}">
          ${ui.compare ? playerHTML(prev, "A", c) : ""}${playerHTML(v, ui.compare ? "B" : "", c)}
        </div>
        ${isVideo ? `<div class="pst-ctl">
          <button type="button" class="pst-play" id="pst-play" aria-label="${t("post.play")}">${icon("play", { size: 16 })}</button>
          <div class="pst-seek-wrap"><input type="range" id="pst-seek" min="0" max="${Math.max(1, v.dur || 10)}" step="0.05" value="0" aria-label="${t("post.play")}">${marksHTML(p, v)}</div>
          <span class="pst-time" id="pst-time">0:00 / ${clock(v.dur)}</span>
        </div>` : ""}
        ${prev && isVideo ? `<button type="button" class="pst-link" id="pst-compare">${icon(ui.compare ? "x" : "layers", { size: 13 })}${ui.compare ? t("post.compare.off") : t("post.compare.on", { label: versionLabel(prev) })}</button>` : ""}
      ` : `
        <div class="pst-empty">
          <span class="pst-empty-art">${icon("clock", { size: 26 })}</span>
          <b>${t("post.cl.emptyTitle")}</b>
          <span>${tc("post.cl.emptyBody")}</span>
        </div>`}
    </section>
    <div class="pst-side">
    ${v && !gap ? decideHTML(p, v, prev, ui, "", isVideo) : ""}
    ${v && !gap ? `<section class="pst-block pst-more">
      ${versionsHTML(p, v, null, { add: false })}
      <div class="pst-cl-dl">${clientDownloadHTML(v)}</div>
      ${clientDriveKey(c) ? `<p class="pst-where">${icon("folder", { size: 13 })}<span><b>${t("post.cl.whereTeam")}</b> Wepeka Brandlab › ${escapeHtml(getBrand(c.brandId)?.name || "")}</span></p>` : `<p class="pst-where">${icon("folder", { size: 13 })}<span><b>${t("post.cl.where")}</b> Wepeka Brandlab › ${escapeHtml(getBrand(c.brandId)?.name || "")}</span><a href="https://drive.google.com/file/d/${escapeHtml(v.drive.id)}/view" target="_blank" rel="noopener">${t("post.drive.open")}</a></p>`}
    </section>` : ""}
    </div>
    </div>`;
  restorePlayers();
  wire(root, c.id, ui, repaint);
  wireClientFiles(root, c);
}

// The client takes the file along (owner, 2026-11-09: "ganti aja ke
// download file … yang uploadnya kalau di akunku aja"): posting from
// Brandlab stays on Wepeka's own account; a client downloads the cut from
// their own Google Drive, named by its code ("QN-7 · FINAL.mp4").
const clientExt = (name, kind) => (String(name || "").match(/\.([a-z0-9]{2,4})$/i)?.[1] || (kind === "video" ? "mp4" : "jpg")).toLowerCase();
function clientFiles(c, v) {
  const base = videoCode(c) || String(c.title || "video").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 40);
  const tag = v.status === "approved" ? "FINAL" : versionLabel(v);
  const files = v.driveFiles?.length ? v.driveFiles : [{ id: v.drive.id }];
  return files.map((f, i) => ({ id: f.id, name: `${base} · ${tag}${files.length > 1 ? ` · ${i + 1}` : ""}.${clientExt(f.name, v.kind)}` }));
}
function clientDownloadHTML(v, { big = false } = {}) {
  const n = v.driveFiles?.length || 1;
  const what = v.kind === "set" ? t("post.cl.dlSet", { n }) : v.kind === "image" ? t("post.cl.dlImage") : t("post.cl.dlVideo");
  const label = v.status === "approved" ? what : `${what} · ${versionLabel(v)}`;
  return big
    ? `<button type="button" class="cl-cta pst-cta" data-cl-dl="${escapeHtml(v.id)}"><span>${escapeHtml(label)}</span><span class="cl-cta-dot pst-dot-drive">${icon("download", { size: 16 })}</span></button>`
    : `<button type="button" class="btn btn-secondary btn-sm" data-cl-dl="${escapeHtml(v.id)}">${icon("download", { size: 14 })}${escapeHtml(label)}</button>`;
}
// Read through the client's own Drive (the same copy the player uses), saved
// under its code; several photos one after another.
async function clientDownload(c, v, btn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="width:14px;height:14px;"></span><span>${t("post.cl.dlMaking")}</span>`;
  try {
    const files = clientFiles(c, v);
    for (const f of files) {
      const a = document.createElement("a");
      a.href = await clientVideoURL(c, f.id);
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (files.length > 1) await new Promise((r) => setTimeout(r, 450));
    }
  } catch (e) {
    console.error("Client download failed", e);
    toast(t("post.cl.dlFailed"), "error");
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.innerHTML = label; }
  }
}
function wireClientFiles(root, c) {
  const cp = clientPosting(postingOf(c));
  qsa("[data-cl-dl]", root).forEach((btn) => btn.addEventListener("click", () => {
    const v = cp.versions.find((x) => x.id === btn.dataset.clDl);
    if (v && !btn.disabled) clientDownload(c, v, btn);
  }));
  qs("[data-cl-cap]", root)?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(c.caption || ""); toast(t("post.cl.capCopied")); } catch { toast(t("post.cl.capCopyFailed"), "error"); }
  });
}

// Wepeka's own side downloads too (owner, 2026-11-14: "bisa gak kamu kasih
// tombol download video di brandlab di antreannya?"): the cut straight from
// the Mac folder (or Wepeka's own Drive), saved under its code like the
// client's copy ("QKC-36 · Revisi 11.mp4", "QKC-36 · FINAL.mp4").
function ownFiles(c, v) {
  const base = videoCode(c) || String(c.title || "video").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 40);
  const tag = v.status === "approved" ? "FINAL" : versionLabel(v);
  let files = [];
  if (readsFromMac(v)) {
    files = (v.kind === "set" ? (v.local.slides || []).map((f) => (v.local.file === "slides" ? f : `${v.local.file}/${f}`)) : [v.local.file]).filter(Boolean).map((f) => ({ local: f, from: f }));
  } else if (v.driveFiles?.length) {
    files = v.driveFiles.map((f) => ({ id: f.id, from: f.name || "" }));
  } else if (v.drive?.id) {
    files = [{ id: v.drive.id, from: v.name || (v.drive.ext ? `.${v.drive.ext}` : "") }];
  }
  return files.map((f, i) => ({ ...f, name: `${base} · ${tag}${files.length > 1 ? ` · ${i + 1}` : ""}.${clientExt(f.from, v.kind)}` }));
}
// A local cut needs the Mac folder open in this browser; a Drive one, the id.
// Away from the Mac (the phone) a local cut with its Drive copy reads from
// Drive instead (copyCutsForPhone).
export function canDownloadCut(c, v) {
  if (!c || !v) return false;
  if (readsFromMac(v)) return !!(postingOf(c).local?.key && OUT.connected && ownFiles(c, v).length);
  return !!(v.drive?.id || v.driveFiles?.length);
}

// Wepeka's desk works from the Mac folder, which a phone can't open (owner,
// 2026-11-25: "buat aku bisa lihat videonya dari handphone juga", and sending
// a cut straight into the Instagram app from the phone, so Instagram's own
// "share to Facebook" still links the reel). So each new cut is also copied
// into the account's own Google Drive — the same "Brandlab / brand / month /
// day · title" folders every other brand uses — and wherever the Mac folder
// isn't open, the player, "Simpan / bagikan video" and Instagram posting read
// that copy. On the Mac nothing changes: the folder stays the source.
export const readsFromMac = (v, connected = OUT.connected) => !!v?.local && (connected || !(v.drive?.id || v.driveFiles?.length));
const PHONE_FROM = Date.parse("2026-11-25T00:00:00Z"); // older cuts stay Mac-only: no backlog of uploads
const PHONE = { running: false, pct: new Map(), failed: new Set() }; // pct: versionId → 0..1
export const phoneCopyPct = (versionId) => PHONE.pct.get(versionId);
// The cuts worth a phone copy: the newest of each piece still in the works,
// and the one approved for Instagram — a video, a photo, or a carousel's
// slides (owner, 2026-11-25: "buat yang carrousel juga bisa gitu dong"),
// made since this shipped.
export function phoneCopyWanted(c, from = PHONE_FROM) {
  const p = postingOf(c);
  if (!p.local?.key || c.status === "published" || p.ig?.state === "published") return [];
  const pick = [latestOf(p), p.versions.find((x) => x.id === p.finalId)].filter(Boolean);
  return [...new Map(pick.map((v) => [v.id, v])).values()].filter((v) => v.local?.file && !v.drive?.id && !v.driveFiles?.length
    && (v.kind !== "set" || (v.local.slides || []).length) && (v.at || 0) >= from);
}
export async function copyCutsForPhone() {
  if (PHONE.running || !isWepekaDesk() || !OUT.connected) return;
  PHONE.running = true;
  try {
    if (!(await checkDrive()).connected) return;
    for (;;) {
      let job = null;
      for (const b of listBrands()) {
        for (const c of listContent(b.id)) {
          const v = phoneCopyWanted(c).find((x) => !PHONE.failed.has(x.id));
          if (v) { job = { contentId: c.id, versionId: v.id }; break; }
        }
        if (job) break;
      }
      if (!job) break;
      await copyOneForPhone(job);
    }
  } finally {
    PHONE.running = false;
  }
}
async function copyOneForPhone({ contentId, versionId }) {
  const c = getContent(contentId);
  const p = postingOf(c);
  const v = p.versions.find((x) => x.id === versionId);
  if (!v?.local?.file) return;
  PHONE.pct.set(versionId, 0);
  tellWatchers(contentId, false);
  const say = (f) => {
    PHONE.pct.set(versionId, f);
    qsa(`[data-phone="${versionId}"]`).forEach((el) => { el.textContent = t("post.phone.copying", { pct: Math.round(f * 100) }); });
  };
  try {
    const folderId = await ensureFolders(driveFolderPath(getBrand(c.brandId), c));
    let patch;
    if ((v.kind || "video") === "video") {
      const file = await outboxFile(p.local.key, v.local.file);
      if (file.size > MAX_BYTES) throw new Error("too big");
      const ext = extOf(v.local.file);
      const up = await uploadToDrive(file, { name: driveFileName(v, ext), folderId, onProgress: say });
      patch = { drive: { id: up.id, link: up.webViewLink || "", folderId, ext, copy: true } };
    } else {
      // A photo, or a carousel's slides in their order: "Revisi 2 · 01.jpg" …
      const names = v.kind === "set" ? (v.local.slides || []).map((f) => (v.local.file === "slides" ? f : `${v.local.file}/${f}`)) : [v.local.file];
      const files = await Promise.all(names.map((n) => outboxFile(p.local.key, n)));
      const total = files.reduce((n, f) => n + f.size, 0) || 1;
      const out = [];
      let done = 0;
      for (let i = 0; i < files.length; i++) {
        const name = `${versionLabel(v)} · ${String(i + 1).padStart(2, "0")}.${extOf(files[i].name)}`;
        const up = await uploadToDrive(files[i], { name, folderId, onProgress: (f) => say((done + f * files[i].size) / total) });
        out.push({ id: up.id, name });
        done += files[i].size;
      }
      patch = { driveFiles: out, driveCopy: true };
    }
    // Read again: the piece may have changed while the copy went up.
    const fp = postingOf(getContent(contentId));
    updateContent(contentId, { posting: { ...fp, versions: fp.versions.map((x) => (x.id === versionId ? { ...x, ...patch } : x)) } });
  } catch (e) {
    PHONE.failed.add(versionId); // tried once this session; the next session tries again
    console.warn("[posting] phone copy failed", e);
  } finally {
    PHONE.pct.delete(versionId);
    tellWatchers(contentId, true);
  }
}
// The gallery's one tap: the cut chosen for Instagram, else the newest.
export function downloadCutOf(c) {
  const p = postingOf(c);
  return p.versions.find((x) => x.id === p.finalId) || latestOf(p);
}
export function ownDownloadLabel(c, v) {
  const n = v.kind === "set" ? ownFiles(c, v).length : 1;
  const what = v.kind === "set" ? t("post.cl.dlSet", { n }) : v.kind === "image" ? t("post.cl.dlImage") : t("post.cl.dlVideo");
  return `${what} · ${v.status === "approved" ? "FINAL" : versionLabel(v)}`;
}
function ownDownloadHTML(c, v) {
  if (!canDownloadCut(c, v)) return "";
  return `<div class="pst-cl-dl"><button type="button" class="btn btn-secondary btn-sm" data-own-dl="${escapeHtml(v.id)}">${icon("download", { size: 14 })}${escapeHtml(ownDownloadLabel(c, v))}</button></div>`;
}
const saveFile = (href, name) => {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
};
// The button spins while the file is read; several slides one after another.
export async function downloadCut(c, v, btn) {
  if (!btn || btn.disabled) return;
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="width:14px;height:14px;"></span>${btn.dataset.compact ? "" : `<span>${t("post.cl.dlMaking")}</span>`}`;
  const made = [];
  try {
    const key = postingOf(c).local?.key;
    const files = ownFiles(c, v);
    if (!files.length) throw new Error("no file for this cut");
    for (const f of files) {
      let href;
      if (f.local) {
        href = URL.createObjectURL(await outboxFile(key, f.local));
        made.push(href);
      } else {
        href = await driveVideoURL(f.id);
      }
      saveFile(href, f.name);
      if (files.length > 1) await new Promise((r) => setTimeout(r, 450));
    }
  } catch (e) {
    console.error("Download failed", e);
    toast(t("post.dl.failed"), "error");
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.innerHTML = label; }
    // The browser has taken the file by then; the copy in memory can go.
    if (made.length) setTimeout(() => made.forEach((u) => URL.revokeObjectURL(u)), 60000);
  }
}

// ---------------------------------------------------------------- Siap upload
// Everything to post one piece by hand, in one place (owner, 2026-11-24:
// "kalau orang sudah siap upload bisa download videonya langsung dari
// brandlab trs bisa copas caption dsb dengan cepat"): the cut to post, how to
// take it (a download on a computer; on a phone the share sheet, so it lands
// in the gallery or straight in Instagram), and the words to paste.

// The cut that goes up: the one approved (or, working alone, the newest);
// a client gets the one sent to them. null = nothing to take yet.
export function uploadCutOf(c) {
  if (!c) return null;
  if (isClientView(c)) {
    const cp = clientPosting(postingOf(c));
    const v = cp.versions.find((x) => x.id === cp.finalId) || latestOf(cp);
    if (!v) return null;
    const n = v.driveFiles?.length || 1;
    const what = v.kind === "set" ? t("post.cl.dlSet", { n }) : v.kind === "image" ? t("post.cl.dlImage") : t("post.cl.dlVideo");
    return { v, client: true, label: v.status === "approved" ? `${what} · FINAL` : `${what} · ${versionLabel(v)}` };
  }
  const v = downloadCutOf(c);
  return v && canDownloadCut(c, v) ? { v, client: false, label: ownDownloadLabel(c, v) } : null;
}

// Save it (a computer): the same download as the tile and the client's page.
export function downloadUploadCut(c, btn) {
  const cut = uploadCutOf(c);
  if (!cut || !btn || btn.disabled) return;
  return cut.client ? clientDownload(c, cut.v, btn) : downloadCut(c, cut.v, btn);
}

// A phone hands files to its share sheet ("Simpan Video" → gallery, or
// Instagram itself) — a plain download lands in Files, where Instagram
// can't pick it. Only where the browser can share files.
export function canShareFiles() {
  try {
    if (typeof navigator === "undefined" || !navigator.canShare || !navigator.share) return false;
    if (typeof matchMedia === "function" && !matchMedia("(pointer: coarse)").matches) return false;
    return navigator.canShare({ files: [new File([new Uint8Array(1)], "x.mp4", { type: "video/mp4" })] });
  } catch {
    return false;
  }
}
// The share sheet only opens from a tap, and reading the file takes a
// while, so it's two taps: "Siapkan" reads the cut into memory here (with
// progress), then "Simpan / bagikan" opens the sheet at once.
const READY_FILES = new Map(); // contentId → { files: File[], at }
export const preparedUpload = (contentId) => READY_FILES.get(contentId) || null;
export async function prepareUploadShare(c, onProgress = () => {}) {
  const cut = uploadCutOf(c);
  if (!cut) throw new Error("no cut");
  const list = cut.client ? clientFiles(c, cut.v) : ownFiles(c, cut.v);
  const key = postingOf(c).local?.key;
  const files = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const part = (x) => onProgress((i + Math.max(0, Math.min(1, x))) / list.length);
    let blob;
    if (f.local) blob = await outboxFile(key, f.local);
    else {
      const href = cut.client ? await clientVideoURL(c, f.id, { onProgress: part }) : await driveVideoURL(f.id, { onProgress: part });
      blob = await (await fetch(href)).blob();
    }
    const type = blob.type || (cut.v.kind === "video" || !cut.v.kind ? "video/mp4" : "image/jpeg");
    files.push(new File([blob], f.name, { type }));
    part(1);
  }
  // Only the last piece prepared stays in memory (a video can be 100+ MB).
  READY_FILES.clear();
  READY_FILES.set(c.id, { files, at: Date.now() });
  return files;
}
export async function shareUpload(c) {
  const ready = READY_FILES.get(c.id);
  if (!ready) return false;
  // The caption rides along on the clipboard (owner, 2026-11-25): Instagram
  // opens with the video, he only pastes. Started in the same tap as the
  // sheet — a later write would no longer count as the person's own tap.
  const cap = String(getContent(c.id)?.caption || c.caption || "");
  const copied = cap && navigator.clipboard?.writeText ? navigator.clipboard.writeText(cap).then(() => true, () => false) : Promise.resolve(false);
  try {
    await navigator.share({ files: ready.files, title: c.title || "" });
    if (await copied) toast(t("pqu.capOnClipboard"), "success");
    return true;
  } catch (e) {
    if (e?.name !== "AbortError") { console.warn("[upload] share", e); toast(t("pqu.shareFailed"), "error"); }
    return false;
  }
}

// The piece's own cover from Creator (a designed thumbnail), saved under
// its code; a link that won't download opens in a new tab instead.
export async function downloadCover(c, btn) {
  const src = String(c?.thumbnail || "");
  if (!/^(https:|data:image\/)/.test(src) || btn?.disabled) return;
  const base = videoCode(c) || String(c.title || "cover").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 40);
  const ext = (/^data:image\/(\w+)/.exec(src)?.[1] || /\.(jpe?g|png|webp)(\?|$)/i.exec(src)?.[1] || "jpg").replace("jpeg", "jpg");
  if (btn) btn.disabled = true;
  try {
    const blob = await (await fetch(src)).blob();
    const href = URL.createObjectURL(blob);
    saveFile(href, `${base} · thumbnail.${ext}`);
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  } catch {
    window.open(src, "_blank", "noopener");
  } finally {
    if (btn?.isConnected) btn.disabled = false;
  }
}

// A thumbnail lives inside the piece's own doc (Firestore caps a doc at
// 1 MB, the script and caption share it), so it's made small: a phone-sized
// JPEG, smaller again if it still comes out big.
export async function thumbDataURL(file) {
  let url = await resizeImageFile(file, { maxDimension: 1280, quality: 0.82, format: "image/jpeg" });
  if (url.length > 450_000) url = await resizeImageFile(file, { maxDimension: 960, quality: 0.72, format: "image/jpeg" });
  if (url.length > 450_000) url = await resizeImageFile(file, { maxDimension: 720, quality: 0.65, format: "image/jpeg" });
  return url;
}

// The hashtags in a caption, once each, in order — for people who put them
// in the first comment.
export function hashtagsOf(caption) {
  return [...new Set(String(caption || "").match(/#[\p{L}\p{N}_]+/gu) || [])];
}

// "Sudah tayang" by hand, the link optional: the same write as the Upload
// step's button, from wherever it's pressed. false = the link isn't one.
export function markPostedByHand(contentId, rawLink = "") {
  const raw = String(rawLink || "").trim();
  const link = igPermalink(raw);
  if (raw && !link) return false;
  const cur = postingOf(getContent(contentId));
  updateContent(contentId, { status: "published", publishedDate: localISODate(), ...(link ? { publishedUrl: link } : {}), posting: { ...cur, ig: { ...(cur.ig || {}), state: "published", byHand: true, postedAt: Date.now(), ...(link ? { permalink: link } : {}) } } });
  if (link && Object.keys(cur.previews || {}).length) cleanPreviews(contentId).catch((e) => console.warn("[posting] previews not cleaned", e));
  return true;
}

// A phone or tablet: nothing to drag a file onto, the gallery instead.
const isTouch = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

// The kit itself, one component for both places it shows (owner,
// 2026-11-24: "tampilan di create juga sama bisa download video"): Antrean →
// Siap upload and the piece's own Upload step in Creator.
// A phone reading a cut into memory: contentId → 0..1.
const PREPARING = new Map();
const kitCopyHTML = (c, what, label, cls = "") => `<button type="button" class="pqu-copy ${cls}" data-u-copy="${what}" data-id="${escapeHtml(c.id)}">${icon("copy", { size: 13 })}${label}</button>`;
export function uploadCopyHTML(c, what) {
  if (what === "caption") return c.caption ? kitCopyHTML(c, "caption", t("pqu.copyCaption"), "is-main") : "";
  if (what === "tags") { const n = hashtagsOf(c.caption).length; return n ? kitCopyHTML(c, "tags", t("pqu.copyTags", { n })) : ""; }
  return kitCopyHTML(c, "title", t("pqu.copyTitle"));
}
export function uploadTakeHTML(c) {
  const cut = uploadCutOf(c);
  if (!cut) return `<span class="pqu-nofile">${icon("info", { size: 13 })}${t(isClientView(c) ? "pqu.noFileClient" : "pqu.noFile")}</span>`;
  if (!canShareFiles()) return `<button type="button" class="cl-cta pqu-take" data-u-dl="${escapeHtml(c.id)}"><span>${escapeHtml(cut.label)}</span><span class="cl-cta-dot pst-dot-drive">${icon("download", { size: 15 })}</span></button>`;
  if (READY_FILES.has(c.id)) return `<button type="button" class="cl-cta pqu-take" data-u-share="${escapeHtml(c.id)}"><span>${t("pqu.share")}</span><span class="cl-cta-dot pst-dot-ok">${icon("send", { size: 15 })}</span></button>`;
  const pct = PREPARING.get(c.id);
  return `<button type="button" class="cl-cta pqu-take" data-u-prep="${escapeHtml(c.id)}" ${pct !== undefined ? "disabled" : ""}><span>${pct !== undefined ? t("pqu.preparing", { pct: Math.round(pct * 100) }) : t("pqu.prepare")}</span><span class="cl-cta-dot pst-dot-drive">${pct !== undefined ? `<span class="spinner" style="width:14px;height:14px;"></span>` : icon("download", { size: 15 })}</span></button>`;
}
// The file to take, the cover, the title; `captionCopy` adds the caption and
// hashtag buttons where the caption isn't shown with its own.
export function uploadKitHTML(c, { captionCopy = false } = {}) {
  const cut = uploadCutOf(c);
  const share = canShareFiles();
  // The thumbnail (owner, 2026-11-24: "bisa download dan upload thumbnail
  // juga"): the piece's own `thumbnail`, set here or in Creator — download
  // it, or upload / swap it for whoever may edit the brand.
  const has = /^(https:|data:image\/)/.test(c.thumbnail || "");
  const mayEdit = !isClientOnly(c) && canEditBrand(getBrand(c.brandId));
  const pick = (label) => `<label class="pqu-copy pqu-thumb-pick">${icon("upload", { size: 13 })}${label}<input type="file" accept="image/*" data-u-thumb="${escapeHtml(c.id)}" hidden></label>`;
  const cover = `${has ? `<span class="pqu-thumb" style="background-image:url('${escapeHtml(c.thumbnail.replace(/'/g, "%27"))}')" aria-hidden="true"></span><button type="button" class="pqu-copy" data-u-cover="${escapeHtml(c.id)}">${icon("download", { size: 13 })}${t("pqu.cover")}</button>` : ""}${mayEdit ? pick(t(has ? "pqu.thumbChange" : "pqu.thumbUpload")) : ""}`;
  return `<div class="pqu-kit">
      <div class="pqu-actions">
        ${uploadTakeHTML(c)}
        <div class="pqu-more">${cover}${uploadCopyHTML(c, "title")}${captionCopy ? `${uploadCopyHTML(c, "caption")}${uploadCopyHTML(c, "tags")}` : ""}</div>
      </div>
      ${cut && share ? `<small class="pqu-file">${icon("film", { size: 12 })}${escapeHtml(cut.label)}</small>` : ""}
      ${cut && share && READY_FILES.has(c.id) ? `<p class="pqu-hint">${icon("info", { size: 12 })}${t("pqu.shareHint")}</p>` : ""}
    </div>`;
}
async function copyKitText(text, okKey) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t(okKey), "success");
  } catch {
    toast(t("post.cl.capCopyFailed"), "error");
  }
}
// Its buttons, wherever it's painted. The caption copied is the one in the
// box on screen when there is one (Creator's Upload step: maybe just typed).
export function wireUploadKit(root, { repaint } = {}) {
  qsa("[data-u-dl]", root).forEach((b) => b.addEventListener("click", () => downloadUploadCut(getContent(b.dataset.uDl), b)));
  qsa("[data-u-prep]", root).forEach((b) => b.addEventListener("click", async () => {
    const c = getContent(b.dataset.uPrep);
    if (!c || PREPARING.size) return;
    PREPARING.set(c.id, 0);
    repaint?.();
    let last = 0;
    try {
      await prepareUploadShare(c, (x) => {
        PREPARING.set(c.id, x);
        // A label update, not a repaint (keeps the page still).
        const label = qs(`[data-u-prep="${CSS.escape(c.id)}"] span`, root);
        if (label && Date.now() - last > 200) { last = Date.now(); label.textContent = t("pqu.preparing", { pct: Math.round(x * 100) }); }
      });
      toast(t("pqu.prepared"), "success");
    } catch (e) {
      console.error("[upload] prepare", e);
      toast(t("post.dl.failed"), "error");
    }
    PREPARING.delete(c.id);
    if (root.isConnected) repaint?.();
  }));
  qsa("[data-u-share]", root).forEach((b) => b.addEventListener("click", () => shareUpload(getContent(b.dataset.uShare))));
  qsa("[data-u-cover]", root).forEach((b) => b.addEventListener("click", () => downloadCover(getContent(b.dataset.uCover), b)));
  qsa("[data-u-thumb]", root).forEach((input) => input.addEventListener("change", async () => {
    const file = input.files?.[0];
    const c = getContent(input.dataset.uThumb);
    input.value = "";
    if (!file || !c) return;
    if (!/^image\//.test(file.type)) { toast(t("pqu.thumbNotImage"), "error"); return; }
    try {
      updateContent(c.id, { thumbnail: await thumbDataURL(file) });
      toast(t("pqu.thumbSaved"), "success");
      repaint?.();
    } catch (e) {
      console.error("[upload] thumbnail", e);
      toast(t("pqu.thumbFailed"), "error");
    }
  }));
  qsa("[data-u-copy]", root).forEach((b) => b.addEventListener("click", () => {
    const c = getContent(b.dataset.id);
    if (!c) return;
    const caption = qs("#pst-caption", root)?.value ?? c.caption ?? "";
    if (b.dataset.uCopy === "title") copyKitText(c.title || "", "pqu.copiedTitle");
    else if (b.dataset.uCopy === "tags") copyKitText(hashtagsOf(caption).join(" "), "pqu.copiedTags");
    else copyKitText(caption, "post.cl.capCopied");
  }));
}

// The editor's side of "not connected yet": only the client can connect
// the Drive the cuts go into.
function clientGapHTML(gap) {
  if (gap === "connect") return clientConnectHTML();
  return `<div class="pst-empty pst-connect">
      <span class="pst-empty-art is-drive">${icon("folder", { size: 26 })}</span>
      <b>${t("post.cl.waitTitle")}</b>
      <span>${tc("post.cl.waitBody")}</span>
    </div>`;
}
function clientConnectHTML() {
  const setup = DRIVE.reason === "setup";
  return `<div class="pst-empty pst-connect">
      <span class="pst-empty-art is-drive">${icon("folder", { size: 26 })}</span>
      <b>${t("post.cl.driveTitle")}</b>
      <span>${tc("post.cl.driveBody")}</span>
      ${setup ? `<span class="pst-hint">${icon("info", { size: 13 })}${t("post.drive.setup")}</span>` : ""}
      <button type="button" class="cl-cta pst-cta" id="pst-connect" ${setup ? "disabled" : ""}><span>${t("post.cl.driveCta")}</span><span class="cl-cta-dot pst-dot-drive">${icon("link", { size: 16 })}</span></button>
    </div>`;
}

// Upload step, client side: when it goes up, the file to download (the
// approved cut, else the newest one sent) and the caption to copy. Posting
// itself stays on Wepeka's account.
function clientPostHTML(c, p, key, { gap = false } = {}) {
  const when = c.scheduleDate ? `${dayLabel(c.scheduleDate)}${p.time ? `, ${p.time}` : ""}` : t("pq.noDate");
  const link = p.ig?.permalink || c.publishedUrl || "";
  const cp = clientPosting(p);
  const dv = cp.versions.find((v) => v.id === cp.finalId) || latestOf(cp);
  const file = gap ? clientGapHTML(gap)
    : dv ? `<div class="pst-cl-file">${uploadKitHTML(c)}<p class="pst-hint">${icon(dv.status === "approved" ? "check" : "info", { size: 13 })}${escapeHtml(dv.status === "approved" ? t("post.cl.dlFinal") : t("post.cl.dlNotYet", { label: versionLabel(dv) }))}</p></div>`
    : `<p class="pst-hint">${icon("clock", { size: 13 })}${tc("post.cl.dlNone")}</p>`;
  return `<section class="pst-block pst-post">
      <div class="pst-embed-top"><span class="pst-badge is-${key}" style="--pst:${STATE_COLOR[key]}">${icon(STATE_ICON[key], { size: 11 })}${escapeHtml(stateLabel(c, key))}</span></div>
      <p class="pst-client-line">${icon("calendar", { size: 13 })} ${t("post.cl.when", { when: escapeHtml(when) })}</p>
      ${file}
      ${c.caption ? `<div class="pst-cap-read"><div class="pst-cap-head"><span class="pst-sub">${t("post.cl.caption")}</span><button type="button" class="pst-link" data-cl-cap>${icon("copy", { size: 13 })}${t("post.cl.capCopy")}</button>${uploadCopyHTML(c, "tags")}</div><p>${escapeHtml(c.caption)}</p></div>` : ""}
      ${link ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(link)}" target="_blank" rel="noopener">${icon("instagram", { size: 14 })}${t("post.cl.openIg")}</a>` : ""}
    </section>`;
}

// Every cut so far as a row of cards, oldest first (owner, 2026-11-02:
// "kalau di-click hasil revisian videonya ada semua"); tap one to play it.
function versionsHTML(p, v, up, { add = true, sent = false } = {}) {
  return `<div class="pst-vgal-wrap">
      <span class="pst-sub">${t("post.v.all", { n: p.versions.length })}</span>
      <div class="pst-vgal" role="list">
        ${p.versions.map((x) => `<button type="button" role="listitem" class="pst-vcard ${x.id === v.id ? "is-on" : ""}" data-vid="${x.id}" aria-pressed="${x.id === v.id}" style="--pst:${STATE_COLOR[x.status === "pending" ? "review" : x.status === "revision" ? "revision" : "ready"]}">
            <span class="pst-vcard-img" data-vthumb="${x.id}" ${x.poster ? `data-vposter="${escapeHtml(x.poster)}"` : ""}>${icon(x.kind === "set" ? "layers" : x.kind === "image" ? "image" : "play", { size: 18 })}</span>
            ${x.id === p.finalId ? `<em class="pst-vcard-final" title="${escapeHtml(t("post.v.final"))}">${icon("instagram", { size: 11 })}</em>` : ""}
            ${sent && sentToClient(p, x) ? `<em class="pst-vcard-sent" title="${escapeHtml(t("post.mark.cutTitle"))}">${icon("check", { size: 11 })}${t("post.mark.cut")}</em>` : ""}
            <span class="pst-vcard-l">${escapeHtml(versionLabel(x))}</span>
            <small><i aria-hidden="true"></i>${t(`post.v.st.${x.status}`)}</small>
          </button>`).join("")}
        ${add ? `<button type="button" class="pst-vcard is-add" id="pst-add" ${up ? "disabled" : ""}><span class="pst-vcard-img">${icon("plus", { size: 20 })}</span><span class="pst-vcard-l">${t("post.v.upload")}</span></button>` : ""}
      </div>
    </div>`;
}

// The piece and its trial cuts (KP-12, KP-12B …), one tap apart.
function trialsHTML(c) {
  const main = c.trialOf ? getContent(c.trialOf) || c : c;
  const family = [main, ...listContent(main.brandId).filter((x) => x.trialOf === main.id).sort((a, b) => (a.trial || "").localeCompare(b.trial || ""))];
  const add = `<button type="button" class="pst-trial-add" id="pst-trial-add">${icon("plus", { size: 13 })}${t(family.length > 1 ? "post.trial.addMore" : "post.trial.add")}</button>`;
  if (family.length < 2) return `<div class="pst-trials is-solo">${add}<span class="pst-trials-hint">${t("post.trial.hint")}</span></div>`;
  return `<div class="pst-trials" role="group" aria-label="${escapeHtml(t("post.trial.label"))}">
      <span class="pst-trials-l">${icon("target", { size: 13 })}${t("post.trial.label")}</span>
      ${family.map((x) => `<button type="button" class="pst-trial ${x.id === c.id ? "is-on" : ""}" data-trial-open="${escapeHtml(x.id)}" ${x.id === c.id ? 'aria-current="true"' : ""} style="--pst:${STATE_COLOR[postingState(x)]}"><i></i>${escapeHtml(videoCode(x) || (x.trial ? `Trial ${x.trial}` : t("post.trial.main")))}</button>`).join("")}
      ${add}
    </div>`;
}

function formatLineHTML(v) {
  const issues = formatIssues(v);
  if (issues.length) return `<p class="pst-warn">${icon("info", { size: 13 })}${issues.map(escapeHtml).join(" · ")}</p>`;
  return `<p class="pst-ok">${icon("check", { size: 13 })}${t("post.check.ok")}${v.dur ? ` · ${clock(v.dur)}` : ""}${v.w ? " · 9:16" : ""}</p>`;
}

// The post's kind and, for a video, its cover — both picked here and
// written back to the folder for Claude.
const TYPES = ["reels", "carousel", "foto", "story"];
function extrasHTML(p, v, c, ui = {}) {
  const covers = p.covers || [];
  const videoPost = (v?.kind === "video" || !v?.local) && ["reels", "story", ""].includes(p.type || "");
  // New covers go into the folder, so only with the folder at hand.
  const canAdd = !!(v?.local && p.local?.key && OUT.connected);
  const thumb = videoPost ? thumbBlockHTML(c, ui) : "";
  const showCovers = videoPost && (covers.length || canAdd || thumb);
  const fromEditor = (f) => p.thumb?.file === f ? `<em class="pst-cover-ed">${t("post.thumb.done")}</em>` : "";
  return `
    <div class="pst-types" role="group" aria-label="${escapeHtml(t("post.type.label"))}">
      ${TYPES.map((k) => `<button type="button" class="pst-type ${(p.type || "reels") === k ? "is-on" : ""}" data-type="${k}" aria-pressed="${(p.type || "reels") === k}">${icon(k === "carousel" ? "layers" : k === "foto" ? "image" : k === "story" ? "clock" : "play", { size: 13 })}${t(`post.type.${k}`)}</button>`).join("")}
    </div>
    ${(p.type || "reels") === "reels" && isWepekaDesk() ? `<label class="pst-switch"><input type="checkbox" id="pst-trialreel" ${p.trialReel ? "checked" : ""}><span><b>${t("post.trialReel.label")}</b><small>${t("post.trialReel.hint")}</small></span></label>` : ""}
    ${showCovers ? `<div class="pst-covers"><span class="pst-sub">${t("post.cover.label")}</span><div class="pst-cover-row">${covers.map((f) => `<button type="button" class="pst-cover ${p.cover === f ? "is-on" : ""}" data-cover="${escapeHtml(f)}" aria-pressed="${p.cover === f}" title="${escapeHtml(f)}"><img data-local-img="${escapeHtml(f)}" alt="">${fromEditor(f)}</button>`).join("")}
      ${canAdd && v?.kind === "video" ? `<button type="button" class="pst-cover is-add" id="pst-cover-frame">${icon("image", { size: 16 })}<span>${t("post.cover.frame")}</span></button>` : ""}
      ${canAdd ? `<button type="button" class="pst-cover is-add" id="pst-cover-file">${icon("upload", { size: 16 })}<span>${t("post.cover.file")}</span></button>` : ""}
    </div>${thumb}</div>` : ""}`;
}

function localWhereHTML(p, v) {
  return `<p class="pst-where">${icon("folder", { size: 13 })}<span><b>${t("post.local.where")}</b> ${[OUT.name || "Outbox", ...p.local.key.split("/")].map(escapeHtml).join(" › ")} › ${escapeHtml(v.local.file)}</span></p>`;
}

function localConnectHTML() {
  const again = OUT.needsPermission;
  return `<div class="pst-empty pst-connect">
      <span class="pst-empty-art is-mac">${icon("folder", { size: 26 })}</span>
      <b>${t(again ? "post.local.againTitle" : "post.local.title")}</b>
      <span>${t(again ? "post.local.againBody" : "post.local.body")}</span>
      <button type="button" class="cl-cta pst-cta" id="pst-local"><span>${t(again ? "post.local.againCta" : "post.local.cta")}</span><span class="cl-cta-dot pst-dot-drive">${icon("folder", { size: 16 })}</span></button>
    </div>`;
}

// Carousel arrows + "1/7" (owner, 2026-11-10: "tambahin juga tombol buat
// slide kalau carrousel"): a mouse can't swipe the row, so ‹ › step one slide.
function slideNavHTML(n) {
  if (n < 2) return "";
  return `<span class="pst-slide-n">1/${n}</span>`
    + `<button type="button" class="pst-slide-go is-prev" data-slide-go="-1" aria-label="${escapeHtml(t("post.slide.prev"))}" disabled>${icon("chevronLeft", { size: 20 })}</button>`
    + `<button type="button" class="pst-slide-go is-next" data-slide-go="1" aria-label="${escapeHtml(t("post.slide.next"))}">${icon("chevronRight", { size: 20 })}</button>`;
}

// One wiring for every carousel on the page (Mac folder or client's Drive):
// the counter follows the swipe, the arrows step and hide at the ends.
function wireSlides(root) {
  qsa(".pst-player.is-slides", root).forEach((box) => {
    const row = qs(".pst-slides", box);
    if (!row || row.dataset.wired) return;
    row.dataset.wired = "1";
    const total = row.children.length;
    const at = () => Math.min(total - 1, Math.max(0, Math.round(row.scrollLeft / (row.clientWidth || 1))));
    const show = () => {
      const i = at();
      const n = qs(".pst-slide-n", box);
      if (n) n.textContent = `${i + 1}/${total}`;
      const prev = qs(".pst-slide-go.is-prev", box), next = qs(".pst-slide-go.is-next", box);
      if (prev) prev.disabled = i <= 0;
      if (next) next.disabled = i >= total - 1;
    };
    row.addEventListener("scroll", show, { passive: true });
    // A straight jump to the next slide: a smooth scroll on a snapping row
    // can stop halfway between two slides.
    qsa("[data-slide-go]", box).forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = Math.min(total - 1, Math.max(0, at() + Number(b.dataset.slideGo)));
      row.scrollLeft = i * row.clientWidth;
      show();
    }));
    show();
  });
}

// A local cut plays straight from the Mac folder; a carousel is a row of
// slides to swipe, a photo just the photo.
function localPlayerHTML(v, tag, c) {
  const key = postingOf(c).local?.key || "";
  const label = tag ? `<span class="pst-tag">${tag} · ${escapeHtml(versionLabel(v))}</span>` : "";
  if (v.kind === "set" || v.kind === "image") {
    const files = v.kind === "image" ? [v.local.file] : (v.local.slides || []).map((f) => (v.local.file === "slides" ? f : `${v.local.file}/${f}`));
    return `<div class="pst-player is-slides" data-key="${escapeHtml(key)}">${label}<div class="pst-slides">${files.map((f) => `<img data-local-img="${escapeHtml(f)}" alt="">`).join("")}</div>${slideNavHTML(files.length)}${phoneLineHTML(v)}</div>`;
  }
  return `<div class="pst-player" data-pv="${escapeHtml(v.id)}" data-key="${escapeHtml(key)}" data-local="${escapeHtml(v.local.file)}">${label}<video playsinline preload="metadata" ${tag === "A" ? "muted" : ""}></video>${phoneLineHTML(v)}</div>`;
}
// On the Mac: whether this cut can be opened on the phone yet.
function phoneLineHTML(v) {
  if (!isWepekaDesk()) return "";
  const pct = phoneCopyPct(v.id);
  if (pct !== undefined) return `<span class="pst-phone" data-phone="${escapeHtml(v.id)}">${t("post.phone.copying", { pct: Math.round(pct * 100) })}</span>`;
  return v.drive?.id || v.driveFiles?.length ? `<span class="pst-phone is-on">${icon("check", { size: 12 })}${t("post.phone.ready")}</span>` : "";
}

// A Drive video is fetched into the tab first (js/drive.js driveVideoURL);
// the player says so while it loads.
function playerHTML(v, tag, c) {
  if (readsFromMac(v)) return localPlayerHTML(v, tag, c);
  if (v.driveFiles && v.kind !== "video") {
    return `<div class="pst-player is-slides"><div class="pst-slides">${v.driveFiles.map((f) => `<img data-drive-img="${escapeHtml(f.id)}" alt="">`).join("")}</div>${slideNavHTML(v.driveFiles.length)}</div>`;
  }
  const fromDrive = !v.url && v.drive?.id;
  return `<div class="pst-player" data-pv="${escapeHtml(v.id)}" ${v.url ? "data-ready" : ""} ${fromDrive ? `data-drive="${escapeHtml(v.drive.id)}"` : ""}>${tag ? `<span class="pst-tag">${tag} · ${escapeHtml(versionLabel(v))}</span>` : ""}<video ${v.url ? `src="${escapeHtml(v.url)}"` : ""} playsinline preload="metadata" ${tag === "A" ? "muted" : ""}></video>${fromDrive ? `<span class="pst-loading">${icon("folder", { size: 16 })}<span>${t("post.load")}</span><b>0%</b></span>` : ""}</div>`;
}

// A repaint keeps the players it already has (owner, 2026-11-02: after a
// note "detiknya gak balik ke 0:00, tinggal aku lanjutin"): same cut, same
// <video>, still at its second — paused or playing. Called around innerHTML.
function keepPlayers(root) {
  const old = new Map(qsa(".pst-player[data-pv][data-ready]", root).map((el) => [el.dataset.pv, el]));
  return () => qsa(".pst-player[data-pv]", root).forEach((el) => {
    const was = old.get(el.dataset.pv);
    if (!was || !qs("video", was)) return;
    qs(".pst-tag", was)?.remove();
    const tag = qs(".pst-tag", el);
    if (tag) was.prepend(tag);
    qs("video", was).muted = qs("video", el)?.hasAttribute("muted") || false;
    el.replaceWith(was);
  });
}

// Each note as a dot on the timeline; a tap jumps there. Whole-video notes
// have no spot on it.
function marksHTML(p, v) {
  const dur = v.dur || 0;
  const mine = (p.notes || []).filter((n) => n.versionId === v.id && !isWhole(n));
  if (!mine.length) return "";
  return `<div class="pst-marks" data-dur="${dur}">${mine.map((n) => `<button type="button" class="pst-mark ${n.done ? "is-done" : ""} ${n.by === "client" ? "is-client" : ""}" data-seek="${n.t}" data-mark-t="${n.t}" style="--at:${dur ? Math.min(1, n.t / dur) : 0}" title="${escapeHtml(`${clock(n.t)} · ${n.text}`)}" aria-label="${escapeHtml(`${clock(n.t)} · ${n.text}`)}"></button>`).join("")}</div>`;
}

function connectHTML() {
  const setup = DRIVE.reason === "setup";
  return `<div class="pst-empty pst-connect">
      <span class="pst-empty-art is-drive">${icon("folder", { size: 26 })}</span>
      <b>${t("post.drive.title")}</b>
      <span>${t("post.drive.body")}</span>
      ${setup ? `<span class="pst-hint">${icon("info", { size: 13 })}${t("post.drive.setup")}</span>` : ""}
      <button type="button" class="cl-cta pst-cta" id="pst-connect" ${setup ? "disabled" : ""}><span>${t("post.drive.cta")}</span><span class="cl-cta-dot pst-dot-drive">${icon("link", { size: 16 })}</span></button>
    </div>`;
}

function whereHTML(brand, c, v) {
  return `<p class="pst-where">${icon("folder", { size: 13 })}<span><b>${t("post.drive.where")}</b> ${driveFolderPath(brand, c).map(escapeHtml).join(" › ")}</span>${v.drive.link ? `<a href="${escapeHtml(v.drive.link)}" target="_blank" rel="noopener">${t("post.drive.open")}</a>` : ""}</p>`;
}

// The revision column (owner, 2026-11-02: "lebih clear dilihat kolom
// revisinya"): what changed in this cut, approve, then the notes by second
// and the box to write the next one — sitting right next to the video.
// Writing a note on an unchecked cut is asking for changes, so there's no
// separate "Minta revisi" step any more.
function decideHTML(p, v, prev, ui, editor = "", timed = true) {
  const label = versionLabel(v);
  const mine = p.notes.filter((n) => n.versionId === v.id).sort(byTime);
  // The last cut's notes still open, and the ones Claude says this cut fixed.
  const fixedInCut = (n) => n.doneBy === "editor";
  const older = prev ? p.notes.filter((n) => n.versionId === prev.id && (!n.done || fixedInCut(n))).sort(byTime) : [];
  const who = (n) => (n.by === "client" ? `<em class="pst-note-who is-client">${escapeHtml(n.name ? t("post.note.clientNamed", { name: n.name }) : t("post.note.client"))}</em>` : ui.client ? `<em class="pst-note-who">Wepeka</em>` : "") + (fixedInCut(n) ? `<em class="pst-note-who">${t("post.note.fixedInCut")}</em>` : "");
  const chip = (n) => (isWhole(n)
    ? `<span class="pst-note-t is-whole">${icon("expand", { size: 10 })}${t(timed ? "post.note.whole" : "post.note.wholePlain")}</span>`
    : `<button type="button" class="pst-note-t" data-seek="${n.t}" title="${escapeHtml(t("post.note.jump"))}">${icon("play", { size: 10 })}${clock(n.t)}</button>`);
  const note = (n, here) => `<div class="pst-note ${n.done ? "is-done" : ""}" ${here && !isWhole(n) ? `data-note-at="${n.t}"` : ""}>${chip(n)}<span>${who(n)}${escapeHtml(n.text)}</span>${ui.client ? (n.done ? `<em class="pst-note-who">${t("post.note.done")}</em>` : "") : `<label><input type="checkbox" data-note="${n.id}" ${n.done ? "checked" : ""}>${t("post.note.done")}</label>`}</div>`;
  const final = p.versions.find((x) => x.id === p.finalId);
  // The client writes only on the cut sent to them, until it's approved.
  const current = !ui.client || v.id === p.client?.versionId;
  const writing = current && ["pending", "revision"].includes(v.status);
  // A video note is pinned to the second on screen, or — picked here — goes
  // for the whole video.
  const whole = timed && !!ui.noteWhole;
  const scope = (key, on, ic, label) => `<button type="button" class="pst-type ${on ? "is-on" : ""}" data-note-scope="${key}" aria-pressed="${on}">${icon(ic, { size: 13 })}${label}</button>`;
  const open = mine.filter((n) => !n.done).length;
  let head;
  if (ui.client && !current) {
    head = `<p class="pst-result">${icon("layers", { size: 15 })}<span>${t("post.cl.older")}</span></p>`;
  } else if (ui.client && v.status === "approved") {
    head = `<p class="pst-result is-ok">${icon("check", { size: 15 })}<span>${t("post.cl.approved")}</span></p>`;
  } else if (ui.client && v.status === "revision") {
    head = `<div class="pst-rev-ask"><p class="pst-result is-rev">${icon("refresh", { size: 15 })}<span>${tc("post.cl.revising")}</span></p>
        <button type="button" class="cl-cta pst-cta" id="pst-ok"><span>${t("post.cl.ok", { label: escapeHtml(label) })}</span><span class="cl-cta-dot pst-dot-ok">${icon("check", { size: 16 })}</span></button></div>`;
  } else if (v.status === "pending") {
    head = `<div class="pst-rev-ask">
        <h4>${t(ui.client ? "post.cl.ask" : "post.decide.title", { label: escapeHtml(label) })}</h4>
        <button type="button" class="cl-cta pst-cta" id="pst-ok"><span>${t("post.decide.ok")}</span><span class="cl-cta-dot pst-dot-ok">${icon("check", { size: 16 })}</span></button>
      </div>`;
  } else if (v.status === "approved") {
    head = v.id === p.finalId
      ? `<p class="pst-result is-ok">${icon("check", { size: 15 })}<span>${t("post.decide.approved")}</span></p>`
      : `<p class="pst-result is-ok">${icon("check", { size: 15 })}<span>${t("post.decide.approvedOther", { label: escapeHtml(final ? versionLabel(final) : "") })} <button type="button" class="pst-link" id="pst-use">${t("post.decide.useThis")}</button></span></p>`;
  } else {
    head = `<p class="pst-result is-rev">${icon("refresh", { size: 15 })}<span>${t("post.decide.revising")} <button type="button" class="pst-link" id="pst-undo">${t("post.decide.undo")}</button></span></p>`;
  }
  return `
    <section class="pst-block pst-rev">
      ${v.changeNote ? `<p class="pst-change">${icon("edit", { size: 13 })}<span><b>${t("post.change.title", { label: escapeHtml(label) })}</b> ${escapeHtml(v.changeNote)}</span></p>` : ""}
      ${head}
      ${mine.length || writing ? `<div class="pst-rev-title">${icon("edit", { size: 15 })}<b>${t("post.rev.title", { label: escapeHtml(label) })}</b>${mine.length ? `<span class="pst-rev-n ${open ? "" : "is-clear"}">${open ? t("post.rev.open", { n: open }) : t("post.rev.allDone")}</span>` : ""}</div>` : ""}
      ${mine.length ? `<div class="pst-notes">${mine.map((n) => note(n, true)).join("")}</div>` : writing ? `<p class="pst-rev-empty">${t(timed ? "post.rev.empty" : "post.rev.emptyPlain")}</p>` : ""}
      ${writing ? `
        <div class="pst-compose">
          ${timed ? `<div class="pst-types pst-note-scope" role="group" aria-label="${escapeHtml(t("post.note.scope"))}">${scope("here", !whole, "clock", t("post.note.scopeHere"))}${scope("whole", whole, "expand", t("post.note.whole"))}</div>` : ""}
          <label class="pst-compose-top" for="pst-note-text">${timed && !whole ? `<span class="pst-compose-t" id="pst-compose-t">${clock(ui.t)}</span>` : ""}<b>${t(whole ? "post.note.labelWhole" : timed ? "post.note.label" : "post.note.labelPlain")}</b></label>
          <textarea class="textarea" id="pst-note-text" rows="2" placeholder="${escapeHtml(t(whole ? "post.note.phWhole" : "post.note.ph"))}">${escapeHtml(ui.noteDraft || "")}</textarea>
          <div class="pst-compose-foot"><small>${t(whole ? "post.note.hintWhole" : timed ? "post.note.hint" : "post.note.hintPlain")}</small><button type="button" class="btn btn-primary btn-sm" id="pst-note-send">${whole ? t("post.note.sendWhole") : timed ? t("post.note.send", { time: clock(ui.t) }) : t("post.note.sendPlain")}</button></div>
        </div>` : ""}
      ${older.length ? `<div class="pst-notes is-prev"><div class="pst-sub">${t("post.note.prev", { label: escapeHtml(versionLabel(prev)) })}</div>${older.map((n) => note(n, false)).join("")}</div>` : ""}
      ${editor}
    </section>`;
}

// ---------------------------------------------------------------- client
// The brand's client (owner, 2026-11-09: "aku mau quatro buka lewat
// brandlab … aku yang take control"): invited as "Klien" in Kerja Tim, they
// open this same Antrean in their own Brandlab — watch, note, approve,
// never post. The cuts go into the client's OWN Google Drive (connected
// from their Brandlab), not into Brandlab's storage; once a cut is approved
// the older ones are deleted from their Drive. Only for cuts in the Mac
// folder, which this tab can read.
const SENDING = new Map(); // contentId → { pct }
const timeLabel = (ms) => new Date(ms).toLocaleString(getLang() === "en" ? "en-US" : "id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// The brand's clients, and whose Drive gets the cuts (brand.clientDrive,
// written by the server when a client connects theirs).
export const clientsOf = (brand) => Object.entries(brand?.members || {}).filter(([, m]) => m?.klien && !m.disabled).map(([uid, m]) => ({ uid, ...m }));
export function clientDriveLine(brand) {
  const people = clientsOf(brand);
  if (!people.length) return { tone: "off", text: t("post.client.noClient") };
  const cd = brand.clientDrive;
  const who = cd?.uid && people.find((x) => x.uid === cd.uid);
  if (!who) return { tone: "wait", text: t("post.client.noDrive", { name: escapeHtml(people.map((x) => x.name || x.email).join(", ")) }) };
  return { tone: "on", text: t("post.client.drive", { name: escapeHtml(who.name || who.email || ""), email: escapeHtml(cd.email || "") }) };
}
// The client's way in: the brand's Antrean Video in Brandlab.
export const clientQueueURL = (brandId) => `${location.origin}/#/brand/${brandId}/content/antrean`;

function clientHTML(c, p, v, key) {
  if (["scheduled", "published", "failed"].includes(key) && !p.client) return "";
  const cl = p.client;
  const sent = cl ? p.versions.find((x) => x.id === cl.versionId) : null;
  const brand = getBrand(c.brandId);
  const people = clientsOf(brand);
  const drive = clientDriveLine(brand);
  const sending = SENDING.get(c.id);
  const local = !!(v.local && p.local?.key && OUT.connected);
  // Everyone else sends from their own Drive, and only a cut the team
  // approved (owner, 2026-11-24: "baru bisa masuk … kalau di setujui tim
  // dulu videonya"); Wepeka's desk keeps sending drafts from the Mac.
  const fromDrive = !isWepekaDesk() && !!(v.drive?.id || v.driveFiles?.length);
  const teamOk = isWepekaDesk() || v.status === "approved";
  const canSend = (local || fromDrive) && teamOk && drive.tone === "on" && !["scheduled", "published"].includes(key);
  let line;
  if (!cl || !sent) line = t("post.client.intro");
  else if (cl.status === "waiting") line = t("post.client.waiting", { label: escapeHtml(versionLabel(sent)), when: escapeHtml(timeLabel(cl.sentAt)) });
  else if (cl.status === "approved") line = t("post.client.approved", { label: escapeHtml(versionLabel(sent)), who: escapeHtml(cl.name || t("post.client.theClient")), when: escapeHtml(timeLabel(cl.decidedAt)) });
  else line = t("post.client.revise", { label: escapeHtml(versionLabel(sent)), who: escapeHtml(cl.name || t("post.client.theClient")) });
  const tone = !cl ? "" : cl.status === "approved" ? "is-ok" : cl.status === "revision" ? "is-rev" : "is-wait";
  const resend = canSend && (!sent || sent.id !== v.id || cl.status === "revision");
  return `
    <section class="pst-block pst-client ${tone}">
      <div class="pst-client-head"><span class="pst-client-ic">${icon("users", { size: 15 })}</span><b>${t("post.client.title")}</b>${cl ? `<span class="pst-badge" style="--pst:${cl.status === "approved" ? STATE_COLOR.ready : cl.status === "revision" ? STATE_COLOR.revision : STATE_COLOR.client}">${t(`post.client.st.${cl.status}`)}</span>` : ""}</div>
      <p class="pst-client-line">${line}</p>
      <p class="pst-client-drive is-${drive.tone}"><i></i>${drive.text}</p>
      ${sending ? `<div class="pst-progress" role="status"><div class="pst-progress-row">${icon("upload", { size: 14 })}<span>${t("post.client.sending")}</span><b id="pst-client-pct">${Math.round(sending.pct * 100)}%</b></div><div class="pst-progress-bar"><i id="pst-client-fill" style="width:${Math.round(sending.pct * 100)}%"></i></div></div>` : `
      <div class="pst-decide">
        ${resend ? `<button type="button" class="cl-cta pst-cta" id="pst-client-send"><span>${t(sent ? "post.client.sendThis" : "post.client.send", { label: escapeHtml(versionLabel(v)) })}</span><span class="cl-cta-dot pst-dot-client">${icon("send", { size: 16 })}</span></button>` : ""}
        ${people.length ? `<button type="button" class="btn btn-secondary btn-sm" id="pst-client-copy">${icon("link", { size: 14 })}${t("post.client.copy")}</button>` : `<button type="button" class="btn btn-secondary btn-sm" id="pst-client-invite">${icon("users", { size: 14 })}${t("post.client.invite")}</button>`}
      </div>`}
      ${!local && !cl && v.local ? `<p class="pst-hint">${icon("info", { size: 13 })}${t("post.client.needFolder")}</p>` : ""}
      ${!teamOk ? `<p class="pst-hint">${icon("lock", { size: 13 })}${t("post.client.needApproval")}</p>` : ""}
      ${people.length ? `<p class="pst-hint">${icon("info", { size: 13 })}${t("post.client.rule")}</p>` : ""}
    </section>`;
}

// The gallery still for the client's Antrean: the chosen cover, or a frame.
async function posterBlob(p, v) {
  try {
    const src = await outboxThumb(p.local.key, v, p.cover);
    return src ? await (await fetch(src)).blob() : null;
  } catch {
    return null;
  }
}

async function sendCut(contentId, versionId, repaint) {
  const c = getContent(contentId);
  const p = postingOf(c);
  const v = p.versions.find((x) => x.id === versionId);
  const fromDrive = !isWepekaDesk() && !!(v?.drive?.id || v?.driveFiles?.length);
  if (!fromDrive && (!v?.local || !p.local?.key || !OUT.connected)) { toast(t("post.client.needFolder"), "error"); return; }
  if (!isWepekaDesk() && v.status !== "approved") { toast(t("post.client.needApproval"), "error"); return; }
  if (clientDriveLine(getBrand(c.brandId)).tone !== "on") { toast(t("post.client.driveOff"), "error"); return; }
  // The brand keeps Wepeka's code letters, so its client reads the same codes.
  const brand = getBrand(c.brandId);
  if (brand && !brand.videoPrefix) updateBrand(brand.id, { videoPrefix: brandCodePrefix(brand.id) });
  SENDING.set(contentId, { pct: 0 });
  repaint();
  try {
    let files;
    let poster = null;
    if (fromDrive) {
      // The cut read back from the owner's own Drive (the same copy the player uses).
      files = [];
      for (const f of ownFiles(c, v)) {
        const blob = await (await fetch(await driveVideoURL(f.id))).blob();
        files.push(new File([blob], f.name, { type: blob.type || "video/mp4" }));
      }
      if (v.kind !== "set" && v.drive?.poster) poster = await driveImageURL(v.drive.poster).then((u) => fetch(u)).then((r) => r.blob()).catch(() => null);
    } else {
      const names = v.kind === "set" ? (v.local.slides || []).map((f) => (v.local.file === "slides" ? f : `${v.local.file}/${f}`)) : [v.local.file];
      files = await Promise.all(names.map((n) => outboxFile(p.local.key, n)));
      poster = v.kind === "set" ? null : await posterBlob(p, v);
    }
    await sendToClient({
      contentId, versionId, kind: v.kind || "video", code: videoCode(c), files, poster,
      onProgress: (f) => {
        const s = SENDING.get(contentId);
        if (s) s.pct = f;
        const fill = document.getElementById("pst-client-fill"), num = document.getElementById("pst-client-pct");
        if (fill) fill.style.width = `${Math.round(f * 100)}%`;
        if (num) num.textContent = `${Math.round(f * 100)}%`;
      },
    });
    toast(t("post.client.sent", { label: versionLabel(v) }));
  } catch (e) {
    console.warn("[posting] send to client failed", e);
    const msg = { setup: "post.client.setup", "drive-off": "post.client.driveOff", "drive-full": "post.client.driveFull" }[e.code] || (e.status === 503 ? "post.client.setup" : "post.client.failed");
    toast(t(msg), "error");
  } finally {
    SENDING.delete(contentId);
    repaint();
  }
}

// "instagram.com/reel/ABC/?igsh=…" → https://www.instagram.com/reel/ABC/
export function igPermalink(s) {
  const m = /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]{5,})/.exec(String(s || ""));
  return m ? `https://www.instagram.com/${m[1] === "reels" ? "reel" : m[1]}/${m[2]}/` : "";
}
const igLinkFieldHTML = (value = "") => `<div class="field pst-ig-link"><label for="pst-ig-link">${t("post.ig.linkLabel")}</label><input class="input" id="pst-ig-link" inputmode="url" placeholder="https://www.instagram.com/reel/…" value="${escapeHtml(value)}"></div>`;

// Uploads to Instagram running in this tab, by piece: { pct }.
const POSTING = new Map();

// The Facebook side of a piece, under its Instagram status.
function fbHTML(c, p, key) {
  const page = fbPageOf(getBrand(c.brandId));
  const fb = p.fb || null;
  const name = escapeHtml(fb?.page || page?.name || "Facebook");
  const row = (cls, title, body = "", action = "") => `<div class="pst-fb ${cls}"><span class="pst-fb-ic">${icon("facebook", { size: 16 })}</span><div><b>${title}</b>${body ? `<small>${body}</small>` : ""}</div>${action}</div>`;
  const send = (label) => (autoPost(c) && page ? `<button type="button" class="btn btn-secondary btn-sm" id="pst-fb-send">${label}</button>` : "");
  if (key === "scheduled") return fb?.state === "scheduled" ? row("", t("post.fb.with", { page: name })) : "";
  if (key !== "published") return "";
  if (!fb) return page && autoPost(c) ? row("is-off", t("post.fb.notShared", { page: escapeHtml(page.name) }), "", send(t("post.fb.send"))) : "";
  if (fb.state === "waiting" || fb.state === "sent" || fb.state === "scheduled") return row("is-going", t("post.fb.going"), t("post.fb.goingBody", { page: name }));
  if (fb.state === "done") return row("is-pub", t("post.fb.done", { page: name }), fb.permalink ? `<a href="${escapeHtml(fb.permalink)}" target="_blank" rel="noopener">${escapeHtml(fb.permalink)}</a>` : fb.slow ? t("post.fb.slow") : "");
  if (fb.state === "skipped") return row("is-off", escapeHtml(fb.error || t("post.fb.skipped")));
  const perm = /pages_manage_posts|permission|\(#(10|200)\)|OAuth|token/i.test(fb.error || "");
  return row("is-fail", t("post.fb.failed"), `${escapeHtml(fb.error || "")}${perm ? `<br>${t("post.fb.permHint")}` : ""}`, send(t("post.fb.retry")));
}

function postHTML(c, p, key, handle, posting = null) {
  const AUTO_POST = autoPost(c);
  // Everyone but Wepeka's account posts by hand (Instagram from Brandlab is
  // its own for now): no "connected" pill, nothing locked behind it.
  const byHandOnly = !isWepekaDesk() && !metaPosts(getBrand(c.brandId));
  const acct = `<div class="pst-acct">${icon("instagram", { size: 18 })}<b>${handle ? `@${escapeHtml(handle)}` : escapeHtml(getBrand(c.brandId)?.name || "")}</b>${byHandOnly ? "" : `<span class="pst-pill ${handle ? "is-on" : ""}">${handle ? t("post.ig.connected") : t("post.ig.notConnected")}</span>`}</div>`;
  if (posting) {
    return `<section class="pst-block pst-post">${acct}
      <div class="pst-progress" role="status"><div class="pst-progress-row">${icon(posting.fb ? "facebook" : "instagram", { size: 14 })}<span>${t(posting.fb ? "post.fb.uploading" : "post.ig.uploading")}</span><b id="pst-ig-pct">${Math.round(posting.pct * 100)}%</b></div><div class="pst-progress-bar"><i id="pst-ig-fill" style="width:${Math.round(posting.pct * 100)}%"></i></div></div>
      <p class="pst-hint">${icon("info", { size: 13 })}${t("post.ig.keepOpen")}</p></section>`;
  }
  if (key === "scheduled" && p.ig?.auto) {
    const going = Date.parse(p.ig.at || "") <= Date.now() + 5 * 60 * 1000;
    return `<section class="pst-block pst-post">${acct}
      <div class="pst-live"><span class="pst-live-ic">${icon(going ? "instagram" : "clock", { size: 20 })}</span><div><b>${going ? t("post.ig.goingTitle") : t("post.ig.scheduledTitle", { when: `${escapeHtml(dayLabel(c.scheduleDate))}, ${escapeHtml(p.time || "")}` })}</b><small>${t(going ? "post.ig.goingBody" : "post.ig.scheduledBody")}</small></div></div>
      ${fbHTML(c, p, key)}
      ${going ? "" : `<div class="pst-decide"><button type="button" class="btn btn-ghost btn-sm" id="pst-unschedule">${t("post.ig.cancel")}</button></div>`}</section>`;
  }
  if (key === "scheduled") {
    return `<section class="pst-block pst-post">${acct}
      <div class="pst-live"><span class="pst-live-ic">${icon("clock", { size: 20 })}</span><div><b>${t("post.ig.markedTitle", { when: `${escapeHtml(dayLabel(c.scheduleDate))}, ${escapeHtml(p.time || "")}` })}</b><small>${t("post.ig.markedBody")}</small></div></div>
      ${uploadKitHTML(c, { captionCopy: true })}
      ${igLinkFieldHTML()}
      <div class="pst-decide">
        <button type="button" class="cl-cta pst-cta" id="pst-posted"><span>${t("post.ig.postedByHand")}</span><span class="cl-cta-dot pst-dot-ok">${icon("check", { size: 16 })}</span></button>
        <button type="button" class="btn btn-ghost btn-sm" id="pst-unschedule">${t("post.ig.cancel")}</button>
      </div></section>`;
  }
  if (key === "published") {
    return `<section class="pst-block pst-post">${acct}
      <div class="pst-live is-pub"><span class="pst-live-ic">${icon("check", { size: 20 })}</span><div><b>${t("post.ig.publishedTitle", { when: escapeHtml(dayLabel(c.publishedDate || c.scheduleDate)) })}</b>${p.ig?.permalink ? `<small><a href="${escapeHtml(p.ig.permalink)}" target="_blank" rel="noopener">${escapeHtml(p.ig.permalink)}</a></small>` : ""}</div></div>
      ${fbHTML(c, p, key)}
      ${p.ig?.permalink ? "" : `${igLinkFieldHTML()}<button type="button" class="btn btn-secondary btn-sm" id="pst-ig-save">${t("post.ig.linkSave")}</button>`}
      ${p.client && !p.ig?.permalink ? `<p class="pst-hint">${icon("info", { size: 13 })}${t("post.client.needLink")}</p>` : ""}</section>`;
  }
  if (key === "failed") {
    return `<section class="pst-block pst-post">${acct}
      <div class="pst-live is-fail"><span class="pst-live-ic">${icon("x", { size: 20 })}</span><div><b>${t("post.ig.failedTitle")}</b><small>${escapeHtml(p.ig?.error || "")}</small></div></div>
      ${uploadKitHTML(c, { captionCopy: true })}
      <div class="pst-decide"><button type="button" class="btn btn-secondary btn-sm" id="pst-retry">${icon("refresh", { size: 14 })}${t("post.ig.retry")}</button>${p.ig?.auto ? `<button type="button" class="btn btn-ghost btn-sm" id="pst-unschedule">${t("post.ig.cancel")}</button>` : ""}</div></section>`;
  }
  // Until a video is approved and the account is connected, this step is
  // one line saying what unlocks it — no greyed-out form to puzzle over.
  // Ready: the copy buttons sit by the caption box (it copies what's in it).
  const capCopy = key === "ready" ? `<span class="pst-cap-copy">${kitCopyHTML(c, "caption", t("pqu.copyCaption"), "is-main")}${kitCopyHTML(c, "tags", t("pqu.copyTagsShort"))}</span>` : "";
  const caption = `<div class="field"><label for="pst-caption">${t("post.ig.caption")} <span class="pst-count" id="pst-count">${(c.caption || "").length}/2200</span>${capCopy}</label><textarea class="textarea" id="pst-caption" rows="4" maxlength="2200" placeholder="${escapeHtml(t("post.ig.captionPh"))}">${escapeHtml(c.caption || "")}</textarea></div>`;
  // The day and hour it goes up, settable from the start (the slot on
  // Instagram is only booked once a cut is approved).
  const when = `<div class="pst-when">
      <div class="field"><label for="pst-date">${t("post.ig.date")}</label><input class="input" type="date" id="pst-date" value="${escapeHtml(c.scheduleDate || "")}"></div>
      <div class="field"><label for="pst-time-in">${t("post.ig.time")}</label><input class="input" type="time" id="pst-time-in" value="${escapeHtml(p.time || "")}"></div>
    </div>`;
  // Posted outside Brandlab (a brand with no Instagram here, or a cut put up
  // before it was approved): "Sudah tayang" is always one click away
  // (owner, 2026-11-13).
  const byHand = `<div class="pst-decide pst-byhand"><button type="button" class="btn btn-secondary" id="pst-posted">${icon("check", { size: 15 })}${t("post.ig.alreadyPosted")}</button><small>${t("post.ig.byHandHint")}</small></div>`;
  if (key !== "ready" || (!handle && !byHandOnly)) {
    return `<section class="pst-block pst-post is-locked">${acct}${when}${caption}<p class="pst-hint">${icon("lock", { size: 13 })}${!handle && !byHandOnly ? t("post.ig.connectHint") : t("post.ig.needApproval")}</p>${byHand}</section>`;
  }
  // Facebook too (owner, 2026-11-07): one switch, remembered for the brand.
  const brand = getBrand(c.brandId);
  const page = AUTO_POST ? fbPageOf(brand) : null;
  const fbSwitch = !AUTO_POST ? "" : page
    ? `<label class="pst-switch pst-fb-switch"><input type="checkbox" id="pst-fb" ${shareFb(brand) ? "checked" : ""}><span><b>${icon("facebook", { size: 14 })}${t("post.fb.share")}</b><small>${t("post.fb.shareHint", { page: escapeHtml(page.name) })}</small></span></label>`
    : `<p class="pst-hint">${icon("facebook", { size: 13 })}${t("post.fb.connectHint")}</p>`;
  return `
    <section class="pst-block pst-post">
      ${acct}
      ${uploadKitHTML(c)}
      ${when}
      ${caption}
      ${fbSwitch}
      ${AUTO_POST ? "" : `<p class="pst-hint">${icon("info", { size: 13 })}${t("post.ig.manualNote")}</p>`}
      ${AUTO_POST ? `<p class="pst-hint">${icon("info", { size: 13 })}${t("post.ig.autoNote")}</p>` : ""}
      <div class="pst-decide">
        <button type="button" class="cl-cta pst-cta pst-go" id="pst-schedule"><span>${t(AUTO_POST ? "post.ig.cta" : "post.ig.ctaMark")}</span><span class="cl-cta-dot pst-dot-ig">${icon(AUTO_POST ? "instagram" : "calendar", { size: 16 })}</span></button>
        ${AUTO_POST ? `<button type="button" class="btn btn-secondary" id="pst-post-now">${icon("send", { size: 15 })}${t("post.ig.now")}</button>` : ""}
        <button type="button" class="btn btn-ghost" id="pst-posted">${icon("check", { size: 15 })}${t("post.ig.alreadyPosted")}</button>
      </div>
    </section>`;
}

// The files of a cut to post, and the reel's cover: from the Mac folder
// (Wepeka's desk) or from the owner's Google Drive — the cover then is the
// piece's own thumbnail from Creator, when it's a JPEG (Instagram takes
// only that).
async function cutFiles(c, v) {
  const cp = postingOf(c);
  const isReel = (cp.type || "reels") === "reels" && (v.kind || "video") === "video";
  if (readsFromMac(v)) {
    const names = v.kind === "set" ? (v.local.slides || []).map((f) => (v.local.file === "slides" ? f : `${v.local.file}/${f}`)) : [v.local.file];
    const files = await Promise.all(names.map((n) => outboxFile(cp.local.key, n)));
    const cover = isReel && /\.jpe?g$/i.test(cp.cover || "") ? await outboxFile(cp.local.key, cp.cover).catch(() => null) : null;
    return { files, cover };
  }
  const files = [];
  for (const f of ownFiles(c, v)) {
    const blob = await (await fetch(await driveVideoURL(f.id))).blob();
    files.push(new File([blob], f.name, { type: blob.type || "" }));
  }
  let cover = null;
  if (isReel && /^(data:image\/jpe?g|https:)/.test(String(c.thumbnail || ""))) {
    try {
      const b = await (await fetch(c.thumbnail)).blob();
      if (/jpe?g/.test(b.type)) cover = new File([b], "cover.jpg", { type: "image/jpeg" });
    } catch {
      // No cover: Instagram picks a frame.
    }
  }
  return { files, cover };
}

function wire(root, contentId, ui, repaint) {
  const c = getContent(contentId);
  const p = postingOf(c);
  const save = (patch) => updateContent(contentId, { posting: { ...postingOf(getContent(contentId)), ...patch } });
  const setV = (fn) => save({ versions: postingOf(getContent(contentId)).versions.map((x) => (x.id === ui.vid ? fn(x) : x)) });

  // Players: the newest drives, the older one follows (compare view). A
  // player kept from the last paint (keepPlayers) may already be loaded and
  // even playing; its listeners from that paint are gone (ui.ac).
  const { signal } = ui.ac;
  const vids = qsa("video", root);
  const main = vids[vids.length - 1];
  const play = qs("#pst-play", root), seek = qs("#pst-seek", root), time = qs("#pst-time", root);
  if (main) {
    const marks = qsa(".pst-mark", root);
    const here = qsa("[data-note-at]", root);
    const showPlaying = () => {
      const on = !main.paused;
      play.innerHTML = icon(on ? "pause" : "play", { size: 16 });
      play.setAttribute("aria-label", on ? t("post.pause") : t("post.play"));
    };
    const sync = () => {
      ui.t = main.currentTime;
      seek.value = main.currentTime;
      time.textContent = `${clock(main.currentTime)} / ${clock(main.duration || 0)}`;
      vids.forEach((x) => { if (x !== main && Math.abs(x.currentTime - main.currentTime) > 0.25) x.currentTime = Math.min(main.currentTime, x.duration || 0); });
      const at = clock(main.currentTime);
      const stamp = qs("#pst-compose-t", root);
      if (stamp) {
        stamp.textContent = at;
        const send = qs("#pst-note-send", root);
        if (send) send.textContent = t("post.note.send", { time: at });
      }
      const frame = qs("#pst-th-time", root);
      if (frame) frame.textContent = at;
      // The note being looked at lights up while the video passes it.
      here.forEach((n) => n.classList.toggle("is-now", Math.abs(+n.dataset.noteAt - main.currentTime) < 1.5));
    };
    const meta = () => {
      seek.max = main.duration || 1;
      marks.forEach((m) => m.style.setProperty("--at", Math.min(1, +m.dataset.markT / (main.duration || 1))));
      sync();
      // A cut from the folder carries no size yet: check it once it's read.
      const cur = p.versions.find((x) => x.id === ui.vid);
      const line = qs("#pst-format", root);
      if (cur && line) line.innerHTML = formatLineHTML({ ...cur, w: main.videoWidth, h: main.videoHeight, dur: main.duration });
    };
    if (main.readyState >= 1) meta();
    main.addEventListener("loadedmetadata", meta, { signal });
    main.addEventListener("timeupdate", sync, { signal });
    main.addEventListener("play", showPlaying, { signal });
    main.addEventListener("pause", showPlaying, { signal });
    main.addEventListener("ended", () => vids.forEach((x) => x.pause()), { signal });
    showPlaying();
    play.addEventListener("click", () => {
      const go = main.paused;
      vids.forEach((x) => (go ? x.play().catch(() => {}) : x.pause()));
    });
    seek.addEventListener("input", () => { vids.forEach((x) => { x.currentTime = Math.min(+seek.value, x.duration || +seek.value); }); });
    vids.forEach((x) => x.addEventListener("click", () => play.click(), { signal }));
  }
  // The client's cuts: through whoever's Drive holds them (clientDriveKey).
  const driveKey = ui.client ? clientDriveKey(getContent(contentId)) : null;
  qsa(".pst-player[data-drive]:not([data-ready])", root).forEach((box) => {
    const video = qs("video", box), loading = qs(".pst-loading", box), pct = qs(".pst-loading b", box);
    driveVideoURL(box.dataset.drive, { key: driveKey, onProgress: (f) => { if (pct) pct.textContent = `${Math.round(f * 100)}%`; } })
      .then((url) => { video.src = url; box.dataset.ready = "1"; loading?.remove(); })
      .catch(() => { if (loading) loading.innerHTML = `${icon("info", { size: 16 })}<span>${t("post.loadFailed")}</span>`; });
  });
  // The client's own Drive: slides of a carousel, and the cuts' stills.
  qsa("img[data-drive-img]", root).forEach((img) => { driveVideoURL(img.dataset.driveImg, { key: driveKey }).then((url) => { img.src = url; }).catch(() => {}); });
  qsa("[data-vposter]", root).forEach((el) => {
    driveVideoURL(el.dataset.vposter, { key: driveKey }).then((src) => { if (el.isConnected) { el.style.backgroundImage = `url("${src}")`; el.classList.add("has-img"); } }).catch(() => {});
  });
  wireSlides(root);
  qs("#pst-connect", root)?.addEventListener("click", () => goConnect(contentId));
  qs("#pst-local", root)?.addEventListener("click", async () => { await linkOutbox(); repaint(); });
  const key = p.local?.key;
  if (key && OUT.connected) {
    qsa(".pst-player[data-local]:not([data-ready])", root).forEach((box) => {
      outboxFileURL(key, box.dataset.local).then((url) => { qs("video", box).src = url; box.dataset.ready = "1"; }).catch(() => { box.insertAdjacentHTML("beforeend", `<span class="pst-loading">${icon("info", { size: 16 })}<span>${t("post.local.missing")}</span></span>`); });
    });
    qsa("img[data-local-img]", root).forEach((img) => { outboxFileURL(key, img.dataset.localImg).then((url) => { img.src = url; }).catch(() => {}); });
    qsa("[data-vthumb]", root).forEach((el) => {
      const x = p.versions.find((y) => y.id === el.dataset.vthumb);
      if (!x?.local) return;
      outboxThumb(key, x).then((src) => { if (src && el.isConnected) { el.style.backgroundImage = `url("${src}")`; el.classList.add("has-img"); } }).catch(() => {});
    });
  }
  qsa("[data-type]", root).forEach((b) => b.addEventListener("click", () => {
    updateContent(contentId, { format: FORMAT_OF[b.dataset.type], posting: { ...postingOf(getContent(contentId)), type: b.dataset.type } });
    repaint();
  }));
  qsa("[data-cover]", root).forEach((b) => b.addEventListener("click", () => { save({ cover: b.dataset.cover }); repaint(); }));
  qs("#pst-cover-frame", root)?.addEventListener("click", async () => {
    if (!main?.videoWidth) { toast(t("post.cover.notReady"), "error"); return; }
    const cv = document.createElement("canvas");
    cv.width = main.videoWidth;
    cv.height = main.videoHeight;
    cv.getContext("2d").drawImage(main, 0, 0);
    const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.9));
    if (blob) addCover(contentId, blob, `cover-frame-${clock(main.currentTime).replace(":", "m")}s.jpg`, repaint);
  });
  qs("#pst-cover-file", root)?.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.addEventListener("change", () => {
      const f = input.files[0];
      if (f) addCover(contentId, f, `cover-${Date.now().toString(36).slice(-4)}.${extOf(f.name) === "mp4" ? "jpg" : extOf(f.name)}`, repaint);
    });
    input.click();
  });
  qs("#pst-trialreel", root)?.addEventListener("change", (e) => { save({ trialReel: e.target.checked }); repaint(); });
  qsa("[data-copy-code]", root).forEach((b) => b.addEventListener("click", () => copyCode(b.dataset.copyCode)));
  qsa("[data-trial-open]", root).forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.trialOpen === contentId) return;
    openPosting({ contentId: b.dataset.trialOpen });
  }));
  qs("#pst-trial-add", root)?.addEventListener("click", () => {
    const made = createTrial(contentId);
    if (!made) return;
    openPosting({ contentId: made.id });
  });
  qsa("[data-seek]", root).forEach((b) => b.addEventListener("click", () => { vids.forEach((x) => { x.currentTime = +b.dataset.seek; }); }));

  qsa("[data-vid]", root).forEach((b) => b.addEventListener("click", () => { ui.vid = b.dataset.vid; paint(root, contentId, ui, repaint); }));
  // Centre the chosen cut in its row, sideways only: the drawer itself
  // stays where it was scrolled (scrollIntoView jumped it to the cards).
  const onCard = qs(".pst-vcard.is-on", root);
  if (onCard) {
    const row = onCard.parentElement;
    row.scrollLeft += onCard.getBoundingClientRect().left - row.getBoundingClientRect().left - (row.clientWidth - onCard.offsetWidth) / 2;
  }
  qs("#pst-compare", root)?.addEventListener("click", () => { ui.compare = !ui.compare; paint(root, contentId, ui, repaint); });
  // The drawer follows the upload through its watcher (openPosting).
  qs("#pst-add", root)?.addEventListener("click", () => pickFile((f) => addVersion(contentId, f, ui.onChange)));

  // Drop a new version anywhere on the video block.
  const drop = qs("#pst-drop", root);
  drop?.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); drop.classList.add("is-over"); } });
  drop?.addEventListener("dragleave", (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove("is-over"); });
  drop?.addEventListener("drop", (e) => {
    drop.classList.remove("is-over");
    const f = [...(e.dataTransfer?.files || [])][0];
    if (!f) return;
    e.preventDefault();
    addVersion(contentId, f, ui.onChange);
  });

  // Approving a version makes it the one that gets posted.
  qs("#pst-ok", root)?.addEventListener("click", async () => {
    const v = p.versions.find((x) => x.id === ui.vid);
    if (ui.client) {
      // The client: through the server, and the older cuts leave their Drive.
      const older = clientPosting(postingOf(getContent(contentId))).versions.length > 1;
      const ok = await confirmDialog({ title: t("post.cl.confirmTitle", { label: versionLabel(v) }), message: t(older ? "post.cl.confirmOlder" : "post.cl.confirmOne"), confirmLabel: t("post.cl.confirmCta") });
      if (!ok) return;
      try {
        await clientDecide({ contentId, versionId: ui.vid, verdict: "approve" });
        toast(t("post.cl.approvedToast"));
      } catch (e) {
        toast(e.code === "stale" ? tc("post.cl.stale") : t("post.cl.failed"), "error");
      }
      return;
    }
    setV((x) => ({ ...x, status: "approved" }));
    markFinalInDrive(p, p.finalId, ui.vid);
    save({ finalId: ui.vid });
    keepClientFinal(contentId);
    toast(t("post.toast.approved", { label: versionLabel(v) }));
    repaint();
  });
  qs("#pst-use", root)?.addEventListener("click", () => { markFinalInDrive(p, p.finalId, ui.vid); save({ finalId: ui.vid }); keepClientFinal(contentId); repaint(); });
  qs("#pst-undo", root)?.addEventListener("click", () => { setV((x) => ({ ...x, status: "pending" })); repaint(); });
  // A note is pinned to the second on screen; the video stays there after
  // it's added (the player is kept), so pressing play carries on. A
  // whole-video note has no second (t: null).
  const timed = !!qs("#pst-compose-t", root);
  const whole = !!qs('[data-note-scope="whole"].is-on', root);
  const noteBox = qs("#pst-note-text", root);
  qsa("[data-note-scope]", root).forEach((b) => b.addEventListener("click", () => {
    ui.noteWhole = b.dataset.noteScope === "whole";
    repaint();
    qs("#pst-note-text", root)?.focus();
  }));
  const sendNote = () => {
    const text = noteBox?.value.trim();
    if (!text) { noteBox?.focus(); return; }
    // Read off the player itself: right after a seek, ui.t still waits for timeupdate.
    const at = whole ? null : timed ? Math.floor(main ? main.currentTime : ui.t || 0) : ui.client ? null : 0;
    if (ui.client) {
      // The client's note goes through the server (they can't write the piece).
      const btn = qs("#pst-note-send", root);
      if (btn) btn.disabled = true;
      clientDecide({ contentId, versionId: ui.vid, verdict: "revise", note: { t: at, text } }).then(() => {
        ui.noteDraft = "";
        ui.noteWhole = false;
        toast(whole || at === null ? t("post.note.addedWhole") : t("post.note.added", { time: clock(at) }));
        repaint();
      }).catch((e) => {
        if (btn) btn.disabled = false;
        toast(e.code === "stale" ? tc("post.cl.stale") : t("post.cl.failed"), "error");
      });
      return;
    }
    const cur = postingOf(getContent(contentId));
    // A note on an unchecked cut is asking for changes.
    save({
      versions: cur.versions.map((x) => (x.id === ui.vid && x.status === "pending" ? { ...x, status: "revision" } : x)),
      notes: [...cur.notes, { id: `n${Date.now().toString(36)}`, versionId: ui.vid, t: at, text, at: Date.now(), done: false }],
    });
    ui.noteDraft = "";
    // Back to "at this second", so the next note isn't filed for the whole video by mistake.
    ui.noteWhole = false;
    toast(whole ? t("post.note.addedWhole") : timed ? t("post.note.added", { time: clock(at) }) : t("post.note.addedPlain"));
    repaint();
  };
  qs("#pst-note-send", root)?.addEventListener("click", sendNote);
  // Typing stops the video, so the second doesn't run on while writing (a
  // whole-video note can be written while it plays).
  const hold = () => { if (!whole && main && !main.paused) vids.forEach((x) => x.pause()); };
  ["focus", "pointerdown"].forEach((ev) => noteBox?.addEventListener(ev, hold));
  noteBox?.addEventListener("input", () => { hold(); ui.noteDraft = noteBox.value; });
  noteBox?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendNote(); } });
  qsa("[data-note]", root).forEach((box) => box.addEventListener("change", () => {
    save({ notes: postingOf(getContent(contentId)).notes.map((n) => (n.id === box.dataset.note ? { ...n, done: box.checked } : n)) });
    repaint();
  }));

  // Send to editor: the form keeps what's typed and unticked across repaints.
  qs("#pst-ed-open", root)?.addEventListener("click", () => {
    ui.editorOpen = true;
    ui.edDraft = { msg: "", off: [] };
    paint(root, contentId, ui, repaint);
    setTimeout(() => qs("#pst-ed-msg", root)?.focus(), 30);
  });
  qs("#pst-ed-close", root)?.addEventListener("click", () => { ui.editorOpen = false; paint(root, contentId, ui, repaint); });
  qs("#pst-ed-msg", root)?.addEventListener("input", (e) => { ui.edDraft.msg = e.target.value; });
  qsa("[data-ed-note]", root).forEach((box) => box.addEventListener("change", () => {
    const off = new Set(ui.edDraft.off);
    if (box.checked) off.delete(box.dataset.edNote);
    else off.add(box.dataset.edNote);
    ui.edDraft.off = [...off];
  }));
  qs("#pst-ed-send", root)?.addEventListener("click", () => {
    const message = qs("#pst-ed-msg", root)?.value.trim() || "";
    const noteIds = qsa("[data-ed-note]", root).filter((b) => b.checked).map((b) => b.dataset.edNote);
    if (!message && !noteIds.length) { toast(t("post.editor.empty"), "error"); qs("#pst-ed-msg", root)?.focus(); return; }
    if (!sendToEditor(contentId, { message, noteIds })) return;
    ui.editorOpen = false;
    ui.edDraft = null;
    repaint();
  });
  qs("#pst-ed-undo", root)?.addEventListener("click", () => { cancelEditor(contentId); repaint(); });

  // Ask editor to make thumbnail: same pattern, a message and the frame on screen.
  qs("#pst-th-open", root)?.addEventListener("click", () => {
    ui.thumbOpen = true;
    ui.thDraft = { msg: "", frame: true };
    paint(root, contentId, ui, repaint);
    setTimeout(() => qs("#pst-th-msg", root)?.focus(), 30);
  });
  qs("#pst-th-close", root)?.addEventListener("click", () => { ui.thumbOpen = false; paint(root, contentId, ui, repaint); });
  qs("#pst-th-msg", root)?.addEventListener("input", (e) => { ui.thDraft.msg = e.target.value; });
  qs("#pst-th-frame", root)?.addEventListener("change", (e) => { ui.thDraft.frame = e.target.checked; });
  qs("#pst-th-send", root)?.addEventListener("click", () => {
    const message = qs("#pst-th-msg", root)?.value.trim() || "";
    const frame = !!qs("#pst-th-frame", root)?.checked && !!main;
    if (!askThumbnail(contentId, { message, at: frame ? Math.floor(main.currentTime) : null, vid: ui.vid })) return;
    ui.thumbOpen = false;
    ui.thDraft = null;
    repaint();
  });
  qs("#pst-th-undo", root)?.addEventListener("click", () => { cancelThumbnail(contentId); repaint(); });

  const cap = qs("#pst-caption", root);
  cap?.addEventListener("input", () => { qs("#pst-count", root).textContent = `${cap.value.length}/2200`; });
  cap?.addEventListener("change", () => { updateContent(contentId, { caption: cap.value }); writeBack(contentId); });
  // Locked or not, the day and hour save as soon as they're picked.
  qs("#pst-date", root)?.addEventListener("change", (e) => { updateContent(contentId, { scheduleDate: e.target.value }); repaint(); });
  qs("#pst-time-in", root)?.addEventListener("change", (e) => { save({ time: e.target.value }); repaint(); });

  // From the Mac folder (Wepeka's desk) or the owner's Drive (a brand
  // connected through "Hubungkan akun Meta"): the server posts it (at the
  // hour, or now).
  const goInstagram = async (now) => {
    if (POSTING.has(contentId)) return;
    const cur = getContent(contentId);
    const cp = postingOf(cur);
    const v = isWepekaDesk() ? cp.versions.find((x) => x.id === cp.finalId) : postCutOf(cur);
    if (isWepekaDesk() && (!v?.local || !cp.local?.key || !OUT.connected)) { toast(t("post.client.needFolder"), "error"); return; }
    if (!v) { toast(t("post.ig.needApproval"), "error"); return; }
    const date = now ? localISODate() : qs("#pst-date", root).value;
    const hhmm = now ? new Date().toTimeString().slice(0, 5) : qs("#pst-time-in", root).value || "19:00";
    const at = now ? Date.now() : Date.parse(`${date}T${hhmm}:00+07:00`);
    if (!now && (!date || !(at > Date.now()))) { toast(t("post.ig.past"), "error"); return; }
    const brand = getBrand(cur.brandId);
    const facebook = shareFb(brand);
    const handle = escapeHtml(igHandleOf(brand) || "Instagram");
    if (now && !(await confirmDialog({ title: t("post.ig.nowTitle"), message: facebook ? t("post.ig.nowBodyFb", { handle, page: escapeHtml(fbPageOf(brand).name) }) : t("post.ig.nowBody", { handle }), confirmLabel: t("post.ig.now") }))) return;
    updateContent(contentId, { scheduleDate: date, caption: cap?.value ?? cur.caption, posting: { ...cp, time: hhmm } });
    POSTING.set(contentId, { pct: 0 });
    repaint();
    try {
      const { files, cover } = await cutFiles(cur, v);
      const r = await postToInstagram({
        contentId, kind: v.kind || "video", files, cover, at, facebook,
        onProgress: (f) => {
          const s = POSTING.get(contentId);
          if (s) s.pct = f;
          const fill = document.getElementById("pst-ig-fill");
          const num = document.getElementById("pst-ig-pct");
          if (fill) fill.style.width = `${Math.round(f * 100)}%`;
          if (num) num.textContent = `${Math.round(f * 100)}%`;
        },
      });
      if (r.state === "done") toast(t("post.toast.igPosted"));
      else if (r.state === "failed") toast(r.error || t("post.ig.err.server"), "error");
      else toast(now ? t("post.toast.igProcessing") : t("post.toast.scheduled", { when: `${dayLabel(date)}, ${hhmm}` }));
    } catch (e) {
      console.warn("[posting] instagram", e);
      toast(t(`post.ig.err.${["account", "type", "size", "busy", "slides"].includes(e.code) ? e.code : "server"}`), "error");
    } finally {
      POSTING.delete(contentId);
      repaint();
    }
  };
  qs("#pst-post-now", root)?.addEventListener("click", () => goInstagram(true));
  qs("#pst-fb", root)?.addEventListener("change", (e) => { updateBrand(getContent(contentId).brandId, { shareFacebook: e.target.checked }); });

  // Facebook only, for a piece already on Instagram: the approved cut again
  // from the Mac folder, straight to the Page.
  qs("#pst-fb-send", root)?.addEventListener("click", async () => {
    if (POSTING.has(contentId)) return;
    const cur = getContent(contentId);
    const cp = postingOf(cur);
    const v = isWepekaDesk() ? cp.versions.find((x) => x.id === cp.finalId) || latestOf(cp) : postCutOf(cur);
    if (isWepekaDesk() && (!v?.local || !cp.local?.key || !OUT.connected)) { toast(t("post.client.needFolder"), "error"); return; }
    if (!v) { toast(t("post.ig.needApproval"), "error"); return; }
    const page = fbPageOf(getBrand(cur.brandId));
    if (!page) { toast(t("post.ig.err.page"), "error"); return; }
    if (!(await confirmDialog({ title: t("post.fb.sendTitle"), message: t("post.fb.sendBody", { page: escapeHtml(page.name) }), confirmLabel: t("post.fb.send") }))) return;
    POSTING.set(contentId, { pct: 0, fb: true });
    repaint();
    try {
      const { files, cover } = await cutFiles(cur, v);
      const r = await shareToFacebook({
        contentId, kind: v.kind || "video", files, cover,
        onProgress: (f) => {
          const s = POSTING.get(contentId);
          if (s) s.pct = f;
          const fill = document.getElementById("pst-ig-fill");
          const num = document.getElementById("pst-ig-pct");
          if (fill) fill.style.width = `${Math.round(f * 100)}%`;
          if (num) num.textContent = `${Math.round(f * 100)}%`;
        },
      });
      if (r.fb?.state === "failed") toast(r.fb.error || t("post.ig.err.server"), "error");
      else toast(t("post.toast.fbSent"));
    } catch (e) {
      console.warn("[posting] facebook", e);
      toast(t(`post.ig.err.${["page", "type", "size", "busy"].includes(e.code) ? e.code : "server"}`), "error");
    } finally {
      POSTING.delete(contentId);
      repaint();
    }
  });
  qs("#pst-schedule", root)?.addEventListener("click", () => {
    if (autoPost(getContent(contentId))) { goInstagram(false); return; }
    const date = qs("#pst-date", root).value;
    const hhmm = qs("#pst-time-in", root).value || "19:00";
    if (!date || new Date(`${date}T${hhmm}:00`) <= new Date()) { toast(t("post.ig.past"), "error"); return; }
    updateContent(contentId, {
      scheduleDate: date, caption: cap?.value ?? c.caption, status: "scheduled",
      posting: { ...postingOf(getContent(contentId)), time: hhmm, ig: { state: "scheduled", at: `${date}T${hhmm}:00+07:00` } },
    });
    toast(t("post.toast.marked", { when: `${dayLabel(date)}, ${hhmm}` }));
    repaint();
  });
  // Posted: with the Reels link, the client's copies go and the link shows instead.
  const readLink = () => {
    const raw = qs("#pst-ig-link", root)?.value.trim() || "";
    const link = igPermalink(raw);
    if (raw && !link) { toast(t("post.ig.linkBad"), "error"); return null; }
    return link;
  };
  const afterLink = (link) => {
    if (link && Object.keys(postingOf(getContent(contentId)).previews || {}).length) cleanPreviews(contentId).catch((e) => console.warn("[posting] previews not cleaned", e));
  };
  wireUploadKit(root, { repaint });
  qs("#pst-posted", root)?.addEventListener("click", () => {
    const link = readLink();
    if (link === null) return;
    markPostedByHand(contentId, link);
    toast(t("post.toast.posted"));
    repaint();
  });
  qs("#pst-ig-save", root)?.addEventListener("click", () => {
    const link = readLink();
    if (!link) { if (link === "") toast(t("post.ig.linkBad"), "error"); return; }
    const cur = postingOf(getContent(contentId));
    updateContent(contentId, { publishedUrl: link, posting: { ...cur, ig: { ...(cur.ig || {}), state: "published", permalink: link } } });
    afterLink(link);
    toast(t("post.ig.linkSaved"));
    repaint();
  });
  qs("#pst-client-send", root)?.addEventListener("click", () => sendCut(contentId, ui.vid, repaint));
  qs("#pst-client-copy", root)?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(clientQueueURL(c.brandId)); } catch { /* shown below */ }
    toast(t("post.client.copied"));
  });
  qs("#pst-client-invite", root)?.addEventListener("click", async () => {
    const { openShareDialog } = await import("./views/team-panel.js");
    openShareDialog({ brandId: c.brandId, role: "klien" });
  });
  qs("#pst-unschedule", root)?.addEventListener("click", async () => {
    if (postingOf(getContent(contentId)).ig?.auto) {
      try { await cancelInstagramPost(contentId); } catch (e) { toast(t(e.code === "busy" ? "post.ig.err.busy" : "post.ig.err.server"), "error"); return; }
    }
    updateContent(contentId, { status: "editing", posting: { ...postingOf(getContent(contentId)), ig: null, fb: null } });
    toast(t("post.toast.unscheduled"));
    repaint();
  });
  qs("#pst-retry", root)?.addEventListener("click", () => {
    if (p.ig?.auto) { goInstagram(true); return; }
    updateContent(contentId, { status: "scheduled", posting: { ...postingOf(getContent(contentId)), ig: { ...p.ig, state: "scheduled", error: "" } } });
    repaint();
  });
}
