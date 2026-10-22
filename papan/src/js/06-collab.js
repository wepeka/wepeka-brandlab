// Live presence: who is here, cursors, who is typing, follow-the-presenter.
// In Brandlab this rides on Firebase Realtime Database (cheap, never stored); here on the artifact room.
const Collab = (() => {
  let room = null, user = null, followPeer = null;
  const names = new Map();
  const handlers = new Set();
  const emit = () => handlers.forEach((f) => f());
  let pendingIds = new Set();
  const flushNames = debounce(async () => {
    const ids = [...pendingIds]; pendingIds = new Set();
    if (!user || !ids.length) return;
    try {
      const ps = await user.profiles(ids);
      for (const [id, p] of Object.entries(ps)) names.set(id, { name: p.name || "", color: p.color, avatarUrl: p.avatarUrl, guest: !!p.guest });
      emit(); Store.emit("names");
    } catch {}
  }, 120);
  function want(id) { if (id && !names.has(id) && !String(id).startsWith("contoh") && !String(id).startsWith("me-")) { pendingIds.add(id); flushNames(); } }
  function nameOf(id, fallback) {
    if (!id) return fallback || "Seseorang";
    if (id === Store.me.id) return Store.me.name || "Kamu";
    if (String(id).startsWith("contoh")) return "Contoh";
    const n = names.get(id); want(id);
    return (n && n.name) || fallback || "Seseorang";
  }
  const PALETTE = ["#ffa52b", "#7ab8ff", "#ff7eb6", "#3ddc84", "#b38cff", "#ffc94a", "#ff6a5c", "#5fd3d0"];
  function colorOf(id) {
    if (id === Store.me.id && Store.me.color) return Store.me.color;
    const n = names.get(id); if (n && n.color) return n.color;
    let h = 0; for (const c of String(id || "x")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  async function init(r, u) {
    room = r; user = u;
    if (!room) return;
    room.onPeers((ch) => {
      for (const p of ch.peers) want(p.by || p.presence?.uid);
      if (followPeer && ch.left.some((p) => p.peer === followPeer)) { stopFollow(); toast("Orang yang kamu ikuti sudah keluar"); }
      emit();
    }, (e) => console.warn("room", e && e.code));
    room.on("summon", (msg) => {
      if (msg.isMe) return;
      const nm = nameOf(msg.by || msg.data?.uid, msg.data?.nm);
      toast(`${nm} mengajak semua melihat layarnya`, { action: "Ikuti", onAction: () => follow(msg.peer) });
    }, () => {});
    room.onConnection(() => emit(), () => {});
  }
  function presence(patch) { if (room) room.presence(patch).catch(() => {}); }
  function others() {
    if (!room) return [];
    return room.peers().filter((p) => !p.sameTab && p.kind === "viewer");
  }
  function follow(peer) {
    followPeer = peer; presence({ follow: { of: peer } }); emit(); Store.emit("follow");
    const p = others().find((x) => x.peer === peer);
    toast(`Mengikuti layar ${p ? nameOf(p.by || p.presence?.uid, p.presence?.nm) : "teman"}. Geser kanvas untuk berhenti.`);
  }
  function stopFollow(silent) { if (!followPeer) return; followPeer = null; presence({ follow: null }); emit(); if (!silent) toast("Berhenti mengikuti"); }
  async function summon() {
    if (!room) return toast("Fitur ajak ikut butuh papan bersama");
    try { await room.emit("summon", { uid: Store.me.id, nm: Store.me.name }); toast("Semua yang sedang di papan diajak melihat layarmu"); }
    catch (e) { toast(e && e.code === "not_permitted" ? "Akunmu belum bisa mengajak semua di papan ini" : "Ajakan gagal terkirim"); }
  }
  return {
    init, presence, others, nameOf, colorOf, want, follow, stopFollow, summon,
    on: (f) => handlers.add(f), get followPeer() { return followPeer; }, get connected() { return !!room && room.connected(); }, get room() { return room; },
  };
})();
