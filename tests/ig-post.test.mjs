import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadPaths, accountFor, atOf, wibDate, newJob, containerParams, step, prefixOf, EARLY_MS } from "../api/_igPost.js";

const piece = (posting = {}, extra = {}) => ({ id: "c1", brandId: "bw", ownerId: "u1", caption: "Cap", status: "editing", posting: { type: "reels", versions: [], ...posting }, ...extra });
const brands = [
  { id: "bw", ownerId: "u1", name: "winkhsin" },
  { id: "bp", ownerId: "u1", name: "wepeka", instagram: { username: "winkhsin", igUserId: "17841400566996586", accessToken: "IGAA-x" } },
  { id: "bx", ownerId: "u2", name: "other", instagram: { username: "winkhsin2", igUserId: "1784", accessToken: "t" } },
];

test("copies only go under the owner's piece, as video or JPG", () => {
  const [f] = uploadPaths("u1", "c1", [{ name: "v2 final.mp4", type: "video/mp4", size: 10 }]);
  assert.ok(f.path.startsWith(prefixOf("u1", "c1")) && f.path.endsWith("-01-v2-final.mp4"));
  assert.throws(() => uploadPaths("u1", "c1", [{ name: "a.png", type: "image/png", size: 10 }]), /type/, "Instagram takes JPEG only");
  assert.throws(() => uploadPaths("u1", "c1", [{ name: "a.mp4", type: "video/mp4", size: 301 * 1048576 }]), /size/);
});

test("a brand without its own connection posts through the owner's brand connected to its name", () => {
  assert.equal(accountFor(brands, "bw").igUserId, "17841400566996586");
  assert.equal(accountFor(brands, "bp").brandId, "bp");
  assert.equal(accountFor([{ id: "z", ownerId: "u1", name: "nobody" }, ...brands], "z"), null);
  assert.equal(accountFor([{ id: "y", ownerId: "u9", name: "winkhsin" }, ...brands], "y"), null, "never another owner's account");
});

test("hours are WIB", () => {
  assert.equal(new Date(atOf("2026-11-03", "19:00")).toISOString(), "2026-11-03T12:00:00.000Z");
  assert.equal(wibDate(Date.parse("2026-11-03T18:30:00Z")), "2026-11-04");
  assert.ok(Number.isNaN(atOf("bad", "19:00")));
});

test("a job only takes this owner's copies and never a posted piece", () => {
  const pre = prefixOf("u1", "c1");
  const job = newJob(piece({ trialReel: true }), { uid: "u1", paths: [`${pre}a-01-v2.mp4`], cover: `${pre}a-02-thumbnail-1.jpg`, kind: "video", at: 100, now: 50 });
  assert.equal(job.state, "waiting");
  assert.equal(job.trial, true);
  assert.throws(() => newJob(piece(), { uid: "u1", paths: ["igpost/u2/c1/x.mp4"], kind: "video", at: 1 }), /paths/);
  assert.throws(() => newJob(piece({}, { status: "published" }), { uid: "u1", paths: [`${pre}x.mp4`], kind: "video", at: 1 }), /posted/);
  assert.throws(() => newJob(piece({ type: "carousel" }), { uid: "u1", paths: [`${pre}1.jpg`], kind: "set", at: 1 }), /slides/);
});

test("reels carry caption, cover and the trial setting; carousels are items then one parent", () => {
  const reel = containerParams({ type: "reels", paths: ["x/v.mp4"], trial: true }, { urls: ["https://v"], coverUrl: "https://c", caption: "Hai" }).single;
  assert.equal(reel.media_type, "REELS");
  assert.equal(reel.cover_url, "https://c");
  assert.deepEqual(JSON.parse(reel.trial_params), { graduation_strategy: "SS_PERFORMANCE" });
  const car = containerParams({ type: "carousel", paths: ["x/1.jpg", "x/2.jpg"] }, { urls: ["https://1", "https://2"], caption: "Cap" });
  assert.deepEqual(car.children[0], { image_url: "https://1", is_carousel_item: "true" });
  assert.deepEqual(car.parent(["a", "b"]), { media_type: "CAROUSEL", children: "a,b", caption: "Cap" });
});

