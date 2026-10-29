// Reading a web search off the screen (owner's ask, 2026-10-30: when the chat
// doesn't know "marketing Fore" it asks for a search, and Brandlab reads the
// results from the search window itself — on the owner's own Google, with no
// search API, no stored files and no extra cost).
//
// How: the browser's own "share this tab" (getDisplayMedia) gives one picture
// of the tab, it is cut down to the search window, and the text is read out of
// it on this device (Tesseract, js/ocr.js). Nothing is uploaded except the
// text that goes to the chat, and the share is closed right after the picture.
import { analyzeScreenshot } from "./ocr.js";

export const MAX_WEB_CHARS = 3500;

export const screenReadSupported = () => !!navigator.mediaDevices?.getDisplayMedia;

// The question as the model should read it: the owner's words plus the text
// that was read, fenced so it is clearly a source and not part of the question.
export function webAugment(text, web) {
  if (!web?.text) return text;
  return `${text}\n\nSEARCH RESULTS (read off the owner's screen, search: "${web.q || ""}"):\n${web.text}\nEND OF SEARCH RESULTS`;
}

// OCR of a results page is full of buttons, menus and noise: keep the lines
// that look like words, once each, up to the cap.
const UI_LINES = /^(semua|gambar|video|berita|maps|belanja|buku|alat|filter|all|images|videos|news|shopping|tools|more|lainnya|masuk|sign in|setelan|settings|privasi|privacy|persyaratan|terms|feedback|masukan)$/i;
export function cleanReadText(raw, max = MAX_WEB_CHARS) {
  const seen = new Set();
  const out = [];
  let total = 0;
  for (const line of String(raw || "").split(/\r?\n/)) {
    const s = line.replace(/[|¦_]{2,}/g, " ").replace(/\s{2,}/g, " ").trim();
    const letters = (s.match(/[\p{L}\p{N}]/gu) || []).length;
    if (letters < 4 || letters / s.length < 0.55 || UI_LINES.test(s)) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (total + s.length + 1 > max) break;
    out.push(s);
    total += s.length + 1;
  }
  return out.join("\n");
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// One picture of `el` (the search window) → its text.
// onStatus("ask" | "ocr", percent?) tells the panel where it is.
// Returns { text, whole } — `whole`: the owner picked a window or screen
// instead of this tab, so the whole picture was read and they should look at
// it before it goes anywhere.
export async function readScreenText(el, { onStatus } = {}) {
  if (!screenReadSupported()) throw Object.assign(new Error("unsupported"), { code: "unsupported" });
  onStatus?.("ask");
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser" },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
    });
  } catch (err) {
    throw Object.assign(err, { code: err?.name === "NotAllowedError" ? "denied" : "failed" });
  }
  try {
    const track = stream.getVideoTracks()[0];
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    if (video.readyState < 2) await new Promise((r) => video.addEventListener("loadeddata", r, { once: true }));
    // The prompt's own closing animation must not end up in the picture.
    await wait(450);
    await nextFrame();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) throw Object.assign(new Error("empty"), { code: "failed" });
    // This tab is captured at the size of the page: the same scale both ways.
    const sx = vw / window.innerWidth;
    const sy = vh / window.innerHeight;
    const thisTab = track.getSettings?.().displaySurface === "browser" && Math.abs(sx - sy) < 0.06;
    let crop = { x: 0, y: 0, w: vw, h: vh };
    if (thisTab && el) {
      const r = el.getBoundingClientRect();
      const x = Math.max(0, r.left) * sx;
      const y = Math.max(0, r.top) * sy;
      crop = { x, y, w: Math.min(vw - x, r.width * sx), h: Math.min(vh - y, r.height * sy) };
    }
    const scale = Math.min(1, 2400 / crop.w);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(crop.w * scale));
    canvas.height = Math.max(1, Math.round(crop.h * scale));
    canvas.getContext("2d").drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
    video.srcObject = null;
    // The picture is taken: close the share before the slow part.
    stream.getTracks().forEach((tr) => tr.stop());
    onStatus?.("ocr", 0);
    const { text } = await analyzeScreenshot(canvas.toDataURL("image/png"), (pct) => onStatus?.("ocr", pct));
    return { text: cleanReadText(text), whole: !thisTab || !el };
  } finally {
    stream.getTracks().forEach((tr) => tr.stop());
  }
}
