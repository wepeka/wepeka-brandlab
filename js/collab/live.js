// Kerja Tim — the live layer on a shared brand, over the Realtime Database
// (js/firebase.js loadDatabase; rules in database.rules.json, the team copy
// teams/{brandId} written by api/team.js):
//
//   presence/{brandId}/{uid}  who is on the brand, on which page, which
//                             field they're typing in and where their caret is
//   cursors/{brandId}/{uid}   their mouse, pinned to the element under it
//   scripts/{brandId}/{cid}   a content's Script, written together
//
// On screen, for people on the same page as you: their mouse cursor with
// their name (Figma-style), a blinking "|" in their colour where they type
// (Google Docs-style), the field they type in locked for you ("Rina sedang
// mengetik…") — except the Script, which everyone writes at once — the
// content's AI buttons locked while someone else edits it, and a marker at
// the screen edge when they are out of view. Everyone in the brand shows as
// an avatar in the topbar (dimmed on another page; click = go there): nobody
// is ever pulled along. "Diubah Rina · 5 menit lalu" under the page title.
// Nothing here is written per keystroke; the Script is a CAS transaction
// with a 3-way text merge (js/collab/textmerge.js) a few times a second.
import { auth, loadDatabase } from "../firebase.js";
import { getBrand, isSharedBrand, isOwnBrand, brandRole, storeUid, getContent } from "../store.js";
import { merge3text, moveCaret } from "./textmerge.js";
import { escapeHtml, toast } from "../dom.js";
import { t } from "../i18n.js";

const COLORS = ["#c08af5", "#4fa3ff", "#3ddc84", "#ff8a5c", "#ffc94a", "#f06292", "#4dd0e1", "#a3e635"];
const STALE_MS = 120_000;
const CURSOR_EVERY_MS = 80;
const CARET_EVERY_MS = 150;
const HEARTBEAT_MS = 30_000;
const SCRIPT_COMMIT_MS = 150;
// A field the page saves when you leave it is also saved 1 s after you stop
// typing, so teammates see your words without waiting for you to click away.
const IDLE_SAVE_MS = 1000;
// Written together, so never locked (everyone types at once).
const SHARED_FIELDS = new Set(["f-script-plain"]);
// A content's AI buttons, locked while someone else edits that content.
const AI_BUTTONS = ["ai-generate-all", "ai-quick-script", "ai-quick-caption"];

const hashOf = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const colorFor = (uid) => COLORS[hashOf(uid) % COLORS.length];
const pageOf = (hash = location.hash) => String(hash || "#/").split("?")[0];
const cssEscape = (v) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, "\\$&"));
const isEditable = (el) => !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search|email|url|tel|number|)$/.test(el.type || "")));
function fieldKey(el) {
  if (!el) return null;
  return el.id || el.getAttribute("data-field") || el.getAttribute("data-lock") || null;
}
function fieldEl(key) {
  if (!key) return null;
  return document.getElementById(key) || document.querySelector(`[data-field="${cssEscape(key)}"],[data-lock="${cssEscape(key)}"]`);
}

let live = null;

function myName(brand) {
  const uid = storeUid();
  const m = brand?.members?.[uid];
  const user = auth.currentUser;
  return String(m?.name || (isOwnBrand(brand) ? brand?.ownerName : "") || user?.displayName || (user?.email || "").split("@")[0] || "?").slice(0, 80);
}
export function nameOf(brand, uid) {
  if (!brand || !uid) return "";
  if (uid === brand.ownerId) return brand.ownerName || t("team.role.owner");
  return brand.members?.[uid]?.name || "";
}

// main.js calls this after every route: joins the open brand's live layer
// when it is shared, leaves it otherwise.
export async function syncLive(brandId) {
  const want = brandId && isSharedBrand(brandId) && storeUid() ? brandId : null;
  if (live && live.brandId === want) {
    live.page = pageOf();
    publish();
    return;
  }
  stopLive();
  if (!want) return;
  let conn = null;
  try {
    conn = await loadDatabase();
  } catch (e) {
    console.warn("Live layer unavailable", e);
  }
  if (!conn || !getBrand(want)) return;
  if (live) stopLive();
  start(want, conn);
}