// A fake Instagram: records calls, answers from a script.
function fakeGraph(answers) {
  const calls = [];
  const graph = async (method, path, params) => {
    calls.push({ method, path, params });
    const a = answers[`${method} ${path}`];
    const out = typeof a === "function" ? a(params) : a;
    if (out instanceof Error) throw out;
    return out ?? {};
  };
  return { graph, calls };
}
const account = { igUserId: "17841400566996586", token: "t" };
const sign = async (p) => `https://signed/${p}`;

test("a reel: container a few minutes early, published on the hour, link written back, copies deleted", async () => {
  const at = Date.parse("2026-11-03T12:00:00Z");
  let job = { ...newJob(piece(), { uid: "u1", paths: [`${prefixOf("u1", "c1")}a-01-v2.mp4`], cover: "", kind: "video", at, now: at - 3600e3 }) };
  const { graph, calls } = fakeGraph({
    "POST /17841400566996586/media": { id: "C1" },
    "GET /C1": { status_code: "FINISHED" },
    "POST /17841400566996586/media_publish": { id: "M1" },
    "GET /M1": { permalink: "https://www.instagram.com/reel/ABC/" },
  });
  // An hour before: nothing yet.
  assert.equal((await step(job, { graph, sign, caption: "Cap", account, now: at - 3600e3 })).job, null);
  // Five minutes before: the container.
  let out = await step(job, { graph, sign, caption: "Cap baru", account, now: at - EARLY_MS });
  assert.equal(out.job.state, "container");
  assert.equal(calls[0].params.caption, "Cap baru", "the caption as it is now");
  job = { ...job, ...out.job };
  // Ready before the hour: waits.
  assert.equal((await step(job, { graph, sign, caption: "", account, now: at - 60e3 })).job, null);
  // On the hour: publishing, then done.
  out = await step(job, { graph, sign, caption: "", account, now: at });
  assert.equal(out.job.state, "publishing");
  const end = await out.next();
  assert.equal(end.job.state, "done");
  assert.equal(end.piece.ig.permalink, "https://www.instagram.com/reel/ABC/");
  assert.equal(end.piece.publishedDate, "2026-11-03");
  assert.deepEqual(end.removePaths, job.paths);
});

test("Instagram's refusal ends the job as failed with its own words", async () => {
  const job = { ...newJob(piece(), { uid: "u1", paths: [`${prefixOf("u1", "c1")}v.mp4`], kind: "video", at: 1, now: 1 }), state: "container", creation: "C1", containerAt: 1 };
  const { graph } = fakeGraph({ "GET /C1": { status_code: "ERROR", status: "Error: video aspect ratio not supported" } });
  const out = await step(job, { graph, sign, caption: "", account, now: 2 });
  assert.equal(out.job.state, "failed");
  assert.match(out.piece.ig.error, /aspect ratio/);
  const boom = Object.assign(new Error("x"), { ig: { message: "Invalid OAuth access token" } });
  const out2 = await step({ ...job, state: "waiting" }, { graph: fakeGraph({ "POST /17841400566996586/media": boom }).graph, sign, caption: "", account, now: 2 });
  assert.match(out2.job.error, /OAuth/);
  assert.equal((await step(job, { graph, sign, caption: "", account: null, now: 2 })).job.state, "failed", "no connection");
});

test("published by a run that crashed: found again, not posted twice", async () => {
  const job = { ...newJob(piece(), { uid: "u1", paths: [`${prefixOf("u1", "c1")}v.mp4`], kind: "video", at: 1, now: 1 }), state: "publishing", creation: "C1", updatedAt: 1 };
  const { graph, calls } = fakeGraph({ "GET /C1": { status_code: "PUBLISHED" }, "GET /17841400566996586/media": { data: [{ id: "M9" }] }, "GET /M9": { permalink: "https://www.instagram.com/reel/Z/" } });
  const out = await step(job, { graph, sign, caption: "", account, now: 10 * 60e3 });
  assert.equal(out.job.state, "done");
  assert.ok(!calls.some((c) => c.path.endsWith("media_publish")));
});

