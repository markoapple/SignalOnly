const STYLE_ID = "signalonly-focus-style";
const ATTR = "data-signalonly-noise";
const ROOT_ATTR = "data-signalonly-active";
const INJECT_ATTR = "data-signalonly-fingerprint";
const EDITABLE_SELECTOR = "input, textarea, select, form, [contenteditable]:not([contenteditable='false']), [role='textbox'], [aria-multiline='true']";

let focusProfile = null;
let effectiveCleanup = null;
let observer = null;
let scanTimer = 0;
let pendingApply = null;
let lastScanTime = 0;
let lastConfig = null;
let shieldReady = false;
let pendingShieldConfig = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "signalonly:update") {
    void loadAndApply();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && pendingApply) {
    pendingApply = null;
    void loadAndApply();
  }
});

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.__signalonly !== true) return;
  if (data.type === "signalonly:shield-ready") {
    shieldReady = true;
    if (pendingShieldConfig) {
      window.postMessage({ __signalonly: true, type: "signalonly:configure", ...pendingShieldConfig }, "*");
      pendingShieldConfig = null;
    }
  } else if (data.type === "signalonly:reload-required") {
    chrome.runtime.sendMessage({ type: "signalReloadRequired" }).catch(() => {});
  }
});

void loadAndApply();

async function loadAndApply() {
  if (document.hidden) {
    pendingApply = true;
    return;
  }

  const config = await getConfig();
  if (!config?.ok) {
    removeFocusSurface();
    return;
  }
  lastConfig = config;

  const wantShields = config.enabled && config.profile && shouldRunShields(config);
  if (wantShields) {
    ensureShieldInjected(config);
    sendShieldConfig(config);
  } else if (shieldReady) {
    // Shield exists but should be off; tell it to revert.
    sendShieldConfig({ ...config, settings: emptyShieldSettings(), profile: { randomization: null } });
  }

  // Visual cleanup runs whenever the site is enabled and a profile is available,
  // independent of shields. Background returns config.profile in that case too.
  if (config.site?.cleanupEnabled && config.profile) {
    focusProfile = config.profile;
    effectiveCleanup = config.site?.modules?.cleanup || focusProfile.defaultCleanup || {};
    applyFocusSurface(focusProfile, effectiveCleanup);
  } else {
    removeFocusSurface();
  }
}

function emptyShieldSettings() {
  return {
    fingerprintShield: false,
    storageShield: false,
    sensorShield: false,
    behaviorNoise: false,
    blockServiceWorkers: false,
    piiShield: false
  };
}

function shouldRunShields(config) {
  const s = config.settings || {};
  return Boolean(s.fingerprintShield || s.storageShield || s.sensorShield || s.behaviorNoise || s.blockServiceWorkers);
}

async function getConfig() {
  try {
    return await chrome.runtime.sendMessage({ type: "getContentConfig", url: location.href });
  } catch {
    return null;
  }
}

function ensureShieldInjected(config) {
  if (document.documentElement.hasAttribute(INJECT_ATTR)) return;
  document.documentElement.setAttribute(INJECT_ATTR, "1");
  // Prefer the SW-side scripting.executeScript({ world: "MAIN" }) path because
  // it bypasses page CSP. Fall back to a <script src> tag if the SW says it
  // can't (no `scripting` permission, or executeScript failed for this tab).
  chrome.runtime.sendMessage({
    type: "injectShield",
    bootstrap: { settings: config.settings, profile: config.profile?.randomization || null }
  }).then((response) => {
    if (response && response.ok) return;
    injectShieldViaScriptTag(config);
  }).catch(() => injectShieldViaScriptTag(config));
}

function injectShieldViaScriptTag(config) {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("src/injected/fingerprint.js");
  script.dataset.signalonlyConfig = JSON.stringify({
    settings: config.settings,
    profile: config.profile?.randomization
  });
  script.onload = () => script.remove();
  script.onerror = () => {
    // CSP likely blocked us. Surface as reload-required so the popup banner
    // appears; the user may need to remove this site's assignment, or we may
    // simply not be able to shield this site.
    script.remove();
    chrome.runtime.sendMessage({ type: "signalReloadRequired" }).catch(() => {});
  };
  (document.documentElement || document.head || document).appendChild(script);
}

