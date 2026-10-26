// The level's tree ("pohon") on a Grow Brand goal — same idea as before
// (owner, 2026-10-27: "konsepnya tetep sama tapi make it more interesting"):
// one trunk, one branch per target of the level, each branch filling from
// the trunk in proportion to that target's progress. What's new is how it
// reads: it's drawn in the goal's own colours on a little hill, a target
// in progress grows leaves, a reached one bears fruit (with a check), the
// canopy behind gets fuller as the level fills up, and every node carries
// its number. Tapping a node opens that target's card under the tree with
// its one button, so the tree is something to work from, not just look at.
// Colours and motion live in css/campaign.css (.gt-*, GOALS FOR PEMULA).
const W = 1000;
const FORK = { x: 500, y: 352 };

// Where node k of n sits: an arc over the trunk, compressed when there are
// only a few so they don't sit at the far edges.
export function treeNodePos(k, n) {
  if (n <= 1) return { x: 500, y: 150 };
  const span = Math.min(780, 170 * (n - 1));
  const tt = k / (n - 1);
  const x = 500 - span / 2 + span * tt;
  const y = 330 - Math.sin(Math.PI * (0.1 + 0.8 * tt)) * 190;
  return { x: Math.round(x), y: Math.round(y) };
}

const branchPath = (x, y) => {
  const mid = Math.round((FORK.y + y) / 2);
  return `M${FORK.x},${FORK.y} C ${FORK.x},${mid} ${x},${mid} ${x},${y}`;
};

// An almond leaf at (x, y), turned `a` degrees.
const leaf = (x, y, a, cls) => `<path class="${cls}" d="M0 0 C 9 -12 27 -12 36 0 C 27 12 9 12 0 0 Z" transform="translate(${x} ${y}) rotate(${a}) translate(20 0)"/>`;
const LEAF_ANGLES = [-150, -30, -100, -60, 170, 10];

