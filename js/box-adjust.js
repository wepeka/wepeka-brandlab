// Drag a box around and pull its corners to resize it — the teleprompter's
// black panel and the black text band over the camera (owner's ask,
// 2026-10-30: "kotak hitamnya bisa digedein, di drag-drag atau digeser").
//
// The boxes sit centred in their container, so the new size is kept as an
// offset (translate) plus a width / height; growing is symmetric around the
// centre, which keeps the corner under the finger. The last size and spot are
// remembered per browser (`key`). Double-tap a corner to put it back.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const read = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
};
const write = (key, v) => {
  try { if (v) localStorage.setItem(key, JSON.stringify(v)); else localStorage.removeItem(key); } catch { /* private mode */ }
};

// el: the box. dragHandle: element that moves it (null = none).
// opts.centerY: false when the box hangs from the top (grows downward only).
export function makeAdjustable(el, { key, dragHandle = null, minW = 280, minH = 160, centerY = true, gripClass = "adj-grip" } = {}) {
  let box = null; // { dx, dy, w, h } — null = the stylesheet's own size
  let storeKey = key;
  const sw = () => window.innerWidth;
  const sh = () => window.innerHeight;

  const apply = () => {
    if (!box) {
      el.style.width = el.style.height = el.style.transform = "";
      el.classList.remove("is-adjusted");
      return;
    }
    const w = clamp(box.w, minW, sw() - 12);
    const h = clamp(box.h, minH, sh() - 12);
    // Keep at least a grab-able strip of the box on screen.
    const maxDx = (sw() - w) / 2 + w - 60;
    const dx = clamp(box.dx, -maxDx, maxDx);
    const dy = centerY ? clamp(box.dy, -(sh() - h) / 2, (sh() - h) / 2) : clamp(box.dy, 0, sh() - 80);
    el.style.width = `${Math.round(w)}px`;
    el.style.height = `${Math.round(h)}px`;
    el.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
    el.classList.add("is-adjusted");
  };
  const save = () => write(storeKey, box);

  const begin = (e, mode, dirX = 1) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    // An untouched box starts from where the stylesheet draws it.
    const start = { x: e.clientX, y: e.clientY, box: box ? { ...box } : { dx: 0, dy: 0, w: r.width, h: r.height } };
    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    el.classList.add("is-adjusting");
    const move = (ev) => {
      const ddx = ev.clientX - start.x;
      const ddy = ev.clientY - start.y;
      if (mode === "move") box = { ...start.box, dx: start.box.dx + ddx, dy: start.box.dy + ddy };
      else {
        box = {
          ...start.box,
          w: start.box.w + dirX * ddx * 2,
          h: start.box.h + ddy * (centerY ? 2 : 1),
        };
      }
      apply();
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      el.classList.remove("is-adjusting");
      save();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const reset = () => { box = null; apply(); write(storeKey, null); };

  if (dragHandle) {
    dragHandle.style.touchAction = "none";
    dragHandle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button, input, a, label")) return;
      begin(e, "move");
    });
    dragHandle.addEventListener("dblclick", (e) => { if (!e.target.closest("button, input, a, label")) reset(); });
  }
  [["sw", -1], ["se", 1]].forEach(([pos, dir]) => {
    const g = document.createElement("button");
    g.type = "button";
    g.className = `${gripClass} ${gripClass}-${pos}`;
    g.setAttribute("aria-hidden", "true");
    g.tabIndex = -1;
    g.addEventListener("pointerdown", (e) => begin(e, "size", dir));
    g.addEventListener("click", (e) => e.stopPropagation());
    g.addEventListener("dblclick", reset);
    el.append(g);
  });

  const onResize = () => { if (box) apply(); };
  window.addEventListener("resize", onResize);

  const load = (k = storeKey) => {
    storeKey = k;
    const saved = read(k);
    box = saved && [saved.dx, saved.dy, saved.w, saved.h].every(Number.isFinite) ? saved : null;
    apply();
  };
  load();
  return { reset, reload: load, destroy: () => window.removeEventListener("resize", onResize) };
}
