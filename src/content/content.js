const STYLE_ID = "signalonly-focus-style";
const ATTR = "data-signalonly-noise";
const ROOT_ATTR = "data-signalonly-active";
const INJECT_ATTR = "data-signalonly-fingerprint";

let focusProfile = null;
let observer = null;
let scanTimer = 0;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "signalonly:update") {
    void loadAndApply();
  }
});

void loadAndApply();

async function loadAndApply() {
  const config = await getConfig();
  if (!config?.ok || !config.enabled) {
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
  return settings.fingerprintShield || settings.storageShield || settings.sensorShield || settings.piiShield;
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

    :root[${ROOT_ATTR}] * {
      animation-duration: ${modules.motion ? "0.001ms" : "initial"} !important;
      animation-iteration-count: ${modules.motion ? "1" : "initial"} !important;
      transition-duration: ${modules.motion ? "0.001ms" : "initial"} !important;
      scroll-behavior: ${modules.motion ? "auto" : "smooth"} !important;
    }
  `;

  if (!style.parentNode) {
    (document.head || document.documentElement).appendChild(style);
  }
}

function scheduleScan() {
  if (scanTimer) {
    return;
  }

  scanTimer = window.setTimeout(() => {
    scanTimer = 0;
    scanPage();
  }, 120);
}

function scanPage() {
  if (!focusProfile) {
    return;
  }

  const modules = focusProfile.modules || {};
  document.querySelectorAll(`[${ATTR}]`).forEach((node) => node.removeAttribute(ATTR));
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
      "ytd-rich-grid-renderer",
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
    selectors.push("ytd-comments", "#comments", "[data-testid='comment']", "[class*='comment' i]");
  }

  if (modules.metrics) {
    selectors.push("[class*='engagement' i]", "[class*='stats' i]", "[aria-label*='like' i]", "[aria-label*='view' i]");
  }

  if (modules.overlays) {
    selectors.push("[role='dialog']", "[aria-modal='true']", "[class*='modal' i]", "[class*='popup' i]", "[class*='newsletter' i]", "[class*='subscribe' i]");
  }

  if (host.includes("youtube.com") && modules.recommendations) {
    selectors.push("ytd-compact-video-renderer", "ytd-item-section-renderer");
  }

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => addToken(element, tokenFromSelector(selector)));
  });
}

function classifyElement(element, modules) {
  const haystack = `${element.id} ${element.className} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("data-testid") || ""} ${element.textContent?.slice(0, 180) || ""}`.toLowerCase();
  const tokens = [];

  if (modules.recommendations && /recommended|recommendation|suggested|suggestion|for you|trending|related|popular|because you|who to follow|shorts|reels|more like/i.test(haystack)) {
    tokens.push("recommendations");
  }

  if (modules.comments && /comments?|replies|discussion|respond|join the conversation/i.test(haystack)) {
    tokens.push("comments");
  }

  if (modules.metrics && /\b(\d[\d,.]*\s*)?(views?|likes?|followers?|subscribers?|shares?|reposts?|retweets?|reactions?)\b/i.test(haystack)) {
    tokens.push("metrics");
  }

  if (modules.overlays && /modal|popup|newsletter|subscribe|sign up|cookie|consent|promo|promotion/i.test(haystack)) {
    tokens.push("overlays");
  }

  if (modules.sticky && isSticky(element)) {
    tokens.push("sticky");
  }

  return [...new Set(tokens)];
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
