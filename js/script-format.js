// The one shape a video script has in this app — "naskah siap syuting".
// A script is a list of BEATS; each beat says what to SHOW (Visual), what
// TEXT goes on screen (Teks layar) and what to SAY (Narasi), under a header
// with its timing:
//
//   [0-3 dtk] HOOK
//   Visual: Gula aren dituang pelan ke gelas es kopi, close-up.
//   Teks layar: Ini bukan sirup.
//   Narasi: Kamu bisa bedain gula aren asli sama sirup dari warnanya.
//
//   [3-11 dtk] BUKTI
//   …
//
// It is still ONE plain string in content.script (the textarea, the PDF, the
// teleprompter and every AI prompt keep reading one string); this module is
// how code reads and writes that string. The model never writes the string
// itself: js/ai.js asks for beats as JSON and renders them here, so timing,
// labels and layout are always the same.
//
// Older scripts ("HOOK\n…\n\nISI PEMBAHASAN\n…"), carousels ("Slide 1\n…")
// and free text keep working everywhere: every reader below falls back.
// Pure functions, no imports — tests/script-format.test.mjs runs them in Node.

// Spoken Indonesian/English on short-form video: about 2.5 words a second.
export const SPOKEN_WPS = 2.5;

const LABELS = {
  id: { unit: "dtk", visual: "Visual", onScreen: "Teks layar", say: "Narasi", length: (s, w) => `⏱ ±${s} detik · ${w} kata` },
  en: { unit: "s", visual: "Visual", onScreen: "On-screen text", say: "Voice", length: (s, w) => `⏱ ~${s} sec · ${w} words` },
};
const labelsFor = (lang) => LABELS[lang] || LABELS.id;

