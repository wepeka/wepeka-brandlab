// Kerja Tim: writing one text together (the Script). Each person's change
// since the last text everyone agreed on (base) is laid onto the newest text
// (theirs) — so two people typing in different places both keep their
// words. diff-match-patch does the character work (js/vendor/).
import DiffMatchPatch from "../vendor/diff-match-patch.js";

const dmp = new DiffMatchPatch();

export function merge3text(base, mine, theirs) {
  const b = String(base ?? "");
  const m = String(mine ?? "");
  const t = String(theirs ?? "");
  if (m === b) return t;
  if (t === b || t === m) return m;
  const [out] = dmp.patch_apply(dmp.patch_make(b, m), t);
  return out;
}

// Where a caret at `pos` in `before` sits once the text became `after`.
export function moveCaret(before, after, pos) {
  if (before === after) return pos;
  return dmp.diff_xIndex(dmp.diff_main(String(before ?? ""), String(after ?? "")), Math.max(0, Math.min(pos, String(before ?? "").length)));
}