// nodes: [{ i, pct (0..1), met, value }] in the level's order (i = the
// reading's index, used for the cards and the buttons). `selected`: the
// node whose card is open. `animate`: grow in (first look at this level).
export function goalTreeSVG(nodes, { selected = null, label = "" } = {}) {
  const n = nodes.length;
  if (!n) return "";
  const met = nodes.filter((nd) => nd.met).length;
  const fill = n ? (met + nodes.reduce((s, nd) => s + (nd.met ? 0 : Math.min(1, nd.pct || 0)), 0) * 0.5) / n : 0;
  const placed = nodes.map((nd, k) => ({ ...nd, k, ...treeNodePos(k, n), pct: nd.met ? 1 : Math.max(0, Math.min(1, nd.pct || 0)) }));
  // The canopy: a soft cloud behind the branches, fuller as the level fills.
  const r = Math.round(140 + 85 * fill);
  const canopy = [[500, 240, r], [370, 280, r * 0.74], [630, 280, r * 0.74], [270, 320, r * 0.52], [730, 320, r * 0.52]]
    .map(([cx, cy, cr]) => `<circle cx="${cx}" cy="${cy}" r="${Math.round(cr)}"/>`).join("");
  const tracks = placed.map((p) => `<path class="gt-track" d="${branchPath(p.x, p.y)}"/>`).join("");
  const fills = placed.map((p) => (p.pct > 0 ? `<path class="gt-fill" style="--k:${p.k};" d="${branchPath(p.x, p.y)}" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${(100 * (1 - p.pct)).toFixed(1)}"/>` : "")).join("");
  const leaves = placed.map((p) => {
    const count = p.met ? 4 : p.pct >= 0.5 ? 3 : p.pct > 0 ? 2 : 0;
    return count ? `<g class="gt-leaves" style="--k:${p.k};">${LEAF_ANGLES.slice(0, count).map((a, j) => leaf(p.x, p.y, a + (p.k % 2 ? 12 : -12), j % 2 ? "gt-leaf is-light" : "gt-leaf")).join("")}</g>` : "";
  }).join("");
  const RING = 2 * Math.PI * 26;
  const node = (p) => {
    const sel = selected === p.i ? " is-sel" : "";
    let body;
    if (p.met) {
      body = `<circle class="gt-fruit" r="31"/><circle class="gt-shine" cx="-10" cy="-11" r="7"/><path class="gt-check" d="M-11 1 L-3 9 L12 -7"/>`;
    } else if (p.pct > 0) {
      body = `<circle class="gt-bud is-open" r="27"/><circle class="gt-ring" r="26"/><circle class="gt-ring-fill" r="26" stroke-dasharray="${RING.toFixed(1)}" stroke-dashoffset="${(RING * (1 - p.pct)).toFixed(1)}" transform="rotate(-90)"/><text class="gt-num" dy=".35em">${p.k + 1}</text>`;
    } else {
      body = `<circle class="gt-bud" r="23"/><text class="gt-num is-dim" dy=".35em">${p.k + 1}</text>`;
    }
    const tag = p.value ? `<g class="gt-tag" transform="translate(0 ${p.met ? 50 : 46})"><rect x="${-(p.value.length * 6 + 13)}" y="-16" width="${p.value.length * 12 + 26}" height="32" rx="16"/><text dy=".35em">${escapeXml(p.value)}</text></g>` : "";
    return `<g class="gt-node${p.met ? " is-met" : p.pct > 0 ? " is-going" : ""}${sel}" style="--k:${p.k};" transform="translate(${p.x} ${p.y})" data-tree-node="${p.i}" tabindex="0" role="button" aria-label="${escapeXml(p.aria || "")}" aria-pressed="${selected === p.i}">
        <circle class="gt-sel" r="41"/>
        <g class="gt-node-body">${body}</g>
        ${tag}
      </g>`;
  };
  return `
    <svg class="gt-svg" viewBox="0 56 ${W} 484" role="img" aria-label="${escapeXml(label)}">
      <g class="gt-canopy" style="--fill:${fill.toFixed(2)};">${canopy}</g>
      <path class="gt-hill is-back" d="M-700 500 Q -200 450 260 470 Q 520 482 760 462 Q 1200 430 1700 490 V 600 H -700 Z"/>
      <path class="gt-hill" d="M-700 520 Q 500 440 1700 520 V 600 H -700 Z"/>
      <path class="gt-root" d="M470 494 C 440 506 410 510 384 506 M530 494 C 560 506 590 510 616 506"/>
      <path class="gt-trunk" d="M458 500 C 472 452 484 404 488 ${FORK.y} L 512 ${FORK.y} C 516 404 528 452 542 500 Z"/>
      ${tracks}
      <g class="gt-fills">${fills}</g>
      ${leaves}
      ${placed.map(node).join("")}
    </svg>`;
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Tapping a node opens its card (and only its card) under the tree.
export function wireGoalTree(root, { onSelect = () => {} } = {}) {
  const tree = root.querySelector(".gt");
  if (!tree) return;
  const pick = (i) => {
    tree.querySelectorAll("[data-tree-node]").forEach((g) => {
      const on = g.dataset.treeNode === String(i);
      g.classList.toggle("is-sel", on);
      g.setAttribute("aria-pressed", String(on));
    });
    tree.querySelectorAll("[data-tree-info]").forEach((c) => { c.hidden = c.dataset.treeInfo !== String(i); });
    onSelect(Number(i));
  };
  tree.querySelectorAll("[data-tree-node]").forEach((g) => {
    g.addEventListener("click", () => pick(g.dataset.treeNode));
    g.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      pick(g.dataset.treeNode);
    });
  });
  // Phones: the tree is wider than the screen — start it centred on the trunk.
  const scroll = tree.querySelector(".gt-scroll");
  if (scroll) scroll.scrollLeft = Math.max(0, (scroll.scrollWidth - scroll.clientWidth) / 2);
}