function start(brandId, { sdk, db }) {
  const uid = storeUid();
  const brand = getBrand(brandId);
  live = {
    brandId, uid, sdk, db, page: pageOf(),
    me: { name: myName(brand), color: colorFor(uid) },
    field: null, fieldAt: 0, caret: null,
    others: new Map(), cursors: new Map(),
    els: new Map(), locked: new Map(), aiLocked: new Map(),
    unsubs: [], timers: [], lastCursorAt: 0, lastCaretAt: 0,
    script: null,
  };
  const presRef = sdk.ref(db, `presence/${brandId}/${uid}`);
  const curRef = sdk.ref(db, `cursors/${brandId}/${uid}`);
  live.presRef = presRef;
  live.curRef = curRef;
  sdk.onDisconnect(presRef).remove().catch(() => {});
  sdk.onDisconnect(curRef).remove().catch(() => {});
  publish();
  live.timers.push(setInterval(publish, HEARTBEAT_MS));
  live.unsubs.push(sdk.onValue(sdk.ref(db, `presence/${brandId}`), (snap) => {
    const now = Date.now();
    const next = new Map();
    snap.forEach((child) => {
      const v = child.val();
      if (child.key !== uid && v && now - Number(v.at || 0) < STALE_MS) next.set(child.key, v);
    });
    live && (live.others = next);
    paintAvatars();
  }, (e) => console.warn("Live presence unavailable", e)));
  live.unsubs.push(sdk.onValue(sdk.ref(db, `cursors/${brandId}`), (snap) => {
    const next = new Map();
    snap.forEach((child) => { if (child.key !== uid && child.val()) next.set(child.key, child.val()); });
    live && (live.cursors = next);
  }, (e) => console.warn("Live cursors unavailable", e)));

  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    live.unsubs.push(() => target.removeEventListener(type, fn, opts));
  };
  on(document, "focusin", onFocusIn, true);
  on(document, "focusout", onFocusOut, true);
  on(document, "selectionchange", onCaret);
  on(document, "input", onCaret, true);
  on(document, "input", onTyping, true);
  on(document, "mousemove", onMouseMove, { passive: true });
  on(document, "mouseleave", onMouseLeave);
  on(window, "pagehide", () => stopLive());
  on(document, "visibilitychange", () => { if (document.visibilityState === "visible") publish(); });
  loop();
}

export function stopLive() {
  if (!live) return;
  const l = live;
  live = null;
  l.timers.forEach(clearInterval);
  l.unsubs.forEach((u) => { try { u(); } catch { /* stopped */ } });
  try {
    l.sdk.remove(l.presRef);
    l.sdk.remove(l.curRef);
  } catch {
    /* offline: onDisconnect removes them */
  }
  unbindScript(l);
  l.els.forEach((e) => { e.cursor?.remove(); e.caret?.remove(); e.edge?.remove(); });
  l.locked.forEach((info, el) => releaseLock(el, info));
  l.aiLocked.forEach((info, el) => releaseAi(el, info));
  document.querySelectorAll(".cs-presence, .cs-stamp").forEach((n) => n.remove());
}

// ---------- what I send ----------
function publish() {
  if (!live) return;
  live.page = pageOf();
  live.sdk.set(live.presRef, {
    name: live.me.name, color: live.me.color, page: live.page,
    field: live.field, fieldAt: live.fieldAt || 0, caret: live.caret ?? null, at: Date.now(),
  }).catch((e) => console.warn("Live presence not sent", e?.message));
}
function onFocusIn(e) {
  if (!live) return;
  const el = e.target;
  if (!isEditable(el)) return;
  const key = fieldKey(el);
  if (!key) return;
  // Someone else is already typing here: step back out (their lock won).
  const holder = holderOf(key);
  if (holder && !SHARED_FIELDS.has(key)) {
    el.blur();
    toast(t("collab.lockedBy", { name: holder.name || "" }), "error");
    return;
  }
  live.field = key;
  live.fieldAt = Date.now();
  live.caret = el.selectionStart ?? null;
  publish();
  if (SHARED_FIELDS.has(key)) bindScript(el);
}
function onFocusOut(e) {
  if (!live || fieldKey(e.target) !== live.field) return;
  live.field = null;
  live.caret = null;
  publish();
}
function onCaret() {
  if (!live || !live.field) return;
  const el = document.activeElement;
  if (fieldKey(el) !== live.field) return;
  const now = Date.now();
  if (now - live.lastCaretAt < CARET_EVERY_MS) {
    clearTimeout(live.caretTimer);
    live.caretTimer = setTimeout(onCaret, CARET_EVERY_MS);
    return;
  }
  live.lastCaretAt = now;
  live.caret = el.selectionStart ?? null;
  publish();
}
function onTyping(e) {
  if (!live) return;
  const el = e.target;
  const key = fieldKey(el);
  if (!isEditable(el) || !key || SHARED_FIELDS.has(key) || key !== live.field) return;
  clearTimeout(live.idleTimer);
  live.idleTimer = setTimeout(() => {
    // The page's own "leave the field" save (Creator, the notes, …), without leaving it.
    if (el.isConnected && document.activeElement === el) el.dispatchEvent(new Event("blur"));
  }, IDLE_SAVE_MS);
}
function anchorFor(target) {
  const root = document.getElementById("app") || document.body;
  let el = target instanceof Element ? target : null;
  while (el && el !== root && !(el.id || el.getAttribute?.("data-field") || el.getAttribute?.("data-lock"))) el = el.parentElement;
  if (!el || el === root || !root.contains(el)) el = document.getElementById("view-root") || root;
  const sel = el.id ? `#${cssEscape(el.id)}` : el.getAttribute("data-field") ? `[data-field="${cssEscape(el.getAttribute("data-field"))}"]` : `[data-lock="${cssEscape(el.getAttribute("data-lock"))}"]`;
  return { el, sel };
}
function onMouseMove(e) {
  if (!live) return;
  const now = Date.now();
  if (now - live.lastCursorAt < CURSOR_EVERY_MS) return;
  live.lastCursorAt = now;
  const { el, sel } = anchorFor(e.target);
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  live.sdk.set(live.curRef, { page: pageOf(), sel, fx: +((e.clientX - r.left) / r.width).toFixed(4), fy: +((e.clientY - r.top) / r.height).toFixed(4), at: now }).catch(() => {});
}
function onMouseLeave() {
  if (live) live.sdk.remove(live.curRef).catch(() => {});
}

