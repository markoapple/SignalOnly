const SO_AR_KEY = "signalonly.autoRotateFingerprint";
const SO_AR_STORE = "signalonly:autoRotate:lastSeed";
const SO_AR_MAIN = "signalonly:auto-rotate-configure";
const SO_CFG = "signalonly:configure";
const SO_READY = "signalonly:shield-ready";
let enabled = false;
let ready = false;
let baseProfile = null;
let baseSettings = null;
let rotated = null;
let baseSeed = "";
let timer = 0;

void init();
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "signalonly:update") void init();
});
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.__signalonly !== true) return;
  if (data.type === SO_READY) { ready = true; schedule(); return; }
  if (data.type === SO_CFG && !data.__signalonlyAutoRotated) {
    baseSettings = data.settings || baseSettings;
    if (data.profile?.seedHex) baseProfile = data.profile;
    schedule();
  }
});

async function init() {
  enabled = await readEnabled();
  if (!enabled) { postMain(false, null); return; }
  const config = await getConfig();
  const profile = config?.profile?.randomization || null;
  const settings = config?.settings || null;
  if (config?.enabled && settings?.fingerprintShield && profile?.seedHex) {
    baseProfile = profile;
    baseSettings = settings;
    schedule();
  } else {
    postMain(false, null);
  }
}
async function readEnabled() {
  try { const data = await chrome.storage.sync.get(SO_AR_KEY); return Boolean(data[SO_AR_KEY]); }
  catch { return false; }
}
async function getConfig() {
  try { return await chrome.runtime.sendMessage({ type: "getContentConfig", url: location.href }); }
  catch { return null; }
}
function schedule() {
  if (timer) return;
  timer = window.setTimeout(() => { timer = 0; apply(); }, ready ? 0 : 40);
}
function apply() {
  if (!enabled || !baseSettings?.fingerprintShield || !baseProfile?.seedHex) { postMain(false, null); return; }
  const profile = getRotated(baseProfile);
  const settings = { ...baseSettings, autoRotateFingerprint: true };
  try {
    window.postMessage({ __signalonly: true, __signalonlyAutoRotated: true, type: SO_CFG, settings, profile }, "*");
  } catch {}
  postMain(true, profile);
}
function postMain(on, profile) {
  try { window.postMessage({ __signalonly: true, type: SO_AR_MAIN, enabled: Boolean(on && profile?.seedHex), profile: on ? profile : null }, "*"); }
  catch {}
}
function getRotated(profile) {
  const seed = String(profile.seedHex || profile.profileId || "profile");
  if (rotated && baseSeed === seed) return rotated;
  const loadSeed = randomHex(16);
  rotated = derive(profile, loadSeed);
  baseSeed = seed;
  try { sessionStorage.setItem(SO_AR_STORE, JSON.stringify({ baseSeed: seed, seedHex: loadSeed, createdAt: Date.now(), href: location.href })); }
  catch {}
  return rotated;
}
function derive(source, seed) {
  const out = structuredClone(source || {});
  const rng = prng(hash(`${source.seedHex || ""}:${seed}`));
  const screen = pickScreen(out, rng);
  const gl = pickGl(out, rng);
  out.autoRotated = true;
  out.staticSeedHex = source.seedHex || "";
  out.seedHex = seed;
  out.canvasNoiseSeed = `canvas:${seed}:${token(rng)}`;
  out.audioNoiseSeed = `audio:${seed}:${token(rng)}`;
  out.screen = screen;
  out.webglVendor = gl.vendor;
  out.webglRenderer = gl.renderer;
  out.hardwareConcurrency = pick([4, 6, 8, 12, 16], rng);
  out.mathPrecision = pick([13, 14, 15], rng);
  out.plugins = [{ name: pick(["Chrome PDF Plugin", "Chromium PDF Plugin", "PDF Viewer"], rng), filename: "internal-pdf-viewer", description: "Portable Document Format", mimeTypes: [{ type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" }] }];
  return out;
}
function pickScreen(profile, rng) {
  const mac = String(profile.uaPlatformBrand || profile.platform || "").toLowerCase().includes("mac");
  const choice = pick(mac ? [[1440,900,2],[1512,982,2],[1728,1117,2]] : [[1366,768,1],[1536,864,1.25],[1600,900,1],[1920,1080,1]], rng);
  const reserve = pick([40, 48, 56, 72], rng);
  return { ...(profile.screen || {}), width: choice[0], height: choice[1], availWidth: choice[0], availHeight: Math.max(600, choice[1] - reserve), colorDepth: profile.screen?.colorDepth || 24, pixelDepth: profile.screen?.pixelDepth || 24, devicePixelRatio: choice[2] };
}
function pickGl(profile, rng) {
  const platform = String(profile.uaPlatformBrand || profile.platform || "").toLowerCase();
  const choices = platform.includes("mac")
    ? [["Google Inc. (Apple)", "ANGLE (Apple, Apple M-Series, Metal)"]]
    : [["Google Inc. (Intel)", "ANGLE (Intel, Intel Graphics, D3D11)"], ["Google Inc. (AMD)", "ANGLE (AMD, AMD Radeon Graphics, D3D11)"], ["Google Inc. (Mesa)", "ANGLE (Mesa, llvmpipe, OpenGL)"]];
  const [vendor, renderer] = pick(choices, rng);
  return { vendor, renderer };
}
function randomHex(bytes) { const data = new Uint8Array(bytes); crypto.getRandomValues(data); return [...data].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function hash(input) { let h = 2166136261; for (const ch of String(input)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function prng(seed) { return function next() { let v = seed += 0x6D2B79F5; v = Math.imul(v ^ (v >>> 15), v | 1); v ^= v + Math.imul(v ^ (v >>> 7), v | 61); return ((v ^ (v >>> 14)) >>> 0) / 4294967296; }; }
function pick(list, rng) { return list[Math.floor(rng() * list.length)] || list[0]; }
function token(rng) { return Math.floor(rng() * 0xFFFFFFFF).toString(16).padStart(8, "0"); }