const FIELD_RE = /^\s*[*_]*\s*(visual|teks layar|teks|on-screen text|on-screen|onscreen|text on screen|narasi|narration|voice-over|voice over|voiceover|voice|vo|say|dialog|dialogue)\s*(\([^)]*\))?\s*[*_]*\s*:\s*[*_]*\s*(.*)$/i;
const FIELD_KEY = (raw) => {
  const k = raw.toLowerCase();
  if (k === "visual") return "visual";
  if (k.startsWith("teks") || k.includes("screen")) return "onScreen";
  return "say";
};
// "[0-3 dtk] HOOK", "[0-3 detik — HOOK]", "[00:03-00:10] ISI 1 — Bukti"
const HEADER_RE = /^\s*[*_#]*\s*\[\s*([\d.:]+)\s*(?:-|–|—|s\/d|to)\s*([\d.:]+)\s*(?:dtk|detik|det|s|sec|secs|seconds)?\s*(?:[—–-]\s*([^\]]+?))?\s*\]\s*[*_]*\s*(.*?)\s*[*_]*\s*$/i;
const LENGTH_RE = /^\s*⏱/;

const countWords = (s) => (String(s || "").trim().match(/[^\s]+/g) || []).length;
const unquote = (s) => String(s || "").trim().replace(/^["“”']+|["“”']+$/g, "").trim();

export function estimateSeconds(words) {
  return Math.max(1, Math.round((Number(words) || 0) / SPOKEN_WPS));
}

// How long one beat takes on screen: its narration at speaking pace, or a
// couple of seconds for a purely visual moment.
export function beatSeconds(b) {
  const w = countWords(b?.say);
  if (!w) return 2;
  return Math.max(2, Math.round(w / SPOKEN_WPS));
}

// Where each beat starts and ends — the same timing renderScript writes
// into the headers, so a screen showing it live never disagrees with the
// saved text.
export function beatTimeline(beats = []) {
  let t = 0;
  return beats.map((b) => {
    const from = t;
    t += beatSeconds(b);
    return { from, to: t };
  });
}

// beats: [{ label, visual, onScreen, say, note }] — beats[0] is the hook.
// Returns the canonical string, with timings worked out from the narration.
// The total length is NOT written into the text (it would go stale with the
// first edit) — screens show it live with scriptLength().
export function renderScript(beats = [], { lang = "id" } = {}) {
  const L = labelsFor(lang);
  // A blank line inside a field would end it when the text is read back
  // (parseScript), so a typed paragraph break stays a single line break.
  const oneBlock = (s) => String(s || "").trim().replace(/\n[ \t]*(\n[ \t]*)+/g, "\n");
  const clean = beats
    .map((b) => ({
      label: String(b?.label || "").trim().toUpperCase().slice(0, 40) || "ISI",
      visual: oneBlock(b?.visual),
      onScreen: unquote(oneBlock(b?.onScreen)),
      say: unquote(oneBlock(b?.say)),
      note: oneBlock(b?.note),
    }))
    .filter((b) => b.visual || b.onScreen || b.say || b.note);
  if (!clean.length) return "";
  const times = beatTimeline(clean);
  const blocks = clean.map((b, i) => {
    const { from, to: t } = times[i];
    return [
      `[${from}-${t} ${L.unit}] ${b.label}`,
      b.note || "",
      b.visual ? `${L.visual}: ${b.visual}` : "",
      b.onScreen ? `${L.onScreen}: ${b.onScreen}` : "",
      b.say ? `${L.say}: ${b.say}` : "",
    ].filter(Boolean).join("\n");
  });
  return blocks.join("\n\n");
}

// The canonical string (or a chat-written one in the same spirit) back into
// beats. Returns null when the text has no beat headers at all — an old
// HOOK/ISI PEMBAHASAN script, a carousel, or free text.
export function parseScript(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const beats = [];
  const preamble = [];
  let length = "";
  let cur = null;
  let field = null;
  for (const line of lines) {
    const h = line.match(HEADER_RE);
    if (h) {
      // "[0-3 dtk] HOOK" puts the label after the bracket; "[0-3 detik —
      // HOOK]" inside it. "ISI 1 — Bukti" keeps both parts.
      const label = (h[4] || h[3] || "").replace(/^[—–-]\s*/, "").trim();
      cur = { label: label || "ISI", time: `${h[1]}-${h[2]}`, visual: "", onScreen: "", say: "", note: "" };
      beats.push(cur);
      field = null;
      continue;
    }
    if (!cur) {
      if (LENGTH_RE.test(line)) length = line.trim();
      else preamble.push(line);
      continue;
    }
    const f = line.match(FIELD_RE);
    if (f) {
      field = FIELD_KEY(f[1]);
      const who = f[2] ? `${f[2].trim()} ` : "";
      const val = unquote(f[3]);
      cur[field] = cur[field] ? `${cur[field]}\n${who}${val}` : `${who}${val}`.trim();
      continue;
    }
    if (!line.trim()) { field = null; continue; }
    if (field) cur[field] = `${cur[field]}\n${line.trim()}`.trim();
    else cur.note = `${cur.note}\n${line.trim()}`.trim();
  }
  if (!beats.length) return null;
  return { beats, preamble: preamble.join("\n").trim(), length };
}

// The same script as a readable block of beat cards (chat script card, the
// Creator writer's preview) — "" when it isn't a beat script, so callers
// fall back to plain text. `esc` is the caller's HTML escaper (this module
// stays DOM-free).
export function scriptBeatsHTML(text, esc) {
  const parsed = parseScript(text);
  if (!parsed) return "";
  const L = labelsFor(langOf(String(text || ""), "id"));
  const row = (cls, label, val) => (val ? `<div class="beat-row beat-${cls}"><span class="beat-k">${esc(label)}</span><p>${esc(val).replace(/\n/g, "<br>")}</p></div>` : "");
  const { words, seconds } = scriptLength(text);
  const head = [words ? L.length(seconds, words) : "", parsed.preamble].filter(Boolean).map((x) => `<p class="beats-meta">${esc(x)}</p>`).join("");
  return `<div class="beats">${head}${parsed.beats
    .map((b) => `<div class="beat${/hook/i.test(b.label) ? " is-hook" : ""}"><div class="beat-head"><span class="beat-label">${esc(b.label)}</span></div>${b.note ? `<p class="beat-note">${esc(b.note)}</p>` : ""}${row("visual", L.visual, b.visual)}${row("screen", L.onScreen, b.onScreen)}${row("say", L.say, b.say)}</div>`)
    .join("")}</div>`;
}

export const isBeatScript = (text) => !!parseScript(text);

// Any script as the parts a card editor shows (js/script-cards.js). A beat
// script gives its beats; free text and old HOOK/ISI scripts become one
// part per paragraph, the first one the HOOK (`fromText` says this
// happened); an empty script one empty HOOK to start typing in. The text
// itself only changes once someone edits a card.
export function scriptToBeats(text, { lang = "id" } = {}) {
  const s = String(text || "").replace(/\r\n?/g, "\n");
  const part = (label, say = "") => ({ label, visual: "", onScreen: "", say, note: "" });
  const parsed = parseScript(s);
  if (parsed) {
    return {
      beats: parsed.beats.map(({ label, visual, onScreen, say, note }) => ({ label, visual, onScreen, say, note })),
      preamble: parsed.preamble,
      lang: langOf(s, lang),
      fromText: false,
    };
  }
  const paras = spokenText(s).split(/\n[ \t]*\n+/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return { beats: [part("HOOK")], preamble: "", lang, fromText: false };
  return { beats: paras.map((p, i) => part(i ? "ISI" : "HOOK", p)), preamble: "", lang, fromText: true };
}

// A finished set of parts back into the one stored string.
export function beatsToScript(beats, { preamble = "", lang = "id" } = {}) {
  const body = renderScript(beats, { lang });
  return preamble && body ? `${preamble}\n\n${body}` : body || preamble;
}

// Old "HOOK / ISI PEMBAHASAN" scripts.
const OLD_HOOK_RE = /(?:^|\n)\s*[*#_>]*\s*HOOK\s*[*_:]*\s*\n([\s\S]*?)(?:\n\s*\n|\n\s*[*#_>]*\s*ISI|$)/i;
const OLD_LABEL_LINE = "^[ \\t]*[*#_>]*[ \\t]*(HOOK|ISI PEMBAHASAN|MAIN CONTENT)[ \\t]*[*_:]*[ \\t]*$";
const SLIDE_RE = /(?:^|\n)\s*Slide\s*1\s*:?\s*\n?([^\n]+)/i;

// What gets read aloud: the narration only, one beat per paragraph. Old
// scripts lose just their two section labels; anything else is returned
// as it is.
export function spokenText(text) {
  const s = String(text || "");
  const parsed = parseScript(s);
  if (parsed) {
    const said = parsed.beats.map((b) => b.say.replace(/^\([^)]*\)\s*/, "")).filter(Boolean);
    if (said.length) return said.join("\n\n");
  }
  return s.replace(new RegExp(OLD_LABEL_LINE, "gim"), "").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n");
}

// ---- "Biasa": the script as plain writing ------------------------------------
// The plain box shows a script as someone would type it in a notes app: only
// the words, one paragraph per part — no part names, no seconds, no Visual /
// Teks layar lines. Those stay in the stored text (the "Pro" cards, the PDF
// and the Syuting screen still show them); `directed` says the script has
// such lines the box isn't showing.

// The words of one part: what's said, or the loose text under its header.
const partWords = (b) => (String(b.say || "").trim() ? b.say : b.note || "").trim();
const splitParagraphs = (s) => s.split(/\n[ \t]*(?:\n[ \t]*)+/).map((p) => p.trim()).filter(Boolean);

export function plainScript(text) {
  const s = String(text || "").replace(/\r\n?/g, "\n");
  const parsed = parseScript(s);
  if (!parsed) return { text: new RegExp(OLD_LABEL_LINE, "im").test(s) ? spokenText(s) : s, directed: false };
  return {
    text: parsed.beats.map(partWords).filter(Boolean).join("\n\n"),
    directed: parsed.beats.some((b) => b.visual || b.onScreen || (b.note && String(b.say || "").trim())),
  };
}

const wordSet = (s) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
// How alike two paragraphs are, 0–1 (shared words).
function alike(a, b) {
  const x = wordSet(a);
  const y = wordSet(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  x.forEach((w) => { if (y.has(w)) both++; });
  return (2 * both) / (x.size + y.size);
}

// Which old paragraph each new one continues, both kept in order: an
// untouched paragraph always finds itself, an edited one its closest match,
// and what's left over was added or removed. Returns steps in reading
// order: { o, n } a pair, { o } removed, { n } added.
function pairParagraphs(olds, news) {
  const score = (i, j) => (olds[i] === news[j] ? 2 : 1 + 0.9 * alike(olds[i], news[j]));
  const best = Array.from({ length: olds.length + 1 }, () => new Array(news.length + 1).fill(0));
  for (let i = olds.length - 1; i >= 0; i--) {
    for (let j = news.length - 1; j >= 0; j--) {
      best[i][j] = Math.max(score(i, j) + best[i + 1][j + 1], best[i + 1][j], best[i][j + 1]);
    }
  }
  const steps = [];
  let i = 0;
  let j = 0;
  while (i < olds.length && j < news.length) {
    if (best[i][j] === score(i, j) + best[i + 1][j + 1]) steps.push({ o: i++, n: j++ });
    else if (best[i][j] === best[i + 1][j]) steps.push({ o: i++ });
    else steps.push({ n: j++ });
  }
  while (i < olds.length) steps.push({ o: i++ });
  while (j < news.length) steps.push({ n: j++ });
  return steps;
}

// What was typed in the plain box (`plain`), written back into `script`.
// Free text is stored as typed. A script with parts keeps them: each
// paragraph goes back into the part it came from — so that part's name,
// Visual and Teks layar stay with it — a new paragraph becomes a new part,
// and a removed one takes its part along.
export function applyPlainScript(script, plain, { lang = "id" } = {}) {
  const stored = String(script || "").replace(/\r\n?/g, "\n");
  const typed = String(plain ?? "").replace(/\r\n?/g, "\n");
  if (typed === plainScript(stored).text) return stored;
  const parsed = parseScript(stored);
  // A whole script with parts pasted in is taken as it is.
  if (!parsed || parseScript(typed)) return typed;
  const { beats } = parsed;
  const paras = splitParagraphs(typed);
  const worded = beats.map((b, at) => ({ at, words: partWords(b) })).filter((x) => x.words);
  // An emptied box is an emptied script — unless it never showed anything
  // (a script of shots and screen text only).
  if (!paras.length) return worded.length ? "" : stored;
  const out = [];
  let next = 0;
  // Parts without words aren't in the box; they keep their place.
  const keepSilentUntil = (end) => {
    for (; next < end; next++) if (!partWords(beats[next])) out.push(beats[next]);
  };
  pairParagraphs(worded.map((x) => x.words), paras).forEach(({ o, n }) => {
    if (o === undefined) {
      out.push({ label: langOf(stored, lang) === "en" ? "BODY" : "ISI", visual: "", onScreen: "", say: paras[n], note: "" });
      return;
    }
    const { at, words } = worded[o];
    keepSilentUntil(at);
    next = at + 1;
    if (n === undefined) return;
    const b = beats[at];
    if (paras[n] === words) out.push(b);
    else out.push(String(b.say || "").trim() ? { ...b, say: paras[n] } : { ...b, say: paras[n], note: "" });
  });
  keepSilentUntil(beats.length);
  return beatsToScript(out, { preamble: parsed.preamble, lang: langOf(stored, lang) });
}

// Narration words / estimated seconds of a script (any shape).
export function scriptLength(text) {
  const words = countWords(spokenText(text));
  return { words, seconds: estimateSeconds(words) };
}

// The hook of a script: the HOOK beat's narration (or its screen text), the
// text under an old HOOK label, Slide 1 of a carousel, else its first line.
export function hookOf(script) {
  const s = String(script || "").replace(/\r/g, "");
  if (!s.trim()) return "";
  const parsed = parseScript(s);
  if (parsed) {
    const first = parsed.beats[0];
    const said = (first.say || first.onScreen || "").replace(/^\([^)]*\)\s*/, "").trim();
    if (said) return said;
  }
  const labelled = s.match(OLD_HOOK_RE);
  if (labelled && labelled[1].trim()) return labelled[1].trim();
  const slide = s.match(SLIDE_RE);
  if (slide) return slide[1].trim();
  return s.split("\n").find((l) => l.trim() && !LENGTH_RE.test(l))?.trim() || "";
}

// A hook is either a plain line (old batches, other surfaces) or the
// three-layer object generateScript returns: { type, say, onScreen, visual, why }.
export const hookText = (h) => (typeof h === "string" ? h : String(h?.say || h?.onScreen || "")).trim();

// ---- Carousel -----------------------------------------------------------------
const SLIDE_MARKER = /^\s*Slide\s+(\d+)\s*:?\s*$/i;
export function parseSlides(script) {
  const text = (script || "").replace(/\r/g, "");
  if (!text.trim()) return [];
  const slides = [];
  let current = null;
  text.split("\n").forEach((line) => {
    if (SLIDE_MARKER.test(line)) {
      current = { text: "" };
      slides.push(current);
      return;
    }
    if (!current) {
      current = { text: "" };
      slides.push(current);
    }
    current.text += (current.text ? "\n" : "") + line;
  });
  return slides.map((s) => ({ text: s.text.replace(/^\n+|\n+$/g, "") }));
}
export const serializeSlides = (slides) => slides.map((s, i) => `Slide ${i + 1}\n${(s.text || "").trim()}`).join("\n\n");

// Puts `hook` into a script. A beat script gets its whole HOOK beat swapped
// (what to show, the screen text, the line — the body stays, since every
// hook generateScript offers leads into the same body); a carousel gets
// Slide 1; an old script the text under its HOOK label; anything else the
// hook on its first line. `prevHook` is the hook this replaces when there's
// no label to anchor on, so re-picking doesn't stack hooks.
export function applyHook(script, hook, prevHook = "", { lang = "id" } = {}) {
  const text = (script || "").replace(/\r/g, "");
  const h = hookText(hook);
  if (!h) return text;
  if (!text.trim()) {
    if (typeof hook === "object" && hook) return renderScript([{ label: "HOOK", ...hook, say: hook.say || h }], { lang });
    return h;
  }
  const parsed = parseScript(text);
  if (parsed) {
    const first = parsed.beats[0];
    const obj = typeof hook === "object" && hook ? hook : { say: h };
    parsed.beats[0] = {
      ...first,
      label: /hook/i.test(first.label) ? first.label : "HOOK",
      say: obj.say || h,
      onScreen: obj.onScreen !== undefined ? obj.onScreen : first.onScreen,
      visual: obj.visual || first.visual,
      note: "",
    };
    const body = renderScript(parsed.beats, { lang: langOf(text, lang) });
    return parsed.preamble ? `${parsed.preamble}\n\n${body}` : body;
  }
  if (/^\s*Slide\s+\d+\s*:?\s*$/im.test(text)) {
    const slides = parseSlides(text);
    slides[0].text = h;
    return serializeSlides(slides);
  }
  const label = "^([ \\t]*[*#_>]*[ \\t]*HOOK[ \\t]*[*_:]*[ \\t]*\\n)([\\s\\S]*?)";
  const labelled = text.match(new RegExp(label + "(?=\\n[ \\t]*\\n[ \\t]*[*#_>]*[ \\t]*ISI PEMBAHASAN)", "i")) || text.match(new RegExp(label + "(?=\\n[ \\t]*\\n|$)", "i"));
  if (labelled) return labelled[1] + h + text.slice(labelled[0].length);
  const prev = hookText(prevHook);
  const rest = prev && text.trimStart().startsWith(prev) ? text.trimStart().slice(prev.length).replace(/^\s+/, "") : text;
  return rest ? h + "\n\n" + rest : h;
}

// A rendered script keeps the label language it was written in.
export function langOf(text, fallback) {
  if (/^\s*(Narasi|Teks layar)\s*:/im.test(text) || /\bdtk\]/.test(text)) return "id";
  if (/^\s*(Voice|On-screen text)\s*:/im.test(text)) return "en";
  return fallback;
}