// ---------- what I see ----------
const samePage = (o) => o && o.page === pageOf();
function holderOf(key) {
  if (!live) return null;
  let best = null;
  live.others.forEach((o, uid) => {
    if (samePage(o) && o.field === key && (!best || Number(o.fieldAt) < Number(best.fieldAt))) best = { ...o, uid };
  });
  // A tie with my own claim: the earlier one keeps it.
  if (best && live.field === key && live.fieldAt && live.fieldAt <= Number(best.fieldAt)) return null;
  return best;
}

function ensureEls(uid, o) {
  let e = live.els.get(uid);
  if (!e) {
    const cursor = document.createElement("div");
    cursor.className = "cs-cursor";
    cursor.innerHTML = `<svg width="20" height="22" viewBox="0 0 20 22" aria-hidden="true"><path d="M2 2 L2 17.5 L6.2 13.6 L9.2 20.2 L12.3 18.8 L9.4 12.4 L15.6 12.2 Z" fill="var(--c)" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><span class="cs-name"></span>`;
    const caret = document.createElement("div");
    caret.className = "cs-caret";
    caret.innerHTML = `<span class="flag"></span>`;
    const edge = document.createElement("button");
    edge.type = "button";
    edge.className = "cs-edge";
    edge.addEventListener("click", () => {
      const c = live?.els.get(uid);
      if (c) scrollTo({ top: Math.max(0, c.y - innerHeight / 2), behavior: "smooth" });
    });
    document.body.append(cursor, caret, edge);
    e = { cursor, caret, edge, x: null, y: null };
    live.els.set(uid, e);
  }
  [e.cursor, e.caret, e.edge].forEach((n) => n.style.setProperty("--c", o.color || colorFor(uid)));
  return e;
}