test("a carousel waits for every slide, then makes the album", async () => {
  const pre = prefixOf("u1", "c1");
  let job = newJob(piece({ type: "carousel" }), { uid: "u1", paths: [`${pre}1.jpg`, `${pre}2.jpg`], kind: "set", at: 1, now: 1 });
  let n = 0;
  const { graph } = fakeGraph({ "POST /17841400566996586/media": (p) => ({ id: p.media_type === "CAROUSEL" ? "P" : `K${++n}` }), "GET /K1": { status_code: "FINISHED" }, "GET /K2": { status_code: "IN_PROGRESS" } });
  let out = await step(job, { graph, sign, caption: "Cap", account, now: 2 });
  assert.deepEqual(out.job.children, ["K1", "K2"]);
  job = { ...job, ...out.job };
  assert.equal((await step(job, { graph, sign, caption: "Cap", account, now: 3 })).job, null, "K2 not ready");
  const ready = fakeGraph({ "POST /17841400566996586/media": { id: "P" }, "GET /K1": { status_code: "FINISHED" }, "GET /K2": { status_code: "FINISHED" } });
  out = await step(job, { graph: ready.graph, sign, caption: "Cap", account, now: 4 });
  assert.equal(out.job.state, "container");
  assert.equal(ready.calls.at(-1).params.children, "K1,K2");
});

// ---- The brand's Facebook Page, shared with every post (owner, 2026-11-07) ----
import { facebookFor, facebookPlan, facebookJob, fbClient } from "../api/_igPost.js";

const fbBrands = [
  { id: "bw", ownerId: "u1", name: "winkhsin", instagram: { username: "winkhsin", igUserId: "17841400566996586", accessToken: "IGAA-own" } },
  { id: "bp", ownerId: "u1", name: "wepeka", instagram: { username: "winkhsin", igUserId: "17841400566996586", accessToken: "IGAA-x" }, facebook: { pageId: "1001234567", pageAccessToken: "EAA-page", pageName: "winkhsin" } },
  { id: "bx", ownerId: "u2", name: "winkhsin", facebook: { pageId: "999999", pageAccessToken: "EAA-other", pageName: "not yours" } },
];
const page = { pageId: "1001234567", token: "EAA-page", name: "winkhsin" };

test("the Page comes from the brand, or the owner's brand holding the same Instagram", () => {
  assert.equal(facebookFor(fbBrands, "bp").pageId, "1001234567");
  assert.equal(facebookFor(fbBrands, "bw", accountFor(fbBrands, "bw")).pageId, "1001234567", "winkhsin pieces share to the Page on the wepeka brand");
  assert.equal(facebookFor([{ id: "z", ownerId: "u1", name: "nobody" }, ...fbBrands], "z"), null);
  assert.equal(facebookFor([{ id: "y", ownerId: "u9", name: "winkhsin" }, ...fbBrands], "y"), null, "never another owner's Page");
});

test("what goes to the Page: video with its cover, photo, carousel photos; stories stay on Instagram", () => {
  const v = facebookPlan({ type: "reels", paths: ["x/v.mp4"] }, { urls: ["https://v"], coverUrl: "https://c", caption: "Hai" });
  assert.deepEqual(v, { video: { file_url: "https://v", description: "Hai", published: "true" }, thumbUrl: "https://c" });
  assert.deepEqual(facebookPlan({ type: "foto", paths: ["x/1.jpg"] }, { urls: ["https://1"], caption: "Cap" }), { photo: { url: "https://1", caption: "Cap" } });
  assert.deepEqual(facebookPlan({ type: "carousel", paths: ["x/1.jpg", "x/2.mp4", "x/3.jpg"] }, { urls: ["https://1", "https://2", "https://3"], caption: "Cap" }), { photos: ["https://1", "https://3"], message: "Cap" });
  assert.ok(facebookPlan({ type: "story", paths: ["x/1.jpg"] }, { urls: ["https://1"] }).skip);
  assert.ok(facebookPlan({ type: "carousel", paths: ["x/1.mp4", "x/2.mp4"] }, { urls: ["a", "b"] }).skip);
});

