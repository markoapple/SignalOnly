const STYLE_ID = "signalonly-focus-style";
const ATTR = "data-signalonly-noise";
const ROOT_ATTR = "data-signalonly-active";
const INJECT_ATTR = "data-signalonly-fingerprint";

let focusProfile = null;
let observer = null;
let scanTimer = 0;
let pendingApply = null;
let lastScanTime = 0;

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

void loadAndApply();

async function loadAndApply() {
  if (document.hidden) {
    pendingApply = true;
    return;
  }

  const config = await getConfig();

  if (!config?.ok || !config.enabled || !config.profile) {
    removeFocusSurface();
    return;
  }

  if (shouldInjectFingerprint(config)) {
    injectFingerprint(config);
  }

  if (config.site?.enabled && config.profile?.modules) {
    focusProfile = config.profile;
    applyFocusSurface(focusProfile);
  } else {
    removeFocusSurface();
  }
}

async function getConfig() {
  try {
    return await chrome.runtime.sendMessage({
      type: "getContentConfig",
      url: location.href
    });
  } catch {
    return null;
  }
}

function shouldInjectFingerprint(config) {
  const settings = config.settings || {};
  return Boolean(
    settings.fingerprintShield ||
    settings.storageShield ||
    settings.sensorShield ||
    settings.behaviorNoise ||
    settings.blockServiceWorkers
  );
}

function injectFingerprint(config) {
  if (document.documentElement.hasAttribute(INJECT_ATTR)) {
    return;
  }

  document.documentElement.setAttribute(INJECT_ATTR, "1");
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("src/injected/fingerprint.js");
  script.dataset.signalonlyConfig = JSON.stringify({
    settings: config.settings,
    profile: config.profile?.randomization
  });
  script.onload = () => script.remove();
  script.onerror = () => script.remove();
  (document.documentElement || document.head || document).appendChild(script);
}

function applyFocusSurface(profile) {
  installStyle(profile);
  document.documentElement.setAttribute(ROOT_ATTR, profile.id);
  scheduleScan();

  if (!observer) {
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "id", "aria-label", "data-testid"]
    });
  }
}

function removeFocusSurface() {
  document.getElementById(STYLE_ID)?.remove();
  document.documentElement.removeAttribute(ROOT_ATTR);
  document.querySelectorAll(`[${ATTR}]`).forEach((node) => node.removeAttribute(ATTR));
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (scanTimer) {
    window.clearTimeout(scanTimer);
    scanTimer = 0;
  }
  focusProfile = null;
}