// Page position of character `pos` in a field (a hidden copy, same box and font).
function caretAt(el, pos) {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.35;
  const m = document.createElement("div");
  ["boxSizing", "width", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "paddingTop", "paddingRight",
    "paddingBottom", "paddingLeft", "fontStyle", "fontWeight", "fontSize", "lineHeight", "fontFamily", "letterSpacing", "wordSpacing", "textTransform", "textIndent", "tabSize"]
    .forEach((p) => { m.style[p] = cs[p]; });
  const single = el.tagName === "INPUT";
  Object.assign(m.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", height: "auto", whiteSpace: single ? "pre" : "pre-wrap", overflowWrap: single ? "normal" : "break-word" });
  m.textContent = String(el.value || "").slice(0, Math.max(0, Math.min(pos, String(el.value || "").length)));
  const mark = document.createElement("span");
  mark.textContent = "\u200b";
  m.appendChild(mark);
  document.body.appendChild(m);
  const x = Math.min(r.left + scrollX + mark.offsetLeft - el.scrollLeft, r.right + scrollX - parseFloat(cs.paddingRight) - 2);
  const y = single ? r.top + scrollY + (r.height - lh) / 2 : r.top + scrollY + mark.offsetTop - el.scrollTop;
  m.remove();
  return { x, y, h: lh, visible: y >= r.top + scrollY - 2 && y <= r.bottom + scrollY - lh / 2 };
}

function lockEl(el, o, uid) {
  const info = live.locked.get(el) || { readOnly: el.readOnly, uid: null };
  if (info.uid !== uid) {
    info.uid = uid;
    el.readOnly = true;
    el.classList.add("cs-locked");
    el.style.setProperty("--c", o.color || colorFor(uid));
    let badge = el.parentElement?.querySelector(`:scope > .cs-lock-badge[data-for="${cssEscape(fieldKey(el))}"]`);
    if (!badge && el.parentElement) {
      badge = document.createElement("span");
      badge.className = "cs-lock-badge";
      badge.dataset.for = fieldKey(el);
      el.parentElement.style.position ||= "relative";
      el.insertAdjacentElement("beforebegin", badge);
    }
    if (badge) {
      badge.style.setProperty("--c", o.color || colorFor(uid));
      badge.textContent = t("collab.typing", { name: o.name || "" });
    }
    info.badge = badge;
  }
  live.locked.set(el, info);
}
function releaseLock(el, info) {
  el.readOnly = !!info.readOnly;
  el.classList.remove("cs-locked");
  el.style.removeProperty("--c");
  info.badge?.remove();
}
function lockAi(btn, editor) {
  if (live.aiLocked.has(btn)) return;
  live.aiLocked.set(btn, { html: btn.innerHTML, title: btn.title, disabled: btn.disabled });
  btn.disabled = true;
  btn.classList.add("cs-ai-locked");
  btn.title = t("collab.aiLockedTitle", { name: editor.name || "" });
  if (btn.id === "ai-generate-all") btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>${escapeHtml(t("collab.editing", { name: editor.name || "" }))}`;
}
function releaseAi(btn, info) {
  btn.innerHTML = info.html;
  btn.title = info.title;
  btn.disabled = info.disabled;
  btn.classList.remove("cs-ai-locked");
}

function loop() {
  if (!live) return;
  const page = pageOf();
  const seen = new Set();
  const wantLocks = new Map();
  let editor = null;
  live.others.forEach((o, uid) => {
    if (!samePage(o)) return;
    seen.add(uid);
    const e = ensureEls(uid, o);
    // Mouse cursor, eased toward where theirs is.
    const c = live.cursors.get(uid);
    const anchor = c && c.page === page ? document.querySelector(c.sel) : null;
    const r = anchor?.getBoundingClientRect();
    if (r && r.width) {
      const tx = r.left + scrollX + c.fx * r.width;
      const ty = r.top + scrollY + c.fy * r.height;
      e.x = e.x === null ? tx : e.x + (tx - e.x) * 0.25;
      e.y = e.y === null ? ty : e.y + (ty - e.y) * 0.25;
      e.cursor.style.display = "";
      e.cursor.style.transform = `translate(${e.x.toFixed(1)}px, ${e.y.toFixed(1)}px)`;
    } else e.cursor.style.display = "none";
    const label = o.field ? (SHARED_FIELDS.has(o.field) ? t("collab.writingScript", { name: o.name || "" }) : t("collab.typing", { name: o.name || "" })) : o.name || "";
    const nameEl = e.cursor.querySelector(".cs-name");
    if (nameEl.textContent !== label) nameEl.textContent = label;
    // Their caret, in their field.
    const fieldNode = o.field ? fieldEl(o.field) : null;
    if (fieldNode && isEditable(fieldNode) && o.caret !== null && o.caret !== undefined) {
      const p = caretAt(fieldNode, Number(o.caret) || 0);
      e.caret.classList.toggle("on", p.visible);
      Object.assign(e.caret.style, { left: `${p.x}px`, top: `${p.y}px`, height: `${p.h}px` });
      const flag = e.caret.querySelector(".flag");
      if (flag.textContent !== (o.name || "")) flag.textContent = o.name || "";
    } else e.caret.classList.remove("on");
    if (o.field && !SHARED_FIELDS.has(o.field) && fieldNode && isEditable(fieldNode)) wantLocks.set(fieldNode, { o, uid });
    if (o.field && !editor) editor = o;
    // Out of view: a marker at the edge.
    const vy = (e.y ?? -1) - scrollY;
    const off = e.cursor.style.display === "none" ? "" : vy < 60 ? "up" : vy > innerHeight - 20 ? "down" : "";
    e.edge.classList.toggle("on", !!off);
    if (off) {
      const txt = `${off === "up" ? "↑" : "↓"} ${label}`;
      if (e.edge.textContent !== txt) e.edge.textContent = txt;
      e.edge.style.left = `${Math.min(Math.max((e.x ?? 0) - scrollX, 16), innerWidth - 240)}px`;
      e.edge.style.top = off === "up" ? "72px" : "";
      e.edge.style.bottom = off === "down" ? "56px" : "";
    }
  });
  // People who left this page (or the brand).
  live.els.forEach((e, uid) => {
    if (seen.has(uid)) return;
    e.cursor.remove();
    e.caret.remove();
    e.edge.remove();
    live.els.delete(uid);
  });
  // Field locks, re-applied after every repaint (new elements).
  live.locked.forEach((info, el) => {
    const want = wantLocks.get(el);
    if (!want || !el.isConnected) {
      releaseLock(el, info);
      live.locked.delete(el);
    }
  });
  wantLocks.forEach(({ o, uid }, el) => lockEl(el, o, uid));
  // The open content's AI buttons while someone else edits it.
  const onContent = /\/content\/creator\/[^/]+/.test(page);
  AI_BUTTONS.forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (editor && onContent) lockAi(btn, editor);
    else if (live.aiLocked.has(btn)) {
      releaseAi(btn, live.aiLocked.get(btn));
      live.aiLocked.delete(btn);
    }
  });
  live.aiLocked.forEach((info, btn) => { if (!btn.isConnected) live.aiLocked.delete(btn); });
  viewerReadOnly();
  paintStamp();
  scriptTick();
  live.raf = requestAnimationFrame(loop);
}

// A viewer only looks: every field of the brand's pages is read-only.
function viewerReadOnly() {
  const viewer = brandRole(live.brandId) === "viewer";
  document.body.classList.toggle("cs-viewer", viewer);
  if (!viewer) return;
  document.querySelectorAll("#view-root input:not([readonly]), #view-root textarea:not([readonly])").forEach((el) => {
    if (isEditable(el) && !/search|cari/i.test(`${el.id} ${el.placeholder}`)) el.readOnly = true;
  });
}

// ---------- avatars in the topbar ----------
function paintAvatars() {
  if (!live) return;
  const right = document.querySelector(".topbar .topbar-right");
  if (!right) return;
  let box = right.querySelector(".cs-presence");
  if (!live.others.size) {
    box?.remove();
    return;
  }
  if (!box) {
    box = document.createElement("div");
    box.className = "cs-presence";
    right.insertBefore(box, right.firstChild);
    box.addEventListener("click", (ev) => {
      const uid = ev.target.closest("[data-person]")?.dataset.person;
      const o = live?.others.get(uid);
      if (o?.page && o.page !== pageOf()) location.hash = o.page;
    });
  }
  const page = pageOf();
  box.innerHTML = [...live.others.entries()].map(([uid, o]) => {
    const away = o.page !== page;
    const title = away ? t("collab.elsewhere", { name: o.name || "" }) : t("collab.here", { name: o.name || "" });
    return `<span data-person="${escapeHtml(uid)}" class="${away ? "away" : ""}" style="--c:${escapeHtml(o.color || colorFor(uid))}" title="${escapeHtml(title)}">${escapeHtml(String(o.name || "?").charAt(0).toUpperCase())}</span>`;
  }).join("");
}
// The topbar is rebuilt on some routes: put the avatars back.
if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
  const watch = () => {
    const app = document.getElementById("app");
    if (!app) return;
    new MutationObserver(() => { if (live && !document.querySelector(".topbar .cs-presence") && live.others.size) paintAvatars(); }).observe(app, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch);
  else watch();
}

// ---------- "Diubah Rina · 5 menit lalu" ----------
function agoText(at) {
  const min = Math.round((Date.now() - Number(at)) / 60000);
  if (min < 1) return t("collab.justNow");
  if (min < 60) return t("collab.minutesAgo", { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t("collab.hoursAgo", { n: h });
  return t("collab.daysAgo", { n: Math.round(h / 24) });
}
function paintStamp() {
  const page = pageOf();
  const brand = getBrand(live.brandId);
  let by = null;
  let at = 0;
  const m = /\/content\/creator\/([^/?]+)/.exec(page);
  if (m) {
    const c = getContent(decodeURIComponent(m[1]));
    by = c?.updatedBy;
    at = c?.updatedAt;
  } else if (/\/(dna|builder)$/.test(page) || /\/dna\//.test(page)) {
    ({ uid: by, at } = brand?.editedBy?.brandDNA || {});
  } else if (/\/guidelines/.test(page)) {
    ({ uid: by, at } = brand?.editedBy?.brandGuidelines || {});
  }
  const host = document.querySelector("#view-root .page-head > div");
  const old = host?.querySelector(".cs-stamp");
  if (!by || !at || !host) {
    old?.remove();
    return;
  }
  const who = by === live.uid ? t("collab.you") : nameOf(brand, by);
  const text = t("collab.editedBy", { name: who, when: agoText(at) });
  if (old?.textContent === text) return;
  const stamp = old || document.createElement("p");
  stamp.className = "cs-stamp";
  stamp.textContent = text;
  if (!old) host.appendChild(stamp);
}

// ---------- the Script, written together ----------
function scriptContentId() {
  return /\/content\/creator\/([^/?]+)/.exec(pageOf())?.[1] || null;
}
function bindScript(box) {
  const cid = scriptContentId();
  if (!live || !cid) return;
  const l = live;
  if (l.script?.cid === cid && l.script.box === box) return;
  const prevShadow = l.script?.cid === cid ? l.script.shadow : null;
  unbindScript(l);
  const s = { cid, box, shadow: prevShadow ?? box.value, applying: false, timer: null, unsub: null, pending: false };
  l.script = s;
  const ref = l.sdk.ref(l.db, `scripts/${l.brandId}/${cid}`);
  s.ref = ref;
  const onInput = () => {
    if (s.applying) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => commit(s), SCRIPT_COMMIT_MS);
  };
  box.addEventListener("input", onInput);
  s.off = () => box.removeEventListener("input", onInput);
  s.unsub = l.sdk.onValue(ref, (snap) => {
    const v = snap.val();
    if (!v || typeof v.text !== "string") {
      // Nobody has written it here yet: start from what's on screen.
      commit(s);
      return;
    }
    if (v.text === s.shadow) return;
    const merged = merge3text(s.shadow, s.box.value, v.text);
    s.shadow = v.text;
    applyText(s, merged);
    if (merged !== v.text) onInput();
  });
}
function unbindScript(l) {
  const s = l?.script;
  if (!s) return;
  clearTimeout(s.timer);
  s.off?.();
  try { s.unsub?.(); } catch { /* stopped */ }
  l.script = null;
}
function commit(s) {
  if (!live || live.script !== s) return;
  const mine = s.box.value;
  const base = s.shadow;
  const uid = live.uid;
  live.sdk.runTransaction(s.ref, (cur) => ({ text: merge3text(base, mine, typeof cur?.text === "string" ? cur.text : base), by: uid, at: Date.now() }))
    .then(({ committed, snapshot }) => {
      if (!committed || !live || live.script !== s) return;
      const text = snapshot.val()?.text ?? mine;
      s.shadow = text;
      if (s.box.value === mine && text !== mine) applyText(s, text);
    })
    .catch((e) => console.warn("Script not shared", e?.message));
}
function applyText(s, next) {
  const box = s.box;
  if (!box.isConnected || box.value === next) return;
  const focused = document.activeElement === box;
  const before = box.value;
  const a = box.selectionStart ?? 0;
  const b = box.selectionEnd ?? 0;
  s.applying = true;
  box.value = next;
  if (focused) box.setSelectionRange(moveCaret(before, next, a), moveCaret(before, next, b));
  // Creator keeps its own copy of the Script in step (its "input" handler).
  box.dispatchEvent(new Event("input", { bubbles: true }));
  s.applying = false;
  // Someone else's words, while I'm not in the box: saved as I'd save mine.
  if (!focused) {
    clearTimeout(s.saveTimer);
    s.saveTimer = setTimeout(() => { if (box.isConnected && document.activeElement !== box) box.dispatchEvent(new Event("blur")); }, 1200);
  }
}
// The Script box is rebuilt on repaints: bind to the new one; and when a
// teammate writes in it while I'm only looking, I see their words too.
function scriptTick() {
  const box = document.getElementById("f-script-plain");
  if (!box) {
    if (live.script) unbindScript(live);
    return;
  }
  const someoneWriting = [...live.others.values()].some((o) => samePage(o) && o.field === "f-script-plain");
  if ((someoneWriting || live.script) && (!live.script || live.script.box !== box)) bindScript(box);
}