function sendShieldConfig(config) {
  const payload = { settings: config.settings, profile: config.profile?.randomization || null };
  if (!shieldReady) {
    pendingShieldConfig = payload;
    return;
  }
  window.postMessage({ __signalonly: true, type: "signalonly:configure", ...payload }, "*");
}

function applyFocusSurface(profile, cleanup) {
  installStyle(profile, cleanup);
  document.documentElement.setAttribute(ROOT_ATTR, profile.id);
  scheduleScan();
  if (!observer) {
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["class","id","aria-label","data-testid"]
    });
  }
}

function removeFocusSurface() {
  document.getElementById(STYLE_ID)?.remove();
  document.documentElement.removeAttribute(ROOT_ATTR);
  document.querySelectorAll(`[${ATTR}]`).forEach((node) => node.removeAttribute(ATTR));
  if (observer) { observer.disconnect(); observer = null; }
  if (scanTimer) { window.clearTimeout(scanTimer); scanTimer = 0; }
  focusProfile = null;
  effectiveCleanup = null;
}

function installStyle(profile, cleanup) {
  const m = cleanup || profile.defaultCleanup || {};
  const dim = 0.28;
  const metricDim = Math.min(0.62, dim + 0.14);
  const style = document.getElementById(STYLE_ID) || document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    :root[${ROOT_ATTR}] [${ATTR}~="recommendations"],
    :root[${ROOT_ATTR}] [${ATTR}~="overlays"] { display: none !important; }
    :root[${ROOT_ATTR}] [${ATTR}~="comments"] {
      opacity: ${m.comments ? dim : 1} !important;
      max-height: ${m.comments ? "190px" : "none"} !important;
      overflow: ${m.comments ? "hidden" : "visible"} !important;
    }
    :root[${ROOT_ATTR}] [${ATTR}~="metrics"] { opacity: ${m.metrics ? metricDim : 1} !important; }
    :root[${ROOT_ATTR}] [${ATTR}~="sticky"] {
      opacity: ${m.sticky ? 0.22 : 1} !important;
      pointer-events: ${m.sticky ? "none" : "auto"} !important;
    }
    :root[${ROOT_ATTR}] [${ATTR}~="recommendations"] *,
    :root[${ROOT_ATTR}] [${ATTR}~="overlays"] *,
    :root[${ROOT_ATTR}] [${ATTR}~="comments"] *,
    :root[${ROOT_ATTR}] [${ATTR}~="metrics"] * {
      animation-duration: ${m.motion ? "0.001ms" : "initial"} !important;
      animation-iteration-count: ${m.motion ? "1" : "initial"} !important;
      transition-duration: ${m.motion ? "0.001ms" : "initial"} !important;
    }
    :root[${ROOT_ATTR}] { scroll-behavior: ${m.motion ? "auto" : "smooth"} !important; }
  `;
  if (!style.parentNode) (document.head || document.documentElement).appendChild(style);
}

function scheduleScan() {
  if (scanTimer || document.hidden) return;
  const elapsed = Date.now() - lastScanTime;
  const delay = elapsed < 300 ? 250 : 120;
  scanTimer = window.setTimeout(() => {
    scanTimer = 0; lastScanTime = Date.now(); scanPage();
  }, delay);
}

function scanPage() {
  if (!focusProfile) return;
  const m = effectiveCleanup || focusProfile.defaultCleanup || {};
  const tagged = document.querySelectorAll(`[${ATTR}]`);
  tagged.forEach((node) => { if (!node.isConnected) node.removeAttribute(ATTR); });
  markKnownSiteSelectors(m);
  const candidates = document.querySelectorAll("aside, nav, header, section, article, div, ul, ol, li, span, a, button");
  let inspected = 0;
  for (const el of candidates) {
    if (inspected > 1800) break;
    inspected += 1;
    if (!(el instanceof HTMLElement) || shouldSkip(el)) continue;
    if (el.hasAttribute(ATTR)) continue;
    const tokens = classifyElement(el, m);
    if (tokens.length) el.setAttribute(ATTR, tokens.join(" "));
  }
}

function markKnownSiteSelectors(m) {
  const host = location.hostname.replace(/^www\./, "");
  const selectors = [];
  if (m.recommendations) {
    selectors.push(
      "ytd-watch-next-secondary-results-renderer","ytd-reel-shelf-renderer","ytd-merch-shelf-renderer",
      "#secondary","[data-testid='sidebar-column']","[data-testid='placementTracking']",
      "shreddit-sidebar-ad","[aria-label='Trending']","[aria-label='Who to follow']"
    );
  }
  if (m.comments) selectors.push("ytd-comments","#comments","[data-testid='comment']");
  if (m.metrics) selectors.push("[class*='engagement' i]","[class*='stats' i]");
  if (m.overlays) selectors.push("[role='dialog']","[aria-modal='true']","[class*='modal' i]","[class*='popup' i]","[class*='newsletter' i]");
  if (host.includes("youtube.com") && m.recommendations) selectors.push("ytd-compact-video-renderer","ytd-item-section-renderer");
  selectors.forEach((sel) => {
    let matches; try { matches = document.querySelectorAll(sel); } catch { return; }
    matches.forEach((el) => { if (!isTooLarge(el)) addToken(el, tokenFromSelector(sel)); });
  });
}

function classifyElement(el, m) {
  const attrs = `${el.id} ${el.className} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("data-testid") || ""}`.toLowerCase();
  const isSmall = !el.children.length || (el.textContent || "").length < 500;
  const haystack = isSmall ? `${attrs} ${(el.textContent || "").slice(0, 120)}` : attrs;
  const tokens = [];
  if (m.recommendations && /recommended|recommendation|suggested|suggestion|for-you|trending|who-to-follow|shorts|reels/i.test(attrs)) tokens.push("recommendations");
  if (m.comments && /comments?|replies|discussion/i.test(haystack)) tokens.push("comments");
  if (m.metrics && /\b(\d[\d,.]*\s*)?(views?|likes?|followers?|subscribers?|shares?|reposts?|retweets?|reactions?)\b/i.test(haystack)) tokens.push("metrics");
  if (m.overlays && /modal|popup|newsletter|subscribe|consent-banner|cookie-banner/i.test(attrs)) tokens.push("overlays");
  if (m.sticky && isSticky(el)) tokens.push("sticky");
  if (isTooLarge(el)) {
    return [...new Set(tokens.filter((t) => t !== "recommendations" && t !== "overlays"))];
  }
  return [...new Set(tokens)];
}

function isTooLarge(el) {
  try {
    const rect = el.getBoundingClientRect();
    return rect.width * rect.height > window.innerWidth * window.innerHeight * 0.4;
  } catch { return false; }
}
function addToken(el, token) {
  if (!(el instanceof HTMLElement) || shouldSkip(el)) return;
  const current = new Set((el.getAttribute(ATTR) || "").split(/\s+/).filter(Boolean));
  current.add(token);
  el.setAttribute(ATTR, [...current].join(" "));
}
function tokenFromSelector(sel) {
  if (/comment/i.test(sel)) return "comments";
  if (/engagement|stats|like|view/i.test(sel)) return "metrics";
  if (/dialog|modal|popup|newsletter|subscribe/i.test(sel)) return "overlays";
  return "recommendations";
}
function shouldSkip(el) {
  return el === document.body || el === document.documentElement
    || hasEditableSurface(el)
    || el.closest("[data-signalonly-keep]");
}
function hasEditableSurface(el) {
  return el.matches(EDITABLE_SELECTOR)
    || el.closest(EDITABLE_SELECTOR)
    || Boolean(el.querySelector(EDITABLE_SELECTOR));
}
function isSticky(el) {
  const tag = el.tagName.toLowerCase();
  if (!["header","nav","aside","div"].includes(tag)) return false;
  const style = getComputedStyle(el);
  if (style.position !== "fixed" && style.position !== "sticky") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 240 && rect.height > 32 && rect.height < window.innerHeight * 0.45;
}