test("a reel with Facebook on: Instagram first, then the Page; copies kept until Facebook has the video", async () => {
  const at = Date.parse("2026-11-07T12:00:00Z");
  const pre = prefixOf("u1", "c1");
  let job = newJob(piece(), { uid: "u1", paths: [`${pre}a-01-v8.mp4`], cover: `${pre}a-02-thumbnail-1.jpg`, kind: "video", at, facebook: true, now: at - 3600e3 });
  assert.deepEqual(job.fb, { state: "waiting" });
  job = { ...job, state: "publishing", creation: "C1", updatedAt: at - 10 * 60e3 };
  const ig = fakeGraph({ "GET /C1": { status_code: "FINISHED" }, "POST /17841400566996586/media_publish": { id: "M1" }, "GET /M1": { permalink: "https://www.instagram.com/reel/ABC/" } });
  let out = await step(job, { graph: ig.graph, sign, caption: "Cap", account, page, fbGraph: async () => assert.fail("not yet"), now: at });
  out = await out.next();
  assert.equal(out.job.state, "facebook");
  assert.equal(out.piece.ig.state, "published", "Instagram is written as live right away");
  assert.deepEqual(out.piece.fb, { state: "waiting", page: "winkhsin" });
  assert.equal(out.removePaths, undefined, "the copies stay for Facebook");
  job = { ...job, ...out.job };

  const fb = fakeGraph({ "POST /1001234567/videos": { id: "FV1" }, "GET /FV1": { status: { video_status: "processing" } } });
  const fbGraph = async (m, p, params, opts) => { fb.calls.push({ opts }); return fb.graph(m, p, params); };
  out = await step(job, { graph: ig.graph, sign, caption: "Cap baru", account, page, fbGraph, now: at + 60e3 });
  assert.deepEqual(out.job.fb, { state: "sent", id: "FV1", sentAt: at + 60e3 });
  const posted = fb.calls.find((c) => c.path === "/1001234567/videos");
  assert.equal(posted.params.description, "Cap baru");
  assert.equal(posted.params.file_url, `https://signed/${pre}a-01-v8.mp4`);
  assert.equal(fb.calls.find((c) => c.opts)?.opts.thumbUrl, `https://signed/${pre}a-02-thumbnail-1.jpg`, "the picked cover goes along");
  job = { ...job, ...out.job };
  assert.equal((await step(job, { graph: ig.graph, sign, caption: "", account, page, fbGraph, now: at + 2 * 60e3 })).job, null, "still processing");

  const ready = fakeGraph({ "GET /FV1": { status: { video_status: "ready" }, permalink_url: "/reel/555/" } });
  out = await step(job, { graph: ig.graph, sign, caption: "", account, page, fbGraph: ready.graph, now: at + 3 * 60e3 });
  assert.equal(out.job.state, "done");
  assert.equal(out.piece.fb.state, "done");
  assert.equal(out.piece.fb.permalink, "https://www.facebook.com/reel/555/");
  assert.equal(out.piece.ig, undefined, "Instagram's result is left alone");
  assert.deepEqual(out.removePaths, [...job.paths, job.cover]);
});

test("Facebook refusing never turns the Instagram post red", async () => {
  const pre = prefixOf("u1", "c1");
  const job = { ...newJob(piece(), { uid: "u1", paths: [`${pre}v.mp4`], kind: "video", at: 1, facebook: true, now: 1 }), state: "facebook" };
  const boom = Object.assign(new Error("x"), { ig: { message: "(#200) Requires pages_manage_posts permission" } });
  const out = await step(job, { graph: null, sign, caption: "", account, page, fbGraph: fakeGraph({ "POST /1001234567/videos": boom }).graph, now: 5 });
  assert.equal(out.job.state, "done");
  assert.equal(out.piece.fb.state, "failed");
  assert.match(out.piece.fb.error, /pages_manage_posts/);
  assert.equal(out.piece.ig, undefined);
  assert.deepEqual(out.removePaths, job.paths);
  const none = await step(job, { graph: null, sign, caption: "", account, page: null, fbGraph: null, now: 5 });
  assert.equal(none.piece.fb.state, "failed", "no Page connected");
});

