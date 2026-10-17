import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  RECORDING_TYPES,
  pickRecordingType,
  recordingExtension,
  recordingFileName,
  cameraErrorKind,
  devicePlatform,
  formatDuration,
  canPauseRecording,
} from "../js/views/teleprompter-record.js";

describe("teleprompter record mode: recording format", () => {
  test("MP4 wins whenever the browser can record it (iPhone Safari, recent Chrome)", () => {
    const safari = (type) => type === "video/mp4";
    assert.equal(pickRecordingType(safari), "video/mp4");
    const chrome = (type) => /mp4;codecs=avc1,mp4a|webm/.test(type);
    assert.equal(pickRecordingType(chrome), "video/mp4;codecs=avc1,mp4a");
  });
  test("WebM when MP4 isn't there; empty when nothing is (the browser picks)", () => {
    assert.equal(pickRecordingType((type) => type.startsWith("video/webm")), "video/webm;codecs=vp9,opus");
    assert.equal(pickRecordingType(() => false), "");
    assert.equal(pickRecordingType(() => {
      throw new Error("unknown codec");
    }), "");
  });
  test("every candidate is a video type, MP4 ones first", () => {
    const firstWebm = RECORDING_TYPES.findIndex((type) => type.includes("webm"));
    assert.ok(RECORDING_TYPES.slice(0, firstWebm).every((type) => type.startsWith("video/mp4")));
    assert.ok(RECORDING_TYPES.slice(firstWebm).every((type) => type.startsWith("video/webm")));
  });
  test("file extension follows the recorded type", () => {
    assert.equal(recordingExtension("video/mp4"), "mp4");
    assert.equal(recordingExtension("video/x-matroska;codecs=avc1"), "mkv");
    assert.equal(recordingExtension("video/webm"), "webm");
    assert.equal(recordingExtension(""), "webm");
  });
});

describe("teleprompter record mode: file name", () => {
  const when = new Date(2026, 9, 15, 9, 5);
  test("brandlab-<title>-<date-time>, safe characters only", () => {
    assert.equal(recordingFileName("Video jendela drive-thru!", "video/mp4", when), "brandlab-video-jendela-drive-thru-20261015-0905.mp4");
    assert.equal(recordingFileName("Kopi Señor ☕ #1", "video/webm", when), "brandlab-kopi-senor-1-20261015-0905.webm");
  });
  test("no title → 'video'; long titles are cut without a trailing dash", () => {
    assert.equal(recordingFileName("", "video/mp4", when), "brandlab-video-20261015-0905.mp4");
    const name = recordingFileName("satu dua tiga empat lima enam tujuh delapan sembilan", "video/mp4", when);
    assert.match(name, /^brandlab-[a-z0-9-]+[a-z0-9]-20261015-0905\.mp4$/);
    assert.ok(name.length <= "brandlab-".length + 40 + "-20261015-0905.mp4".length);
  });
});

describe("teleprompter record mode: camera errors and device", () => {
  test("getUserMedia error names map to the right help text", () => {
    assert.equal(cameraErrorKind({ name: "NotAllowedError" }), "denied");
    assert.equal(cameraErrorKind({ name: "SecurityError" }), "denied");
    assert.equal(cameraErrorKind({ name: "NotFoundError" }), "notFound");
    assert.equal(cameraErrorKind({ name: "OverconstrainedError" }), "notFound");
    assert.equal(cameraErrorKind({ name: "NotReadableError" }), "busy");
    assert.equal(cameraErrorKind({ name: "TypeError" }), "generic");
    assert.equal(cameraErrorKind(undefined), "generic");
  });
  test("iPhone, iPad (reports as a Mac with touch), Android, desktop", () => {
    assert.equal(devicePlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), "ios");
    assert.equal(devicePlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 }), "ios");
    assert.equal(devicePlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)", platform: "Linux armv8l", maxTouchPoints: 5 }), "android");
    // Chrome's phone emulation on a Mac: Android UA, Mac platform, touch.
    assert.equal(devicePlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14)", platform: "MacIntel", maxTouchPoints: 5 }), "android");
    assert.equal(devicePlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 }), "desktop");
    assert.equal(devicePlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }), "desktop");
  });
  test("timer reads m:ss", () => {
    assert.equal(formatDuration(0), "0:00");
    assert.equal(formatDuration(4_900), "0:04");
    assert.equal(formatDuration(61_000), "1:01");
    assert.equal(formatDuration(600_000), "10:00");
  });
});

describe("teleprompter record mode: pause", () => {
  test("the pause button needs both pause() and resume() on the recorder", () => {
    class Full { pause() {} resume() {} }
    class NoResume { pause() {} }
    assert.equal(canPauseRecording(Full), true);
    assert.equal(canPauseRecording(NoResume), false);
    assert.equal(canPauseRecording(undefined), false);
  });
});
