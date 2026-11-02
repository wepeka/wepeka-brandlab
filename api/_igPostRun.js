// Runs Instagram posting jobs (api/_igPost.js) against Firestore + Storage:
// shared by the owner's "Posting sekarang" request and the minute cron.
import { accountFor, step, graphClient, SIGNED_FOR } from "./_igPost.js";

export const LIVE = ["waiting", "children", "container", "publishing"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What a job's end writes on the piece: its Instagram state, and once it's
// up the permalink in place of the client's preview copies (as "Sudah aku
// posting" with a link does).
async function writePiece(db, contentId, piece) {
  const ref = db.collection("content").doc(contentId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return [];
    const c = snap.data();
    const p = c.posting || {};
    const posted = piece.ig.state === "published";
    const patch = { posting: { ...p, ig: piece.ig, ...(posted ? { previews: {} } : {}) }, updatedAt: Date.now() };
    if (posted) Object.assign(patch, { status: "published", publishedDate: piece.publishedDate, ...(piece.permalink ? { publishedUrl: piece.permalink } : {}) });
    tx.update(ref, patch);
    return posted ? Object.values(p.previews || {}).flatMap((pv) => pv.paths || []) : [];
  });
}

// Moves one job as far as it can within `budgetMs` (0 = one move). Returns
// its state afterwards.
export async function runJob(db, bucket, contentId, { budgetMs = 0 } = {}) {
  const ref = db.collection("igJobs").doc(contentId);
  const started = Date.now();
  const sign = async (path) => (await bucket.file(path).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + SIGNED_FOR }))[0];
  for (;;) {
    const snap = await ref.get();
    if (!snap.exists) return "gone";
    const job = snap.data();
    if (!LIVE.includes(job.state)) return job.state;
    const [cSnap, bSnap] = await Promise.all([db.collection("content").doc(contentId).get(), db.collection("brands").where("ownerId", "==", job.ownerId).get()]);
    const account = accountFor(bSnap.docs.map((d) => ({ id: d.id, ...d.data() })), job.brandId);
    const graph = account ? graphClient(account.token) : null;
    let out = await step(job, { graph, sign, caption: cSnap.data()?.caption || "", account, now: Date.now() });
    if (out.job) await ref.update(out.job);
    if (out.next) {
      out = await out.next().catch((e) => ({ job: { state: "failed", error: String(e.ig?.message || e.message || "error").slice(0, 300), updatedAt: Date.now() }, piece: { ig: { state: "failed", error: String(e.ig?.message || e.message || "error").slice(0, 300), auto: true } } }));
      if (out.job) await ref.update(out.job);
    }
    if (out.piece) {
      const previews = await writePiece(db, contentId, out.piece);
      const remove = [...(out.removePaths || []), ...previews];
      await Promise.all(remove.map((p) => bucket.file(p).delete({ ignoreNotFound: true }).catch((e) => console.warn("[ig-post] delete", p, e.message))));
    }
    const state = out.job?.state || job.state;
    if (!LIVE.includes(state)) {
      console.log(`[ig-post] ${contentId} → ${state}${out.job?.error ? ` (${out.job.error})` : ""}`);
      return state;
    }
    // Waiting on Instagram (or on the hour): look again shortly, while time allows.
    if (Date.now() - started + 6000 > budgetMs) return state;
    if (!out.job) await sleep(5000);
  }
}
