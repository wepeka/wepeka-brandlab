// Node module customization hooks (registered from tests/setup.mjs via
// module.register()) — resolves the app's hard-coded
// https://www.gstatic.com/firebasejs/... specifiers to the local fakes in
// tests/stubs/ instead of trying to fetch them over the network.
const STUB_DIR = new URL("./stubs/", import.meta.url);

const MAP = [
  [/firebasejs\/[^/]+\/firebase-app\.js$/, "firebase-app.js"],
  [/firebasejs\/[^/]+\/firebase-firestore\.js$/, "firebase-firestore.js"],
  [/firebasejs\/[^/]+\/firebase-auth\.js$/, "firebase-auth.js"],
];

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("https://www.gstatic.com/firebasejs/")) {
    for (const [pattern, file] of MAP) {
      if (pattern.test(specifier)) {
        return nextResolve(new URL(file, STUB_DIR).href, context);
      }
    }
    throw new Error(`tests/hooks.mjs: no stub mapped for ${specifier}`);
  }
  return nextResolve(specifier, context);
}
