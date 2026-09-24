// Pengumuman (announcements) — what's new and what got fixed in Brandlab,
// written by the Wepeka team and read by every account.
//
// Data: Firestore `announcements/{id}` — { title, body, kind, link,
// createdAt, updatedAt, authorUid }. Any signed-in account reads; only an
// admin (ADMIN_UIDS in js/account.js, mirrored in firestore.rules) can
// write, so the composer on the page is shown to admins only and the rules
// are what actually enforce it.
//
// "Unread" = newer than the last time this account opened the page
// (settings.announcementsSeenAt, with a browser copy for read-only
// accounts, which can't write settings).
import {
  collection, doc, query, orderBy, limit, onSnapshot, setDoc, updateDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { db as fdb } from "./firebase.js";
import { isAdmin, currentUid, getCachedAccount, isReadOnly } from "./account.js";
import { getSettings, updateSettings } from "./store.js";

export const KINDS = ["feature", "fix", "info"];
const MAX = 50;
const SEEN_LOCAL = "brandlab:announcements-seen:";

let items = [];
let status = "idle"; // idle | loading | ready | error
let unsub = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } });

export const isAnnouncementAdmin = () => isAdmin(currentUid());
export const listAnnouncements = () => items;
export const announcementsStatus = () => status;

// Live list, started once after login (js/layout.js wireShell). A new post
// reaches everyone without a reload.
export function startAnnouncements() {
  if (unsub || !currentUid()) return;
  status = "loading";
  unsub = onSnapshot(
    query(collection(fdb, "announcements"), orderBy("createdAt", "desc"), limit(MAX)),
    (snap) => {
      items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      status = "ready";
      notify();
    },
    (err) => {
      console.warn("[announcements] listen failed", err);
      status = "error";
      notify();
    }
  );
}

export function stopAnnouncements() {
  unsub?.();
  unsub = null;
  items = [];
  status = "idle";
}

export function onAnnouncements(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---- Read / unread ------------------------------------------------------------

export function announcementsSeenAt() {
  const onAccount = Number(getSettings()?.announcementsSeenAt) || 0;
  let local = 0;
  try { local = Number(localStorage.getItem(SEEN_LOCAL + (currentUid() || ""))) || 0; } catch { /* private mode */ }
  return Math.max(onAccount, local);
}

export function unreadCount() {
  const seen = announcementsSeenAt();
  return items.filter((a) => (a.createdAt || 0) > seen).length;
}

export function markAnnouncementsSeen() {
  const newest = items.reduce((m, a) => Math.max(m, a.createdAt || 0), 0);
  const at = Math.max(Date.now(), newest);
  try { localStorage.setItem(SEEN_LOCAL + (currentUid() || ""), String(at)); } catch { /* private mode */ }
  if (!isReadOnly(getCachedAccount())) updateSettings({ announcementsSeenAt: at });
  notify();
}

// ---- Admin writes -------------------------------------------------------------
//
// Shown right away (optimistic), put back if the write is refused.

const clean = ({ title = "", body = "", kind = "info", link = "" }) => ({
  title: String(title).trim().slice(0, 140),
  body: String(body).trim().slice(0, 4000),
  kind: KINDS.includes(kind) ? kind : "info",
  link: /^https:\/\//i.test(String(link).trim()) ? String(link).trim() : "",
});

export async function publishAnnouncement(fields) {
  const ref = doc(collection(fdb, "announcements"));
  const now = Date.now();
  const data = { ...clean(fields), createdAt: now, updatedAt: now, authorUid: currentUid() };
  const before = items;
  items = [{ id: ref.id, ...data }, ...items];
  notify();
  try {
    await setDoc(ref, data);
  } catch (e) {
    items = before;
    notify();
    throw e;
  }
}

export async function editAnnouncement(id, fields) {
  const patch = { ...clean(fields), updatedAt: Date.now() };
  const before = items;
  items = items.map((a) => (a.id === id ? { ...a, ...patch } : a));
  notify();
  try {
    await updateDoc(doc(fdb, "announcements", id), patch);
  } catch (e) {
    items = before;
    notify();
    throw e;
  }
}

export async function removeAnnouncement(id) {
  const before = items;
  items = items.filter((a) => a.id !== id);
  notify();
  try {
    await deleteDoc(doc(fdb, "announcements", id));
  } catch (e) {
    items = before;
    notify();
    throw e;
  }
}
