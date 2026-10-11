// The last few unexpected errors of this session, kept in memory only — so a
// problem report (js/report-problem.js) can carry what actually went wrong
// instead of "it didn't work". No imports on purpose: js/main.js feeds this
// from its global error handlers, before anything else is loaded.
const MAX = 5;
const MAX_CHARS = 400;
const recent = [];

export function noteError(kind, err) {
  let text;
  try {
    const message = err?.message || String(err ?? "");
    // The first stack frames say where; the rest is noise for a report.
    const where = String(err?.stack || "").split("\n").slice(1, 3).map((l) => l.trim()).join(" | ");
    text = `${kind}: ${message}${where ? ` @ ${where}` : ""}`;
  } catch {
    text = `${kind}: (unreadable error)`;
  }
  recent.push({ at: Date.now(), msg: text.slice(0, MAX_CHARS) });
  if (recent.length > MAX) recent.shift();
}

export const recentErrors = () => recent.map((e) => ({ ...e }));
