// The infinite canvas: camera, rendering, selection and every pointer/keyboard interaction.
const Canvas = (() => {
  const cam = { x: 0, y: 0, z: 1 };
  let vp, world, framesL, linksL, objsL, overlay, selL, cursorsL;
  const els = new Map();
  const sel = new Set();
  let tool = "select", toolOpts = { shape: "rect", stickyColor: "yellow", penColor: "ink", penWidth: 3 };
  let drag = null, spaceDown = false, editing = null, clientView = false;
  const busy = new Set();
  const remoteOffsets = new Map();
  const pointers = new Map();
  const handlers = new Set();
  const emit = (k, d) => handlers.forEach((f) => f(k, d));

  // rAF pauses in background tabs; fall back to a timer so the canvas still updates there.
  const nextFrame = (fn) => (document.hidden ? setTimeout(fn, 16) : requestAnimationFrame(fn));
  // ---------- camera ----------
  function rect() { return vp.getBoundingClientRect(); }
  function toWorld(cx, cy) { const r = rect(); return { x: (cx - r.left - cam.x) / cam.z, y: (cy - r.top - cam.y) / cam.z }; }
  function toScreen(wx, wy) { return { x: wx * cam.z + cam.x, y: wy * cam.z + cam.y }; }
  let camRaf = 0;
  function applyCam() {
    world.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.z})`;
    const g = 24 * cam.z;
    vp.style.backgroundSize = `${g}px ${g}px`;
    vp.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
    world.style.setProperty("--iz", String(clamp(1 / cam.z, 1, 5)));
    if (!camRaf) camRaf = nextFrame(() => { camRaf = 0; drawOverlay(); drawCursors(); emit("cam"); sendView(); });
  }
  const sendView = (() => { let t = 0; return () => { const now = Date.now(); if (now - t < 120) return; t = now; const r = rect(); const c = toWorld(r.left + r.width / 2, r.top + r.height / 2); Collab.presence({ view: { cx: Math.round(c.x), cy: Math.round(c.y), z: +cam.z.toFixed(3), w: Math.round(r.width), h: Math.round(r.height) } }); }; })();
  function zoomAt(z, sx, sy) {
    z = clamp(z, 0.08, 4);
    const r = rect();
    if (sx == null) { sx = r.width / 2; sy = r.height / 2; }
    const wx = (sx - cam.x) / cam.z, wy = (sy - cam.y) / cam.z;
    cam.z = z; cam.x = sx - wx * z; cam.y = sy - wy * z;
    applyCam();
  }
  let anim = 0;
  function animateTo(t, ms = 380) {
    cancelAnimationFrame(anim);
    if (document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) { Object.assign(cam, t); applyCam(); return; }
    const s = { ...cam }, t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      cam.x = s.x + (t.x - s.x) * e; cam.y = s.y + (t.y - s.y) * e; cam.z = s.z + (t.z - s.z) * e;
      applyCam();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  function camFor(b, pad = 80, maxZ = 1.2) {
    const r = rect();
    const z = clamp(Math.min((r.width - pad * 2) / Math.max(b.w, 1), (r.height - pad * 2) / Math.max(b.h, 1)), 0.08, maxZ);
    return { z, x: r.width / 2 - (b.x + b.w / 2) * z, y: r.height / 2 - (b.y + b.h / 2) * z };
  }
  function fit(ids, animate = true) {
    const objs = (ids ? ids.map(Store.obj).filter(Boolean) : visibleObjects()).filter((o) => o.type !== "connector");
    if (!objs.length) { const t = { x: rect().width / 2, y: rect().height / 2, z: 1 }; animate ? animateTo(t) : (Object.assign(cam, t), applyCam()); return; }
    const t = camFor(bboxOf(objs), 70, ids ? 1.4 : 1);
    animate ? animateTo(t) : (Object.assign(cam, t), applyCam());
  }
  function centerWorld() { const r = rect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); }
  function lookAt(view) { // follow: match the presenter's centre and zoom
    const r = rect(); const z = clamp(Math.min(view.z * Math.min(r.width / (view.w || r.width), r.height / (view.h || r.height)), 4), 0.08, 4);
    animateTo({ z, x: r.width / 2 - view.cx * z, y: r.height / 2 - view.cy * z }, 260);
  }

  // ---------- geometry ----------
  function geo(o) {
    if (o.type === "text" || o.type === "table" || o.type === "checklist") { const el = els.get(o.id); const h = el ? el.offsetHeight : o.h; return { x: o.x, y: o.y, w: o.w, h: h || o.h, r: o.r || 0 }; }
    return { x: o.x, y: o.y, w: o.w, h: o.h, r: o.r || 0 };
  }
  function corners(g) {
    const cx = g.x + g.w / 2, cy = g.y + g.h / 2, a = ((g.r || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => { const dx = (sx * g.w) / 2, dy = (sy * g.h) / 2; return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c }; });
  }
  function bboxOf(objs) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const o of objs) {
      const pts = o.type === "connector" ? connPoints(o) : corners(geo(o));
      for (const p of pts) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  function center(o) { const g = geo(o); return { x: g.x + g.w / 2, y: g.y + g.h / 2 }; }
  function edgePoint(o, toward) { // where a line from the centre toward a point leaves the box
    const g = geo(o), c = center(o);
    let dx = toward.x - c.x, dy = toward.y - c.y;
    if (!dx && !dy) return c;
    const a = (-(g.r || 0) * Math.PI) / 180, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    const t = Math.min(Math.abs((g.w / 2 + 6) / (lx || 1e-9)), Math.abs((g.h / 2 + 6) / (ly || 1e-9)));
    return { x: c.x + dx * t, y: c.y + dy * t };
  }
  function endPos(end, other) {
    if (end && end.id) { const o = Store.obj(end.id); if (o) { const oc = other && other.id && Store.obj(other.id) ? center(Store.obj(other.id)) : other && other.x != null ? other : center(o); return edgePoint(o, oc); } }
    return { x: end?.x || 0, y: end?.y || 0 };
  }
  function connPoints(o) { const d = o.data || {}; return [endPos(d.from, d.to), endPos(d.to, d.from)]; }
  const visible = (o) => !(clientView && (o.internal || insideInternal(o)));
  function insideInternal(o) {
    if (o.type === "frame") return false;
    const c = o.type === "connector" ? null : center(o); if (!c) return false;
    for (const f of Store.objects()) if (f.type === "frame" && f.internal && c.x > f.x && c.x < f.x + f.w && c.y > f.y && c.y < f.y + f.h) return true;
    return false;
  }
  const visibleObjects = () => Store.objects().filter(visible);
  function frameChildren(f) {
    return Store.objects().filter((o) => o.id !== f.id && o.type !== "frame" && o.type !== "connector" && (() => { const c = center(o); return c.x > f.x && c.x < f.x + f.w && c.y > f.y && c.y < f.y + f.h; })());
  }

  // ---------- rendering ----------
  function contentKey(o) {
    const k = { t: o.type, ln: o.linked, text: o.text, c: o.color, d: o.data, tag: o.tag, st: o.status, v: o.votes, re: o.reactions, l: o.locked, i: o.internal, fs: o.fs, b: o.bold, h: o.heading, hand: o.hand, cb: o.createdBy };
    if (o.type === "sticky" || o.type === "shape") { k.w = Math.round(o.w); k.h = Math.round(o.h); }
    if (o.type === "widget") k.lab = Store.S.labVersion;
    if (o.type === "sticky") k.nm = Collab.nameOf(o.createdBy);
    if (o.type === "widget") k.th = document.documentElement.dataset.resolved;
    k.vote = Board.votingKey();
    k.cm = commentCount(o.id);
    k.flag = Flags.get(o.id);
    return JSON.stringify(k);
  }
  let commentCounts = new Map();
  function recountComments() { commentCounts = new Map(); for (const c of Store.comments()) if (!c.resolved && c.objectId && (!clientView || !c.internal)) commentCounts.set(c.objectId, (commentCounts.get(c.objectId) || 0) + 1); }
  const commentCount = (id) => commentCounts.get(id) || 0;
  function setGeom(el, o) {
    const dx = remoteOffsets.get(o.id)?.dx || 0, dy = remoteOffsets.get(o.id)?.dy || 0;
    el.style.left = o.x + dx + "px"; el.style.top = o.y + dy + "px"; el.style.width = o.w + "px";
    el.style.height = o.type === "text" || o.type === "table" || o.type === "checklist" ? "auto" : o.h + "px";
    if (o.type === "table" || o.type === "checklist") el.style.minHeight = "60px";
    el.style.transform = o.r ? `rotate(${o.r}deg)` : "";
    el.style.zIndex = String(o.z || 0);
  }
  function chrome(o) {
    let h = "";
    const tags = [];
    if (o.tag) tags.push(`<span class="tag ${o.tag}">${{ keputusan: "Keputusan", pertanyaan: "Pertanyaan", terpilih: "★ Terpilih" }[o.tag] || esc(o.tag)}</span>`);
    if (o.ai) tags.push('<span class="tag ai">✦ AI</span>');
    if (o.status) tags.push(`<span class="tag ${o.status}">${{ review: "Minta review", approved: "✓ Disetujui", revisi: "Perlu revisi" }[o.status]}</span>`);
    if (o.linked) for (const [k, l] of [["task", "Tugas"], ["content", "Konten"], ["campaign", "Campaign"]]) if (o.linked[k]) tags.push(`<span class="tag link">↗ ${l}</span>`);
    const f = Flags.get(o.id);
    if (f) tags.push(`<span class="tag ${f.kind}">${esc(f.label)}</span>`);
    if (tags.length && o.type !== "frame") h += `<div class="tags">${tags.join("")}</div>`;
    const bd = [];
    for (const [emo, who] of Object.entries(o.reactions || {})) {
      const ids = Object.entries(who || {}).filter(([, v]) => v).map(([k]) => k);
      if (ids.length) bd.push(`<button class="bdg${ids.includes(Store.me.id) ? " mine" : ""}" data-act="react" data-emo="${esc(emo)}" title="${esc(ids.map((i) => Collab.nameOf(i)).join(", "))}">${esc(emo)} ${ids.length}</button>`);
    }
    const cm = commentCount(o.id);
    if (cm) bd.push(`<button class="bdg cm" data-act="comments">${ic("comment")} ${cm}</button>`);
    if (bd.length && o.type !== "frame" && o.type !== "pen") h += `<div class="badges">${bd.join("")}</div>`;
    if (o.type === "sticky" || o.type === "shape" || o.type === "embed" || o.type === "image") {
      const v = Board.votesFor(o);
      if (Board.votingActive() && Store.canWrite && o.type === "sticky") h += `<button class="votebtn${v.mine ? " on" : ""}" data-act="vote" title="${v.mine ? "Batalkan vote" : "Vote ide ini"}">${v.mine ? "✓ " : "+"}${v.count || ""}</button>`;
      else if (v.count) h += `<span class="votecount" title="${v.count} vote">${v.count}</span>`;
    }
    if (o.locked) h += `<span class="lockmark" title="Terkunci">${ic("lock")}</span>`;
    return h;
  }
  function renderObj(o) {
    if (o.type === "connector") return;
    let el = els.get(o.id);
    const layer = o.type === "frame" ? framesL : objsL;
    if (!el || el.parentNode !== layer) {
      if (el) el.remove();
      el = document.createElement("div"); el.dataset.id = o.id; el._key = null;
      layer.appendChild(el); els.set(o.id, el);
    }
    el.className = `obj o-${o.type}${["table", "checklist", "embed", "widget", "doc"].includes(o.type) ? " card" : ""}${o.type === "widget" ? " o-widget" : ""}${o.type === "checklist" ? " o-check" : ""}${o.type === "text" && o.heading ? " h" : ""}${o.locked ? " locked" : ""}${o.internal ? " internal" : ""}${visible(o) ? "" : " hidden-client"}`;
    if (o.type === "sticky") el.style.background = stickyBg(o.color);
    if (!busy.has(o.id)) setGeom(el, o);
    else el.style.zIndex = String(o.z || 0);
    const key = contentKey(o);
    if (key !== el._key && editing?.id !== o.id && !el.contains(document.activeElement)) {
      el.innerHTML = (R[o.type] ? R[o.type](o) : "") + chrome(o);
      el._key = key;
      if (o.type === "sticky") fitSticky(el, o);
    }
  }
  function fitSticky(el, o) {
    const t = el.querySelector(".txt"); if (!t) return;
    let fs = o.fs || clamp(o.w / 8, 14, 32);
    t.style.fontSize = fs + "px";
    let g = 0;
    while ((t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1) && fs > 9 && g++ < 40) { fs -= 1; t.style.fontSize = fs + "px"; }
  }
  function renderLinks() {
    const out = [];
    const defsColor = new Set();
    for (const o of Store.objects()) {
      if (o.type !== "connector" || !visible(o)) continue;
      const d = o.data || {};
      const off = remoteOffsets.get(o.id);
      let [a, b] = connPoints(o);
      if (drag && drag.kind === "endpoint" && drag.id === o.id) { if (drag.end === "from") a = drag.pt; else b = drag.pt; }
      const col = inkColor(o.color);
      let path;
      if (d.style === "curve") {
        const dx = b.x - a.x, dy = b.y - a.y, horiz = Math.abs(dx) > Math.abs(dy);
        const c1 = horiz ? { x: a.x + dx * 0.45, y: a.y } : { x: a.x, y: a.y + dy * 0.45 }, c2 = horiz ? { x: b.x - dx * 0.45, y: b.y } : { x: b.x, y: b.y - dy * 0.45 };
        path = `M${a.x} ${a.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
        var endDir = Math.atan2(b.y - c2.y, b.x - c2.x), startDir = Math.atan2(a.y - c1.y, a.x - c1.x);
      } else { path = `M${a.x} ${a.y} L${b.x} ${b.y}`; var endDir = Math.atan2(b.y - a.y, b.x - a.x), startDir = endDir + Math.PI; }
      const head = (p, ang) => { const L = 13, w = 0.45; return `<path d="M${p.x + L * Math.cos(ang + Math.PI - w)} ${p.y + L * Math.sin(ang + Math.PI - w)} L${p.x} ${p.y} L${p.x + L * Math.cos(ang + Math.PI + w)} ${p.y + L * Math.sin(ang + Math.PI + w)}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`; };
      const isSel = sel.has(o.id);
      out.push(`<g data-id="${o.id}"${off ? ` transform="translate(${off.dx} ${off.dy})"` : ""}><path class="hit" d="${path}" fill="none" stroke="transparent" stroke-width="16" vector-effect="non-scaling-stroke"/>${isSel ? `<path d="${path}" fill="none" stroke="var(--accent-fill)" stroke-width="7" stroke-opacity=".35" stroke-linecap="round"/>` : ""}<path d="${path}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round"${d.dash ? ' stroke-dasharray="9 8"' : ""}/>${d.arrow === "end" || d.arrow === "both" ? head(b, endDir) : ""}${d.arrow === "both" ? head(a, startDir) : ""}</g>`);
    }
    linksL.innerHTML = out.join("");
  }
  function renderAll() {
    recountComments();
    const seen = new Set();
    for (const o of Store.objects()) { renderObj(o); seen.add(o.id); }
    for (const [id, el] of els) if (!seen.has(id)) { el.remove(); els.delete(id); sel.delete(id); }
    renderLinks(); drawPeerMarks(); drawOverlay();
  }
  let rr = 0;
  function scheduleRender() { if (rr) return; rr = nextFrame(() => { rr = 0; renderAll(); }); }

  // ---------- selection overlay & contextual toolbar ----------
  function selObjs() { return [...sel].map(Store.obj).filter(Boolean); }
  function drawOverlay() {
    selL.innerHTML = "";
    const objs = selObjs();
    if (drag && drag.kind === "marquee") {
      const a = toScreen(drag.x1, drag.y1), b = toScreen(drag.x2, drag.y2);
      selL.insertAdjacentHTML("beforeend", `<div class="marquee" style="left:${Math.min(a.x, b.x)}px;top:${Math.min(a.y, b.y)}px;width:${Math.abs(a.x - b.x)}px;height:${Math.abs(a.y - b.y)}px"></div>`);
    }
    if (drag && (drag.kind === "connector")) {
      const a = toScreen(drag.a.x, drag.a.y), b = toScreen(drag.pt.x, drag.pt.y);
      selL.insertAdjacentHTML("beforeend", `<svg class="ghost-line" style="left:0;top:0;width:100%;height:100%;overflow:visible"><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--accent-fill)" stroke-width="2.5" stroke-dasharray="6 6"/></svg>`);
    }
    if (drag && drag.kind === "pen" && drag.pts.length > 1) {
      const d = penPath(drag.pts.map((p) => { const s = toScreen(p[0], p[1]); return [s.x, s.y]; }));
      selL.insertAdjacentHTML("beforeend", `<svg class="ghost-line" style="left:0;top:0;width:100%;height:100%;overflow:visible"><path d="${d}" fill="none" stroke="${inkColor(toolOpts.penColor)}" stroke-width="${toolOpts.penWidth * cam.z}" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
    }
    if (drag && drag.kind === "create" && drag.moved) {
      const a = toScreen(Math.min(drag.x1, drag.x2), Math.min(drag.y1, drag.y2));
      selL.insertAdjacentHTML("beforeend", `<div class="marquee" style="left:${a.x}px;top:${a.y}px;width:${Math.abs(drag.x2 - drag.x1) * cam.z}px;height:${Math.abs(drag.y2 - drag.y1) * cam.z}px;border-radius:${drag.type === "frame" ? 14 : 6}px"></div>`);
    }
    if (!objs.length) { UI.ctx(null); return; }
    const showHandles = !drag || drag.kind === "resize" || drag.kind === "rotate";
    if (objs.length === 1 && objs[0].type === "connector") {
      const [a, b] = connPoints(objs[0]).map((p) => toScreen(p.x, p.y));
      if (showHandles && !objs[0].locked && Store.canWrite) {
        selL.insertAdjacentHTML("beforeend", `<div class="hdl ep" data-h="ep-from" style="left:${a.x}px;top:${a.y}px"></div><div class="hdl ep" data-h="ep-to" style="left:${b.x}px;top:${b.y}px"></div>`);
      }
      UI.ctx(objs, { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
      return;
    }
    let box;
    if (objs.length === 1) {
      const g = geo(objs[0]), p = toScreen(g.x, g.y);
      const w = g.w * cam.z, h = g.h * cam.z;
      const div = document.createElement("div");
      div.className = "selbox";
      div.style.cssText = `left:${p.x + w / 2}px;top:${p.y + h / 2}px;width:${w}px;height:${h}px;transform:translate(-50%,-50%) rotate(${g.r || 0}deg);transform-origin:50% 50%`;
      selL.appendChild(div);
      if (showHandles && !objs[0].locked && Store.canWrite && !(drag && drag.kind === "move")) {
        const pts = handlePositions(g);
        for (const [k, pt] of Object.entries(pts)) {
          if ((objs[0].type === "text" || objs[0].type === "table" || objs[0].type === "checklist") && /^(n|s|nw|ne|sw|se)$/.test(k)) continue;
          const s = toScreen(pt.x, pt.y);
          selL.insertAdjacentHTML("beforeend", `<div class="hdl${k === "rot" ? " rot" : ""}" data-h="${k}" style="left:${s.x}px;top:${s.y}px;cursor:${k === "rot" ? "grab" : cursorFor(k, g.r || 0)}"></div>`);
        }
      }
      const cs = corners(g).map((c) => toScreen(c.x, c.y));
      const xs = cs.map((c) => c.x), ys = cs.map((c) => c.y);
      box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    } else {
      const b = bboxOf(objs), p = toScreen(b.x, b.y);
      box = { x: p.x, y: p.y, w: b.w * cam.z, h: b.h * cam.z };
      selL.insertAdjacentHTML("beforeend", `<div class="selbox multi" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px"></div>`);
      for (const o of objs) {
        if (o.type === "connector") continue;
        const g = geo(o), q = toScreen(g.x, g.y);
        selL.insertAdjacentHTML("beforeend", `<div class="selbox" style="left:${q.x + (g.w * cam.z) / 2}px;top:${q.y + (g.h * cam.z) / 2}px;width:${g.w * cam.z}px;height:${g.h * cam.z}px;transform:translate(-50%,-50%) rotate(${g.r || 0}deg);opacity:.5"></div>`);
      }
      if (showHandles && Store.canWrite && !objs.some((o) => o.locked) && !(drag && drag.kind === "move")) for (const k of ["nw", "ne", "sw", "se"]) {
        const s = { nw: [box.x, box.y], ne: [box.x + box.w, box.y], sw: [box.x, box.y + box.h], se: [box.x + box.w, box.y + box.h] }[k];
        selL.insertAdjacentHTML("beforeend", `<div class="hdl" data-h="m-${k}" style="left:${s[0]}px;top:${s[1]}px;cursor:${k === "nw" || k === "se" ? "nwse-resize" : "nesw-resize"}"></div>`);
      }
    }
    UI.ctx(drag || editing ? null : objs, box);
  }
  function handlePositions(g) {
    const cx = g.x + g.w / 2, cy = g.y + g.h / 2, a = ((g.r || 0) * Math.PI) / 180;
    const P = (lx, ly) => ({ x: cx + lx * Math.cos(a) - ly * Math.sin(a), y: cy + lx * Math.sin(a) + ly * Math.cos(a) });
    const w = g.w / 2, h = g.h / 2;
    return { nw: P(-w, -h), n: P(0, -h), ne: P(w, -h), e: P(w, 0), se: P(w, h), s: P(0, h), sw: P(-w, h), w: P(-w, 0), rot: P(0, -h - 28 / cam.z) };
  }
  function cursorFor(k, r) {
    const base = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 }[k];
    const a = (((base + r) % 180) + 180) % 180;
    return a < 22.5 || a >= 157.5 ? "ns-resize" : a < 67.5 ? "nesw-resize" : a < 112.5 ? "ew-resize" : "nwse-resize";
  }
  function select(ids, add = false) {
    if (!add) sel.clear();
    for (const id of ids) {
      const o = Store.obj(id); if (!o) continue;
      if (o.group) for (const g of Store.objects()) if (g.group === o.group) sel.add(g.id);
      sel.add(id);
    }
    afterSel();
  }
  function deselect() { if (!sel.size) return; sel.clear(); afterSel(); }
  function afterSel() { renderLinks(); drawOverlay(); Collab.presence({ sel: [...sel].slice(0, 12) }); emit("selection"); }

  // ---------- peers ----------
  function drawPeerMarks() {
    for (const el of els.values()) { el.classList.remove("peer-sel"); el.querySelector(":scope > .peer-tag")?.remove(); }
    const bid = Store.S.boardId;
    for (const p of Collab.others()) {
      const pr = p.presence || {}; if (pr.b !== bid) continue;
      const col = Collab.colorOf(p.by || pr.uid), nm = Collab.nameOf(p.by || pr.uid, pr.nm);
      for (const id of pr.sel || []) { const el = els.get(id); if (el) { el.classList.add("peer-sel"); el.style.setProperty("--peer", col); } }
      if (pr.edit) { const el = els.get(pr.edit); if (el) el.insertAdjacentHTML("beforeend", `<span class="peer-tag" style="background:${col}">${esc(nm)} sedang mengetik…</span>`); }
    }
  }
  function drawCursors() {
    const bid = Store.S.boardId;
    const seen = new Set();
    for (const p of Collab.others()) {
      const pr = p.presence || {};
      if (pr.b !== bid || !pr.cur) continue;
      seen.add(p.peer);
      let el = cursorsL.querySelector(`[data-peer="${p.peer}"]`);
      const col = Collab.colorOf(p.by || pr.uid), nm = Collab.nameOf(p.by || pr.uid, pr.nm) + (p.isMe ? " (tab lain)" : "");
      if (!el) { el = document.createElement("div"); el.className = "cursor"; el.dataset.peer = p.peer; cursorsL.appendChild(el); }
      const html = `<svg viewBox="0 0 24 24"><path d="M4 2l16 9-7 1.6L9.6 20z" fill="${col}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg><span style="background:${col}">${esc(nm)}</span>`;
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
      const s = toScreen(pr.cur.x, pr.cur.y);
      el.style.transform = `translate(${s.x}px,${s.y}px)`;
    }
    for (const el of [...cursorsL.children]) if (!seen.has(el.dataset.peer)) el.remove();
  }
  function onPeers() {
    // live drag preview from teammates
    const bid = Store.S.boardId, next = new Map();
    for (const p of Collab.others()) { const pr = p.presence || {}; if (pr.b === bid && pr.drag) for (const id of pr.drag.ids || []) if (!busy.has(id)) next.set(id, { dx: pr.drag.dx, dy: pr.drag.dy, peer: p.peer }); }
    const changed = new Set([...remoteOffsets.keys(), ...next.keys()]);
    for (const id of changed) {
      const a = remoteOffsets.get(id), b = next.get(id);
      if (a && !b) { // drop: keep the ghost offset until the real position lands (or 2 s)
        if (!a.until) { a.until = Date.now() + 2000; a.x0 = Store.obj(id)?.x; a.y0 = Store.obj(id)?.y; }
        continue;
      }
      if (b) remoteOffsets.set(id, b);
    }
    for (const id of changed) { const o = Store.obj(id); const el = els.get(id); if (o && el && !busy.has(id)) setGeom(el, o); }
    renderLinks(); drawPeerMarks(); drawCursors();
    // follow
    if (Collab.followPeer) {
      const p = Collab.others().find((x) => x.peer === Collab.followPeer);
      const v = p && p.presence?.view;
      if (p && p.presence?.b && p.presence.b !== bid) Board.open(p.presence.b);
      if (v && (!lastFollow || lastFollow.cx !== v.cx || lastFollow.cy !== v.cy || lastFollow.z !== v.z)) { lastFollow = v; following = true; lookAt(v); setTimeout(() => (following = false), 300); }
    }
  }
  let lastFollow = null, following = false;
  function settleOffsets(ids) {
    for (const id of ids) { const a = remoteOffsets.get(id); if (!a || !a.until) continue; const o = Store.obj(id); if (!o || o.x !== a.x0 || o.y !== a.y0 || Date.now() > a.until) remoteOffsets.delete(id); }
  }
  setInterval(() => { let ch = false; for (const [id, a] of remoteOffsets) if (a.until && Date.now() > a.until) { remoteOffsets.delete(id); ch = true; } if (ch) scheduleRender(); }, 700);

  // ---------- hit testing ----------
  function objAt(target) { const el = target.closest && target.closest(".obj"); return el ? Store.obj(el.dataset.id) : null; }
  function connAt(target) { const g = target.closest && target.closest("g[data-id]"); return g ? Store.obj(g.dataset.id) : null; }
  function penHit(o, p, rad) {
    const d = o.data || {}; if (!d.points) return false;
    const g = geo(o), sx = g.w / (d.ow || g.w), sy = g.h / (d.oh || g.h);
    for (let i = 1; i < d.points.length; i++) {
      const a = { x: o.x + d.points[i - 1][0] * sx, y: o.y + d.points[i - 1][1] * sy }, b = { x: o.x + d.points[i][0] * sx, y: o.y + d.points[i][1] * sy };
      const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1, t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / l2, 0, 1);
      const dx = a.x + vx * t - p.x, dy = a.y + vy * t - p.y;
      if (dx * dx + dy * dy < rad * rad) return true;
    }
    return false;
  }
  function frameAtPoint(p) { // topmost frame whose title or body is under the point (frames sit under objects)
    const fr = Store.objects().filter((o) => o.type === "frame" && visible(o)).sort((a, b) => (b.z || 0) - (a.z || 0));
    return fr.find((f) => p.x > f.x && p.x < f.x + f.w && p.y > f.y && p.y < f.y + f.h) || null;
  }

  // ---------- pointer handling ----------
  function isInteractive(t) { return t.closest("input, textarea, select, a, button, [contenteditable='true'], .no-drag"); }
  function onDown(e) {
    if (e.target.closest(".ctx, .pop")) return;
    vp.focus({ preventScroll: true });
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { startPinch(); return; }
    if (pointers.size > 2) return;
    const p = toWorld(e.clientX, e.clientY);
    UI.closePops();
    if (Collab.followPeer && !following) Collab.stopFollow();
    const h = e.target.closest(".hdl");
    if (h) { startHandle(e, h.dataset.h, p); return; }
    if (e.button === 1 || tool === "hand" || spaceDown) { startPan(e); return; }
    if (e.button === 2) return;
    if (editing && !e.target.closest(`[data-id="${editing.id}"]`)) finishEdit();
    const hitObj = objAt(e.target), hitConn = !hitObj && connAt(e.target);
    if (!Store.canWrite && tool !== "select") setTool("select");
    switch (tool) {
      case "pen": drag = { kind: "pen", pts: [[p.x, p.y]] }; capture(e); return;
      case "eraser": drag = { kind: "erase", hits: new Map() }; capture(e); eraseAt(p); return;
      case "connector": {
        const a = hitObj && hitObj.type !== "frame" ? { id: hitObj.id } : { x: p.x, y: p.y };
        drag = { kind: "connector", from: a, a: a.id ? center(hitObj) : p, pt: p }; capture(e); drawOverlay(); return;
      }
      case "comment": {
        const o = hitObj || hitConn || frameAtPoint(p);
        if (o) { select([o.id]); Panels.comments(o.id); } else toast("Klik sebuah objek untuk memberi komentar");
        return;
      }
      case "sticky": case "text": case "shape": case "frame":
        if (hitObj && isInteractive(e.target)) break;
        drag = { kind: "create", type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, moved: false }; capture(e); return;
    }
    // select tool
    if (isInteractive(e.target) && hitObj) { if (!sel.has(hitObj.id)) select([hitObj.id]); return; }
    let target = hitObj || hitConn;
    if (target && target.type === "frame" && !e.target.closest(".ftitle")) target = null; // frame body = empty canvas, title = frame
    if (!target && e.pointerType === "touch") { startPan(e); return; } // one finger on empty canvas pans on phones/tablets
    if (target) {
      if (e.shiftKey || e.metaKey || e.ctrlKey) { if (sel.has(target.id)) { sel.delete(target.id); afterSel(); } else select([target.id], true); return; }
      if (!sel.has(target.id)) select([target.id]);
      if (e.detail >= 2) return;
      startMove(e, p);
      return;
    }
    if (!e.shiftKey) deselect();
    drag = { kind: "marquee", x1: p.x, y1: p.y, x2: p.x, y2: p.y, add: e.shiftKey, base: new Set(sel) };
    capture(e);
  }
  function capture(e) { try { vp.setPointerCapture(e.pointerId); } catch {} }
  function startPan(e) { drag = { kind: "pan", sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }; vp.classList.add("panning"); capture(e); }
  function startPinch() {
    const [a, b] = [...pointers.values()];
    drag = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), z0: cam.z, mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam0: { ...cam } };
  }
  function startMove(e, p) {
    const objs = selObjs().filter((o) => !o.locked);
    if (!objs.length || !Store.canWrite) return;
    const ids = new Set(objs.map((o) => o.id));
    for (const o of objs) if (o.type === "frame") for (const c of frameChildren(o)) if (!c.locked) ids.add(c.id);
    // connectors with both free ends inside the selection move too
    const moving = [...ids].map(Store.obj);
    drag = { kind: "move", start: p, ids: [...ids], orig: new Map(moving.map((o) => [o.id, clone(o)])), moved: false };
    capture(e);
  }
  function startHandle(e, h, p) {
    const objs = selObjs(); if (!objs.length) return;
    if (h.startsWith("ep-")) { drag = { kind: "endpoint", id: objs[0].id, end: h.slice(3), orig: clone(objs[0]), pt: p }; capture(e); return; }
    if (h.startsWith("m-")) { const b = bboxOf(objs); drag = { kind: "mresize", h: h.slice(2), box: b, orig: new Map(objs.map((o) => [o.id, clone(o)])) }; capture(e); return; }
    const o = objs[0];
    if (h === "rot") { const c = center(o); drag = { kind: "rotate", id: o.id, c, a0: Math.atan2(p.y - c.y, p.x - c.x), r0: o.r || 0, orig: clone(o) }; }
    else drag = { kind: "resize", id: o.id, h, orig: clone(o), g: geo(o) };
    busy.add(o.id);
    capture(e);
  }
  function onMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = toWorld(e.clientX, e.clientY);
    if ((e.target instanceof Node && vp.contains(e.target)) || drag) Collab.presence({ cur: { x: Math.round(p.x), y: Math.round(p.y) }, b: Store.S.boardId });
    if (!drag) return;
    switch (drag.kind) {
      case "pan": cam.x = drag.cx + e.clientX - drag.sx; cam.y = drag.cy + e.clientY - drag.sy; applyCam(); break;
      case "pinch": {
        if (pointers.size < 2) return;
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const z = clamp(drag.z0 * (d / drag.d0), 0.08, 4), r = rect();
        const wx = (drag.mid0.x - r.left - drag.cam0.x) / drag.cam0.z, wy = (drag.mid0.y - r.top - drag.cam0.y) / drag.cam0.z;
        cam.z = z; cam.x = mid.x - r.left - wx * z; cam.y = mid.y - r.top - wy * z; applyCam(); break;
      }
      case "marquee": {
        drag.x2 = p.x; drag.y2 = p.y;
        const x1 = Math.min(drag.x1, drag.x2), x2 = Math.max(drag.x1, drag.x2), y1 = Math.min(drag.y1, drag.y2), y2 = Math.max(drag.y1, drag.y2);
        sel.clear(); for (const id of drag.base) sel.add(id);
        for (const o of visibleObjects()) {
          if (o.type === "frame") { if (o.x > x1 && o.y > y1 && o.x + o.w < x2 && o.y + o.h < y2) sel.add(o.id); continue; }
          const b = o.type === "connector" ? bboxOf([o]) : bboxOf([o]);
          if (b.x < x2 && b.x + b.w > x1 && b.y < y2 && b.y + b.h > y1) sel.add(o.id);
        }
        renderLinks(); drawOverlay(); break;
      }
      case "move": {
        let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx * cam.z, dy * cam.z) < 3) return;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        drag.moved = true; drag.dx = dx; drag.dy = dy;
        for (const id of drag.ids) {
          busy.add(id);
          const o = drag.orig.get(id), el = els.get(id);
          if (o.type === "connector") continue;
          if (el) { el.style.left = o.x + dx + "px"; el.style.top = o.y + dy + "px"; }
          const live = Store.obj(id); if (live) { live.x = o.x + dx; live.y = o.y + dy; } // keep connectors attached while dragging
        }
        for (const id of drag.ids) { const o = drag.orig.get(id); if (o.type === "connector") moveFreeEnds(id, o, dx, dy); }
        renderLinks(); drawOverlay();
        Collab.presence({ drag: { ids: drag.ids.slice(0, 40), dx: Math.round(dx), dy: Math.round(dy) } });
        break;
      }
      case "resize": doResize(p, e.shiftKey); break;
      case "mresize": doMultiResize(p); break;
      case "rotate": {
        let a = drag.r0 + ((Math.atan2(p.y - drag.c.y, p.x - drag.c.x) - drag.a0) * 180) / Math.PI;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        a = ((a % 360) + 360) % 360; if (Math.abs(a) < 2 || Math.abs(a - 360) < 2) a = 0;
        const live = Store.obj(drag.id); live.r = a; setGeom(els.get(drag.id), live); renderLinks(); drawOverlay(); break;
      }
      case "endpoint": drag.pt = p; renderLinks(); drawOverlay(); break;
      case "connector": drag.pt = p; drawOverlay(); break;
      case "pen": { const l = drag.pts[drag.pts.length - 1]; if (Math.hypot(p.x - l[0], p.y - l[1]) * cam.z > 2) drag.pts.push([p.x, p.y]); drawOverlay(); break; }
      case "erase": eraseAt(p); break;
      case "create": drag.x2 = p.x; drag.y2 = p.y; drag.moved = drag.moved || Math.hypot((drag.x2 - drag.x1) * cam.z, (drag.y2 - drag.y1) * cam.z) > 6; drawOverlay(); break;
    }
  }
  function moveFreeEnds(id, o, dx, dy) {
    const live = Store.obj(id); if (!live) return;
    const d = clone(o.data);
    if (!d.from.id) { d.from.x += dx; d.from.y += dy; }
    if (!d.to.id) { d.to.x += dx; d.to.y += dy; }
    live.data = d;
  }
  function doResize(p, keep) {
    const o = drag.orig, g = drag.g, live = Store.obj(drag.id); if (!live) return;
    const h = drag.h, hx = h.includes("e") ? 1 : h.includes("w") ? -1 : 0, hy = h.includes("s") ? 1 : h.includes("n") ? -1 : 0;
    // Keep the opposite corner/edge (anchor A) fixed; work in the object's rotated axes.
    const a = ((g.r || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const cx = g.x + g.w / 2, cy = g.y + g.h / 2;
    const ax = (-hx * g.w) / 2, ay = (-hy * g.h) / 2;
    const A = { x: cx + ax * c - ay * s, y: cy + ax * s + ay * c };
    const vx = p.x - A.x, vy = p.y - A.y;
    const lx = vx * c + vy * s, ly = -vx * s + vy * c;
    const min = o.type === "text" ? 60 : 24;
    let w = hx ? Math.max(min, hx * lx) : g.w, hh = hy ? Math.max(min, hy * ly) : g.h;
    const ratioLock = keep || ((o.type === "image" || o.type === "pen" || o.type === "widget") && hx && hy);
    if (ratioLock && hx && hy) { const r = g.w / g.h; if (w / hh > r) hh = w / r; else w = hh * r; }
    const ox = hx ? (hx * w) / 2 : 0, oy = hy ? (hy * hh) / 2 : 0; // new centre relative to A, local axes
    const ncx = A.x + ox * c - oy * s, ncy = A.y + ox * s + oy * c;
    live.w = w; live.h = hh; live.x = ncx - w / 2; live.y = ncy - hh / 2;
    if (o.type === "text") live.h = o.h;
    const el = els.get(drag.id); setGeom(el, live);
    if (o.type === "sticky") fitSticky(el, live);
    if (o.type === "shape") { const svg = el.querySelector("svg.sh"); if (svg) svg.outerHTML = shapeSVG(live); }
    renderLinks(); drawOverlay();
  }
  function doMultiResize(p) {
    const b = drag.box, h = drag.h;
    const ax = h.includes("w") ? b.x + b.w : b.x, ay = h.includes("n") ? b.y + b.h : b.y;
    const sx = Math.max(0.1, Math.abs(p.x - ax) / b.w), sy = Math.max(0.1, Math.abs(p.y - ay) / b.h), s = Math.max(sx, sy);
    for (const [id, o] of drag.orig) {
      const live = Store.obj(id); if (!live) continue; busy.add(id);
      if (o.type === "connector") { const d = clone(o.data); for (const k of ["from", "to"]) if (!d[k].id) { d[k].x = ax + (d[k].x - ax) * s; d[k].y = ay + (d[k].y - ay) * s; } live.data = d; continue; }
      live.x = ax + (o.x - ax) * s; live.y = ay + (o.y - ay) * s; live.w = o.w * s; live.h = o.h * s;
      if (o.fs) live.fs = o.fs * s;
      const el = els.get(id); setGeom(el, live);
      if (o.type === "sticky") fitSticky(el, live);
      if (o.type === "text") { const t = el.querySelector(".txt"); if (t) t.style.fontSize = (o.fs || 18) * s + "px"; }
    }
    drag.s = s;
    renderLinks(); drawOverlay();
  }
  function eraseAt(p) {
    const rad = 10 / cam.z;
    for (const o of Store.objects()) {
      if (o.type !== "pen" || drag.hits.has(o.id) || o.locked || (GUEST() && o.createdBy !== Store.me.id)) continue;
      if (penHit(o, p, rad)) { drag.hits.set(o.id, clone(o)); const el = els.get(o.id); if (el) el.style.opacity = ".15"; }
    }
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (!drag) return;
    const d = drag; drag = null;
    vp.classList.remove("panning");
    if (d.kind === "pinch") { if (pointers.size === 1) { const [q] = pointers.values(); drag = { kind: "pan", sx: q.x, sy: q.y, cx: cam.x, cy: cam.y }; } return; }
    const p = toWorld(e.clientX, e.clientY);
    switch (d.kind) {
      case "move": {
        Collab.presence({ drag: null });
        if (!d.moved) { for (const id of d.ids) busy.delete(id); break; }
        const changes = [];
        for (const id of d.ids) {
          const before = d.orig.get(id), after = clone(Store.obj(id) || before);
          if (before.type !== "connector") { after.x = Math.round(before.x + d.dx); after.y = Math.round(before.y + d.dy); }
          // restore the in-place mutation so commit() sees the real before
          Object.assign(Store.obj(id) || {}, { x: before.x, y: before.y, data: before.data });
          changes.push({ id, before, after });
        }
        for (const id of d.ids) busy.delete(id);
        Store.commit(changes); History.push(changes, "Pindah");
        break;
      }
      case "resize": case "rotate": {
        const live = Store.obj(d.id); busy.delete(d.id); if (!live) break;
        const after = { ...clone(live), x: Math.round(live.x), y: Math.round(live.y), w: Math.round(live.w), h: Math.round(live.h) };
        Object.assign(live, { x: d.orig.x, y: d.orig.y, w: d.orig.w, h: d.orig.h, r: d.orig.r });
        const ch = [{ id: d.id, before: d.orig, after }]; Store.commit(ch); History.push(ch, d.kind === "rotate" ? "Putar" : "Ubah ukuran");
        break;
      }
      case "mresize": {
        const changes = [];
        for (const [id, before] of d.orig) { const live = Store.obj(id); busy.delete(id); if (!live) continue; const after = clone(live); Object.assign(live, before); changes.push({ id, before, after }); }
        Store.commit(changes); History.push(changes, "Ubah ukuran");
        break;
      }
      case "endpoint": {
        const o = Store.obj(d.id); if (!o) break;
        const hit = objUnder(e);
        const end = hit && hit.type !== "connector" && hit.type !== "frame" ? { id: hit.id, x: null, y: null } : { id: null, x: Math.round(p.x), y: Math.round(p.y) };
        const after = clone(o); after.data[d.end] = end;
        const ch = [{ id: o.id, before: d.orig, after }]; Store.commit(ch); History.push(ch, "Sambung");
        break;
      }
      case "connector": {
        const hit = objUnder(e);
        const to = hit && hit.type !== "frame" && hit.type !== "connector" ? { id: hit.id } : { x: Math.round(p.x), y: Math.round(p.y) };
        if (to.id && to.id === d.from.id) break;
        if (!to.id && !d.from.id && Math.hypot((p.x - d.a.x) * cam.z, (p.y - d.a.y) * cam.z) < 12) { drawOverlay(); break; }
        const o = Store.newObject({ type: "connector", x: 0, y: 0, w: 0, h: 0, color: "ink", data: { from: { id: null, x: null, y: null, ...d.from }, to: { id: null, x: null, y: null, ...to }, arrow: "end", style: "curve", dash: false } });
        add([o], { select: true, keepTool: true });
        break;
      }
      case "pen": {
        if (d.pts.length < 2) { drawOverlay(); break; }
        const xs = d.pts.map((q) => q[0]), ys = d.pts.map((q) => q[1]);
        const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(8, Math.max(...xs) - x), h = Math.max(8, Math.max(...ys) - y);
        const pts = d.pts.map((q) => [+(q[0] - x).toFixed(1), +(q[1] - y).toFixed(1)]);
        const o = Store.newObject({ type: "pen", x, y, w, h, color: toolOpts.penColor, data: { points: pts, ow: w, oh: h, width: toolOpts.penWidth } });
        add([o], { keepTool: true });
        break;
      }
      case "erase": {
        if (!d.hits.size) break;
        const ch = [...d.hits.values()].map((o) => ({ id: o.id, before: o, after: null }));
        Store.commit(ch); History.push(ch, "Hapus coretan");
        break;
      }
      case "create": {
        const x1 = Math.min(d.x1, d.x2), y1 = Math.min(d.y1, d.y2);
        const w = Math.abs(d.x2 - d.x1), h = Math.abs(d.y2 - d.y1);
        createAt(d.type, d.moved ? { x: x1, y: y1, w, h } : { cx: d.x1, cy: d.y1 });
        break;
      }
      case "marquee": drawOverlay(); afterSel(); break;
    }
  }
  function objUnder(e) {
    const els2 = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of els2) { const o = el.closest && el.closest(".obj"); if (o && o.dataset.id) { const ob = Store.obj(o.dataset.id); if (ob && ob.type !== "frame") return ob; } }
    return null;
  }
  function onWheel(e) {
    e.preventDefault();
    if (Collab.followPeer && !following) Collab.stopFollow();
    const r = rect();
    if (e.ctrlKey || e.metaKey) zoomAt(cam.z * Math.exp(-e.deltaY * 0.0105), e.clientX - r.left, e.clientY - r.top);
    else { cam.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX; cam.y -= e.shiftKey && !e.deltaX ? 0 : e.deltaY; applyCam(); }
  }
  function onDbl(e) {
    if (!Store.canWrite) return;
    let o = objAt(e.target);
    if (o && o.type === "frame" && !e.target.closest(".ftitle")) o = null;
    if (o) {
      if (o.locked) return toast("Objek terkunci. Buka kuncinya dulu.");
      const cell = e.target.closest("[data-cell]"), item = e.target.closest("[data-item]"), f = e.target.closest("[data-f]");
      if (cell) return startEdit(o.id, { cell: cell.dataset.cell });
      if (item) return startEdit(o.id, { item: +item.dataset.item });
      if (f) return startEdit(o.id, { field: f.dataset.f });
      if (o.type === "checklist" && e.target.closest(".ttl")) return startEdit(o.id, { title: true });
      if (["sticky", "text", "shape", "frame"].includes(o.type)) return startEdit(o.id);
      if (o.type === "widget") return Panels.widget(o.id);
      if (o.type === "embed") return startEdit(o.id, { field: "title" });
      return;
    }
    if (connAt(e.target) || tool !== "select") return;
    const p = toWorld(e.clientX, e.clientY);
    const f = frameAtPoint(p);
    if (f && e.target.closest(".ftitle")) return startEdit(f.id);
    createAt("sticky", { cx: p.x, cy: p.y });
  }

  // ---------- creating ----------
  function defaults(type) {
    switch (type) {
      case "sticky": return { w: 200, h: 200, color: toolOpts.stickyColor, text: "" };
      case "text": return { w: 320, h: 30, color: "ink", text: "", fs: 22 };
      case "shape": return { w: 220, h: toolOpts.shape === "pill" ? 80 : 150, color: "#7ab8ff", text: "", data: { shape: toolOpts.shape, fill: true } };
      case "frame": return { w: 640, h: 440, color: "#ffa52b", text: "Frame baru" };
    }
  }
  function createAt(type, at) {
    const d = defaults(type);
    let o;
    if (at.w != null && at.w > 20 && at.h > 20 && type !== "sticky" && type !== "text") o = Store.newObject({ type, ...d, x: Math.round(at.x), y: Math.round(at.y), w: Math.round(at.w), h: Math.round(at.h) });
    else { const cx = at.cx ?? at.x + at.w / 2, cy = at.cy ?? at.y + at.h / 2; o = Store.newObject({ type, ...d, x: Math.round(cx - d.w / 2), y: Math.round(cy - (type === "text" ? 15 : d.h / 2)) }); }
    add([o], { select: true });
    setTool("select");
    if (cam.z < 0.45) { const r = rect(), z = 0.9; Object.assign(cam, { z, x: r.width / 2 - (o.x + o.w / 2) * z, y: r.height / 2 - (o.y + Math.min(o.h, 200) / 2) * z }); applyCam(); }
    setTimeout(() => startEdit(o.id), 30);
    return o;
  }
  function add(objs, opts = {}) {
    if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini");
    const ch = objs.map((o) => ({ id: o.id, before: null, after: o }));
    Store.commit(ch); History.push(ch, "Tambah");
    if (opts.select) select(objs.filter((o) => o.type !== "connector" || objs.length === 1).map((o) => o.id));
    if (!opts.keepTool) setTool("select");
    return objs;
  }
  // Insert a set of objects (template, paste, AI result) centred at a point, remapping ids.
  function insertObjects(list, at, opts = {}) {
    if (!list.length) return [];
    const map = new Map(list.map((o) => [o.id, uid("o")]));
    const real = list.filter((o) => o.type !== "connector");
    const b = real.length ? bboxRaw(real) : { x: 0, y: 0, w: 0, h: 0 };
    const c = at || centerWorld();
    const dx = Math.round(c.x - (b.x + b.w / 2)), dy = Math.round(c.y - (b.y + b.h / 2));
    const zF = Store.nextZ("frame"), zO = Store.nextZ("sticky");
    const groupMap = new Map();
    const out = list.map((o, i) => {
      const n = clone(o); n.id = map.get(o.id);
      if (n.type !== "connector") { n.x += dx; n.y += dy; }
      else { for (const k of ["from", "to"]) { const e = n.data[k]; if (e.id) e.id = map.get(e.id) || null; if (!e.id) { e.id = null; e.x = (e.x || 0) + dx; e.y = (e.y || 0) + dy; } } }
      if (n.group) { if (!groupMap.has(n.group)) groupMap.set(n.group, uid("g")); n.group = groupMap.get(n.group); }
      n.z = (n.type === "frame" ? zF : zO) + i;
      delete n.votes; if (!opts.keepMeta) { delete n.reactions; }
      if (o.votes && opts.keepVotes) n.votes = o.votes;
      return Store.newObject(n);
    });
    add(out, { select: opts.select !== false });
    return out;
  }
  function bboxRaw(objs) { let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const o of objs) { x1 = Math.min(x1, o.x); y1 = Math.min(y1, o.y); x2 = Math.max(x2, o.x + o.w); y2 = Math.max(y2, o.y + o.h); } return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }; }

  // ---------- text editing ----------
  function startEdit(id, part = {}) {
    const o = Store.obj(id); if (!o || o.locked || !Store.canWrite) return;
    const busyBy = Collab.others().find((p) => p.presence?.edit === id && p.presence?.b === Store.S.boardId);
    if (busyBy) return toast(`${Collab.nameOf(busyBy.by || busyBy.presence?.uid, busyBy.presence?.nm)} sedang mengedit ini`);
    if (editing) finishEdit();
    const el = els.get(id); if (!el) return;
    let t;
    if (part.cell) t = el.querySelector(`[data-cell="${part.cell}"]`);
    else if (part.item != null) t = el.querySelector(`[data-item="${part.item}"]`);
    else if (part.field) t = el.querySelector(`[data-f="${part.field}"]`) || (part.field === "desc" ? null : null);
    else if (part.title) t = el.querySelector(".ttl");
    else t = el.querySelector(o.type === "frame" ? ".ftitle .t" : ".txt");
    if (part.field === "desc" && !t) { const meta = el.querySelector(".meta"); if (meta) { meta.querySelector(".ds")?.remove(); t = document.createElement("div"); t.className = "ds"; t.dataset.f = "desc"; meta.querySelector(".tt")?.after(t); } }
    if (!t) return;
    if (part.item != null && t.querySelector(".faint")) t.textContent = "";
    editing = { id, part, before: clone(o), el: t };
    if (!sel.has(id)) select([id]);
    t.contentEditable = "true"; t.spellcheck = true;
    t.focus();
    const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    t.addEventListener("input", onEditInput);
    t.addEventListener("keydown", onEditKey);
    t.addEventListener("blur", onEditBlur);
    t.addEventListener("paste", onEditPaste);
    Collab.presence({ edit: id });
    drawOverlay(); UI.ctx(null);
  }
  function editedValue() { return editing.el.innerText.replace(/ /g, " ").replace(/\n$/, ""); }
  function applyEdit(o, part, v) {
    const n = clone(o);
    if (part.cell) { const [r, c] = part.cell.split(",").map(Number); n.data.rows[r][c] = v; }
    else if (part.item != null) { n.data.items[part.item].t = v; }
    else if (part.field) { n.data[part.field] = v; }
    else n.text = v;
    return n;
  }
  const liveSave = debounce(() => {
    if (!editing) return;
    const o = Store.obj(editing.id); if (!o) return;
    const after = applyEdit(o, editing.part, editedValue());
    Store.commit([{ id: o.id, before: o, after }]);
  }, 700);
  function onEditInput() {
    if (!editing) return;
    const o = Store.obj(editing.id);
    if (o && o.type === "sticky") { const el = els.get(o.id); fitSticky(el, o); }
    liveSave();
    drawOverlay();
  }
  function onEditPaste(e) { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData("text/plain"); document.execCommand("insertText", false, t); }
  function onEditKey(e) {
    e.stopPropagation();
    if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finishEdit(); }
    else if (e.key === "Enter" && !e.shiftKey && editing && (editing.part.cell || editing.part.item != null || editing.part.field || editing.part.title || Store.obj(editing.id)?.type === "frame")) {
      e.preventDefault(); const part = editing.part, id = editing.id; finishEdit();
      if (part.item != null) { const o = Store.obj(id); if (o && o.data.items[part.item]?.t) Actions.addChecklistItem(id, part.item + 1); }
    }
    else if (e.key === "Tab" && editing && editing.part.cell) {
      e.preventDefault(); const [r, c] = editing.part.cell.split(",").map(Number); const id = editing.id; finishEdit();
      const o = Store.obj(id); const cols = o.data.rows[0].length; const nr = c + 1 < cols ? r : r + 1, nc = c + 1 < cols ? c + 1 : 0;
      if (nr < o.data.rows.length) setTimeout(() => startEdit(id, { cell: `${nr},${nc}` }), 10);
    }
  }
  function onEditBlur() { setTimeout(() => { if (editing && document.activeElement !== editing.el) finishEdit(); }, 0); }
  function finishEdit() {
    if (!editing) return;
    const { id, part, before, el } = editing;
    el.removeEventListener("input", onEditInput); el.removeEventListener("keydown", onEditKey); el.removeEventListener("blur", onEditBlur); el.removeEventListener("paste", onEditPaste);
    el.contentEditable = "false";
    const v = editedValue();
    editing = null;
    Collab.presence({ edit: null });
    const o = Store.obj(id);
    if (o) {
      const after = applyEdit(o, part, v);
      if ((o.type === "text" || (o.type === "sticky" && !(before.text || "").trim())) && !v.trim() && !part.field && !part.cell && part.item == null && (!GUEST() || o.createdBy === Store.me.id)) { const ch = [{ id, before, after: null }]; Store.commit(ch); History.push(ch, "Hapus"); sel.delete(id); }
      else { Store.commit([{ id, before: o, after }]); if (!deepEqual(before, after)) History.push([{ id, before, after: clone(Store.obj(id)) }], "Edit teks"); }
      const elo = els.get(id); if (elo) elo._key = null;
    }
    scheduleRender();
    getSelection().removeAllRanges();
  }

  // ---------- keyboard ----------
  function onKey(e) {
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.querySelector(".scrim, .deck, .plan, .present")) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (k === " " && !spaceDown) { spaceDown = true; vp.classList.add("panning"); e.preventDefault(); return; }
    if (mod && k === "z") { e.preventDefault(); e.shiftKey ? History.redo() : History.undo(); return; }
    if (mod && k === "y") { e.preventDefault(); History.redo(); return; }
    if (mod && k === "a") { e.preventDefault(); select(visibleObjects().map((o) => o.id)); return; }
    if (mod && k === "d") { e.preventDefault(); Actions.duplicate(); return; }
    if (mod && k === "c") { Actions.copy(); return; }
    if (mod && k === "x") { Actions.copy(); Actions.remove(); return; }
    if (mod && k === "g") { e.preventDefault(); e.shiftKey ? Actions.ungroup() : Actions.group(); return; }
    if (mod && k === "l") { e.preventDefault(); Actions.lock(); return; }
    if (mod && (k === "=" || k === "+")) { e.preventDefault(); zoomAt(cam.z * 1.2); return; }
    if (mod && k === "-") { e.preventDefault(); zoomAt(cam.z / 1.2); return; }
    if (mod) return;
    if (e.shiftKey && (k === "!" || e.code === "Digit1")) { fit(); return; }
    if (e.shiftKey && (k === ")" || e.code === "Digit0")) { zoomAt(1); return; }
    if (e.shiftKey && (k === "@" || e.code === "Digit2")) { if (sel.size) fit([...sel]); return; }
    switch (k) {
      case "delete": case "backspace": if (sel.size) { e.preventDefault(); Actions.remove(); } return;
      case "escape": if (drag) { drag = null; drawOverlay(); } else if (tool !== "select") setTool("select"); else deselect(); UI.closePops(); return;
      case "enter": { const o = selObjs()[0]; if (o && sel.size === 1) { e.preventDefault(); if (o.type === "widget") Panels.widget(o.id); else startEdit(o.id); } return; }
      case "arrowleft": case "arrowright": case "arrowup": case "arrowdown": if (sel.size) { e.preventDefault(); const s = e.shiftKey ? 10 : 1; Actions.nudge(k === "arrowleft" ? -s : k === "arrowright" ? s : 0, k === "arrowup" ? -s : k === "arrowdown" ? s : 0); } return;
      case "/": e.preventDefault(); UI.slash(); return;
      case "?": UI.shortcuts(); return;
      case "+": case "=": zoomAt(cam.z * 1.2); return;
      case "-": zoomAt(cam.z / 1.2); return;
    }
    const tk = { v: "select", h: "hand", n: "sticky", t: "text", s: "shape", c: "connector", p: "pen", e: "eraser", f: "frame", m: "comment" }[k];
    if (tk) setTool(tk);
  }
  function onKeyUp(e) { if (e.key === " ") { spaceDown = false; if (tool !== "hand") vp.classList.remove("panning"); } }
  function setTool(t) {
    if (!Store.canWrite && !["select", "hand"].includes(t)) return;
    tool = t;
    vp.className = "vp t-" + t;
    emit("tool", t);
    if (t !== "select") UI.ctx(null);
  }

  // ---------- init ----------
  function init() {
    vp = $("#vp"); world = $("#world"); framesL = $("#framesL"); linksL = $("#linksL"); objsL = $("#objsL"); overlay = $("#overlay"); selL = $("#selL"); cursorsL = $("#cursorsL");
    vp.addEventListener("pointerdown", onDown);
    selL.addEventListener("pointerdown", (e) => { if (e.target.closest(".hdl")) onDown(e); });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    vp.addEventListener("wheel", onWheel, { passive: false });
    vp.addEventListener("dblclick", onDbl);
    vp.addEventListener("click", (e) => Actions.onClick(e));
    vp.addEventListener("input", (e) => Actions.onInput(e));
    vp.addEventListener("pointerleave", () => Collab.presence({ cur: null }));
    vp.addEventListener("contextmenu", (e) => { const o = objAt(e.target) || connAt(e.target); if (o) { e.preventDefault(); if (!sel.has(o.id)) select([o.id]); UI.moreMenu(e.clientX, e.clientY); } });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", () => { drawOverlay(); drawCursors(); });
    Store.on((k, info) => {
      if (k === "objects") { if (info?.ids) settleOffsets(info.ids); for (const id of sel) if (!Store.obj(id)) sel.delete(id); scheduleRender(); }
      if (k === "comments" || k === "lab" || k === "names" || k === "voting") scheduleRender();
      if (k === "board-open") { for (const el of els.values()) el.remove(); els.clear(); sel.clear(); remoteOffsets.clear(); drawOverlay(); }
    });
    Collab.on(onPeers);
    applyCam();
  }
  return {
    init, cam, applyCam, zoomAt, fit, animateTo, centerWorld, toWorld, toScreen, select, deselect, sel, selObjs, setTool, get tool() { return tool; }, toolOpts,
    startEdit, finishEdit, insertObjects, add, createAt, renderAll, scheduleRender, geo, center, bboxOf, frameChildren, els, frameAtPoint, camFor, lookAt,
    on: (f) => handlers.add(f), get editing() { return editing; }, get clientView() { return clientView; }, set clientView(v) { clientView = v; scheduleRender(); }, visibleObjects, visible, drawOverlay,
    flash(id) { const el = els.get(id); if (el) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } },
  };
})();

// Tags shown temporarily by the free tools (duplicates, brand-check results). Not saved.
const Flags = (() => {
  const m = new Map();
  return { get: (id) => m.get(id), set(id, f) { m.set(id, f); Canvas.scheduleRender(); }, clear() { m.clear(); Canvas.scheduleRender(); }, has: (id) => m.has(id) };
})();