test("a cover Facebook won't take: the video still goes, Facebook picks a frame", async () => {
  const pre = prefixOf("u1", "c1");
  const job = { ...newJob(piece(), { uid: "u1", paths: [`${pre}v.mp4`], cover: `${pre}c.jpg`, kind: "video", at: 1, facebook: true, now: 1 }), state: "facebook" };
  const seen = [];
  const fbGraph = async (m, p, params, opts = {}) => { seen.push(opts.thumbUrl || ""); if (opts.thumbUrl) throw Object.assign(new Error("x"), { ig: { message: "Invalid image" } }); return { id: "FV2" }; };
  const out = await step(job, { graph: null, sign, caption: "", account, page, fbGraph, now: 5 });
  assert.equal(out.job.fb.state, "sent");
  assert.equal(seen.length, 2);
  assert.equal(seen[1], "");
});

test("photos and carousels go up in one move", async () => {
  const pre = prefixOf("u1", "c1");
  const photo = { ...newJob(piece({ type: "foto" }), { uid: "u1", paths: [`${pre}1.jpg`], kind: "image", at: 1, facebook: true, now: 1 }), state: "facebook" };
  let out = await step(photo, { graph: null, sign, caption: "Cap", account, page, fbGraph: fakeGraph({ "POST /1001234567/photos": { id: "P1", post_id: "1001234567_77" } }).graph, now: 5 });
  assert.equal(out.piece.fb.permalink, "https://www.facebook.com/1001234567_77");
  const car = { ...newJob(piece({ type: "carousel" }), { uid: "u1", paths: [`${pre}1.jpg`, `${pre}2.jpg`], kind: "set", at: 1, facebook: true, now: 1 }), state: "facebook" };
  let n = 0;
  const g = fakeGraph({ "POST /1001234567/photos": () => ({ id: `F${++n}` }), "POST /1001234567/feed": { id: "1001234567_88" } });
  out = await step(car, { graph: null, sign, caption: "Cap", account, page, fbGraph: g.graph, now: 5 });
  assert.ok(g.calls.slice(0, 2).every((c) => c.params.published === "false"), "photos wait unpublished");
  assert.deepEqual(JSON.parse(g.calls[2].params.attached_media), [{ media_fbid: "F1" }, { media_fbid: "F2" }]);
  assert.equal(out.piece.fb.state, "done");
});

test("sharing a piece that's already on Instagram goes straight to the Page", () => {
  const pre = prefixOf("u1", "c1");
  const job = facebookJob(piece({ ig: { state: "published" } }, { status: "published" }), { uid: "u1", paths: [`${pre}v.mp4`], kind: "video", now: 9 });
  assert.equal(job.state, "facebook");
  assert.deepEqual(job.fb, { state: "waiting" });
  assert.equal(job.fbOnly, true);
});

test("the Page client: form post, video host, cover as multipart thumb", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("https://signed")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    return new Response(JSON.stringify({ id: "V1" }), { status: 200 });
  };
  const g = fbClient("EAA-page", fetchImpl);
  await g("POST", "/100/videos", { file_url: "https://v", description: "Hai" }, { video: true, thumbUrl: "https://signed/c.jpg" });
  const post = calls.find((c) => c.url.includes("/100/videos"));
  assert.ok(post.url.startsWith("https://graph-video.facebook.com/"));
  assert.ok(post.init.body instanceof FormData);
  assert.equal(post.init.body.get("access_token"), "EAA-page");
  assert.ok(post.init.body.get("thumb") instanceof Blob);
  const bad = fbClient("t", async () => new Response(JSON.stringify({ error: { message: "(#200) nope" } }), { status: 403 }));
  await assert.rejects(() => bad("POST", "/100/photos", { url: "u" }), /nope/);
});