function installStyle(profile) {
  const modules = profile.modules || {};
  const dim = 0.28;
  const metricDim = Math.min(0.62, dim + 0.14);
  const style = document.getElementById(STYLE_ID) || document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    :root[${ROOT_ATTR}] [${ATTR}~="recommendations"],
    :root[${ROOT_ATTR}] [${ATTR}~="overlays"] {
      display: none !important;
    }

    :root[${ROOT_ATTR}] [${ATTR}~="comments"] {
      opacity: ${modules.comments ? dim : 1} !important;
      max-height: ${modules.comments ? "190px" : "none"} !important;
      overflow: ${modules.comments ? "hidden" : "visible"} !important;
    }

    :root[${ROOT_ATTR}] [${ATTR}~="metrics"] {
      opacity: ${modules.metrics ? metricDim : 1} !important;
    }

    :root[${ROOT_ATTR}] [${ATTR}~="sticky"] {
      opacity: ${modules.sticky ? 0.22 : 1} !important;
      pointer-events: ${modules.sticky ? "none" : "auto"} !important;
    }

    :root[${ROOT_ATTR}] [${ATTR}~="recommendations"] *,
    :root[${ROOT_ATTR}] [${ATTR}~="overlays"] *,
    :root[${ROOT_ATTR}] [${ATTR}~="comments"] *,
    :root[${ROOT_ATTR}] [${ATTR}~="metrics"] * {
      animation-duration: ${modules.motion ? "0.001ms" : "initial"} !important;
      animation-iteration-count: ${modules.motion ? "1" : "initial"} !important;
      transition-duration: ${modules.motion ? "0.001ms" : "initial"} !important;
    }
    :root[${ROOT_ATTR}] {
      scroll-behavior: ${modules.motion ? "auto" : "smooth"} !important;
    }
  `;

  if (!style.parentNode) {
    (document.head || document.documentElement).appendChild(style);
  }
}

function scheduleScan() {
  if (scanTimer || document.hidden) {
    return;
  }

  const elapsed = Date.now() - lastScanTime;
  const delay = elapsed < 300 ? 250 : 120;

  scanTimer = window.setTimeout(() => {
    scanTimer = 0;
    lastScanTime = Date.now();
    scanPage();
  }, delay);
}

function scanPage() {
  if (!focusProfile) {
    return;
  }

  const modules = focusProfile.modules || {};

  const tagged = document.querySelectorAll(`[${ATTR}]`);
  tagged.forEach((node) => {
    if (!node.isConnected) {
      node.removeAttribute(ATTR);
    }
  });

  markKnownSiteSelectors(modules);

  const candidates = document.querySelectorAll("aside, nav, header, section, article, div, ul, ol, li, span, a, button");
  let inspected = 0;
  for (const element of candidates) {
    if (inspected > 1800) {
      break;
    }
    inspected += 1;
    if (!(element instanceof HTMLElement) || shouldSkip(element)) {
      continue;
    }

    if (element.hasAttribute(ATTR)) {
      continue;
    }

    const tokens = classifyElement(element, modules);
    if (tokens.length) {
      element.setAttribute(ATTR, tokens.join(" "));
    }
  }
}

function markKnownSiteSelectors(modules) {
  const host = location.hostname.replace(/^www\./, "");
  const selectors = [];

  if (modules.recommendations) {
    selectors.push(
      "ytd-watch-next-secondary-results-renderer",
      "ytd-reel-shelf-renderer",
      "ytd-merch-shelf-renderer",
      "#secondary",
      "[data-testid='sidebar-column']",
      "[data-testid='placementTracking']",
      "shreddit-sidebar-ad",
      "[aria-label='Trending']",
      "[aria-label='Who to follow']"
    );
  }

  if (modules.comments) {
    selectors.push("ytd-comments", "#comments", "[data-testid='comment']");
  }

  if (modules.metrics) {
    selectors.push("[class*='engagement' i]", "[class*='stats' i]");
  }

  if (modules.overlays) {
    selectors.push("[role='dialog']", "[aria-modal='true']", "[class*='modal' i]", "[class*='popup' i]", "[class*='newsletter' i]");
  }

  if (host.includes("youtube.com") && modules.recommendations) {
    selectors.push("ytd-compact-video-renderer", "ytd-item-section-renderer");
  }

  selectors.forEach((selector) => {
    let matches;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      return;
    }
    matches.forEach((element) => {
      if (!isTooLarge(element)) {
        addToken(element, tokenFromSelector(selector));
      }
    });
  });
}

function classifyElement(element, modules) {

  const attrs = `${element.id} ${element.className} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("data-testid") || ""}`.toLowerCase();

  const isSmall = !element.children.length || (element.textContent || "").length < 500;
  const haystack = isSmall
    ? `${attrs} ${(element.textContent || "").slice(0, 120)}`
    : attrs;

  const tokens = [];

  if (modules.recommendations && /recommended|recommendation|suggested|suggestion|for-you|trending|who-to-follow|shorts|reels/i.test(attrs)) {
    tokens.push("recommendations");
  }

  if (modules.comments && /comments?|replies|discussion/i.test(haystack)) {
    tokens.push("comments");
  }

  if (modules.metrics && /\b(\d[\d,.]*\s*)?(views?|likes?|followers?|subscribers?|shares?|reposts?|retweets?|reactions?)\b/i.test(haystack)) {
    tokens.push("metrics");
  }

  if (modules.overlays && /modal|popup|newsletter|subscribe|consent-banner|cookie-banner/i.test(attrs)) {
    tokens.push("overlays");
  }

  if (modules.sticky && isSticky(element)) {
    tokens.push("sticky");
  }

  if (isTooLarge(element)) {
    const safe = tokens.filter((t) => t !== "recommendations" && t !== "overlays");
    return [...new Set(safe)];
  }

  return [...new Set(tokens)];
}

function isTooLarge(element) {
  try {
    const rect = element.getBoundingClientRect();
    const viewArea = window.innerWidth * window.innerHeight;
    return rect.width * rect.height > viewArea * 0.4;
  } catch {
    return false;
  }
}

function addToken(element, token) {
  if (!(element instanceof HTMLElement) || shouldSkip(element)) {
    return;
  }
  const current = new Set((element.getAttribute(ATTR) || "").split(/\s+/).filter(Boolean));
  current.add(token);
  element.setAttribute(ATTR, [...current].join(" "));
}

function tokenFromSelector(selector) {
  if (/comment/i.test(selector)) {
    return "comments";
  }
  if (/engagement|stats|like|view/i.test(selector)) {
    return "metrics";
  }
  if (/dialog|modal|popup|newsletter|subscribe/i.test(selector)) {
    return "overlays";
  }
  return "recommendations";
}

function shouldSkip(element) {
  return element === document.body ||
    element === document.documentElement ||
    element.closest("input, textarea, select, form, [contenteditable='true']") ||
    element.closest("[data-signalonly-keep]");
}

function isSticky(element) {
  const tag = element.tagName.toLowerCase();
  if (!["header", "nav", "aside", "div"].includes(tag)) {
    return false;
  }

  const style = getComputedStyle(element);
  if (style.position !== "fixed" && style.position !== "sticky") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 240 && rect.height > 32 && rect.height < window.innerHeight * 0.45;
}
